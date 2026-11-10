import { describe, expect, it } from 'vitest';
import { EMPTY_COMMANDS, checkTable, createCommandTable, formText } from '@incantly/kernel';
import type { CommandSpec, TNode } from '@incantly/kernel';
import { COMMANDS, check, checked, errOf, expectAt, failure, form, newFig, p } from './helpers';

/**
 * rulings.md Q7: a wrong argument count is its own kind, `arg_count`. `no_matching_form` is for type problems
 * when the count fits at least one form. `bad_arity` does not exist.
 */

function commandNode(src: string): Extract<TNode, { n: 'command' }> {
  const c = checked(src);
  const e = c.expr;
  if (!e || e.n !== 'command') throw new Error(`"${src}" did not check to a command node`);
  return e;
}

describe('language/design.md 3.11 command argument matching: exact forms', () => {
  it.each([
    ['c9 = Circle(A, 2)', 'Circle'],
    ['c9 = Circle(A, a)', 'Circle'],
    ['c9 = Circle(A, B)', 'Circle'],
    ['c9 = Circle(A, B, C)', 'Circle'],
    ['c9 = Circle(P, A.x + 1)', 'Circle'],
    ['M9 = Midpoint(A, B)', 'Point'],
    ['M9 = Midpoint(s)', 'Point'],
    ['M9 = Midpoint((0, 0), B)', 'Point'],
    ['d9 = Distance(A, Midpoint(B, C))', 'Number'],
    ['s9 = Segment(A, B)', 'Segment'],
    ['v9 = Vector(A)', 'Vector'],
  ])('%s has type %s', (src, type) => {
    expect(checked(src).type?.k).toBe(type);
  });

  it('3.11 step 5: the form that matches is chosen by the argument types, not by the table order', () => {
    const c = commandNode('c9 = Circle(A, B)');
    expect(c.form.params.map((q) => q.name)).toEqual(['center', 'through']);
    const d = commandNode('c9 = Circle(A, 2)');
    expect(d.form.params.map((q) => q.name)).toEqual(['center', 'radius']);
    const e = commandNode('c9 = Circle(A, B, C)');
    expect(e.form.params.map((q) => q.name)).toEqual(['a', 'b', 'c']);
  });

  it('3.11 order-independence: reversing every form list gives the same answers', () => {
    const reversed: CommandSpec[] = COMMANDS.map((s) => ({ ...s, forms: [...s.forms].reverse() }));
    const fwd = newFig();
    const rev = newFig(reversed.reverse());
    const calls = [
      'c9 = Circle(A, 2)',
      'c9 = Circle(A, B)',
      'c9 = Circle(A, B, C)',
      'M9 = Midpoint(A, B)',
      'M9 = Midpoint(s)',
      'c9 = Circle(A, 2, 3)',
      'c9 = Circle(s, 2)',
      'M9 = Midpoint(a)',
      'S9 = Seq(k^2, k, 1, 4)',
      'l9 = Line(A, B)',
      'l9 = Line(y == 2)',
    ];
    for (const src of calls) {
      const a = check(src, fwd);
      const b = check(src, rev);
      expect(b.ok, src).toBe(a.ok);
      if (a.ok && b.ok) expect(b.value.type?.k, src).toBe(a.value.type?.k);
      if (!a.ok && !b.ok) expect(b.kind, src).toBe(a.kind);
    }
  });

  it('3.11 step 5: of several passing forms the most specific wins, whatever the table order', () => {
    const mk = (first: 'alias' | 'concrete'): CommandSpec => ({
      name: 'Which',
      kind: 'object',
      group: 'test',
      forms: first === 'alias' ? [form([p('o', 'Shape')], 'Text'), form([p('o', 'Point')], 'Number')] : [form([p('o', 'Point')], 'Number'), form([p('o', 'Shape')], 'Text')],
    });
    for (const order of ['alias', 'concrete'] as const) {
      const fig = newFig([mk(order)]);
      expect(checked('x1 = Which(A)', fig).type?.k, order).toBe('Number');
      expect(checked('x2 = Which(s)', fig).type?.k, order).toBe('Text');
      expect(checked('x3 = Which(c1)', fig).type?.k, order).toBe('Text');
    }
  });

  it('3.11 aliases and unions in parameters', () => {
    expect(checked('n1 = Pick(a)').type?.k).toBe('Number');
    expect(checked('n1 = Pick(A)').type?.k).toBe('Number');
  });

  it('3.11 action commands stand alone and have no result', () => {
    const c = checked('Hide(A)');
    expect(c.op).toBe('action');
    expect(c.kind).toBe('action');
    expect(c.names).toEqual([]);
    expect(c.type).toBeUndefined();
  });

  it('3.11 rest parameters: any number of extra arguments of one type', () => {
    expect(check('Hide(A)').ok).toBe(true);
    expect(check('Hide(A, B, s, c1, a)').ok).toBe(true);
    expect(checked('pq = Polygon(A, B, C)').type?.k).toBe('Polygon');
    expect(checked('pq = Polygon(A, B, C, P)').type?.k).toBe('Polygon');
    expect(checked('pq = Polygon(A, B, C, P, A, B)').type?.k).toBe('Polygon');
  });

  it('3.11 rest parameters still need the fixed ones and the right type', () => {
    expect(failure('pq = Polygon(A, B)').kind).toBe('arg_count');
    const e = failure('pq = Polygon(A, B, C, 2)');
    expect(e.kind).toBe('no_matching_form');
    expect(e.problems?.[0]?.argIndex).toBe(3);
    expect(e.problems?.[0]?.got).toBe('Number');
  });

  it('3.11 an action on an unknown object is unknown_name', () => {
    const e = failure('Hide(Q)');
    expect(e.kind).toBe('unknown_name');
    expectAt(e, { col: 6, endCol: 7, token: 'Q' });
  });

  it('3.11 optional parameters are filled with their default before the rule is built', () => {
    const one = commandNode('r9 = Round3(2.567)');
    expect(one.args.length).toBe(2);
    expect(one.args[1]?.omitted).toBe(true);
    expect(one.args[1]?.value).toBe(2);
    const two = commandNode('r9 = Round3(2.567, 1)');
    expect(two.args[1]?.omitted).toBe(false);
    expect(two.args[1]?.expr).toBeDefined();
  });

  it('3.11 the command line checks as dependent, and reads the objects in its arguments', () => {
    const c = checked('c9 = Circle(A, a)');
    expect(c.reads.length).toBe(2);
    expect(c.free).toBe(false);
  });

  it('3.11 a command may appear inside an expression', () => {
    expect(checked('n1 = Distance(A, B) + 2').type?.k).toBe('Number');
    expect(checked('n1 = 2 Distance(A, B)').type?.k).toBe('Number');
    expect(checked('M9 = Midpoint(A, Midpoint(B, C))').type?.k).toBe('Point');
  });
});

