/**
 * From input samples to stroke points (design 6.1). `PointBuffer` is a `Float32Array` that grows by doubling and holds
 * `x, y, pressure` (and `tiltX, tiltY`) per point, relative to the stroke's origin. `InkSampler` turns each
 * `InputSample` into a point: it turns screen pixels into page units with the camera, drops a sample closer than 0.5
 * screen pixels to the last kept one unless pressure changed by more than 0.05, and simulates pressure from speed when
 * the device gives none (a mouse, or a pen that only reports 0.5). It allocates nothing per sample once its buffer is
 * big enough. No DOM, no timers, no `Date`.
 */
import type { CameraView } from '../camera';
import type { InputSample } from '../input';

/** Numbers per point: `x, y, pressure`, or with tilt `x, y, pressure, tiltX, tiltY`. */
export type Stride = 3 | 5;

/** A sample closer than this many screen pixels to the last kept one is dropped. */
export const MIN_DISTANCE_PX = 0.5;
/** …unless pressure changed by more than this. */
export const MIN_PRESSURE_STEP = 0.05;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** A `Float32Array` of points that grows by doubling. Its own memory: no stored record ever holds it (BR-10). */
export class PointBuffer {
  readonly stride: Stride;
  #data: Float32Array;
  #count = 0;

  constructor(stride: Stride, capacity = 256) {
    this.stride = stride;
    this.#data = new Float32Array(Math.max(8, capacity) * stride);
  }

  /** The number of points. */
  get count(): number {
    return this.#count;
  }

  /** The backing array: only the first `count * stride` numbers are points. A growth replaces it. */
  get array(): Float32Array {
    return this.#data;
  }

  push(x: number, y: number, pressure: number, tiltX = 0, tiltY = 0): void {
    const at = this.reserve();
    this.#data[at] = x;
    this.#data[at + 1] = y;
    this.#data[at + 2] = pressure;
    if (this.stride === 5) {
      this.#data[at + 3] = tiltX;
      this.#data[at + 4] = tiltY;
    }
  }

  /**
   * Makes room for one more point, counts it, and returns where its numbers go in `array` (read `array` after the call: a
   * growth replaces it). A hot caller writes the numbers itself, so none is boxed as an argument (BR-77).
   */
  reserve(): number {
    const s = this.stride;
    if ((this.#count + 1) * s > this.#data.length) {
      const grown = new Float32Array(this.#data.length * 2);
      grown.set(this.#data);
      this.#data = grown;
    }
    const at = this.#count * s;
    this.#count++;
    return at;
  }

  /** The last point's number `k` (0 x, 1 y, 2 pressure), or 0 when empty. */
  last(k: number): number {
    return this.#count === 0 ? 0 : (this.#data[(this.#count - 1) * this.stride + k] ?? 0);
  }

  /** A new array holding the points, for a record: it shares nothing with this buffer. */
  copy(): Float32Array {
    return this.#data.slice(0, this.#count * this.stride);
  }

  clear(): void {
    this.#count = 0;
  }
}

/** Pressure from speed: slow is full, fast is thin (design 6.1). */
const SIM_MIN = 0.2;
const SIM_START = 0.6;
/** Screen pixels per millisecond at which simulated pressure reaches its thinnest. */
const SIM_FAST = 3;
const SIM_EASE = 0.3;

/**
 * Turns samples into points. One sampler per live stroke; `begin` starts a stroke at its first sample and `add` adds
 * the next ones. The origin is the first sample's page position, so stored points stay small numbers.
 */
export class InkSampler {
  readonly buffer: PointBuffer;
  /** The stroke's origin in page units: where the first sample was. */
  originX = 0;
  originY = 0;
  #lastSx = 0;
  #lastSy = 0;
  #lastTime = 0;
  #pressure = SIM_START;

  constructor(stride: Stride, capacity?: number) {
    this.buffer = new PointBuffer(stride, capacity);
  }

  /** Forgets the stroke so far. */
  reset(): void {
    this.buffer.clear();
    this.originX = 0;
    this.originY = 0;
    this.#pressure = SIM_START;
  }

  /**
   * Adds a sample: the camera turns its screen position into page units. Returns true when it was kept, false when
   * the 0.5 px filter dropped it. The first sample is always kept.
   */
  add(s: InputSample, camera: CameraView): boolean {
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) return false;
    const first = this.buffer.count === 0;
    const px = s.x / camera.zoom + camera.x;
    const py = s.y / camera.zoom + camera.y;
    let pressure: number;
    if (Number.isFinite(s.pressure)) {
      pressure = clamp(s.pressure, 0, 1);
    } else if (first) {
      pressure = SIM_START;
    } else {
      const dt = Math.max(1, s.time - this.#lastTime);
      const sx = s.x - this.#lastSx;
      const sy = s.y - this.#lastSy;
      const speed = Math.sqrt(sx * sx + sy * sy) / dt;
      const target = 1 - (1 - SIM_MIN) * Math.pow(clamp(speed / SIM_FAST, 0, 1), 0.7);
      pressure = this.#pressure + (target - this.#pressure) * SIM_EASE;
    }
    if (!first) {
      // written out: `Math.hypot` puts its answer on the heap (BR-77)
      const mx = s.x - this.#lastSx;
      const my = s.y - this.#lastSy;
      const moved = Math.sqrt(mx * mx + my * my);
      const steady = Math.abs(pressure - this.buffer.last(2)) <= MIN_PRESSURE_STEP;
      if (moved < MIN_DISTANCE_PX && steady) return false;
    } else {
      this.originX = px;
      this.originY = py;
    }
    this.#pressure = pressure;
    this.#lastSx = s.x;
    this.#lastSy = s.y;
    this.#lastTime = s.time;
    // the numbers are written straight into the buffer: as arguments of a call they would be boxed at every sample (BR-77)
    const buf = this.buffer;
    const at = buf.reserve();
    const a = buf.array;
    a[at] = px - this.originX;
    a[at + 1] = py - this.originY;
    a[at + 2] = pressure;
    if (buf.stride === 5) {
      a[at + 3] = clamp(s.tiltX, -90, 90);
      a[at + 4] = clamp(s.tiltY, -90, 90);
    }
    return true;
  }
}
