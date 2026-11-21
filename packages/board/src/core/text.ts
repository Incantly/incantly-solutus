/**
 * Text on the board: lines of plain words and `$…$` maths, typeset with the view package's maths layout (design 7.1).
 * The layout needs the width of a glyph, which only a canvas knows; the web view hands a measuring function in with
 * `setFontMeasure`, and until then (and in Node) a fixed table gives the widths, so the same text always lays out the
 * same way for a test. Layouts are cached by the text and what it was laid out with, and dropped when the measuring
 * function changes. No DOM, no timers.
 */
import { math } from '@incantly/view';
import type { MathItem } from '@incantly/view';
import { PATH_LINE, PATH_MOVE, PATH_CLOSE, pathPart } from './paint';
import type { FontFamily, Part } from './paint';

export type FontMeasure = (s: string, font: math.MathFont, px: number, family: FontFamily) => math.GlyphMetrics;

const rough: FontMeasure = (s, font, px) => math.roughMeasure(s, font, px);

/** What measures glyphs now, and a number that changes with it so cached layouts can tell. */
const measuring = { measure: rough, generation: 0 };
const cache = new Map<string, TextLayout>();
const CACHE_MAX = 600;

/** The web view calls this with a canvas measure; `null` goes back to the fixed table. Layouts and geometry made before are stale. */
export function setFontMeasure(measure: FontMeasure | null): void {
  measuring.measure = measure ?? rough;
  measuring.generation++;
  cache.clear();
}

/** Changes whenever `setFontMeasure` is called: a cache that depends on text size holds it with its entries. */
export const measureGeneration = (): number => measuring.generation;

/** The CSS font of a glyph; the plain-text font follows the shape's family, maths fonts follow the maths layout. */
export function cssFontFor(font: math.MathFont, family: FontFamily, px: number): string {
  if (font !== 'text') return math.cssFont(font, px);
  switch (family) {
    case 'serif':
      return `${px}px Georgia, "Times New Roman", serif`;
    case 'mono':
      return `${px}px ui-monospace, Menlo, Consolas, "DejaVu Sans Mono", monospace`;
    case 'hand':
      return `${px}px "Segoe Print", "Bradley Hand", "Comic Sans MS", "Chalkboard SE", cursive`;
    default:
      return `${px}px Inter, "Segoe UI", system-ui, sans-serif`;
  }
}

export type TextAlign = 'start' | 'center' | 'end';
export const TEXT_ALIGNS: readonly TextAlign[] = ['start', 'center', 'end'];

/** One laid-out line: items relative to the left end of its baseline, the baseline's distance from the block's top. */
export interface LaidLine {
  readonly items: readonly MathItem[];
  /** Left edge of the line within the block (for centre and end alignment). */
  readonly x: number;
  readonly baseline: number;
  readonly w: number;
}

export interface TextLayout {
  /** The block's width: the widest line, or the wrapping width when there is one. */
  readonly w: number;
  readonly h: number;
  readonly lines: readonly LaidLine[];
}

/** Line height as a multiple of the text size. */
export const LINE_HEIGHT = 1.3;

interface Token {
  readonly src: string;
  readonly space: boolean;
}

/** A paragraph as words, spaces and whole `$…$` runs: a run of maths is never broken across lines. */
function tokens(paragraph: string): Token[] {
  const out: Token[] = [];
  for (const run of math.splitMath(paragraph)) {
    if (run.kind === 'math') {
      out.push({ src: `$${run.s}$`, space: false });
      continue;
    }
    for (const piece of run.s.split(/( +)/)) {
      if (piece === '') continue;
      out.push({ src: piece.replace(/\$/g, '\\$'), space: piece[0] === ' ' });
    }
  }
  return out;
}

interface Laid {
  readonly w: number;
  readonly asc: number;
  readonly desc: number;
  readonly items: readonly MathItem[];
}

function shiftItems(items: readonly MathItem[], dx: number): MathItem[] {
  return items.map((it) => (it.k === 'path' ? { ...it, pts: it.pts.map(([x, y]) => [x + dx, y] as const) } : { ...it, x: it.x + dx }));
}

