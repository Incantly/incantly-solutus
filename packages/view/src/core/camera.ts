/**
 * 3D camera maths (space-3d design 8.1-8.5): quaternion orientation, the three
 * projections, near/far fitting, pointer rays, frustum tests, floating origin.
 * Pure Float64 maths; no DOM, so it runs in Node, a worker and on mobile.
 */

export interface V3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
export const v3Add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const v3Sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const v3Scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const v3Dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const v3Cross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const v3Len = (a: V3): number => Math.hypot(a.x, a.y, a.z);
export function v3Norm(a: V3): V3 {
  const l = v3Len(a);
  return l > 0 ? v3Scale(a, 1 / l) : { x: 0, y: 0, z: 0 };
}

/** Quaternion w + xi + yj + zk. */
export interface Quat {
  readonly w: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const Q_IDENTITY: Quat = { w: 1, x: 0, y: 0, z: 0 };

export function quatFromAxisAngle(axis: V3, angleRad: number): Quat {
  const n = v3Norm(axis);
  const s = Math.sin(angleRad / 2);
  return { w: Math.cos(angleRad / 2), x: n.x * s, y: n.y * s, z: n.z * s };
}

/** Hamilton product a * b (apply b first, then a). */
export function quatMul(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

export function quatConj(q: Quat): Quat {
  return { w: q.w, x: -q.x, y: -q.y, z: -q.z };
}

export function quatRotate(q: Quat, p: V3): V3 {
  const u = { x: q.x, y: q.y, z: q.z };
  const t = v3Scale(v3Cross(u, p), 2);
  const c = v3Cross(u, t);
  return {
    x: p.x + q.w * t.x + c.x,
    y: p.y + q.w * t.y + c.y,
    z: p.z + q.w * t.z + c.z,
  };
}

/** Column-major 4x4, the layout WebGL uniforms take. */
export type Mat4 = Float64Array;

export function mat4Identity(): Mat4 {
  return new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

/** out = a * b (column-major). */
export function mat4Mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += (a[k * 4 + r] ?? 0) * (b[c * 4 + k] ?? 0);
      out[c * 4 + r] = s;
    }
  }
  return out;
}

export type ProjectionKind = 'ortho' | 'persp' | 'oblique';

/** The camera-relevant subset of the `space` object's properties (design 8.1). */
export interface SpaceCameraProps {
  readonly azimuth: number;
  readonly elevation: number;
  readonly roll: number;
  readonly target: V3;
  readonly zoom: number;
  readonly projection: ProjectionKind;
  readonly fov: number;
  readonly obliqueAngle: number;
  readonly obliqueFactor: number;
  readonly zUp: boolean;
  readonly aspect: V3;
}

export const DEFAULT_SPACE_CAMERA: SpaceCameraProps = {
  azimuth: (-40 * Math.PI) / 180,
  elevation: (22 * Math.PI) / 180,
  roll: 0,
  target: { x: 0, y: 0, z: 0 },
  zoom: 1,
  projection: 'ortho',
  fov: (40 * Math.PI) / 180,
  obliqueAngle: (30 * Math.PI) / 180,
  obliqueFactor: 0.5,
  zUp: true,
  aspect: { x: 1, y: 1, z: 1 },
};

export interface CameraViewport {
  readonly w: number;
  readonly h: number;
  readonly dpr: number;
}

export interface Camera {
  readonly q: Quat;
  readonly target: V3;
  readonly dist: number;
  /** Pixels per world unit at the target. */
  readonly scale: number;
  readonly projection: ProjectionKind;
  readonly fovY: number;
  readonly shear: { readonly kx: number; readonly kz: number };
  readonly aspectAxes: V3;
  readonly viewport: CameraViewport;
  readonly near: number;
  readonly far: number;
  readonly eye: V3;
  readonly forward: V3;
  readonly right: V3;
  readonly up: V3;
  readonly view: Mat4;
  readonly proj: Mat4;
  readonly vp: Mat4;
}

