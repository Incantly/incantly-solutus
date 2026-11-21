/**
 * Round 6: how a tile is drawn and when (docs/features/board/design.md 9 items 4 and 5, 13; handoff/board/bench.md "What was
 * slow, and what was done"; findings BR-35). A tile is drawn in order on the GPU: strokes as triangles, each run of shapes
 * and the page's paper with Canvas 2D on one canvas that is copied to a texture and drawn over what the tile holds so far.
 * Tiles are drawn until a frame has spent 4 ms (at least one, at most 6), a frame that draws no tile and changes no camera
 * composes nothing, and past 48 tiles in a view the step of the zoom as it is now is used. WebGL 2 and Canvas 2D are
 * stand-ins that record their calls (`gl-helpers.ts`), as `installCanvas2d` does for the earlier tile tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tile, TileCache, WebPainter, mountBoardView, stepOf, tileBox } from '../../src/index';
import type { BoardError, BoardView, Bounds, TileContent } from '../../src/index';
import { installCanvas2d, line, drawPath, sample } from './ink-helpers';
import type { FakeCanvas } from './ink-helpers';
import { add, shapeRig } from './shape-helpers';
import { QUAD_INDICES, composeCost, installGpu, tileOrder } from './gl-helpers';
import type { GpuProbe } from './gl-helpers';
import { fakeClock, stubBrowser } from './view-helpers';
import type { Browser, FakeClock } from './view-helpers';

const camera = (x = 0, y = 0, zoom = 1): { x: number; y: number; zoom: number; steadyZoom: number } => ({ x, y, zoom, steadyZoom: zoom });
/** The page box of the tile at column 0, row 0, grown by its gutter, as the view asks for it. */
const BOX: Bounds = { minX: -2, minY: -2, maxX: 514, maxY: 514 };

/** The tiles that cover a screen, made by a cache, in the order the cache gives them. */
function tilesOf(cache: TileCache, w: number, h: number, x = 0): Tile[] {
  cache.beginFrame();
  const out: Tile[] = [];
  cache.visible(camera(x, 0), w, h, 1, out);
  return out;
}