describe('language/design.md 3.11 named arguments', () => {
  it.each([
    'c9 = Circle(center = A, radius = 2)',
    'c9 = Circle(radius = 2, center = A)',
    'c9 = Circle(A, radius = 2)',
    'c9 = Circle(center = A, through = B)',
    'c9 = Circle(through = B, center = A)',
    'c9 = Circle(a = A, b = B, c = C)',
    'd9 = Distance(b = B, a = A)',
  ])('%s matches by name', (src) => {
    expect(checked(src).type?.k).toBeDefined();
  });

  it('3.11 named arguments pick the form by name', () => {
    expect(commandNode('c9 = Circle(center = A, through = B)').form.params.map((q) => q.name)).toEqual(['center', 'through']);
    expect(commandNode('c9 = Circle(radius = 2, center = A)').form.params.map((q) => q.name)).toEqual(['center', 'radius']);
  });

  it('3.11 step 1: the same parameter named twice is duplicate_arg', () => {
    const e = failure('c9 = Circle(center = A, center = B)');
    expect(e.kind).toBe('duplicate_arg');
    expectAt(e, { col: 25, endCol: 31, token: 'center' });
    expect(JSON.stringify(e)).toContain('center');
  });

  it('3.11 step 1: a named argument for a parameter already bound by position is duplicate_arg', () => {
    const e = failure('d = Distance(A, a = B)');
    expect(e.kind).toBe('duplicate_arg');
    expect(e.token).toBe('a');
  });

  it('3.11 step 1: a name that is no parameter is reported with the nearest parameter names', () => {
    const e = failure('c9 = Circle(centre = A, radius = 2)');
    expect(e.ok).toBe(false);
    expect(JSON.stringify(e)).toContain('center');
    expect(e.col).toBe(13);
    expect(e.token).toBe('centre');
  });
});

