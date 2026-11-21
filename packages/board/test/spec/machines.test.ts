// @vitest-environment node
/**
 * The round-1 tables (docs/state-machines.md, "board", B1 to B4): every row of every `*_MACHINE` table, every move the
 * document does not list, and the refusals a move with no row causes in the running code.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { MachineTable } from '@incantly/kernel';
import { CAMERA_MACHINE, HANDLE_MACHINE, HISTORY_MACHINE, TX_MACHINE, Camera, Pages, Store } from '../../src/index';
import { addRects, makeBoard, must, shape } from './helpers';

type Row<S extends string, E extends string> = readonly [from: S, event: E, to: S];

/** The state the table leads to from `from` on `event`, or undefined when the table has no such move. */
const moveOf = <S extends string, E extends string>(table: MachineTable<S, E>, from: S, event: E): S | undefined =>
  (table[from] as { readonly [V in E]?: S })[event];

/** Walks a table against the rows of the document: each row is exact, and every other (state, event) pair has no move. */
function walk<S extends string, E extends string>(
  name: string,
  table: MachineTable<S, E>,
  states: readonly S[],
  events: readonly E[],
  rows: readonly Row<S, E>[],
): void {
  describe(name, () => {
    it('has exactly the states of the document', () => {
      expect(Object.keys(table).sort()).toEqual([...states].sort());
    });
    for (const [from, event, to] of rows) {
      it(`${from} --${event}--> ${to}`, () => {
        expect(moveOf(table, from, event)).toBe(to);
      });
    }
    it('has no move for any pair the document does not list', () => {
      const listed = new Set(rows.map(([f, e]) => `${f}|${e}`));
      for (const s of states) {
        for (const e of events) {
          if (!listed.has(`${s}|${e}`)) expect(moveOf(table, s, e), `${s} on ${e}`).toBeUndefined();
        }
      }
    });
    it('leads only to states of the document', () => {
      for (const [, , to] of rows) expect(states).toContain(to);
    });
  });
}

// B1
walk('B1 TX_MACHINE', TX_MACHINE, ['idle', 'open', 'notifying', 'nested'], ['begin', 'commit', 'abort', 'drained'], [
  ['idle', 'begin', 'open'],
  ['open', 'commit', 'notifying'],
  ['open', 'abort', 'idle'],
  ['notifying', 'drained', 'idle'],
  ['notifying', 'begin', 'nested'],
  ['nested', 'commit', 'notifying'],
  ['nested', 'abort', 'notifying'],
]);

walk('B1 HANDLE_MACHINE', HANDLE_MACHINE, ['live', 'closed'], ['close'], [['live', 'close', 'closed']]);

// B2
walk('B2 HISTORY_MACHINE', HISTORY_MACHINE, ['recording', 'undoing', 'redoing'], ['undo', 'redo', 'done'], [
  ['recording', 'undo', 'undoing'],
  ['recording', 'redo', 'redoing'],
  ['undoing', 'done', 'recording'],
  ['redoing', 'done', 'recording'],
]);

// B3 has no table: `Pages.state` is derived from the page count (see the test below)

// B4
walk('B4 CAMERA_MACHINE', CAMERA_MACHINE, ['steady', 'zooming'], ['zoom', 'settle'], [
  ['steady', 'zoom', 'zooming'],
  ['zooming', 'zoom', 'zooming'],
  ['zooming', 'settle', 'steady'],
]);

