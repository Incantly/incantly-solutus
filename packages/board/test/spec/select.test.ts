// @vitest-environment node
/**
 * The select tool (docs/features/board/ui.md "Shapes and editing"; design 7.4; docs/state-machines.md B19, B22):
 * click, Shift-click, box drag, move, the 8 resize handles, the rotate handle, the kind's own handles, snap guides
 * (edges, centres, equal gaps, the page grid), locked shapes, frames and groups. Each gesture is one undo step.
 * Only the public API is used.
 */
import { describe, expect, it } from 'vitest';
import { Snapper, frameOf, groupShapes, handlesOf, shapeGeometry } from '../../src/index';
import type { FrameHandle, ShapeRecord } from '../../src/index';
import { dump } from './helpers';
import { sample } from './ink-helpers';
import { MOD_SHIFT, add, boxOf, centreOf, drag, get, key, ofKind, pageOf, plain, press, release, shapeRig, shapesOf, tap } from './shape-helpers';
import type { BoardRig } from './shape-helpers';

/** A filled rect, so a click inside it hits. */
const solid = (rig: BoardRig, x: number, y: number, w = 100, h = 60, over: Partial<ShapeRecord> = {}): ShapeRecord => add(rig, 'rect', x, y, { w, h, fill: '#ffcc00' }, over);

const ids = (rig: BoardRig): readonly string[] => [...rig.core.selection.ids].sort();
const sorted = (list: readonly string[]): readonly string[] => [...list].sort();

/** The handles of the current selection at the camera's zoom. */
function handles(rig: BoardRig): readonly FrameHandle[] {
  const frame = frameOf(rig.core, rig.core.selection.ids);
  if (frame === undefined) return [];
  return handlesOf(rig.core, frame, rig.core.camera?.zoom ?? 1);
}

function handle(rig: BoardRig, id: string): FrameHandle {
  const h = handles(rig).find((x) => x.id === id);
  if (h === undefined) throw new Error(`no handle ${id}; there are ${handles(rig).map((x) => x.id).join(', ')}`);
  return h;
}

/** Drags a handle by `dx, dy` in page units. */
function pull(rig: BoardRig, id: string, dx: number, dy: number, mods = 0, t0 = 0): void {
  const h = handle(rig, id);
  drag(rig, [h.x, h.y], [h.x + dx, h.y + dy], mods, 8, t0);
}

const dims = (rig: BoardRig, id: string): { x: number; y: number; w: number; h: number } => {
  const b = boxOf(rig, id);
  return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
};

describe('click and Shift-click (B19)', () => {
  it('a click on a shape selects it, a click on empty page clears the selection', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    tap(rig, 150, 130);
    expect(ids(rig)).toEqual([a.id]);
    tap(rig, 600, 600, 0, 1000);
    expect(ids(rig)).toEqual([]);
  });

  it('a click on another shape replaces the selection', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100);
    tap(rig, 150, 130);
    tap(rig, 350, 130, 0, 1000);
    expect(ids(rig)).toEqual([b.id]);
    expect(rig.core.selection.has(a.id)).toBe(false);
  });

  it('a click selects the topmost of shapes that overlap', () => {
    const rig = shapeRig();
    solid(rig, 100, 100);
    const top = solid(rig, 130, 110);
    tap(rig, 160, 130);
    expect(ids(rig)).toEqual([top.id]);
  });

  it('Shift-click adds a shape to the selection and Shift-click on a selected shape takes it out', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100);
    tap(rig, 150, 130);
    tap(rig, 350, 130, MOD_SHIFT, 1000);
    expect(ids(rig)).toEqual(sorted([a.id, b.id]));
    tap(rig, 150, 130, MOD_SHIFT, 2000);
    expect(ids(rig)).toEqual([b.id]);
  });

  it('Shift-click on empty page keeps the selection', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    tap(rig, 150, 130);
    tap(rig, 600, 600, MOD_SHIFT, 1000);
    expect(ids(rig)).toEqual([a.id]);
  });

  it('a click on one shape of a group selects the whole group', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100);
    const c = solid(rig, 600, 100);
    const grouped = groupShapes(rig.core, [a.id, b.id]);
    expect(grouped.ok).toBe(true);
    tap(rig, 150, 130);
    expect(ids(rig)).toEqual(sorted([a.id, b.id]));
    tap(rig, 650, 130, 0, 1000);
    expect(ids(rig)).toEqual([c.id]);
    tap(rig, 350, 130, 0, 2000);
    expect(ids(rig)).toEqual(sorted([a.id, b.id]));
  });

  it('selecting is not an undo step and writes nothing to the store', () => {
    const rig = shapeRig();
    solid(rig, 100, 100);
    solid(rig, 300, 100);
    const steps = rig.core.history.undoSteps;
    const before = dump(rig.core.store);
    tap(rig, 150, 130);
    tap(rig, 350, 130, MOD_SHIFT, 1000);
    drag(rig, [0, 0], [500, 300], 0, 6, 2000);
    tap(rig, 900, 900, 0, 3000);
    expect(rig.core.history.undoSteps).toBe(steps);
    expect(dump(rig.core.store)).toBe(before);
  });

  it('a click on a locked shape selects it', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100, 100, 60, { locked: true });
    tap(rig, 150, 130);
    expect(ids(rig)).toEqual([a.id]);
  });

  it('a double click on a shape that holds text opens the text editor on it', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    tap(rig, 150, 130, 0, 0);
    expect(rig.core.editor.state).toBe('closed');
    tap(rig, 150, 130, 0, 120);
    expect(rig.core.editor.state).toBe('editing');
    expect(rig.core.editor.shapeId).toBe(a.id);
  });

  it('two clicks far apart in time, or in place, are not a double click', () => {
    const rig = shapeRig();
    solid(rig, 100, 100, 300, 200);
    tap(rig, 150, 130, 0, 0);
    tap(rig, 150, 130, 0, 5000);
    expect(rig.core.editor.state).toBe('closed');
    tap(rig, 150, 130, 0, 6000);
    tap(rig, 300, 250, 0, 6100);
    expect(rig.core.editor.state).toBe('closed');
  });

  it('a double click on a shape with no text does not open the editor', () => {
    const rig = shapeRig();
    const a = add(rig, 'line', 100, 100, { points: [0, 0, 200, 0], size: 6 });
    tap(rig, 200, 100, 0, 0);
    tap(rig, 200, 100, 0, 100);
    expect(rig.core.editor.state).toBe('closed');
    expect(rig.core.selection.has(a.id)).toBe(true);
  });

  it('a double click on a locked shape does not open the editor', () => {
    const rig = shapeRig();
    solid(rig, 100, 100, 100, 60, { locked: true });
    tap(rig, 150, 130, 0, 0);
    tap(rig, 150, 130, 0, 100);
    expect(rig.core.editor.state).toBe('closed');
  });

  it('Enter on a selected shape that holds text opens the editor; Enter on a shape with no text does nothing', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const line = add(rig, 'line', 100, 300, { points: [0, 0, 200, 0] });
    rig.core.selection.set([a.id]);
    expect(key(rig, 'Enter')).toBe(true);
    expect(rig.core.editor.shapeId).toBe(a.id);
    rig.core.editor.commit();
    rig.core.selection.set([line.id]);
    key(rig, 'Enter');
    expect(rig.core.editor.state).toBe('closed');
  });

  it('a press while the editor is open closes it first, and keeps what was typed', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    rig.core.editor.open(a.id);
    rig.core.editor.set('hello');
    tap(rig, 600, 600);
    expect(rig.core.editor.state).toBe('closed');
    expect((get(rig, a.id).props as { label: string }).label).toBe('hello');
  });
});

