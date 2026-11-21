/**
 * The board on a page (docs/features/board/ui.md Layout, Pages; design 3, 9; errors.md render_failed; requirements R3.1,
 * R3.2, R3.4; state-machines B13, B18): the page bar adds and switches pages, each page remembers its camera, only the
 * tiles a change touches are drawn again, the frame loop asks for one animation frame at a time, and the board draws with
 * Canvas 2D when WebGL 2 is not there.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountBoardView } from '../../src/index';
import type { BoardError, BoardView } from '../../src/index';
import { drawPath, installCanvas2d, line, sample } from './ink-helpers';
import type { FakeCanvas } from './ink-helpers';

interface Frames {
  readonly queue: ((now: number) => void)[];
  restore(): void;
}

/** Takes over `requestAnimationFrame` so a test decides when a frame runs, and gives the surface a size (happy-dom has no layout). */
function stubBrowser(width = 800, height = 600): Frames {
  const queue: ((now: number) => void)[] = [];
  const raf = window.requestAnimationFrame;
  const caf = window.cancelAnimationFrame;
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    queue.push(cb);
    return queue.length;
  };
  window.cancelAnimationFrame = (id: number): void => {
    queue[id - 1] = () => undefined;
  };
  const proto = HTMLElement.prototype;
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get: () => height });
  return {
    queue,
    restore: () => {
      window.requestAnimationFrame = raf;
      window.cancelAnimationFrame = caf;
      delete (proto as unknown as Record<string, unknown>)['clientWidth'];
      delete (proto as unknown as Record<string, unknown>)['clientHeight'];
    },
  };
}

let fake: FakeCanvas;
let frames: Frames;
let container: HTMLElement;
let view: BoardView | undefined;
let errors: BoardError[];

beforeEach(() => {
  fake = installCanvas2d();
  frames = stubBrowser();
  container = document.createElement('div');
  document.body.append(container);
  errors = [];
});
afterEach(() => {
  view?.dispose();
  view = undefined;
  container.remove();
  frames.restore();
  fake.restore();
});

function mount(): BoardView {
  const made = mountBoardView({ container, onError: (e) => errors.push(e) });
  if (!made.ok) throw new Error(made.message);
  view = made.value;
  return view;
}

const pageBar = (): HTMLElement => container.querySelector('.ib-pages') as HTMLElement;
const nameButton = (): HTMLButtonElement => pageBar().querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement;
const addButton = (): HTMLButtonElement => pageBar().querySelector('button[aria-label="Add a page"]') as HTMLButtonElement;
const list = (): HTMLElement => pageBar().querySelector('[role="listbox"]') as HTMLElement;
const entries = (): HTMLButtonElement[] => [...list().querySelectorAll<HTMLButtonElement>('button[role="option"]')];