describe('moves with no row are refused by the running code', () => {
  it('B1: begin in open or nested (a change inside a callback) is refused with bad_argument and changes nothing', () => {
    const b = makeBoard();
    const before = b.store.size;
    let inner: ReturnType<Store['change']> | undefined;
    const outer = b.store.change('user', (tx) => {
      inner = b.store.change('user', (tx2) => {
        must(tx2.put(shape('shape:9', b.page)));
      });
      must(tx.put(shape('shape:1', b.page)));
    });
    expect(inner?.ok).toBe(false);
    expect(inner && !inner.ok ? inner.kind : '').toBe('bad_argument');
    expect(outer.ok).toBe(true);
    expect(b.store.has('shape:9')).toBe(false);
    expect(b.store.size).toBe(before + 1);
  });

  it('B1: a handle used after its callback returned (live -> closed has no way back) is refused with bad_argument', () => {
    const b = makeBoard();
    let kept: Parameters<Parameters<Store['change']>[1]>[0] | undefined;
    must(b.store.change('user', (tx) => {
      kept = tx;
    }));
    const r = kept?.put(shape('shape:1', b.page));
    expect(r?.ok).toBe(false);
    expect(r && !r.ok ? r.kind : '').toBe('bad_argument');
    expect(b.store.has('shape:1')).toBe(false);
  });

  it('B1: begin from idle needs one of the four origins; any other is refused and nothing is written', () => {
    const b = makeBoard();
    const r = b.store.change('robot' as never, (tx) => {
      must(tx.put(shape('shape:1', b.page)));
    });
    expect(r.ok).toBe(false);
    expect(b.store.has('shape:1')).toBe(false);
  });

  it('B1: a listener may write while notifying (begin from notifying); its diff follows the first in order', () => {
    const b = makeBoard();
    const seen: string[] = [];
    b.store.on((d) => {
      seen.push(d.added.map((r) => r.id).join(','));
      if (d.added.some((r) => r.id === 'shape:1')) must(b.store.change('host', (tx) => void must(tx.put(shape('shape:2', b.page)))));
    });
    must(b.store.change('user', (tx) => void must(tx.put(shape('shape:1', b.page)))));
    expect(seen).toEqual(['shape:1', 'shape:2']);
    expect(b.store.has('shape:2')).toBe(true);
  });

  it('B2: undo or redo called from a listener while a replay runs is refused with bad_argument', () => {
    const b = makeBoard();
    addRects(b, 2);
    b.history.seal();
    addRects(b, 1);
    let inner: ReturnType<typeof b.history.undo> | undefined;
    let inRedo: ReturnType<typeof b.history.redo> | undefined;
    let armed = true;
    b.store.on(() => {
      if (!armed) return;
      armed = false;
      inner = b.history.undo();
      inRedo = b.history.redo();
    });
    const stepsBefore = b.history.undoSteps;
    const r = b.history.undo();
    expect(r.ok).toBe(true);
    expect(inner && !inner.ok ? inner.kind : '').toBe('bad_argument');
    expect(inRedo && !inRedo.ok ? inRedo.kind : '').toBe('bad_argument');
    expect(b.history.undoSteps).toBe(stepsBefore - 1);
    expect(b.history.redoSteps).toBe(1);
  });

  it('B2: an empty stack is nothing_to_undo, returned before the machine moves', () => {
    const b = makeBoard();
    const u = b.history.undo();
    const r = b.history.redo();
    expect(!u.ok && u.kind).toBe('nothing_to_undo');
    expect(!r.ok && r.kind).toBe('nothing_to_undo');
    addRects(b, 1);
    expect(b.history.undo().ok).toBe(true);
  });

  it('B3: the state is derived from the page count each time it is read: empty, single, several, full', () => {
    const store = new Store({ limits: { pages: 3 } });
    const pages = new Pages(store);
    expect(pages.state).toBe('empty');
    must(pages.addPage());
    expect(pages.state).toBe('single');
    const second = must(pages.addPage());
    expect(pages.state).toBe('several');
    must(pages.addPage());
    expect(pages.state).toBe('full');
    must(pages.removePage(second.id));
    expect(pages.state).toBe('several');
  });

  it('B3: removePage in single is last_page and addPage in full is limit', () => {
    const b = makeBoard({ pages: 2 });
    expect(b.pages.state).toBe('single');
    const r = b.pages.removePage(b.page);
    expect(!r.ok && r.kind).toBe('last_page');
    must(b.pages.addPage());
    expect(b.pages.state).toBe('full');
    const a = b.pages.addPage();
    expect(!a.ok && a.kind).toBe('limit');
    const d = b.pages.duplicatePage(b.page);
    expect(!d.ok && d.kind).toBe('limit');
  });

  it('B4: settle without a zoom change is not a move; tick returns false and the camera stays steady', () => {
    const c = new Camera();
    expect(c.motion).toBe('steady');
    expect(c.tick(10_000)).toBe(false);
    expect(c.motion).toBe('steady');
    c.panBy(30, 40);
    expect(c.motion).toBe('steady');
    expect(c.tick(20_000)).toBe(false);
  });

  it('B4: a zoom clamped to the same value is not a change, so the camera does not leave steady at the limits', () => {
    const c = new Camera({ zoom: 20 });
    c.zoomAbout(50, 0, 0, 1000);
    expect(c.zoom).toBe(20);
    expect(c.motion).toBe('steady');
    const d = new Camera({ zoom: 0.05 });
    d.zoomAbout(0.001, 0, 0, 1000);
    expect(d.zoom).toBe(0.05);
    expect(d.motion).toBe('steady');
  });
});

