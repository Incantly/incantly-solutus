/**
 * Styles (graphics-view design 9): the style record, colour, dashes, points,
 * fill and hatching, opacity, label modes, per-type defaults and themes.
 * Formula-valued properties arrive as `{ expr }` references the kernel
 * evaluates; this file resolves them per frame into a concrete style.
 */
import { okResult, viewError } from '../errors';
import type { Result } from '@incantly/kernel';
import type { PaintKind } from './drawables';

/** sRGB colour, alpha 0..1. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export const rgba = (r: number, g: number, b: number, a = 1): Rgba => ({ r, g, b, a });

/** A property value that is a formula the kernel evaluates each frame. */
export interface StyleRef {
  readonly expr: string;
}

export type StyleNumber = number | StyleRef;
export type StyleBool = boolean | StyleRef;
export type StyleColorValue = string | Rgba | StyleRef;
export type StyleTextValue = string | StyleRef;

export function isStyleRef(v: unknown): v is StyleRef {
  return typeof v === 'object' && v !== null && 'expr' in v && typeof (v as StyleRef).expr === 'string';
}

/** Evaluates one style reference; provided by the kernel handoff. */
export type StyleEvaluator = (expr: string) => number | string | boolean | Rgba | undefined;

export type DashPattern =
  | 'solid' | 'dashed' | 'dotted' | 'dashdot'
  | { readonly on: number; readonly off: number }
  | readonly number[];

export type PointShape =
  | 'dot' | 'ring' | 'cross' | 'plus' | 'diamond' | 'diamond-open' | 'square'
  | 'square-open' | 'triangle-up' | 'triangle-down' | 'triangle-left' | 'triangle-right';

export type HatchSpec =
  | { readonly kind: 'lines'; readonly angle: number; readonly spacing: number; readonly width?: number }
  | { readonly kind: 'cross'; readonly angle: number; readonly spacing: number; readonly width?: number }
  | { readonly kind: 'dots'; readonly spacing: number; readonly radius?: number }
  | { readonly kind: 'grid'; readonly spacing: number; readonly width?: number }
  | { readonly kind: 'honeycomb'; readonly spacing: number }
  | { readonly kind: 'weave'; readonly spacing: number }
  | { readonly kind: 'bricks'; readonly spacing: number }
  | { readonly kind: 'image'; readonly src: string; readonly mode: 'tile' | 'stretch' };

export type LabelMode = 'none' | 'name' | 'value' | 'name-value' | 'caption';

export interface ArrowSpec {
  readonly at: 'start' | 'end' | 'both';
  readonly size?: number;
}

export interface TextStyleSpec {
  readonly size: number;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly family: string;
  readonly align: 'left' | 'center' | 'right';
  readonly background?: Rgba | 'none';
}

/** Authored style: what `with` lines set (design 9.1, plus label offsets/alt). */
export interface AuthoredStyle {
  readonly color?: StyleColorValue;
  readonly opacity?: StyleNumber;
  readonly width?: StyleNumber;
  readonly dash?: DashPattern | StyleRef;
  readonly dashPhase?: StyleNumber;
  readonly pointStyle?: PointShape;
  readonly pointSize?: StyleNumber;
  readonly fill?: StyleNumber;
  readonly fillColor?: StyleColorValue;
  readonly hatch?: HatchSpec | 'none';
  readonly label?: LabelMode;
  readonly caption?: StyleTextValue;
  readonly layer?: number;
  readonly show?: StyleBool;
  readonly fixed?: boolean;
  readonly selectable?: boolean;
  readonly trace?: boolean;
  readonly arrow?: ArrowSpec;
  readonly marks?: number;
  readonly angleStyle?: 'arc' | 'square' | 'dot';
  readonly textStyle?: Partial<TextStyleSpec>;
  readonly group?: StyleNumber;
  readonly labelOpacity?: StyleNumber;
  readonly labelDx?: number;
  readonly labelDy?: number;
  readonly alt?: string;
}

/** Fully concrete style after defaults and reference evaluation. */
export interface ResolvedStyle {
  readonly color: Rgba;
  readonly opacity: number;
  readonly width: number;
  /** Resolved dash array in px; empty means solid. */
  readonly dash: readonly number[];
  readonly dashPhase: number;
  readonly pointStyle: PointShape;
  readonly pointSize: number;
  readonly fill: number;
  readonly fillColor: Rgba;
  readonly hatch: HatchSpec | 'none';
  readonly label: LabelMode;
  readonly caption: string;
  readonly layer: number;
  readonly show: boolean;
  readonly fixed: boolean;
  readonly selectable: boolean;
  readonly trace: boolean;
  readonly arrow: ArrowSpec | null;
  readonly marks: number;
  readonly angleStyle: 'arc' | 'square' | 'dot';
  readonly textStyle: TextStyleSpec;
  readonly group: number | null;
  readonly labelOpacity: number;
  readonly labelDx: number;
  readonly labelDy: number;
  readonly alt: string;
}

