/**
 * Cloth, finish (.kiro/specs/physics tasks 9.8; docs/features/physics/design.md 9.5 "A body's tether" and the round 9 finish
 * notes, 10.4 seeking, 11.5 "Rope pendulum", "Heavy ball, wide swing").
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, geometry, physics, registerAnimation, registerFunctions, registerLists, registerNumbers, registerPhysics, registerSpace } from '../../src/index';

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

const all = (lines: readonly string[], fig: Figure = f): void => {
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
const cloth = (name: string, fig: Figure = f): physics.ClothValue => {
  const v = fig.value(name);
  if (!physics.isClothValue(v)) throw new Error(`${name} is not a cloth now`);
  return v;
};
const ball2 = (fig: Figure = f): physics.BodyValue => fig.value('ball') as physics.BodyValue;
const ball3 = (fig: Figure = f): physics.Body3Value => fig.value('ball') as physics.Body3Value;
/** The length of a rope: the sum of the distances between neighbouring points. */
const ropeLength = (v: physics.ClothValue): number => {
  let len = 0;
  for (let i = 0; i + 1 < v.xs.length; i++) len += Math.hypot((v.xs[i + 1] as number) - (v.xs[i] as number), (v.ys[i + 1] as number) - (v.ys[i] as number));
  return len;
};

const HEAVY = ['rope = Cloth((0, 5), (2, 5), 50, mass = 0.01, pins = [(0, 5)])', 'ball = Body(Circle((2, 5), 0.1), mass = 1)', 'tie = Pin(rope, (2, 5), ball)'];

describe('Heavy ball, wide swing (design 11.5)', () => {
  it('a 1 kg ball pinned to the end of a 2 m rope of 0.01 kg and 50 points, let go with the rope level, for 3 s, sampled every 0.1 s: the rope within 2% of its length, the ball within 2% of 2 m from the pin, never higher than where it started', () => {
    all(HEAVY);
    const startY = ball2().y;
    expect(startY).toBeCloseTo(5, 9);
    let worstRope = 0;
    let worstReach = 0;
    let highest = -Infinity;
    for (let k = 1; k <= 30; k++) {
      f.setClock(k / 10);
      worstRope = Math.max(worstRope, Math.abs(ropeLength(cloth('rope')) / 2 - 1));
      const b = ball2();
      worstReach = Math.max(worstReach, Math.abs(Math.hypot(b.x, b.y - 5) / 2 - 1));
      highest = Math.max(highest, b.y);
      expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
    }
    expect(worstRope).toBeLessThan(0.02);
    expect(worstReach).toBeLessThan(0.02);
    // "never higher than where it started": a millimetre for the rounding of the film
    expect(highest - startY).toBeLessThan(1e-3);
  });
});

describe('A body\'s tether (design 9.5)', () => {
  const BALLS = [0.1, 1, 10];
  const ROPES = [0.01, 0.2];

  for (const rm of ROPES) {
    for (const bm of BALLS) {
      it(`in the plane: a ${bm} kg ball on the end of a 2 m rope of ${rm} kg, let go level, never gets further than 2 m × 1.02 from the world pin in 3 s`, () => {
        all([`rope = Cloth((0, 5), (2, 5), 30, mass = ${rm}, pins = [(0, 5)])`, `ball = Body(Circle((2, 5), 0.1), mass = ${bm})`, 'tie = Pin(rope, (2, 5), ball)']);
        let far = 0;
        for (let k = 1; k <= 180; k++) {
          f.setClock(k / 60);
          const b = ball2();
          far = Math.max(far, Math.hypot(b.x, b.y - 5));
        }
        expect(far).toBeLessThan(2 * 1.02);
      });

      it(`in space: a ${bm} kg ball on the free edge of a sheet of ${rm} kg held along its left edge never gets further than the start distance × 1.02 from any world pin in 3 s`, () => {
        // the sheet hangs in the x–z plane: left edge (x = 0) from z = 3 down to z = 1, ball tied at its top right corner
        all([`sheet = Cloth((0, 0, 3), (3, 0, 0), (0, 0, -2), 12, 8, mass = ${rm}, pins = "left")`, `ball = Body(Sphere((3, 0, 3), 0.1), mass = ${bm})`, 'tie = Pin(sheet, (3, 0, 3), ball)']);
        const pins: [number, number, number][] = [];
        for (let j = 0; j < 8; j++) pins.push([0, 0, 3 - (2 * j) / 7]);
        const reach = pins.map((p) => Math.hypot(3 - p[0], 0 - p[1], 3 - p[2]));
        const over = pins.map(() => 0);
        for (let k = 1; k <= 180; k++) {
          f.setClock(k / 60);
          const b = ball3();
          pins.forEach((p, i) => {
            over[i] = Math.max(over[i] as number, Math.hypot(b.x - p[0], b.y - p[1], b.z - p[2]) / (reach[i] as number));
          });
        }
        for (const o of over) expect(o).toBeLessThan(1.02);
      });
    }
  }
});