describe('language/design.md 3.11 binders and bodies', () => {
  it('Seq(k^2, k, 1, 5): the binder is a local, the body is checked in its scope', () => {
    const c = commandNode('S9 = Seq(k^2, k, 1, 5)');
    expect(c.args[1]?.binder).toBe('k');
    expect(typeof c.args[1]?.slot).toBe('number');
    expect(c.args[0]?.expr).toBeDefined();
    expect(c.ty.k).toBe('List');
    expect(c.ty.of?.k).toBe('Number');
  });

  it('the body sees outer objects and records them as reads', () => {
    const c = checked('S9 = Seq(k * a, k, 1, 3)');
    expect(c.reads.length).toBe(1);
    expect(c.type?.of?.k).toBe('Number');
  });

  it('the binder is not an object: it is gone after the call', () => {
    expect(failure('n1 = k + 1').kind).toBe('unknown_name');
  });

  it('3.13 unused_binder: Seq(3, k, 1, 5) ignores k', () => {
    const r = check('S9 = Seq(3, k, 1, 5)');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.notices.map((n) => n.kind)).toContain('unused_binder');
    const used = check('S9 = Seq(k, k, 1, 5)');
    if (used.ok) expect(used.notices.map((n) => n.kind)).not.toContain('unused_binder');
  });

  it('3.7 a binder that hides an object succeeds with a shadowed warning, and the body reads the binder', () => {
    const r = check('S9 = Seq(a^2, a, 1, 3)'); // a is a Number in the figure
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.notices.map((n) => n.kind)).toContain('shadowed');
      expect(r.value.reads.length).toBe(0);
    }
  });

  it('errors.md 4 not_a_binder: a binder position that is not a bare name', () => {
    const e = failure('S9 = Seq(2, 3, 1, 5)');
    expect(e.kind).toBe('not_a_binder');
    expect(e.expected).toEqual(['name']);
    expectAt(e, { col: 13, endCol: 14, token: '3' });
  });

  it('errors.md 4 not_a_binder: the doc example Seq(k^2, 3, 1, 5)', () => {
    const e = failure('S9 = Seq(k^2, 3, 1, 5)');
    const all = [e, ...(e.more ?? [])];
    expect(all.map((x) => x.kind)).toContain('not_a_binder');
  });

  it('3.11 the body is typed with the parameter type as the expected type', () => {
    expect(failure('S9 = Seq(k > 1, k, 1, 3)').kind).toBe('no_matching_form');
  });
});

