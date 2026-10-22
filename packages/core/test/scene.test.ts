import { describe, expect, it } from 'vitest';
import type { SceneCommand } from '../src/protocol/scene-commands';
import { stageBounds, pathPoints } from '../src/scene/bounds';
import { geometry } from '../src/scene/geometry';
import { SceneGraph } from '../src/scene/graph';
import { PartRegistry, StageHandle } from '../src/scene/handles';
import { MAX_SAMPLES, createPathHelpers } from '../src/scene/path';

function setup() {
  const graph = new SceneGraph();
  const parts = new PartRegistry(graph);
  const node = graph.createStage('#stage', [0, 0, 760, 360], 'Test', 'A test stage');
  const stage = new StageHandle(graph, node, [0, 0, 760, 360], parts);
  return { graph, parts, stage };
}

const ops = (commands: SceneCommand[]) => commands.map((c) => c.op);

describe('scene graph', () => {
  it('emits a stage command and creation commands', () => {
    const { graph, stage } = setup();
    stage.circle(10, 20, 5, { tone: 'hi' });
    const commands = graph.flush();
    expect(ops(commands)).toEqual(['stage', 'create', 'class', 'attr', 'attr', 'attr']);
    expect(commands[2]).toEqual({ op: 'class', id: 2, value: 'inc-tone-hi' });
  });

  it('writes an attribute only when its value changes', () => {
    const { graph, stage } = setup();
    const ball = stage.circle(10, 20, 5);
    graph.flush();
    ball.set({ cx: 10, cy: 20 });
    expect(graph.flush()).toEqual([]);
    ball.set({ cx: 11 });
    expect(graph.flush()).toEqual([{ op: 'attr', id: 2, name: 'cx', value: '11' }]);
  });

  it('rounds numbers to two decimals so tiny jitter costs nothing', () => {
    const { graph, stage } = setup();
    const ball = stage.circle(10, 20, 5);
    graph.flush();
    ball.set({ cx: 10.0001 });
    expect(graph.flush()).toEqual([]);
  });

  it('records non-finite values as diagnostics instead of writing them', () => {
    const { graph, stage } = setup();
    const ball = stage.circle(10, 20, 5);
    graph.flush();
    ball.set({ cx: Number.NaN });
    ball.at(Infinity, 0);
    expect(graph.flush()).toEqual([]);
    expect(graph.diagnostics.map((d) => d.kind)).toEqual(['non-finite', 'non-finite']);
  });

  it('rejects colours and unknown attributes', () => {
    const { stage } = setup();
    const ball = stage.circle(1, 1, 1);
    expect(() => ball.set({ fill: 'red' } as never)).toThrow('Colours come from tones');
    expect(() => ball.set({ onclick: 'x' } as never)).toThrow('Unknown attribute "onclick"');
  });

  it('rejects attribute values that are not plain geometry', () => {
    const { stage } = setup();
    const p = stage.path();
    expect(() => p.d('M0 0 url(javascript:alert(1))')).toThrow('not plain geometry');
    expect(() => p.set({ 'stroke-dasharray': '<script>' })).toThrow('not plain geometry');
  });

  it('composes translate, rotate and scale into one transform', () => {
    const { graph, stage } = setup();
    const g = stage.group();
    graph.flush();
    g.at(10, 20).rotate(45, 1, 2).scale(2);
    const last = graph.flush().at(-1);
    expect(last).toEqual({ op: 'attr', id: 2, name: 'transform', value: 'translate(10 20) rotate(45 1 2) scale(2 2)' });
    g.at(0, 0).rotate(0).scale(1);
    expect(graph.flush().at(-1)).toEqual({ op: 'attr', id: 2, name: 'transform', value: null });
  });

  it('tracks tone, dashed and hidden as one class string', () => {
    const { graph, stage } = setup();
    const line = stage.line(0, 0, 1, 1);
    graph.flush();
    line.tone('lit').dashed().hide();
    expect(graph.flush()).toEqual([
      { op: 'class', id: 2, value: 'inc-tone-lit' },
      { op: 'class', id: 2, value: 'inc-tone-lit inc-dashed' },
      { op: 'class', id: 2, value: 'inc-tone-lit inc-dashed inc-hidden' },
    ]);
    line.hide().tone('lit');
    expect(graph.flush()).toEqual([]);
  });

  it('nests elements in groups on the same stage only', () => {
    const { graph, stage } = setup();
    const g = stage.group({ layer: 'front' });
    const dot = stage.circle(0, 0, 1, { parent: g });
    expect(graph.nodes.get(3)?.layer).toBe('front');
    expect(() => stage.circle(0, 0, 1, { parent: dot })).toThrow('must be a group');
    expect(() => stage.circle(0, 0, 1, { parent: {} as never })).toThrow('Expected an element the SDK made');
  });

  it('says why dots cannot stand where an element is needed, and what can', () => {
    // Once a diffusion scene registered its particles, drawn as dots, as a part, and threw at mount.
    const { stage } = setup();
    const dots = stage.dots({ tone: 'a' });
    expect(() => stage.part('particles', dots as never)).toThrow('Dots and fluids are drawn on a canvas, not as an element, so they cannot be a part');
    expect(() => stage.part('particles', dots as never)).toThrow('the region they move in (stage.rect with fill: false)');
    expect(() => stage.part('particles', {} as never)).toThrow('Expected an element the SDK made');
  });

  it('registers named parts once, and renames an element registered again', () => {
    const { graph, parts, stage } = setup();
    const ball = stage.part('Ball', stage.circle(1, 1, 1), { label: 'Projectile', info: 'It flies.' });
    expect(parts.parts.get('Ball')?.label).toBe('Projectile');
    expect(graph.flush().at(-1)).toEqual({ op: 'part', id: 2, name: 'Ball', label: 'Projectile', info: 'It flies.' });
    // Two elements cannot share a name.
    expect(() => stage.part('Ball', stage.circle(2, 2, 1))).toThrow('registered twice');
    // The same element again takes the later name, label and info, as a later drag replaces an earlier.
    stage.part('Shot', ball, { label: 'Shot', info: 'It flies far.' });
    expect([...parts.parts.keys()]).toEqual(['Shot']);
    expect(graph.flush().at(-1)).toEqual({ op: 'part', id: 2, name: 'Shot', label: 'Shot', info: 'It flies far.' });
  });

  it('rejects stage selectors that are not ids and repeated stages', () => {
    const graph = new SceneGraph();
    expect(() => graph.createStage('.stage', [0, 0, 1, 1], 't', '')).toThrow('must be an element id');
    expect(() => graph.createStage('#s', [0, 0, 0, 1], 't', '')).toThrow('positive width');
    graph.createStage('#s', [0, 0, 1, 1], 't', '');
    expect(() => graph.createStage('#s', [0, 0, 1, 1], 't', '')).toThrow('already exists');
  });

  it('rebuilds the scene from a snapshot of commands', () => {
    const { graph, stage } = setup();
    stage.circle(1, 2, 3, { tone: 'hi' });
    stage.text(5, 5, 'Label');
    graph.flush();
    const snapshot = graph.snapshotCommands();
    expect(ops(snapshot)).toEqual(['stage', 'create', 'class', 'attr', 'attr', 'attr', 'create', 'attr', 'attr', 'text']);
  });
});

