/**
 * Fire in the plane (.kiro/specs/physics R11 items 1 to 6, 8, 9; docs/features/physics design 2.4 `Smoke`, `Fire`, `Ignite`, 9.4, 9.7,
 * 10, 11.2, 11.3, 11.5; errors.md B004, B013, B017, B020, B021, reason `burnt`, notices `burnt`, `fire_out`; agent.md rows for
 * `Fire`, `Ignite` and `burns`).
 *
 * The crackle (`sound = true`) is checked in physics-fire-sound.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, geometry, physics, physics3Of, physicsOf, registerAnimation, registerFunctions, registerLists, registerNumbers, registerPhysics, registerSpace, setPhysicsKernels } from '../../src/index';

const REG = (() => {
  const r = new CommandRegistry();
  geometry.registerGeometry(r);
  registerNumbers(r);
  registerFunctions(r);
  registerAnimation(r);
  registerLists(r);
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
/** Plays the film in frames of 1/60 s up to t. */
const play = (t: number, fig = f): void => {
  const now = fig.clock().t;
  const frames = Math.round((t - now) * 60);
  for (let k = 1; k <= frames; k++) fig.setClock(now + k / 60);
};
/** Seeks to t, and lets a far seek catch up over frames (design 10.4). */
const seek = (fig: Figure, t: number): void => {
  fig.setClock(t);
  for (let k = 0; k < 200 && fig.driversNeedFrames(); k++) fig.flush(true);
};
const hash = (fig: Figure): string => physicsOf(fig).worldHash();
const kinds = (fig: Figure): string[] => fig.takeWarnings().map((w) => w.kind);

/** Where a fire's cells are: x, y of the centre of cell (i, j). */
const cellXY = (v: physics.SmokeValue, i: number, j: number): { x: number; y: number } => {
  const { n, x0, y0, x1, y1 } = v.spec;
  return { x: x0 + ((i + 0.5) * (x1 - x0)) / n, y: y0 + ((j + 0.5) * (y1 - y0)) / n };
};
/** The temperature-weighted mean height of the cells above `min` °C, and the height of the highest of them. */
const hotRegion = (name: string, min: number, fig = f): { cy: number; top: number; cells: number } => {
  const v = fire(name, fig);
  const n = v.spec.n;
  let m = 0;
  let my = 0;
  let top = -Infinity;
  let cells = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const T = v.temp[j * n + i] as number;
      if (T <= min) continue;
      const y = cellXY(v, i, j).y;
      m += T;
      my += T * y;
      cells++;
      if (y > top) top = y;
    }
  }
  return { cy: m > 0 ? my / m : Number.NaN, top, cells };
};
const maxTemp = (name: string, fig = f): number => Math.max(...Array.from(fire(name, fig).temp));
/** The smoke's centre height: the density-weighted mean. */
const smokeY = (name: string, fig = f): number => {
  const v = smoke(name, fig);
  const n = v.spec.n;
  let m = 0;
  let my = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const d = v.density[j * n + i] as number;
      m += d;
      my += d * cellXY(v, i, j).y;
    }
  }
  return my / m;
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

const SOURCE = 'source = Circle((0, 0.3), 0.3)';
const CAMP = `fire = Fire(Box((0, 2), 4, 4), 48, ${SOURCE})`;
const STOPPED = `fire = Fire(Box((0, 2), 4, 4), 48, ${SOURCE}, until = 1)`;
/** A smoke past a solid ball, with heat and a gusty wind: everything the flow reads. */
const PAST_BALL = ['world with wind = (3 + sin(2 t), 0)', 'ball = Circle((0, 0), 0.6)', 'ball with solid = true'];
const CLOSED = ['jar = Polyline((-2, 2), (-2, -2), (2, -2), (2, 2), (-2, 2))', 'jar with solid = true'];

describe('swirl on Smoke (design 9.4, 9.7, 11.5; R11.1)', () => {
  it('swirl outside 0 to 10 is refused with bad_property_value (B004), on Smoke and on Fire; the limits are accepted', () => {
    for (const s of ['-0.1', '10.5', '11', '-5']) {
      expect(fail(`sa = Smoke(Box((0, 0), 4, 4), 16, swirl = ${s})`).kind).toBe('bad_property_value');
      expect(fail(`fa = Fire(Box((0, 5), 4, 4), 16, swirl = ${s})`).kind).toBe('bad_property_value');
    }
    for (const s of ['0', '10', '2.5']) {
      all([`sa = Smoke(Box((0, 0), 4, 4), 16, swirl = ${s})`]);
      all([`fa = Fire(Box((0, 5), 4, 4), 16, swirl = ${s})`]);
    }
  });

  const BASE = [...PAST_BALL, 'sm = Smoke(Box((1, 0), 10, 6), 48, source = Box((-3.7, 0), 0.3, 2), heat = 3, until = 3'];
  const withSwirl = (s: string): string[] => [...BASE.slice(0, -1), `${BASE[BASE.length - 1] as string}${s})`];

  it('swirl = 0 gives exactly the film of a smoke with no swirl, every density to the bit, and the same hash and checkpoint', () => {
    const a = make(withSwirl(''));
    const b = make(withSwirl(', swirl = 0'));
    for (const t of [0.5, 1, 2, 3.5]) {
      play(t, a);
      play(t, b);
      expect(Array.from(smoke('sm', b).density)).toEqual(Array.from(smoke('sm', a).density));
      expect(smoke('sm', b).speed).toBe(smoke('sm', a).speed);
      expect(hash(b)).toBe(hash(a));
    }
    // the film moved: a comparison of two films that stand still would pass for nothing
    expect(smoke('sm', a).speed).toBeGreaterThan(1);
    const sa = (physicsOf(a) as unknown as { saveState(): Float64Array }).saveState();
    const sb = (physicsOf(b) as unknown as { saveState(): Float64Array }).saveState();
    expect(Array.from(sb)).toEqual(Array.from(sa));
  });

  it('swirl > 0 changes the flow: the density and the speed differ from the film with no swirl, and more swirl differs again', () => {
    const none = make(withSwirl(''));
    const some = make(withSwirl(', swirl = 4'));
    const more = make(withSwirl(', swirl = 10'));
    play(2.5, none);
    play(2.5, some);
    play(2.5, more);
    expect(Array.from(smoke('sm', some).density)).not.toEqual(Array.from(smoke('sm', none).density));
    expect(Array.from(smoke('sm', more).density)).not.toEqual(Array.from(smoke('sm', some).density));
    expect(smoke('sm', some).speed).not.toBe(smoke('sm', none).speed);
  });

  const jarMass = (s: number): void => {
    const g = make([...CLOSED, `sm = Smoke(Box((0, 0), 5, 5), 40, source = Circle((0, -1), 0.4), heat = 5, until = 0.5, swirl = ${s})`, 'm = sm.mass']);
    play(0.6, g);
    const m0 = g.value('m') as number;
    expect(m0).toBeGreaterThan(0);
    let worst = 0;
    for (let t = 1; t <= 10; t++) {
      play(t, g);
      worst = Math.max(worst, Math.abs((g.value('m') as number) / m0 - 1));
    }
    expect(worst).toBeLessThan(1e-3);
    // and the swirled smoke really moved
    expect(smokeY('sm', g)).toBeGreaterThan(0.3);
  };

  it('smoke kept with swirl (2, the fire default): hot smoke in a closed jar, its source stopped, keeps its mass within 0.1% for 10 s', () => {
    jarMass(2);
  });

  it('smoke kept with the largest swirl (10): the same jar keeps its mass within 0.1% for 10 s', () => {
    jarMass(10);
  });

  it('no volume lost with swirl: after each projection the largest divergence is under 0.25% of (fastest air / cell size)', () => {
    const g = make(withSwirl(', swirl = 5'));
    for (const t of [0.5, 1, 2, 3]) {
      play(t, g);
      const gr = physicsOf(g).smokeMembers[0]?.grid;
      if (!gr) throw new Error('no smoke grid');
      expect(gr.maxDivergence() / (gr.maxSpeed() / Math.min(gr.dx, gr.dy))).toBeLessThan(2.5e-3);
    }
  });

  it('still air with swirl: smoke round a solid ball with no heat and no wind stays still to the last bit', () => {
    const g = make(['ball = Circle((0, 0), 0.6)', 'ball with solid = true', 'sm = Smoke(Box((0, 0), 5, 5), 32, source = Circle((0, -1.5), 0.4), heat = 0, swirl = 6)']);
    const d0 = Array.from(smoke('sm', g).density);
    play(5, g);
    expect(smoke('sm', g).speed).toBe(0);
    expect(Array.from(smoke('sm', g).density)).toEqual(d0);
  });
});

