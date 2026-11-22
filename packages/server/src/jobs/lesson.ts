/**
 * `POST /v1/lesson/start`, `/v1/lesson/turn` and `/v1/lesson/end` (docs/features/lesson/design.md 7, errors.md): a lesson
 * that is a conversation the server keeps in memory (`lessons/store.ts`, docs/state-machines.md LE1).
 *
 * - `/start` takes `{ topic?, mode?, board }` and answers `200` `{ lessonId }` (a random id). `lesson_full` (503) when 100
 *   lessons run turns and none can end.
 * - `/turn` takes `{ lessonId, text, board }` and streams NDJSON as `/v1/teach` does: `{ say }` whole sentences, `{ actions }`,
 *   `{ lesson: { plan, step, state } }`, then `{ done: true, ended?, notices? }` or `{ error }`. `lesson_unknown` (404) and
 *   `lesson_busy` (409) are checks, so they answer with an HTTP status; every error after the stream opens is its last event.
 *   A turn from the client whose turn still runs replaces it (the older ends with `superseded`); from another client it is
 *   `lesson_busy`.
 * - `/end` takes `{ lessonId }` and answers `200` `{ ok: true }`; the lesson is forgotten at once and a turn of it that still
 *   runs is stopped. `lesson_unknown` (404) when it is not held.
 *
 * The client sends only the learner's words and the board in view; what the teacher said before is the server's own
 * (TR-9, TR-38).
 */
import { MODES, MODE_IDS } from '@incantly/modes';
import { lessonTurn as teachLesson } from '@incantly/teacher';
import type { BoardRequestData } from '@incantly/teacher';
import { badRequest, fromStreamError, modelUnavailable, superseded as supersededError, tooLarge, turnLimitFromStream, lessonUnknown } from '../errors';
import type { ServerError } from '../errors';
import type { Context } from './context';
import { TURN_MS, jobSignal, meteredClient } from './model';
import { TEACH_TEXT_CHARS, readBoard } from './teach';

/** The longest lesson id the server reads (a UUID is 36 characters). */
const ID_CHARS = 100;
/** What `/start` and `/end` count in the client's minute: they make no model call. */
const START_WEIGHT = 1;
const END_WEIGHT = 0.1;

const failed = (v: unknown): v is ServerError => typeof v === 'object' && v !== null && (v as { ok?: unknown }).ok === false;

export interface LessonStartRequest {
  readonly topic: string;
  readonly mode: keyof typeof MODES;
  readonly board: BoardRequestData;
}

export interface LessonTurnRequest {
  readonly lessonId: string;
  readonly text: string;
  readonly board: BoardRequestData;
}

function readId(body: Record<string, unknown>): string | ServerError {
  const id = body['lessonId'];
  if (typeof id !== 'string' || id === '' || id.length > ID_CHARS) return badRequest('"lessonId" must be the id that /v1/lesson/start gave.');
  return id;
}

function readLessonBoard(raw: unknown): BoardRequestData | ServerError {
  if (raw === undefined || raw === null) return badRequest('"board" must be { items, more?, page }: the board in view.');
  const board = readBoard(raw);
  return board === undefined ? badRequest('"board" must be { items, more?, page }: the board in view.') : board;
}

/** The `/v1/lesson/start` request, checked field by field, or the error that names the field. */
export function readLessonStart(body: Record<string, unknown>): LessonStartRequest | ServerError {
  const topic = body['topic'] ?? '';
  if (typeof topic !== 'string') return badRequest('"topic" must be text.');
  if (topic.length > TEACH_TEXT_CHARS) return tooLarge('"topic"', TEACH_TEXT_CHARS);
  const mode = body['mode'] ?? 'graphing';
  if (typeof mode !== 'string' || !Object.hasOwn(MODES, mode)) return badRequest('"mode" is not a mode of the app.', `The modes are: ${MODE_IDS.join(', ')}.`);
  const board = readLessonBoard(body['board']);
  if (failed(board)) return board;
  return { topic, mode: mode as keyof typeof MODES, board };
}

/** The `/v1/lesson/turn` request, checked field by field, or the error that names the field. */
export function readLessonTurn(body: Record<string, unknown>): LessonTurnRequest | ServerError {
  const lessonId = readId(body);
  if (failed(lessonId)) return lessonId;
  const text = body['text'];
  if (typeof text !== 'string' || text.trim() === '') return badRequest('"text" must be what the learner said.');
  if (text.length > TEACH_TEXT_CHARS) return tooLarge('"text"', TEACH_TEXT_CHARS);
  const board = readLessonBoard(body['board']);
  if (failed(board)) return board;
  return { lessonId, text, board };
}

