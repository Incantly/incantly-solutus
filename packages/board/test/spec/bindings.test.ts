// @vitest-environment node
/**
 * Arrow bindings (design 4 and 7.1; requirement R5.3; B19 invariant "the arrows bound to a changed shape follow it in
 * the same transaction"): an arrow end sticks to a shape through a binding record, follows it when it is moved,
 * resized or turned, and everything survives undo and redo. Only the public API is used.
 */
import { describe, expect, it } from 'vitest';
import {
  ARROW_GAP, alignShapes, bindEnd, bindingProps, bindingsOfArrow, bindingsOnTarget, boundTarget, deleteShapes, flipShapes, groupShapes, shapeGeometry, translateShapes, unbindEnd,
} from '../../src/index';
import type { ShapeRecord } from '../../src/index';
import { dump } from './helpers';
import { add, centreOf, drag, get, plain, shapeRig } from './shape-helpers';
import type { BoardRig } from './shape-helpers';

const solid = (rig: BoardRig, x: number, y: number, w = 100, h = 60, over: Partial<ShapeRecord> = {}): ShapeRecord => add(rig, 'rect', x, y, { w, h, fill: '#ffcc00' }, over);

/** The page point of one end of an arrow. */
function endOf(rig: BoardRig, arrow: string, end: 'start' | 'end'): { x: number; y: number } {
  const s = get(rig, arrow);
  const p = (s.props as { start: [number, number]; end: [number, number] })[end];
  const g = shapeGeometry(s, rig.core.store.kinds);
  return g?.toPage(p[0], p[1]) ?? { x: Number.NaN, y: Number.NaN };
}

/** The arrow and its binding records as text, bindings in the order of their ids. */
function arrowAndBindings(rig: BoardRig, arrow: string): string {
  const list = [...rig.core.store.all('binding')].sort((x, y) => (x.id < y.id ? -1 : 1));
  return plain([get(rig, arrow), ...list]);
}

/** Two boxes with an arrow from the first to the second, both ends stuck. A is at x 100..200, B at x 400..500, both y 100..160. */
function pair(rig: BoardRig): { a: ShapeRecord; b: ShapeRecord; arrow: ShapeRecord } {
  const a = solid(rig, 100, 100);
  const b = solid(rig, 400, 100);
  const arrow = add(rig, 'arrow', 200, 130, { start: [0, 0], end: [200, 0] });
  const done = rig.core.store.change('user', (tx) => {
    const s = bindEnd(tx, rig.core.store, arrow.id, 'start', a.id, { x: 150, y: 130 });
    const e = bindEnd(tx, rig.core.store, arrow.id, 'end', b.id, { x: 450, y: 130 });
    return [s, e];
  });
  if (!done.ok || !done.value.value.every((r) => r.ok)) throw new Error('could not stick the arrow');
  return { a, b, arrow };
}

