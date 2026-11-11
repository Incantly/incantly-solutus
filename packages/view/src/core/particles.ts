/**
 * GPU particle drawing (animation-time design 10.5-10.8, performance 5.4):
 * renderer choice, the load-shedding quality controller, CPU sprite paths for
 * the fallback, uniform packing and export sampling. Formula compilation is
 * the kernel's; this file draws what it hands over.
 */
import type { ParticleProgram, ParticleSpecPlain, ParticleUniformSlot } from '../contracts';
import type { PathCommand } from './surface';

export type ParticleRenderer = 'cpu' | 'gpu';

/**
 * `renderer = auto` chooses GPU when the program supports it, WebGL2 exists
 * and `count > 1500`; otherwise CPU (design 10.5).
 */
export function chooseParticleRenderer(spec: ParticleSpecPlain, gpuOk: boolean, gpuAvailable: boolean): ParticleRenderer {
  if (spec.renderer === 'cpu') return 'cpu';
  if (spec.renderer === 'gpu') return gpuOk && gpuAvailable ? 'gpu' : 'cpu';
  return gpuOk && gpuAvailable && spec.count > 1500 ? 'gpu' : 'cpu';
}

/**
 * Load shedding (design 10.6): past 14 ms for 5 frames, draw fewer particles
 * in 25% steps down to 25%; recover after 60 good frames. Pure frame counter;
 * the host passes measured frame times.
 */
export class ParticleQuality {
  private bad = 0;
  private good = 0;
  /** Fraction of indices drawn, 1 down to 0.25. */
  q = 1;

  noteFrame(frameMs: number): number {
    if (frameMs > 14) {
      this.bad++;
      this.good = 0;
      if (this.bad >= 5) {
        this.bad = 0;
        this.q = Math.max(0.25, this.q - 0.25);
      }
    } else {
      this.good++;
      this.bad = 0;
      if (this.good >= 60 && this.q < 1) {
        this.good = 0;
        this.q = Math.min(1, this.q + 0.25);
      }
    }
    return this.q;
  }
}

/** Indices drawn at quality `q`: the first `ceil(count * q)`. */
export function drawnCount(count: number, q: number): number {
  return Math.max(1, Math.ceil(count * q));
}

/** Look-preserving scale for alpha and size at quality `q`: `1 / sqrt(q)`. */
export function qualityLookScale(q: number): number {
  return 1 / Math.sqrt(Math.max(q, 0.25));
}

export type ParticleShape = ParticleSpecPlain['shape'];

/**
 * CPU sprite path in local pixels centred on the particle (for the Canvas2D
 * fallback and export). Streaks and squares honour `angle`.
 */
export function spritePath(shape: ParticleShape, sizePx: number, angle: number): PathCommand[] {
  const r = Math.max(sizePx, 0.5);
  switch (shape) {
    case 'dot':
      return [
        { k: 'M', x: r, y: 0 },
        { k: 'A', rx: r, ry: r, rot: 0, large: true, sweep: true, x: -r, y: 0 },
        { k: 'A', rx: r, ry: r, rot: 0, large: true, sweep: true, x: r, y: 0 },
        { k: 'Z' },
      ];
    case 'ring': {
      const w = Math.max(1, r * 0.35);
      return [
        { k: 'M', x: r, y: 0 },
        { k: 'A', rx: r, ry: r, rot: 0, large: true, sweep: true, x: -r, y: 0 },
        { k: 'A', rx: r, ry: r, rot: 0, large: true, sweep: true, x: r, y: 0 },
        { k: 'M', x: r - w, y: 0 },
        { k: 'A', rx: r - w, ry: r - w, rot: 0, large: true, sweep: false, x: -(r - w), y: 0 },
        { k: 'A', rx: r - w, ry: r - w, rot: 0, large: true, sweep: false, x: r - w, y: 0 },
        { k: 'Z' },
      ];
    }
    case 'square': {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const corners: Array<readonly [number, number]> = [[-r, -r], [r, -r], [r, r], [-r, r]];
      const pts = corners.map(([px, py]) => ({ x: px * c - py * s, y: px * s + py * c }));
      const first = pts[0] ?? { x: 0, y: 0 };
      return [
        { k: 'M', x: first.x, y: first.y },
        ...(pts.slice(1).map((p) => ({ k: 'L', x: p.x, y: p.y }) as const)),
        { k: 'Z' },
      ];
    }
    case 'streak': {
      const dx = Math.cos(angle) * r * 2;
      const dy = Math.sin(angle) * r * 2;
      return [
        { k: 'M', x: -dx, y: -dy },
        { k: 'L', x: dx, y: dy },
      ];
    }
    case 'spark':
      return [
        { k: 'M', x: -r * 2, y: 0 },
        { k: 'L', x: r * 2, y: 0 },
        { k: 'M', x: 0, y: -r * 2 },
        { k: 'L', x: 0, y: r * 2 },
      ];
  }
}

