import { describe, expect, it } from 'vitest';
import type { Flow, FlowNode, FlowOptions, Inc } from '../src/api/types';
import { kit } from '../src/kits/flow';
import { backEdges, countCrossings, layoutFlow, rankNodes, type LayoutEdge, type LayoutNode } from '../src/kits/flow/layout';
import { borderPoint, nodeSize, shapePath, wrapLabel, type NodeShape } from '../src/kits/flow/shapes';
import { isKitModule, KIT_GLOBAL, type KitModule } from '../src/runtime/kits';
import { SceneRuntime } from '../src/runtime/runtime';
import { KIT_SCRIPTS } from '../src/sandbox/generated/kit-scripts';
import { SHARED_GLOBAL, SHARED_MODULES } from '../src/sandbox/kit-shared';
import type { VNode } from '../src/scene/graph';
import { validateSceneJs } from '../src/validation/js';

function run(scene: (inc: Inc) => void) {
  const runtime = new SceneRuntime({ autoplay: false, kits: { flow: kit } });
  const mount = runtime.mount(scene);
  runtime.tick(0);
  return { runtime, mount };
}

const box = (id: string, layer?: number): LayoutNode => ({ id, w: 80, h: 34, ...(layer !== undefined ? { layer } : {}) });
const edge = (from: string, to: string): LayoutEdge => ({ from, to });

/** The stage's root group, the edge group inside it and the node group after it. */
function structure(runtime: SceneRuntime) {
  const stage = runtime.graph.nodes.get(runtime.graph.stages[0]!.id)!;
  const root = runtime.graph.nodes.get(stage.children[0]!)!;
  const [edgeLayer, nodeLayer] = root.children.map((id) => runtime.graph.nodes.get(id)!);
  return { root, edgeLayer: edgeLayer!, nodeLayer: nodeLayer! };
}

const kids = (runtime: SceneRuntime, node: VNode) => node.children.map((id) => runtime.graph.nodes.get(id)!);

