/**
 * The one commit function for slider writes (numbers-sliders/design.md 3.3).
 *
 * All writes to a slider value (drag, keyboard, typed text, SetValue, redefinition,
 * animation) go through `commit`. Pure: no DOM, no clock, no randomness.
 */

import type { AngleUnit } from './types';
import { NUMBERS_LIMITS } from './types';

/** Radians per display unit. deg/turn/grad match the language constants (deg, tau). */
export function unitScale(unit: AngleUnit | 'none'): number {
  switch (unit) {
    case 'deg':
      return Math.PI / 180;
    case 'turn':
      return 2 * Math.PI;
    case 'grad':
      return Math.PI / 200;
    default:
      return 1;
  }
}

/**
 * Length of the shortest decimal string that reads back to x. String(x) is that
 * string in JavaScript; an exponent shifts the decimal count.
 */
export function decimals(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x === 0) return 0;
  const s = String(Math.abs(x));
  const e = s.indexOf('e');
  if (e < 0) {
    const dot = s.indexOf('.');
    return dot < 0 ? 0 : s.length - dot - 1;
  }
  const mantissa = s.slice(0, e);
  const dot = mantissa.indexOf('.');
  const mantissaDecimals = dot < 0 ? 0 : mantissa.length - dot - 1;
  const exp = Number(s.slice(e + 1));
  return Math.max(0, mantissaDecimals - exp);
}

/** Nearest of 1, 2, 5 times a power of ten. Boundaries at 1.5, 3.5, 7.5. */
export function nice(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 1;
  const e = Math.floor(Math.log10(x));
  const m = x / 10 ** e;
  const c = m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10;
  return c * 10 ** e;
}

/** Automatic step in display-unit space: nice((hi - lo) / 100). */
export function autoStep(lo: number, hi: number): number {
  return nice((hi - lo) / 100);
}

const roundHalfAway = (x: number): number => (x < 0 ? -Math.floor(-x + 0.5) : Math.floor(x + 0.5));

export type CommitSource = 'drag' | 'keyboard' | 'typed' | 'setValue' | 'redefine' | 'animation' | 'api';

export interface CommitOpts {
  /** Bounds in stored units (radians for angles). Undefined while a bound rule is undefined. */
  readonly lo: number | undefined;
  readonly hi: number | undefined;
  /** Fixed step in stored units, 'auto', or undefined while a step rule is undefined. */
  readonly step: number | 'auto' | undefined;
  readonly unit: AngleUnit | 'none';
  readonly source: CommitSource;
}

export type CommitResult =
  | {
      readonly ok: true;
      readonly value: number;
      readonly clamped: { readonly from: number; readonly to: number } | null;
      readonly snapped: { readonly from: number; readonly to: number } | null;
      /** The step the value was snapped to, or 'continuous' when no snapping applied. */
      readonly stepUsed: number | 'continuous';
      /** True while the step rule is undefined (auto is used instead). */
      readonly stepFallback: boolean;
      /** True when |value| / step exceeds 2^52: clamped, not snapped. */
      readonly belowPrecision: boolean;
      /** True when |x| > 2^40 * unitScale: angle precision may be lost. */
      readonly precisionLoss: boolean;
    }
  | { readonly ok: false; readonly reason: 'not_finite' | 'empty_range' | 'range_undefined'; readonly detail?: string };

/**
 * Clamp, snap and repair one raw write (3.3 steps 1-6). Never throws.
 *
 * - A non-finite raw value is undefined with `not_finite`, never silently 0.
 * - Snapping works in display-unit space from the minimum; the top end is a
 *   candidate too, so it stays reachable when the step does not divide the range
 *   (an exact tie picks the top end).
 * - With `step = 'auto'`, dragging and keyboard snap to the nice step; typed
 *   values, SetValue and animation stay continuous (only clamped).
 */