describe('box drag (B19)', () => {
  it('a box drag on empty page selects the shapes it meets, whole or in part', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100);
    const far = solid(rig, 800, 800);
    drag(rig, [50, 50], [320, 120]);
    expect(ids(rig)).toEqual(sorted([a.id, b.id]));
    expect(rig.core.selection.has(far.id)).toBe(false);
  });

  it('a box that meets nothing leaves nothing selected', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    rig.core.selection.set([a.id]);
    drag(rig, [500, 500], [600, 600]);
    expect(ids(rig)).toEqual([]);
  });

  it('the box is on the overlay while the pointer is down and gone after', () => {
    const rig = shapeRig();
    solid(rig, 100, 100);
    press(rig, [[50, 50], [200, 150], [250, 180]]);
    expect(rig.overlay.marquee).toEqual({ minX: 50, minY: 50, maxX: 250, maxY: 180 });
    release(rig, 250, 180);
    expect(rig.overlay.marquee).toBeNull();
  });

  it('the selection follows the box while it grows and shrinks', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100);
    const move = (x: number, y: number, t: number): void =>
      rig.host.sample(sample({ device: 'mouse', pressure: Number.NaN, phase: 'move', x, y, time: t, buttons: 1 }));
    press(rig, [[50, 50], [150, 120]]);
    expect(ids(rig)).toEqual([a.id]);
    move(350, 120, 100);
    expect(ids(rig)).toEqual(sorted([a.id, b.id]));
    move(150, 120, 200);
    expect(ids(rig)).toEqual([a.id]);
    release(rig, 150, 120);
    expect(ids(rig)).toEqual([a.id]);
  });

  it('a box drag is not an undo step', () => {
    const rig = shapeRig();
    solid(rig, 100, 100);
    const steps = rig.core.history.undoSteps;
    drag(rig, [50, 50], [300, 300]);
    expect(rig.core.history.undoSteps).toBe(steps);
  });

  it('a box that holds a group selects the group', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 400, 100);
    groupShapes(rig.core, [a.id, b.id]);
    drag(rig, [90, 90], [220, 180]);
    expect(ids(rig)).toEqual(sorted([a.id, b.id]));
  });
});

