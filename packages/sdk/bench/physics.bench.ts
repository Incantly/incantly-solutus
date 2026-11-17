/**
 * Physics on the page against docs/features/physics/design.md 11.2 and 11.4 "Worker cost" (Node, warm).
 *
 * Run: `npx vitest run --config packages/sdk/bench/vitest.config.ts packages/sdk/bench/physics.bench.ts`.
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { Figure, space } from '@incantly/kernel';
import { sdkRegistry } from '../src/registry';
import { PhysicsWorkerHost, PhysicsWorkerState } from '../src/worker/index';
import type { FromWorker, PhysicsChannel } from '../src/worker/index';
import { paintScene, paintSpace, sceneOf, sceneOf3, smokeImage } from '../src/screen/index';
import type { DropsItem, Scene3, SheetItem, SpaceGpu, Viewport } from '../src/screen/index';

const noop = (): void => undefined;
const NULL_CTX = {
  beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop, fill: noop, stroke: noop, arc: noop, fillText: noop, strokeText: noop, quadraticCurveTo: noop,
  setLineDash: noop, save: noop, restore: noop, fillRect: noop, setTransform: noop, measureText: () => ({ width: 10 }),
  fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, font: '', textAlign: 'left', textBaseline: 'alphabetic', lineJoin: 'round', lineCap: 'round',
} as unknown as CanvasRenderingContext2D;

const DAM = [
  'tank = Polyline((-8, 9), (-8, 0), (8, 0), (8, 9))',
  'tank with solid = true',
  'water = Liquid(Box((-5.5, 3.5), 5, 7), 2000)',
  'boat = Body(Box((4, 0.5), 1.6, 0.5), density = 0.5)',
];

const make = (): Figure => {
  const f = new Figure({ commands: sdkRegistry() });
  for (const l of DAM) if (!f.apply(l).ok) throw new Error(l);
  return f;
};

const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);

describe('the physics worker, the page side (design 11.2, 11.4)', () => {
  it('moving 2,000 drops from the worker to the page costs under 0.5 ms a frame', () => {
    const state = new PhysicsWorkerState();
    let cb: ((m: FromWorker) => void) | undefined;
    // the worker's own work is not the page's: only the move of the message and the page's writing of it are timed
    let pageMs = 0;
    const channel: PhysicsChannel = {
      post: (m) => {
        const { reply, transfer } = state.handle(structuredClone(m));
        const t = performance.now();
        const got = structuredClone(reply, { transfer });
        cb?.(got);
        pageMs = performance.now() - t;
      },
      onMessage: (f) => {
        cb = f;
      },
      onError: noop,
      close: noop,
    };
    const page = make();
    const host = new PhysicsWorkerHost(page, () => channel);
    const times: number[] = [];
    for (let k = 1; k <= 600; k++) {
      page.setClock(k / 60);
      host.frame(k / 60);
      if (k > 60) times.push(pageMs);
    }
    const s = sorted(times);
    console.log(`worker to page, 2,000 drops: median ${(s[s.length >> 1] as number).toFixed(3)} ms, 95% ${(s[Math.floor(s.length * 0.95)] as number).toFixed(3)} ms a frame (budget 0.5 ms)`);
    expect(s[Math.floor(s.length * 0.95)]).toBeLessThan(0.5);
  });

  it('drawing 2,000 drops as one batch of discs', () => {
    const f = make();
    f.setClock(2);
    const vp = { w: 1200, h: 800, ppu: 60, px: (x: number) => 600 + x * 60, py: (y: number) => 700 - y * 60, box: () => ({ x0: -10, x1: 10, y0: -2, y1: 12 }) } as unknown as Viewport;
    const items = sceneOf(f);
    const times: number[] = [];
    for (let k = 0; k < 200; k++) {
      const t = performance.now();
      paintScene(NULL_CTX, vp, items);
      times.push(performance.now() - t);
    }
    const s = sorted(times);
    console.log(`drawing 2,000 drops: median ${(s[s.length >> 1] as number).toFixed(3)} ms`);
    expect(s[s.length >> 1]).toBeLessThan(1);
  });
});

describe('drawing smoke (design 11.2, 12; ui.md 7)', () => {
  const smokeFigure = (): Figure => {
    const f = new Figure({ commands: sdkRegistry() });
    for (const l of ['world with wind = (3, 0)', 'ball = Circle((0, 0), 0.7)', 'ball with solid = true', 'sm = Smoke(Box((1, 0), 10, 6), 64, source = Box((-3.7, 0), 0.3, 2), heat = 1)']) if (!f.apply(l).ok) throw new Error(l);
    for (let k = 1; k <= 120; k++) f.setClock(k / 60);
    return f;
  };

  it('the 64 × 64 smoke image, made from the density grid each frame: under 0.1 ms', () => {
    const f = smokeFigure();
    const v = f.value('sm') as { density: Float32Array };
    const out = new Uint8ClampedArray(64 * 64 * 4);
    const times: number[] = [];
    for (let k = 0; k < 500; k++) {
      const t = performance.now();
      smokeImage(v.density, 64, out);
      times.push(performance.now() - t);
    }
    const s = sorted(times);
    console.log(`smoke image 64 x 64: median ${(s[s.length >> 1] as number).toFixed(4)} ms, 95% ${(s[Math.floor(s.length * 0.95)] as number).toFixed(4)} ms`);
    expect(s[Math.floor(s.length * 0.95)]).toBeLessThan(0.1);
  });

  it('a frame of smoke past a ball on the board, with no image support (one square a cell): under 1 ms', () => {
    const f = smokeFigure();
    const vp = { w: 1200, h: 800, ppu: 80, px: (x: number) => 500 + x * 80, py: (y: number) => 400 - y * 80, box: () => ({ x0: -6, x1: 8, y0: -5, y1: 5 }) } as unknown as Viewport;
    const items = sceneOf(f);
    const times: number[] = [];
    for (let k = 0; k < 200; k++) {
      const t = performance.now();
      paintScene(NULL_CTX, vp, items);
      times.push(performance.now() - t);
    }
    const s = sorted(times);
    console.log(`drawing 64 x 64 smoke as squares: median ${(s[s.length >> 1] as number).toFixed(3)} ms`);
    expect(s[s.length >> 1]).toBeLessThan(1);
  });
});

/** A splash of 2,000 drops in space beside a boat on a 64 × 64 wave grid (round 7). */
const SPACE = [
  'g = Ground()',
  'w1 = Box((-1.6, 0, 0.9), 0.2, 3.4, 1.8)', 'w2 = Box((1.6, 0, 0.9), 0.2, 3.4, 1.8)', 'w3 = Box((0, -1.6, 0.9), 3.4, 0.2, 1.8)', 'w4 = Box((0, 1.6, 0.9), 3.4, 0.2, 1.8)',
  'w1 with solid = true', 'w2 with solid = true', 'w3 with solid = true', 'w4 with solid = true',
  'water = Liquid(Box((0, 0, 0.5), 3, 3, 1), 2000)',
  'ball = Body(Sphere((0.3, 0.2, 3), 0.4), density = 0.5)',
];
const POOL = ['pool = Box((7, 0, -0.6), 8, 8, 1.2)', 'sea = Waves(pool, 64)', 'boat = Body(Box((7, 0, 0.3), 2, 0.9, 0.5), density = 0.35)'];

