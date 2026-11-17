/**
 * The software painter of the Space view (docs/features/space-3d/design.md 8.5, 9.3, 9.5; .kiro/specs/space-3d R3.3):
 * faces sorted far to near and shaded by a key and a fill light fixed to the camera, then the lines (dashed and faint
 * where a solid is in front), then the points and labels. It draws on any canvas-2D-like context, so the screen, the
 * PNG and the SVG export make the same picture. The camera maths is the view package's.
 */
import { buildCamera, projectPoint, quatRotate } from '@incantly/view/camera';
import type { Camera, SpaceCameraProps } from '@incantly/view/camera';
import { space } from '@incantly/kernel';
import type { DotItem, FaceItem, Item3, LineItem, PointItem, Scene3 } from './scene3';

type V3 = space.V3;
type Ctx = Pick<CanvasRenderingContext2D, 'beginPath' | 'moveTo' | 'lineTo' | 'closePath' | 'fill' | 'stroke' | 'arc' | 'fillText' | 'strokeText' | 'setLineDash' | 'save' | 'restore' | 'fillRect'> & {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  lineJoin: CanvasLineJoin;
  lineCap: CanvasLineCap;
};

/** What a pointer can hit: a point, a line piece or a face, nearest the viewer last. */
export type Hit3 =
  | { readonly k: 'point'; readonly id: number; readonly name: string; readonly x: number; readonly y: number; readonly r: number; readonly depth: number; readonly free: boolean }
  | { readonly k: 'line'; readonly id: number; readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number; readonly depth: number }
  | { readonly k: 'face'; readonly id: number; readonly pts: readonly { x: number; y: number }[]; readonly depth: number; readonly alpha: number; readonly body?: string };

export interface Painted3 {
  readonly camera: Camera;
  readonly hits: readonly Hit3[];
}

/** The camera of a view at a size (design 8.2): zoom 1 fits a ball of `SPACE_FIT_RADIUS` about the target. */
export function cameraFor(view: space.View3, w: number, h: number): Camera {
  const props: SpaceCameraProps = {
    azimuth: view.azimuth, elevation: view.elevation, roll: view.roll, target: view.target, zoom: view.zoom,
    projection: view.projection, fov: view.fov, obliqueAngle: view.obliqueAngle, obliqueFactor: view.obliqueFactor,
    zUp: true, aspect: { x: 1, y: 1, z: 1 },
  };
  const R = space.SPACE_FIT_RADIUS;
  return buildCamera({ props, viewport: { w, h, dpr: 1 }, fitDist: R / Math.sin(view.fov / 2), fitRadius: R });
}

interface Proj { x: number; y: number; z: number; behind: boolean }

const KEY = norm({ x: -0.4, y: 0.6, z: 0.7 });
const FILL = norm({ x: 0.45, y: -0.35, z: 0.6 });