describe('language/design.md 3.11 step 6: failing with a diagnosis', () => {
  it('core 9: Circle(A, B, 2) has no form; the closest is the 3-point form (the only form whose count fits)', () => {
    const e = failure('c = Circle(A, B, 2)');
    expect(e.kind).toBe('no_matching_form');
    expect(e.message).toContain('Circle');
    expect(e.forms.length).toBe(3);
    expect(e.forms[0]).toBe('Circle(a: Point, b: Point, c: Point) -> Circle');
    expect([...e.forms].sort()).toEqual(
      [
        'Circle(center: Point, radius: Number) -> Circle',
        'Circle(center: Point, through: Point) -> Circle',
        'Circle(a: Point, b: Point, c: Point) -> Circle',
      ].sort(),
    );
    expect(e.problems?.length).toBe(1);
    const pr = e.problems?.[0];
    expect(pr?.argIndex).toBe(2);
    expect(pr?.param).toBe('c');
    expect(pr?.expected).toBe('Point');
    expect(pr?.got).toBe('Number');
    expect(pr?.col).toBe(18);
    expect(pr?.endCol).toBe(19);
  });

  it('rulings.md Q5: Circle(A, 2, 3) lists the 3-point form first, because it is the only form whose count fits', () => {
    const e = failure('c = Circle(A, 2, 3)');
    expect(e.kind).toBe('no_matching_form');
    expect(e.forms[0]).toBe('Circle(a: Point, b: Point, c: Point) -> Circle');
    expect(e.problems?.map((x) => x.argIndex)).toEqual([1, 2]);
    expect(e.problems?.map((x) => x.got)).toEqual(['Number', 'Number']);
    expect(e.problems?.map((x) => x.param)).toEqual(['b', 'c']);
  });

  it('rulings.md Q5: errors.md 5 example, forms are listed 3-point, radius, through; problems have the example columns', () => {
    const e = failure('c9 = Circle(A, 2, 3)');
    expect(e.forms.slice(0, 3)).toEqual([
      'Circle(a: Point, b: Point, c: Point) -> Circle',
      'Circle(center: Point, radius: Number) -> Circle',
      'Circle(center: Point, through: Point) -> Circle',
    ]);
    expect(e.problems).toEqual([
      expect.objectContaining({ argIndex: 1, param: 'b', expected: 'Point', got: 'Number', col: 16, endCol: 17 }),
      expect.objectContaining({ argIndex: 2, param: 'c', expected: 'Point', got: 'Number', col: 19, endCol: 20 }),
    ]);
  });

  it('rulings.md Q5: among forms whose count fits, the one with the fewest problems comes first', () => {
    // Midpoint(A, 2): the count fits only the 2-point form (Midpoint(s) takes one argument).
    const e = failure('M9 = Midpoint(A, 2)');
    expect(e.kind).toBe('no_matching_form');
    expect(e.forms[0]).toBe('Midpoint(a: Point, b: Point) -> Point');
    expect(e.problems).toEqual([expect.objectContaining({ argIndex: 1, param: 'b', got: 'Number' })]);
  });

  it('rulings.md Q5: when no form fits the count, the form with the fewest problems overall comes first', () => {
    // Midpoint(A, B, C): the 2-point form has one problem (extra); the segment form has two (a Point for a Segment, extra).
    const e = failure('M9 = Midpoint(A, B, C)');
    expect(e.kind).toBe('arg_count');
    expect(e.forms[0]).toBe('Midpoint(a: Point, b: Point) -> Point');
    expect(e.problems?.length).toBe(1);
    expect(e.problems?.[0]?.got).toBe('extra');
  });

  it('3.11 a wrong argument type is named with the parameter, the expected type and what was given', () => {
    const e = failure('c = Circle(s, 2)');
    expect(e.kind).toBe('no_matching_form');
    expect(e.forms[0]).toBe('Circle(center: Point, radius: Number) -> Circle');
    expect(e.problems).toEqual([expect.objectContaining({ argIndex: 0, param: 'center', expected: 'Point', got: 'Segment', col: 12, endCol: 13 })]);
    expect(e.message).toContain('Circle');
  });

  it('3.11 a union parameter reports "Number or Point"', () => {
    const e = failure('n1 = Pick(s)');
    expect(e.kind).toBe('no_matching_form');
    expect(e.problems?.[0]?.expected).toBe('Number or Point');
    expect(e.problems?.[0]?.got).toBe('Segment');
  });

  it('rulings.md Q7: too many arguments for every form is arg_count; the extra argument is reported at its span', () => {
    const e = failure('m = Midpoint(A, B, C)');
    expect(e.kind).toBe('arg_count');
    const pr = e.problems?.find((x) => x.got === 'extra');
    expect(pr).toBeDefined();
    expect(pr?.argIndex).toBe(2);
    expect(pr?.col).toBe(20);
    expect(pr?.endCol).toBe(21);
  });

  it('rulings.md Q7: too few arguments is arg_count: argIndex -1 and got "missing"', () => {
    const e = failure('d = Distance(A)');
    expect(e.kind).toBe('arg_count');
    expect(e.problems).toHaveLength(1);
    expect(e.problems?.[0]?.argIndex).toBe(-1);
    expect(e.problems?.[0]?.got).toBe('missing');
    expect(e.problems?.[0]?.param).toBe('b');
    expect(e.problems?.[0]?.expected).toBe('Point');
  });

  it('3.11 a wrong type in a single-form command', () => {
    const e = failure('d = Distance(A, 5)');
    expect(e.kind).toBe('no_matching_form');
    expect(e.forms).toEqual(['Distance(a: Point, b: Point) -> Number']);
    expect(e.problems).toEqual([expect.objectContaining({ argIndex: 1, param: 'b', expected: 'Point', got: 'Number', col: 17, endCol: 18 })]);
  });

  it('rulings.md Q7: a command with no arguments at all is arg_count', () => {
    const e = failure('c9 = Circle()');
    expect(e.kind).toBe('arg_count');
    expect(e.forms.length).toBe(3);
    expect(failure('Hide()').kind).toBe('arg_count');
  });

  it('rulings.md Q7: arg_count and no_matching_form are never swapped, and bad_arity is never raised', () => {
    const cases: [string, string][] = [
      ['d = Distance(A)', 'arg_count'],
      ['d = Distance(A, B, C)', 'arg_count'],
      ['c9 = Circle(A)', 'arg_count'],
      ['c9 = Circle(A, B, C, A)', 'arg_count'],
      ['d = Distance(A, 5)', 'no_matching_form'],
      ['d = Distance(5, A)', 'no_matching_form'],
      ['c9 = Circle(A, B, 2)', 'no_matching_form'],
      ['n1 = Pick(s)', 'no_matching_form'],
    ];
    for (const [src, kind] of cases) {
      const e = failure(src);
      expect(e.kind, src).toBe(kind);
      expect(e.kind, src).not.toBe('bad_arity');
    }
  });

  it('rulings.md Q7: a call of a Function object with the wrong number of arguments is arg_count with the single form', () => {
    const e = failure('n1 = f(1, 2)');
    expect(e.kind).toBe('arg_count');
    expect(e.forms.length).toBe(1);
  });

  it('rulings.md Q6: Distance(A, 5), the count fits and one argument is wrong, so the span is that argument', () => {
    const e = failure('d = Distance(A, 5)');
    expectAt(e, { col: 17, endCol: 18, token: '5' });
  });

  it('rulings.md Q6: Circle(A, B, 2) points at the one wrong argument', () => {
    const e = failure('c = Circle(A, B, 2)');
    expectAt(e, { col: 18, endCol: 19, token: '2' });
  });

  it('rulings.md Q6: Circle(s, 2) points at the wrong first argument', () => {
    const e = failure('c = Circle(s, 2)');
    expectAt(e, { col: 12, endCol: 13, token: 's' });
  });

  it('rulings.md Q6: when the count fits no form, the span is the whole call', () => {
    expectAt(failure('d = Distance(A)'), { col: 5, endCol: 16, token: 'Distance(A)' });
    expectAt(failure('d = Distance(A, B, C)'), { col: 5, endCol: 22, token: 'Distance(A, B, C)' });
    expectAt(failure('c9 = Circle()'), { col: 6, endCol: 14, token: 'Circle()' });
    expectAt(failure('Hide()'), { col: 1, endCol: 7, token: 'Hide()' });
  });

  it('errors.md 5 example: Circle(A, 2, 3) has two wrong arguments, so the span is the whole call', () => {
    const e = failure('c9 = Circle(A, 2, 3)');
    expectAt(e, { col: 6, endCol: 21, token: 'Circle(A, 2, 3)' });
  });

  it('3.11 the error names the closest form and the first problem; forms is the full list', () => {
    const e = failure('d = Distance(A, 5)');
    expect(e.message).toContain('Distance');
    expect(e.message).toMatch(/argument 2|second|b\b/i);
    expect(e.message).toContain('Number');
    expect(e.message).toContain('Point');
  });

  it('errors/design.md 3: forms has at most 6 entries; formsOmitted counts the rest', () => {
    const e = failure('q9 = Many(A)');
    expect(e.kind).toBe('no_matching_form'); // one argument fits the 1-parameter form, but A is a Point
    expect(e.forms.length).toBeLessThanOrEqual(6);
    expect(e.forms.length + (e.formsOmitted ?? 0)).toBe(8);
  });

  it('a call whose argument has its own error reports that error (unknown name inside a call)', () => {
    const e = failure('c9 = Circle(Q, 2)');
    expect(e.kind).toBe('unknown_name');
    expectAt(e, { col: 13, endCol: 14, token: 'Q' });
  });

  it('errors.md 4: several independent mistakes in one line are collected (up to 8)', () => {
    const e = failure('n1 = q1 + q2 + q3');
    expect(e.kind).toBe('unknown_name');
    expect(e.token).toBe('q1');
    expect(e.more?.map((x) => x.token)).toEqual(['q2', 'q3']);
  });

  it('rulings.md Q13: one main error per line, plus more errors in `more`, capped at 8 more', () => {
    // errors.md 6 says "1 + 7 in more" and the ruling says "up to 8 more"; accept 7 or 8 and nothing beyond.
    const names = Array.from({ length: 20 }, (_, i) => `q${i + 1}`);
    const e = failure(`n1 = ${names.join(' + ')}`);
    expect(e.token).toBe('q1');
    expect(e.more?.length).toBeGreaterThanOrEqual(7);
    expect(e.more?.length).toBeLessThanOrEqual(8);
    expect((e.more ?? []).map((x) => x.token).slice(0, 7)).toEqual(names.slice(1, 8));
    for (const x of e.more ?? []) expect(x.more ?? []).toEqual([]);
  });

  it('rulings.md Q13: a line with a single mistake has no `more`', () => {
    const e = failure('n1 = q1');
    expect(e.more ?? []).toEqual([]);
  });

  it('3.1 an error inside a command argument in a defmany line', () => {
    expect(failure('X1, X2 = Intersect(c1, Q)').kind).toBe('unknown_name');
  });

  it('3.1 the limit: a command takes at most 16 arguments', () => {
    const ok = `Hide(${Array(16).fill('A').join(', ')})`;
    expect(check(ok).ok).toBe(true);
    const e = failure(`Hide(${Array(17).fill('A').join(', ')})`);
    expect(e.kind).toBe('limit');
    expect(e.limit?.max).toBe(16);
    expect(e.limit?.got).toBe(17);
  });
});

