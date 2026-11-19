/**
 * The checks of physics design 11.4 that no other bench covers (round 10, task 10.3), against the Node column of
 * 11.2 (a quarter of the Chrome budget). Each row is a test that fails when the engine misses the number of the design.
 *
 * Run: `npx vitest run --config packages/kernel/bench/vitest.config.ts packages/kernel/bench/physics-checks.bench.ts`
 * (add `-t "calm stack"` to run one row). The rows that count collector runs need `--expose-gc`, which the config sets.
 *
 * Rows that are checked in another bench, and stay there: the cloth rows (worst frame, still flag, stretch, no
 * pass-through, two-way, water, energy, tearing, page cost, no worker, no garbage) in `physics.bench.ts` and the sdk
 * benches; "Liquid, no garbage" and the "Frame, no garbage" rows in `physics.bench.ts`; "Worker cost" in
 * `packages/sdk/bench/physics.bench.ts`; the browsers' half of "Same result" in `cross-browser.mjs`.
 */
import v8 from 'node:v8';
import { PerformanceObserver, performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import type { World2 } from '../src/physics/world2';
import type { World3 } from '../src/physics/world3';
import { CommandRegistry, Figure, geometry, physics, physics3Of, physicsOf, registerAnimation, registerFunctions, registerLists, registerNumbers, registerPhysics, registerSpace, setPhysicsKernels } from '../src/index';
import { FILMS, hashWorld } from './films';

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

function load(lines: readonly string[]): Figure {
  const f = new Figure({ commands: REG });
  for (const l of lines) {
    const r = f.apply(l);
    if (!r.ok) throw new Error(`${l}: ${(r as { message: string }).message}`);
  }
  return f;
}

const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);

/** A seeded generator (mulberry32): the same numbers on every run and every computer. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function collectNow(): void {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (!gc) throw new Error('these rows need Node started with --expose-gc: run them with packages/kernel/bench/vitest.config.ts');
  gc();
}
const heapUsed = (): number => v8.getHeapStatistics().used_heap_size;

const body = (f: Figure, name: string): physics.BodyValue => f.value(name) as physics.BodyValue;

/** A frame's time and whether a collector pause fell in it. */
interface Timed {
  readonly ms: number[];
  readonly paused: boolean[];
}

/** Plays frames `from` to `to` (1/60 s each) of a figure and times each; the collector's pauses are told apart. */
async function playTimed(f: Figure, from: number, to: number): Promise<Timed> {
  // the first frame builds the world (the "one line" row times that); the frames timed start after it
  if (from === 1) f.setClock(1 / 60);
  const gcs: { at: number; end: number }[] = [];
  const obs = new PerformanceObserver((l) => {
    for (const e of l.getEntries()) gcs.push({ at: e.startTime, end: e.startTime + e.duration });
  });
  collectNow();
  obs.observe({ entryTypes: ['gc'] });
  const spans: { at: number; end: number }[] = [];
  for (let k = from === 1 ? 2 : from; k <= to; k++) {
    const a = performance.now();
    f.setClock(k / 60);
    spans.push({ at: a, end: performance.now() });
  }
  await new Promise((r) => setTimeout(r, 20));
  obs.disconnect();
  return { ms: spans.map((x) => x.end - x.at), paused: spans.map((x) => gcs.some((g) => g.end >= x.at && g.at <= x.end)) };
}

function summary(t: Timed): { mean: number; p95: number; p99: number; worst: number; worstClear: number; paused: number; slowest: number } {
  const s = sorted(t.ms);
  const clear = t.ms.filter((_, i) => !t.paused[i]);
  let slowest = 0;
  for (let at = 0; at + 60 <= t.ms.length; at += 60) slowest = Math.max(slowest, t.ms.slice(at, at + 60).reduce((a, b) => a + b, 0) / 60);
  return {
    mean: t.ms.reduce((a, b) => a + b, 0) / t.ms.length,
    p95: s[Math.floor(s.length * 0.95)] as number,
    p99: s[Math.floor(s.length * 0.99)] as number,
    worst: s[s.length - 1] as number,
    worstClear: Math.max(...clear),
    paused: t.paused.filter(Boolean).length,
    slowest,
  };
}

