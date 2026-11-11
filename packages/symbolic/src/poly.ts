/**
 * Polynomial arithmetic (cas/design.md 5.6): univariate dense polynomials over rationals,
 * multivariate sparse polynomials, division, gcd, square-free split, factoring over the
 * rationals, resultants, Sturm sequences and real root isolation. All BigInt; pure.
 */
import { bigGcd, LimitExceeded } from './node';
import { divisorsFromFactors, factorMultiplicity, floatToRatPreferShort, primeFactorsBig } from './num';
import type { SymNode } from './node';
import { add, asInteger, intN, isZeroNode, mul, pow, ratN } from './node';

/** Minimal budget surface: every loop reports here. Satisfied by `Budget` in run.ts. */
export interface Ticker {
  tick(n?: number): void;
}

export const NO_TICK: Ticker = { tick(): void {} };

/* ------------------------------- univariate ---------------------------------- */

/** Dense univariate polynomial: `c[i]` is the coefficient of x^i, all over `den`. */
export interface UPoly {
  readonly c: readonly bigint[];
  readonly den: bigint;
}

export function upolyNormalize(c: readonly bigint[], den: bigint): UPoly {
  if (den === 0n) throw new Error('upoly: zero denominator');
  if (den < 0n) {
    den = -den;
    c = c.map((x) => -x);
  }
  let end = c.length;
  while (end > 0 && c[end - 1] === 0n) end--;
  const cc = c.slice(0, end);
  if (cc.length === 0) return { c: [], den: 1n };
  let g = den < 0n ? -den : den;
  for (const x of cc) g = bigGcd(g, x < 0n ? -x : x);
  if (g > 1n) return { c: cc.map((x) => x / g), den: den / g };
  return { c: cc, den };
}

export function upolyFromInts(c: readonly bigint[]): UPoly {
  return upolyNormalize(c, 1n);
}

export function upolyDegree(p: UPoly): number {
  return p.c.length === 0 ? -1 : p.c.length - 1;
}

export function upolyIsZero(p: UPoly): boolean {
  return p.c.length === 0;
}

export function upolyIsConstant(p: UPoly): boolean {
  return p.c.length <= 1;
}

export function upolyLead(p: UPoly): bigint {
  return p.c.length === 0 ? 0n : (p.c[p.c.length - 1] as bigint);
}

export function upolyNeg(p: UPoly): UPoly {
  return { c: p.c.map((x) => -x), den: p.den };
}

export function upolyAdd(a: UPoly, b: UPoly, tick: Ticker = NO_TICK): UPoly {
  const n = Math.max(a.c.length, b.c.length);
  const c: bigint[] = new Array<bigint>(n).fill(0n);
  for (let i = 0; i < n; i++) {
    const av = i < a.c.length ? (a.c[i] as bigint) : 0n;
    const bv = i < b.c.length ? (b.c[i] as bigint) : 0n;
    c[i] = av * b.den + bv * a.den;
  }
  tick.tick(n);
  return upolyNormalize(c, a.den * b.den);
}

export function upolySub(a: UPoly, b: UPoly, tick: Ticker = NO_TICK): UPoly {
  return upolyAdd(a, upolyNeg(b), tick);
}

function schoolMul(a: readonly bigint[], b: readonly bigint[], tick: Ticker): bigint[] {
  if (a.length === 0 || b.length === 0) return [];
  const c: bigint[] = new Array<bigint>(a.length + b.length - 1).fill(0n);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      c[i + j] = (c[i + j] as bigint) + (a[i] as bigint) * (b[j] as bigint);
    }
    tick.tick(b.length);
  }
  return c;
}

function karatsuba(a: readonly bigint[], b: readonly bigint[], tick: Ticker): bigint[] {
  const n = Math.max(a.length, b.length);
  if (n <= 64) return schoolMul(a, b, tick);
  const m = Math.floor(n / 2);
  const a0 = a.slice(0, m);
  const a1 = a.slice(m);
  const b0 = b.slice(0, m);
  const b1 = b.slice(m);
  const z0 = karatsuba(a0, b0, tick);
  const z2 = karatsuba(a1, b1, tick);
  const a01 = addVec(a0, a1);
  const b01 = addVec(b0, b1);
  const z1 = subVec(subVec(karatsuba(a01, b01, tick), z0), z2);
  const out: bigint[] = new Array<bigint>(a.length + b.length - 1).fill(0n);
  const acc = (v: readonly bigint[], off: number): void => {
    for (let i = 0; i < v.length; i++) out[off + i] = (out[off + i] as bigint) + (v[i] as bigint);
  };
  acc(z0, 0);
  acc(z1, m);
  acc(z2, 2 * m);
  tick.tick(out.length);
  return out;
}

function addVec(a: readonly bigint[], b: readonly bigint[]): bigint[] {
  const n = Math.max(a.length, b.length);
  const out: bigint[] = new Array<bigint>(n).fill(0n);
  for (let i = 0; i < n; i++) out[i] = (i < a.length ? (a[i] as bigint) : 0n) + (i < b.length ? (b[i] as bigint) : 0n);
  return out;
}

function subVec(a: readonly bigint[], b: readonly bigint[]): bigint[] {
  const n = Math.max(a.length, b.length);
  const out: bigint[] = new Array<bigint>(n).fill(0n);
  for (let i = 0; i < n; i++) out[i] = (i < a.length ? (a[i] as bigint) : 0n) - (i < b.length ? (b[i] as bigint) : 0n);
  return out;
}

export function upolyMul(a: UPoly, b: UPoly, tick: Ticker = NO_TICK): UPoly {
  if (upolyIsZero(a) || upolyIsZero(b)) return { c: [], den: 1n };
  return upolyNormalize(karatsuba(a.c, b.c, tick), a.den * b.den);
}

/** Long division, exact over the rationals. */
export function upolyDivMod(a: UPoly, b: UPoly, tick: Ticker = NO_TICK): { q: UPoly; r: UPoly } {
  const da = upolyDegree(a);
  const db = upolyDegree(b);
  if (db < 0) throw new Error('upolyDivMod: division by zero');
  if (da < db) return { q: { c: [], den: 1n }, r: a };
  const scale = b.den;
  const lc = upolyLead(b);
  let rem = a.c.map((x) => x * scale);
  let remDen = a.den;
  const q: bigint[] = new Array<bigint>(da - db + 1).fill(0n);
  for (let k = da - db; k >= 0; k--) {
    const idx = k + db;
    const coeff = rem[idx] as bigint;
    if (coeff !== 0n && coeff % lc === 0n) {
      const t = coeff / lc;
      q[k] = t;
      for (let j = 0; j <= db; j++) {
        rem[k + j] = (rem[k + j] as bigint) - t * (b.c[j] as bigint);
      }
    } else if (coeff !== 0n) {
      rem = rem.map((x) => x * lc);
      remDen *= lc;
      q.forEach((_, i) => {
        q[i] = (q[i] as bigint) * lc;
      });
      const t = (rem[idx] as bigint) / lc;
      q[k] = t;
      for (let j = 0; j <= db; j++) {
        rem[k + j] = (rem[k + j] as bigint) - t * (b.c[j] as bigint);
      }
    }
    tick.tick(db + 1);
  }
  return { q: upolyNormalize(q, remDen), r: upolyNormalize(rem.slice(0, db), remDen) };
}

