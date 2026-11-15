/**
 * Factoring square-free integer polynomials by the modular method (cas/design.md 5.6 and 5.8; findings SYM-SM-17 and
 * SYM-SM-25): factor modulo a small prime (distinct-degree, then equal-degree splitting with a seeded generator, so the
 * answer never depends on chance), lift the factors with Hensel's lemma past the Mignotte bound, and recombine subsets
 * by trial division over the integers. A polynomial that is irreducible modulo some prime is irreducible over the
 * integers, which ends most irreducible inputs in microseconds.
 *
 * Coefficients are lowest degree first. Pure; every loop ticks.
 */
import type { Ticker } from './poly';

type ZP = number[]; // a polynomial over Z/p, lowest first, no trailing zeros

const PRIMES = [3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151, 157, 163, 167, 173, 179, 181, 191, 193, 197, 199, 211, 223, 227, 229, 233, 239, 241, 251];

const mod = (a: number, p: number): number => ((a % p) + p) % p;

function trim(a: ZP): ZP {
  let n = a.length;
  while (n > 0 && a[n - 1] === 0) n--;
  return n === a.length ? a : a.slice(0, n);
}

const deg = (a: ZP): number => a.length - 1;

function inv(a: number, p: number): number {
  let [r0, r1, s0, s1] = [mod(a, p), p, 1, 0];
  while (r1 !== 0) {
    const q = Math.floor(r0 / r1);
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  return mod(s0, p);
}

function sub(a: ZP, b: ZP, p: number): ZP {
  const out: number[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) out.push(mod((a[i] ?? 0) - (b[i] ?? 0), p));
  return trim(out);
}

function mulp(a: ZP, b: ZP, p: number): ZP {
  if (a.length === 0 || b.length === 0) return [];
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] as number;
    if (ai === 0) continue;
    for (let j = 0; j < b.length; j++) out[i + j] = ((out[i + j] as number) + ai * (b[j] as number)) % p;
  }
  return trim(out);
}

function divmod(a: ZP, b: ZP, p: number): { q: ZP; r: ZP } {
  const r = a.slice();
  const db = deg(b);
  const lead = inv(b[db] as number, p);
  const q = new Array<number>(Math.max(0, deg(a) - db + 1)).fill(0);
  for (let i = deg(a) - db; i >= 0; i--) {
    const c = ((r[i + db] as number) * lead) % p;
    q[i] = c;
    if (c === 0) continue;
    for (let j = 0; j <= db; j++) r[i + j] = mod((r[i + j] as number) - c * (b[j] as number), p);
  }
  return { q: trim(q), r: trim(r.slice(0, db)) };
}

const rem = (a: ZP, b: ZP, p: number): ZP => divmod(a, b, p).r;

function monic(a: ZP, p: number): ZP {
  const l = inv(a[deg(a)] as number, p);
  return a.map((c) => (c * l) % p);
}

function gcd(a: ZP, b: ZP, p: number): ZP {
  let [x, y] = [a, b];
  while (y.length > 0) [x, y] = [y, rem(x, y, p)];
  return x.length === 0 ? x : monic(x, p);
}

function derivative(a: ZP, p: number): ZP {
  return trim(a.slice(1).map((c, i) => mod(c * (i + 1), p)));
}

function powmod(base: ZP, e: bigint, m: ZP, p: number, tick: Ticker): ZP {
  let r: ZP = [1];
  let b = rem(base, m, p);
  let k = e;
  while (k > 0n) {
    tick.tick(deg(m) + 1);
    if ((k & 1n) === 1n) r = rem(mulp(r, b, p), m, p);
    b = rem(mulp(b, b, p), m, p);
    k >>= 1n;
  }
  return r;
}

