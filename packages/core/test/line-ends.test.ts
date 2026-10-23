import { describe, expect, it } from 'vitest';
import type { Inc, Stage } from '../src/api/types';
import { kit } from '../src/kits/space3d';
import { loadKitModules } from '../src/kits/load';
import { looseLineEnds, offlineChecks } from '../src/probe/offline';
import { SceneRuntime } from '../src/runtime/runtime';
import { REFERENCE_SCENES } from '../src/scenes';
import { flattenPath } from '../src/scene/outline';
import { validateScene } from '../src/validation';
import { compileValidated } from './helpers/compile';

/**
 * The line-end check (CH-2): in a diagram every plain line ends on a shape,
 * another line, a dot, a label or the edge of the stage, never in mid-air.
 */

function ends(build: (stage: Stage, inc: Inc) => void) {
  const runtime = new SceneRuntime({ autoplay: false, kits: { space3d: kit } });
  runtime.mount((inc) => build(inc.svg('#stage', { viewBox: [0, 0, 600, 340], title: 'Diagram' }), inc));
  runtime.tick(0);
  return looseLineEnds(runtime).map((end) => end.at);
}

/** A battery, a resistor and the wires between them; `gap` stops the top wire short of the resistor. */
const circuit = (gap: number) => (stage: Stage, inc: Inc) => {
  stage.path(inc.shapes.battery(110, 120, 110, 230, { cells: 2 }), { tone: 'hi' });
  stage.path(inc.shapes.zigzag(230, 80, 370, 80, { teeth: 7, width: 10 }), { tone: 'hi' });
  stage.path(`M110 120V80H${230 - gap}M370 80H490V270H110V230`, { tone: 'mid' });
};

describe('the line-end check (CH-2)', () => {
  it('passes a circuit whose wires join everything, and finds the wire that stops short', () => {
    expect(ends(circuit(0))).toEqual([]);
    // The wire ends in mid-air, and so does the resistor it no longer reaches.
    expect(ends(circuit(20))).toEqual([
      [230, 80],
      [210, 80],
    ]);
  });

  it('finds a leader that stops short of its label, and a lone line', () => {
    const leader = (gap: number) => (stage: Stage) => {
      stage.circle(150, 170, 30, { tone: 'a' });
      stage.line(175, 155, 300 - gap, 100, { tone: 'lo' });
      stage.text(305, 100, 'Nucleus', { tone: 'hi' });
    };
    expect(ends(leader(0))).toEqual([]);
    expect(ends(leader(40))).toEqual([[260, 100]]);
    expect(ends((stage) => stage.line(200, 150, 300, 190, { tone: 'mid' }))).toEqual([
      [200, 150],
      [300, 190],
    ]);
  });

  it('lets a floor, a ceiling or a track end anywhere, and lines run off the edge', () => {
    // A pendulum hangs from a ceiling, a block sits on a floor, a knob slides on a track.
    const scene = (stage: Stage) => {
      stage.line(250, 40, 350, 40, { tone: 'mid' });
      stage.line(300, 40, 340, 180, { tone: 'lo' });
      stage.circle(340, 180, 14, { tone: 'a' });
      stage.line(60, 300, 540, 300, { tone: 'mid' });
      stage.rect(100, 260, 60, 40, { tone: 'b', fill: true });
      stage.line(400, 80, 520, 80, { tone: 'faint' });
      stage.circle(450, 80, 8, { tone: 'lit' });
      // A ray to the edge of the stage.
      stage.line(340, 180, 600, 230, { tone: 'c' });
    };
    expect(ends(scene)).toEqual([]);
  });

  it('leaves arrows, dashed guides, curves and symbols alone', () => {
    const scene = (stage: Stage, inc: Inc) => {
      // A force in free space ends in its head; a guide may stop anywhere.
      stage.path(inc.path.arrow({ from: [100, 100], by: [80, 0] }), { tone: 'a' });
      stage.line(200, 50, 200, 150, { tone: 'faint', dashed: true });
      // A wave drawn in short straight pieces, and a battery's plates.
      stage.path(inc.path.curve((x: number) => 200 + 20 * Math.sin(x / 15), 250, 450, 30), { tone: 'b' });
      stage.path(inc.shapes.battery(500, 120, 500, 230, { cells: 2 }), { tone: 'hi' });
    };
    expect(ends(scene)).toEqual([]);
  });

  it('leaves graphs and 3D figures, which draw their own lines, alone', () => {
    const runtime = new SceneRuntime({ autoplay: false, kits: { space3d: kit } });
    runtime.mount((inc) => {
      const graph = inc.graph2d('#graph', { x: [-5, 5], y: [-2, 2], title: 'Graph' });
      graph.plot((x: number) => Math.sin(x), { tone: 'a' });
      const space = inc.space3d('#space', { title: 'Space' });
      space.line([[0, 0, 0], [1, 1, 1]], { tone: 'b' });
    });
    runtime.tick(0);
    expect(looseLineEnds(runtime)).toEqual([]);
  });

  it('reads path data as the browser draws it', () => {
    expect(flattenPath('M10 10h20v20H10z m5 5l5 0')).toEqual([
      { points: [[10, 10], [30, 10], [30, 30], [10, 30]], closed: true, straight: true },
      { points: [[15, 15], [20, 15]], closed: false, straight: true },
    ]);
    const [arc] = flattenPath('M0 0A10 10 0 0 1 20 0');
    // Half a circle of radius 10 through its top or bottom.
    expect(arc!.straight).toBe(false);
    expect(Math.max(...arc!.points.map(([, y]) => Math.abs(y)))).toBeCloseTo(10, 0);
    expect(arc!.points.at(-1)![0]).toBeCloseTo(20, 6);
  });

  it.each(Object.keys(REFERENCE_SCENES))('finds no loose line end in the reviewed scene %s', async (id) => {
    const source = REFERENCE_SCENES[id]!;
    const { scene, fuel } = compileValidated(source);
    const kits = await loadKitModules(validateScene(source).scene?.kits ?? []);
    const report = offlineChecks(scene, { runtime: { kits }, beforeStep: fuel.refuel, turns: [] });
    expect(report.error).toBeUndefined();
    expect(report.looseEnds).toEqual([]);
  });
});