/** Content (gcd of coefficients) and primitive part. */
export function upolyContent(p: UPoly): bigint {
  if (upolyIsZero(p)) return 0n;
  let g = 0n;
  for (const x of p.c) g = bigGcd(g, x < 0n ? -x : x);
  return g;
}

export function upolyPrimitive(p: UPoly): UPoly {
  if (upolyIsZero(p)) return p;
  const g = upolyContent(p);
  const c = p.c.map((x) => x / g);
  if ((c[c.length - 1] as bigint) < 0n) return { c: c.map((x) => -x), den: p.den };
  return { c, den: p.den };
}

/** GCD by Euclid over the rationals, returned primitive with positive leading coefficient. */
export function upolyGcd(a: UPoly, b: UPoly, tick: Ticker = NO_TICK): UPoly {
  let x = upolyPrimitive(a);
  let y = upolyPrimitive(b);
  if (upolyIsZero(x)) return y;
  if (upolyIsZero(y)) return x;
  while (!upolyIsZero(y)) {
    const { r } = upolyDivMod(x, y, tick);
    x = y;
    y = upolyPrimitive(r);
  }
  return upolyPrimitive(x);
}

export function upolyDerivative(p: UPoly): UPoly {
  if (p.c.length <= 1) return { c: [], den: 1n };
  return upolyNormalize(p.c.slice(1).map((x, i) => x * BigInt(i + 1)), p.den);
}

/** Yun's square-free factorisation: [factor, multiplicity] pairs, primitive. */
export function upolySquarefree(p: UPoly, tick: Ticker = NO_TICK): { f: UPoly; m: number }[] {
  const prim = upolyPrimitive(p);
  if (upolyDegree(prim) <= 0) return [];
  const d = upolyGcd(prim, upolyDerivative(prim), tick);
  let c = upolyDivMod(prim, d, tick).q;
  let dd = d;
  const out: { f: UPoly; m: number }[] = [];
  let m = 1;
  while (!upolyIsConstant(c)) {
    const g = upolyGcd(c, dd, tick);
    const f = upolyDivMod(c, g, tick).q;
    if (!upolyIsConstant(f)) out.push({ f: upolyPrimitive(f), m });
    c = g;
    dd = upolyDivMod(dd, g, tick).q;
    m++;
    if (m > upolyDegree(prim) + 2) break;
  }
  return out;
}

/**
 * Integer divisors of |n| (n != 0), ascending. Trial division for small values, else the
 * budgeted factorizer (a budget-out falls back to the trivial divisors, so callers stay
 * correct through `rootof`, only less explicit).
 */
function intDivisors(n: bigint, tick: Ticker): bigint[] {
  const a = n < 0n ? -n : n;
  if (a === 0n) return [];
  if (a <= 1000000n) {
    const small: bigint[] = [];
    const large: bigint[] = [];
    let i = 1n;
    for (;;) {
      if (i * i > a) break;
      if (a % i === 0n) {
        small.push(i);
        if (i * i !== a) large.push(a / i);
      }
      i++;
      tick.tick(1);
    }
    return small.concat(large.reverse());
  }
  const f = primeFactorsBig(a);
  if (f === null) return [1n, a];
  return divisorsFromFactors(factorMultiplicity(f));
}

/** Rational roots by the rational-root theorem: p|a0, q|an. Each root once. */
export function upolyRationalRoots(p: UPoly, tick: Ticker = NO_TICK): { n: bigint; d: bigint }[] {
  const prim = upolyPrimitive(p);
  if (upolyDegree(prim) <= 0) return [];
  const roots: { n: bigint; d: bigint }[] = [];
  const seen = new Set<string>();
  let pp = prim;
  for (;;) {
    const deg = upolyDegree(pp);
    if (deg <= 0) break;
    if ((pp.c[0] as bigint) === 0n) {
      const key = '0/1';
      if (!seen.has(key)) {
        seen.add(key);
        roots.push({ n: 0n, d: 1n });
      }
      pp = upolyNormalize(pp.c.slice(1), pp.den);
      continue;
    }
    const a0 = pp.c[0] as bigint;
    const an = upolyLead(pp);
    const ps = intDivisors(a0, tick);
    const qs = intDivisors(an, tick);
    let found: { n: bigint; d: bigint } | null = null;
    outer: for (const q of qs) {
      for (const p of ps) {
        for (const s of [1n, -1n] as const) {
          const num = s * p;
          const g = bigGcd(num < 0n ? -num : num, q);
          const nn = num / g;
          const dd = q / g;
          const key = `${nn}/${dd}`;
          if (seen.has(key)) continue;
          tick.tick(deg);
          if (upolyEvalNum(pp, nn, dd) === 0n) {
            found = { n: nn, d: dd };
            seen.add(key);
            break outer;
          }
        }
      }
    }
    if (found === null) break;
    roots.push(found);
    const divisor = upolyNormalize([-found.n, found.d], 1n);
    pp = upolyDivMod(pp, divisor, tick).q;
  }
  return roots;
}

/** Numerator of p(n/d): sum c[i] n^i d^(deg-i). Zero exactly at a root. */
function upolyEvalNum(p: UPoly, n: bigint, d: bigint): bigint {
  let r = 0n;
  let pw = 1n;
  const deg = upolyDegree(p);
  const pows: bigint[] = [1n];
  for (let i = 1; i <= deg; i++) pows.push((pows[i - 1] as bigint) * n);
  let dp = 1n;
  const dps: bigint[] = [1n];
  for (let i = 1; i <= deg; i++) {
    dp *= d;
    dps.push(dp);
  }
  for (let i = 0; i <= deg; i++) {
    pw = (p.c[i] as bigint) * (pows[i] as bigint) * (dps[deg - i] as bigint);
    r += pw;
  }
  void pw;
  return r;
}

export function upolyEvalFloat(p: UPoly, x: number): number {
  let r = 0;
  for (let i = p.c.length - 1; i >= 0; i--) r = r * x + Number(p.c[i]);
  return r / Number(p.den);
}

/** Exact rational evaluation. */
export function upolyEvalRat(p: UPoly, n: bigint, d: bigint): { n: bigint; d: bigint } {
  const num = upolyEvalNum(p, n, d);
  const den = d ** BigInt(Math.max(0, upolyDegree(p))) * p.den;
  if (den === 0n) return { n: 0n, d: 1n };
  const g = bigGcd(num < 0n ? -num : num, den < 0n ? -den : den);
  return { n: num / g, d: den / g };
}

/** Peel linear factors (x - n/d) for each rational root; returns the rest. */
function peelLinear(p: UPoly, roots: readonly { n: bigint; d: bigint }[], tick: Ticker): { linears: UPoly[]; rest: UPoly } {
  const linears: UPoly[] = [];
  let rest = p;
  for (const r of roots) {
    const divisor = upolyNormalize([-r.n, r.d], 1n);
    const { q, r: rem } = upolyDivMod(rest, divisor, tick);
    if (upolyIsZero(rem)) {
      linears.push(upolyPrimitive(divisor));
      rest = q;
    }
  }
  return { linears, rest: upolyPrimitive(rest) };
}

