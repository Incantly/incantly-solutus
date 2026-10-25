import type { CameraMove, CameraOptions, Vec2, Vec3, View3D, ViewBox } from '../../api/types';
import { EASINGS } from '../../runtime/tween';
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

/** Seconds the toolbar's views and reset take: long enough to follow, short enough not to wait for. */
export const TOOLBAR_MOVE_SECONDS = 0.6;
/** Seconds a step's view takes: slower than its values move, so the learner can follow the turn. */
export const STEP_VIEW_SECONDS = 1.2;
/** The longest a scene may ask a camera move to take. */
const MAX_MOVE_SECONDS = 10;

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

/**
 * A camera on its way to a view. Perspective eases as its strength, one over
 * the distance, so going flat fades the perspective out rather than jumping.
 */
interface Flight {
  readonly from: CameraState;
  readonly to: CameraState;
  /** The end yaw, unwrapped so the turn takes the short way round; `to.yaw` is where it lands. */
  readonly yaw: number;
  readonly seconds: number;
  readonly ease: (k: number) => number;
  /** The move's own perspective: true going flat, false back to the figure's own, undefined leaving it. */
  readonly flat: boolean | undefined;
  elapsed: number;
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
  private flight: Flight | null = null;
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
    this.flight = null;
    this.write(this.state, options);
    this.basis();
  }

  /** Eases to the camera options over a move; a move of no time, or none, is set at once. */
  move(options: CameraOptions, move: CameraMove | undefined, cut: boolean): void {
    const to = this.copy(this.flight?.to ?? this.state);
    this.write(to, options);
    this.fly(to, move, cut);
  }

  /** Writes checked camera options into `s`. */
  private write(s: CameraState, options: CameraOptions): void {
    if (typeof options !== 'object' || options === null) throw new SceneApiError('camera needs an options object');
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
  }

  private copy(s: CameraState): CameraState {
    return { ...s, target: [...s.target] as Vec3 };
  }

  /**
   * Starts the camera toward `to`, or puts it there at once when the move
   * takes no time or `cut` is set (reduced motion). A new move starts from
   * wherever the camera is, so moves chain without a jump.
   */
  private fly(to: CameraState, move: CameraMove | undefined, cut: boolean): void {
    const seconds = readMove(move);
    if (move?.flat === true) to.distance = 0;
    else if (move?.flat === false) to.distance = this.start?.distance ?? to.distance;
    // Asked again for where it is going, as a script does on every frame, it keeps going: it does not start over.
    if (!cut && seconds > 0 && same(to, this.flight?.to ?? this.state)) return;
    if (cut || seconds === 0) {
      this.flight = null;
      Object.assign(this.state, to);
      this.basis();
      return;
    }
    const from = this.copy(this.state);
    // The short way round: from 350° to 10° is 20° on, not 340° back.
    const yaw = from.yaw + ((((to.yaw - from.yaw) % 360) + 540) % 360) - 180;
    this.flight = { from, to, yaw, seconds, ease: EASINGS[move?.ease ?? 'inOut'] ?? EASINGS.inOut, flat: move?.flat, elapsed: 0 };
  }

  /** Whether the camera is on its way somewhere. */
  get moving(): boolean {
    return this.flight !== null;
  }

  /** Moves the camera `dt` seconds along its way; returns whether it is still going. */
  advance(dt: number): boolean {
    const f = this.flight;
    if (!f) return false;
    f.elapsed += Math.max(0, dt);
    const raw = Math.min(1, f.elapsed / f.seconds);
    if (raw >= 1) {
      // It lands exactly where it was sent, yaw included, so reset reads as unchanged.
      this.flight = null;
      Object.assign(this.state, this.copy(f.to));
      this.basis();
      return false;
    }
    const k = f.ease(raw);
    const mix = (a: number, b: number) => a + (b - a) * k;
    const s = this.state;
    s.yaw = mix(f.from.yaw, f.yaw);
    s.pitch = mix(f.from.pitch, f.to.pitch);
    s.scale = mix(f.from.scale, f.to.scale);
    s.panX = mix(f.from.panX, f.to.panX);
    s.panY = mix(f.from.panY, f.to.panY);
    s.target = [mix(f.from.target[0], f.to.target[0]), mix(f.from.target[1], f.to.target[1]), mix(f.from.target[2], f.to.target[2])];
    const strength = mix(f.from.distance > 0 ? 1 / f.from.distance : 0, f.to.distance > 0 ? 1 / f.to.distance : 0);
    s.distance = strength > 1e-9 ? 1 / strength : 0;
    this.basis();
    return true;
  }

  /** The learner took hold of the view: the camera stops where it is. */
  stop(): void {
    this.flight = null;
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
    // A move asked for before the first draw, as a script's first frame does, travels in the fitted view, not the unfitted one.
    const f = this.flight;
    if (!f) return;
    for (const end of [f.from, f.to]) {
      if (!this.given.target) end.target = [...s.target] as Vec3;
      if (!this.given.scale) end.scale = s.scale;
      end.panX = 0;
      end.panY = 0;
    }
    if (!this.given.distance) {
      f.from.distance = s.distance;
      if (f.flat !== true) f.to.distance = s.distance;
    }
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

  reset(move?: CameraMove, cut = false): void {
    if (!this.start) return;
    this.fly(this.copy(this.start), move, cut);
  }

  view(name: View3D, move?: CameraMove, cut = false): void {
    const preset = VIEWS[name];
    if (!preset) throw new SceneApiError(`Unknown view "${String(name)}"; use ${VIEW_NAMES.join(', ')}`);
    if (this.locked === 'iso') return;
    const to = this.copy(this.flight?.to ?? this.state);
    to.yaw = preset.yaw;
    to.pitch = preset.pitch;
    this.fly(to, move, cut);
  }

  orbit(dx: number, dy: number): boolean {
    if (this.locked !== 'orbit' || !Number.isFinite(dx) || !Number.isFinite(dy)) return false;
    this.flight = null;
    this.state.yaw -= dx * ORBIT_YAW;
    this.state.pitch = Math.max(-89, Math.min(89, this.state.pitch + dy * ORBIT_PITCH));
    this.basis();
    return true;
  }

  /** Zooms about a stage point, which stays under the pointer. */
  zoom(x: number, y: number, factor: number): boolean {
    if (!(Number.isFinite(factor) && factor > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    this.flight = null;
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
    this.flight = null;
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

/** A move's seconds, checked: 0 cuts, and no move takes longer than MAX_MOVE_SECONDS. */
function readMove(move: CameraMove | undefined): number {
  if (move === undefined) return 0;
  if (typeof move !== 'object' || move === null) throw new SceneApiError('A camera move is an object such as { seconds: 1.5 }');
  const seconds = move.seconds ?? 0;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) throw new SceneApiError('A camera move needs seconds of 0 or more');
  if (move.ease !== undefined && !Object.hasOwn(EASINGS, move.ease)) throw new SceneApiError(`Unknown ease "${String(move.ease)}"; use ${Object.keys(EASINGS).join(', ')}`);
  if (move.flat !== undefined && typeof move.flat !== 'boolean') throw new SceneApiError('A camera move\'s flat is true or false');
  return Math.min(seconds, MAX_MOVE_SECONDS);
}


/** Whether two camera states show the same view; yaw counts round the circle. */
function same(a: CameraState, b: CameraState): boolean {
  const near = (x: number, y: number) => Math.abs(x - y) < 1e-6;
  return (
    near((((a.yaw - b.yaw) % 360) + 360) % 360, 0) &&
    near(a.pitch, b.pitch) &&
    near(a.scale, b.scale) &&
    near(a.distance, b.distance) &&
    near(a.panX, b.panX) &&
    near(a.panY, b.panY) &&
    a.target.every((v, i) => near(v, b.target[i]!))
  );
}
