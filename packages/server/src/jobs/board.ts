/**
 * `POST /v1/board/ask` (docs/features/server/design.md 1, 5, 6; R2.2, R3.3, R4.2, R7.2): the board's `CircleRequest` or
 * `TalkRequest` in, NDJSON out: `{ actions }` events, then `{ done: true, notices? }`, or `{ error }`. The teacher's
 * `boardTurn` runs the model against a board target built from the request's items; every action is checked before it
 * leaves (the board core's checks, and a figure's lines on a headless app), so only actions that passed reach the client,
 * which checks again as it applies them. A request with a `picture` is sent to the vision models.
 *
 * Request fields: `kind` (`circle` or `talk`), `items`, `more`, `page`; a circle also `choice`, `circle`, `text?` and
 * `picture?`; a talk also `text` and `allowEdit`.
 */
import { CIRCLE_CHOICES } from '@incantly/board/core';
import type { AgentItem, BoardAgentRequest, Box, CircleChoice } from '@incantly/board/core';
import { boardTurn } from '@incantly/teacher';
import type { ChatImage } from '@incantly/teacher';
import { badRequest, fromStreamError, modelUnavailable, serverError, superseded as supersededError, tooLarge } from '../errors';
import type { ServerError } from '../errors';
import { BODY_LIMIT, checkPicture } from '../http/body';
import type { Context } from './context';
import { TURN_MS, jobSignal, meteredClient } from './model';

/** The most characters of what the person said (design 7: 4,000). */
export const BOARD_TEXT_CHARS = 4000;
/** The most items a request lists (the board lists at most 60 and counts the rest in `more`). */
export const BOARD_ITEMS_MAX = 60;
/** The most characters of an item's text or summary the server keeps. */
export const ITEM_CHARS = 400;
const ID_CHARS = 200;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const failed = (v: unknown): v is ServerError => isObject(v) && v['ok'] === false;

function readBox(v: unknown, what: string): Box | ServerError {
  if (!Array.isArray(v) || v.length !== 4 || !v.every(finite)) return badRequest(`${what} must be an area [x, y, width, height].`);
  return v as unknown as Box;
}

function optText(o: Record<string, unknown>, key: string): string | undefined | ServerError {
  const v = o[key];
  if (v === undefined) return undefined;
  return typeof v === 'string' ? v.slice(0, ITEM_CHARS) : badRequest(`An item's "${key}" must be text.`);
}

function readItem(raw: unknown, at: number): AgentItem | ServerError {
  if (!isObject(raw)) return badRequest(`items[${at}] must be an object.`);
  const id = raw['id'];
  const kind = raw['kind'];
  if (typeof id !== 'string' || id === '' || id.length > ID_CHARS) return badRequest(`items[${at}].id must be a shape id.`);
  if (typeof kind !== 'string' || kind === '' || kind.length > 40) return badRequest(`items[${at}].kind must be a kind of shape.`);
  const box = readBox(raw['box'], `items[${at}].box`);
  if (failed(box)) return box;
  const text = optText(raw, 'text');
  if (failed(text)) return text;
  const summary = optText(raw, 'summary');
  if (failed(summary)) return summary;
  const shape = optText(raw, 'shape');
  if (failed(shape)) return shape;
  const madeBy = raw['madeBy'];
  if (madeBy !== undefined && madeBy !== 'model') return badRequest(`items[${at}].madeBy must be "model" when it is there.`);
  return {
    id,
    kind,
    box,
    ...(text !== undefined ? { text } : {}),
    ...(summary !== undefined ? { summary } : {}),
    ...(shape !== undefined ? { shape } : {}),
    ...(madeBy === 'model' ? { madeBy: 'model' as const } : {}),
  };
}

function readItems(body: Record<string, unknown>): AgentItem[] | ServerError {
  const raw = body['items'];
  if (!Array.isArray(raw)) return badRequest('"items" must be the list of what is on the board in view.');
  if (raw.length > BOARD_ITEMS_MAX) return badRequest(`"items" has ${raw.length} items; at most ${BOARD_ITEMS_MAX}. Send the rest as a count in "more".`);
  const items: AgentItem[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = readItem(raw[i], i + 1);
    if (failed(item)) return item;
    items.push(item);
  }
  return items;
}

