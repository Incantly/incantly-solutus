/**
 * Physics benchmarks against docs/features/physics/design.md 11.2, Node column (a quarter of the budget).
 *
 * Run: `npx vitest run --config packages/kernel/bench/vitest.config.ts packages/kernel/bench/physics.bench.ts`. Each
 * case is a test that fails when it misses its target. A frame is 1/60 s of film: two steps of 1/120 s, the driver's
 * reading of its inputs and the writing of the cells it owns.
 */
import v8 from 'node:v8';
import { PerformanceObserver, performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import type { Water2 } from '../src/physics/water2';
import { WaterForces } from '../src/physics/water2';
import type { World2 } from '../src/physics/world2';
import type { World3 } from '../src/physics/world3';
import { CommandRegistry, Figure, geometry, getMathLib, physics3Of, physicsOf, registerAnimation, registerFunctions, registerLists, registerNumbers, registerPhysics, registerSpace, setExactMath, setPhysicsKernels } from '../src/index';

const REG = (() => {
  const r = new CommandRegistry();
  geometry.registerGeometry(r);
  registerNumbers(r);
  registerFunctions(r);
  registerAnimation(r);
  registerLists(r);
  registerSpace(r);
  registerPhysics(r);
  return r;
})();

/** A car on 128 × 128 cells of terrain over a 30 m square, driving round and round. */
const CAR_ON_TERRAIN = [
  'hills(x, y) = 0.4 sin(0.5 x) * cos(0.4 y)',
  'hills with solid = true, friction = 0.9',
  'space with clip = true, clipMin = (-15, -15, -3), clipMax = (15, 15, 4)',
  'chassis = Body(Box((0, -6, 1.6), 3, 1.6, 0.5), mass = 400)',
  'w1 = Wheel(chassis, (1.1, -5.2, 1.15), 0.4, steers = true)',
  'w2 = Wheel(chassis, (1.1, -6.8, 1.15), 0.4, steers = true)',
  'w3 = Wheel(chassis, (-1.1, -5.2, 1.15), 0.4)',
  'w4 = Wheel(chassis, (-1.1, -6.8, 1.15), 0.4)',
  'car = Vehicle(chassis, [w1, w2, w3, w4], motor = 0.5, steer = 0.4, power = 5000)',
];

/**
 * Runs the collector now, so a row that counts collector runs starts from an empty young generation: with the heap
 * wherever the setup left it, a collection falls in the window whenever the setup's own garbage filled it (the first
 * frames of a cloth put 9 to 17 MB in the 32 MB). `vitest.config.ts` starts each worker with `--expose-gc`.
 */
function collectNow(): void {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (!gc) throw new Error('the "no garbage" rows need Node started with --expose-gc: run the benches with packages/kernel/bench/vitest.config.ts');
  gc();
}

function load(lines: readonly string[]): Figure {
  const f = new Figure({ commands: REG });
  for (const l of lines) {
    const r = f.apply(l);
    if (!r.ok) throw new Error(`${l}: ${(r as { message: string }).message}`);
  }
  return f;
}

/** Plays `seconds` of film frame by frame: the mean and the worst frame, ms. */
function film(f: Figure, seconds: number): { mean: number; worst: number } {
  let worst = 0;
  const t0 = performance.now();
  const frames = Math.round(seconds * 60);
  for (let k = 1; k <= frames; k++) {
    const a = performance.now();
    f.setClock(k / 60);
    worst = Math.max(worst, performance.now() - a);
  }
  return { mean: (performance.now() - t0) / frames, worst };
}

describe('physics in space (design 11.2)', () => {
  it('3D car with terrain, 1 car, 128 × 128 ground: under 0.12 ms a frame (Node)', { retry: 2 }, () => {
    let best = { mean: Infinity, worst: Infinity };
    for (let run = 0; run < 3; run++) {
      const f = load(CAR_ON_TERRAIN);
      // the terrain really is 128 × 128 cells, and the car stays on it
      const w = physics3Of(f);
      f.setClock(1 / 60);
      expect(w.world?.shapes.some((s) => (s as { hf?: { nx: number } }).hf?.nx === 128)).toBe(true);
      const r = film(f, 30);
      const c = f.value('chassis') as { x: number; y: number; q: readonly number[] };
      expect(Math.hypot(c.x, c.y)).toBeLessThan(14);
      // still on its wheels after 30 s of turning over hills: its own up is still up
      const [, qx, qy] = c.q as [number, number, number];
      expect(1 - 2 * (qx * qx + qy * qy)).toBeGreaterThan(0.8);
      if (r.mean < best.mean) best = r;
    }
    console.log(`3D car on 128 x 128 terrain: ${best.mean.toFixed(4)} ms a frame on average, worst ${best.worst.toFixed(3)} ms`);
    expect(best.mean).toBeLessThan(0.12);
  });

  it('3D car with terrain, a 60 s drive: no frame over 0.5 ms but for a collector pause (Node)', { retry: 2 }, async () => {
    const f = load(CAR_ON_TERRAIN);
    // the first frame builds the world (its own row below)
    f.setClock(1 / 60);
    const gcs: { at: number; end: number }[] = [];
    const obs = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) gcs.push({ at: e.startTime, end: e.startTime + e.duration });
    });
    collectNow();
    obs.observe({ entryTypes: ['gc'] });
    const frames: { at: number; end: number }[] = [];
    for (let k = 2; k <= 61 * 60; k++) {
      const a = performance.now();
      f.setClock(k / 60);
      frames.push({ at: a, end: performance.now() });
    }
    await new Promise((r) => setTimeout(r, 20));
    obs.disconnect();
    const ms = frames.map((x) => x.end - x.at);
    const paused = frames.map((x) => gcs.some((g) => g.end >= x.at && g.at <= x.end));
    const clear = ms.filter((_, i) => !paused[i]);
    const worst = Math.max(...ms);
    const worstClear = Math.max(...clear);
    const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
    console.log(`3D car on 128 x 128 terrain, 60 s: mean ${mean.toFixed(4)} ms, worst ${worstClear.toFixed(3)} ms without a collector pause, worst ${worst.toFixed(3)} ms with one (${paused.filter(Boolean).length} frames had one)`);
    expect(mean).toBeLessThan(0.12);
    expect(worstClear).toBeLessThan(0.5);
  });

  it('building the 128 × 128 terrain world (applying the car line): under 0.25 ms of physics, one line (Node)', () => {
    const f = load(CAR_ON_TERRAIN);
    f.setClock(1 / 60);
    let best = Infinity;
    for (let k = 0; k < 20; k++) {
      const t = performance.now();
      const r = f.apply(`car = Vehicle(chassis, [w1, w2, w3, w4], motor = 0.5, steer = ${0.4 + k / 1000}, power = 5000)`);
      expect(r.ok).toBe(true);
      f.flush();
      best = Math.min(best, performance.now() - t);
    }
    console.log(`one car line in a figure with 128 x 128 terrain: ${best.toFixed(3)} ms`);
    expect(best).toBeLessThan(0.25);
  });
});

/** 2,000 drops released in a tank, with a floating box and a sinking ball: the liquid row of design 11.2. */
const DAM = [
  'tank = Polyline((-8, 9), (-8, 0), (8, 0), (8, 9))',
  'tank with solid = true',
  'lift = 6 min(1, max(0, t - 0.5))',
  'gate = Segment((-3, lift), (-3, 7 + lift))',
  'gate with solid = true',
  'water = Liquid(Box((-5.5, 3.5), 5, 7), 2000)',
  'boat = Body(Box((4, 0.5), 1.6, 0.5), density = 0.5)',
  'ball = Body(Circle((-5, 8), 0.4), density = 3)',
];

const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);

