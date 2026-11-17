/**
 * Moving points that are not rigid bodies (docs/features/physics/design.md 9.1, 9.6): the shared store of particles and
 * the neighbour grid that liquid drops use now and cloth points will join (round 9).
 *
 * The grid is rebuilt every step by a counting sort into a hashed table of cells as wide as the particles' reach. It
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

/** The most neighbours one particle keeps; more (a crushed cluster) are skipped, the same way every time. */
export const MAX_NEIGHBOURS = 48;
/** The half of the cells around a cell that a pair search looks in (the other half finds the same pairs). */
const HALF_DX = Int32Array.from([1, -1, 0, 1]);
const HALF_DY = Int32Array.from([0, 1, 1, 1]);

/**
 * A uniform grid of square cells, hashed into a table twice the particle count, filled by counting sort. Two cells that
 * share a table slot are told apart by their cell coordinates, so no particle is seen twice.
 */
export class NeighbourGrid {
  /** Cell width: the reach of a particle. */
  size = 1;
  private inv = 1;
  private mask = 0;
  /** Start of each table slot in `sorted` (slot k is `start[k] .. start[k + 1]`). */
  private start = new Int32Array(1);
  private count = new Int32Array(0);
  /** Particle indices ordered by slot, and in index order within a slot. */
  sorted = new Int32Array(0);
  /** Each particle's cell and slot. */
  cx = new Int32Array(0);
  cy = new Int32Array(0);
  private slot = new Int32Array(0);
  /** How many neighbours each particle has (capped at `MAX_NEIGHBOURS`). */
  nbrN = new Int32Array(0);

  setSize(size: number): void {
    this.size = size;
    this.inv = 1 / size;
  }

  private reserve(n: number): void {
    if (n > this.sorted.length) {
      let c = Math.max(16, this.sorted.length);
      while (c < n) c *= 2;
      this.sorted = new Int32Array(c);
      this.cx = new Int32Array(c);
      this.cy = new Int32Array(c);
      this.slot = new Int32Array(c);
      this.nbrN = new Int32Array(c);
    }
    let t = 16;
    while (t < 2 * n) t *= 2;
    if (t + 1 > this.start.length) {
      this.start = new Int32Array(t + 1);
      this.count = new Int32Array(t);
    }
    this.mask = t - 1;
  }

  private hash(cx: number, cy: number): number {
    return (Math.imul(cx, 0x5bd1e995) ^ Math.imul(cy, 0x27d4eb2f)) & this.mask;
  }

  /** Sorts the particles into their cells. */
  build(x: Float64Array, y: Float64Array, n: number): void {
    this.reserve(n);
    const t = this.mask + 1;
    const count = this.count;
    count.fill(0, 0, t);
    for (let i = 0; i < n; i++) {
      const cx = Math.floor((x[i] as number) * this.inv);
      const cy = Math.floor((y[i] as number) * this.inv);
      this.cx[i] = cx;
      this.cy[i] = cy;
      const s = this.hash(cx, cy);
      this.slot[i] = s;
      count[s] = (count[s] as number) + 1;
    }
    const start = this.start;
    let acc = 0;
    for (let s = 0; s < t; s++) {
      start[s] = acc;
      acc += count[s] as number;
    }
    start[t] = acc;
    // a second pass places each particle; `count` becomes the fill pointer of each slot
    for (let s = 0; s < t; s++) count[s] = start[s] as number;
    for (let i = 0; i < n; i++) {
      const s = this.slot[i] as number;
      const k = count[s] as number;
      this.sorted[k] = i;
      count[s] = k + 1;
    }
  }

