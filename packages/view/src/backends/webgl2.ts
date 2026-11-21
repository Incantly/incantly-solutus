/**
 * WebGL2 back-end: the default GPU target (space-3d design 9, performance 2).
 * The host owns the canvas and hands this file its context; figures never
 * create their own. MSAA targets resolve through `resolveFrame`; the WBOIT
 * composite runs through `compositeWboit`. Nothing here throws: every entry
 * returns a `Result`.
 */
import { ArenaAllocator } from '../core/scene';
import { okResult, viewError } from '../errors';
import type { Result } from '@incantly/kernel';
import type {
  Arena, Batch, DrawStats, FrameCtx, FrameSize, GpuBackend, GpuCapabilities,
  Program, ShaderSrc, Target, TargetSpec, VertexLayout,
} from '../core/gpu';

interface GlArena extends Arena {
  readonly vbo: WebGLBuffer;
  readonly ibo: WebGLBuffer;
  readonly indexCap: number;
  readonly alloc_: ArenaAllocator;
}

interface GlTarget extends Target {
  readonly fbo: WebGLFramebuffer;
  readonly colorTex: WebGLTexture;
  readonly depthRb: WebGLRenderbuffer | null;
  readonly msaaFbo: WebGLFramebuffer | null;
  readonly msaaColor: WebGLRenderbuffer | null;
  readonly msaaDepth: WebGLRenderbuffer | null;
}

interface GlProgram extends Program {
  readonly program: WebGLProgram;
  readonly uniformCache: Map<string, WebGLUniformLocation | null>;
  readonly attribCache: Map<string, number>;
}

interface GlFrame extends FrameCtx {
  readonly glTarget: GlTarget;
  readonly frameSize: FrameSize;
}

/** Every GL handle this back-end creates and later disposes. */
type GlOwned = WebGLBuffer | WebGLFramebuffer | WebGLProgram | WebGLRenderbuffer | WebGLShader | WebGLTexture;

function internalError(where: string, hint?: string): Result<never> {
  return viewError({
    kind: 'internal',
    messageKey: 'view.internal',
    params: { where },
    token: where,
    ...(hint === undefined ? {} : { hint }),
  });
}

