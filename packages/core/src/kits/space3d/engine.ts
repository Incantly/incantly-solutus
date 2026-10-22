import type { DragMap, Handle, Mat3, PartOptions, PathHandle, Readable, TextHandle, Tone, Vec2, Vec3, View3D, ViewBox } from '../../api/types';
import { apply, IDENTITY, mul } from '../../helpers/vec';
import type { ViewAction } from '../../protocol/runtime-messages';
import type { KitContext, ViewController } from '../../runtime/kit';
import { SceneApiError } from '../../scene/errors';
import { fmt } from '../../scene/format';
import type { VNode } from '../../scene/graph';
import { formatReadable, nodeOf, TONES } from '../../scene/handles';
import { Camera, VIEW_NAMES, VIEWS, type Projected } from './camera';
import type { Mesh } from './mesh';

/**
 * The 3D engine shared by space3d and graph3d. Every draw it transforms the
 * scene into camera space, culls faces that turn away from the eye (C3-3),
 * lights them from a fixed lamp, sorts everything far to near and writes the
 * result into a fixed pool of path elements in order (C3-4): the DOM order
 * never changes, so a frame is attribute writes only.
 */

export type Look = 'solid' | 'wire' | 'ghost' | 'shadow';

export interface Transform {
  readonly m: Mat3;
  readonly t: Vec3;
}

const IDENTITY_TRANSFORM: Transform = { m: IDENTITY, t: [0, 0, 0] };

/** Elements the face pool may use, leaving room for the rest of the figure. */
const SLOT_CAP = 1600;
/** Segments per depth-sorted piece of a long line, so it can pass in front of and behind things. */
const LINE_CHUNK = 6;
/** The lamp, in camera space: above, left and in front of the viewer. */
const LIGHT: Vec3 = (() => {
  const v: Vec3 = [-0.42, 0.58, 0.7];
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
})();
const ARROW_HEAD = 10;
const MAX_LABELS = 60;

export type Geometry =
  | { readonly type: 'mesh'; mesh: Mesh; segments: number | null; readonly rebuild: ((segments: number) => Mesh) | null }
  | { readonly type: 'sphere'; r: number; segments: number }
  | { readonly type: 'group' }
  | { readonly type: 'line'; points: Vec3[]; arrow: boolean; dashed: boolean; closed: boolean }
  | { readonly type: 'arrow'; from: Vec3; to: Vec3; dashed: boolean }
  | { readonly type: 'point'; r: number }
  | { readonly type: 'custom'; readonly emit: (out: Emitter, item: Item) => void; readonly bounds: (() => Vec3[]) | null };

/** One node of the 3D scene. */
export class Item {
  readonly children: Item[] = [];
  position: Vec3 = [0, 0, 0];
  rotation: Mat3 = IDENTITY;
  scale: Vec3 = [1, 1, 1];
  visible = true;
  look: Look = 'solid';
  bias = 0;
  explode = 0;
  part: string | null = null;
  proxy: VNode | null = null;
  world: Transform = IDENTITY_TRANSFORM;
  /** Set during a draw: visible with its ancestors. */
  shown = true;
  owner: string | null = null;
  /** Runs before each draw, for items that follow a function (graph points and curves). */
  update: (() => void) | null = null;

  constructor(
    readonly geometry: Geometry,
    public tone: Tone | null,
    readonly parent: Item | null,
  ) {
    parent?.children.push(this);
  }
}

/** What custom items (surfaces, grids, field lines) draw with, in world space. */
export interface Emitter {
  face(points: readonly Vec3[], style: FaceStyle): void;
  line(points: readonly Vec3[], style: LineStyle): void;
  point(at: Vec3, style: { readonly tone: Tone | null; readonly r: number; readonly owner?: string | null }): void;
  /** The direction toward the viewer, in world space. */
  readonly toViewer: Vec3;
  /** Draw detail from 0.3 to 1: lowered when drawing is slow. */
  readonly detail: number;
  /** A world point on the stage. */
  project(p: Vec3): Vec2 | null;
}

export interface FaceStyle {
  readonly tone: Tone | null;
  readonly look: Look;
  readonly twoSided?: boolean;
  readonly smooth?: boolean;
  readonly bias?: number;
  readonly owner?: string | null;
  /** Lines that lie on the face, such as contours: drawn just after it, so faces nearer the viewer still cover them (C3-6). */
  readonly overlay?: { readonly lines: readonly (readonly Vec3[])[]; readonly tone: Tone | null };
}

export interface LineStyle {
  readonly tone: Tone | null;
  readonly dashed?: boolean;
  readonly arrow?: boolean;
  readonly bias?: number;
  readonly owner?: string | null;
  /** Arrowheads along the line, every this many segments. */
  readonly arrowsEvery?: number;
}

interface Drawable {
  readonly path: string;
  readonly depth: number;
  readonly tone: Tone | null;
  readonly fill: boolean;
  readonly shade: 'sphere' | null;
  readonly dashed: boolean;
  readonly extra: string;
  readonly owner: string | null;
}

interface Slot {
  readonly handle: PathHandle;
  readonly node: VNode;
}

interface LabelRecord {
  readonly handle: TextHandle;
  readonly node: VNode;
  target: Vec3 | Item;
  /** For a label that rides on a line or arrow: the point now, or null while it is hidden. */
  readonly follow: (() => Vec3 | null) | null;
  text: string;
  tone: Tone | null;
  offset: number;
  visible: boolean;
  /** Where it was placed last, for collision checks. */
  box: { x: number; y: number; w: number; h: number; dx: number; dy: number } | null;
  /** A label in a column beside the figure, joined to its target by a line ending in a dot (S3-9). */
  readonly leader: { readonly line: Handle; readonly dot: Handle } | null;
}

/** Room between a column of labels and the figure, and between labels in it. */
const LEADER_GAP = 22;
const LEADER_ROW = 18;

interface Grab {
  readonly item: Item;
  readonly handle: Handle;
  readonly node: VNode;
}

export interface EngineOptions {
  readonly camera?: import('../../api/types').CameraOptions;
  readonly mode: 'orbit' | 'iso' | 'fixed';
  readonly budget: number;
  readonly zoom: boolean;
}

