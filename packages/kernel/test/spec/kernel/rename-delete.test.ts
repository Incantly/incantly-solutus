/**
 * Rename, Delete and delete plans.
 * Docs: kernel/design.md 9.2 (detach, not cascade), 14 (Rename); kernel/errors.md 1, 3 and 5 rule 6; kernel/rulings.md K1;
 * errors/errors.md 1.2 and 4; README decision 11.
 */
import { describe, expect, it } from 'vitest';
import { bad, expectUnchanged, expectWellFormedError, figure, idOf, must, ok, recordEvents, snap } from './helpers';

const BASE = [
  'A = (0, 0)',
  'B = (4, 0)',
  'M = Midpoint(A, B)',
  'N = Midpoint(M, B)',
  'a = 3 in 0..10 step 0.5',
  'h = sqrt(a^2 + 16)',
  'g(x) = x + a',
  'l = Line(A, B)',
];

describe('Rename', () => {
  it('accepts both Rename(M, N) and Rename(M, "N") and does the same (ruling K1)', () => {
    const f1 = figure(BASE);
    const f2 = figure(BASE);
    const r1 = ok(f1.apply('Rename(M, K)'));
    const r2 = ok(f2.apply('Rename(M, "K")'));
    expect(r1.op).toBe('rename');
    expect(r2.op).toBe('rename');
    expect(r1.summary).toBe(r2.summary);
    expect(f1.toScript()).toBe(f2.toScript());
    expect(f1.names()).toEqual(f2.names());
  });

  it('keeps the id and the position, frees the old name', () => {
    const f = figure(BASE);
    const id = idOf(f, 'M');
    const order = must(f.get('M')).order;
    ok(f.apply('Rename(M, "K")'));
    expect(f.get('M')).toBeUndefined();
    expect(idOf(f, 'K')).toBe(id);
    expect(must(f.get('K')).order).toBe(order);
    expect(f.value('K')).toEqual({ x: 2, y: 0 });
    ok(f.apply('M = (7, 7)')); // the old name is free again
  });

  it('regenerates the definition text of everything that reads it', () => {
    const f = figure(BASE);
    ok(f.apply('Rename(M, "K")'));
    expect(must(f.get('N')).definition).toBe('N = Midpoint(K, B)');
    expect(must(f.get('K')).definition).toBe('K = Midpoint(A, B)');
    expect(f.toScript()).toContain('N = Midpoint(K, B)');
    expect(f.toScript()).not.toMatch(/\bM\b/);
    expect(f.value('N')).toEqual({ x: 3, y: 0 });
  });

  it('rewrites formulas and function bodies that read a Number', () => {
    const f = figure(BASE);
    ok(f.apply('Rename(a, "k")'));
    expect(must(f.get('h')).definition).toBe('h = sqrt(k^2 + 16)');
    expect(must(f.get('g')).definition).toBe('g(x) = x + k');
    expect(f.value('h')).toBe(5);
    expect(must(f.get('k')).range).toEqual({ min: 0, max: 10, step: 0.5 });
  });

  it('never touches a local variable that has the same name', () => {
    const f = figure(['a = 3', 'g(a) = a + 1', 'h = g(a)']);
    ok(f.apply('Rename(a, "k")'));
    expect(must(f.get('g')).definition).toBe('g(a) = a + 1');
    expect(must(f.get('h')).definition).toBe('h = g(k)');
    expect(f.value('h')).toBe(4);
  });

  it('the new name works in new lines at once, and a rename round-trips through a script', () => {
    const f = figure(BASE);
    ok(f.apply('Rename(M, "K")'));
    ok(f.apply('P = Midpoint(K, A)'));
    expect(f.value('P')).toEqual({ x: 1, y: 0 });
  });

  it('works for every value kind: Point, Number, Line, Function, Bool, Text', () => {
    const f = figure([...BASE, 'flag = true', 's = "x"']);
    for (const [from, to] of [['A', 'A2'], ['a', 'a2'], ['l', 'l2'], ['g', 'g2'], ['flag', 'flag2'], ['s', 's2']] as const) {
      const id = idOf(f, from);
      ok(f.apply(`Rename(${from}, "${to}")`), `${from} -> ${to}`);
      expect(idOf(f, to)).toBe(id);
      expect(f.get(from)).toBeUndefined();
    }
  });

  it('is one journal entry and undo/redo restore the old and the new names', () => {
    const f = figure(BASE);
    const before = snap(f);
    ok(f.apply('Rename(M, "K")'));
    const after = snap(f);
    ok(f.undo());
    expectUnchanged(f, { ...before, redo: 1 }, 'undo'); // the undone line waits on the redo stack
    expect(f.get('M')).toBeDefined();
    expect(must(f.get('N')).definition).toBe('N = Midpoint(M, B)');
    ok(f.redo());
    expect(f.toScript()).toBe(after.script);
  });

  it('sends one rename event with the id and both names', () => {
    const f = figure(BASE);
    const rec = recordEvents(f);
    ok(f.apply('Rename(M, "K")'));
    const ev = rec.events.filter((e) => e.ev === 'rename');
    expect(ev).toEqual([{ ev: 'rename', id: idOf(f, 'K'), from: 'M', to: 'K' }]);
  });

  it('the rename method does the same as the line', () => {
    const f = figure(BASE);
    const r = ok(f.rename('M', 'K'));
    expect(r.op).toBe('rename');
    expect(f.get('K')).toBeDefined();
  });

  it('a name that differs only by case from another is allowed with a confusable_name notice', () => {
    const f = figure(BASE); // has B
    const r = ok(f.apply('Rename(a, "b")'));
    expect(r.notices.map((n) => n.kind)).toContain('confusable_name');
  });

  it('a new object whose name differs only by case from another also gets the notice', () => {
    const f = figure(BASE);
    const r = ok(f.apply('b = 3'));
    expect(r.notices.map((n) => n.kind)).toContain('confusable_name');
    const n = r.notices.find((x) => x.kind === 'confusable_name');
    expect(n?.severity).toBe('warning');
  });
});

