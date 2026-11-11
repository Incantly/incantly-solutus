/**
 * space-3d/design.md 9 (rendering): draw items, arenas, batches, the frame
 * plan, analytic CPU picking, BVH, and the headless Figure3D paint path.
 */
import { describe, expect, it } from 'vitest';
import {
  ArenaAllocator,
  CLIP_OFF,
  Figure3D,
  SceneIndex,
  SoftwareBackend,
  buildBvh,
  buildCamera,
  depthKey,
  itemBounds,
  lodSegments,
  mergeBounds,
  meshTriangles,
  pick,
  planBatches,
  planFrame,
  rayBvh,
  rayLineClosest,
  rayPlane,
  raySphere,
  rayTriangle,
  scaleClipBox,
  sceneTriangles,
  screenDistance,
  v3,
} from '@incantly/view';
import type { DrawItem, Pickable } from '@incantly/view';
import { head, oid, recordingContext, stubKernel, stubStyles } from './helpers';

const DEG = Math.PI / 180;

function camVp(): ReturnType<typeof buildCamera>['vp'] {
  return buildCamera({
    props: {
      azimuth: -40 * DEG, elevation: 22 * DEG, roll: 0, target: v3(0, 0, 0), zoom: 1, projection: 'ortho',
      fov: 40 * DEG, obliqueAngle: 30 * DEG, obliqueFactor: 0.5, zUp: true, aspect: v3(1, 1, 1),
    },
    viewport: { w: 800, h: 600, dpr: 1 }, fitDist: 10, fitRadius: 5,
  }).vp;
}

const meshItem = (id: number, alpha: number): DrawItem => ({
  k: 'mesh', pos: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), nor: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  idx: new Uint32Array([0, 1, 2]), color: 0xff0000ff, alpha, closed: true, objId: oid(id),
});

describe('space-3d 9.2 draw items and bounds', () => {
  it('9.2 item bounds enclose positions; labels sit at their anchor', () => {
    const b = itemBounds({ k: 'points', pos: new Float32Array([0, 0, 0, 2, 0, 0]), size: 4, color: 1, objId: oid(1) });
    expect([b.c.x, b.c.y, b.c.z]).toEqual([1, 0, 0]);
    expect(b.r).toBe(1);
    const l = itemBounds({ k: 'label', anchor: v3(1, 2, 3), text: { text: 'A', math: false, sizePx: 14 }, objId: oid(1) });
    expect(l.c).toEqual(v3(1, 2, 3));
    expect(l.r).toBe(0);
  });

  it('9.2 merged bounds enclose every item', () => {
    const m = mergeBounds([
      { c: v3(0, 0, 0), r: 1 },
      { c: v3(10, 0, 0), r: 1 },
    ]);
    expect(m.r).toBeGreaterThanOrEqual(6);
    for (const p of [v3(-1, 0, 0), v3(11, 0, 0)]) {
      expect(Math.hypot(p.x - m.c.x, p.y - m.c.y, p.z - m.c.z)).toBeLessThanOrEqual(m.r + 1e-9);
    }
  });

  it('9.2 the scene index follows kernel add/update/remove', () => {
    const scene = new SceneIndex();
    const build = (id: unknown): DrawItem[] => [meshItem(id as number, 1)];
    scene.applyEvent({ kind: 'add', ids: [oid(1), oid(2)] }, build);
    expect(scene.size).toBe(2);
    expect(scene.of(oid(1))).toHaveLength(1);
    scene.applyEvent({ kind: 'update', ids: [oid(1)] }, build);
    expect(scene.of(oid(1))).toHaveLength(1);
    scene.applyEvent({ kind: 'remove', ids: [oid(1)] }, build);
    expect(scene.size).toBe(1);
    expect(scene.all()).toHaveLength(1);
  });

  it('9.2 scene bounds cover the whole scene', () => {
    const scene = new SceneIndex();
    scene.applyEvent({ kind: 'add', ids: [oid(1)] }, () => [meshItem(1, 1)]);
    expect(scene.sceneBounds().r).toBeGreaterThan(0);
  });

  it('9.2 visible items survive frustum and clip-box culling', () => {
    const scene = new SceneIndex();
    scene.applyEvent({ kind: 'add', ids: [oid(1), oid(2)] }, (id) => (id as number) === 1
      ? [{ k: 'points', pos: new Float32Array([0, 0, 0]), size: 4, color: 1, objId: oid(1) }]
      : [{ k: 'points', pos: new Float32Array([0, 10000, 0]), size: 4, color: 1, objId: oid(2) }]);
    const vis = scene.visibleItems(camVp(), CLIP_OFF);
    expect(vis.map((i) => (i as { objId: unknown }).objId as number)).toEqual([1]);
    const clipped = scene.visibleItems(camVp(), {
      on: true, min: v3(10, 10, 10), max: v3(20, 20, 20), caps: false,
    });
    expect(clipped).toEqual([]);
  });
});

