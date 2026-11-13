/**
 * Operators, indexing and fields for `Matrix` and `Record` (design 5.4, 5.1, 7), and list broadcasting (4.7), through
 * the language's area hooks.
 */
import type { Pt } from '../../contracts/values';
import { FIELDS, registerFieldNames, registerFieldTyper } from '../../language/check';
import { registerFieldReader } from '../../language/compile';
import type { Env } from '../../language/runtime';
import { fail, formatNumber, registerValueText, valueText } from '../../language/runtime';
import { T, listOf, registerBinaryOp, registerIndexOp, registerUnaryOp } from '../../language/types';
import type { Ty } from '../../language/types';
import { eAdd, eIdentity, eInverse, eMul, ePow, eScale, exactMatrix, ratFromText, ratText, rnum, usable } from './exact';
import { inverse, matMul } from './linalg';
import type { MatrixValue, Rat } from './types';
import { MAX_DENSE, RECORD_SCHEMAS, RECORD_TEXT, isMatrix, isRecord, makeMatrix, sameValue } from './types';

const M: Ty = { k: 'Matrix' };
const isM = (t: Ty): boolean => t.k === 'Matrix';
const isN = (t: Ty): boolean => t.k === 'Number';
const isNumList = (t: Ty): boolean => t.k === 'List' && t.of?.k === 'Number';

const bad = (env: unknown, reason: Parameters<typeof fail>[1], detail: string): undefined => {
  fail(env as Env, reason, detail);
  return undefined;
};

const shape = (m: MatrixValue): string => `${m.rows}×${m.cols}`;

/** Every entry finite, else undefined `not_finite` naming the first bad entry (errors 3). */
function finite(m: MatrixValue, env: unknown): MatrixValue | undefined {
  for (let i = 0; i < m.data.length; i++) {
    const x = m.data[i] as number;
    if (x - x !== 0) return bad(env, 'not_finite', `entry ${Math.floor(i / m.cols) + 1},${(i % m.cols) + 1} is ${x}`);
  }
  return m;
}

function exactOf(n: number): Rat | undefined {
  return Number.isInteger(n) && Math.abs(n) < 2 ** 53 ? { n: BigInt(n), d: 1n } : ratFromText(String(n));
}

export function addM(a: MatrixValue, b: MatrixValue, sign: 1 | -1, env: unknown): MatrixValue | undefined {
  if (a.rows !== b.rows || a.cols !== b.cols) return bad(env, 'size_mismatch', `${shape(a)} and ${shape(b)}`);
  if (usable(a) && usable(b)) {
    const e = exactMatrix(a.rows, a.cols, eAdd(a.exact, b.exact, sign));
    if (e) return e;
  }
  const d = new Float64Array(a.data.length);
  for (let i = 0; i < d.length; i++) d[i] = (a.data[i] as number) + sign * (b.data[i] as number);
  return finite(makeMatrix(a.rows, a.cols, d), env);
}

export function scaleM(a: MatrixValue, k: number, env: unknown, divide = false): MatrixValue | undefined {
  if (divide && k === 0) return bad(env, 'division_by_zero', 'division by zero');
  const ek = exactOf(k);
  if (usable(a) && ek && ek.n !== 0n) {
    const e = exactMatrix(a.rows, a.cols, eScale(a.exact, divide ? { n: ek.d * (ek.n < 0n ? -1n : 1n), d: ek.n < 0n ? -ek.n : ek.n } : ek));
    if (e) return e;
  }
  const d = new Float64Array(a.data.length);
  for (let i = 0; i < d.length; i++) d[i] = divide ? (a.data[i] as number) / k : (a.data[i] as number) * k;
  return finite(makeMatrix(a.rows, a.cols, d), env);
}

