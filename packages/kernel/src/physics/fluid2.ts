/**
 * Liquid in the plane (docs/features/physics/design.md 9.1, 9.6): position-based fluids.
 *
 * One step, after the bodies have taken theirs:
 *
 * 1. Taps (`Pour`) add their drops for this step, placed with seeded numbers.
 * 2. Each drop's place is predicted from its speed and gravity.
 * 3. The neighbour grid is rebuilt (counting sort, no garbage) and each drop's neighbours are listed.
 * 4. Two density passes move the drops so the local density matches the rest density. Only crowding pushes: a drop at
 *    the free surface is never pulled in, so drops do not clump.
 * 5. After each pass, drops are pushed out of bodies, then out of walls and movers (walls win). A drop that crossed a thin
 *    wall in one step is put back on the side it came from. The push a drop gets from a body is an impulse the body
 *    takes back, equal and opposite, at the start of the next step (design 9.6), so a box floats and a ball splashes.
 * 6. Each drop's speed is how far it moved over the step, smoothed a little toward its neighbours' (viscosity).
 * 7. Drops that left the world range are taken out.
 *
 * Deterministic: every loop runs in index order, neighbour lists come from a stable sort, and the density passes are
 * Jacobi (all corrections are worked out, then applied), so no result depends on the order drops are visited in.
 */
import { mix32 } from '../commands/probability/random';
import type { Pt } from './geom2';
import { MAX_NEIGHBOURS, NeighbourGrid, ParticleSet } from './particles';
import type { World2 } from './world2';
import { BodyType, FK } from './world2';
import { addForce } from './water2';

/** Every drop in a figure, all `Liquid` and `Pour` together (design 11.3). */
export const MAX_DROPS = 2000;
/** The most one density pass moves a drop, in spacings. */
export const MAX_CORRECTION = 0.5;
/** A drop's reach in spacings: about ten neighbours at rest. */
export const REACH = 1.8;
/** Drop size when a figure has only taps. */
export const DEFAULT_SPACING = 0.1;

export interface DropSource2 {
  /** Which liquid object the drops belong to. */
  readonly owner: number;
  /** 0 to 1: how much a drop's speed is pulled toward its neighbours' each step. */
  readonly viscosity: number;
  /** kg per m²: a drop weighs `density × spacing²`. */
  readonly density: number;
  /** Drops at the start (a `Liquid`), in order. */
  readonly start?: { readonly xs: readonly number[]; readonly ys: readonly number[] };
  /** A tap (`Pour`): where, how many a second, the speed drops leave it with, and how many in all. */
  readonly pour?: { readonly x: number; readonly y: number; readonly vx: number; readonly vy: number; readonly rate: number; readonly max: number };
}

/** The spacing that fills `pts` (a polygon) with `count` drops on a square grid. */
export function spacingFor(pts: readonly Pt[], count: number): number {
  const a = Math.abs(polyArea(pts));
  if (!(a > 0) || !(count > 0)) return DEFAULT_SPACING;
  let d = Math.sqrt(a / count);
  // a grid inside the shape holds a little less than area / d²: shrink until it holds them all
  for (let k = 0; k < 40 && fillRegion(pts, count, d).xs.length < count; k++) d *= 0.985;
  return Math.min(0.5, Math.max(0.02, d));
}

/**
 * `count` drop places in the polygon on a square grid of spacing `d`, from the bottom row up and left to right in each
 * row. When the shape holds fewer, the rest stand in rows above it, over its width, and fall in.
 */
export function fillRegion(pts: readonly Pt[], count: number, d: number): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  if (pts.length < 3 || !(d > 0) || !(count > 0)) return { xs, ys };
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  const nx = Math.max(1, Math.floor((x1 - x0) / d + 1e-9));
  const ox = x0 + 0.5 * (x1 - x0 - (nx - 1) * d);
  for (let row = 0; xs.length < count && row < 100000; row++) {
    const y = y0 + d * (0.5 + row);
    const above = y > y1;
    let any = false;
    for (let c = 0; c < nx && xs.length < count; c++) {
      const x = ox + c * d;
      if (above || inside(pts, x, y)) {
        xs.push(x);
        ys.push(y);
        any = true;
      }
    }
    if (!any && above) break;
  }
  return { xs, ys };
}

