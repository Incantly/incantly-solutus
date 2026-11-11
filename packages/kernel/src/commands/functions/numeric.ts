/**
 * Numeric methods of the functions area: root bracketing and polishing, finite
 * differences, adaptive quadrature, polynomial helpers and series extrapolation.
 *
 * All equality decisions use the tolerance the caller passes (the rule's shared
 * `call.tol`, scaled); machine-epsilon floors only stop iteration. Budgets count
 * evaluations through `RuleWork`, never time, so results are deterministic.
 */
import type { RuleWork } from '../../graph/registry';
import type { Fn1, Fn2 } from './sample';

const EPS = Number.EPSILON;

/* ------------------------------ Brent's method ------------------------------ */

/**
 * Refines a bracket `[a, b]` with `f(a) f(b) <= 0` to a root. Returns NaN when the
 * budget is spent or the bracket is unusable. Deterministic.
 */
export function brent(f: Fn1, a: number, b: number, work: RuleWork): number {
  let fa = f(a);
  let fb = f(b);
  if (!(fa <= 0 && fb >= 0) && !(fa >= 0 && fb <= 0)) return Number.NaN;
  if (fa === 0) return a;
  if (fb === 0) return b;
  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  for (let iter = 0; iter < 100; iter++) {
    if (!work.spend(1)) return Number.NaN;
    if ((fb > 0 && fc > 0) || (fb < 0 && fc < 0)) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    const xtol = 4 * EPS * Math.max(1, Math.abs(b));
    const m = 0.5 * (c - b);
    if (Math.abs(m) <= xtol || fb === 0) return b;
    if (Math.abs(e) >= xtol && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = 2 * m * s;
        q = 1 - s;
      } else {
        const r = fb / fc;
        const t = fa / fc;
        p = s * (2 * m * t * (t - r) - (b - a) * (r - 1));
        q = (t - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      p = Math.abs(p);
      const accept = 3 * m * q - Math.abs(xtol * q) > 0 && p < Math.abs(0.5 * e * q);
      e = d;
      d = accept && q !== 0 ? p / q : m;
    } else {
      d = m;
      e = m;
    }
    a = b;
    fa = fb;
    const step = Math.abs(d) > xtol ? d : m > 0 ? xtol : -xtol;
    b += step;
    fb = f(b);
    if (fb !== fb) return Number.NaN;
  }
  return b;
}

/** Damped Newton from `x0` with a numeric derivative; NaN when it does not settle. */
export function newton(f: Fn1, x0: number, work: RuleWork, tol: number): number {
  let x = x0;
  let fx = f(x);
  if (fx !== fx) return Number.NaN;
  for (let i = 0; i < 40; i++) {
    if (!work.spend(3)) return Number.NaN;
    const h = 6e-6 * Math.max(1, Math.abs(x));
    const d = (f(x + h) - f(x - h)) / (2 * h);
    if (d !== d || d === 0) return Number.NaN;
    let step = fx / d;
    const maxStep = 4 * Math.max(1, Math.abs(x));
    if (Math.abs(step) > maxStep) step = step > 0 ? maxStep : -maxStep;
    x -= step;
    fx = f(x);
    if (fx !== fx) return Number.NaN;
    if (Math.abs(step) <= tol * Math.max(1, Math.abs(x)) && Math.abs(fx) <= tol * Math.max(1, Math.abs(x))) return x;
  }
  return Number.NaN;
}

/** Golden-section minimum of `|f|` on `[a, b]`; NaN when the budget is spent. */
export function goldenAbs(f: Fn1, a: number, b: number, work: RuleWork, tol: number): number {
  const gr = 0.6180339887498949;
  let lo = a;
  let hi = b;
  let c = hi - gr * (hi - lo);
  let d = lo + gr * (hi - lo);
  let fc = Math.abs(f(c));
  let fd = Math.abs(f(d));
  for (let i = 0; i < 80; i++) {
    if (!work.spend(2)) return Number.NaN;
    if (fc !== fc || fd !== fd) return Number.NaN;
    if (fc < fd) {
      hi = d;
      d = c;
      fd = fc;
      c = hi - gr * (hi - lo);
      fc = Math.abs(f(c));
    } else {
      lo = c;
      c = d;
      fc = fd;
      d = lo + gr * (hi - lo);
      fd = Math.abs(f(d));
    }
    if (hi - lo <= tol * Math.max(1, Math.abs(lo), Math.abs(hi))) return (lo + hi) / 2;
  }
  return (lo + hi) / 2;
}

/** Golden-section minimum of `f` on `[a, b]`; NaN when the budget is spent or `f` fails. */
export function goldenMin(f: Fn1, a: number, b: number, work: RuleWork, tol: number): number {
  const gr = 0.6180339887498949;
  let lo = a;
  let hi = b;
  let c = hi - gr * (hi - lo);
  let d = lo + gr * (hi - lo);
  let fc = f(c);
  let fd = f(d);
  for (let i = 0; i < 80; i++) {
    if (!work.spend(2)) return Number.NaN;
    if (fc !== fc || fd !== fd) return Number.NaN;
    if (fc < fd) {
      hi = d;
      d = c;
      fd = fc;
      c = hi - gr * (hi - lo);
      fc = f(c);
    } else {
      lo = c;
      c = d;
      fc = fd;
      d = lo + gr * (hi - lo);
      fd = f(d);
    }
    if (hi - lo <= tol * Math.max(1, Math.abs(lo), Math.abs(hi))) return (lo + hi) / 2;
  }
  return (lo + hi) / 2;
}

/* ------------------------------ bracket scans ------------------------------ */

export interface ScanResult {
  /** Brackets with a sign change, each holding at least one root. */
  readonly brackets: readonly (readonly [number, number])[];
  /** Parameters of local minima of |f| near zero (touching or multiple roots). */
  readonly touches: readonly number[];
  /** Largest |f| seen, for relative decisions. */
  readonly scale: number;
  /** True when some samples were undefined (gaps or poles in the interval). */
  readonly sawUndefined: boolean;
  /** True when the function looks identically zero on the interval. */
  readonly identicalZero: boolean;
  /** True when the budget ran out before the scan finished. */
  readonly spent: boolean;
}

/**
 * Scans `[a, b]` with `samples + 1` points for sign changes and near-zero minima of
 * |f|. Deterministic: fixed sample count, no view, no clock.
 */
export function scanBrackets(f: Fn1, a: number, b: number, samples: number, tol: number, work: RuleWork): ScanResult {
  const brackets: [number, number][] = [];
  const touches: number[] = [];
  const n = Math.max(8, Math.min(8192, Math.floor(samples)));
  const h = (b - a) / n;
  let prevX = a;
  let prevV = f(a);
  if (!work.spend(1)) return { brackets, touches, scale: 0, sawUndefined: false, identicalZero: false, spent: true };
  let sawUndefined = prevV !== prevV;
  let scale = prevV === prevV ? Math.abs(prevV) : 0;
  let prevPrevV = Number.NaN;
  let prevPrevX = Number.NaN;
  let allZero = prevV === prevV && prevV === 0;
  for (let i = 1; i <= n; i++) {
    if (!work.spend(1)) return { brackets, touches, scale, sawUndefined, identicalZero: false, spent: true };
    const x = i === n ? b : a + i * h;
    const v = f(x);
    if (v !== v) {
      sawUndefined = true;
      prevPrevV = prevV;
      prevPrevX = prevX;
      prevX = x;
      prevV = v;
      continue;
    }
    if (Math.abs(v) > scale) scale = Math.abs(v);
    if (v !== 0) allZero = false;
    if (prevV === prevV) {
      if ((prevV < 0 && v > 0) || (prevV > 0 && v < 0)) brackets.push([prevX, x]);
      else if (prevV === 0 && v !== 0) brackets.push([prevX, prevX]);
      // interior local minimum of |f|: a possible touching root
      if (prevPrevV === prevPrevV) {
        const a0 = Math.abs(prevPrevV);
        const a1 = Math.abs(prevV);
        const a2 = Math.abs(v);
        if (a1 <= a0 && a1 <= a2 && a1 <= tol * Math.max(1, scale)) touches.push(prevX);
      }
    }
    prevPrevV = prevV;
    prevPrevX = prevX;
    prevX = x;
    prevV = v;
  }
  void prevPrevX;
  const identicalZero = allZero || (scale <= tol && !sawUndefined);
  return { brackets, touches, scale, sawUndefined, identicalZero, spent: false };
}

export interface RootsResult {
  readonly roots: readonly number[];
  /** True when the scan met undefined samples (poles or gaps): brackets across them were skipped. */
  readonly sawUndefined: boolean;
  /** True when the budget ran out: the list may miss roots. */
  readonly spent: boolean;
}

/**
 * Every root of `f` on `[a, b]`: sign changes polished with Brent, touching roots
 * polished with golden-section plus Newton. Roots are verified (`|f|` small) so poles
 * that Brent lands on are rejected. Sorted and deduplicated.
 */
export function findRoots(f: Fn1, a: number, b: number, tol: number, work: RuleWork, samples = 512): RootsResult {
  const scan = scanBrackets(f, a, b, samples, tol, work);
  if (scan.spent) return { roots: [], sawUndefined: scan.sawUndefined, spent: true };
  const scale = Math.max(1, scan.scale);
  const out: number[] = [];
  for (const [lo, hi] of scan.brackets) {
    if (!work.spend(2)) return { roots: dedup(out, tol), sawUndefined: scan.sawUndefined, spent: true };
    const r = lo === hi ? lo : brent(f, lo, hi, work);
    if (r !== r || r < Math.min(a, b) - tol * scale || r > Math.max(a, b) + tol * scale) continue;
    const v = f(r);
    if (!work.spend(1)) return { roots: dedup(out, tol), sawUndefined: scan.sawUndefined, spent: true };
    if (v === v && Math.abs(v) <= Math.sqrt(tol) * scale) out.push(r);
  }
  // Cluster touches closer than a few scan spacings (one touch, several samples); keep the deepest.
  const spacing = (b - a) / samples;
  const sorted = [...scan.touches].sort((p, q) => p - q);
  const clustered: number[] = [];
  let ci = 0;
  while (ci < sorted.length) {
    let cj = ci;
    let best = sorted[ci] as number;
    let bestV = Infinity;
    while (cj < sorted.length && (sorted[cj] as number) - (sorted[ci] as number) <= 2.5 * spacing) {
      const v = Math.abs(f(sorted[cj] as number));
      if (!work.spend(1)) return { roots: dedup(out, tol), sawUndefined: scan.sawUndefined, spent: true };
      if (v === v && v < bestV) {
        bestV = v;
        best = sorted[cj] as number;
      }
      cj++;
    }
    clustered.push(best);
    ci = cj;
  }
  for (const t of clustered) {
    // Skip touches already covered by an accepted bracket root (micro sign changes at a touch).
    if (out.some((r) => Math.abs(r - t) <= 2.5 * spacing)) continue;
    const w = Math.max(tol * Math.max(1, Math.abs(t)), (b - a) / samples);
    const m = goldenAbs(f, Math.max(a, t - w), Math.min(b, t + w), work, tol);
    if (m !== m) continue;
    const r = newton(f, m, work, tol);
    const at = r === r ? r : m;
    const v = f(at);
    if (!work.spend(1)) return { roots: dedup(out, tol), sawUndefined: scan.sawUndefined, spent: true };
    if (v === v && Math.abs(v) <= Math.sqrt(tol) * scale) out.push(at);
  }
  return { roots: dedup(out, tol), sawUndefined: scan.sawUndefined, spent: false };
}

/** Sorts and merges values closer than `tol * max(1, |x|)`. */
export function dedup(xs: readonly number[], tol: number): number[] {
  const s = [...xs].filter((x) => x === x).sort((p, q) => p - q);
  const out: number[] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last === undefined || Math.abs(x - last) > tol * Math.max(1, Math.abs(x), Math.abs(last))) out.push(x);
  }
  return out;
}

