/**
 * Water and liquid in the plane (.kiro/specs/physics R7; docs/features/physics design 2.4, 9.1, 9.2, 9.6, 10.3, 11.3,
 * 11.5 "Floating"; errors.md 3 B004, B013, B017, 5 `left_world`).
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
const body = (name: string, fig = f): physics.BodyValue => {
  const v = fig.value(name);
  if (!physics.isBodyValue(v)) throw new Error(`${name} is not a body now`);
  return v;
};
const liquid = (name: string, fig = f): physics.LiquidValue => {
  const v = fig.value(name);
  if (!physics.isLiquidValue(v)) throw new Error(`${name} is not a liquid now`);
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
const force = (b: physics.BodyValue, kind: string): { x: number; y: number } => {
  const k = ['gravity', 'normal', 'friction', 'tension', 'spring', 'buoyancy', 'drag', 'electric', 'applied', 'net'].indexOf(kind);
  return { x: b.forces?.[k * 2] ?? 0, y: b.forces?.[k * 2 + 1] ?? 0 };
};

const TANK = ['tank = Polyline((-2, 6), (-2, 0), (2, 0), (2, 6))', 'tank with solid = true'];
const DAM = [
  'tank = Polyline((-6, 6), (-6, 0), (6, 0), (6, 6))',
  'tank with solid = true',
  'lift = 4 min(1, max(0, t - 0.5))',
  'gate = Segment((-2, lift), (-2, 4 + lift))',
  'gate with solid = true',
  'water = Liquid(Box((-4, 2), 4, 4), 1500)',
  'ball = Body(Circle((3.5, 0.45), 0.45), density = 0.4)',
];

describe('still water (design 9.2)', () => {
  it('a box of density 0.5 floats half under, within 2% (design 11.5 "Floating")', () => {
    all(['bed = Ground(-3)', 'sea = Water(0)', 'b = Body(Box((0, 1), 2, 0.5), density = 0.5)']);
    play(10);
    const b = body('b');
    // the box is 0.5 high: half under means its centre is on the water line
    const under = (0 - (b.y - 0.25)) / 0.5;
    expect(Math.abs(under - 0.5)).toBeLessThan(0.01);
    expect(b.asleep).toBe(true);
    // at rest, the push of the water carries the weight: counted as buoyancy, still shown while asleep
    expect(force(b, 'buoyancy').y / (b.mass * 9.8)).toBeCloseTo(1, 2);
  });

  it('floats at the depth its density gives: ice 92% under, a round log half under', () => {
    all(['bed = Ground(-3)', 'sea = Water(0)', 'ice = Body(Box((0, 1), 1, 1), density = 0.92)', 'logs = Body(Circle((4, 1), 0.5), density = 0.5)']);
    play(12);
    expect((0 - (body('ice').y - 0.5)) / 1).toBeCloseTo(0.92, 1);
    expect(body('logs').y).toBeCloseTo(0, 1);
  });

  it('a heavy body sinks to the bed, slowed by water drag', () => {
    all(['bed = Ground(-3)', 'sea = Water(0)', 'stone = Body(Box((0, 1), 1, 1), density = 2)']);
    play(1);
    const s = body('stone');
    expect(s.vy).toBeLessThan(0);
    expect(force(s, 'drag').y).toBeGreaterThan(0);
    play(8);
    expect(body('stone').y).toBeCloseTo(-2.5, 2);
  });

  it('water in a region only lifts what is inside it', () => {
    all(['bed = Ground(-3)', 'pond = Water(Box((-3, -1.5), 4, 3), 0)', 'a = Body(Box((-3, 1), 1, 1), density = 0.5)', 'b = Body(Box((3, 1), 1, 1), density = 0.5)']);
    play(8);
    expect(body('a').y).toBeCloseTo(0, 1);
    expect(body('b').y).toBeCloseTo(-2.5, 2);
    expect(f.value('pond.level')).toBeUndefined();
    all(['L = pond.level']);
    expect(f.value('L')).toBe(0);
  });

  it('a rising tide (a level that reads t) lifts a floating box with it', () => {
    all(['bed = Ground(-3)', 'tide = t / 4', 'sea = Water(tide)', 'b = Body(Box((0, 0.5), 1, 1), density = 0.5)']);
    play(4);
    expect(body('b').y).toBeCloseTo(1, 1);
  });
});

describe('liquid (design 9.1)', () => {
  it('Liquid fills its region with count drops; l.count and l.level read them, before and while the film runs', () => {
    all([...TANK, 'l = Liquid(Box((0, 1.5), 4, 3), 800)', 'n = l.count', 'lv = l.level']);
    expect(f.value('n')).toBe(800);
    expect(Math.abs((f.value('lv') as number) - 3)).toBeLessThan(0.1);
    expect(liquid('l').xs.length).toBe(800);
    play(4);
    expect(f.value('n')).toBe(800);
    // the drops settle; a liquid in a box keeps about its volume
    expect(f.value('lv') as number).toBeGreaterThan(2.6);
    expect(f.value('lv') as number).toBeLessThan(3.2);
    const l = liquid('l');
    for (let i = 0; i < l.count; i++) {
      expect(Math.abs(l.xs[i] as number)).toBeLessThan(2);
      expect(l.ys[i] as number).toBeGreaterThan(0);
    }
  });

  it('a box floats on liquid and a dense ball sinks: drops and bodies push each other (design 9.6)', () => {
    all([...TANK, 'l = Liquid(Box((0, 1.5), 4, 3), 1200)', 'boat = Body(Box((-0.8, 3.6), 1.2, 0.4), density = 0.5)', 'ball = Body(Circle((0.8, 3.8), 0.3), density = 3)']);
    play(8);
    const lv = liquid('l').level;
    const boat = body('boat');
    // the boat is in the surface, most of it near the water line
    expect(Math.abs(boat.y - lv)).toBeLessThan(0.3);
    expect(force(boat, 'buoyancy').y).toBeGreaterThan(0);
    // the ball is on the floor
    expect(body('ball').y).toBeLessThan(0.5);
  });

  it('a dam breaks: the gate lifts and the water spreads over the tank floor', () => {
    all([...DAM, 'depth = water.level']);
    play(0.4);
    const right = (): number => [...liquid('water').xs].filter((x) => x > -2).length;
    expect(right()).toBe(0);
    play(6);
    expect(right()).toBeGreaterThan(600);
    expect(f.value('depth') as number).toBeLessThan(2.5);
  });

  it('Pour lets out rate drops a second up to max, seeded, and a glass under it holds them', () => {
    all(['table = Ground()', 'glass = Polyline((-1, 2.5), (-1, 0), (1, 0), (1, 2.5))', 'glass with solid = true', 'tap = Pour((-0.4, 2.9), 90, 0.5, max = 300)', 'n = tap.count']);
    expect(f.value('n')).toBe(0);
    play(1);
    expect(Math.abs((f.value('n') as number) - 90)).toBeLessThanOrEqual(1);
    play(6);
    expect(f.value('n')).toBe(300);
    const l = liquid('tap');
    for (let i = 0; i < l.count; i++) expect(Math.abs(l.xs[i] as number)).toBeLessThan(1);
  });

  it('drops that leave the world are taken out, with one left_world notice', () => {
    all(['world with range = 6', 'slide = Segment((-3, 2), (3, 0))', 'slide with solid = true', 'tap = Pour((-2.5, 3), 60, 1, max = 60)', 'n = tap.count']);
    f.takeWarnings();
    play(6);
    expect(f.value('n') as number).toBeLessThan(60);
    const w = f.takeWarnings().filter((x) => x.kind === 'left_world');
    expect(w.length).toBe(1);
    expect(w[0]?.message).toMatch(/drops of tap left the world/);
  });
});

describe('the exact film with liquid (design 10)', () => {
  const hash = (fig: Figure): string => physicsOf(fig).worldHash();

  it('seek equals play, to the last bit, also back and forth', () => {
    all(DAM);
    play(3);
    const played = hash(f);
    const g = new Figure({ commands: REG });
    all(DAM, g);
    seek(g, 3);
    expect(hash(g)).toBe(played);
    seek(g, 1.3);
    seek(g, 3);
    expect(hash(g)).toBe(played);
    expect(liquid('water', g).xs).toEqual(liquid('water').xs);
  });

  it('the same film twice gives the same drops and bodies', () => {
    const g = new Figure({ commands: REG });
    all(DAM);
    all(DAM, g);
    for (let k = 1; k <= 4; k++) {
      play(k);
      play(k, g);
      expect(hash(g)).toBe(hash(f));
    }
  });

  it('a reload of the saved script, with a logged push, plays the same', () => {
    all(DAM);
    play(1);
    all(['Push(ball, (0, 3))']);
    play(3);
    const script = f.toScript();
    expect(script).toMatch(/@input physics push ball/);
    const { figure: g } = Figure.fromScript(script, { commands: REG });
    seek(g, 3);
    expect(hash(g)).toBe(hash(f));
    expect(body('ball', g).y).toBe(body('ball').y);
  });

  it('a checkpoint of 1,500 drops holds their places and speeds: about 48 KB (design 10.3)', () => {
    all(DAM);
    play(1);
    const d = physicsOf(f) as unknown as { saveState(): Float64Array };
    const kb = d.saveState().byteLength / 1024;
    expect(kb).toBeGreaterThan(46);
    expect(kb).toBeLessThan(60);
  });
});

describe('errors (errors.md 3)', () => {
  it('more than 2,000 drops is refused with limit (B013), also across liquids', () => {
    const e = fail('l = Liquid(Box((0, 2), 4, 4), 2500)');
    expect(e.kind).toBe('limit');
    all(['a = Liquid(Box((0, 2), 4, 4), 1500)']);
    const e2 = fail('b = Pour((0, 5), 50, 1, max = 600)');
    expect(e2.kind).toBe('limit');
    expect(e2.hint).toMatch(/1500 drops/);
    all(['b = Pour((0, 5), 50, 1, max = 500)']);
  });

  it('no drops, a rate of 0 and a viscosity out of range are refused (B017, B004)', () => {
    expect(fail('l = Liquid(Box((0, 2), 4, 4), 0)').kind).toBe('bad_argument');
    expect(fail('p = Pour((0, 5), 0, 1)').kind).toBe('bad_argument');
    expect(fail('l = Liquid(Box((0, 2), 4, 4), 100, viscosity = 2)').kind).toBe('bad_property_value');
    expect(fail('l = Liquid(Box((0, 2), 4, 4), 100, density = -1)').kind).toBe('bad_property_value');
  });

  it('a liquid in a region with no area, or water with an undefined level, is undefined, not an error', () => {
    all(['A = (0, 0)', 'l = Liquid(Polygon(A, A, A), 100)', 'k = 1 / 0 + undefined', 'sea = Water(k)']);
    expect(f.get('l')?.cell.defined).toBe(false);
    expect(f.get('sea')?.cell.defined).toBe(false);
  });
});
