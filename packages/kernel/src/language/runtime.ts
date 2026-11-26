/**
 * The evaluation environment and runtime value shapes that compiled formulas work with
 * (docs/features/language/design.md 3.15). Compiled closures never throw: a problem makes the
 * value undefined (NaN for Numbers, `undefined` for everything else) and records a reason on `env`.
 */
import type { ObjId, Pt, UndefReason } from '../contracts/values';

/** Shapes follow docs/features/kernel/design.md section 4.2 (without the `t` tag). */
export interface SegmentValue { readonly a: Pt; readonly b: Pt }
export interface RayValue { readonly from: Pt; readonly dir: Pt }
export interface LineValue { readonly a: number; readonly b: number; readonly c: number }
export interface CircleValue { readonly cx: number; readonly cy: number; readonly r: number }
export interface ArcValue { readonly cx: number; readonly cy: number; readonly r: number; readonly from: number; readonly to: number }
export interface PolygonValue { readonly pts: readonly Pt[] }
export interface ColorValue { readonly r: number; readonly g: number; readonly b: number; readonly a: number }

/** A compiled function of 1 to 4 numbers. Calling it never throws. */
export interface FunctionValue {
  readonly arity: number;
  /** `'Bool'` for a predicate (`p(x) = x^2 > 4`). */
  readonly ret: 'Number' | 'Point' | 'Bool';
  /** Returns NaN (Number) or undefined (Point, Bool) when undefined; `reason` then tells why. A predicate returns a boolean. */
  call(...xs: number[]): number | Pt | boolean | undefined;
  /** Fast path for one-variable Number functions. */
  call1?(x: number): number;
  /** Reason of the last undefined result of this function. */
  reason?: UndefReason | undefined;
  /** The predicate body was proved true at every real input. */
  readonly identicallyTrue?: true;
  /** Batch form for the plotter. Writes NaN for undefined samples. */
  batch?(xs: Float64Array, out: Float64Array): void;
}

/** A relation in x and y (`x^2 + y^2 == 4`, `y < x`). */
export interface RelationValue {
  readonly ops: readonly string[];
  /** lhs - rhs of the first comparison; NaN when undefined. */
  readonly residual: (x: number, y: number) => number;
  /** Whether the point satisfies every comparison (equalities within tolerance). */
  readonly test: (x: number, y: number) => boolean | undefined;
  /** Polynomial coefficients of the first comparison, when it is a polynomial of degree <= 2. */
  readonly poly?: { readonly xx: number; readonly xy: number; readonly yy: number; readonly x: number; readonly y: number; readonly c: number } | undefined;
  /** Proved true at every real x and y. `residual` and `test` are unchanged. */
  readonly identicallyTrue?: true;
}

export type RuntimeValue =
  | number
  | boolean
  | string
  | Pt
  | SegmentValue
  | RayValue
  | LineValue
  | CircleValue
  | ArcValue
  | PolygonValue
  | ColorValue
  | FunctionValue
  | RelationValue
  | readonly unknown[]
  | Float64Array
  | undefined;

/**
 * One `Env` may evaluate several compiled lines (the flat environment of design 3.15). Function and relation values write
 * their parameters into `locals` only for the length of a call and put back what was there, so a call into one line never
 * changes the locals another line is using. `reason`, `cause` and `detail` describe the evaluation in progress: call
 * `evaluate` (or `resetEnv`) between two top-level evaluations.
 */
export interface Env {
  /** Film time in seconds. */
  t: number;
  /** Seconds since the current beat began. */
  bt: number;
  /** Index of the current beat. */
  beat: number;
  /** The first undefined reason set during this evaluation. Reset with `resetEnv`. */
  reason: UndefReason | undefined;
  /** The input object that was already undefined, when the reason is `input_undefined`. */
  cause: ObjId | undefined;
  /** Short plain fact for the reason, such as `sqrt(-4)`. */
  detail: string | undefined;
  /** The figure this environment belongs to, for an area's field reader (`a.min` reads the slider's range from it). */
  host?: unknown;
  /** Longest list a rule may build (the host's `listSize`); 100,000 when not set. */
  maxList?: number;
  /** Slot-addressed locals: function parameters, binders, particle names. */
  locals: unknown[];
  /** Current value of an object. `undefined` when the object is undefined. */
  read(id: ObjId): unknown;
}

