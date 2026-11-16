/**
 * Export (embed-files-export design 5; errors 4; .kiro/specs/sdk R4): PNG and SVG of the view or of everything, at a
 * film time. The same painter as the screen draws into a canvas (PNG) or into an SVG context, so what is saved is what
 * is seen. A time other than now is drawn from a copy of the figure: the live one does not move.
 */
import type { App } from './app';
import { createHeadlessApp } from './app';
import type { ApiError } from './errors';
import { apiError } from './errors';
import { frameStyle, paintScene, sceneBounds } from './screen/paint';
import type { SceneItem } from './screen/paint';
import { sceneOf } from './screen/scene';
import type { SceneOptions } from './screen/scene';
import { Viewport } from './screen/viewport';
import { SvgContext } from './svg-context';
import { space } from '@incantly/kernel';
import { paintSpace } from './screen/space/paint3';
import { sceneOf3 } from './screen/space/scene3';

export const EXPORT_LIMITS = Object.freeze({ side: 8192, megapixels: 64, svgElements: 50_000 });

export type ExportRegion = 'view' | 'all' | { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number };

export type ExportOptions =
  | { readonly format: 'png'; readonly scale?: number; readonly width?: number; readonly height?: number; readonly transparent?: boolean; readonly region?: ExportRegion; readonly t?: number; readonly view?: '2d' | '3d' }
  | { readonly format: 'svg'; readonly width?: number; readonly height?: number; readonly transparent?: boolean; readonly region?: ExportRegion; readonly t?: number; readonly view?: '2d' | '3d' }
  | { readonly format: 'pdf' | 'gif' | 'webm' | 'mp4' | 'print' | 'tikz' };

export interface ExportWarning {
  readonly kind: string;
  readonly message: string;
}

export interface ExportResult {
  readonly ok: true;
  readonly format: 'png' | 'svg';
  readonly blob: Blob;
  /** The SVG text (SVG only). */
  readonly text?: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly warnings: readonly ExportWarning[];
}

/** Where a PNG is drawn: a canvas of a size (the browser's by default; a host or a test gives its own). */
export type CanvasFactory = (width: number, height: number) => { getContext(kind: '2d'): unknown; toBlob?(cb: (b: Blob | null) => void, type: string): void; convertToBlob?(o: { type: string }): Promise<Blob> } | undefined;

export interface ExportEnv {
  readonly canvas?: CanvasFactory;
  /** How the screen colours and hides objects, so the export matches it. */
  readonly scene?: SceneOptions;
}

export const EXPORT_FORMATS: readonly string[] = ['png', 'svg'];

