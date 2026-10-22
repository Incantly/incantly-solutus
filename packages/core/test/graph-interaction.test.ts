import { describe, expect, it } from 'vitest';
import type { GraphCurve, Inc } from '../src/api/types';
import { findRoots, logTicks, tickText } from '../src/graph2d/graph';
import type { SceneCommand } from '../src/protocol/scene-commands';
import { SceneRuntime } from '../src/runtime/runtime';
import { pathPoints } from '../src/scene/bounds';

function run(scene: (inc: Inc) => void, options: ConstructorParameters<typeof SceneRuntime>[0] = {}) {
  const runtime = new SceneRuntime({ autoplay: false, ...options });
  const mount = runtime.mount(scene);
  runtime.tick(1 / 60);
  return { runtime, mount };
}

const idOf = (handle: unknown) => (handle as { node: { id: number } }).node.id;
const attr = (runtime: SceneRuntime, id: number, name: string) => runtime.graph.nodes.get(id)?.attrs.get(name);
const texts = (runtime: SceneRuntime) => [...runtime.graph.nodes.values()].filter((n) => n.kind === 'text' && !n.hidden).map((n) => n.text);
const interaction = (commands: readonly SceneCommand[]) => commands.find((c) => c.op === 'interact');

describe('graph zoom and pan (G2-6)', () => {
  it('lets the kit own the view and re-ticks the axes as the learner zooms in about a point', () => {
    const { runtime, mount } = run((inc) => {
      const g = inc.graph2d('#g', { x: [-10, 10], y: [-5, 5], title: 'Zoom' });
      g.plot((x: number) => x * x / 10);
    });
    const stage = runtime.graph.stages[0]!.id;
    expect(interaction(mount.commands)).toMatchObject({ op: 'interact', zoom: 'runtime', orbit: false });
    expect(texts(runtime)).toContain('10');
    // Zoom in fourfold about the stage point of the origin (x = 0 sits at 52 + 344 = 396).
    runtime.view(stage, { kind: 'zoom', x: 396, y: 180, factor: 4 });
    runtime.tick(0);
    const now = texts(runtime);
    expect(now).not.toContain('10');
    expect(now).toEqual(expect.arrayContaining(['-2', '2']));
    expect(runtime.uiState().views).toEqual([{ id: stage, changed: true }]);
    runtime.view(stage, { kind: 'reset' });
    runtime.tick(0);
    expect(texts(runtime)).toContain('10');
    expect(runtime.uiState().views[0]!.changed).toBe(false);
  });

  it('pans by stage units, keeps points on their data, and fits the y axis to the curves', () => {
    let pointId = 0;
    const { runtime } = run((inc) => {
      const g = inc.graph2d('#g', { x: [0, 10], y: [0, 10], title: 'Pan' });
      g.plot((x: number) => 50 + x);
      pointId = idOf(g.point(5, 5).handle);
    });
    const stage = runtime.graph.stages[0]!.id;
    expect(attr(runtime, pointId, 'cx')).toBe('396');
    // Dragging the background 68.8 units right shows what was one unit to the left.
    runtime.view(stage, { kind: 'pan', dx: 68.8, dy: 0 });
    runtime.tick(0);
    expect(Number(attr(runtime, pointId, 'cx'))).toBeCloseTo(464.8, 1);
    runtime.view(stage, { kind: 'fit' });
    runtime.tick(0);
    // The curve runs from 49 to 59 across the panned range; the fitted axis shows it.
    expect(texts(runtime)).toEqual(expect.arrayContaining(['50', '52', '58']));
  });

  it('falls back to view-box zoom when the scene draws in the graph’s own coordinates', () => {
    const { mount } = run((inc) => {
      const g = inc.graph2d('#g', { x: [0, 1], y: [0, 1], title: 'Raw' });
      g.stage.circle(g.toX(0.5), g.toY(0.5), 4);
    });
    expect(interaction(mount.commands)).toMatchObject({ zoom: 'viewbox' });
  });

  it('can be switched off', () => {
    const { mount } = run((inc) => void inc.graph2d('#g', { x: [0, 1], y: [0, 1], title: 'Fixed', zoom: false }));
    expect(interaction(mount.commands)).toMatchObject({ zoom: 'none' });
  });
});