/* ------------------------------ finite differences ------------------------------ */

/** First derivative by central differences. NaN when either side is undefined. */
export function diff1(f: Fn1, x: number): number {
  const h = 6e-6 * Math.max(1, Math.abs(x));
  const a = f(x + h);
  const b = f(x - h);
  return a === a && b === b ? (a - b) / (2 * h) : Number.NaN;
}

/** Second derivative by central differences. NaN when any sample is undefined. */
export function diff2(f: Fn1, x: number): number {
  const h = 1.2e-4 * Math.max(1, Math.abs(x));
  const a = f(x + h);
  const c = f(x);
  const b = f(x - h);
  return a === a && b === b && c === c ? (a - 2 * c + b) / (h * h) : Number.NaN;
}

/** Third derivative (5-point stencil). NaN when any sample is undefined. */
export function diff3(f: Fn1, x: number): number {
  const h = 7e-4 * Math.max(1, Math.abs(x));
  const a = f(x + 2 * h);
  const b = f(x + h);
  const c = f(x - h);
  const d = f(x - 2 * h);
  return a === a && b === b && c === c && d === d ? (a - 2 * b + 2 * c - d) / (2 * h * h * h) : Number.NaN;
}

/** Fourth derivative (5-point stencil). NaN when any sample is undefined. */
export function diff4(f: Fn1, x: number): number {
  const h = 2e-3 * Math.max(1, Math.abs(x));
  const a = f(x + 2 * h);
  const b = f(x + h);
  const c = f(x);
  const d = f(x - h);
  const e = f(x - 2 * h);
  return a === a && b === b && c === c && d === d && e === e
    ? (a - 4 * b + 6 * c - 4 * d + e) / (h * h * h * h)
    : Number.NaN;
}

