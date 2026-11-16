/**
 * Particles (animation-time design 10): one `Particles(...)` line for a fire, rain or stars.
 *
 * A particle is a pure function of its index `i` and the film time `t` (10.4): no state is kept per particle, so seeking,
 * reverse play and export need nothing special. The random numbers come from an integer hash that the GLSL program
 * repeats exactly, so the CPU and GPU paths agree.
 *
 * The object's value carries the plain spec the view draws with and the program that fills a batch (CPU) or gives
 * shader sources (GPU): the `ParticleProgram` contract of `packages/view/src/contracts.ts`.
 */
import type { Notice } from '../../contracts/errors';
import { makeNotice } from '../../errors/notices';
import type { CommandRule, RuleCall } from '../../graph/registry';
import type { CompiledArg } from '../../language/compile';
import type { Env } from '../../language/runtime';
import type { CommandSpec, ParamSpec } from '../../language/table';
import type { TArg, TNode } from '../../language/tnode';

/* ------------------------------ limits and names ------------------------------ */

export const MAX_PARTICLES_PER_SYSTEM = 20000;
export const MAX_PARTICLES_PER_FIGURE = 50000;
export const MAX_UNIFORMS = 64;

/** The names a particle formula sees besides the figure's objects (10.3). */
export const PARTICLE_NAMES = ['i', 'n', 'u', 'v', 'w', 'cycle', 'age', 'life', 'ph'] as const;
/** The particle-only names a line outside `Particles` is told about (errors 2). */
export const PARTICLE_ONLY_NAMES: ReadonlySet<string> = new Set(['u', 'v', 'w', 'age', 'ph', 'cycle']);

export const SHAPES = ['dot', 'ring', 'square', 'streak', 'spark'] as const;
export const BLENDS = ['normal', 'add'] as const;
export const RENDERERS = ['auto', 'cpu', 'gpu'] as const;
/** What `size` is measured in: maths units (it scales with zoom) or screen pixels (`size = px(4)`). */
export const SIZE_UNITS = ['units', 'px'] as const;

type Shape = (typeof SHAPES)[number];
type Blend = (typeof BLENDS)[number];
type Renderer = (typeof RENDERERS)[number];

/** The parameters, with whether they are required (10.2). */
export const PARTICLE_PARAMS: Readonly<Record<string, { readonly required: boolean }>> = {
  count: { required: true },
  life: { required: true },
  pos: { required: true },
  color: { required: false },
  size: { required: false },
  alpha: { required: false },
  angle: { required: false },
  shape: { required: false },
  blend: { required: false },
  start: { required: false },
  end: { required: false },
  loop: { required: false },
  seed: { required: false },
  layer: { required: false },
  renderer: { required: false },
  sizeUnit: { required: false },
};

/* ------------------------------ the shared hash ------------------------------ */

/** A 32-bit integer mixing hash of four integers; the GLSL program has the same one (`ihash4`). */
export function hash4(a: number, b: number, c: number, d: number): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15) ^ (b | 0), 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13) ^ (c | 0), 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 16) ^ (d | 0), 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

/** A number in [0, 1) from the hash. */
export function unit4(a: number, b: number, c: number, d: number): number {
  return hash4(a, b, c, d) / 4294967296;
}

/* ------------------------------ the per-particle model ------------------------------ */

export interface ParticleSpecPlain {
  readonly count: number;
  readonly life: number;
  readonly shape: Shape;
  readonly blend: Blend;
  readonly sizeIsPx: boolean;
  /** Draw layer 0..9, as other objects (10.2). */
  readonly layer?: number;
  readonly start: number;
  readonly end: number;
  readonly loop: boolean;
  readonly seed: number;
  readonly renderer: Renderer;
}

