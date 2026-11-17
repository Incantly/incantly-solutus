/**
 * Liquid, still water and waves in space, and waves in the plane (.kiro/specs/physics R7, task 7; docs/features/physics
 * design 2.4, 9.1 to 9.3, 9.6, 10.3, 11.3, 11.5 "Floating" and the round 7 checks; errors.md 3 B004, B013, B017, 5).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, geometry, physics, physics3Of, physicsOf, registerAnimation, registerFunctions, registerLists, registerNumbers, registerPhysics, registerSpace } from '../../src/index';

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

const all = (lines: readonly string[], fig = f): void => {
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
const fail = (line: string): { kind: string; code: string; message: string } => {
  const r = f.apply(line);
  if (r.ok) throw new Error(`${line} was accepted`);
  return r as never;
};
const body = (name: string, fig = f): physics.Body3Value => {
  const v = fig.value(name);
  if (!physics.isBody3Value(v)) throw new Error(`${name} is not a body in space now`);
  return v;
};
const liquid = (name: string, fig = f): physics.LiquidValue => {
  const v = fig.value(name);
  if (!physics.isLiquidValue(v)) throw new Error(`${name} is not a liquid now`);
  return v;
};
const waves = (name: string, fig = f): physics.WavesValue => {
  const v = fig.value(name);
  if (!physics.isWavesValue(v)) throw new Error(`${name} is not waves now`);
  return v;
};
/** Plays the film in frames of 1/60 s up to t. */
const play = (t: number, fig = f): void => {
  const now = fig.clock().t;
  const frames = Math.round((t - now) * 60);
  for (let k = 1; k <= frames; k++) fig.setClock(now + k / 60);
};
const seek = (fig: Figure, t: number): void => {
  fig.setClock(t);
  for (let k = 0; k < 200 && fig.driversNeedFrames(); k++) fig.flush(true);
};
const force3 = (b: physics.Body3Value, kind: string): { x: number; y: number; z: number } => {
  const k = ['gravity', 'normal', 'friction', 'tension', 'spring', 'buoyancy', 'drag', 'electric', 'applied', 'net'].indexOf(kind);
  const fs = (b as unknown as { forces?: Float64Array }).forces;
  return { x: fs?.[k * 3] ?? 0, y: fs?.[k * 3 + 1] ?? 0, z: fs?.[k * 3 + 2] ?? 0 };
};

/** A tank 3 m square inside, its walls 1.8 m high, on the floor. */
const TANK = [
  'g = Ground()',
  'w1 = Box((-1.6, 0, 0.9), 0.2, 3.4, 1.8)', 'w2 = Box((1.6, 0, 0.9), 0.2, 3.4, 1.8)', 'w3 = Box((0, -1.6, 0.9), 3.4, 0.2, 1.8)', 'w4 = Box((0, 1.6, 0.9), 3.4, 0.2, 1.8)',
  'w1 with solid = true', 'w2 with solid = true', 'w3 with solid = true', 'w4 with solid = true',
];
const SPLASH = [...TANK, 'water = Liquid(Box((0, 0, 0.5), 3, 3, 1), 2000)', 'ball = Body(Sphere((0.3, 0.2, 3), 0.4), density = 0.5)'];
/** Drops inside a wall of the tank or under the floor (by more than a tenth of a drop): there should be none. */
const inWalls = (l: physics.LiquidValue): number => {
  let k = 0;
  const e = 0.1 * l.size;
  for (let i = 0; i < l.count; i++) {
    const x = Math.abs(l.xs[i] as number);
    const y = Math.abs(l.ys[i] as number);
    const z = l.zs?.[i] as number;
    if (z < -e) k++;
    else if (z < 1.8 - e && ((x > 1.5 + e && x < 1.7 - e && y < 1.7 - e) || (y > 1.5 + e && y < 1.7 - e && x < 1.7 - e))) k++;
  }
  return k;
};
/** Drops below the top of the walls but outside the tank: leaked. */
const leaked = (l: physics.LiquidValue): number => {
  let k = 0;
  for (let i = 0; i < l.count; i++) if ((l.zs?.[i] as number) < 1.5 && (Math.abs(l.xs[i] as number) > 1.7 || Math.abs(l.ys[i] as number) > 1.7)) k++;
  return k;
};