describe('2D liquid (design 11.2, R7)', () => {
  it('2,000 drops: a frame (two steps) under 1.5 ms in Node, mean and the slow frames', () => {
    const f = load(DAM);
    // warm up: the first second
    for (let k = 1; k <= 60; k++) f.setClock(k / 60);
    const times: number[] = [];
    for (let k = 61; k <= 60 * 12; k++) {
      const t = performance.now();
      f.setClock(k / 60);
      times.push(performance.now() - t);
    }
    const s = sorted(times);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const p95 = s[Math.floor(s.length * 0.95)] as number;
    const worst = s[s.length - 1] as number;
    console.log(`2,000 drops, a frame: mean ${mean.toFixed(3)} ms, 95% ${p95.toFixed(3)} ms, worst ${worst.toFixed(3)} ms (budget 1.5 ms); drops ${physicsOf(f).fluid?.ps.n}`);
    expect(physicsOf(f).fluid?.ps.n).toBe(2000);
    expect(p95).toBeLessThan(1.5);
  });

  it('seek anywhere in a 60 s film with 2,000 drops, warm: under 60 ms in Node', () => {
    const f = load(DAM);
    for (let k = 1; k <= 60 * 60; k++) f.setClock(k / 60);
    // 100 times spread over the film, in a fixed order that jumps back and forth
    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t = ((i * 37) % 100) * 0.59 + 0.3;
      const a = performance.now();
      f.setClock(t);
      times.push(performance.now() - a);
    }
    const s = sorted(times);
    console.log(`seek, 2,000 drops: median ${(s[50] as number).toFixed(1)} ms, worst ${(s[99] as number).toFixed(1)} ms (budget 60 ms)`);
    expect(s[99]).toBeLessThan(60);
  });

  it('a checkpoint of 2,000 drops is about 64 KB (design 10.3)', () => {
    const f = load(DAM);
    f.setClock(1);
    const d = physicsOf(f) as unknown as { saveState(): Float64Array };
    const kb = d.saveState().byteLength / 1024;
    console.log(`a checkpoint with 2,000 drops: ${kb.toFixed(1)} KB`);
    expect(kb).toBeLessThan(80);
  });
  it('still water is cheap: the buoyancy of 300 floating boxes costs under 0.1 ms a frame', () => {
    const f = load(['sea = Water(0)', 'bed = Ground(-6)', 'boxes = Bodies(Seq(Box((1.2 mod(k, 30) - 18, 1 + 1.2 floor(k / 30)), 1, 0.6), k, 0, 299), density = 0.5)']);
    for (let k = 1; k <= 60; k++) f.setClock(k / 60);
    // the water's own work, alone: clip each body by the line and push it, as a step does
    const d = physicsOf(f) as unknown as { world: World2; waters: Water2[] };
    const water = new WaterForces();
    const times: number[] = [];
    for (let k = 0; k < 500; k++) {
      const t = performance.now();
      water.apply(d.world, d.waters, 1 / 120);
      water.apply(d.world, d.waters, 1 / 120);
      times.push(performance.now() - t);
    }
    const s = sorted(times);
    console.log(`still water, 300 boxes, its part of a frame (two steps): median ${(s[s.length >> 1] as number).toFixed(3)} ms, 95% ${(s[Math.floor(s.length * 0.95)] as number).toFixed(3)} ms`);
    expect(s[Math.floor(s.length * 0.95)]).toBeLessThan(0.1);
  });
});

/** Smoke on the finest grid, 64 × 64, blown past a solid ball with a light body in it: the smoke row of design 11.2. */
const SMOKE = [
  'world with wind = (3 + sin(2 t), 0)',
  'ball = Circle((0, 0), 0.7)',
  'ball with solid = true',
  'leaf = Body(Circle((2, 1.2), 0.2), mass = 0.02)',
  'sm = Smoke(Box((1, 0), 10, 6), 64, source = Box((-3.7, 0), 0.3, 2), heat = 1)',
  'm = sm.mass',
];

/** Fire on the finest grid, 64 × 64, with two logs that burn on it and a ball in the plume: the fire row of design 11.2. */
const FIRE = [
  'g = Ground()',
  'ball = Circle((1.3, 1.5), 0.25)',
  'ball with solid = true',
  'fr = Fire(Box((0, 2), 4, 4), 64, source = Circle((0, 0.3), 0.3), heat = 1200, fuel = 2)',
  'wood1 = Body(Box((-0.6, 0.3), 0.8, 0.2), burns = 60, ignite = 150)',
  'wood2 = Body(Box((0.6, 0.3), 0.8, 0.2), burns = 60, ignite = 150)',
  'm = fr.fuel',
];

describe('smoke (design 11.2, R7)', () => {
  it('64 × 64 smoke: a frame (two steps, one smoke step) under 0.75 ms in Node, mean and the slow frames', { retry: 2 }, () => {
    const f = load(SMOKE);
    for (let k = 1; k <= 60; k++) f.setClock(k / 60);
    const times: number[] = [];
    for (let k = 61; k <= 60 * 20; k++) {
      const t = performance.now();
      f.setClock(k / 60);
      times.push(performance.now() - t);
    }
    const s = sorted(times);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const p95 = s[Math.floor(s.length * 0.95)] as number;
    const worst = s[s.length - 1] as number;
    const p99 = s[Math.floor(s.length * 0.99)] as number;
    console.log(`smoke 64 x 64, a frame: mean ${mean.toFixed(3)} ms, 95% ${p95.toFixed(3)} ms, 99% ${p99.toFixed(3)} ms, worst ${worst.toFixed(3)} ms (budget 0.75 ms)`);
    const g = physicsOf(f).smokeMembers[0]?.grid;
    expect(g?.n).toBe(64);
    expect(mean).toBeLessThan(0.75);
    expect(p95).toBeLessThan(0.75);
    expect(p99).toBeLessThan(0.75);
  });

  it('seek anywhere in a 60 s film with 64 × 64 smoke, warm: under 25 ms in Node', () => {
    const f = load(SMOKE);
    for (let k = 1; k <= 60 * 60; k++) f.setClock(k / 60);
    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t = ((i * 37) % 100) * 0.59 + 0.3;
      const a = performance.now();
      f.setClock(t);
      times.push(performance.now() - a);
    }
    const s = sorted(times);
    console.log(`seek, 64 x 64 smoke: median ${(s[50] as number).toFixed(1)} ms, worst ${(s[99] as number).toFixed(1)} ms (budget 25 ms, as for 300 bodies)`);
    expect(s[99]).toBeLessThan(25);
  });

  it('a checkpoint of a 64 × 64 smoke grid: the flow, the smoke and the pressure guess, about 130 KB (design 10.3)', () => {
    const f = load(SMOKE);
    f.setClock(1);
    const d = physicsOf(f) as unknown as { saveState(): Float64Array };
    const kb = d.saveState().byteLength / 1024;
    console.log(`a checkpoint with 64 x 64 smoke: ${kb.toFixed(1)} KB`);
    expect(kb).toBeLessThan(140);
  });

  it('fire in the plane, 64 × 64, two burning bodies: a frame under 1 ms in Node, mean and the slow frames (design 11.2, R11)', { retry: 2 }, () => {
    const f = load(FIRE);
    for (let k = 1; k <= 60; k++) f.setClock(k / 60);
    const times: number[] = [];
    for (let k = 61; k <= 60 * 20; k++) {
      const t = performance.now();
      f.setClock(k / 60);
      times.push(performance.now() - t);
    }
    const s = sorted(times);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const p95 = s[Math.floor(s.length * 0.95)] as number;
    const worst = s[s.length - 1] as number;
    const p99 = s[Math.floor(s.length * 0.99)] as number;
    console.log(`fire 64 x 64, two burning bodies, a frame: mean ${mean.toFixed(3)} ms, 95% ${p95.toFixed(3)} ms, 99% ${p99.toFixed(3)} ms, worst ${worst.toFixed(3)} ms (budget 1 ms)`);
    const d = physicsOf(f);
    expect(d.smokeMembers[0]?.grid.n).toBe(64);
    expect(mean).toBeLessThan(1);
    expect(p95).toBeLessThan(1);
  });

  it('a smoke step makes no garbage after the first second (no collection runs)', async () => {
    const f = load(SMOKE);
    for (let k = 1; k <= 60; k++) f.setClock(k / 60);
    const d = physicsOf(f);
    const sm = d.smokeMembers[0];
    const w = (d as unknown as { world: World2 }).world;
    if (!sm) throw new Error('no smoke');
    const g = sm.grid;
    const arrays = [g.u, g.v, g.s, g.p, g.fx];
    let gcs = 0;
    const obs = new PerformanceObserver((list) => {
      gcs += list.getEntries().length;
    });
    collectNow();
    obs.observe({ entryTypes: ['gc'] });
    for (let k = 0; k < 200; k++) g.step(w, 1 / 60);
    await new Promise((r) => setTimeout(r, 50));
    obs.disconnect();
    console.log(`collections during 200 smoke steps: ${gcs}`);
    // the grid swaps its two buffers each step: after an even number of steps, the very same arrays
    for (const [a, b] of [[g.u, arrays[0]], [g.v, arrays[1]], [g.s, arrays[2]], [g.p, arrays[3]], [g.fx, arrays[4]]] as const) expect(a === b).toBe(true);
    expect(gcs).toBe(0);
  });
});