/** Where particle `i` is in its life at film time `t` (10.4), or `undefined` when it is not alive. */
export function particleClock(spec: ParticleSpecPlain, i: number, t: number): { age: number; cycle: number } | undefined {
  const { life, start, end, seed } = spec;
  let age: number;
  let cycle: number;
  if (spec.loop) {
    const phase = life * unit4(i, 0, seed, 0);
    const s = t - start + phase;
    cycle = Math.floor(s / life);
    age = s - cycle * life;
    if (s < phase) return undefined;
  } else {
    const born = start + life * unit4(i, 0, seed, 4);
    age = t - born;
    cycle = 0;
    if (!(age >= 0 && age < life)) return undefined;
  }
  const emitted = t - age;
  if (emitted < start - 1e-12 || emitted > end) return undefined;
  return { age, cycle };
}

/* ------------------------------ the value ------------------------------ */

export interface ParticleBatchPlain {
  readonly count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly size: Float32Array;
  readonly alpha: Float32Array;
  /** Packed `0xRRGGBBAA`. */
  readonly rgba: Uint32Array;
  readonly angle: Float32Array;
  /** The third coordinate, for particles in space (`pos = (x, y, z)`; .kiro/specs/space-3d-surfaces R3.2). */
  readonly z?: Float32Array;
}

export interface ParticleUniformSlot {
  readonly name: string;
  readonly kind: 'float' | 'vec2' | 'vec4';
  readonly index: number;
}

export interface ParticleShaderSource {
  readonly vertexGlsl: string;
  readonly fragmentGlsl: string;
  readonly uniforms: readonly ParticleUniformSlot[];
}

export interface ParticleProgram {
  readonly spec: ParticleSpecPlain;
  readonly gpuOk: boolean;
  readonly gpuReason?: string;
  evalCpu(t: number, bt: number, out: ParticleBatchPlain): void;
  gpuSource(): ParticleShaderSource;
}

/** A `Particles` object's value. */
export interface ParticlesValue {
  readonly kind: 'particles';
  readonly spec: ParticleSpecPlain;
  readonly program: ParticleProgram;
  /** True when `pos` is a point in space: the Space view draws them, on the CPU. */
  readonly space?: boolean;
}

export function isParticlesValue(v: unknown): v is ParticlesValue {
  return typeof v === 'object' && v !== null && (v as { kind?: unknown }).kind === 'particles';
}

/** A batch sized for `count` particles. */
export function makeParticleBatch(count: number, inSpace = false): ParticleBatchPlain {
  return {
    ...(inSpace ? { z: new Float32Array(count) } : {}),
    count,
    x: new Float32Array(count),
    y: new Float32Array(count),
    size: new Float32Array(count),
    alpha: new Float32Array(count),
    rgba: new Uint32Array(count),
    angle: new Float32Array(count),
  };
}

/* ------------------------------ the CPU program ------------------------------ */

interface Body {
  readonly fn: (env: Env) => unknown;
  readonly slots: ReadonlyMap<string, number>;
  readonly tree: TNode | undefined;
}

function packColor(c: unknown): number {
  const o = c as { r?: number; g?: number; b?: number; a?: number } | undefined;
  if (typeof o?.r !== 'number' || typeof o.g !== 'number' || typeof o.b !== 'number') return 0x000000ff;
  const ch = (x: number): number => Math.max(0, Math.min(255, Math.round(x)));
  const a = typeof o.a === 'number' ? o.a : 1;
  return ((ch(o.r) << 24) | (ch(o.g) << 16) | (ch(o.b) << 8) | ch(a * 255)) >>> 0;
}

