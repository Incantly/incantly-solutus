/**
 * Function plotter: interval verdicts for suspicious pairs.
 *
 * Docs: `docs/features/functions-calculus/design.md` section 9 step 5
 * (steep / gap / hole / pole / jump verdicts from the Interval algebra,
 * pole paths extended to the view edge, end markers by side); section 8.7
 * (the plotter draws the open circle for holes without a command).
 * Marker coordinates: `packages/plot/src/contracts.ts` (maths AND pixels;
 * pole markers at the view's vertical centre).
 */
import { describe, expect, it } from 'vitest';
import { plotFunction } from '@incantly/plot';
import type { ScalarBox, ScalarEnclosure } from '@incantly/plot';
import {
  TIMEOUT,
  VIEW,
  boundsOf,
  expectFiniteMarkers,
  expectMarkerMapping,
  expectOk,
  floorEnc,
  fn1,
  forgedScalar,
  holeEnc,
  invEnc,
  markersOf,
  pairs,
  pxOf,
  squareEnc,
  sqrtEnc,
  steepEnc,
  tanEnc,
  xOfPx,
} from './helpers';

const ceilEnc: ScalarEnclosure = (lo, hi): ScalarBox => ({ lo: Math.ceil(lo), hi: Math.ceil(hi), def: 2 });

describe('FC9 step 5 certain path: a pole cuts the path and marks it (1/x)', () => {
  it('FC9§5: an unbounded enclosure yields exactly one pole marker at x = 0', () => {
    const p = expectOk(plotFunction(fn1('1/x'), VIEW, { enclosure: invEnc }));
    const poles = markersOf(p.markers, 'pole');
    expect(poles.length).toBe(1);
    expect(Math.abs((poles[0]?.x ?? 99) - 0) < 1e-6).toBe(true);
    expect(Math.abs((poles[0]?.px ?? -1) - pxOf(VIEW, 0)) < 1).toBe(true);
    expectMarkerMapping(VIEW, poles[0] ?? { kind: 'pole', x: 0, y: 0, px: 0, py: 0 });
  }, TIMEOUT);

  it('FC9§5: the pole marker sits at the view vertical centre', () => {
    const p = expectOk(plotFunction(fn1('1/x'), VIEW, { enclosure: invEnc }));
    const poles = markersOf(p.markers, 'pole');
    expect(poles.length).toBe(1);
    expect(Math.abs((poles[0]?.y ?? 99) - (VIEW.y0 + VIEW.y1) / 2) < 1e-9).toBe(true);
  }, TIMEOUT);

  it('FC9§5: a pole breaks the curve into two paths', () => {
    const p = expectOk(plotFunction(fn1('1/x'), VIEW, { enclosure: invEnc }));
    expect(p.paths.length).toBe(2);
  }, TIMEOUT);

  it('FC9§5: the negative side extends down to the view edge', () => {
    const p = expectOk(plotFunction(fn1('1/x'), VIEW, { enclosure: invEnc }));
    const left = p.paths.find((path) => {
      const b = boundsOf(path);
      return b !== undefined && xOfPx(VIEW, b.maxX) < 0;
    });
    expect(left).toBeDefined();
    const b = boundsOf(left ?? new Float64Array(0));
    expect((b?.maxY ?? -1) >= VIEW.heightPx, `bottom ${b?.maxY}`).toBe(true);
  }, TIMEOUT);

  it('FC9§5: the positive side extends up to the view edge', () => {
    const p = expectOk(plotFunction(fn1('1/x'), VIEW, { enclosure: invEnc }));
    const right = p.paths.find((path) => {
      const b = boundsOf(path);
      return b !== undefined && xOfPx(VIEW, b.minX) > 0;
    });
    expect(right).toBeDefined();
    const b = boundsOf(right ?? new Float64Array(0));
    expect((b?.minY ?? 1e9) <= 0, `top ${b?.minY}`).toBe(true);
  }, TIMEOUT);

  it('FC9§5: a pole is not a jump and not a hole', () => {
    const p = expectOk(plotFunction(fn1('1/x'), VIEW, { enclosure: invEnc }));
    expect(markersOf(p.markers, 'jump')).toEqual([]);
    expect(markersOf(p.markers, 'hole')).toEqual([]);
  }, TIMEOUT);

  it('FC9§5: the certain pole verdict is rigorous', () => {
    const p = expectOk(plotFunction(fn1('1/x'), VIEW, { enclosure: invEnc }));
    expect(p.stats.rigorous).toBe(true);
    expectFiniteMarkers(p);
  }, TIMEOUT);
});

