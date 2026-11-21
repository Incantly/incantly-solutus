/**
 * Input boxes: definition and the learner-text pipeline (controls-scripting/design.md 3.2, 5, 7; errors.md 2 and 4).
 *
 * Silent-doc choices (written down):
 *  - A box that holds typed (uncommitted) text counts as focused: its text is not refreshed from the target.
 *  - `Delete(A)` and any PascalCase call is `input_command`, whether or not the command exists in this build.
 */
import { describe, expect, it } from 'vitest';
import {
  checkInputTarget,
  clearInputState,
  commitInputText,
  inputErrorOf,
  inputTargetOf,
  inputTextOf,
  inputValidOf,
  onControlEvent,
  setValue,
  summarizeControl,
  targetTextOf,
  typeInputText,
} from '@incantly/kernel';
import type { ControlEvent } from '@incantly/kernel';
import { T, bad, each, fig, num, oid, ok, prng, reasonOf, reject, snapshot, within } from './helpers';

const BASE = ['r = 2 in 0..5', 'n = 3', 'q = Input(r, "r =")', 'flag = true', 's = "hello"', 'P = (1, 2)', 'f(x) = x^2', 'qf = Input(f, "f(x) =")'];
const kindOf = (r: { readonly ok: boolean }): string => String((r as { kind?: unknown }).kind);

describe('3.1 and 3.2 defining an input box', () => {
  it('q = Input(r, "r =") makes an Input linked to r', () => {
    const f = fig(BASE);
    expect(f.get('q')?.type).toBe('Input');
    expect(inputTargetOf(f, 'q')).toBe(oid(f, 'r'));
  });
  it('the summary reads: input for r, shows 2', () => {
    expect(summarizeControl(fig(BASE), 'q')).toBe('input for r, shows 2');
  });
  each([
    ['flag', 'Bool'],
    ['s', 'Text'],
    ['P', 'Point'],
    ['f', 'Function'],
    ['n', 'Number'],
  ])('a free %s (%s) is a valid target', (name) => {
    ok(fig(BASE).apply(`qq = Input(${name}, "x")`));
  });
  it('a dependent target is bad_input_target and says which types are allowed', () => {
    const e = reject(fig(['n = 3', 'm = 2 * n']), 'q = Input(m, "m")', 'bad_input_target');
    expect(JSON.stringify(e.params)).toMatch(/allowed|reason/);
  });
  it('a Button as target is bad_input_target', () => {
    reject(fig(['go = Button("Go")']), 'q = Input(go, "x")', 'bad_input_target');
  });
  it('a type with no text form (a list) is bad_input_target', () => {
    reject(fig(['L = [1, 2, 3]']), 'q = Input(L, "x")', 'bad_input_target');
  });
  it('checkInputTarget returns nothing for a free object and an error for a dependent one', () => {
    const f = fig([...BASE, 'm = 2 * n']);
    expect(checkInputTarget(f, 'r')).toBeUndefined();
    expect(String(checkInputTarget(f, 'm')?.kind)).toBe('bad_input_target');
  });
  it('q.text and q.valid can be read', () => {
    const f = fig([...BASE, 't1 = q.text', 'v1 = q.valid']);
    expect(f.value('t1')).toBe('2');
    expect(f.value('v1')).toBe(true);
  });
  it('a target that becomes dependent disables the box with reason target_not_free', () => {
    const f = fig(BASE);
    const r = f.apply('r = 2 * n');
    if (r.ok) expect(reasonOf(f, 'q')).toBe('target_not_free');
    else expect(['breaks_dependents', 'not_free', 'type_change']).toContain(String(r.kind));
  });
});

