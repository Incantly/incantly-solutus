import type {
  Arrow3D,
  CameraOptions,
  Curve3DOptions,
  Graph3D,
  Graph3DOptions,
  Label3D,
  Line3D,
  Line3DOptions,
  Object3D,
  ParametricSurfaceOptions,
  PartOptions,
  Readable,
  Stage,
  Surface3D,
  SurfaceOptions,
  Tone,
  Vec2,
  Vec3,
  View3D,
  ViewBox,
} from '../../api/types';
import type { KitContext } from '../../runtime/kit';
import { SceneApiError } from '../../scene/errors';
import { readVec3 } from './camera';
import { Engine3D, Item, toneOf, type Emitter, type Look } from './engine';
import { Line3DHandle, Object3DHandle, Space3DApi, type Coordinates } from './space';

/**
 * inc.graph3d (G3): data in a box that the learner turns. Panes and grids
 * sit on the far sides of the box from wherever the camera is, axes and ticks
 * on the near edges, and surfaces are sampled again on every draw so they
 * follow parameters.
 */

const DEFAULT_RESOLUTION = 24;
const MAX_CONTOURS = 12;

interface Range {
  readonly lo: number;
  readonly hi: number;
}

function range(value: unknown, name: string): Range {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((n) => typeof n === 'number' && Number.isFinite(n)) || !(value[0] < value[1])) {
    throw new SceneApiError(`graph3d ${name} must be [min, max] with min below max`);
  }
  return { lo: value[0], hi: value[1] };
}

/** About five round tick values across a range. */
export function niceTicks(lo: number, hi: number, target = 5): number[] {
  const raw = (hi - lo) / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / magnitude;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * magnitude;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9 && out.length < 12; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

function tickText(v: number): string {
  return String(Number(v.toPrecision(6)));
}

function look(value: unknown, fallback: Look): Look {
  if (value === undefined) return fallback;
  if (value !== 'solid' && value !== 'wire' && value !== 'ghost') throw new SceneApiError(`look must be 'solid', 'wire' or 'ghost', got "${String(value)}"`);
  return value;
}

function resolutionOf(value: unknown): number {
  if (value === undefined) return DEFAULT_RESOLUTION;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 4 || value > 80) throw new SceneApiError('resolution must be a whole number from 4 to 80');
  return value;
}

function contoursOf(value: unknown): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_CONTOURS || !value.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new SceneApiError(`contours must be a list of up to ${MAX_CONTOURS} heights`);
  }
  return [...value];
}

/** Where each level crosses one cell (marching squares), as segments in data units. */
function cellContours(corners: readonly Vec3[], levels: readonly number[]): Vec3[][] {
  const out: Vec3[][] = [];
  for (const level of levels) {
    const points: Vec3[] = [];
    for (let e = 0; e < corners.length; e++) {
      const a = corners[e]!;
      const b = corners[(e + 1) % corners.length]!;
      if (a[2] < level !== b[2] < level) {
        const k = (level - a[2]) / (b[2] - a[2]);
        points.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, level]);
      }
    }
    if (points.length === 2) out.push([points[0]!, points[1]!]);
    else if (points.length === 4) out.push([points[0]!, points[1]!], [points[2]!, points[3]!]);
  }
  return out;
}

/** The part of a polygon between two heights (Sutherland-Hodgman against two planes). */
export function clipBetween(polygon: readonly Vec3[], lo: number, hi: number): Vec3[] {
  const clip = (points: readonly Vec3[], keep: (p: Vec3) => boolean, level: number): Vec3[] => {
    const out: Vec3[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      const ina = keep(a);
      const inb = keep(b);
      if (ina) out.push(a);
      if (ina !== inb) {
        const k = (level - a[2]) / (b[2] - a[2]);
        out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, level]);
      }
    }
    return out;
  };
  const below = clip(polygon, (p) => p[2] <= hi, hi);
  return below.length < 3 ? [] : clip(below, (p) => p[2] >= lo, lo);
}

