/**
 * Figure cards on the board (docs/features/board/design.md 8, 9 and 5; ui.md Figure cards; errors.md figure_failed; requirements
 * R6; docs/state-machines.md B26 to B28). At most 3 cards are live under one scheduler, the rest show their picture; cards on
 * other pages are never mounted; while the camera moves the live cards show their picture and settle 150 ms after it stops;
 * the script is the only source of truth and `picture` is a cache that is not an undo step.
 *
 * `createApp` of `@incantly/sdk` is wrapped (as packages/tiptap/test/spec/errors.test.ts does) so a test can count mounts, make
 * one fail, or make the script of an app throw. Fake timers drive the scheduler's 150 ms settle and the card's 500 ms picture.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MountedApp } from '@incantly/sdk';
import { FigureCard, LIVE_CARDS, addFigure, createBoard, figureOf, figuresOnPage, setFigureMode, setFigurePicture, setFigureScript } from '../../src/index';
import type { Board, BoardError, BoardOptions } from '../../src/index';
import { installCanvas2d } from './ink-helpers';
import type { FakeCanvas } from './ink-helpers';
import { SCRIPT, must, press, stubSize } from './round4-helpers';
import { sample } from './ink-helpers';

const probe = vi.hoisted(() => ({
  apps: [] as MountedApp[],
  calls: 0,
  failWhen: undefined as undefined | ((call: number) => boolean),
  loadThrows: false,
}));

vi.mock('@incantly/sdk', async (original) => {
  const sdk = await original<typeof import('@incantly/sdk')>();
  return {
    ...sdk,
    createApp: async (o: Parameters<typeof sdk.createApp>[0]) => {
      probe.calls++;
      if (probe.failWhen?.(probe.calls)) throw new Error('no GPU in this test');
      const app = await sdk.createApp(o);
      probe.apps.push(app);
      if (!probe.loadThrows) return app;
      return new Proxy(app, {
        get(target, key) {
          if (key === 'loadScript') {
            return () => {
              throw new Error('the script cannot be loaded');
            };
          }
          const v = Reflect.get(target, key) as unknown;
          return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      });
    },
  };
});

const PIC = 'data:image/svg+xml;base64,PHN2Zy8+';
const W = 1000;
const H = 700;

let fake: FakeCanvas;
let unsize: () => void;
let container: HTMLElement;
let board: Board | undefined;
let errors: BoardError[];

beforeEach(() => {
  probe.apps = [];
  probe.calls = 0;
  probe.failWhen = undefined;
  probe.loadThrows = false;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  fake = installCanvas2d();
  unsize = stubSize(W, H);
  container = document.createElement('div');
  document.body.append(container);
  errors = [];
  board = undefined;
});
afterEach(() => {
  board?.dispose();
  container.remove();
  unsize();
  fake.restore();
  vi.useRealTimers();
});

const tick = (ms: number): Promise<unknown> => vi.advanceTimersByTimeAsync(ms);

function open(options: BoardOptions = {}): Board {
  board = must(createBoard({ container, canvas2dOnly: true, onError: (e) => errors.push(e), ...options }));
  return board;
}

const view = (): NonNullable<Board['view']> => (board as Board).view as NonNullable<Board['view']>;
const core = (): Board['core'] => (board as Board).core;
const layer = (): NonNullable<Board['view']>['figures'] => view().figures;
const card = (id: string): FigureCard => layer().cards.get(id) as FigureCard;
const root = (): HTMLElement => (board as Board).element as HTMLElement;
const surface = (): HTMLElement => root().querySelector('.ib-surface') as HTMLElement;
const aliveApps = (): MountedApp[] => probe.apps.filter((a) => !a.destroyed);
const stateOf = (id: string): string => card(id).life.state;
const kindsOf = (kind: string): BoardError[] => errors.filter((e) => e.kind === kind);

/** `n` cards with their middles on a row inside the view, each with the script of `SCRIPT`. */
function cards(n: number, script = SCRIPT): string[] {
  return Array.from({ length: n }, (_, i) => must(addFigure(core(), { at: { x: 200 + i * 150, y: 350 }, script })));
}

/** Runs the board's frames and timers until the cards have settled. */
const settle = (): Promise<unknown> => tick(1200);

/** The camera moved: a frame runs, so the layer sees it. */
function pan(dx: number, dy = 0): void {
  core().camera?.panBy(dx, dy);
  view().requestFrame();
}

/** The number of undo steps in the history (it undoes them all and redoes them, so nothing is lost). */
function undoSteps(): number {
  let n = 0;
  while (core().history.canUndo && n < 100) {
    core().history.undo();
    n++;
  }
  for (let i = 0; i < n; i++) core().history.redo();
  return n;
}

/** Two clicks on the card's middle with the select tool, 120 ms apart. */
function doubleClick(id: string): void {
  const s = figureOf(core(), id) as NonNullable<ReturnType<typeof figureOf>>;
  const x = s.x + s.props.w / 2 - (core().camera?.x ?? 0);
  const y = s.y + s.props.h / 2 - (core().camera?.y ?? 0);
  (board as Board).setTool('select');
  for (const [phase, time] of [['down', 1000], ['up', 1030], ['down', 1120], ['up', 1150]] as const) {
    (board as Board).host.sample(sample({ device: 'mouse', pointer: 1, phase, x, y, buttons: phase === 'up' ? 0 : 1, time }));
  }
}

const cardbar = (): HTMLElement => root().querySelector('.ib-cardbar') as HTMLElement;
const lines = (): HTMLElement => root().querySelector('.ib-cardlines') as HTMLElement;
const control = (name: string): HTMLButtonElement => root().querySelector(`[data-card="${name}"]`) as HTMLButtonElement;
const modeSelect = (): HTMLSelectElement => root().querySelector('[data-card="mode"]') as HTMLSelectElement;