/**
 * Kronecker factorisation for small dense polynomials: evaluate at enough points, factor
 * the values, interpolate candidate factors and trial-divide. Bounded: only when degree
 * <= 8 and coefficients are small; otherwise the rest stays irreducible.
 */
function kroneckerFactor(p: UPoly, tick: Ticker): UPoly[][] {
  const deg = upolyDegree(p);
  if (deg < 4 || deg > 8) return [[p]];
  let maxC = 0n;
  for (const x of p.c) {
    const a = x < 0n ? -x : x;
    if (a > maxC) maxC = a;
  }
  if (maxC > 1000000n) return [[p]];
  const m = Math.floor(deg / 2) + 1;
  const xs: number[] = [];
  for (let i = 0; i <= m; i++) xs.push(i);
  const vals = xs.map((x) => {
    let r = 0n;
    for (let i = p.c.length - 1; i >= 0; i--) r = r * BigInt(x) + (p.c[i] as bigint);
    return r;
  });
  if (vals.some((v) => v === 0n)) return [[p]];
  const divChoices = vals.map((v) => allDivisorsBoth(v, tick));
  const total = divChoices.reduce((a, b) => a * b.length, 1);
  if (total > 200000) return [[p]];
  const idx = new Array<number>(divChoices.length).fill(0);
  for (let count = 0; count < total; count++) {
    tick.tick(4);
    const ys = divChoices.map((ds, i) => ds[idx[i] as number] as bigint);
    const cand = interpolate(xs, ys);
    if (cand !== null && upolyDegree(cand) > 0 && upolyDegree(cand) < deg) {
      const { q, r } = upolyDivMod(p, cand, tick);
      if (upolyIsZero(r) && upolyDegree(q) > 0) {
        const left = kroneckerFactor(upolyPrimitive(cand), tick);
        const right = kroneckerFactor(upolyPrimitive(q), tick);
        return [...left, ...right];
      }
    }
    let j = 0;
    while (j < idx.length) {
      idx[j] = (idx[j] as number) + 1;
      if ((idx[j] as number) < (divChoices[j] as bigint[]).length) break;
      idx[j] = 0;
      j++;
    }
    if (j >= idx.length) break;
  }
  return [[p]];
}

function allDivisorsBoth(n: bigint, tick: Ticker): bigint[] {
  const a = n < 0n ? -n : n;
  const ds = intDivisors(a === 0n ? 1n : a, tick);
  const out: bigint[] = [];
  for (const d of ds) {
    out.push(d, -d);
  }
  return out;
}

/** Lagrange interpolation through (xs[i], ys[i]) over the rationals; null unless integral. */
function interpolate(xs: readonly number[], ys: readonly bigint[]): UPoly | null {
  const n = xs.length;
  let num: { n: bigint; d: bigint }[] = new Array(n).fill({ n: 0n, d: 1n }) as { n: bigint; d: bigint }[];
  for (let j = 0; j < n; j++) {
    let den = 1n;
    let basis: bigint[] = [1n];
    for (let m = 0; m < n; m++) {
      if (m === j) continue;
      const xm = BigInt(xs[m] as number);
      const xj = BigInt(xs[j] as number);
      const next: bigint[] = new Array<bigint>(basis.length + 1).fill(0n);
      for (let i = 0; i < basis.length; i++) {
        next[i] = (next[i] as bigint) + (basis[i] as bigint) * -xm;
        next[i + 1] = (next[i + 1] as bigint) + (basis[i] as bigint);
      }
      basis = next;
      den *= xj - xm;
    }
    const yj = ys[j] as bigint;
    for (let i = 0; i < basis.length; i++) {
      const term = { n: yj * (basis[i] as bigint), d: den };
      const prev = num[i] as { n: bigint; d: bigint };
      num[i] = { n: prev.n * term.d + term.n * prev.d, d: prev.d * term.d };
    }
  }
  let den = 1n;
  for (const t of num) den = (den * t.d) / bigGcd(den < 0n ? -den : den, t.d < 0n ? -t.d : t.d);
  const coeffs = num.map((t) => (t.n * den) / t.d);
  const g = bigGcd(den < 0n ? -den : den, coeffs.reduce((a, b) => bigGcd(a, b < 0n ? -b : b), 0n));
  return upolyNormalize(coeffs.map((x) => x / g), den / g);
}

export interface UFactor {
  readonly f: UPoly;
  readonly m: number;
}

/**
 * Factor over the rationals: content, square-free split, rational-root peeling, a bounded
 * Kronecker step for small dense leftovers. Anything left is irreducible (returned, not an
 * error). `maxDegree` (default 200) guards the input.
 */
export function upolyFactor(p: UPoly, tick: Ticker = NO_TICK, maxDegree = 200): { content: bigint; factors: UFactor[]; irreducible: UFactor[] } {
  if (upolyIsZero(p) || upolyDegree(p) > maxDegree) return { content: 1n, factors: [], irreducible: [] };
  const prim = upolyPrimitive(p);
  const content = upolyContent(p);
  if (upolyDegree(prim) <= 0) return { content, factors: [], irreducible: [] };
  const factors: UFactor[] = [];
  const irreducible: UFactor[] = [];
  for (const { f, m } of upolySquarefree(prim, tick)) {
    const roots = upolyRationalRoots(f, tick);
    const { linears, rest } = peelLinear(f, roots, tick);
    for (const l of linears) factors.push({ f: l, m });
    if (upolyDegree(rest) <= 1) {
      if (upolyDegree(rest) === 1) factors.push({ f: rest, m });
      continue;
    }
    const pieces = kroneckerFactor(rest, tick);
    for (const group of pieces) {
      for (const piece of group) {
        if (upolyDegree(piece) >= upolyDegree(rest)) irreducible.push({ f: piece, m });
        else factors.push({ f: piece, m });
      }
    }
  }
  return { content, factors, irreducible };
}

/* --------------------------- Sturm + root isolation -------------------------- */

function upolyRemainder(a: UPoly, b: UPoly, tick: Ticker): UPoly {
  return upolyDivMod(a, b, tick).r;
}

/** Sturm sequence of a square-free polynomial. */
export function upolySturm(p: UPoly, tick: Ticker = NO_TICK): UPoly[] {
  const seq: UPoly[] = [p, upolyDerivative(p)];
  for (;;) {
    const a = seq[seq.length - 2] as UPoly;
    const b = seq[seq.length - 1] as UPoly;
    if (upolyIsZero(b)) {
      seq.pop();
      break;
    }
    const r = upolyNeg(upolyRemainder(a, b, tick));
    if (upolyIsZero(r)) break;
    seq.push(r);
    if (seq.length > upolyDegree(p) + 3) break;
  }
  return seq;
}

function signAt(p: UPoly, n: bigint, d: bigint): number {
  const v = upolyEvalRat(p, n, d);
  return v.n === 0n ? 0 : v.n * v.d > 0n ? 1 : -1;
}

