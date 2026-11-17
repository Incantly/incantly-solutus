/**
 * Cloth (.kiro/specs/physics R10, task 9; docs/features/physics/design.md 2.4, 9.5, 9.6, 10.3, 11.3, 11.4 "Cloth, …",
 * 11.5 "Hanging rope", "Rope pendulum", "Wet cloth"; errors.md B004, B010, B013, B017, B018, B019, `torn`).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ObjId } from '../../src/contracts/values';
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
const fail = (line: string, fig = f): { kind: string; code: string; message: string; hint?: string } => {
  const r = fig.apply(line);
  if (r.ok) throw new Error(`${line} was accepted`);
  return r as never;
};
const cloth = (name: string, fig = f): physics.ClothValue => {
  const v = fig.value(name);
  if (!physics.isClothValue(v)) throw new Error(`${name} is not a cloth now`);
  return v;
};
const idOf = (name: string, fig = f): ObjId => fig.get(name)?.id as ObjId;
/** Plays the film in frames of 1/60 s up to t. */
const play = (t: number, fig = f): void => {
  const now = fig.clock().t;
  const frames = Math.round((t - now) * 60);
  for (let k = 1; k <= frames; k++) fig.setClock(now + k / 60);
};

const FLAG = ['g = Ground()', 'flag = Cloth((0, 0, 3), (3, 0, 0), (0, 0, -2), 24, 16, mass = 0.4, pins = "left")', 'world with wind = (5 + 3 sin(2 t), 1, 0)'];
const ROPE = ['rope = Cloth((0, 5), (3, 5), 30, mass = 0.2, pins = [(0, 5)])', 'ball = Body(Circle((3, 5), 0.2), mass = 1)', 'tie = Pin(rope, (3, 5), ball)'];