  /**
   * Lists the pairs of particles closer than `reach`, each pair once, in a fixed order: cell by cell in table order,
   * the pairs inside a cell, then with the cells to the right and above (the other half find the same pairs). Returns
   * how many.
   */
  findPairs(x: Float64Array, y: Float64Array, n: number, reach: number): number {
    const r2 = reach * reach;
    const start = this.start;
    const sorted = this.sorted;
    const cxs = this.cx;
    const cys = this.cy;
    const nbrN = this.nbrN;
    const mask = this.mask;
    if (this.pi.length < n * (MAX_NEIGHBOURS / 2)) {
      this.pi = new Int32Array(this.sorted.length * (MAX_NEIGHBOURS / 2));
      this.pj = new Int32Array(this.sorted.length * (MAX_NEIGHBOURS / 2));
      this.group = new Int32Array(this.sorted.length);
    }
    const pi = this.pi;
    const pj = this.pj;
    const group = this.group;
    let np = 0;
    nbrN.fill(0, 0, n);
    const t = mask + 1;
    for (let s = 0; s < t; s++) {
      const a = start[s] as number;
      const b = start[s + 1] as number;
      for (let k = a; k < b; k++) {
        const first = sorted[k] as number;
        const cx = cxs[first] as number;
        const cy = cys[first] as number;
        // a cell is taken at its first particle in the slot (two cells may share a slot)
        let seen = false;
        for (let q = a; q < k && !seen; q++) {
          const o = sorted[q] as number;
          if (cxs[o] === cx && cys[o] === cy) seen = true;
        }
        if (seen) continue;
        let g = 0;
        for (let q = k; q < b; q++) {
          const o = sorted[q] as number;
          if (cxs[o] === cx && cys[o] === cy) group[g++] = o;
        }
        // pairs inside the cell
        for (let u = 0; u < g; u++) {
          const i = group[u] as number;
          const xi = x[i] as number;
          const yi = y[i] as number;
          for (let v = u + 1; v < g; v++) {
            const j = group[v] as number;
            const ex = (x[j] as number) - xi;
            const ey = (y[j] as number) - yi;
            if (ex * ex + ey * ey >= r2) continue;
            const mi = nbrN[i] as number;
            const mj = nbrN[j] as number;
            if (mi >= MAX_NEIGHBOURS || mj >= MAX_NEIGHBOURS) continue;
            nbrN[i] = mi + 1;
            nbrN[j] = mj + 1;
            pi[np] = i;
            pj[np] = j;
            np++;
          }
        }
        // then with the cells (1, 0), (-1, 1), (0, 1), (1, 1): every other pair is found from one side only
        for (let c = 0; c < 4; c++) {
          const ncx = cx + (HALF_DX[c] as number);
          const ncy = cy + (HALF_DY[c] as number);
          const ns = (Math.imul(ncx, 0x5bd1e995) ^ Math.imul(ncy, 0x27d4eb2f)) & mask;
          const na = start[ns] as number;
          const nb = start[ns + 1] as number;
          if (na === nb) continue;
          for (let q = na; q < nb; q++) {
            const j = sorted[q] as number;
            if (cxs[j] !== ncx || cys[j] !== ncy) continue;
            const xj = x[j] as number;
            const yj = y[j] as number;
            for (let u = 0; u < g; u++) {
              const i = group[u] as number;
              const ex = xj - (x[i] as number);
              const ey = yj - (y[i] as number);
              if (ex * ex + ey * ey >= r2) continue;
              const mi = nbrN[i] as number;
              const mj = nbrN[j] as number;
              if (mi >= MAX_NEIGHBOURS || mj >= MAX_NEIGHBOURS) continue;
              nbrN[i] = mi + 1;
              nbrN[j] = mj + 1;
              pi[np] = i;
              pj[np] = j;
              np++;
            }
          }
        }
      }
    }
    this.pairs = np;
    return np;
  }

  private group = new Int32Array(0);

  /** The pairs closer than the reach (`findPairs`), each once. */
  pi = new Int32Array(0);
  pj = new Int32Array(0);
  pairs = 0;

  /** Scratch for `inBox`. */
  found = new Int32Array(0);

  /**
   * The particles whose cell overlaps the box, each once, into `found`; returns how many. When the box covers more cells
   * than there are particles, it walks the particles instead (in index order).
   */
  inBox(x0: number, y0: number, x1: number, y1: number, n: number): number {
    if (this.found.length < n) this.found = new Int32Array(this.sorted.length);
    const out = this.found;
    const cx0 = Math.floor(x0 * this.inv);
    const cy0 = Math.floor(y0 * this.inv);
    const cx1 = Math.floor(x1 * this.inv);
    const cy1 = Math.floor(y1 * this.inv);
    const cells = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
    let m = 0;
    if (!(cells <= n)) {
      for (let i = 0; i < n; i++) {
        const cx = this.cx[i] as number;
        const cy = this.cy[i] as number;
        if (cx >= cx0 && cx <= cx1 && cy >= cy0 && cy <= cy1) out[m++] = i;
      }
      return m;
    }
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const s = this.hash(cx, cy);
        const end = this.start[s + 1] as number;
        for (let k = this.start[s] as number; k < end; k++) {
          const j = this.sorted[k] as number;
          if (this.cx[j] === cx && this.cy[j] === cy) out[m++] = j;
        }
      }
    }
    return m;
  }
}