/** A ball dropped into a tank of 2,000 drops in space: the 3D liquid row of design 11.2. */
const SPLASH3 = [
  'g = Ground()',
  'w1 = Box((-1.6, 0, 0.9), 0.2, 3.4, 1.8)', 'w2 = Box((1.6, 0, 0.9), 0.2, 3.4, 1.8)', 'w3 = Box((0, -1.6, 0.9), 3.4, 0.2, 1.8)', 'w4 = Box((0, 1.6, 0.9), 3.4, 0.2, 1.8)',
  'w1 with solid = true', 'w2 with solid = true', 'w3 with solid = true', 'w4 with solid = true',
  'water = Liquid(Box((0, 0, 0.5), 3, 3, 1), 2000)',
  'ball = Body(Sphere((0.3, 0.2, 3), 0.4), density = 0.5)',
  'stone = Body(Box((-0.6, -0.5, 2.5), 0.5, 0.5, 0.5), density = 3)',
];

/** A boat and a rock on a 64 × 64 wave grid: the waves row. */
const WAVES64 = [
  'bed = Ground(-1.2)',
  'pool = Box((0, 0, -0.6), 10, 10, 1.2)',
  'sea = Waves(pool, 64)',
  'boat = Body(Box((1.5, 0, 0.3), 2, 0.9, 0.5), density = 0.35)',
  'rock = Body(Sphere((-1.2, 0.8, 3), 0.5), density = 2.5)',
];

describe('3D liquid and waves (design 11.2, round 7)', () => {
  it('3D liquid, 2,000 drops: a frame (two steps) under 1.5 ms in Node, mean and the slow frames', { retry: 2 }, () => {
    const f = load(SPLASH3);
    for (let k = 1; k <= 60; k++) f.setClock(k / 60);
    const times: number[] = [];
    for (let k = 61; k <= 60 * 12; k++) {
      const t = performance.now();
      f.setClock(k / 60);
      times.push(performance.now() - t);
    }
    const s = sorted(times);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const p95 = s[Math.floor(s.length * 0.95)] as number;
    console.log(`3D liquid, 2,000 drops, a frame: mean ${mean.toFixed(3)} ms, 95% ${p95.toFixed(3)} ms, worst ${(s[s.length - 1] as number).toFixed(3)} ms (budget 1.5 ms)`);
    expect(physics3Of(f).fluid?.ps.n).toBe(2000);
    expect(mean).toBeLessThan(1.5);
    expect(p95).toBeLessThan(1.5);
  });

  it('seek anywhere in a 60 s film with 2,000 drops in space, warm: under 60 ms in Node', () => {
    const f = load(SPLASH3);
    for (let k = 1; k <= 60 * 60; k++) f.setClock(k / 60);
    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t = ((i * 37) % 100) * 0.59 + 0.3;
      const a = performance.now();
      f.setClock(t);
      times.push(performance.now() - a);
    }
    const s = sorted(times);
    console.log(`seek, 2,000 drops in space: median ${(s[50] as number).toFixed(1)} ms, worst ${(s[99] as number).toFixed(1)} ms (budget 60 ms)`);
    expect(s[99]).toBeLessThan(60);
  });

  it('a checkpoint of 2,000 drops in space is about 96 KB (design 10.3)', () => {
    const f = load(SPLASH3);
    f.setClock(1);
    const kb = physics3Of(f).checkpointBytes() / 1024;
    console.log(`a checkpoint with 2,000 drops in space: ${kb.toFixed(1)} KB`);
    expect(kb).toBeLessThan(110);
  });

  it('waves 64 × 64 with a boat and a rock: under 0.25 ms a frame in Node', { retry: 2 }, () => {
    const f = load(WAVES64);
    for (let k = 1; k <= 60; k++) f.setClock(k / 60);
    const times: number[] = [];
    for (let k = 61; k <= 60 * 12; k++) {
      const t = performance.now();
      f.setClock(k / 60);
      times.push(performance.now() - t);
    }
    const s = sorted(times);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const p95 = s[Math.floor(s.length * 0.95)] as number;
    console.log(`waves 64 x 64, a frame: mean ${mean.toFixed(3)} ms, 95% ${p95.toFixed(3)} ms (budget 0.25 ms)`);
    expect(mean).toBeLessThan(0.25);
  });
});

/* ------------------------------ cloth (design 11.2 cloth rows, 11.4 "Cloth, …"; round 9) ------------------------------ */

const FLAG64 = ['g = Ground()', 'flag = Cloth((0, 0, 4), (3, 0, 0), (0, 0, -2), 64, 32, mass = 0.5, pins = "left")', 'world with wind = (5 + 3 sin(2 t), 1, 0)'];
const SHEET32 = ['g = Ground()', 'ball = Sphere((0, 0, 1), 1)', 'ball with solid = true', 'sheet = Cloth((-1.6, -1.6, 2.6), (3.2, 0, 0), (0, 3.2, 0), 32, 32, mass = 0.4)'];
const ROPE400 = ['rope = Cloth((0, 5), (8, 5), 400, mass = 0.5, pins = [(0, 5)])', 'ball = Body(Circle((8, 5), 0.2), mass = 1)', 'tie = Pin(rope, (8, 5), ball)'];
const OVER40 = (() => {
  const l = ['g = Ground()', 'sheet = Cloth((-3, -1.5, 3), (6, 0, 0), (0, 3, 0), 64, 32, mass = 0.6)'];
  for (let k = 0; k < 40; k++) l.push(`b${k} = Body(Box((${-2.7 + (k % 10) * 0.6}, ${-1.2 + Math.floor(k / 10) * 0.8}, 0.25), 0.4, 0.4, 0.4), mass = 1)`);
  return l;
})();
const SELF = ['g = Ground()', 'sheet = Cloth((-2, -1, 3), (4, 0, 0), (0, 0, -2), 64, 32, mass = 0.5, self = true)', 'post = Box((0, 0, 0.5), 1, 1, 1)', 'post with solid = true'];
const TWO = ['g = Ground()', 'a = Cloth((0, 0, 4), (3, 0, 0), (0, 0, -2), 64, 32, pins = "left")', 'b = Cloth((0, 1, 4), (3, 0, 0), (0, 0, -2), 64, 32, pins = "left")', 'world with wind = (4 + 2 sin(3 t), 1, 0)'];
const WET = ['g = Ground()', 'sheet = Cloth((-3, -1.5, 2), (6, 0, 0), (0, 3, 0), 64, 32, mass = 0.6, pins = "corners")', 'water = Liquid(Box((0, 0, 3), 2, 2, 0.5), 2000)'];

