/**
 * Space view benchmarks against .kiro/specs/space-3d R5 (docs/features/space-3d/design.md 12, 13; Node, warm).
 *
 * Run: `npx vitest run --config packages/sdk/bench/vitest.config.ts`. The painter runs on a context that draws nothing,
 * so this measures the scene, the projection, the sort and the hidden-line test; the browser adds the canvas fills.
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { space } from '@incantly/kernel';
import { createHeadlessApp } from '../src/index';
import { paintSpace, pick3, sceneOf3 } from '../src/screen/index';

const noop = (): void => undefined;
const NULL_CTX = {
  beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop, fill: noop, stroke: noop, arc: noop, fillText: noop, strokeText: noop,
  setLineDash: noop, save: noop, restore: noop, fillRect: noop, setTransform: noop,
  fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, font: '', textAlign: 'left', textBaseline: 'alphabetic', lineJoin: 'round', lineCap: 'round',
} as unknown as CanvasRenderingContext2D;

/** 500 objects: 300 points, 100 segments, 50 flat polygons and 50 cubes. */
function figure500(): string[] {
  const lines: string[] = [];
  const c = (i: number, k: number): string => String(((i * k) % 9) - 4);
  for (let i = 0; i < 300; i++) lines.push(`P${i} = (${c(i, 7)}, ${c(i, 5)}, ${(i % 7) * 0.5})`);
  for (let i = 0; i < 100; i++) lines.push(`s${i} = Segment(P${i}, P${i + 100})`);
  for (let i = 0; i < 50; i++) lines.push(`g${i} = Polygon((${i % 5}, ${i % 3}, ${i % 4}), (${(i % 5) + 0.5}, ${i % 3}, ${i % 4}), (${i % 5}, ${(i % 3) + 0.5}, ${i % 4}))`);
  for (let i = 0; i < 50; i++) lines.push(`k${i} = Cube((${(i % 8) - 4}, ${Math.floor(i / 8) - 3}, 0), (${(i % 8) - 3.4}, ${Math.floor(i / 8) - 3}, 0), (${(i % 8) - 4}, ${Math.floor(i / 8) - 2}, 0))`);
  return lines;
}

const best = (runs: number, fn: () => void): number => {
  let b = Infinity;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    b = Math.min(b, performance.now() - t);
  }
  return b;
};

describe('the 3D figure (R5.1)', () => {
  it('a 200-line 3D figure applies in under 200 ms, one line in under 1 ms', () => {
    const lines = figure500().slice(0, 200);
    const t = best(5, () => {
      const app = createHeadlessApp({ mode: 'graphing3d' });
      const r = app.runBatch(lines);
      if (!r.ok) throw new Error('batch failed');
    });
    const app = createHeadlessApp({ mode: 'graphing3d', script: figure500().join('\n') });
    let k = 0;
    const one = best(200, () => void app.run(`P0 = (${k++ % 5}, 1, 2)`));
    const cut = best(50, () => void app.run(`cut = Intersect(Plane((0, 0, ${(k++ % 5) * 0.1 + 0.2}), Vector(0, 0, 1)), k0)`));
    console.log(`200 lines: ${t.toFixed(1)} ms; one point line with 500 objects: ${one.toFixed(3)} ms; a cube section: ${cut.toFixed(3)} ms`);
    expect(t).toBeLessThan(200);
    expect(one).toBeLessThan(1);
    expect(cut).toBeLessThan(1);
  });
});

describe('the Space view (R5.2)', () => {
  const app = createHeadlessApp({ mode: 'graphing3d', script: figure500().join('\n') });
  const view = space.viewOf(app.figure);

  it('holds 500 objects', () => {
    expect(app.list().length).toBe(500);
  });

  it('a frame of 500 objects in under 16 ms; a pick in under 0.5 ms', () => {
    let hits: ReturnType<typeof paintSpace>['hits'] = [];
    const frame = best(10, () => {
      hits = paintSpace(NULL_CTX, view, 1000, 700, sceneOf3(app.figure, view)).hits;
    });
    let n = 0;
    const pick = best(200, () => void pick3(hits, 300 + (n++ % 400), 200 + (n % 300)));
    console.log(`frame: ${frame.toFixed(2)} ms with ${hits.length} hit areas; pick: ${pick.toFixed(3)} ms`);
    expect(frame).toBeLessThan(16);
    expect(pick).toBeLessThan(0.5);
  });
});

describe('surfaces and particles (.kiro/specs/space-3d-surfaces R4.2)', () => {
  it('a 40 × 40 surface meshes in under 8 ms; 2,000 particles and a surface paint in under 16 ms', () => {
    const app = createHeadlessApp({
      mode: 'graphing3d',
      script: [
        'f(x, y) = sin(sqrt(x^2 + y^2) * 1.5 - 2t) / (1 + 0.1 * (x^2 + y^2))',
        'stars = Particles(count = 2000, life = 6, pos = ((0.5 + 4 * u) * cos(6 * u + t), (0.5 + 4 * u) * sin(6 * u + t), 3 + 0.3 * (w - 0.5)), size = 0.04)',
      ].join('\n'),
    });
    app.clock.seek(1.5);
    const view = space.viewAt(app.figure);
    const surfaceOnly = createHeadlessApp({ mode: 'graphing3d', script: 'f(x, y) = sin(x) * cos(y)\nspace with axes = false, floor = false, grid = false' });
    const mesh = best(10, () => void sceneOf3(surfaceOnly.figure, space.viewOf(surfaceOnly.figure)));
    const frame = best(8, () => void paintSpace(NULL_CTX, view, 1000, 700, sceneOf3(app.figure, view)));
    console.log(`surface mesh (1,600 cells): ${mesh.toFixed(2)} ms; frame with 2,000 particles and the surface: ${frame.toFixed(2)} ms`);
    expect(mesh).toBeLessThan(8);
    expect(frame).toBeLessThan(16);
  });
});