/** Distinct-degree factorisation of a monic square-free polynomial: products of the factors of each degree. */
function ddf(f: ZP, p: number, tick: Ticker): { g: ZP; d: number }[] {
  const out: { g: ZP; d: number }[] = [];
  let rest = f;
  let h: ZP = [0, 1];
  for (let d = 1; 2 * d <= deg(rest); d++) {
    h = powmod(h, BigInt(p), rest, p, tick);
    const g = gcd(rest, sub(h, [0, 1], p), p);
    if (deg(g) > 0) {
      out.push({ g, d });
      rest = divmod(rest, g, p).q;
      h = rem(h, rest, p);
    }
  }
  if (deg(rest) > 0) out.push({ g: monic(rest, p), d: deg(rest) });
  return out;
}

/** Equal-degree splitting (Cantor-Zassenhaus) with a seeded generator, so the result never varies. */
function edf(g: ZP, d: number, p: number, tick: Ticker): ZP[] {
  if (deg(g) === d) return [g];
  let seed = 12345;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed;
  };
  const e = (BigInt(p) ** BigInt(d) - 1n) / 2n;
  for (let tries = 0; tries < 200; tries++) {
    const a: ZP = trim(Array.from({ length: deg(g) }, () => rnd() % p));
    if (deg(a) < 1) continue;
    const b = sub(powmod(a, e, g, p, tick), [1], p);
    const c = gcd(g, b, p);
    if (deg(c) > 0 && deg(c) < deg(g)) return [...edf(c, d, p, tick), ...edf(divmod(g, c, p).q, d, p, tick)];
  }
  return [g];
}

/** The monic irreducible factors of a monic square-free polynomial modulo p. */
function factorModP(f: ZP, p: number, tick: Ticker): ZP[] {
  const out: ZP[] = [];
  for (const { g, d } of ddf(f, p, tick)) out.push(...edf(g, d, p, tick));
  return out;
}

/* ------------------------------ over the integers ------------------------------ */

const absb = (x: bigint): bigint => (x < 0n ? -x : x);
const smod = (a: bigint, m: bigint): bigint => {
  const r = ((a % m) + m) % m;
  return r > m / 2n ? r - m : r;
};
const pmod = (a: bigint, m: bigint): bigint => ((a % m) + m) % m;

function zTrim(a: bigint[]): bigint[] {
  let n = a.length;
  while (n > 0 && a[n - 1] === 0n) n--;
  return a.slice(0, n);
}

function zMul(a: readonly bigint[], b: readonly bigint[], m?: bigint): bigint[] {
  if (a.length === 0 || b.length === 0) return [];
  const out = new Array<bigint>(a.length + b.length - 1).fill(0n);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] = (out[i + j] as bigint) + (a[i] as bigint) * (b[j] as bigint);
  return zTrim(m === undefined ? out : out.map((c) => pmod(c, m)));
}

/** Exact division over the integers; null when it does not divide. */
function zDiv(a: readonly bigint[], b: readonly bigint[]): bigint[] | null {
  const r = a.slice();
  const db = b.length - 1;
  const lead = b[db] as bigint;
  const q = new Array<bigint>(Math.max(0, a.length - b.length + 1)).fill(0n);
  for (let i = a.length - 1 - db; i >= 0; i--) {
    const top = r[i + db] as bigint;
    if (top % lead !== 0n) return null;
    const c = top / lead;
    q[i] = c;
    for (let j = 0; j <= db; j++) r[i + j] = (r[i + j] as bigint) - c * (b[j] as bigint);
  }
  return r.slice(0, db).every((x) => x === 0n) ? zTrim(q) : null;
}

function content(a: readonly bigint[]): bigint {
  let g = 0n;
  for (const c of a) {
    let x = absb(c);
    let y = g;
    while (y !== 0n) [x, y] = [y, x % y];
    g = x;
  }
  return g;
}

function primitive(a: readonly bigint[]): bigint[] {
  const c = content(a);
  const s = (a[a.length - 1] as bigint) < 0n ? -1n : 1n;
  return a.map((x) => (x / c) * s);
}

