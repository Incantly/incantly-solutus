// @vitest-environment node
/**
 * The editing commands (docs/features/board/design.md 4 and 7.4; ui.md "Keys"; requirement R5.2): align, distribute,
 * order with fractional keys, group and ungroup, lock, duplicate, flip, nudge, delete and style. Each command is one
 * transaction, so one undo step; a locked shape is never changed; a group or frame brings its members. Only the public
 * API is used.
 */
import { describe, expect, it } from 'vitest';
import {
  PASTE_OFFSET, alignShapes, deleteShapes, distributeShapes, duplicateShapes, flipShapes, groupShapes, isKey, orderShapes, setLocked, shapeGeometry, stackOf, styleShapes, translateShapes,
  ungroupShapes,
} from '../../src/index';
import type { AlignHow, OrderHow, ShapeRecord } from '../../src/index';
import { dump } from './helpers';
import { add, boxOf, centreOf, get, key, ofKind, pageOf, plain, rect, shapeRig, shapesOf, undoAll } from './shape-helpers';
import type { BoardRig } from './shape-helpers';

const solid = (rig: BoardRig, x: number, y: number, w = 100, h = 60, over: Partial<ShapeRecord> = {}): ShapeRecord => add(rig, 'rect', x, y, { w, h, fill: '#ffcc00' }, over);

/** Runs a command and checks it was one undo step that the history can undo and redo. */
function oneStep(rig: BoardRig, run: () => unknown): void {
  const steps = rig.core.history.undoSteps;
  const before = dump(rig.core.store);
  const r = run() as { ok?: boolean } | undefined;
  if (r !== undefined && r.ok !== undefined) expect(r.ok).toBe(true);
  expect(rig.core.history.undoSteps).toBe(steps + 1);
  const after = dump(rig.core.store);
  expect(after).not.toBe(before);
  rig.core.history.undo();
  expect(dump(rig.core.store)).toBe(before);
  rig.core.history.redo();
  expect(dump(rig.core.store)).toBe(after);
}

describe('align (design 7.4)', () => {
  function three(rig: BoardRig): readonly [ShapeRecord, ShapeRecord, ShapeRecord] {
    return [solid(rig, 100, 50, 50, 40), solid(rig, 300, 200, 100, 60), solid(rig, 200, 120, 30, 80)];
  }

  it.each([
    ['left', { minX: 100 }],
    ['right', { maxX: 400 }],
    ['centerX', { cx: 250 }],
    ['top', { minY: 50 }],
    ['bottom', { maxY: 260 }],
    ['middleY', { cy: 155 }],
  ] as const)('%s lines the shapes up with the box that holds them all', (how: AlignHow, want) => {
    const rig = shapeRig();
    const list = three(rig);
    const r = alignShapes(rig.core, list.map((s) => s.id), how);
    expect(r.ok).toBe(true);
    for (const s of list) {
      const b = boxOf(rig, s.id);
      if ('minX' in want) expect(b.minX).toBeCloseTo(want.minX, 6);
      if ('maxX' in want) expect(b.maxX).toBeCloseTo(want.maxX, 6);
      if ('cx' in want) expect((b.minX + b.maxX) / 2).toBeCloseTo(want.cx, 6);
      if ('minY' in want) expect(b.minY).toBeCloseTo(want.minY, 6);
      if ('maxY' in want) expect(b.maxY).toBeCloseTo(want.maxY, 6);
      if ('cy' in want) expect((b.minY + b.maxY) / 2).toBeCloseTo(want.cy, 6);
    }
  });

  it('aligning on one axis leaves the other axis alone', () => {
    const rig = shapeRig();
    const list = three(rig);
    const ys = list.map((s) => get(rig, s.id).y);
    alignShapes(rig.core, list.map((s) => s.id), 'left');
    expect(list.map((s) => get(rig, s.id).y)).toEqual(ys);
  });

  it('is one undo step', () => {
    const rig = shapeRig();
    const list = three(rig);
    oneStep(rig, () => alignShapes(rig.core, list.map((s) => s.id), 'right'));
  });

  it('fewer than two shapes: nothing changes and there is no undo step', () => {
    const rig = shapeRig();
    const [a] = three(rig);
    const steps = rig.core.history.undoSteps;
    expect(alignShapes(rig.core, [(a as ShapeRecord).id], 'left').ok).toBe(true);
    expect(alignShapes(rig.core, [], 'left').ok).toBe(true);
    expect(rig.core.history.undoSteps).toBe(steps);
  });

  it('a locked shape stays where it is', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 50);
    const b = solid(rig, 300, 200, 100, 60, { locked: true });
    const c = solid(rig, 500, 400);
    alignShapes(rig.core, [a.id, b.id, c.id], 'left');
    expect(get(rig, b.id).x).toBe(300);
    expect(get(rig, c.id).x).toBe(100);
  });

  it('a turned shape is aligned by the box it covers on the page', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100, 100, 60);
    // 100 by 20, turned a quarter turn: it covers a box 20 wide and 100 tall on the page
    const b = solid(rig, 300, 300, 100, 20, { rotation: Math.PI / 2 });
    alignShapes(rig.core, [a.id, b.id], 'left');
    expect(boxOf(rig, b.id).minX).toBeCloseTo(100, 6);
    expect(boxOf(rig, a.id).minX).toBeCloseTo(100, 6);
  });

  it('a group moves with all of its members', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100, 50, 50);
    const b = solid(rig, 200, 100, 50, 50);
    const c = solid(rig, 500, 400, 50, 50);
    groupShapes(rig.core, [a.id, b.id]);
    alignShapes(rig.core, [a.id, b.id, c.id], 'right');
    expect(boxOf(rig, c.id).maxX).toBeCloseTo(550, 6);
    expect(boxOf(rig, b.id).maxX).toBeCloseTo(550, 6);
  });
});

