/**
 * The neighbour grid of drops in space (docs/features/physics/design.md 9.1 step 2, 9.6): a uniform grid of cubic cells
 * as wide as a drop's reach, rebuilt every step by a counting sort, with no garbage.
 *
 * As in the plane (`./grid2`): when the drops' cells span a small enough box, the table is that box with one cell of
 * border, so the 26 cells around any drop are in it; otherwise cells are hashed into a table twice the drop count, and
 * two cells that share a slot are told apart by their coordinates. The sort is stable, so each cell lists its drops in
 * index order, and the pairs come in a fixed order: the same sums on every computer.
 *
 * With a `KernelArena` (`useArena`), the arrays live in WebAssembly memory, sized once for the most drops it may hold, and
 * `build`, `findPairs` and `inBox` run in Rust (design 11.6): the same loops, the same bits. A grid asked for more drops
 * than it has room for, or built without an arena, uses the TypeScript loops below.
 */
import type { KernelArena } from './wasm/kernels';

/** The most neighbours one drop keeps; more (a crushed cluster) are skipped, the same way every time. */
export const MAX_NEIGHBOURS3 = 64;
/** The half of the 26 cells around a cell that a pair search looks in (the other half find the same pairs). */
const HX = Int32Array.from([1, -1, 0, 1, -1, 0, 1, -1, 0, 1, -1, 0, 1]);
const HY = Int32Array.from([0, 1, 1, 1, -1, -1, -1, 0, 0, 0, 1, 1, 1]);
const HZ = Int32Array.from([0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1]);

export class NeighbourGrid3 {
  /** Cell width: the reach of a drop. */
  size = 1;
  private inv = 1;
  private mask = 0;
  private dense = false;
  private ox = 0;
  private oy = 0;
  private oz = 0;
  private nx = 0;
  private ny = 0;
  private nz = 0;
  private slots = 0;
  private start = new Int32Array(1);
  private count = new Int32Array(0);
  /** Drop indices ordered by slot, in index order within a slot, and their places in that order. */
  sorted = new Int32Array(0);
  private sx = new Float64Array(0);
  private sy = new Float64Array(0);
  private sz = new Float64Array(0);
  cx = new Int32Array(0);
  cy = new Int32Array(0);
  cz = new Int32Array(0);
  private slot = new Int32Array(0);
  nbrN = new Int32Array(0);
  /** The pairs closer than the reach, each once. */
  pi = new Int32Array(0);
  pj = new Int32Array(0);
  pairs = 0;
  /** Scratch for `inBox`. */
  found = new Int32Array(0);
  private off = new Int32Array(13);

  /** The arena the arrays live in, when the Rust loops run; undefined for the TypeScript loops. */
  private ar: KernelArena | undefined;
  /** The most drops the arena's arrays have room for. */
  private cap = 0;
  /** Where the arrays are in the arena (byte offsets), the table numbers the Rust side keeps, and room for foreign places. */
  private o = { cx: 0, cy: 0, cz: 0, slot: 0, start: 0, count: 0, sorted: 0, sx: 0, sy: 0, sz: 0, nbrN: 0, pi: 0, pj: 0, found: 0, mf: 0, mi: 0, px: -1, py: -1, pz: -1 };
  private cpx = new Float64Array(0);
  private cpy = new Float64Array(0);
  private cpz = new Float64Array(0);

  /** The bytes of arena a grid of `cap` drops takes (`own`: it also keeps a copy of the places it is given). */
  static arenaBytes(cap: number, own: boolean): number {
    const c = Math.max(16, cap);
    const b = (n: number, w: number): number => Math.ceil((n * w) / 64) * 64;
    const table = Math.max(32768, 16 * c, 4 * c, 64) + 2;
    return 7 * b(c, 4) + 3 * b(c, 8) + 2 * b(table, 4) + 2 * b(c * MAX_NEIGHBOURS3 * 0.5, 4) + b(16, 8) + b(8, 8) + (own ? 3 * b(NeighbourGrid3.roomFor(c), 8) : 0) + 1024;
  }

  /** The length of a particle store that holds `cap` drops: a power of two from 16 (`ParticleSet.reserve`). */
  private static roomFor(cap: number): number {
    let c = 16;
    while (c < cap) c *= 2;
    return c;
  }

