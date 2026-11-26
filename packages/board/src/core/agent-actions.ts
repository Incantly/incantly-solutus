/**
 * The twelve board actions of agent.md, one function each. Every action that changes the board is one transaction,
 * written through the call's gesture (core/edit.ts, B25) with origin `model`, so one undo takes the whole call back and a
 * failed action changes nothing. The things the model makes carry `meta.madeBy: 'model'`, which is how a later call knows
 * what it may change. No DOM, no timers, no `Date`.
 */
import type { BoardCore } from './board';
import type { Gesture } from './edit';
import { deleteShapes, patchShapes, translateShapes } from './edit';
import type { BoardError, BoardResult } from './errors';
import { boardError, ok } from './errors';
import { withHeader, sdkMode } from './figures';
import { shapeBounds } from './geometry';
import { partOf } from './agent-hand';
import type { HandPlan, HandPlayer } from './agent-hand';
import { LAST, goneShape, resolvePlace, targetBounds } from './agent-place';
import type { PlaceEnv } from './agent-place';
import type { FigureHost } from './agent-read';
import { readAction } from './agent-types';
import type { ActionResult, BoardAction, Place, Target } from './agent-types';
import { bindEnd } from './bindings';
import { FIGURE_DEFAULTS } from './kinds/media';
import { putNewShape, shapeOf } from './shapes';
import type { Tx } from './store';
import type { Bounds, ShapeRecord } from './types';

/** What a shape made by the agent carries in its `meta`. */
export const MODEL_META: Readonly<Record<string, unknown>> = Object.freeze({ madeBy: 'model' });

const RED = '#dc2626';
const HIGHLIGHT = '#fde047';
const INK_PRESSURE = 0.7;
/** A stopped drawing shorter than this share of the whole is not kept. */
const KEEP_MIN = 0.02;

/** What a call holds while it runs: its gesture, whether it may change the user's work, and `$last`. */
export interface CallState {
  readonly gesture: Gesture;
  readonly allowForeign: boolean;
  /** The id of the shape the previous action made or changed. */
  last: string | undefined;
  /** True once the call was stopped (the runner's epoch moved). */
  stopped(): boolean;
}

/** What the actions need from the host: all of it optional but the view. */
export interface ActionEnv {
  view(): Bounds;
  viewSize(): { readonly w: number; readonly h: number };
  clock(): number;
  reducedMotion(): boolean;
  readonly figures?: FigureHost;
  readonly hand?: HandPlayer;
  readonly onPoint?: (box: Bounds) => void;
  readonly onHand?: (at: { readonly x: number; readonly y: number }) => void;
}

/** A store `limit` is the agent's `agent_refused` (errors.md); any other error stays as it is. */
function asRefused(error: BoardError): BoardError {
  if (error.kind !== 'limit') return error;
  return boardError('agent_refused', error.message, { ...(error.hint !== undefined ? { hint: error.hint } : {}), detail: { ...error.detail, refusedBy: 'limit' } });
}

/** Runs `fn` as one transaction of the call's gesture. `fail` aborts the whole transaction with an error. */
function commit<T>(call: CallState, fn: (tx: Tx, fail: (e: BoardError) => never) => T): BoardResult<T> {
  const failure: { error?: BoardError } = {};
  const fail = (e: BoardError): never => {
    failure.error = e;
    throw new Error(e.message);
  };
  const done = call.gesture.write((tx) => fn(tx, fail));
  if (done.ok) return done;
  return asRefused(failure.error ?? done);
}

const unwrap = <T>(r: BoardResult<T>, fail: (e: BoardError) => never): T => (r.ok ? r.value : fail(r));

/** A shape of `kind` with these props (checked by the kind) at the origin: its size is known before it is placed. */
function protoOf(core: BoardCore, kind: string, props: Readonly<Record<string, unknown>>): BoardResult<ShapeRecord> {
  const def = core.store.kinds.get(kind);
  const page = core.pages.current;
  if (page === null) return boardError('bad_argument', 'The board has no page.', { detail: { field: 'page' } });
  if (def === undefined) return boardError('kind_unknown', `The kind "${kind}" is not registered.`, { detail: { kind } });
  const checked = def.check({ ...(def.defaults as object), ...props });
  if (!checked.ok) return checked;
  return ok({ id: 'shape:preview', page, kind, x: 0, y: 0, rotation: 0, parent: null, index: 'a0', locked: false, opacity: 1, props: checked.value, meta: {} });
}

