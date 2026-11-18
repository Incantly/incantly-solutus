/**
 * Liquid in space (docs/features/physics/design.md 9.1, 9.6): position-based fluids on the shared particle store, with
 * the neighbour grid of `./grid3`. The step is the plane's (`./fluid2`) in three numbers:
 *
 * 1. Taps (`Pour`) add their drops for this step, four abreast, placed with seeded numbers.
 * 2. Each drop's place is predicted from its speed and gravity (at most 1.5 spacings a step).
 * 3. The neighbour grid is rebuilt (counting sort, no garbage) and the pairs closer than the reach are listed once.
 * 4. Two density passes move the drops apart where they crowd (never pulled at a free surface), Jacobi over the pairs.
 * 5. After each pass, drops are pushed out of bodies, then out of the floor, terrain and solids (walls win). A drop whose
 *    path went into a solid is put back out through the face it came in by, so a thin wall never leaks. The push a drop
 *    gets from a body is an impulse the body takes back, equal and opposite, at the start of the next step.
 * 6. Speeds are the move over the step, smoothed a little toward the neighbours' (XSPH viscosity).
 * 7. Drops that left the world range are taken out.
 *
 * Deterministic: loops in index order, neighbour lists from a stable sort, Jacobi passes.
 */
import { mix32 } from '../commands/probability/random';
import type { ShapeDef3, World3 } from './world3';
import { BodyType3, FK3 } from './world3';
import { MAX_NEIGHBOURS3, middleOf, NeighbourGrid3, ParticleSet } from './particles';
import { MAX_CORRECTION, MAX_DROPS } from './fluid2';

/** A drop's reach in spacings: 18 neighbours at rest on the cubic grid. */
export const REACH3 = 1.6;
/** Drop size in space when a figure has only taps. */
export const DEFAULT_SPACING3 = 0.1;
/**
 * The drops list their pairs on every third step and keep the list for the next two (round 7): a drop moves far less than
 * its reach in two steps, and the weights fade to nothing at the reach, so a pair that came near is missed only where it
 * would weigh almost nothing. Checkpoints fall on listing steps (the driver keeps them a multiple of this apart).
 */
export const PAIR_EVERY = 2;
const PASSES = 1;
const NK = 10;

export interface DropSource3 {
  readonly owner: number;
  readonly viscosity: number;
  /** kg per m³: a drop weighs `density × spacing³`. */
  readonly density: number;
  readonly start?: { readonly xs: readonly number[]; readonly ys: readonly number[]; readonly zs: readonly number[] };
  readonly pour?: { readonly x: number; readonly y: number; readonly z: number; readonly vx: number; readonly vy: number; readonly vz: number; readonly rate: number; readonly max: number };
}

/** A region drops fill: a convex hull (its faces as planes) or a ball. */
export type Region3 = Extract<ShapeDef3, { kind: 'hull' } | { kind: 'sphere' }>;

/** The planes n · p <= d of a convex hull, its normals outward. */
export function hullPlanes(verts: readonly { x: number; y: number; z: number }[], faces: readonly (readonly number[])[]): number[] {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const v of verts) {
    cx += v.x;
    cy += v.y;
    cz += v.z;
  }
  cx /= Math.max(1, verts.length);
  cy /= Math.max(1, verts.length);
  cz /= Math.max(1, verts.length);
  const out: number[] = [];
  for (const f of faces) {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < f.length; i++) {
      const a = verts[f[i] as number] as { x: number; y: number; z: number };
      const b = verts[f[(i + 1) % f.length] as number] as { x: number; y: number; z: number };
      nx += (a.y - b.y) * (a.z + b.z);
      ny += (a.z - b.z) * (a.x + b.x);
      nz += (a.x - b.x) * (a.y + b.y);
    }
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(l > 0)) continue;
    nx /= l;
    ny /= l;
    nz /= l;
    const p = verts[f[0] as number] as { x: number; y: number; z: number };
    let d = nx * p.x + ny * p.y + nz * p.z;
    // outward: the centre is behind every face
    if (nx * cx + ny * cy + nz * cz > d) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
      d = -d;
    }
    out.push(nx, ny, nz, d);
  }
  return out;
}

function regionBox(r: Region3): { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number } {
  if (r.kind === 'sphere') return { x0: r.c.x - r.r, y0: r.c.y - r.r, z0: r.c.z - r.r, x1: r.c.x + r.r, y1: r.c.y + r.r, z1: r.c.z + r.r };
  let x0 = Infinity;
  let y0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let z1 = -Infinity;
  for (const v of r.verts) {
    x0 = Math.min(x0, v.x);
    y0 = Math.min(y0, v.y);
    z0 = Math.min(z0, v.z);
    x1 = Math.max(x1, v.x);
    y1 = Math.max(y1, v.y);
    z1 = Math.max(z1, v.z);
  }
  return { x0, y0, z0, x1, y1, z1 };
}

/** The volume of a region (exact for a ball and a convex hull). */
export function regionVolume(r: Region3): number {
  if (r.kind === 'sphere') return (4 / 3) * Math.PI * r.r * r.r * r.r;
  let v = 0;
  const o = r.verts[0];
  if (!o) return 0;
  for (const f of r.faces) {
    const a = r.verts[f[0] as number] as { x: number; y: number; z: number };
    for (let k = 1; k + 1 < f.length; k++) {
      const b = r.verts[f[k] as number] as { x: number; y: number; z: number };
      const c = r.verts[f[k + 1] as number] as { x: number; y: number; z: number };
      const ax = a.x - o.x;
      const ay = a.y - o.y;
      const az = a.z - o.z;
      const bx = b.x - o.x;
      const by = b.y - o.y;
      const bz = b.z - o.z;
      const cx = c.x - o.x;
      const cy = c.y - o.y;
      const cz = c.z - o.z;
      v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    }
  }
  return Math.abs(v);
}

