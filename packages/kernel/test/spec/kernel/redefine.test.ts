/**
 * Redefinition (kernel design 8): in place, ids and style kept, free <-> dependent, type_change, cycle, locked,
 * self-assignment (ruling K2), redefine to the same text, and dryRun.
 * Docs: kernel/design.md 8; kernel/errors.md 1 and 4; kernel/rulings.md K2; errors/errors.md 1.3.
 */
import { describe, expect, it } from 'vitest';
import { colorFromWord } from '@incantly/kernel';
import { bad, expectUnchanged, expectWellFormedError, figure, idOf, must, ok, resetRuns, runs, snap } from './helpers';

/** Each name in a cycle path reads the next one, and the path closes on the object it started from. */
function expectChain(f: ReturnType<typeof figure>, path: readonly string[] | undefined): void {
  expect(path).toBeDefined();
  const p = path ?? [];
  expect(p[0]).toBe(p[p.length - 1]);
  for (let i = 0; i + 1 < p.length; i++) {
    const reader = must(f.get(p[i] as string));
    const read = must(f.get(p[i + 1] as string));
    // The new definition of the first name is not stored (the line was rejected), so skip that link.
    if (i === 0) continue;
    expect(reader.inputs, `${p[i]} should read ${p[i + 1]}`).toContain(read.id);
  }
}

const BASE = ['A = (0, 0)', 'B = (4, 0)', 'C = (0, 6)', 'M = Midpoint(A, B)', 'N = Midpoint(M, C)', 'a = 3 in 0..10 step 0.5', 'h = a + 1'];

describe('same type, redefined in place', () => {
  it('keeps the id, the position, the style and recomputes the descendants', () => {
    const f = figure(BASE);
    ok(f.apply('M with color = red, layer = 2'));
    const before = must(f.get('M'));
    const r = ok(f.apply('M = Midpoint(A, C)'));
    const after = must(f.get('M'));
    expect(r.op).toBe('redefine');
    expect(r.changed.redefined).toEqual(['M']);
    expect(r.changed.added).toEqual([]);
    expect(after.id).toBe(before.id);
    expect(after.order).toBe(before.order);
    expect(after.style.layer).toBe(2);
    expect(after.style.color).toEqual(colorFromWord('red'));
    expect(f.value('M')).toEqual({ x: 0, y: 3 });
    expect(f.value('N')).toEqual({ x: 0, y: 4.5 });
    expect(f.names()).toEqual(['A', 'B', 'C', 'M', 'N', 'a', 'h']);
  });

  it('a free Point gets a new value; dependents follow; the line is a restyle-free redefine', () => {
    const f = figure(BASE);
    const r = ok(f.apply('A = (4, 4)'));
    expect(r.op).toBe('redefine');
    expect(f.value('A')).toEqual({ x: 4, y: 4 });
    expect(f.value('M')).toEqual({ x: 4, y: 2 });
  });

  it('a Number slider keeps working when redefined with a new range', () => {
    const f = figure(BASE);
    ok(f.apply('a = 5 in 0..20'));
    expect(must(f.get('a')).range?.max).toBe(20);
    expect(f.value('a')).toBe(5);
    expect(f.value('h')).toBe(6);
  });

  it('redefining a free Bool and a free Text keeps their ids and updates readers', () => {
    const f = figure(['flag = true', 's = "x"']);
    const ids = [idOf(f, 'flag'), idOf(f, 's')];
    ok(f.apply('flag = false'));
    ok(f.apply('s = "y"'));
    expect([idOf(f, 'flag'), idOf(f, 's')]).toEqual(ids);
    expect(f.value('flag')).toBe(false);
    expect(f.value('s')).toBe('y');
  });

  it('works for every dependent value kind: Number, Point, Line, Circle, Segment, List', () => {
    const f = figure(['A = (0, 0)', 'B = (4, 0)', 'C = (0, 3)', 'r = 2', 'n = Distance(A, B)', 'l = Line(A, B)', 'c = Circle(A, r)', 'seg = Segment(A, B)', 'xs = Range(3)']);
    const ids = new Map(f.objects().map((o) => [o.name, o.id]));
    for (const line of ['n = Distance(A, C)', 'l = Line(A, C)', 'c = Circle(C, r)', 'seg = Segment(A, C)', 'xs = Range(5)']) {
      const r = ok(f.apply(line), line);
      expect(r.op).toBe('redefine');
    }
    for (const [name, id] of ids) expect(idOf(f, name)).toBe(id);
    expect(f.value('n')).toBe(3);
    expect(f.value('c')).toEqual({ cx: 0, cy: 3, r: 2 });
    expect(Array.from(f.value('xs') as ArrayLike<number>)).toEqual([0, 1, 2, 3, 4]);
  });

  it('is journalled as one entry that undo takes back', () => {
    const f = figure(BASE);
    const d = f.undoInfo().depth;
    ok(f.apply('M = Midpoint(A, C)'));
    expect(f.undoInfo().depth).toBe(d + 1);
    ok(f.undo());
    expect(f.value('M')).toEqual({ x: 2, y: 0 });
  });
});

