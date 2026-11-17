/** Bodies in space (.kiro/specs/physics R5; docs/features/physics design 7, 10, 11.5; errors 3 and 5). */
import { beforeEach, describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, geometry, physics, physics3Of, physicsOf, valueText, registerAnimation, registerFunctions, registerLists, registerNumbers, registerPhysics, registerSpace } from '../../src/index';

const registry = (): CommandRegistry => {
  const r = new CommandRegistry();
  geometry.registerGeometry(r);
  registerNumbers(r);
  registerFunctions(r);
  registerAnimation(r);
  registerLists(r);
  registerSpace(r);
  registerPhysics(r);
  return r;
};
const REG = registry();

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
const body = (name: string, fig = f): physics.Body3Value => {
  const v = fig.value(name);
  if (!physics.isBody3Value(v)) throw new Error(`${name} is not a body in space now`);
  return v;
};
/** Plays the film in frames of 1/60 s up to t. */
const play = (t: number, fig = f): void => {
  const now = fig.clock().t;
  const frames = Math.round((t - now) * 60);
  for (let k = 1; k <= frames; k++) fig.setClock(now + k / 60);
};

const CUBE = (x: number, y: number, z: number, s = 1): string => `Cube((${x}, ${y}, ${z}), (${x + s}, ${y}, ${z}), (${x}, ${y + s}, ${z}))`;

describe('bodies in space (R5.1)', () => {
  it('Body on a cube, a sphere, a cylinder, a cone and a tetrahedron gives a Body3 with its mass and centre', () => {
    all([`a = Body(${CUBE(0, 0, 1, 2)}, density = 2)`, 'b = Body(Sphere((5, 0, 3), 1), mass = 4)', 'c = Body(Cylinder((0, 5, 0), (0, 5, 2), 0.5))', 'd = Body(Cone((3, 5, 0), (3, 5, 3), 1))', 'tet = Body(Tetrahedron((0, -4, 0), (1, -4, 0), (0, -3, 0)))']);
    for (const n of ['a', 'b', 'c', 'd', 'tet']) expect(f.get(n)?.type).toBe('Body3');
    const a = body('a');
    expect(a.mass).toBeCloseTo(16, 12);
    expect([a.x, a.y, a.z]).toEqual([expect.closeTo(1, 12), expect.closeTo(1, 12), expect.closeTo(2, 12)]);
    expect(body('b').mass).toBe(4);
    // a cylinder of 24 sides: its volume is that of the 24-gon prism
    const c = body('c');
    expect(c.mass).toBeCloseTo(0.5 * 24 * 0.25 * Math.sin((2 * Math.PI) / 24) * 2, 9);
    expect(c.z).toBeCloseTo(1, 9);
    // a cone's centre is a quarter of the way up
    expect(body('d').z).toBeCloseTo(0.75, 9);
    expect(valueText(f.value('a'))).toMatch(/^body at \(1, 1, 2\), 0 m\/s/);
  });

  it('a polyhedron with dents is refused (B003), alone or in a list', () => {
    ok('L = Prism(Polygon((0, 0, 0), (2, 0, 0), (2, 1, 0), (1, 1, 0), (1, 2, 0), (0, 2, 0)), 1)');
    const e = fail('d = Body(L)');
    expect(e.kind).toBe('not_convex_3d');
    expect(e.hint).toMatch(/Weld/);
    ok(`K = ${CUBE(5, 5, 0)}`);
    ok('ss = [K, L]');
    expect(fail('ds = Bodies(ss)').kind).toBe('not_convex_3d');
  });

  it('a list of solids gives a list of bodies in space', () => {
    all(['g = Ground()', 'balls = Bodies(Seq(Sphere((2 k, 0, 1 + k), 0.5), k, 0, 3))']);
    expect(f.get('balls')?.typeText).toBe('List<Body3>');
    play(2);
    for (const b of f.value('balls') as physics.Body3Value[]) expect(b.z).toBeCloseTo(0.5, 2);
  });
});

