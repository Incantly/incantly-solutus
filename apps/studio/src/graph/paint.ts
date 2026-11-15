/**
 * Paints the figure on a 2D canvas: the grid and axes, then each object by its type. Curves of functions and relations
 * come from `@incantly/plot`; charts are drawn from the numbers in their records (statistics ui.md 2.2). While painting
 * it collects hit areas, so the pane can show tooltips and drag free points.
 */
import { plotFunction, traceImplicit, fillRegion } from '@incantly/plot';
import { arcPoints } from './hit';
import { math } from '@incantly/view';
import type { MathItem, MathLayout } from '@incantly/view';
import { canvasMeasure, drawMath } from './mathdraw';
import { isParticlesValue, makeParticleBatch } from '@incantly/kernel';
import type { FunctionValue, ParticleBatchPlain, ParticlesValue } from '@incantly/kernel';
import { gridStep, tickText } from './viewport';
import type { Viewport } from './viewport';

/** One object to draw. */
export interface SceneItem {
  readonly id: number;
  readonly name: string;
  /** The base type (`Point`, `Chart`, `Record`, `List` …). */
  readonly type: string;
  /** The full type text (`List<Point>`, `Chart<Histogram>`, `Record<Fit>`). */
  readonly typeText: string;
  readonly value: unknown;
  readonly color: string;
  readonly free: boolean;
  /** Draw the name next to points. */
  readonly label: boolean;
  /** Drawn faintly: a tool's preview, or a hidden object while the show/hide tool is on. */
  readonly ghost?: boolean;
  /** Selected in the list or on the canvas: drawn with a glow (algebra-view design 3.9). */
  readonly selected?: boolean;
  /** The pointer is over its row or over it. */
  readonly hovered?: boolean;
  /** The clock now, for particle systems (animation-time design 10). */
  readonly time?: number;
  /** A point's trace as packed `x, y` pairs; `NaN` pairs break the line (design 6). */
  readonly trace?: Float64Array;
  /** A Text placed on the graph (`with at = …`, text-logic design 2.1 and 7). */
  readonly text?: { readonly at: Pt; readonly size: number; readonly anchor: string; readonly rotate: number; readonly bg?: string; readonly vertical?: boolean; readonly full?: boolean };
}

/** A place on the canvas the pointer can hover or drag. Coordinates in CSS pixels. */
export type Hit =
  | { readonly k: 'circle'; readonly x: number; readonly y: number; readonly r: number; readonly text: string; readonly id: number; readonly drag?: string }
  | { readonly k: 'rect'; readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number; readonly text: string; readonly id: number }
  | { readonly k: 'wedge'; readonly x: number; readonly y: number; readonly r: number; readonly a0: number; readonly a1: number; readonly text: string; readonly id: number };

/** The colour-blind safe palette of statistics ui.md 2.2, in its fixed order. */
export const PALETTE = ['#2f6fdb', '#e07b1a', '#2a9d6f', '#7b52c6', '#cc4c8c', '#6b7280', '#c9a227', '#1498b3'] as const;

export const colorAt = (i: number): string => PALETTE[i % PALETTE.length] as string;

const fmt = (x: number): string => {
  if (!Number.isFinite(x)) return String(x);
  const a = Math.abs(x);
  if (a !== 0 && (a >= 1e6 || a < 1e-4)) return x.toExponential(3);
  return String(Number(x.toPrecision(4)));
};

function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

type Ctx = CanvasRenderingContext2D;
type Rec = { readonly schema: string; readonly fields: Readonly<Record<string, unknown>> };
type Pt = { readonly x: number; readonly y: number };

const isPt = (v: unknown): v is Pt => typeof (v as Pt | undefined)?.x === 'number' && typeof (v as Pt).y === 'number';
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && (v as { kind?: unknown }).kind === 'record';
const isFn = (v: unknown): v is FunctionValue => typeof v === 'object' && v !== null && typeof (v as FunctionValue).call === 'function' && typeof (v as FunctionValue).arity === 'number';
const nums = (v: unknown): number[] => (v instanceof Float64Array ? Array.from(v) : Array.isArray(v) ? (v as number[]) : []);

export const FONT = '13px Inter, "Segoe UI", system-ui, -apple-system, sans-serif';
const SMALL = '12px Inter, "Segoe UI", system-ui, -apple-system, sans-serif';
const MONO = '13px "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace';

/* ------------------------------ grid ------------------------------ */

export function paintGrid(ctx: Ctx, vp: Viewport): void {
  const { w, h } = vp;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  const gx = gridStep(vp.ppu);
  const gy = gridStep(vp.ppuY);
  const major = gx.major;
  const majorY = gy.major;
  const b = vp.box();
  const lines = (step: number, stepY: number, color: string, width: number): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let x = Math.ceil(b.x0 / step) * step; x <= b.x1; x += step) {
      const px = Math.round(vp.px(x)) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
    }
    for (let y = Math.ceil(b.y0 / stepY) * stepY; y <= b.y1; y += stepY) {
      const py = Math.round(vp.py(y)) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
    }
    ctx.stroke();
  };
  lines(gx.minor, gy.minor, '#f0f2f5', 1);
  lines(major, majorY, '#d8dde4', 1);
  // axes
  const ax = vp.px(0);
  const ay = vp.py(0);
  ctx.strokeStyle = '#2b2f36';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  if (ax >= 0 && ax <= w) {
    ctx.moveTo(Math.round(ax) + 0.5, 0);
    ctx.lineTo(Math.round(ax) + 0.5, h);
  }
  if (ay >= 0 && ay <= h) {
    ctx.moveTo(0, Math.round(ay) + 0.5);
    ctx.lineTo(w, Math.round(ay) + 0.5);
  }
  ctx.stroke();
  // tick labels, pinned to the edges when an axis is off screen
  ctx.font = SMALL;
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.fillStyle = '#525a66';
  const labelY = Math.min(h - 6, Math.max(14, ay + 16));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (let x = Math.ceil(b.x0 / major) * major; x <= b.x1; x += major) {
    if (Math.abs(x) < major * 1e-9) continue;
    const t = tickText(x, major);
    ctx.strokeText(t, vp.px(x), labelY);
    ctx.fillText(t, vp.px(x), labelY);
  }
  const leftPinned = ax < 30;
  const rightPinned = ax > w - 10;
  ctx.textAlign = leftPinned ? 'left' : 'right';
  ctx.textBaseline = 'middle';
  const labelX = leftPinned ? 6 : rightPinned ? w - 6 : ax - 6;
  for (let y = Math.ceil(b.y0 / majorY) * majorY; y <= b.y1; y += majorY) {
    if (Math.abs(y) < majorY * 1e-9) continue;
    const t = tickText(y, majorY);
    ctx.strokeText(t, labelX, vp.py(y));
    ctx.fillText(t, labelX, vp.py(y));
  }
  if (ax >= 0 && ax <= w && ay >= 0 && ay <= h) {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.strokeText('0', ax - 5, ay + 4);
    ctx.fillText('0', ax - 5, ay + 4);
  }
}

