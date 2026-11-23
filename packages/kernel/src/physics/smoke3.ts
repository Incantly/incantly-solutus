/**
 * Smoke and fire in space (docs/features/physics/design.md 9.4, 9.7, 9.8): stable fluids (Stam 1999) on an `n` by `n` by
 * `n` grid over a box, the step of `smoke2.ts` with a third axis.
 *
 * The grid is staggered (MAC): smoke, temperature, fuel and pressure live at cell centres, the flow's x, y and z speeds
 * on the faces across each axis. Every value the grid keeps (the flow, the smoke, `T`, `F`, the pressure) is a
 * `Float32Array`: a stored value is rounded with the array and the arithmetic stays Float64, so the film is exact (the same
 * rounding every time) and a checkpoint of a 24³ grid is about 400 KB (design 9.8).
 *
 * One step of `h`, in the order of the plane's:
 *  1. the cells inside solids and bodies are marked, each with the body that fills it;
 *  2. the flow is carried back along itself (semi-Lagrangian, trilinear); air from outside the box comes in with the wind;
 *  3. fire: `T` and `F` are carried; heat lifts the flow along +z; swirl; burning; the source; cooling; water
 *     (`fire3.ts`). Smoke: heat lifts where there is smoke;
 *  4. faces next to a solid take its speed there;
 *  5. the projection: 20 red-black over-relaxed passes of the 7-point pressure solve, warm-started from the last step,
 *     open faces of the box at pressure 0 and solids closed;
 *  6. the smoke is carried along the new flow, and the source makes smoke;
 *  7. the air pushes each body it flows past (a drag force, applied at the following steps).
 *
 * Exact maths only (`+ - * /` and `Math.sqrt`), typed arrays made once, no memory made in a step (no closures, no
 * `for … of`, no array literals, no number passed through a call that a field can hold), every loop in a fixed order.
 */
import type { FireParams } from './fire2';
import type { DropsView3 } from './fire3';
import { advectFire3, confine3, fireLift3, fireStep3 } from './fire3';
import type { Allocator, GridKernels } from './wasm/kernels';
import { GF, GI, GRID_OF, KernelArena, PLAIN } from './wasm/kernels';
import type { World3 } from './world3';
import { BodyType3, FK3 } from './world3';
import { StateMachine } from '../contracts/state-machine';
import { GRID_MACHINE, restoreLife } from './grid-life';

/** The most bodies the Rust solid-face loop has room for (design 11.3: 1,000 bodies), and the most drops the fire's water list holds (2,000). */
const BODY_CAP = 1024;
const DROP_CAP = 2048;

/** A body that moves (a constant of this file: a binding imported from another module is looked up each time by some loaders). */
const DYNAMIC = BodyType3.Dynamic;

/** Pressure passes a step (design 9.4). */
export const SMOKE3_PASSES = 20;
/** Passes in the first half of a split grid step (design 9.8: the grid steps 30 times a second, half of a step a frame). */
export const SMOKE3_PASSES_A = 0;
const OMEGA = 1.8;
const START_PROJECTIONS = 10;
const KEEP = 1 - OMEGA;
/** The most the smoke is scaled by in a step to keep its mass: 0.5% (more with `swirl`). */
const SCALE_CAP = 0.005;
const AIR_DENSITY = 1.2;
const DRAG_CD = 1;
const BLOW_UP = 1e6;

/** Where smoke or fuel is made, in world space. */
export type SmokeSource3 =
  | { readonly kind: 'point'; readonly x: number; readonly y: number; readonly z: number }
  | { readonly kind: 'sphere'; readonly x: number; readonly y: number; readonly z: number; readonly r: number }
  /** A convex solid: four numbers a face (its outward normal and the offset), a point is inside when `n·x ≤ d` for every face. */
  | { readonly kind: 'hull'; readonly planes: readonly number[]; readonly x: number; readonly y: number; readonly z: number };

export interface SmokeSetup3 {
  readonly x0: number;
  readonly y0: number;
  readonly z0: number;
  readonly x1: number;
  readonly y1: number;
  readonly z1: number;
  readonly n: number;
  /** A fire grid: the settings of its fire (design 9.7); without it the grid is plain smoke. */
  readonly fire?: FireParams;
}

export class Smoke3 {
  readonly n: number;
  readonly x0: number;
  readonly y0: number;
  readonly z0: number;
  readonly x1: number;
  readonly y1: number;
  readonly z1: number;
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  /** x speeds on the faces across x: (n + 1) n n, face (i, j, k) at (x0 + i dx, y0 + (j + ½) dy, z0 + (k + ½) dz); index (k n + j) (n + 1) + i. */
  u: Float32Array;
  /** y speeds: n (n + 1) n, index (k (n + 1) + j) n + i. */
  v: Float32Array;
  /** z speeds: n n (n + 1), index (k n + j) n + i. */
  w: Float32Array;
  /** Smoke density at the cell centres, index (k n + j) n + i. */
  s: Float32Array;
  /** Pressure (times h / ρ) at the centres, padded by one ghost cell each side (the open air, pressure 0): index ((k + 1) S + j + 1) S + i + 1, S = n + 2. */
  p: Float32Array;
  /** The body that fills each cell, or −1 for air; and the walls only (marked once). */
  readonly own: Int32Array;
  private readonly own0: Int32Array;
  /** Cells where the source makes smoke (or, for a fire, fuel). */
  readonly src: Uint8Array;
  private hasSource = false;
  /* ------------------------------ fire (design 9.7), empty for plain smoke ------------------------------ */
  fire: FireParams | undefined;
  T: Float32Array;
  F: Float32Array;
  T2: Float32Array;
  F2: Float32Array;
  /** The cells a liquid drop was in at the last step. */
  readonly wet: Uint8Array;
  alive = false;
  swirl = 0;
  /** Scratch of the swirl: centre speeds then forces (c*), the curl (o*) and its size. */
  readonly ca: Float32Array;
  readonly cb: Float32Array;
  readonly cc: Float32Array;
  readonly oa: Float32Array;
  readonly ob: Float32Array;
  readonly oc: Float32Array;
  readonly om: Float32Array;
  private u2: Float32Array;
  private v2: Float32Array;
  private w2: Float32Array;
  private s2: Float32Array;
  /** The pressure solve on the padded grid: divergence, the six neighbour weights and 1 / the diagonal. */
  private readonly div: Float32Array;
  private readonly wl: Float32Array;
  private readonly wr: Float32Array;
  private readonly wd: Float32Array;
  private readonly wu: Float32Array;
  private readonly wb: Float32Array;
  private readonly wf: Float32Array;
  private readonly inv: Float32Array;
  /** The cells off the plain stencil: even cells from 0, odd cells from n³, each in index order; and their new values in a pass. */
  private readonly fix: Int32Array;
  private readonly fixed: Float32Array;
  /** Per row (j, k): the first air cell and one past the last, so a floor or wall is not solved. */
  private readonly rowLo: Int32Array;
  private readonly rowHi: Int32Array;
  /** Per body: 1 when it is not moving at all (its faces are at rest). With the Rust loops, room for `BODY_CAP` bodies in the arena. */
  private still: Uint8Array;
  /** With the Rust loops: the cells the liquid's drops are in (room for `DROP_CAP`), and each body's place, speed and spin (nine numbers). */
  readonly dropCells: Int32Array;
  private readonly bodyRows: Float64Array;
  /** The Rust loops, or undefined when the grid runs the TypeScript loops (kernels off or missing, or no room in the arena). */
  kn: GridKernels | undefined;
  /** Wind (m/s): the air outside the box and coming in at its edges. */
  windX = 0;
  windY = 0;
  windZ = 0;
  /** Lift of thick smoke, m/s² along +z per unit of density. */
  heat = 0;
  /** The source makes smoke this step. */
  making = true;
  /** The walls moved: they are marked again before the next step while `wallsMarkedAt` is behind `wallsMoved`. */
  private wallsMoved = 0;
  private wallsMarkedAt = -1;

  /** The walls moved (a body was added, removed or changed type): they are marked again before the next step. */
  markWallsAgain(): void {
    this.wallsMoved++;
  }
  /** The air's drag on each body (N), found by the last smoke step and applied over the bodies' steps that follow it. */
  fx = new Float64Array(0);
  fy = new Float64Array(0);
  fz = new Float64Array(0);
  private sumX = new Float64Array(0);
  private sumY = new Float64Array(0);
  private sumZ = new Float64Array(0);
  private cnt = new Int32Array(0);
  /** The mass correction of the last step's smoke advection (1 is none). */
  lastScale = 1;
  /** Running, or `unstable` once a speed went over the limit or stopped being a number. */
  readonly life = new StateMachine(GRID_MACHINE, 'running');
  get unstable(): boolean {
    return this.life.is('unstable');
  }
  /** The flow at the point of the last `flowAt` (m/s). */
  ox = 0;
  oy = 0;
  oz = 0;
  /** Scratch: the centre speed of the cell being looked at, and a hull's planes. */
  private cvx = 0;
  private cvy = 0;
  private cvz = 0;
  private pl = new Float64Array(256);

