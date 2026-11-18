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
};

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
}

function physicsBench(name: string, warm: number, run: number): Timing {
  const lines = SCENES[name];
  if (lines === undefined) throw new Error(`unknown scene ${name}`);
  const figure = new Figure({ commands });
  for (const line of lines) {
    if (!figure.apply(line).ok) throw new Error(`scene ${name}: ${line}`);
  }
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
  return {
    mean: times.reduce((a, b) => a + b, 0) / times.length,
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? Number.NaN,
    worst: sorted[sorted.length - 1] ?? Number.NaN,
  };
}

/** Does a solver built now run the Rust loops? (A cloth's `kfn` is set when its arena was made.) */
function kernelsRunning(): boolean {
  const figure = new Figure({ commands });
  for (const line of SCENES.flag as string[]) figure.apply(line);
  figure.setClock(1 / 60);
  const cloth = (physics3Of(figure) as unknown as { cloth?: { kfn?: unknown } } | undefined)?.cloth;
  return cloth?.kfn !== undefined;
}

declare global {
  interface Window {
    physicsBench: typeof physicsBench;
    physicsKernels: { wanted: boolean; compiled: boolean; running: boolean };
  }
}
window.physicsBench = physicsBench;
window.physicsKernels = { wanted: kernelsWanted, compiled: kernelsReady, running: kernelsRunning() };
