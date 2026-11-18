/**
 * Moving points that are not rigid bodies (docs/features/physics/design.md 9.1, 9.6): the shared store of particles and
 * the neighbour grids that liquid drops use, in the plane and in space, and cloth points will join (round 9).
 *
 * The neighbour grid (`./grid2`) is rebuilt every step by a counting sort. It
 * makes no garbage: every buffer grows by doubling and is kept. A counting sort is stable, so the particles of a cell
 * come in index order, and every neighbour list is in a fixed order: the same sums on every computer.
 */

/** Positions, start-of-step positions, speeds and the owner (which `Liquid` or `Pour`) of each particle. */
export class ParticleSet {
  n = 0;
  x = new Float64Array(0);
  y = new Float64Array(0);
  /** Where each particle was at the start of the step (its speed is the change over the step). */
  x0 = new Float64Array(0);
  y0 = new Float64Array(0);
  vx = new Float64Array(0);
  vy = new Float64Array(0);
  /** The third number of drops in space (round 7); zero for drops in the plane. */
  z = new Float64Array(0);
  z0 = new Float64Array(0);
  vz = new Float64Array(0);
  owner = new Int32Array(0);

  constructor(cap = 0) {
    this.reserve(cap);
  }

  /** Room for at least `cap` particles, keeping the ones there. */
  reserve(cap: number): void {
    if (cap <= this.x.length) return;
    let c = Math.max(16, this.x.length);
    while (c < cap) c *= 2;
    const grow = (a: Float64Array): Float64Array<ArrayBuffer> => {
      const b = new Float64Array(c);
      b.set(a.subarray(0, this.n));
      return b;
    };
    this.x = grow(this.x);
    this.y = grow(this.y);
    this.x0 = grow(this.x0);
    this.y0 = grow(this.y0);
    this.vx = grow(this.vx);
    this.vy = grow(this.vy);
    this.z = grow(this.z);
    this.z0 = grow(this.z0);
    this.vz = grow(this.vz);
    const o = new Int32Array(c);
    o.set(this.owner.subarray(0, this.n));
    this.owner = o;
  }

  add(x: number, y: number, vx: number, vy: number, owner: number): number {
    if (this.n >= this.x.length) this.reserve(this.n + 1);
    const i = this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.x0[i] = x;
    this.y0[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.owner[i] = owner;
    this.z[i] = 0;
    this.z0[i] = 0;
    this.vz[i] = 0;
    return i;
  }

  /** A drop in space. */
  add3(x: number, y: number, z: number, vx: number, vy: number, vz: number, owner: number): number {
    const i = this.add(x, y, vx, vy, owner);
    this.z[i] = z;
    this.z0[i] = z;
    this.vz[i] = vz;
    return i;
  }

  /** How far from the origin a particle may be (each coordinate) for `compactInside`; set by the caller (a field, not an argument). */
  limit = 0;

  /**
   * Keeps the particles whose first `dims` (2 or 3) coordinates are all within `limit` of the origin, in order, and moves
   * the others out. No closure, no call: |v| <= limit is two comparisons, so a NaN or infinite coordinate goes. Returns how
   * many went.
   */
  compactInside(dims: number): number {
    let k = 0;
    const n = this.n;
    const lim = this.limit;
    const x = this.x;
    const y = this.y;
    const z = this.z;
    for (let i = 0; i < n; i++) {
      const xi = x[i] as number;
      const yi = y[i] as number;
      if (!(xi <= lim && xi >= -lim && yi <= lim && yi >= -lim)) continue;
      if (dims === 3) {
        const zi = z[i] as number;
        if (!(zi <= lim && zi >= -lim)) continue;
      }
      if (k !== i) this.move(k, i);
      k++;
    }
    this.n = k;
    return n - k;
  }

  /** Particle `i` over particle `k`. */
  private move(k: number, i: number): void {
    this.x[k] = this.x[i] as number;
    this.y[k] = this.y[i] as number;
    this.x0[k] = this.x0[i] as number;
    this.y0[k] = this.y0[i] as number;
    this.vx[k] = this.vx[i] as number;
    this.vy[k] = this.vy[i] as number;
    this.z[k] = this.z[i] as number;
    this.z0[k] = this.z0[i] as number;
    this.vz[k] = this.vz[i] as number;
    this.owner[k] = this.owner[i] as number;
  }

  /** Keeps the particles `keep` says yes to, in order. Returns how many went. */
  compact(keep: (i: number) => boolean): number {
    let k = 0;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      if (!keep(i)) continue;
      if (k !== i) {
        this.x[k] = this.x[i] as number;
        this.y[k] = this.y[i] as number;
        this.x0[k] = this.x0[i] as number;
        this.y0[k] = this.y0[i] as number;
        this.vx[k] = this.vx[i] as number;
        this.vy[k] = this.vy[i] as number;
        this.z[k] = this.z[i] as number;
        this.z0[k] = this.z0[i] as number;
        this.vz[k] = this.vz[i] as number;
        this.owner[k] = this.owner[i] as number;
      }
      k++;
    }
    this.n = k;
    return n - k;
  }
}

export { MAX_NEIGHBOURS, NeighbourGrid } from './grid2';
export { MAX_NEIGHBOURS3, NeighbourGrid3 } from './grid3';


/**
 * The middle of the first m numbers of a (the mean of the two middle ones when m is even), found by selection in place:
 * the same number a sort gives, in linear time. The first m numbers are reordered. NaN when m is 0.
 */
export function middleOf(a: Float64Array, m: number): number {
  if (m <= 0) return Number.NaN;
  const h = m >> 1;
  const hi = nth(a, m, h);
  if (m % 2 === 1) return hi;
  // after the selection every number before h is at most a[h]: the other middle one is the largest of them
  let lo = -Infinity;
  for (let i = 0; i < h; i++) if ((a[i] as number) > lo) lo = a[i] as number;
  return 0.5 * (lo + hi);
}

/** Puts the k-th smallest of a[0..m) at a[k], the smaller ones before it and the larger ones after (Hoare's selection). */
function nth(a: Float64Array, m: number, k: number): number {
  let l = 0;
  let r = m - 1;
  while (r > l) {
    // the middle of three as the pivot, so sorted or flat columns stay linear
    const c = (l + r) >> 1;
    const x = a[l] as number;
    const y = a[c] as number;
    const z = a[r] as number;
    const p = x < y ? (y < z ? y : x < z ? z : x) : x < z ? x : y < z ? z : y;
    let i = l;
    let j = r;
    while (i <= j) {
      while ((a[i] as number) < p) i++;
      while ((a[j] as number) > p) j--;
      if (i <= j) {
        const t = a[i] as number;
        a[i] = a[j] as number;
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) r = j;
    else if (k >= i) l = i;
    else break;
  }
  return a[k] as number;
}
