/**
 * The WebGL 2 painter for smoke and fire in space (physics design 9.8, 12.1): each grid is a 3D texture of two bytes a cell
 * (`T / heat` and the smoke density), uploaded each frame with one `texSubImage3D`; one full-screen draw per grid marches a
 * ray through its box, 48 steps from where it enters to where it leaves or meets a solid, front to back: flame is the
 * black-body ramp of the plane (physics design 9.7) times its cover, smoke absorbs `0.85 s`. The solids' depth comes from a
 * depth texture this painter fills itself (the screen's depth buffer cannot be read), from the same triangles the software
 * painter's solids are. The output is premultiplied, composited as the sheets are.
 *
 * `packVolume` and `invert4` are pure and run in Node.
 */
import type { Result } from '@incantly/kernel';
import { okResult, viewError } from '../errors';
import type { GlBackend3, GlProg } from './mesh-painter3';
import type { GlFrame3, GlVolume3 } from './sheet3';

/** Steps of the march (design 12.1). */
export const VOLUME_STEPS = 48;

/** Two bytes a cell: red `T / heat` (0 to 1), green the smoke (0 to 1), x fastest. Written into `out`, which holds `2 n³` bytes. */
export function packVolume(v: GlVolume3, out: Uint8Array): void {
  const N = v.n * v.n * v.n;
  const s = v.density;
  const t = v.temp;
  const inv = v.heat > 0 ? 1 / v.heat : 0;
  for (let c = 0; c < N; c++) {
    const d = s[c] as number;
    out[2 * c + 1] = d > 1 ? 255 : d > 0 ? Math.round(d * 255) : 0;
    if (t) {
      const x = (t[c] as number) * inv;
      out[2 * c] = x > 1 ? 255 : x > 0 ? Math.round(x * 255) : 0;
    } else out[2 * c] = 0;
  }
}

/** The inverse of a column-major 4 × 4 matrix, into `out`; false when it has none. */
export function invert4(m: ArrayLike<number>, out: Float32Array): boolean {
  const a = (i: number): number => m[i] ?? 0;
  const a00 = a(0), a01 = a(1), a02 = a(2), a03 = a(3);
  const a10 = a(4), a11 = a(5), a12 = a(6), a13 = a(7);
  const a20 = a(8), a21 = a(9), a22 = a(10), a23 = a(11);
  const a30 = a(12), a31 = a(13), a32 = a(14), a33 = a(15);
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!(Math.abs(det) > 1e-30)) return false;
  const id = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * id;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * id;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * id;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * id;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * id;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * id;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * id;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * id;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * id;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * id;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * id;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * id;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * id;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * id;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * id;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * id;
  return true;
}

/** The ramp of `fireColor` (sdk `screen/physics.ts`: rows of °C, red, green, blue and cover), as GLSL. */
const FIRE_RAMP_GLSL = [
  'vec4 fireRamp(float t) {',
  ' if (t <= 400.0) return vec4(0.0);',
  ' vec4 a; vec4 b; float u;',
  ' if (t < 500.0) { a = vec4(130.0, 20.0, 0.0, 0.0); b = vec4(130.0, 20.0, 0.0, 0.35); u = (t - 400.0) / 100.0; }',
  ' else if (t < 800.0) { a = vec4(130.0, 20.0, 0.0, 0.35); b = vec4(230.0, 80.0, 0.0, 0.7); u = (t - 500.0) / 300.0; }',
  ' else if (t < 1100.0) { a = vec4(230.0, 80.0, 0.0, 0.7); b = vec4(255.0, 160.0, 30.0, 0.85); u = (t - 800.0) / 300.0; }',
  ' else if (t < 1500.0) { a = vec4(255.0, 160.0, 30.0, 0.85); b = vec4(255.0, 240.0, 180.0, 0.95); u = (t - 1100.0) / 400.0; }',
  ' else return vec4(1.0, 240.0 / 255.0, 180.0 / 255.0, 0.95);',
  ' vec4 c = mix(a, b, u);',
  ' return vec4(c.rgb / 255.0, c.a);',
  '}',
].join('\n');

