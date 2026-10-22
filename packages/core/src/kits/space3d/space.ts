import type {
  Arrow3D,
  AxesOptions,
  CameraOptions,
  DragMap,
  FieldLineOptions,
  GridOptions,
  Group3D,
  Label3D,
  Line3D,
  Line3DOptions,
  Mat3,
  Mesh3DData,
  Object3D,
  PartOptions,
  Readable,
  Solid3DOptions,
  Space3D,
  Space3DOptions,
  Stage,
  Tone,
  Vec2,
  Vec3,
  View3D,
  ViewBox,
} from '../../api/types';
import { rotA } from '../../helpers/vec';
import type { KitContext } from '../../runtime/kit';
import { SceneApiError } from '../../scene/errors';
import { formatReadable } from '../../scene/handles';
import { readVec3 } from './camera';
import { Engine3D, euler, Item, toneOf, transformPoint, type Emitter, type LabelRecord, type Look } from './engine';
import { boxMesh, coneMesh, customMesh, cylinderMesh, planeMesh, segmentsOf, torusMesh } from './mesh';

/** Maps a handle the scene holds back to its item. */
const items = new WeakMap<object, Item>();

export function itemOf(value: unknown, call: string): Item {
  const item = typeof value === 'object' && value !== null ? items.get(value) : undefined;
  if (!item) throw new SceneApiError(`${call} needs an object made by this 3D figure`);
  return item;
}

/** How a figure's own coordinates become world coordinates: the identity in space3d, the data box in graph3d. */
export interface Coordinates {
  point(p: Vec3): Vec3;
}

export const IDENTITY_COORDINATES: Coordinates = { point: (p) => p };

/**
 * Two square directions across a grid's plane, as a function placing a point
 * (u, v) on it: the three axis planes by name, or any plane by its normal
 * (C3-12), with u kept level where the plane allows.
 */
export function planeAxes(plane: unknown): (u: number, v: number) => Vec3 {
  if (plane === 'xy') return (u, v) => [u, v, 0];
  if (plane === 'xz') return (u, v) => [u, 0, v];
  if (plane === 'yz') return (u, v) => [0, u, v];
  if (typeof plane !== 'object' || plane === null || !('normal' in plane)) {
    throw new SceneApiError(`grid plane must be 'xy', 'xz', 'yz' or { normal: [x, y, z] }, got "${String(plane)}"`);
  }
  const n = readVec3((plane as { normal: unknown }).normal, 'grid normal');
  const length = Math.hypot(n[0], n[1], n[2]);
  if (!(length > 1e-9)) throw new SceneApiError('A grid normal must not be zero');
  const [nx, ny, nz] = [n[0] / length, n[1] / length, n[2] / length];
  // u lies across the plane and level (no z) unless the plane is the floor itself; v completes the pair.
  const level = Math.hypot(nx, ny) > 1e-6;
  let [ux, uy, uz] = level ? [-ny, nx, 0] : [1, 0, 0];
  const lu = Math.hypot(ux, uy, uz);
  [ux, uy, uz] = [ux / lu, uy / lu, uz / lu];
  const [vx, vy, vz] = [ny * uz - nz * uy, nz * ux - nx * uz, nx * uy - ny * ux];
  return (a, b) => [a * ux + b * vx, a * uy + b * vy, a * uz + b * vz];
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new SceneApiError(`${name} must be a finite number`);
  return value;
}

function lookOf(value: unknown, fallback: Look): Look {
  if (value === undefined) return fallback;
  if (value !== 'solid' && value !== 'wire' && value !== 'ghost') throw new SceneApiError(`look must be 'solid', 'wire' or 'ghost', got "${String(value)}"`);
  return value;
}

function scaleOf(value: unknown): Vec3 {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value === 0) throw new SceneApiError('scale must be a finite number other than 0');
    return [value, value, value];
  }
  const v = readVec3(value, 'scale');
  if (v.some((n) => n === 0)) throw new SceneApiError('scale must not be 0 along any axis');
  return v;
}

export function matrixOf(value: unknown): Mat3 {
  if (!Array.isArray(value) || value.length !== 9 || !value.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new SceneApiError('orient needs a 3x3 matrix of nine finite numbers, such as inc.vec.rotA(axis, radians)');
  }
  return value as unknown as Mat3;
}