export function isTone(value: unknown): value is Tone {
  return typeof value === 'string' && TONES.has(value);
}

export function toneOf(value: unknown, fallback: Tone | null): Tone | null {
  if (value === undefined) return fallback;
  if (!isTone(value)) throw new SceneApiError(`Unknown tone "${String(value)}"`);
  return value;
}

export function transformPoint(tr: Transform, p: Vec3): Vec3 {
  const q = apply(tr.m, p);
  return [q[0] + tr.t[0], q[1] + tr.t[1], q[2] + tr.t[2]];
}

/** The rotation for degrees about x, then y, then z. */
export function euler(rx: number, ry: number, rz: number): Mat3 {
  const r = (d: number) => (d * Math.PI) / 180;
  const cx = Math.cos(r(rx));
  const sx = Math.sin(r(rx));
  const cy = Math.cos(r(ry));
  const sy = Math.sin(r(ry));
  const cz = Math.cos(r(rz));
  const sz = Math.sin(r(rz));
  const X: Mat3 = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const Y: Mat3 = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Z: Mat3 = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return mul(Z, mul(Y, X));
}

function local(item: Item, explodeFrom: Vec3 | null, amount: number): Transform {
  const [sx, sy, sz] = item.scale;
  const r = item.rotation;
  const m: Mat3 = [r[0] * sx, r[1] * sy, r[2] * sz, r[3] * sx, r[4] * sy, r[5] * sz, r[6] * sx, r[7] * sy, r[8] * sz];
  let t = item.position;
  if (explodeFrom && amount !== 0) {
    t = [explodeFrom[0] + (t[0] - explodeFrom[0]) * (1 + amount), explodeFrom[1] + (t[1] - explodeFrom[1]) * (1 + amount), explodeFrom[2] + (t[2] - explodeFrom[2]) * (1 + amount)];
  }
  return { m, t };
}

function compose(parent: Transform, child: Transform): Transform {
  return { m: mul(parent.m, child.m), t: transformPoint(parent, child.t) };
}

/** The largest stretch a transform gives, for radii. */
function stretch(m: Mat3): number {
  return Math.max(Math.hypot(m[0], m[3], m[6]), Math.hypot(m[1], m[4], m[7]), Math.hypot(m[2], m[5], m[8]));
}

/**
 * Points that bound what an item holds, in its own frame, leaving out hidden
 * items: for sizing a model to its largest side (S3-9).
 */
export function extentWithin(item: Item): Vec3[] {
  const out: Vec3[] = [];
  const visit = (at: Item, tr: Transform) => {
    if (!at.visible) return;
    const g = at.geometry;
    const own: readonly Vec3[] =
      g.type === 'mesh'
        ? g.mesh.vertices
        : g.type === 'sphere'
          ? [
              [g.r, 0, 0],
              [-g.r, 0, 0],
              [0, g.r, 0],
              [0, -g.r, 0],
              [0, 0, g.r],
              [0, 0, -g.r],
            ]
          : g.type === 'line'
            ? g.points
            : g.type === 'arrow'
              ? [g.from, g.to]
              : g.type === 'point'
                ? [[0, 0, 0]]
                : g.type === 'custom' && g.bounds
                  ? g.bounds()
                  : [];
    for (const p of own) out.push(transformPoint(tr, p));
    for (const child of at.children) visit(child, compose(tr, local(child, null, 0)));
  };
  visit(item, IDENTITY_TRANSFORM);
  return out;
}

function centreOf(children: readonly Item[]): Vec3 {
  if (children.length === 0) return [0, 0, 0];
  const sum = children.reduce<Vec3>((s, c) => [s[0] + c.position[0], s[1] + c.position[1], s[2] + c.position[2]], [0, 0, 0]);
  return [sum[0] / children.length, sum[1] / children.length, sum[2] / children.length];
}

export class Engine3D implements ViewController {
  readonly camera: Camera;
  readonly root = new Item({ type: 'group' }, null, null);
  readonly orbit: boolean;
  readonly views: readonly string[];
  private readonly slots: Slot[] = [];
  private readonly slotGroup: Handle;
  private readonly labels: LabelRecord[] = [];
  private readonly grabs: Grab[] = [];
  private drawn = false;
  private budgetChecked = false;
  private warnedCap = false;
  private warnedSlow = false;
  private poolFull = false;
  private cost = 0;
  /** The size of what is drawn, for splitting long lines so they sort with what they pass. */
  private radius = 1;
  /** More than one thing is drawn, so large faces must be split to sort against the others. */
  private crowded = false;
  detail = 1;

  constructor(
    readonly ctx: KitContext,
    readonly viewBox: ViewBox,
    readonly options: EngineOptions,
  ) {
    this.camera = new Camera(viewBox, options.camera, options.mode);
    this.orbit = options.mode === 'orbit';
    this.views = options.mode === 'orbit' ? VIEW_NAMES : [];
    this.slotGroup = ctx.stage.group();
    ctx.restyle(nodeOf(this.slotGroup), { extra: 'inc-slots' });
    ctx.onRedraw(() => this.draw());
    ctx.setView(this);
  }

  // -------------------------------------------------------------------------
  // The view (C3-5: orbit by drag is the renderer's, shared by every 3D figure)
  // -------------------------------------------------------------------------

  apply(action: ViewAction): boolean {
    switch (action.kind) {
      case 'orbit':
        return this.camera.orbit(action.dx, action.dy);
      case 'zoom':
        return this.options.zoom && this.camera.zoom(action.x, action.y, action.factor);
      case 'pan':
        return this.options.zoom && this.camera.pan(action.dx, action.dy);
      case 'reset':
        this.camera.reset();
        return true;
      case 'fit': {
        const { centre, radius } = this.bounds();
        this.radius = radius;
        this.camera.fit(centre, this.room(radius));
        return true;
      }
      case 'preset':
        if (!Object.hasOwn(VIEWS, action.name) || this.options.mode !== 'orbit') return false;
        this.camera.view(action.name as View3D);
        return true;
      default:
        return false;
    }
  }

