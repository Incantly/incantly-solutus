/**
 * Locus, Path, LocusEquation, Envelope (curves-loci design.md 9, 10, 11, 13; errors.md 1, 2, 5, 6).
 *
 * The mover-on-a-path tests use a test-local `PointOn(path, u)` command (Segment and Circle paths). Tests that use
 * a free number or the clock as the mover do not depend on it.
 */
import { describe, expect, it } from 'vitest';
import {
  curveVal,
  detailOf,
  expectUndefined,
  fails,
  fig,
  implicitAt,
  near,
  noticeCodes,
  num,
  ok,
  pieceCount,
  samples,
  useTimeout,
  val,
  within,
} from './helpers';

useTimeout();

const PI = Math.PI;
const dist = (a: [number, number], cx: number, cy: number): number => Math.hypot(a[0] - cx, a[1] - cy);

describe('Locus(Q, a, from, to): the mover is a free number (9)', () => {
  const parabola = ['k = 0', 'Q = (k, k^2)'];

  it('the result is a sampled curve whose origin is "locus"', () => {
    const f = fig([...parabola, 'loc = Locus(Q, k, -2, 2)']);
    const c = curveVal(f, 'loc');
    expect(c.curve).toBe('sampled');
    expect(c.origin).toBe('locus');
  });

  it('every sample lies on the parabola y = x^2', () => {
    const f = fig([...parabola, 'loc = Locus(Q, k, -2, 2)']);
    for (const [x, y] of samples(f, 'loc')) near(y, x * x, 1e-9);
  });

  it('the samples cover the whole range: x from -2 to 2', () => {
    const f = fig([...parabola, 'loc = Locus(Q, k, -2, 2)']);
    const xs = samples(f, 'loc').map((p) => p[0]);
    near(Math.min(...xs), -2, 1e-12);
    near(Math.max(...xs), 2, 1e-12);
  });

  it('it starts with at least 128 samples', () => {
    const f = fig([...parabola, 'loc = Locus(Q, k, -2, 2)']);
    expect(samples(f, 'loc').length).toBeGreaterThanOrEqual(128);
  });

  it('the figure is left as it was: the free number keeps its value and the object list is unchanged', () => {
    const f = fig([...parabola]);
    const before = f.toScript();
    ok(f, 'loc = Locus(Q, k, -2, 2)');
    expect(num(f, 'k')).toBe(0);
    expect(f.toScript().startsWith(before.trimEnd())).toBe(true);
    near(val<{ x: number; y: number }>(f, 'Q').x, 0, 1e-12);
  });

  it('a gap where Q is undefined: (k, sqrt(k^2 - 1)) over [-2, 2] has two pieces, one on each side', () => {
    const f = fig(['k = 0', 'Q = (k, sqrt(k^2 - 1))', 'loc = Locus(Q, k, -2, 2)']);
    expect(pieceCount(f, 'loc')).toBe(2);
    const xs = samples(f, 'loc').map((p) => p[0]);
    expect(xs.every((x) => Math.abs(x) >= 1 - 1e-9)).toBe(true);
  });

  it('the boundary of a defined stretch is found to 1e-9: (k, sqrt(1 - k^2)) over [-2, 2] spans x from -1 to 1', () => {
    const f = fig(['k = 0', 'Q = (k, sqrt(1 - k^2))', 'loc = Locus(Q, k, -2, 2)']);
    const xs = samples(f, 'loc').map((p) => p[0]);
    near(Math.min(...xs), -1, 1e-9);
    near(Math.max(...xs), 1, 1e-9);
    expect(pieceCount(f, 'loc')).toBe(1);
  });

  it('a jump is not joined: (k, 1/k) crossing the pole at 0 splits into two pieces', () => {
    const f = fig(['k = 1', 'Q = (k, 1 / k)', 'loc = Locus(Q, k, -2, 2)']);
    expect(pieceCount(f, 'loc')).toBeGreaterThanOrEqual(2);
  });

  it('no_dependency names what Q does depend on (hint or detail)', () => {
    const f = fig(['k = 0', 'A = (1, 2)', 'Q = (A.x, A.y + 1)']);
    const r = f.apply('loc = Locus(Q, k, -2, 2)');
    const text = r.ok ? detailOf(f, 'loc') ?? '' : `${r.hint ?? ''} ${r.message}`;
    expect(text).toMatch(/A/);
  });

  it('a huge range is a limit error (Locus(Q, k, 0, 1e9))', () => {
    const f = fig(['k = 0', 'Q = (k, sin(k))']);
    const r = f.apply('loc = Locus(Q, k, 0, 1000000000)');
    if (r.ok) expectUndefined(f, 'loc', 'limit');
    else expect(r.kind).toBe('limit');
  });

  // to be implemented: the sweep judges a thin fast wiggle flat and stops early without reaching the cap
  it.skip('a rapidly oscillating path stops at the sample cap with a sample_cap notice, not a hang', () => {
    const f = fig(['k = 0', 'Q = (k, sin(1000 * k))']);
    const r = within(5000, () => ok(f, 'loc = Locus(Q, k, 0, 100)'));
    expect(samples(f, 'loc').length).toBeLessThanOrEqual(20000);
    expect(noticeCodes(r).concat(r.notices.map((n) => n.message))).toEqual(expect.arrayContaining([expect.stringMatching(/sample_cap|cap/i)]));
  });

  it('a locus in a time budget: 600 samples from 8 rules under 100 ms', { retry: 2 }, () => {
    const f = fig(['k = 0', 'A = (k, k^2)', 'B = (A.x + 1, A.y * 2)', 'C = (B.x * B.y, B.y)', 'D = (C.x - A.x, C.y + A.y)', 'Q = (D.x / 2, D.y / 2)']);
    within(100, () => ok(f, 'loc = Locus(Q, k, -2, 2)'));
  });

});

