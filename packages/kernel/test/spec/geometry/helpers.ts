/**
 * Shared helpers for the geometry spec tests. Imports only from the package's public entry.
 * Built from docs/features/points-lines, conics and polygons-transforms (design, errors, agent), never from the implementation.
 *
 * Value shapes used (public API of the `geometry` namespace and the kernel's own conventions):
 *   Point / Vector {x, y}; Line {a, b, c} meaning a·x + b·y = c with a² + b² = 1; Segment {a, b};
 *   Circle {cx, cy, r}; Polygon {pts}; lists are arrays, an undefined slot inside a defined list is null.
 */
import { expect } from 'vitest';
import { CommandRegistry, Figure, geometry } from '@incantly/kernel';
import type { Cell, ErrorObject, TxOk, TxResult } from '@incantly/kernel';

export const registry = new CommandRegistry();
geometry.registerGeometry(registry);

/** Every test in the geometry suite must finish within this many milliseconds. */
export const LIMIT_MS = 5000;

export interface V2 {
  x: number;
  y: number;
}
export interface L3 {
  a: number;
  b: number;
  c: number;
}

export function newFigure(): Figure {
  return new Figure({ commands: registry });
}

/** Applies lines one by one and throws with the error text when one does not pass. */
export function fig(lines: string | readonly string[] = []): Figure {
  const f = newFigure();
  const list = typeof lines === 'string' ? lines.split('\n').filter((l) => l.trim() !== '') : lines;
  for (const line of list) {
    const r = f.apply(line);
    if (!r.ok) throw new Error(`setup line "${line}" failed: ${r.kind} (${r.code}): ${r.message}`);
  }
  return f;
}

export function ok(r: TxResult, context = ''): TxOk {
  if (!r.ok) throw new Error(`expected success${context ? ` (${context})` : ''}, got ${r.kind} (${r.code}): ${r.message}`);
  return r;
}

export function bad(r: TxResult, kind?: string): ErrorObject {
  if (r.ok) throw new Error(`expected an error${kind ? ` (${kind})` : ''}, but the line passed: ${r.summary}`);
  if (kind !== undefined && r.kind !== kind) throw new Error(`expected error kind ${kind}, got ${r.kind} (${r.code}): ${r.message}`);
  return r;
}

/** Applies one line to a copy of the base lines and returns the result without throwing. */
export function tryLine(base: string | readonly string[], line: string): TxResult {
  return fig(base).apply(line);
}

export function cell(f: Figure, name: string): Cell {
  const c = f.cellOf(name);
  if (c === undefined) throw new Error(`no object ${name}`);
  return c;
}

export function val<T = unknown>(f: Figure, name: string): T {
  const c = cell(f, name);
  if (!c.defined) throw new Error(`${name} is undefined (${String(c.reason)}${c.detail ? `: ${c.detail}` : ''}), expected a value`);
  return c.value as T;
}

export function why(f: Figure, name: string): string {
  const c = cell(f, name);
  if (c.defined) throw new Error(`${name} is defined (${JSON.stringify(c.value)}), expected undefined`);
  return String(c.reason);
}

export const isUndef = (f: Figure, name: string): boolean => !cell(f, name).defined;

/** The reason of the first line's object after building `lines` plus `line` ("out = ..."). */
export function reasonOfLine(base: string | readonly string[], line: string): string {
  const f = fig(base);
  ok(f.apply(line), line);
  return why(f, line.split('=')[0]!.trim());
}

/** The value of `out = <expr>` on a figure built from `base`. */
export function evalIn<T = unknown>(base: string | readonly string[], expr: string): T {
  const f = fig(base);
  ok(f.apply(`out = ${expr}`), expr);
  return val<T>(f, 'out');
}

export function undefIn(base: string | readonly string[], expr: string): string {
  const f = fig(base);
  ok(f.apply(`out = ${expr}`), expr);
  return why(f, 'out');
}

// numbers ------------------------------------------------------------------------------------

export function near(actual: number, expected: number, tol = 1e-9, what = ''): void {
  const bound = tol * Math.max(1, Math.abs(expected));
  if (!(Math.abs(actual - expected) <= bound)) {
    throw new Error(`${what ? `${what}: ` : ''}expected ${expected} (±${bound}), got ${actual}`);
  }
}