describe('path helpers', () => {
  const path = createPathHelpers();

  it('starts a new subpath at discontinuities, so 1/x is never bridged', () => {
    const d = path.curve((x) => 1 / x, -2, 2, 4);
    expect(d).toBe('M-2 -0.5L-1 -1 M1 1L2 0.5');
    expect(d.match(/M/g)).toHaveLength(2);
  });

  it('caps samples at the contract limit and reports it', () => {
    const capped: number[] = [];
    const helpers = createPathHelpers((n) => capped.push(n));
    const d = helpers.curve((x) => x, 0, 1, 10_000);
    expect(d.split('L')).toHaveLength(MAX_SAMPLES + 1);
    expect(capped).toEqual([10_000]);
  });

  it('maps samples through a coordinate function', () => {
    expect(path.curve((x) => x * 2, 0, 1, 1, (x, y) => [x * 10, -y])).toBe('M0 0L10 -2');
  });

  it('draws arrows with a head and nothing for zero length', () => {
    expect(path.arrow(0, 0, 10, 0, 4)).toMatch(/^M0 0L10 0 M/);
    expect(path.arrow(0, 0, 0, 0)).toBe('');
  });

  it('samples arcs and parametric curves', () => {
    expect(path.arc(0, 0, 1, 0, Math.PI).startsWith('M1 0')).toBe(true);
    expect(path.param((t) => t, (t) => t * t, 0, 1, 2)).toBe('M0 0L0.5 0.25L1 1');
  });
});

