import type { Layer, ViewBox } from '../api/types';
import { RENDERABLE_ATTRIBUTES, type ElementKind, type SceneCommand, type StageZoom } from '../protocol/scene-commands';

/** Paint attributes the theme also sets, mapped to the variables its rules read. */
const STYLED_ATTRIBUTES: Readonly<Record<string, string>> = {
  'stroke-width': '--inc-sw',
  'stroke-linecap': '--inc-cap',
  'stroke-linejoin': '--inc-join',
  'font-size': '--inc-fs',
};

export const SVG_NS = 'http://www.w3.org/2000/svg';
const LAYERS: readonly Layer[] = ['back', 'mid', 'front', 'labels'];
/** The only elements a scene can create, whatever a Worker sends. */
const KINDS: ReadonlySet<string> = new Set(['g', 'path', 'line', 'circle', 'rect', 'text', 'polyline', 'use'] satisfies ElementKind[]);
const TONE = /\binc-tone-(lo|mid|hi|lit|faint|a|b|c)\b/;
const SHADE = /\binc-shade-(sphere|cylinder|soft)\b/;

/** How a stage answers the pointer, from its `interact` command. */
export interface StageInteractionView {
  readonly zoom: StageZoom;
  readonly hover: boolean;
  readonly orbit: boolean;
  readonly views: readonly string[];
}

export interface StageDom {
  readonly id: number;
  readonly svg: SVGSVGElement;
  /** The scene-HTML element the stage was drawn into. */
  readonly host: HTMLElement;
  readonly layers: Readonly<Record<Layer, SVGGElement>>;
  readonly defs: SVGDefsElement;
  /** The view box the scene declared; zooming changes the attribute, not this. */
  readonly viewBox: ViewBox;
  interaction: StageInteractionView;
  /** Gradients made so far, by key. */
  readonly gradients: Set<string>;
  /** Canvas layers for dots, made on first use. */
  canvases: { back?: HTMLCanvasElement; front?: HTMLCanvasElement };
}

interface DotsState {
  readonly stage: number;
  readonly layer: 'back' | 'front';
  readonly tone: string;
  readonly r: number;
  readonly points: readonly number[];
}

export interface SceneDomStats {
  writes: number;
}

/**
 * Applies scene commands to real SVG. Element ids are scoped to the figure
 * so two figures on a page never collide.
 */
export class SceneDom {
  private readonly stages = new Map<number, StageDom>();
  private readonly elements = new Map<number, Element>();
  private readonly ids = new WeakMap<Element, number>();
  private readonly dots = new Map<number, DotsState>();
  private readonly dirtyCanvases = new Set<number>();
  private focusedOwner: string | null = null;
  readonly stats: SceneDomStats = { writes: 0 };
  /** Called when a stage appears or its interaction changes, for the pointer controller. */
  onStage: ((stage: StageDom) => void) | null = null;

  constructor(
    private readonly sceneRoot: HTMLElement,
    private readonly scope: string,
  ) {}

  /** The DOM element for a scene id, if it exists. */
  element(id: number): Element | undefined {
    return this.elements.get(id);
  }

  /** The scene id of a DOM element the scene created. */
  idOf(element: Element): number | undefined {
    return this.ids.get(element);
  }

  stage(id: number): StageDom | undefined {
    return this.stages.get(id);
  }

  /** The stage an SVG element belongs to. */
  stageOf(element: Element): StageDom | undefined {
    const svg = element.closest('svg.inc-stage');
    for (const stage of this.stages.values()) if (stage.svg === svg) return stage;
    return undefined;
  }

  stageElements(): SVGSVGElement[] {
    return [...this.stages.values()].map((stage) => stage.svg);
  }

  allStages(): StageDom[] {
    return [...this.stages.values()];
  }

  /** Highlights every element drawing for a part that lives in shared slots (3D faces). */
  focusOwner(part: string | null): void {
    if (part === this.focusedOwner) return;
    this.focusedOwner = part;
    for (const element of this.elements.values()) {
      const owner = element.getAttribute('data-owner');
      if (owner !== null) element.classList.toggle('is-focus', owner === part);
    }
  }

  clear(): void {
    for (const stage of this.stages.values()) {
      stage.svg.remove();
      stage.canvases.back?.remove();
      stage.canvases.front?.remove();
    }
    this.stages.clear();
    this.elements.clear();
    this.dots.clear();
  }