describe('a tile is drawn in order on the GPU (design 9 item 4, BR-35)', () => {
  let probe: GpuProbe;
  let painter: WebPainter;
  let notices: BoardError[];
  beforeEach(() => {
    probe = installGpu();
    notices = [];
    painter = new WebPainter({ onNotice: (e) => notices.push(e) });
    painter.resize(400, 300, 1);
  });
  afterEach(() => {
    painter.dispose();
    probe.restore();
  });

  /** Draws one tile with `content` in a frame of its own and returns what the GPU and the 2D canvas were asked to do. */
  function drawInFrame(tile: Tile, content: TileContent): void {
    probe.clear();
    expect(painter.beginFrame({ x: 0, y: 0, zoom: 1 }, 1).ok).toBe(true);
    const r = painter.drawTile(tile, content);
    expect(r.ok, r.ok ? '' : r.message).toBe(true);
    expect(painter.endFrame().ok).toBe(true);
  }
  const theTile = (): Tile => tilesOf(new TileCache(), 400, 300)[0] as Tile;

  it('with a WebGL 2 context the painter uses the GPU path and tells the host nothing', () => {
    expect(painter.backend).toBe('gl');
    expect(notices).toEqual([]);
    expect(probe.contexts.webgl2).toBeGreaterThan(0);
  });

  it('a tile of strokes only is drawn with GPU triangles: no Canvas 2D call paints it', () => {
    const rig = shapeRig('pen');
    drawPath(rig, line(20, 20, 200, 120, 12), {}, 0);
    drawPath(rig, line(30, 200, 300, 220, 12), {}, 1000);
    const items = rig.core.drawList.itemsIn(BOX, 1);
    expect(items.map((i) => i.k)).toEqual(['ink', 'ink']);
    drawInFrame(theTile(), { box: BOX, items });
    expect(tileOrder(probe)).toEqual(['strokes']);
    expect(probe.log.filter((e) => e.what.startsWith('2d:'))).toEqual([]);
  });

  it('BR-73: a rect, an ellipse and a sticky note are triangles in the same draw call as the strokes: the paper is the only layer, and no Canvas 2D call paints a shape', () => {
    const rig = shapeRig('pen');
    drawPath(rig, line(20, 20, 200, 120, 12), {}, 0);
    add(rig, 'rect', 220, 40, { w: 120, h: 80 });
    add(rig, 'ellipse', 60, 200, { w: 100, h: 60 });
    drawPath(rig, line(30, 300, 300, 320, 12), {}, 1000);
    const items = rig.core.drawList.itemsIn(BOX, 1);
    expect(items.map((i) => i.k)).toEqual(['ink', 'shape', 'shape', 'ink']);
    drawInFrame(theTile(), { box: BOX, items, background: 'grid' });
    expect(tileOrder(probe)).toEqual(['layer', 'strokes']);
    const shapeCalls = probe.log.filter((e) => e.what === '2d:fill' || e.what === '2d:stroke');
    expect(shapeCalls).toEqual([]);
    expect(probe.log.filter((e) => e.what === 'gl:draw' && (e.count ?? 0) > QUAD_INDICES && e.into === 'target')).toHaveLength(1);
  });

  it('BR-73: a picture between two strokes splits the triangles in two draw calls, and a rect beside it does not', () => {
    const rig = shapeRig('pen');
    drawPath(rig, line(20, 20, 200, 120, 12), {}, 0);
    add(rig, 'rect', 220, 40, { w: 120, h: 80 });
    add(rig, 'image', 40, 200, { asset: 'asset:a', w: 120, h: 80 });
    drawPath(rig, line(30, 300, 300, 320, 12), {}, 1000);
    drawInFrame(theTile(), { box: BOX, items: rig.core.drawList.itemsIn(BOX, 1) });
    expect(tileOrder(probe)).toEqual(['strokes', 'layer', 'strokes']);
  });

  it('BR-73: text is quads from the glyph atlas in the same draw call as the strokes: no layer, one atlas copy for each distinct piece of text', () => {
    const rig = shapeRig('pen');
    drawPath(rig, line(20, 20, 200, 120, 12), {}, 0);
    add(rig, 'text', 220, 40, { text: 'Area' });
    add(rig, 'text', 220, 140, { text: 'Area' });
    add(rig, 'sticky', 40, 200, { text: 'note' });
    drawPath(rig, line(30, 300, 300, 320, 12), {}, 1000);
    const items = rig.core.drawList.itemsIn(BOX, 1);
    expect(items.filter((i) => i.k === 'shape')).toHaveLength(3);
    drawInFrame(theTile(), { box: BOX, items });
    expect(tileOrder(probe)).toEqual(['strokes']);
    expect(probe.log.filter((e) => e.what === '2d:fillText')).toHaveLength(2);
    expect(probe.log.filter((e) => e.what === 'gl:draw' && (e.count ?? 0) > QUAD_INDICES && e.into === 'target')).toHaveLength(1);
  });

  it('a tile with strokes, a picture and the paper draws them in page order: paper, stroke, shape, stroke', () => {
    const rig = shapeRig('pen');
    drawPath(rig, line(20, 20, 200, 120, 12), {}, 0);
    add(rig, 'image', 220, 40, { asset: 'asset:a', w: 120, h: 80 });
    drawPath(rig, line(30, 200, 300, 220, 12), {}, 1000);
    const items = rig.core.drawList.itemsIn(BOX, 1);
    expect(items.map((i) => i.k)).toEqual(['ink', 'shape', 'ink']);
    drawInFrame(theTile(), { box: BOX, items, background: 'grid' });
    expect(tileOrder(probe)).toEqual(['layer', 'strokes', 'layer', 'strokes']);
  });

  it('the paper is one layer of lines and a picture is another: the picture\'s layer holds no paper lines', () => {
    const rig = shapeRig('pen');
    drawPath(rig, line(20, 20, 200, 120, 12), {}, 0);
    add(rig, 'image', 220, 40, { asset: 'asset:a', w: 120, h: 80 });
    drawInFrame(theTile(), { box: BOX, items: rig.core.drawList.itemsIn(BOX, 1), background: 'grid' });
    const layers: string[][] = [[]];
    for (const e of probe.log) {
      if (e.what === 'gl:upload') layers.push([]);
      else if (e.what.startsWith('2d:')) (layers[layers.length - 1] as string[]).push(e.what);
    }
    // two uploads: paper, then the picture; whatever 2D painted after the second upload does not exist
    expect(layers).toHaveLength(3);
    expect(layers[0]).toContain('2d:fillRect');
    expect(layers[1]?.filter((w) => w === '2d:fillRect')).toHaveLength(1); // the grey box of a picture, no paper lines
    expect(layers[1]).toContain('2d:strokeRect');
    expect(layers[2]).toEqual([]);
  });

  it('a picture before a stroke is drawn before it, and a stroke before a picture after it', () => {
    const rig = shapeRig('pen');
    add(rig, 'image', 220, 40, { asset: 'asset:a', w: 120, h: 80 });
    drawPath(rig, line(20, 20, 200, 120, 12), {}, 0);
    drawInFrame(theTile(), { box: BOX, items: rig.core.drawList.itemsIn(BOX, 1) });
    expect(tileOrder(probe)).toEqual(['layer', 'strokes']);

    const rig2 = shapeRig('pen');
    drawPath(rig2, line(20, 20, 200, 120, 12), {}, 0);
    add(rig2, 'image', 220, 40, { asset: 'asset:a', w: 120, h: 80 });
    const second = tilesOf(new TileCache(), 400, 300)[0] as Tile;
    drawInFrame(second, { box: BOX, items: rig2.core.drawList.itemsIn(BOX, 1) });
    expect(tileOrder(probe)).toEqual(['strokes', 'layer']);
  });

  it('strokes are not drawn with Canvas 2D in a mixed tile: forty strokes and a shape cost the same 2D calls and one triangle draw', () => {
    const few = shapeRig('pen');
    drawPath(few, line(20, 20, 200, 120, 12), {}, 0);
    add(few, 'rect', 220, 40, { w: 120, h: 80 });
    drawInFrame(theTile(), { box: BOX, items: few.core.drawList.itemsIn(BOX, 1) });
    const twoDFew = probe.log.filter((e) => e.what.startsWith('2d:')).length;
    const drawsFew = probe.log.filter((e) => e.what === 'gl:draw' && (e.count ?? 0) > QUAD_INDICES).length;

    const many = shapeRig('pen');
    for (let i = 0; i < 40; i++) drawPath(many, line(10, 10 + i * 8, 300, 20 + i * 8, 12), {}, i * 1000);
    add(many, 'rect', 220, 40, { w: 120, h: 80 });
    const items = many.core.drawList.itemsIn(BOX, 1);
    expect(items.filter((i) => i.k === 'ink')).toHaveLength(40);
    drawInFrame(tilesOf(new TileCache(), 400, 300)[0] as Tile, { box: BOX, items });
    const twoDMany = probe.log.filter((e) => e.what.startsWith('2d:')).length;
    const drawsMany = probe.log.filter((e) => e.what === 'gl:draw' && (e.count ?? 0) > QUAD_INDICES).length;

    expect(twoDMany).toBe(twoDFew);
    expect(drawsFew).toBe(1);
    expect(drawsMany).toBe(1);
  });

  it('BR-72: the first tile with paper draws every call into the tile\'s own target, none into the canvas (making the layer target in mid-frame unbinds the frame)', () => {
    const rig = shapeRig('pen');
    drawPath(rig, line(20, 20, 200, 120, 12), {}, 0);
    drawInFrame(theTile(), { box: BOX, items: rig.core.drawList.itemsIn(BOX, 1), background: 'lines' });
    const draws = probe.log.filter((e) => e.what === 'gl:draw');
    expect(draws.length).toBeGreaterThan(2);
    expect(draws.filter((e) => e.into === 'screen')).toEqual([]);
    expect(tileOrder(probe)).toEqual(['layer', 'strokes']);
  });

  it('a drawn tile is fresh and counted; its picture is shown again later without being drawn again', () => {
    const rig = shapeRig('pen');
    drawPath(rig, line(20, 20, 200, 120, 12), {}, 0);
    add(rig, 'rect', 220, 40, { w: 120, h: 80 });
    const tile = theTile();
    drawInFrame(tile, { box: BOX, items: rig.core.drawList.itemsIn(BOX, 1) });
    expect(tile.state).toBe('fresh');
    expect(painter.stats.tilesDrawn).toBe(1);
    probe.clear();
    painter.beginFrame({ x: 20, y: 0, zoom: 1 }, 1);
    expect(painter.drawTile(tile, null).ok).toBe(true);
    painter.endFrame();
    expect(tileOrder(probe)).toEqual([]);
    expect(painter.stats.tilesDrawn).toBe(1);
  });
});

