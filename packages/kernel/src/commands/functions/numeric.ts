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
  /** True when no sample was defined. */
  readonly noData?: boolean;
}

/**
 * Scans `[a, b]` for sign changes and near-zero minima of |f|: a coarse uniform
 * pass (scale, undefined samples, identical zero) plus adaptive subdivision that
 * follows oscillation (dense roots like sin(1/x) near 0) down to a minimum width.
 * Deterministic: fixed counts and depths, every evaluation counted against `work`.
 */
export function scanBrackets(f: Fn1, a: number, b: number, samples: number, tol: number, work: RuleWork): ScanResult {
  const brackets: [number, number][] = [];
  const touches: number[] = [];
  // Coarse pass for scale, undefined samples and the identical-zero test.
  const n = Math.max(8, Math.min(8192, Math.floor(samples)));
  const h = (b - a) / n;
  let sawUndefined = false;
  let scale = 0;
  let allZero = true;
  let definedCount = 0;
  for (let i = 0; i <= n; i++) {
    if (!work.spend(1)) return { brackets, touches, scale, sawUndefined, identicalZero: false, spent: true };
    const v = f(i === n ? b : a + i * h);
    if (v !== v) {
      sawUndefined = true;
      allZero = false;
      continue;
    }
    definedCount++;
    if (Math.abs(v) > scale) scale = Math.abs(v);
    if (v !== 0) allZero = false;
  }
  if (definedCount === 0) return { brackets, touches, scale, sawUndefined, identicalZero: false, spent: false, noData: true };
  const identicalZero = allZero || (scale <= tol && !sawUndefined);
  if (identicalZero) return { brackets, touches, scale, sawUndefined, identicalZero, spent: false };
  // Adaptive subdivision: isolate sign changes and follow oscillation.
  const minW = (b - a) / 16384;
  // Start from the coarse panels, so no oscillation is aliased away by one wide first panel.
  const stack: [number, number, number][] = [];
  for (let i = n - 1; i >= 0; i--) stack.push([a + i * h, i === n - 1 ? b : a + (i + 1) * h, 0]);
  const seen = new Set<string>();
  while (stack.length > 0) {
    const [lo, hi, depth] = stack.pop() as [number, number, number];
    const m = 8;
    const xs: number[] = [];
    const vs: number[] = [];
    for (let i = 0; i <= m; i++) {
      if (!work.spend(1)) return { brackets, touches, scale, sawUndefined, identicalZero, spent: true };
      const x = i === m ? hi : lo + ((hi - lo) * i) / m;
      xs.push(x);
      const v = f(x);
      vs.push(v);
      if (v === v && Math.abs(v) > scale) scale = Math.abs(v);
    }
    const w = hi - lo;
    // A root exactly at the closed right end of the interval belongs to the last panel only.
    if (hi === b && vs[m] === 0) {
      const key = `${hi},${hi}`;
      if (!seen.has(key)) {
        seen.add(key);
        brackets.push([hi, hi]);
      }
    }
    for (let i = 0; i < m; i++) {
      const u = vs[i] as number;
      const v = vs[i + 1] as number;
      const x0 = xs[i] as number;
      const x1 = xs[i + 1] as number;
      if (u !== u || v !== v) {
        if (w / m > minW && depth < 16) stack.push([x0, x1, depth + 1]);
        continue;
      }
      if ((u < 0 && v > 0) || (u > 0 && v < 0)) {
        if (w / m <= minW || depth >= 16) {
          const key = `${x0},${x1}`;
          if (!seen.has(key)) {
            seen.add(key);
            brackets.push([x0, x1]);
          }
        } else stack.push([x0, x1, depth + 1]);
        continue;
      }
      if (u === 0) {
        const key = `${x0},${x0}`;
        if (!seen.has(key)) {
          seen.add(key);
          brackets.push([x0, x0]);
        }
      }
      // Oscillation without a sign change here: subdivide while the midpoint
      // deviates strongly (a hidden wiggle) and width allows.
      if (w / m > minW && depth < 16) {
        const mid = f(0.5 * (x0 + x1));
        if (!work.spend(1)) return { brackets, touches, scale, sawUndefined, identicalZero, spent: true };
        if (mid === mid) {
          const dev = Math.abs(mid - 0.5 * (u + v));
          const local = Math.max(Math.abs(u), Math.abs(v), Math.abs(mid), 1e-300);
          if (dev > 0.25 * local) {
            stack.push([x0, x1, depth + 1]);
            continue;
          }
        }
      }
      // Interior local minimum of |f| among the samples: a possible touching root.
      if (i > 0) {
        const p = vs[i - 1] as number;
        if (p === p) {
          const a0 = Math.abs(p);
          const a1 = Math.abs(u);
          const a2 = Math.abs(v);
          if (a1 <= a0 && a1 <= a2 && a1 <= tol * Math.max(1, scale)) touches.push(x0);
        }
      }
    }
  }
  return { brackets, touches, scale, sawUndefined, identicalZero, spent: false };
}

