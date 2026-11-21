/**
 * Board core benchmarks against the round-1 rows of docs/features/board/design.md 13 (Node, warm): open a 1,000-shape
 * board, switch to a page of 2,000 shapes, undo a 500-shape paste, hit test at a point.
 *
 * Run: `npx vitest run --config packages/board/bench/vitest.config.ts`. Each case is a test that fails when it misses
 * its target; the number is the best of several warm runs. The rows are measured on the core alone: "open" is parse,
 * check and build the spatial index of the current page (everything before the first picture that the core owns);
 * "switch" is `goToPage` plus building the index of the page from its records.
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { Cameras, History, IndexGrid, KindRegistry, Pages, Store, keysBetween, loadBoard, saveBoard } from '../src/index';
import type { BoardResult, KindDef, ShapeRecord } from '../src/index';

interface RectProps {
  readonly w: number;
  readonly h: number;
}

const rectKind: KindDef<RectProps> = {
  kind: 'rect',
  defaults: { w: 40, h: 30 },
  check(props: unknown): BoardResult<RectProps> {
    const p = (props ?? {}) as Record<string, unknown>;
    const w = p['w'] ?? 40;
    const h = p['h'] ?? 30;
    if (typeof w !== 'number' || typeof h !== 'number') return { ok: false, kind: 'record_invalid', message: 'w and h must be numbers', detail: { field: 'props' } };
    return { ok: true, value: { w, h }, notices: [] };
  },
};

function makeKinds(): KindRegistry {
  const kinds = new KindRegistry();
  const r = kinds.register(rectKind);
  if (!r.ok) throw new Error(r.message);
  return kinds;
}

const must = <T>(r: BoardResult<T>): T => {
  if (!r.ok) throw new Error(`${r.kind}: ${r.message}`);
  return r.value;
};

/** `n` rects on `page` in a grid of 100 columns, 60 units apart. */
function rects(page: string, n: number, from: number): ShapeRecord[] {
  const idx = must(keysBetween(null, null, n));
  const out: ShapeRecord[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `shape:${from + i}`, page, kind: 'rect', x: (i % 100) * 60, y: Math.floor(i / 100) * 50, rotation: 0, parent: null,
      index: idx[i] as string, locked: false, opacity: 1, props: { w: 40, h: 30 }, meta: {},
    });
  }
  return out;
}

function buildStore(counts: readonly number[]): { store: Store; pages: Pages; ids: string[] } {
  const store = new Store({ kinds: makeKinds() });
  const pages = new Pages(store);
  const ids: string[] = [];
  let next = 1;
  for (const n of counts) {
    const p = must(pages.addPage());
    ids.push(p.id);
    must(store.change('host', (tx) => {
      for (const s of rects(p.id, n, next)) must(tx.put(s));
    }, { history: false }));
    next += n;
  }
  must(pages.goToPage(ids[0] as string));
  return { store, pages, ids };
}

/** The index of a page, built from its records. */
function indexOf(store: Store, page: string): IndexGrid {
  const grid = new IndexGrid();
  for (const s of store.shapesOn(page)) {
    const p = s.props as RectProps;
    must(grid.insert(s.id, { minX: s.x, minY: s.y, maxX: s.x + p.w, maxY: s.y + p.h }));
  }
  return grid;
}

/** Best of `runs` timed calls after `warm` warm-up calls, in ms. */
function best(fn: () => void, runs = 15, warm = 3): number {
  for (let i = 0; i < warm; i++) fn();
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    min = Math.min(min, performance.now() - t0);
  }
  return min;
}

const report = (name: string, value: number, unit: string, target: number): void => {
  process.stdout.write(`${value <= target ? 'ok  ' : 'MISS'}  ${name.padEnd(46)} ${value.toFixed(3).padStart(10)} ${unit}   target ${target} ${unit}\n`);
};

describe('board core, design 13', () => {
  it('opens a 1,000-shape board in under 200 ms', () => {
    const { store } = buildStore([1000]);
    const text = must(saveBoard(store));
    const ms = best(() => {
      const loaded = must(loadBoard(text, { kinds: makeKinds() }));
      const pages = new Pages(loaded.store);
      new Cameras(loaded.store);
      indexOf(loaded.store, pages.current as string);
    });
    report('open a 1,000-shape board (load + index)', ms, 'ms', 200);
    expect(ms).toBeLessThan(200);
  });

  it('switches to a page of 2,000 shapes in under 100 ms', () => {
    const { store, pages, ids } = buildStore([100, 2000]);
    const enter = best(() => {
      must(pages.goToPage(ids[0] as string));
      must(pages.goToPage(ids[1] as string));
      indexOf(store, ids[1] as string);
    });
    report('switch to a page of 2,000 shapes', enter, 'ms', 100);
    expect(enter).toBeLessThan(100);
  });

  it('undoes a 500-shape paste in under 16 ms (and redoes it)', () => {
    const store = new Store({ kinds: makeKinds() });
    const pages = new Pages(store);
    const page = must(pages.addPage());
    const history = new History(store);
    const paste = rects(page.id, 500, 1);
    let undoBest = Number.POSITIVE_INFINITY;
    let redoBest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 18; i++) {
      must(store.change('user', (tx) => {
        for (const s of paste) must(tx.put(s));
      }));
      const t0 = performance.now();
      must(history.undo());
      const t1 = performance.now();
      must(history.redo());
      const t2 = performance.now();
      if (i >= 3) {
        undoBest = Math.min(undoBest, t1 - t0);
        redoBest = Math.min(redoBest, t2 - t1);
      }
      must(history.undo());
      history.clear();
    }
    report('undo of a 500-shape paste', undoBest, 'ms', 16);
    report('redo of a 500-shape paste (info)', redoBest, 'ms', 16);
    expect(undoBest).toBeLessThan(16);
  });

  it('hit tests a point in under 0.1 ms with 10,000 shapes on the page', () => {
    const { store, ids } = buildStore([10_000]);
    const grid = indexOf(store, ids[0] as string);
    const out: string[] = [];
    const POINTS = 2000;
    const ms = best(() => {
      for (let i = 0; i < POINTS; i++) {
        out.length = 0;
        grid.queryPoint((i * 37) % 6000 + 5, (i * 53) % 5000 + 5, 2, out);
      }
    });
    const perCall = ms / POINTS;
    report('hit test at a point (10,000 shapes)', perCall, 'ms', 0.1);
    expect(perCall).toBeLessThan(0.1);
  });

  it('queries a viewport of a 10,000-shape page (info)', () => {
    const { store, ids } = buildStore([10_000]);
    const grid = indexOf(store, ids[0] as string);
    const out: string[] = [];
    const ms = best(() => {
      out.length = 0;
      grid.queryViewport({ minX: 1000, minY: 500, maxX: 2000, maxY: 1100 }, out);
    }, 50);
    report('viewport query, 1,000 x 600 on 10,000 shapes', ms, 'ms', 1);
    expect(out.length).toBeGreaterThan(0);
  });
});
