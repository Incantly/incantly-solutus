/**
 * Server-sent events from a chat completions stream (docs/features/server/design.md 4, R3.1): the reader that cuts the
 * body into `data:` events, and the joiner that turns the chat completions chunks into the teacher's `ChatEvent`s. A tool
 * call's argument pieces are joined by index and the call is given only with its arguments complete: when they parse as
 * JSON, or when the choice ends. A stream that ends with no `[DONE]` and no finished choice is a `stream_cut`.
 */
import type { ChatEvent, ModelToolCall, StreamError } from '@incantly/teacher';

/** One event of the stream: its data, or the end marker. */
export type SseItem = { readonly data: string } | { readonly done: true };

/**
 * Reads a response body as server-sent events. Comment lines (`: OPENROUTER PROCESSING`) are dropped, a `data:` line
 * with more lines after it up to the blank line is one event, and `[DONE]` ends the stream. The last event counts even
 * when no blank line follows it. The body is cancelled when the reader is left.
 */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseItem> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  const dispatch = (): SseItem | undefined => {
    if (data.length === 0) return undefined;
    const text = data.join('\n');
    data = [];
    return text.trim() === '[DONE]' ? { done: true } : { data: text };
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
        if (line === '') {
          const item = dispatch();
          if (item !== undefined) {
            yield item;
            if ('done' in item) return;
          }
        } else if (line.startsWith('data:')) {
          data.push(line.slice(line.startsWith('data: ') ? 6 : 5));
        }
        // other lines: comments (start with ':'), `event:`, `id:` and `retry:` carry nothing we use
      }
      if (done) break;
    }
    const tail = buffer.replace(/\r$/, '');
    if (tail.startsWith('data:')) data.push(tail.slice(tail.startsWith('data: ') ? 6 : 5));
    const last = dispatch();
    if (last !== undefined) yield last;
  } finally {
    try {
      await reader.cancel();
    } catch {
      // the body was already closed
    }
  }
}

/** What the joiner learned about the stream: the model that answered, its token counts, and whether a choice ended. */
export interface StreamFacts {
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** A choice carried a `finish_reason`: the reply is whole even if the stream ends with no `[DONE]`. */
  finished: boolean;
}