  changed(): boolean {
    return this.camera.changed();
  }

  mode(): 'runtime' {
    return 'runtime';
  }

  // -------------------------------------------------------------------------
  // Building
  // -------------------------------------------------------------------------

  /** Before the first draw, a fit to what exists so far, so project() and screen() mean something at mount. */
  private provisional(): void {
    if (this.drawn) return;
    this.updateWorld(this.root, IDENTITY_TRANSFORM, true, null);
    const { centre, radius } = this.bounds();
    this.camera.fit(centre, this.room(radius));
  }

  /** The radius the view is fitted to: wider when labels stand in columns beside the figure, so they have room. */
  private room(radius: number): number {
    return this.labels.some((label) => label.leader) ? radius * 1.25 : radius;
  }

  projectWorld(p: Vec3): Vec2 {
    this.provisional();
    const q = this.camera.project(this.camera.toCamera(p));
    return [q.x, q.y];
  }

  pick(x: number, y: number, z: number): Vec3 | null {
    this.provisional();
    return this.camera.pick(x, y, z);
  }

  /** Where an item's centre is drawn. */
  screenOf(item: Item): Vec2 {
    this.provisional();
    const chain: Item[] = [];
    for (let at: Item | null = item; at; at = at.parent) chain.unshift(at);
    item.update?.();
    let world = IDENTITY_TRANSFORM;
    for (let i = 1; i < chain.length; i++) {
      const parent = chain[i - 1]!;
      const child = chain[i]!;
      world = compose(world, local(child, parent.explode !== 0 ? centreOf(parent.children) : null, parent.explode));
    }
    const centre = this.centreOf(item, world);
    const q = this.camera.project(this.camera.toCamera(centre));
    return [q.x, q.y];
  }

  /** A part proxy: an empty element the part registry and the legend hold; the faces name it as their owner. */
  part(item: Item, name: string, options: PartOptions | undefined): void {
    if (item.part !== null) throw new SceneApiError(`That object is already the part "${item.part}"`);
    const proxy = this.ctx.stage.group();
    this.ctx.stage.part(name, proxy, options);
    item.part = name;
    item.proxy = nodeOf(proxy);
    if (item.tone) proxy.tone(item.tone);
  }

  /** Keeps a part's legend colour in step with its object. */
  retone(item: Item): void {
    if (item.proxy && item.tone) this.ctx.restyle(item.proxy, { tone: item.tone });
  }

  drag(item: Item, map: DragMap, label: string | undefined): void {
    if (typeof map !== 'function') throw new SceneApiError('drag needs a function that turns the pointer into parameter values');
    const known = this.grabs.find((g) => g.item === item);
    if (known) {
      // Dragged already: the later map wins.
      this.ctx.addDrag(known.node, String(label ?? item.part ?? 'the object').slice(0, 60), map);
      return;
    }
    const handle = this.ctx.stage.circle(0, 0, 14, { layer: 'front' });
    const node = nodeOf(handle);
    this.ctx.restyle(node, { extra: 'inc-grab' });
    this.ctx.addDrag(node, String(label ?? item.part ?? 'the object').slice(0, 60), map);
    this.grabs.push({ item, handle, node });
  }

