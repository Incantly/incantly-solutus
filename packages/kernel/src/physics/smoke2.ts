/**
 * Smoke in the plane (docs/features/physics/design.md 9.4): stable fluids (Stam 1999) on an `n` by `n` grid over a box.
 *
 * The grid is a staggered (MAC) grid: smoke density and pressure live at cell centres, the flow's x speeds on the
 * vertical faces and its y speeds on the horizontal faces. Then the divergence, the pressure's gradient and the
 * pressure solve's five-point Laplacian are the same operator, so after the projection the flow's divergence is the
 * pressure solve's own residual, and "no volume lost" can be measured (design 11.5).
 *
 * One step of `h`:
 *  1. the cells inside solid shapes and bodies are marked, each with the body that fills it;
 *  2. the flow is carried along itself (semi-Lagrangian, back along the flow, bilinear), air from outside the box
 *     comes in with the wind;
 *  3. heat lifts the flow where there is smoke (a hot plume rises);
 *  4. faces next to solids take the solid's own speed there, so a moving body stirs the air;
 *  5. the projection: 20 red-black over-relaxed passes of the pressure solve, warm-started from the last step, with
 *     open edges (the air outside the box is at rest pressure) and closed solids, then the gradient is taken off;
 *  6. the smoke is carried along the new flow, and the source makes smoke;
 *  7. the air pushes each body it flows past (a drag force, `drag`), applied at the next step (design 9.6).
 *
 * Exact maths only (`+ - * /` and `Math.sqrt`), typed arrays made once, no garbage in a step, every loop in a fixed
 * order: the same film on every replay, seek and computer.
 */
import type { DropsView, FireParams } from './fire2';
import { advectFire, burnFuel, confine, coolFire, fireLift, fireSource, quench } from './fire2';
import { StateMachine } from '../contracts/state-machine';
import { GRID_MACHINE } from './grid-life';
import type { World2 } from './world2';
import { BodyType, FK } from './world2';

/** Pressure passes a step (design 9.4). */
export const SMOKE_PASSES = 20;
/** Over-relaxation of the pressure passes: near the best for a 64 grid, so 20 passes do the work of a few hundred plain ones. */
const OMEGA = 1.8;
/** Projections of the start's flow, once (see `settle`). */
const START_PROJECTIONS = 10;
/** What an over-relaxed pass keeps of a cell's old value. */
const KEEP = 1 - OMEGA;
/** The most the smoke is scaled by in a step to keep its mass: 0.5% (more with `swirl`, see `advectSmoke`). */
const SCALE_CAP = 0.005;
/** Air, kg per m³; the plane is 1 m deep. */
export const AIR_DENSITY = 1.2;
/** Drag number of a blunt body in a flow. */
const DRAG_CD = 1;
/** Speeds over this blow the grid up (errors.md 4, `unstable_world`). */
const BLOW_UP = 1e6;

/** Where smoke is made, in world space. */
export type SmokeSource2 =
  | { readonly kind: 'point'; readonly x: number; readonly y: number }
  | { readonly kind: 'circle'; readonly x: number; readonly y: number; readonly r: number }
  | { readonly kind: 'poly'; readonly pts: readonly { readonly x: number; readonly y: number }[] };

export interface SmokeSetup2 {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly n: number;
  /** A fire grid: the settings of its fire (design 9.7); without it, the grid is plain smoke. */
  readonly fire?: FireParams;
}

export class Smoke2 {
  readonly n: number;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly dx: number;
  readonly dy: number;
  /** x speeds on the vertical faces: (n + 1) by n, face (i, j) at x0 + i dx, y0 + (j + ½) dy; index j (n + 1) + i. */
  u: Float64Array;
  /** y speeds on the horizontal faces: n by (n + 1), face (i, j) at x0 + (i + ½) dx, y0 + j dy; index j n + i. */
  v: Float64Array;
  /** Smoke density at the cell centres (1 is thick smoke); index j n + i. */
  s: Float64Array;
  /**
   * Pressure (times h / ρ) at the cell centres, kept as the next step's first guess. Padded by one ghost cell each side
   * (the open air outside the box, at rest pressure 0): index (j + 1) (n + 2) + i + 1.
   */
  p: Float64Array;
  /** The body that fills each cell, or -1 for air. */
  readonly own: Int32Array;
  /** The same for the walls only (shapes that do not move), marked once. */
  private readonly own0: Int32Array;
  /** Cells where the source makes smoke (or, for a fire, fuel). */
  readonly src: Uint8Array;
  private hasSource = false;
  /* ------------------------------ fire (design 9.7), empty for plain smoke ------------------------------ */
  /** The fire's settings; undefined for a smoke grid. */
  fire: FireParams | undefined;
  /** Temperature (°C above the air) and fuel at the cell centres, and their copies for carrying; length 0 without fire. */
  T: Float64Array;
  F: Float64Array;
  T2: Float64Array;
  F2: Float64Array;
  /** The cells a liquid drop was in at the last step (water, design 9.7 step 7). */
  readonly wet: Uint8Array;
  /** True once something was above the ignite point or held fuel (a fire that has been alight can go out). */
  alive = false;
  /** Curls kept by vorticity confinement, 0 to 10 (0 is none: the film is exactly smoke's own). */
  swirl = 0;
  /** Scratch of the swirl: the curl at each cell and the force on it. */
  readonly om: Float64Array;
  readonly fcx: Float64Array;
  readonly fcy: Float64Array;
  /** Scratch for carrying two fields at once. */
  readonly pair = new Float64Array(2);
  private u2: Float64Array;
  private v2: Float64Array;
  private s2: Float64Array;
  /** The pressure solve on the padded grid: divergence, the four neighbour weights and 1 / the diagonal. */
  private readonly div: Float64Array;
  private readonly wl: Float64Array;
  private readonly wr: Float64Array;
  private readonly wd: Float64Array;
  private readonly wu: Float64Array;
  private readonly inv: Float64Array;
  /**
   * The cells off the plain stencil (solids and the air beside them): even cells from 0, odd cells from n², each in
   * index order; and their new values in a pass.
   */
  private readonly fix: Int32Array;
  private readonly fixed: Float64Array;
  /** Wind (m/s): the air outside the box and coming in at its edges. */
  windX = 0;
  windY = 0;
  /** Lift of thick smoke, m/s² upward per unit of density (a hot plume). */
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
  /**
   * The air's drag on each body (N), found by the last smoke step and applied over the bodies' steps that follow it, so
   * bodies feel the air one step late, in a fixed order (design 9.6). Counted as `drag`.
   */
  fx = new Float64Array(0);
  fy = new Float64Array(0);
  private sumX = new Float64Array(0);
  private sumY = new Float64Array(0);
  private cnt = new Int32Array(0);
  /** The mass correction of the last step's smoke advection (1 is none). */
  lastScale = 1;
  /** Running, or `unstable` once a speed went over 1e6 or stopped being a number. */
  readonly life = new StateMachine(GRID_MACHINE, 'running');
  get unstable(): boolean {
    return this.life.is('unstable');
  }
  /** Scratch corners of one polygon in world space. */
  private cxs = new Float64Array(16);
  private cys = new Float64Array(16);

