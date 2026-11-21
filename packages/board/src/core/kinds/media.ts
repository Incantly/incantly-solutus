/**
 * `image` (a picture held in an asset record) and `figure` (a live Incantly figure; round 3 stores it and shows a
 * placeholder card, the live card comes in round 4) (design 7.1, 8).
 */
import { boardError, ok } from '../errors';
import type { BoardError, BoardResult } from '../errors';
import { FONT_FAMILIES, pathPart, roundRectPath } from '../paint';
import type { Part } from '../paint';
import { layoutText, textParts } from '../text';
import type { ShapeRecord } from '../types';
import type { DrawLod, KindDef, KindGeometry } from './def';
import { DIM_MAX, DIM_MIN, bad, bagOf, failed, firstError, readNumber, readText } from './props';

// ---------------------------------------------------------------------------------------------------------------
// image

/** The part of the picture to show, as fractions (0 to 1) of its width and height. */
export interface Crop {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface ImageProps {
  /** `asset:…` */
  readonly asset: string;
  readonly w: number;
  readonly h: number;
  readonly crop: Crop | null;
}

export const IMAGE_DEFAULTS: ImageProps = Object.freeze({ asset: 'asset:none', w: 200, h: 150, crop: null });

function checkCrop(v: unknown): Crop | null | BoardError {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object' || Array.isArray(v)) return bad('props.crop', 'crop must be null or { x, y, w, h }.');
  const c = v as Record<string, unknown>;
  const n = (k: string): number | undefined => (typeof c[k] === 'number' && Number.isFinite(c[k]) ? (c[k] as number) : undefined);
  const x = n('x');
  const y = n('y');
  const w = n('w');
  const h = n('h');
  if (x === undefined || y === undefined || w === undefined || h === undefined || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.000001 || y + h > 1.000001) {
    return bad('props.crop', 'crop must have x, y, w and h from 0 to 1, inside the picture.');
  }
  return { x, y, w, h };
}

export const imageKind: KindDef<ImageProps> = {
  kind: 'image',
  defaults: IMAGE_DEFAULTS,
  check(props: unknown): BoardResult<ImageProps> {
    const p = bagOf(props, 'An image');
    if (failed(p)) return p;
    const asset = p['asset'] ?? IMAGE_DEFAULTS.asset;
    if (typeof asset !== 'string' || !asset.startsWith('asset:') || asset.length <= 6) return bad('props.asset', 'asset must be the id of an asset record (asset:…).');
    const w = readNumber(p, 'w', IMAGE_DEFAULTS.w, DIM_MIN, DIM_MAX);
    const h = readNumber(p, 'h', IMAGE_DEFAULTS.h, DIM_MIN, DIM_MAX);
    const crop = checkCrop(p['crop']);
    const error = firstError(w, h, crop);
    if (error !== undefined) return error;
    return ok({ asset, w, h, crop } as ImageProps);
  },
  geometry(shape: ShapeRecord<string, ImageProps>): KindGeometry {
    const { w, h } = shape.props;
    return { box: { minX: 0, minY: 0, maxX: w, maxY: h }, pad: 1, hit: (x, y, tol) => x >= -tol && y >= -tol && x <= w + tol && y <= h + tol };
  },
  draw(shape: ShapeRecord<string, ImageProps>): readonly Part[] {
    const { asset, w, h, crop } = shape.props;
    return [{ k: 'image', asset, x: 0, y: 0, w, h, crop }];
  },
  onResize: (_shape, box) => ({ w: Math.max(DIM_MIN, box.maxX - box.minX), h: Math.max(DIM_MIN, box.maxY - box.minY) }),
};

// ---------------------------------------------------------------------------------------------------------------
// figure

export interface FigureProps {
  /** The Incantly script: the only source of truth. */
  readonly script: string;
  /** The figure's mode, one of the SDK's: `graphing`, `geometry`, `graphing3d`, … (`graph` and `3d` are read as `graphing` and `graphing3d`). */
  readonly mode: string;
  readonly w: number;
  readonly h: number;
  /** A cached picture (an SVG or PNG data URL), or null. */
  readonly picture: string | null;
}

export const FIGURE_DEFAULTS: FigureProps = Object.freeze({ script: '# incantly 1\n', mode: 'graphing', w: 360, h: 260, picture: null });
export const SCRIPT_MAX = 1_000_000;
export const FIGURE_HEADER = '# incantly 1';

export const figureKind: KindDef<FigureProps> = {
  kind: 'figure',
  defaults: FIGURE_DEFAULTS,
  check(props: unknown): BoardResult<FigureProps> {
    const p = bagOf(props, 'A figure card');
    if (failed(p)) return p;
    const script = readText(p, 'script', FIGURE_DEFAULTS.script, SCRIPT_MAX);
    const mode = readText(p, 'mode', FIGURE_DEFAULTS.mode, 40);
    const w = readNumber(p, 'w', FIGURE_DEFAULTS.w, DIM_MIN, DIM_MAX);
    const h = readNumber(p, 'h', FIGURE_DEFAULTS.h, DIM_MIN, DIM_MAX);
    const picture = p['picture'] ?? null;
    const error = firstError(script, mode, w, h);
    if (error !== undefined) return error;
    if (picture !== null && typeof picture !== 'string') return boardError('record_invalid', 'picture must be null or text.', { detail: { field: 'props.picture' } });
    if (typeof mode === 'string' && mode === '') return bad('props.mode', 'mode must not be empty.');
    return ok({ script, mode, w, h, picture } as FigureProps);
  },
  geometry(shape: ShapeRecord<string, FigureProps>): KindGeometry {
    const { w, h } = shape.props;
    return { box: { minX: 0, minY: 0, maxX: w, maxY: h }, pad: 2, hit: (x, y, tol) => x >= -tol && y >= -tol && x <= w + tol && y <= h + tol };
  },
  draw(shape: ShapeRecord<string, FigureProps>, lod: DrawLod): readonly Part[] {
    const { script, mode, w, h } = shape.props;
    const parts: Part[] = [pathPart(roundRectPath(0, 0, w, h, 10), '#f8fafc', '#cbd5e1', 2)];
    if (lod !== 'full') return parts;
    const title = layoutText(`Figure: ${mode}`, 14, 'sans', '#475569', w - 24, 'start');
    parts.push(...textParts(title, 12, 10, 'sans'));
    const lines = script
      .split('\n')
      .filter((l) => l !== '' && l !== FIGURE_HEADER)
      .slice(0, 8)
      .join('\n');
    if (lines !== '') parts.push(...textParts(layoutText(lines.replace(/\$/g, '\\$'), 12, FONT_FAMILIES[2] ?? 'mono', '#64748b', w - 24, 'start'), 12, 10 + title.h + 6, 'mono'));
    return parts;
  },
  onResize: (_shape, box) => ({ w: Math.max(DIM_MIN, box.maxX - box.minX), h: Math.max(DIM_MIN, box.maxY - box.minY) }),
};
