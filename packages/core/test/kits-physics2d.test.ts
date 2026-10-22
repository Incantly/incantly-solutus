import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { Body2D, Inc, Joint2D, Physics2DOptions, Tank2D, World2D } from '../src/api/types';
import { kit } from '../src/kits/physics2d';
import type { SceneCommand } from '../src/protocol/scene-commands';
import type { KitModule } from '../src/runtime/kits';
import { SceneRuntime, type RuntimeOptions } from '../src/runtime/runtime';
import { nodeOf } from '../src/scene/handles';
import { validateSceneJs } from '../src/validation/js';

function run(scene: (inc: Inc) => void, options: RuntimeOptions = {}) {
  const runtime = new SceneRuntime({ autoplay: false, kits: { physics2d: kit }, ...options });
  const mount = runtime.mount(scene);
  const first = runtime.tick(0);
  return { runtime, mount, commands: [...mount.commands, ...first.commands] };
}

/** Plays for `seconds` of scene time at `fps`, calling `each` after every frame. */
function play(runtime: SceneRuntime, seconds: number, fps = 60, each?: () => void): SceneCommand[] {
  runtime.play();
  const commands: SceneCommand[] = [];
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) {
    commands.push(...runtime.tick(1 / fps).commands);
    each?.();
  }
  return commands;
}

const world = (inc: Inc, options: Partial<Physics2DOptions> = {}) => inc.physics2d('#s', { title: 'World', ...options });

/** The error a scene fails with at mount. */
const mountError = (scene: (inc: Inc) => void) => run(scene).mount.ui.error?.message;

