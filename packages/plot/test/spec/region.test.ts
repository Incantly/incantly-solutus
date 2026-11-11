/**
 * Inequality filler (2D regions and 1D predicates).
 *
 * Docs: `docs/features/curves-loci/design.md` section 7 (quadtree fill with
 * maximal row-merged rectangles, single-primitive boundary polygons,
 * 4x4 corner supersampling, per-primitive borders kept only on the combined
 * boundary with strictness flags, isolated-point markers, 1D bands plus
 * axis intervals with edges bisected to 0.1px, time targets).
 * `Boundary`, `Area` and `PointIn` are kernel commands, not sampling; see
 * the test report.
 */
import { describe, expect, it } from 'vitest';
import { fillPredicate1D, fillRegion, predicateFromRelation } from '@incantly/plot';
import type { BoundaryInput, FieldEnclosure, PredicateEnclosure, PredicateInput } from '@incantly/plot';
import {
  HEAVY_TIMEOUT,
  TIMEOUT,
  VIEW_SQ,
  circleFieldEnc,
  discTri,
  expectFiniteMarkers,
  expectMarkerMapping,
  expectOk,
  halfTri,
  markersOf,
  outsideTri,
  pairs,
  polyAreaPx,
  pxOf,
  pyOf,
  rectsAreaPx,
  rel2,
  xOfPx,
  yOfPy,
} from './helpers';

const PX = 60; // VIEW_SQ pixels per maths unit.

// Margin 4 - x^2 - y^2 with an exact enclosure (inside the disc r = 2).
const discMarginEnc = (r: number): FieldEnclosure => (x0, x1, y0, y1) => {
  const f = circleFieldEnc(r)(x0, x1, y0, y1);
  return { lo: -f.hi, hi: -f.lo, def: 2 };
};

// Margin y - x with an exact enclosure (above the diagonal).
const diagMarginEnc: FieldEnclosure = (x0, x1, y0, y1) => ({ lo: y0 - x1, hi: y1 - x0, def: 2 });

// Exact tri-state of y > x over a box.
const diagTri = (strict: boolean): PredicateEnclosure => (x0, x1, y0, y1) => {
  const mlo = y0 - x1;
  const mhi = y1 - x0;
  if (strict) {
    if (mlo > 0) return 'true';
    if (mhi <= 0) return 'false';
    return 'maybe';
  }
  if (mlo >= 0) return 'true';
  if (mhi < 0) return 'false';
  return 'maybe';
};

const andTri = (a: PredicateEnclosure, b: PredicateEnclosure): PredicateEnclosure => (x0, x1, y0, y1) => {
  const ta = a(x0, x1, y0, y1);
  const tb = b(x0, x1, y0, y1);
  if (ta === 'false' || tb === 'false') return 'false';
  if (ta === 'true' && tb === 'true') return 'true';
  return 'maybe';
};

const totalFillPx = (rects: Float64Array, polys: readonly Float64Array[]): number => {
  let a = rectsAreaPx(rects);
  for (const poly of polys) a += polyAreaPx(poly);
  return a;
};

