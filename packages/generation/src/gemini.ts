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
 * its choice, and these are only used when nothing is chosen. The scene and
 * repair default favours measured latency over the newest number (2026-11-09:
 * gemini-3-flash-preview answered a scene call in under 4 s twice, while
 * gemini-3.8-flash 503'd twice and gemini-3.7-flash went silent then 503'd).
 */
export const DEFAULT_GEMINI_MODELS: Readonly<Record<CallPurpose, string>> = {
  plan: 'gemini-3.5-flash-lite',
  scene: 'gemini-3-flash-preview',
  repair: 'gemini-3-flash-preview',
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
  /**
   * Wait for the first response this long: when neither the response
   * headers nor the first body bytes arrive in time, the attempt fails as
   * overloaded, so it retries and can fall back. Once the reply streams,
   * only the per-gap timeoutMs still applies.
   */
  readonly firstResponseMs?: number;
  /** Tries after a busy or dropped response that streamed no text yet. */
  readonly retries?: number;
  /**
   * Models to try per purpose after the primary's retries fail with a
   * retryable error that streamed no text, newest first. The reply's model
   * names the model that actually answered.
   */
  readonly fallbacks?: Partial<Record<CallPurpose, readonly string[]>>;
  readonly fetch?: typeof fetch;
}

const DEFAULT_THINKING: Readonly<Record<CallPurpose, GeminiThinking>> = { plan: 'low', scene: 'low', repair: 'low' };

/**
 * Output tokens added for thinking: Gemini counts its thinking against
 * maxOutputTokens, and a cap sized for the reply alone would cut the reply
 * off after the thinking ate it.
 */
export const GEMINI_THINKING_HEADROOM = 8_000;

/** A model a key check listed, with the generation methods it supports when the probe returns them. */
export interface ListedModel {
  readonly id: string;
  readonly methods?: readonly string[];
}

/**
 * Models on a key check's list that cannot write text replies: media and
 * live variants, transcription and translation, and reasoning-effort builds.
 */
const NON_TEXT_GEMINI = /embedding|image|tts|audio|transcribe|translate|live|robotics|thinking|omni|computer-use|customtools|banana/i;

/** The leading version in a Gemini id, for newest-first ordering; ids without one sort last. */
function geminiVersion(id: string): number {
  const version = Number(/^gemini-([\d.]+)/.exec(id)?.[1]);
  return Number.isFinite(version) ? version : -1;
}

/**
 * Scene fallback order from measured latency (2026-11-09): gemini-3.6-flash
 * and gemini-3.5-flash-lite answered a scene call in under 6 s twice, while
 * newer numbers went silent or 503'd. Overridable per call.
 */
export const GEMINI_SCENE_FALLBACK_ORDER: readonly string[] = ['gemini-3.6-flash', 'gemini-3.5-flash-lite'];

/**
 * Fallback models from a key check's list: scenes and repairs try the
 * measured order first, then the remaining text flash models newest-first,
 * with the flash-lite model in the chain so a busy day still answers; lite
 * ones plan. Media, live, transcription and thinking variants are skipped,
 * as is any entry whose listed methods leave out generateContent; the chosen
 * models are never repeated. A listed model the provider has since retired
 * stays in the chain: the client skips a 404 to the next fallback at call
 * time.
 */
