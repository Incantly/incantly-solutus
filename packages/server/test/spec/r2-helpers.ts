/**
 * Helpers of the round 2 server specs: the recorded streams, a body of bytes in chosen pieces, a body the test feeds by
 * hand, and a fake `fetch` for OpenRouter that keeps what it was asked and plays the answers the test gives. Nothing here
 * reaches the network.
 */
import { readFileSync } from 'node:fs';
import type { ChatEvent, ChatRequest } from '@incantly/teacher';

/** The text of a recorded stream in `test/fixtures/`. */
export const fixture = (name: string): string => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

const encoder = new TextEncoder();

/** A body of `bytes`, cut into pieces of `size` bytes (the whole in one piece by default). */
export function bodyOf(text: string | Uint8Array, size = Number.POSITIVE_INFINITY): ReadableStream<Uint8Array> {
  const bytes = typeof text === 'string' ? encoder.encode(text) : text;
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(bytes.length, at + size);
      controller.enqueue(bytes.slice(at, end));
      at = end;
    },
  });
}

export interface Controlled {
  readonly body: ReadableStream<Uint8Array>;
  push(text: string): void;
  end(): void;
  fail(e: unknown): void;
}

/** A body the test feeds by hand, so it can look at what the reader gave between two pieces. */
export function controlled(): Controlled {
  const box: { c?: ReadableStreamDefaultController<Uint8Array> } = {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      box.c = controller;
    },
  });
  return {
    body,
    push: (text) => box.c?.enqueue(encoder.encode(text)),
    end: () => box.c?.close(),
    fail: (e) => box.c?.error(e),
  };
}

export async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

/** A chat completions chunk with a text piece. */
export const textChunk = (content: string, model = 'fake/model:free'): unknown => ({ id: 'gen-1', model, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] });

/** A chunk that ends the choice. */
export const finishChunk = (reason = 'stop', model = 'fake/model:free'): unknown => ({ id: 'gen-1', model, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: reason }] });

export const usageChunk = (prompt: number, completion: number, model = 'fake/model:free'): unknown => ({ id: 'gen-1', model, object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion } });

/** A tool call piece of choice 0. */
export const toolChunk = (index: number, piece: { id?: string; name?: string; arguments?: string }): unknown => ({
  id: 'gen-1',
  model: 'fake/model:free',
  object: 'chat.completion.chunk',
  choices: [{ index: 0, delta: { role: 'assistant', content: '', tool_calls: [{ index, ...(piece.id !== undefined ? { id: piece.id, type: 'function' } : {}), function: { ...(piece.name !== undefined ? { name: piece.name } : {}), ...(piece.arguments !== undefined ? { arguments: piece.arguments } : {}) } }] }, finish_reason: null }],
});

/** The chunks as the text of a server-sent event stream: a `data:` line and a blank line each. */
export const sseOf = (chunks: readonly unknown[], end: 'done' | 'none' = 'done'): string => `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')}${end === 'done' ? 'data: [DONE]\n\n' : ''}`;

/** A whole text reply as a stream: the pieces, a finish, usage, `[DONE]`. */
export const textSse = (pieces: readonly string[], model = 'fake/model:free'): string => sseOf([...pieces.map((p) => textChunk(p, model)), finishChunk('stop', model), usageChunk(10, 5, model)]);

/** One model call as the fake network sees it. */
export interface Call {
  readonly url: string;
  readonly method: string;
  /** Header names are lower case. */
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyText: string;
  /** The body parsed as JSON. */
  readonly json: Record<string, unknown>;
  readonly model: string;
  readonly signal: AbortSignal | undefined;
}

/** What the fake network answers a call with. */
export type Answer =
  | { readonly kind: 'sse'; readonly text: string; readonly pieceSize?: number; readonly status?: number; readonly headers?: Readonly<Record<string, string>> }
  | { readonly kind: 'status'; readonly status: number; readonly headers?: Readonly<Record<string, string>>; readonly body?: string }
  | { readonly kind: 'network'; readonly message: string }
  /** Answers at once with `text` as the head of the stream, then sends nothing until the call's signal fires. */
  | { readonly kind: 'hang'; readonly text?: string }
  /** The test feeds the body. */
  | { readonly kind: 'stream'; readonly body: ReadableStream<Uint8Array> };

export const ok = (text: string, pieceSize?: number): Answer => ({ kind: 'sse', text, ...(pieceSize !== undefined ? { pieceSize } : {}) });
export const status = (code: number, headers: Record<string, string> = {}, body = ''): Answer => ({ kind: 'status', status: code, headers, body });
export const network = (message = 'connect ECONNREFUSED 10.0.0.1:443'): Answer => ({ kind: 'network', message });
export const hang = (text?: string): Answer => ({ kind: 'hang', ...(text !== undefined ? { text } : {}) });

/** A `fetch` that plays answers and keeps every call. */
export class FakeFetch {
  readonly calls: Call[] = [];
  readonly fetch: typeof fetch;

  constructor(private readonly answer: (call: Call, index: number) => Answer | Promise<Answer>) {
    this.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      let json: Record<string, unknown> = {};
      try {
        json = JSON.parse(bodyText) as Record<string, unknown>;
      } catch {
        // not JSON: the test will see an empty object
      }
      const call: Call = { url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, method: init?.method ?? 'GET', headers, bodyText, json, model: String(json['model'] ?? ''), signal: init?.signal ?? undefined };
      const index = this.calls.length;
      this.calls.push(call);
      const a = await this.answer(call, index);
      return respond(a, call.signal);
    }) as typeof fetch;
  }

  /** The models asked, in order. */
  get models(): string[] {
    return this.calls.map((c) => c.model);
  }
}

function respond(a: Answer, signal: AbortSignal | undefined): Response {
  if (a.kind === 'network') throw new TypeError(a.message);
  if (a.kind === 'status') return new Response(a.body ?? '', { status: a.status, headers: a.headers ?? {} });
  if (a.kind === 'sse') return new Response(bodyOf(a.text, a.pieceSize), { status: a.status ?? 200, headers: { 'content-type': 'text/event-stream', ...(a.headers ?? {}) } });
  if (a.kind === 'stream') return new Response(a.body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const c = controlled();
  if (a.text !== undefined) c.push(a.text);
  const stop = (): void => c.fail(new DOMException('aborted', 'AbortError'));
  if (signal?.aborted === true) stop();
  else signal?.addEventListener('abort', stop, { once: true });
  return new Response(c.body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** A minimal chat request for the provider tests. */
export function chatRequest(over: Partial<ChatRequest> = {}): ChatRequest {
  return { system: 'SYSTEM TEXT', messages: [{ role: 'user', content: 'draw a circle' }], tools: [], ...over };
}

/** The text of every `text` event, joined. */
export const textOf = (events: readonly ChatEvent[]): string => events.map((e) => ('text' in e ? e.text : '')).join('');

/** The last event of a chat stream. */
export const lastOf = (events: readonly ChatEvent[]): ChatEvent | undefined => events[events.length - 1];

/** Sleeps `ms` real milliseconds. */
export const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
