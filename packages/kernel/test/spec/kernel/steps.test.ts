/**
 * The step list (our construction protocol) and the reveal cursor: steps(), stepTo(), @step.
 * Docs: kernel/design.md 12; errors/errors.md 4 (step_hidden); kernel/ui.md (cursor behaviour is the view's job).
 */
import { describe, expect, it } from 'vitest';
import { figure, idOf, must, newFigure, ok, recordEvents, snap } from './helpers';

const BASE = ['A = (0, 0)', 'B = (4, 0)', 'M = Midpoint(A, B)', 'N = Midpoint(A, M)', 'd = Distance(M, N)'];

describe('steps()', () => {
  it('has one row per object, in order, with index equal to the order of the object', () => {
    const f = figure(BASE);
    const steps = f.steps();
    expect(steps.map((s) => s.name)).toEqual(['A', 'B', 'M', 'N', 'd']);
    steps.forEach((s, i) => {
      expect(s.index).toBe(i);
      expect(s.id).toBe(idOf(f, s.name));
      expect(s.type).toBe(must(f.get(s.name)).type);
      expect(s.visible).toBe(true);
    });
  });

  it('is a view over the figure: it follows changes with no separate state', () => {
    const f = figure(BASE);
    ok(f.apply('P = Midpoint(A, B)'));
    expect(f.steps().length).toBe(6);
    ok(f.apply('Delete(N)'));
    expect(f.steps().map((s) => s.name)).toEqual(['A', 'B', 'M', 'P']);
    f.steps().forEach((s, i) => expect(s.index).toBe(i));
    ok(f.undo());
    expect(f.steps().map((s) => s.name)).toEqual(['A', 'B', 'M', 'N', 'd', 'P']);
  });

  it('gives the definition as written, and a short value text', () => {
    const f = figure(BASE);
    const m = must(f.steps().find((s) => s.name === 'M'));
    expect(m.definition).toBe('M = Midpoint(A, B)');
    expect(m.valueText).toBe('(2, 0)');
    const a = must(f.steps().find((s) => s.name === 'A'));
    expect(a.definition).toBe('A = (0, 0)');
  });

  it('value text of an undefined object is "undefined (reason)"', () => {
    const f = figure(['O = (0, 0)', 'l = Line(O, O)']);
    expect(must(f.steps().find((s) => s.name === 'l')).valueText).toBe('undefined (degenerate)');
  });

  it('the sentence comes from the explain template of the command form (12.3)', () => {
    const f = figure(BASE);
    expect(must(f.steps().find((s) => s.name === 'M')).sentence).toBe('M is the midpoint of A and B');
  });

  it('without an explain template the sentence falls back to "{name} = {definition}" form', () => {
    const f = figure(['A = (0, 0)', 'B = (4, 0)', 'l = Line(A, B)']);
    const s = must(f.steps().find((s2) => s2.name === 'l'));
    expect(s.sentence).toContain('Line(A, B)');
    expect(s.sentence.length).toBeGreaterThan(0);
  });

  it('every step has a non-empty sentence, for every value kind', () => {
    const f = figure([...BASE, 'a = 3 in 0..5', 'flag = true', 's = "x"', 'L = [1, 2]', 'g(x) = x^2', 'l = Line(A, B)', 'c = Circle(A, 2)']);
    for (const s of f.steps()) expect(s.sentence.length, s.name).toBeGreaterThan(0);
  });

  it('@step "title" marks the next object as a breakpoint with that title; it creates no object', () => {
    const f = figure(['A = (0, 0)', 'B = (4, 0)', '@step "Bisect AB"', 'M = Midpoint(A, B)', 'N = Midpoint(A, M)']);
    expect(f.count).toBe(4);
    const steps = f.steps();
    expect(must(steps.find((s) => s.name === 'M')).group).toEqual({ title: 'Bisect AB', breakpoint: true });
    expect(steps.find((s) => s.name === 'A')?.group).toBeUndefined();
    expect(steps.find((s) => s.name === 'N')?.group).toBeUndefined();
  });

  it('several @step lines make several groups', () => {
    const f = figure(['@step "one"', 'A = (0, 0)', '@step "two"', 'B = (4, 0)', 'C = (1, 1)']);
    const g = f.steps().map((s) => s.group?.title);
    expect(g).toEqual(['one', 'two', undefined]);
  });

  it('@step stays in place in the script', () => {
    const f = figure(['A = (0, 0)', '@step "two"', 'B = (4, 0)']);
    const s = f.toScript();
    expect(s.indexOf('A = ')).toBeLessThan(s.indexOf('@step "two"'));
    expect(s.indexOf('@step "two"')).toBeLessThan(s.indexOf('B = '));
  });

  it('aux objects are hidden from the list unless helpers are asked for', () => {
    const f = figure(BASE);
    ok(f.apply('M with aux = true'));
    expect(f.steps().map((s) => s.name)).toEqual(['A', 'B', 'N', 'd']);
    expect(f.steps({ helpers: true }).map((s) => s.name)).toEqual(['A', 'B', 'M', 'N', 'd']);
  });

  it('hiding an object does not remove its step; the step says visible: false', () => {
    const f = figure(BASE);
    ok(f.apply('Hide(M)'));
    const m = must(f.steps().find((s) => s.name === 'M'));
    expect(m.visible).toBe(false);
  });
});