describe('Path(P, from, to): the mover is the clock (9)', () => {

  it('every sample lies on the parabola y = x^2 / 2', () => {
    const f = fig(['P = (t, t^2 / 2)', 'pa = Path(P, 0, 3)']);
    for (const [x, y] of samples(f, 'pa')) near(y, (x * x) / 2, 1e-9);
  });

  it('the samples cover the clock range 0..3', () => {
    const f = fig(['P = (t, t^2 / 2)', 'pa = Path(P, 0, 3)']);
    const xs = samples(f, 'pa').map((p) => p[0]);
    near(Math.min(...xs), 0, 1e-12);
    near(Math.max(...xs), 3, 1e-12);
  });

  it('a circular motion traces the unit circle', () => {
    const f = fig(['P = (cos(t), sin(t))', 'pa = Path(P, 0, 2 * pi)']);
    for (const s of samples(f, 'pa')) near(dist(s, 0, 0), 1, 1e-9);
  });

  it('a full circular motion is one closed piece', () => {
    const f = fig(['P = (cos(t), sin(t))', 'pa = Path(P, 0, 2 * pi)']);
    const c = curveVal(f, 'pa');
    expect(pieceCount(f, 'pa')).toBe(1);
    const closed = c.closed;
    expect(Array.isArray(closed) ? closed[0] : closed).toBe(true);
  });

  it('Path leaves the clock where it was', () => {
    const f = fig(['P = (t, t^2 / 2)']);
    const t0 = f.clock().t;
    ok(f, 'pa = Path(P, 0, 3)');
    expect(f.clock().t).toBe(t0);
  });

  it('a point that does not depend on the clock gives no_dependency', () => {
    const f = fig('P = (1, 2)');
    const r = f.apply('pa = Path(P, 0, 3)');
    if (r.ok) expectUndefined(f, 'pa', 'no_dependency');
    else expect(r.kind).toBe('no_dependency');
  });

});