export function mulM(a: MatrixValue, b: MatrixValue, env: unknown): MatrixValue | undefined {
  if (a.cols !== b.rows) return bad(env, 'size_mismatch', `${shape(a)} cannot multiply ${shape(b)}`);
  if (Math.max(a.rows, a.cols, b.cols) > MAX_DENSE) return bad(env, 'too_large', `products go up to ${MAX_DENSE}×${MAX_DENSE}`);
  if (usable(a) && usable(b)) {
    const e = exactMatrix(a.rows, b.cols, eMul(a.exact, a.rows, a.cols, b.exact, b.cols));
    if (e) return e;
  }
  return finite(makeMatrix(a.rows, b.cols, matMul(a.data, a.rows, a.cols, b.data, b.cols)), env);
}

export function powM(a: MatrixValue, k: number, env: unknown): MatrixValue | undefined {
  if (a.rows !== a.cols) return bad(env, 'not_square', `the matrix is ${shape(a)}`);
  if (!Number.isInteger(k)) return bad(env, 'not_integer', `a matrix power needs a whole exponent, not ${k}`);
  const n = a.rows;
  if (usable(a)) {
    try {
      let base: readonly Rat[] = a.exact;
      if (k < 0) {
        const inv = eInverse(a.exact, n);
        if (!inv) return bad(env, 'singular', 'determinant is 0 (exact)');
        base = inv;
      }
      const e = exactMatrix(n, n, k === 0 ? eIdentity(n) : ePow(base, n, Math.abs(k)));
      if (e) return e;
    } catch {
      // too big to stay exact: floats below
    }
  }
  let base = a.data;
  if (k < 0) {
    const inv = inverse(a.data, n);
    if (!inv) return bad(env, 'singular', 'a pivot is below the tolerance');
    base = inv;
  }
  let e = Math.abs(k);
  let result: Float64Array = new Float64Array(n * n);
  for (let i = 0; i < n; i++) result[i * n + i] = 1;
  let b: Float64Array = Float64Array.from(base);
  while (e > 0) {
    if (e & 1) result = matMul(result, n, n, b, n);
    e = Math.floor(e / 2);
    if (e > 0) b = matMul(b, n, n, b, n);
  }
  return finite(makeMatrix(n, n, result), env);
}

/** `A * v` with `v` a column. */
function mulVec(a: MatrixValue, v: Float64Array, env: unknown): Float64Array | undefined {
  if (a.cols !== v.length) return bad(env, 'size_mismatch', `${shape(a)} cannot multiply a list of ${v.length}`);
  const out = new Float64Array(a.rows);
  for (let i = 0; i < a.rows; i++) {
    let s = 0;
    for (let j = 0; j < a.cols; j++) s += (a.data[i * a.cols + j] as number) * (v[j] as number);
    out[i] = s;
  }
  return out;
}

/** `A * P`: a 2×2 is linear, a 3×3 acts on `(x, y, 1)` and divides by w (design 5.4). */
export function mulPoint(a: MatrixValue, p: Pt, env: unknown): Pt | undefined {
  const d = a.data;
  if (a.rows === 2 && a.cols === 2) return { x: (d[0] as number) * p.x + (d[1] as number) * p.y, y: (d[2] as number) * p.x + (d[3] as number) * p.y };
  if (a.rows === 3 && a.cols === 3) {
    const x = (d[0] as number) * p.x + (d[1] as number) * p.y + (d[2] as number);
    const y = (d[3] as number) * p.x + (d[4] as number) * p.y + (d[5] as number);
    const w = (d[6] as number) * p.x + (d[7] as number) * p.y + (d[8] as number);
    const scale = Math.max(Math.abs(d[6] as number) * Math.abs(p.x) + Math.abs(d[7] as number) * Math.abs(p.y) + Math.abs(d[8] as number), Number.MIN_VALUE);
    if (Math.abs(w) <= 1e-12 * scale) return bad(env, 'point_at_infinity', `w = ${w}`);
    return { x: x / w, y: y / w };
  }
  return bad(env, 'size_mismatch', `a ${shape(a)} matrix does not map points; use a 2×2 or a 3×3`);
}