describe('3.2 stage 5: commit by target type', () => {
  it('a Number is written', () => {
    const f = fig(BASE);
    expect(commitInputText(f, 'q', '3.5').ok).toBe(true);
    expect(num(f, 'r')).toBe(3.5);
  });
  it('a formula is evaluated once and stored as a constant: the target stays free and reads nothing', () => {
    const f = fig(BASE);
    commitInputText(f, 'q', 'n + 1');
    expect(num(f, 'r')).toBe(4);
    expect(f.get('r')?.free).toBe(true);
    expect(f.get('r')?.inputs).toEqual([]);
    setValue(f, 'n', 10);
    expect(num(f, 'r')).toBe(4);
  });
  it('a slider target is clamped and the result carries a clamped notice from 12 to 5', () => {
    const f = fig(BASE);
    const r = commitInputText(f, 'q', '12');
    expect(num(f, 'r')).toBe(5);
    expect(r.ok && r.value.notices.some((n) => String(n.kind) === 'clamped' && Number(n.params['from']) === 12 && Number(n.params['to']) === 5)).toBe(true);
  });
  it('a slider target is snapped to its step', () => {
    const f = fig(['a = 3 in 0..10 step 0.5', 'qa = Input(a, "a")']);
    commitInputText(f, 'qa', '3.3');
    expect(num(f, 'a')).toBe(3.5);
  });
  it('after a commit the box shows the final text', () => {
    const f = fig(BASE);
    commitInputText(f, 'q', '12');
    expect(inputTextOf(f, 'q')).toBe('5');
    expect(inputValidOf(f, 'q')).toBe(true);
  });
  it('a Bool takes true, false, a comparison and not', () => {
    const f = fig(['flag = true', 'qb = Input(flag, "flag")']);
    commitInputText(f, 'qb', 'false');
    expect(f.value('flag')).toBe(false);
    commitInputText(f, 'qb', '1 < 2');
    expect(f.value('flag')).toBe(true);
    commitInputText(f, 'qb', 'not true');
    expect(f.value('flag')).toBe(false);
  });
  it('a Text takes the raw string with no parsing', () => {
    const f = fig(['s = "hello"', 'qs = Input(s, "s")']);
    expect(commitInputText(f, 'qs', '2+2 = (').ok).toBe(true);
    expect(f.value('s')).toBe('2+2 = (');
  });
  it('a Text of 500 characters is accepted and 501 is input_too_long', () => {
    const f = fig(['s = "hello"', 'qs = Input(s, "s")']);
    expect(commitInputText(f, 'qs', 'x'.repeat(500)).ok).toBe(true);
    expect(kindOf(commitInputText(f, 'qs', 'x'.repeat(501)))).toBe('input_too_long');
  });
  it('a Point takes (e, e) evaluated once', () => {
    const f = fig(['P = (1, 2)', 'qp = Input(P, "P")']);
    commitInputText(f, 'qp', '(1+1, 2*3)');
    expect(f.value('P')).toEqual({ x: 2, y: 6 });
  });
  it('a Number refuses a point and a Bool', () => {
    const f = fig(BASE);
    expect(kindOf(commitInputText(f, 'q', '(1, 2)'))).toBe('type_mismatch');
    expect(kindOf(commitInputText(f, 'q', 'true'))).toBe('type_mismatch');
  });
  it('a Function target takes the body: x^2 - 3 redefines f', () => {
    const f = fig([...BASE, 'y1 = f(2)']);
    expect(commitInputText(f, 'qf', 'x^2 - 3').ok).toBe(true);
    expect(num(f, 'y1')).toBe(1);
    expect(inputTextOf(f, 'qf')).toBe('x^2 - 3');
  });
  it('a Function body that reads the function itself is cycle', () => {
    const f = fig(BASE);
    expect(kindOf(commitInputText(f, 'qf', 'f(x) + 1'))).toBe('cycle');
    expect(num(fig([...BASE, 'y1 = f(3)']), 'y1')).toBe(9);
  });
  it('a commit is one undo entry and undo restores the old value', () => {
    const f = fig(BASE);
    const depth = f.undoInfo().depth;
    commitInputText(f, 'q', '4');
    expect(f.undoInfo().depth).toBe(depth + 1);
    ok(f.undo());
    expect(num(f, 'r')).toBe(2);
  });
  it('a learner commit tells the host about the box and the target', () => {
    const f = fig(BASE);
    const seen: ControlEvent[] = [];
    onControlEvent(f, (e) => seen.push(e));
    commitInputText(f, 'q', '4', { by: 'learner' });
    expect(seen.map((e) => e.name).sort()).toEqual(['q', 'r']);
    expect(seen.every((e) => e.event === 'change' && e.by === 'learner')).toBe(true);
  });
});