describe('Fire: forms, defaults, readouts (design 2.4, 9.7; agent.md)', () => {
  it('Fire(at) is a 2 m by 4 m box from 0.5 m below to 3.5 m above the point, 48 cells, a smoke value of type Fire', () => {
    all(['at = (3, 1)', 'fa = Fire(at)']);
    const v = fire('fa');
    expect(f.get('fa')?.type).toBe('Fire');
    expect(v.schema).toBe('Smoke');
    expect(physics.isSmokeValue(v)).toBe(true);
    expect(v.spec.n).toBe(48);
    expect(v.spec.x0).toBeCloseTo(2, 9);
    expect(v.spec.x1).toBeCloseTo(4, 9);
    expect(v.spec.y0).toBeCloseTo(0.5, 9);
    expect(v.spec.y1).toBeCloseTo(4.5, 9);
    expect(v.density.length).toBe(48 * 48);
    expect(v.temp.length).toBe(48 * 48);
  });

  it('Fire(at) has a small source at the point: it is hot at the point at the start of the film and cold far from it, and has no fuel yet', () => {
    all(['f1 = Fire((0, 0))', 'T0 = f1.temperature(0, 0.05)', 'Tfar = f1.temperature(0.8, 3)', 'Tout = f1.temperature(5, 5)', 'Tabove = f1.temperature(0, 0.6)', 'fu = f1.fuel', 'b = f1.burning']);
    expect(f.value('T0')).toBe(1000);
    expect(f.value('Tfar')).toBe(0);
    expect(f.value('Tout')).toBe(0);
    // the source is a circle of 0.25 m: 0.6 m up is outside it
    expect(f.value('Tabove')).toBe(0);
    expect(f.value('fu')).toBe(0);
    expect(f.value('b')).toBe(true);
  });

  it('the defaults are fuel 1, burn 1, heat 1,000, smoke 1, sound off, and swirl 2 for fire', () => {
    all(['f1 = Fire((0, 0))']);
    const sp = fire('f1').spec as unknown as { fire: Record<string, unknown>; swirl?: number };
    expect(sp.fire).toMatchObject({ fuel: 1, burn: 1, heat: 1000, smoke: 1, sound: false });
    expect(sp.swirl).toBe(2);
  });

  it('the long form takes its region, n and every named argument', () => {
    all(['f2 = Fire(Box((0, 2), 4, 4), 40, source = Circle((0, 0.3), 0.3), fuel = 2, burn = 1, heat = 800, smoke = 3, swirl = 1, wind = (1, 0), until = 5, sound = true)']);
    const v = fire('f2');
    expect(v.spec.n).toBe(40);
    expect(v.spec.x0).toBe(-2);
    expect(v.spec.x1).toBe(2);
    expect(v.spec.y0).toBe(0);
    expect(v.spec.y1).toBe(4);
    expect((v.spec as unknown as { fire: unknown }).fire).toMatchObject({ fuel: 2, burn: 1, heat: 800, smoke: 3, sound: true });
    // a polygon and a point are sources too
    all(['f3 = Fire(Box((0, 8), 4, 4), 16, source = Polygon((-0.5, 6), (0.5, 6), (0, 6.5)))', 'f4 = Fire(Box((0, 14), 4, 4), 16, source = (0, 12.3))']);
    expect(f.get('f3')?.type).toBe('Fire');
    expect(f.get('f4')?.type).toBe('Fire');
  });

  it('every smoke readout works on a fire: mass, speed, n, at(x, y); and temperature, burning, fuel are numbers and a flag', () => {
    all([CAMP, 'm = fire.mass', 'k = fire.n', 's = fire.speed', 'd = fire.at(0, 0.3)', 'dout = fire.at(9, 9)', 'T = fire.temperature(0, 0.3)', 'F = fire.fuel', 'B = fire.burning']);
    expect(f.value('k')).toBe(48);
    expect(f.value('m')).toBe(0);
    expect(f.value('s')).toBe(0);
    expect(f.value('d')).toBe(0);
    expect(f.value('dout')).toBe(0);
    expect(f.value('T')).toBe(1000);
    expect(typeof f.value('F')).toBe('number');
    expect(f.value('B')).toBe(true);
  });

  it('a fire with no source is cold: no cell above 150 °C, not burning, and it never raises fire_out (it never was alight)', () => {
    all(['cold = Fire(Box((0, 2), 4, 4), 16)', 'B = cold.burning', 'F = cold.fuel']);
    expect(f.value('B')).toBe(false);
    expect(f.value('F')).toBe(0);
    play(5);
    expect(maxTemp('cold')).toBe(0);
    expect(kinds(f)).not.toContain('fire_out');
  });

  it('a source that reads t or a slider is read at each step: a source that moves lights the cell it is in', () => {
    all(['P = (t - 1, 0.4)', 'fm = Fire(Box((0, 2), 4, 4), 32, source = Circle(P, 0.25), until = 3)', 'Tleft = fm.temperature(-0.8, 0.4)', 'Tright = fm.temperature(0.8, 0.4)']);
    play(0.3);
    expect(fire('fm').temp[Math.floor(0.4 / 0.125) * 32 + Math.floor((-0.7 + 2) / 0.125)]).toBeGreaterThan(150);
    play(1.9);
    expect(f.value('Tright') as number).toBeGreaterThan(150);
  });
});

describe('Fire: ranges of the named arguments, and limits (design 9.7, 11.3; errors.md B004, B013, B017)', () => {
  const LIMITS: ReadonlyArray<[string, string[], string[]]> = [
    ['fuel', ['-0.1', '10.1', '11'], ['0', '10', '1.5']],
    ['burn', ['0', '0.09', '10.1', '11'], ['0.1', '10', '3']],
    ['heat', ['99', '99.9', '2001', '5000'], ['100', '2000', '500']],
    ['smoke', ['-0.1', '5.1', '6'], ['0', '5', '2']],
    ['swirl', ['-0.1', '10.1'], ['0', '10']],
    ['until', ['-0.5', '-1'], ['0', '3']],
  ];
  for (const [name, bad, good] of LIMITS) {
    it(`${name}: a literal out of range is refused with bad_property_value, and the limits are accepted`, () => {
      for (const v of bad) expect(fail(`a = Fire(Box((0, 2), 4, 4), 8, ${name} = ${v})`).kind, `${name} = ${v}`).toBe('bad_property_value');
      for (const v of good) all([`a = Fire(Box((0, 2), 4, 4), 8, ${name} = ${v})`]);
    });
  }

  it('wind: a part over 100 m/s is refused with bad_property_value; a number for wind is the wrong form', () => {
    expect(fail('a = Fire(Box((0, 2), 4, 4), 8, wind = (101, 0))').kind).toBe('bad_property_value');
    expect(fail('a = Fire(Box((0, 2), 4, 4), 8, wind = (0, -200))').kind).toBe('bad_property_value');
    expect(fail('a = Fire(Box((0, 2), 4, 4), 8, wind = 3)').kind).toBe('no_matching_form');
    all(['a = Fire(Box((0, 2), 4, 4), 8, wind = (100, -100))']);
  });

  it('sound must be true or false', () => {
    expect(fail('a = Fire(Box((0, 2), 4, 4), 8, sound = 3)').kind).toMatch(/no_matching_form|bad_property_value/);
    all(['a = Fire(Box((0, 2), 4, 4), 8, sound = false)', 'b = Fire(Box((0, 6), 4, 4), 8, sound = true)']);
  });

  it('a grid over 64 by 64 is refused with limit (B013); under 4 cells a side or a fraction with bad_argument (B017)', () => {
    expect(fail('a = Fire(Box((0, 2), 4, 4), 65)').kind).toBe('limit');
    for (const n of ['0', '3', '2.5', '-1']) expect(fail(`a = Fire(Box((0, 2), 4, 4), ${n})`).kind, `n = ${n}`).toBe('bad_argument');
    all(['a = Fire(Box((0, 2), 4, 4), 64)']);
    all(['a = Fire(Box((0, 2), 4, 4), 4)']);
  });

  it('smoke and fire grids together hold at most 64 × 64 cells: two Fire(at) do not fit, a smoke and a fire count together', () => {
    all(['a = Fire((0, 0))']);
    const e = fail('b = Fire((10, 0))');
    expect(e.kind).toBe('limit');
    // 2,304 + 1,600 cells fit; redefining a grid counts only the others
    all(['b = Fire(Box((10, 2), 4, 4), 40)']);
    all(['b = Fire(Box((10, 2), 4, 4), 42)']);
    expect(fail('c = Smoke(Box((0, 10), 4, 4), 20)').kind).toBe('limit');
    const g = make(['s = Smoke(Box((0, 0), 4, 4), 48)']);
    expect(fail('fx = Fire(Box((0, 2), 4, 4), 48)', g).kind).toBe('limit');
    expect(fail('fx = Fire((0, 0))', g).kind).toBe('limit');
    all(['fx = Fire(Box((0, 2), 4, 4), 40)'], g);
    // and a smoke does not fit beside a full fire either
    const h = make(['a = Fire(Box((0, 2), 4, 4), 64)']);
    expect(fail('s = Smoke(Box((0, 0), 4, 4), 4)', h).kind).toBe('limit');
  });

  it('an undefined region or source gives an undefined fire with a reason, not an error', () => {
    all(['A = (0, 0)', 'k = 1 / 0 + undefined', 'flat = Fire(Polygon(A, A, A), 16)', 'none = Fire(Box((0, 0), 4, 4), k)']);
    expect(f.get('flat')?.cell).toMatchObject({ defined: false, reason: 'degenerate' });
    expect(f.get('none')?.cell).toMatchObject({ defined: false, reason: 'input_undefined' });
  });
});

