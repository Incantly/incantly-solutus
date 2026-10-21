import type {
  Flow,
  FlowEdge,
  FlowEdgeOptions,
  FlowNode,
  FlowNodeOptions,
  FlowOptions,
  Handle,
  PathHandle,
  Readable,
  TextHandle,
  Tone,
  Vec2,
  ViewBox,
} from '../../api/types';
import type { KitContext } from '../../runtime/kit';
import { SceneApiError } from '../../scene/errors';
import { fmt } from '../../scene/format';
import { formatReadable, TONES, type StageHandle } from '../../scene/handles';
import { layoutFlow, type Direction, type FlowLayout } from './layout';
import { borderPoint, LINE_HEIGHT, NODE_SHAPES, nodeSize, shapePath, wrapLabel, type NodeShape } from './shapes';

export const DEFAULT_FLOW_VIEWBOX: ViewBox = [0, 0, 640, 420];
const MAX_NODES = 40;
const MAX_EDGES = 80;
const MAX_LAYER = 39;
/** Margin inside the view box around the fitted diagram. */
const PAD = 14;
/** The diagram may grow to fill its view box, but not so much that text looks out of scale. */
const MAX_SCALE = 1.25;
const HEAD = 9;

interface NodeRecord {
  readonly id: string;
  label: string;
  lines: string[];
  readonly shape: NodeShape;
  readonly group: Handle;
  readonly fill: PathHandle;
  readonly outline: PathHandle;
  readonly texts: TextHandle[];
  readonly layer: number | undefined;
  w: number;
  h: number;
  x: number;
  y: number;
}

interface EdgeRecord {
  readonly from: NodeRecord;
  readonly to: NodeRecord;
  readonly group: Handle;
  readonly path: PathHandle;
  readonly head: PathHandle;
  text: TextHandle | null;
  label: string | null;
}

function fail(message: string): never {
  throw new SceneApiError(message);
}

function checkTone(tone: unknown): Tone | undefined {
  if (tone === undefined) return undefined;
  if (typeof tone !== 'string' || !TONES.has(tone)) fail(`Unknown tone "${String(tone)}"`);
  return tone as Tone;
}

/** Checks a flowchart's options and returns its view box (the kit's layout step). */
export function flowLayout(options: unknown): { readonly viewBox: ViewBox } {
  const o = options as FlowOptions;
  const viewBox = o.viewBox ?? DEFAULT_FLOW_VIEWBOX;
  if (!Array.isArray(viewBox) || viewBox.length !== 4 || !viewBox.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    fail('flow: viewBox must be four finite numbers');
  }
  if (!(viewBox[2] >= 120 && viewBox[3] >= 80)) fail('flow: the view box is too small for a diagram; make it at least 120 by 80');
  if (o.direction !== undefined && o.direction !== 'down' && o.direction !== 'right') fail(`flow: direction is 'down' or 'right', not "${String(o.direction)}"`);
  return { viewBox: [viewBox[0], viewBox[1], viewBox[2], viewBox[3]] };
}

/** A smooth path through points, leaving and entering each along the layout's direction. */
function curveThrough(points: readonly Vec2[], down: boolean): string {
  let d = `M${fmt(points[0]![0])} ${fmt(points[0]![1])}`;
  for (let i = 1; i < points.length; i++) {
    const [px, py] = points[i - 1]!;
    const [qx, qy] = points[i]!;
    const c1: Vec2 = down ? [px, py + (qy - py) / 2] : [px + (qx - px) / 2, py];
    const c2: Vec2 = down ? [qx, qy - (qy - py) / 2] : [qx - (qx - px) / 2, qy];
    d += `C${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(qx)} ${fmt(qy)}`;
  }
  return d;
}