describe('sticking an arrow end to a shape', () => {
  it('writes one binding record for each stuck end, from the arrow to the shape', () => {
    const rig = shapeRig();
    const { a, b, arrow } = pair(rig);
    const bindings = rig.core.store.all('binding');
    expect(bindings).toHaveLength(2);
    expect(bindingsOfArrow(rig.core.store, arrow.id)).toHaveLength(2);
    expect(bindingsOnTarget(rig.core.store, a.id)).toHaveLength(1);
    expect(bindingsOnTarget(rig.core.store, b.id)).toHaveLength(1);
    expect(boundTarget(rig.core.store, arrow.id, 'start')).toBe(a.id);
    expect(boundTarget(rig.core.store, arrow.id, 'end')).toBe(b.id);
    for (const r of bindings) {
      const bd = r as { id: string; kind: string; from: string; to: string };
      expect(bd.id.startsWith('binding:')).toBe(true);
      expect(bd.kind).toBe('arrow');
      expect(bd.from).toBe(arrow.id);
    }
  });

  it('the binding says which end it is and where on the box the arrow aims', () => {
    const rig = shapeRig();
    const { arrow } = pair(rig);
    const props = bindingsOfArrow(rig.core.store, arrow.id).map((r) => bindingProps(r));
    expect(props.map((p) => p?.end).sort()).toEqual(['end', 'start']);
    for (const p of props) {
      expect(p?.anchor).toHaveLength(2);
      expect(p?.anchor[0]).toBeGreaterThanOrEqual(0);
      expect(p?.anchor[0]).toBeLessThanOrEqual(1);
    }
    expect(props.find((p) => p?.end === 'start')?.anchor).toEqual([0.5, 0.5]);
  });

  it('the ends sit ARROW_GAP (8 units) short of the outline of the shapes they are stuck to, on the line between them', () => {
    const rig = shapeRig();
    const { arrow } = pair(rig);
    const s = endOf(rig, arrow.id, 'start');
    const e = endOf(rig, arrow.id, 'end');
    expect(ARROW_GAP).toBe(8);
    expect(s.x).toBeCloseTo(200 + ARROW_GAP, 4);
    expect(s.y).toBeCloseTo(130, 4);
    expect(e.x).toBeCloseTo(400 - ARROW_GAP, 4);
    expect(e.y).toBeCloseTo(130, 4);
  });

  it('an arrow put with its ends stuck in one transaction is already on its ends: the head shows beside the shape', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 400, 100);
    // the arrow is made with both ends at the shapes' middles, as the agent's `arrow` action does
    const arrow = add(rig, 'arrow', 150, 130, { start: [0, 0], end: [300, 0] });
    const done = rig.core.store.change('user', (tx) => [bindEnd(tx, rig.core.store, arrow.id, 'start', a.id, { x: 150, y: 130 }), bindEnd(tx, rig.core.store, arrow.id, 'end', b.id, { x: 450, y: 130 })]);
    expect(done.ok && done.value.value.every((r) => r.ok)).toBe(true);
    expect(endOf(rig, arrow.id, 'start').x).toBeCloseTo(200 + ARROW_GAP, 4);
    expect(endOf(rig, arrow.id, 'end').x).toBeCloseTo(400 - ARROW_GAP, 4);
  });

  it('an end never stops short by more than half the way when the other end is close to the outline', () => {
    const rig = shapeRig();
    const b = solid(rig, 210, 100);
    const arrow = add(rig, 'arrow', 205, 130, { start: [0, 0], end: [60, 0] });
    rig.core.store.change('user', (tx) => bindEnd(tx, rig.core.store, arrow.id, 'end', b.id, { x: 260, y: 130 }));
    const e = endOf(rig, arrow.id, 'end');
    expect(e.x).toBeCloseTo(207.5, 4);
    expect(e.x).toBeGreaterThan(endOf(rig, arrow.id, 'start').x);
  });

  it('an end that is not stuck stays where it was put', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const arrow = add(rig, 'arrow', 300, 400, { start: [0, 0], end: [100, 0] });
    translateShapes(rig.core, [a.id], 50, 0);
    expect(endOf(rig, arrow.id, 'start')).toEqual({ x: 300, y: 400 });
    expect(rig.core.store.all('binding')).toHaveLength(0);
  });

  it('sticking an end again replaces its binding; the other end is not touched', () => {
    const rig = shapeRig();
    const { b, arrow } = pair(rig);
    const c = solid(rig, 400, 400);
    rig.core.store.change('user', (tx) => void bindEnd(tx, rig.core.store, arrow.id, 'end', c.id, { x: 450, y: 430 }));
    expect(boundTarget(rig.core.store, arrow.id, 'end')).toBe(c.id);
    expect(bindingsOnTarget(rig.core.store, b.id)).toHaveLength(0);
    expect(rig.core.store.all('binding')).toHaveLength(2);
    expect(boundTarget(rig.core.store, arrow.id, 'start')).toBeDefined();
  });

  it('unbindEnd frees one end, which stays where it is', () => {
    const rig = shapeRig();
    const { a, arrow } = pair(rig);
    const where = endOf(rig, arrow.id, 'start');
    rig.core.store.change('user', (tx) => void unbindEnd(tx, rig.core.store, arrow.id, 'start'));
    expect(boundTarget(rig.core.store, arrow.id, 'start')).toBeUndefined();
    expect(endOf(rig, arrow.id, 'start')).toEqual(where);
    translateShapes(rig.core, [a.id], 0, 200);
    expect(endOf(rig, arrow.id, 'start')).toEqual(where);
  });

  it('refuses what cannot be stuck: a shape that is not an arrow, a missing shape, a group, the arrow itself', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 400, 100);
    const arrow = add(rig, 'arrow', 0, 0, {});
    groupShapes(rig.core, [a.id, b.id]);
    const group = get(rig, a.id).parent as string;
    const results = rig.core.store.change('user', (tx) => [
      bindEnd(tx, rig.core.store, a.id, 'end', b.id, { x: 0, y: 0 }),
      bindEnd(tx, rig.core.store, arrow.id, 'end', 'shape:missing', { x: 0, y: 0 }),
      bindEnd(tx, rig.core.store, arrow.id, 'end', group, { x: 0, y: 0 }),
      bindEnd(tx, rig.core.store, arrow.id, 'end', arrow.id, { x: 0, y: 0 }),
    ]);
    expect(results.ok).toBe(true);
    if (!results.ok) return;
    for (const r of results.value.value) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.kind).toBe('bad_argument');
    }
    expect(rig.core.store.all('binding')).toHaveLength(0);
  });
});

