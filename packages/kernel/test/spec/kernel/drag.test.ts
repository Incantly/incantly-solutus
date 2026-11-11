/**
 * Free writes, drag plans, drag and commitDrag.
 * Docs: kernel/design.md 7 and 9.7; kernel rulings K8; kernel/errors.md 1 (not_free, locked); README decision 10;
 * numbers-sliders/design.md 3.3 (a set value is clamped into the slider range).
 */
import { describe, expect, it } from 'vitest';
import { bad, expectUnchanged, expectWellFormedError, figure, idOf, must, ok, recordEvents, snap } from './helpers';

const BASE = [
  'A = (0, 0)',
  'B = (4, 0)',
  'M = Midpoint(A, B)',
  'a = 3 in 0..10 step 0.5',
  'h = a * 2',
  'flag = true',
  's = "text"',
  'seg = Segment(A, B)',
  'u = 0.5 in 0..1 step 0.01',
  'T = PointOn(seg, u)',
  'v = Vector(1, 0)',
  'Tr = Translate(A, v)',
  'D = (a, 1)', // dependent Point by a plain formula (no invertible rule)
];

describe('setFree: writing the value of a free object', () => {
  it('writes a Point, a Number, a Bool and a Text, and the next flush recomputes the readers', () => {
    const f = figure(BASE);
    expect(f.setFree('A', { x: 2, y: 2 }, 'api')).toEqual({ ok: true, changed: true });
    expect(f.setFree('a', 5, 'slider')).toEqual({ ok: true, changed: true });
    expect(f.setFree('flag', false, 'api')).toEqual({ ok: true, changed: true });
    expect(f.setFree('s', 'other', 'api')).toEqual({ ok: true, changed: true });
    f.flush();
    expect(f.value('M')).toEqual({ x: 3, y: 1 });
    expect(f.value('h')).toBe(10);
    expect(f.value('flag')).toBe(false);
    expect(f.value('s')).toBe('other');
  });

  it('reports changed: false when the value is the same', () => {
    const f = figure(BASE);
    expect(f.setFree('a', 3, 'api')).toEqual({ ok: true, changed: false });
    expect(f.setFree('A', { x: 0, y: 0 }, 'api')).toEqual({ ok: true, changed: false });
  });

  it('the object is a source: the value is visible at once, dependents after flush', () => {
    const f = figure(BASE);
    f.setFree('a', 6, 'api');
    expect(f.value('a')).toBe(6);
    f.flush();
    expect(f.value('h')).toBe(12);
  });

  it('a dependent object is not_free, with the free parents in suggest (kernel errors.md)', () => {
    const f = figure(BASE);
    const before = snap(f);
    const r = f.setFree('M', { x: 1, y: 1 }, 'api');
    const e = bad(r as never, 'not_free');
    expectWellFormedError(e);
    expect(e.code).toBe('K013');
    expect(e.recovery).toBe('choose');
    expect(e.message).toContain('M');
    expect(e.message).toContain('A');
    expect(e.message).toContain('B');
    expect(e.related).toEqual(expect.arrayContaining(['A', 'B']));
    expect(e.suggest.length).toBeGreaterThan(0);
    expect(e.suggest.length).toBeLessThanOrEqual(3);
    expectUnchanged(f, before);
  });

  it('every dependent kind is not_free: Number, Point, Line, Segment', () => {
    const f = figure([...BASE, 'l = Line(A, B)']);
    for (const [name, value] of [['h', 5], ['M', { x: 1, y: 1 }], ['seg', {}], ['l', {}], ['D', { x: 0, y: 0 }]] as const) {
      bad(f.setFree(name, value as never, 'api') as never, 'not_free');
    }
  });

  it('an unknown object is unknown_name', () => {
    const f = figure(BASE);
    bad(f.setFree('Zed', 1, 'api') as never, 'unknown_name');
  });

  it('a value of the wrong type is an error and changes nothing', () => {
    // Docs are silent on the kind. The figure must stay as it was and nothing may throw.
    const f = figure(BASE);
    const before = snap(f);
    for (const [name, value] of [['A', 5], ['a', { x: 1, y: 1 }], ['flag', 'yes'], ['s', 3]] as const) {
      const r = f.setFree(name, value as never, 'api');
      expect(r.ok, `${name} <- ${JSON.stringify(value)}`).toBe(false);
    }
    expectUnchanged(f, before);
  });

  it('a slider value is clamped into its range (numbers-sliders 3.3)', () => {
    const f = figure(BASE);
    f.setFree('a', 12, 'slider');
    expect(f.value('a')).toBe(10);
    f.setFree('a', -4, 'slider');
    expect(f.value('a')).toBe(0);
  });

  it('a fixed object cannot be written by a drag, a slider or show_me, unless forced', () => {
    const f = figure(BASE);
    ok(f.apply('A with fixed = true'));
    ok(f.apply('a with fixed = true'));
    const before = snap(f);
    for (const why of ['drag', 'slider', 'show_me', 'api'] as const) {
      const e = bad(f.setFree('A', { x: 9, y: 9 }, why) as never, 'locked');
      expect(e.code).toBe('K014');
      bad(f.setFree('a', 7, why) as never, 'locked');
    }
    expectUnchanged(f, before);
    expect(f.setFree('A', { x: 9, y: 9 }, 'show_me', { force: true })).toEqual({ ok: true, changed: true });
    expect(f.value('A')).toEqual({ x: 9, y: 9 });
  });

  it('writes through to the next flush only once: many writes, one event batch', () => {
    const f = figure(BASE);
    const rec = recordEvents(f);
    for (let i = 0; i < 100; i++) f.setFree('A', { x: i, y: 0 }, 'drag');
    f.flush();
    const vals = rec.events.filter((e) => e.ev === 'value');
    expect(vals.length).toBe(1);
  });
});

