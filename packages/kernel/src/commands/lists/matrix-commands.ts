/**
 * Matrix commands (design 5.2, 6.1, 6.2): makers, everyday operations, factorisations and eigen-anything. A
 * `List<List<Number>>` is accepted wherever a matrix is, and converted once (rectangular check included).
 */
import type { CommandRule, RuleCall } from '../../graph/registry';
import type { FunctionValue } from '../../language/runtime';
import type { CommandForm, CommandSpec, ParamSpec, Refusal } from '../../language/table';
import type { TNode } from '../../language/tnode';
import {
  RAT_ONE, RAT_ZERO, eCharPoly, eDet, eInverse, eMinPoly, eMul, eNullSpace, eRref, eTranspose, exactMatrix, ratFromText, rdiv, rneg, rnum, usable,
} from './exact';
import {
  EPS, cholesky, det, eigenvalues, eigenvector, inverse, isSymmetric, leastSquares, lu, matMul, norm1, normFro, normInf, qr, rankOf, rref, solveSquare, svd, symEigen, transpose,
} from './linalg';
import type { MatrixValue, Rat } from './types';
import { MAX_DENSE, MAX_EIGEN, MAX_EXACT, MAX_LEAVES, MAX_SYM_EIGEN, identity, isMatrix, itemsOf, makeMatrix, record } from './types';

/* ------------------------------ spec helpers ------------------------------ */

const p = (name: string, type: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ name, type, ...extra });
const MAT = 'Matrix|List<List<Number>>';
const m = (name = 'M'): ParamSpec => p(name, MAT);

function form(params: readonly ParamSpec[], returns: string, run: (call: RuleCall) => unknown, summary: string, extra: Partial<CommandForm> = {}): CommandForm {
  const rule = (): CommandRule => ({ run });
  return { params, returns, rule, summary, ...extra };
}

const spec = (name: string, forms: readonly CommandForm[]): CommandSpec => ({ name, kind: 'object', group: 'matrices', forms });

const shape = (a: MatrixValue): string => `${a.rows}×${a.cols}`;

/* ------------------------------ conversions ------------------------------ */

/** A matrix from a list of equal-length number lists, or the reason it is not one. */
export function fromLists(v: unknown): MatrixValue | { reason: 'not_rectangular' | 'input_undefined'; detail: string } {
  const rows = itemsOf(v);
  if (!rows) return { reason: 'input_undefined', detail: 'the rows are undefined' };
  const r = rows.length;
  const first = itemsOf(rows[0]);
  const c = first ? first.length : 0;
  if (r * c > MAX_LEAVES) return { reason: 'not_rectangular', detail: `${r}×${c} is more than ${MAX_LEAVES} entries` };
  const data = new Float64Array(r * c);
  for (let i = 0; i < r; i++) {
    const row = itemsOf(rows[i]);
    if (!row) return { reason: 'input_undefined', detail: `row ${i + 1} is undefined` };
    if (row.length !== c) return { reason: 'not_rectangular', detail: `row ${i + 1} has ${row.length} entries, row 1 has ${c}` };
    for (let j = 0; j < c; j++) data[i * c + j] = row[j] as number;
  }
  return makeMatrix(r, c, data);
}

/** The matrix argument at `i`, converting a list of lists; sets the reason when it cannot. */
function mat(call: RuleCall, i: number): MatrixValue | undefined {
  const v = call.values[i];
  if (isMatrix(v)) return v;
  const f = fromLists(v);
  if (isMatrix(f)) return f;
  call.fail(f.reason, f.detail);
  return undefined;
}

function square(call: RuleCall, a: MatrixValue, limit = MAX_DENSE): boolean {
  if (a.rows !== a.cols) {
    call.fail('not_square', `the matrix is ${shape(a)}`);
    return false;
  }
  if (a.rows > limit) {
    call.fail('too_large', `this command supports up to ${limit}×${limit}, got ${shape(a)}`);
    return false;
  }
  return true;
}

const toLists = (a: MatrixValue): Float64Array[] => Array.from({ length: a.rows }, (_, i) => a.data.slice(i * a.cols, (i + 1) * a.cols));

/* ------------------------------ the exact grid of a literal ------------------------------ */

/** The exact value of a literal entry: a number, `-x`, or `a / b` of literals (design 5.3). */
function exactLeaf(t: TNode): Rat | undefined {
  if (t.n === 'num') return ratFromText(String(t.v));
  if (t.n === 'unary' && t.op === '-') {
    const a = exactLeaf(t.arg);
    return a ? rneg(a) : undefined;
  }
  if (t.n === 'unary' && t.op === '+') return exactLeaf(t.arg);
  if (t.n === 'bin' && t.op === '/' && t.variant === 'num') {
    const a = exactLeaf(t.l);
    const b = exactLeaf(t.r);
    return a && b && b.n !== 0n ? rdiv(a, b) : undefined;
  }
  return undefined;
}

