import type { Prompt } from './context';

/**
 * Model clients. The pipeline talks to a `ModelClient`; the Anthropic client
 * streams from the Messages API with the fixed context marked for prompt
 * caching, and the scripted client stands in for it in tests, evals of the
 * pipeline itself, and the playground.
 */

export type CallPurpose = 'plan' | 'scene' | 'repair';

export interface ModelCall {
  readonly purpose: CallPurpose;
  readonly prompt: Prompt;
  readonly maxTokens: number;
  readonly signal?: AbortSignal;
  /** Text as it streams in. Thinking is never passed on. */
  readonly onText?: (delta: string) => void;
}

export interface ModelUsage {
  /** Input tokens after the last cache breakpoint. */
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export const NO_USAGE: ModelUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

export function addUsage(a: ModelUsage, b: ModelUsage): ModelUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

export interface ModelReply {
  readonly text: string;
  readonly model: string;
  readonly usage: ModelUsage;
  readonly stopReason: string | null;
  readonly ms: number;
}

export interface ModelClient {
  readonly name: string;
  /** The model a call of this purpose goes to, for records and cost. */
  modelFor(purpose: CallPurpose): string;
  complete(call: ModelCall): Promise<ModelReply>;
}

export type ModelErrorKind = 'timeout' | 'aborted' | 'overloaded' | 'rate-limited' | 'auth' | 'invalid-request' | 'server' | 'network' | 'protocol';

export class ModelError extends Error {
  constructor(
    readonly kind: ModelErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ModelError';
  }

