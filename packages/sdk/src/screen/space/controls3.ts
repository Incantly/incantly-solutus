/**
 * What the pointer and keys do in the Space view (docs/features/space-3d/design.md 9.4, 10; ui.md 4 to 6;
 * .kiro/specs/space-3d R4.1 to R4.4). Pure: the pane calls these with the last frame's camera and hit areas.
 */
import { pointerRay } from '@incantly/view/camera';
import type { Camera } from '@incantly/view/camera';
import { space } from '@incantly/kernel';
import type { Hit3 } from './paint3';

type V3 = space.V3;
const DEG = Math.PI / 180;

/* ------------------------------ picking (design 9.4) ------------------------------ */

function segDist(x: number, y: number, h: { x0: number; y0: number; x1: number; y1: number }): number {
  const dx = h.x1 - h.x0;
  const dy = h.y1 - h.y0;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - h.x0) * dx + (y - h.y0) * dy) / l2)) : 0;
  return Math.hypot(x - (h.x0 + t * dx), y - (h.y0 + t * dy));
}

function insidePoly(pts: readonly { x: number; y: number }[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i] as { x: number; y: number };
    const b = pts[j] as { x: number; y: number };
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * What is under the pointer: points first, then lines, then solid faces, the nearest of each kind. A see-through
 * plane does not take a click (design 9.4: transparent surfaces rank last and only where nothing else is).
 */
export function pick3(hits: readonly Hit3[], x: number, y: number, slop = 8): Hit3 | undefined {
  let best: Hit3 | undefined;
  let bestRank = Infinity;
  let bestDepth = Infinity;
  for (const h of hits) {
    if (h.id < 0) continue;
    let rank: number;
    if (h.k === 'point') {
      if (Math.hypot(h.x - x, h.y - y) > h.r) continue;
      rank = 0;
    } else if (h.k === 'line') {
      if (segDist(x, y, h) > slop / 2 + 2) continue;
      rank = 1;
    } else {
      if (!insidePoly(h.pts, x, y)) continue;
      rank = h.alpha >= 0.3 ? 2 : 3;
    }
    if (rank < bestRank || (rank === bestRank && h.depth < bestDepth)) {
      best = h;
      bestRank = rank;
      bestDepth = h.depth;
    }
  }
  return best;
}

/* ------------------------------ dragging (design 10.1) ------------------------------ */

export type DragMode = 'plane' | 'vertical';

/** The axis plane that faces the camera most: its unit normal. */
export function facingAxis(cam: Camera): V3 {
  const f = cam.forward;
  const ax = Math.abs(f.x);
  const ay = Math.abs(f.y);
  const az = Math.abs(f.z);
  return az >= ax && az >= ay ? { x: 0, y: 0, z: 1 } : ay >= ax ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
}

/**
 * Where the pointer puts a dragged point: on the camera-facing axis plane through where it started, or, with Shift,
 * on the vertical line through it. `undefined` when the pointer ray runs along the plane (looking edge on).
 */
export function dragTo(cam: Camera, from: V3, px: number, py: number, mode: DragMode, normal = facingAxis(cam)): V3 | undefined {
  const ray = pointerRay(cam, px, py);
  if (mode === 'vertical') {
    // the closest point of the vertical line through `from` to the ray (design 10.1)
    const e = { x: 0, y: 0, z: 1 };
    const w = space.sub(ray.o, from);
    const b = space.dot(ray.d, e);
    const den = 1 - b * b;
    if (den < 1e-6) return undefined;
    const s = (space.dot(w, e) - b * space.dot(w, ray.d)) / den;
    return { x: from.x, y: from.y, z: from.z + s };
  }
  const nd = space.dot(normal, ray.d);
  if (Math.abs(nd) < 0.05) return undefined;
  const t = space.dot(normal, space.sub(from, ray.o)) / nd;
  const p = space.add(ray.o, space.scale(ray.d, t));
  // stay exactly on the plane, so a drag in the floor keeps z
  return normal.z === 1 ? { x: p.x, y: p.y, z: from.z } : normal.y === 1 ? { x: p.x, y: from.y, z: p.z } : { x: from.x, y: p.y, z: p.z };
}

/** A grid step move of a selected point by a key (ui.md 5.4), or `undefined` for other keys. */
export function keyMove(key: string, shift: boolean, alt: boolean): V3 | undefined {
  const s = shift ? 10 : alt ? 0.1 : 1;
  switch (key) {
    case 'ArrowLeft': return { x: -s, y: 0, z: 0 };
    case 'ArrowRight': return { x: s, y: 0, z: 0 };
    case 'ArrowUp': return { x: 0, y: s, z: 0 };
    case 'ArrowDown': return { x: 0, y: -s, z: 0 };
    case 'PageUp': return { x: 0, y: 0, z: s };
    case 'PageDown': return { x: 0, y: 0, z: -s };
    default: return undefined;
  }
}

/* ------------------------------ the camera (design 10.4) ------------------------------ */

/** Turning: 0.4° per pixel; dragging right turns the scene right, dragging down tilts it towards the viewer. */
export function orbit(view: space.View3, dx: number, dy: number, degPerPx = 0.4): space.View3 {
  const elevation = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, view.elevation + dy * degPerPx * DEG));
  let azimuth = view.azimuth - dx * degPerPx * DEG;
  // keep the angle in −180°..180° so the line reads well
  azimuth = Math.atan2(Math.sin(azimuth), Math.cos(azimuth));
  return { ...view, azimuth, elevation };
}