describe('move (B19)', () => {
  it('dragging a shape moves it by the pointer, and the drag selects it', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    drag(rig, [150, 130], [190, 160]);
    expect(dims(rig, a.id)).toEqual({ x: 140, y: 130, w: 100, h: 60 });
    expect(ids(rig)).toEqual([a.id]);
  });

  it('a drag is one undo step however many moves it had; undo and redo move the shape back and forth', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const steps = rig.core.history.undoSteps;
    drag(rig, [150, 130], [350, 330], 0, 40);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    expect(dims(rig, a.id).x).toBe(300);
    rig.core.history.undo();
    expect(dims(rig, a.id)).toEqual({ x: 100, y: 100, w: 100, h: 60 });
    rig.core.history.redo();
    expect(dims(rig, a.id).x).toBe(300);
  });

  it('two drags are two undo steps', () => {
    const rig = shapeRig();
    solid(rig, 100, 100);
    const steps = rig.core.history.undoSteps;
    drag(rig, [150, 130], [250, 230]);
    drag(rig, [250, 230], [350, 330], 0, 6, 1000);
    expect(rig.core.history.undoSteps).toBe(steps + 2);
  });

  it('all the selected shapes move by the same amount', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 200);
    rig.core.selection.set([a.id, b.id]);
    drag(rig, [150, 130], [180, 110]);
    expect(dims(rig, a.id)).toMatchObject({ x: 130, y: 80 });
    expect(dims(rig, b.id)).toMatchObject({ x: 330, y: 180 });
  });

  it('a locked shape in the selection stays; the others move', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100, 100, 60, { locked: true });
    rig.core.selection.set([a.id, b.id]);
    drag(rig, [150, 130], [170, 180]);
    expect(dims(rig, a.id)).toMatchObject({ x: 120, y: 150 });
    expect(dims(rig, b.id)).toMatchObject({ x: 300, y: 100 });
  });

  it('a locked shape alone cannot be moved by dragging', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100, 100, 60, { locked: true });
    const before = get(rig, a.id);
    drag(rig, [150, 130], [250, 230]);
    expect(get(rig, a.id)).toEqual(before);
  });

  it('a group moves as one, with every member', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100);
    groupShapes(rig.core, [a.id, b.id]);
    drag(rig, [150, 130], [180, 230]);
    expect(dims(rig, a.id)).toMatchObject({ x: 130, y: 200 });
    expect(dims(rig, b.id)).toMatchObject({ x: 330, y: 200 });
  });

  it('a frame moves with everything it holds', () => {
    const rig = shapeRig();
    const f = add(rig, 'frame', 100, 100, { w: 400, h: 300 });
    const inner = solid(rig, 150, 150, 80, 60, { parent: f.id });
    drag(rig, [300, 100], [340, 130]);
    expect(get(rig, f.id)).toMatchObject({ x: 140, y: 130 });
    expect(get(rig, inner.id)).toMatchObject({ x: 190, y: 180 });
    expect(get(rig, inner.id).parent).toBe(f.id);
  });

  it('a shape dropped inside a frame is parented to it; one dragged out of its frame is not', () => {
    const rig = shapeRig();
    const f = add(rig, 'frame', 100, 100, { w: 400, h: 300 });
    const a = solid(rig, 700, 100, 80, 60);
    drag(rig, [740, 130], [300, 250]);
    expect(get(rig, a.id).parent).toBe(f.id);
    drag(rig, [300, 250], [800, 600], 0, 8, 1000);
    expect(get(rig, a.id).parent).toBeNull();
  });

  it('dropping into a frame and the move are one undo step; undo gives back the place and the parent', () => {
    const rig = shapeRig();
    const f = add(rig, 'frame', 100, 100, { w: 400, h: 300 });
    const a = solid(rig, 700, 100, 80, 60);
    const steps = rig.core.history.undoSteps;
    drag(rig, [740, 130], [300, 250]);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    rig.core.history.undo();
    expect(get(rig, a.id)).toMatchObject({ x: 700, y: 100, parent: null });
    expect(get(rig, f.id).parent).toBeNull();
  });

  it('a cancel puts every shape back as it was', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100);
    rig.core.selection.set([a.id, b.id]);
    const before = plain([get(rig, a.id), get(rig, b.id)]);
    press(rig, [[150, 130], [200, 180], [260, 230]]);
    expect(dims(rig, a.id).x).not.toBe(100);
    rig.host.sample(sample({ device: 'mouse', pressure: Number.NaN, phase: 'cancel', x: 260, y: 230, time: 400, buttons: 0 }));
    expect(plain([get(rig, a.id), get(rig, b.id)])).toBe(before);
    expect(rig.core.history.canRedo).toBe(false);
  });

  it('Escape in the middle of a drag puts the shape back', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    press(rig, [[150, 130], [250, 230]]);
    key(rig, 'Escape');
    expect(dims(rig, a.id)).toMatchObject({ x: 100, y: 100 });
  });

  it('the pointer must pass the slop of 4 screen pixels before a shape moves', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    press(rig, [[150, 130], [152, 131]]);
    expect(dims(rig, a.id)).toMatchObject({ x: 100, y: 100 });
    release(rig, 152, 131);
    expect(dims(rig, a.id)).toMatchObject({ x: 100, y: 100 });
  });

  it('the move is the pointer in page units at another zoom: 40 screen pixels at zoom 2 are 20 units', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    rig.core.camera?.moveTo(0, 0, 2, 0);
    drag(rig, [300, 260], [340, 260]);
    expect(dims(rig, a.id).x).toBeCloseTo(120, 6);
  });
});

