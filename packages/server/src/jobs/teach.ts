/**
 * `POST /v1/teach` (docs/features/server/design.md 1, 5, 6; R2.3): the live voice lesson. Request:
 * `{ text, mode?, script?, t?, board?, history? }`: what the learner said, the figure (its mode, script and film time), on a
 * board the board in view (`{ items, more?, page }`), and the last turns (at most 10, 8,000 characters). Answer: NDJSON of
 * `{ say }` (a whole sentence, ready for the voice), `{ lines }`, `{ actions }`, `{ control }`, then `{ done: true, notices? }`
 * or `{ error }`. The teacher's `liveTurn` runs the model against a headless copy of the figure, so every line is checked
 * before it leaves and a failed line never reaches the client. The copy has no clock ticker: a `resume` of the model moves
 * the copy's play state, the client plays its own figure.
 *
 * As the other model routes: a check that fails is an HTTP status, then the answer is `200` and every later error is the
 * stream's last event; a newer request of the same client ends this one with `superseded`.
 */
import { MODES, MODE_IDS } from '@incantly/modes';
import { createHeadlessApp } from '@incantly/sdk';
import type { Ticker } from '@incantly/sdk';
import { liveTurn } from '@incantly/teacher';
import type { BoardRequestData, HistoryItem } from '@incantly/teacher';
import { badRequest, fromStreamError, modelUnavailable, superseded as supersededError, tooLarge, turnLimitFromStream } from '../errors';
import type { ServerError } from '../errors';
import type { Context } from './context';
import { readItems } from './board';
import { SCRIPT_CHARS } from './figure';
import { TURN_MS, jobSignal, meteredClient } from './model';

/** The most characters of what the learner said (design 7: 4,000). */
export const TEACH_TEXT_CHARS = 4000;
/** The history: at most this many turns, and at most this many characters in all (design 6). */
export const HISTORY_TURNS = 10;
export const HISTORY_CHARS = 8000;
/** The film time the request may name, in seconds. */
export const FILM_MAX = 86_400;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const failed = (v: unknown): v is ServerError => isObject(v) && v['ok'] === false;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A clock that never ticks: the copy of the figure on the server is not played, the client's is. */
const NO_TICKS: Ticker = { request: () => 0, cancel: () => undefined };

export interface TeachRequest {
  readonly text: string;
  readonly mode: keyof typeof MODES;
  readonly script: string;
  readonly t: number;
  readonly board?: BoardRequestData;
  readonly history: readonly HistoryItem[];
}

function readHistory(raw: unknown): HistoryItem[] | ServerError {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return badRequest('"history" must be a list of { role, text }.');
  if (raw.length > HISTORY_TURNS) return badRequest(`"history" has ${raw.length} turns; at most ${HISTORY_TURNS}.`);
  const out: HistoryItem[] = [];
  let chars = 0;
  for (let i = 0; i < raw.length; i++) {
    const h: unknown = raw[i];
    if (!isObject(h) || (h['role'] !== 'user' && h['role'] !== 'assistant') || typeof h['text'] !== 'string') return badRequest(`history[${i + 1}] must be { role: "user" | "assistant", text }.`);
    chars += h['text'].length;
    out.push({ role: h['role'], text: h['text'] });
  }
  if (chars > HISTORY_CHARS) return tooLarge('"history"', HISTORY_CHARS);
  return out;
}

function readBoard(raw: unknown): BoardRequestData | undefined | ServerError {
  if (raw === undefined || raw === null) return undefined;
  if (!isObject(raw)) return badRequest('"board" must be { items, more?, page } or null.');
  const items = readItems(raw);
  if (!Array.isArray(items)) return items;
  const more = raw['more'] ?? 0;
  if (!finite(more) || !Number.isInteger(more) || more < 0 || more > 1_000_000) return badRequest('"board.more" must be a whole number, 0 or more.');
  const page = raw['page'];
  if (typeof page !== 'string' || page === '' || page.length > 200) return badRequest('"board.page" must be a page id.');
  return { page, items, more };
}

