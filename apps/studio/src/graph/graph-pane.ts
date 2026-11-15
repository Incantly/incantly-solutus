/**
 * The graph pane: a canvas sized to its box at the device pixel ratio, the grid and the figure painted on it, pan by
 * dragging the background, zoom with the wheel or the buttons, drag free points, and tooltips for points, bars, boxes
 * and slices. Keyboard: arrows pan, + and - zoom, 0 goes home.
 */
import { paintScene } from './paint';
import { mountLatexOverlay } from './latex-overlay';
import type { Hit, SceneItem } from './paint';
import { Viewport } from './viewport';
import type { Box } from './viewport';

export interface GraphPaneOptions {
  /** The items to draw now. */
  readonly items: () => readonly SceneItem[];
  /** Bounds of everything drawn, for zoom to fit; `stretch` when the axes may take different scales (charts of data). */
  readonly bounds: () => (Box & { stretch?: boolean }) | undefined;
  /** A free point dragged to (x, y); `done` on release. */
  readonly drag: (name: string, x: number, y: number, done: boolean) => void;
  /** A construction tool, when one is active: it takes clicks and hovers and paints its overlay (tools-2d 5). */
  readonly tool?: () => GraphTool | undefined;
  /** A click with no tool on and no drag: select what is under it (`extend` with Shift or Ctrl/Cmd), algebra-view 3.9. */
  readonly pick?: (px: number, py: number, vp: Viewport, extend: boolean) => void;
  /** The pointer moved with no tool on and no drag. */
  readonly hoverAt?: (px: number, py: number, vp: Viewport) => void;
}

export interface GraphTool {
  /** True while a tool other than Move is active: clicks go to it and points are not dragged. */
  active(): boolean;
  /** `touch`: a finger is down, so the tool shows its loupe (design 7.2). */
  hover(px: number, py: number, vp: Viewport, touch?: boolean): void;
  /** `alt`: Alt was held, the tool's special alternative (ui.md 2). */
  click(px: number, py: number, vp: Viewport, alt?: boolean): void;
  /** A press on a pending point starts moving it (design 7.2); true when it did. */
  grab?(px: number, py: number, vp: Viewport): boolean;
  /** The grabbed pending point follows the pointer. */
  dragTo?(px: number, py: number, vp: Viewport): void;
  /** The pointer is up: the grabbed point stays, or the loupe goes. */
  release?(): void;
  /** Paints pending points, the ghost and halos after the scene. */
  overlay(ctx: CanvasRenderingContext2D, vp: Viewport): void;
}

export interface GraphPane {
  readonly element: HTMLElement;
  readonly viewport: Viewport;
  /** Repaints on the next frame. */
  redraw(): void;
  /** Paints now (tests and first paint). */
  paint(): void;
  fit(): void;
  dispose(): void;
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'graph-btn';
  b.textContent = label;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', onClick);
  return b;
}

function inside(h: Hit, x: number, y: number): boolean {
  if (h.k === 'circle') return Math.hypot(h.x - x, h.y - y) <= h.r;
  if (h.k === 'rect') return x >= Math.min(h.x0, h.x1) && x <= Math.max(h.x0, h.x1) && y >= Math.min(h.y0, h.y1) && y <= Math.max(h.y0, h.y1);
  const d = Math.hypot(x - h.x, y - h.y);
  if (d > h.r) return false;
  let a = Math.atan2(h.y - y, x - h.x);
  const lo = h.a0;
  const hi = h.a1;
  while (a < lo) a += Math.PI * 2;
  while (a > lo + Math.PI * 2) a -= Math.PI * 2;
  return a <= hi;
}