const sizeOf = (b: Bounds): { w: number; h: number } => ({ w: b.maxX - b.minX, h: b.maxY - b.minY });

/** The proto placed: where its origin goes so its box begins where `place` says. */
function placed(core: BoardCore, call: CallState, env: ActionEnv, proto: ShapeRecord, place: Place, skip?: ReadonlySet<string>): BoardResult<ShapeRecord> {
  const bounds = shapeBounds(proto, core.store.kinds);
  if (bounds === undefined) return boardError('kind_unknown', `The kind "${proto.kind}" has no size.`, { detail: { kind: proto.kind } });
  const penv: PlaceEnv = { view: env.view(), last: call.last, ...(skip !== undefined ? { skip } : {}) };
  const at = resolvePlace(core, place, sizeOf(bounds), penv);
  if (!at.ok) return at;
  return ok({ ...proto, x: at.value.x - bounds.minX, y: at.value.y - bounds.minY });
}

/** Stores a placed shape in the call's gesture. */
function storeShape(core: BoardCore, call: CallState, shape: ShapeRecord, after?: (tx: Tx, made: ShapeRecord, fail: (e: BoardError) => never) => void): BoardResult<ShapeRecord> {
  return commit(call, (tx, fail) => {
    const made = unwrap(putNewShape(tx, core.store, { kind: shape.kind, page: shape.page, x: shape.x, y: shape.y, rotation: shape.rotation, props: shape.props as Record<string, unknown>, meta: MODEL_META }), fail);
    after?.(tx, made, fail);
    return made;
  });
}

const done = (id?: string, lineErrors?: readonly unknown[]): ActionResult => ({ ok: true, ...(id !== undefined ? { id } : {}), ...(lineErrors !== undefined && lineErrors.length > 0 ? { lineErrors } : {}) });

const centreOf = (b: Bounds): { x: number; y: number } => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });

/** Shows the hand where an action works, then stores `shape`; a plan the hand plays is stored as far as it got. */
async function drawAndStore(core: BoardCore, call: CallState, env: ActionEnv, plan: HandPlan | undefined, shape: ShapeRecord): Promise<ActionResult> {
  env.onHand?.(centreOf(shapeBounds(shape, core.store.kinds) ?? { minX: shape.x, minY: shape.y, maxX: shape.x, maxY: shape.y }));
  let progress = 1;
  if (plan !== undefined && env.hand !== undefined && !env.reducedMotion()) progress = await env.hand.play(plan);
  if (progress < KEEP_MIN) return boardError('agent_partial', 'The agent was stopped before it drew this.', { detail: { progress } });
  const final = progress >= 1 ? shape : partOf({ how: plan?.how ?? 'stroke', shape }, progress);
  const stored = storeShape(core, call, final);
  if (!stored.ok) return stored;
  call.last = stored.value.id;
  return progress >= 1 ? done(stored.value.id) : boardError('agent_partial', 'The agent was stopped part of the way; what it drew stays.', { detail: { progress, id: stored.value.id } });
}

// ---------------------------------------------------------------------------------------------------------------
// the actions that make things

async function writeText(core: BoardCore, a: Extract<BoardAction, { op: 'write' }>, call: CallState, env: ActionEnv): Promise<ActionResult> {
  // Handwriting is the default font. Only an explicit hand style is drawn on the live layer; typed stays the plain font.
  const handwriting = a.style !== 'typed';
  const proto = protoOf(core, 'text', { text: a.text, font: handwriting ? 'hand' : 'sans', size: a.size ?? 24, color: a.color ?? '#1f2430', w: a.text.length > 48 && !a.text.includes('\n') ? 480 : null });
  if (!proto.ok) return proto;
  const shape = placed(core, call, env, proto.value, a.at);
  if (!shape.ok) return shape;
  return drawAndStore(core, call, env, a.style === 'hand' ? { how: 'text', shape: shape.value } : undefined, shape.value);
}

