/** The Space view: its scene, painter, export and pane (.kiro/specs/space-3d R3.3, R3.4, R4.6; docs/features/space-3d design 8, 9.5; ui 7). */
import { afterEach, describe, expect, it } from 'vitest';
import { space } from '@incantly/kernel';
import { SvgContext, createApp, createHeadlessApp } from '../../src/index';
import type { MountedApp, Scheduler } from '../../src/index';
import { cameraFor, clipLine, describe3, paintSpace, sceneOf3 } from '../../src/screen/index';
import type { FaceItem, LineItem, PointItem } from '../../src/screen/index';

const CUBE = ['A = (0, 0, 0)', 'B = (2, 0, 0)', 'C = (0, 1, 0)', 'k = Cube(A, B, C)'];
const app3 = (lines: readonly string[]) => createHeadlessApp({ mode: 'graphing3d', script: lines.join('\n') });
const sceneFor = (lines: readonly string[]) => {
  const a = app3(lines);
  return sceneOf3(a.figure, space.viewOf(a.figure));
};
const ofId = (items: readonly { k: string; id?: number }[], k: string) => items.filter((i) => i.k === k && (i.id ?? -1) >= 0);

describe('the scene (R3.3, ui 7)', () => {
  it('a cube is 6 faces and 12 edges, faint pastel faces that hide what is behind', () => {
    const s = sceneFor(CUBE);
    const faces = ofId(s.items, 'face') as FaceItem[];
    const edges = ofId(s.items, 'line') as LineItem[];
    expect(faces).toHaveLength(6);
    expect(edges).toHaveLength(12);
    expect(faces.every((f) => f.occludes && f.alpha === 0.4)).toBe(true);
    expect(edges.every((e) => e.hiddenDashed)).toBe(true);
    const points = ofId(s.items, 'point') as PointItem[];
    expect(points.map((p) => p.name)).toEqual(['A', 'B', 'C']);
    expect(points.every((p) => p.free && p.label)).toBe(true);
  });

  it('a plane is a see-through patch about the target that hides nothing; a line is cut to the view', () => {
    const s = sceneFor(['p = Plane((0, 0, 1), Vector(0, 0, 1))', 'l = Line((0, 0, 0), (1, 1, 1))']);
    const [patch] = ofId(s.items, 'face') as FaceItem[];
    expect(patch?.occludes).toBe(false);
    expect(patch?.alpha).toBeLessThanOrEqual(0.35);
    expect(patch?.pts.every((p) => Math.abs(p.z - 1) < 1e-12)).toBe(true);
    const lines = ofId(s.items, 'line') as LineItem[];
    const l = lines[lines.length - 1] as LineItem;
    for (const p of [l.a, l.b]) expect(Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z))).toBeCloseTo(10, 9);
  });

  it('clipLine keeps the part of a line in a box, and a ray only ahead of its start', () => {
    expect(clipLine({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 2)).toEqual([{ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }]);
    expect(clipLine({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 2, 0)).toEqual([{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }]);
    expect(clipLine({ x: 0, y: 5, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 2)).toBeUndefined();
  });

  it('spheres, cylinders, cones and circles in space have faces or loops', () => {
    const s = sceneFor(['s = Sphere((0, 0, 0), 1)', 'c = Cylinder((3, 0, 0), (3, 0, 2), 1)', 'n = Cone((-3, 0, 0), (-3, 0, 2), 1)', 'r = Circle((0, 0, 3), 1, Vector(0, 0, 1))']);
    const byId = new Map<number, number>();
    for (const f of ofId(s.items, 'face') as FaceItem[]) byId.set(f.id, (byId.get(f.id) ?? 0) + 1);
    expect([...byId.values()]).toEqual([12 * 24, 34, 33]);
    expect((ofId(s.items, 'line') as LineItem[]).length).toBeGreaterThanOrEqual(64);
  });

  it('the camera line turns off the axes, the floor and the grid', () => {
    const on = sceneFor(CUBE);
    expect(on.floor.length).toBeGreaterThan(1);
    expect(on.items.some((i) => i.k === 'label' && i.text === 'z')).toBe(true);
    const off = sceneFor([...CUBE, 'space with axes = false, floor = false, grid = false']);
    expect(off.floor).toHaveLength(0);
    expect(off.items.some((i) => i.k === 'label')).toBe(false);
  });

  it('hidden objects are left out', () => {
    const s = sceneFor([...CUBE, 'k with visible = false']);
    expect(ofId(s.items, 'face')).toHaveLength(0);
  });
});

describe('the painter (R3.3, design 8.5, 9.3)', () => {
  const paint = (lines: readonly string[]) => {
    const a = app3(lines);
    const view = space.viewOf(a.figure);
    const ctx = new SvgContext(600, 400);
    const r = paintSpace(ctx as unknown as CanvasRenderingContext2D, view, 600, 400, sceneOf3(a.figure, view), { background: null });
    return { ...r, svg: ctx.toString() };
  };

  it('draws a cube with its hidden edges dashed and faint', () => {
    const { svg } = paint(CUBE);
    expect(svg).toMatch(/stroke-dasharray="4 4"/);
    expect(svg).toMatch(/stroke-opacity="0.4"/);
    expect(svg).toMatch(/fill-opacity="0.4"/);
  });

  it('a lone segment hides nothing, so nothing is dashed', () => {
    const { svg } = paint(['s = Segment((0, 0, 0), (1, 1, 1))', 'space with axes = false, floor = false, grid = false']);
    expect(svg).not.toMatch(/stroke-dasharray/);
  });

  it('a point lies where the camera puts it, and is hit there', () => {
    const { camera, hits } = paint(['P = (1, 2, 3)']);
    const hit = hits.find((h) => h.k === 'point');
    expect(hit).toMatchObject({ k: 'point', name: 'P', free: true });
    const m = camera.vp;
    const w = m[3]! * 1 + m[7]! * 2 + m[11]! * 3 + m[15]!;
    const x = ((m[0]! * 1 + m[4]! * 2 + m[8]! * 3 + m[12]!) / w + 1) * 300;
    expect((hit as { x: number }).x).toBeCloseTo(x, 6);
  });

  it('a point behind a solid is drawn faint', () => {
    // the camera looks from the −y side (azimuth 0): the point behind the cube is hidden by it
    const { svg } = paint([...CUBE, 'P = (1, 5, 1)', 'space with azimuth = 0deg, elevation = 0deg, axes = false, floor = false, grid = false']);
    expect(svg).toMatch(/fill="#1f4fa3" fill-opacity="0.4"/);
  });

  it('flat light gives every face of a solid the same colour', () => {
    const { svg } = paint([...CUBE, 'space with light = flat, axes = false, floor = false, grid = false']);
    const fills = new Set([...svg.matchAll(/fill="(#[0-9a-f]{6})" fill-opacity="0.4"/g)].map((m) => m[1]));
    expect(fills.size).toBe(1);
  });

  it('zoom 2 draws twice as large; perspective shrinks what is far away', () => {
    const v = space.DEFAULT_VIEW3;
    expect(cameraFor({ ...v, zoom: 2 }, 600, 400).scale).toBeCloseTo(cameraFor(v, 600, 400).scale * 2, 9);
    const cam = cameraFor({ ...v, projection: 'persp' }, 600, 400);
    expect(cam.projection).toBe('persp');
  });
});

describe('export of the Space view (R3.4)', () => {
  it('the 3D app exports what the Space view paints', async () => {
    const a = app3(CUBE);
    const r = await a.export({ format: 'svg', width: 500, height: 400 });
    if (!r.ok) throw new Error(r.message);
    expect(r.text).toMatch(/stroke-dasharray="4 4"/);
    expect(r.text).toContain('<rect width="100%" height="100%" fill="#ffffff"/>');
  });

  it('another app exports the Space view when asked', async () => {
    const a = createHeadlessApp({ mode: 'classic', script: CUBE.join('\n') });
    const flat = await a.export({ format: 'svg', width: 300, height: 200 });
    const deep = await a.export({ format: 'svg', width: 300, height: 200, view: '3d' });
    if (!flat.ok || !deep.ok) throw new Error('export failed');
    expect(deep.text).not.toBe(flat.text);
    expect(deep.text).toMatch(/stroke-dasharray/);
  });
});

describe('the Space pane in createApp (R3.3, R4.6)', () => {
  const now: Scheduler = { micro: (fn) => fn(), frame: (fn) => fn() };
  let app: MountedApp | undefined;
  afterEach(() => app?.destroy());

  it('the 3D app shows the Space view instead of the graph, with a list for screen readers', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    app = await createApp({ container, mode: 'graphing3d', scheduler: now, script: CUBE.join('\n') });
    expect(app.screen.space).toBeDefined();
    expect(container.querySelector('.space-view canvas')).not.toBeNull();
    expect((container.querySelector('.graph') as HTMLElement).hidden).toBe(true);
    app.screen.paint();
    const items = [...container.querySelectorAll('.space-sr li')].map((li) => li.textContent);
    expect(items).toEqual(['A, (0, 0, 0)', 'B, (2, 0, 0)', 'C, (0, 1, 0)', 'k, cube, 6 faces, volume 8']);
    container.remove();
  });

  it('describe3 names each object in space and leaves out flat ones', () => {
    const a = createHeadlessApp({ mode: 'classic', script: ['P = (1, 2)', 'Q = (1, 2, 3)'].join('\n') });
    expect(describe3(a.figure)).toEqual(['Q, (1, 2, 3)']);
  });
});
