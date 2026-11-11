/**
 * space-3d/design.md 8 (camera, projection, light, clip box).
 * Quaternion orientation, the three projections, rays, facing, clip.
 * Camera angle props are radians (kernel angle values); the doc table
 * gives the same angles in degrees.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPACE_CAMERA,
  Q_IDENTITY,
  buildCamera,
  chunkOriginFor,
  distForZoom,
  fitNearFar,
  frustumContainsSphere,
  mat4Identity,
  mat4Mul,
  orientationFromAzEl,
  pointInClipBox,
  pointerRay,
  projectPoint,
  quatConj,
  quatFromAxisAngle,
  quatMul,
  quatRotate,
  readAzEl,
  relativize,
  userRotate,
  v3,
  v3Add,
  v3Cross,
  v3Dot,
  v3Len,
  v3Norm,
  v3Scale,
  v3Sub,
  viewFacingAzEl,
  viewPreset,
} from '@incantly/view';
import type { SpaceCameraProps } from '@incantly/view';
import { closeTo } from './helpers';

const DEG = Math.PI / 180;

function props(over: Partial<SpaceCameraProps> = {}): SpaceCameraProps {
  return {
    azimuth: -40 * DEG, elevation: 22 * DEG, roll: 0, target: v3(0, 0, 0), zoom: 1,
    projection: 'ortho', fov: 40 * DEG, obliqueAngle: 30 * DEG, obliqueFactor: 0.5,
    zUp: true, aspect: v3(1, 1, 1), ...over,
  };
}

function cam(over: Partial<SpaceCameraProps> = {}): ReturnType<typeof buildCamera> {
  return buildCamera({ props: props(over), viewport: { w: 800, h: 600, dpr: 1 }, fitDist: 10, fitRadius: 5 });
}

describe('space-3d 8.1 space defaults and presets', () => {
  it('8.1 default camera matches the table (radians)', () => {
    const d = DEFAULT_SPACE_CAMERA;
    closeTo(d.azimuth, -40 * DEG);
    closeTo(d.elevation, 22 * DEG);
    expect(d.roll).toBe(0);
    expect(d.zoom).toBe(1);
    expect(d.projection).toBe('ortho');
    closeTo(d.fov, 40 * DEG);
    closeTo(d.obliqueAngle, 30 * DEG);
    expect(d.obliqueFactor).toBe(0.5);
    expect(d.zUp).toBe(true);
  });

  it('8.3 presets are exact, isometric is 45 / asin(1/sqrt(3))', () => {
    expect(viewPreset('front')).toEqual({ azimuth: 0, elevation: 0 });
    expect(viewPreset('isometric').azimuth).toBe(Math.PI / 4);
    closeTo(viewPreset('isometric').elevation, Math.asin(1 / Math.sqrt(3)));
    const back = viewPreset('back');
    expect(back.elevation).toBe(0);
    closeTo(Math.abs(back.azimuth), Math.PI);
    for (const side of ['left', 'right'] as const) {
      const p = viewPreset(side);
      expect(p.elevation).toBe(0);
      closeTo(Math.abs(p.azimuth), Math.PI / 2);
    }
    expect(viewPreset('left').azimuth).not.toBe(viewPreset('right').azimuth);
    closeTo(Math.abs(viewPreset('top').elevation), Math.PI / 2);
    closeTo(Math.abs(viewPreset('bottom').elevation), Math.PI / 2);
    expect(viewPreset('top').elevation).toBeGreaterThan(0);
    expect(viewPreset('bottom').elevation).toBeLessThan(0);
  });
});

describe('space-3d 8.2 orientation and rotation', () => {
  it('8.2 azimuth 0 looks along +y (camera at -y)', () => {
    const c = cam({ azimuth: 0, elevation: 0, roll: 0 });
    closeTo(c.forward.x, 0);
    closeTo(c.forward.y, 1);
    closeTo(c.forward.z, 0);
    closeTo(c.eye.x, 0);
    closeTo(c.eye.y, -c.dist);
    closeTo(c.eye.z, 0);
  });

  it('8.2 positive elevation puts the camera above the floor looking down', () => {
    const c = cam({ azimuth: 0, elevation: 22 * DEG, roll: 0 });
    expect(c.eye.z).toBeGreaterThan(0);
    expect(c.forward.z).toBeLessThan(0);
    closeTo(Math.abs(c.forward.y), Math.cos(22 * DEG));
  });

  it('8.2 elevation +-90 stays stable (quaternion, no lock)', () => {
    for (const el of [Math.PI / 2, -Math.PI / 2]) {
      for (const az of [0, 1, -2]) {
        const q = orientationFromAzEl(az, el, 0, true);
        const len = Math.hypot(q.w, q.x, q.y, q.z);
        closeTo(len, 1, 12);
        for (const v of [q.w, q.x, q.y, q.z]) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('8.2 interactive rotation is 0.4 deg per px about screen axes', () => {
    const q0 = orientationFromAzEl(0, 0, 0, true);
    const r0 = readAzEl(q0, true);
    const qx = userRotate(q0, 100, 0);
    const rx = readAzEl(qx, true);
    closeTo(Math.abs(rx.azimuth - r0.azimuth) / DEG, 40, 6);
    closeTo(rx.elevation, r0.elevation, 6);
    const qy = userRotate(q0, 0, 50);
    const ry = readAzEl(qy, true);
    closeTo(Math.abs(ry.elevation - r0.elevation) / DEG, 20, 6);
  });

  it('8.2 userRotate honours a custom sensitivity and stays pure', () => {
    const q0 = orientationFromAzEl(0.3, 0, 0, true);
    const a = userRotate(q0, 10, 0, 1);
    const b = userRotate(q0, 10, 0, 1);
    expect(a).toEqual(b);
    const r0 = readAzEl(q0, true);
    const ra = readAzEl(a, true);
    closeTo(Math.abs(ra.azimuth - r0.azimuth) / DEG, 10, 6);
  });

  it('8.2 azimuth/elevation read back for the saved file', () => {
    for (const [az, el] of [[0.5, 0.3], [-1, -0.4], [2.5, 0.1]] as const) {
      const back = readAzEl(orientationFromAzEl(az, el, 0, true), true);
      const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
      closeTo(wrap(back.azimuth - az), 0, 9);
      closeTo(back.elevation - el, 0, 9);
    }
  });

  it('8.2 roll tilts the horizon without moving az/el', () => {
    const q0 = orientationFromAzEl(0.3, 0.2, 0, true);
    const q1 = orientationFromAzEl(0.3, 0.2, 0.1, true);
    expect(q1).not.toEqual(q0);
    const back = readAzEl(q1, true);
    closeTo(back.azimuth, 0.3, 6);
    closeTo(back.elevation, 0.2, 6);
  });

  it('8.2 camera basis is an orthonormal frame', () => {
    const c = cam();
    closeTo(v3Len(c.forward), 1);
    closeTo(v3Len(c.right), 1);
    closeTo(v3Len(c.up), 1);
    closeTo(v3Dot(c.forward, c.right), 0);
    closeTo(v3Dot(c.forward, c.up), 0);
    closeTo(v3Dot(c.right, c.up), 0);
  });

  it('8.2 orientation maps world forward to camera -z', () => {
    const c = cam();
    const f = quatRotate(c.q, c.forward);
    closeTo(f.x, 0);
    closeTo(f.y, 0);
    closeTo(f.z, -1);
  });
});

describe('space-3d 8.2 v3/quat/mat4 maths', () => {
  it('8.2 v3 arithmetic', () => {
    expect(v3Add(v3(1, 2, 3), v3(4, 5, 6))).toEqual(v3(5, 7, 9));
    expect(v3Sub(v3(4, 5, 6), v3(1, 2, 3))).toEqual(v3(3, 3, 3));
    expect(v3Scale(v3(1, 2, 3), 2)).toEqual(v3(2, 4, 6));
    expect(v3Dot(v3(1, 2, 3), v3(4, 5, 6))).toBe(32);
    expect(v3Cross(v3(1, 0, 0), v3(0, 1, 0))).toEqual(v3(0, 0, 1));
    expect(v3Len(v3(3, 4, 0))).toBe(5);
    const n = v3Norm(v3(3, 4, 0));
    closeTo(n.x, 0.6);
    closeTo(n.y, 0.8);
    closeTo(n.z, 0);
  });

  it('8.2 quaternion rotate/conjugate/multiply', () => {
    const q = quatFromAxisAngle(v3(0, 0, 1), Math.PI / 2);
    const r = quatRotate(q, v3(1, 0, 0));
    closeTo(r.x, 0);
    closeTo(r.y, 1);
    closeTo(r.z, 0);
    expect(quatRotate(Q_IDENTITY, v3(1, 2, 3))).toEqual(v3(1, 2, 3));
    const back = quatRotate(quatConj(q), r);
    closeTo(back.x, 1);
    closeTo(back.y, 0);
    const ab = quatRotate(quatMul(q, q), v3(1, 0, 0));
    closeTo(ab.x, -1);
    closeTo(ab.y, 0);
  });

  it('8.2 vp is proj times view (column-major 4x4)', () => {
    const c = cam();
    expect(c.view.length).toBe(16);
    expect(c.proj.length).toBe(16);
    expect(c.vp.length).toBe(16);
    const vp = mat4Mul(c.proj, c.view);
    for (let i = 0; i < 16; i += 1) closeTo(c.vp[i] as number, vp[i] as number, 9);
    const id = mat4Identity();
    const same = mat4Mul(id, c.view);
    for (let i = 0; i < 16; i += 1) closeTo(same[i] as number, c.view[i] as number, 12);
  });
});

describe('space-3d 8.2 near/far, zoom, build', () => {
  it('8.2 near/far fit the visible sphere with a margin', () => {
    const f = fitNearFar(10, 5);
    expect(f.near).toBeGreaterThan(0);
    expect(f.far).toBeGreaterThan(f.near);
    expect(f.near).toBeLessThanOrEqual(10 - 5);
    expect(f.far).toBeGreaterThanOrEqual(10 + 5);
  });

  it('8.3 zoom dollies the eye, never the fov', () => {
    expect(distForZoom(10, 1)).toBe(10);
    expect(distForZoom(10, 2)).toBe(5);
    expect(distForZoom(10, 0.5)).toBe(20);
    const c = cam({ zoom: 2 });
    closeTo(c.fovY, 40 * DEG);
    expect(c.dist).toBeLessThan(cam({ zoom: 1 }).dist);
  });

  it('8.3 perspective scale is f/dist with f = (h/2)/tan(fov/2)', () => {
    const c = cam({ projection: 'persp', zoom: 1 });
    const f = 300 / Math.tan((40 * DEG) / 2);
    closeTo(c.scale, f / c.dist, 6);
  });

  it('8.3 ortho scale doubles with zoom and halves with fit radius', () => {
    const base = cam({ projection: 'ortho', zoom: 1 });
    expect(base.scale).toBeGreaterThan(0);
    closeTo(cam({ projection: 'ortho', zoom: 2 }).scale, base.scale * 2);
    const big = buildCamera({ props: props(), viewport: { w: 800, h: 600, dpr: 1 }, fitDist: 10, fitRadius: 10 });
    closeTo(big.scale, base.scale / 2);
  });

  it('8.3 oblique shear magnitudes follow kf and theta', () => {
    const c = cam({ projection: 'oblique' });
    closeTo(Math.abs(c.shear.kx), 0.5 * Math.abs(Math.cos(30 * DEG)));
    closeTo(Math.abs(c.shear.kz), 0.5 * Math.abs(Math.sin(30 * DEG)));
    // At az/el 0 the xz plane keeps true shape; depth (y) shifts by kf.
    const flat = cam({ projection: 'oblique', azimuth: 0, elevation: 0 });
    const a = projectPoint(flat, v3(0, 0, 0));
    const b = projectPoint(flat, v3(0, 2, 0));
    closeTo(Math.hypot(b.x - a.x, b.y - a.y) / flat.scale, 1, 6);
  });

  it('8.2 build passes through projection, fov, aspect and viewport', () => {
    const c = cam({ projection: 'persp', aspect: v3(1, 1, 2) });
    expect(c.projection).toBe('persp');
    closeTo(c.fovY, 40 * DEG);
    expect(c.aspectAxes).toEqual(v3(1, 1, 2));
    expect(c.viewport).toEqual({ w: 800, h: 600, dpr: 1 });
    expect(c.near).toBeGreaterThan(0);
    expect(c.far).toBeGreaterThan(c.near);
  });

  it('8.2 aspect ratios stretch drawn axes (x2 draws twice as wide)', () => {
    const a = cam({ aspect: v3(2, 1, 1) });
    const b = cam({ aspect: v3(1, 1, 1) });
    const pa = projectPoint(a, v3(1, 0, 0));
    const pb = projectPoint(b, v3(1, 0, 0));
    closeTo(Math.abs(pa.x - 400), 2 * Math.abs(pb.x - 400), 6);
  });

  it('8.2 zUp false builds a valid y-up camera', () => {
    const c = cam({ zUp: false });
    closeTo(v3Len(c.forward), 1);
    for (const v of [c.q.w, c.q.x, c.q.y, c.q.z]) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('space-3d 8 project, rays, facing, clip, origin', () => {
  it('8.3 the target projects to the canvas centre', () => {
    const p = projectPoint(cam(), v3(0, 0, 0));
    closeTo(p.x, 400, 9);
    closeTo(p.y, 300, 9);
    expect(p.behind).toBe(false);
  });

  it('8.3 nearer points have smaller NDC depth; behind flags the eye', () => {
    const c = cam({ projection: 'persp' });
    const nearEye = v3Add(c.eye, v3Scale(v3Sub(c.target, c.eye), 0.1));
    const nearTarget = v3Add(c.eye, v3Scale(v3Sub(c.target, c.eye), 0.9));
    expect(projectPoint(c, nearEye).depth).toBeLessThan(projectPoint(c, nearTarget).depth);
    const behindEye = v3Sub(c.eye, v3Scale(c.forward, 5));
    expect(projectPoint(c, behindEye).behind).toBe(true);
  });

  it('9.4 ortho rays run parallel to the view direction through the pixel', () => {
    const c = cam({ projection: 'ortho' });
    const ray = pointerRay(c, 400, 300);
    closeTo(ray.d.x, c.forward.x);
    closeTo(ray.d.y, c.forward.y);
    closeTo(ray.d.z, c.forward.z);
    // The centre ray passes through the target.
    const toTarget = v3Sub(c.target, ray.o);
    const along = v3Dot(toTarget, ray.d);
    const closest = v3Add(ray.o, v3Scale(ray.d, along));
    closeTo(v3Len(v3Sub(closest, c.target)), 0, 6);
  });

  it('9.4 perspective rays leave the eye through the pixel', () => {
    const c = cam({ projection: 'persp' });
    const ray = pointerRay(c, 400, 300);
    expect(ray.o).toEqual(c.eye);
    closeTo(ray.d.x, c.forward.x, 6);
    closeTo(ray.d.y, c.forward.y, 6);
    closeTo(ray.d.z, c.forward.z, 6);
  });

  it('8.4 ViewFacing looks along the nearer normal', () => {
    const down = viewFacingAzEl(v3(0, 0, 1), { azimuth: -0.7, elevation: 0.38 }, true);
    closeTo(down.elevation, Math.PI / 2, 6);
    expect(Number.isFinite(down.azimuth)).toBe(true);
    const stay = viewFacingAzEl(v3(0, 1, 0), { azimuth: 0, elevation: 0 }, true);
    closeTo(stay.azimuth, 0, 6);
    const side = viewFacingAzEl(v3(1, 0, 0), { azimuth: 0, elevation: 0 }, true);
    closeTo(Math.abs(side.azimuth), Math.PI / 2, 6);
    closeTo(side.elevation, 0, 6);
  });

  it('8.7 frustum tests cull outside spheres only', () => {
    const c = cam();
    expect(frustumContainsSphere(c.vp, v3(0, 0, 0), 1)).toBe(true);
    expect(frustumContainsSphere(c.vp, v3(0, 1000, 0), 1)).toBe(false);
  });

  it('8.7 clip-box tests include edges', () => {
    const min = v3(-5, -5, -5);
    const max = v3(5, 5, 5);
    expect(pointInClipBox(v3(0, 0, 0), min, max)).toBe(true);
    expect(pointInClipBox(v3(5, 5, 5), min, max)).toBe(true);
    expect(pointInClipBox(v3(6, 0, 0), min, max)).toBe(false);
  });

  it('8.2 floating origin relativizes chunks; origins snap to units', () => {
    const r = relativize([10, 20, 30, 12, 22, 32], v3(10, 20, 30));
    expect(Array.from(r.rel)).toEqual([0, 0, 0, 2, 2, 2]);
    expect(r.origin).toEqual(v3(10, 20, 30));
    expect(chunkOriginFor([0, 0, 0, 10, 10, 10])).toEqual(v3(5, 5, 5));
    const frac = chunkOriginFor([0.2, 0, 0, 10.7, 10, 10]);
    expect(Number.isInteger(frac.x)).toBe(true);
    expect(frac.x).toBeGreaterThanOrEqual(0);
    expect(frac.x).toBeLessThanOrEqual(11);
  });
});
