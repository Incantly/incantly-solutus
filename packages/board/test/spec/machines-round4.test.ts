/**
 * The round-4 tables (docs/state-machines.md, "Round 4", B26 to B30): every row of every `*_MACHINE` table is exact, every move
 * the document does not list has no row, and the running code refuses the moves with no row without changing state.
 * B26 figure card (`CARD_MACHINE`), B27 card input (`INPUT_MACHINE`), B28 camera motion (`MOTION_MACHINE`), B29 menus
 * (`MENU_MACHINE`, `MenuHost`), B30 key map (`KEYMAP_MACHINE`, `KeyMap`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StateMachine } from '@incantly/kernel';
import type { MountedApp } from '@incantly/sdk';
import {
  CARD_MACHINE, INPUT_MACHINE, KEYMAP_MACHINE, KeyMap, MENU_MACHINE, MOTION_MACHINE, MenuHost, addFigure, createBoard, defaultKeyTable, boardTools,
} from '../../src/index';
import type { Board, BoardError, FigureCard, MenuItem } from '../../src/index';
import { installCanvas2d, walk } from './ink-helpers';
import type { FakeCanvas, Row } from './ink-helpers';
import { SCRIPT, must, stubSize } from './round4-helpers';

const probe = vi.hoisted(() => ({ apps: [] as MountedApp[], calls: 0, failWhen: undefined as undefined | ((call: number) => boolean) }));

vi.mock('@incantly/sdk', async (original) => {
  const sdk = await original<typeof import('@incantly/sdk')>();
  return {
    ...sdk,
    createApp: async (o: Parameters<typeof sdk.createApp>[0]) => {
      probe.calls++;
      if (probe.failWhen?.(probe.calls)) throw new Error('no GPU in this test');
      const app = await sdk.createApp(o);
      probe.apps.push(app);
      return app;
    },
  };
});

type CardState = 'picture' | 'mounting' | 'live' | 'moving' | 'saving' | 'failed' | 'dead' | 'gone';
type CardEvent = 'claim' | 'mounted' | 'move' | 'settle' | 'release' | 'unmounted' | 'fail' | 'giveUp' | 'revive' | 'remove';

const CARD_STATES: readonly CardState[] = ['picture', 'mounting', 'live', 'moving', 'saving', 'failed', 'dead', 'gone'];
const CARD_EVENTS: readonly CardEvent[] = ['claim', 'mounted', 'move', 'settle', 'release', 'unmounted', 'fail', 'giveUp', 'revive', 'remove'];

/** The rows of the B26 table, one for each (state, event) pair the document lists. `any but gone` expands to the seven states. */
const CARD_ROWS: readonly Row<CardState, CardEvent>[] = [
  ['picture', 'claim', 'mounting'],
  ['mounting', 'claim', 'mounting'],
  ['mounting', 'mounted', 'live'],
  ['mounting', 'unmounted', 'picture'],
  ['mounting', 'fail', 'failed'],
  ['mounting', 'giveUp', 'dead'],
  ['failed', 'claim', 'mounting'],
  ['live', 'claim', 'live'],
  ['live', 'move', 'moving'],
  ['moving', 'claim', 'moving'],
  ['moving', 'settle', 'live'],
  ['live', 'unmounted', 'picture'],
  ['moving', 'unmounted', 'picture'],
  ['live', 'release', 'saving'],
  ['moving', 'release', 'saving'],
  ['saving', 'claim', 'live'],
  ['saving', 'unmounted', 'picture'],
  ['failed', 'revive', 'picture'],
  ['dead', 'revive', 'picture'],
  ...(['picture', 'mounting', 'live', 'moving', 'saving', 'failed', 'dead'] as const).map((s): Row<CardState, CardEvent> => [s, 'remove', 'gone']),
];

walk('B26 CARD_MACHINE', CARD_MACHINE, CARD_STATES, CARD_EVENTS, CARD_ROWS);

walk('B27 INPUT_MACHINE', INPUT_MACHINE, ['board', 'input'], ['give', 'release'], [
  ['board', 'give', 'input'],
  ['input', 'release', 'board'],
]);

walk('B28 MOTION_MACHINE', MOTION_MACHINE, ['still', 'moving'], ['moved', 'settle'], [
  ['still', 'moved', 'moving'],
  ['moving', 'moved', 'moving'],
  ['moving', 'settle', 'still'],
]);

