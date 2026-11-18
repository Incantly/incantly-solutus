/**
 * Smoke and fire in space (.kiro/specs/physics R11 items 7, 9, 10; docs/features/physics design 2.4 `Smoke`, `Fire`, `Ignite`,
 * 9.4, 9.5 "Air", 9.7, 9.8, 10.3, 11.2, 11.3, 11.5 "Smoke kept" and "Still air"; errors.md B004, B013, B020, B021, reason `burnt`,
 * notices `burnt`, `fire_out`, `checkpoints_thinned`; agent.md rows for `Smoke`, `Fire`, `Ignite` and `burns` in space).
 *
 * The worker and the drawing of a grid in space are checked in packages/sdk/test/spec/physics-fire-space.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRegistry, Figure, geometry, physics, physics3Of, registerAnimation, registerFunctions, registerLists, registerNumbers, registerPhysics, registerSpace, setPhysicsKernels } from '../../src/index';

vi.setConfig({ testTimeout: 240_000 });

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

let f: Figure;
beforeEach(() => {
  f = new Figure({ commands: REG });
});
afterEach(() => {
  setPhysicsKernels(true);
});

interface Failure {
  readonly kind: string;
  readonly code: string;
  readonly message: string;
  readonly hint?: string;
  readonly suggest?: string[];
}
const all = (lines: readonly string[], fig = f): void => {
  for (const l of lines) {
    const r = fig.apply(l);
    if (!r.ok) throw new Error(`${l}: ${(r as { message: string }).message}`);
  }
};
const fail = (line: string, fig = f): Failure => {
  const r = fig.apply(line);
  if (r.ok) throw new Error(`${line} was accepted`);
  return r as never;
};
const make = (lines: readonly string[]): Figure => {
  const g = new Figure({ commands: REG });
  all(lines, g);
  return g;
};
const smoke = (name: string, fig = f): physics.SmokeValue => {
  const v = fig.value(name);
  if (!physics.isSmokeValue(v)) throw new Error(`${name} is not smoke now`);
  return v;
};
const fire = (name: string, fig = f): physics.FireValue => {
  const v = fig.value(name);
  if (!physics.isFireValue(v)) throw new Error(`${name} is not a fire now`);
  return v;
};
const cloth = (name: string, fig = f): physics.ClothValue => {
  const v = fig.value(name);
  if (!physics.isClothValue(v)) throw new Error(`${name} is not a cloth now`);
  return v;
};
/** Plays the film in frames of 1/60 s up to t. */
const play = (t: number, fig = f): void => {
  const now = fig.clock().t;
  const frames = Math.round((t - now) * 60);
  for (let k = 1; k <= frames; k++) fig.setClock(now + k / 60);
};
/** Seeks to t, and lets a far seek catch up over frames (design 10.4). */
const seek = (fig: Figure, t: number): void => {
  fig.setClock(t);
  for (let k = 0; k < 400 && fig.driversNeedFrames(); k++) fig.flush(true);
};
const hash = (fig: Figure): string => physics3Of(fig).worldHash();
const kinds = (fig: Figure): string[] => fig.takeWarnings().map((w) => w.kind);

/** Where a grid's cells are: the centre of cell (i, j, k). Cell (i, j, k) is at `(k n + j) n + i` in every array. */
const cellXYZ = (v: physics.SmokeValue, i: number, j: number, k: number): { x: number; y: number; z: number } => {
  const { n, x0, y0, x1, y1 } = v.spec;
  const z0 = v.spec.z0 as number;
  const z1 = v.spec.z1 as number;
  return { x: x0 + ((i + 0.5) * (x1 - x0)) / n, y: y0 + ((j + 0.5) * (y1 - y0)) / n, z: z0 + ((k + 0.5) * (z1 - z0)) / n };
};
const cellOf = (v: physics.SmokeValue, x: number, y: number, z: number): number => {
  const { n, x0, y0, x1, y1 } = v.spec;
  const z0 = v.spec.z0 as number;
  const z1 = v.spec.z1 as number;
  const i = Math.floor(((x - x0) / (x1 - x0)) * n);
  const j = Math.floor(((y - y0) / (y1 - y0)) * n);
  const k = Math.floor(((z - z0) / (z1 - z0)) * n);
  return (k * n + j) * n + i;
};
/** The temperature-weighted mean height of the cells above `min` °C, the height of the highest of them, and how many there are. */
const hotRegion = (name: string, min: number, fig = f): { cz: number; top: number; cells: number } => {
  const v = fire(name, fig);
  const n = v.spec.n;
  let m = 0;
  let mz = 0;
  let top = -Infinity;
  let cells = 0;
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const T = v.temp[(k * n + j) * n + i] as number;
        if (T <= min) continue;
        const z = cellXYZ(v, i, j, k).z;
        m += T;
        mz += T * z;
        cells++;
        if (z > top) top = z;
      }
    }
  }
  return { cz: m > 0 ? mz / m : Number.NaN, top, cells };
};
const maxTemp = (name: string, fig = f): number => Math.max(...Array.from(fire(name, fig).temp));
/** The smoke's centre: the density-weighted mean of the cells. */
const smokeCentre = (name: string, fig = f): { x: number; y: number; z: number } => {
  const v = smoke(name, fig);
  const n = v.spec.n;
  let m = 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const d = v.density[(k * n + j) * n + i] as number;
        const c = cellXYZ(v, i, j, k);
        m += d;
        mx += d * c.x;
        my += d * c.y;
        mz += d * c.z;
      }
    }
  }
  return { x: mx / m, y: my / m, z: mz / m };
};
/** The film time at which a notice of `kind` first comes, playing frame by frame to `limit`; `undefined` if it never does. Counts all of them. */
const firstNotice = (fig: Figure, kind: string, limit: number, stop = false): { at: number | undefined; count: number } => {
  let at: number | undefined;
  let count = 0;
  const frames = Math.round((limit - fig.clock().t) * 60);
  const t0 = fig.clock().t;
  for (let k = 1; k <= frames; k++) {
    fig.setClock(t0 + k / 60);
    const n = fig.takeWarnings().filter((w) => w.kind === kind).length;
    if (n > 0 && at === undefined) at = t0 + k / 60;
    count += n;
    if (stop && at !== undefined) break;
  }
  return { at, count };
};

const BOX3 = 'Box((0, 0, 1.5), 3, 3, 3)';
const SRC3 = 'source = Sphere((0, 0, 0.3), 0.3)';
const CAMP3 = `fire = Fire(${BOX3}, 16, ${SRC3})`;
const STOPPED3 = `fire = Fire(${BOX3}, 16, ${SRC3}, until = 1)`;
/** A closed jar: six thick walls round a 2.4 m room, inside a grid of 4 m a side. */
const JAR = (() => {
  const walls = [
    ['jx0', '(-1.45, 0, 2), 0.5, 3.4, 3.4'], ['jx1', '(1.45, 0, 2), 0.5, 3.4, 3.4'],
    ['jy0', '(0, -1.45, 2), 3.4, 0.5, 3.4'], ['jy1', '(0, 1.45, 2), 3.4, 0.5, 3.4'],
    ['jz0', '(0, 0, 0.55), 3.4, 3.4, 0.5'], ['jz1', '(0, 0, 3.45), 3.4, 3.4, 0.5'],
  ] as const;
  return walls.flatMap(([n, a]) => [`${n} = Box(${a})`, `${n} with solid = true`]);
})();
const JAR_BOX = 'Box((0, 0, 2), 4, 4, 4)';
/** A low crate on the floor that overlaps the source, and a block beside it. */
const WOOD3 = 'Box((0.25, 0, 0.1), 0.5, 0.5, 0.2)';
const ROCK3 = 'Box((0.85, 0, 0.1), 0.7, 0.5, 0.2)';

