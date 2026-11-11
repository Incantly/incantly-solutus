/**
 * graphics-view/design.md 3 (coordinate systems) and 4 (zoom, pan, view).
 * Pure mapping maths, tested through the public core API.
 */
import { describe, expect, it } from 'vitest';
import {
  clipSegmentToRect,
  createMapper,
  createViewport,
  defaultHome,
  fitAllRegion,
  isDegenerateView,
  maths,
  panBy,
  px,
  resolveAnchor,
  smooth,
  tweenViewport,
  viewportFromRegion,
  zoomAbout,
} from '@incantly/view';
import { closeTo, errOf, okValue, testViewport } from './helpers';

describe('design 3 coordinate systems', () => {
  it('3 toPx is originX + x*scaleX, originY - y*scaleY (y flips)', () => {
    const m = createMapper(testViewport());
    const p = m.toPx({ x: maths(1), y: maths(2) });
    expect(p.x).toBe(450);
    expect(p.y).toBe(200);
    const o = m.toPx({ x: maths(0), y: maths(0) });
    expect(o.x).toBe(400);
    expect(o.y).toBe(300);
  });

  it('3 toMaths inverts toPx (round trip)', () => {
    const m = createMapper(testViewport());
    for (const [x, y] of [[1, 2], [-4, -2.5], [0, 0], [7.99, -5.99]] as const) {
      const back = m.toMaths(m.toPx({ x: maths(x), y: maths(y) }));
      closeTo(back.x, x);
      closeTo(back.y, y);
    }
  });

  it('3 free ratio: x and y scales map independently', () => {
    const v = okValue(
      createViewport({ widthPx: 800, heightPx: 600, centreX: 0, centreY: 0, scaleX: 80, scaleY: 100 }),
      'free viewport',
    );
    const m = createMapper(v);
    expect(m.toPx({ x: maths(1), y: maths(1) })).toEqual({ x: 480, y: 200 });
  });

  it('3 lengthPx scales a maths vector to screen length', () => {
    const m = createMapper(testViewport());
    expect(m.lengthPx(3, 4)).toBe(250);
    expect(m.lengthPx(1, 0)).toBe(50);
    expect(m.lengthPx(0, 0)).toBe(0);
  });

  it('3 bounds() is the visible maths rectangle', () => {
    expect(createMapper(testViewport()).bounds()).toEqual({ x0: -8, x1: 8, y0: -6, y1: 6 });
  });

  it('3 mapping follows the quoted centre-relative formula exactly', () => {
    const v = testViewport();
    const m = createMapper(v);
    for (const [x, y] of [[1, 2], [-4.25, 0.125], [0, -6]] as const) {
      const got = m.toPx({ x: maths(x), y: maths(y) });
      expect(got.x).toBe((x - v.centreX) * v.scaleX + v.width / 2);
      expect(got.y).toBe((v.centreY - y) * v.scaleY + v.height / 2);
    }
  });

  it('3 centre-relative mapping stays within the input quantum at 1e-9 wide around 1e6', () => {
    const v = okValue(
      createViewport({ widthPx: 800, heightPx: 600, centreX: 1e6, centreY: 0, scaleX: 8e11, scaleY: 8e11 }),
      'deep zoom',
    );
    const m = createMapper(v);
    const c = m.toPx({ x: maths(1e6), y: maths(0) });
    expect(c.x).toBe(400);
    expect(c.y).toBe(300);
    // Input coords near 1e6 quantise to ~1.2e-10 (~93 px here); the mapping
    // must add no further error beyond that input quantum.
    const edge = m.toPx({ x: maths(1e6 + 5e-10), y: maths(0) });
    expect(Math.abs(edge.x - 800)).toBeLessThanOrEqual(100);
    // A naive origin-based mapping would round on the 8e17 scale instead.
    const naive = (400 - 1e6 * 8e11) + (1e6 + 5e-10) * 8e11;
    expect(Math.abs(naive - 800)).toBeGreaterThan(Math.abs(edge.x - 800));
  });

  it('3 zoom refuses below 1e-10 * |centre| with precision_limit, view unchanged', () => {
    // Width 1e-3 around 1e6: inside the absolute limits, above the 1e-4 floor.
    const v = okValue(
      createViewport({ widthPx: 800, heightPx: 600, centreX: 1e6, centreY: 0, scaleX: 8e5, scaleY: 8e5 }),
      'near the floor',
    );
    const r = zoomAbout(v, { x: px(400), y: px(300) }, 100);
    expect(r.refused).toBe('precision_limit');
    expect(r.viewport).toBe(v);
  });

  it('3 clipSegmentToRect clips a 1e12 endpoint to the view rectangle', () => {
    const rect = { x0: px(0), x1: px(800), y0: px(0), y1: px(600) };
    const c = clipSegmentToRect(400, 300, 1e12, 300, rect);
    expect(c).not.toBeNull();
    if (c !== null) {
      expect(c[0]).toBe(400);
      expect(c[1]).toBe(300);
      expect(c[2]).toBe(800);
      expect(c[3]).toBe(300);
    }
  });

  it('3 clipSegmentToRect keeps an inside segment and nulls a miss', () => {
    const rect = { x0: px(0), x1: px(800), y0: px(0), y1: px(600) };
    expect(clipSegmentToRect(10, 10, 20, 20, rect)).toEqual([10, 10, 20, 20]);
    expect(clipSegmentToRect(-100, -100, -50, -50, rect)).toBeNull();
    expect(clipSegmentToRect(-100, 300, 900, 300, rect)).toEqual([0, 300, 800, 300]);
  });

  it('3 maths anchors move with the view (same as toPx)', () => {
    const v = testViewport();
    const m = createMapper(v);
    const p = { x: maths(1), y: maths(2) };
    expect(resolveAnchor({ space: 'maths', p }, v)).toEqual(m.toPx(p));
  });

  it('3 view anchors stay put: offsets from tl/tr/bl/br corners', () => {
    const v = testViewport();
    const at = (from: 'tl' | 'tr' | 'bl' | 'br'): { x: number; y: number } =>
      resolveAnchor({ space: 'view', p: { x: px(12), y: px(20) }, from }, v);
    expect(at('tl')).toEqual({ x: 12, y: 20 });
    expect(at('tr')).toEqual({ x: 788, y: 20 });
    expect(at('bl')).toEqual({ x: 12, y: 580 });
    expect(at('br')).toEqual({ x: 788, y: 580 });
  });

  it('3 zero-sized canvas input is rejected; a laid-out view is not degenerate', () => {
    // Canvas size comes from layout, not @view; the constructor refuses 0.
    // The runtime pause (errors.md degenerate_view) is a FigureView behaviour.
    const r = createViewport({ widthPx: 0, heightPx: 0, centreX: 0, centreY: 0, scaleX: 50, scaleY: 50 });
    const e = errOf(r, 'zero canvas');
    expect(e.code).toMatch(/^V\d{3}$/);
    expect(isDegenerateView(testViewport())).toBe(false);
  });

  it('3 createViewport rejects non-positive scales and sizes', () => {
    for (const bad of [
      { scaleX: 0, scaleY: 50 },
      { scaleX: -3, scaleY: 50 },
      { scaleX: 50, scaleY: 0 },
      { widthPx: -800, heightPx: 600 },
    ] as const) {
      const r = createViewport({ widthPx: 800, heightPx: 600, centreX: 0, centreY: 0, scaleX: 50, scaleY: 50, ...bad });
      const e = errOf(r, 'bad viewport');
      expect(e.code).toMatch(/^V\d{3}$/);
    }
  });

  it('3 a Viewport is immutable: zoom/pan/tween return new objects', () => {
    const v = testViewport();
    const z = zoomAbout(v, { x: px(400), y: px(300) }, 2);
    expect(z.viewport).not.toBe(v);
    expect(v.scaleX).toBe(50);
    const p = panBy(v, 10, 10);
    expect(p).not.toBe(v);
    expect(v.centreX).toBe(0);
    const t = tweenViewport(v, p, 0.5);
    expect(t).not.toBe(v);
    expect(t).not.toBe(p);
  });
});

