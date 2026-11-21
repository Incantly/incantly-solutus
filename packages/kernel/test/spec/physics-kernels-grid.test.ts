/**
 * The grid in space in Rust (.kiro/specs/physics task 10.10; docs/features/physics/design.md 9.8, 10.4, 11.2, 11.6 "As built, round 2",
 * finding PH-35).
 *
 * What the docs promise and these tests check, from the public API only (`setPhysicsKernels`, `initPhysicsKernels`,
 * `physicsKernelsActive`, `Figure` and the readouts of `Smoke` and `Fire`):
 * - "The same bits" (11.6 round 1 and round 2): a figure with a grid in space plays the same film with the kernels on and off, every
 *   readout equal to the last bit, every second. The TypeScript loops stay "as the fallback and the reference".
 * - "The film is the same bits with the kernels off, on, and on with SIMD": SIMD is chosen by the engine (`setPhysicsGridSimd` is not in
 *   the public API), so the "on" film here is whichever build Node picks.
 * - `physicsKernelsActive(figure)` "also asks the grid": true for a figure with only a grid in space, false with the switch off.
 * - Seek equals play (10.4) with the kernels on, over checkpoints every 1 s (10.3, 9.8).
 * - With no WebAssembly the grid runs on the TypeScript loops, with the same film (11.6 "the fallback").
 * - The grid in the plane is not touched by the grid in space (9.8: "one grid in space per figure"; 11.6 lists only the grid in space).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandRegistry, Figure, geometry, initPhysicsKernels, physicsKernelsActive, registerAnimation, registerFunctions, registerLists, registerNumbers, registerPhysics, registerSpace, setPhysicsKernels } from '../../src/index';

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
  vi.unstubAllGlobals();
  setPhysicsKernels(true);
});

const all = (lines: readonly string[], fig: Figure): void => {
  for (const l of lines) {
    const r = fig.apply(l);
    if (!r.ok) throw new Error(`${l}: ${(r as { message: string }).message}`);
  }
};
const make = (lines: readonly string[]): Figure => {
  const g = new Figure({ commands: REG });
  all(lines, g);
  return g;
};
/** Plays the film in frames of 1/60 s up to t. */
const play = (fig: Figure, t: number): void => {
  const now = fig.clock().t;
  const frames = Math.round((t - now) * 60);
  for (let k = 1; k <= frames; k++) fig.setClock(now + k / 60);
};
/** One jump of the clock (a seek), letting a driver that needs frames have them (10.4: a far seek catches up over frames). */
const seek = (fig: Figure, t: number): void => {
  fig.setClock(t);
  for (let k = 0; k < 400 && fig.driversNeedFrames(); k++) fig.flush(true);
};

interface Scene {
  readonly name: string;
  readonly lines: readonly string[];
  /** Lines that define readouts: `name = expression`. */
  readonly probes: readonly string[];
  /** Objects whose whole arrays are compared too (cloth points, drops, a grid's `density` and `temp`). */
  readonly arrays: readonly string[];
}

const BOX3 = 'Box((0, 0, 1.5), 3, 3, 3)';
const SRC3 = 'source = Sphere((0, 0, 0.3), 0.3)';
const WOOD3 = 'Box((0.25, 0, 0.1), 0.5, 0.5, 0.2)';
/** A closed jar: six thick walls round a 2.4 m room, inside a grid of 4 m a side. */
const JAR = (() => {
  const walls = [
    ['jx0', '(-1.45, 0, 2), 0.5, 3.4, 3.4'],
    ['jx1', '(1.45, 0, 2), 0.5, 3.4, 3.4'],
    ['jy0', '(0, -1.45, 2), 3.4, 0.5, 3.4'],
    ['jy1', '(0, 1.45, 2), 3.4, 0.5, 3.4'],
    ['jz0', '(0, 0, 0.55), 3.4, 3.4, 0.5'],
    ['jz1', '(0, 0, 3.45), 3.4, 3.4, 0.5'],
  ] as const;
  return walls.flatMap(([n, a]) => [`${n} = Box(${a})`, `${n} with solid = true`]);
})();
const JAR_BOX = 'Box((0, 0, 2), 4, 4, 4)';