describe('distribute (design 7.4)', () => {
  it('x: the gaps between neighbours become equal and the first and last shapes stay', () => {
    const rig = shapeRig();
    const a = solid(rig, 0, 0, 50, 50);
    const b = solid(rig, 60, 80, 50, 50);
    const c = solid(rig, 300, 20, 50, 50);
    distributeShapes(rig.core, [a.id, b.id, c.id], 'x');
    expect(boxOf(rig, a.id).minX).toBe(0);
    expect(boxOf(rig, c.id).minX).toBe(300);
    const gap1 = boxOf(rig, b.id).minX - boxOf(rig, a.id).maxX;
    const gap2 = boxOf(rig, c.id).minX - boxOf(rig, b.id).maxX;
    expect(gap1).toBeCloseTo(gap2, 6);
    expect(gap1).toBeCloseTo(100, 6);
    // the other axis is not touched
    expect(get(rig, b.id).y).toBe(80);
  });

  it('y works the same way', () => {
    const rig = shapeRig();
    const a = solid(rig, 0, 0, 50, 50);
    const b = solid(rig, 40, 60, 50, 50);
    const c = solid(rig, 90, 400, 50, 50);
    distributeShapes(rig.core, [a.id, b.id, c.id], 'y');
    expect(boxOf(rig, b.id).minY - boxOf(rig, a.id).maxY).toBeCloseTo(boxOf(rig, c.id).minY - boxOf(rig, b.id).maxY, 6);
    expect(get(rig, b.id).x).toBe(40);
  });

  it('shapes of different sizes get equal gaps, not equal centres', () => {
    const rig = shapeRig();
    const a = solid(rig, 0, 0, 20, 20);
    const b = solid(rig, 30, 0, 100, 20);
    const c = solid(rig, 150, 0, 40, 20);
    const d = solid(rig, 500, 0, 60, 20);
    distributeShapes(rig.core, [a.id, b.id, c.id, d.id], 'x');
    const list = [a, b, c, d].map((s) => boxOf(rig, s.id));
    const gaps = [list[1] as { minX: number }, list[2] as { minX: number }, list[3] as { minX: number }].map((box, i) => box.minX - (list[i] as { maxX: number }).maxX);
    expect(gaps[0]).toBeCloseTo(gaps[1] as number, 6);
    expect(gaps[1]).toBeCloseTo(gaps[2] as number, 6);
  });

  it('does not depend on the order the ids are given in', () => {
    const rig = shapeRig();
    const a = solid(rig, 0, 0, 50, 50);
    const b = solid(rig, 60, 0, 50, 50);
    const c = solid(rig, 300, 0, 50, 50);
    distributeShapes(rig.core, [c.id, a.id, b.id], 'x');
    expect(boxOf(rig, b.id).minX).toBeCloseTo(150, 6);
  });

  it('is one undo step', () => {
    const rig = shapeRig();
    const a = solid(rig, 0, 0, 50, 50);
    const b = solid(rig, 60, 0, 50, 50);
    const c = solid(rig, 300, 0, 50, 50);
    oneStep(rig, () => distributeShapes(rig.core, [a.id, b.id, c.id], 'x'));
  });

  it('two shapes or fewer: nothing changes and there is no undo step', () => {
    const rig = shapeRig();
    const a = solid(rig, 0, 0, 50, 50);
    const b = solid(rig, 60, 0, 50, 50);
    const steps = rig.core.history.undoSteps;
    expect(distributeShapes(rig.core, [a.id, b.id], 'x').ok).toBe(true);
    expect(rig.core.history.undoSteps).toBe(steps);
  });

  it('a locked shape in the middle stays where it is', () => {
    const rig = shapeRig();
    const a = solid(rig, 0, 0, 50, 50);
    const b = solid(rig, 60, 0, 50, 50, { locked: true });
    const c = solid(rig, 300, 0, 50, 50);
    const d = solid(rig, 400, 0, 50, 50);
    distributeShapes(rig.core, [a.id, b.id, c.id, d.id], 'x');
    expect(get(rig, b.id).x).toBe(60);
  });
});