describe('dragPlan (ruling K8: { writes, reason?, kind? })', () => {
  it('a free Point writes itself, kind free', () => {
    const f = figure(BASE);
    const p = f.dragPlan('A', { x: 5, y: 5 });
    expect(p.kind).toBe('free');
    expect(p.reason).toBeUndefined();
    expect(p.writes).toEqual([{ id: idOf(f, 'A'), name: 'A', value: { x: 5, y: 5 } }]);
  });

  it('a slider writes itself', () => {
    const f = figure(BASE);
    expect(f.dragPlan('a', 7).writes).toEqual([{ id: idOf(f, 'a'), name: 'a', value: 7 }]);
  });

  // kernel design 7: "Draggable if they are Points, sliders (Numbers with a range), Booleans (checkbox)".
  it('a Bool checkbox writes itself', () => {
    const f = figure(BASE);
    const p = f.dragPlan('flag', false);
    expect(p.reason).toBeUndefined();
    expect(p.writes).toEqual([{ id: idOf(f, 'flag'), name: 'flag', value: false }]);
  });

  it('a dependent point whose rule can be inverted writes its free parent (Midpoint, Translate)', () => {
    const f = figure(BASE);
    const pm = f.dragPlan('M', { x: 5, y: 5 });
    expect(pm.kind).toBe('inverted');
    expect(pm.writes.map((w) => w.name)).toEqual(['A']);
    expect(pm.writes[0]?.value).toEqual({ x: 6, y: 10 }); // A so that Midpoint(A, B=(4,0)) = (5,5)
    const pt = f.dragPlan('Tr', { x: 3, y: 4 });
    expect(pt.writes.map((w) => w.name)).toEqual(['A']);
    expect(pt.writes[0]?.value).toEqual({ x: 2, y: 4 });
  });

  it('a point on a path writes the projected parameter', () => {
    const f = figure(BASE);
    const p = f.dragPlan('T', { x: 1, y: 7 });
    expect(p.writes.length).toBe(1);
    expect(p.writes[0]?.name).toBe('u');
    expect(p.writes[0]?.value).toBe(0.25); // the projection of (1, 7) on A->B = (0,0)->(4,0)
  });

  it('a dependent object with no invertible rule cannot be dragged: not_draggable', () => {
    const f = figure(BASE);
    for (const name of ['h', 'D', 'seg']) {
      const p = f.dragPlan(name, { x: 1, y: 1 });
      expect(p.writes, name).toEqual([]);
      expect(p.reason, name).toBe('not_draggable');
    }
  });

  it('a Text is not draggable in v1', () => {
    const f = figure(BASE);
    const p = f.dragPlan('s', 'x');
    expect(p.writes).toEqual([]);
    expect(p.reason).toBeDefined();
  });

  it('a fixed object: no writes, reason locked', () => {
    const f = figure(BASE);
    ok(f.apply('A with fixed = true'));
    const p = f.dragPlan('A', { x: 5, y: 5 });
    expect(p.writes).toEqual([]);
    expect(p.reason).toBe('locked');
    // a dependent point whose parent is fixed cannot move it either
    const pm = f.dragPlan('M', { x: 5, y: 5 });
    expect(pm.writes).toEqual([]);
  });

  it('an unknown object: reason unknown_object', () => {
    const f = figure(BASE);
    expect(f.dragPlan('Zed', { x: 1, y: 1 })).toEqual({ writes: [], reason: 'unknown_object' });
  });

  it('a state is owned by the solver', () => {
    const f = figure([...BASE, 'th = state(0.6)', "th' = 1"]);
    const p = f.dragPlan('th', 1);
    expect(p.writes).toEqual([]);
    expect(p.reason).toBe('owned_by_solver');
  });

  it('a target of the wrong type is bad_target', () => {
    const f = figure(BASE);
    const p = f.dragPlan('A', 'not a point');
    expect(p.writes).toEqual([]);
    expect(p.reason).toBe('bad_target');
  });

  it('planning changes nothing', () => {
    const f = figure(BASE);
    const before = snap(f);
    f.dragPlan('M', { x: 5, y: 5 });
    f.dragPlan('A', { x: 5, y: 5 });
    expectUnchanged(f, before);
  });
});