export interface EnvInit {
  t?: number;
  bt?: number;
  beat?: number;
  read?: (id: ObjId) => unknown;
  slots?: number;
}

export function createEnv(init: EnvInit = {}): Env {
  return {
    t: init.t ?? 0,
    bt: init.bt ?? 0,
    beat: init.beat ?? 0,
    reason: undefined,
    cause: undefined,
    detail: undefined,
    locals: new Array<unknown>(init.slots ?? 8).fill(undefined),
    read: init.read ?? ((): unknown => undefined),
  };
}

export function resetEnv(env: Env): void {
  env.reason = undefined;
  env.cause = undefined;
  env.detail = undefined;
}

/** Record why a value is undefined. The first reason set in an evaluation wins. */
export function fail(env: Env, reason: UndefReason, detail?: string): void {
  if (env.reason === undefined) {
    env.reason = reason;
    if (detail !== undefined) env.detail = detail;
  }
}

/* ------------------------------- formatting ------------------------------- */

/** Up to `sig` significant digits, trailing zeros removed. */
export function formatNumber(v: number, fmt?: string): string {
  if (Number.isNaN(v)) return 'undefined';
  if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf';
  if (fmt === undefined) return trim(v.toPrecision(6));
  // a finite number whose scaled value overflows is undefined, as in arithmetic (it never prints the word "Infinity")
  if (fmt === 'd' || fmt === '%') {
    const scaled = fmt === 'd' ? (v * 180) / Math.PI : v * 100;
    return Number.isFinite(scaled) ? trim(scaled.toFixed(2)) + (fmt === 'd' ? '°' : '%') : 'undefined';
  }
  if (fmt === 'f' || fmt === 'frac') return toFraction(v);
  // the text area's names (text-logic design 2.3)
  const named = /^(deg|pct|sci)(\d*)$/.exec(fmt);
  if (named) {
    const kind = named[1];
    const digits = named[2] === '' ? undefined : Math.min(20, Number(named[2]));
    if (kind === 'deg') {
      const s = (v * 180) / Math.PI;
      return Number.isFinite(s) ? `${fixedHalfAway(s, digits ?? 0)}°` : 'undefined';
    }
    if (kind === 'pct') {
      const s = v * 100;
      return Number.isFinite(s) ? `${digits === undefined ? trim(s.toPrecision(6)) : fixedHalfAway(s, digits)}%` : 'undefined';
    }
    return sciText(v, digits ?? 3);
  }
  if (fmt === 'ord') return Number.isInteger(v) && v >= 0 ? ordinalText(v) : 'undefined';
  const sf = /^(\d+)sf$/.exec(fmt);
  if (fmt.startsWith('.') || sf) {
    const n = Math.max(1, Math.min(21, Number(sf ? sf[1] : fmt.slice(1))));
    return trim(v.toPrecision(n));
  }
  const d = Math.max(0, Math.min(20, Number(fmt)));
  return fixedHalfAway(v, d);
}

/**
 * `d` decimals, half away from zero on the shortest decimal that names the double (text-logic design 2.3): `1.005`
 * with 2 decimals is `1.01`, as a learner expects, though the double is a little below 1.005. Never `-0.00`.
 */