describe('at most 3 live cards under one scheduler (R6.2; design 8; B26)', () => {
  it('the cap is 3', () => {
    expect(LIVE_CARDS).toBe(3);
  });

  it('five cards in view: three are live, two show their picture', async () => {
    open();
    const ids = cards(5);
    await settle();
    const states = ids.map(stateOf);
    expect(states.filter((s) => s === 'live').length).toBe(3);
    expect(states.filter((s) => s === 'picture').length).toBe(2);
    expect(layer().liveCount).toBe(3);
    expect(aliveApps().length).toBe(3);
  });

  it('never has more than 3 apps at any moment while cards come and go', async () => {
    open();
    const ids = cards(6);
    let most = 0;
    for (let i = 0; i < 40; i++) {
      await tick(100);
      most = Math.max(most, aliveApps().length, layer().liveCount);
      if (i % 5 === 0) pan(i % 10 === 0 ? 60 : -60);
    }
    expect(most).toBeLessThanOrEqual(3);
    expect(ids.map(stateOf).filter((s) => s === 'live' || s === 'mounting' || s === 'moving').length).toBeLessThanOrEqual(3);
  });

  it('a fast pan over many cards, frames coming faster than apps are made, never has more than 3 mounting, live or moving (B26 invariant)', async () => {
    open();
    for (let i = 0; i < 30; i++) must(addFigure(core(), { at: { x: 250 + (i % 10) * 400, y: 200 + Math.floor(i / 10) * 300 }, script: SCRIPT }));
    await settle();
    let most = 0;
    for (let f = 0; f < 200; f++) {
      core().camera?.moveTo(f * 18, f * 4, 1, performance.now());
      view().render(performance.now());
      // a little time passes, but no promise gets to run: the apps being made are still being made
      vi.advanceTimersByTime(f % 3 === 0 ? 20 : 2);
      if (f % 25 === 24) await tick(1);
      most = Math.max(most, layer().liveCount, aliveApps().length);
    }
    await settle();
    most = Math.max(most, layer().liveCount, aliveApps().length);
    expect(most).toBeLessThanOrEqual(3);
  });

  it('one SchedulerHost serves the board: every card of the page is registered with it, and its cap is 3', async () => {
    open();
    const ids = cards(5);
    await settle();
    expect(layer().scheduler.config.maxLive).toBe(3);
    expect([...layer().scheduler.state.figures.keys()].sort()).toEqual([...ids].sort());
  });

  it('a card that is a picture shows its picture inside the card, made from its script when it had none', async () => {
    open();
    const ids = cards(5);
    await settle();
    const pictures = ids.filter((id) => stateOf(id) === 'picture');
    expect(pictures.length).toBe(2);
    for (const id of pictures) {
      const props = (figureOf(core(), id) as NonNullable<ReturnType<typeof figureOf>>).props;
      expect(typeof props.picture, id).toBe('string');
      expect(props.picture as string).toMatch(/^data:image\//);
      expect(card(id).picEl.hidden).toBe(false);
      expect(card(id).picEl.getAttribute('src')).toBe(props.picture);
      expect(card(id).hostEl.hidden).toBe(true);
    }
  });

  it('a card that is a picture holds no app', async () => {
    open();
    const ids = cards(5);
    await settle();
    for (const id of ids.filter((x) => stateOf(x) === 'picture')) expect(card(id).app).toBeUndefined();
    expect(probe.calls).toBe(3);
  });

  it('a card with a picture already uses it and is not drawn from the script again', async () => {
    open();
    const ids = cards(4);
    for (const id of ids) setFigurePicture(core(), id, PIC);
    await settle();
    const pictures = ids.filter((id) => stateOf(id) === 'picture');
    expect(pictures.length).toBe(1);
    expect(card(pictures[0] as string).picEl.getAttribute('src')).toBe(PIC);
    expect((figureOf(core(), pictures[0] as string) as NonNullable<ReturnType<typeof figureOf>>).props.picture).toBe(PIC);
  });

  it('a card far outside the view is not mounted, and is when the camera brings it near', async () => {
    open();
    const [near] = cards(1);
    const far = must(addFigure(core(), { at: { x: 5000, y: 350 }, script: SCRIPT }));
    await settle();
    expect(stateOf(near as string)).toBe('live');
    expect(stateOf(far)).toBe('picture');
    expect(probe.calls).toBe(1);
    core().camera?.moveTo(4600, 0, 1, performance.now());
    view().requestFrame();
    await settle();
    expect(stateOf(far)).toBe('live');
    // the first card left the view, so it saved itself and freed its app
    expect(aliveApps().length).toBeLessThanOrEqual(3);
  });

  it('a card that has no picture gets one written to the store without an undo step, whether live or not', async () => {
    open();
    const ids = cards(2);
    const before = undoSteps();
    expect(before).toBe(2);
    await settle();
    for (const id of ids) expect(figureOf(core(), id)?.props.picture, id).toMatch(/^data:image\//);
    expect(undoSteps()).toBe(before);
  });
});

describe('cards on other pages are never mounted (design 5; R3.3)', () => {
  it('a card on another page has no card object, no scheduler entry and no app', async () => {
    open();
    const [a] = cards(1);
    await settle();
    const first = core().pages.current as string;
    view().addPage();
    const second = core().pages.current as string;
    expect(second).not.toBe(first);
    const b = must(addFigure(core(), { at: { x: 300, y: 300 }, script: SCRIPT }));
    await settle();
    expect([...layer().cards.keys()]).toEqual([b]);
    expect([...layer().scheduler.state.figures.keys()]).toEqual([b]);
    expect(layer().cards.has(a as string)).toBe(false);
    expect(aliveApps().length).toBe(1);
  });

  it('leaving a page frees its apps; coming back builds its cards again', async () => {
    open();
    const [a] = cards(1);
    await settle();
    const first = core().pages.current as string;
    expect(aliveApps().length).toBe(1);
    view().addPage();
    await settle();
    expect(aliveApps().length).toBe(0);
    expect(layer().liveCount).toBe(0);
    view().goToPage(first);
    await settle();
    expect(card(a as string).life.state).toBe('live');
    expect(aliveApps().length).toBe(1);
  });

  it('a board that opens with figure cards on page 2 mounts none of them until page 2 is shown', async () => {
    const maker = must(createBoard());
    must(addFigure(maker.core, { at: { x: 100, y: 100 }, script: SCRIPT }));
    maker.core.pages.addPage();
    const p2 = maker.core.pages.list()[1]?.id as string;
    maker.core.pages.goToPage(p2);
    must(addFigure(maker.core, { at: { x: 100, y: 100 }, script: SCRIPT }));
    maker.core.pages.goToPage(maker.core.pages.list()[0]?.id as string);
    const text = must(maker.save());
    maker.dispose();
    open({ document: text });
    await settle();
    expect(layer().cards.size).toBe(1);
    expect(aliveApps().length).toBe(1);
    expect(probe.calls).toBe(1);
    view().goToPage(p2);
    await settle();
    expect(layer().cards.size).toBe(1);
    expect(probe.calls).toBe(2);
    expect(aliveApps().length).toBe(1);
  });

  it('a card removed from the page is dropped with its app', async () => {
    open();
    const ids = cards(2);
    await settle();
    core().store.change('user', (tx) => tx.remove(ids[0] as string));
    await tick(300);
    expect(layer().cards.has(ids[0] as string)).toBe(false);
    expect(aliveApps().length).toBe(1);
  });
});

describe('while the camera moves (design 8, 9; ui.md; B26 moving, B28)', () => {
  async function liveCard(withPicture = true): Promise<string> {
    open();
    const [id] = cards(1);
    if (withPicture) setFigurePicture(core(), id as string, PIC);
    await settle();
    expect(stateOf(id as string)).toBe('live');
    return id as string;
  }

  it('a pan makes the live card show its picture and hide the app', async () => {
    const id = await liveCard();
    expect(layer().motion.state).toBe('still');
    pan(-40);
    await tick(16);
    expect(layer().motion.state).toBe('moving');
    expect(stateOf(id)).toBe('moving');
    expect(card(id).slot.dataset['state']).toBe('moving');
    expect(card(id).picEl.hidden).toBe(false);
    expect(card(id).picEl.getAttribute('src')).toBeTruthy();
    expect(card(id).hostEl.style.visibility).toBe('hidden');
  });

  it('a zoom does the same', async () => {
    const id = await liveCard();
    core().camera?.zoomBy(1.2, 500, 350, performance.now());
    view().requestFrame();
    await tick(16);
    expect(stateOf(id)).toBe('moving');
    expect(card(id).hostEl.style.visibility).toBe('hidden');
  });

  it('the card is live again 150 ms after the camera stops, not before', async () => {
    const id = await liveCard();
    pan(-40);
    await tick(16);
    expect(stateOf(id)).toBe('moving');
    await tick(100);
    expect(stateOf(id)).toBe('moving');
    await tick(120);
    expect(stateOf(id)).toBe('live');
    expect(layer().motion.state).toBe('still');
    expect(card(id).hostEl.style.visibility).toBe('');
    expect(card(id).picEl.hidden).toBe(true);
  });

  it('asks for frames by itself while moving, so the card settles with no other event', async () => {
    const id = await liveCard();
    pan(-40);
    await tick(16);
    expect(stateOf(id)).toBe('moving');
    await tick(400);
    expect(stateOf(id)).toBe('live');
  });

  it('a camera that keeps moving keeps the card moving: the 150 ms start again with each change', async () => {
    const id = await liveCard();
    for (let i = 0; i < 8; i++) {
      pan(-10);
      await tick(100);
      expect(stateOf(id), `step ${i}`).toBe('moving');
    }
    await tick(200);
    expect(stateOf(id)).toBe('live');
  });

  it('the app is hidden, not destroyed and made again: no new createApp after the camera stops', async () => {
    const id = await liveCard();
    const app = card(id).app;
    pan(-40);
    await tick(16);
    await tick(400);
    expect(probe.calls).toBe(1);
    expect(card(id).app).toBe(app);
    expect(app?.destroyed).toBe(false);
  });

  it('after a zoom, the host is sized for the new steady zoom (between 0.5 and 3), and not before it settles', async () => {
    const id = await liveCard();
    expect(card(id).hostScale).toBe(1);
    core().camera?.zoomBy(2, 500, 350, performance.now());
    view().requestFrame();
    await tick(16);
    expect(card(id).hostScale).toBe(1);
    await tick(600);
    expect(stateOf(id)).toBe('live');
    expect(card(id).hostScale).toBeGreaterThanOrEqual(1.9);
    expect(card(id).hostScale).toBeLessThanOrEqual(2.1);
  });

  it('the host scale is held between 0.5 and 3', async () => {
    const id = await liveCard();
    core().camera?.zoomBy(10, 500, 350, performance.now());
    view().requestFrame();
    await tick(800);
    expect(card(id).hostScale).toBeLessThanOrEqual(3);
    core().camera?.zoomBy(0.01, 500, 350, performance.now());
    view().requestFrame();
    await tick(800);
    expect(card(id).hostScale).toBeGreaterThanOrEqual(0.5);
  });

  it('a card that is a picture takes no `move` and stays a picture', async () => {
    open();
    const ids = cards(5);
    await settle();
    const stills = ids.filter((id) => stateOf(id) === 'picture');
    pan(-20);
    await tick(16);
    for (const id of stills) expect(stateOf(id)).toBe('picture');
  });

  it('a card is built only after the camera settled: one that comes into view by a pan is made 150 ms after the pan stops', async () => {
    open();
    const [near] = cards(1);
    const far = must(addFigure(core(), { at: { x: 1900, y: 350 }, script: SCRIPT }));
    await settle();
    expect(stateOf(far)).toBe('picture');
    const before = probe.calls;
    for (let i = 1; i <= 6; i++) {
      core().camera?.moveTo(i * 150, 0, 1, performance.now());
      view().requestFrame();
      await tick(40);
    }
    expect(stateOf(far)).toBe('picture');
    expect(probe.calls).toBe(before);
    await tick(800);
    expect(stateOf(far)).toBe('live');
    expect(stateOf(near as string)).not.toBe('gone');
  });
});

describe('double-click or Enter gives the input, Esc gives it back (R6.3; ui.md; B27)', () => {
  async function ready(n = 1): Promise<string[]> {
    open();
    const ids = cards(n);
    await settle();
    return ids;
  }

  it('a card does not have the input at first: its host does not take the pointer', async () => {
    const [id] = await ready();
    expect(layer().inputId).toBeUndefined();
    expect(card(id as string).hasInput).toBe(false);
    expect(card(id as string).slot.style.pointerEvents).toBe('');
    expect(card(id as string).input.state).toBe('board');
  });

  it('a double click on a live card gives it the input', async () => {
    const [id] = await ready();
    doubleClick(id as string);
    await tick(50);
    expect(layer().inputId).toBe(id);
    expect(card(id as string).input.state).toBe('input');
    expect(card(id as string).slot.style.pointerEvents).toBe('auto');
    expect(card(id as string).slot.classList.contains('ib-card-input')).toBe(true);
  });

  it('Enter with the card selected gives it the input', async () => {
    const [id] = await ready();
    (board as Board).setTool('select');
    core().selection.set([id as string]);
    expect(press(board as Board, 'Enter')).toBe(true);
    await tick(50);
    expect(layer().inputId).toBe(id);
  });

  it('Esc inside the card gives the input back to the board and keeps the card selected', async () => {
    const [id] = await ready();
    doubleClick(id as string);
    await tick(50);
    expect(layer().inputId).toBe(id);
    card(id as string).slot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(layer().inputId).toBeUndefined();
    expect(card(id as string).input.state).toBe('board');
    expect(card(id as string).slot.style.pointerEvents).toBe('');
    expect(core().selection.ids).toEqual([id]);
    expect(document.activeElement).toBe(surface());
  });

  it('a press on the board outside the card gives the input back', async () => {
    const [id] = await ready();
    doubleClick(id as string);
    await tick(50);
    expect(layer().inputId).toBe(id);
    surface().dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(layer().inputId).toBeUndefined();
  });

  it('a press inside the card or its toolbar does not take the input back', async () => {
    const [id] = await ready();
    doubleClick(id as string);
    await tick(50);
    card(id as string).slot.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    cardbar().dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(layer().inputId).toBe(id);
  });

  it('giving the input to another card first takes it from the first: only one card has it', async () => {
    const ids = await ready(2);
    const [a, b] = ids as [string, string];
    layer().activate(a);
    await tick(50);
    expect(layer().inputId).toBe(a);
    layer().activate(b);
    await tick(50);
    expect(layer().inputId).toBe(b);
    expect([...layer().cards.values()].filter((c) => c.hasInput).map((c) => c.id)).toEqual([b]);
    expect(card(a).input.state).toBe('board');
  });

  it('while a card has the input the board\'s tools see no key from it', async () => {
    const [id] = await ready();
    doubleClick(id as string);
    await tick(50);
    const tool = (board as Board).tool;
    for (const key of ['p', 'e', 'Delete', 'Backspace']) {
      card(id as string).slot.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }
    expect((board as Board).tool).toBe(tool);
    expect(figureOf(core(), id as string)).toBeDefined();
  });

  it('while a card has the input the board\'s tools see no pointer from it: a press inside does not clear the selection', async () => {
    const [id] = await ready();
    doubleClick(id as string);
    await tick(50);
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'contextmenu', 'dblclick']) card(id as string).slot.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
    expect(core().selection.ids).toEqual([id]);
    expect(root().querySelector('[data-menu]')).toBeNull();
  });

  it('only a live card takes the input: whoever holds the input is live, also after a card that was a picture is asked', async () => {
    const ids = await ready(5);
    const still = ids.find((id) => stateOf(id) === 'picture') as string;
    layer().activate(still);
    await tick(1500);
    expect([...layer().cards.values()].filter((c) => c.hasInput).every((c) => c.life.is('live'))).toBe(true);
  });

  it('giving the input to a fourth card keeps the cap: at most 3 cards mounting, live or moving, and 3 apps (B26 invariant)', async () => {
    const ids = await ready(5);
    const still = ids.find((id) => stateOf(id) === 'picture') as string;
    layer().activate(still);
    await tick(2500);
    expect(layer().liveCount).toBeLessThanOrEqual(3);
    expect(aliveApps().length).toBeLessThanOrEqual(3);
    expect(ids.filter((id) => ['mounting', 'live', 'moving'].includes(stateOf(id))).length).toBeLessThanOrEqual(3);
  });

  it('the card takes the input when it goes live after being asked (a new card from the Figure button)', async () => {
    open();
    (board as Board).setTool('select');
    root().querySelector<HTMLButtonElement>('[data-action="figure"]')?.click();
    await settle();
    const id = core().selection.ids[0] as string;
    expect(id).toBeDefined();
    expect(stateOf(id)).toBe('live');
    expect(layer().inputId).toBe(id);
  });

  it('the input goes back when the card leaves live: a change of mode frees the app', async () => {
    const [id] = await ready();
    layer().activate(id as string);
    await tick(50);
    expect(layer().inputId).toBe(id);
    setFigureMode(core(), id as string, 'geometry');
    await tick(50);
    expect(card(id as string).hasInput).toBe(false);
  });

  it('the card toolbar shows over the card that has the input', async () => {
    const [id] = await ready();
    core().selection.clear();
    layer().activate(id as string);
    await tick(100);
    expect(layer().inputId).toBe(id);
    expect(cardbar().hidden).toBe(false);
  });

  it('a read-only board still lets a card take the input', async () => {
    const maker = must(createBoard());
    const id = must(addFigure(maker.core, { at: { x: 400, y: 350 }, script: SCRIPT }));
    const text = must(maker.save());
    maker.dispose();
    open({ document: text, readOnly: true });
    await settle();
    expect(stateOf(id)).toBe('live');
    expect(layer().activate(id)).toBe(true);
    await tick(50);
    expect(layer().inputId).toBe(id);
    card(id).slot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(layer().inputId).toBeUndefined();
  });
});