/** The exact grid of `Matrix([[…], …])` when every entry is a literal, else undefined. */
function literalGrid(tree: unknown): { rows: number; cols: number; e: Rat[] } | undefined {
  const t = tree as TNode | undefined;
  if (!t || t.n !== 'list') return undefined;
  const e: Rat[] = [];
  let cols = -1;
  for (const row of t.items) {
    if (row.n !== 'list') return undefined;
    if (cols === -1) cols = row.items.length;
    if (row.items.length !== cols) return undefined;
    for (const x of row.items) {
      const r = exactLeaf(x);
      if (!r) return undefined;
      e.push(r);
    }
  }
  return cols > 0 && t.items.length <= MAX_EXACT && cols <= MAX_EXACT ? { rows: t.items.length, cols, e } : undefined;
}

/** A ragged literal is `bad_argument` at check time (errors 6). */
function raggedLiteral(c: { args: readonly { literal: unknown; text: string }[] }): Refusal | undefined {
  const v = c.args[0]?.literal;
  if (!Array.isArray(v)) return undefined;
  const lens = v.map((row) => (Array.isArray(row) ? row.length : -1));
  const first = lens[0] ?? 0;
  const bad = lens.findIndex((l) => l !== first);
  if (bad < 0) return undefined;
  return {
    kind: 'bad_argument',
    message: `Matrix needs rows of equal length: row 1 has ${first} entries, row ${bad + 1} has ${lens[bad]}.`,
    param: 0,
    hint: `Give row ${bad + 1} ${first} entries.`,
    params: { command: 'Matrix', why: 'rows of equal length' },
  };
}

/* ------------------------------ makers ------------------------------ */

function matrixRule(args: readonly { expr?: unknown }[]): CommandRule {
  const grid = literalGrid(args[0]?.expr);
  return {
    run(call: RuleCall) {
      if (grid) {
        const e = exactMatrix(grid.rows, grid.cols, grid.e);
        if (e) return e;
      }
      const f = fromLists(call.values[0]);
      if (isMatrix(f)) return f;
      return call.fail(f.reason, f.detail);
    },
  };
}

function runGenerator(call: RuleCall): unknown {
  const r = call.values[0];
  const c = call.values[1];
  if (typeof r !== 'number' || typeof c !== 'number' || !Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0) return call.fail('not_integer', 'rows and columns must be whole numbers from 0');
  if (r * c > MAX_LEAVES) return call.fail('too_large', `${r}×${c} is too many entries`);
  const ev = call.args[2]?.eval;
  const si = call.args[3]?.slot;
  const sj = call.args[4]?.slot;
  if (!ev || si === undefined || sj === undefined) return call.fail('input_undefined', 'the entry formula could not run');
  const env = call.env;
  const data = new Float64Array(r * c);
  const saved = [env.locals[si], env.locals[sj]];
  try {
    for (let i = 0; i < r; i++) {
      for (let j = 0; j < c; j++) {
        env.locals[si] = i + 1;
        env.locals[sj] = j + 1;
        env.reason = undefined;
        const v = ev(env);
        if (typeof v !== 'number' || v !== v) return call.fail('has_undefined', `entry ${i + 1},${j + 1} is undefined (${env.reason ?? 'input_undefined'})`);
        data[i * c + j] = v;
      }
    }
  } finally {
    env.locals[si] = saved[0];
    env.locals[sj] = saved[1];
  }
  return makeMatrix(r, c, data);
}

function size(call: RuleCall, i: number): number | undefined {
  const n = call.values[i];
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
    call.fail('not_integer', `a size must be a whole number from 0, not ${String(n)}`);
    return undefined;
  }
  if (n > MAX_DENSE * 10) {
    call.fail('too_large', `${n} is too large`);
    return undefined;
  }
  return n;
}

const literalSize = (...idx: number[]) => (c: { args: readonly { literal: unknown }[] }): Refusal | undefined => {
  for (const i of idx) {
    const v = c.args[i]?.literal;
    if (typeof v === 'number' && (!Number.isInteger(v) || v < 0)) return { kind: 'bad_argument', message: `A size must be a whole number from 0, not ${v}.`, param: i, params: { command: 'Matrix', why: 'a whole size' } };
    if (typeof v === 'number' && v > MAX_DENSE * 10) return { kind: 'limit', message: `A matrix side is at most ${MAX_DENSE * 10}; this asks for ${v}.`, param: i, limit: { name: 'matrix_size', max: MAX_DENSE * 10, got: v } };
  }
  return undefined;
};

function runIdentity(call: RuleCall): unknown {
  const n = size(call, 0);
  if (n === undefined) return undefined;
  if (n <= MAX_EXACT) {
    const e: Rat[] = new Array<Rat>(n * n).fill(RAT_ZERO);
    for (let i = 0; i < n; i++) e[i * n + i] = RAT_ONE;
    return exactMatrix(n, n, e) ?? identity(n);
  }
  return identity(n);
}

function runZeros(call: RuleCall): unknown {
  const r = size(call, 0);
  const c = size(call, 1);
  if (r === undefined || c === undefined) return undefined;
  if (r <= MAX_EXACT && c <= MAX_EXACT) return exactMatrix(r, c, new Array<Rat>(r * c).fill(RAT_ZERO));
  return makeMatrix(r, c, new Float64Array(r * c));
}

function runDiagList(call: RuleCall): unknown {
  const v = call.values[0];
  if (!(v instanceof Float64Array)) return call.fail('input_undefined', 'the list is undefined');
  const n = v.length;
  const d = new Float64Array(n * n);
  for (let i = 0; i < n; i++) d[i * n + i] = v[i] as number;
  return makeMatrix(n, n, d);
}

