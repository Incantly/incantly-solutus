/**
 * Smoke and fire in space on the page (.kiro/specs/physics R11 items 7 and 9; docs/features/physics design 9.6, 9.8 "Where it runs",
 * 11.4 "Cloth, no worker", 12.1 "Smoke and fire in space"): a figure with a grid in space runs whole in the physics worker with the
 * same film as without it, its `Ignite` lines reach the worker, and a view in space with fire exports to SVG and PNG.
 * The worker runs in the same thread through the same message protocol, as in `physics-worker3.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { Figure, physics, physics3Of } from '@incantly/kernel';
import { SvgContext, createHeadlessApp, sdkRegistry } from '../../src/index';
import type { ApiError, CanvasFactory, ExportResult } from '../../src/index';
import { PhysicsWorkerHost, PhysicsWorkerState } from '../../src/worker/index';
import type { FromWorker, PhysicsChannel, ToWorker } from '../../src/worker/index';

vi.setConfig({ testTimeout: 240_000 });

const BOX = 'Box((0, 0, 1.5), 3, 3, 3)';
const SRC = 'source = Sphere((0, 0, 0.3), 0.3)';
/** Fire, a low crate that burns, and a flag over them. */
const FLAG_FIRE = [
  'g = Ground()',
  `fire = Fire(${BOX}, 16, ${SRC})`,
  'wood = Body(Box((0.25, 0, 0.1), 0.5, 0.5, 0.2), mass = 1, burns = 3)',
  'flag = Cloth((-0.8, -0.5, 1.6), (1.6, 0, 0), (0, 1, 0), 12, 8, mass = 0.1, pins = "left", burns = 2)',
  'bur = wood.burnt',
];
const SMOKE_ONLY = [`sm = Smoke(${BOX}, 16, source = Sphere((0, 0, 0.4), 0.3), heat = 6)`];
const COLD = ['g = Ground()', `cold = Fire(${BOX}, 16)`, 'wood = Body(Box((0.25, 0, 0.1), 0.5, 0.5, 0.2), mass = 1, burns = 8)', 'bur = wood.burnt'];

const make = (lines: readonly string[]): Figure => {
  const f = new Figure({ commands: sdkRegistry() });
  for (const l of lines) {
    const r = f.apply(l);
    if (!r.ok) throw new Error(`${l}: ${(r as { message: string }).message}`);
  }
  return f;
};

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

const fire = (name: string, f: Figure): physics.FireValue => {
  const v = f.value(name);
  if (!physics.isFireValue(v)) throw new Error(`${name} is not a fire now`);
  return v;
};
const smoke = (name: string, f: Figure): physics.SmokeValue => {
  const v = f.value(name);
  if (!physics.isSmokeValue(v)) throw new Error(`${name} is not smoke now`);
  return v;
};

