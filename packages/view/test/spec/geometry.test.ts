/**
 * graphics-view/design.md 6 (geometry builders) and 10.7 (exactness).
 * Pixel builders per family, LOD reduction, and hit maths.
 */
import { describe, expect, it } from 'vitest';
import {
  CURVE_TOLERANCE_PX,
  GeometryDrawable,
  LIGHT_THEME,
  MAX_CURVE_SAMPLES,
  RecordSurface,
  buildGeometry,
  buildInput,
  capSamples,
  clipRingToRect,
  conicSegmentCount,
  createMapper,
  hitGeometry,
  mapPolyline,
  markerIsOpen,
  markerStroke,
  nearestOnPolyline,
  pathLengthPx,
  pointInPolygon,
  pointSegmentDistance,
  px,
  rdpSimplify,
  reduceRun,
  shiftGeometry,
} from '@incantly/view';
import type { BuiltGeometry, ViewValue } from '@incantly/view';
import { head, oid, testStyle, testViewport } from './helpers';

const measure = (_text: string, sizePx: number): { width: number; height: number } => ({
  width: _text.length * sizePx * 0.6,
  height: sizePx * 1.2,
});

function input(detail: 0 | 1 | 2 = 0): ReturnType<typeof buildInput> {
  return buildInput(testViewport(), measure, detail, false);
}

function geom(value: ViewValue, kind: 'point' | 'line' | 'segment' | 'vector' | 'curve' | 'region' | 'arc' | 'angle' | 'text' = 'point'): BuiltGeometry | null {
  return buildGeometry(value, input(), testStyle(kind));
}