function makeProgram(spec: ParticleSpecPlain, env: Env, bodies: Readonly<Record<string, Body | undefined>>): ParticleProgram {
  const gpu = compileGpu(spec, bodies);
  const all = Object.values(bodies).filter((b): b is Body => b !== undefined);
  const maxSlot = Math.max(-1, ...all.flatMap((b) => [...b.slots.values()]));
  // each formula's local slots for the particle names, in the fixed order of PARTICLE_NAMES (-1 when it has none)
  const slotsOf = (b: Body | undefined): Int32Array | undefined => (b ? Int32Array.from(PARTICLE_NAMES, (n) => b.slots.get(n) ?? -1) : undefined);
  const posB = bodies['pos'] as Body;
  const sizeB = bodies['size'];
  const alphaB = bodies['alpha'];
  const angleB = bodies['angle'];
  const colorB = bodies['color'];
  const sPos = slotsOf(posB) as Int32Array;
  const sSize = slotsOf(sizeB);
  const sAlpha = slotsOf(alphaB);
  const sAngle = slotsOf(angleB);
  const sColor = slotsOf(colorB);
  const pv = new Float64Array(PARTICLE_NAMES.length);
  const locals = env.locals;
  const put = (slots: Int32Array): void => {
    for (let k = 0; k < slots.length; k++) {
      const sl = slots[k] as number;
      if (sl >= 0) locals[sl] = pv[k] as number;
    }
  };
  const num = (fn: (env: Env) => unknown): number => {
    env.reason = undefined;
    const v = fn(env);
    return typeof v === 'number' && v - v === 0 ? v : Number.NaN;
  };
  return {
    spec,
    gpuOk: gpu.ok,
    ...(gpu.ok ? {} : { gpuReason: gpu.reason }),
    evalCpu(t, bt, out) {
      const saved = { t: env.t, bt: env.bt, reason: env.reason, cause: env.cause, detail: env.detail };
      const savedLocals = locals.slice();
      while (locals.length <= maxSlot) locals.push(0);
      env.t = t;
      env.bt = bt;
      const { life, seed, count, loop, start, end } = spec;
      try {
        const n = Math.min(out.count, count);
        for (let i = 0; i < n; i++) {
          // the particle's clock (design 10.4), as in particleClock, without an object per particle
          let age: number;
          let cycle: number;
          let alive = true;
          if (loop) {
            const phase = life * unit4(i, 0, seed, 0);
            const st = t - start + phase;
            cycle = Math.floor(st / life);
            age = st - cycle * life;
            if (st < phase) alive = false;
          } else {
            age = t - (start + life * unit4(i, 0, seed, 4));
            cycle = 0;
            if (!(age >= 0 && age < life)) alive = false;
          }
          const emitted = t - age;
          if (!alive || emitted < start - 1e-12 || emitted > end) {
            out.alpha[i] = 0;
            out.size[i] = 0;
            continue;
          }
          // i n u v w cycle age life ph
          pv[0] = i;
          pv[1] = count;
          pv[2] = unit4(i, cycle, seed, 1);
          pv[3] = unit4(i, cycle, seed, 2);
          pv[4] = unit4(i, cycle, seed, 3);
          pv[5] = cycle;
          pv[6] = age;
          pv[7] = life;
          pv[8] = age / life;
          put(sPos);
          env.reason = undefined;
          const p = posB.fn(env) as { x?: number; y?: number; z?: number } | undefined;
          const x = p?.x;
          const y = p?.y;
          if (out.z) {
            const z = p?.z;
            out.z[i] = typeof z === 'number' ? z : Number.NaN;
          }
          if (typeof x !== 'number' || typeof y !== 'number' || x - x !== 0 || y - y !== 0) {
            out.alpha[i] = 0;
            out.size[i] = 0;
            continue;
          }
          out.x[i] = x;
          out.y[i] = y;
          let size = 0.05;
          if (sizeB) {
            put(sSize as Int32Array);
            size = num(sizeB.fn);
          }
          let alpha = 1;
          if (alphaB) {
            put(sAlpha as Int32Array);
            alpha = num(alphaB.fn);
          }
          out.size[i] = size > 0 ? size : 0;
          out.alpha[i] = alpha > 0 ? (alpha < 1 ? alpha : 1) : 0;
          if (angleB) {
            put(sAngle as Int32Array);
            out.angle[i] = num(angleB.fn) || 0;
          } else out.angle[i] = 0;
          if (colorB) {
            put(sColor as Int32Array);
            env.reason = undefined;
            out.rgba[i] = packColor(colorB.fn(env));
          } else out.rgba[i] = 0x000000ff;
        }
        for (let i = n; i < out.count; i++) {
          out.alpha[i] = 0;
          out.size[i] = 0;
        }
      } finally {
        env.t = saved.t;
        env.bt = saved.bt;
        env.reason = saved.reason;
        env.cause = saved.cause;
        env.detail = saved.detail;
        for (let k = 0; k < savedLocals.length; k++) locals[k] = savedLocals[k];
      }
    },
    gpuSource() {
      return gpu.ok ? gpu.source : { vertexGlsl: '', fragmentGlsl: '', uniforms: [] };
    },
  };
}