  constructor(setup: SmokeSetup2) {
    const n = Math.max(2, Math.round(setup.n));
    this.n = n;
    this.x0 = Math.min(setup.x0, setup.x1);
    this.x1 = Math.max(setup.x0, setup.x1);
    this.y0 = Math.min(setup.y0, setup.y1);
    this.y1 = Math.max(setup.y0, setup.y1);
    this.dx = (this.x1 - this.x0) / n;
    this.dy = (this.y1 - this.y0) / n;
    this.u = new Float64Array((n + 1) * n);
    this.v = new Float64Array(n * (n + 1));
    this.s = new Float64Array(n * n);
    const S = (n + 2) * (n + 2);
    this.p = new Float64Array(S);
    this.u2 = new Float64Array((n + 1) * n);
    this.v2 = new Float64Array(n * (n + 1));
    this.s2 = new Float64Array(n * n);
    this.div = new Float64Array(S);
    this.wl = new Float64Array(S);
    this.wr = new Float64Array(S);
    this.wd = new Float64Array(S);
    this.wu = new Float64Array(S);
    this.inv = new Float64Array(S);
    this.fix = new Int32Array(2 * n * n);
    this.fixed = new Float64Array(2 * n * n);
    this.own = new Int32Array(n * n).fill(-1);
    this.own0 = new Int32Array(n * n).fill(-1);
    this.src = new Uint8Array(n * n);
    // fire: temperature and fuel, made once; a smoke grid keeps them empty and skips their steps
    this.fire = setup.fire ? { ...setup.fire } : undefined;
    const nf = setup.fire ? n * n : 0;
    this.T = new Float64Array(nf);
    this.F = new Float64Array(nf);
    this.T2 = new Float64Array(nf);
    this.F2 = new Float64Array(nf);
    this.wet = new Uint8Array(nf);
    this.om = new Float64Array(n * n);
    this.fcx = new Float64Array(n * n);
    this.fcy = new Float64Array(n * n);
  }

  /** True when the grid has a source. */
  get sourced(): boolean {
    return this.hasSource;
  }

  /* ------------------------------ setting up ------------------------------ */

