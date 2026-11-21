// @vitest-environment node
/**
 * The gesture (design 7.4; docs/state-machines.md B25): the writes of one pointer gesture are one undo step, and a
 * cancel puts back every record any of them changed, read from the store's own diffs. The tools write only through a
 * gesture, so a cancel never leaves a binding, a bound arrow or a grouped child behind (round 3, BR-26).
 */
import { describe, expect, it } from 'vitest';
import { GESTURE_MACHINE, beginGesture, boundTarget, groupShapes, translateShapes } from '../../src/index';
import type { ShapeRecord } from '../../src/index';
import { dump } from './helpers';
import { drawPath, line, makeRig, strokes } from './ink-helpers';
import { add, centreOf, drag, get, press, shapeRig, stick } from './shape-helpers';
import type { BoardRig } from './shape-helpers';

const solid = (rig: BoardRig, x: number, y: number, w = 100, h = 60): ShapeRecord => add(rig, 'rect', x, y, { w, h, fill: '#ffcc00' });

describe('the gesture API (B25)', () => {
  it('writes are one undo step, and commit keeps them', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const steps = rig.core.history.undoSteps;
    const g = beginGesture(rig.core);
    expect(g.state).toBe('open');
    for (let i = 1; i <= 5; i++) expect(translateShapes(rig.core, [a.id], 10, 0, { gesture: g }).ok).toBe(true);
    g.commit();
    expect(g.state).toBe('committed');
    expect(get(rig, a.id).x).toBe(150);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    expect(g.writes).toBe(5);
  });

  it('cancel puts back an updated, an added and a removed record, and leaves no undo step', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100);
    const steps = rig.core.history.undoSteps;
    const before = dump(rig.core.store);
    const g = beginGesture(rig.core);
    g.write((tx) => void tx.update(a.id, { x: 500 }));
    g.write((tx) => void tx.remove(b.id));
    g.write((tx) => void tx.put({ ...a, id: tx.newId('shape'), x: 7 }));
    expect(dump(rig.core.store)).not.toBe(before);
    g.cancel();
    expect(g.state).toBe('cancelled');
    expect(dump(rig.core.store)).toBe(before);
    expect(rig.core.history.undoSteps).toBe(steps);
  });

  it('a record added and then changed by a later write is removed by the cancel', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const before = dump(rig.core.store);
    const g = beginGesture(rig.core);
    let id = '';
    g.write((tx) => {
      id = tx.newId('shape');
      tx.put({ ...a, id });
    });
    g.write((tx) => void tx.update(id, { x: 90 }));
    expect(rig.core.store.get(id)).toBeDefined();
    g.cancel();
    expect(rig.core.store.get(id)).toBeUndefined();
    expect(dump(rig.core.store)).toBe(before);
  });

  it('a write after commit or cancel is refused, and a second commit or cancel does nothing', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const done = beginGesture(rig.core);
    done.write((tx) => void tx.update(a.id, { x: 120 }));
    done.commit();
    const refused = done.write((tx) => void tx.update(a.id, { x: 999 }));
    expect(refused.ok).toBe(false);
    done.cancel();
    expect(get(rig, a.id).x).toBe(120);
    const dropped = beginGesture(rig.core);
    dropped.cancel();
    dropped.commit();
    expect(dropped.state).toBe('cancelled');
  });

  it('a refused write changes nothing and is not counted', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const g = beginGesture(rig.core);
    expect(g.write((tx) => void tx.update('shape:missing', { x: 1 })).ok).toBe(false);
    expect(g.writes).toBe(0);
    expect(g.write((tx) => void tx.update(a.id, { x: 130 })).ok).toBe(true);
    expect(g.writes).toBe(1);
  });

  it('two gestures on one board do not merge into one undo step', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const steps = rig.core.history.undoSteps;
    const one = beginGesture(rig.core);
    translateShapes(rig.core, [a.id], 10, 0, { gesture: one });
    one.commit();
    const two = beginGesture(rig.core);
    translateShapes(rig.core, [a.id], 10, 0, { gesture: two });
    two.commit();
    expect(rig.core.history.undoSteps).toBe(steps + 2);
  });

  it('the table has the three states and refuses every move out of the two final ones', () => {
    expect(GESTURE_MACHINE).toEqual({
      open: { write: 'open', commit: 'committed', cancel: 'cancelled' },
      committed: {},
      cancelled: {},
    });
  });
});

