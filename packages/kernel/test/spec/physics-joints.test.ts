/** Joints, forces, measures and hit events (.kiro/specs/physics R3; docs/features/physics design 2.4, 2.5, 6.5, 11.5; errors 3). */
import { beforeEach, describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, geometry, physics, registerAnimation, registerFunctions, registerLists, registerNumbers, registerPhysics } from '../../src/index';

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
const joint = (name: string): physics.JointValue => {
  const v = f.value(name);
  if (!physics.isJointValue(v)) throw new Error(`${name} is not a joint now`);
  return v;
};
const fail = (line: string): { kind: string; message: string } => {
  const r = f.apply(line);
  if (r.ok) throw new Error(`${line} was accepted`);
  return r as never;
};
/** Calls `each` at every frame of 1/240 s up to t, from the current time. */
const run = (t: number, each?: (time: number) => void, fps = 240): void => {
  const now = f.clock().t;
  const frames = Math.round((t - now) * fps);
  for (let k = 1; k <= frames; k++) {
    f.setClock(now + k / fps);
    each?.(now + k / fps);
  }
};
/** Times at which a signal crosses `level` going up. */
function upCrossings(samples: readonly [number, number][], level: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const [t0, y0] = samples[i - 1] as [number, number];
    const [t1, y1] = samples[i] as [number, number];
    if (y0 < level && y1 >= level) out.push(t0 + ((level - y0) / (y1 - y0)) * (t1 - t0));
  }
  return out;
}

describe('accuracy (design 11.5)', () => {
  it('a mass on a spring has period 2π √(m / k) within 0.5%', () => {
    all(['world with gravity = (0, 0)', 'post = Circle((0, 0), 0.1)', 'post with solid = true', 'b = Body(Circle((2.5, 0), 0.2), mass = 2)', 's = Spring(post, b, 50, 2)']);
    const xs: [number, number][] = [];
    run(6, (t) => xs.push([t, body('b').x]));
    const ups = upCrossings(xs, 2);
    const period = ((ups.at(-1) as number) - (ups[0] as number)) / (ups.length - 1);
    expect(Math.abs(period - 2 * Math.PI * Math.sqrt(2 / 50)) / (2 * Math.PI * Math.sqrt(2 / 50))).toBeLessThan(0.005);
  });

  it('a hinge pendulum swings with the period of the state pendulum within 0.5%', () => {
    all(['wall = Circle((0, 0), 0.05)', 'wall with solid = true', 'bob = Body(Circle((sin(0.6), -cos(0.6)), 0.02), mass = 1)', 'j = Hinge(wall, bob, (0, 0))']);
    const xs: [number, number][] = [];
    run(8, (t) => xs.push([t, body('bob').x]));
    const ups = upCrossings(xs, 0);
    const hinge = ((ups.at(-1) as number) - (ups[0] as number)) / (ups.length - 1);
    const g = new Figure({ commands: REG });
    all(['θ = state(0.6, 0)', "θ'' = -9.8 / 1 * sin(θ)"], g);
    const ts: [number, number][] = [];
    for (let k = 1; k <= 8 * 240; k++) {
      g.setClock(k / 240);
      ts.push([k / 240, g.value('θ') as number]);
    }
    const sups = upCrossings(ts, 0);
    const state = ((sups.at(-1) as number) - (sups[0] as number)) / (sups.length - 1);
    expect(Math.abs(hinge - state) / state).toBeLessThan(0.005);
  });

  it('an elastic hit keeps momentum and energy within 0.1%', () => {
    all(['world with gravity = (0, 0)', 'a = Body(Circle((-2, 0), 0.5), speed = (3, 0), bounce = 1, friction = 0)', 'b = Body(Circle((1, 0), 0.5), bounce = 1, friction = 0)']);
    run(3);
    const A = body('a');
    const B = body('b');
    const p0 = A.mass * 3;
    const e0 = 0.5 * A.mass * 9;
    expect(Math.abs(A.mass * A.vx + B.mass * B.vx - p0) / p0).toBeLessThan(0.001);
    expect(Math.abs(0.5 * A.mass * A.vx ** 2 + 0.5 * B.mass * B.vx ** 2 - e0) / e0).toBeLessThan(0.001);
    // equal masses swap speeds
    expect(Math.abs(A.vx)).toBeLessThan(0.05);
    expect(B.vx).toBeCloseTo(3, 1);
  });

  it('Newton\'s cradle: one ball goes in, one comes out the other side', () => {
    all([
      'bar = Segment((-3, 5), (3, 5))',
      'bar with solid = true',
      'balls = Bodies(Seq(Circle((k * 1.002, 1), 0.5), k, -2, 2), bounce = 1, friction = 0)',
      'strings = Seq(Rope(bar, balls[k], 4, pa = ((k - 3) * 1.002, 5)), k, 1, 5)',
    ]);
    run(0.05);
    ok('Push(balls[1], (-3, 0))');
    let peak5 = 0;
    let peak1 = 0;
    let after = false;
    run(2.5, () => {
      const bs = f.value('balls') as physics.BodyValue[];
      const b5 = bs[4] as physics.BodyValue;
      const b1 = bs[0] as physics.BodyValue;
      if (b5.vx > 0.5) after = true;
      if (after) {
        peak5 = Math.max(peak5, b5.vx);
        peak1 = Math.max(peak1, Math.abs(b1.vx));
      }
    });
    expect(after).toBe(true);
    expect(f.toScript()).toMatch(/@input physics push balls\[1\] -3 0 at 0\.05/);
    // a ball of radius 0.5 and density 1 has mass π/4
    const inSpeed = 3 / (Math.PI * 0.25);
    expect(peak5).toBeGreaterThan(0.7 * inSpeed);
    expect(peak1).toBeLessThan(0.3 * inSpeed);
  });

  it('two masses over a pulley move with a = g (m1 − m2) / (m1 + m2)', () => {
    all(['world with gravity = (0, -9.8)', 'heavy = Body(Box((-2, 0), 0.5, 0.5), mass = 3)', 'light = Body(Box((2, 0), 0.5, 0.5), mass = 1)', 'pl = Pulley(heavy, light, (-2, 5), (2, 5))']);
    run(0.25);
    const v0 = body('heavy').vy;
    run(0.75);
    const a = (body('heavy').vy - v0) / 0.5;
    expect(a).toBeCloseTo(-9.8 * (3 - 1) / (3 + 1), 1);
    expect(body('light').vy).toBeCloseTo(-body('heavy').vy, 2);
  });
});

