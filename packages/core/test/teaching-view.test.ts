// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManualClock, mountTrusted, type MountedFigure } from '../src';
import { SETTLE_ANNOUNCE_MS } from '../src/renderer/renderer';
import { PART_HINT } from '../src/renderer/teaching';

const SCENE = {
  html: "<div id='stage'></div>",
  css: '',
  js: `
    inc.idea('Two bars show two numbers.');
    const a = inc.param('a', { min: 0, max: 10, step: 0.5, value: 2, label: 'A' });
    const b = inc.param('b', { min: 0, max: 10, step: 0.5, value: 4, label: 'B' });
    const stage = inc.svg('#stage', { viewBox: [0, 0, 100, 100], title: 'Bars', description: 'Two vertical bars.' });
    const barA = stage.line(10, 90, 10, 50, { tone: 'a' });
    const barB = stage.line(30, 90, 30, 50, { tone: 'b' });
    const base = stage.line(0, 90, 100, 90, { tone: 'faint' });
    stage.part('A', barA, { label: 'Bar A', info: 'Its height is a.' });
    stage.part('B', barB, { label: 'Bar B', info: 'Its height is b.' });
    inc.onFrame(() => {
      barA.set({ y2: 90 - a.value * 8 });
      barB.set({ y2: 90 - b.value * 8 });
    });
    inc.describe(() => 'Bar A is ' + a.value + ' and bar B is ' + b.value + '.');
    inc.steps([
      { say: 'Bar A grows with a.', focus: 'A', set: { a: 6 } },
      { say: 'Bar B holds still.', focus: 'B', hold: true },
      { say: 'Both together.', set: { a: 10, b: 10 } },
    ]);
  `,
};

const mounted: MountedFigure[] = [];

function mount(options: Parameters<typeof mountTrusted>[2] = {}) {
  const clock = new ManualClock();
  const container = document.createElement('div');
  document.body.append(container);
  const figure = mountTrusted(container, SCENE, { clock, visibility: 'external', reducedMotion: true, ...options });
  mounted.push(figure);
  clock.runUntilIdle();
  return { figure, clock, root: figure.root };
}

afterEach(() => {
  while (mounted.length) mounted.pop()?.destroy();
  document.body.replaceChildren();
  document.head.replaceChildren();
  vi.restoreAllMocks();
});

const q = <T extends Element = HTMLElement>(root: Element, selector: string) => root.querySelector<T>(selector)!;
const stepButton = (root: Element, action: string) => q<HTMLButtonElement>(root, `button[data-step=${action}]`);
const part = (root: Element, name: string) => q<SVGElement>(root, `[data-part="${name}"]`);
const key = (target: Element, name: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
const pointer = (type: string, target: Element, pointerType: string, relatedTarget: Element | null = null) =>
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType, relatedTarget }));