/** Readouts of a fire in space: temperature at four places, fuel, burning, mass, speed, and the smoke at two places. */
const fireProbes = (n: string): string[] => [
  `${n}_t0 = ${n}.temperature(0, 0, 0.3)`,
  `${n}_t1 = ${n}.temperature(0.1, 0, 0.9)`,
  `${n}_t2 = ${n}.temperature(0.2, 0.1, 1.5)`,
  `${n}_t3 = ${n}.temperature(-0.3, 0.2, 2.2)`,
  `${n}_fuel = ${n}.fuel`,
  `${n}_burning = ${n}.burning`,
  `${n}_mass = ${n}.mass`,
  `${n}_speed = ${n}.speed`,
  `${n}_d0 = ${n}.at(0, 0, 0.6)`,
  `${n}_d1 = ${n}.at(0.1, 0, 1.4)`,
];
/** Readouts of a smoke in space. */
const smokeProbes = (n: string): string[] => [
  `${n}_d0 = ${n}.at(0, 0, 0.5)`,
  `${n}_d1 = ${n}.at(0.3, 0, 1.2)`,
  `${n}_d2 = ${n}.at(-0.5, 0.2, 1.8)`,
  `${n}_d3 = ${n}.at(0.9, 0, 1.5)`,
  `${n}_mass = ${n}.mass`,
  `${n}_speed = ${n}.speed`,
];
/** Corners and middle of a cloth, `nu` by `nv` points, and its torn and burnt counts. */
const clothProbes = (c: string, nu: number, nv: number): string[] => [
  `${c}_a = ${c}.at(1, 1)`,
  `${c}_b = ${c}.at(${Math.ceil(nu / 2)}, ${Math.ceil(nv / 2)})`,
  `${c}_c = ${c}.at(${nu}, ${nv})`,
  `${c}_d = ${c}.at(${Math.ceil(nu / 4)}, ${Math.ceil((3 * nv) / 4)})`,
  `${c}_n = ${c}.torn`,
];
const bodyProbes = (b: string): string[] => [`${b}_x = ${b}.x`, `${b}_y = ${b}.y`, `${b}_z = ${b}.z`];
const burnProbes = (b: string): string[] => [`${b}_tm = ${b}.temperature`, `${b}_burnt = ${b}.burnt`, `${b}_burning = ${b}.burning`];

const FLAG3 = 'flag = Cloth((-0.8, -0.5, 2), (1.6, 0, 0), (0, 1, 0), 12, 8, mass = 0.1, pins = "left")';