  label(target: Vec3 | Item, text: Readable, tone: Tone | null, offset: number, follow: (() => Vec3 | null) | null = null, leader = false): LabelRecord {
    if (this.labels.length >= MAX_LABELS) throw new SceneApiError(`A 3D figure has at most ${MAX_LABELS} labels`);
    const handle = this.ctx.stage.text(0, 0, '', { layer: 'labels', ...(tone ? { tone } : {}) });
    const lines = leader
      ? { line: this.ctx.stage.line(0, 0, 0, 0, { layer: 'labels', tone: tone ?? 'mid' }), dot: this.ctx.stage.circle(0, 0, 2.5, { layer: 'labels', tone: tone ?? 'mid' }) }
      : null;
    const record: LabelRecord = { handle, node: nodeOf(handle), target, follow, text: formatReadable(text), tone, offset, visible: true, box: null, leader: lines };
    handle.set({ 'dominant-baseline': 'middle' });
    this.labels.push(record);
    return record;
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  private updateWorld(item: Item, world: Transform, shown: boolean, owner: string | null): void {
    item.world = world;
    item.shown = shown && item.visible && !(item.proxy?.hidden ?? false);
    item.owner = item.part ?? owner;
    for (const child of item.children) if (child.update && child.visible) child.update();
    const from = item.explode !== 0 ? centreOf(item.children) : null;
    for (const child of item.children) this.updateWorld(child, compose(world, local(child, from, item.explode)), item.shown, item.owner);
  }

  private centreOf(item: Item, world: Transform): Vec3 {
    const g = item.geometry;
    if (g.type === 'line' && g.points.length > 0) {
      const sum = g.points.reduce<Vec3>((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]);
      return transformPoint(world, [sum[0] / g.points.length, sum[1] / g.points.length, sum[2] / g.points.length]);
    }
    if (g.type === 'arrow') return transformPoint(world, [(g.from[0] + g.to[0]) / 2, (g.from[1] + g.to[1]) / 2, (g.from[2] + g.to[2]) / 2]);
    return transformPoint(world, [0, 0, 0]);
  }

  /** World-space points that bound an item, for fitting the view. */
  private extent(item: Item, out: Vec3[]): void {
    if (!item.shown) return;
    const g = item.geometry;
    const w = item.world;
    switch (g.type) {
      case 'mesh':
        for (const v of g.mesh.vertices) out.push(transformPoint(w, v));
        break;
      case 'sphere': {
        const c = transformPoint(w, [0, 0, 0]);
        const r = g.r * stretch(w.m);
        out.push([c[0] - r, c[1] - r, c[2] - r], [c[0] + r, c[1] + r, c[2] + r]);
        break;
      }
      case 'line':
        for (const p of g.points) out.push(transformPoint(w, p));
        break;
      case 'arrow':
        out.push(transformPoint(w, g.from), transformPoint(w, g.to));
        break;
      case 'point':
        out.push(transformPoint(w, [0, 0, 0]));
        break;
      case 'custom':
        if (g.bounds) for (const p of g.bounds()) out.push(transformPoint(w, p));
        break;
      case 'group':
        break;
    }
    for (const child of item.children) this.extent(child, out);
  }

  bounds(): { centre: Vec3; radius: number } {
    const points: Vec3[] = [];
    this.extent(this.root, points);
    if (points.length === 0) return { centre: [0, 0, 0], radius: 1 };
    const lo: [number, number, number] = [Infinity, Infinity, Infinity];
    const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const p of points) {
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i]!, p[i]!);
        hi[i] = Math.max(hi[i]!, p[i]!);
      }
    }
    const centre: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    const radius = points.reduce((r, p) => Math.max(r, Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2])), 0);
    return { centre, radius: radius > 1e-9 ? radius : 1 };
  }

  /** S3-10: above the face budget, round solids get fewer facets, and the figure says so once. */
  private checkBudget(): void {
    if (this.budgetChecked) return;
    this.budgetChecked = true;
    const items: Item[] = [];
    const walk = (item: Item) => {
      items.push(item);
      item.children.forEach(walk);
    };
    walk(this.root);
    const count = () => items.reduce((n, item) => n + (item.geometry.type === 'mesh' ? item.geometry.mesh.faces.length : 0), 0);
    const before = count();
    if (before <= this.options.budget) return;
    let total = before;
    for (let round = 0; round < 4 && total > this.options.budget; round++) {
      let changed = false;
      for (const item of items) {
        const g = item.geometry;
        if (g.type === 'mesh' && g.rebuild && g.segments !== null && g.segments > 8) {
          g.segments = Math.max(8, Math.floor(g.segments * 0.6));
          g.mesh = g.rebuild(g.segments);
          changed = true;
        }
      }
      if (!changed) break;
      total = count();
    }
    this.ctx.warn(
      total > this.options.budget
        ? `This 3D scene has ${total} faces, more than its budget of ${this.options.budget}, so it may draw slowly`
        : `This 3D scene had ${before} faces, more than its budget of ${this.options.budget}, so round solids are drawn with fewer facets`,
    );
  }

  draw(): void {
    const started = this.ctx.now();
    this.updateWorld(this.root, IDENTITY_TRANSFORM, true, null);
    if (!this.drawn) {
      this.checkBudget();
      const { centre, radius } = this.bounds();
      this.radius = radius;
      this.camera.settle(centre, this.room(radius));
      this.drawn = true;
    }
    const out: Drawable[] = [];
    const emitter = this.emitter(out);
    let things = 0;
    const count = (item: Item) => {
      if (!item.shown) return;
      if (item.geometry.type !== 'group') things++;
      item.children.forEach(count);
    };
    count(this.root);
    this.crowded = things > 1;
    const visit = (item: Item) => {
      if (!item.shown) return;
      this.emitItem(item, out, emitter);
      item.children.forEach(visit);
    };
    visit(this.root);
    // Painter's order: far to near. Ties keep the order things were made in.
    out.sort((a, b) => a.depth - b.depth);
    let drawables = out;
    if (out.length > SLOT_CAP) {
      drawables = out.slice(out.length - SLOT_CAP);
      if (!this.warnedCap) {
        this.warnedCap = true;
        this.ctx.warn(`This 3D scene drew ${out.length} pieces at once; only the nearest ${SLOT_CAP} are shown`);
      }
    }
    this.write(drawables);
    this.placeLabels();
    this.placeGrabs();
    this.measure(this.ctx.now() - started);
  }

  /** G3-7: slow drawing lowers the detail of surfaces. */
  private measure(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.cost = this.cost === 0 ? ms : this.cost * 0.8 + ms * 0.2;
    if (this.cost > 14 && this.detail > 0.35) {
      this.detail = Math.max(0.3, this.detail * 0.8);
      this.cost = 0;
      if (!this.warnedSlow) {
        this.warnedSlow = true;
        this.ctx.warn('Drawing this 3D figure was slow, so its surfaces now use fewer samples');
      }
    }
  }

  /** Made for each draw, when the camera and detail are settled. */
  private emitter(out: Drawable[]): Emitter {
    return {
      face: (points, style) => this.face(points, style, out),
      line: (points, style) => this.line(points, style, out),
      point: (at, style) => this.point(at, style.r, style.tone, style.owner ?? null, out),
      toViewer: this.camera.toViewer,
      detail: this.detail,
      project: (p) => {
        const c = this.camera.toCamera(p);
        if (!this.camera.visible(c[2])) return null;
        const q = this.camera.project(c);
        return [q.x, q.y];
      },
    };
  }

  private emitItem(item: Item, out: Drawable[], emitter: Emitter): void {
    const g = item.geometry;
    const w = item.world;
    switch (g.type) {
      case 'mesh':
        this.mesh(item, g.mesh, out);
        return;
      case 'sphere':
        this.sphere(item, g.r, g.segments, out);
        return;
      case 'line':
        this.line(
          g.points.map((p) => transformPoint(w, p)),
          { tone: item.tone, dashed: g.dashed, arrow: g.arrow, bias: item.bias, owner: item.owner },
          out,
          g.closed,
        );
        return;
      case 'arrow':
        this.line([transformPoint(w, g.from), transformPoint(w, g.to)], { tone: item.tone, dashed: g.dashed, arrow: true, bias: item.bias, owner: item.owner }, out);
        return;
      case 'point':
        this.point(transformPoint(w, [0, 0, 0]), g.r, item.tone, item.owner, out, item.bias);
        return;
      case 'custom':
        g.emit(
          {
            ...emitter,
            face: (points, style) =>
              this.face(
                points.map((p) => transformPoint(w, p)),
                {
                  ...style,
                  owner: style.owner ?? item.owner,
                  bias: (style.bias ?? 0) + item.bias,
                  ...(style.overlay ? { overlay: { tone: style.overlay.tone, lines: style.overlay.lines.map((line) => line.map((p) => transformPoint(w, p))) } } : {}),
                },
                out,
              ),
            line: (points, style) => this.line(points.map((p) => transformPoint(w, p)), { ...style, owner: style.owner ?? item.owner, bias: (style.bias ?? 0) + item.bias }, out),
            point: (at, style) => this.point(transformPoint(w, at), style.r, style.tone, style.owner ?? item.owner, out, item.bias),
            toViewer: emitter.toViewer,
            detail: emitter.detail,
            project: emitter.project,
          },
          item,
        );
        return;
      case 'group':
        return;
    }
  }

  private mesh(item: Item, mesh: Mesh, out: Drawable[]): void {
    const cam = mesh.vertices.map((v) => this.camera.toCamera(transformPoint(item.world, v)));
    if (!cam.every((c) => this.camera.visible(c[2]))) return;
    const screen = cam.map((c) => this.camera.project(c));
    if (item.look === 'wire') {
      let d = '';
      for (const [a, b] of mesh.edges) d += `M${fmt(screen[a]!.x)} ${fmt(screen[a]!.y)}L${fmt(screen[b]!.x)} ${fmt(screen[b]!.y)}`;
      const depth = cam.reduce((s, c) => s + c[2], 0) / cam.length + item.bias;
      out.push({ path: d, depth, tone: item.tone, fill: false, shade: null, dashed: false, extra: 'inc-face inc-wire', owner: item.owner });
      return;
    }
    // See-through looks are seen from both sides.
    const ghost = item.look === 'ghost' || item.look === 'shadow';
    for (const face of mesh.faces) {
      this.polygon(
        face.map((i) => cam[i]!),
        face.map((i) => screen[i]!),
        { tone: item.tone, look: item.look, twoSided: mesh.twoSided || ghost, smooth: mesh.smooth, bias: item.bias, owner: item.owner },
        out,
      );
    }
  }

  private face(points: readonly Vec3[], style: FaceStyle, out: Drawable[]): void {
    if (points.length < 3) return;
    const cam = points.map((p) => this.camera.toCamera(p));
    if (!cam.every((c) => this.camera.visible(c[2]) && Number.isFinite(c[0] + c[1] + c[2]))) return;
    this.polygon(
      cam,
      cam.map((c) => this.camera.project(c)),
      style,
      out,
    );
  }

  /**
   * One polygon: culled against the eye, lit, and added at its depth. A face
   * that is large next to the scene is drawn as smaller pieces, each sorted
   * on its own, so a floor or a wall does not cover what stands behind its middle.
   */
  private polygon(cam: readonly Vec3[], screen: readonly Projected[], style: FaceStyle, out: Drawable[], whole = false): void {
    if (!whole && this.crowded && !style.overlay && cam.length <= 8) {
      let size = 0;
      for (let i = 0; i < cam.length; i++) {
        const a = cam[i]!;
        const b = cam[(i + 1) % cam.length]!;
        size = Math.max(size, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
      }
      const limit = this.radius / 3;
      if (size > limit) {
        const pieceStyle: FaceStyle = { ...style, smooth: true };
        for (const piece of split(cam, limit)) this.polygon(piece, piece.map((c) => this.camera.project(c)), pieceStyle, out, true);
        return;
      }
    }
    // Newell's normal, pointing out of a counter-clockwise face.
    let nx = 0;
    let ny = 0;
    let nz = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < cam.length; i++) {
      const a = cam[i]!;
      const b = cam[(i + 1) % cam.length]!;
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
      cx += a[0];
      cy += a[1];
      cz += a[2];
    }
    const n = Math.hypot(nx, ny, nz);
    if (n < 1e-12) return;
    cx /= cam.length;
    cy /= cam.length;
    cz /= cam.length;
    const distance = this.camera.state.distance;
    // Toward the eye from the face (C3-3): the eye sits at z = distance, or at infinity without perspective.
    const facing = distance > 0 ? nx * -cx + ny * -cy + nz * (distance - cz) : nz;
    // Edge-on faces are lines, whichever side rounding puts them on.
    const edgeOn = 1e-9 * n * (distance > 0 ? Math.hypot(cx, cy, distance - cz) : 1);
    if (Math.abs(facing) <= edgeOn) return;
    let sign = 1;
    if (facing < 0) {
      if (!style.twoSided) return;
      sign = -1;
    }
    const lit = (sign * (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2])) / n;
    const level = Math.max(0, Math.min(6, Math.round(3 + 3.2 * lit)));
    let d = `M${fmt(screen[0]!.x)} ${fmt(screen[0]!.y)}`;
    for (let i = 1; i < screen.length; i++) d += `L${fmt(screen[i]!.x)} ${fmt(screen[i]!.y)}`;
    d += 'Z';
    const extra =
      style.look === 'wire'
        ? 'inc-face inc-wire'
        : style.look === 'shadow'
          ? 'inc-face inc-shadow'
          : `inc-face inc-lum-${level}${style.look === 'ghost' ? ' inc-glass' : ''}${style.smooth ? (style.look === 'ghost' ? ' inc-tile' : ' inc-smooth') : ''}`;
    const depth = cz + (style.bias ?? 0);
    out.push({ path: d, depth, tone: style.tone, fill: false, shade: null, dashed: false, extra, owner: style.owner ?? null });
    if (style.overlay) {
      // Just in front of their face and behind anything nearer: lines on a surface hide where it folds over them.
      style.overlay.lines.forEach((line, i) => {
        let path = '';
        for (const p of line) {
          const c = this.camera.toCamera(p);
          if (!this.camera.visible(c[2])) return;
          const q = this.camera.project(c);
          path += `${path ? 'L' : 'M'}${fmt(q.x)} ${fmt(q.y)}`;
        }
        if (line.length >= 2) out.push({ path, depth: depth + 1e-7 * (i + 1), tone: style.overlay!.tone, fill: false, shade: null, dashed: false, extra: 'inc-on-face', owner: style.owner ?? null });
      });
    }
  }

  private sphere(item: Item, r: number, segments: number, out: Drawable[]): void {
    const centre = transformPoint(item.world, [0, 0, 0]);
    const c = this.camera.toCamera(centre);
    if (!this.camera.visible(c[2])) return;
    const q = this.camera.project(c);
    const radius = r * stretch(item.world.m) * this.camera.state.scale * q.k;
    if (!(radius > 0.05)) return;
    if (item.look === 'wire') {
      // Three great circles, turning with the sphere.
      let d = '';
      const n = Math.max(16, segments);
      for (const axis of [0, 1, 2]) {
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * 2 * Math.PI;
          const local: Vec3 = axis === 0 ? [0, r * Math.cos(a), r * Math.sin(a)] : axis === 1 ? [r * Math.cos(a), 0, r * Math.sin(a)] : [r * Math.cos(a), r * Math.sin(a), 0];
          const p = this.camera.project(this.camera.toCamera(transformPoint(item.world, local)));
          d += `${i === 0 ? 'M' : 'L'}${fmt(p.x)} ${fmt(p.y)}`;
        }
      }
      out.push({ path: d, depth: c[2] + item.bias, tone: item.tone, fill: false, shade: null, dashed: false, extra: 'inc-face inc-wire', owner: item.owner });
      return;
    }
    const d = `M${fmt(q.x - radius)} ${fmt(q.y)}a${fmt(radius)} ${fmt(radius)} 0 1 0 ${fmt(2 * radius)} 0a${fmt(radius)} ${fmt(radius)} 0 1 0 ${fmt(-2 * radius)} 0Z`;
    const ghost = item.look === 'ghost';
    const shadow = item.look === 'shadow';
    out.push({
      path: d,
      depth: c[2] + item.bias,
      tone: item.tone,
      fill: !ghost && !shadow,
      shade: ghost || shadow ? null : 'sphere',
      dashed: false,
      extra: ghost ? 'inc-face inc-lum-4 inc-glass' : shadow ? 'inc-face inc-shadow' : '',
      owner: item.owner,
    });
  }

  private line(points: readonly Vec3[], style: LineStyle, out: Drawable[], closed = false): void {
    if (points.length < 2) return;
    const given = closed ? [...points, points[0]!] : points;
    // Long segments are split, so each piece sorts with what it passes in front of or behind.
    const piece = this.radius / 5;
    const list: Vec3[] = [given[0]!];
    for (let i = 1; i < given.length; i++) {
      const a = given[i - 1]!;
      const b = given[i]!;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const parts = Number.isFinite(length) && length > piece ? Math.min(64, Math.ceil(length / piece)) : 1;
      for (let j = 1; j < parts; j++) list.push([a[0] + ((b[0] - a[0]) * j) / parts, a[1] + ((b[1] - a[1]) * j) / parts, a[2] + ((b[2] - a[2]) * j) / parts]);
      list.push(b);
    }
    const cam = list.map((p) => this.camera.toCamera(p));
    const screen = cam.map((c) => (this.camera.visible(c[2]) && Number.isFinite(c[0] + c[1] + c[2]) ? this.camera.project(c) : null));
    const bias = style.bias ?? 0;
    const last = list.length - 1;
    // The head is drawn in screen space at the end (C3-11).
    let head: { path: string; base: Vec2 } | null = null;
    if (style.arrow && screen[last] && screen[last - 1]) head = this.head(screen[last - 1]!, screen[last]!);
    let start = 0;
    while (start < last) {
      // A piece ends after LINE_CHUNK segments or once it is long.
      let end = start;
      let length = 0;
      while (end < last && end - start < LINE_CHUNK && length < piece) {
        const a = list[end]!;
        const b = list[end + 1]!;
        length += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        end++;
      }
      let d = '';
      let pen = false;
      let depth = 0;
      let counted = 0;
      for (let i = start; i <= end; i++) {
        let p = screen[i];
        if (!p) {
          pen = false;
          continue;
        }
        if (i === last && head) p = { x: head.base[0], y: head.base[1], k: p.k };
        d += `${pen ? 'L' : 'M'}${fmt(p.x)} ${fmt(p.y)}`;
        pen = true;
        depth += cam[i]![2];
        counted++;
      }
      if (counted >= 2) {
        out.push({ path: d, depth: depth / counted + bias, tone: style.tone, fill: false, shade: null, dashed: style.dashed ?? false, extra: '', owner: style.owner ?? null });
      }
      start = end;
    }
    if (head) {
      out.push({ path: head.path, depth: cam[last]![2] + bias + 1e-4, tone: style.tone, fill: true, shade: null, dashed: false, extra: '', owner: style.owner ?? null });
    }
    if (style.arrowsEvery && style.arrowsEvery > 1) {
      for (let i = style.arrowsEvery; i < last; i += style.arrowsEvery) {
        const a = screen[i - 1];
        const b = screen[i];
        if (!a || !b) continue;
        const mid = this.head(a, b, 7);
        if (mid) out.push({ path: mid.path, depth: cam[i]![2] + bias + 1e-4, tone: style.tone, fill: true, shade: null, dashed: false, extra: '', owner: style.owner ?? null });
      }
    }
  }

  /** A filled arrowhead at `to`, pointing away from `from`, in stage units. */
  private head(from: Projected, to: Projected, size = ARROW_HEAD): { path: string; base: Vec2 } | null {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) return null;
    const h = Math.min(size, length * 0.6);
    const ux = dx / length;
    const uy = dy / length;
    const bx = to.x - ux * h;
    const by = to.y - uy * h;
    const w = h * 0.45;
    return {
      path: `M${fmt(to.x)} ${fmt(to.y)}L${fmt(bx - uy * w)} ${fmt(by + ux * w)}L${fmt(bx + uy * w)} ${fmt(by - ux * w)}Z`,
      base: [bx, by],
    };
  }

  private point(at: Vec3, r: number, tone: Tone | null, owner: string | null, out: Drawable[], bias = 0): void {
    const c = this.camera.toCamera(at);
    if (!this.camera.visible(c[2]) || !Number.isFinite(c[0] + c[1] + c[2])) return;
    const q = this.camera.project(c);
    const d = `M${fmt(q.x - r)} ${fmt(q.y)}a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(2 * r)} 0a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(-2 * r)} 0Z`;
    out.push({ path: d, depth: c[2] + bias + 2e-3, tone, fill: true, shade: null, dashed: false, extra: '', owner });
  }

  // -------------------------------------------------------------------------
  // Writing into the fixed slots
  // -------------------------------------------------------------------------

  private slot(index: number): Slot | null {
    while (this.slots.length <= index) {
      if (this.poolFull) return null;
      try {
        const handle = this.ctx.stage.path(undefined, { parent: this.slotGroup });
        this.slots.push({ handle, node: nodeOf(handle) });
      } catch (error) {
        // The figure's element limit: draw what fits and say so once.
        this.poolFull = true;
        this.ctx.warn(error instanceof Error ? `3D drawing stopped growing: ${error.message}` : '3D drawing stopped growing');
        return null;
      }
    }
    return this.slots[index]!;
  }

  private write(drawables: readonly Drawable[]): void {
    let used = 0;
    for (let i = 0; i < drawables.length; i++) {
      const slot = this.slot(i);
      if (!slot) break;
      const d = drawables[i]!;
      slot.handle.d(d.path);
      this.ctx.restyle(slot.node, { hidden: false, tone: d.tone, fill: d.fill, shade: d.shade, dashed: d.dashed, extra: d.extra });
      this.ctx.setOwner(slot.node, d.owner);
      used = i + 1;
    }
    for (let i = used; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      this.ctx.restyle(slot.node, { hidden: true });
      this.ctx.setOwner(slot.node, null);
    }
  }

  // -------------------------------------------------------------------------
  // Labels pushed outward (C3-13) and drag handles
  // -------------------------------------------------------------------------

  private anchorOf(target: Vec3 | Item): { at: Vec2; radius: number } | null {
    if (target instanceof Item) {
      if (!target.shown) return null;
      const centre = this.centreOf(target, target.world);
      const c = this.camera.toCamera(centre);
      if (!this.camera.visible(c[2])) return null;
      const q = this.camera.project(c);
      const g = target.geometry;
      const r =
        g.type === 'sphere'
          ? g.r * stretch(target.world.m)
          : g.type === 'mesh'
            ? g.mesh.radius * stretch(target.world.m) * 0.75
            : g.type === 'group'
              ? // A group, such as a model: as far as what it holds reaches from its origin.
                extentWithin(target).reduce((m, p) => Math.max(m, Math.hypot(p[0], p[1], p[2])), 0) * stretch(target.world.m)
              : 0;
      return { at: [q.x, q.y], radius: r * this.camera.state.scale * q.k };
    }
    const c = this.camera.toCamera(target);
    if (!this.camera.visible(c[2])) return null;
    const q = this.camera.project(c);
    return { at: [q.x, q.y], radius: 0 };
  }

  /** Where a leader meets its target: the middle of what the target draws, on the stage. */
  private leaderAnchor(target: Vec3 | Item): Vec2 | null {
    let centre: Vec3;
    if (target instanceof Item) {
      if (!target.shown) return null;
      const points: Vec3[] = [];
      this.extent(target, points);
      if (points.length === 0) return null;
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (const p of points) {
        for (let i = 0; i < 3; i++) {
          lo[i] = Math.min(lo[i]!, p[i]!);
          hi[i] = Math.max(hi[i]!, p[i]!);
        }
      }
      centre = [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2];
    } else centre = target;
    const c = this.camera.toCamera(centre);
    if (!this.camera.visible(c[2])) return null;
    const q = this.camera.project(c);
    return [q.x, q.y];
  }

  /**
   * Labels with leaders (a model's pieces, S3-9) stand in a column beside the
   * thing they belong to, on the side their piece leans to when there is
   * room, in the order of their pieces from top to bottom, each joined to its
   * piece by a line.
   */
  private placeLeaders(placed: NonNullable<LabelRecord['box']>[]): void {
    type Row = { label: LabelRecord; at: Vec2; w: number };
    // Each label goes beside the top-level object that holds its target, such as its model.
    const groups = new Map<Item, Row[]>();
    for (const label of this.labels) {
      if (!label.leader) continue;
      const at = label.visible && label.text !== '' ? this.leaderAnchor(label.target) : null;
      if (!at) {
        label.handle.hide();
        label.leader.line.hide();
        label.leader.dot.hide();
        label.box = null;
        continue;
      }
      let owner = label.target instanceof Item ? label.target : this.root;
      while (owner.parent && owner.parent !== this.root) owner = owner.parent;
      const rows = groups.get(owner) ?? [];
      rows.push({ label, at, w: label.text.length * 7.4 + 4 });
      groups.set(owner, rows);
    }
    for (const [owner, rows] of groups) this.placeColumns(owner, rows, placed);
  }

  private placeColumns(owner: Item, rows: { label: LabelRecord; at: Vec2; w: number }[], placed: NonNullable<LabelRecord['box']>[]): void {
    let minX = Infinity;
    let maxX = -Infinity;
    const points: Vec3[] = [];
    this.extent(owner, points);
    for (const p of points) {
      const c = this.camera.toCamera(p);
      if (!this.camera.visible(c[2])) continue;
      const q = this.camera.project(c);
      minX = Math.min(minX, q.x);
      maxX = Math.max(maxX, q.x);
    }
    if (!Number.isFinite(minX)) return;
    const [vx, vy, vw, vh] = this.viewBox;
    const middle = (minX + maxX) / 2;
    const columns: Record<'left' | 'right', typeof rows> = { left: [], right: [] };
    for (const row of rows) {
      const fits = { left: minX - LEADER_GAP - row.w >= vx, right: maxX + LEADER_GAP + row.w <= vx + vw };
      let side: 'left' | 'right' = row.at[0] < middle - 0.15 * (maxX - minX) ? 'left' : 'right';
      if (!fits[side] && fits[side === 'left' ? 'right' : 'left']) side = side === 'left' ? 'right' : 'left';
      columns[side].push(row);
    }
    for (const side of ['left', 'right'] as const) {
      const column = columns[side].sort((a, b) => a.at[1] - b.at[1]);
      const ys = column.map((row) => row.at[1]);
      for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i]!, ys[i - 1]! + LEADER_ROW);
      // A column that runs off the bottom moves up as a whole, as far as the top allows.
      const over = ys.length > 0 ? ys[ys.length - 1]! - (vy + vh - LEADER_ROW / 2) : 0;
      if (over > 0) {
        const room = ys.length > 0 ? ys[0]! - (vy + LEADER_ROW / 2) : 0;
        const shift = Math.min(over, Math.max(0, room));
        for (let i = 0; i < ys.length; i++) ys[i] = ys[i]! - shift;
      }
      column.forEach((row, i) => {
        const y = ys[i]!;
        const { label } = row;
        // Kept on the stage when there is no room beside the figure.
        const x = side === 'right' ? Math.min(maxX + LEADER_GAP, vx + vw - row.w - 2) : Math.max(minX - LEADER_GAP, vx + row.w + 2);
        const leader = label.leader!;
        leader.line.set({ x1: row.at[0], y1: row.at[1], x2: side === 'right' ? x - 4 : x + 4, y2: y });
        leader.dot.set({ cx: row.at[0], cy: row.at[1] });
        leader.line.show();
        leader.dot.show();
        label.handle.text(label.text);
        label.handle.set({ x, y, 'text-anchor': side === 'right' ? 'start' : 'end' });
        label.handle.show();
        label.box = { x: side === 'right' ? x : x - row.w, y: y - 8.5, w: row.w, h: 17, dx: side === 'right' ? 1 : -1, dy: 0 };
        placed.push(label.box);
      });
    }
  }

  private placeLabels(): void {
    const [mx, my] = this.camera.centre();
    const placed: NonNullable<LabelRecord['box']>[] = [];
    this.placeLeaders(placed);
    for (const label of this.labels) {
      if (label.leader) continue;
      const point = label.follow ? label.follow() : null;
      const anchor = !label.visible || (label.follow && !point) ? null : this.anchorOf(point ?? label.target);
      if (!anchor || label.text === '') {
        label.handle.hide();
        label.box = null;
        continue;
      }
      let dx = anchor.at[0] - mx;
      let dy = anchor.at[1] - my;
      const length = Math.hypot(dx, dy);
      if (length < 1) {
        dx = 0;
        dy = -1;
      } else {
        dx /= length;
        dy /= length;
      }
      const push = anchor.radius + label.offset;
      const w = label.text.length * 7.4 + 4;
      const h = 17;
      let x = anchor.at[0] + dx * push;
      let y = anchor.at[1] + dy * push;
      // Text grows away from the figure.
      const left = dx > 0.35 ? 0 : dx < -0.35 ? -w : -w / 2;
      let box = { x: x + left, y: y - h / 2, w, h, dx, dy };
      for (let tries = 0; tries < 8 && placed.some((b) => overlaps(b, box)); tries++) {
        x += dx * 6 || 0;
        y += (dy >= 0 ? 1 : -1) * 7;
        box = { x: x + left, y: y - h / 2, w, h, dx, dy };
      }
      placed.push(box);
      label.box = box;
      label.handle.text(label.text);
      label.handle.set({ x, y, 'text-anchor': dx > 0.35 ? 'start' : dx < -0.35 ? 'end' : 'middle' });
      label.handle.show();
    }
  }

  private placeGrabs(): void {
    for (const grab of this.grabs) {
      const anchor = grab.item.shown ? this.anchorOf(grab.item) : null;
      if (!anchor) {
        grab.handle.hide();
        continue;
      }
      grab.handle.set({ cx: anchor.at[0], cy: anchor.at[1], r: Math.max(14, anchor.radius) });
      grab.handle.show();
      this.ctx.setOwner(grab.node, grab.item.owner);
    }
  }
}

