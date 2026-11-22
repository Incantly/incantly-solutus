/**
 * BR-82 (handoff/board/findings.md; design 9 item 7; B36 in docs/state-machines.md): the shapes a person's gesture moves
 * are lifted out of the tiles. Every move used to draw their tiles again, a few a frame within the frame's budget, and
 * the tiles not drawn yet showed parts of a dragged picture or square where it had been. Now the first write of a
 * gesture draws the tiles once without the shape, the view draws it on the overlay at its place each frame, and when the
 * gesture ends it settles back into the tiles.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIFT_MACHINE, LIFT_MAX, Lift, beginGesture, diffRegions, mountBoardView, patchShapes, putNewShape } from '../../src/index';
import type { BoardView, Diff, ShapeRecord } from '../../src/index';
import { installGpu } from './gl-helpers';
import { sample } from './ink-helpers';
import type { GpuProbe } from './gl-helpers';
import { drag, pageOf, press, rect, release, shapeRig } from './shape-helpers';
import { stubBrowser } from './view-helpers';
import type { Browser } from './view-helpers';

const BOX = { minX: -2, minY: -2, maxX: 514, maxY: 514 };
const ids = (items: readonly { readonly id: string }[]): string[] => items.map((i) => i.id);

describe('a person\'s gesture holds the shapes it writes above the tiles (BR-82, B36)', () => {
  it('a drag with the select tool holds the dragged shape while it moves and lets it settle when it ends', () => {
    const rig = shapeRig();
    const a = rect(rig, 100, 100);
    const b = rect(rig, 300, 100);
    expect(rig.core.lift.state).toBe('resting');
    // on its edge (an unfilled rectangle is picked by its line)
    press(rig, [
      [100, 130],
      [120, 140],
      [140, 150],
    ]);
    expect(rig.core.lift.state).toBe('held');
    expect([...rig.core.lift.held]).toEqual([a.id]);
    // the tiles are drawn without it; the other shape stays in them
    expect(ids(planAll(rig, rig.core.lift.held))).toEqual([b.id]);
    release(rig, 140, 150);
    expect(rig.core.lift.state).toBe('resting');
    expect(rig.core.lift.held.size).toBe(0);
    expect([...rig.core.lift.settling]).toEqual([a.id]);
    expect(ids(planAll(rig, rig.core.lift.held))).toEqual([a.id, b.id]);
  });

  it('the end of a gesture tells the listeners which shapes it let go, once', () => {
    const rig = shapeRig();
    const a = rect(rig, 100, 100);
    const told: string[][] = [];
    const stop = rig.core.lift.onRelease((let_go) => told.push([...let_go]));
    drag(rig, [100, 130], [200, 180]);
    expect(told).toEqual([[a.id]]);
    stop();
    drag(rig, [200, 180], [260, 200]);
    expect(told).toEqual([[a.id]]);
  });

  it('a cancelled gesture lets its shapes go too, back where they were', () => {
    const rig = shapeRig();
    const a = rect(rig, 100, 100);
    const g = beginGesture(rig.core);
    expect(patchShapes(rig.core, new Map([[a.id, { x: 400 }]]), { gesture: g }).ok).toBe(true);
    expect(rig.core.lift.isHeld(a.id)).toBe(true);
    g.cancel();
    expect(rig.core.lift.state).toBe('resting');
    expect(rig.core.lift.isHeld(a.id)).toBe(false);
    expect((rig.core.store.get(a.id) as ShapeRecord).x).toBe(100);
  });

  it('the model\'s gestures hold nothing: its hand draws what it makes', () => {
    const rig = shapeRig();
    const a = rect(rig, 100, 100);
    const g = beginGesture(rig.core, 'model');
    expect(patchShapes(rig.core, new Map([[a.id, { x: 400 }]]), { gesture: g }).ok).toBe(true);
    expect(rig.core.lift.state).toBe('resting');
    g.commit();
    expect(rig.core.lift.settling.size).toBe(0);
  });

  it(`at most ${LIFT_MAX} shapes are held; the rest stay in the tiles`, () => {
    const lift = new Lift();
    const many = Array.from({ length: LIFT_MAX + 5 }, (_, i) => ({ id: `shape:${i}` }));
    lift.take({ added: many, removed: [], updated: [] } as unknown as Diff);
    expect(lift.held.size).toBe(LIFT_MAX);
  });

  it('a removed shape is let go, and records that are not shapes are never held', () => {
    const lift = new Lift();
    lift.take({ added: [{ id: 'shape:a' }, { id: 'binding:x' }], removed: [], updated: [] } as unknown as Diff);
    expect([...lift.held]).toEqual(['shape:a']);
    lift.take({ added: [], removed: [{ id: 'shape:a' }], updated: [] } as unknown as Diff);
    expect(lift.held.size).toBe(0);
  });

  it('the machine: resting refuses release, held takes hold again', () => {
    expect(Object.keys(LIFT_MACHINE.resting)).toEqual(['hold']);
    expect(LIFT_MACHINE.held).toEqual({ hold: 'held', release: 'resting' });
  });

  it('diffRegions leaves out the shapes held above the tiles', () => {
    const rig = shapeRig();
    const a = rect(rig, 100, 100);
    const b = rect(rig, 300, 100);
    const diff = { added: [], removed: [], updated: [a, b].map((s) => ({ before: s, after: { ...s, x: s.x + 10 } })) } as unknown as Diff;
    expect(diffRegions(diff, pageOf(rig), rig.core.store.kinds).length).toBe(4);
    expect(diffRegions(diff, pageOf(rig), rig.core.store.kinds, new Set([a.id])).length).toBe(2);
  });
});

/** The ids of every item of the plan of the tile at the origin, the shapes in `leave` left out. */
function planAll(rig: ReturnType<typeof shapeRig>, leave: ReadonlySet<string>): { readonly id: string }[] {
  const plan = rig.core.drawList.plan(BOX, 1, leave);
  while (!plan.more(1000)) continue;
  return plan.items;
}