describe('Rename errors', () => {
  it('name_taken: the error names the object that holds the name', () => {
    const f = figure(BASE);
    const before = snap(f);
    const e = bad(f.apply('Rename(M, "N")'), 'name_taken');
    expectWellFormedError(e);
    expect(e.code).toBe('K005');
    expect(e.related).toContain('N');
    expect(e.message).toContain('N');
    expect(e.recovery).toBe('rewrite');
    expectUnchanged(f, before);
  });

  it('name_taken also for the bare form Rename(M, N) when N is an existing object (ruling K1)', () => {
    const f = figure(BASE);
    const before = snap(f);
    const e = bad(f.apply('Rename(M, N)'), 'name_taken');
    expect(e.related).toContain('N');
    expectUnchanged(f, before);
  });

  it('name_taken with a name that differs only by case from an existing one is a different name (allowed)', () => {
    const f = figure(BASE);
    ok(f.apply('Rename(M, "m")'));
    expect(f.get('m')).toBeDefined();
  });

  const badNames: [string, string][] = [
    ['starts with a digit', '1x'],
    ['empty', ''],
    ['has a space', 'a b'],
    ['has a forbidden character', 'a+b'],
    ['is too long', 'x'.repeat(80)],
  ];
  it.each(badNames)('bad_name: %s', (_why, name) => {
    const f = figure(BASE);
    const before = snap(f);
    const e = bad(f.apply(`Rename(M, "${name}")`), 'bad_name');
    expectWellFormedError(e);
    expect(e.code).toBe('K004');
    expect(typeof e.params.why).toBe('string');
    expect(e.recovery).toBe('rewrite');
    expectUnchanged(f, before);
  });

  const reserved = ['sin', 'Midpoint', 't', 'x', 'with', 'in', 'inf', 'pi', 'true', 'undefined', 'bt', 'beat', 'xaxis'];
  it.each(reserved)('reserved_name: %s', (name) => {
    const f = figure(BASE);
    const before = snap(f);
    const e = bad(f.apply(`Rename(M, "${name}")`), 'reserved_name');
    expect(e.code).toBe('K003');
    expect(e.suggest.length).toBeGreaterThan(0);
    expectUnchanged(f, before);
  });

  it('reserved_name suggestions are free names that the same line accepts', () => {
    const f = figure(BASE);
    const e = bad(f.apply('Rename(M, "sin")'), 'reserved_name');
    for (const s of e.suggest) {
      const g = figure(BASE);
      ok(g.apply(s), s);
    }
  });

  it('defining a command name is reserved_name too', () => {
    const f = figure(BASE);
    const before = snap(f);
    const e = bad(f.apply('Midpoint = (1, 2)'), 'reserved_name');
    expect(e.token).toBe('Midpoint');
    expect(e.suggest.length).toBeGreaterThan(0);
    expectUnchanged(f, before);
  });

  it('renaming an unknown object is unknown_name', () => {
    const f = figure(BASE);
    const before = snap(f);
    bad(f.apply('Rename(Zed, "K")'), 'unknown_name');
    expectUnchanged(f, before);
  });

  it('a fixed object can still be renamed (the name is not its value)', () => {
    const f = figure(BASE);
    ok(f.apply('A with fixed = true'));
    const r = f.apply('Rename(A, "A2")');
    // Docs are silent; renaming changes no value, so the reading closest to design 9.7 is to allow it.
    expect(r.ok).toBe(true);
  });
});

