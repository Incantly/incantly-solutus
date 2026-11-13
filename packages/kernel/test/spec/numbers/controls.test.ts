/**
 * Buttons and dropdowns (controls-scripting/design.md 3.1, 3.8, 5, 3.9; errors.md 2 and 3).
 *
 * Silent-doc choices (written down):
 *  - A start index above the option count is clamped to the count (the rule for changed options), not an error.
 *  - A caption that matches no option is an error from the API.
 *  - A literal of 1000 or 1001 options does not fit the 2000-character line limit, so the option-count limit is not tested.
 *  - Colour and built-in function names are not objects in this build, so the dropdown tests use text, numbers and function
 *    objects (`f1(x) = x^2`).
 */
import { describe, expect, it } from 'vitest';
import {
  NUMBERS_LIMITS,
  buttonLabelOf,
  captionsOf,
  choiceCountOf,
  choiceIndexOf,
  choiceOptionsOf,
  choiceValueOf,
  countControls,
  onControlEvent,
  setChoiceCaption,
  setChoiceIndex,
  summarizeControl,
} from '@incantly/kernel';
import type { ControlEvent } from '@incantly/kernel';
import { T, bad, build, fig, newFigure, num, oid, ok, reject } from './helpers';

const D = ['d = Choice(["sin", "cos", "tan"], 2)'];

describe('3.1 Button', () => {
  it('go = Button("Reset") makes a Button with no value of its own', () => {
    const f = fig('go = Button("Reset")');
    expect(f.get('go')?.type).toBe('Button');
  });
  it('the label is the argument, and the summary names it', () => {
    const f = fig('go = Button("Reset")');
    expect(buttonLabelOf(f, 'go')).toBe('Reset');
    expect(summarizeControl(f, 'go')).toBe('button "Reset"');
  });
  it('Button with no argument is arg_count', () => {
    reject(fig([]), 'go = Button()', 'arg_count');
  });
});

describe('3.1 and 3.8 Choice: a dropdown over a list', () => {
  it('the index starts at 1 when none is given', () => {
    expect(choiceIndexOf(fig('d = Choice(["sin", "cos", "tan"])'), 'd')).toBe(1);
  });
  it('the start index is used, and value, index and count follow it', () => {
    const f = fig(D);
    expect(choiceIndexOf(f, 'd')).toBe(2);
    expect(choiceValueOf(f, 'd')).toBe('cos');
    expect(choiceCountOf(f, 'd')).toBe(3);
    expect(choiceOptionsOf(f, 'd')).toEqual(['sin', 'cos', 'tan']);
  });
  it('a start index above the count is clamped to the count', () => {
    expect(choiceIndexOf(fig('d = Choice(["a", "b"], 5)'), 'd')).toBe(2);
  });
  it('d.count and d.index can be read in an expression', () => {
    const f = fig([...D, 'n = d.count', 'i = d.index']);
    expect(num(f, 'n')).toBe(3);
    expect(num(f, 'i')).toBe(2);
  });
  it('d.value can be read in an expression and has the option type', () => {
    const f = fig(['d = Choice([10, 20, 30], 2)', 'v = d.value * 2']);
    expect(num(f, 'v')).toBe(40);
  });
  it('function objects as options: h(x) = g.value(x)', () => {
    const f = fig(['f1(x) = x^2', 'f2(x) = x + 1', 'g = Choice([f1, f2], 2)', 'h(x) = g.value(x)', 'r1 = h(3)']);
    expect(num(f, 'r1')).toBe(4);
  });
  it('the options follow a list object live', () => {
    const f = fig(['L = [5, 6, 7]', 'd = Choice(L, 3)']);
    expect(choiceValueOf(f, 'd')).toBe(7);
    ok(f.apply('SetValue(L, 3, 9)'));
    expect(choiceValueOf(f, 'd')).toBe(9);
  });
  it('the index is clamped when the options shrink', () => {
    const f = fig(['L = [5, 6, 7]', 'd = Choice(L, 3)']);
    ok(f.apply('L = [5]'));
    expect(choiceIndexOf(f, 'd')).toBe(1);
    expect(choiceValueOf(f, 'd')).toBe(5);
  });
  it('captions come from with captions = [...]', () => {
    const f = fig(['d = Choice(["red", "green", "blue"])', 'd with captions = ["Red", "Green", "Blue"]']);
    expect(captionsOf(f, 'd')).toEqual(['Red', 'Green', 'Blue']);
  });
  it('the summary reads: Red (1 of 3: red, green, blue)', () => {
    const f = fig(['d = Choice(["red", "green", "blue"])', 'd with captions = ["Red", "Green", "Blue"]']);
    expect(summarizeControl(f, 'd')).toBe('Red (1 of 3: red, green, blue)');
  });
});

