/**
 * The tiles drawn on the view package's WebGL 2 back-end (design 3, 9). Each tile's picture is a 516 × 516 texture (512
 * device pixels and a 2 pixel gutter). A tile is drawn into one shared 4× multisample target, then resolved into its own
 * texture. A stroke's triangles go to the GPU as one indexed draw call (or a few, when a tile holds a great many),
 * with a depth per stroke, so the pixels of one stroke are blended once even at less than full opacity. The screen is
 * a target the tiles' quads are drawn into, then copied to the canvas. Nothing here throws: every call returns a
 * `BoardResult`, and a failed build is `render_failed`, after which the painter draws with Canvas 2D.
 */
import { WebGL2Backend, createDrawStats } from '@incantly/view';
import type { Arena, Batch, DrawStats, FrameCtx, GpuBackend, Program, Target } from '@incantly/view';
import { TILE_PX, tileBox, tileSpan } from '../core/draw';
import type { DrawItem, Tile, TileContent } from '../core/draw';
import { GlyphAtlas, ATLAS_SIZE, WHITE_UV } from './painter-atlas';
import type { GlyphSlot } from './painter-atlas';
import { meshOf } from '../core/shape-mesh';
import type { ShapeMesh } from '../core/shape-mesh';
import type { GlyphPart, ShapeItem } from '../core/paint';
import { boardError, DONE, ok } from '../core/errors';
import type { BoardResult } from '../core/errors';
import type { PageBackground } from '../core/types';
import { TILE_GUTTER, TILE_SIZE, drawBackground2D, drawItems2D } from './painter-2d';
import type { ImageLookup, TileRaster } from './painter-2d';

const INK_VERTEX = [
  '#version 300 es',
  'layout(location=0) in vec2 aPos;',
  'layout(location=1) in float aZ;',
  'layout(location=2) in vec4 aCol;',
  'layout(location=3) in vec2 aUv;',
  'uniform vec4 uXf;',
  'out vec4 vCol;',
  'out vec2 vUv;',
  'void main(){ gl_Position = vec4(aPos * uXf.xy + uXf.zw, aZ, 1.0); vCol = aCol; vUv = aUv; }',
].join('\n');

const INK_FRAGMENT = [
  '#version 300 es',
  'precision mediump float;',
  'uniform sampler2D uAtlas;',
  'in vec4 vCol;',
  'in vec2 vUv;',
  'out vec4 oCol;',
  '// triangles sample the atlas\'s white block, text samples its own white-on-clear picture: one draw call for both',
  'void main(){ oCol = vec4(vCol.rgb * vCol.a, vCol.a) * texture(uAtlas, vUv); }',
].join('\n');

const QUAD_VERTEX = [
  '#version 300 es',
  'layout(location=0) in vec2 aPos;',
  'layout(location=1) in vec2 aUv;',
  'out vec2 vUv;',
  'void main(){ gl_Position = vec4(aPos, 0.0, 1.0); vUv = aUv; }',
].join('\n');

const QUAD_FRAGMENT = [
  '#version 300 es',
  'precision mediump float;',
  'uniform sampler2D uTex;',
  'in vec2 vUv;',
  'out vec4 oCol;',
  'void main(){ oCol = texture(uTex, vUv); }',
].join('\n');

/** Shapes whose items are made at a time while a tile is drawn in slices, and items between two looks at the clock. */
const SLICE_SHAPES = 64;
const SLICE_CHECK = 32;

/** Numbers in one ink vertex: x, y, depth, r, g, b, a, u, v. */
const INK_FLOATS = 9;
const INK_ARENA_BYTES = 8 * 1024 * 1024;
const QUAD_ARENA_BYTES = 4 * 1024;

