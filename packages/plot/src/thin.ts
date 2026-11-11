/**
 * Output sample cap (`docs/design/performance.md` section 5: 4,000 curve samples
 * per curve on screen). Refinement stops at the cap, and these helpers make the
 * emitted point count obey it too, whatever the coarse grid, the verdict passes
 * or the linking produced. Pure and deterministic: points are picked by index.
 */

/** Indices of `k` points spread evenly over `n`, always including the first and last. */
export function pickIndices(n: number, k: number): number[] {
  if (k >= n) return Array.from({ length: n }, (_, i) => i);
  if (k <= 1) return [0];
  const out: number[] = [];
  let prev = -1;
  for (let j = 0; j < k; j++) {
    const i = Math.round((j * (n - 1)) / (k - 1));
    if (i !== prev) out.push(i);
    prev = i;
  }
  return out;
}

/**
 * Thins polylines (arrays of points) so the total point count is at most `cap`.
 * Each polyline keeps its first and last point and at least 2 points; if even
 * that exceeds the cap the later polylines are dropped. Returns the polylines
 * and whether anything was removed.
 */
export function thinChains<T>(chains: readonly (readonly T[])[], cap: number): { chains: (readonly T[])[]; thinned: boolean } {
  let total = 0;
  for (const c of chains) total += c.length;
  if (total <= cap) return { chains: [...chains], thinned: false };
  let kept: (readonly T[])[] = [...chains];
  // More polylines than the cap can hold at 2 points each: keep the earliest.
  const maxChains = Math.max(1, Math.floor(cap / 2));
  if (kept.length > maxChains) kept = kept.slice(0, maxChains);
  let sum = 0;
  for (const c of kept) sum += c.length;
  const scale = cap / sum;
  const out: (readonly T[])[] = [];
  let used = 0;
  for (let i = 0; i < kept.length; i++) {
    const c = kept[i] as readonly T[];
    const reserve = 2 * (kept.length - i - 1);
    const want = Math.max(2, Math.floor(c.length * scale));
    const k = Math.max(2, Math.min(want, c.length, cap - used - reserve));
    const idx = pickIndices(c.length, k);
    out.push(idx.map((j) => c[j] as T));
    used += idx.length;
  }
  return { chains: out, thinned: true };
}