describe('a frame with no change composes nothing (design 9 item 4, bench.md item 2)', () => {
  let probe: GpuProbe;
  let painter: WebPainter;
  beforeEach(() => {
    probe = installGpu();
    painter = new WebPainter();
    painter.resize(1100, 300, 1);
  });
  afterEach(() => {
    painter.dispose();
    probe.restore();
  });

  const shown = (tiles: readonly Tile[], cam = camera(), fresh: readonly Tile[] = []): number => {
    probe.clear();
    painter.beginFrame(cam, 1);
    for (const t of tiles) {
      const drawn = fresh.includes(t);
      expect(painter.drawTile(t, drawn ? { box: tileBox(t.k, t.tx, t.ty), items: [] } : null).ok).toBe(true);
    }
    expect(painter.endFrame().ok).toBe(true);
    return composeCost(probe);
  };

  it('the first frame composes the tiles; the next frame that changes nothing makes no draw call and no copy', () => {
    const tiles = tilesOf(new TileCache(), 1100, 300);
    expect(tiles.length).toBeGreaterThanOrEqual(3);
    expect(shown(tiles, camera(), tiles)).toBeGreaterThan(0);
    expect(painter.stats.drawCalls).toBeGreaterThan(0);
    expect(shown(tiles)).toBe(0);
    expect(shown(tiles)).toBe(0);
    expect(probe.log).toEqual([]);
  });

  it('a camera that moved, even a little, composes again; the frame after it composes nothing', () => {
    const tiles = tilesOf(new TileCache(), 1100, 300);
    shown(tiles, camera(), tiles);
    expect(shown(tiles, camera(3, 0))).toBeGreaterThan(0);
    expect(shown(tiles, camera(3, 0))).toBe(0);
    expect(shown(tiles, camera(3, 0, 1.01))).toBeGreaterThan(0);
    expect(shown(tiles, camera(3, 0, 1.01))).toBe(0);
  });

  it('a tile drawn in the frame composes it; so does a different set of tiles shown', () => {
    const tiles = tilesOf(new TileCache(), 1100, 300);
    const [a, b, c] = tiles as [Tile, Tile, Tile];
    shown([a, b], camera(), [a, b]);
    expect(shown([a, b])).toBe(0);
    expect(shown([a, b, c], camera(), [c])).toBeGreaterThan(0);
    expect(shown([a, b, c])).toBe(0);
    // the same camera, one tile less: the picture is not the same
    expect(shown([a, b])).toBeGreaterThan(0);
    expect(shown([a, b])).toBe(0);
  });

  it('a change of size or pixel ratio composes again', () => {
    const tiles = tilesOf(new TileCache(), 1100, 300);
    shown(tiles, camera(), tiles);
    expect(shown(tiles)).toBe(0);
    painter.resize(1000, 300, 1);
    expect(shown(tiles)).toBeGreaterThan(0);
    expect(shown(tiles)).toBe(0);
    painter.resize(1000, 300, 2);
    expect(shown(tiles)).toBeGreaterThan(0);
  });

  it('a stroke being drawn changes the live layer and the overlay, and composes no tile', () => {
    const rig = shapeRig('pen');
    const tiles = tilesOf(new TileCache(), 1100, 300);
    shown(tiles, camera(), tiles);
    rig.host.sample(sample({ x: 0, y: 0, phase: 'down' }));
    for (let i = 1; i < 40; i++) {
      rig.host.sample(sample({ x: i * 6, y: Math.sin(i / 4) * 30 + 100, phase: 'move', time: i * 8 }));
      rig.core.live.rebuild(1);
      probe.clear();
      painter.beginFrame(camera(), 1);
      for (const t of tiles) painter.drawTile(t, null);
      painter.drawLiveStroke(rig.core.live.view());
      painter.drawOverlay({ laser: null, loop: null, selection: [], cursor: null });
      painter.endFrame();
      expect(composeCost(probe), `frame ${i}`).toBe(0);
    }
    expect(painter.liveState).toBe('inking');
  });

  it('BR-74: the stroke being drawn is drawn with WebGL from the outliner\'s arrays: one draw call a frame on the live layer\'s own context, no Canvas 2D call', () => {
    const rig = shapeRig('pen');
    const tiles = tilesOf(new TileCache(), 1100, 300);
    shown(tiles, camera(), tiles);
    rig.host.sample(sample({ x: 0, y: 0, phase: 'down' }));
    let frames = 0;
    probe.clear();
    for (let i = 1; i < 20; i++) {
      rig.host.sample(sample({ x: i * 6, y: Math.sin(i / 4) * 30 + 100, phase: 'move', time: i * 8 }));
      rig.core.live.rebuild(1);
      painter.beginFrame(camera(), 1);
      for (const t of tiles) painter.drawTile(t, null);
      painter.drawLiveStroke(rig.core.live.view());
      painter.endFrame();
      frames++;
    }
    // the live layer has a context of its own: the canvas's framebuffer, where the tiles' targets are never drawn
    const live = probe.log.filter((e) => e.what === 'gl:draw' && e.into === 'screen');
    expect(live.length).toBeGreaterThanOrEqual(frames - 1);
    expect(live.every((e) => (e.count ?? 0) >= 3 && (e.count ?? 0) % 3 === 0)).toBe(true);
    expect(probe.log.filter((e) => e.what.startsWith('2d:'))).toEqual([]);
    expect(probe.contexts.webgl2).toBeGreaterThanOrEqual(2);
  });

  it('BR-74: a painter that is asked for Canvas 2D only keeps drawing the live layer with it', () => {
    const only = new WebPainter({ canvas2dOnly: true });
    only.resize(400, 300, 1);
    const before = probe.contexts.webgl2;
    const rig = shapeRig('pen');
    rig.host.sample(sample({ x: 0, y: 0, phase: 'down' }));
    for (let i = 1; i < 12; i++) rig.host.sample(sample({ x: i * 6, y: Math.sin(i / 4) * 30 + 100, phase: 'move', time: i * 8 }));
    rig.core.live.rebuild(1);
    probe.clear();
    only.beginFrame(camera(), 1);
    only.drawLiveStroke(rig.core.live.view());
    only.endFrame();
    expect(probe.contexts.webgl2).toBe(before);
    expect(probe.log.some((e) => e.what === '2d:fill')).toBe(true);
    only.dispose();
  });
});

