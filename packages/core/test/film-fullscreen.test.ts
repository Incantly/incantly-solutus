// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bindPlayerFullscreen,
  FilmController,
  InThreadChannel,
  ManualClock,
  mountTrusted,
  PlayerModel,
  SceneRuntime,
  THIRTY_SECOND_FILM,
  isPlayerFullscreen,
  refreshPlayerFullscreenVisibility,
  resolveStyle,
  applySlotClasses,
  applyStyle,
  THEME_CSS,
  solveCaption,
  probeFilm,
  type MountedFigure,
} from '../src';
import { HOST_MESSAGE_TYPES, parseHostMessage } from '../src/protocol/bridge';
import type { RendererMessage } from '../src/protocol/runtime-messages';
import { trustFixture } from './helpers/film';

const mounted: MountedFigure[] = [];

function mount(js: string, options: Parameters<typeof mountTrusted>[2] = {}, html = "<div id='stage'></div>") {
  const clock = new ManualClock();
  const container = document.createElement('div');
  document.body.append(container);
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
`;

const DOTS = `
  const stage = inc.svg('#stage', { viewBox: [0, 0, 200, 200], title: 'Gas' });
  stage.rect(0, 0, 200, 200, { tone: 'faint' });
  stage.dots({ tone: 'a', r: 2, layer: 'back' }).set([[50, 50], [150, 100]]);
`;

const EQUATIONS = `
  const stage = inc.svg('#stage', { viewBox: [0, 0, 400, 200], title: 'Gravity' });
  stage.circle(60, 120, 12, { tone: 'lit' });
  stage.equation(200, 40, 'F = G*m1*m2/r^2', { tone: 'a' });
`;

function rectOf(width: number, height: number): DOMRect {
  return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect;
}

describe('film fullscreen: figure fills the screen chrome-aware', () => {
  it('sizes the stage from its width, through links that never shrink below content', () => {
    expect(THEME_CSS).not.toContain('72vh');
    expect(THEME_CSS).toContain('Fullscreen sizing is width-driven, never leftover-driven');
    // The stage keeps its embedded aspect height (width 100%, height auto): no rule may size it from
    // leftover flex space, crush it with min-height 0, or floor it in viewport units.
    for (const root of ['.inc-figure:fullscreen', '.inc-figure[data-fullscreen]']) {
      expect(THEME_CSS).toContain(`${root} .inc-stage { width: 100%; max-height: none; flex: 0 0 auto; }`);
      expect(THEME_CSS).toContain(`${root} .inc-body { flex: 1 0 auto; width: 100%; }`);
      expect(THEME_CSS).toContain(`${root} .inc-scene:not([data-panels]) { display: flex; flex-direction: column; flex: 1 0 auto; }`);
      expect(THEME_CSS).toContain(
        `${root} .inc-scene:not([data-panels]) > .inc-stage-host { flex: 1 0 auto; display: flex; flex-direction: column; width: 100%; }`,
      );
    }
    for (const line of THEME_CSS.split('\n')) {
      // The root fills the screen; every rule below it must size from content, never leftover space.
      if (line.startsWith('.inc-figure:fullscreen {') || line.startsWith('.inc-figure[data-fullscreen] {')) continue;
      if (line.includes(':fullscreen') || line.includes('[data-fullscreen]')) {
        expect(line, 'no leftover-driven stage height').not.toContain('height: 100%');
        expect(line, 'no crush below content').not.toContain('min-height: 0');
        expect(line, 'no viewport-unit floor').not.toContain('100dvh');
      }
    }
  });

  it('grows canvas layers sharp at the fullscreen size', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect: () => undefined, beginPath: () => undefined, moveTo: () => undefined, arc: () => undefined, fill: () => undefined } as unknown as CanvasRenderingContext2D);
    const { root, figure } = mount(DOTS);
    const svg = q<SVGSVGElement>(root, 'svg.inc-stage');
    const host = q(root, '.inc-stage-host');
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(rectOf(400, 400));
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rectOf(400, 400));
    Object.defineProperty(host, 'offsetWidth', { value: 400, configurable: true });
    Object.defineProperty(host, 'offsetHeight', { value: 400, configurable: true });
    figure.renderer.scene.repaintDots();
    const canvas = q<HTMLCanvasElement>(root, 'canvas.inc-dots--back');
    const embeddedWidth = canvas.width;
    expect(embeddedWidth).toBe(400);
    // Fullscreen: the stage box doubles, the canvas follows at device pixels (sharp, no upscale blur).
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(rectOf(800, 800));
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rectOf(800, 800));
    Object.defineProperty(host, 'offsetWidth', { value: 800, configurable: true });
    Object.defineProperty(host, 'offsetHeight', { value: 800, configurable: true });
    figure.renderer.setFullscreenMirror(true);
    expect(root.dataset.fullscreen).toBe('');
    expect(canvas.width).toBe(800);
    expect(canvas.width).toBeGreaterThan(embeddedWidth);
    figure.renderer.setFullscreenMirror(false);
    expect(root.dataset.fullscreen).toBe(undefined);
  });

  it('keeps equations in the drawing across fullscreen (SVG scales, viewBox untouched)', () => {
    const { root, figure } = mount(EQUATIONS);
    const before = root.querySelectorAll('svg.inc-stage foreignObject[data-math]');
    expect(before.length).toBe(1);
    const svg = q<SVGSVGElement>(root, 'svg.inc-stage');
    const viewBox = svg.getAttribute('viewBox');
    figure.renderer.setFullscreenMirror(true);
    expect(root.querySelectorAll('svg.inc-stage foreignObject[data-math]').length).toBe(1);
    expect(svg.getAttribute('viewBox')).toBe(viewBox);
    expect(root.querySelector('.inc-math math')).toBeTruthy();
    figure.renderer.setFullscreenMirror(false);
  });

  it('keeps transport and controls visible and usable in fullscreen', () => {
    const doc = document as { -readonly [K in keyof Document]: Document[K] };
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
    let element: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { get: () => element, configurable: true });
    doc.exitFullscreen = vi.fn(async () => {
      element = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    try {
      const { root, sent } = mount(PENDULUM);
      root.requestFullscreen = vi.fn(async () => {
        element = root;
        document.dispatchEvent(new Event('fullscreenchange'));
      });
      const button = q<HTMLButtonElement>(root, 'button[data-action="fullscreen"]');
      const transport = q(root, '.inc-transport');
      expect(transport.hidden).toBe(false);
      button.click();
      expect(button.getAttribute('aria-pressed')).toBe('true');
      // Chrome stays in flow: no fullscreen rule hides it, the figure scrolls instead.
      expect(transport.hidden).toBe(false);
      expect(THEME_CSS).not.toMatch(/:fullscreen[^{]*\.inc-transport[^}]*display:\s*none/);
      expect(THEME_CSS).toMatch(/\.inc-figure:fullscreen \{[^}]*overflow:\s*auto/);
      // Usable at the new size: play still sends.
      q<HTMLButtonElement>(root, 'button[data-action="toggle"]').click();
      expect(sent.some((m) => m.type === 'play')).toBe(true);
      button.click();
      expect(button.getAttribute('aria-pressed')).toBe('false');
      expect(transport.hidden).toBe(false);
    } finally {
      delete (document as unknown as Record<string, unknown>).fullscreenEnabled;
      delete (document as unknown as Record<string, unknown>).fullscreenElement;
    }
  });

  it('maps pointers at the fullscreen size (same pixels, finer stage units)', () => {
    const { figure } = mount(PENDULUM);
    const stage = figure.renderer.scene.allStages()[0]!;
    const svg = stage.svg;
    const pointer = figure.renderer.pointer;
    pointer.zoom(stage, 100, 100, 2);
    const zoomed = svg.getAttribute('viewBox')!;
    expect(zoomed).not.toBe('0 0 200 200');
    const dragAcross = (width: number): number => {
      pointer.resetView(stage);
      pointer.zoom(stage, 100, 100, 2);
      vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(rectOf(width, width));
      const before = svg.getAttribute('viewBox')!;
      press(svg, 'pointerdown', { clientX: 100, clientY: 100 });
      press(svg, 'pointermove', { clientX: 120, clientY: 100 });
      press(svg, 'pointerup', { clientX: 120, clientY: 100 });
      const after = svg.getAttribute('viewBox')!;
      const bx = Number(before.split(' ')[0]);
      const ax = Number(after.split(' ')[0]);
      return bx - ax;
    };
    const embeddedPan = dragAcross(200);
    expect(embeddedPan).toBeGreaterThan(0);
    const fullscreenPan = dragAcross(400);
    // Twice the pixels for the same stage: the same 20 px pans half the stage units.
    expect(fullscreenPan).toBeCloseTo(embeddedPan / 2, 6);
  });

  it('re-reads pointer mapping per gesture, so fullscreen size applies to the next drag', () => {
    const { root, figure } = mount(PENDULUM);
    const svg = q<SVGSVGElement>(root, 'svg.inc-stage');
    const bob = q(root, '[data-drag]');
    const ctm = vi.spyOn(svg, 'getScreenCTM');
    press(bob, 'pointerdown', { clientX: 100, clientY: 120 });
    press(bob, 'pointerup', { clientX: 100, clientY: 120 });
    const afterFirst = ctm.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);
    figure.renderer.setFullscreenMirror(true);
    press(bob, 'pointerdown', { clientX: 100, clientY: 120 });
    press(bob, 'pointerup', { clientX: 100, clientY: 120 });
    expect(ctm.mock.calls.length).toBeGreaterThan(afterFirst);
    figure.renderer.setFullscreenMirror(false);
  });
});

describe('film fullscreen: non-fullscreen unchanged', () => {
  it('keeps embedded stage boxes and chrome rules byte-identical', () => {
    expect(THEME_CSS).toContain('.inc-stage { display: block; width: 100%; height: var(--inc-scene-height, auto); overflow: visible; }');
    expect(THEME_CSS).toContain('.inc-stage-host { position: relative; isolation: isolate; }');
    expect(THEME_CSS).toMatch(/\.inc-figure \{[^}]*container-type: inline-size/);
    // Every growth rule is scoped to fullscreen or its mirror; none touches embedded figures.
    for (const line of THEME_CSS.split('\n')) {
      if (line.includes('flex: 1 0 auto; width: 100%') && line.includes('.inc-body')) {
        expect(line.includes(':fullscreen') || line.includes('[data-fullscreen]')).toBe(true);
      }
      if (line.includes('.inc-stage { width: 100%; max-height: none;')) {
        expect(line.includes(':fullscreen') || line.includes('[data-fullscreen]')).toBe(true);
      }
    }
  });

  it('leaves film checks solving at their fixed widths', () => {
    // The checks never read the theme: the solver still lays out at 360/640/960.
    for (const width of [360, 640, 960]) {
      const layout = solveCaption('A pendulum hangs from its pivot and swings back and forth.', { widthPx: width, stageHeightPx: (width * 400) / 600 });
      expect(layout.lines.length).toBeGreaterThan(0);
      expect(layout.fontPx).toBeGreaterThan(0);
      expect(layout.bandHeightPx).toBeGreaterThan(0);
    }
  });

  it('still probes films at explicit fixed widths', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const report = probeFilm({ film, scenes: scenes.slice(0, 1), widths: [360, 640, 960], themes: ['light'] });
    expect(typeof report.ok).toBe('boolean');
    expect(report.stats.beats).toBe(film.beats.length);
  });
});

describe('film fullscreen: player toggle', () => {
  async function playerSetup() {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const runtime = new SceneRuntime({ ...(scenes[0]!.kits ? { kits: scenes[0]!.kits } : {}), film: true });
    runtime.mount(scenes[0]!.scene);
    const controller = new FilmController({ runtime, film });
    const model = new PlayerModel(controller, film);
    return { film, runtime, controller, model };
  }

  it('defaults the show flag on and hides the button through the dataset convention', () => {
    expect(resolveStyle(undefined).show.playerFullscreen).toBe(true);
    expect(resolveStyle({ show: {} }).show.playerFullscreen).toBe(true);
    expect(resolveStyle({ show: { playerFullscreen: false } }).show.playerFullscreen).toBe(false);
    const player = document.createElement('div');
    player.className = 'inc-player';
    applyStyle(player, resolveStyle({ show: { playerFullscreen: false } }));
    expect(player.dataset.hidePlayerFullscreen).toBe('');
    const button = document.createElement('button');
    button.className = 'inc-player-fullscreen';
    player.append(button);
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
    try {
      refreshPlayerFullscreenVisibility(button, false);
      expect(button.hidden).toBe(true);
      refreshPlayerFullscreenVisibility(button, true);
      expect(button.hidden).toBe(false);
    } finally {
      delete (document as unknown as Record<string, unknown>).fullscreenEnabled;
    }
    // The button is a plain transport button, so the button slot styles it like its siblings.
    const styled = document.createElement('div');
    styled.className = 'inc-player';
    const transport = document.createElement('div');
    transport.className = 'inc-transport inc-player-transport';
    const sibling = document.createElement('button');
    sibling.textContent = 'Play';
    const toggle = document.createElement('button');
    toggle.className = 'inc-player-fullscreen';
    transport.append(sibling, toggle);
    styled.append(transport);
    document.body.append(styled);
    applySlotClasses(styled, resolveStyle({ classNames: { button: 'demo-btn' } }));
    expect(sibling.classList.contains('demo-btn')).toBe(true);
    expect(toggle.classList.contains('demo-btn')).toBe(true);
    styled.remove();
  });

  it('toggles the player root and preserves playback position and state', async () => {
    const { film, controller, model } = await playerSetup();
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
    let element: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { get: () => element, configurable: true });
    (document as { exitFullscreen?: () => Promise<void> }).exitFullscreen = vi.fn(async () => {
      element = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    try {
      const player = document.createElement('div');
      player.className = 'inc-player';
      document.body.append(player);
      player.requestFullscreen = vi.fn(async () => {
        element = player;
        document.dispatchEvent(new Event('fullscreenchange'));
      });
      const button = document.createElement('button');
      button.className = 'inc-player-fullscreen';
      button.textContent = '⛶';
      player.append(button);
      const mirrored: boolean[] = [];
      const unbind = bindPlayerFullscreen(player, button, (on) => mirrored.push(on));
      model.play();
      model.seek(film.beats[2]!.start + 0.2);
      const time = controller.time;
      const playing = controller.isPlaying;
      expect(isPlayerFullscreen(player)).toBe(false);
      button.click();
      expect(player.requestFullscreen).toHaveBeenCalledTimes(1);
      expect(isPlayerFullscreen(player)).toBe(true);
      expect(button.getAttribute('aria-pressed')).toBe('true');
      expect(button.getAttribute('aria-label')).toBe('Exit full screen');
      expect(mirrored).toEqual([true]);
      // Playback untouched by entering.
      expect(controller.time).toBeCloseTo(time, 9);
      expect(controller.isPlaying).toBe(playing);
      expect(model.state.beat).toBe('s1b3');
      button.click();
      expect(isPlayerFullscreen(player)).toBe(false);
      expect(button.getAttribute('aria-pressed')).toBe('false');
      expect(button.getAttribute('aria-label')).toBe('Full screen');
      expect(mirrored).toEqual([true, false]);
      // Exiting restores position and state exactly.
      expect(controller.time).toBeCloseTo(time, 9);
      expect(controller.isPlaying).toBe(playing);
      expect(model.state.beat).toBe('s1b3');
      unbind();
      player.remove();
    } finally {
      delete (document as unknown as Record<string, unknown>).fullscreenEnabled;
      delete (document as unknown as Record<string, unknown>).fullscreenElement;
      controller.destroy();
    }
  });
});

describe('film fullscreen: sandbox parity', () => {
  it('carries fullscreen over the existing bridge', () => {
    expect(HOST_MESSAGE_TYPES.has('fullscreen')).toBe(true);
    const channel = 'test-channel';
    expect(parseHostMessage({ v: 1, channel, type: 'fullscreen', value: true }, channel)).toEqual({ v: 1, channel, type: 'fullscreen', value: true });
    expect(parseHostMessage({ v: 1, channel, type: 'fullscreen', value: false }, channel)).toEqual({ v: 1, channel, type: 'fullscreen', value: false });
    expect(parseHostMessage({ v: 1, channel, type: 'fullscreen', value: 'yes' }, channel)).toBeNull();
    expect(parseHostMessage({ v: 1, channel, type: 'fullscreen' }, channel)).toBeNull();
    expect(parseHostMessage({ v: 1, channel: 'other', type: 'fullscreen', value: true }, channel)).toBeNull();
  });

  it('mirrors trusted and sandboxed figures through the same renderer path', () => {
    const { root, figure } = mount(PENDULUM);
    // The frame calls this on its fullscreen message; the host calls it directly for trusted figures.
    figure.renderer.setFullscreenMirror(true);
    expect(root.dataset.fullscreen).toBe('');
    figure.renderer.setFullscreenMirror(false);
    expect(root.dataset.fullscreen).toBe(undefined);
    // No remount: the stage and its layers survive the mirror.
    expect(root.querySelector('svg.inc-stage')).toBeTruthy();
    expect(root.querySelector('.inc-transport')).toBeTruthy();
  });

  it('exposes fullscreen on handles without direct host mounts', async () => {
    const { inThreadAdapter } = await import('../src');
    const container = document.createElement('div');
    document.body.append(container);
    const handle = inThreadAdapter.mount(container, { html: "<div id='stage'></div>", css: '', js: `inc.svg('#stage', { viewBox: [0, 0, 100, 100], title: 'T' }).circle(50, 50, 5, {});` });
    await handle.ready;
    expect(typeof handle.setFullscreen).toBe('function');
    handle.setFullscreen?.(true);
    expect(container.querySelector('.inc-figure')?.getAttribute('data-fullscreen')).toBe('');
    handle.setFullscreen?.(false);
    expect(container.querySelector('.inc-figure')?.hasAttribute('data-fullscreen')).toBe(false);
    handle.destroy();
    container.remove();
  });
});
