/**
 * Object properties as kernel data (docs/features/kernel/design.md section 9): defaults per type, which keys an object
 * type accepts, colour words, and the conversion of an evaluated `with` value into a property.
 */
import type { ColorSpec, EffectiveStyle, Props } from './types';
import { PROPERTIES, own } from '../language/props';

/* ------------------------------ colours ------------------------------ */

const hex = (h: string): ColorSpec => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16), a: 1 });

const WORDS: Readonly<Record<string, string>> = {
  red: '#dc2626', blue: '#2563eb', green: '#16a34a', orange: '#ea580c', purple: '#9333ea', black: '#111827', grey: '#6b7280', gray: '#6b7280',
  white: '#ffffff', teal: '#0d9488', pink: '#ec4899', brown: '#92400e', yellow: '#eab308', cyan: '#06b6d4', magenta: '#d946ef',
  lightred: '#f87171', lightblue: '#60a5fa', lightgreen: '#4ade80', darkred: '#991b1b', darkblue: '#1e3a8a', darkgreen: '#166534',
  lightgrey: '#d1d5db', darkgrey: '#374151',
};

/** The colour a word names (`red`, `#ff8800`, `#f80`, `#ff880080`), or undefined. */
export function colorFromWord(word: string): ColorSpec | undefined {
  const w = Object.hasOwn(WORDS, word) ? (WORDS[word] as string) : undefined;
  if (w) return hex(w);
  const m = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(word);
  if (!m) return undefined;
  let h = m[1] as string;
  if (h.length <= 4) h = [...h].map((c) => c + c).join('');
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { ...hex('#' + h.slice(0, 6)), a };
}

/** A colour from an evaluated value: a `Color` value, or a colour word. Channels clamp to range; NaN gives undefined. */
export function toColor(v: unknown): ColorSpec | undefined {
  if (typeof v === 'string') return colorFromWord(v);
  if (typeof v !== 'object' || v === null) return undefined;
  const c = v as Partial<ColorSpec>;
  if (typeof c.r !== 'number' || typeof c.g !== 'number' || typeof c.b !== 'number') return undefined;
  const a = typeof c.a === 'number' ? c.a : 1;
  if (c.r !== c.r || c.g !== c.g || c.b !== c.b || a !== a) return undefined;
  const ch = (x: number): number => Math.min(255, Math.max(0, x));
  return { r: ch(c.r), g: ch(c.g), b: ch(c.b), a: Math.min(1, Math.max(0, a)) };
}

