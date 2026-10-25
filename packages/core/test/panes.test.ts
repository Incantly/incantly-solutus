// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { ManualClock, mountTrusted, type MountedFigure } from '../src';
import { checkStyle, type FigureStyle } from '../src/renderer/style';

const TWO = {
  html: "<div id='scene'></div><div id='graph'></div><p>Below both.</p>",
  css: '',
  js: `inc.layout('row');
    const a = inc.param('a', { min: 0, max: 1, value: 0.5, label: 'A' });
    inc.svg('#scene', { viewBox: [0, 0, 100, 100], title: 'Scene' }).circle(50, 50, 10, { tone: 'lit' });
    inc.graph2d('#graph', { x: [0, 1], y: [0, 1], title: 'Graph' }).plot((x) => a.value * x);`,
};

const ONE = {
  html: "<div id='scene'></div>",
  css: '',
  js: "inc.svg('#scene', { viewBox: [0, 0, 100, 100], title: 'Scene' }).circle(50, 50, 10, { tone: 'lit' });",
};

const mounted: MountedFigure[] = [];

function mount(style: FigureStyle = {}, scene = TWO) {
  const clock = new ManualClock();
  const container = document.createElement('div');
  document.body.append(container);
  const figure = mountTrusted(container, scene, { clock, visibility: 'external', style });
  mounted.push(figure);
  clock.advance();
  const root = figure.root;
  const sceneRoot = root.querySelector<HTMLElement>('.inc-scene')!;
  const panes = () => [...root.querySelectorAll<HTMLElement>('.inc-pane')];
  const button = (pane: HTMLElement) => pane.querySelector<HTMLButtonElement>(':scope > .inc-pane-button')!;
  return { figure, root, sceneRoot, panes, button };
}

afterEach(() => {
  while (mounted.length) mounted.pop()?.destroy();
  document.body.replaceChildren();
  document.head.replaceChildren();
});

describe('the scene’s panes', () => {
  it('marks each element that holds a stage as a pane, and keeps the scene’s layout by default', () => {
    const { sceneRoot, panes } = mount();
    expect(panes().map((p) => p.id)).toEqual(['scene', 'graph']);
    expect(sceneRoot.dataset.panels).toBe('row');
  });

  it('lets the host lay the panes out over the scene’s choice, and change it in place', () => {
    const { figure, sceneRoot } = mount({ layout: { panes: 'column' } });
    expect(sceneRoot.dataset.panels).toBe('column');
    figure.renderer.setStyle({ layout: { panes: 'auto' } });
    expect(sceneRoot.dataset.panels).toBe('row');
  });

  it('draws one pane large in the focus layout, and brings a small one forward from its button', () => {
    const { sceneRoot, panes, button } = mount({ layout: { panes: 'focus' } });
    const [scene, graph] = panes();
    expect(sceneRoot.dataset.panels).toBe('focus');
    expect(scene!.dataset.focus).toBe('');
    expect(graph!.dataset.focus).toBeUndefined();
    expect(button(graph!).getAttribute('aria-label')).toBe('Show this drawing large');
    button(graph!).click();
    expect(graph!.dataset.focus).toBe('');
    expect(scene!.dataset.focus).toBeUndefined();
    expect(button(graph!).getAttribute('aria-label')).toBe('Enlarge this drawing');
  });

  it('enlarges a pane to the whole scene and puts it back, from its button or Escape', () => {
    const { sceneRoot, panes, button } = mount();
    const [scene, graph] = panes();
    button(graph!).click();
    expect(sceneRoot.dataset.expanded).toBe('');
    expect(graph!.dataset.expanded).toBe('');
    expect(scene!.dataset.expanded).toBeUndefined();
    expect(button(graph!).getAttribute('aria-pressed')).toBe('true');
    expect(button(graph!).getAttribute('aria-label')).toBe('Show all drawings');
    button(graph!).click();
    expect(sceneRoot.dataset.expanded).toBeUndefined();
    button(scene!).click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(sceneRoot.dataset.expanded).toBeUndefined();
    expect(button(scene!).getAttribute('aria-pressed')).toBe('false');
  });

  it('gives a single pane no button, since full screen already shows it whole', () => {
    const { panes, button } = mount({}, ONE);
    expect(panes()).toHaveLength(1);
    expect(button(panes()[0]!)).toBeNull();
  });

  it('takes the integrator’s classes on panes, and hides the buttons when told to', async () => {
    const { root, panes } = mount({ classNames: { pane: 'rounded-xl border' }, show: { expand: false } });
    expect(panes().every((p) => p.classList.contains('rounded-xl') && p.classList.contains('border'))).toBe(true);
    expect(root.dataset.hideExpand).toBe('');
    const { THEME_CSS } = await import('../src/renderer/theme');
    expect(THEME_CSS).toContain('.inc-figure[data-hide-expand] .inc-pane-button { display: none; }');
  });

  it('keeps the panes layout, pane classes and expand switch in a stored look, and drops what is not valid', () => {
    expect(checkStyle({ layout: { panes: 'focus' }, classNames: { pane: 'shadow' }, show: { expand: false } })).toEqual({
      layout: { panes: 'focus' },
      classNames: { pane: 'shadow' },
      show: { expand: false },
    });
    expect(checkStyle({ layout: { panes: 'sideways' } })).toEqual({});
  });
});