describe('the board on a page', () => {
  it('mounts one board with one page, the tool strip, the page bar and the zoom bar', () => {
    const v = mount();
    expect(v.core.pages.list()).toHaveLength(1);
    expect(container.querySelector('[role="toolbar"]')).not.toBeNull();
    const toolIds = [...container.querySelectorAll<HTMLElement>('[data-tool]')].map((b) => b.dataset['tool']);
    expect(toolIds).toEqual(['pen', 'highlighter', 'eraser', 'laser', 'lasso', 'hand']);
    expect(container.querySelector('output[aria-label="Zoom"]')?.textContent).toBe('100%');
    expect(nameButton().textContent).toContain('Page');
  });

  it('without WebGL 2 it draws with Canvas 2D and the host hears render_failed once', () => {
    const v = mount();
    v.render(0);
    v.render(16);
    expect(v.element.dataset['backend']).toBe('canvas2d');
    expect(v.painter.backend).toBe('canvas2d');
    expect(errors.filter((e) => e.kind === 'render_failed')).toHaveLength(1);
  });

  it('a stroke drawn with the pen is on the board after the frame, drawn into a tile', () => {
    const v = mount();
    v.render(0);
    const before = v.painter.stats.tilesDrawn;
    expect(before).toBeGreaterThan(0);
    v.host.sample(sample({ x: 50, y: 50, phase: 'down' }));
    v.host.sample(sample({ x: 120, y: 90, phase: 'move', time: 8 }));
    v.host.sample(sample({ x: 160, y: 90, phase: 'up', time: 16 }));
    expect(v.core.store.all('shape')).toHaveLength(1);
    v.render(32);
    expect(v.painter.stats.tilesDrawn).toBeGreaterThan(before);
  });

  it('only the tiles a changed shape touches are drawn again', () => {
    const v = mount();
    v.render(0);
    const visible = v.painter.tiles.size;
    expect(visible).toBeGreaterThanOrEqual(4);
    const first = v.painter.stats.tilesDrawn;
    expect(first).toBe(visible);
    // nothing changed: nothing is drawn
    v.render(16);
    expect(v.painter.stats.tilesDrawn).toBe(first);
    // a stroke inside the top-left tile (0, 0): one tile is drawn again
    drawPathOn(v, line(50, 50, 150, 90, 10));
    v.render(32);
    expect(v.painter.stats.tilesDrawn).toBe(first + 1);
    v.render(48);
    expect(v.painter.stats.tilesDrawn).toBe(first + 1);
  });

  it('panning does not draw the tiles that are already drawn', () => {
    const v = mount();
    v.render(0);
    const drawn = v.painter.stats.tilesDrawn;
    v.core.camera?.panBy(-20, -20);
    v.render(16);
    // the viewport moved 20 units: at most the tiles that come into view are new
    expect(v.painter.stats.tilesDrawn - drawn).toBeLessThanOrEqual(5);
    const after = v.painter.stats.tilesDrawn;
    v.render(32);
    expect(v.painter.stats.tilesDrawn).toBe(after);
  });
});

/** A stroke through the view's own tool host. */
const drawPathOn = (v: BoardView, path: readonly (readonly [number, number])[]): void => drawPath(v, path);

describe('the page bar (ui.md Layout and Pages; R3.1, R3.2; B13)', () => {
  it('shows the current page name, a list of pages, and an add button', () => {
    mount();
    expect(nameButton().textContent).toMatch(/Page/);
    expect(addButton()).not.toBeNull();
    expect(list().hidden).toBe(true);
  });

  it('add page adds a page after the current one and goes to it, as one undo step', () => {
    const v = mount();
    const first = v.core.pages.current as string;
    const steps = v.core.history.undoSteps;
    addButton().click();
    expect(v.core.pages.list()).toHaveLength(2);
    expect(v.core.pages.current).not.toBe(first);
    expect(v.core.pages.list()[0]?.id).toBe(first);
    expect(v.core.history.undoSteps).toBe(steps + 1);
    expect(nameButton().textContent).toContain(v.core.pages.get(v.core.pages.current as string)?.name ?? 'missing');
  });

  it('the list shows every page; choosing one goes to it, closes the list, and is not an undo step', () => {
    const v = mount();
    const first = v.core.pages.current as string;
    addButton().click();
    addButton().click();
    expect(v.core.pages.list()).toHaveLength(3);
    const steps = v.core.history.undoSteps;
    nameButton().click();
    expect(list().hidden).toBe(false);
    expect(entries()).toHaveLength(3);
    expect(entries().map((e) => e.dataset['page'])).toEqual(v.core.pages.list().map((p) => p.id));
    expect(entries().filter((e) => e.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    (entries()[0] as HTMLButtonElement).click();
    expect(v.core.pages.current).toBe(first);
    expect(list().hidden).toBe(true);
    expect(v.core.history.undoSteps).toBe(steps);
  });

  it('Escape closes the list; the name button toggles it', () => {
    const v = mount();
    nameButton().click();
    expect(list().hidden).toBe(false);
    v.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(list().hidden).toBe(true);
    nameButton().click();
    nameButton().click();
    expect(list().hidden).toBe(true);
  });

  it('the list is read from the pages each time it opens, so a page added in code shows', () => {
    const v = mount();
    nameButton().click();
    expect(entries()).toHaveLength(1);
    nameButton().click();
    v.core.pages.addPage();
    nameButton().click();
    expect(entries()).toHaveLength(2);
  });

  it('each page remembers where you were looking', () => {
    const v = mount();
    const first = v.core.pages.current as string;
    v.core.camera?.moveTo(120, -40, 2, 0);
    addButton().click();
    expect(v.core.camera?.x).toBe(0);
    expect(v.core.camera?.zoom).toBe(1);
    v.core.camera?.moveTo(-300, 80, 0.5, 100);
    v.goToPage(first);
    expect(v.core.camera?.x).toBe(120);
    expect(v.core.camera?.y).toBe(-40);
    expect(v.core.camera?.zoom).toBe(2);
    const second = v.core.pages.list()[1]?.id as string;
    v.goToPage(second);
    expect(v.core.camera?.x).toBe(-300);
    expect(v.core.camera?.zoom).toBe(0.5);
  });

  it('switching pages shows the strokes of that page only, and tiles are drawn again for it', () => {
    const v = mount();
    v.render(0);
    drawPathOn(v, line(50, 50, 150, 90, 10));
    const first = v.core.pages.current as string;
    addButton().click();
    expect(v.painter.tiles.size).toBe(0);
    v.render(16);
    expect(v.core.index.grid.size).toBe(0);
    v.goToPage(first);
    v.render(32);
    expect(v.core.index.grid.size).toBe(1);
  });

  it('adding is refused with limit at 100 pages, and the page count stays 100', () => {
    const v = mount();
    for (let i = 1; i < 100; i++) expect(v.addPage().ok).toBe(true);
    expect(v.core.pages.list()).toHaveLength(100);
    const r = v.addPage();
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.kind).toBe('limit');
    addButton().click();
    expect(v.core.pages.list()).toHaveLength(100);
  });

  it('going to a page that is not there is bad_argument and changes nothing', () => {
    const v = mount();
    const here = v.core.pages.current;
    const r = v.goToPage('page:nowhere');
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.kind).toBe('bad_argument');
    expect(v.core.pages.current).toBe(here);
  });

  it('switching the page in the middle of a stroke drops the stroke', () => {
    const v = mount();
    v.host.sample(sample({ x: 10, y: 10, phase: 'down' }));
    v.host.sample(sample({ x: 90, y: 40, phase: 'move', time: 8 }));
    expect(v.core.live.state).toBe('drawing');
    addButton().click();
    expect(v.core.live.state).toBe('idle');
    expect(v.core.store.all('shape')).toHaveLength(0);
  });
});

