/**
 * Equations and inequalities (docs/features/language/design.md 3.9): expansion of a relation in
 * x and y to a polynomial of degree at most 2 with expression coefficients, and classification
 * into Line, Circle, Curve or Region.
 */
import { sameTree } from './fixed-axis';
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
    case 'lambda':
      return [n.body];
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
      return [n.target, ...(n.args ?? [])];
    case 'point':
      return [n.x, n.y];
    case 'tuple':
      return [...n.items];
    case 'polar':
      return [n.r, n.a];
    case 'list':
    case 'cells':
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

export interface Classified {
  readonly shape: RelationShape;
  readonly poly?: PolyNodes;
  /** The comparison was proved true for every real x and y. */
  readonly identicallyTrue?: true;
}

/** Classify a relation tree. A single `==` of degree <= 2 is a Line, Circle or conic. */
export function classify(tree: RelTree, sx: number, sy: number): Classified {
  const out = classifyShape(tree, sx, sy);
  return identicallyTrue(tree, sx, sy) ? { ...out, identicallyTrue: true } : out;
}

function classifyShape(tree: RelTree, sx: number, sy: number): Classified {
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
  // A circle needs xx == yy (non-zero numbers), no xy term, and a radius squared that is positive.
  const xx = co(p, 2, 0);
  const yy = co(p, 0, 2);
  const xy = co(p, 1, 1);
  if (isNum(xx) && isNum(yy) && isNum(xy) && xy.v === 0 && xx.v !== 0 && Number.isFinite(xx.v) && Number.isFinite(yy.v) && Math.abs(xx.v - yy.v) <= 1e-12 * Math.max(1, Math.abs(xx.v))) {
    const r2 = radiusSquared(xx.v, co(p, 1, 0), co(p, 0, 1), co(p, 0, 0));
    if (r2 !== undefined && r2 > 0) return { shape: 'circle', poly: polyNodes };
  }
  return { shape: 'conic', poly: polyNodes };
}

const REL_TOL = 1e-12;

/**
 * True when one comparison is proved for every real x and y: the same tree on `==`, `>=` or `<=`,
 * a zero polynomial of any degree, or a numeric quadratic of degree at most 2. A name as a
 * coefficient blocks the quadratic proof. Nothing is sampled.
 */
export function identicallyTrue(tree: RelTree, sx: number, sy: number): boolean {
  if (tree.t !== 'cmp' || tree.ops.length !== 1) return false;
  const op = tree.ops[0];
  const left = tree.operands[0];
  const right = tree.operands[1];
  if (op === undefined || left === undefined || right === undefined) return false;
  if ((op === '==' || op === '>=' || op === '<=') && sameTree(left, right)) return true;
  const lp = polyOf(left, sx, sy);
  const rp = polyOf(right, sx, sy);
  const p = lp && rp ? pAdd(lp, rp, true) : null;
  if (!p) return false;
  if (polynomialZero(p)) return op === '==' || op === '>=' || op === '<=';
  if (degreeOf(p) > 2) return false;
  const coef = numericQuadratic(p);
  if (!coef) return false;
  return quadraticAlways(coef, op);
}

function polynomialZero(p: Poly): boolean {
  for (const v of p.values()) {
    if (!isNum(v) || v.v !== 0) return false;
  }
  return true;
}

/** The six coefficients of `A x^2 + B xy + C y^2 + D x + E y + F`, or undefined when one is not a finite number. */
function numericQuadratic(p: Poly): readonly [number, number, number, number, number, number] | undefined {
  const read = (i: number, j: number): number | undefined => {
    const n = co(p, i, j);
    return isNum(n) && Number.isFinite(n.v) ? n.v : undefined;
  };
  const A = read(2, 0);
  const B = read(1, 1);
  const C = read(0, 2);
  const D = read(1, 0);
  const E = read(0, 1);
  const F = read(0, 0);
  if (A === undefined || B === undefined || C === undefined || D === undefined || E === undefined || F === undefined) return undefined;
  return [A, B, C, D, E, F];
}

/** `<=` and `<` are the same tests on the negated coefficients. `==` holds only for the zero polynomial. */
function quadraticAlways(coef: readonly [number, number, number, number, number, number], op: string): boolean {
  let A = coef[0];
  let B = coef[1];
  let C = coef[2];
  let D = coef[3];
  let E = coef[4];
  let F = coef[5];
  if (op === '<' || op === '<=') {
    A = -A;
    B = -B;
    C = -C;
    D = -D;
    E = -E;
    F = -F;
  } else if (op !== '>' && op !== '>=' && op !== '==') {
    return false;
  }
  const scale = Math.max(1, Math.abs(A), Math.abs(B), Math.abs(C), Math.abs(D), Math.abs(E), Math.abs(F));
  const tol = REL_TOL * scale;
  const snap = (v: number): number => (Math.abs(v) < tol ? 0 : v);
  A = snap(A);
  B = snap(B);
  C = snap(C);
  D = snap(D);
  E = snap(E);
  F = snap(F);
  if (op === '==') return A === 0 && B === 0 && C === 0 && D === 0 && E === 0 && F === 0;
  const strict = op === '>' || op === '<';
  if (A === 0 && B === 0 && C === 0) {
    if (D !== 0 || E !== 0) return false;
    return strict ? F > 0 : F >= 0;
  }
  const halfB = B / 2;
  const det = A * C - halfB * halfB;
  if (A < 0 || C < 0 || det < 0) return false;
  if (A > 0 && det > 0) return minHolds(F - (C * D * D - B * D * E + A * E * E) / (4 * det), strict);
  if (A > 0 && det === 0) {
    // Flat in one direction, including a perfect square such as (x + y)^2. A nonzero coefficient there is unbounded.
    if (A * E - halfB * D !== 0) return false;
    return minHolds(F - (D * D) / (4 * A), strict);
  }
  if (C > 0 && A === 0) {
    if (D !== 0) return false;
    return minHolds(F - (E * E) / (4 * C), strict);
  }
  return false;
}

