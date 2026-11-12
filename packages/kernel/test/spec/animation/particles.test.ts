/**
 * Particles (design 10; errors 2 and 6): the command and its errors, the per-particle model, the CPU program, the GLSL
 * program and the limits.
 */
import { describe, expect, it } from 'vitest';
import { MAX_PARTICLES_PER_SYSTEM, hash4, isParticlesValue, makeParticleBatch, particleClock, unit4 } from '@incantly/kernel';
import type { Figure, ParticlesValue } from '@incantly/kernel';
import { bad, fig, ok } from './helpers';

const FIRE =
  'fire = Particles(count = 1500, life = 1.2, pos = (0.4 (u - 0.5) + 0.15 noise(i, 3 age), 2.2 age - 0.6 age^2), color = rgb(255, 120 + 100 (1 - ph), 30), size = 0.08 (1 - ph), alpha = 1 - ph, blend = add)';

function systemOf(f: Figure, name: string): ParticlesValue {
  const v = f.value(name);
  if (!isParticlesValue(v)) throw new Error(`${name} is not a particle system`);
  return v;
}

describe('10.1 and 10.2 the command', () => {
  it('the fire from the design is one line, with named parameters in any order', () => {
    const f = fig([FIRE]);
    const s = systemOf(f, 'fire');
    expect(s.spec).toMatchObject({ count: 1500, life: 1.2, blend: 'add', shape: 'dot', loop: true, seed: 0, start: 0, renderer: 'auto' });
    expect(f.get('fire')?.type).toBe('Particles');
  });
  it('words such as blend = add and shape = spark are values, not names', () => {
    const s = systemOf(fig(['sp = Particles(count = 10, life = 1, pos = (u, v), shape = spark, renderer = cpu)']), 'sp');
    expect(s.spec.shape).toBe('spark');
    expect(s.spec.renderer).toBe('cpu');
  });
  it('the formulas may read the figure: a slider moves the particles', () => {
    const f = fig(['v0 = 2', 'sp = Particles(count = 5, life = 1, pos = (v0 * age, 0))']);
    const b = makeParticleBatch(5);
    systemOf(f, 'sp').program.evalCpu(10.5, 0, b);
    const x0 = b.x[0] as number;
    ok(f.apply('SetValue(v0, 4)'));
    systemOf(f, 'sp').program.evalCpu(10.5, 0, b);
    expect(b.x[0]).toBeCloseTo(2 * x0, 5);
  });
});

describe('errors 2', () => {
  it('an unknown parameter is unknown_particle_param with the closest one', () => {
    const e = bad(fig().apply('p = Particles(count = 10, life = 1, pos = (u, age), colour = red)'), 'unknown_particle_param');
    expect(e.hint).toMatch(/color/);
  });
  it('a missing count, life or pos is missing_particle_param', () => {
    const e = bad(fig().apply('p = Particles(count = 10, life = 1)'), 'missing_particle_param');
    expect(e.message).toMatch(/pos/);
  });
  it(`count above ${MAX_PARTICLES_PER_SYSTEM}, a life of 0, or an unknown word is bad_particle_value`, () => {
    bad(fig().apply('p = Particles(count = 30000, life = 1, pos = (u, v))'), 'bad_particle_value');
    bad(fig().apply('p = Particles(count = 10, life = 0, pos = (u, v))'), 'bad_particle_value');
    bad(fig().apply('p = Particles(count = 10, life = 1, pos = (u, v), blend = glow)'), 'bad_particle_value');
  });
  it('a command inside a particle formula is particle_command', () => {
    bad(fig().apply('p = Particles(count = 10, life = 1, pos = Midpoint((0, 0), (u, v)))'), 'particle_command');
  });
  it('u, age, ph and cycle outside Particles are particle_name_outside, not unknown_name', () => {
    const e = bad(fig().apply('q = age + 1'), 'particle_name_outside');
    expect(e.hint).toMatch(/Particles/);
  });
  it('a name such as u that the figure defines is just that object', () => {
    const f = fig(['u = 3', 'q = u + 1']);
    expect(f.value('q')).toBe(4);
  });
  it('more than 50,000 particles in a figure is a limit error', () => {
    const f = fig(['a1 = Particles(count = 20000, life = 1, pos = (u, v))', 'a2 = Particles(count = 20000, life = 1, pos = (u, v))']);
    bad(f.apply('a3 = Particles(count = 20000, life = 1, pos = (u, v))'), 'limit');
  });
});