export class Object3DHandle implements Object3D {
  constructor(
    protected readonly engine: Engine3D,
    item: Item,
    protected readonly coords: Coordinates,
  ) {
    items.set(this, item);
  }

  protected get item(): Item {
    return items.get(this)!;
  }

  at(x: number, y: number, z: number): this {
    this.item.position = this.coords.point([finiteNumber(x, 'at x'), finiteNumber(y, 'at y'), finiteNumber(z, 'at z')]);
    return this;
  }

  rotate(rx: number, ry: number, rz: number): this {
    this.item.rotation = euler(finiteNumber(rx, 'rotate x'), finiteNumber(ry, 'rotate y'), finiteNumber(rz, 'rotate z'));
    return this;
  }

  orient(m: Mat3): this {
    this.item.rotation = matrixOf(m);
    return this;
  }

  scale(s: number | Vec3): this {
    this.item.scale = scaleOf(s);
    return this;
  }

  tone(name: Tone): this {
    this.item.tone = toneOf(name, null);
    this.engine.retone(this.item);
    return this;
  }

  show(visible = true): this {
    this.item.visible = visible !== false;
    return this;
  }

  hide(): this {
    return this.show(false);
  }

  screen(): Vec2 {
    return this.engine.screenOf(this.item);
  }
}

export class Group3DHandle extends Object3DHandle implements Group3D {
  explode(amount: number): this {
    const value = finiteNumber(amount, 'explode amount');
    if (value < 0 || value > 10) throw new SceneApiError('explode takes an amount from 0 to 10');
    this.item.explode = value;
    return this;
  }
}

export class Line3DHandle extends Object3DHandle implements Line3D {
  points(points: ReadonlyArray<Vec3>): this {
    const g = this.item.geometry;
    if (g.type !== 'line') throw new SceneApiError('points() is for lines');
    g.points = readPoints(points, 'points').map((p) => this.coords.point(p));
    return this;
  }
}

export class Arrow3DHandle extends Object3DHandle implements Arrow3D {
  constructor(
    engine: Engine3D,
    item: Item,
    coords: Coordinates,
    private readonly labelRecord: LabelRecord | null,
  ) {
    super(engine, item, coords);
  }

  set(from: Vec3, to: Vec3): this {
    const g = this.item.geometry;
    if (g.type !== 'arrow') throw new SceneApiError('set(from, to) is for arrows');
    g.from = this.coords.point(readVec3(from, 'arrow from'));
    g.to = this.coords.point(readVec3(to, 'arrow to'));
    return this;
  }

  label(text: Readable): this {
    if (!this.labelRecord) throw new SceneApiError('This arrow was made without a label; give it one with the label option');
    this.labelRecord.text = formatReadable(text);
    return this;
  }
}

/** The world tip of an arrow, for its label. */
function tipOf(item: Item): Vec3 {
  const g = item.geometry;
  return g.type === 'arrow' ? transformPoint(item.world, g.to) : [0, 0, 0];
}

/** A point part of the way along a line (0 its start, 1 its end), or null while the line is hidden. */
function pointAlong(item: Item, k: number): Vec3 | null {
  const g = item.geometry;
  if (!item.shown || g.type !== 'line' || g.points.length === 0) return null;
  return transformPoint(item.world, g.points[Math.round((g.points.length - 1) * k)]!);
}

export class Label3DHandle implements Label3D {
  constructor(
    private readonly record: LabelRecord,
    private readonly coords: Coordinates,
  ) {}

  at(target: Vec3 | Object3D): this {
    this.record.target = targetOf(target, this.coords);
    return this;
  }

  text(value: Readable): this {
    this.record.text = formatReadable(value);
    return this;
  }

  tone(name: Tone): this {
    this.record.tone = toneOf(name, null);
    if (this.record.tone) this.record.handle.tone(this.record.tone);
    return this;
  }

  show(visible = true): this {
    this.record.visible = visible !== false;
    return this;
  }

  hide(): this {
    return this.show(false);
  }
}

function targetOf(target: unknown, coords: Coordinates): Vec3 | Item {
  if (Array.isArray(target)) return coords.point(readVec3(target, 'label position'));
  return itemOf(target, 'label');
}

