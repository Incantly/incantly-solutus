import { describe, expect, it } from 'vitest';
import { ScratchFigure, analyseLine, compileLine, createEnv, evaluate } from '@incantly/kernel';
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
