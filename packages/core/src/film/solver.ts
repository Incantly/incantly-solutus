import type { ViewBox } from '../api/types';
import type { Box } from '../scene/bounds';

/**
 * The film layout solver: captions in a band outside the drawing, callouts in
 * slots that cover no part, titles as cards or lower thirds. The agent gives
 * no coordinates; the solver measures the bundled fonts after loading and
 * places every word, and the film checks verify the result.
 */

/** Safe margin inside the drawing, as a share of its smaller side. */
export const SAFE_MARGIN_SHARE = 0.05;

/** Smallest caption text, in pixels. */
export const CAPTION_MIN_PX = 12;

/** Smallest caption text as a share of the drawing's height. */
export const CAPTION_MIN_STAGE_SHARE = 0.03;

/** Most caption lines before the solver shrinks, then splits, then fails. */
export const CAPTION_MAX_LINES = 2;

/** Bundled font stack captions and callouts are measured in. */
export const FILM_FONT_STACK = "system-ui, -apple-system, 'Segoe UI', sans-serif";

export type MeasureText = (text: string, fontPx: number) => number;

let canvas: { getContext(kind: '2d'): { font: string; measureText(text: string): { width: number } } | null } | null = null;

/**
 * Measures a run of text in the bundled stack. Uses a canvas once fonts have
 * loaded; anywhere without one (the offline checks) falls back to a
 * deterministic per-character advance, so layout never depends on the device.
 */
export function measureFilmText(text: string, fontPx: number, measure?: MeasureText): number {
  if (measure) return measure(text, fontPx);
  try {
    const doc = (globalThis as { document?: Document }).document;
    if (doc) {
      canvas ??= doc.createElement('canvas') as unknown as typeof canvas;
      const context = canvas?.getContext('2d');
      if (context) {
        context.font = `${fontPx}px ${FILM_FONT_STACK}`;
        return context.measureText(text).width;
      }
    }
  } catch {
    // A canvas that fails measures like there being none.
  }
  return fallbackWidth(text, fontPx);
}

/** Deterministic advance per character: narrow, wide and ordinary. */
export function fallbackWidth(text: string, fontPx: number): number {
  let units = 0;
  for (const char of text) {
    if (char === ' ' || char === '\t') units += 0.28;
    else if ('il.,:;|\'!'.includes(char)) units += 0.3;
    else if ('mwMW@%'.includes(char)) units += 0.78;
    else if ('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.includes(char)) units += 0.62;
    else units += 0.5;
  }
  return units * fontPx;
}

/** Resolves once the bundled fonts have loaded, so measuring matches watching. */
export function fontsReady(): Promise<void> {
  try {
    const fonts = (globalThis as { document?: { fonts?: { ready?: Promise<unknown> } } }).document?.fonts;
    if (fonts?.ready) return fonts.ready.then(() => undefined);
  } catch {
    // No font loading: measuring falls back deterministically.
  }
  return Promise.resolve();
}

/** Greedy word wrap; a word longer than the line takes a line of its own. */
export function wrapText(text: string, maxWidth: number, fontPx: number, measure?: MeasureText): string[] {
  const words = text.trim().split(/\s+/).filter((word) => word !== '');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line === '' ? word : `${line} ${word}`;
    if (measureFilmText(next, fontPx, measure) <= maxWidth || line === '') line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

export interface CaptionLayout {
  readonly fontPx: number;
  readonly lineHeightPx: number;
  /** At most two lines; when overflowing, the first two, for the checks to fail. */
  readonly lines: readonly string[];
  readonly bandHeightPx: number;
  /** True when the words do not fit even at the floor: split or shorten them. */
  readonly overflow: boolean;
}

export interface CaptionInput {
  readonly widthPx: number;
  readonly stageHeightPx: number;
  readonly measure?: MeasureText;
}

/**
 * Lays a caption out in its band outside the drawing: the solver's font, at
 * most two lines, shrinking to the floor before it overflows.
 */
export function solveCaption(say: string, input: CaptionInput): CaptionLayout {
  const pad = 12;
  const maxWidth = Math.max(40, input.widthPx - pad * 2);
  const floor = Math.max(CAPTION_MIN_PX, input.stageHeightPx * CAPTION_MIN_STAGE_SHARE);
  let fontPx = Math.min(20, Math.max(13, input.widthPx * 0.03));
  fontPx = Math.max(fontPx, Math.min(floor, 20));
  let lines = wrapText(say, maxWidth, fontPx, input.measure);
  while (lines.length > CAPTION_MAX_LINES && fontPx > floor + 1e-9) {
    fontPx = Math.max(floor, fontPx - 1);
    lines = wrapText(say, maxWidth, fontPx, input.measure);
  }
  const overflow = lines.length > CAPTION_MAX_LINES;
  const shown = overflow ? lines.slice(0, CAPTION_MAX_LINES) : lines;
  const lineHeightPx = fontPx * 1.35;
  return { fontPx, lineHeightPx, lines: shown, bandHeightPx: shown.length * lineHeightPx + pad * 2, overflow };
}

/** A callout chip the solver places: its anchor on the part and its text. */
export interface CalloutRequest {
  readonly id: string;
  /** Anchor in stage units, usually the part's top edge. */
  readonly at: readonly [number, number];
  readonly text: string;
}

export interface CalloutPlacement {
  readonly id: string;
  /** Chip rect in stage units. */
  readonly rect: Box;
  /** Leader from the anchor to the chip's edge, in stage units. */
  readonly leader: readonly [readonly [number, number], readonly [number, number]];
}

export interface CalloutInput {
  readonly viewBox: ViewBox;
  /** Rendered drawing width in pixels, mapping chip pixels to stage units. */
  readonly stageWidthPx: number;
  /** Part boxes in stage units; no chip may cover one. */
  readonly occupied: readonly Box[];
  readonly fontPx?: number;
  readonly measure?: MeasureText;
}

/** Slot preference around the anchor: above first, then the clock. */
const SLOTS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0.7, -0.7],
  [1, 0],
  [0.7, 0.7],
  [0, 1],
  [-0.7, 0.7],
  [-1, 0],
  [-0.7, -0.7],
];

