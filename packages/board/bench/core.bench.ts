/**
 * Board core benchmarks against the round-1 rows of docs/features/board/design.md 13 (Node, warm): open a 1,000-shape
 * board, switch to a page of 2,000 shapes, undo a 500-shape paste, hit test at a point.
 *
 * Round 2 adds the ink rows: core work per input sample, a frame while drawing, pan and zoom with 10,000 shapes, a lasso
 * of 2,000 strokes, memory for 100,000 ink points, and no garbage collection over a simulated 10 s stroke. They are
 * measured on the core alone (no canvas in Node): a "frame" is the work the core does for a frame, which is everything
 * the web view's frame function does before it calls the painter. "Pen sample to pixel" needs a screen and is measured
 * in Chrome (`docs/design/performance.md`).
 *
 * Run: `npx vitest run --config packages/board/bench/vitest.config.ts`. Each case is a test that fails when it misses
 * its target; the number is the best of several warm runs. The rows are measured on the core alone: "open" is parse,
 * check and build the spatial index of the current page (everything before the first picture that the core owns);
 * "switch" is `goToPage` plus building the index of the page from its records.
 */
import { PerformanceObserver, performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
  BoardCore, Cameras, History, IndexGrid, KindRegistry, Pages, PointerGate, Snapper, Store, TileCache, ToolHost, defaultTools, copySelection, createOverlayState, defaultStyles, keysBetween,
  loadBoard, pasteData, recogniseStroke, saveBoard, tileBox,
} from '../src/index';
import type { BoardResult, Bounds, InputSample, KindDef, ShapeRecord, Tile, ToolContext } from '../src/index';

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

// ---------------------------------------------------------------------------------------------------------------
// round 2: ink (design 13)

interface Rig {
  readonly core: BoardCore;
  readonly host: ToolHost;
}

function makeRig(tool = 'pen'): Rig {
  const made = BoardCore.create({});
  if (!made.ok) throw new Error(made.message);
  const core = made.value;
  const ctx: ToolContext = {
    core,
    styles: defaultStyles(),
    overlay: createOverlayState(),
    camera: () => core.camera,
    requestFrame: () => undefined,
    strokeEnded: () => undefined,
    strokeDropped: () => undefined,
  };
  return { core, host: new ToolHost(ctx, defaultTools, tool) };
}

/** One sample object, reused for every event, as the input layer does (`phase` is read through a getter, as in `web/input.ts`). */
class Mutable implements InputSample {
  pointer = 1;
  device: 'pen' | 'touch' | 'mouse' = 'pen';
  x = 0;
  y = 0;
  pressure = 0.6;
  tiltX = 0;
  tiltY = 0;
  twist = 0;
  buttons = 1;
  time = 0;
  predicted = false;
  #step: InputSample['phase'] = 'move';

  get phase(): InputSample['phase'] {
    return this.#step;
  }

  setPhase(next: InputSample['phase']): void {
    this.#step = next;
  }
}

const reused = (): Mutable => new Mutable();

/** The y of a wavy line, so the stroke has turns. */
const wave = (i: number): number => 200 + 80 * Math.sin(i / 14) + 20 * Math.sin(i / 3.7);

/** Ink strokes of `points` points each in a grid (60 units apart, 100 columns), put in one transaction without history. */
function putStrokes(core: BoardCore, count: number, points: number, stride: 3 | 5 = 3): void {
  const page = core.pages.current as string;
  const idx = must(keysBetween(null, null, count));
  must(
    core.store.change(
      'host',
      (tx) => {
        for (let i = 0; i < count; i++) {
          const pts = new Float32Array(points * stride);
          for (let k = 0; k < points; k++) {
            pts[k * stride] = (k * 40) / points;
            pts[k * stride + 1] = 12 * Math.sin(k / 3) + 15;
            pts[k * stride + 2] = 0.3 + 0.6 * ((k % 7) / 7);
          }
          must(
            tx.put({
              id: `shape:i${i}`, page, kind: 'ink', x: (i % 100) * 60, y: Math.floor(i / 100) * 50, rotation: 0, parent: null, index: idx[i] as string, locked: false, opacity: 1,
              props: { points: pts, stride, nib: 'pen', size: 3, color: '#1f2430', opacity: 1 }, meta: {},
            }),
          );
        }
      },
      { history: false },
    ),
  );
}