  constructor(setup: SmokeSetup3) {
    const n = Math.max(2, Math.round(setup.n));
    this.n = n;
    this.x0 = Math.min(setup.x0, setup.x1);
    this.x1 = Math.max(setup.x0, setup.x1);
    this.y0 = Math.min(setup.y0, setup.y1);
    this.y1 = Math.max(setup.y0, setup.y1);
    this.z0 = Math.min(setup.z0, setup.z1);
    this.z1 = Math.max(setup.z0, setup.z1);
    this.dx = (this.x1 - this.x0) / n;
    this.dy = (this.y1 - this.y0) / n;
    this.dz = (this.z1 - this.z0) / n;
    const N = n * n * n;
    const arena = KernelArena.create(Smoke3.arenaBytes(n, setup.fire !== undefined), true);
    // every array the Rust loops touch lives in the module's memory when there is one, else it is a plain typed array
    const A: Allocator = arena ?? PLAIN;
    this.u = A.f32((n + 1) * n * n);
    this.v = A.f32(n * (n + 1) * n);
    this.w = A.f32(n * n * (n + 1));
    this.u2 = A.f32(this.u.length);
    this.v2 = A.f32(this.v.length);
    this.w2 = A.f32(this.w.length);
    this.s = A.f32(N);
    this.s2 = A.f32(N);
    const S = (n + 2) * (n + 2) * (n + 2);
    this.p = A.f32(S);
    this.div = A.f32(S);
    this.wl = A.f32(S);
    this.wr = A.f32(S);
    this.wd = A.f32(S);
    this.wu = A.f32(S);
    this.wb = A.f32(S);
    this.wf = A.f32(S);
    this.inv = A.f32(S);
    this.fix = A.i32(2 * N);
    this.fixed = A.f32(2 * N);
    this.rowLo = A.i32(n * n);
    this.rowHi = A.i32(n * n);
    this.own = A.i32(N).fill(-1);
    this.own0 = new Int32Array(N).fill(-1);
    this.src = A.u8(N);
    this.fire = setup.fire ? { ...setup.fire } : undefined;
    const nf = setup.fire ? N : 0;
    this.T = A.f32(nf);
    this.F = A.f32(nf);
    this.T2 = A.f32(nf);
    this.F2 = A.f32(nf);
    this.wet = A.u8(nf);
    this.ca = A.f32(N);
    this.cb = A.f32(N);
    this.cc = A.f32(N);
    this.oa = A.f32(N);
    this.ob = A.f32(N);
    this.oc = A.f32(N);
    this.om = A.f32(N);
    this.still = arena ? A.u8(BODY_CAP) : new Uint8Array(0);
    this.dropCells = arena ? A.i32(DROP_CAP) : new Int32Array(0);
    this.bodyRows = arena ? A.f64(9 * BODY_CAP) : new Float64Array(0);
    const I = A.i32(GI.size);
    const F = A.f64(GF.size);
    this.kn = arena && !arena.overflow ? this.bind(arena, I, F) : undefined;
    this.usesSimd = this.kn !== undefined && arena !== undefined && arena.simd;
    if (this.kn) {
      GRID_OF.set(this.T, this.kn);
      GRID_OF.set(this.T2, this.kn);
    }
  }

  /** The bytes of arena a grid of `n` cells a side needs (every region, rounded up to 64, and room for the blocks). */
  static arenaBytes(n: number, fire: boolean): number {
    const N = n * n * n;
    const U = (n + 1) * n * n;
    const S = (n + 2) * (n + 2) * (n + 2);
    const f32 = 6 * U + 2 * N + 9 * S + 2 * N + 7 * N + (fire ? 4 * N : 0);
    const i32 = 2 * N + 2 * n * n + N + DROP_CAP + GI.size;
    const u8 = N + (fire ? N : 0) + BODY_CAP;
    const f64 = 9 * BODY_CAP + GF.size;
    return 4 * f32 + 4 * i32 + u8 + 8 * f64 + 64 * 48 + 4096;
  }

  /** Writes where every array is, and the cell sizes, into the two blocks the Rust loops read. */
  private bind(arena: KernelArena, I: Int32Array, F: Float64Array): GridKernels {
    I[GI.n] = this.n;
    I[GI.fire] = this.T.length > 0 ? 1 : 0;
    I[GI.u] = this.u.byteOffset;
    I[GI.v] = this.v.byteOffset;
    I[GI.w] = this.w.byteOffset;
    I[GI.u2] = this.u2.byteOffset;
    I[GI.v2] = this.v2.byteOffset;
    I[GI.w2] = this.w2.byteOffset;
    I[GI.s] = this.s.byteOffset;
    I[GI.s2] = this.s2.byteOffset;
    I[GI.p] = this.p.byteOffset;
    I[GI.div] = this.div.byteOffset;
    I[GI.wl] = this.wl.byteOffset;
    I[GI.wr] = this.wr.byteOffset;
    I[GI.wd] = this.wd.byteOffset;
    I[GI.wu] = this.wu.byteOffset;
    I[GI.wb] = this.wb.byteOffset;
    I[GI.wf] = this.wf.byteOffset;
    I[GI.inv] = this.inv.byteOffset;
    I[GI.fix] = this.fix.byteOffset;
    I[GI.fixed] = this.fixed.byteOffset;
    I[GI.rowLo] = this.rowLo.byteOffset;
    I[GI.rowHi] = this.rowHi.byteOffset;
    I[GI.own] = this.own.byteOffset;
    I[GI.src] = this.src.byteOffset;
    I[GI.T] = this.T.byteOffset;
    I[GI.F] = this.F.byteOffset;
    I[GI.T2] = this.T2.byteOffset;
    I[GI.F2] = this.F2.byteOffset;
    I[GI.wet] = this.wet.byteOffset;
    I[GI.ca] = this.ca.byteOffset;
    I[GI.cb] = this.cb.byteOffset;
    I[GI.cc] = this.cc.byteOffset;
    I[GI.oa] = this.oa.byteOffset;
    I[GI.ob] = this.ob.byteOffset;
    I[GI.oc] = this.oc.byteOffset;
    I[GI.om] = this.om.byteOffset;
    I[GI.sb] = this.bodyRows.byteOffset;
    I[GI.still] = this.still.byteOffset;
    I[GI.drops] = this.dropCells.byteOffset;
    F[GF.x0] = this.x0;
    F[GF.y0] = this.y0;
    F[GF.z0] = this.z0;
    F[GF.dx] = this.dx;
    F[GF.dy] = this.dy;
    F[GF.dz] = this.dz;
    return { fn: arena.fn, gi: I.byteOffset, gf: F.byteOffset, I, F };
  }

  /** Does the grid run the Rust loops (design 11.6)? */
  get usesKernels(): boolean {
    return this.kn !== undefined;
  }

  /** Is the module the grid runs the build with SIMD? */
  usesSimd = false;

  /** The step's own numbers, written to the block the Rust loops read (only numbers, so a call has none to pass). */
  private writeNumbers(k: GridKernels, h: number): void {
    const F = k.F;
    F[GF.h] = h;
    F[GF.windX] = this.windX;
    F[GF.windY] = this.windY;
    F[GF.windZ] = this.windZ;
    F[GF.lift] = this.heat;
    F[GF.swirl] = this.swirl;
    const fire = this.fire;
    if (fire) {
      F[GF.burn] = fire.burn;
      F[GF.fheat] = fire.heat;
      F[GF.fsmoke] = fire.smoke;
      F[GF.fuel] = fire.fuel;
    }
    const on = this.hasSource && this.making ? 1 : 0;
    k.I[GI.sourceOn] = on;
    k.I[GI.hold] = on;
  }

  /** The flow's two sets of arrays trade places (and so do their slots in the block). */
  private swapFlow(k: GridKernels): void {
    const u = this.u;
    this.u = this.u2;
    this.u2 = u;
    const v = this.v;
    this.v = this.v2;
    this.v2 = v;
    const w = this.w;
    this.w = this.w2;
    this.w2 = w;
    const I = k.I;
    const iu = I[GI.u] as number;
    I[GI.u] = I[GI.u2] as number;
    I[GI.u2] = iu;
    const iv = I[GI.v] as number;
    I[GI.v] = I[GI.v2] as number;
    I[GI.v2] = iv;
    const iw = I[GI.w] as number;
    I[GI.w] = I[GI.w2] as number;
    I[GI.w2] = iw;
  }

  /** `T` and `F` trade places with their second arrays (the fire's advection under the Rust loops). */
  swapFire(): void {
    const t = this.T;
    this.T = this.T2;
    this.T2 = t;
    const f = this.F;
    this.F = this.F2;
    this.F2 = f;
    const k = this.kn;
    if (!k) return;
    const I = k.I;
    const it = I[GI.T] as number;
    I[GI.T] = I[GI.T2] as number;
    I[GI.T2] = it;
    const jf = I[GI.F] as number;
    I[GI.F] = I[GI.F2] as number;
    I[GI.F2] = jf;
  }

  get sourced(): boolean {
    return this.hasSource;
  }

  /* ------------------------------ setting up ------------------------------ */

  /** The air at the start: still air moving with the wind, the source full of smoke. */
  start(windX: number, windY: number, windZ: number): void {
    this.windX = windX;
    this.windY = windY;
    this.windZ = windZ;
    this.u.fill(windX);
    this.v.fill(windY);
    this.w.fill(windZ);
    this.s.fill(0);
    this.p.fill(0);
    this.life.send('reset');
    if (this.fire) this.seedFire();
    else this.makeSmoke();
  }

  /** A fire starts with no fuel and the source cells at `heat`, so the source shows before the film runs. */
  private seedFire(): void {
    this.T.fill(0);
    this.F.fill(0);
    this.alive = false;
    if (!this.hasSource || !this.making || !this.fire) return;
    const heat = this.fire.heat;
    for (let c = 0; c < this.src.length; c++) if (this.src[c] === 1 && (this.own[c] as number) < 0) this.T[c] = heat;
  }

  /** Ten projections (200 passes) once at the start make the wind's flow lose no volume round the solids. */
  settle(w: World3 | undefined): void {
    this.markSolids(w);
    this.solidFaces(w);
    for (let k = 0; k < START_PROJECTIONS; k++) this.project();
  }

  setSource(src: SmokeSource3 | undefined): void {
    this.hasSource = markSource3(this.src, this, src);
  }

  private makeSmoke(): void {
    if (!this.hasSource || !this.making) return;
    const s = this.s;
    const src = this.src;
    const own = this.own;
    for (let c = 0; c < s.length; c++) if (src[c] === 1 && (own[c] as number) < 0) s[c] = 1;
  }

  /* ------------------------------ solids ------------------------------ */

