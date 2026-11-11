/**
 * Contracts: budget constants, validated views, pixel helpers, level of detail.
 *
 * Docs: `docs/design/performance.md` section 5 (4,000 curve samples, level of
 * detail follows screen size), `docs/features/functions-calculus/design.md`
 * section 9 (0.25px bend, 8px chord, depth 14, 20,000 hard-case evals),
 * `docs/features/curves-loci/design.md` section 5 (12-degree turn),
 * `packages/plot/src/contracts.ts` (hard caps, grid-tracer defaults, the
 * PlotView scales and device-pixel sampling density).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_EVALS_FUNCTION,
  DEFAULT_MAX_EVALS_IMPLICIT,
  DEFAULT_MAX_EVALS_PARAM,
  DEFAULT_MAX_EVALS_REGION,
  HARD_MAX_EVALS,
  HARD_MAX_SAMPLES,
  MAX_SAMPLES_PER_CURVE,
  MAX_VIEW_AREA_PX,
  MAX_VIEW_SIDE_PX,
  REFINE_BEND_PX,
  REFINE_CHORD_PX,
  REFINE_MAX_DEPTH,
  REFINE_TURN_DEGREES,
  createView,
  plotFunction,
  pointToChordPx,
  turnDegrees,
} from '@incantly/plot';
import { TIMEOUT, VIEW, expectOk, fn1 } from './helpers';

describe('performance§5 + FC9 + CL5: the budget and threshold constants', () => {
  it('MAX_SAMPLES_PER_CURVE is 4,000 per curve on screen', () => {
    expect(MAX_SAMPLES_PER_CURVE).toBe(4000);
  }, TIMEOUT);

  it('REFINE_BEND_PX is 0.25px', () => {
    expect(REFINE_BEND_PX).toBe(0.25);
  }, TIMEOUT);

  it('REFINE_CHORD_PX is 8px', () => {
    expect(REFINE_CHORD_PX).toBe(8);
  }, TIMEOUT);

  it('REFINE_TURN_DEGREES is 12 degrees', () => {
    expect(REFINE_TURN_DEGREES).toBe(12);
  }, TIMEOUT);

  it('REFINE_MAX_DEPTH is 14', () => {
    expect(REFINE_MAX_DEPTH).toBe(14);
  }, TIMEOUT);

  it('DEFAULT_MAX_EVALS_FUNCTION is 20,000 (a hard curve)', () => {
    expect(DEFAULT_MAX_EVALS_FUNCTION).toBe(20000);
  }, TIMEOUT);

  it('DEFAULT_MAX_EVALS_PARAM is 20,000', () => {
    expect(DEFAULT_MAX_EVALS_PARAM).toBe(20000);
  }, TIMEOUT);

  it('DEFAULT_MAX_EVALS_IMPLICIT is 200,000', () => {
    expect(DEFAULT_MAX_EVALS_IMPLICIT).toBe(200000);
  }, TIMEOUT);

  it('DEFAULT_MAX_EVALS_REGION is 200,000', () => {
    expect(DEFAULT_MAX_EVALS_REGION).toBe(200000);
  }, TIMEOUT);

  it('HARD_MAX_SAMPLES is 65,536', () => {
    expect(HARD_MAX_SAMPLES).toBe(65536);
  }, TIMEOUT);

  it('HARD_MAX_EVALS is 10,000,000', () => {
    expect(HARD_MAX_EVALS).toBe(10000000);
  }, TIMEOUT);

  it('MAX_VIEW_SIDE_PX is 16,384', () => {
    expect(MAX_VIEW_SIDE_PX).toBe(16384);
  }, TIMEOUT);

  it('MAX_VIEW_AREA_PX is 16,777,216', () => {
    expect(MAX_VIEW_AREA_PX).toBe(16777216);
  }, TIMEOUT);
});

describe('contracts: createView derives scales and mapping helpers', () => {
  it('a valid view checks out with its box echoed', () => {
    const v = expectOk(createView(VIEW));
    expect(v.box.x0).toBe(VIEW.x0);
    expect(v.box.x1).toBe(VIEW.x1);
    expect(v.box.y0).toBe(VIEW.y0);
    expect(v.box.y1).toBe(VIEW.y1);
    expect(v.box.widthPx).toBe(VIEW.widthPx);
    expect(v.box.heightPx).toBe(VIEW.heightPx);
    expect(v.dpr).toBe(1);
  }, TIMEOUT);

  it('scales are device pixels per unit and back', () => {
    const v = expectOk(createView(VIEW));
    expect(v.sx).toBe(80);
    expect(v.sy).toBe(60);
    expect(v.dx).toBeCloseTo(1 / 80, 12);
    expect(v.dy).toBeCloseTo(1 / 60, 12);
    expect(v.widthEff).toBe(800);
    expect(v.heightEff).toBe(600);
  }, TIMEOUT);

  it('pixels map maths x right and maths y down, invertibly', () => {
    const v = expectOk(createView(VIEW));
    expect(v.toPx(-5)).toBe(0);
    expect(v.toPx(5)).toBe(800);
    expect(v.toPy(5)).toBe(0);
    expect(v.toPy(-5)).toBe(600);
    expect(v.toX(0)).toBe(-5);
    expect(v.toY(0)).toBe(5);
    for (const x of [-4.2, 0, 1.7]) expect(Math.abs(v.toX(v.toPx(x)) - x) < 1e-12).toBe(true);
    for (const y of [-4.2, 0, 1.7]) expect(Math.abs(v.toY(v.toPy(y)) - y) < 1e-12).toBe(true);
  }, TIMEOUT);

  it('devicePixelRatio 2 doubles the effective density', () => {
    const v = expectOk(createView({ ...VIEW, devicePixelRatio: 2 }));
    expect(v.dpr).toBe(2);
    expect(v.widthEff).toBe(1600);
    expect(v.heightEff).toBe(1200);
    expect(v.sx).toBe(160);
    expect(v.sy).toBe(120);
  }, TIMEOUT);

  it('mapping stays in CSS pixels at any dpr', () => {
    const a = expectOk(createView(VIEW));
    const b = expectOk(createView({ ...VIEW, devicePixelRatio: 2 }));
    for (const x of [-5, 0, 5]) expect(b.toPx(x)).toBe(a.toPx(x));
    for (const y of [-5, 0, 5]) expect(b.toPy(y)).toBe(a.toPy(y));
  }, TIMEOUT);

  it('a 1px view still checks out', () => {
    const v = expectOk(createView({ x0: 0, x1: 1, y0: 0, y1: 1, widthPx: 1, heightPx: 1 }));
    expect(v.sx).toBe(1);
  }, TIMEOUT);

  it.each([[0], [-1], [Number.NaN]])('a dpr of %s is refused with bad_argument', (devicePixelRatio) => {
    const r = createView({ ...VIEW, devicePixelRatio });
    if (r.ok) throw new Error(`dpr ${String(devicePixelRatio)} was accepted`);
    expect(r.kind).toBe('bad_argument');
  }, TIMEOUT);
});

describe('contracts: the pixel geometry helpers', () => {
  it('pointToChordPx is 0 on the chord', () => {
    expect(pointToChordPx(1, 0, 0, 0, 2, 0)).toBe(0);
  }, TIMEOUT);

  it('pointToChordPx measures height (3-4-5)', () => {
    expect(pointToChordPx(0, 3, 0, 0, 4, 0)).toBeCloseTo(3, 12);
  }, TIMEOUT);

  it('turnDegrees is 0 when straight', () => {
    expect(turnDegrees(0, 0, 1, 0, 2, 0)).toBe(0);
  }, TIMEOUT);

  it('turnDegrees is 90 at a right angle', () => {
    expect(turnDegrees(0, 0, 1, 0, 1, 1)).toBeCloseTo(90, 12);
  }, TIMEOUT);

  it('turnDegrees is 180 on reversal', () => {
    expect(turnDegrees(0, 0, 1, 0, 0, 0)).toBeCloseTo(180, 12);
  }, TIMEOUT);

  it('turnDegrees is 135 on a diagonal turn', () => {
    expect(turnDegrees(1, 0, 0, 0, 1, 1)).toBeCloseTo(135, 12);
  }, TIMEOUT);
});

describe('performance§5.3: sampling follows screen size (level of detail)', () => {
  it('the same shape in pixels costs the same work at any zoom', () => {
    const wide = expectOk(plotFunction(fn1('sin(x)'), VIEW));
    const zoomed = expectOk(plotFunction(fn1('sin(10*x)'), { x0: -0.5, x1: 0.5, y0: -5, y1: 5, widthPx: 800, heightPx: 600 }));
    const ratio = zoomed.stats.evals / wide.stats.evals;
    expect(ratio > 0.5 && ratio < 2, `eval ratio ${ratio}`).toBe(true);
  }, TIMEOUT);

  it('fewer pixels draw fewer points on the same curve', () => {
    const small = expectOk(plotFunction(fn1('sin(x) + x^2/10'), { ...VIEW, widthPx: 400 }));
    const big = expectOk(plotFunction(fn1('sin(x) + x^2/10'), VIEW));
    expect(small.stats.samples).toBeLessThan(big.stats.samples);
  }, TIMEOUT);
});