const stats = (times: Float64Array): { mean: number; p95: number; max: number } => {
  const sorted = Float64Array.from(times).sort();
  let sum = 0;
  for (const t of times) sum += t;
  return { mean: sum / times.length, p95: sorted[Math.floor(sorted.length * 0.95)] as number, max: sorted[sorted.length - 1] as number };
};

const reportRow = (name: string, value: number, unit: string, target: number, extra = ''): void => {
  process.stdout.write(`${value <= target ? 'ok  ' : 'MISS'}  ${name.padEnd(54)} ${value.toFixed(4).padStart(10)} ${unit}   target ${target} ${unit}${extra}\n`);
};

const info = (name: string, value: string): void => {
  process.stdout.write(`info  ${name.padEnd(54)} ${value}\n`);
};

function collectNow(): void {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (!gc) throw new Error('the memory and "no garbage" rows need Node started with --expose-gc: run the benches with packages/board/bench/vitest.config.ts');
  // twice: the second run frees what the first one's finalisers released
  gc();
  gc();
}

describe('board ink, design 13 (round 2)', () => {
  it('core work per input sample is under 0.1 ms (gate, tool host, 0.5 px filter, simulated pressure, commit of the stroke)', () => {
    const { host, core } = makeRig();
    const gate = new PointerGate();
    const s = reused();
    const STROKES = 30;
    const PER = 1000;
    const stroke = (n: number, mixed: boolean): void => {
      for (let i = 0; i < PER; i++) {
        s.setPhase(i === 0 ? 'down' : i === PER - 1 ? 'up' : 'move');
        s.x = i * 0.8 + n;
        s.y = wave(i) + n * 3;
        s.pressure = mixed && n % 2 === 0 ? 0.3 + 0.5 * ((i % 40) / 40) : Number.NaN;
        s.time = i * 4;
        if (gate.admit(s as InputSample) === 'draw') host.sample(s as InputSample);
      }
    };
    for (let w = 0; w < 3; w++) stroke(0, false);
    core.history.clear();
    const t0 = performance.now();
    for (let n = 0; n < STROKES; n++) stroke(n, true);
    const perSample = (performance.now() - t0) / (STROKES * PER);
    reportRow('core work per input sample', perSample, 'ms', 0.1);
    expect(core.store.all('shape').length).toBeGreaterThanOrEqual(STROKES);
    expect(perSample).toBeLessThan(0.1);
  });

  it('a frame while drawing a stroke is under 2 ms of script (rebuild the live outline, hand the painter its view), over a simulated 10 s stroke', () => {
    const { host, core } = makeRig();
    const s = reused();
    const FRAMES = 600;
    const PER_FRAME = 4;
    const times = new Float64Array(FRAMES);
    let i = 0;
    s.setPhase('down');
    s.x = 0;
    s.y = wave(0);
    s.pressure = 0.5;
    host.sample(s as InputSample);
    s.setPhase('move');
    for (let f = 0; f < FRAMES; f++) {
      const t0 = performance.now();
      for (let k = 0; k < PER_FRAME; k++) {
        i++;
        s.x = i * 1.1;
        s.y = wave(i);
        s.pressure = 0.3 + 0.6 * ((i % 50) / 50);
        s.time = i * 4;
        host.sample(s as InputSample);
      }
      core.live.rebuild(2);
      core.live.view();
      times[f] = performance.now() - t0;
    }
    const st = stats(times);
    const early = stats(times.subarray(0, 100));
    const late = stats(times.subarray(FRAMES - 100));
    reportRow('frame while drawing (mean over 10 s)', st.mean, 'ms', 2, `   p95 ${st.p95.toFixed(3)}  max ${st.max.toFixed(3)}  points ${core.live.count}`);
    info('  first 100 frames / last 100 frames, mean', `${early.mean.toFixed(3)} ms / ${late.mean.toFixed(3)} ms`);
    expect(st.mean).toBeLessThan(2);
    expect(st.p95).toBeLessThan(2);
  });

  describe('pan and zoom with 10,000 shapes on the page', () => {
    const W = 1280;
    const H = 800;
    const DPR = 1;

    /** What the web view's frame does before the painter is called: the camera, the tiles in view, the draw list of each tile that needs it. */
    function frame(core: BoardCore, cache: TileCache, list: Tile[], ids: string[], now: number): number {
      const camera = core.camera as NonNullable<BoardCore['camera']>;
      camera.tick(now);
      cache.beginFrame();
      cache.visible(camera, W, H, DPR, list);
      let drawn = 0;
      for (const tile of list) {
        if (tile.needsDraw && drawn < 6) {
          const scale = Math.pow(2, tile.k);
          const box = tileBox(tile.k, tile.tx, tile.ty);
          const grow = 2 / scale;
          core.drawList.itemsIn({ minX: box.minX - grow, minY: box.minY - grow, maxX: box.maxX + grow, maxY: box.maxY + grow }, scale);
          cache.markDrawn(tile);
          drawn++;
        }
      }
      // culling for the frame: the viewport and a 256 px margin
      ids.length = 0;
      core.drawList.cull(camera.visibleBounds(W, H, 256), 0, ids);
      return drawn;
    }

    function setup(): { core: BoardCore; cache: TileCache; list: Tile[]; ids: string[] } {
      const { core } = makeRig();
      putStrokes(core, 10_000, 16);
      return { core, cache: new TileCache(), list: [], ids: [] };
    }

    it('panning: a frame is under 8 ms with a cold cache (the outlines of strokes that come into view are built) and with a warm one', () => {
      const { core, cache, list, ids } = setup();
      const camera = core.camera as NonNullable<BoardCore['camera']>;
      const FRAMES = 300;
      const run = (): Float64Array => {
        camera.moveTo(0, 0, 1, 0);
        const times = new Float64Array(FRAMES);
        for (let f = 0; f < FRAMES; f++) {
          camera.panBy(-14, -6);
          const t0 = performance.now();
          frame(core, cache, list, ids, f * 16);
          times[f] = performance.now() - t0;
        }
        return times;
      };
      const cold = stats(run());
      const warm = stats(run());
      reportRow('pan, 10,000 shapes, cold, mean frame', cold.mean, 'ms', 8, `   p95 ${cold.p95.toFixed(3)}  max ${cold.max.toFixed(3)}`);
      reportRow('pan, 10,000 shapes, warm, mean frame', warm.mean, 'ms', 8, `   p95 ${warm.p95.toFixed(3)}  max ${warm.max.toFixed(3)}`);
      expect(core.store.shapeCount(core.pages.current as string)).toBe(10_000);
      expect(cold.p95).toBeLessThan(8);
      expect(warm.p95).toBeLessThan(8);
    });

    it('zooming: a frame is under 8 ms while the zoom changes about the pointer', () => {
      const { core, cache, list, ids } = setup();
      const camera = core.camera as NonNullable<BoardCore['camera']>;
      camera.moveTo(1000, 500, 1, 0);
      const FRAMES = 200;
      const times = new Float64Array(FRAMES);
      for (let f = 0; f < FRAMES; f++) {
        camera.zoomBy(f < FRAMES / 2 ? 1.012 : 1 / 1.012, W / 2, H / 2, f * 16);
        const t0 = performance.now();
        frame(core, cache, list, ids, f * 16);
        times[f] = performance.now() - t0;
      }
      const st = stats(times);
      reportRow('zoom, 10,000 shapes, mean frame', st.mean, 'ms', 8, `   p95 ${st.p95.toFixed(3)}  max ${st.max.toFixed(3)}`);
      expect(st.p95).toBeLessThan(8);
    });
  });

  it('a lasso of 2,000 strokes selects in under 4 ms', () => {
    const { core, host } = makeRig('lasso');
    putStrokes(core, 2000, 30);
    const s = reused();
    // a loop of 48 points round the whole grid of 2,000 strokes (100 columns by 20 rows)
    const loop: [number, number][] = [];
    for (let k = 0; k < 12; k++) loop.push([-200 + (k / 12) * 6600, -200]);
    for (let k = 0; k < 12; k++) loop.push([6400, -200 + (k / 12) * 1600]);
    for (let k = 0; k < 12; k++) loop.push([6400 - (k / 12) * 6600, 1400]);
    for (let k = 0; k < 12; k++) loop.push([-200, 1400 - (k / 12) * 1600]);
    core.camera?.moveTo(0, 0, 1, 0);
    let upMs = Number.POSITIVE_INFINITY;
    for (let run = 0; run < 14; run++) {
      core.selection.clear();
      s.device = 'mouse';
      s.pressure = Number.NaN;
      s.buttons = 1;
      loop.forEach(([x, y], i) => {
        s.setPhase(i === 0 ? 'down' : 'move');
        s.x = x;
        s.y = y;
        s.time = i * 8;
        host.sample(s as InputSample);
      });
      const [lx, ly] = loop[0] as [number, number];
      s.setPhase('up');
      s.x = lx;
      s.y = ly + 2;
      s.time = 1000;
      const t0 = performance.now();
      host.sample(s as InputSample);
      const ms = performance.now() - t0;
      if (run >= 3) upMs = Math.min(upMs, ms);
    }
    reportRow('lasso of 2,000 strokes (select, best of 11)', upMs, 'ms', 4);
    expect(core.selection.size).toBe(2000);
    expect(upMs).toBeLessThan(4);
  });

  it('100,000 ink points take under 8 MB in the store', () => {
    collectNow();
    const before = process.memoryUsage();
    const { core } = makeRig();
    putStrokes(core, 1000, 100, 3);
    collectNow();
    const after = process.memoryUsage();
    const mb = (after.heapUsed + after.arrayBuffers - (before.heapUsed + before.arrayBuffers)) / (1024 * 1024);
    reportRow('memory for 100,000 ink points (1,000 strokes of 100)', mb, 'MB', 8);
    expect(core.store.inkPoints(core.pages.current as string)).toBe(100_000);
    expect(mb).toBeLessThan(8);
    const withTilt = process.memoryUsage();
    const { core: other } = makeRig();
    putStrokes(other, 1000, 100, 5);
    collectNow();
    const after5 = process.memoryUsage();
    info('  the same with tilt (5 numbers a point)', `${((after5.heapUsed + after5.arrayBuffers - (withTilt.heapUsed + withTilt.arrayBuffers)) / (1024 * 1024)).toFixed(2)} MB`);
  });

  it('drawing makes no garbage: no collection runs over a simulated 10 s stroke (design 13: 0 collections)', async () => {
    const { host, core } = makeRig();
    const s = reused();
    const FRAME_MS = 1000 / 60;
    const SAMPLES_PER_FRAME = 4;
    const frames = Math.floor(10_000 / FRAME_MS);
    const run = (): void => {
      let i = 0;
      s.setPhase('down');
      s.x = 0;
      s.y = wave(0);
      s.pressure = 0.5;
      s.time = 0;
      host.sample(s as InputSample);
      s.setPhase('move');
      for (let f = 0; f < frames; f++) {
        for (let k = 0; k < SAMPLES_PER_FRAME; k++) {
          i++;
          s.x = i * 0.6;
          s.y = wave(i);
          s.pressure = 0.3 + 0.6 * ((i % 50) / 50);
          s.time = i * (FRAME_MS / SAMPLES_PER_FRAME);
          host.sample(s as InputSample);
        }
        core.live.rebuild(2);
        core.live.view();
      }
      s.setPhase('up');
      host.sample(s as InputSample);
    };
    // a first stroke of the same length grows every buffer, as a stroke in use has done
    run();
    core.history.clear();
    collectNow();
    let collections = 0;
    const obs = new PerformanceObserver((list) => {
      collections += list.getEntries().length;
    });
    obs.observe({ entryTypes: ['gc'] });
    run();
    await new Promise((r) => setTimeout(r, 50));
    obs.disconnect();
    info('collections during the second simulated 10 s stroke', `${collections}   (${frames} frames, ${frames * SAMPLES_PER_FRAME} samples)`);
    expect(collections).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// round 3: shapes and editing (design 13 and docs/design/performance.md)
//
// Reference engines: the other engines named for comparison (Box2D v3, Rapier, Jolt) are physics engines with no paste,
// selection-drag, snap or stroke recognition, so there is no like-for-like number for these rows; they are measured
// here against the design's own budgets only.

/** `n` filled rects in a grid of 100 columns, 60 units apart, put in one transaction. */
function putRects(core: BoardCore, n: number, history: boolean): string[] {
  const page = core.pages.current as string;
  const idx = must(keysBetween(null, null, n));
  const ids: string[] = [];
  must(
    core.store.change(
      'host',
      (tx) => {
        for (let i = 0; i < n; i++) {
          const id = tx.newId('shape');
          ids.push(id);
          must(
            tx.put({
              id, page, kind: 'rect', x: (i % 100) * 60, y: Math.floor(i / 100) * 50, rotation: 0, parent: null, index: idx[i] as string, locked: false, opacity: 1,
              props: { w: 40, h: 30, fill: '#ffcc00', stroke: '#1f2430', dash: 'solid', size: 3, label: '', font: 'sans' }, meta: {},
            }),
          );
        }
      },
      { history },
    ),
  );
  return ids;
}

describe('board shapes and editing, design 13 (round 3)', () => {
  it('undo of a 500-shape paste, with real shapes, is under 16 ms', () => {
    const { core } = makeRig('select');
    putRects(core, 20, false);
    const source = putRects(core, 500, false);
    const data = must(copySelection(core, source));
    let undoBest = Number.POSITIVE_INFINITY;
    let redoBest = Number.POSITIVE_INFINITY;
    core.history.clear();
    for (let i = 0; i < 18; i++) {
      const pasted = must(pasteData(core, data, { x: 20_000, y: 20_000 }));
      expect(pasted).toHaveLength(500);
      const t0 = performance.now();
      must(core.history.undo());
      const t1 = performance.now();
      must(core.history.redo());
      const t2 = performance.now();
      if (i >= 3) {
        undoBest = Math.min(undoBest, t1 - t0);
        redoBest = Math.min(redoBest, t2 - t1);
      }
      must(core.history.undo());
      core.history.clear();
    }
    report('undo of a 500-shape paste (rects, bindings checked)', undoBest, 'ms', 16);
    report('redo of a 500-shape paste (info)', redoBest, 'ms', 16);
    expect(undoBest).toBeLessThan(16);
  });

  it('a drag of 200 selected shapes: one move is under 4 ms of core work, and the whole drag is one undo step', () => {
    const { core, host } = makeRig('select');
    const ids = putRects(core, 2000, false).slice(0, 200);
    core.selection.set(ids);
    const s = reused();
    s.device = 'mouse';
    s.pressure = Number.NaN;
    s.buttons = 1;
    const FRAMES = 120;
    const times = new Float64Array(FRAMES);
    // the pointer goes down on the first selected shape (its middle: 20, 15) and moves 3 units to the right each frame
    s.setPhase('down');
    s.x = 20;
    s.y = 15;
    s.time = 0;
    host.sample(s as InputSample);
    s.setPhase('move');
    for (let f = 0; f < FRAMES; f++) {
      s.x = 20 + (f + 1) * 3;
      s.y = 15 + (f + 1);
      s.time = (f + 1) * 16;
      const t0 = performance.now();
      host.sample(s as InputSample);
      times[f] = performance.now() - t0;
    }
    s.setPhase('up');
    host.sample(s as InputSample);
    const st = stats(times.subarray(10));
    reportRow('drag of 200 selected shapes, one move (mean)', st.mean, 'ms', 4, `   p95 ${st.p95.toFixed(3)}  max ${st.max.toFixed(3)}`);
    expect(core.history.undoSteps).toBe(1);
    // snap guides may pull a few units; the shapes went most of the way
    expect((core.store.get(ids[0] as string) as ShapeRecord).x).toBeGreaterThan(300);
    expect(st.p95).toBeLessThan(4);
  });

  it('a snap search with 10,000 shapes is under 1 ms a move', () => {
    const { core } = makeRig('select');
    const ids = putRects(core, 10_000, false);
    const boxes: Bounds[] = [];
    for (const id of ids.slice(4000, 4400)) {
      const r = core.store.get(id) as ShapeRecord;
      boxes.push({ minX: r.x, minY: r.y, maxX: r.x + 40, maxY: r.y + 30 });
    }
    const snapper = new Snapper();
    snapper.begin(boxes);
    const MOVES = 2000;
    const ms = best(() => {
      for (let i = 0; i < MOVES; i++) {
        const x = 2400 + (i % 400) * 1.7;
        const y = 1000 + (i % 50) * 0.9;
        snapper.snapMove({ minX: x, minY: y, maxX: x + 40, maxY: y + 30 }, 6, 24);
      }
    });
    const perMove = ms / MOVES;
    report('snap search, 400 neighbours of 10,000 shapes (per move)', perMove, 'ms', 1);
    snapper.end();
    // the whole path: find the neighbours through the index, as the select tool does at the start of a drag
    const gridMs = best(() => {
      const found = core.index.grid.queryBox({ minX: 2000, minY: 800, maxX: 3600, maxY: 1400 });
      expect(found.length).toBeGreaterThan(0);
    });
    report('index query for the neighbours of a drag (10,000 shapes)', gridMs, 'ms', 1);
    expect(perMove).toBeLessThan(1);
    expect(gridMs).toBeLessThan(1);
  });

  it('recognising a 200-point stroke is under 1 ms', () => {
    const circle: number[] = [];
    for (let i = 0; i < 200; i++) {
      const a = (i / 200) * Math.PI * 2.05;
      circle.push(300 + (80 + 2 * Math.sin(i * 2.3)) * Math.cos(a), 300 + (80 + 2 * Math.sin(i * 2.3)) * Math.sin(a));
    }
    const polygon: number[] = [];
    const corners = [[100, 100], [400, 100], [250, 330]] as const;
    for (let c = 0; c < 3; c++) {
      const a = corners[c] as readonly [number, number];
      const b = corners[(c + 1) % 3] as readonly [number, number];
      for (let i = 0; i < 66; i++) polygon.push(a[0] + ((b[0] - a[0]) * i) / 66 + Math.sin(i + c), a[1] + ((b[1] - a[1]) * i) / 66);
    }
    const scribble: number[] = [];
    for (let i = 0; i < 200; i++) scribble.push(300 + (8 + i * 0.6) * Math.cos(i * 0.22), 300 + (8 + i * 0.6) * Math.sin(i * 0.22));
    const line: number[] = [];
    for (let i = 0; i < 200; i++) line.push(i * 2, Math.sin(i) * 2);
    const cases: readonly (readonly [string, number[], string | undefined])[] = [
      ['ellipse', circle, 'ellipse'],
      ['polygon', polygon, 'polygon'],
      ['no match (spiral)', scribble, undefined],
      ['line', line, 'line'],
    ];
    let worst = 0;
    for (const [name, xy, want] of cases) {
      expect(recogniseStroke(xy)?.kind, name).toBe(want);
      const ms = best(() => {
        recogniseStroke(xy);
      }, 50, 10);
      worst = Math.max(worst, ms);
      report(`recognise a 200-point stroke: ${name}`, ms, 'ms', 1);
    }
    expect(worst).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// round 6: the rows of design 13 on real boards (strokes, rects, text), up to the first picture the core can make

/** A board of `count` shapes on its current page: 14 in 20 are strokes of 16 points, the rest rects, ellipses, text and sticky notes. */
function putMixed(core: BoardCore, count: number): void {
  const page = core.pages.current as string;
  const idx = must(keysBetween(null, null, count));
  must(
    core.store.change(
      'host',
      (tx) => {
        for (let i = 0; i < count; i++) {
          const slot = i % 20;
          const base = { id: tx.newId('shape'), page, x: (i % 100) * 60, y: Math.floor(i / 100) * 50, rotation: 0, parent: null, index: idx[i] as string, locked: false, opacity: 1, meta: {} };
          if (slot < 14) {
            const pts = new Float32Array(48);
            for (let k = 0; k < 16; k++) {
              pts[k * 3] = k * 2.5;
              pts[k * 3 + 1] = 12 * Math.sin(k / 3 + i) + 15;
              pts[k * 3 + 2] = 0.3 + 0.6 * ((k % 7) / 7);
            }
            must(tx.put({ ...base, kind: 'ink', props: { points: pts, stride: 3, nib: 'pen', size: 3, color: '#1f2430', opacity: 1 } }));
          } else if (slot < 18) {
            must(tx.put({ ...base, kind: slot < 16 ? 'rect' : 'ellipse', props: { w: 40, h: 30, fill: '#ffe08a', stroke: '#1f2430', dash: 'solid', size: 3, label: '', font: 'sans' } }));
          } else if (slot === 18) {
            must(tx.put({ ...base, kind: 'text', props: { text: 'x = 2', size: 18 } }));
          } else {
            must(tx.put({ ...base, kind: 'sticky', props: { text: 'note' } }));
          }
        }
      },
      { history: false },
    ),
  );
}

/** What the first picture needs from the core: the camera's tiles, and the draw list of each (outlines and parts built cold). */
function firstPicture(core: BoardCore, cache: TileCache, list: Tile[], W: number, H: number): number {
  const camera = core.camera as NonNullable<BoardCore['camera']>;
  cache.beginFrame();
  cache.visible(camera, W, H, 1, list);
  let items = 0;
  for (const tile of list) {
    const scale = Math.pow(2, tile.k);
    const box = tileBox(tile.k, tile.tx, tile.ty);
    const grow = 2 / scale;
    items += core.drawList.itemsIn({ minX: box.minX - grow, minY: box.minY - grow, maxX: box.maxX + grow, maxY: box.maxY + grow }, scale).length;
  }
  return items;
}

describe('board on real shapes, design 13 (round 6)', () => {
  it('opens a 1,000-shape board of strokes, shapes and text to its first picture in under 200 ms (load, index, draw lists of the tiles in view)', () => {
    const { core: source } = makeRig();
    putMixed(source, 1000);
    const text = must(saveBoard(source.store));
    let items = 0;
    const ms = best(() => {
      const loaded = must(loadBoard(text, { kinds: new KindRegistry() }));
      const core = must(BoardCore.create({ store: loaded.store }));
      core.camera?.moveTo(0, 0, 1, 0);
      core.index.refresh();
      items = firstPicture(core, new TileCache(), [], 1280, 800);
      core.dispose();
    }, 10, 2);
    reportRow('open a 1,000-shape board to its first picture', ms, 'ms', 200);
    expect(items).toBeGreaterThan(100);
    expect(ms).toBeLessThan(200);
  });

  it('switches to a page of 2,000 shapes of strokes, shapes and text in under 100 ms (page, index, draw lists of the tiles in view, nothing cached)', () => {
    const { core: source } = makeRig();
    putMixed(source, 100);
    const second = must(source.pages.addPage()).id;
    must(source.pages.goToPage(second));
    putMixed(source, 2000);
    must(source.pages.goToPage(source.pages.list()[0]?.id as string));
    const text = must(saveBoard(source.store));
    let items = 0;
    let fastest = Number.POSITIVE_INFINITY;
    for (let run = 0; run < 12; run++) {
      // a board just opened on its first page: the switch is timed, the load is not
      const loaded = must(loadBoard(text, { kinds: new KindRegistry() }));
      const core = must(BoardCore.create({ store: loaded.store }));
      core.index.refresh();
      const target = core.pages.list()[1]?.id as string;
      const t0 = performance.now();
      must(core.pages.goToPage(target));
      core.camera?.moveTo(0, 0, 1, 0);
      core.index.refresh();
      items = firstPicture(core, new TileCache(), [], 1280, 800);
      const ms = performance.now() - t0;
      if (run >= 2) fastest = Math.min(fastest, ms);
      core.dispose();
    }
    reportRow('switch to a page of 2,000 shapes, first picture', fastest, 'ms', 100);
    expect(items).toBeGreaterThan(100);
    expect(fastest).toBeLessThan(100);
  });
});
