/**
 * Dragging a body (docs/features/physics/ui.md 4). At the start of the film a drag moves where the body starts: the
 * shape it is made from moves (its literal points, or the free points it is built from). Later in the film a drag
 * grabs the body: a stiff spring pulls it toward the pointer, logged, so the replay shows the same grab.
 */
import type { ObjId } from '../../contracts/values';
import type { Figure } from '../../graph/figure';
import { physics3Of, physicsOf } from './index';
import { isBodyValue } from './types';
import { isBody3Value } from './body3';

export interface BodyDrag {
  readonly name: string;
  /** The pointer where the gesture was last, world space. */
  lastX: number;
  lastY: number;
  mode: 'start' | 'grab';
}

const DRAGS = new WeakMap<Figure, BodyDrag>();

const NUM = '(-?\\d+(?:\\.\\d+)?(?:e[-+]?\\d+)?)';
const PAIR = new RegExp(`\\(\\s*${NUM}\\s*,\\s*${NUM}\\s*\\)`, 'g');
const fmt = (x: number): string => String(Number(x.toPrecision(6)));

/** Moves every `(x, y)` of literal numbers in a text by (dx, dy). */
function shiftPairs(text: string, dx: number, dy: number): string {
  return text.replace(PAIR, (_m, a: string, b: string) => `(${fmt(Number(a) + dx)}, ${fmt(Number(b) + dy)})`);
}

/** The text of the first argument of `name = Cmd(arg, …)`, with where it starts and ends. */
function firstArg(def: string): { start: number; end: number } | undefined {
  const open = def.indexOf('(');
  if (open < 0) return undefined;
  let depth = 0;
  let quote = false;
  for (let i = open + 1; i < def.length; i++) {
    const c = def[i];
    if (c === '"') quote = !quote;
    if (quote) continue;
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') {
      if (depth === 0) return { start: open + 1, end: i };
      depth--;
    } else if (c === ',' && depth === 0) return { start: open + 1, end: i };
  }
  return undefined;
}

/** Moves the start of body `name` by (dx, dy). True when it could. */
function moveStart(figure: Figure, name: string, dx: number, dy: number): boolean {
  const b = figure.get(name);
  if (!b) return false;
  const def = b.definition;
  const arg = firstArg(def);
  if (!arg) return false;
  const text = def.slice(arg.start, arg.end).trim();
  if (/^[A-Za-z\u0370-\u03FF_]\w*$/.test(text)) return moveShape(figure, text, dx, dy);
  // the shape is written inside the body's line: move its numbers there
  const moved = shiftPairs(text, dx, dy);
  if (moved === text) return false;
  return figure.apply(def.slice(0, arg.start) + moved + def.slice(arg.end), { origin: 'learner' } as never).ok;
}

/** Moves a shape: its own literal points, or the free points it reads. */
function moveShape(figure: Figure, name: string, dx: number, dy: number): boolean {
  const o = figure.get(name);
  if (!o) return false;
  if (o.free && o.type === 'Point') {
    const p = o.cell.defined ? (o.cell.value as { x: number; y: number }) : undefined;
    return p ? figure.setFree(name, { x: Number((p.x + dx).toPrecision(6)), y: Number((p.y + dy).toPrecision(6)) }, 'drag').ok : false;
  }
  const moved = shiftPairs(o.definition, dx, dy);
  if (moved !== o.definition) return figure.apply(moved, { origin: 'learner' } as never).ok;
  // built from free points: move each of them
  let any = false;
  for (const id of o.inputs) {
    const i = figure.get(id);
    if (i && i.free && i.type === 'Point') any = moveShape(figure, i.name, dx, dy) || any;
  }
  return any;
}

/** Where `balls[2]` is: the object and the 0-based item. */
function target(figure: Figure, name: string): { id: ObjId; item?: number } | undefined {
  const m = /^(.+)\[(\d+)\]$/.exec(name);
  const o = figure.get(m ? (m[1] as string) : name);
  if (!o) return undefined;
  return m ? { id: o.id, item: Number(m[2]) - 1 } : { id: o.id };
}

/**
 * One step of a body drag: the pointer is at (x, y) in maths units; `done` ends the gesture. Returns what it did, or
 * an explanation when it could not.
 */
export function dragBody(figure: Figure, name: string, x: number, y: number, done: boolean): { ok: true; did: 'moved start' | 'grabbed' | 'released' } | { ok: false; why: string } {
  const at = target(figure, name);
  if (!at) return { ok: false, why: `${name} is not a body` };
  const d = physicsOf(figure);
  let g = DRAGS.get(figure);
  if (!g || g.name !== name) {
    const atStart = figure.clock().t <= figure.clockRange().from + 1e-9;
    g = { name, lastX: x, lastY: y, mode: atStart && at.item === undefined ? 'start' : 'grab' };
    DRAGS.set(figure, g);
    if (g.mode === 'grab') {
      figure.flush();
      if (!d.grab(at.id, x, y, { x, y }, at.item)) {
        DRAGS.delete(figure);
        return { ok: false, why: `${name} is not in the physics world` };
      }
      figure.flush(true);
      if (done) {
        d.release(at.id, at.item);
        DRAGS.delete(figure);
        figure.flush(true);
        return { ok: true, did: 'released' };
      }
      return { ok: true, did: 'grabbed' };
    }
  }
  if (g.mode === 'start') {
    const dx = x - g.lastX;
    const dy = y - g.lastY;
    g.lastX = x;
    g.lastY = y;
    if (dx !== 0 || dy !== 0) {
      const v = figure.value(name);
      if (!isBodyValue(v) || !moveStart(figure, name, dx, dy)) {
        DRAGS.delete(figure);
        return { ok: false, why: `${name}'s start cannot be moved: its shape is not built from points it can move` };
      }
      figure.flush();
    }
    if (done) DRAGS.delete(figure);
    return { ok: true, did: 'moved start' };
  }
  d.grab(at.id, x, y, undefined, at.item);
  if (done) {
    d.release(at.id, at.item);
    DRAGS.delete(figure);
  }
  figure.flush(true);
  return { ok: true, did: done ? 'released' : 'grabbed' };
}

