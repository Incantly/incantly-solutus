import type { RendererMessage, ViewAction } from '../protocol/runtime-messages';
import type { StageView } from '../protocol/ui';
import type { FrameClock } from '../engine/clock';
import type { SceneDom, StageDom } from './dom-scene';

type Send = (message: RendererMessage) => void;

export interface PointerOptions {
  readonly doc: Document;
  readonly sceneRoot: HTMLElement;
  readonly scene: SceneDom;
  readonly send: Send;
  readonly signal: AbortSignal;
  readonly clock: FrameClock;
  /** Whether a toolbar with zoom buttons is drawn on zoomable stages. */
  readonly zoombar?: boolean;
}

export interface PointerStats {
  dragMessages: number;
  viewMessages: number;
  hoverMessages: number;
}

/** Most a learner may zoom into a drawing whose view box the renderer owns. */
export const MAX_ZOOM = 8;
/** A keyboard nudge moves a dragged element by this share of the stage, or four times it with Shift. */
const NUDGE = 0.025;
/** Below this many pixels a press is a tap, not a drag. */
const TAP_SLOP = 6;

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DragGesture {
  readonly pointerId: number;
  readonly id: number;
  readonly element: Element;
  readonly stage: StageDom;
  readonly inverse: DOMMatrix;
}

interface BackgroundGesture {
  readonly stage: StageDom;
  readonly startX: number;
  readonly startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
}

interface Pending {
  drag: { id: number; x: number; y: number } | null;
  hover: Map<number, { x: number | null; y: number | null }>;
  view: Map<number, { zoom: { x: number; y: number; factor: number } | null; pan: { dx: number; dy: number } | null; orbit: { dx: number; dy: number } | null }>;
}

/**
 * The figure's direct manipulation (EN-6, SV-8, SV-9, VI-1, VI-2): dragging
 * elements, hovering to trace, zooming and panning stages, orbiting 3D
 * cameras, pinching on touch screens, and the keyboard equivalents. Every
 * listener is delegated from the scene root and only sends messages; the
 * runtime redraws on the next frame (EN-7). Pointer moves are coalesced to
 * one message per kind per animation frame.
 */
export class PointerController {
  readonly stats: PointerStats = { dragMessages: 0, viewMessages: 0, hoverMessages: 0 };
  private readonly views = new Map<number, View>();
  private readonly bars = new Map<number, HTMLElement>();
  private readonly changed = new Map<number, boolean>();
  private readonly pointers = new Map<number, { x: number; y: number; stage: StageDom }>();
  private drag: DragGesture | null = null;
  private background: BackgroundGesture | null = null;
  private pinch: { stage: StageDom; distance: number; midX: number; midY: number } | null = null;
  private active: StageDom | null = null;
  private pending: Pending = { drag: null, hover: new Map(), view: new Map() };
  private frame: number | null = null;

  constructor(private readonly options: PointerOptions) {
    const { sceneRoot, signal, doc } = options;
    const listen = <K extends keyof HTMLElementEventMap>(type: K, handler: (event: HTMLElementEventMap[K]) => void, passive = true) =>
      sceneRoot.addEventListener(type, handler, { signal, passive });
    listen('pointerdown', (e) => this.onDown(e), false);
    listen('pointermove', (e) => this.onMove(e), false);
    listen('pointerup', (e) => this.onUp(e));
    listen('pointercancel', (e) => this.onUp(e, true));
    listen('pointerout', (e) => this.onOut(e));
    listen('wheel', (e) => this.onWheel(e), false);
    listen('dblclick', (e) => this.onDoubleClick(e));
    listen('keydown', (e) => this.onKey(e), false);
    doc.addEventListener(
      'pointerdown',
      (e) => {
        // A press outside the active stage hands scrolling back to the page.
        if (this.active && !this.active.host.contains(e.target as Node)) this.setActive(null);
      },
      { signal, passive: true },
    );
  }

  /** A stage appeared or its interaction changed. */
  stageChanged(stage: StageDom): void {
    const zoomable = stage.interaction.zoom !== 'none';
    if (!this.views.has(stage.id)) this.views.set(stage.id, viewOf(stage));
    stage.svg.classList.toggle('inc-zoomable', zoomable || stage.interaction.orbit);
    if ((this.options.zoombar ?? true) && (zoomable || stage.interaction.views.length > 0)) this.toolbar(stage);
    else {
      this.bars.get(stage.id)?.remove();
      this.bars.delete(stage.id);
    }
  }