function runDiagOf(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a) return undefined;
  const k = Math.min(a.rows, a.cols);
  return Float64Array.from({ length: k }, (_, i) => a.data[i * a.cols + i] as number);
}

function runFromCols(call: RuleCall): unknown {
  const f = fromLists(call.values[0]);
  if (!isMatrix(f)) return call.fail(f.reason, f.detail);
  return makeMatrix(f.cols, f.rows, transpose(f.data, f.rows, f.cols));
}

function runStack(horizontal: boolean) {
  return (call: RuleCall): unknown => {
    const ms: MatrixValue[] = [];
    for (let i = 0; i < call.values.length; i++) {
      const a = mat(call, i);
      if (!a) return undefined;
      ms.push(a);
    }
    const first = ms[0] as MatrixValue;
    if (horizontal) {
      if (ms.some((x) => x.rows !== first.rows)) return call.fail('size_mismatch', `row counts ${ms.map((x) => x.rows).join(', ')}`);
      const cols = ms.reduce((s, x) => s + x.cols, 0);
      const d = new Float64Array(first.rows * cols);
      let off = 0;
      for (const x of ms) {
        for (let i = 0; i < x.rows; i++) for (let j = 0; j < x.cols; j++) d[i * cols + off + j] = x.data[i * x.cols + j] as number;
        off += x.cols;
      }
      return makeMatrix(first.rows, cols, d);
    }
    if (ms.some((x) => x.cols !== first.cols)) return call.fail('size_mismatch', `column counts ${ms.map((x) => x.cols).join(', ')}`);
    const rows = ms.reduce((s, x) => s + x.rows, 0);
    const d = new Float64Array(rows * first.cols);
    let off = 0;
    for (const x of ms) {
      d.set(x.data, off);
      off += x.data.length;
    }
    return makeMatrix(rows, first.cols, d);
  };
}

/** A 1-based or negative position along a side of length `len`, as 0-based. */
function pos(call: RuleCall, i: number, len: number, what: string): number | undefined {
  const k = call.values[i];
  if (typeof k !== 'number' || !Number.isInteger(k) || k === 0) {
    call.fail('not_integer', `${what} must be a whole number, not 0`);
    return undefined;
  }
  const idx = k > 0 ? k - 1 : len + k;
  if (idx < 0 || idx >= len) {
    call.fail('index_out_of_range', `the matrix has ${len} ${what}s, asked for ${k}`);
    return undefined;
  }
  return idx;
}

function runSubmatrix(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a) return undefined;
  const r1 = pos(call, 1, a.rows, 'row');
  const r2 = pos(call, 2, a.rows, 'row');
  const c1 = pos(call, 3, a.cols, 'column');
  const c2 = pos(call, 4, a.cols, 'column');
  if (r1 === undefined || r2 === undefined || c1 === undefined || c2 === undefined) return undefined;
  if (r2 < r1 || c2 < c1) return call.fail('bad_argument', 'the ranges run from low to high');
  const rows = r2 - r1 + 1;
  const cols = c2 - c1 + 1;
  const d = new Float64Array(rows * cols);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) d[i * cols + j] = a.data[(r1 + i) * a.cols + c1 + j] as number;
  const e = a.exact ? Array.from({ length: rows * cols }, (_, k) => a.exact?.[(r1 + Math.floor(k / cols)) * a.cols + c1 + (k % cols)] as Rat) : undefined;
  return makeMatrix(rows, cols, d, e);
}

function runRowCol(col: boolean) {
  return (call: RuleCall): unknown => {
    const a = mat(call, 0);
    if (!a) return undefined;
    const k = pos(call, 1, col ? a.cols : a.rows, col ? 'column' : 'row');
    if (k === undefined) return undefined;
    return col ? Float64Array.from({ length: a.rows }, (_, i) => a.data[i * a.cols + k] as number) : a.data.slice(k * a.cols, (k + 1) * a.cols);
  };
}

/** The matrix without row i and column j. */
function minorOf(a: MatrixValue, i: number, j: number): MatrixValue {
  const rows = a.rows - 1;
  const cols = a.cols - 1;
  const d = new Float64Array(rows * cols);
  const e: Rat[] | undefined = a.exact ? [] : undefined;
  let k = 0;
  for (let r = 0; r < a.rows; r++) {
    if (r === i) continue;
    for (let c = 0; c < a.cols; c++) {
      if (c === j) continue;
      d[k++] = a.data[r * a.cols + c] as number;
      e?.push(a.exact?.[r * a.cols + c] as Rat);
    }
  }
  return makeMatrix(rows, cols, d, e);
}

function runMinor(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a) return undefined;
  const i = pos(call, 1, a.rows, 'row');
  const j = pos(call, 2, a.cols, 'column');
  if (i === undefined || j === undefined) return undefined;
  return minorOf(a, i, j);
}

/* ------------------------------ everyday operations ------------------------------ */

function runTranspose(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a) return undefined;
  return makeMatrix(a.cols, a.rows, transpose(a.data, a.rows, a.cols), a.exact ? eTranspose(a.exact, a.rows, a.cols) : undefined);
}

function determinantOf(a: MatrixValue): number {
  if (usable(a)) return rnum(eDet(a.exact, a.rows));
  return det(a.data, a.rows);
}