describe('FC9 step 5 certain path: several poles (tan)', () => {
  const POLES = [-3 * Math.PI / 2, -Math.PI / 2, Math.PI / 2, 3 * Math.PI / 2];

  it('FC9§5: tan gets one pole marker per pole', () => {
    const p = expectOk(plotFunction(fn1('tan(x)'), VIEW, { enclosure: tanEnc }));
    const poles = markersOf(p.markers, 'pole');
    expect(poles.length).toBe(4);
    for (const c of POLES) {
      expect(poles.some((m) => Math.abs(m.x - c) < 1e-6), `pole near ${c}`).toBe(true);
    }
  }, TIMEOUT);

  it('FC9§5: tan breaks into five paths, one per piece', () => {
    const p = expectOk(plotFunction(fn1('tan(x)'), VIEW, { enclosure: tanEnc }));
    expect(p.paths.length).toBe(5);
  }, TIMEOUT);

  it('FC9§5: no tan path spans a pole', () => {
    const p = expectOk(plotFunction(fn1('tan(x)'), VIEW, { enclosure: tanEnc }));
    for (const path of p.paths) {
      const b = boundsOf(path);
      if (b === undefined) continue;
      const lo = xOfPx(VIEW, b.minX);
      const hi = xOfPx(VIEW, b.maxX);
      for (const c of POLES) expect(!(lo < c && c < hi), `path spans ${c}`).toBe(true);
    }
  }, TIMEOUT);

  it('FC9§5+§6: poles are breaks, never sub-pixel oscillation', () => {
    const p = expectOk(plotFunction(fn1('tan(x)'), VIEW, { enclosure: tanEnc }));
    expect(p.inkColumns).toEqual([]);
  }, TIMEOUT);

  it('FC9§5: the certain tan verdict is rigorous', () => {
    const p = expectOk(plotFunction(fn1('tan(x)'), VIEW, { enclosure: tanEnc }));
    expect(p.stats.rigorous).toBe(true);
    expectFiniteMarkers(p);
  }, TIMEOUT);
});