const DEG = Math.PI / 180;

export type ViewPresetName = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'isometric';

/** Exact azimuth/elevation per preset (design 8.3). */
export function viewPreset(name: ViewPresetName): { azimuth: number; elevation: number } {
  switch (name) {
    case 'front': return { azimuth: 0, elevation: 0 };
    case 'back': return { azimuth: 180 * DEG, elevation: 0 };
    case 'left': return { azimuth: -90 * DEG, elevation: 0 };
    case 'right': return { azimuth: 90 * DEG, elevation: 0 };
    case 'top': return { azimuth: 0, elevation: 90 * DEG };
    case 'bottom': return { azimuth: 0, elevation: -90 * DEG };
    case 'isometric': return { azimuth: 45 * DEG, elevation: Math.asin(1 / Math.sqrt(3)) };
  }
}

function worldUp(zUp: boolean): V3 {
  return zUp ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
}

/**
 * Orientation from azimuth/elevation/roll by composing quaternions.
 * Azimuth 0 looks along +y; elevation is the tilt above the floor.
 */
export function orientationFromAzEl(azimuth: number, elevation: number, roll: number, zUp: boolean, upHint?: V3): Quat {
  const up = worldUp(zUp);
  // Camera offset direction from the target (unit), in world axes.
  const ce = Math.cos(elevation);
  const off = zUp
    ? v3Norm({ x: ce * Math.sin(azimuth), y: ce * Math.cos(azimuth), z: Math.sin(elevation) })
    : v3Norm({ x: ce * Math.sin(azimuth), y: Math.sin(elevation), z: ce * Math.cos(azimuth) });
  const forward = v3Scale(off, -1);
  // Stable screen-up: continue the previous up near the poles (design 8.1).
  let upRef = upHint ?? up;
  if (Math.abs(v3Dot(forward, upRef)) > 0.999) {
    upRef = Math.abs(forward.y) < 0.999 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  }
  const right = v3Norm(v3Cross(forward, upRef));
  const camUp = v3Cross(right, forward);
  // World-to-camera rotation rows are right, camUp, -forward; build it as a
  // quaternion from the rotation matrix (Branchless, stable).
  const r00 = right.x;
  const r01 = right.y;
  const r02 = right.z;
  const r10 = camUp.x;
  const r11 = camUp.y;
  const r12 = camUp.z;
  const r20 = -forward.x;
  const r21 = -forward.y;
  const r22 = -forward.z;
  const trace = r00 + r11 + r22;
  let q: Quat;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = { w: s / 4, x: (r21 - r12) / s, y: (r02 - r20) / s, z: (r10 - r01) / s };
  } else if (r00 > r11 && r00 > r22) {
    const s = Math.sqrt(1 + r00 - r11 - r22) * 2;
    q = { w: (r21 - r12) / s, x: s / 4, y: (r01 + r10) / s, z: (r02 + r20) / s };
  } else if (r11 > r22) {
    const s = Math.sqrt(1 + r11 - r00 - r22) * 2;
    q = { w: (r02 - r20) / s, x: (r01 + r10) / s, y: s / 4, z: (r12 + r21) / s };
  } else {
    const s = Math.sqrt(1 + r22 - r00 - r11) * 2;
    q = { w: (r10 - r01) / s, x: (r02 + r20) / s, y: (r12 + r21) / s, z: s / 4 };
  }
  if (roll !== 0) q = quatMul(quatFromAxisAngle({ x: 0, y: 0, z: 1 }, -roll), q);
  return q;
}

/**
 * Interactive rotation: horizontal drags orbit about the screen's vertical
 * axis, vertical drags about the screen's horizontal axis (design 8.2).
 * Sensitivity default 0.4 deg per CSS px (design 10.4).
 */
export function userRotate(q: Quat, dxPx: number, dyPx: number, degPerPx = 0.4): Quat {
  const yaw = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, (-dxPx * degPerPx * Math.PI) / 180);
  const pitch = quatFromAxisAngle({ x: 1, y: 0, z: 0 }, (-dyPx * degPerPx * Math.PI) / 180);
  return quatMul(quatMul(yaw, pitch), q);
}