/** Frames of 1/60 s from t0 to t1: mean, the 95% frame and the worst, ms. */
function frames(f: Figure, t0: number, t1: number): { mean: number; p95: number; worst: number } {
  for (let k = 1; k <= Math.round(t0 * 60); k++) f.setClock(k / 60);
  const times: number[] = [];
  for (let k = Math.round(t0 * 60) + 1; k <= Math.round(t1 * 60); k++) {
    const a = performance.now();
    f.setClock(k / 60);
    times.push(performance.now() - a);
  }
  const s = sorted(times);
  return { mean: times.reduce((a, b) => a + b, 0) / times.length, p95: s[Math.floor(s.length * 0.95)] as number, worst: s[s.length - 1] as number };
}

describe('cloth (design 11.2, round 9)', () => {
  const rows: [string, readonly string[], number][] = [
    ['2D rope, 400 points, a ball on it', ROPE400, 0.5],
    ['3D cloth, the default size 32 × 32, dropped on a ball', SHEET32, 0.75],
    ['3D cloth, the largest, 64 × 32, in gusts', FLAG64, 1.5],
    ['3D cloth over bodies, 64 × 32 and 40 bodies', OVER40, 2],
    ['cloth that hits itself, 64 × 32, self = true', SELF, 2],
    ['two cloths, 2 × 64 × 32, in gusts', TWO, 2],
    ['cloth in water, 64 × 32 and 2,000 drops', WET, 2],
  ];
  for (const [name, lines, budget] of rows) {
    it(`${name}: a frame (two steps) under ${budget} ms in Node`, { retry: 2 }, () => {
      const r = frames(load(lines), 1, 7);
      console.log(`${name}: mean ${r.mean.toFixed(3)} ms, 95% ${r.p95.toFixed(3)} ms, worst ${r.worst.toFixed(2)} ms (budget ${budget} ms)`);
      expect(r.mean).toBeLessThan(budget);
    });
  }

  it('Cloth, worst frame: a 64 × 32 flag in gusts for 60 s, then a sheet over 40 bodies — the slow frames within 11.2', { retry: 2 }, () => {
    const a = frames(load(FLAG64), 0, 60);
    const b = frames(load(OVER40), 0, 10);
    console.log(`worst frame: flag 60 s mean ${a.mean.toFixed(3)} / 95% ${a.p95.toFixed(3)} / worst ${a.worst.toFixed(2)} ms; over 40 bodies mean ${b.mean.toFixed(3)} / 95% ${b.p95.toFixed(3)} / worst ${b.worst.toFixed(2)} ms`);
    expect(a.p95).toBeLessThan(1.5);
    expect(b.p95).toBeLessThan(2);
  });

  for (const [name, lines, budget] of [['cloth up to 2,048 points', FLAG64, 25], ['4,096 cloth points', TWO, 50]] as const) {
    it(`seek anywhere in a 60 s film, ${name}, warm: under ${budget} ms in Node`, () => {
      const f = load(lines);
      for (let k = 1; k <= 60 * 60; k++) f.setClock(k / 60);
      const times: number[] = [];
      for (let i = 0; i < 100; i++) {
        const t = ((i * 37) % 100) * 0.59 + 0.3;
        const a = performance.now();
        f.setClock(t);
        times.push(performance.now() - a);
      }
      const s = sorted(times);
      console.log(`seek, ${name}: median ${(s[50] as number).toFixed(1)} ms, worst ${(s[99] as number).toFixed(1)} ms (budget ${budget} ms)`);
      expect(s[95]).toBeLessThan(budget);
    });
  }

  it('a checkpoint of a 64 × 32 cloth is about 100 KB (design 10.3)', () => {
    const f = load(FLAG64);
    f.setClock(1);
    const kb = physics3Of(f).checkpointBytes() / 1024;
    console.log(`a checkpoint with a 64 x 32 cloth: ${kb.toFixed(1)} KB`);
    expect(kb).toBeLessThan(110);
  });

  for (const kernels of [true, false]) {
    it(`Cloth, no garbage: steps of a 64 × 32 sheet make no memory after the first second (no collection runs), kernels ${kernels ? 'on' : 'off'}`, async () => {
      setPhysicsKernels(kernels);
      // A collection frees the Rust module of the row before, and code the engine made for it that holds that module
      // (the loops that call it) is thrown away with it: run in the interpreter, a cloth step makes megabytes. So the
      // module goes now, before the warm-up makes the code again, not at the second `collectNow` below.
      collectNow();
      try {
        const f = load(FLAG64.filter((l) => !l.startsWith('world')));
        f.apply('world with wind = (5, 1, 0)');
        for (let k = 1; k <= 60; k++) f.setClock(k / 60);
        const d = physics3Of(f);
        const c = d.cloth;
        const w = (d as unknown as { world: import('../src/physics/world3').World3 }).world;
        if (!c) throw new Error('no cloth');
        expect(c.usesKernels).toBe(kernels);
        const arrays = [c.x, c.vx, c.la, c.rest];
        let gcs = 0;
        const obs = new PerformanceObserver((list) => {
          gcs += list.getEntries().length;
        });
        collectNow();
        obs.observe({ entryTypes: ['gc'] });
        for (let k = 0; k < 2000; k++) c.step(w, 1 / 120);
        await new Promise((r) => setTimeout(r, 50));
        obs.disconnect();
        console.log(`collections during 2,000 cloth steps, kernels ${kernels ? 'on' : 'off'}: ${gcs}`);
        for (const [a, b] of [[c.x, arrays[0]], [c.vx, arrays[1]], [c.la, arrays[2]], [c.rest, arrays[3]]] as const) expect(a === b).toBe(true);
        expect(gcs).toBe(0);
      } finally {
        setPhysicsKernels(true);
      }
    });
  }
});

/* ------------------------------ liquid steps and the drivers' frame, no garbage (design 11.4; PH-24, PH-25) ------------------------------ */

/** Bytes of heap in use now, new space included: while no collection runs, a difference over a window is what the window made. */
function heapUsed(): number {
  return v8.getHeapStatistics().used_heap_size;
}

/**
 * Runs `work` five times after a `gc()` and tells how many collections ran in them (Node's `gc` performance entries) and
 * how many bytes of heap the run that made least made. A step that makes 100 bytes fills the young generation too slowly
 * for a collection to show in a short window, so each row also bounds the bytes a step makes.
 *
 * A collection throws away the code the engine made for functions that hold the Rust module of an earlier row, and code
 * not made again runs in the interpreter, where every number read from a field is a new heap number. So `warm` runs after
 * the `gc()`, before the counting, and makes the code again.
 */
async function allocation(work: () => void, warm: () => void): Promise<{ gcs: number; bytes: number }> {
  let gcs = 0;
  const obs = new PerformanceObserver((list) => {
    gcs += list.getEntries().length;
  });
  collectNow();
  // the engine makes its fastest code on another thread and puts it in at a later call: the warm-up is three rounds with
  // a pause after each, so a busy machine has made it before the counting starts
  for (let round = 0; round < 3; round++) {
    warm();
    await new Promise((r) => setTimeout(r, 100));
  }
  obs.observe({ entryTypes: ['gc'] });
  // reading the heap makes a few KB of its own: take it off, measured by an empty window
  heapUsed();
  heapUsed();
  const z = heapUsed();
  const own = heapUsed() - z;
  // five windows, the least taken: a step that makes garbage makes it in every window, while the engine's own work (it
  // makes code, or grows a table, in whichever window it happens to fall) is in one of them
  let least = Infinity;
  for (let k = 0; k < 5; k++) {
    const a = heapUsed();
    work();
    const b = heapUsed();
    least = Math.min(least, b - a - own);
  }
  await new Promise((r) => setTimeout(r, 50));
  obs.disconnect();
  return { gcs, bytes: least };
}

