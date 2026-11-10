import { describe, expect, it } from 'vitest';
import { analyseLine } from '@incantly/kernel';
import { check, checked, emptyFig, errOf, failure, newFig, okValue } from './helpers';

describe('language/design.md 3.12 redefinition', () => {
  it('step 6: a = 5 on an existing free number is a redefinition that keeps the id', () => {
    const fig = newFig();
    const id = fig.lookup('a')?.id;
    const c = checked('a = 5', fig);
    expect(c.op).toBe('redefine');
    expect(c.existing).toBe(id);
    expect(c.free).toBe(true);
    okValue(fig.apply('a = 5'));
    expect(fig.lookup('a')?.id).toBe(id);
    expect(fig.valueOf('a')).toBe(5);
  });

  it('step 6: a free number becomes dependent when its new definition reads another object', () => {
    const fig = newFig();
    const c = checked('a = b + 1', fig);
    expect(c.op).toBe('redefine');
    expect(c.free).toBe(false);
    expect(c.reads.length).toBe(1);
    okValue(fig.apply('a = b + 1'));
    expect(fig.valueOf('a')).toBe(5);
    expect(fig.lookup('a')?.free).not.toBe(true);
  });

  it('step 6: a dependent number becomes free again with a literal', () => {
    const fig = newFig();
    okValue(fig.apply('a = b + 1'));
    const c = checked('a = 3', fig);
    expect(c.op).toBe('redefine');
    expect(c.free).toBe(true);
    expect(c.reads).toEqual([]);
  });

  it('step 6: dependent numbers lose their slider; a number that becomes free keeps no range', () => {
    const fig = newFig();
    okValue(fig.apply('sl = 3 in 0..10'));
    expect(fig.lookup('sl')?.slider).toBe(true);
    okValue(fig.apply('sl = a + 1'));
    expect(fig.lookup('sl')?.slider).not.toBe(true);
    okValue(fig.apply('sl = 7'));
    expect(fig.lookup('sl')?.slider).not.toBe(true);
  });

  it('step 6: a slider redefined with a new range stays a slider and keeps its id', () => {
    const fig = newFig();
    okValue(fig.apply('sl = 3 in 0..10'));
    const id = fig.lookup('sl')?.id;
    okValue(fig.apply('sl = 4 in 0..20'));
    expect(fig.lookup('sl')?.id).toBe(id);
    expect(fig.lookup('sl')?.slider).toBe(true);
  });

  it('step 1: the new definition may read objects that appear later in the figure', () => {
    const fig = newFig();
    okValue(fig.apply('early = 1'));
    okValue(fig.apply('late = 2'));
    const c = checked('early = late + 1', fig);
    expect(c.op).toBe('redefine');
    okValue(fig.apply('early = late + 1'));
    expect(fig.valueOf('early')).toBe(3);
  });

  it('a function can be redefined with another body and keeps its id', () => {
    const fig = newFig();
    const id = fig.lookup('f')?.id;
    okValue(fig.apply('f(x) = x^3'));
    expect(fig.lookup('f')?.id).toBe(id);
    expect(okValue(fig.apply('out = f(2)')).defined).toBe(true);
    expect(fig.valueOf('out')).toBe(8);
  });

  it('step 4: dependents are recomputed after a redefinition', () => {
    const fig = newFig();
    okValue(fig.apply('dep = a * 2'));
    expect(fig.valueOf('dep')).toBe(6);
    okValue(fig.apply('a = 10'));
    fig.recompute(); // the kernel's update pass; ScratchFigure runs it on request
    expect(fig.valueOf('dep')).toBe(20);
  });

  it('a redefinition with the same text is fine', () => {
    expect(check('a = 3').ok).toBe(true);
    expect(checked('A = (1, 2)').op).toBe('redefine');
  });

  it('step 3: type change is refused, naming both types, with a hint', () => {
    const fig = newFig();
    for (const [src, from, to] of [
      ['A = 3', 'Point', 'Number'],
      ['a = (1, 2)', 'Number', 'Point'],
      ['m = 5', 'Text', 'Number'],
      ['flag = 1', 'Bool', 'Number'],
      ['L = 3', 'List', 'Number'],
      ['f = 3', 'Function', 'Number'],
    ] as const) {
      const e = errOf(analyseLine(src, fig), src);
      expect(e.kind, src).toBe('type_change');
      expect(e.message, src).toContain(from);
      expect(e.message, src).toContain(to);
      expect(e.hint, src).toBeTruthy();
    }
  });

  it('step 3: Line to Line is fine, Line to Circle is type_change', () => {
    const fig = newFig();
    okValue(fig.apply('l9 = y == 2x + 1'));
    expect(check('l9 = x == 4', fig).ok).toBe(true);
    expect(failure('l9 = x^2 + y^2 == 4', fig).kind).toBe('type_change');
    expect(failure('l9 = y < x', fig).kind).toBe('type_change');
  });

  it('step 3: Function<R> must keep R; the parameter count may change', () => {
    const fig = newFig();
    okValue(fig.apply('pf(x) = (x, x)'));
    expect(failure('pf(x) = x', fig).kind).toBe('type_change');
    okValue(fig.apply('lonely(x) = x'));
    expect(check('lonely(x, y) = x + y', fig).ok).toBe(true);
  });

  it('step 3: the list element type must stay', () => {
    const fig = newFig();
    expect(failure('L = ["a", "b"]', fig).kind).toBe('type_change');
    expect(check('L = [7, 8, 9, 10]', fig).ok).toBe(true);
  });

  it('step 3: Number with an angle unit stays a Number', () => {
    expect(check('ang = 2', newFig()).ok).toBe(true);
  });

  it('step 2: a direct self-reference is a cycle', () => {
    const e = failure('a = a + 1');
    expect(e.kind).toBe('cycle');
    expect(JSON.stringify([e.related, e.path, e.message])).toContain('a');
  });

  it('step 2: a longer loop is a cycle with the path', () => {
    const fig = newFig();
    fig.define('b9', 'Number', 8, { source: 'b9 = a * 2', inputs: ['a'] });
    fig.define('c9', 'Number', 16, { source: 'c9 = b9 * 2', inputs: ['b9'] });
    fig.define('d9', 'Number', 32, { source: 'd9 = c9 * 2', inputs: ['c9'] });
    const e = errOf(analyseLine('a = d9 + 1', fig));
    expect(e.kind).toBe('cycle');
    const text = JSON.stringify([e.related, e.path]);
    for (const n of ['b9', 'c9', 'd9']) expect(text).toContain(n);
  });

  it('step 2: reading an object that does not depend on this one is fine', () => {
    const fig = newFig();
    fig.define('b9', 'Number', 8, { source: 'b9 = b * 2', inputs: ['b'] });
    expect(check('a = b9 + 1', fig).ok).toBe(true);
  });

  it('step 2: a failed redefinition changes nothing', () => {
    const fig = newFig();
    const before = fig.valueOf('a');
    const idBefore = fig.lookup('a')?.id;
    const e = errOf(fig.apply('a = a + 1'));
    expect(e.committed).toBe(false);
    expect(fig.valueOf('a')).toBe(before);
    expect(fig.lookup('a')?.id).toBe(idBefore);
    const e2 = errOf(fig.apply('a = (1, 2)'));
    expect(e2.kind).toBe('type_change');
    expect(fig.valueOf('a')).toBe(before);
  });

  it('step 4: breaks_dependents when a function loses a parameter its callers use', () => {
    const fig = newFig();
    okValue(fig.apply('g2(x) = f(x) + 1'));
    okValue(fig.apply('v9 = f(2)'));
    const e = errOf(fig.apply('f(x, y) = x * y'));
    expect(e.kind).toBe('breaks_dependents');
    expect(e.committed).toBe(false);
    const text = JSON.stringify(e);
    expect(text).toContain('g2');
    expect(text).toContain('v9');
    expect(e.hint).toBeTruthy();
    // Nothing changed.
    expect(fig.lookup('f')?.type.arity).toBe(1);
    expect(fig.valueOf('v9')).toBe(4);
  });

  it('step 4: a codomain change that a dependent cannot take is breaks_dependents or type_change, never silent', () => {
    const fig = newFig();
    okValue(fig.apply('g2(x) = f(x) + 1'));
    const r = fig.apply('f(x) = (x, x)');
    expect(r.ok).toBe(false);
  });

  it('step 4: a redefinition that keeps the signature does not break dependents', () => {
    const fig = newFig();
    okValue(fig.apply('g2(x) = f(x) + 1'));
    expect(check('f(x) = x + 100', fig).ok).toBe(true);
    okValue(fig.apply('f(x) = x + 100'));
    expect(okValue(fig.apply('out = g2(1)')).defined).toBe(true);
    expect(fig.valueOf('out')).toBe(102);
  });

  it('3.12 the redefinition of a name unknown to the figure is an add, not a redefinition', () => {
    const c = checked('brandnew = 1');
    expect(c.op).toBe('add');
    expect(c.existing).toBeUndefined();
  });

  it('3.12 redefinition of a state by a number or vice versa follows the same type rule', () => {
    const fig = emptyFig();
    okValue(fig.apply('th = state(0.6)'));
    expect(check('th = state(1)', fig).ok).toBe(true);
    expect(failure('th = (1, 2)', fig).kind).toBe('type_change');
  });

  it('README 16: transformed images use A_1, never A\'; a prime marks a rate', () => {
    const fig = emptyFig();
    okValue(fig.apply('A = (1, 2)'));
    okValue(fig.apply('A_1 = (3, 4)'));
    expect(fig.lookup('A_1')).toBeDefined();
    expect(check("A' = 3", fig).ok).toBe(false);
  });
});

describe('language/design.md 3.12 names: rename', () => {
  it('3.12 references are by object, so a program that reads the object keeps working after a redefinition', () => {
    const fig = newFig();
    okValue(fig.apply('mid = (A.x + B.x) / 2'));
    okValue(fig.apply('A = (11, 2)'));
    fig.recompute();
    expect(fig.valueOf('mid')).toBe(7.5);
  });
});
