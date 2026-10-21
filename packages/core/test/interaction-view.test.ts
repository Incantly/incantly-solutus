// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InThreadChannel, ManualClock, mountTrusted, type MountedFigure } from '../src';
import type { RendererMessage } from '../src/protocol/runtime-messages';
import { mathElement, symbolText } from '../src/renderer/math';
import { FORMULA_SETTLE_MS } from '../src/renderer/panels';
import { hostCss, resolveStyle, styleForBridge } from '../src/renderer/style';

const mounted: MountedFigure[] = [];

function mount(js: string, options: Parameters<typeof mountTrusted>[2] = {}, html = "<div id='stage'></div>") {
  const clock = new ManualClock();
  const container = document.createElement('div');
  document.body.append(container);
  // Every message from the renderer to the runtime passes the channel.
  const sent: RendererMessage[] = [];
  const send = InThreadChannel.prototype.send;
  vi.spyOn(InThreadChannel.prototype, 'send').mockImplementation(function (this: InThreadChannel, message) {
    if (message.type !== 'tick' && message.type !== 'visible') sent.push(message);
    send.call(this, message);
  });
  const figure = mountTrusted(container, { html, css: '', js }, { clock, visibility: 'external', reducedMotion: true, autoplay: false, ...options });
  mounted.push(figure);
  clock.runUntilIdle();
  return { figure, clock, root: figure.root, sent };
}

afterEach(() => {
  while (mounted.length) mounted.pop()?.destroy();
  document.body.replaceChildren();
  document.head.replaceChildren();
  vi.restoreAllMocks();
});

const q = <T extends Element = HTMLElement>(root: Element, selector: string) => root.querySelector<T>(selector)!;
const press = (target: Element, type: string, init: PointerEventInit = {}) =>
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, ...init }));
const key = (target: Element, name: string, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));

const PENDULUM = `
  inc.idea('A pendulum swings back and forth.');
  const angle = inc.param('angle', { min: -60, max: 60, step: 1, value: 0, label: 'Angle', unit: 'degrees' });
  const stage = inc.svg('#stage', { viewBox: [0, 0, 200, 200], title: 'Pendulum' });
  const rod = stage.line(100, 20, 100, 120, { tone: 'mid' });
  const bob = stage.circle(100, 120, 10, { tone: 'lit' });
  stage.part('Bob', bob, { label: 'The bob', info: 'Drag it sideways.' });
  stage.drag(bob, ({ x, y }) => ({ angle: Math.atan2(x - 100, y - 20) * 180 / Math.PI }));
  inc.onFrame(() => {
    const r = angle.value * Math.PI / 180;
    bob.set({ cx: 100 + 100 * Math.sin(r), cy: 20 + 100 * Math.cos(r) });
    rod.set({ x2: 100 + 100 * Math.sin(r), y2: 20 + 100 * Math.cos(r) });
  });
  inc.describe(() => 'The pendulum hangs at ' + angle.value + ' degrees.');
`;

describe('dragging in the drawing (EN-6, SV-8, VI-4)', () => {
  it('drags an element: start, coalesced moves, end, in stage coordinates', () => {
    const { root, clock, sent, figure } = mount(PENDULUM);
    const bob = q(root, '[data-drag]');
    expect(bob.getAttribute('tabindex')).toBe('0');
    expect(bob.getAttribute('aria-label')).toContain('Drag');
    expect(bob.classList.contains('inc-draggable')).toBe(true);
    press(bob, 'pointerdown', { clientX: 100, clientY: 120 });
    press(bob, 'pointermove', { clientX: 140, clientY: 110 });
    press(bob, 'pointermove', { clientX: 186.6, clientY: 70 });
    clock.runUntilIdle();
    press(bob, 'pointerup', { clientX: 186.6, clientY: 70 });
    clock.runUntilIdle();
    const drags = sent.filter((m) => m.type === 'drag');
    // Two moves in one frame become one message.
    expect(drags.map((m) => (m as { phase: string }).phase)).toEqual(['start', 'move', 'end']);
    expect(figure.runtime.values().angle).toBe(60);
    expect(root.querySelector('.inc-hint')?.textContent).toBe('Drag Bob or change the values below.');
  });

  it('nudges a focused draggable with the arrow keys', () => {
    const { root, sent, figure } = mount(PENDULUM);
    const bob = q(root, '[data-drag]');
    vi.spyOn(bob as unknown as SVGGraphicsElement, 'getBBox').mockReturnValue({ x: 90, y: 110, width: 20, height: 20 } as DOMRect);
    bob.focus();
    key(bob, 'ArrowRight', { shiftKey: true });
    expect(sent.filter((m) => m.type === 'drag')).toHaveLength(3);
    expect(figure.runtime.values().angle).toBe(11);
  });
});