describe('A ball pinned under a sheet held by its corners (design 9.5, "Bodies held by pins take the small steps")', () => {
  /**
   * Plays 10 s, a 3 × 3 m sheet of 32 × 32 points held by its corners at z = 1, a 2 kg ball of radius r resting on Ground()
   * under its middle and pinned to it at (0, 0, 1). Returns how far the ball's centre went below its resting height r,
   * or NaN if the ball was lost.
   */
  const sink = (sheet: string, r: number): number => {
    all(['g = Ground()', sheet, `ball = Body(Sphere((0, 0, ${r}), ${r}), mass = 2)`, 'tie = Pin(sheet, (0, 0, 1), ball)']);
    let lowest = Infinity;
    for (let k = 1; k <= 600; k++) {
      f.setClock(k / 60);
      const b = f.value('ball') as physics.Body3Value | undefined;
      if (b === undefined || !Number.isFinite(b.z)) return Number.NaN;
      lowest = Math.min(lowest, b.z);
    }
    return r - lowest;
  };
  const SHEET = (extra: string): string => `sheet = Cloth((-1.5, -1.5, 1), (3, 0, 0), (0, 3, 0), 32, 32, mass = 1${extra}, pins = "corners")`;

  it('a ball of radius 0.3 pinned 0.7 m under a 32 × 32 sheet of 1 kg (stretch 0.9) held by its corners, resting on Ground(), for 10 s: sinks under 1 cm into the ground', () => {
    expect(sink(SHEET(', stretch = 0.9'), 0.3)).toBeLessThan(0.01);
  });

  it('the same with the default stretch of 1', () => {
    expect(sink(SHEET(''), 0.3)).toBeLessThan(0.01);
  });

  it('the same with a ball of radius 0.5 pinned at its top, the sheet resting on it (stretch 0.9): sinks under 1 cm into the ground', () => {
    expect(sink(SHEET(', stretch = 0.9'), 0.5)).toBeLessThan(0.01);
  });

  it('the same with a ball of radius 0.5 pinned at its top, the sheet resting on it (default stretch of 1): sinks under 1 cm into the ground', () => {
    expect(sink(SHEET(''), 0.5)).toBeLessThan(0.01);
  });
});