  /** Stages were rebuilt: views and toolbars start again. */
  reset(): void {
    for (const bar of this.bars.values()) bar.remove();
    this.bars.clear();
    this.views.clear();
    this.changed.clear();
    this.drag = null;
    this.background = null;
    this.pinch = null;
    this.pointers.clear();
    this.active = null;
  }

  /** Which kit-owned views differ from their start, to enable reset buttons. */
  setViews(views: readonly StageView[]): void {
    for (const view of views) {
      this.changed.set(view.id, view.changed);
      this.refreshBar(view.id);
    }
  }

  destroy(): void {
    if (this.frame !== null) this.options.clock.cancel(this.frame);
    this.frame = null;
  }

  // -------------------------------------------------------------------------
  // Coordinates
  // -------------------------------------------------------------------------

  private inverse(stage: StageDom): DOMMatrix | null {
    const matrix = stage.svg.getScreenCTM();
    return matrix ? matrix.inverse() : null;
  }

  private toStage(inverse: DOMMatrix, clientX: number, clientY: number): { x: number; y: number } {
    const p = new DOMPoint(clientX, clientY).matrixTransform(inverse);
    return { x: p.x, y: p.y };
  }

  /** Stage units per screen pixel. */
  private unitsPerPixel(stage: StageDom): number {
    const rect = stage.svg.getBoundingClientRect();
    const view = this.views.get(stage.id) ?? viewOf(stage);
    if (rect.width <= 0 || rect.height <= 0) return 1;
    return Math.max(view.w / rect.width, view.h / rect.height);
  }

  // -------------------------------------------------------------------------
  // Pointer events
  // -------------------------------------------------------------------------