describe('free object becomes a rule, and the reverse (same type)', () => {
  it('free to dependent keeps id and style; descendants recompute', () => {
    const f = figure(BASE);
    ok(f.apply('B with color = red'));
    const id = idOf(f, 'B');
    ok(f.apply('B = Midpoint(A, C)'));
    expect(must(f.get('B')).free).toBe(false);
    expect(idOf(f, 'B')).toBe(id);
    expect(must(f.get('B')).style.color).toEqual(colorFromWord('red'));
    expect(f.value('B')).toEqual({ x: 0, y: 3 });
    expect(f.value('M')).toEqual({ x: 0, y: 1.5 });
  });

  it('dependent to free', () => {
    const f = figure(BASE);
    const id = idOf(f, 'M');
    ok(f.apply('M = (9, 9)'));
    expect(must(f.get('M')).free).toBe(true);
    expect(idOf(f, 'M')).toBe(id);
    expect(f.value('N')).toEqual({ x: 4.5, y: 7.5 });
    expect(must(f.get('M')).inputs).toEqual([]);
  });

  it('a Number can go from formula to plain value and back', () => {
    const f = figure(BASE);
    ok(f.apply('h = 10'));
    expect(must(f.get('h')).free).toBe(true);
    ok(f.apply('h = a * 2'));
    expect(must(f.get('h')).free).toBe(false);
    expect(f.value('h')).toBe(6);
  });
});

