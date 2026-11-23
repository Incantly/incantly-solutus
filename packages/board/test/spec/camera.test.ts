// @vitest-environment node
/**
 * R3.4 (design 9.1 and 9.5, B4): zoom 0.05 to 20 about a point; the steady zoom catches up 150 ms after the last
 * change, with time given by the caller.
 */
import { describe, expect, it, vi } from 'vitest';
import { Camera, STEADY_DELAY_MS, ZOOM_MAX, ZOOM_MIN, toPage, toScreen } from '../../src/index';

const near = (a: number, b: number, eps = 1e-9): void => void expect(Math.abs(a - b)).toBeLessThanOrEqual(eps * Math.max(1, Math.abs(a), Math.abs(b)));

describe('constants of the design', () => {
  it('has zoom limits 0.05 and 20 and a steady delay of 150 ms', () => {
    expect(ZOOM_MIN).toBe(0.05);
    expect(ZOOM_MAX).toBe(20);
    expect(STEADY_DELAY_MS).toBe(150);
  });
});

describe('screen and page points', () => {
  it('starts at the origin with zoom 1, where a screen pixel is a page unit', () => {
    const c = new Camera();
    expect([c.x, c.y, c.zoom, c.steadyZoom]).toEqual([0, 0, 1, 1]);
    expect(c.toPage(30, 40)).toEqual({ x: 30, y: 40 });
  });

  it('takes the page point at the top-left of the screen as x, y (camera at x, y, zoom z)', () => {
    const c = new Camera({ x: 100, y: 50, zoom: 2 });
    expect(c.toPage(0, 0)).toEqual({ x: 100, y: 50 });
    expect(c.toPage(20, 10)).toEqual({ x: 110, y: 55 });
    expect(c.toScreen(110, 55)).toEqual({ x: 20, y: 10 });
  });

  it('toPage and toScreen are inverses, as methods and as free functions', () => {
    const c = new Camera({ x: -37.5, y: 812.25, zoom: 0.37 });
    for (const [sx, sy] of [[0, 0], [100, 200], [1234.5, -88.25]] as const) {
      const p = c.toPage(sx, sy);
      const s = c.toScreen(p.x, p.y);
      near(s.x, sx);
      near(s.y, sy);
      expect(toPage(c, sx, sy)).toEqual(p);
      expect(toScreen(c, p.x, p.y)).toEqual(s);
    }
  });

  it('pans so the page follows the pointer', () => {
    const c = new Camera({ x: 0, y: 0, zoom: 2 });
    const before = c.toPage(300, 200);
    c.panBy(50, -20);
    // the page point that was under (300, 200) is now under (350, 180)
    const under = c.toPage(350, 180);
    near(under.x, before.x);
    near(under.y, before.y);
  });

  it('visibleBounds gives the page box of a screen, grown by the margin in screen pixels', () => {
    const c = new Camera({ x: 100, y: 200, zoom: 2 });
    const v = c.visibleBounds(800, 600);
    expect(v).toEqual({ minX: 100, minY: 200, maxX: 500, maxY: 500 });
    const m = c.visibleBounds(800, 600, 256);
    expect(m).toEqual({ minX: 100 - 128, minY: 200 - 128, maxX: 500 + 128, maxY: 500 + 128 });
  });
});

describe('zoom about a point', () => {
  it('keeps the page point under the pointer fixed', () => {
    const c = new Camera({ x: 40, y: -60, zoom: 1.5 });
    const under = c.toPage(321, 123);
    c.zoomAbout(6, 321, 123, 0);
    expect(c.zoom).toBe(6);
    const after = c.toPage(321, 123);
    near(after.x, under.x);
    near(after.y, under.y);
  });

  it('zoomBy multiplies the zoom about the point', () => {
    const c = new Camera({ zoom: 2 });
    const under = c.toPage(77, 99);
    c.zoomBy(1.5, 77, 99, 0);
    near(c.zoom, 3);
    const after = c.toPage(77, 99);
    near(after.x, under.x);
    near(after.y, under.y);
  });

  it('clamps the zoom to 0.05 at the low end and 20 at the high end, and still keeps the point', () => {
    const c = new Camera();
    c.zoomAbout(1000, 50, 60, 0);
    expect(c.zoom).toBe(20);
    c.zoomAbout(0.0001, 50, 60, 10);
    expect(c.zoom).toBe(0.05);
    c.zoomAbout(-3, 50, 60, 20);
    expect(c.zoom).toBeGreaterThanOrEqual(0.05);
    const p = c.toPage(50, 60);
    c.zoomBy(1e9, 50, 60, 30);
    expect(c.zoom).toBe(20);
    const q = c.toPage(50, 60);
    near(q.x, p.x);
    near(q.y, p.y);
    c.zoomBy(1e-9, 50, 60, 40);
    expect(c.zoom).toBe(0.05);
  });

  it('clamps the starting zoom and moveTo as well', () => {
    expect(new Camera({ zoom: 100 }).zoom).toBeLessThanOrEqual(20);
    expect(new Camera({ zoom: 0 }).zoom).toBeGreaterThanOrEqual(0.05);
    const c = new Camera();
    c.moveTo(1, 2, 99, 0);
    expect(c.zoom).toBe(20);
    c.moveTo(1, 2, 0.0001, 5);
    expect(c.zoom).toBe(0.05);
    expect([c.x, c.y]).toEqual([1, 2]);
  });

  it('accepts every zoom from 0.05 to 20 as it is', () => {
    const c = new Camera();
    for (const z of [0.05, 0.1, 0.5, 1, 2.5, 10, 20]) {
      c.zoomAbout(z, 0, 0, 0);
      expect(c.zoom).toBe(z);
    }
  });

  it('ignores a number that is not finite and changes nothing', () => {
    const c = new Camera({ x: 5, y: 6, zoom: 2 });
    c.zoomAbout(Number.NaN, 1, 1, 0);
    c.zoomAbout(Number.POSITIVE_INFINITY, 1, 1, 0);
    c.zoomAbout(3, Number.NaN, 1, 0);
    c.zoomAbout(3, 1, Number.POSITIVE_INFINITY, 0);
    c.zoomBy(Number.NaN, 1, 1, 0);
    c.panBy(Number.NaN, 1);
    c.panBy(1, Number.NEGATIVE_INFINITY);
    c.moveTo(Number.NaN, 0, 1, 0);
    c.moveTo(0, 0, Number.NaN, 0);
    expect([c.x, c.y, c.zoom, c.steadyZoom, c.motion]).toEqual([5, 6, 2, 2, 'steady']);
  });
});

