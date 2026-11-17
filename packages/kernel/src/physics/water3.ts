/**
 * Still water in space (docs/features/physics/design.md 9.2, 9.3): Archimedes' rule with no particles. Each body in
 * space is cut by the water's surface plane; the part under it is pushed up by the weight of the water it takes the
 * place of, at that part's centre, and slowed by water drag. The volume under the plane is exact for a ball (a cap) and
 * for a convex hull (the hull clipped by the plane). Waves (`./waves`) use the same rule with the plane that touches
 * their surface under the body.
 */
import type { World3 } from './world3';
import { BodyType3, FK3 } from './world3';
import { cbrt } from './fluid3';

/** Water drag per second, per kg of water moved aside (as in the plane). */
export const WATER_DRAG3 = 2;
const NK = 10;

/** A water surface: the plane n · p = c, water on the side n · p <= c (n is up, of length 1). */
export interface WaterPlane {
  nx: number;
  ny: number;
  nz: number;
  c: number;
}

export interface Water3 {
  /** Still water below z = level, kg per m³. */
  readonly level: number;
  readonly density: number;
  /** For waves: the surface under a body at (x, y), or undefined where there is no water. */
  readonly local?: (x: number, y: number, out: WaterPlane) => boolean;
}

/** What is under the plane: the volume and its centre. */
export interface Under {
  vol: number;
  cx: number;
  cy: number;
  cz: number;
}

/** The part of a ball under the plane: a cap, exact. */
export function capUnder(cx: number, cy: number, cz: number, r: number, pl: WaterPlane, out: Under): void {
  const s = pl.nx * cx + pl.ny * cy + pl.nz * cz - pl.c;
  const hgt = Math.min(2 * r, Math.max(0, r - s));
  if (!(hgt > 0)) {
    out.vol = 0;
    return;
  }
  out.vol = (Math.PI * hgt * hgt * (3 * r - hgt)) / 3;
  // the centre of a cap of height hgt is 3 (2r − hgt)² / (4 (3r − hgt)) from the ball's centre, on the cap's side
  const dc = (3 * (2 * r - hgt) * (2 * r - hgt)) / (4 * (3 * r - hgt));
  out.cx = cx - pl.nx * dc;
  out.cy = cy - pl.ny * dc;
  out.cz = cz - pl.nz * dc;
}

/**
 * The part of a convex hull under the plane, exact: each face clipped by the plane, and the tetrahedra from a point on
 * the plane to the clipped faces (the cut face lies in the plane, so its tetrahedra are flat and need no building).
 */
export class HullClip {
  private ax = new Float64Array(64);
  private ay = new Float64Array(64);
  private az = new Float64Array(64);
  private bx = new Float64Array(64);
  private by = new Float64Array(64);
  private bz = new Float64Array(64);

  under(wv: Float64Array, faces: readonly Int32Array[], pl: WaterPlane, out: Under): void {
    // a point on the plane near the hull: the first corner, dropped onto the plane
    const s0 = pl.nx * (wv[0] as number) + pl.ny * (wv[1] as number) + pl.nz * (wv[2] as number) - pl.c;
    const ox = (wv[0] as number) - pl.nx * s0;
    const oy = (wv[1] as number) - pl.ny * s0;
    const oz = (wv[2] as number) - pl.nz * s0;
    let vol = 0;
    let mx = 0;
    let my = 0;
    let mz = 0;
    for (const f of faces) {
      const m = this.clipFace(wv, f, pl);
      if (m < 3) continue;
      const x0 = (this.ax[0] as number) - ox;
      const y0 = (this.ay[0] as number) - oy;
      const z0 = (this.az[0] as number) - oz;
      for (let k = 1; k + 1 < m; k++) {
        const x1 = (this.ax[k] as number) - ox;
        const y1 = (this.ay[k] as number) - oy;
        const z1 = (this.az[k] as number) - oz;
        const x2 = (this.ax[k + 1] as number) - ox;
        const y2 = (this.ay[k + 1] as number) - oy;
        const z2 = (this.az[k + 1] as number) - oz;
        const v = (x0 * (y1 * z2 - z1 * y2) - y0 * (x1 * z2 - z1 * x2) + z0 * (x1 * y2 - y1 * x2)) / 6;
        vol += v;
        mx += (v * (x0 + x1 + x2)) / 4;
        my += (v * (y0 + y1 + y2)) / 4;
        mz += (v * (z0 + z1 + z2)) / 4;
      }
    }
    // the faces' turn decides the sign; the centre is the same either way
    if (!(Math.abs(vol) > 1e-15)) {
      out.vol = 0;
      return;
    }
    out.cx = ox + mx / vol;
    out.cy = oy + my / vol;
    out.cz = oz + mz / vol;
    out.vol = Math.abs(vol);
  }

