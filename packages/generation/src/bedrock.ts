import { CONTINUE_PROMPT, applyChatEvent, httpError, ModelError, type CallPurpose, type ChatStreamState, type ModelCall, type ModelClient, type ModelReply } from './models';

/**
 * Amazon Bedrock, as a third provider, for open-weight models: GLM, DeepSeek,
 * Qwen, Kimi and MiniMax. It streams from Bedrock's OpenAI-compatible Chat
 * Completions endpoint with a Bedrock API key as a bearer token, so there is
 * no request signing and no binary event stream to read. Models from
 * Anthropic, OpenAI and xAI are refused: this provider is for the others.
 */

/** Defaults: GLM 4.7 Flash plans, GLM 4.7 builds and repairs; both run in-Region on demand. */
export const DEFAULT_BEDROCK_MODELS: Readonly<Record<CallPurpose, string>> = {
  plan: 'zai.glm-4.7-flash',
  scene: 'zai.glm-4.7',
  repair: 'zai.glm-4.7',
};

/** Model families this provider takes, with an optional cross-Region prefix such as us. or global. */
export const BEDROCK_MODEL = /^(?:(?:us|eu|apac|jp|au|global)\.)?(?:deepseek|qwen|zai|moonshot|moonshotai|minimax)\.[\w.:-]{1,80}$/;

/** The cross-Region inference profile prefix for an AWS Region: us, eu, apac, or global elsewhere. */
export function bedrockGeo(region: string): string {
  const area = region.split('-')[0];
  return area === 'us' ? 'us' : area === 'eu' ? 'eu' : area === 'ap' ? 'apac' : 'global';
}

/** Whether a model ID already names a cross-Region inference profile. */
const PROFILED = /^(?:us|eu|apac|jp|au|global)\./;

/** Largest replies, in tokens, of models that allow less than a scene may ask for. */
const OUTPUT_CAPS: ReadonlyArray<readonly [RegExp, number]> = [[/deepseek\.v3/, 8_192]];

export type BedrockEffort = 'low' | 'medium' | 'high';

export interface BedrockOptions {
  readonly apiKey: string;
  /** AWS Region of the bedrock-runtime endpoint. Default us-east-1. */
  readonly region?: string;
  readonly models?: Partial<Record<CallPurpose, string>>;
  /** Reasoning effort, for models that reason; low is the fast path. */
  readonly effort?: Partial<Record<CallPurpose, BedrockEffort>>;
  readonly baseUrl?: string;
  /** Per silent gap: each stream read resets it. */
  readonly timeoutMs?: number;
  /** Tries after a busy or dropped response that streamed no text yet. */
  readonly retries?: number;
  readonly fetch?: typeof fetch;
}

export class BedrockClient implements ModelClient {
  readonly name = 'bedrock';
  private readonly fetcher: typeof fetch;
  /** Models that refused a reasoning effort; their calls go without one. */
  private readonly noEffort = new Set<string>();
  /** Models that refused the reply's length, with the largest they took. */
  private readonly caps = new Map<string, number>();
  /** Models Bedrock serves only through a cross-Region profile, by the profile's ID. */
  private readonly profiles = new Map<string, string>();

  constructor(private readonly options: BedrockOptions) {
    if (!options.apiKey) throw new Error('A Bedrock API key is required');
    for (const purpose of ['plan', 'scene', 'repair'] as const) {
      const model = this.modelFor(purpose);
      if (!BEDROCK_MODEL.test(model)) throw new Error(`Bedrock here takes GLM, DeepSeek, Qwen, Kimi and MiniMax models, not ${model}`);
    }
    this.fetcher = options.fetch ?? fetch;
  }

  modelFor(purpose: CallPurpose): string {
    const model = this.options.models?.[purpose] ?? DEFAULT_BEDROCK_MODELS[purpose];
    return this.profiles.get(model) ?? model;
  }

  private endpoint(): string {
    return this.options.baseUrl ?? `https://bedrock-runtime.${this.options.region ?? 'us-east-1'}.amazonaws.com/openai/v1`;
  }

  /** The longest reply a call may ask this model for. */
  private cap(model: string, wanted: number): number {
    const known = this.caps.get(model) ?? OUTPUT_CAPS.find(([pattern]) => pattern.test(model))?.[1];
    return known === undefined ? wanted : Math.min(wanted, known);
  }