/** Read azimuth/elevation back from an orientation, for the saved file. */
export function readAzEl(q: Quat, zUp: boolean): { azimuth: number; elevation: number } {
  // Camera forward in world = q^-1 * (0,0,-1); offset = -forward.
  const fwd = quatRotate(quatConj(q), { x: 0, y: 0, z: -1 });
  const off = v3Scale(fwd, -1);
  if (zUp) {
    const elevation = Math.asin(Math.min(1, Math.max(-1, off.z)));
    const azimuth = Math.atan2(off.x, off.y);
    return { azimuth, elevation };
  }
  const elevation = Math.asin(Math.min(1, Math.max(-1, off.y)));
  const azimuth = Math.atan2(off.x, off.z);
  return { azimuth, elevation };
}

/** Fit near/far to the visible bounding sphere every frame (design 8.2). */
export function fitNearFar(dist: number, radius: number, margin = 1.5): { near: number; far: number } {
  const r = Math.max(radius, 1e-9);
  const d = Math.max(dist, 1e-9);
  const near = Math.max(d - r * margin, d * 1e-4, 1e-9);
  const far = d + r * margin;
  return { near, far };
}

/** Zoom dollies the eye along the view axis (design 8.3), never the fov. */
export function distForZoom(fitDist: number, zoom: number): number {
  return fitDist / Math.max(zoom, 1e-6);
}

function viewMatrixFromPose(q: Quat, eye: V3): Mat4 {
  // Rotation part from the quaternion (world -> camera).
  const { w, x, y, z } = q;
  const m = mat4Identity();
  m[0] = 1 - 2 * (y * y + z * z);
  m[1] = 2 * (x * y + z * w);
  m[2] = 2 * (x * z - y * w);
  m[4] = 2 * (x * y - z * w);
  m[5] = 1 - 2 * (x * x + z * z);
  m[6] = 2 * (y * z + x * w);
  m[8] = 2 * (x * z + y * w);
  m[9] = 2 * (y * z - x * w);
  m[10] = 1 - 2 * (x * x + y * y);
  // Translation -R * eye.
  m[12] = -(m[0]! * eye.x + m[4]! * eye.y + m[8]! * eye.z);
  m[13] = -(m[1]! * eye.x + m[5]! * eye.y + m[9]! * eye.z);
  m[14] = -(m[2]! * eye.x + m[6]! * eye.y + m[10]! * eye.z);
  return m;
}

