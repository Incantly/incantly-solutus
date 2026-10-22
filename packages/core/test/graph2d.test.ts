import { describe, expect, it } from 'vitest';
import type { Inc } from '../src/api/types';
import { niceStep, ticks } from '../src/graph2d/graph';
import { pathPoints } from '../src/scene/bounds';
import { SceneRuntime } from '../src/runtime/runtime';

function run(scene: (inc: Inc) => void) {
  const runtime = new SceneRuntime({ autoplay: false });
  const mount = runtime.mount(scene);
  const frame = runtime.tick(1 / 60);
  return { runtime, mount, frame };
}

const pathData = (runtime: SceneRuntime, id: number) => runtime.graph.nodes.get(id)?.attrs.get('d') ?? '';

describe('graph2d', () => {
  it('clips the plot area and draws axes, grid and tick labels', () => {
    const { mount, runtime } = run((inc) => {
      inc.graph2d('#g', { x: [-5, 5], y: [-2, 2], title: 'Axes', labels: { x: 'x', y: 'y' } });
    });
    const stage = mount.commands[0];
    expect(stage).toMatchObject({ op: 'stage', selector: '#g', viewBox: [0, 0, 760, 380], clip: [52, 20, 688, 320] });
    const texts = [...runtime.graph.nodes.values()].filter((n) => n.kind === 'text').map((n) => n.text);
    expect(texts).toEqual(expect.arrayContaining(['-4', '-2', '2', '4', '-1', '1', '0', 'x', 'y']));
    expect(runtime.graph.size).toBeLessThan(60);
  });

  it('maps data coordinates to the plot area', () => {
    let toX = (_x: number) => 0;
    let toY = (_y: number) => 0;
    run((inc) => {
      const g = inc.graph2d('#g', { x: [0, 10], y: [0, 10], title: 'Map' });
      toX = (x) => g.toX(x);
      toY = (y) => g.toY(y);
    });
    expect(toX(0)).toBe(52);
    expect(toX(10)).toBe(740);
    expect(toY(10)).toBe(20);
    expect(toY(0)).toBe(340);
  });

  it('lets a scene take a graph or stage method off it and call it alone', () => {
    // Once a lens scene wrote const X = graph.toX and threw on its first X(0).
    let mapped: number[] = [];
    const { mount } = run((inc) => {
      const g = inc.graph2d('#g', { x: [0, 10], y: [0, 10], title: 'Map' });
      const X = g.toX;
      const { toY } = g;
      const line = g.stage.line;
      line(X(0), toY(0), X(10), toY(10), { tone: 'a' });
      const s = inc.svg('#s', { viewBox: [0, 0, 100, 100], title: 'Stage' });
      const { circle } = s;
      circle(50, 50, 4);
      mapped = [X(0), X(10), toY(10)];
    });
    expect(mount.ui.error).toBeNull();
    expect(mapped).toEqual([52, 740, 20]);
  });

  it('plots a formula, shows its source and redraws when a parameter changes', () => {
    let curveId = 0;
    const { runtime } = run((inc) => {
      const A = inc.param('A', { min: 1, max: 3, step: 1, value: 1 });
      const g = inc.graph2d('#g', { x: [-3, 3], y: [-4, 4], title: 'Wave' });
      const wave = inc.formula('A*sin(x)', { vars: { A } });
      curveId = (g.plot(wave).handle as unknown as { node: { id: number } }).node.id;
    });
    const texts = [...runtime.graph.nodes.values()].filter((n) => n.kind === 'text').map((n) => n.text);
    expect(texts).toContain('y = A*sin(x)');
    const before = pathData(runtime, curveId);
    expect(before.startsWith('M')).toBe(true);
    runtime.setParam('A', 3);
    const update = runtime.tick(1 / 60);
    expect(update.commands.some((c) => c.op === 'attr' && c.id === curveId && c.name === 'd')).toBe(true);
    expect(pathData(runtime, curveId)).not.toBe(before);
  });

  it('caps samples at 500 and breaks the curve at asymptotes', () => {
    let curveId = 0;
    const { runtime } = run((inc) => {
      const g = inc.graph2d('#g', { x: [-3, 3], y: [-4, 4], title: 'Tangent' });
      curveId = (g.plot((x: number) => Math.tan(x), { samples: 10_000 }).handle as unknown as { node: { id: number } }).node.id;
    });
    const d = pathData(runtime, curveId);
    expect(pathPoints(d).length).toBeLessThanOrEqual(501);
    expect((d.match(/M/g) ?? []).length).toBeGreaterThanOrEqual(3); // tan has two asymptotes in [-3, 3]
    expect(runtime.graph.diagnostics.some((diag) => diag.kind === 'samples-capped')).toBe(true);
  });

  it('moves points, segments, arrows and trails in data coordinates', () => {
    const { runtime } = run((inc) => {
      const g = inc.graph2d('#g', { x: [0, 10], y: [0, 10], title: 'Marks' });
      const p = g.point(0, 0);
      const t = g.trail({ max: 3 });
      const a = g.arrow(0, 0, 1, 1);
      inc.onFrame(() => {
        p.at(5, 5);
        for (const x of [1, 2, 3, 4]) t.add(x, x);
        a.from(1, 1, 2, 0);
      });
    });
    const circle = [...runtime.graph.nodes.values()].find((n) => n.kind === 'circle')!;
    expect(circle.attrs.get('cx')).toBe('396');
    const trail = [...runtime.graph.nodes.values()].find((n) => n.kind === 'polyline')!;
    expect(trail.attrs.get('points')?.split(' ')).toHaveLength(3);
  });

  it('rejects invalid ranges and missing titles', () => {
    expect(run((inc) => void inc.graph2d('#g', { x: [1, 0], y: [0, 1], title: 'x' })).mount.ui.error?.message).toContain(
      'min < max',
    );
    expect(run((inc) => void inc.graph2d('#g', { x: [0, 1], y: [0, 1], title: '' })).mount.ui.error?.message).toContain(
      'needs a title',
    );
  });
});

describe('ticks', () => {
  it.each([
    [10, 6, 2],
    [1, 6, 0.2],
    [100, 6, 20],
    [8, 5, 2],
  ])('niceStep(%d, %d) = %d', (span, target, step) => {
    expect(niceStep(span, target)).toBeCloseTo(step, 12);
  });

  it('lists ticks without floating-point noise', () => {
    expect(ticks(-1, 1, 0.2)).toEqual([-1, -0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1]);
  });
});