describe('tracing and handles (G2-7, G2-10)', () => {
  it('follows the pointer along a curve and shows the coordinates, and drags along it', () => {
    let dot = 0;
    const { runtime, mount } = run((inc) => {
      const g = inc.graph2d('#g', { x: [0, 10], y: [0, 100], title: 'Trace' });
      const curve = g.plot((x: number) => x * x);
      dot = idOf(g.trace(curve).handle);
    });
    const stage = runtime.graph.stages[0]!.id;
    expect(interaction(mount.commands)).toMatchObject({ hover: true });
    expect(mount.commands.some((c) => c.op === 'drag' && c.id === dot)).toBe(true);
    // x = 3 is at 52 + 0.3 * 688.
    runtime.hover(stage, 52 + 0.3 * 688, 100);
    runtime.tick(0);
    expect(texts(runtime)).toContain('(3, 9)');
    runtime.hover(stage, null, null);
    runtime.drag(dot, 'start', 52 + 0.5 * 688, 0);
    runtime.drag(dot, 'end', 52 + 0.7 * 688, 0);
    runtime.tick(0);
    expect(texts(runtime)).toContain('(7, 49)');
    expect(runtime.uiState().card.hint).toBe('Drag the point on the curve.');
  });

  it('binds a handle to parameters: dragging sets them, and the handle follows them', () => {
    let handle = 0;
    const { runtime } = run((inc) => {
      inc.param('h', { min: -5, max: 5, step: 0.5, value: 0 });
      inc.param('k', { min: -5, max: 5, step: 0.5, value: 1 });
      const g = inc.graph2d('#g', { x: [-5, 5], y: [-5, 5], title: 'Vertex' });
      handle = idOf(g.handle({ x: 'h', y: 'k', label: 'the vertex' }).handle);
    });
    // Stage (52 + 0.7 * 688, 20 + 0.2 * 320) is data (2, 3).
    runtime.drag(handle, 'start', 396, 180);
    runtime.drag(handle, 'move', 52 + 0.7 * 688, 20 + 0.2 * 320);
    runtime.drag(handle, 'end', 52 + 0.7 * 688, 20 + 0.2 * 320);
    const update = runtime.tick(0);
    expect(runtime.values()).toEqual({ h: 2, k: 3 });
    expect(update.values ?? {}).toBeDefined();
    expect(Number(attr(runtime, handle, 'cx'))).toBeCloseTo(52 + 0.7 * 688, 6);
    // One drag is one undo step.
    runtime.undo();
    runtime.tick(0);
    expect(runtime.values()).toEqual({ h: 0, k: 1 });
    expect(runtime.uiState().card.hint).toBe('Drag the vertex or change the values below.');
  });

  it('turns a scene’s drag map into parameter values in data units', () => {
    let point = 0;
    const { runtime } = run((inc) => {
      inc.param('a', { min: 0, max: 10, step: 0.1, value: 1 });
      const g = inc.graph2d('#g', { x: [0, 10], y: [0, 10], title: 'Map' });
      const p = g.point(1, 1);
      point = idOf(p.handle);
      g.drag(p, ({ x }) => ({ a: x }));
    });
    runtime.drag(point, 'start', 52 + 0.42 * 688, 100);
    runtime.drag(point, 'end', 52 + 0.42 * 688, 100);
    expect(runtime.values().a).toBe(4.2);
  });

  it('lets a later drag on a handle say how it drags, instead of failing', () => {
    let handle = 0;
    const { runtime } = run((inc) => {
      inc.param('phase', { min: -5, max: 5, step: 0.5, value: 0 });
      inc.param('amplitude', { min: 0.5, max: 3, step: 0.5, value: 1 });
      const g = inc.graph2d('#g', { x: [-5, 5], y: [-5, 5], title: 'Wave' });
      const h = g.handle({ x: 'phase', y: 'amplitude', label: 'the crest' });
      handle = idOf(h.handle);
      // Amplitude is a size: the later map keeps it positive, whichever side the learner drags to.
      g.drag(h, (p) => ({ phase: p.x, amplitude: Math.abs(p.y) }), { label: 'the crest' });
    });
    expect(runtime.isMounted).toBe(true);
    // Stage (52 + 0.7 * 688, 20 + 0.75 * 320) is data (2, -2.5).
    runtime.drag(handle, 'start', 396, 180);
    runtime.drag(handle, 'end', 52 + 0.7 * 688, 20 + 0.75 * 320);
    expect(runtime.values()).toEqual({ phase: 2, amplitude: 2.5 });
  });

  it('names a graph item as a part, as stage.part does for an element', () => {
    let point = 0;
    const { runtime } = run((inc) => {
      const g = inc.graph2d('#g', { x: [0, 10], y: [0, 10], title: 'Parts' });
      const p = g.part('current point', g.point(1, 2), { label: 'Current length', info: 'Where the present length sits on the curve.' });
      point = idOf(p.handle);
    });
    expect(runtime.isMounted).toBe(true);
    expect(runtime.graph.nodes.get(point)?.part).toBe('current point');
  });

  it('reports a drag map that names an unknown parameter, and keeps running', () => {
    let point = 0;
    const { runtime } = run((inc) => {
      inc.param('a', { min: 0, max: 10, value: 1 });
      const g = inc.graph2d('#g', { x: [0, 10], y: [0, 10], title: 'Bad' });
      const p = g.point(1, 1);
      point = idOf(p.handle);
      g.drag(p, ({ x }) => ({ b: x }));
    });
    runtime.drag(point, 'start', 100, 100);
    expect(runtime.uiState().error).toMatchObject({ phase: 'drag', message: '"b" is not a parameter' });
    expect(runtime.isMounted).toBe(true);
  });
});

