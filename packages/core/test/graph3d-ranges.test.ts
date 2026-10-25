import { describe, expect, it } from 'vitest';
import type { Graph3D, Graph3DOptions, Inc, Object3D, Param } from '../src/api/types';
import { kit } from '../src/kits/space3d';
import { itemOf } from '../src/kits/space3d/space';
import { SceneRuntime } from '../src/runtime/runtime';

/** A graph with a parameter `top` (5 to 40 in steps of 1, starting at 10) that its options and build may read. */
function graph(options: (top: Param) => Partial<Graph3DOptions>, build: (g: Graph3D, top: Param, inc: Inc) => void) {
  const runtime = new SceneRuntime({ autoplay: false, kits: { space3d: kit } });
  const mount = runtime.mount((inc) => {
    const top = inc.param('top', { min: 5, max: 40, step: 1, value: 10 });
    build(inc.graph3d('#g', { title: 'Graph', x: [-1, 1], y: [-1, 1], z: [0, 10], ...options(top) }), top, inc);
  });
  runtime.tick(0);
  const set = (value: number) => {
    runtime.setParam('top', value);
    runtime.tick(0);
  };
  return { runtime, mount, set };
}

const item = (o: Object3D | null) => itemOf(o, 'test');
const geometry = (o: Object3D | null) => item(o).geometry as { points?: number[][]; to?: number[] };
const texts = (runtime: SceneRuntime) => [...runtime.graph.nodes.values()].filter((n) => n.kind === 'text' && !n.hidden).map((n) => n.text);

describe('graph3d ranges that follow a parameter', () => {
  it('lengthens a curve whose t range reads a parameter', () => {
    let helix: Object3D | null = null;
    const { mount, set } = graph(
      () => ({ z: [0, 40] }),
      (g, top) => (helix = g.curve((t) => [Math.cos(t), Math.sin(t), t], { t: [0, () => top.value] })),
    );
    expect(mount.ui.error).toBeNull();
    // World z runs -1 to 1 over the box's 0 to 40.
    expect(geometry(helix).points!.at(-1)![2]).toBeCloseTo(-0.5, 6);
    set(30);
    expect(geometry(helix).points!.at(-1)![2]).toBeCloseTo(0.5, 6);
  });

  it('rescales the box, placing fixed points, lines, vectors and labels again, with new ticks', () => {
    const made: Object3D[] = [];
    const { runtime, set } = graph(
      (top) => ({ z: [0, () => top.value] }),
      (g) => {
        made.push(g.point([0, 0, 5]), g.line([[0, 0, 0], [0, 0, 5]]), g.vector([0, 0, 0], [0, 0, 5]));
        g.label([0, 0, 5], 'half');
      },
    );
    const [p, line, arrow] = made;
    // Halfway up a 0 to 10 box is world z 0.
    expect(item(p!).position[2]).toBeCloseTo(0, 6);
    expect(texts(runtime)).toContain('10');
    set(20);
    // Now 5 is a quarter of the way up a 0 to 20 box.
    expect(item(p!).position[2]).toBeCloseTo(-0.5, 6);
    expect(geometry(line!).points![1]![2]).toBeCloseTo(-0.5, 6);
    expect(geometry(arrow!).to![2]).toBeCloseTo(-0.5, 6);
    expect(texts(runtime)).toEqual(expect.arrayContaining(['20', 'half']));
    expect(texts(runtime)).not.toContain('6');
  });

  it('grows the box to hold a curve that stretches past it, and shrinks it back', () => {
    const made: Object3D[] = [];
    const { runtime, set } = graph(
      () => ({}),
      (g, top) => {
        made.push(g.curve((t) => [0, 0, t], { t: [0, () => top.value] }), g.point([0, 0, 5]));
      },
    );
    const [line, p] = made;
    // 0 to 10 fits the box as given.
    expect(item(p!).position[2]).toBeCloseTo(0, 6);
    set(20);
    // The box now runs 0 to 20: the curve ends at its top, and 5 is a quarter of the way up.
    expect(geometry(line!).points!.at(-1)![2]).toBeCloseTo(1, 6);
    expect(item(p!).position[2]).toBeCloseTo(-0.5, 6);
    expect(texts(runtime)).toContain('20');
    set(8);
    expect(item(p!).position[2]).toBeCloseTo(0, 6);
    expect(texts(runtime)).toContain('10');
    expect(texts(runtime)).not.toContain('20');
  });

  it('leaves the box alone for a curve with a fixed range', () => {
    let line: Object3D | null = null;
    graph(
      () => ({}),
      (g) => (line = g.curve((t) => [0, 0, t], { t: [0, 20] })),
    );
    expect(geometry(line).points!.at(-1)![2]).toBeCloseTo(3, 6);
  });

  it('keeps the last good range when a function returns something that is not one', () => {
    let line: Object3D | null = null;
    const { set } = graph(
      () => ({}),
      (g, top) => (line = g.curve((t) => [0, 0, t], { t: [() => top.value - 5, 6] })),
    );
    // 5 to 6 at first; 15 to 6 is not a range, so it stays 5 to 6.
    set(20);
    expect(geometry(line).points![0]![2]).toBeCloseTo(0, 6);
  });

  it('turns away ranges that are not [min, max]', () => {
    expect(graph(() => ({ z: [5, 1] }), () => {}).mount.ui.error?.message).toMatch(/min below max/);
    expect(graph(() => ({ z: [0, 'ten' as unknown as number] }), () => {}).mount.ui.error?.message).toMatch(/either end may be a function/);
    expect(graph((top) => ({ z: [0, () => top.value] }), () => {}).mount.ui.error).toBeNull();
  });
});
