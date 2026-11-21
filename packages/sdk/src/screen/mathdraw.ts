/**
 * The studio's side of the math engine (text-logic design 6): glyphs measured on a canvas, layouts drawn on the graph,
 * and texts with `$…$` parts shown as SVG in the expression list.
 */
import { math } from '@incantly/view';
import type { MathItem, MathLayout, Measure } from '@incantly/view';
// the KaTeX loader only: the package index also defines its Web Components, which a Node or worker host has no DOM for
import { fullLatexHtml, loadFullLatex } from '@incantly/ui/katex';

let ctx: CanvasRenderingContext2D | null | undefined;

/** Measures with a canvas when there is one; the rough table otherwise (tests without a canvas). */
export const canvasMeasure: Measure = (s, font, px) => {
  if (ctx === undefined) {
    try {
      const c = typeof document !== 'undefined' ? document.createElement('canvas') : undefined;
      const k = c?.getContext('2d') ?? null;
      ctx = k && typeof k.measureText === 'function' ? k : null;
    } catch {
      ctx = null;
    }
  }
  if (!ctx) return math.roughMeasure(s, font, px);
  ctx.font = math.cssFont(font, px);
  const m = ctx.measureText(s);
  const w = typeof m.width === 'number' && m.width > 0 ? m.width : math.roughMeasure(s, font, px).w;
  const asc = typeof m.actualBoundingBoxAscent === 'number' && m.actualBoundingBoxAscent > 0 ? Math.max(m.actualBoundingBoxAscent, px * 0.5) : px * 0.72;
  const desc = typeof m.actualBoundingBoxDescent === 'number' ? Math.max(m.actualBoundingBoxDescent, px * 0.05) : px * 0.22;
  return { w, asc, desc };
};

/** Draws a layout with the left end of its baseline at (x, y). */
export function drawMath(c: CanvasRenderingContext2D, l: MathLayout, x: number, y: number, color: string): void {
  c.save();
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left';
  for (const it of l.items as readonly MathItem[]) {
    const fill = it.color ?? color;
    if (it.k === 'glyph') {
      c.font = math.cssFont(it.font, it.px);
      c.fillStyle = fill;
      c.fillText(it.s, x + it.x, y + it.y);
    } else if (it.k === 'rule') {
      c.fillStyle = fill;
      c.fillRect(x + it.x, y + it.y, it.w, it.h);
    } else {
      c.strokeStyle = fill;
      c.lineWidth = it.lw;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.beginPath();
      it.pts.forEach(([px, py], k) => (k === 0 ? c.moveTo(x + px, y + py) : c.lineTo(x + px, y + py)));
      c.stroke();
    }
  }
  c.restore();
}

/** A text with maths as an SVG element for the list, or `undefined` when it has no `$…$` part. */
export function mathElement(s: string, px = 15, color = '#1f2430'): Element | undefined {
  if (!math.hasMath(s)) return undefined;
  const l = math.layoutText(s, px, canvasMeasure);
  const holder = document.createElement('span');
  holder.className = 'math';
  // the SVG is built from escaped text by the view package; no markup from the figure reaches the page unescaped
  holder.innerHTML = math.mathSvg(l, color);
  holder.setAttribute('role', 'img');
  holder.setAttribute('aria-label', s.replace(/\$/g, ''));
  return holder;
}

/**
 * A text with `latex = full` as an element: KaTeX's HTML once it has loaded, the plain text until then (design 6.4).
 * `ready` runs after a late fill, so a caller that positions the element can measure it again.
 */
export function fullElement(s: string, ready?: () => void): HTMLElement {
  const holder = document.createElement('span');
  holder.className = 'latex-full';
  holder.setAttribute('aria-label', s.replace(/\$/g, ''));
  const fill = (): boolean => {
    // KaTeX output from escaped source, rendered with trust off: no link, script or style reaches the page
    const html = fullLatexHtml(s);
    if (html === undefined) return false;
    holder.innerHTML = html;
    return true;
  };
  if (!fill()) {
    holder.textContent = s.replace(/\$/g, '');
    void loadFullLatex().then((ok) => {
      if (ok && fill()) ready?.();
    });
  }
  return holder;
}
