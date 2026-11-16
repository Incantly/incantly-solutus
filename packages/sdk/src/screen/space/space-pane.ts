/**
 * The Space pane (docs/features/space-3d/ui.md 2, 4 to 6, 12; .kiro/specs/space-3d R3.3, R4): a canvas painted by the
 * software painter, the camera gestures, point dragging, the camera keys, a small style bar and a list of what it shows
 * for screen readers. While a gesture runs the pane turns its own copy of the camera; on release it writes one camera
 * line, so a turn is one undo step and the file and the teacher see it.
 */
import { space } from '@incantly/kernel';
import type { Figure } from '@incantly/kernel';
import { cameraLine, dragTo, facingAxis, keyLine, keyMove, orbit, pan, pick3, zoomAt } from './controls3';
import type { DragMode } from './controls3';
import type { Hit3, Painted3 } from './paint3';
import { cameraFor, paintSpace } from './paint3';
import type { Scene3Options } from './scene3';
import { sceneOf3 } from './scene3';

type V3 = space.V3;

export interface SpacePaneOptions {
  /** The figure to draw (the pane reads it again each frame). */
  readonly figure: () => Figure;
  readonly scene?: () => Scene3Options;
  /** Applies a camera line (`space with azimuth = 30deg`, `ViewReset()`); without it the camera does not move. */
  readonly write?: (line: string) => void;
  /** Moves a point to `p`; `done` on release. Returns why it could not, or nothing. */
  readonly drag?: (name: string, p: V3, done: boolean) => string | undefined;
  /** True when the point can be dragged (free, or through its parents). */
  readonly draggable?: (name: string) => boolean;
  /** A click picked this object, or nothing. */
  readonly select?: (name: string | undefined) => void;
  /** Says a short fact in the status line. */
  readonly say?: (text: string) => void;
  /** The style bar of ui.md 6.2 (default on). */
  readonly styleBar?: boolean;
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
  /** The selected point, which the arrow keys move. */
  selected(): string | undefined;
  dispose(): void;
}

/** One line per object for the screen-reader list: `A, (1, 2, 3)`. */
export function describe3(figure: Figure): string[] {
  const out: string[] = [];
  for (const o of figure.objects()) {
    if (!o.cell.defined || !o.style.shown || o.type === 'View3' || !space.SPACE_TYPES.includes(o.type)) continue;
    out.push(`${o.name}, ${space.spaceText(o.cell.value) ?? o.type}`);
  }
  return out;
}

/** A context that draws nothing: with no canvas the pane still knows where everything is, so picking works. */
const noop = (): void => undefined;
const NULL_CTX = {
  beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop, fill: noop, stroke: noop, arc: noop, fillText: noop, strokeText: noop,
  setLineDash: noop, save: noop, restore: noop, fillRect: noop, setTransform: noop,
  fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, font: '', textAlign: 'left', textBaseline: 'alphabetic', lineJoin: 'round', lineCap: 'round',
} as unknown as CanvasRenderingContext2D;

function button(label: string, title: string, on: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'space-btn';
  b.textContent = label;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', on);
  return b;
}

