/**
 * Smoke in the plane (.kiro/specs/physics R7.2; docs/features/physics design 2.3 `wind`, 2.4 `Smoke`, 9.4, 10.3, 11.3,
 * 11.5 "No volume lost", "Smoke kept", "Still air"; errors.md 3 B004, B013, B014, B017, 4 `input_undefined`,
 * `degenerate`, `unstable_world`).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, geometry, physics, physicsOf, registerAnimation, registerFunctions, registerLists, registerNumbers, registerPhysics } from '../../src/index';

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

const all = (lines: readonly string[], fig = f): void => {
  for (const l of lines) {
    const r = fig.apply(l);
    if (!r.ok) throw new Error(`${l}: ${(r as { message: string }).message}`);
  }
};
const fail = (line: string): { kind: string; code: string; message: string; hint?: string } => {
  const r = f.apply(line);
  if (r.ok) throw new Error(`${line} was accepted`);
  return r as never;
};
const smoke = (name: string, fig = f): physics.SmokeValue => {
  const v = fig.value(name);
  if (!physics.isSmokeValue(v)) throw new Error(`${name} is not smoke now`);
  return v;
};
const body = (name: string, fig = f): physics.BodyValue => {
  const v = fig.value(name);
  if (!physics.isBodyValue(v)) throw new Error(`${name} is not a body now`);
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
  for (let k = 0; k < 100 && fig.driversNeedFrames(); k++) fig.flush(true);
};
const grid = (fig = f): NonNullable<ReturnType<typeof physicsOf>['smokeMembers'][number]>['grid'] => {
  const g = physicsOf(fig).smokeMembers[0]?.grid;
  if (!g) throw new Error('no smoke grid');
  return g;
};
const force = (b: physics.BodyValue, kind: string): { x: number; y: number } => {
  const k = ['gravity', 'normal', 'friction', 'tension', 'spring', 'buoyancy', 'drag', 'electric', 'applied', 'net'].indexOf(kind);
  return { x: b.forces?.[k * 2] ?? 0, y: b.forces?.[k * 2 + 1] ?? 0 };
};
/** The smoke's centre: the density-weighted mean of the cell centres. */
const centre = (v: physics.SmokeValue): { x: number; y: number; m: number } => {
  const { n, x0, y0, x1, y1 } = v.spec;
  let m = 0;
  let x = 0;
  let y = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const d = v.density[j * n + i] as number;
      m += d;
      x += d * (x0 + ((i + 0.5) * (x1 - x0)) / n);
      y += d * (y0 + ((j + 0.5) * (y1 - y0)) / n);
    }
  }
  return { x: x / m, y: y / m, m };
};
/** The most smoke in the cells whose centres are within r of a point. */
const near = (v: physics.SmokeValue, px: number, py: number, r: number): number => {
  const { n, x0, y0, x1, y1 } = v.spec;
  let most = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + ((i + 0.5) * (x1 - x0)) / n;
      const y = y0 + ((j + 0.5) * (y1 - y0)) / n;
      if ((x - px) ** 2 + (y - py) ** 2 <= r * r) most = Math.max(most, v.density[j * n + i] as number);
    }
  }
  return most;
};

const CANDLE = ['sm = Smoke(Box((0, 2), 4, 4), 48, source = Circle((0, 0.3), 0.15), heat = 5)'];
const PAST_BALL = ['world with wind = (3, 0)', 'ball = Circle((0, 0), 0.6)', 'ball with solid = true', 'sm = Smoke(Box((1, 0), 10, 5), 64, source = Box((-3.6, 0), 0.3, 2))'];
const CLOSED = ['jar = Polyline((-2, 2), (-2, -2), (2, -2), (2, 2), (-2, 2))', 'jar with solid = true', 'sm = Smoke(Box((0, 0), 5, 5), 40, source = Circle((0, -1), 0.4), heat = 5, until = 0.5)'];
/** A film that reads everything: a gust formula of t, a solid, a light body blown along, a source that runs out. */
const GUSTY = [
  'world with wind = (3 + sin(2 t), 0)',
  'ball = Circle((0, 0), 0.7)',
  'ball with solid = true',
  'leaf = Body(Circle((2, 1.2), 0.2), mass = 0.02)',
  'sm = Smoke(Box((1, 0), 10, 6), 48, source = Box((-3.7, 0), 0.3, 2), heat = 1, until = 3)',
];

