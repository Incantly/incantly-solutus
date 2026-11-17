/**
 * Physics benchmarks against docs/features/physics/design.md 11.2, Node column (a quarter of the budget).
 *
 * Run: `npx vitest run --config packages/kernel/bench/vitest.config.ts packages/kernel/bench/physics.bench.ts`. Each
 * case is a test that fails when it misses its target. A frame is 1/60 s of film: two steps of 1/120 s, the driver's
 * reading of its inputs and the writing of the cells it owns.
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import type { Water2 } from '../src/physics/water2';
import { WaterForces } from '../src/physics/water2';
import type { World2 } from '../src/physics/world2';
import { CommandRegistry, Figure, geometry, physics3Of, physicsOf, registerAnimation, registerFunctions, registerLists, registerNumbers, registerPhysics, registerSpace } from '../src/index';

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
