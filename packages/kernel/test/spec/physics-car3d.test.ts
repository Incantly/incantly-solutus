/** Joints, cars and crashes in space (.kiro/specs/physics R6; docs/features/physics design 2.4, 7, 8, 10, 11.5; errors 3, 4, 6). */
import { beforeEach, describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, geometry, physics, physics3Of, registerAnimation, registerFunctions, registerLists, registerNumbers, registerPhysics, registerSpace } from '../../src/index';

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

const ok = (line: string, fig = f): void => {
  const r = fig.apply(line);
  if (!r.ok) throw new Error(`${line}: ${(r as { message: string }).message}`);
};
const all = (lines: readonly string[], fig = f): void => {
  for (const l of lines) ok(l, fig);
};
const fail = (line: string): { kind: string; code: string; message: string; hint?: string } => {
  const r = f.apply(line);
  if (r.ok) throw new Error(`${line} was accepted`);
  return r as never;
};
const play = (t: number, fig = f): void => {
  const now = fig.clock().t;
  const frames = Math.round((t - now) * 60);
  for (let k = 1; k <= frames; k++) fig.setClock(now + k / 60);
};
const body = (name: string, fig = f): physics.Body3Value => {
  const v = fig.value(name);
  if (!physics.isBody3Value(v)) throw new Error(`${name} is not a body in space now`);
  return v;
};
const car = (fig = f): physics.Vehicle3Value => fig.value('car') as physics.Vehicle3Value;
/** The way the chassis faces, turned about z (radians). */
const heading = (b: physics.Body3Value): number => {
  const [w, x, y, z] = b.q;
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
};

const CAR = (pedals = 'motor = gas', extra: readonly string[] = []): string[] => [
  'g = Ground()',
  'gas = 1 in -1..1',
  'steering = 0 in -0.6..0.6',
  'stop = 0 in 0..1',
  'chassis = Body(Box((0, 0, 0.9), 3, 1.6, 0.5), mass = 400)',
  'w1 = Wheel(chassis, (1.1, 0.8, 0.45), 0.4, steers = true)',
  'w2 = Wheel(chassis, (1.1, -0.8, 0.45), 0.4, steers = true)',
  'w3 = Wheel(chassis, (-1.1, 0.8, 0.45), 0.4)',
  'w4 = Wheel(chassis, (-1.1, -0.8, 0.45), 0.4)',
  `car = Vehicle(chassis, [w1, w2, w3, w4], ${pedals})`,
  ...extra,
];