/** The figures of the task: fire 24³, fire 32³, a flag over a fire, a burning crate, smoke round a ball in wind, a liquid on a fire whose source stopped, swirl 10 in a box, n = 4 and 5, a 2D fire. */
const SCENES: readonly Scene[] = [
  { name: 'a fire 24³ (Fire((0, 0, 0)))', lines: ['fire = Fire((0, 0, 0))'], probes: fireProbes('fire'), arrays: ['fire'] },
  {
    name: 'a fire 32³ on the floor',
    lines: ['g = Ground()', `fire = Fire(Box((0, 0, 1.5), 3, 3, 3), 32, ${SRC3})`],
    probes: fireProbes('fire'),
    arrays: ['fire'],
  },
  {
    name: 'a flag over a fire',
    lines: ['g = Ground()', `fire = Fire(${BOX3}, 24, ${SRC3})`, FLAG3],
    probes: [...fireProbes('fire'), ...clothProbes('flag', 12, 8)],
    arrays: ['fire', 'flag'],
  },
  {
    name: 'a burning crate (burns = 10, still burning at 5 s)',
    lines: ['g = Ground()', `fire = Fire(${BOX3}, 24, ${SRC3})`, `crate = Body(${WOOD3}, mass = 1, burns = 10)`],
    probes: [...fireProbes('fire'), ...bodyProbes('crate'), ...burnProbes('crate')],
    arrays: ['fire'],
  },
  {
    name: 'a crate that burns away (burns = 2) and leaves the world',
    lines: ['g = Ground()', `fire = Fire(${BOX3}, 24, ${SRC3})`, `crate = Body(${WOOD3}, mass = 0.5, burns = 2)`, 'ball = Body(Sphere((0.25, 0, 0.55), 0.15), mass = 0.2)'],
    probes: [...fireProbes('fire'), ...bodyProbes('crate'), ...burnProbes('crate'), ...bodyProbes('ball')],
    arrays: ['fire'],
  },
  {
    name: 'smoke round a solid ball in wind',
    lines: ['ball = Sphere((0, 0, 1.5), 0.5)', 'ball with solid = true', `sm = Smoke(${BOX3}, 20, source = Sphere((-1, 0, 1.5), 0.3), heat = 0, wind = (2, 0, 0))`],
    probes: smokeProbes('sm'),
    arrays: ['sm'],
  },
  {
    name: 'smoke in wind with a ball moving through it',
    lines: ['sm = Smoke(Box((0, 0, 2), 4, 4, 4), 24, source = Sphere((-1.4, 0, 2), 0.3), heat = 1, wind = (1.5, 0, 0.3))', 'ball = Body(Sphere((-0.5, 0.1, 3), 0.4), density = 0.5)'],
    probes: [...smokeProbes('sm'), ...bodyProbes('ball')],
    arrays: ['sm'],
  },
  {
    name: 'a liquid dousing a fire whose source stopped (until = 1)',
    lines: ['g = Ground()', `fire = Fire(${BOX3}, 24, ${SRC3}, until = 1)`, 'rain = Liquid(Box((0, 0, 2.2), 0.8, 0.8, 0.5), 300)'],
    probes: [...fireProbes('fire'), 'rain_n = rain.count', 'rain_level = rain.level'],
    arrays: ['fire', 'rain'],
  },
  {
    name: 'swirl 10 in a closed box',
    lines: [...JAR, `sm = Smoke(${JAR_BOX}, 16, source = Sphere((0, 0, 1.4), 0.4), heat = 5, until = 0.5, swirl = 10)`],
    probes: ['sm_d0 = sm.at(0, 0, 1.4)', 'sm_d1 = sm.at(0.2, 0, 2)', 'sm_d2 = sm.at(-0.3, 0.1, 2.6)', 'sm_mass = sm.mass', 'sm_speed = sm.speed'],
    arrays: ['sm'],
  },
  {
    name: 'a fire with swirl 10',
    lines: ['g = Ground()', `fire = Fire(${BOX3}, 16, ${SRC3}, swirl = 10)`],
    probes: fireProbes('fire'),
    arrays: ['fire'],
  },
  { name: 'a fire with n = 4', lines: [`fire = Fire(${BOX3}, 4, ${SRC3})`], probes: fireProbes('fire'), arrays: ['fire'] },
  { name: 'a fire with n = 5', lines: ['g = Ground()', `fire = Fire(${BOX3}, 5, ${SRC3})`], probes: fireProbes('fire'), arrays: ['fire'] },
  { name: 'a smoke with n = 4', lines: [`sm = Smoke(${BOX3}, 4, source = Sphere((0, 0, 0.6), 0.4), heat = 3)`], probes: smokeProbes('sm'), arrays: ['sm'] },
  { name: 'a smoke with n = 5 round a solid ball', lines: ['ball = Sphere((0, 0, 1.6), 0.4)', 'ball with solid = true', `sm = Smoke(${BOX3}, 5, source = Sphere((0, 0, 0.6), 0.4), heat = 3, wind = (0.5, 0, 0))`], probes: smokeProbes('sm'), arrays: ['sm'] },
  {
    name: 'a fire in the plane (Fire((0, 0)))',
    lines: ['fire = Fire((0, 0))'],
    probes: [
      'fire_t0 = fire.temperature(0, 0.05)',
      'fire_t1 = fire.temperature(0, 0.6)',
      'fire_t2 = fire.temperature(0.1, 1.5)',
      'fire_t3 = fire.temperature(-0.2, 2.5)',
      'fire_fuel = fire.fuel',
      'fire_burning = fire.burning',
      'fire_mass = fire.mass',
      'fire_speed = fire.speed',
      'fire_d0 = fire.at(0, 0.8)',
      'fire_d1 = fire.at(0.1, 1.8)',
    ],
    arrays: ['fire'],
  },
  {
    name: 'a fire in the plane with a log that burns and a rope',
    lines: [
      'g = Ground()',
      'fire = Fire(Box((0, 2), 4, 4), 48, source = Circle((0, 0.3), 0.3))',
      'wood = Body(Box((0.3, 0.2), 0.8, 0.2), mass = 1, burns = 3)',
      'rope = Cloth((-1.5, 3), (-0.5, 3), 12, mass = 0.05, pins = [(-1.5, 3)])',
    ],
    probes: [
      'fire_t0 = fire.temperature(0, 0.3)',
      'fire_t1 = fire.temperature(0, 1)',
      'fire_t2 = fire.temperature(0.2, 2)',
      'fire_fuel = fire.fuel',
      'fire_burning = fire.burning',
      'fire_mass = fire.mass',
      'fire_d0 = fire.at(0, 1.2)',
      'wood_x = wood.x',
      'wood_y = wood.y',
      ...burnProbes('wood'),
      'rope_a = rope.at(6, 1)',
      'rope_b = rope.at(12, 1)',
    ],
    arrays: ['fire', 'rope'],
  },
];