function variations(seq: readonly UPoly[], n: bigint, d: bigint): number {
  let count = 0;
  let prev = 0;
  for (const p of seq) {
    const s = signAt(p, n, d);
    if (s === 0) continue;
    if (prev !== 0 && s !== prev) count++;
    prev = s;
  }
  return count;
}

/** Cauchy bound: all real roots lie within (-B, B). */
function cauchyBound(p: UPoly): number {
  const deg = upolyDegree(p);
  if (deg <= 0) return 1;
  const an = Number(upolyLead(p)) / Number(p.den);
  let m = 0;
  for (let i = 0; i < deg; i++) {
    const v = Math.abs(Number(p.c[i]) / Number(p.den) / an);
    if (v > m) m = v;
  }
  return 1 + m;
}

export interface RootInterval {
  /** Exact rational endpoints [lo, hi] holding exactly one root. */
  readonly lo: { n: bigint; d: bigint };
  readonly hi: { n: bigint; d: bigint };
  readonly mid: number;
}

/** Isolate all real roots of a square-free polynomial with Sturm sequences. */
export function upolyIsolate(p: UPoly, tick: Ticker = NO_TICK): RootInterval[] {
  const prim = upolyPrimitive(p);
  if (upolyDegree(prim) <= 0) return [];
  const seq = upolySturm(prim, tick);
  const B = cauchyBound(prim);
  const intervals: { a: bigint; b: bigint; d: bigint }[] = [
    { a: BigInt(Math.floor(-B)) - 1n, b: BigInt(Math.ceil(B)) + 1n, d: 1n },
  ];
  const out: RootInterval[] = [];
  let splits = 0;
  while (intervals.length > 0) {
    const iv = intervals.pop() as { a: bigint; b: bigint; d: bigint };
    tick.tick(2);
    splits++;
    if (splits > 100000) break;
    const v = variations(seq, iv.a, iv.d) - variations(seq, iv.b, iv.d);
    if (v === 0) continue;
    if (v === 1) {
      out.push({
        lo: { n: iv.a, d: iv.d },
        hi: { n: iv.b, d: iv.d },
        mid: (Number(iv.a) + Number(iv.b)) / (2 * Number(iv.d)),
      });
      continue;
    }
    if (iv.d > 2n ** 200n) {
      out.push({
        lo: { n: iv.a, d: iv.d },
        hi: { n: iv.b, d: iv.d },
        mid: (Number(iv.a) + Number(iv.b)) / (2 * Number(iv.d)),
      });
      continue;
    }
    const m2 = iv.a + iv.b;
    const d2 = iv.d * 2n;
    intervals.push({ a: m2, b: iv.b * 2n, d: d2 }, { a: iv.a * 2n, b: m2, d: d2 });
  }
  out.sort((x, y) => x.mid - y.mid);
  return refineIntervalsDyadic(prim, seq, out, tick);
}

/** Refine isolating intervals by exact bisection to ~1e-12 width. */
function refineIntervalsDyadic(p: UPoly, seq: readonly UPoly[], ivs: RootInterval[], tick: Ticker): RootInterval[] {
  return ivs.map((iv) => {
    let a = iv.lo.n;
    let b = iv.hi.n;
    let d = iv.lo.d;
    for (let i = 0; i < 60; i++) {
      tick.tick(1);
      if (Number(b - a) / Number(d) < 1e-12) break;
      const m2 = a + b;
      const vl = variations(seq, a * 2n, d * 2n) - variations(seq, m2, d * 2n);
      if (vl >= 1) {
        b = m2;
        d = d * 2n;
        a = a * 2n;
      } else {
        a = m2;
        d = d * 2n;
        b = b * 2n;
      }
      if (d > 10n ** 18n) break;
    }
    const g = bigGcd(a < 0n ? -a : a, d);
    const g2 = bigGcd(b < 0n ? -b : b, d);
    return {
      lo: { n: a / g, d: d / g },
      hi: { n: b / g2, d: d / g2 },
      mid: (Number(a) + Number(b)) / (2 * Number(d)),
    };
  });
}

/**
 * Refine one root interval to a float: bisection on the sign, or golden-section
 * minimization of |f| when both ends share a sign (an even-multiplicity root).
 */
export function refineRootFloat(p: UPoly, iv: RootInterval, digits = 15): number {
  let an = iv.lo.n;
  let ad = iv.lo.d;
  let bn = iv.hi.n;
  let bd = iv.hi.d;
  const signOf = (n: bigint, d: bigint): number => {
    const v = upolyEvalRat(p, n, d);
    return v.n === 0n ? 0 : v.n * v.d > 0n ? 1 : -1;
  };
  const sa = signOf(an, ad);
  const sb = signOf(bn, bd);
  if (sa !== 0 && sb !== 0 && sa === sb) {
    let lo = Number(an) / Number(ad);
    let hi = Number(bn) / Number(bd);
    const gr = (Math.sqrt(5) - 1) / 2;
    let c = hi - gr * (hi - lo);
    let d = lo + gr * (hi - lo);
    for (let i = 0; i < 100; i++) {
      const fc = Math.abs(upolyEvalFloat(p, c));
      const fd = Math.abs(upolyEvalFloat(p, d));
      if (fc < fd) hi = d;
      else lo = c;
      c = hi - gr * (hi - lo);
      d = lo + gr * (hi - lo);
      if (hi - lo < 1e-13 * Math.max(1, Math.abs(lo))) break;
    }
    return (lo + hi) / 2;
  }
  for (let i = 0; i < digits * 4 + 20; i++) {
    const mn = an * bd + bn * ad;
    const md = 2n * ad * bd;
    const s = signOf(mn, md);
    if (s === 0) return Number(mn) / Number(md);
    if (s === sa) {
      an = mn;
      ad = md;
    } else {
      bn = mn;
      bd = md;
    }
    if (md > 10n ** 400n) break;
  }
  return (Number(an) / Number(ad) + Number(bn) / Number(bd)) / 2;
}

/* --------------------- trees: univariate in a generator ---------------------- */

/**
 * Convert a tree to a univariate polynomial in `gen` (a symbol or any atom such as
 * `sin(x)`). Coefficients must be free of `gen`. Fails with null when `gen` appears in
 * a denominator or a non-integer power.
 */