describe('series (G2-2, G2-3, G2-4, G2-5, G2-13)', () => {
  it('draws x = f(y), polar, scatter, bars, histograms, areas, regions, fields, slopes and implicit curves', () => {
    const ids: Record<string, number> = {};
    const { runtime } = run((inc) => {
      const g = inc.graph2d('#g', { x: [-3, 3], y: [-3, 3], title: 'Series' });
      ids.plotX = idOf(g.plotX((y) => y * y - 2).handle);
      ids.polar = idOf(g.polar((t) => 1 + Math.cos(t)).handle);
      ids.scatter = idOf(g.scatter([[0, 0], [1, 1], [2, -1]]).handle);
      ids.bars = idOf(g.bars(() => [[-2, 1], [-1, 2], [0, 3]]).handle);
      ids.histogram = idOf(g.histogram([0.1, 0.2, 0.2, 1.5, -2.9], { bins: 6, range: [-3, 3] }).handle);
      ids.area = idOf(g.area((x: number) => Math.sin(x), 0, () => Math.PI).handle);
      ids.between = idOf(g.between((x: number) => x, (x: number) => -x, 0, 2).handle);
      ids.field = idOf(g.field((x, y) => [-y, x]).handle);
      ids.slopes = idOf(g.slopes((x) => x).handle);
      ids.implicit = idOf(g.implicit((x, y) => x * x + y * y - 4).handle);
    });
    for (const [name, id] of Object.entries(ids)) expect(attr(runtime, id, 'd')?.length ?? 0, name).toBeGreaterThan(10);
    // The circle x² + y² = 4 passes through (2, 0): stage (52 + 5/6 * 688, 180).
    const circle = pathPoints(attr(runtime, ids.implicit!, 'd')!);
    expect(circle.some(([x, y]) => Math.abs(x - (52 + (5 / 6) * 688)) < 4 && Math.abs(y - 180) < 4)).toBe(true);
    // Three scatter dots, each one subpath.
    expect((attr(runtime, ids.scatter!, 'd')!.match(/M/g) ?? []).length).toBe(3);
    // The histogram has six bins, some empty.
    expect((attr(runtime, ids.histogram!, 'd')!.match(/Z/g) ?? []).length).toBe(6);
  });

  it('reveals a fraction of a curve, to animate plotting', () => {
    let id = 0;
    let curve: GraphCurve | null = null;
    const { runtime } = run((inc) => {
      const g = inc.graph2d('#g', { x: [0, 10], y: [0, 10], title: 'Reveal' });
      curve = g.plot((x: number) => x, { samples: 100 });
      id = idOf(curve.handle);
      inc.onFrame(({ progress }) => curve!.reveal(progress));
      inc.timeline({ duration: 2 });
    });
    runtime.play();
    for (let i = 0; i < 30; i++) runtime.tick(1 / 60);
    const points = pathPoints(attr(runtime, id, 'd')!);
    expect(points.length).toBeGreaterThan(20);
    expect(points.length).toBeLessThan(40);
  });

  it('lists labelled curves in the legend and hides them when the learner switches them off', () => {
    let id = 0;
    const { runtime } = run((inc) => {
      const g = inc.graph2d('#g', { x: [0, 1], y: [0, 1], title: 'Legend' });
      id = idOf(g.plot((x: number) => x, { label: 'Line', tone: 'b' }).handle);
      g.plot((x: number) => x * x, { label: 'Square', tone: 'c' });
    });
    expect(runtime.uiState().legend.map((l) => [l.label, l.tone, l.visible, l.toggle])).toEqual([
      ['Line', 'b', true, true],
      ['Square', 'c', true, true],
    ]);
    runtime.setLegend(id, false);
    runtime.tick(0);
    expect(runtime.graph.nodes.get(id)!.hidden).toBe(true);
    expect(runtime.uiState().legend[0]!.visible).toBe(false);
  });
});

