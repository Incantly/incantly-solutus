/**
 * The windowed, incremental expression list (algebra-view design 3.16): only the rows in view plus 10 above and below
 * are in the page, a value change reads only those rows again, and the speed targets hold at 5,000 objects.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountStudio } from '../src/studio-page';
import type { Mounted } from '../src/studio-page';

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

/** One slider `a`, 2,499 free numbers and 2,500 numbers that read `a`. */
function bigScript(): string {
  const lines = ['a = 1 in 0..10 step 0.1'];
  for (let i = 0; i < 2499; i++) lines.push(`n${i} = ${i}`);
  for (let i = 0; i < 2500; i++) lines.push(`b${i} = a + ${i}`);
  return lines.join('\n');
}

describe('the windowed list', () => {
  let root: HTMLElement;
  let m: Mounted;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
    m = mountStudio(root, { raf: () => 1, caf: () => undefined });
  });
  afterEach(() => {
    m.dispose();
    root.remove();
  });
  const list = (): HTMLElement => root.querySelector('.exprs') as HTMLElement;
  const row = (name: string): HTMLElement | null => root.querySelector(`.expr[data-name="${name}"]`);
  const scrollTo = (y: number): void => {
    list().scrollTop = y;
    list().dispatchEvent(new Event('scroll'));
  };

  it('keeps only the rows in view, plus 10 above and below, in the page', () => {
    m.session.load(bigScript());
    const shown = root.querySelectorAll('.expr:not(.expr-new)').length;
    expect(shown).toBeGreaterThan(5);
    expect(shown).toBeLessThan(60);
    expect(row('a')).not.toBeNull();
    expect(row('b2499')).toBeNull();
    // the spacers stand in for the rest, so the list scrolls as far as all the rows would
    const spacer = [...root.querySelectorAll<HTMLElement>('.expr-spacer')].reduce((s, e) => s + parseFloat(e.style.height || '0'), 0);
    expect(spacer).toBeGreaterThan(4000 * 50);
  });

  it('a row scrolled into view shows the current value, even if it moved while out of view', () => {
    m.session.load(bigScript());
    m.session.slide('a', 5, true);
    scrollTo(58 * 4990);
    const b = row('b2490');
    expect(b).not.toBeNull();
    expect(b?.querySelector('.value')?.textContent ?? b?.textContent).toContain('2495');
    expect(row('a')).toBeNull();
  });

  it('a row in view follows a slider at once', () => {
    m.session.load('a = 1 in 0..10 step 0.1\nb = a + 1');
    m.session.slide('a', 3, false);
    expect(row('b')?.textContent).toContain('4');
    m.session.slide('a', 7, true);
    expect(row('b')?.textContent).toContain('8');
  });

  it('flash scrolls an off-screen row into the page', () => {
    m.session.load(bigScript());
    expect(row('b2000')).toBeNull();
    m.expressions.flash(['b2000']);
    expect(row('b2000')?.classList.contains('flash')).toBe(true);
  });

  it('a renamed input shows in the rows that read it', () => {
    m.session.load('a = 1\nb = a + 1');
    m.expressions.update();
    const r = m.session.rename('a', 'k');
    expect(r.ok).toBe(true);
    expect(row('b')?.textContent).toContain('k');
  });

  it('a new dependent shows in "used by" of a row already in the page', () => {
    m.session.load('a = 1\nb = a + 1');
    m.session.submit('c = 2 a');
    const toggle = row('a')?.querySelector<HTMLButtonElement>('.expr-toggle');
    toggle?.click();
    expect(row('a')?.querySelector('.expr-deps')?.textContent).toMatch(/used by.*b.*c/);
  });

  it('speed: a slider move on 5,000 objects costs the list under 4 ms (design 3.16)', () => {
    m.session.load(bigScript());
    const times: number[] = [];
    for (let k = 0; k < 21; k++) {
      m.session.figure.setFree('a', 2 + k * 0.1, 'slider');
      m.session.figure.flush();
      const t = performance.now();
      m.expressions.update();
      times.push(performance.now() - t);
    }
    expect(median(times)).toBeLessThan(4);
  });

  it('speed: a full render of 5,000 rows (viewport only) is under 100 ms', () => {
    m.session.load(bigScript());
    const times: number[] = [];
    for (let k = 0; k < 5; k++) {
      const t = performance.now();
      // a settings change forces the full path: every row of the model, then the window
      m.expressions.setPrefs({ format: { ...m.expressions.prefs().format, decimals: k + 1 } });
      times.push(performance.now() - t);
    }
    expect(median(times)).toBeLessThan(100);
  });
});
