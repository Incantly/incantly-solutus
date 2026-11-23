/**
 * Helpers of the round-4 server specs (`POST /v1/teach`, `POST /v1/speech`): a server on 127.0.0.1 with the OpenRouter chat
 * client in front of a fake `fetch` and the OpenRouter voices in front of a second fake `fetch` that answers audio. Nothing
 * reaches the network. Public exports only.
 */
import { request as httpRequest } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { afterEach, vi } from 'vitest';
import { clientFor, createLog, openRouterSpeech } from '../../src/index';
import type { EnvLike, LogFn, SpeechClient } from '../../src/index';
import { SECRET_KEY, makeClock, settingsOf, start } from './helpers';
import type { Running } from './helpers';
import { FakeFetch, controlled, finishChunk, ok, sseOf, textChunk, toolChunk, usageChunk } from './r2-helpers';
import type { Answer, Call } from './r2-helpers';
import { calls, says } from './board-helpers';

const running: Running[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (running.length > 0) await running.pop()?.close();
});

// ---- the fake voice network -----------------------------------------------------------------------------------------------

/** What the fake voice network answers a speech call with. */
export type VoiceAnswer =
  /** The whole audio at once, in `pieces` (one piece by default), as `type`. */
  | { readonly kind: 'audio'; readonly bytes: Uint8Array; readonly type?: string; readonly headers?: Readonly<Record<string, string>>; readonly pieces?: number }
  /** The test feeds the body by hand (a `controlled()` body), so it can look at what the client got between two chunks. */
  | { readonly kind: 'live'; readonly body: ReadableStream<Uint8Array>; readonly type?: string; readonly headers?: Readonly<Record<string, string>> }
  | { readonly kind: 'status'; readonly status: number; readonly headers?: Readonly<Record<string, string>>; readonly body?: string }
  | { readonly kind: 'network' }
  /** Never answers; the call ends when its signal fires. */
  | { readonly kind: 'hang' }
  /** Answers `200` with the head at once and then sends no byte until the signal fires. */
  | { readonly kind: 'silent'; readonly type?: string }
  /** Answers `200` with a body that ends at once with no byte. */
  | { readonly kind: 'empty' };

export const audio = (bytes: number[] | Uint8Array, over: { type?: string; headers?: Record<string, string>; pieces?: number } = {}): VoiceAnswer => ({
  kind: 'audio',
  bytes: bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes),
  ...(over.type !== undefined ? { type: over.type } : {}),
  ...(over.headers !== undefined ? { headers: over.headers } : {}),
  ...(over.pieces !== undefined ? { pieces: over.pieces } : {}),
});
export const vStatus = (status: number, headers: Record<string, string> = {}, body = ''): VoiceAnswer => ({ kind: 'status', status, headers, body });
export const vNetwork = (): VoiceAnswer => ({ kind: 'network' });
export const vHang = (): VoiceAnswer => ({ kind: 'hang' });
export const vSilent = (type = 'audio/mpeg'): VoiceAnswer => ({ kind: 'silent', type });
export const vEmpty = (): VoiceAnswer => ({ kind: 'empty' });

/** One speech call as the fake network sees it. */
export interface VoiceCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyText: string;
  readonly json: Record<string, unknown>;
  readonly model: string;
  readonly signal: AbortSignal | undefined;
}

/** The MP3 bytes the tests use (the first bytes of an MP3 frame header; the server never decodes them). */
export const MP3 = Uint8Array.from([0xff, 0xfb, 0x90, 0x44, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55]);
/** 16-bit little-endian PCM, four samples. */
export const PCM = Uint8Array.from([0x00, 0x00, 0x10, 0x20, 0xf0, 0xdf, 0x00, 0x00]);

export class FakeVoice {
  readonly calls: VoiceCall[] = [];
  readonly fetch: typeof fetch;