/* ------------------------------ the GLSL program ------------------------------ */

const GLSL_FUNCS: Readonly<Record<string, string>> = {
  sin: 'sin', cos: 'cos', tan: 'tan', asin: 'asin', acos: 'acos', atan: 'atan', sinh: 'sinh', cosh: 'cosh', tanh: 'tanh',
  sqrt: 'sqrt', exp: 'exp', abs: 'abs', sign: 'sign', floor: 'floor', ceil: 'ceil', min: 'min', max: 'max', clamp: 'clamp',
  fract: 'p_fract', round: 'p_round', ln: 'log', log2: 'log2', log10: 'p_log10', atan2: 'atan', hypot: 'p_hypot',
  cbrt: 'p_cbrt', mod: 'p_mod', lerp: 'mix', step: 'step', smooth: 'smoothstep', wrap: 'p_wrap', pingpong: 'p_pingpong',
  ramp: 'p_ramp', ease: 'p_ease', rand: 'p_rand', noise: 'p_noise', rgb: 'p_rgb', hsl: 'p_hsl',
};

const GLSL_PRELUDE = `#version 300 es
precision highp float;
precision highp int;
uint ihash4(uint a, uint b, uint c, uint d) {
  uint h = (a ^ 0x9e3779b9u) * 0x85ebca6bu;
  h = (h ^ (h >> 15) ^ b) * 0xc2b2ae35u;
  h = (h ^ (h >> 13) ^ c) * 0x27d4eb2fu;
  h = (h ^ (h >> 16) ^ d) * 0x165667b1u;
  h ^= h >> 15;
  h *= 0x85ebca6bu;
  h ^= h >> 13;
  return h;
}
float unit4(uint a, uint b, uint c, uint d) { return float(ihash4(a, b, c, d)) / 4294967296.0; }
float p_fract(float x) { return x - trunc(x); }
float p_round(float x) { return floor(x + 0.5); }
float p_log10(float x) { return log(x) / 2.302585092994046; }
float p_hypot(float a, float b) { return sqrt(a * a + b * b); }
float p_cbrt(float x) { return sign(x) * pow(abs(x), 1.0 / 3.0); }
float p_mod(float a, float b) { return a - b * floor(a / b); }
float p_wrap(float x, float a, float b) { return a + p_mod(x - a, b - a); }
float p_pingpong(float x, float len) { float m = p_mod(x, 2.0 * len); return m <= len ? m : 2.0 * len - m; }
float p_ramp(float x, float a, float b) { return clamp((x - a) / (b - a), 0.0, 1.0); }
float p_ease(float x) { float s = clamp(x, 0.0, 1.0); return s * s * (3.0 - 2.0 * s); }
float p_rand(float s) { return unit4(floatBitsToUint(s), 7u, 11u, 13u); }
float p_noise(float x, float y) {
  vec2 i = floor(vec2(x, y)); vec2 f = fract(vec2(x, y)); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = unit4(uint(int(i.x)), uint(int(i.y)), 1u, 0u), b = unit4(uint(int(i.x) + 1), uint(int(i.y)), 1u, 0u);
  float c = unit4(uint(int(i.x)), uint(int(i.y) + 1), 1u, 0u), d = unit4(uint(int(i.x) + 1), uint(int(i.y) + 1), 1u, 0u);
  return 2.0 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y) - 1.0;
}
float p_noise(float x) { return p_noise(x, 0.5731); }
vec4 p_rgb(float r, float g, float b) { return vec4(clamp(vec3(r, g, b) / 255.0, 0.0, 1.0), 1.0); }
vec4 p_rgb(float r, float g, float b, float a) { return vec4(clamp(vec3(r, g, b) / 255.0, 0.0, 1.0), clamp(a, 0.0, 1.0)); }
vec4 p_hsl(float h, float s, float l) {
  vec3 k = mod(vec3(0.0, 8.0, 4.0) + p_mod(h, 360.0) / 30.0, 12.0);
  float a = s * min(l, 1.0 - l);
  return vec4(l - a * max(-1.0, min(min(k - 3.0, 9.0 - k), 1.0)), 1.0);
}
`;