/** Panning moves the target in the screen plane, so the point under the pointer stays under it. */
export function pan(view: space.View3, cam: Camera, dx: number, dy: number): space.View3 {
  const k = 1 / cam.scale;
  const d = space.add(space.scale(cam.right, -dx * k), space.scale(cam.up, dy * k));
  return { ...view, target: space.add(view.target, d) };
}

/** Zooming by a factor about a pixel: the point of the target's depth under the pointer stays put. */
export function zoomAt(view: space.View3, cam: Camera, factor: number, px: number, py: number): space.View3 {
  const zoom = Math.max(0.05, Math.min(50, view.zoom * factor));
  const f = zoom / view.zoom;
  const dx = (px - cam.viewport.w / 2) / cam.scale;
  const dy = (cam.viewport.h / 2 - py) / cam.scale;
  const p = space.add(view.target, space.add(space.scale(cam.right, dx), space.scale(cam.up, dy)));
  const target = space.sub(p, space.scale(space.sub(p, view.target), 1 / f));
  return { ...view, zoom, target };
}

const deg = (rad: number): string => `${Number(((rad * 180) / Math.PI).toFixed(2))}deg`;
const num = (x: number): string => String(Number(x.toPrecision(6)));

/** The camera line for what a gesture changed: only the properties that differ are written. */
export function cameraLine(before: space.View3, after: space.View3): string | undefined {
  const parts: string[] = [];
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
  if (!near(before.azimuth, after.azimuth)) parts.push(`azimuth = ${deg(after.azimuth)}`);
  if (!near(before.elevation, after.elevation)) parts.push(`elevation = ${deg(after.elevation)}`);
  if (!near(before.zoom, after.zoom)) parts.push(`zoom = ${num(after.zoom)}`);
  const t = after.target;
  if (!near(before.target.x, t.x) || !near(before.target.y, t.y) || !near(before.target.z, t.z)) parts.push(`target = (${num(t.x)}, ${num(t.y)}, ${num(t.z)})`);
  if (before.projection !== after.projection) parts.push(`projection = ${after.projection}`);
  return parts.length > 0 ? `space with ${parts.join(', ')}` : undefined;
}

/** The camera keys of ui.md 5.4: the line a key writes, or `undefined`. */
export function keyLine(key: string, view: space.View3): string | undefined {
  const presets: Readonly<Record<string, string>> = { '1': 'front', '2': 'back', '3': 'left', '4': 'right', '5': 'top', '6': 'bottom', '0': 'isometric' };
  if (presets[key]) return `ViewPreset(${presets[key] as string})`;
  if (key === 'h' || key === 'H') return 'ViewReset()';
  if (key === 'p' || key === 'P') return `space with projection = ${view.projection === 'persp' ? 'ortho' : 'persp'}`;
  if (key === '+' || key === '=') return `space with zoom = ${num(view.zoom * 1.25)}`;
  if (key === '-') return `space with zoom = ${num(view.zoom / 1.25)}`;
  return undefined;
}