/** Partial derivative of `f` in `v` (0 for x, 1 for y) by central differences. */
export function partial1(f: Fn2, x: number, y: number, v: 0 | 1): number {
  const t = v === 0 ? x : y;
  const h = 6e-6 * Math.max(1, Math.abs(t));
  const a = v === 0 ? f(x + h, y) : f(x, y + h);
  const b = v === 0 ? f(x - h, y) : f(x, y - h);
  return a === a && b === b ? (a - b) / (2 * h) : Number.NaN;
}

/** Gradient of `f` at `(x, y)`; NaN entries where a side is undefined. */
export function gradient2(f: Fn2, x: number, y: number): readonly [number, number] {
  return [partial1(f, x, y, 0), partial1(f, x, y, 1)];
}

/** Hessian entries `[fxx, fxy, fyy]` of `f` at `(x, y)` by central differences. */
export function hessian2(f: Fn2, x: number, y: number): readonly [number, number, number] {
  const hx = 1.2e-4 * Math.max(1, Math.abs(x));
  const hy = 1.2e-4 * Math.max(1, Math.abs(y));
  const c = f(x, y);
  const xp = f(x + hx, y);
  const xm = f(x - hx, y);
  const yp = f(x, y + hy);
  const ym = f(x, y - hy);
  const pp = f(x + hx, y + hy);
  const pm = f(x + hx, y - hy);
  const mp = f(x - hx, y + hy);
  const mm = f(x - hx, y - hy);
  const ok = (v: number): boolean => v === v;
  const fxx = ok(xp) && ok(xm) && ok(c) ? (xp - 2 * c + xm) / (hx * hx) : Number.NaN;
  const fyy = ok(yp) && ok(ym) && ok(c) ? (yp - 2 * c + ym) / (hy * hy) : Number.NaN;
  const fxy = ok(pp) && ok(pm) && ok(mp) && ok(mm) ? (pp - pm - mp + mm) / (4 * hx * hy) : Number.NaN;
  return [fxx, fxy, fyy];
}