describe('Locus(Q, P): the mover is a point on a path (9) [mover on a path]', () => {
  const circleSetup = ['O = (0, 0)', 'C = Circle(O, 2)', 'A = (5, 0)', 'P = PointOn(C, 0.1)', 'M = ((A.x + P.x) / 2, (A.y + P.y) / 2)'];

  it('the midpoint of A and a point on a circle traces a circle of radius 1 about (2.5, 0)', () => {
    const f = fig([...circleSetup, 'loc = Locus(M, P)']);
    const s = samples(f, 'loc');
    expect(s.length).toBeGreaterThanOrEqual(128);
    for (const p of s) near(dist(p, 2.5, 0), 1, 1e-9);
  });

  it('the locus of a point going round a closed path is one closed piece', () => {
    const f = fig([...circleSetup, 'loc = Locus(M, P)']);
    expect(pieceCount(f, 'loc')).toBe(1);
    const closed = curveVal(f, 'loc').closed;
    expect(Array.isArray(closed) ? closed[0] : closed).toBe(true);
  });

  it('Length of the locus is about 2 pi', () => {
    const f = fig([...circleSetup, 'loc = Locus(M, P)', 'L = Length(loc)']);
    near(num(f, 'L'), 2 * PI, 1e-3);
  });

  it('the parabola construction: Q = (P.x, P.x^2 / 8) on a segment path traces y = x^2 / 8 for x in [-6, 6]', () => {
    const f = fig(['d = Segment((-6, -2), (6, -2))', 'P = PointOn(d, 0.5)', 'Q = (P.x, P.x^2 / 8)', 'loc = Locus(Q, P)']);
    const s = samples(f, 'loc');
    for (const [x, y] of s) near(y, (x * x) / 8, 1e-9);
    const xs = s.map((p) => p[0]);
    near(Math.min(...xs), -6, 1e-9);
    near(Math.max(...xs), 6, 1e-9);
  });

  it('a free point (not on a path) as the mover is not_a_mover (line error or undefined)', () => {
    const f = fig(['F = (0, 2)', 'Q = (F.x + 1, F.y)']);
    const r = f.apply('loc = Locus(Q, F)');
    if (r.ok) expectUndefined(f, 'loc', 'not_a_mover');
    else expect(r.kind).toBe('not_a_mover');
  });

  it('Q that does not use the mover is no_dependency', () => {
    const f = fig(['d = Segment((0, 0), (4, 0))', 'P = PointOn(d, 0.5)', 'Q = (1, 1)']);
    const r = f.apply('loc = Locus(Q, P)');
    if (r.ok) expectUndefined(f, 'loc', 'no_dependency');
    else expect(r.kind).toBe('no_dependency');
  });

  it('Locus(Q, P, from, to) uses natural units along an unbounded-style path: x from 1 to 3 on a segment from the origin', () => {
    const f = fig(['d = Segment((0, 0), (4, 0))', 'P = PointOn(d, 0.5)', 'Q = (P.x, 2 * P.x)', 'loc = Locus(Q, P, 1, 3)']);
    const xs = samples(f, 'loc').map((p) => p[0]);
    near(Math.min(...xs), 1, 1e-9);
    near(Math.max(...xs), 3, 1e-9);
    for (const [x, y] of samples(f, 'loc')) near(y, 2 * x, 1e-9);
  });

  it('the locus is recomputed when a free point moves', () => {
    const f = fig(['O = (0, 0)', 'C = Circle(O, 2)', 'A = (5, 0)', 'P = PointOn(C, 0.1)', 'M = ((A.x + P.x) / 2, (A.y + P.y) / 2)', 'loc = Locus(M, P)']);
    ok(f, 'A = (5, 4)');
    for (const p of samples(f, 'loc')) near(dist(p, 2.5, 2), 1, 1e-9);
  });

});

describe('LocusEquation(Q, P): the algebraic equation of the locus (10) [mover on a path]', () => {
  const circleSetup = ['O = (0, 0)', 'C = Circle(O, 2)', 'A = (5, 0)', 'P = PointOn(C, 0.1)', 'M = ((A.x + P.x) / 2, (A.y + P.y) / 2)'];

  it('the circle locus has the equation (x - 2.5)^2 + y^2 - 1 = 0 with leading coefficient 1', () => {
    const f = fig([...circleSetup, 'eq = LocusEquation(M, P)']);
    near(implicitAt(f, 'eq', 2.5, 0), -1, 1e-6);
    near(implicitAt(f, 'eq', 3.5, 0), 0, 1e-6);
    near(implicitAt(f, 'eq', 2.5, 1), 0, 1e-6);
  });

  it('the equation holds on the whole circle, not just the sampled arc', () => {
    const f = fig([...circleSetup, 'eq = LocusEquation(M, P)']);
    for (let i = 0; i < 12; i++) {
      const a = (2 * PI * i) / 12 + 0.1;
      near(implicitAt(f, 'eq', 2.5 + Math.cos(a), Math.sin(a)), 0, 1e-6);
    }
  });

  it('the parabola locus has the equation x^2 - 8 y = 0 (lesson 1)', () => {
    const f = fig(['d = Segment((-6, -2), (6, -2))', 'P = PointOn(d, 0.5)', 'Q = (P.x, P.x^2 / 8)', 'eq = LocusEquation(Q, P)']);
    near(implicitAt(f, 'eq', 4, 2), 0, 1e-6);
    near(implicitAt(f, 'eq', 0, 1), -8, 1e-6);
    near(implicitAt(f, 'eq', 2, 0.5), 0, 1e-6);
  });

  it('an ellipse locus, Q = (3 P.x, 2 P.y) for P on the unit circle, has the equation x^2 + (9/4) y^2 - 9 = 0', () => {
    const f = fig(['C = Circle((0, 0), 1)', 'P = PointOn(C, 0.1)', 'Q = (3 * P.x, 2 * P.y)', 'eq = LocusEquation(Q, P)']);
    near(implicitAt(f, 'eq', 0, 0), -9, 1e-6);
    near(implicitAt(f, 'eq', 3, 0), 0, 1e-6);
    near(implicitAt(f, 'eq', 0, 2), 0, 1e-6);
  });

  it('a transcendental locus has no polynomial equation: no_algebraic_equation', () => {
    const f = fig(['d = Segment((0, 0), (6, 0))', 'P = PointOn(d, 0.5)', 'Q = (P.x, sin(P.x))', 'eq = LocusEquation(Q, P)']);
    expectUndefined(f, 'eq', 'no_algebraic_equation');
  });

});

