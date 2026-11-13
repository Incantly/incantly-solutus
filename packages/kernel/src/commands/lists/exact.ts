/**
 * The exact path (design 5.3, 8.3): rationals on BigInt for matrices whose entries came from number literals, up to
 * 12×12 and 4,096-bit entries. Every function returns `undefined` when the result would pass those sizes, and the caller
 * falls back to floating point.
 */
import type { MatrixValue, Rat } from './types';
import { MAX_EXACT, MAX_EXACT_BITS, makeMatrix } from './types';

const ZERO: Rat = { n: 0n, d: 1n };
const ONE: Rat = { n: 1n, d: 1n };

const babs = (x: bigint): bigint => (x < 0n ? -x : x);
function gcd(a: bigint, b: bigint): bigint {
  a = babs(a);
  b = babs(b);
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export function rat(n: bigint, d: bigint = 1n): Rat {
  if (d === 0n) throw new RangeError('zero denominator');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return g > 1n ? { n: n / g, d: d / g } : { n, d };
}

export const radd = (a: Rat, b: Rat): Rat => (a.d === b.d ? rat(a.n + b.n, a.d) : rat(a.n * b.d + b.n * a.d, a.d * b.d));
export const rsub = (a: Rat, b: Rat): Rat => (a.d === b.d ? rat(a.n - b.n, a.d) : rat(a.n * b.d - b.n * a.d, a.d * b.d));
export const rmul = (a: Rat, b: Rat): Rat => rat(a.n * b.n, a.d * b.d);
export const rdiv = (a: Rat, b: Rat): Rat => rat(a.n * b.d, a.d * b.n);
export const rneg = (a: Rat): Rat => ({ n: -a.n, d: a.d });
export const rzero = (a: Rat): boolean => a.n === 0n;
export const req = (a: Rat, b: Rat): boolean => a.n === b.n && a.d === b.d;

/** The nearest double to a rational. */
export function rnum(a: Rat): number {
  if (a.d === 1n) return Number(a.n);
  const n = Number(a.n);
  const d = Number(a.d);
  if (Number.isFinite(n) && Number.isFinite(d) && Math.abs(n) < 2 ** 53 && d < 2 ** 53) return n / d;
  // scale both to keep 60 significant bits
  const shift = BigInt(Math.max(0, Math.max(a.n.toString(2).length, a.d.toString(2).length) - 60));
  return Number(a.n >> shift) / Number(a.d >> shift);
}

const bits = (x: bigint): number => (x === 0n ? 0 : babs(x).toString(2).length);
const tooBig = (a: Rat): boolean => bits(a.n) > MAX_EXACT_BITS || bits(a.d) > MAX_EXACT_BITS;

/** The exact value of a decimal literal text (`0.1`, `-2.5`, `3e-2`), or undefined past 9 significant digits. */
export function ratFromText(text: string): Rat | undefined {
  const m = /^(-?)(\d*)(?:\.(\d*))?(?:[eE]([-+]?\d+))?$/.exec(text.trim());
  if (!m) return undefined;
  const whole = m[2] ?? '';
  const frac = m[3] ?? '';
  const digits = (whole + frac).replace(/^0+/, '');
  if (digits.length > 9) return undefined;
  let n = BigInt((whole + frac) === '' ? '0' : whole + frac);
  let d = 10n ** BigInt(frac.length);
  const e = m[4] ? Number(m[4]) : 0;
  if (Math.abs(e) > 30) return undefined;
  if (e > 0) n *= 10n ** BigInt(e);
  else if (e < 0) d *= 10n ** BigInt(-e);
  if (m[1] === '-') n = -n;
  return rat(n, d);
}

/** A matrix from exact entries, with the nearest doubles. Undefined when an entry is too big to keep exact. */
export function exactMatrix(rows: number, cols: number, e: readonly Rat[]): MatrixValue | undefined {
  if (rows > MAX_EXACT || cols > MAX_EXACT || e.some(tooBig)) return undefined;
  const data = new Float64Array(e.length);
  for (let i = 0; i < e.length; i++) data[i] = rnum(e[i] as Rat);
  return makeMatrix(rows, cols, data, e);
}

export const usable = (m: MatrixValue): m is MatrixValue & { exact: readonly Rat[] } => m.exact !== undefined && m.rows <= MAX_EXACT && m.cols <= MAX_EXACT;

/* ------------------------------ operations ------------------------------ */

export function eAdd(a: readonly Rat[], b: readonly Rat[], sign: 1 | -1): Rat[] {
  return a.map((x, i) => (sign === 1 ? radd(x, b[i] as Rat) : rsub(x, b[i] as Rat)));
}

export function eScale(a: readonly Rat[], k: Rat): Rat[] {
  return a.map((x) => rmul(x, k));
}

export function eMul(a: readonly Rat[], ar: number, ac: number, b: readonly Rat[], bc: number): Rat[] {
  const out: Rat[] = new Array<Rat>(ar * bc);
  for (let i = 0; i < ar; i++) {
    for (let j = 0; j < bc; j++) {
      let s = ZERO;
      for (let k = 0; k < ac; k++) s = radd(s, rmul(a[i * ac + k] as Rat, b[k * bc + j] as Rat));
      out[i * bc + j] = s;
    }
  }
  return out;
}

export function eTranspose(a: readonly Rat[], r: number, c: number): Rat[] {
  const out: Rat[] = new Array<Rat>(r * c);
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) out[j * r + i] = a[i * c + j] as Rat;
  return out;
}