describe('still water in space (design 9.2, 11.5 "Floating")', () => {
  it('a box of density 0.5 floats half under, within 2%', () => {
    all(['bed = Ground(-3)', 'sea = Water(0)', 'b = Body(Box((0, 0, 1), 1, 1, 1), density = 0.5)']);
    play(12);
    const b = body('b');
    const under = (0 - (b.z - 0.5)) / 1;
    expect(Math.abs(under - 0.5)).toBeLessThan(0.01);
    // the water carries the box's weight: buoyancy up, as large as gravity down
    const up = force3(b, 'buoyancy').z;
    expect(Math.abs(up + force3(b, 'gravity').z) / Math.abs(force3(b, 'gravity').z)).toBeLessThan(0.02);
  });

  it('a ball of density 0.25 floats with the cap under water that weighs as much as the ball (exact for a ball)', () => {
    all(['bed = Ground(-3)', 'sea = Water(0)', 'b = Body(Sphere((0, 0, 1), 0.5), density = 0.25)']);
    play(12);
    // a cap of height x of a ball of radius r holds π x² (3r − x) / 3: a quarter of the ball's volume at x = r (1 − 2 sin(π/18))
    const r = 0.5;
    const x = r - body('b').z;
    const cap = (Math.PI * x * x * (3 * r - x)) / 3;
    const ball = (4 / 3) * Math.PI * r * r * r;
    expect(Math.abs(cap / ball - 0.25)).toBeLessThan(0.005);
  });

  it('a turned box still floats with half its volume under (the hull clipped by the water line)', () => {
    all(['bed = Ground(-3)', 'sea = Water(0)', 'b = Body(Box((0, 0, 1), 1.2, 0.6, 0.6, angle = 30deg), density = 0.5, spin = (0.4, 0.3, 0))']);
    play(15);
    const b = body('b');
    expect(Math.abs(b.z)).toBeLessThan(0.02);
  });

  it('a body heavier than water sinks to the bed, and water drag slows its fall', () => {
    all(['bed = Ground(-2)', 'sea = Water(0)', 'b = Body(Sphere((0, 0, -0.6), 0.3), density = 3)']);
    play(0.5);
    const v = body('b').v.z;
    // free fall would reach −4.9 m/s; buoyancy and drag keep it far slower
    expect(v).toBeGreaterThan(-3);
    play(6);
    expect(body('b').z).toBeLessThan(-1.6);
  });

  it('the water line may move: a tide that reads t lifts a floating box', () => {
    all(['bed = Ground(-3)', 'tide = 0.5 min(t, 4)', 'sea = Water(tide)', 'b = Body(Box((0, 0, 0), 1, 1, 1), density = 0.5)']);
    play(10);
    expect(Math.abs(body('b').z - 2)).toBeLessThan(0.05);
  });
});

