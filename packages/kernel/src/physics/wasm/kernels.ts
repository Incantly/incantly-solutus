/**
 * The cloth and liquid hot loops in Rust compiled to WebAssembly (docs/features/physics/design.md 11.6).
 *
 * The TypeScript step stays in charge of the order of a step; each call here works on whole arrays. The arrays a Rust
 * loop reads and writes live in the module's own memory (a `KernelArena`, one per `ClothSet` and one per liquid grid),
 * and TypeScript keeps typed-array views on them. The views are made when the owner is built and never again: nothing
 * grows in a step, so a view never goes stale.
 *
 * The Rust loops give the same bits as the TypeScript loops they copy (design 10.2), so a film is the same with or
 * without WebAssembly. Where WebAssembly is missing, fails to compile, or `setPhysicsKernels(false)` was called, the
 * TypeScript loops run on ordinary typed arrays.
 *
 * Nothing here throws across the package boundary. No DOM, timers or network.
 */
import { KERNELS_SIMD_WASM_BASE64, KERNELS_WASM_BASE64 } from './kernels-wasm';

/** The exports of the module (`packages/kernel/wasm/src/lib.rs`). Every pointer is a byte offset into `memory`. */
export interface KernelExports {
  readonly memory: WebAssembly.Memory;
  readonly __heap_base: WebAssembly.Global;
  solve_links(x: number, y: number, z: number, w0: number, la: number, lb: number, lq: number, lr2: number, l0: number, l1: number): void;
  solve_tethers(x: number, y: number, z: number, w0: number, tePoint: number, teJ: number, teL2: number, tePin: number, pinFx: number, pinFy: number, pinFz: number, taut: number, t0: number, t1: number): void;
  advance(x: number, y: number, z: number, px: number, py: number, pz: number, vx: number, vy: number, vz: number, pinOf: number, afx: number, afy: number, afz: number, p: number, p0: number, e: number): void;
  speeds_advance(x: number, y: number, z: number, px: number, py: number, pz: number, vx: number, vy: number, vz: number, pinOf: number, afx: number, afy: number, afz: number, p: number, p0: number, e: number): void;
  speeds(x: number, y: number, z: number, px: number, py: number, pz: number, vx: number, vy: number, vz: number, p: number, p0: number, e: number): void;
  solve_chain(x: number, y: number, z: number, w: number, rest: number, alpha: number, broken: number, chain: number, nx: number, ny: number, nz: number, dg: number, up: number, rhs: number, p0: number, n: number, p: number, pinOf: number, pinFx: number, pinFy: number, pinFz: number): void;
  air_forces(x: number, y: number, z: number, vx: number, vy: number, vz: number, w: number, ta: number, tb: number, tc: number, triCut: number, pinOf: number, afx: number, afy: number, afz: number, t0: number, t1: number, p: number): void;
  hull_hits(idx: number, start: number, count: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, owner: number, pinOf: number, pinBody: number, body: number, planes: number, nf: number, par: number, out: number): number;
  grid_build(x: number, y: number, z: number, n: number, cx: number, cy: number, cz: number, slot: number, start: number, count: number, sorted: number, mf: number, mi: number): void;
  grid_pairs(x: number, y: number, z: number, n: number, cx: number, cy: number, cz: number, start: number, sorted: number, sx: number, sy: number, sz: number, nbrN: number, pi: number, pj: number, group: number, mf: number, mi: number): number;
  grid_in_box(n: number, cx: number, cy: number, cz: number, start: number, sorted: number, found: number, mf: number, mi: number): number;
  /** The grid in space (`smoke3.ts`, `fire3.ts`): each takes the offsets of the integer block `gi` and the number block `gf` (`GI`, `GF`). */
  grid3_advect_flow(gi: number, gf: number): void;
  grid3_lift(gi: number, gf: number): void;
  grid3_fire_lift(gi: number, gf: number): void;
  grid3_swirl(gi: number, gf: number): void;
  grid3_advect_fire(gi: number, gf: number): void;
  grid3_fire(gi: number, gf: number): void;
  grid3_solid_faces(gi: number, gf: number): void;
  grid3_project(gi: number, gf: number): void;
  grid3_advect_smoke(gi: number, gf: number): void;
  /** 1 when a speed of the grid is not a number or is past 1e6 either way. */
  grid3_health(gi: number): number;
  /** The readouts of a grid: each leaves its number in `gf[GF.out]`. */
  grid3_hottest(gi: number, gf: number): void;
  grid3_flames(gi: number, gf: number): void;
  grid3_fuel_sum(gi: number, gf: number): void;
  grid3_smoke_sum(gi: number, gf: number): void;
  grid3_max_speed(gi: number, gf: number): void;
}

/**
 * The Rust loops of a grid in space: the module's exports, the offsets of the two blocks a call reads (the integer block
 * `gi`: sizes, flags and where each array is; the number block `gf`: the cell sizes, the step, the wind, the fire's settings)
 * and views on them. A call has integer arguments only, so it makes no memory.
 */
