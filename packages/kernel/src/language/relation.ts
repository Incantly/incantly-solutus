/**
 * Equations and inequalities (docs/features/language/design.md 3.9): expansion of a relation in
 * x and y to a polynomial of degree at most 2 with expression coefficients, and classification
 * into Line, Circle, Curve or Region.
 */
import type { PolyNodes, RelTree, RelationShape, TNode } from './tnode';
import { T } from './types';

export function children(n: TNode): TNode[] {
  switch (n.n) {
    case 'unary':
    case 'fact':
    case 'tick':
      return [n.arg];
    case 'bin':
      return [n.l, n.r];
    case 'cmp':
      return [...n.operands];
    case 'callObj':
    case 'builtin':
      return [...n.args];
    case 'command':
      return n.args.flatMap((a) => (a.expr ? [a.expr] : []));
    case 'index':
      return [n.target, n.index];
    case 'field':
      return [n.target];
    case 'point':
      return [n.x, n.y];
    case 'polar':
      return [n.r, n.a];
    case 'list':
      return [...n.items];
    case 'range':
      return n.step ? [n.from, n.to, n.step] : [n.from, n.to];
    case 'cond':
      return [...n.arms.flatMap((a) => [a.c, a.v]), ...(n.otherwise ? [n.otherwise] : [])];
    case 'text':
      return n.parts.flatMap((p) => (typeof p === 'string' ? [] : [p.e]));
    case 'relation':
      return relOperands(n.tree);
    default:
      return [];
  }
}

export function relOperands(t: RelTree): TNode[] {
  if (t.t === 'cmp') return [...t.operands];
  if (t.t === 'not') return relOperands(t.a);
  return [...relOperands(t.l), ...relOperands(t.r)];
}

export function usesSlot(n: TNode, slots: readonly number[]): boolean {
  if (n.n === 'local') return slots.includes(n.slot);
  for (const c of children(n)) if (usesSlot(c, slots)) return true;
  return false;
}

/* ------------------------------ coefficient algebra ------------------------------ */

const num = (v: number, s = 0, e = 0): TNode => ({ n: 'num', v, ty: T.Number, s, e });
const isNum = (n: TNode): n is TNode & { n: 'num' } => n.n === 'num';
const bin = (op: string, l: TNode, r: TNode): TNode => ({ n: 'bin', op, l, r, variant: 'num', ty: T.Number, s: l.s, e: r.e });

function cAdd(a: TNode, b: TNode): TNode {
  if (isNum(a) && isNum(b)) return num(a.v + b.v);
  if (isNum(a) && a.v === 0) return b;
  if (isNum(b) && b.v === 0) return a;
  return bin('+', a, b);
}
function cNeg(a: TNode): TNode {
  if (isNum(a)) return num(-a.v);
  return { n: 'unary', op: '-', arg: a, ty: T.Number, s: a.s, e: a.e };
}
function cSub(a: TNode, b: TNode): TNode {
  if (isNum(a) && isNum(b)) return num(a.v - b.v);
  if (isNum(b) && b.v === 0) return a;
  return cAdd(a, cNeg(b));
}
function cMul(a: TNode, b: TNode): TNode {
  if (isNum(a) && isNum(b)) return num(a.v * b.v);
  if ((isNum(a) && a.v === 0) || (isNum(b) && b.v === 0)) return num(0);
  if (isNum(a) && a.v === 1) return b;
  if (isNum(b) && b.v === 1) return a;
  return bin('*', a, b);
}
function cDiv(a: TNode, b: TNode): TNode {
  if (isNum(a) && isNum(b) && b.v !== 0) return num(a.v / b.v);
  if (isNum(b) && b.v === 1) return a;
  return bin('/', a, b);
}

type Poly = Map<string, TNode>;
const key = (i: number, j: number): string => `${i},${j}`;
const MAX_TERMS = 40;
const MAX_DEGREE = 8;

function pAdd(a: Poly, b: Poly, sub = false): Poly | null {
  const out: Poly = new Map(a);
  for (const [k, v] of b) {
    const cur = out.get(k);
    out.set(k, cur ? (sub ? cSub(cur, v) : cAdd(cur, v)) : sub ? cNeg(v) : v);
  }
  return out.size > MAX_TERMS ? null : out;
}
function pMul(a: Poly, b: Poly): Poly | null {
  const out: Poly = new Map();
  for (const [ka, va] of a) {
    const [ai, aj] = ka.split(',').map(Number) as [number, number];
    for (const [kb, vb] of b) {
      const [bi, bj] = kb.split(',').map(Number) as [number, number];
      if (ai + bi + aj + bj > MAX_DEGREE) return null;
      const k = key(ai + bi, aj + bj);
      const prod = cMul(va, vb);
      const cur = out.get(k);
      out.set(k, cur ? cAdd(cur, prod) : prod);
    }
  }
  return out.size > MAX_TERMS ? null : out;
}
const pConst = (c: TNode): Poly => new Map([[key(0, 0), c]]);

