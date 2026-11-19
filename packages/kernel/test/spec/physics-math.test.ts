/**
 * The engine's own sin and cos (`physicsMath`, docs/features/physics/design.md 10.2; handoff/physics/findings.md PH-52).
 *
 * The finding: the third piece of the π/2 split was wrong, so the angle reduction was off by up to 1,308 ulp near a zero of
 * sin. The fix is checked here from the public API only: `physicsMath.sin`, `cos` and `sincos` within 1 ulp of `Math` over a
 * seeded sweep in [-1e5, 1e5], around the multiples of π/2 (where the reduction cancels most), and the special values.
 */
import { describe, expect, it } from 'vitest';
import { physicsMath } from '../../src/index';

const f64 = new Float64Array(1);
const i64 = new BigInt64Array(f64.buffer);
const MIN_I64 = -(2n ** 63n);

/** The bits of a double as an integer that grows with the number: neighbours differ by 1, and -0 and +0 are both 0. */
function ordered(x: number): bigint {
  f64[0] = x;
  const b = i64[0] as bigint;
  return b < 0n ? MIN_I64 - b : b;
}

function ulpDistance(a: number, b: number): number {
  if (a === b) return 0;
  const d = ordered(a) - ordered(b);
  return Number(d < 0n ? -d : d);
}

/** A seeded generator (mulberry32): the same numbers on every run and every computer. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const worst = (fn: (x: number) => number, ref: (x: number) => number, xs: readonly number[]): { ulp: number; at: number } => {
  let ulp = 0;
  let at = 0;
  for (const x of xs) {
    const d = ulpDistance(fn(x), ref(x));
    if (d > ulp) {
      ulp = d;
      at = x;
    }
  }
  return { ulp, at };
};

const SWEEP: number[] = (() => {
  const rnd = seeded(52);
  const out: number[] = [];
  for (let i = 0; i < 100_000; i++) out.push((rnd() * 2 - 1) * 1e5);
  return out;
})();

/** The doubles on both sides of k π/2 for k up to 60,000 (angles of at most about 94,000), where sin or cos is near zero. */
const NEAR_MULTIPLES: number[] = (() => {
  const out: number[] = [];
  for (let k = -60_000; k <= 60_000; k += 7) {
    const x = (k * Math.PI) / 2;
    out.push(x, x * (1 + 1e-15), x * (1 - 1e-15), x + 1e-9);
  }
  return out;
})();

describe('physicsMath.sin and cos (PH-52)', () => {
  it('sin is within 1 ulp of Math.sin on 100,000 seeded inputs in [-1e5, 1e5]', () => {
    const w = worst(physicsMath.sin, Math.sin, SWEEP);
    expect(w.ulp, `${w.ulp} ulp at x = ${w.at}`).toBeLessThanOrEqual(1);
  });

  it('cos is within 1 ulp of Math.cos on the same inputs', () => {
    const w = worst(physicsMath.cos, Math.cos, SWEEP);
    expect(w.ulp, `${w.ulp} ulp at x = ${w.at}`).toBeLessThanOrEqual(1);
  });

  it('sin and cos are within 1 ulp next to the multiples of π/2, where one of them is near zero', () => {
    const s = worst(physicsMath.sin, Math.sin, NEAR_MULTIPLES);
    const c = worst(physicsMath.cos, Math.cos, NEAR_MULTIPLES);
    expect(s.ulp, `sin: ${s.ulp} ulp at x = ${s.at}`).toBeLessThanOrEqual(1);
    expect(c.ulp, `cos: ${c.ulp} ulp at x = ${c.at}`).toBeLessThanOrEqual(1);
  });

  it('the point of the finding, x = -860.796…, is no longer far off', () => {
    // the third π/2 piece was wrong by 2e-21 × k: near a zero of sin that was over a thousand ulp
    const rnd = seeded(860);
    const xs: number[] = [];
    for (let i = 0; i < 20_000; i++) xs.push(-860.79 - rnd() * 0.02);
    expect(worst(physicsMath.sin, Math.sin, xs).ulp).toBeLessThanOrEqual(1);
    expect(worst(physicsMath.cos, Math.cos, xs).ulp).toBeLessThanOrEqual(1);
  });

  it('sincos gives exactly what sin and cos give', () => {
    const out = new Float64Array(2);
    const rnd = seeded(9);
    for (let i = 0; i < 20_000; i++) {
      const x = (rnd() * 2 - 1) * 1e3;
      physicsMath.sincos(x, out);
      expect(Object.is(out[0], physicsMath.sin(x))).toBe(true);
      expect(Object.is(out[1], physicsMath.cos(x))).toBe(true);
    }
  });

  it('the special values: ±0 keep their sign, sin 0 = 0, cos 0 = 1, and NaN and the infinities give NaN', () => {
    expect(Object.is(physicsMath.sin(0), 0)).toBe(true);
    expect(Object.is(physicsMath.sin(-0), -0)).toBe(true);
    expect(physicsMath.cos(0)).toBe(1);
    expect(physicsMath.cos(-0)).toBe(1);
    for (const x of [NaN, Infinity, -Infinity]) {
      expect(physicsMath.sin(x)).toBeNaN();
      expect(physicsMath.cos(x)).toBeNaN();
    }
    const out = new Float64Array(2);
    physicsMath.sincos(Infinity, out);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeNaN();
  });

  it('small and large angles: tiny angles are their own sine, and an angle of 1e9 is within 1 ulp', () => {
    expect(physicsMath.sin(1e-300)).toBe(1e-300);
    expect(physicsMath.cos(1e-300)).toBe(1);
    const xs: number[] = [];
    const rnd = seeded(1e9);
    for (let i = 0; i < 5_000; i++) xs.push((rnd() * 2 - 1) * 1e9);
    expect(worst(physicsMath.sin, Math.sin, xs).ulp).toBeLessThanOrEqual(1);
    expect(worst(physicsMath.cos, Math.cos, xs).ulp).toBeLessThanOrEqual(1);
  });
});
