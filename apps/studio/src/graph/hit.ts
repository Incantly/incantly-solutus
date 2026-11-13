/**
 * Hit testing for tools (graphics-view 10, tools-2d 5.3): which objects are under the pointer, nearest first, in pixels.
 * Each shape finds its nearest point in maths space; the distance is measured on screen so a stretched view still feels
 * right. Interiors (polygons, sectors) count, but after edges and points.
 */
import type { Viewport } from './viewport';
import type { SceneItem } from './paint';

export interface ToolHit {
  readonly name: string;
  readonly type: string;
  readonly dist: number;
}

interface Pt {
  x: number;
  y: number;
}

const isPt = (v: unknown): v is Pt => typeof v === 'object' && v !== null && typeof (v as Pt).x === 'number' && typeof (v as Pt).y === 'number';

function nearestOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

function insidePolygon(p: Pt, pts: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i] as Pt;
    const b = pts[j] as Pt;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The point of a central conic in direction `theta` from its centre (arcs and sectors). */
export function conicRay(q: { A: number; B: number; C: number; D: number; E: number; F: number }, cx: number, cy: number, theta: number): Pt | undefined {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const a2 = q.A * c * c + q.B * c * s + q.C * s * s;
  const a1 = 2 * q.A * cx * c + q.B * (cx * s + cy * c) + 2 * q.C * cy * s + q.D * c + q.E * s;
  const a0 = q.A * cx * cx + q.B * cx * cy + q.C * cy * cy + q.D * cx + q.E * cy + q.F;
  const disc = a1 * a1 - 4 * a2 * a0;
  if (!(disc >= 0) || a2 === 0) return undefined;
  const t = (-a1 + Math.sqrt(disc)) / (2 * a2);
  return t > 0 ? { x: cx + t * c, y: cy + t * s } : undefined;
}

interface ArcLike {
  conic: { q: { A: number; B: number; C: number; D: number; E: number; F: number }; frame?: { cx?: number; cy?: number } };
  from: number;
  sweep: number;
}

/** Points along an arc value, for drawing and hit testing. */
export function arcPoints(a: ArcLike, n = 96): Pt[] {
  const f = a.conic.frame;
  if (!f || typeof f.cx !== 'number' || typeof f.cy !== 'number') return [];
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const p = conicRay(a.conic.q, f.cx, f.cy as number, a.from + (a.sweep * i) / n);
    if (p) out.push(p);
  }
  return out;
}

/** Objects within `slack` pixels of the pointer at (px, py), nearest first. */
export function hitTest(items: readonly SceneItem[], vp: Viewport, px: number, py: number, slack = 10): ToolHit[] {
  const at = { x: vp.x(px), y: vp.y(py) };
  const out: ToolHit[] = [];
  const screen = (p: Pt): number => Math.hypot(vp.px(p.x) - px, vp.py(p.y) - py);
  const push = (it: SceneItem, d: number, type = it.type === 'List' ? it.typeText : it.type): void => {
    if (d <= slack) out.push({ name: it.name, type, dist: d });
  };
  const edges = (pts: readonly Pt[], closed: boolean): number => {
    let best = Infinity;
    for (let i = 0; i + 1 < pts.length + (closed ? 1 : 0); i++) best = Math.min(best, screen(nearestOnSegment(at, pts[i] as Pt, pts[(i + 1) % pts.length] as Pt)));
    return best;
  };
  const one = (it: SceneItem, type: string, v: unknown): number => {
    switch (type) {
      case 'Point':
        return isPt(v) ? screen(v) : Infinity;
      case 'Segment': {
        const s = v as { a: Pt; b: Pt };
        return screen(nearestOnSegment(at, s.a, s.b));
      }
      case 'Vector':
        return isPt(v) ? screen(nearestOnSegment(at, { x: 0, y: 0 }, v)) : Infinity;
      case 'Line': {
        const l = v as { a: number; b: number; c: number };
        const n2 = l.a * l.a + l.b * l.b;
        if (!(n2 > 0)) return Infinity;
        const k = (l.a * at.x + l.b * at.y + l.c) / n2;
        return screen({ x: at.x - k * l.a, y: at.y - k * l.b });
      }
      case 'Ray': {
        const r = v as { from: Pt; dir: Pt };
        const d2 = r.dir.x * r.dir.x + r.dir.y * r.dir.y;
        const t = d2 > 0 ? Math.max(0, ((at.x - r.from.x) * r.dir.x + (at.y - r.from.y) * r.dir.y) / d2) : 0;
        return screen({ x: r.from.x + t * r.dir.x, y: r.from.y + t * r.dir.y });
      }
      case 'Circle': {
        const c = v as { cx: number; cy: number; r: number };
        const d = Math.hypot(at.x - c.cx, at.y - c.cy) || 1e-12;
        return screen({ x: c.cx + ((at.x - c.cx) / d) * c.r, y: c.cy + ((at.y - c.cy) / d) * c.r });
      }
      case 'Polygon': {
        const pts = (v as { pts: readonly Pt[] }).pts;
        const e = edges(pts, true);
        return e <= slack ? e : insidePolygon(at, pts) ? slack * 0.95 : Infinity;
      }
      case 'Polyline':
        return edges((v as { pts: readonly Pt[] }).pts, false);
      case 'Arc':
      case 'Sector': {
        const pts = arcPoints(v as ArcLike, 64);
        const f = (v as ArcLike).conic.frame as Pt & { cx: number; cy: number };
        const e = edges(pts, false);
        if (type === 'Arc' || e <= slack) return e;
        const centre = { x: f.cx, y: f.cy };
        return Math.min(edges([centre, pts[0] as Pt], false), edges([centre, pts[pts.length - 1] as Pt], false), insidePolygon(at, [centre, ...pts]) ? slack * 0.95 : Infinity);
      }
      case 'Conic': {
        const q = (v as { q?: { A: number; B: number; C: number; D: number; E: number; F: number } }).q;
        if (!q) return Infinity;
        const val = q.A * at.x * at.x + q.B * at.x * at.y + q.C * at.y * at.y + q.D * at.x + q.E * at.y + q.F;
        const gx = 2 * q.A * at.x + q.B * at.y + q.D;
        const gy = q.B * at.x + 2 * q.C * at.y + q.E;
        const g = Math.hypot(gx, gy);
        if (!(g > 0)) return Infinity;
        // one Newton step toward the curve, measured on screen
        return screen({ x: at.x - (val * gx) / (g * g), y: at.y - (val * gy) / (g * g) });
      }
      case 'Function': {
        const f = v as { arity?: number; call1?: (x: number) => number; call?: (x: number) => unknown };
        if (f.arity !== 1) return Infinity;
        const y = f.call1 ? f.call1(at.x) : (f.call?.(at.x) as number);
        return typeof y === 'number' && Number.isFinite(y) ? Math.abs(vp.py(y) - py) : Infinity;
      }
      default:
        return Infinity;
    }
  };
  for (const it of items) {
    const v = it.value;
    if (it.type === 'List') {
      const el = /^List<(\w+)/.exec(it.typeText)?.[1];
      if (!el || !Array.isArray(v)) continue;
      let best = Infinity;
      for (const x of v) best = Math.min(best, one(it, el, x));
      push(it, best);
      continue;
    }
    push(it, one(it, it.type, v));
  }
  // points first at equal distance, then by distance
  return out.sort((a, b) => a.dist - (a.type === 'Point' ? 3 : 0) - (b.dist - (b.type === 'Point' ? 3 : 0)));
}
