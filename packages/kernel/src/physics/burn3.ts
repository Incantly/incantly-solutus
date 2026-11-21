/**
 * Things that burn in space (docs/features/physics/design.md 9.7, 9.8): bodies and the cells of a cloth, the plane's
 * `burn2.ts` on a cubic grid. Each burnable unit has its own temperature `Tm` (°C above the air), seconds of burning left
 * `Fm`, and two flags, `lit` and `gone`. Each smoke step, for each unit inside a fire grid's box, in unit order:
 *
 *  1. its cells: the air cells that touch it (the grid's six neighbours of the cells it fills; a unit smaller than a cell
 *     uses the cell at its centre; a cloth cell the cell at its centre);
 *  2. heat swaps with them: `Tm += (Ta − Tm) 0.5 h`, and each cell gets `T += (Tm − T) 2 h / count`;
 *  3. water: a drop in one of its cells takes up to 50 °C off it, and puts it out when it falls under its ignite point;
 *  4. it is lit when `Tm` is at its ignite point (or by `Ignite`), and then burns while it has fuel: `Fm` runs down by `h`,
 *     `Tm` moves toward 0.6 of the fire's heat, and each cell gets fuel (its gas burns in the air) and smoke.
 *
 * What a burnt unit does to the world (mass, joints, cloth links) is the driver's, from `newlyGone`.
 *
 * Exact maths only, no memory made in a step, every loop in a fixed order.
 */
import { BURN_BODY, BURN_CELL } from './burn2';
import type { BurnDef } from './burn2';
import { DROP_COOLS } from './fire2';
import type { Smoke3 } from './smoke3';
import type { World3 } from './world3';

const BODY = BURN_BODY;
const CELL = BURN_CELL;
const PHI_MATERIAL = 0.5;
const PHI_AIR = 2;
const BURN_HEAT = 0.6;
const GAS_RATE = 0.5;
const SMOKE_RATE = 0.2;
const WATER_TAKES = DROP_COOLS;

export class Burnables3 {
  readonly n: number;
  readonly kind: Uint8Array;
  readonly index: Int32Array;
  readonly cell: Int32Array;
  readonly thing: Int32Array;
  readonly ignite: Float64Array;
  readonly f0: Float64Array;
  /** Where a cloth cell is now (the driver sets it at each step). */
  readonly ux: Float64Array;
  readonly uy: Float64Array;
  readonly uz: Float64Array;
  readonly tm: Float64Array;
  readonly fm: Float64Array;
  readonly lit: Uint8Array;
  readonly gone: Uint8Array;
  readonly thingFirst: Int32Array;
  readonly thingCount: Int32Array;
  /** The units that burnt away in the last step, in order. */
  readonly newlyGone: Int32Array;
  nGone = 0;
  private readonly gridOf: Int32Array;
  private grids: readonly Smoke3[] = [];
  /** Per grid: the cells each body fills, by unit (start offsets and the cells). */
  private starts: Int32Array[] = [];
  private lists: Int32Array[] = [];
  private unitOfBody = new Int32Array(0);
  private cells = new Int32Array(0);
  private fillBuf = new Int32Array(0);
  private seen: Int32Array[] = [];
  private stamp = 0;
  /** Scratch: the place of the unit being looked at. */
  private px = 0;
  private py = 0;
  private pz = 0;

  constructor(defs: readonly BurnDef3[]) {
    const n = defs.length;
    this.n = n;
    this.kind = new Uint8Array(n);
    this.index = new Int32Array(n);
    this.cell = new Int32Array(n);
    this.thing = new Int32Array(n);
    this.ignite = new Float64Array(n);
    this.f0 = new Float64Array(n);
    this.ux = new Float64Array(n);
    this.uy = new Float64Array(n);
    this.uz = new Float64Array(n);
    this.tm = new Float64Array(n);
    this.fm = new Float64Array(n);
    this.lit = new Uint8Array(n);
    this.gone = new Uint8Array(n);
    this.gridOf = new Int32Array(n);
    this.newlyGone = new Int32Array(n);
    let things = 0;
    for (const d of defs) things = Math.max(things, d.thing + 1);
    this.thingFirst = new Int32Array(things).fill(-1);
    this.thingCount = new Int32Array(things);
    defs.forEach((d, u) => {
      this.kind[u] = d.kind;
      this.index[u] = d.index;
      this.cell[u] = d.cell;
      this.thing[u] = d.thing;
      this.ignite[u] = d.ignite;
      this.f0[u] = d.seconds;
      this.fm[u] = d.seconds;
      this.ux[u] = d.x;
      this.uy[u] = d.y;
      this.uz[u] = d.z;
      if ((this.thingFirst[d.thing] as number) < 0) this.thingFirst[d.thing] = u;
      this.thingCount[d.thing] = (this.thingCount[d.thing] as number) + 1;
    });
  }