/** The cube root by Newton's method with exact operations only (the same digits on every computer). */
export function cbrt(a: number): number {
  if (!(a > 0)) return 0;
  let x = a > 1 ? a / 3 : 1;
  for (let k = 0; k < 200; k++) {
    const nx = (2 * x + a / (x * x)) / 3;
    if (nx === x) break;
    x = nx;
  }
  return x;
}

/** The spacing that fills a region with `count` drops on a cubic grid. */
export function spacingFor3(r: Region3, count: number): number {
  const v = regionVolume(r);
  if (!(v > 0) || !(count > 0)) return DEFAULT_SPACING3;
  let d = cbrt(v / count);
  for (let k = 0; k < 60 && fillRegion3(r, count, d).xs.length < count; k++) d *= 0.985;
  return Math.min(0.5, Math.max(0.01, d));
}

/**
 * `count` drop places in the region on a cubic grid of spacing `d`, from the bottom layer up, each layer in rows of y
 * and x. When the region holds fewer, the rest stand in layers above it, over its box, and fall in.
 */
export function fillRegion3(r: Region3, count: number, d: number): { xs: number[]; ys: number[]; zs: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  if (!(d > 0) || !(count > 0)) return { xs, ys, zs };
  const b = regionBox(r);
  const planes = r.kind === 'hull' ? hullPlanes(r.verts, r.faces) : [];
  const inside = (x: number, y: number, z: number): boolean => {
    if (r.kind === 'sphere') return (x - r.c.x) ** 2 + (y - r.c.y) ** 2 + (z - r.c.z) ** 2 <= r.r * r.r;
    for (let k = 0; k < planes.length; k += 4) if ((planes[k] as number) * x + (planes[k + 1] as number) * y + (planes[k + 2] as number) * z > (planes[k + 3] as number) + 1e-12) return false;
    return true;
  };
  const nx = Math.max(1, Math.floor((b.x1 - b.x0) / d + 1e-9));
  const ny = Math.max(1, Math.floor((b.y1 - b.y0) / d + 1e-9));
  const ox = b.x0 + 0.5 * (b.x1 - b.x0 - (nx - 1) * d);
  const oy = b.y0 + 0.5 * (b.y1 - b.y0 - (ny - 1) * d);
  for (let layer = 0; xs.length < count && layer < 100000; layer++) {
    const z = b.z0 + d * (0.5 + layer);
    const above = z > b.z1;
    let any = false;
    for (let j = 0; j < ny && xs.length < count; j++) {
      for (let i = 0; i < nx && xs.length < count; i++) {
        const x = ox + i * d;
        const y = oy + j * d;
        if (above || inside(x, y, z)) {
          xs.push(x);
          ys.push(y);
          zs.push(z);
          any = true;
        }
      }
    }
    if (!any && above) break;
  }
  return { xs, ys, zs };
}

/** The surface of drops at rest on a grid of spacing `d`: the middle of the column tops, plus a drop's radius. */
export function restLevel3(xs: readonly number[], ys: readonly number[], zs: readonly number[], d: number): number {
  const tops = new Map<string, number>();
  for (let i = 0; i < xs.length; i++) {
    const key = `${Math.round((xs[i] as number) / d)},${Math.round((ys[i] as number) / d)}`;
    const z = zs[i] as number;
    if (!(z <= (tops.get(key) ?? -Infinity))) tops.set(key, z);
  }
  const t = [...tops.values()].sort((a, b) => a - b);
  if (t.length === 0) return Number.NaN;
  const m = t.length;
  const mid = m % 2 === 1 ? (t[(m - 1) / 2] as number) : 0.5 * ((t[m / 2 - 1] as number) + (t[m / 2] as number));
  return mid + 0.5 * d;
}

export class Fluid3 {
  readonly ps: ParticleSet;
  readonly grid = new NeighbourGrid3();
  readonly d: number;
  readonly H: number;
  readonly r: number;
  readonly sources: readonly DropSource3[];
  emitted: Float64Array;
  steps = 0;
  /** Impulses (and their turning parts) the drops gave each body in the last step, applied at the start of the next. */
  jx = new Float64Array(0);
  jy = new Float64Array(0);
  jz = new Float64Array(0);
  tx = new Float64Array(0);
  ty = new Float64Array(0);
  tz = new Float64Array(0);
  private applied = new Float64Array(0);
  left: number[] = [];
  unstable = false;
  private rho0 = 1;
  private eps = 1;
  private k6 = 1;
  private ks = 1;
  private lam = new Float64Array(0);
  private dx = new Float64Array(0);
  private dy = new Float64Array(0);
  private dz = new Float64Array(0);
  /** Each pair's gradient over its distance, in the density pass now. */
  private gs = new Float64Array(0);
  /** Each pair's weight in the last density pass, for the viscosity. */
  private vw = new Float64Array(0);
  private rho = new Float64Array(0);
  private sx = new Float64Array(0);
  private sy = new Float64Array(0);
  private sz = new Float64Array(0);
  private s2 = new Float64Array(0);
  private visc: Float64Array;
  private mass: Float64Array;
  /** Planes of the hull being tested, scratch. */
  private planes = new Float64Array(64);