describe('FC9 step 5 certain path: a jump breaks the path with sided ends (floor)', () => {
  const INTEGERS = [-4, -3, -2, -1, 0, 1, 2, 3, 4];

  it('FC9§5: a jump breaks the path (ten steps, ten paths)', () => {
    const p = expectOk(plotFunction(fn1('floor(x)'), VIEW, { breaks: INTEGERS, enclosure: floorEnc }));
    expect(p.paths.length).toBe(10);
  }, TIMEOUT);

  it('FC9§5: every step segment is flat', () => {
    const p = expectOk(plotFunction(fn1('floor(x)'), VIEW, { breaks: INTEGERS, enclosure: floorEnc }));
    for (const path of p.paths) {
      const ys = pairs(path).map((q) => q.y);
      expect(Math.max(...ys) - Math.min(...ys) < 1e-6).toBe(true);
    }
  }, TIMEOUT);

  it('FC9§5: each integer gets open, jump and closed markers', () => {
    const p = expectOk(plotFunction(fn1('floor(x)'), VIEW, { breaks: INTEGERS, enclosure: floorEnc }));
    expect(markersOf(p.markers, 'openEnd').length).toBe(9);
    expect(markersOf(p.markers, 'jump').length).toBe(9);
    expect(markersOf(p.markers, 'closedEnd').length).toBe(9);
  }, TIMEOUT);

  it('FC9§5: floor(n) = n belongs to the right, so the left end is open', () => {
    const p = expectOk(plotFunction(fn1('floor(x)'), VIEW, { breaks: INTEGERS, enclosure: floorEnc }));
    for (const n of INTEGERS) {
      const open = markersOf(p.markers, 'openEnd').filter((m) => Math.abs(m.x - n) < 1e-9);
      const closed = markersOf(p.markers, 'closedEnd').filter((m) => Math.abs(m.x - n) < 1e-9);
      expect(open.length).toBe(1);
      expect(closed.length).toBe(1);
      expect(Math.abs((open[0]?.y ?? 99) - (n - 1)) < 1e-9, `open y at ${n}`).toBe(true);
      expect(Math.abs((closed[0]?.y ?? 99) - n) < 1e-9, `closed y at ${n}`).toBe(true);
    }
  }, TIMEOUT);

  it('FC9§5: jump markers sit at the break between the two sides', () => {
    const p = expectOk(plotFunction(fn1('floor(x)'), VIEW, { breaks: INTEGERS, enclosure: floorEnc }));
    for (const n of INTEGERS) {
      const jumps = markersOf(p.markers, 'jump').filter((m) => Math.abs(m.x - n) < 1e-6);
      expect(jumps.length).toBe(1);
      const y = jumps[0]?.y ?? 99;
      expect(y >= n - 1 - 1e-9 && y <= n + 1e-9, `jump y=${y} at ${n}`).toBe(true);
    }
  }, TIMEOUT);

  it('FC9§5: ceil jumps face the other way (value belongs to the left)', () => {
    const p = expectOk(plotFunction(fn1('ceil(x)'), VIEW, { breaks: [0], enclosure: ceilEnc }));
    const open = markersOf(p.markers, 'openEnd').filter((m) => Math.abs(m.x - 0) < 1e-9);
    const closed = markersOf(p.markers, 'closedEnd').filter((m) => Math.abs(m.x - 0) < 1e-9);
    expect(open.length).toBe(1);
    expect(closed.length).toBe(1);
    // ceil(0) = 0 is the left-side value, so the left end is closed there.
    expect(Math.abs((closed[0]?.y ?? 99) - 0) < 1e-9).toBe(true);
    expect(Math.abs((open[0]?.y ?? 99) - 1) < 1e-9).toBe(true);
  }, TIMEOUT);
});

describe('FC9 step 5 certain path: holes join across with an open circle', () => {
  it('FC9§5 + FC8.7: a hole joins into one path', () => {
    const p = expectOk(plotFunction(fn1('(x^2-1)/(x-1)'), VIEW, { breaks: [1], enclosure: holeEnc }));
    expect(p.paths.length).toBe(1);
  }, TIMEOUT);

  it('FC9§5 + FC8.7: the hole marker sits at (1, 2)', () => {
    const p = expectOk(plotFunction(fn1('(x^2-1)/(x-1)'), VIEW, { breaks: [1], enclosure: holeEnc }));
    const holes = markersOf(p.markers, 'hole');
    expect(holes.length).toBe(1);
    expect(Math.abs((holes[0]?.x ?? 99) - 1) < 1e-6).toBe(true);
    expect(Math.abs((holes[0]?.y ?? 99) - 2) < 1e-3).toBe(true);
    expectMarkerMapping(VIEW, holes[0] ?? { kind: 'hole', x: 0, y: 0, px: 0, py: 0 });
  }, TIMEOUT);

  it('FC9§5: a hole earns no other marker', () => {
    const p = expectOk(plotFunction(fn1('(x^2-1)/(x-1)'), VIEW, { breaks: [1], enclosure: holeEnc }));
    expect(p.markers.length).toBe(1);
    expect(p.stats.rigorous).toBe(true);
  }, TIMEOUT);
});

