/**
 * Texts with `latex = full` drawn by KaTeX into HTML laid over the canvas (text-logic design 6.4). The overlay follows
 * the view on every paint: place, size, anchor, rotation and background, the same as a canvas text. It is not drawn
 * into exported images, and it takes no pointer events, so the canvas under it still pans and picks.
 */
import type { SceneItem } from './paint';
import { fullElement } from './mathdraw';
import type { Viewport } from './viewport';

const SHIFT: Readonly<Record<string, readonly [number, number]>> = {
  nw: [0, 0], n: [-50, 0], ne: [-100, 0],
  w: [0, -50], c: [-50, -50], e: [-100, -50],
  sw: [0, -100], s: [-50, -100], se: [-100, -100],
};
const CORNER: Readonly<Record<string, string>> = { tl: 'nw', tr: 'ne', bl: 'sw', br: 'se' };

export interface LatexOverlay {
  readonly element: HTMLElement;
  /** Places one element per full-LaTeX text and removes the rest. */
  sync(vp: Viewport, items: readonly SceneItem[]): void;
}

export function mountLatexOverlay(): LatexOverlay {
  const element = document.createElement('div');
  element.className = 'graph-latex';
  element.setAttribute('aria-hidden', 'false');
  const shown = new Map<number, { src: string; el: HTMLElement }>();

  const sync = (vp: Viewport, items: readonly SceneItem[]): void => {
    const keep = new Set<number>();
    for (const it of items) {
      const t = it.text;
      if (it.type !== 'Text' || !t?.full || typeof it.value !== 'string') continue;
      keep.add(it.id);
      let entry = shown.get(it.id);
      if (!entry || entry.src !== it.value) {
        entry?.el.remove();
        const el = fullElement(it.value);
        el.classList.add('graph-latex-item');
        element.append(el);
        entry = { src: it.value, el };
        shown.set(it.id, entry);
      }
      const [sx, sy] = SHIFT[CORNER[t.anchor] ?? t.anchor] ?? (SHIFT['sw'] as readonly [number, number]);
      const s = entry.el.style;
      s.left = `${vp.px(t.at.x)}px`;
      s.top = `${vp.py(t.at.y)}px`;
      s.fontSize = `${t.size}px`;
      // a maths angle counter-clockwise is clockwise on the screen, whose y grows down
      s.transformOrigin = `${-sx}% ${-sy}%`;
      s.transform = `translate(${sx}%, ${sy}%)${t.rotate ? ` rotate(${-t.rotate}rad)` : ''}`;
      s.background = t.bg ?? 'transparent';
      s.color = '#1f2430';
    }
    for (const [id, e] of shown) {
      if (keep.has(id)) continue;
      e.el.remove();
      shown.delete(id);
    }
  };
  return { element, sync };
}