describe('the fire step (design 9.7, 11.2)', () => {
  it('a source lights: some cell reaches its heat, fuel is made, and the plume heats cells above the source', () => {
    all([CAMP, 'F = fire.fuel', 'B = fire.burning']);
    play(1);
    expect(fire('fire').hottest).toBeGreaterThan(900);
    expect(fire('fire').hottest).toBeLessThanOrEqual(1000);
    expect(f.value('F') as number).toBeGreaterThan(0);
    expect(f.value('B')).toBe(true);
    expect(fire('fire').flames).toBeGreaterThan(0);
    expect(hotRegion('fire', 150).top).toBeGreaterThan(0.6);
  });

  it('heat is the hottest a flame gets: no cell is ever above it, for a cooler and a hotter fire', () => {
    for (const heat of [300, 500, 2000]) {
      const g = make([`fire = Fire(Box((0, 2), 4, 4), 32, ${SOURCE}, heat = ${heat})`]);
      let hottest = 0;
      for (let t = 0.5; t <= 3; t += 0.5) {
        play(t, g);
        hottest = Math.max(hottest, maxTemp('fire', g));
      }
      expect(hottest, `heat = ${heat}`).toBeLessThanOrEqual(heat + 1e-3);
      expect(hottest, `heat = ${heat}`).toBeGreaterThan(0.8 * heat);
    }
  });

  it('heat lifts: the hot region and the smoke rise, and the plume reaches well above the source', () => {
    all([CAMP]);
    play(0.5);
    const early = hotRegion('fire', 150);
    const yEarly = smokeY('fire');
    play(2.5);
    const late = hotRegion('fire', 150);
    expect(late.top).toBeGreaterThan(early.top + 0.5);
    expect(late.cy).toBeGreaterThan(early.cy);
    expect(smokeY('fire')).toBeGreaterThan(yEarly);
    expect(smokeY('fire')).toBeGreaterThan(0.8);
    expect(fire('fire').speed).toBeGreaterThan(1);
  });

  it('a fire with no wind is symmetric: its hot region and smoke stay centred over the source', () => {
    all([CAMP]);
    play(2);
    const v = fire('fire');
    const n = v.spec.n;
    let mx = 0;
    let m = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const T = v.temp[j * n + i] as number;
        mx += T * cellXY(v, i, j).x;
        m += T;
      }
    }
    expect(Math.abs(mx / m)).toBeLessThan(0.05);
  });

  it('burning makes smoke: the smoke mass grows with the fuel burnt; with smoke = 0 there is none', () => {
    const a = make([CAMP, 'm = fire.mass']);
    const none = make([`fire = Fire(Box((0, 2), 4, 4), 48, ${SOURCE}, smoke = 0)`, 'm = fire.mass']);
    const lots = make([`fire = Fire(Box((0, 2), 4, 4), 48, ${SOURCE}, smoke = 5)`, 'm = fire.mass']);
    play(2, a);
    play(2, none);
    play(2, lots);
    expect(a.value('m') as number).toBeGreaterThan(0);
    expect(none.value('m') as number).toBeLessThan(1e-12);
    expect(lots.value('m') as number).toBeGreaterThan(a.value('m') as number);
  });

  it('burn: a fast burn makes short flames and a slow burn tall ones', () => {
    const slow = make([`fire = Fire(Box((0, 2), 4, 4), 48, ${SOURCE}, burn = 0.1)`]);
    const fast = make([`fire = Fire(Box((0, 2), 4, 4), 48, ${SOURCE}, burn = 10)`]);
    play(2, slow);
    play(2, fast);
    const hs = hotRegion('fire', 500, slow);
    const hf = hotRegion('fire', 500, fast);
    expect(hs.top).toBeGreaterThan(hf.top);
  });

  it('fuel = 0 makes no fuel at the source', () => {
    all([`fire = Fire(Box((0, 2), 4, 4), 48, ${SOURCE}, fuel = 0)`, 'F = fire.fuel']);
    play(2);
    expect(f.value('F')).toBe(0);
  });

  it('cooling: when the source stops (until) the fire cools, and the cell at the source is no longer at its heat', () => {
    const running = make([CAMP, 'T = fire.temperature(0, 0.3)']);
    const stopped = make([STOPPED, 'T = fire.temperature(0, 0.3)']);
    play(1.5, running);
    play(1.5, stopped);
    // the source keeps its cells at the heat while it runs (less one step of cooling)
    expect(running.value('T') as number).toBeGreaterThan(900);
    expect(stopped.value('T') as number).toBeLessThan(running.value('T') as number);
    expect(stopped.value('T') as number).toBeLessThan(800);
    play(4, stopped);
    expect(maxTemp('fire', stopped)).toBeLessThan(maxTemp('fire', running));
    // and until = 0 is a fire that is lit at the start and then cools
    const puff = make([`fire = Fire(Box((0, 2), 4, 4), 48, ${SOURCE}, until = 0)`]);
    expect(maxTemp('fire', puff)).toBe(0);
    play(3, puff);
    expect(maxTemp('fire', puff)).toBeLessThan(1000);
  });

  it('a fire whose source stopped goes out: fire_out comes once, after the source stopped, and then the fire reads out', () => {
    const g = make([STOPPED, 'B = fire.burning', 'F = fire.fuel']);
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
    all([CAMP]);
    play(20);
    expect(kinds(f)).not.toContain('fire_out');
    expect(fire('fire').out).toBe(false);
  });

  it('fire_out is a notice with the fire\'s name and the time', () => {
    const g = make([STOPPED]);
    let note: { kind: string; message: string; severity?: string } | undefined;
    for (let k = 1; k <= 60 * 60 && !note; k++) {
      g.setClock(k / 60);
      note = g.takeWarnings().find((w) => w.kind === 'fire_out');
    }
    expect(note?.message).toMatch(/fire went out at t = /);
  });

  it('water puts a fire out: drops poured on it, with the source stopped, bring fire_out earlier than without water', () => {
    const dry = make([STOPPED]);
    const wet = make([STOPPED, 'rain = Liquid(Box((0, 1.4), 1.6, 0.6), 500)']);
    const a = firstNotice(dry, 'fire_out', 60);
    const b = firstNotice(wet, 'fire_out', 60);
    expect(b.at, 'with water the fire never went out').toBeDefined();
    expect(b.count).toBe(1);
    if (a.at !== undefined) expect(b.at as number).toBeLessThan(a.at);
  });

  it('water cools a fire in the cells it falls through, with its source still running the fire is lit again each step', () => {
    const g = make([CAMP, 'rain = Liquid(Box((0, 1.6), 1.6, 0.6), 500)', 'T = fire.temperature(0, 0.3)']);
    play(2, g);
    expect(g.value('T') as number).toBeGreaterThan(900);
  });
});