describe('Smoke (design 2.4, 9.4)', () => {
  it('starts with its source full of smoke, read before the film runs: sm.mass, sm.n, sm.speed, sm.at(x, y)', () => {
    all(['sm = Smoke(Box((0, 0), 4, 4), 16, source = Box((0, 0), 1, 1))', 'm = sm.mass', 'k = sm.n', 's = sm.speed', 'inside = sm.at(0.1, 0.1)', 'outside = sm.at(5, 5)']);
    // a 1 by 1 source on cells of 0.25 m: 16 cells of 1/16 m²
    expect(f.value('m')).toBeCloseTo(1, 12);
    expect(f.value('k')).toBe(16);
    expect(f.value('s')).toBe(0);
    expect(f.value('inside')).toBe(1);
    expect(f.value('outside')).toBe(0);
    expect(smoke('sm').density.length).toBe(256);
    expect(f.get('sm')?.type).toBe('Smoke');
  });

  it('a candle: heat lifts the smoke from a small source into a rising plume, straight up', () => {
    all(CANDLE);
    play(1);
    const a = centre(smoke('sm'));
    play(3);
    const b = centre(smoke('sm'));
    expect(b.y).toBeGreaterThan(a.y + 0.5);
    // the plume is symmetric: its centre stays over the flame
    expect(Math.abs(b.x)).toBeLessThan(1e-3);
    expect(smoke('sm').speed).toBeGreaterThan(1);
  });

  it('smoke with no heat, in still air, stays where it is made', () => {
    all(['sm = Smoke(Box((0, 0), 4, 4), 32, source = Circle((0, 0), 0.5), heat = 0)', 'm = sm.mass']);
    const m0 = f.value('m') as number;
    play(3);
    expect(f.value('m')).toBe(m0);
    expect(smoke('sm').speed).toBe(0);
  });

  it('world.wind carries the smoke downstream and round a solid ball, and none is inside the ball', () => {
    all(PAST_BALL);
    play(1);
    const a = centre(smoke('sm'));
    play(4);
    const v = smoke('sm');
    const b = centre(v);
    expect(b.x).toBeGreaterThan(a.x + 1.5);
    // round the ball: smoke beside it, none in it
    expect(near(v, 0, 0, 0.45)).toBe(0);
    expect(near(v, 0, 1, 0.3)).toBeGreaterThan(0.2);
    expect(near(v, 0, -1, 0.3)).toBeGreaterThan(0.2);
    // the air is faster round the sides of the ball than the wind
    expect(v.speed).toBeGreaterThan(3.2);
  });

  it('a smoke\'s own wind overrides world.wind; world.wind reads back, and a formula of t makes gusts', () => {
    all(['world with wind = (2 + 2 sin(3 t), 0)', 'w = world.wind', 'a = Smoke(Box((0, 0), 6, 4), 24, source = Circle((-2, 0), 0.3))']);
    play(0.5);
    const w = f.value('w') as { x: number; y: number };
    expect(w.x).toBeCloseTo(2 + 2 * Math.sin(1.5), 9);
    // the grid feels the wind of the last smoke step
    expect(Math.abs(grid().windX - w.x)).toBeLessThan(0.05);
    const g = new Figure({ commands: REG });
    all(['world with wind = (3, 0)', 'a = Smoke(Box((0, 0), 6, 4), 24, source = Circle((-2, 0), 0.3), wind = (-2, 0))'], g);
    play(1, g);
    expect(centre(smoke('a', g)).x).toBeLessThan(-2.2);
  });

  it('until: the source stops making smoke; in a closed jar the smoke left is kept', () => {
    all([...CLOSED, 'm = sm.mass']);
    play(0.5);
    const m1 = f.value('m') as number;
    play(0.6);
    const m2 = f.value('m') as number;
    expect(m2).toBeGreaterThan(m1 * 0.99);
    play(3);
    expect(Math.abs((f.value('m') as number) / m2 - 1)).toBeLessThan(1e-3);
  });

  it('a source that moves with t makes smoke where it is now', () => {
    all(['P = (t - 1.5, 0)', 'sm = Smoke(Box((0, 0), 4, 4), 32, source = P)']);
    play(0.2);
    expect(smoke('sm').density[16 * 32 + 4]).toBeGreaterThan(0.5);
    play(2.5);
    const v = smoke('sm');
    // now at x = 1: the cell under it is full of smoke
    expect(near(v, 1, 0, 0.1)).toBeGreaterThan(0.9);
  });
});

