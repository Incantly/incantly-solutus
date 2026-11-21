/**
 * The scene of the Space view (docs/features/space-3d/design.md 9.2, ui.md 7; .kiro/specs/space-3d R3.3): kernel
 * objects to points, line pieces and flat faces in space, with their colours. Pure: no DOM, so the screen, the export
 * and the tests share it.
 */
import { colorHex, isParticlesValue, makeParticleBatch, physics, space } from '@incantly/kernel';
import type { Figure } from '@incantly/kernel';
import { fireColor } from '../physics';
import { curveRuns, gridFaces } from './mesh3';
import { boxEdges, clipFace, clipSegment, inBox } from './clip3';
import type { Box3 } from './clip3';

type V3 = space.V3;
const { add, dot, frameOf, fromFrame, isV3, scale, sub, unit } = space;

export interface PointItem {
  readonly k: 'point';
  readonly id: number;
  readonly name: string;
  readonly p: V3;
  readonly color: string;
  readonly size: number;
  readonly label: boolean;
  readonly free: boolean;
}

export interface LineItem {
  readonly k: 'line';
  readonly id: number;
  readonly a: V3;
  readonly b: V3;
  readonly color: string;
  readonly width: number;
  /** Drawn dashed and faint where a solid is in front (design 9.3 step 4). */
  readonly hiddenDashed: boolean;
  /** An arrow head at `b` (vectors and the axes). */
  readonly arrow?: boolean;
  /** A thin dotted guide (a dragged point's drop to the floor). */
  readonly dotted?: boolean;
}

export interface FaceItem {
  readonly k: 'face';
  readonly id: number;
  /** A flat convex loop. */
  readonly pts: readonly V3[];
  readonly color: string;
  readonly alpha: number;
  /** Hides the lines behind it (solids, polygons, planes that are not too faint). */
  readonly occludes: boolean;
  /** Shaded by the light; the floor is not. */
  readonly shade: boolean;
  /** Grid lines drawn on the face: the colour, and which sides (a→b, b→c, c→d, d→a). */
  readonly stroke?: string;
  readonly edges?: readonly [boolean, boolean, boolean, boolean];
  /** A face of a body: the name to drag it by (`dice[2]` for an item of a list). */
  readonly body?: string;
  /** False for a face the pointer passes through (a slice of smoke): no hit area is made for it. */
  readonly pick?: boolean;
}

/** A particle: a small dot, drawn after the faces, never hidden and never picked (there are thousands). */
export interface DotItem {
  readonly k: 'dot';
  readonly id: number;
  readonly p: V3;
  /** CSS colour. */
  readonly color: string;
  readonly alpha: number;
  /** Radius in world units, or in pixels when `px`. */
  readonly size: number;
  readonly px: boolean;
}

export interface LabelItem {
  readonly k: 'label';
  readonly at: V3;
  readonly text: string;
  readonly color: string;
  readonly size: number;
}

/**
 * A sheet of points (a cloth, a wave surface; physics design 12.1): nx × ny points row by row (point i + j nx), drawn
 * as a lit two-sided surface. The WebGL 2 painter draws every point; the software painter draws every `coarse`-th
 * point on a screen without WebGL 2 and every `fine`-th in an SVG.
 */
export interface SheetItem {
  readonly k: 'sheet';
  readonly id: number;
  readonly name: string;
  readonly nx: number;
  readonly ny: number;
  /** nx · ny · 3 floats (x, y, z of each point). */
  readonly pos: Float32Array;
  /** Triangles by point index when not the full grid (a torn cloth), and a number that changes with them. */
  readonly tris?: Uint32Array;
  readonly topology?: number;
  readonly color: string;
  readonly alpha: number;
  /** A faint thread every this many points (0 for none). */
  readonly threads: number;
  /** Hides the lines and points behind it (a cloth does; waves do not). */
  readonly occludes: boolean;
  readonly coarse: number;
  readonly fine: number;
}

/** A batch of drops (physics design 12.1): one instanced draw of discs, or the software painter's dots. */
export interface DropsItem {
  readonly k: 'drops';
  readonly id: number;
  readonly name: string;
  /** count · 3 floats. */
  readonly pos: Float32Array;
  readonly count: number;
  readonly color: string;
  readonly alpha: number;
  /** Radius in world units. */
  readonly radius: number;
}

/**
 * A smoke or fire grid in space (physics design 9.8, 12.1): the box, `n` cells a side, the smoke density `s` and the
 * temperature `T` (°C; none for smoke) of each cell, index (k n + j) n + i. The WebGL 2 painter ray-marches them; the
 * software painter draws 12 slices of cells as quads.
 */
export interface VolumeItem {
  readonly k: 'volume';
  readonly id: number;
  readonly name: string;
  readonly n: number;
  readonly min: V3;
  readonly max: V3;
  readonly density: Float32Array;
  readonly temp?: Float32Array;
  /** The fire's hottest, °C: temperature is drawn as `T / heat` of the ramp's scale (0 for smoke). */
  readonly heat: number;
  /** The smoke's colour. */
  readonly color: string;
}

