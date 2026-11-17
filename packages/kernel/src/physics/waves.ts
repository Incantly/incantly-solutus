/**
 * Waves (docs/features/physics/design.md 9.3): a water surface on a grid of heights that follows the wave equation,
 * stepped with the world's step. In space the grid is n × n cells over a box's floor plan, in the plane n points along
 * a segment.
 *
 * The surface height u and its speed v live at the cell centres. Bodies that reach into the water press on it: under a
 * body, the water's head is its height plus how far it reaches up into the body (a pressure head), so the water is
 * pushed out from under the body and rises around it, and a body that moves or falls in makes waves. The step is
 *
 *     F = u + P,   v += h c² ∇²F,   v *= 1 / (1 + h damping),   u += h v,
 *
 * with the edges of the grid as walls (no flow through them), so the water's volume is kept exactly. The bodies are
 * pushed up by the buoyancy of still water (`./water3`, `./water2`) under the plane that touches the head F below their
 * centre, so a boat rides the waves and rocks on them. The wave speed is c = √(g × depth), at most what the grid's
 * step allows (the pressure doubles the stiffness under a body, so the cap is half the grid's limit).
 */
import type { World3 } from './world3';
import { BodyType3 } from './world3';
import type { World2 } from './world2';
import { BodyType } from './world2';
import type { WaterPlane } from './water3';

/** The largest wave grid (design 11.3): 64 × 64 in space, as many points in the plane. */
export const MAX_WAVE_CELLS = 64 * 64;
export const MAX_WAVE_SIDE = 64;
/** Waves lose this much of their speed each second unless the line says otherwise. */
export const WAVE_DAMPING = 0.2;

export interface WaveSpec {
  /** Cells along x and y (1 along y for waves in the plane). */
  readonly nx: number;
  readonly ny: number;
  /** The grid's corner and cell sizes: cell (i, j) is centred at (x0 + (i + ½) dx, y0 + (j + ½) dy). */
  readonly x0: number;
  readonly y0: number;
  readonly dx: number;
  readonly dy: number;
  /** The height of the water at rest (z in space, y in the plane) and its depth. */
  readonly level: number;
  readonly depth: number;
  readonly damping: number;
}

export class WaveGrid {
  readonly spec: WaveSpec;
  readonly n: number;
  /** Height above the rest level, its speed, the bodies' pressure head this step, and the head u + P. */
  u: Float64Array;
  v: Float64Array;
  P: Float64Array;
  F: Float64Array;
  /** Wave speed, m/s. */
  readonly c: number;
  private kx: number;
  private ky: number;
  private damp: number;
  private h: number;

  constructor(spec: WaveSpec, g: number, h: number) {
    this.spec = spec;
    this.n = spec.nx * spec.ny;
    this.u = new Float64Array(this.n);
    this.v = new Float64Array(this.n);
    this.P = new Float64Array(this.n);
    this.F = new Float64Array(this.n);
    this.h = h;
    const line = spec.ny === 1;
    const cell = line ? spec.dx : Math.min(spec.dx, spec.dy);
    const cap = (line ? 0.65 : 0.45) * (cell / h);
    this.c = Math.min(Math.sqrt(Math.max(0, g) * Math.max(0, spec.depth)), cap);
    this.kx = (h * this.c * this.c) / (spec.dx * spec.dx);
    this.ky = line ? 0 : (h * this.c * this.c) / (spec.dy * spec.dy);
    this.damp = 1 / (1 + h * Math.max(0, spec.damping));
  }

  /** A new step: no body presses yet. */
  clearPress(): void {
    this.P.fill(0);
  }

  /**
   * A body's column over cell k reaches from zBot up to zTop: the water above zBot, up to the column's top, presses on
   * it (scaled by how much of the cell the body covers).
   */
  press(k: number, zBot: number, zTop: number, weight: number): void {
    const s = this.spec.level + (this.u[k] as number);
    const p = Math.min(zTop, s) - zBot;
    if (p > 0) this.P[k] = (this.P[k] as number) + p * weight;
  }