describe('Regressions of the review of 9.8 (findings PH-2 and PH-3)', () => {
  /**
   * Plays 10 s a 3 × 3 m sheet of 28 × 28 points, 1.2 kg, held by its corners at z = 0.8, over a 3 kg ball of radius
   * 0.4 resting on Ground() and pinned to the sheet at the ball's top. Returns the ball's lowest and highest centre.
   */
  const play = (extra: string): { low: number; high: number; defined: boolean } => {
    all(['g = Ground()', `sheet = Cloth((-1.5, -1.5, 0.8), (3, 0, 0), (0, 3, 0), 28, 28, mass = 1.2${extra}, pins = "corners")`, 'ball = Body(Sphere((0, 0, 0.4), 0.4), mass = 3)', 'tie = Pin(sheet, (0, 0, 0.8), ball)']);
    let low = Infinity;
    let high = -Infinity;
    for (let k = 1; k <= 600; k++) {
      f.setClock(k / 60);
      const b = f.value('ball') as physics.Body3Value | undefined;
      if (b === undefined || !Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.z)) return { low, high, defined: false };
      low = Math.min(low, b.z);
      high = Math.max(high, b.z);
    }
    return { low, high, defined: true };
  };

  it('PH-2: a ball of radius 0.4 pinned at its top under a flat sheet (stretch 0.9) resting on Ground() never goes more than 1 cm into the ground in 10 s, and stays defined', () => {
    const r = play(', stretch = 0.9');
    expect(r.defined).toBe(true);
    expect(0.4 - r.low).toBeLessThan(0.01);
  });

  it('PH-2 (plane, guards the 2D path): a ball of radius 0.5 pinned at its top under a rope held at both ends, on Ground(), never goes more than 1 cm into the ground', () => {
    all(['g = Ground()', 'rope = Cloth((-1, 1), (1, 1), 20, mass = 0.2, pins = [(-1, 1), (1, 1)])', 'ball = Body(Circle((0, 0.5), 0.5), mass = 1.5)', 'tie = Pin(rope, (0, 1), ball)']);
    let low = Infinity;
    for (let k = 1; k <= 600; k++) {
      f.setClock(k / 60);
      const b = ball2();
      expect(b !== undefined && Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
      low = Math.min(low, b.y);
    }
    expect(0.5 - low).toBeLessThan(0.01);
  });

  it('PH-2: seek equals play with the ball kept out of the ground: the ball and the world hash at 4 s are the same played and sought from 0', () => {
    const SCENE = ['g = Ground()', 'sheet = Cloth((-1.5, -1.5, 0.8), (3, 0, 0), (0, 3, 0), 28, 28, mass = 1.2, stretch = 0.9, pins = "corners")', 'ball = Body(Sphere((0, 0, 0.4), 0.4), mass = 3)', 'tie = Pin(sheet, (0, 0, 0.8), ball)'];
    all(SCENE);
    for (let k = 1; k <= 240; k++) f.setClock(k / 60);
    const want = ball3();
    const hash = physics.physicsOf(f).worldHash();
    const g = make(SCENE);
    g.setClock(4);
    expect(ball3(g).z).toBe(want.z);
    expect(ball3(g).x).toBe(want.x);
    expect(physics.physicsOf(g).worldHash()).toBe(hash);
  });

  it('PH-3: the same ball and sheet with the default stretch of 1 (the sheet flat and taut, every point at its tether): the ball stays defined, under 1 cm into the ground and under 2 cm above its start for 10 s', () => {
    const r = play('');
    expect(r.defined).toBe(true);
    expect(0.4 - r.low).toBeLessThan(0.01);
    expect(r.high - 0.4).toBeLessThan(0.02);
  });
});

describe('Seek equals play with the tether active (design 10.2, 10.4)', () => {
  it('the ball\'s x and y after playing to 3 s equal those after seeking to 3 s from 0, and after seeking back and forth', () => {
    all(HEAVY);
    for (let k = 1; k <= 180; k++) f.setClock(k / 60);
    const want = ball2();
    const hash = physics.physicsOf(f).worldHash();
    expect(Math.hypot(want.x, want.y - 5)).toBeGreaterThan(1); // the tether was in play: the ball swung out on its rope

    const g = make(HEAVY);
    g.setClock(3);
    expect(ball2(g).x).toBe(want.x);
    expect(ball2(g).y).toBe(want.y);
    expect(physics.physicsOf(g).worldHash()).toBe(hash);

    const h = make(HEAVY);
    h.setClock(1.7);
    h.setClock(0.4);
    h.setClock(3);
    h.setClock(1.1);
    h.setClock(3);
    expect(ball2(h).x).toBe(want.x);
    expect(ball2(h).y).toBe(want.y);
    expect(physics.physicsOf(h).worldHash()).toBe(hash);

    // and the played figure itself, sought back and forward
    f.setClock(0.9);
    f.setClock(3);
    expect(ball2().x).toBe(want.x);
    expect(ball2().y).toBe(want.y);
  });
});

describe('Rope pendulum (design 11.5)', () => {
  it('a 1 kg ball pinned to the end of a 2 m rope of 0.01 kg, swung 5°: period within 1% of 2π √(L / g)', () => {
    const a = (5 * Math.PI) / 180;
    const ex = 2 * Math.sin(a);
    const ey = 5 - 2 * Math.cos(a);
    all([`rope = Cloth((0, 5), (${ex}, ${ey}), 10, mass = 0.01, bend = 0, pins = [(0, 5)])`, `ball = Body(Circle((${ex}, ${ey}), 0.05), mass = 1)`, `tie = Pin(rope, (${ex}, ${ey}), ball)`]);
    let last = ball2().x;
    const cross: number[] = [];
    for (let k = 1; k <= 60 * 12; k++) {
      f.setClock(k / 60);
      const x = ball2().x;
      if (last > 0 && x <= 0) cross.push(k / 60 - (x / (x - last)) / 60);
      last = x;
    }
    expect(cross.length).toBeGreaterThan(2);
    const T = ((cross.at(-1) as number) - (cross[0] as number)) / (cross.length - 1);
    expect(Math.abs(T / (2 * Math.PI * Math.sqrt(2 / 9.8)) - 1)).toBeLessThan(0.01);
  });
});