export function readPoints(points: unknown, name: string): Vec3[] {
  if (!Array.isArray(points) || points.length < 2 || points.length > 2000) throw new SceneApiError(`${name} needs from 2 to 2000 points [x, y, z]`);
  return points.map((p, i) => readVec3(p, `${name} point ${i}`));
}

function parentOf(value: unknown, engine: Engine3D): Item {
  if (value === undefined) return engine.root;
  const parent = itemOf(value, 'parent');
  if (parent.geometry.type !== 'group') throw new SceneApiError('A parent must be a group made with group()');
  return parent;
}

/** Applies the options every solid shares. */
function place(item: Item, options: Solid3DOptions | undefined, coords: Coordinates): void {
  if (options === undefined) return;
  if (typeof options !== 'object' || options === null) throw new SceneApiError('3D options must be an object');
  if (options.at !== undefined) item.position = coords.point(readVec3(options.at, 'at'));
  if (options.rotate !== undefined) {
    const [rx, ry, rz] = readVec3(options.rotate, 'rotate');
    item.rotation = euler(rx, ry, rz);
  }
  if (options.scale !== undefined) item.scale = scaleOf(options.scale);
  item.look = lookOf(options.look, item.look);
  if (options.bias !== undefined) item.bias = finiteNumber(options.bias, 'bias');
}

/** Builds the Space3D API over an engine; graph3d reuses the parts it shares. */
export class Space3DApi implements Space3D {
  readonly stage: Stage;

  constructor(
    readonly engine: Engine3D,
    private readonly coords: Coordinates = IDENTITY_COORDINATES,
  ) {
    this.stage = engine.ctx.stage;
  }

  private solid(make: (segments: number) => import('./mesh').Mesh, round: boolean, options: Solid3DOptions | undefined, fallbackTone: Tone | null = 'mid'): Object3D {
    const segments = round ? segmentsOf(options?.segments) : null;
    const item = new Item(
      { type: 'mesh', mesh: make(segments ?? 0), segments, rebuild: round ? make : null },
      toneOf(options?.tone, fallbackTone),
      parentOf(options?.parent, this.engine),
    );
    place(item, options, this.coords);
    return new Object3DHandle(this.engine, item, this.coords);
  }

  box(size: number | Vec3, options?: Solid3DOptions): Object3D {
    const [sx, sy, sz] = typeof size === 'number' ? [size, size, size] : readVec3(size, 'box size');
    return this.solid(() => boxMesh(sx, sy, sz), false, options);
  }

  sphere(r: number, options?: Solid3DOptions): Object3D {
    const radius = finiteNumber(r, 'sphere radius');
    if (!(radius > 0)) throw new SceneApiError('sphere radius must be above 0');
    const item = new Item({ type: 'sphere', r: radius, segments: segmentsOf(options?.segments) }, toneOf(options?.tone, 'mid'), parentOf(options?.parent, this.engine));
    place(item, options, this.coords);
    return new Object3DHandle(this.engine, item, this.coords);
  }

  cylinder(r: number, h: number, options?: Solid3DOptions): Object3D {
    return this.solid((n) => cylinderMesh(r, h, n), true, options);
  }

  cone(r: number, h: number, options?: Solid3DOptions): Object3D {
    return this.solid((n) => coneMesh(r, h, n), true, options);
  }

  plane(w: number, d: number, options?: Solid3DOptions): Object3D {
    return this.solid(() => planeMesh(w, d), false, options, 'faint');
  }

  torus(R: number, r: number, options?: Solid3DOptions): Object3D {
    if (!(R > r)) throw new SceneApiError('A torus needs its ring radius R larger than its tube radius r');
    return this.solid((n) => torusMesh(R, r, n), true, options);
  }

  tube(from: Vec3, to: Vec3, r: number, options: Solid3DOptions = {}): Object3D {
    const a = this.coords.point(readVec3(from, 'tube from'));
    const b = this.coords.point(readVec3(to, 'tube to'));
    const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const length = Math.hypot(...d);
    if (!(length > 1e-9)) throw new SceneApiError('tube needs two different points');
    const handle = this.solid((n) => cylinderMesh(r, length, n), true, options);
    const item = itemOf(handle, 'tube');
    item.position = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    // Turn the cylinder's z axis onto the direction from one end to the other.
    const u: Vec3 = [d[0] / length, d[1] / length, d[2] / length];
    const axis: Vec3 = [-u[1], u[0], 0];
    const sin = Math.hypot(axis[0], axis[1]);
    item.rotation = sin < 1e-9 ? (u[2] > 0 ? item.rotation : rotA([1, 0, 0], Math.PI)) : rotA(axis, Math.atan2(sin, u[2]));
    return handle;
  }