describe('space-3d 8.1 clip-box presets', () => {
  it('8.1 medium keeps the box; tiny..huge scale about the centre', () => {
    const box = { on: true, min: v3(-4, -4, -4), max: v3(4, 4, 4), caps: false };
    const med = scaleClipBox(box, 'medium');
    expect(med.min).toEqual(box.min);
    expect(med.max).toEqual(box.max);
    const volumes = (['tiny', 'small', 'medium', 'large', 'huge'] as const).map((s) => {
      const b = scaleClipBox(box, s);
      expect((b.min.x + b.max.x) / 2).toBe(0);
      return (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z);
    });
    for (let i = 1; i < volumes.length; i += 1) {
      expect(volumes[i] as number).toBeGreaterThan(volumes[i - 1] as number);
    }
  });

  it('8.1 clip off disables the box', () => {
    expect(CLIP_OFF.on).toBe(false);
  });
});

describe('space-3d 9.2 arena batching', () => {
  it('9.2 the offset allocator packs ranges and reuses freed ones', () => {
    const a = new ArenaAllocator(1024);
    expect(a.alloc(100)).toBe(0);
    expect(a.alloc(100)).toBe(100);
    a.free(0, 100);
    expect(a.alloc(50)).toBe(0);
    expect(a.usedBytes).toBe(150);
  });

  it('9.2 allocations honour alignment', () => {
    const a = new ArenaAllocator(1024);
    a.alloc(10);
    const off = a.alloc(10, 16);
    expect(off % 16).toBe(0);
  });

  it('9.2 batches group by material class: opaque, transparent, lines, points, labels', () => {
    const items: DrawItem[] = [
      meshItem(1, 1),
      meshItem(2, 0.5),
      { k: 'lines', pos: new Float32Array([0, 0, 0, 1, 1, 1]), width: 2, color: 1, dash: null, closed: false, objId: oid(3) },
      { k: 'points', pos: new Float32Array([0, 0, 0]), size: 4, color: 1, objId: oid(4) },
      { k: 'label', anchor: v3(0, 0, 0), text: { text: 'A', math: false, sizePx: 14 }, objId: oid(5) },
    ];
    const plan = planBatches(items);
    expect(plan.opaque).toHaveLength(1);
    expect(plan.transparent).toHaveLength(1);
    expect(plan.lines).toHaveLength(1);
    expect(plan.points).toHaveLength(1);
    expect(plan.labels).toHaveLength(1);
  });

  it('9.2 depth keys order consistently with distance (fallback sort)', () => {
    const eye = v3(0, 0, 10);
    const at = (z: number): DrawItem => ({
      k: 'points', pos: new Float32Array([0, 0, z]), size: 4, color: 1, objId: oid(1),
    });
    const k1 = depthKey(at(9), eye);
    const k2 = depthKey(at(0), eye);
    const k3 = depthKey(at(-9), eye);
    const asc = k1 < k2 && k2 < k3;
    const desc = k1 > k2 && k2 > k3;
    expect(asc || desc).toBe(true);
  });

  it('9.2 LOD segments follow the on-screen radius within [min, max]', () => {
    expect(lodSegments(5, 8, 64)).toBe(8);
    expect(lodSegments(5000, 8, 64)).toBe(64);
    const mid = lodSegments(100, 8, 64);
    expect(mid).toBeGreaterThan(8);
    expect(mid).toBeLessThan(64);
    expect(lodSegments(200, 8, 64)).toBeGreaterThanOrEqual(mid);
  });

  it('9.2 triangle counts come from the index buffers', () => {
    expect(meshTriangles(meshItem(1, 1))).toBe(1);
    expect(sceneTriangles([meshItem(1, 1), meshItem(2, 1)])).toBe(2);
    expect(sceneTriangles([{ k: 'points', pos: new Float32Array([0, 0, 0]), size: 4, color: 1, objId: oid(1) }])).toBe(0);
  });
});