describe('liquid steps make no garbage (design 11.4)', () => {
  for (const kernels of [true, false]) {
    it(`a 3D liquid step makes no garbage (no collection runs, under 16 bytes a step), kernels ${kernels ? 'on' : 'off'}`, async () => {
      setPhysicsKernels(kernels);
      collectNow();
      try {
        const f = load(SPLASH3);
        for (let k = 1; k <= 60; k++) f.setClock(k / 60);
        const d = physics3Of(f);
        const fl = d.fluid;
        const w = (d as unknown as { world: World3 }).world;
        if (!fl) throw new Error('no liquid');
        expect(fl.usesKernels).toBe(kernels);
        const steps = 500;
        // the engine makes the code of the loops in the first few thousand steps
        const r = await allocation(
          () => {
            for (let k = 0; k < steps; k++) fl.step(w);
          },
          () => {
            for (let k = 0; k < 1500; k++) fl.step(w);
          },
        );
        console.log(`3D liquid, ${steps} steps, kernels ${kernels ? 'on' : 'off'}: ${r.gcs} collections, ${(r.bytes / steps).toFixed(2)} bytes a step`);
        expect(r.gcs).toBe(0);
        expect(r.bytes / steps).toBeLessThan(16);
      } finally {
        setPhysicsKernels(true);
      }
    });
  }

  it('a 2D liquid step makes no garbage (no collection runs, under 16 bytes a step)', async () => {
    collectNow();
    const f = load(DAM);
    for (let k = 1; k <= 60; k++) f.setClock(k / 60);
    const d = physicsOf(f);
    const fl = d.fluid;
    const w = (d as unknown as { world: World2 }).world;
    if (!fl) throw new Error('no liquid');
    const steps = 500;
    const r = await allocation(
      () => {
        for (let k = 0; k < steps; k++) fl.step(w);
      },
      () => {
        for (let k = 0; k < 1500; k++) fl.step(w);
      },
    );
    console.log(`2D liquid, ${steps} steps: ${r.gcs} collections, ${(r.bytes / steps).toFixed(2)} bytes a step`);
    expect(r.gcs).toBe(0);
    expect(r.bytes / steps).toBeLessThan(16);
  });
});

/**
 * The frames of a figure played through `setClock` (what a host does at each tick), after a warm-up the engine makes its
 * code in: the bytes of heap one frame makes, and the collections that ran. The checkpoints a driver keeps are its film
 * (the state at every half second, kept to seek from), not garbage, so a window of ten frames, shorter than the spacing
 * of checkpoints (a quarter of a second at the least), counts only when none was saved in it.
 *
 * What a frame must make (design 11.4): the delta `setClock` returns, the clock's event, the value of each cell that
 * changed (a new object, because the figure compares a cell with the one it holds) and the arrays of its numbers kept in
 * turn. A body that rests keeps the cell it had, so a pile of sleeping bodies makes nothing of its own.
 */
async function framesOf(f: Figure, checkpoints: () => number, warm: number, window = 10, wanted = 12): Promise<{ gcs: number; perFrame: number; windows: number }> {
  let frame = 0;
  for (; frame < warm; ) f.setClock(++frame / 60);
  let gcs = 0;
  const obs = new PerformanceObserver((list) => {
    gcs += list.getEntries().length;
  });
  collectNow();
  obs.observe({ entryTypes: ['gc'] });
  heapUsed();
  heapUsed();
  const z = heapUsed();
  const own = heapUsed() - z;
  let bytes = 0;
  let counted = 0;
  let windows = 0;
  for (let w = 0; w < 80 && windows < wanted; w++) {
    const cp = checkpoints();
    const a = heapUsed();
    for (let k = 0; k < window; k++) f.setClock(++frame / 60);
    const b = heapUsed();
    if (checkpoints() !== cp) continue;
    bytes += b - a - own;
    counted += window;
    windows++;
  }
  await new Promise((r) => setTimeout(r, 50));
  obs.disconnect();
  return { gcs, perFrame: bytes / counted, windows };
}

const checkpointsOf = (d: unknown): (() => number) => () => (d as { checkpoints: { size: number } }).checkpoints.size;

const FLAG_WIND = ['g = Ground()', 'flag = Cloth((0, 0, 4), (3, 0, 0), (0, 0, -2), 64, 32, mass = 0.5, pins = "left")', 'world with wind = (5, 1, 0)'];
const BOXES = ['g = Ground()', 'boxes = Bodies(Seq(Box((1.2 mod(k, 30) - 18, 1 + 1.2 floor(k / 30)), 1, 0.6), k, 0, 299))'];
/** 300 boxes dropped from 60 m: they fall, land and go to sleep. */
const BOXES_FALLING = ['g = Ground()', 'boxes = Bodies(Seq(Box((2.4 mod(k, 6) - 7, 60 + 1.4 floor(k / 6)), 1, 0.6), k, 0, 299))'];
/** The dam of the 2D liquid with its gate shut (a gate that moves with `t` makes a new shape at each step: that is the rule's, not the liquid's). */
const DAM_SHUT = DAM.map((l) => (l.startsWith('lift') ? 'lift = 0' : l));

describe("the drivers' frame makes no garbage (design 11.4; PH-25)", () => {
  for (const kernels of [true, false]) {
    it(`a frame of a 3D flag through setClock makes no garbage (no collection runs, under 2 KB a frame: the cells), kernels ${kernels ? 'on' : 'off'}`, async () => {
      setPhysicsKernels(kernels);
      collectNow();
      try {
        const f = load(FLAG_WIND);
        const d = physics3Of(f);
        const r = await framesOf(f, checkpointsOf(d), 4000);
        const c = d.cloth;
        if (c) expect(c.usesKernels).toBe(kernels);
        console.log(`3D flag 64 x 32, a frame, kernels ${kernels ? 'on' : 'off'}: ${r.gcs} collections, ${r.perFrame.toFixed(0)} bytes a frame over ${r.windows} windows`);
        expect(r.windows).toBeGreaterThanOrEqual(4);
        expect(r.gcs).toBe(0);
        // (the frame made 35,046 bytes before; what is left is the delta, the clock event, the world's cell and the cloth's)
        expect(r.perFrame).toBeLessThan(2048);
      } finally {
        setPhysicsKernels(true);
      }
    }, 120_000);
  }

  it('a frame of 300 2D boxes at rest through setClock makes no garbage (no collection runs, under 1 KB a frame)', async () => {
    collectNow();
    const f = load(BOXES);
    const r = await framesOf(f, checkpointsOf(physicsOf(f)), 4000);
    console.log(`300 boxes at rest, a frame: ${r.gcs} collections, ${r.perFrame.toFixed(0)} bytes a frame over ${r.windows} windows`);
    expect(r.windows).toBeGreaterThanOrEqual(4);
    expect(r.gcs).toBe(0);
    expect(r.perFrame).toBeLessThan(1024);
  }, 120_000);

  it('a frame of 300 2D boxes falling and landing through setClock makes only the cells of the bodies that move (under 30 KB a frame)', async () => {
    collectNow();
    const f = load(BOXES_FALLING);
    // the engine makes its code on a first film; the one measured is a second, from its start
    for (let k = 1; k <= 3000; k++) f.setClock(k / 60);
    const g = load(BOXES_FALLING);
    const r = await framesOf(g, checkpointsOf(physicsOf(g)), 120, 10, 24);
    console.log(`300 boxes falling, a frame: ${r.gcs} collections, ${r.perFrame.toFixed(0)} bytes a frame over ${r.windows} windows`);
    expect(r.windows).toBeGreaterThanOrEqual(4);
    // (528,510 to 694,542 bytes a frame before)
    expect(r.perFrame).toBeLessThan(30_000);
  }, 120_000);

  it('a frame of a 2D liquid of 2,000 drops through setClock makes no garbage (no collection runs, under 4 KB a frame: the cells)', async () => {
    collectNow();
    const f = load(DAM_SHUT);
    const r = await framesOf(f, checkpointsOf(physicsOf(f)), 4000);
    console.log(`2D liquid 2,000 drops, a frame: ${r.gcs} collections, ${r.perFrame.toFixed(0)} bytes a frame over ${r.windows} windows`);
    expect(r.windows).toBeGreaterThanOrEqual(4);
    expect(r.gcs).toBe(0);
    // (60,180 bytes a frame before)
    expect(r.perFrame).toBeLessThan(4096);
  }, 120_000);

  it('a frame of fire in the plane (64 × 64, two burning bodies) through setClock makes no garbage (no collection runs, under 8 KB a frame: the cells)', async () => {
    collectNow();
    const f = load(FIRE);
    const r = await framesOf(f, checkpointsOf(physicsOf(f)), 4000);
    console.log(`2D fire 64 x 64, a frame: ${r.gcs} collections, ${r.perFrame.toFixed(0)} bytes a frame over ${r.windows} windows`);
    expect(r.windows).toBeGreaterThanOrEqual(4);
    expect(r.gcs).toBe(0);
    // (155,999 to 172,246 bytes a frame before)
    expect(r.perFrame).toBeLessThan(8192);
  }, 120_000);
});

