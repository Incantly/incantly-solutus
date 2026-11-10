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