export function treeToUPoly(t: SymNode, gen: SymNode, tick: Ticker = NO_TICK): UPoly | null {
  if (t === gen) return { c: [0n, 1n], den: 1n };
  switch (t.k) {
    case 'int': return { c: [t.v], den: 1n };
    case 'rat': return { c: [t.n], den: t.d };
    case 'float': {
      const r = floatToRatPreferShort(t.v);
      return r === null ? null : { c: [r.n], den: r.d };
    }
    case 'dec': return { c: [t.mant * 10n ** BigInt(Math.max(0, t.exp))], den: 10n ** BigInt(Math.max(0, -t.exp)) };
    case 'const': case 'sym': case 'ref': case 'rootof': case 'fn': case 'list': case 'piecewise':
      return null;
    case 'add': {
      let acc: UPoly = { c: [], den: 1n };
      for (const term of t.terms) {
        const q = treeToUPoly(term, gen, tick);
        if (q === null) return null;
        acc = upolyAdd(acc, q, tick);
      }
      return acc;
    }
    case 'mul': {
      let acc: UPoly = { c: [1n], den: 1n };
      for (const f of t.factors) {
        const q = treeToUPoly(f, gen, tick);
        if (q === null) return null;
        acc = upolyMul(acc, q, tick);
      }
      return acc;
    }
    case 'pow': {
      const e = asInteger(t.exp);
      if (e === null) {
        if (!containsGen(t, gen)) return null;
        return null;
      }
      if (e > 100000n || e < -100000n) throw new LimitExceeded('degree');
      if (e < 0n) {
        const b = treeToUPoly(t.base, gen, tick);
        if (b === null) return null;
        if (upolyDegree(b) > 0) return null;
        if (upolyIsZero(b)) return null;
        return ratPow(b.c[0] as bigint, b.den, e);
      }
      const b = treeToUPoly(t.base, gen, tick);
      if (b === null) return null;
      return upolyPow(b, e, tick);
    }
  }
}

function ratPow(num: bigint, den: bigint, e: bigint): UPoly {
  if (e >= 0n) return upolyNormalize([num ** e], den ** e);
  const ae = -e;
  return upolyNormalize([den ** ae], num ** ae);
}

function upolyPow(p: UPoly, e: bigint, tick: Ticker): UPoly {
  let r: UPoly = { c: [1n], den: 1n };
  let b = p;
  let k = e;
  while (k > 0n) {
    if ((k & 1n) === 1n) r = upolyMul(r, b, tick);
    k >>= 1n;
    if (k > 0n) b = upolyMul(b, b, tick);
  }
  return r;
}

/**
 * Convert a tree to a polynomial in `gen` with tree coefficients (for parameters such as
 * `a` in `a*x^2 + b*x + c`). Coefficients are exact trees free of `gen`. Null when the
 * tree is not a polynomial in `gen`.
 */
export function treeToUPolySym(t: SymNode, gen: SymNode, tick: Ticker = NO_TICK): SymNode[] | null {
  if (t === gen) return [intN(0), intN(1)];
  const leaf = (x: SymNode): SymNode[] | null => (containsGen(x, gen) ? null : [x]);
  switch (t.k) {
    case 'int': case 'rat': case 'float': case 'dec': case 'const':
    case 'sym': case 'ref': case 'rootof': case 'fn': case 'list': case 'piecewise':
      return leaf(t);
    case 'add': {
      let acc: SymNode[] = [intN(0)];
      for (const term of t.terms) {
        const q = treeToUPolySym(term, gen, tick);
        if (q === null) return null;
        acc = addSym(acc, q);
        tick.tick(2);
      }
      return acc;
    }
    case 'mul': {
      let acc: SymNode[] = [intN(1)];
      for (const f of t.factors) {
        const q = treeToUPolySym(f, gen, tick);
        if (q === null) return null;
        acc = mulSym(acc, q);
        tick.tick(4);
      }
      return acc;
    }
    case 'pow': {
      if (!containsGen(t, gen)) return [t];
      const e = asInteger(t.exp);
      if (e === null || e < 0n || e > 1000n) return null;
      const b = treeToUPolySym(t.base, gen, tick);
      if (b === null) return null;
      let acc: SymNode[] = [intN(1)];
      let k = e;
      let bb = b;
      while (k > 0n) {
        if ((k & 1n) === 1n) acc = mulSym(acc, bb);
        k >>= 1n;
        if (k > 0n) bb = mulSym(bb, bb);
      }
      return acc;
    }
  }
}

function addSym(a: readonly SymNode[], b: readonly SymNode[]): SymNode[] {
  const n = Math.max(a.length, b.length);
  const out: SymNode[] = [];
  for (let i = 0; i < n; i++) out.push(add(a[i] ?? intN(0), b[i] ?? intN(0)));
  while (out.length > 1 && isZeroNode(out[out.length - 1] as SymNode)) out.pop();
  return out;
}

function mulSym(a: readonly SymNode[], b: readonly SymNode[]): SymNode[] {
  if (a.length === 0 || b.length === 0) return [intN(0)];
  const out: SymNode[] = new Array<SymNode>(a.length + b.length - 1).fill(intN(0));
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      out[i + j] = add(out[i + j] as SymNode, mul(a[i] as SymNode, b[j] as SymNode));
    }
  }
  while (out.length > 1 && isZeroNode(out[out.length - 1] as SymNode)) out.pop();
  return out;
}

export function containsGen(t: SymNode, gen: SymNode): boolean {
  if (t === gen) return true;
  switch (t.k) {
    case 'add': return t.terms.some((x) => containsGen(x, gen));
    case 'mul': return t.factors.some((x) => containsGen(x, gen));
    case 'pow': return containsGen(t.base, gen) || containsGen(t.exp, gen);
    case 'fn': return t.args.some((x) => containsGen(x, gen));
    case 'list': return t.items.some((x) => containsGen(x, gen));
    case 'piecewise': return t.cases.some((cs) => containsGen(cs.then, gen));
    default: return false;
  }
}

/** Convert a univariate polynomial back to a tree in `gen`. */
export function upolyToTree(p: UPoly, gen: SymNode): SymNode {
  if (upolyIsZero(p)) return intN(0);
  const terms: SymNode[] = [];
  for (let i = 0; i < p.c.length; i++) {
    const c = p.c[i] as bigint;
    if (c === 0n) continue;
    const coeff = ratN(c, p.den);
    if (i === 0) terms.push(coeff);
    else if (i === 1) terms.push(mul(coeff, gen));
    else terms.push(mul(coeff, pow(gen, intN(i))));
  }
  return add(...terms);
}

/* ------------------------------- multivariate -------------------------------- */

/**
 * Sparse multivariate polynomial: `terms` maps exponent tuples (`e0,e1,…`) to integer
 * coefficients, all over `den`.
 */
export interface MPoly {
  readonly gens: readonly SymNode[];
  readonly terms: ReadonlyMap<string, bigint>;
  readonly den: bigint;
}

function mkey(exps: readonly number[]): string {
  return exps.join(',');
}

function mExps(key: string, n: number): number[] {
  if (key === '') return new Array<number>(n).fill(0);
  return key.split(',').map(Number);
}

export function mpolyNormalize(gens: readonly SymNode[], terms: ReadonlyMap<string, bigint>, den: bigint): MPoly {
  if (den === 0n) throw new Error('mpoly: zero denominator');
  const clean = new Map<string, bigint>();
  let neg = false;
  if (den < 0n) {
    den = -den;
    neg = true;
  }
  for (const [k, v] of terms) {
    if (v !== 0n) clean.set(k, neg ? -v : v);
  }
  if (clean.size === 0) return { gens, terms: clean, den: 1n };
  let g = den < 0n ? -den : den;
  for (const v of clean.values()) g = bigGcd(g, v < 0n ? -v : v);
  if (g > 1n) {
    const scaled = new Map<string, bigint>();
    for (const [k, v] of clean) scaled.set(k, v / g);
    return { gens, terms: scaled, den: den / g };
  }
  return { gens, terms: clean, den };
}