export interface GridKernels {
  readonly fn: KernelExports;
  readonly gi: number;
  readonly gf: number;
  readonly I: Int32Array;
  readonly F: Float64Array;
}

/** A grid's temperature arrays, to find its Rust loops from them (`hottest3(T)` and `flameCells3(T)` get an array, not the grid). */
export const GRID_OF = new WeakMap<object, GridKernels>();

/**
 * Where each array of a grid in space is, in the integer block the Rust loops read (byte offsets into the arena's memory),
 * and its sizes and flags (`lib.rs`: `G_*`). The grid swaps two arrays each step by swapping their two slots.
 */
export const GI = {
  n: 0, fire: 1, u: 2, v: 3, w: 4, u2: 5, v2: 6, w2: 7, s: 8, s2: 9, p: 10, div: 11, wl: 12, wr: 13, wd: 14, wu: 15, wb: 16, wf: 17, inv: 18,
  fix: 19, fixed: 20, rowLo: 21, rowHi: 22, own: 23, src: 24, T: 25, F: 26, T2: 27, F2: 28, wet: 29, ca: 30, cb: 31, cc: 32, oa: 33, ob: 34, oc: 35, om: 36,
  sb: 37, still: 38, drops: 39, nbodies: 40, ndrops: 41, sourceOn: 42, hold: 43, size: 64,
} as const;

/** The numbers of a grid in space (`lib.rs`: `F_*`): the box and cell sizes, the step, the wind, the lift, the swirl and the fire's settings. */
export const GF = { x0: 0, y0: 1, z0: 2, dx: 3, dy: 4, dz: 5, h: 6, windX: 7, windY: 8, windZ: 9, lift: 10, swirl: 11, burn: 12, fheat: 13, fsmoke: 14, fuel: 15, last: 16, out: 17, size: 24 } as const;

/**
 * Every argument is an integer (a byte offset or a count): a call with a floating-point argument makes the caller box the
 * number unless the engine inlines the call, and a step must make no garbage (design 11.4). The numbers a call takes go
 * in a block of the arena that the caller writes first, at these places (`lib.rs`: P_HS, …).
 */
export const KP = { hs: 0, gx: 1, gy: 2, gz: 3, damp: 4, inv2: 5, windX: 6, windY: 7, windZ: 8, size: 16 } as const;

let enabled = true;

/** Turns the kernels on or off for solvers built after this call (tests and the hash check; default on). */
export function setPhysicsKernels(on: boolean): void {
  enabled = on;
}

let gridSimd = true;

/** Lets the grid in space use the module built with SIMD where there is one (default on); off for the hash check against the scalar module. */
export function setPhysicsGridSimd(on: boolean): void {
  gridSimd = on;
}

/** Are the kernels on (the switch; they may still be missing on a computer without WebAssembly). */
export function physicsKernelsOn(): boolean {
  return enabled;
}