describe('the 8 resize handles (ui.md; design 7.4)', () => {
  it('a rect alone shows 8 resize handles and one rotate handle, at the corners and the middles of its sides', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100, 100, 60);
    rig.core.selection.set([a.id]);
    const hs = handles(rig);
    expect(hs.filter((h) => h.kind === 'resize').map((h) => h.id).sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
    expect(hs.filter((h) => h.kind === 'rotate')).toHaveLength(1);
    const at = (id: string): [number, number] => [handle(rig, id).x, handle(rig, id).y];
    expect(at('nw')).toEqual([100, 100]);
    expect(at('ne')).toEqual([200, 100]);
    expect(at('se')).toEqual([200, 160]);
    expect(at('sw')).toEqual([100, 160]);
    expect(at('n')).toEqual([150, 100]);
    expect(at('s')).toEqual([150, 160]);
    expect(at('w')).toEqual([100, 130]);
    expect(at('e')).toEqual([200, 130]);
    // the rotate handle sits above the top middle
    expect(handle(rig, 'rotate').x).toBeCloseTo(150, 6);
    expect(handle(rig, 'rotate').y).toBeLessThan(100);
  });

  it.each([
    ['e', 30, 5, { x: 100, y: 100, w: 130, h: 60 }],
    ['w', 20, 5, { x: 120, y: 100, w: 80, h: 60 }],
    ['n', 5, -10, { x: 100, y: 90, w: 100, h: 70 }],
    ['s', 5, 15, { x: 100, y: 100, w: 100, h: 75 }],
    ['se', 20, 10, { x: 100, y: 100, w: 120, h: 70 }],
    ['nw', 10, 10, { x: 110, y: 110, w: 90, h: 50 }],
    ['ne', 25, -20, { x: 100, y: 80, w: 125, h: 80 }],
    ['sw', -15, 20, { x: 85, y: 100, w: 115, h: 80 }],
  ] as const)('the %s handle moved by %d, %d gives the new box', (id, dx, dy, want) => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100, 100, 60);
    rig.core.selection.set([a.id]);
    pull(rig, id, dx, dy);
    expect(dims(rig, a.id)).toEqual(want);
  });

  it('a resize is one undo step and undo gives the old size back', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    rig.core.selection.set([a.id]);
    const before = get(rig, a.id);
    const steps = rig.core.history.undoSteps;
    pull(rig, 'se', 50, 50);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    expect(dims(rig, a.id)).toMatchObject({ w: 150, h: 110 });
    rig.core.history.undo();
    expect(plain(get(rig, a.id))).toBe(plain(before));
  });

  it('a side cannot be dragged across the other: the shape stays at least a unit wide', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    rig.core.selection.set([a.id]);
    pull(rig, 'e', -300, 0);
    const d = dims(rig, a.id);
    expect(d.w).toBeGreaterThanOrEqual(1);
    expect(d.x).toBe(100);
  });

  it('the handle of a turned shape moves along the shape axes: a rect turned a quarter turn grows on its own width', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100, 100, 60, { rotation: Math.PI / 2 });
    rig.core.selection.set([a.id]);
    const e = handle(rig, 'e');
    // the east side of a shape turned clockwise by a quarter turn is below it
    expect(e.y).toBeGreaterThan(centreOf(rig, a.id).y);
    pull(rig, 'e', 0, 20);
    const g = shapeGeometry(get(rig, a.id), rig.core.store.kinds);
    expect((g?.box.maxX ?? 0) - (g?.box.minX ?? 0)).toBeCloseTo(120, 6);
    expect((g?.box.maxY ?? 0) - (g?.box.minY ?? 0)).toBeCloseTo(60, 6);
    expect(get(rig, a.id).rotation).toBeCloseTo(Math.PI / 2, 9);
  });

  it('two shapes selected are framed together and resized as one: both are scaled about the opposite side', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100, 100, 60);
    const b = solid(rig, 200, 100, 100, 60);
    rig.core.selection.set([a.id, b.id]);
    expect(handle(rig, 'nw')).toMatchObject({ x: 100, y: 100 });
    expect(handle(rig, 'se')).toMatchObject({ x: 300, y: 160 });
    pull(rig, 'e', 100, 0);
    // the frame went from 200 to 300 wide: a factor of 1.5
    expect(dims(rig, a.id)).toMatchObject({ x: 100, w: 150, h: 60 });
    expect(dims(rig, b.id)).toMatchObject({ x: 250, w: 150, h: 60 });
  });

  it('a locked shape alone has no handles and is not resized', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100, 100, 60, { locked: true });
    rig.core.selection.set([a.id]);
    expect(handles(rig)).toEqual([]);
    const before = get(rig, a.id);
    drag(rig, [200, 160], [260, 220]);
    expect(get(rig, a.id)).toEqual(before);
  });

  it('a sticky note cannot be resized: it has no resize handles', () => {
    const rig = shapeRig();
    const a = add(rig, 'sticky', 100, 100, { text: 'hi' });
    rig.core.selection.set([a.id]);
    expect(handles(rig).filter((h) => h.kind === 'resize')).toEqual([]);
  });

  it('a text resized by a side handle gets a fixed width', () => {
    const rig = shapeRig();
    const a = add(rig, 'text', 100, 100, { text: 'a long line of text that wraps', size: 24 });
    rig.core.selection.set([a.id]);
    const w0 = dims(rig, a.id).w;
    pull(rig, 'e', -w0 / 2, 0);
    expect((get(rig, a.id).props as { w: number | null }).w).toBeCloseTo(w0 / 2, 4);
  });

  it('an image keeps its asset when it is resized', () => {
    const rig = shapeRig();
    const a = add(rig, 'image', 100, 100, { asset: 'asset:9', w: 100, h: 50 });
    rig.core.selection.set([a.id]);
    pull(rig, 'se', 100, 50);
    expect(get(rig, a.id).props).toMatchObject({ asset: 'asset:9', w: 200, h: 100 });
  });
});

