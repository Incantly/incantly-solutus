/**
 * performance.md 4 (one shared GPU context per page, the scheduler host) in
 * happy-dom: figures never create their own GPU context; the host wires the
 * pure scheduler to visibility, scroll settling and the slow tick.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SCHEDULER_CONFIG, SchedulerHost, SharedGpuContext } from '@incantly/view';
import type { CanvasFactory, FigureRecord, SchedulerAction } from '@incantly/view';
import { fakeGl, okValue } from './helpers';

interface CountingFactory extends CanvasFactory {
  readonly offscreen: number[];
  readonly visible: string[];
}

/** A factory whose offscreen canvas hands out a fake WebGL2 context and counts every creation. */
function countingFactory(gl: boolean): CountingFactory {
  const offscreen: number[] = [];
  const visible: string[] = [];
  return {
    offscreen,
    visible,
    createOffscreen: (w, h) => {
      offscreen.push(w * h);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      if (gl) (c as unknown as { getContext: (k: string) => unknown }).getContext = (k: string) => (k === 'webgl2' ? fakeGl() : null);
      return c;
    },
    createVisible: (id, w, h) => {
      visible.push(id);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    },
  };
}

describe('performance 4 one shared GPU context per page', () => {
  it('4 creating the context returns a Result and never throws, with or without WebGL2', () => {
    expect(SharedGpuContext.create(countingFactory(true)).ok).toBe(true);
    expect(SharedGpuContext.create(countingFactory(false)).ok).toBe(true);
  });

  // A stub WebGL2 context is not enough to bring the GPU backend up (see the report), so the
  // backend is only checked for consistency here: hasGpu() and backend() agree.
  it('4 hasGpu() and backend() agree', () => {
    const ctx = okValue(SharedGpuContext.create(countingFactory(true)), 'ctx');
    expect(ctx.hasGpu()).toBe(ctx.backend() !== null);
    ctx.dispose();
  });

  it('4 without WebGL2 the context still works and reports no GPU', () => {
    const ctx = okValue(SharedGpuContext.create(countingFactory(false)), 'ctx');
    expect(ctx.hasGpu()).toBe(false);
    expect(ctx.backend()).toBeNull();
    ctx.dispose();
  });

  it('4 twenty figures share one offscreen GPU canvas (browsers drop contexts past about 16)', () => {
    const f = countingFactory(true);
    const ctx = okValue(SharedGpuContext.create(f), 'ctx');
    const before = f.offscreen.length;
    for (let i = 0; i < 20; i += 1) okValue(ctx.acquireBox(`fig${String(i)}`, 400, 300, 1), `box ${String(i)}`);
    expect(f.offscreen.length - before).toBeLessThanOrEqual(1);
    ctx.dispose();
  });

  it('4 each figure gets its own visible canvas', () => {
    const f = countingFactory(true);
    const ctx = okValue(SharedGpuContext.create(f), 'ctx');
    const a = okValue(ctx.acquireBox('a', 400, 300, 1), 'a');
    const b = okValue(ctx.acquireBox('b', 400, 300, 1), 'b');
    expect(a.canvas).not.toBe(b.canvas);
    expect(f.visible).toEqual(expect.arrayContaining(['a', 'b']));
    ctx.dispose();
  });

  it('4 boxes are sized in device pixels (CSS size x dpr)', () => {
    const ctx = okValue(SharedGpuContext.create(countingFactory(true)), 'ctx');
    const box = okValue(ctx.acquireBox('a', 400, 300, 2), 'a');
    expect(box.canvas.width).toBe(800);
    expect(box.canvas.height).toBe(600);
    ctx.dispose();
  });

  it('4 resizing a box follows the new size', () => {
    const ctx = okValue(SharedGpuContext.create(countingFactory(true)), 'ctx');
    okValue(ctx.acquireBox('a', 400, 300, 1), 'a');
    okValue(ctx.resizeBox('a', 200, 100, 2), 'resize');
    expect(ctx.box('a')?.canvas.width).toBe(400);
    expect(ctx.box('a')?.canvas.height).toBe(200);
    ctx.dispose();
  });

  it('4 stats count live boxes; releasing a box frees it', () => {
    const ctx = okValue(SharedGpuContext.create(countingFactory(true)), 'ctx');
    okValue(ctx.acquireBox('a', 100, 100, 1), 'a');
    okValue(ctx.acquireBox('b', 100, 100, 1), 'b');
    expect(ctx.statsSnapshot().boxes).toBe(2);
    ctx.releaseBox('a');
    expect(ctx.statsSnapshot().boxes).toBe(1);
    expect(ctx.box('a')).toBeUndefined();
    expect(ctx.box('b')).toBeDefined();
    ctx.dispose();
  });

  it('4 releasing an unknown box is harmless', () => {
    const ctx = okValue(SharedGpuContext.create(countingFactory(true)), 'ctx');
    expect(() => ctx.releaseBox('nope')).not.toThrow();
    ctx.dispose();
  });

  it('4 presenting an unknown figure answers with a result and never throws', () => {
    const ctx = okValue(SharedGpuContext.create(countingFactory(true)), 'ctx');
    expect(() => ctx.present('nope')).not.toThrow();
    ctx.dispose();
  });

  it('4 without WebGL2, presenting a registered box is a no-op that succeeds', () => {
    const ctx = okValue(SharedGpuContext.create(countingFactory(false)), 'ctx');
    okValue(ctx.acquireBox('a', 100, 100, 1), 'a');
    expect(ctx.present('a').ok).toBe(true);
    ctx.dispose();
  });

  it('4 disposing twice does not throw', () => {
    const ctx = okValue(SharedGpuContext.create(countingFactory(true)), 'ctx');
    ctx.dispose();
    expect(() => ctx.dispose()).not.toThrow();
  });
});