describe('a grid in space runs in the physics worker (design 9.6, 9.8 "Where it runs")', () => {
  it('fire, a burning crate and a flag run whole in the worker, and the film is the page\'s film: the world hash, the grid, the flag and the crate every second', () => {
    const page = make(FLAG_FIRE);
    const alone = make(FLAG_FIRE);
    const { channel, moved } = sameThread();
    const host = new PhysicsWorkerHost(page, () => channel);
    for (let k = 1; k <= 4 * 60; k++) {
      const t = k / 60;
      page.setClock(t);
      host.frame(t);
      alone.setClock(t);
      if (k % 60 === 0) {
        expect(host.running, `t = ${t}`).toBe(true);
        expect(physics3Of(page).remoteInfo.hash, `t = ${t}`).toBe(physics3Of(alone).worldHash());
        expect(Array.from(fire('fire', page).temp), `t = ${t}`).toEqual(Array.from(fire('fire', alone).temp));
        expect(Array.from(fire('fire', page).density), `t = ${t}`).toEqual(Array.from(fire('fire', alone).density));
        expect(Array.from((page.value('flag') as physics.ClothValue).xs)).toEqual(Array.from((alone.value('flag') as physics.ClothValue).xs));
        expect(page.value('bur')).toEqual(alone.value('bur'));
      }
    }
    // the page's driver stepped nothing: the world is in the worker
    expect(physics3Of(page).world).toBeUndefined();
    expect(fire('fire', page).hottest).toBeGreaterThan(900);
    expect(page.value('bur') as number).toBeGreaterThan(0);
    // the grid's T and smoke went to the page as moved buffers, not copies: at least two each frame
    expect(Math.min(...moved.slice(2))).toBeGreaterThanOrEqual(2);
  });

  it('a smoke grid alone in space goes to the worker too, with the same density every second', () => {
    const page = make(SMOKE_ONLY);
    const alone = make(SMOKE_ONLY);
    const { channel, moved } = sameThread();
    const host = new PhysicsWorkerHost(page, () => channel);
    for (let k = 1; k <= 3 * 60; k++) {
      page.setClock(k / 60);
      host.frame(k / 60);
      alone.setClock(k / 60);
      if (k % 60 === 0) {
        expect(host.running).toBe(true);
        expect(physics3Of(page).remoteInfo.hash).toBe(physics3Of(alone).worldHash());
        expect(Array.from(smoke('sm', page).density)).toEqual(Array.from(smoke('sm', alone).density));
      }
    }
    expect(Math.min(...moved.slice(2))).toBeGreaterThanOrEqual(1);
    expect(smoke('sm', page).mass).toBeGreaterThan(0);
  });

  it('an Ignite made on the page goes to the worker as an @input line, is saved, and gives the film of the page alone', () => {
    const page = make(COLD);
    const alone = make(COLD);
    const { channel } = sameThread();
    const host = new PhysicsWorkerHost(page, () => channel);
    for (let k = 1; k <= 4 * 60; k++) {
      const t = k / 60;
      page.setClock(t);
      host.frame(t);
      alone.setClock(t);
      if (k === 60) {
        expect(page.apply('Ignite(wood)').ok).toBe(true);
        expect(alone.apply('Ignite(wood)').ok).toBe(true);
      }
    }
    expect(host.running).toBe(true);
    expect(page.value('bur') as number).toBeGreaterThan(0);
    expect(page.value('bur')).toEqual(alone.value('bur'));
    expect(physics3Of(page).remoteInfo.hash).toBe(physics3Of(alone).worldHash());
    expect(Array.from(fire('cold', page).temp)).toEqual(Array.from(fire('cold', alone).temp));
    expect(page.toScript()).toMatch(/@input physics ignite wood/);
  });

  it('a body that burns away in the worker reads undefined with the reason burnt on the page, and the burnt notice comes once', () => {
    const page = make(FLAG_FIRE.slice(0, 3));
    const { channel } = sameThread();
    const host = new PhysicsWorkerHost(page, () => channel);
    let burnt = 0;
    for (let k = 1; k <= 20 * 60; k++) {
      page.setClock(k / 60);
      host.frame(k / 60);
      burnt += page.takeWarnings().filter((w) => w.kind === 'burnt').length;
      burnt += host.takeWarnings().filter((w) => w.kind === 'burnt').length;
    }
    expect(host.running).toBe(true);
    expect(page.get('wood')?.cell).toMatchObject({ defined: false, reason: 'burnt' });
    expect(burnt).toBe(1);
  });

  it('a worker that stops hands the grid in space back to the page, with worker_crashed, and the film is the same', () => {
    const page = make(FLAG_FIRE);
    const alone = make(FLAG_FIRE);
    const { channel } = sameThread({ failAt: 40 });
    const host = new PhysicsWorkerHost(page, () => channel);
    for (let k = 1; k <= 90; k++) {
      page.setClock(k / 60);
      host.frame(k / 60);
      alone.setClock(k / 60);
    }
    expect(host.takeWarnings().map((x) => x.kind)).toContain('worker_crashed');
    for (let k = 0; k < 400 && page.driversNeedFrames(); k++) page.flush(true);
    expect(physics3Of(page).worldHash()).toBe(physics3Of(alone).worldHash());
    expect(Array.from(fire('fire', page).temp)).toEqual(Array.from(fire('fire', alone).temp));
  });

  it('without a worker the page plays the same film with a grid in space, with worker_unavailable once', () => {
    const page = make(FLAG_FIRE);
    const alone = make(FLAG_FIRE);
    const host = new PhysicsWorkerHost(page, () => undefined);
    for (let k = 1; k <= 120; k++) {
      page.setClock(k / 60);
      host.frame(k / 60);
      alone.setClock(k / 60);
    }
    expect(host.takeWarnings().map((x) => x.kind)).toEqual(['worker_unavailable']);
    expect(physics3Of(page).worldHash()).toBe(physics3Of(alone).worldHash());
    expect(Array.from(fire('fire', page).temp)).toEqual(Array.from(fire('fire', alone).temp));
  });
});