describe('the rotate handle (ui.md; design 7.4)', () => {
  it('dragging the rotate handle round the middle turns the shape by the angle the pointer went, about its middle', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100, 100, 60);
    rig.core.selection.set([a.id]);
    // the middle is (150, 130); the handle is straight above it; the pointer goes to the right of the middle
    drag(rig, [handle(rig, 'rotate').x, handle(rig, 'rotate').y], [250, 130], 0, 12);
    expect(get(rig, a.id).rotation).toBeCloseTo(Math.PI / 2, 6);
    expect(centreOf(rig, a.id).x).toBeCloseTo(150, 6);
    expect(centreOf(rig, a.id).y).toBeCloseTo(130, 6);
  });

  it('a half turn: the pointer goes below the middle', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100, 100, 60);
    rig.core.selection.set([a.id]);
    drag(rig, [handle(rig, 'rotate').x, handle(rig, 'rotate').y], [150, 300], 0, 12);
    expect(Math.abs(Math.abs(get(rig, a.id).rotation) - Math.PI)).toBeLessThan(1e-6);
  });

  it('a turn is one undo step and undo gives back the angle', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    rig.core.selection.set([a.id]);
    const steps = rig.core.history.undoSteps;
    drag(rig, [handle(rig, 'rotate').x, handle(rig, 'rotate').y], [260, 130], 0, 12);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    rig.core.history.undo();
    expect(get(rig, a.id).rotation).toBe(0);
  });

  it('Shift turns in steps of 15 degrees', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100, 100, 60);
    rig.core.selection.set([a.id]);
    // 17 degrees clockwise from straight up about (150, 130)
    const r = 100;
    const angle = (17 * Math.PI) / 180;
    drag(rig, [handle(rig, 'rotate').x, handle(rig, 'rotate').y], [150 + r * Math.sin(angle), 130 - r * Math.cos(angle)], MOD_SHIFT, 12);
    expect(get(rig, a.id).rotation).toBeCloseTo(Math.PI / 12, 6);
  });

  it('several shapes turn about the middle of the box that holds them: a half turn swaps their places', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100, 100, 60);
    const b = solid(rig, 300, 100, 100, 60);
    rig.core.selection.set([a.id, b.id]);
    drag(rig, [handle(rig, 'rotate').x, handle(rig, 'rotate').y], [250, 400], 0, 12);
    expect(centreOf(rig, a.id).x).toBeCloseTo(350, 4);
    expect(centreOf(rig, b.id).x).toBeCloseTo(150, 4);
    expect(centreOf(rig, a.id).y).toBeCloseTo(130, 4);
  });

  it('a turned shape is selected where it is drawn, and its handles are turned', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100, 200, 20, { rotation: Math.PI / 2 });
    // the long thin rect is now a tall strip through (200, 110)
    tap(rig, 200, 20);
    expect(ids(rig)).toEqual([a.id]);
    expect(handle(rig, 'e').x).toBeCloseTo(200, 6);
    expect(handle(rig, 'e').y).toBeGreaterThan(110);
  });

  it('a locked shape is not turned', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100, 100, 60, { locked: true });
    rig.core.selection.set([a.id]);
    drag(rig, [150, 80], [250, 130], 0, 6);
    expect(get(rig, a.id).rotation).toBe(0);
  });
});

describe("the kind's own handles (ui.md: an arrow's bend, a line's points)", () => {
  it('an arrow alone shows handles for its start, its end and its bend', () => {
    const rig = shapeRig();
    const a = add(rig, 'arrow', 100, 100, { start: [0, 0], end: [200, 0] });
    rig.core.selection.set([a.id]);
    const own = handles(rig).filter((h) => h.kind === 'kind').map((h) => h.id).sort();
    expect(own).toEqual(['k:bend', 'k:end', 'k:start']);
    expect(handle(rig, 'k:start')).toMatchObject({ x: 100, y: 100 });
    expect(handle(rig, 'k:end')).toMatchObject({ x: 300, y: 100 });
  });

  it('a line alone shows one handle for each of its points', () => {
    const rig = shapeRig();
    const a = add(rig, 'line', 100, 100, { points: [0, 0, 100, 0, 100, 80] });
    rig.core.selection.set([a.id]);
    const own = handles(rig).filter((h) => h.kind === 'kind');
    expect(own).toHaveLength(3);
    expect(own.map((h) => [h.x, h.y])).toEqual([[100, 100], [200, 100], [200, 180]]);
  });

  // design 7.4 (round 3 ruling BR-29): a line or an arrow alone shows only its own handles; with other shapes, the box
  it.each(['arrow', 'line'] as const)('a %s alone shows only its own handles: no resize handles and no rotate handle', (kind) => {
    const rig = shapeRig();
    const a = kind === 'arrow' ? add(rig, 'arrow', 100, 100, { start: [0, 0], end: [200, 60] }) : add(rig, 'line', 100, 100, { points: [0, 0, 200, 60] });
    rig.core.selection.set([a.id]);
    const hs = handles(rig);
    expect(hs.filter((h) => h.kind === 'resize')).toHaveLength(0);
    expect(hs.filter((h) => h.kind === 'rotate')).toHaveLength(0);
    expect(hs.filter((h) => h.kind === 'kind').length).toBeGreaterThanOrEqual(2);
  });

  it.each(['arrow', 'line'] as const)('a %s selected with another shape shows the box with 8 resize handles and the rotate handle', (kind) => {
    const rig = shapeRig();
    const a = kind === 'arrow' ? add(rig, 'arrow', 100, 100, { start: [0, 0], end: [200, 60] }) : add(rig, 'line', 100, 100, { points: [0, 0, 200, 60] });
    const r = add(rig, 'rect', 400, 300);
    rig.core.selection.set([a.id, r.id]);
    const hs = handles(rig);
    expect(hs.filter((h) => h.kind === 'resize')).toHaveLength(8);
    expect(hs.filter((h) => h.kind === 'rotate')).toHaveLength(1);
  });

  it("dragging an arrow's end handle moves the end; the start stays; one undo step", () => {
    const rig = shapeRig();
    const a = add(rig, 'arrow', 100, 100, { start: [0, 0], end: [200, 0] });
    rig.core.selection.set([a.id]);
    const steps = rig.core.history.undoSteps;
    pull(rig, 'k:end', 40, 60);
    const p = get(rig, a.id).props as { start: number[]; end: number[] };
    expect(p.start).toEqual([0, 0]);
    expect(p.end).toEqual([240, 60]);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    rig.core.history.undo();
    expect((get(rig, a.id).props as { end: number[] }).end).toEqual([200, 0]);
  });

  it("dragging an arrow's bend handle bends it to the side the pointer went", () => {
    const rig = shapeRig();
    const a = add(rig, 'arrow', 100, 100, { start: [0, 0], end: [200, 0] });
    rig.core.selection.set([a.id]);
    pull(rig, 'k:bend', 0, 50);
    const bend = (get(rig, a.id).props as { bend: number }).bend;
    expect(Math.abs(bend)).toBeCloseTo(50, 4);
    // the bend moves the middle of the curve away from the chord, on the side of the pointer
    const g = shapeGeometry(get(rig, a.id), rig.core.store.kinds);
    expect(g?.hit(200, 150, 2)).toBe(true);
  });

  it("dragging a line's middle point handle moves that point only", () => {
    const rig = shapeRig();
    const a = add(rig, 'line', 100, 100, { points: [0, 0, 100, 0, 200, 0] });
    rig.core.selection.set([a.id]);
    pull(rig, 'k:p1', 0, 70);
    expect((get(rig, a.id).props as { points: number[] }).points).toEqual([0, 0, 100, 70, 200, 0]);
  });

  it("a line's point handle drag is one undo step", () => {
    const rig = shapeRig();
    const a = add(rig, 'line', 100, 100, { points: [0, 0, 100, 0] });
    rig.core.selection.set([a.id]);
    const steps = rig.core.history.undoSteps;
    pull(rig, 'k:p1', 30, 30);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
  });

  it('a locked line has no handles to drag', () => {
    const rig = shapeRig();
    const a = add(rig, 'line', 100, 100, { points: [0, 0, 100, 0] }, { locked: true });
    rig.core.selection.set([a.id]);
    expect(handles(rig)).toEqual([]);
  });
});

