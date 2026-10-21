import type { CameraOptions, Vec2, Vec3, View3D, ViewBox } from '../../api/types';
import { SceneApiError } from '../../scene/errors';

/**
 * The 3D camera (C3-2): yaw about the upright z axis, pitch down toward the
 * target, a scale in stage units per world unit and weak perspective from a
 * distance. Camera space has x to the right, y up and z toward the viewer.
 */

export const VIEWS: Readonly<Record<View3D, { readonly yaw: number; readonly pitch: number }>> = Object.freeze({
  front: { yaw: -90, pitch: 0 },
  side: { yaw: 0, pitch: 0 },
  top: { yaw: -90, pitch: 90 },
  iso: { yaw: 45, pitch: (Math.atan(Math.SQRT1_2) * 180) / Math.PI },
});

export const VIEW_NAMES = Object.keys(VIEWS) as View3D[];

/** How far the learner may zoom from the starting view. */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
/** Degrees the camera turns for a drag across the whole stage. */
const ORBIT_YAW = 220;
const ORBIT_PITCH = 160;

export interface CameraState {
  yaw: number;
  pitch: number;
  scale: number;
  /** 0 for no perspective. */
  distance: number;
  target: Vec3;
  /** Stage units the view is moved by. */
  panX: number;
  panY: number;
}

/** A projected point: stage x and y, and how much nearer points are enlarged. */
export interface Projected {
  readonly x: number;
  readonly y: number;
  readonly k: number;
}

function finite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new SceneApiError(`camera ${name} must be a finite number`);
  return value;
}

function vec3(value: unknown, name: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new SceneApiError(`${name} must be three finite numbers [x, y, z]`);
  }
  return [value[0], value[1], value[2]];
}

export { vec3 as readVec3 };

export class Camera {
  readonly state: CameraState;
  /** Where reset returns to; fixed by the first draw. */
  private start: CameraState | null = null;
  /** Set by the scene: the fit must not override them. */
  private readonly given: { scale: boolean; distance: boolean; target: boolean };
  private right: Vec3 = [0, 1, 0];
  private up: Vec3 = [0, 0, 1];
  private back: Vec3 = [1, 0, 0];
  readonly cx: number;
  readonly cy: number;
  readonly size: number;

  constructor(
    viewBox: ViewBox,
    options: CameraOptions | undefined,
    readonly locked: 'orbit' | 'iso' | 'fixed',
  ) {
    const [x, y, w, h] = viewBox;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.size = Math.min(w, h);
    const iso = locked === 'iso';
    this.state = {
      yaw: iso ? VIEWS.iso.yaw : 35,
      pitch: iso ? VIEWS.iso.pitch : 25,
      scale: 1,
      distance: 0,
      target: [0, 0, 0],
      panX: 0,
      panY: 0,
    };
    this.given = { scale: false, distance: iso, target: false };
    this.set(options ?? {});
  }

  /** Applies camera options. Before the first draw they also decide where reset returns to. */
  set(options: CameraOptions): void {
    if (typeof options !== 'object' || options === null) throw new SceneApiError('camera needs an options object');
    const s = this.state;
    if (this.locked !== 'iso') {
      if (options.yaw !== undefined) s.yaw = finite(options.yaw, 'yaw');
      if (options.pitch !== undefined) s.pitch = Math.max(-90, Math.min(90, finite(options.pitch, 'pitch')));
    }
    if (options.scale !== undefined) {
      const scale = finite(options.scale, 'scale');
      if (!(scale > 0)) throw new SceneApiError('camera scale must be above 0');
      s.scale = scale;
      this.given.scale = true;
    }
    if (options.distance !== undefined && this.locked !== 'iso') {
      const distance = finite(options.distance, 'distance');
      if (distance < 0) throw new SceneApiError('camera distance must be 0 (no perspective) or more');
      s.distance = distance;
      this.given.distance = true;
    }
    if (options.target !== undefined) {
      s.target = vec3(options.target, 'camera target');
      this.given.target = true;
    }
    this.basis();
  }

  /** Before the first draw: fits the view to what is drawn, then remembers it as the start. */
  settle(centre: Vec3, radius: number): void {
    if (this.start) return;
    this.fit(centre, radius);
    this.start = { ...this.state, target: [...this.state.target] as Vec3 };
  }

  fit(centre: Vec3, radius: number): void {
    const r = radius > 1e-9 ? radius : 1;
    const s = this.state;
    if (!this.given.target) s.target = centre;
    if (!this.given.distance) s.distance = this.locked === 'iso' ? 0 : 5 * r;
    if (!this.given.scale) {
      // Nearer parts are enlarged by up to d / (d - r).
      const perspective = s.distance > 0 ? (s.distance - r) / s.distance : 1;
      s.scale = ((0.44 * this.size) / r) * perspective;
    }
    s.panX = 0;
    s.panY = 0;
  }

