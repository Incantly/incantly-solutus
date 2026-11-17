/**
 * Terrain slabs (physics design 11.2, the 3D car row): a triangle's slab is written into one reused shape, to the last
 * bit the hull a new shape would be, so a long drive keeps no shape per triangle met and its worst frame stays short.
 */
import { describe, expect, it } from 'vitest';
import { terrainSlabForTest } from '../../src/physics/world3';
import { CommandRegistry, Figure, geometry, physics3Of, registerAnimation, registerFunctions, registerLists, registerNumbers, registerPhysics, registerSpace } from '../../src/index';

const grid = (nx: number, ny: number): { x0: number; y0: number; dx: number; dy: number; nx: number; ny: number; h: Float64Array } => {
  const h = new Float64Array((nx + 1) * (ny + 1));
  // a seeded walk of heights, so the triangles lean every way
  let s = 12345;
  for (let k = 0; k < h.length; k++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    h[k] = (s / 2147483648 - 0.5) * 3;
  }
  h[7] = Number.NaN;
  return { x0: -3.7, y0: 1.3, dx: 0.234375, dy: 0.3125, nx, ny, h };
};

describe('a terrain triangle written into the reused slab', () => {
  it('is the new hull to the last bit, for every triangle of a grid', () => {
    const g = grid(8, 6);
    let n = 0;
    for (let i = 0; i < g.nx; i++) {
      for (let j = 0; j < g.ny; j++) {
        for (let t = 0; t < 2; t++) {
          const fresh = terrainSlabForTest(g, i, j, t, false);
          const reused = terrainSlabForTest(g, i, j, t, true);
          expect(reused).toEqual(fresh);
          if (fresh) n++;
        }
      }
    }
    // the cells touching the undefined corner have no slab
    expect(n).toBeGreaterThan(80);
    expect(n).toBeLessThan(96);
  });
});

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
const CAR = [
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
const load = (): Figure => {
  const f = new Figure({ commands: REG });
  for (const l of CAR) {
    const r = f.apply(l);
    if (!r.ok) throw new Error(l);
  }
  return f;
};

describe('a car driving over terrain', () => {
  it('seek equals play, and the terrain keeps one slab shape whatever ground it crossed', () => {
    const f = load();
    for (let k = 1; k <= 240; k++) f.setClock(k / 60);
    const played = f.value('chassis') as { x: number; y: number; z: number; q: readonly number[] };
    const g = load();
    g.setClock(4);
    const sought = g.value('chassis') as typeof played;
    expect([sought.x, sought.y, sought.z, ...sought.q]).toEqual([played.x, played.y, played.z, ...played.q]);
    const shapes = (physics3Of(f).world?.shapes ?? []) as unknown as { hf?: Record<string, unknown> }[];
    const hf = shapes.find((s) => s.hf)?.hf;
    expect(hf).toBeDefined();
    // no map of slabs that grows with the ground driven over
    expect(Object.values(hf ?? {}).some((v) => v instanceof Map)).toBe(false);
  });
});