const BOX_KINDS: readonly string[] = ['rect', 'ellipse', 'triangle', 'diamond', 'star'];

async function makeShape(core: BoardCore, a: Extract<BoardAction, { op: 'shape' }>, call: CallState, env: ActionEnv): Promise<ActionResult> {
  const color = a.color;
  let props: Record<string, unknown>;
  if (BOX_KINDS.includes(a.kind)) props = { ...(a.w !== undefined ? { w: a.w } : {}), ...(a.h !== undefined ? { h: a.h } : {}), ...(a.label !== undefined ? { label: a.label, font: 'hand' } : {}), ...(color !== undefined ? { stroke: color } : {}) };
  else if (a.kind === 'line') props = { points: [0, 0, a.w ?? 120, a.h ?? 0], ...(color !== undefined ? { stroke: color } : {}) };
  else if (a.kind === 'sticky') props = { ...(a.label !== undefined ? { text: a.label } : {}), ...(color !== undefined ? { color } : {}) };
  else props = { ...(a.w !== undefined ? { w: a.w } : {}), ...(a.h !== undefined ? { h: a.h } : {}), name: a.label ?? 'Frame', ...(color !== undefined ? { stroke: color } : {}) };
  const proto = protoOf(core, a.kind, props);
  if (!proto.ok) return proto;
  const at = placed(core, call, env, proto.value, a.at);
  if (!at.ok) return at;
  return drawAndStore(core, call, env, undefined, at.value);
}

async function makeStroke(core: BoardCore, a: Extract<BoardAction, { op: 'stroke' }>, call: CallState, env: ActionEnv): Promise<ActionResult> {
  let minX = Infinity;
  let minY = Infinity;
  for (const [x, y] of a.points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
  }
  const points = new Float32Array(a.points.length * 3);
  a.points.forEach(([x, y], i) => {
    points[i * 3] = x - minX;
    points[i * 3 + 1] = y - minY;
    points[i * 3 + 2] = INK_PRESSURE;
  });
  const proto = protoOf(core, 'ink', { points, stride: 3, nib: 'pen', ...(a.size !== undefined ? { size: a.size } : {}), ...(a.color !== undefined ? { color: a.color } : {}) });
  if (!proto.ok) return proto;
  const at = placed(core, call, env, proto.value, a.at);
  if (!at.ok) return at;
  return drawAndStore(core, call, env, { how: 'stroke', shape: at.value }, at.value);
}

async function makeFigure(core: BoardCore, a: Extract<BoardAction, { op: 'figure' }>, call: CallState, env: ActionEnv): Promise<ActionResult> {
  const mode = sdkMode(a.mode ?? 'graphing');
  const lines = a.lines.flatMap((l) => l.split('\n')).filter((l) => l.trim() !== '');
  const ran = env.figures?.run(mode, lines) ?? { good: lines, errors: [] };
  if (ran.good.length === 0) {
    return boardError('figure_failed', 'None of the figure\'s lines ran.', { hint: 'Fix the lines and send the figure again.', detail: { lines: ran.errors } });
  }
  const proto = protoOf(core, 'figure', { script: withHeader(ran.good.join('\n')), mode, w: a.w ?? FIGURE_DEFAULTS.w, h: a.h ?? FIGURE_DEFAULTS.h });
  if (!proto.ok) return proto;
  const at = placed(core, call, env, proto.value, a.at);
  if (!at.ok) return at;
  const result = await drawAndStore(core, call, env, undefined, at.value);
  return result.ok && ran.errors.length > 0 ? done(result.id, ran.errors) : result;
}