/** Named script colours (ui.md 6). */
export const NAMED_COLORS: Readonly<Record<string, string>> = {
  red: '#d03a2a',
  orange: '#e8820c',
  green: '#1f8a4c',
  blue: '#1a5fd1',
  purple: '#7a3fd1',
  teal: '#0f8f9a',
  pink: '#d6458f',
  brown: '#8a5a2b',
  grey: '#7b8491',
  gray: '#7b8491',
  black: '#111111',
  white: '#ffffff',
};

function hexByte(s: string): number {
  return parseInt(s, 16);
}

function parseHex(text: string): Rgba | null {
  const h = text.startsWith('#') ? text.slice(1) : text;
  if (/^[0-9a-fA-F]{6}$/.test(h)) {
    return rgba(hexByte(h.slice(0, 2)), hexByte(h.slice(2, 4)), hexByte(h.slice(4, 6)), 1);
  }
  if (/^[0-9a-fA-F]{8}$/.test(h)) {
    return rgba(hexByte(h.slice(0, 2)), hexByte(h.slice(2, 4)), hexByte(h.slice(4, 6)), hexByte(h.slice(6, 8)) / 255);
  }
  if (/^[0-9a-fA-F]{3}$/.test(h)) {
    const c0 = h[0] ?? '0';
    const c1 = h[1] ?? '0';
    const c2 = h[2] ?? '0';
    return rgba(hexByte(c0 + c0), hexByte(c1 + c1), hexByte(c2 + c2), 1);
  }
  return null;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = ((h % 360) + 360) % 360 / 60;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 1) { r = c; g = x; } else if (hh < 2) { r = x; g = c; } else if (hh < 3) { g = c; b = x; }
  else if (hh < 4) { g = x; b = c; } else if (hh < 5) { r = x; b = c; } else { r = c; b = x; }
  const m = l - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const mx = Math.max(rr, gg, bb);
  const mn = Math.min(rr, gg, bb);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h: number;
  if (mx === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) * 60;
  else if (mx === gg) h = ((bb - rr) / d + 2) * 60;
  else h = ((rr - gg) / d + 4) * 60;
  return [h, s, l];
}

function shiftLightness(c: Rgba, delta: number): Rgba {
  const [h, s, l] = rgbToHsl(c.r, c.g, c.b);
  const [r, g, b] = hslToRgb(h, s, Math.min(1, Math.max(0, l + delta)));
  return rgba(r, g, b, c.a);
}

/**
 * Fill colour of a `dot` marker (design 9.4): the stroke colour with its
 * lightness moved 60% of the way to white (dark colours) or black (light ones).
 */
export function dotFillColor(c: Rgba): Rgba {
  const [h, s, l] = rgbToHsl(c.r, c.g, c.b);
  const target = l <= 0.5 ? 1 : 0;
  const [r, g, b] = hslToRgb(h, s, l + (target - l) * 0.6);
  return rgba(r, g, b, c.a);
}