describe('inc.physics2d: motion (PH-1, PH-2, PH-8)', () => {
  it('falls as y = y0 - g t² / 2, in metres with y up', () => {
    let ball!: Body2D;
    let w!: World2D;
    const { runtime, mount } = run((inc) => {
      w = world(inc);
      ball = w.ball({ at: [2, 6], r: 0.1 });
    });
    expect(mount.ui.error).toBeNull();
    play(runtime, 0.5);
    const t = w.time;
    expect(t).toBeCloseTo(0.5, 6);
    expect(Math.abs(ball.y - (6 - 0.5 * 9.8 * t * t))).toBeLessThan(0.03);
    expect(ball.vy).toBeCloseTo(-9.8 * t, 6);
    expect(ball.x).toBe(2);
    expect(ball.mass).toBe(1);
  });

  it('bounces back to about bounce² of the drop height', () => {
    let ball!: Body2D;
    const { runtime } = run((inc) => {
      ball = world(inc).ball({ at: [2, 2.1], r: 0.1, bounce: 0.8 });
    });
    let bounced = false;
    let peak = -Infinity;
    play(runtime, 2, 60, () => {
      if (!bounced) bounced = ball.vy > 0;
      else peak = Math.max(peak, ball.y);
    });
    // The ball's bottom started 2 m up.
    const expected = 0.1 + 0.8 * 0.8 * 2;
    expect(Math.abs(peak - expected) / expected).toBeLessThan(0.05);
  });

  it('rests boxes on the floor and on each other without drifting or sinking', () => {
    const boxes: Body2D[] = [];
    const { runtime } = run((inc) => {
      const w = world(inc);
      for (let i = 0; i < 6; i++) boxes.push(w.box({ at: [3, 0.25 + i * 0.5], w: 0.5, h: 0.5 }));
    });
    play(runtime, 4);
    boxes.forEach((box, i) => {
      expect(Math.abs(box.x - 3)).toBeLessThan(0.005);
      expect(Math.abs(box.y - (0.25 + i * 0.5))).toBeLessThan(0.01);
      expect(Math.abs(box.angle)).toBeLessThan(0.1);
      expect(box.speed).toBeLessThan(0.01);
    });
  });

  it('slides down a ramp at g(sin θ − μ cos θ), and stays put when μ ≥ tan θ', () => {
    const slide = (mu: number) => {
      let box!: Body2D;
      let w!: World2D;
      const { runtime } = run((inc) => {
        w = world(inc);
        // A 30° slope falling to the right.
        w.ramp([0, 3], [3 * Math.sqrt(3), 0]);
        box = w.box({ at: [1.5 * Math.cos(Math.PI / 6) + 0.125, 3 - 0.75 + 0.2165], w: 0.5, h: 0.5, angle: -30, friction: mu });
      });
      const along = () => box.x * Math.cos(Math.PI / 6) - box.y * Math.sin(Math.PI / 6);
      const start = along();
      play(runtime, 0.1);
      const settled = along();
      const t0 = w.time;
      play(runtime, 0.8);
      return { speed: box.speed, expected: Math.max(0, 9.8 * (0.5 - mu * Math.cos(Math.PI / 6)) * w.time), moved: along() - settled, t: w.time - t0, start, settled };
    };
    const slippery = slide(0.2);
    expect(Math.abs(slippery.speed - slippery.expected) / slippery.expected).toBeLessThan(0.02);
    const grippy = slide(0.7);
    expect(grippy.speed).toBeLessThan(0.005);
    expect(Math.abs(grippy.moved)).toBeLessThan(0.005);
  });

  it('gives the same result whatever the frame rate', () => {
    const states = [30, 60, 144].map((fps) => {
      let ball!: Body2D;
      let w!: World2D;
      const { runtime } = run((inc) => {
        w = world(inc);
        ball = w.ball({ at: [2, 4], r: 0.2, velocity: [3, 2], bounce: 0.5 });
        w.box({ at: [4, 0.5], w: 1, h: 1 });
      });
      runtime.play();
      while (w.time < 1.5 - 1e-9) runtime.tick(1 / fps);
      return [w.time, ball.x, ball.y, ball.angle];
    });
    for (const state of states) for (let i = 0; i < 4; i++) expect(state[i]).toBeCloseTo(states[0]![i]!, 9);
  });

  it('pushes, takes fields and sets velocities', () => {
    let a!: Body2D;
    let b!: Body2D;
    let w!: World2D;
    const { runtime } = run((inc) => {
      w = world(inc, { gravity: 0 });
      a = w.ball({ at: [2, 4], r: 0.1, mass: 2 }).push(4, 0);
      b = w.ball({ at: [2, 6], r: 0.1, mass: 1 });
      w.field((body) => (body === b ? [0, -1] : undefined));
    });
    play(runtime, 1);
    expect(a.vx).toBeCloseTo(2 * w.time, 6);
    expect(b.vy).toBeCloseTo(-1 * w.time, 6);
    expect(a.force('applied')).toEqual([4, 0]);
    b.velocity(1, 0);
    expect(b.vx).toBe(1);
  });
});