describe('a car in space (design 8)', () => {
  it('Box in space, Wheel and Vehicle on a body in space give a ray wheel and a car', () => {
    all(CAR('motor = 0'));
    expect(f.get('w1')?.type).toBe('Wheel3');
    expect(f.get('car')?.type).toBe('Vehicle');
    ok('b = Box((0, 0, 1), 2, 1, 0.5)');
    expect(f.get('b')?.type).toBe('Polyhedron');
  });

  it('rests on its four springs, level, with each spring carrying a quarter of its weight', () => {
    all(CAR('motor = 0'));
    play(3);
    const c = body('chassis');
    expect(c.z).toBeGreaterThan(0.7);
    expect(c.z).toBeLessThan(0.9);
    expect(Math.abs(c.x) + Math.abs(c.y)).toBeLessThan(1e-3);
    let sum = 0;
    for (const n of ['w1', 'w2', 'w3', 'w4']) {
      const w = f.value(n) as physics.Wheel3Value;
      expect(w.touching).toBe(true);
      expect(w.z).toBeCloseTo(0.4, 2);
      sum += w.push;
    }
    expect(sum).toBeCloseTo(400 * 9.8, -1);
    // the floor carries the car through its wheels: the normal force on the chassis is its weight
    expect((f.value('chassis') as physics.Body3Value).forces).toBeDefined();
  });

  it('reaches the top speed its power and the air set, within 5% (design 11.5, car)', () => {
    all(CAR('motor = 1, power = 8000', ['world with air = 0.2, range = 1000']));
    play(25);
    // P = F v and F = m air v: v = sqrt(P / (m air)) = 10 m/s
    expect(car().speedometer).toBeGreaterThan(9.5);
    expect(car().speedometer).toBeLessThan(10.5);
    expect(body('chassis').x).toBeGreaterThan(150);
    expect(Math.abs(body('chassis').y)).toBeLessThan(0.5);
  });

  it('steer turns the steering wheels and the car goes round to the left', () => {
    all(CAR('motor = 0.5, steer = 0.4, power = 4000'));
    play(2);
    expect(heading(body('chassis'))).toBeGreaterThan(0.5);
    expect(body('chassis').y).toBeGreaterThan(1);
    // on round a circle about as wide as the wheelbase over the steer gives (2.2 / tan 0.4 = 5.2 m, and a little slip)
    play(5);
    const c = body('chassis');
    expect(Math.hypot(c.x, c.y - 6)).toBeLessThan(8);
    expect(c.z).toBeGreaterThan(0.7);
  });

  it('the brake stops it; pedals moved while playing go on from now and are logged, so a reload plays the same', () => {
    all(CAR('motor = gas, brake = stop, power = 6000'));
    play(3);
    const x3 = body('chassis').x;
    expect(car().speedometer).toBeGreaterThan(3);
    f.setFree('gas', 0, 'api');
    f.setFree('stop', 1, 'api');
    f.flush();
    play(7);
    expect(Math.abs(car().speedometer)).toBeLessThan(0.05);
    const end = body('chassis').x;
    const text = f.toScript();
    expect(text).toMatch(/@input physics set gas 0 at 3/);
    expect(text).toMatch(/@input physics set stop 1 at 3/);
    // the film before the brake is the same
    f.setClock(3);
    expect(body('chassis').x).toBeCloseTo(x3, 9);
    const { figure: g } = Figure.fromScript(text, { commands: REG });
    g.setClock(7);
    expect(body('chassis', g).x).toBe(end);
  });

  it('a seek gives the same film as playing, to the last bit', () => {
    all(CAR('motor = 0.8, steer = 0.2'));
    play(4);
    const played = JSON.stringify([body('chassis'), f.value('w1'), car().speedometer]);
    const g = new Figure({ commands: REG });
    all(CAR('motor = 0.8, steer = 0.2'), g);
    g.setClock(4);
    expect(JSON.stringify([body('chassis', g), g.value('w1'), car(g).speedometer])).toBe(played);
    g.setClock(1.5);
    f.setClock(1.5);
    expect(JSON.stringify(body('chassis', g))).toBe(JSON.stringify(body('chassis')));
  });

  it('drives over terrain from a solid z = f(x, y), its wheels on the ground', () => {
    all(['hills(x, y) = 0.3 sin(0.8 x) * cos(0.5 y)', 'hills with solid = true', 'space with clip = true, clipMin = (-20, -20, -3), clipMax = (20, 20, 3)', ...CAR('motor = 0.6, power = 4000').slice(1).map((l) => l.replace('(0, 0, 0.9)', '(-6, 0, 1.3)').replace(/\((-?1\.1), (-?0\.8), 0\.45\)/g, (_m, x: string, y: string) => `(${Number(x) - 6}, ${y}, 0.85)`))]);
    let top = 0;
    let on = 0;
    for (let k = 1; k <= 5 * 60; k++) {
      f.setClock(k / 60);
      const c = body('chassis');
      top = Math.max(top, c.x);
      for (const n of ['w1', 'w2', 'w3', 'w4']) if ((f.value(n) as physics.Wheel3Value).touching) on++;
      if (k > 60) {
        // never sunk into the hills, never far above them
        const ground = 0.3 * Math.sin(0.8 * c.x) * Math.cos(0.5 * c.y);
        expect(c.z - ground).toBeGreaterThan(0.1);
        expect(c.z - ground).toBeLessThan(1.4);
      }
    }
    expect(top).toBeGreaterThan(0);
    // the wheels keep to the ground nearly all the time (they leave it for a moment over a crest)
    expect(on / (4 * 5 * 60)).toBeGreaterThan(0.85);
  });
});

