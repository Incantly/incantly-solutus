// @vitest-environment node
/**
 * R10 and AGENTS.md "Nothing throws across a package boundary": every public function of the core returns a Result (or
 * a plain value) for extreme and hostile input, and a host callback that throws is caught. Also R1: the core runs in
 * Node with no DOM, no clock and no timer.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  Camera, Cameras, History, IndexGrid, KindRegistry, Pages, Store, checkRecord, keyBetween, keysBetween, loadBoard, saveBoard, snapshot,
  isBoardError, isKey, polygonMeetsBox, pointInPolygon, recordTypeOf, toPage, toScreen, writeDocument,
} from '../../src/index';
import type { BoardError } from '../../src/index';
import { addRects, makeBoard, makeKinds, must, rectKind, rng, shape } from './helpers';

const WEIRD_NUMBERS = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, 0, 1e308, -1e308, 5e-324, 2 ** 53, -(2 ** 53), 0.1 + 0.2];
const WEIRD_STRINGS = ['', ' ', 'page:', ':', 'shape:', 'page:nope', '__proto__', 'constructor', 'toString', 'x'.repeat(100_000), '\u0000', '😀', '../../etc'];

/** Runs `fn` and fails with the name of the call when it throws. */
function quiet(name: string, fn: () => unknown): unknown {
  try {
    return fn();
  } catch (e) {
    throw new Error(`${name} threw: ${String(e)}`, { cause: e });
  }
}

describe('Camera and the screen maths', () => {
  it('never throws for any number, and keeps the zoom inside 0.05 to 20', () => {
    for (const a of WEIRD_NUMBERS) {
      for (const b of WEIRD_NUMBERS) {
        const c = new Camera({ x: a, y: b, zoom: a });
        quiet('zoomAbout', () => c.zoomAbout(a, b, a, b));
        quiet('zoomBy', () => c.zoomBy(a, b, a, b));
        quiet('panBy', () => c.panBy(a, b));
        quiet('moveTo', () => c.moveTo(a, b, a, b));
        quiet('tick', () => c.tick(a));
        quiet('visibleBounds', () => c.visibleBounds(a, b, a));
        quiet('toPage', () => c.toPage(a, b));
        quiet('toScreen', () => c.toScreen(a, b));
        quiet('toPage fn', () => toPage(c, a, b));
        quiet('toScreen fn', () => toScreen(c, a, b));
        expect(c.zoom).toBeGreaterThanOrEqual(0.05);
        expect(c.zoom).toBeLessThanOrEqual(20);
        expect(Number.isFinite(c.zoom)).toBe(true);
        expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true);
      }
    }
  });
});