describe('the step in space (R5.2, design 7 and 11.5)', () => {
  it('free flight is exact: z = z0 + v t - g t² / 2 at every step', () => {
    all(['b = Body(Sphere((0, 0, 10), 0.5), speed = (1, 2, 3))']);
    for (const t of [0.25, 0.5, 1, 1.5]) {
      play(t);
      const v = body('b');
      expect(v.x).toBeCloseTo(t, 12);
      expect(v.y).toBeCloseTo(2 * t, 12);
      expect(v.z).toBeCloseTo(10 + 3 * t - 4.9 * t * t, 12);
    }
  });

  it('energy in free flight with a spin stays the same', () => {
    all([`b = Body(${CUBE(0, 0, 20)}, spin = (2, 1, 3))`]);
    play(0.1);
    const e0 = body('b').energy;
    play(1.5);
    expect(Math.abs(body('b').energy - e0) / Math.abs(e0)).toBeLessThan(0.002);
  });

  it('a stack of four boxes stands and falls asleep', () => {
    all(['g = Ground()', ...[0, 1, 2, 3].map((k) => `b${k} = Body(${CUBE(0, 0, k * 1.01)}, mass = 1)`)]);
    play(4);
    for (const k of [0, 1, 2, 3]) {
      const v = body(`b${k}`);
      expect(v.x).toBeCloseTo(0.5, 2);
      expect(v.y).toBeCloseTo(0.5, 2);
      expect(v.z).toBeCloseTo(0.5 + k, 1);
      expect(v.asleep).toBe(true);
    }
  });

  it('thrown dice land flat on a face and settle', () => {
    all(['g = Ground()', 'd1 = Body(Cube((-2, 0, 3), (-1, 0, 3.4), (-2, 1, 3)), spin = (3, 2, 1), speed = (1.5, 0, 0))', 'd2 = Body(Cube((0, 1, 4), (0.8, 1.6, 4.2), (0, 2, 4)), spin = (-2, 4, 0))']);
    play(6);
    for (const [n, s] of [['d1', Math.hypot(1, 0.4)], ['d2', Math.hypot(0.8, 0.6, 0.2)]] as const) {
      const v = body(n);
      expect(v.asleep).toBe(true);
      expect(v.z).toBeCloseTo(s / 2, 2);
      // one face is flat on the floor: its lowest corners share a height
      const zs = (v.now as unknown as { verts: { z: number }[] }).verts.map((p) => p.z).sort((a, b) => a - b);
      expect(zs[3] as number).toBeCloseTo(zs[0] as number, 2);
    }
  });

  it('dominoes fall in a row after a push', () => {
    all(['g = Ground()', 'row = Bodies(Seq(Prism(Polygon((1.2 k, 0, 0), (1.2 k + 0.25, 0, 0), (1.2 k + 0.25, 1, 0), (1.2 k, 1, 0)), 2), k, 0, 5), friction = 0.5)', 'Push(row[1], (0.6, 0, 0), (0.1, 0.5, 1.9))']);
    play(6);
    for (const d of f.value('row') as physics.Body3Value[]) expect(d.z).toBeLessThan(0.5);
  });

  it('Ground(h) is the floor z = h, and a solid tilted plane makes a ball roll down it', () => {
    all(['g = Ground(1)', 'b = Body(Sphere((0, 0, 3), 0.5))']);
    play(2);
    expect(body('b').z).toBeCloseTo(1.5, 2);
    const g = new Figure({ commands: REG });
    all(['p = Plane((0, 0, 0), Vector(0.3, 0, 1))', 'p with solid = true', 'b = Body(Sphere((0, 0, 2), 0.5), friction = 0.5)'], g);
    play(2, g);
    const v = body('b', g);
    expect(v.x).toBeGreaterThan(1);
    // it rolls: its spin is about y, as fast as its speed over its radius
    expect(Math.abs(v.spin.y)).toBeCloseTo(Math.hypot(v.v.x, v.v.z) / 0.5, 0);
  });

  it('a solid z = f(x, y) is terrain over the clip box (B106), and balls roll to the bottom of a bowl', () => {
    ok('bowl(x, y) = 0.08 (x^2 + y^2)');
    const r = f.apply('bowl with solid = true');
    expect(r.ok).toBe(true);
    ok('b = Body(Sphere((3, 2, 3), 0.4), friction = 0.6)');
    let lowest = Infinity;
    for (let k = 1; k <= 12 * 60; k++) {
      f.setClock(k / 60);
      const v = body('b');
      const r = Math.hypot(v.x, v.y);
      // it rolls about in the bowl, never further out than it fell in, and always on the surface once it lands
      expect(r).toBeLessThan(3.8);
      if (k > 120) expect(Math.abs(v.z - 0.08 * r * r - 0.4)).toBeLessThan(0.08);
      lowest = Math.min(lowest, r);
    }
    expect(lowest).toBeLessThan(1);
    expect(body('b').touching).toEqual(['bowl']);
  });

  it('readouts: the floor pushes up with m g at rest, and touching names it', () => {
    all(['g = Ground()', `b = Body(${CUBE(0, 0, 0)}, mass = 3)`, 'n = b.force("normal")', 'w = b.force("gravity")', 'who = b.touching', 'm = b.momentum']);
    play(1.5);
    expect((f.value('n') as { z: number }).z).toBeCloseTo(3 * 9.8, 1);
    expect((f.value('w') as { z: number }).z).toBeCloseTo(-3 * 9.8, 9);
    expect(f.value('who')).toEqual(['g']);
    expect((f.value('m') as { z: number }).z).toBeCloseTo(0, 6);
  });

  it('gravity in three numbers turns the world; two numbers keep their down along z', () => {
    all(['world = World(gravity = (2, 0, -9.8))', 'b = Body(Sphere((0, 0, 10), 0.5))']);
    play(1);
    expect(body('b').x).toBeCloseTo(1, 9);
    const g = new Figure({ commands: REG });
    all(['world = World(gravity = (0, -5))', 'b = Body(Sphere((0, 0, 10), 0.5))'], g);
    play(1, g);
    expect(body('b', g).z).toBeCloseTo(10 - 2.5, 9);
    expect(body('b', g).y).toBe(0);
  });
});