describe('order, with fractional keys (design 4: moving one shape never rewrites the others)', () => {
  /** n rects stacked on the same place, ids in the order of their keys, back to front. */
  function stack(rig: BoardRig, n: number): readonly ShapeRecord[] {
    return Array.from({ length: n }, (_v, i) => solid(rig, 100, 100, 100 + i, 60));
  }
  const order = (rig: BoardRig): readonly string[] => stackOf(rig.core.store, pageOf(rig)).map((s) => s.id);

  it('front puts a shape on top; back puts it at the bottom', () => {
    const rig = shapeRig();
    const list = stack(rig, 5);
    orderShapes(rig.core, [(list[1] as ShapeRecord).id], 'front');
    expect(order(rig).at(-1)).toBe((list[1] as ShapeRecord).id);
    orderShapes(rig.core, [(list[3] as ShapeRecord).id], 'back');
    expect(order(rig)[0]).toBe((list[3] as ShapeRecord).id);
  });

  it('only the shape moved gets a new key; every other record is the same record as before', () => {
    const rig = shapeRig();
    const list = stack(rig, 6);
    const moved = list[2] as ShapeRecord;
    const others = list.filter((s) => s.id !== moved.id);
    const before = others.map((s) => get(rig, s.id));
    orderShapes(rig.core, [moved.id], 'front');
    others.forEach((s, i) => expect(get(rig, s.id), s.id).toBe(before[i]));
    expect(get(rig, moved.id).index).not.toBe(moved.index);
  });

  it('the new key is a valid fractional key between its neighbours', () => {
    const rig = shapeRig();
    const list = stack(rig, 4);
    const moved = list[0] as ShapeRecord;
    orderShapes(rig.core, [moved.id], 'forward');
    const keys = stackOf(rig.core.store, pageOf(rig)).map((s) => s.index);
    for (const k of keys) expect(isKey(k), k).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(keys);
  });

  it('forward moves a shape above the next one it overlaps; backward below the one under it', () => {
    const rig = shapeRig();
    const [a, b, c] = stack(rig, 3) as [ShapeRecord, ShapeRecord, ShapeRecord];
    orderShapes(rig.core, [a.id], 'forward');
    expect(order(rig)).toEqual([b.id, a.id, c.id]);
    orderShapes(rig.core, [c.id], 'backward');
    expect(order(rig)).toEqual([b.id, c.id, a.id]);
  });

  it('front and back of several shapes keep their relative order (design 7.4: bring forward, send back)', () => {
    const rig = shapeRig();
    const [a, b, c, d] = stack(rig, 4) as [ShapeRecord, ShapeRecord, ShapeRecord, ShapeRecord];
    orderShapes(rig.core, [a.id, c.id], 'front');
    expect(order(rig)).toEqual([b.id, d.id, a.id, c.id]);
    orderShapes(rig.core, [d.id, c.id], 'back');
    expect(order(rig)).toEqual([d.id, c.id, b.id, a.id]);
  });

  it('keys stay valid and distinct after many moves of the same shape', () => {
    const rig = shapeRig();
    const list = stack(rig, 5);
    const how: OrderHow[] = ['front', 'back', 'forward', 'backward'];
    for (let i = 0; i < 60; i++) orderShapes(rig.core, [(list[i % 5] as ShapeRecord).id], how[i % 4] as OrderHow);
    const keys = stackOf(rig.core.store, pageOf(rig)).map((s) => s.index);
    expect(new Set(keys).size).toBe(5);
    for (const k of keys) expect(isKey(k)).toBe(true);
  });

  it('is one undo step, and a locked shape is not moved', () => {
    const rig = shapeRig();
    const [a, b, c] = stack(rig, 3) as [ShapeRecord, ShapeRecord, ShapeRecord];
    oneStep(rig, () => orderShapes(rig.core, [a.id], 'front'));
    const rig2 = shapeRig();
    const list = stack(rig2, 3);
    rig2.core.store.change('user', (tx) => void tx.update((list[0] as ShapeRecord).id, { locked: true }));
    const steps = rig2.core.history.undoSteps;
    orderShapes(rig2.core, [(list[0] as ShapeRecord).id], 'front');
    expect(rig2.core.history.undoSteps).toBe(steps);
    expect(b.id).not.toBe(c.id);
  });

  it('the keys ], [, mod+] and mod+[ order the selection (ui.md)', () => {
    const rig = shapeRig();
    const [a, b, c] = stack(rig, 3) as [ShapeRecord, ShapeRecord, ShapeRecord];
    rig.core.selection.set([a.id]);
    key(rig, ']');
    expect(order(rig)).toEqual([b.id, a.id, c.id]);
    key(rig, ']', { mod: true });
    expect(order(rig)).toEqual([b.id, c.id, a.id]);
    key(rig, '[');
    expect(order(rig)).toEqual([b.id, a.id, c.id]);
    key(rig, '[', { mod: true });
    expect(order(rig)).toEqual([a.id, b.id, c.id]);
  });

  it('what is drawn follows the keys: a shape sent to the front is drawn after the others', () => {
    const rig = shapeRig();
    const [a, b] = stack(rig, 2) as [ShapeRecord, ShapeRecord];
    orderShapes(rig.core, [a.id], 'front');
    const drawn = rig.core.drawList.itemsIn({ minX: 0, minY: 0, maxX: 400, maxY: 400 }, 1).map((i) => i.id);
    expect(drawn).toEqual([b.id, a.id]);
  });
});

