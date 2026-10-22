// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { ManualClock, mountTrusted, type MountedFigure } from '../src';

const SCENE = {
  html: "<div id='stage'></div>",
  css: '',
  js: `
    inc.idea('Speed sets how far the ball goes.');
    const speed = inc.param('speed', { min: 0, max: 10, step: 1, value: 2, unit: 'm/s', label: 'Speed' });
    const model = inc.model(({ speed }) => ({ x: (t) => speed * t }));
    const stage = inc.svg('#stage', { viewBox: [0, 0, 100, 100], title: 'Ball', description: 'A ball on a line.' });
    const ball = stage.circle(0, 50, 4, { tone: 'hi' });
    inc.onFrame(({ time }) => { ball.at(model.x(time), 0); });
    inc.readout({ Speed: () => speed.value + ' m/s' });
    inc.explain(() => 'The ball moves at ' + speed.value + ' m/s.');
    inc.describe(() => 'A ball moving right at ' + speed.value + ' m/s.');
  `,
};

const mounted: MountedFigure[] = [];

function mount(options: Parameters<typeof mountTrusted>[2] = {}, scene = SCENE) {
  const clock = new ManualClock();
  const container = document.createElement('div');
  document.body.append(container);
  const figure = mountTrusted(container, scene, { clock, visibility: 'external', ...options });
  mounted.push(figure);
  return { figure, clock, container };
}

afterEach(() => {
  while (mounted.length) mounted.pop()?.destroy();
  document.body.replaceChildren();
  document.head.replaceChildren();
});

const input = (root: HTMLElement, selector: string) => root.querySelector<HTMLInputElement>(selector)!;