export class WebGL2Backend implements GpuBackend {
  readonly kind = 'webgl2' as const;
  readonly capabilities: GpuCapabilities;
  /** Live handles only: each `dispose` closure removes its handles (VIEW-SM-4). */
  private readonly owned = new Set<GlOwned>();
  private readonly gl: WebGL2RenderingContext;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const floatExt = gl.getExtension('EXT_color_buffer_float');
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.capabilities = {
      floatTargets: floatExt !== null,
      msaa: true,
      instancing: true,
      maxTextureSize: typeof maxTextureSize === 'number' ? maxTextureSize : 2048,
    };
  }

  private track<T extends GlOwned>(o: T | null, what: string): Result<T> {
    if (o === null) return internalError(`WebGL2 ${what}`);
    this.owned.add(o);
    return okResult(o);
  }

  createArena(layout: VertexLayout, capacityBytes: number): Result<Arena> {
    const gl = this.gl;
    if (gl.isContextLost()) return internalError('WebGL2 context lost');
    try {
      const vbo = this.track(gl.createBuffer(), 'vertex buffer');
      if (!vbo.ok) return vbo;
      const ibo = this.track(gl.createBuffer(), 'index buffer');
      if (!ibo.ok) return ibo;
      const indexCap = Math.floor(capacityBytes / 2);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo.value);
      gl.bufferData(gl.ARRAY_BUFFER, capacityBytes, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo.value);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexCap, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
      const stride = Math.max(layout.strideBytes, 4);
      const arena: GlArena = {
        layout,
        capacityBytes,
        usedBytes: 0,
        vbo: vbo.value,
        ibo: ibo.value,
        indexCap: Math.floor(indexCap / 4),
        alloc_: new ArenaAllocator(capacityBytes),
        alloc: (vertexCount: number): number => {
          const off = arena.alloc_.alloc(vertexCount * stride);
          (arena as { usedBytes: number }).usedBytes = arena.alloc_.usedBytes;
          return off < 0 ? -1 : Math.floor(off / stride);
        },
        free: (offsetVertices: number, vertexCount: number): void => {
          arena.alloc_.free(offsetVertices * stride, vertexCount * stride);
          (arena as { usedBytes: number }).usedBytes = arena.alloc_.usedBytes;
        },
        writeVertices: (offsetVertices: number, data: Float32Array): void => {
          gl.bindBuffer(gl.ARRAY_BUFFER, arena.vbo);
          gl.bufferSubData(gl.ARRAY_BUFFER, offsetVertices * stride, data);
          gl.bindBuffer(gl.ARRAY_BUFFER, null);
        },
        writeIndices: (offsetIndices: number, data: Uint32Array): void => {
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, arena.ibo);
          gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, offsetIndices * 4, data);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
        },
        dispose: (): void => {
          gl.deleteBuffer(arena.vbo);
          gl.deleteBuffer(arena.ibo);
          this.owned.delete(arena.vbo);
          this.owned.delete(arena.ibo);
        },
      };
      return okResult(arena);
    } catch {
      return internalError('WebGL2 arena creation');
    }
  }

  createTarget(spec: TargetSpec): Result<Target> {
    const gl = this.gl;
    if (gl.isContextLost()) return internalError('WebGL2 context lost');
    try {
      const w = Math.max(1, Math.floor(spec.width));
      const h = Math.max(1, Math.floor(spec.height));
      const floatOK = spec.float && this.capabilities.floatTargets;
      const colorTex = this.track(gl.createTexture(), 'colour texture');
      if (!colorTex.ok) return colorTex;
      gl.bindTexture(gl.TEXTURE_2D, colorTex.value);
      gl.texImage2D(gl.TEXTURE_2D, 0, floatOK ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, floatOK ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = this.track(gl.createFramebuffer(), 'framebuffer');
      if (!fbo.ok) return fbo;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.value);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex.value, 0);
      let depthRb: WebGLRenderbuffer | null = null;
      if (spec.depth) {
        const depth = this.track(gl.createRenderbuffer(), 'depth buffer');
        if (!depth.ok) return depth;
        depthRb = depth.value;
        gl.bindRenderbuffer(gl.RENDERBUFFER, depth.value);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth.value);
      }
      let msaaFbo: WebGLFramebuffer | null = null;
      let msaaColor: WebGLRenderbuffer | null = null;
      let msaaDepth: WebGLRenderbuffer | null = null;
      if (spec.samples > 1) {
        const maxSamples = gl.getParameter(gl.MAX_SAMPLES) as number;
        const samples = Math.min(spec.samples, typeof maxSamples === 'number' ? maxSamples : 4);
        const mf = this.track(gl.createFramebuffer(), 'MSAA framebuffer');
        if (!mf.ok) return mf;
        msaaFbo = mf.value;
        const mc = this.track(gl.createRenderbuffer(), 'MSAA colour buffer');
        if (!mc.ok) return mc;
        msaaColor = mc.value;
        gl.bindFramebuffer(gl.FRAMEBUFFER, msaaFbo);
        gl.bindRenderbuffer(gl.RENDERBUFFER, msaaColor);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, floatOK ? gl.RGBA16F : gl.RGBA8, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msaaColor);
        if (spec.depth) {
          const md = this.track(gl.createRenderbuffer(), 'MSAA depth buffer');
          if (!md.ok) return md;
          msaaDepth = md.value;
          gl.bindRenderbuffer(gl.RENDERBUFFER, msaaDepth);
          gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
          gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, msaaDepth);
        }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      const target: GlTarget = {
        spec,
        fbo: fbo.value,
        colorTex: colorTex.value,
        depthRb,
        msaaFbo,
        msaaColor,
        msaaDepth,
        dispose: (): void => {
          gl.deleteFramebuffer(target.fbo);
          gl.deleteTexture(target.colorTex);
          if (target.depthRb !== null) gl.deleteRenderbuffer(target.depthRb);
          if (target.msaaFbo !== null) gl.deleteFramebuffer(target.msaaFbo);
          if (target.msaaColor !== null) gl.deleteRenderbuffer(target.msaaColor);
          if (target.msaaDepth !== null) gl.deleteRenderbuffer(target.msaaDepth);
          for (const h of [target.fbo, target.colorTex, target.depthRb, target.msaaFbo, target.msaaColor, target.msaaDepth]) {
            if (h !== null) this.owned.delete(h);
          }
        },
      };
      return okResult(target);
    } catch {
      return internalError('WebGL2 target creation');
    }
  }

  createProgram(src: ShaderSrc): Result<Program> {
    const gl = this.gl;
    if (gl.isContextLost()) return internalError('WebGL2 context lost');
    try {
      const compile = (type: number, code: string): WebGLShader | null => {
        const sh = gl.createShader(type);
        if (sh === null) return null;
        gl.shaderSource(sh, code);
        gl.compileShader(sh);
        if (gl.getShaderParameter(sh, gl.COMPILE_STATUS) !== true) {
          gl.deleteShader(sh);
          return null;
        }
        return sh;
      };
      const vs = compile(gl.VERTEX_SHADER, src.vertex);
      const fs = compile(gl.FRAGMENT_SHADER, src.fragment);
      if (vs === null || fs === null) {
        if (vs !== null) gl.deleteShader(vs);
        if (fs !== null) gl.deleteShader(fs);
        return internalError('WebGL2 shader compile', 'The shader sources are built in; this is a bug, not a figure error.');
      }
      const program = gl.createProgram();
      if (program === null) {
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        return internalError('WebGL2 program creation');
      }
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
        gl.deleteProgram(program);
        return internalError('WebGL2 program link');
      }
      this.owned.add(program);
      const wrapped: GlProgram = {
        program,
        uniformCache: new Map(),
        attribCache: new Map(),
        dispose: (): void => {
          gl.deleteProgram(wrapped.program);
          this.owned.delete(wrapped.program);
        },
      };
      return okResult(wrapped);
    } catch {
      return internalError('WebGL2 program creation');
    }
  }

  beginFrame(target: Target, size: FrameSize): Result<FrameCtx> {
    const gl = this.gl;
    if (gl.isContextLost()) return internalError('WebGL2 context lost');
    try {
      const t = target as GlTarget;
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.msaaFbo ?? t.fbo);
      const w = Math.floor(size.width * size.dpr);
      const h = Math.floor(size.height * size.dpr);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const frame: GlFrame = {
        target,
        size,
        glTarget: t,
        frameSize: size,
        dispose: (): void => undefined,
      };
      return okResult(frame);
    } catch {
      return internalError('WebGL2 beginFrame');
    }
  }

  /** Resolve an MSAA target into its texture (call before present/readback). */
  resolveFrame(frame: FrameCtx): void {
    const gl = this.gl;
    const t = (frame as GlFrame).glTarget;
    if (t.msaaFbo === null) return;
    try {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.msaaFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.fbo);
      const w = Math.floor(frame.size.width * frame.size.dpr);
      const h = Math.floor(frame.size.height * frame.size.dpr);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    } catch {
      // A failed resolve leaves the last good pixels; the frame is dropped.
    }
  }

  /**
   * Resolve an MSAA frame into another single-sample target of the same size (the board draws each tile into one
   * shared multisample target, then keeps the resolved copy in the tile's own texture).
   */
  resolveInto(frame: FrameCtx, dest: Target): Result<void> {
    const gl = this.gl;
    if (gl.isContextLost()) return internalError('WebGL2 context lost');
    try {
      const src = (frame as GlFrame).glTarget;
      const dst = dest as GlTarget;
      const w = Math.floor(frame.size.width * frame.size.dpr);
      const h = Math.floor(frame.size.height * frame.size.dpr);
      gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.msaaFbo ?? src.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst.fbo);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return okResult(undefined);
    } catch {
      return internalError('WebGL2 resolveInto');
    }
  }

  /**
   * Copy a resolved target to the context's own canvas so a 2D
   * context can `drawImage` it without a CPU readback (VIEW-SM-25). The
   * target lands in the bottom `h` rows of the canvas.
   */
  blitToCanvas(target: Target, w: number, h: number): Result<void> {
    const gl = this.gl;
    if (gl.isContextLost()) return internalError('WebGL2 context lost');
    try {
      const t = target as GlTarget;
      gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return okResult(undefined);
    } catch {
      return internalError('WebGL2 blit');
    }
  }

  draw(frame: FrameCtx, batch: Batch, stats: DrawStats): Result<void> {
    const gl = this.gl;
    if (gl.isContextLost()) return internalError('WebGL2 context lost');
    try {
      const prog = batch.program as GlProgram;
      const arena = batch.arena as GlArena;
      gl.useProgram(prog.program);
      // Uniforms.
      for (const [name, value] of Object.entries(batch.uniforms)) {
        let loc = prog.uniformCache.get(name);
        if (loc === undefined) {
          loc = gl.getUniformLocation(prog.program, name);
          prog.uniformCache.set(name, loc);
        }
        if (loc === null) continue;
        if (typeof value === 'number') gl.uniform1f(loc, value);
        else {
          const arr = Array.isArray(value) ? value : [...value];
          if (arr.length === 2) gl.uniform2fv(loc, arr);
          else if (arr.length === 3) gl.uniform3fv(loc, arr);
          else if (arr.length === 4) gl.uniform4fv(loc, arr);
          else if (arr.length === 16) gl.uniformMatrix4fv(loc, false, arr);
          else if (arr.length === 9) gl.uniformMatrix3fv(loc, false, arr);
        }
      }
      // Textures: each named target is bound to the next texture unit and the sampler is pointed at it.
      let unit = 0;
      for (const [name, tex] of Object.entries(batch.textures ?? {})) {
        const loc = gl.getUniformLocation(prog.program, name);
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, (tex as GlTarget).colorTex);
        if (loc !== null) gl.uniform1i(loc, unit);
        unit++;
      }
      gl.activeTexture(gl.TEXTURE0);
      // Vertex layout.
      gl.bindBuffer(gl.ARRAY_BUFFER, arena.vbo);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, arena.ibo);
      let offset = 0;
      for (const attr of arena.layout.attributes) {
        let at = prog.attribCache.get(attr.name);
        if (at === undefined) {
          at = gl.getAttribLocation(prog.program, attr.name);
          prog.attribCache.set(attr.name, at);
        }
        if (at < 0) {
          offset += attr.size * 4;
          continue;
        }
        gl.enableVertexAttribArray(at);
        gl.vertexAttribPointer(at, attr.size, gl.FLOAT, false, arena.layout.strideBytes, offset);
        offset += attr.size * 4;
      }
      // State.
      if (batch.depthTest) {
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(batch.depthFunc === 'greater' ? gl.GREATER : gl.LESS);
      } else gl.disable(gl.DEPTH_TEST);
      gl.depthMask(batch.depthWrite);
      if (batch.blend === 'none') gl.disable(gl.BLEND);
      else {
        gl.enable(gl.BLEND);
        if (batch.blend === 'add') gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        else if (batch.blend === 'premult') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }
      if (batch.cullBack) {
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
      } else gl.disable(gl.CULL_FACE);
      if (batch.scissor !== null) {
        gl.enable(gl.SCISSOR_TEST);
        const dpr = frame.size.dpr;
        gl.scissor(
          Math.floor(batch.scissor.x * dpr),
          Math.floor((frame.size.height - batch.scissor.y - batch.scissor.h) * dpr),
          Math.floor(batch.scissor.w * dpr),
          Math.floor(batch.scissor.h * dpr),
        );
      } else gl.disable(gl.SCISSOR_TEST);
      // Draw.
      switch (batch.mode) {
        case 'triangles':
          gl.drawElements(gl.TRIANGLES, batch.indexCount, gl.UNSIGNED_INT, batch.firstIndex * 4);
          stats.triangles += Math.floor(batch.indexCount / 3);
          break;
        case 'lines':
          gl.drawArrays(gl.LINES, batch.firstVertex, batch.vertexCount);
          stats.lines += Math.floor(batch.vertexCount / 2);
          break;
        case 'points':
          if (batch.instances > 1) gl.drawArraysInstanced(gl.POINTS, batch.firstVertex, Math.max(batch.vertexCount, 1), batch.instances);
          else gl.drawArrays(gl.POINTS, batch.firstVertex, batch.vertexCount);
          stats.points += batch.vertexCount * Math.max(batch.instances, 1);
          break;
        case 'instancedTriangles':
          gl.drawElementsInstanced(gl.TRIANGLES, batch.indexCount, gl.UNSIGNED_INT, batch.firstIndex * 4, batch.instances);
          stats.triangles += Math.floor(batch.indexCount / 3) * batch.instances;
          break;
        case 'instancedQuads':
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, batch.firstVertex, 4, batch.instances);
          stats.triangles += 2 * batch.instances;
          break;
      }
      stats.drawCalls++;
      for (const attr of arena.layout.attributes) {
        const at = prog.attribCache.get(attr.name) ?? -1;
        if (at >= 0) gl.disableVertexAttribArray(at);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
      return okResult(undefined);
    } catch {
      return internalError('WebGL2 draw');
    }
  }

  setViewport(frame: FrameCtx, x: number, y: number, w: number, h: number): void {
    try {
      const t = (frame as GlFrame).glTarget;
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, t.msaaFbo ?? t.fbo);
      this.gl.viewport(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
    } catch {
      // Viewport failures are ignored; the next beginFrame resets state.
    }
  }

  readPixels(target: Target, rect: { x: number; y: number; w: number; h: number }): Result<Uint8Array> {
    const gl = this.gl;
    if (gl.isContextLost()) return internalError('WebGL2 context lost');
    try {
      const t = target as GlTarget;
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      const out = new Uint8Array(Math.max(rect.w, 0) * Math.max(rect.h, 0) * 4);
      gl.readPixels(rect.x, rect.y, rect.w, rect.h, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return okResult(out);
    } catch {
      return internalError('WebGL2 readPixels');
    }
  }

  dispose(): void {
    const gl = this.gl;
    try {
      for (const o of this.owned) {
        if (o instanceof WebGLBuffer) gl.deleteBuffer(o);
        else if (o instanceof WebGLProgram) gl.deleteProgram(o);
        else if (o instanceof WebGLFramebuffer) gl.deleteFramebuffer(o);
        else if (o instanceof WebGLTexture) gl.deleteTexture(o);
        else if (o instanceof WebGLRenderbuffer) gl.deleteRenderbuffer(o);
        else if (o instanceof WebGLShader) gl.deleteShader(o);
      }
      this.owned.clear();
    } catch {
      // Disposal never reports; the context may already be gone.
    }
  }
}