/* ------------------------------ helpers ------------------------------ */

function polyline(ctx: Ctx, path: ArrayLike<number>): void {
  ctx.beginPath();
  for (let i = 0; i + 1 < path.length; i += 2) {
    const x = path[i] as number;
    const y = path[i + 1] as number;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

function dot(ctx: Ctx, x: number, y: number, r: number, color: string, ring = true): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  if (ring) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }
}

function label(ctx: Ctx, text: string, x: number, y: number, color: string, align: CanvasTextAlign = 'left'): void {
  ctx.font = FONT;
  ctx.textAlign = align;
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** Samples y = g(x) over [a, b] clipped to the view, broken where g is undefined. */
function sampleCurve(vp: Viewport, g: (x: number) => number, a: number, b: number, n = 600): Float64Array[] {
  const box = vp.box();
  const lo = Math.max(a, box.x0);
  const hi = Math.min(b, box.x1);
  const out: Float64Array[] = [];
  if (!(hi > lo)) return out;
  let cur: number[] = [];
  for (let i = 0; i <= n; i++) {
    const x = lo + ((hi - lo) * i) / n;
    const y = g(x);
    const py = vp.py(y);
    if (!Number.isFinite(y) || Math.abs(py) > 1e6) {
      if (cur.length >= 4) out.push(Float64Array.from(cur));
      cur = [];
      continue;
    }
    cur.push(vp.px(x), py);
  }
  if (cur.length >= 4) out.push(Float64Array.from(cur));
  return out;
}

function stroke(ctx: Ctx, paths: readonly ArrayLike<number>[], color: string, width = 2.5, dash: number[] = []): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash(dash);
  for (const p of paths) {
    polyline(ctx, p);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

const viewBox = (vp: Viewport) => {
  const b = vp.box();
  return { x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, widthPx: Math.round(vp.w), heightPx: Math.round(vp.h) };
};

/** The pixel paths of a plot result (maths y up is already pixel y down in the plot package). */
const okPaths = (r: { ok: boolean; value?: { paths: readonly Float64Array[] } }): readonly Float64Array[] => (r.ok && r.value ? r.value.paths : []);

const valueAt = (f: FunctionValue, x: number): number => (f.call1 ? f.call1(x) : (f.call(x) as number));

/** A mass function: a stem and a dot at each whole number (probability design 8). */
function paintLattice(ctx: Ctx, vp: Viewport, f: FunctionValue, c: string): void {
  const box = vp.box();
  const step = Math.max(1, Math.ceil((box.x1 - box.x0) / 400));
  for (let k = Math.ceil(box.x0 / step) * step; k <= box.x1; k += step) {
    const p = valueAt(f, k);
    if (!(p > 0)) continue;
    stroke(ctx, [[vp.px(k), vp.py(0), vp.px(k), vp.py(p)]], c, 2);
    dot(ctx, vp.px(k), vp.py(p), 3.5, c, false);
  }
}

/** A right-continuous step function of whole numbers: a flat piece per step, filled dot on the left, open on the right. */
function paintSteps(ctx: Ctx, vp: Viewport, f: FunctionValue, c: string): void {
  const box = vp.box();
  if (box.x1 - box.x0 > 400) {
    plotFn(ctx, vp, f, c);
    return;
  }
  for (let k = Math.floor(box.x0); k <= box.x1; k++) {
    const y = valueAt(f, k);
    if (!Number.isFinite(y)) continue;
    stroke(ctx, [[vp.px(k), vp.py(y), vp.px(k + 1), vp.py(y)]], c, 2.5);
    dot(ctx, vp.px(k), vp.py(y), 3.5, c, false);
    ctx.beginPath();
    ctx.arc(vp.px(k + 1), vp.py(y), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = c;
    ctx.stroke();
  }
}

function plotFn(ctx: Ctx, vp: Viewport, f: FunctionValue, color: string): void {
  const r = plotFunction(f, viewBox(vp)) as unknown as { ok: boolean; value?: { paths: readonly Float64Array[] } };
  stroke(ctx, okPaths(r), color);
}

/* ------------------------------ objects ------------------------------ */

export function paintItem(ctx: Ctx, vp: Viewport, it: SceneItem, hits: Hit[]): void {
  const v = it.value;
  const c = it.color;
  if (v === undefined || v === null) return;
  switch (it.type) {
    case 'Point': {
      if (!isPt(v)) return;
      const x = vp.px(v.x);
      const y = vp.py(v.y);
      if (it.free) {
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fillStyle = alpha(c, 0.18);
        ctx.fill();
      }
      dot(ctx, x, y, 4.5, c);
      if (it.label) label(ctx, it.name, x + 8, y - 6, c);
      hits.push({ k: 'circle', x, y, r: it.free ? 12 : 8, text: `${it.name} = (${fmt(v.x)}, ${fmt(v.y)})`, id: it.id, ...(it.free ? { drag: it.name } : {}) });
      return;
    }
    case 'Vector': {
      if (!isPt(v)) return;
      arrow(ctx, vp.px(0), vp.py(0), vp.px(v.x), vp.py(v.y), c);
      return;
    }
    case 'Segment': {
      const s = v as { a: Pt; b: Pt };
      stroke(ctx, [[vp.px(s.a.x), vp.py(s.a.y), vp.px(s.b.x), vp.py(s.b.y)]], c);
      return;
    }
    case 'Line': {
      const l = v as { a: number; b: number; c: number };
      paintLine(ctx, vp, l.a, l.b, l.c, c);
      return;
    }
    case 'Ray': {
      const r = v as { from: Pt; dir: Pt };
      const len = Math.hypot(r.dir.x, r.dir.y) || 1;
      const far = (vp.w + vp.h) / vp.ppu * 2 + Math.hypot(r.from.x - vp.cx, r.from.y - vp.cy);
      stroke(ctx, [[vp.px(r.from.x), vp.py(r.from.y), vp.px(r.from.x + (r.dir.x / len) * far), vp.py(r.from.y + (r.dir.y / len) * far)]], c);
      return;
    }
    case 'Circle': {
      const o = v as { cx: number; cy: number; r: number };
      ctx.beginPath();
      ctx.ellipse(vp.px(o.cx), vp.py(o.cy), o.r * vp.ppu, o.r * vp.ppuY, 0, 0, Math.PI * 2);
      ctx.fillStyle = alpha(c, 0.06);
      ctx.fill();
      ctx.strokeStyle = c;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      return;
    }
    case 'Arc':
    case 'Sector': {
      const pts = arcPoints(v as Parameters<typeof arcPoints>[0]);
      if (pts.length < 2) return;
      const f = (v as { conic: { frame: { cx: number; cy: number } } }).conic.frame;
      const ring = it.type === 'Sector' ? [{ x: f.cx, y: f.cy }, ...pts] : pts;
      ctx.beginPath();
      ring.forEach((p, i) => (i === 0 ? ctx.moveTo(vp.px(p.x), vp.py(p.y)) : ctx.lineTo(vp.px(p.x), vp.py(p.y))));
      if (it.type === 'Sector') {
        ctx.closePath();
        ctx.fillStyle = alpha(c, 0.18);
        ctx.fill();
      }
      ctx.strokeStyle = c;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      return;
    }
    case 'Conic': {
      const q = (v as { q?: { A: number; B: number; C: number; D: number; E: number; F: number } }).q;
      if (!q) return;
      const r = traceImplicit({ residual: (x: number, y: number) => q.A * x * x + q.B * x * y + q.C * y * y + q.D * x + q.E * y + q.F }, viewBox(vp)) as unknown as { ok: boolean; value?: { paths: readonly Float64Array[] } };
      stroke(ctx, okPaths(r), c, 2.5);
      return;
    }
    case 'Polyline': {
      const pts = (v as { pts: readonly Pt[] }).pts;
      stroke(ctx, [pts.flatMap((p) => [vp.px(p.x), vp.py(p.y)])], c, 2.5);
      return;
    }
    case 'Polygon': {
      polygon(ctx, vp, (v as { pts: readonly Pt[] }).pts, c, 0.18);
      return;
    }
    case 'Function': {
      if (!isFn(v) || v.arity !== 1 || v.ret !== 'Number') return;
      const flags = v as unknown as { lattice?: boolean; step?: boolean };
      if (flags.lattice) paintLattice(ctx, vp, v, c);
      else if (flags.step) paintSteps(ctx, vp, v, c);
      else plotFn(ctx, vp, v, c);
      return;
    }
    case 'Curve':
    case 'Relation':
    case 'Region':
      paintCurveLike(ctx, vp, v, c);
      return;
    case 'Field':
      paintField(ctx, vp, v as { slope: (x: number, y: number) => number; n: number }, c);
      return;
    case 'List':
      paintList(ctx, vp, it, hits);
      return;
    case 'Chart':
      paintChart(ctx, vp, it, hits);
      return;
    case 'Record':
      if (isRec(v) && v.schema === 'Fit') paintFit(ctx, vp, v, c);
      return;
    case 'ContinuousDistribution':
    case 'DiscreteDistribution':
      paintDist(ctx, vp, v as { spec: { discrete: boolean; pdf: (p: readonly number[], x: number) => number }; params: readonly number[] }, c);
      return;
    default:
      return;
  }
}

function arrow(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, c: string): void {
  stroke(ctx, [[x0, y0, x1, y1]], c);
  const a = Math.atan2(y1 - y0, x1 - x0);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - 11 * Math.cos(a - 0.4), y1 - 11 * Math.sin(a - 0.4));
  ctx.lineTo(x1 - 11 * Math.cos(a + 0.4), y1 - 11 * Math.sin(a + 0.4));
  ctx.closePath();
  ctx.fillStyle = c;
  ctx.fill();
}

/** `a x + b y = c` across the view. */
function paintLine(ctx: Ctx, vp: Viewport, a: number, b: number, cc: number, color: string): void {
  const box = vp.box();
  let pts: number[];
  if (Math.abs(b) > Math.abs(a)) pts = [box.x0, (cc - a * box.x0) / b, box.x1, (cc - a * box.x1) / b];
  else if (a !== 0) pts = [(cc - b * box.y0) / a, box.y0, (cc - b * box.y1) / a, box.y1];
  else return;
  stroke(ctx, [[vp.px(pts[0] as number), vp.py(pts[1] as number), vp.px(pts[2] as number), vp.py(pts[3] as number)]], color);
}

function polygon(ctx: Ctx, vp: Viewport, pts: readonly Pt[], c: string, fill: number, width = 2): void {
  if (pts.length < 2) return;
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(vp.px(p.x), vp.py(p.y)) : ctx.lineTo(vp.px(p.x), vp.py(p.y))));
  ctx.closePath();
  ctx.fillStyle = alpha(c, fill);
  ctx.fill();
  ctx.strokeStyle = c;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function paintCurveLike(ctx: Ctx, vp: Viewport, v: unknown, c: string): void {
  const o = v as Record<string, unknown>;
  // a relation in x and y: an equation is traced, an inequality filled
  if (typeof o['residual'] === 'function' && Array.isArray(o['ops'])) {
    const ops = o['ops'] as string[];
    if (ops.some((op) => op !== '==')) {
      const r = fillRegion({ test: o['test'] as (x: number, y: number) => boolean | undefined }, viewBox(vp)) as unknown as { ok: boolean; value?: { rects: Float64Array; polygons: readonly Float64Array[] } };
      if (r.ok && r.value) {
        ctx.fillStyle = alpha(c, 0.22);
        const rects = r.value.rects;
        for (let i = 0; i + 3 < rects.length; i += 4) ctx.fillRect(rects[i] as number, rects[i + 1] as number, (rects[i + 2] as number) - (rects[i] as number), (rects[i + 3] as number) - (rects[i + 1] as number));
        for (const p of r.value.polygons) {
          polyline(ctx, p);
          ctx.closePath();
          ctx.fill();
        }
      }
      return;
    }
    const r = traceImplicit({ residual: o['residual'] as (x: number, y: number) => number }, viewBox(vp)) as unknown as { ok: boolean; value?: { paths: readonly Float64Array[] } };
    stroke(ctx, okPaths(r), c);
    return;
  }
  if (o['kind'] === 'curve') {
    if (o['curve'] === 'implicit') {
      const f = o['f'] as (x: number, y: number) => number;
      const level = (o['level'] as number) ?? 0;
      const r = traceImplicit({ residual: f, level }, viewBox(vp)) as unknown as { ok: boolean; value?: { paths: readonly Float64Array[] } };
      stroke(ctx, okPaths(r), c);
      return;
    }
    if (o['curve'] === 'param') {
      const fx = o['fx'] as (s: number) => number;
      const fy = o['fy'] as (s: number) => number;
      const lo = o['lo'] as number;
      const hi = o['hi'] as number;
      const n = 800;
      const path: number[] = [];
      const out: number[][] = [];
      for (let i = 0; i <= n; i++) {
        const s = lo + ((hi - lo) * i) / n;
        const x = fx(s);
        const y = fy(s);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          if (path.length >= 4) out.push(path.splice(0));
          path.length = 0;
          continue;
        }
        path.push(vp.px(x), vp.py(y));
      }
      if (path.length >= 4) out.push(path);
      stroke(ctx, out, c);
      return;
    }
    if (o['curve'] === 'sampled') {
      const pieces = o['pieces'] as readonly Float64Array[];
      stroke(ctx, pieces.map((p) => Array.from(p, (q, i) => (i % 2 === 0 ? vp.px(q) : vp.py(q)))), c);
      return;
    }
    if (o['curve'] === 'piecewise') {
      const pieces = o['pieces'] as readonly { s0: number; s1: number; cx: Float64Array; cy: Float64Array }[];
      const horner = (cf: Float64Array, s: number): number => {
        let r = 0;
        for (let i = cf.length - 1; i >= 0; i--) r = r * s + (cf[i] as number);
        return r;
      };
      stroke(ctx, pieces.map((pc) => {
        const out: number[] = [];
        for (let i = 0; i <= 40; i++) {
          const s = pc.s0 + ((pc.s1 - pc.s0) * i) / 40;
          out.push(vp.px(horner(pc.cx, s - pc.s0)), vp.py(horner(pc.cy, s - pc.s0)));
        }
        return out;
      }), c);
    }
    return;
  }
  if (o['kind'] === 'region') {
    const shape = o['shape'] as { t: string; a: number; b: number; n?: number; rule?: string; offset?: number };
    const f = o['f'] as (x: number) => number;
    const g = (o['g'] as ((x: number) => number) | null) ?? (() => 0);
    const box = vp.box();
    if (shape.t === 'tails') {
      // left of a and right of b (ShadeTails)
      ctx.fillStyle = alpha(c, 0.32);
      fillBetween(ctx, vp, f, g, box.x0 - 1, Math.min(shape.a, box.x1 + 1));
      fillBetween(ctx, vp, f, g, Math.max(shape.b, box.x0 - 1), box.x1 + 1);
      return;
    }
    const a = Math.max(shape.a, box.x0 - 1);
    const b = Math.min(shape.b, box.x1 + 1);
    if (!(b > a)) return;
    ctx.fillStyle = alpha(c, 0.28);
    if (shape.t === 'bars' && shape.n) {
      const w = (shape.b - shape.a) / shape.n;
      for (let i = 0; i < shape.n; i++) {
        const x0 = shape.a + i * w;
        const at = shape.rule === 'left' ? x0 : shape.rule === 'right' ? x0 + w : x0 + w / 2;
        const y = f(at);
        if (!Number.isFinite(y)) continue;
        const px0 = vp.px(x0);
        const px1 = vp.px(x0 + w);
        ctx.fillRect(px0, Math.min(vp.py(0), vp.py(y)), px1 - px0, Math.abs(vp.py(y) - vp.py(0)));
        ctx.strokeStyle = c;
        ctx.lineWidth = 1;
        ctx.strokeRect(px0, Math.min(vp.py(0), vp.py(y)), px1 - px0, Math.abs(vp.py(y) - vp.py(0)));
      }
      return;
    }
    const n = 400;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i <= n; i++) {
      const x = a + ((b - a) * i) / n;
      const y = f(x);
      if (!Number.isFinite(y)) continue;
      if (!started) {
        ctx.moveTo(vp.px(x), vp.py(y));
        started = true;
      } else ctx.lineTo(vp.px(x), vp.py(y));
    }
    for (let i = n; i >= 0; i--) {
      const x = a + ((b - a) * i) / n;
      const y = g(x);
      if (Number.isFinite(y)) ctx.lineTo(vp.px(x), vp.py(y));
    }
    ctx.closePath();
    ctx.fill();
  }
}