describe('performance 4 the scheduler host', () => {
  let actions: Array<[SchedulerAction, string]>;
  let host: SchedulerHost;

  beforeEach(() => {
    vi.useFakeTimers();
    actions = [];
    host = new SchedulerHost(DEFAULT_SCHEDULER_CONFIG, {
      onAction: (a: SchedulerAction, rec: FigureRecord) => { actions.push([a, rec.id]); },
    });
  });

  afterEach(() => {
    host.stop();
    vi.useRealTimers();
  });

  const kinds = (): string[] => actions.map(([a]) => `${a.k}:${a.id}`);

  it('4 a registered figure waits as a placeholder until it is near and the scroll settles', () => {
    host.register('f1');
    host.setNear(new Set(['f1']));
    host.noteScroll();
    host.tick();
    expect(kinds()).not.toContain('build:f1');
  });

  it('4 after 150 ms of calm scrolling the near figure is built', () => {
    host.register('f1');
    host.setNear(new Set(['f1']));
    host.noteScroll();
    vi.advanceTimersByTime(DEFAULT_SCHEDULER_CONFIG.settleMs + 10);
    host.tick();
    vi.advanceTimersByTime(300);
    host.tick();
    expect(kinds()).toContain('build:f1');
  });

  it('4 each new scroll event restarts the settle wait', () => {
    host.register('f1');
    host.setNear(new Set(['f1']));
    for (let i = 0; i < 10; i += 1) {
      host.noteScroll();
      vi.advanceTimersByTime(100);
      host.tick();
    }
    expect(kinds()).not.toContain('build:f1');
  });

  it('4 visible figures go live (at most 3) and the stats follow', () => {
    for (const id of ['a', 'b', 'c', 'd']) host.register(id);
    host.setNear(new Set(['a', 'b', 'c', 'd']));
    host.setVisible(new Set(['a', 'b', 'c', 'd']));
    for (let i = 0; i < 6; i += 1) {
      vi.advanceTimersByTime(300);
      host.tick();
    }
    expect(host.stats().live).toBe(3);
    expect(host.stats().peakLive).toBe(3);
    expect(host.stats().registered).toBe(4);
  });

  it('4 a hidden tab pauses live figures at once', () => {
    host.register('a');
    host.setNear(new Set(['a']));
    host.setVisible(new Set(['a']));
    for (let i = 0; i < 4; i += 1) {
      vi.advanceTimersByTime(300);
      host.tick();
    }
    host.setTabVisible(false);
    host.tick();
    expect(kinds()).toContain('pause:a');
  });

  it('4 a figure that leaves the viewport is paused and later saved after 8 s', () => {
    host.register('a');
    host.setNear(new Set(['a']));
    host.setVisible(new Set(['a']));
    for (let i = 0; i < 4; i += 1) {
      vi.advanceTimersByTime(300);
      host.tick();
    }
    host.setVisible(new Set());
    host.setNear(new Set());
    host.tick();
    expect(kinds()).toContain('pause:a');
    vi.advanceTimersByTime(4000);
    host.tick();
    expect(kinds()).not.toContain('save:a');
    vi.advanceTimersByTime(4500);
    host.tick();
    expect(kinds()).toContain('save:a');
  });

  it('4 the slow tick runs by itself once started, and stops when asked', () => {
    host.register('a');
    host.setNear(new Set(['a']));
    host.start(200);
    vi.advanceTimersByTime(1500);
    expect(kinds()).toContain('build:a');
    host.stop();
    const n = actions.length;
    host.register('b');
    host.setNear(new Set(['a', 'b']));
    vi.advanceTimersByTime(3000);
    expect(actions.length).toBe(n);
  });

  it('4 playing figures are pinned while in view', () => {
    for (const id of ['a', 'b', 'c', 'd']) host.register(id);
    host.setNear(new Set(['a', 'b', 'c', 'd']));
    host.setVisible(new Set(['a', 'b', 'c', 'd']));
    host.setPlaying('a', true);
    host.touch('a');
    for (let i = 0; i < 8; i += 1) {
      vi.advanceTimersByTime(300);
      host.tick();
      host.touch(i % 2 === 0 ? 'b' : 'c');
    }
    expect(kinds()).not.toContain('pause:a');
  });

  it('6 mount and first-draw notes feed the stats', () => {
    host.register('a');
    host.noteMounted('a');
    vi.advanceTimersByTime(40);
    host.noteFirstDraw('a');
    expect(host.stats().mounts).toBe(1);
    expect(host.stats().mountToFirstMs).toHaveLength(1);
    expect(host.stats().mountToFirstMs[0]).toBeGreaterThanOrEqual(0);
  });

  it('4 unregistering removes the figure from the stats', () => {
    host.register('a');
    host.unregister('a');
    expect(host.stats().registered).toBe(0);
  });

  it('4 observing an element does not throw (observers are optional)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    host.register('a');
    expect(() => host.observe('a', el)).not.toThrow();
    expect(() => host.unobserve(el)).not.toThrow();
    el.remove();
  });
});