function norm(v: V3): V3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const shadeHex = (hex: string, k: number): string => {
  const [r, g, b] = rgb(hex);
  const c = (x: number): string => Math.max(0, Math.min(255, Math.round(x * k))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
};

interface FaceP {
  readonly item: FaceItem;
  readonly pts: Proj[];
  readonly depth: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** The depth of the face at a screen point, or `undefined` when the point is outside it (fan of triangles). */
function depthAt(f: FaceP, x: number, y: number): number | undefined {
  const p = f.pts;
  const a = p[0] as Proj;
  for (let i = 1; i + 1 < p.length; i++) {
    const b = p[i] as Proj;
    const c = p[i + 1] as Proj;
    const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / d;
    const l2 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / d;
    const l3 = 1 - l1 - l2;
    const e = -1e-6;
    if (l1 >= e && l2 >= e && l3 >= e) return l1 * a.z + l2 * b.z + l3 * c.z;
  }
  return undefined;
}

/** True when a solid face lies in front of this screen point and depth. */
function occluded(faces: readonly FaceP[], x: number, y: number, z: number, self: number): boolean {
  const eps = 2e-4;
  for (const f of faces) {
    if (x < f.minX || x > f.maxX || y < f.minY || y > f.maxY) continue;
    const d = depthAt(f, x, y);
    // a line on the face's own edge is not hidden by it
    if (d !== undefined && d < z - eps && !(f.item.id === self && z - d < 3e-3)) return true;
  }
  return false;
}

/** Paints a scene with a view, `w` by `h` CSS pixels, and returns the camera and the hit areas. */
export function paintSpace(ctx: Ctx, view: space.View3, w: number, h: number, scene: Scene3, opts: { background?: string | null } = {}): Painted3 {
  const cam = cameraFor(view, w, h);
  const P = (v: V3): Proj => {
    const q = projectPoint(cam, v);
    return { x: q.x, y: q.y, z: q.depth, behind: q.behind };
  };
  const hits: Hit3[] = [];
  if (opts.background !== null) {
    ctx.fillStyle = opts.background ?? '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const light = (n: V3): number => {
    if (view.light === 'flat') return 1;
    if (view.light === 'off') return 0.8;
    let c = quatRotate(cam.q, n);
    let k = 1;
    // the back of a face is shaded as its other side, a little darker (design 8.5)
    if (c.z < 0) {
      c = { x: -c.x, y: -c.y, z: -c.z };
      k = 0.85;
    }
    const d = Math.max(0, c.x * KEY.x + c.y * KEY.y + c.z * KEY.z);
    const f = Math.max(0, c.x * FILL.x + c.y * FILL.y + c.z * FILL.z);
    return k * (0.45 + 0.55 * d + 0.18 * f);
  };

  const project = (items: readonly Item3[]): { faces: FaceP[]; lines: LineItem[]; points: PointItem[]; labels: Item3[]; dots: DotItem[] } => {
    const faces: FaceP[] = [];
    const lines: LineItem[] = [];
    const points: PointItem[] = [];
    const labels: Item3[] = [];
    const dots: DotItem[] = [];
    for (const it of items) {
      if (it.k === 'face') {
        const pts = it.pts.map(P);
        if (pts.some((p) => p.behind)) continue;
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        faces.push({ item: it, pts, depth: pts.reduce((s, p) => s + p.z, 0) / pts.length, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) });
      } else if (it.k === 'line') lines.push(it);
      else if (it.k === 'point') points.push(it);
      else if (it.k === 'dot') dots.push(it);
      else labels.push(it);
    }
    return { faces, lines, points, labels, dots };
  };

  const drawFace = (f: FaceP): void => {
    const it = f.item;
    const n = space.unit(space.newell(it.pts)) ?? { x: 0, y: 0, z: 1 };
    ctx.globalAlpha = it.alpha;
    ctx.fillStyle = it.shade ? shadeHex(it.color, light(n)) : it.color;
    ctx.beginPath();
    f.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
    if (it.stroke && it.edges) {
      // the face's grid lines go with it, so the faces in front cover the ones behind
      ctx.globalAlpha = Math.min(1, it.alpha + 0.1);
      ctx.strokeStyle = it.stroke;
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      for (let s = 0; s < 4; s++) {
        if (!it.edges[s]) continue;
        const a = f.pts[s] as Proj;
        const b = f.pts[(s + 1) % f.pts.length] as Proj;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  const drawLine = (l: LineItem, occluders: readonly FaceP[]): void => {
    const a = P(l.a);
    const b = P(l.b);
    if (a.behind || b.behind) return;
    ctx.strokeStyle = l.color;
    ctx.lineWidth = l.width;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const pieces = l.hiddenDashed && occluders.length > 0 ? Math.max(1, Math.min(24, Math.ceil(len / 12))) : 1;
    if (l.dotted) {
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    // run the pieces in groups of the same visibility, so a line is a few strokes
    let start = 0;
    let wasHidden: boolean | undefined;
    const flush = (end: number, hidden: boolean): void => {
      const t0 = start / pieces;
      const t1 = end / pieces;
      ctx.globalAlpha = hidden ? 0.4 : 1;
      ctx.setLineDash(hidden ? [4, 4] : []);
      ctx.beginPath();
      ctx.moveTo(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0);
      ctx.lineTo(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1);
      ctx.stroke();
    };
    for (let i = 0; i < pieces; i++) {
      const t = (i + 0.5) / pieces;
      const hidden = pieces > 1 && occluded(occluders, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t, l.id);
      if (wasHidden !== undefined && hidden !== wasHidden) {
        flush(i, wasHidden);
        start = i;
      }
      wasHidden = hidden;
    }
    flush(pieces, wasHidden ?? false);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    if (l.arrow && len > 6) {
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      const s = 4 + l.width * 2;
      ctx.fillStyle = l.color;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - ux * s * 1.6 - uy * s * 0.6, b.y - uy * s * 1.6 + ux * s * 0.6);
      ctx.lineTo(b.x - ux * s * 1.6 + uy * s * 0.6, b.y - uy * s * 1.6 - ux * s * 0.6);
      ctx.closePath();
      ctx.fill();
    }
    hits.push({ k: 'line', id: l.id, x0: a.x, y0: a.y, x1: b.x, y1: b.y, depth: Math.min(a.z, b.z) });
  };

  const label = (text: string, x: number, y: number, color: string, size: number, align: CanvasTextAlign = 'left'): void => {
    ctx.font = `${size}px Inter, "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };

  /* 1. the floor and grid, under everything */
  const fl = project(scene.floor);
  for (const f of fl.faces) drawFace(f);
  for (const l of fl.lines) drawLine(l, []);

  /* 2. faces far to near; 3. lines; 4. points; 5. labels */
  const sc = project(scene.items);
  const sorted = [...sc.faces].sort((x, y) => y.depth - x.depth);
  for (const f of sorted) {
    drawFace(f);
    hits.push({ k: 'face', id: f.item.id, pts: f.pts.map((p) => ({ x: p.x, y: p.y })), depth: f.depth, alpha: f.item.alpha, ...(f.item.body !== undefined ? { body: f.item.body } : {}) });
  }
  const occluders = sc.faces.filter((f) => f.item.occludes);
  for (const l of sc.lines) drawLine(l, occluders);
  // particles: far ones first, so near ones cover them
  if (sc.dots.length > 0) {
    const ds = sc.dots.map((d) => ({ d, q: P(d.p) })).filter((x) => !x.q.behind).sort((a, b) => b.q.z - a.q.z);
    for (const { d, q } of ds) {
      const r = Math.max(0.6, d.px ? d.size : d.size * cam.scale);
      ctx.globalAlpha = d.alpha;
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  for (const p of sc.points) {
    const q = P(p.p);
    if (q.behind) continue;
    const hidden = occluded(occluders, q.x, q.y, q.z, p.id);
    const r = p.size;
    ctx.globalAlpha = hidden ? 0.4 : 1;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
    ctx.fill();
    // a small highlight makes the dot read as a ball (ui.md 7)
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = hidden ? 0.25 : 0.55;
    ctx.beginPath();
    ctx.arc(q.x - r * 0.35, q.y - r * 0.35, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (p.label) label(p.name, q.x + r + 3, q.y - r - 4, p.color, 13);
    hits.push({ k: 'point', id: p.id, name: p.name, x: q.x, y: q.y, r: Math.max(r + 4, 8), depth: q.z, free: p.free });
  }
  for (const it of sc.labels) {
    if (it.k !== 'label') continue;
    const q = P(it.at);
    if (!q.behind) label(it.text, q.x, q.y, it.color, it.size, 'center');
  }
  // nearest last, as the 2D painter does
  hits.sort((a, b) => b.depth - a.depth);
  return { camera: cam, hits };
}
