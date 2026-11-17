/**
 * Drawing physics on the board (docs/features/physics/ui.md 5 and 7): bodies at their pose with a dot at the centre of
 * mass, joints (hinge ring, spring zigzag, rope that sags when slack, weld cross, wheel with spokes), force and speed
 * arrows with their key, contact points, and the hatched edge of solid shapes.
 */
import { physics } from '@incantly/kernel';
import type { Hit, SceneItem } from './paint';
import type { Viewport } from './viewport';

type Ctx = CanvasRenderingContext2D;
type Pt = { readonly x: number; readonly y: number };

/** The colour and short label of each force kind (ui.md 5). */
export const FORCE_STYLE: Readonly<Record<string, { color: string; label: string }>> = {
  gravity: { color: '#2f6fdb', label: 'gravity' },
  normal: { color: '#2a9d6f', label: 'normal' },
  friction: { color: '#e07b1a', label: 'friction' },
  tension: { color: '#7b52c6', label: 'tension' },
  spring: { color: '#cc4c8c', label: 'spring' },
  buoyancy: { color: '#1498b3', label: 'buoyancy' },
  drag: { color: '#6b7280', label: 'drag' },
  electric: { color: '#c9a227', label: 'electric' },
  applied: { color: '#b3261e', label: 'applied' },
  net: { color: '#1f2430', label: 'net' },
};
const KINDS = ['gravity', 'normal', 'friction', 'tension', 'spring', 'buoyancy', 'drag', 'electric', 'applied', 'net'] as const;

export function isPhysicsItem(it: SceneItem): boolean {
  return it.type === 'Body' || it.type === 'Joint' || it.type === 'Wheel' || it.type === 'Contacts' || it.type === 'Liquid' || it.type === 'Water' || it.type === 'Waves' || (it.type === 'List' && /^List<(Body|Joint|Wheel)>/.test(it.typeText));
}

function bodiesOf(it: SceneItem): physics.BodyValue[] {
  const v = it.value;
  if (physics.isBodyValue(v)) return [v];
  if (Array.isArray(v)) return v.filter((x): x is physics.BodyValue => physics.isBodyValue(x));
  return [];
}

/** Pixels per newton, so the largest force on screen is about 2 cm (75 px) long; 0 when nothing shows forces. */
export function forceScale(items: readonly SceneItem[]): number {
  let max = 0;
  for (const it of items) {
    if (it.arrows !== 'forces') continue;
    for (const b of bodiesOf(it)) {
      const f = b.forces;
      if (!f) continue;
      for (let k = 0; k < KINDS.length; k++) max = Math.max(max, Math.hypot(f[k * 2] as number, f[k * 2 + 1] as number));
    }
  }
  return max > 1e-9 ? 75 / max : 0;
}

function arrow(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, color: string, width: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l = Math.hypot(dx, dy);
  if (l < 2) return;
  const ux = dx / l;
  const uy = dy / l;
  const head = Math.min(9, l * 0.4);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1 - ux * head * 0.6, y1 - uy * head * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - ux * head - uy * head * 0.45, y1 - uy * head + ux * head * 0.45);
  ctx.lineTo(x1 - ux * head + uy * head * 0.45, y1 - uy * head - ux * head * 0.45);
  ctx.closePath();
  ctx.fill();
}

