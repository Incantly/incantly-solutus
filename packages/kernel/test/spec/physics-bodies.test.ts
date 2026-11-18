/** Bodies, solids, the world and the exact film (.kiro/specs/physics R1, R2, R8; docs/features/physics design 2, 5, 6, 10, 11.5; errors 3 to 5). */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, geometry, physics, physicsMath, physicsOf, playerOf, registerAnimation, registerFunctions, registerNumbers, registerPhysics } from '../../src/index';

const registry = (): CommandRegistry => {
  const r = new CommandRegistry();
  geometry.registerGeometry(r);
  registerNumbers(r);
  registerFunctions(r);
  registerAnimation(r);
  registerPhysics(r);
  return r;
};
const REG = registry();
const newFigure = (): Figure => new Figure({ commands: REG });

let f: Figure;
beforeEach(() => {
  f = newFigure();
});

const ok = (line: string, fig = f): void => {
  const r = fig.apply(line);
  if (!r.ok) throw new Error(`${line}: ${(r as { message: string }).message}`);
};
const all = (lines: readonly string[], fig = f): void => {
  for (const l of lines) ok(l, fig);
};
const body = (name: string, fig = f): physics.BodyValue => {
  const v = fig.value(name);
  if (!physics.isBodyValue(v)) throw new Error(`${name} is not a body now`);
  return v;
};
const fail = (line: string): { kind: string; message: string; hint?: string; suggest?: string[]; code: string } => {
  const r = f.apply(line);
  if (r.ok) throw new Error(`${line} was accepted`);
  return r as never;
};
/** Plays the film in frames of 1/60 s up to t. */
const play = (t: number, fig = f): void => {
  const now = fig.clock().t;
  const frames = Math.round((t - now) * 60);
  for (let k = 1; k <= frames; k++) fig.setClock(now + k / 60);
};

