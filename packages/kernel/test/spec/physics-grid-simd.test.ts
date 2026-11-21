/**
 * Which build of the Rust loops the grid in space runs (docs/features/physics/design.md 11.6 round 2; finding PH-49).
 *
 * `physicsGridSimd(figure)` tells whether the figure's grids in space run the build with SIMD, `physicsGridSimd()` whether a
 * grid built now would, and `setPhysicsGridSimd(on)` chooses. The film is the same bits with the SIMD build, the scalar build
 * and the TypeScript loops (11.6: "the film is the same bits with the kernels off, on, and on with SIMD").
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, geometry, initPhysicsKernels, physicsGridSimd, physicsKernelsActive, registerAnimation, registerFunctions, registerLists, registerNumbers, registerPhysics, registerSpace, setPhysicsGridSimd, setPhysicsKernels } from '../../src/index';

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

afterEach(() => {
  setPhysicsKernels(true);
  setPhysicsGridSimd(true);
});

const make = (lines: readonly string[]): Figure => {
  const g = new Figure({ commands: REG });
  for (const l of lines) {
    const r = g.apply(l);
    if (!r.ok) throw new Error(`${l}: ${(r as { message: string }).message}`);
  }
  return g;
};

const FIRE = ['fire = Fire((0, 0, 0))'];
const PROBES = [
  'fire_t0 = fire.temperature(0, 0, 0.3)',
  'fire_t1 = fire.temperature(0.1, 0, 0.9)',
  'fire_t2 = fire.temperature(0.2, 0.1, 1.5)',
  'fire_fuel = fire.fuel',
  'fire_mass = fire.mass',
  'fire_speed = fire.speed',
  'fire_d0 = fire.at(0, 0, 0.6)',
  'fire_d1 = fire.at(0.1, 0, 1.4)',
];
const NAMES = PROBES.map((p) => p.slice(0, p.indexOf(' =')));

/** The film of a fire 24³ from the start, a frame of 1/60 s at a time: the readouts and the grid's arrays, every second up to `seconds`. */
const film = (setup: () => void, seconds: number): { fig: Figure; rows: unknown[] } => {
  setup();
  const fig = make([...FIRE, ...PROBES]);
  const rows: unknown[] = [];
  for (let k = 1; k <= seconds * 60; k++) {
    fig.setClock(k / 60);
    if (k % 60 === 0) {
      const v = fig.value('fire') as { density?: ArrayLike<number>; temp?: ArrayLike<number> };
      rows.push({ t: k / 60, values: NAMES.map((n) => fig.value(n)), density: Array.from(v.density ?? []), temp: Array.from(v.temp ?? []) });
    }
  }
  return { fig, rows };
};

describe('the SIMD build of the grid in space (PH-49)', () => {
  it('a fire 24³ plays the same film, every second, with SIMD, without it, and with the kernels off', () => {
    const wide = film(() => {
      setPhysicsKernels(true);
      setPhysicsGridSimd(true);
    }, 4);
    const scalar = film(() => {
      setPhysicsKernels(true);
      setPhysicsGridSimd(false);
    }, 4);
    const plain = film(() => {
      setPhysicsKernels(false);
      setPhysicsGridSimd(true);
    }, 4);
    expect(physicsGridSimd(wide.fig)).toBe(true);
    expect(physicsGridSimd(scalar.fig)).toBe(false);
    expect(physicsGridSimd(plain.fig)).toBe(false);
    // the film moved: the fire has burnt and smoke has risen
    expect(wide.rows).toHaveLength(4);
    expect((wide.rows[3] as { density: number[] }).density.some((d) => d > 0)).toBe(true);
    expect(scalar.rows).toEqual(wide.rows);
    expect(plain.rows).toEqual(wide.rows);
  });

  it('the figure says which build it runs, and the module says whether a new grid would use SIMD', async () => {
    await initPhysicsKernels();
    setPhysicsKernels(true);
    setPhysicsGridSimd(true);
    expect(physicsGridSimd()).toBe(true);
    const on = make(FIRE);
    on.setClock(1 / 60);
    expect(physicsKernelsActive(on)).toBe(true);
    expect(physicsGridSimd(on)).toBe(true);
    setPhysicsGridSimd(false);
    expect(physicsGridSimd()).toBe(false);
    // a grid made before the switch keeps its build; one made after it runs the scalar build, still in Rust
    expect(physicsGridSimd(on)).toBe(true);
    const off = make(FIRE);
    off.setClock(1 / 60);
    expect(physicsKernelsActive(off)).toBe(true);
    expect(physicsGridSimd(off)).toBe(false);
    setPhysicsGridSimd(true);
    setPhysicsKernels(false);
    expect(physicsGridSimd()).toBe(false);
  });

  it('a figure with no grid in space has no answer', () => {
    const none = make(['g = Ground()', 'b = Body(Box((0, 0, 1), 1, 1, 1), mass = 1)']);
    expect(physicsGridSimd(none)).toBeUndefined();
    const plane = make(['fire = Fire((0, 0))']);
    expect(physicsGridSimd(plane)).toBeUndefined();
  });
});
