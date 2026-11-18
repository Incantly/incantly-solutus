/**
 * The neighbour grid of moving points (docs/features/physics/design.md 9.1 step 2, 9.6): a uniform grid of square cells
 * as wide as a particle's reach, rebuilt every step by a counting sort, with no garbage.
 *
 * When the particles' cells span a small enough box, the table is that box with one cell of border, so the cells
 * around any particle are in it. Otherwise cells are hashed into a table twice the particle count, and two cells that
 * share a slot are told apart by their coordinates. A counting sort is stable, so each cell lists its particles in
 * index order, and the pairs come in a fixed order: the same sums on every computer.
 */

/** The most neighbours one particle keeps; more (a crushed cluster) are skipped, the same way every time. */
export const MAX_NEIGHBOURS = 48;
/** The half of the cells around a cell that a pair search looks in (the other half finds the same pairs). */
const HALF_DX = Int32Array.from([1, -1, 0, 1]);
const HALF_DY = Int32Array.from([0, 1, 1, 1]);

export class NeighbourGrid {
  /** Cell width: the reach of a particle. */
  size = 1;
  private inv = 1;
  private mask = 0;
  /** A table over the box of cells (`dense`), with its first cell and its width; or hashed. */
  private dense = false;
  private ox = 0;
  private oy = 0;
  private nx = 0;
  private slots = 0;
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
  /** The pairs closer than the reach (`findPairs`), each once. */
  pi = new Int32Array(0);
  pj = new Int32Array(0);
  pairs = 0;
  /** Scratch for `inBox`. */
  found = new Int32Array(0);
  /** The box `inBox` is asked for: x0, y0, x1, y1 (numbers passed in a call are heap numbers, garbage). */
  readonly box = new Float64Array(4);
  /** The reach `findPairs` lists pairs within (a field, not an argument). */
  reach = 0;
  private group = new Int32Array(0);

  setSize(size: number): void {
    this.size = size;
    this.inv = 1 / size;
  }

  private reserve(n: number): void {
    if (n <= this.sorted.length) return;
    let c = Math.max(16, this.sorted.length);
    while (c < n) c *= 2;
    this.sorted = new Int32Array(c);
    this.cx = new Int32Array(c);
    this.cy = new Int32Array(c);
    this.slot = new Int32Array(c);
    this.nbrN = new Int32Array(c);
  }

  private table(t: number): void {
    this.slots = t;
    if (t + 1 <= this.start.length) return;
    let c = Math.max(64, this.start.length);
    while (c < t + 1) c *= 2;
    this.start = new Int32Array(c);
    this.count = new Int32Array(c);
  }

  private hash(cx: number, cy: number): number {
    return (Math.imul(cx, 0x5bd1e995) ^ Math.imul(cy, 0x27d4eb2f)) & this.mask;
  }

  /** The slot of a cell, or -1 for a cell outside the table's box. */
  private slotOf(cx: number, cy: number): number {
    if (!this.dense) return this.hash(cx, cy);
    const a = cx - this.ox;
    const b = cy - this.oy;
    if (a < 0 || a >= this.nx || b < 0 || b * this.nx + a >= this.slots) return -1;
    return b * this.nx + a;
  }