function runDeterminant(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a || !square(call, a)) return undefined;
  const d = determinantOf(a);
  return Number.isFinite(d) ? d : call.fail('not_finite', `the determinant is ${d}`);
}

function condEstimate(a: MatrixValue, inv: Float64Array): number {
  return normInf(a.data, a.rows, a.cols) * normInf(inv, a.rows, a.cols);
}

function runInvert(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a || !square(call, a)) return undefined;
  const n = a.rows;
  if (usable(a)) {
    const inv = eInverse(a.exact, n);
    if (!inv) return call.fail('singular', 'determinant is 0 (exact)');
    const e = exactMatrix(n, n, inv);
    if (e) return e;
  }
  const inv = inverse(a.data, n);
  if (!inv) return call.fail('singular', 'a pivot is below the tolerance');
  const cond = condEstimate(a, inv);
  if (cond > 1e12) call.notify('ill_conditioned', { cond: Number(cond.toPrecision(2)) });
  return makeMatrix(n, n, inv);
}

function runRank(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a) return undefined;
  const tolGiven = call.args[1] && !call.args[1].omitted;
  if (!tolGiven && usable(a)) return eRref(a.exact, a.rows, a.cols).pivots.length;
  if (Math.max(a.rows, a.cols) > MAX_EIGEN) {
    const tol = tolGiven ? (call.values[1] as number) : undefined;
    return rref(a.data, a.rows, a.cols, tol).pivots.length;
  }
  const s = svd(a.data, a.rows, a.cols);
  if ('reason' in s) return call.fail('no_convergence', s.reason);
  return rankOf(s.s, a.rows, a.cols, tolGiven ? (call.values[1] as number) : undefined);
}

function runRref(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a) return undefined;
  if (usable(a)) {
    const e = exactMatrix(a.rows, a.cols, eRref(a.exact, a.rows, a.cols).m);
    if (e) return e;
  }
  return makeMatrix(a.rows, a.cols, rref(a.data, a.rows, a.cols).m);
}

/** The exact values of numbers that are all short decimals (at most 9 significant digits), else undefined. */
function shortDecimals(xs: Float64Array): Rat[] | undefined {
  const out: Rat[] = [];
  for (const x of xs) {
    const r = Number.isFinite(x) ? ratFromText(String(x)) : undefined;
    if (!r) return undefined;
    out.push(r);
  }
  return out;
}

function runSolve(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a) return undefined;
  const bv = call.values[1];
  const asList = bv instanceof Float64Array;
  const b = asList ? makeMatrix(bv.length, 1, bv) : mat(call, 1);
  if (!b) return undefined;
  if (b.rows !== a.rows) return call.fail('size_mismatch', `${shape(a)} and a right side of ${b.rows} rows`);
  if (Math.max(a.rows, a.cols) > MAX_DENSE) return call.fail('too_large', `Solve supports up to ${MAX_DENSE}×${MAX_DENSE}`);
  const result = (x: Float64Array, ex?: Rat[]): unknown => (asList ? x : makeMatrix(a.cols, b.cols, x, ex));
  if (a.rows === a.cols) {
    // an exact matrix with a right side of short decimals (a literal list, a slider on a 0.1 step) stays exact
    const bExact = b.exact ?? shortDecimals(b.data);
    if (usable(a) && bExact) {
      const inv = eInverse(a.exact, a.rows);
      if (!inv) return call.fail('singular', 'determinant is 0 (exact); try NullSpace');
      const e = eMul(inv, a.rows, a.rows, bExact, b.cols);
      const ex = exactMatrix(a.rows, b.cols, e);
      if (ex) return asList ? ex.data : ex;
    }
    const x = solveSquare(a.data, a.rows, b.data, b.cols);
    if (!x) return call.fail('singular', 'a pivot is below the tolerance; try NullSpace');
    return result(x);
  }
  if (a.rows < a.cols) return call.fail('singular', 'more unknowns than equations; NullSpace gives the free directions');
  const x = leastSquares(a.data, a.rows, a.cols, b.data, b.cols);
  if (!x) return call.fail('singular', 'the columns are dependent');
  call.notify('least_squares', {});
  return result(x);
}

function runNullSpace(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a) return undefined;
  if (usable(a)) {
    const { data, k } = eNullSpace(a.exact, a.rows, a.cols);
    return exactMatrix(a.cols, k, data) ?? makeMatrix(a.cols, k, Float64Array.from(data, rnum));
  }
  if (Math.max(a.rows, a.cols) > MAX_EIGEN) return call.fail('too_large', `NullSpace supports up to ${MAX_EIGEN}×${MAX_EIGEN}`);
  const s = svd(a.data, a.rows, a.cols);
  if ('reason' in s) return call.fail('no_convergence', s.reason);
  // with a thin SVD of a wide matrix V is c×r; complete the null space from the full V of AᵀA when needed
  const r = rankOf(s.s, a.rows, a.cols);
  const ata = matMul(transpose(a.data, a.rows, a.cols), a.cols, a.rows, a.data, a.cols);
  const e = symEigen(ata, a.cols);
  if ('reason' in e) return call.fail('no_convergence', e.reason);
  const order = Array.from({ length: a.cols }, (_, i) => i).sort((x, y) => (e.values[x] as number) - (e.values[y] as number));
  const k = a.cols - r;
  const d = new Float64Array(a.cols * k);
  for (let col = 0; col < k; col++) for (let i = 0; i < a.cols; i++) d[i * k + col] = e.vectors[i * a.cols + (order[col] as number)] as number;
  return makeMatrix(a.cols, k, d);
}

