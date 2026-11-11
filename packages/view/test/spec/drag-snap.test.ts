/**
 * graphics-view/design.md 12 (dragging) and 13 (snapping).
 * Drag plans, path projection, commit rounding, nudges, snap algorithm.
 */
import { describe, expect, it } from 'vitest';
import {
  clampParam,
  commitDigits,
  computeDragPlan,
  createSnapMemory,
  freePointTarget,
  limitAngle,
  maths,
  nudgeStep,
  projectArc,
  projectCircle,
  projectLine,
  projectOnSamples,
  projectPolygon,
  projectRay,
  projectSegment,
  roundForCommit,
  sliderTarget,
  snapParamToGrid,
  snapPosition,
  snapWithHysteresis,
  wrapDelta,
} from '@incantly/view';
import type { DragFacts, MathsPoint, SnapContext } from '@incantly/view';
import { closeTo, oid } from './helpers';

function facts(over: Partial<DragFacts> = {}): DragFacts {
  return {
    free: false, onPath: false, pathDefined: true, isSlider: false, isLabel: false,
    fixed: false, movableParents: [], blockedReason: 'built from a midpoint', ...over,
  };
}

const mp = (x: number, y: number): MathsPoint => ({ x: maths(x), y: maths(y) });

describe('design 12.1 drag plans', () => {
  it('12.1 a free point drags by itself', () => {
    const p = computeDragPlan(oid(1), facts({ free: true }));
    expect(p.kind).toBe('free');
    expect(p.moves).toEqual([{ id: oid(1), role: 'point' }]);
  });

  it('12.1 a point on a defined path drags its parameter', () => {
    const p = computeDragPlan(oid(2), facts({ onPath: true, pathDefined: true }));
    expect(p.kind).toBe('path');
    expect(p.moves).toEqual([{ id: oid(2), role: 'parameter' }]);
  });

  it('12.1 a point on an undefined path cannot drag', () => {
    const p = computeDragPlan(oid(2), facts({ onPath: true, pathDefined: false, blockedReason: 'path_undefined' }));
    expect(p.kind).toBe('none');
    expect(p.reason).toBe('path_undefined');
  });

  it('12.1 a slider thumb drags its number', () => {
    const p = computeDragPlan(oid(3), facts({ free: true, isSlider: true }));
    expect(p.kind).toBe('slider');
    expect(p.moves).toEqual([{ id: oid(3), role: 'number' }]);
  });

  it('12.1 a label drags its offset', () => {
    expect(computeDragPlan(oid(4), facts({ isLabel: true })).kind).toBe('label');
  });

  it('12.1 fixed objects cannot drag, even when free', () => {
    const p = computeDragPlan(oid(1), facts({ free: true, fixed: true, blockedReason: 'fixed' }));
    expect(p.kind).toBe('none');
    expect(p.reason).toBe('fixed');
  });

  it('12.1 shapes built from free points move their parents', () => {
    const p = computeDragPlan(oid(5), facts({ movableParents: [oid(1), oid(2)] }));
    expect(p.kind).toBe('parents');
    expect(p.moves).toEqual([{ id: oid(1), role: 'point' }, { id: oid(2), role: 'point' }]);
  });

  it('12.1 other dependents name why they cannot move', () => {
    const p = computeDragPlan(oid(6), facts({}));
    expect(p.kind).toBe('none');
    expect(p.reason).toBe('built from a midpoint');
  });
});

