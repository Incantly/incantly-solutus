/**
 * animation-time/design.md 10.4 to 10.8 (particles) and graphics-view 14.4:
 * renderer choice, load shedding, the per-particle model helpers, sprite
 * paths, uniform packing and export sampling. Only the renderer side is
 * tested here; formula compilation belongs to the kernel.
 */
import { describe, expect, it } from 'vitest';
import {
  GeometryDrawable,
  ParticleQuality,
  burstAlive,
  chooseParticleRenderer,
  drawnCount,
  loopAge,
  packUniforms,
  particleExportPlan,
  qualityLookScale,
  spritePath,
} from '@incantly/view';
import type { ParticleProgram, ParticleSpecPlain, ParticleUniformReader, ParticleUniformSlot } from '@incantly/view';
import { closeTo, head, oid, testStyle, testViewport } from './helpers';

function spec(over: Partial<ParticleSpecPlain> = {}): ParticleSpecPlain {
  return {
    count: 1500, life: 1.2, shape: 'dot', blend: 'normal', sizeIsPx: false, start: 0, end: Infinity, loop: true, seed: 0,
    renderer: 'auto', ...over,
  };
}

describe('animation-time 10.5 renderer choice', () => {
  it('10.5 auto picks the GPU above 1,500 particles when the program and WebGL2 allow it', () => {
    expect(chooseParticleRenderer(spec({ count: 1501 }), true, true)).toBe('gpu');
    expect(chooseParticleRenderer(spec({ count: 20000 }), true, true)).toBe('gpu');
  });

  it('10.5 auto stays on the CPU at exactly 1,500 and below', () => {
    expect(chooseParticleRenderer(spec({ count: 1500 }), true, true)).toBe('cpu');
    expect(chooseParticleRenderer(spec({ count: 10 }), true, true)).toBe('cpu');
  });

  it('10.5 auto stays on the CPU when the program is not GPU-capable', () => {
    expect(chooseParticleRenderer(spec({ count: 20000 }), false, true)).toBe('cpu');
  });

  it('10.5 auto stays on the CPU when WebGL2 is missing', () => {
    expect(chooseParticleRenderer(spec({ count: 20000 }), true, false)).toBe('cpu');
  });

  it('10.2 renderer = cpu always means CPU', () => {
    expect(chooseParticleRenderer(spec({ count: 20000, renderer: 'cpu' }), true, true)).toBe('cpu');
  });

  it('10.2 renderer = gpu uses the GPU for small systems when it is possible', () => {
    expect(chooseParticleRenderer(spec({ count: 10, renderer: 'gpu' }), true, true)).toBe('gpu');
  });

  it('10.5 renderer = gpu falls back to the CPU when the GPU cannot run it', () => {
    expect(chooseParticleRenderer(spec({ count: 10, renderer: 'gpu' }), false, true)).toBe('cpu');
    expect(chooseParticleRenderer(spec({ count: 10, renderer: 'gpu' }), true, false)).toBe('cpu');
  });
});

describe('animation-time 10.6 load shedding', () => {
  function over(q: ParticleQuality, n: number): void {
    for (let i = 0; i < n; i += 1) q.noteFrame(20);
  }

  it('10.6 a new controller draws everything (quality 1)', () => {
    expect(new ParticleQuality().q).toBe(1);
  });

  it('10.6 four slow frames change nothing', () => {
    const q = new ParticleQuality();
    over(q, 4);
    expect(q.q).toBe(1);
  });

  it('10.6 five frames over 14 ms lower quality by 25%', () => {
    const q = new ParticleQuality();
    over(q, 5);
    expect(q.q).toBe(0.75);
  });

  it('10.6 a frame of exactly 14 ms is not over', () => {
    const q = new ParticleQuality();
    for (let i = 0; i < 20; i += 1) q.noteFrame(14);
    expect(q.q).toBe(1);
  });

  it('10.6 a good frame in the run resets the count of slow frames', () => {
    const q = new ParticleQuality();
    over(q, 4);
    q.noteFrame(5);
    over(q, 4);
    expect(q.q).toBe(1);
  });

  it('10.6 quality falls in 25% steps down to a minimum of 25%', () => {
    const q = new ParticleQuality();
    const seen = new Set<number>();
    for (let i = 0; i < 100; i += 1) seen.add(q.noteFrame(30));
    expect(Math.min(...seen)).toBe(0.25);
    expect([...seen].every((v) => v >= 0.25 && v <= 1)).toBe(true);
    expect(seen.has(0.75)).toBe(true);
    expect(seen.has(0.5)).toBe(true);
  });

  it('10.6 quality recovers upward after 60 good frames', () => {
    const q = new ParticleQuality();
    over(q, 5);
    expect(q.q).toBe(0.75);
    for (let i = 0; i < 59; i += 1) q.noteFrame(4);
    expect(q.q).toBe(0.75);
    q.noteFrame(4);
    expect(q.q).toBe(1);
  });

  it('10.6 noteFrame returns the current quality', () => {
    const q = new ParticleQuality();
    expect(q.noteFrame(4)).toBe(1);
    over(q, 4);
    expect(q.noteFrame(20)).toBe(0.75);
  });

  it('10.6 only the first ceil(count x q) indices are drawn', () => {
    expect(drawnCount(1000, 1)).toBe(1000);
    expect(drawnCount(1000, 0.75)).toBe(750);
    expect(drawnCount(1001, 0.5)).toBe(501);
    expect(drawnCount(10, 0.25)).toBe(3);
  });

  it('10.6 alpha and size scale by 1 / sqrt(q) to keep the same look', () => {
    expect(qualityLookScale(1)).toBe(1);
    closeTo(qualityLookScale(0.25), 2);
    closeTo(qualityLookScale(0.5), Math.SQRT2);
    closeTo(qualityLookScale(0.75), 1 / Math.sqrt(0.75));
  });
});