describe('the Figure button and paste (ui.md Figure cards; design 7.4; R5.5)', () => {
  it('the Figure button is an action, not a tool, and it hands back to the select tool', async () => {
    open();
    expect(root().querySelector('[data-tool="figure"]')).toBeNull();
    expect(root().querySelector('[data-action="figure"]')).not.toBeNull();
    root().querySelector<HTMLButtonElement>('[data-action="figure"]')?.click();
    expect((board as Board).tool).toBe('select');
  });

  it('places an empty card in the middle of the view, selected, and gives it the input', async () => {
    open();
    root().querySelector<HTMLButtonElement>('[data-action="figure"]')?.click();
    await settle();
    const shapes = figuresOnPage(core());
    expect(shapes.length).toBe(1);
    const s = shapes[0] as NonNullable<(typeof shapes)[number]>;
    expect(s.x + s.props.w / 2).toBeCloseTo(W / 2, 0);
    expect(s.y + s.props.h / 2).toBeCloseTo(H / 2, 0);
    expect(s.props.script.trim()).toBe('# incantly 1');
    expect(core().selection.ids).toEqual([s.id]);
    expect(layer().inputId).toBe(s.id);
  });

  it('the key g does the same', async () => {
    open();
    press(board as Board, 'g');
    await settle();
    expect(figuresOnPage(core()).length).toBe(1);
  });

  it('one press is one undo step', async () => {
    open();
    root().querySelector<HTMLButtonElement>('[data-action="figure"]')?.click();
    await settle();
    expect(undoSteps()).toBe(1);
  });

  function paste(text: string): void {
    const e = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: { files: [], getData: (type: string) => (type === 'text/plain' ? text : '') } });
    root().dispatchEvent(e);
  }

  it('pasting a script that starts with `# incantly 1` makes a figure card that goes live and is selected', async () => {
    open();
    paste('# incantly 1\nf(x) = x^2');
    const shapes = figuresOnPage(core());
    expect(shapes.length).toBe(1);
    expect(shapes[0]?.props.script).toContain('f(x) = x^2');
    expect(core().selection.ids).toEqual([shapes[0]?.id]);
    expect((board as Board).tool).toBe('select');
    await settle();
    expect(stateOf(shapes[0]?.id as string)).toBe('live');
  });

  it('pasting plain text makes a text shape, not a card', async () => {
    open();
    paste('hello there');
    expect(figuresOnPage(core()).length).toBe(0);
    const page = core().pages.current as string;
    expect(core().store.shapesOn(page).map((s) => s.kind)).toEqual(['text']);
  });

  it('a pasted script is one undo step', async () => {
    open();
    paste('# incantly 1\na = 1');
    expect(undoSteps()).toBe(1);
  });
});

