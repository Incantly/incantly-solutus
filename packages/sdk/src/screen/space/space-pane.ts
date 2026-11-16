/**
 * The Space pane (docs/features/space-3d/ui.md 2, 12; .kiro/specs/space-3d R3.3, R4.6): a canvas sized to its box at the
 * device pixel ratio, painted by the software painter, and a list of what it shows for screen readers.
 */
import { space } from '@incantly/kernel';
import type { Figure } from '@incantly/kernel';
import type { Hit3, Painted3 } from './paint3';
import { paintSpace } from './paint3';
import type { Scene3Options } from './scene3';
import { sceneOf3 } from './scene3';

export interface SpacePaneOptions {
  /** The figure to draw (the pane reads it again each frame). */
  readonly figure: () => Figure;
  /** The camera to draw with: the figure's `space`, or a view the pane is turning before it writes it. */
  readonly view?: () => space.View3;
  readonly scene?: () => Scene3Options;
}

export interface SpacePane {
  readonly element: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  /** Repaints on the next frame. */
  redraw(): void;
  /** Paints now (tests and first paint). */
  paint(): void;
  /** The last frame's camera and hit areas, nearest last. */
  last(): Painted3 | undefined;
  /** The size in CSS pixels. */
  size(): { w: number; h: number };
  dispose(): void;
}

/** One line per object for the screen-reader list: `A, point (1, 2, 3)`. */
export function describe3(figure: Figure): string[] {
  const out: string[] = [];
  for (const o of figure.objects()) {
    if (!o.cell.defined || !o.style.shown || o.type === 'View3' || !space.SPACE_TYPES.includes(o.type)) continue;
    out.push(`${o.name}, ${space.spaceText(o.cell.value) ?? o.type}`);
  }
  return out;
}

export function mountSpace(opts: SpacePaneOptions): SpacePane {
  const element = document.createElement('section');
  element.className = 'space-view';
  element.setAttribute('aria-label', 'Space view');
  const canvas = document.createElement('canvas');
  canvas.className = 'space-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'The figure in space. Drag to turn it, scroll to zoom.');
  const list = document.createElement('ul');
  list.className = 'space-sr';
  list.setAttribute('aria-label', 'Objects in the Space view');
  // seen by screen readers only
  list.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);margin:-1px;padding:0;border:0';
  element.append(canvas, list);
  let frame = 0;
  let painted: Painted3 | undefined;
  let w = 800;
  let h = 600;

  const paint = (): void => {
    frame = 0;
    const r = element.getBoundingClientRect();
    w = r.width || 800;
    h = r.height || 600;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const fig = opts.figure();
    const view = opts.view?.() ?? space.viewOf(fig);
    const scene = sceneOf3(fig, view, opts.scene?.() ?? {});
    let ctx: CanvasRenderingContext2D | null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    if (ctx && typeof ctx.setTransform === 'function') {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      painted = paintSpace(ctx, view, w, h, scene);
    }
    const lines = describe3(fig);
    if (list.childElementCount !== lines.length || [...list.children].some((li, i) => li.textContent !== lines[i])) {
      list.replaceChildren(...lines.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
    }
  };
  const redraw = (): void => {
    if (frame) return;
    frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(paint) : (setTimeout(paint, 0) as unknown as number);
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => redraw()) : undefined;
  ro?.observe(element);
  return {
    element,
    canvas,
    redraw,
    paint,
    last: () => painted,
    size: () => ({ w, h }),
    dispose() {
      ro?.disconnect();
    },
  };
}

export type { Hit3 };