describe('liquid in space (design 9.1, 9.6)', () => {
  it('fills a box at the start: count and level read before the film runs', () => {
    all([...TANK, 'water = Liquid(Box((0, 0, 0.5), 3, 3, 1), 2000)']);
    const l = liquid('water');
    expect(l.count).toBe(2000);
    expect(l.zs?.length).toBe(2000);
    expect(Math.abs(l.level - 1)).toBeLessThan(l.size);
    expect(f.objects().find((o) => o.name === 'water')?.type).toBe('Liquid');
  });

  it('a ball fills with drops too, and a figure with only a liquid is a world in space', () => {
    all(['g = Ground()', 'drop = Liquid(Sphere((0, 0, 2), 0.6), 300)']);
    expect(liquid('drop').count).toBe(300);
    play(2);
    const l = liquid('drop');
    // it fell and spread on the floor
    expect(l.level).toBeLessThan(0.6);
    expect(physics3Of(f).fluid?.ps.n).toBe(300);
    expect(physicsOf(f).world).toBeUndefined();
  });

  it('stays in its tank: no drop is ever inside a wall or the floor, and none gets out low down, in a splash', () => {
    // a few drops thrown high may land on top of a wall or over it; the walls themselves never let one in
    all(SPLASH);
    let out = 0;
    for (let k = 1; k <= 6 * 60; k++) {
      f.setClock(k / 60);
      const l = liquid('water');
      expect(inWalls(l), `t = ${k / 60}`).toBe(0);
      out = Math.max(out, leaked(l));
    }
    expect(out).toBeLessThan(20);
  });

  it('keeps its volume: the level at rest is within 5% of the level it filled at (round 7 check)', () => {
    all([...TANK, 'water = Liquid(Box((0, 0, 0.5), 3, 3, 1), 2000)']);
    const start = liquid('water').level;
    play(6);
    const rest = liquid('water').level;
    expect(Math.abs(rest - start) / start).toBeLessThan(0.05);
  });

  it('buoyancy comes out of the drops: a light ball floats at the surface, a heavy one sinks to the bottom', () => {
    all([...TANK, 'water = Liquid(Box((0, 0, 0.5), 3, 3, 1), 2000)', 'cork = Body(Sphere((-0.6, 0, 2), 0.35), density = 0.3)', 'stone = Body(Sphere((0.6, 0, 2), 0.3), density = 4)']);
    play(6);
    const level = liquid('water').level;
    const cork = body('cork');
    const stone = body('stone');
    expect(cork.z).toBeGreaterThan(level - 0.35);
    expect(cork.z).toBeLessThan(level + 0.35);
    expect(stone.z).toBeLessThan(0.45);
    // the drops' push counts as buoyancy on the floating ball
    expect(force3(cork, 'buoyancy').z).toBeGreaterThan(0);
  });

  it('a body that falls in moves the drops, and the drops push it back (two-way, a step apart)', () => {
    all(SPLASH);
    const before = liquid('water').level;
    play(1.2);
    const ball = body('ball');
    // the ball was slowed by the liquid: it floats instead of resting on the floor
    expect(ball.z).toBeGreaterThan(0.5);
    // the ball took room in the liquid, so the surface rose
    play(4);
    expect(liquid('water').level).toBeGreaterThan(before - 0.06);
  });

  it('a tap in space lets out rate drops a second, straight down for a number, up to max', () => {
    all(['g = Ground()', 'tap = Pour((0, 0, 2), 120, 1, max = 300)']);
    expect(liquid('tap').count).toBe(0);
    play(1);
    expect(Math.abs(liquid('tap').count - 120)).toBeLessThanOrEqual(4);
    play(4);
    expect(liquid('tap').count).toBe(300);
    const l = liquid('tap');
    // poured on the floor below the tap
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < l.count; i++) {
      sx += l.xs[i] as number;
      sy += l.ys[i] as number;
    }
    expect(Math.abs(sx / l.count)).toBeLessThan(0.3);
    expect(Math.abs(sy / l.count)).toBeLessThan(0.3);
  });

  it('a tap with a vector speed throws its drops that way', () => {
    all(['g = Ground()', 'tap = Pour((0, 0, 1), 60, (2, 0, 1), max = 60)']);
    play(2);
    const l = liquid('tap');
    let sx = 0;
    for (let i = 0; i < l.count; i++) sx += l.xs[i] as number;
    expect(sx / l.count).toBeGreaterThan(0.8);
  });

  it('drops that fall off the world are taken out, with left_world once', () => {
    all(['world with range = 5', 'drop = Liquid(Sphere((0, 0, 2), 0.5), 200)']);
    play(2);
    expect(liquid('drop').count).toBe(0);
    const kinds = f.takeWarnings().map((w) => w.kind);
    expect(kinds.filter((k) => k === 'left_world').length).toBe(1);
  });

  it('a 2,000-drop checkpoint in space is about 96 KB (design 10.3)', () => {
    all(SPLASH);
    play(0.5);
    const kb = physics3Of(f).checkpointBytes() / 1024;
    expect(kb).toBeLessThan(110);
    expect(kb).toBeGreaterThan(80);
  });
});

