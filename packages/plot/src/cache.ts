/**
 * Sample cache (functions-calculus 9, "Cache and incremental update"). The view
 * holds one cache per plotted function: refined samples are stored keyed by
 * the function's version stamp, a pan reuses the overlapping samples as a
 * seed (no re-evaluation), a version change clears, and a zoom keeps the old
 * result as a scaled preview (caller-side) until the new plot completes.
 */
import type { ParamSeed, SampleSeed } from './contracts';

/** Key for one cached sample set: version, x-range and pixel width. */
export function cacheKey(version: number, x0: number, x1: number, widthPx: number): string {
  return `${version}|${x0}|${x1}|${widthPx}`;
}

export interface CachedSamples {
  readonly version: number;
  readonly xs: Float64Array;
  readonly ys: Float64Array;
}

export interface CachedParamSamples {
  readonly version: number;
  readonly ss: Float64Array;
  readonly xys: Float64Array;
}

/**
 * A small bounded cache of refined samples. Pure data, no timers; the caller
 * decides versions and eviction by clearing.
 */
export interface SampleCache {
  /** Stores scalar samples under a key (at most `capacity` keys are kept). */
  put(key: string, version: number, xs: Float64Array, ys: Float64Array): void;
  /** Stores parametric samples under a key. */
  putParam(key: string, version: number, ss: Float64Array, xys: Float64Array): void;
  /** Samples overlapping `[lo, hi]` for a version, as a plot seed, if any. */
  seedForRange(version: number, lo: number, hi: number): SampleSeed | undefined;
  /** Parametric samples overlapping `[lo, hi]` for a version, if any. */
  paramSeedForRange(version: number, lo: number, hi: number): ParamSeed | undefined;
  /** Drops every entry. */
  clear(): void;
  /** Number of keys held. */
  readonly size: number;
}

export function createSampleCache(capacity = 8): SampleCache {
  const scalar = new Map<string, CachedSamples>();
  const param = new Map<string, CachedParamSamples>();
  const cap = Number.isFinite(capacity) && capacity >= 1 ? Math.floor(capacity) : 8;
  const trim = (m: Map<string, unknown>): void => {
    while (m.size > cap) {
      const first = m.keys().next().value as string | undefined;
      if (first === undefined) return;
      m.delete(first);
    }
  };
  return {
    put(key: string, version: number, xs: Float64Array, ys: Float64Array): void {
      scalar.set(key, { version, xs: xs.slice(), ys: ys.slice() });
      trim(scalar);
    },
    putParam(key: string, version: number, ss: Float64Array, xys: Float64Array): void {
      param.set(key, { version, ss: ss.slice(), xys: xys.slice() });
      trim(param);
    },
    seedForRange(version: number, lo: number, hi: number): SampleSeed | undefined {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const entry of scalar.values()) {
        if (entry.version !== version) continue;
        for (let i = 0; i < entry.xs.length; i++) {
          const x = entry.xs[i] as number;
          if (x >= lo && x <= hi) {
            xs.push(x);
            ys.push(entry.ys[i] as number);
          }
        }
      }
      if (xs.length === 0) return undefined;
      return { xs: new Float64Array(xs), ys: new Float64Array(ys) };
    },
    paramSeedForRange(version: number, lo: number, hi: number): ParamSeed | undefined {
      const ss: number[] = [];
      const xys: number[] = [];
      for (const entry of param.values()) {
        if (entry.version !== version) continue;
        for (let i = 0; i < entry.ss.length; i++) {
          const s = entry.ss[i] as number;
          if (s >= lo && s <= hi) {
            ss.push(s);
            xys.push(entry.xys[2 * i] as number, entry.xys[2 * i + 1] as number);
          }
        }
      }
      if (ss.length === 0) return undefined;
      return { ss: new Float64Array(ss), xys: new Float64Array(xys) };
    },
    clear(): void {
      scalar.clear();
      param.clear();
    },
    get size(): number {
      return scalar.size + param.size;
    },
  };
}