describe('a view in space with fire exports without throwing (design 12.1 "Smoke and fire in space")', () => {
  const done = (r: ExportResult | ApiError): ExportResult => {
    if (!r.ok) throw new Error(r.message);
    return r;
  };
  const app3 = (lines: readonly string[], t: number) => {
    const app = createHeadlessApp({ mode: 'graphing3d', script: lines.join('\n'), size: { width: 480, height: 360 } });
    app.clock.seek(t);
    for (let k = 0; k < 400 && app.figure.driversNeedFrames(); k++) app.figure.flush(true);
    return app;
  };
  const canvas: CanvasFactory = (w, h) => {
    const ctx = new SvgContext(w, h);
    return { getContext: () => ctx, toBlob: (cb) => cb(new Blob([ctx.toString()], { type: 'image/png' })) };
  };

  it('SVG of the view in space with a fire: it exports, and draws more than the same view over a cold grid', async () => {
    const hot = app3(FLAG_FIRE, 2);
    const cold = app3(['g = Ground()', `cold = Fire(${BOX}, 16)`, 'wood = Body(Box((0.25, 0, 0.1), 0.5, 0.5, 0.2), mass = 1, burns = 3)', 'flag = Cloth((-0.8, -0.5, 1.6), (1.6, 0, 0), (0, 1, 0), 12, 8, mass = 0.1, pins = "left", burns = 2)'], 2);
    expect(hot.figure.value('fire')).toBeDefined();
    expect(fire('fire', hot.figure).hottest).toBeGreaterThan(900);
    const a = done(await hot.export({ format: 'svg', view: '3d' }));
    const b = done(await cold.export({ format: 'svg', view: '3d' }));
    expect(a).toMatchObject({ format: 'svg', width: 480, height: 360 });
    expect((a.text as string).startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect((a.text as string).length).toBeGreaterThan((b.text as string).length);
  });

  it('SVG of the view in space with a smoke grid exports too', async () => {
    const app = app3(SMOKE_ONLY, 2);
    expect(smoke('sm', app.figure).mass).toBeGreaterThan(0);
    const r = done(await app.export({ format: 'svg', view: '3d' }));
    expect(r.text as string).toContain('<svg');
  });

  it('PNG of the view in space with a fire exports, at the scale asked, with no WebGL 2 on this page', async () => {
    const app = app3(FLAG_FIRE, 2);
    const r = done(await app.export({ format: 'png', view: '3d', scale: 2 }, { canvas }));
    expect(r).toMatchObject({ format: 'png', width: 960, height: 720 });
    expect(r.blob.type).toBe('image/png');
    expect(r.bytes).toBeGreaterThan(0);
  });

  it('a fire that is out, and a view at t = 0, export as well', async () => {
    const out = app3([`fire = Fire(${BOX}, 12, ${SRC}, until = 0.5)`], 30);
    expect(fire('fire', out.figure).out).toBe(true);
    done(await out.export({ format: 'svg', view: '3d' }));
    const start = app3(FLAG_FIRE, 0);
    done(await start.export({ format: 'svg', view: '3d' }));
    done(await start.export({ format: 'png', view: '3d' }, { canvas }));
  });
});