describe('design 6 geometry builders', () => {
  it('6 point builds a marker anchor with radius', () => {
    const g = geom({ k: 'point', x: 1, y: 2 });
    expect(g).not.toBeNull();
    expect(g?.anchor).toEqual({ x: 450, y: 200 });
    expect(g?.markerRadius).toBe(4);
  });

  it('6 vector builds shaft and head strokes', () => {
    const g = geom({ k: 'vector', dx: 3, dy: 4, ox: 0, oy: 0 }, 'vector');
    expect(g).not.toBeNull();
    expect(g?.strokes.length).toBeGreaterThanOrEqual(1);
  });

  it('6 segments map to one pixel run with an exact bbox', () => {
    const g = geom({ k: 'segment', ax: 0, ay: 0, bx: 2, by: 0 }, 'segment');
    expect(g).not.toBeNull();
    expect(g?.strokes).toHaveLength(1);
    const run = g?.strokes[0];
    expect(run).not.toBeUndefined();
    if (run !== undefined) {
      expect(Array.from(run)).toEqual([400, 300, 500, 300]);
    }
  });

  it('3 lines and rays clip to the view, never long segments', () => {
    for (const value of [
      { k: 'line', ox: 0, oy: 0, dx: 1, dy: 1 },
      { k: 'ray', ox: 0, oy: 0, dx: 1, dy: 0 },
      { k: 'line', ox: 0, oy: 0, dx: 1e-9, dy: 1 },
    ] as const) {
      const g = geom(value, 'line');
      expect(g).not.toBeNull();
      for (const run of g?.strokes ?? []) {
        for (let i = 0; i < run.length; i += 2) {
          expect(run[i] as number).toBeGreaterThanOrEqual(0);
          expect(run[i] as number).toBeLessThanOrEqual(800);
          expect(run[i + 1] as number).toBeGreaterThanOrEqual(0);
          expect(run[i + 1] as number).toBeLessThanOrEqual(600);
        }
      }
      const b = g?.bbox;
      expect(b).not.toBeNull();
      if (b !== undefined && b !== null) {
        expect(b.x0).toBeGreaterThanOrEqual(-3);
        expect(b.x1).toBeLessThanOrEqual(803);
        expect(b.y0).toBeGreaterThanOrEqual(-3);
        expect(b.y1).toBeLessThanOrEqual(603);
      }
    }
  });

  it('6 circles build screen-radius polylines; arcs honour from/to', () => {
    const c = geom({ k: 'circle', cx: 0, cy: 0, r: 2 }, 'arc');
    expect(c).not.toBeNull();
    expect(c?.strokes.length).toBeGreaterThanOrEqual(1);
    const a = geom({ k: 'arc', cx: 0, cy: 0, r: 2, from: 0, to: Math.PI / 2 }, 'arc');
    expect(a).not.toBeNull();
    const cb = c?.bbox;
    const ab = a?.bbox;
    if (cb !== undefined && cb !== null && ab !== undefined && ab !== null) {
      expect(ab.x1 - ab.x0).toBeLessThanOrEqual(cb.x1 - cb.x0 + 1);
    }
  });

  it('6 degenerate polygons draw nothing', () => {
    for (const pts of [new Float64Array([0, 0, 1, 1]), new Float64Array([0, 0, 1, 1, 2, 2])]) {
      const g = geom({ k: 'polygon', pts }, 'region');
      const empty = g === null || (g.strokes.length === 0 && g.fills.length === 0);
      expect(empty).toBe(true);
      if (g !== null) expect(g.bbox).toBeNull();
    }
    const tri = geom({ k: 'polygon', pts: new Float64Array([0, 0, 2, 0, 0, 2]) }, 'region');
    expect(tri).not.toBeNull();
    expect(tri?.fills.length).toBeGreaterThanOrEqual(1);
  });

  it('6 polylines, curves and regions map runs and rings to pixels', () => {
    const pl = geom({ k: 'polyline', pts: new Float64Array([0, 0, 1, 1]), closed: false }, 'curve');
    expect(pl?.strokes).toHaveLength(1);
    const cu = geom({ k: 'curve', runs: [new Float64Array([0, 0, 1, 1])] }, 'curve');
    expect(cu?.strokes).toHaveLength(1);
    const rg = geom({ k: 'region', rings: [new Float64Array([0, 0, 2, 0, 2, 2, 0, 2])] }, 'region');
    expect(rg?.fills.length).toBeGreaterThanOrEqual(1);
  });

  it('6 angles build an arc or square with a value label', () => {
    const g = geom({ k: 'angle', cx: 0, cy: 0, r: 1, from: 0, to: Math.PI / 2, right: false }, 'angle');
    expect(g).not.toBeNull();
    expect(g?.labelText).not.toBeNull();
    const sq = geom({ k: 'angle', cx: 0, cy: 0, r: 1, from: 0, to: Math.PI / 2, right: true }, 'angle');
    expect(sq).not.toBeNull();
  });

  it('6 text measures through the host estimator, maths or screen anchored', () => {
    const t = geom({ k: 'text', text: 'hi', atX: 1, atY: 2, screen: false }, 'text');
    expect(t).not.toBeNull();
    expect(t?.anchor).toEqual({ x: 450, y: 200 });
    const s = geom({ k: 'text', text: 'hi', atX: 12, atY: 20, screen: true }, 'text');
    expect(s).not.toBeNull();
  });

  it('6 traces build polylines from stored maths points', () => {
    const g = geom({ k: 'trace', pts: new Float64Array([0, 0, 1, 1, 2, 0]) }, 'curve');
    expect(g).not.toBeNull();
    expect(g?.strokes.length).toBeGreaterThanOrEqual(1);
  });

  it('6 3D values have no 2D geometry (the space painter draws them)', () => {
    expect(geom({ k: 'point3', x: 0, y: 0, z: 0 })).toBeNull();
    expect(geom({ k: 'mesh', pos: new Float32Array([]), nor: new Float32Array([]), idx: new Uint32Array([]), closed: true })).toBeNull();
    expect(geom({ k: 'meshref', key: 'm1' })).toBeNull();
  });

  it('6 mapPolyline drops non-finite runs into separate pixel runs', () => {
    const runs = mapPolyline(new Float64Array([0, 0, 1, 1, Number.NaN, Number.NaN, 2, 2, 3, 3]), createMapper(testViewport()));
    expect(runs).toHaveLength(2);
    expect(Array.from(runs[0] as Float32Array)).toEqual([400, 300, 450, 250]);
    expect(Array.from(runs[1] as Float32Array)).toEqual([500, 200, 550, 150]);
    expect(mapPolyline(new Float64Array([]), createMapper(testViewport()))).toEqual([]);
  });
});