const PILE = ['g = Ground()', 'boxes = Bodies(Seq(Box((1.25 mod(k, 20) - 12, 1.5 + 1.25 floor(k / 20)), 1, 1), k, 0, 299))'];
const BOXES3 = ['g = Ground()', 'world with sleep = false', 'boxes = Bodies(Seq(Box((1.3 mod(k, 10) - 6, 1.3 floor(k / 10) - 6, 2 + 1.2 mod(k, 3)), 1, 1, 1), k, 0, 99))'];

describe('speed checks (design 11.4)', () => {
  it('worst frame: the slowest frame of a 60 s film, 2D pile of 300 boxes and 3D boxes, within the budget of 11.2 (1.5 ms in Node) but for a collector pause', { retry: 2, timeout: 300_000 }, async () => {
    const a = summary(await playTimed(load(PILE), 1, 60 * 60));
    const b = summary(await playTimed(load(BOXES3), 1, 60 * 60));
    const line = (n: string, s: typeof a): string => `${n}: mean ${s.mean.toFixed(3)}, 95% ${s.p95.toFixed(3)}, 99% ${s.p99.toFixed(3)}, worst ${s.worst.toFixed(2)} ms, worst without a collector pause ${s.worstClear.toFixed(2)} ms (${s.paused} frames had one)`;
    console.log(`worst frame, 60 s: ${line('2D pile', a)}; ${line('3D boxes', b)}`);
    expect(a.worstClear).toBeLessThan(1.5);
    expect(b.worstClear).toBeLessThan(1.5);
  });

  it('pile-up: 300 boxes dropped at once on a floor, the slowest second under 1.5 ms a frame (Node; 6 ms in Chrome)', { retry: 2 }, async () => {
    const t = await playTimed(load(PILE), 1, 60 * 20);
    const s = summary(t);
    console.log(`pile-up, 300 boxes: slowest second ${s.slowest.toFixed(3)} ms a frame, mean ${s.mean.toFixed(3)} ms`);
    expect(s.slowest).toBeLessThan(1.5);
  });

  it('seek: 100 seeded random times in a 60 s film of 300 bodies, each under 25 ms (Node), with the pile asleep (asserted) and with sleeping off (reported)', { retry: 2, timeout: 300_000 }, () => {
    const rows: string[] = [];
    let worst = 0;
    for (const lines of [PILE, ['world with sleep = false', ...PILE]]) {
      const f = load(lines);
      for (let k = 1; k <= 60 * 60; k++) f.setClock(k / 60);
      const rnd = seeded(7);
      const ms: number[] = [];
      for (let i = 0; i < 100; i++) {
        const a = performance.now();
        f.setClock(rnd() * 60);
        ms.push(performance.now() - a);
      }
      const s = sorted(ms);
      rows.push(`${lines.length > PILE.length ? 'sleeping off' : 'asleep'}: median ${(s[50] as number).toFixed(1)}, 95% ${(s[95] as number).toFixed(1)}, worst ${(s[99] as number).toFixed(1)} ms`);
      if (lines === PILE) worst = s[99] as number;
    }
    console.log(`seek, 100 random times, 300 bodies: ${rows.join('; ')} (budget 25 ms)`);
    expect(worst).toBeLessThan(25);
  });

  it('wake storm: one ball hits a sleeping pile of 500, the worst frame under 1.5 ms (Node) but for a collector pause', { retry: 2, timeout: 300_000 }, async () => {
    const f = load(['g = Ground()', 'boxes = Bodies(Seq(Box((1.1 mod(k, 25) - 13.2, 0.5 + 1.0 floor(k / 25)), 1, 1), k, 0, 499))', 'ball = Body(Circle((0, 40), 1.5), mass = 400)']);
    for (let k = 1; k <= 90; k++) f.setClock(k / 60);
    const w = physicsOf(f).world as World2;
    // 500 boxes asleep, the ball still falling
    expect(w.awakeCount()).toBeLessThan(5);
    const t = await playTimed(f, 91, 60 * 8);
    const s = summary(t);
    const hit = t.ms.indexOf(Math.max(...t.ms.filter((_, i) => !t.paused[i])));
    console.log(`wake storm, 500 asleep and a ball: mean ${s.mean.toFixed(3)} ms, 99% ${s.p99.toFixed(3)} ms, worst ${s.worst.toFixed(2)} ms, worst without a collector pause ${s.worstClear.toFixed(2)} ms (frame ${hit + 91}), awake at the end ${w.awakeCount()}`);
    expect(s.worstClear).toBeLessThan(1.5);
  });

  it('one line: `ball with bounce = 0.9` in a figure with 300 bodies applies in under 1 ms (the flush after it is reported)', { retry: 2 }, () => {
    const f = load(['g = Ground()', 'boxes = Bodies(Seq(Box((1.2 mod(k, 30) - 18, 1 + 1.2 floor(k / 30)), 1, 0.6), k, 0, 299))', 'ball = Body(Circle((-22, 0.4), 0.3))']);
    for (let k = 1; k <= 20 * 60; k++) f.setClock(k / 60);
    const ms: number[] = [];
    const after: number[] = [];
    for (let k = 0; k < 50; k++) {
      const a = performance.now();
      const r = f.apply(`ball with bounce = ${k % 2 === 0 ? 0.9 : 0.91}`);
      const b = performance.now();
      f.flush();
      ms.push(b - a);
      after.push(performance.now() - b);
      expect(r.ok).toBe(true);
    }
    const s = sorted(ms);
    const z = sorted(after);
    console.log(`one line, 300 bodies: apply median ${(s[25] as number).toFixed(3)} ms, 95% ${(s[47] as number).toFixed(3)} ms; the flush after it (the world is built again and the film replayed to 20 s): median ${(z[25] as number).toFixed(1)} ms`);
    expect(s[47]).toBeLessThan(1);
  });
});

