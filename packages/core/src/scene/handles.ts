import type {
  AttributeValues,
  CalloutOptions,
  ConnectorOptions,
  Dots,
  DotsOptions,
  DragMap,
  ElementOptions,
  Handle,
  Layer,
  PartOptions,
  PathHandle,
  PolylineHandle,
  Readable,
  Shade,
  Stage,
  TextHandle,
  Tone,
  Vec2,
  ViewBox,
} from '../api/types';
import type { ElementKind } from '../protocol/scene-commands';
import { elementBox } from './bounds';
import { SceneApiError } from './errors';
import { fmt } from './format';
import type { GraphServices, SceneGraph, VNode } from './graph';

export const TONES: ReadonlySet<string> = new Set<Tone>(['lo', 'mid', 'hi', 'lit', 'faint', 'a', 'b', 'c']);
export const LAYERS: ReadonlySet<string> = new Set<Layer>(['back', 'mid', 'front', 'labels']);
export const SHADES: ReadonlySet<string> = new Set<Shade>(['sphere', 'cylinder', 'soft']);
/** Dots one layer may hold. */
export const MAX_DOTS = 2000;

function services(graph: SceneGraph): GraphServices {
  if (!graph.services) throw new SceneApiError('This figure cannot do that outside a running scene');
  return graph.services;
}

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

  flow(speed: number): this {
    if (!Number.isFinite(speed)) throw new SceneApiError('flow needs a finite speed');
    services(this.graph).setFlow(this.node, speed);
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
  /** Whether its colour may earn a legend entry; kits whose tones only mark emphasis say no. */
  readonly legend: boolean;
}

/** How a kit registers a part beyond what scenes can say. */
export interface PartUse {
  readonly legend?: boolean;
}

export class PartRegistry {
  readonly parts = new Map<string, PartRecord>();

  constructor(private readonly graph: SceneGraph) {}

