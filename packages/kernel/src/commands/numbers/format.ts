/**
 * Number text (numbers-sliders/design.md 3.5): display-only formatting.
 *
 * Rounding happens on the decimal expansion of the double (exact BigInt digit
 * arithmetic, half away from zero), never on the binary value, so 1.005 with two
 * decimals prints 1.01. Maths never reads any of this.
 */

import type { Figure } from '../../graph/figure';
import type { Name, ObjId } from '../../contracts/values';
import type { AngleUnit, NumberDisplay } from './types';
import { unitScale } from './commit';
import { inferUnitFromDefinition } from './props';

export const DASH = '–';
export const DEGREE = '°';
const THIN_SPACE = ' ';
const SUPERSCRIPT: Readonly<Record<string, string>> = {
  '-': '⁻',
  0: '⁰',
  1: '¹',
  2: '²',
  3: '³',
  4: '⁴',
  5: '⁵',
  6: '⁶',
  7: '⁷',
  8: '⁸',
  9: '⁹',
};

/* ------------------------------ decimal arithmetic ------------------------------ */

interface Decimal {
  /** Absolute digit string without leading zeros ('0' for zero). */
  readonly digits: string;
  /** Value = sign * 0.digits * 10^exp. */
  readonly exp: number;
  readonly sign: -1 | 1;
}

function toDecimal(x: number): Decimal {
  if (x === 0) return { digits: '0', exp: 0, sign: 1 };
  const sign: -1 | 1 = x < 0 ? -1 : 1;
  const s = String(Math.abs(x));
  const e = s.indexOf('e');
  const mantissa = e < 0 ? s : s.slice(0, e);
  const exp10 = e < 0 ? 0 : Number(s.slice(e + 1));
  const dot = mantissa.indexOf('.');
  const intPart = dot < 0 ? mantissa : mantissa.slice(0, dot);
  const fracPart = dot < 0 ? '' : mantissa.slice(dot + 1);
  const stripped = (intPart + fracPart).replace(/^0+/, '');
  if (stripped === '') return { digits: '0', exp: 0, sign: 1 };
  return { digits: stripped, exp: exp10 - fracPart.length + stripped.length, sign };
}

function divRound(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  return r * 2n >= den ? q + 1n : q;
}

/** Round half away from zero to n decimals: value = r * 10^-n, r >= 0. */
function roundDecimals(d: Decimal, n: number): { r: bigint; n: number; sign: -1 | 1 } {
  if (d.digits === '0') return { r: 0n, n, sign: 1 };
  const q = d.exp - d.digits.length + n;
  const int = BigInt(d.digits);
  const r = q >= 0 ? int * 10n ** BigInt(q) : divRound(int, 10n ** BigInt(-q));
  return { r, n, sign: r === 0n ? 1 : d.sign };
}

function renderRounded(t: { r: bigint; n: number; sign: -1 | 1 }, trim: boolean): string {
  let s = t.r.toString();
  while (s.length < t.n + 1) s = '0' + s;
  const int = t.n === 0 ? s : s.slice(0, s.length - t.n);
  let out = t.n === 0 ? int : `${int}.${s.slice(s.length - t.n)}`;
  if (trim && out.includes('.')) {
    out = out.replace(/\.?0+$/, '');
    if (out === '') out = '0';
  }
  return (t.sign < 0 ? '-' : '') + out;
}

/** Round to n significant digits: value = sign * 0.digits * 10^exp. */
function roundSig(d: Decimal, n: number): { digits: string; exp: number; sign: -1 | 1 } {
  if (d.digits === '0' || n <= 0) return { digits: '0', exp: 0, sign: 1 };
  if (d.digits.length <= n) return { digits: d.digits, exp: d.exp, sign: d.sign };
  const head = BigInt(d.digits.slice(0, n));
  const tailLen = d.digits.length - n;
  const tail = BigInt(d.digits.slice(n));
  const r = tail * 2n >= 10n ** BigInt(tailLen) ? head + 1n : head;
  let digits = r.toString();
  let exp = d.exp;
  if (digits.length > n) {
    digits = '1' + '0'.repeat(n - 1);
    exp += 1;
  }
  return { digits, exp, sign: d.sign };
}

/** Plain rendering of a rounded significant-digit value (never needs division). */
function sigToRounded(r: { digits: string; exp: number; sign: -1 | 1 }, n: number): { r: bigint; n: number; sign: -1 | 1 } {
  if (r.digits === '0') return { r: 0n, n: 0, sign: 1 };
  const e = r.exp - 1;
  const decimals = Math.max(0, n - 1 - e);
  const q = r.exp - r.digits.length + decimals;
  return { r: BigInt(r.digits) * 10n ** BigInt(Math.max(0, q)), n: decimals, sign: r.sign };
}