describe('teaching view: the walkthrough', () => {
  it('offers the walkthrough with its length and keeps it closed until asked', () => {
    const { root } = mount();
    const region = q(root, '.inc-steps');
    expect(region.hidden).toBe(false);
    expect(region.getAttribute('role')).toBe('group');
    expect(region.getAttribute('aria-label')).toBe('Walkthrough');
    expect(stepButton(root, 'enter').textContent).toBe('Walk me through it');
    expect(q(root, '.inc-steps__count').textContent).toBe('3 steps');
    expect(q(root, '.inc-steps__active').hidden).toBe(true);
  });

  it('enters on click, shows the step text and progress, and moves focus into the walkthrough', () => {
    const { root, figure, clock } = mount();
    const start = stepButton(root, 'enter');
    start.focus();
    start.click();
    clock.runUntilIdle();
    expect(start.hidden).toBe(true);
    expect(q(root, '.inc-steps__say').textContent).toBe('Bar A grows with a.');
    expect(q(root, '.inc-steps__progress').textContent).toBe('Step 1 of 3');
    expect(stepButton(root, 'prev').getAttribute('aria-disabled')).toBe('true');
    expect(stepButton(root, 'next').hasAttribute('aria-disabled')).toBe(false);
    expect(document.activeElement).toBe(stepButton(root, 'next'));
    expect(q(root, '.inc-steps [aria-live]').textContent).toBe('Step 1 of 3. Bar A grows with a.');
    expect(figure.runtime.values()).toEqual({ a: 6, b: 4 });
    expect(q<HTMLInputElement>(root, 'input[data-param=a][type=range]').value).toBe('6');
  });

  it('moves with Next and Back, ignoring disabled ends', () => {
    const { root, figure } = mount();
    stepButton(root, 'enter').click();
    stepButton(root, 'prev').click();
    expect(figure.runtime.currentStep).toBe(0);
    stepButton(root, 'next').click();
    stepButton(root, 'next').click();
    expect(q(root, '.inc-steps__progress').textContent).toBe('Step 3 of 3');
    expect(stepButton(root, 'next').getAttribute('aria-disabled')).toBe('true');
    stepButton(root, 'next').click();
    expect(figure.runtime.currentStep).toBe(2);
    stepButton(root, 'prev').click();
    expect(figure.runtime.currentStep).toBe(1);
  });

  it('supports the arrow keys, Home and End, and Escape returns focus to the start button', () => {
    const { root, figure } = mount();
    const start = stepButton(root, 'enter');
    start.focus();
    start.click();
    const next = stepButton(root, 'next');
    expect(key(next, 'ArrowRight')).toBe(false); // handled, so the default is prevented
    expect(figure.runtime.currentStep).toBe(1);
    key(next, 'End');
    expect(figure.runtime.currentStep).toBe(2);
    key(next, 'ArrowLeft');
    expect(figure.runtime.currentStep).toBe(1);
    key(next, 'Home');
    expect(figure.runtime.currentStep).toBe(0);
    expect(key(next, 'x')).toBe(true);
    key(next, 'Escape');
    expect(figure.runtime.currentStep).toBeNull();
    expect(document.activeElement).toBe(start);
    expect(start.hidden).toBe(false);
    expect(q(root, '.inc-steps [aria-live]').textContent).toBe('Walkthrough closed. Your own values are back.');
  });

  it('restores the learner values when the walkthrough ends', () => {
    const { root, figure, clock } = mount();
    const range = q<HTMLInputElement>(root, 'input[data-param=b][type=range]');
    range.value = '7';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    stepButton(root, 'enter').click();
    stepButton(root, 'next').click();
    stepButton(root, 'next').click();
    expect(figure.runtime.values()).toEqual({ a: 10, b: 10 });
    stepButton(root, 'exit').click();
    clock.runUntilIdle();
    expect(figure.runtime.values()).toEqual({ a: 2, b: 7 });
    expect(range.value).toBe('7');
  });

  it('reports step positions to the host and restores a saved position', () => {
    const steps: Array<number | null> = [];
    const { root } = mount({ onStep: (step) => steps.push(step) });
    stepButton(root, 'enter').click();
    stepButton(root, 'next').click();
    stepButton(root, 'exit').click();
    expect(steps).toEqual([0, 1, null]);

    const restored = mount({ step: 1 }).root;
    expect(q(restored, '.inc-steps__progress').textContent).toBe('Step 2 of 3');
    // Restoring is not news: nothing is announced on load.
    expect(q(restored, '.inc-steps [aria-live]').textContent).toBe('');
  });

  it('leaves the walkthrough when the figure restarts', () => {
    const { root } = mount();
    stepButton(root, 'enter').click();
    q<HTMLButtonElement>(root, 'button[data-action=restart]').click();
    expect(stepButton(root, 'enter').hidden).toBe(false);
    expect(q(root, '.inc-steps__active').hidden).toBe(true);
  });
});