walk('B29 MENU_MACHINE', MENU_MACHINE, ['closed', 'main', 'page', 'context'], ['openMain', 'openPage', 'openContext', 'close'], [
  ['closed', 'openMain', 'main'],
  ['closed', 'openPage', 'page'],
  ['closed', 'openContext', 'context'],
  ['main', 'close', 'closed'],
  ['page', 'close', 'closed'],
  ['context', 'close', 'closed'],
  ['main', 'openPage', 'page'],
  ['main', 'openContext', 'context'],
  ['page', 'openMain', 'main'],
  ['page', 'openContext', 'context'],
  ['context', 'openMain', 'main'],
  ['context', 'openPage', 'page'],
]);

walk('B30 KEYMAP_MACHINE', KEYMAP_MACHINE, ['building', 'sealed'], ['bind', 'seal', 'rebind'], [
  ['building', 'bind', 'building'],
  ['building', 'seal', 'sealed'],
  ['sealed', 'rebind', 'building'],
]);

/** Drives a real `StateMachine` (made by `make`) from every state with every event: a listed move goes, the others are refused and change nothing. */
function drive<S extends string, E extends string>(name: string, make: (from: S) => StateMachine<S, E>, states: readonly S[], events: readonly E[], rows: readonly Row<S, E>[]): void {
  describe(`${name} driven as a StateMachine`, () => {
    it('makes every listed move and refuses every other, leaving the state as it was', () => {
      let moves = 0;
      let refusals = 0;
      for (const from of states) {
        for (const event of events) {
          const row = rows.find(([f, e]) => f === from && e === event);
          const machine = make(from);
          const went = machine.send(event);
          if (row === undefined) {
            expect(went, `${from} on ${event} has no row`).toBe(false);
            expect(machine.state, `${from} on ${event} changed the state`).toBe(from);
            refusals++;
          } else {
            expect(went, `${from} on ${event}`).toBe(true);
            expect(machine.state, `${from} on ${event}`).toBe(row[2]);
            moves++;
          }
        }
      }
      expect(moves).toBe(rows.length);
      expect(refusals).toBeGreaterThan(0);
    });
  });
}

drive('B26', (from: CardState) => new StateMachine(CARD_MACHINE, from), CARD_STATES, CARD_EVENTS, CARD_ROWS);
drive('B27', (from: 'board' | 'input') => new StateMachine(INPUT_MACHINE, from), ['board', 'input'], ['give', 'release'], [['board', 'give', 'input'], ['input', 'release', 'board']]);
drive('B28', (from: 'still' | 'moving') => new StateMachine(MOTION_MACHINE, from), ['still', 'moving'], ['moved', 'settle'], [['still', 'moved', 'moving'], ['moving', 'moved', 'moving'], ['moving', 'settle', 'still']]);
drive('B29', (from: 'closed' | 'main' | 'page' | 'context') => new StateMachine(MENU_MACHINE, from), ['closed', 'main', 'page', 'context'], ['openMain', 'openPage', 'openContext', 'close'], [
  ['closed', 'openMain', 'main'], ['closed', 'openPage', 'page'], ['closed', 'openContext', 'context'], ['main', 'close', 'closed'], ['page', 'close', 'closed'], ['context', 'close', 'closed'],
  ['main', 'openPage', 'page'], ['main', 'openContext', 'context'], ['page', 'openMain', 'main'], ['page', 'openContext', 'context'], ['context', 'openMain', 'main'], ['context', 'openPage', 'page'],
]);
drive('B30', (from: 'building' | 'sealed') => new StateMachine(KEYMAP_MACHINE, from), ['building', 'sealed'], ['bind', 'seal', 'rebind'], [['building', 'bind', 'building'], ['building', 'seal', 'sealed'], ['sealed', 'rebind', 'building']]);