/* ------------------------------ list broadcasting ------------------------------ */

function listList(op: string, a: Float64Array, b: Float64Array, env: unknown): Float64Array | undefined {
  if (a.length !== b.length) return bad(env, 'size_mismatch', `lengths ${a.length} and ${b.length}`);
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    let v: number;
    if (op === '+') v = x + y;
    else if (op === '-') v = x - y;
    else if (op === '*') v = x * y;
    else if (op === '/') {
      if (y === 0) return bad(env, 'division_by_zero', `element ${i + 1}: division by zero`);
      v = x / y;
    } else v = x ** y;
    if (v - v !== 0) return bad(env, 'not_finite', `element ${i + 1} is ${v}`);
    out[i] = v;
  }
  return out;
}

function numList(op: string, k: number, b: Float64Array, env: unknown): Float64Array | undefined {
  const out = new Float64Array(b.length);
  for (let i = 0; i < b.length; i++) {
    const y = b[i] as number;
    let v: number;
    if (op === '+') v = k + y;
    else if (op === '-') v = k - y;
    else if (op === '*') v = k * y;
    else if (op === '/') {
      if (y === 0) return bad(env, 'division_by_zero', `element ${i + 1}: division by zero`);
      v = k / y;
    } else v = k ** y;
    if (v - v !== 0) return bad(env, 'not_finite', `element ${i + 1} is ${v}`);
    out[i] = v;
  }
  return out;
}

/* ------------------------------ registration ------------------------------ */

let registered = false;