describe('joints (PH-3)', () => {
  it('springs oscillate with period 2π√(m/k) and keep their energy', () => {
    let ball!: Body2D;
    let w!: World2D;
    const { runtime } = run((inc) => {
      w = world(inc, { gravity: 0 });
      ball = w.ball({ at: [3, 4], r: 0.1, mass: 1 });
      w.spring([1, 4], ball, { length: 1.5, stiffness: 40, damping: 0 });
    });
    const e0 = w.energy();
    expect(e0.elastic).toBeCloseTo(0.5 * 40 * 0.5 * 0.5, 6);
    const maxima: number[] = [];
    let last = 0;
    play(runtime, 3.1, 120, () => {
      if (last > 0 && ball.vx <= 0) maxima.push(w.time);
      last = ball.vx;
    });
    const period = (maxima.at(-1)! - maxima[0]!) / (maxima.length - 1);
    expect(Math.abs(period - 2 * Math.PI * Math.sqrt(1 / 40))).toBeLessThan(0.01);
    expect(Math.abs(w.energy().total - e0.total) / e0.total).toBeLessThan(0.03);
  });

  it('keeps a very stiff spring stable', () => {
    let ball!: Body2D;
    const { runtime } = run((inc) => {
      const w = world(inc);
      ball = w.ball({ at: [3, 3], r: 0.05, mass: 0.05 });
      w.spring([3, 5], ball, { length: 1, stiffness: 1e6, damping: 10 });
    });
    play(runtime, 2);
    expect(Number.isFinite(ball.y)).toBe(true);
    expect(Math.abs(ball.y - 4)).toBeLessThan(0.01);
  });

  it('swings a pendulum on a rod with period 2π√(L/g), and a hinged bar like a physical pendulum', () => {
    const L = 2;
    const t0 = (5 * Math.PI) / 180;
    let bob!: Body2D;
    let w!: World2D;
    const { runtime } = run((inc) => {
      w = world(inc);
      bob = w.ball({ at: [3 + L * Math.sin(t0), 6 - L * Math.cos(t0)], r: 0.05 });
      w.rod([3, 6], bob);
    });
    const crossings: number[] = [];
    let last = bob.x - 3;
    play(runtime, 6, 120, () => {
      if (last > 0 && bob.x - 3 <= 0) crossings.push(w.time);
      last = bob.x - 3;
    });
    const expected = 2 * Math.PI * Math.sqrt(L / 9.8) * (1 + (t0 * t0) / 16);
    expect(Math.abs(crossings[1]! - crossings[0]! - expected)).toBeLessThan(0.02);

    let bar!: Body2D;
    const physical = run((inc) => {
      w = world(inc);
      bar = w.box({ at: [3, 5], w: 0.1, h: 2, angle: 5 });
      w.hinge(bar, [3 - Math.sin(t0), 5 + Math.cos(t0)]);
    });
    const maxima: number[] = [];
    let previous = bar.angle;
    let rising = false;
    play(physical.runtime, 6, 120, () => {
      if (rising && bar.angle < previous) maxima.push(w.time);
      rising = bar.angle > previous;
      previous = bar.angle;
    });
    // I about the pivot = m(L² + w²)/12 + m(L/2)², with the centre 1 m below it.
    const I = (4 + 0.01) / 12 + 1;
    expect(Math.abs(maxima[1]! - maxima[0]! - 2 * Math.PI * Math.sqrt(I / 9.8))).toBeLessThan(0.02);
  });

  it('runs an Atwood machine at (m1 − m2)g/(m1 + m2) with tension 2m1m2g/(m1 + m2)', () => {
    let a!: Body2D;
    let b!: Body2D;
    let rope!: Joint2D;
    let w!: World2D;
    const { runtime } = run((inc) => {
      w = world(inc);
      a = w.box({ at: [2, 3], w: 0.4, h: 0.4, mass: 3 });
      b = w.box({ at: [4, 3], w: 0.4, h: 0.4, mass: 1 });
      rope = w.pulley(a, b, [3, 6], { r: 1 });
    });
    play(runtime, 0.5);
    expect(a.vy).toBeCloseTo(-4.9 * w.time, 3);
    expect(b.vy).toBeCloseTo(4.9 * w.time, 3);
    expect(rope.tension).toBeCloseTo(14.7, 2);
    expect(a.force('tension')[1]).toBeCloseTo(14.7, 2);
  });

  it('lets a rope go slack, then hold the weight when taut', () => {
    let ball!: Body2D;
    let rope!: Joint2D;
    const { runtime } = run((inc) => {
      const w = world(inc);
      ball = w.ball({ at: [3, 5], r: 0.1, mass: 2 });
      rope = w.rope([3, 6], ball, { length: 2 });
    });
    expect(rope.tension).toBe(0);
    play(runtime, 4);
    expect(rope.length).toBeCloseTo(2, 2);
    expect(rope.tension).toBeCloseTo(19.6, 1);
    rope.setLength(1.5);
    play(runtime, 2);
    expect(rope.length).toBeCloseTo(1.5, 2);
    // Hidden, the rope no longer holds.
    rope.hide();
    play(runtime, 0.2);
    expect(ball.vy).toBeLessThan(-1);
  });

  it('turns a hinge motor at its speed', () => {
    let wheel!: Body2D;
    const { runtime } = run((inc) => {
      const w = world(inc, { gravity: 0 });
      wheel = w.box({ at: [3, 4], w: 1, h: 0.2 });
      w.hinge(wheel, [3, 4], { motor: 90 });
    });
    play(runtime, 1);
    expect(wheel.angle).toBeCloseTo(90, 0);
    expect(wheel.x).toBeCloseTo(3, 3);
  });
});