describe('snap guides (design 7.4; B22)', () => {
  /** A at x 100..200, y 100..160, and B 60 by 40 far away at (400, 300). */
  function two(rig: BoardRig): { a: ShapeRecord; b: ShapeRecord } {
    return { a: solid(rig, 100, 100, 100, 60), b: solid(rig, 400, 300, 60, 40) };
  }

  it('the edge of the moving shape lands on the edge of another shape within 6 screen pixels, and a guide is drawn', () => {
    const rig = shapeRig();
    const { b } = two(rig);
    // B starts at x 400; grab it at (430, 320) and move to put its left edge at 204 (4 units off A's right edge, 200)
    press(rig, [[430, 320], [430 - 196, 380], [430 - 196, 380]]);
    expect(dims(rig, b.id).x).toBe(200);
    expect(rig.overlay.guides.length).toBeGreaterThan(0);
    expect(rig.overlay.guides.some((g) => g.kind === 'edge')).toBe(true);
    const edge = rig.overlay.guides.find((g) => g.kind === 'edge');
    expect(edge?.x0).toBeCloseTo(200, 6);
    expect(edge?.x1).toBeCloseTo(200, 6);
    release(rig, 234, 380);
    expect(dims(rig, b.id).x).toBe(200);
  });

  it('the guides are gone when the pointer comes up', () => {
    const rig = shapeRig();
    two(rig);
    press(rig, [[430, 320], [234, 380], [234, 380]]);
    expect(rig.overlay.guides.length).toBeGreaterThan(0);
    release(rig, 234, 380);
    expect(rig.overlay.guides).toEqual([]);
  });

  it('beyond 6 screen pixels nothing snaps and no guide shows', () => {
    const rig = shapeRig();
    const { b } = two(rig);
    // the left edge would be at 210: 10 units from A's right edge, and far from every other line
    press(rig, [[430, 320], [240, 380], [240, 380]]);
    expect(dims(rig, b.id).x).toBe(210);
    expect(rig.overlay.guides).toEqual([]);
    release(rig, 240, 380);
  });

  it('the threshold is 6 screen pixels: at zoom 2 an offset of 4 units (8 pixels) does not snap, 2 units (4 pixels) does', () => {
    const rig = shapeRig();
    const { b } = two(rig);
    rig.core.camera?.moveTo(0, 0, 2, 0);
    // screen = 2 x page; B's grab point is page (430, 320) = screen (860, 640)
    press(rig, [[860, 640], [860 - 2 * 196, 760], [860 - 2 * 196, 760]]);
    expect(dims(rig, b.id).x).toBe(204);
    release(rig, 860 - 2 * 196, 760);
    rig.core.history.undo();
    press(rig, [[860, 640], [860 - 2 * 198, 760], [860 - 2 * 198, 760]], 0, 5000);
    expect(dims(rig, b.id).x).toBe(200);
    release(rig, 860 - 2 * 198, 760, 0, 6000);
  });

  it('the middle of the moving shape lands on the middle of another shape, and the guide is a centre guide', () => {
    const rig = shapeRig();
    const { b } = two(rig);
    // A's middle is x = 150; B is 60 wide; put B's left at 123 so its middle is 153
    press(rig, [[430, 320], [430 - 277, 420], [430 - 277, 420]]);
    expect(dims(rig, b.id).x).toBe(120);
    expect(rig.overlay.guides.some((g) => g.kind === 'centre')).toBe(true);
    release(rig, 153, 420);
  });

  it('equal gaps: the shape lands so the gap to its neighbour equals the gap between two others', () => {
    const rig = shapeRig();
    solid(rig, 0, 0, 50, 50);
    solid(rig, 100, 0, 50, 50);
    const c = solid(rig, 400, 0, 50, 50);
    // the gap between the first two is 50: C's left edge should land at 200; start at 400 and go to 203
    press(rig, [[425, 25], [228, 25], [228, 25]]);
    expect(dims(rig, c.id).x).toBe(200);
    expect(rig.overlay.guides.some((g) => g.kind === 'gap')).toBe(true);
    release(rig, 228, 25);
  });

  it('equal gaps on both sides: a shape between two others lands in the middle', () => {
    const rig = shapeRig();
    solid(rig, 0, 0, 50, 50);
    solid(rig, 250, 0, 50, 50);
    const c = solid(rig, 400, 0, 50, 50);
    // gaps of 75 on each side put C's left edge at 125
    press(rig, [[425, 25], [153, 25], [153, 25]]);
    expect(dims(rig, c.id).x).toBe(125);
    expect(rig.overlay.guides.some((g) => g.kind === 'gap')).toBe(true);
    release(rig, 153, 25);
  });

  it('the page grid of 24 units pulls when the page background is grid', () => {
    const rig = shapeRig();
    rig.core.store.change('user', (tx) => void tx.update(pageOf(rig), { background: 'grid' }));
    const a = solid(rig, 0, 1000, 50, 30);
    // the left edge would be at 98: 2 units from the line at 96; the middle (123) and the right edge (148) are further from 120 and 144
    press(rig, [[25, 1015], [123, 1015], [123, 1015]]);
    expect(dims(rig, a.id).x).toBe(96);
    expect(rig.overlay.guides.some((g) => g.kind === 'grid')).toBe(true);
    release(rig, 123, 1015);
  });

  it('the page grid pulls when the page background is dots', () => {
    const rig = shapeRig();
    rig.core.store.change('user', (tx) => void tx.update(pageOf(rig), { background: 'dots' }));
    const a = solid(rig, 0, 1000, 50, 30);
    drag(rig, [25, 1015], [123, 1015]);
    expect(dims(rig, a.id).x).toBe(96);
  });

  it.each(['none', 'lines'] as const)('with the background %s there is no grid to snap to', (background) => {
    const rig = shapeRig();
    rig.core.store.change('user', (tx) => void tx.update(pageOf(rig), { background }));
    const a = solid(rig, 0, 1000, 50, 30);
    drag(rig, [25, 1015], [123, 1015]);
    expect(dims(rig, a.id).x).toBe(98);
  });

  it('the grid snaps in y too', () => {
    const rig = shapeRig();
    rig.core.store.change('user', (tx) => void tx.update(pageOf(rig), { background: 'grid' }));
    const a = solid(rig, 1000, 0, 48, 48);
    drag(rig, [1025, 15], [1025 + 75, 15 + 98]);
    expect(dims(rig, a.id).x).toBe(1080);
    expect(dims(rig, a.id).y).toBe(96);
  });

  it('a resize snaps the side that moves to the edge of another shape', () => {
    const rig = shapeRig();
    const { a } = two(rig);
    rig.core.selection.set([a.id]);
    // A's east side is at x = 200; B's left edge is at 400: pull A's east side to 396
    pull(rig, 'e', 196, 0);
    expect(dims(rig, a.id).x + dims(rig, a.id).w).toBe(400);
    expect(rig.overlay.guides).toEqual([]);
  });

  it('a resize shows its guide while the side is held there', () => {
    const rig = shapeRig();
    const { a } = two(rig);
    rig.core.selection.set([a.id]);
    const h = handle(rig, 'e');
    press(rig, [[h.x, h.y], [h.x + 100, h.y], [h.x + 198, h.y]]);
    expect(rig.overlay.guides.some((g) => g.kind === 'edge')).toBe(true);
    release(rig, h.x + 198, h.y);
  });

  it('a move writes shapes only through the transaction: the snapper itself never writes to the store', () => {
    const rig = shapeRig();
    const { a } = two(rig);
    const before = dump(rig.core.store);
    const s = new Snapper();
    expect(s.begin([boxOf(rig, a.id)])).toBe(true);
    s.snapMove({ minX: 204, minY: 10, maxX: 264, maxY: 50 }, 6, null);
    s.end();
    expect(dump(rig.core.store)).toBe(before);
  });
});

