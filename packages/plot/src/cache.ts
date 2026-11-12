/**
 * Sample cache (functions-calculus 9, "Cache and incremental update"). The view
 * holds one cache per plotted function: refined samples are stored keyed by
 * the function's identity and version stamp, a pan reuses the overlapping
 * samples as a seed (no re-evaluation), a version change discards the older
 * samples of that function, and a zoom keeps the old result as a scaled preview
 * (caller-side) until the new plot completes.
 */
import type { ParamSeed, SampleSeed } from './contracts';

/** Key for one cached sample set: version, x-range and pixel width. */
export function cacheKey(version: number, x0: number, x1: number, widthPx: number): string {
  return `${version}|${x0}|${x1}|${widthPx}`;
}

export interface CachedSamples {
  readonly identity: string;
  readonly version: number;
  readonly xs: Float64Array;
  readonly ys: Float64Array;
}

export interface CachedParamSamples {
  readonly identity: string;
  readonly version: number;
  readonly ss: Float64Array;
  readonly xys: Float64Array;
}

/**
 * A small bounded cache of refined samples. Pure data, no timers.
 *
 * An entry belongs to one function, named by `identity` (any stable string the
 * caller owns for it; callers with one function can leave it out). A seed only
 * holds samples of one identity at one version, one value per x, ascending in x.
 * When two puts cover the same x, the later put wins. Eviction drops the least
 * recently used key: a `put` or a lookup that reads an entry makes it the newest.
 */
export interface SampleCache {
  /** Stores scalar samples under a key (at most `capacity` keys are kept). A put discards other versions of the same identity. */
  put(key: string, version: number, xs: Float64Array, ys: Float64Array, identity?: string): void;
  /** Stores parametric samples under a key. */
  putParam(key: string, version: number, ss: Float64Array, xys: Float64Array, identity?: string): void;
  /** Samples overlapping `[lo, hi]` for an identity at a version, as a plot seed, if any. */
  seedForRange(version: number, lo: number, hi: number, identity?: string): SampleSeed | undefined;
  /** Parametric samples overlapping `[lo, hi]` for an identity at a version, if any. */
  paramSeedForRange(version: number, lo: number, hi: number, identity?: string): ParamSeed | undefined;
  /** Drops every entry. */
  clear(): void;
  /** Number of keys held. */
  readonly size: number;
}

interface Tagged {
  readonly identity: string;
  readonly version: number;
}

/** Re-inserts a key so it becomes the newest (Map keeps insertion order). */
function touch<T>(m: Map<string, T>, key: string, value: T): void {
  m.delete(key);
  m.set(key, value);
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
  /** A new version of a function makes its older samples worthless. */
  const dropOtherVersions = <T extends Tagged>(m: Map<string, T>, identity: string, version: number): void => {
    for (const [k, e] of [...m]) {
      if (e.identity === identity && e.version !== version) m.delete(k);
    }
  };
  return {
    put(key: string, version: number, xs: Float64Array, ys: Float64Array, identity = ''): void {
      dropOtherVersions(scalar, identity, version);
      touch(scalar, key, { identity, version, xs: xs.slice(), ys: ys.slice() });
      trim(scalar);
    },
    putParam(key: string, version: number, ss: Float64Array, xys: Float64Array, identity = ''): void {
      dropOtherVersions(param, identity, version);
      touch(param, key, { identity, version, ss: ss.slice(), xys: xys.slice() });
      trim(param);
    },
    seedForRange(version: number, lo: number, hi: number, identity = ''): SampleSeed | undefined {
      // Oldest entries first, so a later put overwrites an earlier one at the same x.
      const byX = new Map<number, number>();
      const read: string[] = [];
      for (const [key, entry] of scalar) {
        if (entry.identity !== identity || entry.version !== version) continue;
        read.push(key);
        for (let i = 0; i < entry.xs.length; i++) {
          const x = entry.xs[i] as number;
          if (x >= lo && x <= hi) byX.set(x, entry.ys[i] as number);
        }
      }
      for (const key of read) touch(scalar, key, scalar.get(key) as CachedSamples);
      if (byX.size === 0) return undefined;
      const xs = Float64Array.from(byX.keys()).sort();
      const ys = new Float64Array(xs.length);
      for (let i = 0; i < xs.length; i++) ys[i] = byX.get(xs[i] as number) as number;
      return { xs, ys };
    },
    paramSeedForRange(version: number, lo: number, hi: number, identity = ''): ParamSeed | undefined {
      const byS = new Map<number, readonly [number, number]>();
      const read: string[] = [];
      for (const [key, entry] of param) {
        if (entry.identity !== identity || entry.version !== version) continue;
        read.push(key);
        for (let i = 0; i < entry.ss.length; i++) {
          const s = entry.ss[i] as number;
          if (s >= lo && s <= hi) byS.set(s, [entry.xys[2 * i] as number, entry.xys[2 * i + 1] as number]);
        }
      }
      for (const key of read) touch(param, key, param.get(key) as CachedParamSamples);
      if (byS.size === 0) return undefined;
      const ss = Float64Array.from(byS.keys()).sort();
      const xys = new Float64Array(ss.length * 2);
      for (let i = 0; i < ss.length; i++) {
        const xy = byS.get(ss[i] as number) as readonly [number, number];
        xys[2 * i] = xy[0];
        xys[2 * i + 1] = xy[1];
      }
      return { ss, xys };
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