describe('CL7 predicateFromRelation: language relations become fillable predicates', () => {
  it('CL7: x^2 + y^2 <= 4 fills the disc', () => {
    const p = expectOk(fillRegion(expectOk(predicateFromRelation(rel2('x^2 + y^2 <= 4'))), VIEW_SQ));
    const want = 4 * Math.PI * PX * PX;
    expect(Math.abs(totalFillPx(p.rects, p.polygons) - want) / want < 0.05).toBe(true);
  }, HEAVY_TIMEOUT);

  it('CL7§3: a strict inequality draws strict (dashed) borders', () => {
    const p = expectOk(fillRegion(expectOk(predicateFromRelation(rel2('x^2 + y^2 < 4'))), VIEW_SQ));
    expect(p.borders.length).toBeGreaterThanOrEqual(1);
    for (const b of p.borders) expect(b.strict).toBe(true);
  }, HEAVY_TIMEOUT);

  it('CL7§3: a non-strict inequality draws solid borders', () => {
    const p = expectOk(fillRegion(expectOk(predicateFromRelation(rel2('x^2 + y^2 <= 4'))), VIEW_SQ));
    expect(p.borders.length).toBeGreaterThanOrEqual(1);
    for (const b of p.borders) expect(b.strict).toBe(false);
  }, HEAVY_TIMEOUT);

  it('CL7: x^2 + y^2 == 4 fills no area (zero-area curve)', () => {
    // The kernel's == test has a small tolerance, so boundary slivers may
    // appear as polygons; no full cell (rect) can be inside a zero-area set.
    const p = expectOk(fillRegion(expectOk(predicateFromRelation(rel2('x^2 + y^2 == 4'))), VIEW_SQ));
    expect(p.rects.length).toBe(0);
    expect(p.stats.complete).toBe(true);
  }, TIMEOUT);

  it('CL7: an exact == test fills nothing at all', () => {
    const p = expectOk(fillRegion({ test: (x, y) => x * x + y * y === 4 }, VIEW_SQ));
    expect(p.rects.length).toBe(0);
    expect(p.polygons).toEqual([]);
    expect(p.stats.complete).toBe(true);
  }, TIMEOUT);

  it('CL7: a chained ring fills the ring', () => {
    const p = expectOk(fillRegion(expectOk(predicateFromRelation(rel2('1 < x^2 + y^2 < 4'))), VIEW_SQ));
    const want = 3 * Math.PI * PX * PX;
    expect(Math.abs(totalFillPx(p.rects, p.polygons) - want) / want < 0.15).toBe(true);
    expect(p.borders.length).toBeGreaterThanOrEqual(1);
  }, HEAVY_TIMEOUT);

  it('CL7: and-filling shades the intersection', () => {
    const p = expectOk(fillRegion(expectOk(predicateFromRelation(rel2('x^2 + y^2 <= 4 and y > x'))), VIEW_SQ));
    const want = 2 * Math.PI * PX * PX;
    expect(Math.abs(totalFillPx(p.rects, p.polygons) - want) / want < 0.15).toBe(true);
  }, HEAVY_TIMEOUT);

  it('CL7: not-filling shades the complement', () => {
    const p = expectOk(fillRegion(expectOk(predicateFromRelation(rel2('not(x > 0)'))), VIEW_SQ));
    const want = 50 * PX * PX;
    expect(Math.abs(totalFillPx(p.rects, p.polygons) - want) / want < 0.05).toBe(true);
  }, HEAVY_TIMEOUT);
});

describe('CL7 step 1: true fills, false skips, maybe splits (certain path)', () => {
  const halfInput = (strict: boolean): PredicateInput => ({
    test: (x, _y) => (strict ? x > 0 : x >= 0),
    boundaries: [{ residual: (x, _y) => x, strict, enclosure: (x0, x1) => ({ lo: x0, hi: x1, def: 2 }) }],
    enclosure: halfTri(strict),
  });

  it('CL7§1: a half-plane fills its half to 2%', () => {
    const p = expectOk(fillRegion(halfInput(true), VIEW_SQ));
    const want = 50 * PX * PX;
    expect(Math.abs(totalFillPx(p.rects, p.polygons) - want) / want < 0.02).toBe(true);
  }, TIMEOUT);

  it('CL7§1: nothing fills outside a half-plane', () => {
    const p = expectOk(fillRegion(halfInput(true), VIEW_SQ));
    for (let i = 0; i + 3 < p.rects.length; i += 4) {
      expect(xOfPx(VIEW_SQ, p.rects[i + 2] ?? 0) > -0.1).toBe(true);
    }
    for (const poly of p.polygons) {
      for (const pt of pairs(poly)) expect(xOfPx(VIEW_SQ, pt.x) > -0.1).toBe(true);
    }
  }, TIMEOUT);

  it('CL7§1: maximal merging keeps a half-plane to a few rectangles', () => {
    const p = expectOk(fillRegion(halfInput(true), VIEW_SQ));
    expect(p.rects.length / 4).toBeLessThanOrEqual(100);
  }, TIMEOUT);

  it('CL7§1: a fully true view fills in one maximal rectangle', () => {
    const p = expectOk(fillRegion({ test: (_x, _y) => true, enclosure: (_x0, _x1, _y0, _y1) => 'true' }, VIEW_SQ));
    expect(p.rects.length / 4).toBe(1);
    expect(rectsAreaPx(p.rects)).toBe(100 * PX * PX);
    expect(p.stats.evals).toBeLessThanOrEqual(500);
  }, TIMEOUT);

  it('CL7§1: draft leaves are coarser and cheaper than final ones', () => {
    const input: PredicateInput = {
      test: (x, y) => x * x + y * y <= 4,
      boundaries: [{ residual: (x, y) => 4 - x * x - y * y, strict: false, enclosure: discMarginEnc(2) }],
      enclosure: discTri(2, false),
    };
    const draft = expectOk(fillRegion(input, VIEW_SQ, { quality: 'draft' }));
    const final = expectOk(fillRegion(input, VIEW_SQ, { quality: 'final' }));
    expect(draft.stats.evals).toBeLessThan(final.stats.evals);
    const want = 4 * Math.PI * PX * PX;
    expect(Math.abs(totalFillPx(draft.rects, draft.polygons) - want) / want < 0.05).toBe(true);
  }, TIMEOUT);

  it('CL7§1: an empty region fills nothing and completes', () => {
    const p = expectOk(fillRegion({ test: (_x, _y) => false, enclosure: (_x0, _x1, _y0, _y1) => 'false' }, VIEW_SQ));
    expect(p.rects.length).toBe(0);
    expect(p.polygons).toEqual([]);
    expect(p.borders).toEqual([]);
    expect(p.stats.complete).toBe(true);
  }, TIMEOUT);

  it('CL7§1: a fully true view fills without an enclosure too', () => {
    const p = expectOk(fillRegion({ test: (_x, _y) => true }, VIEW_SQ));
    expect(Math.abs(rectsAreaPx(p.rects) - 100 * PX * PX) / (100 * PX * PX) < 0.05).toBe(true);
    expect(p.stats.complete).toBe(true);
  }, HEAVY_TIMEOUT);
});