export function mountSpace(opts: SpacePaneOptions): SpacePane {
  const element = document.createElement('section');
  element.className = 'space-view';
  element.setAttribute('aria-label', 'Space view');
  const canvas = document.createElement('canvas');
  canvas.className = 'space-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'The figure in space. Drag to turn it, Shift-drag to move it, scroll to zoom. Keys 1 to 6 and 0 choose a view, H resets it.');
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
  /** The camera while a gesture turns it, before its line is written. */
  let live: space.View3 | undefined;
  let chosen: string | undefined;
  let guide: string | undefined;
  let zoomTimer: ReturnType<typeof setTimeout> | undefined;

  /** The camera a gesture changes: the one the figure stores (or the live copy), before spin and clip size. */
  const baseView = (): space.View3 => live ?? space.viewOf(opts.figure());
  /** The camera drawn now: at the film time. */
  const viewNow = (): space.View3 => {
    const fig = opts.figure() as unknown as { clock?(): { t: number } };
    return space.viewAtTime(baseView(), typeof fig.clock === 'function' ? fig.clock().t : 0);
  };

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
    const view = viewNow();
    const extra = opts.scene?.() ?? {};
    const selected = new Set(extra.selected ?? []);
    if (chosen) selected.add(chosen);
    const scene = sceneOf3(fig, view, { ...extra, selected, ...((guide ?? chosen) ? { guide: (guide ?? chosen) as string } : {}) });
    let ctx: CanvasRenderingContext2D | null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    const c = ctx && typeof ctx.setTransform === 'function' ? ctx : NULL_CTX;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    painted = paintSpace(c, view, w, h, scene);
    const lines = describe3(fig);
    if (list.childElementCount !== lines.length || [...list.children].some((li, i) => li.textContent !== lines[i])) {
      list.replaceChildren(...lines.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
    }
  };
  const redraw = (): void => {
    if (frame) return;
    frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(paint) : (setTimeout(paint, 0) as unknown as number);
  };

  /** Writes the line for what the live camera changed, and lets go of it. */
  const commit = (): void => {
    if (!live) return;
    const line = cameraLine(space.viewOf(opts.figure()), live);
    live = undefined;
    if (line && opts.write) opts.write(line);
    redraw();
  };

  /* ------------------------------ pointer ------------------------------ */

  const local = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const valueOf = (name: string): V3 | undefined => {
    const o = opts.figure().get(name);
    return o && o.cell.defined && space.isV3(o.cell.value) ? o.cell.value : undefined;
  };

  let gesture:
    | { kind: 'orbit' | 'pan'; x: number; y: number; moved: boolean }
    | { kind: 'point'; name: string; from: V3; mode: DragMode; normal: V3; moved: boolean; x: number; y: number }
    | undefined;

  canvas.addEventListener('pointerdown', (e) => {
    const p = local(e);
    canvas.focus?.();
    const hit = painted ? pick3(painted.hits, p.x, p.y) : undefined;
    if (hit?.k === 'point' && opts.drag && (opts.draggable?.(hit.name) ?? hit.free)) {
      const from = valueOf(hit.name);
      if (from) {
        // the plane is chosen once per drag, so the point does not jump when the camera faces another way
        const normal = facingAxis(cameraFor(viewNow(), w, h));
        gesture = { kind: 'point', name: hit.name, from, mode: e.shiftKey ? 'vertical' : 'plane', normal, moved: false, ...p };
        guide = hit.name;
      }
    } else gesture = { kind: e.shiftKey || e.button === 1 ? 'pan' : 'orbit', ...p, moved: false };
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!gesture) return;
    const p = local(e);
    if (!gesture.moved && (Math.hypot(p.x - gesture.x, p.y - gesture.y) < 3 || e.buttons === 0)) return;
    gesture.moved = true;
    if (gesture.kind === 'point') {
      const cam = cameraFor(viewNow(), w, h);
      const to = dragTo(cam, gesture.from, p.x, p.y, gesture.mode, gesture.normal);
      if (!to) return;
      const why = opts.drag?.(gesture.name, to, false);
      if (why) opts.say?.(why);
      redraw();
      return;
    }
    const dx = p.x - gesture.x;
    const dy = p.y - gesture.y;
    gesture.x = p.x;
    gesture.y = p.y;
    const v = baseView();
    live = gesture.kind === 'orbit' ? orbit(v, dx, dy) : pan(v, cameraFor(viewNow(), w, h), dx, dy);
    redraw();
  });
  const end = (e: PointerEvent): void => {
    const g = gesture;
    gesture = undefined;
    if (!g) return;
    if (g.kind === 'point') {
      guide = undefined;
      if (g.moved) {
        const cam = cameraFor(viewNow(), w, h);
        const p = local(e);
        const to = dragTo(cam, g.from, p.x, p.y, g.mode, g.normal);
        opts.drag?.(g.name, to ?? valueOf(g.name) ?? g.from, true);
      } else choose(g.name);
      redraw();
      return;
    }
    if (g.moved) commit();
    else if (e.type === 'pointerup') {
      // a click: pick what is there, or clear the choice
      const p = local(e);
      const hit = painted ? pick3(painted.hits, p.x, p.y) : undefined;
      const o = hit ? [...opts.figure().objects()].find((x) => (x.id as unknown as number) === hit.id) : undefined;
      choose(o?.name);
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('dblclick', (e) => {
    const p = local(e);
    const hit = painted ? pick3(painted.hits, p.x, p.y) : undefined;
    const o = hit ? [...opts.figure().objects()].find((x) => (x.id as unknown as number) === hit.id) : undefined;
    // double-click empty space resets the view; an object with a face is looked at (ui.md 6.1)
    if (!o) opts.write?.('ViewReset()');
    else if (['Plane', 'Polygon3', 'Circle3', 'Line3', 'Segment3', 'Ray3'].includes(o.type)) opts.write?.(`ViewFacing(${o.name})`);
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e);
    live = zoomAt(baseView(), cameraFor(viewNow(), w, h), Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    redraw();
    // a burst of wheel steps is one zoom line
    if (zoomTimer) clearTimeout(zoomTimer);
    zoomTimer = setTimeout(commit, 250);
  }, { passive: false });

  const choose = (name: string | undefined): void => {
    chosen = name;
    opts.select?.(name);
    if (name) opts.say?.(`Selected ${name}.`);
    redraw();
  };

  /* ------------------------------ keys (ui.md 5.4) ------------------------------ */

  canvas.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) return;
    const move = chosen ? keyMove(e.key, e.shiftKey, e.altKey) : undefined;
    const at = chosen ? valueOf(chosen) : undefined;
    if (move && chosen && at && (opts.draggable?.(chosen) ?? true)) {
      const why = opts.drag?.(chosen, space.add(at, move), true);
      opts.say?.(why ?? `${chosen} = ${space.spaceText(valueOf(chosen))}`);
    } else if (e.key === 'Escape') choose(undefined);
    else {
      const line = keyLine(e.key, baseView());
      if (!line) return;
      opts.write?.(line);
    }
    e.preventDefault();
    redraw();
  });

  /* ------------------------------ the style bar (ui.md 6.2) ------------------------------ */

  if (opts.styleBar !== false && opts.write) {
    const write = opts.write;
    const bar = document.createElement('div');
    bar.className = 'space-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'View');
    const presets = document.createElement('select');
    presets.className = 'space-presets';
    presets.setAttribute('aria-label', 'Look from');
    const option = (text: string, value: string): HTMLOptionElement => Object.assign(document.createElement('option'), { textContent: text, value });
    presets.append(option('View…', ''), ...space.VIEW_PRESETS.map((p) => option(p[0]?.toUpperCase() + p.slice(1), p)));
    presets.addEventListener('change', () => {
      if (presets.value) write(`ViewPreset(${presets.value})`);
      presets.value = '';
    });
    bar.append(
      button('⌂', 'Reset the view', () => write('ViewReset()')),
      button('⤢', 'Show everything', () => write('ViewAll()')),
      button('◐', 'Axes, floor and grid on or off', () => {
        const v = space.viewOf(opts.figure());
        const on = !(v.axes && v.floor && v.grid);
        write(`space with axes = ${on}, floor = ${on}, grid = ${on}`);
      }),
      button('⛶', 'Clip box on or off', () => write(`space with clip = ${!space.viewOf(opts.figure()).clip}`)),
      button('◩', 'Orthographic or perspective', () => write(`space with projection = ${space.viewOf(opts.figure()).projection === 'persp' ? 'ortho' : 'persp'}`)),
      presets,
    );
    element.append(bar);
  }

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => redraw()) : undefined;
  ro?.observe(element);
  return {
    element,
    canvas,
    redraw,
    paint,
    last: () => painted,
    size: () => ({ w, h }),
    selected: () => chosen,
    dispose() {
      ro?.disconnect();
      if (zoomTimer) clearTimeout(zoomTimer);
    },
  };
}

export type { Hit3 };
