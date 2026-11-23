/**
 * The board actions of `docs/features/board/agent.md` as data, and the check of what a model sends. The model's JSON is
 * untrusted: `readActions` and `readAction` turn it into typed actions or a `bad_argument` error that names the action
 * and the field, never a throw. No DOM, no timers, no `Date`.
 */
import type { BoardError, BoardResult } from './errors';
import { boardError, ok } from './errors';

/** An area `[x, y, width, height]` in page units. */
export type Box = readonly [number, number, number, number];
/** A shape id, an area, or `$last` (the shape the previous action made). */
export type Target = string | Box;
export type Side = 'right' | 'left' | 'above' | 'below';
export type Place = { readonly x: number; readonly y: number } | { readonly near: Target; readonly side: Side } | 'free';

export const SIDES: readonly Side[] = ['right', 'left', 'above', 'below'];
export const SHAPE_KINDS = ['rect', 'ellipse', 'triangle', 'diamond', 'star', 'line', 'sticky', 'frame'] as const;
export type AgentShapeKind = (typeof SHAPE_KINDS)[number];
export const MARK_HOWS = ['circle', 'underline', 'highlight', 'box'] as const;
export type MarkHow = (typeof MARK_HOWS)[number];

/** At most this many actions in one `board` call. */
export const ACTIONS_MAX = 20;
/** `board_read` gives at most this many items and counts the rest. */
export const ITEMS_MAX = 60;
/** A stroke or a text longer than these is refused: the model writes a sketch, not a file. */
export const STROKE_POINTS_MAX = 2000;
export const TEXT_ACTION_MAX = 4000;
export const LINES_MAX = 200;

export type BoardAction =
  | { readonly op: 'write'; readonly text: string; readonly at: Place; readonly style?: 'hand' | 'typed'; readonly size?: number; readonly color?: string }
  | { readonly op: 'shape'; readonly kind: AgentShapeKind; readonly at: Place; readonly w?: number; readonly h?: number; readonly label?: string; readonly color?: string }
  | { readonly op: 'arrow'; readonly from: Target; readonly to: Target; readonly label?: string }
  | { readonly op: 'stroke'; readonly points: readonly (readonly [number, number])[]; readonly at: Place; readonly color?: string; readonly size?: number }
  | { readonly op: 'figure'; readonly lines: readonly string[]; readonly mode?: string; readonly at: Place; readonly w?: number; readonly h?: number }
  | { readonly op: 'mark'; readonly target: Target; readonly how: MarkHow }
  | { readonly op: 'point'; readonly target: Target }
  | { readonly op: 'move'; readonly id: string; readonly at: Place }
  | { readonly op: 'edit'; readonly id: string; readonly text: string }
  | { readonly op: 'delete'; readonly id: string }
  | { readonly op: 'camera'; readonly target: Target | 'all' }
  | { readonly op: 'page'; readonly to: string; readonly name?: string };

export type BoardOp = BoardAction['op'];
export const OPS: readonly BoardOp[] = ['write', 'shape', 'arrow', 'stroke', 'figure', 'mark', 'point', 'move', 'edit', 'delete', 'camera', 'page'];

/** What `board_read` says about one thing on the board. */
export interface AgentItem {
  readonly id: string;
  readonly kind: string;
  readonly box: Box;
  readonly text?: string;
  readonly summary?: string;
  readonly shape?: string;
  /** `model` when the agent made it; the server's check of `edit`, `move` and `delete` reads it (agent.md 2). */
  readonly madeBy?: 'model';
}

export interface ReadResult {
  readonly page: string;
  readonly items: readonly AgentItem[];
  /** How many items the area holds beyond the ones listed. */
  readonly more: number;
}

/** What one action gave back: the id of what it made or changed, or the error. */
export type ActionOk = {
  readonly ok: true;
  readonly id?: string;
  /** A figure's lines that did not run, in the kernel's format (`detail` of the answer for the model). */
  readonly lineErrors?: readonly unknown[];
};
export type ActionResult = ActionOk | BoardError;

// ---------------------------------------------------------------------------------------------------------------
// reading what the model sent

/** A field of an action that is wrong; thrown inside this file only and turned into an error at its edge. */
class Bad extends Error {
  readonly field: string;
  constructor(field: string, why: string) {
    super(`${field} ${why}`);
    this.field = field;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function text(o: Record<string, unknown>, key: string, max = TEXT_ACTION_MAX): string {
  const v = o[key];
  if (typeof v !== 'string') throw new Bad(key, 'must be text');
  if (v.length > max) throw new Bad(key, `must be at most ${max} characters`);
  return v;
}
const optText = (o: Record<string, unknown>, key: string, max = TEXT_ACTION_MAX): string | undefined => (o[key] === undefined ? undefined : text(o, key, max));

function num(o: Record<string, unknown>, key: string, min: number, max: number): number | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (!finite(v) || v < min || v > max) throw new Bad(key, `must be a number from ${min} to ${max}`);
  return v;
}

function oneOf<T extends string>(o: Record<string, unknown>, key: string, list: readonly T[], required: boolean): T | undefined {
  const v = o[key];
  if (v === undefined && !required) return undefined;
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) throw new Bad(key, `must be one of ${list.join(', ')}`);
  return v as T;
}

function readBox(v: unknown, key: string): Box {
  if (!Array.isArray(v) || v.length !== 4 || !v.every(finite)) throw new Bad(key, 'must be an area [x, y, width, height]');
  if ((v[2] as number) < 0 || (v[3] as number) < 0) throw new Bad(key, 'must not have a negative width or height');
  return v as unknown as Box;
}