describe('CL7 steps 2-3: boundary polygons, corners and per-primitive borders', () => {
  const discInput: PredicateInput = {
    test: (x, y) => x * x + y * y <= 4,
    boundaries: [{ residual: (x, y) => 4 - x * x - y * y, strict: false, enclosure: discMarginEnc(2) }],
    enclosure: discTri(2, false),
  };

  it('CL7§2: boundary polygons stay within a cell of the circle', () => {
    // Polygon tables emit cell corners (up to a cell diagonal, 2.83px, from
    // the curve) plus Newton-corrected crossings; the 2% area test pins precision.
    const p = expectOk(fillRegion(discInput, VIEW_SQ));
    expect(p.polygons.length).toBeGreaterThan(0);
    for (const poly of p.polygons) {
      for (const pt of pairs(poly)) {
        const rPx = Math.hypot(pt.x - pxOf(VIEW_SQ, 0), pt.y - pyOf(VIEW_SQ, 0));
        expect(Math.abs(rPx - 2 * PX) < 3.5, `polygon radius ${rPx}px`).toBe(true);
      }
    }
  }, TIMEOUT);

  it('CL7§2: rects plus polygons measure the disc to 2%', () => {
    const p = expectOk(fillRegion(discInput, VIEW_SQ));
    const want = 4 * Math.PI * PX * PX;
    expect(Math.abs(totalFillPx(p.rects, p.polygons) - want) / want < 0.02).toBe(true);
  }, TIMEOUT);

  const cornerInput: PredicateInput = {
    test: (x, y) => x > 0 && y > 0,
    boundaries: [
      { residual: (x, _y) => x, strict: true, enclosure: (x0, x1) => ({ lo: x0, hi: x1, def: 2 }) },
      { residual: (_x, y) => y, strict: true, enclosure: (_x0, _x1, y0, y1) => ({ lo: y0, hi: y1, def: 2 }) },
    ],
    enclosure: andTri(halfTri(true), (_x0, _x1, y0, y1) => (y0 > 0 ? 'true' : y1 <= 0 ? 'false' : 'maybe')),
  };

  it('CL7§2: a two-boundary corner fills nothing outside', () => {
    const p = expectOk(fillRegion(cornerInput, VIEW_SQ));
    for (let i = 0; i + 3 < p.rects.length; i += 4) {
      expect(xOfPx(VIEW_SQ, p.rects[i + 2] ?? 0) > -0.05 && yOfPy(VIEW_SQ, p.rects[i + 1] ?? 0) > -0.05).toBe(true);
    }
  }, TIMEOUT);

  it('CL7§2: the corner resolves to sub-pixel covered sub-cells', () => {
    // The 4x4 supersampling fills covered sub-cells (here as small rects).
    const p = expectOk(fillRegion(cornerInput, VIEW_SQ));
    let near = 0;
    for (let i = 0; i + 3 < p.rects.length; i += 4) {
      const w = Math.abs((p.rects[i + 2] ?? 0) - (p.rects[i] ?? 0));
      const h = Math.abs((p.rects[i + 3] ?? 0) - (p.rects[i + 1] ?? 0));
      const cx = ((p.rects[i] ?? 0) + (p.rects[i + 2] ?? 0)) / 2;
      const cy = ((p.rects[i + 1] ?? 0) + (p.rects[i + 3] ?? 0)) / 2;
      if (w * h <= 1 && Math.hypot(cx - pxOf(VIEW_SQ, 0), cy - pyOf(VIEW_SQ, 0)) < 3) near += 1;
    }
    expect(near).toBeGreaterThan(0);
  }, TIMEOUT);

  const halfDiscInput: PredicateInput = {
    test: (x, y) => x * x + y * y <= 4 && y > x,
    boundaries: [
      { residual: (x, y) => 4 - x * x - y * y, strict: false, enclosure: discMarginEnc(2) },
      { residual: (x, y) => y - x, strict: true, enclosure: diagMarginEnc },
    ],
    enclosure: andTri(discTri(2, false), diagTri(true)),
  };

  it('CL7§3: the arc border covers the kept arc', () => {
    const p = expectOk(fillRegion(halfDiscInput, VIEW_SQ));
    const arcs = p.borders.filter((b) => !b.strict);
    expect(arcs.length).toBeGreaterThanOrEqual(1);
    // The kept arc runs from 45deg to 225deg; every 30deg of it is bordered.
    for (const deg of [45, 75, 105, 135, 165, 195, 225]) {
      const rad = (deg * Math.PI) / 180;
      const wx = pxOf(VIEW_SQ, 2 * Math.cos(rad));
      const wy = pyOf(VIEW_SQ, 2 * Math.sin(rad));
      const near = arcs.some((b) => pairs(b.path).some((q) => Math.hypot(q.x - wx, q.y - wy) < 3));
      expect(near, `arc near ${deg}deg`).toBe(true);
    }
  }, TIMEOUT);

  it('CL7§3: the arc border stays on the combined boundary', () => {
    const p = expectOk(fillRegion(halfDiscInput, VIEW_SQ));
    for (const b of p.borders.filter((z) => !z.strict)) {
      for (const q of pairs(b.path)) {
        expect(yOfPy(VIEW_SQ, q.y) >= xOfPx(VIEW_SQ, q.x) - 0.05, `arc point below y=x`).toBe(true);
      }
    }
  }, TIMEOUT);

  it('CL7§3: the diagonal border covers the kept diameter', () => {
    const p = expectOk(fillRegion(halfDiscInput, VIEW_SQ));
    const lines = p.borders.filter((b) => b.strict);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    // The kept diameter runs (-1.414, -1.414) to (1.414, 1.414) inside the disc.
    for (const t of [-1, -0.5, 0.5, 1]) {
      const wx = pxOf(VIEW_SQ, t);
      const wy = pyOf(VIEW_SQ, t);
      const near = lines.some((b) => pairs(b.path).some((q) => Math.hypot(q.x - wx, q.y - wy) < 3));
      expect(near, `diameter near (${t}, ${t})`).toBe(true);
    }
  }, TIMEOUT);

  it('CL7§3: strictness is per primitive (solid arc, dashed diagonal)', () => {
    const p = expectOk(fillRegion(halfDiscInput, VIEW_SQ));
    expect(p.borders.some((b) => !b.strict)).toBe(true);
    expect(p.borders.some((b) => b.strict)).toBe(true);
  }, TIMEOUT);

  it('CL7§3: an == boundary is kept where the body holds on it', () => {
    const input: PredicateInput = {
      test: (x, y) => x === 0 && y > 0,
      boundaries: [
        { residual: (x, _y) => x, strict: false, equality: true, enclosure: (x0, x1) => ({ lo: x0, hi: x1, def: 2 }) },
        { residual: (_x, y) => y, strict: true, enclosure: (_x0, _x1, y0, y1) => ({ lo: y0, hi: y1, def: 2 }) },
      ],
    };
    const p = expectOk(fillRegion(input, VIEW_SQ));
    const onRay = p.borders.some((b) =>
      pairs(b.path).some((q) => Math.abs(xOfPx(VIEW_SQ, q.x)) < 0.05 && yOfPy(VIEW_SQ, q.y) > 1),
    );
    expect(onRay).toBe(true);
  }, TIMEOUT);
});

