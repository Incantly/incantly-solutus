/**
 * Physics on the page against docs/features/physics/design.md 11.2 and 11.4 "Worker cost" (Node, warm).
 *
 * Run: `npx vitest run --config packages/sdk/bench/vitest.config.ts packages/sdk/bench/physics.bench.ts`.
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { Figure } from '@incantly/kernel';
import { sdkRegistry } from '../src/registry';
import { PhysicsWorkerHost, PhysicsWorkerState } from '../src/worker/index';
import type { FromWorker, PhysicsChannel } from '../src/worker/index';
import { paintScene, sceneOf, smokeImage } from '../src/screen/index';
import type { Viewport } from '../src/screen/index';

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
