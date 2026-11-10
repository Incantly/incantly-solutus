import { describe, expect, it } from 'vitest';
import { ScratchFigure, analyseLine, checkTable, compileLine, createCommandTable, createEnv, evaluate } from '@incantly/kernel';
import type { CommandSpec, LanguageError, ObjId, Undefined } from '@incantly/kernel';
import { COMMANDS, check, errOf, expectWellFormed, form, newFig, okValue, p } from './helpers';

/**
 * Tests for the spec-review items A1 to A4 (handoff/language/review.md, step 8 of docs/process/pipeline.md).
 * Built from docs/ and the public API only.
 *
 * Choices where the docs are silent (written down, as the brief asks):
 * - A1: docs/design/formula-language-and-kernel.md 6.6 and language/design.md 3.8 give an action no result type
 *   (`returns: null`) and only a whole line may be one (grammar rule `action`). An action in any other position is
 *   refused. The docs name no kind, so `type_mismatch`, `bad_argument` or `no_matching_form` are all accepted,
 *   and `bad_property_value` where the value is a style value.
 *   Otherwise the message or hint must say the command is an action.
 * - A3: `Function<Number>(2)` is read as a function of exactly two parameters (design 3.10: "a parameter count n").
 *   A one-parameter function does not satisfy it.
 * - A4: a problem is a `TableProblem` with `command` and `message` (the shape the existing checkTable tests rely on).
 *   Each message must name the command or carry it in `command`, and mention the thing that is wrong.
 */

function expectAction(e: LanguageError, src: string): void {
  expectWellFormed(e);
  expect(['type_mismatch', 'bad_argument', 'no_matching_form', 'bad_property_value'], `${src}: kind ${e.kind}`).toContain(e.kind);
  // A style value that is the wrong type for its property may be told as `bad_property_value` in the property's own words.
  if (e.kind !== 'bad_property_value') expect(`${e.message} ${e.hint ?? ''}`, `${src}: says what is wrong`).toMatch(/action/i);
}

// ---------------------------------------------------------------------------------------------
// A1. An action command used as a value
// ---------------------------------------------------------------------------------------------