export type Item3 = PointItem | LineItem | FaceItem | LabelItem | DotItem | SheetItem | DropsItem | VolumeItem;

export interface Scene3 {
  /** The floor plate and grid, drawn first and never hiding anything. */
  readonly floor: readonly Item3[];
  readonly items: readonly Item3[];
}

export interface Scene3Options {
  /** The half-size of the axes and floor (default 5). */
  readonly extent?: number;
  /** Objects the screen hides on its own. */
  readonly hidden?: (o: { id: number; name: string }) => boolean;
  /** The selected objects, drawn larger. */
  readonly selected?: ReadonlySet<string>;
  /** A point whose height is shown by a dotted line down to the floor (ui.md 5.1). */
  readonly guide?: string;
}

const AXIS_COLORS = { x: '#d64545', y: '#2a9d6f', z: '#2f6fdb' } as const;

/** The part of a line `o + t d` inside the box `c ± h`, or `undefined` when it misses (slab test). */
export function clipLine(o: V3, d: V3, c: V3, h: number, lo = -Infinity, hi = Infinity): [V3, V3] | undefined {
  let t0 = lo;
  let t1 = hi;
  for (const k of ['x', 'y', 'z'] as const) {
    const a = c[k] - h - o[k];
    const b = c[k] + h - o[k];
    if (Math.abs(d[k]) < 1e-15) {
      if (a > 0 || b < 0) return undefined;
      continue;
    }
    let u = a / d[k];
    let v = b / d[k];
    if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u);
    t1 = Math.min(t1, v);
  }
  if (!(t1 > t0) || !Number.isFinite(t0) || !Number.isFinite(t1)) return undefined;
  return [add(o, scale(d, t0)), add(o, scale(d, t1))];
}

/** A loop of `n` points on a circle in the frame's plane. */
function ring(f: space.Frame, r: number, n: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    out.push(fromFrame(f, r * Math.cos(a), r * Math.sin(a)));
  }
  return out;
}

/** A great circle of a ball, in the ball's own x-y plane, turned by its quaternion. */
function stripe(c: V3, r: number, q: readonly [number, number, number, number]): V3[] {
  const [w, x, y, z] = q;
  const R = [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (x * z - w * y), 2 * (y * z + w * x)];
  const out: V3[] = [];
  for (let i = 0; i < 32; i++) {
    const a = (2 * Math.PI * i) / 32;
    const u = r * Math.cos(a);
    const v = r * Math.sin(a);
    out.push({ x: c.x + (R[0] as number) * u + (R[1] as number) * v, y: c.y + (R[2] as number) * u + (R[3] as number) * v, z: c.z + (R[4] as number) * u + (R[5] as number) * v });
  }
  return out;
}

function loopLines(id: number, pts: readonly V3[], color: string, width: number, closed = true): LineItem[] {
  const out: LineItem[] = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) out.push({ k: 'line', id, a: pts[i] as V3, b: pts[(i + 1) % pts.length] as V3, color, width, hiddenDashed: true });
  return out;
}

