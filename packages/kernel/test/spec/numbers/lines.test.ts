/**
 * What each slider, number and angle line makes (numbers-sliders/design.md 3.2, 4, 5; errors.md 2 and 4; language rulings
 * "Sliders", SM-23 and Q-R4-1). Every test goes through `Figure.apply`.
 *
 * Silent-doc choice: the property is spelled `showIf` (language rulings SM-23 and Q-R4-1) where the numbers design writes
 * `showif`.
 */
import { describe, expect, it } from 'vitest';
import { displayUnitOf, lengthOf, loopOf, maxOf, minOf, orientationOf, parsePlacement, periodOf, placementOf, resumeOf, seedOf, stepOf } from '@incantly/kernel';
import { fig, noticeKinds, num, ok, reject, each } from './helpers';

describe('3.2 what each line makes', () => {
  it('a = 3 is a free Number with no range', () => {
    const f = fig('a = 3');
    const o = f.get('a');
    expect(o?.type).toBe('Number');
    expect(o?.free).toBe(true);
    expect(o?.range).toBeUndefined();
    expect(num(f, 'a')).toBe(3);
  });
  it('a = 3 in 0..10 is a slider with step auto', () => {
    const f = fig('a = 3 in 0..10');
    expect(f.get('a')?.range?.min).toBe(0);
    expect(f.get('a')?.range?.max).toBe(10);
    expect(f.get('a')?.range?.step).toBeUndefined();
    expect(minOf(f, 'a')).toBe(0);
    expect(maxOf(f, 'a')).toBe(10);
  });
  it('a = 3 in 0..10 step 0.5 is a slider with a fixed step', () => {
    const f = fig('a = 3 in 0..10 step 0.5');
    expect(f.get('a')?.range?.step).toBe(0.5);
    expect(stepOf(f, 'a')).toBe(0.5);
  });
  it('the automatic step of a 0deg..360deg slider is 5 degrees', () => {
    const f = fig('θ = 30deg in 0deg..360deg');
    expect(stepOf(f, 'θ')).toBeCloseTo((5 * Math.PI) / 180, 12);
  });
  it('a = 2n is a dependent Number', () => {
    const f = fig(['n = 4', 'a = 2n']);
    expect(f.get('a')?.free).toBe(false);
    expect(num(f, 'a')).toBe(8);
  });
  it('chk = true is a free Bool (a checkbox)', () => {
    const f = fig('chk = true');
    expect(f.get('chk')?.type).toBe('Bool');
    expect(f.get('chk')?.free).toBe(true);
  });
  it('chk = a > 3 is a dependent Bool', () => {
    const f = fig(['a = 4', 'chk = a > 3']);
    expect(f.get('chk')?.type).toBe('Bool');
    expect(f.get('chk')?.free).toBe(false);
    expect(f.value('chk')).toBe(true);
  });
  it('the design example name x is reserved (README decision 14), so a Bool cannot be called x', () => {
    reject(fig([]), 'x = true', 'reserved_name');
  });
  it('a free Number never shown as a slider has no range and no hidden slider', () => {
    const f = fig('c = 3');
    expect(f.get('c')?.range).toBeUndefined();
    expect(minOf(f, 'c')).toBeUndefined();
    expect(maxOf(f, 'c')).toBeUndefined();
  });
});

describe('3.2 range with a dependent number is not_free', () => {
  it('a = 2n in 0..10 is not_free and names its inputs', () => {
    const f = fig('n = 4');
    const e = reject(f, 'a = 2n in 0..10', 'not_free');
    expect(String(e.params['depends_on'] ?? e.params['inputs'] ?? '')).toContain('n');
  });
});