describe('geometry helpers', () => {
  const g = geometry;
  const bounds = [0, 0, 100, 50] as const;

  it('intersects lines and detects parallels', () => {
    const p = g.intersect(g.lineThrough(g.point(0, 0), g.point(10, 10)), g.lineThrough(g.point(0, 10), g.point(10, 0)));
    expect(p).toEqual({ x: 5, y: 5 });
    expect(g.intersect(g.lineThrough(g.point(0, 0), g.point(1, 0)), g.lineThrough(g.point(0, 1), g.point(1, 1)))).toBeNull();
  });

  it('clips a ray to the stage starting at its origin', () => {
    const seg = g.clipRay(g.point(10, 25), g.point(20, 25), bounds);
    expect(seg).toEqual({ from: { x: 10, y: 25 }, to: { x: 100, y: 25 } });
    expect(g.clipRay(g.point(10, 25), g.point(0, 25), bounds)).toEqual({ from: { x: 10, y: 25 }, to: { x: 0, y: 25 } });
    expect(g.clipRay(g.point(150, 25), g.point(200, 25), bounds)).toBeNull();
  });

  it('clips an infinite line to the stage in both directions', () => {
    expect(g.clipLine(g.point(10, 25), g.point(20, 25), bounds)).toEqual({ from: { x: 0, y: 25 }, to: { x: 100, y: 25 } });
  });

  it('computes midpoints and distances', () => {
    expect(g.midpoint(g.point(0, 0), g.point(4, 2))).toEqual({ x: 2, y: 1 });
    expect(g.distance(g.point(0, 0), g.point(3, 4))).toBe(5);
  });
});

describe('stage bounds', () => {
  it('applies nested transforms and skips hidden elements', () => {
    const { graph, stage } = setup();
    const g = stage.group().at(100, 50);
    stage.circle(0, 0, 10, { parent: g });
    stage.rect(0, 0, 10, 10).hide();
    const bounds = stageBounds(graph, 1);
    expect(bounds.visibleElements).toBe(1);
    expect(bounds.box).toEqual({ minX: 90, minY: 40, maxX: 110, maxY: 60 });
  });

  it('rotates boxes about their centre', () => {
    const { graph, stage } = setup();
    stage.line(-10, 0, 10, 0).rotate(90);
    const box = stageBounds(graph, 1).box!;
    expect(box.minY).toBeCloseTo(-10, 9);
    expect(box.maxY).toBeCloseTo(10, 9);
    expect(box.maxX - box.minX).toBeCloseTo(0, 9);
  });

  it('reads coordinates from path data, relative commands included', () => {
    expect(pathPoints('M0 0 l10 5 h5 v-5 Z')).toEqual([
      [0, 0],
      [10, 5],
      [15, 5],
      [15, 0],
    ]);
  });

  it('reports no box for an empty stage', () => {
    const { graph } = setup();
    expect(stageBounds(graph, 1)).toMatchObject({ box: null, visibleElements: 0 });
  });

  it('estimates an equation around its point: taller when a fraction stacks, to one side when anchored (DG-5)', () => {
    const { graph, stage } = setup();
    const law = stage.equation(380, 40, 'F = G*m1*m2/r^2', { size: 20 });
    const centred = stageBounds(graph, 1).box!;
    expect((centred.minX + centred.maxX) / 2).toBeCloseTo(380, 6);
    expect((centred.minY + centred.maxY) / 2).toBeCloseTo(40, 6);
    expect(centred.maxY - centred.minY).toBeCloseTo(48, 6);
    law.set({ 'text-anchor': 'start' });
    expect(stageBounds(graph, 1).box!.minX).toBe(380);
    law.text('F = m*a');
    expect(stageBounds(graph, 1).box!.maxY - stageBounds(graph, 1).box!.minY).toBeCloseTo(26, 6);
  });
});