/* ---------------- instanced batch packing (pure) ---------------- */

/** Pack 2D points for one instanced draw: 10,000 points, one call. */
export function packPointInstances(items: ReadonlyArray<{ x: number; y: number; sizePx: number; r: number; g: number; b: number; a: number }>): {
  pos: Float32Array;
  col: Float32Array;
} {
  const pos = new Float32Array(items.length * 3);
  const col = new Float32Array(items.length * 4);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it === undefined) continue;
    pos[i * 3] = it.x;
    pos[i * 3 + 1] = it.y;
    pos[i * 3 + 2] = it.sizePx;
    col[i * 4] = it.r / 255;
    col[i * 4 + 1] = it.g / 255;
    col[i * 4 + 2] = it.b / 255;
    col[i * 4 + 3] = it.a;
  }
  return { pos, col };
}

/** Pack segments as screen-aligned quads (4 verts each) for the line shader. */
export function packLineQuads(segments: ReadonlyArray<{ ax: number; ay: number; bx: number; by: number; r: number; g: number; b: number; a: number }>): {
  ends: Float32Array;
  others: Float32Array;
  sides: Float32Array;
  cols: Float32Array;
} {
  const n = segments.length;
  const ends = new Float32Array(n * 4 * 2);
  const others = new Float32Array(n * 4 * 2);
  const sides = new Float32Array(n * 4);
  const cols = new Float32Array(n * 4 * 4);
  for (let i = 0; i < n; i++) {
    const s = segments[i];
    if (s === undefined) continue;
    const quad: ReadonlyArray<readonly [number, number, number, number, number]> = [
      [s.ax, s.ay, s.bx, s.by, -1],
      [s.ax, s.ay, s.bx, s.by, 1],
      [s.bx, s.by, s.ax, s.ay, -1],
      [s.bx, s.by, s.ax, s.ay, 1],
    ];
    for (let k = 0; k < 4; k++) {
      const q = quad[k];
      if (q === undefined) continue;
      ends[(i * 4 + k) * 2] = q[0];
      ends[(i * 4 + k) * 2 + 1] = q[1];
      others[(i * 4 + k) * 2] = q[2];
      others[(i * 4 + k) * 2 + 1] = q[3];
      sides[i * 4 + k] = q[4];
      cols[(i * 4 + k) * 4] = s.r / 255;
      cols[(i * 4 + k) * 4 + 1] = s.g / 255;
      cols[(i * 4 + k) * 4 + 2] = s.b / 255;
      cols[(i * 4 + k) * 4 + 3] = s.a;
    }
  }
  return { ends, others, sides, cols };
}