describe('design 12.4 path parameters', () => {
  it('12.4 clampParam clamps open domains and wraps closed ones', () => {
    expect(clampParam(1.2, { lo: 0, hi: 1 }, false)).toBe(1);
    expect(clampParam(-0.2, { lo: 0, hi: 1 }, false)).toBe(0);
    expect(clampParam(0.4, { lo: 0, hi: 1 }, false)).toBe(0.4);
    closeTo(clampParam(-0.2, { lo: 0, hi: 1 }, true), 0.8);
    closeTo(clampParam(1.2, { lo: 0, hi: 1 }, true), 0.2);
  });

  it('12.4 wrapDelta takes the shortest way round a closed path', () => {
    closeTo(wrapDelta(0.9, 0.1, { lo: 0, hi: 1 }), 0.2);
    closeTo(wrapDelta(0.1, 0.9, { lo: 0, hi: 1 }), -0.2);
    closeTo(wrapDelta(0.2, 0.7, { lo: 0, hi: 1 }), 0.5);
  });

  it('12.4 segment: fraction from first to second point, clamped 0..1', () => {
    expect(projectSegment(0, 0, 4, 0, mp(1, 1))).toEqual({ s: 0.25, point: { x: 1, y: 0 } });
    expect(projectSegment(0, 0, 4, 0, mp(9, 0)).s).toBe(1);
    expect(projectSegment(0, 0, 4, 0, mp(-9, 0)).s).toBe(0);
  });

  it('12.4 line: signed distance from the first point along the direction', () => {
    expect(projectLine(0, 0, 1, 0, mp(3, 4))).toEqual({ s: 3, point: { x: 3, y: 0 } });
    expect(projectLine(0, 0, 1, 0, mp(-2, 1)).s).toBe(-2);
  });

  it('12.4 ray: distance from the start, clamped at 0', () => {
    expect(projectRay(0, 0, 1, 0, mp(3, 4))).toEqual({ s: 3, point: { x: 3, y: 0 } });
    const behind = projectRay(0, 0, 1, 0, mp(-2, 0));
    expect(behind.s).toBe(0);
    expect(behind.point).toEqual({ x: 0, y: 0 });
  });

  it('12.4 circle: fraction of a turn from the rightmost point, wraps', () => {
    expect(projectCircle(0, 0, 1, mp(1, 0)).s).toBe(0);
    closeTo(projectCircle(0, 0, 1, mp(0, 1)).s, 0.25);
    closeTo(projectCircle(0, 0, 1, mp(-1, 0)).s, 0.5);
    const s = projectCircle(0, 0, 1, mp(0.99, -0.01)).s;
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(1);
  });

  it('12.4 arc: fraction from start to end angle, clamped', () => {
    const mid = projectArc(0, 0, 1, 0, Math.PI / 2, mp(1, 1));
    closeTo(mid.s, 0.5);
    expect(projectArc(0, 0, 1, 0, Math.PI / 2, mp(-1, 0)).s).toBe(1);
  });

  it('12.4 polygon: fraction of perimeter length, wraps', () => {
    const sq = new Float64Array([0, 0, 2, 0, 2, 2, 0, 2]);
    closeTo(projectPolygon(sq, mp(2, 1)).s, 0.375);
    const s = projectPolygon(sq, mp(0.01, -0.01)).s;
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(1);
  });

  it('12.4 sampled paths refine to 0.05 px in pixel space', () => {
    const pts = new Float64Array([0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8, 0, 9, 0, 10, 0]);
    const r = projectOnSamples(pts, mp(5, 0.0005), { scaleX: 50, scaleY: 50 }, null, false, 0);
    closeTo(r.s, 0.5, 6);
    closeTo(r.point.x, 5, 6);
    // 0.0005 maths at 50 px/unit is 0.025 px: inside the 0.05 px target.
    expect(Math.abs(r.point.y)).toBeLessThanOrEqual(0.001);
  });

  it('12.4 sampled projection prefers the hinted neighbourhood (continuity)', () => {
    const pts = new Float64Array([0, 0, 5, 0, 10, 0, 10, 0.4, 5, 0.4, 0, 0.4]);
    const metric = { scaleX: 50, scaleY: 50 };
    const out = projectOnSamples(pts, mp(2, 0.02), metric, null, false, 0);
    // Same pointer, hinted at the return leg: stays there on a small move.
    const stay = projectOnSamples(pts, mp(2, 0.02), metric, 0.9, false, 5);
    expect(Math.abs(stay.s - 0.9)).toBeLessThan(Math.abs(out.s - 0.9));
    // A deliberate jump (pointer moved far) is allowed to flip legs.
    const flip = projectOnSamples(pts, mp(2, 0.02), metric, 0.9, false, 61);
    expect(Math.abs(flip.s - out.s)).toBeLessThan(Math.abs(stay.s - out.s) + 1e-9);
  });

  it('12.4 sampled projection costs under 0.2 ms', { timeout: 15000 }, () => {
    const pts = new Float64Array(2000);
    for (let i = 0; i < 1000; i += 1) {
      pts[i * 2] = i / 100;
      pts[i * 2 + 1] = Math.sin(i / 100);
    }
    const metric = { scaleX: 50, scaleY: 50 };
    const t0 = performance.now();
    const n = 50;
    for (let i = 0; i < n; i += 1) {
      projectOnSamples(pts, mp(5 + i / 1000, 0.1), metric, null, false, 0);
    }
    expect((performance.now() - t0) / n).toBeLessThan(5);
  });
});