describe('smoke with solids and bodies, both ways (design 9.4, 9.6)', () => {
  it('the wind pushes a light body: a drag force, counted as drag, along the wind', () => {
    all(['world with gravity = (0, 0), wind = (4, 0)', 'leaf = Body(Circle((-2, 0), 0.3), mass = 0.02)', 'stone = Body(Circle((-2, 1.2), 0.3), mass = 20)', 'sm = Smoke(Box((0, 0), 8, 4), 48)']);
    play(0.5);
    const leaf = body('leaf');
    expect(leaf.vx).toBeGreaterThan(1);
    expect(leaf.x).toBeGreaterThan(-2);
    expect(force(leaf, 'drag').x).toBeGreaterThan(0);
    // a heavy body feels the same push and hardly moves
    expect(body('stone').vx).toBeLessThan(0.1);
    expect(body('stone').vx).toBeGreaterThan(0);
  });

  it('a body smaller than a cell is still carried by the air', () => {
    all(['world with gravity = (0, 0), wind = (4, 0)', 'seed = Body(Circle((-2, 0), 0.04), mass = 0.0005)', 'sm = Smoke(Box((0, 0), 8, 4), 32)']);
    play(0.5);
    expect(body('seed').vx).toBeGreaterThan(0.5);
  });

  it('a moving body stirs still air, and the air slows it down', () => {
    all(['world with gravity = (0, 0)', 'b = Body(Circle((-3, 0), 0.4), mass = 1, speed = (3, 0))', 'sm = Smoke(Box((0, 0), 8, 4), 48)']);
    play(1);
    expect(smoke('sm').speed).toBeGreaterThan(1);
    const b = body('b');
    expect(b.vx).toBeLessThan(3);
    expect(force(b, 'drag').x).toBeLessThan(0);
  });

  it('a solid shape that moves with t stirs the air too', () => {
    all(['x0 = 2 t - 2', 'paddle = Segment((x0, -1), (x0, 1))', 'paddle with solid = true', 'sm = Smoke(Box((0, 0), 6, 4), 40)']);
    play(1);
    expect(smoke('sm').speed).toBeGreaterThan(0.5);
  });

  it('smoke past a ball body: the body is pushed downstream and the smoke goes round it', () => {
    all(['world with gravity = (0, 0), wind = (3, 0)', 'ball = Body(Circle((0, 0), 0.5), mass = 0.2)', 'sm = Smoke(Box((1, 0), 10, 5), 48, source = Box((-3.6, 0), 0.3, 2))']);
    play(2);
    expect(body('ball').x).toBeGreaterThan(0.1);
    expect(near(smoke('sm'), body('ball').x, body('ball').y, 0.3)).toBe(0);
  });
});

describe('accuracy (design 11.5)', () => {
  it('no volume lost: after each projection the divergence is under 0.25% of (fastest air / cell size)', () => {
    for (const lines of [PAST_BALL, CANDLE, GUSTY]) {
      const g = new Figure({ commands: REG });
      all(lines, g);
      for (const t of [0.5, 1, 2, 3]) {
        play(t, g);
        const gr = grid(g);
        const scale = gr.maxSpeed() / Math.min(gr.dx, gr.dy);
        expect(gr.maxDivergence() / scale).toBeLessThan(2.5e-3);
      }
    }
  });

  it('smoke kept: with no source and closed walls the mass stays within 0.1% for 10 s', () => {
    all([...CLOSED, 'm = sm.mass']);
    play(0.6);
    const m0 = f.value('m') as number;
    let worst = 0;
    for (let t = 1; t <= 10; t++) {
      play(t);
      worst = Math.max(worst, Math.abs((f.value('m') as number) / m0 - 1));
    }
    expect(worst).toBeLessThan(1e-3);
    // and it really moved: the hot smoke rose to the jar's top
    expect(centre(smoke('sm')).y).toBeGreaterThan(0.3);
  });

  it('still air: a box with no heat and no wind stays still, to the last bit, for 10 s', () => {
    all(['ball = Circle((0, 0), 0.6)', 'ball with solid = true', 'sm = Smoke(Box((0, 0), 5, 5), 32, source = Circle((0, -1.5), 0.4), heat = 0)']);
    const d0 = smoke('sm').density.slice();
    play(10);
    expect(grid().maxSpeed()).toBe(0);
    expect(smoke('sm').density).toEqual(d0);
  });
});

