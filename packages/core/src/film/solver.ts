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

/**
 * Splits a beat's words into caption pages, each wrapping to at most two
 * lines at the given size: the player shows the page holding the sounding
 * word, so long lines page instead of truncating. Always progresses, so
 * every word lands on exactly one page.
 */
export function pageCaptionWords(
  words: readonly string[],
  input: { maxWidthPx: number; fontPx: number; measure?: MeasureText },
): ReadonlyArray<{ readonly start: number; readonly end: number }> {
  const pages: Array<{ start: number; end: number }> = [];
  let start = 0;
  while (start < words.length) {
    let end = start + 1;
    while (end <= words.length) {
      const lines = wrapText(words.slice(start, end).join(' '), input.maxWidthPx, input.fontPx, input.measure);
      if (lines.length > CAPTION_MAX_LINES) break;
      end += 1;
    }
    end = Math.max(start + 1, end - 1);
    pages.push({ start, end });
    start = end;
  }
  return pages;
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

/** Stage width under which notes stack under the stage instead of splitting beside it. */
export const NOTES_STACK_BELOW_PX = 640;

/** Share of the frame width the stage keeps when a scene splits for notes; the notes column takes the rest. */
export const NOTES_SPLIT_STAGE_SHARE = 0.62;

/**
 * A split scene's layout at a frame width: the full stage, the stage beside
 * its notes column, or the full stage with notes stacked under it. Pure, so
 * the player, the checks and the export all lay the same scene out the same
 * way — and every beat of a split scene shares it, so seeking never
 * re-lays the stage.
 */
export function splitLayout(split: boolean, stageWidthPx: number): 'full' | 'side' | 'stack' {
  if (!split) return 'full';
  return stageWidthPx < NOTES_STACK_BELOW_PX ? 'stack' : 'side';
}

/** The stage's pixel width in a layout: narrowed beside its notes column, full otherwise. */
export function layoutStageWidth(stageWidthPx: number, layout: 'full' | 'side' | 'stack'): number {
  return layout === 'side' ? stageWidthPx * NOTES_SPLIT_STAGE_SHARE : stageWidthPx;
}

/** The notes column's pixel width beside a split stage. */
export function notesColumnWidth(stageWidthPx: number): number {
  return stageWidthPx * (1 - NOTES_SPLIT_STAGE_SHARE);
}

/** Superscript forms the math renderer knows; anything else stays literal. */
const SUPERSCRIPT: Readonly<Record<string, string>> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  n: 'ⁿ',
};

/**
 * Renders simple math notation readably: `^2` rises, `*` becomes ×, and a
 * few words become symbols. Never a TeX engine: anything unrecognized stays
 * literal, so plain text passes through unchanged.
 */
export function renderMathText(text: string): string {
  return text
    .replace(/\^([0-9+\-n]+)/g, (_, run: string) => [...run].map((char) => SUPERSCRIPT[char] ?? char).join(''))
    .replace(/<=/g, '≤')
    .replace(/>=/g, '≥')
    .replace(/!=/g, '≠')
    .replace(/->/g, '→')
    .replace(/\*/g, '×')
    .replace(/\bsqrt\b/g, '√')
    .replace(/\bpi\b/g, 'π')
    .replace(/\btheta\b/g, 'θ')
    .replace(/\b[Dd]elta\b/g, 'Δ');
}

export interface WriteInput {
  readonly viewBox: ViewBox;
  /** Rendered drawing width in pixels, mapping chip pixels to stage units. */
  readonly stageWidthPx: number;
  /** Part and chip boxes in stage units; the chip may cover none. */
  readonly occupied: readonly Box[];
  readonly fontPx?: number;
  readonly measure?: MeasureText;
}

export interface WritePlacement {
  /** Chip rect in stage units. */
  readonly rect: Box;
  readonly lines: readonly string[];
  readonly fontPx: number;
  /**
   * Which corner slot placed: 0 is the top-left first preference, then the
   * other corners in reading order. The player and the export always draw
   * slot 0, so the checks require it.
   */
  readonly slot: number;
}

/**
 * Places a write-on chip in a safe-area corner that covers no part. Corners
 * in reading order, top-left first; what places nowhere is null, for the
 * checks to fail.
 */