function renderScientific(r: { digits: string; exp: number; sign: -1 | 1 }, trim: boolean, aural: boolean): string {
  if (r.digits === '0') return '0';
  const e = r.exp - 1;
  let mantissa = r.digits[0] as string;
  const rest = r.digits.slice(1);
  if (rest !== '' && !(trim && /^[0]+$/.test(rest))) {
    mantissa += `.${trim ? rest.replace(/0+$/, '') : rest}`;
    if (mantissa.endsWith('.')) mantissa = mantissa.slice(0, -1);
  }
  const sign = r.sign < 0 ? '-' : '';
  if (aural) return `${sign}${mantissa}e${e}`;
  const sup = String(e)
    .split('')
    .map((c) => SUPERSCRIPT[c] ?? c)
    .join('');
  return `${sign}${mantissa}×10${sup}`;
}

function unitSuffix(unit: AngleUnit | 'none'): string {
  switch (unit) {
    case 'deg':
      return DEGREE;
    case 'rad':
      return `${THIN_SPACE}rad`;
    case 'turn':
      return `${THIN_SPACE}turn`;
    case 'grad':
      return `${THIN_SPACE}grad`;
    default:
      return '';
  }
}

function unitWord(unit: AngleUnit | 'none'): string {
  switch (unit) {
    case 'deg':
      return ' degrees';
    case 'rad':
      return ' radians';
    case 'turn':
      return ' turns';
    case 'grad':
      return ' gradians';
    default:
      return '';
  }
}

/* ------------------------------ main entry points ------------------------------ */

function displayValue(x: number, unit: AngleUnit | 'none'): number {
  const scale = unitScale(unit);
  if (scale === 1) return x;
  const u = x / scale;
  // Repair the 1-ulp conversion noise (commit caps its repair at 12 decimals too),
  // so 30deg with digits = 15 prints 30, not 29.999999999999996.
  return Number(u.toFixed(12));
}

/**
 * Format a number for the readout, the screen and exports (3.5). Undefined
 * prints as a dash; non-finite input falls back to ∞/-∞/dash (callers are
 * expected to produce undefined with `not_finite` instead).
 */
export function formatDisplayNumber(x: number | undefined, display: NumberDisplay): string {
  if (x === undefined) return DASH;
  if (typeof x !== 'number' || Number.isNaN(x)) return DASH;
  if (!Number.isFinite(x)) return (x > 0 ? '' : '-') + '∞';
  const u = displayValue(x, display.unit);
  const f = display.format;
  if (f.mode === 'decimals') {
    const n = Math.max(0, Math.min(15, Math.floor(f.n)));
    return renderRounded(roundDecimals(toDecimal(u), n), display.trim) + unitSuffix(display.unit);
  }
  if (f.mode === 'sig') {
    const n = Math.max(1, Math.min(15, Math.floor(f.n)));
    const r = roundSig(toDecimal(u), n);
    if (r.digits === '0') return '0' + unitSuffix(display.unit);
    const e = r.exp - 1;
    if (e >= 9 || e <= -7) return renderScientific(r, display.trim, false) + unitSuffix(display.unit);
    return renderRounded(sigToRounded(r, n), display.trim) + unitSuffix(display.unit);
  }
  const a = Math.abs(u);
  if (a !== 0 && (a >= 1e9 || a < 1e-6)) {
    return renderScientific(roundSig(toDecimal(u), 6), true, false) + unitSuffix(display.unit);
  }
  return renderRounded(roundDecimals(toDecimal(u), 3), true) + unitSuffix(display.unit);
}

/** Screen-reader text: same rounding, e-notation, unit words ("30 degrees"). */
export function formatAuralNumber(x: number | undefined, display: NumberDisplay): string {
  if (x === undefined) return 'undefined';
  if (typeof x !== 'number' || Number.isNaN(x)) return 'undefined';
  if (!Number.isFinite(x)) return x > 0 ? 'infinity' : 'minus infinity';
  const u = displayValue(x, display.unit);
  const f = display.format;
  if (f.mode === 'decimals') {
    const n = Math.max(0, Math.min(15, Math.floor(f.n)));
    return renderRounded(roundDecimals(toDecimal(u), n), display.trim) + unitWord(display.unit);
  }
  if (f.mode === 'sig') {
    const n = Math.max(1, Math.min(15, Math.floor(f.n)));
    const r = roundSig(toDecimal(u), n);
    if (r.digits === '0') return '0' + unitWord(display.unit);
    if (e_of(r) >= 9 || e_of(r) <= -7) return renderScientific(r, display.trim, true) + unitWord(display.unit);
    return renderRounded(sigToRounded(r, n), display.trim) + unitWord(display.unit);
  }
  const a = Math.abs(u);
  if (a !== 0 && (a >= 1e9 || a < 1e-6)) {
    return renderScientific(roundSig(toDecimal(u), 6), true, true) + unitWord(display.unit);
  }
  return renderRounded(roundDecimals(toDecimal(u), 3), true) + unitWord(display.unit);
}

function e_of(r: { digits: string; exp: number }): number {
  return r.digits === '0' ? 0 : r.exp - 1;
}