describe('group and ungroup (design 7.4; B19)', () => {
  it('group makes one group record and sets the parent of each member to it, in one undo step', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100);
    const c = solid(rig, 500, 100);
    const steps = rig.core.history.undoSteps;
    const r = groupShapes(rig.core, [a.id, b.id]);
    expect(r.ok).toBe(true);
    const groups = ofKind(rig, 'group');
    expect(groups).toHaveLength(1);
    const g = groups[0] as ShapeRecord;
    expect(get(rig, a.id).parent).toBe(g.id);
    expect(get(rig, b.id).parent).toBe(g.id);
    expect(get(rig, c.id).parent).toBeNull();
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    rig.core.history.undo();
    expect(ofKind(rig, 'group')).toHaveLength(0);
    expect(get(rig, a.id).parent).toBeNull();
  });

  it('the result holds the shapes the selection should hold: the members', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100);
    const r = groupShapes(rig.core, [a.id, b.id]);
    expect(r.ok && [...r.value].sort()).toEqual([a.id, b.id].sort());
  });

  it('one shape alone is not grouped: no group, no undo step', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const steps = rig.core.history.undoSteps;
    groupShapes(rig.core, [a.id]);
    expect(ofKind(rig, 'group')).toHaveLength(0);
    expect(rig.core.history.undoSteps).toBe(steps);
  });

  it('grouping a group with another shape makes a group of the group and the shape', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100);
    const c = solid(rig, 500, 100);
    groupShapes(rig.core, [a.id, b.id]);
    const inner = get(rig, a.id).parent as string;
    groupShapes(rig.core, [a.id, b.id, c.id]);
    const outer = get(rig, c.id).parent as string;
    expect(ofKind(rig, 'group')).toHaveLength(2);
    expect(outer).not.toBe(inner);
    expect(get(rig, inner).parent).toBe(outer);
  });

  it('ungroup takes the group apart and its members have the group parent (none) again, in one undo step', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100);
    groupShapes(rig.core, [a.id, b.id]);
    const steps = rig.core.history.undoSteps;
    const r = ungroupShapes(rig.core, [a.id]);
    expect(r.ok).toBe(true);
    expect(ofKind(rig, 'group')).toHaveLength(0);
    expect(get(rig, a.id).parent).toBeNull();
    expect(get(rig, b.id).parent).toBeNull();
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    rig.core.history.undo();
    expect(ofKind(rig, 'group')).toHaveLength(1);
  });

  it('ungroup takes apart only the topmost group of a nested pair', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100);
    const c = solid(rig, 500, 100);
    groupShapes(rig.core, [a.id, b.id]);
    groupShapes(rig.core, [a.id, b.id, c.id]);
    ungroupShapes(rig.core, [a.id]);
    expect(ofKind(rig, 'group')).toHaveLength(1);
    expect(get(rig, a.id).parent).toBe(get(rig, b.id).parent);
    expect(get(rig, c.id).parent).toBeNull();
  });

  it('ungroup of shapes in no group changes nothing', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const steps = rig.core.history.undoSteps;
    expect(ungroupShapes(rig.core, [a.id]).ok).toBe(true);
    expect(rig.core.history.undoSteps).toBe(steps);
  });

  it('mod+g groups the selection and mod+shift+g ungroups it, and the selection keeps its shapes', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100);
    rig.core.selection.set([a.id, b.id]);
    key(rig, 'g', { mod: true });
    expect(ofKind(rig, 'group')).toHaveLength(1);
    expect([...rig.core.selection.ids].sort()).toEqual([a.id, b.id].sort());
    key(rig, 'g', { mod: true, shift: true });
    expect(ofKind(rig, 'group')).toHaveLength(0);
  });

  it('a group has no look of its own: it is not drawn', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100);
    groupShapes(rig.core, [a.id, b.id]);
    const g = ofKind(rig, 'group')[0] as ShapeRecord;
    const drawn = rig.core.drawList.itemsIn({ minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 }, 1).map((i) => i.id);
    expect(drawn).not.toContain(g.id);
    expect(drawn).toHaveLength(2);
  });

  it('deleting every member of a group removes the group too', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100);
    groupShapes(rig.core, [a.id, b.id]);
    deleteShapes(rig.core, [a.id, b.id]);
    expect(shapesOf(rig)).toHaveLength(0);
  });

  it('a locked shape is not grouped', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100, 100, 60, { locked: true });
    const c = solid(rig, 500, 100);
    groupShapes(rig.core, [a.id, b.id, c.id]);
    expect(get(rig, b.id).parent).toBeNull();
    expect(get(rig, a.id).parent).toBe(get(rig, c.id).parent);
  });
});