/** One triangle over the whole screen; the fragment shader finds each pixel's ray through the box. */
export const VOLUME_SRC = {
  vertex: [
    '#version 300 es',
    'precision highp float;',
    'void main(){',
    ' vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));',
    ' gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);',
    '}',
  ].join('\n'),
  fragment: [
    '#version 300 es',
    'precision highp float;',
    'precision highp sampler3D;',
    'precision highp sampler2D;',
    'uniform mat4 uInvVp;',
    'uniform vec3 uMin; uniform vec3 uMax;',
    'uniform sampler3D uVol; uniform sampler2D uDepth;',
    'uniform vec2 uOrigin; uniform vec2 uSize;',
    'uniform float uHeat; uniform float uFire; uniform vec3 uSmoke; uniform float uCell;',
    'uniform vec4 uClipMin; uniform vec3 uClipMax;',
    'out vec4 oCol;',
    FIRE_RAMP_GLSL,
    'void main(){',
    ' vec2 px = gl_FragCoord.xy - uOrigin;',
    ' vec2 ndc = px / uSize * 2.0 - 1.0;',
    ' vec4 a = uInvVp * vec4(ndc, -1.0, 1.0);',
    ' vec4 b = uInvVp * vec4(ndc, 1.0, 1.0);',
    ' vec3 ro = a.xyz / a.w;',
    ' vec3 rd = b.xyz / b.w - ro;',
    ' rd = mix(rd, vec3(1e-9), vec3(equal(rd, vec3(0.0))));',
    ' vec3 lo = uMin; vec3 hi = uMax;',
    ' if (uClipMin.w > 0.5) { lo = max(lo, uClipMin.xyz); hi = min(hi, uClipMax); }',
    ' vec3 inv = 1.0 / rd;',
    ' vec3 t0 = (lo - ro) * inv; vec3 t1 = (hi - ro) * inv;',
    ' vec3 tmin = min(t0, t1); vec3 tmax = max(t0, t1);',
    ' float tn = max(max(tmin.x, tmin.y), max(tmin.z, 0.0));',
    ' float tf = min(min(tmax.x, tmax.y), min(tmax.z, 1.0));',
    // a solid ends the ray where its depth is
    ' float d = texelFetch(uDepth, ivec2(px), 0).r;',
    ' if (d < 1.0) {',
    '  vec4 p = uInvVp * vec4(ndc, d * 2.0 - 1.0, 1.0);',
    '  tf = min(tf, dot(p.xyz / p.w - ro, rd) / dot(rd, rd));',
    ' }',
    ' if (!(tf > tn)) discard;',
    ' float len = length(rd) * (tf - tn) / float(' + VOLUME_STEPS + ');',
    // the first sample is moved a little by a fixed pattern of the pixel, so the steps do not make bands
    ' float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));',
    ' vec3 col = vec3(0.0); float alpha = 0.0;',
    ' for (int i = 0; i < ' + VOLUME_STEPS + '; i++) {',
    '  float t = tn + (tf - tn) * (float(i) + jit) / float(' + VOLUME_STEPS + ');',
    '  vec3 p = ro + rd * t;',
    '  vec2 s = texture(uVol, (p - uMin) / (uMax - uMin)).rg;',
    '  vec4 f = uFire > 0.5 ? fireRamp(s.r * uHeat) : vec4(0.0);',
    '  float sm = min(s.g, 1.0);',
    '  float fa = f.a * (1.0 - 0.4 * sm);',
    '  float sa = 0.85 * sm;',
    // the covers are for one cell; a step is `len / uCell` of one
    '  float k = len / uCell;',
    '  float fs = 1.0 - pow(1.0 - fa, k);',
    '  float ss = 1.0 - pow(1.0 - sa, k);',
    '  vec3 c = f.rgb * fs * (1.0 - ss) + uSmoke * ss;',
    '  float sA = fs + ss - fs * ss;',
    '  col += (1.0 - alpha) * c;',
    '  alpha += (1.0 - alpha) * sA;',
    '  if (alpha > 0.98) break;',
    ' }',
    ' oCol = vec4(col, alpha);',
    '}',
  ].join('\n'),
};

const UNIFORMS = ['uInvVp', 'uMin', 'uMax', 'uVol', 'uDepth', 'uOrigin', 'uSize', 'uHeat', 'uFire', 'uSmoke', 'uCell', 'uClipMin', 'uClipMax'] as const;

interface VolRes {
  readonly tex: WebGLTexture;
  readonly n: number;
  readonly gen: number;
  seen: number;
}

/** What the painter of sheets and drops hands over for a frame's volumes. */
export interface VolumeTarget {
  readonly wd: number;
  readonly hd: number;
  /** The canvas's height in device pixels: the picture is the top-left `wd × hd` of it. */
  readonly H: number;
  readonly vp: Float32Array;
  readonly depth: GlProg;
  readonly frameNo: number;
  readonly gen: number;
}

/** The painter of smoke and fire in space; made once with the sheets' painter, on its context. */
export class VolumePainter3 {
  private prog: GlProg | undefined;
  private readonly vols = new Map<number, VolRes>();
  private bytes = new Uint8Array(0);
  private fbo: WebGLFramebuffer | null = null;
  private depthTex: WebGLTexture | null = null;
  private fw = 0;
  private fh = 0;
  private occBuf: WebGLBuffer | null = null;
  private occVao: WebGLVertexArrayObject | null = null;
  private occCap = 0;
  private emptyVao: WebGLVertexArrayObject | null = null;
  private gen = -1;
  private readonly inv = new Float32Array(16);