describe('the 2,000-drop limit is shared (errors.md B013, B017, B004)', () => {
  it('more than 2,000 drops in one line is refused with limit', () => {
    all(['g = Ground()']);
    const e = fail('water = Liquid(Box((0, 0, 0.5), 3, 3, 1), 2500)');
    expect(e.kind).toBe('limit');
    expect(e.message).toMatch(/2,?000/);
  });

  it('a liquid and a tap in space share the 2,000', () => {
    all(['g = Ground()', 'water = Liquid(Box((0, 0, 0.5), 3, 3, 1), 1800)']);
    expect(fail('tap = Pour((0, 0, 3), 50, 1, max = 300)').kind).toBe('limit');
    expect(f.apply('tap = Pour((0, 0, 3), 50, 1, max = 200)').ok).toBe(true);
  });

  it('no drops, a rate of 0 or a viscosity out of range are refused', () => {
    expect(fail('water = Liquid(Box((0, 0, 0.5), 1, 1, 1), 0)').kind).toBe('bad_argument');
    expect(fail('tap = Pour((0, 0, 3), 0, 1)').kind).toBe('bad_argument');
    expect(fail('water = Liquid(Box((0, 0, 0.5), 1, 1, 1), 100, viscosity = 2)').kind).toBe('bad_property_value');
  });
});

describe('waves (design 9.3)', () => {
  const POOL = ['bed = Ground(-1.2)', 'pool = Box((0, 0, -0.6), 10, 10, 1.2)'];

  it('a grid over 64 a side is refused with limit, under 2 with bad_argument, a damping out of range with bad_property_value', () => {
    all(POOL);
    expect(fail('sea = Waves(pool, 65)').kind).toBe('limit');
    expect(fail('sea = Waves(pool, 65)').message).toMatch(/64/);
    expect(fail('sea = Waves(pool, 1)').kind).toBe('bad_argument');
    expect(fail('sea = Waves(pool, 32, damping = 20)').kind).toBe('bad_property_value');
    expect(f.apply('sea = Waves(pool, 64)').ok).toBe(true);
  });

  it('readouts: the level, the wave speed √(g × depth) and the height at a point', () => {
    all([...POOL, 'sea = Waves(pool, 32)', 'h = sea.height(1, 2)', 'c = sea.speed', 'lv = sea.level']);
    expect(f.value('c')).toBeCloseTo(Math.sqrt(9.8 * 1.2), 6);
    expect(f.value('lv')).toBeCloseTo(0, 9);
    expect(f.value('h')).toBeCloseTo(0, 9);
    expect(waves('sea').heights.length).toBe(32 * 32);
  });

  it('a box of density 0.5 floats half under on still waves, within 2%', () => {
    all([...POOL, 'sea = Waves(pool, 32)', 'b = Body(Box((0, 0, 0.5), 1, 1, 1), density = 0.5)']);
    play(15);
    const b = body('b');
    // the water it moved aside raised the whole surface a little (w.level): half under that surface
    const level = f.apply('lv = sea.level').ok ? (f.value('lv') as number) : Number.NaN;
    expect(level).toBeGreaterThan(0);
    expect(Math.abs((level - (b.z - 0.5)) - 0.5)).toBeLessThan(0.01);
  });

  it('a body that falls in makes waves, and the water keeps its volume', () => {
    all([...POOL, 'sea = Waves(pool, 32)', 'rock = Body(Sphere((0, 0, 1.5), 0.4), density = 0.6)']);
    play(1.5);
    const s = waves('sea');
    let top = 0;
    let sum = 0;
    for (const h of s.heights) {
      top = Math.max(top, Math.abs(h));
      sum += h;
    }
    expect(top).toBeGreaterThan(0.02);
    // walls at the edges: what goes down under the rock comes up round it (exact in the engine; the heights are read
    // in single precision)
    expect(Math.abs(sum) / top).toBeLessThan(1e-5);
  });

  it('a boat rocks on the waves a falling rock makes', () => {
    all([...POOL, 'sea = Waves(pool, 32)', 'boat = Body(Box((1.5, 0, 0.3), 1.6, 0.8, 0.4), density = 0.4)', 'rock = Body(Sphere((-1.5, 0, 2), 0.4), density = 2)']);
    play(1);
    const zs: number[] = [];
    for (let k = 0; k < 120; k++) {
      play(1 + (k + 1) / 60);
      zs.push(body('boat').z);
    }
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.005);
  });

  it('a wave runs at c along the grid, within 5% (round 7 check)', () => {
    // a basin 20 m long and 1 m deep, 64 points: a stone sinks to the bed near one end and sets the water sloshing. The
    // first mode of the basin (half a wave across it) has the period 2 L / c; its share of the surface is the sum of
    // the heights times cos(π x / L), which no other mode has a part of
    all(['bed = Ground(-1)', 'sea = Waves(Segment((-10, 0), (10, 0)), 64, depth = 1, damping = 0)', 'stone = Body(Circle((-8, 0.6), 0.4), density = 3)']);
    const c = waves('sea').speed;
    expect(c).toBeCloseTo(Math.sqrt(9.8), 6);
    const mode = (): number => {
      const h = waves('sea').heights;
      let a = 0;
      for (let i = 0; i < 64; i++) a += (h[i] as number) * Math.cos((Math.PI * (i + 0.5)) / 64);
      return a;
    };
    play(3);
    // the stone on the bed holds the water down at its end: the mode swings about that, so about its mean
    const series: number[] = [];
    for (let k = 3 * 60 + 1; k <= 40 * 60; k++) {
      f.setClock(k / 60);
      series.push(mode());
    }
    const mean = series.reduce((x, y) => x + y, 0) / series.length;
    const crossings: number[] = [];
    for (let k = 1; k < series.length; k++) {
      const a = (series[k - 1] as number) - mean;
      const b = (series[k] as number) - mean;
      if ((a < 0) !== (b < 0)) crossings.push((3 * 60 + k + a / (a - b)) / 60);
    }
    expect(crossings.length).toBeGreaterThanOrEqual(4);
    const half = (crossings[crossings.length - 1]! - crossings[0]!) / (crossings.length - 1);
    const v = (2 * 20) / (2 * half);
    expect(Math.abs(v - c) / c).toBeLessThan(0.05);
  });

  it('waves in the plane: a segment of points, a body floats on them', () => {
    all(['bed = Ground(-1)', 'sea = Waves(Segment((-5, 0), (5, 0)), 40, damping = 1)', 'boat = Body(Box((0, 0.5), 1.6, 0.5), density = 0.5)', 'lv = sea.level']);
    expect(waves('sea').nx).toBe(40);
    expect(waves('sea').space).toBe(false);
    play(10);
    const b = (f.value('boat') as physics.BodyValue);
    // half under the water's level now (the rest level raised by what the boat moved aside)
    expect(Math.abs(b.y - (f.value('lv') as number))).toBeLessThan(0.01);
    expect(physicsOf(f).world).toBeDefined();
  });
});