  /** Marks which cells each shape fills: the walls (once, or when they move), then the bodies (each step). */
  markSolids(w: World3 | undefined): void {
    if (!w) return;
    if (this.fx.length !== w.n || this.cnt.length !== w.n) {
      if (this.fx.length !== w.n) {
        this.fx = new Float64Array(w.n);
        this.fy = new Float64Array(w.n);
        this.fz = new Float64Array(w.n);
      }
      this.sumX = new Float64Array(w.n);
      this.sumY = new Float64Array(w.n);
      this.sumZ = new Float64Array(w.n);
      this.cnt = new Int32Array(w.n);
    }
    if (this.wallsMarkedAt !== this.wallsMoved) {
      this.wallsMarkedAt = this.wallsMoved;
      this.own0.fill(-1);
      for (let b = 0; b < w.n; b++) if (w.type[b] !== DYNAMIC && !w.gone.has(b)) this.markBody(w, b, this.own0);
    }
    this.own.set(this.own0);
    for (let b = 0; b < w.n; b++) if (w.type[b] === DYNAMIC && !w.gone.has(b)) this.markBody(w, b, this.own);
    // a body that is not moving at all (the floor, a wall) holds its faces at rest without any sum
    if (this.kn && w.n > BODY_CAP) this.kn = undefined;
    if (!this.kn && this.still.length < w.n) this.still = new Uint8Array(w.n);
    for (let b = 0; b < w.n; b++) {
      const o = b * 3;
      this.still[b] = w.v[o] === 0 && w.v[o + 1] === 0 && w.v[o + 2] === 0 && w.w[o] === 0 && w.w[o + 1] === 0 && w.w[o + 2] === 0 ? 1 : 0;
    }
  }

  private markBody(w: World3, b: number, own: Int32Array): void {
    const s0 = w.shape0[b] as number;
    const ns = w.shapeN[b] as number;
    for (let k = s0; k < s0 + ns; k++) {
      const sh = w.shapes[k];
      if (!sh) continue;
      if (sh.kind === 0) this.markSphere(sh.wc[0] as number, sh.wc[1] as number, sh.wc[2] as number, sh.r, b, own);
      else if (sh.kind === 1) this.markHull(sh.wv, sh.wn, sh.faces, b, own);
      else if (sh.kind === 2) this.markPlane(sh.lc[0] as number, sh.lc[1] as number, sh.lc[2] as number, sh.lc[3] as number, b, own);
      else if (sh.hf) this.markTerrain(sh.hf, b, own);
    }
  }

  private markSphere(cx: number, cy: number, cz: number, r: number, b: number, own: Int32Array): void {
    const n = this.n;
    const i0 = Math.max(0, Math.ceil((cx - r - this.x0) / this.dx - 0.5));
    const i1 = Math.min(n - 1, Math.floor((cx + r - this.x0) / this.dx - 0.5));
    const j0 = Math.max(0, Math.ceil((cy - r - this.y0) / this.dy - 0.5));
    const j1 = Math.min(n - 1, Math.floor((cy + r - this.y0) / this.dy - 0.5));
    const k0 = Math.max(0, Math.ceil((cz - r - this.z0) / this.dz - 0.5));
    const k1 = Math.min(n - 1, Math.floor((cz + r - this.z0) / this.dz - 0.5));
    const r2 = r * r;
    for (let k = k0; k <= k1; k++) {
      const z = this.z0 + (k + 0.5) * this.dz - cz;
      for (let j = j0; j <= j1; j++) {
        const y = this.y0 + (j + 0.5) * this.dy - cy;
        for (let i = i0; i <= i1; i++) {
          const x = this.x0 + (i + 0.5) * this.dx - cx;
          if (x * x + y * y + z * z <= r2) own[(k * n + j) * n + i] = b;
        }
      }
    }
  }

  /** A convex hull: a cell centre is inside when it is on the inner side of every face. A hull thinner than a cell marks the cell of its middle. */
  private markHull(wv: Float64Array, wn: Float64Array, faces: readonly Int32Array[], b: number, own: Int32Array): void {
    const n = this.n;
    const nf = faces.length;
    if (this.pl.length < nf * 4) this.pl = new Float64Array(nf * 8);
    const pl = this.pl;
    let lx = Infinity;
    let ly = Infinity;
    let lz = Infinity;
    let hx = -Infinity;
    let hy = -Infinity;
    let hz = -Infinity;
    for (let q = 0; q < wv.length; q += 3) {
      const x = wv[q] as number;
      const y = wv[q + 1] as number;
      const z = wv[q + 2] as number;
      if (x < lx) lx = x;
      if (x > hx) hx = x;
      if (y < ly) ly = y;
      if (y > hy) hy = y;
      if (z < lz) lz = z;
      if (z > hz) hz = z;
    }
    for (let f = 0; f < nf; f++) {
      const v0 = 3 * ((faces[f] as Int32Array)[0] as number);
      const nx = wn[3 * f] as number;
      const ny = wn[3 * f + 1] as number;
      const nz = wn[3 * f + 2] as number;
      pl[4 * f] = nx;
      pl[4 * f + 1] = ny;
      pl[4 * f + 2] = nz;
      pl[4 * f + 3] = nx * (wv[v0] as number) + ny * (wv[v0 + 1] as number) + nz * (wv[v0 + 2] as number);
    }
    const i0 = Math.max(0, Math.ceil((lx - this.x0) / this.dx - 0.5));
    const i1 = Math.min(n - 1, Math.floor((hx - this.x0) / this.dx - 0.5));
    const j0 = Math.max(0, Math.ceil((ly - this.y0) / this.dy - 0.5));
    const j1 = Math.min(n - 1, Math.floor((hy - this.y0) / this.dy - 0.5));
    const k0 = Math.max(0, Math.ceil((lz - this.z0) / this.dz - 0.5));
    const k1 = Math.min(n - 1, Math.floor((hz - this.z0) / this.dz - 0.5));
    let any = false;
    for (let k = k0; k <= k1; k++) {
      const z = this.z0 + (k + 0.5) * this.dz;
      for (let j = j0; j <= j1; j++) {
        const y = this.y0 + (j + 0.5) * this.dy;
        for (let i = i0; i <= i1; i++) {
          const x = this.x0 + (i + 0.5) * this.dx;
          let inside = true;
          for (let f = 0; f < nf && inside; f++) {
            if ((pl[4 * f] as number) * x + (pl[4 * f + 1] as number) * y + (pl[4 * f + 2] as number) * z > (pl[4 * f + 3] as number)) inside = false;
          }
          if (inside) {
            own[(k * n + j) * n + i] = b;
            any = true;
          }
        }
      }
    }
    if (any) return;
    // thinner than a cell: the cell its middle is in, so no air leaks through a thin wall's middle (a leak at its edge stays)
    const mx = Math.floor((0.5 * (lx + hx) - this.x0) / this.dx);
    const my = Math.floor((0.5 * (ly + hy) - this.y0) / this.dy);
    const mz = Math.floor((0.5 * (lz + hz) - this.z0) / this.dz);
    if (mx >= 0 && mx < n && my >= 0 && my < n && mz >= 0 && mz < n) own[(mz * n + my) * n + mx] = b;
  }

  /** The floor (or any plane): everything on its back side, `n·x < d`, is solid. */
  private markPlane(nx: number, ny: number, nz: number, d: number, b: number, own: Int32Array): void {
    const n = this.n;
    for (let k = 0; k < n; k++) {
      const z = this.z0 + (k + 0.5) * this.dz;
      for (let j = 0; j < n; j++) {
        const y = this.y0 + (j + 0.5) * this.dy;
        for (let i = 0; i < n; i++) {
          const x = this.x0 + (i + 0.5) * this.dx;
          if (nx * x + ny * y + nz * z < d) own[(k * n + j) * n + i] = b;
        }
      }
    }
  }

  /** Terrain `z = f(x, y)`: a cell is solid when its centre is under the height there (the triangle of the terrain's cell it is over). */
  private markTerrain(hf: { readonly x0: number; readonly y0: number; readonly dx: number; readonly dy: number; readonly nx: number; readonly ny: number; readonly h: Float64Array }, b: number, own: Int32Array): void {
    const n = this.n;
    const h = hf.h;
    const W = hf.ny + 1;
    for (let j = 0; j < n; j++) {
      const y = this.y0 + (j + 0.5) * this.dy;
      const fy = (y - hf.y0) / hf.dy;
      if (!(fy >= 0 && fy <= hf.ny)) continue;
      let cj = Math.floor(fy);
      if (cj > hf.ny - 1) cj = hf.ny - 1;
      const tv = fy - cj;
      for (let i = 0; i < n; i++) {
        const x = this.x0 + (i + 0.5) * this.dx;
        const fx = (x - hf.x0) / hf.dx;
        if (!(fx >= 0 && fx <= hf.nx)) continue;
        let ci = Math.floor(fx);
        if (ci > hf.nx - 1) ci = hf.nx - 1;
        const tu = fx - ci;
        const h00 = h[ci * W + cj] as number;
        const h10 = h[(ci + 1) * W + cj] as number;
        const h01 = h[ci * W + cj + 1] as number;
        const h11 = h[(ci + 1) * W + cj + 1] as number;
        const top = tu >= tv ? h00 + tu * (h10 - h00) + tv * (h11 - h10) : h00 + tu * (h11 - h01) + tv * (h01 - h00);
        if (!Number.isFinite(top)) continue;
        for (let k = 0; k < n; k++) if (this.z0 + (k + 0.5) * this.dz < top) own[(k * n + j) * n + i] = b;
      }
    }
  }

  /* ------------------------------ sampling ------------------------------ */

