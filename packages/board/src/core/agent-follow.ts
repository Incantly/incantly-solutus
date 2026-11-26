/**
 * Where the camera goes so an agent's new work stays on screen (agent.md 2). Pure arithmetic: the runner applies it
 * and decides when the user has taken the camera. The zoom never increases. It drops only when the group does not fit
 * at the zoom the user already has, and it stays inside the camera's limits.
 */
import { ZOOM_MAX, ZOOM_MIN } from './check';
import type { Bounds } from './types';

/** Screen pixels kept around a group the board frames on its own. */
export const FOLLOW_PAD = 48;

/** The camera pose follow claims: page point at the top left, and screen pixels per page unit. */
export interface FollowPose {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

const clampZoom = (z: number): number => (z < ZOOM_MIN ? ZOOM_MIN : z > ZOOM_MAX ? ZOOM_MAX : z);

/** True when `box` sits inside `view`, with one page unit of slack so a hair of rounding does not move the camera. */
export function insideView(view: Bounds, box: Bounds): boolean {
  return box.minX >= view.minX - 1 && box.minY >= view.minY - 1 && box.maxX <= view.maxX + 1 && box.maxY <= view.maxY + 1;
}

/** True when the working point is inside the view. A point on the edge still counts as visible. */
export function pointInView(view: Bounds, at: { readonly x: number; readonly y: number }): boolean {
  return at.x >= view.minX && at.x <= view.maxX && at.y >= view.minY && at.y <= view.maxY;
}

/**
 * The pose that fits `bounds` in a screen of `size`. The zoom is the current one, or lower when the box does not fit
 * with padding. A small box that is off screen is centred at the current zoom, not enlarged.
 */
export function framePose(bounds: Bounds, size: { readonly w: number; readonly h: number }, currentZoom: number): FollowPose {
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const pad = Math.min(FOLLOW_PAD, size.w / 6, size.h / 6);
  const fit = Math.min(Math.max(1, size.w - pad * 2) / bw, Math.max(1, size.h - pad * 2) / bh);
  const zoom = clampZoom(Math.min(currentZoom > 0 ? currentZoom : 1, fit));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { x: cx - size.w / zoom / 2, y: cy - size.h / zoom / 2, zoom };
}

/** The pose that puts `at` in the middle of the screen and keeps the zoom. */
export function panPose(at: { readonly x: number; readonly y: number }, size: { readonly w: number; readonly h: number }, zoom: number): FollowPose {
  const z = clampZoom(zoom > 0 ? zoom : 1);
  return { x: at.x - size.w / z / 2, y: at.y - size.h / z / 2, zoom: z };
}

/** True when this call asked for a view and that action succeeded, so the automatic frame must leave it. */
export function cameraSucceeded(actions: readonly unknown[], results: readonly { readonly ok: boolean }[]): boolean {
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (typeof action === 'object' && action !== null && (action as { op?: unknown }).op === 'camera' && results[i]?.ok === true) return true;
  }
  return false;
}