function runColSpace(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a) return undefined;
  const pivots = usable(a) ? eRref(a.exact, a.rows, a.cols).pivots : rref(a.data, a.rows, a.cols).pivots;
  const k = pivots.length;
  const d = new Float64Array(a.rows * k);
  pivots.forEach((pc, col) => {
    for (let i = 0; i < a.rows; i++) d[i * k + col] = a.data[i * a.cols + pc] as number;
  });
  return makeMatrix(a.rows, k, d);
}

const NORMS = ['fro', '1', 'inf', '2'];

function runNorm(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a) return undefined;
  const kind = call.args[1] && !call.args[1].omitted ? String(call.values[1]) : 'fro';
  if (kind === 'fro') return normFro(a.data);
  if (kind === '1') return norm1(a.data, a.rows, a.cols);
  if (kind === 'inf') return normInf(a.data, a.rows, a.cols);
  if (kind === '2') {
    const s = svd(a.data, a.rows, a.cols);
    if ('reason' in s) return call.fail('no_convergence', s.reason);
    return s.s.length > 0 ? s.s[0] : 0;
  }
  return call.fail('bad_argument', `the norm is "fro", "1", "inf" or "2", not "${kind}"`);
}

const literalNorm = (c: { args: readonly { literal: unknown }[] }): Refusal | undefined => {
  const v = c.args[1]?.literal;
  if (typeof v === 'string' && !NORMS.includes(v)) return { kind: 'bad_option', message: `The norm is "fro", "1", "inf" or "2", not "${v}".`, param: 1, params: { command: 'Norm', why: `The norm is "fro", "1", "inf" or "2", not "${v}".` }, hint: 'Norm(M, "2") is the largest singular value.' };
  return undefined;
};

function runCond(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a) return undefined;
  if (Math.max(a.rows, a.cols) > MAX_EIGEN) return call.fail('too_large', `Cond supports up to ${MAX_EIGEN}×${MAX_EIGEN}`);
  const s = svd(a.data, a.rows, a.cols);
  if ('reason' in s) return call.fail('no_convergence', s.reason);
  const smin = s.s[s.s.length - 1] ?? 0;
  const smax = s.s[0] ?? 0;
  return smin <= EPS * smax * Math.max(a.rows, a.cols) ? Infinity : smax / smin;
}

function runDim(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a) return undefined;
  return Float64Array.from([a.rows, a.cols]);
}

function cofactorOf(a: MatrixValue, i: number, j: number): number {
  const mi = minorOf(a, i, j);
  const d = mi.rows === 0 ? 1 : determinantOf(mi);
  return (i + j) % 2 === 0 ? d : -d;
}

function runCofactor(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a || !square(call, a)) return undefined;
  const i = pos(call, 1, a.rows, 'row');
  const j = pos(call, 2, a.cols, 'column');
  if (i === undefined || j === undefined) return undefined;
  return cofactorOf(a, i, j);
}

function runAdjugate(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a || !square(call, a, 30)) return undefined;
  const n = a.rows;
  if (usable(a)) {
    // adj(A)_{ji} = cofactor_{ij}, exactly
    const e: Rat[] = new Array<Rat>(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const mi = minorOf(a, i, j);
        const d = mi.rows === 0 ? RAT_ONE : eDet(mi.exact as Rat[], mi.rows);
        e[j * n + i] = (i + j) % 2 === 0 ? d : rneg(d);
      }
    }
    const ex = exactMatrix(n, n, e);
    if (ex) return ex;
  }
  const d = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) d[j * n + i] = cofactorOf(a, i, j);
  return makeMatrix(n, n, d);
}

function runKron(call: RuleCall): unknown {
  const a = mat(call, 0);
  const b = mat(call, 1);
  if (!a || !b) return undefined;
  const rows = a.rows * b.rows;
  const cols = a.cols * b.cols;
  if (rows * cols > MAX_LEAVES) return call.fail('too_large', `${rows}×${cols} is too many entries`);
  const d = new Float64Array(rows * cols);
  for (let i = 0; i < a.rows; i++)
    for (let j = 0; j < a.cols; j++)
      for (let k = 0; k < b.rows; k++)
        for (let l = 0; l < b.cols; l++) d[(i * b.rows + k) * cols + j * b.cols + l] = (a.data[i * a.cols + j] as number) * (b.data[k * b.cols + l] as number);
  return makeMatrix(rows, cols, d);
}

/* ------------------------------ factorisations ------------------------------ */

function runLU(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a || !square(call, a)) return undefined;
  const n = a.rows;
  const f = lu(a.data, n);
  const L = new Float64Array(n * n);
  const U = new Float64Array(n * n);
  const P = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (j < i) L[i * n + j] = f.lu[i * n + j] as number;
      else U[i * n + j] = f.lu[i * n + j] as number;
    }
    L[i * n + i] = 1;
    P[i * n + (f.perm[i] as number)] = 1;
  }
  return record('LU', { L: makeMatrix(n, n, L), U: makeMatrix(n, n, U), P: makeMatrix(n, n, P) });
}