const nameOf = (probe: string): string => probe.slice(0, probe.indexOf(' =')).trim();

/** A readout as a list of labelled values: a point gives its coordinates; anything else is kept as it is. */
const flatten = (label: string, v: unknown, out: Array<[string, unknown]>): void => {
  if (typeof v === 'object' && v !== null && 'x' in v) {
    const p = v as { x: unknown; y: unknown; z?: unknown };
    out.push([`${label}.x`, p.x], [`${label}.y`, p.y]);
    if ('z' in p) out.push([`${label}.z`, p.z]);
  } else out.push([label, v]);
};
const readouts = (fig: Figure, scene: Scene): Array<[string, unknown]> => {
  const out: Array<[string, unknown]> = [];
  for (const p of scene.probes) flatten(nameOf(p), fig.value(nameOf(p)), out);
  return out;
};
const ARRAY_KEYS = ['xs', 'ys', 'zs', 'cut', 'density', 'temp'] as const;
/** The whole arrays of the grids, cloths and liquids (points, drops, torn links, density, temperature), copied. */
const arraysOf = (fig: Figure, scene: Scene): Array<[string, number[]]> => {
  const out: Array<[string, number[]]> = [];
  for (const n of scene.arrays) {
    const v = fig.value(n) as Partial<Record<(typeof ARRAY_KEYS)[number], ArrayLike<number>>>;
    for (const k of ARRAY_KEYS) {
      const a = v[k];
      if (a) out.push([`${n}.${k}`, Array.from(a)]);
    }
  }
  return out;
};

interface Snapshot {
  readonly t: number;
  readonly values: Array<[string, unknown]>;
  readonly arrays: Array<[string, number[]]>;
  /** The kinds of the notices that came in the second before. */
  readonly notices: string[];
}
const snap = (fig: Figure, scene: Scene, t: number, notices: string[] = []): Snapshot => ({ t, values: readouts(fig, scene), arrays: arraysOf(fig, scene), notices });

/** Builds the scene with the switch as given and plays it, taking a snapshot at each whole second. */
const film = (scene: Scene, kernels: boolean, seconds: number): Snapshot[] => {
  setPhysicsKernels(kernels);
  const fig = make([...scene.lines, ...scene.probes]);
  const shots: Snapshot[] = [];
  for (let s = 1; s <= seconds; s++) {
    play(fig, s);
    shots.push(snap(fig, scene, s, fig.takeWarnings().map((w) => w.kind)));
  }
  return shots;
};

const expectSame = (scene: string, a: readonly Snapshot[], b: readonly Snapshot[]): void => {
  expect(a.length, scene).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as Snapshot;
    const y = b[i] as Snapshot;
    expect(x.values.length, `${scene} t=${x.t}: readouts`).toBe(y.values.length);
    for (let k = 0; k < x.values.length; k++) {
      const [label, v] = x.values[k] as [string, unknown];
      expect(v, `${scene} t=${x.t} s ${label}`).toBe((y.values[k] as [string, unknown])[1]);
    }
    expect(x.arrays.map(([l]) => l), `${scene} t=${x.t}: arrays`).toEqual(y.arrays.map(([l]) => l));
    for (let k = 0; k < x.arrays.length; k++) {
      const [label, v] = x.arrays[k] as [string, number[]];
      expect(v, `${scene} t=${x.t} s ${label} (whole array)`).toEqual((y.arrays[k] as [string, number[]])[1]);
    }
    expect(x.notices, `${scene} t=${x.t}: notices`).toEqual(y.notices);
  }
};
/** Same readouts and arrays, not the notices (a sought film has taken its notices at other times). */
const expectSameState = (scene: string, a: Snapshot, b: Snapshot): void => expectSame(scene, [{ ...a, notices: [] }], [{ ...b, notices: [] }]);