describe('lock (design 7.4; B19: a locked shape is never changed)', () => {
  it('setLocked locks and unlocks, in one undo step each', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    oneStep(rig, () => setLocked(rig.core, [a.id], true));
    expect(get(rig, a.id).locked).toBe(true);
    oneStep(rig, () => setLocked(rig.core, [a.id], false));
    expect(get(rig, a.id).locked).toBe(false);
  });

  it('without a value it toggles: all locked unlocks, anything else locks', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100, 100, 60, { locked: true });
    setLocked(rig.core, [a.id, b.id]);
    expect([get(rig, a.id).locked, get(rig, b.id).locked]).toEqual([true, true]);
    setLocked(rig.core, [a.id, b.id]);
    expect([get(rig, a.id).locked, get(rig, b.id).locked]).toEqual([false, false]);
  });

  it('a locked shape is not moved, deleted, aligned, ordered, flipped, styled or nudged', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100, 100, 60, { locked: true });
    const b = solid(rig, 400, 300);
    const before = plain(get(rig, a.id));
    translateShapes(rig.core, [a.id], 50, 50);
    alignShapes(rig.core, [a.id, b.id], 'right');
    orderShapes(rig.core, [a.id], 'front');
    flipShapes(rig.core, [a.id], 'x');
    styleShapes(rig.core, [a.id], { fill: '#00ff00' });
    rig.core.selection.set([a.id]);
    key(rig, 'ArrowRight');
    deleteShapes(rig.core, [a.id]);
    expect(plain(get(rig, a.id))).toBe(before);
  });

  it('locking a group locks every member, and locking a frame locks what it holds', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100);
    groupShapes(rig.core, [a.id, b.id]);
    setLocked(rig.core, [get(rig, a.id).parent as string], true);
    expect(get(rig, a.id).locked && get(rig, b.id).locked).toBe(true);
    const f = add(rig, 'frame', 0, 400, { w: 200, h: 200 });
    const inner = solid(rig, 20, 420, 50, 50, { parent: f.id });
    setLocked(rig.core, [f.id], true);
    expect(get(rig, inner.id).locked).toBe(true);
  });

  it('a shape is locked by its record: the stored shape has locked true', () => {
    const rig = shapeRig();
    const a = solid(rig, 0, 0);
    setLocked(rig.core, [a.id], true);
    expect(get(rig, a.id)).toMatchObject({ locked: true });
  });
});