describe('the board view composes only when something changed (design 9 item 4)', () => {
  let probe: GpuProbe;
  let browser: Browser;
  let container: HTMLElement;
  let view: BoardView;
  beforeEach(() => {
    probe = installGpu();
    browser = stubBrowser(800, 600);
    container = document.createElement('div');
    document.body.append(container);
    const made = mountBoardView({ container });
    if (!made.ok) throw new Error(made.message);
    view = made.value;
  });
  afterEach(() => {
    view.dispose();
    container.remove();
    browser.restore();
    probe.restore();
  });

  it('after the tiles are drawn, a frame with the same camera makes no draw call; panning composes; a still frame again makes none', () => {
    for (let t = 0; t < 8; t++) view.render(t * 16);
    expect(view.painter.backend).toBe('gl');
    probe.clear();
    view.render(200);
    view.render(216);
    expect(composeCost(probe)).toBe(0);
    view.core.camera?.panBy(-40, 0);
    probe.clear();
    view.render(232);
    expect(composeCost(probe)).toBeGreaterThan(0);
    probe.clear();
    view.render(248);
    expect(composeCost(probe)).toBe(0);
  });

  it('a stroke that is stored draws its tile and composes it, once', () => {
    for (let t = 0; t < 8; t++) view.render(t * 16);
    view.host.setTool('pen');
    drawPath(view, line(50, 50, 200, 120, 10), {}, 1000);
    probe.clear();
    view.render(2000);
    expect(composeCost(probe)).toBeGreaterThan(0);
    probe.clear();
    view.render(2016);
    expect(composeCost(probe)).toBe(0);
  });
});

