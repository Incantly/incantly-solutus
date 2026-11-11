/**
 * Ordinary differential equations: adaptive Dormand-Prince 5(4) with dense output
 * (functions design 8.9). Dense output is cubic Hermite on each step's endpoints and
 * slopes (4th-order accurate, exact for cubics); events bisect on it. All limits count
 * steps and evaluations through `RuleWork`, never time.
 */
import type { RuleWork } from '../../graph/registry';

/* Dormand-Prince 5(4) tableau (first-same-as-last: 6 evaluations per step after the first). */
const C2 = 1 / 5;
const C3 = 3 / 10;
const C4 = 4 / 5;
const C5 = 8 / 9;
const A21 = 1 / 5;
const A31 = 3 / 40;
const A32 = 9 / 40;
const A41 = 44 / 45;
const A42 = -56 / 15;
const A43 = 32 / 9;
const A51 = 19372 / 6561;
const A52 = -25360 / 2187;
const A53 = 64448 / 6561;
const A54 = -212 / 729;
const A61 = 9017 / 3168;
const A62 = -355 / 33;
const A63 = 46732 / 5247;
const A64 = 49 / 176;
const A65 = -5103 / 18656;
const A71 = 35 / 384;
const A73 = 500 / 1113;
const A74 = 125 / 192;
const A75 = -2187 / 6784;
const A76 = 11 / 84;
const E1 = 71 / 57600;
const E3 = -71 / 16695;
const E4 = 71 / 1920;
const E5 = -17253 / 339200;
const E6 = 22 / 525;
const E7 = -1 / 40;

/** Hard cap on accepted plus rejected steps (functions design 8.9). */
export const ODE_MAX_STEPS = 200000;

export interface OdeProblem {
  /** Right-hand sides `y' = rhs(s, y)`; returns false when any is undefined there. */
  readonly rhs: (s: number, y: Float64Array, out: Float64Array) => boolean;
  readonly n: number;
  readonly s0: number;
  readonly y0: Float64Array;
  readonly s1: number;
  /** Event: the solve ends where this first changes sign (NaN carries no event). */
  readonly stop?: (s: number, y: Float64Array) => number;
  readonly rtol: number;
  readonly atol: number;
  readonly work: RuleWork;
}

export interface OdeSolution {
  /** Mesh: `nSteps + 1` points from `s0` towards `s1` (decreasing for backward runs). */
  readonly mesh: Float64Array;
  /** Values at the mesh, row-major `(nSteps + 1) x n`. */
  readonly vals: Float64Array;
  /** Slopes at the mesh, row-major (for Hermite dense output). */
  readonly slopes: Float64Array;
  readonly n: number;
  readonly steps: number;
  readonly end: 'done' | 'stop' | 'blowup' | 'stiff' | 'spent' | 'rhs_undefined' | 'step_limit';
  /** Where `stop` fired, when `end` is `stop`. */
  readonly eventS?: number;
}

function scaledNorm(err: Float64Array, y0: Float64Array, y1: Float64Array, n: number, rtol: number, atol: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const sc = atol + rtol * Math.max(Math.abs(y0[i] as number), Math.abs(y1[i] as number));
    const e = (err[i] as number) / sc;
    s += e * e;
  }
  return Math.sqrt(s / n);
}

function maxAbs(y: Float64Array, n: number): number {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(y[i] as number);
    if (v > m) m = v;
  }
  return m;
}