describe('Cloth and Pin: forms, readouts, the row (design 2.4, ui.md 6)', () => {
  it('a sheet in space, a rope and a net in the plane, with their points and readouts before the film runs', () => {
    all(['flag = Cloth((0, 0, 3), (3, 0, 0), (0, 0, -2), 16, 8, pins = "left")', 'n = flag.count', 'p = flag.at(16, 8)', 'torn = flag.torn', 'm = flag.stretchMax']);
    expect(f.value('n')).toBe(128);
    expect(f.value('p')).toEqual({ x: 3, y: 0, z: 1 });
    expect(f.value('torn')).toBe(0);
    expect(f.value('m')).toBe(1);
    expect(f.get('flag')?.type).toBe('Cloth');
    expect(cloth('flag').spec.pins).toEqual([0, 16, 32, 48, 64, 80, 96, 112]);
    all(['rope = Cloth((0, 5), (4, 5), 40, pins = [(0, 5)])', 'q = rope.at(40, 1)', 'net = Cloth(Box((0, 2), 4, 2), 12, 6, pins = "top")']);
    expect(f.value('q')).toEqual({ x: 4, y: 5 });
    expect(cloth('rope').spec.kind).toBe('rope');
    expect(cloth('net').spec.pins).toEqual(Array.from({ length: 12 }, (_, i) => i));
    // the row: grid, pins, live line
    expect(physics.clothRow(cloth('flag'), 'flag').grid).toBe('16 by 8');
    expect(physics.clothRow(cloth('flag'), 'flag').live).toBe('most stretched 0%, 0 torn');
    expect(physics.clothRow(cloth('flag'), 'flag').spoken).toBe('Cloth flag, 16 by 8 points, pinned on the left, waving, 0 torn');
  });

  it('a pin holds the point nearest it, to the world or to a body', () => {
    all(ROPE);
    const p = f.value('tie') as physics.PinValue;
    expect(p.schema).toBe('Pin');
    expect(p.point).toBe(29);
    expect(p.body).toBeDefined();
  });

  it('refuses lines that can never work, with the codes of errors.md', () => {
    expect(fail('a = Cloth((0, 5), (4, 5), 40, stretch = 2)')).toMatchObject({ kind: 'bad_property_value' });
    expect(fail('a = Cloth((0, 5), (4, 5), 40, tears = 0.5)')).toMatchObject({ kind: 'bad_property_value' });
    expect(fail('a = Cloth((0, 5), (4, 5), 40, thickness = 1)')).toMatchObject({ kind: 'bad_property_value' });
    expect(fail('a = Cloth((0, 5), (4, 5), 40, mass = 0)')).toMatchObject({ kind: 'bad_property_value' });
    expect(fail('a = Cloth((0, 5), (4, 5), 40, pins = "bottom")')).toMatchObject({ kind: 'bad_property_value' });
    expect(fail('a = Cloth((0, 0, 3), (3, 0, 0), (0, 0, -2), 65, 8)')).toMatchObject({ kind: 'limit' });
    expect(fail('a = Cloth((0, 0, 3), (3, 0, 0), (0, 0, -2), 64, 33)')).toMatchObject({ kind: 'limit' });
    expect(fail('a = Cloth((0, 5), (4, 5), 401)')).toMatchObject({ kind: 'limit' });
    expect(fail('a = Cloth((0, 0, 3), (3, 0, 0), (0, 0, -2), 1, 8)')).toMatchObject({ kind: 'bad_argument' });
    expect(fail('a = Cloth((0, 5), (4, 5), 1)')).toMatchObject({ kind: 'bad_argument' });
    expect(fail('a = Cloth((0, 0, 3), (3, 0, 0), (6, 0, 0), 8, 8)')).toMatchObject({ kind: 'bad_argument' });
    all(['k = 3', 'b = Body(Circle((0, 0), 1), mass = 1)', 'rope = Cloth((0, 5), (4, 5), 40)']);
    const notCloth = fail('p = Pin(b, (0, 0))');
    expect(notCloth).toMatchObject({ kind: 'not_a_cloth', code: 'C137' });
    expect(notCloth.hint).toContain('Hinge(b, wall, (0, 0))');
    expect(fail('p = Pin(k, (0, 0))')).toMatchObject({ kind: 'not_a_cloth' });
    const off = fail('p = Pin(rope, (9, 9))');
    expect(off).toMatchObject({ kind: 'pin_off_cloth', code: 'C138' });
    expect(off.message).toContain('(4, 5)');
    // a cloth in space pinned to a body in the plane (B010)
    all(['sheet = Cloth((0, 0, 3), (3, 0, 0), (0, 0, -2), 8, 8)']);
    expect(fail('p = Pin(sheet, (0, 0, 3), b)')).toMatchObject({ kind: 'mixed_dimension' });
  });

  it('limits the figure: 4,096 cloth points, one cloth that hits itself, 64 pins (B013)', () => {
    all(['a = Cloth((0, 0, 3), (3, 0, 0), (0, 0, -2), 64, 32)', 'b = Cloth((0, 2, 3), (3, 0, 0), (0, 0, -2), 64, 32, self = true)']);
    expect(fail('c = Cloth((0, 5), (4, 5), 2)')).toMatchObject({ kind: 'limit' });
    const g = make(['a = Cloth((0, 0, 3), (3, 0, 0), (0, 0, -2), 8, 8, self = true)']);
    expect(fail('b = Cloth((0, 2, 3), (3, 0, 0), (0, 0, -2), 8, 8, self = true)', g)).toMatchObject({ kind: 'limit' });
    const pins = Array.from({ length: 65 }, (_, i) => `(${i / 10}, 5)`).join(', ');
    expect(fail(`r = Cloth((0, 5), (7, 5), 71, pins = [${pins}])`)).toMatchObject({ kind: 'limit' });
    const h = make([`r = Cloth((0, 5), (7, 5), 71, pins = [${Array.from({ length: 64 }, (_, i) => `(${i / 10}, 5)`).join(', ')}])`]);
    expect(fail('p = Pin(r, (7, 5))', h)).toMatchObject({ kind: 'limit' });
  });
});