export function eIdentity(n: number): Rat[] {
  const out: Rat[] = new Array<Rat>(n * n).fill(ZERO);
  for (let i = 0; i < n; i++) out[i * n + i] = ONE;
  return out;
}

/** Determinant by Bareiss elimination on the common-denominator integer matrix: no division until the end. */
export function eDet(a: readonly Rat[], n: number): Rat {
  if (n === 0) return ONE;
  // clear the denominators row by row
  let scale = ONE;
  const m: bigint[][] = [];
  for (let i = 0; i < n; i++) {
    let l = 1n;
    for (let j = 0; j < n; j++) {
      const d = (a[i * n + j] as Rat).d;
      l = (l / gcd(l, d)) * d;
    }
    scale = rmul(scale, rat(1n, l));
    m.push(Array.from({ length: n }, (_, j) => ((a[i * n + j] as Rat).n * l) / (a[i * n + j] as Rat).d));
  }
  let sign = 1n;
  let prev = 1n;
  for (let k = 0; k < n - 1; k++) {
    if ((m[k] as bigint[])[k] === 0n) {
      let p = k + 1;
      while (p < n && (m[p] as bigint[])[k] === 0n) p++;
      if (p === n) return ZERO;
      [m[k], m[p]] = [m[p] as bigint[], m[k] as bigint[]];
      sign = -sign;
    }
    const rk = m[k] as bigint[];
    for (let i = k + 1; i < n; i++) {
      const ri = m[i] as bigint[];
      for (let j = k + 1; j < n; j++) ri[j] = ((ri[j] as bigint) * (rk[k] as bigint) - (ri[k] as bigint) * (rk[j] as bigint)) / prev;
      ri[k] = 0n;
    }
    prev = rk[k] as bigint;
  }
  return rmul(rat(sign * ((m[n - 1] as bigint[])[n - 1] as bigint)), scale);
}

/**
 * Reduced row echelon form by Gauss–Jordan on rationals. Returns the form and the pivot columns.
 */
export function eRref(a: readonly Rat[], r: number, c: number): { m: Rat[]; pivots: number[] } {
  const m = a.slice();
  const pivots: number[] = [];
  let row = 0;
  for (let col = 0; col < c && row < r; col++) {
    let p = row;
    while (p < r && rzero(m[p * c + col] as Rat)) p++;
    if (p === r) continue;
    if (p !== row) for (let j = 0; j < c; j++) [m[row * c + j], m[p * c + j]] = [m[p * c + j] as Rat, m[row * c + j] as Rat];
    const piv = m[row * c + col] as Rat;
    for (let j = 0; j < c; j++) m[row * c + j] = rdiv(m[row * c + j] as Rat, piv);
    for (let i = 0; i < r; i++) {
      if (i === row) continue;
      const f = m[i * c + col] as Rat;
      if (rzero(f)) continue;
      for (let j = 0; j < c; j++) m[i * c + j] = rsub(m[i * c + j] as Rat, rmul(f, m[row * c + j] as Rat));
    }
    pivots.push(col);
    row++;
  }
  return { m, pivots };
}