/* ------------------------------ quadrature ------------------------------ */

export interface QuadOptions {
  readonly tolAbs: number;
  readonly tolRel: number;
  readonly maxDepth: number;
  readonly work: RuleWork;
}

export interface QuadResult {
  /** Best estimate of the integral. */
  readonly value: number;
  /** Estimated absolute error. */
  readonly error: number;
  /** True when the error is within tolerance and no singularity was found. */
  readonly ok: boolean;
  /** Set when the integral looks divergent near this x. */
  readonly divergesAt?: number;
  /** True when the work budget ran out: `value` is the best estimate so far. */
  readonly spent: boolean;
}

interface Panel {
  readonly a: number;
  readonly fa: number;
  readonly m: number;
  readonly fm: number;
  readonly b: number;
  readonly fb: number;
  readonly whole: number;
  readonly tol: number;
  readonly depth: number;
}

const badNum = (v: number): boolean => v !== v || v === Infinity || v === -Infinity;

/**
 * Adaptive Simpson quadrature on a finite interval. Non-finite samples force
 * subdivision; panels still non-finite at `maxDepth` become singularity candidates
 * decided by a power fit (`|f| ~ C|x - x0|^-p`: `p >= 1` diverges, `p < 1` is
 * integrable with an endpoint correction). Deterministic: panels are processed
 * depth-first in fixed order and every evaluation counts against `work`.
 */
export function quadFinite(f: Fn1, a: number, b: number, o: QuadOptions): QuadResult {
  const fa = f(a);
  const fb = f(b);
  const m0 = 0.5 * (a + b);
  const fm0 = f(m0);
  if (!o.work.spend(3)) return { value: Number.NaN, error: Number.NaN, ok: false, spent: true };
  const whole0 = ((b - a) / 6) * (numOr0(fa) + 4 * numOr0(fm0) + numOr0(fb));
  const tol0 = Math.max(o.tolAbs, o.tolRel * Math.abs(whole0));
  const stack: Panel[] = [{ a, fa, m: m0, fm: fm0, b, fb, whole: whole0, tol: tol0, depth: 0 }];
  let value = 0;
  let error = 0;
  const singular: number[] = [];
  while (stack.length > 0) {
    const p = stack.pop() as Panel;
    const hasBad = badNum(p.fa) || badNum(p.fm) || badNum(p.fb);
    if (hasBad && p.depth >= o.maxDepth) {
      singular.push(badNum(p.fm) ? p.m : badNum(p.fa) ? p.a : p.b);
      continue;
    }
    const lm = 0.5 * (p.a + p.m);
    const rm = 0.5 * (p.m + p.b);
    const flm = f(lm);
    const frm = f(rm);
    if (!o.work.spend(2)) return { value: value + p.whole, error: Number.NaN, ok: false, spent: true };
    const w = p.b - p.a;
    const left = (w / 12) * (numOr0(p.fa) + 4 * numOr0(flm) + numOr0(p.fm));
    const right = (w / 12) * (numOr0(p.fm) + 4 * numOr0(frm) + numOr0(p.fb));
    const refined = left + right;
    const err = Math.abs(refined - p.whole) / 15;
    if (hasBad || err > p.tol) {
      if (p.depth >= o.maxDepth) {
        if (hasBad) singular.push(badNum(flm) ? lm : badNum(frm) ? rm : p.m);
        value += refined;
        error += err;
        continue;
      }
      const half = p.tol / 2;
      stack.push({ a: p.m, fa: p.fm, m: rm, fm: frm, b: p.b, fb: p.fb, whole: right, tol: half, depth: p.depth + 1 });
      stack.push({ a: p.a, fa: p.fa, m: lm, fm: flm, b: p.m, fb: p.fm, whole: left, tol: half, depth: p.depth + 1 });
      continue;
    }
    value += refined + (refined - p.whole) / 15;
  }
  if (singular.length === 0) {
    const ok = error <= Math.max(o.tolAbs, o.tolRel * Math.abs(value)) || error !== error;
    return { value, error, ok, spent: false };
  }
  // Decide each singularity by a power fit; collect endpoint corrections.
  let correction = 0;
  for (const x0 of dedup(singular, 1e-9)) {
    const fit = powerFit(f, x0, a, b, o.work);
    if (fit.spent) return { value, error: Number.NaN, ok: false, spent: true };
    if (fit.diverges) return { value: Number.NaN, error: Number.NaN, ok: false, divergesAt: x0, spent: false };
    correction += fit.correction;
  }
  return { value: value + correction, error, ok: true, spent: false };
}