/** The scene of a figure now: what each 3D object looks like (ui.md 7). */
export function sceneOf3(figure: Figure, view: space.View3, opts: Scene3Options = {}): Scene3 {
  const L = opts.extent ?? space.SPACE_FIT_RADIUS - 1;
  const items: Item3[] = [];
  const floor: Item3[] = [];

  /* ---- floor, grid and axes ---- */
  if (view.floor) floor.push({ k: 'face', id: -1, pts: [{ x: -L, y: -L, z: 0 }, { x: L, y: -L, z: 0 }, { x: L, y: L, z: 0 }, { x: -L, y: L, z: 0 }], color: '#c9d3e0', alpha: 0.25, occludes: false, shade: false });
  if (view.grid) {
    for (let i = -L; i <= L; i++) {
      const c = i === 0 && view.axes ? '#c4cbd6' : '#dde2ea';
      floor.push({ k: 'line', id: -1, a: { x: i, y: -L, z: 0 }, b: { x: i, y: L, z: 0 }, color: c, width: 1, hiddenDashed: false });
      floor.push({ k: 'line', id: -1, a: { x: -L, y: i, z: 0 }, b: { x: L, y: i, z: 0 }, color: c, width: 1, hiddenDashed: false });
    }
  }
  if (view.axes) {
    for (const k of ['x', 'y', 'z'] as const) {
      const e = { x: 0, y: 0, z: 0, [k]: 1 } as V3;
      items.push({ k: 'line', id: -2, a: scale(e, -L), b: scale(e, L + 0.6), color: AXIS_COLORS[k], width: 1.5, hiddenDashed: true, arrow: true });
      items.push({ k: 'label', at: scale(e, L + 1), text: k, color: AXIS_COLORS[k], size: 13 });
      for (let i = -L; i <= L; i++) {
        if (i === 0) continue;
        items.push({ k: 'label', at: scale(e, i), text: String(i).replace('-', '−'), color: '#7a8392', size: 10 });
      }
    }
  }

  /* ---- the objects ---- */
  const C = view.target;
  const H = 2 * L;
  for (const o of figure.objects()) {
    if (!o.cell.defined || !o.style.shown) continue;
    const id = o.id as unknown as number;
    if (opts.hidden?.({ id, name: o.name })) continue;
    const v = o.cell.value;
    const color = colorHex({ ...o.style.color, a: 1 });
    const width = Math.max(1, o.style.width || 2) * (opts.selected?.has(o.name) ? 1.8 : 1);
    const alpha = Math.max(0.05, Math.min(1, o.style.opacity ?? 0.4));
    switch (o.type) {
      case 'Point3':
        if (isV3(v) && opts.guide === o.name && Math.abs(v.z) > 1e-9) items.push({ k: 'line', id: -3, a: v, b: { x: v.x, y: v.y, z: 0 }, color: '#5b6472', width: 1, hiddenDashed: false, dotted: true });
        if (isV3(v)) items.push({ k: 'point', id, name: o.name, p: v, color, size: (o.style.pointSize || 4) + (opts.selected?.has(o.name) ? 2 : 0), label: o.style.label !== 'none', free: o.free });
        break;
      case 'Vector3':
        if (isV3(v)) items.push({ k: 'line', id, a: { x: 0, y: 0, z: 0 }, b: v, color, width, hiddenDashed: true, arrow: true });
        break;
      case 'Segment3': {
        const s = v as space.Segment3;
        items.push({ k: 'line', id, a: s.a, b: s.b, color, width, hiddenDashed: true });
        break;
      }
      case 'Line3':
      case 'Ray3': {
        const l = v as space.Line3;
        const seg = clipLine(l.o, l.d, C, H, o.type === 'Ray3' ? 0 : -Infinity);
        if (seg) items.push({ k: 'line', id, a: seg[0], b: seg[1], color, width, hiddenDashed: true, ...(o.type === 'Ray3' ? { arrow: true } : {}) });
        break;
      }
      case 'Plane': {
        // a patch the size of the view, about the point of the plane nearest the target (ui.md 7)
        const pl = v as space.Plane3;
        const c = sub(C, scale(pl.n, dot(pl.n, C) - pl.c));
        const f = frameOf(c, pl.n);
        const pts = [fromFrame(f, -L, -L), fromFrame(f, L, -L), fromFrame(f, L, L), fromFrame(f, -L, L)];
        items.push({ k: 'face', id, pts, color, alpha: Math.min(alpha, 0.35), occludes: false, shade: true });
        items.push(...loopLines(id, pts, color, 1));
        break;
      }
      case 'Polygon3': {
        const g = v as space.Polygon3;
        items.push({ k: 'face', id, pts: g.pts, color, alpha, occludes: alpha >= 0.3, shade: true });
        items.push(...loopLines(id, g.pts, color, width));
        break;
      }
      case 'Circle3': {
        const c = v as space.Circle3;
        items.push(...loopLines(id, ring(c.f, c.r, 64), color, width));
        break;
      }
      case 'Polyhedron': {
        const p = v as space.Polyhedron;
        for (const face of p.faces) items.push({ k: 'face', id, pts: face.idx.map((i) => p.verts[i] as V3), color, alpha, occludes: true, shade: true });
        for (const [a, b] of space.edgesOf(p)) items.push({ k: 'line', id, a: p.verts[a] as V3, b: p.verts[b] as V3, color: darker(color), width: Math.max(1, width * 0.75), hiddenDashed: true });
        break;
      }
      case 'Sphere': {
        const s = v as space.Sphere3;
        items.push(...sphereFaces(id, s, color, alpha));
        break;
      }
      case 'Cylinder':
      case 'Cone': {
        const s = v as space.Cylinder3;
        items.push(...roundFaces(id, s, o.type === 'Cone', color, alpha));
        break;
      }
      case 'Body3':
      case 'List': {
        // bodies in space (physics design 7, ui.md 3): the solid where the body is now, its faces tagged to drag it by
        const list = o.type === 'Body3' ? [v] : Array.isArray(v) ? (v as unknown[]) : [];
        // a list of wheels or of joints in space (round 5)
        for (const x of list) {
          if (physics.isWheel3Value(x)) items.push(...wheelItems(id, x, x.r, color));
          else if (physics.isJoint3Value(x)) items.push(...jointItems(id, x, color, width));
        }
        list.forEach((b, k) => {
          if (!physics.isBody3Value(b)) return;
          const name = o.type === 'Body3' ? o.name : `${o.name}[${k + 1}]`;
          const a = Math.max(alpha, 0.85);
          const s = b.now;
          if (s.shape3 === 'Polyhedron') {
            for (const face of s.faces) items.push({ k: 'face', id, pts: face.idx.map((i) => s.verts[i] as V3), color, alpha: a, occludes: true, shade: true, body: name });
            for (const [p, q] of space.edgesOf(s)) items.push({ k: 'line', id, a: s.verts[p] as V3, b: s.verts[q] as V3, color: darker(color), width: Math.max(1, width * 0.6), hiddenDashed: false });
          } else if (s.shape3 === 'Sphere') {
            for (const f of sphereFaces(id, s, color, a)) items.push(f.k === 'face' ? { ...f, body: name } : f);
            // a stripe turned with the body, so a ball is seen to roll
            items.push(...loopLines(id, stripe(s.c, s.r * 1.01, b.q), darker(color), Math.max(1, width * 0.75)));
          } else {
            for (const f of roundFaces(id, s as space.Cylinder3, s.shape3 === 'Cone', color, a)) items.push(f.k === 'face' ? { ...f, body: name } : f);
          }
        });
        break;
      }
      case 'Wheel3':
        // a wheel of a car in space: a dark tyre with spokes, so its turn shows (ui.md 7)
        if (physics.isWheel3Value(v)) items.push(...wheelItems(id, v, v.r, color));
        break;
      case 'Vehicle':
        // the wheels that came off, where they are now
        if (physics.isVehicle3Value(v)) for (const w of v.loose) items.push(...wheelItems(id, w, w.r, '#2b2f36'));
        break;
      case 'Joint':
        if (physics.isJoint3Value(v)) items.push(...jointItems(id, v, color, width));
        break;
      case 'Surface': {
        const s = v as space.Surface3;
        const N = 36;
        const du = (s.u[1] - s.u[0]) / N;
        const dv = (s.v[1] - s.v[0]) / N;
        for (const f of gridFaces(N, (i, j) => s.at(s.u[0] + du * i, s.v[0] + dv * j), { step: 4 })) {
          items.push({ k: 'face', id, pts: f.pts, color: f.color, alpha, occludes: alpha >= 0.3, shade: true, stroke: darker(f.color, 0.55), edges: f.edges });
        }
        break;
      }
      case 'Curve3': {
        const c = v as space.Curve3;
        for (const run of curveRuns(c.at, c.lo, c.hi)) items.push(...loopLines(id, run, color, width, false));
        break;
      }
      case 'Liquid': {
        // drops in space (physics design 12, 12.1): one batch of discs a drop wide; the software painter's dots without
        // WebGL 2, drawn far to near among the faces
        if (!physics.isLiquidValue(v) || !v.zs) break;
        const n = Math.min(v.xs.length, v.ys.length, v.zs.length);
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          pos[i * 3] = v.xs[i] as number;
          pos[i * 3 + 1] = v.ys[i] as number;
          pos[i * 3 + 2] = v.zs[i] as number;
        }
        items.push({ k: 'drops', id, name: o.name, pos, count: n, color: v.spec.color ?? color, alpha: 0.85, radius: 0.6 * v.size });
        break;
      }
      case 'Smoke':
      case 'Fire': {
        // smoke or fire in space (physics design 9.8, 12.1): a volume for the WebGL 2 painter, slices for the software one
        if (!physics.isSmokeValue(v) || v.spec.space !== true) break;
        const s = v.spec;
        const fire = physics.isFireValue(v);
        items.push({
          k: 'volume', id, name: o.name, n: s.n, min: { x: s.x0, y: s.y0, z: s.z0 ?? 0 }, max: { x: s.x1, y: s.y1, z: s.z1 ?? 1 },
          density: v.density, ...(fire ? { temp: v.temp } : {}), heat: fire ? v.spec.fire.heat : 0, color: fire ? '#5f6670' : color,
        });
        break;
      }
      case 'Cloth':
        // cloth in space (physics design 12.1): a sheet for the WebGL 2 painter
        if (physics.isClothValue(v) && v.spec.space) items.push(...clothItems(id, o.name, v, color, Math.max(alpha, 0.85)));
        break;
      case 'Waves':
        // a wave surface in space: a lit sheet through the cell corners (physics design 12, 12.1)
        if (physics.isWavesValue(v) && v.space) items.push(...wavesItems(id, o.name, v, color, Math.max(alpha, 0.6)));
        break;
      case 'Water': {
        // still water in space: a translucent patch at its level, the size of the view (ui.md 7)
        if (!physics.isWaterValue(v)) break;
        const z = v.level;
        const pts = [{ x: C.x - L, y: C.y - L, z }, { x: C.x + L, y: C.y - L, z }, { x: C.x + L, y: C.y + L, z }, { x: C.x - L, y: C.y + L, z }];
        items.push({ k: 'face', id, pts, color, alpha: Math.min(alpha, 0.3), occludes: false, shade: true });
        items.push(...loopLines(id, pts, color, 1));
        break;
      }
      case 'Particles': {
        // particles in space (.kiro/specs/space-3d-surfaces R3.2): each a pure function of its index and the film time
        if (!isParticlesValue(v) || !v.space) break;
        const n = Math.min(v.spec.count, 20000);
        const batch = makeParticleBatch(n, true);
        const clock = figure.clock();
        v.program.evalCpu(clock.t, clock.bt, batch);
        const z = batch.z as Float32Array;
        for (let i = 0; i < n; i++) {
          const a = batch.alpha[i] as number;
          const sz = batch.size[i] as number;
          if (!(a > 0) || !(sz > 0)) continue;
          const p = { x: batch.x[i] as number, y: batch.y[i] as number, z: z[i] as number };
          if (!Number.isFinite(p.z)) continue;
          const c = batch.rgba[i] as number;
          const css = c === 0x000000ff ? color : `#${(c >>> 8).toString(16).padStart(6, '0')}`;
          items.push({ k: 'dot', id, p, color: css, alpha: a * ((c & 255) / 255 || 1), size: sz, px: v.spec.sizeIsPx });
        }
        break;
      }
      case 'Function': {
        // a function of two variables is the surface z = f(x, y) over the floor (.kiro/specs/space-3d-surfaces R1.1)
        const fn = v as { arity?: number; ret?: string; call(...xs: number[]): unknown };
        if (fn.arity !== 2 || fn.ret !== 'Number' || typeof fn.call !== 'function') break;
        const N = 40;
        // over the floor about the target, or over the clip box's floor (R2.3)
        const x0 = view.clip ? view.clipMin.x : C.x - L;
        const y0 = view.clip ? view.clipMin.y : C.y - L;
        const dx = view.clip ? (view.clipMax.x - view.clipMin.x) / N : (2 * L) / N;
        const dy = view.clip ? (view.clipMax.y - view.clipMin.y) / N : (2 * L) / N;
        const zMax = view.clip ? Infinity : 2 * L;
        const at = (i: number, j: number): V3 | undefined => {
          const x = x0 + dx * i;
          const y = y0 + dy * j;
          const z = fn.call(x, y);
          return typeof z === 'number' && Number.isFinite(z) ? { x, y, z } : undefined;
        };
        const keep = (p: V3): boolean => Math.abs(p.z - C.z) <= zMax;
        const a = Math.max(0.05, Math.min(1, o.style.opacity > 0 ? Math.max(o.style.opacity, 0.85) : 0.85));
        for (const f of gridFaces(N, at, { step: 5, keep })) {
          items.push({ k: 'face', id, pts: f.pts, color: f.color, alpha: a, occludes: true, shade: true, stroke: darker(f.color, 0.55), edges: f.edges });
        }
        break;
      }
      default:
        break;
    }
  }
  if (!view.clip) return { floor, items };
  // cut everything the figure holds to the box, and draw the box (design 8.7, ui.md 8)
  const box: Box3 = { min: view.clipMin, max: view.clipMax };
  const cut: Item3[] = [];
  for (const it of items) {
    // sheets and drops are cut by their painter: the GPU per pixel, the software one per face and dot
    if (it.k === 'label' || it.k === 'sheet' || it.k === 'drops' || it.k === 'volume' || it.id < 0) cut.push(it);
    else if (it.k === 'point' || it.k === 'dot') {
      if (inBox(box, it.p)) cut.push(it);
    } else if (it.k === 'line') {
      const seg = clipSegment(it.a, it.b, box);
      if (seg) cut.push({ ...it, a: seg[0], b: seg[1] });
    } else {
      const pts = clipFace(it.pts, box);
      if (!pts) continue;
      // a cut face keeps no grid sides: they no longer match its corners
      const whole = pts.length === it.pts.length && it.pts.every((p) => inBox(box, p));
      const { edges: _e, ...rest } = it;
      void _e;
      cut.push(whole ? it : { ...rest, pts });
    }
  }
  for (const [a, b] of boxEdges(box)) cut.push({ k: 'line', id: -1, a, b, color: '#a3abb8', width: 1, hiddenDashed: false });
  return { floor, items: cut };
}