const PARTICLE_FRAGMENT = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  if (dot(d, d) > 0.25) discard;
  outColor = v_color;
}
`;

class Unsupported extends Error {}

/** Compiles a formula tree to a GLSL expression, adding the figure values it reads as uniforms. */
class GlslEmitter {
  readonly uniforms: ParticleUniformSlot[] = [];
  private readonly byName = new Map<string, ParticleUniformSlot>();
  private readonly counts = { float: 0, vec2: 0, vec4: 0 };

  constructor(private readonly locals: ReadonlyMap<number, string>) {}

  private uniform(name: string, kind: ParticleUniformSlot['kind']): string {
    let u = this.byName.get(name);
    if (!u) {
      if (this.uniforms.length >= MAX_UNIFORMS) throw new Unsupported('too_many_inputs');
      u = { name, kind, index: this.counts[kind]++ };
      this.byName.set(name, u);
      this.uniforms.push(u);
    }
    return kind === 'float' ? `u_f[${u.index}]` : kind === 'vec2' ? `u_v2[${u.index}]` : `u_v4[${u.index}]`;
  }

  emit(n: TNode): string {
    switch (n.n) {
      case 'num':
        return Number.isInteger(n.v) ? `${n.v}.0` : String(n.v);
      case 'bool':
        return n.v ? 'true' : 'false';
      case 'const':
        if (typeof n.value === 'number') return String(n.value);
        throw new Unsupported('list');
      case 'clock':
        if (n.which === 't') return 'u_t';
        if (n.which === 'bt') return 'u_bt';
        throw new Unsupported('command');
      case 'local': {
        const name = this.locals.get(n.slot);
        if (!name) throw new Unsupported('command');
        return `p_${name}`;
      }
      case 'ref': {
        const k = n.ty.k;
        if (k === 'Number') return this.uniform(n.name, 'float');
        if (k === 'Point' || k === 'Vector') return this.uniform(n.name, 'vec2');
        if (k === 'Color') return this.uniform(n.name, 'vec4');
        throw new Unsupported('list');
      }
      case 'unary':
        if (n.op === 'not') return `(!${this.emit(n.arg)})`;
        return `(${n.op}${this.emit(n.arg)})`;
      case 'bin': {
        const l = this.emit(n.l);
        const r = this.emit(n.r);
        if (n.op === '^') return `pow(${l}, ${r})`;
        if (n.op === 'and') return `(${l} && ${r})`;
        if (n.op === 'or') return `(${l} || ${r})`;
        if (['+', '-', '*', '/'].includes(n.op)) return `(${l} ${n.op} ${r})`;
        throw new Unsupported('command');
      }
      case 'cmp': {
        const parts: string[] = [];
        for (let k = 0; k < n.ops.length; k++) {
          const op = n.ops[k] as string;
          parts.push(`(${this.emit(n.operands[k] as TNode)} ${op} ${this.emit(n.operands[k + 1] as TNode)})`);
        }
        return `(${parts.join(' && ')})`;
      }
      case 'point':
        return `vec2(${this.emit(n.x)}, ${this.emit(n.y)})`;
      case 'field':
        if (!n.args && (n.field === 'x' || n.field === 'y')) return `${this.emit(n.target)}.${n.field}`;
        throw new Unsupported('command');
      case 'cond': {
        let out = n.otherwise ? this.emit(n.otherwise) : '0.0';
        for (let k = n.arms.length - 1; k >= 0; k--) {
          const a = n.arms[k] as { c: TNode; v: TNode };
          out = `(${this.emit(a.c)} ? ${this.emit(a.v)} : ${out})`;
        }
        return out;
      }
      case 'command': {
        if (n.spec.name !== 'Gradient') throw new Unsupported('command:' + n.spec.name);
        {
          // an even ramp: each later colour mixes in over its own stretch of x, so one chain of mix() is the whole ramp
          const trees = n.args.map((a) => a.expr);
          if (trees.some((t) => t === undefined)) throw new Unsupported('command:Gradient');
          const x = this.emit(trees[0] as TNode);
          const cs = trees.slice(1).map((t) => this.emit(t as TNode));
          const s = `(clamp(${x}, 0.0, 1.0) * ${(cs.length - 1).toFixed(1)})`;
          let out = cs[0] as string;
          for (let k = 1; k < cs.length; k++) out = `mix(${out}, ${cs[k] as string}, clamp(${s} - ${(k - 1).toFixed(1)}, 0.0, 1.0))`;
          return out;
        }
      }
      case 'builtin': {
        const g = GLSL_FUNCS[n.spec.name];
        if (!g) throw new Unsupported('command:' + n.spec.name);
        return `${g}(${n.args.map((a) => this.emit(a)).join(', ')})`;
      }
      default:
        throw new Unsupported(n.n === 'list' || n.n === 'index' ? 'list' : 'command:' + n.n);
    }
  }
}

function compileGpu(spec: ParticleSpecPlain, bodies: Readonly<Record<string, Body | undefined>>): { ok: true; source: ParticleShaderSource } | { ok: false; reason: string } {
  try {
    const locals = new Map<number, string>();
    for (const b of Object.values(bodies)) if (b) for (const [name, slot] of b.slots) locals.set(slot, name);
    const em = new GlslEmitter(locals);
    const expr = (key: string, dflt: string): string => {
      const b = bodies[key];
      if (!b) return dflt;
      if (!b.tree) throw new Unsupported('command:notree:' + key);
      return em.emit(b.tree);
    };
    // a position in space has no GPU path here: the Space view's painter draws on the CPU
    if (bodies['pos']?.tree?.ty.k === 'Point3') throw new Unsupported('pos in space');
    const pos = expr('pos', 'vec2(0.0)');
    const size = expr('size', '0.05');
    const alpha = expr('alpha', '1.0');
    const color = expr('color', 'vec4(0.0, 0.0, 0.0, 1.0)');
    const nf = Math.max(1, em.uniforms.filter((u) => u.kind === 'float').length);
    const n2 = Math.max(1, em.uniforms.filter((u) => u.kind === 'vec2').length);
    const n4 = Math.max(1, em.uniforms.filter((u) => u.kind === 'vec4').length);
    const vertexGlsl = `${GLSL_PRELUDE}