  step(): void {
    const { nx, ny } = this.spec;
    const u = this.u;
    const v = this.v;
    const F = this.F;
    const P = this.P;
    const n = this.n;
    for (let k = 0; k < n; k++) F[k] = (u[k] as number) + (P[k] as number);
    const kx = this.kx;
    const ky = this.ky;
    const damp = this.damp;
    for (let j = 0; j < ny; j++) {
      const row = j * nx;
      const up = j + 1 < ny ? nx : 0;
      const down = j > 0 ? -nx : 0;
      for (let i = 0; i < nx; i++) {
        const k = row + i;
        const f = F[k] as number;
        // walls at the edges: the missing neighbour is the cell itself, so nothing flows out
        const l = i > 0 ? (F[k - 1] as number) : f;
        const r = i + 1 < nx ? (F[k + 1] as number) : f;
        let acc = kx * (l + r - 2 * f);
        if (ky !== 0) acc += ky * ((F[k + up] as number) + (F[k + down] as number) - 2 * f);
        v[k] = ((v[k] as number) + acc) * damp;
      }
    }
    const h = this.h;
    for (let k = 0; k < n; k++) u[k] = (u[k] as number) + h * (v[k] as number);
  }

  /** Bilinear weights at (x, y) over the cell centres; false outside the grid. */
  private at(x: number, y: number, out: { i: number; j: number; tx: number; ty: number }): boolean {
    const s = this.spec;
    if (!(x >= s.x0 && x <= s.x0 + s.nx * s.dx)) return false;
    if (s.ny > 1 && !(y >= s.y0 && y <= s.y0 + s.ny * s.dy)) return false;
    const fx = Math.min(s.nx - 1, Math.max(0, (x - s.x0) / s.dx - 0.5));
    let i = Math.floor(fx);
    if (i >= s.nx - 1) i = Math.max(0, s.nx - 2);
    out.i = i;
    out.tx = s.nx > 1 ? fx - i : 0;
    if (s.ny > 1) {
      const fy = Math.min(s.ny - 1, Math.max(0, (y - s.y0) / s.dy - 0.5));
      let j = Math.floor(fy);
      if (j >= s.ny - 1) j = Math.max(0, s.ny - 2);
      out.j = j;
      out.ty = fy - j;
    } else {
      out.j = 0;
      out.ty = 0;
    }
    return true;
  }

  private w = { i: 0, j: 0, tx: 0, ty: 0 };

  /** A field (u or the head F) at (x, y), and its slopes along x and y. */
  private sample(a: Float64Array, x: number, y: number, out: number[]): boolean {
    const w = this.w;
    if (!this.at(x, y, w)) return false;
    const s = this.spec;
    const nx = s.nx;
    const i1 = Math.min(s.nx - 1, w.i + 1);
    if (s.ny === 1) {
      const a0 = a[w.i] as number;
      const a1 = a[i1] as number;
      out[0] = a0 + (a1 - a0) * w.tx;
      out[1] = i1 > w.i ? (a1 - a0) / s.dx : 0;
      out[2] = 0;
      return true;
    }
    const j1 = Math.min(s.ny - 1, w.j + 1);
    const a00 = a[w.j * nx + w.i] as number;
    const a10 = a[w.j * nx + i1] as number;
    const a01 = a[j1 * nx + w.i] as number;
    const a11 = a[j1 * nx + i1] as number;
    const tx = w.tx;
    const ty = w.ty;
    out[0] = a00 * (1 - tx) * (1 - ty) + a10 * tx * (1 - ty) + a01 * (1 - tx) * ty + a11 * tx * ty;
    out[1] = i1 > w.i ? ((a10 - a00) * (1 - ty) + (a11 - a01) * ty) / s.dx : 0;
    out[2] = j1 > w.j ? ((a01 - a00) * (1 - tx) + (a11 - a10) * tx) / s.dy : 0;
    return true;
  }

  private tmp = [0, 0, 0];

  /** The height of the water's surface at (x, y), or NaN outside the grid. */
  heightAt(x: number, y: number): number {
    return this.sample(this.u, x, y, this.tmp) ? this.spec.level + (this.tmp[0] as number) : Number.NaN;
  }

  /** In space: the plane touching the head under (x, y), water below it. */
  plane3(x: number, y: number, out: WaterPlane): boolean {
    if (!this.sample(this.F, x, y, this.tmp)) return false;
    const z = this.spec.level + (this.tmp[0] as number);
    const sx = this.tmp[1] as number;
    const sy = this.tmp[2] as number;
    const l = Math.sqrt(sx * sx + sy * sy + 1);
    out.nx = -sx / l;
    out.ny = -sy / l;
    out.nz = 1 / l;
    out.c = out.nx * x + out.ny * y + out.nz * z;
    return true;
  }