describe('space-3d 9.3 frame plan', () => {
  it('9.3 opaque scenes skip transparency and hidden passes', () => {
    const [eye] = planFrame({ hasClosedTransparent: false, hidden: 'off', hasTransparent: false, floatTargets: true, stereo: false });
    expect(eye).toContain('opaque');
    expect(eye).toContain('overlay');
    expect(eye).toContain('resolve');
    expect(eye).not.toContain('hideDepth');
    expect(eye).not.toContain('hiddenLines');
    expect(eye).not.toContain('transparent');
    expect(eye).not.toContain('wboitComposite');
  });

  it('9.3 hide-depth runs for closed transparents or dashed hidden lines', () => {
    const a = planFrame({ hasClosedTransparent: true, hidden: 'off', hasTransparent: true, floatTargets: true, stereo: false })[0];
    expect(a).toContain('hideDepth');
    const b = planFrame({ hasClosedTransparent: false, hidden: 'dashed', hasTransparent: false, floatTargets: true, stereo: false })[0];
    expect(b).toContain('hideDepth');
    expect(b).toContain('hiddenLines');
    const c = planFrame({ hasClosedTransparent: false, hidden: 'off', hasTransparent: false, floatTargets: true, stereo: false })[0];
    expect(c).not.toContain('hideDepth');
  });

  it('9.3 hidden line modes gate the hidden pass', () => {
    for (const hidden of ['dashed', 'faded'] as const) {
      const [eye] = planFrame({ hasClosedTransparent: false, hidden, hasTransparent: false, floatTargets: true, stereo: false });
      expect(eye).toContain('hiddenLines');
    }
  });

  it('9.3 WBOIT composite needs float targets; fallback sorts instead', () => {
    const [wboit] = planFrame({ hasClosedTransparent: false, hidden: 'off', hasTransparent: true, floatTargets: true, stereo: false });
    expect(wboit).toContain('transparent');
    expect(wboit).toContain('wboitComposite');
    const [fallback] = planFrame({ hasClosedTransparent: false, hidden: 'off', hasTransparent: true, floatTargets: false, stereo: false });
    expect(fallback).toContain('transparent');
    expect(fallback).not.toContain('wboitComposite');
  });

  it('9.3 stereo renders two eyes; passes run in frame order', () => {
    const eyes = planFrame({ hasClosedTransparent: true, hidden: 'dashed', hasTransparent: true, floatTargets: true, stereo: true });
    expect(eyes).toHaveLength(2);
    expect(eyes[0]).toEqual(eyes[1]);
    const order = ['hideDepth', 'opaque', 'hiddenLines', 'transparent', 'wboitComposite', 'overlay', 'resolve'];
    const idx = (p: string): number => (eyes[0] as string[]).indexOf(p);
    for (let i = 1; i < order.length; i += 1) {
      expect(idx(order[i] as string)).toBeGreaterThan(idx(order[i - 1] as string));
    }
  });
});