describe('teaching view: part highlighting', () => {
  it('highlights the step part and dims the rest of the drawing', () => {
    const { root } = mount();
    expect(root.classList.contains('has-focus')).toBe(false);
    stepButton(root, 'enter').click();
    expect(part(root, 'A').classList.contains('is-focus')).toBe(true);
    expect(root.classList.contains('has-focus')).toBe(true);
    stepButton(root, 'next').click();
    expect(part(root, 'A').classList.contains('is-focus')).toBe(false);
    expect(part(root, 'B').classList.contains('is-focus')).toBe(true);
    stepButton(root, 'next').click(); // the last step has no focus
    expect(root.classList.contains('has-focus')).toBe(false);
    expect(root.querySelectorAll('.is-focus').length).toBe(0);
  });

  it('highlights a part under the mouse and names it under the drawing', () => {
    const { root } = mount();
    const info = q(root, '.inc-part-info');
    expect(info.textContent).toBe(PART_HINT);
    expect(info.classList.contains('is-hint')).toBe(true);
    pointer('pointerover', part(root, 'B'), 'mouse');
    expect(part(root, 'B').classList.contains('is-focus')).toBe(true);
    expect(info.textContent).toBe('Bar B: Its height is b.');
    expect(info.classList.contains('is-hint')).toBe(false);
    pointer('pointerout', part(root, 'B'), 'mouse', q(root, 'svg.inc-stage'));
    expect(part(root, 'B').classList.contains('is-focus')).toBe(false);
    expect(info.textContent).toBe(PART_HINT);
  });

  it('lets hover override the step focus, then hands it back', () => {
    const { root } = mount();
    stepButton(root, 'enter').click();
    const info = q(root, '.inc-part-info');
    expect(info.textContent).toBe(PART_HINT); // the step text already explains its own part
    pointer('pointerover', part(root, 'B'), 'mouse');
    expect(part(root, 'B').classList.contains('is-focus')).toBe(true);
    expect(part(root, 'A').classList.contains('is-focus')).toBe(false);
    pointer('pointerout', part(root, 'B'), 'mouse', null);
    expect(part(root, 'A').classList.contains('is-focus')).toBe(true);
  });

  it('highlights a part that receives keyboard focus', () => {
    const { root } = mount();
    const a = part(root, 'A');
    expect(a.getAttribute('tabindex')).toBe('0');
    expect(a.getAttribute('role')).toBe('graphics-symbol');
    expect(a.getAttribute('aria-label')).toBe('Bar A: Its height is a.');
    a.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(a.classList.contains('is-focus')).toBe(true);
    a.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: part(root, 'B') }));
    part(root, 'B').dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: a }));
    expect(part(root, 'B').classList.contains('is-focus')).toBe(true);
    expect(a.classList.contains('is-focus')).toBe(false);
    part(root, 'B').dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    expect(root.querySelectorAll('.is-focus').length).toBe(0);
  });

  it('toggles the highlight with a tap, since touch has no hover', () => {
    const { root } = mount();
    const a = part(root, 'A');
    pointer('pointerover', a, 'touch');
    expect(a.classList.contains('is-focus')).toBe(false);
    pointer('pointerdown', a, 'touch');
    a.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(a.classList.contains('is-focus')).toBe(true);
    pointer('pointerdown', a, 'touch');
    a.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(a.classList.contains('is-focus')).toBe(false);
  });

  it('keeps the highlight through class rewrites and highlights rebuilt parts after a reset', () => {
    const { root } = mount();
    stepButton(root, 'enter').click();
    q<HTMLButtonElement>(root, 'button[data-action=reset]').click();
    expect(root.querySelectorAll('.is-focus').length).toBe(0);
    pointer('pointerover', part(root, 'B'), 'mouse');
    expect(part(root, 'B').classList.contains('is-focus')).toBe(true);
    expect(part(root, 'B').isConnected).toBe(true);
  });

  it('hides the part line for figures without parts', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const figure = mountTrusted(
      container,
      { html: "<div id='s'></div>", css: '', js: "inc.svg('#s', { viewBox: [0, 0, 10, 10], title: 'Empty' });" },
      { clock: new ManualClock(), visibility: 'external' },
    );
    mounted.push(figure);
    expect(q(figure.root, '.inc-part-info').hidden).toBe(true);
    expect(q(figure.root, '.inc-steps').hidden).toBe(true);
  });
});