/** Parse a colour literal: name (with light/dark forms), rgb/hsl, hex. */
export function parseColor(text: string): Result<Rgba> {
  const t = text.trim().toLowerCase();
  const named = NAMED_COLORS[t];
  if (named !== undefined) return okResult(parseHex(named) ?? rgba(0, 0, 0, 1));
  for (const prefix of ['light', 'dark'] as const) {
    if (t.startsWith(prefix)) {
      const base = NAMED_COLORS[t.slice(prefix.length)] ?? NAMED_COLORS[t.slice(prefix.length).replace(/^[-_ ]/, '')];
      if (base !== undefined) {
        const c = parseHex(base);
        if (c !== null) return okResult(shiftLightness(c, prefix === 'light' ? 0.2 : -0.2));
      }
    }
  }
  if (t.startsWith('#') || /^[0-9a-f]{3,8}$/i.test(t)) {
    const c = parseHex(t);
    if (c !== null) return okResult(c);
  }
  const fn = /^(rgba?|hsla?)\((.*)\)$/.exec(t.replace(/\s+/g, ''));
  if (fn !== null) {
    const name = fn[1] ?? '';
    const args = (fn[2] ?? '').split(',').map(Number);
    if (args.every(Number.isFinite)) {
      if ((name === 'rgb' || name === 'rgba') && (args.length === 3 || args.length === 4)) {
        const [r = 0, g = 0, b = 0, a = 1] = args;
        if (r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255 && a >= 0 && a <= 1) {
          return okResult(rgba(Math.round(r), Math.round(g), Math.round(b), a));
        }
      }
      if ((name === 'hsl' || name === 'hsla') && (args.length === 3 || args.length === 4)) {
        const [h = 0, s = 0, l = 0, a = 1] = args;
        if (s >= 0 && s <= 100 && l >= 0 && l <= 100 && a >= 0 && a <= 1) {
          const [r, g, b] = hslToRgb(h, s / 100, l / 100);
          return okResult(rgba(r, g, b, a));
        }
      }
    }
  }
  return viewError({
    kind: 'bad_property_value',
    messageKey: 'view.bad_property_value',
    params: { key: 'color', allowed: 'a colour name, rgb(r, g, b), hsl(h, s, l) or #rrggbb' },
    token: text,
    hint: 'Use a name like blue, or rgb(255, 0, 0).',
  });
}

/** `Gradient` interpolation in linear light, returned as sRGB (design 9.2). */
export function gradientAt(stops: readonly Rgba[], t: number): Rgba {
  if (stops.length === 0) return rgba(0, 0, 0, 1);
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (first === undefined || last === undefined) return rgba(0, 0, 0, 1);
  if (stops.length === 1 || t <= 0) return first;
  if (t >= 1) return last;
  const seg = t * (stops.length - 1);
  const i = Math.min(Math.floor(seg), stops.length - 2);
  const a = stops[i] ?? first;
  const b = stops[i + 1] ?? last;
  const f = seg - i;
  const toLin = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const toSrgb = (v: number): number => {
    const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, s)) * 255);
  };
  return rgba(
    toSrgb(toLin(a.r) + (toLin(b.r) - toLin(a.r)) * f),
    toSrgb(toLin(a.g) + (toLin(b.g) - toLin(a.g)) * f),
    toSrgb(toLin(a.b) + (toLin(b.b) - toLin(a.b)) * f),
    a.a + (b.a - a.a) * f,
  );
}

/** Named dashes scale with width, with a 1 px floor (design 9.3). */
export function dashToArray(pattern: DashPattern, width: number): readonly number[] {
  const w = Math.max(width, 0.5);
  const floor = (v: number): number => Math.max(1, v);
  if (pattern === 'solid') return [];
  if (pattern === 'dashed') return [floor(4 * w), floor(3 * w)];
  if (pattern === 'dotted') return [floor(w), floor(2 * w)];
  if (pattern === 'dashdot') return [floor(4 * w), floor(2 * w), floor(w), floor(2 * w)];
  // `Array.isArray` does not narrow `readonly number[]`, so discriminate on
  // the `{ on, off }` shape instead (it is the only object variant with `on`).
  if ('on' in pattern) return [Math.max(0, pattern.on), Math.max(0, pattern.off)];
  return pattern.map((v) => Math.max(0, v));
}

export interface Theme {
  readonly background: Rgba;
  readonly gridMajor: Rgba;
  readonly gridMinor: Rgba;
  readonly axes: Rgba;
  readonly freePoint: Rgba;
  readonly dependentPoint: Rgba;
  readonly pointOnPath: Rgba;
  readonly stroke: Rgba;
  readonly function: Rgba;
  readonly selectionHalo: Rgba;
  readonly hoverHalo: Rgba;
  readonly focusRing: Rgba;
}

const hx = (s: string): Rgba => parseHex(s) ?? rgba(0, 0, 0, 1);

export const LIGHT_THEME: Theme = {
  background: hx('#ffffff'),
  gridMajor: hx('#d6dae0'),
  gridMinor: hx('#eceff3'),
  axes: hx('#4a5260'),
  freePoint: hx('#1a5fd1'),
  dependentPoint: hx('#4a4f57'),
  pointOnPath: hx('#7a3fd1'),
  stroke: hx('#222831'),
  function: hx('#c4361f'),
  selectionHalo: rgba(255, 176, 0, 0.5),
  hoverHalo: rgba(26, 95, 209, 0.35),
  focusRing: hx('#000000'),
};