describe('Smoke and Fire in space: forms (design 2.4, 9.8; agent.md; R11.7)', () => {
  it('Fire(at: Point3) is a box 2 m by 2 m across, from 0.5 m below to 2.5 m above the point, 24 cells, with a ball of fuel of radius 0.25, a smoke value of type Fire', () => {
    all(['at = (3, 1, 2)', 'fa = Fire(at)']);
    const v = fire('fa');
    expect(f.get('fa')?.type).toBe('Fire');
    expect(v.schema).toBe('Smoke');
    expect(physics.isSmokeValue(v)).toBe(true);
    expect(v.spec.space).toBe(true);
    expect(v.spec.n).toBe(24);
    expect(v.spec.x0).toBeCloseTo(2, 9);
    expect(v.spec.x1).toBeCloseTo(4, 9);
    expect(v.spec.y0).toBeCloseTo(0, 9);
    expect(v.spec.y1).toBeCloseTo(2, 9);
    expect(v.spec.z0).toBeCloseTo(1.5, 9);
    expect(v.spec.z1).toBeCloseTo(4.5, 9);
    expect(v.density).toBeInstanceOf(Float32Array);
    expect(v.temp).toBeInstanceOf(Float32Array);
    expect(v.density.length).toBe(24 * 24 * 24);
    expect(v.temp.length).toBe(24 * 24 * 24);
    // the ball of fuel: hot in the cell of the point at the start of the film, cold far from it
    expect(v.temp[cellOf(v, 3, 1, 2)]).toBe(1000);
    expect(v.temp[cellOf(v, 2.1, 0.1, 4.4)]).toBe(0);
  });

  it('Fire(at) defaults: fuel 1, burn 1, heat 1,000, smoke 1, sound off, swirl 2', () => {
    all(['fa = Fire((0, 0, 0))']);
    const sp = fire('fa').spec as unknown as { fire: Record<string, unknown>; swirl?: number };
    expect(sp.fire).toMatchObject({ fuel: 1, burn: 1, heat: 1000, smoke: 1, sound: false });
    expect(sp.swirl).toBe(2);
  });

  it('Fire(box, n) takes the bounding box of any polyhedron and every named argument', () => {
    all(['f2 = Fire(Box((1, 2, 3), 2, 4, 6), 20, source = Sphere((1, 2, 0.5), 0.3), fuel = 2, burn = 1, heat = 800, smoke = 3, swirl = 1, wind = (1, 0, 0.5), until = 5, sound = true)']);
    const v = fire('f2');
    expect(v.spec.space).toBe(true);
    expect(v.spec.n).toBe(20);
    expect([v.spec.x0, v.spec.x1, v.spec.y0, v.spec.y1, v.spec.z0, v.spec.z1]).toEqual([0, 2, 0, 4, 0, 6]);
    expect(v.density.length).toBe(20 * 20 * 20);
    expect(v.spec.fire).toMatchObject({ fuel: 2, burn: 1, heat: 800, smoke: 3, sound: true });
    expect(v.spec.until).toBe(5);
    expect(v.spec.swirl).toBe(1);
    // a cube, a tetrahedron's box: any polyhedron
    const g = make(['k = Cube((0, 0, 0), (2, 0, 0), (0, 2, 0))', 'fc = Fire(k, 8)']);
    expect(fire('fc', g).spec.x1 - fire('fc', g).spec.x0).toBeCloseTo(2, 9);
    expect((fire('fc', g).spec.z1 as number) - (fire('fc', g).spec.z0 as number)).toBeCloseTo(2, 9);
  });

  it('Fire sources: a point, a ball and a convex solid', () => {
    for (const src of ['(0, 0, 0.3)', 'Sphere((0, 0, 0.3), 0.3)', 'Box((0, 0, 0.3), 0.4, 0.4, 0.4)']) {
      const g = make([`fx = Fire(${BOX3}, 12, source = ${src})`]);
      expect(maxTemp('fx', g), src).toBe(1000);
    }
  });

  it('Smoke(box, n): type Smoke, a smoke value in space, nothing in it without a source, density 1 in the source cells at the start', () => {
    all([`sm = Smoke(${BOX3}, 16)`, 'm0 = sm.mass', 'd0 = sm.at(0, 0, 1)']);
    const v = smoke('sm');
    expect(f.get('sm')?.type).toBe('Smoke');
    expect(v.spec.space).toBe(true);
    expect(v.density).toBeInstanceOf(Float32Array);
    expect(v.density.length).toBe(16 ** 3);
    expect(v.spec.heat).toBe(0);
    expect(f.value('m0')).toBe(0);
    expect(f.value('d0')).toBe(0);
    for (const src of ['(0, 0, 0.5)', 'Sphere((0, 0, 0.5), 0.4)', 'Box((0, 0, 0.5), 0.6, 0.6, 0.6)']) {
      const g = make([`sm = Smoke(${BOX3}, 16, source = ${src})`, 'd = sm.at(0, 0, 0.5)', 'm = sm.mass']);
      expect(g.value('d'), src).toBeCloseTo(1, 6);
      expect(g.value('m') as number, src).toBeGreaterThan(0);
      // 9.4: heat is 2 when a source is given
      expect(smoke('sm', g).spec.heat, src).toBe(2);
    }
  });

  it('every n from 4 to 32 is accepted, and n outside it is bad_property_value (design 9.8, 11.3)', () => {
    for (const cmd of ['Smoke', 'Fire']) {
      for (const n of ['3', '33', '64', '65', '100', '0', '-1']) expect(fail(`a = ${cmd}(${BOX3}, ${n})`).kind, `${cmd} n = ${n}`).toBe('bad_property_value');
      for (const n of ['4', '5', '24', '32']) {
        const g = make([`a = ${cmd}(${BOX3}, ${n})`]);
        expect(smoke('a', g).density.length, `${cmd} n = ${n}`).toBe(Number(n) ** 3);
      }
    }
  });

  it('one grid in space a figure: a second one is refused with limit, whichever kinds they are; redefining the grid is fine', () => {
    all([`a = Fire(${BOX3}, 12)`]);
    expect(fail(`b = Smoke(${BOX3}, 8)`).kind).toBe('limit');
    expect(fail(`b = Fire(${BOX3}, 8)`).kind).toBe('limit');
    expect(fail('b = Fire((10, 0, 0))').kind).toBe('limit');
    expect(f.get('b')).toBeUndefined();
    all([`a = Fire(${BOX3}, 16)`]);
    expect(smoke('a').spec.n).toBe(16);
    const g = make([`s = Smoke(${BOX3}, 12)`]);
    all([`s = Smoke(${BOX3}, 10)`], g);
    expect(smoke('s', g).spec.n).toBe(10);
    expect(fail(`fx = Fire(${BOX3}, 8)`, g).kind).toBe('limit');
    // a refusal leaves the figure working
    play(0.5, g);
    expect(smoke('s', g).density.length).toBe(10 ** 3);
  });

  it('the 64 × 64 limit of the plane counts only grids in the plane: a full grid in the plane leaves room for one in space', () => {
    const g = make(['p = Fire(Box((0, 2), 4, 4), 64)']);
    all([`s = Smoke(${BOX3}, 16)`], g);
    expect(smoke('s', g).spec.space).toBe(true);
    const h = make([`s = Smoke(${BOX3}, 32)`]);
    all(['p = Fire(Box((0, 2), 4, 4), 64)'], h);
    expect(smoke('p', h).spec.n).toBe(64);
  });
});

describe('Smoke and Fire in space: ranges of the named arguments (design 9.4, 9.7, 9.8; errors.md B004)', () => {
  const FIRE: ReadonlyArray<[string, string[], string[]]> = [
    ['fuel', ['-0.1', '10.1', '11'], ['0', '10', '1.5']],
    ['burn', ['0', '0.09', '10.1', '11'], ['0.1', '10', '3']],
    ['heat', ['99', '99.9', '2001', '5000'], ['100', '2000', '500']],
    ['smoke', ['-0.1', '5.1', '6'], ['0', '5', '2']],
    ['swirl', ['-0.1', '10.1'], ['0', '10']],
    ['until', ['-0.5', '-1'], ['0', '3']],
  ];
  for (const [name, bad, good] of FIRE) {
    it(`Fire ${name}: a literal out of range is refused with bad_property_value, and the limits are accepted`, () => {
      for (const v of bad) expect(fail(`a = Fire(${BOX3}, 8, ${name} = ${v})`).kind, `${name} = ${v}`).toBe('bad_property_value');
      for (const v of good) all([`a = Fire(${BOX3}, 8, ${name} = ${v})`]);
    });
  }

  const SMOKE: ReadonlyArray<[string, string[], string[]]> = [
    ['heat', ['-51', '51', '100'], ['-50', '50', '2']],
    ['swirl', ['-0.1', '10.1'], ['0', '10']],
    ['until', ['-0.5', '-1'], ['0', '3']],
  ];
  for (const [name, bad, good] of SMOKE) {
    it(`Smoke ${name}: a literal out of range is refused with bad_property_value, and the limits are accepted`, () => {
      for (const v of bad) expect(fail(`a = Smoke(${BOX3}, 8, source = (0, 0, 0.5), ${name} = ${v})`).kind, `${name} = ${v}`).toBe('bad_property_value');
      for (const v of good) all([`a = Smoke(${BOX3}, 8, source = (0, 0, 0.5), ${name} = ${v})`]);
    });
  }

  it('wind: a part over 100 m/s is refused with bad_property_value, on Smoke and on Fire; a number for wind is the wrong form', () => {
    for (const cmd of ['Smoke', 'Fire']) {
      const g = new Figure({ commands: REG });
      expect(fail(`a = ${cmd}(${BOX3}, 8, wind = (101, 0, 0))`, g).kind).toBe('bad_property_value');
      expect(fail(`a = ${cmd}(${BOX3}, 8, wind = (0, 0, -200))`, g).kind).toBe('bad_property_value');
      expect(fail(`a = ${cmd}(${BOX3}, 8, wind = 3)`, g).kind).toBe('no_matching_form');
      all([`a = ${cmd}(${BOX3}, 8, wind = (100, -100, 100))`], g);
    }
  });

  it('sound must be true or false', () => {
    expect(fail(`a = Fire(${BOX3}, 8, sound = 3)`).kind).toMatch(/no_matching_form|bad_property_value/);
    all([`a = Fire(${BOX3}, 8, sound = false)`, `a = Fire(${BOX3}, 8, sound = true)`]);
  });
});