function numOr0(v: number): number {
  return v === v && v !== Infinity && v !== -Infinity ? v : 0;
}

interface PowerFit {
  readonly diverges: boolean;
  /** Estimated missing contribution of the singular point (endpoint correction). */
  readonly correction: number;
  readonly spent: boolean;
}

/**
 * Fits `|f| ~ C|x - x0|^-p` from two probes on the side inside `[a, b]`.
 * `p >= 1` (or unbounded oscillation-free growth) diverges; `p < 1` integrates to
 * `C w^(1-p)/(1-p)` over the unresolved width `w`, which is the correction.
 */
function powerFit(f: Fn1, x0: number, a: number, b: number, work: RuleWork): PowerFit {
  const span = Math.max(b - a, 1e-300);
  const sides: number[] = [];
  if (x0 - a > span * 1e-12) sides.push(-1);
  if (b - x0 > span * 1e-12) sides.push(1);
  for (const s of sides) {
    const d1 = span * 1e-4;
    const d2 = span * 1e-7;
    const r1 = f(x0 + s * d1);
    const r2 = f(x0 + s * d2);
    if (!work.spend(2)) return { diverges: false, correction: 0, spent: true };
    const v1 = Math.abs(r1);
    const v2 = Math.abs(r2);
    if (v1 !== v1 || v2 !== v2) continue;
    if (v2 <= Math.max(1, v1) * 4) return { diverges: false, correction: 0, spent: false };
    const p = Math.log(v2 / Math.max(v1, 1e-300)) / Math.log(d1 / d2);
    if (p >= 1) return { diverges: true, correction: 0, spent: false };
    if (p >= 0) {
      const w = span * 1e-6;
      const c = v2 * Math.pow(d2, p);
      const sign = r2 > 0 ? 1 : r2 < 0 ? -1 : 0;
      return { diverges: false, correction: (sign * c * Math.pow(w, 1 - p)) / (1 - p), spent: false };
    }
    return { diverges: false, correction: 0, spent: false };
  }
  return { diverges: true, correction: 0, spent: false };
}

/**
 * Definite integral on any interval, including infinite bounds (by the transform
 * `x = a + t/(1-t)`). `a > b` negates the swapped value; `a == b` is 0.
 */
export function quad(f: Fn1, a: number, b: number, o: QuadOptions): QuadResult {
  if (a === b) return { value: 0, error: 0, ok: true, spent: false };
  if (a > b) {
    const r = quad(f, b, a, o);
    return { ...r, value: -r.value };
  }
  const aInf = a === -Infinity;
  const bInf = b === Infinity;
  if (!aInf && !bInf) return quadFinite(f, a, b, o);
  const tail = (edge: number, dir: 1 | -1): Fn1 => (t: number): number => {
    if (t >= 1) return Number.NaN;
    const u = 1 - t;
    const x = edge + dir * (t / u);
    const v = f(x);
    return v === v ? v / (u * u) : Number.NaN;
  };
  if (aInf && bInf) {
    const left = quadFinite(tail(0, -1), 0, 1, o);
    if (left.spent || left.divergesAt !== undefined) return mapTail(left, 0, -1);
    const right = quadFinite(tail(0, 1), 0, 1, o);
    if (right.spent || right.divergesAt !== undefined) return mapTail(right, 0, 1);
    return { value: left.value + right.value, error: left.error + right.error, ok: left.ok && right.ok, spent: false };
  }
  if (aInf) return mapTail(quadFinite(tail(b, -1), 0, 1, o), b, -1);
  return mapTail(quadFinite(tail(a, 1), 0, 1, o), a, 1);
}

/** Maps a tail-quadrature result back to x-space (a divergence at t = 1 is at infinity). */
function mapTail(r: QuadResult, edge: number, dir: 1 | -1): QuadResult {
  if (r.divergesAt === undefined) return r;
  const t = r.divergesAt;
  const at = t >= 1 - 1e-9 ? (dir === 1 ? Infinity : -Infinity) : edge + dir * (t / (1 - t));
  return { ...r, divergesAt: at };
}