describe('design 4 zoom, pan and the view', () => {
  it('4 default home is x -8..8, equal ratio, y centred at 0', () => {
    expect(defaultHome(800, 600)).toEqual({ x0: -8, x1: 8, y0: -6, y1: 6 });
  });

  it('4 equal fit widens the shorter axis and never crops the request', () => {
    const v = okValue(
      viewportFromRegion({ x0: maths(-5), x1: maths(5), y0: maths(-3), y1: maths(3) }, 800, 600, 'equal'),
      'equal fit',
    );
    expect(v.scaleX).toBe(v.scaleY);
    expect(v.scaleX).toBe(80);
    const b = createMapper(v).bounds();
    expect(b.x0).toBeLessThanOrEqual(-5);
    expect(b.x1).toBeGreaterThanOrEqual(5);
    expect(b.y0).toBeLessThanOrEqual(-3);
    expect(b.y1).toBeGreaterThanOrEqual(3);
    closeTo(b.y0, -3.75);
    closeTo(b.y1, 3.75);
  });

  it('4 free fit lets x and y scales differ', () => {
    const v = okValue(
      viewportFromRegion({ x0: maths(0), x1: maths(10), y0: maths(0), y1: maths(1) }, 800, 600, 'free'),
      'free fit',
    );
    expect(v.scaleX).toBe(80);
    expect(v.scaleY).toBe(600);
  });

  it('4 zoom keeps the maths point under the pointer still', () => {
    const v = testViewport();
    const m0 = createMapper(v);
    const at = { x: px(450), y: px(200) };
    const under = m0.toMaths(at);
    const z = zoomAbout(v, at, 2);
    expect(z.refused).toBeUndefined();
    const m1 = createMapper(z.viewport);
    const still = m1.toMaths(at);
    closeTo(still.x, under.x);
    closeTo(still.y, under.y);
    expect(z.viewport.scaleX).toBe(100);
  });

  it('4 zoom keeps a free ratio: both scales move by the same k', () => {
    const v = okValue(
      createViewport({ widthPx: 800, heightPx: 600, centreX: 0, centreY: 0, scaleX: 80, scaleY: 100 }),
      'free',
    );
    const z = zoomAbout(v, { x: px(400), y: px(300) }, 1.5);
    expect(z.viewport.scaleX).toBe(120);
    expect(z.viewport.scaleY).toBe(150);
  });

  it('4 zoom past the limits is refused with zoom_limit, not an error object', () => {
    const v = testViewport();
    const r = zoomAbout(v, { x: px(400), y: px(300) }, 1e12);
    expect(r.refused).toBe('zoom_limit');
    expect(r.viewport).toBe(v);
    expect('kind' in r).toBe(false);
    const out = zoomAbout(v, { x: px(400), y: px(300) }, 1e-12);
    expect(out.refused).toBe('zoom_limit');
    expect(out.viewport).toBe(v);
  });

  it('4 panBy moves the scene with the background drag', () => {
    const p = panBy(testViewport(), 40, -20);
    closeTo(p.centreX, -0.8);
    closeTo(p.centreY, -0.4);
    expect(p.scaleX).toBe(50);
    expect(p.scaleY).toBe(50);
  });

  it('4 smooth(x) = x*x*(3-2*x)', () => {
    expect(smooth(0)).toBe(0);
    expect(smooth(1)).toBe(1);
    expect(smooth(0.5)).toBe(0.5);
    closeTo(smooth(0.25), 0.15625);
    closeTo(smooth(0.75), 0.84375);
  });

  it('4 tween endpoints are exact: t=0 from, t=1 to', () => {
    const a = testViewport();
    const b = panBy(zoomAbout(a, { x: px(400), y: px(300) }, 2).viewport, 40, 0);
    const t0 = tweenViewport(a, b, 0);
    closeTo(t0.scaleX, a.scaleX);
    closeTo(t0.centreX, a.centreX);
    const t1 = tweenViewport(a, b, 1);
    closeTo(t1.scaleX, b.scaleX);
    closeTo(t1.centreX, b.centreX);
  });

  it('4 tween interpolates log-scales and centre: midpoint is geometric', () => {
    const a = testViewport();
    const b = zoomAbout(a, { x: px(400), y: px(300) }, 4).viewport;
    const mid = tweenViewport(a, b, 0.5);
    closeTo(mid.scaleX, 100);
    closeTo(mid.scaleY, 100);
    closeTo(mid.centreX, 0);
  });

  it('4 tween is pure in t: seeking the same t gives the same view', () => {
    const a = testViewport();
    const b = panBy(a, 100, 60);
    const t1 = tweenViewport(a, b, 0.37);
    const t2 = tweenViewport(a, b, 0.37);
    expect(t1).toEqual(t2);
  });

  it('4 fitAllRegion covers every item with an 8% margin', () => {
    const r = fitAllRegion([
      { x0: maths(0), x1: maths(10), y0: maths(0), y1: maths(4) },
      { x0: maths(-2), x1: maths(2), y0: maths(1), y1: maths(3) },
    ]);
    expect(r).not.toBeNull();
    if (r !== null) {
      expect(r.x0).toBeLessThanOrEqual(-2);
      expect(r.x1).toBeGreaterThanOrEqual(10);
      expect(r.y0).toBeLessThanOrEqual(0);
      expect(r.y1).toBeGreaterThanOrEqual(4);
      const w = r.x1 - r.x0;
      const h = r.y1 - r.y0;
      expect(w).toBeGreaterThanOrEqual(12);
      expect(w).toBeLessThanOrEqual(12 * 1.25);
      expect(h).toBeGreaterThanOrEqual(4);
    }
  });

  it('4 fitAllRegion honours a custom pad and nulls on empty input', () => {
    const one = [{ x0: maths(0), x1: maths(10), y0: maths(0), y1: maths(10) }];
    const small = fitAllRegion(one, 0);
    const big = fitAllRegion(one, 0.5);
    expect(small).not.toBeNull();
    expect(big).not.toBeNull();
    if (small !== null && big !== null) {
      expect(big.x1 - big.x0).toBeGreaterThan(small.x1 - small.x0);
    }
    expect(fitAllRegion([])).toBeNull();
  });
});