  constructor(private readonly answer: (call: VoiceCall, index: number) => VoiceAnswer | Promise<VoiceAnswer>) {
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
        // not JSON: the test sees an empty object
      }
      const call: VoiceCall = { url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, method: init?.method ?? 'GET', headers, bodyText, json, model: String(json['model'] ?? ''), signal: init?.signal ?? undefined };
      const index = this.calls.length;
      this.calls.push(call);
      const planned = await this.answer(call, index);
      if (planned.kind === 'hang') {
        // a fetch that stays pending until its signal fires, then rejects, as `fetch` does
        return new Promise<Response>((_resolve, reject) => {
          if (call.signal?.aborted === true) reject(aborted());
          else call.signal?.addEventListener('abort', () => reject(aborted()), { once: true });
        });
      }
      return respondVoice(planned, call.signal);
    }) as typeof fetch;
  }

  get models(): string[] {
    return this.calls.map((c) => c.model);
  }
}

const aborted = (): DOMException => new DOMException('aborted', 'AbortError');

function respondVoice(a: VoiceAnswer, signal: AbortSignal | undefined): Response {
  switch (a.kind) {
    case 'network':
      throw new TypeError('connect ECONNREFUSED 10.0.0.1:443');
    case 'status':
      return new Response(a.body ?? '', { status: a.status, headers: a.headers ?? {} });
    case 'audio': {
      const n = Math.max(1, a.pieces ?? 1);
      const size = Math.ceil(a.bytes.length / n);
      let at = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(c) {
          if (at >= a.bytes.length) return c.close();
          c.enqueue(a.bytes.slice(at, at + size));
          at += size;
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': a.type ?? 'audio/mpeg', ...(a.headers ?? {}) } });
    }
    case 'live':
      return new Response(a.body, { status: 200, headers: { 'content-type': a.type ?? 'audio/mpeg', ...(a.headers ?? {}) } });
    case 'empty':
      return new Response(new ReadableStream<Uint8Array>({ start: (c) => c.close() }), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    case 'silent': {
      const c = controlled();
      const stop = (): void => c.fail(aborted());
      if (signal?.aborted === true) stop();
      else signal?.addEventListener('abort', stop, { once: true });
      return new Response(c.body, { status: 200, headers: { 'content-type': a.type ?? 'audio/mpeg' } });
    }
    case 'hang':
      throw new Error('a hang is answered by FakeVoice.fetch');
  }
}

// ---- the server --------------------------------------------------------------------------------------------------------

export interface Boot4 {
  readonly run: Running;
  /** The chat network (`/v1/teach`). */
  readonly fake: FakeFetch;
  /** The voice network (`/v1/speech`). */
  readonly voice: FakeVoice;
  readonly clock: ReturnType<typeof makeClock>;
  readonly logs: string[];
  readonly url: string;
  readonly speech: SpeechClient | undefined;
}

export interface BootOptions {
  readonly env?: EnvLike;
  readonly answers?: (call: Call, index: number) => Answer | Promise<Answer>;
  readonly voices?: (call: VoiceCall, index: number) => VoiceAnswer | Promise<VoiceAnswer>;
  /** No key at all: no chat client and no voices. */
  readonly key?: boolean;
  readonly clock?: ReturnType<typeof makeClock>;
  /** The time the voices wait for a first byte before they pass the call on (default 80 ms; the server's own is 15 s). */
  readonly firstByteMs?: number;
}

export async function bootVoice(options: BootOptions = {}): Promise<Boot4> {
  const env: EnvLike = { ...(options.key === false ? {} : { OPENROUTER_API_KEY: SECRET_KEY }), ...(options.env ?? {}) };
  const settings = settingsOf(env);
  const fake = new FakeFetch(options.answers ?? (() => says('ok')));
  const clock = options.clock ?? makeClock();
  const answers = options.voices ?? (() => audio(MP3));
  const voice = new FakeVoice(answers);
  const client = clientFor(settings, { fetch: fake.fetch, now: clock.now });
  const speech: SpeechClient | undefined =
    options.key === false
      ? undefined
      : openRouterSpeech({ apiKey: settings.secrets.openrouter, models: settings.speechModels, voice: settings.speechVoice, fetch: voice.fetch, now: clock.now, firstByteMs: options.firstByteMs ?? 80 });
  const logs: string[] = [];
  const log: LogFn = createLog({ write: (s) => logs.push(s) }, clock.now);
  const run = await start(env, { ...(client !== undefined ? { client } : {}), ...(speech !== undefined ? { speech } : {}), log, now: clock.now });
  running.push(run);
  return { run, fake, voice, clock, logs, url: `http://127.0.0.1:${run.port}`, speech };
}

// ---- model replies for the live lesson -----------------------------------------------------------------------------------

/** A model reply with text and tool calls in one answer (a sentence and the lines it shows), as a stream sends it. */
export function textAndCalls(text: string, tools: readonly { readonly name: string; readonly args: unknown }[] = [], pieceSize = 7): Answer {
  const chunks: unknown[] = [];
  for (let i = 0; i < text.length; i += pieceSize) chunks.push(textChunk(text.slice(i, i + pieceSize)));
  tools.forEach((t, index) => {
    const json = JSON.stringify(t.args);
    const cut = Math.max(1, Math.floor(json.length / 2));
    chunks.push(toolChunk(index, { id: `call_${index + 1}`, name: t.name, arguments: '' }), toolChunk(index, { arguments: json.slice(0, cut) }), toolChunk(index, { arguments: json.slice(cut) }));
  });
  chunks.push(finishChunk(tools.length > 0 ? 'tool_calls' : 'stop'), usageChunk(20, 10));
  return ok(sseOf(chunks));
}

/** A recorded reply of a lesson fixture as the stream a model sends. */
export function replyAsAnswer(reply: { text?: string; pieces?: readonly string[]; toolCalls?: readonly { name: string; args: unknown }[] }): Answer {
  const text = reply.pieces !== undefined ? reply.pieces.join('') : (reply.text ?? '');
  const chunks: unknown[] = [];
  for (const piece of reply.pieces ?? (text === '' ? [] : [text])) chunks.push(textChunk(piece));
  (reply.toolCalls ?? []).forEach((t, index) => {
    const json = typeof t.args === 'string' ? t.args : JSON.stringify(t.args);
    const cut = Math.max(1, Math.floor(json.length / 2));
    chunks.push(toolChunk(index, { id: `call_${index + 1}`, name: t.name, arguments: '' }), toolChunk(index, { arguments: json.slice(0, cut) }), toolChunk(index, { arguments: json.slice(cut) }));
  });
  chunks.push(finishChunk((reply.toolCalls ?? []).length > 0 ? 'tool_calls' : 'stop'), usageChunk(20, 10));
  return ok(sseOf(chunks));
}

export { calls, says };

// ---- reading answers ---------------------------------------------------------------------------------------------------

export interface Teaching {
  readonly status: number;
  readonly headers: IncomingMessage['headers'];
  readonly text: string;
  /** The NDJSON lines, parsed. */
  readonly events: Record<string, unknown>[];
}

/** One `POST /v1/teach`, read to its end. */
export async function teach(b: Pick<Boot4, 'run'>, body: unknown, headers: Record<string, string> = {}): Promise<Teaching> {
  const raw = await rawRequest(b.run.port, '/v1/teach', typeof body === 'string' ? body : JSON.stringify(body), { 'content-type': 'application/json', ...headers });
  const text = Buffer.concat(raw.chunks).toString('utf8');
  const events = text.split('\n').filter((l) => l !== '').flatMap((l) => {
    try {
      return [JSON.parse(l) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
  return { status: raw.status, headers: raw.headers, text, events };
}

export const teachBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ text: 'Take a circle of radius two.', mode: 'geometry', script: '', t: 0, board: null, history: [], ...over });

export interface Raw {
  readonly status: number;
  readonly headers: IncomingMessage['headers'];
  readonly chunks: Buffer[];
}

/** One POST, the whole answer as the chunks that came, in order (the body may be audio). */
export function rawRequest(port: number, path: string, body: string | Buffer, headers: Record<string, string> = {}): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const bytes = Buffer.from(body);
    const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', path, headers: { ...headers, 'content-length': String(bytes.length) }, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      const done = (): void => resolve({ status: res.statusCode ?? 0, headers: res.headers, chunks });
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', done);
      res.on('error', done);
      res.on('close', done);
    });
    req.on('error', (e) => {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ECONNRESET' || code === 'EPIPE') return resolve({ status: 0, headers: {}, chunks: [] });
      reject(e);
    });
    req.end(bytes);
  });
}