describe('10.4 the per-particle model', () => {
  it('the hash is integer-only and repeatable', () => {
    expect(hash4(1, 2, 3, 4)).toBe(hash4(1, 2, 3, 4));
    expect(hash4(1, 2, 3, 4)).not.toBe(hash4(1, 2, 3, 5));
    expect(Number.isInteger(hash4(7, 0, 0, 1))).toBe(true);
    const u = unit4(3, 1, 0, 1);
    expect(u >= 0 && u < 1).toBe(true);
  });
  it('a looping particle lives again and again: its age stays within its life', () => {
    const spec = { count: 10, life: 2, shape: 'dot', blend: 'normal', sizeIsPx: false, start: 0, end: Infinity, loop: true, seed: 0, renderer: 'auto' } as const;
    for (const t of [3, 7.3, 100]) {
      const c = particleClock(spec, 4, t);
      if (c) expect(c.age >= 0 && c.age < 2).toBe(true);
    }
  });
  it('a burst (loop = false) lives once', () => {
    const spec = { count: 10, life: 1, shape: 'dot', blend: 'normal', sizeIsPx: false, start: 0, end: Infinity, loop: false, seed: 0, renderer: 'auto' } as const;
    expect(particleClock(spec, 3, 5)).toBeUndefined();
  });
  it('nothing is emitted before start', () => {
    const spec = { count: 10, life: 1, shape: 'dot', blend: 'normal', sizeIsPx: false, start: 5, end: Infinity, loop: true, seed: 0, renderer: 'auto' } as const;
    for (let i = 0; i < 10; i++) expect(particleClock(spec, i, 2)).toBeUndefined();
  });
});

describe('10.5 the CPU program', () => {
  it('fills the batch; the same t gives the same batch (seek and replay are free)', () => {
    const s = systemOf(fig([FIRE]), 'fire');
    const a = makeParticleBatch(1500);
    const b = makeParticleBatch(1500);
    s.program.evalCpu(2.5, 0, a);
    s.program.evalCpu(7, 0, b);
    s.program.evalCpu(2.5, 0, b);
    expect(Array.from(b.x)).toEqual(Array.from(a.x));
    expect(Array.from(a.alpha).every((x) => x >= 0 && x <= 1)).toBe(true);
  });
  it('the colour is packed as 0xRRGGBBAA', () => {
    const s = systemOf(fig(['p = Particles(count = 3, life = 1, pos = (u, v), color = rgb(255, 0, 0))']), 'p');
    const b = makeParticleBatch(3);
    s.program.evalCpu(5, 0, b);
    expect(b.rgba[0]).toBe(0xff0000ff);
  });
  it('the CPU program leaves the figure as it was (t and the other values)', () => {
    const f = fig(['@clock 0..10', 'k = t', FIRE]);
    const before = f.value('k');
    systemOf(f, 'fire').program.evalCpu(5, 0, makeParticleBatch(1500));
    expect(f.value('k')).toBe(before);
    expect(f.clock().t).toBe(0);
  });
});

describe('10.5 the GLSL program', () => {
  it('a formula of built-ins can go to the GPU; figure values it reads become uniforms', () => {
    const s = systemOf(fig(['g = 9.8', 'sp = Particles(count = 400, life = 1.5, pos = (3 cos(0.9 + 0.2 (u - 0.5)) * age, 3 sin(0.9) * age - 0.5 * g * age^2), alpha = 1 - ph)']), 'sp');
    expect(s.program.gpuOk).toBe(true);
    const src = s.program.gpuSource();
    expect(src.vertexGlsl).toMatch(/^#version 300 es/);
    expect(src.vertexGlsl).toContain('ihash4');
    expect(src.uniforms).toEqual([{ name: 'g', kind: 'float', index: 0 }]);
    expect(src.fragmentGlsl).toMatch(/^#version 300 es/);
  });
  it('a formula that reads a list cannot go to the GPU, and says why', () => {
    const s = systemOf(fig(['L = [1, 2, 3]', 'sp = Particles(count = 10, life = 1, pos = (L[1] * u, v))']), 'sp');
    expect(s.program.gpuOk).toBe(false);
    expect(s.program.gpuReason).toBe('list');
  });
});