function mark(core: BoardCore, a: Extract<BoardAction, { op: 'mark' }>, call: CallState, env: ActionEnv): ActionResult {
  const target = targetBounds(core, a.target, call);
  if (!target.ok) return target;
  const b = target.value.bounds;
  const { w, h } = sizeOf(b);
  const c = centreOf(b);
  let kind: string;
  let props: Record<string, unknown>;
  let x: number;
  let y: number;
  switch (a.how) {
    case 'circle':
      kind = 'ellipse';
      props = { w: w * 1.2 + 24, h: h * 1.2 + 24, stroke: RED, fill: 'none', size: 3 };
      x = c.x - (props['w'] as number) / 2;
      y = c.y - (props['h'] as number) / 2;
      break;
    case 'underline':
      kind = 'line';
      props = { points: [0, 0, w, 0], stroke: RED, size: 3 };
      x = b.minX;
      y = b.maxY + 6;
      break;
    case 'highlight':
      kind = 'rect';
      props = { w: w + 8, h: h + 8, stroke: HIGHLIGHT, fill: HIGHLIGHT, size: 1 };
      x = b.minX - 4;
      y = b.minY - 4;
      break;
    case 'box':
      kind = 'rect';
      props = { w: w + 16, h: h + 16, stroke: RED, fill: 'none', size: 3 };
      x = b.minX - 8;
      y = b.minY - 8;
      break;
  }
  const proto = protoOf(core, kind, props);
  if (!proto.ok) return proto;
  env.onHand?.(c);
  const made = storeShape(core, call, { ...proto.value, x, y }, (tx, m, fail) => {
    if (a.how === 'highlight') unwrap(tx.update(m.id, { opacity: 0.45 }), fail);
  });
  if (!made.ok) return made;
  call.last = made.value.id;
  return done(made.value.id);
}

/** The point of the box's edge on the line to `(x, y)` from its middle. */
function edgeToward(b: Bounds, x: number, y: number): { x: number; y: number } {
  const c = centreOf(b);
  const dx = x - c.x;
  const dy = y - c.y;
  const hw = (b.maxX - b.minX) / 2;
  const hh = (b.maxY - b.minY) / 2;
  const s = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity);
  return s >= 1 || !Number.isFinite(s) ? c : { x: c.x + dx * s, y: c.y + dy * s };
}

function arrow(core: BoardCore, a: Extract<BoardAction, { op: 'arrow' }>, call: CallState, env: ActionEnv): ActionResult {
  const from = targetBounds(core, a.from, call);
  if (!from.ok) return from;
  const to = targetBounds(core, a.to, call);
  if (!to.ok) return to;
  if (from.value.id !== undefined && from.value.id === to.value.id) return boardError('bad_argument', 'An arrow needs two different ends.', { detail: { op: 'arrow', field: 'to' } });
  const cf = centreOf(from.value.bounds);
  const ct = centreOf(to.value.bounds);
  const start = from.value.id !== undefined ? cf : edgeToward(from.value.bounds, ct.x, ct.y);
  const end = to.value.id !== undefined ? ct : edgeToward(to.value.bounds, cf.x, cf.y);
  const proto = protoOf(core, 'arrow', { start: [0, 0], end: [end.x - start.x, end.y - start.y] });
  if (!proto.ok) return proto;
  let label: ShapeRecord | undefined;
  if (a.label !== undefined && a.label !== '') {
    const text = protoOf(core, 'text', { text: a.label, font: 'hand', size: 20 });
    if (!text.ok) return text;
    const tb = shapeBounds(text.value, core.store.kinds);
    if (tb !== undefined) {
      const { w, h } = sizeOf(tb);
      label = { ...text.value, x: (start.x + end.x) / 2 - w / 2 - tb.minX, y: (start.y + end.y) / 2 - h - 8 - tb.minY };
    }
  }
  env.onHand?.(start);
  const made = storeShape(core, call, { ...proto.value, x: start.x, y: start.y }, (tx, m, fail) => {
    if (from.value.id !== undefined) unwrap(bindEnd(tx, core.store, m.id, 'start', from.value.id, cf), fail);
    if (to.value.id !== undefined) unwrap(bindEnd(tx, core.store, m.id, 'end', to.value.id, ct), fail);
    if (label !== undefined) unwrap(putNewShape(tx, core.store, { kind: 'text', page: label.page, x: label.x, y: label.y, props: label.props as Record<string, unknown>, meta: MODEL_META }), fail);
  });
  if (!made.ok) return made;
  // an arrow joins things and does not become `$last`, so the action after it can still name what the arrow points to
  return done(made.value.id);
}