describe('Snapper (B22)', () => {
  const box = (minX: number, minY: number, maxX: number, maxY: number): { minX: number; minY: number; maxX: number; maxY: number } => ({ minX, minY, maxX, maxY });

  it('goes idle, tracking, snapped, tracking, idle', () => {
    const s = new Snapper();
    expect(s.state).toBe('idle');
    expect(s.begin([box(100, 100, 200, 160)])).toBe(true);
    expect(s.state).toBe('tracking');
    s.snapMove(box(204, 300, 264, 340), 6, null);
    expect(s.state).toBe('snapped');
    expect(s.guides.length).toBeGreaterThan(0);
    s.snapMove(box(260, 300, 320, 340), 6, null);
    expect(s.state).toBe('tracking');
    expect(s.guides).toEqual([]);
    s.end();
    expect(s.state).toBe('idle');
  });

  it('snapMove gives the adjustment that lands the nearest line on the other line', () => {
    const s = new Snapper();
    s.begin([box(100, 100, 200, 160)]);
    expect(s.snapMove(box(204, 300, 264, 340), 6, null)).toEqual({ dx: -4, dy: 0 });
    expect(s.snapMove(box(250, 103, 310, 143), 6, null)).toEqual({ dx: 0, dy: -3 });
  });

  it('the nearest line within the threshold wins on each axis', () => {
    const s = new Snapper();
    s.begin([box(100, 0, 200, 50), box(206, 200, 300, 250)]);
    // the moving box's left edge is 3 from 200 and 3 from 206: either; its right edge is far from every line
    const r = s.snapMove(box(203, 400, 263, 440), 6, null);
    expect(Math.abs(r.dx)).toBeLessThanOrEqual(3);
  });

  it('the threshold is in page units: a box 5 units off does not snap with a threshold of 3', () => {
    const s = new Snapper();
    s.begin([box(100, 100, 200, 160)]);
    expect(s.snapMove(box(205, 300, 265, 340), 3, null)).toEqual({ dx: 0, dy: 0 });
    expect(s.state).toBe('tracking');
  });

  it('snapMove and snapResize in idle change nothing, and begin while tracking has no row', () => {
    const s = new Snapper();
    expect(s.snapMove(box(204, 300, 264, 340), 6, null)).toEqual({ dx: 0, dy: 0 });
    expect(s.snapResize(box(204, 300, 264, 340), { left: true, right: false, top: false, bottom: false }, 6, null)).toEqual(box(204, 300, 264, 340));
    expect(s.state).toBe('idle');
    s.begin([box(100, 100, 200, 160)]);
    expect(s.begin([])).toBe(false);
    expect(s.state).toBe('tracking');
  });

  it('end empties the guides, and a second end changes nothing', () => {
    const s = new Snapper();
    s.begin([box(100, 100, 200, 160)]);
    s.snapMove(box(204, 300, 264, 340), 6, null);
    s.end();
    expect(s.guides).toEqual([]);
    s.end();
    expect(s.state).toBe('idle');
  });

  it('a resize only pulls the sides that move', () => {
    const s = new Snapper();
    s.begin([box(100, 100, 200, 160)]);
    // the left edge is 4 from 200 but the left side is not moving; the right side is far
    const r = s.snapResize(box(204, 300, 400, 340), { left: false, right: true, top: false, bottom: false }, 6, null);
    expect(r).toEqual(box(204, 300, 400, 340));
    const r2 = s.snapResize(box(204, 300, 400, 340), { left: true, right: false, top: false, bottom: false }, 6, null);
    expect(r2.minX).toBe(200);
  });

  it('the grid pulls to multiples of 24 units when a grid is given', () => {
    const s = new Snapper();
    s.begin([]);
    expect(s.snapMove(box(98, 2, 148, 50), 6, 24)).toEqual({ dx: -2, dy: -2 });
    expect(s.guides.some((g) => g.kind === 'grid')).toBe(true);
    expect(s.snapMove(box(98, 2, 148, 50), 6, null)).toEqual({ dx: 0, dy: 0 });
  });

  it('a guide has two ends in page units and one of the kinds edge, centre, gap, grid', () => {
    const s = new Snapper();
    s.begin([box(100, 100, 200, 160)]);
    s.snapMove(box(204, 300, 264, 340), 6, null);
    for (const g of s.guides) {
      expect(['edge', 'centre', 'gap', 'grid']).toContain(g.kind);
      expect([g.x0, g.y0, g.x1, g.y1].every(Number.isFinite)).toBe(true);
    }
  });
});