export function lessonStart(ctx: Context): void {
  const { job } = ctx;
  const read = readLessonStart(ctx.body);
  if (failed(read)) return job.refuse(read);
  const slot = ctx.limiter.acquire(ctx.clientId, { weight: START_WEIGHT });
  if (!slot.ok) return job.refuse(slot);
  const lesson = ctx.lessons.start(read.topic, read.mode);
  if (failed(lesson)) return job.refuse(lesson);
  if (!job.checked()) return;
  ctx.log('lesson.start', { mode: read.mode });
  job.json(200, { lessonId: lesson.id });
}

export function lessonEnd(ctx: Context): void {
  const { job } = ctx;
  const id = readId(ctx.body);
  if (failed(id)) return job.refuse(id);
  const slot = ctx.limiter.acquire(ctx.clientId, { weight: END_WEIGHT });
  if (!slot.ok) return job.refuse(slot);
  const ended = ctx.lessons.end(id);
  if (ended !== true) return job.refuse(ended);
  if (!job.checked()) return;
  ctx.log('lesson.end', { by: 'client' });
  job.json(200, { ok: true });
}

export async function lessonTurn(ctx: Context): Promise<void> {
  const { job } = ctx;
  const read = readLessonTurn(ctx.body);
  if (failed(read)) return job.refuse(read);
  const client = ctx.client;
  if (client === undefined) return job.refuse(modelUnavailable());
  const budget = ctx.limiter.checkDailyBudget();
  if (!budget.ok) return job.refuse(budget);
  const found = ctx.lessons.check(read.lessonId, ctx.clientId);
  if (failed(found)) return job.refuse(found);
  const superseded = new AbortController();
  const slot = ctx.limiter.acquire(ctx.clientId, { exclusive: true, controller: superseded });
  if (!slot.ok) return job.refuse(slot);
  // the lesson is read again by `begin`, in the same step as the slot: nothing awaits between the check and the turn's start
  const lesson = found;
  const turn = ctx.lessons.begin(lesson, ctx.clientId, () => superseded.abort());
  if (typeof turn !== 'number') {
    slot.release();
    return job.refuse(turn);
  }
  try {
    // the checks passed: from here the answer is a stream and every error is its last event (errors.md)
    if (!job.open()) return;
    const signal = jobSignal(job.abort.signal, superseded.signal);
    const events = teachLesson({
      client: meteredClient(client, ctx.limiter),
      memory: lesson.memory,
      board: read.board,
      text: read.text,
      mode: lesson.mode,
      signal,
      now: ctx.now,
      limits: { ms: TURN_MS },
      onFault: (e) => ctx.log('internal', { fingerprint: e.fingerprint, message: e.message }),
    });
    for await (const ev of events) {
      if (superseded.signal.aborted) {
        // a newer turn replaced this one, or the lesson ended: what the client applied stays, and it is told
        job.fail(lesson.state === 'ended' ? lessonUnknown() : supersededError());
        break;
      }
      if ('say' in ev) {
        job.event({ say: ev.say });
      } else if ('actions' in ev) {
        job.event({ actions: ev.actions });
      } else if ('lesson' in ev) {
        lesson.planned(turn);
        job.event({ lesson: { plan: ev.lesson.plan, step: ev.lesson.step, state: lesson.state } });
      } else if ('done' in ev) {
        // the lesson waits (or ends) before the client reads `done`, so its next turn finds it ready
        const finished = ctx.lessons.finish(lesson, turn, ev.ended === true);
        job.event({ done: true, ...(ev.notices !== undefined && ev.notices.length > 0 ? { notices: ev.notices } : {}), ...(finished.ended ? { ended: true } : {}) });
        job.end();
      } else if ('error' in ev) {
        const error = ev.error.kind === 'turn_limit' ? turnLimitFromStream(ev.error) : fromStreamError(ev.error);
        ctx.log('lesson.error', { kind: error.kind });
        job.fail(error);
      }
      // `lines` and `control` have no place in a lesson: the job offers no tool that sends them
    }
  } finally {
    // a turn that ended without `done` (an error, a closed connection) leaves the lesson waiting; a turn that was replaced changes nothing
    ctx.lessons.finish(lesson, turn, false);
    slot.release();
  }
}