uniform float u_t;
uniform float u_bt;
uniform mat3 u_view;
uniform float u_pxPerUnit;
uniform float u_quality;
uniform float u_f[${nf}];
uniform vec2 u_v2[${n2}];
uniform vec4 u_v4[${n4}];
const float u_life = ${spec.life.toFixed(9)};
const float u_start = ${Number.isFinite(spec.start) ? spec.start.toFixed(9) : '0.0'};
const float u_end = ${Number.isFinite(spec.end) ? spec.end.toFixed(9) : '3.4e38'};
const uint u_seed = ${(spec.seed >>> 0) >>> 0}u;
out vec4 v_color;
void main() {
  uint ui = uint(gl_InstanceID);
  float p_i = float(gl_InstanceID);
  float p_n = ${spec.count}.0;
  float p_life = u_life;
  float p_age; float p_cycle;
  bool alive = true;
${spec.loop
  ? `  float phase = u_life * unit4(ui, 0u, u_seed, 0u);
  float s = u_t - u_start + phase;
  p_cycle = floor(s / u_life);
  p_age = s - p_cycle * u_life;
  if (s < phase) alive = false;`
  : `  float born = u_start + u_life * unit4(ui, 0u, u_seed, 4u);
  p_age = u_t - born;
  p_cycle = 0.0;
  if (!(p_age >= 0.0 && p_age < u_life)) alive = false;`}
  if (u_t - p_age < u_start || u_t - p_age > u_end) alive = false;
  uint uc = uint(int(p_cycle));
  float p_u = unit4(ui, uc, u_seed, 1u);
  float p_v = unit4(ui, uc, u_seed, 2u);
  float p_w = unit4(ui, uc, u_seed, 3u);
  float p_ph = p_age / u_life;
  vec2 pos = ${pos};
  vec3 clip = u_view * vec3(pos, 1.0);
  gl_Position = alive ? vec4(clip.xy, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  float sz = max(0.0, ${size});
  gl_PointSize = ${spec.sizeIsPx ? 'sz' : 'sz * u_pxPerUnit'} * 2.0 / sqrt(u_quality);
  vec4 c = ${color};
  v_color = vec4(c.rgb, c.a * clamp(${alpha}, 0.0, 1.0) / sqrt(u_quality));
}
`;
    return { ok: true, source: { vertexGlsl, fragmentGlsl: PARTICLE_FRAGMENT, uniforms: em.uniforms } };
  } catch (e) {
    return { ok: false, reason: e instanceof Unsupported ? e.message : 'command' };
  }
}

/* ------------------------------ the command ------------------------------ */

const SCOPE = PARTICLE_NAMES.map((name) => ({ name, type: 'Number' }));
const body = (name: string, type: string, optional: boolean): ParamSpec => ({ name, type, kind: 'body', optional, scope: SCOPE });
const value = (name: string, type: string, optional: boolean): ParamSpec => ({ name, type, optional });

const PARAMS: readonly ParamSpec[] = [
  value('count', 'Number', false),
  value('life', 'Number', false),
  body('pos', 'Point|Point3', false),
  body('color', 'Color', true),
  body('size', 'Number', true),
  body('alpha', 'Number', true),
  body('angle', 'Number', true),
  value('shape', 'Text', true),
  value('blend', 'Text', true),
  value('start', 'Number', true),
  value('end', 'Number', true),
  value('loop', 'Bool', true),
  value('seed', 'Number', true),
  value('layer', 'Number', true),
  value('renderer', 'Text', true),
  value('sizeUnit', 'Text', true),
];

function particlesRule(bound: readonly TArg[]): CommandRule {
  const trees = new Map<string, TNode>();
  for (const a of bound) if (a.expr && (a.param.kind ?? 'value') === 'body') trees.set(a.param.name, a.expr);
  return {
    run(call: RuleCall) {
      const at = (name: string): number => PARAMS.findIndex((p) => p.name === name);
      const val = (name: string): unknown => call.values[at(name)];
      const count = val('count');
      const life = val('life');
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_PARTICLES_PER_SYSTEM) return call.fail('out_of_domain', `count must be a whole number from 1 to ${MAX_PARTICLES_PER_SYSTEM}`);
      if (typeof life !== 'number' || !(life > 0) || !Number.isFinite(life)) return call.fail('out_of_domain', 'life must be a number of seconds above 0');
      const word = <T extends string>(name: string, allowed: readonly T[], dflt: T): T => {
        const v = val(name);
        return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : dflt;
      };
      const numOr = (name: string, dflt: number): number => {
        const v = val(name);
        return typeof v === 'number' && !Number.isNaN(v) ? v : dflt;
      };
      const spec: ParticleSpecPlain = {
        count,
        life,
        shape: word('shape', SHAPES, 'dot'),
        blend: word('blend', BLENDS, 'normal'),
        sizeIsPx: word('sizeUnit', SIZE_UNITS, 'units') === 'px',
        layer: Math.min(9, Math.max(0, Math.trunc(numOr('layer', 0)))),
        start: numOr('start', 0),
        end: numOr('end', Number.POSITIVE_INFINITY),
        loop: val('loop') !== false,
        seed: Math.trunc(numOr('seed', 0)),
        renderer: word('renderer', RENDERERS, 'auto'),
      };
      const bodies: Record<string, Body | undefined> = {};
      call.args.forEach((a: CompiledArg) => {
        if ((a.param.kind ?? 'value') !== 'body' || a.omitted || !a.eval) return;
        bodies[a.param.name] = { fn: a.eval, slots: new Map((a.scopeSlots ?? []).map((s) => [s.name, s.slot])), tree: trees.get(a.param.name) };
      });
      if (!bodies['pos']) return call.fail('input_undefined', 'pos is required');
      const program = makeProgram(spec, call.env, bodies);
      if (!program.gpuOk && spec.renderer !== 'cpu' && count > 1500 && trees.get('pos')?.ty.k !== 'Point3') call.notify('gpu_unsupported', { name: '', reason: program.gpuReason ?? 'command' });
      const v: ParticlesValue = { kind: 'particles', spec, program, ...(trees.get('pos')?.ty.k === 'Point3' ? { space: true } : {}) };
      return v;
    },
  };
}

export const PARTICLES_SPEC: CommandSpec = {
  name: 'Particles',
  kind: 'object',
  group: 'animation',
  forms: [{ params: PARAMS, returns: 'Particles', summary: 'a system of small particles, each a pure function of its index and time', rule: (args) => particlesRule(args as readonly TArg[]) }],
};

/* ------------------------------ load shedding ------------------------------ */

/** Frame time above which a frame is slow, slow frames in a row before shedding, good frames before recovering (10.6). */
export const SHED_FRAME_MS = 14;
export const SHED_AFTER = 5;
export const RECOVER_AFTER = 60;
export const MIN_QUALITY = 0.25;

/**
 * The renderer's load shedding (design 10.6), kept pure so it is the same everywhere: the host reports each frame's total
 * time and draws `drawCount(count)` particles with alpha and size scaled by `scale()`. After 5 frames over 14 ms the
 * quality drops by a quarter (to at least 25%); after 60 good frames it rises by a quarter. Particles are independent, so
 * drawing the first indices only never changes the others. The clock and the kernel never slow down.
 */
export class ParticleShedder {
  private q = 1;
  private slow = 0;
  private good = 0;

  /** The share of particles drawn now, 0.25 to 1. */
  get quality(): number {
    return this.q;
  }

  /** Reports one frame; returns a `particle_shed` notice when the quality changed. */
  frame(frameMs: number, name = ''): Notice | undefined {
    if (typeof frameMs !== 'number' || !Number.isFinite(frameMs)) return undefined;
    if (frameMs > SHED_FRAME_MS) {
      this.slow++;
      this.good = 0;
      if (this.slow >= SHED_AFTER && this.q > MIN_QUALITY) {
        this.slow = 0;
        return this.set(Math.max(MIN_QUALITY, this.q - 0.25), name);
      }
      return undefined;
    }
    this.slow = 0;
    this.good++;
    if (this.good >= RECOVER_AFTER && this.q < 1) {
      this.good = 0;
      return this.set(Math.min(1, this.q + 0.25), name);
    }
    return undefined;
  }

  /** How many of `count` particles to draw: the first `ceil(count × q)` indices. */
  drawCount(count: number): number {
    return Math.min(count, Math.ceil(count * this.q));
  }

  /** The factor for alpha and size, `1 / sqrt(q)`, so fewer particles keep the same look. */
  scale(): number {
    return 1 / Math.sqrt(this.q);
  }

  private set(q: number, name: string): Notice {
    this.q = q;
    return makeNotice('particle_shed', { name, quality: `${Math.round(q * 100)}%` }, name ? [name] : []);
  }
}