describe('CL7 one-variable predicates: bands plus axis intervals', () => {
  it.each(['x*x > 4', 'x < 1'])('CL7§1D: bands span the full view height (%s)', (expr) => {
    const test = expr === 'x*x > 4' ? (x: number) => x * x > 4 : (x: number) => x < 1;
    const p = expectOk(fillPredicate1D({ test }, VIEW_SQ));
    expect(p.bands.length / 4).toBeGreaterThanOrEqual(1);
    for (let i = 0; i + 3 < p.bands.length; i += 4) {
      expect(p.bands[i + 1]).toBe(0);
      expect(p.bands[i + 3]).toBe(VIEW_SQ.heightPx);
    }
  }, TIMEOUT);

  it('CL7§1D: x^2 > 4 gives bands outside ±2', () => {
    const p = expectOk(fillPredicate1D({ test: (x) => x * x > 4 }, VIEW_SQ));
    expect(p.bands.length / 4).toBe(2);
    expect(Array.from(p.intervals).length).toBe(4);
    const [a0, a1, b0, b1] = Array.from(p.intervals);
    expect(Math.abs((a0 ?? 99) - -5) < 1e-9).toBe(true);
    expect(Math.abs((a1 ?? 99) - -2) < 0.002).toBe(true);
    expect(Math.abs((b0 ?? 99) - 2) < 0.002).toBe(true);
    expect(Math.abs((b1 ?? 99) - 5) < 1e-9).toBe(true);
  }, TIMEOUT);

  it('CL7§1D: transition edges bisect to a tenth of a pixel', () => {
    const p = expectOk(fillPredicate1D({ test: (x) => x < 1 }, VIEW_SQ));
    expect(Array.from(p.intervals).length).toBe(2);
    const edge = p.intervals[1] ?? 99;
    expect(Math.abs(edge - 1) * PX < 0.1 + 1e-9).toBe(true);
  }, TIMEOUT);

  it('CL7§1D: intervals come as lo,hi pairs', () => {
    const p = expectOk(fillPredicate1D({ test: (x) => x * x > 4 }, VIEW_SQ));
    expect(p.intervals.length % 2).toBe(0);
    for (let i = 0; i + 1 < p.intervals.length; i += 2) {
      expect((p.intervals[i] ?? 1) <= (p.intervals[i + 1] ?? -1)).toBe(true);
    }
  }, TIMEOUT);

  it('CL7§1D: strict and non-strict edges agree to the bisection tolerance', () => {
    const a = expectOk(fillPredicate1D({ test: (x) => x * x > 4 }, VIEW_SQ));
    const b = expectOk(fillPredicate1D({ test: (x) => x * x >= 4 }, VIEW_SQ));
    expect(a.intervals.length).toBe(b.intervals.length);
    for (let i = 0; i < a.intervals.length; i += 1) {
      expect(Math.abs((a.intervals[i] ?? 0) - (b.intervals[i] ?? 0)) < 0.002).toBe(true);
    }
  }, TIMEOUT);

  it('CL7§1D: an empty predicate fills nothing', () => {
    const p = expectOk(fillPredicate1D({ test: (x) => x * x < -1 }, VIEW_SQ));
    expect(p.bands.length).toBe(0);
    expect(p.intervals.length).toBe(0);
    expect(p.stats.complete).toBe(true);
  }, TIMEOUT);

  it('CL7§1D: a full predicate fills the whole width', () => {
    const p = expectOk(fillPredicate1D({ test: (x) => x * x > -1 }, VIEW_SQ));
    expect(p.bands.length / 4).toBe(1);
    expect(p.bands[0]).toBe(0);
    expect(p.bands[2]).toBe(VIEW_SQ.widthPx);
    expect(Array.from(p.intervals)).toEqual([-5, 5]);
  }, TIMEOUT);

  it('CL7§1D: the certain path agrees with sampling', () => {
    const a = expectOk(fillPredicate1D({ test: (x) => x * x > 4, enclosure: outsideTri }, VIEW_SQ));
    const b = expectOk(fillPredicate1D({ test: (x) => x * x > 4 }, VIEW_SQ));
    expect(a.intervals.length).toBe(b.intervals.length);
    for (let i = 0; i < a.intervals.length; i += 1) {
      expect(Math.abs((a.intervals[i] ?? 0) - (b.intervals[i] ?? 0)) < 0.01).toBe(true);
    }
  }, TIMEOUT);

  it('CL7§1D: bands and intervals are Float64Arrays of groups', () => {
    const p = expectOk(fillPredicate1D({ test: (x) => x * x > 4 }, VIEW_SQ));
    expect(p.bands).toBeInstanceOf(Float64Array);
    expect(p.intervals).toBeInstanceOf(Float64Array);
    expect(p.bands.length % 4).toBe(0);
    expect(p.stats.complete).toBe(true);
  }, TIMEOUT);
});