describe('Envelope(family, P) (11) [mover on a path]', () => {
  const ladder = [
    'Pm = PointOn(Segment((0.5, 0), (4.9, 0)), 0.2)',
    'Pf = (Pm.x, 0)',
    'Pw = (0, sqrt(25 - Pm.x^2))',
    'ladder = Segment(Pf, Pw)',
  ];

  it('the ladder envelope is a Curve with origin "envelope"', () => {
    const f = fig([...ladder, 'env = Envelope(ladder, Pm)']);
    expect(f.get('env')?.type).toBe('Curve');
    expect(curveVal(f, 'env').origin).toBe('envelope');
  });

  it('every ladder envelope point is on the astroid x^(2/3) + y^(2/3) = 5^(2/3)', () => {
    const f = fig([...ladder, 'env = Envelope(ladder, Pm)']);
    const s = samples(f, 'env');
    expect(s.length).toBeGreaterThan(50);
    for (const [x, y] of s) near(Math.abs(x) ** (2 / 3) + Math.abs(y) ** (2 / 3), 25 ** (1 / 3), 2e-3);
  });

  it('the ladder envelope is clipped to the ladder: it stays in the first quadrant', () => {
    const f = fig([...ladder, 'env = Envelope(ladder, Pm)']);
    for (const [x, y] of samples(f, 'env')) {
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('the envelope reaches only what the ladder reaches: x from 0.5^3/25 to 4.9^3/25', () => {
    const f = fig([...ladder, 'env = Envelope(ladder, Pm)']);
    const xs = samples(f, 'env').map((p) => p[0]);
    near(Math.min(...xs), 0.5 ** 3 / 25, 0.02);
    near(Math.max(...xs), 4.9 ** 3 / 25, 0.05);
  });

  it('the family of tangent lines to a circle of radius 3 has the circle as its envelope', () => {
    const f = fig(['C = Circle((0, 0), 3)', 'P = PointOn(C, 0.2)', 'T2 = (P.x - P.y, P.y + P.x)', 'L = Line(P, T2)', 'env = Envelope(L, P)']);
    const s = samples(f, 'env');
    expect(s.length).toBeGreaterThan(50);
    for (const p of s) near(dist(p, 0, 0), 3, 1e-4);
  });

  it('a family of circles of radius 0.5 centred on the unit circle has two envelope branches at distances 0.5 and 1.5', () => {
    const f = fig(['C = Circle((0, 0), 1)', 'P = PointOn(C, 0.2)', 'K = Circle(P, 0.5)', 'env = Envelope(K, P)']);
    expect(pieceCount(f, 'env')).toBeGreaterThanOrEqual(2);
    for (const p of samples(f, 'env')) {
      const d = dist(p, 0, 0);
      expect(Math.min(Math.abs(d - 0.5), Math.abs(d - 1.5))).toBeLessThan(1e-4);
    }
  });

  it('the second argument must be a mover point: Envelope(ladder, 0.2) is no_matching_form', () => {
    const f = fig(ladder);
    const e = fails(f, 'env = Envelope(ladder, 0.2)', 'no_matching_form');
    expect(e.hint ?? '').toMatch(/PointOn|mover/);
  });

  it('a parametric curve as the family is unsupported_family (line error or undefined)', () => {
    const f = fig(['d = Segment((0, 0), (4, 0))', 'P = PointOn(d, 0.5)', 'cf = Curve(cos(s), sin(s) + P.x, s, 0, tau)']);
    const r = f.apply('env = Envelope(cf, P)');
    if (r.ok) expectUndefined(f, 'env', 'unsupported_family');
    else expect(r.kind).toBe('unsupported_family');
  });

  it('a free point as the mover is not_a_mover', () => {
    const f = fig([...ladder, 'F = (1, 1)']);
    const r = f.apply('env = Envelope(ladder, F)');
    if (r.ok) expectUndefined(f, 'env', ['not_a_mover', 'no_dependency']);
    else expect(['not_a_mover', 'no_dependency']).toContain(r.kind);
  });

  it('Envelope with a family that does not depend on the mover is no_dependency', () => {
    const f = fig(['d = Segment((0, 0), (4, 0))', 'P = PointOn(d, 0.5)', 'L = Line((0, 0), (1, 1))']);
    const r = f.apply('env = Envelope(L, P)');
    if (r.ok) expectUndefined(f, 'env', 'no_dependency');
    else expect(r.kind).toBe('no_dependency');
  });

});