  mesh(data: Mesh3DData, options?: Solid3DOptions): Object3D {
    const mesh = customMesh(data);
    return this.solid(() => mesh, false, options);
  }

  group(options?: Solid3DOptions): Group3D {
    const item = new Item({ type: 'group' }, toneOf(options?.tone, null), parentOf(options?.parent, this.engine));
    place(item, options, this.coords);
    return new Group3DHandle(this.engine, item, this.coords);
  }

  line(points: ReadonlyArray<Vec3>, options: Line3DOptions = {}): Line3D {
    const item = new Item(
      { type: 'line', points: readPoints(points, 'line').map((p) => this.coords.point(p)), arrow: options.arrow === true, dashed: options.dashed === true, closed: false },
      toneOf(options.tone, null),
      parentOf(options.parent, this.engine),
    );
    if (options.label !== undefined) {
      // A line's label sits at its end and follows the points.
      this.engine.label([0, 0, 0], options.label, toneOf(options.tone, null), 10, () => pointAlong(item, 1));
    }
    return new Line3DHandle(this.engine, item, this.coords);
  }

  arrow(from: Vec3, to: Vec3, options: Line3DOptions = {}): Arrow3D {
    const item = new Item(
      { type: 'arrow', from: this.coords.point(readVec3(from, 'arrow from')), to: this.coords.point(readVec3(to, 'arrow to')), dashed: options.dashed === true },
      toneOf(options.tone, null),
      parentOf(options.parent, this.engine),
    );
    const record = options.label !== undefined ? this.engine.label([0, 0, 0], options.label, toneOf(options.tone, null), 10, () => (item.shown ? tipOf(item) : null)) : null;
    return new Arrow3DHandle(this.engine, item, this.coords, record);
  }

  coil(r: number, h: number, turns: number, options: Line3DOptions = {}): Line3D {
    const radius = finiteNumber(r, 'coil r');
    const height = finiteNumber(h, 'coil h');
    const count = finiteNumber(turns, 'coil turns');
    if (!(radius > 0) || !(height > 0) || !(count > 0 && count <= 80)) throw new SceneApiError('coil needs a positive radius and height and from 0 to 80 turns');
    const n = Math.min(1999, Math.ceil(count * 24));
    const points: Vec3[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const a = 2 * Math.PI * count * t;
      points.push([radius * Math.cos(a), radius * Math.sin(a), -height / 2 + height * t]);
    }
    return this.line(points, options);
  }

  arc(center: Vec3, from: Vec3, axis: Vec3, degrees: number, options: Line3DOptions = {}): Line3D {
    const c = readVec3(center, 'arc center');
    const f = readVec3(from, 'arc from');
    const a = readVec3(axis, 'arc axis');
    const angle = finiteNumber(degrees, 'arc degrees');
    if (Math.hypot(...a) < 1e-12) throw new SceneApiError('arc needs a non-zero axis');
    const n = Math.max(8, Math.min(180, Math.ceil(Math.abs(angle) / 4)));
    const points: Vec3[] = [];
    for (let i = 0; i <= n; i++) {
      const m = rotA(a, ((angle * i) / n) * (Math.PI / 180));
      points.push([c[0] + m[0] * f[0] + m[1] * f[1] + m[2] * f[2], c[1] + m[3] * f[0] + m[4] * f[1] + m[5] * f[2], c[2] + m[6] * f[0] + m[7] * f[1] + m[8] * f[2]]);
    }
    const { label, ...rest } = options;
    const handle = this.line(points, rest);
    if (label !== undefined) {
      // An arc's label sits at its middle.
      const item = itemOf(handle, 'arc');
      this.engine.label([0, 0, 0], label, toneOf(options.tone, null), 10, () => pointAlong(item, 0.5));
    }
    return handle;
  }