/** A fire in space, 24 cells a side (its default), on the ground: the fire rows of design 11.2, round 11B. */
const FIRE24 = ['g = Ground()', 'blaze = Fire((0, 0, 0))', 'm = blaze.fuel'];

/** The finest fire in space, 32 cells a side. */
const FIRE32 = ['g = Ground()', 'blaze = Fire(Box((0, 0, 1), 2, 2, 3), 32, source = Sphere((0, 0, 0.1), 0.3))', 'm = blaze.fuel'];

/** A 64 × 32 flag over a fire of 24³: the flag-over-fire row. */
const FLAGFIRE = [
  'g = Ground()',
  'blaze = Fire((0, 0, 0))',
  'flag = Cloth((-1, -0.3, 2.4), (2, 0, 0), (0, 0, -1.2), 64, 32, mass = 0.4, pins = "top")',
  'lift = flag.at(32, 16).y',
];

/** Plays frames 61 to 60 s + 1 of a figure, one `setClock` of 1/60 s each: the mean, 95%, 99% and worst frame, ms. */
function playFrames(f: Figure, from: number, to: number): { mean: number; p95: number; p99: number; worst: number } {
  const times: number[] = [];
  for (let k = from; k <= to; k++) {
    const t = performance.now();
    f.setClock(k / 60);
    times.push(performance.now() - t);
  }
  const s = sorted(times);
  return { mean: times.reduce((a, b) => a + b, 0) / times.length, p95: s[Math.floor(s.length * 0.95)] as number, p99: s[Math.floor(s.length * 0.99)] as number, worst: s[s.length - 1] as number };
}

describe('smoke and fire in space (design 9.8, 11.2, round 11B)', () => {
  it('fire in space, 24³: a frame (two steps, one smoke step) under 2 ms in Node, mean and the slow frames', { retry: 2 }, () => {
    const f = load(FIRE24);
    for (let k = 1; k <= 60; k++) f.setClock(k / 60);
    const r = playFrames(f, 61, 60 * 20);
    console.log(`fire in space 24³, a frame: mean ${r.mean.toFixed(3)} ms, 95% ${r.p95.toFixed(3)} ms, 99% ${r.p99.toFixed(3)} ms, worst ${r.worst.toFixed(3)} ms (budget 2 ms)`);
    expect(physics3Of(f).smokeMembers[0]?.grid.n).toBe(24);
    expect(r.mean).toBeLessThan(2);
  });

  it('fire in space, 32³, the largest: a frame under 4 ms in Node, mean and the slow frames', { retry: 2 }, () => {
    const f = load(FIRE32);
    for (let k = 1; k <= 60; k++) f.setClock(k / 60);
    const r = playFrames(f, 61, 60 * 10);
    console.log(`fire in space 32³, a frame: mean ${r.mean.toFixed(3)} ms, 95% ${r.p95.toFixed(3)} ms, 99% ${r.p99.toFixed(3)} ms, worst ${r.worst.toFixed(3)} ms (budget 4 ms)`);
    expect(physics3Of(f).smokeMembers[0]?.grid.n).toBe(32);
    expect(r.mean).toBeLessThan(4);
  });

  it('a 64 × 32 flag over a fire in space (24³): a frame under 2.5 ms in Node, mean and the slow frames', { retry: 2 }, () => {
    const f = load(FLAGFIRE);
    for (let k = 1; k <= 60; k++) f.setClock(k / 60);
    const r = playFrames(f, 61, 60 * 10);
    console.log(`64 x 32 flag over a fire 24³, a frame: mean ${r.mean.toFixed(3)} ms, 95% ${r.p95.toFixed(3)} ms, 99% ${r.p99.toFixed(3)} ms, worst ${r.worst.toFixed(3)} ms (budget 2.5 ms)`);
    expect(physics3Of(f).cloth?.smokes.length).toBe(1);
    expect(r.mean).toBeLessThan(2.5);
  });

  it('seek anywhere in a 60 s film with a fire in space (24³), warm: under 120 ms in Node', () => {
    const f = load(FIRE24);
    for (let k = 1; k <= 60 * 60; k++) f.setClock(k / 60);
    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t = ((i * 37) % 100) * 0.59 + 0.3;
      const a = performance.now();
      f.setClock(t);
      times.push(performance.now() - a);
    }
    const s = sorted(times);
    console.log(`seek, fire in space 24³: median ${(s[50] as number).toFixed(1)} ms, worst ${(s[99] as number).toFixed(1)} ms (budget 120 ms)`);
    expect(s[99]).toBeLessThan(120);
  });

  it('a checkpoint of a 24³ grid is about 400 KB, and 60 s of film stays under 32 MB (design 10.3)', () => {
    const f = load(FIRE24);
    f.setClock(1);
    const kb = physics3Of(f).checkpointBytes() / 1024;
    console.log(`a checkpoint with a 24³ fire: ${kb.toFixed(1)} KB; 60 checkpoints (one a second) ${((kb * 60) / 1024).toFixed(1)} MB`);
    expect(kb).toBeLessThan(420);
    expect((kb * 60) / 1024).toBeLessThan(32);
  });

  // kernels off first: a collection frees the Rust module of the row before, and the code that held it runs in the interpreter
  for (const kernels of [false, true]) {
    it(`a step of the grid in space makes no garbage after the first second (no collection runs), kernels ${kernels ? 'on' : 'off'}`, async () => {
      setPhysicsKernels(kernels);
      // as in the cloth rows: the Rust module of the row before goes now, before the warm-up makes the code again
      collectNow();
      try {
        // with the Rust loops the water's list of drops is in the step too; the TypeScript loop over the drops makes memory in
        // the test runner for a long while (it reads imported bindings through the loader), which is not what this row is about
        const rain = kernels ? ['rain = Liquid(Box((0, 0, 2.2), 0.6, 0.6, 0.4), 200)'] : [];
        const f = load(['g = Ground()', 'blaze = Fire((0, 0, 0))', 'ball = Body(Sphere((0.6, 0, 1.2), 0.3), mass = 0.5)', 'stone = Body(Box((-0.5, 0, 0.5), 0.3, 0.3, 0.3), burns = 20, ignite = 150)', ...rain]);
        for (let k = 1; k <= 60; k++) f.setClock(k / 60);
        const d = physics3Of(f);
        const sm = d.smokeMembers[0];
        const w = d.world;
        if (!sm || !w) throw new Error('no grid in space');
        const g = sm.grid;
        expect(g.usesKernels).toBe(kernels);
        const arrays = [g.u, g.v, g.w, g.s, g.p, g.T, g.F, g.fx];
        let gcs = 0;
        const obs = new PerformanceObserver((list) => {
          gcs += list.getEntries().length;
        });
        collectNow();
        obs.observe({ entryTypes: ['gc'] });
        for (let k = 0; k < 200; k++) g.step(w, 1 / 60, d.fluid?.ps);
        await new Promise((r) => setTimeout(r, 50));
        obs.disconnect();
        console.log(`collections during 200 steps of a 24³ fire, kernels ${kernels ? 'on' : 'off'}: ${gcs}`);
        // the grid swaps its two buffers each step: after an even number of steps, the very same arrays
        const now = [g.u, g.v, g.w, g.s, g.p, g.T, g.F, g.fx];
        for (let i = 0; i < now.length; i++) expect(now[i] === arrays[i]).toBe(true);
        expect(gcs).toBe(0);
      } finally {
        setPhysicsKernels(true);
      }
    });
  }
});