function orthoMatrix(left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 {
  const m = mat4Identity();
  m[0] = 2 / (right - left);
  m[5] = 2 / (top - bottom);
  m[10] = -2 / (far - near);
  m[12] = -(right + left) / (right - left);
  m[13] = -(top + bottom) / (top - bottom);
  m[14] = -(far + near) / (far - near);
  return m;
}

function perspMatrix(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float64Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

/** Oblique shear on top of an orthographic camera (design 8.3). */
function obliqueShearMatrix(kf: number, theta: number): Mat4 {
  const m = mat4Identity();
  // Camera looks down -z; depth d = -z_cam. x' = x + kf cos t d, y' = y + kf sin t d.
  m[8] = -kf * Math.cos(theta);
  m[9] = -kf * Math.sin(theta);
  return m;
}

export interface BuildCameraInput {
  readonly props: SpaceCameraProps;
  readonly viewport: CameraViewport;
  /** Eye distance at zoom 1, from the visible bounding sphere. */
  readonly fitDist: number;
  /** Radius of the visible bounding sphere, for near/far fitting. */
  readonly fitRadius: number;
  readonly upHint?: V3;
}

/** Derive the full camera state from the `space` properties each frame. */
export function buildCamera(input: BuildCameraInput): Camera {
  const { props, viewport } = input;
  const q = orientationFromAzEl(props.azimuth, props.elevation, props.roll, props.zUp, input.upHint);
  const dist = distForZoom(Math.max(input.fitDist, 1e-9), props.zoom);
  const qc = quatConj(q);
  const forward = quatRotate(qc, { x: 0, y: 0, z: -1 });
  const right = quatRotate(qc, { x: 1, y: 0, z: 0 });
  const up = quatRotate(qc, { x: 0, y: 1, z: 0 });
  const eye = v3Sub(props.target, v3Scale(forward, dist));
  const { near, far } = fitNearFar(dist, Math.max(input.fitRadius, 1e-9));
  const view = viewMatrixFromPose(q, eye);
  const aspect = viewport.w / Math.max(viewport.h, 1);
  let proj: Mat4;
  let scale: number;
  if (props.projection === 'persp') {
    proj = perspMatrix(props.fov, aspect, near, far);
    scale = viewport.h / 2 / Math.tan(props.fov / 2) / dist;
  } else {
    // Ortho scale: fit the bounding diameter into the smaller screen side.
    const fitDiameter = Math.max(input.fitRadius * 2, 1e-9);
    scale = (Math.min(viewport.w, viewport.h) / fitDiameter) * props.zoom;
    const hw = viewport.w / 2 / scale;
    const hh = viewport.h / 2 / scale;
    proj = orthoMatrix(-hw, hw, -hh, hh, near, far);
    if (props.projection === 'oblique') {
      proj = mat4Mul(proj, obliqueShearMatrix(props.obliqueFactor, props.obliqueAngle));
    }
  }
  return {
    q,
    target: props.target,
    dist,
    scale,
    projection: props.projection,
    fovY: props.fov,
    shear: { kx: -props.obliqueFactor * Math.cos(props.obliqueAngle), kz: -props.obliqueFactor * Math.sin(props.obliqueAngle) },
    aspectAxes: props.aspect,
    viewport,
    near,
    far,
    eye,
    forward,
    right,
    up,
    view,
    proj,
    vp: mat4Mul(proj, view),
  };
}

export interface Projected {
  readonly x: number;
  readonly y: number;
  readonly depth: number;
  /** True when the point is behind a perspective eye. */
  readonly behind: boolean;
}

/** World point to CSS pixels (y down) plus NDC depth. */
export function projectPoint(cam: Camera, p: V3): Projected {
  const m = cam.vp;
  const x = p.x;
  const y = p.y;
  const z = p.z;
  const cx = (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0);
  const cy = (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0);
  const cz = (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0);
  const cw = (m[3] ?? 0) * x + (m[7] ?? 0) * y + (m[11] ?? 0) * z + (m[15] ?? 0);
  if (cw <= 0) return { x: 0, y: 0, depth: 1, behind: true };
  const nx = cx / cw;
  const ny = cy / cw;
  return {
    x: ((nx + 1) / 2) * cam.viewport.w,
    y: ((1 - ny) / 2) * cam.viewport.h,
    depth: cz / cw,
    behind: false,
  };
}

export interface Ray {
  readonly o: V3;
  readonly d: V3;
}

/**
 * Pointer ray through a CSS pixel (design 9.4): orthographic rays run parallel
 * to the view direction; perspective rays leave the eye through the pixel.
 */
export function pointerRay(cam: Camera, pxX: number, pxY: number): Ray {
  const dx = pxX - cam.viewport.w / 2;
  const dy = cam.viewport.h / 2 - pxY;
  if (cam.projection === 'persp') {
    const f = cam.viewport.h / 2 / Math.tan(cam.fovY / 2);
    const d = v3Norm(v3Add(v3Add(v3Scale(cam.forward, f), v3Scale(cam.right, dx)), v3Scale(cam.up, dy)));
    return { o: cam.eye, d };
  }
  const o = v3Add(v3Add(cam.target, v3Scale(cam.right, dx / cam.scale)), v3Scale(cam.up, dy / cam.scale));
  // Pull the origin back along -forward so ray hits sort from the eye side.
  return { o: v3Sub(o, v3Scale(cam.forward, cam.dist)), d: cam.forward };
}

/** Sphere-vs-frustum test from the vp matrix, for culling (performance 5). */
export function frustumContainsSphere(vp: Mat4, c: V3, radius: number): boolean {
  // Six planes from rows of vp (Gribb/Hartmann extraction, column-major).
  for (let i = 0; i < 6; i++) {
    const s0 = i === 0 || i === 2 || i === 4 ? 1 : -1;
    const a = i < 2 ? 3 : i < 4 ? 3 : 3;
    const b = i < 2 ? 0 : i < 4 ? 1 : 2;
    const pa = (vp[a] ?? 0) + s0 * (vp[b] ?? 0);
    const pb = (vp[a + 4] ?? 0) + s0 * (vp[b + 4] ?? 0);
    const pc = (vp[a + 8] ?? 0) + s0 * (vp[b + 8] ?? 0);
    const pd = (vp[a + 12] ?? 0) + s0 * (vp[b + 12] ?? 0);
    const len = Math.hypot(pa, pb, pc);
    if (len <= 0) continue;
    if ((pa * c.x + pb * c.y + pc * c.z + pd) / len < -radius) return false;
  }
  return true;
}

/**
 * `ViewFacing` target (design 8.4): azimuth/elevation looking along the
 * negative normal, picking the nearer of the two normal directions.
 */
export function viewFacingAzEl(normal: V3, current: { azimuth: number; elevation: number }, zUp: boolean): { azimuth: number; elevation: number } {
  const n = v3Norm(normal);
  const curQ = orientationFromAzEl(current.azimuth, current.elevation, 0, zUp);
  const curFwd = quatRotate(quatConj(curQ), { x: 0, y: 0, z: -1 });
  // Camera forward should equal -n or +n; pick the shorter turn.
  const use = v3Dot(curFwd, v3Scale(n, -1)) >= v3Dot(curFwd, n) ? v3Scale(n, -1) : n;
  const off = v3Scale(use, -1);
  if (zUp) {
    return { azimuth: Math.atan2(off.x, off.y), elevation: Math.asin(Math.min(1, Math.max(-1, off.z))) };
  }
  return { azimuth: Math.atan2(off.x, off.z), elevation: Math.asin(Math.min(1, Math.max(-1, off.y))) };
}

/** Axis-aligned clip-box test used by meshing and the shader discard (8.7). */
export function pointInClipBox(p: V3, clipMin: V3, clipMax: V3): boolean {
  return (
    p.x >= clipMin.x && p.x <= clipMax.x &&
    p.y >= clipMin.y && p.y <= clipMax.y &&
    p.z >= clipMin.z && p.z <= clipMax.z
  );
}

/**
 * Floating origin (design 8.2, 9.2): store chunk positions relative to a
 * chunk origin so far-from-origin scenes do not jitter on the GPU.
 */
export function relativize(pos: ArrayLike<number>, origin: V3): { rel: Float32Array; origin: V3 } {
  const rel = new Float32Array(pos.length);
  for (let i = 0; i + 2 < pos.length + 1 && i < pos.length; i += 3) {
    rel[i] = (pos[i] ?? 0) - origin.x;
    if (i + 1 < pos.length) rel[i + 1] = (pos[i + 1] ?? 0) - origin.y;
    if (i + 2 < pos.length) rel[i + 2] = (pos[i + 2] ?? 0) - origin.z;
  }
  return { rel, origin };
}

/** Chunk origin: the bbox centre snapped to whole units (stable under edits). */
export function chunkOriginFor(pos: ArrayLike<number>): V3 {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let i = 0; i + 2 < pos.length; i += 3) {
    const x = pos[i] ?? 0;
    const y = pos[i + 1] ?? 0;
    const z = pos[i + 2] ?? 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, z: 0 };
  return { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2), z: Math.round((z0 + z1) / 2) };
}
