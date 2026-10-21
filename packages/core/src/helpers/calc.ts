import type { Calculus, Extremum, Rate } from '../api/types';
import { SceneApiError } from '../scene/errors';

/**
 * Numerical tools (FM-6, FM-7) so scenes never hand-roll them: derivatives,
 * integrals, roots, turning points, interpolation, ODE steps and the normal
 * distribution. Everything is pure and bounded.
 */

const MAX_N = 10_000;

function count(n: number | undefined, fallback: number, call: string): number {
  const value = Math.floor(n ?? fallback);
  if (!Number.isFinite(value) || value < 2 || value > MAX_N) throw new SceneApiError(`${call} takes from 2 to ${MAX_N} steps`);
  return value;
}

function fn(f: unknown, call: string): (x: number) => number {
  if (typeof f !== 'function') throw new SceneApiError(`${call} needs a function`);
  return f as (x: number) => number;
}

export function derivative(f: (x: number) => number, x: number, h = 1e-4): number {
  const g = fn(f, 'calc.derivative');
  const step = Math.abs(h) * Math.max(1, Math.abs(x));
  return (g(x + step) - g(x - step)) / (2 * step);
}

/** Simpson's rule with an even number of intervals. */
export function integral(f: (x: number) => number, a: number, b: number, n = 200): number {
  const g = fn(f, 'calc.integral');
  let steps = count(n, 200, 'calc.integral');
  if (steps % 2 === 1) steps++;
  const h = (b - a) / steps;
  let sum = g(a) + g(b);
  for (let i = 1; i < steps; i++) sum += (i % 2 === 1 ? 4 : 2) * g(a + i * h);
  return (sum * h) / 3;
}

/** One root in [a, b] by bisection on a sign change, or null when there is none. */
export function root(f: (x: number) => number, a: number, b: number): number | null {
  const g = fn(f, 'calc.root');
  let lo = Math.min(a, b);
  let hi = Math.max(a, b);
  let flo = g(lo);
  const fhi = g(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi)) return null;
  if (flo === 0) return lo;
  if (fhi === 0) return hi;
  if (Math.sign(flo) === Math.sign(fhi)) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const fm = g(mid);
    if (!Number.isFinite(fm)) return null;
    if (fm === 0) return mid;
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Every root in [a, b] found by scanning `n` intervals for sign changes. */
export function roots(f: (x: number) => number, a: number, b: number, n = 400): number[] {
  const g = fn(f, 'calc.roots');
  const steps = count(n, 400, 'calc.roots');
  const out: number[] = [];
  let px = a;
  let py = g(a);
  for (let i = 1; i <= steps && out.length < 50; i++) {
    const x = a + ((b - a) * i) / steps;
    const y = g(x);
    if (Number.isFinite(py) && Number.isFinite(y) && (py === 0 || Math.sign(py) !== Math.sign(y))) {
      const r = py === 0 ? px : root(g, px, x);
      // A jump across an asymptote changes sign without a root.
      if (r !== null && Math.abs(g(r)) < 1e-6 * (1 + Math.abs(py) + Math.abs(y)) && !out.some((o) => Math.abs(o - r) < 1e-9)) out.push(r);
    }
    px = x;
    py = y;
  }
  return out;
}

/** Turning points in [a, b]: where the derivative changes sign. */
export function extrema(f: (x: number) => number, a: number, b: number, n = 400): Extremum[] {
  const g = fn(f, 'calc.extrema');
  const h = Math.abs(b - a) * 1e-5;
  return roots((x) => (g(x + h) - g(x - h)) / (2 * h), a, b, n).flatMap((x) => {
    const y = g(x);
    if (!Number.isFinite(y)) return [];
    const left = g(x - 100 * h);
    const right = g(x + 100 * h);
    const kind: Extremum['kind'] | null = left > y && right > y ? 'min' : left < y && right < y ? 'max' : null;
    return kind === null ? [] : [{ x, y, kind }];
  });
}

/** Linear interpolation in a table of x and y values (x increasing). */
export function interp(xs: readonly number[], ys: readonly number[], x: number): number {
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length || xs.length === 0) {
    throw new SceneApiError('calc.interp needs two lists of the same length');
  }
  if (x <= xs[0]!) return ys[0]!;
  if (x >= xs[xs.length - 1]!) return ys[ys.length - 1]!;
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! <= x) lo = mid;
    else hi = mid;
  }
  const k = (x - xs[lo]!) / (xs[hi]! - xs[lo]! || 1);
  return ys[lo]! + k * (ys[hi]! - ys[lo]!);
}

function rate(f: unknown): Rate {
  if (typeof f !== 'function') throw new SceneApiError('An ODE step needs a function (t, y) => dy/dt');
  return f as Rate;
}

function combine(y: readonly number[], k: readonly number[], h: number): number[] {
  if (!Array.isArray(k) || k.length !== y.length) throw new SceneApiError('dy/dt must have one rate per value of y');
  return y.map((v, i) => v + h * k[i]!);
}

/** One explicit Euler step of dy/dt = f(t, y). */
export function euler(f: Rate, t: number, y: readonly number[], dt: number): number[] {
  return combine(y, rate(f)(t, y), dt);
}

/** One classical Runge-Kutta step of dy/dt = f(t, y). */
export function rk4(f: Rate, t: number, y: readonly number[], dt: number): number[] {
  const g = rate(f);
  const k1 = g(t, y);
  const k2 = g(t + dt / 2, combine(y, k1, dt / 2));
  const k3 = g(t + dt / 2, combine(y, k2, dt / 2));
  const k4 = g(t + dt, combine(y, k3, dt));
  return y.map((v, i) => v + (dt / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!));
}

/** The normal distribution's density. */
export function normal(x: number, mean = 0, sd = 1): number {
  if (!(sd > 0)) return Number.NaN;
  const z = (x - mean) / sd;
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
}

/** The normal distribution's cumulative probability (Abramowitz and Stegun 7.1.26). */
export function normalCdf(x: number, mean = 0, sd = 1): number {
  if (!(sd > 0)) return Number.NaN;
  const z = (x - mean) / (sd * Math.SQRT2);
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + Math.sign(z) * erf);
}

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
/** Maps x from [a0, a1] to [b0, b1]. */
export const map = (x: number, a0: number, a1: number, b0: number, b1: number): number => b0 + ((x - a0) / (a1 - a0)) * (b1 - b0);

export const calculus: Calculus = Object.freeze({ derivative, integral, root, roots, extrema, interp, euler, rk4, normal, normalCdf, clamp, lerp, map });