  private onDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target = event.target as Element;
    if (target.closest('.inc-zoombar')) return;
    const stage = this.options.scene.stageOf(target);
    if (!stage) return;
    const draggable = target.closest('[data-drag]');
    if (draggable && stage.svg.contains(draggable)) {
      const id = this.options.scene.idOf(draggable);
      const inverse = this.inverse(stage);
      if (id === undefined || !inverse) return;
      event.preventDefault();
      draggable.setPointerCapture?.(event.pointerId);
      draggable.classList.add('is-dragging');
      this.drag = { pointerId: event.pointerId, id, element: draggable, stage, inverse };
      const p = this.toStage(inverse, event.clientX, event.clientY);
      this.sendNow({ type: 'drag', id, phase: 'start', x: p.x, y: p.y });
      return;
    }
    const zoomable = stage.interaction.zoom !== 'none' || stage.interaction.orbit;
    if (!zoomable) return;
    // On touch, the first tap only activates the stage: until then the page scrolls (VI-2).
    if (event.pointerType === 'touch' && this.active !== stage) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, stage });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      if (a!.stage === b!.stage) {
        this.background = null;
        this.pinch = { stage, distance: Math.hypot(a!.x - b!.x, a!.y - b!.y), midX: (a!.x + b!.x) / 2, midY: (a!.y + b!.y) / 2 };
      }
      return;
    }
    if (this.pointers.size > 2) return;
    // Panning a drawing that is not zoomed in has nothing to show.
    if (stage.interaction.zoom === 'viewbox' && !this.isZoomed(stage)) {
      this.background = { stage, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
      return;
    }
    stage.svg.setPointerCapture?.(event.pointerId);
    this.background = { stage, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
  }

  private onMove(event: PointerEvent): void {
    if (this.drag && event.pointerId === this.drag.pointerId) {
      const p = this.toStage(this.drag.inverse, event.clientX, event.clientY);
      this.pending.drag = { id: this.drag.id, x: p.x, y: p.y };
      this.schedule();
      return;
    }
    const tracked = this.pointers.get(event.pointerId);
    if (tracked) {
      tracked.x = event.clientX;
      tracked.y = event.clientY;
    }
    if (this.pinch && this.pointers.size === 2) {
      event.preventDefault();
      const [a, b] = [...this.pointers.values()];
      const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const midX = (a!.x + b!.x) / 2;
      const midY = (a!.y + b!.y) / 2;
      const stage = this.pinch.stage;
      const inverse = this.inverse(stage);
      if (inverse && this.pinch.distance > 0) {
        const centre = this.toStage(inverse, midX, midY);
        this.zoom(stage, centre.x, centre.y, distance / this.pinch.distance);
        const units = this.unitsPerPixel(stage);
        this.pan(stage, (midX - this.pinch.midX) * units, (midY - this.pinch.midY) * units);
      }
      this.pinch = { stage, distance, midX, midY };
      return;
    }
    const gesture = this.background;
    if (gesture && tracked) {
      const dx = event.clientX - gesture.lastX;
      const dy = event.clientY - gesture.lastY;
      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;
      if (!gesture.moved && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < TAP_SLOP) return;
      gesture.moved = true;
      const stage = gesture.stage;
      if (stage.interaction.orbit) {
        const rect = stage.svg.getBoundingClientRect();
        this.queueView(stage.id, 'orbit', { dx: dx / Math.max(1, rect.width), dy: dy / Math.max(1, rect.height) });
      } else if (stage.interaction.zoom !== 'viewbox' || this.isZoomed(stage)) {
        const units = this.unitsPerPixel(stage);
        this.pan(stage, dx * units, dy * units);
      }
      return;
    }
    // Hovering, for tracing curves: mice and pens only.
    if (event.buttons === 0 && event.pointerType !== 'touch') {
      const stage = this.options.scene.stageOf(event.target as Element);
      if (!stage || !stage.interaction.hover) return;
      const inverse = this.inverse(stage);
      if (!inverse) return;
      const p = this.toStage(inverse, event.clientX, event.clientY);
      this.pending.hover.set(stage.id, { x: p.x, y: p.y });
      this.schedule();
    }
  }

  private onUp(event: PointerEvent, cancelled = false): void {
    if (this.drag && event.pointerId === this.drag.pointerId) {
      const { id, element, inverse } = this.drag;
      this.drag = null;
      element.classList.remove('is-dragging');
      this.pending.drag = null;
      const p = this.toStage(inverse, event.clientX, event.clientY);
      this.sendNow({ type: 'drag', id, phase: 'end', x: p.x, y: p.y });
      return;
    }
    const tracked = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    const gesture = this.background;
    if (gesture && tracked && this.pointers.size === 0) {
      this.background = null;
      // A tap (not a drag) on a zoomable stage activates it (VI-2).
      if (!gesture.moved && !cancelled) this.setActive(gesture.stage);
    } else if (!tracked && !cancelled && event.pointerType === 'touch') {
      const stage = this.options.scene.stageOf(event.target as Element);
      if (stage && (stage.interaction.zoom !== 'none' || stage.interaction.orbit)) this.setActive(stage);
    }
  }

  private onOut(event: PointerEvent): void {
    if (event.pointerType === 'touch') return;
    const stage = this.options.scene.stageOf(event.target as Element);
    if (!stage || !stage.interaction.hover) return;
    const related = event.relatedTarget as Node | null;
    if (related && stage.svg.contains(related)) return;
    this.pending.hover.set(stage.id, { x: null, y: null });
    this.schedule();
  }

  private onWheel(event: WheelEvent): void {
    const stage = this.options.scene.stageOf(event.target as Element);
    if (!stage || stage.interaction.zoom === 'none') return;
    // A plain wheel scrolls the page until the learner taps the stage; a pinch on a trackpad (ctrl) always zooms.
    if (!event.ctrlKey && this.active !== stage) return;
    event.preventDefault();
    const inverse = this.inverse(stage);
    if (!inverse) return;
    const p = this.toStage(inverse, event.clientX, event.clientY);
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    this.zoom(stage, p.x, p.y, Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0015)));
  }

  private onDoubleClick(event: MouseEvent): void {
    const target = event.target as Element;
    if (target.closest('[data-drag], .inc-zoombar')) return;
    const stage = this.options.scene.stageOf(target);
    if (stage && stage.interaction.zoom !== 'none') this.resetView(stage);
  }

  private onKey(event: KeyboardEvent): void {
    const target = event.target as Element;
    if (event.key === 'Escape' && this.active) {
      this.setActive(null);
      return;
    }
    const draggable = target.closest?.('[data-drag]');
    if (!draggable) return;
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!step) return;
    const stage = this.options.scene.stageOf(draggable);
    const id = this.options.scene.idOf(draggable);
    const inverse = stage ? this.inverse(stage) : null;
    if (!stage || id === undefined || !inverse) return;
    event.preventDefault();
    event.stopPropagation();
    const centre = elementCentre(draggable, inverse);
    if (!centre) return;
    const view = this.views.get(stage.id) ?? viewOf(stage);
    const size = (event.shiftKey ? 4 : 1) * NUDGE;
    const x = centre.x + step[0]! * view.w * size;
    const y = centre.y + step[1]! * view.h * size;
    this.sendNow({ type: 'drag', id, phase: 'start', x: centre.x, y: centre.y });
    this.sendNow({ type: 'drag', id, phase: 'move', x, y });
    this.sendNow({ type: 'drag', id, phase: 'end', x, y });
  }

  // -------------------------------------------------------------------------
  // Zoom and pan
  // -------------------------------------------------------------------------

  private isZoomed(stage: StageDom): boolean {
    const view = this.views.get(stage.id);
    return view !== undefined && view.w < stage.viewBox[2] - 1e-9;
  }

  /** Zooms about a stage point; factor above 1 zooms in. */
  zoom(stage: StageDom, x: number, y: number, factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    if (stage.interaction.zoom === 'runtime') {
      this.queueView(stage.id, 'zoom', { x, y, factor });
      return;
    }
    if (stage.interaction.zoom !== 'viewbox') return;
    const [ox, oy, ow, oh] = stage.viewBox;
    const view = this.views.get(stage.id) ?? viewOf(stage);
    const w = Math.min(ow, Math.max(ow / MAX_ZOOM, view.w / factor));
    const h = (w * oh) / ow;
    const nx = x - ((x - view.x) * w) / view.w;
    const ny = y - ((y - view.y) * h) / view.h;
    this.setView(stage, { x: clamp(nx, ox, ox + ow - w), y: clamp(ny, oy, oy + oh - h), w, h });
  }

  /** Moves the content by (dx, dy) stage units: dragging right shows what was to the left. */
  pan(stage: StageDom, dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    if (stage.interaction.zoom === 'runtime') {
      this.queueView(stage.id, 'pan', { dx, dy });
      return;
    }
    if (stage.interaction.zoom !== 'viewbox') return;
    const [ox, oy, ow, oh] = stage.viewBox;
    const view = this.views.get(stage.id) ?? viewOf(stage);
    this.setView(stage, { x: clamp(view.x - dx, ox, ox + ow - view.w), y: clamp(view.y - dy, oy, oy + oh - view.h), w: view.w, h: view.h });
  }

  resetView(stage: StageDom): void {
    if (stage.interaction.zoom === 'runtime' || stage.interaction.orbit) {
      this.sendNow({ type: 'view', stage: stage.id, action: { kind: 'reset' } });
      return;
    }
    this.setView(stage, viewOf(stage));
  }

  private setView(stage: StageDom, view: View): void {
    this.views.set(stage.id, view);
    stage.svg.setAttribute('viewBox', `${round(view.x)} ${round(view.y)} ${round(view.w)} ${round(view.h)}`);
    stage.svg.toggleAttribute('data-zoomed', this.isZoomed(stage));
    this.options.scene.repaintDots();
    this.refreshBar(stage.id);
  }

  private setActive(stage: StageDom | null): void {
    if (this.active === stage) return;
    this.active?.host.classList.remove('is-active');
    this.active = stage;
    stage?.host.classList.add('is-active');
  }

  // -------------------------------------------------------------------------
  // The stage toolbar
  // -------------------------------------------------------------------------

  private toolbar(stage: StageDom): void {
    const doc = this.options.doc;
    this.bars.get(stage.id)?.remove();
    const bar = doc.createElement('div');
    bar.className = 'inc-zoombar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'View');
    const button = (action: string, text: string, label: string) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.dataset.view = action;
      b.textContent = text;
      b.setAttribute('aria-label', label);
      b.title = label;
      bar.append(b);
      return b;
    };
    if (stage.interaction.zoom !== 'none') {
      button('in', '+', 'Zoom in');
      button('out', '−', 'Zoom out');
      if (stage.interaction.zoom === 'runtime' && !stage.interaction.orbit) button('fit', '⤢', 'Fit to what is drawn');
    }
    if (stage.interaction.views.length > 0) {
      const select = doc.createElement('select');
      select.dataset.view = 'preset';
      select.setAttribute('aria-label', 'Camera view');
      const placeholder = doc.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'View';
      select.append(placeholder);
      for (const name of stage.interaction.views) {
        const option = doc.createElement('option');
        option.value = name;
        option.textContent = name.charAt(0).toUpperCase() + name.slice(1);
        select.append(option);
      }
      bar.append(select);
    }
    button('reset', '⟲', 'Reset view');
    bar.addEventListener(
      'click',
      (event) => {
        const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-view]')?.dataset.view;
        if (!action) return;
        const [x, y, w, h] = viewArray(this.views.get(stage.id) ?? viewOf(stage));
        if (action === 'in') this.zoom(stage, x + w / 2, y + h / 2, 1.5);
        else if (action === 'out') this.zoom(stage, x + w / 2, y + h / 2, 1 / 1.5);
        else if (action === 'fit') this.sendNow({ type: 'view', stage: stage.id, action: { kind: 'fit' } });
        else if (action === 'reset') this.resetView(stage);
      },
      { signal: this.options.signal },
    );
    bar.addEventListener(
      'change',
      (event) => {
        const select = event.target as HTMLSelectElement;
        if (select.dataset.view !== 'preset' || !select.value) return;
        this.sendNow({ type: 'view', stage: stage.id, action: { kind: 'preset', name: select.value } });
        select.value = '';
      },
      { signal: this.options.signal },
    );
    stage.host.append(bar);
    this.bars.set(stage.id, bar);
    this.refreshBar(stage.id);
  }

  private refreshBar(id: number): void {
    const bar = this.bars.get(id);
    const stage = this.options.scene.stage(id);
    if (!bar || !stage) return;
    const changed = stage.interaction.zoom === 'viewbox' && !stage.interaction.orbit ? this.isZoomed(stage) : (this.changed.get(id) ?? false);
    const reset = bar.querySelector<HTMLButtonElement>('button[data-view="reset"]');
    if (reset) reset.disabled = !changed;
    const out = bar.querySelector<HTMLButtonElement>('button[data-view="out"]');
    if (out && stage.interaction.zoom === 'viewbox') out.disabled = !this.isZoomed(stage);
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  private queueView(stage: number, kind: 'zoom' | 'pan' | 'orbit', value: { x: number; y: number; factor: number } | { dx: number; dy: number }): void {
    const entry = this.pending.view.get(stage) ?? { zoom: null, pan: null, orbit: null };
    if (kind === 'zoom') {
      const v = value as { x: number; y: number; factor: number };
      entry.zoom = entry.zoom ? { x: v.x, y: v.y, factor: entry.zoom.factor * v.factor } : { ...v };
    } else {
      const v = value as { dx: number; dy: number };
      const previous = entry[kind];
      entry[kind] = previous ? { dx: previous.dx + v.dx, dy: previous.dy + v.dy } : { ...v };
    }
    this.pending.view.set(stage, entry);
    this.schedule();
  }

  private schedule(): void {
    if (this.frame !== null) return;
    this.frame = this.options.clock.request(() => {
      this.frame = null;
      this.flushPending();
    });
  }

  private flushPending(): void {
    const pending = this.pending;
    this.pending = { drag: null, hover: new Map(), view: new Map() };
    if (pending.drag) this.sendNow({ type: 'drag', id: pending.drag.id, phase: 'move', x: pending.drag.x, y: pending.drag.y });
    for (const [stage, p] of pending.hover) this.sendNow({ type: 'hover', stage, x: p.x, y: p.y });
    for (const [stage, entry] of pending.view) {
      const actions: ViewAction[] = [];
      if (entry.zoom) actions.push({ kind: 'zoom', ...entry.zoom });
      if (entry.pan) actions.push({ kind: 'pan', ...entry.pan });
      if (entry.orbit) actions.push({ kind: 'orbit', ...entry.orbit });
      for (const action of actions) this.sendNow({ type: 'view', stage, action });
    }
  }

  private sendNow(message: RendererMessage): void {
    if (message.type === 'drag') this.stats.dragMessages++;
    else if (message.type === 'view') this.stats.viewMessages++;
    else if (message.type === 'hover') this.stats.hoverMessages++;
    this.options.send(message);
  }
}

function viewOf(stage: StageDom): View {
  const [x, y, w, h] = stage.viewBox;
  return { x, y, w, h };
}

function viewArray(view: View): [number, number, number, number] {
  return [view.x, view.y, view.w, view.h];
}

function clamp(value: number, min: number, max: number): number {
  return max < min ? min : Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** The centre of an element in its stage's coordinates. */
function elementCentre(element: Element, inverse: DOMMatrix): { x: number; y: number } | null {
  const graphics = element as SVGGraphicsElement;
  if (typeof graphics.getBBox !== 'function' || typeof graphics.getScreenCTM !== 'function') return null;
  let box: DOMRect;
  try {
    box = graphics.getBBox();
  } catch {
    return null;
  }
  const screen = graphics.getScreenCTM();
  if (!screen) return null;
  const p = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(screen).matrixTransform(inverse);
  return { x: p.x, y: p.y };
}
