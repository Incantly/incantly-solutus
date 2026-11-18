/**
 * Rust kernels (.kiro/specs/physics task 10.9; docs/features/physics/design.md 11.6 "As built", 10.2, 10.4; libraries.md "Build tools").
 *
 * What the docs promise and these tests check, from the public API only (`setPhysicsKernels`, `physicsKernelsOn`,
 * `initPhysicsKernels`, `Figure`):
 * - "The same bits": a figure plays the same film with the kernels on and off, every readout equal to the last bit.
 * - The TypeScript loops are the fallback "(no WebAssembly, or the module did not compile)": with no WebAssembly the cloth still runs,
 *   with the same film, and nothing throws.
 * - Seek equals play (design 10.4) with the kernels on.
 * - `setPhysicsKernels(false)` turns the kernels off "for solvers built after it"; `initPhysicsKernels()` compiles the module for a page's
 *   main thread; without it the TypeScript loops run there "with the same film".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandRegistry, Figure, geometry, initPhysicsKernels, physics, physicsKernelsOn, registerAnimation, registerFunctions, registerLists, registerNumbers, registerPhysics, registerSpace, setPhysicsKernels } from '../../src/index';

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
/** One jump of the clock (a seek), letting a driver that needs frames have them. */
const seek = (fig: Figure, t: number): void => {
  fig.setClock(t);
  for (let k = 0; k < 200 && fig.driversNeedFrames(); k++) fig.flush(true);
};

interface Scene {
  readonly name: string;
  readonly lines: readonly string[];
  /** Lines that define readouts: `name = expression`. */
  readonly probes: readonly string[];
  /** Cloth or liquid objects whose whole arrays are compared too. */
  readonly arrays: readonly string[];
}

const pts = (cloth: string, nu: number, nv: number): string[] => [
  `${cloth}_a = ${cloth}.at(1, 1)`,
  `${cloth}_b = ${cloth}.at(${Math.ceil(nu / 2)}, ${Math.ceil(nv / 2)})`,
  `${cloth}_c = ${cloth}.at(${nu}, ${nv})`,
  `${cloth}_d = ${cloth}.at(${Math.ceil(nu / 4)}, ${Math.ceil((3 * nv) / 4)})`,
  `${cloth}_n = ${cloth}.torn`,
];

