/** Surfaces, curves and the clip box in the Space view (.kiro/specs/space-3d-surfaces R1, R2; design 6.3, 8.7; ui 7, 8). */
import { describe, expect, it } from 'vitest';
import { space } from '@incantly/kernel';
import { SvgContext, createHeadlessApp } from '../../src/index';
import { curveRuns, gridFaces, heightColor, paintSpace, sceneOf3 } from '../../src/screen/index';
import type { FaceItem, LineItem } from '../../src/screen/index';

const scene = (lines: readonly string[]) => {
  const a = createHeadlessApp({ mode: 'graphing3d', script: lines.join('\n') });
  return { app: a, scene: sceneOf3(a.figure, space.viewOf(a.figure)) };
};
const own = <T>(items: readonly { k: string; id?: number }[], k: string): T[] => items.filter((i) => i.k === k && (i.id ?? -1) >= 0) as T[];

describe('meshing (R1, design 6.3)', () => {
  it('a grid of n by n cells, each coloured by its height, blue low and orange high', () => {
    const faces = gridFaces(4, (i, j) => ({ x: i, y: j, z: i }));
    expect(faces).toHaveLength(16);
    expect(heightColor(0)).toBe('#2f6fdb');
    expect(heightColor(1)).toBe('#e9a23b');
    expect(faces[0]?.color).toBe(heightColor(0.125));
    // grid lines on every fifth row and column by default: here only the first
    expect(faces[0]?.edges).toEqual([true, false, false, true]);
  });

  it('a cell with an undefined corner is left out, so undefined samples make holes', () => {
    const faces = gridFaces(4, (i, j) => (i === 2 && j === 2 ? undefined : { x: i, y: j, z: 0 }));
    expect(faces).toHaveLength(12);
  });

  it('a curve is split where it is undefined', () => {
    const runs = curveRuns((s) => (Math.abs(s) < 0.2 ? undefined : { x: s, y: 0, z: 0 }), -1, 1, 20);
    expect(runs).toHaveLength(2);
  });
});

describe('surfaces in the scene (R1.1 to R1.4)', () => {
  it('a function of two variables is the surface z = f(x, y) over the floor', () => {
    const { scene: s } = scene(['f(x, y) = x * y / 5']);
    const faces = own<FaceItem>(s.items, 'face');
    expect(faces).toHaveLength(40 * 40);
    const xs = faces.flatMap((f) => f.pts.map((p) => p.x));
    expect(Math.min(...xs)).toBe(-5);
    expect(Math.max(...xs)).toBe(5);
    for (const f of faces.slice(0, 50)) for (const p of f.pts) expect(p.z).toBeCloseTo((p.x * p.y) / 5, 12);
    expect(faces.every((f) => f.occludes && f.stroke !== undefined)).toBe(true);
  });

  it('a function of one variable is not a surface', () => {
    const { scene: s } = scene(['g(x) = x^2']);
    expect(own(s.items, 'face')).toHaveLength(0);
  });

  it('a surface far above the view is left out; one with a hole has fewer cells', () => {
    expect(own(scene(['f(x, y) = 100']).scene.items, 'face')).toHaveLength(0);
    const holes = own<FaceItem>(scene(['f(x, y) = sqrt(4 - x^2 - y^2)']).scene.items, 'face');
    expect(holes.length).toBeGreaterThan(0);
    expect(holes.length).toBeLessThan(1600);
  });

  it('a parametric surface is a 36 by 36 mesh, a curve in space a line', () => {
    const { scene: s } = scene(['S = Surface(cos(u) * sin(v), sin(u) * sin(v), cos(v), u, 0, tau, v, 0, pi)', 'c = Curve(cos(s), sin(s), s / 5, s, 0, 12)']);
    expect(own(s.items, 'face')).toHaveLength(36 * 36);
    expect(own<LineItem>(s.items, 'line')).toHaveLength(200);
  });

  it('the painter draws a surface with its grid lines', () => {
    const { app } = scene(['f(x, y) = sin(x) * cos(y)', 'space with axes = false, floor = false, grid = false']);
    const view = space.viewOf(app.figure);
    const ctx = new SvgContext(500, 400);
    paintSpace(ctx as unknown as CanvasRenderingContext2D, view, 500, 400, sceneOf3(app.figure, view), { background: null });
    const svg = ctx.toString();
    expect((svg.match(/<path /g) ?? []).length).toBeGreaterThan(1600);
    expect(svg).toMatch(/stroke-width="0.75"/);
  });
});
