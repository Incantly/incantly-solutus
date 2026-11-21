/**
 * The outline of a stroke (design 6.2), our own code with no library. From a stroke's points it makes triangles:
 *
 * 1. streamline: each point is blended with its neighbours two steps each way, weighted by distance, so a shaky hand
 *    gives a steady line; the two ends stay where they were;
 * 2. width at each point: `size * (1 - thinning + thinning * ease(pressure))`, widened across the tilt direction for
 *    the nibs that use tilt, then smoothed over three points;
 * 3. offsets: each point gets a left and a right vertex half a width from it, on the bisector of the two segments;
 *    a turn of more than 30° gets its own vertices on each segment and a round arc on the outer side, so the line
 *    does not pinch (the design's 120° is the case where the arc is always needed);
 * 4. round caps at both ends and a disc for a single point.
 *
 * The pieces (one quad per segment, a fan per cap and per corner) are written as indexed triangles, all with the same
 * winding, so their union is the stroke. A stroke is drawn from these triangles by the GPU painter and by the Canvas 2D
 * backup; the outline of a stored stroke is cached by its points (`OutlineCache`). `Outliner` keeps and grows its
 * arrays, and a live stroke calls `extend` each frame: the points that cannot change any more (the streamlining and
 * the width reach three points each way) are kept from the last call, and only the last few segments are made again,
 * so a frame costs the same however long the stroke is and makes no garbage (BR-16).
 *
 * The triangles are grouped: group 0 is the start cap and the first segment, group g the segment g, the last group the
 * end cap. `marks[g]` is the index where group g starts, so the live layer draws only the groups it has not drawn yet.
 * No DOM, no timers, no `Date`.
 */
import type { Bounds } from '../types';
import type { Stride } from './samples';

export type Nib = 'pen' | 'marker' | 'pencil' | 'highlighter';
export const NIBS: readonly Nib[] = ['pen', 'marker', 'pencil', 'highlighter'];

export interface NibSpec {
  /** How much pressure changes the width: 0 is a constant width. */
  readonly thinning: number;
  /** How much a point is blended with its neighbours: 0 to 1. */
  readonly streamline: number;
  /** True when the nib is wider across the tilt direction (design 6.1, item 4). */
  readonly tilt: boolean;
}

export const NIB_SPECS: Readonly<Record<Nib, NibSpec>> = Object.freeze({
  pen: { thinning: 0.6, streamline: 0.5, tilt: false },
  marker: { thinning: 0.2, streamline: 0.4, tilt: true },
  pencil: { thinning: 0.35, streamline: 0.3, tilt: false },
  highlighter: { thinning: 0, streamline: 0.5, tilt: true },
});

export interface OutlineOptions {
  readonly size: number;
  readonly nib: Nib;
  /** The farthest the arcs may be from the true circle, in page units (a quarter of a device pixel is plenty). */
  readonly tolerance: number;
}

/** The finished triangles of one stroke, in the stroke's own coordinates (relative to the shape's origin). */
export interface Outline {
  /** `x, y` pairs. */
  readonly vertices: Float32Array;
  /** Triangle corner numbers into `vertices`, three per triangle, all the same winding. */
  readonly indices: Uint32Array;
  readonly bounds: Bounds;
}

/** A turn sharper than this (cosine of 30°) gets its own vertices and an arc. */
const COS_ARC = 0.866;
/** Points closer than this are one point. */
const SAME_POINT = 1e-3;
/** The widest the tilt makes a nib: 1 plus this at a full tilt across the stroke. */
const TILT_WIDEN = 0.6;
const TAU = Math.PI * 2;
/**
 * Point `i` is final once point `i + SETTLED` exists: the streamlining reads two points each way, the width reads its
 * neighbours' smoothed values (three each way) and the tilt width reads the next direction (four). Eight leaves a margin.
 */
const SETTLED = 8;

/** The distance of `(dx, dy)`: `Math.hypot` makes a number on the heap each call, this does not. */
const dist = (dx: number, dy: number): number => Math.sqrt(dx * dx + dy * dy);