  apply(commands: readonly SceneCommand[]): void {
    for (const command of commands) this.applyOne(command);
    for (const stage of this.dirtyCanvases) this.paintDots(stage);
    this.dirtyCanvases.clear();
  }

  /** Repaints every canvas layer, after a resize or a zoom. */
  repaintDots(): void {
    for (const stage of this.stages.keys()) this.paintDots(stage);
  }

  private applyOne(command: SceneCommand): void {
    switch (command.op) {
      case 'stage': {
        const host = this.findHost(command.selector);
        if (!host) throw new Error(`No element matches ${command.selector} in the scene HTML`);
        const doc = host.ownerDocument;
        const svg = doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
        const titleId = `${this.scope}-title-${command.id}`;
        const descId = `${this.scope}-desc-${command.id}`;
        svg.setAttribute('viewBox', command.viewBox.join(' '));
        svg.setAttribute('class', 'inc-stage');
        svg.setAttribute('role', 'graphics-document');
        svg.setAttribute('aria-roledescription', 'figure');
        svg.setAttribute('aria-labelledby', titleId);
        // The live text alternative joins the static description once the scene provides one.
        svg.setAttribute('aria-describedby', `${descId} ${this.scope}-description`);
        svg.setAttribute('focusable', 'false');
        const title = doc.createElementNS(SVG_NS, 'title');
        title.id = titleId;
        title.textContent = command.title;
        const desc = doc.createElementNS(SVG_NS, 'desc');
        desc.id = descId;
        desc.textContent = command.description || command.title;
        const defs = doc.createElementNS(SVG_NS, 'defs') as SVGDefsElement;
        svg.append(title, desc, defs);
        const layers = {} as Record<Layer, SVGGElement>;
        for (const name of LAYERS) {
          const g = doc.createElementNS(SVG_NS, 'g') as SVGGElement;
          g.setAttribute('data-layer', name);
          if (name === 'back' || name === 'labels') g.setAttribute('pointer-events', 'none');
          layers[name] = g;
          svg.append(g);
        }
        if (command.clip) {
          const clipId = `${this.scope}-clip-${command.id}`;
          const clipPath = doc.createElementNS(SVG_NS, 'clipPath');
          clipPath.id = clipId;
          const rect = doc.createElementNS(SVG_NS, 'rect');
          const [x, y, w, h] = command.clip;
          rect.setAttribute('x', String(x));
          rect.setAttribute('y', String(y));
          rect.setAttribute('width', String(w));
          rect.setAttribute('height', String(h));
          clipPath.append(rect);
          defs.append(clipPath);
          // A graph's plotted marks stay inside the plot area as the learner zooms and pans; its axes live on the back layer.
          for (const layer of ['mid', 'front', 'labels'] as const) layers[layer].setAttribute('clip-path', `url(#${clipId})`);
        }
        host.classList.add('inc-stage-host');
        host.append(svg);
        const stage: StageDom = {
          id: command.id,
          svg,
          host,
          layers,
          defs,
          viewBox: command.viewBox,
          interaction: { zoom: 'viewbox', hover: false, orbit: false, views: [] },
          gradients: new Set(),
          canvases: {},
        };
        this.stages.set(command.id, stage);
        this.stats.writes++;
        this.onStage?.(stage);
        return;
      }
      case 'create': {
        if (!KINDS.has(command.kind) || this.elements.has(command.id)) return;
        const stage = this.stages.get(command.parent);
        const parent = stage ? stage.layers[command.layer] : this.elements.get(command.parent);
        if (!parent) return;
        const element = parent.ownerDocument.createElementNS(SVG_NS, command.kind);
        if (command.kind === 'use') {
          // A copy points at its source by a scoped id the renderer gives it; nothing else may be referenced.
          const source = command.source === undefined ? undefined : this.elements.get(command.source);
          if (!source) return;
          const id = `${this.scope}-el-${command.source}`;
          source.id = id;
          element.setAttribute('href', `#${id}`);
        }
        parent.append(element);
        this.elements.set(command.id, element);
        this.ids.set(element, command.id);
        this.stats.writes++;
        return;
      }
      case 'attr': {
        const element = this.elements.get(command.id);
        if (!element || !RENDERABLE_ATTRIBUTES.has(command.name)) return;
        if (command.value === null) element.removeAttribute(command.name);
        else element.setAttribute(command.name, command.value);
        // The theme's rules outrank presentation attributes, so these reach the
        // theme through variables it reads, where focus can still override them.
        const variable = STYLED_ATTRIBUTES[command.name];
        if (variable) {
          if (command.value === null) (element as SVGElement).style.removeProperty(variable);
          else (element as SVGElement).style.setProperty(variable, /^-?[\d.]+$/.test(command.value) ? `${command.value}px` : command.value);
        }
        this.stats.writes++;
        return;
      }
      case 'text': {
        const element = this.elements.get(command.id);
        if (!element) return;
        element.textContent = command.value;
        this.stats.writes++;
        return;
      }
      case 'class': {
        const element = this.elements.get(command.id);
        if (!element) return;
        const focused = element.classList.contains('is-focus');
        const dragging = element.classList.contains('is-dragging');
        element.setAttribute('class', command.value + (focused ? ' is-focus' : '') + (dragging ? ' is-dragging' : ''));
        this.shade(element, command.value);
        this.stats.writes++;
        return;
      }
      case 'part': {
        const element = this.elements.get(command.id);
        if (!element) return;
        element.setAttribute('data-part', command.name);
        element.setAttribute('tabindex', '0');
        element.setAttribute('role', 'graphics-symbol');
        element.setAttribute('aria-label', command.info ? `${command.label}: ${command.info}` : command.label);
        this.stats.writes++;
        return;
      }
      case 'drag': {
        const element = this.elements.get(command.id);
        if (!element) return;
        element.setAttribute('data-drag', '');
        element.classList.add('inc-draggable');
        element.setAttribute('tabindex', '0');
        if (!element.hasAttribute('role')) element.setAttribute('role', 'graphics-symbol');
        const label = element.getAttribute('aria-label');
        element.setAttribute('aria-label', label ? `${label}. Drag, or use the arrow keys, to change it` : `${command.label}: drag, or use the arrow keys`);
        element.setAttribute('aria-roledescription', 'draggable');
        this.stats.writes++;
        return;
      }
      case 'interact': {
        const stage = this.stages.get(command.id);
        if (!stage) return;
        stage.interaction = { zoom: command.zoom, hover: command.hover, orbit: command.orbit, views: command.views };
        stage.svg.dataset.zoom = command.zoom;
        if (command.orbit) stage.svg.dataset.orbit = '';
        this.onStage?.(stage);
        return;
      }
      case 'owner': {
        const element = this.elements.get(command.id);
        if (!element) return;
        if (command.part === null) element.removeAttribute('data-owner');
        else element.setAttribute('data-owner', command.part);
        // A reused slot takes on or drops the highlight of the part it now draws for.
        element.classList.toggle('is-focus', command.part !== null && command.part === this.focusedOwner);
        return;
      }
      case 'order': {
        const parent = this.elements.get(command.id);
        if (!parent) return;
        for (const id of command.children) {
          const child = this.elements.get(id);
          if (child && child.parentNode === parent) parent.append(child);
        }
        this.stats.writes++;
        return;
      }
      case 'dots': {
        if (!this.stages.has(command.stage)) return;
        const previous = this.dots.get(command.id);
        this.dots.set(command.id, { stage: command.stage, layer: command.layer, tone: command.tone, r: command.r, points: command.points });
        this.dirtyCanvases.add(command.stage);
        if (previous && previous.stage !== command.stage) this.dirtyCanvases.add(previous.stage);
        return;
      }
    }
  }