describe('renderer announcements', () => {
  it('announces the readouts once a learner change settles, not on every input or frame', () => {
    vi.useFakeTimers();
    try {
      const container = document.createElement('div');
      document.body.append(container);
      const clock = new ManualClock();
      const figure = mountTrusted(
        container,
        {
          html: "<div id='s'></div>",
          css: '',
          js: `
            const k = inc.param('k', { min: 0, max: 10, step: 1, value: 1, label: 'K' });
            inc.svg('#s', { viewBox: [0, 0, 10, 10], title: 'K' });
            inc.readout({ Double: () => String(k.value * 2), Time: () => 'always changing' });
          `,
        },
        { clock, visibility: 'external', autoplay: false },
      );
      mounted.push(figure);
      clock.runUntilIdle();
      const live = figure.root.querySelector<HTMLElement>(':scope > [aria-live]')!;
      expect(figure.root.querySelector('.inc-readouts')?.hasAttribute('aria-live')).toBe(false);
      const range = figure.root.querySelector<HTMLInputElement>('input[type=range]')!;
      for (const value of [2, 3, 4]) {
        range.value = String(value);
        range.dispatchEvent(new Event('input', { bubbles: true }));
        clock.runUntilIdle();
        vi.advanceTimersByTime(SETTLE_ANNOUNCE_MS / 2);
      }
      expect(live.textContent).toBe('');
      vi.advanceTimersByTime(SETTLE_ANNOUNCE_MS);
      expect(live.textContent).toBe('Double 8. Time always changing.');

      // Back to the same readouts: nothing new to say.
      live.textContent = '';
      range.value = '4';
      range.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(SETTLE_ANNOUNCE_MS * 2);
      expect(live.textContent).toBe('');

      // Destroy cancels a pending announcement.
      range.value = '5';
      range.dispatchEvent(new Event('input', { bubbles: true }));
      figure.destroy();
      mounted.pop();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('teaching view: text alternative and motion preferences', () => {
  it('links the live description to the drawing and keeps a print copy', () => {
    const { root } = mount();
    const svg = q(root, 'svg.inc-stage');
    const copy = q(root, '.inc-print-only');
    expect(svg.getAttribute('aria-describedby')?.split(' ')).toContain(copy.id);
    expect(q(root, '.inc-describe p').textContent).toBe('Bar A is 2 and bar B is 4.');
    expect(copy.textContent).toBe('Bar A is 2 and bar B is 4.');
  });

  it('places part notes under the drawing, teaching above the controls and the description last', () => {
    const { root } = mount();
    const order = [...root.children].map((el) => el.className.split(' ')[0]);
    expect(order).toEqual([
      'inc-idea',
      'inc-scene',
      'inc-error',
      'inc-part-info',
      'inc-readouts',
      'inc-teaching',
      'inc-controls',
      'inc-description',
      'inc-visually-hidden',
    ]);
  });

  it('pauses when the learner turns on reduced motion while the figure is open', () => {
    const listeners: Array<(event: { matches: boolean }) => void> = [];
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: false,
          media: query,
          addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => listeners.push(listener),
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
    const { figure } = mount({ reducedMotion: false, autoplay: true });
    expect(figure.runtime.playing).toBe(true);
    expect(listeners.length).toBe(1);
    listeners[0]!({ matches: true });
    expect(figure.runtime.playing).toBe(false);
    expect(q(figure.root, 'button[data-action=toggle]').textContent).toBe('Play');
  });
});