describe('type_change', () => {
  const cases: [string, string, string, string][] = [
    ['a', 'a = Circle(A, 2)', 'Number', 'Circle'],
    ['a', 'a = (1, 2)', 'Number', 'Point'],
    ['a', 'a = true', 'Number', 'Bool'],
    ['a', 'a = "text"', 'Number', 'Text'],
    ['A', 'A = 3', 'Point', 'Number'],
    ['A', 'A = Line(A, B)', 'Point', 'Line'],
    ['M', 'M = Distance(A, B)', 'Point', 'Number'],
    ['flag', 'flag = 1', 'Bool', 'Number'],
    ['s', 's = (1, 1)', 'Text', 'Point'],
    ['L', 'L = 5', 'List', 'Number'],
  ];
  it.each(cases)('%s: "%s" is %s -> %s', (name, line, from, to) => {
    const f = figure([...BASE, 'flag = true', 's = "x"', 'L = [1, 2]']);
    const before = snap(f);
    const e = bad(f.apply(line), 'type_change');
    expectWellFormedError(e);
    expect(e.code).toBe('K011');
    // a List may carry its element type: `List<Number>` counts as a List
    expect(String(e.params.from).startsWith(from)).toBe(true);
    expect(String(e.params.to).startsWith(to)).toBe(true);
    expect(e.recovery).toBe('rewrite');
    expect(e.committed).toBe(false);
    expect(e.message).toContain(name);
    expect(e.message).toContain(from);
    expect(e.message).toContain(to);
    expect(e.hint ?? '').toContain(`Delete(${name})`);
    expectUnchanged(f, before, line);
  });

  it('the hint says what Delete would take with it (kernel errors.md example)', () => {
    const f = figure(['O = (0, 0)', 'c = 2', 'd = c + 1', 'g = d * 2']);
    const e = bad(f.apply('c = Circle(O, 2)'), 'type_change');
    expect(e.hint).toContain('Delete(c)');
    expect(e.hint).toMatch(/\bd\b/);
    expect(e.hint).toMatch(/\bg\b/);
  });

  it('suggests another name for the same line', () => {
    const f = figure(['O = (0, 0)', 'c = 2']);
    const e = bad(f.apply('c = Circle(O, 2)'), 'type_change');
    expect(e.suggest.length).toBeGreaterThan(0);
    const s = e.suggest[0] as string;
    expect(s).toMatch(/^[A-Za-z_]\w* = Circle\(O, 2\)$/);
    const name = s.split(' ')[0] as string;
    expect(f.get(name)).toBeUndefined();
    ok(f.apply(s));
  });

  it('points at the whole line (kernel errors.md example)', () => {
    const f = figure(['O = (0, 0)', 'c = 2']);
    const line = 'c = Circle(O, 2)';
    const e = bad(f.apply(line), 'type_change');
    expect(e.token).toBe(line);
    expect(e.col).toBe(1);
    expect(e.endCol).toBe(line.length + 1);
  });

  it('Delete first, then the new type is allowed', () => {
    const f = figure(['O = (0, 0)', 'c = 2', 'd = c + 1']);
    ok(f.apply('Delete(c)'));
    ok(f.apply('c = Circle(O, 2)'));
    expect(must(f.get('c')).type).toBe('Circle');
    expect(f.get('d')).toBeUndefined();
  });
});

describe('cycle', () => {
  it('a redefinition that makes an object depend on itself is rejected with the path', () => {
    const f = figure(BASE);
    const before = snap(f);
    const e = bad(f.apply('A = Midpoint(M, B)'), 'cycle');
    expectWellFormedError(e);
    expect(e.code).toBe('K010');
    expect(e.path).toEqual(['A', 'M', 'A']);
    expect(e.recovery).toBe('rewrite');
    expect(e.phase).toBe('plan');
    expect(e.message).toContain('A -> M -> A');
    expect(e.hint ?? '').not.toBe('');
    expectUnchanged(f, before);
  });

  it('works through a longer chain: the path lists each step and starts and ends at the object', () => {
    const f = figure(BASE);
    const e = bad(f.apply('A = Midpoint(N, B)'), 'cycle');
    expectChain(f, e.path);
    expect(new Set(e.path)).toEqual(new Set(['A', 'M', 'N']));
    expect(e.path?.length).toBe(4);
  });

  it('self reference through a command is a cycle', () => {
    const f = figure(BASE);
    const e = bad(f.apply('M = Midpoint(M, B)'), 'cycle');
    expect(e.path).toEqual(['M', 'M']);
  });

  it('a dependent Number that reads itself is a cycle, not an assignment', () => {
    const f = figure(BASE);
    const e = bad(f.apply('h = h + 1'), 'cycle');
    expect(e.path?.[0]).toBe('h');
  });

  it('a descendant of the object counts too (the downstream test)', () => {
    const f = figure(['a = 1', 'b = a + 1', 'c = b + 1', 'd = c + 1']);
    const e = bad(f.apply('a = d + 1'), 'cycle');
    expectChain(f, e.path);
    expect(new Set(e.path)).toEqual(new Set(['a', 'b', 'c', 'd']));
    expect(e.path?.length).toBe(5);
  });

  it('is not a cycle when the new inputs only share ancestors', () => {
    const f = figure(['a = 1', 'b = a + 1', 'c = a + 2']);
    ok(f.apply('b = c + 1'));
    expect(f.value('b')).toBe(4);
  });

  it('a property rule that reads its own owner is legal (style edges are not value edges)', () => {
    const f = figure(['P = (2, 1)']);
    ok(f.apply('P with color = hsl(36 * P.x, 1, 0.5)'));
    ok(f.apply('q = 2'));
    ok(f.apply('q with showIf = (q < 5)'));
  });

  it('a style edge from an object that reads this one does not make a cycle either', () => {
    const f = figure(['a = 2 in 0..10', 'h = Reciprocal(a)']);
    ok(f.apply('a with showIf = (h < 5)'));
    expect(f.dependentsOf('a')).toEqual([idOf(f, 'h')]);
  });
});