  /** One face clipped to n · p <= c (Sutherland and Hodgman) into (ax, ay, az); returns the corner count. */
  private clipFace(wv: Float64Array, f: Int32Array, pl: WaterPlane): number {
    const n = f.length;
    if (this.ax.length < 2 * n + 4) {
      for (const k of ['ax', 'ay', 'az', 'bx', 'by', 'bz'] as const) this[k] = new Float64Array(4 * n + 8);
    }
    let m = 0;
    for (let q = 0; q < n; q++) {
      const a = (f[q] as number) * 3;
      const b = (f[(q + 1) % n] as number) * 3;
      const px = wv[a] as number;
      const py = wv[a + 1] as number;
      const pz = wv[a + 2] as number;
      const qx = wv[b] as number;
      const qy = wv[b + 1] as number;
      const qz = wv[b + 2] as number;
      const sp = pl.nx * px + pl.ny * py + pl.nz * pz - pl.c;
      const sq = pl.nx * qx + pl.ny * qy + pl.nz * qz - pl.c;
      if (sp <= 0) {
        this.ax[m] = px;
        this.ay[m] = py;
        this.az[m] = pz;
        m++;
      }
      if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) {
        const t = sp / (sp - sq);
        this.ax[m] = px + t * (qx - px);
        this.ay[m] = py + t * (qy - py);
        this.az[m] = pz + t * (qz - pz);
        m++;
      }
    }
    return m;
  }
}

/** The forces water put on each body in space in the last step, for the arrows: buoyancy then drag, three numbers each. */
export class WaterForces3 {
  f = new Float64Array(0);
  private clip = new HullClip();
  private part: Under = { vol: 0, cx: 0, cy: 0, cz: 0 };
  private pl: WaterPlane = { nx: 0, ny: 0, nz: 1, c: 0 };

