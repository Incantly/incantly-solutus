/**
 * `text` (free text, with `$…$` maths typeset by the view package's layout) and `sticky` (a note of fixed width that
 * grows with its text) (design 7.1). Both take typed text through `KindDef.text`.
 */
import { ok } from '../errors';
import type { BoardResult } from '../errors';
import { inPolygon } from '../math2d';
import { FONT_FAMILIES, pathPart, roundRectPath } from '../paint';
import type { FontFamily, Part } from '../paint';
import { TEXT_ALIGNS, layoutText, textParts } from '../text';
import type { TextAlign } from '../text';
import type { ShapeRecord } from '../types';
import type { DrawLod, KindDef, KindGeometry, StylePatch } from './def';
import { DIM_MAX, DIM_MIN, TEXT_MAX, bad, bagOf, failed, firstError, readColor, readEnum, readNumber, readText } from './props';

export interface TextProps {
  readonly text: string;
  readonly font: FontFamily;
  /** The text size in page units. */
  readonly size: number;
  readonly color: string;
  readonly align: TextAlign;
  /** A fixed width in page units, or null to fit the longest line. */
  readonly w: number | null;
}

export const TEXT_DEFAULTS: TextProps = Object.freeze({ text: '', font: 'sans', size: 24, color: '#1f2430', align: 'start', w: null });

/** The least width of a text box, so an empty text still has something to click. */
export const TEXT_MIN_W = 12;

/** The text size in page units for a style bar line width (so the same S, M, L, XL steps serve ink, shapes and text). */
export const textSizeFor = (lineWidth: number): number => Math.round(12 + lineWidth * 3.2);

function textLayout(p: TextProps): ReturnType<typeof layoutText> {
  return layoutText(p.text === '' ? ' ' : p.text, p.size, p.font, p.color, p.w, p.align);
}

/** The box of a text: the layout's, with the fixed width when it has one. */
function textBox(p: TextProps): { w: number; h: number } {
  const l = textLayout(p);
  return { w: Math.max(TEXT_MIN_W, p.w ?? l.w), h: Math.max(p.size * 1.3, l.h) };
}

/** Text smaller than this on screen is a grey bar; under half a pixel it is not drawn. */
const BAR_PX = 4;

export const textKind: KindDef<TextProps> = {
  kind: 'text',
  defaults: TEXT_DEFAULTS,
  check(props: unknown): BoardResult<TextProps> {
    const p = bagOf(props, 'Text');
    if (failed(p)) return p;
    const text = readText(p, 'text', '', TEXT_MAX);
    const font = readEnum(p, 'font', TEXT_DEFAULTS.font, FONT_FAMILIES);
    const size = readNumber(p, 'size', TEXT_DEFAULTS.size, 4, 1000);
    const color = readColor(p, 'color', TEXT_DEFAULTS.color);
    const align = readEnum(p, 'align', TEXT_DEFAULTS.align, TEXT_ALIGNS);
    const w = p['w'] ?? null;
    const error = firstError(text, font, size, color, align);
    if (error !== undefined) return error;
    if (w !== null && (typeof w !== 'number' || !Number.isFinite(w) || w < DIM_MIN || w > DIM_MAX)) return bad('props.w', `w must be null or a number from ${DIM_MIN} to ${DIM_MAX}.`);
    return ok({ text, font, size, color, align, w } as TextProps);
  },
  geometry(shape: ShapeRecord<string, TextProps>): KindGeometry {
    const { w, h } = textBox(shape.props);
    return { box: { minX: 0, minY: 0, maxX: w, maxY: h }, pad: 2, hit: (x, y, tol) => inPolygon(x, y, [-tol, -tol, w + tol, -tol, w + tol, h + tol, -tol, h + tol]) };
  },
  lod: (shape, scale) => {
    const px = shape.props.size * scale;
    return px < 0.5 ? 'skip' : px < BAR_PX ? 'coarse' : 'full';
  },
  draw(shape: ShapeRecord<string, TextProps>, lod: DrawLod): readonly Part[] {
    const p = shape.props;
    const l = textLayout(p);
    if (lod === 'skip' || p.text === '') return [];
    if (lod === 'coarse') {
      // a grey bar the height of the text's body for each line
      return l.lines.map((line) => pathPart(roundRectPath(line.x, line.baseline - p.size * 0.5, Math.max(1, line.w), p.size * 0.35, 1), 'rgba(107,114,128,0.55)', null, 0));
    }
    return textParts(l, 0, 0, p.font);
  },
  onResize: (_shape, box) => ({ w: Math.max(TEXT_MIN_W, box.maxX - box.minX) }),
  applyStyle(_props, style: StylePatch): Partial<TextProps> {
    return {
      ...(style.color !== undefined ? { color: style.color } : {}),
      ...(style.font !== undefined ? { font: style.font } : {}),
      ...(style.size !== undefined ? { size: textSizeFor(style.size) } : {}),
    };
  },
  text: { get: (p) => p.text, set: (_p, text) => ({ text }) },
};