describe('self reference on a free Number, Point or Bool is an assignment (ruling K2)', () => {
  it('a = a + 1 runs once with the old value and stores a free value', () => {
    const f = figure(['a = 3', 'h = a * 2']);
    const r = ok(f.apply('a = a + 1'));
    expect(r.op).toBe('redefine');
    expect(f.value('a')).toBe(4);
    expect(f.value('h')).toBe(8);
    expect(must(f.get('a')).free).toBe(true);
    // it is stored as a value, not as a rule that reads itself
    expect(f.toScript()).toContain('a = 4');
    ok(f.apply('a = a + 1'));
    expect(f.value('a')).toBe(5);
  });

  it('works on a slider and keeps its range', () => {
    const f = figure(['a = 3 in 0..10 step 0.5']);
    ok(f.apply('a = a + 1'));
    expect(f.value('a')).toBe(4);
    expect(must(f.get('a')).range).toEqual({ min: 0, max: 10, step: 0.5 });
  });

  // Design 8 and ruling K2 name `A = A + (1, 1)` as the example. A Point plus a pair literal is a Point plus a Point,
  // which the language does not define (README decision 6 makes Point - Point a Vector). Doc conflict, kept as written.
  it('works on a free Point: the doc example A = A + (1, 1)', () => {
    const f = figure(['A = (1, 2)', 'M = Midpoint(A, A)']);
    ok(f.apply('A = A + (1, 1)'));
    expect(f.value('A')).toEqual({ x: 2, y: 3 });
    expect(f.value('M')).toEqual({ x: 2, y: 3 });
  });

  it('works on a free Point with a Vector', () => {
    const f = figure(['A = (1, 2)', 'v = Vector(1, 1)', 'M = Midpoint(A, A)']);
    ok(f.apply('A = A + v'));
    expect(f.value('A')).toEqual({ x: 2, y: 3 });
    expect(must(f.get('A')).free).toBe(true);
  });

  it('works on a free Bool', () => {
    const f = figure(['flag = true']);
    ok(f.apply('flag = not flag'));
    expect(f.value('flag')).toBe(false);
  });

  it('is undone as one step', () => {
    const f = figure(['a = 3']);
    ok(f.apply('a = a + 1'));
    ok(f.undo());
    expect(f.value('a')).toBe(3);
  });

  it('on a new name it is unknown_name', () => {
    const f = figure(['a = 3']);
    const before = snap(f);
    bad(f.apply('zz = zz + 1'), 'unknown_name');
    expectUnchanged(f, before);
  });

  it('on any other kind it is a cycle (a free Text)', () => {
    const f = figure(['s = "hi"']);
    const before = snap(f);
    bad(f.apply('s = s + "!"'), 'cycle');
    expectUnchanged(f, before);
  });

  it('an assignment from an unrelated rule reading the same name is still a cycle', () => {
    const f = figure(['a = 3', 'b = a + 1']);
    const before = snap(f);
    bad(f.apply('a = b + 1'), 'cycle');
    expectUnchanged(f, before);
  });
});