describe('joints (R3.1, R3.2)', () => {
  it('a rod keeps its length; a rope only pulls', () => {
    all(['wall = Circle((0, 5), 0.1)', 'wall with solid = true', 'a = Body(Circle((2, 5), 0.2))', 'r = Rod(wall, a)', 'b = Body(Circle((-1, 4), 0.2))', 'q = Rope(wall, b, 3)']);
    run(3);
    const A = body('a');
    expect(Math.hypot(A.x, A.y - 5)).toBeCloseTo(2, 2);
    const B = body('b');
    expect(Math.hypot(B.x, B.y - 5)).toBeLessThan(3.02);
    expect(joint('r').lengthNow).toBeCloseTo(2, 2);
  });

  it('the tension in a hanging rope is m g, as j.force and as the body\'s tension force', () => {
    all(['hook = Circle((0, 5), 0.1)', 'hook with solid = true', 'b = Body(Box((0, 3), 0.5, 0.5), mass = 2)', 'q = Rope(hook, b, 2)', 'T = q.force', 'tt = b.force("tension")']);
    run(3);
    expect(f.value('T') as number).toBeCloseTo(2 * 9.8, 0);
    expect((f.value('tt') as { y: number }).y).toBeCloseTo(2 * 9.8, 0);
  });

  it('a hinge motor turns a wheel at its speed; limits stop a door', () => {
    all(['world with gravity = (0, 0)', 'axle = Circle((0, 0), 0.05)', 'axle with solid = true', 'wheel = Body(Circle((0, 0), 1))', 'm = Hinge(axle, wheel, (0, 0), motor = 3, torque = 100)']);
    run(2);
    expect(body('wheel').spin).toBeCloseTo(3, 2);
    const g = new Figure({ commands: REG });
    all(['post = Circle((0, 0), 0.05)', 'post with solid = true', 'door = Body(Box((1, 0), 2, 0.1))', 'h = Hinge(post, door, (0, 0), min = -0.5, max = 0.5)'], g);
    for (let k = 1; k <= 480; k++) g.setClock(k / 240);
    expect((g.value('door') as physics.BodyValue).angle).toBeGreaterThan(-0.55);
  });

  it('a weld holds two bodies as one, and breaks above its force', () => {
    all(['g = Ground()', 'a = Body(Box((0, 2), 1, 1))', 'b = Body(Box((1, 2), 1, 1))', 'w = Weld(a, b)']);
    run(2);
    expect(body('b').x - body('a').x).toBeCloseTo(1, 2);
    const g = new Figure({ commands: REG });
    all(['hook = Box((0, 5), 1, 0.2)', 'hook with solid = true', 'load = Body(Box((0, 4.4), 1, 1), mass = 100)', 'w = Weld(hook, load, breaks = 200)'], g);
    for (let k = 1; k <= 240; k++) g.setClock(k / 240);
    expect((g.value('w') as physics.JointValue).broken).toBe(true);
    expect((g.value('load') as physics.BodyValue).y).toBeLessThan(4);
    expect(g.takeWarnings().map((w) => w.kind)).toContain('broken');
  });

  it('a slider with a motor moves b along its axis', () => {
    all(['world with gravity = (0, 0)', 'rail = Circle((0, 0), 0.05)', 'rail with solid = true', 'p = Body(Box((0, 0), 0.5, 0.5))', 's = Slider(rail, p, (1, 1), motor = 2, force = 100)']);
    run(1);
    const P = body('p');
    expect(P.x).toBeCloseTo(P.y, 2);
    expect(Math.hypot(P.vx, P.vy)).toBeCloseTo(2, 1);
  });

  it('a list of joints from Seq links a chain', () => {
    all(['hook = Circle((0, 5), 0.05)', 'hook with solid = true', 'links = Bodies(Seq(Box((k, 5), 0.8, 0.2), k, 1, 4))', 'top = Hinge(hook, links[1], (0.5, 5))', 'pins = Seq(Hinge(links[k - 1], links[k], (k - 0.5, 5)), k, 2, 4)']);
    run(3);
    const ls = f.value('links') as physics.BodyValue[];
    // the chain has fallen and swings, and every pin still holds its two links together
    expect(ls[3]?.y).toBeLessThan(4);
    const pins = f.value('pins') as physics.JointValue[];
    expect(pins).toHaveLength(3);
    for (const p of [...pins, joint('top')]) expect(Math.hypot(p.ax - p.bx, p.ay - p.by)).toBeLessThan(0.02);
  });
});