/** A polygon cut into k by k smaller pieces: a grid for a quad, a fan of subdivided triangles otherwise. */
/**
 * A large face as pieces no longer than `limit` across, so each sorts on its
 * own. A quad is cut into a grid with as many rows and columns as its sides
 * need, so a long thin face becomes a strip, not a square grid; other faces
 * are fanned into triangles from their centre, and each triangle is halved
 * across its longest side until it is short enough.
 */
function split(polygon: readonly Vec3[], limit: number): Vec3[][] {
  const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const length = (a: Vec3, b: Vec3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const count = (side: number) => Math.max(1, Math.min(6, Math.ceil(side / limit)));
  const pieces: Vec3[][] = [];
  if (polygon.length === 4) {
    const [a, b, c, d] = polygon as [Vec3, Vec3, Vec3, Vec3];
    const ku = count(Math.max(length(a, b), length(d, c)));
    const kv = count(Math.max(length(a, d), length(b, c)));
    const at = (u: number, v: number) => mix(mix(a, b, u), mix(d, c, u), v);
    for (let i = 0; i < ku; i++) {
      for (let j = 0; j < kv; j++) pieces.push([at(i / ku, j / kv), at((i + 1) / ku, j / kv), at((i + 1) / ku, (j + 1) / kv), at(i / ku, (j + 1) / kv)]);
    }
    return pieces;
  }
  const halve = (t: readonly [Vec3, Vec3, Vec3], depth: number): void => {
    let longest = 0;
    let at = 0;
    for (let e = 0; e < 3; e++) {
      const l = length(t[e]!, t[(e + 1) % 3]!);
      if (l > longest) {
        longest = l;
        at = e;
      }
    }
    if (longest <= limit || depth >= 5) {
      pieces.push([...t]);
      return;
    }
    // Cut across the longest side, keeping the winding: (p, m, r) and (m, q, r).
    const p = t[at]!;
    const q = t[(at + 1) % 3]!;
    const r = t[(at + 2) % 3]!;
    const m = mix(p, q, 0.5);
    halve([p, m, r], depth + 1);
    halve([m, q, r], depth + 1);
  };
  if (polygon.length === 3) {
    halve(polygon as unknown as readonly [Vec3, Vec3, Vec3], 0);
    return pieces;
  }
  const centre = polygon.reduce<Vec3>((s, p) => [s[0] + p[0] / polygon.length, s[1] + p[1] / polygon.length, s[2] + p[2] / polygon.length], [0, 0, 0]);
  for (let e = 0; e < polygon.length; e++) halve([centre, polygon[e]!, polygon[(e + 1) % polygon.length]!], 0);
  return pieces;
}

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export type { LabelRecord };
