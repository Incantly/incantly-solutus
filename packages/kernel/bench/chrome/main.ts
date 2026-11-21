/**
 * The cloth scenes of the Chrome bench (physics design 11.2). `chrome-physics.mjs` serves this page and calls
 * `window.physicsBench(name, warmSeconds, runSeconds)`: each frame is one `setClock` of 1/60 s, which is two steps of
 * 1/120 s. The time is the kernel's own, the page's main thread; in the product the worker runs it.
 */
import { CommandRegistry, Figure, geometry, initPhysicsKernels, registerAnimation, registerFunctions, registerLists, registerNumbers, registerPhysics, registerSpace, physics3Of, setPhysicsKernels } from '../../src/index';

// the page's main thread may not compile the WebAssembly module in one go (Chrome refuses over 4 KB), so it is compiled
// first, without blocking; `?kernels=off` runs the TypeScript loops instead
const kernelsWanted = new URLSearchParams(location.search).get('kernels') !== 'off';
setPhysicsKernels(kernelsWanted);
const kernelsReady = kernelsWanted ? await initPhysicsKernels() : false;

export const SCENES: Record<string, string[]> = {
  rope: ['rope = Cloth((0, 5), (8, 5), 400, mass = 0.5, pins = [(0, 5)])', 'ball = Body(Circle((8, 5), 0.2), mass = 1)', 'tie = Pin(rope, (8, 5), ball)'],
  sheet32: ['g = Ground()', 'ball = Sphere((0, 0, 1), 1)', 'ball with solid = true', 'sheet = Cloth((-1.6, -1.6, 2.6), (3.2, 0, 0), (0, 3.2, 0), 32, 32, mass = 0.4)'],
  flag: ['g = Ground()', 'flag = Cloth((0, 0, 4), (3, 0, 0), (0, 0, -2), 64, 32, mass = 0.5, pins = "left")', 'world with wind = (5 + 3 sin(2 t), 1, 0)'],
  over40: (() => {
    const l = ['g = Ground()', 'sheet = Cloth((-3, -1.5, 3), (6, 0, 0), (0, 3, 0), 64, 32, mass = 0.6)'];
    for (let k = 0; k < 40; k++) l.push(`b${k} = Body(Box((${-2.7 + (k % 10) * 0.6}, ${-1.2 + Math.floor(k / 10) * 0.8}, 0.25), 0.4, 0.4, 0.4), mass = 1)`);
    return l;
  })(),
  self: ['g = Ground()', 'sheet = Cloth((-2, -1, 3), (4, 0, 0), (0, 0, -2), 64, 32, mass = 0.5, self = true)', 'post = Box((0, 0, 0.5), 1, 1, 1)', 'post with solid = true'],
  two: ['g = Ground()', 'a = Cloth((0, 0, 4), (3, 0, 0), (0, 0, -2), 64, 32, pins = "left")', 'b = Cloth((0, 1, 4), (3, 0, 0), (0, 0, -2), 64, 32, pins = "left")', 'world with wind = (4 + 2 sin(3 t), 1, 0)'],
  wet: ['g = Ground()', 'sheet = Cloth((-3, -1.5, 2), (6, 0, 0), (0, 3, 0), 64, 32, mass = 0.6, pins = "corners")', 'water = Liquid(Box((0, 0, 3), 2, 2, 0.5), 2000)'],
  // smoke and fire in space (design 9.8, 11.2): the grid steps on the page's main thread here; the product runs it in the worker
  fire24: ['g = Ground()', 'blaze = Fire((0, 0, 0))'],
  fire32: ['g = Ground()', 'blaze = Fire(Box((0, 0, 1), 2, 2, 3), 32, source = Sphere((0, 0, 0.1), 0.3))'],
  flagfire: ['g = Ground()', 'blaze = Fire((0, 0, 0))', 'flag = Cloth((-1, -0.3, 2.4), (2, 0, 0), (0, 0, -1.2), 64, 32, mass = 0.4, pins = "top")'],
  // the bodies (design 11.2), as in `physics.bench.ts` (round 10)
  pile: ['g = Ground()', 'boxes = Bodies(Seq(Box((1.25 mod(k, 20) - 12, 1.5 + 1.25 floor(k / 20)), 1, 1), k, 0, 299))'],
  asleep: [
    'g = Ground()',
    'world with range = 400',
    'boxes = Bodies(Seq(Box((1.2 mod(k, 60) - 35, 0.5 + 1.1 floor(k / 60)), 1, 1), k, 0, 899))',
    'rain = Bodies(Seq(Circle((1.1 mod(k, 50) - 27, 300 + 1.1 floor(k / 50)), 0.3), k, 0, 99))',
  ],
  chain: [
    'world with sleep = false',
    'wall = Box((0, 46), 1, 1)',
    'wall with solid = true',
    'links = Bodies(Seq(Box((0, 44.9 - 0.2 (k - 1)), 0.08, 0.2), k, 1, 200), speed = (2, 0))',
    'top = Hinge(wall, links[1], (0, 45))',
    'joints = Seq(Hinge(links[k - 1], links[k], (0, 45 - 0.2 (k - 1))), k, 2, 200)',
  ],
  hills: [
    'world with range = 150',
    'hills(x) = 1.5 sin(0.12 x) + 0.8 sin(0.31 x)',
    'hills with solid = true',
    'chassis = Body(Box((0, 5), 3, 0.6), mass = 400)',
    'front = Wheel(chassis, (1.1, 4.2), 0.45)',
    'back = Wheel(chassis, (-1.1, 4.2), 0.45)',
    'car = Vehicle(chassis, [front, back], motor = 0.6)',
  ],
  boxes3: ['g = Ground()', 'world with sleep = false', 'boxes = Bodies(Seq(Box((1.3 mod(k, 10) - 6, 1.3 floor(k / 10) - 6, 2 + 1.2 mod(k, 3)), 1, 1, 1), k, 0, 99))'],
  // liquids, waves, smoke and fire in the plane
  liquid2: [
    'tank = Polyline((-8, 9), (-8, 0), (8, 0), (8, 9))',
    'tank with solid = true',
    'lift = 6 min(1, max(0, t - 0.5))',
    'gate = Segment((-3, lift), (-3, 7 + lift))',
    'gate with solid = true',
    'water = Liquid(Box((-5.5, 3.5), 5, 7), 2000)',
    'boat = Body(Box((4, 0.5), 1.6, 0.5), density = 0.5)',
    'ball = Body(Circle((-5, 8), 0.4), density = 3)',
  ],
  liquid3: [
    'g = Ground()',
    'w1 = Box((-1.6, 0, 0.9), 0.2, 3.4, 1.8)',
    'w2 = Box((1.6, 0, 0.9), 0.2, 3.4, 1.8)',
    'w3 = Box((0, -1.6, 0.9), 3.4, 0.2, 1.8)',
    'w4 = Box((0, 1.6, 0.9), 3.4, 0.2, 1.8)',
    'w1 with solid = true',
    'w2 with solid = true',
    'w3 with solid = true',
    'w4 with solid = true',
    'water = Liquid(Box((0, 0, 0.5), 3, 3, 1), 2000)',
    'ball = Body(Sphere((0.3, 0.2, 3), 0.4), density = 0.5)',
    'stone = Body(Box((-0.6, -0.5, 2.5), 0.5, 0.5, 0.5), density = 3)',
  ],
  waves: ['bed = Ground(-1.2)', 'pool = Box((0, 0, -0.6), 10, 10, 1.2)', 'sea = Waves(pool, 64)', 'boat = Body(Box((1.5, 0, 0.3), 2, 0.9, 0.5), density = 0.35)', 'rock = Body(Sphere((-1.2, 0.8, 3), 0.5), density = 2.5)'],
  smoke: [
    'world with wind = (3 + sin(2 t), 0)',
    'ball = Circle((0, 0), 0.7)',
    'ball with solid = true',
    'leaf = Body(Circle((2, 1.2), 0.2), mass = 0.02)',
    'sm = Smoke(Box((1, 0), 10, 6), 64, source = Box((-3.7, 0), 0.3, 2), heat = 1)',
    'm = sm.mass',
  ],
  fire2: [
    'g = Ground()',
    'ball = Circle((1.3, 1.5), 0.25)',
    'ball with solid = true',
    'fr = Fire(Box((0, 2), 4, 4), 64, source = Circle((0, 0.3), 0.3), heat = 1200, fuel = 2)',
    'wood1 = Body(Box((-0.6, 0.3), 0.8, 0.2), burns = 60, ignite = 150)',
    'wood2 = Body(Box((0.6, 0.3), 0.8, 0.2), burns = 60, ignite = 150)',
    'm = fr.fuel',
  ],
};