const defaultCanvas: CanvasFactory = (w, h) => {
  const doc = (globalThis as { document?: { createElement(t: 'canvas'): HTMLCanvasElement } }).document;
  if (doc) {
    const c = doc.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  const Off = (globalThis as { OffscreenCanvas?: new (w: number, h: number) => OffscreenCanvas }).OffscreenCanvas;
  return Off ? (new Off(w, h) as unknown as ReturnType<CanvasFactory>) : undefined;
};

type Box = { x0: number; x1: number; y0: number; y1: number };

/** The maths window of the export. */
function regionBox(app: App, items: readonly SceneItem[], region: ExportRegion): Box | ApiError {
  if (region === 'view') {
    const v = app.view.get();
    return { x0: v.x0, x1: v.x1, y0: v.y0, y1: v.y1 };
  }
  if (region === 'all') {
    const b = sceneBounds(items);
    if (!b) return apiError('export', 'export_empty', 'Nothing visible to export.', { hint: "Set region: 'view'." });
    const pw = (b.x1 - b.x0 || 2) * 0.05;
    const ph = (b.y1 - b.y0 || 2) * 0.05;
    return { x0: b.x0 - pw, x1: b.x1 + pw, y0: b.y0 - ph, y1: b.y1 + ph };
  }
  if (![region.x0, region.x1, region.y0, region.y1].every(Number.isFinite) || !(region.x0 < region.x1) || !(region.y0 < region.y1)) {
    return apiError('export', 'bad_argument', 'The region needs x0 < x1 and y0 < y1, all finite.', { detail: { argument: 'region' } });
  }
  return region;
}

/** A viewport of `w` x `h` pixels that shows exactly `box`. */
function viewportOf(box: Box, w: number, h: number): Viewport {
  const vp = new Viewport();
  vp.resize(w, h);
  vp.cx = (box.x0 + box.x1) / 2;
  vp.cy = (box.y0 + box.y1) / 2;
  vp.ppu = w / (box.x1 - box.x0);
  vp.ppuY = h / (box.y1 - box.y0);
  return vp;
}

/** Paints with the figure's own axes and grid settings, and puts the screen's back after. */
function paintWith(app: App, ctx: unknown, vp: Viewport, items: readonly SceneItem[], background: string | undefined): void {
  const was = { ...frameStyle };
  const s = app.settings;
  frameStyle.axes = s.axes.x || s.axes.y;
  frameStyle.grid = s.grid;
  frameStyle.background = background ?? null;
  try {
    paintScene(ctx as CanvasRenderingContext2D, vp, items);
  } finally {
    Object.assign(frameStyle, was);
  }
}

/** The figure to draw: this one now, or a copy at film time `t`. */
function at(app: App, t: number | undefined): { app: App; done: () => void } | ApiError {
  if (t === undefined || t === app.clock.t) return { app, done: () => undefined };
  if (!Number.isFinite(t)) return apiError('export', 'export_bad_time', 'The time must be a finite number.', { detail: { t } });
  const range = app.figure.clockRange();
  if (t < range.from || t > range.to) {
    return apiError('export', 'export_bad_time', `The time ${t} is outside the film (${range.from} to ${Number.isFinite(range.to) ? range.to : 'no end'}).`, { detail: { t, from: range.from, to: range.to } });
  }
  const copy = createHeadlessApp({ mode: app.mode });
  copy.load(app.save());
  copy.clock.pause();
  copy.clock.seek(t);
  return { app: copy, done: () => copy.destroy() };
}

/** Exports the figure as a PNG or SVG picture (design 5). */
export async function exportFigure(app: App, opts: ExportOptions, env: ExportEnv = {}): Promise<ExportResult | ApiError> {
  if (typeof opts !== 'object' || opts === null || typeof opts.format !== 'string') throw new TypeError('export: it needs options with a format');
  if (app.destroyed) return apiError('api', 'destroyed', 'This app was destroyed.');
  if (opts.format !== 'png' && opts.format !== 'svg') {
    return apiError('export', 'export_unsupported', `${opts.format.toUpperCase()} export is not in this build.`, { hint: `Supported: ${EXPORT_FORMATS.join(', ')}.`, detail: { supported: EXPORT_FORMATS } });
  }
  const v = app.view.get();
  const scale = opts.format === 'png' ? (opts.scale ?? 2) : 1;
  if (!Number.isFinite(scale) || scale <= 0 || scale > 8) return apiError('export', 'bad_argument', 'The scale must be above 0 and at most 8.', { detail: { argument: 'scale' } });
  const cssW = Math.round(opts.width ?? v.widthPx);
  const cssH = Math.round(opts.height ?? v.heightPx);
  if (!(cssW > 0) || !(cssH > 0)) return apiError('export', 'bad_argument', 'The size must be above 0.', { detail: { argument: 'size' } });
  const w = Math.round(cssW * scale);
  const h = Math.round(cssH * scale);
  const limitScale = Math.min(EXPORT_LIMITS.side / cssW, EXPORT_LIMITS.side / cssH, Math.sqrt((EXPORT_LIMITS.megapixels * 1e6) / (cssW * cssH)));
  if (w > EXPORT_LIMITS.side || h > EXPORT_LIMITS.side || w * h > EXPORT_LIMITS.megapixels * 1e6) {
    const maxScale = Math.floor(limitScale * 10) / 10;
    return apiError('export', 'export_too_large', `A PNG of ${w} x ${h} px is over the limit of ${EXPORT_LIMITS.side} px a side or ${EXPORT_LIMITS.megapixels} megapixels.`, {
      hint: `Use scale ${maxScale} or less for this size.`,
      detail: { maxScale, limitMegapixels: EXPORT_LIMITS.megapixels },
    });
  }
  const src = at(app, opts.t);
  if ('ok' in src) return src;
  try {
    const items = sceneOf(src.app.figure, env.scene ?? {});
    // the Space view: the 3D app, or a host that asks (.kiro/specs/space-3d R3.4); its camera frames it, not a region
    const in3d = (opts.view ?? (src.app.mode === 'graphing3d' ? '3d' : '2d')) === '3d';
    const box = in3d ? { x0: -1, x1: 1, y0: -1, y1: 1 } : regionBox(src.app, items, opts.region ?? 'view');
    if ('ok' in box) return box;
    const warnings: ExportWarning[] = [];
    const background = opts.transparent ? undefined : '#ffffff';
    const draw = (ctx: unknown, bg: string | undefined): void => {
      if (!in3d) return paintWith(src.app, ctx, viewportOf(box, cssW, cssH), items, bg);
      const view = space.viewAt(src.app.figure);
      paintSpace(ctx as CanvasRenderingContext2D, view, cssW, cssH, sceneOf3(src.app.figure, view), { background: bg ?? null });
    };
    if (opts.format === 'svg') {
      const ctx = new SvgContext(cssW, cssH);
      // the background is one <rect> written by toString, not a painted path
      draw(ctx, undefined);
      if (ctx.elements > EXPORT_LIMITS.svgElements) warnings.push({ kind: 'svg_large', message: `The picture has ${ctx.elements} parts; some programs open it slowly.` });
      if (items.some((i) => i.type === 'Particles')) warnings.push({ kind: 'particles_sampled', message: 'Particles are drawn as they are now, one shape each.' });
      if (items.some((i) => i.type === 'Text' && i.text?.full)) warnings.push({ kind: 'latex_left_out', message: 'Texts typeset with full LaTeX are not in the SVG yet.' });
      const text = ctx.toString(background);
      const blob = new Blob([text], { type: 'image/svg+xml' });
      return { ok: true, format: 'svg', blob, text, width: cssW, height: cssH, bytes: blob.size, warnings };
    }
    const canvas = (env.canvas ?? defaultCanvas)(w, h);
    const ctx = canvas?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
    if (!canvas || !ctx) return apiError('export', 'export_unsupported', 'PNG export needs a canvas, and there is none here.', { hint: 'Export SVG instead, or export in a browser.', detail: { supported: ['svg'] } });
    ctx.save();
    ctx.scale(scale, scale);
    draw(ctx, background);
    ctx.restore();
    const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/png' }) : await new Promise<Blob | null>((res) => (canvas.toBlob ? canvas.toBlob(res, 'image/png') : res(null)));
    if (!blob) return apiError('export', 'export_oom', 'The picture could not be encoded.', { hint: 'Try a smaller scale.' });
    return { ok: true, format: 'png', blob, width: w, height: h, bytes: blob.size, warnings };
  } finally {
    src.done();
  }
}