describe('the arrow follows the shape (B19: in the same transaction)', () => {
  it('moving a shape moves the stuck end with it, in one undo step', () => {
    const rig = shapeRig();
    const { a, arrow } = pair(rig);
    const steps = rig.core.history.undoSteps;
    translateShapes(rig.core, [a.id], 0, 100);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    const s = endOf(rig, arrow.id, 'start');
    // the box A is now at y 200..260; the arrow aims at the middle of it from the other end
    expect(s.y).toBeGreaterThan(200);
    expect(s.y).toBeLessThan(260);
    expect(s.x).toBeGreaterThan(100);
    expect(s.x).toBeLessThanOrEqual(200 + ARROW_GAP + 1e-6);
    expect(get(rig, a.id).y).toBe(200);
    // the end is on the outline of A
    expect(shapeGeometry(get(rig, a.id), rig.core.store.kinds)?.hit(s.x, s.y, ARROW_GAP + 2)).toBe(true);
  });

  it('undo gives back the shape and the arrow together; redo moves both again', () => {
    const rig = shapeRig();
    const { a, arrow } = pair(rig);
    const before = plain([get(rig, a.id), get(rig, arrow.id)]);
    translateShapes(rig.core, [a.id], 30, 120);
    const after = plain([get(rig, a.id), get(rig, arrow.id)]);
    expect(after).not.toBe(before);
    rig.core.history.undo();
    expect(plain([get(rig, a.id), get(rig, arrow.id)])).toBe(before);
    expect(rig.core.store.all('binding')).toHaveLength(2);
    rig.core.history.redo();
    expect(plain([get(rig, a.id), get(rig, arrow.id)])).toBe(after);
  });

  it('dragging a shape with the select tool moves the arrow along, and one undo takes both back', () => {
    const rig = shapeRig();
    const { b, arrow } = pair(rig);
    const before = plain(get(rig, arrow.id));
    const steps = rig.core.history.undoSteps;
    drag(rig, [450, 130], [450, 330], 0, 20);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    expect(endOf(rig, arrow.id, 'end').y).toBeGreaterThan(130);
    expect(get(rig, b.id).y).toBe(300);
    rig.core.history.undo();
    expect(plain(get(rig, arrow.id))).toBe(before);
    expect(get(rig, b.id).y).toBe(100);
    expect(rig.core.store.all('binding')).toHaveLength(2);
  });

  it('moving the shape by many steps and undoing them one after the other still ends at the start', () => {
    const rig = shapeRig();
    const { a, arrow } = pair(rig);
    const before = plain([get(rig, a.id), get(rig, arrow.id)]);
    for (let i = 0; i < 5; i++) translateShapes(rig.core, [a.id], 20, 10);
    for (let i = 0; i < 5; i++) rig.core.history.undo();
    expect(plain([get(rig, a.id), get(rig, arrow.id)])).toBe(before);
  });

  it('resizing a shape keeps the end on its outline', () => {
    const rig = shapeRig();
    const { a, arrow } = pair(rig);
    drag(rig, [150, 130], [150, 131], 0, 1);
    rig.core.selection.set([a.id]);
    // the east handle of A is at (200, 130); pull it to 260
    drag(rig, [200, 130], [260, 130], 0, 8, 1000);
    expect(get(rig, a.id).props).toMatchObject({ w: 160 });
    const s = endOf(rig, arrow.id, 'start');
    expect(shapeGeometry(get(rig, a.id), rig.core.store.kinds)?.hit(s.x, s.y, ARROW_GAP + 2)).toBe(true);
    expect(s.x).toBeCloseTo(260 + ARROW_GAP, 3);
  });

  it('turning a shape keeps the end on its outline', () => {
    const rig = shapeRig();
    const { a, arrow } = pair(rig);
    rig.core.selection.set([a.id]);
    const g = shapeGeometry(get(rig, a.id), rig.core.store.kinds);
    expect(g).toBeDefined();
    // the rotate handle is straight above the middle (150, 130); the pointer goes to the right: a quarter turn
    drag(rig, [150, 100 - 26], [250, 130], 0, 12, 1000);
    expect(get(rig, a.id).rotation).toBeCloseTo(Math.PI / 2, 5);
    const s = endOf(rig, arrow.id, 'start');
    expect(shapeGeometry(get(rig, a.id), rig.core.store.kinds)?.hit(s.x, s.y, ARROW_GAP + 2)).toBe(true);
  });

  it('aligning and flipping stuck shapes carry the arrows (every write to a shape moves its arrows)', () => {
    const rig = shapeRig();
    const { a, b, arrow } = pair(rig);
    const c = solid(rig, 700, 500);
    alignShapes(rig.core, [a.id, b.id, c.id], 'bottom');
    for (const [s, id] of [['start', a.id], ['end', b.id]] as const) {
      const p = endOf(rig, arrow.id, s);
      expect(shapeGeometry(get(rig, id), rig.core.store.kinds)?.hit(p.x, p.y, ARROW_GAP + 2), `${s} after align`).toBe(true);
    }
    flipShapes(rig.core, [a.id, b.id, c.id], 'x');
    for (const [s, id] of [['start', a.id], ['end', b.id]] as const) {
      const p = endOf(rig, arrow.id, s);
      expect(shapeGeometry(get(rig, id), rig.core.store.kinds)?.hit(p.x, p.y, ARROW_GAP + 2), `${s} after flip`).toBe(true);
    }
  });

  it('two arrows stuck to one shape both follow it', () => {
    const rig = shapeRig();
    const { a, arrow } = pair(rig);
    const second = add(rig, 'arrow', 150, 300, { start: [0, 0], end: [0, -100] });
    rig.core.store.change('user', (tx) => void bindEnd(tx, rig.core.store, second.id, 'end', a.id, { x: 150, y: 130 }));
    translateShapes(rig.core, [a.id], 0, 50);
    for (const id of [arrow.id, second.id]) {
      const p = endOf(rig, id, id === arrow.id ? 'start' : 'end');
      expect(shapeGeometry(get(rig, a.id), rig.core.store.kinds)?.hit(p.x, p.y, ARROW_GAP + 2), id).toBe(true);
    }
  });

  it('an arrow stuck at both ends follows when either shape moves', () => {
    const rig = shapeRig();
    const { b, arrow } = pair(rig);
    const startBefore = endOf(rig, arrow.id, 'start');
    translateShapes(rig.core, [b.id], 0, 200);
    const startAfter = endOf(rig, arrow.id, 'start');
    // the other end moved, so the line from it to the first box changed, and the start with it
    expect(startAfter.y).not.toBeCloseTo(startBefore.y, 3);
  });

  it('a shape moved with its frame or group carries the arrows that are stuck to it', () => {
    const rig = shapeRig();
    const f = add(rig, 'frame', 50, 50, { w: 300, h: 200 });
    const inner = solid(rig, 100, 100, 100, 60, { parent: f.id });
    const arrow = add(rig, 'arrow', 600, 130, { start: [0, 0], end: [-300, 0] });
    rig.core.store.change('user', (tx) => void bindEnd(tx, rig.core.store, arrow.id, 'end', inner.id, { x: 150, y: 130 }));
    translateShapes(rig.core, [f.id], 0, 200);
    const p = endOf(rig, arrow.id, 'end');
    expect(shapeGeometry(get(rig, inner.id), rig.core.store.kinds)?.hit(p.x, p.y, ARROW_GAP + 2)).toBe(true);
    expect(p.y).toBeGreaterThan(300);
  });

  it('the arrow follows a shape the user moves with the keyboard', () => {
    const rig = shapeRig();
    const { a, arrow } = pair(rig);
    rig.core.selection.set([a.id]);
    rig.host.key({ key: 'ArrowDown', down: true, shift: true, alt: false, mod: false, repeat: false });
    const s = endOf(rig, arrow.id, 'start');
    expect(shapeGeometry(get(rig, a.id), rig.core.store.kinds)?.hit(s.x, s.y, ARROW_GAP + 2)).toBe(true);
    expect(get(rig, a.id).y).toBe(110);
  });
});