function smallLabel(ctx: Ctx, text: string, x: number, y: number, color: string): void {
  ctx.font = '11px Inter, "Segoe UI", system-ui, sans-serif';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

function paintBody(ctx: Ctx, vp: Viewport, b: physics.BodyValue, it: SceneItem, hits: Hit[], scale: number, name: string): void {
  const shape = physics.shapeNow(b) as { cx?: number; cy?: number; r?: number; pts?: Pt[] };
  const c = it.color;
  ctx.lineWidth = 2;
  ctx.strokeStyle = c;
  ctx.fillStyle = withAlpha(c, b.asleep ? 0.22 : 0.32);
  ctx.beginPath();
  let reach = 8;
  if (typeof shape.r === 'number' && typeof shape.cx === 'number' && typeof shape.cy === 'number') {
    const r = shape.r * vp.ppu;
    ctx.arc(vp.px(shape.cx), vp.py(shape.cy), r, 0, Math.PI * 2);
    reach = Math.max(reach, r);
    // a line from the centre to the rim, so turning shows
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(vp.px(shape.cx), vp.py(shape.cy));
    ctx.lineTo(vp.px(shape.cx + shape.r * Math.cos(b.angle)), vp.py(shape.cy + shape.r * Math.sin(b.angle)));
    ctx.stroke();
  } else if (shape.pts && shape.pts.length > 0) {
    shape.pts.forEach((p, k) => {
      const x = vp.px(p.x);
      const y = vp.py(p.y);
      reach = Math.max(reach, Math.hypot(x - vp.px(b.x), y - vp.py(b.y)));
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // the centre of mass
  const cx = vp.px(b.x);
  const cy = vp.py(b.y);
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
  ctx.fill();
  if (it.label) smallLabel(ctx, name, cx + 6, cy - 8, c);
  const speed = Math.hypot(b.vx, b.vy);
  hits.push({ k: 'circle', x: cx, y: cy, r: Math.max(12, Math.min(reach, 60)), text: `${name}: ${fmt(speed)} m/s${b.asleep ? ', asleep' : ''}`, id: it.id, drag: name });
  if (it.arrows === 'speeds' && speed > 1e-6) {
    arrow(ctx, cx, cy, cx + b.vx * 25, cy - b.vy * 25, '#1f2430', 2);
    smallLabel(ctx, `${fmt(speed)} m/s`, cx + b.vx * 25 + 6, cy - b.vy * 25, '#1f2430');
  }
  if (it.arrows === 'forces' && b.forces && scale > 0) {
    for (let k = 0; k < KINDS.length; k++) {
      const fx = b.forces[k * 2] as number;
      const fy = b.forces[k * 2 + 1] as number;
      if (Math.hypot(fx, fy) * scale < 3) continue;
      const kind = KINDS[k] as string;
      const st = FORCE_STYLE[kind] as { color: string; label: string };
      const x1 = cx + fx * scale;
      const y1 = cy - fy * scale;
      arrow(ctx, cx, cy, x1, y1, st.color, kind === 'net' ? 3 : 2);
      smallLabel(ctx, st.label, x1 + 4, y1, st.color);
    }
  }
}

function zigzag(ctx: Ctx, x0: number, y0: number, x1: number, y1: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l = Math.hypot(dx, dy);
  if (l < 1) return;
  const ux = dx / l;
  const uy = dy / l;
  const n = 10;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  for (let k = 1; k < n; k++) {
    const s = (k / n) * l;
    const side = k % 2 === 0 ? -6 : 6;
    ctx.lineTo(x0 + ux * s - uy * side, y0 + uy * s + ux * side);
  }
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function paintJoint(ctx: Ctx, vp: Viewport, j: physics.JointValue, color: string, hits: Hit[], id: number, name: string): void {
  const ax = vp.px(j.ax);
  const ay = vp.py(j.ay);
  const bx = vp.px(j.bx);
  const by = vp.py(j.by);
  ctx.save();
  ctx.strokeStyle = j.broken ? '#b3261e' : color;
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  if (j.broken) ctx.setLineDash([3, 3]);
  switch (j.kind) {
    case 'hinge':
      ctx.beginPath();
      ctx.arc(ax, ay, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    case 'spring':
      zigzag(ctx, ax, ay, bx, by);
      break;
    case 'rope': {
      // a slack rope sags: a curve through a point below the middle
      const slack = Math.max(0, (j.length ?? 0) - j.lengthNow) * vp.ppu * 0.5;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + slack, bx, by);
      ctx.stroke();
      break;
    }
    case 'weld': {
      ctx.beginPath();
      ctx.moveTo(ax - 4, ay - 4);
      ctx.lineTo(ax + 4, ay + 4);
      ctx.moveTo(ax - 4, ay + 4);
      ctx.lineTo(ax + 4, ay - 4);
      ctx.stroke();
      break;
    }
    case 'grab':
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      for (const [x, y] of [[ax, ay], [bx, by]] as const) {
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    default:
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
  }
  ctx.restore();
  hits.push({ k: 'circle', x: (ax + bx) / 2, y: (ay + by) / 2, r: 8, text: `${name}: ${j.kind}${j.broken ? ', broken' : `, ${fmt(j.force)} N`}`, id });
}

/** A wheel: a dark tyre with spokes, so its spin shows (ui.md 7). */
function paintWheel(ctx: Ctx, vp: Viewport, w: physics.WheelValue, hits: Hit[], id: number, name: string): void {
  const x = vp.px(w.x);
  const y = vp.py(w.y);
  const r = w.r * vp.ppu;
  ctx.save();
  ctx.fillStyle = '#2b2f36';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c4c9d1';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2b2f36';
  ctx.lineWidth = Math.max(1.5, r * 0.08);
  ctx.beginPath();
  for (let k = 0; k < 5; k++) {
    const a = w.angle + (k * Math.PI * 2) / 5;
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * r * 0.62, y - Math.sin(a) * r * 0.62);
  }
  ctx.stroke();
  ctx.restore();
  hits.push({ k: 'circle', x, y, r: Math.max(10, r), text: `${name}: ${fmt(Math.abs(w.spin))} rad/s${w.broken ? ', broken off' : ''}`, id });
}

/** The default look of liquid and water (ui.md 7): light blue drops, a light blue fill under a darker line. */
const LIQUID_BLUE = '#5aa7e8';
const WATER_BLUE = '#2f7fc1';

/** Liquid: every drop a disc in one batch, so 2,000 drops cost one fill (ui.md 7). */
function paintLiquid(ctx: Ctx, vp: Viewport, l: physics.LiquidValue, it: SceneItem, hits: Hit[]): void {
  const n = Math.min(l.xs.length, l.ys.length);
  // drops in space are drawn by the Space view
  if (n === 0 || l.zs) return;
  const r = Math.max(1.5, 0.5 * l.size * vp.ppu * 1.3);
  ctx.save();
  ctx.fillStyle = withAlpha(l.spec.color ?? LIQUID_BLUE, 0.85);
  ctx.beginPath();
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    const x = vp.px(l.xs[i] as number);
    const y = vp.py(l.ys[i] as number);
    sx += x;
    sy += y;
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();
  hits.push({ k: 'circle', x: sx / n, y: sy / n, r: 14, text: `${it.name}: ${l.count} drops${Number.isFinite(l.level) ? `, level ${fmt(l.level)}` : ''}`, id: it.id });
}

/** Still water: a light fill below a darker line, inside its region when it has one (ui.md 7). */
function paintWater(ctx: Ctx, vp: Viewport, w: physics.WaterValue, it: SceneItem, hits: Hit[]): void {
  const b = vp.box();
  let pts: Pt[];
  if (w.region) pts = clipBelow(w.region, w.level);
  else {
    if (w.level < b.y0) return;
    const top = Math.min(w.level, b.y1 + 1);
    pts = [{ x: b.x0 - 1, y: b.y0 - 1 }, { x: b.x1 + 1, y: b.y0 - 1 }, { x: b.x1 + 1, y: top }, { x: b.x0 - 1, y: top }];
  }
  if (pts.length < 3) return;
  ctx.save();
  ctx.fillStyle = withAlpha(WATER_BLUE, 0.25);
  ctx.beginPath();
  pts.forEach((p, k) => (k === 0 ? ctx.moveTo(vp.px(p.x), vp.py(p.y)) : ctx.lineTo(vp.px(p.x), vp.py(p.y))));
  ctx.closePath();
  ctx.fill();
  // the surface: the top edge of the water
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const p of pts) if (Math.abs(p.y - w.level) < 1e-9) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
  }
  if (x1 > x0) {
    ctx.strokeStyle = WATER_BLUE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(vp.px(x0), vp.py(w.level));
    ctx.lineTo(vp.px(x1), vp.py(w.level));
    ctx.stroke();
    hits.push({ k: 'circle', x: vp.px((Math.max(x0, b.x0) + Math.min(x1, b.x1)) / 2), y: vp.py(w.level), r: 10, text: `${it.name}: water, level ${fmt(w.level)}`, id: it.id });
  }
  ctx.restore();
}

/** Waves in the plane: the surface as a line through its points, a light fill down to the bottom (design 12). */
function paintWaves(ctx: Ctx, vp: Viewport, w: physics.WavesValue, it: SceneItem, hits: Hit[]): void {
  if (w.space || w.nx < 2) return;
  const bottom = w.level - w.depth;
  const x = (i: number): number => vp.px(w.x0 + (i + 0.5) * w.dx);
  const y = (i: number): number => vp.py(w.level + (w.heights[i] as number));
  ctx.save();
  ctx.fillStyle = withAlpha(WATER_BLUE, 0.25);
  ctx.beginPath();
  ctx.moveTo(vp.px(w.x0), vp.py(bottom));
  ctx.lineTo(vp.px(w.x0), y(0));
  for (let i = 0; i < w.nx; i++) ctx.lineTo(x(i), y(i));
  ctx.lineTo(vp.px(w.x0 + w.nx * w.dx), y(w.nx - 1));
  ctx.lineTo(vp.px(w.x0 + w.nx * w.dx), vp.py(bottom));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = WATER_BLUE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(vp.px(w.x0), y(0));
  for (let i = 0; i < w.nx; i++) ctx.lineTo(x(i), y(i));
  ctx.lineTo(vp.px(w.x0 + w.nx * w.dx), y(w.nx - 1));
  ctx.stroke();
  ctx.restore();
  const mid = w.nx >> 1;
  hits.push({ k: 'circle', x: x(mid), y: y(mid), r: 10, text: `${it.name}: waves, ${fmt(w.speed)} m/s`, id: it.id });
}

/** The part of a polygon below y = level (Sutherland and Hodgman against one line). */
function clipBelow(pts: readonly Pt[], level: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as Pt;
    const q = pts[(i + 1) % pts.length] as Pt;
    const pin = p.y <= level;
    const qin = q.y <= level;
    if (pin) out.push(p);
    if (pin !== qin) {
      const t = (level - p.y) / (q.y - p.y);
      out.push({ x: p.x + t * (q.x - p.x), y: level });
    }
  }
  return out;
}

/** Paints one physics item: a body or bodies, a joint or joints, liquid, water, or the contact points. */
export function paintPhysicsItem(ctx: Ctx, vp: Viewport, it: SceneItem, hits: Hit[], scale: number): void {
  if (physics.isLiquidValue(it.value)) {
    paintLiquid(ctx, vp, it.value, it, hits);
    return;
  }
  if (physics.isWaterValue(it.value)) {
    paintWater(ctx, vp, it.value, it, hits);
    return;
  }
  if (physics.isWavesValue(it.value)) {
    paintWaves(ctx, vp, it.value, it, hits);
    return;
  }
  if (it.type === 'Contacts') {
    const pts = (it.value as { x: number; y: number; nx: number; ny: number }[]) ?? [];
    ctx.fillStyle = '#b3261e';
    ctx.strokeStyle = '#b3261e';
    ctx.lineWidth = 1;
    for (const p of pts) {
      const x = vp.px(p.x);
      const y = vp.py(p.y);
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + p.nx * 12, y - p.ny * 12);
      ctx.stroke();
    }
    return;
  }
  const v = it.value;
  const list = Array.isArray(v) ? v : [v];
  list.forEach((x, k) => {
    const name = Array.isArray(v) ? `${it.name}[${k + 1}]` : it.name;
    if (physics.isBodyValue(x)) paintBody(ctx, vp, x, it, hits, scale, name);
    else if (physics.isWheelValue(x)) paintWheel(ctx, vp, x, hits, it.id, name);
    else if (physics.isJointValue(x)) paintJoint(ctx, vp, x, it.color, hits, it.id, name);
  });
}

/** The key of the force arrows: what one centimetre means (ui.md 5). */
export function paintForceKey(ctx: Ctx, vp: Viewport, scale: number): void {
  if (!(scale > 0)) return;
  // a round number of newtons near 38 px (1 cm)
  const raw = 38 / scale;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = [1, 2, 5, 10].map((m) => m * p).find((m) => m >= raw) ?? raw;
  const len = n * scale;
  const x = vp.w - 20 - len;
  const y = vp.h - 18;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(x - 8, y - 16, len + 20, 24);
  arrow(ctx, x, y, x + len, y, '#1f2430', 2);
  smallLabel(ctx, `${fmt(n)} N`, x, y - 9, '#1f2430');
  ctx.restore();
}

/** Short ticks on one side of a solid shape's outline, so walls read as walls (ui.md 7). */
export function paintSolidEdge(ctx: Ctx, vp: Viewport, it: SceneItem): void {
  const v = it.value as Record<string, unknown>;
  const paths: Pt[][] = [];
  const closed: boolean[] = [];
  const b = vp.box();
  if (Array.isArray(v['pts'])) {
    paths.push(v['pts'] as Pt[]);
    closed.push(it.type === 'Polygon');
  } else if (typeof v['cx'] === 'number' && typeof v['r'] === 'number') {
    const pts: Pt[] = [];
    for (let k = 0; k <= 48; k++) pts.push({ x: (v['cx'] as number) + (v['r'] as number) * Math.cos((k / 48) * Math.PI * 2), y: (v['cy'] as number) + (v['r'] as number) * Math.sin((k / 48) * Math.PI * 2) });
    paths.push(pts);
    closed.push(true);
  } else if (v['a'] && v['b'] && typeof (v['a'] as Pt).x === 'number') {
    paths.push([v['a'] as Pt, v['b'] as Pt]);
    closed.push(false);
  } else if (typeof v['a'] === 'number' && typeof v['b'] === 'number' && typeof v['c'] === 'number') {
    // a x + b y = c across the view
    const a = v['a'] as number;
    const bb = v['b'] as number;
    const c = v['c'] as number;
    const pts: Pt[] = Math.abs(bb) > 1e-9 ? [{ x: b.x0, y: (c - a * b.x0) / bb }, { x: b.x1, y: (c - a * b.x1) / bb }] : [{ x: c / a, y: b.y1 }, { x: c / a, y: b.y0 }];
    paths.push(pts);
    closed.push(false);
  } else if (typeof (v as { call?: unknown }).call === 'function') {
    const f = v as unknown as { call: (x: number) => unknown };
    const pts: Pt[] = [];
    for (let k = 0; k <= 160; k++) {
      const x = b.x0 + ((b.x1 - b.x0) * k) / 160;
      const y = f.call(x);
      if (typeof y === 'number' && Number.isFinite(y)) pts.push({ x, y });
    }
    paths.push(pts);
    closed.push(false);
  }
  ctx.save();
  ctx.strokeStyle = withAlpha(it.color, 0.75);
  ctx.lineWidth = 1;
  for (let p = 0; p < paths.length; p++) {
    const pts = paths[p] as Pt[];
    const n = pts.length;
    const edges = closed[p] ? n : n - 1;
    ctx.beginPath();
    for (let k = 0; k < edges; k++) {
      const a = pts[k] as Pt;
      const c = pts[(k + 1) % n] as Pt;
      const x0 = vp.px(a.x);
      const y0 = vp.py(a.y);
      const x1 = vp.px(c.x);
      const y1 = vp.py(c.y);
      const l = Math.hypot(x1 - x0, y1 - y0);
      if (l < 1) continue;
      // the inside of a counter-clockwise outline, or below a line, is to the right of the direction of travel on screen
      const nx = (y1 - y0) / l;
      const ny = -(x1 - x0) / l;
      const s = closed[p] ? -1 : 1;
      for (let d = 6; d < l; d += 10) {
        const x = x0 + ((x1 - x0) * d) / l;
        const y = y0 + ((y1 - y0) * d) / l;
        ctx.moveTo(x, y);
        ctx.lineTo(x + s * nx * 6 - ((x1 - x0) / l) * 4, y + s * ny * 6 - ((y1 - y0) / l) * 4);
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

function withAlpha(c: string, a: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(c)) return c;
  const n = parseInt(c.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const fmt = (x: number): string => (Number.isFinite(x) ? String(Number(x.toPrecision(3))) : String(x));
