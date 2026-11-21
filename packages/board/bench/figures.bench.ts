// @vitest-environment happy-dom
/**
 * Figure-card benchmarks (round 4; docs/features/board/design.md 8 and 13, docs/design/performance.md 4).
 *
 * Rows:
 * - a frame with 3 live cards and 2,000 strokes while panning: the core's work for the frame (camera, tiles in view, draw lists,
 *   culling: what `board-view` does before it calls the painter) plus the card layer's `sync` (motion, slot placement, scheduler
 *   sets). Target: frame under 8 ms (design 13, "Pan and zoom ... 60 fps; frame under 8 ms").
 * - the same layer with the camera still: `sync` on a settled board costs nothing but a comparison of the camera.
 * - scheduler work for 50 cards: one `SchedulerHost` tick with 50 registered cards (8 in view, 14 near) while the camera moves,
 *   and the layer's `sync` for 50 figure shapes while the camera pans over them. Target: well inside the frame (performance.md:
 *   "A document with 50 figures scrolls at 60 fps"), so the scheduler tick is held under 0.5 ms and the layer's frame under 4 ms.
 *
 * The cards mount real apps (`createApp` of the SDK, in happy-dom), at most 3 under the layer's scheduler. happy-dom has no layout
 * or paint, so these rows measure the board's own code and its DOM writes, not the browser's raster time; the Chrome rows with the
 * CPU 4x slower are measured in the browser. Reference engines (Box2D v3, Rapier, Jolt) are physics engines with no cards,
 * panning or scheduler, so there is no like-for-like number for these rows; they are measured against the design's budgets only.
 *
 * Run: `npx vitest run --config packages/board/bench/vitest.config.ts`.
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULER_CONFIG, SchedulerHost } from '@incantly/view';
import { BoardCore, FigureLayer, Strings, TileCache, addFigure, keysBetween, tileBox } from '../src/index';
import type { BoardResult, Tile } from '../src/index';

const W = 1280;
const H = 800;
const DPR = 1;

const must = <T>(r: BoardResult<T>): T => {
  if (!r.ok) throw new Error(`${r.kind}: ${r.message}`);
  return r.value;
};

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

const stats = (times: Float64Array): { mean: number; p95: number; max: number } => {
  const sorted = Float64Array.from(times).sort();
  let sum = 0;
  for (const t of times) sum += t;
  return { mean: sum / times.length, p95: sorted[Math.floor(sorted.length * 0.95)] as number, max: sorted[sorted.length - 1] as number };
};

const reportRow = (name: string, value: number, unit: string, target: number, extra = ''): void => {
  process.stdout.write(`${value <= target ? 'ok  ' : 'MISS'}  ${name.padEnd(62)} ${value.toFixed(4).padStart(10)} ${unit}   target ${target} ${unit}${extra}\n`);
};

const info = (name: string, value: string): void => {
  process.stdout.write(`info  ${name.padEnd(62)} ${value}\n`);
};

function makeCore(): BoardCore {
  const made = BoardCore.create({});
  if (!made.ok) throw new Error(made.message);
  return made.value;
}

/** Ink strokes of `points` points each in a grid (60 units apart, 100 columns), put in one transaction without history. */
function putStrokes(core: BoardCore, count: number, points: number): void {
  const page = core.pages.current as string;
  const idx = must(keysBetween(null, null, count));
  must(
    core.store.change(
      'host',
      (tx) => {
        for (let i = 0; i < count; i++) {
          const pts = new Float32Array(points * 3);
          for (let k = 0; k < points; k++) {
            pts[k * 3] = (k * 40) / points;
            pts[k * 3 + 1] = 12 * Math.sin(k / 3) + 15;
            pts[k * 3 + 2] = 0.3 + 0.6 * ((k % 7) / 7);
          }
          must(
            tx.put({
              id: `shape:i${i}`, page, kind: 'ink', x: (i % 100) * 60, y: Math.floor(i / 100) * 50, rotation: 0, parent: null, index: idx[i] as string, locked: false, opacity: 1,
              props: { points: pts, stride: 3, nib: 'pen', size: 3, color: '#1f2430', opacity: 1 }, meta: {},
            }),
          );
        }
      },
      { history: false },
    ),
  );
}

/** What the web view's frame does before the painter is called: the camera, the tiles in view, the draw list of each tile that needs it, culling. */
function coreFrame(core: BoardCore, cache: TileCache, list: Tile[], ids: string[], now: number): void {
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
  ids.length = 0;
  core.drawList.cull(camera.visibleBounds(W, H, 256), 0, ids);
}

function makeLayer(core: BoardCore, host: HTMLElement): FigureLayer {
  const layer = new FigureLayer({
    core,
    doc: document,
    bars: host,
    strings: new Strings(),
    readOnly: false,
    onError: () => undefined,
    requestFrame: () => undefined,
    focusBoard: () => undefined,
  });
  host.append(layer.element);
  return layer;
}