describe('zooming and panning a drawing (SV-9, VI-1, VI-2)', () => {
  it('zooms the view box about the pointer once the stage is active, and resets on a double click', () => {
    const { root } = mount(PENDULUM);
    const svg = q<SVGSVGElement>(root, 'svg.inc-stage');
    const host = q(root, '.inc-stage-host');
    // Until the learner taps the stage, the wheel scrolls the page.
    const ignored = new WheelEvent('wheel', { deltaY: -100, clientX: 100, clientY: 100, bubbles: true, cancelable: true });
    svg.dispatchEvent(ignored);
    expect(ignored.defaultPrevented).toBe(false);
    expect(svg.getAttribute('viewBox')).toBe('0 0 200 200');
    press(svg, 'pointerdown', { clientX: 100, clientY: 100 });
    press(svg, 'pointerup', { clientX: 100, clientY: 100 });
    expect(host.classList.contains('is-active')).toBe(true);
    const wheel = new WheelEvent('wheel', { deltaY: -400, clientX: 100, clientY: 100, bubbles: true, cancelable: true });
    svg.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    const [, , w] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    expect(w).toBeLessThan(200);
    expect(svg.hasAttribute('data-zoomed')).toBe(true);
    expect(q<HTMLButtonElement>(root, '.inc-zoombar button[data-view="reset"]').disabled).toBe(false);
    svg.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(svg.getAttribute('viewBox')).toBe('0 0 200 200');
    key(svg, 'Escape');
    expect(host.classList.contains('is-active')).toBe(false);
  });

  it('zooms by steps from the toolbar', () => {
    const { root } = mount(PENDULUM);
    const svg = q<SVGSVGElement>(root, 'svg.inc-stage');
    q<HTMLButtonElement>(root, '.inc-zoombar button[data-view="in"]').click();
    expect(svg.getAttribute('viewBox')).not.toBe('0 0 200 200');
    q<HTMLButtonElement>(root, '.inc-zoombar button[data-view="reset"]').click();
    expect(svg.getAttribute('viewBox')).toBe('0 0 200 200');
    q<HTMLButtonElement>(root, '.inc-zoombar button[data-view="in"]').click();
    expect(svg.getAttribute('viewBox')).toBe('33.333 33.333 133.333 133.333');
  });

  it('sends view messages for a graph, whose kit re-ranges the axes', () => {
    const { root, clock, sent, figure } = mount(`
      const g = inc.graph2d('#stage', { x: [-10, 10], y: [-5, 5], title: 'Graph' });
      g.plot((x) => x);
    `);
    const svg = q<SVGSVGElement>(root, 'svg.inc-stage');
    expect(svg.dataset.zoom).toBe('runtime');
    expect(q(root, '.inc-zoombar button[data-view="fit"]')).toBeTruthy();
    press(svg, 'pointerdown', { clientX: 396, clientY: 180 });
    press(svg, 'pointerup', { clientX: 396, clientY: 180 });
    svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, clientX: 396, clientY: 180, bubbles: true, cancelable: true }));
    clock.runUntilIdle();
    expect(sent.some((m) => m.type === 'view' && m.action.kind === 'zoom')).toBe(true);
    expect(figure.runtime.uiState().views[0]!.changed).toBe(true);
    // The kit, not the view box, changed: the axes re-ticked.
    expect(svg.getAttribute('viewBox')).toBe('0 0 760 380');
    q<HTMLButtonElement>(root, '.inc-zoombar button[data-view="reset"]').click();
    clock.runUntilIdle();
    expect(figure.runtime.uiState().views[0]!.changed).toBe(false);
  });

  it('reports hovering over a stage that traces', () => {
    const { root, clock, sent } = mount(`
      const g = inc.graph2d('#stage', { x: [0, 10], y: [0, 10], title: 'Trace' });
      g.trace(g.plot((x) => x));
    `);
    const svg = q<SVGSVGElement>(root, 'svg.inc-stage');
    press(svg, 'pointermove', { clientX: 200, clientY: 100, buttons: 0 });
    clock.runUntilIdle();
    expect(sent.find((m) => m.type === 'hover')).toMatchObject({ type: 'hover', x: 200, y: 100 });
    expect([...root.querySelectorAll('svg text')].some((t) => t.textContent?.startsWith('(2.15'))).toBe(true);
  });
});

