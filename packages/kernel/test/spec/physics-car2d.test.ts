/** The car in the plane and dragging bodies (.kiro/specs/physics R4.3, R6 in 2D; docs/features/physics design 8, ui.md 4). */
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

const all = (lines: readonly string[]): void => {
  for (const l of lines) {
    const r = f.apply(l);
    if (!r.ok) throw new Error(`${l}: ${(r as { message: string }).message}`);
  }
};
const run = (t: number): void => {
  const now = f.clock().t;
  const frames = Math.round((t - now) * 60);
  for (let k = 1; k <= frames; k++) f.setClock(now + k / 60);
};
const body = (name: string): physics.BodyValue => f.value(name) as physics.BodyValue;

const CAR = [
  'g = Ground()',
  'gas = 1 in -1..1',
  'brake = 0 in 0..1',
  'chassis = Body(Box((0, 1.4), 3, 0.6), mass = 400)',
  'front = Wheel(chassis, (1.1, 0.6), 0.45)',
  'back = Wheel(chassis, (-1.1, 0.6), 0.45)',
  'car = Vehicle(chassis, [front, back], motor = gas, brake = brake)',
];

describe('a car in the plane (design 8)', () => {
  it('rests on its wheels, drives forward with the gas, and reads its speed', () => {
    all(CAR);
    run(4);
    const c = body('chassis');
    expect(c.x).toBeGreaterThan(5);
    expect(c.y).toBeGreaterThan(0.8);
    expect(Math.abs(c.angle)).toBeLessThan(0.3);
    expect((f.value('car') as physics.VehicleValue).speedometer).toBeGreaterThan(2);
    const w = f.value('front') as physics.WheelValue;
    expect(w.spin).toBeLessThan(-2);
    expect(Math.hypot(w.x - c.x, w.y - c.y)).toBeLessThan(2.5);
  });

  it('the pedal goes on from now while the film plays; the brake stops it', () => {
    all(CAR);
    run(3);
    const x3 = body('chassis').x;
    f.setFree('brake', 1, 'api');
    f.flush();
    run(6);
    const v = Math.abs(body('chassis').vx);
    expect(v).toBeLessThan(0.5);
    // the film before the brake is the same
    f.setClock(3);
    expect(body('chassis').x).toBeCloseTo(x3, 6);
    expect(f.toScript()).toMatch(/@input physics set brake 1 at 3/);
  });

  it('a wheel with breaks comes off in a hard hit', () => {
    all(['g = Ground()', 'wall = Box((12, 2), 1, 4)', 'wall with solid = true', 'chassis = Body(Box((0, 1.4), 3, 0.6), mass = 400)', 'front = Wheel(chassis, (1.1, 0.6), 0.45, breaks = 3000)', 'back = Wheel(chassis, (-1.1, 0.6), 0.45)', 'car = Vehicle(chassis, [front, back], motor = 1, power = 60000)']);
    run(6);
    expect((f.value('front') as physics.WheelValue).broken).toBe(true);
    expect(f.takeWarnings().some((w) => w.kind === 'broken')).toBe(true);
  });
});

describe('dragging a body (ui.md 4)', () => {
  it('at the start of the film a drag moves where the body starts', () => {
    all(['g = Ground()', 'p = Box((0, 3), 1, 1)', 'b = Body(p)']);
    expect(physics.dragBody(f, 'b', 0, 3, false).ok).toBe(true);
    expect(physics.dragBody(f, 'b', 2, 4, true).ok).toBe(true);
    expect(f.get('p')?.definition).toBe('p = Box((2, 4), 1, 1)');
    expect(body('b').x).toBeCloseTo(2, 6);
    // a shape written inside the body's own line moves there, and its other arguments stay
    all(['c = Body(Circle((5, 2), 0.5), speed = (1, 0))']);
    physics.dragBody(f, 'c', 5, 2, false);
    physics.dragBody(f, 'c', 6, 3, true);
    expect(f.get('c')?.definition).toBe('c = Body(Circle((6, 3), 0.5), speed = (1, 0))');
  });

  it('later in the film a drag grabs the body, and the replay shows the same grab', () => {
    all(['g = Ground()', 'b = Body(Box((0, 0.5), 1, 1))']);
    run(1);
    physics.dragBody(f, 'b', 0, 0.5, false);
    for (let k = 1; k <= 30; k++) {
      physics.dragBody(f, 'b', 0, 0.5 + k * 0.1, false);
      f.setClock(1 + k / 60);
    }
    physics.dragBody(f, 'b', 0, 3.5, true);
    const y = body('b').y;
    expect(y).toBeGreaterThan(1.5);
    const text = f.toScript();
    expect(text).toMatch(/@input physics grab b/);
    expect(text).toMatch(/@input physics release b/);
    const { figure: g } = Figure.fromScript(text, { commands: REG });
    g.setClock(f.clock().t);
    expect((g.value('b') as physics.BodyValue).y).toBe(y);
  });
});