describe('liquids (PH-5)', () => {
  it('floats light bodies, sinks dense ones, and raises the level by what they displace', () => {
    let floater!: Body2D;
    let sinker!: Body2D;
    let tank!: Tank2D;
    const { runtime } = run((inc) => {
      const w = world(inc);
      tank = w.tank({ x: 1, w: 4, depth: 2 });
      floater = w.box({ at: [2, 2], w: 1, h: 1, density: 500 });
      sinker = w.box({ at: [4, 1.5], w: 1, h: 1, density: 2000 });
    });
    play(runtime, 6);
    expect(tank.level).toBeCloseTo(2 + (0.5 + 1) / 4, 3);
    expect(tank.displaced).toBeCloseTo(1.5, 3);
    expect(tank.buoyancy(floater) / (1000 * 9.8)).toBeCloseTo(0.5, 2);
    // Half under: its centre sits at the surface.
    expect(floater.y).toBeCloseTo(tank.level, 2);
    expect(sinker.y).toBeCloseTo(0.5, 2);
    expect(sinker.force('buoyancy')[1]).toBeCloseTo(9800, 0);
    expect(sinker.force('normal')[1]).toBeCloseTo(9800, 0);
  });

  it('draws the liquid in the water tone, which the theme gives a light and a dark value (6.9a)', async () => {
    const { runtime } = run((inc) => void world(inc).tank({ x: 1, w: 4, depth: 2 }));
    expect([...runtime.graph.nodes.values()].some((n) => n.tone === 'water')).toBe(true);
    expect(validateSceneJs("const s = inc.svg('#s', { viewBox: [0, 0, 10, 10], title: 'T' });\ns.rect(0, 0, 4, 4, { tone: 'water', fill: true });").diagnostics).toEqual([]);
    const { THEME_CSS } = await import('../src/renderer/theme');
    expect(THEME_CSS.match(/--inc-water: #[0-9a-f]{6};/g)?.length).toBeGreaterThanOrEqual(3);
    expect(THEME_CSS).toContain('.inc-stage .inc-tone-water { --inc-tone: var(--inc-water); }');
  });
});

describe('charges and magnets (PH-4)', () => {
  it('pushes like charges apart by Coulomb’s law', () => {
    let p!: Body2D;
    let q!: Body2D;
    const { runtime } = run((inc) => {
      const w = world(inc, { gravity: 0 });
      p = w.ball({ at: [3, 4], r: 0.05, mass: 0.1, charge: 10 });
      q = w.ball({ at: [3.5, 4], r: 0.05, mass: 0.1, charge: 10 });
    });
    const f = (8.99e9 * 10e-6 * 10e-6) / 0.25;
    expect(q.force('electric')[0]).toBeCloseTo(f, 6);
    expect(p.force('electric')[0]).toBeCloseTo(-f, 6);
    play(runtime, 0.2);
    expect(p.x).toBeLessThan(3);
    expect(q.x).toBeGreaterThan(3.5);
  });

  it('pulls unlike poles together and pushes like poles apart', () => {
    const gap = (flip: number) => {
      let m1!: Body2D;
      let m2!: Body2D;
      const { runtime } = run((inc) => {
        const w = world(inc, { gravity: 0 });
        m1 = w.box({ at: [3, 4], w: 0.6, h: 0.2, magnet: 2 });
        m2 = w.box({ at: [4, 4], w: 0.6, h: 0.2, magnet: 2, angle: flip });
      });
      const pull = m2.force('magnetic')[0];
      play(runtime, 0.3);
      return { pull, gap: m2.x - m1.x };
    };
    const facing = gap(0);
    expect(facing.pull).toBeLessThan(0);
    expect(facing.gap).toBeLessThan(1);
    const opposed = gap(180);
    expect(opposed.pull).toBeGreaterThan(0);
    expect(opposed.gap).toBeGreaterThan(1);
  });
});

describe('force arrows (PH-6)', () => {
  it('draws the forces the simulation applied, labelled with their size', () => {
    let box!: Body2D;
    const { runtime, commands } = run((inc) => {
      const w = world(inc);
      box = w.box({ at: [3, 0.5], w: 1, h: 1, mass: 2 });
      w.forces(box, { components: true });
    });
    // Before playing, only the forces that do not come from contacts are known.
    const texts = (list: SceneCommand[]) => list.filter((c): c is Extract<SceneCommand, { op: 'text' }> => c.op === 'text').map((c) => c.value);
    expect(texts(commands)).toContain('gravity 19.6 N');
    const later = play(runtime, 1);
    expect(texts(later)).toContain('normal 19.6 N');
    expect(box.force('gravity')).toEqual([0, -19.6]);
    expect(box.force('normal')[1]).toBeCloseTo(19.6, 3);
    const [nx, ny] = box.force('net');
    expect(Math.hypot(nx, ny)).toBeLessThan(0.01);
  });
});

describe('events, restarts and the learner’s hand (PH-7)', () => {
  it('reports hits with their speed, and bodies entering sensors', () => {
    const hits: number[] = [];
    const touched: string[] = [];
    let ball!: Body2D;
    const { runtime } = run((inc) => {
      const w = world(inc);
      ball = w.ball({ at: [3, 3], r: 0.2 });
      const zone = w.box({ at: [3, 1.5], w: 2, h: 0.5, fixed: true, sensor: true });
      w.onTouch(zone, (b) => touched.push(b === ball ? 'ball' : 'other'));
      w.onHit((_a, b, speed) => {
        if (b === ball) hits.push(speed);
      });
    });
    play(runtime, 2);
    expect(touched).toEqual(['ball']);
    expect(Math.abs(hits[0]! - Math.sqrt(2 * 9.8 * 2.8)) / Math.sqrt(2 * 9.8 * 2.8)).toBeLessThan(0.03);
  });

  it('starts again when a parameter changes, reading live values again', () => {
    let ball!: Body2D;
    let w!: World2D;
    const { runtime } = run((inc) => {
      const h = inc.param('h', { min: 1, max: 6, value: 3 });
      w = world(inc);
      ball = w.ball({ at: () => [2, h.value], r: 0.1 });
    });
    play(runtime, 0.5);
    expect(ball.y).toBeLessThan(2);
    runtime.setParam('h', 5);
    runtime.tick(0);
    expect(w.time).toBe(0);
    expect(ball.y).toBe(5);
    w.restart();
    expect(ball.y).toBe(5);
  });

  it('keeps going through parameter changes when restart is off', () => {
    let ball!: Body2D;
    let w!: World2D;
    const { runtime } = run((inc) => {
      const g = inc.param('g', { min: 1, max: 20, step: 0.1, value: 9.8 });
      w = world(inc, { restart: false, gravity: () => g.value });
      ball = w.ball({ at: [2, 6], r: 0.1 });
    });
    play(runtime, 0.25);
    runtime.setParam('g', 1.6);
    const before = ball.vy;
    play(runtime, 0.25);
    expect(w.time).toBeCloseTo(0.5, 6);
    expect(ball.vy - before).toBeCloseTo(-1.6 * 0.25, 2);
  });

  it('lets the learner drag a body: directly while paused, through a grip while playing', () => {
    let ball!: Body2D;
    const { runtime } = run((inc) => {
      ball = world(inc).ball({ at: [2, 2], r: 0.3, draggable: true });
    });
    const id = nodeOf(ball.handle).id;
    // Stage units: 50 per metre, y down from the top of a 400-unit stage.
    runtime.drag(id, 'start', 100, 300);
    runtime.drag(id, 'move', 200, 200);
    runtime.tick(0);
    expect([ball.x, ball.y]).toEqual([4, 4]);
    runtime.drag(id, 'end', 200, 200);
    play(runtime, 0.3);
    expect(ball.y).toBeLessThan(4);
    runtime.drag(id, 'start', ball.x * 50, 400 - ball.y * 50);
    for (let i = 0; i < 60; i++) {
      runtime.drag(id, 'move', 400, 150);
      runtime.tick(1 / 60);
    }
    expect(ball.x).toBeCloseTo(8, 1);
    expect(ball.y).toBeCloseTo(5, 1);
    runtime.drag(id, 'end', 400, 150);
  });

  it('sums kinetic, gravitational and elastic energy', () => {
    let w!: World2D;
    run((inc) => {
      w = world(inc);
      w.ball({ at: [2, 3], r: 0.1, mass: 2, velocity: [3, 0] });
    });
    const e = w.energy();
    expect(e.kinetic).toBeCloseTo(9, 9);
    expect(e.potential).toBeCloseTo(2 * 9.8 * 3, 9);
    expect(e.elastic).toBe(0);
    expect(e.total).toBeCloseTo(9 + 58.8, 9);
  });
});

describe('drawing and checking', () => {
  it('draws every kind of body, joint and liquid with finite geometry', () => {
    const { runtime, mount } = run((inc) => {
      const w = world(inc, { walls: true });
      const ball = w.ball({ at: [2, 6], r: 0.3, label: 'ball', tone: 'a' });
      const box = w.box({ at: [5, 6], w: 0.6, h: 0.4 });
      const tri = w.polygon({ at: [8, 6], points: [[0, 0], [1, 0], [0, 1]] });
      w.ramp([0, 2], [3, 0]);
      w.spring([2, 7.5], ball);
      w.rope([5, 7.5], box);
      w.rod([8, 7.5], tri);
      w.hinge(w.box({ at: [10, 5], w: 1, h: 0.1 }), [10, 5], { motor: 30 });
      w.pulley(w.ball({ at: [6, 3], r: 0.2 }), w.ball({ at: [7, 3], r: 0.2 }), [6.5, 5]);
      w.tank({ x: 3.5, w: 2, depth: 1 });
      w.forces(ball);
    });
    expect(mount.ui.error).toBeNull();
    play(runtime, 2);
    expect(runtime.graph.diagnostics).toEqual([]);
    expect(runtime.errors).toEqual([]);
  });

  it('runs from its sandbox script, on the Worker’s shared modules', async () => {
    const { KIT_SCRIPT } = await import('../src/sandbox/generated/kits/physics2d');
    const { SHARED_MODULES } = await import('../src/sandbox/kit-shared');
    // The script registers itself the way it does in the Worker, reading the runtime's modules.
    const context = createContext({ __incShared: SHARED_MODULES });
    runInContext(KIT_SCRIPT, context);
    const registered = (context as { __incKits?: Record<string, KitModule> }).__incKits?.physics2d;
    expect(registered?.name).toBe('physics2d');
    let ball!: Body2D;
    const runtime = new SceneRuntime({ autoplay: false, kits: { physics2d: registered! } });
    const update = runtime.mount((inc) => {
      const w = world(inc);
      ball = w.ball({ at: [2, 3], r: 0.2, draggable: true });
      // Handles the script made are the runtime's own: parts and errors work across the boundary.
      w.stage.part('ball', ball.handle, { info: 'It falls.' });
    });
    expect(update.ui.error).toBeNull();
    expect(update.ui.parts?.map((p) => p.name)).toEqual(['ball']);
    play(runtime, 0.5);
    expect(ball.y).toBeLessThan(3);
    const bad = new SceneRuntime({ autoplay: false, kits: { physics2d: registered! } }).mount((inc) => void world(inc).ball({ at: [1, 1], r: 0 }));
    expect(bad.ui.error?.message).toBe('world.ball: r must be a radius above 0 metres, got 0');
  });

  it('passes the validator as a generated scene would write it', () => {
    const source = `
const h = inc.param('h', { min: 1, max: 6, value: 3, label: 'Drop height', unit: 'm' });
const world = inc.physics2d('#stage', { title: 'Dropping a ball', walls: ['floor', 'left', 'right'] });
const ball = world.ball({ at: () => [3, h.value], r: 0.2, bounce: 0.7, draggable: true, label: 'ball' });
const crate = world.box({ at: [6, 0.5], w: 1, h: 1, mass: 4, friction: 0.5 });
world.ramp([7, 0], [11, 2]);
const spring = world.spring([9, 7], crate, { stiffness: 80 });
const tank = world.tank({ x: 1, w: 1.5, depth: 0.8 });
world.forces(ball, { show: ['gravity', 'normal', 'net'] });
world.onHit((a, b, speed) => {
  if (speed > 1) inc.state.set('hits', (inc.state.get('hits') || 0) + 1);
});
world.field((body) => [0.1 * body.vy, 0]);
inc.readout({ Speed: () => ball.speed.toFixed(1) + ' m/s', Level: () => tank.level.toFixed(2) + ' m', Energy: () => world.energy().total.toFixed(0) + ' J', Pull: () => spring.tension.toFixed(1) + ' N' });
inc.describe(() => 'A ball at ' + ball.y.toFixed(1) + ' m and a crate on a spring.');
inc.idea('A dropped ball turns height into speed, and each bounce gives some of it back.');
`;
    const { diagnostics, info } = validateSceneJs(source);
    expect(diagnostics.map((d) => d.message)).toEqual([]);
    expect(info.kits).toEqual(['physics2d']);
  });

  it('refuses bad options with plain messages', () => {
    expect(mountError((inc) => void world(inc).ball({ at: [1, 1] } as never))).toBe('world.ball needs r: its radius in metres');
    expect(mountError((inc) => void world(inc).ball({ at: [1, 1], r: -1 }))).toBe('world.ball: r must be a radius above 0 metres, got -1');
    expect(mountError((inc) => void world(inc).box({ at: [1, 1], w: 0, h: 1 }))).toBe('world.box: w must be a width above 0 metres, got 0');
    expect(mountError((inc) => void world(inc).ball({ r: 1 } as never))).toBe('world.ball needs at: its centre [x, y] in metres');
    expect(mountError((inc) => void world(inc).polygon({ at: [3, 3], points: [[0, 0], [2, 0], [1, 0.2], [2, 2], [0, 2]] }))).toContain('must be convex');
    expect(mountError((inc) => void world(inc).ball({ at: [1, 1], r: 0.1, bounce: 2 }))).toBe('world.ball: bounce must be from 0 to 1, got 2');
    expect(mountError((inc) => void world(inc).ball({ at: [1, 1], r: 0.1, tone: 'pink' as never }))).toBe('world.ball: unknown tone "pink"');
    expect(mountError((inc) => void world(inc, { walls: ['roof'] as never }))).toContain('walls must be true, false or a list');
    expect(
      mountError((inc) => {
        const w = world(inc);
        const b = w.ball({ at: [1, 1], r: 0.1 });
        w.spring(b, b);
      }),
    ).toBe('world.spring needs two different ends');
    expect(
      mountError((inc) => {
        const w = world(inc);
        w.onTouch(w.ball({ at: [1, 1], r: 0.1 }), () => undefined);
      }),
    ).toBe('world.onTouch needs a body made with sensor: true');
    expect(
      mountError((inc) => {
        const w = world(inc);
        w.ball({ at: [1, 1], r: 0.1 }).force('lift' as never);
      }),
    ).toContain('force needs a kind of force');
    expect(
      mountError((inc) => {
        const w = world(inc);
        for (let i = 0; i < 61; i++) w.ball({ at: [1 + (i % 10), 1 + Math.floor(i / 10)], r: 0.1 });
      }),
    ).toBe('A world holds at most 60 bodies');
  });

  it('warns when sizes or positions look like stage units instead of metres', () => {
    const { runtime } = run((inc) => {
      world(inc).ball({ at: [300, 200], r: 20 });
    });
    const messages = runtime.graph.diagnostics.map((d) => d.message);
    expect(messages.some((m) => m.includes('outside the 12.0 m by 8.0 m world'))).toBe(true);
    expect(messages.some((m) => m.includes('bigger than the stage'))).toBe(true);
  });
});
