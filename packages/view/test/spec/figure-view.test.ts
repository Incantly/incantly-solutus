/**
 * graphics-view design 12/15 and ui.md 3 to 5 through the DOM host
 * (`FigureView` in happy-dom): accessibility structure, keyboard,
 * pointer drags, gesture feedback and export. Layout does not exist in
 * happy-dom, so the host element reports 800 x 600 and frames are pumped by
 * hand through `scheduleFrame`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FigureView, SharedGpuContext } from '@incantly/view';
import type { ExportRequest, FigureViewOptions, KernelEvent } from '@incantly/view';
import { dragLog, head, okValue, oid, pumpQueue, stubKernel, stubStyles } from './helpers';
import type { StubObject } from './helpers';

interface Harness {
  readonly view: FigureView;
  readonly el: HTMLDivElement;
  readonly queue: Array<() => void>;
  readonly drag: ReturnType<typeof dragLog>;
  readonly gestures: Array<[string, string]>;
  readonly deleted: unknown[][];
  readonly overlay: HTMLCanvasElement;
  readonly objects: StubObject[];
  readonly pump: () => void;
}

function objectsDefault(): StubObject[] {
  return [
    { head: head(1, 'A'), value: { k: 'point', x: 1, y: 2 }, kind: 'point' },
    { head: head(2, 'B', { free: false }), value: { k: 'point', x: -1, y: 0 }, kind: 'point' },
    { head: head(3, 'a', { free: false, type: 'Segment' as never }), value: { k: 'segment', ax: 1, ay: 2, bx: -1, by: 0 }, kind: 'segment' },
  ];
}

function mount(objects: StubObject[] = objectsDefault(), over: Partial<FigureViewOptions> = {}): Harness {
  const shared = okValue(SharedGpuContext.create(), 'shared');
  const queue: Array<() => void> = [];
  const drag = dragLog();
  const gestures: Array<[string, string]> = [];
  const deleted: unknown[][] = [];
  const view = new FigureView({
    id: 'fig', kernel: stubKernel(objects), styles: stubStyles(objects), drag: drag.applier, snapshots: null, shared,
    meshes: { get: () => undefined }, toScript: () => 'A = (1, 2)', mode: '2d',
    scheduleFrame: (cb) => { queue.push(cb); },
    onGesture: (code, text) => { gestures.push([code, text]); },
    onDelete: (ids) => { deleted.push([...ids]); },
    ...over,
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  Object.defineProperty(el, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 600, configurable: true });
  el.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) });
  okValue(view.mount(el), 'mount');
  const events: KernelEvent[] = [{ kind: 'add', ids: objects.map((o) => o.head.id) }];
  view.applyEvents(events);
  const pump = (): void => { pumpQueue(queue, 20); };
  pump();
  const canvases = el.querySelectorAll('canvas');
  const overlay = canvases[canvases.length - 1] as HTMLCanvasElement;
  return { view, el, queue, drag, gestures, deleted, overlay, objects, pump };
}

function key(h: Harness, k: string, mods: KeyboardEventInit = {}): void {
  h.el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods }));
  h.pump();
}

function pointer(h: Harness, type: string, x: number, y: number, over: PointerEventInit = {}): void {
  h.overlay.dispatchEvent(new PointerEvent(type, {
    clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, ...over,
  }));
  h.pump();
}

/** happy-dom's WheelEvent drops clientX and ctrlKey, so build a plain event that carries them. */
function wheel(h: Harness, deltaY: number, x: number, y: number, ctrlKey: boolean): Event {
  const ev = Object.assign(new Event('wheel', { bubbles: true, cancelable: true }), { deltaY, deltaX: 0, deltaMode: 0, clientX: x, clientY: y, ctrlKey });
  h.overlay.dispatchEvent(ev);
  h.pump();
  return ev;
}

const mounted: Harness[] = [];
function setup(objects?: StubObject[], over?: Partial<FigureViewOptions>): Harness {
  const h = mount(objects, over);
  mounted.push(h);
  return h;
}

