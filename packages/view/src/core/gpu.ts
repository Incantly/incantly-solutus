/**
 * The one GPU interface the renderer is written against (performance 2.2,
 * space-3d 9.1): buffers, textures, programs, draw calls, scissor, viewport.
 * WebGL2 implements it now; WebGPU is a later second back-end behind the same
 * interface; a native GL/Metal surface and the SVG/PDF recorders share it.
 */
import { okResult, viewError } from '../errors';
import type { Result } from '@incantly/kernel';

export type BackendKind = 'webgl2' | 'webgpu' | 'software';

export interface GpuCapabilities {
  /** Float colour targets for WBOIT (`EXT_color_buffer_float`). */
  readonly floatTargets: boolean;
  readonly msaa: boolean;
  readonly instancing: boolean;
  readonly maxTextureSize: number;
}

export interface VertexAttribute {
  readonly name: string;
  /** Components (1-4). */
  readonly size: number;
}

export interface VertexLayout {
  readonly attributes: readonly VertexAttribute[];
  readonly strideBytes: number;
}

export interface Arena {
  readonly layout: VertexLayout;
  readonly capacityBytes: number;
  readonly usedBytes: number;
  /** Allocate a vertex range; -1 when full. */
  alloc(vertexCount: number): number;
  free(offsetVertices: number, vertexCount: number): void;
  writeVertices(offsetVertices: number, data: Float32Array): void;
  writeIndices(offsetIndices: number, data: Uint32Array): void;
  dispose(): void;
}

export interface TargetSpec {
  readonly width: number;
  readonly height: number;
  readonly samples: number;
  readonly depth: boolean;
  readonly float: boolean;
}

export interface Target {
  readonly spec: TargetSpec;
  dispose(): void;
}

export interface ShaderSrc {
  readonly vertex: string;
  readonly fragment: string;
  readonly uniforms: readonly string[];
}

export interface Program {
  dispose(): void;
}

export type DrawMode = 'triangles' | 'lines' | 'points' | 'instancedTriangles' | 'instancedQuads';

export interface Batch {
  readonly program: Program;
  readonly arena: Arena;
  readonly firstVertex: number;
  readonly vertexCount: number;
  readonly firstIndex: number;
  readonly indexCount: number;
  readonly mode: DrawMode;
  readonly instances: number;
  /** Uniform values by name; back-ends upload what the program declares. */
  readonly uniforms: Readonly<Record<string, number | Float32Array | readonly number[]>>;
  readonly scissor: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null;
  readonly depthTest: boolean;
  /** Depth comparison; `greater` drives the hidden-line pass (space-3d 9.3). */
  readonly depthFunc: 'less' | 'greater';
  readonly depthWrite: boolean;
  /** `premult`: the fragment holds premultiplied colour (the 2D board's tiles); `alpha`: straight colour. */
  readonly blend: 'none' | 'alpha' | 'add' | 'premult';
  /** Targets sampled by the program, by sampler name, bound to texture units 0, 1, … (the 2D board's tiles). */
  readonly textures?: Readonly<Record<string, Target>>;
  readonly cullBack: boolean;
}