describe('cloth in the film: seek, replay, reload (design 10.3, 10.4)', () => {
  it('a flag in gusts: seek equals play, and a fresh figure plays the same', () => {
    all(FLAG);
    play(2.5);
    const want = physics3Of(f).worldHash();
    const v = cloth('flag');
    expect(v.xs.reduce((a, b) => a + b, 0) / v.xs.length).toBeGreaterThan(0.5);
    f.setClock(0.7);
    f.setClock(2.5);
    expect(physics3Of(f).worldHash()).toBe(want);
    const g = make(FLAG);
    g.setClock(2.5);
    expect(physics3Of(g).worldHash()).toBe(want);
    // checkpoints every 0.25 s (28 steps at 1/120 s, a whole number of the drops' rounds), each about 6 numbers a point
    const d = physics3Of(f) as unknown as { cpStride: number; checkpointBytes(): number };
    expect(d.cpStride).toBeLessThanOrEqual(30);
    expect(d.checkpointBytes() / 1024).toBeLessThan(24 * 16 * 6 * 8 / 1024 + 8);
  });

  it('a grab while playing is logged with the point index; the saved script plays the same', () => {
    all(ROPE);
    play(0.5);
    expect(physics.dragCloth(f, 'rope', { x: 1.5, y: 4.5, z: 0 }, false)).toMatchObject({ ok: true, did: 'grabbed', point: 15 });
    play(0.8);
    physics.dragCloth(f, 'rope', { x: 2.5, y: 2.5, z: 0 }, false);
    play(1.1);
    physics.dragCloth(f, 'rope', { x: 2.5, y: 2.5, z: 0 }, true);
    play(2);
    const want = physicsOf(f).worldHash();
    const script = f.toScript();
    expect(script).toContain('@input physics grab rope 15');
    expect(script).toContain('@input physics release rope 15');
    const g = new Figure({ commands: REG });
    for (const l of script.split('\n')) if (l.trim()) g.apply(l);
    g.setClock(2);
    expect(physicsOf(g).worldHash()).toBe(want);
    f.setClock(0.3);
    f.setClock(2);
    expect(physicsOf(f).worldHash()).toBe(want);
  });

  it('a drag at the start moves where the cloth starts (ui.md 4)', () => {
    all(['rope = Cloth((0, 5), (4, 5), 20, pins = [(0, 5)])']);
    expect(physics.dragCloth(f, 'rope', { x: 1, y: 5, z: 0 }, false)).toMatchObject({ ok: true, did: 'moved start' });
    physics.dragCloth(f, 'rope', { x: 2, y: 4, z: 0 }, true);
    expect(f.get('rope')?.definition).toBe('rope = Cloth((1, 4), (5, 4), 20, pins = [(1, 4)])');
    all(['sheet = Cloth((0, 0, 3), (3, 0, 0), (0, 0, -2), 8, 8)']);
    physics.dragCloth(f, 'sheet', { x: 1, y: 1, z: 2 }, false);
    physics.dragCloth(f, 'sheet', { x: 2, y: 1, z: 2.5 }, true);
    expect(f.get('sheet')?.definition).toBe('sheet = Cloth((1, 0, 3.5), (3, 0, 0), (0, 0, -2), 8, 8)');
  });

  it('a net that tears: the same links tear at the same steps in two films, with the notice torn once', () => {
    const NET = ['g = Ground()', 'net = Cloth(Box((0, 3), 5, 1.2), 26, 7, mass = 0.3, tears = 1.5, pins = "top")', 'ball = Body(Circle((-3.4, 3.1), 0.4), mass = 6, speed = (9, 1))'];
    const a = make(NET);
    const b = make(NET);
    const at: number[] = [];
    let first = -1;
    for (let k = 1; k <= 120; k++) {
      a.setClock(k / 60);
      b.setClock(k / 60);
      const torn = cloth('net', a).torn;
      if (torn > 0 && first < 0) first = k;
      at.push(torn);
      expect(cloth('net', b).torn).toBe(torn);
    }
    expect(first).toBeGreaterThan(0);
    expect(Array.from(cloth('net', a).cut)).toEqual(Array.from(cloth('net', b).cut));
    const notes = a.takeWarnings().filter((n) => n.kind === 'torn');
    expect(notes.length).toBe(1);
    expect(physicsOf(a).events.some((e) => e.kind === 'torn')).toBe(true);
    // seek back over it and forward again: the same links, no second notice
    a.setClock(0.2);
    a.setClock(2);
    expect(Array.from(cloth('net', a).cut)).toEqual(Array.from(cloth('net', b).cut));
    expect(a.takeWarnings().filter((n) => n.kind === 'torn').length).toBe(0);
  });
});