// ---------------------------------------------------------------------------------------------------------------
// sticky

export interface StickyProps {
  readonly text: string;
  /** The paper colour. */
  readonly color: string;
  readonly font: FontFamily;
  readonly size: number;
}

export const STICKY_W = 200;
export const STICKY_PAD = 16;
export const STICKY_COLOR = '#fde68a';
export const STICKY_DEFAULTS: StickyProps = Object.freeze({ text: '', color: STICKY_COLOR, font: 'hand', size: 20 });

function stickyBox(p: StickyProps): { w: number; h: number } {
  const l = layoutText(p.text === '' ? ' ' : p.text, p.size, p.font, '#1f2430', STICKY_W - 2 * STICKY_PAD, 'start');
  return { w: STICKY_W, h: Math.max(STICKY_W, l.h + 2 * STICKY_PAD) };
}

export const stickyKind: KindDef<StickyProps> = {
  kind: 'sticky',
  defaults: STICKY_DEFAULTS,
  fixedSize: true,
  check(props: unknown): BoardResult<StickyProps> {
    const p = bagOf(props, 'A sticky note');
    if (failed(p)) return p;
    const text = readText(p, 'text', '', TEXT_MAX);
    const color = readColor(p, 'color', STICKY_DEFAULTS.color);
    const font = readEnum(p, 'font', STICKY_DEFAULTS.font, FONT_FAMILIES);
    const size = readNumber(p, 'size', STICKY_DEFAULTS.size, 4, 200);
    const error = firstError(text, color, font, size);
    if (error !== undefined) return error;
    return ok({ text, color, font, size } as StickyProps);
  },
  geometry(shape: ShapeRecord<string, StickyProps>): KindGeometry {
    const { w, h } = stickyBox(shape.props);
    return { box: { minX: 0, minY: 0, maxX: w, maxY: h }, pad: 6, hit: (x, y, tol) => x >= -tol && y >= -tol && x <= w + tol && y <= h + tol };
  },
  draw(shape: ShapeRecord<string, StickyProps>, lod: DrawLod): readonly Part[] {
    const p = shape.props;
    const { w, h } = stickyBox(p);
    const parts: Part[] = [];
    // no shadow when the note is small on screen (design 9, item 6)
    if (lod === 'full') parts.push(pathPart(roundRectPath(3, 5, w, h, 6), 'rgba(15,23,42,0.18)', null, 0));
    parts.push(pathPart(roundRectPath(0, 0, w, h, 6), p.color, lod === 'full' ? 'rgba(15,23,42,0.18)' : null, 1));
    if (lod === 'full' && p.text !== '') {
      parts.push(...textParts(layoutText(p.text, p.size, p.font, '#1f2430', w - 2 * STICKY_PAD, 'start'), STICKY_PAD, STICKY_PAD, p.font));
    }
    return parts;
  },
  onResize: () => ({}),
  applyStyle(_props, style: StylePatch): Partial<StickyProps> {
    return {
      ...(style.fill !== undefined && style.fill !== 'none' ? { color: style.fill } : {}),
      ...(style.color !== undefined && style.fill === undefined ? { color: style.color } : {}),
      ...(style.font !== undefined ? { font: style.font } : {}),
      ...(style.size !== undefined ? { size: Math.round(textSizeFor(style.size) * 0.8) } : {}),
    };
  },
  text: { get: (p) => p.text, set: (_p, text) => ({ text }) },
};