/** The colour made a third darker, for edges. */
export function darker(hex: string, k = 0.66): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const c = (s: number): string => Math.round(((n >> s) & 255) * k).toString(16).padStart(2, '0');
  return `#${c(16)}${c(8)}${c(0)}`;
}

function sphereFaces(id: number, s: space.Sphere3, color: string, alpha: number): FaceItem[] {
  const out: FaceItem[] = [];
  const LAT = 12;
  const LON = 24;
  const at = (i: number, j: number): V3 => {
    const th = (Math.PI * i) / LAT;
    const ph = (2 * Math.PI * j) / LON;
    return add(s.c, scale({ x: Math.sin(th) * Math.cos(ph), y: Math.sin(th) * Math.sin(ph), z: Math.cos(th) }, s.r));
  };
  for (let i = 0; i < LAT; i++) {
    for (let j = 0; j < LON; j++) {
      const q = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      // the poles make triangles
      const pts = i === 0 ? [q[0] as V3, q[1] as V3, q[2] as V3] : i === LAT - 1 ? [q[0] as V3, q[1] as V3, q[3] as V3] : q;
      out.push({ k: 'face', id, pts, color, alpha, occludes: true, shade: true });
    }
  }
  return out;
}

/** Every `step`-th index of 0 … n − 1, and always the last, so a coarse grid keeps its edges. */
export function strideIndices(n: number, step: number): number[] {
  const s = Math.max(1, Math.floor(step));
  const out: number[] = [];
  for (let i = 0; i < n - 1; i += s) out.push(i);
  if (n > 0) out.push(n - 1);
  return out;
}