describe('duplicate and copies (design 4: a copy shares nothing with the original)', () => {
  it('a duplicate is new shapes with new ids, offset from the originals, on top, in one undo step', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100);
    const steps = rig.core.history.undoSteps;
    const r = duplicateShapes(rig.core, [a.id, b.id]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength(2);
    expect(shapesOf(rig)).toHaveLength(4);
    for (const id of r.value) expect([a.id, b.id]).not.toContain(id);
    const copyA = get(rig, r.value[0] as string);
    const copyB = get(rig, r.value[1] as string);
    const offsets = [copyA.x - a.x, copyA.y - a.y, copyB.x - b.x, copyB.y - b.y];
    expect(offsets).toEqual([PASTE_OFFSET, PASTE_OFFSET, PASTE_OFFSET, PASTE_OFFSET]);
    expect(copyA.index > b.index).toBe(true);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    rig.core.history.undo();
    expect(shapesOf(rig)).toHaveLength(2);
  });

  it('the copy has the same kind and props, and the original is not changed', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100, 77, 33);
    const before = plain(get(rig, a.id));
    const r = duplicateShapes(rig.core, [a.id]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const copy = get(rig, r.value[0] as string);
    expect(copy.kind).toBe('rect');
    expect(plain(copy.props)).toBe(plain(a.props));
    expect(plain(get(rig, a.id))).toBe(before);
  });

  it('props and meta of a copy are their own objects, not the original ones', () => {
    const rig = shapeRig();
    const a = add(rig, 'rect', 0, 0, { w: 10, h: 10 }, { meta: { note: { deep: [1, 2, 3] } } });
    const r = duplicateShapes(rig.core, [a.id]);
    if (!r.ok) throw new Error(r.message);
    const copy = get(rig, r.value[0] as string);
    expect(copy.props).not.toBe(a.props);
    expect(copy.meta).not.toBe(a.meta);
    expect((copy.meta as { note: { deep: number[] } }).note).not.toBe((a.meta as { note: { deep: number[] } }).note);
    expect((copy.meta as { note: { deep: number[] } }).note.deep).not.toBe((a.meta as { note: { deep: number[] } }).note.deep);
    expect((copy.meta as { note: { deep: number[] } }).note.deep).toEqual([1, 2, 3]);
  });

  it('the points of a copied stroke are another array', () => {
    const rig = shapeRig();
    const points = Float32Array.from([0, 0, 0.5, 10, 10, 0.5, 20, 5, 0.5]);
    const a = add(rig, 'ink', 50, 50, { points, stride: 3, nib: 'pen', size: 3, color: '#000000', opacity: 1 });
    const r = duplicateShapes(rig.core, [a.id]);
    if (!r.ok) throw new Error(r.message);
    const copy = get(rig, r.value[0] as string);
    const p = (copy.props as { points: Float32Array }).points;
    expect(p).not.toBe((a.props as { points: Float32Array }).points);
    expect(p.buffer).not.toBe((a.props as { points: Float32Array }).points.buffer);
    expect([...p]).toEqual([...points]);
  });

  it('a frame is copied with what it holds, and the copies belong to the copied frame', () => {
    const rig = shapeRig();
    const f = add(rig, 'frame', 100, 100, { w: 300, h: 200 });
    const inner = solid(rig, 150, 150, 50, 50, { parent: f.id });
    const r = duplicateShapes(rig.core, [f.id]);
    if (!r.ok) throw new Error(r.message);
    expect(ofKind(rig, 'frame')).toHaveLength(2);
    expect(ofKind(rig, 'rect')).toHaveLength(2);
    const copyFrame = ofKind(rig, 'frame').find((s) => s.id !== f.id) as ShapeRecord;
    const copyInner = ofKind(rig, 'rect').find((s) => s.id !== inner.id) as ShapeRecord;
    expect(copyInner.parent).toBe(copyFrame.id);
    expect(get(rig, inner.id).parent).toBe(f.id);
  });

  it('a group is copied as a new group of the copies', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100);
    groupShapes(rig.core, [a.id, b.id]);
    const r = duplicateShapes(rig.core, [a.id]);
    if (!r.ok) throw new Error(r.message);
    expect(ofKind(rig, 'group')).toHaveLength(2);
    const parents = new Set(r.value.map((id) => get(rig, id).parent));
    expect(parents.size).toBe(1);
    expect([...parents][0]).not.toBe(get(rig, a.id).parent);
  });

  it('mod+d duplicates the selection and selects the copies', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    rig.core.selection.set([a.id]);
    expect(key(rig, 'd', { mod: true })).toBe(true);
    expect(ofKind(rig, 'rect')).toHaveLength(2);
    expect(rig.core.selection.ids).toHaveLength(1);
    expect(rig.core.selection.ids[0]).not.toBe(a.id);
  });

  it('nothing selected: a duplicate command with no shapes gives bad_argument and changes nothing', () => {
    const rig = shapeRig();
    const steps = rig.core.history.undoSteps;
    const r = duplicateShapes(rig.core, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('bad_argument');
    expect(rig.core.history.undoSteps).toBe(steps);
  });
});