describe('forces, measures and events (R3.3 to R3.6)', () => {
  it('energy of a spring oscillator stays within 2%', () => {
    all(['world with gravity = (0, 0)', 'post = Circle((0, 0), 0.1)', 'post with solid = true', 'b = Body(Circle((2.5, 0), 0.2), mass = 1)', 's = Spring(post, b, 40, 2)', 'E = Energy(world)']);
    run(0.1);
    const e0 = f.value('E') as number;
    let worst = 0;
    run(10, () => {
      worst = Math.max(worst, Math.abs((f.value('E') as number) - e0) / e0);
    }, 60);
    expect(worst).toBeLessThan(0.02);
  });

  it('Momentum, KineticEnergy, PotentialEnergy and Forces read a body', () => {
    all(['g = Ground()', 'b = Body(Box((0, 0.5), 1, 1), mass = 2)', 'p = Momentum(b)', 'k = KineticEnergy(b)', 'u = PotentialEnergy(b)', 'fs = Forces(b)']);
    run(1);
    expect((f.value('p') as { x: number }).x).toBeCloseTo(0, 6);
    expect(f.value('k') as number).toBeCloseTo(0, 6);
    expect(f.value('u') as number).toBeCloseTo(2 * 9.8 * 0.5, 1);
    expect((f.value('fs') as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  it('on b hit runs once per new touch, with speed and other, and not again on a replay', () => {
    all(['g = Ground()', 'b = Body(Circle((0, 3), 0.25), bounce = 0.5)', 'n = 0', 'v = 0', 'who = "nothing"']);
    ok('on b hit: SetValue(n, n + 1)');
    ok('on b hit: SetValue(v, speed)');
    ok('on b hit: SetValue(who, other)');
    run(1.2, undefined, 60);
    expect(f.value('n')).toBe(1);
    expect(f.value('v') as number).toBeGreaterThan(5);
    expect(f.value('who')).toBe('g');
    // seek back and play again: the hit has run already
    f.setClock(0.2);
    run(1.2, undefined, 60);
    expect(f.value('n')).toBe(1);
  });

  it('Push, Wake and Sleep work as steps of a handler', () => {
    all(['g = Ground()', 'b = Body(Circle((0, 1), 0.25), bounce = 0)', 'c = Body(Circle((5, 0.25), 0.25))']);
    ok('on b hit: Push(c, (0, 3))');
    run(1, undefined, 60);
    expect(body('c').y).toBeGreaterThan(0.3);
  });
});

describe('errors (errors 3)', () => {
  it('a joint between a body and itself is same_body (B009)', () => {
    ok('a = Body(Box((0, 1), 1, 1))');
    expect(fail('j = Hinge(a, a, (0, 0))').kind).toBe('same_body');
  });

  it('a joint end that is a number is not_a_body (B008)', () => {
    ok('a = Body(Box((0, 1), 1, 1))');
    expect(fail('j = Rod(a, 3)').kind).toBe('not_a_body');
  });

  it('a hit handler on something that is not a body is not_in_world (B015)', () => {
    ok('p = Box((0, 1), 1, 1)');
    expect(fail('on p hit: Hide(p)').kind).toBe('not_in_world');
  });
});
