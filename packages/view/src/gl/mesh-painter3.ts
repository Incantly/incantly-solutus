/**
 * The WebGL 2 painter of the Space view for sheets (cloth, waves) and drops (physics design 12.1, space-3d design 9).
 *
 * `GlBackend3` is the small WebGL 2 back-end it runs on: the context, its three programs, the depth buffer, resizing and
 * context loss. `MeshPainter3` is what the Space view feeds each frame (`GlFrame3`): it copies each sheet's points into
 * a float texture (one `texSubImage2D`), draws its fixed triangles (an index buffer made once per topology) with normals
 * worked out in the vertex shader from each point's neighbours, draws every batch of drops as one instanced call, and
 * first writes the software painter's solids into the depth buffer so they hide what is behind them. Nothing is sorted
 * on the CPU. The picture lands in the top-left `width × height` device pixels of the canvas, for the host to copy with
 * `drawImage`. Nothing here throws: every entry returns a `Result`.
 */
import { okResult, viewError } from '../errors';
import type { Result } from '@incantly/kernel';
import { DEPTH_SRC, DISC_SRC, SHEET_SRC } from './shaders3';
import type { GlProgramSrc } from './shaders3';
import { gridTriangles } from './sheet3';
import type { GlFrame3, GlSheet3 } from './sheet3';

export type GlCanvas = HTMLCanvasElement | OffscreenCanvas;

/** The context attributes: MSAA, a depth buffer, premultiplied alpha so `drawImage` composites it as it is. */
export const GL3_ATTRIBUTES: WebGLContextAttributes = { alpha: true, antialias: true, depth: true, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'default' };

function glError(where: string, token: string, hint?: string): Result<never> {
  return viewError({ kind: 'internal', messageKey: 'view.internal', params: { where }, token, ...(hint === undefined ? {} : { hint }) });
}

interface Prog {
  readonly program: WebGLProgram;
  readonly u: Readonly<Record<string, WebGLUniformLocation | null>>;
}

const UNIFORMS = {
  sheet: ['uPos', 'uSize', 'uVp', 'uRot', 'uColor', 'uAlpha', 'uLight', 'uThreads', 'uClipMin', 'uClipMax'],
  disc: ['uVp', 'uRight', 'uUp', 'uRadius', 'uClipMin', 'uClipMax', 'uColor', 'uAlpha', 'uLight'],
  depth: ['uVp'],
} as const;

/**
 * The WebGL 2 back-end of the painter. It owns one context; the host keeps one for the page and copies its picture
 * to each view (performance 4.1: figures never make their own).
 */
export class GlBackend3 {
  readonly canvas: GlCanvas;
  readonly gl: WebGL2RenderingContext;
  /** Bumped when a lost context comes back, so everything made before is made again. */
  generation = 0;
  private lostFlag = false;
  private progs: { sheet: Prog; disc: Prog; depth: Prog } | undefined;
  private readonly onLost = (e: Event): void => {
    // asking for the context back: the browser restores it when it can
    e.preventDefault();
    this.lostFlag = true;
    this.progs = undefined;
  };
  private readonly onRestored = (): void => {
    this.lostFlag = false;
    this.generation++;
  };

  private constructor(canvas: GlCanvas, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', this.onLost as EventListener);
    canvas.addEventListener('webglcontextrestored', this.onRestored as EventListener);
  }

  /** A WebGL 2 context on the canvas, or the host fault `webgl_unavailable`. */
  static open(canvas: GlCanvas): Result<GlBackend3> {
    let gl: WebGL2RenderingContext | null;
    try {
      gl = canvas.getContext('webgl2', GL3_ATTRIBUTES) as WebGL2RenderingContext | null;
    } catch {
      gl = null;
    }
    if (!gl || typeof gl.drawArraysInstanced !== 'function' || typeof gl.texStorage2D !== 'function') {
      return glError('WebGL 2', 'webgl_unavailable', 'This browser gives no WebGL 2, so the software painter draws the Space view.');
    }
    return okResult(new GlBackend3(canvas, gl));
  }

  lost(): boolean {
    return this.lostFlag || this.gl.isContextLost();
  }

  /** The three programs, compiled once per context. */
  programs(): Result<{ sheet: Prog; disc: Prog; depth: Prog }> {
    if (this.progs) return okResult(this.progs);
    const sheet = this.compile(SHEET_SRC, UNIFORMS.sheet);
    if (!sheet.ok) return sheet;
    const disc = this.compile(DISC_SRC, UNIFORMS.disc);
    if (!disc.ok) return disc;
    const depth = this.compile(DEPTH_SRC, UNIFORMS.depth);
    if (!depth.ok) return depth;
    this.progs = { sheet: sheet.value, disc: disc.value, depth: depth.value };
    return okResult(this.progs);
  }