/* ------------------------------ bodies (design 11.2 rows of the bodies; round 10, task 10.1) ------------------------------ */

/** 300 boxes at rest on the ground, and a ball beside them: the "apply one line" row. */
const BOXES_AND_BALL = [...BOXES, 'ball = Body(Circle((-22, 0.4), 0.3))'];
/** 300 boxes in 15 rows of 20, dropped at once on the ground. */
const PILE = ['g = Ground()', 'boxes = Bodies(Seq(Box((1.25 mod(k, 20) - 12, 1.5 + 1.25 floor(k / 20)), 1, 1), k, 0, 299))'];
/** 900 boxes at rest (they sleep) and 100 balls that start 300 m up (`range` lets them be there): 100 fall while 900 sleep. */
const MOST_ASLEEP = [
  'g = Ground()',
  'world with range = 400',
  'boxes = Bodies(Seq(Box((1.2 mod(k, 60) - 35, 0.5 + 1.1 floor(k / 60)), 1, 1), k, 0, 899))',
  'rain = Bodies(Seq(Circle((1.1 mod(k, 50) - 27, 300 + 1.1 floor(k / 50)), 0.3), k, 0, 99))',
];
/** 200 links of 0.2 m in a chain from a wall, hanging 40 m down and swung sideways, none allowed to sleep. */
const CHAIN = [
  'world with sleep = false',
  'wall = Box((0, 46), 1, 1)',
  'wall with solid = true',
  'links = Bodies(Seq(Box((0, 44.9 - 0.2 (k - 1)), 0.08, 0.2), k, 1, 200), speed = (2, 0))',
  'top = Hinge(wall, links[1], (0, 45))',
  'joints = Seq(Hinge(links[k - 1], links[k], (0, 45 - 0.2 (k - 1))), k, 2, 200)',
];
/** The same 200 links of 0.25 m let go level from a wall, 50 m long: they whip down and fold on themselves. */
const CHAIN_LEVEL = [
  'wall = Box((-26, 40), 1, 1)',
  'wall with solid = true',
  'links = Bodies(Seq(Box((-24.875 + 0.25 (k - 1), 40), 0.25, 0.08), k, 1, 200))',
  'top = Hinge(wall, links[1], (-25, 40))',
  'joints = Seq(Hinge(links[k - 1], links[k], (-25 + 0.25 (k - 1), 40)), k, 2, 200)',
];
/** A car on a curve cut into 2,000 ground pieces (a domain of 300 m at 8 pieces a metre). */
const CAR_ON_HILLS = [
  'world with range = 150',
  'hills(x) = 1.5 sin(0.12 x) + 0.8 sin(0.31 x)',
  'hills with solid = true',
  'chassis = Body(Box((0, 5), 3, 0.6), mass = 400)',
  'front = Wheel(chassis, (1.1, 4.2), 0.45)',
  'back = Wheel(chassis, (-1.1, 4.2), 0.45)',
  'car = Vehicle(chassis, [front, back], motor = 0.6)',
];
/** 100 boxes in space, in a 10 × 10 grid at three heights, falling and landing, none allowed to sleep. */
const BOXES3 = ['g = Ground()', 'world with sleep = false', 'boxes = Bodies(Seq(Box((1.3 mod(k, 10) - 6, 1.3 floor(k / 10) - 6, 2 + 1.2 mod(k, 3)), 1, 1, 1), k, 0, 99))'];

/** Frames of 1/60 s from 0 to `seconds`: the mean of each film second, the slowest of those, the 95% frame and the worst frame, ms. */
function perSecond(f: Figure, seconds: number): { slowest: number; mean: number; p95: number; worst: number; means: number[] } {
  const means: number[] = [];
  const all: number[] = [];
  for (let s = 0; s < seconds; s++) {
    let sum = 0;
    for (let k = 1; k <= 60; k++) {
      const a = performance.now();
      f.setClock((s * 60 + k) / 60);
      const dt = performance.now() - a;
      sum += dt;
      all.push(dt);
    }
    means.push(sum / 60);
  }
  const sortedAll = sorted(all);
  return {
    slowest: Math.max(...means),
    mean: all.reduce((a, b) => a + b, 0) / all.length,
    p95: sortedAll[Math.floor(sortedAll.length * 0.95)] as number,
    worst: sortedAll[sortedAll.length - 1] as number,
    means,
  };
}

/** 100 seeks to times spread over a 60 s film, in a fixed order that jumps back and forth: each seek's ms. */
function seeks(f: Figure): number[] {
  const times: number[] = [];
  for (let i = 0; i < 100; i++) {
    const t = ((i * 37) % 100) * 0.59 + 0.3;
    const a = performance.now();
    f.setClock(t);
    times.push(performance.now() - a);
  }
  return sorted(times);
}