describe('controls (CT-3, CT-5, CT-6, CT-9)', () => {
  const CONTROLS = `
    const air = inc.toggle('air', { value: false, label: 'Air' });
    const planet = inc.choice('planet', { options: ['Earth', 'Moon'], buttons: true, label: 'Planet' });
    const where = inc.choice('where', { options: ['Inside', 'Outside'], label: 'Where' });
    const paint = inc.color('paint', { value: 'a', options: ['a', 'b'], label: 'Paint' });
    const g = inc.param('g', { min: 1, max: 20, value: 9.8, step: 0.1, label: 'Gravity' });
    inc.presets({ Moon: { g: 1.6 } });
    inc.button('Drop', () => ({ g: 5 }));
    inc.timeline({ duration: 2 });
    const stage = inc.svg('#stage', { viewBox: [0, 0, 10, 10], title: 'Controls' });
    const dot = stage.circle(5, 5, 1);
    inc.onFrame(({ progress }) => dot.set({ cx: 2 + 6 * progress }).tone(paint.tone));
  `;

  it('builds a switch, segmented buttons, a menu and swatches, each sending its parameter', () => {
    const { root, sent, figure } = mount(CONTROLS);
    const toggle = q<HTMLInputElement>(root, 'input.inc-switch');
    expect(toggle.getAttribute('role')).toBe('switch');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('input', { bubbles: true }));
    q<HTMLButtonElement>(root, '.inc-segmented button[data-value="1"]').click();
    const select = q<HTMLSelectElement>(root, '.inc-param--choice select');
    select.value = '1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    q<HTMLButtonElement>(root, '.inc-swatches button[data-value="1"]').click();
    expect(figure.runtime.values()).toMatchObject({ air: 1, planet: 1, where: 1, paint: 1 });
    expect(sent.filter((m) => m.type === 'setParam')).toHaveLength(4);
    expect(q(root, '.inc-swatches button[data-value="1"]').getAttribute('aria-label')).toBe('Blue');
  });

  it('runs presets and buttons, then undoes and redoes, also with Ctrl+Z', () => {
    const { root, figure } = mount(CONTROLS);
    const preset = q<HTMLButtonElement>(root, '.inc-actions button.inc-chip');
    preset.click();
    expect(figure.runtime.values().g).toBe(1.6);
    expect(preset.getAttribute('aria-pressed')).toBe('true');
    q<HTMLButtonElement>(root, '.inc-actions button.inc-action').click();
    expect(figure.runtime.values().g).toBe(5);
    const undo = q<HTMLButtonElement>(root, 'button[data-action="undo"]');
    expect(undo.hasAttribute('aria-disabled')).toBe(false);
    undo.click();
    expect(figure.runtime.values().g).toBe(1.6);
    key(q(root, '.inc-controls'), 'z', { ctrlKey: true, shiftKey: true });
    expect(figure.runtime.values().g).toBe(5);
  });

  it('opens a settings panel with the timeline, a frame-rate cap and a frame step', () => {
    const { root, figure } = mount(CONTROLS);
    const gear = q<HTMLButtonElement>(root, 'button[data-action="settings"]');
    const panel = q(root, '.inc-settings');
    expect(panel.hidden).toBe(true);
    gear.click();
    expect(panel.hidden).toBe(false);
    expect(gear.getAttribute('aria-expanded')).toBe('true');
    const loop = q<HTMLSelectElement>(root, 'select[data-setting="loop"]');
    loop.value = 'pingpong';
    loop.dispatchEvent(new Event('change', { bubbles: true }));
    const duration = q<HTMLInputElement>(root, 'input[data-setting="duration"]');
    duration.value = '4';
    duration.dispatchEvent(new Event('change', { bubbles: true }));
    expect(figure.runtime.uiState().timing).toEqual({ duration: 4, loop: 'pingpong', ease: 'linear' });
    q<HTMLButtonElement>(root, 'button[data-action="frame"]').click();
    expect(figure.runtime.time).toBeCloseTo(1 / 60);
  });
});