describe('glow (FX-1)', () => {
  it('marks a glowing element with a class, and dots with a glowing flag', () => {
    const { graph, stage } = setup();
    const lamp = stage.circle(10, 10, 5, { tone: 'lit', glow: true });
    expect(graph.flush()).toContainEqual({ op: 'class', id: 2, value: 'inc-tone-lit inc-glow' });
    lamp.glow(false);
    expect(graph.flush()).toEqual([{ op: 'class', id: 2, value: 'inc-tone-lit' }]);
    stage.dots({ glow: true }).set([[1, 1]]);
    expect(graph.flush()).toContainEqual(expect.objectContaining({ op: 'dots', glow: true, points: [1, 1] }));
  });
});

describe('equations (DG-5)', () => {
  it('draw as a math element on the labels layer, centred, 16 units by default', () => {
    const { graph, stage } = setup();
    stage.equation(100, 50, 'E = m*c^2', { tone: 'a' });
    const commands = graph.flush();
    expect(commands).toContainEqual({ op: 'create', id: 2, kind: 'math', parent: 1, layer: 'labels' });
    expect(commands).toContainEqual({ op: 'attr', id: 2, name: 'text-anchor', value: 'middle' });
    expect(commands).toContainEqual({ op: 'attr', id: 2, name: 'font-size', value: '16' });
    expect(commands).toContainEqual({ op: 'text', id: 2, value: 'E = m*c^2' });
    expect(() => stage.equation(0, 0, 'x', { anchor: 'left' as never })).toThrow(/'start', 'middle' or 'end'/);
    expect(() => stage.equation(0, 0, 'x', { size: 0 })).toThrow(/from 0 to 200/);
  });
});

describe('handles that stand for their elements', () => {
  it('lets a graph item stand for its handle, gives every element a handle, and names what it needs when neither fits', async () => {
    const { SceneRuntime } = await import('../src/runtime/runtime');
    const runtime = new SceneRuntime({ autoplay: false });
    runtime.mount((inc) => {
      const graph = inc.graph2d('#s', { x: [0, 10], y: [0, 10], title: 'G' });
      const point = graph.point(1, 1);
      const label = graph.label(2, 2, 'two');
      graph.stage.part('Point', point as never, { label: 'Point' });
      graph.stage.part('Label', label.handle, { label: 'Label' });
      expect(label.handle).toBe(label);
      expect(inc.path.polyline([[0, 0], [1, 1]])).toBe(inc.path.line([[0, 0], [1, 1]]));
      expect(inc.shapes.resistor(0, 0, 10, 0)).toBe(inc.shapes.zigzag(0, 0, 10, 0));
    });
    expect(runtime.uiState().parts.map((p) => p.name).sort()).toEqual(['Label', 'Point']);
    // A handle at numbers sets no parameter: graph.drag gives it a map, or the mount says what it needs.
    const mapped = new SceneRuntime({ autoplay: false });
    mapped.mount((inc) => {
      inc.param('speed', { min: 0, max: 10, value: 5 });
      const graph = inc.graph2d('#s', { x: [0, 10], y: [0, 10], title: 'G' });
      const tip = graph.handle({ x: 0, y: 0, label: 'the arrow tip' });
      graph.drag(tip, (p) => ({ speed: p.x }));
      tip.hide().show();
    });
    expect(mapped.isMounted).toBe(true);
    const unmapped = new SceneRuntime({ autoplay: false });
    unmapped.mount((inc) => {
      const graph = inc.graph2d('#s', { x: [0, 10], y: [0, 10], title: 'G' });
      graph.handle({ x: 1, y: 2, label: 'the tip' });
    });
    const thrown = unmapped.uiState().error?.message ?? '';
    expect(unmapped.isMounted).toBe(false);
    expect(thrown).toContain('graph.handle at numbers sets no parameter, so "the tip" needs a map: graph.drag(handle, (p) => ({ name: p.x }))');
  });
});