export function solveWrite(text: string, input: WriteInput): WritePlacement | null {
  const [vx, vy, vw, vh] = input.viewBox;
  const margin = Math.min(vw, vh) * SAFE_MARGIN_SHARE;
  const safe: Box = { minX: vx + margin, minY: vy + margin, maxX: vx + vw - margin, maxY: vy + vh - margin };
  const scale = input.stageWidthPx / vw;
  // The caption scale, so layer text clears the same stage-share floor the checks enforce.
  const fontPx = input.fontPx ?? Math.min(20, Math.max(13, input.stageWidthPx * 0.03));
  const padPx = 8;
  const maxWidthPx = Math.max(40, ((safe.maxX - safe.minX) * scale) / 2);
  const lines = wrapText(text, maxWidthPx, fontPx, input.measure);
  const widest = lines.reduce((max, line) => Math.max(max, measureFilmText(line, fontPx, input.measure)), 0);
  const chipW = (widest + padPx * 2) / scale;
  const chipH = (lines.length * fontPx * 1.35 + padPx * 2) / scale;
  const corners: ReadonlyArray<readonly [number, number]> = [
    [safe.minX, safe.minY],
    [safe.maxX - chipW, safe.minY],
    [safe.minX, safe.maxY - chipH],
    [safe.maxX - chipW, safe.maxY - chipH],
  ];
  for (let slot = 0; slot < corners.length; slot++) {
    const [x, y] = corners[slot]!;
    const rect: Box = { minX: x, minY: y, maxX: x + chipW, maxY: y + chipH };
    if (rect.minX < safe.minX || rect.minY < safe.minY || rect.maxX > safe.maxX || rect.maxY > safe.maxY) continue;
    if (input.occupied.some((box) => overlaps(rect, box))) continue;
    return { rect, lines, fontPx, slot };
  }
  return null;
}

export type NotesLayoutKind = 'side' | 'stack';

export interface NotesInput {
  readonly viewBox: ViewBox;
  readonly stageWidthPx: number;
  readonly measure?: MeasureText;
}

export interface NotesLayout {
  readonly kind: NotesLayoutKind;
  /**
   * Stack only: the overlay strip along the bottom of the safe area, in
   * stage units, where narrow frames paint the notes over the drawing. Null
   * beside the stage, where the notes column stands outside the drawing and
   * covers nothing by construction.
   */
  readonly panel: Box | null;
  readonly fontPx: number;
  /** One wrapped line list per note. */
  readonly lines: readonly (readonly string[])[];
}

/**
 * Lays notes out in the column beside a split stage on wide stages, and in
 * a fixed strip along the bottom of the safe area on narrow ones. The strip
 * is a fixed slot, so the film checks can verify it against the parts; the
 * export paints it there, and scenes keep that slot clear.
 */
export function solveNotes(notes: readonly string[], input: NotesInput): NotesLayout {
  const [vx, vy, vw, vh] = input.viewBox;
  const margin = Math.min(vw, vh) * SAFE_MARGIN_SHARE;
  const scale = input.stageWidthPx / vw;
  // The caption scale, so note text clears the same stage-share floor the checks enforce.
  const fontPx = Math.min(20, Math.max(13, input.stageWidthPx * 0.03));
  const padPx = 10;
  if (input.stageWidthPx < NOTES_STACK_BELOW_PX) {
    const panelW = vw - margin * 2;
    const maxWidthPx = Math.max(40, panelW * scale - padPx * 2);
    const lines = notes.map((note) => wrapText(note, maxWidthPx, fontPx, input.measure));
    const stripH = lines.reduce((sum, group) => sum + group.length * fontPx * 1.4, 0) + padPx * 2;
    return {
      kind: 'stack',
      panel: { minX: vx + margin, minY: vy + vh - margin - stripH / scale, maxX: vx + vw - margin, maxY: vy + vh - margin },
      fontPx,
      lines,
    };
  }
  const maxWidthPx = Math.max(40, notesColumnWidth(input.stageWidthPx) - padPx * 2);
  const lines = notes.map((note) => wrapText(note, maxWidthPx, fontPx, input.measure));
  return { kind: 'side', panel: null, fontPx, lines };
}

