/**
 * Exact whole-number tools (cas/design.md 2.6): primality, factorisation, divisors,
 * bases, extended gcd, modular powers, binomial coefficients. All BigInt; pure.
 */
import { bigGcd, bigIsqrt } from './node';

/* --------------------------------- primes ----------------------------------- */

function modMul(a: bigint, b: bigint, m: bigint): bigint {
  return (a * b) % m;
}

function modPowBig(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let r = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) r = modMul(r, b, mod);
    b = modMul(b, b, mod);
    e >>= 1n;
  }
  return r;
}

function millerRabinWitness(n: bigint, a: bigint, d: bigint, s: number): boolean {
  let x = modPowBig(a, d, n);
  if (x === 1n || x === n - 1n) return false;
  for (let r = 1; r < s; r++) {
    x = modMul(x, x, n);
    if (x === n - 1n) return false;
  }
  return true;
}

/**
 * Deterministic Miller-Rabin: exact below 3.3e24 with bases 2,3,5,7,11,13,17, and a
 * wider base set beyond (first 20 prime bases).
 */
export function isPrimeBig(n: bigint): boolean {
  if (n < 2n) return false;
  const small = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
  for (const p of small) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  let d = n - 1n;
  let s = 0;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    s++;
  }
  // Exact below 3.3e24 with the first 13 primes; the smallest strong pseudoprime to all 13
  // is 3317044064679887385961981, so from there on the set grows to the first 20 primes.
  const bases = n < 341550071728321n
    ? [2n, 3n, 5n, 7n, 11n, 13n, 17n]
    : n < 3317044064679887385961981n
      ? [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n]
      : [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n, 43n, 47n, 53n, 59n, 61n, 67n, 71n];
  for (const a of bases) {
    if (a >= n) continue;
    if (millerRabinWitness(n, a, d, s)) return false;
  }
  return true;
}

export function nextPrimeBig(n: bigint): bigint {
  if (n < 2n) return 2n;
  let c = n + 1n;
  if ((c & 1n) === 0n) {
    if (c === 2n) return 2n;
    c++;
  }
  for (;;) {
    if (isPrimeBig(c)) return c;
    c += 2n;
  }
}

export function previousPrimeBig(n: bigint): bigint | null {
  if (n <= 2n) return null;
  let c = n - 1n;
  if ((c & 1n) === 0n) {
    if (c === 2n) return 2n;
    c--;
  }
  for (;;) {
    if (isPrimeBig(c)) return c;
    if (c <= 3n) return 2n;
    c -= 2n;
  }
}

/* ------------------------------- factorisation ------------------------------- */

function trialPrimes(limit: number): readonly number[] {
  const sieve = new Array<boolean>(limit + 1).fill(true);
  sieve[0] = false;
  if (limit >= 1) sieve[1] = false;
  for (let i = 2; i * i <= limit; i++) {
    if (sieve[i] === true) {
      for (let j = i * i; j <= limit; j += i) sieve[j] = false;
    }
  }
  const out: number[] = [];
  for (let i = 2; i <= limit; i++) if (sieve[i] === true) out.push(i);
  return out;
}

const SMALL_PRIMES = trialPrimes(100000);

/** Pollard rho, Brent variant, with a step budget. Null when the budget runs out. */
function pollardBrent(n: bigint, budget: { steps: number }): bigint | null {
  if (n % 2n === 0n) return 2n;
  let y = 2n;
  let c = 1n;
  let m = 128n;
  let g = 1n;
  let r = 1n;
  let q = 1n;
  const f = (x: bigint): bigint => (modMul(x, x, n) + c) % n;
  let x: bigint;
  for (;;) {
    if (budget.steps <= 0) return null;
    x = y;
    for (let i = 0n; i < r; i++) {
      y = f(y);
      budget.steps--;
      if (budget.steps <= 0) return null;
    }
    let k = 0n;
    while (k < r && g === 1n) {
      const limit = m < r - k ? m : r - k;
      for (let i = 0n; i < limit; i++) {
        y = f(y);
        const d = x > y ? x - y : y - x;
        q = modMul(q, d, n);
        budget.steps--;
        if (budget.steps <= 0) return null;
      }
      g = bigGcd(q, n);
      k += m;
    }
    if (g === n) {
      c++;
      if (c > 20n) {
        m *= 2n;
        c = 1n;
      }
      y = 2n;
      r = 1n;
      q = 1n;
      g = 1n;
      continue;
    }
    if (g !== 1n) return g;
    r *= 2n;
  }
}