  point(at: Vec3, options: { readonly tone?: Tone; readonly parent?: Group3D; readonly r?: number } = {}): Object3D {
    const r = options.r === undefined ? 4.5 : finiteNumber(options.r, 'point r');
    if (!(r > 0 && r <= 40)) throw new SceneApiError('A point radius is from 0 to 40 stage units');
    const item = new Item({ type: 'point', r }, toneOf(options.tone, 'lit'), parentOf(options.parent, this.engine));
    item.position = this.coords.point(readVec3(at, 'point'));
    return new Object3DHandle(this.engine, item, this.coords);
  }

  label(target: Vec3 | Object3D, text: Readable, options: { readonly tone?: Tone; readonly offset?: number } = {}): Label3D {
    const offset = options.offset === undefined ? 10 : finiteNumber(options.offset, 'label offset');
    const record = this.engine.label(targetOf(target, this.coords), text, toneOf(options.tone, null), offset);
    return new Label3DHandle(record, this.coords);
  }

  grid(options: GridOptions = {}): Object3D {
    const plane = options.plane ?? 'xy';
    const size = options.size === undefined ? 5 : finiteNumber(options.size, 'grid size');
    const step = options.step === undefined ? 1 : finiteNumber(options.step, 'grid step');
    if (!(size > 0) || !(step > 0) || size / step > 50) throw new SceneApiError('A grid needs a positive size and step, with at most 50 lines each way');
    const at = options.at === undefined ? ([0, 0, 0] as Vec3) : this.coords.point(readVec3(options.at, 'grid at'));
    const lift = planeAxes(plane);
    const lines: Vec3[][] = [];
    const count = Math.floor(size / step + 1e-9);
    for (let i = -count; i <= count; i++) {
      lines.push([lift(i * step, -size), lift(i * step, size)]);
      lines.push([lift(-size, i * step), lift(size, i * step)]);
    }
    const item = new Item(
      {
        type: 'custom',
        emit: (out: Emitter, self: Item) => {
          for (const line of lines) out.line(line, { tone: self.tone, bias: -1e-3 });
        },
        bounds: () => [lift(-size, -size), lift(size, size)],
      },
      toneOf(options.tone, 'faint'),
      this.engine.root,
    );
    item.position = at;
    return new Object3DHandle(this.engine, item, this.coords);
  }

  axes(options: AxesOptions = {}): Group3D {
    const length = options.length === undefined ? 4 : finiteNumber(options.length, 'axes length');
    if (!(length > 0)) throw new SceneApiError('axes length must be above 0');
    const names = options.labels ?? ['x', 'y', 'z'];
    if (!Array.isArray(names) || names.length !== 3) throw new SceneApiError('axes labels must be three names');
    const group = this.group();
    const tones: Tone[] = ['a', 'b', 'c'];
    for (let i = 0; i < 3; i++) {
      const tip: Vec3 = [i === 0 ? length : 0, i === 1 ? length : 0, i === 2 ? length : 0];
      const tail: Vec3 = options.both ? [-tip[0], -tip[1], -tip[2]] : [0, 0, 0];
      this.arrow(tail, tip, { tone: tones[i]!, parent: group, label: String(names[i]) });
    }
    return group;
  }