/** Integrates the problem. Never throws; partial results stay usable. */
export function solveOde(p: OdeProblem): OdeSolution {
  const n = p.n;
  const dir = p.s1 >= p.s0 ? 1 : -1;
  const span = Math.abs(p.s1 - p.s0);
  const minStep = 1e-14 * (1 + Math.abs(p.s0));
  const mesh: number[] = [p.s0];
  const vals: number[] = [...p.y0.slice(0, n)];
  const slopes: number[] = new Array<number>(n).fill(0);
  const y = Float64Array.from(p.y0.slice(0, n));
  const k1 = new Float64Array(n);
  if (!p.rhs(p.s0, y, k1)) {
    return { mesh: Float64Array.from(mesh), vals: Float64Array.from(vals), slopes: Float64Array.from(slopes), n, steps: 0, end: 'rhs_undefined' };
  }
  for (let i = 0; i < n; i++) slopes[i] = k1[i] as number;
  // First-step estimate: 1% of the value-over-slope scale, clamped to the span.
  const d0 = maxAbs(y, n);
  const d1 = maxAbs(k1, n);
  let h = d0 < 1e-5 && d1 < 1e-5 ? 1e-6 : 0.01 * (d0 / Math.max(d1, 1e-300));
  h = Math.min(Math.max(h, minStep), span / 10 || minStep) * dir;
  if (!(h !== 0)) h = dir * minStep;
  let s = p.s0;
  let shrinkCount = 0;
  let steps = 0;
  let end: OdeSolution['end'] = 'done';
  let eventS: number | undefined;
  let prevStop = p.stop ? p.stop(s, y) : Number.NaN;
  const k2 = new Float64Array(n);
  const k3 = new Float64Array(n);
  const k4 = new Float64Array(n);
  const k5 = new Float64Array(n);
  const k6 = new Float64Array(n);
  const k7 = new Float64Array(n);
  const yt = new Float64Array(n);
  const y1 = new Float64Array(n);
  const err = new Float64Array(n);
  const done = (): boolean => (dir === 1 ? s >= p.s1 : s <= p.s1);
  while (!done()) {
    if (steps >= ODE_MAX_STEPS) {
      end = 'step_limit';
      break;
    }
    if (!p.work.spend(7)) {
      end = 'spent';
      break;
    }
    steps++;
    if (dir === 1 ? s + h > p.s1 : s + h < p.s1) h = p.s1 - s;
    const stages: [number, Float64Array][] = [
      [C2, k2], [C3, k3], [C4, k4], [C5, k5], [1, k6],
    ];
    let bad = false;
    for (const [c, kk] of stages) {
      for (let i = 0; i < n; i++) {
        const a =
          kk === k2 ? A21 * (k1[i] as number)
          : kk === k3 ? A31 * (k1[i] as number) + A32 * (k2[i] as number)
          : kk === k4 ? A41 * (k1[i] as number) + A42 * (k2[i] as number) + A43 * (k3[i] as number)
          : kk === k5 ? A51 * (k1[i] as number) + A52 * (k2[i] as number) + A53 * (k3[i] as number) + A54 * (k4[i] as number)
          : A61 * (k1[i] as number) + A62 * (k2[i] as number) + A63 * (k3[i] as number) + A64 * (k4[i] as number) + A65 * (k5[i] as number);
        yt[i] = (y[i] as number) + h * a;
      }
      if (!p.rhs(s + c * h, yt, kk)) {
        bad = true;
        break;
      }
    }
    if (bad) {
      end = 'rhs_undefined';
      break;
    }
    for (let i = 0; i < n; i++) {
      y1[i] = (y[i] as number) + h * (A71 * (k1[i] as number) + A73 * (k3[i] as number) + A74 * (k4[i] as number) + A75 * (k5[i] as number) + A76 * (k6[i] as number));
    }
    if (!p.rhs(s + h, y1, k7)) {
      end = 'rhs_undefined';
      break;
    }
    for (let i = 0; i < n; i++) {
      err[i] = h * (E1 * (k1[i] as number) + E3 * (k3[i] as number) + E4 * (k4[i] as number) + E5 * (k5[i] as number) + E6 * (k6[i] as number) + E7 * (k7[i] as number));
    }
    const norm = scaledNorm(err, y, y1, n, p.rtol, p.atol);
    const fac = norm < 1e-300 ? 5 : Math.min(5, Math.max(0.2, 0.9 * Math.pow(norm, -0.2)));
    if (norm <= 1) {
      const s1 = s + h;
      mesh.push(s1);
      for (let i = 0; i < n; i++) vals.push(y1[i] as number);
      for (let i = 0; i < n; i++) slopes.push(k7[i] as number);
      // Event: sign change of stop across the accepted step, located on the dense output.
      // `steps` was already incremented, so the new mesh point is index `steps` and the step is `steps - 1`.
      if (p.stop) {
        const cur = p.stop(s1, y1);
        if (prevStop === prevStop && cur === cur && (prevStop < 0) !== (cur < 0) && prevStop !== 0 && cur !== 0) {
          const ev = locateEvent(p, mesh, vals, slopes, n, steps - 1, prevStop);
          if (ev !== undefined) {
            eventS = ev.s;
            mesh[steps] = ev.s;
            for (let i = 0; i < n; i++) vals[steps * n + i] = ev.y[i] as number;
            end = 'stop';
            break;
          }
        }
        prevStop = cur;
      }
      s = s1;
      for (let i = 0; i < n; i++) y[i] = y1[i] as number;
      for (let i = 0; i < n; i++) k1[i] = k7[i] as number;
      h *= fac;
      shrinkCount = 0;
    } else {
      h *= fac;
      shrinkCount++;
      if (Math.abs(h) < minStep) {
        end = maxAbs(y, n) > 1e8 || shrinkCount >= 10 ? 'blowup' : 'stiff';
        break;
      }
    }
    if (Math.abs(h) < minStep) h = (h < 0 ? -1 : 1) * minStep;
  }
  return {
    mesh: Float64Array.from(mesh),
    vals: Float64Array.from(vals),
    slopes: Float64Array.from(slopes),
    n,
    steps: mesh.length - 1,
    end,
    ...(eventS !== undefined ? { eventS } : {}),
  };
}