export const DARK_THEME: Theme = {
  background: hx('#14161a'),
  gridMajor: hx('#3a3f47'),
  gridMinor: hx('#272b31'),
  axes: hx('#aab3c0'),
  freePoint: hx('#6aa3ff'),
  dependentPoint: hx('#b8bec8'),
  pointOnPath: hx('#b48cff'),
  stroke: hx('#e6e9ee'),
  function: hx('#ff7b63'),
  selectionHalo: rgba(255, 176, 0, 0.5),
  hoverHalo: rgba(106, 163, 255, 0.35),
  focusRing: hx('#ffffff'),
};

export const HIGH_CONTRAST_THEME: Theme = {
  ...LIGHT_THEME,
  background: hx('#ffffff'),
  gridMajor: hx('#000000'),
  gridMinor: hx('#666666'),
  axes: hx('#000000'),
  freePoint: hx('#000000'),
  dependentPoint: hx('#000000'),
  pointOnPath: hx('#000000'),
  stroke: hx('#000000'),
  function: hx('#000000'),
};

/** Colour-blind-safe palette (ui.md 6). */
export const COLOR_BLIND_SAFE: readonly Rgba[] = [
  hx('#0072b2'), hx('#e69f00'), hx('#009e73'), hx('#d55e00'),
  hx('#cc79a7'), hx('#56b4e9'), hx('#f0e442'), hx('#000000'),
];

export interface TypeDefaults {
  readonly color: Rgba;
  readonly width: number;
  readonly fill: number;
  /** Fill colour when the author sets no colour (ui.md 6: polygon fill differs from its stroke). */
  readonly fillColor: Rgba;
  readonly label: LabelMode;
  readonly pointSize: number;
}

/** Per-type defaults (design 9.9, ui.md 6); free points differ by colour. */
export function defaultsForKind(kind: PaintKind, free: boolean): TypeDefaults {
  const stroke = LIGHT_THEME.stroke;
  const base = { width: 2, fill: 0, label: 'none' as LabelMode, pointSize: 4 };
  switch (kind) {
    case 'point': {
      const color = free ? LIGHT_THEME.freePoint : LIGHT_THEME.dependentPoint;
      return { ...base, color, fillColor: color, label: 'name' };
    }
    case 'curve':
      return { ...base, color: LIGHT_THEME.function, fillColor: LIGHT_THEME.function, width: 2.5 };
    case 'region':
      // ui.md 6 polygon row: stroke #222831, fill #1a5fd1 at 0.15.
      return { ...base, color: stroke, fillColor: LIGHT_THEME.freePoint, fill: 0.15 };
    case 'angle': {
      const color = hx('#2e8b57');
      return { ...base, color, fillColor: color, fill: 0.25, label: 'name' };
    }
    case 'particles': {
      const color = hx('#111111');
      return { ...base, color, fillColor: color };
    }
    case 'segment':
    case 'vector':
    case 'line':
    case 'arc':
      // Segments, rays and lines share the line row of design 9.7: label `name`.
      return { ...base, color: stroke, fillColor: stroke, label: 'name' };
    default:
      return { ...base, color: stroke, fillColor: stroke };
  }
}

/** Which properties apply to which drawable kind (for `property_not_for_type`). */
export function propsForKind(kind: PaintKind): readonly string[] {
  const common = ['color', 'opacity', 'width', 'dash', 'dashPhase', 'label', 'caption', 'layer', 'show', 'fixed', 'selectable', 'trace', 'alt', 'labelDx', 'labelDy', 'group', 'labelOpacity'];
  switch (kind) {
    case 'point': return [...common, 'pointStyle', 'pointSize'];
    case 'segment':
    case 'line':
    case 'vector': return [...common, 'arrow', 'marks'];
    case 'curve':
    case 'arc':
    case 'angle': return [...common, 'fill', 'fillColor', 'hatch', 'angleStyle'];
    case 'region': return [...common, 'fill', 'fillColor', 'hatch'];
    case 'text': return [...common, 'textStyle'];
    case 'widget': return [...common, 'textStyle'];
    case 'particles': return [...common];
    case 'image': return [...common, 'opacity'];
  }
}

/** Properties that only some drawable kinds use; elsewhere they are `property_not_for_type` (errors.md 2). */
const KIND_ONLY_PROPS = ['pointStyle', 'pointSize'] as const;
const KIND_ONLY_HINT: Readonly<Record<string, string>> = {
  pointStyle: 'pointStyle is for points. Use width for lines and curves.',
  pointSize: 'pointSize is for points. Use width for lines and curves.',
};