interface PendingCall {
  id: string;
  name: string;
  args: string;
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** True when the text is a complete JSON object (what a tool's arguments are). */
function completeObject(text: string): boolean {
  if (text === '' || !text.endsWith('}')) return false;
  try {
    return isObject(JSON.parse(text));
  } catch {
    return false;
  }
}

/** The error of a stream that stopped partway (`stream_cut`, T006): the turn keeps what ran. */
export const streamCut = (): StreamError => ({ ok: false, kind: 'stream_cut', message: 'The answer stopped partway.' });

/** The error of a chunk or a status that says the model failed. The provider's own text is never passed on. */
export function providerError(status: number | undefined, retryAfterMs?: number): StreamError {
  if (status === 429) {
    const seconds = Math.max(1, Math.ceil((retryAfterMs ?? 60_000) / 1000));
    return { ok: false, kind: 'model_busy', message: `The AI is busy; try again in ${seconds} s.`, detail: { retryAfterMs: retryAfterMs ?? 60_000 } };
  }
  return { ok: false, kind: 'model_unavailable', message: 'The AI is not available right now.', ...(status !== undefined ? { detail: { status } } : {}) };
}

/** Joins the chunks of one chat completions stream into `ChatEvent`s. */
export class ChunkJoiner {
  readonly facts: StreamFacts;
  private readonly calls = new Map<number, PendingCall>();
  private readonly sent = new Set<number>();

  constructor(requested: string) {
    this.facts = { model: requested, inputTokens: 0, outputTokens: 0, finished: false };
  }

  /** The events one parsed chunk gives, in order. An `error` event ends the stream. */
  chunk(value: unknown): ChatEvent[] {
    if (!isObject(value)) return [];
    const out: ChatEvent[] = [];
    if (typeof value['model'] === 'string' && value['model'] !== '') this.facts.model = value['model'];
    const usage = value['usage'];
    if (isObject(usage)) {
      if (typeof usage['prompt_tokens'] === 'number') this.facts.inputTokens = usage['prompt_tokens'];
      if (typeof usage['completion_tokens'] === 'number') this.facts.outputTokens = usage['completion_tokens'];
    }
    const failure = value['error'];
    if (isObject(failure)) {
      const code = failure['code'];
      out.push({ error: providerError(typeof code === 'number' ? code : undefined) });
      return out;
    }
    const choices = value['choices'];
    const choice = Array.isArray(choices) ? (choices[0] as unknown) : undefined;
    if (!isObject(choice)) return out;
    const delta = choice['delta'];
    if (isObject(delta)) {
      const content = delta['content'];
      if (typeof content === 'string' && content !== '') out.push({ text: content });
      const pieces = delta['tool_calls'];
      if (Array.isArray(pieces)) this.join(pieces as unknown[], out);
    }
    const reason = choice['finish_reason'];
    if (typeof reason === 'string' && reason !== '') {
      if (reason === 'error') {
        out.push({ error: providerError(undefined) });
        return out;
      }
      this.facts.finished = true;
      this.flush(out);
    }
    return out;
  }

  /** The choice ended: every call not given yet is given now, with the arguments it has. */
  flush(out: ChatEvent[] = []): ChatEvent[] {
    for (const [index, call] of [...this.calls.entries()].sort((a, b) => a[0] - b[0])) {
      if (this.sent.has(index) || call.name === '') continue;
      this.sent.add(index);
      out.push({ toolCall: this.callOf(index, call) });
    }
    return out;
  }

  private callOf(index: number, call: PendingCall): ModelToolCall {
    return { id: call.id !== '' ? call.id : `call_${index}`, name: call.name, args: call.args.trim() === '' ? '{}' : call.args };
  }

  private join(pieces: readonly unknown[], out: ChatEvent[]): void {
    pieces.forEach((piece, position) => {
      if (!isObject(piece)) return;
      const index = typeof piece['index'] === 'number' ? piece['index'] : position;
      const call = this.calls.get(index) ?? { id: '', name: '', args: '' };
      this.calls.set(index, call);
      if (typeof piece['id'] === 'string' && piece['id'] !== '') call.id = piece['id'];
      const fn = piece['function'];
      if (isObject(fn)) {
        if (typeof fn['name'] === 'string' && fn['name'] !== '') call.name = fn['name'];
        if (typeof fn['arguments'] === 'string') call.args += fn['arguments'];
      }
      if (!this.sent.has(index) && call.name !== '' && completeObject(call.args)) {
        this.sent.add(index);
        out.push({ toolCall: this.callOf(index, call) });
      }
    });
  }
}

/**
 * The chat events of a response body. Ends with `done` when the stream ended with `[DONE]` or a finished choice, and
 * with a `stream_cut` error when it ended any other way. A body that fails to read is a cut stream.
 */
export async function* chatEvents(body: ReadableStream<Uint8Array>, requested: string): AsyncGenerator<ChatEvent> {
  const joiner = new ChunkJoiner(requested);
  let ended = false;
  for await (const item of readSse(body)) {
    if ('done' in item) {
      ended = true;
      break;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(item.data);
    } catch {
      continue;
    }
    for (const ev of joiner.chunk(parsed)) {
      yield ev;
      if ('error' in ev) return;
    }
  }
  if (!ended && !joiner.facts.finished) {
    yield { error: streamCut() };
    return;
  }
  for (const ev of joiner.flush()) yield ev;
  yield { done: { model: joiner.facts.model, inputTokens: joiner.facts.inputTokens, outputTokens: joiner.facts.outputTokens } };
}