export interface Live {
  readonly status: number;
  readonly headers: IncomingMessage['headers'];
  /** Bytes read so far. */
  received(): Buffer;
  /** Resolves when at least `n` bytes have arrived (false after `ms`). */
  waitFor(n: number, ms?: number): Promise<boolean>;
  /** True once the response ended or the connection closed. */
  ended(): boolean;
  /** Resolves when the response ended (false after `ms`). */
  waitEnd(ms?: number): Promise<boolean>;
  destroy(): void;
}

/** One POST whose answer is read as it comes, for audio that must be seen before it is whole. */
export function openLive(port: number, path: string, body: string, headers: Record<string, string> = { 'content-type': 'application/json' }): Promise<Live> {
  return new Promise((resolve, reject) => {
    const bytes = Buffer.from(body);
    const box = { chunks: [] as Buffer[], finished: false, wake: undefined as (() => void) | undefined };
    const wake = (): void => {
      const w = box.wake;
      box.wake = undefined;
      w?.();
    };
    const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', path, headers: { ...headers, 'content-length': String(bytes.length) }, agent: false }, (res) => {
      res.on('data', (c: Buffer) => {
        box.chunks.push(c);
        wake();
      });
      const finish = (): void => {
        box.finished = true;
        wake();
      };
      res.on('end', finish);
      res.on('close', finish);
      res.on('error', finish);
      const size = (): number => box.chunks.reduce((n, c) => n + c.length, 0);
      resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        received: () => Buffer.concat(box.chunks),
        async waitFor(n, ms = 1500) {
          const deadline = Date.now() + ms;
          while (size() < n) {
            if (box.finished) return size() >= n;
            const left = deadline - Date.now();
            if (left <= 0) return false;
            await new Promise<void>((r) => {
              box.wake = r;
              setTimeout(r, left);
            });
          }
          return true;
        },
        ended: () => box.finished,
        async waitEnd(ms = 1500) {
          const deadline = Date.now() + ms;
          while (!box.finished) {
            const left = deadline - Date.now();
            if (left <= 0) return false;
            await new Promise<void>((r) => {
              box.wake = r;
              setTimeout(r, left);
            });
          }
          return true;
        },
        destroy: () => req.destroy(),
      });
    });
    req.on('error', (e) => {
      if ((e as NodeJS.ErrnoException).code === 'ECONNRESET') return;
      reject(e);
    });
    req.end(bytes);
  });
}

/** The tool names of a chat call. */
export const toolNames = (call: Call): string[] => ((call.json['tools'] ?? []) as { function: { name: string } }[]).map((t) => t.function.name);

/** The text of every tool result of a chat call. */
export const toolResults = (call: Call): string[] => ((call.json['messages'] ?? []) as { role: string; content: string }[]).filter((m) => m.role === 'tool').map((m) => m.content);

/** The messages of a chat call. */
export const messagesOf = (call: Call): { role: string; content: string }[] => (call.json['messages'] ?? []) as { role: string; content: string }[];