function numIn(v: unknown, lo: number, hi: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
}

function resolveNum(raw: StyleNumber | undefined, fallback: number, evalRef: StyleEvaluator): number | { error: string } {
  if (raw === undefined) return fallback;
  if (typeof raw === 'number') return raw;
  const v = evalRef(raw.expr);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  // A reference with no value right now is a runtime condition, not an error: the default stays.
  // A value of the wrong type is a type mismatch and fails the line.
  if (v === undefined) return fallback;
  return { error: `the formula {${raw.expr}} has no number value right now` };
}

function resolveColor(raw: StyleColorValue | undefined, fallback: Rgba, evalRef: StyleEvaluator): Rgba | { error: string } {
  if (raw === undefined) return fallback;
  if (typeof raw === 'object' && !isStyleRef(raw)) return raw;
  if (typeof raw === 'string') {
    const c = parseColor(raw);
    return c.ok ? c.value : { error: `colour ${raw} is not valid` };
  }
  const v = evalRef(raw.expr);
  if (typeof v === 'object') return v;
  if (typeof v === 'string') {
    const c = parseColor(v);
    return c.ok ? c.value : { error: `the formula {${raw.expr}} is not a colour right now` };
  }
  // No value right now: the default stays. Any other type is a mismatch.
  if (v === undefined) return fallback;
  return { error: `the formula {${raw.expr}} has no colour value right now` };
}

function resolveBool(raw: StyleBool | undefined, fallback: boolean, evalRef: StyleEvaluator): boolean {
  if (raw === undefined) return fallback;
  if (typeof raw === 'boolean') return raw;
  const v = evalRef(raw.expr);
  return typeof v === 'boolean' ? v : fallback;
}

function isErrNum(v: number | { error: string }): v is { error: string } {
  return typeof v === 'object';
}
function isErrColor(v: Rgba | { error: string }): v is { error: string } {
  return 'error' in v;
}

/**
 * Resolve an authored style to concrete values, evaluating references and
 * checking ranges. All-or-none: the first bad property fails the line.
 */