describe('flip (design 7.4)', () => {
  it('two shapes flipped across x swap sides about the middle of the box that holds them', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100, 50, 50);
    const b = solid(rig, 300, 100, 100, 50);
    flipShapes(rig.core, [a.id, b.id], 'x');
    // the box is 100 to 400; its middle is 250
    expect(centreOf(rig, a.id).x).toBeCloseTo(500 - 125, 6);
    expect(centreOf(rig, b.id).x).toBeCloseTo(500 - 350, 6);
    expect(centreOf(rig, a.id).y).toBeCloseTo(125, 6);
  });

  it('across y: top and bottom swap', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100, 50, 50);
    const b = solid(rig, 100, 300, 50, 100);
    flipShapes(rig.core, [a.id, b.id], 'y');
    // the box is 100 to 400 high
    expect(centreOf(rig, a.id).y).toBeCloseTo(500 - 125, 6);
    expect(centreOf(rig, b.id).y).toBeCloseTo(500 - 350, 6);
  });

  it('flipping twice gives the shapes back where and as they were', () => {
    const rig = shapeRig();
    const a = add(rig, 'line', 100, 100, { points: [0, 0, 100, 40, 160, 10] });
    const b = solid(rig, 300, 100, 50, 50);
    const arrow = add(rig, 'arrow', 50, 300, { start: [0, 0], end: [100, 30], bend: 20 });
    const list = [a.id, b.id, arrow.id];
    const before = list.map((id) => boxOf(rig, id));
    flipShapes(rig.core, list, 'x');
    flipShapes(rig.core, list, 'x');
    list.forEach((id, i) => {
      const b2 = boxOf(rig, id);
      const b1 = before[i] as typeof b2;
      expect(b2.minX).toBeCloseTo(b1.minX, 6);
      expect(b2.maxX).toBeCloseTo(b1.maxX, 6);
      expect(b2.minY).toBeCloseTo(b1.minY, 6);
      expect(b2.maxY).toBeCloseTo(b1.maxY, 6);
    });
  });

  it('a line is mirrored: its first point goes to the other side of its box', () => {
    const rig = shapeRig();
    const a = add(rig, 'line', 100, 100, { points: [0, 0, 100, 40] });
    flipShapes(rig.core, [a.id], 'x');
    const s = get(rig, a.id);
    const pts = (s.props as { points: number[] }).points;
    // the page point of the first point is on the right now, and the second on the left
    const first = { x: s.x + (pts[0] as number), y: s.y + (pts[1] as number) };
    const second = { x: s.x + (pts[2] as number), y: s.y + (pts[3] as number) };
    expect(first.x).toBeCloseTo(200, 6);
    expect(second.x).toBeCloseTo(100, 6);
    expect(first.y).toBeCloseTo(100, 6);
    expect(second.y).toBeCloseTo(140, 6);
  });

  it('an arrow flips with its bend: the curve goes to the other side', () => {
    const rig = shapeRig();
    const a = add(rig, 'arrow', 100, 100, { start: [0, 0], end: [200, 0], bend: 40 });
    flipShapes(rig.core, [a.id], 'x');
    const p = get(rig, a.id).props as { start: number[]; end: number[]; bend: number };
    expect(p.start[0]).toBeCloseTo(200, 6);
    expect(p.end[0]).toBeCloseTo(0, 6);
    // start and end swapped sides; the curve stays on the same side of the page, so the bend turns the other way round
    expect(p.bend).toBeCloseTo(-40, 6);
  });

  it('a triangle flipped across y points down', () => {
    const rig = shapeRig();
    const a = add(rig, 'triangle', 100, 100, { w: 100, h: 80 });
    flipShapes(rig.core, [a.id], 'y');
    const g = shapeGeometryOf(rig, a.id);
    // the first outline point is the apex: it was at the top, it is at the bottom now
    expect(g.outline[1]).toBeCloseTo(180, 6);
    expect(g.outline[0]).toBeCloseTo(150, 6);
  });

  it('is one undo step', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100, 50, 50);
    const b = solid(rig, 300, 100, 100, 50);
    oneStep(rig, () => flipShapes(rig.core, [a.id, b.id], 'x'));
  });
});

/** The geometry of a stored shape. */
function shapeGeometryOf(rig: BoardRig, id: string): { readonly outline: readonly number[] } {
  const g = shapeGeometry(get(rig, id), rig.core.store.kinds);
  if (g === undefined) throw new Error('no geometry');
  return g;
}

describe('nudge (ui.md: arrows, shift+arrows)', () => {
  it('an arrow key moves the selection by 1 unit, Shift by 10', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    rig.core.selection.set([a.id]);
    key(rig, 'ArrowRight');
    expect(get(rig, a.id)).toMatchObject({ x: 101, y: 100 });
    key(rig, 'ArrowDown', { shift: true });
    expect(get(rig, a.id)).toMatchObject({ x: 101, y: 110 });
    key(rig, 'ArrowLeft', { shift: true });
    key(rig, 'ArrowUp');
    expect(get(rig, a.id)).toMatchObject({ x: 91, y: 109 });
  });

  it('every shape of the selection moves, and a locked one does not', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100, 100, 60, { locked: true });
    const c = solid(rig, 500, 100);
    rig.core.selection.set([a.id, b.id, c.id]);
    key(rig, 'ArrowRight', { shift: true });
    expect([get(rig, a.id).x, get(rig, b.id).x, get(rig, c.id).x]).toEqual([110, 300, 510]);
  });

  it('a nudge is an undo step; with nothing selected the key does nothing', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const steps = rig.core.history.undoSteps;
    expect(key(rig, 'ArrowRight')).toBe(false);
    expect(rig.core.history.undoSteps).toBe(steps);
    rig.core.selection.set([a.id]);
    key(rig, 'ArrowRight');
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    rig.core.history.undo();
    expect(get(rig, a.id).x).toBe(100);
  });

  it('arrow keys do not move shapes while text is being typed', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    rig.core.selection.set([a.id]);
    rig.core.editor.open(a.id);
    key(rig, 'ArrowRight');
    expect(get(rig, a.id).x).toBe(100);
  });

  it('a nudge moves a frame with what it holds', () => {
    const rig = shapeRig();
    const f = add(rig, 'frame', 0, 0, { w: 200, h: 100 });
    const inner = solid(rig, 20, 20, 50, 50, { parent: f.id });
    rig.core.selection.set([f.id]);
    key(rig, 'ArrowDown', { shift: true });
    expect(get(rig, inner.id).y).toBe(30);
  });
});

