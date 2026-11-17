/**
 * Cloth on the page (.kiro/specs/physics R10.4, R10.5 fallback; docs/features/physics design 9.6, 11.4 "Cloth, no
 * worker", 12.1): a world with cloth runs whole in the worker with the same film as without it, and
 * a cloth in space is one sheet for the WebGL 2 painter.
 */
import { describe, expect, it } from 'vitest';
import { Figure, physics, physics3Of, physicsOf, space } from '@incantly/kernel';
import { sdkRegistry } from '../../src/registry';
import { PhysicsWorkerHost, PhysicsWorkerState } from '../../src/worker/index';
import type { FromWorker, PhysicsChannel } from '../../src/worker/index';
import { sceneOf3 } from '../../src/screen/space/scene3';
import type { SheetItem } from '../../src/screen/space/scene3';

const make = (lines: readonly string[]): Figure => {
  const f = new Figure({ commands: sdkRegistry() });
  for (const l of lines) {
    const r = f.apply(l);
    if (!r.ok) throw new Error(`${l}: ${(r as { message: string }).message}`);
  }
  return f;
};

function sameThread(): PhysicsChannel {
  const state = new PhysicsWorkerState();
  let cb: ((m: FromWorker) => void) | undefined;
  return {
    post: (m) => {
      const { reply, transfer } = state.handle(structuredClone(m));
      cb?.(structuredClone(reply, { transfer }));
    },
    onMessage: (f) => {
      cb = f;
    },
    onError: () => {},
    close: () => {
      cb = undefined;
    },
  };
}

const FLAG = ['g = Ground()', 'flag = Cloth((0, 0, 3), (3, 0, 0), (0, 0, -2), 64, 32, mass = 0.5, pins = "left")', 'world with wind = (5 + 3 sin(2 t), 1, 0)'];
const ROPE = ['rope = Cloth((0, 5), (3, 5), 30, mass = 0.2, pins = [(0, 5)])', 'ball = Body(Circle((3, 5), 0.2), mass = 1)', 'tie = Pin(rope, (3, 5), ball)'];

describe('cloth in the worker (design 9.6, 11.4 "Cloth, no worker")', () => {
  it('the 64 × 32 flag runs whole in the worker: the same world hash every second as with no worker', () => {
    const page = make(FLAG);
    const alone = make(FLAG);
    const host = new PhysicsWorkerHost(page, () => sameThread());
    for (let k = 1; k <= 3 * 60; k++) {
      const t = k / 60;
      page.setClock(t);
      host.frame(t);
      alone.setClock(t);
      if (k % 60 === 0) {
        expect(host.running).toBe(true);
        expect(physics3Of(page).remoteInfo.hash).toBe(physics3Of(alone).worldHash());
        expect(physics3Of(page).remoteInfo.cloth).toBe(2048);
        const a = page.value('flag') as physics.ClothValue;
        const b = alone.value('flag') as physics.ClothValue;
        expect(Array.from(a.xs)).toEqual(Array.from(b.xs));
      }
    }
    expect(physics3Of(page).world).toBeUndefined();
  });

  it('a rope in the plane goes to the worker too, a grab on the page included', () => {
    const page = make(ROPE);
    const alone = make(ROPE);
    const host = new PhysicsWorkerHost(page, () => sameThread());
    for (let k = 1; k <= 2 * 60; k++) {
      const t = k / 60;
      page.setClock(t);
      host.frame(t);
      alone.setClock(t);
      if (k === 30) {
        // the same grab, logged with the point's index, on both
        physicsOf(page).grabCloth(page.get('rope')?.id as never, 15, 1.5, 3.5);
        physicsOf(alone).grabCloth(alone.get('rope')?.id as never, 15, 1.5, 3.5);
      }
    }
    expect(host.running).toBe(true);
    expect(physicsOf(page).remoteInfo.hash).toBe(physicsOf(alone).worldHash());
    expect(page.toScript()).toContain('@input physics grab rope 15 1.5 3.5 at 0.5');
  });
});

describe('cloth in the Space view (design 12.1)', () => {
  it('a sheet becomes one sheet item for the WebGL 2 painter, every point, threads every 8, its pins as dots', () => {
    const f = make(FLAG);
    const sc = sceneOf3(f, space.viewOf(f));
    const id = f.get('flag')?.id as unknown as number;
    const sheet = sc.items.find((i) => i.k === 'sheet' && i.id === id) as SheetItem | undefined;
    expect(sheet).toMatchObject({ nx: 64, ny: 32, threads: 8, occludes: true, coarse: 2, fine: 1 });
    expect(sheet?.pos.length).toBe(64 * 32 * 3);
    expect(sheet?.tris).toBeUndefined();
    expect(sc.items.filter((i) => i.k === 'dot' && i.id === id).length).toBe(32);
  });

  it('a torn cloth lists its whole faces only', () => {
    const f = make(['g = Ground()', 'net = Cloth((-1, -1, 2), (2, 0, 0), (0, 2, 0), 12, 12, tears = 1.2, stretch = 0.5, pins = "corners")', 'ball = Body(Sphere((0, 0, 3), 0.3), mass = 20)']);
    for (let k = 1; k <= 120; k++) f.setClock(k / 60);
    const v = f.value('net') as physics.ClothValue;
    expect(v.torn).toBeGreaterThan(0);
    const id = f.get('net')?.id as unknown as number;
    const sheet = sceneOf3(f, space.viewOf(f)).items.find((i) => i.k === 'sheet' && i.id === id) as SheetItem | undefined;
    expect(sheet?.tris).toBeDefined();
    expect((sheet?.tris?.length ?? 0) / 3).toBeLessThan(2 * 11 * 11);
    expect(sheet?.topology).toBe(v.torn);
  });
});
