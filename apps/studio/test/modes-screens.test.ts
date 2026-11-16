/** Scientific rows, the on-screen keyboard and the exam screens (.kiro/specs/app-modes R8.3, R10.2, R10.5). */
import { afterEach, describe, expect, it } from 'vitest';
import { mountStudio } from '../src/studio-page';
import type { Mounted } from '../src/studio-page';
import { inDegrees } from '../src/modes/scientific';
import { clockText } from '../src/modes/exam-ui';

describe('scientific, keyboard and exam screens', () => {
  let root: HTMLElement;
  let m: Mounted | undefined;
  let t = 0;
  let ticks: (() => void)[] = [];
  const mount = (mode: 'scientific' | 'graphing' | 'figure'): void => {
    root = document.createElement('div');
    document.body.append(root);
    t = 0;
    ticks = [];
    m = mountStudio(root, {
      raf: () => 1, caf: () => undefined, storage: null, mode, now: () => t,
      every: (_ms, fn) => {
        ticks.push(fn);
        return () => undefined;
      },
      requestFullscreen: () => Promise.resolve(true),
    });
  };
  afterEach(() => {
    m?.dispose();
    root?.remove();
    m = undefined;
  });

  it('degrees wrap trig functions and give degrees back', () => {
    expect(inDegrees('sin(30)')).toBe('sin((30) * pi / 180)');
    expect(inDegrees('asin(0.5) + cos(sin(90))')).toBe('(asin(0.5) * 180 / pi) + cos((sin((90) * pi / 180)) * pi / 180)');
    expect(inDegrees('cosh(1)')).toBe('cosh(1)');
  });

  it('scientific: one column of rows, Ans, exact and decimal (R10.2)', () => {
    mount('scientific');
    expect(m.scientific.isOpen()).toBe(true);
    expect((root.querySelector('.panel') as HTMLElement).hidden).toBe(true);
    expect(m.keyboard.isOpen()).toBe(true);
    expect(m.scientific.run('3/5 + 1/4')).toEqual({ ok: true, text: '17/20' });
    expect(root.querySelector('.sci-row .sci-decimal')?.textContent).toBe('= 0.85');
    expect(m.scientific.run('Ans * 2')).toEqual({ ok: true, text: '17/10' });
    m.scientific.toggleExact();
    expect([...root.querySelectorAll('.sci-result')].map((x) => x.textContent)).toEqual(['0.85', '1.7']);
  });

  it('scientific works in degrees and shows reasons for undefined rows', () => {
    mount('scientific');
    expect(m.modes.settings.get('angleUnit')).toBe('degree');
    expect(m.scientific.run('sin(30)').text).toBe('1/2');
    expect(m.scientific.run('asin(1)').text).toBe('90');
    m.scientific.run('1/0');
    expect(root.querySelector('.sci-row.bad .sci-result')?.textContent).toBe('division by zero');
    const r = m.scientific.run('Circle((0, 0), 1)');
    expect(r.ok).toBe(false);
    expect(root.querySelector('.sci-error')?.textContent).toMatch(/^Circle is not available in the scientific mode\./);
  });

  it('the keyboard types into the field and runs it (R8.3)', () => {
    mount('scientific');
    m.scientific.input.focus();
    for (const k of ['d7', 'times', 'd6']) m.keyboard.press(k);
    expect(m.scientific.input.value).toBe('7 * 6');
    m.keyboard.press('e-enter');
    expect(root.querySelector('.sci-result')?.textContent).toBe('42');
    const keys = [...root.querySelectorAll('.math-keyboard .key')];
    expect(keys.every((k) => (k.getAttribute('aria-label') ?? '').length > 0)).toBe(true);
    m.keyboard.press('shift');
    expect(root.querySelector('.key[data-key="fn-sin"]')?.textContent).toBe('sin⁻¹');
  });

  it('the keyboard has no key for a command the mode leaves out', () => {
    mount('graphing');
    m.modes.setMode('geometry');
    m.keyboard.open();
    const all = [...root.querySelectorAll<HTMLElement>('.math-keyboard .key')].map((k) => k.dataset['key']);
    expect(all).not.toContain('cmd-Derivative');
    expect(all).toContain('cmd-Midpoint');
  });

  it('the exam: rules, start, banner, inline block, finish, close (R10.5)', async () => {
    mount('graphing');
    m.session.applyLines(['f(x) = x^2'], 'test');
    expect(m.exam.button.hidden).toBe(false);
    m.exam.prepare('basic');
    expect(m.exam.startDialog.textContent).toMatch(/The app can't stop you leaving\. It only records it\./);
    m.exam.start(true);
    expect(m.exam.banner.hidden).toBe(false);
    expect(m.exam.banner.textContent).toMatch(/^🎓EXAM MODE · 60:00 left · tools limited/);
    expect(m.modes.setMode('geometry').ok).toBe(false);
    const input = root.querySelector<HTMLInputElement>('.expr-new .expr-input') as HTMLInputElement;
    input.value = 'd = Derivative(f)';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(root.querySelector('.expr-new .err-msg')?.textContent).toBe("Derivative is not available in exam profile 'basic' (mode: graphing).");
    expect(m.exam.startDialog.hasAttribute('open')).toBe(false);
    t = 125_000;
    for (const f of ticks) f();
    expect(m.exam.banner.textContent).toMatch(/57:55 left/);
    const s = m.exam.finish();
    expect(s?.blockedCommands).toEqual([{ command: 'Derivative', count: 1 }]);
    expect(m.exam.finishDialog.textContent).toMatch(/Exam finished/);
    expect(m.exam.finishDialog.textContent).toMatch(/Derivative ×1/);
    m.exam.close();
    expect(m.exam.banner.hidden).toBe(true);
    expect(m.session.submit('d = Derivative(f)').ok).toBe(true);
  });

  it('figure mode has no exam button', () => {
    mount('figure');
    expect(m.exam.button.hidden).toBe(true);
  });

  it('time text', () => {
    expect(clockText(3_600_000)).toBe('60:00');
    expect(clockText(61_500)).toBe('1:02');
  });
});