describe('FC9 step 5 certain path: gaps end the path (sqrt), steep rises draw through', () => {
  it('FC9§5: def 0 ends the path; sqrt draws only for x >= 0', () => {
    const p = expectOk(plotFunction(fn1('sqrt(x)'), VIEW, { enclosure: sqrtEnc }));
    expect(p.paths.length).toBe(1);
    for (const pt of pairs(p.paths[0] ?? new Float64Array(0))) {
      expect(xOfPx(VIEW, pt.x) >= -1e-9, `vertex at x=${xOfPx(VIEW, pt.x)}`).toBe(true);
    }
  }, TIMEOUT);

  it('FC9§5: the sqrt path starts within a pixel of x = 0', () => {
    const p = expectOk(plotFunction(fn1('sqrt(x)'), VIEW, { enclosure: sqrtEnc }));
    const b = boundsOf(p.paths[0] ?? new Float64Array(0));
    expect(Math.abs((b?.minX ?? -1) - pxOf(VIEW, 0)) < 1).toBe(true);
    expect(p.markers).toEqual([]);
    expect(p.stats.rigorous).toBe(true);
  }, TIMEOUT);

  it('FC9§5: a bounded def 2 stretch is a steep rise, drawn with no break', () => {
    const p = expectOk(plotFunction(fn1('atan(50*x)'), VIEW, { enclosure: steepEnc }));
    expect(p.paths.length).toBe(1);
    expect(p.markers).toEqual([]);
    expect(p.stats.rigorous).toBe(true);
  }, TIMEOUT);

  it('FC9§5: a smooth def 2 curve needs no interval work at all', () => {
    const p = expectOk(plotFunction(fn1('x^2 - 2'), VIEW, { enclosure: squareEnc }));
    expect(p.stats.intervalEvals).toBe(0);
    expect(p.paths.length).toBe(1);
  }, TIMEOUT);

  it('FC9§5: a suspicious stretch with an enclosure is verified with intervals', () => {
    const p = expectOk(plotFunction(fn1('1/x'), VIEW, { enclosure: invEnc }));
    expect(p.stats.intervalEvals).toBeGreaterThan(0);
  }, TIMEOUT);
});

