/**
 * Pure helpers of the WebGL 2 painter (physics design 12.1): what it is fed each frame, the triangles of a grid made
 * once per topology, and the solids' faces as triangles for the depth pass. No DOM: Node tests and benches use them.
 */

export interface GlV3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A sheet: nx × ny points row by row (point i + j nx), its xyz in `pos`. */
export interface GlSheet3 {
  /** Stable for the life of the sheet (the object id): its texture and triangles are kept under it. */
  readonly key: number;
  readonly nx: number;
  readonly ny: number;
  /** nx · ny · 3 floats, copied to the GPU each frame. */
  readonly pos: Float32Array;
  /** Triangles by point index; the full grid when absent. A torn cloth gives its own. */
  readonly tris?: Uint32Array;
  /** Changes whenever `tris` does, so the index buffer is made again only then. */
  readonly topology?: number;
  /** Linear colour 0..1. */
  readonly color: readonly [number, number, number];
  readonly alpha: number;
  /** A faint thread every this many points (0 for none). */
  readonly threads: number;
}

/** One batch of drops: `count` centres in `pos` (xyz), discs of one radius in world units. */
export interface GlDrops3 {
  readonly pos: Float32Array;
  readonly count: number;
  readonly color: readonly [number, number, number];
  readonly alpha: number;
  readonly radius: number;
}

/**
 * A smoke or fire grid in space (physics design 9.8, 12.1): the box, `n` cells a side, the smoke `density` and the
 * temperature `temp` (°C, none for smoke) of each cell, index (k n + j) n + i (x fastest).
 */
export interface GlVolume3 {
  /** Stable for the life of the volume (the object id): its 3D texture is kept under it. */
  readonly key: number;
  readonly n: number;
  readonly min: GlV3;
  readonly max: GlV3;
  readonly density: Float32Array;
  readonly temp?: Float32Array;
  /** The fire's hottest, °C: the temperature is sent as `T / heat` (0 for smoke). */
  readonly heat: number;
  /** Linear colour 0..1 of the smoke. */
  readonly smoke: readonly [number, number, number];
}

export type GlLight = 'lit' | 'flat' | 'off';

/** Everything one frame of the painter needs; the camera matrices are the Space view's own (`cam.vp`, `cam.view`). */
export interface GlFrame3 {
  /** CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** Device pixels per CSS pixel (the screen's dpr, or the export's scale). */
  readonly pixelRatio: number;
  /** World to clip, column-major (16). */
  readonly vp: ArrayLike<number>;
  /** World to camera rotation, column-major (9), for the light fixed to the camera. */
  readonly rot: ArrayLike<number>;
  /** The camera's right and up in world axes, for discs that face it. */
  readonly right: GlV3;
  readonly up: GlV3;
  readonly light: GlLight;
  readonly clip: { readonly min: GlV3; readonly max: GlV3 } | null;
  /** Triangles (xyz per corner) of the solids the software painter draws: depth only. */
  readonly occluders: Float32Array;
  readonly occluderVerts: number;
  readonly sheets: readonly GlSheet3[];
  readonly drops: readonly GlDrops3[];
  /** Smoke and fire in space: ray-marched after the sheets and drops. */
  readonly volumes?: readonly GlVolume3[];
  /** What ends a ray through a volume (the solids and a cloth, as triangles): its own depth pass, since the screen's depth buffer cannot be read. */
  readonly volumeOccluders?: Float32Array;
  readonly volumeOccluderVerts?: number;
}

/** The two triangles of every cell of an nx × ny grid of points. */
export function gridTriangles(nx: number, ny: number): Uint32Array {
  const cx = Math.max(0, nx - 1);
  const cy = Math.max(0, ny - 1);
  const out = new Uint32Array(cx * cy * 6);
  let k = 0;
  for (let j = 0; j < cy; j++) {
    for (let i = 0; i < cx; i++) {
      const a = i + j * nx;
      const b = a + 1;
      const c = a + nx + 1;
      const d = a + nx;
      out[k++] = a;
      out[k++] = b;
      out[k++] = c;
      out[k++] = a;
      out[k++] = c;
      out[k++] = d;
    }
  }
  return out;
}

/** A float buffer that grows and is reused, so a frame makes no garbage once warm. */
export class FloatPool {
  private buf = new Float32Array(0);
  /** A view of at least `n` floats (its contents are kept up to the old length). */
  take(n: number): Float32Array {
    if (this.buf.length < n) {
      const next = new Float32Array(Math.max(n, this.buf.length * 2, 64));
      next.set(this.buf);
      this.buf = next;
    }
    return this.buf;
  }
}

/** Fan-triangulates flat convex loops into `pool`: the solids for the depth pass. Returns the floats and corners. */
export function fanTriangles(loops: Iterable<readonly GlV3[]>, pool: FloatPool): { data: Float32Array; verts: number } {
  let v = 0;
  let data = pool.take(0);
  for (const pts of loops) {
    const n = pts.length;
    if (n < 3) continue;
    data = pool.take((v + (n - 2) * 3) * 3);
    const a = pts[0] as GlV3;
    for (let i = 1; i + 1 < n; i++) {
      const b = pts[i] as GlV3;
      const c = pts[i + 1] as GlV3;
      let o = v * 3;
      data[o++] = a.x;
      data[o++] = a.y;
      data[o++] = a.z;
      data[o++] = b.x;
      data[o++] = b.y;
      data[o++] = b.z;
      data[o++] = c.x;
      data[o++] = c.y;
      data[o] = c.z;
      v += 3;
    }
  }
  return { data, verts: v };
}

/** The 3 × 3 rotation of a column-major view matrix (16), column-major. */
export function rotationOf(view: ArrayLike<number>, out = new Float32Array(9)): Float32Array {
  out[0] = view[0] ?? 1;
  out[1] = view[1] ?? 0;
  out[2] = view[2] ?? 0;
  out[3] = view[4] ?? 0;
  out[4] = view[5] ?? 1;
  out[5] = view[6] ?? 0;
  out[6] = view[8] ?? 0;
  out[7] = view[9] ?? 0;
  out[8] = view[10] ?? 1;
  return out;
}

/** `#rrggbb` to 0..1 channels (the same sRGB numbers the software painter shades). */
export function rgb01(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  if (!Number.isFinite(n)) return [0.5, 0.5, 0.5];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