/**
 * A wave surface: the corners of its cells at the mean height of the cells round them, a sheet of (nx + 1) × (ny + 1)
 * points. The software painter draws a grid over 32 a side from every second corner (round 7), so it sorts at most
 * about a thousand faces; the rim is a loop of lines through the same corners.
 */
function wavesItems(id: number, name: string, w: physics.WavesValue, color: string, alpha: number): Item3[] {
  const { nx, ny, heights: h } = w;
  const step = Math.max(1, Math.ceil(Math.max(nx, ny) / 32));
  const NX = nx + 1;
  const NY = ny + 1;
  const pos = new Float32Array(NX * NY * 3);
  for (let cj = 0; cj < NY; cj++) {
    for (let ci = 0; ci < NX; ci++) {
      let s = 0;
      let k = 0;
      for (let j = cj - 1; j <= cj; j++) {
        if (j < 0 || j >= ny) continue;
        for (let i = ci - 1; i <= ci; i++) {
          if (i < 0 || i >= nx) continue;
          s += h[j * nx + i] as number;
          k++;
        }
      }
      const o = (cj * NX + ci) * 3;
      pos[o] = w.x0 + ci * w.dx;
      pos[o + 1] = w.y0 + cj * w.dy;
      pos[o + 2] = w.level + (k > 0 ? s / k : 0);
    }
  }
  const sheet: SheetItem = { k: 'sheet', id, name, nx: NX, ny: NY, pos, color, alpha, threads: 0, occludes: false, coarse: step, fine: step };
  const at = (i: number, j: number): V3 => {
    const o = (j * NX + i) * 3;
    return { x: pos[o] as number, y: pos[o + 1] as number, z: pos[o + 2] as number };
  };
  const is = strideIndices(NX, step);
  const js = strideIndices(NY, step);
  const last = (xs: number[]): number => xs[xs.length - 1] as number;
  // the rim of the surface, so its edge reads against the floor
  const rim: V3[] = [...is.map((i) => at(i, 0)), ...js.map((j) => at(last(is), j)), ...[...is].reverse().map((i) => at(i, last(js))), ...[...js].reverse().map((j) => at(0, j))];
  return [sheet, ...loopLines(id, rim, darker(color), 1)];
}

