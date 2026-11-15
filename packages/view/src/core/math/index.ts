/**
 * The math layout engine (docs/features/text-logic/design.md 6): the LaTeX subset parsed into boxes, laid out into a
 * draw list, and written as SVG (for the DOM and for export). Canvas drawing is `drawMath` in the web backend's caller.
 * No DOM here.
 */
import type { DrawItem, MathLayout } from './layout';
import type { MathFont } from './tex';

export { parseTex, splitMath } from './tex';
export type { MBox, MathFont, TexResult } from './tex';
export { hasMath, layoutBox, layoutText, roughMeasure } from './layout';
export type { DrawItem, GlyphMetrics, MathLayout, Measure } from './layout';

/** CSS font for a math font at `px` pixels. The serif stack stands in until a math font is bundled (design 6.5). */
export function cssFont(font: MathFont, px: number): string {
  const serif = '"STIX Two Math", "Latin Modern Math", "Cambria Math", "Times New Roman", serif';
  switch (font) {
    case 'math': return `italic ${px}px ${serif}`;
    case 'italic': return `italic ${px}px ${serif}`;
    case 'bold': return `bold ${px}px ${serif}`;
    case 'text': return `${px}px Inter, "Segoe UI", system-ui, sans-serif`;
    case 'cal': return `italic ${px}px "Apple Chancery", "URW Chancery L", cursive`;
    default: return `${px}px ${serif}`;
  }
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The layout as an SVG document, `pad` pixels round it. Glyphs are `<text>`, rules `<rect>`, strokes `<polyline>`. */
export function mathSvg(l: MathLayout, color = '#1f2430', pad = 1): string {
  const w = Math.ceil(l.w + 2 * pad);
  const h = Math.ceil(l.asc + l.desc + 2 * pad);
  const oy = l.asc + pad;
  const parts = l.items.map((it: DrawItem) => {
    const fill = it.color ?? color;
    if (it.k === 'glyph') {
      const f = cssFont(it.font, it.px).replace(/"/g, "'");
      return `<text x="${(it.x + pad).toFixed(2)}" y="${(it.y + oy).toFixed(2)}" style="font:${esc(f)}" fill="${esc(fill)}">${esc(it.s)}</text>`;
    }
    if (it.k === 'rule') return `<rect x="${(it.x + pad).toFixed(2)}" y="${(it.y + oy).toFixed(2)}" width="${it.w.toFixed(2)}" height="${it.h.toFixed(2)}" fill="${esc(fill)}"/>`;
    const pts = it.pts.map(([x, y]) => `${(x + pad).toFixed(2)},${(y + oy).toFixed(2)}`).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${esc(fill)}" stroke-width="${it.lw.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="vertical-align:${(-(l.desc + pad)).toFixed(1)}px">${parts.join('')}</svg>`;
}