  constructor(private readonly backend: GlBackend3) {}

  /** Everything made on a context that was lost is gone: start again on the new one. */
  private renew(gen: number): void {
    if (this.gen === gen) return;
    this.gen = gen;
    this.prog = undefined;
    this.vols.clear();
    this.fbo = null;
    this.depthTex = null;
    this.fw = 0;
    this.fh = 0;
    this.occBuf = null;
    this.occVao = null;
    this.occCap = 0;
    this.emptyVao = null;
  }

  /** The 3D textures kept (for tests). */
  kept(): number {
    return this.vols.size;
  }

  paint(f: GlFrame3, t: VolumeTarget): Result<undefined> {
    const vols = f.volumes ?? [];
    if (vols.length === 0) return okResult(undefined);
    const b = this.backend;
    const gl = b.gl;
    this.renew(t.gen);
    if (!this.prog) {
      const p = b.compile(VOLUME_SRC, UNIFORMS);
      if (!p.ok) return p;
      this.prog = p.value;
    }
    const P = this.prog;
    if (!invert4(t.vp, this.inv)) return okResult(undefined);
    // 1. the depth that ends a ray: solids and cloth, into a depth texture of the picture's size
    if (!this.depthPass(f, t)) return viewError({ kind: 'internal', messageKey: 'view.internal', params: { where: 'WebGL 2 volume depth' }, token: 'webgl_draw' });
    // 2. one full-screen draw a volume, over what the sheets and drops drew
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, t.H - t.hd, t.wd, t.hd);
    gl.useProgram(P.program);
    gl.uniformMatrix4fv(P.u['uInvVp'] ?? null, false, this.inv);
    gl.uniform2f(P.u['uOrigin'] ?? null, 0, t.H - t.hd);
    gl.uniform2f(P.u['uSize'] ?? null, t.wd, t.hd);
    gl.uniform1i(P.u['uVol'] ?? null, 1);
    gl.uniform1i(P.u['uDepth'] ?? null, 2);
    const cmin = f.clip?.min ?? { x: 0, y: 0, z: 0 };
    const cmax = f.clip?.max ?? { x: 0, y: 0, z: 0 };
    gl.uniform4f(P.u['uClipMin'] ?? null, cmin.x, cmin.y, cmin.z, f.clip ? 1 : 0);
    gl.uniform3f(P.u['uClipMax'] ?? null, cmax.x, cmax.y, cmax.z);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (!this.emptyVao) this.emptyVao = gl.createVertexArray();
    gl.bindVertexArray(this.emptyVao);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (const v of vols) {
      const res = this.volRes(v, t);
      if (!res) continue;
      const N = v.n * v.n * v.n;
      if (this.bytes.length < 2 * N) this.bytes = new Uint8Array(2 * N);
      packVolume(v, this.bytes);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, res.tex);
      gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, v.n, v.n, v.n, gl.RG, gl.UNSIGNED_BYTE, this.bytes, 0);
      gl.uniform3f(P.u['uMin'] ?? null, v.min.x, v.min.y, v.min.z);
      gl.uniform3f(P.u['uMax'] ?? null, v.max.x, v.max.y, v.max.z);
      gl.uniform1f(P.u['uHeat'] ?? null, v.heat);
      gl.uniform1f(P.u['uFire'] ?? null, v.temp ? 1 : 0);
      gl.uniform3f(P.u['uSmoke'] ?? null, v.smoke[0], v.smoke[1], v.smoke[2]);
      // the mean edge of a cell: the covers of the plane's ramp are for one cell
      gl.uniform1f(P.u['uCell'] ?? null, Math.max(1e-6, ((v.max.x - v.min.x) + (v.max.y - v.min.y) + (v.max.z - v.min.z)) / (3 * v.n)));
      this.scissorTo(f, t, v);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.activeTexture(gl.TEXTURE0);
    gl.depthMask(true);
    gl.bindVertexArray(null);
    this.sweep(t.frameNo);
    return okResult(undefined);
  }

  /** Only the pixels the box can cover are run: the box's corners projected, or the whole picture when the eye is inside it. */
  private scissorTo(f: GlFrame3, t: VolumeTarget, v: GlVolume3): void {
    const gl = this.backend.gl;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const m = t.vp;
    for (let c = 0; c < 8; c++) {
      const x = c & 1 ? v.max.x : v.min.x;
      const y = c & 2 ? v.max.y : v.min.y;
      const z = c & 4 ? v.max.z : v.min.z;
      const w = (m[3] ?? 0) * x + (m[7] ?? 0) * y + (m[11] ?? 0) * z + (m[15] ?? 0);
      if (!(w > 1e-9)) {
        gl.disable(gl.SCISSOR_TEST);
        return;
      }
      const px = (((m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0)) / w * 0.5 + 0.5) * t.wd;
      const py = (((m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0)) / w * 0.5 + 0.5) * t.hd;
      x0 = Math.min(x0, px);
      x1 = Math.max(x1, px);
      y0 = Math.min(y0, py);
      y1 = Math.max(y1, py);
    }
    void f;
    const sx = Math.max(0, Math.floor(x0) - 1);
    const sy = Math.max(0, Math.floor(y0) - 1);
    const ex = Math.min(t.wd, Math.ceil(x1) + 1);
    const ey = Math.min(t.hd, Math.ceil(y1) + 1);
    if (!(ex > sx && ey > sy)) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, t.H - t.hd, 0, 0);
      return;
    }
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(sx, t.H - t.hd + sy, ex - sx, ey - sy);
  }

  /** Fills the depth texture with the solids and the cloth; false when the framebuffer cannot be made. */
  private depthPass(f: GlFrame3, t: VolumeTarget): boolean {
    const gl = this.backend.gl;
    if (!this.fbo || this.fw !== t.wd || this.fh !== t.hd) {
      if (this.fbo) gl.deleteFramebuffer(this.fbo);
      if (this.depthTex) gl.deleteTexture(this.depthTex);
      this.fbo = gl.createFramebuffer();
      this.depthTex = gl.createTexture();
      if (!this.fbo || !this.depthTex) return false;
      gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, t.wd, t.hd);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTex, 0);
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
      this.fw = t.wd;
      this.fh = t.hd;
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteFramebuffer(this.fbo);
        gl.deleteTexture(this.depthTex);
        this.fbo = null;
        this.depthTex = null;
        this.fw = 0;
        this.fh = 0;
        return false;
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, t.wd, t.hd);
    gl.disable(gl.SCISSOR_TEST);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    const verts = f.volumeOccluderVerts ?? 0;
    if (verts > 0 && f.volumeOccluders) {
      if (!this.occBuf) {
        this.occBuf = gl.createBuffer();
        this.occVao = gl.createVertexArray();
        gl.bindVertexArray(this.occVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.occBuf);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
      }
      gl.bindVertexArray(this.occVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.occBuf);
      const n = verts * 3;
      if (n > this.occCap) {
        this.occCap = Math.max(n, this.occCap * 2);
        gl.bufferData(gl.ARRAY_BUFFER, this.occCap * 4, gl.DYNAMIC_DRAW);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, f.volumeOccluders, 0, n);
      gl.useProgram(t.depth.program);
      gl.uniformMatrix4fv(t.depth.u['uVp'] ?? null, false, t.vp);
      gl.colorMask(false, false, false, false);
      gl.drawArrays(gl.TRIANGLES, 0, verts);
      gl.colorMask(true, true, true, true);
      gl.bindVertexArray(null);
    }
    gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  }

  /** The 3D texture of a volume, made again only when its size changes. */
  private volRes(v: GlVolume3, t: VolumeTarget): VolRes | undefined {
    const gl = this.backend.gl;
    const n = Math.floor(v.n);
    if (!(n >= 2) || v.density.length < n * n * n || (v.temp && v.temp.length < n * n * n)) return undefined;
    const old = this.vols.get(v.key);
    if (old && old.n === n && old.gen === t.gen) {
      old.seen = t.frameNo;
      return old;
    }
    if (old) this.free(v.key, old);
    const tex = gl.createTexture();
    if (!tex) return undefined;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texStorage3D(gl.TEXTURE_3D, 1, gl.RG8, n, n, n);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    const res: VolRes = { tex, n, gen: t.gen, seen: t.frameNo };
    this.vols.set(v.key, res);
    return res;
  }

  private free(key: number, r: VolRes): void {
    const gl = this.backend.gl;
    if (r.gen === this.gen && !gl.isContextLost()) gl.deleteTexture(r.tex);
    this.vols.delete(key);
  }

  /** A volume unseen for 240 frames gives its texture back. */
  private sweep(frameNo: number): void {
    for (const [k, r] of this.vols) if (frameNo - r.seen > 240) this.free(k, r);
  }

  dispose(): void {
    for (const [k, r] of [...this.vols]) this.free(k, r);
    const gl = this.backend.gl;
    if (!gl.isContextLost()) {
      if (this.fbo) gl.deleteFramebuffer(this.fbo);
      if (this.depthTex) gl.deleteTexture(this.depthTex);
      if (this.occBuf) gl.deleteBuffer(this.occBuf);
      if (this.occVao) gl.deleteVertexArray(this.occVao);
      if (this.emptyVao) gl.deleteVertexArray(this.emptyVao);
      if (this.prog) gl.deleteProgram(this.prog.program);
    }
  }
}
