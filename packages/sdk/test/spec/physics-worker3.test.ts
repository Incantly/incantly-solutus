/**
 * The physics worker with a world in space (.kiro/specs/physics R7.3, task 7.4; docs/features/physics design 9.6, 11.2;
 * errors.md 5, 7), and the round 6 carry-over: a slider logged in the worker survives a reload of its script.
 * The worker runs in the same thread through the same message protocol, as in `physics-worker.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { Figure, physics, physics3Of, physicsOf } from '@incantly/kernel';
import { sdkRegistry } from '../../src/registry';
import { PhysicsWorkerHost, PhysicsWorkerState } from '../../src/worker/index';
import type { FromWorker, PhysicsChannel, ToWorker } from '../../src/worker/index';

const SPLASH = [
  'g = Ground()',
  'w1 = Box((-1.1, 0, 0.6), 0.2, 2, 1.2)', 'w2 = Box((1.1, 0, 0.6), 0.2, 2, 1.2)', 'w3 = Box((0, -1.1, 0.6), 2.4, 0.2, 1.2)', 'w4 = Box((0, 1.1, 0.6), 2.4, 0.2, 1.2)',
  'w1 with solid = true', 'w2 with solid = true', 'w3 with solid = true', 'w4 with solid = true',
  'water = Liquid(Box((0, 0, 0.3), 2, 2, 0.6), 600)',
  'ball = Body(Sphere((0, 0, 2), 0.3), density = 0.5)',
];
const BOAT = [
  'pool = Box((0, 0, -0.5), 8, 8, 1)',
  'sea = Waves(pool, 24)',
  'boat = Body(Box((0, 0, 0.6), 1.6, 0.8, 0.4), density = 0.4)',
];

const make = (lines: readonly string[]): Figure => {
  const f = new Figure({ commands: sdkRegistry() });
  for (const l of lines) {
    const r = f.apply(l);
    if (!r.ok) throw new Error(`${l}: ${(r as { message: string }).message}`);
  }
  return f;
};

function sameThread(opts: { failAt?: number } = {}): { channel: PhysicsChannel; moved: number[]; posts: ToWorker[]; state: PhysicsWorkerState } {
  const state = new PhysicsWorkerState();
  let cb: ((m: FromWorker) => void) | undefined;
  let onErr: ((why: string) => void) | undefined;
  const moved: number[] = [];
  const posts: ToWorker[] = [];
  const channel: PhysicsChannel = {
    post: (m) => {
      posts.push(m);
      if (opts.failAt !== undefined && posts.length >= opts.failAt) {
        onErr?.('the worker stopped');
        return;
      }
      const { reply, transfer } = state.handle(structuredClone(m));
      moved.push(transfer.length);
      cb?.(structuredClone(reply, { transfer }));
    },
    onMessage: (f) => {
      cb = f;
    },
    onError: (f) => {
      onErr = f;
    },
    close: () => {
      cb = undefined;
    },
  };
  return { channel, moved, posts, state };
}

const zs = (f: Figure): Float32Array => {
  const v = f.value('water');
  if (!physics.isLiquidValue(v) || !v.zs) throw new Error('water is not a liquid in space now');
  return v.zs;
};

describe('the physics worker with a world in space (design 9.6, round 7)', () => {
  it('liquid in space runs whole in the worker, and its film is the page\'s film, hash for hash', () => {
    const page = make(SPLASH);
    const alone = make(SPLASH);
    const { channel, moved } = sameThread();
    const host = new PhysicsWorkerHost(page, () => channel);
    for (let k = 1; k <= 3 * 60; k++) {
      const t = k / 60;
      page.setClock(t);
      host.frame(t);
      alone.setClock(t);
      if (k % 60 === 0) {
        expect(host.running).toBe(true);
        expect(physics3Of(page).remoteInfo.hash).toBe(physics3Of(alone).worldHash());
        expect(zs(page)).toEqual(zs(alone));
        expect(page.value('ball')).toEqual(alone.value('ball'));
      }
    }
    expect(physics3Of(page).world).toBeUndefined();
    expect(physicsOf(page).remote).toBe(false);
    // the drops' three arrays and the ball's forces moved, not copied
    expect(Math.min(...moved.slice(2))).toBeGreaterThanOrEqual(4);
  });

  it('waves in space run in the worker too, with the same heights', () => {
    const page = make(BOAT);
    const alone = make(BOAT);
    const { channel } = sameThread();
    const host = new PhysicsWorkerHost(page, () => channel);
    for (let k = 1; k <= 120; k++) {
      page.setClock(k / 60);
      host.frame(k / 60);
      alone.setClock(k / 60);
    }
    expect(host.running).toBe(true);
    expect(physics3Of(page).remoteInfo.hash).toBe(physics3Of(alone).worldHash());
    expect((page.value('sea') as physics.WavesValue).heights).toEqual((alone.value('sea') as physics.WavesValue).heights);
    expect(page.value('boat')).toEqual(alone.value('boat'));
  });

  it('a push in space made on the page goes to the worker as an @input line, and is saved', () => {
    const page = make(SPLASH);
    const alone = make(SPLASH);
    const { channel } = sameThread();
    const host = new PhysicsWorkerHost(page, () => channel);
    for (let k = 1; k <= 2 * 60; k++) {
      const t = k / 60;
      page.setClock(t);
      host.frame(t);
      alone.setClock(t);
      if (k === 60) {
        expect(page.apply('Push(ball, (0, 0, 1))').ok).toBe(true);
        expect(alone.apply('Push(ball, (0, 0, 1))').ok).toBe(true);
      }
    }
    expect(page.value('ball')).toEqual(alone.value('ball'));
    expect(page.toScript()).toMatch(/@input physics push ball 0 0 1 at 1/);
  });

  it('a worker that stops hands the world in space back to the page, with worker_crashed, and the film is the same', () => {
    const page = make(SPLASH);
    const alone = make(SPLASH);
    const { channel } = sameThread({ failAt: 40 });
    const host = new PhysicsWorkerHost(page, () => channel);
    for (let k = 1; k <= 90; k++) {
      page.setClock(k / 60);
      host.frame(k / 60);
      alone.setClock(k / 60);
    }
    expect(host.takeWarnings().map((x) => x.kind)).toContain('worker_crashed');
    for (let k = 0; k < 50 && page.driversNeedFrames(); k++) page.flush(true);
    expect(physics3Of(page).worldHash()).toBe(physics3Of(alone).worldHash());
  });

  it('without a worker the page plays the same film in space, with worker_unavailable once', () => {
    const page = make(SPLASH);
    const alone = make(SPLASH);
    const host = new PhysicsWorkerHost(page, () => undefined);
    for (let k = 1; k <= 60; k++) {
      page.setClock(k / 60);
      host.frame(k / 60);
      alone.setClock(k / 60);
    }
    expect(host.takeWarnings().map((x) => x.kind)).toEqual(['worker_unavailable']);
    expect(physics3Of(page).worldHash()).toBe(physics3Of(alone).worldHash());
  });
});

describe('round 6 carry-over: a slider logged in the worker (design 9.6)', () => {
  const LINES = [
    'tank = Polyline((-3, 6), (-3, 0), (3, 0), (3, 6))', 'tank with solid = true',
    'water = Liquid(Box((0, 1), 4, 2), 300)',
    'gy = -9.8', 'gy with rerun = continue', 'world with gravity = (0, gy)',
    'ball = Body(Circle((0, 4), 0.3), density = 0.5)',
  ];

  it('a slider with rerun = continue changed while the world is in the worker is kept when a line edit reloads the worker', () => {
    const page = make(LINES);
    const alone = make(LINES);
    const { channel, posts } = sameThread();
    const host = new PhysicsWorkerHost(page, () => channel);
    for (let k = 1; k <= 120; k++) {
      const t = k / 60;
      page.setClock(t);
      host.frame(t);
      alone.setClock(t);
      if (k === 40) {
        expect(page.setFree('gy', -2).ok).toBe(true);
        expect(alone.setFree('gy', -2).ok).toBe(true);
      }
      if (k === 80) {
        // a line edit: the worker gets the page's whole script again, its log included
        expect(page.apply('k1 = 1').ok).toBe(true);
        expect(alone.apply('k1 = 1').ok).toBe(true);
      }
    }
    expect(posts.filter((m) => m.k === 'load').length).toBe(2);
    expect(page.toScript()).toMatch(/@input physics set gy/);
    expect(page.value('ball')).toEqual(alone.value('ball'));
  });
});

describe('what the worker moves is a copy, in space (PH-47)', () => {
  const SLEEPER3 = [...SPLASH, 'cube = Body(Box((5, 5, 0.5), 1, 1, 1), mass = 2)', 'fg = cube.force("gravity")', 'fn = cube.force("normal")'];

  it('a body that sleeps for 60 frames reads its forces in the worker and on the page, and no frame throws', () => {
    const page = make(SLEEPER3);
    const alone = make(SLEEPER3);
    const { channel, state } = sameThread();
    const host = new PhysicsWorkerHost(page, () => channel);
    for (let k = 1; k <= 150; k++) {
      const t = k / 60;
      page.setClock(t);
      host.frame(t);
      alone.setClock(t);
    }
    expect(host.running).toBe(true);
    expect(host.takeWarnings().map((x) => x.kind)).not.toContain('worker_crashed');
    const inside = (state as unknown as { figure: Figure }).figure;
    const body = inside.value('cube') as { forces?: Float64Array };
    expect(body.forces?.byteLength).toBeGreaterThan(0);
    const fn = inside.value('fn') as { x: number; y: number; z: number };
    expect(fn.z).toBeCloseTo(2 * 9.8, 3);
    expect(page.value('fn')).toEqual(fn);
    expect(page.value('fn')).toEqual(alone.value('fn'));
    expect(page.value('fg')).toEqual(alone.value('fg'));
  });

  it('the arrays in a reply are copies: the worker\'s own arrays are never detached by a frame', () => {
    const page = make(SLEEPER3);
    const { state } = sameThread();
    state.handle({ k: 'load', seq: 1, script: page.toScript() });
    const inside = (state as unknown as { figure: Figure }).figure;
    for (let k = 1; k <= 30; k++) {
      const { reply, transfer } = state.handle({ k: 'frame', seq: 1 + k, t: k / 60, sets: [], lines: [] });
      const water = inside.value('water') as { xs: Float32Array };
      const held = water.xs.buffer;
      for (const b of transfer) expect(b).not.toBe(held);
      structuredClone(reply, { transfer });
      expect(water.xs.byteLength).toBeGreaterThan(0);
    }
  });
});
