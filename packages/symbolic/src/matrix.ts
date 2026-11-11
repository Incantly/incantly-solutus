/**
 * Small exact matrices (cas/design.md 2.7, phase 2): determinant, inverse,
 * characteristic polynomial, eigenvalues and eigenvectors for exact matrices up to 4x4.
 * Determinants expand by Leibniz (exact for symbolic entries too); eigenvalues solve the
 * characteristic polynomial over C; eigenvectors come from exact or numeric nullspaces.
 */
import type { SymNode } from './node';
import { add, asRational, constN, divideNodes, floatN, freeSymbols, intN, isZeroNode, mul, negateNode, symN } from './node';
import { evalAt, simplifyNode } from './rules';
import type { RuleCtx } from './rules';
import type { Ticker } from './poly';
import { csolveEquation, evalComplex, rrefRat, Unsupported } from './solve';
import type { Complex } from './solve';

export type Matrix = readonly (readonly SymNode[])[];

export function matrixSize(m: Matrix): number {
  return m.length;
}

export function isSquare(m: Matrix): boolean {
  const n = m.length;
  return n > 0 && m.every((row) => row.length === n);
}

/** Determinant by Leibniz expansion: exact, works for symbolic entries. */
export function determinant(m: Matrix, tick: Ticker): SymNode {
  const n = m.length;
  if (n === 1) return (m[0] as readonly SymNode[])[0] as SymNode;
  let det: SymNode = intN(0);
  const perm = Array.from({ length: n }, (_, i) => i);
  for (;;) {
    let prod: SymNode = intN(1);
    for (let i = 0; i < n; i++) prod = mul(prod, (m[i] as readonly SymNode[])[perm[i] as number] as SymNode);
    let inv = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if ((perm[i] as number) > (perm[j] as number)) inv++;
      }
    }
    det = inv % 2 === 0 ? add(det, prod) : add(det, negateNode(prod));
    tick.tick(n);
    let k = n - 2;
    while (k >= 0 && (perm[k] as number) > (perm[k + 1] as number)) k--;
    if (k < 0) break;
    let l = n - 1;
    while ((perm[l] as number) < (perm[k] as number)) l--;
    const tmp = perm[k] as number;
    perm[k] = perm[l] as number;
    perm[l] = tmp;
    for (let i = k + 1, j = n - 1; i < j; i++, j--) {
      const t = perm[i] as number;
      perm[i] = perm[j] as number;
      perm[j] = t;
    }
  }
  return det;
}

function minor(m: Matrix, r: number, c: number, tick: Ticker): SymNode {
  const sub = m.filter((_, i) => i !== r).map((row) => row.filter((_, j) => j !== c));
  return determinant(sub, tick);
}

/** Inverse by adjugate over determinant. Throws `Singular` (below) when singular. */
export class Singular extends Error {
  readonly rank: number;
  constructor(rank: number) {
    super(`singular matrix of rank ${rank}`);
    this.name = 'Singular';
    this.rank = rank;
  }
}

export function inverse(m: Matrix, ctx: RuleCtx): Matrix {
  const n = m.length;
  const det = simplifyNode(determinant(m, ctx.tick), ctx).node;
  if (isZeroNode(det)) throw new Singular(matrixRank(m));
  if (freeSymbols(det).size === 0) {
    const r = asRational(det);
    if (r !== null && r.n === 0n) throw new Singular(matrixRank(m));
  }
  const adj: SymNode[][] = Array.from({ length: n }, () => new Array<SymNode>(n).fill(intN(0)));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const co = minor(m, j, i, ctx.tick);
      (adj[i] as SymNode[])[j] = (i + j) % 2 === 0 ? co : negateNode(co);
    }
  }
  return adj.map((row) => row.map((x) => simplifyNode(divideNodes(x, det), ctx).node));
}