/** One line of text with maths in it: plain runs in the text font, `$…$` runs typeset; a run the subset cannot read shows its source. */
function layoutLine(src: string, px: number, family: FontFamily, color: string): Laid {
  const measure: math.Measure = (s, font, size) => measuring.measure(s, font, size, family);
  let x = 0;
  let asc = px * 0.72;
  let desc = px * 0.22;
  const items: MathItem[] = [];
  const plain = (s: string): Laid => {
    const m = measure(s, 'text', px);
    return { w: m.w, asc: m.asc, desc: m.desc, items: s === '' ? [] : [{ k: 'glyph', x: 0, y: 0, s, font: 'text', px, color }] };
  };
  for (const run of math.splitMath(src)) {
    let l: Laid;
    if (run.kind === 'math') {
      const t = math.parseTex(run.s);
      l = t.ok ? math.layoutBox(t.box, px, measure, color) : plain(`$${run.s}$`);
    } else {
      l = plain(run.s);
    }
    items.push(...shiftItems(l.items, x));
    x += l.w;
    asc = Math.max(asc, l.asc);
    desc = Math.max(desc, l.desc);
  }
  return { w: x, asc, desc, items };
}

/**
 * Lays `text` out at `px` pixels: lines split at `\n`, and, when `maxW` is a number, words wrapped to that width (a word
 * or a run of maths wider than `maxW` has a line of its own). `align` places short lines in the block.
 */
export function layoutText(text: string, px: number, family: FontFamily, color: string, maxW: number | null, align: TextAlign): TextLayout {
  const key = `${px}|${family}|${color}|${maxW ?? ''}|${align}|${text}`;
  const known = cache.get(key);
  if (known !== undefined) return known;
  const lines: Laid[] = [];
  for (const paragraph of text.split('\n')) {
    if (maxW === null) {
      lines.push(layoutLine(paragraph, px, family, color));
      continue;
    }
    let line = '';
    let width = 0;
    const flush = (): void => {
      lines.push(layoutLine(line, px, family, color));
      line = '';
      width = 0;
    };
    for (const token of tokens(paragraph)) {
      const w = layoutLine(token.src, px, family, color).w;
      if (token.space && line === '') continue;
      if (!token.space && line !== '' && width + w > maxW) flush();
      line += token.src;
      width += w;
    }
    flush();
  }
  const blockW = maxW ?? lines.reduce((m, l) => Math.max(m, l.w), 0);
  const laid: LaidLine[] = [];
  let top = 0;
  for (const l of lines) {
    const height = Math.max(px * LINE_HEIGHT, l.asc + l.desc);
    const extra = height - (l.asc + l.desc);
    const dx = align === 'center' ? (blockW - l.w) / 2 : align === 'end' ? blockW - l.w : 0;
    laid.push({ items: l.items, x: Math.max(0, dx), baseline: top + extra / 2 + l.asc, w: l.w });
    top += height;
  }
  const out: TextLayout = { w: blockW, h: Math.max(top, px * LINE_HEIGHT), lines: laid };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, out);
  return out;
}

/** The parts that draw a layout with its top-left at `ox, oy`. */
export function textParts(layout: TextLayout, ox: number, oy: number, family: FontFamily): Part[] {
  const out: Part[] = [];
  for (const line of layout.lines) {
    const bx = ox + line.x;
    const by = oy + line.baseline;
    for (const it of line.items) {
      if (it.k === 'glyph') {
        out.push({ k: 'glyph', x: bx + it.x, y: by + it.y, s: it.s, font: it.font, family, px: it.px, color: it.color ?? '#1f2430' });
      } else if (it.k === 'rule') {
        const x = bx + it.x;
        const y = by + it.y;
        out.push(pathPart([PATH_MOVE, x, y, PATH_LINE, x + it.w, y, PATH_LINE, x + it.w, y + it.h, PATH_LINE, x, y + it.h, PATH_CLOSE], it.color ?? '#1f2430', null, 0));
      } else {
        const d: number[] = [];
        it.pts.forEach(([px, py], i) => d.push(i === 0 ? PATH_MOVE : PATH_LINE, bx + px, by + py));
        out.push(pathPart(d, null, it.color ?? '#1f2430', it.lw));
      }
    }
  }
  return out;
}