/** At least one readout of the scene moved: a film that stands still would make every comparison pass for nothing. */
const moved = (a: Snapshot, b: Snapshot): boolean => a.values.some(([label, v], k) => typeof v === 'number' && v !== (b.values[k] as [string, unknown])[1] && label !== '');

const LONG = 240_000;
const scene = (name: string): Scene => {
  const s = SCENES.find((x) => x.name.startsWith(name));
  if (!s) throw new Error(`no scene ${name}`);
  return s;
};

describe('the same film with the kernels on and off (design 11.6 round 2 "Same rules as round 1": the same bits)', () => {
  for (const sc of SCENES) {
    it(`${sc.name}: 5 s with the kernels on equal 5 s with them off, every second, to the last bit`, async () => {
      expect(await initPhysicsKernels()).toBe(true);
      const on = film(sc, true, 5);
      const off = film(sc, false, 5);
      expectSame(sc.name, on, off);
      // the figure really plays: something moved between the first and the last second
      expect(moved(on[0] as Snapshot, on[4] as Snapshot), `${sc.name} stands still`).toBe(true);
      // every probe reads a value at 1 s (a probe that read `undefined` all the time would make the comparison empty)
      for (const [label, v] of (on[0] as Snapshot).values) expect(v, `${sc.name}: ${label} at 1 s`).not.toBeUndefined();
    }, LONG);
  }

  it('the whole arrays of a grid are part of the comparison: the fire 24³ gives 24³ cells of density and temperature, and they are not all zero', async () => {
    expect(await initPhysicsKernels()).toBe(true);
    const on = film(scene('a fire 24³'), true, 2);
    const arrays = on[1]?.arrays ?? [];
    const temp = arrays.find(([l]) => l === 'fire.temp')?.[1] ?? [];
    const dens = arrays.find(([l]) => l === 'fire.density')?.[1] ?? [];
    expect(temp.length).toBe(24 ** 3);
    expect(dens.length).toBe(24 ** 3);
    expect(Math.max(...temp)).toBeGreaterThan(100);
  }, LONG);

  it('the burning crate burns, and the crate that burns away gives the same notices (`burnt`) on and off', async () => {
    expect(await initPhysicsKernels()).toBe(true);
    const sc = scene('a crate that burns away');
    const on = film(sc, true, 5);
    const off = film(sc, false, 5);
    expectSame(sc.name, on, off);
    const burnt = (shots: Snapshot[]): unknown => shots.at(-1)?.values.find(([l]) => l === 'crate_burnt')?.[1];
    // the crate is lit and burnt more than half or gone by 5 s; either way the two modes agree on it
    expect(burnt(on)).toBe(burnt(off));
    expect(on.some((s) => s.values.some(([l, v]) => l === 'crate_tm' && typeof v === 'number' && v > 150))).toBe(true);
  }, LONG);

  it('the liquid dousing a fire whose source stopped gives the same fire_out notice at the same second on and off', async () => {
    expect(await initPhysicsKernels()).toBe(true);
    const sc = scene('a liquid dousing');
    const on = film(sc, true, 8);
    const off = film(sc, false, 8);
    expectSame(sc.name, on, off);
  }, LONG);
});