export function mountGraph(opts: GraphPaneOptions): GraphPane {
  const element = document.createElement('section');
  element.className = 'graph';
  element.setAttribute('aria-label', 'Graph');
  const canvas = document.createElement('canvas');
  canvas.className = 'graph-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Graph of the figure. Drag to pan, scroll to zoom, arrow keys pan.');
  const tip = document.createElement('div');
  tip.className = 'graph-tip';
  tip.hidden = true;
  const vp = new Viewport();
  const latex = mountLatexOverlay();
  let hits: Hit[] = [];
  let frame = 0;
  let first = true;

  const paint = (): void => {
    frame = 0;
    const rect = element.getBoundingClientRect();
    const w = rect.width || 800;
    const h = rect.height || 600;
    vp.resize(w, h);
    if (first) {
      vp.home();
      first = false;
    }
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = ((): CanvasRenderingContext2D | null => {
      try {
        return canvas.getContext('2d');
      } catch {
        return null;
      }
    })();
    if (!ctx || typeof ctx.setTransform !== 'function') return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scene = opts.items();
    hits = paintScene(ctx, vp, scene);
    latex.sync(vp, scene);
    opts.tool?.()?.overlay(ctx, vp);
  };
  const redraw = (): void => {
    if (frame) return;
    frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(paint) : (setTimeout(paint, 0) as unknown as number);
  };
  const fit = (): void => {
    const b = opts.bounds();
    if (b) vp.fit(b, 40, b.stretch === true);
    else vp.home();
    redraw();
  };

  const zoom = (factor: number): void => {
    vp.zoomAt(vp.w / 2, vp.h / 2, factor);
    redraw();
  };
  const controls = document.createElement('div');
  controls.className = 'graph-controls';
  controls.append(
    button('+', 'Zoom in', () => zoom(1.5)),
    button('−', 'Zoom out', () => zoom(1 / 1.5)),
    button('⌂', 'Default view', () => {
      vp.home();
      redraw();
    }),
    button('⤢', 'Zoom to fit', fit),
  );
  element.append(canvas, latex.element, controls, tip);

  // pointer: drag a free point, else pan
  let drag: { kind: 'pan' | 'point' | 'pending' | 'aim'; x: number; y: number; name?: string; moved: boolean } | undefined;
  let down: { x: number; y: number; tool: boolean } | undefined;
  const local = (e: PointerEvent | WheelEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const hitAt = (x: number, y: number): Hit | undefined => {
    for (let i = hits.length - 1; i >= 0; i--) if (inside(hits[i] as Hit, x, y)) return hits[i];
    return undefined;
  };
  canvas.addEventListener('pointerdown', (e) => {
    const p = local(e);
    const h = hitAt(p.x, p.y);
    const tool = opts.tool?.();
    const toolOn = tool?.active() === true;
    if (toolOn && tool?.grab?.(p.x, p.y, vp)) drag = { kind: 'pending', ...p, moved: false };
    // a finger with a tool on aims: the loupe follows it and the release is the click (design 7.2)
    else if (toolOn && e.pointerType === 'touch') {
      drag = { kind: 'aim', ...p, moved: false };
      tool?.hover(p.x, p.y, vp, true);
      redraw();
    } else drag = !toolOn && h && h.k === 'circle' && h.drag ? { kind: 'point', name: h.drag, ...p, moved: false } : { kind: 'pan', ...p, moved: false };
    down = { ...p, tool: toolOn };
    canvas.setPointerCapture?.(e.pointerId);
    canvas.classList.toggle('grabbing', drag.kind === 'pan');
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    const tool = opts.tool?.();
    if (tool?.active() && !drag) {
      tool.hover(p.x, p.y, vp);
      canvas.style.cursor = 'crosshair';
      tip.hidden = true;
      redraw();
      return;
    }
    if (drag) {
      // a small wobble during a click is not a pan, nor is a move with no button held (a late event from before the press)
      if (!drag.moved && (Math.hypot(p.x - drag.x, p.y - drag.y) < 4 || e.buttons === 0)) return;
      drag.moved = true;
      if (drag.kind === 'pending') {
        opts.tool?.()?.dragTo?.(p.x, p.y, vp);
        redraw();
        return;
      }
      if (drag.kind === 'aim') {
        drag.x = p.x;
        drag.y = p.y;
        opts.tool?.()?.hover(p.x, p.y, vp, true);
        redraw();
        return;
      }
      if (drag.kind === 'pan') {
        vp.pan(p.x - drag.x, p.y - drag.y);
        drag.x = p.x;
        drag.y = p.y;
        redraw();
      } else if (drag.name) opts.drag(drag.name, vp.x(p.x), vp.y(p.y), false);
      tip.hidden = true;
      return;
    }
    opts.hoverAt?.(p.x, p.y, vp);
    const h = hitAt(p.x, p.y);
    canvas.style.cursor = h && h.k === 'circle' && h.drag ? 'grab' : h ? 'pointer' : '';
    if (h) {
      tip.textContent = h.text;
      tip.hidden = false;
      tip.style.left = `${Math.min(p.x + 14, vp.w - 220)}px`;
      tip.style.top = `${Math.max(4, p.y - 34)}px`;
    } else tip.hidden = true;
  });
  const end = (e: PointerEvent): void => {
    if (drag?.kind === 'point' && drag.name && drag.moved) {
      const p = local(e);
      opts.drag(drag.name, vp.x(p.x), vp.y(p.y), true);
    }
    // a click (no drag) with a tool on goes to the tool
    if (drag?.kind === 'pending') {
      opts.tool?.()?.release?.();
      redraw();
    } else if (drag?.kind === 'aim') {
      const p = local(e);
      opts.tool?.()?.release?.();
      if (e.type === 'pointerup') opts.tool?.()?.click(p.x, p.y, vp, e.altKey);
      redraw();
    } else if (down?.tool && drag && !drag.moved && e.type === 'pointerup') {
      const p = local(e);
      opts.tool?.()?.click(p.x, p.y, vp, e.altKey);
      redraw();
    } else if (down && !down.tool && drag && !drag.moved && e.type === 'pointerup') {
      const p = local(e);
      opts.pick?.(p.x, p.y, vp, e.shiftKey || e.ctrlKey || e.metaKey);
      redraw();
    }
    down = undefined;
    drag = undefined;
    canvas.classList.remove('grabbing');
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => {
    tip.hidden = true;
    opts.hoverAt?.(-1e9, -1e9, vp);
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e);
    vp.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
    redraw();
  }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    const step = 60;
    const k = e.key;
    if (k === 'ArrowLeft') vp.pan(step, 0);
    else if (k === 'ArrowRight') vp.pan(-step, 0);
    else if (k === 'ArrowUp') vp.pan(0, step);
    else if (k === 'ArrowDown') vp.pan(0, -step);
    else if (k === '+' || k === '=') vp.zoomAt(vp.w / 2, vp.h / 2, 1.25);
    else if (k === '-') vp.zoomAt(vp.w / 2, vp.h / 2, 0.8);
    else if (k === '0') vp.home();
    else return;
    e.preventDefault();
    redraw();
  });

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => redraw()) : undefined;
  ro?.observe(element);

  return {
    element,
    viewport: vp,
    redraw,
    paint,
    fit,
    dispose() {
      ro?.disconnect();
    },
  };
}
