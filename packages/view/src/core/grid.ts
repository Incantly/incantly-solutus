/**
 * Grid and axes (graphics-view design 5): automatic spacing with hysteresis,
 * tick formatting, label thinning, polar and isometric grids. Pure functions
 * over numbers; the back-ends draw the resulting lines.
 */
import type { Maths, MathsRect } from './coords';
import { maths } from './coords';

export type GridKind = 'major' | 'minor' | 'polar' | 'iso';
export type AxesWhich = 'on' | 'off' | 'x' | 'y';
export type AxisUnit = { readonly k: 'unit' } | { readonly k: 'pi' };

export interface GridSpec {
  readonly on: boolean;
  readonly kind: GridKind;
  /** Fixed spacing in maths units, or null for automatic. */
  readonly step: number | null;
  readonly polarSpokesDeg: number;
}

export const DEFAULT_GRID: GridSpec = { on: true, kind: 'major', step: null, polarSpokesDeg: 30 };

export interface AxesSpec {
  readonly which: AxesWhich;
  readonly labels: boolean;
  readonly unitX: AxisUnit;
  readonly unitY: AxisUnit;
}

export const DEFAULT_AXES: AxesSpec = {
  which: 'on',
  labels: true,
  unitX: { k: 'unit' },
  unitY: { k: 'unit' },
};

/** Spacing targets in px (design 5): about 80, within [45, 160]. */
export const GRID_TARGET_PX = 80;
export const GRID_MIN_PX = 45;
export const GRID_MAX_PX = 160;

export interface StepChoice {
  readonly step: number;
  /** Minor sub-interval count (4 or 5) for `minor` grids. */
  readonly minor: number;
}

function decimalStep(raw: number): StepChoice {
  const mag = 10 ** Math.floor(Math.log10(raw));
  const m = raw / mag;
  const base = m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10;
  return { step: mag * base, minor: base === 2 ? 4 : 5 };
}

/** Documented pi steps (design 5 step 5): pi/6, pi/4, pi/3, pi/2, pi, 2pi, then doubling. */
const PI_FRACTIONS = [1 / 6, 1 / 4, 1 / 3, 1 / 2, 1, 2];

function piStep(raw: number): StepChoice {
  const lowest = (PI_FRACTIONS[0] ?? 1 / 6) * Math.PI;
  if (raw < lowest * 0.75) {
    // Finer than pi/6 is outside the documented list: use decimal fractions of pi.
    const d = decimalStep(raw / Math.PI);
    return { step: d.step * Math.PI, minor: d.minor };
  }
  const candidates = PI_FRACTIONS.map((f) => f * Math.PI);
  let top = (PI_FRACTIONS[PI_FRACTIONS.length - 1] ?? 2) * Math.PI;
  while (top < raw) {
    top *= 2;
    candidates.push(top);
  }
  let best = candidates[0] ?? Math.PI;
  let bestErr = Infinity;
  for (const c of candidates) {
    const err = Math.abs(Math.log(raw / c));
    if (err < bestErr) {
      bestErr = err;
      best = c;
    }
  }
  return { step: best, minor: 4 };
}

/**
 * Choose the major spacing for one axis. When `prev` is given and still maps
 * into [45, 160] px, it is kept, so zooming does not flicker between steps.
 */
export function chooseStep(scalePxPerUnit: number, unit: AxisUnit, prev: number | null, fixed: number | null): StepChoice {
  if (fixed !== null && fixed > 0 && Number.isFinite(fixed)) {
    return { step: fixed, minor: 5 };
  }
  if (prev !== null && prev > 0 && Number.isFinite(prev)) {
    const spacing = prev * scalePxPerUnit;
    if (spacing >= GRID_MIN_PX && spacing <= GRID_MAX_PX) {
      return unit.k === 'pi' ? { step: prev, minor: 4 } : decimalStep(prev * scalePxPerUnit / scalePxPerUnit);
    }
  }
  const raw = GRID_TARGET_PX / scalePxPerUnit;
  if (!Number.isFinite(raw) || raw <= 0) return { step: 1, minor: 5 };
  return unit.k === 'pi' ? piStep(raw) : decimalStep(raw);
}

/** Multiples of the step covering [lo, hi]. */
export function tickPositions(lo: number, hi: number, step: number): number[] {
  if (!(step > 0) || !Number.isFinite(step)) return [];
  const out: number[] = [];
  const first = Math.ceil(lo / step - 1e-9) * step;
  for (let v = first; v <= hi * (1 + 1e-12); v += step) {
    // Round to the step's own precision so 0.30000000004 prints as 0.3.
    const q = Math.round(v / step) * step;
    out.push(q);
    if (out.length > 100000) break;
  }
  return out;
}