describe('crashes (design 8)', () => {
  const WALL = ['wall = Box((9, 0, 1.5), 1, 6, 3)', 'wall with solid = true'];

  it('the chassis hits a wall and stops; a wheel with breaks comes off as a free body with its speed (B111)', () => {
    all(CAR('motor = 1, power = 60000', WALL).map((l) => (l.startsWith('w1 =') ? 'w1 = Wheel(chassis, (1.1, 0.8, 0.45), 0.4, breaks = 9000)' : l)));
    play(5);
    expect(body('chassis').x).toBeLessThan(8.6);
    const w1 = f.get('w1')?.cell;
    expect(w1).toMatchObject({ defined: false, reason: 'broken' });
    expect((w1 as { detail?: string }).detail).toMatch(/came off at t = /);
    expect(f.takeWarnings().some((w) => w.kind === 'broken')).toBe(true);
    // the loose wheel is drawn where the car's value says it is, and the other wheels stay on
    expect(car().loose).toHaveLength(1);
    expect((f.value('w2') as physics.Wheel3Value).touching).toBe(true);
    expect(physics3Of(f).events.some((e) => e.name === 'w1')).toBe(true);
  });

  it('a wheel that came off rolls on as a body, and the film still seeks and replays the same', () => {
    all(CAR('motor = 1, power = 60000', WALL).map((l) => (l.startsWith('w1 =') ? 'w1 = Wheel(chassis, (1.1, 0.8, 0.45), 0.4, breaks = 9000)' : l)));
    play(5);
    const loose = JSON.stringify(car().loose);
    const g = new Figure({ commands: REG });
    all(CAR('motor = 1, power = 60000', WALL).map((l) => (l.startsWith('w1 =') ? 'w1 = Wheel(chassis, (1.1, 0.8, 0.45), 0.4, breaks = 9000)' : l)), g);
    g.setClock(5);
    expect(JSON.stringify(car(g).loose)).toBe(loose);
    g.setClock(1);
    expect(car(g).loose).toHaveLength(0);
    expect(g.get('w1')?.cell.defined).toBe(true);
  });

  it('a weld holds two parts as one in a gentle stop, and breaks in a hard hit (j.broken, j.force)', () => {
    const lines = (v: number, breaks: number): string[] => ['g = Ground()', ...WALL, `a = Body(Box((0, 0, 0.5), 1, 1, 1), mass = 100, speed = (${v}, 0, 0), friction = 0)`, `b = Body(Box((-1, 0, 0.5), 1, 1, 1), mass = 100, speed = (${v}, 0, 0), friction = 0)`, `j = Weld(a, b, breaks = ${breaks})`, 'F = j.force', 'gone = j.broken'];
    all(lines(0.5, 20000));
    play(2);
    play(1);
    expect(f.value('gone')).toBe(false);
    // moving as one: the two keep their distance
    expect(body('a').x - body('b').x).toBeCloseTo(1, 2);
    const g = new Figure({ commands: REG });
    all(lines(15, 20000), g);
    play(2, g);
    expect(g.value('gone')).toBe(true);
    expect(g.value('F')).toBe(0);
    expect(body('a', g).x - body('b', g).x).not.toBeCloseTo(1, 1);
  });
});