describe('panels: legend, formulas, prediction and tables', () => {
  it('switches labelled series off from the legend', () => {
    const { root, figure } = mount(`
      const g = inc.graph2d('#stage', { x: [0, 1], y: [0, 1], title: 'Two lines' });
      g.plot((x) => x, { label: 'Up', tone: 'b' });
      g.plot((x) => 1 - x, { label: 'Down', tone: 'c', dashed: true });
    `);
    const items = [...root.querySelectorAll('.inc-legend__item')];
    expect(items.map((i) => i.textContent)).toEqual(['Up', 'Down']);
    expect(q(root, '.inc-legend__swatch.is-dashed')).toBeTruthy();
    q<HTMLButtonElement>(root, '.inc-legend__toggle').click();
    expect(figure.runtime.uiState().legend[0]!.visible).toBe(false);
    expect(q(root, '.inc-legend__toggle').getAttribute('aria-pressed')).toBe('false');
  });

  it('shows formulas as maths and tries the learner’s edit after they pause', () => {
    vi.useFakeTimers();
    const { root, figure } = mount(`
      const k = inc.param('k', { min: 1, max: 3, value: 2 });
      const f = inc.formula('k*x^2/2', { vars: { k }, editable: true, label: 'Energy' });
      const g = inc.graph2d('#stage', { x: [0, 2], y: [0, 4], title: 'Energy' });
      g.plot(f);
    `);
    const math = q(root, '.inc-formula__math math');
    expect(math.querySelector('mfrac')).toBeTruthy();
    expect(math.querySelector('msup')).toBeTruthy();
    const input = q<HTMLInputElement>(root, '.inc-formula__input');
    input.value = 'k*x';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(figure.runtime.uiState().formulas[0]!.source).toBe('k*x^2/2');
    vi.advanceTimersByTime(FORMULA_SETTLE_MS + 10);
    expect(figure.runtime.uiState().formulas[0]!.source).toBe('k*x');
    input.value = 'k*';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(FORMULA_SETTLE_MS + 10);
    expect(q(root, '.inc-formula__error').hidden).toBe(false);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    vi.useRealTimers();
  });

  it('asks a prediction before revealing it, and fills tables', () => {
    const { root, figure, clock } = mount(`
      const a = inc.param('a', { min: 0, max: 10, value: 2 });
      inc.predict({ question: 'What happens to b?', options: ['Up', 'Down'], answer: 0, reveal: { a: 8 }, explain: 'It goes up with a.' });
      inc.table({ title: 'Values', columns: ['a', 'b'], rows: () => [[a.value, a.value * 2]] });
      inc.svg('#stage', { viewBox: [0, 0, 10, 10], title: 'Predict' }).circle(5, 5, 1);
    `);
    const reveal = q<HTMLButtonElement>(root, 'button[data-reveal]');
    expect(reveal.getAttribute('aria-disabled')).toBe('true');
    q<HTMLButtonElement>(root, 'button[data-option="1"]').click();
    reveal.click();
    clock.runUntilIdle();
    expect(figure.runtime.uiState().predict).toMatchObject({ revealed: true, answer: 0 });
    expect(q(root, '.inc-predict__result').textContent).toBe('It is “Up”. It goes up with a.');
    expect(q(root, 'button[data-option="0"]').classList.contains('is-answer')).toBe(true);
    expect([...root.querySelectorAll('.inc-table td')].map((td) => td.textContent)).toEqual(['8', '16']);
  });
});