class Surface3DHandle extends Object3DHandle implements Surface3D {
  constructor(
    engine: Engine3D,
    item: Item,
    coords: Coordinates,
    private readonly graph: Graph3DApi,
    private readonly height: ((x: number, y: number) => number) | null,
  ) {
    super(engine, item, coords);
  }

  section(axis: 'x' | 'y', value: number | (() => number), options: { readonly tone?: Tone } = {}): Line3D {
    if (!this.height) throw new SceneApiError('section is for surfaces z = f(x, y) made with surface()');
    if (axis !== 'x' && axis !== 'y') throw new SceneApiError(`section axis must be 'x' or 'y', got "${String(axis)}"`);
    if (typeof value !== 'number' && typeof value !== 'function') throw new SceneApiError('section needs a value or a function that returns one');
    return this.graph.section(this.height, axis, value, toneOf(options.tone, 'lit'), this.item);
  }
}

/** A point that follows a function until it is placed by hand. */
class GraphPointHandle extends Object3DHandle {
  constructor(
    engine: Engine3D,
    item: Item,
    coords: Coordinates,
    private source: (() => Vec3) | null,
  ) {
    super(engine, item, coords);
    item.update = () => {
      if (!this.source) return;
      const p = this.source();
      if (Array.isArray(p) && p.length === 3 && p.every((c) => typeof c === 'number' && Number.isFinite(c))) item.position = coords.point([p[0], p[1], p[2]]);
    };
  }

  override at(x: number, y: number, z: number): this {
    this.source = null;
    return super.at(x, y, z);
  }
}

export class Graph3DApi implements Graph3D {
  readonly stage: Stage;
  private readonly space: Space3DApi;
  private readonly coords: Coordinates;
  private readonly x: Range;
  private readonly y: Range;
  private readonly z: Range;
  private surfaces = 0;

  constructor(
    readonly engine: Engine3D,
    options: Graph3DOptions,
  ) {
    this.x = range(options.x, 'x');
    this.y = range(options.y, 'y');
    this.z = range(options.z, 'z');
    const { x, y, z } = this;
    const map = (v: number, r: Range) => (2 * (v - r.lo)) / (r.hi - r.lo) - 1;
    this.coords = { point: (p) => [map(p[0], x), map(p[1], y), map(p[2], z)] };
    this.space = new Space3DApi(engine, this.coords);
    this.stage = engine.ctx.stage;
    this.frame(options);
  }