/**
 * The software painter's faces for a sheet, from every `step`-th point (and the last row and column), cut to the clip
 * box. A cloth's threads go on the faces' sides, darker, every `threads` points.
 */
export function sheetFaces(s: SheetItem, step: number, box?: Box3): FaceItem[] {
  const out: FaceItem[] = [];
  const is = strideIndices(s.nx, step);
  const js = strideIndices(s.ny, step);
  const at = (i: number, j: number): V3 => {
    const o = (j * s.nx + i) * 3;
    return { x: s.pos[o] as number, y: s.pos[o + 1] as number, z: s.pos[o + 2] as number };
  };
  const k = s.threads;
  const thread = (n: number): boolean => k > 0 && n % k === 0;
  const stroke = k > 0 ? darker(s.color, 0.55) : undefined;
  for (let b = 0; b + 1 < js.length; b++) {
    const j0 = js[b] as number;
    const j1 = js[b + 1] as number;
    for (let a = 0; a + 1 < is.length; a++) {
      const i0 = is[a] as number;
      const i1 = is[a + 1] as number;
      const pts = [at(i0, j0), at(i1, j0), at(i1, j1), at(i0, j1)];
      if (pts.some((p) => !Number.isFinite(p.x + p.y + p.z))) continue;
      const base: FaceItem = { k: 'face', id: s.id, pts, color: s.color, alpha: s.alpha, occludes: s.occludes, shade: true };
      if (box) {
        const cut = clipFace(pts, box);
        if (!cut) continue;
        if (cut.length !== 4 || !pts.every((p) => inBox(box, p))) {
          out.push({ ...base, pts: cut });
          continue;
        }
      }
      out.push(stroke ? { ...base, stroke, edges: [thread(j0), thread(i1), thread(j1), thread(i0)] } : base);
    }
  }
  return out;
}

/** Slices of a volume the software painter draws (physics design 12.1). */
export const VOLUME_SLICES = 12;