/** The request, checked field by field, or the error that names the field. */
export function readTeachRequest(body: Record<string, unknown>): TeachRequest | ServerError {
  const text = body['text'];
  if (typeof text !== 'string' || text.trim() === '') return badRequest('"text" must be what the learner said.');
  if (text.length > TEACH_TEXT_CHARS) return tooLarge('"text"', TEACH_TEXT_CHARS);
  const mode = body['mode'] ?? 'graphing';
  if (typeof mode !== 'string' || !Object.hasOwn(MODES, mode)) return badRequest('"mode" is not a mode of the app.', `The modes are: ${MODE_IDS.join(', ')}.`);
  const script = body['script'] ?? '';
  if (typeof script !== 'string') return badRequest('"script" must be text.');
  if (script.length > SCRIPT_CHARS) return badRequest(`"script" has ${script.length} characters; at most ${SCRIPT_CHARS}.`);
  const t = body['t'] ?? 0;
  if (!finite(t) || t < 0 || t > FILM_MAX) return badRequest(`"t" must be the film time in seconds, from 0 to ${FILM_MAX}.`);
  const board = readBoard(body['board']);
  if (failed(board)) return board;
  const history = readHistory(body['history']);
  if (failed(history)) return history;
  return { text, mode: mode as keyof typeof MODES, script, t, ...(board !== undefined ? { board } : {}), history };
}

export async function teach(ctx: Context): Promise<void> {
  const { job, body } = ctx;
  const read = readTeachRequest(body);
  if (failed(read)) return job.refuse(read);
  const client = ctx.client;
  if (client === undefined) return job.refuse(modelUnavailable());
  const budget = ctx.limiter.checkDailyBudget();
  if (!budget.ok) return job.refuse(budget);
  const superseded = new AbortController();
  const slot = ctx.limiter.acquire(ctx.clientId, { exclusive: true, controller: superseded });
  if (!slot.ok) return job.refuse(slot);
  try {
    // the checks passed: from here the answer is a stream and every error is its last event (errors.md)
    if (!job.open()) return;
    const signal = jobSignal(job.abort.signal, superseded.signal);
    const app = createHeadlessApp({ mode: read.mode, ...(read.script !== '' ? { script: read.script } : {}), ticker: NO_TICKS });
    try {
      if (read.t > 0) app.clock.seek(read.t);
      const events = liveTurn({
        client: meteredClient(client, ctx.limiter),
        app,
        ...(read.board !== undefined ? { board: read.board } : {}),
        text: read.text,
        history: read.history,
        signal,
        now: ctx.now,
        limits: { ms: TURN_MS },
        onFault: (e) => ctx.log('internal', { fingerprint: e.fingerprint, message: e.message }),
      });
      for await (const ev of events) {
        if (superseded.signal.aborted) {
          // a newer request of this client replaced this one: what the client applied stays, and it is told
          job.fail(supersededError());
          break;
        }
        if ('say' in ev) {
          job.event({ say: ev.say });
        } else if ('lines' in ev) {
          job.event({ lines: ev.lines });
        } else if ('actions' in ev) {
          job.event({ actions: ev.actions });
        } else if ('control' in ev) {
          job.event({ control: ev.control });
        } else if ('done' in ev) {
          job.event(ev.notices !== undefined && ev.notices.length > 0 ? { done: true, notices: ev.notices } : { done: true });
          job.end();
        } else if ('error' in ev) {
          // a teach turn's own limits end as `turn_limit` with the teacher's message; `model_timeout` is for no first byte
          const error = ev.error.kind === 'turn_limit' ? turnLimitFromStream(ev.error) : fromStreamError(ev.error);
          ctx.log('teach.error', { kind: error.kind });
          job.fail(error);
        }
      }
    } finally {
      app.destroy();
    }
  } finally {
    slot.release();
  }
}