describe('language/errors.md 4 command and function names', () => {
  it('unknown_command: PascalCase name not in the table; hint lists the closest', () => {
    const e = failure('c9 = Cirle(A, 2)');
    expect(e.kind).toBe('unknown_command');
    expect(e.col).toBe(6);
    expect(e.hint).toContain('Circle');
    const e2 = failure('M9 = Midpont(A, B)');
    expect(e2.kind).toBe('unknown_command');
    expect(e2.hint).toContain('Midpoint');
  });

  it('unknown_command: at most 3 suggestions in the hint', () => {
    const e = failure('c9 = Cirl(A, 2)');
    const named = COMMANDS.map((s) => s.name).filter((n) => (e.hint ?? '').includes(n));
    expect(named.length).toBeLessThanOrEqual(3);
  });

  it('unknown_command: a command used without arguments', () => {
    expect(failure('c9 = Circle').kind).toBe('unknown_command');
  });

  it('unknown_command: any PascalCase call that is not a command', () => {
    expect(failure('n1 = Foo(2)').kind).toBe('unknown_command');
  });

  it('a lower-case circle( is unknown_function with the PascalCase hint', () => {
    const e = failure('c9 = circle(A, 2)');
    expect(e.kind).toBe('unknown_function');
    expect(e.hint).toContain('Circle');
  });

  it('unknown_function: a lower-case call that is not a function; hint suggests the nearest built-in', () => {
    const e = failure('n1 = sinn(2)');
    expect(e.kind).toBe('unknown_function');
    expect(e.hint).toContain('sin');
    expect(failure('n1 = foo(2)').kind).toBe('unknown_function');
  });

  it('not_callable: a call on a Number, constant or Point', () => {
    const fig = newFig();
    const e = failure('n1 = a(2)', fig);
    expect(e.kind).toBe('not_callable');
    expect(e.fix).toContain('*');
    expect(e.fix).toContain('a');
    expect(failure('n1 = pi(2)').kind).toBe('not_callable');
    expect(failure('n1 = u(2)').kind).toBe('not_callable');
    expect(failure('n1 = m(2)').kind).toBe('not_callable');
  });

  it('not_callable: a Function object IS callable', () => {
    expect(check('n1 = f(2)').ok).toBe(true);
    expect(check('n1 = g(f(2))').ok).toBe(true);
  });

  it('a command name cannot be called like a function object, and an object name is not a command', () => {
    expect(failure('n1 = Distance').kind).toBe('unknown_command');
    expect(failure('n1 = a(A, B)').kind).toBe('not_callable');
  });

  it('3.7 a PascalCase name followed by ( looks up a command, never an object', () => {
    expect(failure('n1 = A(2)').kind).toBe('unknown_command');
  });

  it('unnamed commands that are actions are fine; unnamed object commands are not', () => {
    expect(check('Hide(A)').ok).toBe(true);
    expect(failure('Midpoint(A, B)').kind).toBe('unnamed_object');
  });
});