function reduceMotion(): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('reduce'), media: q, onchange: null,
    addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  reduceMotion();
});

afterEach(() => {
  for (const h of mounted.splice(0)) {
    h.view.unmount();
    h.el.remove();
  }
  vi.unstubAllGlobals();
});

describe('design 15 canvas accessibility', () => {
  it('15 the figure region has role application and can take focus', () => {
    const h = setup();
    expect(h.el.getAttribute('role')).toBe('application');
    expect(h.el.getAttribute('tabindex')).toBe('0');
  });

  it('15 the accessible name counts the objects ("Figure, 3 objects")', () => {
    const h = setup();
    expect(h.el.getAttribute('aria-label')).toContain('Figure, 3 objects');
  });

  it('15 the name follows the object count as objects are added and removed', () => {
    const h = setup();
    h.objects.splice(2, 1);
    h.view.applyEvents([{ kind: 'remove', ids: [oid(3)] }]);
    h.pump();
    expect(h.el.getAttribute('aria-label')).toContain('Figure, 2 objects');
  });

  it('15 aria-describedby points at a summary element that exists', () => {
    const h = setup();
    const id = h.el.getAttribute('aria-describedby');
    expect(id).not.toBeNull();
    expect(document.getElementById(id ?? '')).not.toBeNull();
  });

  it('15 a visually hidden list holds one option per visible, selectable object in creation order', () => {
    const h = setup();
    const items = Array.from(h.el.querySelectorAll('li'));
    expect(items).toHaveLength(3);
    for (const li of items) {
      expect(li.getAttribute('role')).toBe('option');
      expect(li.getAttribute('tabindex')).toBe('-1');
    }
  });

  it('15 each option carries the object name in data-id', () => {
    const h = setup();
    expect(Array.from(h.el.querySelectorAll('li')).map((li) => li.getAttribute('data-id'))).toEqual(['A', 'B', 'a']);
  });

  it('15 each option holds the shared description words', () => {
    const h = setup();
    const first = h.el.querySelectorAll('li')[0];
    expect(first?.textContent ?? '').toContain('Point A at 1, 2.');
  });

  it('15 dependent points say how they differ from free ones', () => {
    const h = setup();
    const second = h.el.querySelectorAll('li')[1];
    expect(second?.textContent ?? '').toContain('Point B at -1, 0.');
    expect((second?.textContent ?? '')).not.toContain('Free');
  });

  it('15 a polite live region exists for announcements', () => {
    const h = setup();
    expect(h.el.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

});

describe('ui.md 4 keyboard', () => {
  it('4 the right arrow moves focus to the first object in creation order', () => {
    const h = setup();
    key(h, 'ArrowRight');
    expect(document.activeElement?.getAttribute('data-id')).toBe('A');
  });

  it('4 the right arrow steps on to the next object, the left arrow back', () => {
    const h = setup();
    key(h, 'ArrowRight');
    key(h, 'ArrowRight');
    expect(document.activeElement?.getAttribute('data-id')).toBe('B');
    key(h, 'ArrowLeft');
    expect(document.activeElement?.getAttribute('data-id')).toBe('A');
  });

  it('4 Enter selects the focused object and Delete removes it (one onDelete call)', () => {
    const h = setup();
    key(h, 'ArrowRight');
    key(h, 'Enter');
    key(h, 'Delete');
    expect(h.deleted).toHaveLength(1);
    expect(h.deleted[0]).toEqual([oid(1)]);
  });

  it('4 Escape deselects, so Delete removes nothing', () => {
    const h = setup();
    key(h, 'ArrowRight');
    key(h, 'Enter');
    key(h, 'Escape');
    key(h, 'Delete');
    expect(h.deleted.filter((d) => d.length > 0)).toEqual([]);
  });

  it('4 Ctrl+A selects every visible, selectable object', () => {
    const h = setup();
    key(h, 'a', { ctrlKey: true });
    key(h, 'Delete');
    expect(h.deleted).toHaveLength(1);
    expect([...(h.deleted[0] ?? [])].sort()).toEqual([oid(1), oid(2), oid(3)]);
  });

  it('4 plus zooms in about the centre and minus zooms out', () => {
    const h = setup();
    const before = h.view.viewport();
    key(h, '+');
    const zoomed = h.view.viewport();
    expect(zoomed?.scaleX).toBeGreaterThan(before?.scaleX ?? 0);
    expect(zoomed?.centreX).toBeCloseTo(before?.centreX ?? 0, 9);
    expect(zoomed?.centreY).toBeCloseTo(before?.centreY ?? 0, 9);
    key(h, '-');
    expect(h.view.viewport()?.scaleX).toBeCloseTo(before?.scaleX ?? 0, 6);
  });

  it('4 Ctrl+arrow pans the view by 10% of its width', () => {
    const h = setup();
    const before = h.view.viewport();
    key(h, 'ArrowRight', { ctrlKey: true });
    const after = h.view.viewport();
    expect(Math.abs((after?.centreX ?? 0) - (before?.centreX ?? 0))).toBeCloseTo(0.1 * 800 / 50, 6);
    expect(after?.scaleX).toBe(before?.scaleX);
  });

  it('12.7 an arrow on a selected free point nudges it through the drag applier and commits', () => {
    const h = setup();
    key(h, 'ArrowRight');
    key(h, 'Enter');
    h.drag.calls.length = 0;
    key(h, 'ArrowRight');
    const moves = h.drag.calls.filter((c) => c[0] !== 'commit' && c[0] !== 'cancel');
    expect(moves.length).toBeGreaterThan(0);
    const first = moves[0]?.[0] as { k: string; x: number; y: number } | undefined;
    expect(first?.k).toBe('point');
    expect(first?.x).toBeGreaterThan(1);
    expect(first?.y).toBe(2);
    expect(h.drag.calls.some((c) => c[0] === 'commit')).toBe(true);
  });

  it('12.7 shift nudges 10 times as far, alt a tenth', () => {
    const h = setup();
    key(h, 'ArrowRight');
    key(h, 'Enter');
    const delta = (mods: KeyboardEventInit): number => {
      h.drag.calls.length = 0;
      key(h, 'ArrowRight', mods);
      const m = h.drag.calls.find((c) => c[0] !== 'commit' && c[0] !== 'cancel')?.[0] as { x: number } | undefined;
      return (m?.x ?? 1) - 1;
    };
    const base = delta({});
    expect(base).toBeGreaterThan(0);
    expect(delta({ shiftKey: true }) / base).toBeCloseTo(10, 6);
    expect(delta({ altKey: true }) / base).toBeCloseTo(0.1, 6);
  });

});

describe('design 12.2 pointer drags', () => {
  it('12.2 a free point follows the pointer; the grab offset stops it jumping to the cursor', () => {
    const h = setup();
    h.view.setSnap('off');
    pointer(h, 'pointerdown', 454, 203);
    pointer(h, 'pointermove', 504, 203);
    const moves = h.drag.calls.filter((c) => c[0] !== 'commit' && c[0] !== 'cancel');
    expect(moves.length).toBeGreaterThan(0);
    const last = moves[moves.length - 1]?.[0] as { k: string; x: number; y: number };
    expect(last.k).toBe('point');
    expect(last.x).toBeCloseTo(2, 6);
    expect(last.y).toBeCloseTo(2 - 0.0, 1);
  });

  it('12.2 pointer up commits one batched record', () => {
    const h = setup();
    h.view.setSnap('off');
    pointer(h, 'pointerdown', 450, 200);
    pointer(h, 'pointermove', 520, 200);
    pointer(h, 'pointerup', 520, 200);
    expect(h.drag.calls.filter((c) => c[0] === 'commit')).toHaveLength(1);
    expect(h.drag.calls[h.drag.calls.length - 1]).toEqual(['commit']);
  });

  it('12.2 a mouse needs 3 px of movement before a drag begins', () => {
    const h = setup();
    h.view.setSnap('off');
    pointer(h, 'pointerdown', 450, 200);
    pointer(h, 'pointermove', 452, 200);
    expect(h.drag.calls.filter((c) => c[0] !== 'commit' && c[0] !== 'cancel')).toEqual([]);
    pointer(h, 'pointermove', 456, 200);
    expect(h.drag.calls.filter((c) => c[0] !== 'commit' && c[0] !== 'cancel').length).toBeGreaterThan(0);
  });

  it('12.2 Escape during a drag cancels and restores the start values', () => {
    const h = setup();
    h.view.setSnap('off');
    pointer(h, 'pointerdown', 450, 200);
    pointer(h, 'pointermove', 520, 200);
    key(h, 'Escape');
    expect(h.drag.calls.some((c) => c[0] === 'cancel')).toBe(true);
    expect(h.drag.calls.some((c) => c[0] === 'commit')).toBe(false);
  });

  it('12.1 dragging a fixed point is refused with drag_fixed', () => {
    const objects = objectsDefault();
    objects[0] = { ...(objects[0] as StubObject), style: { fixed: true } };
    const h = setup(objects);
    pointer(h, 'pointerdown', 450, 200);
    pointer(h, 'pointermove', 520, 200);
    expect(h.drag.calls.filter((c) => c[0] !== 'commit' && c[0] !== 'cancel')).toEqual([]);
    expect(h.gestures.some(([code]) => code === 'drag_fixed')).toBe(true);
  });

  it('errors.md 4 pointer down on a dependent point says why: drag_blocked', () => {
    const h = setup();
    pointer(h, 'pointerdown', 350, 300);
    expect(h.gestures.some(([code]) => code === 'drag_blocked')).toBe(true);
    const text = h.gestures.find(([code]) => code === 'drag_blocked')?.[1] ?? '';
    expect(text.length).toBeGreaterThan(10);
  });

  it('12.2 dragging the background pans the view', () => {
    const h = setup();
    const before = h.view.viewport();
    pointer(h, 'pointerdown', 100, 100);
    pointer(h, 'pointermove', 160, 100);
    pointer(h, 'pointerup', 160, 100);
    const after = h.view.viewport();
    expect((after?.centreX ?? 0)).not.toBe(before?.centreX);
    expect(after?.scaleX).toBe(before?.scaleX);
  });
});

describe('design 4 view control through the host', () => {
  it('4 setViewRegion with equal keeps the whole requested box visible', () => {
    const h = setup();
    h.view.setViewRegion({ x0: -5 as never, x1: 5 as never, y0: -3 as never, y1: 3 as never }, 'equal', null);
    h.pump();
    const v = h.view.viewport();
    expect(v?.scaleX).toBe(v?.scaleY);
    expect(v?.scaleX).toBe(80);
  });

  it('4 setViewRegion with free fits both axes exactly', () => {
    const h = setup();
    h.view.setViewRegion({ x0: 0 as never, x1: 10 as never, y0: 0 as never, y1: 1 as never }, 'free', null);
    h.pump();
    const v = h.view.viewport();
    expect(v?.scaleX).toBe(80);
    expect(v?.scaleY).toBe(600);
  });

  it('4 home returns to the last @view without a tween', () => {
    const h = setup();
    h.view.setViewRegion({ x0: -5 as never, x1: 5 as never, y0: -3 as never, y1: 3 as never }, 'equal', null);
    key(h, '+');
    h.view.goHome();
    h.pump();
    expect(h.view.viewport()?.scaleX).toBe(80);
  });

  it('4 with no @view ever, home is x -8..8 with equal ratio', () => {
    const h = setup();
    const v = h.view.viewport();
    expect(v?.scaleX).toBe(50);
    expect(v?.scaleX).toBe(v?.scaleY);
    expect(v?.centreY).toBe(0);
  });

  it('4 Ctrl+wheel zooms about the pointer by 1.1 per 100 wheel units, keeping the point under it fixed', () => {
    const h = setup();
    const before = h.view.viewport();
    wheel(h, -100, 600, 100, true);
    const after = h.view.viewport();
    expect((after?.scaleX ?? 0) / (before?.scaleX ?? 1)).toBeCloseTo(1.1, 3);
    const mathsBefore = (600 - (before?.originX ?? 0)) / (before?.scaleX ?? 1);
    const mathsAfter = (600 - (after?.originX ?? 0)) / (after?.scaleX ?? 1);
    expect(mathsAfter).toBeCloseTo(mathsBefore, 6);
  });

  it('4 a plain scroll over an unfocused view does not capture the page scroll', () => {
    const h = setup();
    const ev = wheel(h, -100, 600, 100, false);
    expect(ev.defaultPrevented).toBe(false);
    expect(h.view.viewport()?.scaleX).toBe(50);
  });

  it('4 a plain scroll over a focused view zooms', () => {
    const h = setup();
    h.el.focus();
    wheel(h, -100, 600, 100, false);
    expect(h.view.viewport()?.scaleX).toBeGreaterThan(50);
  });

  it('4 double-click on the background zooms in 1.5x about the pointer; shift zooms out', () => {
    const h = setup();
    const before = h.view.viewport();
    h.overlay.dispatchEvent(new MouseEvent('dblclick', { clientX: 100, clientY: 100, bubbles: true, cancelable: true }));
    h.pump();
    expect((h.view.viewport()?.scaleX ?? 0) / (before?.scaleX ?? 1)).toBeCloseTo(1.5, 6);
    h.overlay.dispatchEvent(new MouseEvent('dblclick', { clientX: 100, clientY: 100, bubbles: true, cancelable: true, shiftKey: true }));
    h.pump();
    expect((h.view.viewport()?.scaleX ?? 0) / (before?.scaleX ?? 1)).toBeCloseTo(1, 6);
  });

  it('errors.md 4 wheel zoom past the limit reports zoom_limit ("Can\'t zoom further.")', () => {
    const h = setup();
    for (let i = 0; i < 400; i += 1) wheel(h, -100, 400, 300, true);
    const hit = h.gestures.find(([code]) => code === 'zoom_limit');
    expect(hit).toBeDefined();
    expect(hit?.[1]).toContain("Can't zoom further");
  });

  it('errors.md 4 a zoom stopped by the limit leaves the view unchanged', () => {
    const h = setup();
    for (let i = 0; i < 400; i += 1) wheel(h, -100, 400, 300, true);
    const stuck = JSON.stringify(h.view.viewport());
    wheel(h, -100, 400, 300, true);
    expect(JSON.stringify(h.view.viewport())).toBe(stuck);
  });

  it('4 the persisted view slice restores the bounds, grid and axes', () => {
    const h = setup();
    h.view.setViewRegion({ x0: -2 as never, x1: 6 as never, y0: -1 as never, y1: 5 as never }, 'equal', null);
    h.pump();
    const saved = h.view.persistView();
    const scale = h.view.viewport()?.scaleX;
    key(h, '+');
    key(h, '+');
    h.view.restoreView(saved);
    h.pump();
    expect(h.view.viewport()?.scaleX).toBeCloseTo(scale ?? 0, 6);
    expect(h.view.persistView().home).toEqual(saved.home);
  });

});

describe('design 14 export through the host', () => {
  const svgReq: ExportRequest = { format: 'svg', region: 'view', background: 'view', includeGrid: true, includeAxes: true };

  it('14.2 SVG export returns a document', () => {
    const h = setup();
    const s = okValue(h.view.exportSvg(svgReq), 'svg');
    expect(s.trimStart().startsWith('<svg') || s.trimStart().startsWith('<?xml')).toBe(true);
    expect(s).toContain('</svg>');
  });

  it('14.2 element ids are the object names so authors can post-edit', () => {
    const h = setup();
    const s = okValue(h.view.exportSvg(svgReq), 'svg');
    expect(s).toContain('id="A"');
    expect(s).toContain('id="B"');
  });

  it('14.5 the same request gives the same bytes', () => {
    const h = setup();
    expect(okValue(h.view.exportSvg(svgReq), 'a')).toBe(okValue(h.view.exportSvg(svgReq), 'b'));
  });

  it('14.2 every drawable is rebuilt for the export viewport (a 1200 x 900 export puts A at 675,300)', () => {
    const h = setup();
    const s = okValue(h.view.exportSvg(svgReq), 'svg');
    // Region -8..8 by -6..6 at 1200 px wide is 75 px/unit about (600, 450): A (1, 2) -> (675, 300), B (-1, 0) -> (525, 450).
    expect(s).toContain('M675,300L525,450');
  });

  it('14.2 export does not change the live view', () => {
    const h = setup();
    const before = JSON.stringify(h.view.viewport());
    okValue(h.view.exportSvg({ ...svgReq, region: { x0: 0, x1: 4, y0: 0, y1: 4 } }), 'svg');
    expect(JSON.stringify(h.view.viewport())).toBe(before);
  });

  it('14.2 the grid and axes can be left out', () => {
    const h = setup();
    const withGrid = okValue(h.view.exportSvg(svgReq), 'with');
    const without = okValue(h.view.exportSvg({ ...svgReq, includeGrid: false, includeAxes: false }), 'without');
    expect(without.length).toBeLessThan(withGrid.length);
  });

  it('14.2 a bad request returns an error object instead of throwing', () => {
    const h = setup();
    expect(() => h.view.exportSvg({ ...svgReq, format: 'pdf' as never })).not.toThrow();
    expect(h.view.exportSvg({ ...svgReq, format: 'pdf' as never }).ok).toBe(false);
  });

  it('14.2 script export returns the figure script', () => {
    const h = setup();
    expect(h.view.exportScript()).toBe('A = (1, 2)');
  });

  it('14.2 PNG export resolves to a result and never throws (no OffscreenCanvas needed to answer)', async () => {
    const h = setup();
    const r = await h.view.exportPng({ ...svgReq, format: 'png', size: { widthPx: 200 } });
    expect(typeof r.ok).toBe('boolean');
  });

  it('14.2 a PNG over 16,384 px is refused with limit before any canvas is made', async () => {
    const h = setup();
    const r = await h.view.exportPng({ ...svgReq, format: 'png', size: { widthPx: 20000 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('limit');
  });
});

describe('design 7 and 9.7 highlight and lifecycle', () => {
  it('15 announcing added objects after speech reaches the live region', () => {
    const h = setup();
    h.view.announceAdded('circle', 'c', 'radius 3');
    h.pump();
    const live = h.el.querySelector('[aria-live]');
    expect(live?.textContent ?? '').toContain('Added circle c, radius 3');
  });

  it('15 a drag end announces the new place: "A moved to ..."', () => {
    const h = setup();
    h.view.setSnap('off');
    pointer(h, 'pointerdown', 450, 200);
    pointer(h, 'pointermove', 500, 200);
    pointer(h, 'pointerup', 500, 200);
    const live = h.el.querySelector('[aria-live]');
    expect(live?.textContent ?? '').toMatch(/^A moved to /);
  });

  it('1 unmount removes the canvases and the reader list', () => {
    const h = setup();
    h.view.unmount();
    expect(h.el.querySelectorAll('canvas')).toHaveLength(0);
    expect(h.el.querySelectorAll('li')).toHaveLength(0);
  });

  it('errors.md 3 a view with no layout (0 x 0) pauses drawing without an error', () => {
    const shared = okValue(SharedGpuContext.create(), 'shared');
    const objects = objectsDefault();
    const queue: Array<() => void> = [];
    const view = new FigureView({
      id: 'z', kernel: stubKernel(objects), styles: stubStyles(objects), drag: dragLog().applier, snapshots: null, shared,
      meshes: { get: () => undefined }, toScript: () => '', mode: '2d', scheduleFrame: (cb) => { queue.push(cb); },
    });
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(view.mount(el).ok).toBe(true);
    view.applyEvents([{ kind: 'add', ids: objects.map((o) => o.head.id) }]);
    expect(() => pumpQueue(queue, 10)).not.toThrow();
    view.unmount();
    el.remove();
  });
});