describe('the card toolbar (ui.md Figure cards; design 8)', () => {
  async function selected(): Promise<string> {
    open();
    const ids = cards(1);
    (board as Board).setTool('select');
    await settle();
    core().selection.set([ids[0] as string]);
    await tick(50);
    return ids[0] as string;
  }

  it('is hidden with nothing selected and shows over the selected card with edit lines, mode, play and delete', async () => {
    open();
    cards(1);
    await settle();
    expect(cardbar().hidden).toBe(true);
    const id = (layer().cards.keys().next().value as string);
    core().selection.set([id]);
    await tick(50);
    expect(cardbar().hidden).toBe(false);
    for (const name of ['edit', 'mode', 'play', 'delete']) expect(control(name), name).not.toBeNull();
  });

  it('is above the card', async () => {
    const id = await selected();
    const shape = figureOf(core(), id) as NonNullable<ReturnType<typeof figureOf>>;
    expect(parseFloat(cardbar().style.top)).toBeLessThan(shape.y);
  });

  it('goes away when the selection leaves the card', async () => {
    await selected();
    core().selection.clear();
    await tick(50);
    expect(cardbar().hidden).toBe(true);
  });

  it('is not shown when two cards are selected', async () => {
    open();
    const ids = cards(2);
    await settle();
    core().selection.set(ids);
    await tick(50);
    expect(cardbar().hidden).toBe(true);
  });

  it('edit lines opens a panel with the script under the card', async () => {
    const id = await selected();
    expect(lines().hidden).toBe(true);
    control('edit').click();
    expect(lines().hidden).toBe(false);
    const text = lines().querySelector('textarea') as HTMLTextAreaElement;
    expect(text.value).toBe((figureOf(core(), id) as NonNullable<ReturnType<typeof figureOf>>).props.script);
  });

  it('Apply writes the lines as one undo step, and the live card follows', async () => {
    const id = await selected();
    const before = undoSteps();
    control('edit').click();
    const text = lines().querySelector('textarea') as HTMLTextAreaElement;
    text.value = '# incantly 1\nq = 7';
    control('apply').click();
    expect(figureOf(core(), id)?.props.script).toContain('q = 7');
    expect(undoSteps()).toBe(before + 1);
    await tick(100);
    expect(card(id).app?.toScript()).toContain('q = 7');
  });

  it('Ctrl+Enter in the panel applies it', async () => {
    const id = await selected();
    control('edit').click();
    const text = lines().querySelector('textarea') as HTMLTextAreaElement;
    text.value = '# incantly 1\nz = 9';
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    expect(figureOf(core(), id)?.props.script).toContain('z = 9');
  });

  it('Esc closes the panel and does not clear the selection', async () => {
    const id = await selected();
    control('edit').click();
    const text = lines().querySelector('textarea') as HTMLTextAreaElement;
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(lines().hidden).toBe(true);
    expect(core().selection.ids).toEqual([id]);
  });

  it('a line that fails shows a small badge on the card and reports figure_failed with the line', async () => {
    const id = await selected();
    expect(card(id).badge.hidden).toBe(true);
    setFigureScript(core(), id, '# incantly 1\na = 1\n)))');
    await tick(100);
    expect(card(id).badge.hidden).toBe(false);
    expect(card(id).badge.textContent).not.toBe('');
    const e = kindsOf('figure_failed')[0];
    expect(e).toBeDefined();
    expect(JSON.stringify(e?.detail)).toContain('lines');
    expect(card(id).life.state).toBe('live');
  });

  it('a script that is mended takes the badge away', async () => {
    const id = await selected();
    setFigureScript(core(), id, '# incantly 1\n)))');
    await tick(100);
    expect(card(id).badge.hidden).toBe(false);
    setFigureScript(core(), id, '# incantly 1\na = 2');
    await tick(100);
    expect(card(id).badge.hidden).toBe(true);
  });

  it('mode changes the card\'s mode, clears the picture, in one undo step', async () => {
    const id = await selected();
    setFigurePicture(core(), id, PIC);
    const before = undoSteps();
    modeSelect().value = 'geometry';
    modeSelect().dispatchEvent(new Event('change', { bubbles: true }));
    const props = (figureOf(core(), id) as NonNullable<ReturnType<typeof figureOf>>).props;
    expect(props.mode).toBe('geometry');
    expect(props.picture).toBeNull();
    expect(undoSteps()).toBe(before + 1);
  });

  it('play starts the card\'s clock and the button then says Pause; a second press pauses it', async () => {
    const id = await selected();
    expect(card(id).app?.clock.playing).toBe(false);
    control('play').click();
    expect(card(id).app?.clock.playing).toBe(true);
    await tick(50);
    expect(control('play').textContent).toBe('Pause');
    control('play').click();
    expect(card(id).app?.clock.playing).toBe(false);
  });

  it('delete removes the card, clears the selection, in one undo step; undo brings it back', async () => {
    const id = await selected();
    const before = undoSteps();
    control('delete').click();
    expect(figureOf(core(), id)).toBeUndefined();
    expect(core().selection.size).toBe(0);
    await tick(100);
    expect(layer().cards.has(id)).toBe(false);
    expect(undoSteps()).toBe(before + 1);
    core().history.undo();
    expect(figureOf(core(), id)).toBeDefined();
  });

  it('on a read-only board edit lines, mode and delete are not there, and play is', async () => {
    const maker = must(createBoard());
    const id = must(addFigure(maker.core, { at: { x: 400, y: 350 }, script: SCRIPT }));
    const text = must(maker.save());
    maker.dispose();
    open({ document: text, readOnly: true });
    await settle();
    layer().activate(id);
    await tick(100);
    expect(cardbar().hidden).toBe(false);
    expect(control('edit').hidden).toBe(true);
    expect(control('mode').hidden).toBe(true);
    expect(control('delete').hidden).toBe(true);
    expect(control('play').hidden).toBe(false);
    control('play').click();
    expect(card(id).app?.clock.playing).toBe(true);
    // and the card is not changed
    expect(figureOf(core(), id)?.props.script).toContain('b = a + 1');
  });
});