const makeLines = (lines: readonly string[]): Figure => {
  const f = new Figure({ commands: sdkRegistry() });
  for (const l of lines) if (!f.apply(l).ok) throw new Error(l);
  return f;
};

describe('liquid and waves in space, the page side (design 11.2, 12; round 7)', () => {
  it('moving 2,000 drops in space from the worker to the page costs under 0.5 ms a frame', () => {
    const state = new PhysicsWorkerState();
    let cb: ((m: FromWorker) => void) | undefined;
    let pageMs = 0;
    const channel: PhysicsChannel = {
      post: (m) => {
        const { reply, transfer } = state.handle(structuredClone(m));
        const t = performance.now();
        const got = structuredClone(reply, { transfer });
        cb?.(got);
        pageMs = performance.now() - t;
      },
      onMessage: (f) => {
        cb = f;
      },
      onError: noop,
      close: noop,
    };
    const page = makeLines([...SPACE, ...POOL]);
    const host = new PhysicsWorkerHost(page, () => channel);
    const times: number[] = [];
    for (let k = 1; k <= 400; k++) {
      page.setClock(k / 60);
      host.frame(k / 60);
      if (k > 60) times.push(pageMs);
    }
    expect(host.running).toBe(true);
    const s = sorted(times);
    console.log(`worker to page, 2,000 drops and 64 x 64 waves in space: median ${(s[s.length >> 1] as number).toFixed(3)} ms, 95% ${(s[Math.floor(s.length * 0.95)] as number).toFixed(3)} ms a frame (budget 0.5 ms)`);
    expect(s[Math.floor(s.length * 0.95)]).toBeLessThan(0.5);
  });

  it('the Space view\'s software painter: 2,000 drops and a 64 × 64 wave grid, measured (round 9 adds the WebGL 2 painter)', () => {
    const f = makeLines([...SPACE, ...POOL]);
    for (let k = 1; k <= 90; k++) f.setClock(k / 60);
    const view = space.viewOf(f);
    const scene = (): number => {
      const t = performance.now();
      sceneOf3(f, view);
      return performance.now() - t;
    };
    const paint = (): number => {
      const sc = sceneOf3(f, view);
      const t = performance.now();
      paintSpace(NULL_CTX, view, 1200, 800, sc);
      return performance.now() - t;
    };
    const sTimes: number[] = [];
    const pTimes: number[] = [];
    for (let k = 0; k < 60; k++) {
      sTimes.push(scene());
      pTimes.push(paint());
    }
    const a = sorted(sTimes);
    const b = sorted(pTimes);
    const items = sceneOf3(f, view).items;
    console.log(`Space view, 2,000 drops + 64 x 64 waves: scene ${(a[a.length >> 1] as number).toFixed(2)} ms, paint ${(b[b.length >> 1] as number).toFixed(2)} ms (median, Node, a canvas that draws nothing, the software painter at full detail); ${items.filter((i) => i.k === 'drops').length} batch of drops, ${items.filter((i) => i.k === 'sheet').length} wave sheet, ${items.filter((i) => i.k === 'face').length} other faces`);
    expect((a[a.length >> 1] as number) + (b[b.length >> 1] as number)).toBeLessThan(10);
  });
});

