import type { Vec2 } from '../../api/types';

/**
 * Pure arithmetic behind the chart kit: nice axis ranges and ticks, the
 * statistics of box plots, histogram bins and a least-squares trend line.
 */

/** A "nice" step (1, 2 or 5 times a power of ten) giving about `target` intervals. */
export function niceStep(span: number, target = 5): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const residual = raw / magnitude;
  const factor = residual < 1.5 ? 1 : residual < 3 ? 2 : residual < 7 ? 5 : 10;
  return factor * magnitude;
}

/** Removes the float dust of k * step. */
function clean(value: number): number {
  const out = Number(value.toPrecision(12));
  return Object.is(out, -0) ? 0 : out;
}

/** Multiples of `step` within [min, max], computed by index so no error accumulates. */
export function ticks(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  if (!(step > 0) || !Number.isFinite(min) || !Number.isFinite(max)) return out;
  const first = Math.ceil(min / step - 1e-9);
  const last = Math.floor(max / step + 1e-9);
  for (let k = first; k <= last && out.length < 50; k++) out.push(clean(k * step));
  return out;
}

/** A tick label with as few digits as the step needs. */
export function tickText(value: number, step: number): string {
  if (value === 0) return '0';
  const digits = Math.max(0, Math.min(8, -Math.floor(Math.log10(step) + 1e-9)));
  const text = value.toFixed(digits);
  return digits > 0 ? text.replace(/\.?0+$/, '') : text;
}

export interface NiceRange {
  readonly lo: number;
  readonly hi: number;
  readonly step: number;
}

/** A range that covers [min, max] and ends on nice ticks; from zero when `fromZero`. */
export function niceRange(min: number, max: number, fromZero: boolean, target = 5): NiceRange {
  let lo = Number.isFinite(min) ? min : 0;
  let hi = Number.isFinite(max) ? max : 1;
  if (lo > hi) [lo, hi] = [hi, lo];
  if (fromZero) {
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  }
  if (lo === hi) {
    // One value (from zero, that can only be zero): give it room around itself.
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.5;
    if (lo === 0) hi = pad;
    else {
      lo -= pad;
      hi += pad;
    }
  }
  const step = niceStep(hi - lo, target);
  return { lo: clean(Math.floor(lo / step + 1e-9) * step), hi: clean(Math.ceil(hi / step - 1e-9) * step), step };
}

/** The p-quantile of sorted values, interpolating linearly between ranks. */
export function quantile(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const position = (n - 1) * Math.min(1, Math.max(0, p));
  const i = Math.floor(position);
  const k = position - i;
  return i + 1 < n ? sorted[i]! + (sorted[i + 1]! - sorted[i]!) * k : sorted[i]!;
}

export interface BoxStats {
  readonly n: number;
  readonly q1: number;
  readonly median: number;
  readonly q3: number;
  /** Ends of the whiskers: the furthest samples within 1.5 interquartile ranges of the box. */
  readonly low: number;
  readonly high: number;
  readonly outliers: readonly number[];
}

export function boxStats(samples: readonly number[]): BoxStats | null {
  const sorted = samples.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const q1 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  const reach = 1.5 * (q3 - q1);
  const inside = sorted.filter((v) => v >= q1 - reach && v <= q3 + reach);
  return {
    n: sorted.length,
    q1,
    median,
    q3,
    low: inside[0] ?? q1,
    high: inside[inside.length - 1] ?? q3,
    outliers: sorted.filter((v) => v < q1 - reach || v > q3 + reach),
  };
}

/** Counts of samples in `bins` equal bins over [lo, hi]; the last bin includes hi. */
export function binCounts(samples: readonly number[], lo: number, hi: number, bins: number): number[] {
  const counts: number[] = new Array<number>(bins).fill(0);
  const width = (hi - lo) / bins;
  if (!(width > 0)) return counts;
  for (const v of samples) {
    if (!Number.isFinite(v) || v < lo || v > hi) continue;
    const index = v === hi ? bins - 1 : Math.min(bins - 1, Math.floor((v - lo) / width));
    counts[index]!++;
  }
  return counts;
}

export interface Trend {
  readonly slope: number;
  readonly intercept: number;
  /** Pearson's correlation coefficient. */
  readonly r: number;
}

/** The least-squares line through the points, or null when x does not vary. */
export function regression(points: ReadonlyArray<Vec2>): Trend | null {
  const finite = points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const n = finite.length;
  if (n < 2) return null;
  let mx = 0;
  let my = 0;
  for (const [x, y] of finite) {
    mx += x;
    my += y;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of finite) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
    syy += (y - my) ** 2;
  }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r: syy > 0 ? sxy / Math.sqrt(sxx * syy) : 1 };
}

/** A value for reading: whole numbers as they are, others to a sensible number of decimals. */
export function valueText(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const size = Math.abs(value);
  const digits = size >= 100 ? 0 : size >= 10 ? 1 : size >= 1 ? 2 : 3;
  const text = value.toFixed(digits).replace(/\.0+$|(\.\d*?)0+$/, '$1');
  return text === '-0' ? '0' : text;
}