describe('in the view, a drag draws no tile again after its first move (BR-82)', () => {
  let probe: GpuProbe;
  let browser: Browser;
  let container: HTMLElement;
  let view: BoardView;
  beforeEach(() => {
    probe = installGpu();
    browser = stubBrowser(800, 600);
    container = document.createElement('div');
    document.body.append(container);
    const made = mountBoardView({ container });
    if (!made.ok) throw new Error(made.message);
    view = made.value;
  });
  afterEach(() => {
    view.dispose();
    container.remove();
    browser.restore();
    probe.restore();
  });

  /** A mouse sample at a page point. */
  const move = (phase: 'down' | 'move' | 'up', x: number, y: number, time: number): void => {
    const at = view.core.camera?.toScreen(x, y) ?? { x, y };
    view.host.sample(sample({ device: 'mouse', pressure: Number.NaN, phase, x: at.x, y: at.y, time, buttons: phase === 'up' ? 0 : 1, modifiers: 0 }));
  };
  /** The tile at step 0 that holds the page point (100, 100). */
  const tile = (): { state: string } => {
    const t = view.painter.tiles.get(0, 0, 0);
    if (t === undefined) throw new Error(`no tile at the origin; camera at ${String(view.core.camera?.x)}, ${String(view.core.camera?.y)}`);
    return t;
  };

  it('the tile under a dragged rectangle is drawn once when the drag starts and stays fresh while it moves; it is drawn again with the rectangle when the drag ends', () => {
    const made = view.core.store.change('user', (tx) => putNewShape(tx, view.core.store, { kind: 'rect', page: view.core.pages.current as string, x: 100, y: 100, props: { w: 120, h: 80 } }));
    expect(made.ok).toBe(true);
    const id = made.ok && made.value.value.ok ? made.value.value.value.id : '';
    view.host.setTool('select');
    for (let t = 0; t < 8; t++) view.render(t * 16);
    expect(tile().state).toBe('fresh');
    move('down', 100, 140, 200);
    move('move', 120, 150, 208);
    view.render(216);
    // the first write took the rectangle out: the tile was drawn again, without it
    expect(tile().state).toBe('fresh');
    expect({ held: view.core.lift.isHeld(id), selected: [...view.core.selection.ids], tool: view.host.tool }).toEqual({ held: true, selected: [id], tool: 'select' });
    for (let i = 0; i < 10; i++) {
      move('move', 130 + i * 5, 150 + i * 3, 224 + i * 16);
      expect(tile().state).toBe('fresh');
      view.render(232 + i * 16);
    }
    move('up', 190, 180, 500);
    expect(tile().state).toBe('stale');
    expect([...view.core.lift.settling]).toEqual([id]);
    view.render(520);
    expect(tile().state).toBe('fresh');
    view.render(536);
    expect(view.core.lift.settling.size).toBe(0);
  });
});