/** s, t with s a + t b = 1 modulo p (a, b coprime). */
function bezout(a: ZP, b: ZP, p: number): { s: ZP; t: ZP } {
  let [r0, r1] = [a, b];
  let [s0, s1]: [ZP, ZP] = [[1], []];
  let [t0, t1]: [ZP, ZP] = [[], [1]];
  while (r1.length > 0) {
    const { q, r } = divmod(r0, r1, p);
    [r0, r1] = [r1, r];
    [s0, s1] = [s1, sub(s0, mulp(q, s1, p), p)];
    [t0, t1] = [t1, sub(t0, mulp(q, t1, p), p)];
  }
  const l = inv(r0[0] as number, p);
  return { s: s0.map((c) => (c * l) % p), t: t0.map((c) => (c * l) % p) };
}

function zModP(a: readonly bigint[], p: number): ZP {
  return trim(a.map((c) => Number(pmod(c, BigInt(p)))));
}

const big = (a: ZP): bigint[] => a.map((c) => BigInt(c));
const zAdd = (a: readonly bigint[], b: readonly bigint[], m: bigint): bigint[] =>
  zTrim(Array.from({ length: Math.max(a.length, b.length) }, (_, i) => pmod((a[i] ?? 0n) + (b[i] ?? 0n), m)));
const zSub = (a: readonly bigint[], b: readonly bigint[], m: bigint): bigint[] =>
  zTrim(Array.from({ length: Math.max(a.length, b.length) }, (_, i) => pmod((a[i] ?? 0n) - (b[i] ?? 0n), m)));

/** Division with remainder modulo m by a monic divisor. */
function zDivModMonic(a: readonly bigint[], b: readonly bigint[], m: bigint): { q: bigint[]; r: bigint[] } {
  const r = a.map((c) => pmod(c, m));
  const db = b.length - 1;
  if (r.length <= db) return { q: [], r: zTrim(r) };
  const q = new Array<bigint>(r.length - db).fill(0n);
  for (let i = r.length - 1 - db; i >= 0; i--) {
    const c = pmod(r[i + db] as bigint, m);
    q[i] = c;
    if (c === 0n) continue;
    for (let j = 0; j <= db; j++) r[i + j] = pmod((r[i + j] as bigint) - c * (b[j] as bigint), m);
  }
  return { q: zTrim(q), r: zTrim(r.slice(0, db)) };
}

/**
 * One quadratic Hensel step (von zur Gathen and Gerhard, Algorithm 15.10): from f = g h and s g + t h = 1 modulo m, with
 * h monic, the same modulo M (M a power of p that divides m^2).
 */
function henselStep(f: readonly bigint[], g: bigint[], h: bigint[], s: bigint[], t: bigint[], M: bigint): { g: bigint[]; h: bigint[]; s: bigint[]; t: bigint[] } {
  const e = zSub(f, zMul(g, h, M), M);
  const { q, r } = zDivModMonic(zMul(s, e, M), h, M);
  const g2 = zAdd(zAdd(g, zMul(t, e, M), M), zMul(q, g, M), M);
  const h2 = zAdd(h, r, M);
  const b = zSub(zAdd(zMul(s, g2, M), zMul(t, h2, M), M), [1n], M);
  const { q: c, r: d } = zDivModMonic(zMul(s, b, M), h2, M);
  const s2 = zSub(s, d, M);
  const t2 = zSub(zSub(t, zMul(t, b, M), M), zMul(c, g2, M), M);
  return { g: g2, h: h2, s: s2, t: t2 };
}

/**
 * Lifts the factorisation f = lc(f) * prod(fs) (mod p, every fs monic) to modulo M = p^k. Returns the lifted monic
 * factors, in the order of fs. The list is split in two, the pair lifted, and each half lifted from its own product.
 */
function liftAll(f: readonly bigint[], fs: readonly ZP[], p: number, M: bigint, tick: Ticker): bigint[][] {
  const lcF = f[f.length - 1] as bigint;
  if (fs.length === 1) return [f.map((c) => pmod(c * modInverse(pmod(lcF, M), M), M))];
  const half = Math.floor(fs.length / 2);
  const a = fs.slice(0, half).reduce((x, y) => mulp(x, y, p), [1] as ZP);
  const b = fs.slice(half).reduce((x, y) => mulp(x, y, p), [1] as ZP);
  const P = BigInt(p);
  const ga = mulp(a, [Number(pmod(lcF, P))], p);
  const st = bezout(ga, b, p);
  let cur = { g: big(ga), h: big(b), s: big(st.s), t: big(st.t) };
  let m = P;
  while (m < M) {
    tick.tick(f.length * 8);
    m = m * m > M ? M : m * m;
    cur = henselStep(f, cur.g, cur.h, cur.s, cur.t, m);
  }
  return [...liftAll(cur.g, fs.slice(0, half), p, M, tick), ...liftAll(cur.h, fs.slice(half), p, M, tick)];
}

