/**
 * Animation in the studio (animation-time design 3, 6, 10): the clock runs through the kernel's player, so traces fill
 * in, animated sliders move and particle systems are drawn.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tracePoints } from '@incantly/kernel';
import { paintScene } from '../src/graph/paint';
import type { SceneItem } from '../src/graph/paint';
import { Viewport } from '../src/graph/viewport';
import { KernelSession } from '../src/session';
import { mountStudio } from '../src/studio-page';
import type { Mounted } from '../src/studio-page';

/** A canvas context that only counts the calls. */
function countingCtx(): CanvasRenderingContext2D & { calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  return new Proxy({ calls, canvas: { width: 800, height: 600 } } as Record<string, unknown>, {
    get(t, k) {
      if (k in t) return t[k as string];
      return (..._a: unknown[]) => {
        calls[String(k)] = (calls[String(k)] ?? 0) + 1;
        return { addColorStop: () => undefined };
      };
    },
    set(t, k, v) {
      t[k as string] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D & { calls: Record<string, number> };
}

const run = (s: KernelSession, seconds: number): void => {
  s.play();
  for (let k = 1; k <= Math.round(seconds * 60); k++) s.frame(k / 60);
};

describe('the clock runs through the player', () => {
  it('a traced point leaves a path as frames play', () => {
    const s = new KernelSession();
    s.load(['@clock 0..10', 'P = (cos(t), sin(t))', 'Trace(P)'].join('\n'));
    expect(s.hasClock()).toBe(true);
    run(s, 2);
    expect(s.time()).toBeGreaterThan(1.5);
    const xs = tracePoints(s.figure, s.figure.get('P')?.id as never) as Float64Array;
    expect(xs.length / 2).toBeGreaterThan(60);
  });

  it('Animate(a) moves the slider on its own', () => {
    const s = new KernelSession();
    s.load(['a = 1 in -2..2 step 0.01', 'Animate(a)'].join('\n'));
    expect(s.hasClock()).toBe(true);
    const before = s.figure.value('a');
    run(s, 1);
    expect(s.figure.value('a')).not.toBe(before);
  });

  it('an ended film starts again', () => {
    const s = new KernelSession();
    s.load(['@clock 0..1', 'P = (t, 0)'].join('\n'));
    run(s, 1.5);
    expect(s.playing()).toBe(true);
    expect(s.time()).toBeLessThan(1);
  });

  it('a particle system is drawn at the clock time', () => {
    const s = new KernelSession();
    s.load(['@clock 0..10', 'p = Particles(count = 200, life = 1, pos = (4 u - 2, 2 age))'].join('\n'));
    expect(s.hasClock()).toBe(true);
    run(s, 0.5);
    const o = s.figure.get('p');
    const item: SceneItem = { id: 1, name: 'p', type: 'Particles', typeText: 'Particles', value: o?.cell.defined ? o.cell.value : undefined, color: '#000', free: false, label: false, time: s.time() };
    const vp = new Viewport();
    vp.resize(800, 600);
    vp.home();
    const ctx = countingCtx();
    paintScene(ctx, vp, [item]);
    expect(ctx.calls['arc'] ?? 0).toBeGreaterThan(20);
  });
});

describe('the play button in the page', () => {
  let root: HTMLElement;
  let m: Mounted;
  let frame: ((now: number) => void) | undefined;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
    m = mountStudio(root, {
      raf: (cb) => {
        frame = cb;
        return 1;
      },
      caf: () => {
        frame = undefined;
      },
    });
  });
  afterEach(() => {
    m.dispose();
    root.remove();
  });

  it('the pendulum example plays and its bob leaves a trace', () => {
    m.loadExample('anim-pendulum');
    const play = root.querySelector('.clock button') as HTMLButtonElement;
    expect((root.querySelector('.clock') as HTMLElement).hidden).toBe(false);
    play.click();
    for (let k = 1; k <= 90; k++) frame?.(k * (1000 / 60));
    expect(m.session.time()).toBeGreaterThan(1);
    const xs = tracePoints(m.session.figure, m.session.figure.get('bob')?.id as never) as Float64Array;
    expect(xs.length).toBeGreaterThan(100);
    play.click();
    expect(m.session.playing()).toBe(false);
  });
});