describe('language/design.md 3.11 the table: createCommandTable, formText, checkTable', () => {
  const table = createCommandTable(COMMANDS);

  it('names() are all command names, sorted', () => {
    const names = table.names();
    expect([...names]).toEqual([...COMMANDS.map((s) => s.name)].sort());
  });

  it('lookup is exact and case-sensitive; lookupFold ignores case', () => {
    expect(table.lookup('Circle')?.forms.length).toBe(3);
    expect(table.lookup('circle')).toBeUndefined();
    expect(table.lookup('Nope')).toBeUndefined();
    expect(table.lookupFold('circle')?.name).toBe('Circle');
    expect(table.lookupFold('CIRCLE')?.name).toBe('Circle');
    expect(table.lookupFold('nope')).toBeUndefined();
  });

  it('EMPTY_COMMANDS has no commands', () => {
    expect(EMPTY_COMMANDS.names()).toEqual([]);
    expect(EMPTY_COMMANDS.lookup('Circle')).toBeUndefined();
  });

  it('formText prints a form as in the catalogue', () => {
    const circle = table.lookup('Circle');
    expect(circle).toBeDefined();
    expect(formText('Circle', circle!.forms[0]!)).toBe('Circle(center: Point, radius: Number) -> Circle');
    expect(formText('Circle', circle!.forms[2]!)).toBe('Circle(a: Point, b: Point, c: Point) -> Circle');
    expect(formText('Distance', table.lookup('Distance')!.forms[0]!)).toBe('Distance(a: Point, b: Point) -> Number');
  });

  it('3.11 formText shows optional parameters in brackets', () => {
    expect(formText('Round3', table.lookup('Round3')!.forms[0]!)).toBe('Round3(x: Number, [digits: Number]) -> Number');
  });

  it('3.11 formText prints list and union types as written', () => {
    expect(formText('Seq', table.lookup('Seq')!.forms[0]!)).toContain('-> List<Number>');
    expect(formText('Pick', table.lookup('Pick')!.forms[0]!)).toContain('Number|Point');
  });

  it('checkTable: the test table has no ambiguous overloads', () => {
    expect(checkTable(table)).toEqual([]);
    expect(checkTable(COMMANDS)).toEqual([]);
  });

  const spec = (name: string, ...forms: ReturnType<typeof form>[]): CommandSpec => ({ name, kind: 'object', group: 't', forms });

  it('checkTable rejects two forms with identical parameter types', () => {
    const problems = checkTable([spec('Dup', form([p('a', 'Number')], 'Number'), form([p('b', 'Number')], 'Text'))]);
    expect(problems.length).toBeGreaterThanOrEqual(1);
    expect(problems[0]?.command).toBe('Dup');
    expect(problems[0]?.message.length).toBeGreaterThan(0);
  });

  it('checkTable rejects overlapping aliases where neither is more specific (Shape and Path)', () => {
    const problems = checkTable([spec('Over', form([p('a', 'Shape')], 'Number'), form([p('a', 'Path')], 'Text'))]);
    expect(problems.map((x) => x.command)).toContain('Over');
  });

  it('checkTable rejects overlapping unions where neither contains the other', () => {
    const problems = checkTable([spec('Un', form([p('a', 'Number|Point')], 'Number'), form([p('a', 'Point|Vector')], 'Text'))]);
    expect(problems.map((x) => x.command)).toContain('Un');
  });

  it('checkTable accepts a concrete type next to its alias or Any', () => {
    expect(checkTable([spec('Spec', form([p('a', 'Point')], 'Number'), form([p('a', 'Shape')], 'Text'))])).toEqual([]);
    expect(checkTable([spec('Spec', form([p('a', 'Number')], 'Number'), form([p('a', 'Any')], 'Text'))])).toEqual([]);
    expect(checkTable([spec('Spec', form([p('a', 'Number|Point')], 'Number'), form([p('a', 'Point')], 'Text'))])).toEqual([]);
  });

  it('checkTable accepts forms of different arity and disjoint types', () => {
    expect(checkTable([spec('Ok', form([p('a', 'Number')], 'Number'), form([p('a', 'Number'), p('b', 'Number')], 'Number'))])).toEqual([]);
    expect(checkTable([spec('Ok', form([p('a', 'Number')], 'Number'), form([p('a', 'Point')], 'Number'))])).toEqual([]);
    expect(checkTable([spec('Ok', form([p('a', 'List<Number>')], 'Number'), form([p('a', 'List<Point>')], 'Number'))])).toEqual([]);
  });

  it('checkTable names the offending command when one of several is ambiguous', () => {
    const problems = checkTable([
      ...COMMANDS,
      spec('Bad', form([p('a', 'Shape')], 'Number'), form([p('a', 'Path')], 'Text')),
    ]);
    expect(problems.map((x) => x.command)).toEqual(['Bad']);
  });
});

describe('language/design.md 3.1 results: an error is atomic', () => {
  it('a failing command line changes nothing', () => {
    const fig = newFig();
    const before = fig.names().slice();
    const r = fig.apply('c9 = Circle(A, 2, 3)');
    const e = errOf(r);
    expect(e.committed).toBe(false);
    expect(fig.names()).toEqual(before);
    expect(fig.lookup('c9')).toBeUndefined();
  });
});