function bezierPoint(p: Vec2, c1: Vec2, c2: Vec2, q: Vec2, t: number): Vec2 {
  const u = 1 - t;
  return [
    u * u * u * p[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * q[0],
    u * u * u * p[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * q[1],
  ];
}

function unit(dx: number, dy: number): Vec2 {
  const length = Math.hypot(dx, dy) || 1;
  return [dx / length, dy / length];
}

/** A filled arrowhead with its tip at `tip`, pointing along `dir`. */
function headPath(tip: Vec2, dir: Vec2): string {
  const [ux, uy] = dir;
  const bx = tip[0] - ux * HEAD;
  const by = tip[1] - uy * HEAD;
  return `M${fmt(tip[0])} ${fmt(tip[1])}L${fmt(bx - uy * HEAD * 0.5)} ${fmt(by + ux * HEAD * 0.5)}L${fmt(bx + uy * HEAD * 0.5)} ${fmt(by - ux * HEAD * 0.5)}Z`;
}

interface Drawn {
  d: string;
  head: string;
  label: Vec2 | null;
  anchor: 'start' | 'middle' | 'end';
  /** Points the drawing reaches, for fitting it to the view box. */
  reach: Vec2[];
}

export class FlowKit implements Flow {
  readonly stage: StageHandle;
  private readonly direction: Direction;
  private readonly root: Handle;
  private readonly edgeLayer: Handle;
  private readonly nodeLayer: Handle;
  private readonly nodes = new Map<string, NodeRecord>();
  private readonly edges: EdgeRecord[] = [];
  private activeId: string | null = null;
  private stale = true;
  private scale = 1;
  private offset: Vec2 = [0, 0];

  constructor(
    private readonly ctx: KitContext,
    options: FlowOptions,
  ) {
    this.stage = ctx.stage;
    this.direction = options.direction ?? 'down';
    this.root = this.stage.group({ layer: 'mid' });
    this.edgeLayer = this.stage.group({ parent: this.root });
    this.nodeLayer = this.stage.group({ parent: this.root });
    ctx.onRedraw(() => {
      if (this.stale) this.arrange();
      this.paintActive();
    });
  }

  // -------------------------------------------------------------------------
  // The Flow API
  // -------------------------------------------------------------------------

  node(id: string, label: string, options: FlowNodeOptions = {}): FlowNode {
    if (typeof id !== 'string' || id.trim() === '' || id.length > 40) fail('flow.node needs an id of 1 to 40 characters');
    if (this.nodes.has(id)) fail(`flow.node: "${id}" is already a node`);
    if (this.nodes.size >= MAX_NODES) fail(`A flowchart has at most ${MAX_NODES} nodes`);
    if (typeof label !== 'string' || label.length > 80) fail(`flow.node "${id}" needs a label of at most 80 characters`);
    const shape = options.shape ?? 'box';
    if (!NODE_SHAPES.includes(shape)) fail(`flow.node "${id}": shape is one of ${NODE_SHAPES.join(', ')}, not "${String(shape)}"`);
    const tone = checkTone(options.tone) ?? 'mid';
    if (options.layer !== undefined && !(Number.isInteger(options.layer) && options.layer >= 0 && options.layer <= MAX_LAYER)) {
      fail(`flow.node "${id}": layer is a whole number from 0 to ${MAX_LAYER}`);
    }
    if (options.info !== undefined && (typeof options.info !== 'string' || options.info.length > 200)) fail(`flow.node "${id}": info is text of at most 200 characters`);
    const group = this.stage.group({ parent: this.nodeLayer, tone });
    const record: NodeRecord = {
      id,
      label,
      lines: [],
      shape,
      group,
      fill: this.stage.path('', { parent: group, fill: true }).set({ 'fill-opacity': 0.14 }),
      outline: this.stage.path('', { parent: group }),
      texts: [],
      layer: options.layer,
      w: 0,
      h: 0,
      x: 0,
      y: 0,
    };
    this.nodes.set(id, record);
    this.setLabel(record, label);
    // Each node is a part named by its id, so a step can focus it and the learner can point at it.
    this.stage.part(id, group, { label: label.trim() === '' ? id : label, ...(options.info ? { info: options.info } : {}) });
    this.stale = true;
    return this.nodeHandle(record);
  }

  edge(from: string, to: string, options: FlowEdgeOptions = {}): FlowEdge {
    const a = this.nodes.get(from);
    const b = this.nodes.get(to);
    if (!a) fail(`flow.edge: there is no node "${String(from)}"; add it with flow.node first`);
    if (!b) fail(`flow.edge: there is no node "${String(to)}"; add it with flow.node first`);
    if (this.edges.length >= MAX_EDGES) fail(`A flowchart has at most ${MAX_EDGES} edges`);
    const tone = checkTone(options.tone);
    if (options.label !== undefined && (typeof options.label !== 'string' || options.label.length > 40)) fail('flow.edge: label is text of at most 40 characters');
    if (options.flow !== undefined && !Number.isFinite(options.flow)) fail('flow.edge: flow is a finite speed');
    const group = this.stage.group({ parent: this.edgeLayer, ...(tone ? { tone } : {}) });
    const record: EdgeRecord = {
      from: a,
      to: b,
      group,
      path: this.stage.path('', { parent: group, dashed: options.dashed ?? false }),
      head: this.stage.path('', { parent: group, fill: true }),
      text: null,
      label: null,
    };
    this.edges.push(record);
    if (options.label) this.setEdgeLabel(record, options.label);
    if (options.flow) record.path.flow(options.flow);
    this.stale = true;
    return this.edgeHandle(record);
  }

  active(id: string | null): void {
    if (id !== null && !this.nodes.has(id)) fail(`flow.active: there is no node "${String(id)}"`);
    this.activeId = id;
    this.paintActive();
  }

  // -------------------------------------------------------------------------
  // Handles
  // -------------------------------------------------------------------------

  private nodeHandle(record: NodeRecord): FlowNode {
    const setLabel = (text: string) => {
      if (text !== record.label) {
        this.setLabel(record, text);
        this.stale = true;
      }
    };
    const centre = () => this.centreOf(record);
    const handle: FlowNode = {
      id: record.id,
      label(text: Readable) {
        const value = formatReadable(text);
        if (value.length > 80) fail(`flow node "${record.id}": a label has at most 80 characters`);
        setLabel(value);
        return handle;
      },
      tone(name: Tone) {
        record.group.tone(checkTone(name)!);
        return handle;
      },
      centre,
    };
    return handle;
  }

  private edgeHandle(record: EdgeRecord): FlowEdge {
    const setLabel = (text: string) => this.setEdgeLabel(record, text);
    const handle: FlowEdge = {
      label(text: Readable) {
        const value = formatReadable(text);
        if (value.length > 40) fail('flow.edge: label is text of at most 40 characters');
        setLabel(value);
        return handle;
      },
      tone(name: Tone) {
        record.group.tone(checkTone(name)!);
        return handle;
      },
      dashed(on = true) {
        record.path.dashed(on);
        return handle;
      },
      flow(speed: number) {
        if (!Number.isFinite(speed)) fail('flow.edge: flow is a finite speed');
        record.path.flow(speed);
        return handle;
      },
    };
    return handle;
  }

  private setLabel(record: NodeRecord, label: string): void {
    record.label = label;
    record.lines = wrapLabel(label);
    const { w, h } = nodeSize(record.shape, record.lines);
    record.w = w;
    record.h = h;
    record.fill.d(shapePath(record.shape, w, h));
    record.outline.d(shapePath(record.shape, w, h));
    while (record.texts.length < record.lines.length) {
      record.texts.push(this.stage.text(0, 0, '', { parent: record.group, tone: 'hi' }).set({ 'text-anchor': 'middle', 'font-size': 14 }));
    }
    const first = -((record.lines.length - 1) * LINE_HEIGHT) / 2;
    record.texts.forEach((text, i) => {
      const line = record.lines[i];
      if (line === undefined) text.hide();
      else text.set({ x: 0, y: first + i * LINE_HEIGHT + 5 }).text(line).show();
    });
  }

  private setEdgeLabel(record: EdgeRecord, label: string): void {
    const had = record.label !== null && record.label !== '';
    record.label = label;
    record.text ??= this.stage.text(0, 0, '', { parent: record.group }).set({ 'font-size': 12 });
    record.text.text(label);
    if (had !== (label !== '')) this.stale = true;
  }

  private centreOf(record: NodeRecord): Vec2 {
    if (this.stale) this.arrange();
    return [this.offset[0] + record.x * this.scale, this.offset[1] + record.y * this.scale];
  }

  // -------------------------------------------------------------------------
  // Layout and drawing
  // -------------------------------------------------------------------------

  private arrange(): void {
    this.stale = false;
    const list = [...this.nodes.values()];
    const layout = layoutFlow(
      list.map((n) => ({ id: n.id, w: n.w, h: n.h, ...(n.layer !== undefined ? { layer: n.layer } : {}) })),
      this.edges.map((e) => ({ from: e.from.id, to: e.to.id, labelled: e.label !== null && e.label !== '' })),
      this.direction,
    );
    // Positions to two decimals, as the transforms will hold them, so edges meet what is drawn.
    const round = (v: number) => Math.round(v * 100) / 100;
    for (const n of list) {
      const placed = layout.nodes.get(n.id)!;
      n.x = round(placed.x);
      n.y = round(placed.y);
    }
    const down = this.direction === 'down';
    const reach: Vec2[] = [];
    for (const n of list) reach.push([n.x - n.w / 2, n.y - n.h / 2], [n.x + n.w / 2, n.y + n.h / 2]);
    // Edges that loop round the side keep clear of every node in the layers they span.
    let sideCount = 0;
    const drawn = this.edges.map((e, i) => {
      const routed = layout.edges[i]!;
      let result: Drawn;
      switch (routed.kind) {
        case 'forward':
          result = this.forward(e, routed.via, down);
          break;
        case 'self':
          result = this.selfLoop(e, down);
          break;
        case 'same':
          result = this.sameLayer(e, down);
          break;
        case 'back':
          result = this.backLoop(e, layout, down, sideCount++);
          break;
      }
      reach.push(...result.reach);
      if (result.label && e.label) {
        const width = e.label.length * 6.4;
        const [lx, ly] = result.label;
        const left = result.anchor === 'start' ? lx : result.anchor === 'end' ? lx - width : lx - width / 2;
        reach.push([left, ly - 12], [left + width, ly + 4]);
      }
      return result;
    });
    // Fit and centre the whole diagram in the view box.
    const [vx, vy, vw, vh] = this.stage.viewBox;
    const minX = Math.min(...reach.map((p) => p[0]));
    const maxX = Math.max(...reach.map((p) => p[0]));
    const minY = Math.min(...reach.map((p) => p[1]));
    const maxY = Math.max(...reach.map((p) => p[1]));
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    // Rounded as the transform attribute will be, so centre() reports exactly where nodes are drawn.
    const fit = list.length === 0 ? 1 : Math.min(MAX_SCALE, (vw - 2 * PAD) / width, (vh - 2 * PAD) / height);
    this.scale = Math.max(0.01, Math.floor(fit * 100) / 100);
    this.offset = [round(vx + vw / 2 - this.scale * (minX + width / 2)), round(vy + vh / 2 - this.scale * (minY + height / 2))];
    this.root.at(this.offset[0], this.offset[1]).scale(this.scale);
    for (const n of list) n.group.at(n.x, n.y);
    this.edges.forEach((e, i) => {
      const result = drawn[i]!;
      e.path.d(result.d);
      e.head.d(result.head);
      if (e.text) {
        if (result.label && e.label) e.text.set({ x: result.label[0], y: result.label[1], 'text-anchor': result.anchor }).show();
        else e.text.hide();
      }
    });
  }

  private border(n: NodeRecord, toward: Vec2): Vec2 {
    const [bx, by] = borderPoint(n.shape, n.w, n.h, toward[0] - n.x, toward[1] - n.y);
    return [n.x + bx, n.y + by];
  }

  private forward(e: EdgeRecord, via: readonly Vec2[], down: boolean): Drawn {
    const start = this.border(e.from, via[0] ?? [e.to.x, e.to.y]);
    const end = this.border(e.to, via[via.length - 1] ?? [e.from.x, e.from.y]);
    const points: Vec2[] = [start, ...via, end];
    // The line stops under the arrowhead, whose tip touches the border.
    const last = points[points.length - 2]!;
    const dir: Vec2 = down ? [0, Math.sign(end[1] - last[1]) || 1] : [Math.sign(end[0] - last[0]) || 1, 0];
    const stop: Vec2 = [end[0] - dir[0] * (HEAD - 1), end[1] - dir[1] * (HEAD - 1)];
    const line = [...points.slice(0, -1), stop];
    // The label sits beside the middle of the edge.
    const k = Math.floor((line.length - 1) / 2);
    const p = line[k]!;
    const q = line[k + 1]!;
    const c1: Vec2 = down ? [p[0], p[1] + (q[1] - p[1]) / 2] : [p[0] + (q[0] - p[0]) / 2, p[1]];
    const c2: Vec2 = down ? [q[0], q[1] - (q[1] - p[1]) / 2] : [q[0] - (q[0] - p[0]) / 2, q[1]];
    const mid = bezierPoint(p, c1, c2, q, 0.5);
    return {
      d: curveThrough(line, down),
      head: headPath(end, dir),
      label: down ? [mid[0] + 7, mid[1] + 4] : [mid[0], mid[1] - 7],
      anchor: down ? 'start' : 'middle',
      reach: points,
    };
  }

  /** A loop from a node back to itself, outside its right side (down) or its top (right). */
  private selfLoop(e: EdgeRecord, down: boolean): Drawn {
    const n = e.from;
    const p1 = this.border(n, down ? [n.x + n.w / 2, n.y - n.h * 0.2] : [n.x - n.w * 0.2, n.y - n.h / 2]);
    const p2 = this.border(n, down ? [n.x + n.w / 2, n.y + n.h * 0.2] : [n.x + n.w * 0.2, n.y - n.h / 2]);
    // The loop reaches past the node's outermost point, whatever its shape.
    const c1: Vec2 = down ? [n.x + n.w / 2 + 32, p1[1] - 18] : [p1[0] - 18, n.y - n.h / 2 - 32];
    const c2: Vec2 = down ? [n.x + n.w / 2 + 32, p2[1] + 18] : [p2[0] + 18, n.y - n.h / 2 - 32];
    const dir = unit(p2[0] - c2[0], p2[1] - c2[1]);
    const stop: Vec2 = [p2[0] - dir[0] * (HEAD - 1), p2[1] - dir[1] * (HEAD - 1)];
    const top = bezierPoint(p1, c1, c2, p2, 0.5);
    return {
      d: `M${fmt(p1[0])} ${fmt(p1[1])}C${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(stop[0])} ${fmt(stop[1])}`,
      head: headPath(p2, dir),
      label: down ? [top[0] + 6, top[1] + 4] : [top[0], top[1] - 6],
      anchor: down ? 'start' : 'middle',
      reach: [p1, p2, c1, c2],
    };
  }

  private sameLayer(e: EdgeRecord, down: boolean): Drawn {
    const a = e.from;
    const b = e.to;
    const start = this.border(a, [b.x, b.y]);
    const end = this.border(b, [a.x, a.y]);
    // Neighbours join straight; others bow out past the layer so they miss the nodes between.
    const between = [...this.nodes.values()].some((n) => n !== a && n !== b && (down ? n.y === a.y && (n.x - a.x) * (n.x - b.x) < 0 : n.x === a.x && (n.y - a.y) * (n.y - b.y) < 0));
    const bow = between ? Math.max(a.h, b.h, a.w, b.w) * 0.5 + 36 : 0;
    const c1: Vec2 = down ? [start[0], start[1] + bow] : [start[0] + bow, start[1]];
    const c2: Vec2 = down ? [end[0], end[1] + bow] : [end[0] + bow, end[1]];
    const from = bow > 0 ? (down ? this.border(a, [a.x, a.y + 1]) : this.border(a, [a.x + 1, a.y])) : start;
    const to = bow > 0 ? (down ? this.border(b, [b.x, b.y + 1]) : this.border(b, [b.x + 1, b.y])) : end;
    const k1: Vec2 = bow > 0 ? (down ? [from[0], from[1] + bow] : [from[0] + bow, from[1]]) : c1;
    const k2: Vec2 = bow > 0 ? (down ? [to[0], to[1] + bow] : [to[0] + bow, to[1]]) : c2;
    const dir = bow > 0 ? unit(to[0] - k2[0], to[1] - k2[1]) : unit(to[0] - from[0], to[1] - from[1]);
    const stop: Vec2 = [to[0] - dir[0] * (HEAD - 1), to[1] - dir[1] * (HEAD - 1)];
    const mid = bezierPoint(from, k1, k2, to, 0.5);
    return {
      d: `M${fmt(from[0])} ${fmt(from[1])}C${fmt(k1[0])} ${fmt(k1[1])} ${fmt(k2[0])} ${fmt(k2[1])} ${fmt(stop[0])} ${fmt(stop[1])}`,
      head: headPath(to, dir),
      label: down ? [mid[0], mid[1] + (bow > 0 ? 14 : -6)] : [mid[0] + 6, mid[1] + 4],
      anchor: down ? 'middle' : 'start',
      reach: [from, to, k1, k2],
    };
  }

  /** An edge against the flow loops round the outside of the layers it spans, on the nearer side. */
  private backLoop(e: EdgeRecord, layout: FlowLayout, down: boolean, index: number): Drawn {
    const a = e.from;
    const b = e.to;
    const ra = layout.nodes.get(a.id)!.rank;
    const rb = layout.nodes.get(b.id)!.rank;
    const spanned = [...this.nodes.values()].filter((n) => {
      const r = layout.nodes.get(n.id)!.rank;
      return r >= Math.min(ra, rb) && r <= Math.max(ra, rb);
    });
    // The side where fewer nodes stand beside the two ends.
    const beside = (n: NodeRecord, sign: number) =>
      layout.ranks[layout.nodes.get(n.id)!.rank]!.filter((id) => {
        const m = this.nodes.get(id)!;
        return sign > 0 ? (down ? m.x > n.x : m.y > n.y) : down ? m.x < n.x : m.y < n.y;
      }).length;
    const sign = beside(a, 1) + beside(b, 1) <= beside(a, -1) + beside(b, -1) ? 1 : -1;
    const outer = down
      ? sign > 0
        ? Math.max(...spanned.map((n) => n.x + n.w / 2))
        : Math.min(...spanned.map((n) => n.x - n.w / 2))
      : sign > 0
        ? Math.max(...spanned.map((n) => n.y + n.h / 2))
        : Math.min(...spanned.map((n) => n.y - n.h / 2));
    const reachOut = outer + sign * (26 + index * 14);
    const start = this.border(a, down ? [a.x + sign, a.y] : [a.x, a.y + sign]);
    const end = this.border(b, down ? [b.x + sign, b.y] : [b.x, b.y + sign]);
    const c1: Vec2 = down ? [reachOut, start[1]] : [start[0], reachOut];
    const c2: Vec2 = down ? [reachOut, end[1]] : [end[0], reachOut];
    const dir = unit(end[0] - c2[0], end[1] - c2[1]);
    const stop: Vec2 = [end[0] - dir[0] * (HEAD - 1), end[1] - dir[1] * (HEAD - 1)];
    const mid = bezierPoint(start, c1, c2, end, 0.5);
    return {
      d: `M${fmt(start[0])} ${fmt(start[1])}C${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(stop[0])} ${fmt(stop[1])}`,
      head: headPath(end, dir),
      label: down ? [mid[0] + sign * 6, mid[1] + 4] : [mid[0], mid[1] + (sign > 0 ? 16 : -6)],
      anchor: down ? (sign > 0 ? 'start' : 'end') : 'middle',
      reach: [start, end, c1, c2, mid],
    };
  }

  /** The current node stands out: a heavier outline and a stronger fill. */
  private paintActive(): void {
    for (const n of this.nodes.values()) {
      const on = n.id === this.activeId;
      n.outline.set({ 'stroke-width': on ? 3.5 : 2 });
      n.fill.set({ 'fill-opacity': on ? 0.34 : 0.14 });
    }
  }
}