/** Numeric rank (for the `singular` detail). */
export function matrixRank(m: Matrix): number {
  const rows = m.length;
  const cols = (m[0] as readonly SymNode[]).length;
  const a: number[][] = m.map((row) => row.map((x) => evalAt(x, new Map()) ?? NaN));
  if (a.some((row) => row.some((x) => !Number.isFinite(x)))) return 0;
  let rank = 0;
  const used = new Array<boolean>(rows).fill(false);
  for (let c = 0; c < cols; c++) {
    let piv = -1;
    for (let r = 0; r < rows; r++) {
      if (!used[r] && Math.abs((a[r] as number[])[c] as number) > 1e-12) {
        piv = r;
        break;
      }
    }
    if (piv < 0) continue;
    used[piv] = true;
    rank++;
    for (let r = 0; r < rows; r++) {
      if (r !== piv && Math.abs((a[r] as number[])[c] as number) > 1e-12) {
        const f = ((a[r] as number[])[c] as number) / ((a[piv] as number[])[c] as number);
        for (let k = c; k < cols; k++) (a[r] as number[])[k] = ((a[r] as number[])[k] as number) - f * ((a[piv] as number[])[k] as number);
      }
    }
  }
  return rank;
}

/** Pick `x` for the characteristic variable, else `lam`, `lam1`, … (first free name). */
function charVar(m: Matrix): SymNode {
  const used = new Set<string>();
  for (const row of m) {
    for (const x of row) {
      for (const s of freeSymbols(x)) used.add(s);
    }
  }
  if (!used.has('x')) return symN('x');
  if (!used.has('lam')) return symN('lam');
  let i = 1;
  while (used.has(`lam${i}`)) i++;
  return symN(`lam${i}`);
}

/** `det(M − v·I)` with the characteristic variable chosen by `charVar`. */
export function characteristicPolynomial(m: Matrix, ctx: RuleCtx): { poly: SymNode; v: SymNode } {
  const n = m.length;
  const v = charVar(m);
  const shifted = m.map((row, i) => row.map((x, j) => (i === j ? add(x, negateNode(v)) : x)));
  return { poly: simplifyNode(determinant(shifted, ctx.tick), ctx).node, v };
}

/** Eigenvalues: the characteristic roots over C (exact linears/quadratics, else numeric). */
export function eigenvalues(m: Matrix, ctx: RuleCtx): SymNode[] {
  const { poly, v } = characteristicPolynomial(m, ctx);
  const r = csolveEquation(poly, v, ctx.assume, ctx.tick, ctx.note);
  if (r.all) return [];
  return [...r.solutions];
}

/** One eigenvector per eigenvalue: exact rational nullspace, else numeric complex. */
export function eigenvectors(m: Matrix, ctx: RuleCtx): SymNode[][] {
  const vals = eigenvalues(m, ctx);
  const out: SymNode[][] = [];
  for (const lam of vals) {
    const shifted = m.map((row, i) => row.map((x, j) => (i === j ? add(x, negateNode(lam)) : x)));
    const vec = nullspaceVector(shifted, ctx);
    if (vec === null) throw new Unsupported('eigenvectors of this matrix', 'isolate');
    out.push(vec);
  }
  return out;
}

function nullspaceVector(m: Matrix, ctx: RuleCtx): SymNode[] | null {
  const exact = nullspaceExact(m);
  if (exact !== null) return exact;
  return nullspaceNumeric(m, ctx);
}