export function registerListOps(): void {
  if (registered) return;
  registered = true;
  const ARITH = new Set(['+', '-', '*', '/', '^']);

  registerBinaryOp((op, l, r) => {
    // lists of numbers: list op list, number op list (list op number is a core row)
    if (ARITH.has(op) && isNumList(l) && isNumList(r)) return { result: listOf(T.Number), impl: (a, b, env) => listList(op, a as Float64Array, b as Float64Array, env) };
    if (ARITH.has(op) && isN(l) && isNumList(r)) return { result: listOf(T.Number), impl: (a, b, env) => numList(op, a as number, b as Float64Array, env) };
    if (!isM(l) && !isM(r)) return undefined;
    if ((op === '==' || op === '!=') && isM(l) && isM(r)) return { result: T.Bool, impl: (a, b) => sameValue(a, b) };
    if ((op === '+' || op === '-') && isM(l) && isM(r)) return { result: M, impl: (a, b, env) => addM(a as MatrixValue, b as MatrixValue, op === '+' ? 1 : -1, env) };
    if (op === '*' && isM(l) && isM(r)) return { result: M, impl: (a, b, env) => mulM(a as MatrixValue, b as MatrixValue, env) };
    if (op === '*' && isN(l) && isM(r)) return { result: M, impl: (a, b, env) => scaleM(b as MatrixValue, a as number, env) };
    if ((op === '*' || op === '/') && isM(l) && isN(r)) return { result: M, impl: (a, b, env) => scaleM(a as MatrixValue, b as number, env, op === '/') };
    if (op === '^' && isM(l) && isN(r)) return { result: M, impl: (a, b, env) => powM(a as MatrixValue, b as number, env) };
    if (op === '*' && isM(l) && isNumList(r)) return { result: listOf(T.Number), impl: (a, b, env) => mulVec(a as MatrixValue, b as Float64Array, env) };
    if (op === '*' && isM(l) && (r.k === 'Point' || r.k === 'Vector')) return { result: r.k === 'Point' ? T.Point : T.Vector, impl: (a, b, env) => mulPoint(a as MatrixValue, b as Pt, env) };
    return undefined;
  });

  registerUnaryOp((op, a) => {
    if (isM(a) && (op === '-' || op === '+')) return { result: M, impl: (v, env) => (op === '-' ? scaleM(v as MatrixValue, -1, env) : v) };
    if (isNumList(a) && op === '-') return { result: listOf(T.Number), impl: (v) => (v as Float64Array).map((x) => -x) };
    return undefined;
  });

  // M[i] is row i as a list of numbers (1-based, negative from the end); M[i][j] is then a list index
  registerIndexOp((target, index) => {
    if (!isM(target) || !isN(index)) return undefined;
    return {
      result: listOf(T.Number),
      impl: (m, k, env) => {
        const a = m as MatrixValue;
        const i = k as number;
        if (!Number.isInteger(i)) return bad(env, 'not_integer', `row ${i}`);
        const r = i > 0 ? i - 1 : a.rows + i;
        if (i === 0 || r < 0 || r >= a.rows) return bad(env, 'index_out_of_range', `the matrix has ${a.rows} rows, asked for ${i}`);
        return a.data.slice(r * a.cols, (r + 1) * a.cols);
      },
    };
  });

  // fields: M.rows, M.cols, M.trace; a record's fields from its schema
  (FIELDS as Record<string, Record<string, Ty>>)['Matrix'] = { rows: T.Number, cols: T.Number, trace: T.Number };
  registerFieldReader('Matrix', (field, value) => {
    if (!isMatrix(value)) return undefined;
    if (field === 'rows') return value.rows;
    if (field === 'cols') return value.cols;
    if (field === 'trace') {
      if (value.rows !== value.cols) return undefined;
      if (value.exact) {
        let s: Rat = { n: 0n, d: 1n };
        for (let i = 0; i < value.rows; i++) {
          const e = value.exact[i * value.cols + i] as Rat;
          s = { n: s.n * e.d + e.n * s.d, d: s.d * e.d };
        }
        return rnum(s);
      }
      let s = 0;
      for (let i = 0; i < value.rows; i++) s += value.data[i * value.cols + i] as number;
      return s;
    }
    return undefined;
  });
  registerFieldTyper('Record', (field, target) => {
    const schema = target.ty.schema;
    const fields = schema !== undefined && Object.hasOwn(RECORD_SCHEMAS, schema) ? RECORD_SCHEMAS[schema] : undefined;
    return fields?.find((f) => f.name === field)?.ty;
  });
  registerValueText((v, depth) => {
    if (isMatrix(v)) {
      const rows = Math.min(v.rows, 4);
      const cols = Math.min(v.cols, 6);
      const cell = (i: number, j: number): string => (v.exact ? ratText(v.exact[i * v.cols + j] as Rat) : formatNumber(v.data[i * v.cols + j] as number));
      const body = Array.from({ length: rows }, (_, i) => `[${Array.from({ length: cols }, (_, j) => cell(i, j)).join(', ')}${v.cols > cols ? ', …' : ''}]`).join(', ');
      return depth > 0 ? `Matrix ${v.rows}×${v.cols}` : `Matrix ${v.rows}×${v.cols} [${body}${v.rows > rows ? ', …' : ''}]`;
    }
    if (isRecord(v)) {
      const own = depth === 0 ? RECORD_TEXT.get(v.schema) : undefined;
      if (own) return own(v);
      const parts = Object.entries(v.fields).map(([k, x]) => `${k}: ${x === undefined ? `undefined (${v.reasons?.[k] ?? 'not set'})` : valueText(x, depth + 1)}`);
      return `${v.schema} {${parts.join(', ')}}`;
    }
    return undefined;
  });
  registerFieldNames('Record', (ty) => recordFieldNames(ty.schema));
  registerFieldNames('Matrix', () => []);
  registerFieldReader('Record', (field, value) => (isRecord(value) && Object.hasOwn(value.fields, field) ? value.fields[field] : undefined));
}

/** The real field names of a record type, for the `unknown_field` error. */
export function recordFieldNames(schema: string | undefined): string[] {
  const fields = schema !== undefined && Object.hasOwn(RECORD_SCHEMAS, schema) ? RECORD_SCHEMAS[schema] : undefined;
  return (fields ?? []).map((f) => f.name);
}