/** 300 boxes at rest and a ball: the "apply one line" row. */
const APPLY_SCENE = ['g = Ground()', 'boxes = Bodies(Seq(Box((1.2 mod(k, 30) - 18, 1 + 1.2 floor(k / 30)), 1, 0.6), k, 0, 299))', 'ball = Body(Circle((-22, 0.4), 0.3))'];

const commands = new CommandRegistry();
geometry.registerGeometry(commands);
registerNumbers(commands);
registerFunctions(commands);
registerAnimation(commands);
registerLists(commands);
registerSpace(commands);
registerPhysics(commands);

interface Timing {
  readonly mean: number;
  readonly p95: number;
  readonly worst: number;
  /** The mean of the slowest second of the frames. */
  readonly slowest: number;
}

function build(name: string, lines: readonly string[]): Figure {
  const figure = new Figure({ commands });
  for (const line of lines) {
    if (!figure.apply(line).ok) throw new Error(`scene ${name}: ${line}`);
  }
  return figure;
}

function scene(name: string): readonly string[] {
  const lines = SCENES[name];
  if (lines === undefined) throw new Error(`unknown scene ${name}`);
  return lines;
}

function physicsBench(name: string, warm: number, run: number): Timing {
  const figure = build(name, scene(name));
  const warmFrames = Math.round(warm * 60);
  const lastFrame = Math.round((warm + run) * 60);
  for (let k = 1; k <= warmFrames; k++) figure.setClock(k / 60);
  const times: number[] = [];
  for (let k = warmFrames + 1; k <= lastFrame; k++) {
    const t0 = performance.now();
    figure.setClock(k / 60);
    times.push(performance.now() - t0);
  }
  const sorted = [...times].sort((a, b) => a - b);
  let slowest = 0;
  for (let at = 0; at + 60 <= times.length; at += 60) slowest = Math.max(slowest, times.slice(at, at + 60).reduce((a, b) => a + b, 0) / 60);
  return {
    mean: times.reduce((a, b) => a + b, 0) / times.length,
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? Number.NaN,
    worst: sorted[sorted.length - 1] ?? Number.NaN,
    slowest,
  };
}