describe('a host can tell which loops run: physicsKernelsActive asks the grid too (design 11.6 round 2 "Two blocks")', () => {
  const GRID_ONLY = ['fire = Fire((0, 0, 0))'];

  it('a figure with only a grid in space (a fire) reports true in Node', async () => {
    expect(await initPhysicsKernels()).toBe(true);
    setPhysicsKernels(true);
    const fig = make(GRID_ONLY);
    play(fig, 0.2);
    expect(physicsKernelsActive(fig)).toBe(true);
  });

  it('a figure with only a smoke in space reports true', async () => {
    expect(await initPhysicsKernels()).toBe(true);
    setPhysicsKernels(true);
    const fig = make([`sm = Smoke(${BOX3}, 12, source = Sphere((0, 0, 0.5), 0.3))`]);
    play(fig, 0.2);
    expect(physicsKernelsActive(fig)).toBe(true);
  });

  it('the same figures built with setPhysicsKernels(false) report false', () => {
    setPhysicsKernels(false);
    const fire = make(GRID_ONLY);
    play(fire, 0.2);
    expect(physicsKernelsActive(fire)).toBe(false);
    const smoke = make([`sm = Smoke(${BOX3}, 12, source = Sphere((0, 0, 0.5), 0.3))`]);
    play(smoke, 0.2);
    expect(physicsKernelsActive(smoke)).toBe(false);
  });

  it('a flag over a fire reports true with the switch on and false with it off', async () => {
    expect(await initPhysicsKernels()).toBe(true);
    const lines = ['g = Ground()', `fire = Fire(${BOX3}, 16, ${SRC3})`, FLAG3];
    setPhysicsKernels(true);
    const on = make(lines);
    play(on, 0.2);
    expect(physicsKernelsActive(on)).toBe(true);
    setPhysicsKernels(false);
    const off = make(lines);
    play(off, 0.2);
    expect(physicsKernelsActive(off)).toBe(false);
  });
});

describe('seek equals play with the kernels on (design 10.4, 10.3 checkpoints every 1 s with a grid, 11.6)', () => {
  const FIRE_FLAG_CRATE: Scene = {
    name: 'a fire 24³ with a flag and a crate',
    lines: ['g = Ground()', `fire = Fire(${BOX3}, 24, ${SRC3})`, FLAG3, `crate = Body(${WOOD3}, mass = 1, burns = 6)`],
    probes: [...fireProbes('fire'), ...clothProbes('flag', 12, 8), ...bodyProbes('crate'), ...burnProbes('crate')],
    arrays: ['fire', 'flag'],
  };
  const cases: Scene[] = [scene('a fire 24³'), scene('a flag over a fire'), scene('a burning crate'), FIRE_FLAG_CRATE];

  for (const sc of cases) {
    it(`${sc.name}: a seek straight from 0 to 4 s equals playing to 4 s`, () => {
      setPhysicsKernels(true);
      const played = make([...sc.lines, ...sc.probes]);
      play(played, 4);
      const sought = make([...sc.lines, ...sc.probes]);
      seek(sought, 4);
      expectSameState(sc.name, snap(played, sc, 4), snap(sought, sc, 4));
    }, LONG);
  }

  it('a seek back and forth over the checkpoints (4 → 1 → 4 → 2.5 → 4) gives the film played straight, at each of those times', () => {
    setPhysicsKernels(true);
    const sc = FIRE_FLAG_CRATE;
    const straight = make([...sc.lines, ...sc.probes]);
    const ref = new Map<number, Snapshot>();
    for (const t of [1, 2.5, 4]) {
      play(straight, t);
      ref.set(t, snap(straight, sc, t));
    }
    const fig = make([...sc.lines, ...sc.probes]);
    play(fig, 4);
    for (const t of [1, 4, 2.5, 4]) {
      seek(fig, t);
      expectSameState(`${sc.name} at ${t} s`, ref.get(t) as Snapshot, snap(fig, sc, t));
    }
  }, LONG);

  it('a seek back and forward again in the fire alone (24³) keeps the film, and playing on from the seek is the straight film', () => {
    setPhysicsKernels(true);
    const sc = scene('a fire 24³');
    const straight = make([...sc.lines, ...sc.probes]);
    play(straight, 3);
    const ref3 = snap(straight, sc, 3);
    play(straight, 4);
    const ref4 = snap(straight, sc, 4);
    const fig = make([...sc.lines, ...sc.probes]);
    play(fig, 3);
    seek(fig, 0.5);
    seek(fig, 3);
    expectSameState(sc.name, ref3, snap(fig, sc, 3));
    play(fig, 4);
    expectSameState(sc.name, ref4, snap(fig, sc, 4));
  }, LONG);

  it('a film played with the kernels off and sought to the same time with them on is the same film (fire 24³ with a flag and a crate)', () => {
    const sc = FIRE_FLAG_CRATE;
    setPhysicsKernels(false);
    const played = make([...sc.lines, ...sc.probes]);
    play(played, 3);
    setPhysicsKernels(true);
    const sought = make([...sc.lines, ...sc.probes]);
    seek(sought, 3);
    expectSameState(sc.name, snap(played, sc, 3), snap(sought, sc, 3));
  }, LONG);
});