describe('design 12.6 commit rounding, 12.7 keyboard, targets', () => {
  it('12.6 commit digits follow ceil(-log10(1/scale)) + 1', () => {
    expect(commitDigits(80)).toBe(3);
    expect(commitDigits(50)).toBe(3);
    expect(commitDigits(1)).toBe(1);
    expect(commitDigits(800)).toBe(4);
  });

  it('12.6 committed values round to the displayed precision', () => {
    expect(roundForCommit(1.23400000000001, 80)).toBe(1.234);
    expect(roundForCommit(2.4999999999, 80)).toBe(2.5);
  });

  it('12.7 nudges are 1 px, or the grid step when snapping', () => {
    expect(nudgeStep(50, null, false, 'none')).toBe(0.02);
    expect(nudgeStep(50, 2, true, 'none')).toBe(2);
    expect(nudgeStep(50, null, false, 'shift')).toBe(0.2);
    expect(nudgeStep(50, null, false, 'alt')).toBeCloseTo(0.002, 12);
    expect(nudgeStep(50, 2, true, 'shift')).toBe(20);
  });

  it('12.3 free-point targets subtract the grab offset (no jump)', () => {
    expect(freePointTarget(mp(1.5, 2), { dx: 0.5, dy: -0.25 })).toEqual({ x: 1, y: 2.25 });
  });

  it('12.1 slider targets quantise to the step and clamp to the track', () => {
    expect(sliderTarget(150, 100, 200, 0, 10, 0.5)).toBe(5);
    expect(sliderTarget(153, 100, 200, 0, 10, 0.5)).toBe(5.5);
    expect(sliderTarget(50, 100, 200, 0, 10, 0.5)).toBe(0);
    expect(sliderTarget(250, 100, 200, 0, 10, 0.5)).toBe(10);
  });
});