describe('steady zoom (150 ms after the last change, time from the caller)', () => {
  it('leaves steadyZoom at its old value while zooming and moves it 150 ms after the last change', () => {
    const c = new Camera();
    c.zoomAbout(2, 0, 0, 1000);
    expect(c.motion).toBe('zooming');
    expect(c.zoom).toBe(2);
    expect(c.steadyZoom).toBe(1);
    expect(c.tick(1100)).toBe(false);
    expect(c.steadyZoom).toBe(1);
    expect(c.tick(1149)).toBe(false);
    expect(c.motion).toBe('zooming');
    expect(c.tick(1150)).toBe(true);
    expect(c.steadyZoom).toBe(2);
    expect(c.motion).toBe('steady');
  });

  it('returns true once, at the moment of catching up, then false', () => {
    const c = new Camera();
    c.zoomAbout(3, 0, 0, 0);
    expect(c.tick(500)).toBe(true);
    expect(c.tick(501)).toBe(false);
    expect(c.tick(5000)).toBe(false);
    expect(c.steadyZoom).toBe(3);
  });

  it('restarts the 150 ms from the last zoom change, not the first', () => {
    const c = new Camera();
    c.zoomAbout(2, 0, 0, 0);
    c.zoomAbout(3, 0, 0, 100);
    c.zoomAbout(4, 0, 0, 200);
    expect(c.tick(300)).toBe(false);
    expect(c.steadyZoom).toBe(1);
    expect(c.tick(349)).toBe(false);
    expect(c.tick(350)).toBe(true);
    expect(c.steadyZoom).toBe(4);
  });

  it('settles at once when the clock went back (a time before the last change)', () => {
    const c = new Camera();
    c.zoomAbout(2, 0, 0, 10_000);
    expect(c.tick(5)).toBe(true);
    expect(c.motion).toBe('steady');
    expect(c.steadyZoom).toBe(2);
  });

  it('does not count a pan, or a zoom clamped to the same value, as a zoom change', () => {
    const c = new Camera();
    c.panBy(100, 100);
    expect(c.motion).toBe('steady');
    expect(c.tick(1)).toBe(false);
    c.zoomAbout(20, 0, 0, 0);
    c.tick(1000);
    c.zoomAbout(20, 0, 0, 2000);
    expect(c.motion).toBe('steady');
    expect(c.tick(2150)).toBe(false);
  });

  it('keeps the exact zoom for the pointer maths while the steady zoom lags', () => {
    const c = new Camera();
    c.zoomAbout(4, 10, 10, 0);
    const p = c.toPage(110, 110);
    near(p.x, 35);
    near(p.y, 35);
    expect(c.zoom).toBe(4);
    expect(c.steadyZoom).toBe(1);
  });

  it('moveTo changes the zoom the same way a zoom does, with the caller’s time', () => {
    const c = new Camera();
    c.moveTo(0, 0, 5, 100);
    expect(c.motion).toBe('zooming');
    expect(c.tick(250)).toBe(true);
    expect(c.steadyZoom).toBe(5);
  });

  it('never reads a clock of its own: no Date, performance or timer is touched', () => {
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now used');
    });
    const perf = vi.spyOn(performance, 'now').mockImplementation(() => {
      throw new Error('performance.now used');
    });
    const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => {
      throw new Error('setTimeout used');
    });
    const raf = vi.spyOn(globalThis, 'setInterval').mockImplementation(() => {
      throw new Error('setInterval used');
    });
    try {
      const c = new Camera();
      c.zoomAbout(2, 1, 1, 0);
      c.zoomBy(2, 1, 1, 10);
      c.panBy(1, 1);
      c.moveTo(1, 1, 3, 20);
      expect(c.tick(40)).toBe(false);
      expect(c.tick(170)).toBe(true);
      expect(dateNow).not.toHaveBeenCalled();
      expect(perf).not.toHaveBeenCalled();
      expect(timer).not.toHaveBeenCalled();
      expect(raf).not.toHaveBeenCalled();
    } finally {
      dateNow.mockRestore();
      perf.mockRestore();
      timer.mockRestore();
      raf.mockRestore();
    }
  });
});