export function mpolyIsZero(p: MPoly): boolean {
  return p.terms.size === 0;
}

export function mpolyTotalDegree(p: MPoly): number {
  let m = 0;
  for (const k of p.terms.keys()) {
    const d = mExps(k, p.gens.length).reduce((a, b) => a + b, 0);
    if (d > m) m = d;
  }
  return m;
}

export function mpolyAdd(a: MPoly, b: MPoly, tick: Ticker = NO_TICK): MPoly {
  const terms = new Map<string, bigint>();
  for (const [k, v] of a.terms) terms.set(k, v * b.den);
  for (const [k, v] of b.terms) terms.set(k, (terms.get(k) ?? 0n) + v * a.den);
  tick.tick(terms.size);
  return mpolyNormalize(a.gens, terms, a.den * b.den);
}

export function mpolyMul(a: MPoly, b: MPoly, tick: Ticker = NO_TICK): MPoly {
  const n = a.gens.length;
  const terms = new Map<string, bigint>();
  for (const [ka, va] of a.terms) {
    const ea = mExps(ka, n);
    for (const [kb, vb] of b.terms) {
      const eb = mExps(kb, n);
      const key = mkey(ea.map((x, i) => x + (eb[i] as number)));
      terms.set(key, (terms.get(key) ?? 0n) + va * vb);
      tick.tick(1);
    }
  }
  return mpolyNormalize(a.gens, terms, a.den * b.den);
}

function lexCompare(a: string, b: string, n: number): number {
  const ea = mExps(a, n);
  const eb = mExps(b, n);
  for (let i = 0; i < n; i++) {
    if ((ea[i] as number) !== (eb[i] as number)) return (ea[i] as number) - (eb[i] as number);
  }
  return 0;
}

function mpolyLead(p: MPoly): { key: string; coeff: bigint } | null {
  let best: string | null = null;
  for (const k of p.terms.keys()) {
    if (best === null || lexCompare(k, best, p.gens.length) > 0) best = k;
  }
  if (best === null) return null;
  return { key: best, coeff: p.terms.get(best) as bigint };
}

/**
 * Exact division in lex order over the rationals. Terms the divisor cannot cancel move to
 * the remainder. Remainder zero means exact (used for trial division of candidates).
 */
export function mpolyDivMod(a: MPoly, b: MPoly, tick: Ticker = NO_TICK): { q: MPoly; r: MPoly } {
  const n = a.gens.length;
  const lead = mpolyLead(b);
  if (lead === null) throw new Error('mpolyDivMod: division by zero');
  const be = mExps(lead.key, n);
  const lc = lead.coeff;
  const rem = new Map(a.terms);
  let remDen = a.den;
  const q = new Map<string, bigint>();
  let qDen = 1n;
  const r = new Map<string, bigint>();
  let rDen = 1n;
  const scale = (map: Map<string, bigint>, f: bigint): void => {
    if (f === 1n) return;
    for (const [k, v] of map) map.set(k, v * f);
  };
  for (;;) {
    let best: string | null = null;
    for (const k of rem.keys()) {
      if (best === null || lexCompare(k, best, n) > 0) best = k;
    }
    if (best === null) break;
    const re = mExps(best, n);
    let covers = true;
    for (let i = 0; i < n; i++) {
      if ((re[i] as number) < (be[i] as number)) {
        covers = false;
        break;
      }
    }
    const rv = rem.get(best) as bigint;
    if (!covers) {
      const g = bigGcd(rDen < 0n ? -rDen : rDen, remDen < 0n ? -remDen : remDen);
      const nd = (rDen * remDen) / g;
      scale(r, nd / rDen);
      r.set(best, (r.get(best) ?? 0n) + rv * (nd / remDen));
      rDen = nd;
      rem.delete(best);
      continue;
    }
    let tNum = rv * b.den;
    let tDen = remDen * lc;
    if (tDen < 0n) {
      tNum = -tNum;
      tDen = -tDen;
    }
    const g = bigGcd(tNum < 0n ? -tNum : tNum, tDen);
    tNum /= g;
    tDen /= g;
    const gq = bigGcd(qDen, tDen);
    const nq = (qDen * tDen) / gq;
    scale(q, nq / qDen);
    const te = re.map((x, i) => x - (be[i] as number));
    const tk = mkey(te);
    q.set(tk, (q.get(tk) ?? 0n) + tNum * (nq / tDen));
    qDen = nq;
    const gb = bigGcd(remDen < 0n ? -remDen : remDen, (tDen * b.den) < 0n ? -(tDen * b.den) : tDen * b.den);
    const nr = (remDen * tDen * b.den) / gb;
    const fr = nr / remDen;
    const fb = nr / (tDen * b.den);
    scale(rem, fr);
    for (const [kb, vb] of b.terms) {
      const eb = mExps(kb, n);
      const kk = mkey(te.map((x, i) => x + (eb[i] as number)));
      const nv = (rem.get(kk) ?? 0n) - tNum * fb * vb;
      if (nv === 0n) rem.delete(kk);
      else rem.set(kk, nv);
    }
    remDen = nr;
    tick.tick(b.terms.size + 1);
    if (q.size + rem.size > 100000) break;
  }
  return { q: mpolyNormalize(a.gens, q, qDen), r: mpolyNormalize(a.gens, r, rDen) };
}

/** Convert a tree to a sparse multivariate polynomial in `gens`. Null unless polynomial. */
export function treeToMPoly(t: SymNode, gens: readonly SymNode[], tick: Ticker = NO_TICK): MPoly | null {
  const idx = new Map<number, number>();
  gens.forEach((g, i) => idx.set(g.id, i));
  const n = gens.length;
  const zero = new Map<string, bigint>();
  const one = new Map<string, bigint>([[mkey(new Array<number>(n).fill(0)), 1n]]);
  const go = (x: SymNode): MPoly | null => {
    const gi = idx.get(x.id);
    if (gi !== undefined) {
      const e = new Array<number>(n).fill(0);
      e[gi] = 1;
      return mpolyNormalize(gens, new Map([[mkey(e), 1n]]), 1n);
    }
    switch (x.k) {
      case 'int': return mpolyNormalize(gens, new Map([[mkey(new Array<number>(n).fill(0)), x.v]]), 1n);
      case 'rat': return mpolyNormalize(gens, new Map([[mkey(new Array<number>(n).fill(0)), x.n]]), x.d);
      case 'float': {
        const r = floatToRatPreferShort(x.v);
        if (r === null) return null;
        return mpolyNormalize(gens, new Map([[mkey(new Array<number>(n).fill(0)), r.n]]), r.d);
      }
      case 'dec': {
        const num = x.exp >= 0 ? x.mant * 10n ** BigInt(x.exp) : x.mant;
        const den = x.exp >= 0 ? 1n : 10n ** BigInt(-x.exp);
        return mpolyNormalize(gens, new Map([[mkey(new Array<number>(n).fill(0)), num]]), den);
      }
      case 'add': {
        let acc = mpolyNormalize(gens, zero, 1n);
        for (const term of x.terms) {
          const q = go(term);
          if (q === null) return null;
          acc = mpolyAdd(acc, q, tick);
        }
        return acc;
      }
      case 'mul': {
        let acc = mpolyNormalize(gens, one, 1n);
        for (const f of x.factors) {
          const q = go(f);
          if (q === null) return null;
          acc = mpolyMul(acc, q, tick);
        }
        return acc;
      }
      case 'pow': {
        const e = asInteger(x.exp);
        if (e === null || e < 0n || e > 1000n) return null;
        const b = go(x.base);
        if (b === null) return null;
        let acc = mpolyNormalize(gens, one, 1n);
        let bb = b;
        let k = e;
        while (k > 0n) {
          if ((k & 1n) === 1n) acc = mpolyMul(acc, bb, tick);
          k >>= 1n;
          if (k > 0n) bb = mpolyMul(bb, bb, tick);
        }
        return acc;
      }
      default: return null;
    }
  };
  return go(t);
}

