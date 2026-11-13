/**
 * Shapes the kernel hands to the view: the "Kernel handoff".
 *
 * The kernel is built on another branch, so this file defines the small plain
 * shapes the integrator will join to the real kernel later (builder brief, rule 3).
 * Everything here is data or a narrow provider interface; there is no maths and
 * no DOM, so this file runs in Node, a worker and on mobile.
 */
import type { ObjId, TypeName, Undefined } from '@incantly/kernel';

/** How the kernel tells the view that objects changed (graphics-view design 7.1). */
export type KernelEvent =
  | { readonly kind: 'add'; readonly ids: readonly ObjId[] }
  | { readonly kind: 'update'; readonly ids: readonly ObjId[] }
  | { readonly kind: 'remove'; readonly ids: readonly ObjId[] }
  | { readonly kind: 'restyle'; readonly ids: readonly ObjId[] };

/**
 * Identity, ordering and dependency facts the view needs per object.
 * `version` bumps whenever the value changes; `styleVersion` whenever a style
 * value (including a formula-driven one) changes.
 */
export interface ViewObjectHead {
  readonly id: ObjId;
  readonly name: string;
  readonly type: TypeName;
  /** Creation/dependency order; redraw order follows it (graphics-view design 8). */
  readonly order: number;
  readonly version: number;
  readonly styleVersion: number;
  /** True for free points, free numbers with a range, and other drag roots. */
  readonly free: boolean;
  /** True while the object is a `PointOn`-style point bound to a path. */
  readonly onPath: boolean;
}

/**
 * Plain geometry values the integrator maps kernel values to. One variant per
 * drawable family (graphics-view design 6, space-3d design 9.2). Coordinates
 * are maths units; the view maps them to pixels.
 */
export type ViewValue =
  | { readonly k: 'point'; readonly x: number; readonly y: number }
  | { readonly k: 'vector'; readonly dx: number; readonly dy: number; readonly ox: number; readonly oy: number }
  | { readonly k: 'segment'; readonly ax: number; readonly ay: number; readonly bx: number; readonly by: number }
  | { readonly k: 'ray'; readonly ox: number; readonly oy: number; readonly dx: number; readonly dy: number }
  | { readonly k: 'line'; readonly ox: number; readonly oy: number; readonly dx: number; readonly dy: number }
  | { readonly k: 'circle'; readonly cx: number; readonly cy: number; readonly r: number }
  | { readonly k: 'arc'; readonly cx: number; readonly cy: number; readonly r: number; readonly from: number; readonly to: number }
  | { readonly k: 'polygon'; readonly pts: Float64Array }
  | { readonly k: 'polyline'; readonly pts: Float64Array; readonly closed: boolean }
  | { readonly k: 'curve'; readonly runs: readonly Float64Array[] }
  | { readonly k: 'region'; readonly rings: readonly Float64Array[] }
  | { readonly k: 'angle'; readonly cx: number; readonly cy: number; readonly r: number; readonly from: number; readonly to: number; readonly right: boolean }
  | { readonly k: 'text'; readonly text: string; readonly atX: number; readonly atY: number; readonly screen: boolean }
  | { readonly k: 'number'; readonly v: number }
  | { readonly k: 'bool'; readonly v: boolean }
  | { readonly k: 'slider'; readonly v: number; readonly lo: number; readonly hi: number; readonly step: number }
  | { readonly k: 'particles'; readonly spec: ParticleSpecPlain }
  | { readonly k: 'trace'; readonly pts: Float64Array }
  | { readonly k: 'point3'; readonly x: number; readonly y: number; readonly z: number }
  | { readonly k: 'mesh'; readonly pos: Float32Array; readonly nor: Float32Array; readonly idx: Uint32Array; readonly closed: boolean }
  | { readonly k: 'meshref'; readonly key: string };

/** A value, or the undefined reason that hides its drawable (core design 2). */
export type ValueOrUndef =
  | { readonly defined: true; readonly value: ViewValue }
  | { readonly defined: false; readonly undef: Undefined };

/**
 * The particle parameters the view needs to draw (animation-time design 10.2),
 * without the formulas. The kernel keeps the formulas and compiles them.
 */
