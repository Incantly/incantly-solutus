/**
 * The text of the algebra view and of the teacher's tools (algebra-view design 3.3 to 3.5, 3.10, 3.17): numbers, values
 * of every type, pretty definitions, descriptions, `summarize` and `niceRange`. One source of row text for the learner
 * and the model. Pure: no DOM, no clock.
 */
import { valueText } from '../language/runtime';

export interface ValueFormat {
  /** Decimal places, 0 to 10 (default 2). */
  readonly decimals: number;
  /** Significant figures; overrides `decimals` when set. */
  readonly significant: number | null;
  readonly notation: 'decimal' | 'fraction' | 'scientific' | 'engineering';
  readonly trimZeros: boolean;
}

export const DEFAULT_FORMAT: ValueFormat = { decimals: 2, significant: null, notation: 'decimal', trimZeros: true };

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (n: number): string => String(n).replace(/-/g, '⁻').replace(/\d/g, (d) => SUPERSCRIPT[Number(d)] as string);

/** Rounds on the shortest decimal form, half away from zero, so 2.675 gives 2.68 (design 3.3, step 4). */
function roundDecimal(x: number, places: number): string {
  const s = String(Math.abs(x));
  if (/e/i.test(s)) return (x < 0 ? '-' : '') + Math.abs(x).toFixed(places);
  const [int = '0', frac = ''] = s.split('.');
  if (frac.length <= places) return (x < 0 ? '-' : '') + int + (places > 0 ? `.${frac.padEnd(places, '0')}` : '');
  const digits = (int + frac.slice(0, places)).split('').map(Number);
  if (Number(frac[places]) >= 5) {
    let i = digits.length - 1;
    while (i >= 0) {
      if ((digits[i] as number) < 9) {
        digits[i] = (digits[i] as number) + 1;
        break;
      }
      digits[i] = 0;
      i--;
    }
    if (i < 0) digits.unshift(1);
  }
  const all = digits.join('');
  const cut = all.length - places;
  const out = places > 0 ? `${all.slice(0, cut)}.${all.slice(cut)}` : all;
  return (x < 0 ? '-' : '') + out;
}

/** p/q with q ≤ 1000 and relative error under 1e-12, by continued fractions; undefined when there is none. */
export function fractionOf(x: number): { p: number; q: number } | undefined {
  if (!Number.isFinite(x)) return undefined;
  let h0 = 0;
  let h1 = 1;
  let k0 = 1;
  let k1 = 0;
  let r = x;
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(r);
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    if (k2 > 1000) return undefined;
    if (Math.abs(h2 / k2 - x) <= 1e-12 * Math.max(1, Math.abs(x))) return { p: h2, q: k2 };
    h0 = h1;
    h1 = h2;
    k0 = k1;
    k1 = k2;
    const f = r - a;
    if (f < 1e-15) return undefined;
    r = 1 / f;
  }
  return undefined;
}

/** A number as the algebra view shows it (design 3.3). `approx` is true when rounding changed it. */
export function formatNumber(x: number, fmt: ValueFormat = DEFAULT_FORMAT): { text: string; approx: boolean } {
  if (Number.isNaN(x)) return { text: '—', approx: false };
  if (x === Infinity) return { text: '∞', approx: false };
  if (x === -Infinity) return { text: '−∞', approx: false };
  const places = Math.max(0, Math.min(10, fmt.decimals));
  if (fmt.notation === 'fraction') {
    const f = fractionOf(x);
    if (f) return { text: (f.q === 1 ? String(f.p) : `${f.p}/${f.q}`).replace('-', '−'), approx: false };
    const g = fractionOf(x / Math.PI);
    if (g && g.p !== 0) return { text: `${g.p === 1 ? '' : g.p === -1 ? '−' : String(g.p).replace('-', '−')}${g.q === 1 ? 'π' : `π/${g.q}`}`, approx: false };
  }
  if (x === 0) return { text: '0', approx: false };
  // very large and very small numbers go to scientific form (step 5) before rounding could make them 0 (step 2)
  const sci = fmt.notation === 'scientific' || fmt.notation === 'engineering' || Math.abs(x) >= 1e9 || Math.abs(x) < 1e-5;
  if (!sci && Math.abs(x) < 0.5 * 10 ** -(fmt.significant ? 15 : places)) return { text: '0', approx: true };
  if (sci) {
    let e = Math.floor(Math.log10(Math.abs(x)));
    if (fmt.notation === 'engineering') e = Math.floor(e / 3) * 3;
    const m = x / 10 ** e;
    const mt = trim(roundDecimal(m, fmt.significant ? Math.max(0, fmt.significant - 1) : Math.max(places, 2)), true);
    return { text: `${mt.replace('-', '−')} × 10${sup(e)}`, approx: Number(mt) * 10 ** e !== x };
  }
  let text: string;
  if (fmt.significant) {
    const p = Math.max(0, fmt.significant - 1 - Math.floor(Math.log10(Math.abs(x))));
    text = roundDecimal(x, Math.min(15, p));
  } else text = roundDecimal(x, places);
  text = trim(text, fmt.trimZeros);
  const approx = Math.abs(Number(text) - x) > 1e-12 * Math.max(1, Math.abs(x));
  if (/^-0(\.0*)?$/.test(text)) text = '0';
  return { text: text.replace(/^-/, '−'), approx };
}

