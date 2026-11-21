/**
 * The live layer on WebGL 2 (design 6.3, BR-67, BR-74): the stroke being drawn is its triangles from the outliner's own
 * typed arrays, uploaded and drawn every frame in one colour with no blending (so its opacity is the canvas's CSS
 * opacity and overlapping pieces never darken), and the predicted tail is a strip of triangles built into a typed array
 * the layer owns, drawn at half strength over it. Nothing here makes a number object or an array in a frame: the GL
 * calls take numbers and typed arrays, so drawing a stroke gives the garbage collector nothing to do (the Canvas 2D
 * calls it replaces made one number object for each decimal argument).
 */
const VERTEX = ['#version 300 es', 'layout(location=0) in vec2 aPos;', 'uniform vec4 uXf;', 'void main(){ gl_Position = vec4(aPos * uXf.xy + uXf.zw, 0.0, 1.0); }'].join('\n');
const FRAGMENT = ['#version 300 es', 'precision mediump float;', 'uniform vec4 uCol;', 'out vec4 oCol;', 'void main(){ oCol = uCol; }'].join('\n');

/** Steps of the round end of the predicted tail. */
const CAP_STEPS = 6;

export class LiveGl {
  readonly #gl: WebGL2RenderingContext;
  readonly #program: WebGLProgram;
  readonly #xf: WebGLUniformLocation | null;
  readonly #col: WebGLUniformLocation | null;
  readonly #strokeVao: WebGLVertexArrayObject | null;
  readonly #strokeVbo: WebGLBuffer | null;
  readonly #strokeIbo: WebGLBuffer | null;
  readonly #tailVao: WebGLVertexArrayObject | null;
  readonly #tailVbo: WebGLBuffer | null;
  #vboBytes = 0;
  #iboBytes = 0;
  #tailBytes = 0;
  #tail = new Float32Array(2 * 3 * (2 * 16 + CAP_STEPS));
  #width = 1;
  #height = 1;