export interface ParticleSpecPlain {
  readonly count: number;
  readonly life: number;
  readonly shape: 'dot' | 'ring' | 'square' | 'streak' | 'spark';
  readonly blend: 'normal' | 'add';
  readonly sizeIsPx: boolean;
  readonly start: number;
  readonly end: number;
  readonly loop: boolean;
  readonly seed: number;
  readonly renderer: 'auto' | 'cpu' | 'gpu';
}

/** One uniform slot the CPU refills every frame for a GPU particle program. */
export interface ParticleUniformSlot {
  readonly name: string;
  readonly kind: 'float' | 'vec2' | 'vec4';
  readonly index: number;
}

/** GLSL/WGSL sources the kernel's particle compiler hands to the view. */
export interface ParticleShaderSource {
  readonly vertexGlsl: string;
  readonly fragmentGlsl: string;
  readonly uniforms: readonly ParticleUniformSlot[];
}

/**
 * What the kernel compiles per particle system (animation-time design 10.5).
 * Implemented by the kernel area; consumed by `core/particles.ts`.
 */
export interface ParticleProgram {
  readonly spec: ParticleSpecPlain;
  readonly gpuOk: boolean;
  readonly gpuReason?: string;
  /** Fill `out` with one row per particle at film time `t` (CPU path). */
  evalCpu(t: number, bt: number, out: ParticleBatchPlain): void;
  /** Sources for the one instanced draw call (GPU path). */
  gpuSource(): ParticleShaderSource;
}

/** Plain CPU particle batch (animation-time design 10.5). */
export interface ParticleBatchPlain {
  readonly count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly size: Float32Array;
  readonly alpha: Float32Array;
  readonly rgba: Uint32Array;
  readonly angle: Float32Array;
}

/**
 * The narrow kernel surface the view reads. The integrator implements this
 * against the real kernel; tests and recorders implement it with fixtures.
 */
export interface KernelView {
  readonly heads: () => readonly ViewObjectHead[];
  readonly head: (id: ObjId) => ViewObjectHead | undefined;
  readonly valueOf: (id: ObjId) => ValueOrUndef;
  /** Free parents of `id`, transitively, for drag plans (graphics-view 12.1). */
  readonly freeParentsOf: (id: ObjId) => readonly ObjId[];
  /** Particle program for a `particles` value, or undefined when CPU data suffices. */
  readonly particlesOf: (id: ObjId) => ParticleProgram | undefined;
  /** Path facts for a `PointOn`-style point, for projection while dragging. */
  readonly pathOf: (id: ObjId) => PathInfo | undefined;
}

/**
 * Plain path facts for dragging a point on a path (graphics-view 12.4).
 * `pts` packs the defining numbers: segment/line/ray `[ox,oy,dx,dy]`,
 * circle/arc `[cx,cy,r,from,to]`, polygon and sampled paths the vertices.
 */
export interface PathInfo {
  readonly kind: 'segment' | 'line' | 'ray' | 'circle' | 'arc' | 'polygon' | 'samples';
  readonly pts: Float64Array;
  readonly closed: boolean;
  readonly domain: { readonly lo: number; readonly hi: number };
}

/** Drag application on the kernel side (graphics-view change C5). */
export interface DragApplier {
  readonly drag: (moves: readonly DragMove[]) => void;
  readonly commitDrag: () => void;
  readonly cancelDrag: () => void;
}

/** One free-value move inside a drag. */
export type DragMove =
  | { readonly k: 'point'; readonly id: ObjId; readonly x: number; readonly y: number }
  | { readonly k: 'point3'; readonly id: ObjId; readonly x: number; readonly y: number; readonly z: number }
  | { readonly k: 'param'; readonly id: ObjId; readonly s: number }
  | { readonly k: 'number'; readonly id: ObjId; readonly v: number };

/**
 * Snapshots for export at a film time (graphics-view design 14.2 step 3).
 * While a snapshot is active, `KernelView` answers with values at `t`.
 */
export interface SnapshotProvider {
  readonly snapshotAt: (t: number) => SnapshotToken;
}

export interface SnapshotToken {
  readonly t: number;
  readonly release: () => void;
}

/**
 * Opaque kernel film state kept across the scheduler's `saved` state
 * (performance design 4: free values, clock time, camera, states, checkpoints).
 * The kernel owns the bytes; the view only holds them.
 */
export interface KernelStateHost {
  readonly saveKernel: () => unknown;
  readonly restoreKernel: (blob: unknown) => void;
}