  constructor(spacing: number, sources: readonly DropSource3[], owners: number) {
    this.d = spacing;
    this.H = REACH3 * spacing;
    this.r = 0.5 * spacing;
    this.sources = sources;
    this.grid.setSize(this.H);
    this.emitted = new Float64Array(sources.length);
    this.visc = new Float64Array(Math.max(1, owners));
    this.mass = new Float64Array(Math.max(1, owners));
    for (const s of sources) {
      this.visc[s.owner] = Math.min(1, Math.max(0, s.viscosity));
      if ((this.visc[s.owner] as number) > 0) this.anyViscous = true;
      this.mass[s.owner] = Math.max(1e-6, s.density) * spacing * spacing * spacing;
    }
    const H = this.H;
    // poly6 for the density, spiky for its gradient (3D forms); the rest density is that of the cubic grid at rest
    const H2 = H * H;
    const H3 = H2 * H;
    const H6 = H3 * H3;
    this.k6 = 315 / (64 * Math.PI * H6 * H3);
    this.ks = -45 / (Math.PI * H6);
    let rho = 0;
    let g2 = 0;
    const reach = Math.ceil(H / spacing);
    for (let a = -reach; a <= reach; a++) {
      for (let b = -reach; b <= reach; b++) {
        for (let c = -reach; c <= reach; c++) {
          const r2 = (a * a + b * b + c * c) * spacing * spacing;
          if (r2 >= H2) continue;
          const q = H2 - r2;
          rho += this.k6 * q * q * q;
          if (r2 > 0) {
            const r = Math.sqrt(r2);
            const g = this.ks * (H - r) * (H - r);
            g2 += g * g;
          }
        }
      }
    }
    this.rho0 = rho;
    this.eps = 0.1 * (g2 / (rho * rho));
    let total = 0;
    for (const s of sources) if (s.start) total += s.start.xs.length;
    this.ps = new ParticleSet(Math.min(MAX_DROPS, total + 64));
    for (const s of sources) {
      if (!s.start) continue;
      const { xs, ys, zs } = s.start;
      for (let k = 0; k < xs.length && this.ps.n < MAX_DROPS; k++) this.ps.add3(xs[k] as number, ys[k] as number, zs[k] as number, 0, 0, 0, s.owner);
    }
  }

  massOf(owner: number): number {
    return this.mass[owner] as number;
  }

  private sizeBodies(n: number): void {
    if (this.jx.length === n) return;
    this.jx = new Float64Array(n);
    this.jy = new Float64Array(n);
    this.jz = new Float64Array(n);
    this.tx = new Float64Array(n);
    this.ty = new Float64Array(n);
    this.tz = new Float64Array(n);
    this.applied = new Float64Array(n * 3);
  }

  private sizeDrops(n: number): void {
    if (this.lam.length >= n) return;
    let c = Math.max(64, this.lam.length);
    while (c < n) c *= 2;
    this.lam = new Float64Array(c);
    this.dx = new Float64Array(c);
    this.dy = new Float64Array(c);
    this.dz = new Float64Array(c);
    this.rho = new Float64Array(c);
    this.sx = new Float64Array(c);
    this.sy = new Float64Array(c);
    this.sz = new Float64Array(c);
    this.s2 = new Float64Array(c);
    const np = (c * MAX_NEIGHBOURS3) / 2;
    this.gs = new Float64Array(np);
    this.vw = new Float64Array(np);
  }

  /** Before the body step: the drops' push of the last step goes into the bodies (design 9.6). */
  applyImpulses(w: World3): void {
    this.sizeBodies(w.n);
    for (let i = 0; i < w.n; i++) {
      const jx = this.jx[i] as number;
      const jy = this.jy[i] as number;
      const jz = this.jz[i] as number;
      this.applied[i * 3] = jx;
      this.applied[i * 3 + 1] = jy;
      this.applied[i * 3 + 2] = jz;
      if (jx === 0 && jy === 0 && jz === 0) continue;
      if (w.type[i] === BodyType3.Dynamic && !w.gone.has(i)) {
        w.impulse[i * 3] = (w.impulse[i * 3] as number) + jx;
        w.impulse[i * 3 + 1] = (w.impulse[i * 3 + 1] as number) + jy;
        w.impulse[i * 3 + 2] = (w.impulse[i * 3 + 2] as number) + jz;
        // the turning part: ω += I⁻¹ (r × J), with the world inverse inertia now
        const tx = this.tx[i] as number;
        const ty = this.ty[i] as number;
        const tz = this.tz[i] as number;
        const I = w.invIw;
        const o = i * 9;
        w.w[i * 3] = (w.w[i * 3] as number) + (I[o] as number) * tx + (I[o + 1] as number) * ty + (I[o + 2] as number) * tz;
        w.w[i * 3 + 1] = (w.w[i * 3 + 1] as number) + (I[o + 3] as number) * tx + (I[o + 4] as number) * ty + (I[o + 5] as number) * tz;
        w.w[i * 3 + 2] = (w.w[i * 3 + 2] as number) + (I[o + 6] as number) * tx + (I[o + 7] as number) * ty + (I[o + 8] as number) * tz;
      }
      this.jx[i] = 0;
      this.jy[i] = 0;
      this.jz[i] = 0;
      this.tx[i] = 0;
      this.ty[i] = 0;
      this.tz[i] = 0;
    }
  }

  /** After the body step: the push of the liquid counts as buoyancy (the net force already holds it). */
  account(w: World3, h: number): void {
    const inv = 1 / h;
    for (let i = 0; i < w.n && i * 3 < this.applied.length; i++) {
      const fx = (this.applied[i * 3] as number) * inv;
      const fy = (this.applied[i * 3 + 1] as number) * inv;
      const fz = (this.applied[i * 3 + 2] as number) * inv;
      if ((fx === 0 && fy === 0 && fz === 0) || w.type[i] !== BodyType3.Dynamic) continue;
      const o = i * NK * 3 + FK3.buoyancy * 3;
      w.forces[o] = (w.forces[o] as number) + fx;
      w.forces[o + 1] = (w.forces[o + 1] as number) + fy;
      w.forces[o + 2] = (w.forces[o + 2] as number) + fz;
    }
  }