  private compile(src: GlProgramSrc, names: readonly string[]): Result<Prog> {
    const gl = this.gl;
    const shader = (type: number, code: string): WebGLShader | null => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, code);
      gl.compileShader(s);
      if (gl.getShaderParameter(s, gl.COMPILE_STATUS) !== true) {
        gl.deleteShader(s);
        return null;
      }
      return s;
    };
    const vs = shader(gl.VERTEX_SHADER, src.vertex);
    const fs = shader(gl.FRAGMENT_SHADER, src.fragment);
    const program = vs && fs ? gl.createProgram() : null;
    if (!vs || !fs || !program) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return glError('WebGL 2 shader compile', 'webgl_shader', 'The shaders are built in; this is a bug, not a figure error.');
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
      gl.deleteProgram(program);
      return glError('WebGL 2 program link', 'webgl_shader');
    }
    const u: Record<string, WebGLUniformLocation | null> = {};
    for (const n of names) u[n] = gl.getUniformLocation(program, n);
    return okResult({ program, u });
  }

  /** Grows the drawing buffer to at least `w × h` device pixels (never shrinks, so views of other sizes share it). */
  ensureSize(w: number, h: number): void {
    const c = this.canvas;
    if (c.width < w || c.height < h) {
      c.width = Math.max(c.width, w);
      c.height = Math.max(c.height, h);
    }
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onLost as EventListener);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored as EventListener);
    if (this.progs && !this.gl.isContextLost()) {
      for (const p of [this.progs.sheet, this.progs.disc, this.progs.depth]) this.gl.deleteProgram(p.program);
    }
    this.progs = undefined;
  }
}

interface SheetRes {
  readonly tex: WebGLTexture;
  readonly ibo: WebGLBuffer;
  readonly vao: WebGLVertexArrayObject;
  readonly nx: number;
  readonly ny: number;
  readonly topology: number | undefined;
  readonly tris: Uint32Array | undefined;
  readonly count: number;
  readonly gen: number;
  seen: number;
}

export interface GlStats3 {
  drawCalls: number;
  triangles: number;
  drops: number;
  /** Bytes copied to the GPU this frame. */
  uploadBytes: number;
  /** Index buffers made this frame (0 once a topology is known). */
  indexBuilds: number;
}

export interface GlPainted3 {
  /** Draw `source` from (0, 0, sw, sh) onto the view's `width × height` CSS rectangle. */
  readonly source: GlCanvas;
  readonly sw: number;
  readonly sh: number;
  readonly stats: GlStats3;
}

/** Frames a sheet may go unseen before its texture and triangles are freed. */
const KEEP_FRAMES = 240;

const LIGHT_CODE = { lit: 0, flat: 1, off: 2 } as const;

/** The painter the Space view feeds each frame. */
export class MeshPainter3 {
  readonly backend: GlBackend3;
  private readonly sheets = new Map<number, SheetRes>();
  private frameNo = 0;
  private gen = -1;
  private quad: WebGLBuffer | null = null;
  private inst: WebGLBuffer | null = null;
  private instCap = 0;
  private discVao: WebGLVertexArrayObject | null = null;
  private depthBuf: WebGLBuffer | null = null;
  private depthCap = 0;
  private depthVao: WebGLVertexArrayObject | null = null;
  private readonly vp32 = new Float32Array(16);
  private readonly rot32 = new Float32Array(9);

  private constructor(backend: GlBackend3) {
    this.backend = backend;
  }

  /** A painter on its own canvas; `webgl_unavailable` when the browser has no WebGL 2. */
  static create(canvas: GlCanvas): Result<MeshPainter3> {
    const b = GlBackend3.open(canvas);
    if (!b.ok) return b;
    const p = new MeshPainter3(b.value);
    const progs = b.value.programs();
    if (!progs.ok) {
      b.value.dispose();
      return progs;
    }
    return okResult(p);
  }

  get canvas(): GlCanvas {
    return this.backend.canvas;
  }

  lost(): boolean {
    return this.backend.lost();
  }

  /** The sheets whose GPU copies are kept (for tests). */
  kept(): number {
    return this.sheets.size;
  }

  /** Everything made on a context that was lost is gone: start again on the new one. */
  private renew(): void {
    if (this.gen === this.backend.generation) return;
    this.gen = this.backend.generation;
    this.sheets.clear();
    this.quad = null;
    this.inst = null;
    this.instCap = 0;
    this.discVao = null;
    this.depthBuf = null;
    this.depthCap = 0;
    this.depthVao = null;
  }

