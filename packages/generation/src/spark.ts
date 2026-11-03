import { CONTINUE_PROMPT, applyChatEvent, httpError, ModelError, type CallPurpose, type ChatStreamState, type ModelCall, type ModelClient, type ModelReply } from './models';

/**
 * Meta Model API, as a fourth provider: Muse Spark and Muse Wonder over the
 * OpenAI-compatible Chat Completions endpoint, with a Model API key
 * (`MODEL_API_KEY`) as a Bearer [REDACTED] Only the documented text models are
 * taken; open-weight and image, voice and segmentation models are refused.
 */

/**
 * Defaults: the Contributor variant plans, builds and repairs. It is the same
 * Muse Spark 1.3 at a heavy discount, in exchange for Meta training on the
 * content; pick `muse-spark-1.3` when the content must not train.
 */
export const DEFAULT_SPARK_MODELS: Readonly<Record<CallPurpose, string>> = {
  plan: 'muse-spark-1.3-contributor',
  scene: 'muse-spark-1.3-contributor',
  repair: 'muse-spark-1.3-contributor',
};

/** The text models Model API serves over Chat Completions: Muse Spark 1.1 through 1.3 and Muse Wonder 1.0. */
export const SPARK_MODEL = /^muse-(?:spark-1\.[123](?:-contributor)?|wonder-1\.0)$/;

export type SparkEffort = 'low' | 'medium' | 'high';

export interface SparkOptions {
  readonly apiKey: string;
  readonly models?: Partial<Record<CallPurpose, string>>;
  /** Reasoning effort; low is the fast path. Muse Spark always reasons. */
  readonly effort?: Partial<Record<CallPurpose, SparkEffort>>;
  readonly baseUrl?: string;
  /** Per silent gap: each stream read resets it. */
  readonly timeoutMs?: number;
  /** Tries after a busy or dropped response that streamed no text yet. */
  readonly retries?: number;
  readonly fetch?: typeof fetch;
}

export class SparkClient implements ModelClient {
  readonly name = 'spark';
  private readonly fetcher: typeof fetch;
  /** Whether streamed usage was refused; later calls go without asking for it. */
  private usageOptions = true;
  /** Models that refused a reasoning effort; their calls go without one. */
  private readonly noEffort = new Set<string>();
  /** Models that refused the reply's length, with the largest they took. */
  private readonly caps = new Map<string, number>();

  constructor(private readonly options: SparkOptions) {
    if (!options.apiKey) throw new Error('A Meta Model API key is required');
    for (const purpose of ['plan', 'scene', 'repair'] as const) {
      const model = this.modelFor(purpose);
      if (!SPARK_MODEL.test(model)) throw new Error(`Meta Model API here takes Muse Spark and Muse Wonder text models, not ${model}`);
    }
    this.fetcher = options.fetch ?? fetch;
  }

  modelFor(purpose: CallPurpose): string {
    return this.options.models?.[purpose] ?? DEFAULT_SPARK_MODELS[purpose];
  }

  private endpoint(): string {
    return this.options.baseUrl ?? 'https://api.meta.ai/v1';
  }

  /** The longest reply a call may ask this model for. */
  private cap(model: string, wanted: number): number {
    const known = this.caps.get(model);
    return known === undefined ? wanted : Math.min(wanted, known);
  }

  /** The request body for a call: the fixed blocks as one system message, then the user turn. */
  body(call: ModelCall): Record<string, unknown> {
    const model = this.modelFor(call.purpose);
    const effort = this.options.effort?.[call.purpose] ?? 'low';
    return {
      model,
      stream: true,
      // Streamed usage is OpenAI-standard but undocumented on Model API: asked
      // for, and dropped for good if a call refuses it.
      ...(this.usageOptions ? { stream_options: { include_usage: true } } : {}),
      max_completion_tokens: this.cap(model, call.maxTokens),
      ...(this.noEffort.has(model) ? {} : { reasoning_effort: effort }),
      messages: [
        // One system message, its fixed blocks in order: a matching cached prefix is served at the cached rate.
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
        // A call that refuses a setting is asked again without it: three at most, for usage, effort and length.
        if (error instanceof ModelError && error.kind === 'invalid-request' && adjustments < 3) {
          if (/stream_options|include_usage/i.test(error.message) && this.usageOptions) {
            this.usageOptions = false;
            adjustments++;
            attempt--;
            continue;
          }
          if (/reasoning/i.test(error.message) && !this.noEffort.has(model)) {
            this.noEffort.add(model);
            adjustments++;
            attempt--;
            continue;
          }
          if (/max_completion_tokens|max_tokens|max tokens|maximum.*tokens|token limit/i.test(error.message) && this.cap(model, call.maxTokens) > 4_096) {
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