  /** Lets out this step's drops of each tap: four abreast across the stream, rows back up it. */
  private pour(h: number): void {
    for (let k = 0; k < this.sources.length; k++) {
      const s = this.sources[k] as DropSource3;
      const p = s.pour;
      if (!p) continue;
      const target = Math.min(p.max, Math.floor((this.steps + 1) * h * p.rate + 1e-9));
      let e = this.emitted[k] as number;
      if (e >= target) continue;
      const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
      const ux = sp > 0 ? p.vx / sp : 0;
      const uy = sp > 0 ? p.vy / sp : 0;
      const uz = sp > 0 ? p.vz / sp : -1;
      // two directions across the stream
      let ax = -uy;
      let ay = ux;
      let az = 0;
      let al = Math.sqrt(ax * ax + ay * ay);
      if (!(al > 1e-9)) {
        ax = 1;
        ay = 0;
        al = 1;
      }
      ax /= al;
      ay /= al;
      az /= al;
      const bx = uy * az - uz * ay;
      const by = uz * ax - ux * az;
      const bz = ux * ay - uy * ax;
      // four lanes one spacing apart carry at most 4 v / d drops a second: a faster rate leaves faster
      const ve = Math.max(sp, (p.rate * this.d) / 4);
      const first = e;
      const seed = mix32(0x7f4a7c15 ^ (s.owner + 1));
      while (e < target && this.ps.n < MAX_DROPS) {
        const j = e - first;
        const lane = e % 4;
        const row = Math.floor(j / 4);
        const u1 = mix32((seed ^ Math.imul(e + 1, 0x85ebca6b)) >>> 0) / 4294967296 - 0.5;
        const u2 = mix32((seed ^ Math.imul(e + 1, 0xc2b2ae35)) >>> 0) / 4294967296 - 0.5;
        const a = ((lane & 1) - 0.5) * 0.9 * this.d + u1 * 0.2 * this.d;
        const b = ((lane >> 1) - 0.5) * 0.9 * this.d + u2 * 0.2 * this.d;
        const along = -row * this.d;
        this.ps.add3(p.x + ax * a + bx * b + ux * along, p.y + ay * a + by * b + uy * along, p.z + az * a + bz * b + uz * along, ux * ve, uy * ve, uz * ve, s.owner);
        e++;
      }
      this.emitted[k] = e;
    }
  }

  step(w: World3, h: number, range: number): void {
    this.left.length = 0;
    this.hStep = h;
    this.sizeBodies(w.n);
    this.pour(h);
    this.steps++;
    const ps = this.ps;
    const n = ps.n;
    if (n === 0) return;
    this.sizeDrops(n);
    const { x, y, z, vx, vy, vz, x0, y0, z0 } = ps;
    const maxMove = 1.5 * this.d;
    const max2 = maxMove * maxMove;
    const gx = w.gx;
    const gy = w.gy;
    const gz = w.gz;
    for (let i = 0; i < n; i++) {
      const xi = x[i] as number;
      const yi = y[i] as number;
      const zi = z[i] as number;
      x0[i] = xi;
      y0[i] = yi;
      z0[i] = zi;
      let mx = ((vx[i] as number) + h * gx) * h;
      let my = ((vy[i] as number) + h * gy) * h;
      let mz = ((vz[i] as number) + h * gz) * h;
      const m2 = mx * mx + my * my + mz * mz;
      if (m2 > max2) {
        const s = maxMove / Math.sqrt(m2);
        mx *= s;
        my *= s;
        mz *= s;
      }
      x[i] = xi + mx;
      y[i] = yi + my;
      z[i] = zi + mz;
    }
    const grid = this.grid;
    grid.build(x, y, z, n);
    // the pairs are listed on every third step (PAIR_EVERY), and afresh after a load or when drops went: a checkpoint is on
    // a listing step, so a seek lists them where the film did
    if (this.stale || this.steps % PAIR_EVERY === 1) {
      grid.findPairs(x, y, z, n, this.H);
      this.stale = false;
    }
    for (let pass = 0; pass < PASSES; pass++) this.densityPass(n, pass === PASSES - 1);
    this.collide(w);
    const inv = 1 / h;
    for (let i = 0; i < n; i++) {
      vx[i] = ((x[i] as number) - (x0[i] as number)) * inv;
      vy[i] = ((y[i] as number) - (y0[i] as number)) * inv;
      vz[i] = ((z[i] as number) - (z0[i] as number)) * inv;
    }
    this.viscosity(n);
    let bad = false;
    let out = false;
    for (let i = 0; i < n; i++) {
      const xi = x[i] as number;
      const yi = y[i] as number;
      const zi = z[i] as number;
      if (!(Math.abs(xi) <= range && Math.abs(yi) <= range && Math.abs(zi) <= range)) {
        out = true;
        if (!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(zi)) bad = true;
        else this.left.push(ps.owner[i] as number);
      }
    }
    if (bad) this.unstable = true;
    if (out) {
      ps.compact((i) => Math.abs(x[i] as number) <= range && Math.abs(y[i] as number) <= range && Math.abs(z[i] as number) <= range);
      this.stale = true;
    }
  }

  /** The pairs must be listed afresh at the next step (after a load, or when drops went). */
  private stale = true;

  /** The pair list as it is now, to put back after a look ahead (the driver's `sample`). */
  keepPairs(): { pi: Int32Array; pj: Int32Array; pairs: number; stale: boolean } {
    const g = this.grid;
    return { pi: g.pi.slice(0, g.pairs), pj: g.pj.slice(0, g.pairs), pairs: g.pairs, stale: this.stale };
  }

  restorePairs(k: { pi: Int32Array; pj: Int32Array; pairs: number; stale: boolean }): void {
    const g = this.grid;
    g.pi.set(k.pi);
    g.pj.set(k.pj);
    g.pairs = k.pairs;
    this.stale = k.stale;
  }