export interface FrameSize {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

export interface FrameCtx {
  readonly target: Target;
  readonly size: FrameSize;
  dispose(): void;
}

export interface DrawStats {
  drawCalls: number;
  triangles: number;
  lines: number;
  points: number;
}

export function createDrawStats(): DrawStats {
  return { drawCalls: 0, triangles: 0, lines: 0, points: 0 };
}

/**
 * The small GPU interface we own. Back-ends never create canvases; the web
 * layer hands them a context (or a 2D context for the software target).
 */
export interface GpuBackend {
  readonly kind: BackendKind;
  readonly capabilities: GpuCapabilities;
  createArena(layout: VertexLayout, capacityBytes: number): Result<Arena>;
  createTarget(spec: TargetSpec): Result<Target>;
  createProgram(src: ShaderSrc): Result<Program>;
  beginFrame(target: Target, size: FrameSize): Result<FrameCtx>;
  draw(frame: FrameCtx, batch: Batch, stats: DrawStats): Result<void>;
  /** Set the viewport in device pixels. */
  setViewport(frame: FrameCtx, x: number, y: number, w: number, h: number): void;
  /** Pixels for PNG export; software and WebGL2 only. */
  readPixels?(target: Target, rect: { x: number; y: number; w: number; h: number }): Result<Uint8Array>;
  dispose(): void;
}

export type ProgramKey =
  | 'meshLit'
  | 'meshFlat'
  | 'lineQuad'
  | 'pointImpostor'
  | 'particle'
  | 'composite';

/** Shading language target: GLSL ES 3.00 now, WGSL when WebGPU lands. */
export type ShaderLanguage = 'glsl' | 'wgsl';

/**
 * Shaders written once in the tiny builder below, emitting GLSL ES 3.00 now
 * and WGSL later (space-3d 9.1). No `#ifdef` forests: one source per program.
 */
export function shaderSources(lang: ShaderLanguage): Result<Readonly<Record<ProgramKey, ShaderSrc>>> {
  if (lang === 'wgsl') {
    return viewError({
      kind: 'internal',
      messageKey: 'view.internal',
      params: { where: 'WebGPU shaders' },
      token: 'webgpu',
      hint: 'WebGPU is a later second back-end; WebGL 2 is the default.',
    });
  }
  return okResult({
    meshLit: {
      vertex: [
        '#version 300 es',
        'layout(location=0) in vec3 aPos;',
        'layout(location=1) in vec3 aNor;',
        'layout(location=2) in vec4 aCol;',
        'uniform mat4 uVp; uniform vec3 uOrigin;',
        'uniform vec4 uClipMin; uniform vec4 uClipMax;',
        'out vec3 vNor; out vec4 vCol; out vec3 vWorld; out float vClip;',
        'void main(){',
        ' vec3 world = aPos + uOrigin;',
        ' vWorld = world; vNor = aNor; vCol = aCol;',
        ' bvec3 lo = lessThan(world, uClipMin.xyz);',
        ' bvec3 hi = greaterThan(world, uClipMax.xyz);',
        ' vClip = (uClipMin.w > 0.5 && (any(lo) || any(hi))) ? 0.0 : 1.0;',
        ' gl_Position = uVp * vec4(world, 1.0);',
        '}',
      ].join('\n'),
      fragment: [
        '#version 300 es',
        'precision highp float;',
        'in vec3 vNor; in vec4 vCol; in vec3 vWorld; in float vClip;',
        'uniform vec3 uKeyDir; uniform vec3 uFillDir; uniform float uFlat; uniform float uAlpha;',
        'out vec4 oCol;',
        'void main(){',
        ' if (vClip < 0.5) discard;',
        ' vec3 n = normalize(vNor) * (gl_FrontFacing ? 1.0 : -1.0);',
        ' float side = gl_FrontFacing ? 1.0 : 0.85;',
        ' float dif = max(dot(n, -uKeyDir), 0.0) + 0.3 * max(dot(n, -uFillDir), 0.0);',
        ' vec3 v = vec3(0.0, 0.0, 1.0);',
        ' vec3 h = normalize(-uKeyDir + v);',
        ' float spec = pow(max(dot(n, h), 0.0), 24.0) * 0.12;',
        ' float shade = mix(0.35 + dif, 1.0, uFlat);',
        ' vec3 col = vCol.rgb * shade * side + spec * (1.0 - uFlat);',
        ' oCol = vec4(col, vCol.a * uAlpha);',
        '}',
      ].join('\n'),
      uniforms: ['uVp', 'uOrigin', 'uClipMin', 'uClipMax', 'uKeyDir', 'uFillDir', 'uFlat', 'uAlpha'],
    },
    meshFlat: {
      vertex: [
        '#version 300 es',
        'layout(location=0) in vec3 aPos;',
        'layout(location=2) in vec4 aCol;',
        'uniform mat4 uVp; uniform vec3 uOrigin;',
        'out vec4 vCol;',
        'void main(){ vCol = aCol; gl_Position = uVp * vec4(aPos + uOrigin, 1.0); }',
      ].join('\n'),
      fragment: [
        '#version 300 es',
        'precision highp float;',
        'in vec4 vCol; out vec4 oCol;',
        'void main(){ oCol = vCol; }',
      ].join('\n'),
      uniforms: ['uVp', 'uOrigin'],
    },
    lineQuad: {
      vertex: [
        '#version 300 es',
        'layout(location=0) in vec2 aEnd;',
        'layout(location=1) in vec2 aOther;',
        'layout(location=2) in float aSide;',
        'layout(location=3) in vec4 aCol;',
        'uniform mat4 uVp; uniform vec2 uViewport; uniform float uWidth; uniform float uDashOn; uniform float uDashOff; uniform float uDashPhase;',
        'out vec4 vCol; out vec2 vUv; out float vLen;',
        'void main(){',
        ' vec4 p0 = uVp * vec4(aEnd, 0.0, 1.0);',
        ' vec4 p1 = uVp * vec4(aOther, 0.0, 1.0);',
        ' vec2 s0 = (p0.xy / p0.w * 0.5 + 0.5) * uViewport;',
        ' vec2 s1 = (p1.xy / p1.w * 0.5 + 0.5) * uViewport;',
        ' vec2 dir = s1 - s0; float len = max(length(dir), 1e-6); dir /= len;',
        ' vec2 nrm = vec2(-dir.y, dir.x);',
        ' float w = uWidth * 0.5 + 1.0;',
        ' vec2 s = s0 + nrm * aSide * w;',
        ' vUv = vec2(0.0, aSide); vLen = len; vCol = aCol;',
        ' vec4 clip = vec4((s / uViewport * 2.0 - 1.0) * p0.w, 0.0, p0.w);',
        ' gl_Position = vec4(clip.xy, p0.z, p0.w);',
        '}',
      ].join('\n'),
      fragment: [
        '#version 300 es',
        'precision highp float;',
        'in vec4 vCol; in vec2 vUv; in float vLen;',
        'uniform float uWidth; uniform float uDashOn; uniform float uDashOff; uniform float uDashPhase;',
        'out vec4 oCol;',
        'void main(){',
        ' float aa = fwidth(vUv.y);',
        ' float edge = 1.0 - smoothstep(1.0 - aa - uWidth * 0.0, 1.0, abs(vUv.y));',
        ' float alpha = edge;',
        ' if (uDashOn > 0.0) {',
        '  float ph = mod(vLen + uDashPhase, uDashOn + uDashOff);',
        '  if (ph > uDashOn) discard;',
        ' }',
        ' oCol = vec4(vCol.rgb, vCol.a * alpha);',
        '}',
      ].join('\n'),
      uniforms: ['uVp', 'uViewport', 'uWidth', 'uDashOn', 'uDashOff', 'uDashPhase'],
    },
    pointImpostor: {
      vertex: [
        '#version 300 es',
        'layout(location=0) in vec3 aPos;',
        'layout(location=1) in vec4 aCol;',
        'layout(location=2) in float aSize;',
        'uniform mat4 uVp; uniform vec3 uOrigin; uniform float uScale;',
        'out vec4 vCol; out vec2 vP; out float vR;',
        'void main(){',
        ' vec3 world = aPos + uOrigin;',
        ' vec4 clip = uVp * vec4(world, 1.0);',
        ' gl_Position = clip;',
        ' float px = aSize * uScale / max(clip.w, 1e-6);',
        ' gl_PointSize = clamp(px * 2.0, 1.0, 256.0);',
        ' vCol = aCol; vR = px; vP = vec2(0.0);',
        '}',
      ].join('\n'),
      fragment: [
        '#version 300 es',
        'precision highp float;',
        'in vec4 vCol; in vec2 vP; in float vR;',
        'out vec4 oCol;',
        'void main(){',
        ' vec2 d = (gl_PointCoord - 0.5) * 2.0;',
        ' float r2 = dot(d, d);',
        ' if (r2 > 1.0) discard;',
        ' vec3 n = vec3(d, sqrt(1.0 - r2));',
        ' float dif = 0.35 + 0.65 * max(dot(n, normalize(vec3(-0.4, 0.6, 0.7))), 0.0);',
        ' oCol = vec4(vCol.rgb * dif, vCol.a);',
        '}',
      ].join('\n'),
      uniforms: ['uVp', 'uOrigin', 'uScale'],
    },
    particle: {
      vertex: [
        '#version 300 es',
        '// Particle bodies are appended by the kernel compiler: each formula',
        '// becomes a pure function of (i, u, v, age, t). This shell derives',
        '// the instance id and applies the view-projection matrix.',
        'uniform mat4 uVp; uniform float uCount; uniform float uT;',
        'out vec4 vCol; out float vSize; out float vAngle;',
        'void main(){',
        ' float i = float(gl_InstanceID);',
        ' vec2 maths_ = particlePos(i, uT);',
        ' vCol = particleColor(i, uT); vSize = particleSize(i, uT); vAngle = particleAngle(i, uT);',
        ' gl_Position = uVp * vec4(maths_, 0.0, 1.0);',
        ' gl_PointSize = clamp(vSize, 1.0, 128.0);',
        '}',
      ].join('\n'),
      fragment: [
        '#version 300 es',
        'precision highp float;',
        'in vec4 vCol; in float vSize; in float vAngle;',
        'uniform float uShape;',
        'out vec4 oCol;',
        'void main(){',
        ' vec2 d = (gl_PointCoord - 0.5) * 2.0;',
        ' float m = 1.0;',
        ' if (uShape < 0.5) { if (dot(d, d) > 1.0) discard; }',
        ' else if (uShape < 1.5) { float r = length(d); if (r > 1.0 || r < 0.65) discard; }',
        ' else if (uShape < 2.5) { if (abs(d.x) > 1.0 || abs(d.y) > 1.0) discard; }',
        ' else { if (abs(d.y) > 0.35 || abs(d.x) > 1.0) discard; }',
        ' oCol = vec4(vCol.rgb, vCol.a * m);',
        '}',
      ].join('\n'),
      uniforms: ['uVp', 'uCount', 'uT', 'uShape'],
    },
    composite: {
      vertex: [
        '#version 300 es',
        'layout(location=0) in vec2 aPos;',
        'out vec2 vUv;',
        'void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }',
      ].join('\n'),
      fragment: [
        '#version 300 es',
        'precision highp float;',
        'in vec2 vUv;',
        'uniform sampler2D uAccum; uniform sampler2D uReveal;',
        'out vec4 oCol;',
        'void main(){',
        ' vec4 accum = texture(uAccum, vUv);',
        ' float reveal = texture(uReveal, vUv).r;',
        ' vec3 avg = accum.rgb / max(accum.a, 1e-5);',
        ' oCol = vec4(avg, 1.0 - reveal);',
        '}',
      ].join('\n'),
      uniforms: ['uAccum', 'uReveal'],
    },
  });
}

/** Pack an sRGB colour into a u32 vertex colour (RGBA8). */
export function packColor(r: number, g: number, b: number, a: number): number {
  const c = (v: number): number => Math.min(255, Math.max(0, Math.round(v)));
  return ((c(r) << 24) | (c(g) << 16) | (c(b) << 8) | c(a * 255)) >>> 0;
}

export function unpackColor(u: number): { r: number; g: number; b: number; a: number } {
  return {
    r: (u >>> 24) & 0xff,
    g: (u >>> 16) & 0xff,
    b: (u >>> 8) & 0xff,
    a: ((u & 0xff) / 255),
  };
}