export function fixedHalfAway(v: number, d: number): string {
  if (!Number.isFinite(v)) return v !== v ? 'undefined' : v > 0 ? 'inf' : '-inf';
  // at 1e21 and above every double is a whole number and JavaScript prints an exponent: keep that form
  if (Math.abs(v) >= 1e21) return v.toFixed(d);
  const neg = v < 0;
  const a = Math.abs(v);
  // the shortest decimal: JavaScript's own printing gives it; expand an exponent form into plain digits
  let s = String(a);
  if (/e/i.test(s)) {
    const [m, e] = s.split(/e/i) as [string, string];
    const exp = Number(e);
    const [ip, fp = ''] = m.split('.') as [string, string?];
    const digits = ip + fp;
    const point = ip.length + exp;
    s = point <= 0 ? `0.${'0'.repeat(-point)}${digits}` : point >= digits.length ? digits + '0'.repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  const [ip, fp = ''] = s.split('.') as [string, string?];
  let intDigits = ip;
  let frac = fp.padEnd(d + 1, '0');
  const roundUp = Number(frac[d] ?? '0') >= 5;
  frac = frac.slice(0, d);
  if (roundUp) {
    // add one at the last kept place, carrying through the fraction and the integer part
    const all = (intDigits + frac).split('').map(Number);
    let k = all.length - 1;
    while (k >= 0) {
      if ((all[k] as number) < 9) {
        all[k] = (all[k] as number) + 1;
        break;
      }
      all[k] = 0;
      k--;
    }
    let joined = all.join('');
    if (k < 0) joined = `1${joined}`;
    intDigits = joined.slice(0, joined.length - d);
    frac = joined.slice(joined.length - d);
  }
  const out = d > 0 ? `${intDigits}.${frac}` : intDigits;
  const zero = /^[0.]*$/.test(out);
  return neg && !zero ? `-${out}` : out;
}

/** `1.23e4` style for plain text: mantissa with `sig` significant figures and a power of ten. */
function sciText(v: number, sig: number): string {
  if (!Number.isFinite(v)) return 'undefined';
  if (v === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(v)));
  let m = v / 10 ** e;
  let ex = e;
  let ms = trim(m.toPrecision(Math.max(1, sig)));
  if (Math.abs(Number(ms)) >= 10) {
    m /= 10;
    ex += 1;
    ms = trim(m.toPrecision(Math.max(1, sig)));
  }
  return `${ms} × 10^${ex}`;
}

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 101st, 111th (English, text-logic design 4.2). */
export function ordinalText(n: number): string {
  const h = n % 100;
  const suffix = h >= 11 && h <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

function trim(s: string): string {
  if (s.includes('e')) {
    const [m, e] = s.split('e') as [string, string];
    const mm = m.includes('.') ? m.replace(/\.?0+$/, '') : m;
    return `${mm}e${e.replace('+', '')}`;
  }
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Nearest fraction with a denominator up to 1000, by continued fractions. */
function toFraction(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const sign = v < 0 ? '-' : '';
  const x = Math.abs(v);
  let h1 = 1;
  let h0 = 0;
  let k1 = 0;
  let k0 = 1;
  let b = x;
  for (let i = 0; i < 20; i++) {
    const a = Math.floor(b);
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    if (k2 > 1000) break;
    h0 = h1;
    h1 = h2;
    k0 = k1;
    k1 = k2;
    if (Math.abs(x - h1 / k1) < 1e-9 * Math.max(1, x)) break;
    const frac = b - a;
    if (frac < 1e-12) break;
    b = 1 / frac;
  }
  return k1 === 1 ? `${sign}${h1}` : `${sign}${h1}/${k1}`;
}

/** An area's text for the values it owns (a matrix, a record); `undefined` leaves the value to the others. */
export type ValueTexter = (v: unknown, depth: number) => string | undefined;
const VALUE_TEXTERS: ValueTexter[] = [];

export function registerValueText(texter: ValueTexter): void {
  if (!VALUE_TEXTERS.includes(texter)) VALUE_TEXTERS.push(texter);
}

/** Compact text of a runtime value, for previews and summaries. */
export function valueText(v: unknown, depth = 0): string {
  if (v === undefined) return 'undefined';
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v) || v instanceof Float64Array) {
    const arr = Array.from(v as ArrayLike<unknown>);
    const shown = arr.slice(0, 6).map((x) => (depth > 1 ? '…' : valueText(x, depth + 1)));
    return '[' + shown.join(', ') + (arr.length > 6 ? `, … (${arr.length} items)` : '') + ']';
  }
  if (typeof v === 'object') {
    for (const t of VALUE_TEXTERS) {
      const s = t(v, depth);
      if (s !== undefined) return s;
    }
    const o = v as Record<string, unknown>;
    if (typeof o['x'] === 'number' && typeof o['y'] === 'number') return `(${formatNumber(o['x'])}, ${formatNumber(o['y'])})`;
    if (typeof o['arity'] === 'number') return 'function';
    if (typeof o['r'] === 'number' && typeof o['cx'] === 'number') return `circle r=${formatNumber(o['r'])}`;
    if (typeof o['a'] === 'number' && typeof o['b'] === 'number' && typeof o['c'] === 'number') {
      return `${formatNumber(o['a'])}x + ${formatNumber(o['b'])}y = ${formatNumber(o['c'])}`;
    }
  }
  return '…';
}
