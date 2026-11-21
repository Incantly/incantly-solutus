/**
 * What a symbolic row draws (cas ui.md 7), as scene items the painter already knows: an Expr in one unknown is a
 * Function curve with open circles at its holes, a Cond in two unknowns a Relation, a Cond in one unknown marks on the x
 * axis, and lists of solutions points.
 */
import { isSymValue } from '@incantly/kernel';
import type { SymValue } from '@incantly/kernel';

export type SymDrawing =
  | { readonly kind: 'curve'; readonly fn: { arity: 1; ret: 'Number'; call(x: number): number; call1(x: number): number }; readonly holes: readonly { x: number; y: number }[] }
  | { readonly kind: 'relation'; readonly value: { ops: readonly string[]; residual(x: number, y: number): number; test(x: number, y: number): boolean | undefined } }
  | { readonly kind: 'axis'; readonly residual: (x: number) => number; readonly test: (x: number) => boolean | undefined; readonly ops: readonly string[] }
  | { readonly kind: 'points'; readonly pts: readonly { x: number; y: number }[] };

/** The drawing of a value, or undefined when it has none (a constant, a Symbol, a list of mixed things). */
export function symDrawing(v: unknown): SymDrawing | undefined {
  if (isSymValue(v)) return one(v);
  if (!Array.isArray(v) || v.length === 0) return undefined;
  const pts: { x: number; y: number }[] = [];
  for (const it of v) {
    if (Array.isArray(it)) {
      // a solution of a system: {x == a, y == b}
      const p: Record<string, number> = {};
      for (const c of it) if (isSymValue(c) && c.solved) p[c.solved.name] = c.solved.value;
      const names = Object.keys(p).sort();
      if (names.length !== 2) return undefined;
      const [a, b] = names.includes('x') && names.includes('y') ? ['x', 'y'] : names;
      pts.push({ x: p[a as string] as number, y: p[b as string] as number });
    } else if (isSymValue(it) && it.solved) pts.push({ x: it.solved.value, y: 0 });
    else if (isSymValue(it) && it.approx !== undefined) pts.push({ x: it.approx, y: 0 });
    else if (typeof it === 'number' && Number.isFinite(it)) pts.push({ x: it, y: 0 });
    else return undefined;
  }
  return { kind: 'points', pts };
}

function one(v: SymValue): SymDrawing | undefined {
  const p = v.plot;
  if (!p) return undefined;
  if (p.kind === 'curve') {
    const f = p.f;
    const holes = p.holes.map((x) => ({ x, y: limitNear(f, x) })).filter((h) => Number.isFinite(h.y));
    return { kind: 'curve', fn: { arity: 1, ret: 'Number', call: f, call1: f }, holes };
  }
  if (p.kind === 'relation') return { kind: 'relation', value: { ops: p.ops, residual: p.residual, test: p.test } };
  return { kind: 'axis', residual: p.residual, test: p.test, ops: p.ops };
}

/** The height of a curve at a hole: the mean of the values just beside it. */
function limitNear(f: (x: number) => number, x: number): number {
  const h = 1e-6 * Math.max(1, Math.abs(x));
  return (f(x - h) + f(x + h)) / 2;
}

/** True when a row of this value has something to draw, so it gets a show switch (ui.md 1). */
export function hasDrawing(v: unknown): boolean {
  return symDrawing(v) !== undefined;
}