/**
 * Places callout chips in slots around their anchors. A slot that overlaps a
 * part, another chip or the safe margin is rejected; what places nowhere is
 * reported, for the checks to fail.
 */
export function solveCallouts(
  requests: readonly CalloutRequest[],
  input: CalloutInput,
): { readonly placed: readonly CalloutPlacement[]; readonly failed: readonly string[] } {
  const [vx, vy, vw, vh] = input.viewBox;
  const margin = Math.min(vw, vh) * SAFE_MARGIN_SHARE;
  const safe: Box = { minX: vx + margin, minY: vy + margin, maxX: vx + vw - margin, maxY: vy + vh - margin };
  const scale = input.stageWidthPx / vw;
  const fontPx = input.fontPx ?? 14;
  const padPx = 8;
  const gapPx = 6;
  const placed: CalloutPlacement[] = [];
  const failed: string[] = [];
  const taken: Box[] = [...input.occupied];
  for (const request of requests) {
    const textWidth = measureFilmText(request.text, fontPx, input.measure);
    const chipW = (textWidth + padPx * 2) / scale;
    const chipH = (fontPx * 1.35 + padPx * 2) / scale;
    const gap = gapPx / scale;
    const [ax, ay] = request.at;
    let done: CalloutPlacement | null = null;
    for (const [dx, dy] of SLOTS) {
      const cx = ax + dx * (chipW / 2 + gap);
      const cy = ay + dy * (chipH / 2 + gap);
      const rect: Box = { minX: cx - chipW / 2, minY: cy - chipH / 2, maxX: cx + chipW / 2, maxY: cy + chipH / 2 };
      if (rect.minX < safe.minX || rect.minY < safe.minY || rect.maxX > safe.maxX || rect.maxY > safe.maxY) continue;
      if (taken.some((box) => overlaps(rect, box))) continue;
      taken.push(rect);
      done = { id: request.id, rect, leader: [[ax, ay], [cx, cy]] };
      break;
    }
    if (done) placed.push(done);
    else failed.push(request.id);
  }
  return { placed, failed };
}

function overlaps(a: Box, b: Box): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

/** A title card's rect in stage units: top-centered, clear of the margins. Lower thirds live in the caption band. */
export function titleCardRect(viewBox: ViewBox): Box {
  const [vx, vy, vw, vh] = viewBox;
  const margin = Math.min(vw, vh) * SAFE_MARGIN_SHARE;
  const width = vw * 0.8;
  return { minX: vx + (vw - width) / 2, minY: vy + margin, maxX: vx + (vw + width) / 2, maxY: vy + margin + vh * 0.22 };
}

/** True when a rect covers any part of a box. */
export function covers(rect: Box, box: Box): boolean {
  return overlaps(rect, box);
}