describe('B26 reachable invalid moves, from the document', () => {
  const none = (state: CardState, events: readonly CardEvent[]): void => {
    for (const event of events) expect((CARD_MACHINE[state] as Record<string, string | undefined>)[event], `${state} on ${event}`).toBeUndefined();
  };
  it('`move` and `settle` have no row in picture, mounting, saving, failed and dead', () => {
    for (const s of ['picture', 'mounting', 'saving', 'failed', 'dead'] as const) none(s, ['move', 'settle']);
  });
  it('`mounted` has no row in picture or saving, so an app that arrives after a release is freed', () => {
    none('picture', ['mounted']);
    none('saving', ['mounted']);
  });
  it('`release` has no row in picture, mounting or failed', () => {
    for (const s of ['picture', 'mounting', 'failed'] as const) none(s, ['release']);
  });
  it('every event in `gone` has no row', () => {
    none('gone', CARD_EVENTS);
  });
  it('a card that failed is tried again only by a live order (`claim`), and a dead card only by `revive`', () => {
    expect(CARD_MACHINE.failed['claim']).toBe('mounting');
    none('dead', ['claim']);
  });
  it('B27: `give` in input and `release` in board have no row', () => {
    expect((INPUT_MACHINE.input as Record<string, string | undefined>)['give']).toBeUndefined();
    expect((INPUT_MACHINE.board as Record<string, string | undefined>)['release']).toBeUndefined();
  });
  it('B28: `settle` in still has no row', () => {
    expect((MOTION_MACHINE.still as Record<string, string | undefined>)['settle']).toBeUndefined();
  });
  it('B29: `close` in closed has no row, and opening the menu that is already open has no row', () => {
    const t = MENU_MACHINE as Record<string, Record<string, string | undefined>>;
    expect(t['closed']?.['close']).toBeUndefined();
    expect(t['main']?.['openMain']).toBeUndefined();
    expect(t['page']?.['openPage']).toBeUndefined();
    expect(t['context']?.['openContext']).toBeUndefined();
  });
  it('B30: `bind` and `seal` in sealed have no row', () => {
    const t = KEYMAP_MACHINE as Record<string, Record<string, string | undefined>>;
    expect(t['sealed']?.['bind']).toBeUndefined();
    expect(t['sealed']?.['seal']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// the running code: B26 to B28

let fake: FakeCanvas;
let unsize: () => void;
let container: HTMLElement;
let board: Board | undefined;
let errors: BoardError[];

beforeEach(() => {
  probe.apps = [];
  probe.calls = 0;
  probe.failWhen = undefined;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  fake = installCanvas2d();
  unsize = stubSize(1000, 700);
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
const open = (): Board => (board = must(createBoard({ container, canvas2dOnly: true, onError: (e) => errors.push(e) })));
const layer = (): NonNullable<Board['view']>['figures'] => (board as Board).view?.figures as NonNullable<Board['view']>['figures'];

/** Events that have no row from `state`. */
const refusedFrom = (state: CardState): CardEvent[] => CARD_EVENTS.filter((e) => !CARD_ROWS.some(([f, ev]) => f === state && ev === e));

/** Sends each event with no row to the card's own machine: all are refused and the card stays where it was. */
function refuses(card: FigureCard, state: CardState): void {
  expect(card.life.state).toBe(state);
  for (const event of refusedFrom(state)) {
    expect(card.life.send(event), `${state} on ${event}`).toBe(false);
    expect(card.life.state, `${state} on ${event}`).toBe(state);
  }
}

describe('B26 on running cards: moves with no row are refused', () => {
  it('a card that is a picture, a live card and a moving card refuse what the table does not list', async () => {
    open();
    const ids = Array.from({ length: 4 }, (_, i) => must(addFigure((board as Board).core, { at: { x: 150 + i * 150, y: 350 }, script: SCRIPT })));
    await tick(1500);
    const states = ids.map((id) => (layer().cards.get(id) as FigureCard).life.state);
    const pic = ids[states.indexOf('picture')] as string;
    const live = ids[states.indexOf('live')] as string;
    refuses(layer().cards.get(pic) as FigureCard, 'picture');
    // the card's own methods are refused the same way
    const picCard = layer().cards.get(pic) as FigureCard;
    picCard.move();
    picCard.settle(1);
    expect(picCard.life.state).toBe('picture');
    expect(picCard.giveInput()).toBe(false);
    expect(picCard.input.state).toBe('board');
    picCard.releaseInput();
    expect(picCard.input.state).toBe('board');
    refuses(layer().cards.get(live) as FigureCard, 'live');
    (board as Board).core.camera?.panBy(-30, 0);
    (board as Board).view?.requestFrame();
    await tick(16);
    expect((layer().cards.get(live) as FigureCard).life.state).toBe('moving');
    refuses(layer().cards.get(live) as FigureCard, 'moving');
  });

  it('a failed card and a dead card refuse what the table does not list', async () => {
    probe.failWhen = () => true;
    open();
    const id = must(addFigure((board as Board).core, { at: { x: 400, y: 350 }, script: SCRIPT }));
    await tick(1500);
    const card = layer().cards.get(id) as FigureCard;
    refuses(card, 'failed');
    card.move();
    card.settle(1);
    expect(card.life.state).toBe('failed');
    for (let i = 0; i < 2; i++) {
      (board as Board).core.camera?.moveTo(3000, 0, 1, performance.now());
      (board as Board).view?.requestFrame();
      await tick(1500);
      (board as Board).core.camera?.moveTo(0, 0, 1, performance.now());
      (board as Board).view?.requestFrame();
      await tick(1500);
    }
    refuses(card, 'dead');
  });

  it('a card whose shape was removed is gone and refuses every event', async () => {
    open();
    const id = must(addFigure((board as Board).core, { at: { x: 400, y: 350 }, script: SCRIPT }));
    await tick(1500);
    const card = layer().cards.get(id) as FigureCard;
    (board as Board).core.store.change('user', (tx) => tx.remove(id));
    await tick(300);
    expect(card.life.state).toBe('gone');
    for (const event of CARD_EVENTS) {
      expect(card.life.send(event), event).toBe(false);
      expect(card.life.state).toBe('gone');
    }
    card.move();
    card.settle(1);
    card.destroy();
    expect(card.life.state).toBe('gone');
    expect(layer().cards.has(id)).toBe(false);
  });

  it('a gone card takes no order from the scheduler (a goLive, build or restore after removal does nothing)', async () => {
    open();
    const id = must(addFigure((board as Board).core, { at: { x: 400, y: 350 }, script: SCRIPT }));
    await tick(1500);
    const card = layer().cards.get(id) as FigureCard;
    const calls = probe.calls;
    (board as Board).core.store.change('user', (tx) => tx.remove(id));
    await tick(300);
    card.goLive();
    card.build();
    card.restore();
    await tick(500);
    expect(card.life.state).toBe('gone');
    expect(probe.calls).toBe(calls);
  });

  it('B28: the layer refuses `settle` while still, and its machine is `still` with the camera at rest', async () => {
    open();
    must(addFigure((board as Board).core, { at: { x: 400, y: 350 }, script: SCRIPT }));
    await tick(1500);
    expect(layer().motion.state).toBe('still');
    expect(layer().motion.send('settle')).toBe(false);
    expect(layer().motion.state).toBe('still');
  });

  it('B27: only one card is in `input` at a time, and the one in `input` is live', async () => {
    open();
    const ids = [0, 1].map((i) => must(addFigure((board as Board).core, { at: { x: 250 + i * 400, y: 350 }, script: SCRIPT })));
    await tick(1500);
    layer().activate(ids[0] as string);
    layer().activate(ids[1] as string);
    await tick(100);
    const holders = [...layer().cards.values()].filter((c) => c.input.state === 'input');
    expect(holders.length).toBe(1);
    expect(holders[0]?.life.state).toBe('live');
    expect(layer().inputId).toBe(holders[0]?.id);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// B29 on a running MenuHost

describe('B29 on a running MenuHost', () => {
  let root: HTMLElement;
  let host: MenuHost;
  let seen: BoardError[];
  const items: readonly MenuItem[] = [{ id: 'one', label: 'One', run: () => undefined }];
  const here = { x: 10, y: 10 };

  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
    seen = [];
    host = new MenuHost({ root, fns: {}, label: (k) => k, onError: (e) => seen.push(e), requestFrame: () => undefined, mac: false });
  });
  afterEach(() => {
    host.dispose();
    root.remove();
  });

  const menus = (): number => root.querySelectorAll('[data-menu]').length;

  it('starts closed with no element, and `close` while closed does nothing', () => {
    expect(host.state).toBe('closed');
    host.close();
    expect(host.state).toBe('closed');
    expect(menus()).toBe(0);
  });

  it.each([['main'], ['page'], ['context']] as const)('closed -> %s -> closed', (kind) => {
    host.open(kind, items, { kind: kind === 'context' ? 'board' : kind, ...(kind === 'page' ? { page: 'page:1' } : {}) }, here);
    expect(host.state).toBe(kind);
    expect(menus()).toBe(1);
    host.close();
    expect(host.state).toBe('closed');
    expect(menus()).toBe(0);
  });

  const kinds = ['main', 'page', 'context'] as const;
  for (const from of kinds) {
    for (const to of kinds) {
      if (from === to) continue;
      it(`${from} -> ${to} closes the open menu first: one menu at a time`, () => {
        host.open(from, items, { kind: from === 'context' ? 'board' : from }, here);
        host.open(to, items, { kind: to === 'context' ? 'board' : to }, here);
        expect(host.state).toBe(to);
        expect(menus()).toBe(1);
        expect(root.querySelector(`[data-menu="${to}"]`)).not.toBeNull();
      });
    }
  }

  it('opening the menu that is open (main or page) does not rebuild it: it closes it', () => {
    let built = 0;
    const counting = new MenuHost({
      root,
      fns: { main: (list) => ((built += 1), list) },
      label: (k) => k,
      onError: () => undefined,
      requestFrame: () => undefined,
      mac: false,
    });
    counting.open('main', items, { kind: 'main' }, here);
    counting.open('main', items, { kind: 'main' }, here);
    expect(built).toBe(1);
    expect(counting.state).toBe('closed');
    counting.dispose();
  });

  it('the items are built when the menu opens, by the host function over the defaults', () => {
    const calls: string[] = [];
    const wrapped = new MenuHost({
      root,
      fns: { context: (list, target) => (calls.push(target.kind), [...list, { id: 'extra', label: 'Extra', run: () => undefined }]) },
      label: (k) => k,
      onError: () => undefined,
      requestFrame: () => undefined,
      mac: false,
    });
    expect(calls).toEqual([]);
    wrapped.open('context', items, { kind: 'board' }, here);
    expect(calls).toEqual(['board']);
    expect([...root.querySelectorAll<HTMLElement>('[data-item]')].map((b) => b.dataset['item'])).toEqual(['one', 'extra']);
    wrapped.dispose();
  });

  it('a function that throws or answers a bad list gives the default list and reports it', () => {
    const bad = new MenuHost({
      root,
      fns: {
        main: () => {
          throw new Error('x');
        },
        page: () => [{ nope: 1 }] as unknown as MenuItem[],
      },
      label: (k) => k,
      onError: (e) => seen.push(e),
      requestFrame: () => undefined,
      mac: false,
    });
    bad.open('main', items, { kind: 'main' }, here);
    expect([...root.querySelectorAll<HTMLElement>('[data-item]')].map((b) => b.dataset['item'])).toEqual(['one']);
    bad.close();
    bad.open('page', items, { kind: 'page', page: 'page:1' }, here);
    expect([...root.querySelectorAll<HTMLElement>('[data-item]')].map((b) => b.dataset['item'])).toEqual(['one']);
    expect(seen.length).toBe(2);
    bad.dispose();
  });

  it('an item that is disabled never runs; an enabled one runs after the menu closed, and a throw from it is reported', () => {
    const order: string[] = [];
    const list: readonly MenuItem[] = [
      { id: 'off', label: 'Off', enabled: () => false, run: () => void order.push('off') },
      { id: 'on', label: 'On', run: () => void order.push(`on:${host.state}`) },
      {
        id: 'boom',
        label: 'Boom',
        run: () => {
          throw new Error('bad');
        },
      },
    ];
    host.open('main', list, { kind: 'main' }, here);
    root.querySelector<HTMLButtonElement>('[data-item="off"]')?.click();
    expect(order).toEqual([]);
    expect(host.state).toBe('main');
    root.querySelector<HTMLButtonElement>('[data-item="on"]')?.click();
    expect(order).toEqual(['on:closed']);
    host.open('main', list, { kind: 'main' }, here);
    expect(() => root.querySelector<HTMLButtonElement>('[data-item="boom"]')?.click()).not.toThrow();
    expect(host.state).toBe('closed');
    expect(seen.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// B30 on a running KeyMap

describe('B30 on a running KeyMap', () => {
  const defaults = defaultKeyTable(boardTools);
  const press = (map: KeyMap, key: string, mods: { mod?: boolean; shift?: boolean; alt?: boolean } = {}): string | undefined =>
    map.actionOf({ key, down: true, shift: mods.shift === true, alt: mods.alt === true, mod: mods.mod === true, repeat: false });

  it('a map made by `from` is sealed and answers lookups', () => {
    const map = KeyMap.from(defaults, {});
    expect(map.state).toBe('sealed');
    expect(press(map, 'p')).toBe('pen');
    expect(press(map, 'z', { mod: true })).toBe('undo');
  });

  it('puts the host\'s entries first, then the defaults it did not name', () => {
    const map = KeyMap.from(defaults, { eraser: 'p' });
    expect(press(map, 'p')).toBe('eraser');
    expect(map.keysOf('pen')).toEqual([]);
    expect(map.keysOf('eraser')).toEqual(['p']);
    expect(map.keysOf('lasso')).toEqual(['l']);
    expect(map.errors.some((e) => e.kind === 'shortcut_conflict')).toBe(true);
  });

  it('a key already taken by an earlier action is shortcut_conflict with detail.key and detail.actions; the earlier action keeps it', () => {
    const map = KeyMap.from({}, { a: 'x', b: 'X' });
    const e = map.errors.find((x) => x.kind === 'shortcut_conflict');
    expect(e).toBeDefined();
    expect(e?.detail?.['key']).toBe('x');
    expect(e?.detail?.['actions']).toEqual(['a', 'b']);
    expect(map.keysOf('a')).toEqual(['x']);
    expect(map.keysOf('b')).toEqual([]);
    expect(press(map, 'x')).toBe('a');
  });

  it('a key string that does not parse is bad_argument and is left out', () => {
    const map = KeyMap.from({}, { a: ['x', 'ctrl+ctrl+y', ''] });
    expect(map.errors.filter((x) => x.kind === 'bad_argument').length).toBe(2);
    expect(map.keysOf('a')).toEqual(['x']);
  });

  it('`false` removes an action\'s keys, and a string or a list replaces them', () => {
    const map = KeyMap.from(defaults, { pen: false, eraser: ['x', 'y'], rect: 'q' });
    expect(map.keysOf('pen')).toEqual([]);
    expect(map.keysOf('eraser')).toEqual(['x', 'y']);
    expect(map.keysOf('rect')).toEqual(['q']);
    expect(press(map, 'p')).toBeUndefined();
    expect(map.errors).toEqual([]);
  });

  it('normalises each key string: mod, shift, alt, the key in lower case, in that order (B30)', () => {
    const map = KeyMap.from({}, { a: 'Shift+Ctrl+Z', b: 'Cmd+Alt+K', c: 'META+SHIFT+P', d: 'Alt+Shift+Mod+K' });
    expect(map.keysOf('a')[0]).toBe('mod+shift+z');
    expect(map.keysOf('b')[0]).toBe('mod+alt+k');
    expect(map.keysOf('c')[0]).toBe('mod+shift+p');
    expect(map.keysOf('d')[0]).toBe('mod+shift+alt+k');
  });

  it('`rebind` clears the table, fills it from new options, and the map answers again (sealed)', () => {
    const map = KeyMap.from(defaults, { pen: 'x' });
    expect(press(map, 'x')).toBe('pen');
    map.rebind(defaults, { eraser: 'x' });
    expect(map.state).toBe('sealed');
    expect(press(map, 'x')).toBe('eraser');
    expect(press(map, 'p')).toBe('pen');
    expect(map.errors.some((e) => e.kind === 'shortcut_conflict' && JSON.stringify(e.detail).includes('pen'))).toBe(false);
  });

  it('`rebind` forgets the errors of the earlier build', () => {
    const map = KeyMap.from({}, { a: 'x', b: 'x' });
    expect(map.errors.length).toBe(1);
    map.rebind({}, { a: 'x', b: 'y' });
    expect(map.errors).toEqual([]);
  });

  it('a symbol typed with Shift is found by its own character or by shift and the digit', () => {
    const map = KeyMap.from(defaults, {});
    expect(press(map, ')', { shift: true })).toBe('zoom100');
    expect(press(map, '!', { shift: true })).toBe('zoomFit');
  });
});
