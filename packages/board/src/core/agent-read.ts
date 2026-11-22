/**
 * `board_read` (agent.md 1): what is on the board as a short list a model can read. Items come in reading order (rows
 * from the top, each row from the left), each with its id, kind, box and, where it has them, its text, a figure card's
 * summary and the recognised shape of a stroke. At most 60 items are listed and the rest are counted. The circle to ask
 * (core/circle.ts) describes what is inside the loop with the same function. No DOM, no timers, no `Date`.
 */
import type { BoardCore } from './board';
import { boardError, ok } from './errors';
import type { BoardResult } from './errors';
import { strokePoints } from './fix';
import { isInk, shapeBounds } from './geometry';
import type { InkProps } from './kinds/ink';
import type { FigureProps } from './kinds/media';
import { recogniseStroke } from './ink/recognise';
import type { AgentItem, Box, ReadResult } from './agent-types';
import { ITEMS_MAX } from './agent-types';
import type { Bounds, ShapeRecord } from './types';

/** The SDK, as the web layer gives it to the core: it runs a figure's lines and tells what a figure shows. */
export interface FigureHost {
  /** Runs `lines` in a fresh figure of `mode`; `good` are the ones that ran, `errors` the others in the kernel's format. */
  run(mode: string, lines: readonly string[]): { readonly good: readonly string[]; readonly errors: readonly unknown[] };
  /** A short line saying what the figure holds, or undefined when it cannot be made. */
  summary(mode: string, script: string): string | undefined;
}

/** The longest text an item carries. */
export const ITEM_TEXT_MAX = 240;

const clip = (text: string): string => (text.length > ITEM_TEXT_MAX ? `${text.slice(0, ITEM_TEXT_MAX - 1)}…` : text);

/** A page box as `[x, y, width, height]`, rounded to whole units. */
export const boxOf = (b: Bounds): Box => [Math.round(b.minX), Math.round(b.minY), Math.max(0, Math.round(b.maxX - b.minX)), Math.max(0, Math.round(b.maxY - b.minY))];

/** `[x, y, width, height]` as page bounds. */
export const boundsOfBox = (b: Box): Bounds => ({ minX: b[0], minY: b[1], maxX: b[0] + b[2], maxY: b[1] + b[3] });

/** The name of what a stroke looks like: a clean shape when one fits, else `loop` (it comes back to where it began) or `curve`. */
export function strokeShape(shape: ShapeRecord<'ink', InkProps>): string {
  if (shape.props.nib === 'highlighter') return 'highlight';
  const xy = strokePoints(shape);
  const r = recogniseStroke(xy);
  if (r !== undefined) {
    switch (r.kind) {
      case 'line':
        return 'line';
      case 'arrow':
        return 'arrow';
      case 'ellipse':
        return Math.abs(r.w - r.h) <= 0.12 * Math.max(r.w, r.h) ? 'circle' : 'ellipse';
      case 'rect':
        return Math.abs(r.w - r.h) <= 0.05 * Math.max(r.w, r.h) ? 'square' : 'rectangle';
      case 'polygon': {
        const n = r.points.length / 2;
        return n === 3 ? 'triangle' : n === 4 ? 'quadrilateral' : n === 5 ? 'pentagon' : n === 6 ? 'hexagon' : 'polygon';
      }
    }
  }
  // not a clean shape: a stroke that ends where it began is a loop, any other is a curve
  const n = Math.floor(xy.length / 2);
  if (n < 2) return 'dot';
  let length = 0;
  for (let i = 1; i < n; i++) length += Math.hypot((xy[i * 2] as number) - (xy[(i - 1) * 2] as number), (xy[i * 2 + 1] as number) - (xy[(i - 1) * 2 + 1] as number));
  const gap = Math.hypot((xy[0] as number) - (xy[(n - 1) * 2] as number), (xy[1] as number) - (xy[(n - 1) * 2 + 1] as number));
  return length > 0 && gap < 0.15 * length ? 'loop' : 'curve';
}

/** The text a shape holds, or undefined. */
function textOf(core: BoardCore, shape: ShapeRecord): string | undefined {
  const def = core.store.kinds.get(shape.kind);
  const props = shape.props as Record<string, unknown>;
  if (def?.text !== undefined) {
    try {
      const t = def.text.get(shape.props as never);
      if (typeof t === 'string' && t !== '') return clip(t);
    } catch {
      // a kind whose text reader failed has no text to show
    }
  }
  const label = props['label'] ?? props['name'];
  return typeof label === 'string' && label !== '' ? clip(label) : undefined;
}

const summaries = new WeakMap<object, string>();

