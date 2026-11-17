/**
 * Still water in the plane (docs/features/physics/design.md 9.2): Archimedes' rule with no particles. Each body is cut
 * by the water line (and by the water's region, when it has one); the part under it is pushed up by the weight of the
 * water it takes the place of, at that part's centre, and slowed by water drag. Cheap: a few clipped polygons a step.
 */
import type { Pt } from './geom2';
import type { World2 } from './world2';
import { BodyType, FK, FORCE_KINDS } from './world2';
import { sincos } from './math';

/** Water drag per second, per kg of water moved aside: a floating box stops bobbing in a few seconds. */
export const WATER_DRAG = 2;
/** Sides of the polygon a round body is cut as (its area is scaled back to the circle's). */
const ROUND_SIDES = 48;

export interface Water2 {
  readonly level: number;
  /** The water's walls as a convex, counter-clockwise polygon; none for water everywhere below the level. */
  readonly clip?: readonly Pt[];
  /** kg per m². */
  readonly density: number;
  /** For waves: the surface line under a body at x (water on the side n · p <= c), or false where there is no water. */
  readonly local?: (x: number, out: { nx: number; ny: number; c: number }) => boolean;
}

/**
 * Adds a force of a kind to a body's account after its step, also when the step just put it to sleep (a sleeping body
 * keeps the forces of its last step, so a floating box asleep still shows its buoyancy).
 */
export function addForce(w: World2, i: number, kind: number, fx: number, fy: number): void {
  if (w.type[i] !== BodyType.Dynamic) return;
  const o = (i * FORCE_KINDS.length + kind) * 2;
  w.forces[o] = (w.forces[o] as number) + fx;
  w.forces[o + 1] = (w.forces[o + 1] as number) + fy;
}

/** A convex counter-clockwise polygon to clip by: the region itself when it is convex, else its bounding box. */
export function waterClip(pts: readonly Pt[]): Pt[] {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as Pt;
    const q = pts[(i + 1) % pts.length] as Pt;
    a += p.x * q.y - q.x * p.y;
  }
  const ccw = a >= 0 ? [...pts] : [...pts].reverse();
  let convex = ccw.length >= 3;
  for (let i = 0; i < ccw.length && convex; i++) {
    const p = ccw[i] as Pt;
    const q = ccw[(i + 1) % ccw.length] as Pt;
    const r = ccw[(i + 2) % ccw.length] as Pt;
    if ((q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x) < -1e-12) convex = false;
  }
  if (convex) return ccw;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

/** The forces water put on each body in the last step, for the arrows: buoyancy then drag, x and y. */
export class WaterForces {
  f = new Float64Array(0);
  private ax = new Float64Array(160);
  private ay = new Float64Array(160);
  private bx = new Float64Array(160);
  private by = new Float64Array(160);
  private sc = new Float64Array(2);
  private roundC = new Float64Array(ROUND_SIDES);
  private roundS = new Float64Array(ROUND_SIDES);
  private roundScale = 1;
  private line = { nx: 0, ny: 1, c: 0 };

  constructor() {
    for (let k = 0; k < ROUND_SIDES; k++) {
      sincos((2 * Math.PI * k) / ROUND_SIDES, this.sc);
      this.roundS[k] = this.sc[0] as number;
      this.roundC[k] = this.sc[1] as number;
    }
    // area of the 48-gon is (n / 2) sin(2π / n) r²; scale it back to π r²
    sincos((2 * Math.PI) / ROUND_SIDES, this.sc);
    this.roundScale = Math.PI / ((ROUND_SIDES / 2) * (this.sc[0] as number));
  }

