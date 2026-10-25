import { describe, expect, it } from 'vitest';
import type { Graph3D, Inc } from '../src/api/types';
import { kit } from '../src/kits/space3d';
import type { Graph3DApi } from '../src/kits/space3d/graph';
import { SceneRuntime } from '../src/runtime/runtime';

/** A graph whose scene puts the camera at yaw 30 on every frame, as a scene tying the camera to a slider does. */
function pinned(more: (g: Graph3D, inc: Inc) => void = () => {}) {
  const runtime = new SceneRuntime({ autoplay: false, kits: { space3d: kit } });
  let graph: Graph3D | null = null;
  runtime.mount((inc) => {
    graph = inc.graph3d('#g', { title: 'Graph', x: [-1, 1], y: [-1, 1], z: [-1, 1] });
    graph.curve((t) => [Math.cos(t), Math.sin(t), t / 7], { t: [0, 7] });
    inc.onFrame(() => graph!.camera({ yaw: 30 }));
    more(graph, inc);
  });
  runtime.tick(0);
  const stage = runtime.graph.stages[0]!.id;
  const yaw = () => (graph as unknown as Graph3DApi).engine.camera.state.yaw;
  const frame = () => runtime.tick(16);
  return { runtime, stage, yaw, frame };
}

describe('the learner holds the 3D view', () => {
  it('keeps a turn the learner made, though the scene sets the camera every frame', () => {
    const { runtime, stage, yaw, frame } = pinned();
    expect(yaw()).toBe(30);
    runtime.view(stage, { kind: 'orbit', dx: 0.25, dy: 0 });
    frame();
    frame();
    const turned = yaw();
    expect(turned).not.toBe(30);
    // Zooming and panning hold it too, and do not turn it back.
    runtime.view(stage, { kind: 'zoom', x: 320, y: 220, factor: 1.2 });
    frame();
    expect(yaw()).toBe(turned);
  });

  it('gives the camera back to the scene on Reset', () => {
    const { runtime, stage, yaw, frame } = pinned();
    runtime.view(stage, { kind: 'orbit', dx: 0.25, dy: 0 });
    frame();
    runtime.view(stage, { kind: 'reset' });
    frame();
    expect(yaw()).toBe(30);
  });

  it('gives the camera back when the scene asks for a different view, as when the learner moves a control', () => {
    const runtime = new SceneRuntime({ autoplay: false, kits: { space3d: kit } });
    let graph: Graph3D | null = null;
    runtime.mount((inc) => {
      const turn = inc.param('turn', { min: 0, max: 90, step: 1, value: 30 });
      graph = inc.graph3d('#g', { title: 'Graph', x: [-1, 1], y: [-1, 1], z: [-1, 1] });
      inc.onFrame(() => graph!.camera({ yaw: turn.value }));
    });
    runtime.tick(0);
    const yaw = () => (graph as unknown as Graph3DApi).engine.camera.state.yaw;
    runtime.view(runtime.graph.stages[0]!.id, { kind: 'orbit', dx: 0.25, dy: 0 });
    runtime.tick(16);
    const turned = yaw();
    expect(turned).not.toBe(30);
    runtime.tick(16);
    expect(yaw()).toBe(turned);
    runtime.setParam('turn', 60);
    runtime.tick(16);
    expect(yaw()).toBe(60);
  });

  it('lets the scene move the camera until the learner touches it', () => {
    const { yaw, frame } = pinned();
    frame();
    frame();
    expect(yaw()).toBe(30);
  });
});