/** What one shape is, as an item. */
export function describeShape(core: BoardCore, shape: ShapeRecord, figures?: FigureHost): AgentItem {
  const bounds = shapeBounds(shape, core.store.kinds) ?? { minX: shape.x, minY: shape.y, maxX: shape.x, maxY: shape.y };
  const text = textOf(core, shape);
  let summary: string | undefined;
  let form: string | undefined;
  if (shape.kind === 'figure') {
    const p = shape.props as FigureProps;
    let known = summaries.get(shape.props as object);
    if (known === undefined) {
      let made: string | undefined;
      try {
        made = figures?.summary(p.mode, p.script);
      } catch {
        made = undefined;
      }
      known = made ?? `${p.mode} figure of ${p.script.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#')).length} lines`;
      summaries.set(shape.props as object, known);
    }
    summary = known;
  } else if (isInk(shape)) {
    form = strokeShape(shape);
  }
  return {
    id: shape.id,
    kind: shape.kind,
    box: boxOf(bounds),
    ...(text !== undefined ? { text } : {}),
    ...(summary !== undefined ? { summary } : {}),
    ...(form !== undefined ? { shape: form } : {}),
    ...(shape.meta['madeBy'] === 'model' ? { madeBy: 'model' as const } : {}),
  };
}

/**
 * The shapes in reading order: rows from the top, each row from the left. A shape joins the row of the first shape of the
 * row when its top is within the row's height (at least 24 units) of the row's top.
 */
export function readingOrder(core: BoardCore, shapes: readonly ShapeRecord[]): ShapeRecord[] {
  const boxed = shapes.flatMap((s) => {
    const b = shapeBounds(s, core.store.kinds);
    return b === undefined ? [] : [{ s, b }];
  });
  boxed.sort((a, b) => a.b.minY - b.b.minY || a.b.minX - b.b.minX || (a.s.id < b.s.id ? -1 : 1));
  const out: ShapeRecord[] = [];
  let at = 0;
  while (at < boxed.length) {
    const head = boxed[at] as (typeof boxed)[number];
    const reach = head.b.minY + Math.max(24, (head.b.maxY - head.b.minY) * 0.6);
    let end = at + 1;
    while (end < boxed.length && (boxed[end] as (typeof boxed)[number]).b.minY < reach) end++;
    const row = boxed.slice(at, end).sort((a, b) => a.b.minX - b.b.minX || (a.s.id < b.s.id ? -1 : 1));
    for (const r of row) out.push(r.s);
    at = end;
  }
  return out;
}

/** The items of `shapes` in reading order, at most 60, and how many were left out. */
export function itemsOf(core: BoardCore, shapes: readonly ShapeRecord[], figures?: FigureHost): { items: AgentItem[]; more: number } {
  const ordered = readingOrder(core, shapes);
  return { items: ordered.slice(0, ITEMS_MAX).map((s) => describeShape(core, s, figures)), more: Math.max(0, ordered.length - ITEMS_MAX) };
}

export interface ReadEnv {
  /** The part of the current page on screen, in page units. */
  readonly view: () => Bounds;
  readonly figures?: FigureHost;
}

/** `board_read`: the items of `area` (default the visible part) on `page` (default the current page). */
export function readBoard(core: BoardCore, input: unknown, env: ReadEnv): BoardResult<ReadResult> {
  try {
    const o = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
    const asked = o['page'] === undefined ? core.pages.current : o['page'];
    if (typeof asked !== 'string' || core.pages.get(asked) === undefined) {
      return boardError('bad_argument', `There is no page "${String(asked)}".`, { detail: { field: 'page' } });
    }
    const page: string = asked;
    let area: Bounds;
    if (o['area'] === undefined) area = env.view();
    else if (Array.isArray(o['area']) && o['area'].length === 4 && o['area'].every((n) => typeof n === 'number' && Number.isFinite(n))) area = boundsOfBox(o['area'] as unknown as Box);
    else return boardError('bad_argument', 'area must be [x, y, width, height].', { detail: { field: 'area' } });
    const inside: ShapeRecord[] = [];
    for (const s of core.store.shapesOn(page)) {
      if (s.kind === 'group') continue;
      const b = shapeBounds(s, core.store.kinds);
      if (b !== undefined && b.minX <= area.maxX && b.maxX >= area.minX && b.minY <= area.maxY && b.maxY >= area.minY) inside.push(s);
    }
    const read = itemsOf(core, inside, env.figures);
    return ok({ page, items: read.items, more: read.more });
  } catch (e) {
    return boardError('internal', `board_read failed: ${e instanceof Error ? e.message : 'unknown reason'}.`);
  }
}