describe('spec review A1: an action command used as a value is refused', () => {
  const ZAP: CommandSpec = {
    name: 'Zap',
    kind: 'action',
    group: 'style',
    forms: [form([p('n', 'Number')], null, 'an action with a Number parameter')],
  };
  const commands = [...COMMANDS, ZAP];
  const fig = (): ScratchFigure => newFig(commands);

  const REFUSED: [string, string][] = [
    // the three lines from the review
    ['definition', 'P2 = Hide(A)'],
    ['list item', 'x1 = [Hide(A)]'],
    ['nested action', 'Hide(Hide(A))'],
    // other value positions
    ['arithmetic operand', 'x1 = Hide(A) + 1'],
    ['unary operator', 'x1 = -Hide(A)'],
    ['logic operand', 'x1 = Hide(A) and true'],
    ['not operand', 'x1 = not Hide(A)'],
    ['comparison operand', 'x1 = Hide(A) == true'],
    ['parentheses', 'x1 = (Hide(A))'],
    ['condition of if', 'x1 = if(Hide(A), 1, 2)'],
    ['branch of if', 'x1 = if(flag, Hide(A), Hide(B))'],
    ['function body', 'h(r) = Hide(A)'],
    ['function body, inside a sum', 'h(r) = r + Hide(A)'],
    ['argument of a function call', 'x1 = abs(Hide(A))'],
    ['argument of an object command', 'x1 = Distance(A, Hide(B))'],
    ['argument of another action', 'Hide(Hide(A), B)'],
    ['body of a binder command', 'x1 = Seq(Hide(A), k, 1, 3)'],
    ['bound of a binder command', 'x1 = Seq(k, k, 1, Hide(A))'],
    ['range bound', 'x1 = 1 in 0..Hide(A)'],
    ['text interpolation', 'm9 = "{Hide(A)}"'],
    ['list in a list', 'x1 = [[Hide(A)], [Hide(B)]]'],
    ['style value on a definition', 'x1 = 1 with visible = Hide(A)'],
    ['style value on a restyle line', 'A with visible = Hide(B)'],
    ['style value, second key', 'A with color = red, opacity = Hide(B)'],
    ['another action, in a definition', 'y1 = Zap(1)'],
    ['another action, in a list', 'y1 = [Zap(1), Zap(2)]'],
    ['another action, in an argument', 'Hide(Zap(1))'],
    ['another action, in a function body', 'h(r) = Zap(r)'],
  ];

  it.each(REFUSED)('%s: "%s" is refused by analyseLine', (_where, src) => {
    expectAction(errOf(check(src, fig()), src), src);
  });

  it.each(REFUSED)('%s: "%s" is refused by apply and changes nothing', (_where, src) => {
    const f = fig();
    const before = f.names().slice();
    const e = errOf(f.apply(src), src);
    expectAction(e, src);
    expect(e.committed).toBe(false);
    expect(f.names()).toEqual(before);
  });

  it('the new name of a refused definition does not exist afterwards', () => {
    const f = fig();
    errOf(f.apply('P2 = Hide(A)'));
    expect(f.lookup('P2')).toBeUndefined();
    expect(f.names()).not.toContain('P2');
  });

  it('a refused redefinition leaves the old object as it was', () => {
    const f = fig();
    const before = f.valueOf('a');
    errOf(f.apply('a = Hide(A)'));
    expect(f.valueOf('a')).toBe(before);
    expect(f.lookup('a')?.type).toBeDefined();
  });

  it('the error marks the action call, not the start of the line', () => {
    const e = errOf(check('x1 = [Hide(A)]', fig()));
    expect(e.line).toBe(1);
    expect(e.col).toBeGreaterThan(1);
    expect(e.col).toBeLessThanOrEqual(7);
    expect(e.endCol).toBeGreaterThan(e.col);
    expect(e.token).toContain('Hide');
  });

  it('controls: an action on a line of its own is still accepted', () => {
    expect(check('Hide(A)', fig()).ok).toBe(true);
    expect(check('Hide(A, B, s)', fig()).ok).toBe(true);
    expect(check('Zap(3)', fig()).ok).toBe(true);
  });

  it('controls: an action line has no result type and runs through apply', () => {
    const f = fig();
    expect(f.apply('Hide(A)').ok).toBe(true);
    expect(f.lookup('Hide')).toBeUndefined();
  });

  it('controls: an object command is still a value anywhere', () => {
    const f = fig();
    expect(check('x1 = [Distance(A, B)]', f).ok).toBe(true);
    expect(check('x1 = Distance(A, B) + 1', f).ok).toBe(true);
    expect(check('Hide(Midpoint(A, B))', f).ok).toBe(true);
  });

  it('an action is not a value in a figure built without the table either: the same line has the same answer on a second figure', () => {
    const e1 = errOf(check('P2 = Hide(A)', fig()));
    const e2 = errOf(check('P2 = Hide(A)', fig()));
    expect(e2.fingerprint).toBe(e1.fingerprint);
    expect(e2.message).toBe(e1.message);
  });
});

// ---------------------------------------------------------------------------------------------
// A2. The undefined cascade link is `cause`, never `via`
// ---------------------------------------------------------------------------------------------