  /** Panes, grids, axes, ticks and names: on the far panes and near edges for wherever the camera is. */
  private frame(options: Graph3DOptions): void {
    const grid = options.grid === undefined ? ['xy'] : options.grid === false ? [] : options.grid === true ? ['xy', 'xz', 'yz'] : options.grid;
    if (!Array.isArray(grid) || !grid.every((g) => g === 'xy' || g === 'xz' || g === 'yz')) throw new SceneApiError("graph3d grid must be true, false or a list of 'xy', 'xz' and 'yz'");
    const names = options.labels ?? ['x', 'y', 'z'];
    if (!Array.isArray(names) || names.length !== 3) throw new SceneApiError('graph3d labels must be three names');
    const axes = options.axes !== false;
    const ticks = [niceTicks(this.x.lo, this.x.hi), niceTicks(this.y.lo, this.y.hi), niceTicks(this.z.lo, this.z.hi)];
    const ranges = [this.x, this.y, this.z];
    const toWorld = (axis: number, v: number) => (2 * (v - ranges[axis]!.lo)) / (ranges[axis]!.hi - ranges[axis]!.lo) - 1;
    // Which side each pane is on, from the latest draw.
    const side = { floor: -1, wallY: -1, wallX: -1, zAt: [1, -1] as [number, number] };
    const engine = this.engine;
    new Item(
      {
        type: 'custom',
        emit: (out: Emitter) => {
          const v = out.toViewer;
          side.floor = v[2] >= 0 ? -1 : 1;
          side.wallY = v[1] >= 0 ? -1 : 1;
          side.wallX = v[0] >= 0 ? -1 : 1;
          const panes: Record<string, (a: number, b: number) => Vec3> = {
            xy: (a, b) => [a, b, side.floor],
            xz: (a, b) => [a, side.wallY, b],
            yz: (a, b) => [side.wallX, a, b],
          };
          const paneTicks: Record<string, [number, number]> = { xy: [0, 1], xz: [0, 2], yz: [1, 2] };
          for (const name of grid) {
            const at = panes[name]!;
            out.face([at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)], { tone: 'faint', look: 'ghost', twoSided: true, bias: -50 });
            const [ua, ub] = paneTicks[name]!;
            for (const t of ticks[ua]!) out.line([at(toWorld(ua, t), -1), at(toWorld(ua, t), 1)], { tone: 'faint', bias: -40 });
            for (const t of ticks[ub]!) out.line([at(-1, toWorld(ub, t)), at(1, toWorld(ub, t))], { tone: 'faint', bias: -40 });
          }
          if (!axes) return;
          // The z axis stands on whichever side corner is further left on screen.
          const a: Vec3 = [side.wallX, -side.wallY, 0];
          const b: Vec3 = [-side.wallX, side.wallY, 0];
          const pa = out.project(a);
          const pb = out.project(b);
          side.zAt = !pa || !pb || pa[0] <= pb[0] ? [a[0], a[1]] : [b[0], b[1]];
          out.line([[-1, -side.wallY, side.floor], [1, -side.wallY, side.floor]], { tone: 'lo' });
          out.line([[-side.wallX, -1, side.floor], [-side.wallX, 1, side.floor]], { tone: 'lo' });
          out.line([[side.zAt[0], side.zAt[1], -1], [side.zAt[0], side.zAt[1], 1]], { tone: 'lo' });
        },
        bounds: () => [
          [-1, -1, -1],
          [1, 1, 1],
        ],
      },
      null,
      engine.root,
    );
    if (!axes) return;
    const tickPoint = (axis: number, v: number): Vec3 => {
      const w = toWorld(axis, v);
      if (axis === 0) return [w, -side.wallY, side.floor];
      if (axis === 1) return [-side.wallX, w, side.floor];
      return [side.zAt[0], side.zAt[1], w];
    };
    for (let axis = 0; axis < 3; axis++) {
      for (const t of ticks[axis]!) {
        const record = engine.label([0, 0, 0], tickText(t), 'lo', 8, () => tickPoint(axis, t));
        record.handle.set({ 'font-size': 12 });
      }
      const lo = ranges[axis]!.lo;
      const hi = ranges[axis]!.hi;
      engine.label([0, 0, 0], String(names[axis]), null, 30, () => tickPoint(axis, (lo + hi) / 2));
    }
  }

  private resolution(requested: number, detail: number): number {
    const budget = this.engine.options.budget;
    const byBudget = Math.floor(Math.sqrt(budget / Math.max(1, this.surfaces)));
    return Math.max(6, Math.min(requested, byBudget, Math.round(requested * detail)));
  }

  private grid(sample: (u: number, v: number) => Vec3 | null, u: Range, v: Range, n: number): (Vec3 | null)[][] {
    const out: (Vec3 | null)[][] = [];
    for (let i = 0; i <= n; i++) {
      const row: (Vec3 | null)[] = [];
      for (let j = 0; j <= n; j++) row.push(sample(u.lo + ((u.hi - u.lo) * i) / n, v.lo + ((v.hi - v.lo) * j) / n));
      out.push(row);
    }
    return out;
  }

  /**
   * Draws a sampled grid of data points as faces, cut to the box's heights
   * when `clip` is given, with contour lines lying on the faces. The 'wire'
   * look draws each cell's outline instead of filling it: a shaded wireframe
   * (G3-2), lit by the lamp and sorted by depth with everything else.
   */
  private emitGrid(out: Emitter, points: (Vec3 | null)[][], tone: Tone | null, lookName: Look, contours: readonly number[], clip: Range | null): void {
    const n = points.length - 1;
    const world = (p: Vec3) => this.coords.point(p);
    const lo = clip?.lo ?? -Infinity;
    const hi = clip?.hi ?? Infinity;
    const levels = contours.filter((c) => c >= lo && c <= hi);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const cell = [points[i]![j], points[i + 1]![j], points[i + 1]![j + 1], points[i]![j + 1]];
        if (!cell.every((p): p is Vec3 => p !== null)) continue;
        const polygon = clip ? clipBetween(cell, lo, hi) : cell;
        if (polygon.length < 3) continue;
        const lines = levels.length > 0 ? cellContours(cell, levels) : [];
        out.face(polygon.map(world), {
          tone,
          look: lookName,
          twoSided: true,
          smooth: true,
          ...(lines.length > 0 ? { overlay: { tone: null, lines: lines.map((line) => line.map(world)) } } : {}),
        });
      }
    }
  }

  surface(f: (x: number, y: number) => number, options: SurfaceOptions = {}): Surface3D {
    if (typeof f !== 'function') throw new SceneApiError('surface needs a function (x, y) => z');
    const tone = toneOf(options.tone, 'a');
    const lookName = look(options.look, 'solid');
    const requested = resolutionOf(options.resolution);
    const contours = contoursOf(options.contours);
    const { x, y, z } = this;
    this.surfaces++;
    const item = new Item(
      {
        type: 'custom',
        emit: (out: Emitter, self: Item) => {
          const n = this.resolution(requested, out.detail);
          const points = this.grid(
            (px, py) => {
              const pz = Number(f(px, py));
              return Number.isFinite(pz) ? [px, py, pz] : null;
            },
            x,
            y,
            n,
          );
          // Outside the box, the surface is cut off along the box's top and bottom.
          this.emitGrid(out, points, self.tone, self.look === 'solid' ? lookName : self.look, contours, z);
        },
        bounds: null,
      },
      tone,
      this.engine.root,
    );
    item.look = lookName;
    return new Surface3DHandle(this.engine, item, this.coords, this, (px, py) => Number(f(px, py)));
  }

  parametric(f: (u: number, v: number) => Vec3, options: ParametricSurfaceOptions): Surface3D {
    if (typeof f !== 'function') throw new SceneApiError('parametric needs a function (u, v) => [x, y, z]');
    if (typeof options !== 'object' || options === null) throw new SceneApiError('parametric needs options with u and v ranges');
    const u = range(options.u, 'parametric u');
    const v = range(options.v, 'parametric v');
    const tone = toneOf(options.tone, 'b');
    const lookName = look(options.look, 'solid');
    const requested = resolutionOf(options.resolution);
    const contours = contoursOf(options.contours);
    this.surfaces++;
    const item = new Item(
      {
        type: 'custom',
        emit: (out: Emitter, self: Item) => {
          const n = this.resolution(requested, out.detail);
          const points = this.grid(
            (pu, pv) => {
              const p = f(pu, pv);
              return Array.isArray(p) && p.length === 3 && p.every((c) => typeof c === 'number' && Number.isFinite(c)) ? [p[0], p[1], p[2]] : null;
            },
            u,
            v,
            n,
          );
          this.emitGrid(out, points, self.tone, self.look === 'solid' ? lookName : self.look, contours, null);
        },
        bounds: null,
      },
      tone,
      this.engine.root,
    );
    item.look = lookName;
    return new Surface3DHandle(this.engine, item, this.coords, this, null);
  }

  /** The curve where a surface meets x = value or y = value, with the cutting plane drawn faintly. */
  section(height: (x: number, y: number) => number, axis: 'x' | 'y', value: number | (() => number), tone: Tone | null, surface: Item): Line3D {
    const { x, y, z } = this;
    const across = axis === 'x' ? y : x;
    const at = () => (typeof value === 'function' ? Number(value()) : value);
    const plane = new Item(
      {
        type: 'custom',
        emit: (out: Emitter) => {
          const c = at();
          if (!Number.isFinite(c)) return;
          const corner = (a: number, h: number): Vec3 => this.coords.point(axis === 'x' ? [c, a, h] : [a, c, h]);
          // In small tiles, so the plane sorts cell by cell where it cuts through the surface.
          const n = 12;
          for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
              const a0 = across.lo + ((across.hi - across.lo) * i) / n;
              const a1 = across.lo + ((across.hi - across.lo) * (i + 1)) / n;
              const h0 = z.lo + ((z.hi - z.lo) * j) / n;
              const h1 = z.lo + ((z.hi - z.lo) * (j + 1)) / n;
              out.face([corner(a0, h0), corner(a1, h0), corner(a1, h1), corner(a0, h1)], { tone: 'faint', look: 'ghost', twoSided: true, smooth: true });
            }
          }
        },
        bounds: null,
      },
      null,
      this.engine.root,
    );
    const curve = new Item({ type: 'line', points: [], arrow: false, dashed: false, closed: false }, tone, this.engine.root);
    // A section lies on its surface: it is lifted toward the viewer so the surface does not swallow it.
    curve.bias = 0.06;
    curve.update = () => {
      const c = at();
      const points: Vec3[] = [];
      for (let i = 0; i <= 80; i++) {
        const a = across.lo + ((across.hi - across.lo) * i) / 80;
        const h = axis === 'x' ? height(c, a) : height(a, c);
        if (Number.isFinite(h) && h >= z.lo && h <= z.hi) points.push(this.coords.point(axis === 'x' ? [c, a, h] : [a, c, h]));
      }
      const g = curve.geometry as { points: Vec3[] };
      g.points = points;
      // The section shows and hides with its surface.
      curve.visible = surface.visible;
      plane.visible = surface.visible;
    };
    return new Line3DHandle(this.engine, curve, this.coords);
  }

  curve(f: (t: number) => Vec3, options: Curve3DOptions): Line3D {
    if (typeof f !== 'function') throw new SceneApiError('curve needs a function (t) => [x, y, z]');
    if (typeof options !== 'object' || options === null) throw new SceneApiError('curve needs options with a t range');
    const t = range(options.t, 't');
    const steps = options.steps === undefined ? 200 : options.steps;
    if (!Number.isInteger(steps) || steps < 2 || steps > 1000) throw new SceneApiError('curve steps must be a whole number from 2 to 1000');
    const item = new Item({ type: 'line', points: [], arrow: false, dashed: options.dashed === true, closed: false }, toneOf(options.tone, 'a'), this.engine.root);
    item.update = () => {
      const points: Vec3[] = [];
      for (let i = 0; i <= steps; i++) {
        const p = f(t.lo + ((t.hi - t.lo) * i) / steps);
        if (Array.isArray(p) && p.length === 3 && p.every((c) => typeof c === 'number' && Number.isFinite(c))) points.push(this.coords.point([p[0], p[1], p[2]]));
      }
      (item.geometry as { points: Vec3[] }).points = points;
    };
    return new Line3DHandle(this.engine, item, this.coords);
  }

  point(at: Vec3 | (() => Vec3), options: { readonly tone?: Tone; readonly label?: Readable } = {}): Object3D {
    const item = new Item({ type: 'point', r: 4.5 }, toneOf(options.tone, 'lit'), this.engine.root);
    const handle = new GraphPointHandle(this.engine, item, this.coords, typeof at === 'function' ? at : null);
    if (typeof at !== 'function') item.position = this.coords.point(readVec3(at, 'point'));
    if (options.label !== undefined) this.engine.label([0, 0, 0], options.label, toneOf(options.tone, null), 10, () => (item.shown ? ([...item.world.t] as Vec3) : null));
    return handle;
  }

  vector(from: Vec3, to: Vec3, options: Line3DOptions = {}): Arrow3D {
    return this.space.arrow(from, to, options);
  }

  line(points: ReadonlyArray<Vec3>, options: Line3DOptions = {}): Line3D {
    return this.space.line(points, options);
  }

  plane(normal: Vec3, d: number, options: { readonly tone?: Tone; readonly look?: Look } = {}): Surface3D {
    const n = readVec3(normal, 'plane normal');
    if (Math.hypot(...n) < 1e-12) throw new SceneApiError('plane needs a non-zero normal');
    if (typeof d !== 'number' || !Number.isFinite(d)) throw new SceneApiError('plane needs a finite d in n·p = d');
    const { x, y, z } = this;
    const corners: Vec3[] = [];
    for (let i = 0; i < 8; i++) corners.push([i & 1 ? x.hi : x.lo, i & 2 ? y.hi : y.lo, i & 4 ? z.hi : z.lo]);
    const points: Vec3[] = [];
    const s = (p: Vec3) => n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - d;
    for (let i = 0; i < 8; i++) {
      for (const bit of [1, 2, 4]) {
        if (i & bit) continue;
        const p = corners[i]!;
        const q = corners[i | bit]!;
        const sp = s(p);
        const sq = s(q);
        if (sp === 0) points.push(p);
        else if (sp * sq < 0) {
          const k = sp / (sp - sq);
          points.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k]);
        }
      }
    }
    // Corners on the plane appear once per edge: keep one of each.
    const unique = points.filter((p, i) => points.findIndex((q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-9) === i);
    let polygon: Vec3[] = [];
    if (unique.length >= 3) {
      const world = unique.map((p) => this.coords.point(p));
      const c = world.reduce<Vec3>((acc, p) => [acc[0] + p[0] / world.length, acc[1] + p[1] / world.length, acc[2] + p[2] / world.length], [0, 0, 0]);
      // Order the corners around the centre, in the plane's own axes (in world units, where the box is a cube).
      // Normals scale inversely to the box's stretch along each axis.
      const wn: Vec3 = [(n[0] * (x.hi - x.lo)) / 2, (n[1] * (y.hi - y.lo)) / 2, (n[2] * (z.hi - z.lo)) / 2];
      const helper: Vec3 = Math.abs(wn[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const u: Vec3 = [wn[1] * helper[2] - wn[2] * helper[1], wn[2] * helper[0] - wn[0] * helper[2], wn[0] * helper[1] - wn[1] * helper[0]];
      const w: Vec3 = [wn[1] * u[2] - wn[2] * u[1], wn[2] * u[0] - wn[0] * u[2], wn[0] * u[1] - wn[1] * u[0]];
      const angle = (p: Vec3) => {
        const r: Vec3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
        return Math.atan2(r[0] * w[0] + r[1] * w[1] + r[2] * w[2], r[0] * u[0] + r[1] * u[1] + r[2] * u[2]);
      };
      polygon = world.sort((a, b) => angle(a) - angle(b));
    }
    const lookName = look(options.look, 'ghost');
    const item = new Item(
      {
        type: 'custom',
        emit: (out: Emitter, self: Item) => {
          if (polygon.length >= 3) out.face(polygon, { tone: self.tone, look: self.look, twoSided: true });
        },
        bounds: null,
      },
      toneOf(options.tone, 'b'),
      this.engine.root,
    );
    item.look = lookName;
    return new Surface3DHandle(this.engine, item, this.coords, this, null);
  }

  label(at: Vec3, text: Readable, options: { readonly tone?: Tone } = {}): Label3D {
    return this.space.label(at, text, options);
  }

  part<T extends Object3D>(name: string, object: T, options?: PartOptions): T {
    return this.space.part(name, object, options);
  }

  camera(options: CameraOptions): void {
    this.engine.camera.set(options);
  }

  view(name: View3D): void {
    this.engine.camera.view(name);
  }

  project(p: Vec3): Vec2 {
    return this.space.project(p);
  }
}

export function readGraphOptions(options: unknown): { viewBox: ViewBox; budget: number } {
  const o = options as Graph3DOptions;
  range(o.x, 'x');
  range(o.y, 'y');
  range(o.z, 'z');
  const viewBox: ViewBox = o.viewBox ?? [0, 0, 640, 440];
  const budget = o.budget === undefined ? 1600 : o.budget;
  if (typeof budget !== 'number' || !Number.isFinite(budget) || budget < 50 || budget > 1600) throw new SceneApiError('graph3d budget is from 50 to 1600 faces');
  return { viewBox, budget };
}

export function createGraph(ctx: KitContext, options: unknown): Graph3D {
  const o = options as Graph3DOptions;
  const { viewBox, budget } = readGraphOptions(options);
  const engine = new Engine3D(ctx, viewBox, { ...(o.camera ? { camera: o.camera } : {}), mode: 'orbit', budget, zoom: o.zoom !== false });
  return new Graph3DApi(engine, o);
}
