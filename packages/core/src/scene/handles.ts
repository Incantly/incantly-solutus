import type {
  AttributeValues,
  ElementOptions,
  Handle,
  Layer,
  PartOptions,
  PathHandle,
  PolylineHandle,
  Readable,
  Stage,
  TextHandle,
  Tone,
  Vec2,
  ViewBox,
} from '../api/types';
import type { ElementKind } from '../protocol/scene-commands';
import { SceneApiError } from './errors';
import { fmt } from './format';
import type { SceneGraph, VNode } from './graph';

export const TONES: ReadonlySet<string> = new Set<Tone>(['lo', 'mid', 'hi', 'lit', 'faint', 'a', 'b', 'c']);
export const LAYERS: ReadonlySet<string> = new Set<Layer>(['back', 'mid', 'front', 'labels']);

/** Maps handles back to their nodes. Objects a scene invents are not SDK handles. */
const nodes = new WeakMap<object, VNode>();

export function nodeOf(handle: unknown): VNode {
  const node = typeof handle === 'object' && handle !== null ? nodes.get(handle) : undefined;
  if (!node) throw new SceneApiError('Expected a handle returned by the SDK');
  return node;
}

/** Formats a number for display: integers as is, others to at most two decimals. */
export function formatReadable(value: Readable): string {
  if (typeof value === 'string') return value;
  if (!Number.isFinite(value)) return String(value);
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

export class ElementHandle implements Handle {
  constructor(
    protected readonly graph: SceneGraph,
    node: VNode,
  ) {
    nodes.set(this, node);
  }

  protected get node(): VNode {
    return nodes.get(this)!;
  }

  set(attributes: AttributeValues): this {
    for (const [name, value] of Object.entries(attributes)) {
      if (value === undefined) continue;
      if (name === 'transform') throw new SceneApiError('Use at(), rotate() and scale() instead of a transform attribute');
      this.graph.setAttribute(this.node, name, value);
    }
    return this;
  }

  at(x: number, y: number): this {
    this.graph.setTransform(this.node, { tx: x, ty: y });
    return this;
  }

  rotate(degrees: number, cx = 0, cy = 0): this {
    this.graph.setTransform(this.node, { rotation: degrees, rcx: cx, rcy: cy });
    return this;
  }

  scale(sx: number, sy: number = sx): this {
    this.graph.setTransform(this.node, { sx, sy });
    return this;
  }

  show(visible = true): this {
    if (this.node.hidden === !visible) return this;
    this.graph.setFlags(this.node, { hidden: !visible });
    return this;
  }

  hide(): this {
    return this.show(false);
  }

  tone(name: Tone): this {
    if (!TONES.has(name)) throw new SceneApiError(`Unknown tone "${String(name)}"`);
    if (this.node.tone !== name) this.graph.setFlags(this.node, { tone: name });
    return this;
  }

  dashed(on = true): this {
    if (this.node.dashed !== on) this.graph.setFlags(this.node, { dashed: on });
    return this;
  }
}

export class PathElementHandle extends ElementHandle implements PathHandle {
  d(path: string): this {
    this.graph.setAttribute(this.node, 'd', path);
    return this;
  }
}

export class TextElementHandle extends ElementHandle implements TextHandle {
  text(value: Readable): this {
    this.graph.setText(this.node, formatReadable(value));
    return this;
  }
}

export function pointsAttribute(points: ReadonlyArray<Vec2>): string | null {
  const out: string[] = [];
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    out.push(`${fmt(x)},${fmt(y)}`);
  }
  return out.join(' ');
}

export class PolylineElementHandle extends ElementHandle implements PolylineHandle {
  points(points: ReadonlyArray<Vec2>): this {
    const value = pointsAttribute(points);
    if (value === null) {
      this.graph.diagnostics.push({ kind: 'non-finite', message: 'Polyline received a non-finite point', elementId: this.node.id });
      return this;
    }
    this.graph.setAttribute(this.node, 'points', value);
    return this;
  }
}

export interface PartRecord {
  readonly name: string;
  readonly label: string;
  readonly info: string;
  readonly node: VNode;
}

export class PartRegistry {
  readonly parts = new Map<string, PartRecord>();

  constructor(private readonly graph: SceneGraph) {}

  register(name: string, handle: Handle, options: PartOptions = {}): void {
    if (typeof name !== 'string' || name.trim() === '' || name.length > 60) {
      throw new SceneApiError('A part needs a short, non-empty name');
    }
    if (this.parts.has(name)) throw new SceneApiError(`Part "${name}" is registered twice`);
    const node = nodeOf(handle);
    const label = options.label ?? name;
    const info = options.info ?? '';
    this.parts.set(name, { name, label, info, node });
    this.graph.markPart(node, name, label, info);
  }
}

export class StageHandle implements Stage {
  readonly viewBox: ViewBox;

  constructor(
    private readonly graph: SceneGraph,
    private readonly stageNode: VNode,
    viewBox: ViewBox,
    private readonly parts: PartRegistry,
  ) {
    this.viewBox = viewBox;
    nodes.set(this, stageNode);
  }

  private make(kind: ElementKind, options: ElementOptions = {}): VNode {
    const layer = options.layer ?? 'mid';
    if (!LAYERS.has(layer)) throw new SceneApiError(`Unknown layer "${String(layer)}"`);
    let parent = this.stageNode;
    if (options.parent !== undefined) {
      parent = nodeOf(options.parent);
      if (parent.kind !== 'g' || parent.stage !== this.stageNode.id) {
        throw new SceneApiError('An element parent must be a group on the same stage');
      }
    }
    const node = this.graph.create(kind, parent, layer);
    if (options.tone !== undefined) {
      if (!TONES.has(options.tone)) throw new SceneApiError(`Unknown tone "${String(options.tone)}"`);
      this.graph.setFlags(node, { tone: options.tone });
    }
    if (options.dashed) this.graph.setFlags(node, { dashed: true });
    return node;
  }

  group(options?: ElementOptions): Handle {
    return new ElementHandle(this.graph, this.make('g', options));
  }

  path(d?: string, options?: ElementOptions): PathHandle {
    const handle = new PathElementHandle(this.graph, this.make('path', options));
    if (d !== undefined) handle.d(d);
    return handle;
  }

  line(x1: number, y1: number, x2: number, y2: number, options?: ElementOptions): Handle {
    return new ElementHandle(this.graph, this.make('line', options)).set({ x1, y1, x2, y2 });
  }

  circle(cx: number, cy: number, r: number, options?: ElementOptions): Handle {
    return new ElementHandle(this.graph, this.make('circle', options)).set({ cx, cy, r });
  }

  rect(x: number, y: number, width: number, height: number, options?: ElementOptions): Handle {
    return new ElementHandle(this.graph, this.make('rect', options)).set({ x, y, width, height });
  }

  text(x: number, y: number, value: Readable, options?: ElementOptions): TextHandle {
    return new TextElementHandle(this.graph, this.make('text', { layer: 'labels', ...options }))
      .set({ x, y })
      .text(value);
  }

  polyline(points: ReadonlyArray<Vec2>, options?: ElementOptions): PolylineHandle {
    return new PolylineElementHandle(this.graph, this.make('polyline', options)).points(points);
  }

  part<H extends Handle>(name: string, handle: H, options?: PartOptions): H {
    this.parts.register(name, handle, options);
    return handle;
  }
}