describe('3.2 and errors.md 4: a failed commit leaves the target and the figure alone', () => {
  const fails: [string, string][] = [
    ['2 +', 'syntax'],
    ['rr', 'unknown_name'],
    ['Delete(P)', 'input_command'],
    ['Circle(P, 2)', 'input_command'],
    ['r = 5', 'input_not_expression'],
    ['n with color = red', 'input_not_expression'],
    ['@digits 3', 'input_not_expression'],
    ['# note', 'input_not_expression'],
    ['0/0', 'input_value_undefined'],
    ['sqrt(-1)', 'input_value_undefined'],
  ];
  each(fails)('the text %j is refused with %s', (text, kind) => {
    const f = fig(BASE);
    const before = snapshot(f);
    const r = commitInputText(f, 'q', text);
    expect(kindOf(r)).toBe(kind);
    expect(snapshot(f)).toBe(before);
  });
  it('a refused commit marks the box invalid and keeps the error as data', () => {
    const f = fig(BASE);
    commitInputText(f, 'q', '2 +');
    expect(inputValidOf(f, 'q')).toBe(false);
    expect(String(inputErrorOf(f, 'q')?.kind)).toBe('syntax');
  });
  it('an unknown name suggests the closest one', () => {
    const e = bad(commitInputText(fig(BASE), 'q', 'rr'), 'unknown_name');
    expect(`${e.hint ?? ''} ${e.suggest.join(' ')} ${e.message}`).toContain('r');
  });
  it('a command is refused without creating or deleting anything', () => {
    const f = fig(BASE);
    const count = f.count;
    commitInputText(f, 'q', 'Delete(r)');
    expect(f.count).toBe(count);
    expect(f.get('r')).toBeDefined();
  });
  it('500 characters are accepted and 501 are input_too_long', () => {
    const f = fig(['n = 3', 'qn = Input(n, "n")']);
    expect(commitInputText(f, 'qn', `0.${'1'.repeat(498)}`).ok).toBe(true);
    expect(kindOf(commitInputText(f, 'qn', `0.${'1'.repeat(499)}`))).toBe('input_too_long');
  });
  it('nesting of 16 is accepted and 17 is input_too_deep', () => {
    const f = fig(['n = 3', 'qn = Input(n, "n")']);
    expect(commitInputText(f, 'qn', `${'('.repeat(16)}1${')'.repeat(16)}`).ok).toBe(true);
    expect(kindOf(commitInputText(f, 'qn', `${'('.repeat(17)}1${')'.repeat(17)}`))).toBe('input_too_deep');
  });
  it('a failed commit adds no undo entry', () => {
    const f = fig(BASE);
    const depth = f.undoInfo().depth;
    commitInputText(f, 'q', '2 +');
    expect(f.undoInfo().depth).toBe(depth);
  });
});

describe('3.2 typing: validation without committing', () => {
  it('valid text is reported valid and the target does not change', () => {
    const f = fig(BASE);
    expect(typeInputText(f, 'q', '4').valid).toBe(true);
    expect(num(f, 'r')).toBe(2);
    expect(inputValidOf(f, 'q')).toBe(true);
  });
  it('invalid text is reported invalid with the error', () => {
    const f = fig(BASE);
    const t = typeInputText(f, 'q', '2 +');
    expect(t.valid).toBe(false);
    expect(String(t.error?.kind)).toBe('syntax');
  });
  it('the box shows the typed text until it is committed or cleared', () => {
    const f = fig(BASE);
    typeInputText(f, 'q', '4');
    expect(inputTextOf(f, 'q')).toBe('4');
    clearInputState(f, 'q');
    expect(inputTextOf(f, 'q')).toBe('2');
  });
  it('a clean box refreshes when the target changes elsewhere', () => {
    const f = fig(BASE);
    setValue(f, 'r', 4);
    expect(inputTextOf(f, 'q')).toBe('4');
    expect(targetTextOf(f, 'r')).toBe('4');
  });
});

describe('3.2 and 7 fuzz: learner text never breaks the figure', () => {
  const alphabet = ['(', ')', '+', '-', '*', '/', '^', '.', ',', '0', '1', '7', '9', ' ', 'r', 'n', 'x', 'pi', 'sin', 'Delete', 'Circle', '=', '@', '#', '"', "'", '[', ']', '{', '}', '<', '>', '!', '&', '|', ':', 'with', 'on', 'true', 'inf', '1e999'];
  const strings = (seed: number, count: number): string[] => {
    const rnd = prng(seed);
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      let s = '';
      const len = 1 + Math.floor(rnd() * 30);
      for (let j = 0; j < len; j++) s += alphabet[Math.floor(rnd() * alphabet.length)];
      out.push(s);
    }
    return out;
  };
  it('never throws', () => {
    const f = fig(BASE);
    for (const s of strings(1, 400)) expect(() => commitInputText(f, 'q', s)).not.toThrow();
  }, T);
  it('never creates or deletes an object', () => {
    const f = fig(BASE);
    const names = f.names().join(',');
    for (const s of strings(2, 400)) commitInputText(f, 'q', s);
    expect(f.names().join(',')).toBe(names);
  }, T);
  it('a refused text leaves the figure exactly as it was', () => {
    const f = fig(BASE);
    for (const s of strings(3, 300)) {
      const before = snapshot(f);
      const r = commitInputText(f, 'q', s);
      if (!r.ok) expect(snapshot(f), `text ${JSON.stringify(s)}`).toBe(before);
    }
  }, T);
  it('each text finishes within 5 ms', { retry: 2, timeout: T }, () => {
    const f = fig(BASE);
    // one wall-clock sample can hold a garbage-collection pause on a shared CI machine; the budget is about the work,
    // so a slow text is timed once more and the faster run counts
    for (const s of strings(4, 300)) {
      const t0 = performance.now();
      commitInputText(f, 'q', s);
      const first = performance.now() - t0;
      if (first < 5) continue;
      within(5, () => commitInputText(f, 'q', s));
    }
  });
});
