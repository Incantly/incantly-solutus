/**
 * Surfaces and curves in space (docs/features/space-3d/design.md 6.3; .kiro/specs/space-3d-surfaces R1):
 * `Surface(x, y, z, u, u0, u1, v, v0, v1)` from three formulas in two parameters, `Curve(x, y, z, s, a, b)` from three
 * formulas in one, and `PointOn` a curve. The value holds the formulas, so the screen samples them as finely as it
 * draws; a formula that reads `t` moves with the film because the rule runs again when `t` changes.
 */
import type { CommandRule, RuleCall } from '../../graph/registry';
import type { Env } from '../../language/runtime';
import type { V3 } from './v3';
import { dist, isV3 } from './v3';

/** A surface in space: `at(u, v)` is the point, or `undefined` where a formula is undefined. */
export interface Surface3 {
  readonly shape3: 'Surface';
  readonly kind: 'parametric';
  readonly at: (u: number, v: number) => V3 | undefined;
  readonly u: readonly [number, number];
  readonly v: readonly [number, number];
}

/** A curve in space on `lo..hi`. */
export interface Curve3 {
  readonly shape3: 'Curve3';
  readonly at: (s: number) => V3 | undefined;
  readonly lo: number;
  readonly hi: number;
}

/** Evaluates body `arg` with the binder slots set; NaN where it is undefined. Saves and restores what it touches. */
function bodyOf(call: RuleCall, arg: number, slots: readonly number[]): ((...xs: number[]) => number) | undefined {
  const ev = call.args[arg]?.eval;
  if (!ev) return undefined;
  const env: Env = call.env;
  return (...xs: number[]): number => {
    const saved = slots.map((s) => env.locals[s]);
    const { reason, cause, detail } = env;
    slots.forEach((s, i) => (env.locals[s] = xs[i] as number));
    env.reason = undefined;
    let v: unknown;
    try {
      v = ev(env);
    } catch {
      v = Number.NaN;
    }
    slots.forEach((s, i) => (env.locals[s] = saved[i]));
    env.reason = reason;
    env.cause = cause;
    env.detail = detail;
    return typeof v === 'number' ? v : Number.NaN;
  };
}

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** A range that runs low to high and is finite, or the reason it is not. */
function rangeOf(call: RuleCall, i: number, what: string): readonly [number, number] | undefined {
  const a = call.values[i];
  const b = call.values[i + 1];
  if (!fin(a) || !fin(b)) {
    call.fail('missing_range', `${what} needs a finite range, such as 0..tau for one full turn`);
    return undefined;
  }
  if (!(a < b)) {
    call.fail('bad_argument', 'ranges run low to high');
    return undefined;
  }
  return [a, b];
}

export const surfaceRule: CommandRule = {
  run(call) {
    const su = call.args[3]?.slot;
    const sv = call.args[6]?.slot;
    if (su === undefined || sv === undefined) return call.fail('bad_argument', 'Surface needs three formulas and two parameters with their ranges');
    const u = rangeOf(call, 4, 'a surface');
    if (!u) return undefined;
    const v = rangeOf(call, 7, 'a surface');
    if (!v) return undefined;
    const fx = bodyOf(call, 0, [su, sv]);
    const fy = bodyOf(call, 1, [su, sv]);
    const fz = bodyOf(call, 2, [su, sv]);
    if (!fx || !fy || !fz) return call.fail('bad_argument', 'Surface needs three formulas in u and v');
    const at = (a: number, b: number): V3 | undefined => {
      const x = fx(a, b);
      const y = fy(a, b);
      const z = fz(a, b);
      return x === x && y === y && z === z && Math.abs(x) < 1e12 && Math.abs(y) < 1e12 && Math.abs(z) < 1e12 ? { x, y, z } : undefined;
    };
    // undefined at every one of 9 × 9 samples: the surface is undefined, with the formulas' reason
    let any = false;
    for (let i = 0; i <= 8 && !any; i++) for (let j = 0; j <= 8 && !any; j++) any = at(u[0] + ((u[1] - u[0]) * i) / 8, v[0] + ((v[1] - v[0]) * j) / 8) !== undefined;
    if (!any) return call.fail('out_of_domain', 'the formulas are not defined anywhere in the ranges');
    const s: Surface3 = { shape3: 'Surface', kind: 'parametric', at, u, v };
    return s;
  },
};

export const curve3Rule: CommandRule = {
  run(call) {
    const ss = call.args[3]?.slot;
    if (ss === undefined) return call.fail('bad_argument', 'Curve needs three formulas, a parameter and its range');
    const r = rangeOf(call, 4, 'a curve');
    if (!r) return undefined;
    const fx = bodyOf(call, 0, [ss]);
    const fy = bodyOf(call, 1, [ss]);
    const fz = bodyOf(call, 2, [ss]);
    if (!fx || !fy || !fz) return call.fail('bad_argument', 'Curve needs three formulas in the parameter');
    const at = (s: number): V3 | undefined => {
      const x = fx(s);
      const y = fy(s);
      const z = fz(s);
      return x === x && y === y && z === z && Math.abs(x) < 1e12 && Math.abs(y) < 1e12 && Math.abs(z) < 1e12 ? { x, y, z } : undefined;
    };
    let any = false;
    for (let i = 0; i <= 32 && !any; i++) any = at(r[0] + ((r[1] - r[0]) * i) / 32) !== undefined;
    if (!any) return call.fail('out_of_domain', 'the formulas are not defined anywhere in the range');
    const c: Curve3 = { shape3: 'Curve3', at, lo: r[0], hi: r[1] };
    return c;
  },
};

/** The parameter of the curve's point nearest `p`: 200 samples, then a golden-section refine of the best gap. */
export function nearestOnCurve(c: Curve3, p: V3): number | undefined {
  const N = 200;
  let best: number | undefined;
  let bestD = Infinity;
  const h = (c.hi - c.lo) / N;
  for (let i = 0; i <= N; i++) {
    const s = c.lo + h * i;
    const q = c.at(s);
    if (!q) continue;
    const d = dist(q, p);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  if (best === undefined) return undefined;
  let a = Math.max(c.lo, best - h);
  let b = Math.min(c.hi, best + h);
  const g = (Math.sqrt(5) - 1) / 2;
  const f = (s: number): number => {
    const q = c.at(s);
    return q ? dist(q, p) : Infinity;
  };
  for (let k = 0; k < 40; k++) {
    const x1 = b - g * (b - a);
    const x2 = a + g * (b - a);
    if (f(x1) < f(x2)) b = x2;
    else a = x1;
  }
  return (a + b) / 2;
}

export const pointOnCurve3: CommandRule = {
  run(call) {
    const c = call.values[0] as Curve3;
    const s = call.values[1] as number;
    if (!fin(s)) return call.fail('not_finite', 'the parameter is not a finite number');
    if (s < c.lo - 1e-12 || s > c.hi + 1e-12) return call.fail('out_of_domain', `the curve runs from ${c.lo} to ${c.hi}`);
    return c.at(s) ?? call.fail('out_of_domain', 'the curve is not defined there');
  },
  // dragging the point slides it along the curve: the parameter written in the line changes (kernel design 7)
  invert(target, c) {
    const curve = c.values[0] as Curve3 | undefined;
    if (!isV3(target) || !curve || typeof curve.at !== 'function') return undefined;
    const s = nearestOnCurve(curve, target);
    return s === undefined ? undefined : [{ param: 1, value: Number(s.toPrecision(6)) }];
  },
};
