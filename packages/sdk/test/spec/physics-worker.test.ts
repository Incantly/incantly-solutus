/**
 * The physics worker (.kiro/specs/physics R7.3, core hook 7; docs/features/physics design 9.6, 11.2; errors.md 5, 7).
 * The worker is simulated in the same thread through the same message protocol: every message is structured-cloned,
 * and the cells come back with their typed arrays moved, as `postMessage` does.
 */
import { describe, expect, it } from 'vitest';
import { Figure, physics, physicsOf } from '@incantly/kernel';
import { sdkRegistry } from '../../src/registry';
import { PhysicsWorkerHost, PhysicsWorkerState } from '../../src/worker/index';
import type { FromWorker, PhysicsChannel, ToWorker } from '../../src/worker/index';

const DAM = [
  'tank = Polyline((-6, 6), (-6, 0), (6, 0), (6, 6))',
  'tank with solid = true',
  'lift = 4 min(1, max(0, t - 0.5))',
  'gate = Segment((-2, lift), (-2, 4 + lift))',
  'gate with solid = true',
  'water = Liquid(Box((-4, 2), 4, 4), 1500)',
  'ball = Body(Circle((3.5, 0.45), 0.45), density = 0.4)',
];

const make = (lines: readonly string[]): Figure => {
  const f = new Figure({ commands: sdkRegistry() });
  for (const l of lines) {
    const r = f.apply(l);
    if (!r.ok) throw new Error(`${l}: ${(r as { message: string }).message}`);
  }
  return f;
};

/** A worker in the same thread: the handler answers at once, through structured clones with the buffers moved. */
function sameThread(opts: { failAt?: number } = {}): { channel: PhysicsChannel; moved: number[]; posts: ToWorker[] } {
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
  return { channel, moved, posts };
}

const drops = (f: Figure): Float32Array => {
  const v = f.value('water');
  if (!physics.isLiquidValue(v)) throw new Error('water is not a liquid now');
  return v.xs;
};