describe('space-3d 9.4/10.1 ray primitives', () => {
  it('9.4 ray-plane solves t, null when parallel', () => {
    expect(rayPlane(v3(0, 0, 5), v3(0, 0, -1), v3(0, 0, 1), 0)).toBe(5);
    expect(rayPlane(v3(0, 0, 5), v3(1, 0, 0), v3(0, 0, 1), 0)).toBeNull();
  });

  it('10.1 ray-line closest approach; null when parallel (holds value)', () => {
    const hit = rayLineClosest(v3(0, 0, 0), v3(1, 0, 0), v3(5, 0, 1), v3(0, 0, 1));
    expect(hit).not.toBeNull();
    expect(hit?.t).toBe(5);
    expect(hit?.s).toBe(0);
    expect(rayLineClosest(v3(0, 0, 0), v3(1, 0, 0), v3(0, 1, 0), v3(1, 0, 0))).toBeNull();
  });

  it('9.4 ray-sphere enter/exit, miss, tangent pair', () => {
    expect(raySphere(v3(0, 0, 5), v3(0, 0, -1), v3(0, 0, 0), 2)).toEqual([3, 7]);
    expect(raySphere(v3(0, 0, 5), v3(0, 0, -1), v3(10, 0, 0), 2)).toBeNull();
    const tan = raySphere(v3(2, 0, 5), v3(0, 0, -1), v3(0, 0, 0), 2);
    expect(tan).not.toBeNull();
    if (tan !== null) expect(tan[0]).toBe(tan[1]);
  });

  it('9.4 ray-triangle hits with barycentrics, misses cleanly', () => {
    const hit = rayTriangle(v3(0.5, 0.5, 5), v3(0, 0, -1), v3(0, 0, 0), v3(2, 0, 0), v3(0, 2, 0));
    expect(hit).not.toBeNull();
    expect(hit?.t).toBe(5);
    expect((hit?.u ?? -1) + (hit?.v ?? -1)).toBeLessThanOrEqual(1 + 1e-9);
    expect(rayTriangle(v3(5, 5, 5), v3(0, 0, -1), v3(0, 0, 0), v3(2, 0, 0), v3(0, 2, 0))).toBeNull();
  });

  it('9.4 BVH builds and answers nearest hits', () => {
    const pos = new Float32Array([0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 0, 0, 2, 2, 0, 0, 2, 0]);
    const idx = new Uint32Array([0, 1, 2, 3, 4, 5]);
    const bvh = buildBvh(pos, idx);
    expect(bvh.nodeCount).toBeGreaterThan(0);
    const hit = rayBvh(bvh, { o: v3(0.5, 0.5, 5), d: v3(0, 0, -1) });
    expect(hit).not.toBeNull();
    expect(hit?.t).toBe(5);
    expect(rayBvh(bvh, { o: v3(9, 9, 5), d: v3(0, 0, -1) })).toBeNull();
  });
});