/* ------------------------------ text specs ------------------------------ */

export interface FormatSpec {
  readonly decimals?: number;
  readonly sig?: number;
  readonly unit?: AngleUnit;
}

export const ACCEPTED_SPECS: readonly string[] = ['.N (N decimals)', 'Nsf (N significant figures)', 'deg', 'rad', 'turn', 'grad', '.Ndeg'];

const SPEC_RE = /^(?:\.(\d+))?(?:(\d+)sf)?(deg|rad|turn|grad)?$/;

/**
 * Parse a text format spec (`{expr:.2}`, `{x:3sf}`, `{θ:deg}`, `{θ:.1deg}`).
 * Returns undefined for a bad spec (the caller reports `bad_format`).
 */
export function parseFormatSpec(spec: string): FormatSpec | undefined {
  if (typeof spec !== 'string' || spec === '') return undefined;
  const m = SPEC_RE.exec(spec);
  if (!m || m[0] !== spec) return undefined;
  const dec = m[1] !== undefined ? Number(m[1]) : undefined;
  const sig = m[2] !== undefined ? Number(m[2]) : undefined;
  const unit = (m[3] as AngleUnit | undefined) ?? undefined;
  if (dec === undefined && sig === undefined && unit === undefined) return undefined;
  if (dec !== undefined && (dec < 0 || dec > 15)) return undefined;
  if (sig !== undefined && (sig < 1 || sig > 15)) return undefined;
  return {
    ...(dec !== undefined ? { decimals: dec } : {}),
    ...(sig !== undefined ? { sig } : {}),
    ...(unit !== undefined ? { unit } : {}),
  };
}

/**
 * Format a number under a text spec. The spec's decimals/sig override the base
 * display; the spec's unit (if any) overrides the display unit.
 */
export function formatWithSpec(x: number | undefined, spec: string, base: NumberDisplay): string | undefined {
  const p = parseFormatSpec(spec);
  if (!p) return undefined;
  const display: NumberDisplay = {
    unit: p.unit ?? base.unit,
    format: p.decimals !== undefined ? { mode: 'decimals', n: p.decimals } : p.sig !== undefined ? { mode: 'sig', n: p.sig } : base.format,
    trim: false,
  };
  return formatDisplayNumber(x, display);
}

/* ------------------------------ display resolution ------------------------------ */

export interface FigureDefaults {
  readonly digits?: number;
  readonly sig?: number;
}

const figureDefaults = new WeakMap<Figure, FigureDefaults>();

/**
 * Figure-wide rounding defaults (`@digits 3` / `@sig 4`). The kernel keeps
 * directives as text with no read hook, so the host mirrors them here.
 */
export function setFigureDefaults(figure: Figure, defaults: FigureDefaults): void {
  figureDefaults.set(figure, { ...defaults });
}

function intIn(v: unknown, lo: number, hi: number): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined;
}

/** Resolve the effective display of a Number object: own props, then figure defaults, then auto. */
export function resolveDisplay(figure: Figure, x: Name | ObjId): NumberDisplay {
  const view = figure.get(x);
  const ext = (view?.style.ext ?? {}) as Record<string, unknown>;
  const unitRaw = ext['unit'];
  // An explicit unit always wins; otherwise the definition text is scanned for an
  // angle constant or Angle(...) (the kernel's angle tag is not publicly readable).
  const unit: AngleUnit | 'none' =
    unitRaw === 'rad' || unitRaw === 'deg' || unitRaw === 'turn' || unitRaw === 'grad' || unitRaw === 'none'
      ? unitRaw
      : (inferUnitFromDefinition(view?.definition ?? '') ?? 'none');
  const digits = intIn(ext['digits'], 0, 15);
  const sig = intIn(ext['sig'], 1, 15);
  const trimRaw = ext['trim'];
  const def = figureDefaults.get(figure);
  if (digits !== undefined) {
    return { unit, format: { mode: 'decimals', n: digits }, trim: trimRaw === true };
  }
  if (sig !== undefined) {
    return { unit, format: { mode: 'sig', n: sig }, trim: trimRaw === true };
  }
  const dDigits = def?.digits !== undefined ? intIn(def.digits, 0, 15) : undefined;
  const dSig = def?.sig !== undefined ? intIn(def.sig, 1, 15) : undefined;
  if (dDigits !== undefined) return { unit, format: { mode: 'decimals', n: dDigits }, trim: trimRaw === true };
  if (dSig !== undefined) return { unit, format: { mode: 'sig', n: dSig }, trim: trimRaw === true };
  return { unit, format: { mode: 'auto' }, trim: true };
}

/** Format the current value of a Number object for the readout. */
export function formatObjectNumber(figure: Figure, x: Name | ObjId): string {
  const v = figure.value(x);
  if (typeof v !== 'number') return DASH;
  return formatDisplayNumber(v, resolveDisplay(figure, x));
}