describe('stepTo() and the reveal cursor', () => {
  it('the default is every step shown', () => {
    const f = figure(BASE);
    expect(f.cursor).toBe(5);
  });

  it('stepTo(n) shows the first n steps; objects after it still exist, hold values and update', () => {
    const f = figure(BASE);
    f.stepTo(2);
    expect(f.cursor).toBe(2);
    expect(f.count).toBe(5);
    expect(f.value('M')).toEqual({ x: 2, y: 0 });
    f.setFree('A', { x: 2, y: 2 }, 'api');
    f.flush();
    expect(f.value('M')).toEqual({ x: 3, y: 1 });
    expect(f.value('d')).toBeCloseTo(Math.hypot(3 - 2.5, 1 - 0.5), 12);
  });

  it('is O(1) in the kernel: it changes no objects, no ids and no values', () => {
    const f = figure(BASE);
    const before = snap(f);
    f.stepTo(0);
    f.stepTo(3);
    f.stepTo(5);
    expect(snap(f)).toEqual(before);
  });

  it('sends exactly one step event with n', () => {
    const f = figure(BASE);
    const rec = recordEvents(f);
    f.stepTo(3);
    expect(rec.events).toEqual([{ ev: 'step', n: 3 }]);
  });

  it('stepTo(list length) is the default state', () => {
    const f = figure(BASE);
    f.stepTo(1);
    f.stepTo(f.count);
    expect(f.cursor).toBe(f.count);
  });

  it('stepTo(0) shows nothing; out of range values are clamped to 0..count', () => {
    const f = figure(BASE);
    f.stepTo(0);
    expect(f.cursor).toBe(0);
    f.stepTo(99);
    expect(f.cursor).toBe(5);
    f.stepTo(-3);
    expect(f.cursor).toBe(0);
  });

  it('Hide and Show are independent of the cursor', () => {
    const f = figure(BASE);
    f.stepTo(2);
    ok(f.apply('Hide(A)'));
    ok(f.apply('Show(A)'));
    expect(f.cursor).toBe(2);
    expect(must(f.styleOf(idOf(f, 'A') as never)).visible).toBe(true);
  });

  it('is not part of undo history', () => {
    const f = figure(BASE);
    const depth = f.undoInfo().depth;
    f.stepTo(1);
    expect(f.undoInfo().depth).toBe(depth);
  });

  it('a new object added while the cursor is before the end gets a step_hidden notice', () => {
    const f = figure(BASE);
    f.stepTo(2);
    const r = ok(f.apply('P = (9, 9)'));
    const n = r.notices.find((x) => x.kind === 'step_hidden');
    expect(n).toBeDefined();
    expect(n?.message).toContain('P');
  });

  it('no step_hidden notice when the cursor is at the end', () => {
    const f = figure(BASE);
    const r = ok(f.apply('P = (9, 9)'));
    expect(r.notices.map((n) => n.kind)).not.toContain('step_hidden');
  });
});

describe('editing from the list (design 12.4)', () => {
  it('insertAt puts the new object at that order index and shifts the rest', () => {
    const f = figure(BASE);
    const r = ok(f.insertAt(2, 'P = Midpoint(A, B)'));
    expect(r.op).toBe('add');
    expect(f.names()).toEqual(['A', 'B', 'P', 'M', 'N', 'd']);
    expect(must(f.get('P')).order).toBe(2);
    f.objects().forEach((o, i) => expect(o.order).toBe(i));
  });

  it('insertAt before an input is forward_reference, naming the input that must move first', () => {
    const f = figure(BASE);
    const before = snap(f);
    const r = f.insertAt(1, 'P = Midpoint(A, M)');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('forward_reference');
      expect(r.code).toBe('K012');
      expect(r.recovery).toBe('choose');
      expect(r.related).toContain('M');
      expect(r.message).toContain('M');
      // kernel errors.md 1: "suggest has the move"
      expect(r.suggest.length).toBeGreaterThan(0);
    }
    expect(snap(f)).toEqual(before);
  });

  it('movePlan lists which objects must also move; move() without them is forward_reference', () => {
    const f = figure(BASE);
    const plan = f.movePlan('N', 1);
    // N reads M, so M has to come along (the docs do not say what `ok` means when others must move)
    expect(plan.alsoMove).toContain('M');
    const r = f.move('N', 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('forward_reference');
  });

  it('move(..., { withDependencies: true }) moves the inputs along and keeps a valid order', () => {
    const f = figure(['A = (0, 0)', 'B = (4, 0)', 'C = (9, 9)', 'M = Midpoint(A, B)', 'N = Midpoint(M, C)']);
    ok(f.move('N', 2, { withDependencies: true }));
    for (const o of f.objects()) for (const i of o.inputs) expect(must(f.get(i as never)).order).toBeLessThan(o.order);
    expect(f.value('N')).toEqual({ x: 5.5, y: 4.5 });
  });

  it('a legal move needs no extra objects', () => {
    const f = figure(['A = (0, 0)', 'B = (4, 0)', 'C = (9, 9)', 'M = Midpoint(A, B)']);
    expect(f.movePlan('C', 0).alsoMove).toEqual([]);
    ok(f.move('C', 0));
    expect(f.names()).toEqual(['C', 'A', 'B', 'M']);
  });

  it('a move is undoable', () => {
    const f = figure(['A = (0, 0)', 'B = (4, 0)', 'C = (9, 9)']);
    ok(f.move('C', 0));
    ok(f.undo());
    expect(f.names()).toEqual(['A', 'B', 'C']);
  });
});

describe('an empty figure', () => {
  it('has no steps and a cursor of 0', () => {
    const f = newFigure();
    expect(f.steps()).toEqual([]);
    expect(f.cursor).toBe(0);
    f.stepTo(5);
    expect(f.cursor).toBe(0);
  });
});