export function resolveStyle(
  kind: PaintKind,
  free: boolean,
  authored: AuthoredStyle,
  evalRef: StyleEvaluator,
): Result<ResolvedStyle> {
  const def = defaultsForKind(kind, free);
  const fail = (key: string, allowed: string, token: string, hint?: string): Result<ResolvedStyle> =>
    viewError({
      kind: 'bad_property_value',
      messageKey: 'view.bad_property_value',
      params: { key, allowed },
      token,
      ...(hint === undefined ? {} : { hint }),
    });

  for (const key of KIND_ONLY_PROPS) {
    if (authored[key] !== undefined && !propsForKind(kind).includes(key)) {
      return viewError({
        kind: 'bad_property_value',
        messageKey: 'view.property_not_for_type',
        params: { key, objectType: kind },
        token: key,
        hint: KIND_ONLY_HINT[key] ?? `${key} does not apply to ${kind}.`,
      });
    }
  }
  const color = resolveColor(authored.color, def.color, evalRef);
  if (isErrColor(color)) return fail('color', 'a colour', authored.color === undefined ? '' : String(authored.color));
  const widthR = resolveNum(authored.width, def.width, evalRef);
  if (isErrNum(widthR)) return fail('width', 'a number', widthR.error);
  if (!numIn(widthR, 0.5, 20)) return fail('width', 'a number from 0.5 to 20', String(widthR), 'Use 0.5 to 20 pixels. For a faint thick band, lower `opacity` instead.');
  const opacityR = resolveNum(authored.opacity, 1, evalRef);
  if (isErrNum(opacityR)) return fail('opacity', 'a number', opacityR.error);
  if (!numIn(opacityR, 0, 1)) return fail('opacity', 'a number from 0 to 1', String(opacityR));
  const fillR = resolveNum(authored.fill, def.fill, evalRef);
  if (isErrNum(fillR)) return fail('fill', 'a number', fillR.error);
  if (!numIn(fillR, 0, 1)) return fail('fill', 'a number from 0 to 1', String(fillR));
  const fillColor = resolveColor(authored.fillColor, authored.color === undefined ? def.fillColor : color, evalRef);
  if (isErrColor(fillColor)) return fail('fillColor', 'a colour', String(authored.fillColor));
  const pointSizeR = resolveNum(authored.pointSize, def.pointSize, evalRef);
  if (isErrNum(pointSizeR)) return fail('pointSize', 'a number', pointSizeR.error);
  if (!numIn(pointSizeR, 1, 20)) return fail('pointSize', 'a number from 1 to 20', String(pointSizeR));
  const layer = authored.layer ?? 0;
  if (!Number.isInteger(layer) || layer < 0 || layer > 9) {
    return fail('layer', 'an integer from 0 to 9', String(authored.layer), 'Layers run from 0 to 9.');
  }
  const marks = authored.marks ?? 0;
  if (!Number.isInteger(marks) || marks < 0 || marks > 3) return fail('marks', '0, 1, 2 or 3', String(authored.marks));
  const captionRaw = authored.caption;
  const caption = captionRaw === undefined ? '' : typeof captionRaw === 'string' ? captionRaw : String(evalRef(captionRaw.expr) ?? '');
  if (caption.length > 2000) return fail('caption', 'at most 2000 characters', `${caption.length} characters`);
  const dashPhaseR = resolveNum(authored.dashPhase, 0, evalRef);
  if (isErrNum(dashPhaseR)) return fail('dashPhase', 'a number', dashPhaseR.error);
  const groupR = authored.group === undefined ? null : resolveNum(authored.group, 1, evalRef);
  if (groupR !== null && (isErrNum(groupR) || !numIn(groupR, 0, 1))) {
    return fail('group', 'a number from 0 to 1', String(authored.group));
  }
  const labelOpacityR = resolveNum(authored.labelOpacity, 1, evalRef);
  if (isErrNum(labelOpacityR)) return fail('labelOpacity', 'a number', labelOpacityR.error);
  if (!numIn(labelOpacityR, 0, 1)) return fail('labelOpacity', 'a number from 0 to 1', String(labelOpacityR));
  const hatch = authored.hatch ?? 'none';
  if (hatch !== 'none' && hatch.kind !== 'image') {
    if (!numIn(hatch.spacing, 2, 80)) return fail('hatch', 'a spacing from 2 to 80 px', String(hatch.spacing));
  }
  const dashRaw = authored.dash ?? 'solid';
  const dashName = typeof dashRaw === 'string' ? dashRaw : Array.isArray(dashRaw) ? 'custom' : 'custom';
  if (typeof dashRaw === 'object' && !Array.isArray(dashRaw) && !('on' in dashRaw)) {
    const v = evalRef((dashRaw as StyleRef).expr);
    if (v !== undefined && typeof v !== 'string') return fail('dash', 'a dash name', String(v));
  }
  const dash: readonly number[] = isStyleRef(dashRaw)
    ? dashToArray('solid', widthR)
    : dashToArray(dashRaw, widthR);
  void dashName;
  const textSize = authored.textStyle?.size ?? 14;
  if (!numIn(textSize, 6, 96)) return fail('textStyle.size', 'a number from 6 to 96', String(textSize));

  return okResult({
    color,
    opacity: opacityR,
    width: widthR,
    dash,
    dashPhase: dashPhaseR,
    pointStyle: authored.pointStyle ?? 'dot',
    pointSize: pointSizeR,
    fill: fillR,
    fillColor,
    hatch,
    label: authored.label ?? def.label,
    caption,
    layer,
    show: resolveBool(authored.show, true, evalRef),
    fixed: authored.fixed ?? false,
    selectable: authored.selectable ?? true,
    trace: authored.trace ?? false,
    arrow: authored.arrow ?? null,
    marks,
    angleStyle: authored.angleStyle ?? 'arc',
    textStyle: {
      size: textSize,
      bold: authored.textStyle?.bold ?? false,
      italic: authored.textStyle?.italic ?? false,
      family: authored.textStyle?.family ?? 'system-ui, sans-serif',
      align: authored.textStyle?.align ?? 'center',
      background: authored.textStyle?.background ?? 'none',
    },
    group: groupR,
    labelOpacity: labelOpacityR,
    labelDx: authored.labelDx ?? 0,
    labelDy: authored.labelDy ?? 0,
    alt: authored.alt ?? '',
  });
}

/** `Hide(A)` sets `show = false`; both must agree for the object to draw. */
export function effectiveVisibility(style: ResolvedStyle, valueDefined: boolean): boolean {
  return style.show && valueDefined;
}

/** Clamp a hatch spacing into the rendered 4..40 px band (see builder notes). */
export function renderHatchSpacing(spacing: number): number {
  return Math.min(40, Math.max(4, spacing));
}