function runQR(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a) return undefined;
  if (Math.max(a.rows, a.cols) > MAX_DENSE) return call.fail('too_large', `QR supports up to ${MAX_DENSE}×${MAX_DENSE}`);
  const { q, r } = qr(a.data, a.rows, a.cols);
  const k = Math.min(a.rows, a.cols);
  return record('QR', { Q: makeMatrix(a.rows, k, q), R: makeMatrix(k, a.cols, r) });
}

function runCholesky(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a || !square(call, a)) return undefined;
  if (!isSymmetric(a.data, a.rows)) return call.fail('not_positive_definite', 'the matrix is not symmetric');
  const f = cholesky(a.data, a.rows);
  if ('minor' in f) return call.fail('not_positive_definite', `leading minor ${f.minor} is not positive`);
  return makeMatrix(a.rows, a.rows, f.l);
}

function runSVD(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a) return undefined;
  if (Math.max(a.rows, a.cols) > MAX_EIGEN) return call.fail('too_large', `SVD supports up to ${MAX_EIGEN}×${MAX_EIGEN}, got ${shape(a)}`);
  const s = svd(a.data, a.rows, a.cols);
  if ('reason' in s) return call.fail('no_convergence', s.reason);
  const k = s.s.length;
  return record('SVD', { U: makeMatrix(a.rows, k, s.u), S: s.s, V: makeMatrix(a.cols, k, s.v) });
}

/* ------------------------------ eigen-anything ------------------------------ */

interface EigenParts {
  readonly values: { x: number; y: number }[];
  /** Columns, unit length, in the order of `values`; undefined when an eigenvalue is complex or a vector failed. */
  readonly vectors?: MatrixValue;
  readonly vectorsWhy?: string;
  readonly multiplicities: Float64Array;
  readonly defective: boolean;
}

const byReIm = (a: { x: number; y: number }, b: { x: number; y: number }): number => a.x - b.x || a.y - b.y;

function eigenParts(call: RuleCall, a: MatrixValue): EigenParts | undefined {
  const n = a.rows;
  const sym = isSymmetric(a.data, n);
  if (n > (sym ? MAX_SYM_EIGEN : MAX_EIGEN)) {
    call.fail('too_large', `eigenvalues of this kind go up to ${sym ? MAX_SYM_EIGEN : MAX_EIGEN}×${sym ? MAX_SYM_EIGEN : MAX_EIGEN}, got ${shape(a)}`);
    return undefined;
  }
  const scale = Math.max(normInf(a.data, n, n), Number.MIN_VALUE);
  const cluster = 1e-8 * scale;
  if (sym) {
    const e = symEigen(a.data, n);
    if ('reason' in e) {
      call.fail('no_convergence', e.reason);
      return undefined;
    }
    const order = Array.from({ length: n }, (_, i) => i).sort((x, y) => (e.values[x] as number) - (e.values[y] as number));
    const values = order.map((i) => ({ x: e.values[i] as number, y: 0 }));
    const d = new Float64Array(n * n);
    order.forEach((from, to) => {
      for (let i = 0; i < n; i++) d[i * n + to] = e.vectors[i * n + from] as number;
    });
    return { values, vectors: makeMatrix(n, n, d), multiplicities: multiplicities(values, cluster), defective: false };
  }
  const ev = eigenvalues(a.data, n);
  if ('reason' in ev) {
    call.fail('no_convergence', ev.reason);
    return undefined;
  }
  const values = Array.from({ length: n }, (_, i) => ({ x: ev.re[i] as number, y: Math.abs(ev.im[i] as number) < cluster ? 0 : (ev.im[i] as number) })).sort(byReIm);
  const mult = multiplicities(values, cluster);
  const complex = values.filter((v) => v.y !== 0).length;
  if (complex > 0) return { values, vectorsWhy: `${complex} of ${n} eigenvalues are complex`, multiplicities: mult, defective: false };
  const d = new Float64Array(n * n);
  let defective = false;
  // one vector per distinct eigenvalue from inverse iteration; a repeated eigenvalue gets the null space of A − λI
  let col = 0;
  for (let k = 0; k < n; ) {
    const lam = (values[k] as { x: number }).x;
    let reps = 1;
    while (k + reps < n && Math.abs((values[k + reps] as { x: number }).x - lam) <= cluster) reps++;
    const shifted = Float64Array.from(a.data);
    for (let i = 0; i < n; i++) shifted[i * n + i] = (shifted[i * n + i] as number) - lam;
    let vecs: Float64Array[] = [];
    if (reps === 1) {
      const v = eigenvector(a.data, n, lam);
      if (v) vecs = [v];
    } else {
      const s = svd(shifted, n, n);
      if (!('reason' in s)) {
        const tol = Math.max(1e-8 * scale, n * EPS * (s.s[0] ?? 0));
        for (let j = n - 1; j >= 0 && vecs.length < reps; j--) {
          if ((s.s[j] as number) > tol) break;
          vecs.push(Float64Array.from({ length: n }, (_, i) => s.v[i * n + j] as number));
        }
      }
    }
    if (vecs.length < reps) defective = true;
    for (let r = 0; r < reps; r++) {
      const v = vecs[Math.min(r, vecs.length - 1)];
      if (v) for (let i = 0; i < n; i++) d[i * n + col] = v[i] as number;
      col++;
    }
    k += reps;
  }
  return { values, vectors: makeMatrix(n, n, d), multiplicities: mult, defective };
}