export function geminiFallbackModels(
  listed: readonly ListedModel[],
  chosen: { readonly plan: string; readonly scene: string },
  prefer: readonly string[] = GEMINI_SCENE_FALLBACK_ORDER,
): { readonly plan: readonly string[]; readonly scene: readonly string[]; readonly repair: readonly string[] } {
  const text = listed.filter(
    ({ id, methods }) =>
      /^gemini-/.test(id) && !NON_TEXT_GEMINI.test(id) && (!methods || methods.length === 0 || methods.includes('generateContent')),
  );
  const newest = [...text].sort((a, b) => geminiVersion(b.id) - geminiVersion(a.id)).map(({ id }) => id);
  const flashes = newest.filter((id) => /flash/.test(id) && id !== chosen.scene);
  const ordered = [...prefer.filter((id) => flashes.includes(id)), ...flashes.filter((id) => !prefer.includes(id))];
  const scene = ordered.slice(0, 3);
  return {
    plan: newest.filter((id) => /flash-lite/.test(id) && id !== chosen.plan).slice(0, 1),
    scene,
    repair: scene,
  };
}

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
  body(call: ModelCall, model: string = this.modelFor(call.purpose)): Record<string, unknown> {
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
    const retries = Math.max(0, this.options.retries ?? 1);
    // The primary model first, then each fallback once: naming the primary
    // again, or one fallback twice, tries it only once.
    const models = [...new Set([this.modelFor(call.purpose), ...(this.options.fallbacks?.[call.purpose] ?? [])])];
    let last: unknown;
    for (const model of models) {
      for (let attempt = 0; attempt <= retries; attempt++) {
        let streamed = false;
        try {
          return await this.once(call, model, () => (streamed = true));
        } catch (error) {
          last = error;
          // A model that does not take this thinking setting is asked again without one, once.
          if (error instanceof ModelError && error.kind === 'invalid-request' && /thinking/i.test(error.message) && !this.noThinking.has(model)) {
            this.noThinking.add(model);
            attempt--;
            continue;
          }
          // A cancelled call is never retried, and never falls back.
          if (call.signal?.aborted) throw error instanceof ModelError && error.kind === 'aborted' ? error : new ModelError('aborted', 'The call was cancelled');
          // A model the provider no longer serves answers 404: it is skipped
          // without spending retries, and the next model is tried instead.
          if (error instanceof ModelError && error.kind === 'invalid-request' && error.status === 404 && !streamed) break;
          if (!(error instanceof ModelError) || !error.retryable || streamed) throw error;
          if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
          // Retries spent: the next fallback model is tried at once, while nothing has streamed.
        }
      }
    }
    throw last;
  }

  private async once(call: ModelCall, model: string, onFirstText: () => void): Promise<ModelReply> {
    const started = Date.now();
    const timeoutMs = this.options.timeoutMs ?? 60_000;
    const firstResponseMs = this.options.firstResponseMs ?? 20_000;
    // The cap is per silent gap, as for Anthropic: a long scene keeps streaming well past any fixed budget.
    const timeout = new AbortController();
    // A model that never answers must not cost the full gap: this second
    // timer fails the attempt as overloaded while nothing has arrived yet.
    const first = new AbortController();
    let gap = setTimeout(() => timeout.abort(), timeoutMs);
    const firstTimer = setTimeout(() => first.abort(), firstResponseMs);
    const reopenGap = (): void => {
      clearTimeout(gap);
      gap = setTimeout(() => timeout.abort(), timeoutMs);
    };
    const signal = AbortSignal.any([...(call.signal ? [call.signal] : []), timeout.signal, first.signal]);
    const abortError = () => {
      if (first.signal.aborted) return new ModelError('overloaded', `The model sent no response within ${firstResponseMs} ms`);
      return timeout.signal.aborted ? new ModelError('timeout', `The model went silent for over ${timeoutMs} ms`) : new ModelError('aborted', 'The call was cancelled');
    };
    let response: Response;
    try {
      response = await this.fetcher(`${this.options.baseUrl ?? 'https://generativelanguage.googleapis.com'}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.options.apiKey },
        body: JSON.stringify(this.body(call, model)),
        signal,
      });
    } catch (error) {
      clearTimeout(gap);
      clearTimeout(firstTimer);
      if (signal.aborted) throw abortError();
      throw new ModelError('network', `The model could not be reached: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
      clearTimeout(gap);
      clearTimeout(firstTimer);
      throw await httpError(response);
    }
    if (!response.body) {
      clearTimeout(gap);
      clearTimeout(firstTimer);
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
        // The first body bytes are the first response, for an SSE stream its
        // first event: the reply is under way, so only the per-gap cap still
        // applies from here on.
        clearTimeout(firstTimer);
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
      clearTimeout(firstTimer);
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