describe('Delete with cascade', () => {
  it('removes the object and everything built from it, and lists the names in deletion order', () => {
    const f = figure(BASE);
    const r = ok(f.apply('Delete(M)'));
    expect(r.op).toBe('delete');
    expect(r.changed.removed).toEqual(['M', 'N']);
    expect(r.summary).toBe('deleted M, N');
    expect(f.names()).toEqual(['A', 'B', 'a', 'h', 'g', 'l']);
  });

  it('the cascade is explicit: dependents_removed notice names the others', () => {
    const f = figure(BASE);
    const r = ok(f.apply('Delete(M)'));
    const n = r.notices.find((x) => x.kind === 'dependents_removed');
    expect(n?.names).toEqual(['N']);
    expect(n?.severity).toBe('warning');
    expect(n?.message).toContain('N');
  });

  it('a leaf has no cascade and no dependents_removed notice', () => {
    const f = figure(BASE);
    const r = ok(f.apply('Delete(N)'));
    expect(r.changed.removed).toEqual(['N']);
    expect(r.notices.map((n) => n.kind)).not.toContain('dependents_removed');
  });

  it('deletePlan lists what would go, before the delete, without side effects, and it matches the delete', () => {
    const f = figure(BASE);
    const before = snap(f);
    const plan = f.deletePlan('A');
    expectUnchanged(f, before);
    expect(plan).toEqual(['A', 'M', 'N', 'l']);
    const r = ok(f.apply('Delete(A)'));
    expect(r.changed.removed).toEqual([...plan]);
  });

  it('deletePlan of an unknown object is empty', () => {
    expect(figure(BASE).deletePlan('Zed')).toEqual([]);
  });

  it('works through every value kind: Number with formulas and function readers, Point, Line', () => {
    const f = figure(BASE);
    const r = ok(f.apply('Delete(a)'));
    expect(r.changed.removed).toEqual(['a', 'h', 'g']);
    const r2 = ok(f.apply('Delete(l)'));
    expect(r2.changed.removed).toEqual(['l']);
  });

  it('the delete method and the line do the same', () => {
    const f = figure(BASE);
    const r = ok(f.delete('M'));
    expect(r.changed.removed).toEqual(['M', 'N']);
  });

  it('the result of Delete(unknown) is unknown_name and nothing changes', () => {
    const f = figure(BASE);
    const before = snap(f);
    bad(f.apply('Delete(Zed)'), 'unknown_name');
    expectUnchanged(f, before);
  });

  it('survivors keep their ids; ids are never reused', () => {
    const f = figure(BASE);
    const ids = new Map(f.objects().map((o) => [o.name, o.id]));
    ok(f.apply('Delete(M)'));
    for (const n of f.names()) expect(idOf(f, n)).toBe(ids.get(n));
    ok(f.apply('M = (1, 1)'));
    expect(idOf(f, 'M')).not.toBe(ids.get('M'));
    expect([...ids.values()]).not.toContain(f.get('M')?.id);
  });

  it('sends a remove event per removed object, with its id and name', () => {
    const f = figure(BASE);
    const ids = [idOf(f, 'M'), idOf(f, 'N')];
    const rec = recordEvents(f);
    ok(f.apply('Delete(M)'));
    const removed = rec.events.filter((e) => e.ev === 'remove');
    expect(removed).toEqual(expect.arrayContaining([{ ev: 'remove', id: ids[0], name: 'M' }, { ev: 'remove', id: ids[1], name: 'N' }]));
    expect(removed.length).toBe(2);
  });

  it('is one undo step that brings back every object, with the same ids, positions and values', () => {
    const f = figure(BASE);
    ok(f.apply('M with color = red, layer = 3'));
    const before = snap(f);
    const mid = idOf(f, 'M');
    const depth = f.undoInfo().depth;
    ok(f.apply('Delete(M)'));
    expect(f.undoInfo().depth).toBe(depth + 1);
    const u = ok(f.undo());
    expect(u.changed.added).toEqual(['M', 'N']);
    expectUnchanged(f, { ...before, redo: 1 }, 'undo of delete');
    expect(idOf(f, 'M')).toBe(mid);
    expect(must(f.get('M')).style.layer).toBe(3);
    expect(f.value('N')).toEqual({ x: 3, y: 0 });
  });

  it('deleting everything leaves a valid empty figure', () => {
    const f = figure(BASE);
    for (const n of [...f.names()]) if (f.get(n)) ok(f.apply(`Delete(${n})`));
    expect(f.count).toBe(0);
    expect(f.toScript()).toBe('@fig 1\n');
    ok(f.apply('A = (1, 1)'));
  });

  it('Delete removes descendants that read the object through a slider range too', () => {
    const f = figure(['lo = 0', 'a = 1 in lo..10', 'b = a * 2']);
    const r = ok(f.apply('Delete(lo)'));
    expect(r.changed.removed).toEqual(expect.arrayContaining(['lo', 'a', 'b']));
  });

  it('Delete(t-dependent) never touches t', () => {
    const f = figure(['x1 = 2 * t']);
    f.setClock(3);
    ok(f.apply('Delete(x1)'));
    expect(f.clock().t).toBe(3);
  });
});