function multiplicities(values: readonly { x: number; y: number }[], tol: number): Float64Array {
  const out: number[] = [];
  for (let k = 0; k < values.length; ) {
    let reps = 1;
    const v = values[k] as { x: number; y: number };
    while (k + reps < values.length && Math.hypot((values[k + reps] as { x: number }).x - v.x, (values[k + reps] as { y: number }).y - v.y) <= tol) reps++;
    out.push(reps);
    k += reps;
  }
  return Float64Array.from(out);
}

function runEigenvalues(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a || !square(call, a, MAX_SYM_EIGEN)) return undefined;
  return eigenParts(call, a)?.values;
}

function runEigenvectors(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a || !square(call, a, MAX_SYM_EIGEN)) return undefined;
  const e = eigenParts(call, a);
  if (!e) return undefined;
  if (!e.vectors) return call.fail('complex_eigenvalues', e.vectorsWhy ?? 'an eigenvalue is complex');
  return e.vectors;
}

function runEigen(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a || !square(call, a, MAX_SYM_EIGEN)) return undefined;
  const e = eigenParts(call, a);
  if (!e) return undefined;
  return record(
    'Eigen',
    { values: e.values, vectors: e.vectors, multiplicities: e.multiplicities, defective: e.defective },
    e.vectors ? undefined : { vectors: 'complex_eigenvalues' },
  );
}

function runDiagonalize(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a || !square(call, a, MAX_EIGEN)) return undefined;
  const e = eigenParts(call, a);
  if (!e) return undefined;
  if (!e.vectors) return call.fail('complex_eigenvalues', e.vectorsWhy ?? 'an eigenvalue is complex');
  const n = a.rows;
  if (e.defective) return call.fail('needs_exact', 'the matrix is not diagonalisable; its Jordan form is to be implemented');
  const D = new Float64Array(n * n);
  e.values.forEach((v, i) => {
    D[i * n + i] = v.x;
  });
  return record('Diagonalize', { P: e.vectors, D: makeMatrix(n, n, D), jordan: false });
}

/** A polynomial as a function of x (coefficients highest power first). */
function polyFunction(coeffs: readonly number[]): FunctionValue {
  const f = (x: number): number => {
    let s = 0;
    for (const c of coeffs) s = s * x + c;
    return s;
  };
  const fv: FunctionValue = {
    arity: 1,
    ret: 'Number',
    reason: undefined,
    call: (...xs: number[]) => (typeof xs[0] === 'number' ? f(xs[0]) : Number.NaN),
    call1: f,
    batch: (xs: Float64Array, o: Float64Array) => {
      for (let i = 0; i < xs.length; i++) o[i] = f(xs[i] as number);
    },
  };
  return fv;
}

function runCharPoly(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a || !square(call, a, MAX_EIGEN)) return undefined;
  const n = a.rows;
  if (usable(a)) return polyFunction(eCharPoly(a.exact, n).map(rnum));
  // float path via the eigenvalues: the product of (x − λ), flagged approximate
  const e = eigenvalues(a.data, n);
  if ('reason' in e) return call.fail('no_convergence', e.reason);
  let re = [1];
  let im = [0];
  for (let k = 0; k < n; k++) {
    const lr = e.re[k] as number;
    const li = e.im[k] as number;
    const nr = new Array<number>(re.length + 1).fill(0);
    const ni = new Array<number>(re.length + 1).fill(0);
    for (let i = 0; i < re.length; i++) {
      nr[i] = (nr[i] as number) + (re[i] as number);
      ni[i] = (ni[i] as number) + (im[i] as number);
      nr[i + 1] = (nr[i + 1] as number) - ((re[i] as number) * lr - (im[i] as number) * li);
      ni[i + 1] = (ni[i + 1] as number) - ((re[i] as number) * li + (im[i] as number) * lr);
    }
    re = nr;
    im = ni;
  }
  call.notify('approximate', {});
  return polyFunction(re);
}

function runMinPoly(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a || !square(call, a, MAX_EXACT)) return undefined;
  if (!usable(a)) return call.fail('needs_exact', 'entries are not small rationals; write whole numbers or short decimals');
  return polyFunction(eMinPoly(a.exact, a.rows).map(rnum));
}

function runToLists(call: RuleCall): unknown {
  const a = mat(call, 0);
  if (!a) return undefined;
  return toLists(a);
}

/* ------------------------------ the table ------------------------------ */