  /** In the plane: the line touching the head under x, water below it. */
  line2(x: number, out: { nx: number; ny: number; c: number }): boolean {
    if (!this.sample(this.F, x, 0, this.tmp)) return false;
    const y = this.spec.level + (this.tmp[0] as number);
    const sx = this.tmp[1] as number;
    const l = Math.sqrt(sx * sx + 1);
    out.nx = -sx / l;
    out.ny = 1 / l;
    out.c = out.nx * x + out.ny * y;
    return true;
  }

  /** The mean height of the surface (the rest level, raised by what bodies and drops moved aside). */
  meanLevel(): number {
    let s = 0;
    for (let k = 0; k < this.n; k++) s += this.u[k] as number;
    return this.spec.level + s / this.n;
  }

  save(): Float64Array {
    const out = new Float64Array(2 * this.n);
    out.set(this.u, 0);
    out.set(this.v, this.n);
    return out;
  }

  load(s: Float64Array): void {
    this.u.set(s.subarray(0, this.n));
    this.v.set(s.subarray(this.n, 2 * this.n));
  }

  /* ------------------------------ bodies press on the water ------------------------------ */

  /** Every body in space that reaches into the water presses on it, at its pose now. */
  pressBodies3(w: World3): void {
    this.clearPress();
    const s = this.spec;
    for (let b = 0; b < w.n; b++) {
      if (w.type[b] !== BodyType3.Dynamic || w.gone.has(b)) continue;
      const s0 = w.shape0[b] as number;
      for (let k = s0; k < s0 + (w.shapeN[b] as number); k++) {
        const sh = w.shapes[k];
        if (!sh || (sh.kind !== 0 && sh.kind !== 1)) continue;
        const lx = w.lo[k * 3] as number;
        const ly = w.lo[k * 3 + 1] as number;
        const lz = w.lo[k * 3 + 2] as number;
        const hx = w.hi[k * 3] as number;
        const hy = w.hi[k * 3 + 1] as number;
        // above the highest the water could be: no touch
        if (lz > s.level + s.depth) continue;
        const i0 = Math.max(0, Math.floor((lx - s.x0) / s.dx - 0.5));
        const i1 = Math.min(s.nx - 1, Math.ceil((hx - s.x0) / s.dx - 0.5));
        const j0 = Math.max(0, Math.floor((ly - s.y0) / s.dy - 0.5));
        const j1 = Math.min(s.ny - 1, Math.ceil((hy - s.y0) / s.dy - 0.5));
        if (i1 < i0 || j1 < j0) continue;
        let hit = 0;
        for (let j = j0; j <= j1; j++) {
          const y = s.y0 + (j + 0.5) * s.dy;
          for (let i = i0; i <= i1; i++) {
            const x = s.x0 + (i + 0.5) * s.dx;
            if (this.column3(sh, x, y)) {
              this.press(j * s.nx + i, this.zLo, this.zHi, 1);
              hit++;
            }
          }
        }
        if (hit > 0) continue;
        // smaller than a cell: its middle column, over the share of the cell it covers
        const cx = 0.5 * (lx + hx);
        const cy = 0.5 * (ly + hy);
        const i = Math.floor((cx - s.x0) / s.dx);
        const j = Math.floor((cy - s.y0) / s.dy);
        if (i < 0 || j < 0 || i >= s.nx || j >= s.ny || !this.column3(sh, cx, cy)) continue;
        const cover = Math.min(1, ((hx - lx) * (hy - ly) * (sh.kind === 0 ? Math.PI / 4 : 1)) / (s.dx * s.dy));
        this.press(j * s.nx + i, this.zLo, this.zHi, cover);
      }
    }
  }

  private zLo = 0;
  private zHi = 0;

