/**
 * The studio's client of `POST /v1/teach` (server design 6, R2.3): one request in, NDJSON events out, as the other model
 * routes. An HTTP error (a check failed, no key) is read as the server's error body and given as one `error` event, so a
 * caller reads one kind of event stream. A network failure is an `error` event too; an aborted request ends quietly.
 * Nothing throws.
 */

/** What the studio sends of the figure (and board) the lesson is on. */
export interface TeachContext {
  readonly mode: string;
  readonly script: string;
  /** The film time, in seconds. */
  readonly t: number;
  /** The board in view, when the lesson is on a board. */
  readonly board?: { readonly items: readonly unknown[]; readonly more: number; readonly page: string };
}

export interface TeachTurn {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export type TeachRequest = TeachContext & { readonly text: string; readonly history: readonly TeachTurn[] };

export type FilmControl = { readonly op: 'pause' | 'resume' | 'seek'; readonly t?: number };

export type TeachEvent =
  | { readonly say: string }
  | { readonly lines: readonly string[] }
  | { readonly actions: readonly unknown[] }
  | { readonly control: FilmControl }
  | { readonly done: true }
  | { readonly error: { readonly kind: string; readonly message: string } };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One line of the answer as an event, or undefined when it is not one. */
export function parseTeachEvent(line: string): TeachEvent | undefined {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isObject(v)) return undefined;
  if (typeof v['say'] === 'string') return { say: v['say'] };
  if (Array.isArray(v['lines']) && v['lines'].every((l) => typeof l === 'string')) return { lines: v['lines'] as string[] };
  if (Array.isArray(v['actions'])) return { actions: v['actions'] };
  const c = v['control'];
  if (isObject(c) && (c['op'] === 'pause' || c['op'] === 'resume' || c['op'] === 'seek')) {
    return { control: { op: c['op'], ...(typeof c['t'] === 'number' && Number.isFinite(c['t']) ? { t: c['t'] } : {}) } };
  }
  if (v['done'] === true) return { done: true };
  const e = v['error'];
  if (isObject(e) && typeof e['message'] === 'string') return { error: { kind: typeof e['kind'] === 'string' ? e['kind'] : 'error', message: e['message'] } };
  return undefined;
}

const badStream = (): TeachEvent => ({ error: { kind: 'bad_stream', message: 'The server sent an answer that is not a lesson.' } });

/** The error of an answer that is not `200`: the server's own `kind` and `message`, else `http_<status>`. */
async function failedAnswer(res: Response): Promise<{ readonly kind: string; readonly message: string }> {
  try {
    const body: unknown = JSON.parse(await res.text());
    if (isObject(body) && body['ok'] === false && typeof body['kind'] === 'string' && typeof body['message'] === 'string') return { kind: body['kind'], message: body['message'] };
  } catch {
    // not JSON: the status says it
  }
  return { kind: `http_${res.status}`, message: `The server answered ${res.status}.` };
}

/** The events of one lesson turn. The last one is `done` or `error`, unless the request was aborted (then the stream just ends). */
export async function* streamTeach(request: TeachRequest, signal: AbortSignal, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): AsyncGenerator<TeachEvent> {
  let res: Response;
  try {
    res = await fetchImpl('/v1/teach', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    if (!signal.aborted) yield { error: { kind: 'unreachable', message: 'The teacher could not be reached.' } };
    return;
  }
  if (!res.ok) {
    yield { error: await failedAnswer(res) };
    return;
  }
  if (res.body === null) {
    yield badStream();
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const text = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (text.trim() !== '') {
          const ev = parseTeachEvent(text);
          yield ev ?? badStream();
          if (ev === undefined) return;
        }
        nl = buffer.indexOf('\n');
      }
      if (done) break;
    }
    if (buffer.trim() !== '') yield parseTeachEvent(buffer) ?? badStream();
  } catch {
    if (!signal.aborted) yield { error: { kind: 'stream_cut', message: 'The answer stopped partway.' } };
  } finally {
    try {
      await reader.cancel();
    } catch {
      // the stream was already closed
    }
  }
}