  /** Ties the units to the fire grids and the world they are in (made once, when the world is built). */
  bind(grids: readonly Smoke3[], worldBodies: number): void {
    this.grids = grids;
    const N = (g: Smoke3): number => g.n * g.n * g.n;
    this.starts = grids.map(() => new Int32Array(this.n + 1));
    this.lists = grids.map((g) => new Int32Array(N(g)));
    this.seen = grids.map((g) => new Int32Array(N(g)));
    let most = 1;
    for (const g of grids) most = Math.max(most, N(g));
    this.cells = new Int32Array(most);
    this.fillBuf = new Int32Array(Math.max(1, this.n));
    this.unitOfBody = new Int32Array(Math.max(0, worldBodies)).fill(-1);
    for (let u = 0; u < this.n; u++) if (this.kind[u] !== CELL && (this.index[u] as number) < this.unitOfBody.length) this.unitOfBody[this.index[u] as number] = u;
  }

  /** Back to the start: cold, unlit, all the fuel. */
  reset(): void {
    this.tm.fill(0);
    this.lit.fill(0);
    this.gone.fill(0);
    for (let u = 0; u < this.n; u++) this.fm[u] = this.f0[u] as number;
    this.nGone = 0;
  }

  /** `Ignite`: every unit of a thing that has not burnt away is lit now. */
  igniteThing(thing: number): void {
    const first = this.thingFirst[thing] as number;
    if (first < 0) return;
    for (let u = first; u < first + (this.thingCount[thing] as number); u++) if (this.gone[u] === 0) this.lit[u] = 1;
  }

  burnt(u: number): number {
    const f0 = this.f0[u] as number;
    return f0 > 0 ? 1 - (this.fm[u] as number) / f0 : 0;
  }

  burning(u: number): boolean {
    return this.lit[u] === 1 && (this.fm[u] as number) > 0;
  }

  /** The place of unit u into `px`, `py`, `pz` (a body from the world, a cloth cell as the driver set it). */
  private place(u: number, w: World3 | undefined): void {
    if (this.kind[u] === BODY && w) {
      const i = this.index[u] as number;
      this.px = w.p[i * 3] as number;
      this.py = w.p[i * 3 + 1] as number;
      this.pz = w.p[i * 3 + 2] as number;
    } else {
      this.px = this.ux[u] as number;
      this.py = this.uy[u] as number;
      this.pz = this.uz[u] as number;
    }
  }

  /** The first grid whose box holds the place in `px`, `py`, `pz`, or −1. */
  private gridHere(): number {
    for (let k = 0; k < this.grids.length; k++) {
      const g = this.grids[k] as Smoke3;
      if (this.px >= g.x0 && this.px <= g.x1 && this.py >= g.y0 && this.py <= g.y1 && this.pz >= g.z0 && this.pz <= g.z1) return k;
    }
    return -1;
  }

  /** Is unit u inside some fire grid now? */
  insideGrid(u: number, w: World3 | undefined): boolean {
    this.place(u, w);
    return this.gridHere() >= 0;
  }

  /** One smoke step of `h`, after the grids' step. */
  step(w: World3 | undefined, h: number): void {
    this.nGone = 0;
    if (this.n === 0 || this.grids.length === 0) return;
    let any = false;
    for (let u = 0; u < this.n; u++) {
      if (this.gone[u] === 1) {
        this.gridOf[u] = -1;
        continue;
      }
      this.place(u, w);
      const g = this.gridHere();
      this.gridOf[u] = g;
      if (g >= 0) any = true;
    }
    if (!any) return;
    for (let k = 0; k < this.grids.length; k++) this.listCells(k);
    for (let u = 0; u < this.n; u++) {
      const k = this.gridOf[u] as number;
      if (k < 0 || this.gone[u] === 1) continue;
      this.unit(u, k, w, h);
    }
  }

  /** The cells each body fills in grid k, grouped by unit (a counting sort over the grid, in cell order). */
  private listCells(k: number): void {
    const g = this.grids[k] as Smoke3;
    const start = this.starts[k] as Int32Array;
    const list = this.lists[k] as Int32Array;
    const own = g.own;
    const owner = this.unitOfBody;
    start.fill(0);
    for (let c = 0; c < own.length; c++) {
      const b = own[c] as number;
      if (b < 0 || b >= owner.length) continue;
      const u = owner[b] as number;
      if (u >= 0) start[u + 1] = (start[u + 1] as number) + 1;
    }
    for (let u = 0; u < this.n; u++) start[u + 1] = (start[u + 1] as number) + (start[u] as number);
    const fill = this.fillBuf;
    for (let u = 0; u < this.n; u++) fill[u] = start[u] as number;
    for (let c = 0; c < own.length; c++) {
      const b = own[c] as number;
      if (b < 0 || b >= owner.length) continue;
      const u = owner[b] as number;
      if (u < 0) continue;
      list[fill[u] as number] = c;
      fill[u] = (fill[u] as number) + 1;
    }
  }