/* ------------------------------ linear algebra ------------------------------ */

/**
 * Solves `A x = b` by Gaussian elimination with partial pivoting. `A` is row-major
 * `n x n`. Returns null when the matrix is singular (pivot below `tol * scale`).
 * Deterministic.
 */
export function gaussSolve(a: Float64Array, b: Float64Array, n: number, tol: number): Float64Array | null {
  const m = Float64Array.from(a);
  const x = Float64Array.from(b);
  let scale = 0;
  for (let i = 0; i < n * n; i++) {
    const v = Math.abs(m[i] as number);
    if (v > scale) scale = v;
  }
  const floor = tol * Math.max(scale, 1e-300);
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = Math.abs(m[col * n + col] as number);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(m[row * n + col] as number);
      if (v > best) {
        best = v;
        piv = row;
      }
    }
    if (!(best > floor)) return null;
    if (piv !== col) {
      for (let k = col; k < n; k++) {
        const t = m[col * n + k] as number;
        m[col * n + k] = m[piv * n + k] as number;
        m[piv * n + k] = t;
      }
      const t = x[col] as number;
      x[col] = x[piv] as number;
      x[piv] = t;
    }
    const inv = 1 / (m[col * n + col] as number);
    for (let row = col + 1; row < n; row++) {
      const f = (m[row * n + col] as number) * inv;
      if (f === 0) continue;
      for (let k = col; k < n; k++) m[row * n + k] = (m[row * n + k] as number) - f * (m[col * n + k] as number);
      x[row] = (x[row] as number) - f * (x[col] as number);
    }
  }
  const out = new Float64Array(n);
  for (let row = n - 1; row >= 0; row--) {
    let s = x[row] as number;
    for (let k = row + 1; k < n; k++) s -= (m[row * n + k] as number) * (out[k] as number);
    out[row] = s / (m[row * n + row] as number);
  }
  return out;
}

/**
 * One-dimensional nullspace of a rectangular matrix by Gauss-Jordan with partial
 * pivoting. Returns the null vector only when the nullity is exactly 1; `freeCount`
 * tells the other cases apart. Deterministic.
 */
export function nullspaceRect(a: Float64Array, rows: number, cols: number, tol: number): { readonly vec: Float64Array | null; readonly freeCount: number } {
  let amax = 0;
  for (let i = 0; i < rows * cols; i++) {
    const v = Math.abs(a[i] as number);
    if (v > amax) amax = v;
  }
  if (!(amax > 0)) return { vec: null, freeCount: cols };
  const floor = tol * amax;
  const m = Float64Array.from(a);
  const where = new Array<number>(cols).fill(-1);
  let row = 0;
  for (let col = 0; col < cols && row < rows; col++) {
    let sel = -1;
    let best = floor;
    for (let i = row; i < rows; i++) {
      const v = Math.abs(m[i * cols + col] as number);
      if (v > best) {
        best = v;
        sel = i;
      }
    }
    if (sel === -1) continue;
    for (let j = col; j < cols; j++) {
      const t = m[sel * cols + j] as number;
      m[sel * cols + j] = m[row * cols + j] as number;
      m[row * cols + j] = t;
    }
    where[col] = row;
    const inv = 1 / (m[row * cols + col] as number);
    for (let j = col; j < cols; j++) m[row * cols + j] = (m[row * cols + j] as number) * inv;
    for (let i = 0; i < rows; i++) {
      if (i === row) continue;
      const f = m[i * cols + col] as number;
      if (f === 0) continue;
      for (let j = col; j < cols; j++) m[i * cols + j] = (m[i * cols + j] as number) - f * (m[row * cols + j] as number);
    }
    row++;
  }
  const free: number[] = [];
  for (let col = 0; col < cols; col++) if (where[col] === -1) free.push(col);
  if (free.length !== 1) return { vec: null, freeCount: free.length };
  const vec = new Float64Array(cols);
  vec[free[0] as number] = 1;
  for (let col = 0; col < cols; col++) {
    const r = where[col] as number;
    if (r !== -1) vec[col] = -(m[r * cols + (free[0] as number)] as number);
  }
  return { vec, freeCount: 1 };
}

/** Least-squares solution of `A x ~= b` (`rows x cols`) by normal equations. Null when singular. */
export function leastSquares(a: Float64Array, b: Float64Array, rows: number, cols: number, tol: number): Float64Array | null {
  const ata = new Float64Array(cols * cols);
  const atb = new Float64Array(cols);
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < cols; i++) {
      const ai = a[r * cols + i] as number;
      atb[i] = (atb[i] as number) + ai * (b[r] as number);
      for (let j = i; j < cols; j++) ata[i * cols + j] = (ata[i * cols + j] as number) + ai * (a[r * cols + j] as number);
    }
  }
  for (let i = 0; i < cols; i++) for (let j = 0; j < i; j++) ata[i * cols + j] = ata[j * cols + i] as number;
  return gaussSolve(ata, atb, cols, tol);
}