/** The eight figures of the task (the first eight) and four more that reach the other kernels. */
const SCENES: readonly Scene[] = [
  {
    name: 'a 3D sheet on a ball',
    lines: ['g = Ground()', 'ball = Sphere((0, 0, 0.6), 0.6)', 'ball with solid = true', 'sheet = Cloth((-1.5, -1.5, 2), (3, 0, 0), (0, 3, 0), 32, 32, mass = 0.6)'],
    probes: pts('sheet', 32, 32),
    arrays: ['sheet'],
  },
  {
    name: 'a flag in wind',
    lines: ['g = Ground()', 'flag = Cloth((0, 0, 3), (3, 0, 0), (0, 0, -2), 24, 16, mass = 0.4, pins = "left")', 'world with wind = (5 + 3 sin(2 t), 1, 0)'],
    probes: pts('flag', 24, 16),
    arrays: ['flag'],
  },
  {
    name: 'a 64 by 32 sheet over boxes',
    lines: [
      'g = Ground()',
      'b1 = Box((-1, 0, 0.4), 0.8, 0.8, 0.8)',
      'b1 with solid = true',
      'b2 = Box((1, 0.5, 0.3), 0.8, 0.8, 0.6)',
      'b2 with solid = true',
      'b3 = Box((0, -0.8, 0.2), 0.6, 0.6, 0.4)',
      'b3 with solid = true',
      'sheet = Cloth((-2, -1.5, 1.6), (4, 0, 0), (0, 3, 0), 64, 32, mass = 0.8)',
    ],
    probes: pts('sheet', 64, 32),
    arrays: ['sheet'],
  },
  {
    name: 'two cloths',
    lines: [
      'g = Ground()',
      'a = Cloth((-1, -1, 1.2), (2, 0, 0), (0, 2, 0), 24, 24, mass = 0.4, pins = "corners")',
      'b = Cloth((-1.2, -1.2, 2), (2.4, 0, 0), (0, 2.4, 0), 24, 24, mass = 0.5, self = true)',
    ],
    probes: [...pts('a', 24, 24), ...pts('b', 24, 24)],
    arrays: ['a', 'b'],
  },
  {
    name: 'a sheet with 2,000 liquid drops',
    lines: [
      'g = Ground()',
      'sheet = Cloth((-1.5, -1.5, 2), (3, 0, 0), (0, 3, 0), 64, 32, mass = 1, pins = "corners")',
      'water = Liquid(Box((0, 0, 2.4), 1.6, 1.6, 0.5), 2000)',
    ],
    probes: [...pts('sheet', 64, 32), 'water_n = water.count', 'water_level = water.level'],
    arrays: ['sheet', 'water'],
  },
  {
    name: 'a 2D rope with a ball',
    lines: ['rope = Cloth((0, 5), (3, 5), 30, mass = 0.2, pins = [(0, 5)])', 'ball = Body(Circle((3, 5), 0.2), mass = 1)', 'tie = Pin(rope, (3, 5), ball)'],
    probes: ['rope_a = rope.at(10, 1)', 'rope_b = rope.at(20, 1)', 'rope_c = rope.at(30, 1)', 'ball_x = ball.x', 'ball_y = ball.y'],
    arrays: ['rope'],
  },
  {
    name: 'a 2D net that tears',
    lines: ['g = Ground()', 'net = Cloth(Box((0, 3), 5, 1.2), 26, 7, mass = 0.3, tears = 1.5, pins = "top")', 'ball = Body(Circle((-3.4, 3.1), 0.4), mass = 6, speed = (9, 1))'],
    probes: [...pts('net', 26, 7), 'ball_x = ball.x', 'ball_y = ball.y'],
    arrays: ['net'],
  },
  {
    name: 'a body pinned to a 3D sheet',
    lines: [
      'g = Ground()',
      'sheet = Cloth((-1.5, -1.5, 1.4), (3, 0, 0), (0, 3, 0), 28, 28, mass = 1.2, stretch = 0.9, pins = "corners")',
      'ball = Body(Sphere((0, 0, 1), 0.4), mass = 3)',
      'tie = Pin(sheet, (0, 0, 1.4), ball)',
    ],
    probes: [...pts('sheet', 28, 28), 'ball_x = ball.x', 'ball_y = ball.y', 'ball_z = ball.z'],
    arrays: ['sheet'],
  },
  // The other loops: the cloth that hits itself, a hull's candidate points, smoke as wind, the 3D liquid's neighbour grid.
  {
    name: 'a free sheet that hits itself on a ball',
    lines: ['g = Ground()', 'ball = Sphere((0, 0, 0.5), 0.5)', 'ball with solid = true', 'sheet = Cloth((-1.4, -0.7, 1.6), (2.8, 0, 0), (0, 1.4, 0), 36, 18, mass = 0.5, self = true)'],
    probes: pts('sheet', 36, 18),
    arrays: ['sheet'],
  },
  {
    name: 'a body with a box hull falling on a sheet',
    lines: [
      'g = Ground()',
      'sheet = Cloth((-1.5, -1.5, 1), (3, 0, 0), (0, 3, 0), 24, 24, mass = 0.8, pins = "corners")',
      'box = Body(Box((0.1, 0.05, 2), 0.6, 0.5, 0.4), mass = 2)',
    ],
    probes: [...pts('sheet', 24, 24), 'box_x = box.x', 'box_y = box.y', 'box_z = box.z'],
    arrays: ['sheet'],
  },
  {
    name: 'a rope in smoke',
    lines: [
      'sm = Smoke(Box((1, 0), 10, 6), 48, source = Box((-3.7, 0), 0.3, 2), heat = 1, until = 3)',
      'rope = Cloth((-2, 0), (2, 0), 30, mass = 0.1, pins = [(-2, 0)])',
    ],
    probes: ['rope_a = rope.at(10, 1)', 'rope_b = rope.at(20, 1)', 'rope_c = rope.at(30, 1)', 'sm_m = sm.mass'],
    arrays: ['rope'],
  },
  {
    name: 'a 3D liquid with a ball',
    lines: [
      'g = Ground()',
      'w1 = Box((-1.6, 0, 0.9), 0.2, 3.4, 1.8)',
      'w2 = Box((1.6, 0, 0.9), 0.2, 3.4, 1.8)',
      'w3 = Box((0, -1.6, 0.9), 3.4, 0.2, 1.8)',
      'w4 = Box((0, 1.6, 0.9), 3.4, 0.2, 1.8)',
      'w1 with solid = true',
      'w2 with solid = true',
      'w3 with solid = true',
      'w4 with solid = true',
      'water = Liquid(Box((0, 0, 0.5), 3, 3, 1), 2000)',
      'ball = Body(Sphere((0.3, 0.2, 3), 0.4), density = 0.5)',
    ],
    probes: ['water_n = water.count', 'water_level = water.level', 'ball_x = ball.x', 'ball_y = ball.y', 'ball_z = ball.z'],
    arrays: ['water'],
  },
];
const TASK_SCENES = SCENES.slice(0, 8);