describe('the WebGL 2 painter of the Space view, the page side (design 11.2 "Draw 2,048 cloth points", 12.1)', () => {
  const NX = 64;
  const NY = 32;
  const sheetOf = (t: number): SheetItem => {
    const pos = new Float32Array(NX * NY * 3);
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const o = (j * NX + i) * 3;
      pos[o] = -3 + (6 * i) / (NX - 1);
      pos[o + 1] = -1.5 + (3 * j) / (NY - 1);
      pos[o + 2] = 1.2 + 0.1 * Math.sin(i / 5 + t);
    }
    return { k: 'sheet', id: 9001, name: 'flag', nx: NX, ny: NY, pos, color: '#3d7fd1', alpha: 1, threads: 8, occludes: true, coarse: 2, fine: 1 };
  };
  const dropsOf = (): DropsItem => {
    const pos = new Float32Array(2000 * 3);
    for (let k = 0; k < 2000; k++) {
      pos[k * 3] = 2 + (k % 20) * 0.1;
      pos[k * 3 + 1] = (Math.floor(k / 20) % 10) * 0.1;
      pos[k * 3 + 2] = Math.floor(k / 200) * 0.1;
    }
    return { k: 'drops', id: 9002, name: 'water', pos, count: 2000, color: '#5aa7e8', alpha: 0.85, radius: 0.04 };
  };
  const gpu: SpaceGpu = {
    paint: () => ({ ok: true, notices: [], value: { source: {} as HTMLCanvasElement, sw: 1, sh: 1, stats: { drawCalls: 0, triangles: 0, drops: 0, uploadBytes: 0, indexBuilds: 0 } } }),
  };
  const ctx = { ...NULL_CTX, drawImage: noop } as unknown as CanvasRenderingContext2D;

  it('a 64 × 32 sheet and 2,000 drops: the page\'s share of a GPU frame, against the software painter\'s coarse fallback', () => {
    const f = makeLines(['g = Ground()', 'ball = Sphere((0, 0, 0.5), 0.5)', 'ball with opacity = 1']);
    const view = space.viewOf(f);
    const base = sceneOf3(f, view);
    const scene = (t: number): Scene3 => ({ floor: base.floor, items: [...base.items, sheetOf(t), dropsOf()] });
    const time = (opts: Parameters<typeof paintSpace>[5], c: CanvasRenderingContext2D, withSheet: boolean): number[] => {
      const out: number[] = [];
      for (let k = 0; k < 120; k++) {
        const sc = withSheet ? scene(k / 60) : base;
        const t0 = performance.now();
        paintSpace(c, view, 1200, 800, sc, opts);
        out.push(performance.now() - t0);
      }
      return sorted(out.slice(20));
    };
    const med = (xs: number[]): number => xs[xs.length >> 1] as number;
    const g = med(time({ gpu }, ctx, true));
    const w = med(time({ gpu }, ctx, false));
    const s = med(time({ coarse: true }, NULL_CTX, true));
    const share = g - w;
    console.log(`64 x 32 sheet + 2,000 drops, page side in Node: with the GPU painter ${g.toFixed(3)} ms (the view alone ${w.toFixed(3)} ms, so the sheet and drops ${share.toFixed(3)} ms; budget a quarter of 3 ms = 0.75 ms); the software painter's coarse fallback ${s.toFixed(3)} ms`);
    expect(share).toBeLessThan(0.75);
  });
});