describe('drag(plan) and commitDrag', () => {
  it('applies the writes, runs one pass and the figure follows the pointer', () => {
    const f = figure(BASE);
    const plan = f.dragPlan('M', { x: 5, y: 5 });
    const r = f.drag(plan);
    expect(r.ok).toBe(true);
    expect(r.delta?.ran).toBeGreaterThan(0);
    const m = f.value('M') as { x: number; y: number };
    expect(m.x).toBeCloseTo(5, 12);
    expect(m.y).toBeCloseTo(5, 12);
  });

  it('a refused plan gives ok false and the reason, and does nothing', () => {
    const f = figure(BASE);
    ok(f.apply('A with fixed = true'));
    const before = snap(f);
    const r = f.drag(f.dragPlan('A', { x: 5, y: 5 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('locked');
    expectUnchanged(f, before);
  });

  it('a whole drag is one undo step, committed on release with the first and last value', () => {
    const f = figure(BASE);
    const depth = f.undoInfo().depth;
    for (let i = 1; i <= 20; i++) f.drag(f.dragPlan('M', { x: i, y: i }));
    expect(f.undoInfo().depth).toBe(depth);
    expect(f.commitDrag().committed).toBeGreaterThan(0);
    expect(f.undoInfo().depth).toBe(depth + 1);
    ok(f.undo());
    expect(f.value('A')).toEqual({ x: 0, y: 0 });
    expect(f.value('M')).toEqual({ x: 2, y: 0 });
  });

  it('dragging a dependent point through two writes (free parent chain) still commits as one entry', () => {
    const f = figure(['A = (0, 0)', 'B = (4, 0)', 'M = Midpoint(A, B)', 'N = Midpoint(M, B)']);
    const depth = f.undoInfo().depth;
    f.drag(f.dragPlan('N', { x: 3, y: 3 }));
    f.commitDrag();
    expect(f.undoInfo().depth).toBe(depth + 1);
  });

  it('a drag of a Point does not rebuild structure: ids and order stay', () => {
    const f = figure(BASE);
    const ids = f.objects().map((o) => `${o.id}:${o.order}`);
    for (let i = 0; i < 10; i++) f.drag(f.dragPlan('A', { x: i, y: i }));
    f.commitDrag();
    expect(f.objects().map((o) => `${o.id}:${o.order}`)).toEqual(ids);
  });

  it('commitDrag with nothing to commit commits 0', () => {
    const f = figure(BASE);
    expect(f.commitDrag().committed).toBe(0);
  });

  it('a redo stack survives a drag that is not committed, and is cleared by a committed one', () => {
    const f = figure(BASE);
    ok(f.apply('Z = (1, 1)'));
    ok(f.undo());
    f.setFree('A', { x: 1, y: 1 }, 'drag');
    f.setFree('A', { x: 0, y: 0 }, 'drag');
    f.commitDrag();
    expect(f.undoInfo().redoDepth).toBe(1);
    f.setFree('A', { x: 3, y: 3 }, 'drag');
    f.commitDrag();
    expect(f.undoInfo().redoDepth).toBe(0);
  });
});

describe('fixed and selection properties for dragging (design 9.7)', () => {
  it('selectable = false does not stop the kernel from planning a drag (that is the view\'s rule)', () => {
    const f = figure(BASE);
    ok(f.apply('A with selectable = false'));
    expect(f.dragPlan('A', { x: 1, y: 1 }).writes.length).toBe(1);
  });

  it('the view reads fixed and selectable from the effective style', () => {
    const f = figure(BASE);
    ok(f.apply('A with fixed = true, selectable = false'));
    const s = must(f.styleOf(idOf(f, 'A') as never));
    expect(s.fixed).toBe(true);
    expect(s.selectable).toBe(false);
  });
});