/** A bigger array with the numbers of the old one. */
function grown64(old: Float64Array, size: number): Float64Array<ArrayBuffer> {
  const next = new Float64Array(size);
  next.set(old);
  return next;
}

const ease = (p: number): number => {
  const c = p < 0 ? 0 : p > 1 ? 1 : p;
  return c * c * (3 - 2 * c);
};

/** The angle step of an arc of radius `r` that stays within `tolerance` of the circle. */
function arcStep(r: number, tolerance: number): number {
  const t = tolerance > 0 ? tolerance : 0.1;
  const ratio = Math.min(1, t / Math.max(r, 1e-9));
  const step = 2 * Math.acos(1 - ratio);
  return step < 0.15 ? 0.15 : step > 0.9 ? 0.9 : step;
}

/** Turns points into triangles, reusing its arrays; read the result before the next `build`. */
export class Outliner {
  #vx = new Float32Array(512);
  #vcount = 0;
  #ix = new Uint32Array(1536);
  #icount = 0;
  #marks = new Uint32Array(128);
  #groups = 0;
  #minX = 0;
  #minY = 0;
  #maxX = 0;
  #maxY = 0;
  // scratch, one number per point
  #px = new Float64Array(128);
  #py = new Float64Array(128);
  #pp = new Float64Array(128);
  #tx = new Float64Array(128);
  #ty = new Float64Array(128);
  #sx = new Float64Array(128);
  #sy = new Float64Array(128);
  #sp = new Float64Array(128);
  #w = new Float64Array(128);
  #w2 = new Float64Array(128);
  #ux = new Float64Array(128);
  #uy = new Float64Array(128);
  // what the last build or extend left, so `extend` can go on from it
  #rawDone = 0;
  #pointsDone = 0;
  #made = false;
  #stride: Stride = 3;
  #size = 0;
  #nib: Nib = 'pen';
  #tolerance = 0;
  /** The first iteration of `#strokeOf` that is not final; everything before it is kept. */
  #settled = 0;
  #cpVertices = 0;
  #cpIndices = 0;
  #cpLeft = 0;
  #cpRight = 0;
  #cpMinX = 0;
  #cpMinY = 0;
  #cpMaxX = 0;
  #cpMaxY = 0;

  /** `x, y` pairs of the last build; only the first `vertexCount * 2` numbers count. */
  get vertices(): Float32Array {
    return this.#vx;
  }

  get vertexCount(): number {
    return this.#vcount;
  }

  get indices(): Uint32Array {
    return this.#ix;
  }

  get indexCount(): number {
    return this.#icount;
  }

  /** Where each group of triangles starts in `indices`; `marks[groups]` is the end. */
  get marks(): Uint32Array {
    return this.#marks;
  }

  /** The number of groups: 1 for a dot, else one for each point (segments, then the end cap). */
  get groups(): number {
    return this.#groups;
  }

