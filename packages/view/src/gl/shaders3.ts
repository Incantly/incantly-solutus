/**
 * The shaders of the Space view's WebGL 2 painter (physics design 12.1, space-3d design 9.1): lit sheets whose points
 * come from a float texture each frame (normals from the four neighbours, in the vertex shader), drops as one instanced
 * batch of lit discs, and a depth-only pass for the solids the software painter draws. GLSL ES 3.00, one source each.
 *
 * The light is the software painter's (`paint3.ts`): a key and a fill fixed to the camera, shade
 * `k (0.45 + 0.55 key + 0.18 fill)`, and the back of a face shaded as its other side with k = 0.85.
 */

export interface GlProgramSrc {
  readonly vertex: string;
  readonly fragment: string;
}

/** The key and fill lights in camera space, as `paint3.ts` has them (normalised there). */
const LIGHTS = [
  'const vec3 KEY = normalize(vec3(-0.4, 0.6, 0.7));',
  'const vec3 FILL = normalize(vec3(0.45, -0.35, 0.6));',
  // uLight: 0 lit, 1 flat, 2 off (the `space with light` values)
  'float shadeOf(vec3 c, float uLight) {',
  ' if (uLight > 1.5) return 0.8;',
  ' if (uLight > 0.5) return 1.0;',
  ' float k = 1.0;',
  ' if (c.z < 0.0) { c = -c; k = 0.85; }',
  ' return k * (0.45 + 0.55 * max(dot(c, KEY), 0.0) + 0.18 * max(dot(c, FILL), 0.0));',
  '}',
].join('\n');

/** Points of a sheet: texel (i, j) holds point i + j nx. The triangles come from a fixed index buffer. */
export const SHEET_SRC: GlProgramSrc = {
  vertex: [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    'uniform highp sampler2D uPos;',
    'uniform ivec2 uSize;',
    'uniform mat4 uVp;',
    'out vec3 vWorld; out vec3 vNor; out vec2 vGrid;',
    'vec3 at(int i, int j) { return texelFetch(uPos, ivec2(clamp(i, 0, uSize.x - 1), clamp(j, 0, uSize.y - 1)), 0).xyz; }',
    'void main(){',
    ' int i = gl_VertexID % uSize.x;',
    ' int j = gl_VertexID / uSize.x;',
    ' vec3 p = at(i, j);',
    ' vec3 du = at(i + 1, j) - at(i - 1, j);',
    ' vec3 dv = at(i, j + 1) - at(i, j - 1);',
    ' vNor = cross(du, dv);',
    ' vWorld = p;',
    ' vGrid = vec2(float(i), float(j));',
    ' gl_Position = uVp * vec4(p, 1.0);',
    '}',
  ].join('\n'),
  fragment: [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vWorld; in vec3 vNor; in vec2 vGrid;',
    'uniform mat3 uRot;',
    'uniform vec3 uColor; uniform float uAlpha; uniform float uLight; uniform float uThreads;',
    'uniform vec4 uClipMin; uniform vec3 uClipMax;',
    'out vec4 oCol;',
    LIGHTS,
    'void main(){',
    ' if (uClipMin.w > 0.5 && (any(lessThan(vWorld, uClipMin.xyz)) || any(greaterThan(vWorld, uClipMax)))) discard;',
    ' float l = length(vNor);',
    ' vec3 n = l > 1e-12 ? vNor / l : vec3(0.0, 0.0, 1.0);',
    ' vec3 col = min(uColor * shadeOf(uRot * n, uLight), vec3(1.0));',
    ' if (uThreads > 0.5) {',
    // a faint thread every k points along each way, a pixel wide whatever the zoom
    '  vec2 g = vGrid / uThreads;',
    '  vec2 w = max(fwidth(g), vec2(1e-6));',
    '  vec2 d = abs(fract(g + 0.5) - 0.5) / w;',
    '  float line = 1.0 - min(min(d.x, d.y), 1.0);',
    '  col = mix(col, col * 0.55, 0.6 * line);',
    ' }',
    ' oCol = vec4(col * uAlpha, uAlpha);',
    '}',
  ].join('\n'),
};

/** Drops: a corner of the unit quad per vertex, a drop centre per instance; a lit disc facing the camera. */
export const DISC_SRC: GlProgramSrc = {
  vertex: [
    '#version 300 es',
    'precision highp float;',
    'layout(location=0) in vec2 aCorner;',
    'layout(location=1) in vec3 aCentre;',
    'uniform mat4 uVp; uniform vec3 uRight; uniform vec3 uUp; uniform float uRadius;',
    'uniform vec4 uClipMin; uniform vec3 uClipMax;',
    'out vec2 vD;',
    'void main(){',
    ' vD = aCorner;',
    ' bool out_ = uClipMin.w > 0.5 && (any(lessThan(aCentre, uClipMin.xyz)) || any(greaterThan(aCentre, uClipMax)));',
    ' vec3 p = aCentre + (uRight * aCorner.x + uUp * aCorner.y) * uRadius;',
    // a drop outside the clip box goes behind the far plane, so nothing of it is drawn
    ' gl_Position = out_ ? vec4(0.0, 0.0, 2.0, 1.0) : uVp * vec4(p, 1.0);',
    '}',
  ].join('\n'),
  fragment: [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vD;',
    'uniform vec3 uColor; uniform float uAlpha; uniform float uLight;',
    'out vec4 oCol;',
    LIGHTS,
    'void main(){',
    ' float r2 = dot(vD, vD);',
    ' if (r2 > 1.0) discard;',
    ' vec3 n = vec3(vD, sqrt(1.0 - r2));',
    ' vec3 col = min(uColor * shadeOf(n, uLight), vec3(1.0));',
    ' oCol = vec4(col * uAlpha, uAlpha);',
    '}',
  ].join('\n'),
};

/** The solids of the software painter, into the depth buffer only, so sheets and drops behind them are hidden. */
export const DEPTH_SRC: GlProgramSrc = {
  vertex: [
    '#version 300 es',
    'precision highp float;',
    'layout(location=0) in vec3 aPos;',
    'uniform mat4 uVp;',
    'void main(){ gl_Position = uVp * vec4(aPos, 1.0); }',
  ].join('\n'),
  fragment: [
    '#version 300 es',
    'precision highp float;',
    'out vec4 oCol;',
    'void main(){ oCol = vec4(0.0); }',
  ].join('\n'),
};