function setRange(element: HTMLInputElement, value: number) {
  element.value = String(value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('trusted mount and renderer', () => {
  it('builds the stage, controls, readouts and teaching text', () => {
    const { figure, clock } = mount();
    clock.advance();
    const root = figure.root;
    const svg = root.querySelector('#stage svg.inc-stage')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 100 100');
    expect(svg.getAttribute('role')).toBe('graphics-document');
    expect(svg.querySelector('title')?.textContent).toBe('Ball');
    expect(svg.querySelectorAll('g[data-layer]').length).toBe(4);
    expect(svg.querySelector('circle')?.getAttribute('class')).toBe('inc-tone-hi');
    expect(root.querySelector('.inc-idea')?.textContent).toBe('Speed sets how far the ball goes.');
    expect(root.querySelector('label')?.textContent).toBe('Speed (m/s)');
    expect(input(root, 'input[type=range]').max).toBe('10');
    expect(root.querySelector('.inc-readout__value')?.textContent).toBe('2 m/s');
    expect(root.querySelector('.inc-explain')?.textContent).toBe('The ball moves at 2 m/s.');
    expect(root.querySelector('.inc-describe p')?.textContent).toBe('A ball moving right at 2 m/s.');
    expect(document.querySelectorAll('style[data-incantly-theme]').length).toBe(1);
  });

  it('runs exactly one loop and stops it when paused and clean', () => {
    const { figure, clock } = mount();
    for (let i = 0; i < 5; i++) {
      expect(clock.pendingCount).toBeLessThanOrEqual(1);
      clock.advance();
    }
    figure.root.querySelector<HTMLButtonElement>('button[data-action=toggle]')!.click();
    clock.runUntilIdle();
    expect(clock.pendingCount).toBe(0);
    const requests = clock.requests;
    clock.advance();
    clock.advance();
    expect(clock.requests).toBe(requests);
    expect(figure.renderer.isRunning).toBe(false);
  });

  it('redraws on the next frame when a slider moves while paused', () => {
    const { figure, clock } = mount({ autoplay: false });
    clock.runUntilIdle();
    const circle = figure.root.querySelector('circle')!;
    clock.advance();
    expect(clock.pendingCount).toBe(0);

    // Fast slider input: several events, one frame, one draw.
    const range = input(figure.root, 'input[type=range]');
    setRange(range, 4);
    setRange(range, 5);
    setRange(range, 6);
    expect(clock.pendingCount).toBe(1);
    expect(figure.root.querySelector('.inc-readout__value')?.textContent).toBe('2 m/s');
    clock.advance();
    expect(figure.root.querySelector('.inc-readout__value')?.textContent).toBe('6 m/s');
    expect(input(figure.root, 'input[type=number]').value).toBe('6');
    expect(circle.getAttribute('transform')).toBeNull(); // time is still zero, so x stays at 0
    expect(figure.runtime.stats.pausedRedraws).toBe(2);
    expect(clock.pendingCount).toBe(0);
  });

  it('shows the value the figure took in the number field once the learner commits or leaves it (CT-2)', () => {
    const { figure, clock } = mount({ autoplay: false });
    clock.runUntilIdle();
    const number = input(figure.root, 'input[type=number]');
    number.focus();
    // 14 is above the maximum of 10: the figure takes 10, while the field keeps what is being typed.
    number.value = '14';
    number.dispatchEvent(new Event('input', { bubbles: true }));
    clock.runUntilIdle();
    expect(figure.root.querySelector('.inc-readout__value')?.textContent).toBe('10 m/s');
    expect(number.value).toBe('14');
    // Committed with Enter: the field shows 10, though it keeps the focus.
    number.dispatchEvent(new Event('change', { bubbles: true }));
    expect(number.value).toBe('10');
    expect(document.activeElement).toBe(number);
    // Left after typing 7.6: the figure snaps to 8, and so does the field once the learner leaves it.
    number.value = '7.6';
    number.dispatchEvent(new Event('input', { bubbles: true }));
    clock.runUntilIdle();
    number.blur();
    clock.runUntilIdle();
    expect(figure.root.querySelector('.inc-readout__value')?.textContent).toBe('8 m/s');
    expect(number.value).toBe('8');
  });

  it('writes nothing to the DOM when nothing changed', () => {
    const { figure, clock } = mount({ autoplay: false });
    clock.runUntilIdle();
    const writes = figure.renderer.scene.stats.writes;
    figure.renderer.send({ type: 'setParam', name: 'speed', value: 2 }); // unchanged value
    clock.runUntilIdle();
    expect(figure.renderer.scene.stats.writes).toBe(writes);
  });

  it('reports learner values for persistence', () => {
    const values: Array<Record<string, number>> = [];
    const { figure, clock } = mount({ autoplay: false, onValues: (v) => values.push({ ...v }) });
    clock.runUntilIdle();
    setRange(input(figure.root, 'input[type=range]'), 7);
    expect(values).toEqual([{ speed: 7 }]);
  });

  it('restarts and resets from the transport controls', () => {
    const { figure, clock } = mount();
    for (let i = 0; i < 10; i++) clock.advance();
    setRange(input(figure.root, 'input[type=range]'), 8);
    figure.root.querySelector<HTMLButtonElement>('button[data-action=restart]')!.click();
    expect(figure.runtime.time).toBe(0);
    expect(figure.runtime.values()).toEqual({ speed: 8 });
    expect(figure.root.querySelectorAll('svg.inc-stage').length).toBe(1);
    figure.root.querySelector<HTMLButtonElement>('button[data-action=reset]')!.click();
    expect(figure.runtime.values()).toEqual({ speed: 2 });
    clock.advance();
    expect(input(figure.root, 'input[type=range]').value).toBe('2');
  });

  it('shows a friendly error, keeps the controls and reports the error to the host', () => {
    const errors: string[] = [];
    const { figure, clock } = mount(
      { onError: (e) => errors.push(e.message) },
      { ...SCENE, js: SCENE.js + "\ninc.onFrame(({ time }) => { if (time > 0.03) throw new Error('late failure'); });" },
    );
    for (let i = 0; i < 5; i++) clock.advance();
    const banner = figure.root.querySelector<HTMLElement>('.inc-error')!;
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).not.toContain('late failure');
    expect(errors).toEqual(['late failure']);
    expect(figure.root.querySelector('input[type=range]')).not.toBeNull();
  });

  it('applies a fixed theme and scopes ids per figure', () => {
    const a = mount({ theme: 'dark' }).figure;
    const b = mount().figure;
    expect(a.root.dataset.theme).toBe('dark');
    const idA = a.root.querySelector('svg title')!.id;
    const idB = b.root.querySelector('svg title')!.id;
    expect(idA).not.toBe(idB);
  });

  it('hides play, restart and speed for a still scene, and keeps reset', () => {
    const { figure, clock } = mount(
      {},
      {
        html: "<div id='stage'></div>",
        css: '',
        js: `
          const k = inc.param('k', { min: 0, max: 10, value: 2 });
          const stage = inc.svg('#stage', { viewBox: [0, 0, 100, 100], title: 'Bar' });
          const bar = stage.line(0, 0, 0, 0);
          inc.onFrame(() => bar.set({ x2: k.value * 10 }));
        `,
      },
    );
    const visible = (selector: string) => !figure.root.querySelector<HTMLElement>(selector)!.closest('[hidden]');
    expect(visible('button[data-action=toggle]')).toBe(true);
    clock.runUntilIdle();
    expect(visible('button[data-action=toggle]')).toBe(false);
    expect(visible('button[data-action=restart]')).toBe(false);
    expect(visible('select[data-action=speed]')).toBe(false);
    expect(visible('button[data-action=reset]')).toBe(true);
    expect(clock.pendingCount).toBe(0);
  });

  it('stops all work after destroy', () => {
    const { figure, clock } = mount();
    clock.advance();
    figure.destroy();
    mounted.pop();
    expect(clock.pendingCount).toBe(0);
    expect(figure.runtime.isDestroyed).toBe(true);
    clock.advance();
    expect(figure.renderer.stats.ticksSent).toBe(1);
  });
});