  /** The air at the start: still air moving with the wind, the source full of smoke. */
  start(windX: number, windY: number): void {
    this.windX = windX;
    this.windY = windY;
    this.u.fill(windX);
    this.v.fill(windY);
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

  /**
   * Makes the start's flow lose no volume round the solids and bodies where they are: the wind fills the box, also
   * where a ball stands, so the first projection has a large error to take off. Ten projections (200 passes) once at
   * the start do it; after that each step starts from the last step's pressure and 20 passes keep up.
   */
  settle(w: World2 | undefined): void {
    this.markSolids(w);
    this.solidFaces(w);
    for (let k = 0; k < START_PROJECTIONS; k++) this.project();
  }

  /** Marks the cells of the source; a point fills the cell it is in. */
  setSource(src: SmokeSource2 | undefined): void {
    this.hasSource = markSource(this.src, this, src);
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
  markSolids(w: World2 | undefined): void {
    if (!w) return;
    if (this.fx.length !== w.n || this.cnt.length !== w.n) {
      if (this.fx.length !== w.n) {
        this.fx = new Float64Array(w.n);
        this.fy = new Float64Array(w.n);
      }
      this.sumX = new Float64Array(w.n);
      this.sumY = new Float64Array(w.n);
      this.cnt = new Int32Array(w.n);
    }
    if (this.wallsMarkedAt !== this.wallsMoved) {
      this.wallsMarkedAt = this.wallsMoved;
      this.own0.fill(-1);
      for (let b = 0; b < w.n; b++) if (w.type[b] !== BodyType.Dynamic && !w.gone.has(b)) this.markBody(w, b, this.own0);
    }
    this.own.set(this.own0);
    for (let b = 0; b < w.n; b++) if (w.type[b] === BodyType.Dynamic && !w.gone.has(b)) this.markBody(w, b, this.own);
  }

  private markBody(w: World2, b: number, own: Int32Array): void {
    const c = w.qc[b] as number;
    const sn = w.qs[b] as number;
    const px = w.px[b] as number;
    const py = w.py[b] as number;
    const s0 = w.shape0[b] as number;
    const ns = w.shapeN[b] as number;
    for (let k = s0; k < s0 + ns; k++) {
      const sh = w.shapes[k];
      if (!sh) continue;
      if (sh.kind === 0) {
        const cx = px + c * sh.lcx - sn * sh.lcy;
        const cy = py + sn * sh.lcx + c * sh.lcy;
        this.markCircle(cx, cy, sh.radius, b, own);
        continue;
      }
      const nv = sh.lx.length;
      if (this.cxs.length < nv) {
        this.cxs = new Float64Array(nv * 2);
        this.cys = new Float64Array(nv * 2);
      }
      for (let q = 0; q < nv; q++) {
        const lx = sh.lx[q] as number;
        const ly = sh.ly[q] as number;
        this.cxs[q] = px + c * lx - sn * ly;
        this.cys[q] = py + sn * lx + c * ly;
      }
      if (nv === 2) this.markSegment(this.cxs[0] as number, this.cys[0] as number, this.cxs[1] as number, this.cys[1] as number, b, own);
      else this.markConvex(nv, b, own);
    }
  }

  /** The cell range [lo, hi] that a span of x (or y) covers, clipped to the grid; hi < lo when it misses. */
  private range(a: number, b: number, o: number, d: number): number {
    // packs lo and hi into one number to make no garbage: lo * 4096 + hi
    const lo = Math.max(0, Math.ceil((a - o) / d - 0.5));
    const hi = Math.min(this.n - 1, Math.floor((b - o) / d - 0.5));
    return hi < lo ? -1 : lo * 4096 + hi;
  }

  private markCircle(cx: number, cy: number, r: number, b: number, own: Int32Array): void {
    const rx = this.range(cx - r, cx + r, this.x0, this.dx);
    const ry = this.range(cy - r, cy + r, this.y0, this.dy);
    if (rx < 0 || ry < 0) return;
    const n = this.n;
    const r2 = r * r;
    for (let j = Math.floor(ry / 4096); j <= ry % 4096; j++) {
      const y = this.y0 + (j + 0.5) * this.dy - cy;
      for (let i = Math.floor(rx / 4096); i <= rx % 4096; i++) {
        const x = this.x0 + (i + 0.5) * this.dx - cx;
        if (x * x + y * y <= r2) own[j * n + i] = b;
      }
    }
  }

  private markConvex(nv: number, b: number, own: Int32Array): void {
    const xs = this.cxs;
    const ys = this.cys;
    let mnx = Infinity;
    let mxx = -Infinity;
    let mny = Infinity;
    let mxy = -Infinity;
    for (let q = 0; q < nv; q++) {
      const x = xs[q] as number;
      const y = ys[q] as number;
      if (x < mnx) mnx = x;
      if (x > mxx) mxx = x;
      if (y < mny) mny = y;
      if (y > mxy) mxy = y;
    }
    const rx = this.range(mnx, mxx, this.x0, this.dx);
    const ry = this.range(mny, mxy, this.y0, this.dy);
    if (rx < 0 || ry < 0) {
      // a polygon thinner than a cell is a thin wall along its longest diagonal
      this.markThin(nv, b, own);
      return;
    }
    // the corners turn one way: a point is inside when it is on the inner side of every edge
    let area = 0;
    for (let q = 0; q < nv; q++) {
      const k = q + 1 === nv ? 0 : q + 1;
      area += (xs[q] as number) * (ys[k] as number) - (xs[k] as number) * (ys[q] as number);
    }
    const sgn = area >= 0 ? 1 : -1;
    const n = this.n;
    let any = false;
    for (let j = Math.floor(ry / 4096); j <= ry % 4096; j++) {
      const y = this.y0 + (j + 0.5) * this.dy;
      for (let i = Math.floor(rx / 4096); i <= rx % 4096; i++) {
        const x = this.x0 + (i + 0.5) * this.dx;
        let inside = true;
        for (let q = 0; q < nv && inside; q++) {
          const k = q + 1 === nv ? 0 : q + 1;
          const ex = (xs[k] as number) - (xs[q] as number);
          const ey = (ys[k] as number) - (ys[q] as number);
          if (sgn * (ex * (y - (ys[q] as number)) - ey * (x - (xs[q] as number))) < 0) inside = false;
        }
        if (inside) {
          own[j * n + i] = b;
          any = true;
        }
      }
    }
    if (!any) this.markThin(nv, b, own);
  }

  /** A shape that covers no cell centre still blocks the air along its edges. */
  private markThin(nv: number, b: number, own: Int32Array): void {
    for (let q = 0; q < nv; q++) {
      const k = q + 1 === nv ? 0 : q + 1;
      this.markSegment(this.cxs[q] as number, this.cys[q] as number, this.cxs[k] as number, this.cys[k] as number, b, own);
    }
  }

  /** A thin wall fills every cell its segment passes through, so no air leaks across it between cells. */
  private markSegment(ax: number, ay: number, bx: number, by: number, b: number, own: Int32Array): void {
    const hx = 0.5 * this.dx;
    const hy = 0.5 * this.dy;
    const rx = this.range(Math.min(ax, bx) - hx, Math.max(ax, bx) + hx, this.x0, this.dx);
    const ry = this.range(Math.min(ay, by) - hy, Math.max(ay, by) + hy, this.y0, this.dy);
    if (rx < 0 || ry < 0) return;
    const ex = bx - ax;
    const ey = by - ay;
    const n = this.n;
    for (let j = Math.floor(ry / 4096); j <= ry % 4096; j++) {
      const cy = this.y0 + (j + 0.5) * this.dy;
      for (let i = Math.floor(rx / 4096); i <= rx % 4096; i++) {
        const cx = this.x0 + (i + 0.5) * this.dx;
        if (segmentHitsBox(ax, ay, ex, ey, cx - hx, cy - hy, cx + hx, cy + hy)) own[j * n + i] = b;
      }
    }
  }

  /* ------------------------------ sampling ------------------------------ */

  /** The x speed of the air at a point: bilinear between the faces; the wind outside the box. */
  sampleU(x: number, y: number): number {
    if (x < this.x0 || x > this.x1 || y < this.y0 || y > this.y1) return this.windX;
    const n = this.n;
    let fx = (x - this.x0) / this.dx;
    let fy = (y - this.y0) / this.dy - 0.5;
    if (fx > n) fx = n;
    if (fy < 0) fy = 0;
    else if (fy > n - 1) fy = n - 1;
    let i = Math.floor(fx);
    let j = Math.floor(fy);
    if (i > n - 1) i = n - 1;
    if (j > n - 2) j = n - 2;
    if (j < 0) j = 0;
    const tx = fx - i;
    const ty = fy - j;
    const w = n + 1;
    const u = this.u;
    const a = u[j * w + i] as number;
    const b = u[j * w + i + 1] as number;
    const c = n > 1 ? (u[(j + 1) * w + i] as number) : a;
    const d = n > 1 ? (u[(j + 1) * w + i + 1] as number) : b;
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }

  /** The y speed of the air at a point. */
  sampleV(x: number, y: number): number {
    if (x < this.x0 || x > this.x1 || y < this.y0 || y > this.y1) return this.windY;
    const n = this.n;
    let fx = (x - this.x0) / this.dx - 0.5;
    let fy = (y - this.y0) / this.dy;
    if (fx < 0) fx = 0;
    else if (fx > n - 1) fx = n - 1;
    if (fy > n) fy = n;
    let i = Math.floor(fx);
    let j = Math.floor(fy);
    if (i > n - 2) i = n - 2;
    if (i < 0) i = 0;
    if (j > n - 1) j = n - 1;
    const tx = fx - i;
    const ty = fy - j;
    const v = this.v;
    const a = v[j * n + i] as number;
    const b = n > 1 ? (v[j * n + i + 1] as number) : a;
    const c = v[(j + 1) * n + i] as number;
    const d = n > 1 ? (v[(j + 1) * n + i + 1] as number) : c;
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }

  /** The smoke at a point: bilinear between the cell centres; clean air outside the box. */
  sampleS(x: number, y: number): number {
    if (x < this.x0 || x > this.x1 || y < this.y0 || y > this.y1) return 0;
    return this.bilinearCells(this.s, x, y);
  }

  private bilinearCells(f: Float64Array, x: number, y: number): number {
    const n = this.n;
    let fx = (x - this.x0) / this.dx - 0.5;
    let fy = (y - this.y0) / this.dy - 0.5;
    if (fx < 0) fx = 0;
    else if (fx > n - 1) fx = n - 1;
    if (fy < 0) fy = 0;
    else if (fy > n - 1) fy = n - 1;
    let i = Math.floor(fx);
    let j = Math.floor(fy);
    if (i > n - 2) i = n - 2;
    if (j > n - 2) j = n - 2;
    if (i < 0) i = 0;
    if (j < 0) j = 0;
    const tx = fx - i;
    const ty = fy - j;
    const a = f[j * n + i] as number;
    const b = f[j * n + i + 1] as number;
    const c = f[(j + 1) * n + i] as number;
    const d = f[(j + 1) * n + i + 1] as number;
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }

  /* ------------------------------ the step ------------------------------ */

  /** Puts the air's drag of the last smoke step on the bodies for one bodies' step of `h` (before that step). */
  applyImpulses(w: World2 | undefined, h: number): void {
    if (!w) return;
    const m = Math.min(w.n, this.fx.length);
    for (let b = 0; b < m; b++) {
      const fx = this.fx[b] as number;
      const fy = this.fy[b] as number;
      if (fx === 0 && fy === 0) continue;
      if (w.type[b] !== BodyType.Dynamic || w.gone.has(b)) continue;
      w.jx[b] = (w.jx[b] as number) + fx * h;
      w.jy[b] = (w.jy[b] as number) + fy * h;
    }
  }

  /** Counts the drag as `drag` (after the bodies' step, which clears the counts). */
  account(w: World2 | undefined): void {
    if (!w) return;
    const m = Math.min(w.n, this.fx.length);
    for (let b = 0; b < m; b++) {
      const fx = this.fx[b] as number;
      const fy = this.fy[b] as number;
      if ((fx !== 0 || fy !== 0) && w.type[b] === BodyType.Dynamic && !w.gone.has(b)) w.account(b, FK.drag, fx, fy);
    }
  }

  /**
   * One step of `h` against the bodies where they are now. A fire grid (design 9.7) also carries its temperature and fuel,
   * lifts by heat, burns, makes fuel at the source, cools and takes water's heat before the solid faces; `drops` are the
   * liquid's drops (for water). A smoke grid with no swirl takes exactly the steps it always did.
   */
  step(w: World2 | undefined, h: number, drops?: DropsView): void {
    if (this.unstable) return;
    this.markSolids(w);
    this.advectFlow(h);
    const fire = this.fire !== undefined;
    if (fire) {
      advectFire(this, h);
      fireLift(this, h);
    } else this.lift(h);
    if (this.swirl > 0) confine(this, h);
    if (fire) {
      burnFuel(this, h);
      fireSource(this, h);
      coolFire(this, h);
      quench(this, drops);
    }
    this.solidFaces(w);
    this.project();
    this.advectSmoke(h);
    if (fire) this.markAlive();
    else this.makeSmoke();
    this.drag(w, h);
    this.checkHealth();
  }

  /** A fire that has had a flame or fuel can go out (the notice `fire_out`). */
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
    const n = this.n;
    const W = n + 1;
    const u = this.u;
    const v = this.v;
    const u2 = this.u2;
    const v2 = this.v2;
    // Back along the flow in grid units (cells a step), then bilinear between the faces round the point where it came
    // from: the same as sampleU and sampleV, written out here because this is the step's second-largest cost.
    const kx = h / this.dx;
    const ky = h / this.dy;
    const windX = this.windX;
    const windY = this.windY;
    // x speeds: the face's own u, and v as the mean of the four faces round it; face (i, j) is at grid (i, j + ½)
    for (let j = 0; j < n; j++) {
      for (let i = 0; i <= n; i++) {
        const uu = u[j * W + i] as number;
        const il = i > 0 ? i - 1 : 0;
        const ir = i < n ? i : n - 1;
        const vv = 0.25 * ((v[j * n + il] as number) + (v[j * n + ir] as number) + (v[(j + 1) * n + il] as number) + (v[(j + 1) * n + ir] as number));
        const fx = i - kx * uu;
        let fy = j - ky * vv;
        if (!(fx >= 0 && fx <= n && fy >= -0.5 && fy <= n - 0.5)) {
          u2[j * W + i] = windX;
          continue;
        }
        if (fy < 0) fy = 0;
        else if (fy > n - 1) fy = n - 1;
        let a = fx | 0;
        let b = fy | 0;
        if (a > n - 1) a = n - 1;
        if (b > n - 2) b = n - 2;
        const tx = fx - a;
        const ty = fy - b;
        const q = b * W + a;
        const p0 = u[q] as number;
        const p1 = u[q + 1] as number;
        const p2 = u[q + W] as number;
        const p3 = u[q + W + 1] as number;
        u2[j * W + i] = (p0 + (p1 - p0) * tx) * (1 - ty) + (p2 + (p3 - p2) * tx) * ty;
      }
    }
    // y speeds: face (i, j) is at grid (i + ½, j)
    for (let j = 0; j <= n; j++) {
      const jb = j > 0 ? j - 1 : 0;
      const jt = j < n ? j : n - 1;
      for (let i = 0; i < n; i++) {
        const vv = v[j * n + i] as number;
        const uu = 0.25 * ((u[jb * W + i] as number) + (u[jb * W + i + 1] as number) + (u[jt * W + i] as number) + (u[jt * W + i + 1] as number));
        let fx = i - kx * uu;
        const fy = j - ky * vv;
        if (!(fx >= -0.5 && fx <= n - 0.5 && fy >= 0 && fy <= n)) {
          v2[j * n + i] = windY;
          continue;
        }
        if (fx < 0) fx = 0;
        else if (fx > n - 1) fx = n - 1;
        let a = fx | 0;
        let b = fy | 0;
        if (a > n - 2) a = n - 2;
        if (b > n - 1) b = n - 1;
        const tx = fx - a;
        const ty = fy - b;
        const q = b * n + a;
        const p0 = v[q] as number;
        const p1 = v[q + 1] as number;
        const p2 = v[q + n] as number;
        const p3 = v[q + n + 1] as number;
        v2[j * n + i] = (p0 + (p1 - p0) * tx) * (1 - ty) + (p2 + (p3 - p2) * tx) * ty;
      }
    }
    this.u = u2;
    this.u2 = u;
    this.v = v2;
    this.v2 = v;
  }

  /** Heat lifts the y speeds where there is smoke. */
  private lift(h: number): void {
    if (this.heat === 0) return;
    const n = this.n;
    const s = this.s;
    const v = this.v;
    const k = h * this.heat;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i < n; i++) {
        const below = j > 0 ? (s[(j - 1) * n + i] as number) : 0;
        const above = j < n ? (s[j * n + i] as number) : 0;
        const d = j > 0 && j < n ? 0.5 * (below + above) : below + above;
        if (d !== 0) v[j * n + i] = (v[j * n + i] as number) + k * d;
      }
    }
  }

  /** The speed of body b at a point. */
  private speedAt(w: World2, b: number, x: number, y: number, yAxis: boolean): number {
    const om = w.w[b] as number;
    return yAxis ? (w.vy[b] as number) + om * (x - (w.px[b] as number)) : (w.vx[b] as number) - om * (y - (w.py[b] as number));
  }

  /** Faces next to a solid cell carry the solid's speed: the air cannot go into it, and a moving body pushes it. */
  private solidFaces(w: World2 | undefined): void {
    if (!w) return;
    const n = this.n;
    const W = n + 1;
    const own = this.own;
    const u = this.u;
    const v = this.v;
    for (let j = 0; j < n; j++) {
      const y = this.y0 + (j + 0.5) * this.dy;
      for (let i = 0; i <= n; i++) {
        const l = i > 0 ? (own[j * n + i - 1] as number) : -1;
        const r = i < n ? (own[j * n + i] as number) : -1;
        const b = l >= 0 ? l : r;
        if (b >= 0) u[j * W + i] = this.speedAt(w, b, this.x0 + i * this.dx, y, false);
      }
    }
    for (let j = 0; j <= n; j++) {
      const y = this.y0 + j * this.dy;
      for (let i = 0; i < n; i++) {
        const lo = j > 0 ? (own[(j - 1) * n + i] as number) : -1;
        const hi = j < n ? (own[j * n + i] as number) : -1;
        const b = lo >= 0 ? lo : hi;
        if (b >= 0) v[j * n + i] = this.speedAt(w, b, this.x0 + (i + 0.5) * this.dx, y, true);
      }
    }
  }

  /** The flow's divergence in each air cell (1/s); 0 in solid cells. */
  private divergence(out: Float64Array): void {
    const n = this.n;
    const W = n + 1;
    const u = this.u;
    const v = this.v;
    const own = this.own;
    const idx = 1 / this.dx;
    const idy = 1 / this.dy;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = j * n + i;
        out[c] = (own[c] as number) >= 0 ? 0 : ((u[j * W + i + 1] as number) - (u[j * W + i] as number)) * idx + ((v[(j + 1) * n + i] as number) - (v[j * n + i] as number)) * idy;
      }
    }
  }

  /**
   * The projection: solve Σ w (p_nb − p) = div over the air cells, with p = 0 outside the box (open air) and no term
   * for a solid neighbour (its face is fixed), by red-black over-relaxed passes; then take the gradient off the faces.
   */
  private project(): void {
    const n = this.n;
    const W = n + 1;
    const S = n + 2;
    const own = this.own;
    const p = this.p;
    const div = this.div;
    const { wl, wr, wd, wu, inv, fix, fixed } = this;
    const wx = 1 / (this.dx * this.dx);
    const wy = 1 / (this.dy * this.dy);
    const ip = 1 / (2 * wx + 2 * wy);
    const ax = OMEGA * ip * wx;
    const ay = OMEGA * ip * wy;
    const u = this.u;
    const v = this.v;
    const idx = 1 / this.dx;
    const idy = 1 / this.dy;
    // The weights of each cell's neighbours: an air cell or the open air outside counts, a solid does not. A cell with
    // air (or the open air, where p stays 0) on all four sides takes the plain stencil; the few others (solids and the
    // air beside them) go on a list of their colour and are solved with their own weights.
    let nf0 = 0;
    let nf1 = 0;
    const half = n * n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = j * n + i;
        const q = (j + 1) * S + i + 1;
        const odd = (i + j) & 1;
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
        const dv = ((u[j * W + i + 1] as number) - (u[j * W + i] as number)) * idx + ((v[(j + 1) * n + i] as number) - (v[j * n + i] as number)) * idy;
        // A cell a body has just left held p = 0 (solid cells do): a poor first guess beside a moving body, where the
        // pressure is far from 0. Start it from the mean of its neighbours (read from the pressure alone, so a
        // checkpoint holds all it needs). Still air has p = 0 everywhere and stays so.
        if ((p[q] as number) === 0) {
          const s4 = (p[q - 1] as number) + (p[q + 1] as number) + (p[q - S] as number) + (p[q + S] as number);
          if (s4 !== 0) p[q] = 0.25 * s4;
        }
        if (l !== 0 && r !== 0 && d !== 0 && t !== 0) {
          // kept already times the over-relaxation and the diagonal's inverse, so a pass does fewer products
          div[q] = OMEGA * ip * dv;
          continue;
        }
        // outside the box p stays 0, so its weight only goes into the diagonal
        const sum = l + r + d + t;
        const iq = sum > 0 ? OMEGA / sum : 0;
        wl[q] = i === 0 ? 0 : l * iq;
        wr[q] = i === n - 1 ? 0 : r * iq;
        wd[q] = j === 0 ? 0 : d * iq;
        wu[q] = j === n - 1 ? 0 : t * iq;
        inv[q] = iq;
        div[q] = iq * dv;
        if (odd === 0) fix[nf0++] = q;
        else fix[half + nf1++] = q;
      }
    }
    // Red-black over-relaxed passes. In one colour's sweep a cell reads only cells of the other colour, so the listed
    // cells' new values are found first, then every cell of the colour takes the plain stencil in one tight loop, and
    // the listed cells get their own values back.
    for (let pass = 0; pass < SMOKE_PASSES; pass++) {
      for (let colour = 0; colour < 2; colour++) {
        const f0 = colour === 0 ? 0 : half;
        const f1 = f0 + (colour === 0 ? nf0 : nf1);
        for (let k = f0; k < f1; k++) {
          const q = fix[k] as number;
          const iq = inv[q] as number;
          if (iq === 0) {
            fixed[k] = 0;
            continue;
          }
          // p ← (1 − ω) p + ω (Σ w p_nb − div) / Σ w, the weights and div already times ω / Σ w
          fixed[k] = KEEP * (p[q] as number) + (wl[q] as number) * (p[q - 1] as number) + (wr[q] as number) * (p[q + 1] as number) + (wd[q] as number) * (p[q - S] as number) + (wu[q] as number) * (p[q + S] as number) - (div[q] as number);
        }
        for (let j = 0; j < n; j++) {
          const end = (j + 1) * S + n + 1;
          for (let q = (j + 1) * S + 1 + ((j + colour) & 1); q < end; q += 2) {
            p[q] = KEEP * (p[q] as number) + ax * ((p[q - 1] as number) + (p[q + 1] as number)) + ay * ((p[q - S] as number) + (p[q + S] as number)) - (div[q] as number);
          }
        }
        for (let k = f0; k < f1; k++) p[fix[k] as number] = fixed[k] as number;
      }
    }
    // take the gradient off every face between two air cells, or an air cell and the open air outside (p = 0 there)
    for (let j = 0; j < n; j++) {
      const row = (j + 1) * S;
      for (let i = 0; i <= n; i++) {
        if ((i > 0 && (own[j * n + i - 1] as number) >= 0) || (i < n && (own[j * n + i] as number) >= 0)) continue;
        u[j * W + i] = (u[j * W + i] as number) - ((p[row + i + 1] as number) - (p[row + i] as number)) * idx;
      }
    }
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i < n; i++) {
        if ((j > 0 && (own[(j - 1) * n + i] as number) >= 0) || (j < n && (own[j * n + i] as number) >= 0)) continue;
        v[j * n + i] = (v[j * n + i] as number) - ((p[(j + 1) * S + i + 1] as number) - (p[j * S + i + 1] as number)) * idy;
      }
    }
  }

  private advectSmoke(h: number): void {
    const n = this.n;
    const W = n + 1;
    const u = this.u;
    const v = this.v;
    const s = this.s;
    const s2 = this.s2;
    const own = this.own;
    for (let j = 0; j < n; j++) {
      const y = this.y0 + (j + 0.5) * this.dy;
      for (let i = 0; i < n; i++) {
        const c = j * n + i;
        if ((own[c] as number) >= 0) {
          // smoke does not live inside solids
          s2[c] = 0;
          continue;
        }
        const x = this.x0 + (i + 0.5) * this.dx;
        const uu = 0.5 * ((u[j * W + i] as number) + (u[j * W + i + 1] as number));
        const vv = 0.5 * ((v[j * n + i] as number) + (v[(j + 1) * n + i] as number));
        if (uu === 0 && vv === 0) {
          s2[c] = s[c] as number;
          continue;
        }
        const bx = x - h * uu;
        const by = y - h * vv;
        s2[c] = bx < this.x0 || bx > this.x1 || by < this.y0 || by > this.y1 ? 0 : this.sampleAir(s, bx, by);
      }
    }
    // Carrying smoke back along the flow and blending four cells is not exact about how much smoke there is. What
    // should be left is what there was, less what flowed out of the open edges this step; scale to that, so smoke in
    // a closed box keeps its mass (design 11.5). At most 0.5% a step: the blending loses about 0.05% a step, so the
    // cap never binds there, and a body that sweeps smoke away cannot blow it up.
    let before = 0;
    let after = 0;
    for (let c = 0; c < s.length; c++) {
      before += s[c] as number;
      after += s2[c] as number;
    }
    // while the source makes smoke the mass is not kept anyway, and the source's own cells feed what flows out of them
    this.lastScale = 1;
    if (after > 1e-12 && before > 1e-12 && !(this.hasSource && this.making)) {
      const out = h * this.outflow(s) / (this.dx * this.dy);
      let f = (before - out) / after;
      // a swirling plume turns, and carrying it back along the flow loses more than a plain plume does (0.4% to 1% a step
      // against 0.05%): the cap grows with `swirl` (findings PH-18); with no swirl it is the 0.5% it always was
      const cap = this.swirl > 0 ? SCALE_CAP * (1 + this.swirl) : SCALE_CAP;
      if (f > 1 + cap) f = 1 + cap;
      else if (f < 1 - cap) f = 1 - cap;
      if (f !== 1) for (let c = 0; c < s2.length; c++) s2[c] = (s2[c] as number) * f;
      this.lastScale = f;
    }
    this.s = s2;
    this.s2 = s;
  }

  /** Smoke (density times length per second) leaving through the open edges of the box, by the flow there now. */
  private outflow(s: Float64Array): number {
    const n = this.n;
    const W = n + 1;
    const u = this.u;
    const v = this.v;
    let f = 0;
    for (let j = 0; j < n; j++) {
      const l = -(u[j * W] as number);
      const r = u[j * W + n] as number;
      if (l > 0) f += l * (s[j * n] as number) * this.dy;
      if (r > 0) f += r * (s[j * n + n - 1] as number) * this.dy;
    }
    for (let i = 0; i < n; i++) {
      const d = -(v[i] as number);
      const t = v[n * n + i] as number;
      if (d > 0) f += d * (s[i] as number) * this.dx;
      if (t > 0) f += t * (s[(n - 1) * n + i] as number) * this.dx;
    }
    return f;
  }

  /** Smoke at a point from the air cells round it only: a solid's cells hold none and would thin the smoke beside it. */
  private sampleAir(f: Float64Array, x: number, y: number): number {
    const n = this.n;
    let fx = (x - this.x0) / this.dx - 0.5;
    let fy = (y - this.y0) / this.dy - 0.5;
    if (fx < 0) fx = 0;
    else if (fx > n - 1) fx = n - 1;
    if (fy < 0) fy = 0;
    else if (fy > n - 1) fy = n - 1;
    let i = Math.floor(fx);
    let j = Math.floor(fy);
    if (i > n - 2) i = n - 2;
    if (j > n - 2) j = n - 2;
    if (i < 0) i = 0;
    if (j < 0) j = 0;
    const tx = fx - i;
    const ty = fy - j;
    const own = this.own;
    const c = j * n + i;
    const wa = (own[c] as number) < 0 ? (1 - tx) * (1 - ty) : 0;
    const wb = (own[c + 1] as number) < 0 ? tx * (1 - ty) : 0;
    const wc = (own[c + n] as number) < 0 ? (1 - tx) * ty : 0;
    const wd = (own[c + n + 1] as number) < 0 ? tx * ty : 0;
    const sum = wa + wb + wc + wd;
    if (!(sum > 0)) return 0;
    return (wa * (f[c] as number) + wb * (f[c + 1] as number) + wc * (f[c + n] as number) + wd * (f[c + n + 1] as number)) / sum;
  }

  /**
   * The air pushes each body it flows past: the mean air speed in the air cells beside the body against the body's
   * speed gives a drag ½ ρ Cd D |Δ| Δ, D the body's width. Kept to at most half the speed difference in one step, so a
   * light body never overshoots the air.
   */
  private drag(w: World2 | undefined, h: number): void {
    if (!w) return;
    const nb = w.n;
    this.fx.fill(0);
    this.fy.fill(0);
    let any = false;
    for (let b = 0; b < nb; b++) if (w.type[b] === BodyType.Dynamic && !w.gone.has(b)) any = true;
    if (!any) return;
    const n = this.n;
    const W = n + 1;
    const own = this.own;
    const u = this.u;
    const v = this.v;
    this.sumX.fill(0);
    this.sumY.fill(0);
    this.cnt.fill(0);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = j * n + i;
        if ((own[c] as number) >= 0) continue;
        const uu = 0.5 * ((u[j * W + i] as number) + (u[j * W + i + 1] as number));
        const vv = 0.5 * ((v[j * n + i] as number) + (v[(j + 1) * n + i] as number));
        // each body beside this cell, once
        const l = i > 0 ? (own[c - 1] as number) : -1;
        const r = i < n - 1 ? (own[c + 1] as number) : -1;
        const d = j > 0 ? (own[c - n] as number) : -1;
        const t = j < n - 1 ? (own[c + n] as number) : -1;
        if (l >= 0) this.near(w, l, uu, vv);
        if (r >= 0 && r !== l) this.near(w, r, uu, vv);
        if (d >= 0 && d !== l && d !== r) this.near(w, d, uu, vv);
        if (t >= 0 && t !== l && t !== r && t !== d) this.near(w, t, uu, vv);
      }
    }
    // a body smaller than a cell fills no cell and so has no air beside it: it feels the air at its centre instead
    // (it is too small to block the flow, but the flow still carries it)
    for (let b = 0; b < nb; b++) {
      if (this.cnt[b] !== 0 || w.type[b] !== BodyType.Dynamic || w.gone.has(b)) continue;
      const x = w.px[b] as number;
      const y = w.py[b] as number;
      if (!(x > this.x0 && x < this.x1 && y > this.y0 && y < this.y1)) continue;
      this.sumX[b] = this.sampleU(x, y);
      this.sumY[b] = this.sampleV(x, y);
      this.cnt[b] = 1;
    }
    const k = 0.5 * AIR_DENSITY * DRAG_CD;
    for (let b = 0; b < nb; b++) {
      const m = this.cnt[b] as number;
      if (m === 0) continue;
      const rx = (this.sumX[b] as number) / m - (w.vx[b] as number);
      const ry = (this.sumY[b] as number) / m - (w.vy[b] as number);
      const sp = Math.sqrt(rx * rx + ry * ry);
      if (!(sp > 1e-9)) continue;
      const f = k * 2 * (w.reach[b] as number) * sp;
      let fx = f * rx;
      let fy = f * ry;
      // over the time to the next smoke step, at most half the speed difference
      const cap = (0.5 * (w.mass[b] as number) * sp) / h;
      const fl = f * sp;
      if (fl > cap) {
        fx *= cap / fl;
        fy *= cap / fl;
      }
      // a push too small to see does not keep a resting body awake
      if (Math.min(fl, cap) * h * (w.invM[b] as number) < 1e-5) continue;
      this.fx[b] = fx;
      this.fy[b] = fy;
    }
  }

  private near(w: World2, b: number, uu: number, vv: number): void {
    if (w.type[b] !== BodyType.Dynamic) return;
    this.sumX[b] = (this.sumX[b] as number) + uu;
    this.sumY[b] = (this.sumY[b] as number) + vv;
    this.cnt[b] = (this.cnt[b] as number) + 1;
  }

  private checkHealth(): void {
    let bad = false;
    const u = this.u;
    const v = this.v;
    for (let k = 0; k < u.length && !bad; k++) {
      const x = u[k] as number;
      if (!(x > -BLOW_UP && x < BLOW_UP)) bad = true;
    }
    for (let k = 0; k < v.length && !bad; k++) {
      const x = v[k] as number;
      if (!(x > -BLOW_UP && x < BLOW_UP)) bad = true;
    }
    if (!bad) return;
    this.life.send('blowUp');
    this.u.fill(0);
    this.v.fill(0);
    this.s.fill(0);
    this.T.fill(0);
    this.F.fill(0);
    this.fx.fill(0);
    this.fy.fill(0);
  }

  /* ------------------------------ measures ------------------------------ */

  /** Total smoke: density times cell area. */
  mass(): number {
    let m = 0;
    for (let c = 0; c < this.s.length; c++) m += this.s[c] as number;
    return m * this.dx * this.dy;
  }

  /** The largest divergence of the flow over the air cells (1/s), now. */
  maxDivergence(): number {
    const d = new Float64Array(this.n * this.n);
    this.divergence(d);
    let m = 0;
    for (let c = 0; c < d.length; c++) m = Math.max(m, Math.abs(d[c] as number));
    return m;
  }

  /** The fastest air (m/s). */
  maxSpeed(): number {
    let m = 0;
    for (let k = 0; k < this.u.length; k++) m = Math.max(m, Math.abs(this.u[k] as number));
    for (let k = 0; k < this.v.length; k++) m = Math.max(m, Math.abs(this.v[k] as number));
    return m;
  }

  /** The air speed at a cell centre. */
  speedAtCell(i: number, j: number): { x: number; y: number } {
    const n = this.n;
    const W = n + 1;
    return { x: 0.5 * ((this.u[j * W + i] as number) + (this.u[j * W + i + 1] as number)), y: 0.5 * ((this.v[j * n + i] as number) + (this.v[(j + 1) * n + i] as number)) };
  }

  /* ------------------------------ checkpoints ------------------------------ */

  /** Everything a step reads that changes: the flow, the smoke, the pressure guess and the drag to apply. */
  save(): Float64Array {
    const nu = this.u.length;
    const nv = this.v.length;
    const ns = this.s.length;
    const nb = this.fx.length;
    const np = this.p.length;
    const nt = this.T.length;
    const out = new Float64Array(3 + nu + nv + ns + np + 2 * nb + (nt > 0 ? 1 + 2 * nt : 0));
    out[0] = this.n;
    out[1] = this.unstable ? 1 : 0;
    out[2] = nb;
    let k = 3;
    out.set(this.u, k);
    k += nu;
    out.set(this.v, k);
    k += nv;
    out.set(this.s, k);
    k += ns;
    out.set(this.p, k);
    k += np;
    out.set(this.fx, k);
    k += nb;
    out.set(this.fy, k);
    k += nb;
    // a fire's temperature, fuel and whether it has been alight
    if (nt > 0) {
      out[k++] = this.alive ? 1 : 0;
      out.set(this.T, k);
      k += nt;
      out.set(this.F, k);
    }
    return out;
  }

  load(src: Float64Array): void {
    const nu = this.u.length;
    const nv = this.v.length;
    const ns = this.s.length;
    this.life.send(src[1] === 1 ? 'blowUp' : 'reset');
    // the walls are marked again from where they are in the world loaded with this checkpoint
    this.wallsMoved++;
    const nb = src[2] as number;
    let k = 3;
    this.u.set(src.subarray(k, k + nu));
    k += nu;
    this.v.set(src.subarray(k, k + nv));
    k += nv;
    this.s.set(src.subarray(k, k + ns));
    k += ns;
    const np = this.p.length;
    this.p.set(src.subarray(k, k + np));
    k += np;
    if (this.fx.length !== nb) {
      this.fx = new Float64Array(nb);
      this.fy = new Float64Array(nb);
    }
    this.fx.set(src.subarray(k, k + nb));
    k += nb;
    this.fy.set(src.subarray(k, k + nb));
    k += nb;
    const nt = this.T.length;
    if (nt > 0) {
      this.alive = src[k++] === 1;
      this.T.set(src.subarray(k, k + nt));
      k += nt;
      this.F.set(src.subarray(k, k + nt));
    }
  }

  /** The size of a checkpoint in values, before it is made. */
  saveLength(): number {
    return 3 + this.u.length + this.v.length + this.s.length + this.p.length + 2 * this.fx.length + (this.T.length > 0 ? 1 + 2 * this.T.length : 0);
  }
}