function modInverse(a: bigint, m: bigint): bigint {
  let [r0, r1, s0, s1] = [a, m, 1n, 0n];
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  return pmod(s0, m);
}

/** Subsets of 0..n-1 with `size` members, in order. */
function* subsets(n: number, size: number, from = 0): Generator<number[]> {
  if (size === 0) {
    yield [];
    return;
  }
  for (let i = from; i <= n - size; i++) for (const rest of subsets(n, size - 1, i + 1)) yield [i, ...rest];
}

/**
 * The irreducible factors over the integers of a primitive square-free polynomial of degree >= 2 (lowest first, positive
 * leading coefficient), or null when the work would pass its caps (the caller keeps the polynomial whole).
 */
export function zassenhaus(f: readonly bigint[], tick: Ticker): bigint[][] | null {
  const n = f.length - 1;
  if (n < 2) return [f.slice()];
  const lc = f[n] as bigint;
  // a good prime: it keeps the degree and the image square-free; of a few, the one with the fewest factors
  let best: { p: number; fs: ZP[] } | undefined;
  let good = 0;
  for (const p of PRIMES) {
    if (lc % BigInt(p) === 0n) continue;
    const fp = zModP(f, p);
    if (deg(fp) !== n) continue;
    if (deg(gcd(fp, derivative(fp, p), p)) > 0) continue;
    const fs = factorModP(monic(fp, p), p, tick);
    if (fs.length === 1) return [f.slice()];
    if (!best || fs.length < best.fs.length) best = { p, fs };
    if (++good >= 12) break;
  }
  if (!best) return null;
  if (best.fs.length > 24) return null;
  // the Mignotte bound on the coefficients of any factor, times the leading coefficient
  let norm = 0n;
  for (const c of f) norm += c * c;
  const B = (bigSqrt(norm) + 1n) * 2n ** BigInt(n) * absb(lc);
  const P = BigInt(best.p);
  let M = P;
  while (M <= 2n * B) M *= P;
  const lifted = liftAll(f, best.fs, best.p, M, tick);
  // recombination: try subsets of growing size; each found factor is taken out of the rest
  let rest = f.slice();
  let pool = lifted.map((_, i) => i);
  const out: bigint[][] = [];
  let size = 1;
  let tries = 0;
  while (2 * size <= pool.length) {
    let found = false;
    for (const sub of subsets(pool.length, size)) {
      if (++tries > 500000) return null;
      tick.tick(1);
      const lcr = rest[rest.length - 1] as bigint;
      // the constant term test: the candidate's constant term must divide lc * rest(0), checked before any product
      let c0 = lcr;
      for (const i of sub) c0 = pmod(c0 * ((lifted[pool[i] as number] as bigint[])[0] ?? 0n), M);
      const t0 = smod(c0, M);
      const r0 = (rest[0] as bigint) * lcr;
      if (t0 === 0n ? r0 !== 0n : r0 % t0 !== 0n) continue;
      tick.tick(rest.length);
      let cand: bigint[] = [lcr];
      for (const i of sub) cand = zMul(cand, lifted[pool[i] as number] as bigint[], M);
      cand = primitive(cand.map((c) => smod(c, M)));
      const q = zDiv(rest, cand);
      if (q === null) continue;
      out.push(cand);
      rest = q;
      pool = pool.filter((_, i) => !sub.includes(i));
      found = true;
      break;
    }
    if (!found) size++;
  }
  out.push(primitive(rest));
  return out;
}

function bigSqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x--;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x;
}