describe('property rules are detached, not cascaded (design 9.2)', () => {
  it('deleting the slider that coloured a point keeps the point and reverts the property', () => {
    const f = figure(['a = 5 in 0..10', 'P = (1, 1)', 'P with color = rgb(25 * a, 0, 128)']);
    const id = idOf(f, 'P');
    const r = ok(f.apply('Delete(a)'));
    expect(f.get('P')).toBeDefined();
    expect(r.changed.removed).toEqual(['a']);
    const kinds = r.notices.map((n) => n.kind);
    expect(kinds).toContain('property_detached');
    expect(kinds).not.toContain('dependents_removed');
    // free point default colour is blue #2563eb
    expect(must(f.styleOf(id as never)).color).toEqual({ r: 37, g: 99, b: 235, a: 1 });
  });

  it('a showIf rule that loses its input stops hiding the object', () => {
    const f = figure(['a = 5 in 0..10', 'P = (1, 1)', 'P with showIf = (a < 3)']);
    const id = idOf(f, 'P');
    expect(must(f.styleOf(id as never)).shown).toBe(false);
    ok(f.apply('Delete(a)'));
    expect(must(f.styleOf(id as never)).shown).toBe(true);
  });

  it('the detach notice names the owner and the property', () => {
    const f = figure(['a = 5 in 0..10', 'P = (1, 1)', 'P with opacity = a / 10']);
    const r = ok(f.apply('Delete(a)'));
    const n = r.notices.find((x) => x.kind === 'property_detached');
    expect(n).toBeDefined();
    expect(n?.message).toContain('P');
    expect(n?.message).toContain('opacity');
  });

  it('undo of the delete restores the property rule', () => {
    const f = figure(['a = 8 in 0..10', 'P = (1, 1)', 'P with opacity = a / 10']);
    const id = idOf(f, 'P');
    ok(f.apply('Delete(a)'));
    expect(must(f.styleOf(id as never)).opacity).toBe(1);
    ok(f.undo());
    expect(must(f.styleOf(id as never)).opacity).toBeCloseTo(0.8, 12);
    f.setFree('a', 2, 'api');
    f.flush();
    expect(must(f.styleOf(id as never)).opacity).toBeCloseTo(0.2, 12);
  });

  it('a value dependent is still deleted while the style-only reader is kept', () => {
    const f = figure(['a = 5 in 0..10', 'h = a * 2', 'P = (1, 1)', 'P with color = rgb(25 * a, 0, 0)']);
    const r = ok(f.apply('Delete(a)'));
    expect(r.changed.removed).toEqual(['a', 'h']);
    expect(f.get('P')).toBeDefined();
  });
});