describe('FC9 step 5 without an enclosure: breaks hold, certainty is reported honestly', () => {
  it('FC9§5: 1/x still breaks into two paths', () => {
    const p = expectOk(plotFunction(fn1('1/x'), VIEW));
    expect(p.paths.length).toBe(2);
  }, TIMEOUT);

  it('FC9§5: no 1/x path joins across the pole', () => {
    const p = expectOk(plotFunction(fn1('1/x'), VIEW));
    for (const path of p.paths) {
      const b = boundsOf(path);
      if (b === undefined) continue;
      const lo = xOfPx(VIEW, b.minX);
      const hi = xOfPx(VIEW, b.maxX);
      expect(!(lo < 0 && 0 < hi), `path spans the pole [${lo}, ${hi}]`).toBe(true);
    }
  }, TIMEOUT);

  it('FC9 output: every heuristic marker stays drawable (finite coordinates)', () => {
    const p = expectOk(plotFunction(fn1('1/x'), VIEW));
    expectFiniteMarkers(p);
  }, TIMEOUT);

  it('FC9§5: the heuristic pole verdict reports rigorous false', () => {
    const p = expectOk(plotFunction(fn1('1/x'), VIEW));
    expect(p.stats.rigorous).toBe(false);
  }, TIMEOUT);

  it('FC9§5: marker counts stay sane without an enclosure', () => {
    // Docs-silent bound, chosen generously: breaks and poles each deserve a
    // few markers, never thousands. 200 is far above any sane count here.
    const p = expectOk(plotFunction(fn1('1/x'), VIEW));
    expect(p.markers.length).toBeLessThan(200);
  }, TIMEOUT);

  it('FC9§5: no tan path joins across a pole without an enclosure', () => {
    const p = expectOk(plotFunction(fn1('tan(x)'), VIEW));
    const poles = [-3 * Math.PI / 2, -Math.PI / 2, Math.PI / 2, 3 * Math.PI / 2];
    for (const path of p.paths) {
      const b = boundsOf(path);
      if (b === undefined) continue;
      const lo = xOfPx(VIEW, b.minX);
      const hi = xOfPx(VIEW, b.maxX);
      for (const c of poles) expect(!(lo < c && c < hi), `path spans ${c}`).toBe(true);
    }
  }, TIMEOUT);

  it('FC9§5: heuristic tan reports rigorous false with finite markers', () => {
    const p = expectOk(plotFunction(fn1('tan(x)'), VIEW));
    expect(p.stats.rigorous).toBe(false);
    expectFiniteMarkers(p);
  }, TIMEOUT);

  it('FC9§3+§4: floor without breaks completes (jumps read as steep rises)', () => {
    const p = expectOk(plotFunction(fn1('floor(x)'), VIEW));
    expect(p.stats.complete).toBe(true);
    expectFiniteMarkers(p);
  }, TIMEOUT);

  it('FC9§5: an unhinted hole joins silently into one path', () => {
    const p = expectOk(plotFunction(fn1('(x^2-1)/(x-1)'), VIEW));
    expect(p.paths.length).toBe(1);
    expect(p.stats.complete).toBe(true);
  }, TIMEOUT);

  it('FC9§5: a break-hinted hole without an enclosure reports rigorous false', () => {
    const p = expectOk(plotFunction(fn1('(x^2-1)/(x-1)'), VIEW, { breaks: [1] }));
    expect(p.stats.complete).toBe(true);
    expect(p.stats.rigorous).toBe(false);
  }, TIMEOUT);

  it('FC9§5: sqrt without an enclosure still starts at x = 0 and says so', () => {
    const p = expectOk(plotFunction(fn1('sqrt(x)'), VIEW));
    const b = boundsOf(p.paths[0] ?? new Float64Array(0));
    expect(Math.abs((b?.minX ?? -1) - pxOf(VIEW, 0)) < 1).toBe(true);
    expect(p.stats.rigorous).toBe(false);
  }, TIMEOUT);

  it('FC9§4: forged +inf samples complete honestly (finite markers, rigorous false)', () => {
    const f = forgedScalar(fn1('x'), (x) => (x > 0 ? Number.POSITIVE_INFINITY : x));
    const p = expectOk(plotFunction(f, VIEW));
    expect(p.stats.complete).toBe(true);
    expect(p.stats.rigorous).toBe(false);
    expectFiniteMarkers(p);
  }, TIMEOUT);

  it('FC9§4: forged +inf samples still draw the finite half', () => {
    const f = forgedScalar(fn1('x'), (x) => (x > 0 ? Number.POSITIVE_INFINITY : x));
    const p = expectOk(plotFunction(f, VIEW));
    const left = p.paths.some((path) => {
      const b = boundsOf(path);
      return b !== undefined && xOfPx(VIEW, b.minX) < -4;
    });
    expect(left).toBe(true);
  }, TIMEOUT);
});

describe('contracts: markers carry consistent maths and pixel coordinates', () => {
  it.each(['1/x', 'floor(x)', '(x^2-1)/(x-1)', 'sqrt(x)', 'tan(x)', 'x^2'])(
    'marker mapping holds (%s)',
    (body) => {
      const breaks = body === 'floor(x)' ? [-4, -3, -2, -1, 0, 1, 2, 3, 4] : body === '(x^2-1)/(x-1)' ? [1] : [];
      const p = expectOk(plotFunction(fn1(body), VIEW, breaks.length > 0 ? { breaks } : {}));
      for (const m of p.markers) {
        if (!Number.isFinite(m.y) || !Number.isFinite(m.py)) continue; // finiteness is asserted separately
        expectMarkerMapping(VIEW, m);
      }
    },
    TIMEOUT,
  );
});