describe('the physics worker (design 9.6)', () => {
  it('a world with liquid runs whole in the worker, and its film is the page\'s film, hash for hash', () => {
    const page = make(DAM);
    const alone = make(DAM);
    const { channel, moved } = sameThread();
    const host = new PhysicsWorkerHost(page, () => channel);
    for (let k = 1; k <= 4 * 60; k++) {
      const t = k / 60;
      page.setClock(t);
      host.frame(t);
      alone.setClock(t);
      if (k % 60 === 0) {
        expect(host.running).toBe(true);
        expect(physicsOf(page).remoteInfo.hash).toBe(physicsOf(alone).worldHash());
        expect(drops(page)).toEqual(drops(alone));
        expect(page.value('ball')).toEqual(alone.value('ball'));
      }
    }
    // the page stepped nothing: its world is in the worker
    expect(physicsOf(page).world).toBeUndefined();
    // each frame moved the drops' arrays and the body's forces instead of copying them
    expect(Math.min(...moved.slice(2))).toBeGreaterThanOrEqual(3);
  });

  it('a push made on the page goes to the worker as an @input line, and is saved', () => {
    const page = make(DAM);
    const alone = make(DAM);
    const { channel } = sameThread();
    const host = new PhysicsWorkerHost(page, () => channel);
    for (let k = 1; k <= 3 * 60; k++) {
      const t = k / 60;
      page.setClock(t);
      host.frame(t);
      alone.setClock(t);
      if (k === 60) {
        expect(page.apply('Push(ball, (0, 2))').ok).toBe(true);
        expect(alone.apply('Push(ball, (0, 2))').ok).toBe(true);
      }
    }
    expect(page.value('ball')).toEqual(alone.value('ball'));
    expect(page.toScript()).toMatch(/@input physics push ball 0 2 at 1/);
  });

  it('a changed line goes to the worker as a new script, and the film plays from it', () => {
    const page = make(DAM);
    const { channel, posts } = sameThread();
    const host = new PhysicsWorkerHost(page, () => channel);
    page.setClock(1);
    host.frame(1);
    expect(page.apply('ball = Body(Circle((3.5, 3), 0.45), density = 3)').ok).toBe(true);
    page.setClock(1.5);
    host.frame(1.5);
    expect(posts.filter((m) => m.k === 'load').length).toBe(2);
    const alone = make([...DAM.slice(0, -1), 'ball = Body(Circle((3.5, 3), 0.45), density = 3)']);
    alone.setClock(1.5);
    expect(page.value('ball')).toEqual(alone.value('ball'));
  });

  it('without a worker the page runs the same steps, with worker_unavailable once', () => {
    const page = make(DAM);
    const alone = make(DAM);
    const host = new PhysicsWorkerHost(page, () => undefined);
    for (let k = 1; k <= 120; k++) {
      page.setClock(k / 60);
      host.frame(k / 60);
      alone.setClock(k / 60);
    }
    const w = host.takeWarnings();
    expect(w.map((x) => x.kind)).toEqual(['worker_unavailable']);
    expect(host.running).toBe(false);
    expect(physicsOf(page).worldHash()).toBe(physicsOf(alone).worldHash());
  });

  it('a worker that stops hands the world back to the page, with worker_crashed, and the film is the same', () => {
    const page = make(DAM);
    const alone = make(DAM);
    const { channel } = sameThread({ failAt: 40 });
    const host = new PhysicsWorkerHost(page, () => channel);
    for (let k = 1; k <= 120; k++) {
      page.setClock(k / 60);
      host.frame(k / 60);
      alone.setClock(k / 60);
    }
    expect(host.takeWarnings().map((x) => x.kind)).toContain('worker_crashed');
    expect(host.running).toBe(false);
    // the page built the world again from its start and caught up
    for (let k = 0; k < 50 && page.driversNeedFrames(); k++) page.flush(true);
    expect(physicsOf(page).worldHash()).toBe(physicsOf(alone).worldHash());
  });

  it('smoke with liquid runs in the worker with it, the density grid moved to the page, the same film', () => {
    const lines = [...DAM, 'sm = Smoke(Box((0, 3), 12, 6), 32, source = Circle((4, 1), 0.3), heat = 4)'];
    const page = make(lines);
    const alone = make(lines);
    const { channel } = sameThread();
    const host = new PhysicsWorkerHost(page, () => channel);
    for (let k = 1; k <= 2 * 60; k++) {
      const t = k / 60;
      page.setClock(t);
      host.frame(t);
      alone.setClock(t);
    }
    expect(host.running).toBe(true);
    expect(physicsOf(page).remoteInfo.hash).toBe(physicsOf(alone).worldHash());
    const a = page.value('sm');
    const b = alone.value('sm');
    if (!physics.isSmokeValue(a) || !physics.isSmokeValue(b)) throw new Error('sm is not smoke');
    expect(a.density).toEqual(b.density);
    expect(a.mass).toBeGreaterThan(0.3);
  });

  it('a figure with smoke and no liquid stays on the page (it fits the page\'s 6 ms)', () => {
    const page = make(['sm = Smoke(Box((0, 0), 4, 4), 32, source = Circle((0, -1), 0.3))']);
    let asked = 0;
    const host = new PhysicsWorkerHost(page, () => {
      asked++;
      return undefined;
    });
    page.setClock(0.5);
    host.frame(0.5);
    expect(asked).toBe(0);
    expect(physicsOf(page).world).toBeDefined();
  });

  it('a figure without liquid stays on the page', () => {
    const page = make(['g = Ground()', 'b = Body(Box((0, 2), 1, 1))']);
    let asked = 0;
    const host = new PhysicsWorkerHost(page, () => {
      asked++;
      return undefined;
    });
    page.setClock(0.5);
    host.frame(0.5);
    expect(asked).toBe(0);
    expect(physicsOf(page).world).toBeDefined();
  });
});