describe('integrator styles', () => {
  it('applies a preset, layout, tokens, slot classes and hidden parts', () => {
    const { root } = mount(PENDULUM, {
      style: {
        preset: 'glass',
        tokens: { lit: '#7c3aed', radius: '20px', 'bad name': 'red', a: 'url(https://x)', font: "'Inter', sans-serif" },
        classNames: { button: 'rounded-full bg-white/20 backdrop-blur', slider: 'accent-violet-600', figure: 'shadow-xl' },
        layout: { controls: 'right', sceneHeight: '320px', size: 'lg', panelWidth: '280px' },
        show: { speed: false, description: false },
      },
      figureNumber: 3,
    });
    expect(root.dataset.preset).toBe('glass');
    expect(root.dataset.layout).toBe('right');
    expect(root.dataset.size).toBe('lg');
    expect(root.style.getPropertyValue('--inc-lit')).toBe('#7c3aed');
    expect(root.style.getPropertyValue('--inc-radius')).toBe('20px');
    expect(root.style.getPropertyValue('--inc-a')).toBe('');
    expect(root.style.getPropertyValue('--inc-scene-height')).toBe('320px');
    expect(root.classList.contains('shadow-xl')).toBe(true);
    expect(q(root, 'button[data-action="toggle"]').classList.contains('bg-white/20')).toBe(true);
    expect(q(root, 'input[type=range]').classList.contains('accent-violet-600')).toBe(true);
    expect(q(root, '.inc-speed').hidden).toBe(true);
    expect(root.hasAttribute('data-hide-description')).toBe(true);
    expect(q(root, '.inc-title').textContent).toBe('Figure 3 · Pendulum');
  });

  it('checks styles before they cross into a frame', () => {
    const style = resolveStyle({ preset: 'nope' as never, layout: { controls: 'sideways' as never, sceneHeight: '100px; color: red' } });
    expect(style.preset).toBe('default');
    expect(style.layout.controls).toBe('below');
    expect(style.layout.sceneHeight).toBeUndefined();
    expect(resolveStyle({ classNames: { button: 'ok <script> also-ok' } }).classNames.button).toBe('ok also-ok');
    expect(styleForBridge({ css: '.x{}', preset: 'soft' })).not.toHaveProperty('css');
    expect(hostCss({ css: '.a::before { content: "<" }' })).toBe('.a::before { content: "\\3c " }');
    expect(hostCss({ css: '</style><script>' })).toBe('');
  });
});

describe('rendered maths (FM-4)', () => {
  it('writes fractions, powers, roots, absolute values and Greek letters as MathML', () => {
    const math = mathElement(document, '(1/2)*m*v0^2 + sqrt(abs(theta))', 'E')!;
    expect(math.querySelector('mfrac')).toBeTruthy();
    expect(math.querySelector('msqrt')).toBeTruthy();
    expect(math.textContent).toContain('θ');
    expect(math.textContent?.startsWith('E=')).toBe(true);
    expect(symbolText('omega')).toEqual({ base: 'ω', sub: null });
    expect(symbolText('v_0')).toEqual({ base: 'v', sub: '0' });
    expect(mathElement(document, '2*x', null as never)!.textContent).toBe('2x');
    expect(mathElement(document, 'x +', null as never)).toBeNull();
  });
});