  /** The request body for a call: the fixed blocks as one system message, then the user turn. */
  body(call: ModelCall): Record<string, unknown> {
    const model = this.modelFor(call.purpose);
    const effort = this.options.effort?.[call.purpose] ?? 'low';
    return {
      model,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: this.cap(model, call.maxTokens),
      ...(this.noEffort.has(model) ? {} : { reasoning_effort: effort }),
      messages: [
        // One system message, its fixed blocks in order: models with a prompt cache reuse the shared prefix.
        { role: 'system', content: call.prompt.system.map((block) => block.text).join('\n\n') },
        { role: 'user', content: call.prompt.user },
        ...(call.continueFrom ? [{ role: 'assistant', content: call.continueFrom }, { role: 'user', content: CONTINUE_PROMPT }] : []),
      ],
    };
  }

  async complete(call: ModelCall): Promise<ModelReply> {
    const attempts = 1 + Math.max(0, this.options.retries ?? 1);
    let last: unknown;
    let adjustments = 0;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let streamed = false;
      try {
        return await this.once(call, () => (streamed = true));
      } catch (error) {
        last = error;
        const model = this.modelFor(call.purpose);
        // A model that refuses a setting is asked again without it: twice at most, for effort and length.
        // A model that runs only through a cross-Region profile is asked again by the profile's ID, once.
        if (error instanceof ModelError && error.kind === 'invalid-request' && /on-demand throughput|inference profile/i.test(error.message) && !PROFILED.test(model)) {
          const named = this.options.models?.[call.purpose] ?? DEFAULT_BEDROCK_MODELS[call.purpose];
          this.profiles.set(named, `${bedrockGeo(this.options.region ?? 'us-east-1')}.${named}`);
          attempt--;
          continue;
        }
        if (error instanceof ModelError && error.kind === 'invalid-request' && adjustments < 2) {
          if (/reasoning/i.test(error.message) && !this.noEffort.has(model)) {
            this.noEffort.add(model);
            adjustments++;
            attempt--;
            continue;
          }
          if (/max_tokens|max tokens|maximum.*tokens|token limit/i.test(error.message) && this.cap(model, call.maxTokens) > 4_096) {
            this.caps.set(model, Math.max(4_096, Math.floor(this.cap(model, call.maxTokens) / 2)));
            adjustments++;
            attempt--;
            continue;
          }
        }
        if (!(error instanceof ModelError) || !error.retryable || streamed || attempt === attempts - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
      }
    }
    throw last;
  }

  private async once(call: ModelCall, onFirstText: () => void): Promise<ModelReply> {
    const started = Date.now();
    const timeoutMs = this.options.timeoutMs ?? 60_000;
    // The cap is per silent gap, as for the other providers: a long scene keeps streaming past any fixed budget.
    const timeout = new AbortController();
    let gap = setTimeout(() => timeout.abort(), timeoutMs);
    const reopenGap = (): void => {
      clearTimeout(gap);
      gap = setTimeout(() => timeout.abort(), timeoutMs);
    };
    const signal = call.signal ? AbortSignal.any([call.signal, timeout.signal]) : timeout.signal;
    const abortError = () =>
      timeout.signal.aborted ? new ModelError('timeout', `The model went silent for over ${timeoutMs} ms`) : new ModelError('aborted', 'The call was cancelled');
    let response: Response;
    try {
      response = await this.fetcher(`${this.endpoint()}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.options.apiKey}` },
        body: JSON.stringify(this.body(call)),
        signal,
      });
    } catch (error) {
      clearTimeout(gap);
      if (signal.aborted) throw abortError();
      throw new ModelError('network', `The model could not be reached: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
      clearTimeout(gap);
      throw await httpError(response);
    }
    if (!response.body) {
      clearTimeout(gap);
      throw new ModelError('protocol', 'The model sent no body');
    }
    const state: ChatStreamState = { text: '', model: this.modelFor(call.purpose), stopReason: null, usage: { prompt: 0, output: 0, cached: 0 } };
    let firstTextMs: number | undefined;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const take = (event: string) => {
      const delta = applyChatEvent(event, state);
      if (!delta) return;
      if (state.text.length === delta.length) {
        firstTextMs = Date.now() - started;
        onFirstText();
      }
      call.onText?.(delta);
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        reopenGap();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          take(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf('\n\n');
        }
      }
    } catch (error) {
      if (signal.aborted) throw abortError();
      if (error instanceof ModelError) throw error;
      throw new ModelError('network', `The stream broke off: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      reader.releaseLock();
      clearTimeout(gap);
    }
    if (buffer.trim()) take(buffer);
    return {
      text: state.text,
      model: state.model,
      stopReason: state.stopReason,
      usage: {
        // Cached tokens are counted inside the prompt; the pipeline counts them apart.
        inputTokens: Math.max(0, state.usage.prompt - state.usage.cached),
        outputTokens: state.usage.output,
        cacheReadTokens: state.usage.cached,
        cacheWriteTokens: 0,
      },
      ms: Date.now() - started,
      ...(firstTextMs !== undefined ? { firstTextMs } : {}),
    };
  }
}