describe('the frame loop (B18) and the zoom bar', () => {
  it('many requests make one animation frame; a frame that ran lets the next request queue again', () => {
    const v = mount();
    const pending = (): number => frames.queue.length;
    const startAt = pending();
    expect(startAt).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 10; i++) v.requestFrame();
    expect(pending()).toBe(startAt);
    const first = frames.queue[startAt - 1] as (now: number) => void;
    first(16);
    // the frame is done: the next request queues a new animation frame
    const afterRun = pending();
    v.requestFrame();
    expect(pending()).toBe(afterRun + 1);
  });

  it('drawing a frame does not throw into the page when there is no page size (a hidden board)', () => {
    frames.restore();
    frames = stubBrowser(0, 0);
    const v = mount();
    expect(() => v.render(0)).not.toThrow();
    expect(v.painter.stats.tilesDrawn).toBe(0);
  });

  it('the zoom bar shows the zoom as a number and the buttons zoom the board', () => {
    const v = mount();
    const out = container.querySelector('output[aria-label="Zoom"]') as HTMLOutputElement;
    (container.querySelector('button[aria-label="Zoom in"]') as HTMLButtonElement).click();
    expect(v.core.camera?.zoom).toBeCloseTo(1.25, 6);
    v.render(0);
    expect(out.textContent).toBe('125%');
    (container.querySelector('button[aria-label="Zoom to 100%"]') as HTMLButtonElement).click();
    expect(v.core.camera?.zoom).toBe(1);
  });

  it('Space-drag pans the board through the view (keys on the surface reach the tool host)', () => {
    const v = mount();
    const surface = container.querySelector('.ib-surface') as HTMLElement;
    surface.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(v.host.state).toBe('handHeld');
    surface.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }));
    expect(v.host.state).toBe('chosen');
  });

  it('dispose removes the board from the page', () => {
    const v = mount();
    v.dispose();
    view = undefined;
    expect(container.querySelector('[data-board-view]')).toBeNull();
  });
});