describe('space-3d 9.4 picking', () => {
  const ray = { o: v3(0, 0, 5), d: v3(0, 0, -1) };
  const project = (p: { x: number; y: number; z: number }): { x: number; y: number } | null =>
    p.z > 4.9 && p.z < 5.1 && Math.abs(p.x) < 0.001 && Math.abs(p.y) < 0.001 ? { x: 400, y: 300 } : { x: 400 + p.x * 50, y: 300 - p.y * 50 };
  const quad = (): Pickable => {
    const pos = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]);
    return { k: 'surface', objId: oid(5), bvh: buildBvh(pos, new Uint32Array([0, 1, 2, 3, 4, 5])), transparent: false };
  };

  it('9.4 priority orders gizmo, label, point, path, surface', () => {
    const items: Pickable[] = [
      quad(),
      { k: 'path', objId: oid(4), pts: new Float32Array([-1, 0, 0, 1, 0, 0]), closed: false },
      { k: 'point', objId: oid(3), at: v3(0, 0, 0) },
      { k: 'label', objId: oid(2), at: v3(0, 0, 0), radiusPx: 10 },
      { k: 'gizmo', objId: oid(1), at: v3(0, 0, 0), radiusPx: 10 },
    ];
    const hits = pick(items, ray, project, 400, 300, { tolerancePx: 10, includeTransparent: true });
    expect(hits.map((h) => h.kind)).toEqual(['gizmo', 'label', 'point', 'path', 'surface']);
  });

  it('9.4 points and paths beyond tolerance are skipped (10 mouse, 22 touch)', () => {
    const items: Pickable[] = [{ k: 'point', objId: oid(3), at: v3(0.3, 0, 0) }];
    expect(pick(items, ray, project, 400, 300, { tolerancePx: 10, includeTransparent: true })).toEqual([]);
    expect(pick(items, ray, project, 400, 300, { tolerancePx: 22, includeTransparent: true })).toHaveLength(1);
  });

  it('9.4 transparent surfaces rank last; exclusion drops them', () => {
    const bvhOf = (z: number): Pickable => {
      const pos = new Float32Array([-1, -1, z, 1, -1, z, 1, 1, z]);
      return { k: 'surface', objId: oid(z === 1 ? 6 : 7), bvh: buildBvh(pos, new Uint32Array([0, 1, 2])), transparent: z === 1 };
    };
    const items = [bvhOf(1), bvhOf(0)];
    const hits = pick(items, ray, project, 400, 300, { tolerancePx: 10, includeTransparent: true });
    expect(hits[hits.length - 1]?.transparent).toBe(true);
    const noTrans = pick(items, ray, project, 400, 300, { tolerancePx: 10, includeTransparent: false });
    expect(noTrans.every((h) => !h.transparent)).toBe(true);
  });

  it('9.4 a point in tolerance beats a transparent surface in front of it', () => {
    const pos = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0]);
    const items: Pickable[] = [
      { k: 'surface', objId: oid(5), bvh: buildBvh(pos, new Uint32Array([0, 1, 2])), transparent: true },
      { k: 'point', objId: oid(3), at: v3(0, 0, -1) },
    ];
    const hits = pick(items, ray, project, 400, 300, { tolerancePx: 10, includeTransparent: true });
    expect(hits[0]?.kind).toBe('point');
  });

  it('9.4 a point hidden behind an opaque surface does not beat it', () => {
    const pos = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0]);
    const items: Pickable[] = [
      { k: 'surface', objId: oid(5), bvh: buildBvh(pos, new Uint32Array([0, 1, 2])), transparent: false },
      { k: 'point', objId: oid(3), at: v3(0, 0, -1) },
    ];
    const hits = pick(items, ray, project, 400, 300, { tolerancePx: 10, includeTransparent: true });
    expect(hits[0]?.kind).toBe('surface');
  });

  it('9.4 hits carry exact parameters and screen distances', () => {
    const items: Pickable[] = [
      { k: 'path', objId: oid(4), pts: new Float32Array([-1, 0, 0, 1, 0, 0]), closed: false },
    ];
    const hits = pick(items, ray, project, 400, 300, { tolerancePx: 10, includeTransparent: true });
    expect(hits[0]?.param?.s).toBeDefined();
    expect(hits[0]?.screenDist).toBe(0);
    expect(hits[0]?.world.z).toBe(0);
  });

  it('9.4 screenDistance nulls behind the eye', () => {
    expect(screenDistance(project, v3(0, 0, 0), 400, 300)).toBe(0);
    expect(screenDistance(() => null, v3(0, 0, 0), 400, 300)).toBeNull();
  });

  it('9.4 picking 100 objects answers fast', { timeout: 15000 }, () => {
    const items: Pickable[] = [];
    for (let i = 0; i < 100; i += 1) {
      items.push({ k: 'point', objId: oid(i), at: v3((i % 10) - 5, Math.floor(i / 10) - 5, 0) });
    }
    const t0 = performance.now();
    const n = 20;
    for (let i = 0; i < n; i += 1) {
      pick(items, ray, project, 400 + (i % 5), 300, { tolerancePx: 10, includeTransparent: true });
    }
    expect((performance.now() - t0) / n).toBeLessThan(5);
  });
});

