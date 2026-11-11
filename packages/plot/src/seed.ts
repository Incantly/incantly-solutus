/**
 * Seed handling shared by the function and the parametric plotters
 * (functions-calculus 9, "Cache and incremental update"). A seed is a set of
 * cached samples from an earlier view. It only saves evaluations: it is
 * trimmed to the range being plotted and to the sample cap, it never counts
 * against the cap (only samples a run actually uses do), and a pan reuses the
 * cached samples by snapping the new coarse grid onto them.
 */
import { pickIndices } from './thin';

/** Fraction of a coarse step within which a coarse point snaps onto a cached sample. */
export const SNAP_FRACTION = 0.3;

/**
 * The seed keys inside `[lo, hi]`, finite, unique and ascending, thinned to at
 * most `cap` (evenly, by index) when there are more.
 */
export function trimSeedKeys(keys: Iterable<number>, lo: number, hi: number, cap: number): number[] {
  const seen = new Set<number>();
  for (const k of keys) {
    if (Number.isFinite(k) && k >= lo && k <= hi) seen.add(k);
  }
  const sorted = [...seen].sort((a, b) => a - b);
  if (sorted.length <= cap) return sorted;
  return pickIndices(sorted.length, cap).map((i) => sorted[i] as number);
}

/** The element of an ascending array nearest to x (the lower one on a tie), or undefined when empty. */
export function nearestKey(sorted: readonly number[], x: number): number | undefined {
  if (sorted.length === 0) return undefined;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] as number) < x) lo = mid + 1;
    else hi = mid;
  }
  const above = sorted[lo];
  const below = sorted[lo - 1];
  if (above === undefined) return below;
  if (below === undefined) return above;
  return x - below <= above - x ? below : above;
}

/**
 * Moves each interior point of an ascending grid onto the nearest cached key
 * within `tol`, so a pan reuses the cached samples. The first and last points
 * are the range ends and stay put; a move that would break the ascending order
 * is skipped.
 */
export function snapGrid(grid: readonly number[], keys: readonly number[], tol: number): number[] {
  if (keys.length === 0 || !(tol > 0)) return [...grid];
  const out = [...grid];
  for (let i = 1; i + 1 < out.length; i++) {
    const g = out[i] as number;
    const k = nearestKey(keys, g);
    if (k === undefined || Math.abs(k - g) > tol) continue;
    const prev = out[i - 1] as number;
    const next = grid[i + 1] as number;
    if (k > prev && k < next) out[i] = k;
  }
  return out;
}