describe('3.1 bad_choice', () => {
  it('an empty literal list is refused (bad_choice; the language may say empty_list_type first)', () => {
    expect(['bad_choice', 'empty_list_type']).toContain(String(reject(fig([]), 'd = Choice([])').kind));
  });
  it('mixed option types are refused (bad_choice; the list literal may say type_mismatch first)', () => {
    const e = reject(fig([]), 'd = Choice([1, "two"])');
    expect(['bad_choice', 'type_mismatch']).toContain(String(e.kind));
  });
  it('a failed Choice creates no object', () => {
    const f = fig([]);
    reject(f, 'd = Choice([])');
    reject(f, 'd = Choice([1, "two"])');
    expect(f.get('d')).toBeUndefined();
  });
});

describe('3.5 and 3.8 selecting', () => {
  it('SetValue(d, 3) selects by index', () => {
    const f = fig(D);
    ok(f.apply('SetValue(d, 3)'));
    expect(choiceValueOf(f, 'd')).toBe('tan');
  });
  it('SetValue(d, 9) with a constant index is bad_index at definition time', () => {
    bad(fig(D).apply('SetValue(d, 9)'), 'bad_index');
  });
  it('SetValue(d, "tan") selects by caption', () => {
    const f = fig(D);
    ok(f.apply('SetValue(d, "tan")'));
    expect(choiceIndexOf(f, 'd')).toBe(3);
  });
  it('setChoiceIndex selects, and one pick is one undo entry', () => {
    const f = fig(D);
    const depth = f.undoInfo().depth;
    expect(setChoiceIndex(f, oid(f, 'd'), 3).ok).toBe(true);
    expect(choiceValueOf(f, 'd')).toBe('tan');
    expect(f.undoInfo().depth).toBe(depth + 1);
    ok(f.undo());
    expect(choiceIndexOf(f, 'd')).toBe(2);
  });
  it('setChoiceIndex out of range is bad_index and changes nothing', () => {
    const f = fig(D);
    bad(setChoiceIndex(f, oid(f, 'd'), 9), 'bad_index');
    expect(choiceIndexOf(f, 'd')).toBe(2);
  });
  it('setChoiceCaption selects by caption; an unknown caption is an error', () => {
    const f = fig(D);
    expect(setChoiceCaption(f, oid(f, 'd'), 'sin').ok).toBe(true);
    expect(choiceIndexOf(f, 'd')).toBe(1);
    expect(setChoiceCaption(f, oid(f, 'd'), 'nope').ok).toBe(false);
  });
  it('a learner pick tells the host: change, the value and the 1-based index', () => {
    const f = fig(D);
    const seen: ControlEvent[] = [];
    onControlEvent(f, (e) => seen.push(e));
    setChoiceIndex(f, oid(f, 'd'), 3, { by: 'learner' });
    expect(seen).toContainEqual(expect.objectContaining({ event: 'change', name: 'd', type: 'Choice', value: 'tan', index: 3, by: 'learner' }));
  });
});

describe('3.9 limits on controls', () => {
  it('NUMBERS_LIMITS holds the documented numbers', () => {
    expect(NUMBERS_LIMITS).toMatchObject({
      sliderSteps: 1e6,
      minStepOfRange: 1e-12,
      animating: 500,
      labelLength: 120,
      stepsPerHandler: 50,
      handlersPerFigure: 200,
      stepsPerRun: 2000,
      loopIterations: 1000,
      clickDepth: 8,
      inputLength: 500,
      inputNodes: 2000,
      inputDepth: 16,
      choiceOptions: 1000,
      controlsPerFigure: 100,
      queuedEvents: 20,
    });
  });
  it('countControls counts buttons, choices and inputs', () => {
    const f = fig(['r = 2', 'go = Button("Go")', ...D, 'q = Input(r, "r =")', 'a = 3']);
    expect(countControls(f)).toBe(3);
  });
  it('the 100th control is accepted and the 101st is a limit error', () => {
    const f = newFigure();
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) lines.push(`b${i} = Button("B${i}")`);
    build(f, lines);
    expect(countControls(f)).toBe(100);
    const e = reject(f, 'b100 = Button("B100")', 'limit');
    expect(JSON.stringify(e.params)).toContain('100');
  }, T);
  it('the limit counts buttons, dropdowns and input boxes together', () => {
    const f = newFigure();
    const lines = ['r = 1'];
    for (let i = 0; i < 50; i++) lines.push(`b${i} = Button("B${i}")`);
    for (let i = 0; i < 49; i++) lines.push(`c${i} = Choice(["x", "y"])`);
    lines.push('q = Input(r, "r")');
    build(f, lines);
    reject(f, 'extra = Button("X")', 'limit');
  }, T);
});
