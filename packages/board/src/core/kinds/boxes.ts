/**
 * The shapes that fill a box: `rect`, `ellipse`, `triangle`, `diamond`, `star` (design 7.1). They share their props
 * (`w`, `h`, `fill`, `stroke`, `dash`, `size`, `label`, `font`) and differ in their outline, so one factory makes the
 * five `KindDef`s. `label` is the text inside, laid out with the maths layout of the view package.
 */
import { ok } from '../errors';
import type { BoardResult } from '../errors';
import { ellipsePoly, inPolygon, distToPath, TAU } from '../math2d';
import { DASHES, FONT_FAMILIES, cssOrNull, dashFor, ellipsePath, pathPart, polygonPath } from '../paint';
import type { Dash, FontFamily, Part, PathData } from '../paint';
import { layoutText, textParts } from '../text';
import type { ShapeRecord } from '../types';
import type { DrawLod, KindDef, KindGeometry } from './def';
import { DIM_MAX, DIM_MIN, SIZE_MAX, TEXT_MAX, bagOf, failed, firstError, readColor, readEnum, readFill, readNumber, readText } from './props';

export type BoxKind = 'rect' | 'ellipse' | 'triangle' | 'diamond' | 'star';

export interface BoxProps {
  readonly w: number;
  readonly h: number;
  /** A colour or `none`. */
  readonly fill: string;
  /** The outline's colour; the label has it too. */
  readonly stroke: string;
  readonly dash: Dash;
  /** The outline's width in page units. */
  readonly size: number;
  readonly label: string;
  readonly font: FontFamily;
}

export const BOX_DEFAULTS: BoxProps = Object.freeze({ w: 120, h: 80, fill: 'none', stroke: '#1f2430', dash: 'solid', size: 3, label: '', font: 'sans' });

/** The text size of a label inside a shape, in page units. */
export const LABEL_PX = 18;
/** The space between a shape's edge and its label. */
export const LABEL_PAD = 8;

type Outline = (w: number, h: number) => number[];

const rectPoly: Outline = (w, h) => [0, 0, w, 0, w, h, 0, h];
const trianglePoly: Outline = (w, h) => [w / 2, 0, w, h, 0, h];
const diamondPoly: Outline = (w, h) => [w / 2, 0, w, h / 2, w / 2, h, 0, h / 2];

/** The five corners of a star and the five between them, scaled to fill the box. */
const starPoly: Outline = (w, h) => {
  const raw: number[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 1 : 0.4;
    const a = -Math.PI / 2 + (i * TAU) / 10;
    raw.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < raw.length; i += 2) {
    minX = Math.min(minX, raw[i] as number);
    maxX = Math.max(maxX, raw[i] as number);
    minY = Math.min(minY, raw[i + 1] as number);
    maxY = Math.max(maxY, raw[i + 1] as number);
  }
  const out: number[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    out.push((((raw[i] as number) - minX) / (maxX - minX)) * w, (((raw[i + 1] as number) - minY) / (maxY - minY)) * h);
  }
  return out;
};

const OUTLINES: Readonly<Record<BoxKind, Outline>> = {
  rect: rectPoly,
  ellipse: (w, h) => ellipsePoly(w, h),
  triangle: trianglePoly,
  diamond: diamondPoly,
  star: starPoly,
};

/** The props after the style bar changed `style`. */
function styled(props: BoxProps, style: Parameters<NonNullable<KindDef<BoxProps>['applyStyle']>>[1]): Partial<BoxProps> {
  return {
    ...(style.color !== undefined ? { stroke: style.color } : {}),
    ...(style.fill !== undefined ? { fill: style.fill } : {}),
    ...(style.dash !== undefined ? { dash: style.dash } : {}),
    ...(style.size !== undefined ? { size: Math.min(SIZE_MAX, Math.max(0.5, style.size)) } : {}),
    ...(style.font !== undefined ? { font: style.font } : {}),
  };
}

export function checkBox(props: unknown, what: string): BoardResult<BoxProps> {
  const p = bagOf(props, what);
  if (failed(p)) return p;
  const w = readNumber(p, 'w', BOX_DEFAULTS.w, DIM_MIN, DIM_MAX);
  const h = readNumber(p, 'h', BOX_DEFAULTS.h, DIM_MIN, DIM_MAX);
  const fill = readFill(p, 'fill', BOX_DEFAULTS.fill);
  const stroke = readColor(p, 'stroke', BOX_DEFAULTS.stroke);
  const dash = readEnum(p, 'dash', BOX_DEFAULTS.dash, DASHES);
  const size = readNumber(p, 'size', BOX_DEFAULTS.size, 0.5, SIZE_MAX);
  const label = readText(p, 'label', '', TEXT_MAX);
  const font = readEnum(p, 'font', BOX_DEFAULTS.font, FONT_FAMILIES);
  const error = firstError(w, h, fill, stroke, dash, size, label, font);
  if (error !== undefined) return error;
  return ok({ w, h, fill, stroke, dash, size, label, font } as BoxProps);
}

/** The outline of a box shape as a path: the ellipse is made of curves, the rest of straight sides. */
function outlinePath(kind: BoxKind, w: number, h: number): PathData {
  return kind === 'ellipse' ? ellipsePath(w, h) : polygonPath(OUTLINES[kind](w, h));
}

function boxKind(kind: BoxKind): KindDef<BoxProps> {
  const outline = OUTLINES[kind];
  return {
    kind,
    defaults: BOX_DEFAULTS,
    check: (props) => checkBox(props, kind),
    geometry(shape: ShapeRecord<string, BoxProps>): KindGeometry {
      const { w, h, fill, size, label } = shape.props;
      const poly = outline(w, h);
      const solid = fill !== 'none' || label !== '';
      return {
        box: { minX: 0, minY: 0, maxX: w, maxY: h },
        pad: size / 2 + 1,
        poly,
        hit: (x, y, tol) => (solid && inPolygon(x, y, poly)) || distToPath(x, y, poly, true) <= size / 2 + tol,
      };
    },
    draw(shape: ShapeRecord<string, BoxProps>, lod: DrawLod): readonly Part[] {
      const { w, h, fill, stroke, dash, size, label, font } = shape.props;
      const parts: Part[] = [pathPart(outlinePath(kind, w, h), cssOrNull(fill), stroke, size, lod === 'full' ? dashFor(dash, size) : [])];
      if (lod === 'full' && label !== '') {
        const room = Math.max(8, w - 2 * LABEL_PAD);
        const laid = layoutText(label, LABEL_PX, font, stroke, room, 'center');
        parts.push(...textParts(laid, (w - laid.w) / 2, (h - laid.h) / 2, font));
      }
      return parts;
    },
    onResize: (_shape, box) => ({ w: Math.max(DIM_MIN, box.maxX - box.minX), h: Math.max(DIM_MIN, box.maxY - box.minY) }),
    applyStyle: styled,
    text: { get: (p) => p.label, set: (_p, text) => ({ label: text }) },
  };
}

export const rectKind: KindDef<BoxProps> = boxKind('rect');
export const ellipseKind: KindDef<BoxProps> = boxKind('ellipse');
export const triangleKind: KindDef<BoxProps> = boxKind('triangle');
export const diamondKind: KindDef<BoxProps> = boxKind('diamond');
export const starKind: KindDef<BoxProps> = boxKind('star');