describe('Smoke and Fire in space: readouts (design 2.4, 9.8; agent.md)', () => {
  it('f.temperature(x, y, z) and sm.at(x, y, z) take three numbers and read the cell: the arrays say the same, and outside the box they are 0', () => {
    const g = make([CAMP3, 'T0 = fire.temperature(0, 0, 0.3)', 'D0 = fire.at(0, 0, 0.3)', 'Tout = fire.temperature(9, 9, 9)', 'Dout = fire.at(0, 0, 9)', 'Tfar = fire.temperature(1.3, 1.3, 2.8)']);
    expect(g.value('T0')).toBe(1000);
    expect(g.value('Tout')).toBe(0);
    expect(g.value('Dout')).toBe(0);
    expect(g.value('Tfar')).toBe(0);
    play(1.5, g);
    all(['Tp = fire.temperature(0, 0, 0.9)', 'Tq = fire.temperature(0.05, 0.05, 0.9)', 'Dp = fire.at(0, 0, 0.9)', 'Dq = fire.at(0.05, 0.05, 1.4)'], g);
    const v = fire('fire', g);
    expect(g.value('Tp') as number).toBeCloseTo(v.temp[cellOf(v, 0, 0, 0.9)] as number, 3);
    expect(g.value('Tq') as number).toBeCloseTo(v.temp[cellOf(v, 0.05, 0.05, 0.9)] as number, 3);
    expect(g.value('Dp') as number).toBeCloseTo(v.density[cellOf(v, 0, 0, 0.9)] as number, 6);
    expect(g.value('Dq') as number).toBeCloseTo(v.density[cellOf(v, 0.05, 0.05, 1.4)] as number, 6);
    // the plume is there: some cell above the source is hot and smoky
    expect(Math.max(g.value('Tp') as number, g.value('Tq') as number)).toBeGreaterThan(150);
    expect(Math.max(...Array.from(v.density))).toBeGreaterThan(0);
  });

  it('a cell is told by its place: the readouts of different places give different cells (x, y and z are not mixed up)', () => {
    const g = make([CAMP3]);
    play(1.5, g);
    const v = fire('fire', g);
    // the hottest cell found in the array is where the readout says it is
    const n = v.spec.n;
    let best = 0;
    let at = 0;
    for (let c = 0; c < n * n * n; c++) {
      if ((v.temp[c] as number) > best && c !== cellOf(v, 0, 0, 0.3)) {
        best = v.temp[c] as number;
        at = c;
      }
    }
    const k = Math.floor(at / (n * n));
    const j = Math.floor((at % (n * n)) / n);
    const i = at % n;
    const p = cellXYZ(v, i, j, k);
    all([`Tx = fire.temperature(${p.x}, ${p.y}, ${p.z})`], g);
    expect(g.value('Tx')).toBeCloseTo(best, 3);
  });

  it('every smoke readout works on a fire in space: mass, speed, n, and burning, fuel are a flag and a number', () => {
    const g = make([CAMP3, 'm = fire.mass', 'k = fire.n', 's = fire.speed', 'B = fire.burning', 'F = fire.fuel']);
    expect(g.value('k')).toBe(16);
    expect(g.value('m')).toBe(0);
    expect(g.value('s')).toBe(0);
    expect(g.value('B')).toBe(true);
    expect(g.value('F')).toBe(0);
    play(2, g);
    expect(g.value('m') as number).toBeGreaterThan(0);
    expect(g.value('s') as number).toBeGreaterThan(0.5);
    expect(g.value('F') as number).toBeGreaterThan(0);
    expect(g.value('B')).toBe(true);
  });

  it('a fire with no source is cold: no cell above 150 °C, not burning, fuel 0, and it never raises fire_out', () => {
    const g = make([`cold = Fire(${BOX3}, 12)`, 'B = cold.burning', 'F = cold.fuel']);
    expect(g.value('B')).toBe(false);
    expect(g.value('F')).toBe(0);
    play(5, g);
    expect(maxTemp('cold', g)).toBe(0);
    expect(kinds(g)).not.toContain('fire_out');
  });

  it('a source that reads t is read at each step: a source that moves lights the cell it is in', () => {
    const g = make(['P = (t - 1, 0, 0.4)', `fm = Fire(${BOX3}, 16, source = Sphere(P, 0.25), until = 3)`, 'Tleft = fm.temperature(-0.8, 0, 0.4)', 'Tright = fm.temperature(0.8, 0, 0.4)']);
    play(0.3, g);
    expect(fire('fm', g).temp[cellOf(fire('fm', g), -0.7, 0, 0.4)]).toBeGreaterThan(150);
    play(2.1, g);
    expect(g.value('Tright') as number).toBeGreaterThan(150);
  });

  it('an undefined region or source gives an undefined grid with a reason, not an error', () => {
    all(['k = 1 / 0 + undefined', `none = Fire(${BOX3}, k)`]);
    expect(f.get('none')?.cell).toMatchObject({ defined: false, reason: 'input_undefined' });
  });
});

describe('the step in space (design 9.4, 9.7, 9.8, 11.2)', () => {
  it('a source lights: some cell reaches its heat, fuel is made, and cells above the source heat up', () => {
    all([CAMP3, 'F = fire.fuel', 'B = fire.burning']);
    play(1);
    expect(fire('fire').hottest).toBeGreaterThan(900);
    expect(fire('fire').hottest).toBeLessThanOrEqual(1000);
    expect(f.value('F') as number).toBeGreaterThan(0);
    expect(f.value('B')).toBe(true);
    expect(fire('fire').flames).toBeGreaterThan(0);
    expect(hotRegion('fire', 150).top).toBeGreaterThan(0.7);
  });

  it('heat is the hottest a flame gets: no cell is ever above it, for a cooler and a hotter fire', () => {
    for (const heat of [300, 500, 2000]) {
      const g = make([`fire = Fire(${BOX3}, 12, ${SRC3}, heat = ${heat})`]);
      let hottest = 0;
      for (let t = 0.5; t <= 3; t += 0.5) {
        play(t, g);
        hottest = Math.max(hottest, maxTemp('fire', g));
      }
      expect(hottest, `heat = ${heat}`).toBeLessThanOrEqual(heat + 1e-3);
      expect(hottest, `heat = ${heat}`).toBeGreaterThan(0.8 * heat);
    }
  });

  it('heat rises: the hot region and the smoke move up along z, and the plume reaches well above the source', () => {
    all([CAMP3]);
    play(0.5);
    const early = hotRegion('fire', 150);
    const zEarly = smokeCentre('fire').z;
    play(2.5);
    const late = hotRegion('fire', 150);
    expect(late.top).toBeGreaterThan(early.top + 0.5);
    expect(late.cz).toBeGreaterThan(early.cz);
    expect(smokeCentre('fire').z).toBeGreaterThan(zEarly);
    expect(smokeCentre('fire').z).toBeGreaterThan(0.8);
    expect(fire('fire').speed).toBeGreaterThan(1);
  });

  it('smoke with heat lifts too, and smoke with no heat and no wind does not rise', () => {
    const hot = make([`sm = Smoke(${BOX3}, 16, source = Sphere((0, 0, 0.5), 0.3), heat = 5, until = 0.5)`]);
    const cold = make([`sm = Smoke(${BOX3}, 16, source = Sphere((0, 0, 0.5), 0.3), heat = 0, until = 0.5)`]);
    play(0.6, hot);
    play(0.6, cold);
    const z0 = smokeCentre('sm', hot).z;
    play(2.5, hot);
    play(2.5, cold);
    expect(smokeCentre('sm', hot).z).toBeGreaterThan(z0 + 0.3);
    expect(Math.abs(smokeCentre('sm', cold).z - 0.5)).toBeLessThan(0.05);
    expect(smoke('sm', cold).speed).toBe(0);
  });

  it('wind blows smoke along x, and a wind in z carries it up', () => {
    const g = make([`sm = Smoke(${BOX3}, 16, source = Sphere((-1, 0, 1.5), 0.3), heat = 0, wind = (1, 0, 0))`]);
    play(1.5, g);
    expect(smokeCentre('sm', g).x).toBeGreaterThan(-0.5);
    const h = make([`sm = Smoke(${BOX3}, 16, source = Sphere((0, 0, 0.5), 0.3), heat = 0, wind = (0, 0, 1))`]);
    play(1.5, h);
    expect(smokeCentre('sm', h).z).toBeGreaterThan(0.9);
  });

  it('burning makes smoke: the smoke mass grows with the fuel burnt; with smoke = 0 there is none', () => {
    const a = make([CAMP3, 'm = fire.mass']);
    const none = make([`fire = Fire(${BOX3}, 16, ${SRC3}, smoke = 0)`, 'm = fire.mass']);
    const lots = make([`fire = Fire(${BOX3}, 16, ${SRC3}, smoke = 5)`, 'm = fire.mass']);
    play(2, a);
    play(2, none);
    play(2, lots);
    expect(a.value('m') as number).toBeGreaterThan(0);
    expect(none.value('m') as number).toBeLessThan(1e-12);
    expect(lots.value('m') as number).toBeGreaterThan(a.value('m') as number);
  });

  it('burn: a fast burn makes short flames and a slow burn tall ones', () => {
    const slow = make([`fire = Fire(${BOX3}, 16, ${SRC3}, burn = 0.1)`]);
    const fast = make([`fire = Fire(${BOX3}, 16, ${SRC3}, burn = 10)`]);
    play(2, slow);
    play(2, fast);
    expect(hotRegion('fire', 500, slow).top).toBeGreaterThan(hotRegion('fire', 500, fast).top);
  });

  it('fuel = 0 makes no fuel at the source', () => {
    all([`fire = Fire(${BOX3}, 16, ${SRC3}, fuel = 0)`, 'F = fire.fuel']);
    play(2);
    expect(f.value('F')).toBe(0);
  });

  it('cooling: when the source stops (until) the fire cools, and until = 0 is a fire lit once that cools', () => {
    const running = make([CAMP3, 'T = fire.temperature(0, 0, 0.3)']);
    const stopped = make([STOPPED3, 'T = fire.temperature(0, 0, 0.3)']);
    play(1.5, running);
    play(1.5, stopped);
    expect(running.value('T') as number).toBeGreaterThan(900);
    expect(stopped.value('T') as number).toBeLessThan(running.value('T') as number);
    expect(stopped.value('T') as number).toBeLessThan(800);
    play(4, stopped);
    expect(maxTemp('fire', stopped)).toBeLessThan(maxTemp('fire', running));
    const puff = make([`fire = Fire(${BOX3}, 16, ${SRC3}, until = 0)`]);
    expect(maxTemp('fire', puff)).toBe(0);
    play(3, puff);
    expect(maxTemp('fire', puff)).toBeLessThan(1000);
  });

  it('a fire whose source stopped goes out: fire_out comes once, after the source stopped, with the fire\'s name, and then the fire reads out', () => {
    const g = make([STOPPED3, 'B = fire.burning', 'F = fire.fuel']);
    const r = firstNotice(g, 'fire_out', 60);
    expect(r.at, 'fire_out never came in 60 s').toBeDefined();
    expect(r.at as number).toBeGreaterThan(1);
    expect(r.count).toBe(1);
    expect(maxTemp('fire', g)).toBeLessThanOrEqual(150);
    expect(fire('fire', g).out).toBe(true);
    expect(g.value('B')).toBe(false);
    expect(g.value('F') as number).toBeLessThan(1e-4);
  });

  it('a running fire is never out: no fire_out for 20 s while its source runs', () => {
    all([`fire = Fire(${BOX3}, 12, ${SRC3})`]);
    play(20);
    expect(kinds(f)).not.toContain('fire_out');
    expect(fire('fire').out).toBe(false);
  });

  it('the fire_out notice names the fire and the time', () => {
    const g = make([STOPPED3]);
    let note: { kind: string; message: string } | undefined;
    for (let k = 1; k <= 60 * 60 && !note; k++) {
      g.setClock(k / 60);
      note = g.takeWarnings().find((w) => w.kind === 'fire_out');
    }
    expect(note?.message).toMatch(/fire went out at t = /);
  });

  it('swirl changes the flow and swirl = 0 is the film of a smoke with no swirl, to the last bit (design 9.7)', () => {
    const lines = (extra: string): string[] => ['ball = Sphere((0.2, 0, 1.2), 0.35)', 'ball with solid = true', `sm = Smoke(${BOX3}, 16, source = Sphere((0, 0, 0.4), 0.3), heat = 8${extra})`];
    const plain = make(lines(''));
    const zero = make(lines(', swirl = 0'));
    const some = make(lines(', swirl = 6'));
    play(2, plain);
    play(2, zero);
    play(2, some);
    expect(Array.from(smoke('sm', zero).density)).toEqual(Array.from(smoke('sm', plain).density));
    expect(hash(zero)).toBe(hash(plain));
    expect(Array.from(smoke('sm', some).density)).not.toEqual(Array.from(smoke('sm', plain).density));
    expect(smoke('sm', some).speed).not.toBe(smoke('sm', plain).speed);
  });

  it('solid shapes block the flow: a solid ball over the fire has no heat and no smoke inside it, and the plume goes round it', () => {
    const g = make([CAMP3, 'ball = Sphere((0, 0, 1.3), 0.4)', 'ball with solid = true']);
    play(3, g);
    const v = fire('fire', g);
    expect(v.temp[cellOf(v, 0, 0, 1.3)]).toBe(0);
    expect(v.density[cellOf(v, 0, 0, 1.3)]).toBe(0);
    expect(v.temp[cellOf(v, 0.1, 0.1, 1.2)]).toBe(0);
    // the plume gets above the ball: the air goes round
    expect(hotRegion('fire', 150, g).top).toBeGreaterThan(1.8);
  });

  it('the floor stops the grid\'s flow: with Ground() the air below z = 0 is solid, and the fire still burns above it', () => {
    const g = make(['g = Ground()', `fire = Fire(Box((0, 0, 1), 3, 3, 4), 16, ${SRC3})`]);
    play(1.5, g);
    const v = fire('fire', g);
    // the grid reaches z = -1: no heat and no smoke in cells under the floor
    let under = 0;
    const n = v.spec.n;
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          if (cellXYZ(v, i, j, k).z < -0.01) under += (v.temp[(k * n + j) * n + i] as number) + (v.density[(k * n + j) * n + i] as number);
        }
      }
    }
    expect(under).toBe(0);
    expect(hotRegion('fire', 500, g).cells).toBeGreaterThan(0);
  });

  it('the air pushes a body: a light ball over the fire is lifted, a ball in a cold grid falls (design 9.4 "Two-way", 9.8)', () => {
    const lines = ['leaf = Body(Sphere((0, 0, 1.2), 0.1), mass = 0.002)', 'lz = leaf.z'];
    const hot = make([CAMP3, ...lines]);
    const cold = make([`cold = Fire(${BOX3}, 16)`, ...lines]);
    play(1.5, hot);
    play(1.5, cold);
    // a feather in the plume does not fall like a stone: free fall for 1.5 s would take it 11 m down
    expect(hot.value('lz') as number).toBeGreaterThan(1.2 - 5);
    expect(hot.value('lz') as number).toBeGreaterThan((cold.value('lz') as number) + 1);
  });
});