/** Convert a sparse multivariate polynomial back to a tree. */
export function mpolyToTree(p: MPoly): SymNode {
  if (mpolyIsZero(p)) return intN(0);
  const terms: SymNode[] = [];
  const keys = [...p.terms.keys()].sort((a, b) => lexCompare(a, b, p.gens.length));
  for (const k of keys) {
    const coeff = ratN(p.terms.get(k) as bigint, p.den);
    const exps = mExps(k, p.gens.length);
    const factors: SymNode[] = [coeff];
    exps.forEach((e, i) => {
      if (e === 1) factors.push(p.gens[i] as SymNode);
      else if (e > 1) factors.push(pow(p.gens[i] as SymNode, intN(e)));
    });
    terms.push(mul(...factors));
  }
  return add(...terms);
}

function mpolyContent(p: MPoly): bigint {
  let g = 0n;
  for (const v of p.terms.values()) g = bigGcd(g, v < 0n ? -v : v);
  return g === 0n ? 1n : g;
}

/**
 * Kronecker substitution: x_i -> t^(D^i) with D > total degree. Returns the univariate
 * image and D. At most 4 variables, total degree 12 (design limit).
 */
function kroneckerToUni(p: MPoly): { u: UPoly; d: number } | null {
  const n = p.gens.length;
  if (n > 4) return null;
  const deg = mpolyTotalDegree(p);
  if (deg > 12) return null;
  const D = deg + 1;
  const coeffs = new Map<number, bigint>();
  for (const [k, v] of p.terms) {
    const exps = mExps(k, n);
    let e = 0;
    let pw = 1;
    for (let i = 0; i < n; i++) {
      e += (exps[i] as number) * pw;
      pw *= D;
    }
    coeffs.set(e, (coeffs.get(e) ?? 0n) + v);
  }
  const maxE = Math.max(...coeffs.keys(), 0);
  const c: bigint[] = new Array<bigint>(maxE + 1).fill(0n);
  for (const [e, v] of coeffs) c[e] = v;
  return { u: upolyNormalize(c, p.den), d: D };
}

/** Recover a multivariate factor from its univariate image by base-D digits. */
function kroneckerFromUni(u: UPoly, gens: readonly SymNode[], D: number): MPoly | null {
  const n = gens.length;
  const terms = new Map<string, bigint>();
  for (let e = 0; e < u.c.length; e++) {
    const v = u.c[e] as bigint;
    if (v === 0n) continue;
    let rest = e;
    const exps: number[] = [];
    for (let i = 0; i < n; i++) {
      exps.push(rest % D);
      rest = Math.floor(rest / D);
    }
    if (rest !== 0) return null;
    terms.set(mkey(exps), v);
  }
  return mpolyNormalize(gens, terms, u.den);
}

export interface MFactor {
  readonly f: MPoly;
  readonly m: number;
}

/**
 * Factor a multivariate polynomial: content, then Kronecker substitution to one variable,
 * factor there, recover candidates and trial-divide. At most 4 variables, total degree 12.
 */
export function mpolyFactor(p: MPoly, tick: Ticker = NO_TICK): { content: bigint; factors: MFactor[]; rest: MPoly } {
  const content = mpolyContent(p);
  const prim = mpolyNormalize(p.gens, new Map([...p.terms].map(([k, v]) => [k, v / content] as [string, bigint])), p.den);
  if (prim.terms.size <= 1) return { content, factors: [], rest: prim };
  const ku = kroneckerToUni(prim);
  if (ku === null) return { content, factors: [], rest: prim };
  const uf = upolyFactor(ku.u, tick);
  const all = [...uf.factors, ...uf.irreducible];
  if (all.length <= 1 && (all[0] === undefined || upolyDegree(all[0].f) >= upolyDegree(ku.u))) {
    return { content, factors: [], rest: prim };
  }
  let rest = prim;
  const factors: MFactor[] = [];
  for (const { f, m } of all) {
    for (let k = 0; k < m; k++) {
      const cand = kroneckerFromUni(f, p.gens, ku.d);
      if (cand === null) {
        rest = mpolyMul(rest, mpolyNormalize(p.gens, new Map([[mkey(new Array<number>(p.gens.length).fill(0)), 1n]]), 1n), tick);
        break;
      }
      const { q, r } = mpolyDivMod(rest, cand, tick);
      if (mpolyIsZero(r)) {
        factors.push({ f: cand, m: 1 });
        rest = q;
      } else {
        break;
      }
    }
  }
  const merged: MFactor[] = [];
  for (const f of factors) {
    const last = merged[merged.length - 1];
    if (last !== undefined && mpolyEqual(last.f, f.f)) merged[merged.length - 1] = { f: last.f, m: last.m + 1 };
    else merged.push({ f: f.f, m: 1 });
  }
  return { content, factors: merged, rest };
}

function mpolyEqual(a: MPoly, b: MPoly): boolean {
  if (a.terms.size !== b.terms.size) return false;
  for (const [k, v] of a.terms) {
    if ((b.terms.get(k) ?? 0n) * a.den !== v * b.den) return false;
  }
  return true;
}

/**
 * GCD of two multivariate polynomials by Kronecker images: gcd the images, recover
 * candidates, keep the greatest that divides both. Falls back to content gcd.
 */
export function mpolyGcd(a: MPoly, b: MPoly, tick: Ticker = NO_TICK): MPoly {
  if (mpolyIsZero(a)) return b;
  if (mpolyIsZero(b)) return a;
  const gens = a.gens;
  const ka = kroneckerToUni(a);
  const kb = kroneckerToUni(b);
  if (ka === null || kb === null || ka.d !== kb.d) {
    const g = bigGcd(mpolyContent(a), mpolyContent(b));
    return mpolyNormalize(gens, new Map([[mkey(new Array<number>(gens.length).fill(0)), g]]), 1n);
  }
  const g = upolyGcd(ka.u, kb.u, tick);
  if (upolyDegree(g) <= 0) {
    const c = bigGcd(mpolyContent(a), mpolyContent(b));
    return mpolyNormalize(gens, new Map([[mkey(new Array<number>(gens.length).fill(0)), c]]), 1n);
  }
  const cand = kroneckerFromUni(g, gens, ka.d);
  if (cand === null) {
    return mpolyNormalize(gens, new Map([[mkey(new Array<number>(gens.length).fill(0)), 1n]]), 1n);
  }
  const ra = mpolyDivMod(a, cand, tick).r;
  const rb = mpolyDivMod(b, cand, tick).r;
  if (mpolyIsZero(ra) && mpolyIsZero(rb)) return cand;
  const uf = upolyFactor(g, tick);
  let best = mpolyNormalize(gens, new Map([[mkey(new Array<number>(gens.length).fill(0)), 1n]]), 1n);
  for (const { f } of [...uf.factors, ...uf.irreducible]) {
    const c = kroneckerFromUni(f, gens, ka.d);
    if (c === null) continue;
    if (mpolyIsZero(mpolyDivMod(a, c, tick).r) && mpolyIsZero(mpolyDivMod(b, c, tick).r)) {
      best = mpolyMul(best, c, tick);
    }
  }
  return best;
}

