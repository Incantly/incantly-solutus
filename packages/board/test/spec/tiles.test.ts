/**
 * Culling, tiles and the painter (docs/features/board/design.md 3, 6.3, 9; errors.md `render_failed`; requirements R3.3,
 * R4.4; state-machines B14 to B17): only the shapes of the viewport are drawn, only the tiles a changed shape touches are
 * redrawn, tiles live in a least-recently-used cache with a memory cap, Canvas 2D takes over when WebGL 2 is not there,
 * and the live layer grows one stroke without redrawing it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TILE_BYTES, TILE_CAP_BYTES, TILE_CAP_BYTES_LOW, TILE_PX, Tile, TileCache, WebPainter, diffRegions, lodOf, shapeBounds, stepOf, tileBox, tileId, tileSpan,
} from '../../src/index';
import type { BoardError, Bounds, ShapeRecord } from '../../src/index';
import { drawPath, installCanvas2d, line, makeRig, sample, strokes } from './ink-helpers';
import type { FakeCanvas } from './ink-helpers';

const camera = (x = 0, y = 0, zoom = 1): { x: number; y: number; zoom: number; steadyZoom: number } => ({ x, y, zoom, steadyZoom: zoom });

describe('tile geometry (design 9 item 4)', () => {
  it('a tile is 512 device pixels; at step k it covers 512 / 2^k page units', () => {
    expect(TILE_PX).toBe(512);
    expect(tileSpan(0)).toBe(512);
    expect(tileSpan(1)).toBe(256);
    expect(tileSpan(-2)).toBe(2048);
    expect(tileBox(1, 2, 3)).toEqual({ minX: 512, minY: 768, maxX: 768, maxY: 1024 });
  });

  it('tiles are drawn at power-of-two zoom steps, never more than half a step too coarse', () => {
    expect(Math.abs(stepOf(1, 1))).toBe(0);
    expect(stepOf(2, 1)).toBe(1);
    expect(stepOf(1, 2)).toBe(1);
    expect(stepOf(0.5, 1)).toBe(-1);
    for (const zoom of [0.05, 0.13, 0.4, 0.9, 1, 1.6, 3.3, 7, 20]) {
      const k = stepOf(zoom, 1);
      const ratio = Math.pow(2, k) / zoom;
      expect(ratio).toBeGreaterThanOrEqual(0.9);
      expect(ratio).toBeLessThan(2);
    }
  });

  it('a tile id is unique to its step, column and row', () => {
    const ids = new Set<number>();
    for (const k of [-3, 0, 2]) for (const tx of [-5, 0, 7]) for (const ty of [-2, 0, 9]) ids.add(tileId(k, tx, ty));
    expect(ids.size).toBe(27);
  });

  it('the memory cap is 64 MB by default and 24 MB on a device with 4 GB or less', () => {
    expect(TILE_CAP_BYTES).toBe(64 * 1024 * 1024);
    expect(TILE_CAP_BYTES_LOW).toBe(24 * 1024 * 1024);
    expect(new TileCache().capBytes).toBe(TILE_CAP_BYTES);
  });
});

describe('the tile cache (design 9, B14)', () => {
  it('visible() gives the tiles that cover the screen, made blank, each once', () => {
    const cache = new TileCache();
    cache.beginFrame();
    const out: Tile[] = [];
    const n = cache.visible(camera(), 1000, 700, 1, out);
    expect(n).toBe(out.length);
    expect(new Set(out.map((t) => t.id)).size).toBe(n);
    expect(out.every((t) => t.state === 'blank' && t.k === 0)).toBe(true);
    // the union of the tile boxes holds the whole screen
    expect(Math.min(...out.map((t) => t.box.minX))).toBeLessThanOrEqual(0);
    expect(Math.min(...out.map((t) => t.box.minY))).toBeLessThanOrEqual(0);
    expect(Math.max(...out.map((t) => t.box.maxX))).toBeGreaterThanOrEqual(1000);
    expect(Math.max(...out.map((t) => t.box.maxY))).toBeGreaterThanOrEqual(700);
    // and no tile is far outside it
    expect(out.every((t) => t.box.minX <= 1000 && t.box.minY <= 700)).toBe(true);
  });

  it('a screen with nothing in it asks for no tiles', () => {
    const cache = new TileCache();
    expect(cache.visible(camera(), 0, 700, 1, [])).toBe(0);
  });

  it('panning draws tiles: a drawn tile is reused when it is still on screen', () => {
    const cache = new TileCache();
    cache.beginFrame();
    const out: Tile[] = [];
    cache.visible(camera(), 1000, 700, 1, out);
    for (const t of out) cache.markDrawn(t);
    const first = new Map(out.map((t) => [t.id, t]));
    cache.beginFrame();
    cache.visible(camera(300, 0), 1000, 700, 1, out);
    const reused = out.filter((t) => first.get(t.id) === t);
    expect(reused.length).toBeGreaterThan(0);
    expect(reused.every((t) => t.state === 'fresh')).toBe(true);
    expect(out.some((t) => t.state === 'blank')).toBe(true);
  });

  it('drawing a tile counts its bytes; a tile in a state with no row is refused (draw in fresh, dirty in blank)', () => {
    const cache = new TileCache();
    const t = new Tile(0, 0, 0);
    expect(t.dirty()).toBe(false);
    expect(t.state).toBe('blank');
    cache.beginFrame();
    const out: Tile[] = [];
    cache.visible(camera(), 100, 100, 1, out);
    const tile = out[0] as Tile;
    cache.markDrawn(tile);
    expect(cache.bytes).toBe(TILE_BYTES);
    expect(tile.state).toBe('fresh');
    expect(tile.drawn()).toBe(false);
    cache.markDrawn(tile);
    expect(cache.bytes).toBe(TILE_BYTES);
  });

  it('a changed shape marks only the tiles it touches, and no others', () => {
    const rig = makeRig();
    const cache = new TileCache();
    cache.beginFrame();
    const out: Tile[] = [];
    cache.visible(camera(), 1500, 1100, 1, out);
    for (const t of out) cache.markDrawn(t);
    const total = out.length;
    expect(total).toBeGreaterThanOrEqual(6);
    // a stroke well inside tile (1, 0): x 560..660, y 60..120
    const marked: Bounds[] = [];
    rig.core.store.on((diff) => {
      for (const r of diffRegions(diff, rig.core.pages.current as string)) {
        marked.push(r);
        cache.invalidate(r);
      }
    });
    drawPath(rig, line(560, 60, 660, 120, 10));
    expect(marked).toHaveLength(1);
    const stale = out.filter((t) => t.state === 'stale');
    expect(stale.map((t) => [t.tx, t.ty])).toEqual([[1, 0]]);
    expect(out.filter((t) => t.state === 'fresh')).toHaveLength(total - 1);
  });

  it('a shape across a tile border marks the tiles on both sides', () => {
    const rig = makeRig();
    const cache = new TileCache();
    cache.beginFrame();
    const out: Tile[] = [];
    cache.visible(camera(), 1500, 1100, 1, out);
    for (const t of out) cache.markDrawn(t);
    rig.core.store.on((diff) => {
      for (const r of diffRegions(diff, rig.core.pages.current as string)) cache.invalidate(r);
    });
    drawPath(rig, line(480, 60, 560, 60, 8));
    expect(out.filter((t) => t.state === 'stale').map((t) => [t.tx, t.ty]).sort()).toEqual([[0, 0], [1, 0]]);
  });

  it('it marks the tiles of every zoom step the shape meets', () => {
    const cache = new TileCache();
    const out: Tile[] = [];
    cache.beginFrame();
    cache.visible(camera(0, 0, 1), 1000, 800, 1, out);
    const atOne = [...out];
    for (const t of atOne) cache.markDrawn(t);
    cache.beginFrame();
    cache.visible(camera(0, 0, 2), 1000, 800, 1, out);
    const atTwo = [...out];
    for (const t of atTwo) cache.markDrawn(t);
    expect(atOne[0]?.k).not.toBe(atTwo[0]?.k);
    const marked = cache.invalidate({ minX: 10, minY: 10, maxX: 30, maxY: 30 });
    expect(marked).toBe(2);
  });

  it('a removed stroke and a moved stroke mark where they were and where they are', () => {
    const rig = makeRig();
    drawPath(rig, line(60, 60, 120, 60, 6));
    const s = strokes(rig)[0] as ShapeRecord;
    const regions: Bounds[][] = [];
    rig.core.store.on((d) => regions.push(diffRegions(d, rig.core.pages.current as string)));
    rig.core.store.change('user', (tx) => {
      tx.update(s.id, { x: s.x + 1000 });
    });
    expect(regions[0]).toHaveLength(2);
    expect(regions[0]?.some((b) => b.minX < 500)).toBe(true);
    expect(regions[0]?.some((b) => b.minX > 900)).toBe(true);
    rig.core.store.change('user', (tx) => {
      tx.remove(s.id);
    });
    expect(regions[1]).toHaveLength(1);
  });

  it('diffRegions ignores shapes of another page', () => {
    const rig = makeRig();
    drawPath(rig, line(0, 0, 50, 0));
    const regions: Bounds[][] = [];
    rig.core.store.on((d) => regions.push(diffRegions(d, 'page:somewhere-else')));
    drawPath(rig, line(0, 40, 50, 40), {}, 1000);
    expect(regions[0]).toEqual([]);
  });

  describe('least recently used, with a memory cap', () => {
    const frameOf = (cache: TileCache, x: number, w = 500): Tile[] => {
      cache.beginFrame();
      const out: Tile[] = [];
      cache.visible(camera(x, 0), w, 100, 1, out);
      for (const t of out) cache.markDrawn(t);
      return [...out];
    };

    it('the oldest tiles go first when the bytes pass the cap, and the painter is told', () => {
      const released: number[] = [];
      const cache = new TileCache({ capBytes: 3 * TILE_BYTES, release: (t) => released.push(t.id) });
      const a = frameOf(cache, 0, 100);
      const b = frameOf(cache, 512, 100);
      const c = frameOf(cache, 1024, 100);
      expect(cache.size).toBe(3);
      expect(cache.bytes).toBe(3 * TILE_BYTES);
      const d = frameOf(cache, 1536, 100);
      expect(cache.bytes).toBeLessThanOrEqual(3 * TILE_BYTES);
      expect(cache.get(0, 0, 0)).toBeUndefined();
      expect(released).toContain((a[0] as Tile).id);
      expect(cache.get(0, 1, 0)).toBe(b[0]);
      expect(cache.get(0, 2, 0)).toBe(c[0]);
      expect(cache.get(0, 3, 0)).toBe(d[0]);
      expect(a[0]?.state).toBe('gone');
    });

    it('a tile that was used again is newer than one that was not', () => {
      const cache = new TileCache({ capBytes: 3 * TILE_BYTES });
      const a = frameOf(cache, 0, 100);
      frameOf(cache, 512, 100);
      frameOf(cache, 1024, 100);
      frameOf(cache, 0, 100); // a is used again: now the newest
      frameOf(cache, 1536, 100);
      expect(cache.get(0, 0, 0)).toBe(a[0]);
      expect(cache.get(0, 1, 0)).toBeUndefined();
    });

    it('a tile that the current frame uses is never evicted, even over the cap', () => {
      const cache = new TileCache({ capBytes: 2 * TILE_BYTES });
      const wide = frameOf(cache, 0, 2300); // five tiles in one frame
      expect(wide.length).toBeGreaterThanOrEqual(5);
      expect(wide.every((t) => t.state === 'fresh')).toBe(true);
      expect(cache.size).toBe(wide.length);
      frameOf(cache, 5000, 100);
      expect(cache.bytes).toBeLessThanOrEqual(2 * TILE_BYTES);
    });

    it('a lost GPU context sends every drawn tile back to blank and frees its picture', () => {
      const released: number[] = [];
      const cache = new TileCache({ release: (t) => released.push(t.id) });
      const tiles = frameOf(cache, 0, 1100);
      cache.lose();
      expect(tiles.every((t) => t.state === 'blank')).toBe(true);
      expect(cache.bytes).toBe(0);
      expect(released.length).toBe(tiles.length);
      // every event but draw has no row in blank
      expect(tiles.every((t) => !t.dirty() && !t.lose())).toBe(true);
    });

    it('a tile that was evicted takes no event', () => {
      const cache = new TileCache({ capBytes: TILE_BYTES });
      const a = frameOf(cache, 0, 100);
      frameOf(cache, 512, 100);
      const gone = a[0] as Tile;
      expect(gone.state).toBe('gone');
      expect([gone.drawn(), gone.dirty(), gone.lose(), gone.evict()]).toEqual([false, false, false, false]);
    });

    it('a blank tile that is out of sight for a frame is forgotten', () => {
      const cache = new TileCache();
      cache.beginFrame();
      cache.visible(camera(), 100, 100, 1, []);
      expect(cache.size).toBe(1);
      cache.beginFrame();
      cache.beginFrame();
      expect(cache.size).toBe(0);
    });

    it('clear() drops every tile and the bytes', () => {
      const cache = new TileCache();
      frameOf(cache, 0, 1100);
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.bytes).toBe(0);
    });
  });
});

describe('culling and level of detail (design 9 items 2, 3, 6)', () => {
  it('only the strokes that meet the viewport are drawn; a margin brings in the ones just outside', () => {
    const rig = makeRig();
    drawPath(rig, line(10, 10, 90, 10), {}, 0); // inside
    drawPath(rig, line(1100, 10, 1190, 10), {}, 1000); // 100 units to the right
    drawPath(rig, line(3000, 10, 3090, 10), {}, 2000); // far
    const view: Bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 700 };
    expect(rig.core.drawList.cull(view)).toHaveLength(1);
    expect(rig.core.drawList.cull(view, 256)).toHaveLength(2);
    expect(rig.core.drawList.itemsIn(view, 1)).toHaveLength(1);
  });

  it('what is drawn is in order: the highlighter layer first, then by the index key of the shape', () => {
    const rig = makeRig();
    drawPath(rig, line(0, 0, 80, 0), {}, 0);
    drawPath(rig, line(0, 10, 80, 10), {}, 1000);
    drawPath(rig, line(0, 20, 80, 20), {}, 2000);
    const ids = strokes(rig).map((s) => s.id);
    const items = rig.core.drawList.itemsIn({ minX: -10, minY: -10, maxX: 200, maxY: 100 }, 1);
    expect(items.map((i) => i.id)).toEqual(ids);
  });

  it('a stroke under half a pixel on screen is not drawn; a small one is drawn coarser; a large one in full', () => {
    const box = (size: number): Bounds => ({ minX: 0, minY: 0, maxX: size, maxY: size });
    expect(lodOf(box(10), 0.04)).toBe('skip');
    expect(lodOf(box(10), 1)).toBe('coarse');
    expect(lodOf(box(100), 1)).toBe('full');
  });

  it('the draw list skips the strokes that are too small to see at this zoom', () => {
    const rig = makeRig();
    drawPath(rig, line(0, 0, 8, 0, 4));
    const s = strokes(rig)[0] as ShapeRecord;
    expect(shapeBounds(s)).toBeDefined();
    expect(rig.core.drawList.itemOf(s, 0.01)).toBeUndefined();
    expect(rig.core.drawList.itemOf(s, 4)).toBeDefined();
  });

  it('the opacity of the stroke and of the shape both reach the draw item', () => {
    const rig = makeRig({ tool: 'highlighter' });
    drawPath(rig, line(0, 0, 100, 0));
    const [s] = strokes(rig) as readonly [ShapeRecord];
    const item = rig.core.drawList.itemOf(s, 1);
    expect(item?.a).toBeCloseTo((s.props as { opacity: number }).opacity * s.opacity, 6);
    expect(item?.layer).toBe(0);
  });
});

describe('the painter (design 3, 6.3; errors.md render_failed; B15, B16, B17)', () => {
  let fake: FakeCanvas;
  beforeEach(() => {
    fake = installCanvas2d();
  });
  afterEach(() => {
    fake.restore();
  });

  const content = (rig = makeRig()): { rig: ReturnType<typeof makeRig>; tile: Tile; box: Bounds } => {
    drawPath(rig, line(20, 20, 200, 120, 12));
    const cache = new TileCache();
    cache.beginFrame();
    const out: Tile[] = [];
    cache.visible(camera(), 400, 300, 1, out);
    return { rig, tile: out[0] as Tile, box: { minX: -2, minY: -2, maxX: 514, maxY: 514 } };
  };

  it('without WebGL 2 the board falls back to Canvas 2D and says render_failed once', () => {
    const notices: BoardError[] = [];
    const painter = new WebPainter({ onNotice: (e) => notices.push(e) });
    expect(painter.backend).toBe('canvas2d');
    expect(notices).toHaveLength(1);
    expect(notices[0]?.kind).toBe('render_failed');
    expect(painter.element.querySelectorAll('canvas').length).toBe(4);
    painter.dispose();
  });

  it('after the fallback the painter still draws tiles, and counts them', () => {
    const painter = new WebPainter();
    painter.resize(400, 300, 1);
    const { rig, tile, box } = content();
    expect(painter.beginFrame({ x: 0, y: 0, zoom: 1 }, 1).ok).toBe(true);
    const items = rig.core.drawList.itemsIn(box, 1);
    expect(items.length).toBe(1);
    const r = painter.drawTile(tile, { box, items });
    expect(r.ok).toBe(true);
    expect(tile.state).toBe('fresh');
    expect(painter.stats.tilesDrawn).toBe(1);
    expect(painter.stats.backend).toBe('canvas2d');
    expect(painter.endFrame().ok).toBe(true);
    expect((fake.calls.get('fill') ?? 0) > 0).toBe(true);
    painter.dispose();
  });

  it('a tile that is fresh is shown again without being drawn again', () => {
    const painter = new WebPainter();
    painter.resize(400, 300, 1);
    const { rig, tile, box } = content();
    painter.beginFrame({ x: 0, y: 0, zoom: 1 }, 1);
    painter.drawTile(tile, { box, items: rig.core.drawList.itemsIn(box, 1) });
    painter.endFrame();
    const fills = fake.calls.get('fill') ?? 0;
    painter.beginFrame({ x: 5, y: 5, zoom: 1 }, 1);
    expect(painter.drawTile(tile, null).ok).toBe(true);
    painter.endFrame();
    expect(fake.calls.get('fill') ?? 0).toBe(fills);
    expect(painter.stats.tilesDrawn).toBe(1);
    painter.dispose();
  });

  it('draw calls outside a frame are bad_argument and draw nothing (B16)', () => {
    const painter = new WebPainter();
    painter.resize(400, 300, 1);
    const { tile, box } = content();
    const kinds = [
      painter.drawTile(tile, { box, items: [] }),
      painter.drawItems([]),
      painter.drawLiveStroke(null),
      painter.drawOverlay({ laser: null, loop: null, selection: [], cursor: null }),
      painter.endFrame(),
    ].map((r) => (r.ok ? 'ok' : r.kind));
    expect(kinds).toEqual(['bad_argument', 'bad_argument', 'bad_argument', 'bad_argument', 'bad_argument']);
    expect(painter.stats.tilesDrawn).toBe(0);
    painter.dispose();
  });

  it('a second beginFrame before endFrame is refused, and the frame goes on (B16)', () => {
    const painter = new WebPainter();
    painter.resize(400, 300, 1);
    expect(painter.beginFrame({ x: 0, y: 0, zoom: 1 }, 1).ok).toBe(true);
    const again = painter.beginFrame({ x: 0, y: 0, zoom: 1 }, 1);
    expect(again.ok).toBe(false);
    expect(again.ok ? '' : again.kind).toBe('bad_argument');
    expect(painter.endFrame().ok).toBe(true);
    expect(painter.beginFrame({ x: 0, y: 0, zoom: 1 }, 1).ok).toBe(true);
    painter.endFrame();
    painter.dispose();
  });

  it('the live layer asks for a low-latency canvas (design 6.3)', () => {
    const painter = new WebPainter();
    expect(fake.requests.some(([type, attrs]) => type === '2d' && (attrs as { desynchronized?: boolean } | undefined)?.desynchronized === true)).toBe(true);
    painter.dispose();
  });

  describe('the live layer (B17)', () => {
    /** A live stroke of `n` points, in the middle of being drawn, and the view of it. */
    function liveOf(n: number): ReturnType<typeof makeRig> {
      const rig = makeRig();
      rig.host.sample(sample({ x: 0, y: 0, phase: 'down' }));
      for (let i = 1; i < n; i++) rig.host.sample(sample({ x: i * 6, y: Math.sin(i / 4) * 30, phase: 'move', time: i * 8 }));
      rig.core.live.rebuild(1);
      return rig;
    }
    const frame = (painter: WebPainter, view: ReturnType<ReturnType<typeof makeRig>['core']['live']['view']> | null): void => {
      painter.beginFrame({ x: 0, y: 0, zoom: 1 }, 1);
      painter.drawLiveStroke(view);
      painter.endFrame();
    };

    it('goes clear, inking, holding, clear; a stroke that ends is held until its tile is drawn', () => {
      const painter = new WebPainter();
      painter.resize(400, 300, 1);
      const rig = liveOf(30);
      expect(painter.liveState).toBe('clear');
      frame(painter, rig.core.live.view());
      expect(painter.liveState).toBe('inking');
      painter.releaseLive();
      expect(painter.liveState).toBe('holding');
      // ink in holding has no row: the new stroke waits
      frame(painter, rig.core.live.view());
      expect(painter.liveState).toBe('holding');
      painter.settleLive();
      expect(painter.liveState).toBe('clear');
      painter.dispose();
    });

    it('a stroke that is cancelled clears the layer', () => {
      const painter = new WebPainter();
      painter.resize(400, 300, 1);
      frame(painter, liveOf(20).core.live.view());
      expect(painter.liveState).toBe('inking');
      painter.abortLive();
      expect(painter.liveState).toBe('clear');
      painter.dispose();
    });

    it('moves with no row change nothing: release, abort and settle in clear, abort and ink in holding', () => {
      const painter = new WebPainter();
      painter.resize(400, 300, 1);
      painter.releaseLive();
      painter.abortLive();
      painter.settleLive();
      expect(painter.liveState).toBe('clear');
      frame(painter, liveOf(20).core.live.view());
      painter.releaseLive();
      painter.abortLive();
      expect(painter.liveState).toBe('holding');
      painter.dispose();
    });

    it('each frame draws only what the stroke grew by, not the whole stroke again', () => {
      const painter = new WebPainter();
      painter.resize(400, 300, 1);
      const rig = makeRig();
      rig.host.sample(sample({ x: 0, y: 0, phase: 'down' }));
      const grow = (from: number, to: number): void => {
        for (let i = from; i < to; i++) rig.host.sample(sample({ x: i * 4, y: Math.sin(i / 5) * 40 + 100, phase: 'move', time: i * 8 }));
        rig.core.live.rebuild(1);
      };
      grow(1, 80);
      const moves = (): number => fake.calls.get('moveTo') ?? 0;
      let before = moves();
      frame(painter, rig.core.live.view());
      const first = moves() - before;
      expect(first).toBeGreaterThan(50);
      grow(80, 90);
      before = moves();
      frame(painter, rig.core.live.view());
      const second = moves() - before;
      expect(second).toBeGreaterThan(0);
      expect(second).toBeLessThan(first / 3);
      painter.dispose();
    });

    it('with nothing drawn since the last frame the layer draws nothing', () => {
      const painter = new WebPainter();
      painter.resize(400, 300, 1);
      const rig = liveOf(40);
      frame(painter, rig.core.live.view());
      const before = fake.calls.get('moveTo') ?? 0;
      frame(painter, rig.core.live.view());
      expect(fake.calls.get('moveTo') ?? 0).toBe(before);
      painter.dispose();
    });
  });
});