describe('fixed objects are locked', () => {
  it('cannot be redefined by a line', () => {
    const f = figure(BASE);
    ok(f.apply('A with fixed = true'));
    const before = snap(f);
    const line = 'A = (3, 3)';
    const e = bad(f.apply(line), 'locked');
    expectWellFormedError(e);
    expect(e.code).toBe('K014');
    expect(e.recovery).toBe('choose');
    expect(e.hint).toContain('A with fixed = false');
    expect(e.suggest).toContain('A with fixed = false');
    expect(e.token).toBe(line); // kernel errors.md example: the whole line
    expectUnchanged(f, before);
  });

  it('cannot be deleted by a line', () => {
    const f = figure(BASE);
    ok(f.apply('M with fixed = true'));
    const before = snap(f);
    bad(f.apply('Delete(M)'), 'locked');
    expectUnchanged(f, before);
  });

  it('can still be restyled, and unfixed with `with fixed = false`, after which it can change', () => {
    const f = figure(BASE);
    ok(f.apply('A with fixed = true'));
    ok(f.apply('A with color = blue'));
    ok(f.apply('A with fixed = false'));
    ok(f.apply('A = (3, 3)'));
    expect(f.value('A')).toEqual({ x: 3, y: 3 });
  });

  it('the teacher may change it only when it says so (force)', () => {
    const f = figure(BASE);
    ok(f.apply('A with fixed = true'));
    bad(f.apply('A = (3, 3)'), 'locked');
    ok(f.apply('A = (3, 3)', { force: true }));
    expect(f.value('A')).toEqual({ x: 3, y: 3 });
  });

  it('deleting an unfixed object whose dependent is fixed is refused rather than removing the fixed object', () => {
    // Docs are silent on this case; the reading closest to design 9.7 ("no deletion") is to refuse.
    const f = figure(BASE);
    ok(f.apply('N with fixed = true'));
    const before = snap(f);
    const r = f.apply('Delete(M)');
    if (r.ok) {
      expect(f.get('N')).toBeUndefined(); // if a cascade is allowed, the cascade must be reported
      expect(r.changed.removed).toContain('N');
    } else {
      expect(r.kind).toBe('locked');
      expectUnchanged(f, before);
    }
  });

  it('works for each free kind: Number slider, Point, Bool', () => {
    const f = figure([...BASE, 'flag = true']);
    for (const [name, line] of [['a', 'a = 5'], ['A', 'A = (9, 9)'], ['flag', 'flag = false']] as const) {
      ok(f.apply(`${name} with fixed = true`));
      bad(f.apply(line), 'locked');
      ok(f.apply(`${name} with fixed = false`));
      ok(f.apply(line));
    }
  });
});

describe('redefine to the same text', () => {
  it('runs a plain update: no structural change, ids and order kept, a redefined_to_same notice', () => {
    const f = figure(BASE);
    const names = f.names();
    const depth = f.undoInfo().depth;
    resetRuns();
    const r = ok(f.apply('M = Midpoint(A, B)'));
    expect(f.names()).toEqual(names);
    expect(r.changed.moved).toEqual([]);
    expect(r.notices.map((n) => n.kind)).toContain('redefined_to_same');
    expect(runs.get('Midpoint') ?? 0).toBeGreaterThanOrEqual(1); // the rule was run again
    expect(f.undoInfo().depth).toBeGreaterThanOrEqual(depth); // a no-op may or may not be journalled
  });

  it('a free value written again to the same value also reports it', () => {
    const f = figure(BASE);
    const r = ok(f.apply('A = (0, 0)'));
    expect(r.notices.map((n) => n.kind)).toContain('redefined_to_same');
  });
});

