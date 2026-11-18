/**
 * Arrays a driver writes a cell's numbers into, two in turn (design 11.4, "no garbage").
 *
 * A cell's typed arrays are the readout of a frame (a cloth's points, a liquid's drops). Making new ones each frame is
 * garbage: tens of KB a frame that fill the young generation. The figure compares a new cell with the one it holds, so the
 * array it holds must not be the one written into: two arrays are kept and the driver writes into the one the last frame
 * did not. A cell therefore keeps its numbers for one frame after the one that follows it, which is as long as a view reads
 * them (it copies them out to draw). An array whose buffer was handed to another thread (the worker moves the typed arrays
 * of its cells) has length 0 and is made again.
 */
export class FlipArrays<T extends Float32Array | Float64Array | Uint8Array> {
  private readonly pair: (T | undefined)[] = [undefined, undefined];
  private phase = 0;

  constructor(private readonly make: (n: number) => T) {}

  /** The array to write this frame's `n` numbers into. Its old numbers are the frame before the last one's. */
  next(n: number): T {
    this.phase = 1 - this.phase;
    let a = this.pair[this.phase];
    if (a === undefined || a.length !== n) {
      a = this.make(n);
      this.pair[this.phase] = a;
    }
    return a;
  }
}

/** Float64 arrays, for the flips above (a function made once, not at each call). */
export const makeFloat64 = (n: number): Float64Array => new Float64Array(n);
export const makeFloat32 = (n: number): Float32Array => new Float32Array(n);

/** Are the numbers of `a` and `b` the same, one for one? (NaN is the same as NaN.) */
export function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i] as number;
    const q = b[i] as number;
    if (p !== q && !(p !== p && q !== q)) return false;
  }
  return true;
}

/** Are the texts of `a` and `b` the same, one for one? */
export function sameTexts(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * What a driver keeps to write a cloth's readout each frame without making arrays: the point arrays in turn, and the
 * arrays that change rarely (the torn threads, the pins' places, the bodies touched) held until their numbers change, so
 * the cell of a frame that changed none of them holds the very arrays of the frame before.
 */
export class ClothOut {
  readonly xs = new FlipArrays<Float64Array>(makeFloat64);
  readonly ys = new FlipArrays<Float64Array>(makeFloat64);
  readonly zs = new FlipArrays<Float64Array>(makeFloat64);
  /** The torn threads the last cell holds, and the array they are worked out in. */
  cut: Uint8Array = new Uint8Array(0);
  cutNow: Uint8Array = new Uint8Array(0);
  /** The pins' places the last cell holds, and the array they are worked out in. */
  pinsAt: number[] = [];
  pinsNow: number[] = [];
  /** The names of the bodies touched that the last cell holds, the ones now, and their indices. */
  touching: string[] = [];
  touchingNow: string[] = [];
  touchIndex: number[] = [];

  /** Makes `cutNow` `n` long and zero, ready to be written; returns `n`. */
  cutLength(n: number): number {
    if (this.cutNow.length !== n) this.cutNow = new Uint8Array(n);
    else this.cutNow.fill(0);
    return n;
  }

  /** The torn-thread array for this frame, `n` long: the last one when `cutNow` holds the same ones. */
  cutFor(n: number): Uint8Array {
    if (this.cut.length !== n) this.cut = new Uint8Array(n);
    const a = this.cut;
    const b = this.cutNow;
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) {
      this.cut = b.slice(0, n);
      break;
    }
    return this.cut;
  }

  /** The pins' places for this frame: the last array when `pinsNow` holds the same numbers. */
  pinsFor(): number[] {
    if (!sameNumbers(this.pinsAt, this.pinsNow)) this.pinsAt = this.pinsNow.slice();
    return this.pinsAt;
  }

  /** The touched bodies' names for this frame: the last array when `touchingNow` holds the same ones. */
  touchingFor(): string[] {
    if (!sameTexts(this.touching, this.touchingNow)) this.touching = this.touchingNow.slice();
    return this.touching;
  }
}

/**
 * The objects a driver changed in a frame, handed to the figure as an array of exactly their number. An array filled and
 * emptied at each frame (`length = 0`, then `push`) makes its places again each time, so the objects go into a work array
 * from the start and the figure is given one array kept for each number of objects (a frame that changes as many as the
 * last one makes none).
 */
export class RecList<T> {
  private readonly work: T[] = [];
  private n = 0;
  private readonly exact: T[][] = [];

  /** Starts a frame's list. */
  reset(): void {
    this.n = 0;
  }

  push(r: T): void {
    this.work[this.n++] = r;
  }

  /** The objects pushed since `reset`, as an array of that length. It is the list's own: the next `take` of that length rewrites it. */
  take(): readonly T[] {
    const n = this.n;
    let a = this.exact[n];
    if (a === undefined) {
      a = [];
      this.exact[n] = a;
    }
    for (let k = 0; k < n; k++) a[k] = this.work[k] as T;
    a.length = n;
    return a;
  }
}

/** The drops' places of a liquid's cell, written over each frame in turn (single precision, as the view takes them). */
export class DropsOut {
  readonly xs = new FlipArrays<Float32Array>(makeFloat32);
  readonly ys = new FlipArrays<Float32Array>(makeFloat32);
  readonly zs = new FlipArrays<Float32Array>(makeFloat32);
}

/**
 * What a driver keeps of one body to write its cell each frame without making arrays: the forces' array in turn, the
 * names of what it touches held until they change, and, for a body at rest, the last cell with the numbers it was made
 * from, so a frame that changed none of them hands the figure the very cell it holds (nothing to compare, nothing made).
 */
export class BodyOut {
  readonly forces = new FlipArrays<Float64Array>(makeFloat64);
  /** The names the last cell holds, and the ones being collected for this frame (`nNow` of them). */
  touching: string[] = [];
  private readonly names: string[] = [];
  private nNow = 0;
  /** A body at rest: the numbers its last cell was made from, the ones now, and the cell. */
  key: Float64Array = new Float64Array(0);
  keyNow: Float64Array = new Float64Array(0);
  keySpec: unknown;
  cell: unknown;
  /** The names the held cell holds (the cell is the held one only while this is still `touching`). */
  cellTouching: string[] | undefined;

  /** The numbers just worked out in `keyNow` are the held ones now (the two arrays swap, nothing is copied). */
  holdKey(): void {
    const t = this.key;
    this.key = this.keyNow;
    this.keyNow = t;
  }

  /** Starts this frame's list of names. (Written from the start, not emptied by `length = 0`, which frees the places.) */
  beginTouch(): void {
    this.nNow = 0;
  }

  addTouch(name: string): void {
    this.names[this.nNow++] = name;
  }

  /** The touched bodies' names for this frame: the last array when this frame's are the same ones. */
  touchingFor(): string[] {
    const t = this.touching;
    let same = t.length === this.nNow;
    for (let i = 0; same && i < this.nNow; i++) if (t[i] !== this.names[i]) same = false;
    if (!same) this.touching = this.names.slice(0, this.nNow);
    return this.touching;
  }

  /** Does `keyNow` hold the numbers the held cell was made from? */
  sameKey(): boolean {
    const a = this.key;
    const b = this.keyNow;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  }
}