export function nearPt(actual: unknown, x: number, y: number, tol = 1e-9, what = ''): void {
  const p = actual as V2 | null | undefined;
  if (p === null || p === undefined || typeof p.x !== 'number' || typeof p.y !== 'number') {
    throw new Error(`${what ? `${what}: ` : ''}expected the point (${x}, ${y}), got ${JSON.stringify(actual)}`);
  }
  near(p.x, x, tol, `${what} x`);
  near(p.y, y, tol, `${what} y`);
}

export const num = (f: Figure, name: string): number => {
  const v = val<number>(f, name);
  if (typeof v !== 'number') throw new Error(`${name} is not a number: ${JSON.stringify(v)}`);
  return v;
};

export const pt = (f: Figure, name: string): V2 => val<V2>(f, name);

export function list<T = unknown>(f: Figure, name: string): (T | null)[] {
  const v = val<ArrayLike<T | null>>(f, name);
  if (!Array.isArray(v) && !ArrayBuffer.isView(v)) throw new Error(`${name} is not a list: ${JSON.stringify(v)}`);
  return Array.from(v);
}

export const nums = (f: Figure, name: string): number[] => list<number>(f, name) as number[];

export const dist = (p: V2, q: V2): number => Math.hypot(p.x - q.x, p.y - q.y);

export const rad = (deg: number): number => (deg * Math.PI) / 180;

// lines --------------------------------------------------------------------------------------

export const lineDist = (l: L3, p: V2): number => Math.abs(l.a * p.x + l.b * p.y - l.c) / Math.hypot(l.a, l.b);

export function expectOnLine(l: unknown, p: V2, tol = 1e-9, what = ''): void {
  const d = lineDist(l as L3, p);
  if (!(d <= tol)) throw new Error(`${what ? `${what}: ` : ''}point (${p.x}, ${p.y}) is ${d} from the line ${JSON.stringify(l)}`);
}

/** Unit direction of a line, sign as stored: (b, -a) (points-lines 5.2). */
export const dirOf = (l: L3): V2 => {
  const h = Math.hypot(l.a, l.b);
  return { x: l.b / h, y: -l.a / h };
};

/** True when the two lines are the same set of points (sign and scale of the triple do not matter). */
export function sameLine(l1: L3, l2: L3, tol = 1e-9): boolean {
  const h1 = Math.hypot(l1.a, l1.b);
  const h2 = Math.hypot(l2.a, l2.b);
  const s = Math.sign(l1.a * l2.a + l1.b * l2.b) || 1;
  return Math.abs(l1.a / h1 - (s * l2.a) / h2) <= tol && Math.abs(l1.b / h1 - (s * l2.b) / h2) <= tol && Math.abs(l1.c / h1 - (s * l2.c) / h2) <= tol * 10;
}

export function expectLine(actual: unknown, expected: L3, tol = 1e-9, what = ''): void {
  const l = actual as L3;
  if (l === null || typeof l !== 'object' || typeof l.a !== 'number') throw new Error(`${what}: expected a line, got ${JSON.stringify(actual)}`);
  if (!sameLine(l, expected, tol)) throw new Error(`${what ? `${what}: ` : ''}expected the line ${JSON.stringify(expected)}, got ${JSON.stringify(l)}`);
}

/** Sine of the angle between two lines' directions. */
export const sinBetween = (l1: L3, l2: L3): number => {
  const d1 = dirOf(l1);
  const d2 = dirOf(l2);
  return d1.x * d2.y - d1.y * d2.x;
};

// speed --------------------------------------------------------------------------------------

export function elapsed(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

export function expectFast(fn: () => void, ms: number, what = ''): void {
  const took = elapsed(fn);
  expect(took, `${what} took ${took.toFixed(1)} ms, limit ${ms} ms`).toBeLessThan(ms);
}

// polygons -----------------------------------------------------------------------------------

export const shoelace = (pts: readonly V2[]): number => {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
};

export const polyPts = (f: Figure, name: string): V2[] => (val<{ pts: V2[] }>(f, name).pts);

/** Same cyclic sequence of vertices, in order, starting anywhere. */
export function sameRing(a: readonly V2[], b: readonly V2[], tol = 1e-9): boolean {
  if (a.length !== b.length) return false;
  for (let s = 0; s < a.length; s++) {
    let all = true;
    for (let i = 0; i < a.length && all; i++) {
      const p = a[i]!;
      const q = b[(i + s) % b.length]!;
      all = Math.abs(p.x - q.x) <= tol && Math.abs(p.y - q.y) <= tol;
    }
    if (all) return true;
  }
  return false;
}

/** An undefined slot inside a defined list (stored as null; undefined is accepted too). */
export const slotUndef = (x: unknown): boolean => x === null || x === undefined;