describe('every gesture is one undo step (B19)', () => {
  it('move, resize, rotate and a handle drag are each one step, and undo of each gives the shape back', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const arrow = add(rig, 'arrow', 100, 400, { start: [0, 0], end: [150, 0] });
    const steps = rig.core.history.undoSteps;
    const original = plain(get(rig, a.id));
    drag(rig, [150, 130], [250, 230], 0, 20);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    pull(rig, 'se', 30, 30, 0, 1000);
    expect(rig.core.history.undoSteps).toBe(steps + 2);
    drag(rig, [handle(rig, 'rotate').x, handle(rig, 'rotate').y], [400, 230], 0, 12, 2000);
    expect(rig.core.history.undoSteps).toBe(steps + 3);
    rig.core.selection.set([arrow.id]);
    pull(rig, 'k:end', 20, 40, 0, 3000);
    expect(rig.core.history.undoSteps).toBe(steps + 4);
    for (let i = 0; i < 4; i++) rig.core.history.undo();
    expect(plain(get(rig, a.id))).toBe(original);
    expect((get(rig, arrow.id).props as { end: number[] }).end).toEqual([150, 0]);
  });

  it('a click that moved nothing leaves no undo step', () => {
    const rig = shapeRig();
    solid(rig, 100, 100);
    const steps = rig.core.history.undoSteps;
    tap(rig, 150, 130);
    expect(rig.core.history.undoSteps).toBe(steps);
  });

  it('writes keep shapes on their page and keep the other records as they were', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 500, 500);
    const before = plain(get(rig, b.id));
    drag(rig, [150, 130], [250, 230]);
    expect(get(rig, a.id).page).toBe(pageOf(rig));
    expect(plain(get(rig, b.id))).toBe(before);
    expect(shapesOf(rig)).toHaveLength(2);
    expect(ofKind(rig, 'rect')).toHaveLength(2);
  });
});