/** True while a body is held. */
export function draggingBody(figure: Figure): string | undefined {
  return DRAGS.get(figure)?.name;
}

/* ------------------------------ in space ------------------------------ */

type V3 = { x: number; y: number; z: number };

const TRIPLE = new RegExp(`\\(\\s*${NUM}\\s*,\\s*${NUM}\\s*,\\s*${NUM}\\s*\\)`, 'g');

function shiftTriples(text: string, d: V3): string {
  return text.replace(TRIPLE, (_m, a: string, b: string, c: string) => `(${fmt(Number(a) + d.x)}, ${fmt(Number(b) + d.y)}, ${fmt(Number(c) + d.z)})`);
}

/** Moves a solid: its own literal points, or the free points in space it is built from (all of its ancestors). */
function moveShape3(figure: Figure, name: string, d: V3, seen = new Set<string>()): boolean {
  if (seen.has(name)) return false;
  seen.add(name);
  const o = figure.get(name);
  if (!o) return false;
  if (o.free && o.type === 'Point3') {
    const p = o.cell.defined ? (o.cell.value as V3) : undefined;
    return p ? figure.setFree(name, { x: Number((p.x + d.x).toPrecision(6)), y: Number((p.y + d.y).toPrecision(6)), z: Number((p.z + d.z).toPrecision(6)) }, 'drag').ok : false;
  }
  // its own numbers, and the points it is built from, so the whole solid moves and keeps its shape
  const inputs = [...o.inputs];
  const moved = shiftTriples(o.definition, d);
  let any = false;
  if (moved !== o.definition) {
    if (!figure.apply(moved, { origin: 'learner' } as never).ok) return false;
    any = true;
  }
  for (const id of inputs) {
    const i = figure.get(id);
    if (i) any = moveShape3(figure, i.name, d, seen) || any;
  }
  return any;
}

function moveStart3(figure: Figure, name: string, d: V3): boolean {
  const b = figure.get(name);
  if (!b) return false;
  const def = b.definition;
  const arg = firstArg(def);
  if (!arg) return false;
  const text = def.slice(arg.start, arg.end).trim();
  if (/^[A-Za-z\u0370-\u03FF_]\w*$/.test(text)) return moveShape3(figure, text, d);
  const moved = shiftTriples(text, d);
  if (moved === text) return false;
  return figure.apply(def.slice(0, arg.start) + moved + def.slice(arg.end), { origin: 'learner' } as never).ok;
}

interface BodyDrag3 {
  readonly name: string;
  last: V3;
  mode: 'start' | 'grab';
}

const DRAGS3 = new WeakMap<Figure, BodyDrag3>();

/**
 * One step of dragging a body in space: `p` is where the pointer puts the body's centre. At the start of the film the
 * start moves; later the body is grabbed at its centre and pulled toward `p`, logged.
 */
export function dragBody3(figure: Figure, name: string, p: V3, done: boolean): { ok: true; did: 'moved start' | 'grabbed' | 'released' } | { ok: false; why: string } {
  const at = target(figure, name);
  if (!at) return { ok: false, why: `${name} is not a body` };
  const d = physics3Of(figure);
  let g = DRAGS3.get(figure);
  if (!g || g.name !== name) {
    const atStart = figure.clock().t <= figure.clockRange().from + 1e-9;
    const v = figure.value(at.item === undefined ? name : (figure.get(at.id)?.name ?? name));
    const c = isBody3Value(v) ? { x: v.x, y: v.y, z: v.z } : p;
    g = { name, last: c, mode: atStart && at.item === undefined ? 'start' : 'grab' };
    DRAGS3.set(figure, g);
  }
  if (g.mode === 'start') {
    const dv = { x: p.x - g.last.x, y: p.y - g.last.y, z: p.z - g.last.z };
    g.last = p;
    if (dv.x !== 0 || dv.y !== 0 || dv.z !== 0) {
      if (!moveStart3(figure, name, dv)) {
        DRAGS3.delete(figure);
        return { ok: false, why: `${name}'s start cannot be moved: its solid is not built from points it can move` };
      }
      figure.flush();
    }
    if (done) DRAGS3.delete(figure);
    return { ok: true, did: 'moved start' };
  }
  figure.flush();
  if (!d.grab(at.id, p, g.last, at.item)) {
    DRAGS3.delete(figure);
    return { ok: false, why: `${name} is not in the physics world` };
  }
  if (done) {
    d.release(at.id, at.item);
    DRAGS3.delete(figure);
  }
  figure.flush(true);
  return { ok: true, did: done ? 'released' : 'grabbed' };
}