  get bounds(): Bounds {
    return { minX: this.#minX, minY: this.#minY, maxX: this.#maxX, maxY: this.#maxY };
  }

  /** A copy of the result that owns its arrays, for a cache. */
  snapshot(): Outline {
    return { vertices: this.#vx.slice(0, this.#vcount * 2), indices: this.#ix.slice(0, this.#icount), bounds: this.bounds };
  }

  /** Builds the outline of `count` points of `stride` numbers each, from nothing. A stroke with no point gives no triangles. */
  build(points: Float32Array, count: number, stride: Stride, opts: OutlineOptions): void {
    this.#run(points, count, stride, opts, false);
  }

  /** Forgets what was built, so the next `extend` starts a new stroke. */
  reset(): void {
    this.#made = false;
  }

  /**
   * The same result as `build`, for a stroke that only grew since the last `build` or `extend` of this outliner: the
   * points it had are unchanged and `opts` are the same. It keeps what cannot change any more and makes the last few
   * segments again. A call that does not fit (other style, fewer points, nothing built yet) builds from nothing.
   */
  extend(points: Float32Array, count: number, stride: Stride, opts: OutlineOptions): void {
    this.#run(points, count, stride, opts, true);
  }

  #run(points: Float32Array, count: number, stride: Stride, opts: OutlineOptions, grow: boolean): void {
    const size = Number.isFinite(opts.size) && opts.size > 0 ? opts.size : 1;
    const spec = NIB_SPECS[opts.nib];
    const n = Math.min(count, Math.floor(points.length / stride));
    const resume =
      grow && this.#made && stride === this.#stride && size === this.#size && opts.nib === this.#nib && opts.tolerance === this.#tolerance && n >= this.#rawDone;
    const keepFrom = resume ? this.#settled : 0;
    const rawFrom = resume ? this.#rawDone : 0;
    const pointsFrom = resume ? this.#pointsDone : 0;
    // the numbers of the points before `from` were made by an earlier call and do not change
    const from = keepFrom > 3 ? keepFrom - 3 : 0;
    this.#vcount = 0;
    this.#icount = 0;
    this.#groups = 0;
    this.#minX = this.#minY = Infinity;
    this.#maxX = this.#maxY = -Infinity;
    this.#made = false;
    const m = this.#dedupe(points, n, stride, spec.tilt, rawFrom, pointsFrom);
    this.#rawDone = n;
    this.#pointsDone = m;
    this.#stride = stride;
    this.#size = size;
    this.#nib = opts.nib;
    this.#tolerance = opts.tolerance;
    this.#settled = 0;
    if (m === 0) {
      this.#minX = this.#minY = this.#maxX = this.#maxY = 0;
      this.#made = true;
      return;
    }
    this.#smooth(m, spec.streamline, size, from);
    this.#widths(m, size, spec, stride, from);
    if (m === 1) {
      this.#dot(opts.tolerance);
      this.#markGroup(0, 0);
      this.#markGroup(1, this.#icount);
      this.#groups = 1;
      this.#made = true;
      return;
    }
    this.#strokeOf(m, opts.tolerance, keepFrom);
    this.#made = true;
  }

  // ------------------------------------------------------------------------------------------------ preparation

  #ensureScratch(n: number): void {
    if (this.#px.length >= n) return;
    let size = this.#px.length;
    while (size < n) size *= 2;
    this.#px = grown64(this.#px, size);
    this.#py = grown64(this.#py, size);
    this.#pp = grown64(this.#pp, size);
    this.#tx = grown64(this.#tx, size);
    this.#ty = grown64(this.#ty, size);
    this.#sx = grown64(this.#sx, size);
    this.#sy = grown64(this.#sy, size);
    this.#sp = grown64(this.#sp, size);
    this.#w = grown64(this.#w, size);
    this.#w2 = grown64(this.#w2, size);
    this.#ux = grown64(this.#ux, size);
    this.#uy = grown64(this.#uy, size);
    if (this.#marks.length < size + 1) {
      const marks = new Uint32Array(size + 1);
      marks.set(this.#marks);
      this.#marks = marks;
    }
  }

  /**
   * Copies the points from raw point `rawFrom` on that are not the same place as the one before, after the `kept`
   * that are already there, and returns how many there are in all.
   */
  #dedupe(points: Float32Array, n: number, stride: Stride, tilt: boolean, rawFrom: number, kept: number): number {
    this.#ensureScratch(n + 1);
    let m = kept;
    for (let i = rawFrom; i < n; i++) {
      const x = points[i * stride] as number;
      const y = points[i * stride + 1] as number;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (m > 0 && dist(x - (this.#px[m - 1] as number), y - (this.#py[m - 1] as number)) < SAME_POINT) continue;
      this.#px[m] = x;
      this.#py[m] = y;
      const p = points[i * stride + 2] as number;
      this.#pp[m] = Number.isFinite(p) ? p : 0.5;
      this.#tx[m] = tilt && stride === 5 ? (points[i * stride + 3] as number) : 0;
      this.#ty[m] = tilt && stride === 5 ? (points[i * stride + 4] as number) : 0;
      m++;
    }
    return m;
  }

  /** Streamline: blend each inner point with its neighbours, weighted by distance; the ends stay. */
  #smooth(m: number, amount: number, size: number, from: number): void {
    for (let i = from; i < m; i++) {
      const x = this.#px[i] as number;
      const y = this.#py[i] as number;
      const p = this.#pp[i] as number;
      if (i === 0 || i === m - 1 || amount <= 0) {
        this.#sx[i] = x;
        this.#sy[i] = y;
        this.#sp[i] = p;
        continue;
      }
      let sx = x;
      let sy = y;
      let sp = p;
      let wsum = 1;
      for (let d = 1; d <= 2; d++) {
        for (let side = -1; side <= 1; side += 2) {
          const j = i + side * d;
          if (j < 0 || j >= m) continue;
          const jx = this.#px[j] as number;
          const jy = this.#py[j] as number;
          const w = (amount * (d === 1 ? 1 : 0.5)) / (1 + dist(jx - x, jy - y) / size);
          sx += jx * w;
          sy += jy * w;
          sp += (this.#pp[j] as number) * w;
          wsum += w;
        }
      }
      this.#sx[i] = sx / wsum;
      this.#sy[i] = sy / wsum;
      this.#sp[i] = sp / wsum;
    }
  }

  /** Segment directions, then the width at each point (pressure, tilt, three-point smoothing). */
  #widths(m: number, size: number, spec: NibSpec, stride: Stride, from: number): void {
    for (let k = from > 0 ? from - 1 : 0; k + 1 < m; k++) {
      const dx = (this.#sx[k + 1] as number) - (this.#sx[k] as number);
      const dy = (this.#sy[k + 1] as number) - (this.#sy[k] as number);
      const len = dist(dx, dy);
      this.#ux[k] = len > 0 ? dx / len : 1;
      this.#uy[k] = len > 0 ? dy / len : 0;
    }
    for (let i = from > 0 ? from - 1 : 0; i < m; i++) {
      let w = size * (1 - spec.thinning + spec.thinning * ease(this.#sp[i] as number));
      if (spec.tilt && stride === 5 && m > 1) {
        const tx = this.#tx[i] as number;
        const ty = this.#ty[i] as number;
        const mag = dist(tx, ty);
        if (mag > 0) {
          const k = i < m - 1 ? i : m - 2;
          const across = Math.abs((this.#ux[k] as number) * ty - (this.#uy[k] as number) * tx) / mag;
          w *= 1 + TILT_WIDEN * Math.min(1, mag / 60) * across;
        }
      }
      this.#w2[i] = w;
    }
    for (let i = from; i < m; i++) {
      const a = this.#w2[i === 0 ? 0 : i - 1] as number;
      const b = this.#w2[i] as number;
      const c = this.#w2[i === m - 1 ? m - 1 : i + 1] as number;
      this.#w[i] = 0.25 * a + 0.5 * b + 0.25 * c;
    }
  }

  // ------------------------------------------------------------------------------------------------ writing

  #markGroup(g: number, at: number): void {
    if (g >= this.#marks.length) {
      const grown = new Uint32Array(Math.max(this.#marks.length * 2, g + 1));
      grown.set(this.#marks);
      this.#marks = grown;
    }
    this.#marks[g] = at;
  }

  #vertex(x: number, y: number): number {
    if (this.#vcount * 2 + 2 > this.#vx.length) {
      const grown = new Float32Array(this.#vx.length * 2);
      grown.set(this.#vx);
      this.#vx = grown;
    }
    this.#vx[this.#vcount * 2] = x;
    this.#vx[this.#vcount * 2 + 1] = y;
    if (x < this.#minX) this.#minX = x;
    if (x > this.#maxX) this.#maxX = x;
    if (y < this.#minY) this.#minY = y;
    if (y > this.#maxY) this.#maxY = y;
    return this.#vcount++;
  }

  /** One triangle, wound the same way as every other, so their union is a plain nonzero fill. */
  #triangle(a: number, b: number, c: number): void {
    const v = this.#vx;
    const cross = ((v[b * 2] as number) - (v[a * 2] as number)) * ((v[c * 2 + 1] as number) - (v[a * 2 + 1] as number)) -
      ((v[b * 2 + 1] as number) - (v[a * 2 + 1] as number)) * ((v[c * 2] as number) - (v[a * 2] as number));
    if (cross === 0) return;
    if (this.#icount + 3 > this.#ix.length) {
      const grown = new Uint32Array(this.#ix.length * 2);
      grown.set(this.#ix);
      this.#ix = grown;
    }
    const swap = cross < 0;
    this.#ix[this.#icount++] = a;
    this.#ix[this.#icount++] = swap ? c : b;
    this.#ix[this.#icount++] = swap ? b : c;
  }

  /** A fan from `centre` over the arc of radius `r` from angle `from`, turning by `delta`, between two existing vertices. */
  #arc(centre: number, cx: number, cy: number, r: number, from: number, delta: number, first: number, last: number, tolerance: number): void {
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / arcStep(r, tolerance)));
    let prev = first;
    for (let s = 1; s < steps; s++) {
      const a = from + (delta * s) / steps;
      const next = this.#vertex(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      this.#triangle(centre, prev, next);
      prev = next;
    }
    this.#triangle(centre, prev, last);
  }

  #dot(tolerance: number): void {
    const x = this.#sx[0] as number;
    const y = this.#sy[0] as number;
    const r = (this.#w[0] as number) / 2;
    const centre = this.#vertex(x, y);
    if (!(r > 1e-9)) return;
    const steps = Math.max(8, Math.ceil(TAU / arcStep(r, tolerance)));
    const first = this.#vertex(x + r, y);
    let prev = first;
    for (let s = 1; s < steps; s++) {
      const a = (TAU * s) / steps;
      const next = this.#vertex(x + Math.cos(a) * r, y + Math.sin(a) * r);
      this.#triangle(centre, prev, next);
      prev = next;
    }
    this.#triangle(centre, prev, first);
  }

  /**
   * Writes the triangles of the `m` smoothed points. The iterations before `resume` were written by an earlier call and
   * are kept (their vertices, triangles and bounds come back from the checkpoint); the rest are written again. The
   * iterations before `m - SETTLED` are final, so the checkpoint is taken after the last of them.
   */
  #strokeOf(m: number, tolerance: number, resume: number): void {
    const sx = this.#sx;
    const sy = this.#sy;
    const ux = this.#ux;
    const uy = this.#uy;
    // iteration 0 is only the start cap and has no checkpoint of its own, so the first one kept is the second
    const settled = m > SETTLED + 1 ? m - SETTLED : 0;
    let startL = 0;
    let startR = 0;
    let first = 0;
    if (resume > 0) {
      this.#vcount = this.#cpVertices;
      this.#icount = this.#cpIndices;
      this.#minX = this.#cpMinX;
      this.#minY = this.#cpMinY;
      this.#maxX = this.#cpMaxX;
      this.#maxY = this.#cpMaxY;
      startL = this.#cpLeft;
      startR = this.#cpRight;
      first = resume;
    } else {
      this.#markGroup(0, 0);
    }
    for (let i = first; i < m; i++) {
      const x = sx[i] as number;
      const y = sy[i] as number;
      const r = (this.#w[i] as number) / 2;
      if (i === 0) {
        const nx = -(uy[0] as number);
        const ny = ux[0] as number;
        startL = this.#vertex(x + nx * r, y + ny * r);
        startR = this.#vertex(x - nx * r, y - ny * r);
        const centre = this.#vertex(x, y);
        // the start cap: from the left vertex round the back to the right vertex
        this.#arc(centre, x, y, r, Math.atan2(ny, nx), Math.PI, startL, startR, tolerance);
        continue;
      }
      // the end pair of segment i - 1, and the start pair of segment i
      const pnx = -(uy[i - 1] as number);
      const pny = ux[i - 1] as number;
      let endL: number;
      let endR: number;
      let nextL: number;
      let nextR: number;
      if (i === m - 1) {
        endL = this.#vertex(x + pnx * r, y + pny * r);
        endR = this.#vertex(x - pnx * r, y - pny * r);
        nextL = endL;
        nextR = endR;
      } else {
        const nnx = -(uy[i] as number);
        const nny = ux[i] as number;
        const cos = (ux[i - 1] as number) * (ux[i] as number) + (uy[i - 1] as number) * (uy[i] as number);
        if (cos >= COS_ARC) {
          let bx = pnx + nnx;
          let by = pny + nny;
          const bl = dist(bx, by);
          bx /= bl;
          by /= bl;
          const k = 1 / Math.max(0.5, bx * nnx + by * nny);
          endL = this.#vertex(x + bx * r * k, y + by * r * k);
          endR = this.#vertex(x - bx * r * k, y - by * r * k);
          nextL = endL;
          nextR = endR;
        } else {
          endL = this.#vertex(x + pnx * r, y + pny * r);
          endR = this.#vertex(x - pnx * r, y - pny * r);
          nextL = this.#vertex(x + nnx * r, y + nny * r);
          nextR = this.#vertex(x - nnx * r, y - nny * r);
          // the arc on the outer side: a left turn has its outer side on the right
          const cross = (ux[i - 1] as number) * (uy[i] as number) - (uy[i - 1] as number) * (ux[i] as number);
          const side = cross > 0 ? -1 : 1;
          const a0 = Math.atan2(side * pny, side * pnx);
          let delta = Math.atan2(side * nny, side * nnx) - a0;
          if (delta > Math.PI) delta -= TAU;
          else if (delta < -Math.PI) delta += TAU;
          const centre = this.#vertex(x, y);
          this.#arc(centre, x, y, r, a0, delta, side > 0 ? endL : endR, side > 0 ? nextL : nextR, tolerance);
        }
      }
      // the quad of segment i - 1
      this.#triangle(startL, startR, endL);
      this.#triangle(startR, endR, endL);
      startL = nextL;
      startR = nextR;
      this.#markGroup(i, this.#icount);
      if (i + 1 === settled && settled > resume) {
        this.#cpVertices = this.#vcount;
        this.#cpIndices = this.#icount;
        this.#cpMinX = this.#minX;
        this.#cpMinY = this.#minY;
        this.#cpMaxX = this.#maxX;
        this.#cpMaxY = this.#maxY;
        this.#cpLeft = startL;
        this.#cpRight = startR;
      }
      if (i === m - 1) {
        // the end cap: from the right vertex round the front to the left vertex
        const centre = this.#vertex(x, y);
        this.#arc(centre, x, y, r, Math.atan2(-pny, -pnx), Math.PI, endR, endL, tolerance);
      }
    }
    this.#markGroup(m, this.#icount);
    this.#groups = m;
    this.#settled = settled;
  }
}

/** The outline of a whole stroke, as a new `Outline` that owns its arrays. For a stored stroke; see `OutlineCache`. */
export function outlineOf(points: Float32Array, stride: Stride, opts: OutlineOptions): Outline {
  const o = new Outliner();
  o.build(points, Math.floor(points.length / stride), stride, opts);
  return o.snapshot();
}

/**
 * Outlines of stored strokes, cached by what they are made of: the owner (the stroke's points array, which a stored
 * record keeps while the points are the same), the stride, the size, the nib and the tolerance. A move writes a new
 * record with the same points array and changes only its transform, so it never builds an outline again (design 6.2
 * item 4). A change of the points is a new array and gets a new outline. The cache holds the outline for one
 * tolerance; a different one (another zoom step) builds it again.
 */
export class OutlineCache {
  readonly #built = new WeakMap<object, { readonly stride: Stride; readonly size: number; readonly nib: Nib; readonly tolerance: number; readonly outline: Outline }>();
  readonly #outliner = new Outliner();

  /** The outline of the stroke held by `owner` (its points array), built once per stride, size, nib and tolerance. */
  get(owner: object, points: Float32Array, stride: Stride, opts: OutlineOptions): Outline {
    const known = this.#built.get(owner);
    if (known !== undefined && known.stride === stride && known.size === opts.size && known.nib === opts.nib && known.tolerance === opts.tolerance) return known.outline;
    this.#outliner.build(points, Math.floor(points.length / stride), stride, opts);
    const outline = this.#outliner.snapshot();
    this.#built.set(owner, { stride, size: opts.size, nib: opts.nib, tolerance: opts.tolerance, outline });
    return outline;
  }

  /** True when the stroke has an outline for this tolerance (for tests and the painter's statistics). */
  has(owner: object, tolerance: number): boolean {
    return this.#built.get(owner)?.tolerance === tolerance;
  }
}