const trim = (s: string, on: boolean): string => (on && s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);

const n = (x: number, fmt: ValueFormat): string => formatNumber(x, fmt).text;

interface P2 {
  readonly x: number;
  readonly y: number;
}
const isPt = (v: unknown): v is P2 => typeof v === 'object' && v !== null && typeof (v as P2).x === 'number' && typeof (v as P2).y === 'number';

/** `y = 2x + 1`, `x = 3` or `2x − 3y = 5` from a x + b y + c = 0, leading coefficient positive (design 3.3). */
export function lineEquation(a: number, b: number, c: number, fmt: ValueFormat = DEFAULT_FORMAT): string {
  const tiny = 1e-12 * Math.max(Math.abs(a), Math.abs(b), Math.abs(c), 1);
  const term = (k: number, v: string, first: boolean): string => {
    if (Math.abs(k) < tiny) return '';
    const s = n(Math.abs(k), fmt);
    const body = v === '' ? s : `${s === '1' ? '' : s}${v}`;
    return first ? (k < 0 ? `−${body}` : body) : k < 0 ? ` − ${body}` : ` + ${body}`;
  };
  if (Math.abs(b) < tiny) return `x = ${n(-c / a, fmt)}`;
  const m = -a / b;
  const k = -c / b;
  if (Math.abs(a) < tiny) return `y = ${n(k, fmt)}`;
  const mx = term(m, 'x', true);
  return `y = ${mx}${term(k, '', false)}`;
}

function sumOfSquares(cx: number, cy: number, r: number, fmt: ValueFormat): string {
  const part = (v: string, c: number): string => (Math.abs(c) < 1e-12 ? `${v}²` : `(${v} ${c > 0 ? '−' : '+'} ${n(Math.abs(c), fmt)})²`);
  return `${part('x', cx)} + ${part('y', cy)} = ${n(r * r, fmt)}`;
}

const shoelace = (pts: readonly P2[]): number => {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] as P2;
    const b = pts[(i + 1) % pts.length] as P2;
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
};

/** The value text of an object of `type` (design 3.3, table "Other types"). */
export function valueTextOf(type: string, value: unknown, fmt: ValueFormat = DEFAULT_FORMAT): string {
  if (value === undefined || value === null) return '—';
  const base = /^(\w+)/.exec(type)?.[1] ?? type;
  switch (base) {
    case 'Number':
      return typeof value === 'number' ? n(value, fmt) : '—';
    case 'Bool':
      return String(value);
    case 'Text':
      return String(value);
    case 'Point':
      return isPt(value) ? `(${n(value.x, fmt)}, ${n(value.y, fmt)})` : '—';
    case 'Vector':
      return isPt(value) ? `⟨${n(value.x, fmt)}, ${n(value.y, fmt)}⟩` : '—';
    case 'Line': {
      const l = value as { a: number; b: number; c: number };
      return lineEquation(l.a, l.b, l.c, fmt);
    }
    case 'Ray': {
      const r = value as { from: P2; dir: P2 };
      return lineEquation(r.dir.y, -r.dir.x, r.dir.x * r.from.y - r.dir.y * r.from.x, fmt);
    }
    case 'Segment': {
      const s = value as { a: P2; b: P2 };
      return n(Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), fmt);
    }
    case 'Circle': {
      const c = value as { cx: number; cy: number; r: number };
      return sumOfSquares(c.cx, c.cy, c.r, fmt);
    }
    case 'Polygon':
      return n(shoelace((value as { pts: readonly P2[] }).pts), fmt);
    case 'Polyline': {
      const pts = (value as { pts: readonly P2[] }).pts;
      let L = 0;
      for (let i = 1; i < pts.length; i++) L += Math.hypot((pts[i] as P2).x - (pts[i - 1] as P2).x, (pts[i] as P2).y - (pts[i - 1] as P2).y);
      return n(L, fmt);
    }
    case 'Conic':
      return (value as { kind?: string }).kind ?? 'conic';
    case 'Region': {
      const a = (value as { area?: number }).area;
      return typeof a === 'number' ? n(a, fmt) : 'region';
    }
    case 'List': {
      const items = value instanceof Float64Array ? Array.from(value) : Array.isArray(value) ? (value as unknown[]) : [];
      const el = /^List<(.+)>$/.exec(type)?.[1] ?? '';
      const shown = items.slice(0, 8).map((x) => (el ? valueTextOf(el, x, fmt) : typeof x === 'number' ? n(x, fmt) : valueText(x)));
      return `{${shown.join(', ')}${items.length > 8 ? `, … ${items.length} items` : ''}}`;
    }
    default:
      return valueText(value);
  }
}

