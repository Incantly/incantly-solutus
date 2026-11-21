/**
 * A shape's vector parts as triangles for the GPU (design 9 item 4, BR-73): the view package's tessellator turns each
 * path into a mesh in the shape's own coordinates, once. Every path part gives a fill and a stroke, each its own run of
 * triangles with its own colour, in the order Canvas 2D would draw them, and each piece of text is a run of its own. A shape
 * that holds a picture, a path the tessellator cannot fill, or a colour this file cannot read has no mesh, and the painter
 * draws it with Canvas 2D.
 *
 * The meshes are kept on the shape's `parts` list, which a draw list keeps for as long as the stored shape and the text
 * measure are the same, so a record that changes is a new list and a new mesh (nothing here can disagree with the record).
 */
import { fillMesh, flattenPath, newSink, strokeMesh } from '@incantly/view';
import type { MeshSink } from '@incantly/view';
import type { GlyphPart, Part } from './paint';

/**
 * The triangles of a shape, in its own coordinates, as a few runs in drawing order: one for each fill and each stroke,
 * and one for each piece of text, which has no triangles here (the painter puts it on a glyph atlas and makes its quad).
 */
export interface ShapeMesh {
  /** Device pixels per page unit the curves were cut for. */
  readonly scale: number;
  /** `x, y` pairs of every run, one after the other. */
  readonly vertices: Float32Array;
  /** Indices of every run, each counted from its own run's first vertex. */
  readonly indices: Uint32Array;
  /** For each run, where it ends in `vertices` (in vertices) and in `indices`. */
  readonly vertexEnds: Uint32Array;
  readonly indexEnds: Uint32Array;
  /** For each run, its colour `r, g, b, a` (0 to 1, not premultiplied). */
  readonly colors: Float32Array;
  readonly runs: number;
  /** For each run, the piece of text it draws, or null for a run of triangles. */
  readonly glyphs: readonly (GlyphPart | null)[];
  /** The most vertices and indices the runs write, glyph quads included. */
  readonly maxVertices: number;
  readonly maxIndices: number;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;

/** A CSS colour as `[r, g, b, a]`, each 0 to 1, or null for one this reader does not know (`#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`). */
export function cssRgba(color: string): readonly [number, number, number, number] | null {
  const hex = HEX.exec(color);
  if (hex !== null) {
    const h = hex[1] as string;
    const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
    const at = (i: number): number => parseInt(full.slice(i, i + 2), 16) / 255;
    return [at(0), at(2), at(4), full.length === 8 ? at(6) : 1];
  }
  const fn = FUNC.exec(color);
  if (fn !== null) {
    const clamp = (v: number): number => Math.max(0, Math.min(1, v));
    return [clamp(Number(fn[1]) / 255), clamp(Number(fn[2]) / 255), clamp(Number(fn[3]) / 255), fn[4] === undefined ? 1 : clamp(Number(fn[4]))];
  }
  return null;
}

interface Kept {
  readonly scale: number;
  readonly mesh: ShapeMesh | null;
}

const kept = new WeakMap<readonly Part[], Kept>();

/** How far, in device pixels, a curve may be from its segments. */
const TOLERANCE_PX = 0.25;

function build(parts: readonly Part[], scale: number): ShapeMesh | null {
  const tolerance = TOLERANCE_PX / scale;
  const runs: { sink: MeshSink; color: readonly [number, number, number, number]; glyph: GlyphPart | null }[] = [];
  for (const part of parts) {
    if (part.k === 'glyph') {
      const color = cssRgba(part.color);
      if (color === null) return null;
      runs.push({ sink: newSink(), color, glyph: part });
      continue;
    }
    if (part.k !== 'path') return null;
    const wantsFill = part.fill !== null;
    const wantsLine = part.stroke !== null && part.width > 0;
    if (!wantsFill && !wantsLine) continue;
    const contours = flattenPath(part.d, tolerance);
    if (part.fill !== null) {
      const color = cssRgba(part.fill);
      if (color === null) return null;
      const sink = newSink();
      if (!fillMesh(contours, sink)) return null;
      if (sink.indices.length > 0) runs.push({ sink, color, glyph: null });
    }
    if (part.stroke !== null && part.width > 0) {
      const color = cssRgba(part.stroke);
      if (color === null) return null;
      const sink = newSink();
      strokeMesh(contours, part.width, part.cap, part.dash, tolerance, sink);
      if (sink.indices.length > 0) runs.push({ sink, color, glyph: null });
    }
  }
  let vertexCount = 0;
  let indexCount = 0;
  let quads = 0;
  for (const r of runs) {
    vertexCount += r.sink.vertices.length / 2;
    indexCount += r.sink.indices.length;
    if (r.glyph !== null) quads++;
  }
  const vertices = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(indexCount);
  const vertexEnds = new Uint32Array(runs.length);
  const indexEnds = new Uint32Array(runs.length);
  const colors = new Float32Array(runs.length * 4);
  let v = 0;
  let i = 0;
  runs.forEach((r, n) => {
    vertices.set(r.sink.vertices, v * 2);
    indices.set(r.sink.indices, i);
    v += r.sink.vertices.length / 2;
    i += r.sink.indices.length;
    vertexEnds[n] = v;
    indexEnds[n] = i;
    colors.set(r.color, n * 4);
  });
  return { scale, vertices, indices, vertexEnds, indexEnds, colors, runs: runs.length, glyphs: runs.map((r) => r.glyph), maxVertices: vertexCount + 4 * quads, maxIndices: indexCount + 6 * quads };
}

/** The mesh of a shape's parts at `scale` device pixels per page unit, or null when the shape has to be drawn another way. */
export function meshOf(parts: readonly Part[], scale: number): ShapeMesh | null {
  const known = kept.get(parts);
  if (known !== undefined && known.scale === scale) return known.mesh;
  const mesh = build(parts, scale);
  kept.set(parts, { scale, mesh });
  return mesh;
}