describe('without WebAssembly the grid runs on the TypeScript loops and gives the kernels-off film (design 11.6 "the fallback")', () => {
  const names = ['a fire 24³', 'a flag over a fire', 'a burning crate', 'smoke round a solid ball', 'a fire with n = 4', 'a smoke with n = 5', 'a fire in the plane (', 'swirl 10 in a closed box'];
  for (const name of names) {
    const sc = scene(name);
    it(`${sc.name}: with WebAssembly undefined and the switch on, a fresh figure plays 3 s equal to the film with the kernels off`, () => {
      const reference = film(sc, false, 3);
      setPhysicsKernels(true);
      vi.stubGlobal('WebAssembly', undefined);
      expect(typeof WebAssembly).toBe('undefined');
      let shots: Snapshot[] = [];
      try {
        expect(() => {
          shots = film(sc, true, 3);
        }).not.toThrow();
      } finally {
        vi.unstubAllGlobals();
      }
      expect(typeof WebAssembly).toBe('object');
      expectSame(sc.name, shots, reference);
      expect(moved(shots[0] as Snapshot, shots[2] as Snapshot), `${sc.name} stands still`).toBe(true);
    }, LONG);
  }

  it('a grid in space built with no WebAssembly still answers physicsKernelsActive without throwing', () => {
    vi.stubGlobal('WebAssembly', undefined);
    let answer: unknown;
    try {
      const fig = make(['fire = Fire((0, 0, 0))']);
      play(fig, 0.2);
      expect(() => {
        answer = physicsKernelsActive(fig);
      }).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
    expect([true, false, undefined]).toContain(answer);
  });
});

describe('a figure built with the switch on and played with it off keeps the film (design 11.6: the switch counts for solvers built after it)', () => {
  it('a fire 24³ built with the kernels on, with the switch off from 2 s, equals the kernels-off film', () => {
    const sc = scene('a fire 24³');
    const reference = film(sc, false, 4);
    setPhysicsKernels(true);
    const fig = make([...sc.lines, ...sc.probes]);
    const shots: Snapshot[] = [];
    for (let s = 1; s <= 4; s++) {
      if (s === 2) setPhysicsKernels(false);
      play(fig, s);
      shots.push(snap(fig, sc, s, fig.takeWarnings().map((w) => w.kind)));
    }
    expectSame(sc.name, shots, reference);
  }, LONG);

  it('two figures at once, one with a grid built with the kernels on and one with them off, play the same film and do not share memory', () => {
    const sc = scene('a flag over a fire');
    setPhysicsKernels(true);
    const a = make([...sc.lines, ...sc.probes]);
    setPhysicsKernels(false);
    const b = make([...sc.lines, ...sc.probes]);
    setPhysicsKernels(true);
    const c = make([...sc.lines, ...sc.probes]);
    const shots: Record<string, Snapshot[]> = { a: [], b: [], c: [] };
    for (let s = 1; s <= 3; s++) {
      // interleaved frame by frame: each figure's grid has its own memory (design 11.6), none may see another's arrays
      const now = a.clock().t;
      for (let k = 1; k <= 60; k++) {
        a.setClock(now + k / 60);
        b.setClock(now + k / 60);
        c.setClock(now + k / 60);
      }
      shots.a?.push(snap(a, sc, s));
      shots.b?.push(snap(b, sc, s));
      shots.c?.push(snap(c, sc, s));
    }
    expectSame('a against b', shots.a as Snapshot[], shots.b as Snapshot[]);
    expectSame('c against b', shots.c as Snapshot[], shots.b as Snapshot[]);
  }, LONG);
});