/** Marks the cells of a source on an n by n grid over a box (1 where smoke is made); a point fills the cell it is in. */
export function markSource(out: Uint8Array, g: { readonly n: number; readonly x0: number; readonly y0: number; readonly dx: number; readonly dy: number }, src: SmokeSource2 | undefined): boolean {
  out.fill(0);
  if (!src) return false;
  const n = g.n;
  if (src.kind === 'point') {
    const i = Math.floor((src.x - g.x0) / g.dx);
    const j = Math.floor((src.y - g.y0) / g.dy);
    if (i >= 0 && i < n && j >= 0 && j < n) {
      out[j * n + i] = 1;
      return true;
    }
    return false;
  }
  let any = false;
  for (let j = 0; j < n; j++) {
    const y = g.y0 + (j + 0.5) * g.dy;
    for (let i = 0; i < n; i++) {
      const x = g.x0 + (i + 0.5) * g.dx;
      const inside = src.kind === 'circle' ? (x - src.x) * (x - src.x) + (y - src.y) * (y - src.y) <= src.r * src.r : insidePolygon(src.pts, x, y);
      if (inside) {
        out[j * n + i] = 1;
        any = true;
      }
    }
  }
  if (any) return true;
  // a source smaller than a cell still makes smoke in the cell its centre is in
  const c = src.kind === 'circle' ? { x: src.x, y: src.y } : centroid(src.pts);
  return markSource(out, g, { kind: 'point', x: c.x, y: c.y });
}

function insidePolygon(pts: readonly { readonly x: number; readonly y: number }[], x: number, y: number): boolean {
  // crossings of a ray to the right (works for shapes with dents too)
  let inside = false;
  for (let i = 0, k = pts.length - 1; i < pts.length; k = i++) {
    const a = pts[i] as { x: number; y: number };
    const b = pts[k] as { x: number; y: number };
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function centroid(pts: readonly { readonly x: number; readonly y: number }[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return pts.length > 0 ? { x: x / pts.length, y: y / pts.length } : { x: 0, y: 0 };
}

/** Does the segment a + t e (t in 0..1) meet the box? (Liang and Barsky clipping, with no closures.) */
function segmentHitsBox(ax: number, ay: number, ex: number, ey: number, x0: number, y0: number, x1: number, y1: number): boolean {
  let t0 = 0;
  let t1 = 1;
  for (let side = 0; side < 4; side++) {
    const p = side === 0 ? -ex : side === 1 ? ex : side === 2 ? -ey : ey;
    const q = side === 0 ? ax - x0 : side === 1 ? x1 - ax : side === 2 ? ay - y0 : y1 - ay;
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1;
}