  private constructor(gl: WebGL2RenderingContext, program: WebGLProgram) {
    this.#gl = gl;
    this.#program = program;
    this.#xf = gl.getUniformLocation(program, 'uXf');
    this.#col = gl.getUniformLocation(program, 'uCol');
    this.#strokeVao = gl.createVertexArray();
    this.#strokeVbo = gl.createBuffer();
    this.#strokeIbo = gl.createBuffer();
    this.#tailVao = gl.createVertexArray();
    this.#tailVbo = gl.createBuffer();
    gl.bindVertexArray(this.#strokeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#strokeVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.#strokeIbo);
    gl.bindVertexArray(this.#tailVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#tailVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(program);
    gl.clearColor(0, 0, 0, 0);
  }

  /** The layer on `canvas`, or null when the browser gives no WebGL 2 context. Nothing throws. */
  static open(canvas: HTMLCanvasElement): LiveGl | null {
    try {
      const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true, depth: false, stencil: false, preserveDrawingBuffer: true, desynchronized: true, powerPreference: 'high-performance' }) as WebGL2RenderingContext | null;
      if (gl === null || typeof gl.drawElements !== 'function') return null;
      const compile = (type: number, source: string): WebGLShader | null => {
        const shader = gl.createShader(type);
        if (shader === null) return null;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
          gl.deleteShader(shader);
          return null;
        }
        return shader;
      };
      const vs = compile(gl.VERTEX_SHADER, VERTEX);
      const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
      const program = gl.createProgram();
      if (vs === null || fs === null || program === null) return null;
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) return null;
      return new LiveGl(gl, program);
    } catch {
      return null;
    }
  }

  /** The canvas is `w × h` device pixels. */
  resize(w: number, h: number): void {
    this.#width = w;
    this.#height = h;
  }

  /** Empties the layer. */
  clear(): void {
    const gl = this.#gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.#width, this.#height);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /**
   * Draws triangles of the outliner's typed arrays (`vertexCount` vertices, `indexCount` indices) in one opaque colour.
   * `p` holds `sx, sy, tx, ty, r, g, b` (numbers in one typed array, so the call makes no number objects): vertex `(x, y)`
   * goes to `x * sx + tx, y * sy + ty` in clip space.
   */
  drawStroke(vertices: Float32Array, vertexCount: number, indices: Uint32Array, indexCount: number, p: Float64Array): void {
    if (indexCount < 3) return;
    const gl = this.#gl;
    gl.bindVertexArray(this.#strokeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#strokeVbo);
    const vBytes = vertexCount * 8;
    if (vBytes > this.#vboBytes) {
      this.#vboBytes = Math.max(vBytes, this.#vboBytes * 2, 65536);
      gl.bufferData(gl.ARRAY_BUFFER, this.#vboBytes, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices, 0, vertexCount * 2);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.#strokeIbo);
    const iBytes = indexCount * 4;
    if (iBytes > this.#iboBytes) {
      this.#iboBytes = Math.max(iBytes, this.#iboBytes * 2, 65536);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.#iboBytes, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, indices, 0, indexCount);
    gl.useProgram(this.#program);
    gl.viewport(0, 0, this.#width, this.#height);
    gl.uniform4f(this.#xf, p[0] as number, p[1] as number, p[2] as number, p[3] as number);
    gl.uniform4f(this.#col, p[4] as number, p[5] as number, p[6] as number, 1);
    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  /**
   * Draws the predicted tail: the points `xy` (`count` pairs, CSS pixels), with a round end. `p` holds the width, the
   * canvas's size in CSS pixels, the colour and the share of it to draw (`width, cssW, cssH, r, g, b, alpha`). The strip has
   * no overlaps, so the half strength is even along it.
   */
  drawTail(xy: Float32Array, count: number, p: Float64Array): void {
    if (count < 2) return;
    const width = p[0] as number;
    const cssW = p[1] as number;
    const cssH = p[2] as number;
    const alpha = p[6] as number;
    const need = 2 * 3 * (2 * count + CAP_STEPS);
    if (need > this.#tail.length) this.#tail = new Float32Array(Math.max(need, this.#tail.length * 2));
    const out = this.#tail;
    const h = width / 2;
    let n = 0;
    // the sides of the strip at each point: the point moved along the normal of the line through its neighbours
    let lx = 0;
    let ly = 0;
    let rx = 0;
    let ry = 0;
    let tx = 0;
    let ty = 0;
    for (let i = 0; i < count; i++) {
      const a = i === 0 ? 0 : i - 1;
      const c = i === count - 1 ? count - 1 : i + 1;
      let dx = (xy[c * 2] as number) - (xy[a * 2] as number);
      let dy = (xy[c * 2 + 1] as number) - (xy[a * 2 + 1] as number);
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        dx /= len;
        dy /= len;
      } else {
        dx = tx;
        dy = ty;
      }
      tx = dx;
      ty = dy;
      const x = xy[i * 2] as number;
      const y = xy[i * 2 + 1] as number;
      const nlx = x - dy * h;
      const nly = y + dx * h;
      const nrx = x + dy * h;
      const nry = y - dx * h;
      if (i > 0) {
        out[n++] = lx;
        out[n++] = ly;
        out[n++] = rx;
        out[n++] = ry;
        out[n++] = nlx;
        out[n++] = nly;
        out[n++] = rx;
        out[n++] = ry;
        out[n++] = nrx;
        out[n++] = nry;
        out[n++] = nlx;
        out[n++] = nly;
      }
      lx = nlx;
      ly = nly;
      rx = nrx;
      ry = nry;
    }
    // the round end: a fan from the last point over the half circle in front of the line
    const ex = xy[(count - 1) * 2] as number;
    const ey = xy[(count - 1) * 2 + 1] as number;
    const base = Math.atan2(tx, -ty);
    let px = lx;
    let py = ly;
    for (let s = 1; s <= CAP_STEPS; s++) {
      const angle = base - (Math.PI * s) / CAP_STEPS;
      const nx = ex + Math.cos(angle) * h;
      const ny = ey + Math.sin(angle) * h;
      out[n++] = ex;
      out[n++] = ey;
      out[n++] = px;
      out[n++] = py;
      out[n++] = nx;
      out[n++] = ny;
      px = nx;
      py = ny;
    }
    const gl = this.#gl;
    gl.bindVertexArray(this.#tailVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#tailVbo);
    if (n * 4 > this.#tailBytes) {
      this.#tailBytes = Math.max(n * 4, this.#tailBytes * 2, 4096);
      gl.bufferData(gl.ARRAY_BUFFER, this.#tailBytes, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, out, 0, n);
    gl.useProgram(this.#program);
    gl.viewport(0, 0, this.#width, this.#height);
    gl.uniform4f(this.#xf, 2 / cssW, -2 / cssH, -1, 1);
    gl.uniform4f(this.#col, (p[3] as number) * alpha, (p[4] as number) * alpha, (p[5] as number) * alpha, alpha);
    gl.drawArrays(gl.TRIANGLES, 0, n / 2);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    try {
      this.#gl.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      // the context may be gone already
    }
  }
}