describe('tiles are drawn on a time budget: at least one a frame, at most 6 (design 9 item 4)', () => {
  let fake: FakeCanvas;
  let browser: Browser;
  let clock: FakeClock;
  let container: HTMLElement;
  let view: BoardView;
  beforeEach(() => {
    fake = installCanvas2d();
    clock = fakeClock();
    // 2,000 × 1,200 at 1:1 is 4 × 3 = 12 tiles of 512
    browser = stubBrowser(2000, 1200);
    container = document.createElement('div');
    document.body.append(container);
    const made = mountBoardView({ container, canvas2dOnly: true });
    if (!made.ok) throw new Error(made.message);
    view = made.value;
  });
  afterEach(() => {
    view.dispose();
    container.remove();
    browser.restore();
    clock.restore();
    fake.restore();
    vi.restoreAllMocks();
  });

  /** Makes each tile that is drawn take `ms` on the clock. */
  function costing(ms: number): void {
    const real = view.painter.drawTile.bind(view.painter);
    vi.spyOn(view.painter, 'drawTile').mockImplementation((tile, content) => {
      if (content !== null) clock.now += ms;
      return real(tile, content);
    });
  }

  /** The tiles drawn by each of the next frames, until a frame draws none. */
  function perFrame(): number[] {
    const out: number[] = [];
    for (let f = 0; f < 20; f++) {
      const before = view.painter.stats.tilesDrawn;
      view.render(f * 16);
      const n = view.painter.stats.tilesDrawn - before;
      out.push(n);
      if (n === 0) break;
    }
    return out;
  }

  it('tiles that cost nothing are drawn six to a frame, never more', () => {
    costing(0);
    const frames = perFrame();
    expect(view.painter.tiles.size).toBe(12);
    expect(frames).toEqual([6, 6, 0]);
  });

  it('a tile that takes longer than the budget is the whole frame: one a frame, never none', () => {
    costing(10);
    const frames = perFrame();
    expect(frames.slice(0, 12)).toEqual(Array(12).fill(1));
    expect(frames[12]).toBe(0);
  });

  it('tiles of 1.5 ms are drawn until the frame has spent 4 ms: three a frame', () => {
    costing(1.5);
    const frames = perFrame();
    expect(frames).toEqual([3, 3, 3, 3, 0]);
  });

  it('tiles of 2 ms stop at the 4 ms that were spent: two a frame', () => {
    costing(2);
    const frames = perFrame();
    expect(frames).toEqual([2, 2, 2, 2, 2, 2, 0]);
  });

  it('every tile is drawn in the end whatever the budget (nothing is left blank)', () => {
    costing(10);
    perFrame();
    const tiles: Tile[] = [];
    view.painter.tiles.visible(view.core.camera as NonNullable<typeof view.core.camera> & { steadyZoom: number }, 2000, 1200, 1, tiles);
    expect(tiles).toHaveLength(12);
    expect(tiles.every((t) => t.state === 'fresh')).toBe(true);
  });
});