export interface RootsResult {
  readonly roots: readonly number[];
  /** True when the scan met undefined samples (poles or gaps): brackets across them were skipped. */
  readonly sawUndefined: boolean;
  /** True when the budget ran out: the list may miss roots. */
  readonly spent: boolean;
  /** True when the function looks identically zero on the interval. */
  readonly identicalZero: boolean;
  /** True when the function was undefined at every sample. */
  readonly noData?: boolean;
}

/**
 * Every root of `f` on `[a, b]`: sign changes polished with Brent, touching roots
 * polished with golden-section plus Newton. Roots are verified (`|f|` small) so poles
 * that Brent lands on are rejected. Sorted and deduplicated.
 */
export function findRoots(f: Fn1, a: number, b: number, tol: number, work: RuleWork, samples = 512): RootsResult {
  const scan = scanBrackets(f, a, b, samples, tol, work);
  if (scan.spent) return { roots: [], sawUndefined: scan.sawUndefined, spent: true, identicalZero: false };
  if (scan.noData) return { roots: [], sawUndefined: true, spent: false, identicalZero: false, noData: true };
  if (scan.identicalZero) return { roots: [], sawUndefined: scan.sawUndefined, spent: false, identicalZero: true };
  const scale = Math.max(1, scan.scale);
  const out: number[] = [];
  for (const [lo, hi] of scan.brackets) {
    if (!work.spend(2)) return { roots: dedup(out, tol), sawUndefined: scan.sawUndefined, spent: true, identicalZero: false };
    const r = lo === hi ? lo : brent(f, lo, hi, work);
    if (r !== r || r < Math.min(a, b) - tol * scale || r > Math.max(a, b) + tol * scale) continue;
    const v = f(r);
    if (!work.spend(1)) return { roots: dedup(out, tol), sawUndefined: scan.sawUndefined, spent: true, identicalZero: false };
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
      if (!work.spend(1)) return { roots: dedup(out, tol), sawUndefined: scan.sawUndefined, spent: true, identicalZero: false };
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
    if (!work.spend(1)) return { roots: dedup(out, tol), sawUndefined: scan.sawUndefined, spent: true, identicalZero: false };
    if (v === v && Math.abs(v) <= Math.sqrt(tol) * scale) out.push(at);
  }
  return { roots: dedup(out, tol), sawUndefined: scan.sawUndefined, spent: false, identicalZero: false };
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
  /** True when `f` was undefined at every sample, so there is no integral to report. */
  readonly noData?: boolean;
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
  let defined = (fa === fa ? 1 : 0) + (fm0 === fm0 ? 1 : 0) + (fb === fb ? 1 : 0);
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
    if (flm === flm) defined++;
    if (frm === frm) defined++;
    if (!o.work.spend(2)) return { value: value + p.whole, error: Number.NaN, ok: false, spent: true };
    const w = p.b - p.a;
    const left = (w / 12) * (numOr0(p.fa) + 4 * numOr0(flm) + numOr0(p.fm));
    const right = (w / 12) * (numOr0(p.fm) + 4 * numOr0(frm) + numOr0(p.fb));
    const refined = left + right;
    const err = Math.abs(refined - p.whole) / 15;
    if (hasBad || err > p.tol) {
      if (p.depth >= o.maxDepth) {
        if (hasBad) singular.push(badNum(flm) ? lm : badNum(frm) ? rm : p.m);
        else {
          const jump = jumpPanel(f, p.a, p.b, p.fa, p.fb, p.fm, o.work);
          if (jump === 'spent') return { value: value + p.whole, error: Number.NaN, ok: false, spent: true };
          if (jump !== null) {
            value += jump;
            continue;
          }
        }
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
  if (defined === 0) return { value: Number.NaN, error: Number.NaN, ok: false, spent: false, noData: true };
  if (singular.length === 0) {
    const ok = error <= Math.max(o.tolAbs, o.tolRel * Math.abs(value)) || error !== error;
    return { value, error, ok, spent: false };
  }
  // Decide each singularity by a power fit; collect endpoint corrections.
  let correction = 0;
  const sing = dedup(singular, 1e-9);
  for (const x0 of sing) {
    const fit = powerFit(f, x0, a, b, o.work);
    if (fit.spent) return { value, error: Number.NaN, ok: false, spent: true };
    if (fit.diverges) return { value: Number.NaN, error: Number.NaN, ok: false, divergesAt: x0, spent: false };
    correction += fit.correction;
  }
  // Integrable singularities sit at the ends of the pieces: redo the integral with tanh-sinh on each piece, which
  // resolves algebraic and logarithmic end-point singularities to rounding. The adaptive value is the fallback.
  const cuts = [a, ...sing.filter((x) => x > a && x < b), b];
  let total = 0;
  let tsOk = true;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const piece = tanhSinh(f, cuts[i] as number, cuts[i + 1] as number, o.work);
    if (piece === 'spent') return { value, error: Number.NaN, ok: false, spent: true };
    if (piece === null) {
      tsOk = false;
      break;
    }
    total += piece;
  }
  if (tsOk) return { value: total, error: 0, ok: true, spent: false };
  return { value: value + correction, error, ok: true, spent: false };
}

/**
 * Integral over a panel that holds a jump of `f`: the jump is located by bisecting on the larger difference, then each
 * side is integrated as a trapezoid. Null when the panel holds no jump (the failure is rough, not a step).
 */
function jumpPanel(f: Fn1, a: number, b: number, fa: number, fb: number, fm0: number, work: RuleWork): number | 'spent' | null {
  // cheap test first: at a jump the middle value sits on one side of it
  const gap = Math.abs(fb - fa);
  if (!(gap > 1e-8) || !(gap > 1e-3 * Math.max(Math.abs(fa), Math.abs(fb)))) return null;
  if (!(Math.abs(fm0 - fa) <= 0.05 * gap || Math.abs(fm0 - fb) <= 0.05 * gap)) return null;
  let l = a;
  let r = b;
  let fl = fa;
  let fr = fb;
  for (let i = 0; i < 64; i++) {
    if (!work.spend(1)) return 'spent';
    const m = 0.5 * (l + r);
    if (m <= l || m >= r) break;
    const fm = f(m);
    if (badNum(fm)) return null;
    if (Math.abs(fm - fl) > Math.abs(fr - fm)) {
      r = m;
      fr = fm;
    } else {
      l = m;
      fl = fm;
    }
  }
  const step = Math.abs(fr - fl);
  // a real jump is a visible fraction of the values on either side; a steep smooth part changes by a sliver of 1e-15 width
  if (!(step > 1e-8) || !(step > 1e-3 * Math.max(Math.abs(fl), Math.abs(fr)))) return null;
  const c = 0.5 * (l + r);
  return 0.5 * (fa + fl) * (c - a) + 0.5 * (fr + fb) * (b - c);
}

/**
 * Tanh-sinh quadrature on `[lo, hi]`, which never samples the end points and so integrates end-point singularities
 * `x^-p` (p < 1) and `ln x` to rounding. Points near an end are built from the distance to it, so they keep their
 * precision. Levels double until two agree. Null when it does not settle or a sample inside is undefined; 'spent' when
 * the budget runs out.
 */
function tanhSinh(f: Fn1, lo: number, hi: number, work: RuleWork): number | 'spent' | null {
  const w = hi - lo;
  if (!(w > 0)) return 0;
  const T = 3.6;
  let prev = Number.NaN;
  let h = 1;
  const point = (t: number): number => {
    const u = (Math.PI / 2) * Math.sinh(t);
    const e = Math.exp(-2 * Math.abs(u));
    const near = (w * e) / (1 + e);
    const weight = (w * (Math.PI / 4) * Math.cosh(t) * 4 * e) / ((1 + e) * (1 + e));
    const x = t <= 0 ? lo + near : hi - near;
    if (!(x > lo && x < hi) || !(weight > 0)) return 0;
    const v = f(x);
    return v === v && v !== Infinity && v !== -Infinity ? v * weight : 0;
  };
  let sum = point(0);
  for (let k = 0; k <= 7; k++) {
    for (let t = h; t <= T; t += k === 0 ? h : 2 * h) {
      if (!work.spend(2)) return 'spent';
      sum += point(t) + point(-t);
    }
    const cur = sum * h;
    if (k >= 3 && Math.abs(cur - prev) <= 1e-13 * Math.max(1, Math.abs(cur))) return cur;
    if (k === 7 && Math.abs(cur - prev) <= 1e-9 * Math.max(1, Math.abs(cur))) return cur;
    prev = cur;
    h /= 2;
  }
  return null;
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

export interface RationalFit {
  /** Numerator coefficients in x (index k is x^k). */
  readonly num: readonly number[];
  /** Denominator coefficients in x, monic. */
  readonly den: readonly number[];
}

/** Highest total degree of numerator plus denominator that `detectRational` tries. */
export const MAX_RATIONAL_DEGREE = 12;

/**
 * Detects a rational function `P / Q` in lowest terms (total degree up to 12) from samples: for each pair of degrees,
 * the vector `(P, -Q)` is the nullspace of the linear system `P(x) - f(x) Q(x) = 0` at sample points, then the fit is
 * checked on fresh points out to two and a half times the fitting radius. The first pair with a one-dimensional
 * nullspace is the reduced form. `Q` is made monic. Null when no such pair exists. Deterministic.
 */
export function detectRational(f: Fn1, work: RuleWork): RationalFit | null {
  const R = 2;
  const M = 48;
  const xs = new Float64Array(M);
  const ys = new Float64Array(M);
  for (let i = 0; i < M; i++) {
    if (!work.spend(1)) return null;
    // Chebyshev-spaced points nudged off simple values, so a pole or hole at a nice number is not sampled.
    const x = R * Math.cos((Math.PI * (i + 0.5)) / M) * (1 + 1e-3 * Math.sin(7 * i + 1));
    xs[i] = x;
    ys[i] = f(x);
  }
  const ok: number[] = [];
  for (let i = 0; i < M; i++) if ((ys[i] as number) === (ys[i] as number) && Math.abs(ys[i] as number) < 1e150) ok.push(i);
  if (ok.length < 20) return null;
  const checks: number[] = [];
  for (let i = 0; i < 16; i++) checks.push(2.5 * R * Math.cos((Math.PI * (i + 0.5)) / 16) * (1 + 3e-3 * Math.cos(5 * i + 2)));
  for (let total = 1; total <= MAX_RATIONAL_DEGREE; total++) {
    for (let dd = 0; dd <= total; dd++) {
      const dn = total - dd;
      const cols = dn + dd + 2;
      const want = Math.min(ok.length, cols + 8);
      const rowIdx: number[] = [];
      for (let r = 0; r < want; r++) rowIdx.push(ok[Math.floor((r * ok.length) / want)] as number);
      if (rowIdx.length < cols + 2) continue;
      const a = new Float64Array(rowIdx.length * cols);
      rowIdx.forEach((i, r) => {
        const t = (xs[i] as number) / R;
        const y = ys[i] as number;
        const scale = 1 / Math.max(1, Math.abs(y));
        let pw = 1;
        for (let k = 0; k <= Math.max(dn, dd); k++) {
          if (k <= dn) a[r * cols + k] = pw * scale;
          if (k <= dd) a[r * cols + dn + 1 + k] = -y * pw * scale;
          pw *= t;
        }
      });
      const ns = nullspaceRect(a, rowIdx.length, cols, 1e-9);
      if (!ns.vec) continue;
      const v = ns.vec;
      const pT = Array.from(v.slice(0, dn + 1));
      const qT = Array.from(v.slice(dn + 1));
      // degree of Q (top non-negligible coefficient)
      let qd = dd;
      const qmax = Math.max(...qT.map(Math.abs));
      while (qd > 0 && Math.abs(qT[qd] as number) <= 1e-9 * qmax) qd--;
      if (qd < 1) continue;
      const evalT = (c: readonly number[], x: number): number => polyEval(c, x / R);
      let good = true;
      for (const x of checks) {
        if (!work.spend(1)) return null;
        const y = f(x);
        if (y !== y) continue;
        const q = evalT(qT, x);
        const pv = evalT(pT, x);
        if (Math.abs(pv - y * q) > 1e-7 * Math.max(1, Math.abs(y)) * Math.max(Math.abs(q), 1e-3)) {
          good = false;
          break;
        }
      }
      if (!good) continue;
      const lead = (qT[qd] as number) / Math.pow(R, qd);
      const toX = (c: readonly number[], d: number): number[] => {
        const out: number[] = [];
        for (let k = 0; k <= d; k++) out.push((c[k] as number) / Math.pow(R, k) / lead);
        return out;
      };
      return { num: trimZerosRel(toX(pT, dn)), den: toX(qT, qd) };
    }
  }
  return null;
}

function trimZerosRel(c: number[]): number[] {
  const scale = Math.max(...c.map(Math.abs), 1e-300);
  let d = c.length - 1;
  while (d > 0 && Math.abs(c[d] as number) <= 1e-10 * scale) d--;
  return c.slice(0, d + 1);
}

function trimDegree(c: Float64Array, tol: number): number {
  let d = c.length - 1;
  const scale = Math.max(...Array.from(c).map(Math.abs), 1e-300);
  while (d > 0 && Math.abs(c[d] as number) <= tol * scale) d--;
  return d;
}

const COS_TABLES = new Map<number, Float64Array>();

/** `cos(pi k (j + 1/2) / n)` for k, j in 0..n-1, row-major by k. Cached per size. */
function cosTable(n: number): Float64Array {
  let t = COS_TABLES.get(n);
  if (!t) {
    t = new Float64Array(n * n);
    for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) t[k * n + j] = Math.cos((Math.PI * k * (j + 0.5)) / n);
    COS_TABLES.set(n, t);
  }
  return t;
}

export interface LocalSeries {
  /** `c[k] = f^(k)(a) / k!` for k = 0..nmax. */
  readonly coeffs: Float64Array;
  /** The radius that converged. */
  readonly radius: number;
  /** Size of the discarded Chebyshev tail relative to the largest coefficient. */
  readonly tail: number;
}

const SERIES_RADII = [2, 1, 0.5, 0.25, 0.125, 0.0625, 0.03125] as const;

/**
 * Taylor coefficients of `f` at `a` up to order `nmax`, from a Chebyshev interpolant on `[a - r, a + r]`.
 * Tries radii from `SERIES_RADII[first]` downwards until the interpolant has converged (its last coefficients
 * vanish), so a nearby pole, branch point or kink only shrinks the interval. Null when no radius converges
 * or `spend` refuses. Deterministic; no tolerance depends on the machine.
 */
export function localSeries(f: Fn1, a: number, nmax: number, spend?: (n: number) => boolean, first = 0): LocalSeries | null {
  let N = Math.min(64, Math.max(24, nmax + 16));
  if (N % 2 === 1) N++;
  const cos = cosTable(N);
  const ys = new Float64Array(N);
  const cheb = new Float64Array(N);
  let best: LocalSeries | null = null;
  for (let ri = first; ri < SERIES_RADII.length; ri++) {
    const r = SERIES_RADII[ri] as number;
    if (spend && !spend(N)) return null;
    let defined = true;
    let scale = 0;
    for (let j = 0; j < N; j++) {
      const v = f(a + r * (cos[N + j] as number));
      if (v !== v || v === Infinity || v === -Infinity) {
        defined = false;
        break;
      }
      ys[j] = v;
      if (Math.abs(v) > scale) scale = Math.abs(v);
    }
    if (!defined) continue;
    for (let k = 0; k < N; k++) {
      let sum = 0;
      for (let j = 0; j < N; j++) sum += (ys[j] as number) * (cos[k * N + j] as number);
      cheb[k] = (2 * sum) / N;
    }
    cheb[0] = (cheb[0] as number) / 2;
    let tailMax = 0;
    for (let k = N - 4; k < N; k++) tailMax = Math.max(tailMax, Math.abs(cheb[k] as number));
    const tail = scale > 0 ? tailMax / scale : tailMax;
    if (best !== null && tail >= best.tail && tail > 1e-13) continue;
    // power coefficients in t = (x - a) / r, truncated at degree nmax
    const m = nmax + 1;
    const pw = new Float64Array(m);
    let t0 = new Float64Array(m);
    let t1 = new Float64Array(m);
    t0[0] = 1;
    if (m > 1) t1[1] = 1;
    pw[0] = cheb[0] as number;
    if (m > 1) pw[1] = cheb[1] as number;
    for (let k = 2; k < N; k++) {
      const t2 = new Float64Array(m);
      for (let d = 0; d < m; d++) t2[d] = (d > 0 ? 2 * (t1[d - 1] as number) : 0) - (t0[d] as number);
      const ck = cheb[k] as number;
      for (let d = 0; d < m; d++) pw[d] = (pw[d] as number) + ck * (t2[d] as number);
      t0 = t1;
      t1 = t2;
    }
    const out = new Float64Array(m);
    for (let k = 0; k < m; k++) out[k] = (pw[k] as number) / Math.pow(r, k);
    const cand: LocalSeries = { coeffs: out, radius: r, tail };
    if (tail <= 1e-13) return cand;
    best = cand;
  }
  return best !== null && best.tail <= 1e-8 ? best : null;
}

/** The n-th derivative of `f` at `x` from a local interpolant; NaN when `f` is too rough or undefined near `x`. */
export function derivativeAt(f: Fn1, x: number, n: number, spend?: (n: number) => boolean): number {
  const s = localSeries(f, x, n, spend, 1);
  if (!s) return Number.NaN;
  let fact = 1;
  for (let k = 2; k <= n; k++) fact *= k;
  return fact * (s.coeffs[n] as number);
}

/** Taylor coefficients `c[k] = f^(k)(a)/k!` (see `localSeries`). Null when no interval converges. */
export function taylorCoeffs(f: Fn1, a: number, n: number, _tol: number, work: RuleWork): { readonly coeffs: Float64Array; readonly residual: number } | null {
  const s = localSeries(f, a, n, (c) => work.spend(c));
  return s ? { coeffs: s.coeffs, residual: s.tail } : null;
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