describe('special points and annotations (G2-8, G2-11)', () => {
  it('finds roots, turning points and crossings', () => {
    expect(findRoots((x) => x * x - 2, 0, 3).map((r) => Number(r.toFixed(6)))).toEqual([1.414214]);
    expect(findRoots((x) => 1 / x, -1, 1)).toEqual([]);
    const { runtime } = run((inc) => {
      const g = inc.graph2d('#g', { x: [-3, 3], y: [-3, 3], title: 'Marks' });
      const c = g.plot((x: number) => x * x - 1);
      const line = g.plot((x: number) => x + 1);
      g.marks(c);
      g.crossings(c, line);
    });
    const shown = texts(runtime);
    expect(shown).toEqual(expect.arrayContaining(['x = -1', 'x = 1', 'min (0, -1)', '(-1, 0)', '(2, 3)']));
  });

  it('draws brackets and dimension lines with their text', () => {
    const { runtime } = run((inc) => {
      const g = inc.graph2d('#g', { x: [0, 10], y: [0, 10], title: 'Notes' });
      g.dimension(1, 1, 9, 1, '8 m');
      g.bracket(2, 5, 6, 5, 'period').text('one period');
    });
    expect(texts(runtime)).toEqual(expect.arrayContaining(['8 m', 'one period']));
  });
});

describe('log scales and number lines (G2-12, DG-2)', () => {
  it('ticks a log axis at powers of ten', () => {
    expect(logTicks(1, 1000)).toEqual([1, 10, 100, 1000]);
    expect(logTicks(1, 50)).toEqual([1, 2, 5, 10, 20, 50]);
    expect(tickText(0.1, 0.01)).toBe('0.1');
    const { runtime } = run((inc) => void inc.graph2d('#g', { x: [1, 1000], y: [0, 1], title: 'Log', scale: { x: 'log' } }));
    expect(texts(runtime)).toEqual(expect.arrayContaining(['1', '10', '100', '1000']));
  });

  it('draws a number line with only its x axis', () => {
    let point = 0;
    const { runtime, mount } = run((inc) => {
      const line = inc.graph2d('#g', { x: [-5, 5], y: [-1, 1], title: 'Number line', axes: 'x' });
      point = idOf(line.point(2, 0).handle);
    });
    expect(mount.commands[0]).toMatchObject({ op: 'stage', viewBox: [0, 0, 760, 130] });
    expect(Number(attr(runtime, point, 'cy'))).toBeCloseTo(20 + 60 / 2, 6);
    expect(texts(runtime)).toEqual(expect.arrayContaining(['-4', '0', '4']));
  });
});