  /**
   * The flow at a point, into `ox`, `oy`, `oz`: trilinear between the faces; the wind outside the box (cloth in the grid
   * feels it as wind). No number is returned, so a call makes no memory.
   */
  flowAt(x: number, y: number, z: number): void {
    if (x < this.x0 || x > this.x1 || y < this.y0 || y > this.y1 || z < this.z0 || z > this.z1) {
      this.ox = this.windX;
      this.oy = this.windY;
      this.oz = this.windZ;
      return;
    }
    const n = this.n;
    const gx = (x - this.x0) / this.dx;
    const gy = (y - this.y0) / this.dy;
    const gz = (z - this.z0) / this.dz;
    // u: index space (x, y − ½, z − ½)
    {
      const fx = gx > n ? n : gx;
      const fy = gy - 0.5 < 0 ? 0 : gy - 0.5 > n - 1 ? n - 1 : gy - 0.5;
      const fz = gz - 0.5 < 0 ? 0 : gz - 0.5 > n - 1 ? n - 1 : gz - 0.5;
      let a = Math.floor(fx);
      let b = Math.floor(fy);
      let c = Math.floor(fz);
      if (a > n - 1) a = n - 1;
      if (b > n - 2) b = n - 2;
      if (c > n - 2) c = n - 2;
      const tx = fx - a;
      const ty = fy - b;
      const tz = fz - c;
      const W1 = n + 1;
      const WP = W1 * n;
      const u = this.u;
      const q = c * WP + b * W1 + a;
      const x00 = (u[q] as number) + ((u[q + 1] as number) - (u[q] as number)) * tx;
      const x10 = (u[q + W1] as number) + ((u[q + W1 + 1] as number) - (u[q + W1] as number)) * tx;
      const x01 = (u[q + WP] as number) + ((u[q + WP + 1] as number) - (u[q + WP] as number)) * tx;
      const x11 = (u[q + WP + W1] as number) + ((u[q + WP + W1 + 1] as number) - (u[q + WP + W1] as number)) * tx;
      this.ox = (x00 + (x10 - x00) * ty) * (1 - tz) + (x01 + (x11 - x01) * ty) * tz;
    }
    // v: (x − ½, y, z − ½)
    {
      const fx = gx - 0.5 < 0 ? 0 : gx - 0.5 > n - 1 ? n - 1 : gx - 0.5;
      const fy = gy > n ? n : gy;
      const fz = gz - 0.5 < 0 ? 0 : gz - 0.5 > n - 1 ? n - 1 : gz - 0.5;
      let a = Math.floor(fx);
      let b = Math.floor(fy);
      let c = Math.floor(fz);
      if (a > n - 2) a = n - 2;
      if (b > n - 1) b = n - 1;
      if (c > n - 2) c = n - 2;
      const tx = fx - a;
      const ty = fy - b;
      const tz = fz - c;
      const WP = n * (n + 1);
      const v = this.v;
      const q = c * WP + b * n + a;
      const x00 = (v[q] as number) + ((v[q + 1] as number) - (v[q] as number)) * tx;
      const x10 = (v[q + n] as number) + ((v[q + n + 1] as number) - (v[q + n] as number)) * tx;
      const x01 = (v[q + WP] as number) + ((v[q + WP + 1] as number) - (v[q + WP] as number)) * tx;
      const x11 = (v[q + WP + n] as number) + ((v[q + WP + n + 1] as number) - (v[q + WP + n] as number)) * tx;
      this.oy = (x00 + (x10 - x00) * ty) * (1 - tz) + (x01 + (x11 - x01) * ty) * tz;
    }
    // w: (x − ½, y − ½, z)
    {
      const fx = gx - 0.5 < 0 ? 0 : gx - 0.5 > n - 1 ? n - 1 : gx - 0.5;
      const fy = gy - 0.5 < 0 ? 0 : gy - 0.5 > n - 1 ? n - 1 : gy - 0.5;
      const fz = gz > n ? n : gz;
      let a = Math.floor(fx);
      let b = Math.floor(fy);
      let c = Math.floor(fz);
      if (a > n - 2) a = n - 2;
      if (b > n - 2) b = n - 2;
      if (c > n - 1) c = n - 1;
      const tx = fx - a;
      const ty = fy - b;
      const tz = fz - c;
      const WP = n * n;
      const w = this.w;
      const q = c * WP + b * n + a;
      const x00 = (w[q] as number) + ((w[q + 1] as number) - (w[q] as number)) * tx;
      const x10 = (w[q + n] as number) + ((w[q + n + 1] as number) - (w[q + n] as number)) * tx;
      const x01 = (w[q + WP] as number) + ((w[q + WP + 1] as number) - (w[q + WP] as number)) * tx;
      const x11 = (w[q + WP + n] as number) + ((w[q + WP + n + 1] as number) - (w[q + WP + n] as number)) * tx;
      this.oz = (x00 + (x10 - x00) * ty) * (1 - tz) + (x01 + (x11 - x01) * ty) * tz;
    }
  }

  /** The cell holding drop `m` of the arrays, or −1 outside the box (`cellAt` without three numbers passed through a call). */
  cellOfDrop(xs: Float64Array, ys: Float64Array, zs: Float64Array, m: number): number {
    const n = this.n;
    if (!((xs[m] as number) >= this.x0 && (xs[m] as number) <= this.x1 && (ys[m] as number) >= this.y0 && (ys[m] as number) <= this.y1 && (zs[m] as number) >= this.z0 && (zs[m] as number) <= this.z1)) return -1;
    let i = Math.floor(((xs[m] as number) - this.x0) / this.dx);
    let j = Math.floor(((ys[m] as number) - this.y0) / this.dy);
    let k = Math.floor(((zs[m] as number) - this.z0) / this.dz);
    if (i > n - 1) i = n - 1;
    if (j > n - 1) j = n - 1;
    if (k > n - 1) k = n - 1;
    return (k * n + j) * n + i;
  }

  /** The cell holding a point, or −1 outside the box. */
  cellAt(x: number, y: number, z: number): number {
    const n = this.n;
    if (!(x >= this.x0 && x <= this.x1 && y >= this.y0 && y <= this.y1 && z >= this.z0 && z <= this.z1)) return -1;
    let i = Math.floor((x - this.x0) / this.dx);
    let j = Math.floor((y - this.y0) / this.dy);
    let k = Math.floor((z - this.z0) / this.dz);
    if (i > n - 1) i = n - 1;
    if (j > n - 1) j = n - 1;
    if (k > n - 1) k = n - 1;
    return (k * n + j) * n + i;
  }

  /* ------------------------------ the step ------------------------------ */

  /** Puts the air's drag of the last smoke step on the bodies for one bodies' step of `h` (before that step). */
  applyImpulses(w: World3 | undefined, h: number): void {
    if (!w) return;
    const m = Math.min(w.n, this.fx.length);
    for (let b = 0; b < m; b++) {
      const fx = this.fx[b] as number;
      const fy = this.fy[b] as number;
      const fz = this.fz[b] as number;
      if (fx === 0 && fy === 0 && fz === 0) continue;
      if (w.type[b] !== DYNAMIC || w.gone.has(b)) continue;
      w.impulse[b * 3] = (w.impulse[b * 3] as number) + fx * h;
      w.impulse[b * 3 + 1] = (w.impulse[b * 3 + 1] as number) + fy * h;
      w.impulse[b * 3 + 2] = (w.impulse[b * 3 + 2] as number) + fz * h;
    }
  }

  /** Counts the drag as `drag` (after the bodies' step, which clears the counts). */
  account(w: World3 | undefined): void {
    if (!w) return;
    const m = Math.min(w.n, this.fx.length);
    for (let b = 0; b < m; b++) {
      const fx = this.fx[b] as number;
      const fy = this.fy[b] as number;
      const fz = this.fz[b] as number;
      if ((fx !== 0 || fy !== 0 || fz !== 0) && w.type[b] === DYNAMIC && !w.gone.has(b)) w.account(b, FK3.drag, fx, fy, fz);
    }
  }

  /** One step of `h` against the bodies where they are now; `drops` are the liquid's drops (for water). */
  step(w: World3 | undefined, h: number, drops?: DropsView3): void {
    this.stepPart(w, h, drops, 0);
  }

  /**
   * One grid step in two halves, one a frame (design 9.8): the first half carries the flow, lifts, swirls, burns, holds
   * the solid faces and does the first passes of the projection; the second does the other passes, the gradient, carries
   * the smoke and finds the drag. Run the first, then the second, with the same `h`; nothing else steps the grid between.
   */
  stepFirst(w: World3 | undefined, h: number, drops?: DropsView3): void {
    this.stepPart(w, h, drops, 1);
  }

  stepSecond(w: World3 | undefined, h: number): void {
    this.stepPart(w, h, undefined, 2);
  }

  /** The counts of the even and odd off-stencil cells, kept between the two halves of a split projection. */
  private nf0 = 0;
  private nf1 = 0;

  private stepPart(w: World3 | undefined, h: number, drops: DropsView3 | undefined, part: number): void {
    if (this.unstable) return;
    const fire = this.fire !== undefined;
    if (part !== 2) {
      this.markSolids(w);
      const k = this.kn;
      if (k) this.writeNumbers(k, h);
      this.advectFlow(h);
      if (fire) {
        advectFire3(this, h);
        fireLift3(this, h);
      } else this.lift(h);
      if (this.swirl > 0) confine3(this, h);
      if (fire) fireStep3(this, h, drops);
      this.solidFaces(w);
    }
    this.project(part);
    if (part === 1) return;
    this.advectSmoke(h);
    if (fire) this.markAlive();
    else this.makeSmoke();
    this.drag(w, h);
    this.checkHealth();
  }

  private markAlive(): void {
    if (this.alive) return;
    const { T, F } = this;
    for (let c = 0; c < T.length; c++) {
      if ((T[c] as number) > 150 || (F[c] as number) > 0) {
        this.alive = true;
        return;
      }
    }
  }

