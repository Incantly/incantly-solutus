/**
 * SetValue, Reset and Click (controls-scripting/design.md 3.5; numbers-sliders/design.md 3.3 and 3.7; errors.md not_free).
 *
 * Silent-doc choice: `SetValue(L, 2, 9)` is the element form from the forms table; the `SetValue(L[2], 9)` form that the
 * examples show is tested separately.
 */
import { describe, expect, it } from 'vitest';
import { onControlEvent, resetObjects, setListElementByName, setValue } from '@incantly/kernel';
import type { ControlEvent } from '@incantly/kernel';
import { bad, fig, noticeKinds, num, ok, reasonOf, reject, snapshot } from './helpers';

const list = (f: ReturnType<typeof fig>, name: string): number[] => Array.from(f.value(name) as ArrayLike<number>);
const BASE = ['a = 3 in 0..10 step 0.5', 'b = 2 * a', 'chk = true', 's = "hello"', 'P = (1, 2)', 'L = [1, 2, 3]'];

describe('3.3 and 3.5 SetValue on a slider goes through commit', () => {
  it('clamps to the range and reports a clamped notice', () => {
    const f = fig(BASE);
    const r = setValue(f, 'a', 15);
    expect(num(f, 'a')).toBe(10);
    expect(r.ok && noticeKinds({ notices: r.value.notices })).toContain('clamped');
  });
  it('snaps to the step and reports a snapped notice', () => {
    const f = fig(BASE);
    const r = setValue(f, 'a', 4.3);
    expect(num(f, 'a')).toBe(4.5);
    expect(r.ok && noticeKinds({ notices: r.value.notices })).toContain('snapped');
  });
  it('is clamped but not quantised under step auto', () => {
    const f = fig(['a = 3 in 0..10']);
    setValue(f, 'a', 3.14159);
    expect(num(f, 'a')).toBe(3.14159);
    setValue(f, 'a', -4);
    expect(num(f, 'a')).toBe(0);
  });
  it('a non-finite value makes the slider undefined with reason not_finite', () => {
    const f = fig(BASE);
    setValue(f, 'a', Infinity);
    expect(reasonOf(f, 'a')).toBe('not_finite');
  });
  it('a plain free number may hold inf (README decision 7)', () => {
    const f = fig('n = 3');
    expect(setValue(f, 'n', Infinity).ok).toBe(true);
    expect(f.value('n')).toBe(Infinity);
  });
  it('through a draw line SetValue(a, 15) clamps and carries the clamped notice', () => {
    const f = fig(BASE);
    const r = ok(f.apply('SetValue(a, 15)'));
    expect(num(f, 'a')).toBe(10);
    expect(noticeKinds(r)).toContain('clamped');
  });
  it('one SetValue is one undo entry', () => {
    const f = fig(BASE);
    const depth = f.undoInfo().depth;
    setValue(f, 'a', 5);
    expect(f.undoInfo().depth).toBe(depth + 1);
    ok(f.undo());
    expect(num(f, 'a')).toBe(3);
  });
  it('tells the host: change with by = host', () => {
    const f = fig(BASE);
    const seen: ControlEvent[] = [];
    onControlEvent(f, (e) => seen.push(e));
    setValue(f, 'a', 5, { by: 'host' });
    expect(seen).toContainEqual(expect.objectContaining({ event: 'change', name: 'a', by: 'host' }));
  });
});