describe('spec review A2: undefined values carry their cascade link as `cause`', () => {
  /** Reads `cause` without needing the field to exist in the declared type, so this file compiles before and after the rename. */
  const causeOf = (o: object): ObjId | undefined => (o as { cause?: ObjId }).cause;
  const causePart = (o: object): { cause?: ObjId } => {
    const c = causeOf(o);
    return c === undefined ? {} : { cause: c };
  };

  function evalOut(fig: ScratchFigure, src: string) {
    const line = okValue(analyseLine(src, fig));
    const compiled = okValue(compileLine(line));
    return evaluate(compiled, fig.env(line.slots));
  }

  it('contracts/values.ts and README decision 2: Undefined is { reason, detail?, cause? }', () => {
    // A value-level check of the contract: a result built by the language can be assigned to the shared shape.
    const fig = newFig();
    okValue(fig.apply('pu = sqrt(-1)'));
    const pu = fig.lookup('pu');
    const r = evalOut(fig, 'out = pu + 1');
    expect(r.defined).toBe(false);
    if (r.defined) return;
    const asShared: Undefined = { reason: r.reason, ...(r.detail !== undefined ? { detail: r.detail } : {}), ...causePart(r) };
    expect(asShared.cause).toBe(pu?.id);
  });

  it('evaluate() of a line downstream of an undefined object gives input_undefined with `cause` naming the input', () => {
    const fig = newFig();
    okValue(fig.apply('pu = sqrt(-1)'));
    const pu = fig.lookup('pu');
    expect(pu).toBeDefined();
    const r = evalOut(fig, 'out = pu + 1');
    expect(r.defined).toBe(false);
    if (r.defined) return;
    expect(r.reason).toBe('input_undefined');
    expect(causeOf(r)).toBe(pu?.id);
  });

  it('evaluate() results never carry a `via` field', () => {
    const fig = newFig();
    okValue(fig.apply('pu = sqrt(-1)'));
    const r = evalOut(fig, 'out = pu + 1');
    expect(Object.keys(r)).not.toContain('via');
    expect('via' in r).toBe(false);
  });

  it('an undefined that starts here (no upstream object) has no cause', () => {
    const fig = newFig();
    const r = evalOut(fig, 'out = sqrt(-1)');
    expect(r.defined).toBe(false);
    if (r.defined) return;
    expect(r.reason).toBe('out_of_domain');
    expect(causeOf(r)).toBeUndefined();
  });

  it('through a chain the cause is an undefined object upstream: the nearest input or the root, never an unrelated one', () => {
    // The docs differ on which: language/errors.md 8 says "nearest undefined input"; kernel/design.md section 5 says
    // the input's own cause when inherited, so `cause` names a root. Both readings are accepted. The field must be
    // `cause`, must name one of the undefined objects on the chain, and must not name a defined one.
    const fig = newFig();
    okValue(fig.apply('u1 = sqrt(-1)'));
    okValue(fig.apply('u2 = u1 + 1'));
    okValue(fig.apply('u3 = u2 * 2'));
    const ids = ['u1', 'u2', 'u3'].map((n) => fig.lookup(n)?.id);
    const r = evalOut(fig, 'out = u3 - 1');
    expect(r.defined).toBe(false);
    if (r.defined) return;
    expect(r.reason).toBe('input_undefined');
    expect(ids).toContain(causeOf(r));
    expect(causeOf(r)).not.toBe(fig.lookup('a')?.id);
  });

  it('the env keeps the link in `cause`, not in `via`', () => {
    const fig = newFig();
    okValue(fig.apply('pu = sqrt(-1)'));
    const pu = fig.lookup('pu');
    const line = okValue(analyseLine('out = pu + 1', fig));
    const compiled = okValue(compileLine(line));
    const env = fig.env(line.slots);
    evaluate(compiled, env);
    expect(causeOf(env)).toBe(pu?.id);
    expect('via' in env).toBe(false);
  });

  it('createEnv gives an Env with no cause and no via', () => {
    const env = createEnv({ slots: 4 });
    expect(causeOf(env)).toBeUndefined();
    expect('via' in env).toBe(false);
  });

  it('a function value called with an undefined input reports the reason and the cause the same way', () => {
    const fig = newFig();
    okValue(fig.apply('pu = sqrt(-1)'));
    const r = evalOut(fig, 'out = f(pu)');
    expect(r.defined).toBe(false);
    if (r.defined) return;
    expect(r.reason).toBe('input_undefined');
    expect(causeOf(r)).toBe(fig.lookup('pu')?.id);
    expect('via' in r).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// A3. Function2
// ---------------------------------------------------------------------------------------------

/** Matches the broken sentence from the review: an empty expected type ("should be a , but ..."). */
const EMPTY_EXPECTED = /should be an?\s*(,|but\b)/i;

describe('spec review A3: Function2 and Function<Number>(2) parameters', () => {
  const TWO: CommandSpec[] = [
    ...COMMANDS,
    { name: 'Integral2', kind: 'object', group: 'calculus', forms: [form([p('g', 'Function2')], 'Number', 'double integral')] },
    { name: 'Slope2', kind: 'object', group: 'calculus', forms: [form([p('g', 'Function<Number>(2)')], 'Number', 'slope of a surface')] },
    {
      name: 'Plane2',
      kind: 'object',
      group: 'calculus',
      forms: [form([p('g', 'Function2'), p('at', 'Point')], 'Number', 'tangent plane height')],
    },
    {
      name: 'Area2',
      kind: 'object',
      group: 'calculus',
      forms: [form([p('g', 'Function<Number>(2)'), p('x0', 'Number'), p('x1', 'Number')], 'Number', 'area')],
    },
  ];
  const fig = (): ScratchFigure => {
    const f = newFig(TWO);
    okValue(f.apply('g2(x, y) = x * y'));
    okValue(f.apply('g3(x, y) = x + y + 1'));
    return f;
  };

  it('README decision 5: a user function g(x, y) = ... satisfies a Function2 parameter', () => {
    const f = fig();
    const r = f.apply('i1 = Integral2(g2)');
    expect(r.ok, r.ok ? '' : r.message).toBe(true);
    expect(check('i1 = Integral2(g3)', f).ok).toBe(true);
  });

  it('a Function<Number>(2) parameter type parses and is satisfied by g(x, y) = ...', () => {
    const f = fig();
    const r = f.apply('s1 = Slope2(g2)');
    expect(r.ok, r.ok ? '' : r.message).toBe(true);
    expect(check('s1 = Slope2(g3)', f).ok).toBe(true);
  });

  it('Function2 and Function<Number>(2) accept the same functions', () => {
    const f = fig();
    for (const fn of ['g2', 'g3']) {
      expect(check(`i1 = Integral2(${fn})`, f).ok, fn).toBe(true);
      expect(check(`s1 = Slope2(${fn})`, f).ok, fn).toBe(true);
    }
  });

  it('the result type of a command with a Function2 parameter is the form return type', () => {
    const f = fig();
    const c = okValue(check('i1 = Integral2(g2)', f));
    expect(c.type?.k).toBe('Number');
  });

  it('a Function2 parameter next to other parameters, positional and named', () => {
    const f = fig();
    expect(check('h1 = Plane2(g2, A)', f).ok).toBe(true);
    expect(check('h1 = Plane2(at = A, g = g2)', f).ok).toBe(true);
    expect(check('a1 = Area2(g3, 0, 1)', f).ok).toBe(true);
  });

  it('a function written with two parameters of other names also fits', () => {
    const f = fig();
    okValue(f.apply('q(m1, m2) = m1 - m2'));
    expect(check('i1 = Integral2(q)', f).ok).toBe(true);
    expect(check('s1 = Slope2(q)', f).ok).toBe(true);
  });

  it('a one-parameter function does not fit Function2 or Function<Number>(2)', () => {
    const f = fig();
    for (const src of ['i1 = Integral2(f)', 's1 = Slope2(f)']) {
      const e = errOf(check(src, f), src);
      expectWellFormed(e);
      expect(['type_mismatch', 'no_matching_form', 'bad_argument'], src).toContain(e.kind);
    }
  });

  it('a Number, a Point, a list or a Text does not fit Function2', () => {
    const f = fig();
    for (const arg of ['a', 'A', 'L', 'm', 'flag']) {
      const src = `i1 = Integral2(${arg})`;
      const e = errOf(check(src, f), src);
      expect(['type_mismatch', 'no_matching_form', 'bad_argument'], src).toContain(e.kind);
    }
  });

  it('a Function<Point> does not fit Function2', () => {
    const f = fig();
    okValue(f.apply('cp(t) = (cos(t), sin(t))'));
    errOf(check('i1 = Integral2(cp)', f));
  });

  it('a two-parameter function is still a Function<Number> object of two parameters elsewhere', () => {
    const f = fig();
    expect(f.lookup('g2')?.type).toBeDefined();
    expect(check('v1 = g2(2, 3)', f).ok).toBe(true);
    expect(f.valueOf('g2')).toBeDefined();
  });

  it('the table with Function2 and Function<Number>(2) parameters has no problems', () => {
    expect(checkTable(TWO)).toEqual([]);
    expect(checkTable(createCommandTable(TWO))).toEqual([]);
  });

  it('no error message says "should be a , but" (an empty expected type)', () => {
    const f = fig();
    okValue(f.apply('cp(t) = (cos(t), sin(t))'));
    const lines = [
      'i1 = Integral2(f)',
      'i1 = Integral2(a)',
      'i1 = Integral2(A)',
      'i1 = Integral2(cp)',
      'i1 = Integral2(L)',
      'i1 = Integral2(1, 2)',
      'i1 = Integral2()',
      's1 = Slope2(f)',
      's1 = Slope2(a)',
      's1 = Slope2(cp)',
      's1 = Slope2(m)',
      's1 = Slope2(g2, g3)',
      'h1 = Plane2(f, A)',
      'h1 = Plane2(g2, a)',
      'a1 = Area2(f, 0, 1)',
      'a1 = Area2(g2, 0)',
    ];
    for (const src of lines) {
      const r = f.apply(src);
      if (r.ok) continue;
      expect(r.message, src).not.toMatch(EMPTY_EXPECTED);
      expect(r.hint ?? '', src).not.toMatch(EMPTY_EXPECTED);
      expect(r.message, src).not.toMatch(/should be an?\s*$/i);
      for (const ex of r.expected) expect(ex.length, `${src}: an empty expected entry`).toBeGreaterThan(0);
      for (const fm of r.forms) expect(fm.length, `${src}: an empty form`).toBeGreaterThan(0);
      for (const pr of (r as LanguageError).problems ?? []) {
        expect(JSON.stringify(pr), `${src}: a problem with an empty field`).not.toMatch(/:""/);
      }
    }
  });

  it('no error message says "should be a , but" for a table whose parameter type is a function type', () => {
    const tables: CommandSpec[][] = [
      [{ name: 'Fa', kind: 'object', group: 't', forms: [form([p('g', 'Function<Number>')], 'Number')] }],
      [{ name: 'Fa', kind: 'object', group: 't', forms: [form([p('g', 'Function<Point>')], 'Number')] }],
      [{ name: 'Fa', kind: 'object', group: 't', forms: [form([p('g', 'Function<Number>(2)')], 'Number')] }],
      [{ name: 'Fa', kind: 'object', group: 't', forms: [form([p('g', 'Function<Number>(3)')], 'Number')] }],
      [{ name: 'Fa', kind: 'object', group: 't', forms: [form([p('g', 'Function2')], 'Number')] }],
      [{ name: 'Fa', kind: 'object', group: 't', forms: [form([p('g', 'List<Function<Number>>')], 'Number')] }],
    ];
    for (const specs of tables) {
      const f = new ScratchFigure({ commands: createCommandTable(specs) });
      okValue(f.apply('f(x) = x^2'));
      okValue(f.apply('g2(x, y) = x * y'));
      okValue(f.apply('cp(t) = (cos(t), sin(t))'));
      okValue(f.apply('a = 3'));
      for (const arg of ['f', 'g2', 'cp', 'a', '[f]', '[g2]', '"s"', '(1, 2)']) {
        const src = `r9 = Fa(${arg})`;
        const r = f.apply(src);
        if (r.ok) continue;
        const where = `${specs[0]?.forms[0]?.params[0]?.type}: ${src}`;
        expect(r.message, where).not.toMatch(EMPTY_EXPECTED);
        expect(r.hint ?? '', where).not.toMatch(EMPTY_EXPECTED);
        for (const ex of r.expected) expect(ex.length, where).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// A4. The command table is validated
// ---------------------------------------------------------------------------------------------

describe('spec review A4: checkTable refuses a malformed table, naming the command and the problem', () => {
  const obj = (name: string, ...forms: ReturnType<typeof form>[]): CommandSpec => ({ name, kind: 'object', group: 't', forms });

  /** The problems for one bad command added to the good test table. Only that command may be named. */
  function problemsFor(bad: CommandSpec | CommandSpec[]) {
    return checkTable([...COMMANDS, ...(Array.isArray(bad) ? bad : [bad])]);
  }

  function expectProblem(bad: CommandSpec | CommandSpec[], command: string, mentions: RegExp, label: string): void {
    const problems = problemsFor(bad);
    expect(problems.length, `${label}: at least one problem`).toBeGreaterThanOrEqual(1);
    const mine = problems.filter((x) => x.command === command);
    expect(mine.length, `${label}: a problem names ${command}; got ${JSON.stringify(problems.map((x) => x.command))}`).toBeGreaterThanOrEqual(1);
    expect(
      mine.some((x) => mentions.test(x.message)),
      `${label}: a message says what is wrong (${String(mentions)}); got ${JSON.stringify(mine.map((x) => x.message))}`,
    ).toBe(true);
    // the good commands are not blamed
    for (const x of problems) expect(x.command, label).toBe(command);
    for (const x of mine) expect(x.message.length, label).toBeGreaterThan(0);
  }

  it('control: the good test table has no problems, as a spec list and as a built table', () => {
    expect(checkTable(COMMANDS)).toEqual([]);
    expect(checkTable(createCommandTable(COMMANDS))).toEqual([]);
  });

  describe('unknown parameter types', () => {
    it('a plain unknown type', () => {
      expectProblem(obj('Bad1', form([p('a', 'Fnord')], 'Number')), 'Bad1', /Fnord/, 'parameter Fnord');
    });

    it('an unknown type inside List<>', () => {
      expectProblem(obj('Bad2', form([p('a', 'List<Fnord>')], 'Number')), 'Bad2', /Fnord/, 'List<Fnord>');
    });

    it('an unknown type in a union', () => {
      expectProblem(obj('Bad3', form([p('a', 'Number|Fnord')], 'Number')), 'Bad3', /Fnord/, 'Number|Fnord');
    });

    it('an unknown type in Function<>', () => {
      expectProblem(obj('Bad4', form([p('a', 'Function<Fnord>')], 'Number')), 'Bad4', /Fnord/, 'Function<Fnord>');
    });

    it('an unknown type in the rest parameter', () => {
      expectProblem(obj('Bad5', form([p('a', 'Number')], 'Number', 'rest', { rest: p('more', 'Fnord') })), 'Bad5', /Fnord/, 'rest Fnord');
    });

    it('an unknown type in a second form only', () => {
      expectProblem(
        obj('Bad6', form([p('a', 'Number')], 'Number'), form([p('a', 'Point'), p('b', 'Fnord')], 'Number')),
        'Bad6',
        /Fnord/,
        'second form',
      );
    });

    it('a type name with the wrong case is unknown (names are case-sensitive)', () => {
      expectProblem(obj('Bad7', form([p('a', 'number')], 'Number')), 'Bad7', /number/, 'number');
    });

    it('an empty type text', () => {
      const problems = problemsFor(obj('Bad8', form([p('a', '')], 'Number')));
      expect(problems.map((x) => x.command)).toContain('Bad8');
    });

    it('control: every core type, alias, list, union and function type is accepted', () => {
      const types = [
        'Number', 'Bool', 'Text', 'Point', 'Vector', 'Segment', 'Ray', 'Line', 'Circle', 'Arc', 'Polygon', 'Curve', 'Region',
        'Color', 'Any', 'Shape', 'Path', 'Curvelike', 'Scalar', 'Relation', 'Function<Number>', 'Function<Point>',
        'List<Number>', 'List<Point>', 'List<List<Number>>', 'Number|Point', 'List<Shape>',
      ];
      for (const t of types) {
        expect(checkTable([obj('Good', form([p('a', t)], 'Number'))]), t).toEqual([]);
      }
    });
  });

  describe('unknown return types', () => {
    it('a plain unknown return type', () => {
      expectProblem(obj('Bad9', form([p('a', 'Number')], 'Banana')), 'Bad9', /Banana/, 'returns Banana');
    });

    it('an unknown type inside a list return type', () => {
      expectProblem(obj('Bad10', form([p('a', 'Number')], 'List<Banana>')), 'Bad10', /Banana/, 'returns List<Banana>');
    });

    it('an unknown type in a tuple return type', () => {
      expectProblem(obj('Bad11', form([p('a', 'Point')], ['Point', 'Banana'])), 'Bad11', /Banana/, 'returns [Point, Banana]');
    });

    it('control: null (an action), a tuple and a list are fine as return types', () => {
      expect(checkTable([{ name: 'Act', kind: 'action', group: 't', forms: [form([p('a', 'Point')], null)] }])).toEqual([]);
      expect(checkTable([obj('Two', form([p('a', 'Circle'), p('b', 'Circle')], ['Point', 'Point']))])).toEqual([]);
      expect(checkTable([obj('Lst', form([p('a', 'Number')], 'List<Point>'))])).toEqual([]);
    });
  });

  describe('duplicate parameter names', () => {
    it('two parameters with the same name in one form', () => {
      expectProblem(obj('Bad12', form([p('f', 'Number'), p('f', 'Point')], 'Number')), 'Bad12', /\bf\b/, 'duplicate f');
    });

    it('the same name with the same type', () => {
      expectProblem(obj('Bad13', form([p('a', 'Number'), p('a', 'Number')], 'Number')), 'Bad13', /\ba\b/, 'duplicate a');
    });

    it('a rest parameter with the name of a fixed parameter', () => {
      expectProblem(
        obj('Bad14', form([p('a', 'Number')], 'Number', 'rest', { rest: p('a', 'Number') })),
        'Bad14',
        /\ba\b/,
        'rest repeats a',
      );
    });

    it('control: the same names in different forms are fine', () => {
      expect(checkTable([obj('Fine', form([p('a', 'Number')], 'Number'), form([p('a', 'Point')], 'Number'))])).toEqual([]);
    });
  });

  describe('duplicate command names', () => {
    it('two commands with the same name and different forms', () => {
      expectProblem(
        [obj('Twin', form([p('a', 'Number')], 'Number')), obj('Twin', form([p('a', 'Point')], 'Number'))],
        'Twin',
        /duplicate|twice|more than once|already|same name/i,
        'Twin twice',
      );
    });

    it('a command with the name of one already in the table', () => {
      expectProblem(obj('Circle', form([p('a', 'Number')], 'Number')), 'Circle', /duplicate|twice|more than once|already|same name/i, 'Circle again');
    });

    it('createCommandTable does not throw on duplicate names', () => {
      expect(() => createCommandTable([obj('Twin', form([p('a', 'Number')], 'Number')), obj('Twin', form([p('a', 'Point')], 'Number'))])).not.toThrow();
    });
  });

  describe('lower-case command names', () => {
    it('a command called lower', () => {
      expectProblem(obj('lower', form([p('a', 'Number')], 'Number')), 'lower', /upper|capital|first letter|case/i, 'lower');
    });

    it('a command that starts with a digit, an underscore or a symbol', () => {
      for (const name of ['9Lives', '_Hidden', 'élan']) {
        const problems = problemsFor(obj(name, form([p('a', 'Number')], 'Number')));
        expect(problems.map((x) => x.command), name).toContain(name);
      }
    });

    it('a command with a space in its name', () => {
      const problems = problemsFor(obj('Two Words', form([p('a', 'Number')], 'Number')));
      expect(problems.map((x) => x.command)).toContain('Two Words');
    });

    it('an empty command name', () => {
      expect(problemsFor(obj('', form([p('a', 'Number')], 'Number'))).length).toBeGreaterThanOrEqual(1);
    });

    it('control: PascalCase names with digits are fine', () => {
      expect(checkTable([obj('Round3', form([p('a', 'Number')], 'Number'))])).toEqual([]);
    });
  });

  describe('commands with no forms', () => {
    it('an object command with no forms', () => {
      expectProblem(obj('Empty1'), 'Empty1', /form/i, 'no forms');
    });

    it('an action command with no forms', () => {
      expectProblem({ name: 'Empty2', kind: 'action', group: 't', forms: [] }, 'Empty2', /form/i, 'action with no forms');
    });
  });

  describe('binder parameters with no body', () => {
    it('a binder and no body parameter', () => {
      expectProblem(
        obj('Bad15', form([p('k', 'Number', { kind: 'binder' }), p('from', 'Number'), p('to', 'Number')], 'List<Number>')),
        'Bad15',
        /body|binder/i,
        'binder without body',
      );
    });

    it('a binder only', () => {
      expectProblem(obj('Bad16', form([p('k', 'Number', { kind: 'binder' })], 'Number')), 'Bad16', /body|binder/i, 'binder only');
    });

    it('the problem names the binder parameter', () => {
      const problems = problemsFor(obj('Bad17', form([p('idx', 'Number', { kind: 'binder' }), p('n', 'Number')], 'Number')));
      expect(problems.some((x) => x.command === 'Bad17' && /idx/.test(x.message))).toBe(true);
    });

    it('control: a binder with a body is fine (the Seq form in the test table)', () => {
      expect(checkTable(COMMANDS.filter((c) => c.name === 'Seq'))).toEqual([]);
    });
  });

  describe('all at once', () => {
    it('several malformed commands each get their own problem, and checkTable does not throw', () => {
      const bad: CommandSpec[] = [
        obj('Bad1', form([p('a', 'Fnord')], 'Number')),
        obj('Bad9', form([p('a', 'Number')], 'Banana')),
        obj('Bad12', form([p('f', 'Number'), p('f', 'Point')], 'Number')),
        obj('lower', form([p('a', 'Number')], 'Number')),
        obj('Empty1'),
        obj('Bad15', form([p('k', 'Number', { kind: 'binder' })], 'Number')),
      ];
      let problems: ReturnType<typeof checkTable> = [];
      expect(() => {
        problems = problemsFor(bad);
      }).not.toThrow();
      const named = new Set(problems.map((x) => x.command));
      for (const b of bad) expect(named.has(b.name), `${b.name} is named`).toBe(true);
      expect(named.size).toBe(bad.length);
    });
  });
});