  /** Puts the arrays in `arena` with room for `cap` drops, and runs the Rust loops (`own`: the places come from outside it). */
  useArena(arena: KernelArena, cap: number, own: boolean): void {
    const c = Math.max(16, cap);
    this.ar = arena;
    this.cap = c;
    const table = Math.max(32768, 16 * c, 4 * c, 64) + 2;
    this.sorted = arena.i32(c);
    this.sx = arena.f64(c);
    this.sy = arena.f64(c);
    this.sz = arena.f64(c);
    this.cx = arena.i32(c);
    this.cy = arena.i32(c);
    this.cz = arena.i32(c);
    this.slot = arena.i32(c);
    this.nbrN = arena.i32(c);
    this.found = arena.i32(c);
    this.start = arena.i32(table);
    this.count = arena.i32(table);
    this.pi = arena.i32(c * (MAX_NEIGHBOURS3 / 2));
    this.pj = arena.i32(c * (MAX_NEIGHBOURS3 / 2));
    const mf = arena.f64(16);
    const mi = arena.i32(8);
    if (own) {
      // room for a whole place array of the caller's (a particle store holds a power of two, at least `cap`)
      const room = NeighbourGrid3.roomFor(c);
      this.cpx = arena.f64(room);
      this.cpy = arena.f64(room);
      this.cpz = arena.f64(room);
    }
    const at = (a: ArrayBufferView): number => a.byteOffset;
    this.o = {
      cx: at(this.cx), cy: at(this.cy), cz: at(this.cz), slot: at(this.slot), start: at(this.start), count: at(this.count), sorted: at(this.sorted),
      sx: at(this.sx), sy: at(this.sy), sz: at(this.sz), nbrN: at(this.nbrN), pi: at(this.pi), pj: at(this.pj), found: at(this.found), mf: at(mf), mi: at(mi),
      px: own ? at(this.cpx) : -1, py: own ? at(this.cpy) : -1, pz: own ? at(this.cpz) : -1,
    };
    this.mf = mf;
    this.mi = mi;
    if (arena.overflow) this.ar = undefined;
  }

  /** True when the grid runs the Rust loops. */
  get usesKernels(): boolean {
    return this.ar !== undefined;
  }

  /** The Rust loops are not used from now on (the arena had no room for something). */
  dropArena(): void {
    this.ar = undefined;
  }

  private mf = new Float64Array(0);
  private mi = new Int32Array(0);

  /** Where places are for the Rust loops: where they already are in the arena, or a copy of them there; −1: nowhere. */
  private place(a: Float64Array, n: number, copy: Float64Array, off: number): number {
    const ar = this.ar as KernelArena;
    if (a.buffer === ar.buffer) return a.byteOffset;
    if (off < 0) return -1;
    if (a.length <= copy.length) copy.set(a);
    else for (let i = 0; i < n; i++) copy[i] = a[i] as number;
    return off;
  }

  setSize(size: number): void {
    this.size = size;
    this.inv = 1 / size;
  }

  private reserve(n: number): void {
    if (this.ar && n > this.cap) this.ar = undefined;
    if (n <= this.sorted.length) return;
    let c = Math.max(16, this.sorted.length);
    while (c < n) c *= 2;
    this.sorted = new Int32Array(c);
    this.sx = new Float64Array(c);
    this.sy = new Float64Array(c);
    this.sz = new Float64Array(c);
    this.cx = new Int32Array(c);
    this.cy = new Int32Array(c);
    this.cz = new Int32Array(c);
    this.slot = new Int32Array(c);
    this.nbrN = new Int32Array(c);
    this.found = new Int32Array(c);
  }

  private table(t: number): void {
    this.slots = t;
    if (t + 1 <= this.start.length) return;
    let c = Math.max(64, this.start.length);
    while (c < t + 1) c *= 2;
    this.start = new Int32Array(c);
    this.count = new Int32Array(c);
  }

  private hash(cx: number, cy: number, cz: number): number {
    return (Math.imul(cx, 0x5bd1e995) ^ Math.imul(cy, 0x27d4eb2f) ^ Math.imul(cz, 0x165667b1)) & this.mask;
  }

