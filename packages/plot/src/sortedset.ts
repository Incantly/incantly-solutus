/**
 * An ordered set of numbers with insert, predecessor and successor in
 * O(log n + chunk) time. Chunks of sorted numbers keep inserts cheap at the
 * sizes the tracers reach (up to the evaluation cap), where one flat sorted
 * array would move megabytes per insert.
 */
const CHUNK_MAX = 512;

export class SortedSet {
  private chunks: number[][] = [];
  private count = 0;

  get size(): number {
    return this.count;
  }

  /** Index of the chunk that holds (or should hold) v. */
  private chunkFor(v: number): number {
    let lo = 0;
    let hi = this.chunks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (((this.chunks[mid] as number[])[0] as number) <= v) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Position of the first element >= v inside a chunk. */
  private static lowerBound(chunk: readonly number[], v: number): number {
    let lo = 0;
    let hi = chunk.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((chunk[mid] as number) < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  add(v: number): void {
    if (this.chunks.length === 0) {
      this.chunks.push([v]);
      this.count = 1;
      return;
    }
    const ci = this.chunkFor(v);
    const chunk = this.chunks[ci] as number[];
    const at = SortedSet.lowerBound(chunk, v);
    if (chunk[at] === v) return;
    chunk.splice(at, 0, v);
    this.count += 1;
    if (chunk.length > CHUNK_MAX) {
      const half = chunk.length >> 1;
      this.chunks.splice(ci + 1, 0, chunk.splice(half));
    }
  }

  /** Smallest element strictly greater than v. */
  successor(v: number): number | undefined {
    if (this.chunks.length === 0) return undefined;
    let ci = this.chunkFor(v);
    for (; ci < this.chunks.length; ci++) {
      const chunk = this.chunks[ci] as number[];
      let at = SortedSet.lowerBound(chunk, v);
      if (chunk[at] === v) at += 1;
      if (at < chunk.length) return chunk[at];
    }
    return undefined;
  }

  /** Largest element strictly less than v. */
  predecessor(v: number): number | undefined {
    if (this.chunks.length === 0) return undefined;
    for (let ci = this.chunkFor(v); ci >= 0; ci--) {
      const chunk = this.chunks[ci] as number[];
      const at = SortedSet.lowerBound(chunk, v);
      if (at > 0) return chunk[at - 1];
    }
    return undefined;
  }
}