  /** The vertical line through (x, y) in a ball or a convex hull: from zLo to zHi; false when it misses. */
  private column3(sh: World3['shapes'][number], x: number, y: number): boolean {
    if (sh.kind === 0) {
      const ex = x - (sh.wc[0] as number);
      const ey = y - (sh.wc[1] as number);
      const q = sh.r * sh.r - ex * ex - ey * ey;
      if (!(q > 0)) return false;
      const hc = Math.sqrt(q);
      this.zLo = (sh.wc[2] as number) - hc;
      this.zHi = (sh.wc[2] as number) + hc;
      return true;
    }
    let lo = -Infinity;
    let hi = Infinity;
    const wv = sh.wv;
    const wn = sh.wn;
    for (let f = 0; f < sh.faces.length; f++) {
      const c0 = (sh.faces[f] as Int32Array)[0] as number;
      const nx = wn[f * 3] as number;
      const ny = wn[f * 3 + 1] as number;
      const nz = wn[f * 3 + 2] as number;
      // n · (x, y, z) <= d along the line: nz z <= d − nx x − ny y
      const rhs = nx * ((wv[c0 * 3] as number) - x) + ny * ((wv[c0 * 3 + 1] as number) - y) + nz * (wv[c0 * 3 + 2] as number);
      if (nz > 1e-12) hi = Math.min(hi, rhs / nz);
      else if (nz < -1e-12) lo = Math.max(lo, rhs / nz);
      else if (rhs < 0) return false;
      if (lo >= hi) return false;
    }
    if (!(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi)) return false;
    this.zLo = lo;
    this.zHi = hi;
    return true;
  }

  /** Every body in the plane that reaches into the water presses on it (shapes in world place, `updateShapes` done). */
  pressBodies2(w: World2): void {
    this.clearPress();
    const s = this.spec;
    for (let b = 0; b < w.n; b++) {
      if (w.type[b] !== BodyType.Dynamic || w.gone.has(b)) continue;
      const s0 = w.shape0[b] as number;
      for (let k = s0; k < s0 + (w.shapeN[b] as number); k++) {
        const sh = w.shapes[k];
        if (!sh) continue;
        let lx: number;
        let hx: number;
        let ly: number;
        if (sh.kind === 0) {
          lx = sh.wcx - sh.radius;
          hx = sh.wcx + sh.radius;
          ly = sh.wcy - sh.radius;
        } else {
          if (sh.wx.length < 3) continue;
          lx = Infinity;
          hx = -Infinity;
          ly = Infinity;
          for (let q = 0; q < sh.wx.length; q++) {
            lx = Math.min(lx, sh.wx[q] as number);
            hx = Math.max(hx, sh.wx[q] as number);
            ly = Math.min(ly, sh.wy[q] as number);
          }
        }
        if (ly > s.level + s.depth) continue;
        const i0 = Math.max(0, Math.floor((lx - s.x0) / s.dx - 0.5));
        const i1 = Math.min(s.nx - 1, Math.ceil((hx - s.x0) / s.dx - 0.5));
        let hit = 0;
        for (let i = i0; i <= i1; i++) {
          const x = s.x0 + (i + 0.5) * s.dx;
          if (this.column2(sh, x)) {
            this.press(i, this.zLo, this.zHi, 1);
            hit++;
          }
        }
        if (hit > 0 || i1 < i0) continue;
        const cx = 0.5 * (lx + hx);
        const i = Math.floor((cx - s.x0) / s.dx);
        if (i < 0 || i >= s.nx || !this.column2(sh, cx)) continue;
        this.press(i, this.zLo, this.zHi, Math.min(1, (hx - lx) / s.dx));
      }
    }
  }

  private column2(sh: World2['shapes'][number], x: number): boolean {
    if (!sh) return false;
    if (sh.kind === 0) {
      const ex = x - sh.wcx;
      const q = sh.radius * sh.radius - ex * ex;
      if (!(q > 0)) return false;
      const hc = Math.sqrt(q);
      this.zLo = sh.wcy - hc;
      this.zHi = sh.wcy + hc;
      return true;
    }
    const n = sh.wx.length;
    let lo = Infinity;
    let hi = -Infinity;
    for (let e = 0; e < n; e++) {
      const ax = sh.wx[e] as number;
      const ay = sh.wy[e] as number;
      const bx = sh.wx[(e + 1) % n] as number;
      const by = sh.wy[(e + 1) % n] as number;
      if ((ax - x) * (bx - x) > 0 || ax === bx) continue;
      const t = (x - ax) / (bx - ax);
      const y = ay + t * (by - ay);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    if (!(hi > lo)) return false;
    this.zLo = lo;
    this.zHi = hi;
    return true;
  }
}
