/**
 * The one commit function: clamp, snap, repair (numbers-sliders/design.md 3.3), the step helpers, the range check
 * (3.3 Limits, errors.md) and the numeric limits (errors.md 3).
 */
import { describe, expect, it } from 'vitest';
import { autoStep, commit, decimals, nice, unitScale, validateSliderRange } from '@incantly/kernel';
import type { CommitOpts, CommitSource } from '@incantly/kernel';
import { prng, T, within, each } from './helpers';

const SOURCES: CommitSource[] = ['drag', 'keyboard', 'typed', 'setValue', 'redefine', 'animation', 'api'];
const base: CommitOpts = { lo: 0, hi: 10, step: 'auto', unit: 'none', source: 'api' };
const c = (raw: number, over: Partial<CommitOpts> = {}) => commit(raw, { ...base, ...over });
const valueOf = (raw: number, over: Partial<CommitOpts> = {}): number => {
  const r = c(raw, over);
  if (!r.ok) throw new Error(`commit failed: ${r.reason}`);
  return r.value;
};

describe('3.3 step 1: a value that is not finite is undefined, never 0', () => {
  each([NaN, Infinity, -Infinity])('%s is undefined with reason not_finite', (raw) => {
    const r = c(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_finite');
  });
  each(SOURCES)('a non-finite value from %s is not_finite', (source) => {
    const r = c(NaN, { source, step: 0.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_finite');
  });
});

describe('3.3 step 2: clamp', () => {
  it('a value below the minimum becomes the minimum and reports from and to', () => {
    const r = c(-5);
    expect(r.ok && r.value).toBe(0);
    expect(r.ok && r.clamped).toEqual({ from: -5, to: 0 });
  });
  it('a value above the maximum becomes the maximum and reports from and to', () => {
    const r = c(12);
    expect(r.ok && r.value).toBe(10);
    expect(r.ok && r.clamped).toEqual({ from: 12, to: 10 });
  });
  each(SOURCES)('clamps for source %s', (source) => {
    expect(valueOf(99, { source })).toBe(10);
    expect(valueOf(-99, { source })).toBe(0);
  });
});

describe('3.3 steps 3 to 5: snapping to lo + k*step', () => {
  each([
    [3.2, 3],
    [3.26, 3.5],
    [3.24, 3],
    [3.25, 3.5],
    [0.2, 0],
    [0.3, 0.5],
    [9.9, 10],
    [0, 0],
    [10, 10],
  ])('step 0.5 turns %s into %s', (raw, want) => {
    expect(valueOf(raw, { step: 0.5 })).toBe(want);
  });

  each(SOURCES)('a fixed step quantises for source %s (also typed, SetValue and animation)', (source) => {
    expect(valueOf(3.3, { step: 0.5, source })).toBe(3.5);
  });

  it('removes binary noise: k*0.1 comes out as the decimal k/10', () => {
    for (let k = 0; k <= 10; k++) expect(valueOf(k * 0.1, { lo: 0, hi: 1, step: 0.1 })).toBe(k / 10);
  });
  it('counts steps from the minimum, not from zero', () => {
    expect(valueOf(1.4, { lo: 1, hi: 2, step: 0.25 })).toBe(1.5);
    expect(valueOf(1.37, { lo: 1, hi: 2, step: 0.25 })).toBe(1.25);
    expect(valueOf(1.38, { lo: 1, hi: 2, step: 0.25 })).toBe(1.5);
  });
  it('rounds half away from zero when counting steps, with negative values', () => {
    expect(valueOf(-0.5, { lo: -5, hi: 5, step: 1 })).toBe(0);
    expect(valueOf(0.5, { lo: -5, hi: 5, step: 1 })).toBe(1);
    expect(valueOf(-2.4, { lo: -5, hi: 5, step: 1 })).toBe(-2);
  });
  it('a step larger than the range leaves only the two ends', () => {
    expect(valueOf(3, { step: 100 })).toBe(0);
    expect(valueOf(7, { step: 100 })).toBe(10);
    expect(valueOf(0, { step: 100 })).toBe(0);
    expect(valueOf(10, { step: 100 })).toBe(10);
  });
  it('snapped reports the new value; a value already on the grid reports no snap', () => {
    const r = c(3.3, { step: 0.5 });
    expect(r.ok && r.snapped).not.toBeNull();
    expect(r.ok && r.snapped?.to).toBe(3.5);
    const s = c(3.5, { step: 0.5 });
    expect(s.ok && s.snapped).toBeNull();
  });
});

describe('3.3 step 4: the top end is reachable when the step does not divide the range', () => {
  each([
    [10, 10],
    [11, 10],
    [9.4, 9],
    [9.6, 10],
    [7.4, 6],
    [7.6, 9],
    [0, 0],
    [3, 3],
  ])('step 3 on 0..10 turns %s into %s', (raw, want) => {
    expect(valueOf(raw, { step: 3 })).toBe(want);
  });
  it('a 0.3 step on 0..1 still reaches 1', () => {
    expect(valueOf(1, { lo: 0, hi: 1, step: 0.3 })).toBe(1);
    expect(valueOf(0.95, { lo: 0, hi: 1, step: 0.3 })).toBe(1);
  });
});

describe('3.3 automatic step', () => {
  it('drag and keyboard snap to the nice step (0..1 gives 0.01)', () => {
    expect(valueOf(0.123, { lo: 0, hi: 1, source: 'drag' })).toBe(0.12);
    expect(valueOf(0.126, { lo: 0, hi: 1, source: 'keyboard' })).toBe(0.13);
  });
  each(['typed', 'setValue', 'animation'] as CommitSource[])('%s is only clamped under step auto', (source) => {
    expect(valueOf(0.123456, { lo: 0, hi: 1, source })).toBe(0.123456);
    expect(valueOf(7.77777, { source })).toBe(7.77777);
  });
  it('a continuous commit reports step "continuous"', () => {
    const r = c(0.123, { lo: 0, hi: 1, source: 'typed' });
    expect(r.ok && r.stepUsed).toBe('continuous');
  });
  it('a drag on 0..100 snaps to whole numbers', () => {
    expect(valueOf(33.4, { lo: 0, hi: 100, source: 'drag' })).toBe(33);
  });
  it('a 0..360 degree slider drags in steps of 5 degrees', () => {
    const v = valueOf((33 * Math.PI) / 180, { lo: 0, hi: 2 * Math.PI, unit: 'deg', source: 'drag' });
    expect(v).toBeCloseTo((35 * Math.PI) / 180, 12);
  });
});

describe('3.3 angles: display-unit space and exact doubles', () => {
  const deg = (k: number) => (k * Math.PI) / 180;
  it('unitScale: deg is pi/180, turn is tau, grad is pi/200, rad and none are 1', () => {
    expect(unitScale('deg')).toBe(Math.PI / 180);
    expect(unitScale('turn')).toBe(2 * Math.PI);
    expect(unitScale('grad')).toBe(Math.PI / 200);
    expect(unitScale('rad')).toBe(1);
    expect(unitScale('none')).toBe(1);
  });
  it('30.4 degrees snaps to exactly 30 degrees, computed as v * PI / 180', () => {
    expect(valueOf(deg(30.4), { lo: 0, hi: 2 * Math.PI, step: deg(1), unit: 'deg' })).toBe(deg(30));
  });
  it('a negative angle slider -180..180 degrees clamps and snaps', () => {
    expect(valueOf(deg(-200), { lo: deg(-180), hi: deg(180), step: deg(1), unit: 'deg' })).toBe(deg(-180));
    expect(valueOf(deg(-90.3), { lo: deg(-180), hi: deg(180), step: deg(1), unit: 'deg' })).toBe(deg(-90));
  });
  it('step decimals come from the displayed unit: 0.5 degree steps give exact half degrees', () => {
    expect(valueOf(deg(10.3), { lo: 0, hi: 2 * Math.PI, step: deg(0.5), unit: 'deg' })).toBe(deg(10.5));
  });
});

describe('3.3 empty and undefined ranges at run time', () => {
  it('lo equal to hi is undefined with reason empty_range', () => {
    const r = c(3, { lo: 5, hi: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('empty_range');
  });
  it('an undefined minimum is undefined with reason range_undefined', () => {
    const r = c(3, { lo: undefined });
    expect(!r.ok && r.reason).toBe('range_undefined');
  });
  it('an undefined step falls back to auto and says so (step_fallback)', () => {
    const r = c(3.14159, { step: undefined, source: 'typed' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.stepFallback).toBe(true);
      expect(r.value).toBe(3.14159);
    }
  });
});

describe('errors.md 3 numeric limits', () => {
  it('|value| / step above 2^52 is returned clamped and unquantised, with belowPrecision', () => {
    const r = c(5e16, { lo: 0, hi: 1e17, step: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.belowPrecision).toBe(true);
      expect(r.value).toBe(5e16);
    }
  });
  it('an angle above 2^40 * unitScale reports precisionLoss', () => {
    const r = c(1e12, { lo: -1e16, hi: 1e16, step: 'auto', unit: 'deg', source: 'typed' });
    expect(r.ok && r.precisionLoss).toBe(true);
  });
  it('a plain number above 2^40 reports precisionLoss; below it does not', () => {
    expect(c(2e12, { lo: 0, hi: 1e16, source: 'typed' }).ok && (c(2e12, { lo: 0, hi: 1e16, source: 'typed' }) as { precisionLoss: boolean }).precisionLoss).toBe(true);
    expect((c(1e3, { lo: 0, hi: 1e16, source: 'typed' }) as { precisionLoss: boolean }).precisionLoss).toBe(false);
  });
});

describe('3.8 test plan: properties of commit', () => {
  const configs: Partial<CommitOpts>[] = [
    { lo: 0, hi: 10, step: 0.5 },
    { lo: 0, hi: 1, step: 0.1 },
    { lo: -3, hi: 7, step: 0.25 },
    { lo: 0, hi: 10, step: 3 },
    { lo: 0.1, hi: 1.1, step: 0.1 },
    { lo: 0, hi: 1, step: 'auto', source: 'drag' },
    { lo: -180, hi: 180, step: 'auto', source: 'keyboard' },
    { lo: 0, hi: 1e6, step: 1 },
    { lo: 2, hi: 3, step: 100 },
  ];
  const rand = prng(20240901);
  const inputs = (lo: number, hi: number) => {
    const out: number[] = [];
    for (let i = 0; i < 300; i++) out.push(lo - (hi - lo) * 0.3 + rand() * (hi - lo) * 1.6);
    return out;
  };

  each(configs.map((o, i) => [i, o] as const))('commit(commit(x)) equals commit(x), config %s', (_i, o) => {
    const lo = o.lo ?? 0;
    const hi = o.hi ?? 10;
    for (const x of inputs(lo, hi)) {
      const once = c(x, o);
      expect(once.ok).toBe(true);
      if (!once.ok) continue;
      const twice = c(once.value, o);
      expect(twice.ok && twice.value).toBe(once.value);
    }
  });

  each(configs.map((o, i) => [i, o] as const))('lo <= commit(x) <= hi, config %s', (_i, o) => {
    const lo = o.lo ?? 0;
    const hi = o.hi ?? 10;
    for (const x of inputs(lo, hi)) {
      const r = c(x, o);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value).toBeGreaterThanOrEqual(lo);
        expect(r.value).toBeLessThanOrEqual(hi);
      }
    }
  });

  it('a fixed-step result is on the grid lo + k*step, or is the top end', () => {
    const lo = -3;
    const hi = 7;
    const step = 0.25;
    for (const x of inputs(lo, hi)) {
      const v = valueOf(x, { lo, hi, step });
      const k = (v - lo) / step;
      expect(Math.abs(k - Math.round(k)) < 1e-9 || v === hi).toBe(true);
    }
  });


  it('never throws on odd input', () => {
    const odd = [0, -0, 1e-320, 1e308, -1e308, Number.MAX_VALUE, Number.MIN_VALUE, NaN, Infinity, -Infinity];
    for (const x of odd) {
      for (const o of [{}, { step: 0 }, { step: -1 }, { step: NaN }, { lo: NaN }, { hi: Infinity }, { lo: Infinity, hi: -Infinity }] as Partial<CommitOpts>[]) {
        expect(() => c(x, o)).not.toThrow();
      }
    }
  });
});

describe('7 performance: commit under 2 microseconds', () => {
  it('100,000 commits take under one second (10x the target, for a busy machine)', { retry: 2, timeout: T }, () => {
    within(1000, () => {
      for (let i = 0; i < 100000; i++) c((i % 1000) / 100, { step: 0.5 });
    });
  });
});

describe('3.3 decimals(): the length of the shortest decimal string that reads back', () => {
  each([
    [0.5, 1],
    [0.1, 1],
    [2, 0],
    [0, 0],
    [100, 0],
    [0.25, 2],
    [123.456, 3],
    [0.000123, 6],
    [-0.5, 1],
    [1e-7, 7],
    [1.5e-7, 8],
    [1e21, 0],
    [1.0000000000000002, 16],
  ])('decimals(%s) is %s', (x, want) => {
    expect(decimals(x)).toBe(want);
  });
});

describe('3.3 nice() and the automatic step', () => {
  each([
    [1, 1],
    [2, 2],
    [5, 5],
    [10, 10],
    [0.01, 0.01],
    [1.49, 1],
    [1.51, 2],
    [3.49, 2],
    [3.51, 5],
    [7.49, 5],
    [7.51, 10],
    [0.03, 0.02],
    [250, 200],
    [12345, 10000],
  ])('nice(%s) is %s', (x, want) => {
    expect(nice(x)).toBeCloseTo(want, 12);
  });
  each([
    [0, 360, 5],
    [0, 1, 0.01],
    [0, 10, 0.1],
    [0, 100, 1],
    [0, 1000, 10],
    [-1, 1, 0.02],
    [0, 3, 0.02],
    [0, 70, 0.5],
    [0, 80, 1],
  ])('autoStep(%s, %s) is %s', (lo, hi, want) => {
    expect(autoStep(lo, hi)).toBeCloseTo(want, 12);
  });
});

describe('3.3 Limits and errors.md bad_range: validateSliderRange', () => {
  each([
    [0, 10, 'auto'],
    [0, 10, 0.5],
    [-5, 5, 1],
    [0, 10, 100],
    [0, 1e6, 1],
  ] as const)('accepts %s..%s step %s', (lo, hi, step) => {
    expect(validateSliderRange(lo, hi, step).ok).toBe(true);
  });
  each([
    [10, 0, 1],
    [5, 5, 1],
    [0, 10, 0],
    [0, 10, -1],
    [0, 10, NaN],
    [0, 10, Infinity],
    [0, Infinity, 'auto'],
    [-Infinity, 0, 'auto'],
    [NaN, 5, 'auto'],
    [0, NaN, 'auto'],
  ] as const)('%s..%s step %s is bad_range', (lo, hi, step) => {
    const r = validateSliderRange(lo, hi, step);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('bad_range');
  });
  it('more than 10^6 steps is a limit error with the limit and the actual count', () => {
    const r = validateSliderRange(0, 1e6 + 1, 1);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('limit');
    expect(r.limit).toBe(1e6);
    expect(r.actual).toBeGreaterThan(1e6);
  });
  it('a step below 1e-12 of the range is refused (bad_range, or limit as well: both rules apply)', () => {
    const r = validateSliderRange(0, 1, 1e-13);
    expect(r.ok).toBe(false);
    expect(['bad_range', 'limit']).toContain(r.kind);
  });
  it('a bad_range result carries min, max and step as evaluated', () => {
    const r = validateSliderRange(10, 0, 1);
    expect(r.min).toBe(10);
    expect(r.max).toBe(0);
    expect(r.step).toBe(1);
  });
});
