/**
 * Helpers of the round-3 server specs (`POST /v1/board/ask`): a server on 127.0.0.1 with the OpenRouter client in front of
 * a fake `fetch` (no network), the board's own `httpAgentTransport` as the client, tool-call replies as the model sends
 * them, and small valid pictures. Public exports only.
 */
import { afterEach, vi } from 'vitest';
import { httpAgentTransport } from '@incantly/board';
import type { BoardAgentEvent, BoardAgentRequest } from '@incantly/board';
import { clientFor, createLog } from '../../src/index';
import type { EnvLike, LogFn } from '../../src/index';
import { SECRET_KEY, makeClock, postJson, settingsOf, start } from './helpers';
import type { Reply, Running } from './helpers';
import type { Answer, Call } from './r2-helpers';
import { FakeFetch, collect, finishChunk, ok, sseOf, textChunk, textSse, toolChunk, usageChunk } from './r2-helpers';

const running: Running[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (running.length > 0) await running.pop()?.close();
});

export interface Boot {
  readonly run: Running;
  readonly fake: FakeFetch;
  readonly clock: ReturnType<typeof makeClock>;
  readonly logs: string[];
  readonly url: string;
}

/** A server whose model client is OpenRouter's in front of `FakeFetch`. Without a key there is no client at all. */
export async function boot(options: { env?: EnvLike; answers?: (call: Call, index: number) => Answer | Promise<Answer>; key?: boolean; clock?: ReturnType<typeof makeClock> } = {}): Promise<Boot> {
  const env: EnvLike = { ...(options.key === false ? {} : { OPENROUTER_API_KEY: SECRET_KEY }), ...(options.env ?? {}) };
  const settings = settingsOf(env);
  const fake = new FakeFetch(options.answers ?? (() => says('ok')));
  const clock = options.clock ?? makeClock();
  const client = clientFor(settings, { fetch: fake.fetch, now: clock.now });
  const logs: string[] = [];
  const log: LogFn = createLog({ write: (s) => logs.push(s) }, clock.now);
  const run = await start(env, { ...(client !== undefined ? { client } : {}), log, now: clock.now });
  running.push(run);
  return { run, fake, clock, logs, url: `http://127.0.0.1:${run.port}` };
}

/** A model reply that is only text. */
export const says = (text: string): Answer => ok(textSse([text]));

/** A model reply that calls one tool with `args` (the arguments come in two pieces, as a real stream sends them). */
export function calls(name: string, args: unknown, id = 'call_1'): Answer {
  const json = JSON.stringify(args);
  const cut = Math.max(1, Math.floor(json.length / 2));
  return ok(sseOf([toolChunk(0, { id, name, arguments: '' }), toolChunk(0, { arguments: json.slice(0, cut) }), toolChunk(0, { arguments: json.slice(cut) }), finishChunk('tool_calls'), usageChunk(20, 10)]));
}

/** The model answers call number i with `answers[i]` (the last one for later calls). */
export const sequence =
  (...answers: Answer[]) =>
  (_call: Call, i: number): Answer =>
    answers[Math.min(i, answers.length - 1)] as Answer;

/** The model calls `board` once with `actions`, then says it is done. */
export const boardOnce = (actions: readonly unknown[]): ReturnType<typeof sequence> => sequence(calls('board', { actions }), says('Done.'));

/** A reply whose stream stops with no finish and no [DONE]: a cut answer. */
export const cut = (): Answer => ok(sseOf([textChunk('half of an answ')], 'none'));

export const circle = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'circle',
  choice: 'graph',
  items: [{ id: 'shape:a1', kind: 'ink', shape: 'curve', box: [120, 40, 300, 180] }],
  more: 0,
  circle: [100, 20, 340, 220],
  page: 'page:1',
  ...over,
});

export const talk = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'talk',
  text: 'Write the formula under the triangle',
  items: [{ id: 'shape:t1', kind: 'triangle', box: [0, 0, 100, 80] }],
  more: 0,
  page: 'page:1',
  allowEdit: false,
  ...over,
});

export const FIGURE = { op: 'figure', lines: ['f(x) = (x - 1)^2 - 2'], mode: 'graphing', at: { near: 'shape:a1', side: 'right' } };
export const ARROW = { op: 'arrow', from: 'shape:a1', to: '$last' };

/** The board's own transport, as the browser uses it, aimed at this server. */
export async function events(b: Boot, request: Record<string, unknown>, signal: AbortSignal = new AbortController().signal): Promise<BoardAgentEvent[]> {
  return collect(httpAgentTransport(b.url)(request as unknown as BoardAgentRequest, signal));
}

export const actionsIn = (evs: readonly BoardAgentEvent[]): Record<string, unknown>[] => evs.flatMap((e) => ('actions' in e ? (e.actions as Record<string, unknown>[]) : []));
export const errorIn = (evs: readonly BoardAgentEvent[]): { kind: string; message: string } | undefined => evs.flatMap((e) => ('error' in e ? [e.error] : []))[0];

/** Posts a request and returns the NDJSON lines parsed. */
export async function post(b: Boot, request: unknown): Promise<{ reply: Reply; lines: Record<string, unknown>[] }> {
  const reply = await postJson(b.run.port, '/v1/board/ask', request);
  const lines = reply.text.split('\n').filter((l) => l !== '').flatMap((l) => {
    try {
      return [JSON.parse(l) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
  return { reply, lines };
}

/** The text of every user message of a model call, and of its image parts, as one string. */
export function userTextOf(call: Call): string {
  const messages = (call.json['messages'] ?? []) as { role: string; content: unknown }[];
  return messages
    .filter((m) => m.role === 'user')
    .map((m) => (typeof m.content === 'string' ? m.content : (m.content as { type: string; text?: string }[]).map((p) => (p.type === 'text' ? (p.text ?? '') : '')).join('\n')))
    .join('\n');
}

export const toolNamesOf = (call: Call): string[] => ((call.json['tools'] ?? []) as { function: { name: string } }[]).map((t) => t.function.name);

export const toolResultsOf = (call: Call): string[] => ((call.json['messages'] ?? []) as { role: string; content: string }[]).filter((m) => m.role === 'tool').map((m) => m.content);

export const systemOf = (call: Call): string => (((call.json['messages'] ?? []) as { role: string; content: string }[]).find((m) => m.role === 'system')?.content ?? '');

// ---- pictures ---------------------------------------------------------------------------------------------------------

/** A PNG of `width` by `height` pixels: the signature and the header chunk, padded with zeros to `size` bytes. */
export function png(width = 8, height = 8, size = 64): Uint8Array {
  const b = Buffer.alloc(Math.max(size, 33));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b[24] = 8;
  b[25] = 2;
  return b;
}

/** A JPEG header with a start-of-frame marker for `width` by `height`. */
export function jpeg(width = 8, height = 8): Uint8Array {
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  return Buffer.from([0xff, 0xd8, ...sof, 0xff, 0xd9, 0, 0, 0, 0]);
}

export const dataUrl = (bytes: Uint8Array, mime = 'image/png'): string => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
export const PNG_8 = dataUrl(png());