/** A batch the caller writes again for each draw. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const failed = (what: string, hint?: string): BoardResult<never> =>
  boardError('render_failed', `The board could not use WebGL 2 (${what}).`, { ...(hint !== undefined ? { hint } : {}), detail: { backend: 'webgl2', what } });

function tryContext(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  try {
    return canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' }) as WebGL2RenderingContext | null;
  } catch {
    return null;
  }
}

export class GlRaster implements TileRaster {
  readonly #gl: WebGL2RenderingContext;
  readonly #backend: WebGL2Backend;
  readonly #ink: Program;
  readonly #quad: Program;
  readonly #inkArena: Arena;
  readonly #quadArena: Arena;
  readonly #scratch: Target;
  readonly #stats: DrawStats = createDrawStats();
  #screen: Target | null = null;
  #devW = 1;
  #devH = 1;
  /** The shapes and the paper of a tile are drawn on this canvas with Canvas 2D, then copied into `#layer`'s texture and drawn over the strokes. */
  #paper: HTMLCanvasElement | null = null;
  #paperCtx: CanvasRenderingContext2D | null = null;
  readonly #layer: Target;
  /** The text of the shapes, one picture of each piece, in one texture the stroke program samples. */
  readonly #atlas: GlyphAtlas;
  /** The atlas places of the text runs of the shape being written: filled by `#meshOf`, read at once by `#writeMesh`. */
  readonly #slots: (GlyphSlot | null)[] = [];
  readonly #inkTextures: Record<string, Target> = {};
  /** The tile being drawn in slices, and where its next slice starts. */
  #job: { tile: Tile; content: TileContent; frame: FrameCtx; next: number; total: number } | null = null;
  /** The tile whose last `render` stopped before the end (it is drawn when `render` is called again), or null. */
  pending: Tile | null = null;
  #images: ImageLookup = () => null;
  /** The four corners of a tile's quad, its index list and its batch: one set, written again for every tile of a frame, so composing makes no garbage. */
  readonly #quadData = new Float32Array(16);
  readonly #quadIndices = new Uint32Array(6);
  readonly #quadTextures: Record<string, Target> = {};
  readonly #quadUniforms: Record<string, number> = {};
  #vbuf = new Float32Array(1024 * INK_FLOATS);
  #ibuf = new Uint32Array(3072);
  /** Draw calls of the last frame, for the painter's statistics. */
  drawCalls = 0;

  private constructor(gl: WebGL2RenderingContext, backend: WebGL2Backend, ink: Program, quad: Program, inkArena: Arena, quadArena: Arena, scratch: Target, layer: Target, atlas: Target) {
    this.#gl = gl;
    this.#backend = backend;
    this.#ink = ink;
    this.#quad = quad;
    this.#inkArena = inkArena;
    this.#quadArena = quadArena;
    this.#scratch = scratch;
    this.#layer = layer;
    this.#inkTextures['uAtlas'] = atlas;
    this.#atlas = new GlyphAtlas({ upload: (source, x, y) => this.#upload(atlas, source, x, y), fillWhite: (x, y, size) => this.#fillWhite(atlas, x, y, size) });
  }

  /** Writes opaque white pixels into a square of a target's texture. */
  #fillWhite(target: Target, x: number, y: number, size: number): boolean {
    const texture = (target as unknown as { colorTex?: WebGLTexture }).colorTex;
    if (texture === undefined) return false;
    const gl = this.#gl;
    try {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, size, size, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(size * size * 4).fill(255));
      gl.bindTexture(gl.TEXTURE_2D, null);
      return true;
    } catch {
      return false;
    }
  }

  /** Copies a canvas into a texture of a target, premultiplied, with its top-left at `x, y`. */
  #upload(target: Target, source: HTMLCanvasElement, x: number, y: number): boolean {
    const texture = (target as unknown as { colorTex?: WebGLTexture }).colorTex;
    if (texture === undefined) return false;
    const gl = this.#gl;
    try {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.bindTexture(gl.TEXTURE_2D, null);
      return true;
    } catch {
      return false;
    }
  }

  /** WebGL 2 on `canvas`, or `render_failed`. */
  static open(canvas: HTMLCanvasElement): BoardResult<GlRaster> {
    const gl = tryContext(canvas);
    if (gl === null || typeof gl.drawElements !== 'function') return failed('no context', 'Use a browser that has WebGL 2.');
    const backend = new WebGL2Backend(gl);
    const ink = backend.createProgram({ vertex: INK_VERTEX, fragment: INK_FRAGMENT, uniforms: ['uXf', 'uAtlas'] });
    if (!ink.ok) return failed('the ink shader');
    const quad = backend.createProgram({ vertex: QUAD_VERTEX, fragment: QUAD_FRAGMENT, uniforms: ['uTex'] });
    if (!quad.ok) return failed('the tile shader');
    const inkArena = backend.createArena(
      { attributes: [{ name: 'aPos', size: 2 }, { name: 'aZ', size: 1 }, { name: 'aCol', size: 4 }, { name: 'aUv', size: 2 }], strideBytes: INK_FLOATS * 4 },
      INK_ARENA_BYTES,
    );
    if (!inkArena.ok) return failed('the stroke buffer');
    const quadArena = backend.createArena({ attributes: [{ name: 'aPos', size: 2 }, { name: 'aUv', size: 2 }], strideBytes: 16 }, QUAD_ARENA_BYTES);
    if (!quadArena.ok) return failed('the tile buffer');
    const scratch = backend.createTarget({ width: TILE_SIZE, height: TILE_SIZE, samples: 4, depth: true, float: false });
    if (!scratch.ok) return failed('the tile target');
    // made here, never while a tile's frame is open: making a target unbinds the framebuffer a frame draws into, and every
    // call after it would go to the canvas, leaving the tile blank (BR-72)
    const layer = backend.createTarget({ width: TILE_SIZE, height: TILE_SIZE, samples: 1, depth: false, float: false });
    if (!layer.ok) return failed('a tile layer');
    const atlas = backend.createTarget({ width: ATLAS_SIZE, height: ATLAS_SIZE, samples: 1, depth: false, float: false });
    if (!atlas.ok) return failed('the text atlas');
    return ok(new GlRaster(gl, backend, ink.value, quad.value, inkArena.value, quadArena.value, scratch.value, layer.value, atlas.value));
  }

  get backend(): GpuBackend {
    return this.#backend;
  }

  setImages(lookup: ImageLookup): void {
    this.#images = lookup;
  }

  /** A tile's target, made when it has none. */
  #targetOf(tile: Tile): BoardResult<Target> {
    if (tile.handle === null) {
      const made = this.#backend.createTarget({ width: TILE_SIZE, height: TILE_SIZE, samples: 1, depth: false, float: false });
      if (!made.ok) return failed('a tile target');
      tile.handle = made.value;
    }
    return ok(tile.handle as Target);
  }

  /**
   * The paper and the shapes of one run (vector parts, text, images) are drawn with Canvas 2D, copied into the layer's
   * texture (rows flipped, colours premultiplied) and drawn over what the frame holds, in order, as one quad. The strokes
   * stay on the GPU, so a tile of ten thousand strokes and a few shapes costs the strokes' triangles, not a path call for
   * each of them (BR-35).
   */
  #paintLayer(frame: FrameCtx, scale: number, x0: number, y0: number, background: PageBackground | undefined, run: readonly DrawItem[]): BoardResult<undefined> {
    const layer = this.#layer;
    const texture = (layer as unknown as { colorTex?: WebGLTexture }).colorTex;
    if (texture === undefined) return failed('a tile texture');
    let paper = this.#paper;
    let ctx = this.#paperCtx;
    if (paper === null || ctx === null) {
      paper = document.createElement('canvas');
      paper.width = TILE_SIZE;
      paper.height = TILE_SIZE;
      ctx = paper.getContext('2d');
      if (ctx === null) return failed('a tile canvas');
      this.#paper = paper;
      this.#paperCtx = ctx;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
    if (background !== undefined) drawBackground2D(ctx, background, scale, x0, y0);
    drawItems2D(ctx, run, scale, x0, y0, this.#images);
    const gl = this.#gl;
    try {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, paper);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.bindTexture(gl.TEXTURE_2D, null);
    } catch {
      return failed('copying a tile layer');
    }
    const arena = this.#quadArena;
    const at = arena.alloc(4);
    if (at < 0) return failed('the tile buffer is full');
    const data = this.#quadData;
    // the whole tile: top-left, top-right, bottom-left, bottom-right; a texture's rows start at the bottom
    data[0] = -1;
    data[1] = 1;
    data[2] = 0;
    data[3] = 1;
    data[4] = 1;
    data[5] = 1;
    data[6] = 1;
    data[7] = 1;
    data[8] = -1;
    data[9] = -1;
    data[10] = 0;
    data[11] = 0;
    data[12] = 1;
    data[13] = -1;
    data[14] = 1;
    data[15] = 0;
    arena.writeVertices(at, data);
    const idx = this.#quadIndices;
    idx[0] = at;
    idx[1] = at + 1;
    idx[2] = at + 2;
    idx[3] = at + 2;
    idx[4] = at + 1;
    idx[5] = at + 3;
    arena.writeIndices(0, idx);
    const batch: Batch = {
      program: this.#quad,
      arena,
      firstVertex: at,
      vertexCount: 4,
      firstIndex: 0,
      indexCount: 6,
      mode: 'triangles',
      instances: 1,
      uniforms: {},
      textures: { uTex: layer },
      scissor: null,
      depthTest: false,
      depthFunc: 'less',
      // a layer is painted over what is there and writes no depth: the strokes after it have a smaller depth than every stroke before it
      depthWrite: false,
      blend: 'premult',
      cullBack: false,
    };
    const drawn = this.#backend.draw(frame, batch, this.#stats);
    arena.free(at, 4);
    return drawn.ok ? DONE : failed('drawing a tile layer');
  }

  render(tile: Tile, content: TileContent, until?: number): BoardResult<undefined> {
    const done = this.#render(tile, content, until);
    // a tile that failed or finished has no slice to come back to
    if (!done.ok || this.pending !== tile) this.#job = null;
    return done;
  }

  #render(tile: Tile, content: TileContent, until: number | undefined): BoardResult<undefined> {
    const own = this.#targetOf(tile);
    if (!own.ok) return own;
    const scale = Math.pow(2, tile.k);
    const box = tileBox(tile.k, tile.tx, tile.ty);
    const x0 = box.minX - TILE_GUTTER / scale;
    const y0 = box.minY - TILE_GUTTER / scale;
    const k = (2 * scale) / TILE_SIZE;
    const uniforms = { uXf: [k, -k, -1, 1] };
    const items = content.items;
    let job = this.#job;
    let j = 0;
    if (job !== null && job.tile === tile && job.content === content) {
      // the next slice of a tile that was stopped: its frame is still the scratch target's, with what was drawn in it
      j = job.next;
      this.#backend.setViewport(job.frame, 0, 0, TILE_SIZE, TILE_SIZE);
    } else {
      this.#atlas.beginTile();
      const frame = this.#backend.beginFrame(this.#scratch, { width: TILE_SIZE, height: TILE_SIZE, dpr: 1 });
      if (!frame.ok) return failed('a tile frame');
      job = { tile, content, frame: frame.value, next: 0, total: content.total ?? items.length };
      this.#job = job;
      // the paper goes first, under everything
      if (content.background !== undefined && content.background !== 'none') {
        const painted = this.#paintLayer(frame.value, scale, x0, y0, content.background, []);
        if (!painted.ok) return painted;
      }
    }
    this.pending = null;
    const frame = { value: job.frame };
    const n = job.total;
    const first = j;
    let more = content.more !== undefined;
    let vcount = 0;
    let icount = 0;
    const maxVerts = Math.floor((INK_ARENA_BYTES / (INK_FLOATS * 4)) * 0.9);
    const maxIndices = Math.floor(INK_ARENA_BYTES / 8) - 3;
    for (; ; j++) {
      if (j >= items.length) {
        // the items of the next shapes are made when they are wanted, a few at a time
        while (more && j >= items.length) more = !(content.more as (count: number) => boolean)(SLICE_SHAPES);
        if (j >= items.length) break;
      }
      if (until !== undefined && j - first >= SLICE_CHECK && (j - first) % SLICE_CHECK === 0 && performance.now() >= until) {
        const sent = this.#flush(frame.value, vcount, icount, uniforms);
        if (!sent.ok) return sent;
        job.next = j;
        this.pending = tile;
        return DONE;
      }
      const item = items[j];
      if (item === undefined) continue;
      if (item.k === 'shape') {
        const mesh = this.#gpuMesh(item, scale);
        if (mesh !== null) {
          // a shape of paths and text is triangles and quads too: they go in the same draw call as the strokes round it
          if (mesh.maxVertices > maxVerts || mesh.maxIndices > maxIndices) continue;
          if (vcount + mesh.maxVertices > maxVerts || icount + mesh.maxIndices > maxIndices) {
            const sent = this.#flush(frame.value, vcount, icount, uniforms);
            if (!sent.ok) return sent;
            vcount = 0;
            icount = 0;
          }
          this.#room(vcount + mesh.maxVertices, icount + mesh.maxIndices);
          const z = 2 * (1 - (j + 1) / (n + 1)) - 1;
          const written = this.#writeMesh(mesh, item, scale, z, 2 / (n + 1), vcount, icount, item.x - x0, item.y - y0);
          vcount += written.vertices;
          icount += written.indices;
          continue;
        }
        // a run of shapes Canvas 2D has to draw (pictures, shapes inside a frame): the triangles before it are drawn first, so
        // the order of the items is kept
        const sent = this.#flush(frame.value, vcount, icount, uniforms);
        if (!sent.ok) return sent;
        vcount = 0;
        icount = 0;
        let end = j + 1;
        while (end < items.length && (items[end] as DrawItem).k === 'shape' && this.#gpuMesh(items[end] as ShapeItem, scale) === null) end++;
        const painted = this.#paintLayer(frame.value, scale, x0, y0, undefined, items.slice(j, end));
        if (!painted.ok) return painted;
        j = end - 1;
        continue;
      }
      const verts = item.outline.vertices;
      const idx = item.outline.indices;
      const vn = verts.length / 2;
      if (vn > maxVerts || idx.length > maxIndices) continue;
      if (vcount + vn > maxVerts || icount + idx.length > maxIndices) {
        const sent = this.#flush(frame.value, vcount, icount, uniforms);
        if (!sent.ok) return sent;
        vcount = 0;
        icount = 0;
      }
      this.#room(vcount + vn, icount + idx.length);
      const z = 2 * (1 - (j + 1) / (n + 1)) - 1;
      const ox = item.ox - x0;
      const oy = item.oy - y0;
      const vb = this.#vbuf;
      // a turned stroke: its points move about the pivot before they go to the page
      const cos = item.rot === 0 ? 1 : Math.cos(item.rot);
      const sin = item.rot === 0 ? 0 : Math.sin(item.rot);
      for (let v = 0; v < vn; v++) {
        const at = (vcount + v) * INK_FLOATS;
        const vx = verts[v * 2] as number;
        const vy = verts[v * 2 + 1] as number;
        vb[at] = (item.rot === 0 ? vx : item.px + (vx - item.px) * cos - (vy - item.py) * sin) + ox;
        vb[at + 1] = (item.rot === 0 ? vy : item.py + (vx - item.px) * sin + (vy - item.py) * cos) + oy;
        vb[at + 2] = z;
        vb[at + 3] = item.r;
        vb[at + 4] = item.g;
        vb[at + 5] = item.b;
        vb[at + 6] = item.a;
        vb[at + 7] = WHITE_UV;
        vb[at + 8] = WHITE_UV;
      }
      const ib = this.#ibuf;
      for (let i = 0; i < idx.length; i++) ib[icount + i] = (idx[i] as number) + vcount;
      vcount += vn;
      icount += idx.length;
    }
    const sent = this.#flush(frame.value, vcount, icount, uniforms);
    if (!sent.ok) return sent;
    const resolved = this.#backend.resolveInto(frame.value, tile.handle as Target);
    return resolved.ok ? DONE : failed('resolving a tile');
  }

  /**
   * The mesh a shape is drawn with on the GPU, with the atlas places of its text left in `#slots`, or null when Canvas 2D
   * has to draw it (a picture, a frame's clip, a path the tessellator cannot fill, text the atlas has no room for).
   */
  #gpuMesh(item: ShapeItem, scale: number): ShapeMesh | null {
    if (item.clip !== null) return null;
    const mesh = meshOf(item.parts, scale);
    if (mesh === null) return null;
    const slots = this.#slots;
    slots.length = mesh.runs;
    for (let run = 0; run < mesh.runs; run++) {
      const glyph = mesh.glyphs[run] as GlyphPart | null;
      if (glyph === null) {
        slots[run] = null;
        continue;
      }
      const slot = this.#atlas.slot(glyph, scale);
      if (slot === null) return null;
      slots[run] = slot;
    }
    return mesh;
  }

  /**
   * Writes the runs of a shape's mesh into the CPU buffers at `vcount` and `icount`, moved and turned as Canvas 2D would
   * (about the pivot, then to the tile). Each run has its own depth, later runs nearer, all inside the shape's slot between
   * its neighbours in the draw order, so the fill and the line of one shape blend in order and each blends once.
   */
  #writeMesh(mesh: ShapeMesh, item: ShapeItem, scale: number, z: number, slot: number, vcount: number, icount: number, ox: number, oy: number): { vertices: number; indices: number } {
    const vb = this.#vbuf;
    const ib = this.#ibuf;
    const turned = item.rotation !== 0;
    const cos = turned ? Math.cos(item.rotation) : 1;
    const sin = turned ? Math.sin(item.rotation) : 0;
    const px = item.px;
    const py = item.py;
    let mv = 0;
    let mi = 0;
    let v = vcount;
    let i = icount;
    for (let run = 0; run < mesh.runs; run++) {
      const depth = z - (slot * run) / mesh.runs;
      const r = mesh.colors[run * 4] as number;
      const g = mesh.colors[run * 4 + 1] as number;
      const b = mesh.colors[run * 4 + 2] as number;
      const a = (mesh.colors[run * 4 + 3] as number) * item.a;
      const glyph = mesh.glyphs[run] as GlyphPart | null;
      if (glyph !== null) {
        const place = this.#slots[run] as GlyphSlot;
        let x = glyph.x;
        let y = glyph.y;
        if (!turned) {
          // upright text sits on whole device pixels, as the font's own smoothing expects
          x += (Math.round((x + ox) * scale) / scale) - (x + ox);
          y += (Math.round((y + oy) * scale) / scale) - (y + oy);
        }
        const x0 = x - place.ox / scale;
        const y0 = y - place.oy / scale;
        const x1 = x0 + place.w / scale;
        const y1 = y0 + place.h / scale;
        for (let c = 0; c < 4; c++) {
          const cx = c % 2 === 0 ? x0 : x1;
          const cy = c < 2 ? y0 : y1;
          const at = (v + c) * INK_FLOATS;
          vb[at] = (turned ? px + (cx - px) * cos - (cy - py) * sin : cx) + ox;
          vb[at + 1] = (turned ? py + (cx - px) * sin + (cy - py) * cos : cy) + oy;
          vb[at + 2] = depth;
          vb[at + 3] = r;
          vb[at + 4] = g;
          vb[at + 5] = b;
          vb[at + 6] = a;
          vb[at + 7] = c % 2 === 0 ? place.u0 : place.u1;
          vb[at + 8] = c < 2 ? place.v0 : place.v1;
        }
        ib[i] = v;
        ib[i + 1] = v + 1;
        ib[i + 2] = v + 2;
        ib[i + 3] = v + 2;
        ib[i + 4] = v + 1;
        ib[i + 5] = v + 3;
        v += 4;
        i += 6;
        continue;
      }
      const v1 = mesh.vertexEnds[run] as number;
      const i1 = mesh.indexEnds[run] as number;
      const base = v - mv;
      for (let k = mv; k < v1; k++) {
        const at = (base + k) * INK_FLOATS;
        const vx = mesh.vertices[k * 2] as number;
        const vy = mesh.vertices[k * 2 + 1] as number;
        vb[at] = (turned ? px + (vx - px) * cos - (vy - py) * sin : vx) + ox;
        vb[at + 1] = (turned ? py + (vx - px) * sin + (vy - py) * cos : vy) + oy;
        vb[at + 2] = depth;
        vb[at + 3] = r;
        vb[at + 4] = g;
        vb[at + 5] = b;
        vb[at + 6] = a;
        vb[at + 7] = WHITE_UV;
        vb[at + 8] = WHITE_UV;
      }
      for (let k = mi; k < i1; k++) ib[i + k - mi] = (mesh.indices[k] as number) + v;
      v += v1 - mv;
      i += i1 - mi;
      mv = v1;
      mi = i1;
    }
    return { vertices: v - vcount, indices: i - icount };
  }

  /** Grows the CPU buffers to hold `v` vertices and `i` indices. */
  #room(v: number, i: number): void {
    if (v * INK_FLOATS > this.#vbuf.length) {
      const grown = new Float32Array(Math.max(this.#vbuf.length * 2, v * INK_FLOATS));
      grown.set(this.#vbuf);
      this.#vbuf = grown;
    }
    if (i > this.#ibuf.length) {
      const grown = new Uint32Array(Math.max(this.#ibuf.length * 2, i));
      grown.set(this.#ibuf);
      this.#ibuf = grown;
    }
  }

  /** One draw call for the vertices and indices gathered so far. */
  #flush(frame: FrameCtx, vcount: number, icount: number, uniforms: Readonly<Record<string, number[]>>): BoardResult<undefined> {
    if (icount === 0) return DONE;
    const arena = this.#inkArena;
    const at = arena.alloc(vcount);
    if (at < 0) return failed('the stroke buffer is full');
    // the indices were numbered from 0 in this batch; the arena put the vertices at `at`
    const ib = this.#ibuf;
    if (at !== 0) for (let i = 0; i < icount; i++) ib[i] = (ib[i] as number) + at;
    arena.writeVertices(at, this.#vbuf.subarray(0, vcount * INK_FLOATS));
    arena.writeIndices(0, ib.subarray(0, icount));
    const batch: Batch = {
      program: this.#ink,
      arena,
      firstVertex: at,
      vertexCount: vcount,
      firstIndex: 0,
      indexCount: icount,
      mode: 'triangles',
      instances: 1,
      uniforms,
      textures: this.#inkTextures,
      scissor: null,
      depthTest: true,
      depthFunc: 'less',
      depthWrite: true,
      blend: 'premult',
      cullBack: false,
    };
    const drawn = this.#backend.draw(frame, batch, this.#stats);
    arena.free(at, vcount);
    return drawn.ok ? DONE : failed('drawing strokes');
  }

  release(tile: Tile): void {
    const target = tile.handle as Target | null;
    tile.handle = null;
    try {
      target?.dispose();
    } catch {
      // the context may be gone already; there is nothing left to free
    }
  }

  resize(devW: number, devH: number): BoardResult<undefined> {
    const w = Math.max(1, Math.floor(devW));
    const h = Math.max(1, Math.floor(devH));
    if (this.#screen !== null && w === this.#devW && h === this.#devH) return DONE;
    this.#screen?.dispose();
    this.#screen = null;
    const made = this.#backend.createTarget({ width: w, height: h, samples: 1, depth: false, float: false });
    if (!made.ok) return failed('the screen target');
    this.#screen = made.value;
    this.#devW = w;
    this.#devH = h;
    return DONE;
  }

  compose(tiles: readonly Tile[], camX: number, camY: number, zoom: number, dpr: number): BoardResult<undefined> {
    const screen = this.#screen;
    if (screen === null) return failed('no screen target');
    const frame = this.#backend.beginFrame(screen, { width: this.#devW, height: this.#devH, dpr: 1 });
    if (!frame.ok) return failed('the screen frame');
    this.#stats.drawCalls = 0;
    const pxPerUnit = zoom * dpr;
    const lo = TILE_GUTTER / TILE_SIZE;
    const hi = (TILE_GUTTER + TILE_PX) / TILE_SIZE;
    const data = this.#quadData;
    const idx = this.#quadIndices;
    const arena = this.#quadArena;
    const batch: Mutable<Batch> = {
      program: this.#quad,
      arena,
      firstVertex: 0,
      vertexCount: 4,
      firstIndex: 0,
      indexCount: 6,
      mode: 'triangles',
      instances: 1,
      uniforms: this.#quadUniforms,
      textures: this.#quadTextures,
      scissor: null,
      depthTest: false,
      depthFunc: 'less',
      // the depth mask stays on, so the next tile's clear of the depth buffer works
      depthWrite: true,
      blend: 'premult',
      cullBack: false,
    };
    for (const tile of tiles) {
      const target = tile.handle as Target | null;
      if (target === null) continue;
      const span = tileSpan(tile.k);
      const dx0 = (tile.tx * span - camX) * pxPerUnit;
      const dy0 = (tile.ty * span - camY) * pxPerUnit;
      const size = span * pxPerUnit;
      const x0 = Math.round(dx0);
      const y0 = Math.round(dy0);
      const x1 = Math.round(dx0 + size);
      const y1 = Math.round(dy0 + size);
      if (x1 < 0 || y1 < 0 || x0 > this.#devW || y0 > this.#devH) continue;
      const cx0 = (x0 / this.#devW) * 2 - 1;
      const cx1 = (x1 / this.#devW) * 2 - 1;
      const cy0 = 1 - (y0 / this.#devH) * 2;
      const cy1 = 1 - (y1 / this.#devH) * 2;
      // top-left, top-right, bottom-left, bottom-right; a texture's rows start at the bottom
      data[0] = cx0;
      data[1] = cy0;
      data[2] = lo;
      data[3] = 1 - lo;
      data[4] = cx1;
      data[5] = cy0;
      data[6] = hi;
      data[7] = 1 - lo;
      data[8] = cx0;
      data[9] = cy1;
      data[10] = lo;
      data[11] = 1 - hi;
      data[12] = cx1;
      data[13] = cy1;
      data[14] = hi;
      data[15] = 1 - hi;
      const at = arena.alloc(4);
      if (at < 0) return failed('the tile buffer is full');
      arena.writeVertices(at, data);
      idx[0] = at;
      idx[1] = at + 1;
      idx[2] = at + 2;
      idx[3] = at + 2;
      idx[4] = at + 1;
      idx[5] = at + 3;
      arena.writeIndices(0, idx);
      this.#quadTextures['uTex'] = target;
      batch.firstVertex = at;
      const drawn = this.#backend.draw(frame.value, batch, this.#stats);
      arena.free(at, 4);
      if (!drawn.ok) return failed('drawing a tile');
    }
    this.drawCalls = this.#stats.drawCalls;
    const shown = this.#backend.blitToCanvas(screen, this.#devW, this.#devH);
    return shown.ok ? DONE : failed('copying to the canvas');
  }

  dispose(): void {
    this.#backend.dispose();
  }
}