describe('deleting and undoing', () => {
  it('deleting the shape an arrow is stuck to removes the binding and leaves the end where it was; undo gives both back', () => {
    const rig = shapeRig();
    const { b, arrow } = pair(rig);
    const endBefore = endOf(rig, arrow.id, 'end');
    const all = dump(rig.core.store);
    deleteShapes(rig.core, [b.id]);
    expect(boundTarget(rig.core.store, arrow.id, 'end')).toBeUndefined();
    expect(rig.core.store.all('binding')).toHaveLength(1);
    expect(get(rig, arrow.id)).toBeDefined();
    expect(endOf(rig, arrow.id, 'end')).toEqual(endBefore);
    rig.core.history.undo();
    expect(dump(rig.core.store)).toBe(all);
    expect(boundTarget(rig.core.store, arrow.id, 'end')).toBe(b.id);
  });

  it('deleting an arrow removes its bindings, and undo restores them', () => {
    const rig = shapeRig();
    const { arrow } = pair(rig);
    deleteShapes(rig.core, [arrow.id]);
    expect(rig.core.store.all('binding')).toHaveLength(0);
    rig.core.history.undo();
    expect(rig.core.store.all('binding')).toHaveLength(2);
  });

  it('a binding never names a record that is gone: after any delete every binding points at shapes that exist', () => {
    const rig = shapeRig();
    const { a, b } = pair(rig);
    deleteShapes(rig.core, [a.id]);
    deleteShapes(rig.core, [b.id]);
    for (const r of rig.core.store.all('binding')) {
      const bd = r as { from: string; to: string };
      expect(rig.core.store.get(bd.from)).toBeDefined();
      expect(rig.core.store.get(bd.to)).toBeDefined();
    }
    expect(rig.core.store.all('binding')).toHaveLength(0);
  });

  it('a shape moved and then deleted and undone twice is back with its arrow following again', () => {
    const rig = shapeRig();
    const { a, arrow } = pair(rig);
    translateShapes(rig.core, [a.id], 0, 60);
    deleteShapes(rig.core, [a.id]);
    rig.core.history.undo();
    rig.core.history.undo();
    expect(get(rig, a.id).y).toBe(100);
    translateShapes(rig.core, [a.id], 0, 60);
    const s = endOf(rig, arrow.id, 'start');
    expect(shapeGeometry(get(rig, a.id), rig.core.store.kinds)?.hit(s.x, s.y, ARROW_GAP + 2)).toBe(true);
  });
});