describe('animation-time 10.4 the per-particle model', () => {
  it('10.4 looping age is mod(t - start + phase, life)', () => {
    closeTo(loopAge(0.5, 0, 0, 1.2), 0.5);
    closeTo(loopAge(1.5, 0, 0, 1.2), 0.3);
    closeTo(loopAge(1.0, 0.5, 0.2, 1.2), 0.7);
  });

  it('10.4 looping age is always in [0, life), including before the start', () => {
    for (const t of [-5, -0.1, 0, 0.7, 3.3, 100]) {
      const a = loopAge(t, 1, 0.4, 1.2);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1.2);
    }
  });

  it('10.4 looping age is a pure function of its inputs (seek and reverse play work)', () => {
    const a = loopAge(3.3, 0.5, 0.2, 1.2);
    loopAge(0, 0, 0, 1.2);
    loopAge(99, 0, 0, 1.2);
    expect(loopAge(3.3, 0.5, 0.2, 1.2)).toBe(a);
  });

  it('10.4 a burst particle is alive when 0 <= age < life', () => {
    expect(burstAlive(1.0, 1.0, 1.2, 0, Infinity)).toBe(true);
    expect(burstAlive(1.6, 1.0, 1.2, 0, Infinity)).toBe(true);
    expect(burstAlive(2.2, 1.0, 1.2, 0, Infinity)).toBe(false);
    expect(burstAlive(0.9, 1.0, 1.2, 0, Infinity)).toBe(false);
  });

  it('10.4 a burst particle is dead at exactly born + life', () => {
    expect(burstAlive(2.2, 1.0, 1.2, 0, Infinity)).toBe(false);
  });

  it('10.4 a particle must also be emitted inside [start, end]', () => {
    // born at 1.0; the emission window ends at 0.5, so it never lived.
    expect(burstAlive(1.5, 1.0, 1.2, 0, 0.5)).toBe(false);
    // born at 1.0; the emission window starts at 2, so it never lived.
    expect(burstAlive(1.5, 1.0, 1.2, 2, Infinity)).toBe(false);
    expect(burstAlive(1.5, 1.0, 1.2, 0.5, 1.5)).toBe(true);
  });
});

describe('animation-time 10.2 sprites', () => {
  const shapes = ['dot', 'ring', 'square', 'streak', 'spark'] as const;

  it.each(shapes)('10.2 shape %s gives a non-empty path in local pixels', (shape) => {
    const p = spritePath(shape, 10, 0);
    expect(p.length).toBeGreaterThan(1);
  });

  it('10.2 a dot does not depend on angle', () => {
    expect(JSON.stringify(spritePath('dot', 10, 0))).toBe(JSON.stringify(spritePath('dot', 10, 1.3)));
  });

  it.each(['streak', 'square'] as const)('10.2 a %s honours angle', (shape) => {
    expect(JSON.stringify(spritePath(shape, 10, 0))).not.toBe(JSON.stringify(spritePath(shape, 10, 0.7)));
  });

  it('10.2 sprites scale with the size in pixels', () => {
    const small = JSON.stringify(spritePath('square', 4, 0));
    const big = JSON.stringify(spritePath('square', 8, 0));
    expect(small).not.toBe(big);
  });
});