describe('past 48 tiles in view the step of the zoom as it is now is used (design 9 item 5)', () => {
  const visible = (cam: { x: number; y: number; zoom: number; steadyZoom: number }, w: number, h: number): Tile[] => {
    const cache = new TileCache();
    cache.beginFrame();
    const out: Tile[] = [];
    cache.visible(cam, w, h, 1, out);
    return out;
  };

  it('a view that needs more than 48 tiles at the steady step uses the step of the zoom as it is now', () => {
    // steady zoom 1 (step 0), zoom 0.1 (step −3): the steady step would need 20 × 14 tiles
    const cam = { x: 0, y: 0, zoom: 0.1, steadyZoom: 1 };
    const tiles = visible(cam, 1000, 700);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(48);
    expect(new Set(tiles.map((t) => t.k))).toEqual(new Set([stepOf(0.1, 1)]));
  });

  it('49 tiles at the steady step is past the limit; 48 is not', () => {
    // zoom 0.5 shows 4,000 × 3,000 page units from the origin: 8 × 6 tiles of 512 at step 0
    const at48 = visible({ x: 0, y: 0, zoom: 0.5, steadyZoom: 1 }, 2000, 1500);
    expect(at48).toHaveLength(48);
    expect(new Set(at48.map((t) => t.k))).toEqual(new Set([0]));
    // 3,700 × 3,700 page units: 8 × 8 would be 64; 7.2 tiles wide and high is 8 × 8
    const over = visible({ x: 0, y: 0, zoom: 0.5, steadyZoom: 1 }, 1850, 1850);
    expect(over.length).toBeLessThanOrEqual(48);
    expect(new Set(over.map((t) => t.k))).toEqual(new Set([stepOf(0.5, 1)]));
  });

  it('a view that fits in 48 tiles keeps the steady step while the zoom moves', () => {
    const tiles = visible({ x: 0, y: 0, zoom: 0.8, steadyZoom: 1 }, 1000, 700);
    expect(tiles.length).toBeLessThanOrEqual(48);
    expect(new Set(tiles.map((t) => t.k))).toEqual(new Set([0]));
  });

  it('zooming in never uses a coarser step than the steady one', () => {
    const tiles = visible({ x: 0, y: 0, zoom: 4, steadyZoom: 1 }, 1000, 700);
    expect(new Set(tiles.map((t) => t.k))).toEqual(new Set([0]));
  });

  it('once the zoom is steady the exact step is used, however many tiles it needs', () => {
    const tiles = visible({ x: 0, y: 0, zoom: 0.1, steadyZoom: 0.1 }, 1000, 700);
    expect(new Set(tiles.map((t) => t.k))).toEqual(new Set([stepOf(0.1, 1)]));
  });
});