describe('the script is the only source of truth; the picture is a cache (design 8; B26)', () => {
  async function live(): Promise<string> {
    open();
    const [id] = cards(1);
    await settle();
    return id as string;
  }

  it('a script written to the store reaches the live card: the app has the new line, and was not made again', async () => {
    const id = await live();
    setFigureScript(core(), id, `${SCRIPT}\nc = 5`);
    await tick(100);
    expect(card(id).app?.toScript()).toContain('c = 5');
    expect(probe.calls).toBe(1);
  });

  it('undo of a script change reaches the live card, and redo brings it back', async () => {
    const id = await live();
    setFigureScript(core(), id, `${SCRIPT}\nc = 5`);
    await tick(100);
    core().history.undo();
    await tick(100);
    expect(card(id).app?.toScript()).not.toContain('c = 5');
    core().history.redo();
    await tick(100);
    expect(card(id).app?.toScript()).toContain('c = 5');
  });

  it('a script written while the card is a picture is used when it goes live', async () => {
    open();
    const ids = cards(5);
    await settle();
    const still = ids.find((id) => stateOf(id) === 'picture') as string;
    setFigureScript(core(), still, '# incantly 1\nw = 3');
    await tick(50);
    expect(card(still).shape.props.script).toContain('w = 3');
    // make room: delete a live card so the scheduler brings this one up
    const goes = ids.find((id) => stateOf(id) === 'live') as string;
    core().store.change('user', (tx) => tx.remove(goes));
    await settle();
    expect(card(still).app?.toScript()).toContain('w = 3');
  });

  it('the picture is written without an undo step, and the undo stack is the same after', async () => {
    const id = await live();
    const before = undoSteps();
    expect(setFigurePicture(core(), id, PIC).ok).toBe(true);
    expect(figureOf(core(), id)?.props.picture).toBe(PIC);
    expect(undoSteps()).toBe(before);
  });

  it('a picture written to the store does not make an app or change the script', async () => {
    const id = await live();
    const script = figureOf(core(), id)?.props.script;
    setFigurePicture(core(), id, PIC);
    await tick(100);
    expect(figureOf(core(), id)?.props.script).toBe(script);
    expect(probe.calls).toBe(1);
  });

  it('a change of script clears the picture in the same undo step', async () => {
    const id = await live();
    setFigurePicture(core(), id, PIC);
    const before = undoSteps();
    setFigureScript(core(), id, '# incantly 1\nk = 1');
    expect(figureOf(core(), id)?.props.picture).toBeNull();
    expect(undoSteps()).toBe(before + 1);
  });

  it('a change of mode clears the picture and undo gives the old mode back', async () => {
    const id = await live();
    setFigurePicture(core(), id, PIC);
    setFigureMode(core(), id, 'geometry');
    expect(figureOf(core(), id)?.props.picture).toBeNull();
    core().history.undo();
    expect(figureOf(core(), id)?.props.mode).toBe('graphing');
  });

  it('a card with a new mode is made again in that mode: the old app is freed', async () => {
    const id = await live();
    const first = card(id).app;
    setFigureMode(core(), id, 'geometry');
    await settle();
    expect(first?.destroyed).toBe(true);
    expect(card(id).life.state).toBe('live');
    expect(probe.calls).toBe(2);
  });

  it('the card saves to the file as its script, mode and size: the saved board has no app state, and loads to the same card', async () => {
    const id = await live();
    await tick(800);
    const text = must((board as Board).save());
    const shape = figureOf(core(), id) as NonNullable<ReturnType<typeof figureOf>>;
    const again = must(createBoard({ document: text }));
    const loaded = figuresOnPage(again.core)[0] as NonNullable<ReturnType<typeof figuresOnPage>[number]>;
    expect(loaded.props.script).toBe(shape.props.script);
    expect(loaded.props.mode).toBe(shape.props.mode);
    expect(loaded.props.w).toBe(shape.props.w);
    expect(loaded.props.h).toBe(shape.props.h);
    again.dispose();
  });

  it('a card that stays out of the view is saved after the scheduler\'s 8 s: its app is freed, it shows a picture written without an undo step, and the script is untouched', async () => {
    open();
    const [id] = cards(1);
    await settle();
    expect(stateOf(id as string)).toBe('live');
    const first = card(id as string).app;
    const before = undoSteps();
    core().camera?.moveTo(4000, 0, 1, performance.now());
    view().requestFrame();
    await tick(9500);
    expect(stateOf(id as string)).toBe('picture');
    expect(first?.destroyed).toBe(true);
    expect(aliveApps().length).toBe(0);
    expect(figureOf(core(), id as string)?.props.picture).toMatch(/^data:image\//);
    expect(figureOf(core(), id as string)?.props.script).toBe(SCRIPT);
    expect(undoSteps()).toBe(before);
  });

  it('a card that comes back into view goes live again from its script', async () => {
    open();
    const [id] = cards(1);
    await settle();
    core().camera?.moveTo(4000, 0, 1, performance.now());
    view().requestFrame();
    await settle();
    core().camera?.moveTo(0, 0, 1, performance.now());
    view().requestFrame();
    await settle();
    expect(stateOf(id as string)).toBe('live');
    expect(card(id as string).app?.toScript()).toContain('b = a + 1');
  });
});

describe('a mount that fails or a context that is lost (errors.md figure_failed; B26 failed, dead)', () => {
  it('a failed mount keeps the picture, shows a small error badge, reports figure_failed once, and the board keeps working', async () => {
    probe.failWhen = () => true;
    open();
    const [id] = cards(1);
    setFigurePicture(core(), id as string, PIC);
    await settle();
    expect(stateOf(id as string)).toBe('failed');
    expect(card(id as string).badge.hidden).toBe(false);
    expect(card(id as string).badge.textContent).toBe('Figure unavailable');
    expect(card(id as string).picEl.hidden).toBe(false);
    expect(card(id as string).picEl.getAttribute('src')).toBe(PIC);
    expect(card(id as string).app).toBeUndefined();
    const e = kindsOf('figure_failed');
    expect(e.length).toBe(1);
    expect(e[0]?.ok).toBe(false);
    expect(JSON.stringify(e[0]?.detail)).toContain(id as string);
    expect(layer().liveCount).toBe(0);
    // the board still takes strokes
    (board as Board).setTool('pen');
    (board as Board).host.sample(sample({ phase: 'down', x: 700, y: 100 }));
    for (let i = 1; i <= 8; i++) (board as Board).host.sample(sample({ phase: 'move', x: 700 + i * 10, y: 100 + i * 5, time: i * 8 }));
    (board as Board).host.sample(sample({ phase: 'up', x: 780, y: 140, time: 100 }));
    expect(core().store.shapesOn(core().pages.current as string).some((s) => s.kind === 'ink')).toBe(true);
  });

  it('a failed card holds no app and is not counted as live', async () => {
    probe.failWhen = (n) => n === 1;
    open();
    const ids = cards(3);
    await settle();
    const states = ids.map(stateOf);
    expect(states.filter((s) => s === 'failed').length).toBe(1);
    expect(states.filter((s) => s === 'live').length).toBe(2);
    expect(layer().liveCount).toBe(2);
    expect(aliveApps().length).toBe(2);
  });

  it('is tried again at the next live order, and goes live if that works', async () => {
    probe.failWhen = (n) => n === 1;
    open();
    const [id] = cards(1);
    await settle();
    expect(stateOf(id as string)).toBe('failed');
    // out of view and back: the scheduler gives a new live order
    core().camera?.moveTo(3000, 0, 1, performance.now());
    view().requestFrame();
    await settle();
    core().camera?.moveTo(0, 0, 1, performance.now());
    view().requestFrame();
    await settle();
    expect(stateOf(id as string)).toBe('live');
    expect(card(id as string).badge.hidden).toBe(true);
    expect(probe.calls).toBe(2);
  });

  it('fails twice: the card is dead, a picture with its badge, and is not tried again', async () => {
    probe.failWhen = () => true;
    open();
    const [id] = cards(1);
    await settle();
    for (let i = 0; i < 2; i++) {
      core().camera?.moveTo(3000, 0, 1, performance.now());
      view().requestFrame();
      await settle();
      core().camera?.moveTo(0, 0, 1, performance.now());
      view().requestFrame();
      await settle();
    }
    expect(stateOf(id as string)).toBe('dead');
    expect(card(id as string).badge.hidden).toBe(false);
    expect(kindsOf('figure_failed').length).toBe(2);
    const calls = probe.calls;
    core().camera?.moveTo(3000, 0, 1, performance.now());
    view().requestFrame();
    await settle();
    core().camera?.moveTo(0, 0, 1, performance.now());
    view().requestFrame();
    await settle();
    expect(probe.calls).toBe(calls);
    expect(stateOf(id as string)).toBe('dead');
    expect(layer().scheduler.state.figures.has(id as string)).toBe(false);
  });

  it('a dead card is tried again when its script changes, and its badge goes', async () => {
    probe.failWhen = () => true;
    open();
    const [id] = cards(1);
    await settle();
    for (let i = 0; i < 2; i++) {
      core().camera?.moveTo(3000, 0, 1, performance.now());
      view().requestFrame();
      await settle();
      core().camera?.moveTo(0, 0, 1, performance.now());
      view().requestFrame();
      await settle();
    }
    expect(stateOf(id as string)).toBe('dead');
    probe.failWhen = undefined;
    setFigureScript(core(), id as string, '# incantly 1\nn = 1');
    await settle();
    expect(card(id as string).badge.hidden).toBe(true);
    expect(stateOf(id as string)).toBe('live');
  });

  it('a script that cannot be loaded into the app is a failed mount: the card shows its picture, figure_failed, and no app is kept', async () => {
    probe.loadThrows = true;
    open();
    const [id] = cards(1);
    setFigurePicture(core(), id as string, PIC);
    await settle();
    expect(['failed', 'dead']).toContain(stateOf(id as string));
    expect(kindsOf('figure_failed').length).toBeGreaterThan(0);
    expect(card(id as string).app).toBeUndefined();
    expect(aliveApps().length).toBe(0);
    expect(card(id as string).picEl.getAttribute('src')).toBe(PIC);
  });

  it('a mode that is not one the app knows is a failed card, not a throw', async () => {
    open();
    const [id] = cards(1);
    await settle();
    setFigureMode(core(), id as string, 'bogus');
    await settle();
    expect(card(id as string).life.state).not.toBe('live');
    expect(kindsOf('figure_failed').length).toBeGreaterThan(0);
  });

  it('a lost graphics context in a live card frees the app and the card shows its picture (B26 `unmounted`: the app is lost)', async () => {
    open();
    const [id] = cards(1);
    setFigurePicture(core(), id as string, PIC);
    await settle();
    expect(stateOf(id as string)).toBe('live');
    const first = card(id as string).app;
    const canvas = card(id as string).hostEl.querySelector('canvas') as HTMLCanvasElement;
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    await tick(50);
    expect(first?.destroyed, 'the lost app is freed').toBe(true);
    expect(card(id as string).app).not.toBe(first);
  });

  it('an app destroyed from outside is noticed: the card does not keep a dead app (B26 `unmounted`: the app is lost)', async () => {
    open();
    const [id] = cards(1);
    await settle();
    const first = card(id as string).app as MountedApp;
    first.destroy();
    await tick(1500);
    const now = card(id as string).app;
    expect(now === undefined || now.destroyed === false).toBe(true);
  });

  it('after a lost context the card is claimed again when the scheduler still wants it', async () => {
    open();
    const [id] = cards(1);
    await settle();
    const canvas = card(id as string).hostEl.querySelector('canvas') as HTMLCanvasElement;
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    await settle();
    expect(stateOf(id as string)).toBe('live');
    expect(probe.calls).toBe(2);
  });
});

describe('cards sit above ink and shapes (ui.md Figure cards)', () => {
  it('the card layer sits between the tiles and the overlay, so handles draw over a card', () => {
    open();
    const wrap = root().querySelector('.ib-figures')?.parentElement as HTMLElement;
    const kids = [...wrap.children];
    const at = kids.indexOf(root().querySelector('.ib-figures') as Element);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(kids.length - 1);
    expect(kids[kids.length - 1]?.tagName).toBe('CANVAS');
  });

  it('a card\'s stack order follows its shape\'s order', async () => {
    open();
    const ids = cards(3);
    await tick(100);
    const z = ids.map((id) => Number(card(id).slot.style.zIndex));
    expect(z[0]).toBeLessThan(z[1] as number);
    expect(z[1]).toBeLessThan(z[2] as number);
  });
});
