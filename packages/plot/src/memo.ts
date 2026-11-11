/**
 * A bounded memo of field values keyed by the exact input pair. Open
 * addressing over typed arrays: no string keys and no per-entry objects, so a
 * long trace holds a figure-sized amount of memory. When the table reaches its
 * entry cap it is emptied; a later repeat of an old input is then evaluated
 * again (and counted), which costs budget but never correctness.
 */
const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);

function hashPair(x: number, y: number): number {
  F64[0] = x;
  let h = (U32[0] as number) ^ Math.imul(U32[1] as number, 0x9e3779b1);
  F64[0] = y;
  h = Math.imul(h ^ (U32[0] as number), 0x85ebca6b) ^ Math.imul(U32[1] as number, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 13;
  return h >>> 0;
}

export class PointMemo {
  private cap = 1 << 10;
  private xs = new Float64Array(this.cap);
  private ys = new Float64Array(this.cap);
  private vs = new Float64Array(this.cap);
  private used = new Uint8Array(this.cap);
  private entries = 0;

  /** `maxEntries` bounds the live entries; the table holds twice that many slots at most. */
  constructor(private readonly maxEntries: number) {}

  /** Stored value, or undefined. */
  get(x: number, y: number): number | undefined {
    const nx = x + 0;
    const ny = y + 0;
    const mask = this.cap - 1;
    let i = hashPair(nx, ny) & mask;
    while (this.used[i] === 1) {
      if (this.xs[i] === nx && this.ys[i] === ny) return this.vs[i];
      i = (i + 1) & mask;
    }
    return undefined;
  }

  set(x: number, y: number, v: number): void {
    // NaN inputs never compare equal, so they are never worth storing.
    if (Number.isNaN(x) || Number.isNaN(y)) return;
    if (this.entries >= this.maxEntries) this.clear();
    if ((this.entries + 1) * 2 > this.cap) this.grow();
    const nx = x + 0;
    const ny = y + 0;
    const mask = this.cap - 1;
    let i = hashPair(nx, ny) & mask;
    while (this.used[i] === 1) {
      if (this.xs[i] === nx && this.ys[i] === ny) {
        this.vs[i] = v;
        return;
      }
      i = (i + 1) & mask;
    }
    this.used[i] = 1;
    this.xs[i] = nx;
    this.ys[i] = ny;
    this.vs[i] = v;
    this.entries += 1;
  }

  private clear(): void {
    this.used.fill(0);
    this.entries = 0;
  }

  private grow(): void {
    const oldCap = this.cap;
    const xs = this.xs;
    const ys = this.ys;
    const vs = this.vs;
    const used = this.used;
    this.cap = oldCap * 2;
    this.xs = new Float64Array(this.cap);
    this.ys = new Float64Array(this.cap);
    this.vs = new Float64Array(this.cap);
    this.used = new Uint8Array(this.cap);
    this.entries = 0;
    for (let k = 0; k < oldCap; k++) {
      if (used[k] === 1) this.set(xs[k] as number, ys[k] as number, vs[k] as number);
    }
  }
}