describe('stability checks (design 11.4)', () => {
  it('calm stack: a tower of 20 boxes for 60 s, the top box moves under 1 mm after it settles and no box falls, asleep and with sleeping off', { timeout: 300_000 }, () => {
    const rows: string[] = [];
    const drifts: number[] = [];
    const offs: number[] = [];
    for (const asleep of [true, false]) {
      const f = load([...(asleep ? [] : ['world with sleep = false']), 'g = Ground()', 'tower = Bodies(Seq(Box((0, 0.5 + k), 1, 1), k, 0, 19))']);
      const top = (): physics.BodyValue => (f.value('tower') as physics.BodyValue[])[19] as physics.BodyValue;
      let atFive = { x: 0, y: 0 };
      let drift = 0;
      for (let k = 1; k <= 60 * 60; k++) {
        f.setClock(k / 60);
        if (k === 5 * 60) atFive = { x: top().x, y: top().y };
        if (k > 5 * 60) drift = Math.max(drift, Math.hypot(top().x - atFive.x, top().y - atFive.y));
      }
      const all = f.value('tower') as physics.BodyValue[];
      let sag = 0;
      let side = 0;
      all.forEach((b, i) => {
        sag = Math.max(sag, 0.5 + i - b.y);
        side = Math.max(side, Math.abs(b.x));
      });
      rows.push(`${asleep ? 'asleep' : 'sleeping off'}: the top box moved ${(drift * 1000).toFixed(4)} mm after 5 s, the tower sagged ${(sag * 1000).toFixed(1)} mm in all (the top box ${((0.5 + 19 - top().y) * 1000).toFixed(1)} mm) and leaned ${(side * 1000).toFixed(3)} mm, top box asleep ${top().asleep}`);
      drifts.push(drift);
      offs.push(Math.max(sag, side));
    }
    console.log(`calm stack, 20 boxes, 60 s: ${rows.join('; ')}`);
    for (const d of drifts) expect(d).toBeLessThan(0.001);
    // none falls: every box stays within a quarter of a metre of where it was put
    for (const o of offs) expect(o).toBeLessThan(0.25);
  });

  it('pyramid: 210 boxes in a pyramid for 60 s stand, and all are asleep within 3 s', { timeout: 300_000 }, () => {
    // one list a row (a line is at most 2,000 characters)
    const home: { x: number; y: number }[][] = [];
    const lines = ['g = Ground()'];
    for (let r = 0; r < 20; r++) {
      const parts: string[] = [];
      const row: { x: number; y: number }[] = [];
      for (let i = 0; i < 20 - r; i++) {
        const x = i - (20 - r - 1) / 2;
        row.push({ x, y: 0.5 + r });
        parts.push(`Box((${x}, ${0.5 + r}), 1, 1)`);
      }
      home.push(row);
      lines.push(`row${r} = Bodies([${parts.join(', ')}])`);
    }
    expect(home.flat().length).toBe(210);
    const f = load(lines);
    let asleepAt = Infinity;
    for (let k = 1; k <= 60 * 60; k++) {
      f.setClock(k / 60);
      if (k % 6 === 0 && asleepAt === Infinity && physicsOf(f).world?.awakeCount() === 0) asleepAt = k / 60;
    }
    let off = 0;
    home.forEach((row, r) => {
      const bodies = f.value(`row${r}`) as physics.BodyValue[];
      row.forEach((h, i) => {
        const b = bodies[i] as physics.BodyValue;
        off = Math.max(off, Math.hypot(b.x - h.x, b.y - h.y));
      });
    });
    console.log(`pyramid of 210: all asleep at ${asleepAt} s, the farthest box is ${(off * 1000).toFixed(1)} mm from its start after 60 s`);
    // it stands: no box is more than a quarter of a metre from where it was put
    expect(off).toBeLessThan(0.25);
    expect(asleepAt).toBeLessThanOrEqual(3);
  });

  it('no pass-through: 1,000 shots of a ball of radius 0.05 at 100 m/s at a wall 0.01 thick, seeded offsets, never passes', { timeout: 300_000 }, () => {
    const rnd = seeded(11);
    let passed = 0;
    let first = '';
    for (let shot = 0; shot < 1000; shot++) {
      // where the ball starts along its run (so the step that meets the wall falls anywhere in a step), where along the wall it hits and at what small angle
      const run = 1 + rnd() * 0.84;
      const along = (rnd() - 0.5) * 3;
      const slant = (rnd() - 0.5) * 0.2;
      const f = load([
        'world with gravity = (0, 0)',
        'wall = Box((0, 0), 0.01, 4)',
        'wall with solid = true',
        `ball = Body(Circle((${-run}, ${along}), 0.05), speed = (${100 * Math.cos(slant)}, ${100 * Math.sin(slant)}))`,
      ]);
      for (let k = 1; k <= 12; k++) f.setClock(k / 60);
      const x = body(f, 'ball').x;
      if (x > 0) {
        passed++;
        if (first === '') first = `shot ${shot}: run ${run.toFixed(4)}, along ${along.toFixed(3)}, slant ${slant.toFixed(4)}, ended at x = ${x.toFixed(2)}`;
      }
    }
    console.log(`no pass-through: ${passed} of 1,000 shots passed the wall${first === '' ? '' : ` (first: ${first})`}`);
    expect(passed).toBe(0);
  });

  it('energy: a ball with bounce = 1 and no air, 1,000 bounces, the top height within 1%', { timeout: 600_000 }, () => {
    const f = load(['g = Ground()', 'g with bounce = 1', 'ball = Body(Circle((0, 2.3), 0.3), bounce = 1)']);
    const y0 = body(f, 'ball').y;
    let bounces = 0;
    let lastVy = 0;
    let apex = y0;
    let worst = 0;
    let lastApex = y0;
    for (let k = 1; bounces < 1000 && k < 60 * 3600; k++) {
      f.setClock(k / 60);
      const b = body(f, 'ball');
      if (lastVy < 0 && b.vy > 0) bounces++;
      if (lastVy > 0 && b.vy <= 0) {
        // the top of this bounce: the frame's highest sample, to the nearest 1/60 s
        lastApex = apex;
        worst = Math.max(worst, Math.abs(lastApex - y0) / (y0 - 0.3));
        apex = -Infinity;
      }
      apex = Math.max(apex, b.y);
      lastVy = b.vy;
    }
    console.log(`energy: ${bounces} bounces, the last top at ${lastApex.toFixed(5)} m (from ${y0}), the largest loss of the height above the floor over the film ${(worst * 100).toFixed(4)}%`);
    expect(bounces).toBeGreaterThanOrEqual(1000);
    expect(worst).toBeLessThan(0.01);
  });

  it('energy with joints: a hinge hanging pendulum swinging for 1,000 s, the energy above its lowest point within 2%', { timeout: 600_000 }, () => {
    const f = load(['wall = Circle((0, 0), 0.05)', 'wall with solid = true', 'bob = Body(Circle((sin(0.6), -cos(0.6)), 0.02), mass = 1)', 'j = Hinge(wall, bob, (0, 0))']);
    f.setClock(1 / 60);
    const e0 = body(f, 'bob').energy + 9.8;
    let worst = 0;
    for (let k = 2; k <= 60 * 1000; k++) {
      f.setClock(k / 60);
      worst = Math.max(worst, Math.abs(body(f, 'bob').energy + 9.8 - e0) / e0);
    }
    console.log(`energy with joints: the energy of the swing (above the lowest point) was ${e0.toFixed(5)} J at the start and differed by at most ${(worst * 100).toFixed(4)}% in 1,000 s`);
    expect(worst).toBeLessThan(0.02);
  });
});