function minHolds(min: number, strict: boolean): boolean {
  return strict ? min > 0 : min >= 0;
}

/* ------------------------- symbolic radius squared ------------------------- */

/** A polynomial in opaque atoms (objects, parameters, fields): monomial key -> numeric coefficient. */
type Sym = Map<string, number>;
const MAX_SYM_TERMS = 64;

function atomKey(n: TNode): string | undefined {
  switch (n.n) {
    case 'ref':
      return `r${n.id}`;
    case 'local':
      return `l${n.slot}`;
    case 'const':
      return `c${n.name}`;
    case 'clock':
      return `k${n.which}`;
    case 'field': {
      if (n.args) return undefined;
      const t = atomKey(n.target);
      return t === undefined ? undefined : `${t}.${n.field}`;
    }
    default:
      return undefined;
  }
}

const monoMul = (a: string, b: string): string => {
  const m = new Map<string, number>();
  for (const part of [...(a === '' ? [] : a.split('*')), ...(b === '' ? [] : b.split('*'))]) {
    const at = part.lastIndexOf('^');
    const name = part.slice(0, at);
    m.set(name, (m.get(name) ?? 0) + Number(part.slice(at + 1)));
  }
  return [...m]
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
    .map(([k, e]) => `${k}^${e}`)
    .join('*');
};

function symAdd(a: Sym, b: Sym, sign: 1 | -1): Sym | undefined {
  const out: Sym = new Map(a);
  for (const [k, v] of b) out.set(k, (out.get(k) ?? 0) + sign * v);
  for (const [k, v] of out) if (Math.abs(v) < 1e-12) out.delete(k);
  return out.size > MAX_SYM_TERMS ? undefined : out;
}

function symMul(a: Sym, b: Sym): Sym | undefined {
  const out: Sym = new Map();
  for (const [ka, va] of a) for (const [kb, vb] of b) out.set(monoMul(ka, kb), (out.get(monoMul(ka, kb)) ?? 0) + va * vb);
  for (const [k, v] of out) if (Math.abs(v) < 1e-12) out.delete(k);
  return out.size > MAX_SYM_TERMS ? undefined : out;
}

function symOf(n: TNode): Sym | undefined {
  switch (n.n) {
    case 'num':
      return n.v === 0 ? new Map() : new Map([['', n.v]]);
    case 'unary': {
      if (n.op === 'not') return undefined;
      const a = symOf(n.arg);
      return a && (n.op === '-' ? symAdd(new Map(), a, -1) : a);
    }
    case 'bin': {
      if (n.variant !== 'num') return undefined;
      const l = symOf(n.l);
      const r = symOf(n.r);
      if (!l || !r) return undefined;
      if (n.op === '+') return symAdd(l, r, 1);
      if (n.op === '-') return symAdd(l, r, -1);
      if (n.op === '*') return symMul(l, r);
      if (n.op === '/') {
        if (r.size !== 1 || !r.has('')) return undefined;
        const d = r.get('') as number;
        return new Map([...l].map(([k, v]) => [k, v / d]));
      }
      if (n.op === '^') {
        if (n.r.n !== 'num' || !Number.isInteger(n.r.v) || n.r.v < 0 || n.r.v > 4) return undefined;
        let acc: Sym | undefined = new Map([['', 1]]);
        for (let i = 0; i < n.r.v && acc; i++) acc = symMul(acc, l);
        return acc;
      }
      return undefined;
    }
    default: {
      const key = atomKey(n);
      return key === undefined ? undefined : new Map([[`${key}^1`, 1]]);
    }
  }
}

/**
 * r^2 = (bx^2 + by^2) / (4 xx^2) - c / xx for xx(x^2 + y^2) + bx x + by y + c = 0, worked out over opaque
 * atoms so that `(x - a)^2 + (y + b)^2 == 16` gives exactly 16 whatever a and b are. Undefined when the
 * result still depends on an object (the radius is then not known at check time).
 */
function radiusSquared(xx: number, bx: TNode, by: TNode, c: TNode): number | undefined {
  const sx = symOf(bx);
  const sy = symOf(by);
  const sc = symOf(c);
  if (!sx || !sy || !sc) return undefined;
  const bx2 = symMul(sx, sx);
  const by2 = symMul(sy, sy);
  if (!bx2 || !by2) return undefined;
  const sum = symAdd(bx2, by2, 1);
  if (!sum) return undefined;
  const scaled: Sym = new Map([...sum].map(([k, v]) => [k, v / (4 * xx * xx)]));
  const cTerm: Sym = new Map([...sc].map(([k, v]) => [k, v / xx]));
  const r2 = symAdd(scaled, cTerm, -1);
  if (!r2) return undefined;
  if (r2.size === 0) return 0;
  if (r2.size === 1 && r2.has('')) return r2.get('') as number;
  return undefined;
}