  /** Filled shapes with a shade get a gradient in their tone, made once per stage. */
  private shade(element: Element, classes: string): void {
    const shade = SHADE.exec(classes)?.[1];
    const svgElement = element as SVGElement;
    if (!shade) {
      if (svgElement.style.getPropertyValue('--inc-grad')) svgElement.style.removeProperty('--inc-grad');
      return;
    }
    const tone = TONE.exec(classes)?.[1] ?? 'mid';
    const stage = this.stageOf(element);
    if (!stage) return;
    const key = `${shade}-${tone}`;
    const id = `${this.scope}-g${stage.id}-${key}`;
    if (!stage.gradients.has(key)) {
      stage.gradients.add(key);
      const doc = element.ownerDocument;
      const gradient = doc.createElementNS(SVG_NS, shade === 'sphere' ? 'radialGradient' : 'linearGradient');
      gradient.id = id;
      gradient.setAttribute('class', `inc-tone-${tone}`);
      if (shade === 'sphere') {
        gradient.setAttribute('cx', '0.38');
        gradient.setAttribute('cy', '0.32');
        gradient.setAttribute('r', '0.7');
      } else if (shade === 'cylinder') {
        gradient.setAttribute('x1', '0');
        gradient.setAttribute('x2', '1');
        gradient.setAttribute('y1', '0');
        gradient.setAttribute('y2', '0');
      } else {
        gradient.setAttribute('x1', '0');
        gradient.setAttribute('x2', '0');
        gradient.setAttribute('y1', '0');
        gradient.setAttribute('y2', '1');
      }
      const stops: ReadonlyArray<readonly [string, string]> =
        shade === 'cylinder'
          ? [['0', 'inc-stop-dark'], ['0.4', 'inc-stop-light'], ['1', 'inc-stop-dark']]
          : [['0', 'inc-stop-light'], ['1', 'inc-stop-dark']];
      for (const [offset, kind] of stops) {
        const stop = doc.createElementNS(SVG_NS, 'stop');
        stop.setAttribute('offset', offset);
        stop.setAttribute('class', kind);
        gradient.append(stop);
      }
      stage.defs.append(gradient);
    }
    // CSS fills win over attributes, so the gradient is set as a style property (CSSOM, allowed by the frame policy).
    svgElement.style.setProperty('--inc-grad', `url(#${id})`);
  }