/* --------------------------------- resultant ------------------------------- */

/** Bareiss fraction-free determinant for small integer matrices. */
function bareissDet(m: bigint[][]): bigint {
  const n = m.length;
  if (n === 0) return 1n;
  const a = m.map((row) => row.slice());
  let prev = 1n;
  for (let k = 0; k < n - 1; k++) {
    if (a[k]?.[k] === 0n) {
      let swap = -1;
      for (let i = k + 1; i < n; i++) {
        if (a[i]?.[k] !== 0n) {
          swap = i;
          break;
        }
      }
      if (swap < 0) return 0n;
      const tmp = a[k] as bigint[];
      a[k] = a[swap] as bigint[];
      a[swap] = tmp.map((x) => -x);
    }
    for (let i = k + 1; i < n; i++) {
      for (let j = k + 1; j < n; j++) {
        a[i]![j] = ((a[i]![j] as bigint) * (a[k]![k] as bigint) - (a[i]![k] as bigint) * (a[k]![j] as bigint)) / prev;
      }
    }
    prev = a[k]![k] as bigint;
    if (prev === 0n) return 0n;
  }
  return a[n - 1]![n - 1] as bigint;
}

/**
 * Resultant of the integer coefficient polynomials (denominators cleared) via the
 * Sylvester determinant. Zero iff the two share a factor. Sylvester matrices above
 * 20x20 fall back through the gcd (zero iff a common factor exists).
 */
export function upolyResultant(a: UPoly, b: UPoly, tick: Ticker = NO_TICK): bigint {
  const da = upolyDegree(a);
  const db = upolyDegree(b);
  if (da < 0 || db < 0) return 0n;
  if (da === 0 && db === 0) return 1n;
  if (da === 0) return (a.c[0] as bigint) ** BigInt(db);
  if (db === 0) return (b.c[0] as bigint) ** BigInt(da) * ((da * db) % 2 === 0 ? 1n : -1n);
  const n = da + db;
  if (n > 20) {
    const g = upolyGcd(a, b, tick);
    return upolyDegree(g) > 0 ? 0n : 1n;
  }
  const m: bigint[][] = Array.from({ length: n }, () => new Array<bigint>(n).fill(0n));
  for (let i = 0; i < db; i++) {
    for (let j = 0; j <= da; j++) m[i]![n - 1 - (i + j)] = a.c[da - j] as bigint;
  }
  for (let i = 0; i < da; i++) {
    for (let j = 0; j <= db; j++) m[db + i]![n - 1 - (i + j)] = b.c[db - j] as bigint;
  }
  tick.tick(n * n);
  return bareissDet(m);
}

/** Discriminant of a univariate polynomial. */
export function upolyDiscriminant(p: UPoly, tick: Ticker = NO_TICK): bigint {
  const d = upolyDegree(p);
  if (d <= 0) return 1n;
  const r = upolyResultant(p, upolyDerivative(p), tick);
  const lc = upolyLead(p);
  const sign = (d * (d - 1)) / 2 % 2 === 0 ? 1n : -1n;
  return (sign * r) / lc;
}

/**
 * Resultant of two bivariate polynomials in (x, y) with respect to y, giving a
 * univariate polynomial in x. Total degree at most 4 each (design limit).
 */
export function resultantY(a: SymNode, b: SymNode, x: SymNode, y: SymNode, tick: Ticker = NO_TICK): SymNode | null {
  const pa = treeToMPoly(a, [x, y], tick);
  const pb = treeToMPoly(b, [x, y], tick);
  if (pa === null || pb === null) return null;
  const degY = (p: MPoly): number => {
    let m = 0;
    for (const k of p.terms.keys()) {
      const e = mExps(k, 2)[1] as number;
      if (e > m) m = e;
    }
    return m;
  };
  const da = degY(pa);
  const db = degY(pb);
  if (da <= 0 || db <= 0) return null;
  const coeffY = (p: MPoly, j: number): MPoly => {
    const terms = new Map<string, bigint>();
    for (const [k, v] of p.terms) {
      const e = mExps(k, 2);
      if (e[1] === j) terms.set(mkey([e[0] as number, 0]), v);
    }
    return mpolyNormalize(p.gens, terms, p.den);
  };
  const n = da + db;
  const mat: MPoly[][] = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => mpolyNormalize(pa.gens, new Map(), 1n)),
  );
  for (let i = 0; i < db; i++) {
    for (let j = 0; j <= da; j++) mat[i]![n - 1 - (i + j)] = coeffY(pa, da - j);
  }
  for (let i = 0; i < da; i++) {
    for (let j = 0; j <= db; j++) mat[db + i]![n - 1 - (i + j)] = coeffY(pb, db - j);
  }
  return mpolyToTree(mpolyDetLeibniz(mat, tick));
}

/**
 * Determinant by Leibniz expansion. The Sylvester matrices here are at most 8x8
 * (resultants of total degree <= 4), and typically 4x4, so expansion is fast enough
 * and needs no exact division.
 */
function mpolyDetLeibniz(m: MPoly[][], tick: Ticker): MPoly {
  const n = m.length;
  const gens = (m[0] as MPoly[])[0]?.gens ?? [];
  const zero = mpolyNormalize(gens, new Map(), 1n);
  const one = mpolyNormalize(gens, new Map([[mkey(new Array<number>(gens.length).fill(0)), 1n]]), 1n);
  if (n === 0) return one;
  if (n > 8) return zero;
  const neg = (p: MPoly): MPoly =>
    mpolyNormalize(p.gens, new Map([...p.terms].map(([k, v]) => [k, -v] as [string, bigint])), p.den);
  let det = zero;
  const perm = Array.from({ length: n }, (_, i) => i);
  const sub = (a: MPoly, b: MPoly): MPoly => mpolyAdd(a, neg(b), tick);
  for (;;) {
    let prod = one;
    for (let i = 0; i < n; i++) prod = mpolyMul(prod, (m[i] as MPoly[])[perm[i] as number] as MPoly, tick);
    let inv = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if ((perm[i] as number) > (perm[j] as number)) inv++;
      }
    }
    det = inv % 2 === 0 ? mpolyAdd(det, prod, tick) : sub(det, prod);
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