export const MATRIX_COMMANDS: readonly CommandSpec[] = [
  spec('Matrix', [
    { params: [p('rows', 'List<List<Number>>')], returns: 'Matrix', rule: (args) => matrixRule(args as readonly { expr?: unknown }[]), summary: 'a matrix from its rows', check: raggedLiteral },
    form([p('rows', 'Number'), p('cols', 'Number'), p('expr', 'Number', { kind: 'body' }), p('i', 'Number', { kind: 'binder' }), p('j', 'Number', { kind: 'binder' })], 'Matrix', runGenerator, 'the matrix whose entry (i, j) is expr', { check: literalSize(0, 1) }),
  ]),
  spec('Identity', [form([p('n', 'Number')], 'Matrix', runIdentity, 'the n×n identity matrix', { check: literalSize(0) })]),
  spec('Zeros', [form([p('rows', 'Number'), p('cols', 'Number')], 'Matrix', runZeros, 'a matrix of zeros', { check: literalSize(0, 1) })]),
  spec('Diag', [
    form([p('list', 'List<Number>')], 'Matrix', runDiagList, 'the diagonal matrix with these entries'),
    form([m()], 'List<Number>', runDiagOf, 'the diagonal of a matrix'),
  ]),
  spec('FromRows', [{ params: [p('rows', 'List<List<Number>>')], returns: 'Matrix', rule: (args) => matrixRule(args as readonly { expr?: unknown }[]), summary: 'a matrix whose rows are the lists' }]),
  spec('FromCols', [form([p('cols', 'List<List<Number>>')], 'Matrix', runFromCols, 'a matrix whose columns are the lists')]),
  spec('HStack', [{ ...form([m('A'), m('B')], 'Matrix', runStack(true), 'matrices side by side'), rest: m('more') }]),
  spec('VStack', [{ ...form([m('A'), m('B')], 'Matrix', runStack(false), 'matrices top to bottom'), rest: m('more') }]),
  spec('Submatrix', [form([m(), p('r1', 'Number'), p('r2', 'Number'), p('c1', 'Number'), p('c2', 'Number')], 'Matrix', runSubmatrix, 'rows r1..r2 and columns c1..c2')]),
  spec('Row', [form([m(), p('i', 'Number')], 'List<Number>', runRowCol(false), 'row i as a list')]),
  spec('Col', [form([m(), p('j', 'Number')], 'List<Number>', runRowCol(true), 'column j as a list')]),
  spec('Minor', [form([m(), p('i', 'Number'), p('j', 'Number')], 'Matrix', runMinor, 'the matrix without row i and column j')]),
  spec('ToLists', [form([m()], 'List<List<Number>>', runToLists, 'the rows as lists')]),
  spec('Transpose', [form([m()], 'Matrix', runTranspose, 'rows and columns swapped')]),
  spec('Determinant', [form([m()], 'Number', runDeterminant, 'the determinant (exact for small literal matrices)')]),
  spec('Invert', [form([m()], 'Matrix', runInvert, 'the inverse')]),
  spec('Rank', [
    form([m()], 'Number', runRank, 'the rank'),
    form([m(), p('tol', 'Number')], 'Number', runRank, 'the rank with a given tolerance'),
  ]),
  spec('Rref', [form([m()], 'Matrix', runRref, 'the reduced row echelon form')]),
  spec('Solve', [
    form([m('A'), p('b', 'List<Number>')], 'List<Number>', runSolve, 'x with A x = b (least squares when A is tall)'),
    form([m('A'), m('B')], 'Matrix', runSolve, 'X with A X = B'),
  ]),
  spec('NullSpace', [form([m()], 'Matrix', runNullSpace, 'a basis of the solutions of M x = 0, as columns')]),
  spec('ColSpace', [form([m()], 'Matrix', runColSpace, 'a basis of the column space, as columns')]),
  spec('Norm', [
    form([m()], 'Number', runNorm, 'the Frobenius norm'),
    form([m(), p('kind', 'Text')], 'Number', runNorm, 'the "fro", "1", "inf" or "2" norm', { check: literalNorm }),
  ]),
  spec('Cond', [form([m()], 'Number', runCond, 'the 2-norm condition number')]),
  spec('Dim', [form([m()], 'List<Number>', runDim, '[rows, cols]')]),
  spec('Cofactor', [form([m(), p('i', 'Number'), p('j', 'Number')], 'Number', runCofactor, 'the cofactor of entry (i, j)')]),
  spec('Adjugate', [form([m()], 'Matrix', runAdjugate, 'the adjugate (transposed cofactors)')]),
  spec('Kron', [form([m('A'), m('B')], 'Matrix', runKron, 'the Kronecker product')]),
  spec('LU', [form([m()], 'Record<LU>', runLU, 'P M = L U with partial pivoting')]),
  spec('QR', [form([m()], 'Record<QR>', runQR, 'M = Q R by Householder reflections')]),
  spec('Cholesky', [form([m()], 'Matrix', runCholesky, 'L with L Lᵀ = M for a symmetric positive-definite M')]),
  spec('SVD', [form([m()], 'Record<SVD>', runSVD, 'M = U diag(S) Vᵀ')]),
  spec('Eigenvalues', [form([m()], 'List<Point>', runEigenvalues, 'the eigenvalues as points (re, im)')]),
  spec('Eigenvectors', [form([m()], 'Matrix', runEigenvectors, 'unit eigenvectors as columns (real eigenvalues only)')]),
  spec('Eigen', [form([m()], 'Record<Eigen>', runEigen, 'eigenvalues, eigenvectors, multiplicities and whether it is defective')]),
  spec('Diagonalize', [form([m()], 'Record<Diagonalize>', runDiagonalize, 'M = P D P⁻¹')]),
  spec('CharPoly', [form([m()], 'Function<Number>', runCharPoly, 'det(x I − M) as a function of x')]),
  spec('MinPoly', [form([m()], 'Function<Number>', runMinPoly, 'the smallest monic polynomial p with p(M) = 0')]),
];