describe('delete (ui.md: Delete and Backspace)', () => {
  it('Delete and Backspace remove the selection in one undo step; undo brings the shapes back as they were', () => {
    for (const k of ['Delete', 'Backspace']) {
      const rig = shapeRig();
      const a = solid(rig, 100, 100);
      const b = solid(rig, 300, 100);
      rig.core.selection.set([a.id, b.id]);
      const before = dump(rig.core.store);
      const steps = rig.core.history.undoSteps;
      expect(key(rig, k)).toBe(true);
      expect(shapesOf(rig)).toHaveLength(0);
      expect(rig.core.selection.size).toBe(0);
      expect(rig.core.history.undoSteps).toBe(steps + 1);
      rig.core.history.undo();
      expect(dump(rig.core.store)).toBe(before);
    }
  });

  it('deleting a frame removes what it holds', () => {
    const rig = shapeRig();
    const f = add(rig, 'frame', 0, 0, { w: 200, h: 100 });
    solid(rig, 20, 20, 50, 50, { parent: f.id });
    deleteShapes(rig.core, [f.id]);
    expect(shapesOf(rig)).toHaveLength(0);
  });

  it('with nothing selected the key does nothing', () => {
    const rig = shapeRig();
    solid(rig, 100, 100);
    expect(key(rig, 'Delete')).toBe(false);
    expect(shapesOf(rig)).toHaveLength(1);
  });

  it('the Delete key does not delete shapes while text is typed', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    rig.core.selection.set([a.id]);
    rig.core.editor.open(a.id);
    key(rig, 'Delete');
    expect(shapesOf(rig)).toHaveLength(1);
  });

  it('every edit of a session can be undone, back to an empty board, one step each', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100);
    const steps = rig.core.history.undoSteps;
    translateShapes(rig.core, [a.id], 10, 10);
    alignShapes(rig.core, [a.id, b.id], 'top');
    groupShapes(rig.core, [a.id, b.id]);
    setLocked(rig.core, [a.id], true);
    expect(rig.core.history.undoSteps).toBe(steps + 4);
    expect(undoAll(rig)).toBe(steps + 4);
    expect(shapesOf(rig)).toHaveLength(0);
  });
});

describe('style (ui.md: colour, size, fill, dash, font)', () => {
  it('colour is the line of a box shape and the colour of a text; fill is the fill', () => {
    const rig = shapeRig();
    const a = rect(rig, 100, 100);
    const t = add(rig, 'text', 300, 100, { text: 'hi' });
    styleShapes(rig.core, [a.id, t.id], { color: '#ff0000', fill: '#00ff00', size: 5 });
    expect(get(rig, a.id).props).toMatchObject({ stroke: '#ff0000', fill: '#00ff00', size: 5 });
    expect((get(rig, t.id).props as { color: string }).color).toBe('#ff0000');
  });

  it('a style change is one undo step for all the shapes, and a kind that has no such part leaves it', () => {
    const rig = shapeRig();
    const a = rect(rig, 100, 100);
    const b = add(rig, 'line', 300, 100, { points: [0, 0, 100, 0] });
    const img = add(rig, 'image', 500, 100, { asset: 'asset:1', w: 10, h: 10 });
    const before = plain(get(rig, img.id));
    oneStep(rig, () => styleShapes(rig.core, [a.id, b.id, img.id], { dash: 'dashed' }));
    expect(plain(get(rig, img.id))).toBe(before);
  });

  it('a style the kind refuses is not written', () => {
    const rig = shapeRig();
    const a = rect(rig, 100, 100);
    const r = styleShapes(rig.core, [a.id], { color: 'not-a-colour' });
    expect(r.ok).toBe(false);
    expect(get(rig, a.id)).toBe(a);
  });
});

describe('the commands are one undo step each, whatever they write (R2.3)', () => {
  it('twenty shapes aligned, distributed, ordered, flipped and moved: five steps', () => {
    const rig = shapeRig();
    const list = Array.from({ length: 20 }, (_v, i) => solid(rig, i * 70, (i % 4) * 90, 50, 40));
    const all = list.map((s) => s.id);
    const steps = rig.core.history.undoSteps;
    alignShapes(rig.core, all, 'top');
    distributeShapes(rig.core, all, 'x');
    orderShapes(rig.core, all.slice(0, 10), 'front');
    flipShapes(rig.core, all, 'y');
    translateShapes(rig.core, all, 5, 5);
    expect(rig.core.history.undoSteps).toBe(steps + 5);
  });

  it('a command that is refused changes nothing and leaves no step: a bad id', () => {
    const rig = shapeRig();
    solid(rig, 0, 0);
    const steps = rig.core.history.undoSteps;
    const before = dump(rig.core.store);
    translateShapes(rig.core, ['shape:nope'], 5, 5);
    deleteShapes(rig.core, ['shape:nope']);
    setLocked(rig.core, ['shape:nope'], true);
    expect(rig.core.history.undoSteps).toBe(steps);
    expect(dump(rig.core.store)).toBe(before);
  });

  it('a move that is not a number is bad_argument and nothing is written', () => {
    const rig = shapeRig();
    const a = solid(rig, 0, 0);
    const r = translateShapes(rig.core, [a.id], Number.NaN, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('bad_argument');
    expect(get(rig, a.id)).toBe(a);
  });
});