describe('accuracy checks in space (design 11.5)', () => {
  const jar = (swirl: number): void => {
    const g = make([...JAR, `sm = Smoke(${JAR_BOX}, 16, source = Sphere((0, 0, 1.4), 0.4), heat = 5, until = 0.5, swirl = ${swirl})`, 'm = sm.mass']);
    play(0.6, g);
    const m0 = g.value('m') as number;
    expect(m0).toBeGreaterThan(0);
    let worst = 0;
    for (let t = 1; t <= 10; t++) {
      play(t, g);
      worst = Math.max(worst, Math.abs((g.value('m') as number) / m0 - 1));
    }
    expect(worst).toBeLessThan(1e-3);
    // and the smoke really moved: heat 5 took it up from z = 1.4
    expect(smokeCentre('sm', g).z).toBeGreaterThan(1.7);
  };

  it('smoke kept: hot smoke in a closed jar in space, its source stopped (until = 0.5), keeps its mass within 0.1% for 10 s', () => {
    jar(0);
  });

  it('smoke kept with swirl 2 (the fire default) and swirl 10: the same jar keeps its mass within 0.1% for 10 s (cap 0.5% × (1 + swirl))', () => {
    jar(2);
    jar(10);
  });

  it('still air: smoke round a solid ball with no heat and no wind, 10 s: every air speed stays 0 and the smoke does not move, to the last bit', () => {
    const g = make(['ball = Sphere((0, 0, 1.5), 0.6)', 'ball with solid = true', `sm = Smoke(${BOX3}, 16, source = Sphere((0, 0, 0.5), 0.4), heat = 0)`]);
    const d0 = Array.from(smoke('sm', g).density);
    play(10, g);
    expect(smoke('sm', g).speed).toBe(0);
    expect(Array.from(smoke('sm', g).density)).toEqual(d0);
  });

  it('still air with swirl: the same, with swirl = 6', () => {
    const g = make(['ball = Sphere((0, 0, 1.5), 0.6)', 'ball with solid = true', `sm = Smoke(${BOX3}, 16, source = Sphere((0, 0, 0.5), 0.4), heat = 0, swirl = 6)`]);
    const d0 = Array.from(smoke('sm', g).density);
    play(4, g);
    expect(smoke('sm', g).speed).toBe(0);
    expect(Array.from(smoke('sm', g).density)).toEqual(d0);
  });
});

describe('Water in space douses cells (design 9.7 step 7, 9.8)', () => {
  it('drops poured on a fire in space whose source stopped put it out sooner: fire_out comes earlier than without water', () => {
    const base = ['g = Ground()', STOPPED3];
    const dry = make(base);
    const wet = make([...base, 'rain = Liquid(Box((0, 0, 2.2), 0.8, 0.8, 0.5), 300)']);
    const a = firstNotice(dry, 'fire_out', 60);
    const b = firstNotice(wet, 'fire_out', 60);
    expect(b.at, 'with water the fire never went out').toBeDefined();
    expect(b.count).toBe(1);
    if (a.at !== undefined) expect(b.at as number).toBeLessThan(a.at);
  });

  it('with the source still running, water cools the cells it falls through but the fire is lit again each step', () => {
    const g = make(['g = Ground()', CAMP3, 'rain = Liquid(Box((0, 0, 2.2), 0.8, 0.8, 0.5), 300)', 'T = fire.temperature(0, 0, 0.3)']);
    play(2, g);
    expect(g.value('T') as number).toBeGreaterThan(900);
  });
});

