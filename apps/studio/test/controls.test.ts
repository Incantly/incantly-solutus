/**
 * Controls in the studio (controls-scripting ui.md 1 to 5, design 3.3 and 3.4; .kiro/specs/controls-scripting R1 to R6).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountStudio } from '../src/studio-page';
import type { Mounted } from '../src/studio-page';

describe('controls in the studio', () => {
  let root: HTMLElement;
  let m: Mounted;
  const row = (n: string): HTMLElement => root.querySelector(`.expr[data-name="${n}"]`) as HTMLElement;
  const val = (n: string): unknown => m.session.figure.value(n);

  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
    m = mountStudio(root, { raf: () => 1, caf: () => undefined });
  });
  afterEach(() => {
    m.dispose();
    root.remove();
    vi.useRealTimers();
  });

  it('a button row has a native button; pressing it runs the click handler as one undo step (R1.1, R3.1)', () => {
    m.session.applyLines(['a = 3 in 0..10', 'b = 4', 'go = Button("Reset")', 'on go click: SetValue(a, 0)', 'on go click: SetValue(b, a + 1)'], 'test');
    const b = row('go').querySelector('button.ctl-button') as HTMLButtonElement;
    expect(b.textContent).toBe('Reset');
    b.click();
    expect(val('a')).toBe(0);
    expect(val('b')).toBe(1);
    m.session.undo();
    expect(val('a')).toBe(3);
    expect(val('b')).toBe(4);
  });

  it('a dropdown row is a select; a pick raises change and the choice value follows (R1.2, R2.2)', () => {
    m.session.applyLines(['n = 0', 'd = Choice(["red", "green", "blue"], 1)', 'on d change: SetValue(n, n + 1)'], 'test');
    const sel = row('d').querySelector('select.ctl-choice') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual(['red', 'green', 'blue']);
    expect(sel.value).toBe('1');
    sel.value = '3';
    sel.dispatchEvent(new Event('change'));
    expect((val('d') as { value: unknown }).value).toBe('blue');
    expect(val('n')).toBe(1);
  });

  it('an input box commits on Enter; a bad text leaves the target and shows the error (R1.3, R1.4)', () => {
    m.session.applyLines(['r = 2 in 0..5', 'q = Input(r, "r =")'], 'test');
    const field = (): HTMLInputElement => row('q').querySelector('.ctl-field') as HTMLInputElement;
    expect(row('q').querySelector('.ctl-caption')?.textContent).toBe('r =');
    expect(field().value).toBe('2');
    field().value = '3.5';
    field().dispatchEvent(new Event('input'));
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(val('r')).toBe(3.5);
    field().value = '2 +';
    field().dispatchEvent(new Event('input'));
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(val('r')).toBe(3.5);
    const err = row('q').querySelector('.ctl-error');
    expect(err?.textContent).toMatch(/^⚠ /);
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(field().getAttribute('aria-describedby')).toBe(err?.id);
  });

  it('a value past the range is clamped and the notice is shown (R1.4)', () => {
    m.session.applyLines(['r = 2 in 0..5', 'q = Input(r, "r =")'], 'test');
    const field = row('q').querySelector('.ctl-field') as HTMLInputElement;
    field.value = '9';
    field.dispatchEvent(new Event('input'));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(val('r')).toBe(5);
    expect(row('q').querySelector('.ctl-notice')?.textContent).toMatch(/^ⓘ /);
  });

  it('typing raises input after a pause and never writes the target (R1.3)', () => {
    vi.useFakeTimers();
    m.session.applyLines(['r = 2 in 0..5', 'seen = ""', 'q = Input(r)', 'on q input: SetValue(seen, value)'], 'test');
    const field = row('q').querySelector('.ctl-field') as HTMLInputElement;
    field.value = '4';
    field.dispatchEvent(new Event('input'));
    expect(val('seen')).toBe('');
    vi.advanceTimersByTime(160);
    expect(val('seen')).toBe('4');
    expect(val('r')).toBe(2);
  });

  it('Esc puts the target text back and writes nothing (R1.3)', () => {
    m.session.applyLines(['r = 2 in 0..5', 'q = Input(r)'], 'test');
    const field = row('q').querySelector('.ctl-field') as HTMLInputElement;
    field.value = '4';
    field.dispatchEvent(new Event('input'));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(field.value).toBe('2');
    expect(val('r')).toBe(2);
  });

  it('a slider move raises change and a release raises dragend; handler writes raise nothing (R2.1, R2.4)', () => {
    m.session.applyLines(['a = 1 in 0..10', 'b = 0', 'ends = 0', 'on a change: SetValue(b, 2 * a)', 'on b change: SetValue(a, 0)', 'on a dragend: SetValue(ends, ends + 1)'], 'test');
    m.session.slide('a', 3, false);
    expect(val('b')).toBe(6);
    expect(val('a')).toBe(3);
    expect(val('ends')).toBe(0);
    m.session.slide('a', 4, true);
    expect(val('b')).toBe(8);
    expect(val('ends')).toBe(1);
  });

  it('a checkbox toggle raises change (R2.2)', () => {
    m.session.applyLines(['flag = false', 'n = 0', 'on flag change: SetValue(n, n + 1)'], 'test');
    const box = row('flag').querySelector('input[type="checkbox"]') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(val('flag')).toBe(true);
    expect(val('n')).toBe(1);
  });

  it('dragging a free point raises change, and dragend on release (R2.3)', () => {
    m.session.applyLines(['P = (1, 1)', 'px = 0', 'ends = 0', 'on P change: SetValue(px, P.x)', 'on P dragend: SetValue(ends, ends + 1)'], 'test');
    m.session.dragPoint('P', 2, 1, false);
    expect(val('px')).toBe(2);
    m.session.dragPoint('P', 3, 1, true);
    expect(val('px')).toBe(3);
    expect(val('ends')).toBe(1);
  });

  it('a loaded figure runs on figure load once (R2.5)', () => {
    m.loadExample('controls');
    expect(val('count')).toBe(0);
    m.session.applyLines(['SetValue(count, 5)'], 'test');
    expect(val('count')).toBe(5);
  });

  it('a clickable object with a click handler runs it from the graph (R4)', () => {
    m.loadExample('controls');
    expect(m.session.clickable('P')).toBe(true);
    expect(m.session.clickable('hint')).toBe(false);
    const r = m.session.click('P');
    expect(r.ok).toBe(true);
    expect(val('a')).toBe(1);
  });

  it('handlers show under their row with a delete per step (R5)', () => {
    m.session.applyLines(['a = 3 in 0..10', 'go = Button("Go")', 'on go click: SetValue(a, 0)', 'on go click if a > 1: SetValue(a, 1)'], 'test');
    const steps = [...row('go').querySelectorAll('.handler-step')];
    expect(row('go').querySelector('.handler-event')?.textContent).toBe('on click');
    expect(steps.map((s) => s.querySelector('.step-text')?.textContent)).toEqual(['SetValue(a, 0)', 'if a > 1: SetValue(a, 1)']);
    expect(steps.every((s) => s.querySelector('.step-ok')?.textContent === '✓')).toBe(true);
    (steps[0]?.querySelector('.step-del') as HTMLButtonElement).click();
    expect([...row('go').querySelectorAll('.handler-step .step-text')].map((s) => s.textContent)).toEqual(['if a > 1: SetValue(a, 1)']);
  });

  it('the example has every control and every handler applied (R6)', () => {
    m.loadExample('controls');
    for (const n of ['pick', 'box', 'reset', 'plus']) expect(row(n).querySelector('.ctl-button, .ctl-choice, .ctl-input')).not.toBeNull();
    (row('plus').querySelector('.ctl-button') as HTMLButtonElement).click();
    (row('plus').querySelector('.ctl-button') as HTMLButtonElement).click();
    expect(val('count')).toBe(2);
    expect(val('tally')).toBe('pressed 2 times');
    m.session.slide('a', 8, true);
    expect(m.session.figure.get('warn')?.style.visible).toBe(true);
    m.session.slide('a', 3, true);
    expect(m.session.figure.get('warn')?.style.visible).toBe(false);
  });
});