describe('3.5 SetValue forms', () => {
  it('Bool, Text and Point values are written', () => {
    const f = fig(BASE);
    setValue(f, 'chk', false);
    setValue(f, 's', 'bye');
    setValue(f, 'P', { x: 3, y: 4 });
    expect(f.value('chk')).toBe(false);
    expect(f.value('s')).toBe('bye');
    expect(f.value('P')).toEqual({ x: 3, y: 4 });
  });
  it('a wrong type is a type error (SetValue(a, "text"))', () => {
    const e = reject(fig(BASE), 'SetValue(a, "text")');
    expect(['no_matching_form', 'type_mismatch']).toContain(String(e.kind));
  });
  it('a dependent object is not_free and names its input', () => {
    const f = fig(BASE);
    const e = bad(setValue(f, 'b', 1), 'not_free');
    expect(JSON.stringify(e.params)).toContain('a');
  });
  it('through a draw line a dependent target is an error result, not a quiet success', () => {
    bad(fig(BASE).apply('SetValue(b, 1)'), 'not_free');
  });
  it('a failed SetValue changes nothing', () => {
    const f = fig(BASE);
    const before = snapshot(f);
    setValue(f, 'b', 1);
    expect(snapshot(f)).toBe(before);
  });
  it('one element of a free list: SetValue(L, 2, 9)', () => {
    const f = fig(BASE);
    ok(f.apply('SetValue(L, 2, 9)'));
    expect(list(f, 'L')).toEqual([1, 9, 3]);
  });
  it('the element API writes by 1-based index', () => {
    const f = fig(BASE);
    expect(setListElementByName(f, 'L', 1, 7).ok).toBe(true);
    expect(list(f, 'L')).toEqual([7, 2, 3]);
  });
  it('the example form SetValue(L[2], 8) sets an element', () => {
    const f = fig(BASE);
    ok(f.apply('SetValue(L[2], 8)'));
    expect(list(f, 'L')).toEqual([1, 8, 3]);
  });
  it('a dependent list is not_free for an element write', () => {
    const f = fig([...BASE, 'M = L']);
    bad(setListElementByName(f, 'M', 1, 7), 'not_free');
  });
});

describe('3.5 Reset restores the value an object had when it was defined', () => {
  it('Reset(a) restores one slider', () => {
    const f = fig(BASE);
    setValue(f, 'a', 8);
    ok(f.apply('Reset(a)'));
    expect(num(f, 'a')).toBe(3);
  });
  it('Reset() restores every free object', () => {
    const f = fig(BASE);
    setValue(f, 'a', 8);
    setValue(f, 'chk', false);
    setValue(f, 's', 'bye');
    ok(f.apply('Reset()'));
    expect(num(f, 'a')).toBe(3);
    expect(f.value('chk')).toBe(true);
    expect(f.value('s')).toBe('hello');
  });
  it('Reset() is one undo entry', () => {
    const f = fig(BASE);
    setValue(f, 'a', 8);
    setValue(f, 'chk', false);
    const depth = f.undoInfo().depth;
    ok(f.apply('Reset()'));
    expect(f.undoInfo().depth).toBe(depth + 1);
  });
  it('a redefinition sets the new initial value', () => {
    const f = fig(BASE);
    ok(f.apply('a = 6 in 0..10 step 0.5'));
    setValue(f, 'a', 1);
    ok(f.apply('Reset(a)'));
    expect(num(f, 'a')).toBe(6);
  });
  it('Reset of a dependent object is not_free', () => {
    bad(resetObjects(fig(BASE), ['b']), 'not_free');
  });
  it('Reset with one bad name resets nothing (the check comes first)', () => {
    const f = fig(BASE);
    setValue(f, 'a', 8);
    expect(resetObjects(f, ['a', 'b']).ok).toBe(false);
    expect(num(f, 'a')).toBe(8);
  });
  it('Reset on a figure that was never changed is harmless', () => {
    const f = fig(BASE);
    expect(resetObjects(f).ok).toBe(true);
    expect(num(f, 'a')).toBe(3);
  });
});

describe('3.5 Click', () => {
  it('Click(go) on a button is accepted', () => {
    ok(fig([...BASE, 'go = Button("Go")']).apply('Click(go)'));
  });
  it('Click of an object that is not a button or clickable is an error', () => {
    bad(fig(BASE).apply('Click(a)'));
  });
});