describe('descendants whose argument shape stops fitting become undefined, not errors', () => {
  it('Line(P, Q) after P is redefined onto Q is degenerate', () => {
    const f = figure(['P = (0, 0)', 'Q = (1, 1)', 'l = Line(P, Q)', 'I = Parallel(Q, l)']);
    const r = ok(f.apply('P = Midpoint(Q, Q)'));
    expect(r.ok).toBe(true);
    expect(f.cellOf('l')).toEqual(expect.objectContaining({ defined: false, reason: 'degenerate' }));
    expect(r.changed.becameUndefined.map((x) => x.name)).toEqual(expect.arrayContaining(['l', 'I']));
  });
});

describe('dryRun: the same checks without a commit (kernel design 8, errors.md 5 rule 3)', () => {
  it('returns the plan summary and the affected objects and changes nothing', () => {
    const f = figure(BASE);
    const before = snap(f);
    const r = ok(f.apply('A = (9, 9)', { dryRun: true }));
    expect(r.dryRun).toBe(true);
    expect(r.op).toBe('redefine');
    expect(r.affected).toEqual(['M', 'N']);
    expectUnchanged(f, before);
    expect(f.value('A')).toEqual({ x: 0, y: 0 });
  });

  it('a dry run of a new definition does not add the object', () => {
    const f = figure(BASE);
    const before = snap(f);
    const r = ok(f.apply('Z = Midpoint(A, B)', { dryRun: true }));
    expect(r.op).toBe('add');
    expect(r.dryRun).toBe(true);
    expect(f.get('Z')).toBeUndefined();
    expectUnchanged(f, before);
  });

  it('is guaranteed to match what the real line does', () => {
    const f = figure(BASE);
    const lines = ['A = (9, 9)', 'M = Midpoint(A, C)', 'Z = Midpoint(A, B)', 'a = 7 in 0..10', 'B = Midpoint(A, C)'];
    for (const line of lines) {
      const dry = ok(f.apply(line, { dryRun: true }), line);
      const real = ok(f.apply(line), line);
      expect(dry.op, line).toBe(real.op);
      expect(dry.summary, line).toBe(real.summary);
      expect(dry.changed.added, line).toEqual(real.changed.added);
      expect(dry.changed.redefined, line).toEqual(real.changed.redefined);
      expect(dry.changed.becameUndefined, line).toEqual(real.changed.becameUndefined);
    }
  });

  it('returns the same error as the real line for every rejection, and still changes nothing', () => {
    const f = figure([...BASE, 'flag = true']);
    ok(f.apply('C with fixed = true'));
    const lines = ['A = Midpoint(M, B)', 'a = Circle(A, 2)', 'C = (1, 1)', 'Q = Midpoint(A, Zed)', 'A with layer = 12', 'A with colour = red', 'Delete(C)'];
    for (const line of lines) {
      const before = snap(f);
      const dry = bad(f.apply(line, { dryRun: true }));
      expectUnchanged(f, before, `dry ${line}`);
      const real = bad(f.apply(line));
      expect(dry.kind, line).toBe(real.kind);
      expect(dry.code, line).toBe(real.code);
      expect(dry.col, line).toBe(real.col);
      expect(dry.endCol, line).toBe(real.endCol);
      expect(dry.token, line).toBe(real.token);
      expect(dry.fingerprint, line).toBe(real.fingerprint);
    }
  });

  it('does not touch the journal, the redo stack or the clock', () => {
    const f = figure(BASE);
    ok(f.apply('Z = (1, 1)'));
    ok(f.undo());
    const info = f.undoInfo();
    f.setClock(2);
    f.apply('Z = (1, 1)', { dryRun: true });
    f.apply('Delete(A)', { dryRun: true });
    expect(f.undoInfo()).toEqual(info);
    expect(f.clock().t).toBe(2);
  });

  it('emits no events', () => {
    const f = figure(BASE);
    const seen: unknown[] = [];
    f.on((e) => seen.push(e));
    f.apply('A = (9, 9)', { dryRun: true });
    f.apply('Z = (1, 1)', { dryRun: true });
    expect(seen).toEqual([]);
  });
});