/** Fills between f and g from a to b with the current fill style. */
function fillBetween(ctx: Ctx, vp: Viewport, f: (x: number) => number, g: (x: number) => number, a: number, b: number): void {
  if (!(b > a)) return;
  const n = 300;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i <= n; i++) {
    const x = a + ((b - a) * i) / n;
    const y = f(x);
    if (!Number.isFinite(y)) continue;
    if (!started) {
      ctx.moveTo(vp.px(x), vp.py(y));
      started = true;
    } else ctx.lineTo(vp.px(x), vp.py(y));
  }
  for (let i = n; i >= 0; i--) {
    const x = a + ((b - a) * i) / n;
    const y = g(x);
    if (Number.isFinite(y)) ctx.lineTo(vp.px(x), vp.py(y));
  }
  ctx.closePath();
  ctx.fill();
}

function paintField(ctx: Ctx, vp: Viewport, f: { slope: (x: number, y: number) => number; n: number }, c: string): void {
  const n = Math.max(5, Math.min(40, f.n || 20));
  const box = vp.box();
  const len = Math.min(vp.w, vp.h) / n / 2.6;
  ctx.strokeStyle = alpha(c, 0.75);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const x = box.x0 + ((box.x1 - box.x0) * i) / n;
      const y = box.y0 + ((box.y1 - box.y0) * j) / n;
      const m = f.slope(x, y);
      if (!Number.isFinite(m)) continue;
      const a = Math.atan(m);
      const px = vp.px(x);
      const py = vp.py(y);
      ctx.moveTo(px - len * Math.cos(a), py + len * Math.sin(a));
      ctx.lineTo(px + len * Math.cos(a), py - len * Math.sin(a));
    }
  }
  ctx.stroke();
}