/**
 * Reads one uniform slot's current value from kernel values at film time.
 * Implemented by the integrator; the view calls it once per slot per frame.
 */
export type ParticleUniformReader = (
  slot: ParticleUniformSlot,
  t: number,
  bt: number,
) => number | readonly [number, number] | readonly [number, number, number, number] | undefined;

export interface PackedUniforms {
  readonly floats: Float32Array;
  readonly vec2s: Float32Array;
  readonly vec4s: Float32Array;
}

/** Pack uniform values into the typed arrays the GPU program consumes. */
export function packUniforms(
  program: ParticleProgram,
  read: ParticleUniformReader,
  t: number,
  bt: number,
): PackedUniforms {
  const src = program.gpuSource();
  let nf = 0;
  let n2 = 0;
  let n4 = 0;
  for (const u of src.uniforms) {
    if (u.kind === 'float') nf++;
    else if (u.kind === 'vec2') n2++;
    else n4++;
  }
  const floats = new Float32Array(nf);
  const vec2s = new Float32Array(n2 * 2);
  const vec4s = new Float32Array(n4 * 4);
  let fi = 0;
  let vi = 0;
  let qi = 0;
  for (const u of src.uniforms) {
    const v = read(u, t, bt);
    if (u.kind === 'float') {
      floats[fi++] = typeof v === 'number' ? v : 0;
    } else if (u.kind === 'vec2') {
      const pair = Array.isArray(v) && v.length >= 2 ? v : [0, 0];
      vec2s[vi++] = pair[0] ?? 0;
      vec2s[vi++] = pair[1] ?? 0;
    } else {
      const quad = Array.isArray(v) && v.length >= 4 ? v : [0, 0, 0, 0];
      vec4s[qi++] = quad[0] ?? 0;
      vec4s[qi++] = quad[1] ?? 0;
      vec4s[qi++] = quad[2] ?? 0;
      vec4s[qi++] = quad[3] ?? 0;
    }
  }
  return { floats, vec2s, vec4s };
}

/** SVG export: up to 5,000 elements with a density multiplier (design 14.4). */
export function particleExportPlan(count: number, max = 5000): { drawn: number; densityMul: number } {
  if (count <= max) return { drawn: count, densityMul: 1 };
  return { drawn: max, densityMul: count / max };
}

/** Particle age for a looping emitter: `mod(t - start + phase, life)`. */
export function loopAge(t: number, start: number, phase: number, life: number): number {
  if (!(life > 0)) return 0;
  const s = t - start + phase;
  return ((s % life) + life) % life;
}

/** Alive test for a burst emitter (loop = false). */
export function burstAlive(t: number, born: number, life: number, start: number, end: number): boolean {
  const age = t - born;
  if (!(age >= 0 && age < life)) return false;
  const emission = t - age;
  return emission >= start && emission <= end;
}