/** `data:image/png;base64,…` as a chat image, checked by its bytes (magic number, size, pixels), or the error. */
function readPicture(v: unknown): ChatImage | ServerError {
  const pic = (why: string): ServerError => serverError('picture_invalid', why, { hint: 'Send a PNG or JPEG data URL of at most 2,048 pixels a side and 1.5 MB.' });
  if (typeof v !== 'string') return pic('"picture" must be a data URL of a PNG or a JPEG.');
  const m = /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(v);
  if (m === null) return pic('"picture" must be a data URL of a PNG or a JPEG, in base64.');
  const data = m[1] as string;
  const found = checkPicture(Buffer.from(data, 'base64'));
  if (failed(found)) return found;
  return { mime: found.mime, data };
}

/** The request as the board's types have it, checked field by field, or the error that names the field. */
export function readBoardRequest(body: Record<string, unknown>): { readonly request: BoardAgentRequest; readonly image?: ChatImage } | ServerError {
  const kind = body['kind'];
  if (kind !== 'circle' && kind !== 'talk') return badRequest('"kind" must be "circle" or "talk".');
  const items = readItems(body);
  if (!Array.isArray(items)) return items;
  const more = body['more'] ?? 0;
  if (!finite(more) || !Number.isInteger(more) || more < 0 || more > 1_000_000) return badRequest('"more" must be a whole number, 0 or more.');
  const page = body['page'];
  if (typeof page !== 'string' || page === '' || page.length > ID_CHARS) return badRequest('"page" must be a page id.');
  const text = body['text'];
  if (text !== undefined && typeof text !== 'string') return badRequest('"text" must be text.');
  if (typeof text === 'string' && text.length > BOARD_TEXT_CHARS) return tooLarge('"text"', BOARD_TEXT_CHARS);
  let image: ChatImage | undefined;
  if (body['picture'] !== undefined) {
    const picture = readPicture(body['picture']);
    if (failed(picture)) return picture;
    image = picture;
  }
  const withImage = image === undefined ? {} : { image };
  if (kind === 'talk') {
    if (typeof text !== 'string' || text.trim() === '') return badRequest('"text" must be what the person said to the agent.');
    const allowEdit = body['allowEdit'] ?? false;
    if (typeof allowEdit !== 'boolean') return badRequest('"allowEdit" must be true or false.');
    return { request: { kind: 'talk', text, items, more, page, allowEdit }, ...withImage };
  }
  const choice = body['choice'];
  if (typeof choice !== 'string' || !(CIRCLE_CHOICES as readonly string[]).includes(choice)) return badRequest('"choice" is not one of the circle choices.', `The choices are: ${CIRCLE_CHOICES.join(', ')}.`);
  if (choice === 'ask' && (typeof text !== 'string' || text.trim() === '')) return badRequest('A circle with the choice "ask" needs "text", the question.');
  const circle = readBox(body['circle'], '"circle"');
  if (failed(circle)) return circle;
  return { request: { kind: 'circle', choice: choice as CircleChoice, ...(text !== undefined ? { text } : {}), items, more, circle, page }, ...withImage };
}

export async function boardAsk(ctx: Context): Promise<void> {
  const { job, body } = ctx;
  // a request with no picture is held to the smaller body limit (design 7); the route's limit is the one with a picture
  if (body['picture'] === undefined && JSON.stringify(body).length > BODY_LIMIT) return job.refuse(tooLarge('The request', BODY_LIMIT));
  const read = readBoardRequest(body);
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
    const events = boardTurn({
      client: meteredClient(client, ctx.limiter),
      request: read.request,
      ...(read.image !== undefined ? { image: read.image } : {}),
      signal,
      now: ctx.now,
      limits: { ms: TURN_MS },
    });
    for await (const ev of events) {
      if (superseded.signal.aborted) {
        // a newer request of this client replaced this one: what was applied stays with the client, which is told
        job.fail(supersededError());
        break;
      }
      if ('actions' in ev) {
        job.event({ actions: ev.actions });
      } else if ('done' in ev) {
        job.event(ev.notices !== undefined && ev.notices.length > 0 ? { done: true, notices: ev.notices } : { done: true });
        job.end();
      } else if ('error' in ev) {
        const error = fromStreamError(ev.error);
        ctx.log('board.error', { kind: error.kind });
        job.fail(error);
      }
      // `say`, `lines` and `control` have no place in the board's protocol: the board shows what its actions did
    }
  } finally {
    slot.release();
  }
}