describe("dragging an arrow's ends with the select tool (B19: handling)", () => {
  it('an end dragged off its shape is free: the binding is gone, the end is where it was dropped, one undo step', () => {
    const rig = shapeRig();
    const { b, arrow } = pair(rig);
    rig.core.selection.set([arrow.id]);
    const steps = rig.core.history.undoSteps;
    const before = arrowAndBindings(rig, arrow.id);
    const e = endOf(rig, arrow.id, 'end');
    drag(rig, [e.x, e.y], [e.x + 100, e.y + 250], 0, 10);
    expect(boundTarget(rig.core.store, arrow.id, 'end')).toBeUndefined();
    expect(bindingsOnTarget(rig.core.store, b.id)).toHaveLength(0);
    const p = endOf(rig, arrow.id, 'end');
    expect(p.x).toBeCloseTo(e.x + 100, 4);
    expect(p.y).toBeCloseTo(e.y + 250, 4);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    rig.core.history.undo();
    expect(arrowAndBindings(rig, arrow.id)).toBe(before);
    expect(boundTarget(rig.core.store, arrow.id, 'end')).toBe(b.id);
  });

  it('a free end dropped on a shape sticks to it, in the same undo step', () => {
    const rig = shapeRig();
    const c = solid(rig, 400, 400);
    const arrow = add(rig, 'arrow', 100, 300, { start: [0, 0], end: [100, 0] });
    rig.core.selection.set([arrow.id]);
    const steps = rig.core.history.undoSteps;
    drag(rig, [200, 300], [450, 430], 0, 10);
    expect(boundTarget(rig.core.store, arrow.id, 'end')).toBe(c.id);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    const p = endOf(rig, arrow.id, 'end');
    expect(shapeGeometry(get(rig, c.id), rig.core.store.kinds)?.hit(p.x, p.y, ARROW_GAP + 2)).toBe(true);
    rig.core.history.undo();
    expect(boundTarget(rig.core.store, arrow.id, 'end')).toBeUndefined();
    expect(endOf(rig, arrow.id, 'end')).toEqual({ x: 200, y: 300 });
  });

  it('while an end is dragged over a shape the overlay hints at the shape it would stick to; the hint is gone after', () => {
    const rig = shapeRig();
    const c = solid(rig, 400, 400);
    const arrow = add(rig, 'arrow', 100, 300, { start: [0, 0], end: [100, 0] });
    rig.core.selection.set([arrow.id]);
    const move = (x: number, y: number, phase: 'down' | 'move' | 'up', t: number): void =>
      rig.host.sample({ pointer: 1, device: 'mouse', phase, x, y, pressure: Number.NaN, tiltX: 0, tiltY: 0, twist: 0, buttons: phase === 'up' ? 0 : 1, time: t, predicted: false });
    move(200, 300, 'down', 0);
    move(300, 360, 'move', 8);
    expect(rig.overlay.hint).toBeNull();
    move(450, 430, 'move', 16);
    expect(rig.overlay.hint).not.toBeNull();
    expect((rig.overlay.hint ?? []).length).toBeGreaterThanOrEqual(8);
    move(450, 430, 'up', 24);
    expect(rig.overlay.hint).toBeNull();
    expect(boundTarget(rig.core.store, arrow.id, 'end')).toBe(c.id);
  });

  it('an end dropped on empty page that was free stays free', () => {
    const rig = shapeRig();
    const arrow = add(rig, 'arrow', 100, 300, { start: [0, 0], end: [100, 0] });
    rig.core.selection.set([arrow.id]);
    drag(rig, [200, 300], [600, 700], 0, 8);
    expect(rig.core.store.all('binding')).toHaveLength(0);
    expect(endOf(rig, arrow.id, 'end')).toEqual({ x: 600, y: 700 });
  });

  it('a cancel in the middle of an end drag puts the arrow and its binding back', () => {
    const rig = shapeRig();
    const { b, arrow } = pair(rig);
    rig.core.selection.set([arrow.id]);
    const before = arrowAndBindings(rig, arrow.id);
    const e = endOf(rig, arrow.id, 'end');
    rig.host.sample({ pointer: 1, device: 'mouse', phase: 'down', x: e.x, y: e.y, pressure: Number.NaN, tiltX: 0, tiltY: 0, twist: 0, buttons: 1, time: 0, predicted: false });
    rig.host.sample({ pointer: 1, device: 'mouse', phase: 'move', x: e.x + 80, y: e.y + 200, pressure: Number.NaN, tiltX: 0, tiltY: 0, twist: 0, buttons: 1, time: 8, predicted: false });
    rig.host.cancel();
    expect(arrowAndBindings(rig, arrow.id)).toBe(before);
    expect(boundTarget(rig.core.store, arrow.id, 'end')).toBe(b.id);
  });

  it('the centre of the stuck shape is not the end: the end is on the outline, not inside the shape', () => {
    const rig = shapeRig();
    const { b, arrow } = pair(rig);
    const e = endOf(rig, arrow.id, 'end');
    const c = centreOf(rig, b.id);
    expect(Math.hypot(e.x - c.x, e.y - c.y)).toBeGreaterThan(30);
  });
});