  private slotOf(cx: number, cy: number, cz: number): number {
    if (!this.dense) return this.hash(cx, cy, cz);
    const a = cx - this.ox;
    const b = cy - this.oy;
    const c = cz - this.oz;
    if (a < 0 || a >= this.nx || b < 0 || b >= this.ny || c < 0 || c >= this.nz) return -1;
    return (c * this.ny + b) * this.nx + a;
  }

  /** Sorts the drops into their cells. */
  build(x: Float64Array, y: Float64Array, z: Float64Array, n: number): void {
    this.reserve(n);
    if (this.ar) {
      const o = this.o;
      const px = this.place(x, n, this.cpx, o.px);
      const py = this.place(y, n, this.cpy, o.py);
      const pz = this.place(z, n, this.cpz, o.pz);
      if (px >= 0 && py >= 0 && pz >= 0) {
        this.mf[8] = this.inv;
        this.ar.fn.grid_build(px, py, pz, n, o.cx, o.cy, o.cz, o.slot, o.start, o.count, o.sorted, o.mf, o.mi);
        return;
      }
      this.ar = undefined;
    }
    let x0 = 0;
    let x1 = -1;
    let y0 = 0;
    let y1 = -1;
    let z0 = 0;
    let z1 = -1;
    const inv = this.inv;
    for (let i = 0; i < n; i++) {
      const cx = Math.floor((x[i] as number) * inv);
      const cy = Math.floor((y[i] as number) * inv);
      const cz = Math.floor((z[i] as number) * inv);
      this.cx[i] = cx;
      this.cy[i] = cy;
      this.cz[i] = cz;
      if (i === 0) {
        x0 = x1 = cx;
        y0 = y1 = cy;
        z0 = z1 = cz;
        continue;
      }
      if (cx < x0) x0 = cx;
      else if (cx > x1) x1 = cx;
      if (cy < y0) y0 = cy;
      else if (cy > y1) y1 = cy;
      if (cz < z0) z0 = cz;
      else if (cz > z1) z1 = cz;
    }
    const nx = x1 - x0 + 3;
    const ny = y1 - y0 + 3;
    const nz = z1 - z0 + 3;
    this.dense = n > 0 && nx * ny * nz <= Math.max(32768, 16 * n);
    if (this.dense) {
      this.ox = x0 - 1;
      this.oy = y0 - 1;
      this.oz = z0 - 1;
      this.nx = nx;
      this.ny = ny;
      this.nz = nz;
      this.table(nx * ny * nz);
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
      const s = this.slotOf(this.cx[i] as number, this.cy[i] as number, this.cz[i] as number);
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
    for (let s = 0; s < t; s++) count[s] = start[s] as number;
    for (let i = 0; i < n; i++) {
      const s = this.slot[i] as number;
      const k = count[s] as number;
      this.sorted[k] = i;
      count[s] = k + 1;
    }
  }

  /**
   * Lists the pairs of drops closer than `reach`, each pair once, in a fixed order: cell by cell in table order, the pairs
   * inside a cell, then with the 13 cells of one half around it. Returns how many.
   */
  findPairs(x: Float64Array, y: Float64Array, z: Float64Array, n: number, reach: number): number {
    if (this.ar) {
      const o = this.o;
      const px = this.place(x, n, this.cpx, o.px);
      const py = this.place(y, n, this.cpy, o.py);
      const pz = this.place(z, n, this.cpz, o.pz);
      if (px >= 0 && py >= 0 && pz >= 0) {
        this.mf[9] = reach;
        this.pairs = this.ar.fn.grid_pairs(px, py, pz, n, o.cx, o.cy, o.cz, o.start, o.sorted, o.sx, o.sy, o.sz, o.nbrN, o.pi, o.pj, o.found, o.mf, o.mi);
        return this.pairs;
      }
    }
    const want = this.sorted.length * (MAX_NEIGHBOURS3 / 2);
    if (this.pi.length < want) {
      this.pi = new Int32Array(want);
      this.pj = new Int32Array(want);
    }
    this.nbrN.fill(0, 0, n);
    // the drops' places in table order, so the search reads memory in a row
    const sorted = this.sorted;
    for (let k = 0; k < n; k++) {
      const i = sorted[k] as number;
      this.sx[k] = x[i] as number;
      this.sy[k] = y[i] as number;
      this.sz[k] = z[i] as number;
    }
    this.pairs = this.dense ? this.pairsDense(reach * reach) : this.pairsHashed(reach * reach);
    return this.pairs;
  }

  private addPair(i: number, j: number, np: number): number {
    const nbrN = this.nbrN;
    const mi = nbrN[i] as number;
    const mj = nbrN[j] as number;
    if (mi >= MAX_NEIGHBOURS3 || mj >= MAX_NEIGHBOURS3) return np;
    nbrN[i] = mi + 1;
    nbrN[j] = mj + 1;
    this.pi[np] = i;
    this.pj[np] = j;
    return np + 1;
  }

  private pairsDense(r2: number): number {
    const start = this.start;
    const sorted = this.sorted;
    const sx = this.sx;
    const sy = this.sy;
    const sz = this.sz;
    const nbrN = this.nbrN;
    const pi = this.pi;
    const pj = this.pj;
    const M = MAX_NEIGHBOURS3;
    const nx = this.nx;
    const nxy = this.nx * this.ny;
    const off = this.off;
    for (let c = 0; c < 13; c++) off[c] = (HX[c] as number) + (HY[c] as number) * nx + (HZ[c] as number) * nxy;
    const t = this.slots;
    let np = 0;
    for (let s = 0; s < t; s++) {
      const a = start[s] as number;
      const b = start[s + 1] as number;
      if (a === b) continue;
      for (let u = a; u < b; u++) {
        const xi = sx[u] as number;
        const yi = sy[u] as number;
        const zi = sz[u] as number;
        const i = sorted[u] as number;
        for (let v = u + 1; v < b; v++) {
          const ex = (sx[v] as number) - xi;
          const ey = (sy[v] as number) - yi;
          const ez = (sz[v] as number) - zi;
          if (ex * ex + ey * ey + ez * ez >= r2) continue;
          const j = sorted[v] as number;
          const mi = nbrN[i] as number;
          const mj = nbrN[j] as number;
          if (mi >= M || mj >= M) continue;
          nbrN[i] = mi + 1;
          nbrN[j] = mj + 1;
          pi[np] = i;
          pj[np] = j;
          np++;
        }
      }
      // a cell with drops is never on the border, so its 26 neighbours are in the table
      for (let c = 0; c < 13; c++) {
        const ns = s + (off[c] as number);
        const na = start[ns] as number;
        const nb = start[ns + 1] as number;
        if (na === nb) continue;
        for (let q = na; q < nb; q++) {
          const xj = sx[q] as number;
          const yj = sy[q] as number;
          const zj = sz[q] as number;
          const j = sorted[q] as number;
          for (let u = a; u < b; u++) {
            const ex = xj - (sx[u] as number);
            const ey = yj - (sy[u] as number);
            const ez = zj - (sz[u] as number);
            if (ex * ex + ey * ey + ez * ez >= r2) continue;
            const i = sorted[u] as number;
            const mi = nbrN[i] as number;
            const mj = nbrN[j] as number;
            if (mi >= M || mj >= M) continue;
            nbrN[i] = mi + 1;
            nbrN[j] = mj + 1;
            pi[np] = i;
            pj[np] = j;
            np++;
          }
        }
      }
    }
    return np;
  }

  private pairsHashed(r2: number): number {
    const start = this.start;
    const sorted = this.sorted;
    const sx = this.sx;
    const sy = this.sy;
    const sz = this.sz;
    const cxs = this.cx;
    const cys = this.cy;
    const czs = this.cz;
    const t = this.slots;
    const group = this.found;
    let np = 0;
    for (let s = 0; s < t; s++) {
      const a = start[s] as number;
      const b = start[s + 1] as number;
      for (let k = a; k < b; k++) {
        const first = sorted[k] as number;
        const cx = cxs[first] as number;
        const cy = cys[first] as number;
        const cz = czs[first] as number;
        // a cell is taken at its first drop in the slot (two cells may share a slot)
        let seen = false;
        for (let q = a; q < k && !seen; q++) {
          const o = sorted[q] as number;
          if (cxs[o] === cx && cys[o] === cy && czs[o] === cz) seen = true;
        }
        if (seen) continue;
        let g = 0;
        for (let q = k; q < b; q++) {
          const o = sorted[q] as number;
          if (cxs[o] === cx && cys[o] === cy && czs[o] === cz) group[g++] = q;
        }
        for (let u = 0; u < g; u++) {
          const pu = group[u] as number;
          for (let v = u + 1; v < g; v++) {
            const pv = group[v] as number;
            const ex = (sx[pv] as number) - (sx[pu] as number);
            const ey = (sy[pv] as number) - (sy[pu] as number);
            const ez = (sz[pv] as number) - (sz[pu] as number);
            if (ex * ex + ey * ey + ez * ez < r2) np = this.addPair(sorted[pu] as number, sorted[pv] as number, np);
          }
        }
        for (let c = 0; c < 13; c++) {
          const ncx = cx + (HX[c] as number);
          const ncy = cy + (HY[c] as number);
          const ncz = cz + (HZ[c] as number);
          const ns = this.hash(ncx, ncy, ncz);
          const nb = start[ns + 1] as number;
          for (let q = start[ns] as number; q < nb; q++) {
            const j = sorted[q] as number;
            if (cxs[j] !== ncx || cys[j] !== ncy || czs[j] !== ncz) continue;
            for (let u = 0; u < g; u++) {
              const pu = group[u] as number;
              const ex = (sx[q] as number) - (sx[pu] as number);
              const ey = (sy[q] as number) - (sy[pu] as number);
              const ez = (sz[q] as number) - (sz[pu] as number);
              if (ex * ex + ey * ey + ez * ez < r2) np = this.addPair(sorted[pu] as number, j, np);
            }
          }
        }
      }
    }
    return np;
  }

  /**
   * The drops whose cell overlaps the box, each once, into `found`; returns how many. When the box covers more cells than
   * there are drops, it walks the drops instead (in index order).
   */
  inBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, n: number): number {
    if (this.ar) {
      const o = this.o;
      const mf = this.mf;
      mf[8] = this.inv;
      mf[10] = x0;
      mf[11] = y0;
      mf[12] = z0;
      mf[13] = x1;
      mf[14] = y1;
      mf[15] = z1;
      return this.ar.fn.grid_in_box(n, o.cx, o.cy, o.cz, o.start, o.sorted, o.found, o.mf, o.mi);
    }
    const out = this.found;
    let cx0 = Math.floor(x0 * this.inv);
    let cy0 = Math.floor(y0 * this.inv);
    let cz0 = Math.floor(z0 * this.inv);
    let cx1 = Math.floor(x1 * this.inv);
    let cy1 = Math.floor(y1 * this.inv);
    let cz1 = Math.floor(z1 * this.inv);
    if (this.dense) {
      cx0 = Math.max(cx0, this.ox);
      cy0 = Math.max(cy0, this.oy);
      cz0 = Math.max(cz0, this.oz);
      cx1 = Math.min(cx1, this.ox + this.nx - 1);
      cy1 = Math.min(cy1, this.oy + this.ny - 1);
      cz1 = Math.min(cz1, this.oz + this.nz - 1);
    }
    if (!(cx1 >= cx0 && cy1 >= cy0 && cz1 >= cz0)) return 0;
    const cells = (cx1 - cx0 + 1) * (cy1 - cy0 + 1) * (cz1 - cz0 + 1);
    let m = 0;
    if (!(cells <= n)) {
      for (let i = 0; i < n; i++) {
        const cx = this.cx[i] as number;
        const cy = this.cy[i] as number;
        const cz = this.cz[i] as number;
        if (cx >= cx0 && cx <= cx1 && cy >= cy0 && cy <= cy1 && cz >= cz0 && cz <= cz1) out[m++] = i;
      }
      return m;
    }
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const s = this.slotOf(cx, cy, cz);
          if (s < 0) continue;
          const end = this.start[s + 1] as number;
          for (let k = this.start[s] as number; k < end; k++) {
            const j = this.sorted[k] as number;
            if (this.dense || (this.cx[j] === cx && this.cy[j] === cy && this.cz[j] === cz)) out[m++] = j;
          }
        }
      }
    }
    return m;
  }
}