describe('3.2 units: inferred from the literal, never from the name', () => {
  it('θ = 30deg gets display unit deg', () => {
    expect(displayUnitOf(fig('θ = 30deg'), 'θ')).toBe('deg');
  });
  it('a = 1.2 is a plain number', () => {
    expect(displayUnitOf(fig('a = 1.2'), 'a')).toBe('none');
  });
  it('a with unit = rad shows a plain number as an angle in radians', () => {
    const f = fig(['a = 1.2', 'a with unit = rad']);
    expect(displayUnitOf(f, 'a')).toBe('rad');
    expect(num(f, 'a')).toBe(1.2);
  });
  each(['none', 'rad', 'deg', 'turn', 'grad'] as const)('unit = %s is accepted', (u) => {
    const f = fig('a = 1');
    ok(f.apply(`a with unit = ${u}`));
    expect(displayUnitOf(f, 'a')).toBe(u);
  });
  it('30deg is stored in radians', () => {
    expect(num(fig('θ = 30deg'), 'θ')).toBe(30 * (Math.PI / 180));
  });
  it('θ = 30deg in 0deg..360deg step 1deg is an angle slider in radians', () => {
    const f = fig('θ = 30deg in 0deg..360deg step 1deg');
    expect(displayUnitOf(f, 'θ')).toBe('deg');
    expect(minOf(f, 'θ')).toBe(0);
    expect(maxOf(f, 'θ')).toBeCloseTo(2 * Math.PI, 14);
    expect(stepOf(f, 'θ')).toBeCloseTo(Math.PI / 180, 14);
  });
  it('an angle slider bound of 360deg equals the literal 360deg', () => {
    const f = fig(['θ = 30deg in 0deg..360deg step 1deg', 'full = 360deg']);
    expect(maxOf(f, 'θ')).toBe(num(f, 'full'));
  });
  it('the unit is announced as a notice when it is inferred (unit_inferred)', () => {
    const f = fig([]);
    const r = ok(f.apply('θ = 30deg'));
    expect(noticeKinds(r)).toContain('unit_inferred');
  });
});

describe('3.2 unit_mismatch: bounds on an angle are never silently reinterpreted', () => {
  it('θ = 30deg in 0..360 step 1 is unit_mismatch', () => {
    reject(fig([]), 'θ = 30deg in 0..360 step 1', 'unit_mismatch');
  });
  it('the error names the unit and tells the author to add deg', () => {
    const e = reject(fig([]), 'θ = 30deg in 0..360 step 1', 'unit_mismatch');
    expect(String(e.params['unit'])).toBe('deg');
    expect(`${e.hint ?? ''} ${e.message}`).toContain('deg');
  });
  it('deg used on a Bool is refused (unit_mismatch; unknown_property is also a fair reading: Bool has no unit)', () => {
    expect(['unit_mismatch', 'unknown_property']).toContain(String(reject(fig('flag = true'), 'flag with unit = deg').kind));
  });
});

describe('4 edge cases: initial value, range and step', () => {
  it('a = 3 in 5..10 clamps to 5 and says so', () => {
    const f = fig([]);
    const r = ok(f.apply('a = 3 in 5..10'));
    expect(num(f, 'a')).toBe(5);
    expect(noticeKinds(r)).toContain('clamped');
  });
  it('the clamped notice carries the old and the new value (from 3 to 5)', () => {
    const f = fig([]);
    const n = ok(f.apply('a = 3 in 5..10')).notices.find((x) => String(x.kind) === 'clamped');
    expect(Number(n?.params['from'])).toBe(3);
    expect(Number(n?.params['to'])).toBe(5);
  });
  it('the clamped notice says why: below the minimum', () => {
    const n = ok(fig([]).apply('a = 3 in 5..10')).notices.find((x) => String(x.kind) === 'clamped');
    expect(`${n?.message ?? ''} ${JSON.stringify(n?.params ?? {})}`).toMatch(/low|below|min/i);
  });
  it('an initial value off the grid is snapped, with a snapped notice', () => {
    const f = fig([]);
    const r = ok(f.apply('a = 3.3 in 0..10 step 0.5'));
    expect(num(f, 'a')).toBe(3.5);
    expect(noticeKinds(r)).toContain('snapped');
  });
  it('an auto-step slider does not snap its initial value', () => {
    const f = fig('a = 3.14159 in 0..10');
    expect(num(f, 'a')).toBe(3.14159);
  });
  it('a = 3 in 10..0 is bad_range, and the error points at the range', () => {
    const line = 'a = 3 in 10..0';
    const e = reject(fig([]), line, 'bad_range');
    expect(line.slice(e.col - 1, e.endCol - 1)).toBe('10..0');
    expect(e.hint ?? '').not.toBe('');
  });
  it('bad_range carries min, max and step as evaluated', () => {
    const e = reject(fig([]), 'a = 3 in 10..0', 'bad_range');
    const get = (k: string) => (e as unknown as Record<string, unknown>)[k] ?? e.params[k];
    expect(get('min')).toBe(10);
    expect(get('max')).toBe(0);
  });
  each(['0', '-1', '-0.5'])('step %s is bad_range', (s) => {
    reject(fig([]), `a = 3 in 0..10 step ${s}`, 'bad_range');
  });
  it('a step that is not finite is bad_range', () => {
    reject(fig([]), 'a = 3 in 0..10 step inf', 'bad_range');
  });
  it('an infinite upper bound is bad_range (rulings: slider bounds must be finite)', () => {
    reject(fig([]), 'a = 3 in 0..inf', 'bad_range');
  });
  it('a bound that is not a number is bad_range', () => {
    reject(fig([]), 'a = 3 in 0..true', 'bad_range');
  });
  it('a step larger than the range is allowed', () => {
    const f = fig('a = 3 in 0..10 step 100');
    expect(num(f, 'a')).toBe(0);
  });
  it('more than 10^6 steps is a limit error with the limit and the actual count', () => {
    const e = reject(fig([]), 'a = 3 in 0..1000001 step 1', 'limit');
    expect(JSON.stringify(e.params)).toContain('1000000');
  });
});

