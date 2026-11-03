import { CONTINUE_PROMPT, httpError, ModelError, type CallPurpose, type ModelCall, type ModelClient, type ModelReply } from './models';

/**
 * Google's Gemini models, as a second provider beside Anthropic. It streams
 * from streamGenerateContent with the context's fixed blocks first, so
 * Gemini's implicit prompt cache can reuse them across calls; it has no
 * explicit cache breakpoints, so it writes no cache ahead (no `warm`).
 */

/**
 * Defaults: a small fast model plans, a balanced one builds and repairs. Model
 * names change often: the playground lists the ones a key can reach and sends
 * its choice, and these are only used when nothing is chosen.
 */
export const DEFAULT_GEMINI_MODELS: Readonly<Record<CallPurpose, string>> = {
  plan: 'gemini-3.5-flash-lite',
  scene: 'gemini-3.8-flash',
  repair: 'gemini-3.8-flash',
};

/** How much a Gemini model thinks before it answers. Gemini 3 models cannot turn it off; low is the fast path. */
export type GeminiThinking = 'minimal' | 'low' | 'medium' | 'high';

export interface GeminiOptions {
  readonly apiKey: string;
  readonly models?: Partial<Record<CallPurpose, string>>;
  readonly thinking?: Partial<Record<CallPurpose, GeminiThinking>>;
  readonly baseUrl?: string;
  /** Per silent gap: each stream read resets it. */
  readonly timeoutMs?: number;
  /** Tries after a busy or dropped response that streamed no text yet. */
  readonly retries?: number;
  readonly fetch?: typeof fetch;
}

const DEFAULT_THINKING: Readonly<Record<CallPurpose, GeminiThinking>> = { plan: 'low', scene: 'low', repair: 'low' };

/**
 * Output tokens added for thinking: Gemini counts its thinking against
 * maxOutputTokens, and a cap sized for the reply alone would cut the reply
 * off after the thinking ate it.
 */
export const GEMINI_THINKING_HEADROOM = 8_000;

/**
 * The request's thinking settings. Gemini 3 and later take a level; Gemini 2
 * Flash models take a token budget, where 0 turns thinking off.
 */
export function geminiThinkingConfig(model: string, thinking: GeminiThinking): Record<string, unknown> {
  if (/^gemini-2\./.test(model)) return /flash/.test(model) && (thinking === 'minimal' || thinking === 'low') ? { thinkingBudget: 0 } : {};
  return { thinkingLevel: thinking };
}

interface StreamState {
  text: string;
  model: string;
  stopReason: string | null;
  usage: { prompt: number; output: number; cached: number };
}

export class GeminiClient implements ModelClient {
  readonly name = 'gemini';
  private readonly fetcher: typeof fetch;
  /** Models that refused a thinking setting; their calls go without one. */
  private readonly noThinking = new Set<string>();

  constructor(private readonly options: GeminiOptions) {
    if (!options.apiKey) throw new Error('A Gemini API key is required');
    this.fetcher = options.fetch ?? fetch;
  }

  modelFor(purpose: CallPurpose): string {
    return this.options.models?.[purpose] ?? DEFAULT_GEMINI_MODELS[purpose];
  }

  /** The request body for a call: the fixed blocks as the system instruction, one user turn. */
  body(call: ModelCall): Record<string, unknown> {
    const model = this.modelFor(call.purpose);
    const thinking = this.noThinking.has(model) ? {} : geminiThinkingConfig(model, this.options.thinking?.[call.purpose] ?? DEFAULT_THINKING[call.purpose]);
    const thinks = !('thinkingBudget' in thinking && thinking.thinkingBudget === 0);
    const user = (text: string) => ({ role: 'user', parts: [{ text }] });
    return {
      systemInstruction: { parts: call.prompt.system.map((block) => ({ text: block.text })) },
      contents: call.continueFrom
        ? [user(call.prompt.user), { role: 'model', parts: [{ text: call.continueFrom }] }, user(CONTINUE_PROMPT)]
        : [user(call.prompt.user)],
      generationConfig: {
        maxOutputTokens: thinks ? call.maxTokens + GEMINI_THINKING_HEADROOM : call.maxTokens,
        ...(Object.keys(thinking).length > 0 ? { thinkingConfig: thinking } : {}),
      },
    };
  }