/** translate(x y) and an optional scale(s s). */
function transformOf(node: VNode): { x: number; y: number; s: number } {
  const t = node.attrs.get('transform') ?? '';
  const translate = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(t);
  const scale = /scale\(([-\d.]+)/.exec(t);
  return { x: translate ? Number(translate[1]) : 0, y: translate ? Number(translate[2]) : 0, s: scale ? Number(scale[1]) : 1 };
}

/** How far a point is from a shape's outline (0 on it), with the shape centred on the origin. */
function offBorder(shape: NodeShape, w: number, h: number, x: number, y: number): number {
  const hx = w / 2;
  const hy = h / 2;
  switch (shape) {
    case 'box':
      return Math.abs(Math.max(Math.abs(x) / hx, Math.abs(y) / hy) - 1) * Math.min(hx, hy);
    case 'diamond':
      return Math.abs(Math.abs(x) / hx + Math.abs(y) / hy - 1) * Math.min(hx, hy);
    case 'circle':
      return Math.abs(Math.hypot(x, y) - hx);
    case 'round':
    case 'pill': {
      const r = shape === 'pill' ? Math.min(w, h) / 2 : Math.min(10, hx, hy);
      // Signed distance to a rounded rectangle.
      const qx = Math.abs(x) - (hx - r);
      const qy = Math.abs(y) - (hy - r);
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      return Math.abs(outside + Math.min(Math.max(qx, qy), 0) - r);
    }
  }
}

function firstPoint(d: string): [number, number] {
  const m = /^M([-\d.]+) ([-\d.]+)/.exec(d)!;
  return [Number(m[1]), Number(m[2])];
}

describe('flow layout (DG-4)', () => {
  it('puts each node one layer below its furthest predecessor', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e'].map((id) => box(id));
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd'), edge('a', 'd'), edge('d', 'e')];
    const ranks = rankNodes(nodes, edges, backEdges(['a', 'b', 'c', 'd', 'e'], edges));
    expect(Object.fromEntries(ranks)).toEqual({ a: 0, b: 1, c: 1, d: 2, e: 3 });
    const layout = layoutFlow(nodes, edges, 'down');
    expect(layout.ranks).toEqual([['a'], ['b', 'c'], ['d'], ['e']]);
    // The long edge a to d passes through one placeholder point in the middle layer.
    expect(layout.edges[4]!.via).toHaveLength(1);
    expect(layout.edges.map((e) => e.kind)).toEqual(['forward', 'forward', 'forward', 'forward', 'forward', 'forward']);
    // Layers go down the page, each node centred on its layer.
    const y = (id: string) => layout.nodes.get(id)!.y;
    expect(y('b')).toBe(y('c'));
    expect(y('a')).toBeLessThan(y('b'));
    expect(y('d')).toBeLessThan(y('e'));
  });

  it('honours pinned layers', () => {
    const nodes = [box('start'), box('late', 3), box('end')];
    const layout = layoutFlow(nodes, [edge('start', 'end')], 'down');
    expect(layout.nodes.get('late')!.rank).toBe(3);
    expect(layout.nodes.get('end')!.rank).toBe(1);
  });

  it('orders layers so edges cross as little as possible', () => {
    // Added so that the obvious order crosses: a to d, b to c.
    const k22 = layoutFlow([box('a'), box('b'), box('c'), box('d')], [edge('a', 'd'), edge('b', 'c')], 'down');
    expect(k22.crossings).toBe(0);
    expect(k22.ranks).toEqual([['a', 'b'], ['d', 'c']]);
    // A 3 by 3 that can be drawn with no crossings, given scrambled.
    const nodes = ['a', 'b', 'c', 'x', 'y', 'z'].map((id) => box(id));
    const edges = [edge('a', 'z'), edge('b', 'y'), edge('c', 'x'), edge('a', 'y'), edge('b', 'x')];
    const layout = layoutFlow(nodes, edges, 'down');
    expect(layout.crossings).toBe(0);
    const segments = edges.map((e) => ({ a: e.from, b: e.to }));
    expect(countCrossings(layout.ranks, segments)).toBe(0);
    // K3,3 cannot be uncrossed: three crossings is the least possible in two layers.
    const k33 = layoutFlow(nodes, ['x', 'y', 'z'].flatMap((t) => ['a', 'b', 'c'].map((f) => edge(f, t))), 'down');
    expect(k33.crossings).toBe(9);
  });

  it('breaks cycles and tells back, same-layer and self edges apart', () => {
    const nodes = ['a', 'b', 'c'].map((id) => box(id));
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a'), edge('b', 'b')];
    expect([...backEdges(['a', 'b', 'c'], edges)]).toEqual([2]);
    const layout = layoutFlow(nodes, edges, 'down');
    expect(layout.edges.map((e) => e.kind)).toEqual(['forward', 'forward', 'back', 'self']);
    const pinned = layoutFlow([box('p', 0), box('q', 0)], [edge('p', 'q')], 'down');
    expect(pinned.edges[0]!.kind).toBe('same');
  });

  it('lays out across the page when the direction is right', () => {
    const layout = layoutFlow([box('a'), box('b')], [edge('a', 'b')], 'right');
    expect(layout.nodes.get('a')!.y).toBe(layout.nodes.get('b')!.y);
    expect(layout.nodes.get('b')!.x).toBeGreaterThan(layout.nodes.get('a')!.x + 80);
  });

  it('keeps nodes in a layer apart', () => {
    const nodes = ['r', 'a', 'b', 'c', 'd'].map((id) => box(id));
    const layout = layoutFlow(nodes, ['a', 'b', 'c', 'd'].map((t) => edge('r', t)), 'down');
    const xs = layout.ranks[1]!.map((id) => layout.nodes.get(id)!.x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(80 + 28 - 1e-9);
    // The parent sits over the middle of its children.
    expect(layout.nodes.get('r')!.x).toBeCloseTo((xs[0]! + xs[3]!) / 2, 6);
  });
});

describe('node shapes', () => {
  it('sizes nodes from their labels and wraps long ones', () => {
    expect(wrapLabel('Start')).toEqual(['Start']);
    expect(wrapLabel('Is the water warmer than the air today')).toEqual(['Is the water warmer', 'than the air today']);
    const one = nodeSize('box', ['Heat']);
    const two = nodeSize('box', wrapLabel('Is the water warmer than the air today'));
    expect(two.h).toBeGreaterThan(one.h);
    expect(nodeSize('diamond', ['Yes?']).w).toBeGreaterThan(nodeSize('box', ['Yes?']).w);
    expect(shapePath('diamond', 80, 40)).toBe('M0 -20L40 0L0 20L-40 0Z');
  });

  it('finds border points on every shape', () => {
    for (const shape of ['box', 'round', 'diamond', 'circle', 'pill'] as const) {
      const { w, h } = nodeSize(shape, ['A label']);
      for (let a = 0; a < 360; a += 15) {
        const rad = (a * Math.PI) / 180;
        const [x, y] = borderPoint(shape, w, h, Math.cos(rad), Math.sin(rad));
        expect(offBorder(shape, w, h, x, y), `${shape} at ${a}°`).toBeLessThan(1e-6);
      }
    }
  });
});

describe('inc.flow', () => {
  const states = (options: Partial<FlowOptions> = {}) => {
    let flow!: Flow;
    const handles: Record<string, FlowNode> = {};
    const result = run((inc) => {
      flow = inc.flow('#f', { title: 'Traffic light', ...options });
      handles.red = flow.node('red', 'Red', { shape: 'circle', tone: 'a', info: 'Stop' });
      handles.green = flow.node('green', 'Green', { shape: 'circle', tone: 'c' });
      handles.amber = flow.node('amber', 'Amber', { shape: 'round', tone: 'lit' });
      handles.check = flow.node('check', 'Is the road clear for crossing now?', { shape: 'diamond' });
      handles.end = flow.node('end', 'Done', { shape: 'pill' });
      flow.edge('red', 'green', { label: 'timer' });
      flow.edge('green', 'amber');
      flow.edge('amber', 'red', { label: 'back' });
      flow.edge('green', 'check');
      flow.edge('check', 'end', { label: 'yes' });
      flow.edge('check', 'check', { label: 'wait' });
      flow.edge('red', 'end', { dashed: true, flow: 30 });
    });
    return { ...result, flow, handles };
  };

  it('draws every edge from border to border', () => {
    for (const direction of ['down', 'right'] as const) {
      const { runtime } = states({ direction });
      const { edgeLayer } = structure(runtime);
      const parts = runtime.parts.parts;
      const shapeOf: Record<string, NodeShape> = { red: 'circle', green: 'circle', amber: 'round', check: 'diamond', end: 'pill' };
      const labels: Record<string, string> = { red: 'Red', green: 'Green', amber: 'Amber', check: 'Is the road clear for crossing now?', end: 'Done' };
      const ends: Array<[string, string]> = [
        ['red', 'green'],
        ['green', 'amber'],
        ['amber', 'red'],
        ['green', 'check'],
        ['check', 'end'],
        ['check', 'check'],
        ['red', 'end'],
      ];
      kids(runtime, edgeLayer).forEach((group, i) => {
        const [path, head] = kids(runtime, group);
        const [from, to] = ends[i]!;
        const start = firstPoint(path!.attrs.get('d')!);
        const tip = firstPoint(head!.attrs.get('d')!);
        for (const [id, point] of [
          [from, start],
          [to, tip],
        ] as const) {
          const node = transformOf(parts.get(id)!.node);
          const shape = shapeOf[id]!;
          const { w, h } = nodeSize(shape, wrapLabel(labels[id]!));
          expect(offBorder(shape, w, h, point[0] - node.x, point[1] - node.y), `${direction} edge ${from} to ${to} at ${id}`).toBeLessThan(0.02);
        }
      });
    }
  });

  it('fits the diagram, nodes and edges, inside its view box', () => {
    for (const direction of ['down', 'right'] as const) {
      const { runtime } = states({ direction });
      const { root, edgeLayer } = structure(runtime);
      const t = transformOf(root);
      const inside = (x: number, y: number) => {
        expect(t.x + t.s * x).toBeGreaterThanOrEqual(-0.5);
        expect(t.x + t.s * x).toBeLessThanOrEqual(640.5);
        expect(t.y + t.s * y).toBeGreaterThanOrEqual(-0.5);
        expect(t.y + t.s * y).toBeLessThanOrEqual(420.5);
      };
      const shapes: Record<string, NodeShape> = { red: 'circle', green: 'circle', amber: 'round', check: 'diamond', end: 'pill' };
      for (const part of runtime.parts.parts.values()) {
        const node = transformOf(part.node);
        const { w, h } = nodeSize(shapes[part.name]!, wrapLabel(part.label));
        inside(node.x - w / 2, node.y - h / 2);
        inside(node.x + w / 2, node.y + h / 2);
      }
      // Edges are moves, lines and curves: every number pair is a point on or beside them.
      for (const group of kids(runtime, edgeLayer)) {
        for (const path of kids(runtime, group).filter((n) => n.kind === 'path')) {
          for (const m of path.attrs.get('d')!.matchAll(/[MLC]([^MLCZ]+)/g)) {
            const numbers = m[1]!.trim().split(/[ ,]+/).map(Number);
            for (let i = 0; i + 1 < numbers.length; i += 2) inside(numbers[i]!, numbers[i + 1]!);
          }
        }
      }
    }
  });

  it('makes each node a part, and centre() gives where it is drawn', () => {
    const { runtime, handles } = states();
    expect(runtime.uiState().parts.map((p) => [p.name, p.label])).toEqual([
      ['red', 'Red'],
      ['green', 'Green'],
      ['amber', 'Amber'],
      ['check', 'Is the road clear for crossing now?'],
      ['end', 'Done'],
    ]);
    expect(runtime.uiState().parts[0]!.info).toBe('Stop');
    const t = transformOf(structure(runtime).root);
    for (const [id, handle] of Object.entries(handles)) {
      const node = transformOf(runtime.parts.parts.get(id)!.node);
      const [x, y] = handle.centre();
      expect(x).toBeCloseTo(t.x + t.s * node.x, 1);
      expect(y).toBeCloseTo(t.y + t.s * node.y, 1);
    }
  });

  it('highlights the active node without dimming the rest', () => {
    let flow!: Flow;
    const { runtime } = run((inc) => {
      const state = inc.choice('state', { options: ['none', 'a', 'b'] });
      flow = inc.flow('#f', { title: 'States' });
      flow.node('a', 'A');
      flow.node('b', 'B');
      flow.edge('a', 'b');
      inc.onParamChange(() => flow.active(state.value === 0 ? null : state.selected));
    });
    const outline = (id: string) => kids(runtime, runtime.parts.parts.get(id)!.node)[1]!.attrs.get('stroke-width');
    runtime.setParam('state', 2);
    runtime.tick(0);
    expect([outline('a'), outline('b')]).toEqual(['2', '3.5']);
    runtime.setParam('state', 0);
    runtime.tick(0);
    expect([outline('a'), outline('b')]).toEqual(['2', '2']);
    for (const id of ['a', 'b']) expect(runtime.parts.parts.get(id)!.node.attrs.get('opacity')).toBeUndefined();
    expect(() => flow.active('c')).toThrow('there is no node "c"');
  });

  it('lays out again when a label changes, and not otherwise', () => {
    let node!: FlowNode;
    const { runtime } = run((inc) => {
      const long = inc.toggle('long', { value: false });
      const flow = inc.flow('#f', { title: 'Relabel' });
      node = flow.node('a', 'Short');
      flow.node('b', 'B');
      flow.edge('a', 'b');
      inc.onParamChange(() => node.label(long.on ? 'A much longer label than before' : 'Short'));
    });
    const width = () => Number(/H(-?[\d.]+)/.exec(kids(runtime, runtime.parts.parts.get('a')!.node)[1]!.attrs.get('d')!)![1]);
    const before = width();
    const commands = runtime.tick(0).commands.length;
    expect(commands).toBe(0);
    runtime.setParam('long', 1);
    runtime.tick(0);
    expect(width()).toBeGreaterThan(before);
  });

  it('animates edges and draws them dashed on request', () => {
    const { runtime } = states();
    const { edgeLayer } = structure(runtime);
    const last = kids(runtime, kids(runtime, edgeLayer)[6]!)[0]!;
    expect(last.dashed).toBe(true);
    expect(last.classValue).toContain('inc-flow');
  });

  it('refuses unknown and repeated ids plainly', () => {
    const error = (scene: (inc: Inc) => void) => run(scene).mount.ui.error?.message;
    expect(
      error((inc) => {
        const f = inc.flow('#f', { title: 'x' });
        f.node('a', 'A');
        f.node('a', 'Again');
      }),
    ).toBe('flow.node: "a" is already a node');
    expect(
      error((inc) => {
        const f = inc.flow('#f', { title: 'x' });
        f.node('a', 'A');
        f.edge('a', 'b');
      }),
    ).toBe('flow.edge: there is no node "b"; add it with flow.node first');
    expect(error((inc) => void inc.flow('#f', { title: 'x' }).node('a', 'A', { shape: 'star' as never }))).toBe(
      'flow.node "a": shape is one of box, round, diamond, circle, pill, not "star"',
    );
    expect(error((inc) => void inc.flow('#f', { title: 'x', direction: 'up' as never }))).toBe(`flow: direction is 'down' or 'right', not "up"`);
    expect(
      error((inc) => {
        const f = inc.flow('#f', { title: 'x' });
        for (let i = 0; i <= 40; i++) f.node(`n${i}`, `N${i}`);
      }),
    ).toBe('A flowchart has at most 40 nodes');
  });
});

describe('the flow kit script', () => {
  it('registers itself in the Worker and draws with the runtime’s own modules', async () => {
    const code = await KIT_SCRIPTS.flow!();
    const scope = globalThis as unknown as Record<string, unknown>;
    scope[SHARED_GLOBAL] = SHARED_MODULES;
    try {
      new Function(code)();
      const registered = (scope[KIT_GLOBAL] as Record<string, unknown>).flow;
      expect(isKitModule(registered)).toBe(true);
      const runtime = new SceneRuntime({ autoplay: false, kits: { flow: registered as KitModule } });
      runtime.mount((inc) => {
        const f = inc.flow('#f', { title: 'Built' });
        f.node('a', 'A');
        f.node('b', 'B');
        f.edge('a', 'b', { label: 'next' });
      });
      runtime.tick(0);
      expect(runtime.uiState().parts.map((p) => p.name)).toEqual(['a', 'b']);
      expect(runtime.uiState().error).toBeNull();
    } finally {
      delete scope[SHARED_GLOBAL];
      delete scope[KIT_GLOBAL];
    }
  });
});

describe('a flow scene passes the validator', () => {
  it('has no diagnostics', () => {
    const js = `
inc.idea('Water moves between sea, air and land in a cycle driven by the sun.');
const flow = inc.flow('#flow', { title: 'The water cycle', direction: 'right' });
flow.node('sea', 'Sea', { shape: 'round', tone: 'b', info: 'Most of the water is here' });
flow.node('cloud', 'Clouds', { shape: 'round' });
flow.node('land', 'Land', { shape: 'round', tone: 'c' });
flow.edge('sea', 'cloud', { label: 'evaporation', flow: 20 });
flow.edge('cloud', 'land', { label: 'rain' });
flow.edge('land', 'sea', { label: 'rivers', dashed: true });
const stage = inc.choice('stage', { options: ['sea', 'cloud', 'land'], buttons: true });
inc.onParamChange(() => flow.active(stage.selected));
inc.steps([{ say: 'The sun warms the sea.', focus: 'sea' }, { say: 'Rain falls on the land.', focus: 'land' }]);
`;
    const { diagnostics, info } = validateSceneJs(js);
    expect(diagnostics).toEqual([]);
    expect(info.kits).toEqual(['flow']);
  });
});