const FIRE_RGBA = new Float64Array(4);

/**
 * The software painter's faces for a volume: `VOLUME_SLICES` layers of cells across `axis` (0 x, 1 y, 2 z: the one that
 * faces the camera most), each cell with a cover over 0.02 a quad in the plane of its layer's middle. A flame cell has the
 * ramp's colour (`fireColor`, the plane's) and a cover made for the cells a slice stands for; smoke a grey quad over it.
 * Cut to the clip box by the quad's middle.
 */
export function volumeFaces(v: VolumeItem, axis: 0 | 1 | 2, box?: Box3): FaceItem[] {
  const n = v.n;
  const out: FaceItem[] = [];
  const slices = Math.min(VOLUME_SLICES, n);
  // a slice stands for this many cells of depth, so its cover is the cover of that many cells in a row
  const depth = n / slices;
  const d = { x: (v.max.x - v.min.x) / n, y: (v.max.y - v.min.y) / n, z: (v.max.z - v.min.z) / n };
  const c = FIRE_RGBA;
  const hex = (r: number, g: number, b: number): string => `#${[r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`;
  for (let s = 0; s < slices; s++) {
    const L = Math.min(n - 1, Math.floor(((s + 0.5) * n) / slices));
    for (let b = 0; b < n; b++) {
      for (let a = 0; a < n; a++) {
        // the cell at (a, b) of layer L, whichever axis the layers run along
        const i = axis === 0 ? L : a;
        const j = axis === 1 ? L : axis === 0 ? a : b;
        const k = axis === 2 ? L : b;
        const cell = (k * n + j) * n + i;
        const sm = Math.min(1, v.density[cell] as number);
        const t = v.temp ? Math.min(v.temp[cell] as number, v.heat) : 0;
        const x0 = v.min.x + i * d.x;
        const y0 = v.min.y + j * d.y;
        const z0 = v.min.z + k * d.z;
        const corner = (u: number, w: number): V3 => (axis === 0 ? { x: x0 + 0.5 * d.x, y: y0 + u * d.y, z: z0 + w * d.z } : axis === 1 ? { x: x0 + u * d.x, y: y0 + 0.5 * d.y, z: z0 + w * d.z } : { x: x0 + u * d.x, y: y0 + w * d.y, z: z0 + 0.5 * d.z });
        let pts: V3[] | undefined;
        const quad = (): V3[] => (pts ??= [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)]);
        if (box && !inBox(box, { x: x0 + 0.5 * d.x, y: y0 + 0.5 * d.y, z: z0 + 0.5 * d.z })) continue;
        if (v.temp) {
          fireColor(t, c);
          const cover = (c[3] as number) * (1 - 0.4 * sm);
          if (cover > 0.02) out.push({ k: 'face', id: v.id, pts: quad(), color: hex(c[0] as number, c[1] as number, c[2] as number), alpha: 1 - Math.pow(1 - cover, depth), occludes: false, shade: false, pick: false });
        }
        const sc = 0.85 * sm;
        if (sc > 0.02) out.push({ k: 'face', id: v.id, pts: quad(), color: v.color, alpha: 1 - Math.pow(1 - sc, depth), occludes: false, shade: false, pick: false });
      }
    }
  }
  return out;
}

/** The software painter's dots for a batch of drops: every `every`-th drop, cut to the clip box. */
export function dropDots(d: DropsItem, every: number, box?: Box3): DotItem[] {
  const out: DotItem[] = [];
  const s = Math.max(1, Math.floor(every));
  const n = Math.min(d.count, Math.floor(d.pos.length / 3));
  for (let i = 0; i < n; i += s) {
    const p = { x: d.pos[i * 3] as number, y: d.pos[i * 3 + 1] as number, z: d.pos[i * 3 + 2] as number };
    if (box && !inBox(box, p)) continue;
    out.push({ k: 'dot', id: d.id, p, color: d.color, alpha: d.alpha, size: d.radius, px: false });
  }
  return out;
}

/**
 * A cloth in space (physics design 12, 12.1): one sheet item for the WebGL 2 painter (the software painter's fallback
 * draws every second point, with `cloth_drawn_coarse` from the Space pane), its torn cells left out of the triangles,
 * faint threads every 8 points; its pins as small dark points.
 */