  paint(f: GlFrame3): Result<GlPainted3> {
    const b = this.backend;
    if (b.lost()) return glError('WebGL 2', 'webgl_lost', 'The WebGL 2 context was lost; the software painter draws until it is back.');
    const gl = b.gl;
    const stats: GlStats3 = { drawCalls: 0, triangles: 0, drops: 0, uploadBytes: 0, indexBuilds: 0 };
    try {
      this.renew();
      const progs = b.programs();
      if (!progs.ok) return progs;
      const P = progs.value;
      this.frameNo++;
      const pr = Number.isFinite(f.pixelRatio) && f.pixelRatio > 0 ? f.pixelRatio : 1;
      const wd = Math.max(1, Math.round(f.width * pr));
      const hd = Math.max(1, Math.round(f.height * pr));
      b.ensureSize(wd, hd);
      const H = b.canvas.height;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      gl.depthMask(true);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      // the top-left wd × hd pixels of the canvas, where `drawImage` reads them
      gl.viewport(0, H - hd, wd, hd);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.CULL_FACE);
      for (let i = 0; i < 16; i++) this.vp32[i] = f.vp[i] ?? 0;
      for (let i = 0; i < 9; i++) this.rot32[i] = f.rot[i] ?? 0;
      const clipOn = f.clip ? 1 : 0;
      const cmin = f.clip?.min ?? { x: 0, y: 0, z: 0 };
      const cmax = f.clip?.max ?? { x: 0, y: 0, z: 0 };
      const light = LIGHT_CODE[f.light] ?? 0;

      /* 1. the software painter's solids, depth only, pushed back a hair so a sheet lying on one wins */
      if (f.occluderVerts > 0) {
        if (!this.depthBuf) {
          this.depthBuf = gl.createBuffer();
          this.depthVao = gl.createVertexArray();
          gl.bindVertexArray(this.depthVao);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.depthBuf);
          gl.enableVertexAttribArray(0);
          gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
        }
        gl.bindVertexArray(this.depthVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.depthBuf);
        const n = f.occluderVerts * 3;
        if (n > this.depthCap) {
          this.depthCap = Math.max(n, this.depthCap * 2);
          gl.bufferData(gl.ARRAY_BUFFER, this.depthCap * 4, gl.DYNAMIC_DRAW);
        }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, f.occluders, 0, n);
        stats.uploadBytes += n * 4;
        gl.useProgram(P.depth.program);
        gl.uniformMatrix4fv(P.depth.u['uVp'] ?? null, false, this.vp32);
        gl.colorMask(false, false, false, false);
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(1, 2);
        gl.drawArrays(gl.TRIANGLES, 0, f.occluderVerts);
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.colorMask(true, true, true, true);
        stats.drawCalls++;
        stats.triangles += f.occluderVerts / 3;
      }

      /* 2. sheets, opaque ones first, then the see-through ones without writing depth */
      gl.useProgram(P.sheet.program);
      const us = P.sheet.u;
      gl.uniformMatrix4fv(us['uVp'] ?? null, false, this.vp32);
      gl.uniformMatrix3fv(us['uRot'] ?? null, false, this.rot32);
      gl.uniform1f(us['uLight'] ?? null, light);
      gl.uniform4f(us['uClipMin'] ?? null, cmin.x, cmin.y, cmin.z, clipOn);
      gl.uniform3f(us['uClipMax'] ?? null, cmax.x, cmax.y, cmax.z);
      gl.uniform1i(us['uPos'] ?? null, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      for (const pass of [0, 1]) {
        for (const s of f.sheets) {
          const see = s.alpha < 0.999;
          if ((pass === 1) !== see) continue;
          const res = this.sheetRes(s, stats);
          if (!res) continue;
          gl.bindTexture(gl.TEXTURE_2D, res.tex);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, s.nx, s.ny, gl.RGB, gl.FLOAT, s.pos, 0);
          stats.uploadBytes += s.nx * s.ny * 12;
          gl.uniform2i(us['uSize'] ?? null, s.nx, s.ny);
          gl.uniform3f(us['uColor'] ?? null, s.color[0], s.color[1], s.color[2]);
          gl.uniform1f(us['uAlpha'] ?? null, Math.max(0, Math.min(1, s.alpha)));
          gl.uniform1f(us['uThreads'] ?? null, s.threads > 0 ? s.threads : 0);
          if (see) {
            gl.enable(gl.BLEND);
            gl.depthMask(false);
          } else {
            gl.disable(gl.BLEND);
            gl.depthMask(true);
          }
          gl.bindVertexArray(res.vao);
          gl.drawElements(gl.TRIANGLES, res.count, gl.UNSIGNED_INT, 0);
          stats.drawCalls++;
          stats.triangles += res.count / 3;
        }
      }
      gl.depthMask(true);

      /* 3. drops: one instanced call a batch */
      if (f.drops.some((d) => d.count > 0)) {
        if (!this.quad) {
          this.quad = gl.createBuffer();
          this.inst = gl.createBuffer();
          this.discVao = gl.createVertexArray();
          gl.bindVertexArray(this.discVao);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
          gl.enableVertexAttribArray(0);
          gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
          gl.enableVertexAttribArray(1);
          gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 12, 0);
          gl.vertexAttribDivisor(1, 1);
        }
        gl.useProgram(P.disc.program);
        const ud = P.disc.u;
        gl.uniformMatrix4fv(ud['uVp'] ?? null, false, this.vp32);
        gl.uniform3f(ud['uRight'] ?? null, f.right.x, f.right.y, f.right.z);
        gl.uniform3f(ud['uUp'] ?? null, f.up.x, f.up.y, f.up.z);
        gl.uniform4f(ud['uClipMin'] ?? null, cmin.x, cmin.y, cmin.z, clipOn);
        gl.uniform3f(ud['uClipMax'] ?? null, cmax.x, cmax.y, cmax.z);
        gl.uniform1f(ud['uLight'] ?? null, light);
        gl.bindVertexArray(this.discVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
        for (const d of f.drops) {
          const n = Math.min(d.count, Math.floor(d.pos.length / 3));
          if (n <= 0) continue;
          if (n * 3 > this.instCap) {
            this.instCap = Math.max(n * 3, this.instCap * 2);
            gl.bufferData(gl.ARRAY_BUFFER, this.instCap * 4, gl.DYNAMIC_DRAW);
          }
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.pos, 0, n * 3);
          stats.uploadBytes += n * 12;
          gl.uniform1f(ud['uRadius'] ?? null, d.radius);
          gl.uniform3f(ud['uColor'] ?? null, d.color[0], d.color[1], d.color[2]);
          const a = Math.max(0, Math.min(1, d.alpha));
          gl.uniform1f(ud['uAlpha'] ?? null, a);
          // drops write depth even when see-through: the nearest of a crowd shows, as in a real splash
          if (a < 0.999) gl.enable(gl.BLEND);
          else gl.disable(gl.BLEND);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
          stats.drawCalls++;
          stats.triangles += 2 * n;
          stats.drops += n;
        }
      }
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
      this.sweep();
      return okResult({ source: b.canvas, sw: wd, sh: hd, stats });
    } catch {
      return glError('WebGL 2 painter', 'webgl_draw');
    }
  }

  /** The texture and triangles of a sheet, made again only when its size or topology changes. */
  private sheetRes(s: GlSheet3, stats: GlStats3): SheetRes | undefined {
    const gl = this.backend.gl;
    const nx = Math.floor(s.nx);
    const ny = Math.floor(s.ny);
    if (!(nx >= 2 && ny >= 2) || s.pos.length < nx * ny * 3) return undefined;
    const old = this.sheets.get(s.key);
    if (old && old.nx === nx && old.ny === ny && old.topology === s.topology && old.tris === s.tris && old.gen === this.gen) {
      old.seen = this.frameNo;
      return old;
    }
    if (old) this.free(s.key, old);
    let tris = s.tris ?? gridTriangles(nx, ny);
    if (s.tris) {
      // triangles naming a point the sheet does not have are dropped, so a bad topology draws less, never garbage
      const max = nx * ny;
      let bad = false;
      for (let i = 0; i < tris.length; i++) if ((tris[i] as number) >= max) bad = true;
      if (bad) tris = tris.filter((_v, i) => {
        const t = i - (i % 3);
        return (tris[t] as number) < max && (tris[t + 1] as number) < max && (tris[t + 2] as number) < max;
      });
    }
    const tex = gl.createTexture();
    const ibo = gl.createBuffer();
    const vao = gl.createVertexArray();
    if (!tex || !ibo || !vao) return undefined;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGB32F, nx, ny);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, tris, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    stats.indexBuilds++;
    stats.uploadBytes += tris.byteLength;
    const res: SheetRes = { tex, ibo, vao, nx, ny, topology: s.topology, tris: s.tris, count: tris.length - (tris.length % 3), gen: this.gen, seen: this.frameNo };
    this.sheets.set(s.key, res);
    return res;
  }

  private free(key: number, r: SheetRes): void {
    const gl = this.backend.gl;
    if (r.gen === this.gen && !gl.isContextLost()) {
      gl.deleteTexture(r.tex);
      gl.deleteBuffer(r.ibo);
      gl.deleteVertexArray(r.vao);
    }
    this.sheets.delete(key);
  }

  private sweep(): void {
    for (const [k, r] of this.sheets) if (this.frameNo - r.seen > KEEP_FRAMES) this.free(k, r);
  }

  dispose(): void {
    for (const [k, r] of [...this.sheets]) this.free(k, r);
    const gl = this.backend.gl;
    if (!gl.isContextLost()) {
      for (const x of [this.quad, this.inst, this.depthBuf]) if (x) gl.deleteBuffer(x);
      for (const v of [this.discVao, this.depthVao]) if (v) gl.deleteVertexArray(v);
    }
    this.backend.dispose();
  }
}