/** Fewest digits that distinguish neighbouring ticks (design 5). */
export function formatTick(v: number, step: number, pi: boolean): string {
  if (Object.is(v, -0)) v = 0;
  if (pi) return formatPiMultiple(v);
  const a = Math.abs(v);
  if (v !== 0 && (a >= 1e6 || a < 1e-4)) return trimExp(v);
  const digits = Math.max(0, Math.ceil(-Math.log10(step)));
  const rounded = Number(v.toFixed(Math.min(digits, 12)));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function trimExp(v: number): string {
  const s = v.toExponential(6);
  return s.replace(/(\.\d*?)0+e/, '$1e').replace(/\.e/, 'e');
}

function formatPiMultiple(v: number): string {
  if (v === 0) return '0';
  const k = v / Math.PI;
  const near = Math.round(k * 12) / 12;
  if (Math.abs(k - near) > 1e-9) return trimExp(v);
  const num = Math.round(near * 12);
  const den = 12 / gcd(Math.abs(num), 12);
  const n = num / (12 / den);
  if (den === 1) {
    if (n === 1) return 'π';
    if (n === -1) return '-π';
    return `${n}π`;
  }
  if (n === 1) return `π/${den}`;
  if (n === -1) return `-π/${den}`;
  return `${n}π/${den}`;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y > 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x === 0 ? 1 : x;
}

export interface AxisLabel {
  /** Maths position along the axis. */
  readonly at: number;
  readonly text: string;
  /** Measured width in px, filled by the caller for thinning. */
  readonly widthPx: number;
}

/**
 * Build labels for one axis, then thin: if two labels would overlap by
 * measured width, drop every second label (design 5). Returns kept labels.
 */
export function thinLabels(sorted: readonly AxisLabel[]): AxisLabel[] {
  if (sorted.length < 2) return [...sorted];
  let overlap = false;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev === undefined || cur === undefined) continue;
    // Positions are in maths units; widths in px. The caller passes positions
    // converted to px so this comparison is in one space.
    if (cur.at - prev.at < (prev.widthPx + cur.widthPx) / 2) {
      overlap = true;
      break;
    }
  }
  if (!overlap) return [...sorted];
  return sorted.filter((_, i) => i % 2 === 0);
}

/** Labels for both axes; the origin prints one `0`, never two (design 5). */
export function axisLabels(
  bounds: MathsRect,
  stepX: number,
  stepY: number,
  unitX: AxisUnit,
  unitY: AxisUnit,
): { readonly x: readonly AxisLabel[]; readonly y: readonly AxisLabel[] } {
  const xs = tickPositions(bounds.x0 as number, bounds.x1 as number, stepX).map((at) => ({
    at,
    text: formatTick(at, stepX, unitX.k === 'pi'),
    widthPx: 0,
  }));
  const ys = tickPositions(bounds.y0 as number, bounds.y1 as number, stepY)
    .filter((at) => at !== 0 || !xs.some((l) => l.at === 0))
    .map((at) => ({ at, text: formatTick(at, stepY, unitY.k === 'pi'), widthPx: 0 }));
  return { x: xs, y: ys };
}

/**
 * Pin an axis label position to the canvas when its axis is near the edge
 * (design 5). Returns the clamped px and whether it was pinned.
 */
export function pinToEdge(posPx: number, sizePx: number, marginPx: number): { pos: number; pinned: boolean } {
  if (posPx < marginPx) return { pos: marginPx, pinned: true };
  if (posPx > sizePx - marginPx) return { pos: sizePx - marginPx, pinned: true };
  return { pos: posPx, pinned: false };
}

export interface CartesianGrid {
  readonly vertical: readonly number[];
  readonly horizontal: readonly number[];
  readonly minorVertical: readonly number[];
  readonly minorHorizontal: readonly number[];
}

export function cartesianGrid(bounds: MathsRect, stepX: StepChoice, stepY: StepChoice, minor: boolean): CartesianGrid {
  const vertical = tickPositions(bounds.x0 as number, bounds.x1 as number, stepX.step);
  const horizontal = tickPositions(bounds.y0 as number, bounds.y1 as number, stepY.step);
  if (!minor) return { vertical, horizontal, minorVertical: [], minorHorizontal: [] };
  const minorVertical = tickPositions(bounds.x0 as number, bounds.x1 as number, stepX.step / stepX.minor);
  const minorHorizontal = tickPositions(bounds.y0 as number, bounds.y1 as number, stepY.step / stepY.minor);
  return { vertical, horizontal, minorVertical, minorHorizontal };
}

export interface PolarGrid {
  /** Circle radii in maths units. */
  readonly circles: readonly number[];
  /** Spoke angles in radians. */
  readonly spokes: readonly number[];
}

export function polarGrid(bounds: MathsRect, step: number, spokesDeg: number): PolarGrid {
  const extent = Math.max(
    Math.abs(bounds.x0 as number), Math.abs(bounds.x1 as number),
    Math.abs(bounds.y0 as number), Math.abs(bounds.y1 as number),
  );
  const circles: number[] = [];
  for (let r = step; r <= extent * Math.SQRT2 + step / 2; r += step) circles.push(r);
  const spokes: number[] = [];
  const n = Math.max(1, Math.round(360 / Math.max(spokesDeg, 1)));
  for (let i = 0; i < n; i++) spokes.push((i * 2 * Math.PI) / n);
  return { circles, spokes };
}

/** Isometric grid: line offsets along the three directions 0/60/120 deg. */
export interface IsoGrid {
  readonly offsets0: readonly number[];
  readonly offsets60: readonly number[];
  readonly offsets120: readonly number[];
}

export function isoGrid(bounds: MathsRect, step: number): IsoGrid {
  const lo = Math.min(bounds.x0 as number, bounds.y0 as number) - (bounds.x1 as number) - (bounds.y1 as number);
  const hi = -lo;
  const offs = tickPositions(lo, hi, step);
  return { offsets0: offs, offsets60: [...offs], offsets120: [...offs] };
}

/** Maths point helper for grid geometry built by callers. */
export function m(x: number, y: number): { x: Maths; y: Maths } {
  return { x: maths(x), y: maths(y) };
}