describe('bodies (design 11.2)', () => {
  it('apply one physics line: `ball with bounce = 0.9` in a figure with 300 bodies, the median of 50 under 0.25 ms (Node)', { retry: 2 }, () => {
    const f = load(BOXES_AND_BALL);
    for (let k = 1; k <= 20 * 60; k++) f.setClock(k / 60);
    expect(physicsOf(f).world?.awakeCount()).toBeLessThan(5);
    const ms: number[] = [];
    const after: number[] = [];
    for (let k = 0; k < 50; k++) {
      const t = performance.now();
      const r = f.apply(`ball with bounce = ${k % 2 === 0 ? 0.9 : 0.91}`);
      const t1 = performance.now();
      f.flush();
      ms.push(t1 - t);
      after.push(performance.now() - t1);
      expect(r.ok).toBe(true);
    }
    const s = sorted(ms);
    const a = sorted(after);
    console.log(
      `one line in a figure with 300 bodies: apply median ${(s[25] as number).toFixed(3)} ms, 95% ${(s[47] as number).toFixed(3)} ms, worst ${(s[49] as number).toFixed(3)} ms (budget 0.25 ms); the flush after it: median ${(a[25] as number).toFixed(3)} ms, worst ${(a[49] as number).toFixed(3)} ms`,
    );
    expect(s[25]).toBeLessThan(0.25);
  });

  it('2D pile-up: 300 boxes dropped at once, the slowest second of the film averages under 1.5 ms a frame (Node)', { retry: 2 }, () => {
    const f = load(PILE);
    const r = perSecond(f, 30);
    console.log(`2D pile-up, 300 boxes: slowest second ${r.slowest.toFixed(3)} ms (second ${r.means.indexOf(r.slowest)}), mean ${r.mean.toFixed(3)} ms, 95% ${r.p95.toFixed(3)} ms, worst ${r.worst.toFixed(2)} ms (budget 1.5 ms)`);
    expect(physicsOf(f).world?.n).toBe(301);
    expect(r.slowest).toBeLessThan(1.5);
  });

  it('2D, most asleep: 1,000 bodies of which 900 slept and 100 fall, a frame under 0.75 ms (Node)', { retry: 2 }, () => {
    const f = load(MOST_ASLEEP);
    for (let k = 1; k <= 4 * 60; k++) f.setClock(k / 60);
    const w = physicsOf(f).world;
    // the balls have been falling for 4 s (78 m of 300): 900 boxes are asleep, 100 balls awake
    const awake = w?.awakeCount() ?? -1;
    expect(awake).toBeGreaterThanOrEqual(100);
    expect(awake).toBeLessThan(110);
    const r = frames(f, 4, 7);
    console.log(`2D, 900 asleep and 100 falling: mean ${r.mean.toFixed(3)} ms, 95% ${r.p95.toFixed(3)} ms, worst ${r.worst.toFixed(3)} ms, awake ${w?.awakeCount()} (budget 0.75 ms)`);
    expect(r.mean).toBeLessThan(0.75);
  });

  it('2D chain of hinges: 200 links from a wall, a frame under 1 ms (Node)', { retry: 2 }, () => {
    const f = load(CHAIN);
    const r = frames(f, 0, 20);
    console.log(`2D chain of 200 hinged links: mean ${r.mean.toFixed(3)} ms, 95% ${r.p95.toFixed(3)} ms, worst ${r.worst.toFixed(3)} ms, joints ${physicsOf(f).world?.joints.length} (budget 1 ms)`);
    expect(physicsOf(f).world?.joints.length).toBe(200);
    expect(r.mean).toBeLessThan(1);
  });

  it('2D chain of hinges, let go level: the same 200 links whipping down from a wall, a frame under 1 ms (Node)', () => {
    const f = load(CHAIN_LEVEL);
    const r = frames(f, 0, 8);
    console.log(`2D chain of 200 hinged links let go level, 8 s: mean ${r.mean.toFixed(3)} ms, 95% ${r.p95.toFixed(3)} ms, worst ${r.worst.toFixed(3)} ms (budget 1 ms)`);
    expect(r.mean).toBeLessThan(1);
  }, 240_000);

  it('2D car on hills: a curve of 2,000 ground pieces, a frame under 0.12 ms (Node)', { retry: 2 }, () => {
    const f = load(CAR_ON_HILLS);
    f.setClock(1 / 60);
    const w = physicsOf(f).world;
    expect(w?.shapes.length).toBeGreaterThanOrEqual(2000);
    const r = frames(load(CAR_ON_HILLS), 2, 30);
    console.log(`2D car on 2,000 ground pieces: mean ${r.mean.toFixed(4)} ms, 95% ${r.p95.toFixed(4)} ms, worst ${r.worst.toFixed(3)} ms (budget 0.12 ms)`);
    expect(r.mean).toBeLessThan(0.12);
  });

  it('3D boxes, all awake: 100 boxes falling and landing, a frame under 1.5 ms (Node)', { retry: 2 }, () => {
    const f = load(BOXES3);
    const r = perSecond(f, 10);
    const w = physics3Of(f).world;
    console.log(`3D, 100 boxes, none asleep: slowest second ${r.slowest.toFixed(3)} ms, mean ${r.mean.toFixed(3)} ms, 95% ${r.p95.toFixed(3)} ms, worst ${r.worst.toFixed(3)} ms, awake at 10 s ${w?.awakeCount()} (budget 1.5 ms)`);
    expect(w?.awakeCount()).toBe(100);
    expect(r.mean).toBeLessThan(1.5);
  });

  it('seek anywhere in a 60 s film with 300 bodies, warm: the 95% seek of 100 under 25 ms (Node)', () => {
    const f = load(PILE);
    for (let k = 1; k <= 60 * 60; k++) f.setClock(k / 60);
    const s = seeks(f);
    console.log(`seek, 300 bodies: median ${(s[50] as number).toFixed(1)} ms, 95% ${(s[95] as number).toFixed(1)} ms, worst ${(s[99] as number).toFixed(1)} ms (budget 25 ms)`);
    expect(s[95]).toBeLessThan(25);
  });

  it('restart at 60 s with 300 bodies: the first frame after it under 16 ms, the world back at its start within 60 frames (Node)', { retry: 2 }, () => {
    const f = load(PILE);
    for (let k = 1; k <= 60 * 60; k++) f.setClock(k / 60);
    // the start of the same film, played in another figure
    const fresh = load(PILE);
    for (let k = 1; k <= 60; k++) fresh.setClock(k / 60);
    const b0 = fresh.value('boxes') as { y: number }[];
    const r = f.apply('Restart()');
    expect(r.ok).toBe(true);
    let first = 0;
    let frame = 0;
    for (; frame < 60; frame++) {
      const a = performance.now();
      f.setClock(60 + (frame + 1) / 60);
      if (frame === 0) first = performance.now() - a;
    }
    const b1 = f.value('boxes') as { y: number }[];
    // after 60 frames the world is where the fresh film is after its first second
    let worstDy = 0;
    for (let i = 0; i < b0.length; i++) worstDy = Math.max(worstDy, Math.abs((b1[i] as { y: number }).y - (b0[i] as { y: number }).y));
    console.log(`restart at 60 s, 300 bodies: first frame ${first.toFixed(2)} ms, behind after 60 frames: ${f.driversNeedFrames()}, the worst box differs from a fresh film's first second by ${worstDy.toExponential(2)} m`);
    expect(first).toBeLessThan(16);
    expect(f.driversNeedFrames()).toBe(false);
    // (the reset lands on a step of the grid, so the two films are not the same to the bit: they must be the same film to a few millimetres)
    expect(worstDy).toBeLessThan(0.05);
  });
});

/* ------------------------------ formulas on the exact maths (design 10.2 item 4; round 10, task 10.5) ------------------------------ */

/** 300 boxes pushed by a force rule that reads the clock through `sin` and `cos`, never asleep. */
const FORCE_RULE = (() => {
  const l = ['g = Ground()', 'world with sleep = false'];
  for (let k = 0; k < 300; k++) l.push(`b${k} = Body(Box((${(1.25 * (k % 20) - 12).toFixed(2)}, ${(0.5 + 1.25 * Math.floor(k / 20)).toFixed(2)}), 1, 1))`, `b${k} with force = (3 sin(t), 2 cos(2 t))`);
  return l;
})();

describe('formulas on the exact maths (design 10.2 item 4)', () => {
  it('a force rule with sin and cos on 300 bodies runs within 10% of the time it takes on the platform maths', { retry: 2 }, () => {
    const run = (exact: boolean): number => {
      setExactMath(exact);
      try {
        // the same film in each: mean of a frame over 6 s after 1 s
        return frames(load(FORCE_RULE), 1, 7).mean;
      } finally {
        setExactMath(true);
      }
    };
    // alternate the two three times and keep the least of each, so the machine's drift is not counted
    let exact = Infinity;
    let platform = Infinity;
    for (let k = 0; k < 3; k++) {
      platform = Math.min(platform, run(false));
      exact = Math.min(exact, run(true));
    }
    console.log(`force = (3 sin(t), 2 cos(2 t)) on 300 bodies: a frame ${exact.toFixed(3)} ms on the exact maths, ${platform.toFixed(3)} ms on the platform's (${((100 * exact) / platform - 100).toFixed(1)}%)`);
    expect(exact).toBeLessThan(platform * 1.1);
  });

  it('the same formulas on 200,000 calls of each function: the time of the exact maths against the platform', () => {
    const lib = { exact: getMathLib() };
    const xs = Array.from({ length: 1000 }, (_, i) => 0.001 + i * 0.0137);
    const names = ['sin', 'cos', 'tan', 'atan', 'exp', 'log', 'sinh', 'pow'] as const;
    const rows: string[] = [];
    for (const n of names) {
      const time = (m: typeof Math): number => {
        let sink = 0;
        const t = performance.now();
        for (let r = 0; r < 200; r++) {
          for (let i = 0; i < xs.length; i++) {
            const x = xs[i] as number;
            sink += n === 'pow' ? m.pow(x, 1.7) : (m[n] as (x: number) => number)(x * 0.1);
          }
        }
        if (Number.isNaN(sink)) throw new Error('NaN');
        return performance.now() - t;
      };
      const best = (m: typeof Math): number => Math.min(time(m), time(m), time(m));
      const e = best(lib.exact as unknown as typeof Math);
      const p = best(Math);
      rows.push(`${n} ${((e * 1e6) / 200000).toFixed(0)} ns against ${((p * 1e6) / 200000).toFixed(0)} ns`);
    }
    console.log(`per call, exact against platform: ${rows.join(', ')}`);
  });
});