describe('exact maths (design 10.2)', () => {
  it('matches Math to about 1e-15 and uses only exact operations', () => {
    for (let i = 0; i < 2000; i++) {
      const x = (i - 1000) * 0.731;
      expect(physicsMath.sin(x)).toBeCloseTo(Math.sin(x), 14);
      expect(physicsMath.cos(x)).toBeCloseTo(Math.cos(x), 14);
      expect(physicsMath.atan2(x, 3 - i * 0.01)).toBeCloseTo(Math.atan2(x, 3 - i * 0.01), 14);
      expect(physicsMath.exp(x / 100)).toBeCloseTo(Math.exp(x / 100), 12);
    }
    expect(physicsMath.pow(2, 10)).toBe(1024);
    expect(physicsMath.pow(9, 0.5)).toBeCloseTo(3, 14);
  });

  it('no inexact Math function appears in the engine (design 10.2)', () => {
    const dir = join(__dirname, '../../src/physics');
    for (const file of readdirSync(dir)) {
      const src = readFileSync(join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(src, file).not.toMatch(/Math\.(sin|cos|tan|atan2?|asin|acos|exp|log|pow|hypot|cbrt|random)\b/);
    }
  });
});

describe('bodies and solids (R1)', () => {
  const ramp = ['g = Ground()', 'slope = Polygon((-6, 0), (4, 0), (-6, 5))', 'slope with solid = true', 'p = Box((-4.4, 4.76), 1, 1, angle = -26.6deg)', 'b = Body(p, mass = 2)'];

  it('a box on a ramp sticks when tan θ < μ and slides when above (design 11.5)', () => {
    all([...ramp, 'mu = 0.6', 'b with friction = mu']);
    play(2);
    const still = body('b');
    expect(Math.hypot(still.x + 4.4, still.y - 4.76)).toBeLessThan(0.01);
    expect(still.asleep).toBe(true);
    ok('mu = 0.4');
    play(3);
    expect(body('b').x).toBeGreaterThan(-3);
  });

  it('a block slides down with acceleration g (sin θ − μ cos θ) (design 11.5)', () => {
    const th = Math.atan(0.5);
    all([...ramp, 'b with friction = 0.2']);
    // let it start, then measure the speed gained over one second
    play(0.5);
    const v0 = Math.hypot(body('b').vx, body('b').vy);
    play(1.5);
    const v1 = Math.hypot(body('b').vx, body('b').vy);
    expect(v1 - v0).toBeCloseTo(9.8 * (Math.sin(th) - 0.2 * Math.cos(th)), 1);
  });

  it('a thrown body follows y = v0 t − g t²/2 within 1 mm (design 11.5)', () => {
    all(['c = Circle((0, 10), 0.2)', 'ball = Body(c, speed = (3, 4))']);
    play(2);
    const b = body('ball');
    expect(Math.abs(b.x - (0 + 3 * 2))).toBeLessThan(1e-3);
    expect(Math.abs(b.y - (10 + 4 * 2 - 0.5 * 9.8 * 4))).toBeLessThan(1e-3);
  });

  it('a perfect bounce keeps its height over many bounces (design 11.4)', () => {
    all(['g = Ground()', 'ball = Body(Circle((0, 1.5), 0.25), bounce = 1, friction = 0)']);
    const fig = f;
    const d = physicsOf(fig);
    let top = 0;
    let lastTop = 0;
    let rising = false;
    let prev = 1.5;
    let bounces = 0;
    for (let k = 1; k <= 60 * 400; k++) {
      fig.setClock(k / 60);
      const y = body('ball').y;
      if (y > prev) rising = true;
      else if (rising) {
        rising = false;
        lastTop = prev;
        if (top === 0) top = prev;
        bounces++;
      }
      prev = y;
    }
    expect(bounces).toBeGreaterThan(300);
    expect(Math.abs(lastTop - top) / top).toBeLessThan(0.01);
    expect(d.world).toBeDefined();
  });

  it('a tower of 10 boxes stands and falls asleep', () => {
    ok('g = Ground()');
    for (let i = 0; i < 10; i++) ok(`b${i} = Body(Box((0, ${0.5 + i}), 1, 1))`);
    play(4);
    const top = body('b9');
    expect(top.y).toBeGreaterThan(9.4);
    expect(Math.abs(top.x)).toBeLessThan(0.05);
    expect(top.asleep).toBe(true);
  });

  it('a tower of 20 boxes dropped with gaps (the default bounce 0.2) lands, stands straight and falls asleep', () => {
    // each box starts 10 cm above the one below: they land one on another and bounce. One point of a face at a time used
    // to take all of a bounce, so each landing set a box spinning: the tower tilted, walked over and never slept
    ok('g = Ground()');
    for (let i = 0; i < 20; i++) ok(`b${i} = Body(Box((0, ${0.6 + i * 1.1}), 1, 1))`);
    play(5);
    for (let i = 0; i < 20; i++) {
      expect(Math.abs(body(`b${i}`).x)).toBeLessThan(0.01);
      expect(Math.abs(body(`b${i}`).angle)).toBeLessThan(0.005);
    }
    // 20 contacts each within the 5 mm slop and the weight above: the top sits about 14 cm below 19.5
    expect(body('b19').y).toBeGreaterThan(19.3);
    expect(body('b19').asleep).toBe(true);
    play(10);
    expect(Math.abs(body('b19').x)).toBeLessThan(0.01);
  });

  it('a pile of 100 boxes dropped in five columns falls asleep within 5 s', () => {
    ok('g = Ground()');
    for (let i = 0; i < 100; i++) ok(`b${i} = Body(Box((${(i % 5) * 1.2 - 2.4}, ${0.6 + Math.floor(i / 5) * 1.1}), 1, 1))`);
    play(5);
    let awake = 0;
    for (let i = 0; i < 100; i++) if (!body(`b${i}`).asleep) awake++;
    expect(awake).toBe(0);
  });

  it('Bodies makes a list of bodies that fall and land', () => {
    all(['g = Ground()', 'bs = Bodies([Box((0, 1), 1, 1), Box((0, 3), 1, 1), Box((2, 2), 1, 1)], bounce = 0)']);
    play(3);
    const v = f.value('bs') as physics.BodyValue[];
    expect(v).toHaveLength(3);
    expect(v[0]?.y).toBeCloseTo(0.5, 1);
    expect(v[1]?.y).toBeCloseTo(1.5, 1);
    expect(v[2]?.y).toBeCloseTo(0.5, 1);
  });

  it('a mover that reads t pushes a body; a wall never moves', () => {
    all(['paddle = Segment((-2, t - 1), (2, t - 1))', 'paddle with solid = true', 'ball = Body(Circle((0, 0.5), 0.25), bounce = 0)']);
    play(3);
    // the paddle rose by 3: the ball rides on it
    expect(body('ball').y).toBeGreaterThan(2);
  });

  it('a function graph is solid ground (design 6.8)', () => {
    all(['h(x) = 0.2 x^2', 'h with solid = true', 'ball = Body(Circle((3, 4), 0.25), friction = 0.2)']);
    play(6);
    // it rolls down and settles near the bottom of the bowl
    expect(Math.abs(body('ball').x)).toBeLessThan(2.5);
    expect(body('ball').y).toBeLessThan(1.5);
  });

  it('a polygon with dents is split into convex parts, with a notice', () => {
    ok('g = Ground()');
    ok('L = Polygon((0, 0), (2, 0), (2, 1), (1, 1), (1, 2), (0, 2))');
    const r = f.apply('b = Body(L)');
    expect(r.ok).toBe(true);
    play(0.1);
    const notes = f.takeWarnings().map((w) => w.kind);
    expect(notes).toContain('split_shape');
    play(2);
    expect(body('b').y).toBeGreaterThan(0.5);
  });

  it('readouts: speed, energy, forces and touching', () => {
    all(['world with gravity = (0, -9.8)', ...ramp, 'v = b.v', 'n = b.force("normal")', 'en = world.energy']);
    play(2);
    const n = f.value('n') as { x: number; y: number };
    // resting on the slope: the push of the ground is m g cos θ
    expect(Math.hypot(n.x, n.y)).toBeCloseTo(2 * 9.8 * Math.cos(Math.atan(0.5)), 1);
    expect(body('b').touching).toContain('slope');
    expect(typeof f.value('en')).toBe('number');
  });

  it('gravity is a world property and may be a slider', () => {
    all(['gy = -2', 'world with gravity = (0, gy)', 'ball = Body(Circle((0, 10), 0.2))']);
    play(1);
    expect(body('ball').y).toBeCloseTo(10 - 0.5 * 2, 2);
  });
});

describe('the exact film (R2)', () => {
  const scene = ['g = Ground()', 'a = Body(Box((0, 3), 1, 1), spin = 2)', 'c = Body(Circle((0.3, 6), 0.4), bounce = 0.6)', 'd = Body(Box((1, 9), 2, 0.5))'];

  it('a seek gives the same film as playing frame by frame', () => {
    all(scene);
    play(5);
    const played = body('d');
    const g = newFigure();
    all(scene, g);
    g.setClock(5);
    g.setClock(5.0000001);
    g.setClock(5);
    const seeked = body('d', g);
    expect(seeked.x).toBe(played.x);
    expect(seeked.y).toBe(played.y);
    expect(seeked.angle).toBe(played.angle);
    // and back and forth again
    g.setClock(1.2);
    g.setClock(5);
    expect(body('d', g).y).toBe(played.y);
  });

  it('a push is logged, saved as @input and replays the same after a reload', () => {
    all(scene);
    play(1);
    ok('Push(a, (5, 0))');
    play(3);
    const before = body('a');
    const text = f.toScript();
    expect(text).toMatch(/@input physics push a 5 0 at 1/);
    const { figure: g } = Figure.fromScript(text, { commands: REG });
    g.setClock(3);
    expect(body('a', g).x).toBe(before.x);
    expect(body('a', g).y).toBe(before.y);
  });

  it('Restart() puts bodies back at their start at that time', () => {
    all(scene);
    play(2);
    ok('Restart()');
    play(2 + 1 / 60);
    expect(body('d').y).toBeGreaterThan(8.9);
  });

  it('a slider with rerun = continue changes the film from that time on', () => {
    all(['g = Ground()', 'gy = -9.8', 'gy with rerun = continue', 'world with gravity = (0, gy)', 'ball = Body(Circle((0, 50), 0.2))']);
    play(1);
    const at1 = body('ball').y;
    f.setFree('gy', 0, 'api');
    f.flush();
    play(2);
    // after t = 1 it no longer speeds up: it falls at the speed it had
    const at2 = body('ball').y;
    expect(at1 - at2).toBeCloseTo(9.8, 0);
    f.setClock(1);
    expect(body('ball').y).toBeCloseTo(at1, 6);
  });

  it('a slider with the default rerun = restart replays the whole film', () => {
    all(['g = Ground()', 'gy = -9.8', 'world with gravity = (0, gy)', 'ball = Body(Circle((0, 50), 0.2))']);
    play(1);
    ok('gy = -2');
    play(1.0001);
    expect(body('ball').y).toBeCloseTo(50 - 1, 1);
  });

  it('a far seek catches up over frames, and the playing clock waits for it (design 10.4, 10.5)', () => {
    // the pile is kept awake, so the 40 s of film cost what 200 moving bodies cost (a pile that sleeps catches up at once)
    all(['g = Ground()', 'world with sleep = false']);
    for (let i = 0; i < 200; i++) ok(`b${i} = Body(Box((${(i % 20) * 1.1 - 11}, ${1 + Math.floor(i / 20) * 1.1}), 1, 1))`);
    f.setClock(40);
    expect(f.driversNeedFrames()).toBe(true);
    const p = playerOf(f);
    p.play();
    p.frame(0);
    p.frame(0.016);
    expect(p.state.t).toBe(40);
    for (let k = 0; k < 400 && f.driversNeedFrames(); k++) p.frame(0.016 * (k + 2));
    expect(f.driversNeedFrames()).toBe(false);
  });

  it('checkpoints stay within 32 MB (design 10.3)', () => {
    expect(36 * 1024 * 1024).toBeGreaterThan(32 * 1024 * 1024);
    all(scene);
    f.setClock(60);
    f.setClock(60.01);
    const d = physicsOf(f) as unknown as { cpBytes: number; checkpoints: Map<number, Float64Array> };
    expect(d.cpBytes).toBeLessThan(32 * 1024 * 1024);
    expect(d.checkpoints.size).toBeGreaterThan(100);
  });
});

describe('errors (errors 3)', () => {
  it('Body of a line is not_a_body_shape, with the solid line as the fix (B001)', () => {
    ok('L = Line((0, 0), (1, 1))');
    const e = fail('q = Body(L)');
    expect(e.kind).toBe('not_a_body_shape');
    expect(e.suggest).toEqual(['L with solid = true']);
  });

  it('a literal polygon with crossing edges is self_crossing (B002)', () => {
    ok('p = Polygon((0, 0), (2, 2), (2, 0), (0, 2))');
    expect(fail('b = Body(p)').kind).toBe('self_crossing');
  });

  it('bad literal properties are bad_property_value (B004, B005)', () => {
    ok('p = Box((0, 1), 1, 1)');
    expect(fail('b = Body(p, mass = 0)').kind).toBe('bad_property_value');
    expect(fail('b = Body(p, bounce = 1.5)').kind).toBe('bad_property_value');
    const e = fail('world with timestep = 1/100');
    expect(e.kind).toBe('bad_property_value');
    expect(e.suggest).toEqual(['world with timestep = 1/120']);
    expect(fail('world with passes = 50').kind).toBe('bad_property_value');
    ok('world with timestep = 1/240');
  });

  it('writing where a body is, is read_only (B007)', () => {
    ok('b = Body(Box((0, 1), 1, 1))');
    const e = fail('b with x = 3');
    expect(e.kind).toBe('read_only');
    expect(e.suggest?.[0]).toMatch(/^Push\(b/);
  });

  it('world and hit are reserved (B011)', () => {
    expect(fail('world = 3').kind).toBe('reserved_name');
    expect(fail('hit = 2').kind).toBe('reserved_name');
    expect(fail('w = World()').kind).toBe('reserved_name');
  });

  it('Push of something that is not a body is not_a_body (B008)', () => {
    ok('p = Box((0, 1), 1, 1)');
    expect(fail('Push(p, (1, 0))').kind).toBe('not_a_body');
  });
});