// ---------------------------------------------------------------------------------------------------------------
// the actions that change what is there

/** The shape an action changes: on this page, unlocked, and the model's own unless the call allows more. */
function changeable(core: BoardCore, call: CallState, id: string): BoardResult<ShapeRecord> {
  const named = id === LAST ? call.last : id;
  const page = core.pages.current;
  const found = named === undefined ? undefined : shapeOf(core.store, named);
  if (found === undefined || found.page !== page) return goneShape(id);
  if (found.locked) return boardError('agent_refused', `The shape "${found.id}" is locked.`, { hint: 'Leave it, or add something beside it.', detail: { record: found.id, reason: 'locked' } });
  if (!call.allowForeign && found.meta['madeBy'] !== 'model') {
    return boardError('agent_refused', `The shape "${found.id}" is the user's, and this request did not ask to change it.`, {
      hint: 'Add a new shape beside it, or ask the user.',
      detail: { record: found.id, reason: 'not_model' },
    });
  }
  return ok(found);
}

function move(core: BoardCore, a: Extract<BoardAction, { op: 'move' }>, call: CallState, env: ActionEnv): ActionResult {
  const s = changeable(core, call, a.id);
  if (!s.ok) return s;
  const b = shapeBounds(s.value, core.store.kinds);
  if (b === undefined) return goneShape(a.id);
  const at = resolvePlace(core, a.at, sizeOf(b), { view: env.view(), last: call.last, skip: new Set([s.value.id]) });
  if (!at.ok) return at;
  env.onHand?.(centreOf(b));
  const moved = translateShapes(core, [s.value.id], at.value.x - b.minX, at.value.y - b.minY, { gesture: call.gesture });
  if (!moved.ok) return asRefused(moved);
  call.last = s.value.id;
  return done(s.value.id);
}

function edit(core: BoardCore, a: Extract<BoardAction, { op: 'edit' }>, call: CallState, env: ActionEnv): ActionResult {
  const s = changeable(core, call, a.id);
  if (!s.ok) return s;
  let props: Record<string, unknown>;
  let lineErrors: readonly unknown[] = [];
  if (s.value.kind === 'figure') {
    const mode = (s.value.props as { mode: string }).mode;
    const lines = a.text.split('\n').filter((l) => l.trim() !== '');
    const ran = env.figures?.run(mode, lines) ?? { good: lines, errors: [] };
    if (lines.length > 0 && ran.good.length === 0) return boardError('figure_failed', 'None of the figure\'s lines ran.', { detail: { lines: ran.errors, record: s.value.id } });
    props = { script: withHeader(ran.good.join('\n')), picture: null };
    lineErrors = ran.errors;
  } else {
    const def = core.store.kinds.get(s.value.kind);
    if (def?.text === undefined) return boardError('bad_argument', `A ${s.value.kind} has no text to change.`, { detail: { record: s.value.id, op: 'edit' } });
    props = def.text.set(s.value.props as never, a.text) as Record<string, unknown>;
  }
  env.onHand?.(centreOf(shapeBounds(s.value, core.store.kinds) ?? { minX: s.value.x, minY: s.value.y, maxX: s.value.x, maxY: s.value.y }));
  const patched = patchShapes(core, new Map([[s.value.id, { props }]]), { gesture: call.gesture });
  if (!patched.ok) return asRefused(patched);
  call.last = s.value.id;
  return done(s.value.id, lineErrors);
}

function remove(core: BoardCore, a: Extract<BoardAction, { op: 'delete' }>, call: CallState): ActionResult {
  const s = changeable(core, call, a.id);
  if (!s.ok) return s;
  const gone = deleteShapes(core, [s.value.id], { gesture: call.gesture });
  if (!gone.ok) return asRefused(gone);
  if (call.last === s.value.id) call.last = undefined;
  return done(s.value.id);
}

// ---------------------------------------------------------------------------------------------------------------
// the actions that do not write shapes