describe('the film in space (design 10)', () => {
  const DICE = ['g = Ground()', 'd1 = Body(Cube((-2, 0, 3), (-1, 0, 3.4), (-2, 1, 3)), spin = (3, 2, 1), speed = (1.5, 0, 0))', 'd2 = Body(Sphere((1, 0, 2), 0.5), speed = (-1, 0, 0))'];

  it('a seek gives the same film as playing, to the last bit', () => {
    all(DICE);
    play(3);
    const played = JSON.stringify([body('d1'), body('d2')].map((b) => [b.x, b.y, b.z, b.q]));
    const g = new Figure({ commands: REG });
    all(DICE, g);
    g.setClock(3);
    expect(JSON.stringify([body('d1', g), body('d2', g)].map((b) => [b.x, b.y, b.z, b.q]))).toBe(played);
    // and back again: from a checkpoint
    g.setClock(1.2);
    const back = JSON.stringify(body('d1', g));
    f.setClock(1.2);
    expect(JSON.stringify(body('d1'))).toBe(back);
  });

  it('a push is logged as an @input line, and the reloaded script plays the same film', () => {
    all(['g = Ground()', `b = Body(${CUBE(0, 0, 0)})`]);
    play(1);
    ok('Push(b, (0, 3, 0))');
    play(3);
    const text = f.toScript();
    expect(text).toMatch(/@input physics push b 0 3 0 at 1/);
    expect(body('b').y).toBeGreaterThan(1);
    const { figure: g } = Figure.fromScript(text, { commands: REG });
    g.setClock(3);
    expect(body('b', g).y).toBe(body('b').y);
  });

  it('a push at a point off the centre also turns the body', () => {
    all([`b = Body(${CUBE(0, 0, 10)})`, 'world = World(gravity = (0, 0, 0))']);
    ok('Push(b, (0, 1, 0), (1, 0.5, 10.5))');
    play(0.5);
    expect(Math.abs(body('b').spin.z)).toBeGreaterThan(0.5);
  });

  it('a drag at the start moves where the body starts; later it grabs and pulls the body (logged)', () => {
    all(['g = Ground()', 'A = (0, 0, 0)', 'B = (1, 0, 0)', 'C = (0, 1, 0)', 'k = Cube(A, B, C)', 'b = Body(k)']);
    let r = physics.dragBody3(f, 'b', { x: 0.5, y: 0.5, z: 0.5 }, false);
    expect(r.ok).toBe(true);
    r = physics.dragBody3(f, 'b', { x: 2.5, y: 0.5, z: 0.5 }, true);
    expect(r.ok && r.did).toBe('moved start');
    expect((f.value('A') as { x: number }).x).toBeCloseTo(2, 9);
    play(1);
    for (let k = 0; k <= 30; k++) {
      physics.dragBody3(f, 'b', { x: 2.5, y: 0.5 + k * 0.05, z: 1.5 }, k === 30);
      f.setClock(1 + k / 60);
    }
    expect(f.toScript()).toMatch(/@input physics grab b .* at 1\b/);
    expect(f.toScript()).toMatch(/@input physics release b at /);
    expect(body('b').y).toBeGreaterThan(1);
  });

  it('on b hit runs once per new touch in space, with speed and other', () => {
    all(['g = Ground()', 'b = Body(Sphere((0, 0, 3), 0.25), bounce = 0.3)', 'n = 0', 'v = 0', 'who = "nothing"']);
    ok('on b hit: SetValue(n, n + 1)');
    ok('on b hit: SetValue(v, speed)');
    ok('on b hit: SetValue(who, other)');
    play(0.9);
    expect(f.value('n')).toBe(1);
    expect(f.value('v') as number).toBeGreaterThan(6);
    expect(f.value('who')).toBe('g');
  });

  it('a body that leaves the world becomes undefined (left_world, B103)', () => {
    all(['world = World(range = 10)', 'b = Body(Sphere((0, 0, 0), 0.5), speed = (0, 0, -20))']);
    play(1);
    expect(f.get('b')?.cell).toMatchObject({ defined: false, reason: 'left_world' });
  });

  it('a figure in the plane is not touched by the space driver, and the reverse', () => {
    const g = new Figure({ commands: REG });
    all(['g = Ground()', 'b = Body(Circle((0, 2), 0.5))'], g);
    play(1, g);
    expect(physicsOf(g).world).toBeDefined();
    expect(physics3Of(g).world).toBeUndefined();
    all(['g = Ground()', 'b = Body(Sphere((0, 0, 2), 0.5))']);
    play(1);
    expect(physicsOf(f).world).toBeUndefined();
    expect(physics3Of(f).world).toBeDefined();
  });
});

describe('speed in space (design 11.2)', () => {
  it('100 boxes falling into a pile take under 2 ms a step on average', { retry: 2 }, () => {
    const lines = ['g = Ground()'];
    for (let k = 0; k < 100; k++) lines.push(`b${k} = Body(${CUBE((k % 5) * 1.1, (Math.floor(k / 5) % 5) * 1.1, 1 + Math.floor(k / 25) * 1.2)})`);
    all(lines);
    const t0 = performance.now();
    play(2);
    const ms = (performance.now() - t0) / 240;
    expect(ms).toBeLessThan(2);
  });
});