  private advectFlow(h: number): void {
    const k = this.kn;
    if (k) {
      k.fn.grid3_advect_flow(k.gi, k.gf);
      this.swapFlow(k);
      return;
    }
    const n = this.n;
    const W1 = n + 1;
    const nn = n * n;
    const { u, v, w, u2, v2, w2 } = this;
    const kx = h / this.dx;
    const ky = h / this.dy;
    const kz = h / this.dz;
    const windX = this.windX;
    const windY = this.windY;
    const windZ = this.windZ;
    const lim = n - 0.5;
    // x speeds: the face's own u, v and w as the mean of the four faces round it; face (i, j, k) is at index (i, j + ½, k + ½)
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < n; j++) {
        const vb = (k * W1 + j) * n;
        const wb = (k * n + j) * n;
        const ub = (k * n + j) * W1;
        for (let i = 0; i <= n; i++) {
          const il = i > 0 ? i - 1 : 0;
          const ir = i < n ? i : n - 1;
          const vv = 0.25 * ((v[vb + il] as number) + (v[vb + ir] as number) + (v[vb + n + il] as number) + (v[vb + n + ir] as number));
          const ww = 0.25 * ((w[wb + il] as number) + (w[wb + ir] as number) + (w[wb + nn + il] as number) + (w[wb + nn + ir] as number));
          const fx = i - kx * (u[ub + i] as number);
          let fy = j - ky * vv;
          let fz = k - kz * ww;
          if (!(fx >= 0 && fx <= n && fy >= -0.5 && fy <= lim && fz >= -0.5 && fz <= lim)) {
            u2[ub + i] = windX;
            continue;
          }
          if (fy < 0) fy = 0;
          else if (fy > n - 1) fy = n - 1;
          if (fz < 0) fz = 0;
          else if (fz > n - 1) fz = n - 1;
          let a = fx | 0;
          let b = fy | 0;
          let c = fz | 0;
          if (a > n - 1) a = n - 1;
          if (b > n - 2) b = n - 2;
          if (c > n - 2) c = n - 2;
          const tx = fx - a;
          const ty = fy - b;
          const tz = fz - c;
          const q = c * W1 * n + b * W1 + a;
          const P = W1 * n;
          const p0 = u[q] as number;
          const p1 = u[q + W1] as number;
          const p2 = u[q + P] as number;
          const p3 = u[q + P + W1] as number;
          const x00 = p0 + ((u[q + 1] as number) - p0) * tx;
          const x10 = p1 + ((u[q + W1 + 1] as number) - p1) * tx;
          const x01 = p2 + ((u[q + P + 1] as number) - p2) * tx;
          const x11 = p3 + ((u[q + P + W1 + 1] as number) - p3) * tx;
          u2[ub + i] = (x00 + (x10 - x00) * ty) * (1 - tz) + (x01 + (x11 - x01) * ty) * tz;
        }
      }
    }
    // y speeds: face (i, j, k) is at index (i + ½, j, k + ½)
    for (let k = 0; k < n; k++) {
      for (let j = 0; j <= n; j++) {
        const jb = j > 0 ? j - 1 : 0;
        const jt = j < n ? j : n - 1;
        const vb = (k * W1 + j) * n;
        for (let i = 0; i < n; i++) {
          const uu = 0.25 * ((u[(k * n + jb) * W1 + i] as number) + (u[(k * n + jb) * W1 + i + 1] as number) + (u[(k * n + jt) * W1 + i] as number) + (u[(k * n + jt) * W1 + i + 1] as number));
          const ww = 0.25 * ((w[(k * n + jb) * n + i] as number) + (w[(k * n + jt) * n + i] as number) + (w[((k + 1) * n + jb) * n + i] as number) + (w[((k + 1) * n + jt) * n + i] as number));
          let fx = i - kx * uu;
          const fy = j - ky * (v[vb + i] as number);
          let fz = k - kz * ww;
          if (!(fx >= -0.5 && fx <= lim && fy >= 0 && fy <= n && fz >= -0.5 && fz <= lim)) {
            v2[vb + i] = windY;
            continue;
          }
          if (fx < 0) fx = 0;
          else if (fx > n - 1) fx = n - 1;
          if (fz < 0) fz = 0;
          else if (fz > n - 1) fz = n - 1;
          let a = fx | 0;
          let b = fy | 0;
          let c = fz | 0;
          if (a > n - 2) a = n - 2;
          if (b > n - 1) b = n - 1;
          if (c > n - 2) c = n - 2;
          const tx = fx - a;
          const ty = fy - b;
          const tz = fz - c;
          const P = n * W1;
          const q = c * P + b * n + a;
          const p0 = v[q] as number;
          const p1 = v[q + n] as number;
          const p2 = v[q + P] as number;
          const p3 = v[q + P + n] as number;
          const x00 = p0 + ((v[q + 1] as number) - p0) * tx;
          const x10 = p1 + ((v[q + n + 1] as number) - p1) * tx;
          const x01 = p2 + ((v[q + P + 1] as number) - p2) * tx;
          const x11 = p3 + ((v[q + P + n + 1] as number) - p3) * tx;
          v2[vb + i] = (x00 + (x10 - x00) * ty) * (1 - tz) + (x01 + (x11 - x01) * ty) * tz;
        }
      }
    }
    // z speeds: face (i, j, k) is at index (i + ½, j + ½, k)
    for (let k = 0; k <= n; k++) {
      const kb = k > 0 ? k - 1 : 0;
      const kt = k < n ? k : n - 1;
      for (let j = 0; j < n; j++) {
        const wb = (k * n + j) * n;
        for (let i = 0; i < n; i++) {
          const uu = 0.25 * ((u[(kb * n + j) * W1 + i] as number) + (u[(kb * n + j) * W1 + i + 1] as number) + (u[(kt * n + j) * W1 + i] as number) + (u[(kt * n + j) * W1 + i + 1] as number));
          const vv = 0.25 * ((v[(kb * W1 + j) * n + i] as number) + (v[(kb * W1 + j + 1) * n + i] as number) + (v[(kt * W1 + j) * n + i] as number) + (v[(kt * W1 + j + 1) * n + i] as number));
          let fx = i - kx * uu;
          let fy = j - ky * vv;
          const fz = k - kz * (w[wb + i] as number);
          if (!(fx >= -0.5 && fx <= lim && fy >= -0.5 && fy <= lim && fz >= 0 && fz <= n)) {
            w2[wb + i] = windZ;
            continue;
          }
          if (fx < 0) fx = 0;
          else if (fx > n - 1) fx = n - 1;
          if (fy < 0) fy = 0;
          else if (fy > n - 1) fy = n - 1;
          let a = fx | 0;
          let b = fy | 0;
          let c = fz | 0;
          if (a > n - 2) a = n - 2;
          if (b > n - 2) b = n - 2;
          if (c > n - 1) c = n - 1;
          const tx = fx - a;
          const ty = fy - b;
          const tz = fz - c;
          const q = c * nn + b * n + a;
          const p0 = w[q] as number;
          const p1 = w[q + n] as number;
          const p2 = w[q + nn] as number;
          const p3 = w[q + nn + n] as number;
          const x00 = p0 + ((w[q + 1] as number) - p0) * tx;
          const x10 = p1 + ((w[q + n + 1] as number) - p1) * tx;
          const x01 = p2 + ((w[q + nn + 1] as number) - p2) * tx;
          const x11 = p3 + ((w[q + nn + n + 1] as number) - p3) * tx;
          w2[wb + i] = (x00 + (x10 - x00) * ty) * (1 - tz) + (x01 + (x11 - x01) * ty) * tz;
        }
      }
    }
    this.u = u2;
    this.u2 = u;
    this.v = v2;
    this.v2 = v;
    this.w = w2;
    this.w2 = w;
  }

  /** Heat lifts the z speeds where there is smoke. */
  private lift(h: number): void {
    if (this.heat === 0) return;
    const kn = this.kn;
    if (kn) {
      kn.fn.grid3_lift(kn.gi, kn.gf);
      return;
    }
    const n = this.n;
    const nn = n * n;
    const s = this.s;
    const w = this.w;
    const k0 = h * this.heat;
    for (let k = 0; k <= n; k++) {
      for (let c = 0; c < nn; c++) {
        const below = k > 0 ? (s[(k - 1) * nn + c] as number) : 0;
        const above = k < n ? (s[k * nn + c] as number) : 0;
        const d = k > 0 && k < n ? 0.5 * (below + above) : below + above;
        if (d !== 0) w[k * nn + c] = (w[k * nn + c] as number) + k0 * d;
      }
    }
  }

  /** The speed of body b at a point, in `cvx`, `cvy`, `cvz`. */
  private bodyV(w: World3, b: number, x: number, y: number, z: number): void {
    const rx = x - (w.p[b * 3] as number);
    const ry = y - (w.p[b * 3 + 1] as number);
    const rz = z - (w.p[b * 3 + 2] as number);
    const wx = w.w[b * 3] as number;
    const wy = w.w[b * 3 + 1] as number;
    const wz = w.w[b * 3 + 2] as number;
    this.cvx = (w.v[b * 3] as number) + wy * rz - wz * ry;
    this.cvy = (w.v[b * 3 + 1] as number) + wz * rx - wx * rz;
    this.cvz = (w.v[b * 3 + 2] as number) + wx * ry - wy * rx;
  }

  /** Faces next to a solid cell carry the solid's speed: the air cannot go into it, and a moving body pushes it. */
  private solidFaces(w: World3 | undefined): void {
    if (!w) return;
    const kn = this.kn;
    if (kn) {
      // each body's place, speed and spin go to the arena; the loop works out each face's speed as `bodyV` does
      const sb = this.bodyRows;
      for (let b = 0; b < w.n; b++) {
        const o = b * 9;
        const q = b * 3;
        sb[o] = w.p[q] as number;
        sb[o + 1] = w.p[q + 1] as number;
        sb[o + 2] = w.p[q + 2] as number;
        sb[o + 3] = w.v[q] as number;
        sb[o + 4] = w.v[q + 1] as number;
        sb[o + 5] = w.v[q + 2] as number;
        sb[o + 6] = w.w[q] as number;
        sb[o + 7] = w.w[q + 1] as number;
        sb[o + 8] = w.w[q + 2] as number;
      }
      kn.fn.grid3_solid_faces(kn.gi, kn.gf);
      return;
    }
    const n = this.n;
    const W1 = n + 1;
    const own = this.own;
    const still = this.still;
    for (let k = 0; k < n; k++) {
      const z = this.z0 + (k + 0.5) * this.dz;
      for (let j = 0; j < n; j++) {
        const y = this.y0 + (j + 0.5) * this.dy;
        const c0 = (k * n + j) * n;
        for (let i = 0; i <= n; i++) {
          const l = i > 0 ? (own[c0 + i - 1] as number) : -1;
          const r = i < n ? (own[c0 + i] as number) : -1;
          const b = l >= 0 ? l : r;
          if (b < 0) continue;
          if (still[b] === 1) {
            this.u[(k * n + j) * W1 + i] = 0;
            continue;
          }
          this.bodyV(w, b, this.x0 + i * this.dx, y, z);
          this.u[(k * n + j) * W1 + i] = this.cvx;
        }
      }
    }
    for (let k = 0; k < n; k++) {
      const z = this.z0 + (k + 0.5) * this.dz;
      for (let j = 0; j <= n; j++) {
        const y = this.y0 + j * this.dy;
        for (let i = 0; i < n; i++) {
          const lo = j > 0 ? (own[(k * n + j - 1) * n + i] as number) : -1;
          const hi = j < n ? (own[(k * n + j) * n + i] as number) : -1;
          const b = lo >= 0 ? lo : hi;
          if (b < 0) continue;
          if (still[b] === 1) {
            this.v[(k * W1 + j) * n + i] = 0;
            continue;
          }
          this.bodyV(w, b, this.x0 + (i + 0.5) * this.dx, y, z);
          this.v[(k * W1 + j) * n + i] = this.cvy;
        }
      }
    }
    for (let k = 0; k <= n; k++) {
      const z = this.z0 + k * this.dz;
      for (let j = 0; j < n; j++) {
        const y = this.y0 + (j + 0.5) * this.dy;
        for (let i = 0; i < n; i++) {
          const lo = k > 0 ? (own[((k - 1) * n + j) * n + i] as number) : -1;
          const hi = k < n ? (own[(k * n + j) * n + i] as number) : -1;
          const b = lo >= 0 ? lo : hi;
          if (b < 0) continue;
          if (still[b] === 1) {
            this.w[(k * n + j) * n + i] = 0;
            continue;
          }
          this.bodyV(w, b, this.x0 + (i + 0.5) * this.dx, y, z);
          this.w[(k * n + j) * n + i] = this.cvz;
        }
      }
    }
  }

  /** The flow's divergence in each air cell (1/s); 0 in solid cells. */
  private divergence(out: Float64Array): void {
    const n = this.n;
    const W1 = n + 1;
    const { u, v, w, own } = this;
    const idx = 1 / this.dx;
    const idy = 1 / this.dy;
    const idz = 1 / this.dz;
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const c = (k * n + j) * n + i;
          out[c] = (own[c] as number) >= 0 ? 0 : ((u[(k * n + j) * W1 + i + 1] as number) - (u[(k * n + j) * W1 + i] as number)) * idx + ((v[(k * W1 + j + 1) * n + i] as number) - (v[(k * W1 + j) * n + i] as number)) * idy + ((w[((k + 1) * n + j) * n + i] as number) - (w[c] as number)) * idz;
        }
      }
    }
  }

  /**
   * The projection: solve Σ w (p_nb − p) = div over the air cells, with p = 0 outside the box (open air) and no term for
   * a solid neighbour, by red-black over-relaxed passes; then take the gradient off the faces.
   */
  private project(part = 0): void {
    const kn = this.kn;
    if (kn) {
      if (part === 0) kn.fn.grid3_project(kn.gi, kn.gf);
      else if (part === 1) kn.fn.grid3_project_a(kn.gi, kn.gf);
      else kn.fn.grid3_project_b(kn.gi, kn.gf);
      return;
    }
    const n = this.n;
    const nn = n * n;
    const W1 = n + 1;
    const S = n + 2;
    const SS = S * S;
    const { own, p, div, wl, wr, wd, wu, wb, wf, inv, fix, fixed, u, v, w } = this;
    const wx = 1 / (this.dx * this.dx);
    const wy = 1 / (this.dy * this.dy);
    const wz = 1 / (this.dz * this.dz);
    const ip = 1 / (2 * wx + 2 * wy + 2 * wz);
    const ax = OMEGA * ip * wx;
    const ay = OMEGA * ip * wy;
    const az = OMEGA * ip * wz;
    const idx = 1 / this.dx;
    const idy = 1 / this.dy;
    const idz = 1 / this.dz;
    let nf0 = 0;
    let nf1 = 0;
    const half = n * nn;
    const { rowLo, rowHi } = this;
    if (part === 2) {
      nf0 = this.nf0;
      nf1 = this.nf1;
    }
    for (let k = 0; k < (part === 2 ? 0 : n); k++) {
      for (let j = 0; j < n; j++) {
        // the span of air in this row: the solid cells outside it (a floor, a wall) are not solved, only held at p = 0
        const c0 = (k * n + j) * n;
        let lo = 0;
        while (lo < n && (own[c0 + lo] as number) >= 0) lo++;
        let hi = n;
        while (hi > lo && (own[c0 + hi - 1] as number) >= 0) hi--;
        rowLo[k * n + j] = lo;
        rowHi[k * n + j] = hi;
        const qrow = ((k + 1) * S + (j + 1)) * S + 1;
        if (lo > 0) p.fill(0, qrow, qrow + lo);
        if (hi < n) p.fill(0, qrow + hi, qrow + n);
        for (let i = lo; i < hi; i++) {
          const c = c0 + i;
          const q = qrow + i;
          const odd = (i + j + k) & 1;
          if ((own[c] as number) >= 0) {
            inv[q] = 0;
            div[q] = 0;
            p[q] = 0;
            if (odd === 0) fix[nf0++] = q;
            else fix[half + nf1++] = q;
            continue;
          }
          const l = i === 0 || (own[c - 1] as number) < 0 ? wx : 0;
          const r = i === n - 1 || (own[c + 1] as number) < 0 ? wx : 0;
          const d = j === 0 || (own[c - n] as number) < 0 ? wy : 0;
          const t = j === n - 1 || (own[c + n] as number) < 0 ? wy : 0;
          const b = k === 0 || (own[c - nn] as number) < 0 ? wz : 0;
          const f = k === n - 1 || (own[c + nn] as number) < 0 ? wz : 0;
          const dv = ((u[(k * n + j) * W1 + i + 1] as number) - (u[(k * n + j) * W1 + i] as number)) * idx + ((v[(k * W1 + j + 1) * n + i] as number) - (v[(k * W1 + j) * n + i] as number)) * idy + ((w[c + nn] as number) - (w[c] as number)) * idz;
          // a cell a body has just left held p = 0: start it from the mean of its neighbours (read from the pressure alone)
          if ((p[q] as number) === 0) {
            const s6 = (p[q - 1] as number) + (p[q + 1] as number) + (p[q - S] as number) + (p[q + S] as number) + (p[q - SS] as number) + (p[q + SS] as number);
            if (s6 !== 0) p[q] = s6 / 6;
          }
          if (l !== 0 && r !== 0 && d !== 0 && t !== 0 && b !== 0 && f !== 0) {
            div[q] = OMEGA * ip * dv;
            continue;
          }
          const sum = l + r + d + t + b + f;
          const iq = sum > 0 ? OMEGA / sum : 0;
          wl[q] = i === 0 ? 0 : l * iq;
          wr[q] = i === n - 1 ? 0 : r * iq;
          wd[q] = j === 0 ? 0 : d * iq;
          wu[q] = j === n - 1 ? 0 : t * iq;
          wb[q] = k === 0 ? 0 : b * iq;
          wf[q] = k === n - 1 ? 0 : f * iq;
          inv[q] = iq;
          div[q] = iq * dv;
          if (odd === 0) fix[nf0++] = q;
          else fix[half + nf1++] = q;
        }
      }
    }
    this.nf0 = nf0;
    this.nf1 = nf1;
    const pend = part === 1 ? SMOKE3_PASSES_A : SMOKE3_PASSES;
    for (let pass = part === 2 ? SMOKE3_PASSES_A : 0; pass < pend; pass++) {
      for (let colour = 0; colour < 2; colour++) {
        const f0 = colour === 0 ? 0 : half;
        const f1 = f0 + (colour === 0 ? nf0 : nf1);
        for (let m = f0; m < f1; m++) {
          const q = fix[m] as number;
          const iq = inv[q] as number;
          if (iq === 0) {
            fixed[m] = 0;
            continue;
          }
          fixed[m] = KEEP * (p[q] as number) + (wl[q] as number) * (p[q - 1] as number) + (wr[q] as number) * (p[q + 1] as number) + (wd[q] as number) * (p[q - S] as number) + (wu[q] as number) * (p[q + S] as number) + (wb[q] as number) * (p[q - SS] as number) + (wf[q] as number) * (p[q + SS] as number) - (div[q] as number);
        }
        for (let k = 0; k < n; k++) {
          for (let j = 0; j < n; j++) {
            const row = ((k + 1) * S + (j + 1)) * S + 1;
            const lo = rowLo[k * n + j] as number;
            const end = row + (rowHi[k * n + j] as number);
            for (let q = row + lo + ((colour + j + k + lo) & 1); q < end; q += 2) {
              p[q] = KEEP * (p[q] as number) + ax * ((p[q - 1] as number) + (p[q + 1] as number)) + ay * ((p[q - S] as number) + (p[q + S] as number)) + az * ((p[q - SS] as number) + (p[q + SS] as number)) - (div[q] as number);
            }
          }
        }
        for (let m = f0; m < f1; m++) p[fix[m] as number] = fixed[m] as number;
      }
    }
    if (part === 1) return;
    // take the gradient off every face between two air cells, or an air cell and the open air outside (p = 0 there)
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < n; j++) {
        const row = ((k + 1) * S + (j + 1)) * S;
        const c0 = (k * n + j) * n;
        for (let i = 0; i <= n; i++) {
          if ((i > 0 && (own[c0 + i - 1] as number) >= 0) || (i < n && (own[c0 + i] as number) >= 0)) continue;
          u[(k * n + j) * W1 + i] = (u[(k * n + j) * W1 + i] as number) - ((p[row + i + 1] as number) - (p[row + i] as number)) * idx;
        }
      }
    }
    for (let k = 0; k < n; k++) {
      for (let j = 0; j <= n; j++) {
        for (let i = 0; i < n; i++) {
          if ((j > 0 && (own[(k * n + j - 1) * n + i] as number) >= 0) || (j < n && (own[(k * n + j) * n + i] as number) >= 0)) continue;
          v[(k * W1 + j) * n + i] = (v[(k * W1 + j) * n + i] as number) - ((p[((k + 1) * S + j + 1) * S + i + 1] as number) - (p[((k + 1) * S + j) * S + i + 1] as number)) * idy;
        }
      }
    }
    for (let k = 0; k <= n; k++) {
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          if ((k > 0 && (own[((k - 1) * n + j) * n + i] as number) >= 0) || (k < n && (own[(k * n + j) * n + i] as number) >= 0)) continue;
          w[(k * n + j) * n + i] = (w[(k * n + j) * n + i] as number) - ((p[((k + 1) * S + j + 1) * S + i + 1] as number) - (p[(k * S + j + 1) * S + i + 1] as number)) * idz;
        }
      }
    }
  }

  /** Smoke is carried back along the flow now, and scaled so a closed box keeps its mass (design 9.4). */
  private advectSmoke(h: number): void {
    const kn = this.kn;
    if (kn) {
      kn.fn.grid3_advect_smoke(kn.gi, kn.gf);
      this.lastScale = kn.F[GF.last] as number;
      const s = this.s;
      this.s = this.s2;
      this.s2 = s;
      const I = kn.I;
      const is = I[GI.s] as number;
      I[GI.s] = I[GI.s2] as number;
      I[GI.s2] = is;
      return;
    }
    const n = this.n;
    const nn = n * n;
    const W1 = n + 1;
    const { u, v, w, s, s2, own } = this;
    const kx = h / this.dx;
    const ky = h / this.dy;
    const kz = h / this.dz;
    const lim = n - 0.5;
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const c = (k * n + j) * n + i;
          if ((own[c] as number) >= 0) {
            s2[c] = 0;
            continue;
          }
          const uu = 0.5 * ((u[(k * n + j) * W1 + i] as number) + (u[(k * n + j) * W1 + i + 1] as number));
          const vv = 0.5 * ((v[(k * W1 + j) * n + i] as number) + (v[(k * W1 + j + 1) * n + i] as number));
          const ww = 0.5 * ((w[c] as number) + (w[c + nn] as number));
          if (uu === 0 && vv === 0 && ww === 0) {
            s2[c] = s[c] as number;
            continue;
          }
          let fx = i - kx * uu;
          let fy = j - ky * vv;
          let fz = k - kz * ww;
          if (!(fx >= -0.5 && fx <= lim && fy >= -0.5 && fy <= lim && fz >= -0.5 && fz <= lim)) {
            s2[c] = 0;
            continue;
          }
          if (fx < 0) fx = 0;
          else if (fx > n - 1) fx = n - 1;
          if (fy < 0) fy = 0;
          else if (fy > n - 1) fy = n - 1;
          if (fz < 0) fz = 0;
          else if (fz > n - 1) fz = n - 1;
          let a = fx | 0;
          let b = fy | 0;
          let e = fz | 0;
          if (a > n - 2) a = n - 2;
          if (b > n - 2) b = n - 2;
          if (e > n - 2) e = n - 2;
          const tx = fx - a;
          const ty = fy - b;
          const tz = fz - e;
          const q = e * nn + b * n + a;
          // only the air cells round the point count: a solid's cells hold none and would thin the smoke beside it
          const m0 = (own[q] as number) < 0 ? (1 - tx) * (1 - ty) * (1 - tz) : 0;
          const m1 = (own[q + 1] as number) < 0 ? tx * (1 - ty) * (1 - tz) : 0;
          const m2 = (own[q + n] as number) < 0 ? (1 - tx) * ty * (1 - tz) : 0;
          const m3 = (own[q + n + 1] as number) < 0 ? tx * ty * (1 - tz) : 0;
          const m4 = (own[q + nn] as number) < 0 ? (1 - tx) * (1 - ty) * tz : 0;
          const m5 = (own[q + nn + 1] as number) < 0 ? tx * (1 - ty) * tz : 0;
          const m6 = (own[q + nn + n] as number) < 0 ? (1 - tx) * ty * tz : 0;
          const m7 = (own[q + nn + n + 1] as number) < 0 ? tx * ty * tz : 0;
          const sum = m0 + m1 + m2 + m3 + m4 + m5 + m6 + m7;
          s2[c] = sum > 0 ? (m0 * (s[q] as number) + m1 * (s[q + 1] as number) + m2 * (s[q + n] as number) + m3 * (s[q + n + 1] as number) + m4 * (s[q + nn] as number) + m5 * (s[q + nn + 1] as number) + m6 * (s[q + nn + n] as number) + m7 * (s[q + nn + n + 1] as number)) / sum : 0;
        }
      }
    }
    let before = 0;
    let after = 0;
    for (let c = 0; c < s.length; c++) {
      before += s[c] as number;
      after += s2[c] as number;
    }
    // while the source makes smoke the mass is not kept anyway; otherwise scale to what there was less what flowed out
    this.lastScale = 1;
    if (after > 1e-12 && before > 1e-12 && !(this.hasSource && this.making)) {
      const out = (h * this.outflow(s)) / (this.dx * this.dy * this.dz);
      let f = (before - out) / after;
      // 0.5% for each 1/60 s of the step (a grid in space steps 1/30 s, design 9.8)
      const per = h * 60;
      const cap = this.swirl > 0 ? SCALE_CAP * per * (1 + this.swirl) : SCALE_CAP * per;
      if (f > 1 + cap) f = 1 + cap;
      else if (f < 1 - cap) f = 1 - cap;
      if (f !== 1) for (let c = 0; c < s2.length; c++) s2[c] = (s2[c] as number) * f;
      this.lastScale = f;
    }
    this.s = s2;
    this.s2 = s;
  }

  /** Smoke (density times area per second) leaving through the open faces of the box, by the flow there now. */
  private outflow(s: Float32Array): number {
    const n = this.n;
    const W1 = n + 1;
    const { u, v, w } = this;
    let f = 0;
    const ayz = this.dy * this.dz;
    const axz = this.dx * this.dz;
    const axy = this.dx * this.dy;
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < n; j++) {
        const l = -(u[(k * n + j) * W1] as number);
        const r = u[(k * n + j) * W1 + n] as number;
        if (l > 0) f += l * (s[(k * n + j) * n] as number) * ayz;
        if (r > 0) f += r * (s[(k * n + j) * n + n - 1] as number) * ayz;
      }
    }
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < n; i++) {
        const d = -(v[k * W1 * n + i] as number);
        const t = v[(k * W1 + n) * n + i] as number;
        if (d > 0) f += d * (s[k * n * n + i] as number) * axz;
        if (t > 0) f += t * (s[(k * n + n - 1) * n + i] as number) * axz;
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const d = -(w[j * n + i] as number);
        const t = w[n * n * n + j * n + i] as number;
        if (d > 0) f += d * (s[j * n + i] as number) * axy;
        if (t > 0) f += t * (s[(n - 1) * n * n + j * n + i] as number) * axy;
      }
    }
    return f;
  }

  /**
   * The air pushes each body it flows past: the mean air speed in the air cells beside the body against the body's
   * speed gives a drag `½ ρ Cd D² |Δ| Δ`, D the body's width, kept to at most half the speed difference in one step.
   */
  private drag(w: World3 | undefined, h: number): void {
    if (!w) return;
    const nb = w.n;
    this.fx.fill(0);
    this.fy.fill(0);
    this.fz.fill(0);
    let any = false;
    for (let b = 0; b < nb; b++) if (w.type[b] === DYNAMIC && !w.gone.has(b)) any = true;
    if (!any) return;
    const n = this.n;
    const nn = n * n;
    const W1 = n + 1;
    const { own, u, v } = this;
    const wf = this.w;
    this.sumX.fill(0);
    this.sumY.fill(0);
    this.sumZ.fill(0);
    this.cnt.fill(0);
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const c = (k * n + j) * n + i;
          if ((own[c] as number) >= 0) continue;
          const l = i > 0 ? (own[c - 1] as number) : -1;
          const r = i < n - 1 ? (own[c + 1] as number) : -1;
          const d = j > 0 ? (own[c - n] as number) : -1;
          const t = j < n - 1 ? (own[c + n] as number) : -1;
          const bk = k > 0 ? (own[c - nn] as number) : -1;
          const f = k < n - 1 ? (own[c + nn] as number) : -1;
          if (l < 0 && r < 0 && d < 0 && t < 0 && bk < 0 && f < 0) continue;
          this.cvx = 0.5 * ((u[(k * n + j) * W1 + i] as number) + (u[(k * n + j) * W1 + i + 1] as number));
          this.cvy = 0.5 * ((v[(k * W1 + j) * n + i] as number) + (v[(k * W1 + j + 1) * n + i] as number));
          this.cvz = 0.5 * ((wf[c] as number) + (wf[c + nn] as number));
          // each body beside this cell, once
          if (l >= 0) this.near(w, l);
          if (r >= 0 && r !== l) this.near(w, r);
          if (d >= 0 && d !== l && d !== r) this.near(w, d);
          if (t >= 0 && t !== l && t !== r && t !== d) this.near(w, t);
          if (bk >= 0 && bk !== l && bk !== r && bk !== d && bk !== t) this.near(w, bk);
          if (f >= 0 && f !== l && f !== r && f !== d && f !== t && f !== bk) this.near(w, f);
        }
      }
    }
    // a body smaller than a cell fills no cell and so has no air beside it: it feels the air at its centre instead
    for (let b = 0; b < nb; b++) {
      if (this.cnt[b] !== 0 || w.type[b] !== DYNAMIC || w.gone.has(b)) continue;
      const x = w.p[b * 3] as number;
      const y = w.p[b * 3 + 1] as number;
      const z = w.p[b * 3 + 2] as number;
      if (!(x > this.x0 && x < this.x1 && y > this.y0 && y < this.y1 && z > this.z0 && z < this.z1)) continue;
      this.flowAt(x, y, z);
      this.sumX[b] = this.ox;
      this.sumY[b] = this.oy;
      this.sumZ[b] = this.oz;
      this.cnt[b] = 1;
    }
    const k0 = 0.5 * AIR_DENSITY * DRAG_CD;
    for (let b = 0; b < nb; b++) {
      const m = this.cnt[b] as number;
      if (m === 0) continue;
      const rx = (this.sumX[b] as number) / m - (w.v[b * 3] as number);
      const ry = (this.sumY[b] as number) / m - (w.v[b * 3 + 1] as number);
      const rz = (this.sumZ[b] as number) / m - (w.v[b * 3 + 2] as number);
      const sp = Math.sqrt(rx * rx + ry * ry + rz * rz);
      if (!(sp > 1e-9)) continue;
      const D = 2 * (w.reach[b] as number);
      const fk = k0 * D * D * sp;
      let fx = fk * rx;
      let fy = fk * ry;
      let fz = fk * rz;
      const cap = (0.5 * (w.mass[b] as number) * sp) / h;
      const fl = fk * sp;
      if (fl > cap) {
        fx *= cap / fl;
        fy *= cap / fl;
        fz *= cap / fl;
      }
      // a push too small to see does not keep a resting body awake
      if (Math.min(fl, cap) * h * (w.invM[b] as number) < 1e-5) continue;
      this.fx[b] = fx;
      this.fy[b] = fy;
      this.fz[b] = fz;
    }
  }

  private near(w: World3, b: number): void {
    if (w.type[b] !== DYNAMIC) return;
    this.sumX[b] = (this.sumX[b] as number) + this.cvx;
    this.sumY[b] = (this.sumY[b] as number) + this.cvy;
    this.sumZ[b] = (this.sumZ[b] as number) + this.cvz;
    this.cnt[b] = (this.cnt[b] as number) + 1;
  }

  private checkHealth(): void {
    const kn = this.kn;
    if (kn) {
      if (kn.fn.grid3_health(kn.gi) !== 0) this.blowUp();
      return;
    }
    let bad = false;
    const u = this.u;
    const v = this.v;
    const w = this.w;
    for (let k = 0; k < u.length && !bad; k++) {
      const x = u[k] as number;
      if (!(x > -BLOW_UP && x < BLOW_UP)) bad = true;
    }
    for (let k = 0; k < v.length && !bad; k++) {
      const x = v[k] as number;
      if (!(x > -BLOW_UP && x < BLOW_UP)) bad = true;
    }
    for (let k = 0; k < w.length && !bad; k++) {
      const x = w[k] as number;
      if (!(x > -BLOW_UP && x < BLOW_UP)) bad = true;
    }
    if (!bad) return;
    this.blowUp();
  }

  /** The grid blew up: everything is set to rest and the grid stops. */
  private blowUp(): void {
    this.life.send('blowUp');
    this.u.fill(0);
    this.v.fill(0);
    this.w.fill(0);
    this.s.fill(0);
    this.T.fill(0);
    this.F.fill(0);
    this.fx.fill(0);
    this.fy.fill(0);
    this.fz.fill(0);
  }

  /* ------------------------------ measures ------------------------------ */

  /** Total smoke: density times cell volume. */
  mass(): number {
    const kn = this.kn;
    if (kn) {
      kn.fn.grid3_smoke_sum(kn.gi, kn.gf);
      return (kn.F[GF.out] as number) * this.dx * this.dy * this.dz;
    }
    let m = 0;
    for (let c = 0; c < this.s.length; c++) m += this.s[c] as number;
    return m * this.dx * this.dy * this.dz;
  }

  /** The largest divergence of the flow over the air cells (1/s), now. */
  maxDivergence(): number {
    const d = new Float64Array(this.n * this.n * this.n);
    this.divergence(d);
    let m = 0;
    for (let c = 0; c < d.length; c++) m = Math.max(m, Math.abs(d[c] as number));
    return m;
  }

  /** The fastest air (m/s). */
  maxSpeed(): number {
    const kn = this.kn;
    if (kn) {
      kn.fn.grid3_max_speed(kn.gi, kn.gf);
      return kn.F[GF.out] as number;
    }
    let m = 0;
    for (let k = 0; k < this.u.length; k++) m = Math.max(m, Math.abs(this.u[k] as number));
    for (let k = 0; k < this.v.length; k++) m = Math.max(m, Math.abs(this.v[k] as number));
    for (let k = 0; k < this.w.length; k++) m = Math.max(m, Math.abs(this.w[k] as number));
    return m;
  }

  /* ------------------------------ checkpoints ------------------------------ */

  /** How many Float32 values a checkpoint holds: the flow, the smoke, the pressure, and a fire's `T` and `F`. */
  private stateCount(): number {
    return this.u.length + this.v.length + this.w.length + this.s.length + this.p.length + 2 * this.T.length;
  }

  /**
   * Everything a step reads that changes: a short header, the drag to apply (Float64, one number a body and axis), then
   * the grid's Float32 values packed two to a Float64 slot (half the memory, design 9.8). Bytes are copied, never read
   * as numbers, so every bit comes back.
   */
  save(): Float64Array {
    const nb = this.fx.length;
    const head = 4 + 3 * nb;
    const count = this.stateCount();
    const out = new Float64Array(head + Math.ceil(count / 2));
    out[0] = this.n;
    out[1] = this.unstable ? 1 : 0;
    out[2] = nb;
    out[3] = this.alive ? 1 : 0;
    out.set(this.fx, 4);
    out.set(this.fy, 4 + nb);
    out.set(this.fz, 4 + 2 * nb);
    const f = new Float32Array(out.buffer, out.byteOffset + head * 8, count + (count & 1));
    let k = 0;
    f.set(this.u, k);
    k += this.u.length;
    f.set(this.v, k);
    k += this.v.length;
    f.set(this.w, k);
    k += this.w.length;
    f.set(this.s, k);
    k += this.s.length;
    f.set(this.p, k);
    k += this.p.length;
    if (this.T.length > 0) {
      f.set(this.T, k);
      k += this.T.length;
      f.set(this.F, k);
    }
    return out;
  }

  load(src: Float64Array): void {
    restoreLife(this.life, src[1] === 1);
    this.wallsMoved++;
    const nb = src[2] as number;
    this.alive = src[3] === 1;
    if (this.fx.length !== nb) {
      this.fx = new Float64Array(nb);
      this.fy = new Float64Array(nb);
      this.fz = new Float64Array(nb);
    }
    this.fx.set(src.subarray(4, 4 + nb));
    this.fy.set(src.subarray(4 + nb, 4 + 2 * nb));
    this.fz.set(src.subarray(4 + 2 * nb, 4 + 3 * nb));
    const head = 4 + 3 * nb;
    const count = this.stateCount();
    const f = new Float32Array(src.buffer, src.byteOffset + head * 8, count);
    let k = 0;
    this.u.set(f.subarray(k, k + this.u.length));
    k += this.u.length;
    this.v.set(f.subarray(k, k + this.v.length));
    k += this.v.length;
    this.w.set(f.subarray(k, k + this.w.length));
    k += this.w.length;
    this.s.set(f.subarray(k, k + this.s.length));
    k += this.s.length;
    this.p.set(f.subarray(k, k + this.p.length));
    k += this.p.length;
    if (this.T.length > 0) {
      this.T.set(f.subarray(k, k + this.T.length));
      k += this.T.length;
      this.F.set(f.subarray(k, k + this.F.length));
    }
  }

  /** The size of a checkpoint in Float64 slots, before it is made. */
  saveLength(): number {
    return 4 + 3 * this.fx.length + Math.ceil(this.stateCount() / 2);
  }
}

