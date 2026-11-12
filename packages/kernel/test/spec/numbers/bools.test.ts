/**
 * Booleans, checkboxes and visibility bindings (numbers-sliders/design.md 3.6; errors.md 3; language rulings SM-23).
 *
 * Silent-doc choices (written down):
 *  - The property is spelled `showIf` (language rulings), the numbers design writes `showif`.
 *  - A checkbox caption is set with `label = "text"` as the numbers design says; the kernel's own `label` is a mode word, so this
 *    is a doc conflict. The tests follow the numbers design.
 */
import { describe, expect, it } from 'vitest';
import { labelOf, onControlEvent, setValue, toggleCheckbox } from '@incantly/kernel';
import type { ControlEvent } from '@incantly/kernel';
import { bad, fig, ok, reasonOf, reject } from './helpers';

const BASE = ['a = 3 in 0..10 step 0.5', 'show = true', 'P = (1, 2)', 'P with showIf = show'];
const shown = (f: ReturnType<typeof fig>, name: string): boolean | undefined => f.get(name)?.style.shown;

describe('3.6 a free Bool is a checkbox', () => {
  it('a free Bool is free and toggling writes its value', () => {
    const f = fig(BASE);
    expect(f.get('show')?.free).toBe(true);
    ok(f.apply('Toggle(show)'));
    expect(f.value('show')).toBe(false);
    ok(f.apply('Toggle(show)'));
    expect(f.value('show')).toBe(true);
  });
  it('one Toggle is one undo entry and undo flips it back', () => {
    const f = fig(BASE);
    const depth = f.undoInfo().depth;
    ok(f.apply('Toggle(show)'));
    expect(f.undoInfo().depth).toBe(depth + 1);
    ok(f.undo());
    expect(f.value('show')).toBe(true);
  });
  it('Toggle of a dependent Bool is not_free, through the API and through a draw line', () => {
    const f = fig(['a = 3', 'big = a > 5']);
    bad(toggleCheckbox(f, 'big'), 'not_free');
    bad(f.apply('Toggle(big)'), 'not_free');
  });
  it('SetValue(show, false) writes the Bool; a Number into a Bool is refused', () => {
    const f = fig(BASE);
    expect(setValue(f, 'show', false).ok).toBe(true);
    expect(f.value('show')).toBe(false);
    expect(setValue(f, 'show', 3).ok).toBe(false);
  });
  it('a dependent Bool is a test and follows its inputs', () => {
    const f = fig(['a = 3 in 0..10', 'big = a > 5']);
    expect(f.value('big')).toBe(false);
    f.setFree('a', 7, 'api');
    f.flush();
    expect(f.value('big')).toBe(true);
  });
  it('a learner toggle tells the host: change, type Bool, the new value', () => {
    const f = fig(BASE);
    const seen: ControlEvent[] = [];
    onControlEvent(f, (e) => seen.push(e));
    toggleCheckbox(f, 'show', { by: 'learner' });
    expect(seen).toContainEqual(expect.objectContaining({ event: 'change', name: 'show', type: 'Bool', by: 'learner', value: 'false' }));
  });
  it('the caption is the label, and the name by default', () => {
    const f = fig(BASE);
    expect(labelOf(f, 'show')).toBe('show');
    ok(f.apply('show with label = "Show tangent"'));
    expect(labelOf(f, 'show')).toBe('Show tangent');
  });
});

describe('3.6 showif: visibility is a rule on a Bool', () => {
  it('the object is shown while the Bool is true and hidden while it is false', () => {
    const f = fig(BASE);
    expect(shown(f, 'P')).toBe(true);
    ok(f.apply('Toggle(show)'));
    expect(shown(f, 'P')).toBe(false);
  });
  it('the user-visible flag is untouched by showIf', () => {
    const f = fig(BASE);
    ok(f.apply('Toggle(show)'));
    expect(f.get('P')?.style.visible).toBe(true);
  });
  it('a hidden object says why: showIf', () => {
    const f = fig(BASE);
    ok(f.apply('Toggle(show)'));
    expect(f.get('P')?.style.why ?? '').toMatch(/showIf|show/i);
  });
  it('both the flag and the condition must pass', () => {
    const f = fig(BASE);
    ok(f.apply('P with visible = false'));
    expect(shown(f, 'P')).toBe(false);
    ok(f.apply('P with visible = true'));
    expect(shown(f, 'P')).toBe(true);
    ok(f.apply('Toggle(show)'));
    ok(f.apply('P with visible = true'));
    expect(shown(f, 'P')).toBe(false);
  });
  it('accepts any Bool expression: a > 3 and show', () => {
    const f = fig(['a = 4 in 0..10', 'show = true', 'P = (1, 2)']);
    ok(f.apply('P with showIf = a > 3 and show'));
    expect(shown(f, 'P')).toBe(true);
    f.setFree('a', 2, 'api');
    f.flush();
    expect(shown(f, 'P')).toBe(false);
  });
  it('showIf = true is the constant condition', () => {
    const f = fig(['P = (1, 2)']);
    ok(f.apply('P with showIf = true'));
    expect(shown(f, 'P')).toBe(true);
  });
  it('showIf = none removes the condition', () => {
    const f = fig(BASE);
    ok(f.apply('Toggle(show)'));
    ok(f.apply('P with showIf = none'));
    expect(shown(f, 'P')).toBe(true);
  });
  it('a condition that is not a Bool is a type error', () => {
    reject(fig(['P = (1, 2)']), 'P with showIf = 3');
  });
  it('an undefined Bool hides the object and says showIf is undefined', () => {
    const f = fig(['m = 0', 'ub = 1 / m > 1', 'P = (1, 2)', 'P with showIf = ub']);
    expect(reasonOf(f, 'ub')).toBeDefined();
    expect(shown(f, 'P')).toBe(false);
    expect(f.get('P')?.style.why ?? '').toMatch(/undefined/i);
  });
  it('if() on an undefined Bool is undefined', () => {
    const f = fig(['m = 0', 'ub = 1 / m > 1', 'r1 = if(ub, 1, 2)']);
    expect(reasonOf(f, 'r1')).toBeDefined();
  });
  it('equality on Bools is ==', () => {
    expect(fig(['show = true', 'e1 = show == true']).value('e1')).toBe(true);
    expect(fig(['show = true', 'e1 = show == false']).value('e1')).toBe(false);
  });
  it('a checkbox bound to a hidden object stays visible', () => {
    const f = fig(BASE);
    ok(f.apply('Toggle(show)'));
    expect(shown(f, 'P')).toBe(false);
    expect(shown(f, 'show')).toBe(true);
  });
  it('hiding the checkbox itself is a restyle and the binding keeps working', () => {
    const f = fig(BASE);
    ok(f.apply('show with visible = false'));
    expect(shown(f, 'show')).toBe(false);
    expect(shown(f, 'P')).toBe(true);
  });
  it('a condition that reads the object itself is accepted (style edges never cycle)', () => {
    ok(fig(['P = (1, 2)']).apply('P with showIf = P.x > 0'));
  });
  it('deleting the Bool is reported with the objects that used it', () => {
    const f = fig(BASE);
    const r = f.delete('show');
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).toContain('"P"');
    expect(f.get('P')).toBeDefined();
  });
});