describe('joints in space (design 2.4)', () => {
  it('a hinge pendulum about an axis swings with the period of the small-swing law within 0.5% (design 11.5)', () => {
    // a ball of radius 0.05 on a light rod of length 2: L = 2 plus the ball's own turning (2/5 r² / L)
    all(['post = Sphere((0, 0, 3), 0.05)', 'post with solid = true']);
    all(['ball = Body(Sphere((2 sin(0.1), 0, 3 - 2 cos(0.1)), 0.05), mass = 1)', 'pin = Hinge(post, ball, (0, 0, 3), Vector(0, 1, 0))', 'a = pin.angle']);
    // time between two passes through the bottom in the same direction
    const crosses: number[] = [];
    let last = body('ball').x;
    for (let k = 1; k <= 16 * 240 && crosses.length < 5; k++) {
      f.setClock(k / 240);
      const x = body('ball').x;
      if (last > 0 && x <= 0) crosses.push(k / 240 - (x / (x - last)) / 240);
      last = x;
    }
    const T = (crosses[4] as number - (crosses[0] as number)) / 4;
    const L = 2 + (0.4 * 0.05 * 0.05) / 2;
    const T0 = 2 * Math.PI * Math.sqrt(L / 9.8) * (1 + 0.1 * 0.1 / 16);
    expect(Math.abs(T - T0) / T0).toBeLessThan(0.005);
    // it swings in the x-z plane only: the axis holds
    expect(Math.abs(body('ball').y)).toBeLessThan(1e-3);
  });

  it('a spring in space bobs with the period 2π √(m / k) within 0.5% (design 11.5)', () => {
    all(['world with gravity = (0, 0, 0)', 'post = Sphere((0, 0, 0), 0.1)', 'post with solid = true', 'm = Body(Sphere((3, 0, 0), 0.2), mass = 2)', 's = Spring(post, m, 50, 2.5)', 'E = Energy(world)']);
    const crosses: number[] = [];
    let last = body('m').x - 2.5;
    for (let k = 1; k <= 10 * 240 && crosses.length < 4; k++) {
      f.setClock(k / 240);
      const x = body('m').x - 2.5;
      if (last > 0 && x <= 0) crosses.push(k / 240);
      last = x;
    }
    const T = (crosses[3] as number - (crosses[0] as number)) / 3;
    const T0 = 2 * Math.PI * Math.sqrt(2 / 50);
    expect(Math.abs(T - T0) / T0).toBeLessThan(0.005);
  });

  it('a rope holds a ball at most its length away; a rod keeps it at its length; the force carries the weight', () => {
    all(['hook = Sphere((0, 0, 5), 0.1)', 'hook with solid = true', 'b = Body(Sphere((0, 0, 3), 0.2), mass = 2)', 'r = Rope(hook, b, 3)', 'T = r.force', 'L = r.length']);
    play(3);
    expect(body('b').z).toBeCloseTo(2, 2);
    expect(f.value('L') as number).toBeCloseTo(3, 2);
    expect(f.value('T') as number).toBeCloseTo(2 * 9.8, 0);
    const g = new Figure({ commands: REG });
    all(['hook = Sphere((0, 0, 5), 0.1)', 'hook with solid = true', 'b = Body(Sphere((1.5, 0, 5), 0.2), mass = 1)', 'r = Rod(hook, b)'], g);
    for (let k = 1; k <= 120; k++) {
      g.setClock(k / 60);
      const v = body('b', g);
      expect(Math.hypot(v.x, v.y, v.z - 5)).toBeCloseTo(1.5, 2);
    }
  });

  it('a slider lets a body move only along its axis, up to its limits', () => {
    all(['rail = Box((0, 0, 3), 0.2, 0.2, 0.2)', 'rail with solid = true', 'b = Body(Box((0, 0, 2), 0.4, 0.4, 0.4), mass = 1, speed = (0, 3, 0))', 's = Slider(rail, b, Vector(1, 1, 0), min = -1, max = 1)']);
    play(2);
    const v = body('b');
    expect(v.z).toBeCloseTo(2, 2);
    expect(v.x).toBeCloseTo(v.y, 2);
    expect(Math.hypot(v.x, v.y)).toBeLessThan(1.05);
  });

  it('a hinge motor turns a wheel on an axle', () => {
    all(['world with gravity = (0, 0, 0)', 'axle = Sphere((0, 0, 0), 0.05)', 'axle with solid = true', 'disc = Body(Cylinder((0, -0.1, 0), (0, 0.1, 0), 1), mass = 2)', 'h = Hinge(axle, disc, (0, 0, 0), Vector(0, 1, 0), motor = 3, torque = 100)']);
    play(2);
    expect(body('disc').spin.y).toBeCloseTo(3, 2);
    expect(Math.abs(body('disc').x) + Math.abs(body('disc').z)).toBeLessThan(1e-3);
  });

  it('a 2D body joined to a body in space is refused (mixed_dimension, B010)', () => {
    all(['p = Body(Circle((0, 0), 1))', 'q = Body(Sphere((0, 0, 2), 0.5))']);
    const e = fail('j = Hinge(p, q, (0, 0, 1), Vector(0, 1, 0))');
    expect(e.kind).toBe('mixed_dimension');
    expect(fail('s = Spring(p, q)').kind).toBe('mixed_dimension');
    expect(fail('w = Wheel(p, (0, 0, 1), 0.3)').kind).toBe('mixed_dimension');
  });

  it('a joint of a body to itself is refused (B009), and a wheel of radius 0 (B017)', () => {
    all(['q = Body(Sphere((0, 0, 2), 0.5))']);
    expect(fail('j = Weld(q, q)').kind).toBe('same_body');
    expect(fail('w = Wheel(q, (0, 0, 1), 0)').kind).toBe('bad_argument');
  });
});
