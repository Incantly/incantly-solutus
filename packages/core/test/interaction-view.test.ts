// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InThreadChannel, ManualClock, mountTrusted, type MountedFigure } from '../src';
import type { RendererMessage } from '../src/protocol/runtime-messages';
import { equationElement, linearEquation, mathElement, symbolText } from '../src/renderer/math';
import { measureText } from '../src/renderer/pointer';
import { exportStage } from '../src/sandbox/snapshot';
import { FORMULA_SETTLE_MS } from '../src/renderer/panels';
import { checkStyle, hostCss, mergeStyles, resolveStyle, styleForBridge } from '../src/renderer/style';

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

  it('pans a zoomed drawing by dragging its background with the pointer (EN-6)', () => {
    const { root } = mount(PENDULUM);
    const svg = q<SVGSVGElement>(root, 'svg.inc-stage');
    // Not zoomed: a background drag has nothing to show and the view box stays.
    press(svg, 'pointerdown', { clientX: 100, clientY: 100 });
    press(svg, 'pointermove', { clientX: 140, clientY: 100 });
    press(svg, 'pointerup', { clientX: 140, clientY: 100 });
    expect(svg.getAttribute('viewBox')).toBe('0 0 200 200');
    q<HTMLButtonElement>(root, '.inc-zoombar button[data-view="in"]').click();
    const before = svg.getAttribute('viewBox')!.split(' ').map(Number);
    press(svg, 'pointerdown', { clientX: 100, clientY: 100 });
    press(svg, 'pointermove', { clientX: 130, clientY: 120 });
    press(svg, 'pointermove', { clientX: 140, clientY: 130 });
    press(svg, 'pointerup', { clientX: 140, clientY: 130 });
    const after = svg.getAttribute('viewBox')!.split(' ').map(Number);
    // The drawing follows the pointer: right and down shows what was left and above.
    expect(after[0]).toBeLessThan(before[0]!);
    expect(after[1]).toBeLessThan(before[1]!);
    expect(after[2]).toBe(before[2]);
  });

  it('pinches with two fingers once the stage is active, and a double tap resets the view (VI-1)', () => {
    const { root } = mount(PENDULUM);
    const svg = q<SVGSVGElement>(root, 'svg.inc-stage');
    const host = q(root, '.inc-stage-host');
    const touch = (type: string, pointerId: number, clientX: number, clientY = 100) => press(svg, type, { pointerId, pointerType: 'touch', clientX, clientY });
    // Before a tap, two fingers scroll the page: nothing zooms.
    touch('pointerdown', 1, 80);
    touch('pointerdown', 2, 120);
    touch('pointermove', 2, 160);
    touch('pointerup', 1, 80);
    touch('pointerup', 2, 160);
    expect(svg.getAttribute('viewBox')).toBe('0 0 200 200');
    expect(host.classList.contains('is-active')).toBe(true);
    // Active: fingers moving apart zoom in about their middle.
    touch('pointerdown', 3, 80);
    touch('pointerdown', 4, 120);
    touch('pointermove', 4, 160);
    touch('pointerup', 3, 80);
    touch('pointerup', 4, 160);
    const [, , w] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    expect(w).toBeLessThan(200);
    // Two quick taps in one place: the view goes back.
    touch('pointerdown', 5, 100);
    touch('pointerup', 5, 100);
    touch('pointerdown', 6, 102);
    touch('pointerup', 6, 102);
    expect(svg.getAttribute('viewBox')).toBe('0 0 200 200');
  });

  it('turns a 3D view by dragging its background, the same for every 3D figure (C3-5)', async () => {
    const { kit } = await import('../src/kits/space3d');
    const { root, clock, sent, figure } = mount(
      `const space = inc.space3d('#stage', { title: 'Box' });
       space.box(2, { tone: 'lit' });`,
      { kits: { space3d: kit } },
    );
    const svg = q<SVGSVGElement>(root, 'svg.inc-stage');
    expect(svg.hasAttribute('data-orbit')).toBe(true);
    press(svg, 'pointerdown', { clientX: 300, clientY: 200 });
    press(svg, 'pointermove', { clientX: 360, clientY: 210 });
    clock.runUntilIdle();
    press(svg, 'pointerup', { clientX: 360, clientY: 210 });
    clock.runUntilIdle();
    const orbit = sent.find((m) => m.type === 'view' && m.action.kind === 'orbit');
    expect(orbit).toBeTruthy();
    expect(figure.runtime.uiState().views[0]!.changed).toBe(true);
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

  it('caps the frame rate from the settings panel without losing time (CT-4)', () => {
    const { root, clock, figure } = mount(
      `const stage = inc.svg('#stage', { viewBox: [0, 0, 100, 100], title: 'Moving' });
       const dot = stage.circle(10, 50, 4, { tone: 'lit' });
       inc.onFrame(({ time }) => dot.set({ cx: 10 + ((time * 20) % 80) }));`,
      { autoplay: true, reducedMotion: false },
    );
    const ticks = () => figure.renderer.stats.ticksSent;
    for (let i = 0; i < 30; i++) clock.advance(1000 / 60);
    const smooth = ticks();
    const cap = q<HTMLSelectElement>(root, 'select[data-setting="cap"]');
    cap.value = '15';
    cap.dispatchEvent(new Event('change', { bubbles: true }));
    const start = figure.runtime.time;
    for (let i = 0; i < 60; i++) clock.advance(1000 / 60);
    // A second at 60 frames a second, drawn 15 times, and the scene still moved on by a second.
    expect(ticks() - smooth).toBeGreaterThanOrEqual(14);
    expect(ticks() - smooth).toBeLessThanOrEqual(16);
    expect(figure.runtime.time - start).toBeGreaterThan(0.9);
    cap.value = '0';
    cap.dispatchEvent(new Event('change', { bubbles: true }));
    const uncapped = ticks();
    for (let i = 0; i < 30; i++) clock.advance(1000 / 60);
    expect(ticks() - uncapped).toBeGreaterThanOrEqual(29);
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

describe('full screen, layout and shading (VI-6, SV-5)', () => {
  it('fills the screen from its button, says so, and pads for the safe area', () => {
    const doc = document as { -readonly [K in keyof Document]: Document[K] };
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
    let element: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { get: () => element, configurable: true });
    const change = (to: Element | null) => {
      element = to;
      document.dispatchEvent(new Event('fullscreenchange'));
    };
    doc.exitFullscreen = vi.fn(async () => change(null));
    try {
      const { root } = mount(PENDULUM);
      root.requestFullscreen = vi.fn(async () => change(root));
      const button = q<HTMLButtonElement>(root, 'button[data-action="fullscreen"]');
      expect(button.hidden).toBe(false);
      expect(button.getAttribute('aria-pressed')).toBe('false');
      button.click();
      expect(root.requestFullscreen).toHaveBeenCalledTimes(1);
      expect(button.getAttribute('aria-pressed')).toBe('true');
      expect(button.getAttribute('aria-label')).toBe('Exit full screen');
      button.click();
      expect(doc.exitFullscreen).toHaveBeenCalledTimes(1);
      expect(button.getAttribute('aria-pressed')).toBe('false');
      expect(button.getAttribute('aria-label')).toBe('Full screen');
    } finally {
      delete (document as unknown as Record<string, unknown>).fullscreenEnabled;
      delete (document as unknown as Record<string, unknown>).fullscreenElement;
    }
  });

  it('lays a scene’s panels out side by side, one above another or two by two (VI-7)', async () => {
    const two = "<div id='scene'></div><div id='graph'></div>";
    const { root, figure } = mount(
      `inc.layout('row');
       const a = inc.param('a', { min: 0, max: 1, value: 0.5, label: 'A' });
       inc.svg('#scene', { viewBox: [0, 0, 100, 100], title: 'Scene' }).circle(50, 50, 10, { tone: 'lit' });
       inc.graph2d('#graph', { x: [0, 1], y: [0, 1], title: 'Graph' }).plot((x) => a.value * x);`,
      {},
      two,
    );
    expect(q(root, '.inc-scene').dataset.panels).toBe('row');
    expect(root.querySelectorAll('svg.inc-stage')).toHaveLength(2);
    expect(figure.runtime.uiState().panels).toBe('row');
    const { THEME_CSS } = await import('../src/renderer/theme');
    expect(THEME_CSS).toContain(".inc-scene[data-panels='row'] { display: flex; flex-wrap: wrap;");
    const { SceneRuntime } = await import('../src/runtime/runtime');
    const wrong = new SceneRuntime({ autoplay: false });
    wrong.mount((inc) => inc.layout('sideways' as never));
    expect(wrong.uiState().error?.message).toBe("inc.layout takes 'row', 'column' or 'grid'");
  });

  it('lays out by its own width and pads a full-screen figure clear of notches', async () => {
    const { THEME_CSS } = await import('../src/renderer/theme');
    expect(THEME_CSS).toMatch(/\.inc-figure:fullscreen \{[^}]*env\(safe-area-inset-top\)[^}]*env\(safe-area-inset-left\)/);
    // The figure is a size container, so its layout follows its own width, not the window's.
    expect(THEME_CSS).toMatch(/\.inc-figure \{[^}]*container-type: inline-size/);
    expect(THEME_CSS).toContain('@container (max-width: 560px)');
  });

  it('paints dots on a canvas that shares the stage’s coordinates and follows its zoom (SV-13)', () => {
    const arcs: Array<[number, number, number]> = [];
    const fills: string[] = [];
    const context = {
      fillStyle: '',
      clearRect: () => undefined,
      beginPath: () => undefined,
      moveTo: () => undefined,
      arc: (x: number, y: number, r: number) => void arcs.push([x, y, r]),
      fill() {
        fills.push(this.fillStyle);
      },
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400, toJSON: () => ({}) } as DOMRect);
    const { root } = mount(`
      const stage = inc.svg('#stage', { viewBox: [0, 0, 200, 200], title: 'Gas' });
      stage.rect(0, 0, 200, 200, { tone: 'faint' });
      stage.dots({ tone: 'a', r: 2, layer: 'back' }).set([[50, 50], [150, 100]]);
    `);
    const canvas = q<HTMLCanvasElement>(root, 'canvas.inc-dots--back');
    // Behind the drawing, hidden from assistive technology, at the drawing's pixel size.
    expect(canvas.nextElementSibling).toBe(q(root, 'svg.inc-stage'));
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(canvas.width).toBe(400);
    // Stage units, scaled to the canvas: 200 units across 400 pixels.
    expect(arcs).toEqual([
      [100, 100, 4],
      [300, 200, 4],
    ]);
    expect(fills).toHaveLength(1);
    // Zoomed in about the middle, the dots move with the drawing.
    arcs.length = 0;
    q<HTMLButtonElement>(root, '.inc-zoombar button[data-view="in"]').click();
    expect(arcs.length).toBe(2);
    expect(arcs[0]![0]).toBeLessThan(100);
    expect(arcs[0]![2]).toBeGreaterThan(4);
  });

  it('shades filled shapes with one gradient per tone and shade in each stage, under the figure’s own ids', () => {
    const { root } = mount(`
      const stage = inc.svg('#stage', { viewBox: [0, 0, 200, 200], title: 'Shaded' });
      const a = stage.circle(50, 50, 20, { tone: 'lit', fill: true, shade: 'sphere' });
      const b = stage.circle(120, 50, 20, { tone: 'lit', fill: true, shade: 'sphere' });
      const c = stage.rect(20, 120, 60, 40, { tone: 'b', fill: true, shade: 'cylinder' });
      const d = stage.rect(120, 120, 60, 40, { tone: 'b', fill: true });
    `);
    const gradients = [...root.querySelectorAll('svg.inc-stage defs radialGradient, svg.inc-stage defs linearGradient')];
    expect(gradients.map((g) => g.tagName.toLowerCase()).sort()).toEqual(['lineargradient', 'radialgradient']);
    const scope = root.querySelector('svg.inc-stage')!.getAttribute('aria-labelledby')!.split('-title-')[0]!;
    for (const g of gradients) expect(g.id.startsWith(`${scope}-g`)).toBe(true);
    const sphere = gradients.find((g) => g.tagName.toLowerCase() === 'radialgradient')!;
    expect(sphere.getAttribute('class')).toBe('inc-tone-lit');
    expect([...sphere.querySelectorAll('stop')].map((stop) => stop.getAttribute('class'))).toEqual(['inc-stop-light', 'inc-stop-dark']);
    const shaded = [...root.querySelectorAll<SVGElement>('svg.inc-stage circle, svg.inc-stage rect')].map((el) => el.style.getPropertyValue('--inc-grad'));
    expect(shaded.filter((v) => v === `url(#${sphere.id})`)).toHaveLength(2);
    expect(shaded.filter((v) => v === '')).toHaveLength(1);
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

  it('restyles a live figure in place, keeping its values, and switches theme and number', () => {
    const { figure, root, clock } = mount(PENDULUM, {
      style: { preset: 'glass', tokens: { lit: '#7c3aed' }, classNames: { button: 'rounded-full' }, show: { undo: false }, layout: { sceneHeight: '320px' } },
    });
    expect(q(root, 'button[data-action="undo"]').hidden).toBe(true);
    figure.renderer.send({ type: 'setParam', name: 'angle', value: 40 });
    clock.runUntilIdle();
    figure.setStyle({ preset: 'outline', tokens: { radius: '4px' }, classNames: { button: 'border-2' }, layout: { controls: 'left' }, show: { transport: false } });
    clock.runUntilIdle();
    expect(root.dataset.preset).toBe('outline');
    expect(root.dataset.layout).toBe('left');
    expect(root.style.getPropertyValue('--inc-lit')).toBe('');
    expect(root.style.getPropertyValue('--inc-radius')).toBe('4px');
    expect(root.style.getPropertyValue('--inc-scene-height')).toBe('');
    const toggle = q(root, 'button[data-action="toggle"]');
    expect(toggle.classList.contains('rounded-full')).toBe(false);
    expect(toggle.classList.contains('border-2')).toBe(true);
    // SDK classes stay whatever the integrator adds or takes away.
    expect(toggle.classList.contains('inc-primary')).toBe(true);
    expect(q(root, 'button[data-action="undo"]').hidden).toBe(false);
    expect(q(root, '.inc-transport').hidden).toBe(true);
    expect(figure.runtime.values().angle).toBe(40);
    figure.setTheme('dark');
    expect(root.dataset.theme).toBe('dark');
    figure.setTheme('auto');
    expect(root.dataset.theme).toBeUndefined();
    figure.renderer.setNumber(2);
    expect(q(root, '.inc-title').textContent).toBe('Figure 2 · Pendulum');
    figure.setStyle(undefined);
    expect(root.dataset.preset).toBe('default');
    expect(q(root, '.inc-transport').hidden).toBe(false);
  });

  it('keeps only the valid fields a style gives, and lays one style over another', () => {
    expect(checkStyle({ preset: 'glass', css: '.x{}', tokens: { lit: 'url(x)', radius: '8px' }, layout: { controls: 'right', sceneHeight: '1e9; x' }, show: { speed: false, nope: true } })).toEqual({
      preset: 'glass',
      tokens: { radius: '8px' },
      layout: { controls: 'right' },
      show: { speed: false },
    });
    expect(checkStyle('glass')).toEqual({});
    expect(checkStyle({ preset: 'nope' })).toEqual({});
    const merged = mergeStyles(
      { preset: 'glass', css: '.host{}', tokens: { lit: '#000' }, classNames: { button: 'rounded' }, layout: { controls: 'right', size: 'lg' } },
      { preset: 'soft', tokens: { radius: '2px' }, classNames: { button: 'shadow' }, layout: { controls: 'below' }, show: { legend: false } },
    );
    expect(merged).toEqual({
      preset: 'soft',
      css: '.host{}',
      tokens: { lit: '#000', radius: '2px' },
      classNames: { button: 'rounded shadow' },
      layout: { controls: 'below', size: 'lg' },
      show: { legend: false },
    });
    expect(mergeStyles(undefined, { preset: 'soft' })).toEqual({ preset: 'soft' });
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

describe('equations in the drawing (DG-5)', () => {
  const EQUATIONS = `
    inc.idea('Gravity weakens with the square of the distance.');
    const r = inc.param('r', { min: 1, max: 4, step: 1, value: 2, label: 'Distance' });
    const stage = inc.svg('#stage', { viewBox: [0, 0, 400, 200], title: 'Gravity' });
    stage.circle(60, 120, 12, { tone: 'lit' });
    const law = stage.equation(200, 40, 'F = G*m1*m2/r^2', { tone: 'a' });
    stage.part('Law', law, { label: 'The law', info: 'Newton’s law of gravitation.' });
    const now = stage.equation(20, 160, 'F = 1', { anchor: 'start', size: 12 });
    inc.onFrame(() => { now.text('F = 1/' + r.value * r.value); });
    inc.describe(() => 'At distance ' + r.value + ' the pull is 1/' + r.value * r.value + '.');
  `;

  it('writes each side of an equation as maths: a stacked fraction, subscripts, factors side by side', () => {
    const math = equationElement(document, 'F = G*m1*m2/r^2');
    const row = math.firstElementChild!;
    expect(row.tagName.toLowerCase()).toBe('mrow');
    expect([...row.children].map((c) => c.tagName.toLowerCase())).toEqual(['mi', 'mo', 'mfrac']);
    expect(math.querySelector('mfrac > :first-child')!.textContent).toBe('Gm1m2');
    expect(math.querySelectorAll('msub')).toHaveLength(2);
    expect(math.querySelector('mfrac msup')).toBeTruthy();
    // A side that is not a formula is shown as written; == and <= are not split.
    expect(equationElement(document, 'v = 12 m s')!.querySelector('mtext')!.textContent).toBe('12 m s');
    expect(equationElement(document, 'a <= b')!.querySelector('mo')!.textContent).toBe('≤');
    expect(linearEquation('F = G*m1*m2/r^2')).toBe('F = Gm₁m₂/r²');
    expect(linearEquation('E = 1/2*m*v^2')).toBe('E = (1/2)mv²');
    expect(linearEquation('p = m*2')).toBe('p = m·2');
    expect(linearEquation('x = sqrt(a + b) ≈ 2*pi')).toBe('x = √(a + b) ≈ 2π');
    // Greek letters as written and primes after a name, as an agent writes them.
    expect(linearEquation("L' = ρ*U*Γ")).toBe('L′ = ρUΓ');
    expect(linearEquation("f''(x) = -omega^2*x")).toBe('f′′(x) = −ω²x');
    // A primed letter is the letter in italic with its prime set close.
    const primed = equationElement(document, "L' = ρ*U*Γ")!;
    expect(primed.querySelector('mi')!.textContent).toBe('L');
    expect(primed.querySelector('mo')!.textContent).toBe('′');
    expect(symbolText('θ_2')).toEqual({ base: 'θ', sub: '2' });
    expect(linearEquation('y = e^(-k*t)')).toBe('y = e^(−kt)');
  });

  it('draws an equation in the stage, placed around its point, and redraws it when its source changes', () => {
    const { root, figure, clock } = mount(EQUATIONS);
    const [law, now] = [...root.querySelectorAll('svg.inc-stage foreignObject[data-math]')];
    expect(law?.closest('[data-layer]')?.getAttribute('data-layer')).toBe('labels');
    expect(law?.getAttribute('class')).toContain('inc-tone-a');
    expect(law?.getAttribute('data-part')).toBe('Law');
    expect(law?.querySelector('.inc-math math mfrac')).toBeTruthy();
    // Centred on (200, 40): the box is as far left of the point as right of it.
    const x = Number(law!.getAttribute('x'));
    const width = Number(law!.getAttribute('width'));
    expect(x + width / 2).toBeCloseTo(200, 1);
    expect(Number(law!.getAttribute('y')) + Number(law!.getAttribute('height')) / 2).toBeCloseTo(40, 1);
    expect((law!.querySelector('.inc-math') as HTMLElement).style.justifyContent).toBe('center');
    // Starting at (20, 160): the box starts at the point.
    expect(Number(now!.getAttribute('x'))).toBe(20);
    expect((now!.querySelector('.inc-math') as HTMLElement).style.justifyContent).toBe('flex-start');
    expect((now as SVGElement).style.getPropertyValue('--inc-fs')).toBe('12px');
    expect(now!.getAttribute('data-text')).toBe('F = 1/4');
    const slider = q<HTMLInputElement>(root, 'input[type="range"]');
    slider.value = '3';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    clock.runUntilIdle();
    expect(figure.runtime.values().r).toBe(3);
    expect(now!.getAttribute('data-text')).toBe('F = 1/9');
    expect(now!.querySelector('mfrac > mn:last-child')!.textContent).toBe('9');
  });

  it('keeps an equation in an exported picture, with its text for programs that cannot draw MathML', () => {
    const { root } = mount(EQUATIONS);
    const url = exportStage(root.querySelector<SVGSVGElement>('svg.inc-stage'))!;
    const markup = decodeURIComponent(url.slice(url.indexOf(',') + 1));
    expect(markup).toContain('<switch>');
    expect(markup).toMatch(/<foreignObject[^>]*requiredExtensions="http:\/\/www.w3.org\/1999\/xhtml http:\/\/www.w3.org\/1998\/Math\/MathML"/);
    expect(markup).toContain('<math');
    expect(markup).toContain('F = Gm₁m₂/r²</text>');
    expect(markup).not.toContain('data-text');
    expect(markup).not.toContain('class=');
    // The equation's box carries its look in one style attribute, written into the text, not set on an element.
    const box = /<div[^>]*>/.exec(markup)![0];
    expect(box.match(/ style="/g)).toHaveLength(1);
    expect(box).toContain('display:flex');
    expect(markup).not.toContain('data-inc-style');
  });
});

describe('measuring a drawing (VI-5)', () => {
  const RAMP = `
    inc.idea('A ramp rises at an angle.');
    const stage = inc.svg('#stage', { viewBox: [0, 0, 200, 200], title: 'Ramp', measure: { unit: 'm', per: 50 } });
    stage.path('M20 180 L180 180 L180 60 Z', { tone: 'mid' });
  `;

  it('reads distances and angles in the stage’s own units', () => {
    const metres = { scale: [0.02, 0.02] as const, origin: [0, 0] as const, unit: 'm' };
    expect(measureText(metres, [])).toBe('Tap two points to measure a distance, or three for an angle.');
    expect(measureText(metres, [{ x: 0, y: 0 }])).toBe('Tap a second point.');
    expect(measureText(metres, [{ x: 0, y: 0 }, { x: 30, y: 40 }])).toBe('Distance 1 m. Tap a third point for an angle.');
    expect(measureText(metres, [{ x: 100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 100 }])).toBe('Angle 90.0°, between sides of 2 m and 2 m.');
    // On a graph, in the axes' units: one stage unit is 0.5 across and 0.25 up.
    const graph = { scale: [0.5, -0.25] as const, origin: [0, 0] as const, unit: '' };
    expect(measureText(graph, [{ x: 0, y: 0 }, { x: 6, y: -16 }])).toBe('Distance 5. Tap a third point for an angle.');
  });

  it('offers the tool on a stage that declares its units, and measures the taps made with it', () => {
    const { root } = mount(RAMP);
    const svg = q<SVGSVGElement>(root, 'svg.inc-stage');
    const button = q<HTMLButtonElement>(root, '.inc-zoombar button[data-view="measure"]');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    button.click();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(svg.classList.contains('is-measuring')).toBe(true);
    const readout = q(root, '.inc-measure-readout');
    expect(readout.getAttribute('role')).toBe('status');
    // Taps place points instead of panning: 180 − 20 = 160 units is 3.2 m.
    press(svg, 'pointerdown', { clientX: 20, clientY: 180 });
    press(svg, 'pointerdown', { clientX: 180, clientY: 180 });
    expect(readout.textContent).toBe('Distance 3.2 m. Tap a third point for an angle.');
    press(svg, 'pointerdown', { clientX: 180, clientY: 60 });
    expect(readout.textContent).toBe('Angle 90.0°, between sides of 3.2 m and 2.4 m.');
    expect(svg.querySelectorAll('.inc-measure circle')).toHaveLength(3);
    expect(svg.querySelectorAll('.inc-measure path')).toHaveLength(2);
    // A fourth tap starts again; Escape puts the tool away.
    press(svg, 'pointerdown', { clientX: 100, clientY: 100 });
    expect(svg.querySelectorAll('.inc-measure circle')).toHaveLength(1);
    key(svg, 'Escape');
    expect(root.querySelector('.inc-measure')).toBeNull();
    expect(root.querySelector('.inc-measure-readout')).toBeNull();
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('measures a graph in its axes’ units, and keeps the marks out of pictures', () => {
    const { root, figure } = mount(`
      const g = inc.graph2d('#stage', { x: [0, 10], y: [0, 10], title: 'Graph', viewBox: [0, 0, 400, 300] });
      g.plot((x) => x);
    `);
    const measure = figure.runtime.graph.snapshotCommands().find((c) => c.op === 'interact')!;
    expect(measure).toMatchObject({ measure: { unit: '' } });
    q<HTMLButtonElement>(root, '.inc-zoombar button[data-view="measure"]').click();
    const svg = q<SVGSVGElement>(root, 'svg.inc-stage');
    press(svg, 'pointerdown', { clientX: 100, clientY: 100 });
    const url = exportStage(svg)!;
    expect(decodeURIComponent(url)).not.toContain('inc-measure');
  });

  it('offers no tool on a stage that does not say what its units are', () => {
    const { root } = mount(PENDULUM);
    expect(root.querySelector('.inc-zoombar button[data-view="measure"]')).toBeNull();
  });
});

describe('glow (FX-1)', () => {
  it('gives a glowing element a halo in its own tone, from one filter per stage, kept in exported pictures', () => {
    const { root, clock } = mount(`
      const on = inc.toggle('on', { value: true, label: 'Lamp on' });
      const stage = inc.svg('#stage', { viewBox: [0, 0, 300, 200], title: 'Lamp' });
      const lamp = stage.circle(150, 100, 20, { tone: 'lit', glow: true });
      const sparks = stage.dots({ tone: 'lit', r: 2, glow: true });
      sparks.set([[100, 50], [200, 150]]);
      inc.onFrame(() => lamp.glow(on.value === 1));
    `);
    const lamp = q<SVGCircleElement>(root, 'svg.inc-stage circle.inc-tone-lit');
    expect(lamp.classList.contains('inc-glow')).toBe(true);
    const filter = lamp.style.getPropertyValue('filter');
    expect(filter).toMatch(/^url\(#.+-glow-\d+\)$/);
    const id = /#([^)]+)/.exec(filter)![1]!;
    const defs = q(root, `svg.inc-stage filter[id="${id}"]`);
    expect(defs.querySelector('feGaussianBlur')!.getAttribute('stdDeviation')).toBe('2');
    // The exported copy carries the filter as an attribute, with the filter in its defs.
    const markup = decodeURIComponent(exportStage(q<SVGSVGElement>(root, 'svg.inc-stage'))!);
    expect(markup).toMatch(/<circle[^>]*filter="url\((&quot;)?#[^"&]+-glow-\d+(&quot;)?\)"/);
    expect(markup).toContain(`<filter id="${id}"`);
    const toggle = q<HTMLInputElement>(root, 'input.inc-switch');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('input', { bubbles: true }));
    clock.runUntilIdle();
    expect(lamp.classList.contains('inc-glow')).toBe(false);
    expect(lamp.style.getPropertyValue('filter')).toBe('');
  });
});