/** Syncs the layer, with real waits between, until `want` cards hold an app (or the time is up). */
async function waitLive(core: BoardCore, layer: FigureLayer, want: number): Promise<void> {
  const camera = core.camera as NonNullable<BoardCore['camera']>;
  for (let i = 0; i < 120 && layer.liveCount < want; i++) {
    layer.sync(camera, W, H, performance.now());
    await sleep(50);
  }
  // let each app paint once and the scheduler settle
  for (let i = 0; i < 10; i++) {
    layer.sync(camera, W, H, performance.now());
    await sleep(30);
  }
}

describe('board figure cards, design 13 (round 4)', () => {
  it('a frame with 3 live cards and 2,000 strokes while panning is under 8 ms (core work plus the card layer)', async () => {
    const core = makeCore();
    putStrokes(core, 2000, 16);
    const camera = core.camera as NonNullable<BoardCore['camera']>;
    camera.moveTo(0, 0, 1, 0);
    for (const [x, y] of [[300, 200], [760, 220], [520, 520]] as const) must(addFigure(core, { at: { x, y }, script: '# incantly 1\na = 1\nb = a + 1' }));
    const host = document.createElement('div');
    document.body.append(host);
    const layer = makeLayer(core, host);
    await waitLive(core, layer, 3);
    expect(layer.liveCount).toBe(3);
    expect(core.store.shapeCount(core.pages.current as string)).toBe(2003);

    const cache = new TileCache();
    const list: Tile[] = [];
    const ids: string[] = [];
    const FRAMES = 300;
    const base = performance.now();
    const run = (): { core: Float64Array; layer: Float64Array; both: Float64Array } => {
      const coreTimes = new Float64Array(FRAMES);
      const layerTimes = new Float64Array(FRAMES);
      const bothTimes = new Float64Array(FRAMES);
      camera.moveTo(0, 0, 1, base);
      for (let f = 0; f < FRAMES; f++) {
        // a pan that goes back and forth over 240 units, so the cards stay in view while the camera is always moving
        camera.moveTo(120 * Math.sin(f / 9) + 120, 40 * Math.sin(f / 13), 1, base + f * 16);
        const now = base + f * 16;
        const t0 = performance.now();
        coreFrame(core, cache, list, ids, now);
        const t1 = performance.now();
        layer.sync(camera, W, H, now);
        const t2 = performance.now();
        coreTimes[f] = t1 - t0;
        layerTimes[f] = t2 - t1;
        bothTimes[f] = t2 - t0;
      }
      return { core: coreTimes, layer: layerTimes, both: bothTimes };
    };
    run(); // warm
    const t = run();
    const c = stats(t.core);
    const l = stats(t.layer);
    const b = stats(t.both);
    reportRow('pan, 2,000 strokes + 3 live cards: core frame, mean', c.mean, 'ms', 8, `   p95 ${c.p95.toFixed(3)}  max ${c.max.toFixed(3)}`);
    reportRow('pan, 2,000 strokes + 3 live cards: card layer sync, mean', l.mean, 'ms', 4, `   p95 ${l.p95.toFixed(3)}  max ${l.max.toFixed(3)}`);
    reportRow('pan, 2,000 strokes + 3 live cards: whole frame, mean', b.mean, 'ms', 8, `   p95 ${b.p95.toFixed(3)}  max ${b.max.toFixed(3)}`);
    info('cards while panning', `${[...layer.cards.values()].map((card) => card.life.state).join(', ')}`);
    // the pan went on for 300 frames with no pause of 150 ms, so the cards were hidden behind their pictures the whole time
    expect(layer.motion.state).toBe('moving');
    expect(layer.liveCount).toBe(3);
    expect(b.p95).toBeLessThan(8);
    expect(l.p95).toBeLessThan(4);
    layer.dispose();
    host.remove();
  }, 120_000);

  it('with the camera still, the card layer\'s frame is a comparison of the camera and costs under 0.5 ms for 3 live cards', async () => {
    const core = makeCore();
    putStrokes(core, 2000, 16);
    const camera = core.camera as NonNullable<BoardCore['camera']>;
    camera.moveTo(0, 0, 1, 0);
    for (const [x, y] of [[300, 200], [760, 220], [520, 520]] as const) must(addFigure(core, { at: { x, y }, script: '# incantly 1\na = 1' }));
    const host = document.createElement('div');
    document.body.append(host);
    const layer = makeLayer(core, host);
    await waitLive(core, layer, 3);
    await sleep(400);
    layer.sync(camera, W, H, performance.now());
    expect(layer.motion.state).toBe('still');
    const FRAMES = 500;
    const times = new Float64Array(FRAMES);
    const t0 = performance.now();
    for (let f = 0; f < FRAMES; f++) {
      const a = performance.now();
      layer.sync(camera, W, H, t0 + f * 16);
      times[f] = performance.now() - a;
    }
    const s = stats(times);
    reportRow('still camera, 3 live cards: layer sync, mean', s.mean, 'ms', 0.5, `   p95 ${s.p95.toFixed(4)}  max ${s.max.toFixed(3)}`);
    expect(s.p95).toBeLessThan(0.5);
    expect(layer.liveCount).toBe(3);
    layer.dispose();
    host.remove();
  }, 120_000);

  describe('scheduler work for 50 cards', () => {
    it('one scheduler tick with 50 cards registered, 8 in view and 14 near, while the camera moves, is under 0.5 ms', () => {
      let orders = 0;
      const scheduler = new SchedulerHost({ ...DEFAULT_SCHEDULER_CONFIG, maxLive: 3 }, { onAction: () => void orders++ });
      const all = Array.from({ length: 50 }, (_, i) => `shape:${i}`);
      for (const id of all) scheduler.register(id);
      const ROUNDS = 2000;
      const times = new Float64Array(ROUNDS);
      for (let r = 0; r < ROUNDS; r++) {
        const at = r % 40;
        const visible = new Set(all.slice(at, at + 8));
        const near = new Set(all.slice(Math.max(0, at - 3), at + 11));
        const a = performance.now();
        scheduler.setVisible(visible);
        scheduler.setNear(near);
        scheduler.noteScroll();
        scheduler.tick();
        times[r] = performance.now() - a;
      }
      scheduler.stop();
      const s = stats(times);
      reportRow('scheduler: set sets, note scroll and tick, 50 cards, mean', s.mean, 'ms', 0.5, `   p95 ${s.p95.toFixed(4)}  max ${s.max.toFixed(3)}  orders ${orders}`);
      expect(s.p95).toBeLessThan(0.5);
      expect(scheduler.state.figures.size).toBe(50);
    });

    it('the tick holds the cap: with 50 cards in view at once, no more than 3 are ordered live', () => {
      const live = new Set<string>();
      const scheduler = new SchedulerHost({ ...DEFAULT_SCHEDULER_CONFIG, maxLive: 3 }, {
        onAction: (a) => {
          if (a.k === 'goLive' || a.k === 'restore') live.add(a.id);
          else if (a.k === 'pause' || a.k === 'save') live.delete(a.id);
        },
      });
      const all = Array.from({ length: 50 }, (_, i) => `shape:${i}`);
      for (const id of all) scheduler.register(id);
      scheduler.setVisible(new Set(all));
      scheduler.setNear(new Set(all));
      for (let r = 0; r < 50; r++) scheduler.tick();
      scheduler.stop();
      expect(live.size).toBeLessThanOrEqual(3);
    });

    it('the card layer\'s frame for 50 figure shapes while the camera pans over them is under 4 ms', async () => {
      const core = makeCore();
      const camera = core.camera as NonNullable<BoardCore['camera']>;
      camera.moveTo(0, 0, 1, 0);
      for (let i = 0; i < 50; i++) must(addFigure(core, { at: { x: 250 + (i % 10) * 400, y: 200 + Math.floor(i / 10) * 300 }, script: '# incantly 1\na = 1' }));
      const host = document.createElement('div');
      document.body.append(host);
      const layer = makeLayer(core, host);
      layer.sync(camera, W, H, performance.now());
      expect(layer.cards.size).toBe(50);
      await waitLive(core, layer, 3);
      const FRAMES = 400;
      const times = new Float64Array(FRAMES);
      const base = performance.now();
      let most = 0;
      for (let f = 0; f < FRAMES; f++) {
        camera.moveTo(f * 9, f * 2, 1, base + f * 16);
        const a = performance.now();
        layer.sync(camera, W, H, base + f * 16);
        times[f] = performance.now() - a;
        most = Math.max(most, layer.liveCount);
      }
      const s = stats(times);
      reportRow('card layer sync, 50 figure shapes, panning, mean', s.mean, 'ms', 4, `   p95 ${s.p95.toFixed(3)}  max ${s.max.toFixed(3)}  most live ${most}`);
      expect(s.p95).toBeLessThan(4);
      layer.dispose();
      host.remove();
    }, 120_000);

    it('the card layer never has more than 3 cards mounting, live or moving while the camera pans over 50 figure shapes (B26 invariant)', async () => {
      const core = makeCore();
      const camera = core.camera as NonNullable<BoardCore['camera']>;
      camera.moveTo(0, 0, 1, 0);
      for (let i = 0; i < 50; i++) must(addFigure(core, { at: { x: 250 + (i % 10) * 400, y: 200 + Math.floor(i / 10) * 300 }, script: '# incantly 1\na = 1' }));
      const host = document.createElement('div');
      document.body.append(host);
      const layer = makeLayer(core, host);
      layer.sync(camera, W, H, performance.now());
      await waitLive(core, layer, 3);
      const base = performance.now();
      let most = 0;
      for (let f = 0; f < 400; f++) {
        camera.moveTo(f * 9, f * 2, 1, base + f * 16);
        layer.sync(camera, W, H, base + f * 16);
        most = Math.max(most, layer.liveCount);
      }
      reportRow('most cards mounting, live or moving at one frame, 50 cards panning', most, 'cards', 3);
      expect(most).toBeLessThanOrEqual(3);
      layer.dispose();
      host.remove();
    }, 120_000);
  });
});