  changed(): boolean {
    const a = this.state;
    const b = this.start;
    if (!b) return false;
    return (
      Math.abs(a.yaw - b.yaw) > 1e-6 ||
      Math.abs(a.pitch - b.pitch) > 1e-6 ||
      Math.abs(a.scale / b.scale - 1) > 1e-6 ||
      Math.abs(a.panX - b.panX) > 1e-6 ||
      Math.abs(a.panY - b.panY) > 1e-6
    );
  }

  reset(): void {
    if (!this.start) return;
    Object.assign(this.state, this.start, { target: [...this.start.target] });
    this.basis();
  }

  view(name: View3D): void {
    const preset = VIEWS[name];
    if (!preset) throw new SceneApiError(`Unknown view "${String(name)}"; use ${VIEW_NAMES.join(', ')}`);
    if (this.locked === 'iso') return;
    this.state.yaw = preset.yaw;
    this.state.pitch = preset.pitch;
    this.basis();
  }

  orbit(dx: number, dy: number): boolean {
    if (this.locked !== 'orbit' || !Number.isFinite(dx) || !Number.isFinite(dy)) return false;
    this.state.yaw -= dx * ORBIT_YAW;
    this.state.pitch = Math.max(-89, Math.min(89, this.state.pitch + dy * ORBIT_PITCH));
    this.basis();
    return true;
  }

  /** Zooms about a stage point, which stays under the pointer. */
  zoom(x: number, y: number, factor: number): boolean {
    if (!(Number.isFinite(factor) && factor > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const s = this.state;
    const base = this.start?.scale ?? s.scale;
    const next = Math.min(base * MAX_ZOOM, Math.max(base * MIN_ZOOM, s.scale * factor));
    const k = next / s.scale;
    if (k === 1) return false;
    s.panX = x - this.cx - (x - this.cx - s.panX) * k;
    s.panY = y - this.cy - (y - this.cy - s.panY) * k;
    s.scale = next;
    return true;
  }

  pan(dx: number, dy: number): boolean {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
    this.state.panX += dx;
    this.state.panY += dy;
    return true;
  }

  private basis(): void {
    const yaw = (this.state.yaw * Math.PI) / 180;
    const pitch = (this.state.pitch * Math.PI) / 180;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    this.right = [-sy, cy, 0];
    this.up = [-sp * cy, -sp * sy, cp];
    this.back = [cp * cy, cp * sy, sp];
  }

  /** World to camera space: x right, y up, z toward the viewer. */
  toCamera(p: Vec3): Vec3 {
    const [tx, ty, tz] = this.state.target;
    const dx = p[0] - tx;
    const dy = p[1] - ty;
    const dz = p[2] - tz;
    const r = this.right;
    const u = this.up;
    const b = this.back;
    return [dx * r[0] + dy * r[1] + dz * r[2], dx * u[0] + dy * u[1] + dz * u[2], dx * b[0] + dy * b[1] + dz * b[2]];
  }

  /** The direction toward the viewer, in world space. */
  get toViewer(): Vec3 {
    return this.back;
  }

  /** Whether a camera-space depth is in front of the camera. */
  visible(z: number): boolean {
    const d = this.state.distance;
    return d <= 0 || z < d * 0.92;
  }

  /** Camera space to the stage, with the perspective factor. */
  project(c: Vec3): Projected {
    const s = this.state;
    const k = s.distance > 0 ? s.distance / Math.max(s.distance * 0.08, s.distance - c[2]) : 1;
    return { x: this.cx + s.panX + c[0] * s.scale * k, y: this.cy + s.panY - c[1] * s.scale * k, k };
  }

  /** The world point in the plane z = height under a stage point, or null when the view ray runs parallel or away. */
  pick(x: number, y: number, height: number): Vec3 | null {
    const s = this.state;
    const px = (x - this.cx - s.panX) / s.scale;
    const py = -(y - this.cy - s.panY) / s.scale;
    // The view ray in camera space: from the eye through the point on the picture plane,
    // or, without perspective, the line straight through the point.
    const perspective = s.distance > 0;
    const origin: Vec3 = perspective ? [0, 0, s.distance] : [px, py, 0];
    const dir: Vec3 = perspective ? [px, py, -s.distance] : [0, 0, -1];
    const toWorld = (c: Vec3): Vec3 => {
      const r = this.right;
      const u = this.up;
      const b = this.back;
      return [c[0] * r[0] + c[1] * u[0] + c[2] * b[0], c[0] * r[1] + c[1] * u[1] + c[2] * b[1], c[0] * r[2] + c[1] * u[2] + c[2] * b[2]];
    };
    const o = toWorld(origin);
    const d = toWorld(dir);
    const [tx, ty, tz] = s.target;
    if (Math.abs(d[2]) < 1e-9) return null;
    const t = (height - (o[2] + tz)) / d[2];
    if (perspective && !(t > 0)) return null;
    return [o[0] + tx + d[0] * t, o[1] + ty + d[1] * t, height];
  }

  /** The stage point of the camera's target. */
  centre(): Vec2 {
    return [this.cx + this.state.panX, this.cy + this.state.panY];
  }
}