/** Unicode maths for a line of source (design 3.4, `pretty`): powers, minus signs, π, √, ≤ and the like. */
export function prettyText(source: string): string {
  // leave texts in quotes alone
  return source.split(/("(?:[^"\\]|\\.)*")/).map((part, i) => {
    if (i % 2 === 1) return part;
    return part
      .replace(/\^(?:\((\d)\)|(\d))(?![\d.])/g, (_m, a: string | undefined, b: string | undefined) => SUPERSCRIPT[Number(a ?? b)] as string)
      .replace(/\bsqrt\(/g, '√(')
      .replace(/\bpi\b/g, 'π')
      .replace(/\btau\b/g, 'τ')
      .replace(/(\d)deg\b/g, '$1°')
      .replace(/<=/g, '≤')
      .replace(/>=/g, '≥')
      .replace(/!=/g, '≠')
      .replace(/(\d) ?\* ?(?=[A-Za-zα-ω(])/g, '$1')
      .replace(/ \* /g, ' · ')
      .replace(/ - /g, ' − ')
      .replace(/(^|[(=,\s])-(?=[\w(.])/g, '$1−')
      .replace(/\binf\b/g, '∞');
  }).join('');
}

/** What the speech of a definition reads (design 3.4, `speech`). */
export function speechText(source: string): string {
  return source
    .replace(/\^2\b/g, ' squared')
    .replace(/\^3\b/g, ' cubed')
    .replace(/\^(\w+)/g, ' to the power $1')
    .replace(/sqrt\(/g, 'square root of (')
    .replace(/ \/ /g, ' over ')
    .replace(/ \* /g, ' times ')
    .replace(/ - /g, ' minus ')
    .replace(/ \+ /g, ' plus ')
    .replace(/\bpi\b/g, 'pi')
    .replace(/==/g, ' equals ');
}

/** The object facts the text needs (a figure's object view has them all). */
export interface ObjectFacts {
  readonly name: string;
  readonly type: string;
  readonly typeText: string;
  readonly free: boolean;
  readonly definition: string;
  readonly cell: { readonly defined: boolean; readonly value?: unknown; readonly reason?: string; readonly detail?: string };
  readonly range?: { readonly min: number; readonly max: number; readonly step?: number };
}

const joinAnd = (xs: readonly string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Words for a command: `Midpoint` → "Midpoint", `PointOn` → "Point on". */
const words = (cmd: string): string => cmd.replace(/([a-z])([A-Z])/g, (_m, a: string, b: string) => `${a} ${b.toLowerCase()}`);

/** Splits the top-level arguments of a call. */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let quote = false;
  for (const ch of s) {
    if (ch === '"') quote = !quote;
    if (!quote && '([{'.includes(ch)) depth++;
    if (!quote && ')]}'.includes(ch)) depth--;
    if (!quote && ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Templates for common commands (design 3.5); a form's own `describe` wins. Used only when the argument count fits. */
const TEMPLATES: Readonly<Record<string, readonly string[]>> = {
  PointOn: ['Point on {0}', 'Point on {0}'], Intersect: ['', 'Intersection of {0} and {1}', 'Intersection {2} of {0} and {1}'], Midpoint: ['Midpoint of {0}', 'Midpoint of {0} and {1}'],
  Segment: ['', 'Segment from {0} to {1}'], Line: ['', 'Line through {0} and {1}'], Ray: ['', 'Ray from {0} through {1}'],
  Vector: ['Position vector of {0}', 'Vector from {0} to {1}'], Perpendicular: ['', 'Line through {0} perpendicular to {1}'],
  Parallel: ['', 'Line through {0} parallel to {1}'], Area: ['Area of {0}'], Distance: ['', 'Distance from {0} to {1}'],
  Length: ['Length of {0}'], Perimeter: ['Perimeter of {0}'], Tangent: ['', 'Tangents from {0} to {1}'], Roots: ['', '', 'Roots of {0} from {1} to {2}'],
  Extremum: ['Turning points of {0}', '', 'Turning points of {0} from {1} to {2}'], Reflect: ['', '{0} reflected in {1}'],
  Rotate: ['', '{0} turned by {1}', '{0} turned by {1} about {2}'], Translate: ['', '{0} moved by {1}'], Dilate: ['', '{0} enlarged by {1}', '{0} enlarged by {1} from {2}'],
  Circle: ['', 'Circle about {0} through {1}', 'Circle through {0}, {1} and {2}'], Polygon: ['', '', 'Triangle {0}{1}{2}'], Angle: ['', 'Angle between {0} and {1}', 'Angle {0}{1}{2}'],
  Mean: ['Mean of {0}'], Derivative: ['Derivative of {0}'], Center: ['Centre of {0}'], Slope: ['Slope of {0}'],
};

/**
 * The description of an object (design 3.5): the form's template when it has one (`Midpoint of {0} and {1}`), else
 * "Midpoint of A and B" from the call, else the type, or "Number from a and b" for an expression of other objects.
 */
export function describeObject(o: ObjectFacts, inputs: readonly string[] = [], template?: string): string {
  const rhs = o.definition.slice(o.definition.indexOf('=') + 1).replace(/\swith\s.*$/, '').trim();
  const call = /^([A-Z]\w*)\((.*)\)$/.exec(rhs);
  if (call) {
    const args = splitArgs(call[2] as string);
    const t = template ?? TEMPLATES[call[1] as string]?.[args.length - 1];
    if (t) return t.replace(/\{(\d)\}/g, (_m, i: string) => args[Number(i)] ?? '');
    return args.length ? `${words(call[1] as string)} of ${joinAnd(args)}` : words(call[1] as string);
  }
  if (o.free) {
    if (o.type === 'Number' && o.range) return 'Slider';
    return o.type === 'Bool' ? 'Check box' : o.type === 'List' ? `List of ${(/<(\w+)/.exec(o.typeText)?.[1] ?? 'value').toLowerCase()}s` : o.type;
  }
  if (/^\w+\(\w+(,\s*\w+)?\)\s*=/.test(o.definition)) return 'Function';
  return inputs.length ? `${o.type} from ${joinAnd(inputs)}` : o.type;
}

export interface Summary {
  readonly name: string;
  readonly type: string;
  readonly def: string;
  readonly value: string | null;
  readonly text: string;
  readonly undef?: { readonly reason: string; readonly cause?: string };
}

/**
 * The one-line text of an object for the list and the teacher's tools (design 3.17): `A = (1, 2)`, `f(x) = x² − 2`,
 * `h = √(a² + b²) = 5`, `r = undefined (out_of_domain)`, `M = Midpoint(A, B) → (2, 3)`.
 */
export function summarize(o: ObjectFacts, opts: { maxChars?: number; format?: ValueFormat; cause?: string } = {}): Summary {
  const max = opts.maxChars ?? 80;
  const def = prettyText(o.definition.replace(/\swith\s.*$/, ''));
  const rhs = def.slice(def.indexOf('=') + 1).trim();
  let value: string | null = null;
  let text: string;
  if (!o.cell.defined) {
    text = `${o.name} = undefined (${o.cell.reason ?? 'undefined'})`;
  } else {
    value = valueTextOf(o.typeText || o.type, o.cell.value, opts.format);
    const isFunction = o.type === 'Function' || /^\S+\([^)]*\)\s*=/.test(def);
    if (isFunction) text = def;
    else if (o.free || value === rhs) text = `${o.name} = ${value}`;
    else if (/^[A-Z]\w*\(/.test(rhs)) text = `${def} → ${value}`;
    else text = `${def} = ${value}`;
  }
  if (text.length > max) text = `${text.slice(0, max - 1)}…`;
  return {
    name: o.name, type: o.typeText || o.type, def, value, text,
    ...(!o.cell.defined ? { undef: { reason: o.cell.reason ?? 'undefined', ...(opts.cause ? { cause: opts.cause } : {}) } } : {}),
  };
}

/** A 1-2-5 number at least `x` (or at most, with `down`). */
function nice125(x: number, down = false): number {
  const p = 10 ** Math.floor(Math.log10(x));
  const steps = [1, 2, 5, 10].map((m) => m * p);
  return down ? ([...steps].reverse().find((s) => s <= x * (1 + 1e-12)) ?? p) : (steps.find((s) => s >= x * (1 - 1e-12)) ?? 10 * p);
}

/** A range for a slider made from a number (design 3.10): 3 gives 0..10 step 0.1, 12 gives 0..50 step 0.5. */
export function niceRange(value: number, unit?: 'angle'): { min: number; max: number; step: number } {
  if (unit === 'angle') return { min: 0, max: 2 * Math.PI, step: Math.PI / 180 };
  if (value === 0 || !Number.isFinite(value)) return { min: -5, max: 5, step: 0.1 };
  const span = nice125(2 * Math.abs(value));
  const step = Math.max(0.001, nice125(span / 100, true));
  const clean = (x: number): number => Number(x.toPrecision(12));
  return value > 0 ? { min: 0, max: clean(span), step: clean(step) } : { min: clean(-span), max: 0, step: clean(step) };
}