function clothItems(id: number, name: string, c: physics.ClothValue, color: string, alpha: number): Item3[] {
  const { nu, nv } = c.spec;
  const n = nu * nv;
  const pos = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    pos[k * 3] = c.xs[k] as number;
    pos[k * 3 + 1] = c.ys[k] as number;
    pos[k * 3 + 2] = c.zs[k] as number;
  }
  let tris: Uint32Array | undefined;
  if (c.torn > 0 && c.cut.length > 0) {
    // the faces that are whole: two a cell, split along (i, j)–(i + 1, j + 1) as the engine splits them
    const out: number[] = [];
    for (let j = 0; j + 1 < nv; j++) {
      for (let i = 0; i + 1 < nu; i++) {
        const t = 2 * (j * (nu - 1) + i);
        const a = j * nu + i;
        if (c.cut[t] !== 1) out.push(a, a + 1, a + nu + 1);
        if (c.cut[t + 1] !== 1) out.push(a, a + nu + 1, a + nu);
      }
    }
    tris = Uint32Array.from(out);
  }
  const sheet: SheetItem = { k: 'sheet', id, name, nx: nu, ny: nv, pos, ...(tris ? { tris, topology: c.torn } : {}), color, alpha, threads: 8, occludes: true, coarse: 2, fine: 1 };
  const out: Item3[] = [sheet];
  for (let k = 0; k + 2 < c.pinsAt.length; k += 3) out.push({ k: 'dot', id, p: { x: c.pinsAt[k] as number, y: c.pinsAt[k + 1] as number, z: c.pinsAt[k + 2] as number }, color: '#2b2f36', alpha: 1, size: 3, px: true });
  return out;
}

type WheelPose = { readonly x: number; readonly y: number; readonly z: number; readonly axle: V3; readonly spoke: V3 };

/** A wheel in space: a short dark cylinder about its axle, and four spokes on its outer side turned by its spin. */
function wheelItems(id: number, w: WheelPose, r: number, color: string): Item3[] {
  const c = { x: w.x, y: w.y, z: w.z };
  const half = Math.min(0.2, r * 0.3);
  const a = sub(c, scale(w.axle, half));
  const b = add(c, scale(w.axle, half));
  const out = roundFaces(id, { shape3: 'Cylinder', a, b, r } as unknown as space.Cylinder3, false, color, 1);
  const across = space.cross(w.axle, w.spoke);
  const hub = add(c, scale(w.axle, half * 1.05));
  const rim = '#c9ced6';
  for (const d of [w.spoke, across]) out.push({ k: 'line', id, a: add(hub, scale(d, -r * 0.9)), b: add(hub, scale(d, r * 0.9)), color: rim, width: 1.5, hiddenDashed: false });
  return out;
}

/** A joint in space, drawn thin (design 12): a ring for a hinge, a zigzag for a spring, a line for a rope or a rod, a cross for a weld. */
function jointItems(id: number, j: physics.JointValue3, color: string, width: number): Item3[] {
  const A = { x: j.ax, y: j.ay, z: j.az };
  const B = { x: j.bx, y: j.by, z: j.bz };
  const w = Math.max(1, width * 0.8);
  const c = j.broken ? '#b0b4ba' : color;
  if (j.kind === 'hinge') {
    const ax = unit(j.axis ? (j.axis as V3) : { x: 0, y: 0, z: 1 }) ?? { x: 0, y: 0, z: 1 };
    return loopLines(id, ring(frameOf(A, ax), 0.12, 16), c, w);
  }
  if (j.kind === 'weld') {
    const s = 0.12;
    return [{ x: s, y: 0, z: 0 }, { x: 0, y: s, z: 0 }, { x: 0, y: 0, z: s }].map((d) => ({ k: 'line' as const, id, a: sub(A, d), b: add(A, d), color: c, width: w, hiddenDashed: false }));
  }
  if (j.kind === 'spring') {
    const d = sub(B, A);
    const n = unit(d);
    if (!n) return [];
    const f = frameOf(A, n);
    const side = sub(fromFrame(f, 1, 0), A);
    const pts: V3[] = [A];
    const turns = 12;
    for (let i = 1; i < turns; i++) pts.push(add(add(A, scale(d, i / turns)), scale(side, i % 2 === 0 ? 0.12 : -0.12)));
    pts.push(B);
    return loopLines(id, pts, c, w, false);
  }
  return [{ k: 'line', id, a: A, b: B, color: c, width: w, hiddenDashed: false }];
}

function roundFaces(id: number, s: space.Cylinder3, cone: boolean, color: string, alpha: number): Item3[] {
  const axis = unit(sub(s.b, s.a)) as V3;
  const base = frameOf(s.a, axis);
  const N = 32;
  const lo = ring(base, s.r, N);
  const hi = cone ? [] : lo.map((p) => add(p, sub(s.b, s.a)));
  const out: Item3[] = [{ k: 'face', id, pts: [...lo].reverse(), color, alpha, occludes: true, shade: true }];
  for (let i = 0; i < N; i++) {
    const a = lo[i] as V3;
    const b = lo[(i + 1) % N] as V3;
    out.push({ k: 'face', id, pts: cone ? [a, b, s.b] : [a, b, hi[(i + 1) % N] as V3, hi[i] as V3], color, alpha, occludes: true, shade: true });
  }
  if (!cone) out.push({ k: 'face', id, pts: hi, color, alpha, occludes: true, shade: true });
  const edge = darker(color);
  out.push(...loopLines(id, lo, edge, 1));
  if (!cone) out.push(...loopLines(id, hi, edge, 1));
  return out;
}