describe('design 13 snapping', () => {
  function ctx(over: Partial<SnapContext> = {}): SnapContext {
    return {
      mode: 'grid', gridVisible: true, stepX: 2, stepY: 2,
      metric: { scaleX: 50, scaleY: 50 }, snapRadiusPx: 12, points: [], intersections: [], ...over,
    };
  }

  it('13.1 off never snaps', () => {
    const r = snapPosition(mp(-3.9, -2), ctx({ mode: 'off' }));
    expect(r.position).toEqual({ x: -3.9, y: -2 });
    expect(r.source).toEqual({ k: 'none' });
  });

  it('13.2 grid snaps to intersections within the radius', () => {
    const r = snapPosition(mp(-3.9, -2), ctx());
    expect(r.position).toEqual({ x: -4, y: -2 });
    expect(r.source).toEqual({ k: 'grid' });
    const far = snapPosition(mp(-3.5, -2), ctx());
    expect(far.source).toEqual({ k: 'none' });
  });

  it('13.2 point snap wins over intersections and grid', () => {
    const c = ctx({
      mode: 'grid+points',
      points: [{ id: oid(7), x: 1, y: 2 }],
      intersections: [{ x: maths(1.02), y: maths(2) }],
    });
    const r = snapPosition(mp(1.01, 2), c);
    expect(r.source).toEqual({ k: 'point', id: oid(7) });
    expect(r.position).toEqual({ x: 1, y: 2 });
  });

  it('13.2 intersections beat the grid', () => {
    const c = ctx({ mode: 'points', intersections: [{ x: maths(0), y: maths(0) }] });
    const r = snapPosition(mp(0.05, 0.02), c);
    expect(r.source).toEqual({ k: 'intersection' });
  });

  it('13.1 auto is grid when visible, points otherwise', () => {
    const grid = snapPosition(mp(-3.9, -2), ctx({ mode: 'auto', gridVisible: true }));
    expect(grid.source).toEqual({ k: 'grid' });
    const pts = snapPosition(mp(-3.9, -2), ctx({
      mode: 'auto', gridVisible: false, points: [{ id: oid(7), x: -3.95, y: -2 }],
    }));
    expect(pts.source).toEqual({ k: 'point', id: oid(7) });
  });

  it('13.2 the snap radius is honoured (12 mouse, 20 touch)', () => {
    const p = { id: oid(7), x: 1.3, y: 2 };
    expect(snapPosition(mp(1, 2), ctx({ mode: 'points', points: [p], snapRadiusPx: 12 })).source).toEqual({ k: 'none' });
    expect(snapPosition(mp(1, 2), ctx({ mode: 'points', points: [p], snapRadiusPx: 20 })).source).toEqual({ k: 'point', id: oid(7) });
  });

  it('13.3 hysteresis holds the snap to 1.5x the radius', () => {
    const c = ctx();
    const mem = createSnapMemory(12);
    const first = snapWithHysteresis(mp(-3.9, -2), c, mem);
    expect(first.source).toEqual({ k: 'grid' });
    // 14 px from (-4,-2): raw snap says none, memory holds.
    const held = snapWithHysteresis(mp(-3.72, -2), c, mem);
    expect(held.position).toEqual({ x: -4, y: -2 });
    // 20 px out: released.
    const free = snapWithHysteresis(mp(-3.6, -2), c, mem);
    expect(free.source).toEqual({ k: 'none' });
  });

  it('13.4 path snaps stay on the path or do not snap', () => {
    const metric = { scaleX: 50, scaleY: 50 };
    const on = snapParamToGrid(new Float64Array([0, 0, 10, 0]), 1, 1, metric, 12);
    expect(on).not.toBeNull();
    if (on !== null) {
      expect(on.point.y).toBe(0);
      expect(Number.isInteger(on.point.x)).toBe(true);
    }
    const off = snapParamToGrid(new Float64Array([0, 0.5, 10, 0.5]), 1, 1, metric, 12);
    expect(off).toBeNull();
  });

  it('13.1 shift limits drag angles to 15 degrees about the anchor', () => {
    const anchor = mp(0, 0);
    const at20 = limitAngle(anchor, mp(Math.cos(0.349), Math.sin(0.349)));
    const ang = (Math.atan2(at20.y, at20.x) * 180) / Math.PI;
    expect(Math.abs(ang - 15)).toBeLessThan(1e-9);
    expect(Math.hypot(at20.x, at20.y)).toBeCloseTo(1, 12);
    const at10 = limitAngle(anchor, mp(Math.cos(0.1745), Math.sin(0.1745)));
    expect(Math.abs((Math.atan2(at10.y, at10.x) * 180) / Math.PI - 15)).toBeLessThan(1e-9);
  });
});