describe('errors.md 2: parse-level cases', () => {
  it('a = 3 in 0.. is a syntax error that expects a number, a name or a bracket', () => {
    const e = reject(fig([]), 'a = 3 in 0..', 'syntax');
    expect(e.expected.length).toBeGreaterThan(0);
  });
  it('a = 3 in 0 10 is a syntax error that mentions the two dots', () => {
    const e = reject(fig([]), 'a = 3 in 0 10', 'syntax');
    expect(`${e.message} ${e.expected.join(' ')}`).toContain('..');
  });
  it("a = 3 step 1 is a syntax error: 'step' only follows a range", () => {
    const e = reject(fig([]), 'a = 3 step 1', 'syntax');
    expect(`${e.message} ${e.hint ?? ''}`).toContain('step');
    expect(`${e.hint ?? ''} ${e.suggest.join(' ')}`).toContain('in 0..10 step 1');
  });
  it('a = 3 in 0..10 step is a syntax error that expects a number after step', () => {
    const e = reject(fig([]), 'a = 3 in 0..10 step', 'syntax');
    expect(`${e.message} ${e.expected.join(' ')}`).toMatch(/number|step/);
  });
  it('a b = 3 is missing_operator (names have no spaces)', () => {
    reject(fig([]), 'a b = 3', 'missing_operator');
  });
  it('a with colour = red is unknown_property with the hint color', () => {
    const e = reject(fig('a = 3'), 'a with colour = red', 'unknown_property');
    expect(`${e.hint ?? ''} ${e.suggest.join(' ')}`).toContain('color');
  });
  it('a hint that is a replacement line passes when applied (rule 2: a hint is a valid line)', () => {
    for (const line of ['a = 3 in 10..0', 'θ = 30deg in 0..360 step 1', 'a = 3 step 1']) {
      const e = reject(fig([]), line);
      for (const s of e.suggest) expect(fig([]).apply(s).ok, `suggestion "${s}" for "${line}"`).toBe(true);
    }
  });
});

describe('3.2 redefinition keeps what it should', () => {
  const setup = () => fig(['a = 3 in 0..10 step 0.5', 'a with period = 4, loop = up, seed = 7']);
  it('replaces value, range and step', () => {
    const f = setup();
    ok(f.apply('a = 5 in 0..20 step 1'));
    expect(num(f, 'a')).toBe(5);
    expect(maxOf(f, 'a')).toBe(20);
    expect(stepOf(f, 'a')).toBe(1);
  });
  it('keeps period, loop and seed', () => {
    const f = setup();
    ok(f.apply('a = 5 in 0..20 step 1'));
    expect(periodOf(f, 'a')).toBe(4);
    expect(loopOf(f, 'a')).toBe('up');
    expect(seedOf(f, 'a')).toBe(7);
  });
  it('keeps the unit', () => {
    const f = fig(['θ = 30deg in 0deg..360deg step 1deg']);
    ok(f.apply('θ = 45deg in 0deg..180deg step 1deg'));
    expect(displayUnitOf(f, 'θ')).toBe('deg');
  });
  it('a = 5 on a slider keeps the range and clamps the value', () => {
    const f = fig('a = 3 in 0..10 step 0.5');
    ok(f.apply('a = 50'));
    expect(maxOf(f, 'a')).toBe(10);
    expect(num(f, 'a')).toBe(10);
  });
  it('a = 5 on a slider does not remove the slider', () => {
    const f = fig('a = 3 in 0..10 step 0.5');
    const r = ok(f.apply('a = 5'));
    expect(f.get('a')?.range).toBeDefined();
    expect(stepOf(f, 'a')).toBe(0.5);
    expect(num(f, 'a')).toBe(5);
    expect(noticeKinds(r)).toContain('range_kept');
  });
  it('a with min = none removes the slider', () => {
    const f = fig('a = 3 in 0..10');
    ok(f.apply('a with min = none'));
    expect(f.get('a')?.range).toBeUndefined();
  });
  it('redefining a Number as a Bool is type_change', () => {
    const f = fig('a = 3 in 0..10');
    const e = reject(f, 'a = true', 'type_change');
    expect(JSON.stringify(e.params)).toMatch(/Number/);
  });
  it('redefining a Bool as a Number is type_change', () => {
    reject(fig('chk = true'), 'chk = 3', 'type_change');
  });
});

