/** Motion in space: spin, particles in space, moving objects (.kiro/specs/space-3d-surfaces R3). */
import { describe, expect, it } from 'vitest';
import { isParticlesValue, makeParticleBatch, space } from '@incantly/kernel';
import { createHeadlessApp, hasClock } from '../../src/index';
import { drawsOnGraph, sceneOf3 } from '../../src/screen/index';
import type { DotItem, PointItem } from '../../src/screen/index';

const FOUNTAIN = 'f = Particles(count = 200, life = 2, pos = (u - 0.5, v - 0.5, 3 * age), size = 0.05)';

describe('particles in space (R3.2)', () => {
  it('the 3D app allows particles, and pos may be a point in space', () => {
    const a = createHeadlessApp({ mode: 'graphing3d', script: FOUNTAIN });
    const o = a.figure.get('f');
    expect(o?.type).toBe('Particles');
    const v = (o?.cell as { value: unknown }).value;
    expect(isParticlesValue(v) && v.space).toBe(true);
    if (!isParticlesValue(v)) return;
    expect(v.program.gpuOk).toBe(false);
    const b = makeParticleBatch(200, true);
    v.program.evalCpu(1, 1, b);
    const z = b.z as Float32Array;
    let alive = 0;
    for (let i = 0; i < 200; i++) {
      if ((b.alpha[i] as number) <= 0) continue;
      alive++;
      expect(z[i]).toBeGreaterThanOrEqual(0);
      expect(z[i]).toBeLessThanOrEqual(6);
    }
    expect(alive).toBeGreaterThan(0);
  });

  it('flat particles keep their GPU path and have no z', () => {
    const a = createHeadlessApp({ mode: 'classic', script: 'g = Particles(count = 10, life = 1, pos = (u, v))' });
    const v = (a.figure.get('g')?.cell as { value: unknown }).value;
    expect(isParticlesValue(v) && v.space).toBeFalsy();
    expect(isParticlesValue(v) && v.program.gpuOk).toBe(true);
    expect(makeParticleBatch(4).z).toBeUndefined();
  });

  it('the Space view draws each live particle as a dot; the flat graph leaves them out', () => {
    const a = createHeadlessApp({ mode: 'graphing3d', script: FOUNTAIN });
    a.clock.seek(1);
    const s = sceneOf3(a.figure, space.viewAt(a.figure));
    const dots = s.items.filter((i): i is DotItem => i.k === 'dot');
    expect(dots.length).toBeGreaterThan(50);
    expect(dots.every((d) => Math.abs(d.size - 0.05) < 1e-6 && !d.px)).toBe(true);
    const o = a.figure.get('f');
    expect(drawsOnGraph('Particles', 'Particles', (o?.cell as { value: unknown }).value)).toBe(false);
  });

  it('the particles move with the film, and the clip box cuts them', () => {
    const a = createHeadlessApp({ mode: 'graphing3d', script: `${FOUNTAIN}\nspace with clip = true, clipMax = (5, 5, 1)` });
    a.clock.seek(1.5);
    const dots = sceneOf3(a.figure, space.viewAt(a.figure)).items.filter((i): i is DotItem => i.k === 'dot');
    expect(dots.length).toBeGreaterThan(0);
    expect(dots.every((d) => d.p.z <= 1 + 1e-9)).toBe(true);
  });
});

describe('spin and moving objects (R3.1, R3.3)', () => {
  it('a spinning camera turns with time, and the figure then has a clock', () => {
    const a = createHeadlessApp({ mode: 'graphing3d', script: 'A = (1, 0, 0)' });
    expect(hasClock(a.figure)).toBe(false);
    a.run('space with spin = 30');
    expect(hasClock(a.figure)).toBe(true);
    a.clock.seek(3);
    expect(space.viewAt(a.figure).azimuth).toBeCloseTo((-40 + 90) * (Math.PI / 180), 12);
    expect(space.viewOf(a.figure).azimuth).toBeCloseTo(-40 * (Math.PI / 180), 12);
  });

  it('a point built from t moves round its circle, and its trail grows', () => {
    const a = createHeadlessApp({ mode: 'graphing3d', script: 'P = (2 * cos(t), 2 * sin(t), t / 4)\ntrail = Curve(2 * cos(s), 2 * sin(s), s / 4, s, 0, t + 0.001)' });
    // a formula of t gives the figure a clock bar
    expect(hasClock(a.figure)).toBe(true);
    a.clock.seek(Math.PI);
    const P = a.value('P') as space.V3;
    expect(P.x).toBeCloseTo(-2, 9);
    expect(P.z).toBeCloseTo(Math.PI / 4, 9);
    const pts = sceneOf3(a.figure, space.viewAt(a.figure)).items.filter((i): i is PointItem => i.k === 'point');
    expect(pts[0]?.p.x).toBeCloseTo(-2, 9);
    const trail = (a.figure.get('trail')?.cell as { value: space.Curve3 }).value;
    expect(trail.hi).toBeCloseTo(Math.PI + 0.001, 9);
  });

  it('an animated slider and state() drive a solid in space', () => {
    const a = createHeadlessApp({ mode: 'graphing3d', script: 'h = 1 in 1..3\nh with loop = bounce, period = 4\nAnimate(h)\nk = Cube((0, 0, 0), (h, 0, 0), (0, 1, 0))\nst = state(0)\nst\' = 1\nR = (st, 0, 0)' });
    expect(a.figure.get('k')?.type).toBe('Polyhedron');
    expect(a.figure.get('R')?.type).toBe('Point3');
    expect(hasClock(a.figure)).toBe(true);
  });

  it('the export at a time shows the figure at that time', async () => {
    const a = createHeadlessApp({ mode: 'graphing3d', script: 'P = (2 * cos(t), 2 * sin(t), 0)' });
    const r0 = await a.export({ format: 'svg', width: 300, height: 200, t: 0 });
    const r1 = await a.export({ format: 'svg', width: 300, height: 200, t: 2 });
    if (!r0.ok || !r1.ok) throw new Error('export failed');
    expect(r1.text).not.toBe(r0.text);
    expect(a.clock.t).toBe(0);
  });
});