describe('the exact film with smoke (design 10)', () => {
  const hash = (fig: Figure): string => physicsOf(fig).worldHash();

  it('seek equals play, to the last bit, also back and forth', () => {
    all(GUSTY);
    play(4);
    const played = hash(f);
    const g = new Figure({ commands: REG });
    all(GUSTY, g);
    seek(g, 4);
    expect(hash(g)).toBe(played);
    seek(g, 1.3);
    seek(g, 4);
    expect(hash(g)).toBe(played);
    expect(smoke('sm', g).density).toEqual(smoke('sm').density);
    expect(body('leaf', g).x).toBe(body('leaf').x);
  });

  it('seek equals play with a solid that moves with t, a source that moves and heat on a slider', () => {
    const lines = ['x0 = 2 t - 2', 'paddle = Segment((x0, -1), (x0, 1))', 'paddle with solid = true', 'P = (0.5 sin(t), -1.5)', 'k = 3', 'sm = Smoke(Box((0, 0), 6, 4), 40, source = P, heat = k)'];
    all(lines);
    play(2.7);
    const g = new Figure({ commands: REG });
    all(lines, g);
    seek(g, 2.7);
    expect(hash(g)).toBe(hash(f));
    seek(g, 0.4);
    seek(g, 2.7);
    expect(smoke('sm', g).density).toEqual(smoke('sm').density);
  });

  it('the same film twice gives the same smoke and bodies', () => {
    const g = new Figure({ commands: REG });
    all(GUSTY);
    all(GUSTY, g);
    for (let k = 1; k <= 4; k++) {
      play(k);
      play(k, g);
      expect(hash(g)).toBe(hash(f));
    }
  });

  it('a reload of the saved script, with a logged push, plays the same', () => {
    all(GUSTY);
    play(1);
    all(['Push(leaf, (0, 1))']);
    play(3);
    const script = f.toScript();
    expect(script).toMatch(/@input physics push leaf/);
    expect(script).toMatch(/world = World\(wind = \(3 \+ sin\(2 ?t\), 0\)\)/);
    const { figure: g } = Figure.fromScript(script, { commands: REG });
    seek(g, 3);
    expect(hash(g)).toBe(hash(f));
    expect(smoke('sm', g).density).toEqual(smoke('sm').density);
  });

  it('a checkpoint of a 64 by 64 grid holds the flow, the smoke and the pressure guess: about 130 KB (design 10.3)', () => {
    all(['sm = Smoke(Box((0, 0), 6, 6), 64, source = Circle((0, -2), 0.3))']);
    play(1);
    const d = physicsOf(f) as unknown as { saveState(): Float64Array };
    const kb = d.saveState().byteLength / 1024;
    expect(kb).toBeGreaterThan(120);
    expect(kb).toBeLessThan(140);
  });

  it('a grid that blows up stops with unstable_world, once, and seeking back shows it again', () => {
    all(CANDLE);
    play(1);
    const g = grid();
    // a pressure that is not a number, as a solve gone wrong would leave
    g.p.fill(Number.NaN);
    f.takeWarnings();
    play(1.1);
    expect(f.get('sm')?.cell.defined).toBe(false);
    expect((f.get('sm')?.cell as { reason?: string }).reason).toBe('unstable_world');
    expect(f.takeWarnings().filter((w) => w.kind === 'unstable_world').length).toBe(1);
    seek(f, 0.5);
    expect(f.get('sm')?.cell.defined).toBe(true);
  });
});

describe('errors (errors.md 3, 4)', () => {
  it('a grid over 64 by 64 is refused with limit (B013), also across grids', () => {
    expect(fail('a = Smoke(Box((0, 0), 4, 4), 65)').kind).toBe('limit');
    all(['a = Smoke(Box((0, 0), 4, 4), 48)']);
    const e = fail('b = Smoke(Box((0, 0), 4, 4), 48)');
    expect(e.kind).toBe('limit');
    expect(e.hint).toMatch(/2304 cells/);
    all(['b = Smoke(Box((0, 5), 4, 4), 42)']);
    // redefining a grid counts only the others
    all(['a = Smoke(Box((0, 0), 4, 4), 42)']);
  });

  it('a grid of 0, a fraction or under 4 cells a side is refused with bad_argument (B017)', () => {
    for (const n of ['0', '2.5', '-1', '3']) expect(fail(`a = Smoke(Box((0, 0), 4, 4), ${n})`).kind).toBe('bad_argument');
  });

  it('heat, wind and until out of range are refused with bad_property_value (B004); a number for wind is the wrong form', () => {
    expect(fail('a = Smoke(Box((0, 0), 4, 4), 16, heat = 99)').kind).toBe('bad_property_value');
    expect(fail('a = Smoke(Box((0, 0), 4, 4), 16, wind = (200, 0))').kind).toBe('bad_property_value');
    expect(fail('a = Smoke(Box((0, 0), 4, 4), 16, until = -1)').kind).toBe('bad_property_value');
    expect(fail('world with wind = (500, 0)').kind).toBe('bad_property_value');
    expect(fail('world with wind = 3').kind).toBe('no_matching_form');
    all(['world with wind = (30, -2)']);
  });

  it('an undefined or flat region, or an undefined source, gives undefined smoke with a reason, not an error', () => {
    all(['A = (0, 0)', 'k = 1 / 0 + undefined', 'flat = Smoke(Polygon(A, A, A), 16)', 'none = Smoke(Box((0, 0), 4, 4), k)', 'P = (k, 0)', 'nowhere = Smoke(Box((0, 0), 4, 4), 16, source = P)']);
    expect(f.get('flat')?.cell).toMatchObject({ defined: false, reason: 'degenerate' });
    expect(f.get('none')?.cell).toMatchObject({ defined: false, reason: 'input_undefined' });
    expect(f.get('nowhere')?.cell).toMatchObject({ defined: false, reason: 'input_undefined' });
  });
});