/** The inverse, or undefined when singular. */
export function eInverse(a: readonly Rat[], n: number): Rat[] | undefined {
  const aug: Rat[] = [];
  const id = eIdentity(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) aug.push(a[i * n + j] as Rat);
    for (let j = 0; j < n; j++) aug.push(id[i * n + j] as Rat);
  }
  const { m, pivots } = eRref(aug, n, 2 * n);
  if (pivots.length < n || pivots[n - 1] !== n - 1) return undefined;
  const out: Rat[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push(m[i * 2 * n + n + j] as Rat);
  return out;
}

/** A basis of the null space as columns (`c × k`), from the RREF. */
export function eNullSpace(a: readonly Rat[], r: number, c: number): { data: Rat[]; k: number } {
  const { m, pivots } = eRref(a, r, c);
  const free: number[] = [];
  for (let j = 0; j < c; j++) if (!pivots.includes(j)) free.push(j);
  const k = free.length;
  const data: Rat[] = new Array<Rat>(c * k).fill(ZERO);
  free.forEach((f, col) => {
    data[f * k + col] = ONE;
    pivots.forEach((pc, row) => {
      data[pc * k + col] = rneg(m[row * c + f] as Rat);
    });
  });
  return { data, k };
}

/** The coefficients of det(xI − M), highest power first (monic), by Faddeev–LeVerrier. */
export function eCharPoly(a: readonly Rat[], n: number): Rat[] {
  const coeffs: Rat[] = [ONE];
  let mk: Rat[] = eIdentity(n).map(() => ZERO);
  let c = ONE;
  for (let k = 1; k <= n; k++) {
    // M_k = A (M_{k-1} + c_{k-1} I)
    const next = mk.slice();
    for (let i = 0; i < n; i++) next[i * n + i] = radd(next[i * n + i] as Rat, c);
    mk = eMul(a, n, n, next, n);
    let tr = ZERO;
    for (let i = 0; i < n; i++) tr = radd(tr, mk[i * n + i] as Rat);
    c = rneg(rdiv(tr, rat(BigInt(k))));
    coeffs.push(c);
  }
  return coeffs;
}

/**
 * The minimal polynomial, highest power first (monic): the first power of M that the earlier ones span, found from the
 * flattened powers I, M, M², … by elimination.
 */
export function eMinPoly(a: readonly Rat[], n: number): Rat[] {
  const powers: Rat[][] = [eIdentity(n)];
  for (let k = 1; k <= n; k++) {
    powers.push(eMul(powers[k - 1] as Rat[], n, n, a, n));
    // columns = the powers 0..k flattened; solve sum c_j P_j = -P_k
    const rows = n * n;
    const cols = k + 1;
    const m: Rat[] = new Array<Rat>(rows * cols);
    for (let i = 0; i < rows; i++) for (let j = 0; j <= k; j++) m[i * cols + j] = (powers[j] as Rat[])[i] as Rat;
    const { m: red, pivots } = eRref(m, rows, cols);
    if (pivots.includes(k)) continue;
    // P_k = sum over pivots of red[row][k] * P_pivot
    const out: Rat[] = new Array<Rat>(k + 1).fill(ZERO);
    out[0] = ONE;
    pivots.forEach((pc, row) => {
      out[k - pc] = rneg(red[row * cols + k] as Rat);
    });
    return out;
  }
  return eCharPoly(a, n);
}

/** Integer power by squaring (`n ≥ 0`). */
export function ePow(a: readonly Rat[], n: number, k: number): Rat[] {
  let result = eIdentity(n);
  let base = a.slice();
  let e = k;
  while (e > 0) {
    if (e & 1) result = eMul(result, n, n, base, n);
    e >>= 1;
    if (e > 0) base = eMul(base, n, n, base, n);
    if (result.some(tooBig) || base.some(tooBig)) throw new RangeError('too big');
  }
  return result;
}

/** A rational as the script and summaries show it: `1/3`, `-2`, `5/2`. */
export function ratText(a: Rat): string {
  return a.d === 1n ? a.n.toString() : `${a.n.toString()}/${a.d.toString()}`;
}

export { ZERO as RAT_ZERO, ONE as RAT_ONE };