  /** One unit against its grid. */
  private unit(u: number, k: number, w: World3 | undefined, h: number): void {
    const g = this.grids[k] as Smoke3;
    const fire = g.fire;
    if (!fire) return;
    const n = g.n;
    const nn = n * n;
    const own = g.own;
    const kind = this.kind[u] as number;
    const cells = this.cells;
    let count = 0;
    if (kind === CELL || this.fillCount(k, u) === 0) {
      // smaller than a cell, or a cloth cell: the grid cell at its centre
      this.place(u, w);
      const c = g.cellAt(this.px, this.py, this.pz);
      if (c >= 0 && (own[c] as number) < 0) cells[count++] = c;
    } else {
      const start = this.starts[k] as Int32Array;
      const list = this.lists[k] as Int32Array;
      const seen = this.seen[k] as Int32Array;
      // a fresh stamp: a cell is listed once however many of the unit's cells touch it
      this.stamp++;
      if (this.stamp > 1073741000) {
        for (let s = 0; s < this.seen.length; s++) (this.seen[s] as Int32Array).fill(0);
        this.stamp = 1;
      }
      const st = this.stamp;
      for (let q = start[u] as number; q < (start[u + 1] as number); q++) {
        const c = list[q] as number;
        const ci = c % n;
        const cj = ((c - ci) / n) % n;
        const ck = (c - ci - cj * n) / nn;
        if (ci > 0) count = this.touch(c - 1, seen, st, own, cells, count);
        if (ci < n - 1) count = this.touch(c + 1, seen, st, own, cells, count);
        if (cj > 0) count = this.touch(c - n, seen, st, own, cells, count);
        if (cj < n - 1) count = this.touch(c + n, seen, st, own, cells, count);
        if (ck > 0) count = this.touch(c - nn, seen, st, own, cells, count);
        if (ck < n - 1) count = this.touch(c + nn, seen, st, own, cells, count);
      }
    }
    if (count === 0) return;
    const T = g.T;
    let sum = 0;
    for (let q = 0; q < count; q++) sum += T[cells[q] as number] as number;
    const ta = sum / count;
    let tm = this.tm[u] as number;
    tm += (ta - tm) * PHI_MATERIAL * h;
    const give = (PHI_AIR * h) / count;
    for (let q = 0; q < count; q++) {
      const c = cells[q] as number;
      T[c] = (T[c] as number) + (tm - (T[c] as number)) * give;
    }
    const wet = g.wet;
    let wetAny = false;
    for (let q = 0; q < count && !wetAny; q++) if (wet[cells[q] as number] === 1) wetAny = true;
    const ignite = this.ignite[u] as number;
    if (wetAny) {
      tm -= tm < WATER_TAKES ? tm : WATER_TAKES;
      if (tm < ignite) this.lit[u] = 0;
    }
    if (this.lit[u] === 0 && tm >= ignite) this.lit[u] = 1;
    if (this.lit[u] === 1 && (this.fm[u] as number) > 0) {
      let fm = (this.fm[u] as number) - h;
      if (fm < 0) fm = 0;
      this.fm[u] = fm;
      tm += (BURN_HEAT * fire.heat - tm) * h;
      const F = g.F;
      const s = g.s;
      const gas = (GAS_RATE * h * 4) / count;
      const smoke = fire.smoke * SMOKE_RATE * h;
      for (let q = 0; q < count; q++) {
        const c = cells[q] as number;
        const f = (F[c] as number) + gas;
        F[c] = f < 1 ? f : 1;
        s[c] = (s[c] as number) + smoke;
      }
      if (fm <= 0) {
        this.gone[u] = 1;
        this.newlyGone[this.nGone++] = u;
      }
    }
    this.tm[u] = tm;
  }

  private fillCount(k: number, u: number): number {
    const start = this.starts[k] as Int32Array;
    return (start[u + 1] as number) - (start[u] as number);
  }

  private touch(c: number, seen: Int32Array, stamp: number, own: Int32Array, cells: Int32Array, count: number): number {
    if ((own[c] as number) >= 0 || seen[c] === stamp) return count;
    seen[c] = stamp;
    cells[count] = c;
    return count + 1;
  }

  /* ------------------------------ checkpoints ------------------------------ */

  save(): Float64Array {
    const n = this.n;
    const out = new Float64Array(1 + 4 * n);
    out[0] = n;
    out.set(this.tm, 1);
    out.set(this.fm, 1 + n);
    for (let u = 0; u < n; u++) {
      out[1 + 2 * n + u] = this.lit[u] as number;
      out[1 + 3 * n + u] = this.gone[u] as number;
    }
    return out;
  }

  load(s: Float64Array): void {
    const n = this.n;
    this.tm.set(s.subarray(1, 1 + n));
    this.fm.set(s.subarray(1 + n, 1 + 2 * n));
    for (let u = 0; u < n; u++) {
      this.lit[u] = s[1 + 2 * n + u] === 1 ? 1 : 0;
      this.gone[u] = s[1 + 3 * n + u] === 1 ? 1 : 0;
    }
    this.nGone = 0;
  }
}

/** A burnable unit in space: `BurnDef` with the third coordinate of a cloth cell. */
export interface BurnDef3 extends BurnDef {
  readonly z: number;
}
