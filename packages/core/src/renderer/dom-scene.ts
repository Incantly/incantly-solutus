import type { Layer } from '../api/types';
import { RENDERABLE_ATTRIBUTES, type SceneCommand } from '../protocol/scene-commands';

export const SVG_NS = 'http://www.w3.org/2000/svg';
const LAYERS: readonly Layer[] = ['back', 'mid', 'front', 'labels'];

interface StageDom {
  readonly svg: SVGSVGElement;
  readonly layers: Readonly<Record<Layer, SVGGElement>>;
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
  readonly stats: SceneDomStats = { writes: 0 };

  constructor(
    private readonly sceneRoot: HTMLElement,
    private readonly scope: string,
  ) {}

  /** The DOM element for a scene id, if it exists. */
  element(id: number): Element | undefined {
    return this.elements.get(id);
  }

  stageElements(): SVGSVGElement[] {
    return [...this.stages.values()].map((stage) => stage.svg);
  }

  clear(): void {
    for (const stage of this.stages.values()) stage.svg.remove();
    this.stages.clear();
    this.elements.clear();
  }

  apply(commands: readonly SceneCommand[]): void {
    for (const command of commands) this.applyOne(command);
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
        svg.setAttribute('aria-describedby', descId);
        svg.setAttribute('focusable', 'false');
        const title = doc.createElementNS(SVG_NS, 'title');
        title.id = titleId;
        title.textContent = command.title;
        const desc = doc.createElementNS(SVG_NS, 'desc');
        desc.id = descId;
        desc.textContent = command.description || command.title;
        svg.append(title, desc);
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
          const defs = doc.createElementNS(SVG_NS, 'defs');
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
          svg.insertBefore(defs, layers.back);
          layers.mid.setAttribute('clip-path', `url(#${clipId})`);
        }
        host.append(svg);
        this.stages.set(command.id, { svg, layers });
        this.stats.writes++;
        return;
      }
      case 'create': {
        const stage = this.stages.get(command.parent);
        const parent = stage ? stage.layers[command.layer] : this.elements.get(command.parent);
        if (!parent) return;
        const element = parent.ownerDocument.createElementNS(SVG_NS, command.kind);
        parent.append(element);
        this.elements.set(command.id, element);
        this.stats.writes++;
        return;
      }
      case 'attr': {
        const element = this.elements.get(command.id);
        if (!element || !RENDERABLE_ATTRIBUTES.has(command.name)) return;
        if (command.value === null) element.removeAttribute(command.name);
        else element.setAttribute(command.name, command.value);
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
        element.setAttribute('class', command.value + (focused ? ' is-focus' : ''));
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