describe('same result, long run and no garbage (design 11.4)', () => {
  /** The world hash after each film second of `seconds`. */
  function hashesOf(lines: readonly string[], space: boolean, seconds: number): string[] {
    const f = load(lines);
    const out: string[] = [];
    for (let s = 0; s < seconds; s++) {
      for (let k = 1; k <= 60; k++) f.setClock((s * 60 + k) / 60);
      out.push(hashWorld(f, space));
    }
    return out;
  }
  const firstDifference = (a: string[], b: string[]): number => a.findIndex((h, i) => h !== b[i]);

  for (const film of FILMS) {
    it(`same result: ${film.title}, played twice, the world hash equal every second for 60 s, and with the Rust loops on and off for 20 s`, { timeout: 600_000 }, () => {
      setPhysicsKernels(true);
      const a = hashesOf(film.lines, film.space, 60);
      const b = hashesOf(film.lines, film.space, 60);
      setPhysicsKernels(false);
      let off: string[];
      try {
        off = hashesOf(film.lines, film.space, 20);
      } finally {
        setPhysicsKernels(true);
      }
      const twice = firstDifference(a, b);
      const kernels = firstDifference(a.slice(0, 20), off);
      console.log(`same result, ${film.title}: twice ${twice < 0 ? 'equal' : `differ at second ${twice + 1}`}; kernels on and off ${kernels < 0 ? 'equal' : `differ at second ${kernels + 1}`}; last hash ${a[59]}`);
      expect(twice).toBe(-1);
      expect(kernels).toBe(-1);
    });
  }

  it('the films do what they are named for: the net tears and the crate burns', () => {
    const net = FILMS.find((f) => f.title === 'net that tears');
    const fire = FILMS.find((f) => f.title.startsWith('fire in space'));
    if (!net || !fire) throw new Error('a film is missing');
    const a = load([...net.lines, 'torn = net.torn']);
    const b = load([...fire.lines, 'bn = crate.burning']);
    let burning: unknown;
    for (let k = 1; k <= 60 * 20; k++) {
      a.setClock(k / 60);
      b.setClock(k / 60);
      if (k === 3 * 60) burning = b.value('bn');
    }
    console.log(`the net has ${String(a.value('torn'))} torn links after 20 s, the crate is burning after 3 s: ${String(burning)}`);
    expect(a.value('torn') as number).toBeGreaterThan(0);
    expect(burning).toBe(true);
  });

  it('long run: 10 minutes of film of 300 bodies, the heap after the checkpoint cap stops growing (the last 3 minutes against the 3 before)', { timeout: 1_200_000 }, () => {
    const f = load(['world with sleep = false', ...PILE]);
    const d = physicsOf(f) as unknown as { cpBytes: number };
    const samples: { t: number; heap: number; cp: number }[] = [];
    for (let k = 1; k <= 600 * 60; k++) {
      f.setClock(k / 60);
      if (k % (30 * 60) === 0) {
        collectNow();
        samples.push({ t: k / 60, heap: heapUsed() + process.memoryUsage().arrayBuffers, cp: d.cpBytes });
      }
    }
    const mb = (b: number): string => (b / 1048576).toFixed(1);
    console.log(`long run: heap and array buffers (the checkpoints) after a collection, MB, every 30 s: ${samples.map((s) => `${s.t}: ${mb(s.heap)} (checkpoints ${mb(s.cp)})`).join(', ')}`);
    const peak = (from: number, to: number): number => Math.max(...samples.filter((s) => s.t >= from && s.t <= to).map((s) => s.heap));
    const before = peak(240, 420);
    const last = peak(450, 600);
    console.log(`long run: peak of minutes 4 to 7 ${mb(before)} MB, of the last 3 minutes ${mb(last)} MB`);
    expect(Math.max(...samples.map((s) => s.cp))).toBeLessThanOrEqual(32 * 1024 * 1024);
    expect(last - before).toBeLessThan(2 * 1048576);
  });

  it('no garbage: steps of an awake 300-body world make no memory after the first second (no collection runs, under 16 bytes a step)', async () => {
    collectNow();
    const f = load(['world with sleep = false', ...PILE]);
    for (let k = 1; k <= 3 * 60; k++) f.setClock(k / 60);
    const w = physicsOf(f).world as World2;
    expect(w.awakeCount()).toBeGreaterThan(250);
    let gcs = 0;
    const obs = new PerformanceObserver((list) => {
      gcs += list.getEntries().length;
    });
    const steps = 500;
    // the engine makes its fastest code on another thread and puts it in at a later call
    for (let round = 0; round < 3; round++) {
      for (let k = 0; k < 1500; k++) w.step();
      await new Promise((r) => setTimeout(r, 100));
    }
    collectNow();
    obs.observe({ entryTypes: ['gc'] });
    heapUsed();
    heapUsed();
    const z = heapUsed();
    const own = heapUsed() - z;
    let least = Infinity;
    for (let k = 0; k < 5; k++) {
      const a = heapUsed();
      for (let s = 0; s < steps; s++) w.step();
      least = Math.min(least, heapUsed() - a - own);
    }
    await new Promise((r) => setTimeout(r, 50));
    obs.disconnect();
    console.log(`300 awake bodies, ${5 * steps} steps: ${gcs} collections, ${gcs === 0 ? `${(least / steps).toFixed(2)} bytes a step` : "bytes a step not measured (a collection ran)"}, awake ${w.awakeCount()}`);
    expect(gcs).toBe(0);
    expect(least / steps).toBeLessThan(16);
  }, 120_000);

  it('no garbage: steps of 100 awake boxes in space make no memory after the first second (no collection runs, under 16 bytes a step)', async () => {
    collectNow();
    const f = load(BOXES3);
    for (let k = 1; k <= 3 * 60; k++) f.setClock(k / 60);
    const w = physics3Of(f).world as World3;
    let gcs = 0;
    const obs = new PerformanceObserver((list) => {
      gcs += list.getEntries().length;
    });
    const steps = 500;
    for (let round = 0; round < 3; round++) {
      for (let k = 0; k < 1500; k++) w.step();
      await new Promise((r) => setTimeout(r, 100));
    }
    collectNow();
    obs.observe({ entryTypes: ['gc'] });
    heapUsed();
    heapUsed();
    const z = heapUsed();
    const own = heapUsed() - z;
    let least = Infinity;
    for (let k = 0; k < 5; k++) {
      const a = heapUsed();
      for (let s = 0; s < steps; s++) w.step();
      least = Math.min(least, heapUsed() - a - own);
    }
    await new Promise((r) => setTimeout(r, 50));
    obs.disconnect();
    console.log(`100 awake boxes in space, ${5 * steps} steps: ${gcs} collections, ${gcs === 0 ? `${(least / steps).toFixed(2)} bytes a step` : "bytes a step not measured (a collection ran)"}`);
    expect(gcs).toBe(0);
    expect(least / steps).toBeLessThan(16);
  }, 120_000);
});
