/**
 * The studio's client of the lesson routes (lesson design 7, server errors.md): `POST /v1/lesson/start` and `/end` answer one
 * JSON body, `POST /v1/lesson/turn` answers NDJSON, as `/v1/teach` does (`teach-client.ts`). The browser holds only the
 * lesson's id; what the teacher said before is the server's (design 4). An HTTP error (a check failed: `lesson_unknown`,
 * `lesson_busy`, `lesson_full`, no key) is read as the server's error body, and on a turn it is given as one `error` event, so
 * a caller reads one kind of event stream. A network failure is an `error` event too; an aborted request ends quietly.
 * Nothing throws. No UI yet: the conversation (`lesson.ts`) is round 2.
 */

/** The board in view, as the server's `{ items, more, page }`. */
export interface LessonBoard {
  readonly items: readonly unknown[];
  readonly more: number;
  readonly page: string;
}

export interface LessonStartRequest {
  readonly topic?: string;
  /** The app mode the board's figure cards use; the server's default is `graphing`. */
  readonly mode?: string;
  readonly board: LessonBoard;
}

export interface LessonTurnRequest {
  readonly lessonId: string;
  /** What the learner said or typed. */
  readonly text: string;
  readonly board: LessonBoard;
}

/** The plan, the step now (1 based, 0 with no plan) and what the lesson is doing (`planning`, `teaching`). */
export interface LessonView {
  readonly plan: readonly string[];
  readonly step: number;
  readonly state: string;
}

export interface LessonError {
  readonly kind: string;
  readonly message: string;
}

export type LessonEvent =
  | { readonly say: string }
  | { readonly actions: readonly unknown[] }
  | { readonly lesson: LessonView }
  /** `ended` is true when this turn ended the lesson (the learner stopped it, or it reached its last turn). */
  | { readonly done: true; readonly ended?: true }
  | { readonly error: LessonError };

/** The answer of `start` and `end`: the id, or the server's error. */
export type LessonStarted = { readonly ok: true; readonly lessonId: string } | ({ readonly ok: false } & LessonError);
export type LessonEnded = { readonly ok: true } | ({ readonly ok: false } & LessonError);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One line of a turn's answer as an event, or undefined when it is not one. */
export function parseLessonEvent(line: string): LessonEvent | undefined {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isObject(v)) return undefined;
  if (typeof v['say'] === 'string') return { say: v['say'] };
  if (Array.isArray(v['actions'])) return { actions: v['actions'] };
  const l = v['lesson'];
  if (isObject(l) && Array.isArray(l['plan']) && l['plan'].every((s) => typeof s === 'string') && typeof l['step'] === 'number' && Number.isFinite(l['step']) && typeof l['state'] === 'string') {
    return { lesson: { plan: l['plan'] as string[], step: l['step'], state: l['state'] } };
  }
  if (v['done'] === true) return v['ended'] === true ? { done: true, ended: true } : { done: true };
  const e = v['error'];
  if (isObject(e) && typeof e['message'] === 'string') return { error: { kind: typeof e['kind'] === 'string' ? e['kind'] : 'error', message: e['message'] } };
  return undefined;
}

const badStream = (): LessonEvent => ({ error: { kind: 'bad_stream', message: 'The server sent an answer that is not a lesson.' } });

/** The error of an answer that is not `200`: the server's own `kind` and `message`, else `http_<status>`. */
async function failedAnswer(res: Response): Promise<LessonError> {
  try {
    const body: unknown = JSON.parse(await res.text());
    if (isObject(body) && body['ok'] === false && typeof body['kind'] === 'string' && typeof body['message'] === 'string') return { kind: body['kind'], message: body['message'] };
  } catch {
    // not JSON: the status says it
  }
  return { kind: `http_${res.status}`, message: `The server answered ${res.status}.` };
}

type FetchFn = typeof fetch;
const browserFetch: FetchFn = (input, init) => fetch(input, init);

const JSON_HEADERS = { 'content-type': 'application/json' };

/** One JSON request to a lesson route: the parsed body of a `200`, or the error (the server's, or `unreachable` or `aborted`). */
async function postJson(path: string, body: unknown, signal: AbortSignal | undefined, fetchImpl: FetchFn): Promise<{ readonly ok: true; readonly body: Record<string, unknown> } | ({ readonly ok: false } & LessonError)> {
  let res: Response;
  try {
    res = await fetchImpl(path, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body), ...(signal !== undefined ? { signal } : {}) });
  } catch {
    return signal?.aborted === true ? { ok: false, kind: 'aborted', message: 'The request was stopped.' } : { ok: false, kind: 'unreachable', message: 'The teacher could not be reached.' };
  }
  if (!res.ok) return { ok: false, ...(await failedAnswer(res)) };
  try {
    const parsed: unknown = JSON.parse(await res.text());
    if (isObject(parsed)) return { ok: true, body: parsed };
  } catch {
    // falls through to the bad answer
  }
  return { ok: false, kind: 'bad_stream', message: 'The server sent an answer that is not a lesson.' };
}

/** Starts a lesson on the server. The answer is the lesson's id, which the browser holds for the board. */
export async function startLesson(request: LessonStartRequest, signal?: AbortSignal, fetchImpl: FetchFn = browserFetch): Promise<LessonStarted> {
  const r = await postJson('/v1/lesson/start', request, signal, fetchImpl);
  if (!r.ok) return r;
  const id = r.body['lessonId'];
  return typeof id === 'string' && id !== '' ? { ok: true, lessonId: id } : { ok: false, kind: 'bad_stream', message: 'The server sent an answer that is not a lesson.' };
}

/** Ends a lesson at once; the server forgets it. `lesson_unknown` means it had already ended. */
export async function endLesson(lessonId: string, signal?: AbortSignal, fetchImpl: FetchFn = browserFetch): Promise<LessonEnded> {
  const r = await postJson('/v1/lesson/end', { lessonId }, signal, fetchImpl);
  return r.ok ? { ok: true } : r;
}

/** The events of one lesson turn. The last one is `done` or `error`, unless the request was aborted (then the stream just ends). */
export async function* streamLessonTurn(request: LessonTurnRequest, signal: AbortSignal, fetchImpl: FetchFn = browserFetch): AsyncGenerator<LessonEvent> {
  let res: Response;
  try {
    res = await fetchImpl('/v1/lesson/turn', {
      method: 'POST',
      headers: { ...JSON_HEADERS, accept: 'application/x-ndjson' },
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
          const ev = parseLessonEvent(text);
          yield ev ?? badStream();
          if (ev === undefined) return;
        }
        nl = buffer.indexOf('\n');
      }
      if (done) break;
    }
    if (buffer.trim() !== '') yield parseLessonEvent(buffer) ?? badStream();
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