  register(name: string, handle: Handle, options: PartOptions = {}, use: PartUse = {}): void {
    if (typeof name !== 'string' || name.trim() === '' || name.length > 60) {
      throw new SceneApiError('A part needs a short, non-empty name');
    }
    if (this.parts.has(name)) throw new SceneApiError(`Part "${name}" is registered twice`);
    const node = nodeOf(handle);
    const label = options.label ?? name;
    const info = options.info ?? '';
    this.parts.set(name, { name, label, info, node, legend: use.legend !== false });
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

  private make(kind: ElementKind, options: ElementOptions = {}, source?: VNode): VNode {
    const layer = options.layer ?? 'mid';
    if (!LAYERS.has(layer)) throw new SceneApiError(`Unknown layer "${String(layer)}"`);
    let parent = this.stageNode;
    if (options.parent !== undefined) {
      parent = nodeOf(options.parent);
      if (parent.kind !== 'g' || parent.stage !== this.stageNode.id) {
        throw new SceneApiError('An element parent must be a group on the same stage');
      }
    }
    const node = this.graph.create(kind, parent, layer, source);
    if (options.tone !== undefined) {
      if (!TONES.has(options.tone)) throw new SceneApiError(`Unknown tone "${String(options.tone)}"`);
      this.graph.setFlags(node, { tone: options.tone });
    }
    if (options.dashed) this.graph.setFlags(node, { dashed: true });
    if (options.fill) this.graph.setFlags(node, { fill: true });
    if (options.shade !== undefined) {
      if (!SHADES.has(options.shade)) throw new SceneApiError(`Unknown shade "${String(options.shade)}"; use sphere, cylinder or soft`);
      this.graph.setFlags(node, { shade: options.shade, fill: true });
    }
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

  part<H extends Handle>(name: string, handle: H, options?: PartOptions, use?: PartUse): H {
    this.parts.register(name, handle, options, use);
    return handle;
  }

  drag<H extends Handle>(handle: H, map: DragMap, options: { readonly label?: string } = {}): H {
    if (typeof map !== 'function') throw new SceneApiError('drag needs a function that turns the pointer into parameter values');
    const node = this.own(handle, 'drag');
    services(this.graph).addDrag(node, options.label ?? node.part ?? 'item', map);
    return handle;
  }

  connector(a: Handle, b: Handle, options: ConnectorOptions = {}): PathHandle {
    const from = this.own(a, 'connector');
    const to = this.own(b, 'connector');
    const path = this.path(undefined, { layer: 'back', tone: options.tone ?? 'mid', dashed: options.dashed ?? false });
    const gap = options.gap ?? 0;
    const bend = options.bend ?? 0;
    services(this.graph).onRedraw(() => {
      const p = centre(this.graph, from);
      const q = centre(this.graph, to);
      if (!p || !q) return;
      path.d(connectorPath(p, q, gap, bend, options.arrow ?? false));
    });
    return path;
  }

  callout(target: Handle, text: Readable | (() => Readable), options: CalloutOptions = {}): TextHandle {
    const node = this.own(target, 'callout');
    const dx = options.dx ?? 36;
    const dy = options.dy ?? -28;
    const leader = this.line(0, 0, 0, 0, { layer: 'labels', tone: options.tone ?? 'mid' });
    const label = this.text(0, 0, typeof text === 'function' ? '' : text, { layer: 'labels', ...(options.tone ? { tone: options.tone } : {}) });
    label.set({ 'font-size': 13, 'text-anchor': dx < 0 ? 'end' : 'start' });
    services(this.graph).onRedraw(() => {
      const box = elementBox(this.graph, node.id);
      if (!box) return;
      const cx = (box.minX + box.maxX) / 2;
      const cy = (box.minY + box.maxY) / 2;
      // The leader starts on the element's edge in the label's direction.
      const ex = dx === 0 ? cx : dx > 0 ? box.maxX : box.minX;
      const ey = dy === 0 ? cy : dy > 0 ? box.maxY : box.minY;
      const lx = ex + dx;
      const ly = ey + dy;
      leader.set({ x1: ex, y1: ey, x2: lx - Math.sign(dx) * 2, y2: ly });
      label.set({ x: lx + Math.sign(dx) * 4, y: ly + 4 });
      if (typeof text === 'function') label.text(text());
    });
    return label;
  }

  repeat(handle: Handle, count: number): Handle[] {
    const source = this.own(handle, 'repeat');
    if (!Number.isInteger(count) || count < 1 || count > 500) throw new SceneApiError('repeat needs a whole number of copies from 1 to 500');
    if (source.kind === 'g' && source.children.length === 0) throw new SceneApiError('repeat a group only after drawing into it');
    const out: Handle[] = [];
    for (let i = 0; i < count; i++) out.push(new ElementHandle(this.graph, this.make('use', { layer: source.layer }, source)));
    return out;
  }

  dots(options: DotsOptions = {}): Dots {
    const tone = options.tone ?? 'mid';
    if (!TONES.has(tone)) throw new SceneApiError(`Unknown tone "${String(tone)}"`);
    const r = options.r ?? 3;
    if (!(Number.isFinite(r) && r > 0 && r <= 50)) throw new SceneApiError('dots need a radius from 0 to 50');
    const layer = options.layer ?? 'front';
    if (layer !== 'back' && layer !== 'front') throw new SceneApiError('dots go on the back or front layer');
    const graph = this.graph;
    const stage = this.stageNode.id;
    const id = graph.newId();
    let current = tone;
    let flat: number[] = [];
    const dots: Dots = {
      set(points) {
        if (!Array.isArray(points)) throw new SceneApiError('dots.set needs a list of [x, y] points');
        if (points.length > MAX_DOTS) throw new SceneApiError(`At most ${MAX_DOTS} dots`);
        flat = [];
        for (const point of points) {
          const [x, y] = point;
          if (Number.isFinite(x) && Number.isFinite(y)) flat.push(Math.round(x * 100) / 100, Math.round(y * 100) / 100);
        }
        graph.setDots(id, stage, layer, current, r, flat);
        return dots;
      },
      tone(name) {
        if (!TONES.has(name)) throw new SceneApiError(`Unknown tone "${String(name)}"`);
        current = name;
        graph.setDots(id, stage, layer, current, r, flat);
        return dots;
      },
    };
    graph.setDots(id, stage, layer, current, r, flat);
    return dots;
  }

  /** The node of a handle drawn on this stage. */
  private own(handle: Handle, call: string): VNode {
    const node = nodeOf(handle);
    if (node.stage !== this.stageNode.id || node.kind === 'stage') throw new SceneApiError(`${call} needs an element of the same stage`);
    return node;
  }
}

function centre(graph: SceneGraph, node: VNode): Vec2 | null {
  const box = elementBox(graph, node.id);
  return box ? [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2] : null;
}

/** A line from p to q, shortened by `gap` at both ends, bent sideways by `bend`, with an optional arrow head at q. */
export function connectorPath(p: Vec2, q: Vec2, gap: number, bend: number, arrow: boolean): string {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return '';
  const ux = dx / length;
  const uy = dy / length;
  const g = Math.min(gap, length / 3);
  const a: Vec2 = [p[0] + ux * g, p[1] + uy * g];
  const b: Vec2 = [q[0] - ux * g, q[1] - uy * g];
  let d: string;
  let tx = ux;
  let ty = uy;
  if (bend !== 0) {
    const c: Vec2 = [(a[0] + b[0]) / 2 - uy * bend, (a[1] + b[1]) / 2 + ux * bend];
    d = `M${fmt(a[0])} ${fmt(a[1])}Q${fmt(c[0])} ${fmt(c[1])} ${fmt(b[0])} ${fmt(b[1])}`;
    const tl = Math.hypot(b[0] - c[0], b[1] - c[1]) || 1;
    tx = (b[0] - c[0]) / tl;
    ty = (b[1] - c[1]) / tl;
  } else d = `M${fmt(a[0])} ${fmt(a[1])}L${fmt(b[0])} ${fmt(b[1])}`;
  if (arrow) {
    const h = Math.min(10, length / 4);
    const lx = b[0] - tx * h - ty * h * 0.5;
    const ly = b[1] - ty * h + tx * h * 0.5;
    const rx = b[0] - tx * h + ty * h * 0.5;
    const ry = b[1] - ty * h - tx * h * 0.5;
    d += `M${fmt(lx)} ${fmt(ly)}L${fmt(b[0])} ${fmt(b[1])}L${fmt(rx)} ${fmt(ry)}`;
  }
  return d;
}