  private paintDots(stageId: number): void {
    const stage = this.stages.get(stageId);
    if (!stage) return;
    for (const layer of ['back', 'front'] as const) {
      const sets = [...this.dots.values()].filter((d) => d.stage === stageId && d.layer === layer);
      let canvas = stage.canvases[layer];
      if (sets.length === 0 && !canvas) continue;
      if (!canvas) {
        canvas = stage.host.ownerDocument.createElement('canvas');
        canvas.className = `inc-dots inc-dots--${layer}`;
        canvas.setAttribute('aria-hidden', 'true');
        if (layer === 'back') stage.svg.before(canvas);
        else stage.svg.after(canvas);
        stage.canvases[layer] = canvas;
      }
      this.paintCanvas(stage, canvas, sets);
    }
  }

  private paintCanvas(stage: StageDom, canvas: HTMLCanvasElement, sets: readonly DotsState[]): void {
    const rect = stage.svg.getBoundingClientRect();
    const ratio = stage.host.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const host = stage.host.getBoundingClientRect();
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    canvas.style.left = `${rect.left - host.left}px`;
    canvas.style.top = `${rect.top - host.top}px`;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, width, height);
    // The canvas shares the stage's current view box (which zooming changes) and its letterboxing.
    const box = (stage.svg.getAttribute('viewBox') ?? stage.viewBox.join(' ')).split(/[\s,]+/).map(Number);
    const [vx = 0, vy = 0, vw = 1, vh = 1] = box;
    const scale = Math.min(width / vw, height / vh);
    const ox = (width - vw * scale) / 2;
    const oy = (height - vh * scale) / 2;
    const style = stage.host.ownerDocument.defaultView?.getComputedStyle(stage.svg);
    for (const set of sets) {
      context.fillStyle = style?.getPropertyValue(`--inc-${set.tone}`).trim() || '#888';
      const r = Math.max(0.5, set.r * scale);
      context.beginPath();
      for (let i = 0; i + 1 < set.points.length; i += 2) {
        const x = ox + (set.points[i]! - vx) * scale;
        const y = oy + (set.points[i + 1]! - vy) * scale;
        context.moveTo(x + r, y);
        context.arc(x, y, r, 0, Math.PI * 2);
      }
      context.fill();
    }
  }

  private findHost(selector: string): HTMLElement | null {
    if (!/^#[A-Za-z][\w-]*$/.test(selector)) return null;
    const id = selector.slice(1);
    for (const element of this.sceneRoot.querySelectorAll<HTMLElement>('[id]')) {
      if (element.id === id) return element;
    }
    return null;
  }
}