  /** Sorts the particles into their cells. */
  build(x: Float64Array, y: Float64Array, n: number): void {
    this.reserve(n);
    let x0 = 0;
    let x1 = -1;
    let y0 = 0;
    let y1 = -1;
    for (let i = 0; i < n; i++) {
      const cx = Math.floor((x[i] as number) * this.inv);
      const cy = Math.floor((y[i] as number) * this.inv);
      this.cx[i] = cx;
      this.cy[i] = cy;
      if (i === 0 || cx < x0) x0 = cx;
      if (i === 0 || cx > x1) x1 = cx;
      if (i === 0 || cy < y0) y0 = cy;
      if (i === 0 || cy > y1) y1 = cy;
    }
    const nx = x1 - x0 + 3;
    const ny = y1 - y0 + 3;
    this.dense = n > 0 && nx * ny <= Math.max(4096, 16 * n);
    if (this.dense) {
      this.ox = x0 - 1;
      this.oy = y0 - 1;
      this.nx = nx;
      this.table(nx * ny);
    } else {
      let t = 16;
      while (t < 2 * n) t *= 2;
      this.mask = t - 1;
      this.table(t);
    }
    const t = this.slots;
    const count = this.count;
    count.fill(0, 0, t);
    for (let i = 0; i < n; i++) {
      const s = this.slotOf(this.cx[i] as number, this.cy[i] as number);
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
  findPairs(x: Float64Array, y: Float64Array, n: number): number {
    if (this.pi.length < n * (MAX_NEIGHBOURS / 2)) {
      this.pi = new Int32Array(this.sorted.length * (MAX_NEIGHBOURS / 2));
      this.pj = new Int32Array(this.sorted.length * (MAX_NEIGHBOURS / 2));
      this.group = new Int32Array(this.sorted.length);
    }
    this.nbrN.fill(0, 0, n);
    this.pairs = this.dense ? this.pairsDense(x, y) : this.pairsHashed(x, y);
    return this.pairs;
  }

  private addPair(i: number, j: number, np: number): number {
    const nbrN = this.nbrN;
    const mi = nbrN[i] as number;
    const mj = nbrN[j] as number;
    if (mi >= MAX_NEIGHBOURS || mj >= MAX_NEIGHBOURS) return np;
    nbrN[i] = mi + 1;
    nbrN[j] = mj + 1;
    this.pi[np] = i;
    this.pj[np] = j;
    return np + 1;
  }

  private pairsDense(x: Float64Array, y: Float64Array): number {
    const r2 = this.reach * this.reach;
    const start = this.start;
    const sorted = this.sorted;
    const nx = this.nx;
    const t = this.slots;
    let np = 0;
    for (let s = 0; s < t; s++) {
      const a = start[s] as number;
      const b = start[s + 1] as number;
      if (a === b) continue;
      for (let u = a; u < b; u++) {
        const i = sorted[u] as number;
        const xi = x[i] as number;
        const yi = y[i] as number;
        for (let v = u + 1; v < b; v++) {
          const j = sorted[v] as number;
          const ex = (x[j] as number) - xi;
          const ey = (y[j] as number) - yi;
          if (ex * ex + ey * ey < r2) np = this.addPair(i, j, np);
        }
      }
      // the cells (1, 0), (-1, 1), (0, 1), (1, 1); the border keeps them in the table
      for (let c = 0; c < 4; c++) {
        const ns = s + (c === 0 ? 1 : c === 1 ? nx - 1 : c === 2 ? nx : nx + 1);
        if (ns >= t) continue;
        const nb = start[ns + 1] as number;
        for (let q = start[ns] as number; q < nb; q++) {
          const j = sorted[q] as number;
          const xj = x[j] as number;
          const yj = y[j] as number;
          for (let u = a; u < b; u++) {
            const i = sorted[u] as number;
            const ex = xj - (x[i] as number);
            const ey = yj - (y[i] as number);
            if (ex * ex + ey * ey < r2) np = this.addPair(i, j, np);
          }
        }
      }
    }
    return np;
  }

  private pairsHashed(x: Float64Array, y: Float64Array): number {
    const r2 = this.reach * this.reach;
    const start = this.start;
    const sorted = this.sorted;
    const cxs = this.cx;
    const cys = this.cy;
    const group = this.group;
    const t = this.slots;
    let np = 0;
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
        for (let u = 0; u < g; u++) {
          const i = group[u] as number;
          const xi = x[i] as number;
          const yi = y[i] as number;
          for (let v = u + 1; v < g; v++) {
            const j = group[v] as number;
            const ex = (x[j] as number) - xi;
            const ey = (y[j] as number) - yi;
            if (ex * ex + ey * ey < r2) np = this.addPair(i, j, np);
          }
        }
        for (let c = 0; c < 4; c++) {
          const ncx = cx + (HALF_DX[c] as number);
          const ncy = cy + (HALF_DY[c] as number);
          const ns = this.hash(ncx, ncy);
          const nb = start[ns + 1] as number;
          for (let q = start[ns] as number; q < nb; q++) {
            const j = sorted[q] as number;
            if (cxs[j] !== ncx || cys[j] !== ncy) continue;
            const xj = x[j] as number;
            const yj = y[j] as number;
            for (let u = 0; u < g; u++) {
              const i = group[u] as number;
              const ex = xj - (x[i] as number);
              const ey = yj - (y[i] as number);
              if (ex * ex + ey * ey < r2) np = this.addPair(i, j, np);
            }
          }
        }
      }
    }
    return np;
  }

  /**
   * The particles whose cell overlaps the box, each once, into `found`; returns how many. When the box covers more cells
   * than there are particles, it walks the particles instead (in index order).
   */
  inBox(n: number): number {
    if (this.found.length < n) this.found = new Int32Array(this.sorted.length);
    const out = this.found;
    const box = this.box;
    let cx0 = Math.floor((box[0] as number) * this.inv);
    let cy0 = Math.floor((box[1] as number) * this.inv);
    let cx1 = Math.floor((box[2] as number) * this.inv);
    let cy1 = Math.floor((box[3] as number) * this.inv);
    if (this.dense) {
      // only the cells of the table hold particles
      cx0 = Math.max(cx0, this.ox);
      cy0 = Math.max(cy0, this.oy);
      cx1 = Math.min(cx1, this.ox + this.nx - 1);
      cy1 = Math.min(cy1, this.oy + Math.floor(this.slots / this.nx) - 1);
      if (cx1 < cx0 || cy1 < cy0) return 0;
    }
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
        const s = this.slotOf(cx, cy);
        if (s < 0) continue;
        const end = this.start[s + 1] as number;
        for (let k = this.start[s] as number; k < end; k++) {
          const j = this.sorted[k] as number;
          if (this.dense || (this.cx[j] === cx && this.cy[j] === cy)) out[m++] = j;
        }
      }
    }
    return m;
  }
}