function point(core: BoardCore, a: Extract<BoardAction, { op: 'point' }>, call: CallState, env: ActionEnv): ActionResult {
  const target = targetBounds(core, a.target, call);
  if (!target.ok) return target;
  env.onHand?.(centreOf(target.value.bounds));
  env.onPoint?.(target.value.bounds);
  return done(target.value.id);
}

function cameraTo(core: BoardCore, a: Extract<BoardAction, { op: 'camera' }>, call: CallState, env: ActionEnv): ActionResult {
  const page = core.pages.current;
  const camera = core.camera;
  if (page === null || camera === undefined) return boardError('bad_argument', 'The board has no page.', { detail: { field: 'page' } });
  let bounds: Bounds | undefined;
  if (a.target === 'all') {
    for (const s of core.store.shapesOn(page)) {
      const b = shapeBounds(s, core.store.kinds);
      if (b !== undefined) bounds = bounds === undefined ? b : { minX: Math.min(bounds.minX, b.minX), minY: Math.min(bounds.minY, b.minY), maxX: Math.max(bounds.maxX, b.maxX), maxY: Math.max(bounds.maxY, b.maxY) };
    }
    if (bounds === undefined) return done();
  } else {
    const t = targetBounds(core, a.target as Target, call);
    if (!t.ok) return t;
    bounds = t.value.bounds;
  }
  const size = env.viewSize();
  const margin = 60;
  const zoom = Math.min(1.5, Math.max(0.05, Math.min(size.w / (bounds.maxX - bounds.minX + 2 * margin), size.h / (bounds.maxY - bounds.minY + 2 * margin))));
  const c = centreOf(bounds);
  camera.moveTo(c.x - size.w / zoom / 2, c.y - size.h / zoom / 2, zoom, env.clock());
  core.cameras.save(page);
  return done();
}

function pageTo(core: BoardCore, a: Extract<BoardAction, { op: 'page' }>, call: CallState): ActionResult {
  const list = core.pages.list();
  const at = list.findIndex((p) => p.id === core.pages.current);
  let target: string | undefined;
  if (a.to === 'new') {
    const made = core.pages.addPage({ ...(a.name !== undefined ? { name: a.name } : {}), ...(core.pages.current !== null ? { after: core.pages.current } : {}) }, 'model');
    if (!made.ok) return asRefused(made);
    target = made.value.id;
  } else if (a.to === 'next' || a.to === 'previous') {
    target = list[at + (a.to === 'next' ? 1 : -1)]?.id;
    if (target === undefined) return boardError('agent_refused', `There is no ${a.to} page.`, { detail: { to: a.to } });
  } else if (core.pages.get(a.to) !== undefined) {
    target = a.to;
  } else {
    return boardError('agent_refused', `There is no page "${a.to}".`, { hint: 'Use new, next, previous or a page id.', detail: { page: a.to } });
  }
  const moved = core.pages.goToPage(target);
  if (!moved.ok) return asRefused(moved);
  call.last = undefined;
  return done(target);
}

/** Runs one action as the model wrote it. Never throws: a bad action, a refusal and a bug are all an error result. */
export async function applyAction(core: BoardCore, raw: unknown, call: CallState, env: ActionEnv): Promise<ActionResult> {
  const read = readAction(raw);
  if (!read.ok) return read;
  const a = read.value;
  try {
    switch (a.op) {
      case 'write':
        return await writeText(core, a, call, env);
      case 'shape':
        return await makeShape(core, a, call, env);
      case 'stroke':
        return await makeStroke(core, a, call, env);
      case 'figure':
        return await makeFigure(core, a, call, env);
      case 'arrow':
        return arrow(core, a, call, env);
      case 'mark':
        return mark(core, a, call, env);
      case 'point':
        return point(core, a, call, env);
      case 'move':
        return move(core, a, call, env);
      case 'edit':
        return edit(core, a, call, env);
      case 'delete':
        return remove(core, a, call);
      case 'camera':
        return cameraTo(core, a, call, env);
      case 'page':
        return pageTo(core, a, call);
    }
  } catch (e) {
    return boardError('internal', `The "${a.op}" action failed: ${e instanceof Error ? e.message : 'unknown reason'}.`, { detail: { op: a.op } });
  }
}
