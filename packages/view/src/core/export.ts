/**
 * Export (graphics-view design 14): request validation, region resolution and
 * output viewports. The host runs the pipeline (snapshot, repaint, encode);
 * this file is the pure, testable core of it.
 */
import { okResult, viewError } from '../errors';
import type { Result } from '@incantly/kernel';
import {
  fitAllRegion, maths, viewportFromRegion, type MathsRect, type Viewport,
} from './coords';
import type { Rgba } from './styles';

export type ExportFormat = 'png' | 'svg' | 'script';

export type ExportRegion =
  | 'view'
  | 'objects'
  | { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number };

export interface ExportRequest {
  readonly format: ExportFormat;
  readonly region: ExportRegion;
  readonly size?: { readonly widthPx: number; readonly heightPx?: number };
  /** PNG multiplier (1, 2, 3). */
  readonly scale?: number;
  readonly background: 'view' | 'transparent' | Rgba;
  readonly layers?: 'all' | readonly number[];
  readonly includeGrid: boolean;
  readonly includeAxes: boolean;
  readonly includeWidgets?: boolean;
  /** Film time to render at; default is the current t. */
  readonly time?: number;
  readonly textAs?: 'text' | 'paths';
}

/** Max PNG side in pixels (errors.md 6). */
export const MAX_EXPORT_SIDE_PX = 16384;
/** Max SVG element count (errors.md 6). */
export const MAX_SVG_ELEMENTS = 50000;

export interface NormalizedExport {
  readonly format: ExportFormat;
  readonly region: MathsRect;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly scale: number;
  readonly background: 'view' | 'transparent' | Rgba;
  readonly layers: 'all' | readonly number[];
  readonly includeGrid: boolean;
  readonly includeAxes: boolean;
  readonly includeWidgets: boolean;
  readonly time: number | null;
  readonly textAs: 'text' | 'paths';
}

export interface ExportContext {
  /** Current view bounds, for `region: 'view'`. */
  readonly viewBounds: MathsRect;
  /** Union input for `region: 'objects'`. */
  readonly objectBounds: readonly MathsRect[];
  /** Current film time, for the default `time`. */
  readonly nowT: number;
  /** True when the source view keeps an equal ratio. */
  readonly equalRatio: boolean;
  /** Pixels per unit of the source view, for the 12 px minimum pad. */
  readonly pxPerUnit: number;
}

function fail(option: string, got: string, expected: string): Result<NormalizedExport> {
  return viewError({
    kind: 'bad_argument',
    messageKey: 'view.bad_argument',
    params: { what: `export option ${option}`, why: `got ${got}; expected ${expected}` },
    token: got,
    hint: `Choose ${expected}.`,
  });
}

/** Validate a request and resolve its region and output size. */
export function normalizeExport(req: ExportRequest, ctx: ExportContext): Result<NormalizedExport> {
  if (req.format !== 'png' && req.format !== 'svg' && req.format !== 'script') {
    return fail('format', String(req.format), 'png, svg or script');
  }
  const scale = req.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) return fail('scale', String(req.scale), 'a positive number');
  let region: MathsRect;
  if (req.region === 'view') {
    region = ctx.viewBounds;
  } else if (req.region === 'objects') {
    const fit = fitAllRegion(ctx.objectBounds.length > 0 ? ctx.objectBounds : [ctx.viewBounds]);
    if (fit === null) return fail('region', 'objects', 'a non-empty figure');
    // Minimum 12 px pad.
    const minPad = 12 / Math.max(ctx.pxPerUnit, 1e-9);
    const w = (fit.x1 as number) - (fit.x0 as number);
    const h = (fit.y1 as number) - (fit.y0 as number);
    const ex = Math.max(0, (minPad * 2 - w) / 2);
    const ey = Math.max(0, (minPad * 2 - h) / 2);
    region = {
      x0: maths((fit.x0 as number) - ex),
      x1: maths((fit.x1 as number) + ex),
      y0: maths((fit.y0 as number) - ey),
      y1: maths((fit.y1 as number) + ey),
    };
  } else {
    const r = req.region;
    if (!(r.x1 > r.x0) || !(r.y1 > r.y0) || ![r.x0, r.x1, r.y0, r.y1].every(Number.isFinite)) {
      return fail('region', `${r.x0} ${r.x1} ${r.y0} ${r.y1}`, 'x0 < x1 and y0 < y1');
    }
    region = { x0: maths(r.x0), x1: maths(r.x1), y0: maths(r.y0), y1: maths(r.y1) };
  }
  const widthPx = Math.round(req.size?.widthPx ?? 1200);
  if (!(widthPx > 0)) return fail('size.widthPx', String(req.size?.widthPx), 'a positive width');
  const regionW = (region.x1 as number) - (region.x0 as number);
  const regionH = (region.y1 as number) - (region.y0 as number);
  const heightPx = req.size?.heightPx !== undefined
    ? Math.round(req.size.heightPx)
    : Math.max(1, Math.round((widthPx * regionH) / Math.max(regionW, 1e-300)));
  if (!(heightPx > 0)) return fail('size.heightPx', String(req.size?.heightPx), 'a positive height');
  if (req.format === 'png' && (widthPx * scale > MAX_EXPORT_SIDE_PX || heightPx * scale > MAX_EXPORT_SIDE_PX)) {
    return viewError({
      kind: 'limit',
      messageKey: 'view.limit',
      params: { max: MAX_EXPORT_SIDE_PX, what: 'export pixels per side' },
      token: `${widthPx}x${heightPx}@${scale}x`,
      hint: `Choose ${MAX_EXPORT_SIDE_PX} pixels or less per side.`,
    });
  }
  const layers = req.layers ?? 'all';
  if (layers !== 'all' && !layers.every((l) => Number.isInteger(l) && l >= 0 && l <= 9)) {
    return fail('layers', 'all or 0..9', 'all or layer numbers 0..9');
  }
  const time = req.time ?? null;
  if (time !== null && (!Number.isFinite(time) || time < 0)) return fail('time', String(req.time), 'a time >= 0');
  return okResult({
    format: req.format,
    region,
    widthPx,
    heightPx,
    scale,
    background: req.background,
    layers,
    includeGrid: req.includeGrid,
    includeAxes: req.includeAxes,
    includeWidgets: req.includeWidgets ?? false,
    time,
    textAs: req.textAs ?? 'text',
  });
}

/**
 * Fresh output viewport for the export size. Aspect follows the region;
 * `equal` is kept when the source view has it (design 14.2).
 */
export function exportViewport(exp: NormalizedExport, equalRatio: boolean, dpr = 1): Result<Viewport> {
  return viewportFromRegion(
    exp.region,
    exp.widthPx,
    exp.heightPx,
    equalRatio ? 'equal' : 'free',
    dpr,
  );
}

/** Round to 2 decimals for SVG path data (design 14.2). */
export function svgRound(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

/** Escape text for SVG `<text>` elements. */
export function svgEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Sanitise an object name into an SVG id (ids are the object names). */
export function svgId(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9_.:-]/g, '_');
  return /^[A-Za-z_]/.test(clean) ? clean : `o_${clean}`;
}