  /**
   * Before the body step: each awake body's buoyancy and drag, at its pose now, go into its speed as impulses (design
   * 5.2: a step reads its inputs at its start).
   */
  apply(w: World3, waters: readonly Water3[], h: number): void {
    if (this.f.length !== w.n * 6) this.f = new Float64Array(w.n * 6);
    else this.f.fill(0);
    if (waters.length === 0) return;
    const pl = this.pl;
    const part = this.part;
    for (let i = 0; i < w.n; i++) {
      if (w.type[i] !== BodyType3.Dynamic || w.awake[i] === 0 || w.gone.has(i)) continue;
      const px = w.p[i * 3] as number;
      const py = w.p[i * 3 + 1] as number;
      const pz = w.p[i * 3 + 2] as number;
      let V = 0;
      let mx = 0;
      let my = 0;
      let mz = 0;
      let rho = 0;
      for (const wa of waters) {
        if (wa.local) {
          if (!wa.local(px, py, pl)) continue;
        } else {
          pl.nx = 0;
          pl.ny = 0;
          pl.nz = 1;
          pl.c = wa.level;
        }
        const s0 = w.shape0[i] as number;
        for (let k = s0; k < s0 + (w.shapeN[i] as number); k++) {
          const sh = w.shapes[k];
          if (!sh) continue;
          if (sh.kind === 0) capUnder(sh.wc[0] as number, sh.wc[1] as number, sh.wc[2] as number, sh.r, pl, part);
          else if (sh.kind === 1) this.clip.under(sh.wv, sh.faces, pl, part);
          else continue;
          if (!(part.vol > 0)) continue;
          V += part.vol;
          mx += part.vol * part.cx;
          my += part.vol * part.cy;
          mz += part.vol * part.cz;
          rho += part.vol * wa.density;
        }
      }
      if (!(V > 0)) continue;
      const cx = mx / V;
      const cy = my / V;
      const cz = mz / V;
      const mw = rho;
      // buoyancy: the weight of the water moved aside, against gravity
      const fbx = -mw * w.gx;
      const fby = -mw * w.gy;
      const fbz = -mw * w.gz;
      // drag on the part under water, at its centre, and on its turning
      const rx = cx - px;
      const ry = cy - py;
      const rz = cz - pz;
      const wx = w.w[i * 3] as number;
      const wy = w.w[i * 3 + 1] as number;
      const wz = w.w[i * 3 + 2] as number;
      const vcx = (w.v[i * 3] as number) + wy * rz - wz * ry;
      const vcy = (w.v[i * 3 + 1] as number) + wz * rx - wx * rz;
      const vcz = (w.v[i * 3 + 2] as number) + wx * ry - wy * rx;
      const fdx = -WATER_DRAG3 * mw * vcx;
      const fdy = -WATER_DRAG3 * mw * vcy;
      const fdz = -WATER_DRAG3 * mw * vcz;
      const Fx = fbx + fdx;
      const Fy = fby + fdy;
      const Fz = fbz + fdz;
      // turning: r × F, and a drag on the turn over the size of the part under water
      const L2 = cbrt(V) ** 2 / 6;
      const tx = ry * Fz - rz * Fy - WATER_DRAG3 * mw * wx * L2;
      const ty = rz * Fx - rx * Fz - WATER_DRAG3 * mw * wy * L2;
      const tz = rx * Fy - ry * Fx - WATER_DRAG3 * mw * wz * L2;
      w.impulse[i * 3] = (w.impulse[i * 3] as number) + h * Fx;
      w.impulse[i * 3 + 1] = (w.impulse[i * 3 + 1] as number) + h * Fy;
      w.impulse[i * 3 + 2] = (w.impulse[i * 3 + 2] as number) + h * Fz;
      const I = w.invIw;
      const o = i * 9;
      w.w[i * 3] = wx + h * ((I[o] as number) * tx + (I[o + 1] as number) * ty + (I[o + 2] as number) * tz);
      w.w[i * 3 + 1] = wy + h * ((I[o + 3] as number) * tx + (I[o + 4] as number) * ty + (I[o + 5] as number) * tz);
      w.w[i * 3 + 2] = wz + h * ((I[o + 6] as number) * tx + (I[o + 7] as number) * ty + (I[o + 8] as number) * tz);
      const f = this.f;
      const q = i * 6;
      f[q] = fbx;
      f[q + 1] = fby;
      f[q + 2] = fbz;
      f[q + 3] = fdx;
      f[q + 4] = fdy;
      f[q + 5] = fdz;
    }
  }

  /** After the body step: water's forces count as buoyancy and drag (the net force already holds them). */
  account(w: World3): void {
    const f = this.f;
    for (let i = 0; i < w.n && i * 6 < f.length; i++) {
      const q = i * 6;
      if (f[q] === 0 && f[q + 1] === 0 && f[q + 2] === 0 && f[q + 3] === 0 && f[q + 4] === 0 && f[q + 5] === 0) continue;
      if (w.type[i] !== BodyType3.Dynamic) continue;
      const b = i * NK * 3 + FK3.buoyancy * 3;
      const d = i * NK * 3 + FK3.drag * 3;
      for (let a = 0; a < 3; a++) {
        w.forces[b + a] = (w.forces[b + a] as number) + (f[q + a] as number);
        w.forces[d + a] = (w.forces[d + a] as number) + (f[q + 3 + a] as number);
      }
    }
  }
}