function paintList(ctx: Ctx, vp: Viewport, it: SceneItem, hits: Hit[]): void {
  const items = Array.isArray(it.value) ? (it.value as unknown[]) : [];
  const el = /^List<(\w+)/.exec(it.typeText)?.[1];
  if (el === 'Point') {
    items.forEach((p, i) => {
      if (!isPt(p)) return;
      const x = vp.px(p.x);
      const y = vp.py(p.y);
      dot(ctx, x, y, 3.8, it.color);
      hits.push({ k: 'circle', x, y, r: 7, text: `${it.name}[${i + 1}] = (${fmt(p.x)}, ${fmt(p.y)})`, id: it.id });
    });
    return;
  }
  if (el === 'Polygon') {
    // squares of residuals and other polygon lists (ui.md 3: 1.5 px, 25 % fill)
    for (const p of items) polygon(ctx, vp, (p as { pts: readonly Pt[] }).pts, it.color, 0.25, 1.5);
    return;
  }
  const sub = { ...it, type: el ?? '', typeText: el ?? '' };
  for (const v of items) paintItem(ctx, vp, { ...sub, value: v, label: false }, hits);
}

/* ------------------------------ charts ------------------------------ */

let stemOffset = 0;

function paintChart(ctx: Ctx, vp: Viewport, it: SceneItem, hits: Hit[]): void {
  if (!isRec(it.value)) return;
  const r = it.value;
  const c = it.color;
  const F = r.fields;
  switch (r.schema) {
    case 'Histogram': {
      const e = nums(F['edges']);
      const h = nums(F['heights']);
      const counts = nums(F['counts']);
      const total = counts.reduce((a, b) => a + b, 0);
      const y0 = vp.py(0);
      for (let k = 0; k < h.length; k++) {
        const x0 = vp.px(e[k] as number);
        const x1 = vp.px(e[k + 1] as number);
        const y1 = vp.py(h[k] as number);
        ctx.fillStyle = alpha(c, 0.55);
        ctx.fillRect(x0, Math.min(y0, y1), x1 - x0, Math.abs(y1 - y0));
        ctx.strokeStyle = c;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x0, Math.min(y0, y1), x1 - x0, Math.abs(y1 - y0));
        const closed = F['closed'] === 'right' ? `(${fmt(e[k] as number)}, ${fmt(e[k + 1] as number)}]` : `[${fmt(e[k] as number)}, ${fmt(e[k + 1] as number)})`;
        const n = counts[k] as number;
        hits.push({ k: 'rect', x0, y0: Math.min(y0, y1, y0 - 24), x1, y1: Math.max(y0, y1), text: `Class ${closed}: ${fmt(n)} values, ${total > 0 ? Math.round((100 * n) / total) : 0} %`, id: it.id });
      }
      if (h.length < 20 && F['scale'] === 'count') {
        ctx.font = SMALL;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = '#374151';
        for (let k = 0; k < h.length; k++) ctx.fillText(fmt(h[k] as number), (vp.px(e[k] as number) + vp.px(e[k + 1] as number)) / 2, vp.py(h[k] as number) - 3);
      }
      if (F['scale'] === 'density' && e.length > 1) badge(ctx, vp.px(e[0] as number), vp.py(Math.max(...h)) - 22, 'heights are density');
      return;
    }
    case 'BarChart':
    case 'ShadedBars': {
      const xs = nums(F['xs']);
      const h = nums(F['heights']);
      const w = (F['width'] as number) ?? 1;
      const labels = (F['labels'] as string[] | undefined) ?? [];
      const inside = r.schema === 'ShadedBars' ? nums(F['inside']) : undefined;
      const y0 = vp.py(0);
      xs.forEach((x, k) => {
        if (inside && !((h[k] as number) > 0)) return;
        const half = (w * 0.8) / 2;
        const x0 = vp.px(x - half);
        const x1 = vp.px(x + half);
        const y1 = vp.py(h[k] as number);
        // a shaded interval: full colour inside, pale outside (probability ui 3.2)
        ctx.fillStyle = alpha(c, inside ? (inside[k] ? 0.85 : 0.22) : 0.7);
        ctx.fillRect(x0, Math.min(y0, y1), x1 - x0, Math.abs(y1 - y0));
        hits.push({ k: 'rect', x0, y0: Math.min(y0, y1, y0 - 24), x1, y1: Math.max(y0, y1), text: `${labels[k] ?? fmt(x)}: ${fmt(h[k] as number)}`, id: it.id });
      });
      return;
    }
    case 'BoxPlot':
      paintBox(ctx, vp, F, c, it.id, hits);
      return;
    case 'BoxPlots':
      ((F['plots'] as Rec[] | undefined) ?? []).forEach((b, i) => paintBox(ctx, vp, b.fields, colorAt(i), it.id, hits));
      return;
    case 'DotPlot': {
      const dots = (F['dots'] as Pt[] | undefined) ?? [];
      const bw = (F['binWidth'] as number) || 1;
      const d = Math.max(8, Math.min(bw * vp.ppu, 12));
      for (const p of dots) {
        const x = vp.px(p.x);
        const y = vp.py(0) - (p.y - 0.5) * d;
        dot(ctx, x, y, d / 2 - 0.5, c, false);
      }
      return;
    }
    case 'StemPlot': {
      const lines = String(F['text'] ?? '').split('\n');
      ctx.font = MONO;
      const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 24;
      // a text chart sits in the graph's top left corner, below any earlier one
      const x = 12;
      const y = 12 + stemOffset;
      stemOffset += lines.length * 18 + 24;
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.strokeStyle = '#d8dde4';
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, width, lines.length * 18 + 14);
      ctx.strokeRect(x, y, width, lines.length * 18 + 14);
      ctx.fillStyle = '#1f2937';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      lines.forEach((l, i) => ctx.fillText(l, x + 12, y + 8 + i * 18));
      return;
    }
    case 'PieChart': {
      const centre = F['centre'] as Pt;
      const r = ((F['radius'] as number) ?? 1) * Math.min(vp.ppu, vp.ppuY);
      const angles = nums(F['angles']);
      const fr = nums(F['fractions']);
      const vals = nums(F['values']);
      const labels = (F['labels'] as string[] | undefined) ?? [];
      let a = (F['start'] as number) ?? Math.PI / 2;
      const cx = vp.px(centre.x);
      const cy = vp.py(centre.y);
      const total = vals.reduce((s, x) => s + x, 0);
      angles.forEach((da, k) => {
        // clockwise from the start: maths angles decrease; canvas y is down so canvas angle = -maths angle
        const a0 = a;
        const a1 = a - da;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, -a0, -a1, false);
        ctx.closePath();
        ctx.fillStyle = colorAt(k);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();
        const mid = (a0 + a1) / 2;
        const lx = cx + Math.cos(mid) * (r + 16);
        const ly = cy - Math.sin(mid) * (r + 16);
        label(ctx, `${labels[k] ?? k + 1}`, lx, ly + 7, '#374151', Math.cos(mid) >= 0 ? 'left' : 'right');
        hits.push({ k: 'wedge', x: cx, y: cy, r, a0: a1, a1: a0, text: `Slice "${labels[k] ?? k + 1}": ${fmt(vals[k] as number)} of ${fmt(total)} (${Math.round((fr[k] as number) * 100)} %)`, id: it.id });
        a = a1;
      });
      return;
    }
    case 'PointsChart': {
      const pts = (F['points'] as Pt[] | undefined) ?? [];
      const kind = F['kind'];
      const px = pts.map((p) => [vp.px(p.x), vp.py(p.y)] as const);
      if (kind === 'line' || kind === 'freqpoly' || kind === 'ogive') stroke(ctx, [px.flat()], c, 2);
      if (kind === 'step') {
        const path: number[] = [];
        px.forEach(([x, y], i) => {
          if (i > 0) path.push(x, (px[i - 1] as readonly [number, number])[1]);
          path.push(x, y);
        });
        stroke(ctx, [path], c, 2);
      }
      if (kind === 'stick') for (const [x, y] of px) stroke(ctx, [[x, vp.py(0), x, y]], c, 2);
      if (kind === 'residual') stroke(ctx, [[0, vp.py(0), vp.w, vp.py(0)]], '#6b7280', 1.5, [6, 5]);
      px.forEach(([x, y], i) => {
        dot(ctx, x, y, kind === 'stick' ? 3 : 3.8, c, kind !== 'stick');
        const p = pts[i] as Pt;
        hits.push({ k: 'circle', x, y, r: 7, text: `(${fmt(p.x)}, ${fmt(p.y)})`, id: it.id });
      });
      return;
    }
    case 'NormalQuantilePlot': {
      const pts = (F['points'] as Pt[] | undefined) ?? [];
      const slope = F['slope'] as number | undefined;
      const icpt = F['intercept'] as number | undefined;
      if (slope !== undefined && icpt !== undefined) {
        const box = vp.box();
        stroke(ctx, [[vp.px(box.x0), vp.py(slope * box.x0 + icpt), vp.px(box.x1), vp.py(slope * box.x1 + icpt)]], '#6b7280', 1.5, [6, 5]);
      }
      for (const p of pts) dot(ctx, vp.px(p.x), vp.py(p.y), 3.8, c);
      const last = pts[pts.length - 1];
      if (last && typeof F['r'] === 'number') label(ctx, `r = ${fmt(F['r'] as number)}`, vp.px(last.x) + 10, vp.py(last.y), c);
      return;
    }
    default:
      return;
  }
}