/** Exact nullspace when every entry is rational. */
function nullspaceExact(m: Matrix): SymNode[] | null {
  const n = m.length;
  const rats: { n: bigint; d: bigint }[][] = [];
  for (const row of m) {
    const r: { n: bigint; d: bigint }[] = [];
    for (const x of row) {
      const q = asRational(x);
      if (q === null) return null;
      r.push(q);
    }
    rats.push(r);
  }
  let den = 1n;
  for (const row of rats) {
    for (const q of row) den = (den * q.d) / bigGcdLocal(den, q.d);
  }
  const a = rats.map((row) => row.map((q) => q.n * (den / q.d)));
  const b = new Array<bigint>(n).fill(0n);
  const { rows, pivots } = rrefRat(a, b);
  const free = Array.from({ length: n }, (_, i) => i).filter((i) => !pivots.includes(i));
  if (free.length === 0) return null;
  const vec = new Array<SymNode>(n).fill(intN(0));
  const f0 = free[0] as number;
  vec[f0] = intN(1);
  rows.forEach((row) => {
    const piv = row.findIndex((x, j) => j < n && x.n !== 0n);
    if (piv >= 0) {
      const c = row[f0] as { n: bigint; d: bigint };
      vec[piv] = divideNodes(intN(-c.n), intN(c.d));
    }
  });
  return vec;
}

function bigGcdLocal(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a === 0n ? 1n : a;
}

/** Numeric complex nullspace by elimination with partial pivoting. */
function nullspaceNumeric(m: Matrix, ctx: RuleCtx): SymNode[] | null {
  void ctx;
  const n = m.length;
  const a: Complex[][] = [];
  for (const row of m) {
    const r: Complex[] = [];
    for (const x of row) {
      const c = evalComplex(x);
      if (c === null) return null;
      r.push(c);
    }
    a.push(r);
  }
  const col0 = Array.from({ length: n }, (_, i) => i);
  const pivots: number[] = [];
  let r = 0;
  const where = new Array<number>(n).fill(-1);
  for (let c = 0; c < n && r < n; c++) {
    let piv = -1;
    let best = 1e-12;
    for (let i = r; i < n; i++) {
      const mag = Math.hypot((a[i] as Complex[])[c]?.re ?? 0, (a[i] as Complex[])[c]?.im ?? 0);
      if (mag > best) {
        best = mag;
        piv = i;
      }
    }
    if (piv < 0) continue;
    const tmp = a[r] as Complex[];
    a[r] = a[piv] as Complex[];
    a[piv] = tmp;
    const pv = (a[r] as Complex[])[c] as Complex;
    const dd = pv.re * pv.re + pv.im * pv.im;
    for (let j = c; j < n; j++) {
      const cell = (a[r] as Complex[])[j] as Complex;
      (a[r] as Complex[])[j] = { re: (cell.re * pv.re + cell.im * pv.im) / dd, im: (cell.im * pv.re - cell.re * pv.im) / dd };
    }
    for (let i = 0; i < n; i++) {
      if (i === r) continue;
      const f = (a[i] as Complex[])[c] as Complex;
      if (f.re === 0 && f.im === 0) continue;
      for (let j = c; j < n; j++) {
        const cell = (a[i] as Complex[])[j] as Complex;
        const sub = (a[r] as Complex[])[j] as Complex;
        (a[i] as Complex[])[j] = {
          re: cell.re - (f.re * sub.re - f.im * sub.im),
          im: cell.im - (f.re * sub.im + f.im * sub.re),
        };
      }
    }
    where[c] = r;
    pivots.push(c);
    r++;
  }
  const free = col0.filter((c) => where[c] === -1);
  if (free.length === 0) return null;
  const f0 = free[0] as number;
  const vec: Complex[] = Array.from({ length: n }, () => ({ re: 0, im: 0 }));
  vec[f0] = { re: 1, im: 0 };
  for (let c = 0; c < n; c++) {
    if (where[c] >= 0) {
      const cell = (a[where[c] as number] as Complex[])[f0] as Complex;
      vec[c] = { re: -cell.re, im: -cell.im };
    }
  }
  const i = constN('i');
  return vec.map((z) => {
    const re = Math.abs(z.re) < 1e-12 ? 0 : z.re;
    const im = Math.abs(z.im) < 1e-12 ? 0 : z.im;
    if (im === 0) return floatN(re);
    if (re === 0) return im === 1 ? i : mul(floatN(im), i);
    return add(floatN(re), mul(floatN(im), i));
  });
}