describe('3.3 dynamic bounds and the rulings on bound cycles', () => {
  it('a = 1 in 0..n follows n', () => {
    const f = fig(['n = 5', 'a = 1 in 0..n']);
    expect(maxOf(f, 'a')).toBe(5);
    expect(f.setFree('n', 8, 'api')).toEqual({ ok: true, changed: true });
    f.flush();
    expect(maxOf(f, 'a')).toBe(8);
  });
  it('a = 0 in -r..r step r/10 follows r', () => {
    const f = fig(['r = 5', 'a = 0 in -r..r step r/10']);
    expect(minOf(f, 'a')).toBe(-5);
    expect(maxOf(f, 'a')).toBe(5);
    expect(stepOf(f, 'a')).toBe(0.5);
  });
  it('an unknown name in a bound is unknown_name, never an offer to make a slider', () => {
    const f = fig([]);
    reject(f, 'a = 3 in 0..zz', 'unknown_name');
    expect(f.get('a')).toBeUndefined();
    expect(f.get('zz')).toBeUndefined();
  });
  it('k = 3 in 0..k on a new name is unknown_name', () => {
    reject(fig([]), 'k = 3 in 0..k', 'unknown_name');
  });
  it('k = 3 in 0..k on an existing k is a cycle with a path', () => {
    const e = reject(fig('k = 1 in 0..5'), 'k = 3 in 0..k', 'cycle');
    expect(e.path?.length ?? 0).toBeGreaterThan(0);
  });
  it('a = 3 in 0..b with b = a + 1 is a cycle', () => {
    const f = fig(['a = 3 in 0..10', 'b = a + 1']);
    reject(f, 'a = 3 in 0..b', 'cycle');
  });
  it('a style that reads its own slider is accepted (style edges never cycle)', () => {
    ok(fig([]).apply('a = 3 in 0..20 with opacity = a / 20'));
  });
  it('a defining line may read its own name in its with list (Q-R4-1)', () => {
    ok(fig([]).apply('P9 = (1, 2) with showIf = P9.x > 0'));
  });
});