describe('space-3d 9 Figure3D headless paint', () => {
  function painter(objects: Parameters<typeof stubKernel>[0], meshes: Record<string, { pos: Float32Array; nor: Float32Array; idx: Uint32Array }> = {}): {
    fig: Figure3D; be: SoftwareBackend;
  } {
    const { ctx } = recordingContext();
    const be = new SoftwareBackend(ctx);
    const fig = new Figure3D(stubKernel(objects), stubStyles(objects), { get: (k: string) => meshes[k] });
    fig.applyEvents([{ kind: 'add', ids: objects.map((o) => o.head.id) }]);
    return { fig, be };
  }

  function targetOf(be: SoftwareBackend): Parameters<Figure3D['paint']>[0]['target'] {
    const t = be.createTarget({ width: 64, height: 64, samples: 0, depth: true, float: false });
    if (!t.ok) throw new Error('no target');
    return t.value;
  }

  function inputOf(be: SoftwareBackend): Parameters<Figure3D['paint']>[0] {
    return {
      backend: be,
      target: targetOf(be),
      size: { width: 64, height: 64, dpr: 1 },
      cameraProps: {
        azimuth: -40 * DEG, elevation: 22 * DEG, roll: 0, target: v3(0, 0, 0), zoom: 1, projection: 'ortho',
        fov: 40 * DEG, obliqueAngle: 30 * DEG, obliqueFactor: 0.5, zUp: true, aspect: v3(1, 1, 1),
      },
      clip: CLIP_OFF,
      hidden: 'dashed',
      light: 'on',
      background: { r: 1, g: 1, b: 1, a: 1 },
    };
  }

  it('9.3 a point paints one draw call with one point in stats', () => {
    const { fig, be } = painter([{ head: head(1, 'P'), value: { k: 'point3', x: 0, y: 0, z: 0 }, kind: 'point' }]);
    const r = fig.paint(inputOf(be));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.drawCalls).toBe(1);
      expect(r.value.points).toBe(1);
    }
    fig.dispose();
    be.dispose();
  });

  it('9.3 meshes count triangles in stats', () => {
    const { fig, be } = painter([{
      head: head(1, 'M'), value: { k: 'mesh', pos: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), nor: new Float32Array(9).fill(0), idx: new Uint32Array([0, 1, 2]), closed: true }, kind: 'point',
    }]);
    const r = fig.paint(inputOf(be));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.triangles).toBe(1);
    fig.dispose();
    be.dispose();
  });

  it('9.3 mesh references resolve through the provider; misses draw nothing', () => {
    const data = { pos: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), nor: new Float32Array(9).fill(0), idx: new Uint32Array([0, 1, 2]) };
    const hit = painter([{ head: head(1, 'M'), value: { k: 'meshref', key: 'm1' }, kind: 'point' }], { m1: data });
    const r1 = hit.fig.paint(inputOf(hit.be));
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.value.triangles).toBe(1);
    hit.fig.dispose();
    hit.be.dispose();
    const miss = painter([{ head: head(1, 'M'), value: { k: 'meshref', key: 'nope' }, kind: 'point' }]);
    expect(miss.fig.paint(inputOf(miss.be)).ok).toBe(true);
    miss.fig.dispose();
    miss.be.dispose();
  });

  it('9.3 remove drops the object from later frames', () => {
    const { fig, be } = painter([{ head: head(1, 'P'), value: { k: 'point3', x: 0, y: 0, z: 0 }, kind: 'point' }]);
    fig.applyEvents([{ kind: 'remove', ids: [oid(1)] }]);
    const r = fig.paint(inputOf(be));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.points).toBe(0);
    fig.dispose();
    be.dispose();
  });

  it('8.5 light and hidden modes paint without failing', () => {
    const { fig, be } = painter([{ head: head(1, 'P'), value: { k: 'point3', x: 0, y: 0, z: 0 }, kind: 'point' }]);
    for (const light of ['on', 'off', 'flat'] as const) {
      for (const hidden of ['dashed', 'faded', 'off'] as const) {
        expect(fig.paint({ ...inputOf(be), light, hidden }).ok).toBe(true);
      }
    }
    fig.dispose();
    be.dispose();
  });
});
