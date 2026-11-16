/**
 * The scene of the Space view (docs/features/space-3d/design.md 9.2, ui.md 7; .kiro/specs/space-3d R3.3): kernel
 * objects to points, line pieces and flat faces in space, with their colours. Pure: no DOM, so the screen, the export
 * and the tests share it.
 */
import { colorHex, space } from '@incantly/kernel';
import type { Figure } from '@incantly/kernel';

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
}

export interface LabelItem {
  readonly k: 'label';
  readonly at: V3;
  readonly text: string;
  readonly color: string;
  readonly size: number;
}

export type Item3 = PointItem | LineItem | FaceItem | LabelItem;

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
      default:
        break;
    }
  }
  return { floor, items };
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