  /** Worth one more try: the provider was busy, or the connection dropped. */
  get retryable(): boolean {
    return this.kind === 'overloaded' || this.kind === 'rate-limited' || this.kind === 'server' || this.kind === 'network';
  }
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

export interface ModelPrice {
  /** US dollars per million input tokens. */
  readonly input: number;
  readonly output: number;
  /** Cache reads and five-minute cache writes, as multiples of the input price. */
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

/**
 * List prices from platform.claude.com/docs/en/about-claude/pricing, checked
 * in October 2026. The service's cost limits use these; override them in its
 * configuration when prices change.
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.1, cacheWrite: 1.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.05, cacheWrite: 1.25 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.05, cacheWrite: 1.25 },
};

/** What a call cost in US dollars; unknown models are priced as the most expensive known one. */
export function costOf(model: string, usage: ModelUsage, prices: Readonly<Record<string, ModelPrice>> = MODEL_PRICES): number {
  const price =
    prices[model] ??
    Object.values(prices).reduce((max, p) => (p.output > max.output ? p : max), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  const input = usage.inputTokens + usage.cacheReadTokens * price.cacheRead + usage.cacheWriteTokens * price.cacheWrite;
  return (input * price.input + usage.outputTokens * price.output) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

export type Effort = 'low' | 'medium' | 'high';

export interface AnthropicOptions {
  readonly apiKey: string;
  /** Defaults: a small fast model plans, the balanced model builds and repairs. */
  readonly models?: Partial<Record<CallPurpose, string>>;
  readonly effort?: Partial<Record<CallPurpose, Effort>>;
  readonly baseUrl?: string;
  /** Per call, including the whole stream. */
  readonly timeoutMs?: number;
  /** Tries after a busy or dropped response that streamed no text yet. */
  readonly retries?: number;
  readonly fetch?: typeof fetch;
}

export const DEFAULT_MODELS: Readonly<Record<CallPurpose, string>> = {
  plan: 'claude-haiku-5-5',
  scene: 'claude-sonnet-5-5',
  repair: 'claude-sonnet-5-5',
};

const DEFAULT_EFFORT: Readonly<Record<CallPurpose, Effort>> = { plan: 'low', scene: 'medium', repair: 'medium' };

interface StreamState {
  text: string;
  model: string;
  stopReason: string | null;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export class AnthropicClient implements ModelClient {
  readonly name = 'anthropic';
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: AnthropicOptions) {
    if (!options.apiKey) throw new Error('An Anthropic API key is required');
    this.fetcher = options.fetch ?? fetch;
  }

  modelFor(purpose: CallPurpose): string {
    return this.options.models?.[purpose] ?? DEFAULT_MODELS[purpose];
  }

  /** The request body for a call: system blocks with cache breakpoints, one user turn, streaming. */
  body(call: ModelCall): Record<string, unknown> {
    return {
      model: this.modelFor(call.purpose),
      max_tokens: call.maxTokens,
      stream: true,
      system: call.prompt.system.map((block) => ({
        type: 'text',
        text: block.text,
        ...(block.cache ? { cache_control: { type: 'ephemeral' } } : {}),
      })),
      messages: [{ role: 'user', content: call.prompt.user }],
      output_config: { effort: this.options.effort?.[call.purpose] ?? DEFAULT_EFFORT[call.purpose] },
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
        if (!(error instanceof ModelError) || !error.retryable || streamed || attempt === attempts - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
      }
    }
    throw last;
  }

  private async once(call: ModelCall, onFirstText: () => void): Promise<ModelReply> {
    const started = Date.now();
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 60_000);
    const signal = call.signal ? AbortSignal.any([call.signal, timeout]) : timeout;
    const abortError = () =>
      timeout.aborted ? new ModelError('timeout', `The model did not finish within ${this.options.timeoutMs ?? 60_000} ms`) : new ModelError('aborted', 'The call was cancelled');
    let response: Response;
    try {
      response = await this.fetcher(`${this.options.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.options.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(this.body(call)),
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw abortError();
      throw new ModelError('network', `The model could not be reached: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) throw await httpError(response);
    if (!response.body) throw new ModelError('protocol', 'The model sent no body');

    const state: StreamState = { text: '', model: this.modelFor(call.purpose), stopReason: null, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const delta = applyEvent(event, state);
          if (delta) {
            if (state.text.length === delta.length) onFirstText();
            call.onText?.(delta);
          }
          boundary = buffer.indexOf('\n\n');
        }
      }
    } catch (error) {
      if (signal.aborted) throw abortError();
      if (error instanceof ModelError) throw error;
      throw new ModelError('network', `The stream broke off: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      reader.releaseLock();
    }
    if (buffer.trim()) {
      const delta = applyEvent(buffer, state);
      if (delta) call.onText?.(delta);
    }
    return {
      text: state.text,
      model: state.model,
      stopReason: state.stopReason,
      usage: {
        inputTokens: state.usage.input,
        outputTokens: state.usage.output,
        cacheReadTokens: state.usage.cacheRead,
        cacheWriteTokens: state.usage.cacheWrite,
      },
      ms: Date.now() - started,
    };
  }
}

async function httpError(response: Response): Promise<ModelError> {
  let detail = '';
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    detail = body.error?.message ?? '';
  } catch {
    // Not JSON.
  }
  const status = response.status;
  const message = `The model returned ${status}${detail ? `: ${detail}` : ''}`;
  if (status === 401 || status === 403) return new ModelError('auth', message, status);
  if (status === 429) return new ModelError('rate-limited', message, status);
  if (status === 529) return new ModelError('overloaded', message, status);
  if (status >= 500) return new ModelError('server', message, status);
  return new ModelError('invalid-request', message, status);
}

/** Applies one server-sent event to the stream state; returns any new text. */
function applyEvent(event: string, state: StreamState): string {
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
  const usage = (value: unknown) => {
    if (typeof value !== 'object' || value === null) return;
    const u = value as Record<string, unknown>;
    const n = (key: string) => (typeof u[key] === 'number' ? (u[key] as number) : undefined);
    // Counts are cumulative: later events replace earlier ones.
    state.usage.input = n('input_tokens') ?? state.usage.input;
    state.usage.output = n('output_tokens') ?? state.usage.output;
    state.usage.cacheRead = n('cache_read_input_tokens') ?? state.usage.cacheRead;
    state.usage.cacheWrite = n('cache_creation_input_tokens') ?? state.usage.cacheWrite;
  };
  switch (message.type) {
    case 'message_start': {
      const body = message.message as { model?: unknown; usage?: unknown } | undefined;
      if (typeof body?.model === 'string') state.model = body.model;
      usage(body?.usage);
      return '';
    }
    case 'content_block_delta': {
      const delta = message.delta as { type?: unknown; text?: unknown } | undefined;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        state.text += delta.text;
        return delta.text;
      }
      return '';
    }
    case 'message_delta': {
      const delta = message.delta as { stop_reason?: unknown } | undefined;
      if (typeof delta?.stop_reason === 'string') state.stopReason = delta.stop_reason;
      usage(message.usage);
      return '';
    }
    case 'error': {
      const error = message.error as { type?: unknown; message?: unknown } | undefined;
      const text = typeof error?.message === 'string' ? error.message : 'The model reported an error';
      throw new ModelError(error?.type === 'overloaded_error' ? 'overloaded' : 'server', text);
    }
    default:
      // ping, content_block_start and _stop, message_stop, and any new event types.
      return '';
  }
}

// ---------------------------------------------------------------------------
// Scripted
// ---------------------------------------------------------------------------

export interface ScriptedOptions {
  readonly name?: string;
  /** Characters per streamed piece. */
  readonly chunk?: number;
  /** Milliseconds before the reply starts. */
  readonly latencyMs?: number;
  readonly models?: Partial<Record<CallPurpose, string>>;
}

/**
 * A model that answers from a script: tests, the pipeline's own evals and
 * the playground use it. It streams its reply in pieces like a real model and
 * reports token usage estimated from the text.
 */
export class ScriptedModel implements ModelClient {
  readonly name: string;
  readonly calls: ModelCall[] = [];

  constructor(
    private readonly script: (call: ModelCall, index: number) => string | Promise<string>,
    private readonly options: ScriptedOptions = {},
  ) {
    this.name = options.name ?? 'scripted';
  }

  modelFor(purpose: CallPurpose): string {
    return this.options.models?.[purpose] ?? `scripted-${purpose}`;
  }

  async complete(call: ModelCall): Promise<ModelReply> {
    const started = Date.now();
    const index = this.calls.push(call) - 1;
    if (this.options.latencyMs) await delay(this.options.latencyMs, call.signal);
    if (call.signal?.aborted) throw new ModelError('aborted', 'The call was cancelled');
    const text = await this.script(call, index);
    const chunk = Math.max(1, this.options.chunk ?? 64);
    for (let i = 0; i < text.length; i += chunk) {
      if (call.signal?.aborted) throw new ModelError('aborted', 'The call was cancelled');
      call.onText?.(text.slice(i, i + chunk));
    }
    const system = call.prompt.system.map((b) => b.text).join('');
    return {
      text,
      model: this.modelFor(call.purpose),
      stopReason: 'end_turn',
      usage: { inputTokens: Math.ceil((system.length + call.prompt.user.length) / 3.5), outputTokens: Math.ceil(text.length / 3.5), cacheReadTokens: 0, cacheWriteTokens: 0 },
      ms: Date.now() - started,
    };
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new ModelError('aborted', 'The call was cancelled'));
      },
      { once: true },
    );
  });
}