const nameOf = (probe: string): string => probe.slice(0, probe.indexOf(' =')).trim();

/** A readout as a list of labelled numbers: a point gives its coordinates; anything not a number is kept as it is. */
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
/** The whole arrays of the cloths and liquids (points, drops, torn links), copied. */
const arraysOf = (fig: Figure, scene: Scene): Array<[string, number[]]> => {
  const out: Array<[string, number[]]> = [];
  for (const n of scene.arrays) {
    const v = fig.value(n) as { xs?: ArrayLike<number>; ys?: ArrayLike<number>; zs?: ArrayLike<number>; cut?: ArrayLike<number>; count?: number };
    for (const k of ['xs', 'ys', 'zs', 'cut'] as const) {
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
}
const snap = (fig: Figure, scene: Scene, t: number): Snapshot => ({ t, values: readouts(fig, scene), arrays: arraysOf(fig, scene) });

/** Builds the scene with the switch as given and plays it, taking a snapshot at each whole second. */
const film = (scene: Scene, kernels: boolean, seconds: number): Snapshot[] => {
  setPhysicsKernels(kernels);
  const fig = make([...scene.lines, ...scene.probes]);
  const shots: Snapshot[] = [];
  for (let s = 1; s <= seconds; s++) {
    play(fig, s);
    shots.push(snap(fig, scene, s));
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
    for (let k = 0; k < x.arrays.length; k++) {
      const [label, v] = x.arrays[k] as [string, number[]];
      expect(v, `${scene} t=${x.t} s ${label} (whole array)`).toEqual((y.arrays[k] as [string, number[]])[1]);
    }
  }
};

/** At least one readout of the scene moved: a film that stands still would make every comparison pass for nothing. */
const moved = (a: Snapshot, b: Snapshot): boolean => a.values.some(([label, v], k) => typeof v === 'number' && v !== (b.values[k] as [string, unknown])[1] && label !== '');

const LONG = 240_000;

describe('the same film with the kernels on and off (design 11.6 "The same bits")', () => {
  for (const scene of SCENES) {
    it(`${scene.name}: 5 s with the kernels on equal 5 s with them off, every second, to the last bit`, () => {
      const on = film(scene, true, 5);
      const off = film(scene, false, 5);
      expectSame(scene.name, on, off);
      // the figure really plays: something moved between the first and the last second
      expect(moved(on[0] as Snapshot, on[4] as Snapshot), `${scene.name} stands still`).toBe(true);
    }, LONG);
  }
});

describe('seek equals play with the kernels on (design 10.4, 11.6)', () => {
  for (const scene of SCENES) {
    it(`${scene.name}: a seek straight from 0 to 3 s equals playing to 3 s`, () => {
      setPhysicsKernels(true);
      const played = make([...scene.lines, ...scene.probes]);
      play(played, 3);
      const sought = make([...scene.lines, ...scene.probes]);
      seek(sought, 3);
      expectSame(scene.name, [snap(played, scene, 3)], [snap(sought, scene, 3)]);
    }, LONG);
  }

  it('a seek back and forward again, over checkpoints, keeps the film (a sheet on a ball, kernels on)', () => {
    setPhysicsKernels(true);
    const scene = SCENES[0] as Scene;
    const straight = make([...scene.lines, ...scene.probes]);
    play(straight, 3);
    const fig = make([...scene.lines, ...scene.probes]);
    play(fig, 3);
    seek(fig, 1);
    seek(fig, 3);
    expectSame(scene.name, [snap(straight, scene, 3)], [snap(fig, scene, 3)]);
  }, LONG);

  it('a film played with the kernels on and sought to the same time with them off is the same film', () => {
    const scene = SCENES[1] as Scene;
    setPhysicsKernels(true);
    const played = make([...scene.lines, ...scene.probes]);
    play(played, 3);
    setPhysicsKernels(false);
    const sought = make([...scene.lines, ...scene.probes]);
    seek(sought, 3);
    expectSame(scene.name, [snap(played, scene, 3)], [snap(sought, scene, 3)]);
  }, LONG);
});

describe('without WebAssembly the TypeScript loops run and give the same film (design 11.6 "the fallback")', () => {
  // The docs promise that the loops run "with the same film" when there is no WebAssembly or the module did not compile.
  // They do not say whether a module compiled earlier in the same process is dropped when WebAssembly disappears, so these tests
  // check only what is promised: no throw, the cloth runs, the film is the TypeScript film.
  for (const scene of [SCENES[0], SCENES[1], SCENES[5], SCENES[6]] as Scene[]) {
    it(`${scene.name}: with WebAssembly unavailable and the switch on, 3 s equal the film with the kernels off`, () => {
      const reference = film(scene, false, 3);
      setPhysicsKernels(true);
      vi.stubGlobal('WebAssembly', undefined);
      expect(typeof WebAssembly).toBe('undefined');
      let shots: Snapshot[] = [];
      expect(() => {
        shots = film(scene, true, 3);
      }).not.toThrow();
      vi.unstubAllGlobals();
      expectSame(scene.name, shots, reference);
      expect(moved(shots[0] as Snapshot, shots[2] as Snapshot), `${scene.name} stands still`).toBe(true);
    }, LONG);
  }

  it('the 3D liquid and a sheet with drops also run without WebAssembly, with the same film', () => {
    for (const scene of [SCENES[4], SCENES[11]] as Scene[]) {
      const reference = film(scene, false, 2);
      setPhysicsKernels(true);
      vi.stubGlobal('WebAssembly', undefined);
      const shots = film(scene, true, 2);
      vi.unstubAllGlobals();
      expectSame(scene.name, shots, reference);
    }
  }, LONG);

  it('initPhysicsKernels() does not throw or reject when WebAssembly is unavailable', async () => {
    vi.stubGlobal('WebAssembly', undefined);
    let answer: unknown;
    await expect(
      (async () => {
        answer = await initPhysicsKernels();
      })(),
    ).resolves.toBeUndefined();
    expect(typeof answer).toBe('boolean');
  });
});

describe('the switch and the start-up call (design 11.6 "Main thread")', () => {
  it('physicsKernelsOn() follows setPhysicsKernels', () => {
    expect(physicsKernelsOn()).toBe(true);
    setPhysicsKernels(false);
    expect(physicsKernelsOn()).toBe(false);
    setPhysicsKernels(true);
    expect(physicsKernelsOn()).toBe(true);
  });

  it('initPhysicsKernels() resolves to true in Node, where the module compiles, and again on a second and a concurrent call', async () => {
    expect(await initPhysicsKernels()).toBe(true);
    expect(await initPhysicsKernels()).toBe(true);
    const both = await Promise.all([initPhysicsKernels(), initPhysicsKernels()]);
    expect(both).toEqual([true, true]);
  });

  it('after initPhysicsKernels() a figure plays the same film as with the kernels off', async () => {
    const scene = SCENES[1] as Scene;
    const off = film(scene, false, 3);
    expect(await initPhysicsKernels()).toBe(true);
    const on = film(scene, true, 3);
    expectSame(scene.name, on, off);
  }, LONG);

  it('the switch counts for solvers built after it: a figure built with the kernels on and played on with them off keeps the film', () => {
    const scene = SCENES[2] as Scene;
    const reference = film(scene, false, 4);
    setPhysicsKernels(true);
    const fig = make([...scene.lines, ...scene.probes]);
    const shots: Snapshot[] = [];
    for (let s = 1; s <= 4; s++) {
      if (s === 2) setPhysicsKernels(false);
      play(fig, s);
      shots.push(snap(fig, scene, s));
    }
    expectSame(scene.name, shots, reference);
  }, LONG);

  it('a figure built with the kernels off and played on with them switched on keeps the film', () => {
    const scene = SCENES[3] as Scene;
    const reference = film(scene, false, 4);
    setPhysicsKernels(false);
    const fig = make([...scene.lines, ...scene.probes]);
    const shots: Snapshot[] = [];
    for (let s = 1; s <= 4; s++) {
      if (s === 2) setPhysicsKernels(true);
      play(fig, s);
      shots.push(snap(fig, scene, s));
    }
    expectSame(scene.name, shots, reference);
  }, LONG);

  it('two figures at once, one built with the kernels on and one with them off, play the same film and do not share memory', () => {
    const scene = SCENES[3] as Scene;
    setPhysicsKernels(true);
    const a = make([...scene.lines, ...scene.probes]);
    setPhysicsKernels(false);
    const b = make([...scene.lines, ...scene.probes]);
    setPhysicsKernels(true);
    const c = make([...scene.lines, ...scene.probes]);
    const shots: Record<string, Snapshot[]> = { a: [], b: [], c: [] };
    for (let s = 1; s <= 3; s++) {
      // interleave frame by frame: one instance of the module for each figure (design 11.6), none may see another's arrays
      const now = a.clock().t;
      for (let k = 1; k <= 60; k++) {
        a.setClock(now + k / 60);
        b.setClock(now + k / 60);
        c.setClock(now + k / 60);
      }
      shots.a?.push(snap(a, scene, s));
      shots.b?.push(snap(b, scene, s));
      shots.c?.push(snap(c, scene, s));
    }
    expectSame('a against b', shots.a as Snapshot[], shots.b as Snapshot[]);
    expectSame('c against b', shots.c as Snapshot[], shots.b as Snapshot[]);
  }, LONG);
});

describe('at the limits of 11.3 (the module is sized for 2,000 drops and 4,096 points)', () => {
  it('two 64 by 32 cloths (4,096 points, one hitting itself) with a 3D liquid of 2,000 drops: 2 s with kernels on equal 2 s with them off', () => {
    const scene: Scene = {
      name: 'the limits',
      lines: [
        'g = Ground()',
        'ball = Sphere((0, 0, 0.5), 0.5)',
        'ball with solid = true',
        'a = Cloth((-2, -1.5, 1.4), (4, 0, 0), (0, 3, 0), 64, 32, mass = 1)',
        'b = Cloth((-2, -1.5, 2.2), (4, 0, 0), (0, 3, 0), 64, 32, mass = 1, self = true)',
        'water = Liquid(Box((3.5, 0, 0.5), 2, 2, 1), 2000)',
      ],
      probes: [...pts('a', 64, 32), ...pts('b', 64, 32), 'water_n = water.count', 'water_level = water.level'],
      arrays: ['a', 'b', 'water'],
    };
    const on = film(scene, true, 2);
    const off = film(scene, false, 2);
    expectSame(scene.name, on, off);
    expect(on[0]?.values.find(([l]) => l === 'water_n')?.[1]).toBe(2000);
  }, LONG);

  it('the net of 11.5 tears the same links and the figure gives one torn notice, with the kernels on and off', () => {
    const scene = SCENES[6] as Scene;
    const notices = (kernels: boolean): { torn: number; torns: number; cut: number[] } => {
      setPhysicsKernels(kernels);
      const fig = make([...scene.lines, ...scene.probes]);
      play(fig, 3);
      const v = fig.value('net') as physics.ClothValue;
      return { torn: v.torn, torns: fig.takeWarnings().filter((n) => n.kind === 'torn').length, cut: Array.from(v.cut) };
    };
    const on = notices(true);
    const off = notices(false);
    expect(on.torn).toBeGreaterThan(0);
    expect(on.torn).toBe(off.torn);
    expect(on.torns).toBe(1);
    expect(off.torns).toBe(1);
    expect(on.cut).toEqual(off.cut);
  }, LONG);
});

describe('the task scenes are the eight of the task (guard on this file)', () => {
  it('has the eight figures first', () => {
    expect(TASK_SCENES.map((s) => s.name)).toEqual([
      'a 3D sheet on a ball',
      'a flag in wind',
      'a 64 by 32 sheet over boxes',
      'two cloths',
      'a sheet with 2,000 liquid drops',
      'a 2D rope with a ball',
      'a 2D net that tears',
      'a body pinned to a 3D sheet',
    ]);
  });
});