function decode(text: string): Uint8Array<ArrayBuffer> {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const val = new Int8Array(128).fill(-1);
  for (let i = 0; i < A.length; i++) val[A.charCodeAt(i)] = i;
  let pad = 0;
  if (text.endsWith('==')) pad = 2;
  else if (text.endsWith('=')) pad = 1;
  const out = new Uint8Array((text.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const a = val[text.charCodeAt(i)] as number;
    const b = val[text.charCodeAt(i + 1)] as number;
    const c = val[text.charCodeAt(i + 2)] as number;
    const d = val[text.charCodeAt(i + 3)] as number;
    const n = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** One of the two builds of the module, compiled once (`kernels-wasm.ts`: scalar for the cloth and liquid, with SIMD for the grid in space). */
interface Slot {
  readonly name: 'scalar' | 'simd';
  mod: WebAssembly.Module | undefined;
  failed: boolean;
  pending: Promise<boolean> | undefined;
}

const SCALAR: Slot = { name: 'scalar', mod: undefined, failed: false, pending: undefined };
const SIMD: Slot = { name: 'simd', mod: undefined, failed: false, pending: undefined };

const bytesOf = (slot: Slot): string => (slot === SIMD ? KERNELS_SIMD_WASM_BASE64 : KERNELS_WASM_BASE64);

/**
 * The compiled module, made once. A browser's main thread may refuse to compile a module this size in one go (Chrome:
 * over 4 KB); then `initPhysicsKernels()` (which compiles without blocking) must have finished first, else there are no
 * kernels and the TypeScript loops run. The SIMD build fails to compile on an engine without SIMD: that slot is marked
 * failed and the scalar module serves.
 */
function moduleOf(slot: Slot): WebAssembly.Module | undefined {
  if (slot.mod) return slot.mod;
  if (slot.failed || typeof WebAssembly === 'undefined') return undefined;
  try {
    slot.mod = new WebAssembly.Module(decode(bytesOf(slot)));
  } catch (_e) {
    slot.failed = true;
  }
  return slot.mod;
}

function compileSlot(slot: Slot): Promise<boolean> {
  if (slot.mod) return Promise.resolve(true);
  if (slot.failed || typeof WebAssembly === 'undefined') return Promise.resolve(false);
  // one compile however many apps start: a host that starts several apps calls this each time
  slot.pending ??= WebAssembly.compile(decode(bytesOf(slot))).then(
    (m) => {
      slot.mod ??= m;
      return true;
    },
    () => {
      slot.failed = true;
      return false;
    },
  );
  return slot.pending;
}

/**
 * Compiles the module without blocking (for a page's main thread, where `loadKernels` cannot). Resolves true when the
 * kernels are ready (the scalar module; the SIMD build for the grid in space is compiled with it and used when the engine
 * has SIMD). A host that runs physics on the main thread of a browser calls this once at start-up.
 */
export function initPhysicsKernels(): Promise<boolean> {
  const simd = compileSlot(SIMD);
  return Promise.all([compileSlot(SCALAR), simd]).then(([ok]) => ok);
}

/** One instance of the module with its memory, cut into aligned regions as a solver is built. */
export class KernelArena {
  readonly fn: KernelExports;
  readonly buffer: ArrayBuffer;
  /** True when a region did not fit: that array is an ordinary one, and the owner must not call the kernels. */
  overflow = false;
  private top: number;
  private readonly end: number;

  /** True when this instance is the build with SIMD. */
  readonly simd: boolean;

  private constructor(fn: KernelExports, bytes: number, simd: boolean) {
    this.fn = fn;
    this.simd = simd;
    const base = (fn.__heap_base.value as number) >>> 0;
    this.top = Math.ceil(base / 64) * 64;
    const need = this.top + bytes;
    const have = fn.memory.buffer.byteLength;
    if (need > have) fn.memory.grow(Math.ceil((need - have) / 65536));
    this.buffer = fn.memory.buffer;
    this.end = this.buffer.byteLength;
  }

  /**
   * A new arena with room for `bytes`, or undefined when the kernels are off or missing. `simd`: the grid in space asks for the
   * build with SIMD, which it gets when the engine compiles it (and `setPhysicsGridSimd` has not turned it off).
   */
  static create(bytes: number, simd = false): KernelArena | undefined {
    if (!enabled) return undefined;
    const wide = simd && gridSimd ? moduleOf(SIMD) : undefined;
    const mod = wide ?? moduleOf(SCALAR);
    if (!mod) return undefined;
    try {
      const inst = new WebAssembly.Instance(mod, {});
      return new KernelArena(inst.exports as unknown as KernelExports, bytes, wide !== undefined);
    } catch (_e) {
      return undefined;
    }
  }

  /** Takes `bytes` at a multiple of 64; −1 when it does not fit. */
  take(bytes: number): number {
    const at = this.top;
    const size = Math.ceil(bytes / 64) * 64;
    if (at + size > this.end) {
      this.overflow = true;
      return -1;
    }
    this.top = at + size;
    return at;
  }

  /** Room left, bytes (a measure for the sizing in the owners). */
  left(): number {
    return this.end - this.top;
  }

  f64(n: number): Float64Array<ArrayBuffer> {
    const at = this.take(n * 8);
    return at < 0 ? new Float64Array(n) : new Float64Array(this.buffer, at, n);
  }

  i32(n: number): Int32Array<ArrayBuffer> {
    const at = this.take(n * 4);
    return at < 0 ? new Int32Array(n) : new Int32Array(this.buffer, at, n);
  }

  u8(n: number): Uint8Array<ArrayBuffer> {
    const at = this.take(n);
    return at < 0 ? new Uint8Array(n) : new Uint8Array(this.buffer, at, n);
  }

  f32(n: number): Float32Array<ArrayBuffer> {
    const at = this.take(n * 4);
    return at < 0 ? new Float32Array(n) : new Float32Array(this.buffer, at, n);
  }
}

/** Where an array lives in the arena (its byte offset), or −1 when it is not one of its views. */
export function offsetIn(arena: KernelArena, a: ArrayBufferView): number {
  return a.buffer === arena.buffer ? a.byteOffset : -1;
}

/** What `f64`, `i32` and `u8` hand out: from an arena, or ordinary typed arrays when there is none. */
export interface Allocator {
  f64(n: number): Float64Array<ArrayBuffer>;
  i32(n: number): Int32Array<ArrayBuffer>;
  u8(n: number): Uint8Array<ArrayBuffer>;
  f32(n: number): Float32Array<ArrayBuffer>;
}

/** The allocator with no arena: ordinary typed arrays. */
export const PLAIN: Allocator = {
  f64: (n) => new Float64Array(n),
  i32: (n) => new Int32Array(n),
  u8: (n) => new Uint8Array(n),
  f32: (n) => new Float32Array(n),
};