/** The surface of drops at rest on a grid of spacing `d`: the middle of the column tops, plus a drop's radius. */
export function restLevel(xs: readonly number[], ys: readonly number[], d: number): number {
  const tops = new Map<number, number>();
  for (let i = 0; i < xs.length; i++) {
    const c = Math.round((xs[i] as number) / d);
    const y = ys[i] as number;
    if (!(y <= (tops.get(c) ?? -Infinity))) tops.set(c, y);
  }
  const t = [...tops.values()].sort((a, b) => a - b);
  if (t.length === 0) return Number.NaN;
  const m = t.length;
  const mid = m % 2 === 1 ? (t[(m - 1) / 2] as number) : 0.5 * ((t[m / 2 - 1] as number) + (t[m / 2] as number));
  return mid + 0.5 * d;
}

function polyArea(pts: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as Pt;
    const q = pts[(i + 1) % pts.length] as Pt;
    a += p.x * q.y - q.x * p.y;
  }
  return 0.5 * a;
}

function inside(pts: readonly Pt[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i] as Pt;
    const b = pts[j] as Pt;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

export class Fluid2 {
  readonly ps: ParticleSet;
  readonly grid = new NeighbourGrid();
  /** Drop spacing at rest, kernel reach, and a drop's radius against solids. */
  readonly d: number;
  readonly H: number;
  readonly r: number;
  readonly sources: readonly DropSource2[];
  /** Drops each tap has let out (counting any that later left the world), and steps since the film start. */
  emitted: Float64Array;
  steps = 0;
  /** Impulses the drops gave each body in the last step, applied at the start of the next (design 9.6). */
  jx = new Float64Array(0);
  jy = new Float64Array(0);
  jt = new Float64Array(0);
  /** The impulses applied at the start of this step, kept to count them as forces after the body step. */
  private ax = new Float64Array(0);
  private ay = new Float64Array(0);
  /** Drops that left the world in the last step, by owner; drops that blew up. */
  left: number[] = [];
  unstable = false;
  private rho0 = 1;
  private eps = 1;
  private k6 = 1;
  private ks = 1;
  private lam = new Float64Array(0);
  private dx = new Float64Array(0);
  private dy = new Float64Array(0);
  private gx = new Float64Array(0);
  private gy = new Float64Array(0);
  private rho = new Float64Array(0);
  private sx = new Float64Array(0);
  private sy = new Float64Array(0);
  private s2 = new Float64Array(0);
  private vw = new Float64Array(0);
  private visc: Float64Array;
  private mass: Float64Array;

  constructor(spacing: number, sources: readonly DropSource2[], owners: number) {
    this.d = spacing;
    this.H = REACH * spacing;
    this.r = 0.5 * spacing;
    this.sources = sources;
    this.grid.setSize(this.H);
    this.emitted = new Float64Array(sources.length);
    this.visc = new Float64Array(Math.max(1, owners));
    this.mass = new Float64Array(Math.max(1, owners));
    for (const s of sources) {
      this.visc[s.owner] = Math.min(1, Math.max(0, s.viscosity));
      this.mass[s.owner] = Math.max(1e-6, s.density) * spacing * spacing;
    }
    const H = this.H;
    // poly6 for the density, spiky for its gradient (2D forms); the rest density is that of the square grid at rest
    const H4 = H * H * H * H;
    this.k6 = 4 / (Math.PI * H4 * H4);
    this.ks = -30 / (Math.PI * H4 * H);
    let rho = 0;
    let g2 = 0;
    const reach = Math.ceil(H / spacing);
    for (let a = -reach; a <= reach; a++) {
      for (let b = -reach; b <= reach; b++) {
        const r2 = (a * a + b * b) * spacing * spacing;
        if (r2 >= H * H) continue;
        const q = H * H - r2;
        rho += this.k6 * q * q * q;
        if (r2 > 0) {
          const r = Math.sqrt(r2);
          const g = this.ks * (H - r) * (H - r);
          g2 += g * g;
        }
      }
    }
    this.rho0 = rho;
    // relaxation: a fraction of how hard a full neighbourhood resists, so a crowd spreads out over a few steps
    this.eps = 0.1 * (g2 / (rho * rho));
    let total = 0;
    for (const s of sources) if (s.start) total += s.start.xs.length;
    this.ps = new ParticleSet(Math.min(MAX_DROPS, total + 64));
    for (const s of sources) {
      if (!s.start) continue;
      const { xs, ys } = s.start;
      for (let k = 0; k < xs.length && this.ps.n < MAX_DROPS; k++) this.ps.add(xs[k] as number, ys[k] as number, 0, 0, s.owner);
    }
  }

  /** Drop mass of an owner, kg. */
  massOf(owner: number): number {
    return this.mass[owner] as number;
  }

  private sizeBodies(n: number): void {
    if (this.jx.length === n) return;
    this.jx = new Float64Array(n);
    this.jy = new Float64Array(n);
    this.jt = new Float64Array(n);
    this.ax = new Float64Array(n);
    this.ay = new Float64Array(n);
  }

  private sizeDrops(n: number): void {
    if (this.lam.length >= n) return;
    let c = Math.max(64, this.lam.length);
    while (c < n) c *= 2;
    this.lam = new Float64Array(c);
    this.dx = new Float64Array(c);
    this.dy = new Float64Array(c);
    this.rho = new Float64Array(c);
    this.sx = new Float64Array(c);
    this.sy = new Float64Array(c);
    this.s2 = new Float64Array(c);
    this.gx = new Float64Array((c * MAX_NEIGHBOURS) / 2);
    this.gy = new Float64Array((c * MAX_NEIGHBOURS) / 2);
    this.vw = new Float64Array((c * MAX_NEIGHBOURS) / 2);
  }

  /** Before the body step: the drops' push of the last step goes into the bodies (design 9.6). */
  applyImpulses(w: World2): void {
    this.sizeBodies(w.n);
    for (let i = 0; i < w.n; i++) {
      const jx = this.jx[i] as number;
      const jy = this.jy[i] as number;
      const jt = this.jt[i] as number;
      this.ax[i] = jx;
      this.ay[i] = jy;
      if (jx === 0 && jy === 0 && jt === 0) continue;
      if (w.type[i] === BodyType.Dynamic) {
        w.jx[i] = (w.jx[i] as number) + jx;
        w.jy[i] = (w.jy[i] as number) + jy;
        w.jt[i] = (w.jt[i] as number) + jt;
      }
      this.jx[i] = 0;
      this.jy[i] = 0;
      this.jt[i] = 0;
    }
  }

  /** After the body step: the push of the liquid counts as buoyancy (and in the net force) of each body. */
  account(w: World2, h: number): void {
    for (let i = 0; i < w.n && i < this.ax.length; i++) {
      const fx = (this.ax[i] as number) / h;
      const fy = (this.ay[i] as number) / h;
      if (fx === 0 && fy === 0) continue;
      addForce(w, i, FK.buoyancy, fx, fy);
      addForce(w, i, FK.net, fx, fy);
    }
  }

  /** Lets out this step's drops of each tap. */
  private pour(h: number): void {
    for (let k = 0; k < this.sources.length; k++) {
      const s = this.sources[k] as DropSource2;
      const p = s.pour;
      if (!p) continue;
      const target = Math.min(p.max, Math.floor((this.steps + 1) * h * p.rate + 1e-9));
      let e = this.emitted[k] as number;
      if (e >= target) continue;
      const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      const ux = sp > 0 ? p.vx / sp : 0;
      const uy = sp > 0 ? p.vy / sp : -1;
      // three lanes of drops one spacing apart carry at most 3 v / d drops a second: a faster rate leaves faster, so
      // new drops never land on the last ones (which would throw them out of the stream)
      const ve = Math.max(sp, (p.rate * this.d) / 3);
      const first = e;
      const seed = mix32(0x9e3779b9 ^ (s.owner + 1));
      while (e < target && this.ps.n < MAX_DROPS) {
        const j = e - first;
        const lane = e % 3;
        const row = Math.floor(j / 3);
        // three drops abreast across the tap, a little jitter from the seeded generator, rows back up the stream
        const u = mix32((seed ^ Math.imul(e + 1, 0x85ebca6b)) >>> 0) / 4294967296 - 0.5;
        const across = (lane - 1) * 0.9 * this.d + u * 0.2 * this.d;
        const along = -row * this.d;
        this.ps.add(p.x - uy * across + ux * along, p.y + ux * across + uy * along, ux * ve, uy * ve, s.owner);
        e++;
      }
      this.emitted[k] = e;
    }
  }

  step(w: World2, h: number, range: number): void {
    this.left.length = 0;
    this.sizeBodies(w.n);
    this.pour(h);
    this.steps++;
    const ps = this.ps;
    const n = ps.n;
    if (n === 0) return;
    this.sizeDrops(n);
    const x = ps.x;
    const y = ps.y;
    const vx = ps.vx;
    const vy = ps.vy;
    const x0 = ps.x0;
    const y0 = ps.y0;
    const gxw = w.gx;
    const gyw = w.gy;
    const maxMove = 1.5 * this.d;
    const max2 = maxMove * maxMove;
    for (let i = 0; i < n; i++) {
      const xi = x[i] as number;
      const yi = y[i] as number;
      x0[i] = xi;
      y0[i] = yi;
      const ux = (vx[i] as number) + h * gxw;
      const uy = (vy[i] as number) + h * gyw;
      let mx = ux * h;
      let my = uy * h;
      const m2 = mx * mx + my * my;
      if (m2 > max2) {
        const s = maxMove / Math.sqrt(m2);
        mx *= s;
        my *= s;
      }
      x[i] = xi + mx;
      y[i] = yi + my;
    }
    const grid = this.grid;
    grid.build(x, y, n);
    grid.findPairs(x, y, n, this.H);
    for (let pass = 0; pass < 2; pass++) {
      this.densityPass(n);
      this.collide(w, h);
    }
    // speeds from the move, then a little viscosity (Jacobi, so the order does not matter)
    const inv = 1 / h;
    for (let i = 0; i < n; i++) {
      vx[i] = ((x[i] as number) - (x0[i] as number)) * inv;
      vy[i] = ((y[i] as number) - (y0[i] as number)) * inv;
    }
    this.viscosity(n);
    // drops that left the world, or blew up
    let bad = false;
    for (let i = 0; i < n; i++) {
      const xi = x[i] as number;
      const yi = y[i] as number;
      if (!(Math.abs(xi) <= range && Math.abs(yi) <= range)) {
        if (!Number.isFinite(xi) || !Number.isFinite(yi)) bad = true;
        else this.left.push(ps.owner[i] as number);
      }
    }
    if (bad) this.unstable = true;
    if (this.left.length > 0 || bad) ps.compact((i) => Math.abs(x[i] as number) <= range && Math.abs(y[i] as number) <= range);
  }

  /** One density pass over the pairs (each pair once): the crowding of each drop, then the moves that undo it. */
  private densityPass(n: number): void {
    const { x, y } = this.ps;
    const grid = this.grid;
    const pi = grid.pi;
    const pj = grid.pj;
    const np = grid.pairs;
    const H = this.H;
    const H2 = H * H;
    const k6 = this.k6;
    const ks = this.ks;
    const inv0 = 1 / this.rho0;
    const lam = this.lam;
    const gxs = this.gx;
    const gys = this.gy;
    const rho = this.rho;
    const sx = this.sx;
    const sy = this.sy;
    const s2 = this.s2;
    const vw = this.vw;
    const invSelf = 1 / (k6 * H2 * H2 * H2);
    rho.fill(k6 * H2 * H2 * H2, 0, n);
    sx.fill(0, 0, n);
    sy.fill(0, 0, n);
    s2.fill(0, 0, n);
    for (let p = 0; p < np; p++) {
      const i = pi[p] as number;
      const j = pj[p] as number;
      const ex = (x[i] as number) - (x[j] as number);
      const ey = (y[i] as number) - (y[j] as number);
      const r2 = ex * ex + ey * ey;
      if (r2 >= H2) {
        gxs[p] = 0;
        gys[p] = 0;
        vw[p] = 0;
        continue;
      }
      const q = H2 - r2;
      const w = k6 * q * q * q;
      // the viscosity weight (1 - r² / H²)³ of the last pass, kept for the speeds
      vw[p] = w * invSelf;
      rho[i] = (rho[i] as number) + w;
      rho[j] = (rho[j] as number) + w;
      let gx = 0;
      let gy = 0;
      if (r2 > 1e-24) {
        const r = Math.sqrt(r2);
        const hr = H - r;
        const g = (ks * hr * hr * inv0) / r;
        gx = g * ex;
        gy = g * ey;
      }
      gxs[p] = gx;
      gys[p] = gy;
      const g2 = gx * gx + gy * gy;
      sx[i] = (sx[i] as number) + gx;
      sy[i] = (sy[i] as number) + gy;
      sx[j] = (sx[j] as number) - gx;
      sy[j] = (sy[j] as number) - gy;
      s2[i] = (s2[i] as number) + g2;
      s2[j] = (s2[j] as number) + g2;
    }
    const eps = this.eps;
    for (let i = 0; i < n; i++) {
      const C = (rho[i] as number) * inv0 - 1;
      const a = sx[i] as number;
      const b = sy[i] as number;
      lam[i] = C > 0 ? -C / (a * a + b * b + (s2[i] as number) + eps) : 0;
    }
    // the moves: Jacobi, every pair once, equal and opposite
    const dx = this.dx;
    const dy = this.dy;
    dx.fill(0, 0, n);
    dy.fill(0, 0, n);
    for (let p = 0; p < np; p++) {
      const i = pi[p] as number;
      const j = pj[p] as number;
      const sum = (lam[i] as number) + (lam[j] as number);
      if (sum === 0) continue;
      const mx = sum * (gxs[p] as number);
      const my = sum * (gys[p] as number);
      dx[i] = (dx[i] as number) + mx;
      dy[i] = (dy[i] as number) + my;
      dx[j] = (dx[j] as number) - mx;
      dy[j] = (dy[j] as number) - my;
    }
    // a pass moves a drop at most a fraction of a spacing, so a fast drop landing on others is caught over a few steps
    // instead of being thrown back (the crowding is undone, but no splash gains speed from one deep overlap)
    const lim = MAX_CORRECTION * this.d;
    const lim2 = lim * lim;
    for (let i = 0; i < n; i++) {
      let mx = dx[i] as number;
      let my = dy[i] as number;
      const m2 = mx * mx + my * my;
      if (m2 > lim2) {
        const s = lim / Math.sqrt(m2);
        mx *= s;
        my *= s;
      }
      x[i] = (x[i] as number) + mx;
      y[i] = (y[i] as number) + my;
    }
  }

  /**
   * XSPH viscosity over the pairs: each drop's speed is pulled toward its neighbours' (Jacobi), with the weights of the
   * last density pass.
   */
  private viscosity(n: number): void {
    const { vx, vy, owner } = this.ps;
    const grid = this.grid;
    const pi = grid.pi;
    const pj = grid.pj;
    const np = grid.pairs;
    const vw = this.vw;
    const visc = this.visc;
    let any = false;
    for (let o = 0; o < visc.length; o++) if ((visc[o] as number) > 0) any = true;
    if (!any) return;
    const sx = this.sx;
    const sy = this.sy;
    const sw = this.s2;
    sx.fill(0, 0, n);
    sy.fill(0, 0, n);
    sw.fill(0, 0, n);
    for (let p = 0; p < np; p++) {
      const i = pi[p] as number;
      const j = pj[p] as number;
      const w = vw[p] as number;
      if (w === 0) continue;
      const ux = w * ((vx[j] as number) - (vx[i] as number));
      const uy = w * ((vy[j] as number) - (vy[i] as number));
      sx[i] = (sx[i] as number) + ux;
      sy[i] = (sy[i] as number) + uy;
      sx[j] = (sx[j] as number) - ux;
      sy[j] = (sy[j] as number) - uy;
      sw[i] = (sw[i] as number) + w;
      sw[j] = (sw[j] as number) + w;
    }
    for (let i = 0; i < n; i++) {
      const s = sw[i] as number;
      if (!(s > 0)) continue;
      const f = (visc[owner[i] as number] as number) / Math.max(1, s);
      vx[i] = (vx[i] as number) + f * (sx[i] as number);
      vy[i] = (vy[i] as number) + f * (sy[i] as number);
    }
  }

  /* ------------------------------ drops against bodies and solids ------------------------------ */

  /** Pushes drops out of bodies (first), then walls and movers. Bodies get the equal and opposite impulse. */
  private collide(w: World2, h: number): void {
    for (let pass = 0; pass < 2; pass++) {
      for (let b = 0; b < w.n; b++) {
        if (w.gone.has(b)) continue;
        const dynamic = w.type[b] === BodyType.Dynamic;
        if (dynamic !== (pass === 0)) continue;
        const s0 = w.shape0[b] as number;
        const sn = w.shapeN[b] as number;
        for (let k = s0; k < s0 + sn; k++) this.collideShape(w, b, k, dynamic, h);
      }
    }
  }

  private collideShape(w: World2, b: number, k: number, dynamic: boolean, h: number): void {
    const sh = w.shapes[k];
    if (!sh) return;
    const r = this.r;
    let bx0: number;
    let by0: number;
    let bx1: number;
    let by1: number;
    if (sh.kind === 0) {
      bx0 = sh.wcx - sh.radius;
      bx1 = sh.wcx + sh.radius;
      by0 = sh.wcy - sh.radius;
      by1 = sh.wcy + sh.radius;
    } else {
      bx0 = Infinity;
      by0 = Infinity;
      bx1 = -Infinity;
      by1 = -Infinity;
      for (let q = 0; q < sh.wx.length; q++) {
        const px = sh.wx[q] as number;
        const py = sh.wy[q] as number;
        if (px < bx0) bx0 = px;
        if (px > bx1) bx1 = px;
        if (py < by0) by0 = py;
        if (py > by1) by1 = py;
      }
    }
    // drops may have moved up to a cell since the grid was built, and a fast one up to 1.5 spacings this step
    const pad = r + this.H + 1.5 * this.d;
    const ps = this.ps;
    const m = this.grid.inBox(bx0 - pad, by0 - pad, bx1 + pad, by1 + pad, ps.n);
    const found = this.grid.found;
    const x = ps.x;
    const y = ps.y;
    for (let q = 0; q < m; q++) {
      const i = found[q] as number;
      const xi = x[i] as number;
      const yi = y[i] as number;
      if (xi < bx0 - r - 1.5 * this.d || xi > bx1 + r + 1.5 * this.d || yi < by0 - r - 1.5 * this.d || yi > by1 + r + 1.5 * this.d) continue;
      let px: number;
      let py: number;
      if (sh.kind === 0) {
        const ex = xi - sh.wcx;
        const ey = yi - sh.wcy;
        const d2 = ex * ex + ey * ey;
        const R = sh.radius + r;
        if (d2 >= R * R) continue;
        const dd = Math.sqrt(d2);
        if (dd > 1e-12) {
          px = (ex / dd) * (R - dd);
          py = (ey / dd) * (R - dd);
        } else {
          px = 0;
          py = R;
        }
      } else if (sh.wx.length === 2) {
        if (!this.pushOffWall(sh.wx, sh.wy, i)) continue;
        px = (x[i] as number) - xi;
        py = (y[i] as number) - yi;
        x[i] = xi;
        y[i] = yi;
      } else {
        // a convex polygon: the edge the drop is least inside, then the nearest point of that edge
        const nv = sh.wx.length;
        let sep = -Infinity;
        let best = 0;
        for (let e = 0; e < nv; e++) {
          const s = (sh.wnx[e] as number) * (xi - (sh.wx[e] as number)) + (sh.wny[e] as number) * (yi - (sh.wy[e] as number));
          if (s > sep) {
            sep = s;
            best = e;
          }
        }
        if (sep >= r) continue;
        const nx = sh.wnx[best] as number;
        const ny = sh.wny[best] as number;
        if (sep <= 0) {
          px = nx * (r - sep);
          py = ny * (r - sep);
        } else {
          const ax = sh.wx[best] as number;
          const ay = sh.wy[best] as number;
          const e2 = (best + 1) % nv;
          const ex = (sh.wx[e2] as number) - ax;
          const ey = (sh.wy[e2] as number) - ay;
          const l2 = ex * ex + ey * ey;
          let t = l2 > 0 ? ((xi - ax) * ex + (yi - ay) * ey) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const cx = xi - (ax + t * ex);
          const cy = yi - (ay + t * ey);
          const dd = Math.sqrt(cx * cx + cy * cy);
          if (dd >= r) continue;
          if (dd > 1e-12) {
            px = (cx / dd) * (r - dd);
            py = (cy / dd) * (r - dd);
          } else {
            px = nx * r;
            py = ny * r;
          }
        }
      }
      x[i] = xi + px;
      y[i] = yi + py;
      if (dynamic) this.giveBack(w, b, i, px, py, h);
    }
  }

  /**
   * A thin wall, solid from both sides. A drop closer than its radius is pushed out to the side it started the step on,
   * so a fast drop never slips through. Returns false when it does not touch.
   */
  private pushOffWall(wx: Float64Array, wy: Float64Array, i: number): boolean {
    const ps = this.ps;
    const xi = ps.x[i] as number;
    const yi = ps.y[i] as number;
    const ax = wx[0] as number;
    const ay = wy[0] as number;
    const ex = (wx[1] as number) - ax;
    const ey = (wy[1] as number) - ay;
    const l2 = ex * ex + ey * ey;
    if (!(l2 > 0)) return false;
    const l = Math.sqrt(l2);
    // the unit normal, and the side the drop started on
    const nx = -ey / l;
    const ny = ex / l;
    const s0 = nx * ((ps.x0[i] as number) - ax) + ny * ((ps.y0[i] as number) - ay);
    const s1 = nx * (xi - ax) + ny * (yi - ay);
    const side = s0 >= 0 ? 1 : -1;
    const r = this.r;
    let t = ((xi - ax) * ex + (yi - ay) * ey) / l2;
    const crossed = s0 * s1 < 0 || (s0 !== 0 && s1 === 0);
    if (crossed) {
      // where the path met the line: inside the wall's length, the drop went through
      const f = s0 / (s0 - s1);
      const mx = (ps.x0[i] as number) + f * (xi - (ps.x0[i] as number));
      const my = (ps.y0[i] as number) + f * (yi - (ps.y0[i] as number));
      const tm = ((mx - ax) * ex + (my - ay) * ey) / l2;
      if (tm >= 0 && tm <= 1) {
        ps.x[i] = xi + nx * (side * r - s1);
        ps.y[i] = yi + ny * (side * r - s1);
        return true;
      }
    }
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = xi - (ax + t * ex);
    const cy = yi - (ay + t * ey);
    const d2 = cx * cx + cy * cy;
    if (d2 >= r * r) return false;
    if (t > 0 && t < 1) {
      ps.x[i] = xi + nx * (side * r - s1);
      ps.y[i] = yi + ny * (side * r - s1);
      return true;
    }
    // past an end: round the corner
    const dd = Math.sqrt(d2);
    if (dd > 1e-12) {
      ps.x[i] = xi + (cx / dd) * (r - dd);
      ps.y[i] = yi + (cy / dd) * (r - dd);
    } else {
      ps.x[i] = xi + nx * side * r;
      ps.y[i] = yi + ny * side * r;
    }
    return true;
  }

  /**
   * The body takes the impulse back: the drop's change of momentum, with the pair's reduced mass along the push so a
   * body lighter than a drop cannot gain energy from it. Applied at the start of the next step.
   */
  private giveBack(w: World2, b: number, i: number, px: number, py: number, h: number): void {
    const l2 = px * px + py * py;
    if (!(l2 > 0)) return;
    const mp = this.mass[this.ps.owner[i] as number] as number;
    const l = Math.sqrt(l2);
    const nx = px / l;
    const ny = py / l;
    // the touch point: on the body's surface under the drop
    const cx = (this.ps.x[i] as number) - nx * this.r - (w.px[b] as number);
    const cy = (this.ps.y[i] as number) - ny * this.r - (w.py[b] as number);
    const rn = cx * ny - cy * nx;
    const kb = (w.invM[b] as number) + (w.invI[b] as number) * rn * rn;
    const mEff = kb > 0 ? 1 / (1 / mp + kb) : mp;
    const jx = (-mEff * px) / h;
    const jy = (-mEff * py) / h;
    this.jx[b] = (this.jx[b] as number) + jx;
    this.jy[b] = (this.jy[b] as number) + jy;
    this.jt[b] = (this.jt[b] as number) + cx * jy - cy * jx;
  }

  /* ------------------------------ readouts ------------------------------ */

  countOf(owner: number): number {
    let k = 0;
    const o = this.ps.owner;
    for (let i = 0; i < this.ps.n; i++) if (o[i] === owner) k++;
    return k;
  }

  private cols = new Float64Array(0);

  /**
   * The height of an owner's liquid surface: the top drop of each column one spacing wide, then the middle of those
   * tops, so a few splashing drops do not count. Undefined (NaN) with no drops.
   */
  levelOf(owner: number): number {
    const { x, y, n } = this.ps;
    const o = this.ps.owner;
    let x0 = Infinity;
    let x1 = -Infinity;
    for (let i = 0; i < n; i++) {
      if (o[i] !== owner) continue;
      const xi = x[i] as number;
      if (xi < x0) x0 = xi;
      if (xi > x1) x1 = xi;
    }
    if (!(x1 >= x0)) return Number.NaN;
    const d = Math.max(this.d, (x1 - x0) / 4000);
    const nc = Math.floor((x1 - x0) / d) + 1;
    if (this.cols.length < nc) this.cols = new Float64Array(nc * 2);
    const cols = this.cols;
    cols.fill(-Infinity, 0, nc);
    for (let i = 0; i < n; i++) {
      if (o[i] !== owner) continue;
      const c = Math.floor(((x[i] as number) - x0) / d);
      if ((y[i] as number) > (cols[c] as number)) cols[c] = y[i] as number;
    }
    let m = 0;
    for (let c = 0; c < nc; c++) if ((cols[c] as number) > -Infinity) cols[m++] = cols[c] as number;
    const tops = cols.subarray(0, m).sort();
    const mid = m % 2 === 1 ? (tops[(m - 1) / 2] as number) : 0.5 * ((tops[m / 2 - 1] as number) + (tops[m / 2] as number));
    return mid + this.r;
  }

  /* ------------------------------ checkpoints ------------------------------ */

  /** Everything the next step reads: the drops' places and speeds, their owners, the taps, the impulses still owed. */
  save(): Float64Array {
    const ps = this.ps;
    const n = ps.n;
    const nb = this.jx.length;
    // owners as runs (a liquid's drops sit together, a tap's come in order)
    const runs: number[] = [];
    for (let i = 0; i < n; i++) {
      const o = ps.owner[i] as number;
      if (runs.length > 0 && runs[runs.length - 2] === o) runs[runs.length - 1] = (runs[runs.length - 1] as number) + 1;
      else runs.push(o, 1);
    }
    const out = new Float64Array(4 + this.emitted.length + 1 + 3 * nb + 1 + runs.length + 4 * n);
    let k = 0;
    out[k++] = n;
    out[k++] = this.steps;
    out[k++] = this.unstable ? 1 : 0;
    out[k++] = this.emitted.length;
    out.set(this.emitted, k);
    k += this.emitted.length;
    out[k++] = nb;
    out.set(this.jx, k);
    k += nb;
    out.set(this.jy, k);
    k += nb;
    out.set(this.jt, k);
    k += nb;
    out[k++] = runs.length / 2;
    for (const v of runs) out[k++] = v;
    out.set(ps.x.subarray(0, n), k);
    k += n;
    out.set(ps.y.subarray(0, n), k);
    k += n;
    out.set(ps.vx.subarray(0, n), k);
    k += n;
    out.set(ps.vy.subarray(0, n), k);
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
    this.jx.set(s.subarray(k, k + nb));
    k += nb;
    this.jy.set(s.subarray(k, k + nb));
    k += nb;
    this.jt.set(s.subarray(k, k + nb));
    k += nb;
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
    ps.x.set(s.subarray(k, k + n));
    k += n;
    ps.y.set(s.subarray(k, k + n));
    k += n;
    ps.vx.set(s.subarray(k, k + n));
    k += n;
    ps.vy.set(s.subarray(k, k + n));
    ps.x0.set(ps.x.subarray(0, n));
    ps.y0.set(ps.y.subarray(0, n));
    this.left.length = 0;
  }
}