describe('zoom settling still ends at the exact step 150 ms after the zoom stops (design 9 item 5)', () => {
  let fake: FakeCanvas;
  let browser: Browser;
  let clock: FakeClock;
  let container: HTMLElement;
  let view: BoardView;
  beforeEach(() => {
    fake = installCanvas2d();
    clock = fakeClock();
    browser = stubBrowser(1000, 700);
    container = document.createElement('div');
    document.body.append(container);
    const made = mountBoardView({ container, canvas2dOnly: true });
    if (!made.ok) throw new Error(made.message);
    view = made.value;
  });
  afterEach(() => {
    view.dispose();
    container.remove();
    browser.restore();
    clock.restore();
    fake.restore();
    vi.restoreAllMocks();
  });

  const stepsShown = (): Set<number> => {
    const tiles: Tile[] = [];
    view.painter.tiles.visible(view.core.camera as NonNullable<typeof view.core.camera> & { steadyZoom: number }, 1000, 700, 1, tiles);
    return new Set(tiles.map((t) => t.k));
  };

  it('while the zoom moves the tiles of the step before it are scaled; 150 ms after the last change the step of the new zoom is drawn', () => {
    for (let f = 0; f < 6; f++) view.render(f);
    const camera = view.core.camera as NonNullable<typeof view.core.camera>;
    expect(camera.steadyZoom).toBe(1);
    camera.zoomAbout(4, 0, 0, 1000);
    view.render(1000);
    view.render(1100);
    view.render(1149);
    expect(camera.motion).toBe('zooming');
    expect(camera.steadyZoom).toBe(1);
    expect(stepsShown()).toEqual(new Set([0]));
    view.render(1150);
    expect(camera.motion).toBe('steady');
    expect(camera.steadyZoom).toBe(4);
    expect(stepsShown()).toEqual(new Set([stepOf(4, 1)]));
    for (let f = 0; f < 10; f++) view.render(1150 + f * 16);
    const tiles: Tile[] = [];
    view.painter.tiles.visible(camera as typeof camera & { steadyZoom: number }, 1000, 700, 1, tiles);
    expect(tiles.every((t) => t.k === 2 && t.state === 'fresh')).toBe(true);
  });

  it('a frame keeps being asked for while the zoom is moving, so the settle is not missed', () => {
    for (let f = 0; f < 6; f++) view.render(f);
    const camera = view.core.camera as NonNullable<typeof view.core.camera>;
    browser.queue.length = 0;
    camera.zoomAbout(0.25, 0, 0, 2000);
    view.requestFrame();
    expect(browser.queue.length).toBeGreaterThan(0);
    let now = 2000;
    for (let f = 0; f < 30 && camera.motion === 'zooming'; f++) {
      now += 16;
      const next = browser.queue.shift();
      if (next === undefined) break;
      next(now);
    }
    expect(camera.motion).toBe('steady');
    expect(camera.steadyZoom).toBe(0.25);
    expect(now - 2000).toBeGreaterThanOrEqual(150);
  });
});