/** Marks the cells of a source on an n³ grid over a box (1 where smoke or fuel is made); a point fills the cell it is in. */
export function markSource3(out: Uint8Array, g: { readonly n: number; readonly x0: number; readonly y0: number; readonly z0: number; readonly dx: number; readonly dy: number; readonly dz: number }, src: SmokeSource3 | undefined): boolean {
  out.fill(0);
  if (!src) return false;
  const n = g.n;
  if (src.kind === 'point') return markPoint3(out, g, src.x, src.y, src.z);
  let any = false;
  const nf = src.kind === 'hull' ? src.planes.length / 4 : 0;
  for (let k = 0; k < n; k++) {
    const z = g.z0 + (k + 0.5) * g.dz;
    for (let j = 0; j < n; j++) {
      const y = g.y0 + (j + 0.5) * g.dy;
      for (let i = 0; i < n; i++) {
        const x = g.x0 + (i + 0.5) * g.dx;
        let inside: boolean;
        if (src.kind === 'sphere') inside = (x - src.x) * (x - src.x) + (y - src.y) * (y - src.y) + (z - src.z) * (z - src.z) <= src.r * src.r;
        else {
          inside = true;
          for (let f = 0; f < nf && inside; f++) if ((src.planes[4 * f] as number) * x + (src.planes[4 * f + 1] as number) * y + (src.planes[4 * f + 2] as number) * z > (src.planes[4 * f + 3] as number)) inside = false;
        }
        if (inside) {
          out[(k * n + j) * n + i] = 1;
          any = true;
        }
      }
    }
  }
  if (any) return true;
  // a source smaller than a cell still makes smoke in the cell its centre is in
  return markPoint3(out, g, src.x, src.y, src.z);
}

function markPoint3(out: Uint8Array, g: { readonly n: number; readonly x0: number; readonly y0: number; readonly z0: number; readonly dx: number; readonly dy: number; readonly dz: number }, x: number, y: number, z: number): boolean {
  const n = g.n;
  const i = Math.floor((x - g.x0) / g.dx);
  const j = Math.floor((y - g.y0) / g.dy);
  const k = Math.floor((z - g.z0) / g.dz);
  if (i >= 0 && i < n && j >= 0 && j < n && k >= 0 && k < n) {
    out[(k * n + j) * n + i] = 1;
    return true;
  }
  return false;
}
