import { describe, expect, it } from 'vitest';
import { FigureView, SharedGpuContext } from '@incantly/view';

function setup(id: string, log: string[]): {
  view: FigureView; el: HTMLDivElement; pump: (n: number) => number; canvas: HTMLCanvasElement; dragCalls: unknown[];
} {
  const shared = SharedGpuContext.create();
  if (!shared.ok) throw new Error('no shared');
  const queue: Array<() => void> = [];
  const dragCalls: unknown[] = [];
  const view = new FigureView({
    id, kernel: {
      heads: () => [
        { id: 1, name: 'A', type: 'Point', order: 0, version: 1, styleVersion: 1, free: true, onPath: false },
        { id: 2, name: 'B', type: 'Point', order: 1, version: 1, styleVersion: 1, free: true, onPath: false },
        { id: 3, name: 's', type: 'Number', order: 2, version: 1, styleVersion: 1, free: true, onPath: false },
      ],
      head: (n: number) => (n === 1
        ? { id: 1, name: 'A', type: 'Point', order: 0, version: 1, styleVersion: 1, free: true, onPath: false }
        : n === 2
          ? { id: 2, name: 'B', type: 'Point', order: 1, version: 1, styleVersion: 1, free: true, onPath: false }
          : { id: 3, name: 's', type: 'Number', order: 2, version: 1, styleVersion: 1, free: true, onPath: false }),
      valueOf: (n: number) => (n === 1
        ? { defined: true, value: { k: 'point', x: -4, y: -2 } }
        : n === 2
          ? { defined: true, value: { k: 'point', x: 4, y: 2 } }
          : { defined: true, value: { k: 'slider', v: 3, lo: 0, hi: 10, step: 0.5 } }),
      freeParentsOf: () => [], particlesOf: () => undefined, pathOf: () => undefined,
    } as never,
    styles: {
      authoredOf: (n: number) => (n === 3 ? { kind: 'widget', free: true, style: {} } : { kind: 'point', free: true, style: {} }),
      evaluator: () => undefined,
    } as never,
    drag: { drag: (m: unknown) => { dragCalls.push(m); }, commitDrag: () => { dragCalls.push('commit'); }, cancelDrag: () => { dragCalls.push('cancel'); } } as never,
    snapshots: null, shared: shared.value, meshes: { get: () => undefined }, toScript: () => '',
    scheduleFrame: (cb: () => void) => { queue.push(cb); },
    onDelete: (ids: unknown) => { log.push('deleted=' + JSON.stringify(ids)); },
  });
  const el = document.createElement('div');
  el.style.width = '800px';
  el.style.height = '600px';
  document.body.appendChild(el);
  view.mount(el);
  view.applyEvents([{ kind: 'add', ids: [1, 2, 3] } as never]);
  const pump = (n: number): number => {
    let c = 0;
    while (queue.length > 0 && c < n) { (queue.shift() as () => void)(); c += 1; }
    return c;
  };
  pump(3);
  return { view, el, pump, canvas: el.querySelectorAll('canvas')[2] as HTMLCanvasElement, dragCalls };
}

describe('probe15', () => {
  it('bandonly shiftclickonly', () => {
    const log: string[] = [];
    const { view, el, pump, canvas } = setup('p15a', log);
    // band only
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100, pointerId: 1, pointerType: 'mouse', shiftKey: true }));
    for (let i = 1; i <= 6; i += 1) canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 100 + i * 100, clientY: 100 + i * 66, pointerId: 1, pointerType: 'mouse', shiftKey: true }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 700, clientY: 500, pointerId: 1, pointerType: 'mouse' }));
    pump(2);
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Delete' }));
    pump(1);
    log.push('bandDone');
    view.unmount();
    el.remove();
    const log2: string[] = [];
    const s2 = setup('p15b', log2);
    // shift-click only: click A then shift-click B
    s2.canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 400, pointerId: 1, pointerType: 'mouse' }));
    s2.canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 200, clientY: 400, pointerId: 1, pointerType: 'mouse' }));
    s2.pump(1);
    s2.canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 600, clientY: 200, pointerId: 1, pointerType: 'mouse', shiftKey: true }));
    s2.canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 600, clientY: 200, pointerId: 1, pointerType: 'mouse' }));
    s2.pump(1);
    s2.el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Delete' }));
    s2.pump(1);
    log2.push('shiftDone');
    // eslint-disable-next-line no-console
    console.log('LOG1 ' + log.join(' | '));
    // eslint-disable-next-line no-console
    console.log('LOG2 ' + log2.join(' | '));
    s2.view.unmount();
    s2.el.remove();
    expect(true).toBe(true);
  });
  it('axisoffset snappos nudge sliderkeys sliderSvg', () => {
    const log: string[] = [];
    const { view, el, pump, canvas, dragCalls } = setup('p15c', log);
    // axis with offsets
    const off = (e: PointerEvent, x: number, y: number): PointerEvent => {
      Object.defineProperty(e, 'offsetX', { value: x, configurable: true });
      Object.defineProperty(e, 'offsetY', { value: y, configurable: true });
      return e;
    };
    canvas.dispatchEvent(off(new PointerEvent('pointerdown', { bubbles: true, clientX: 600, clientY: 300, pointerId: 1, pointerType: 'mouse' }), 600, 300));
    for (let i = 1; i <= 5; i += 1) canvas.dispatchEvent(off(new PointerEvent('pointermove', { bubbles: true, clientX: 600, clientY: 300 + i * 10, pointerId: 1, pointerType: 'mouse' }), 600, 300 + i * 10));
    canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 600, clientY: 350, pointerId: 1, pointerType: 'mouse' }));
    pump(2);
    log.push('axisOff=' + String(view.viewport()?.scaleY));
    // snap positive: grid step 2 (scale 50); drag A(-4,-2 @200,400) to (-3.9,-2 @205,400)
    view.setSnap('grid');
    pump(2);
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 400, pointerId: 1, pointerType: 'mouse' }));
    canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 205, clientY: 400, pointerId: 1, pointerType: 'mouse' }));
    canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 206, clientY: 400, pointerId: 1, pointerType: 'mouse' }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 206, clientY: 400, pointerId: 1, pointerType: 'mouse' }));
    log.push('snap2=' + JSON.stringify(dragCalls).slice(0, 260));
    // nudge: select A then ArrowRight
    dragCalls.length = 0;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 400, pointerId: 1, pointerType: 'mouse' }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 200, clientY: 400, pointerId: 1, pointerType: 'mouse' }));
    pump(1);
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    pump(1);
    log.push('nudge=' + JSON.stringify(dragCalls).slice(0, 260));
    // slider keys: focus slider (3rd in creation order) via arrows from scratch? Escape first
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    pump(1);
    dragCalls.length = 0;
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    pump(1);
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    pump(1);
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    pump(1);
    log.push('sliderKey=' + JSON.stringify(dragCalls).slice(0, 260));
    const w0 = view.exportSvg({ format: 'svg', region: 'view', background: 'view', includeGrid: false, includeAxes: false } as never);
    const w1 = view.exportSvg({ format: 'svg', region: 'view', background: 'view', includeGrid: false, includeAxes: false, includeWidgets: true } as never);
    log.push('wOff=' + String(w0.ok && w0.value.includes('id="s"')) + ' wOn=' + String(w1.ok && w1.value.includes('id="s"')));
    // eslint-disable-next-line no-console
    console.log(log.join('\n'));
    view.unmount();
    el.remove();
    expect(true).toBe(true);
  });
});