describe('CL7 output, certainty flags, budgets and targets', () => {
  it('CL7 output: rects, polygons, borders, markers and stats', () => {
    const p = expectOk(fillRegion({ test: (x, y) => x * x + y * y <= 4 }, VIEW_SQ));
    expect(p.rects).toBeInstanceOf(Float64Array);
    expect(p.rects.length % 4).toBe(0);
    expect(Array.isArray(p.polygons)).toBe(true);
    for (const poly of p.polygons) expect(poly).toBeInstanceOf(Float64Array);
    for (const b of p.borders) {
      expect(b.path).toBeInstanceOf(Float64Array);
      expect(typeof b.strict).toBe('boolean');
    }
    expect(Array.isArray(p.markers)).toBe(true);
    expect(p.stats.complete).toBe(true);
  }, HEAVY_TIMEOUT);

  it('CL7§1: maximal rects never overlap', () => {
    const p = expectOk(fillRegion(
      {
        test: (x, _y) => x > 0,
        boundaries: [{ residual: (x, _y) => x, strict: true, enclosure: (x0, x1) => ({ lo: x0, hi: x1, def: 2 }) }],
        enclosure: halfTri(true),
      },
      VIEW_SQ,
    ));
    const n = p.rects.length / 4;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const ax0 = p.rects[4 * i] ?? 0;
        const ay0 = p.rects[4 * i + 1] ?? 0;
        const ax1 = p.rects[4 * i + 2] ?? 0;
        const ay1 = p.rects[4 * i + 3] ?? 0;
        const bx0 = p.rects[4 * j] ?? 0;
        const by0 = p.rects[4 * j + 1] ?? 0;
        const bx1 = p.rects[4 * j + 2] ?? 0;
        const by1 = p.rects[4 * j + 3] ?? 0;
        const overlap = Math.min(ax1, bx1) - Math.max(ax0, bx0) > 1e-9 && Math.min(ay1, by1) - Math.max(ay0, by0) > 1e-9;
        expect(overlap, `rects ${i} and ${j} overlap`).toBe(false);
      }
    }
  }, TIMEOUT);

  it('CL7 output: fills stay inside the view', () => {
    const p = expectOk(fillRegion({ test: (x, y) => x * x + y * y <= 4 }, VIEW_SQ));
    for (let i = 0; i + 3 < p.rects.length; i += 4) {
      expect((p.rects[i] ?? -1) >= -1e-9 && (p.rects[i + 2] ?? 1e9) <= VIEW_SQ.widthPx + 1e-9).toBe(true);
      expect((p.rects[i + 1] ?? -1) >= -1e-9 && (p.rects[i + 3] ?? 1e9) <= VIEW_SQ.heightPx + 1e-9).toBe(true);
    }
    for (const poly of p.polygons) {
      for (const pt of pairs(poly)) {
        expect(pt.x >= -1 && pt.x <= VIEW_SQ.widthPx + 1 && pt.y >= -1 && pt.y <= VIEW_SQ.heightPx + 1).toBe(true);
      }
    }
  }, HEAVY_TIMEOUT);

  it('CL7 output: an isolated true point is marked', () => {
    const p = expectOk(fillRegion(expectOk(predicateFromRelation(rel2('x^2 + y^2 <= 0'))), VIEW_SQ));
    const found = markersOf(p.markers, 'isolated');
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found.some((m) => Math.hypot(m.px - pxOf(VIEW_SQ, 0), m.py - pyOf(VIEW_SQ, 0)) < 2)).toBe(true);
  }, TIMEOUT);

  it('CL7 output: an isolated true point is marked on the certain path', () => {
    const p = expectOk(fillRegion(
      {
        test: (x, y) => x * x + y * y <= 0,
        boundaries: [{ residual: (x, y) => 0 - x * x - y * y, strict: false, enclosure: discMarginEnc(0) }],
        enclosure: discTri(0, false),
      },
      VIEW_SQ,
    ));
    expect(markersOf(p.markers, 'isolated').length).toBeGreaterThanOrEqual(1);
  }, TIMEOUT);

  it('CL7: certain fills are rigorous, heuristic fills are not', () => {
    const certain = expectOk(fillRegion(
      {
        test: (x, y) => x * x + y * y <= 4,
        boundaries: [{ residual: (x, y) => 4 - x * x - y * y, strict: false, enclosure: discMarginEnc(2) }],
        enclosure: discTri(2, false),
      },
      VIEW_SQ,
    ));
    expect(certain.stats.rigorous).toBe(true);
    const heuristic = expectOk(fillRegion({ test: (x, y) => x * x + y * y <= 4 }, VIEW_SQ));
    expect(heuristic.stats.rigorous).toBe(false);
  }, HEAVY_TIMEOUT);

  it('CL7: repeat fills are identical', () => {
    const input: PredicateInput = {
      test: (x, y) => x * x + y * y <= 4,
      boundaries: [{ residual: (x, y) => 4 - x * x - y * y, strict: false, enclosure: discMarginEnc(2) }],
      enclosure: discTri(2, false),
    };
    const a = expectOk(fillRegion(input, VIEW_SQ));
    const b = expectOk(fillRegion(input, VIEW_SQ));
    expect(b.stats).toEqual(a.stats);
    expect(Array.from(b.rects)).toEqual(Array.from(a.rects));
    expect(b.polygons.length).toBe(a.polygons.length);
    expect(b.markers).toEqual(a.markers);
  }, TIMEOUT);

  it('CL7 markers stay finite and mapped', () => {
    const p = expectOk(fillRegion(expectOk(predicateFromRelation(rel2('x^2 + y^2 <= 0'))), VIEW_SQ));
    expectFiniteMarkers(p);
    for (const m of p.markers) expectMarkerMapping(VIEW_SQ, m);
  }, TIMEOUT);

  it('CL7 budgets: exhausting maxEvals reports incomplete with empty output', () => {
    const p = expectOk(fillRegion({ test: (x, y) => x * x + y * y <= 4 }, VIEW_SQ, { maxEvals: 100 }));
    expect(p.stats.complete).toBe(false);
    expect(p.rects.length).toBe(0);
    expect(p.polygons).toEqual([]);
    expect(p.borders).toEqual([]);
    const done = expectOk(fillRegion({ test: (x, y) => x * x + y * y <= 4 }, VIEW_SQ, { maxEvals: 500000 }));
    expect(done.stats.complete).toBe(true);
  }, HEAVY_TIMEOUT);

  it.each([
    ['half-plane (target 0.3ms)', 'x > 0'],
    ['disc and half-plane (target 1.5ms)', 'x^2 + y^2 <= 4 and y > x'],
  ])('CL7 targets: %s completes within budget', (_label, text) => {
    const t0 = performance.now();
    const p = expectOk(fillRegion(expectOk(predicateFromRelation(rel2(text))), VIEW_SQ));
    const ms = performance.now() - t0;
    expect(p.stats.complete).toBe(true);
    expect(p.stats.evals).toBeLessThanOrEqual(200000);
    expect(ms).toBeLessThan(15000);
  }, HEAVY_TIMEOUT);

  it('CL7 targets: sin(x)*y > 1 band (target 8ms) completes within budget', () => {
    const t0 = performance.now();
    const p = expectOk(fillRegion({ test: (x, y) => Math.sin(x) * y > 1 }, VIEW_SQ));
    const ms = performance.now() - t0;
    expect(p.stats.complete).toBe(true);
    expect(p.stats.evals).toBeLessThanOrEqual(200000);
    expect(ms).toBeLessThan(30000);
  }, HEAVY_TIMEOUT);
});
