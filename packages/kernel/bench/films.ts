/**
 * The films of the "same result" checks (physics design 10.2, 11.4): the node check (`physics-checks.bench.ts`) and the
 * browser check (`cross-browser.mjs` and its page) play the same lines and hash the same world, so a difference between
 * two computers is a difference in the engine's numbers and nothing else.
 */
import { physics3Of, physicsOf } from '../src/index';
import type { Figure } from '../src/index';

export interface Film {
  /** What it is, in the table. */
  readonly title: string;
  readonly lines: readonly string[];
  /** Whether the figure's world is the one in space. */
  readonly space: boolean;
}

/** A 2D pile of 300 boxes dropped at once on the ground. */
const PILE = ['g = Ground()', 'boxes = Bodies(Seq(Box((1.25 mod(k, 20) - 12, 1.5 + 1.25 floor(k / 20)), 1, 1), k, 0, 299))'];

/** A tower of eight boxes in space that leans, and a hinge pendulum beside it. */
const TOWER3 = [
  'g = Ground()',
  'tower = Bodies(Seq(Box((0.03 k, 0.02 k, 0.5 + 1.02 k), 1, 1, 1), k, 0, 7))',
  'post = Sphere((4, 0, 3), 0.05)',
  'post with solid = true',
  'ball = Body(Sphere((4 + 2 sin(0.5), 0, 3 - 2 cos(0.5)), 0.2), mass = 1)',
  'pin = Hinge(post, ball, (4, 0, 3), Vector(0, 1, 0))',
];

/** A 2D liquid: the dam with a gate that opens, a boat and a ball (2,000 drops). */
const DAM = [
  'tank = Polyline((-8, 9), (-8, 0), (8, 0), (8, 9))',
  'tank with solid = true',
  'lift = 6 min(1, max(0, t - 0.5))',
  'gate = Segment((-3, lift), (-3, 7 + lift))',
  'gate with solid = true',
  'water = Liquid(Box((-5.5, 3.5), 5, 7), 2000)',
  'boat = Body(Box((4, 0.5), 1.6, 0.5), density = 0.5)',
  'ball = Body(Circle((-5, 8), 0.4), density = 3)',
];

/** A 64 × 32 flag in gusts. */
const FLAG = ['g = Ground()', 'flag = Cloth((0, 0, 4), (3, 0, 0), (0, 0, -2), 64, 32, mass = 0.5, pins = "left")', 'world with wind = (5 + 3 sin(2 t), 1, 0)'];

/** A net pinned at its corners that a heavy ball tears. */
const NET = ['g = Ground()', 'net = Cloth((-2, -2, 3), (4, 0, 0), (0, 4, 0), 32, 32, mass = 1, pins = "corners", tears = 1.5)', 'rock = Body(Sphere((0.2, 0.1, 5), 0.5), mass = 20)'];

/** Fire in space, 24 cells a side, with a crate that burns on it. */
const FIRE_SPACE = ['g = Ground()', 'blaze = Fire((0, 0, 0))', 'crate = Body(Box((0.4, 0, 0.3), 0.6, 0.6, 0.6), mass = 1, burns = 20, ignite = 150)'];

/** Smoke in the plane, blown past a ball with a light body in it. */
const SMOKE = [
  'world with wind = (3 + sin(2 t), 0)',
  'ball = Circle((0, 0), 0.7)',
  'ball with solid = true',
  'leaf = Body(Circle((2, 1.2), 0.2), mass = 0.02)',
  'sm = Smoke(Box((1, 0), 10, 6), 64, source = Box((-3.7, 0), 0.3, 2), heat = 1)',
];

export const FILMS: readonly Film[] = [
  { title: '2D pile of 300 boxes', lines: PILE, space: false },
  { title: '3D tower and hinge pendulum', lines: TOWER3, space: true },
  { title: '2D liquid, 2,000 drops', lines: DAM, space: false },
  { title: '64 × 32 flag in gusts', lines: FLAG, space: true },
  { title: 'net that tears', lines: NET, space: true },
  { title: 'fire in space 24³ with a burning crate', lines: FIRE_SPACE, space: true },
  { title: 'smoke in the plane with a body', lines: SMOKE, space: false },
];

/** Hash of every bit of a number array (two 32-bit FNV-1a chains, so a lost bit is not lost to a collision). */
export function hashBits(a: Float64Array): string {
  const u = new Uint32Array(a.buffer, a.byteOffset, a.length * 2);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < u.length; i++) {
    const w = u[i] as number;
    h1 = Math.imul(h1 ^ w, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (w >>> 7) ^ (w << 11), 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/** The hash of the world a figure holds now: everything a step reads (a checkpoint, design 10.3). */
export function hashWorld(f: Figure, space: boolean): string {
  const d = (space ? physics3Of(f) : physicsOf(f)) as unknown as { saveState(): Float64Array };
  return hashBits(d.saveState());
}