  /**
   * One density pass, Jacobi over the pairs. A pair keeps one number, its gradient over its distance; the direction is
   * read again from the places, which do not move until the pass ends (less to read and write). Only the last pass keeps
   * the pairs' weights, for the viscosity.
   */
  private densityPass(n: number, last: boolean): void {
    const { x, y, z } = this.ps;
    const grid = this.grid;
    const pi = grid.pi;
    const pj = grid.pj;
    const np = grid.pairs;
    const H = this.H;
    const H2 = H * H;
    const k6 = this.k6;
    const inv0 = 1 / this.rho0;
    const ks = this.ks * inv0;
    const { lam, gs, rho, s2, vw } = this;
    const self = k6 * H2 * H2 * H2;
    const invSelf = 1 / self;
    rho.fill(self, 0, n);
    s2.fill(0, 0, n);
    for (let p = 0; p < np; p++) {
      const i = pi[p] as number;
      const j = pj[p] as number;
      const ex = (x[i] as number) - (x[j] as number);
      const ey = (y[i] as number) - (y[j] as number);
      const ez = (z[i] as number) - (z[j] as number);
      const r2 = ex * ex + ey * ey + ez * ez;
      if (r2 >= H2) {
        gs[p] = 0;
        if (last) vw[p] = 0;
        continue;
      }
      const q = H2 - r2;
      const wt = k6 * q * q * q;
      if (last) vw[p] = wt * invSelf;
      rho[i] = (rho[i] as number) + wt;
      rho[j] = (rho[j] as number) + wt;
      let g = 0;
      if (r2 > 1e-24) {
        const r = Math.sqrt(r2);
        const hr = H - r;
        g = (ks * hr * hr) / r;
      }
      gs[p] = g;
      const g2 = g * g * r2;
      s2[i] = (s2[i] as number) + g2;
      s2[j] = (s2[j] as number) + g2;
    }
    // λ = −C / (Σ|∇C|² + eps) with the neighbours' part of the sum only: the drop's own gradient is the sum of theirs,
    // which nearly cancels where drops crowd (the only place λ acts), and its vector sums cost a fifth of the step
    // (round 7). Crowded drops have larger gradients, so they move less: no jets where a body squeezes them
    const eps = this.eps;
    let any = false;
    for (let i = 0; i < n; i++) {
      const C = (rho[i] as number) * inv0 - 1;
      if (C > 0) {
        lam[i] = -C / ((s2[i] as number) + eps);
        any = true;
      } else lam[i] = 0;
    }
    if (!any) return;
    const { dx, dy, dz } = this;
    dx.fill(0, 0, n);
    dy.fill(0, 0, n);
    dz.fill(0, 0, n);
    for (let p = 0; p < np; p++) {
      const g = gs[p] as number;
      if (g === 0) continue;
      const i = pi[p] as number;
      const j = pj[p] as number;
      const sum = (lam[i] as number) + (lam[j] as number);
      if (sum === 0) continue;
      const f = sum * g;
      const mx = f * ((x[i] as number) - (x[j] as number));
      const my = f * ((y[i] as number) - (y[j] as number));
      const mz = f * ((z[i] as number) - (z[j] as number));
      dx[i] = (dx[i] as number) + mx;
      dy[i] = (dy[i] as number) + my;
      dz[i] = (dz[i] as number) + mz;
      dx[j] = (dx[j] as number) - mx;
      dy[j] = (dy[j] as number) - my;
      dz[j] = (dz[j] as number) - mz;
    }
    const lim = MAX_CORRECTION * this.d;
    const lim2 = lim * lim;
    for (let i = 0; i < n; i++) {
      let mx = dx[i] as number;
      let my = dy[i] as number;
      let mz = dz[i] as number;
      const m2 = mx * mx + my * my + mz * mz;
      if (m2 > lim2) {
        const s = lim / Math.sqrt(m2);
        mx *= s;
        my *= s;
        mz *= s;
      }
      x[i] = (x[i] as number) + mx;
      y[i] = (y[i] as number) + my;
      z[i] = (z[i] as number) + mz;
    }
  }

  /** True when some liquid has a viscosity above 0. */
  private anyViscous = false;

  /** XSPH viscosity: each drop's speed moves toward its neighbours' by its liquid's viscosity, with the last pass's weights. */
  private viscosity(n: number): void {
    // on every second step, twice as strong (at most 1): the same smoothing for half the work (round 7)
    if (!this.anyViscous || this.steps % 2 === 1) return;
    const { vx, vy, vz, owner } = this.ps;
    const grid = this.grid;
    const pi = grid.pi;
    const pj = grid.pj;
    const np = grid.pairs;
    const vw = this.vw;
    const visc = this.visc;
    const { sx, sy, sz, rho } = this;
    sx.fill(0, 0, n);
    sy.fill(0, 0, n);
    sz.fill(0, 0, n);
    for (let p = 0; p < np; p++) {
      const wt = vw[p] as number;
      if (wt === 0) continue;
      const i = pi[p] as number;
      const j = pj[p] as number;
      const ux = wt * ((vx[j] as number) - (vx[i] as number));
      const uy = wt * ((vy[j] as number) - (vy[i] as number));
      const uz = wt * ((vz[j] as number) - (vz[i] as number));
      sx[i] = (sx[i] as number) + ux;
      sy[i] = (sy[i] as number) + uy;
      sz[i] = (sz[i] as number) + uz;
      sx[j] = (sx[j] as number) - ux;
      sy[j] = (sy[j] as number) - uy;
      sz[j] = (sz[j] as number) - uz;
    }
    // each drop's weights add up to its last density less its own, over its own
    const H2 = this.H * this.H;
    const self = this.k6 * H2 * H2 * H2;
    const invSelf = 1 / self;
    for (let i = 0; i < n; i++) {
      const s = ((rho[i] as number) - self) * invSelf;
      if (!(s > 0)) continue;
      const f = Math.min(1, 2 * (visc[owner[i] as number] as number)) / Math.max(1, s);
      vx[i] = (vx[i] as number) + f * (sx[i] as number);
      vy[i] = (vy[i] as number) + f * (sy[i] as number);
      vz[i] = (vz[i] as number) + f * (sz[i] as number);
    }
  }