  fieldLines(field: (p: Vec3) => Vec3, seeds: ReadonlyArray<Vec3>, options: FieldLineOptions = {}): Group3D {
    if (typeof field !== 'function') throw new SceneApiError('fieldLines needs a function (p) => [fx, fy, fz]');
    if (!Array.isArray(seeds) || seeds.length === 0 || seeds.length > 64) throw new SceneApiError('fieldLines needs from 1 to 64 seed points');
    const starts = seeds.map((s, i) => readVec3(s, `seed ${i}`));
    const steps = options.steps === undefined ? 120 : Math.round(finiteNumber(options.steps, 'steps'));
    const h = options.step === undefined ? 0.08 : finiteNumber(options.step, 'step');
    if (steps < 2 || steps > 600 || !(h > 0)) throw new SceneApiError('fieldLines takes from 2 to 600 steps of a positive size');
    const sinks = (options.sinks ?? []).map((p, i) => readVec3(p, `sink ${i}`));
    const arrows = options.arrows !== false;
    const direction = (p: Vec3): Vec3 | null => {
      const f = field(p);
      if (!Array.isArray(f) || f.length !== 3) return null;
      const n = Math.hypot(f[0], f[1], f[2]);
      return Number.isFinite(n) && n > 1e-12 ? [f[0] / n, f[1] / n, f[2] / n] : null;
    };
    const trace = (start: Vec3): Vec3[] => {
      const points: Vec3[] = [start];
      let p = start;
      for (let i = 0; i < steps; i++) {
        // RK4 along the field's direction, so the step length stays even.
        const k1 = direction(p);
        if (!k1) break;
        const k2 = direction([p[0] + (k1[0] * h) / 2, p[1] + (k1[1] * h) / 2, p[2] + (k1[2] * h) / 2]);
        if (!k2) break;
        const k3 = direction([p[0] + (k2[0] * h) / 2, p[1] + (k2[1] * h) / 2, p[2] + (k2[2] * h) / 2]);
        if (!k3) break;
        const k4 = direction([p[0] + k3[0] * h, p[1] + k3[1] * h, p[2] + k3[2] * h]);
        if (!k4) break;
        p = [p[0] + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]), p[1] + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]), p[2] + (h / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2])];
        if (!p.every(Number.isFinite) || Math.hypot(...p) > 1e4) break;
        points.push(p);
        if (sinks.some((s) => Math.hypot(p[0] - s[0], p[1] - s[1], p[2] - s[2]) < h * 1.5)) break;
      }
      return points;
    };
    const group = this.group();
    let lastTraced: Vec3[][] = [];
    new Item(
      {
        type: 'custom',
        emit: (out: Emitter, self: Item) => {
          // Traced again each draw, so lines follow fields that depend on parameters.
          lastTraced = starts.map(trace);
          for (const line of lastTraced) if (line.length >= 2) out.line(line, { tone: self.tone, ...(arrows ? { arrowsEvery: 30 } : {}) });
        },
        // The view is fitted before the first draw has traced anything.
        bounds: () => (lastTraced.length > 0 ? lastTraced : starts.map(trace)).flat(),
      },
      toneOf(options.tone, null),
      itemOf(group, 'fieldLines'),
    );
    return group;
  }

  part<T extends Object3D>(name: string, object: T, options?: PartOptions): T {
    this.engine.part(itemOf(object, 'part'), name, options);
    return object;
  }

  drag<T extends Object3D>(object: T, map: DragMap, options: { readonly label?: string } = {}): T {
    this.engine.drag(itemOf(object, 'drag'), map, options.label);
    return object;
  }

  pick(x: number, y: number, z = 0): Vec3 | null {
    return this.engine.pick(finiteNumber(x, 'pick x'), finiteNumber(y, 'pick y'), finiteNumber(z, 'pick z'));
  }

  camera(options: CameraOptions): void {
    this.engine.camera.set(options);
  }

  view(name: View3D): void {
    this.engine.camera.view(name);
  }

  project(p: Vec3): Vec2 {
    return this.engine.projectWorld(this.coords.point(readVec3(p, 'project')));
  }
}

export function readSpaceOptions(options: unknown): { viewBox: ViewBox; mode: 'orbit' | 'iso' | 'fixed'; budget: number } {
  const o = options as Space3DOptions;
  const viewBox: ViewBox = o.viewBox ?? [0, 0, 640, 440];
  const mode = o.mode ?? 'orbit';
  if (mode !== 'orbit' && mode !== 'iso' && mode !== 'fixed') throw new SceneApiError(`space3d mode must be 'orbit', 'iso' or 'fixed', got "${String(mode)}"`);
  const budget = o.budget === undefined ? 1200 : finiteNumber(o.budget, 'budget');
  if (budget < 50 || budget > 1600) throw new SceneApiError('space3d budget is from 50 to 1600 faces');
  return { viewBox, mode, budget };
}

export function createSpace(ctx: KitContext, options: unknown): Space3D {
  const o = options as Space3DOptions;
  const { viewBox, mode, budget } = readSpaceOptions(options);
  const engine = new Engine3D(ctx, viewBox, { ...(o.camera ? { camera: o.camera } : {}), mode, budget, zoom: o.zoom !== false });
  return new Space3DApi(engine);
}