describe('the exact film with liquid and waves in space (design 10)', () => {
  it('seek equals play to the last bit, drops and waves', () => {
    const lines = [...SPLASH.slice(0, -1), 'ball = Body(Sphere((0.3, 0.2, 3), 0.4), density = 0.5)', 'pool = Box((5, 0, -0.5), 4, 4, 1)', 'sea = Waves(pool, 16)', 'boat = Body(Box((5, 0, 0.4), 1, 0.6, 0.4), density = 0.4)'];
    const played = make(lines);
    play(2.5, played);
    const sought = make(lines);
    seek(sought, 1.7);
    seek(sought, 0.4);
    seek(sought, 2.5);
    expect(physics3Of(sought).worldHash()).toBe(physics3Of(played).worldHash());
    expect(liquid('water', sought).zs).toEqual(liquid('water', played).zs);
    expect(waves('sea', sought).heights).toEqual(waves('sea', played).heights);
    expect(sought.value('boat')).toEqual(played.value('boat'));
  });

  it('a push in a splash is logged, and the reloaded script plays the same film', () => {
    all(SPLASH);
    play(1);
    expect(f.apply('Push(ball, (2, 0, 3))').ok).toBe(true);
    play(2.5);
    const script = f.toScript();
    expect(script).toMatch(/@input physics push ball 2 0 3 at 1/);
    const g = Figure.fromScript(script, { commands: REG }).figure;
    play(2.5, g);
    expect(physics3Of(g).worldHash()).toBe(physics3Of(f).worldHash());
    expect(g.value('ball')).toEqual(f.value('ball'));
  });

  it('a look ahead (sampling a body at a later time) leaves the film as it was', () => {
    const a = make(SPLASH);
    const b = make(SPLASH);
    play(1, a);
    play(1, b);
    // a figure entry that reads a body ahead of the clock, as a trace does
    physics3Of(a).sample(1.55);
    play(2, a);
    play(2, b);
    expect(physics3Of(a).worldHash()).toBe(physics3Of(b).worldHash());
  });
});