/**
 * Prime factors with repeats, ascending. Trial division to 1e6 (sieve to 1e5, then odd
 * steps), then Pollard rho. Returns null when the step budget runs out.
 */
export function primeFactorsBig(n: bigint, maxSteps = 2000000): bigint[] | null {
  if (n < 0n) n = -n;
  if (n < 2n) return [];
  const out: bigint[] = [];
  const budget = { steps: maxSteps };
  let rest = n;
  for (const p of SMALL_PRIMES) {
    const bp = BigInt(p);
    if (bp * bp > rest) break;
    while (rest % bp === 0n) {
      out.push(bp);
      rest /= bp;
    }
    budget.steps -= 2;
    if (budget.steps <= 0) return null;
  }
  let trial = 100001n;
  const trialCap = 1000000n;
  while (trial <= trialCap && trial * trial <= rest) {
    if (rest % trial === 0n) {
      out.push(trial);
      rest /= trial;
    } else {
      trial += 2n;
    }
    budget.steps--;
    if (budget.steps <= 0) return null;
  }
  if (rest === 1n) return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const stack: bigint[] = [rest];
  while (stack.length > 0) {
    const m = stack.pop() as bigint;
    if (m === 1n) continue;
    if (isPrimeBig(m)) {
      out.push(m);
      continue;
    }
    const f = pollardBrent(m, budget);
    if (f === null) return null;
    stack.push(f, m / f);
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Group equal factors: [prime, exponent] pairs. */
export function factorMultiplicity(factors: readonly bigint[]): { p: bigint; e: number }[] {
  const out: { p: bigint; e: number }[] = [];
  for (const f of factors) {
    const last = out[out.length - 1];
    if (last !== undefined && last.p === f) last.e++;
    else out.push({ p: f, e: 1 });
  }
  return out;
}

export function divisorsFromFactors(groups: readonly { p: bigint; e: number }[]): bigint[] {
  let divs: bigint[] = [1n];
  for (const { p, e } of groups) {
    const next: bigint[] = [];
    let pk = 1n;
    for (let k = 0; k <= e; k++) {
      for (const d of divs) next.push(d * pk);
      pk *= p;
    }
    divs = next;
  }
  return divs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/* ------------------------------ gcd, powers, base ---------------------------- */

/** Extended gcd: [g, s, t] with s a + t b == g, g >= 0. */
export function extendedGcdBig(a: bigint, b: bigint): [bigint, bigint, bigint] {
  let oldR = a;
  let r = b;
  let oldS = 1n;
  let s = 0n;
  let oldT = 0n;
  let t = 1n;
  while (r !== 0n) {
    const q = oldR / r;
    const tmpR = oldR - q * r;
    oldR = r;
    r = tmpR;
    const tmpS = oldS - q * s;
    oldS = s;
    s = tmpS;
    const tmpT = oldT - q * t;
    oldT = t;
    t = tmpT;
  }
  if (oldR < 0n) return [-oldR, -oldS, -oldT];
  return [oldR, oldS, oldT];
}

export function modPowBigInt(a: bigint, e: bigint, m: bigint): bigint {
  return modPowBig(a, e, m);
}

const BASE_DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

export function toBaseBig(n: bigint, base: bigint): string {
  if (base < 2n || base > 36n) throw new Error('toBase: base out of range');
  if (n === 0n) return '0';
  const neg = n < 0n;
  if (neg) n = -n;
  let out = '';
  while (n > 0n) {
    out = (BASE_DIGITS[Number(n % base)] as string) + out;
    n /= base;
  }
  return neg ? '-' + out : out;
}

export function fromBaseText(text: string, base: bigint): bigint | null {
  if (base < 2n || base > 36n) return null;
  const t = text.trim().toLowerCase();
  if (t === '') return null;
  let i = 0;
  let neg = false;
  if (t[0] === '-') {
    neg = true;
    i = 1;
  } else if (t[0] === '+') {
    i = 1;
  }
  if (i >= t.length) return null;
  let v = 0n;
  for (; i < t.length; i++) {
    const d = BASE_DIGITS.indexOf(t[i] as string);
    if (d < 0 || BigInt(d) >= base) return null;
    v = v * base + BigInt(d);
  }
  return neg ? -v : v;
}

/* --------------------------- binomials, rationals ---------------------------- */

/** Exact binomial coefficient by the multiplicative formula with gcd reduction. */
export function binomialBig(n: bigint, k: bigint): bigint {
  if (k < 0n || k > n) return 0n;
  if (k === 0n || k === n) return 1n;
  if (k > n - k) k = n - k;
  let num = 1n;
  let den = 1n;
  for (let i = 1n; i <= k; i++) {
    num *= n - k + i;
    den *= i;
    const g = bigGcd(num < 0n ? -num : num, den);
    num /= g;
    den /= g;
  }
  return num / den;
}

/** Exact permutations n!/(n-k)!. */
export function permutationsBig(n: bigint, k: bigint): bigint {
  if (k < 0n || k > n) return 0n;
  let r = 1n;
  for (let i = 0n; i < k; i++) r *= n - i;
  return r;
}

export function factorialBig(n: bigint): bigint {
  if (n < 0n) throw new Error('factorial of negative');
  let r = 1n;
  for (let i = 2n; i <= n; i++) r *= i;
  return r;
}

/**
 * Shortest decimal that round-trips, as an exact rational, when it has at most 15
 * significant digits; null otherwise (cas/design.md 5.4: free literal entry rule).
 */
export function shortestDecimalRational(v: number): { n: bigint; d: bigint } | null {
  if (!Number.isFinite(v)) return null;
  const text = String(v);
  const m = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (m === null) return null;
  const sig = ((m[2] as string) + (m[3] ?? '')).replace(/^0+/, '').replace(/0+$/, '');
  if (sig.length > 15) return null;
  const neg = m[1] === '-';
  const intPart = m[2] as string;
  const fracPart = m[3] ?? '';
  const exp = m[4] === undefined ? 0 : Number.parseInt(m[4], 10);
  let num = BigInt((intPart + fracPart) === '' ? '0' : intPart + fracPart);
  let den = 10n ** BigInt(fracPart.length);
  if (exp >= 0) num *= 10n ** BigInt(exp);
  else den *= 10n ** BigInt(-exp);
  if (neg) num = -num;
  const g = bigGcd(num < 0n ? -num : num, den);
  return { n: num / g, d: den / g };
}

/**
 * The exact binary value of a float as a rational (every double is an exact binary
 * fraction). Null only for non-finite inputs. Used when inexact inputs must still
 * solve; the caller flags the result inexact.
 */
export function floatToExactRat(v: number): { n: bigint; d: bigint } | null {
  if (!Number.isFinite(v)) return null;
  if (v === 0) return { n: 0n, d: 1n };
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const neg = (hi >>> 31) === 1;
  const expBits = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let m: bigint;
  let e: bigint;
  if (expBits === 0) {
    m = frac;
    e = -1074n;
  } else {
    m = frac | (1n << 52n);
    e = BigInt(expBits) - 1075n;
  }
  let n = neg ? -m : m;
  let d = 1n;
  if (e >= 0n) n *= 2n ** e;
  else d = 2n ** -e;
  const g = bigGcd(n < 0n ? -n : n, d);
  return { n: n / g, d: d / g };
}

/**
 * A float as a rational, preferring the shortest round-trip decimal (so 0.1 is 1/10)
 * and falling back to the exact binary value. Null only for non-finite inputs.
 */
export function floatToRatPreferShort(v: number): { n: bigint; d: bigint } | null {
  return shortestDecimalRational(v) ?? floatToExactRat(v);
}

/**
 * Nearest simple fraction within tolerance 1e-12 (for Rationalize of numeric inputs).
 * Continued fractions; null when no short fraction is close enough.
 */
export function nearestFraction(v: number, tol = 1e-12, maxDen = 1000000n): { n: bigint; d: bigint } | null {
  if (!Number.isFinite(v)) return null;
  const neg = v < 0;
  let x = Math.abs(v);
  let h0 = 0n;
  let h1 = 1n;
  let k0 = 1n;
  let k1 = 0n;
  for (let i = 0; i < 64; i++) {
    const a = Math.floor(x);
    const h2 = BigInt(a) * h1 + h0;
    const k2 = BigInt(a) * k1 + k0;
    if (k2 > maxDen) break;
    h0 = h1;
    h1 = h2;
    k0 = k1;
    k1 = k2;
    const approx = Number(h1) / Number(k1);
    if (Math.abs(approx - Math.abs(v)) <= tol * Math.max(1, Math.abs(v))) {
      const g = bigGcd(h1 < 0n ? -h1 : h1, k1);
      return { n: (neg ? -h1 : h1) / g, d: k1 / g };
    }
    const frac = x - a;
    if (frac < 1e-15) break;
    x = 1 / frac;
  }
  return null;
}

/** Integer square root exposed for surd simplification. */
export function isqrtBig(v: bigint): bigint {
  return bigIsqrt(v);
}