  /* ------------------------------ drops against bodies and solids ------------------------------ */

  /** Pushes drops out of bodies (first), then the floor, terrain and solids. Bodies get the equal and opposite impulse. */
  private collide(w: World3): void {
    for (let pass = 0; pass < 2; pass++) {
      for (let b = 0; b < w.n; b++) {
        if (w.gone.has(b)) continue;
        const dynamic = w.type[b] === BodyType3.Dynamic;
        if (dynamic !== (pass === 0)) continue;
        const s0 = w.shape0[b] as number;
        const sn = w.shapeN[b] as number;
        for (let k = s0; k < s0 + sn; k++) this.collideShape(w, b, k, dynamic);
      }
    }
  }

  private collideShape(w: World3, b: number, k: number, dynamic: boolean): void {
    const sh = w.shapes[k];
    if (!sh) return;
    const ps = this.ps;
    const n = ps.n;
    const r = this.r;
    const { x, y, z } = ps;
    if (sh.kind === 2) {
      // a plane: solid behind it (the floor is solid below)
      const nx = sh.lc[0] as number;
      const ny = sh.lc[1] as number;
      const nz = sh.lc[2] as number;
      const d = sh.lc[3] as number;
      for (let i = 0; i < n; i++) {
        const s = nx * (x[i] as number) + ny * (y[i] as number) + nz * (z[i] as number) - d;
        if (s >= r) continue;
        const m = r - s;
        x[i] = (x[i] as number) + nx * m;
        y[i] = (y[i] as number) + ny * m;
        z[i] = (z[i] as number) + nz * m;
      }
      return;
    }
    if (sh.kind === 3) {
      if (sh.hf) this.collideTerrain(sh.hf);
      return;
    }
    // the grid holds where drops were predicted to be: since then a drop moved at most half a spacing (the density pass),
    // and its path this step reaches 1.5 spacings back, so a drop that crossed the shape is within 2 spacings of it
    const pad = r + 2 * this.d;
    const lo = w.lo;
    const hi = w.hi;
    const m = this.grid.inBox((lo[k * 3] as number) - pad, (lo[k * 3 + 1] as number) - pad, (lo[k * 3 + 2] as number) - pad, (hi[k * 3] as number) + pad, (hi[k * 3 + 1] as number) + pad, (hi[k * 3 + 2] as number) + pad, n);
    const found = this.grid.found;
    if (sh.kind === 0) {
      const cx = sh.wc[0] as number;
      const cy = sh.wc[1] as number;
      const cz = sh.wc[2] as number;
      const R = sh.r + r;
      for (let q = 0; q < m; q++) {
        const i = found[q] as number;
        const ex = (x[i] as number) - cx;
        const ey = (y[i] as number) - cy;
        const ez = (z[i] as number) - cz;
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 >= R * R) continue;
        const dd = Math.sqrt(d2);
        let px = 0;
        let py = 0;
        let pz = R;
        if (dd > 1e-12) {
          const f = (R - dd) / dd;
          px = ex * f;
          py = ey * f;
          pz = ez * f;
        }
        x[i] = (x[i] as number) + px;
        y[i] = (y[i] as number) + py;
        z[i] = (z[i] as number) + pz;
        if (dynamic) this.giveBack(w, b, i, px, py, pz);
      }
      return;
    }
    // a convex hull: its face planes, pushed out by a drop's radius
    const nf = sh.faces.length;
    if (this.planes.length < nf * 4) this.planes = new Float64Array(nf * 8);
    const pl = this.planes;
    const wv = sh.wv;
    const wn = sh.wn;
    for (let f = 0; f < nf; f++) {
      const c0 = (sh.faces[f] as Int32Array)[0] as number;
      const nx = wn[f * 3] as number;
      const ny = wn[f * 3 + 1] as number;
      const nz = wn[f * 3 + 2] as number;
      pl[f * 4] = nx;
      pl[f * 4 + 1] = ny;
      pl[f * 4 + 2] = nz;
      pl[f * 4 + 3] = nx * (wv[c0 * 3] as number) + ny * (wv[c0 * 3 + 1] as number) + nz * (wv[c0 * 3 + 2] as number) + r;
    }
    const { x0, y0, z0 } = ps;
    const bx0 = (lo[k * 3] as number) - r;
    const by0 = (lo[k * 3 + 1] as number) - r;
    const bz0 = (lo[k * 3 + 2] as number) - r;
    const bx1 = (hi[k * 3] as number) + r;
    const by1 = (hi[k * 3 + 1] as number) + r;
    const bz1 = (hi[k * 3 + 2] as number) + r;
    for (let q = 0; q < m; q++) {
      const i = found[q] as number;
      const xi = x[i] as number;
      const yi = y[i] as number;
      const zi = z[i] as number;
      // the box of the drop's path this step misses the hull's box: it cannot touch
      const ax0 = x0[i] as number;
      const ay0 = y0[i] as number;
      const az0 = z0[i] as number;
      if ((xi < bx0 && ax0 < bx0) || (xi > bx1 && ax0 > bx1) || (yi < by0 && ay0 < by0) || (yi > by1 && ay0 > by1) || (zi < bz0 && az0 < bz0) || (zi > bz1 && az0 > bz1)) continue;
      // the face the drop is least inside of, at its place now
      let sep = -Infinity;
      let best = 0;
      for (let f = 0; f < nf; f++) {
        const s = (pl[f * 4] as number) * xi + (pl[f * 4 + 1] as number) * yi + (pl[f * 4 + 2] as number) * zi - (pl[f * 4 + 3] as number);
        if (s > sep) {
          sep = s;
          best = f;
        }
      }
      let face = -1;
      let depth = 0;
      if (dynamic) {
        // a body moves during the step, so the drop's path is not against the hull where it is now: a drop it moved onto
        // goes out through the nearest face (the path test would throw it out through the far side)
        if (sep < 0) {
          const px = (pl[best * 4] as number) * -sep;
          const py = (pl[best * 4 + 1] as number) * -sep;
          const pz = (pl[best * 4 + 2] as number) * -sep;
          x[i] = xi + px;
          y[i] = yi + py;
          z[i] = zi + pz;
          this.giveBack(w, b, i, px, py, pz);
        }
        continue;
      }
      // a wall: the path from the start of the step, where it went in (Cyrus and Beck), so a drop that crossed a thin
      // wall goes back out the side it came from
      const ax = x0[i] as number;
      const ay = y0[i] as number;
      const az = z0[i] as number;
      const ux = xi - ax;
      const uy = yi - ay;
      const uz = zi - az;
      // a drop that starts on a face (pushed out onto it last step) enters at t = 0: it must count as entering, or the
      // nearest-face rule below would throw it out through the far side of a thin wall
      let tIn = -Infinity;
      let tOut = 1;
      let inFace = -1;
      let crossed = true;
      for (let f = 0; f < nf && crossed; f++) {
        const nx = pl[f * 4] as number;
        const ny = pl[f * 4 + 1] as number;
        const nz = pl[f * 4 + 2] as number;
        const s0 = nx * ax + ny * ay + nz * az - (pl[f * 4 + 3] as number);
        const du = nx * ux + ny * uy + nz * uz;
        if (du === 0) {
          if (s0 > 0) crossed = false;
          continue;
        }
        const t = -s0 / du;
        if (du < 0) {
          // entering through this face
          if (t > tIn) {
            tIn = t;
            inFace = f;
          }
        } else if (t < tOut) tOut = t;
        if (tIn > tOut) crossed = false;
      }
      if (crossed && inFace >= 0 && tIn >= -1e-9) {
        // it started outside and its path met the hull: back out through the face it came in by
        face = inFace;
        const nx = pl[face * 4] as number;
        const ny = pl[face * 4 + 1] as number;
        const nz = pl[face * 4 + 2] as number;
        depth = -(nx * xi + ny * yi + nz * zi - (pl[face * 4 + 3] as number));
      } else if (sep < 0) {
        // it was inside already (a body moved onto it): out through the nearest face
        face = best;
        depth = -sep;
      }
      if (face < 0 || !(depth > 0)) continue;
      const px = (pl[face * 4] as number) * depth;
      const py = (pl[face * 4 + 1] as number) * depth;
      const pz = (pl[face * 4 + 2] as number) * depth;
      x[i] = xi + px;
      y[i] = yi + py;
      z[i] = zi + pz;
      if (dynamic) this.giveBack(w, b, i, px, py, pz);
    }
  }

  /** Terrain: a drop under the triangle of its cell (plus its radius) goes up along the triangle's normal. */
  private collideTerrain(f: { x0: number; y0: number; dx: number; dy: number; nx: number; ny: number; h: Float64Array }): void {
    const ps = this.ps;
    const { x, y, z } = ps;
    const r = this.r;
    const n = ps.n;
    const stride = f.ny + 1;
    for (let i = 0; i < n; i++) {
      const fx = ((x[i] as number) - f.x0) / f.dx;
      const fy = ((y[i] as number) - f.y0) / f.dy;
      if (!(fx >= 0 && fy >= 0 && fx < f.nx && fy < f.ny)) continue;
      const ci = Math.floor(fx);
      const cj = Math.floor(fy);
      const u = fx - ci;
      const v = fy - cj;
      const h00 = f.h[ci * stride + cj] as number;
      const h10 = f.h[(ci + 1) * stride + cj] as number;
      const h11 = f.h[(ci + 1) * stride + cj + 1] as number;
      const h01 = f.h[ci * stride + cj + 1] as number;
      // the two triangles of a cell: (i, j) (i+1, j) (i+1, j+1) and (i, j) (i+1, j+1) (i, j+1)
      let sx: number;
      let sy: number;
      let zt: number;
      if (u >= v) {
        sx = (h10 - h00) / f.dx;
        sy = (h11 - h10) / f.dy;
        zt = h00 + u * (h10 - h00) + v * (h11 - h10);
      } else {
        sx = (h11 - h01) / f.dx;
        sy = (h01 - h00) / f.dy;
        zt = h00 + u * (h11 - h01) + v * (h01 - h00);
      }
      if (!Number.isFinite(zt)) continue;
      // the slab under the triangle is half a unit deep, as for bodies
      const dz = (z[i] as number) - zt;
      if (dz < -0.5) continue;
      const l = Math.sqrt(sx * sx + sy * sy + 1);
      const s = dz / l;
      if (s >= r) continue;
      const m = r - s;
      x[i] = (x[i] as number) - (sx / l) * m;
      y[i] = (y[i] as number) - (sy / l) * m;
      z[i] = (z[i] as number) + m / l;
    }
  }

  /**
   * The body takes the impulse back: the drop's change of momentum, with the pair's reduced mass along the push so a body
   * lighter than a drop cannot gain energy from it. Applied at the start of the next step.
   */
  private giveBack(w: World3, b: number, i: number, px: number, py: number, pz: number): void {
    const l2 = px * px + py * py + pz * pz;
    if (!(l2 > 0)) return;
    const mp = this.mass[this.ps.owner[i] as number] as number;
    const l = Math.sqrt(l2);
    const nx = px / l;
    const ny = py / l;
    const nz = pz / l;
    // the touch point: on the body's surface under the drop
    const rx = (this.ps.x[i] as number) - nx * this.r - (w.p[b * 3] as number);
    const ry = (this.ps.y[i] as number) - ny * this.r - (w.p[b * 3 + 1] as number);
    const rz = (this.ps.z[i] as number) - nz * this.r - (w.p[b * 3 + 2] as number);
    // n · (I⁻¹ (r × n)) × r
    const cx = ry * nz - rz * ny;
    const cy = rz * nx - rx * nz;
    const cz = rx * ny - ry * nx;
    const I = w.invIw;
    const o = b * 9;
    const ix = (I[o] as number) * cx + (I[o + 1] as number) * cy + (I[o + 2] as number) * cz;
    const iy = (I[o + 3] as number) * cx + (I[o + 4] as number) * cy + (I[o + 5] as number) * cz;
    const iz = (I[o + 6] as number) * cx + (I[o + 7] as number) * cy + (I[o + 8] as number) * cz;
    const kb = (w.invM[b] as number) + cx * ix + cy * iy + cz * iz;
    const mEff = kb > 0 ? 1 / (1 / mp + kb) : mp;
    // the drop's push over the step is its change of speed: the body takes it back, equal and opposite
    const s = -mEff / this.hStep;
    const jx = s * px;
    const jy = s * py;
    const jz = s * pz;
    this.jx[b] = (this.jx[b] as number) + jx;
    this.jy[b] = (this.jy[b] as number) + jy;
    this.jz[b] = (this.jz[b] as number) + jz;
    this.tx[b] = (this.tx[b] as number) + ry * jz - rz * jy;
    this.ty[b] = (this.ty[b] as number) + rz * jx - rx * jz;
    this.tz[b] = (this.tz[b] as number) + rx * jy - ry * jx;
  }

  /** The step length, set by the driver. */
  hStep = 1 / 120;

  /* ------------------------------ readouts ------------------------------ */

  countOf(owner: number): number {
    let k = 0;
    const o = this.ps.owner;
    for (let i = 0; i < this.ps.n; i++) if (o[i] === owner) k++;
    return k;
  }

  private cols = new Float64Array(0);

  /**
   * The height of an owner's surface: the top drop of each column one spacing square, then the middle of those tops, so a
   * few splashing drops do not count. Undefined (NaN) with no drops.
   */
  levelOf(owner: number): number {
    const { x, y, z, n } = this.ps;
    const o = this.ps.owner;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      if (o[i] !== owner) continue;
      const xi = x[i] as number;
      const yi = y[i] as number;
      if (xi < x0) x0 = xi;
      if (xi > x1) x1 = xi;
      if (yi < y0) y0 = yi;
      if (yi > y1) y1 = yi;
    }
    if (!(x1 >= x0)) return Number.NaN;
    const d = Math.max(this.d, (x1 - x0) / 200, (y1 - y0) / 200);
    const ncx = Math.floor((x1 - x0) / d) + 1;
    const ncy = Math.floor((y1 - y0) / d) + 1;
    const nc = ncx * ncy;
    if (this.cols.length < nc) this.cols = new Float64Array(nc * 2);
    const cols = this.cols;
    cols.fill(-Infinity, 0, nc);
    for (let i = 0; i < n; i++) {
      if (o[i] !== owner) continue;
      const c = Math.floor(((y[i] as number) - y0) / d) * ncx + Math.floor(((x[i] as number) - x0) / d);
      if ((z[i] as number) > (cols[c] as number)) cols[c] = z[i] as number;
    }
    let m = 0;
    for (let c = 0; c < nc; c++) if ((cols[c] as number) > -Infinity) cols[m++] = cols[c] as number;
    return middleOf(cols, m) + this.r;
  }

  /* ------------------------------ checkpoints ------------------------------ */

  /** Everything the next step reads: places and speeds, owners, the taps, the impulses still owed. */
  save(): Float64Array {
    const ps = this.ps;
    const n = ps.n;
    const nb = this.jx.length;
    const runs: number[] = [];
    for (let i = 0; i < n; i++) {
      const o = ps.owner[i] as number;
      if (runs.length > 0 && runs[runs.length - 2] === o) runs[runs.length - 1] = (runs[runs.length - 1] as number) + 1;
      else runs.push(o, 1);
    }
    const out = new Float64Array(4 + this.emitted.length + 1 + 6 * nb + 1 + runs.length + 6 * n);
    let k = 0;
    out[k++] = n;
    out[k++] = this.steps;
    out[k++] = this.unstable ? 1 : 0;
    out[k++] = this.emitted.length;
    out.set(this.emitted, k);
    k += this.emitted.length;
    out[k++] = nb;
    for (const a of [this.jx, this.jy, this.jz, this.tx, this.ty, this.tz]) {
      out.set(a, k);
      k += nb;
    }
    out[k++] = runs.length / 2;
    for (const v of runs) out[k++] = v;
    for (const a of [ps.x, ps.y, ps.z, ps.vx, ps.vy, ps.vz]) {
      out.set(a.subarray(0, n), k);
      k += n;
    }
    return out;
  }

  load(s: Float64Array): void {
    let k = 0;
    const n = s[k++] as number;
    this.steps = s[k++] as number;
    this.unstable = s[k++] === 1;
    const ne = s[k++] as number;
    for (let i = 0; i < ne; i++) this.emitted[i] = s[k++] as number;
    const nb = s[k++] as number;
    this.sizeBodies(nb);
    for (const a of [this.jx, this.jy, this.jz, this.tx, this.ty, this.tz]) {
      a.set(s.subarray(k, k + nb));
      k += nb;
    }
    const ps = this.ps;
    ps.reserve(n);
    ps.n = n;
    const nr = s[k++] as number;
    let at = 0;
    for (let r = 0; r < nr; r++) {
      const o = s[k++] as number;
      const len = s[k++] as number;
      ps.owner.fill(o, at, at + len);
      at += len;
    }
    for (const a of [ps.x, ps.y, ps.z, ps.vx, ps.vy, ps.vz]) {
      a.set(s.subarray(k, k + n));
      k += n;
    }
    ps.x0.set(ps.x.subarray(0, n));
    ps.y0.set(ps.y.subarray(0, n));
    ps.z0.set(ps.z.subarray(0, n));
    this.left.length = 0;
    this.stale = true;
  }
}