/* ------------------------------ polynomials ------------------------------ */

/** Chebyshev nodes on `[a, b]`, endpoint-inclusive order shuffled deterministically. */
export function chebyshevNodes(n: number, a: number, b: number): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = 0.5 * (a + b) + 0.5 * (b - a) * Math.cos((Math.PI * (2 * i + 1)) / (2 * n));
  return out;
}

/** Evaluates `c[0] + c[1] t + ...` by Horner's rule. */
export function polyEval(c: Float64Array | readonly number[], t: number): number {
  let v = 0;
  for (let i = c.length - 1; i >= 0; i--) v = v * t + (c[i] as number);
  return v;
}

/** Coefficients of the derivative of `c` (index k is the coefficient of x^k). */
export function polyDeriv(c: readonly number[]): number[] {
  const out: number[] = [];
  for (let k = 1; k < c.length; k++) out.push(k * (c[k] as number));
  return out;
}

/** Cauchy bound: every root of `c` has |x| below it. Infinity when leading is 0. */
export function cauchyBound(c: readonly number[]): number {
  const n = c.length - 1;
  const lead = Math.abs(c[n] as number);
  if (!(lead > 0)) return Infinity;
  let m = 0;
  for (let k = 0; k < n; k++) {
    const v = Math.abs(c[k] as number) / lead;
    if (v > m) m = v;
  }
  return 1 + m;
}

/** Highest degree this area detects or fits from samples (docs use exact trees; we interpolate). */
export const MAX_POLY_DEGREE = 20;

export interface PolyDetect {
  /** Degree, or null when no polynomial of degree <= 20 fits. */
  readonly degree: number | null;
  /** Coefficients (index k is x^k) when a degree was found. */
  readonly coeffs: readonly number[] | null;
  readonly spent: boolean;
}

/**
 * Detects whether `f` is a polynomial of degree <= 20 near `center`: for each degree
 * d, fits a Chebyshev series (well-conditioned) and checks the residual both inside
 * and on a five-times-wider interval (a local fit of sin or exp diverges there,
 * while a true polynomial fits everywhere). Power coefficients are recovered only
 * for the accepted degree. Deterministic; every evaluation counts against `work`.
 */
export function detectPolynomial(f: Fn1, center: number, tol: number, work: RuleWork): PolyDetect {
  const radius = Math.max(1, Math.abs(center));
  const a = center - radius;
  const b = center + radius;
  for (let d = 0; d <= MAX_POLY_DEGREE; d++) {
    const m = 2 * d + 1;
    const nodes = chebyshevNodes(m, a, b);
    const vam = new Float64Array(m * (d + 1));
    const ys = new Float64Array(m);
    let scale = 0;
    for (let i = 0; i < m; i++) {
      if (!work.spend(1)) return { degree: null, coeffs: null, spent: true };
      const x = nodes[i] as number;
      const v = f(x);
      if (v !== v) return { degree: null, coeffs: null, spent: false };
      ys[i] = v;
      if (Math.abs(v) > scale) scale = Math.abs(v);
      const t = (x - center) / radius;
      vam[i * (d + 1)] = 1;
      if (d >= 1) vam[i * (d + 1) + 1] = t;
      for (let k = 2; k <= d; k++) vam[i * (d + 1) + k] = 2 * t * (vam[i * (d + 1) + k - 1] as number) - (vam[i * (d + 1) + k - 2] as number);
    }
    const cc = leastSquares(vam, ys, m, d + 1, tol);
    if (!cc) continue;
    const chebEval = (x: number): number => {
      const t = (x - center) / radius;
      let t0 = 1;
      let t1 = t;
      let s = (cc[0] as number) * t0;
      if (d >= 1) s += (cc[1] as number) * t1;
      for (let k = 2; k <= d; k++) {
        const t2 = 2 * t * t1 - t0;
        s += (cc[k] as number) * t2;
        t0 = t1;
        t1 = t2;
      }
      return s;
    };
    // residual on the fit nodes, then on the wider interval
    let worst = 0;
    for (let i = 0; i < m; i++) {
      const r = Math.abs((ys[i] as number) - chebEval(nodes[i] as number));
      if (r > worst) worst = r;
    }
    if (worst > tol * Math.max(1, scale)) continue;
    const check = chebyshevNodes(d + 2, center - 5 * radius, center + 5 * radius);
    let checkScale = scale;
    let ok = true;
    for (let i = 0; i < d + 2; i++) {
      if (!work.spend(1)) return { degree: null, coeffs: null, spent: true };
      const x = check[i] as number;
      const v = f(x);
      if (v !== v) {
        ok = false;
        break;
      }
      if (Math.abs(v) > checkScale) checkScale = Math.abs(v);
      const r = Math.abs(v - chebEval(x));
      if (r > worst) worst = r;
    }
    if (!ok || worst > tol * Math.max(1, checkScale)) continue;
    // recover power coefficients in t = x - center for the caller
    const pn = chebyshevNodes(d + 1, a, b);
    const pym = new Float64Array((d + 1) * (d + 1));
    const py = new Float64Array(d + 1);
    for (let i = 0; i <= d; i++) {
      const t = (pn[i] as number) - center;
      py[i] = f(pn[i] as number);
      let p = 1;
      for (let k = 0; k <= d; k++) {
        pym[i * (d + 1) + k] = p;
        p *= t;
      }
      if (!work.spend(1)) return { degree: null, coeffs: null, spent: true };
    }
    const c = gaussSolve(pym, py, d + 1, tol);
    if (!c) continue;
    return { degree: trimDegree(c, tol), coeffs: [...c], spent: false };
  }
  return { degree: null, coeffs: null, spent: false };
}

