/**
 * The camera of a page (design 9). `x, y` is the page point at the top-left of the screen and `zoom` the screen pixels
 * of one page unit, so `screen = (page - xy) * zoom`. Zoom runs from 0.05 to 20 and is changed about a screen point,
 * which stays still. The steady zoom (what stroke widths and tiles use) follows the zoom 150 ms after the last zoom
 * change (`CAMERA_MACHINE`, docs/state-machines.md B4). The core never reads a clock: every call that needs time gets
 * `now` in milliseconds from the input layer. A number that is not finite is ignored.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import { ZOOM_MAX, ZOOM_MIN } from './check';
import { boardError, ok, refusedMove } from './errors';
import type { BoardResult, ErrorSink } from './errors';
import type { Store } from './store';
import { isCamera, isPage } from './types';
import type { Bounds, CameraRecord } from './types';

export { ZOOM_MAX, ZOOM_MIN };

/** The steady zoom catches up this long after the last zoom change. */
export const STEADY_DELAY_MS = 150;

type ZoomState = 'steady' | 'zooming';
type ZoomEvent = 'zoom' | 'settle';

export const CAMERA_MACHINE: MachineTable<ZoomState, ZoomEvent> = {
  steady: { zoom: 'zooming' },
  zooming: { zoom: 'zooming', settle: 'steady' },
};

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface CameraView {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

const clampZoom = (z: number): number => (z < ZOOM_MIN ? ZOOM_MIN : z > ZOOM_MAX ? ZOOM_MAX : z);
const finite = (...values: readonly number[]): boolean => values.every((v) => Number.isFinite(v));

/** A screen point as a page point. */
export function toPage(camera: CameraView, sx: number, sy: number): Point {
  return { x: sx / camera.zoom + camera.x, y: sy / camera.zoom + camera.y };
}

/** A page point as a screen point. */
export function toScreen(camera: CameraView, px: number, py: number): Point {
  return { x: (px - camera.x) * camera.zoom, y: (py - camera.y) * camera.zoom };
}

export class Camera implements CameraView {
  #x: number;
  #y: number;
  #zoom: number;
  #steadyZoom: number;
  #changedAt = 0;
  readonly #report: ErrorSink | undefined;
  readonly #machine = new StateMachine(CAMERA_MACHINE, 'steady', refusedMove('camera', () => this.#report));

  constructor(initial: Partial<CameraView> = {}, report?: ErrorSink) {
    this.#report = report;
    this.#x = finite(initial.x ?? 0) ? (initial.x ?? 0) : 0;
    this.#y = finite(initial.y ?? 0) ? (initial.y ?? 0) : 0;
    const z = initial.zoom ?? 1;
    this.#zoom = Number.isFinite(z) ? clampZoom(z) : 1;
    this.#steadyZoom = this.#zoom;
  }

  get x(): number {
    return this.#x;
  }

  get y(): number {
    return this.#y;
  }

  get zoom(): number {
    return this.#zoom;
  }

  /** The zoom that tiles, stroke widths and text use; it lags the zoom by 150 ms. */
  get steadyZoom(): number {
    return this.#steadyZoom;
  }

  /** `zooming` while the zoom changed less than 150 ms ago, else `steady`. */
  get motion(): 'steady' | 'zooming' {
    return this.#machine.state;
  }

  toPage(sx: number, sy: number): Point {
    return toPage(this, sx, sy);
  }

  toScreen(px: number, py: number): Point {
    return toScreen(this, px, py);
  }

  /** The page box a screen of this size shows, grown by `margin` screen pixels on every side. */
  visibleBounds(width: number, height: number, margin = 0): Bounds {
    const m = margin / this.#zoom;
    return {
      minX: this.#x - m,
      minY: this.#y - m,
      maxX: this.#x + width / this.#zoom + m,
      maxY: this.#y + height / this.#zoom + m,
    };
  }

  /** Moves the view by a drag of `dx, dy` screen pixels (the page follows the pointer). */
  panBy(dx: number, dy: number): void {
    if (!finite(dx, dy)) return;
    this.#x -= dx / this.#zoom;
    this.#y -= dy / this.#zoom;
  }

  /** Sets the zoom (clamped to 0.05 to 20) so the page point under screen point `sx, sy` stays under it. */
  zoomAbout(zoom: number, sx: number, sy: number, now: number): void {
    if (!finite(zoom, sx, sy, now)) return;
    const next = clampZoom(zoom);
    if (next === this.#zoom) return;
    this.#x += sx / this.#zoom - sx / next;
    this.#y += sy / this.#zoom - sy / next;
    this.#zoom = next;
    this.#zoomed(now);
  }

  /** Multiplies the zoom by `factor` about a screen point (a wheel step, a pinch). */
  zoomBy(factor: number, sx: number, sy: number, now: number): void {
    if (!finite(factor) || factor <= 0) return;
    this.zoomAbout(this.#zoom * factor, sx, sy, now);
  }

  /** Puts the camera at `x, y, zoom` (a saved camera, an agent's move). */
  moveTo(x: number, y: number, zoom: number, now: number): void {
    if (!finite(x, y, zoom, now)) return;
    this.#x = x;
    this.#y = y;
    const next = clampZoom(zoom);
    if (next === this.#zoom) return;
    this.#zoom = next;
    this.#zoomed(now);
  }

  /**
   * Call with the input layer's time on every frame while `motion` is `zooming`. Returns true when the steady zoom
   * has just caught up with the zoom (the moment to draw the exact tiles).
   */
  tick(now: number): boolean {
    if (!Number.isFinite(now) || !this.#machine.is('zooming')) return false;
    if (now >= this.#changedAt && now - this.#changedAt < STEADY_DELAY_MS) return false;
    this.#machine.send('settle');
    this.#steadyZoom = this.#zoom;
    return true;
  }

  #zoomed(now: number): void {
    this.#changedAt = now;
    this.#machine.send('zoom');
  }
}

/** The id of the camera record of a page. */
export const cameraIdOf = (page: string): string => `camera:${page.startsWith('page:') ? page.slice(5) : page}`;

/**
 * The cameras of a board, one per page, made when first asked for from the page's saved camera. Moving a camera does
 * not write the store; `save` writes the record, outside the undo history.
 */
export class Cameras {
  readonly #store: Store;
  readonly #cameras = new Map<string, Camera>();
  readonly #stop: () => void;

  constructor(store: Store) {
    this.#store = store;
    this.#stop = store.on((diff) => {
      for (const r of diff.removed) if (isPage(r)) this.#cameras.delete(r.id);
    });
  }

  dispose(): void {
    this.#stop();
  }

  /** The camera of a page; `bad_argument` when there is no such page. */
  /** The camera of `page` when it has been made, else undefined. */
  known(page: string): Camera | undefined {
    return this.#cameras.get(page);
  }

  forPage(page: string): BoardResult<Camera> {
    const known = this.#cameras.get(page);
    if (known !== undefined) return ok(known);
    const rec = this.#store.get(page);
    if (rec === undefined || !isPage(rec)) return boardError('bad_argument', `There is no page "${page}".`, { detail: { page } });
    const saved = this.#store.get(cameraIdOf(page));
    const camera = new Camera(saved !== undefined && isCamera(saved) ? saved : {}, this.#store.sink);
    this.#cameras.set(page, camera);
    return ok(camera);
  }

  /** Writes the page's camera into the store as a record, with `history: false`. */
  save(page: string): BoardResult<CameraRecord> {
    const camera = this.forPage(page);
    if (!camera.ok) return camera;
    const record: CameraRecord = { id: cameraIdOf(page), page, x: camera.value.x, y: camera.value.y, zoom: camera.value.zoom };
    const done = this.#store.change('user', (tx) => tx.put(record), { history: false });
    if (!done.ok) return done;
    return ok(record);
  }
}