/** `#rrggbb` (and `aa` when not opaque) of a colour. */
export function colorHex(c: ColorSpec): string {
  const h = (x: number): string => Math.round(x).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${c.a < 1 ? h(c.a * 255) : ''}`;
}

/* ------------------------------ defaults ------------------------------ */

interface Default {
  readonly color: string;
  readonly width: number;
  readonly pointSize: number;
  readonly opacity: number;
  readonly label: Props['label'];
}

/** Defaults by type and freedom: data, not code branches (kernel design 9.3). */
const DEFAULTS: Readonly<Record<string, Default>> = {
  'Point:free': { color: '#2563eb', width: 2, pointSize: 5, opacity: 1, label: 'name' },
  'Point:dependent': { color: '#374151', width: 2, pointSize: 4, opacity: 1, label: 'name' },
  'Point:path': { color: '#60a5fa', width: 2, pointSize: 4, opacity: 1, label: 'name' },
  Line: { color: '#111827', width: 2, pointSize: 4, opacity: 1, label: 'none' },
  Ray: { color: '#111827', width: 2, pointSize: 4, opacity: 1, label: 'none' },
  Segment: { color: '#111827', width: 2, pointSize: 4, opacity: 1, label: 'none' },
  Vector: { color: '#111827', width: 2, pointSize: 4, opacity: 1, label: 'none' },
  Circle: { color: '#111827', width: 2, pointSize: 4, opacity: 0, label: 'none' },
  Arc: { color: '#111827', width: 2, pointSize: 4, opacity: 0, label: 'none' },
  Polygon: { color: '#10b981', width: 1.5, pointSize: 4, opacity: 0.15, label: 'none' },
  Region: { color: '#10b981', width: 1.5, pointSize: 4, opacity: 0.15, label: 'none' },
  Function: { color: '#dc2626', width: 2.5, pointSize: 4, opacity: 1, label: 'none' },
  Curve: { color: '#dc2626', width: 2.5, pointSize: 4, opacity: 1, label: 'none' },
  Number: { color: '#6b7280', width: 2, pointSize: 4, opacity: 1, label: 'none' },
  Text: { color: '#111827', width: 2, pointSize: 4, opacity: 1, label: 'none' },
};
const FALLBACK: Default = { color: '#111827', width: 2, pointSize: 4, opacity: 1, label: 'none' };

/** The default properties of an object of this type. `dependent` and `onPath` only matter for a Point. */
export function defaultsFor(type: string, free: boolean, onPath = false): Props {
  const d = type === 'Point' ? (onPath ? DEFAULTS['Point:path'] : free ? DEFAULTS['Point:free'] : DEFAULTS['Point:dependent']) : typeof type === 'string' && Object.hasOwn(DEFAULTS, type) ? DEFAULTS[type] : undefined;
  const x = d ?? FALLBACK;
  return {
    visible: true,
    label: x.label,
    aux: false,
    fixed: false,
    selectable: true,
    layer: 0,
    color: hex(x.color),
    opacity: x.opacity,
    width: x.width,
    lineStyle: 'solid',
    pointSize: x.pointSize,
    pointStyle: 'dot',
    fill: 'solid',
    trace: false,
    tip: 'auto',
    ext: {},
  };
}

/* ------------------------------ keys by type ------------------------------ */

const EVERY = ['visible', 'label', 'caption', 'aux', 'fixed', 'selectable', 'layer', 'showIf', 'color', 'opacity', 'tags', 'tip'];
const LINEAR = ['width', 'lineStyle'];
const FILLED = ['fill', 'fillAngle', 'fillGap'];

const BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  Point: ['pointSize', 'pointStyle', 'trace'],
  Vector: LINEAR,
  Segment: LINEAR,
  Ray: LINEAR,
  Line: LINEAR,
  Circle: [...LINEAR, ...FILLED],
  Arc: [...LINEAR, ...FILLED],
  Polygon: [...LINEAR, ...FILLED],
  Region: [...LINEAR, ...FILLED],
  Function: LINEAR,
  Curve: [...LINEAR, ...FILLED],
  List: ['pointSize', 'pointStyle', ...LINEAR],
  Number: ['width'],
};

const extraKeys = new Map<string, readonly string[] | '*'>();

/** An area that adds a property to the language table says which object types accept it (`'*'` for all). */
export function registerPropertyTypes(key: string, types: readonly string[] | '*'): void {
  extraKeys.set(key, types);
}

/** The keys an object of this type accepts in `with`. */
export function validKeysFor(type: string): string[] {
  const out = ['color', ...(typeof type === 'string' && Object.hasOwn(BY_TYPE, type) ? (BY_TYPE[type] as readonly string[]) : []), ...EVERY.filter((k) => k !== 'color')];
  for (const [k, types] of extraKeys) if (types === '*' || types.includes(type)) out.push(k);
  // keys an area appended to the language table without saying which types take them are accepted by every type
  for (const k of Object.keys(PROPERTIES)) if (!EVERY.includes(k) && !ALL_CORE.has(k) && !extraKeys.has(k)) out.push(k);
  return out;
}

const ALL_CORE: ReadonlySet<string> = new Set([...EVERY, ...LINEAR, ...FILLED, 'pointSize', 'pointStyle', 'trace']);

// `animate` is a property of every drawable type (ruling K11); the motion area gives its values a meaning

export function isValidKey(type: string, key: string): boolean {
  return validKeysFor(type).includes(key);
}

/* ------------------------------ values to properties ------------------------------ */

export type Coerced = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly allowed: string };

/** Converts an evaluated `with` value to the property's value, or says what is allowed. */
export function coerceProp(key: string, v: unknown): Coerced {
  const spec = own(PROPERTIES, key);
  if (!spec) return { ok: true, value: v };
  const bad = (): Coerced => ({ ok: false, allowed: spec.allowed });
  switch (spec.kind) {
    case 'bool':
    case 'boolexpr': {
      const b = typeof v === 'string' ? (v === 'true' ? true : v === 'false' ? false : undefined) : v;
      return typeof b === 'boolean' ? { ok: true, value: b } : bad();
    }
    case 'enum':
      return typeof v === 'string' && (spec.values ?? []).includes(v) ? { ok: true, value: v } : bad();
    case 'int':
      return typeof v === 'number' && Number.isInteger(v) && v >= (spec.min ?? -Infinity) && v <= (spec.max ?? Infinity) ? { ok: true, value: v } : bad();
    case 'number': {
      if (typeof v !== 'number' || v !== v) return bad();
      const lo = spec.min ?? -Infinity;
      const hi = spec.max ?? Infinity;
      return v >= lo && v <= hi ? { ok: true, value: v } : bad();
    }
    case 'text':
      return typeof v === 'string' ? { ok: true, value: v } : bad();
    case 'textlist':
      return Array.isArray(v) && v.every((x) => typeof x === 'string') ? { ok: true, value: v } : bad();
    case 'color': {
      const c = toColor(v);
      return c ? { ok: true, value: c } : bad();
    }
  }
}

/** Like `coerceProp` for a value read at run time: out-of-range numbers clamp, and a bad value gives `undefined`. */
export function coerceDynamic(key: string, v: unknown): unknown {
  const spec = own(PROPERTIES, key);
  if (spec?.kind === 'number' && typeof v === 'number') {
    if (v !== v) return undefined;
    return Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, v));
  }
  if (spec?.kind === 'color') return toColor(v);
  const c = coerceProp(key, v);
  return c.ok ? c.value : undefined;
}

/** Writes a coerced value into a mutable copy of the properties. */
export function setProp(p: Props, key: string, value: unknown): void {
  switch (key) {
    case 'visible': case 'aux': case 'fixed': case 'selectable': case 'trace':
      (p as unknown as Record<string, unknown>)[key] = value;
      return;
    case 'label': case 'lineStyle': case 'pointStyle': case 'fill': case 'tip': case 'layer': case 'opacity': case 'width': case 'pointSize':
      (p as unknown as Record<string, unknown>)[key] = value;
      return;
    case 'caption':
      p.caption = value as string;
      return;
    case 'fillAngle':
      p.fillAngle = value as number;
      return;
    case 'fillGap':
      p.fillGap = value as number;
      return;
    case 'tags':
      p.tags = value as string[];
      return;
    case 'color':
      p.color = value as ColorSpec;
      return;
    case 'showIf':
      return;
    default:
      p.ext = { ...p.ext, [key]: value };
  }
}

/** The empty tag list shared by every style that has none. */
export const NO_TAGS: readonly string[] = Object.freeze([]);

/** Shapes a `Props` and the evaluated `showIf` into an `EffectiveStyle`. */
export function toEffective(p: Props, showIf: boolean | undefined | 'none', showIfText?: string): EffectiveStyle {
  let shown = p.visible;
  let why: string | undefined;
  if (!p.visible) why = 'visible is false';
  else if (showIf !== 'none' && showIf !== true) {
    shown = false;
    why = showIf === undefined ? `showIf ${showIfText ?? ''} is undefined`.replace('  ', ' ') : `showIf ${showIfText ?? ''} is false`.replace('  ', ' ');
  }
  return {
    visible: p.visible,
    shown,
    ...(why !== undefined ? { why } : {}),
    label: p.label,
    ...(p.caption !== undefined ? { caption: p.caption } : {}),
    aux: p.aux,
    fixed: p.fixed,
    selectable: p.selectable,
    layer: p.layer,
    color: p.color,
    opacity: p.opacity,
    width: p.width,
    lineStyle: p.lineStyle,
    pointSize: p.pointSize,
    pointStyle: p.pointStyle,
    fill: p.fill,
    trace: p.trace,
    tip: p.tip,
    tags: p.tags ?? NO_TAGS,
    ext: p.ext,
  };
}