function badge(ctx: Ctx, x: number, y: number, text: string): void {
  ctx.font = SMALL;
  const w = ctx.measureText(text).width + 14;
  ctx.fillStyle = '#fff7e6';
  ctx.strokeStyle = '#e0b04f';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, 18, 9);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#8a5a00';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 7, y + 9);
}

function paintBox(ctx: Ctx, vp: Viewport, F: Readonly<Record<string, unknown>>, c: string, id: number, hits: Hit[]): void {
  const y = F['y'] as number;
  const hh = F['halfHeight'] as number;
  const g = (k: string): number => F[k] as number;
  if (typeof F['q1'] !== 'number') return;
  const top = vp.py(y + hh);
  const bot = vp.py(y - hh);
  const mid = vp.py(y);
  const xq1 = vp.px(g('q1'));
  const xq3 = vp.px(g('q3'));
  ctx.fillStyle = alpha(c, 0.18);
  ctx.fillRect(xq1, top, xq3 - xq1, bot - top);
  ctx.strokeStyle = c;
  ctx.lineWidth = 1.75;
  ctx.strokeRect(xq1, top, xq3 - xq1, bot - top);
  stroke(ctx, [[vp.px(g('median')), top, vp.px(g('median')), bot]], c, 2.5);
  const cap = (bot - top) * 0.25;
  stroke(ctx, [[vp.px(g('min')), mid, xq1, mid], [xq3, mid, vp.px(g('max')), mid]], c, 1.5);
  stroke(ctx, [[vp.px(g('min')), mid - cap, vp.px(g('min')), mid + cap], [vp.px(g('max')), mid - cap, vp.px(g('max')), mid + cap]], c, 1.5);
  for (const o of nums(F['outliers'])) {
    ctx.beginPath();
    ctx.arc(vp.px(o), mid, 4, 0, Math.PI * 2);
    ctx.strokeStyle = c;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  const name = String(F['label'] ?? '');
  if (name) label(ctx, name, vp.px(g('min')) - 10, mid + 7, '#374151', 'right');
  hits.push({
    k: 'rect', x0: vp.px(g('min')) - 4, y0: top, x1: vp.px(g('max')) + 4, y1: bot,
    text: `min ${fmt(g('min'))} · Q1 ${fmt(g('q1'))} · median ${fmt(g('median'))} · Q3 ${fmt(g('q3'))} · max ${fmt(g('max'))}`, id,
  });
}

function paintFit(ctx: Ctx, vp: Viewport, r: Rec, c: string): void {
  const f = r.fields['f'];
  if (!isFn(f)) return;
  const from = (r.fields['from'] as number) ?? -Infinity;
  const to = (r.fields['to'] as number) ?? Infinity;
  const g = (x: number): number => {
    const v = f.call1 ? f.call1(x) : f.call(x);
    return typeof v === 'number' ? v : NaN;
  };
  const paths = sampleCurve(vp, g, from, to);
  stroke(ctx, paths, c, 2.5);
  const last = paths[paths.length - 1];
  if (last && last.length >= 2) {
    const r2 = r.fields['r2'];
    const lx = Math.min((last[last.length - 2] as number) - 4, vp.w - 60);
    const ly = Math.max(22, Math.min(vp.h - 8, (last[last.length - 1] as number) - 8));
    label(ctx, `${String(r.fields['equation'])}${typeof r2 === 'number' ? `   (R² = ${fmt(r2)})` : ''}`, lx, ly, c, 'right');
  }
}

function paintDist(ctx: Ctx, vp: Viewport, d: { spec: { discrete: boolean; pdf: (p: readonly number[], x: number) => number }; params: readonly number[] }, c: string): void {
  const box = vp.box();
  if (d.spec.discrete) {
    for (let k = Math.ceil(box.x0); k <= box.x1; k++) {
      const p = d.spec.pdf(d.params, k);
      if (!(p > 0)) continue;
      stroke(ctx, [[vp.px(k), vp.py(0), vp.px(k), vp.py(p)]], c, 2);
      dot(ctx, vp.px(k), vp.py(p), 3.5, c, false);
    }
    return;
  }
  const paths = sampleCurve(vp, (x) => d.spec.pdf(d.params, x), box.x0, box.x1, 800);
  for (const p of paths) {
    ctx.beginPath();
    ctx.moveTo(p[0] as number, vp.py(0));
    for (let i = 0; i + 1 < p.length; i += 2) ctx.lineTo(p[i] as number, p[i + 1] as number);
    ctx.lineTo(p[p.length - 2] as number, vp.py(0));
    ctx.closePath();
    ctx.fillStyle = alpha(c, 0.1);
    ctx.fill();
  }
  stroke(ctx, paths, c, 2.5);
}

/* ------------------------------ animation ------------------------------ */

/** One batch per particle system, reused every frame. */
const BATCHES = new WeakMap<object, ParticleBatchPlain>();

/** A particle system on the CPU path (animation-time design 10.7): each live particle as a disc of its colour. */
function paintParticles(ctx: Ctx, vp: Viewport, v: ParticlesValue, t: number): void {
  let b = BATCHES.get(v.program);
  if (!b || b.count !== v.spec.count) {
    b = makeParticleBatch(v.spec.count);
    BATCHES.set(v.program, b);
  }
  v.program.evalCpu(t, t, b);
  ctx.save();
  // `blend = add` brightens towards white; on the studio's white board that would hide the particles, so it is drawn
  // as normal here (a dark board or the GPU renderer can honour it)
  for (let i = 0; i < b.count; i++) {
    const a = b.alpha[i] as number;
    const size = b.size[i] as number;
    if (!(a > 0.003) || !(size > 0)) continue;
    const x = vp.px(b.x[i] as number);
    const y = vp.py(b.y[i] as number);
    if (x < -20 || y < -20 || x > vp.w + 20 || y > vp.h + 20) continue;
    const c = (b.rgba[i] as number) >>> 0;
    const r = Math.max(0.6, (v.spec.sizeIsPx ? size : size * vp.ppu) / 2);
    ctx.globalAlpha = Math.min(1, a * (((c & 255) / 255) || 1));
    ctx.fillStyle = `rgb(${c >>> 24}, ${(c >>> 16) & 255}, ${(c >>> 8) & 255})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A trace: the path the point has drawn so far, in its colour (design 6). */
function paintTrace(ctx: Ctx, vp: Viewport, xs: Float64Array, color: string): void {
  ctx.save();
  ctx.strokeStyle = alpha(color, 0.75);
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let pen = false;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const x = xs[i] as number;
    const y = xs[i + 1] as number;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      pen = false;
      continue;
    }
    if (pen) ctx.lineTo(vp.px(x), vp.py(y));
    else ctx.moveTo(vp.px(x), vp.py(y));
    pen = true;
  }
  ctx.stroke();
  ctx.restore();
}

/** A placed text: the anchor corner at `at`, rotated about it; maths typeset by the view's engine. */
/** The parts of a vertical text, top to bottom: each letter alone, each `$…$` part whole (design 4.7). */
export function verticalParts(s: string): string[] {
  const out: string[] = [];
  for (const piece of s.split(/(\$[^$]*\$)/)) {
    if (piece.startsWith('$') && piece.endsWith('$') && piece.length >= 2) out.push(piece);
    else for (const ch of piece) if (ch.trim() !== '' || out.length > 0) out.push(ch);
  }
  while (out.length > 0 && (out[out.length - 1] as string).trim() === '') out.pop();
  return out;
}

/** A vertical text as one layout: the parts stacked, each centred and upright, the baseline at the bottom. */
function verticalLayout(s: string, px: number): MathLayout {
  const texts = verticalParts(s);
  const parts = texts.map((p) => math.layoutText(p.trim() === '' ? 'x' : p, px, canvasMeasure));
  const gap = px * 0.08;
  const w = Math.max(0, ...parts.map((l) => l.w));
  const tops: number[] = [];
  let y = 0;
  for (const l of parts) {
    tops.push(y);
    y += Math.max(l.asc + l.desc, px * 0.9) + gap;
  }
  const h = Math.max(0, y - gap);
  const items: MathItem[] = [];
  parts.forEach((l, i) => {
    if ((texts[i] as string).trim() === '') return;
    for (const it of l.items) items.push(shiftItem(it, (w - l.w) / 2, (tops[i] as number) + l.asc - h));
  });
  return { w, asc: h, desc: 0, items };
}

function shiftItem(it: MathItem, dx: number, dy: number): MathItem {
  if (it.k === 'path') return { ...it, pts: it.pts.map(([x, y]) => [x + dx, y + dy] as const) };
  return { ...it, x: it.x + dx, y: it.y + dy };
}

function paintText(ctx: Ctx, vp: Viewport, s: string, t: NonNullable<SceneItem['text']>, color: string, hits: Hit[], id: number): void {
  const l = t.vertical ? verticalLayout(s, t.size) : math.layoutText(s, t.size, canvasMeasure);
  const h = l.asc + l.desc;
  // compass words, and the controls' corners (tl, tr, bl, br)
  const an = ({ tl: 'nw', tr: 'ne', bl: 'sw', br: 'se' } as Record<string, string>)[t.anchor] ?? t.anchor;
  const ax = an.includes('w') ? 0 : an.includes('e') ? l.w : l.w / 2;
  const ay = an.includes('n') ? 0 : an.includes('s') ? h : h / 2;
  const x = vp.px(t.at.x);
  const y = vp.py(t.at.y);
  ctx.save();
  ctx.translate(x, y);
  // a maths angle counter-clockwise is clockwise on the canvas, whose y grows down
  if (t.rotate) ctx.rotate(-t.rotate);
  if (t.bg) {
    ctx.fillStyle = t.bg;
    ctx.fillRect(-ax - 3, -ay - 2, l.w + 6, h + 4);
  }
  drawMath(ctx, l, -ax, -ay + l.asc, '#1f2430');
  ctx.restore();
  hits.push({ k: 'rect', x0: x - ax, y0: y - ay, x1: x - ax + l.w, y1: y - ay + h, text: s.replace(/\$/g, ''), id });
  void color;
}

/* ------------------------------ the scene ------------------------------ */

/** Paints the grid and every item, and returns the hit areas, topmost last. */
export function paintScene(ctx: Ctx, vp: Viewport, items: readonly SceneItem[]): Hit[] {
  const hits: Hit[] = [];
  stemOffset = 0;
  paintGrid(ctx, vp);
  // areas and charts first, then curves, then points on top
  const rank = (t: string): number => (t === 'Point' ? 3 : t === 'Chart' || t === 'Region' || t === 'Polygon' || t.endsWith('Distribution') ? 0 : t === 'List' ? 2 : 1);
  const sorted = [...items].sort((a, b) => rank(a.type) - rank(b.type));
  for (const it of sorted) {
    try {
      if (it.trace && it.trace.length >= 4) paintTrace(ctx, vp, it.trace, it.color);
      if (it.type === 'Text') {
        // full LaTeX is drawn by the HTML overlay over the canvas (latex-overlay.ts)
        if (it.text?.full) continue;
        if (it.text && typeof it.value === 'string') paintText(ctx, vp, it.value, it.text, it.color, hits, it.id);
        continue;
      }
      if (it.type === 'Particles') {
        if (isParticlesValue(it.value)) paintParticles(ctx, vp, it.value, it.time ?? 0);
        continue;
      }
      if (it.ghost) {
        // a preview or a hidden object: faint and dashed, and not hoverable
        ctx.save();
        ctx.globalAlpha = 0.45;
        ctx.setLineDash([6, 4]);
        paintItem(ctx, vp, it, []);
        ctx.restore();
        continue;
      }
      if (it.selected || it.hovered) {
        // a glow under a selected object (algebra-view design 3.9), lighter for the one the pointer is over
        ctx.save();
        ctx.shadowColor = it.selected ? 'rgba(47, 111, 219, 0.95)' : 'rgba(47, 111, 219, 0.55)';
        ctx.shadowBlur = it.selected ? 14 : 9;
        ctx.globalAlpha = it.selected ? 0.9 : 0.6;
        paintItem(ctx, vp, it, []);
        ctx.restore();
      }
      paintItem(ctx, vp, it, hits);
    } catch {
      // a value the painter does not understand is skipped, never fatal
    }
  }
  return hits;
}

/** Maths bounds of what the items draw, for "zoom to fit". */
export function sceneBounds(items: readonly SceneItem[]): { x0: number; x1: number; y0: number; y1: number } | undefined {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  };
  for (const it of items) {
    const v = it.value;
    if (isPt(v) && it.type === 'Point') add(v.x, v.y);
    else if (it.type === 'List' && Array.isArray(v)) {
      for (const p of v) if (isPt(p)) add(p.x, p.y);
    } else if (it.type === 'Circle') {
      const c = v as { cx: number; cy: number; r: number };
      add(c.cx - c.r, c.cy - c.r);
      add(c.cx + c.r, c.cy + c.r);
    } else if (it.type === 'Segment') {
      const s = v as { a: Pt; b: Pt };
      add(s.a.x, s.a.y);
      add(s.b.x, s.b.y);
    } else if (it.type === 'Polygon') {
      for (const p of (v as { pts: Pt[] }).pts) add(p.x, p.y);
    } else if (it.type === 'Chart' && isRec(v)) {
      const F = v.fields;
      if (v.schema === 'Histogram') {
        const e = nums(F['edges']);
        add(e[0] as number, 0);
        add(e[e.length - 1] as number, Math.max(0, ...nums(F['heights'])));
      } else if (v.schema === 'BarChart' || v.schema === 'ShadedBars') {
        const xs = nums(F['xs']);
        const w = (F['width'] as number) ?? 1;
        add(Math.min(...xs) - w, 0);
        add(Math.max(...xs) + w, Math.max(0, ...nums(F['heights'])));
      } else if (v.schema === 'BoxPlot') {
        add(F['min'] as number, (F['y'] as number) - (F['halfHeight'] as number));
        add(F['max'] as number, (F['y'] as number) + (F['halfHeight'] as number));
      } else if (v.schema === 'BoxPlots') {
        for (const b of (F['plots'] as Rec[]) ?? []) {
          add(b.fields['min'] as number, (b.fields['y'] as number) - 0.5);
          add(b.fields['max'] as number, (b.fields['y'] as number) + 0.5);
        }
      } else if (v.schema === 'StemPlot') {
        // drawn in screen space
      } else if (v.schema === 'PieChart') {
        const c = F['centre'] as Pt;
        const r = F['radius'] as number;
        add(c.x - r * 1.4, c.y - r * 1.2);
        add(c.x + r * 1.4, c.y + r * 1.2);
      } else if (v.schema === 'DotPlot') {
        const vals = nums(F['values']);
        add(Math.min(...vals), 0);
        add(Math.max(...vals), 1);
      } else {
        for (const p of ((F['points'] as Pt[]) ?? [])) add(p.x, p.y);
      }
    } else if (it.type.endsWith('Distribution')) {
      const d = v as { spec: { discrete: boolean; pdf: (p: readonly number[], x: number) => number; quantile: (p: readonly number[], q: number) => number }; params: readonly number[] };
      const lo = d.spec.quantile(d.params, 0.001);
      const hi = d.spec.quantile(d.params, 0.999);
      for (let i = 0; i <= 60; i++) {
        const x = d.spec.discrete ? Math.round(lo + ((hi - lo) * i) / 60) : lo + ((hi - lo) * i) / 60;
        add(x, d.spec.pdf(d.params, x));
      }
      add(lo, 0);
    } else if (it.type === 'Region' && (v as { kind?: string }).kind === 'region') {
      const r = v as { shape: { a: number; b: number }; f: (x: number) => number };
      const { a, b } = r.shape;
      if (Number.isFinite(a) && Number.isFinite(b)) {
        for (let i = 0; i <= 40; i++) {
          const x = a + ((b - a) * i) / 40;
          add(x, r.f(x));
        }
        add(a, 0);
      }
    } else if (it.type === 'Record' && isRec(v) && v.schema === 'Fit') {
      const f = v.fields['f'];
      if (isFn(f)) {
        const a = v.fields['from'] as number;
        const b = v.fields['to'] as number;
        for (let i = 0; i <= 20; i++) {
          const x = a + ((b - a) * i) / 20;
          const y = f.call1 ? f.call1(x) : (f.call(x) as number);
          add(x, y);
        }
      }
    }
  }
  return x0 <= x1 ? { x0, x1, y0, y1 } : undefined;
}