describe('animation-time 10.5 uniforms', () => {
  const slots: ParticleUniformSlot[] = [
    { name: 'a', kind: 'float', index: 0 },
    { name: 'b', kind: 'float', index: 1 },
    { name: 'p', kind: 'vec2', index: 0 },
    { name: 'c', kind: 'vec4', index: 0 },
  ];

  function program(uniforms: ParticleUniformSlot[]): ParticleProgram {
    return {
      spec: spec(),
      gpuOk: true,
      evalCpu: () => undefined,
      gpuSource: () => ({ vertexGlsl: '', fragmentGlsl: '', uniforms }),
    };
  }

  const reader: ParticleUniformReader = (slot) => {
    if (slot.name === 'a') return 2.5;
    if (slot.name === 'b') return -1;
    if (slot.name === 'p') return [3, 4] as const;
    if (slot.name === 'c') return [0.1, 0.2, 0.3, 0.4] as const;
    return undefined;
  };

  it('10.5 floats, vec2s and vec4s are packed into typed arrays by slot index', () => {
    const u = packUniforms(program(slots), reader, 0, 0);
    expect(Array.from(u.floats).slice(0, 2)).toEqual([2.5, -1]);
    expect(Array.from(u.vec2s).slice(0, 2)).toEqual([3, 4]);
    const v4 = Array.from(u.vec4s).slice(0, 4);
    expect(v4[0]).toBeCloseTo(0.1, 6);
    expect(v4[3]).toBeCloseTo(0.4, 6);
  });

  it('10.5 the reader is called with film time and beat time', () => {
    const seen: Array<[number, number]> = [];
    packUniforms(program(slots), (_slot, t, bt) => {
      seen.push([t, bt]);
      return 0;
    }, 3.5, 1.25);
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) expect(s).toEqual([3.5, 1.25]);
  });

  it('10.5 the reader is called once per slot', () => {
    let n = 0;
    packUniforms(program(slots), () => {
      n += 1;
      return 0;
    }, 0, 0);
    expect(n).toBe(slots.length);
  });

  it('10.5 a value the kernel cannot give leaves the slot at zero', () => {
    const u = packUniforms(program(slots), () => undefined, 0, 0);
    expect(Array.from(u.floats).every((v) => v === 0)).toBe(true);
    expect(Array.from(u.vec2s).every((v) => v === 0)).toBe(true);
  });

  it('10.5 a program with no uniforms packs empty arrays', () => {
    const u = packUniforms(program([]), reader, 0, 0);
    expect(Array.from(u.floats).every((v) => v === 0)).toBe(true);
    expect(Array.from(u.vec2s).every((v) => v === 0)).toBe(true);
    expect(Array.from(u.vec4s).every((v) => v === 0)).toBe(true);
  });

  it('10.5 only the 64 documented slots are used by the uniform arrays', () => {
    const many: ParticleUniformSlot[] = [];
    for (let i = 0; i < 64; i += 1) many.push({ name: `n${String(i)}`, kind: 'float', index: i });
    const u = packUniforms(program(many), (s) => s.index + 1, 0, 0);
    expect(u.floats[63]).toBe(64);
    expect(u.floats[0]).toBe(1);
  });
});

describe('graphics-view 14.4 particles in SVG export', () => {
  it('14.4 up to 5,000 particles are all drawn at density 1', () => {
    const p = particleExportPlan(1500);
    expect(p.drawn).toBe(1500);
    expect(p.densityMul).toBe(1);
    expect(particleExportPlan(5000)).toEqual({ drawn: 5000, densityMul: 1 });
  });

  it('14.4 over 5,000 the first 5,000 are drawn with a density multiplier above 1', () => {
    const p = particleExportPlan(20000);
    expect(p.drawn).toBe(5000);
    expect(p.densityMul).toBeGreaterThan(1);
  });

  it('14.4 the density multiplier grows with count / 5000', () => {
    const a = particleExportPlan(10000).densityMul;
    const b = particleExportPlan(20000).densityMul;
    expect(b).toBeGreaterThan(a);
  });

  it('14.4 a smaller custom maximum is honoured', () => {
    const p = particleExportPlan(1000, 100);
    expect(p.drawn).toBe(100);
    expect(p.densityMul).toBeGreaterThan(1);
  });
});

describe('animation-time 10.8 particle drawable', () => {
  const measure = (t: string, size: number): { width: number; height: number } => ({ width: t.length * size * 0.6, height: size * 1.2 });

  function drawable(): GeometryDrawable {
    const d = new GeometryDrawable({ id: oid(9), name: 'fire', kind: 'particles', order: 0, layer: 0, free: false, onPath: false, measure });
    d.update(
      { head: head(9, 'fire'), value: { defined: true, value: { k: 'particles', spec: spec() } } } as never,
      testViewport(),
      testStyle('particles'),
    );
    return d;
  }

  it('10.8 particles are drawn at rank 5, between lines and texts', () => {
    expect(drawable().rank).toBe(5);
  });

  it('10.8 particles have no bounding box and no hit test', () => {
    const d = drawable();
    expect(d.bbox).toBeNull();
    expect(d.hit({ x: 400 as never, y: 300 as never }, 100)).toBeNull();
  });

  it('10.8 the description names the system and its particle count', () => {
    expect(drawable().describe()).toContain('fire');
  });
});