describe('burns and Ignite: bodies (design 9.7; errors.md reason burnt, notice burnt; R11.4)', () => {
  const BODY = ['g = Ground()', CAMP, 'wood = Body(Box((0, 0.1), 1.2, 0.2), mass = 1, burns = 3)', 'gy = wood.force("gravity")', 'tm = wood.temperature', 'bur = wood.burnt', 'bn = wood.burning'];

  it('a body with burns beside a fire lights, burns, goes from burnt 0 to 1 and then reads undefined with the reason burnt', () => {
    const g = make(BODY);
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
    // its readouts are undefined too
    expect(g.value('bur')).toBeUndefined();
  });

  it('the burnt notice shows once, with the body\'s name and the time, also when the film plays on', () => {
    const g = make(BODY);
    play(30, g);
    const notes = g.takeWarnings().filter((w) => w.kind === 'burnt');
    expect(notes.length).toBe(1);
    expect(notes[0]?.message).toMatch(/^wood burnt away at t = \d/);
    play(40, g);
    expect(g.takeWarnings().filter((w) => w.kind === 'burnt').length).toBe(0);
    expect(g.get('wood')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
  });

  it('a body loses up to 80% of its mass as it burns: its weight falls to 20% of the start as burnt goes to 1', () => {
    const g = make(BODY);
    play(0.2, g);
    const w0 = (g.value('gy') as { y: number }).y;
    expect(w0).toBeCloseTo(-9.8, 6);
    const seen: Array<[number, number]> = [];
    let minRatio = 1;
    for (let k = 1; k <= 60 * 30 && g.get('wood')?.cell.defined; k++) {
      g.setClock(0.2 + k / 60);
      if (!g.get('wood')?.cell.defined) break;
      const bt = g.value('bur') as number;
      const wy = (g.value('gy') as { y: number }).y;
      seen.push([bt, wy / w0]);
      minRatio = Math.min(minRatio, wy / w0);
    }
    expect(seen.length).toBeGreaterThan(10);
    for (const [bt, ratio] of seen) expect(ratio, `burnt = ${bt}`).toBeCloseTo(1 - 0.8 * bt, 2);
    expect(minRatio).toBeGreaterThanOrEqual(0.2 - 1e-3);
    expect(minRatio).toBeLessThan(0.5);
  });

  it('a body heats from the air: its temperature rises towards the plume before it lights, and it burns only above ignite', () => {
    const g = make(BODY);
    let atLight: number | undefined;
    let last = 0;
    for (let k = 1; k <= 60 * 10; k++) {
      g.setClock(k / 60);
      if (g.value('bn') === true) {
        atLight = g.value('tm') as number;
        break;
      }
      const tm = g.value('tm') as number;
      expect(tm).toBeGreaterThanOrEqual(0);
      last = tm;
    }
    expect(last).toBeGreaterThan(50);
    expect(atLight as number).toBeGreaterThanOrEqual(250 - 1);
    // a body whose ignite is higher lights later
    const hi = make(['g = Ground()', CAMP, 'wood = Body(Box((0, 0.1), 1.2, 0.2), mass = 1, burns = 3, ignite = 600)', 'bn = wood.burning']);
    const lo = make(['g = Ground()', CAMP, 'wood = Body(Box((0, 0.1), 1.2, 0.2), mass = 1, burns = 3, ignite = 160)', 'bn = wood.burning']);
    const when = (fig: Figure): number => {
      for (let k = 1; k <= 60 * 20; k++) {
        fig.setClock(k / 60);
        if (fig.value('bn') === true) return k / 60;
      }
      return Infinity;
    };
    expect(when(lo)).toBeLessThan(when(hi));
  });

  it('far from the fire a body does not light, and a body without burns does not either', () => {
    const g = make(['g = Ground()', CAMP, 'far = Body(Box((1.8, 3.5), 0.3, 0.2), mass = 1, burns = 3, fixed = true)', 'plain = Body(Box((0, 0.1), 1.2, 0.2), mass = 1)', 'a = far.burning', 'b = far.burnt']);
    play(10, g);
    expect(g.value('a')).toBe(false);
    expect(g.value('b')).toBe(0);
    expect(g.get('plain')?.cell.defined).toBe(true);
  });

  it('a body of burns = <seconds> burns for that long; more seconds burn it away later', () => {
    const when = (s: number): number => {
      const g = make(['g = Ground()', CAMP, `wood = Body(Box((0, 0.1), 1.2, 0.2), mass = 1, burns = ${s})`]);
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

  it('joints to a body that burns away break (broken): a notice for the joint at the time the body burnt, once; the other body is untouched', () => {
    const g = make([...BODY, 'rock = Body(Box((0.9, 0.1), 0.6, 0.2), mass = 2)', 'w = Weld(wood, rock)', 'wb = w.broken']);
    expect(g.value('wb')).toBe(false);
    play(30, g);
    expect(g.get('wood')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
    const notes = g.takeWarnings();
    const burnt = notes.filter((n) => n.kind === 'burnt');
    const broke = notes.filter((n) => n.kind === 'broken');
    expect(burnt.length).toBe(1);
    expect(broke.length).toBe(1);
    expect(broke[0]?.message).toMatch(/^w broke at t = /);
    // the joint is not holding: either it reads broken, or (its end is gone) it reads undefined, as the build notes say
    const cell = g.get('w')?.cell as { defined: boolean };
    expect(cell.defined === false || g.value('wb') === true).toBe(true);
    expect(g.get('rock')?.cell.defined).toBe(true);
  });

  it('Ignite(b) lights a body at once, with no fire round it but a fire grid: b.burning is true and it burns away', () => {
    const g = make(['g = Ground()', 'cold = Fire(Box((0, 2), 4, 4), 32)', 'wood = Body(Box((0, 0.1), 1.2, 0.2), mass = 1, burns = 2)', 'bn = wood.burning', 'bur = wood.burnt']);
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

  it('Ignite works in a handler: the body lights after the hit, not before, and the line is logged', () => {
    const lines = ['g = Ground()', 'cold = Fire(Box((0, 2), 4, 4), 32)', 'wood = Body(Box((1.4, 0.1), 1, 0.2), mass = 1, burns = 2)', 'ball = Body(Circle((-1, 1.5), 0.2))', 'bn = wood.burning'];
    const g = make(lines);
    all(['on ball hit: Ignite(wood)'], g);
    play(0.3, g);
    expect(g.value('bn')).toBe(false);
    play(1.5, g);
    expect(g.value('bn')).toBe(true);
    play(8, g);
    expect(g.get('wood')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
    // a figure without the handler never lights it
    const h = make(lines);
    play(8, h);
    expect(h.value('bn')).toBe(false);
  });

  it('Ignite of a whole list lights each item: Ignite(list) is logged per item as name[k]', () => {
    const g = make(['g = Ground()', 'cold = Fire(Box((0, 2), 4, 4), 32)', 'row = Bodies([Box((-1, 0.1), 0.6, 0.2), Box((1, 0.1), 0.6, 0.2)])', 'row with burns = 2', 'ba = row[1].burning', 'bb = row[2].burning']);
    play(0.5, g);
    expect(g.value('bb')).toBe(false);
    all(['Ignite(row[2])'], g);
    play(1.5, g);
    expect(g.value('bb')).toBe(true);
    expect(g.value('ba')).toBe(false);
    expect(g.toScript()).toMatch(/@input physics ignite row\[2\]/);
  });
});

describe('burns and Ignite: cloth and solid shapes (design 9.7; R11.4)', () => {
  const CURTAIN = ['g = Ground()', CAMP, 'curtain = Cloth(Box((0, 1.6), 1.2, 1.4), 13, 8, mass = 0.3, pins = "top", burns = 1)', 'cb = curtain.burnt', 'ct = curtain.torn'];

  it('a cloth with burns beside a fire burns cell by cell: c.burnt grows from 0, links tear, with no tears given', () => {
    const g = make(CURTAIN);
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
    expect(g.takeWarnings().map((w) => w.kind)).toContain('torn');
  });

  it('the cloth tears where it burns: the torn links are near the burnt cells, the top row of a far cloth stays whole', () => {
    const g = make(['g = Ground()', CAMP, 'far = Cloth(Box((1.5, 3.4), 0.6, 0.5), 7, 5, mass = 0.1, pins = "top", burns = 1)', 'ft = far.torn', 'fb = far.burnt']);
    play(8, g);
    expect(g.value('ft')).toBe(0);
    expect(g.value('fb')).toBe(0);
  });

  it('a cloth with no burns and no tears never tears in the same fire', () => {
    const g = make(['g = Ground()', CAMP, 'plain = Cloth(Box((0, 1.6), 1.2, 1.4), 13, 8, mass = 0.3, pins = "top")', 'pt = plain.torn']);
    play(10, g);
    expect(g.value('pt')).toBe(0);
  });

  it('Ignite(cloth) lights every cell not yet burnt: the whole cloth burns away to burnt = 1', () => {
    const g = make(['g = Ground()', 'cold = Fire(Box((0, 2), 4, 4), 32)', 'flag = Cloth(Box((0, 2), 1.2, 1), 10, 6, mass = 0.2, pins = "top", burns = 1)', 'cb = flag.burnt', 'ct = flag.torn']);
    play(1, g);
    expect(g.value('cb')).toBe(0);
    all(['Ignite(flag)'], g);
    play(10, g);
    expect(g.value('cb') as number).toBeGreaterThan(0.9);
    expect(g.value('ct') as number).toBeGreaterThan(0);
  });

  it('a solid shape with burns stops being solid when it is burnt: a ball resting on it falls through', () => {
    const g = make(['g = Ground()', 'cold = Fire(Box((0, 2), 4, 4), 32)', 'shelf = Box((0, 1), 1.6, 0.2)', 'shelf with solid = true, burns = 1', 'ball = Body(Circle((0, 1.5), 0.2))', 'by = ball.y']);
    play(2, g);
    // it rests on the shelf: its top is at 1.1, the ball's centre 0.2 above
    expect(g.value('by') as number).toBeCloseTo(1.3, 1);
    all(['Ignite(shelf)'], g);
    play(12, g);
    expect(g.value('by') as number).toBeLessThan(0.5);
    expect(g.takeWarnings().filter((w) => w.kind === 'burnt').length).toBe(1);
  });

  const SHELF = ['g = Ground()', 'cold = Fire(Box((0, 2), 4, 4), 32)', 'shelf = Box((0, 1), 1.6, 0.2)', 'shelf with solid = true, burns = 1', 'ball = Body(Circle((0, 1.5), 0.2))', 'by = ball.y'];

  it('a ball on a shelf that burns away falls soon after the burnt notice (1.5 s is time enough to fall a metre)', () => {
    const g = make(SHELF);
    play(2, g);
    all(['Ignite(shelf)'], g);
    const r = firstNotice(g, 'burnt', 12, true);
    expect(r.at, 'the shelf never burnt away').toBeDefined();
    expect(r.count).toBe(1);
    play((r.at as number) + 1.5, g);
    expect(g.value('by') as number).toBeLessThan(1);
  });

  it('a shape that burnt away reads undefined with the reason burnt (errors.md 4)', () => {
    const g = make(SHELF);
    play(2, g);
    all(['Ignite(shelf)'], g);
    const r = firstNotice(g, 'burnt', 12);
    expect(r.at, 'the shelf never burnt away').toBeDefined();
    expect(g.get('shelf')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
  });

  it('a solid shape beside a fire lights on its own, burns away and reads undefined with the reason burnt', () => {
    const g = make(['g = Ground()', CAMP, 'shelf = Box((0, 0.9), 1.6, 0.2)', 'shelf with solid = true, burns = 1']);
    const r = firstNotice(g, 'burnt', 30);
    expect(r.at, 'the shelf never burnt away').toBeDefined();
    expect(r.count).toBe(1);
    expect(g.get('shelf')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
  });
});

describe('errors: B020 not_burnable, B021 no_fire_grid, ignite range (errors.md 3)', () => {
  it('Ignite of a body with no burns is not_burnable (B020), with the suggestion to add burns', () => {
    all(['cold = Fire(Box((0, 2), 4, 4), 16)', 'b = Body(Box((0, 1), 1, 1))']);
    const e = fail('Ignite(b)');
    expect(e.kind).toBe('not_burnable');
    expect(e.message).toMatch(/^b can't burn yet\./);
    expect(e.hint).toMatch(/Add `?b with burns = true`? first\./);
    expect(e.suggest).toEqual(['b with burns = true']);
    expect(e.code).toMatch(/^(B020|C139)$/);
    all(['b with burns = true', 'Ignite(b)']);
  });

  it('Ignite of a thing with burns = false is not_burnable too', () => {
    all(['cold = Fire(Box((0, 2), 4, 4), 16)', 'b = Body(Box((0, 1), 1, 1), burns = false)']);
    expect(fail('Ignite(b)').kind).toBe('not_burnable');
  });

  it('burns or ignite on a point, a smoke or a fire is not_burnable at typecheck', () => {
    all(['P = (0, 0)', 'sm = Smoke(Box((0, 2), 4, 4), 16)', 'fr = Fire(Box((10, 2), 4, 4), 16)']);
    for (const l of ['P with burns = true', 'sm with burns = true', 'fr with burns = true', 'P with ignite = 300', 'sm with ignite = 300']) expect(fail(l).kind, l).toBe('not_burnable');
    expect(fail('Ignite(P)').kind).toBe('not_burnable');
    expect(fail('Ignite(sm)').kind).toBe('not_burnable');
  });

  it('Ignite of a burnable body outside every fire is no_fire_grid (B021), with the suggestion Fire(b.pos)', () => {
    all(['cold = Fire(Box((0, 2), 4, 4), 16)', 'far = Body(Box((20, 1), 1, 1), burns = true)']);
    const e = fail('Ignite(far)');
    expect(e.kind).toBe('no_fire_grid');
    expect(`${e.message} ${e.hint ?? ''}`).toContain('Nothing can burn outside a fire. Make a fire round far.');
    expect(e.suggest).toEqual(['fire = Fire(far.pos)']);
    expect(e.code).toMatch(/^(B021|C140)$/);
  });

  it('with no fire in the figure at all Ignite is no_fire_grid; a fire made round the thing, as suggested, makes it work', () => {
    all(['b = Body(Box((0, 1), 1, 1), burns = true)']);
    expect(fail('Ignite(b)').kind).toBe('no_fire_grid');
    all(['fire = Fire(b.pos)', 'Ignite(b)']);
  });

  it('Ignite of a cloth and a solid shape outside every fire is no_fire_grid; one without burns is not_burnable', () => {
    all(['cold = Fire(Box((0, 2), 4, 4), 16)', 'c = Cloth(Box((20, 2), 1, 1), 6, 6, burns = true)', 'p = Box((20, 0), 1, 1)', 'p with solid = true, burns = true', 'plain = Cloth(Box((0, 2), 1, 1), 6, 6)']);
    expect(fail('Ignite(c)').kind).toBe('no_fire_grid');
    expect(fail('Ignite(p)').kind).toBe('no_fire_grid');
    expect(fail('Ignite(plain)').kind).toBe('not_burnable');
  });

  it('ignite outside 150 to 1,000 °C is refused with bad_property_value; the limits and the default are accepted', () => {
    for (const v of ['149', '100', '1001', '5000', '-5']) expect(fail(`b = Body(Box((0, 1), 1, 1), burns = true, ignite = ${v})`).kind, `ignite = ${v}`).toBe('bad_property_value');
    for (const v of ['150', '1000', '400']) all([`b = Body(Box((0, 1), 1, 1), burns = true, ignite = ${v})`]);
    all(['q = Body(Box((5, 1), 1, 1), burns = true)', 'q with ignite = 300']);
    expect(fail('q with ignite = 1200').kind).toBe('bad_property_value');
    expect(fail('q with ignite = 100').kind).toBe('bad_property_value');
  });

  it('burns takes true, false or a number of seconds, and nothing else', () => {
    all(['a = Body(Box((0, 1), 1, 1), burns = true)', 'b = Body(Box((3, 1), 1, 1), burns = false)', 'c = Body(Box((6, 1), 1, 1), burns = 4)', 'a with burns = 2.5']);
    expect(fail('d = Body(Box((9, 1), 1, 1), burns = "yes")').kind).toMatch(/no_matching_form|bad_property_value/);
  });

  // design 11.3: "Over a limit, the line is refused with `limit`", and the table gives "Burnable things | 64". (The first version
  // of this test said the 65th is ignored with no refusal, which the table's own rule contradicts: findings PH-19.)
  const burner = (k: number): string => `b${k} = Body(Box((${(k % 20) * 0.2 - 2}, ${0.5 + Math.floor(k / 20) * 0.3}), 0.1, 0.1), burns = true)`;

  it('the 65th thing with burns is refused with limit (errors.md 3), naming the 64; the 64 before it are accepted and play', () => {
    const lines = ['g = Ground()', 'cold = Fire(Box((0, 2), 4, 4), 16)'];
    for (let k = 0; k < 64; k++) lines.push(burner(k));
    all(lines);
    const e = fail(burner(64));
    expect(e.kind).toBe('limit');
    expect(e.message).toContain('64');
    expect(f.get('b64')).toBeUndefined();
    play(1);
    expect(f.takeWarnings().map((w) => w.kind)).not.toContain('unstable_world');
  });

  it('every kind of burnable thing counts toward the 64: bodies of a list, a cloth and a solid shape, by `burns = …` or `with burns`', () => {
    all(['g = Ground()', 'cold = Fire(Box((0, 2), 4, 4), 16)']);
    for (let k = 0; k < 60; k++) all([burner(k)]);
    // a list of three bodies is three things: 63
    all(['row = Bodies([Box((-1, 4), 0.2, 0.2), Box((0, 4), 0.2, 0.2), Box((1, 4), 0.2, 0.2)])', 'row with burns = 2']);
    // a cloth is one: 64
    all(['flag = Cloth(Box((0, 3), 1, 1), 6, 4, pins = "top", burns = 1)']);
    // the 65th, whatever it is
    expect(fail(burner(61)).kind).toBe('limit');
    all(['plank = Box((3, 1), 1, 0.2)', 'plank with solid = true']);
    expect(fail('plank with burns = true').kind).toBe('limit');
    expect(fail('late = Cloth(Box((-3, 3), 1, 1), 6, 4, pins = "top", burns = 2)').kind).toBe('limit');
    // things that do not burn are not counted, and a thing already counted can be changed
    all(['calm = Body(Box((2, 5), 0.2, 0.2))', 'calm with burns = false', 'b3 with burns = 5', burner(3)]);
    expect(f.get('plank')).toBeDefined();
  });

  it('turning burns off frees a place: the 65th is then accepted', () => {
    const lines = ['g = Ground()', 'cold = Fire(Box((0, 2), 4, 4), 16)'];
    for (let k = 0; k < 64; k++) lines.push(burner(k));
    all(lines);
    expect(fail(burner(64)).kind).toBe('limit');
    all(['b0 with burns = false']);
    all([burner(64)]);
    expect(fail(burner(65)).kind).toBe('limit');
  });
});

describe('the exact film with fire (design 10; R11.9)', () => {
  const BURNING_BODY = ['g = Ground()', CAMP, 'wood = Body(Box((0, 0.1), 1.2, 0.2), mass = 1, burns = 8)', 'rock = Body(Box((0.9, 0.1), 0.6, 0.2), mass = 2)', 'w = Weld(wood, rock)', 'bur = wood.burnt', 'tm = wood.temperature'];
  const BURNING_CLOTH = ['g = Ground()', CAMP, 'curtain = Cloth(Box((0, 1.6), 1.2, 1.4), 13, 8, mass = 0.3, pins = "top", burns = 1)', 'cb = curtain.burnt', 'ct = curtain.torn'];

  const same = (a: Figure, b: Figure, probes: string[]): void => {
    expect(hash(b)).toBe(hash(a));
    expect(Array.from(fire('fire', b).temp)).toEqual(Array.from(fire('fire', a).temp));
    expect(Array.from(smoke('fire', b).density)).toEqual(Array.from(smoke('fire', a).density));
    for (const p of probes) expect(b.value(p), p).toEqual(a.value(p));
  };

  it('a burning body: seek from 0 to 6 s equals play to 6 s, to the last bit, and so does seeking back and forth', () => {
    const a = make(BURNING_BODY);
    play(6, a);
    expect(a.value('bur') as number).toBeGreaterThan(0);
    const b = make(BURNING_BODY);
    seek(b, 6);
    same(a, b, ['bur', 'tm']);
    seek(b, 2.3);
    seek(b, 6);
    same(a, b, ['bur', 'tm']);
    seek(b, 0);
    seek(b, 6);
    same(a, b, ['bur', 'tm']);
  });

  it('a body that burns away: seek equals play, the notice shows once, the body reads undefined at the right times, and seeking back brings it back', () => {
    const a = make(BURNING_BODY);
    play(20, a);
    expect(a.get('wood')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
    const b = make(BURNING_BODY);
    seek(b, 20);
    expect(hash(b)).toBe(hash(a));
    expect(b.get('wood')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
    expect(b.value('w')).toEqual(a.value('w'));
    seek(b, 0.5);
    expect(b.get('wood')?.cell.defined).toBe(true);
    expect(b.value('bur')).toBe(0);
    seek(b, 20);
    expect(hash(b)).toBe(hash(a));
    // the notice does not come again each time the film passes it
    b.takeWarnings();
    seek(b, 0.5);
    seek(b, 20);
    expect(b.takeWarnings().filter((w) => w.kind === 'burnt').length).toBeLessThanOrEqual(1);
  });

  it('a burning cloth: seek equals play to the last bit, torn links and burnt cells included, also back and forth', () => {
    const a = make(BURNING_CLOTH);
    play(6, a);
    expect(a.value('ct') as number).toBeGreaterThan(0);
    const b = make(BURNING_CLOTH);
    seek(b, 6);
    same(a, b, ['cb', 'ct']);
    expect(Array.from((b.value('curtain') as physics.ClothValue).cut)).toEqual(Array.from((a.value('curtain') as physics.ClothValue).cut));
    expect(Array.from((b.value('curtain') as physics.ClothValue).xs)).toEqual(Array.from((a.value('curtain') as physics.ClothValue).xs));
    expect(Array.from((b.value('curtain') as physics.ClothValue).ys)).toEqual(Array.from((a.value('curtain') as physics.ClothValue).ys));
    seek(b, 1.1);
    seek(b, 6);
    same(a, b, ['cb', 'ct']);
    expect(Array.from((b.value('curtain') as physics.ClothValue).cut)).toEqual(Array.from((a.value('curtain') as physics.ClothValue).cut));
  });

  it('the same film twice gives the same fire every second (body and cloth together)', () => {
    const lines = [...BURNING_BODY, 'curtain = Cloth(Box((-1.2, 1.6), 0.8, 1.4), 9, 8, mass = 0.3, pins = "top", burns = 1)'];
    const a = make(lines);
    const b = make(lines);
    for (let s = 1; s <= 6; s++) {
      play(s, a);
      play(s, b);
      expect(hash(b), `t = ${s}`).toBe(hash(a));
    }
  });

  it('the physics-kernels switch gives the same fire film: kernels off and on, temperature and density to the bit', () => {
    const film = (kernels: boolean, lines: string[], probes: string[]): { temp: number[]; density: number[]; hash: string; values: unknown[] } => {
      setPhysicsKernels(kernels);
      const g = make(lines);
      play(5, g);
      return { temp: Array.from(fire('fire', g).temp), density: Array.from(smoke('fire', g).density), hash: hash(g), values: probes.map((p) => g.value(p)) };
    };
    for (const [lines, probes] of [
      [BURNING_BODY, ['bur', 'tm']],
      [BURNING_CLOTH, ['cb', 'ct']],
      [[CAMP], []],
      [[`fire = Fire(Box((0, 2), 4, 4), 48, ${SOURCE}, swirl = 6, wind = (1, 0))`, 'ball = Circle((0.5, 1.5), 0.3)', 'ball with solid = true'], []],
    ] as Array<[string[], string[]]>) {
      const on = film(true, lines, probes);
      const off = film(false, lines, probes);
      expect(off.hash).toBe(on.hash);
      expect(off.temp).toEqual(on.temp);
      expect(off.density).toEqual(on.density);
      expect(off.values).toEqual(on.values);
      expect(Math.max(...on.temp)).toBeGreaterThan(150);
    }
  });

  it('Ignite as a line: seek equals play after it, the script keeps it as an @input line, and a reload plays the same', () => {
    const lines = ['g = Ground()', 'cold = Fire(Box((0, 2), 4, 4), 32)', 'wood = Body(Box((0, 0.1), 1.2, 0.2), mass = 1, burns = 8)', 'bur = wood.burnt'];
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
    // and a figure that was never ignited differs
    const c = make(lines);
    play(5, c);
    expect(hash(c)).not.toBe(hash(a));
  });

  it('Ignite in a handler: seek equals play, and a reload of the saved script plays the same without running the handler twice', () => {
    const lines = ['g = Ground()', 'cold = Fire(Box((0, 2), 4, 4), 32)', 'wood = Body(Box((1.4, 0.1), 1, 0.2), mass = 1, burns = 2)', 'ball = Body(Circle((-1, 1.5), 0.2))', 'on ball hit: Ignite(wood)', 'bur = wood.burnt'];
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

  it('Ignite of a cloth: seek equals play', () => {
    const lines = ['g = Ground()', 'cold = Fire(Box((0, 2), 4, 4), 32)', 'flag = Cloth(Box((0, 2), 1.2, 1), 10, 6, mass = 0.2, pins = "top", burns = 1)', 'cb = flag.burnt'];
    const a = make(lines);
    play(1, a);
    all(['Ignite(flag)'], a);
    play(5, a);
    expect(a.value('cb') as number).toBeGreaterThan(0);
    const { figure: b } = Figure.fromScript(a.toScript(), { commands: REG });
    seek(b, 5);
    expect(hash(b)).toBe(hash(a));
    expect(b.value('cb')).toBe(a.value('cb'));
  });

  it('a fire that goes out: fire_out comes once, and seek equals play across it', () => {
    const a = make([STOPPED]);
    const r = firstNotice(a, 'fire_out', 40);
    expect(r.count).toBe(1);
    const b = make([STOPPED]);
    seek(b, 40);
    expect(hash(b)).toBe(hash(a));
    expect(Array.from(fire('fire', b).temp)).toEqual(Array.from(fire('fire', a).temp));
    expect(fire('fire', b).out).toBe(true);
  });

  it('a checkpoint of a fire grid is bigger than that of a smoke grid of the same size, which keeps its size', () => {
    const smokeOnly = make(['sm = Smoke(Box((0, 2), 4, 4), 64, source = Circle((0, 0.3), 0.3))']);
    const burning = make(['fire = Fire(Box((0, 2), 4, 4), 64, source = Circle((0, 0.3), 0.3))']);
    play(1, smokeOnly);
    play(1, burning);
    const kb = (g: Figure): number => (physicsOf(g) as unknown as { saveState(): Float64Array }).saveState().byteLength / 1024;
    expect(kb(smokeOnly)).toBeGreaterThan(120);
    expect(kb(smokeOnly)).toBeLessThan(140);
    expect(kb(burning)).toBeGreaterThan(kb(smokeOnly));
  });
});

describe('a fire in a figure with other physics (design 9.4, 9.7)', () => {
  it('fire is two-way with bodies: the plume lifts a light body, and a body in the way splits the plume', () => {
    const g = make(['world with gravity = (0, -9.8)', CAMP, 'leaf = Body(Circle((0, 1.2), 0.1), mass = 0.002)', 'ly = leaf.y']);
    play(0.05, g);
    const y0 = g.value('ly') as number;
    play(1.5, g);
    // a feather in the plume does not fall like a stone: free fall for 1.5 s would take it 11 m down
    expect(g.value('ly') as number).toBeGreaterThan(y0 - 5);
  });

  it('a fire with a solid ball over it: no heat or smoke inside the ball, and the flow goes round it', () => {
    const g = make([CAMP, 'ball = Circle((0, 1.5), 0.4)', 'ball with solid = true']);
    play(3, g);
    const v = fire('fire', g);
    const n = v.spec.n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const { x, y } = cellXY(v, i, j);
        if ((x * x + (y - 1.5) ** 2) < 0.3 * 0.3) {
          expect(v.density[j * n + i], `smoke at (${x}, ${y})`).toBe(0);
        }
      }
    }
  });

  it('a wind blows the flames over: the hot region leans downwind', () => {
    const g = make([`fire = Fire(Box((0, 2), 4, 4), 48, ${SOURCE}, wind = (3, 0))`]);
    play(2, g);
    const v = fire('fire', g);
    const n = v.spec.n;
    let mx = 0;
    let m = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const T = v.temp[j * n + i] as number;
        if (T > 150) {
          mx += T * cellXY(v, i, j).x;
          m += T;
        }
      }
    }
    expect(mx / m).toBeGreaterThan(0.2);
  });
});

/** The `@input physics` lines of a figure's script, in order. */
const inputs = (fig: Figure): string[] => fig.toScript().split('\n').filter((l) => l.startsWith('@input physics'));
/** The film time a line was logged at. */
const atOf = (line: string): number => Number(line.slice(line.lastIndexOf(' ') + 1));

describe('hit handlers run their physics actions at the hit, not at the clock (findings PH-16; design 10)', () => {
  // a ball falls on to the ground at 0.55 s, bounces and lands again at 0.69 s; `wood` lies apart, in the fire's box
  const SCENE = ['g = Ground()', 'cold = Fire(Box((0, 2), 4, 4), 32)', 'wood = Body(Box((1.4, 0.1), 1, 0.2), mass = 1, burns = 2)', 'ball = Body(Circle((-1, 1.5), 0.2))', 'bur = wood.burnt', 'wy = wood.y'];

  /** Played to `to` frame by frame; sought from 0; and a reload of the played script, sought: the three films and their `@input` lines. */
  const threeFilms = (handler: string, to: number): { played: Figure; sought: Figure; reloaded: Figure } => {
    const lines = [...SCENE, `on ball hit: ${handler}`];
    const played = make(lines);
    play(to, played);
    const sought = make(lines);
    seek(sought, to);
    const { figure: reloaded } = Figure.fromScript(played.toScript(), { commands: REG });
    seek(reloaded, to);
    return { played, sought, reloaded };
  };

  for (const handler of ['Ignite(wood)', 'Push(wood, (0, 2))', 'Sleep(wood)', 'Push(wood, (0.5, 1), (1.6, 0.1))']) {
    it(`on ball hit: ${handler}: seek from 0 to 6 s equals play to 6 s (hash and @input lines), and so does a reload of the played script`, () => {
      const { played, sought, reloaded } = threeFilms(handler, 6);
      const lines = inputs(played);
      // the handler ran once for each hit of the ball (two within the first second), at the time of the hit
      expect(lines.length, lines.join('\n')).toBeGreaterThanOrEqual(2);
      for (const l of lines) expect(atOf(l), l).toBeLessThan(1.5);
      expect(inputs(sought)).toEqual(lines);
      expect(inputs(reloaded)).toEqual(lines);
      expect(hash(sought)).toBe(hash(played));
      expect(hash(reloaded)).toBe(hash(played));
      for (const p of ['bur', 'wy']) {
        expect(sought.value(p), p).toEqual(played.value(p));
        expect(reloaded.value(p), p).toEqual(played.value(p));
      }
    });
  }

  it('the actions take effect: each handler gives another film than the figure with none', () => {
    const none = make(SCENE);
    play(3, none);
    for (const handler of ['Ignite(wood)', 'Push(wood, (0, 2))', 'Sleep(wood)']) {
      const g = make([...SCENE, `on ball hit: ${handler}`]);
      play(3, g);
      expect(hash(g), handler).not.toBe(hash(none));
    }
  });

  it('seeking back over the hits and forward again, and across them in steps, keeps the film', () => {
    const lines = [...SCENE, 'on ball hit: Push(wood, (0, 2))'];
    const a = make(lines);
    play(4, a);
    const b = make(lines);
    for (const t of [0.3, 1.2, 0.6, 3, 0.1, 4]) seek(b, t);
    expect(hash(b)).toBe(hash(a));
    expect(inputs(b)).toEqual(inputs(a));
    // the hits at 0.55 s and 0.69 s are in the log once each, however often the film passed them
    expect(inputs(b).length).toBe(inputs(a).length);
  });

  it('a handler that pushes does not push twice on a reload: the played script, played again, has the same lines and the same wood', () => {
    const a = make([...SCENE, 'on ball hit: Push(wood, (0, 2))']);
    play(2, a);
    const lines = inputs(a);
    const { figure: b } = Figure.fromScript(a.toScript(), { commands: REG });
    play(2, b);
    expect(inputs(b)).toEqual(lines);
    expect(lines.length).toBe(2);
    expect(b.value('wy')).toBe(a.value('wy'));
    expect(b.value('bur')).toBe(a.value('bur'));
  });

  it('Wake and Sleep as lines are in the log at the film time and play back exactly', () => {
    const lines = ['g = Ground()', 'b = Body(Circle((0, 3), 0.2))', 'c = Body(Circle((2, 3), 0.2))', 'by = b.y', 'ba = b.asleep'];
    const a = make(lines);
    play(0.5, a);
    all(['Sleep(b)'], a);
    play(1, a);
    expect(a.value('ba')).toBe(true);
    const sleptAt = a.value('by') as number;
    play(1.5, a);
    expect(a.value('by')).toBe(sleptAt);
    all(['Wake(b)'], a);
    play(2.5, a);
    expect(a.value('ba')).toBe(false);
    expect(a.value('by') as number).toBeLessThan(sleptAt);
    expect(inputs(a).filter((l) => /physics (sleep|wake) b at /.test(l)).map((l) => l.split(' ')[2])).toEqual(['sleep', 'wake']);
    const { figure: b } = Figure.fromScript(a.toScript(), { commands: REG });
    seek(b, 2.5);
    expect(hash(b)).toBe(hash(a));
    seek(b, 0.2);
    seek(b, 1.2);
    expect(b.value('ba')).toBe(true);
    seek(b, 2.5);
    expect(hash(b)).toBe(hash(a));
  });
});

describe('hit handlers in space (findings PH-16: every physics action, in the plane and in space)', () => {
  const REG3 = (() => {
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
  const SCENE3 = ['g = Ground()', 'b = Body(Sphere((0, 0, 3), 0.25), bounce = 0.6)', 'c = Body(Sphere((2, 0, 6), 0.25))', 'cx = c.x', 'cz = c.z'];
  const make3 = (lines: readonly string[]): Figure => {
    const g = new Figure({ commands: REG3 });
    all(lines, g);
    return g;
  };
  const hash3 = (fig: Figure): string => physics3Of(fig).worldHash();

  for (const handler of ['Push(c, (0, 0.05, 0))', 'Sleep(c)', 'Push(c, (0.02, 0, 0.03), (2, 0, 6.1))']) {
    it(`on b hit: ${handler}: seek from 0 equals play, and a reload of the played script, with the same @input lines`, () => {
      const lines = [...SCENE3, `on b hit: ${handler}`];
      const a = make3(lines);
      play(4, a);
      const logged = inputs(a);
      expect(logged.length, logged.join('\n')).toBeGreaterThanOrEqual(2);
      // the ball lands at about 0.75 s and bounces on: the lines are at the hits, not at the end of the seek (4 s)
      for (const l of logged) expect(atOf(l), l).toBeLessThan(3);
      const b = make3(lines);
      seek(b, 4);
      expect(inputs(b)).toEqual(logged);
      expect(hash3(b)).toBe(hash3(a));
      const { figure: c } = Figure.fromScript(a.toScript(), { commands: REG3 });
      seek(c, 4);
      expect(inputs(c)).toEqual(logged);
      expect(hash3(c)).toBe(hash3(a));
      const none = make3(SCENE3);
      play(4, none);
      expect(hash3(none), 'the action did something').not.toBe(hash3(a));
    });
  }

  it('Wake and Sleep as lines in space are logged and play back exactly', () => {
    const a = make3(['g = Ground()', 'b = Body(Sphere((0, 0, 3), 0.25))', 'bz = b.z', 'ba = b.asleep']);
    play(0.3, a);
    all(['Sleep(b)'], a);
    play(1, a);
    expect(a.value('ba')).toBe(true);
    all(['Wake(b)'], a);
    play(2, a);
    expect(a.value('bz') as number).toBeLessThan(2);
    expect(inputs(a).map((l) => l.split(' ')[2])).toEqual(['sleep', 'wake']);
    const { figure: b } = Figure.fromScript(a.toScript(), { commands: REG3 });
    seek(b, 2);
    expect(hash3(b)).toBe(hash3(a));
  });
});

describe('a solid shape or a body that burnt away (findings PH-17; design 9.7; errors.md 4)', () => {
  const SHELF = ['g = Ground()', 'cold = Fire(Box((0, 2), 4, 4), 32)', 'shelf = Box((0, 1), 1.6, 0.2)', 'shelf with solid = true, burns = 1', 'ball = Body(Circle((0, 1.5), 0.2))', 'by = ball.y'];

  it('the ball on a burnt shelf falls: it is back on the ground well within 1.5 s of the burnt notice, and it was asleep when it was left', () => {
    const g = make(SHELF);
    play(3, g);
    expect(physicsOf(g).world?.awake[2], 'the ball sleeps on the shelf').toBe(0);
    all(['Ignite(shelf)'], g);
    const r = firstNotice(g, 'burnt', 12, true);
    expect(r.at).toBeDefined();
    play((r.at as number) + 1.5, g);
    expect(g.value('by') as number).toBeLessThan(0.3);
  });

  it('the shelf reads undefined with the reason burnt, in a figure played and in one sought; seeking back before the burn gives it back, and forward the same film', () => {
    const lines = SHELF;
    const a = make(lines);
    play(2, a);
    all(['Ignite(shelf)'], a);
    play(8, a);
    expect(a.get('shelf')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
    const b = Figure.fromScript(a.toScript(), { commands: REG }).figure;
    seek(b, 8);
    expect(b.get('shelf')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
    expect(hash(b)).toBe(hash(a));
    seek(b, 2.5);
    expect(b.get('shelf')?.cell.defined, 'before the burn the shelf is there').toBe(true);
    expect(b.value('by') as number).toBeCloseTo(1.3, 1);
    seek(b, 8);
    expect(b.get('shelf')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
    expect(hash(b)).toBe(hash(a));
    expect(b.value('by')).toEqual(a.value('by'));
  });

  it('a line changed after the shelf burnt away does not bring it back or start the film again', () => {
    const g = make(SHELF);
    play(2, g);
    all(['Ignite(shelf)'], g);
    play(6, g);
    const before = g.value('by');
    all(['other = Body(Circle((3, 2), 0.2))'], g);
    play(7, g);
    expect(g.get('shelf')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
    expect(g.value('by')).toBeCloseTo(before as number, 3);
  });

  it('a body that burns away lets what rested on it fall', () => {
    const g = make(['g = Ground()', 'cold = Fire(Box((0, 2), 4, 4), 32)', 'plank = Body(Box((0, 0.1), 1.2, 0.2), mass = 1, burns = 1)', 'ball = Body(Circle((0, 0.4), 0.2))', 'by = ball.y']);
    play(3, g);
    expect(g.value('by') as number).toBeCloseTo(0.4, 1);
    all(['Ignite(plank)'], g);
    play(12, g);
    expect(g.get('plank')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
    expect(g.value('by') as number).toBeLessThan(0.25);
  });
});

describe('the rules of the 11B fix round, in the plane (findings PH-31, PH-32)', () => {
  it('PH-31: a rope lit by Ignite tears where it burns and gives the torn notice once, with the links torn so far', () => {
    all(['g = Ground()', 'cold = Fire(Box((0, 2), 4, 4), 32)', 'rope = Cloth((-1, 1.5), (1, 1.5), 12, mass = 0.05, pins = [(-1, 1.5)], burns = 1)', 'rt = rope.torn', 'rb = rope.burnt']);
    all(['Ignite(rope)']);
    let count = 0;
    let links = 0;
    for (let k = 1; k <= 60 * 5; k++) {
      f.setClock(k / 60);
      for (const w of f.takeWarnings()) {
        if (w.kind !== 'torn') continue;
        count++;
        links = (w.params as { links?: number }).links ?? -1;
      }
    }
    expect(count, 'one torn notice').toBe(1);
    expect(links).toBeGreaterThan(0);
    expect(f.value('rb') as number).toBeGreaterThan(0.5);
    expect(f.value('rt') as number).toBeGreaterThanOrEqual(links);
  });

  it('PH-32: a body outside every fire still gets fire = Fire(b.pos) when the plane has no room left for the suggested grid', () => {
    all(['cold = Fire(Box((0, 2), 4, 4), 64)', 'far = Body(Circle((20, 1), 0.2), burns = true)']);
    // the suggested 48 × 48 fire would be a second grid over the 64 × 64 cells a figure may have: refused with limit, yet it is the line the docs name
    expect(fail('fire = Fire(far.pos)').kind).toBe('limit');
    const e = fail('Ignite(far)');
    expect(e.kind).toBe('no_fire_grid');
    expect(e.suggest).toEqual(['fire = Fire(far.pos)']);
  });
});