describe('3.2 style properties: values and defaults', () => {
  it('defaults: loop bounce, period 10, horizontal, length 180, dock, resume true', () => {
    const f = fig('a = 3 in 0..10');
    expect(loopOf(f, 'a')).toBe('bounce');
    expect(periodOf(f, 'a')).toBe(10);
    expect(orientationOf(f, 'a')).toBe('horizontal');
    expect(lengthOf(f, 'a')).toBe(180);
    expect(placementOf(f, 'a')).toEqual({ kind: 'dock' });
    expect(resumeOf(f, 'a')).toBe(true);
  });
  each(['bounce', 'up', 'down', 'once', 'random'] as const)('loop = %s is accepted', (m) => {
    const f = fig('a = 3 in 0..10');
    ok(f.apply(`a with loop = ${m}`));
    expect(loopOf(f, 'a')).toBe(m);
  });
  it('loop = spin is bad_property_value and lists the accepted words', () => {
    const e = reject(fig('a = 3 in 0..10'), 'a with loop = spin', 'bad_property_value');
    expect(JSON.stringify(e.params) + e.message).toContain('bounce');
  });
  each(['0', '-2'])('period = %s is bad_property_value (period must be above 0)', (v) => {
    reject(fig('a = 3 in 0..10'), `a with period = ${v}`, 'bad_property_value');
  });
  each(['0', '15'])('digits = %s is accepted', (v) => {
    ok(fig('a = 3').apply(`a with digits = ${v}`));
  });
  each(['16', '-1', '1.5', '20'])('digits = %s is bad_property_value', (v) => {
    const e = reject(fig('a = 3'), `a with digits = ${v}`, 'bad_property_value');
    expect(JSON.stringify(e.params) + e.message).toMatch(/0 to 15|0\.\.15/);
  });
  each(['1', '15'])('sig = %s is accepted', (v) => {
    ok(fig('a = 3').apply(`a with sig = ${v}`));
  });
  each(['0', '16', '2.5'])('sig = %s is bad_property_value', (v) => {
    reject(fig('a = 3'), `a with sig = ${v}`, 'bad_property_value');
  });
  each(['true', 'false'])('trim = %s is accepted', (v) => {
    ok(fig('a = 3').apply(`a with trim = ${v}`));
  });
  it('resume = false stops a released drag from resuming', () => {
    const f = fig('a = 3 in 0..10');
    ok(f.apply('a with resume = false'));
    expect(resumeOf(f, 'a')).toBe(false);
  });
  it('place = screen(20, 20) is a screen placement', () => {
    const f = fig('a = 3 in 0..10');
    ok(f.apply('a with place = screen(20, 20)'));
    const p = placementOf(f, 'a');
    expect(p).toMatchObject({ kind: 'screen', x: 20, y: 20 });
  });
  it('place = at(1, 2) is a placement in maths coordinates', () => {
    const f = fig('a = 3 in 0..10');
    ok(f.apply('a with place = at(1, 2)'));
    expect(placementOf(f, 'a')).toEqual({ kind: 'at', x: 1, y: 2 });
  });
  it('place = dock is the default dock', () => {
    const f = fig('a = 3 in 0..10');
    ok(f.apply('a with place = screen(1, 1)'));
    ok(f.apply('a with place = dock'));
    expect(placementOf(f, 'a')).toEqual({ kind: 'dock' });
  });
  it('parsePlacement reads the three forms', () => {
    expect(parsePlacement('dock')).toEqual({ kind: 'dock' });
    expect(parsePlacement('at(1, 2)')).toEqual({ kind: 'at', x: 1, y: 2 });
    expect(parsePlacement('screen(20, 30)')).toMatchObject({ kind: 'screen', x: 20, y: 30 });
    expect(parsePlacement('at(3,4)')).toEqual({ kind: 'at', x: 3, y: 4 });
  });
  it('parsePlacement refuses nonsense and wrong arity', () => {
    expect(parsePlacement('bogus')).toBeUndefined();
    expect(parsePlacement('screen(1)')).toBeUndefined();
    expect(parsePlacement('at()')).toBeUndefined();
  });
  it('several properties in one with are one undo step', () => {
    const f = fig('a = 3 in 0..10');
    const depth = f.undoInfo().depth;
    ok(f.apply('a with period = 4, loop = up'));
    expect(f.undoInfo().depth).toBe(depth + 1);
    ok(f.undo());
    expect(loopOf(f, 'a')).toBe('bounce');
    expect(periodOf(f, 'a')).toBe(10);
  });
  it('a text label sets the caption of a slider', () => {
    const f = fig('a = 3 in 0..10');
    ok(f.apply('a with label = "Angle"'));
    expect(f.get('a')?.style.caption ?? f.get('a')?.style.ext['label']).toBe('Angle');
  });
  it('a label longer than 120 characters is a limit error', () => {
    reject(fig('a = 3 in 0..10'), `a with label = "${'x'.repeat(121)}"`, 'limit');
  });
});

describe('3.2 changing the range later: a with min = 0, max = 20, step = auto', () => {
  it('min and max can be changed together', () => {
    const f = fig('a = 3 in 0..10');
    ok(f.apply('a with min = 1, max = 20'));
    expect(minOf(f, 'a')).toBe(1);
    expect(maxOf(f, 'a')).toBe(20);
  });
  it('step = auto goes back to the automatic step', () => {
    const f = fig('a = 3 in 0..10 step 0.5');
    ok(f.apply('a with step = auto'));
    expect(f.get('a')?.range?.step).toBeUndefined();
  });
  it('a range property on a dependent number is not_free', () => {
    reject(fig(['n = 2', 'b = 2n']), 'b with min = 0, max = 5', 'not_free');
  });
});

describe('1 Read the slider: a.min, a.max, a.step, a.animating', () => {
  it('a.min and a.max read the range', () => {
    const f = fig(['a = 3 in 0..10 step 0.5', 'lo = a.min', 'hi = a.max']);
    expect(num(f, 'lo')).toBe(0);
    expect(num(f, 'hi')).toBe(10);
  });
  it('a.animating is false until the slider is animated', () => {
    const f = fig(['a = 3 in 0..10', 'an = a.animating']);
    expect(f.value('an')).toBe(false);
  });
});