describe('design 7.5 LOD and reduction', () => {
  it('7.5 curve tolerance is 0.3 px; sample budget is 4000 per curve', () => {
    expect(CURVE_TOLERANCE_PX).toBe(0.3);
    expect(MAX_CURVE_SAMPLES).toBe(4000);
  });

  it('7.5 RDP keeps endpoints and collapses straight runs', () => {
    const line = new Float32Array([0, 0, 1, 0.01, 2, 0, 3, 0.01, 4, 0]);
    const simp = rdpSimplify(line, 0.3);
    expect(Array.from(simp.slice(0, 2))).toEqual([0, 0]);
    expect(Array.from(simp.slice(-2))).toEqual([4, 0]);
    expect(simp.length).toBeLessThan(line.length);
    expect(rdpSimplify(new Float32Array([]), 0.3).length).toBe(0);
    expect(rdpSimplify(new Float32Array([1, 2]), 0.3).length).toBe(2);
  });

  it('7.5 pathLengthPx measures pixel polylines', () => {
    expect(pathLengthPx(new Float32Array([0, 0, 3, 4]))).toBe(5);
    expect(pathLengthPx(new Float32Array([]))).toBe(0);
  });

  it('7.5 capSamples decimates evenly to the budget', () => {
    const big = new Float32Array(20000);
    for (let i = 0; i < 20000; i += 1) big[i] = i;
    const capped = capSamples(big);
    expect(capped.length).toBeLessThanOrEqual(8000);
    expect(capped.length % 2).toBe(0);
    const small = new Float32Array([0, 0, 1, 1]);
    expect(capSamples(small)).toEqual(small);
  });

  it('7.5 reduceRun simplifies only runs denser than 4 pts per px', () => {
    const dense = new Float32Array(200);
    for (let i = 0; i < 100; i += 1) {
      dense[i * 2] = i / 10;
      dense[i * 2 + 1] = 0;
    }
    expect(reduceRun(dense).length).toBeLessThan(dense.length);
    const sparse = new Float32Array([0, 0, 100, 0, 100, 100]);
    expect(reduceRun(sparse)).toEqual(sparse);
  });

  it('7.5 conic point counts follow the screen radius and halve per level', () => {
    const full = conicSegmentCount(100, 0);
    expect(conicSegmentCount(100, 1)).toBe(Math.floor(full / 2));
    expect(conicSegmentCount(100, 2)).toBe(Math.floor(full / 4));
    expect(conicSegmentCount(200, 0)).toBeGreaterThan(full);
    expect(conicSegmentCount(10, 0)).toBeLessThan(full);
  });

  it('7.5 rings clip to the view rect (Sutherland-Hodgman)', () => {
    const rect = { x0: px(0), x1: px(100), y0: px(0), y1: px(100) };
    const clipped = clipRingToRect(new Float32Array([-50, 50, 150, 50, 150, 150, -50, 150]), rect);
    for (let i = 0; i < clipped.length; i += 2) {
      const x = clipped[i] as number;
      const y = clipped[i + 1] as number;
      expect(x).toBeGreaterThanOrEqual(-1e-6);
      expect(x).toBeLessThanOrEqual(100 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(-1e-6);
      expect(y).toBeLessThanOrEqual(100 + 1e-6);
    }
    expect(clipRingToRect(new Float32Array([200, 200, 300, 200, 300, 300]), rect).length).toBe(0);
  });

  it('7.2 shiftGeometry translates cached pixels after a pan', () => {
    const g = geom({ k: 'segment', ax: 0, ay: 0, bx: 2, by: 0 }, 'segment');
    expect(g).not.toBeNull();
    if (g === null) return;
    const s = shiftGeometry(g, 10, 5);
    const run = s.strokes[0];
    expect(run).not.toBeUndefined();
    if (run !== undefined) expect(Array.from(run)).toEqual([410, 305, 510, 305]);
    expect(s.bbox?.x0).toBe((g.bbox?.x0 as number) + 10);
  });
});

describe('design 10.7 exactness', () => {
  it('10.7 point-to-segment distance with clamping', () => {
    expect(pointSegmentDistance(1, 1, 0, 0, 2, 0)).toEqual({ dist: 1, t: 0.5 });
    const end = pointSegmentDistance(5, 0, 0, 0, 2, 0);
    expect(end.dist).toBe(3);
    expect(end.t).toBe(1);
  });

  it('10.7 nearest-on-polyline refines past vertices with a param', () => {
    const n = nearestOnPolyline(new Float32Array([0, 0, 10, 0]), 5, 3);
    expect(n.dist).toBe(3);
    expect(n.param).toBe(0.5);
    const on = nearestOnPolyline(new Float32Array([0, 0, 10, 0, 10, 10]), 10, 5);
    expect(on.dist).toBe(0);
    // Arc-length fraction of the whole run: 15 of 20.
    expect(on.param).toBe(0.75);
  });

  it('10.7 even-odd point-in-polygon in pixels', () => {
    const sq = new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]);
    expect(pointInPolygon(sq, 5, 5)).toBe(true);
    expect(pointInPolygon(sq, 15, 5)).toBe(false);
  });

  it('10.7 hit priorities: point 1, text 2, edge 3, fill 4, image 5', () => {
    const at = { x: px(450), y: px(200) };
    const pt = geom({ k: 'point', x: 1, y: 2 });
    expect(pt).not.toBeNull();
    if (pt !== null) {
      const h = hitGeometry(oid(1), 'point', pt, at, 7);
      expect(h?.priority).toBe(1);
      expect(h?.part).toBe('body');
    }
    const seg = geom({ k: 'segment', ax: 0.9, ay: 2, bx: 1.1, by: 2 }, 'segment');
    if (seg !== null) {
      const h = hitGeometry(oid(2), 'segment', seg, at, 3);
      expect(h?.priority).toBe(3);
      expect(h?.part).toBe('edge');
    }
    const reg = geom({ k: 'polygon', pts: new Float64Array([0, 0, 2, 0, 2, 4, 0, 4]) }, 'region');
    if (reg !== null) {
      const h = hitGeometry(oid(3), 'region', reg, at, 0);
      expect(h?.priority).toBe(4);
      expect(h?.part).toBe('fill');
    }
  });

  it('10.7 text hits its measured rectangle expanded 2 px, priority 2', () => {
    const d = new GeometryDrawable({ id: oid(4), name: 'T', kind: 'text', order: 0, layer: 0, free: false, onPath: false, measure });
    d.update(
      { head: head(4, 'T'), value: { defined: true, value: { k: 'text', text: 'hi', atX: 1, atY: 2, screen: false } } } as never,
      testViewport(),
      testStyle('text'),
    );
    // The docs fix the rule (measured rectangle + 2 px), not the anchor alignment: use the drawable's bbox.
    const b = d.bbox;
    expect(b).not.toBeNull();
    if (b === null) return;
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    const h = d.hit({ x: px(cx), y: px(cy) }, 0);
    expect(h).not.toBeNull();
    expect(h?.priority).toBe(2);
    expect(d.hit({ x: px(b.x1 + 1.5), y: px(cy) }, 0)).not.toBeNull();
    expect(d.hit({ x: px(b.x1 + 40), y: px(cy) }, 0)).toBeNull();
    expect(d.hit({ x: px(600), y: px(500) }, 0)).toBeNull();
  });

  it('10.7 misses return null', () => {
    const pt = geom({ k: 'point', x: 1, y: 2 });
    if (pt !== null) {
      expect(hitGeometry(oid(1), 'point', pt, { x: px(0), y: px(0) }, 7)).toBeNull();
    }
  });
});