describe('cloth meets bodies, solids and drops (design 9.6, 11.4)', () => {
  it('a sheet dropped on a ball, a box and terrain: no point ends inside a solid (Cloth, no pass-through)', () => {
    all(['g = Ground()', 'ball = Sphere((-1, 0, 0.6), 0.6)', 'ball with solid = true', 'box = Box((1, 0.4, 0.4), 0.8, 0.8, 0.8)', 'box with solid = true', 'sheet = Cloth((-2, -1.5, 2.4), (4, 0, 0), (0, 3, 0), 32, 24, mass = 0.3)']);
    play(3);
    const v = cloth('sheet');
    let inside = 0;
    for (let k = 0; k < v.xs.length; k++) {
      const x = v.xs[k] as number;
      const y = v.ys[k] as number;
      const z = v.zs[k] as number;
      if (z < 0 || Math.hypot(x + 1, y, z - 0.6) < 0.6 || (Math.abs(x - 1) < 0.4 && Math.abs(y - 0.4) < 0.4 && Math.abs(z - 0.4) < 0.4)) inside++;
    }
    expect(inside).toBe(0);
    expect(v.touching).toEqual(expect.arrayContaining(['ball', 'box']));
    const h = make(['hills(x, y) = 0.3 sin(x) * cos(y)', 'hills with solid = true', 'sheet = Cloth((-2, -2, 1.5), (4, 0, 0), (0, 4, 0), 24, 24, mass = 0.3)']);
    play(3, h);
    const w = cloth('sheet', h);
    for (let k = 0; k < w.xs.length; k++) expect(w.zs[k] as number).toBeGreaterThan(0.3 * Math.sin(w.xs[k] as number) * Math.cos(w.ys[k] as number) - 0.02);
  });

  it('a ball fired at a pinned sheet at 20 m/s never passes it (Cloth, no pass-through)', () => {
    all(['world with gravity = (0, 0, 0)', 'sheet = Cloth((-1, 0, 0.5), (2, 0, 0), (0, 0, 2), 20, 20, pins = "corners")', 'ball = Body(Sphere((0, -1, 1.5), 0.1), mass = 0.5, speed = (0, 20, 0))']);
    let most = -Infinity;
    for (let k = 1; k <= 60; k++) {
      f.setClock(k / 60);
      most = Math.max(most, (f.value('ball') as physics.Body3Value).y);
    }
    expect(most).toBeLessThan(0.1);
  });

  it('a ball resting on a sheet pinned at its four corners: the pins carry its weight and the sheet\'s within 1% (Cloth, two-way)', () => {
    all(['sheet = Cloth((-1, -1, 1), (2, 0, 0), (0, 2, 0), 24, 24, mass = 0.5, damping = 0.5, pins = "corners")', 'ball = Body(Sphere((0, 0, 1.33), 0.3), mass = 2)']);
    // the ball settles in about 9 s (the sheet rings, damped)
    play(10);
    let fz = 0;
    let n = 0;
    for (let k = 1; k <= 120; k++) {
      f.setClock(10 + k / 60);
      fz += physics3Of(f).pinForce(idOf('sheet'))?.z ?? Number.NaN;
      n++;
    }
    expect(Math.abs(-fz / n / (2.5 * 9.8) - 1)).toBeLessThan(0.01);
    expect(cloth('sheet').touching).toEqual(['ball']);
  });

  it('a rope pendulum: a 1 kg ball on a 2 m rope of 0.01 kg, swung 5°, swings with the period 2π √(L / g) within 1% (11.5)', () => {
    const a = (5 * Math.PI) / 180;
    const ex = 2 * Math.sin(a);
    const ey = 5 - 2 * Math.cos(a);
    all([`rope = Cloth((0, 5), (${ex}, ${ey}), 10, mass = 0.01, bend = 0, pins = [(0, 5)])`, `ball = Body(Circle((${ex}, ${ey}), 0.05), mass = 1)`, `tie = Pin(rope, (${ex}, ${ey}), ball)`]);
    let last = (f.value('ball') as physics.BodyValue).x;
    const cross: number[] = [];
    for (let k = 1; k <= 60 * 12; k++) {
      f.setClock(k / 60);
      const x = (f.value('ball') as physics.BodyValue).x;
      if (last > 0 && x <= 0) cross.push(k / 60 - (x / (x - last)) / 60);
      last = x;
    }
    const T = ((cross.at(-1) as number) - (cross[0] as number)) / (cross.length - 1);
    expect(Math.abs(T / (2 * Math.PI * Math.sqrt(2 / 9.8)) - 1)).toBeLessThan(0.01);
  });

  it('drops poured on a sheet held at its corners rest on it: none passes through (design 9.6)', () => {
    // a sheet held all round its edge (60 pins): a shallow bowl
    const edge: string[] = [];
    for (let k = 0; k < 16; k++) {
      const u = -1.5 + (3 * k) / 15;
      edge.push(`(${u}, -1.5, 2)`, `(${u}, 1.5, 2)`);
      if (k > 0 && k < 15) edge.push(`(-1.5, ${u}, 2)`, `(1.5, ${u}, 2)`);
    }
    all([`sheet = Cloth((-1.5, -1.5, 2), (3, 0, 0), (0, 3, 0), 16, 16, mass = 0.3, stretch = 0.9, damping = 1, pins = [${edge.join(', ')}])`, 'tap = Pour((0, 0, 2.6), 30, 0.5, max = 12)']);
    play(4);
    const water = f.value('tap') as physics.LiquidValue;
    const v = cloth('sheet');
    let low = Infinity;
    for (let k = 0; k < v.zs.length; k++) low = Math.min(low, v.zs[k] as number);
    expect(water.count).toBe(12);
    for (let k = 0; k < water.count; k++) expect(water.zs?.[k] as number).toBeGreaterThan(low);
  });

  // design 11.5 "Wet cloth" (1 kg of water held, the pins carrying it within 2%) is not met yet: a heavy load of drops
  // bounces off the sheet (the drops push the cloth one step late, as a change of speed), so most of it is thrown over
  // the rim. Left for round 10, with the drops' contact moved into the cloth's small steps.
  it.todo('a sheet that holds 1 kg of water: the pins carry its weight plus 9.8 N within 2% (11.5 "Wet cloth")');

});