  /**
   * Before the body step: each awake body's buoyancy and drag, at its pose now, go into its speed as impulses (design
   * 5.2: a step reads its inputs at its start).
   */
  apply(w: World2, waters: readonly Water2[], h: number): void {
    if (this.f.length !== w.n * 4) this.f = new Float64Array(w.n * 4);
    else this.f.fill(0);
    if (waters.length === 0) return;
    for (let i = 0; i < w.n; i++) {
      if (w.type[i] !== BodyType.Dynamic || w.awake[i] === 0 || w.gone.has(i)) continue;
      const bxp = w.px[i] as number;
      const byp = w.py[i] as number;
      const c = w.qc[i] as number;
      const s = w.qs[i] as number;
      let A = 0;
      let mx = 0;
      let my = 0;
      let rho = 0;
      for (const wa of waters) {
        const line = this.line;
        if (wa.local) {
          if (!wa.local(bxp, line)) continue;
        } else {
          line.nx = 0;
          line.ny = 1;
          line.c = wa.level;
        }
        const s0 = w.shape0[i] as number;
        for (let k = s0; k < s0 + (w.shapeN[i] as number); k++) {
          const sh = w.shapes[k];
          if (!sh) continue;
          let n: number;
          let scale = 1;
          if (sh.kind === 0) {
            const ox = bxp + c * sh.lcx - s * sh.lcy;
            const oy = byp + s * sh.lcx + c * sh.lcy;
            for (let q = 0; q < ROUND_SIDES; q++) {
              this.ax[q] = ox + sh.radius * (this.roundC[q] as number);
              this.ay[q] = oy + sh.radius * (this.roundS[q] as number);
            }
            n = ROUND_SIDES;
            scale = this.roundScale;
          } else {
            if (sh.lx.length < 3) continue;
            for (let q = 0; q < sh.lx.length; q++) {
              const lx = sh.lx[q] as number;
              const ly = sh.ly[q] as number;
              this.ax[q] = bxp + c * lx - s * ly;
              this.ay[q] = byp + s * lx + c * ly;
            }
            n = sh.lx.length;
          }
          // under the line y = level (the half-plane with normal (0, 1)), or under the waves' surface
          n = this.clipHalf(n, line.nx, line.ny, line.c);
          if (wa.clip) {
            const cp = wa.clip;
            for (let e = 0; e < cp.length && n > 0; e++) {
              const p = cp[e] as Pt;
              const q = cp[(e + 1) % cp.length] as Pt;
              // inside a counter-clockwise edge: its outward normal (ey, -ex) dotted with the point is at most the edge's
              const ex = q.x - p.x;
              const ey = q.y - p.y;
              const l = Math.sqrt(ex * ex + ey * ey);
              if (!(l > 0)) continue;
              const nx = ey / l;
              const ny = -ex / l;
              n = this.clipHalf(n, nx, ny, nx * p.x + ny * p.y);
            }
          }
          if (n < 3) continue;
          // area and centre of the part under water
          let a = 0;
          let cx = 0;
          let cy = 0;
          const x0 = this.ax[0] as number;
          const y0 = this.ay[0] as number;
          for (let q = 1; q + 1 < n; q++) {
            const e1x = (this.ax[q] as number) - x0;
            const e1y = (this.ay[q] as number) - y0;
            const e2x = (this.ax[q + 1] as number) - x0;
            const e2y = (this.ay[q + 1] as number) - y0;
            const t = 0.5 * (e1x * e2y - e1y * e2x);
            a += t;
            cx += (t * (e1x + e2x)) / 3;
            cy += (t * (e1y + e2y)) / 3;
          }
          if (!(a > 0)) continue;
          cx = cx / a + x0;
          cy = cy / a + y0;
          a *= scale;
          A += a;
          mx += a * cx;
          my += a * cy;
          rho += a * wa.density;
        }
      }
      if (!(A > 0)) continue;
      const cx = mx / A;
      const cy = my / A;
      const dens = rho / A;
      const mw = dens * A;
      // buoyancy: the weight of the water moved aside, against gravity
      const fbx = -mw * w.gx;
      const fby = -mw * w.gy;
      // drag on the part under water, at its centre, and on its turning
      const rx = cx - bxp;
      const ry = cy - byp;
      const wv = w.w[i] as number;
      const vcx = (w.vx[i] as number) - wv * ry;
      const vcy = (w.vy[i] as number) + wv * rx;
      const fdx = -WATER_DRAG * mw * vcx;
      const fdy = -WATER_DRAG * mw * vcy;
      const tq = rx * (fby + fdy) - ry * (fbx + fdx) - WATER_DRAG * mw * wv * (A / 6);
      w.jx[i] = (w.jx[i] as number) + h * (fbx + fdx);
      w.jy[i] = (w.jy[i] as number) + h * (fby + fdy);
      w.jt[i] = (w.jt[i] as number) + h * tq;
      const o = i * 4;
      this.f[o] = fbx;
      this.f[o + 1] = fby;
      this.f[o + 2] = fdx;
      this.f[o + 3] = fdy;
    }
  }

  /** After the body step: water's forces count as buoyancy and drag, and in the net force. */
  account(w: World2): void {
    const f = this.f;
    for (let i = 0; i < w.n && i * 4 < f.length; i++) {
      const o = i * 4;
      if (f[o] === 0 && f[o + 1] === 0 && f[o + 2] === 0 && f[o + 3] === 0) continue;
      addForce(w, i, FK.buoyancy, f[o] as number, f[o + 1] as number);
      addForce(w, i, FK.drag, f[o + 2] as number, f[o + 3] as number);
      addForce(w, i, FK.net, (f[o] as number) + (f[o + 2] as number), (f[o + 1] as number) + (f[o + 3] as number));
    }
  }

  /** Clips the polygon in (ax, ay) to the half-plane n · p <= d (Sutherland and Hodgman); returns the new count. */
  private clipHalf(n: number, nx: number, ny: number, d: number): number {
    if (n === 0) return 0;
    let m = 0;
    const ax = this.ax;
    const ay = this.ay;
    const bx = this.bx;
    const by = this.by;
    for (let q = 0; q < n; q++) {
      const px = ax[q] as number;
      const py = ay[q] as number;
      const r = (q + 1) % n;
      const qx = ax[r] as number;
      const qy = ay[r] as number;
      const sp = nx * px + ny * py - d;
      const sq = nx * qx + ny * qy - d;
      if (sp <= 0) {
        bx[m] = px;
        by[m] = py;
        m++;
      }
      if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) {
        const t = sp / (sp - sq);
        bx[m] = px + t * (qx - px);
        by[m] = py + t * (qy - py);
        m++;
      }
      if (m >= bx.length - 2) break;
    }
    // the result goes back into a
    this.ax = bx;
    this.ay = by;
    this.bx = ax;
    this.by = ay;
    return m;
  }
}