describe('a cancelled tool gesture puts back everything it touched (B19, B20, B8, B25)', () => {
  it('the end drag of a bound arrow: the arrow and its binding are back, and no undo step is left', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 400, 100);
    const arrow = add(rig, 'arrow', 200, 130, { start: [0, 0], end: [200, 0] });
    stick(rig, arrow.id, [['start', a.id, 150, 130], ['end', b.id, 450, 130]]);
    rig.core.selection.set([arrow.id]);
    const before = dump(rig.core.store);
    const steps = rig.core.history.undoSteps;
    const end = { x: 400, y: 130 };
    press(rig, [[end.x, end.y], [end.x + 80, end.y + 200]]);
    expect(boundTarget(rig.core.store, arrow.id, 'end')).toBeUndefined();
    rig.host.cancel();
    expect(dump(rig.core.store)).toBe(before);
    expect(boundTarget(rig.core.store, arrow.id, 'end')).toBe(b.id);
    expect(rig.core.history.undoSteps).toBe(steps);
  });

  it('a group dragged with a bound arrow: the members, the group and the arrow come back', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 250, 100);
    const c = solid(rig, 600, 300);
    const arrow = add(rig, 'arrow', 200, 130, { start: [0, 0], end: [400, 200] });
    stick(rig, arrow.id, [['start', a.id, 150, 130], ['end', c.id, 650, 330]]);
    const grouped = groupShapes(rig.core, [a.id, b.id]);
    expect(grouped.ok).toBe(true);
    rig.core.selection.set(grouped.ok ? grouped.value : []);
    const before = dump(rig.core.store);
    const steps = rig.core.history.undoSteps;
    const from = centreOf(rig, a.id);
    press(rig, [[from.x, from.y], [from.x + 60, from.y + 40], [from.x + 160, from.y + 90]]);
    expect(dump(rig.core.store)).not.toBe(before);
    rig.host.cancel();
    expect(dump(rig.core.store)).toBe(before);
    expect(rig.core.history.undoSteps).toBe(steps);
    // the gesture is gone: the next drag works and is one undo step
    drag(rig, [from.x, from.y], [from.x + 50, from.y], 0, 4, 2000);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
  });

  it('a resize of a bound shape: the shape and the arrow that followed it come back', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 400, 100);
    const arrow = add(rig, 'arrow', 200, 130, { start: [0, 0], end: [200, 0] });
    stick(rig, arrow.id, [['start', a.id, 150, 130], ['end', b.id, 450, 130]]);
    rig.core.selection.set([a.id]);
    const before = dump(rig.core.store);
    const steps = rig.core.history.undoSteps;
    press(rig, [[200, 160], [260, 220]]);
    expect(dump(rig.core.store)).not.toBe(before);
    rig.host.cancel();
    expect(dump(rig.core.store)).toBe(before);
    expect(rig.core.history.undoSteps).toBe(steps);
  });

  it('a shape tool drag started inside a frame: the shape and its parent change go away together', () => {
    const rig = shapeRig('rect');
    const frame = add(rig, 'frame', 0, 0, { w: 600, h: 500 });
    const before = dump(rig.core.store);
    const steps = rig.core.history.undoSteps;
    press(rig, [[100, 100], [220, 180], [260, 200]]);
    expect(rig.core.store.shapesOn(frame.page).some((s) => s.kind === 'rect')).toBe(true);
    rig.host.cancel();
    expect(dump(rig.core.store)).toBe(before);
    expect(rig.core.history.undoSteps).toBe(steps);
  });

  it('an eraser drag put down by a cancel brings back every stroke it erased', () => {
    const rig = makeRig();
    for (const x of [100, 140, 180]) drawPath(rig, line(x, 20, x, 180, 12), {}, x * 100);
    expect(strokes(rig)).toHaveLength(3);
    const before = dump(rig.core.store);
    const steps = rig.core.history.undoSteps;
    rig.styles.eraser = { mode: 'whole', radius: 8 };
    rig.host.setTool('eraser');
    press(rig, line(100, 20, 180, 20, 8));
    expect(strokes(rig).length).toBeLessThan(3);
    rig.host.cancel();
    expect(dump(rig.core.store)).toBe(before);
    expect(rig.core.history.undoSteps).toBe(steps);
  });
});