describe('design 9.4 marker outlines', () => {
  it('9.4 cross is an x, plus is a +', () => {
    const cross = markerStroke('cross', 0, 0, 4);
    expect(cross).toHaveLength(2);
    for (const [x1, y1, x2, y2] of cross) {
      expect(Math.abs(Math.abs((y2 - y1) / (x2 - x1)) - 1)).toBeLessThan(1e-9);
    }
    const plus = markerStroke('plus', 0, 0, 4);
    expect(plus).toHaveLength(2);
    const slopes = plus.map(([x1, y1, x2, y2]) => (x2 === x1 ? Number.POSITIVE_INFINITY : (y2 - y1) / (x2 - x1)));
    expect(slopes).toContain(0);
    expect(slopes).toContain(Number.POSITIVE_INFINITY);
  });

  it('9.4 open shapes report open, closed shapes closed', () => {
    for (const s of ['ring', 'cross', 'plus', 'diamond-open', 'square-open'] as const) {
      expect(markerIsOpen(s)).toBe(true);
    }
    for (const s of ['dot', 'diamond', 'square', 'triangle-up', 'triangle-down', 'triangle-left', 'triangle-right'] as const) {
      expect(markerIsOpen(s)).toBe(false);
    }
  });

  it('9.4 ring paints an open 2 px stroke with no fill', () => {
    const d = new GeometryDrawable({ id: oid(1), name: 'A', kind: 'point', order: 0, layer: 0, free: true, onPath: false, measure });
    d.update({ head: head(1, 'A'), value: { defined: true, value: { k: 'point', x: 1, y: 2 } } } as never, testViewport(), testStyle('point', { pointStyle: 'ring' }));
    const s = new RecordSurface();
    d.paint(s, {
      view: testViewport(), theme: LIGHT_THEME, selected: new Set(), hovered: null, focused: null,
      reducedMotion: false, t: 0,
    });
    const strokes = s.calls.filter((c) => c.k === 'stroke');
    expect(strokes.length).toBeGreaterThan(0);
    const first = strokes[0];
    if (first?.k === 'stroke') expect(first.st.width).toBe(2);
    expect(s.calls.some((c) => c.k === 'fill')).toBe(false);
  });

  it('9.4 dot paints an outline plus a shifted fill', () => {
    const d = new GeometryDrawable({ id: oid(1), name: 'A', kind: 'point', order: 0, layer: 0, free: true, onPath: false, measure });
    const style = testStyle('point', { pointStyle: 'dot' });
    d.update({ head: head(1, 'A'), value: { defined: true, value: { k: 'point', x: 1, y: 2 } } } as never, testViewport(), style);
    const s = new RecordSurface();
    d.paint(s, {
      view: testViewport(), theme: LIGHT_THEME, selected: new Set(), hovered: null, focused: null,
      reducedMotion: false, t: 0,
    });
    const kinds = s.calls.map((c) => c.k);
    expect(kinds).toContain('fill');
    expect(kinds).toContain('stroke');
    const fill = s.calls.find((c) => c.k === 'fill');
    const stroke = s.calls.find((c) => c.k === 'stroke');
    if (fill?.k === 'fill' && stroke?.k === 'stroke' && fill.f.kind === 'solid') {
      expect([fill.f.color.r, fill.f.color.g, fill.f.color.b]).not.toEqual([stroke.st.color.r, stroke.st.color.g, stroke.st.color.b]);
    }
  });
});