function readTarget(v: unknown, key: string): Target {
  if (typeof v === 'string') {
    if (v === '') throw new Bad(key, 'must not be empty');
    return v;
  }
  return readBox(v, key);
}

function readPlace(v: unknown, key: string): Place {
  if (v === 'free') return 'free';
  if (!isObject(v)) throw new Bad(key, 'must be { x, y }, { near, side } or "free"');
  if ('near' in v) {
    const side = v['side'];
    if (typeof side !== 'string' || !(SIDES as readonly string[]).includes(side)) throw new Bad(`${key}.side`, `must be one of ${SIDES.join(', ')}`);
    return { near: readTarget(v['near'], `${key}.near`), side: side as Side };
  }
  if (!finite(v['x']) || !finite(v['y'])) throw new Bad(key, 'must be { x, y } with finite numbers, { near, side } or "free"');
  return { x: v['x'], y: v['y'] };
}

function readPoints(v: unknown): readonly (readonly [number, number])[] {
  if (!Array.isArray(v) || v.length < 2 || v.length > STROKE_POINTS_MAX) throw new Bad('points', `must be 2 to ${STROKE_POINTS_MAX} points [x, y]`);
  const out: [number, number][] = [];
  for (const p of v) {
    if (!Array.isArray(p) || p.length < 2 || !finite(p[0]) || !finite(p[1])) throw new Bad('points', 'must be points [x, y] with finite numbers');
    out.push([p[0], p[1]]);
  }
  return out;
}

/** Drops the keys that are undefined, so an action has only what the model wrote (the checks of the kinds see no `undefined`). */
function clean(o: Record<string, unknown>): BoardAction {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as unknown as BoardAction;
}

function parse(raw: unknown): BoardAction {
  if (!isObject(raw)) throw new Bad('action', 'must be an object with an op');
  const op = oneOf(raw, 'op', OPS, true) as BoardOp;
  switch (op) {
    case 'write':
      return clean({ op, text: text(raw, 'text'), at: readPlace(raw['at'], 'at'), style: oneOf(raw, 'style', ['hand', 'typed'] as const, false), size: num(raw, 'size', 4, 400), color: optText(raw, 'color', 40) });
    case 'shape':
      return clean({ op, kind: oneOf(raw, 'kind', SHAPE_KINDS, true) as AgentShapeKind, at: readPlace(raw['at'], 'at'), w: num(raw, 'w', 1, 100_000), h: num(raw, 'h', 1, 100_000), label: optText(raw, 'label'), color: optText(raw, 'color', 40) });
    case 'arrow':
      return clean({ op, from: readTarget(raw['from'], 'from'), to: readTarget(raw['to'], 'to'), label: optText(raw, 'label', 200) });
    case 'stroke':
      return clean({ op, points: readPoints(raw['points']), at: readPlace(raw['at'], 'at'), color: optText(raw, 'color', 40), size: num(raw, 'size', 0.5, 500) });
    case 'figure': {
      const lines = raw['lines'];
      if (!Array.isArray(lines) || lines.length === 0 || lines.length > LINES_MAX || !lines.every((l) => typeof l === 'string')) throw new Bad('lines', `must be 1 to ${LINES_MAX} lines of text`);
      return clean({ op, lines: lines as string[], mode: optText(raw, 'mode', 40), at: readPlace(raw['at'], 'at'), w: num(raw, 'w', 40, 100_000), h: num(raw, 'h', 40, 100_000) });
    }
    case 'mark':
      return { op, target: readTarget(raw['target'], 'target'), how: oneOf(raw, 'how', MARK_HOWS, true) as MarkHow };
    case 'point':
      return { op, target: readTarget(raw['target'], 'target') };
    case 'move':
      return { op, id: text(raw, 'id', 200), at: readPlace(raw['at'], 'at') };
    case 'edit':
      return { op, id: text(raw, 'id', 200), text: text(raw, 'text') };
    case 'delete':
      return { op, id: text(raw, 'id', 200) };
    case 'camera':
      return { op, target: raw['target'] === 'all' ? 'all' : readTarget(raw['target'], 'target') };
    case 'page': {
      const to = text(raw, 'to', 200);
      return clean({ op, to, name: optText(raw, 'name', 200) });
    }
  }
}

/** One action as the model wrote it, checked; `bad_argument` names the op and the field when it is wrong. */
export function readAction(raw: unknown): BoardResult<BoardAction> {
  try {
    return ok(parse(raw));
  } catch (e) {
    const field = e instanceof Bad ? e.field : 'action';
    const op = isObject(raw) && typeof raw['op'] === 'string' ? raw['op'] : 'action';
    return boardError('bad_argument', `The "${op}" action is wrong: ${e instanceof Error ? e.message : 'it could not be read'}.`, { hint: 'Read docs/features/board/agent.md for the actions.', detail: { op, field } });
  }
}

/** The list of a `board` call: `{ actions }` with 1 to 20 entries (each is checked later, one by one). */
export function readActions(input: unknown): BoardResult<readonly unknown[]> {
  if (!isObject(input) || !Array.isArray(input['actions'])) {
    return boardError('bad_argument', 'The board tool takes { actions: [...] }.', { detail: { field: 'actions' } });
  }
  const list = input['actions'];
  if (list.length === 0 || list.length > ACTIONS_MAX) {
    return boardError('agent_refused', `A board call has 1 to ${ACTIONS_MAX} actions; this one has ${list.length}.`, {
      hint: `Send at most ${ACTIONS_MAX} actions and the rest in the next call.`,
      detail: { limit: ACTIONS_MAX, count: list.length },
    });
  }
  return ok(list);
}