describe('IndexGrid', () => {
  it('never throws for extreme bounds, points and polygons', () => {
    const g = new IndexGrid();
    for (const a of WEIRD_NUMBERS) {
      for (const b of WEIRD_NUMBERS) {
        const bounds = { minX: a, minY: b, maxX: a, maxY: b };
        quiet('insert', () => g.insert('s', bounds));
        quiet('move', () => g.move('s', bounds));
        quiet('queryBox', () => g.queryBox({ minX: a, minY: b, maxX: b, maxY: a }));
        quiet('queryViewport', () => g.queryViewport({ minX: a, minY: b, maxX: b, maxY: a }));
        quiet('queryPoint', () => g.queryPoint(a, b, a));
        quiet('queryLasso', () => g.queryLasso([a, b, b, a, a, a]));
        quiet('pointInPolygon', () => pointInPolygon(a, b, [a, b, b, a, a, a]));
        quiet('polygonMeetsBox', () => polygonMeetsBox([a, b, b, a, a, a], a, b, b, a));
      }
    }
    for (const id of WEIRD_STRINGS) {
      quiet('insert id', () => g.insert(id, { minX: 0, minY: 0, maxX: 1, maxY: 1 }));
      quiet('remove id', () => g.remove(id));
      quiet('has', () => g.has(id));
      quiet('boundsOf', () => g.boundsOf(id));
    }
  });

  it('survives a shape as large as the number line without hanging or throwing', () => {
    const g = new IndexGrid();
    const t0 = performance.now();
    const r = quiet('insert huge', () => g.insert('huge', { minX: -1e12, minY: -1e12, maxX: 1e12, maxY: 1e12 })) as { ok: boolean };
    expect(typeof r.ok).toBe('boolean');
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe('fractional keys', () => {
  it('returns a Result for any pair of keys', () => {
    const inputs: (string | null)[] = [null, ...WEIRD_STRINGS, 'V', 'a', 'z', 'a0', '0', '9', 'Zz'];
    for (const a of inputs) {
      for (const b of inputs) {
        const r = quiet('keyBetween', () => keyBetween(a, b)) as { ok: boolean };
        expect(typeof r.ok).toBe('boolean');
      }
    }
    for (const n of [0, 1, -1, Number.NaN, 5, 1e9]) {
      if (n > 100_000) continue;
      const r = quiet('keysBetween', () => keysBetween(null, null, n)) as { ok: boolean };
      expect(typeof r.ok).toBe('boolean');
    }
    expect(quiet('keysBetween nan', () => keysBetween('a', 'b', Number.NaN))).toBeDefined();
    for (const s of WEIRD_STRINGS) expect(typeof isKey(s)).toBe('boolean');
  });

  it('gives keys in order that sort between their neighbours', () => {
    const ks = must(keysBetween(null, null, 50));
    expect([...ks].sort()).toEqual([...ks]);
    const mid = must(keyBetween(ks[10] as string, ks[11] as string));
    expect(mid > (ks[10] as string) && mid < (ks[11] as string)).toBe(true);
    const before = must(keyBetween(null, ks[0] as string));
    expect(before < (ks[0] as string)).toBe(true);
    const after = must(keyBetween(ks[49] as string, null));
    expect(after > (ks[49] as string)).toBe(true);
  });

  it('can make a key between two neighbours 1,000 times in a row without failing', () => {
    let lo = must(keyBetween(null, null));
    const hi = must(keyBetween(lo, null));
    for (let i = 0; i < 1000; i++) {
      const mid = must(keyBetween(lo, hi));
      expect(mid > lo && mid < hi).toBe(true);
      lo = mid;
    }
  });
});

describe('Store, History, Pages, Cameras', () => {
  it('returns errors for hostile ids and values, and changes nothing', () => {
    const b = makeBoard();
    const before = b.store.size;
    for (const id of WEIRD_STRINGS) {
      quiet('get', () => b.store.get(id));
      quiet('has', () => b.store.has(id));
      quiet('all', () => b.store.all(id));
      quiet('shapesOn', () => b.store.shapesOn(id));
      quiet('shapeCount', () => b.store.shapeCount(id));
      quiet('inkPoints', () => b.store.inkPoints(id));
      quiet('goToPage', () => b.pages.goToPage(id));
      quiet('removePage', () => b.pages.removePage(id));
      quiet('renamePage', () => b.pages.renamePage(id, id));
      quiet('movePage', () => b.pages.movePage(id, 0));
      quiet('duplicatePage', () => b.pages.duplicatePage(id));
      quiet('addPage name', () => b.pages.addPage({ name: id }));
      quiet('forPage', () => b.cameras.forPage(id));
      quiet('save camera', () => b.cameras.save(id));
      quiet('get page', () => b.pages.get(id));
      quiet('recordTypeOf', () => recordTypeOf(id));
      quiet('change put', () => b.store.change('user', (tx) => {
        tx.put(shape(id, b.page));
        tx.update(id, { x: 1 });
        tx.remove(id);
        tx.get(id);
      }));
    }
    for (const n of WEIRD_NUMBERS) {
      quiet('movePage n', () => b.pages.movePage(b.page, n));
      quiet('shape numbers', () => b.store.change('user', (tx) => void tx.put(shape('shape:n', b.page, { x: n, y: n, rotation: n, opacity: n }))));
      quiet('update numbers', () => b.store.change('user', (tx) => void tx.update(b.page, { x: n })));
    }
    expect(b.pages.list().length).toBeGreaterThanOrEqual(1);
    expect(b.store.size).toBeGreaterThanOrEqual(before);
  });

  it('prototype-pollution keys in a patch or in meta change no object outside the record', () => {
    const b = makeBoard();
    addRects(b, 1);
    const r = b.store.change('user', (tx) => {
      tx.update('shape:1', JSON.parse('{"__proto__":{"polluted":true},"meta":{"__proto__":{"polluted":true}},"props":{"constructor":{"prototype":{"polluted":true}}}}') as Record<string, unknown>);
    });
    expect(typeof r.ok).toBe('boolean');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('catches a throw in the callback, in a kind’s check, in a kind’s points hook and in listeners, whatever is thrown', () => {
    for (const thrown of [new Error('x'), 'a string', 42, null, undefined, { odd: true }]) {
      const b = makeBoard();
      const r = quiet('change', () => b.store.change('user', () => {
        throw thrown;
      })) as { ok: boolean };
      expect(r.ok).toBe(false);
      expect(isBoardError(r)).toBe(true);
    }
    const errors: BoardError[] = [];
    const kinds = new KindRegistry();
    must(kinds.register({ ...rectKind, check: () => { throw new Error('check blew up'); } }));
    const store = new Store({ kinds, onError: (e) => errors.push(e) });
    must(store.change('user', (tx) => void must(tx.put({ id: 'page:1', name: 'P', index: 'V', background: 'none' }))));
    const r = quiet('put with a throwing check', () => store.change('user', (tx) => void tx.put(shape('shape:1', 'page:1')))) as { ok: boolean };
    expect(r.ok).toBe(false);
    expect(store.has('shape:1')).toBe(false);

    const points = new KindRegistry();
    must(points.register({ ...rectKind, points: () => { throw new Error('points blew up'); } }));
    const s2 = new Store({ kinds: points });
    must(s2.change('user', (tx) => void must(tx.put({ id: 'page:1', name: 'P', index: 'V', background: 'none' }))));
    expect(quiet('points throws', () => s2.change('user', (tx) => void tx.put(shape('shape:1', 'page:1')))) as { ok: boolean }).toBeDefined();

    for (const thrown of ['listener string', 7, undefined, null]) {
      const s3 = new Store({ kinds: makeKinds(), onError: () => undefined });
      s3.on(() => {
        throw thrown;
      });
      const c = quiet('listener throws', () => s3.change('user', (tx) => void must(tx.put({ id: 'page:1', name: 'P', index: 'V', background: 'none' })))) as { ok: boolean };
      expect(c.ok).toBe(true);
      expect(s3.has('page:1')).toBe(true);
    }
    const noHandler = new Store({ kinds: makeKinds() });
    noHandler.on(() => {
      throw new Error('no onError given');
    });
    expect(quiet('listener throws, no onError', () => noHandler.change('user', (tx) => void must(tx.put({ id: 'page:1', name: 'P', index: 'V', background: 'none' })))) as { ok: boolean }).toMatchObject({ ok: true });
  });

  it('catches a throwing history listener and a throwing current-page listener', () => {
    const b = makeBoard();
    b.history.on(() => {
      throw new Error('history listener');
    });
    b.pages.onCurrent(() => {
      throw new Error('current listener');
    });
    const p = quiet('addPage', () => b.pages.addPage()) as { ok: boolean };
    expect(p.ok).toBe(true);
    const g = quiet('goToPage', () => b.pages.goToPage((p as unknown as { value: { id: string } }).value.id)) as { ok: boolean };
    expect(typeof g.ok).toBe('boolean');
    quiet('undo', () => b.history.undo());
    quiet('redo', () => b.history.redo());
  });

  it('keeps working after every kind of refusal', () => {
    const b = makeBoard({ shapesPerPage: 2, pages: 2 });
    quiet('limit', () => addRects(b, 1));
    for (let i = 0; i < 5; i++) {
      quiet('refused', () => b.store.change('user', (tx) => void must(tx.put(shape(`shape:${50 + i}`, b.page, { index: `z${i}` })))));
      quiet('undo empty', () => b.history.undo());
      quiet('remove last', () => b.pages.removePage(b.page));
    }
    expect(b.store.shapeCount(b.page)).toBeLessThanOrEqual(2);
    expect(b.store.change('user', () => 1).ok).toBe(true);
  });

  it('History options with odd numbers do not throw', () => {
    const b = makeBoard({}, false);
    for (const maxSteps of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      const h = quiet('new History', () => new History(b.store, { maxSteps })) as History;
      quiet('undo', () => h.undo());
      h.dispose();
    }
  });

  it('Store options with odd limits do not throw', () => {
    for (const n of WEIRD_NUMBERS) {
      const s = quiet('new Store', () => new Store({ limits: { shapesPerPage: n, pages: n, inkPointsPerPage: n, assetBytes: n } })) as Store;
      const p = quiet('new Pages', () => new Pages(s)) as Pages;
      quiet('addPage', () => p.addPage());
      quiet('Cameras', () => new Cameras(s));
    }
  });

  it('KindRegistry.register refuses odd definitions with a Result', () => {
    const k = new KindRegistry();
    for (const kind of ['', 'shape', 'page', 'camera', 'binding', 'asset']) {
      const r = quiet('register', () => k.register({ ...rectKind, kind })) as { ok: boolean };
      expect(r.ok, kind).toBe(false);
    }
    expect(k.register(rectKind).ok).toBe(true);
    expect(k.register(rectKind).ok).toBe(false);
    expect(k.kinds()).toEqual(['rect']);
    expect(k.has('rect')).toBe(true);
    expect(k.get('rect')?.kind).toBe('rect');
    expect(k.get('nope')).toBeUndefined();
  });

  it('checkRecord returns a Result for any value', () => {
    const kinds = makeKinds();
    const values: unknown[] = [null, undefined, 0, 'x', [], {}, { id: 1 }, { id: 'shape:1' }, { id: 'page:1', name: 5 }, () => 1, Symbol('s'), { id: 'shape:1', page: 'page:1', kind: {} },
      { id: 'camera:1', page: 'page:1', x: 1, y: 1, zoom: 'a' }, { id: 'asset:1', mime: 5, size: -1, data: null }, { id: 'binding:1', kind: 'arrow' }];
    for (const v of values) {
      const r = quiet('checkRecord', () => checkRecord(v, kinds)) as { ok: boolean };
      expect(r.ok, String(typeof v)).toBe(false);
      expect(isBoardError(r)).toBe(true);
    }
  });

  it('checkRecord returns a frozen copy, so a later change to the input does not reach the store', () => {
    const kinds = makeKinds();
    const src = shape('shape:1', 'page:1', { props: { w: 5, h: 6 } });
    const r = must(checkRecord(src, kinds)) as unknown as { props: { w: number } };
    (src.props as { w: number }).w = 999;
    expect(r.props.w).toBe(5);
    expect(Object.isFrozen(r)).toBe(true);
  });
});

describe('files', () => {
  const good = (): string => {
    const b = makeBoard();
    addRects(b, 5);
    return must(saveBoard(b.store));
  };

  it('loadBoard returns a Result for any text', () => {
    const texts = ['', ' ', '\u0000', '{"format":"incantly-board"', 'x'.repeat(10_000), '[' .repeat(50_000), '{"a":'.repeat(20_000), '{"format":"incantly-board","version":1e999}', '\uFEFF{}'];
    for (const t of texts) {
      const r = quiet('loadBoard', () => loadBoard(t)) as { ok: boolean };
      expect(typeof r.ok, t.slice(0, 20)).toBe('boolean');
    }
  });

  it('loadBoard returns a Result for a good file with a byte, a field or a value broken (seeded)', () => {
    const rand = rng(424242);
    const base = good();
    const kinds = makeKinds();
    let ok = 0;
    let bad = 0;
    for (let i = 0; i < 400; i++) {
      let text = base;
      const n = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        const at = Math.floor(rand() * text.length);
        const how = rand();
        if (how < 0.3) text = text.slice(0, at) + text.slice(at + 1);
        else if (how < 0.6) text = text.slice(0, at) + String.fromCharCode(32 + Math.floor(rand() * 90)) + text.slice(at + 1);
        else if (how < 0.8) text = text.slice(0, at);
        else text = text.slice(0, at) + ['null', '-1', '1e999', '"x"', '[]', '{}', 'true'][Math.floor(rand() * 7)] + text.slice(at);
      }
      const r = quiet('loadBoard mutated', () => loadBoard(text, { kinds })) as { ok: boolean };
      if (r.ok) ok++;
      else bad++;
      if (!r.ok) expect(isBoardError(r)).toBe(true);
    }
    expect(ok + bad).toBe(400);
    expect(bad).toBeGreaterThan(0);
  });

  it('loadBoard returns a Result when a field is replaced by every JSON type, one field at a time', () => {
    const doc = JSON.parse(good()) as Record<string, unknown>;
    const swaps: unknown[] = [null, true, 0, -1, 1.5, 'x', [], {}, [[]], { a: 1 }];
    const walk = (value: unknown, path: (string | number)[], out: (string | number)[][]): void => {
      out.push(path);
      if (typeof value === 'object' && value !== null) {
        for (const [k, v] of Object.entries(value)) walk(v, [...path, Array.isArray(value) ? Number(k) : k], out);
      }
    };
    const paths: (string | number)[][] = [];
    walk(doc, [], paths);
    let tried = 0;
    for (const path of paths) {
      if (path.length === 0) continue;
      for (const swap of swaps) {
        const copy = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
        let at: Record<string | number, unknown> = copy;
        for (const key of path.slice(0, -1)) at = at[key] as Record<string | number, unknown>;
        at[path[path.length - 1] as string | number] = swap;
        const r = quiet(`loadBoard ${path.join('.')}`, () => loadBoard(JSON.stringify(copy), { kinds: makeKinds() })) as { ok: boolean };
        expect(typeof r.ok).toBe('boolean');
        tried++;
      }
    }
    expect(tried).toBeGreaterThan(100);
  });

  it('saveBoard and writeDocument return a Result for odd meta, and never throw on a cycle or a BigInt', () => {
    const b = makeBoard();
    const cyc: Record<string, unknown> = {};
    cyc['self'] = cyc;
    for (const meta of [{}, { n: Number.NaN }, { n: Number.POSITIVE_INFINITY }, { big: 10n }, cyc, { f: () => 1 }, { u: undefined }, { s: Symbol('x') }]) {
      const r = quiet('saveBoard', () => saveBoard(b.store, meta as Record<string, unknown>)) as { ok: boolean };
      expect(typeof r.ok).toBe('boolean');
      const w = quiet('writeDocument', () => writeDocument(snapshot(b.store, meta as Record<string, unknown>))) as { ok: boolean };
      expect(typeof w.ok).toBe('boolean');
    }
  });

  it('a migration that returns a non-object, or a file with a migration that loops, gives board_invalid', () => {
    const text = good();
    for (const out of [null, 5, 'x', [], undefined]) {
      const r = quiet('migration returns junk', () => loadBoard(text, { version: 2, migrations: [{ from: 1, run: () => out as never }] })) as { ok: boolean };
      expect(r.ok).toBe(false);
    }
    const loop = quiet('migration loops', () => loadBoard(text, { version: 3, migrations: [{ from: 1, run: (d) => d }, { from: 2, run: (d) => d }] })) as { ok: boolean };
    expect(typeof loop.ok).toBe('boolean');
  });
});

describe('the core has no DOM, clock, timer or random (R1.1)', () => {
  it('runs in Node where window, document and navigator do not exist', () => {
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined');
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
    expect(typeof (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame).toBe('undefined');
  });

  it('runs a full session without touching Date, performance.now, a timer, requestAnimationFrame, fetch or Math.random', () => {
    const trap = (obj: object, name: string) => vi.spyOn(obj as Record<string, (...args: unknown[]) => unknown>, name).mockImplementation(() => {
      throw new Error(`${name} used by the core`);
    });
    const traps = [
      trap(Date, 'now'),
      trap(performance, 'now'),
      trap(globalThis, 'setTimeout'),
      trap(globalThis, 'setInterval'),
      trap(globalThis, 'queueMicrotask'),
      trap(Math, 'random'),
      trap(globalThis, 'fetch'),
    ];
    const RealDate = Date;
    const dateCalls: string[] = [];
    vi.stubGlobal('Date', new Proxy(RealDate, {
      construct: () => {
        dateCalls.push('new Date');
        throw new Error('new Date used by the core');
      },
    }));
    try {
      const b = makeBoard();
      addRects(b, 20);
      const p2 = must(b.pages.addPage());
      must(b.pages.duplicatePage(b.page));
      must(b.pages.renamePage(p2.id, 'two'));
      must(b.pages.movePage(p2.id, 0));
      must(b.history.undo());
      must(b.history.redo());
      const cam = must(b.cameras.forPage(b.page));
      cam.zoomAbout(3, 10, 10, 100);
      cam.tick(400);
      must(b.cameras.save(b.page));
      const g = new IndexGrid();
      for (const s of b.store.shapesOn(b.page)) must(g.insert(s.id, { minX: s.x, minY: s.y, maxX: s.x + 10, maxY: s.y + 10 }));
      g.queryViewport({ minX: 0, minY: 0, maxX: 400, maxY: 400 });
      const text = must(saveBoard(b.store));
      must(loadBoard(text, { kinds: makeKinds() }));
      expect(dateCalls).toEqual([]);
      for (const t of traps) expect(t).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      for (const t of traps) t.mockRestore();
    }
  });

  it('gives the same ids and the same file text on two runs (no randomness, no clock)', () => {
    const run = (): string => {
      const b = makeBoard();
      addRects(b, 5);
      must(b.pages.addPage());
      return must(saveBoard(b.store));
    };
    expect(run()).toBe(run());
  });
});
