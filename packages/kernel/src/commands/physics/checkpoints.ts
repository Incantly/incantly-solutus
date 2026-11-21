/**
 * The checkpoints of a world driver (design 10.3): the whole state at some steps, to seek from. Keys (step numbers) are kept
 * in ascending order in an array, so the driver's every-frame question, the latest checkpoint at or before a step, walks
 * a short array and makes no iterator (a `Map`'s `keys()` makes a new iterator and a result object per key, design 11.4).
 */
export class CheckpointStore {
  private readonly ks: number[] = [];
  private readonly vs: Float64Array[] = [];

  /** How many checkpoints are held. */
  get size(): number {
    return this.ks.length;
  }

  has(n: number): boolean {
    for (let i = 0; i < this.ks.length; i++) if (this.ks[i] === n) return true;
    return false;
  }

  get(n: number): Float64Array | undefined {
    for (let i = 0; i < this.ks.length; i++) if (this.ks[i] === n) return this.vs[i];
    return undefined;
  }

  /** Stores the state of step `n` (over the one there, if any). */
  set(n: number, s: Float64Array): void {
    const ks = this.ks;
    let i = ks.length;
    while (i > 0 && (ks[i - 1] as number) > n) i--;
    if (i > 0 && ks[i - 1] === n) this.vs[i - 1] = s;
    else {
      ks.splice(i, 0, n);
      this.vs.splice(i, 0, s);
    }
  }

  /** The latest step at or before `want` that has a checkpoint, or -1 when none has. */
  best(want: number): number {
    for (let i = this.ks.length - 1; i >= 0; i--) {
      const k = this.ks[i] as number;
      if (k <= want) return k;
    }
    return -1;
  }

  /** Drops the checkpoints after step `n`. */
  dropAfter(n: number): void {
    let i = this.ks.length;
    while (i > 0 && (this.ks[i - 1] as number) > n) i--;
    this.ks.length = i;
    this.vs.length = i;
  }

  /** Keeps step 0 and the multiples of `stride`, drops the rest; returns the bytes kept. */
  thin(stride: number): number {
    let m = 0;
    let bytes = 0;
    for (let i = 0; i < this.ks.length; i++) {
      const k = this.ks[i] as number;
      if (k !== 0 && k % stride !== 0) continue;
      const v = this.vs[i] as Float64Array;
      this.ks[m] = k;
      this.vs[m] = v;
      m++;
      bytes += v.byteLength;
    }
    this.ks.length = m;
    this.vs.length = m;
    return bytes;
  }

  /** The bytes of every checkpoint held. */
  bytes(): number {
    let b = 0;
    for (let i = 0; i < this.vs.length; i++) b += (this.vs[i] as Float64Array).byteLength;
    return b;
  }
}
