/**
 * graphics-view/design.md 5 (grid and axes): spacing, ticks, labels,
 * polar and isometric grids. Pure functions over numbers.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AXES,
  DEFAULT_GRID,
  GRID_MAX_PX,
  GRID_MIN_PX,
  GRID_TARGET_PX,
  axisLabels,
  cartesianGrid,
  chooseStep,
  formatTick,
  isoGrid,
  m,
  pinToEdge,
  polarGrid,
  thinLabels,
  tickPositions,
} from '@incantly/view';
import { closeTo } from './helpers';
import type { AxisUnit } from '@incantly/view';

const unit: AxisUnit = { k: 'unit' };
const piUnit: AxisUnit = { k: 'pi' };

describe('design 5 grid and axes', () => {
  it('5 spacing targets: about 80 px, within [45, 160]', () => {
    expect(GRID_TARGET_PX).toBe(80);
    expect(GRID_MIN_PX).toBe(45);
    expect(GRID_MAX_PX).toBe(160);
  });

  it('5 default grid kind is major with automatic step', () => {
    expect(DEFAULT_GRID.kind).toBe('major');
    expect(DEFAULT_GRID.step).toBeNull();
  });

  it('5 default axis units are linear (log axes are later, 5.5)', () => {
    expect(DEFAULT_AXES.unitX).toEqual({ k: 'unit' });
    expect(DEFAULT_AXES.unitY).toEqual({ k: 'unit' });
  });

  it('5 step follows the 1-2-5 ladder from 80/scale', () => {
    expect(chooseStep(80, unit, null, null).step).toBe(1);
    expect(chooseStep(50, unit, null, null).step).toBe(2);
    expect(chooseStep(800, unit, null, null).step).toBe(0.1);
    expect(chooseStep(8, unit, null, null).step).toBe(10);
  });

  it('5 ladder boundaries: m<1.5 -> 1, <3.5 -> 2, <7.5 -> 5, else 10', () => {
    // raw = 80/scale; pick scales for exact raws.
    expect(chooseStep(80 / 1.4, unit, null, null).step).toBe(1);
    expect(chooseStep(80 / 1.6, unit, null, null).step).toBe(2);
    expect(chooseStep(80 / 3.4, unit, null, null).step).toBe(2);
    expect(chooseStep(80 / 3.6, unit, null, null).step).toBe(5);
    expect(chooseStep(80 / 7.4, unit, null, null).step).toBe(5);
    expect(chooseStep(80 / 7.6, unit, null, null).step).toBe(10);
  });

  it('5 minor sub-intervals: 5 for steps beginning 1 or 5, 4 for 2', () => {
    expect(chooseStep(80, unit, null, null).minor).toBe(5);
    expect(chooseStep(50, unit, null, null).minor).toBe(4);
    expect(chooseStep(80 / 3.6, unit, null, null).minor).toBe(5);
    expect(chooseStep(8, unit, null, null).minor).toBe(5);
  });

  it('5 hysteresis: a previous step inside [45,160] px is kept', () => {
    expect(chooseStep(50, unit, 2, null).step).toBe(2);
    expect(chooseStep(60, unit, 2, null).step).toBe(2);
  });

  it('5 hysteresis: a previous step outside [45,160] px is recomputed', () => {
    const s = chooseStep(10, unit, 2, null).step;
    expect(s).not.toBe(2);
    expect(s * 10).toBeGreaterThanOrEqual(45);
    expect(s * 10).toBeLessThanOrEqual(160);
  });

  it('5 fixed @grid step spacing is used verbatim', () => {
    expect(chooseStep(50, unit, null, 0.5).step).toBe(0.5);
    expect(chooseStep(800, unit, 2, 0.5).step).toBe(0.5);
  });

  it('5 x and y steps are chosen separately (free ratio)', () => {
    expect(chooseStep(80, unit, null, null).step).toBe(1);
    expect(chooseStep(800, unit, null, null).step).toBe(0.1);
  });

  const PI_STEPS = [Math.PI / 6, Math.PI / 4, Math.PI / 3, Math.PI / 2, Math.PI, 2 * Math.PI, 4 * Math.PI, 8 * Math.PI];

  // Steps below pi/6 are not listed in the docs, so only the documented range (up to 200 px/unit) is checked.
  it.each([30, 50, 80, 120, 200])('5 pi-axis step at %d px/unit comes from pi/6, pi/4, pi/3, pi/2, pi, 2pi, ...', (scale) => {
    const s = chooseStep(scale, piUnit, null, null).step;
    expect(PI_STEPS.some((v) => Math.abs(v - s) < 1e-9)).toBe(true);
  });

  it('5 pi-axis step stays inside the 45..160 px band at 80 px/unit', () => {
    const s = chooseStep(80, piUnit, null, null).step;
    expect(s * 80).toBeGreaterThanOrEqual(45);
    expect(s * 80).toBeLessThanOrEqual(160);
  });

  it('5 pi-axis step closest to the 80 px target at 80 px/unit is pi/4 or pi/3', () => {
    const s = chooseStep(80, piUnit, null, null).step;
    expect([Math.PI / 4, Math.PI / 3].some((v) => Math.abs(v - s) < 1e-9)).toBe(true);
  });

  it('5 tickPositions lists the multiples of the step in range', () => {
    const norm = (xs: readonly number[]): number[] => xs.map((x) => (Object.is(x, -0) ? 0 : x));
    expect(norm(tickPositions(0, 2, 1))).toEqual([0, 1, 2]);
    expect(norm(tickPositions(-1.2, 1.2, 1))).toEqual([-1, 0, 1]);
    expect(tickPositions(0.2, 0.8, 1)).toEqual([]);
  });

  it('5 tick labels use the fewest distinguishing digits', () => {
    expect(formatTick(2, 1, false)).toBe('2');
    expect(formatTick(1.5, 0.5, false)).toBe('1.5');
    // digits = ceil(-log10(0.25)) = 1: neighbours still differ.
    expect(formatTick(2.25, 0.25, false)).toBe('2.3');
    expect(formatTick(2.5, 0.25, false)).toBe('2.5');
  });

  it('5 tick labels never print -0', () => {
    expect(formatTick(-0.0001, 0.5, false)).toBe('0');
    expect(formatTick(-0, 1, false)).toBe('0');
  });

  it('5 tick labels use 1e6 style above 1e6 or below 1e-4, no separators', () => {
    expect(formatTick(1500000, 100000, false)).toContain('e');
    expect(formatTick(0.00005, 0.00001, false)).toContain('e');
    expect(formatTick(1500, 100, false)).toBe('1500');
  });

  it('5 pi-axis labels show multiples of pi', () => {
    expect(formatTick(Math.PI, Math.PI, true)).toContain('π');
    expect(formatTick(0, Math.PI, true)).toBe('0');
  });

  it('5 one 0 at the corner: never an origin label on both axes', () => {
    const labels = axisLabels(
      { x0: -8 as never, x1: 8 as never, y0: -6 as never, y1: 6 as never }, 2, 2, unit, unit,
    );
    const zeros = [...labels.x, ...labels.y].filter((l) => l.text === '0');
    expect(zeros).toHaveLength(1);
    expect(labels.x.length).toBeGreaterThan(1);
    expect(labels.y.length).toBeGreaterThan(1);
  });

  it('5 overlapping tick labels drop every second one', () => {
    const three = [
      { at: 0, text: '0', widthPx: 50 },
      { at: 1, text: '1', widthPx: 50 },
      { at: 2, text: '2', widthPx: 50 },
    ];
    const kept = thinLabels(three);
    expect(kept.map((l) => l.text)).toEqual(['0', '2']);
  });

  it('5 non-overlapping tick labels are all kept', () => {
    const labels = [
      { at: 0, text: '0', widthPx: 10 },
      { at: 100, text: '100', widthPx: 10 },
    ];
    expect(thinLabels(labels)).toHaveLength(2);
  });

  it('5 labels near the edge pin to the canvas instead of vanishing', () => {
    expect(pinToEdge(400, 800, 40)).toEqual({ pos: 400, pinned: false });
    const lo = pinToEdge(5, 800, 40);
    expect(lo.pinned).toBe(true);
    expect(lo.pos).toBeGreaterThanOrEqual(40);
    const hi = pinToEdge(795, 800, 40);
    expect(hi.pinned).toBe(true);
    expect(hi.pos).toBeLessThanOrEqual(760);
  });

  it('5 cartesian grid lines sit on multiples of the step', () => {
    const g = cartesianGrid(
      { x0: -2 as never, x1: 2 as never, y0: -2 as never, y1: 2 as never },
      { step: 1, minor: 5 },
      { step: 1, minor: 5 },
      false,
    );
    expect(g.vertical).toEqual([-2, -1, 0, 1, 2]);
    expect(g.horizontal).toEqual([-2, -1, 0, 1, 2]);
    expect(g.minorVertical).toEqual([]);
    expect(g.minorHorizontal).toEqual([]);
  });

  it('5 minor grids add round sub-lines between the majors', () => {
    const g = cartesianGrid(
      { x0: -1 as never, x1: 1 as never, y0: -1 as never, y1: 1 as never },
      { step: 1, minor: 5 },
      { step: 1, minor: 5 },
      true,
    );
    expect(g.minorVertical.length).toBeGreaterThan(0);
    for (const x of g.minorVertical) {
      closeTo(x / 0.2, Math.round(x / 0.2), 9);
    }
    expect(g.minorVertical.some((x) => !Number.isInteger(x))).toBe(true);
  });

  it('5 polar grid: circles at the major step, spokes every 30 degrees', () => {
    const g = polarGrid({ x0: -5 as never, x1: 5 as never, y0: -5 as never, y1: 5 as never }, 1, 30);
    expect(g.circles[0]).toBe(1);
    for (let i = 1; i < g.circles.length; i += 1) {
      const prev = g.circles[i - 1] as number;
      const cur = g.circles[i] as number;
      expect(cur).toBeGreaterThan(prev);
    }
    const last = g.circles[g.circles.length - 1] as number;
    expect(last).toBeLessThanOrEqual(Math.hypot(5, 5) + 1);
    expect(g.spokes).toHaveLength(12);
  });

  it('5 polar spokes accept a custom angle', () => {
    const g = polarGrid({ x0: -5 as never, x1: 5 as never, y0: -5 as never, y1: 5 as never }, 1, 15);
    expect(g.spokes).toHaveLength(24);
  });

  it('5 isometric grid has three line families at the step spacing', () => {
    const g = isoGrid({ x0: -5 as never, x1: 5 as never, y0: -5 as never, y1: 5 as never }, 1);
    for (const fam of [g.offsets0, g.offsets60, g.offsets120] as const) {
      expect(fam.length).toBeGreaterThan(2);
      for (let i = 1; i < fam.length; i += 1) {
        const prev = fam[i - 1] as number;
        const cur = fam[i] as number;
        closeTo(cur - prev, 1, 6);
      }
    }
  });

  it('5 m() builds a maths point', () => {
    expect(m(1, 2)).toEqual({ x: 1, y: 2 });
  });
});