describe('burns and Ignite: bodies in space (design 9.7, 9.8; errors.md reason burnt, notice burnt; R11.4)', () => {
  const BODY3 = ['g = Ground()', CAMP3, `wood = Body(${WOOD3}, mass = 1, burns = 3)`, 'gz = wood.force("gravity")', 'tm = wood.temperature', 'bur = wood.burnt', 'bn = wood.burning'];

  it('a body with burns beside a fire lights, burns, goes from burnt 0 to 1 and then reads undefined with the reason burnt', () => {
    const g = make(BODY3);
    expect(g.value('bur')).toBe(0);
    expect(g.value('bn')).toBe(false);
    expect(g.value('tm')).toBe(0);
    let lit: number | undefined;
    let prev = 0;
    let gone: number | undefined;
    for (let k = 1; k <= 60 * 30 && gone === undefined; k++) {
      g.setClock(k / 60);
      if (!g.get('wood')?.cell.defined) {
        gone = k / 60;
        break;
      }
      if (g.value('bn') === true && lit === undefined) lit = k / 60;
      const bt = g.value('bur') as number;
      expect(bt).toBeGreaterThanOrEqual(prev);
      expect(bt).toBeLessThan(1);
      prev = bt;
    }
    expect(lit, 'the body never lit').toBeDefined();
    expect(gone, 'the body never burnt away').toBeDefined();
    expect(gone as number).toBeGreaterThan(lit as number);
    expect(prev).toBeGreaterThan(0.5);
    expect(g.get('wood')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
    expect(g.value('bur')).toBeUndefined();
  });

  it('the burnt notice shows once, with the body\'s name and the time, also when the film plays on', () => {
    const g = make(BODY3);
    play(30, g);
    const notes = g.takeWarnings().filter((w) => w.kind === 'burnt');
    expect(notes.length).toBe(1);
    expect(notes[0]?.message).toMatch(/^wood burnt away at t = \d/);
    play(40, g);
    expect(g.takeWarnings().filter((w) => w.kind === 'burnt').length).toBe(0);
    expect(g.get('wood')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
  });

  it('a body loses up to 80% of its mass as it burns: its weight falls to 20% of the start as burnt goes to 1', () => {
    const g = make(BODY3);
    play(0.2, g);
    const w0 = (g.value('gz') as { z: number }).z;
    expect(w0).toBeCloseTo(-9.8, 6);
    const seen: Array<[number, number]> = [];
    let minRatio = 1;
    for (let k = 1; k <= 60 * 30 && g.get('wood')?.cell.defined; k++) {
      g.setClock(0.2 + k / 60);
      if (!g.get('wood')?.cell.defined) break;
      const bt = g.value('bur') as number;
      const wz = (g.value('gz') as { z: number }).z;
      seen.push([bt, wz / w0]);
      minRatio = Math.min(minRatio, wz / w0);
    }
    expect(seen.length).toBeGreaterThan(10);
    for (const [bt, ratio] of seen) expect(ratio, `burnt = ${bt}`).toBeCloseTo(1 - 0.8 * bt, 2);
    expect(minRatio).toBeGreaterThanOrEqual(0.2 - 1e-3);
    expect(minRatio).toBeLessThan(0.5);
  });

  it('a body heats from the air before it lights, and burns only above ignite: a lower ignite lights earlier', () => {
    const g = make(BODY3);
    let atLight: number | undefined;
    let last = 0;
    for (let k = 1; k <= 60 * 10; k++) {
      g.setClock(k / 60);
      if (g.value('bn') === true) {
        atLight = g.value('tm') as number;
        break;
      }
      last = g.value('tm') as number;
      expect(last).toBeGreaterThanOrEqual(0);
    }
    expect(last).toBeGreaterThan(50);
    expect(atLight as number).toBeGreaterThanOrEqual(250 - 1);
    const lit = (ignite: number): Figure => make(['g = Ground()', CAMP3, `wood = Body(${WOOD3}, mass = 1, burns = 3, ignite = ${ignite})`, 'bn = wood.burning']);
    const when = (fig: Figure): number => {
      for (let k = 1; k <= 60 * 20; k++) {
        fig.setClock(k / 60);
        if (fig.value('bn') === true) return k / 60;
      }
      return Infinity;
    };
    expect(when(lit(160))).toBeLessThan(when(lit(600)));
  });

  it('far from the fire a body does not light, and a body without burns does not either', () => {
    const g = make(['g = Ground()', CAMP3, 'far = Body(Box((1.3, 1.3, 2.7), 0.2, 0.2, 0.2), mass = 1, burns = 3, fixed = true)', `plain = Body(${WOOD3}, mass = 1)`, 'a = far.burning', 'b = far.burnt']);
    play(10, g);
    expect(g.value('a')).toBe(false);
    expect(g.value('b')).toBe(0);
    expect(g.get('plain')?.cell.defined).toBe(true);
  });

  it('a body of burns = <seconds> burns for that long; more seconds burn it away later', () => {
    const when = (s: number): number => {
      const g = make(['g = Ground()', CAMP3, `wood = Body(${WOOD3}, mass = 1, burns = ${s})`]);
      for (let k = 1; k <= 60 * 40; k++) {
        g.setClock(k / 60);
        if (!g.get('wood')?.cell.defined) return k / 60;
      }
      return Infinity;
    };
    const a = when(2);
    const b = when(8);
    expect(a).toBeLessThan(40);
    expect(b).toBeGreaterThan(a);
  });

  it('burns = true is 10 s a kg, at least 1 s: a body of 0.05 kg burns away in about a second of burning', () => {
    const g = make(['g = Ground()', CAMP3, `wood = Body(${WOOD3}, mass = 0.05, burns = true)`]);
    let gone: number | undefined;
    for (let k = 1; k <= 60 * 20 && gone === undefined; k++) {
      g.setClock(k / 60);
      if (!g.get('wood')?.cell.defined) gone = k / 60;
    }
    expect(gone).toBeDefined();
    // a body of 10 kg takes ten times as long to burn
    const h = make(['g = Ground()', CAMP3, `wood = Body(${WOOD3}, mass = 10, burns = true)`]);
    play(gone as number + 1, h);
    expect(h.get('wood')?.cell.defined).toBe(true);
  });

  it('joints to a body that burns away break: a notice for the joint at the time the body burnt, once; the other body is untouched', () => {
    const g = make([...BODY3, `rock = Body(${ROCK3}, mass = 2)`, 'w = Weld(wood, rock)', 'wb = w.broken']);
    expect(g.value('wb')).toBe(false);
    play(30, g);
    expect(g.get('wood')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
    const notes = g.takeWarnings();
    expect(notes.filter((n) => n.kind === 'burnt').length).toBe(1);
    const broke = notes.filter((n) => n.kind === 'broken');
    expect(broke.length).toBe(1);
    expect(broke[0]?.message).toMatch(/^w broke at t = /);
    const cell = g.get('w')?.cell as { defined: boolean };
    expect(cell.defined === false || g.value('wb') === true).toBe(true);
    expect(g.get('rock')?.cell.defined).toBe(true);
  });

  it('what rested on a body that burnt away wakes and falls', () => {
    const g = make(['g = Ground()', `cold = Fire(${BOX3}, 12)`, 'crate = Body(Box((0.5, 0, 0.2), 0.5, 0.5, 0.4), mass = 1, burns = 1)', 'ball = Body(Sphere((0.5, 0, 0.55), 0.15), mass = 0.2)', 'bz = ball.z']);
    play(3, g);
    expect(g.value('bz') as number).toBeCloseTo(0.55, 1);
    all(['Ignite(crate)'], g);
    const r = firstNotice(g, 'burnt', 12, true);
    expect(r.at, 'the crate never burnt away').toBeDefined();
    play((r.at as number) + 1.5, g);
    expect(g.value('bz') as number).toBeLessThan(0.3);
  });

  it('Ignite(b) lights a body at once, with no fire round it but a fire grid: b.burning is true and it burns away', () => {
    const g = make(['g = Ground()', `cold = Fire(${BOX3}, 12)`, 'wood = Body(Box((0.5, 0, 0.2), 0.5, 0.5, 0.4), mass = 1, burns = 2)', 'bn = wood.burning', 'bur = wood.burnt']);
    play(2, g);
    expect(g.value('bn')).toBe(false);
    expect(g.value('bur')).toBe(0);
    all(['Ignite(wood)'], g);
    play(2.1, g);
    expect(g.value('bn')).toBe(true);
    expect(g.value('bur') as number).toBeGreaterThan(0);
    expect(g.takeWarnings().filter((w) => w.kind === 'burnt').length).toBe(0);
    play(8, g);
    expect(g.get('wood')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
    expect(g.takeWarnings().filter((w) => w.kind === 'burnt').length).toBe(1);
    // the burning body heated the grid it sat in
    expect(maxTemp('cold', g)).toBeGreaterThan(0);
  });

  it('Ignite works in a handler: the body lights after the hit, not before', () => {
    const lines = ['g = Ground()', `cold = Fire(${BOX3}, 12)`, 'wood = Body(Box((1.1, 0, 0.2), 0.4, 0.4, 0.4), mass = 1, burns = 2)', 'ball = Body(Sphere((-1, 0, 1.5), 0.2))', 'bn = wood.burning'];
    const g = make(lines);
    all(['on ball hit: Ignite(wood)'], g);
    play(0.3, g);
    expect(g.value('bn')).toBe(false);
    play(1.6, g);
    expect(g.value('bn')).toBe(true);
    play(8, g);
    expect(g.get('wood')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
    const h = make(lines);
    play(8, h);
    expect(h.value('bn')).toBe(false);
  });

  it('Ignite of a list item lights that item, and is logged per item as name[k]', () => {
    const g = make(['g = Ground()', `cold = Fire(${BOX3}, 12)`, 'row = Bodies([Box((-0.8, 0, 0.2), 0.3, 0.3, 0.4), Box((0.8, 0, 0.2), 0.3, 0.3, 0.4)])', 'row with burns = 2', 'ba = row[1].burning', 'bb = row[2].burning']);
    play(0.5, g);
    expect(g.value('bb')).toBe(false);
    all(['Ignite(row[2])'], g);
    play(1.5, g);
    expect(g.value('bb')).toBe(true);
    expect(g.value('ba')).toBe(false);
    expect(g.toScript()).toMatch(/@input physics ignite row\[2\]/);
  });
});

describe('burns and Ignite: a sheet in space (design 9.7, 9.8; R11.4)', () => {
  const CURTAIN3 = ['g = Ground()', CAMP3, 'curtain = Cloth((-0.6, 0, 2.3), (1.2, 0, 0), (0, 0, -1.4), 13, 8, mass = 0.3, pins = "top", burns = 1)', 'cb = curtain.burnt', 'ct = curtain.torn'];

  it('a sheet with burns over a fire burns cell by cell: c.burnt grows from 0, links tear with no tears given, and the torn notice comes', () => {
    const g = make(CURTAIN3);
    expect(g.value('cb')).toBe(0);
    expect(g.value('ct')).toBe(0);
    let prev = 0;
    const seen: number[] = [];
    for (let s = 1; s <= 20; s++) {
      play(s, g);
      const b = g.value('cb') as number;
      expect(b).toBeGreaterThanOrEqual(prev);
      expect(b).toBeLessThanOrEqual(1);
      prev = b;
      seen.push(b);
    }
    expect(prev, `c.burnt over 20 s: ${seen.join(', ')}`).toBeGreaterThan(0);
    expect(g.value('ct') as number).toBeGreaterThan(0);
  });

  it('the links a burnt cell tears bring the torn notice, once for each tear, as any tear does (design 9.5 "Tearing", 9.7)', () => {
    const g = make(CURTAIN3);
    play(12, g);
    expect(g.value('ct') as number).toBeGreaterThan(0);
    const torn = g.takeWarnings().filter((w) => w.kind === 'torn');
    expect(torn.length, 'links tore with no torn notice').toBeGreaterThan(0);
    expect(torn[0]?.message).toMatch(/^curtain tore at t = /);
  });

  it('the sheet tears where it burns: a sheet far from the fire stays whole, and one with no burns never tears in the same fire', () => {
    const g = make(['g = Ground()', `fire = Fire(Box((0, 0, 1.5), 4, 4, 3), 20, ${SRC3})`, 'far = Cloth((1.5, 0, 2.9), (0.5, 0, 0), (0, 0, -0.4), 6, 4, mass = 0.1, pins = "top", burns = 1)', 'ft = far.torn', 'fb = far.burnt', 'plain = Cloth((-0.6, 0, 2.3), (1.2, 0, 0), (0, 0, -1.4), 13, 8, mass = 0.3, pins = "top")', 'pt = plain.torn']);
    play(8, g);
    expect(g.value('ft')).toBe(0);
    expect(g.value('fb')).toBe(0);
    play(12, g);
    expect(g.value('pt')).toBe(0);
  });

  it('the torn links are where the cells burnt: the sheet is whole at its far top row while the part over the fire has holes', () => {
    const g = make(CURTAIN3);
    play(12, g);
    const c = cloth('curtain', g);
    expect(c.torn).toBeGreaterThan(0);
    expect(g.value('cb') as number).toBeGreaterThan(0);
    expect(Array.from(c.cut).some((b) => b !== 0)).toBe(true);
  });

  it('Ignite(sheet) lights every cell not yet burnt: the whole sheet burns away to burnt = 1', () => {
    const g = make(['g = Ground()', `cold = Fire(${BOX3}, 16)`, 'flag = Cloth((-0.6, 0, 2.0), (1.2, 0, 0), (0, 0, -1), 10, 6, mass = 0.2, pins = "top", burns = 1)', 'cb = flag.burnt', 'ct = flag.torn']);
    play(1, g);
    expect(g.value('cb')).toBe(0);
    all(['Ignite(flag)'], g);
    play(10, g);
    expect(g.value('cb') as number).toBeGreaterThan(0.9);
    expect(g.value('ct') as number).toBeGreaterThan(0);
  });
});

describe('Cloth in a grid feels its flow as wind (design 9.5 Air, 9.8; R11.7)', () => {
  /** A flat sheet held at its four corners 1.8 m up, over the fire's source. */
  const TAUT = ['taut = Cloth((-0.8, -0.8, 1.8), (1.6, 0, 0), (0, 1.6, 0), 12, 12, mass = 0.05, pins = [(-0.8, -0.8, 1.8), (0.8, -0.8, 1.8), (-0.8, 0.8, 1.8), (0.8, 0.8, 1.8)])'];
  /** A flag held along its left edge, 2 m up, which hangs down in still air. */
  const FLAG3 = ['flag = Cloth((-0.8, -0.5, 2), (1.6, 0, 0), (0, 1, 0), 12, 8, mass = 0.1, pins = "left")'];
  const meanZ = (name: string, fig: Figure): number => {
    const zs = cloth(name, fig).zs;
    return zs.reduce((a, b) => a + b, 0) / zs.length;
  };
  /** The distance the sheet's points travel over `t` s, sampled every 1/6 s, the mean over the points. */
  const travel = (name: string, fig: Figure, t: number): number => {
    let prev = Float64Array.from(cloth(name, fig).zs);
    let path = 0;
    for (let k = 1; k <= Math.round(t * 6); k++) {
      play(k / 6, fig);
      const now = cloth(name, fig).zs;
      let s = 0;
      for (let i = 0; i < now.length; i++) s += Math.abs((now[i] as number) - (prev[i] as number));
      path += s / now.length;
      prev = Float64Array.from(now);
    }
    return path;
  };
  /** The largest gap between the mean heights of one sheet in two figures, sampled every 1/6 s up to `t`. */
  const gap = (name: string, a: Figure, b: Figure, t: number): number => {
    let worst = 0;
    for (let k = 1; k <= Math.round(t * 6); k++) {
      play(k / 6, a);
      play(k / 6, b);
      worst = Math.max(worst, Math.abs(meanZ(name, a) - meanZ(name, b)));
    }
    return worst;
  };

  it('a sheet above a fire moves more than the same sheet over a cold grid, and ends somewhere else', () => {
    const hot = make([...TAUT, CAMP3]);
    const cold = make([...TAUT, `cold = Fire(${BOX3}, 16)`]);
    const pathHot = travel('taut', hot, 3);
    const pathCold = travel('taut', cold, 3);
    expect(pathHot).toBeGreaterThan(pathCold);
    expect(Math.abs(meanZ('taut', hot) - meanZ('taut', cold))).toBeGreaterThan(0.05);
    let worst = 0;
    const a = cloth('taut', hot).zs;
    const b = cloth('taut', cold).zs;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs((a[i] as number) - (b[i] as number)));
    expect(worst).toBeGreaterThan(0.1);
  });

  it('a flag over a fire ripples differently from the same flag over a cold grid', () => {
    const hot = make([...FLAG3, CAMP3]);
    const cold = make([...FLAG3, `cold = Fire(${BOX3}, 16)`]);
    expect(gap('flag', hot, cold, 3)).toBeGreaterThan(0.1);
  });

  it('a sheet in a grid whose air is still gains no energy: the flag never rises above where it was let go (design 9.5 "still air")', () => {
    const calm = make([...FLAG3, `sm = Smoke(${BOX3}, 12)`]);
    let top = -Infinity;
    for (let k = 1; k <= 180; k++) {
      calm.setClock(k / 60);
      top = Math.max(top, ...Array.from(cloth('flag', calm).zs));
    }
    expect(top).toBeLessThanOrEqual(2 + 1e-6);
    expect(meanZ('flag', calm)).toBeLessThan(1.6);
  });

  it('the wind of a smoke\'s own `wind` blows the sheet too: a wind up in z lifts the held sheet', () => {
    const windy = make([...TAUT, `sm = Smoke(${BOX3}, 12, wind = (0, 0, 4))`]);
    const calm = make([...TAUT, `sm = Smoke(${BOX3}, 12)`]);
    play(2, windy);
    play(2, calm);
    expect(meanZ('taut', windy) - meanZ('taut', calm)).toBeGreaterThan(0.05);
  });
});

describe('errors: B020 not_burnable, B021 no_fire_grid in space (errors.md 3)', () => {
  it('Ignite of a body in space with no burns is not_burnable (B020), with the suggestion to add burns', () => {
    all([`cold = Fire(${BOX3}, 12)`, 'b = Body(Box((0, 0, 1), 1, 1, 1))']);
    const e = fail('Ignite(b)');
    expect(e.kind).toBe('not_burnable');
    expect(e.message).toMatch(/^b can't burn yet\./);
    expect(e.hint).toMatch(/Add `?b with burns = true`? first\./);
    expect(e.suggest).toEqual(['b with burns = true']);
    expect(e.code).toMatch(/^(B020|C139)$/);
    all(['b with burns = true', 'Ignite(b)']);
  });

  it('Ignite of a thing with burns = false is not_burnable too', () => {
    all([`cold = Fire(${BOX3}, 12)`, 'b = Body(Box((0, 0, 1), 1, 1, 1), burns = false)']);
    expect(fail('Ignite(b)').kind).toBe('not_burnable');
  });

  it('Ignite of a sheet with no burns is not_burnable', () => {
    all([`cold = Fire(${BOX3}, 12)`, 'plain = Cloth((0, 0, 2), (1, 0, 0), (0, 0, -1), 6, 6)']);
    expect(fail('Ignite(plain)').kind).toBe('not_burnable');
  });

  it('burns or ignite on a point or a grid is not_burnable at typecheck', () => {
    all(['P = (0, 0, 0)', `sm = Smoke(${BOX3}, 8)`]);
    for (const l of ['P with burns = true', 'sm with burns = true', 'P with ignite = 300', 'sm with ignite = 300']) expect(fail(l).kind, l).toBe('not_burnable');
    expect(fail('Ignite(P)').kind).toBe('not_burnable');
    expect(fail('Ignite(sm)').kind).toBe('not_burnable');
  });

  it('Ignite of a burnable body outside every fire is no_fire_grid (B021), with the suggestion Fire(b.pos)', () => {
    all([`cold = Fire(${BOX3}, 12)`, 'far = Body(Box((20, 0, 1), 1, 1, 1), burns = true)']);
    const e = fail('Ignite(far)');
    expect(e.kind).toBe('no_fire_grid');
    expect(`${e.message} ${e.hint ?? ''}`).toContain('Nothing can burn outside a fire. Make a fire round far.');
    expect(e.suggest).toEqual(['fire = Fire(far.pos)']);
    expect(e.code).toMatch(/^(B021|C140)$/);
  });

  it('with no fire in the figure at all Ignite is no_fire_grid; a fire made round the body, as suggested, makes it work', () => {
    all(['b = Body(Box((0, 0, 1), 1, 1, 1), burns = true)']);
    const e = fail('Ignite(b)');
    expect(e.kind).toBe('no_fire_grid');
    expect(e.suggest).toEqual(['fire = Fire(b.pos)']);
    all(['fire = Fire(b.pos)', 'Ignite(b)']);
  });

  it('Ignite of a sheet outside every fire is no_fire_grid', () => {
    all([`cold = Fire(${BOX3}, 12)`, 'c = Cloth((20, 0, 2), (1, 0, 0), (0, 0, -1), 6, 6, burns = true)']);
    expect(fail('Ignite(c)').kind).toBe('no_fire_grid');
  });

  it('ignite outside 150 to 1,000 °C is refused with bad_property_value; the limits and the default are accepted', () => {
    for (const v of ['149', '100', '1001', '5000', '-5']) expect(fail(`b = Body(Box((0, 0, 1), 1, 1, 1), burns = true, ignite = ${v})`).kind, `ignite = ${v}`).toBe('bad_property_value');
    for (const v of ['150', '1000', '400']) all([`b = Body(Box((0, 0, 1), 1, 1, 1), burns = true, ignite = ${v})`]);
    all(['q = Body(Box((5, 0, 1), 1, 1, 1), burns = true)', 'q with ignite = 300']);
    expect(fail('q with ignite = 1200').kind).toBe('bad_property_value');
    expect(fail('q with ignite = 100').kind).toBe('bad_property_value');
  });

  it('burns takes true, false or a number of seconds, and nothing else', () => {
    all(['a = Body(Box((0, 0, 1), 1, 1, 1), burns = true)', 'b = Body(Box((3, 0, 1), 1, 1, 1), burns = false)', 'c = Body(Box((6, 0, 1), 1, 1, 1), burns = 4)', 'a with burns = 2.5']);
    expect(fail('d = Body(Box((9, 0, 1), 1, 1, 1), burns = "yes")').kind).toMatch(/no_matching_form|bad_property_value/);
  });

  const burner = (k: number): string => `b${k} = Body(Box((${((k % 8) - 3.5) * 0.3}, ${(Math.floor(k / 8) - 3.5) * 0.3}, 2), 0.1, 0.1, 0.1), burns = true)`;

  it('a 65th sheet with burns in space is refused with limit, naming the 64 (the sheets count with the bodies)', () => {
    all([`cold = Fire(${BOX3}, 8)`]);
    for (let k = 0; k < 64; k++) all([`c${k} = Cloth((${((k % 8) - 4) * 0.3}, ${(Math.floor(k / 8) - 4) * 0.3}, 2), (0.1, 0, 0), (0, 0.1, 0), 3, 3, burns = true)`]);
    const e = fail('late = Cloth((0, 0, 1), (0.1, 0, 0), (0, 0.1, 0), 3, 3, burns = true)');
    expect(e.kind).toBe('limit');
    expect(e.message).toContain('64');
    expect(fail('late = Body(Box((0, 0, 1), 0.1, 0.1, 0.1), burns = true)').kind).toBe('limit');
  });

  it('the 65th thing with burns in space is refused with limit, naming the 64; the 64 before it are accepted and play', () => {
    const lines = ['g = Ground()', `cold = Fire(${BOX3}, 8)`];
    for (let k = 0; k < 64; k++) lines.push(burner(k));
    all(lines);
    const e = fail(burner(64));
    expect(e.kind).toBe('limit');
    expect(e.message).toContain('64');
    expect(f.get('b64')).toBeUndefined();
    play(1);
    expect(f.takeWarnings().map((w) => w.kind)).not.toContain('unstable_world');
  });
});

describe('checkpoints with a grid in space (design 9.8, 10.3)', () => {
  it('a checkpoint of a 24³ fire is about 399.7 KB', () => {
    const g = make(['fire = Fire((0, 0, 0))']);
    play(1, g);
    const kb = physics3Of(g).checkpointBytes() / 1024;
    expect(kb).toBeGreaterThan(385);
    expect(kb).toBeLessThan(410);
  });

  it('60 s of film with a 24³ grid fits the 32 MB of checkpoints: no checkpoints_thinned notice', () => {
    const g = make(['fire = Fire((0, 0, 0))']);
    const r = firstNotice(g, 'checkpoints_thinned', 60);
    expect(r.count).toBe(0);
    expect(r.at).toBeUndefined();
  });

  it('a 32³ grid (0.95 MB a checkpoint) is thinned after about 30 s: the notice checkpoints_thinned comes between 25 s and 45 s', () => {
    const g = make([`fire = Fire(${BOX3}, 32, ${SRC3})`]);
    const r = firstNotice(g, 'checkpoints_thinned', 45);
    expect(r.at, 'no checkpoints_thinned in 45 s').toBeDefined();
    expect(r.at as number).toBeGreaterThan(25);
  });
});

describe('the exact film with fire in space (design 10; R11.9)', () => {
  /** Fire, a burning crate and a flag over them, all on one floor. */
  const FILM3 = [
    'g = Ground()', CAMP3,
    `wood = Body(${WOOD3}, mass = 1, burns = 3)`,
    'flag = Cloth((-0.8, -0.5, 1.6), (1.6, 0, 0), (0, 1, 0), 12, 8, mass = 0.1, pins = "left", burns = 2)',
    'bur = wood.burnt', 'tm = wood.temperature', 'cb = flag.burnt', 'ct = flag.torn',
  ];
  const PROBES = ['bur', 'tm', 'cb', 'ct'];

  const snapshot = (fig: Figure): { hash: string; temp: number[]; density: number[]; xs: number[]; zs: number[]; cut: number[]; probes: unknown[] } => ({
    hash: hash(fig),
    temp: Array.from(fire('fire', fig).temp),
    density: Array.from(smoke('fire', fig).density),
    xs: Array.from(cloth('flag', fig).xs),
    zs: Array.from(cloth('flag', fig).zs),
    cut: Array.from(cloth('flag', fig).cut),
    probes: PROBES.map((p) => fig.value(p)),
  });

  it('fire, a flag and a burning crate: seek from 0 to 5 s equals play to 5 s, to the last bit, and so does seeking back and forth', () => {
    const a = make(FILM3);
    play(5, a);
    expect(a.value('bur') as number).toBeGreaterThan(0);
    const want = snapshot(a);
    const b = make(FILM3);
    seek(b, 5);
    expect(snapshot(b)).toEqual(want);
    seek(b, 2.3);
    seek(b, 5);
    expect(snapshot(b)).toEqual(want);
    seek(b, 0);
    seek(b, 5);
    expect(snapshot(b)).toEqual(want);
  });

  it('seek equals play at frames either side of the checkpoints every second (59/60 s, 1 s, 61/60 s, 2.5 s, 239/60 s, 4.2 s), in any order', () => {
    const frames = [18, 59, 60, 61, 150, 239, 252, 300];
    const ref = make(FILM3);
    const want = new Map<number, ReturnType<typeof snapshot>>();
    for (let m = 1; m <= 300; m++) {
      ref.setClock(m / 60);
      if (frames.includes(m)) want.set(m, snapshot(ref));
    }
    const b = make(FILM3);
    for (const m of [239, 59, 300, 61, 18, 252, 60, 150, 59]) {
      seek(b, m / 60);
      expect(snapshot(b), `frame ${m}`).toEqual(want.get(m));
    }
  });

  it('a body that burns away: seek equals play, the notice shows once, the body reads undefined at the right times, and seeking back brings it back', () => {
    const lines = ['g = Ground()', CAMP3, `wood = Body(${WOOD3}, mass = 1, burns = 2)`, `rock = Body(${ROCK3}, mass = 2)`, 'w = Weld(wood, rock)', 'bur = wood.burnt'];
    const a = make(lines);
    play(15, a);
    expect(a.get('wood')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
    const b = make(lines);
    seek(b, 15);
    expect(hash(b)).toBe(hash(a));
    expect(b.get('wood')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
    expect(b.value('w')).toEqual(a.value('w'));
    seek(b, 0.5);
    expect(b.get('wood')?.cell.defined).toBe(true);
    expect(b.value('bur')).toBe(0);
    seek(b, 15);
    expect(hash(b)).toBe(hash(a));
    b.takeWarnings();
    seek(b, 0.5);
    seek(b, 15);
    expect(b.takeWarnings().filter((w) => w.kind === 'burnt').length).toBeLessThanOrEqual(1);
  });

  it('the same film twice gives the same fire every second', () => {
    const a = make(FILM3);
    const b = make(FILM3);
    for (let s = 1; s <= 5; s++) {
      play(s, a);
      play(s, b);
      expect(hash(b), `t = ${s}`).toBe(hash(a));
    }
  });

  it('the physics-kernels switch gives the same film: kernels off and on, temperature, density, the flag and the crate to the bit', () => {
    const film = (kernels: boolean): ReturnType<typeof snapshot> => {
      setPhysicsKernels(kernels);
      const g = make(FILM3);
      play(4, g);
      return snapshot(g);
    };
    const on = film(true);
    const off = film(false);
    expect(Math.max(...on.temp)).toBeGreaterThan(150);
    expect(off).toEqual(on);
  });

  it('Ignite as a line: seek equals play after it, the script keeps it as an @input line, and a reload plays the same', () => {
    const lines = ['g = Ground()', `cold = Fire(${BOX3}, 16)`, 'wood = Body(Box((0.5, 0, 0.2), 0.5, 0.5, 0.4), mass = 1, burns = 8)', 'bur = wood.burnt'];
    const a = make(lines);
    play(1, a);
    all(['Ignite(wood)'], a);
    play(5, a);
    expect(a.value('bur') as number).toBeGreaterThan(0);
    const script = a.toScript();
    expect(script).toMatch(/@input physics ignite wood/);
    const { figure: b } = Figure.fromScript(script, { commands: REG });
    seek(b, 5);
    expect(hash(b)).toBe(hash(a));
    expect(b.value('bur')).toBe(a.value('bur'));
    expect(Array.from(fire('cold', b).temp)).toEqual(Array.from(fire('cold', a).temp));
    seek(b, 0.5);
    expect(b.value('bur')).toBe(0);
    seek(b, 1.5);
    expect(b.value('bur') as number).toBeGreaterThan(0);
    seek(b, 5);
    expect(hash(b)).toBe(hash(a));
    const c = make(lines);
    play(5, c);
    expect(hash(c)).not.toBe(hash(a));
  });

  it('Ignite in a handler: seek equals play, and a reload of the saved script plays the same without running the handler twice', () => {
    const lines = ['g = Ground()', `cold = Fire(${BOX3}, 12)`, 'wood = Body(Box((1.1, 0, 0.2), 0.4, 0.4, 0.4), mass = 1, burns = 2)', 'ball = Body(Sphere((-1, 0, 1.5), 0.2))', 'on ball hit: Ignite(wood)', 'bur = wood.burnt'];
    const a = make(lines);
    play(6, a);
    expect(a.get('wood')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
    const script = a.toScript();
    expect(script).toMatch(/@input physics ignite wood/);
    const { figure: b } = Figure.fromScript(script, { commands: REG });
    seek(b, 6);
    expect(hash(b)).toBe(hash(a));
    seek(b, 1);
    seek(b, 6);
    expect(hash(b)).toBe(hash(a));
  });

  it('Ignite of a sheet: seek equals play, and a reload of the script plays the same', () => {
    const lines = ['g = Ground()', `cold = Fire(${BOX3}, 12)`, 'flag = Cloth((-0.6, 0, 2.0), (1.2, 0, 0), (0, 0, -1), 10, 6, mass = 0.2, pins = "top", burns = 1)', 'cb = flag.burnt'];
    const a = make(lines);
    play(1, a);
    all(['Ignite(flag)'], a);
    play(5, a);
    expect(a.value('cb') as number).toBeGreaterThan(0);
    const { figure: b } = Figure.fromScript(a.toScript(), { commands: REG });
    seek(b, 5);
    expect(hash(b)).toBe(hash(a));
    expect(b.value('cb')).toBe(a.value('cb'));
    expect(Array.from(cloth('flag', b).cut)).toEqual(Array.from(cloth('flag', a).cut));
  });

  it('a fire that goes out: fire_out comes once, and seek equals play across it', () => {
    const a = make([STOPPED3]);
    const r = firstNotice(a, 'fire_out', 40);
    expect(r.count).toBe(1);
    const b = make([STOPPED3]);
    seek(b, 40);
    expect(hash(b)).toBe(hash(a));
    expect(Array.from(fire('fire', b).temp)).toEqual(Array.from(fire('fire', a).temp));
    expect(fire('fire', b).out).toBe(true);
  });

  it('a smoke in a figure with water and a body: seek equals play, to the last bit', () => {
    const lines = ['g = Ground()', `sm = Smoke(${BOX3}, 16, source = Sphere((0, 0, 0.4), 0.3), heat = 6)`, 'ball = Body(Sphere((0.3, 0, 1.4), 0.25), mass = 0.05)', 'rain = Liquid(Box((0, 0, 2.2), 0.8, 0.8, 0.5), 200)'];
    const a = make(lines);
    play(3, a);
    const b = make(lines);
    seek(b, 3);
    expect(hash(b)).toBe(hash(a));
    expect(Array.from(smoke('sm', b).density)).toEqual(Array.from(smoke('sm', a).density));
    expect(b.value('ball')).toEqual(a.value('ball'));
    seek(b, 1.2);
    seek(b, 3);
    expect(hash(b)).toBe(hash(a));
  });
});

/* ------------------------------ the fix round (findings PH-30 to PH-34, handoff/physics/findings.md) ------------------------------ */

describe('fix round: PH-30 Ignite of a sheet in space, PH-31 the torn notice', () => {
  const sheet = (burns: string): string[] => ['cold = Fire(Box((0, 0, 1.5), 3, 3, 3), 16)', `flag = Cloth((-0.6, 0, 2), (1.2, 0, 0), (0, 0, -1), 10, 6, mass = 0.2, pins = "top"${burns})`, 'fb = flag.burnt', 'ft = flag.torn'];

  it('PH-30: Ignite(sheet) in space reaches the space driver: the sheet is lit at once, burns away, and the script keeps the @input line', () => {
    all(sheet(', burns = 1'));
    play(1);
    expect(f.value('fb')).toBe(0);
    all(['Ignite(flag)']);
    play(5);
    expect(f.value('fb') as number).toBeGreaterThan(0.9);
    expect(f.toScript()).toMatch(/@input physics ignite flag at /);
  });

  it('PH-30: burns given as a number of seconds, and a sheet with none (not_burnable), reach the same driver', () => {
    all(sheet(', burns = 2.5'));
    all(['Ignite(flag)']);
    play(1);
    expect(f.value('fb'), 'lit, none burnt away yet').toBe(0);
    expect(cloth('flag').spec.burns).toBe(2.5);
    play(4);
    expect(f.value('fb') as number).toBeGreaterThan(0.9);
    const g = make(sheet(''));
    expect(fail('Ignite(flag)', g).kind).toBe('not_burnable');
  });

  it('PH-31: a sheet lit by Ignite tears where it burns, and the torn notice comes once, with the links torn so far', () => {
    all(sheet(', burns = 1'));
    all(['Ignite(flag)']);
    let first: { t: number; links: number } | undefined;
    let count = 0;
    for (let k = 1; k <= 60 * 6; k++) {
      f.setClock(k / 60);
      for (const w of f.takeWarnings()) {
        if (w.kind !== 'torn') continue;
        count++;
        first ??= { t: k / 60, links: (w.params as { links?: number }).links ?? -1 };
      }
    }
    expect(count, 'one torn notice').toBe(1);
    expect(first?.links, 'the notice counts the links torn').toBeGreaterThan(0);
    expect(f.value('ft') as number).toBeGreaterThanOrEqual(first?.links ?? Infinity);
  });

  it('PH-31: the links torn by burning are counted the same in a figure reloaded and sought to the end', () => {
    const a = make(sheet(', burns = 1'));
    all(['Ignite(flag)'], a);
    play(6, a);
    const b = Figure.fromScript(a.toScript(), { commands: REG }).figure;
    seek(b, 6);
    expect(b.value('ft')).toBe(a.value('ft'));
    expect(b.value('ft') as number).toBeGreaterThan(0);
    expect(hash(b)).toBe(hash(a));
  });
});

describe('fix round: PH-32 the suggestion of no_fire_grid, PH-33 the 64 in space', () => {
  it('PH-32: a body outside a fire that is already the one grid in space still gets Fire(b.pos) as the suggestion, and the hint says there is one grid', () => {
    all([`cold = Fire(${BOX3}, 12)`, 'far = Body(Box((20, 0, 1), 1, 1, 1), burns = true)']);
    const e = fail('Ignite(far)');
    expect(e.kind).toBe('no_fire_grid');
    expect(e.suggest).toEqual(['fire = Fire(far.pos)']);
    expect(e.hint ?? '').toMatch(/one smoke or fire grid in space/);
  });

  it('PH-32: the same for a sheet (where it is) and for a solid shape', () => {
    all([`cold = Fire(${BOX3}, 12)`, 'c = Cloth((20, 0, 2), (1, 0, 0), (0, 0, -1), 6, 6, burns = true)', 'wall = Box((20, 5, 1), 1, 1, 1)', 'wall with solid = true, burns = true']);
    const e = fail('Ignite(c)');
    expect(e.suggest?.length).toBe(1);
    expect(e.suggest?.[0]).toMatch(/^fire = Fire\(\(/);
    expect(fail('Ignite(wall)').kind).toBe('no_fire_grid');
  });

  it('PH-32: with no fire at all the suggestion is still offered, and the line works', () => {
    all(['b = Body(Box((0, 0, 1), 1, 1, 1), burns = true)']);
    expect(fail('Ignite(b)').suggest).toEqual(['fire = Fire(b.pos)']);
  });

  const body = (k: number, extra = 'burns = true'): string => `b${k} = Body(Box((${(k % 10) * 0.4}, ${Math.floor(k / 10) * 0.4}, 2), 0.1, 0.1, 0.1)${extra === '' ? '' : `, ${extra}`})`;

  it('PH-33: bodies, sheets and solid shapes in space count together; the 65th of any kind is limit, and a with burns line counts', () => {
    all([`cold = Fire(${BOX3}, 8)`]);
    for (let k = 0; k < 40; k++) all([body(k)]);
    for (let k = 0; k < 23; k++) all([`c${k} = Cloth((${k * 0.1}, 3, 2), (0.1, 0, 0), (0, 0.1, 0), 3, 3, burns = true)`]);
    all(['plank = Box((0, -3, 1), 1, 1, 0.2)', 'plank with solid = true, burns = true']);
    expect(fail(body(90)).kind, 'a 65th body').toBe('limit');
    expect(fail('late = Cloth((0, 3, 1), (0.1, 0, 0), (0, 0.1, 0), 3, 3, burns = true)').kind, 'a 65th sheet').toBe('limit');
    all([body(91, '')]);
    expect(fail('b91 with burns = true').kind, 'a with burns on a 65th').toBe('limit');
    expect(fail('b91 with burns = 3').kind, 'a number of seconds counts').toBe('limit');
    all(['b91 with burns = false']);
    all(['b0 with burns = false', 'b91 with burns = true']);
  });

  it('PH-33: a list of bodies in space counts each item', () => {
    all([`cold = Fire(${BOX3}, 8)`]);
    for (let k = 0; k < 60; k++) all([body(k)]);
    // four of the list fit (64); the fifth item is the 65th
    all(['row = Bodies([Box((5, 0, 2), 0.1, 0.1, 0.1), Box((5, 1, 2), 0.1, 0.1, 0.1), Box((5, 2, 2), 0.1, 0.1, 0.1), Box((5, 3, 2), 0.1, 0.1, 0.1)])', 'row with burns = 2']);
    all(['more = Bodies([Box((6, 0, 2), 0.1, 0.1, 0.1), Box((6, 1, 2), 0.1, 0.1, 0.1)])']);
    expect(fail('more with burns = 2').kind).toBe('limit');
  });
});

describe('fix round: PH-34 a solid shape that burns in space (design 9.7 "A solid shape", 9.8)', () => {
  const SHELF = ['g = Ground()', 'cold = Fire(Box((0, 0, 1.5), 3, 3, 3), 12)', 'shelf = Box((0, 0, 1), 1.6, 1.6, 0.2)', 'shelf with solid = true, burns = 1', 'ball = Body(Sphere((0, 0, 1.3), 0.2))', 'bz = ball.z'];

  it('burns on a solid in space is accepted (a polyhedron, a sphere), and refused on what cannot burn', () => {
    all(['a = Box((0, 0, 1), 1, 1, 1)', 'a with solid = true, burns = true', 'b = Sphere((3, 0, 1), 0.5)', 'b with solid = true, burns = 3', 'P = (0, 0, 0)']);
    expect(fail('P with burns = true').kind).toBe('not_burnable');
  });

  it('the ball on a burnt shelf falls: the ball sleeps on the shelf, the shelf burns away after Ignite and the ball is back on the ground soon after the burnt notice', () => {
    all(SHELF);
    play(3);
    expect(physics3Of(f).world?.awake[2], 'the ball sleeps on the shelf').toBe(0);
    expect(f.value('bz') as number).toBeCloseTo(1.3, 2);
    all(['Ignite(shelf)']);
    const r = firstNotice(f, 'burnt', 12, true);
    expect(r.at, 'the shelf never burnt away').toBeDefined();
    play((r.at as number) + 1.5);
    expect(f.value('bz') as number).toBeLessThan(0.3);
  });

  it('the shelf reads undefined with the reason burnt, the notice comes once, and what lights the shelf is the fire: a shelf over the flames burns without Ignite', () => {
    all(['g = Ground()', 'fire = Fire(Box((0, 0, 1.5), 3, 3, 3), 16, source = Sphere((0, 0, 0.3), 0.3))', 'shelf = Box((0, 0, 0.9), 1.2, 1.2, 0.2)', 'shelf with solid = true, burns = 1']);
    const r = firstNotice(f, 'burnt', 15);
    expect(r.at, 'the shelf never burnt away').toBeDefined();
    expect(r.count).toBe(1);
    expect(f.get('shelf')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
  });

  it('seek equals play across the burn; seeking back before it gives the shelf back; a reload of the script plays the same', () => {
    const a = make(SHELF);
    play(2, a);
    all(['Ignite(shelf)'], a);
    play(7, a);
    expect(a.get('shelf')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
    const b = Figure.fromScript(a.toScript(), { commands: REG }).figure;
    seek(b, 7);
    expect(b.get('shelf')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
    expect(hash(b)).toBe(hash(a));
    seek(b, 2.5);
    expect(b.get('shelf')?.cell.defined, 'before the burn the shelf is there').toBe(true);
    expect(b.value('bz') as number).toBeCloseTo(1.3, 1);
    seek(b, 7);
    expect(b.get('shelf')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
    expect(hash(b)).toBe(hash(a));
    expect(b.value('bz')).toEqual(a.value('bz'));
  });

  it('a line changed after the shelf burnt away does not bring it back or start the film again', () => {
    all(SHELF);
    play(2);
    all(['Ignite(shelf)']);
    play(6);
    const before = f.value('bz');
    all(['other = Body(Sphere((3, 3, 2), 0.2))']);
    play(7);
    expect(f.get('shelf')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
    expect(f.value('bz') as number).toBeCloseTo(before as number, 3);
  });

  it('a burning solid sphere reads undefined too; a shelf with no burns and one outside the fire stay', () => {
    all(['g = Ground()', 'cold = Fire(Box((0, 0, 1.5), 3, 3, 3), 12)', 'orb = Sphere((0, 0, 1), 0.4)', 'orb with solid = true, burns = 1', 'plain = Box((1, 0, 1), 0.5, 0.5, 0.5)', 'plain with solid = true', 'far = Box((20, 0, 1), 0.5, 0.5, 0.5)', 'far with solid = true, burns = 1']);
    all(['Ignite(orb)']);
    expect(fail('Ignite(plain)').kind).toBe('not_burnable');
    expect(fail('Ignite(far)').kind).toBe('no_fire_grid');
    play(8);
    expect(f.get('orb')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
    expect(f.get('plain')?.cell.defined).toBe(true);
    expect(f.get('far')?.cell.defined).toBe(true);
  });
});