describe('the tables match the document, row by row', () => {
  const text = readFileSync(fileURLToPath(new URL('../../../../docs/state-machines.md', import.meta.url)), 'utf8');
  const section = text.slice(text.indexOf('\n## board\n'), text.indexOf('\n## Explicit since the lint rules'));
  const tables: Readonly<Record<string, { readonly table: MachineTable<string, string>; readonly handle: boolean }>> = {
    B1: { table: TX_MACHINE as MachineTable<string, string>, handle: false },
    'B1 handle': { table: HANDLE_MACHINE as MachineTable<string, string>, handle: true },
    B2: { table: HISTORY_MACHINE as MachineTable<string, string>, handle: false },
    B4: { table: CAMERA_MACHINE as MachineTable<string, string>, handle: false },
  };

  /** The moves the document writes for one machine, with `any` expanded to every state of the table. */
  function documented(id: string): readonly (readonly [string, string, string])[] {
    const entry = tables[id] as { table: MachineTable<string, string>; handle: boolean };
    const heading = id.slice(0, 2);
    const start = section.indexOf(`### ${heading}.`);
    const end = section.indexOf('\n### ', start + 1);
    const body = section.slice(start, end === -1 ? undefined : end);
    const states = Object.keys(entry.table);
    const rows: (readonly [string, string, string])[] = [];
    for (const line of body.split('\n')) {
      if (!line.startsWith('|')) continue;
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.length < 5) continue;
      const [fromCell, eventCell, , toCell] = cells as [string, string, string, string];
      const from = /^`([a-z_]+)`( \(handle\))?$|^(any)$/.exec(fromCell);
      const event = /^`([a-z_]+)`$/.exec(eventCell);
      const to = /^`([a-z_]+)`$/.exec(toCell);
      if (from === null || event === null || to === null) continue;
      const isHandle = from[2] !== undefined;
      if (isHandle !== entry.handle) continue;
      for (const s of from[3] === 'any' ? states : [from[1] as string]) rows.push([s, event[1] as string, to[1] as string]);
    }
    return rows;
  }

  for (const id of Object.keys(tables)) {
    it(`${id}: every row of the document is a move of the table, and the table has no other move`, () => {
      const entry = tables[id] as { table: MachineTable<string, string>; handle: boolean };
      const rows = documented(id);
      expect(rows.length, `rows of ${id} found in the document`).toBeGreaterThan(0);
      for (const [from, event, to] of rows) expect(moveOf(entry.table, from, event), `${from} on ${event}`).toBe(to);
      const inTable = Object.entries(entry.table).reduce((n, [, moves]) => n + Object.keys(moves as object).length, 0);
      expect(inTable).toBe(new Set(rows.map(([f, e]) => `${f}|${e}`)).size);
    });
  }
});