/** `ball with bounce = …` applied 50 times in a figure with 300 bodies at rest: the apply time, and the flush after it, ms. */
function physicsApply(): { median: number; p95: number; worst: number; flush: number } {
  const figure = build('apply', APPLY_SCENE);
  for (let k = 1; k <= 20 * 60; k++) figure.setClock(k / 60);
  const ms: number[] = [];
  const after: number[] = [];
  for (let k = 0; k < 50; k++) {
    const a = performance.now();
    if (!figure.apply(`ball with bounce = ${k % 2 === 0 ? 0.9 : 0.91}`).ok) throw new Error('apply');
    const b = performance.now();
    figure.flush();
    ms.push(b - a);
    after.push(performance.now() - b);
  }
  const s = [...ms].sort((x, y) => x - y);
  const z = [...after].sort((x, y) => x - y);
  return { median: s[25] ?? Number.NaN, p95: s[47] ?? Number.NaN, worst: s[49] ?? Number.NaN, flush: z[25] ?? Number.NaN };
}

/** 100 seeks over a warm film of `seconds` (a fixed order that jumps back and forth): the median, 95% and worst seek, ms. */
function physicsSeek(name: string, seconds: number): { median: number; p95: number; worst: number } {
  const figure = build(name, scene(name));
  for (let k = 1; k <= Math.round(seconds * 60); k++) figure.setClock(k / 60);
  const ms: number[] = [];
  for (let i = 0; i < 100; i++) {
    const t = ((i * 37) % 100) * (seconds / 100 - 0.01) + 0.3;
    const a = performance.now();
    figure.setClock(t);
    ms.push(performance.now() - a);
  }
  const s = ms.sort((x, y) => x - y);
  return { median: s[50] ?? Number.NaN, p95: s[95] ?? Number.NaN, worst: s[99] ?? Number.NaN };
}

/** `Restart()` at the end of a warm film: the first frame after it, ms, and the frames until no driver is behind (at most 60). */
function physicsRestart(name: string, seconds: number): { first: number; frames: number } {
  const figure = build(name, scene(name));
  for (let k = 1; k <= Math.round(seconds * 60); k++) figure.setClock(k / 60);
  if (!figure.apply('Restart()').ok) throw new Error('Restart');
  let first = Number.NaN;
  let frames = 60;
  for (let k = 1; k <= 60; k++) {
    const a = performance.now();
    figure.setClock(seconds + k / 60);
    if (k === 1) first = performance.now() - a;
    if (frames === 60 && !figure.driversNeedFrames()) frames = k;
  }
  return { first, frames };
}

/** Does a solver built now run the Rust loops? (A cloth's `kfn` is set when its arena was made.) */
function kernelsRunning(): boolean {
  const figure = new Figure({ commands });
  for (const line of SCENES.flag as string[]) figure.apply(line);
  figure.setClock(1 / 60);
  const cloth = (physics3Of(figure) as unknown as { cloth?: { kfn?: unknown } } | undefined)?.cloth;
  return cloth?.kfn !== undefined;
}

/** Does a grid in space built now run the Rust loops, and the build with SIMD? */
function gridRunning(): { running: boolean; simd: boolean } {
  const figure = new Figure({ commands });
  for (const line of SCENES.fire24 as string[]) figure.apply(line);
  figure.setClock(1 / 60);
  const grid = physics3Of(figure).smokeMembers[0]?.grid;
  return { running: grid?.usesKernels === true, simd: grid?.usesSimd === true };
}

declare global {
  interface Window {
    physicsBench: typeof physicsBench;
    physicsApply: typeof physicsApply;
    physicsSeek: typeof physicsSeek;
    physicsRestart: typeof physicsRestart;
    physicsKernels: { wanted: boolean; compiled: boolean; running: boolean; grid: boolean; gridSimd: boolean };
  }
}
window.physicsBench = physicsBench;
window.physicsApply = physicsApply;
window.physicsSeek = physicsSeek;
window.physicsRestart = physicsRestart;
const grid = gridRunning();
window.physicsKernels = { wanted: kernelsWanted, compiled: kernelsReady, running: kernelsRunning(), grid: grid.running, gridSimd: grid.simd };
