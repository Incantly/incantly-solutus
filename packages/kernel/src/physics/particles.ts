/**
 * Moving points that are not rigid bodies (docs/features/physics/design.md 9.1, 9.6): the shared store of particles and
 * the neighbour grid that liquid drops use now and cloth points will join (round 9).
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
    return i;
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
        this.owner[k] = this.owner[i] as number;
      }
      k++;
    }
    this.n = k;
    return n - k;
  }
}

export { MAX_NEIGHBOURS, NeighbourGrid } from './grid2';