function trimDegree(c: Float64Array, tol: number): number {
  let d = c.length - 1;
  const scale = Math.max(...Array.from(c).map(Math.abs), 1e-300);
  while (d > 0 && Math.abs(c[d] as number) <= tol * scale) d--;
  return d;
}

/** Taylor coefficients `c[k] = f^(k)(a)/k!` by interpolation on `[a - r, a + r]`. Null when the fit is poor. */
export function taylorCoeffs(f: Fn1, a: number, n: number, tol: number, work: RuleWork): { readonly coeffs: Float64Array; readonly residual: number } | null {
  const r = Math.max(0.5, Math.min(2, Math.max(1, Math.abs(a)) / 2));
  const m = 2 * n + 1;
  const nodes = chebyshevNodes(m, a - r, a + r);
  const vam = new Float64Array(m * (n + 1));
  const ys = new Float64Array(m);
  let scale = 0;
  for (let i = 0; i < m; i++) {
    if (!work.spend(1)) return null;
    const x = nodes[i] as number;
    const v = f(x);
    if (v !== v) return null;
    ys[i] = v;
    if (Math.abs(v) > scale) scale = Math.abs(v);
    const t = (x - a) / r;
    let p = 1;
    for (let k = 0; k <= n; k++) {
      vam[i * (n + 1) + k] = p;
      p *= t;
    }
  }
  const c = leastSquares(vam, ys, m, n + 1, tol);
  if (!c) return null;
  let worst = 0;
  for (let i = 0; i < m; i++) {
    const t = ((nodes[i] as number) - a) / r;
    const rsd = Math.abs((ys[i] as number) - polyEval(c, t));
    if (rsd > worst) worst = rsd;
  }
  if (worst > Math.sqrt(tol) * Math.max(1, scale)) return null;
  const out = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) out[k] = (c[k] as number) / Math.pow(r, k);
  return { coeffs: out, residual: worst };
}

/**
 * True when a curvature numerator vanishes within finite-difference rounding:
 * `|num|` below `64 eps` of the noise scale the caller passes. Machine-based, so
 * exact zeros (line pieces) and straight lines both read as straight.
 */
export function kappaStraight(numAbs: number, noiseScale: number): boolean {
  return !(numAbs > 64 * EPS * Math.max(noiseScale, 1e-300));
}

/* ------------------------------ extrapolation ------------------------------ */

/**
 * Wynn's epsilon algorithm on `values`. Returns the extrapolated value when the last
 * three extrapolated values agree within `tol` (relative), else null. Deterministic.
 */
export function wynn(values: readonly number[], tol: number): number | null {
  const n = values.length;
  if (n < 3) return null;
  for (const v of values) if (v !== v || v === Infinity || v === -Infinity) return null;
  let e0 = new Float64Array(n);
  let e1 = new Float64Array(n);
  for (let i = 0; i < n; i++) e1[i] = values[i] as number;
  let best: number | null = null;
  let agree = 0;
  for (let k = 1; k < n; k++) {
    const e2 = new Float64Array(n);
    for (let i = 0; i < n - k; i++) {
      const d = (e1[i + 1] as number) - (e1[i] as number);
      e2[i] = Math.abs(d) < 1e-300 ? 1e300 : (e0[i + 1] as number) + 1 / d;
    }
    if (k % 2 === 0) {
      const cand = e2[n - k - 1] as number;
      if (cand === cand && Math.abs(cand) < 1e300) {
        if (best !== null && Math.abs(cand - best) <= tol * Math.max(1, Math.abs(cand), Math.abs(best))) {
          agree++;
          if (agree >= 2) return cand;
        } else agree = 0;
        best = cand;
      }
    }
    e0 = e1;
    e1 = e2;
  }
  return null;
}