export function polyOf(n: TNode, sx: number, sy: number): Poly | null {
  if (!usesSlot(n, [sx, sy])) return pConst(n);
  switch (n.n) {
    case 'local':
      return n.slot === sx ? new Map([[key(1, 0), num(1)]]) : new Map([[key(0, 1), num(1)]]);
    case 'unary': {
      const p = polyOf(n.arg, sx, sy);
      if (!p) return null;
      if (n.op === '+') return p;
      if (n.op !== '-') return null;
      return new Map([...p].map(([k, v]) => [k, cNeg(v)]));
    }
    case 'bin': {
      if (n.variant !== 'num') return null;
      if (n.op === '+' || n.op === '-') {
        const a = polyOf(n.l, sx, sy);
        const b = polyOf(n.r, sx, sy);
        return a && b ? pAdd(a, b, n.op === '-') : null;
      }
      if (n.op === '*') {
        const a = polyOf(n.l, sx, sy);
        const b = polyOf(n.r, sx, sy);
        return a && b ? pMul(a, b) : null;
      }
      if (n.op === '/') {
        if (usesSlot(n.r, [sx, sy])) return null;
        const a = polyOf(n.l, sx, sy);
        return a ? new Map([...a].map(([k, v]) => [k, cDiv(v, n.r)])) : null;
      }
      if (n.op === '^') {
        if (n.r.n !== 'num' || !Number.isInteger(n.r.v) || n.r.v < 0 || n.r.v > MAX_DEGREE) return null;
        const base = polyOf(n.l, sx, sy);
        if (!base) return null;
        let acc: Poly | null = pConst(num(1));
        for (let i = 0; i < n.r.v && acc; i++) acc = pMul(acc, base);
        return acc;
      }
      return null;
    }
    default:
      return null;
  }
}

function degreeOf(p: Poly): number {
  let d = 0;
  for (const [k, v] of p) {
    if (isNum(v) && v.v === 0) continue;
    const [i, j] = k.split(',').map(Number) as [number, number];
    d = Math.max(d, i + j);
  }
  return d;
}

const co = (p: Poly, i: number, j: number): TNode => p.get(key(i, j)) ?? num(0);
const allConst = (p: Poly): boolean => [...p.values()].every(isNum);

export interface Classified {
  readonly shape: RelationShape;
  readonly poly?: PolyNodes;
}

/** Classify a relation tree. A single `==` of degree <= 2 is a Line, Circle or conic. */
export function classify(tree: RelTree, sx: number, sy: number): Classified {
  if (tree.t !== 'cmp' || tree.ops.length !== 1) return { shape: 'region' };
  const op = tree.ops[0];
  const l = polyOf(tree.operands[0] as TNode, sx, sy);
  const r = polyOf(tree.operands[1] as TNode, sx, sy);
  const p = l && r ? pAdd(l, r, true) : null;
  const polyNodes: PolyNodes | undefined =
    p && degreeOf(p) <= 2 ? { xx: co(p, 2, 0), xy: co(p, 1, 1), yy: co(p, 0, 2), x: co(p, 1, 0), y: co(p, 0, 1), c: co(p, 0, 0) } : undefined;
  if (op !== '==') return polyNodes ? { shape: 'region', poly: polyNodes } : { shape: 'region' };
  if (!p) return { shape: 'curve' };
  const d = degreeOf(p);
  if (d > 2 || !polyNodes) return { shape: 'curve' };
  if (d <= 1) {
    const a = co(p, 1, 0);
    const b = co(p, 0, 1);
    if (isNum(a) && isNum(b) && a.v === 0 && b.v === 0) return { shape: 'curve', poly: polyNodes };
    return { shape: 'line', poly: polyNodes };
  }
  if (allConst(p)) {
    const xx = (co(p, 2, 0) as { v: number }).v;
    const yy = (co(p, 0, 2) as { v: number }).v;
    const xy = (co(p, 1, 1) as { v: number }).v;
    const bx = (co(p, 1, 0) as { v: number }).v;
    const by = (co(p, 0, 1) as { v: number }).v;
    const c0 = (co(p, 0, 0) as { v: number }).v;
    if (xy === 0 && xx !== 0 && Math.abs(xx - yy) <= 1e-12 * Math.max(1, Math.abs(xx))) {
      const cx = -bx / (2 * xx);
      const cy = -by / (2 * xx);
      const r2 = cx * cx + cy * cy - c0 / xx;
      if (r2 > 0) return { shape: 'circle', poly: polyNodes };
    }
  }
  return { shape: 'conic', poly: polyNodes };
}