export function commit(raw: number, opts: CommitOpts): CommitResult {
  const { lo, hi, unit, source } = opts;
  let step = opts.step;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { ok: false, reason: 'not_finite', detail: `cannot store ${String(raw)}` };
  }
  if (lo === undefined || hi === undefined || !Number.isFinite(lo) || !Number.isFinite(hi)) {
    return { ok: false, reason: 'range_undefined' };
  }
  if (!(lo < hi)) return { ok: false, reason: 'empty_range', detail: `${lo}..${hi} is empty` };
  let stepFallback = false;
  if (step === undefined || (typeof step === 'number' && !Number.isFinite(step))) {
    step = 'auto';
    stepFallback = true;
  }
  if (typeof step === 'number' && !(step > 0)) {
    return { ok: false, reason: 'range_undefined', detail: 'the step is not above zero' };
  }
  const scale = unitScale(unit);
  const clampedFrom = raw;
  const clampedRaw = Math.min(hi, Math.max(lo, raw));
  const clamped = clampedRaw !== raw ? { from: clampedFrom, to: clampedRaw } : null;

  const auto = step === 'auto';
  const continuous = auto && (source === 'typed' || source === 'setValue' || source === 'redefine' || source === 'animation' || source === 'api');
  const ustepStored = auto ? autoStep(lo / scale, hi / scale) * scale : (step as number);
  const useStep = continuous ? null : (ustepStored as number);

  if (useStep === null) {
    return {
      ok: true,
      value: clampedRaw,
      clamped,
      snapped: null,
      stepUsed: 'continuous',
      stepFallback,
      belowPrecision: false,
      precisionLoss: Math.abs(clampedRaw) > 2 ** 40 * scale,
    };
  }
  // Quantising below 2^52 steps from the value cannot be exact: clamp only.
  if (Math.abs(clampedRaw) / (useStep as number) > 2 ** 52) {
    return {
      ok: true,
      value: clampedRaw,
      clamped,
      snapped: null,
      stepUsed: useStep as number,
      stepFallback,
      belowPrecision: true,
      precisionLoss: Math.abs(clampedRaw) > 2 ** 40 * scale,
    };
  }
  const u = clampedRaw / scale;
  const ulo = lo / scale;
  const uhi = hi / scale;
  const ustep = (useStep as number) / scale;
  const k0 = roundHalfAway((u - ulo) / ustep);
  let grid = ulo + k0 * ustep;
  if (grid > uhi) grid = ulo + (k0 - 1) * ustep;
  // Candidate set {grid} U {uhi}: the top end wins ties so it stays reachable.
  const nearest = Math.abs(u - uhi) <= Math.abs(u - grid) ? uhi : grid;
  const d = Math.min(12, Math.max(decimals(ustep), decimals(ulo), 0));
  const repaired = Number(nearest.toFixed(d));
  // v * unitScale, where unitScale is the same double the language constant uses,
  // so 30deg commits to exactly the double the literal 30deg holds.
  const value = repaired * scale;
  const snapped = value !== clampedRaw ? { from: clampedRaw, to: value } : null;
  return {
    ok: true,
    value,
    clamped,
    snapped,
    stepUsed: useStep as number,
    stepFallback,
    belowPrecision: false,
    precisionLoss: Math.abs(value) > 2 ** 40 * scale,
  };
}

export interface RangeCheck {
  readonly ok: boolean;
  readonly kind?: 'bad_range' | 'limit';
  /** Machine-readable detail for the message and hints. */
  readonly why?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly limit?: number;
  readonly actual?: number;
}

/**
 * Line-time check of constant slider bounds (3.3 limits, errors.md): min < max,
 * finite, a step above zero and at least 1e-12 of the range, at most 10^6 steps.
 * Dynamic (rule) bounds are checked at run time by `commit` instead.
 */
export function validateSliderRange(lo: number, hi: number, step: number | 'auto' | undefined): RangeCheck {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    return { ok: false, kind: 'bad_range', why: 'finite', min: lo, max: hi };
  }
  if (!(lo < hi)) return { ok: false, kind: 'bad_range', why: 'empty', min: lo, max: hi };
  if (step === undefined || step === 'auto') return { ok: true };
  if (!Number.isFinite(step) || !(step > 0)) {
    return { ok: false, kind: 'bad_range', why: 'step', min: lo, max: hi, step };
  }
  if (step < (hi - lo) * NUMBERS_LIMITS.minStepOfRange) {
    return { ok: false, kind: 'bad_range', why: 'tiny', min: lo, max: hi, step };
  }
  const count = (hi - lo) / step;
  if (count > NUMBERS_LIMITS.sliderSteps) {
    return { ok: false, kind: 'limit', why: 'steps', min: lo, max: hi, step, limit: NUMBERS_LIMITS.sliderSteps, actual: count };
  }
  return { ok: true };
}