  async complete(call: ModelCall): Promise<ModelReply> {
    const attempts = 1 + Math.max(0, this.options.retries ?? 1);
    let last: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let streamed = false;
      try {
        return await this.once(call, () => (streamed = true));
      } catch (error) {
        last = error;
        // A model that does not take this thinking setting is asked again without one, once.
        const model = this.modelFor(call.purpose);
        if (error instanceof ModelError && error.kind === 'invalid-request' && /thinking/i.test(error.message) && !this.noThinking.has(model)) {
          this.noThinking.add(model);
          attempt--;
          continue;
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
    // The cap is per silent gap, as for Anthropic: a long scene keeps streaming well past any fixed budget.
    const timeout = new AbortController();
    let gap = setTimeout(() => timeout.abort(), timeoutMs);
    const reopenGap = (): void => {
      clearTimeout(gap);
      gap = setTimeout(() => timeout.abort(), timeoutMs);
    };
    const signal = call.signal ? AbortSignal.any([call.signal, timeout.signal]) : timeout.signal;
    const abortError = () =>
      timeout.signal.aborted ? new ModelError('timeout', `The model went silent for over ${timeoutMs} ms`) : new ModelError('aborted', 'The call was cancelled');
    const model = this.modelFor(call.purpose);
    let response: Response;
    try {
      response = await this.fetcher(`${this.options.baseUrl ?? 'https://generativelanguage.googleapis.com'}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.options.apiKey },
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
    const state: StreamState = { text: '', model, stopReason: null, usage: { prompt: 0, output: 0, cached: 0 } };
    let firstTextMs: number | undefined;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const take = (event: string) => {
      const delta = applyGeminiEvent(event, state);
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
        // Gemini counts cached tokens inside the prompt count; the pipeline counts them apart.
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

/** Gemini's finish reasons in the pipeline's words: a reply cut off at the limit is max_tokens, as Anthropic says it. */
const FINISH: Readonly<Record<string, string>> = { STOP: 'end_turn', MAX_TOKENS: 'max_tokens' };

/** Applies one server-sent event to the stream state; returns any new text. Thought parts are never passed on. */
export function applyGeminiEvent(event: string, state: StreamState): string {
  const data = event
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return '';
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(data) as Record<string, unknown>;
  } catch {
    throw new ModelError('protocol', 'The model sent an unreadable event');
  }
  if (typeof message.error === 'object' && message.error !== null) {
    const error = message.error as { message?: unknown; code?: unknown };
    const text = typeof error.message === 'string' ? error.message : 'The model reported an error';
    throw new ModelError(error.code === 429 ? 'rate-limited' : error.code === 503 ? 'overloaded' : 'server', text);
  }
  if (typeof message.modelVersion === 'string') state.model = message.modelVersion;
  const usage = message.usageMetadata as Record<string, unknown> | undefined;
  if (usage) {
    const n = (key: string) => (typeof usage[key] === 'number' ? (usage[key] as number) : 0);
    // Counts are cumulative: later events replace earlier ones. Thinking is billed as output.
    state.usage.prompt = n('promptTokenCount') || state.usage.prompt;
    state.usage.output = n('candidatesTokenCount') + n('thoughtsTokenCount') || state.usage.output;
    state.usage.cached = n('cachedContentTokenCount') || state.usage.cached;
  }
  const feedback = message.promptFeedback as { blockReason?: unknown } | undefined;
  if (typeof feedback?.blockReason === 'string') throw new ModelError('invalid-request', `The model refused the prompt: ${feedback.blockReason}`);
  const candidate = (message.candidates as Array<Record<string, unknown>> | undefined)?.[0];
  if (!candidate) return '';
  if (typeof candidate.finishReason === 'string') state.stopReason = FINISH[candidate.finishReason] ?? candidate.finishReason.toLowerCase();
  const parts = (candidate.content as { parts?: Array<{ text?: unknown; thought?: unknown }> } | undefined)?.parts ?? [];
  let delta = '';
  for (const part of parts) if (part.thought !== true && typeof part.text === 'string') delta += part.text;
  state.text += delta;
  return delta;
}