interface EventHit {
  readonly s: number;
  readonly y: Float64Array;
}

/** Bisects the dense output of step `stepIdx` for the zero of `stop` (tolerance 1e-12). */
function locateEvent(
  p: OdeProblem,
  mesh: number[],
  vals: number[],
  slopes: number[],
  n: number,
  stepIdx: number,
  prevStop: number,
): EventHit | undefined {
  const stop = p.stop as (s: number, y: Float64Array) => number;
  const s0 = mesh[stepIdx] as number;
  const s1 = mesh[stepIdx + 1] as number;
  const y = new Float64Array(n);
  let lo = s0;
  let hi = s1;
  let vlo = prevStop;
  for (let i = 0; i < 60; i++) {
    if (!p.work.spend(1)) return undefined;
    const m = 0.5 * (lo + hi);
    hermiteStep(mesh, vals, slopes, n, stepIdx, m, y);
    const v = stop(m, y);
    if (v !== v) return undefined;
    if (v === 0) {
      lo = m;
      hi = m;
      break;
    }
    if (vlo < 0 !== (v < 0)) hi = m;
    else {
      lo = m;
      vlo = v;
    }
    if (Math.abs(hi - lo) <= 1e-12 * Math.max(1, Math.abs(s0), Math.abs(s1))) break;
  }
  const m = 0.5 * (lo + hi);
  hermiteStep(mesh, vals, slopes, n, stepIdx, m, y);
  return { s: m, y: Float64Array.from(y) };
}

/** Cubic Hermite evaluation of step `stepIdx` at `s` into `out`. */
function hermiteStep(mesh: number[] | Float64Array, vals: number[] | Float64Array, slopes: number[] | Float64Array, n: number, stepIdx: number, s: number, out: Float64Array): void {
  const s0 = mesh[stepIdx] as number;
  const s1 = mesh[stepIdx + 1] as number;
  const h = s1 - s0;
  const t = h === 0 ? 0 : (s - s0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  for (let i = 0; i < n; i++) {
    const y0 = vals[stepIdx * n + i] as number;
    const y1 = vals[(stepIdx + 1) * n + i] as number;
    const f0 = slopes[stepIdx * n + i] as number;
    const f1 = slopes[(stepIdx + 1) * n + i] as number;
    out[i] = h00 * y0 + h10 * h * f0 + h01 * y1 + h11 * h * f1;
  }
}

/**
 * Evaluates variable `v` of the solution at `s` (binary search plus Hermite).
 * NaN outside the solved domain. Deterministic; O(log steps).
 */
export function odeEval(sol: OdeSolution, v: number, s: number): number {
  const mesh = sol.mesh;
  const steps = sol.steps;
  if (steps < 1 || s !== s) return Number.NaN;
  const lo = Math.min(mesh[0] as number, mesh[steps] as number);
  const hi = Math.max(mesh[0] as number, mesh[steps] as number);
  if (s < lo || s > hi) return Number.NaN;
  const fwd = (mesh[steps] as number) >= (mesh[0] as number);
  let a = 0;
  let b = steps;
  while (b - a > 1) {
    const m = (a + b) >> 1;
    const before = fwd ? (mesh[m] as number) <= s : (mesh[m] as number) >= s;
    if (before) a = m;
    else b = m;
  }
  const out = new Float64Array(sol.n);
  hermiteStep(mesh, sol.vals, sol.slopes, sol.n, a, s, out);
  return out[v] as number;
}

/** Domain of the solution as `[min, max]` of the mesh. */
export function odeDomain(sol: OdeSolution): readonly [number, number] {
  const a = sol.mesh[0] as number;
  const b = sol.mesh[sol.steps] as number;
  return a <= b ? [a, b] : [b, a];
}
