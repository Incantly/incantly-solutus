import type { Vec2 } from '../../api/types';

/**
 * Layered layout for flowcharts and state diagrams (a small Sugiyama
 * method): break cycles, put each node in a layer, order every layer to
 * cross as few edges as possible, then space the nodes so edges run as
 * straight as they can. Long edges pass through placeholder points in the
 * layers they cross, so they bend around nodes instead of through them.
 */

export type Direction = 'down' | 'right';

export interface LayoutNode {
  readonly id: string;
  readonly w: number;
  readonly h: number;
  /** A layer the author pinned the node to. */
  readonly layer?: number;
}

export interface LayoutEdge {
  readonly from: string;
  readonly to: string;
  readonly labelled?: boolean;
}

/**
 * forward: down the layers (or right); back: against them, drawn round the
 * side; same: within one layer; self: a node to itself.
 */
export type EdgeKind = 'forward' | 'back' | 'same' | 'self';

export interface PlacedNode {
  readonly x: number;
  readonly y: number;
  readonly rank: number;
  readonly order: number;
}

export interface RoutedEdge {
  readonly kind: EdgeKind;
  /** For forward edges, the points the edge passes through between its nodes, from source to target. */
  readonly via: readonly Vec2[];
}

export interface FlowLayout {
  readonly nodes: ReadonlyMap<string, PlacedNode>;
  readonly edges: readonly RoutedEdge[];
  /** The real nodes of each layer, in order. */
  readonly ranks: ReadonlyArray<readonly string[]>;
  readonly crossings: number;
}

const ORDER_GAP = 28;
const DUMMY_EXTENT = 8;
const SWEEPS = 12;

interface Segment {
  readonly a: string;
  readonly b: string;
}

/** Edges that close a cycle, found by depth-first search in the order nodes and edges were added. */
export function backEdges(ids: readonly string[], edges: readonly LayoutEdge[]): Set<number> {
  const out = new Map<string, number[]>(ids.map((id) => [id, []]));
  edges.forEach((e, i) => {
    if (e.from !== e.to) out.get(e.from)?.push(i);
  });
  const state = new Map<string, number>();
  const back = new Set<number>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const i of out.get(id) ?? []) {
      const to = edges[i]!.to;
      const seen = state.get(to);
      if (seen === 1) back.add(i);
      else if (seen === undefined) visit(to);
    }
    state.set(id, 2);
  };
  for (const id of ids) if (!state.has(id)) visit(id);
  return back;
}

/** Each node's layer: its pin, or one past its furthest predecessor along forward edges. */
export function rankNodes(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[], back: ReadonlySet<number>): Map<string, number> {
  const preds = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  const indegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const succs = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  edges.forEach((e, i) => {
    if (e.from === e.to || back.has(i)) return;
    preds.get(e.to)!.push(e.from);
    succs.get(e.from)!.push(e.to);
    indegree.set(e.to, indegree.get(e.to)! + 1);
  });
  const rank = new Map<string, number>();
  const queue = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  const pins = new Map(nodes.map((n) => [n.id, n.layer]));
  while (queue.length > 0) {
    const id = queue.shift()!;
    const pin = pins.get(id);
    rank.set(id, pin ?? Math.max(0, ...preds.get(id)!.map((p) => rank.get(p)! + 1)));
    for (const next of succs.get(id)!) {
      indegree.set(next, indegree.get(next)! - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  return rank;
}

/** Crossings between two neighbouring layers. */
function crossingsBetween(upper: readonly string[], lower: readonly string[], segments: readonly Segment[]): number {
  const pu = new Map(upper.map((id, i) => [id, i]));
  const pl = new Map(lower.map((id, i) => [id, i]));
  const pairs: Array<[number, number]> = [];
  for (const s of segments) {
    const a = pu.get(s.a);
    const b = pl.get(s.b);
    if (a !== undefined && b !== undefined) pairs.push([a, b]);
  }
  let count = 0;
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const [a1, b1] = pairs[i]!;
      const [a2, b2] = pairs[j]!;
      if ((a1 - a2) * (b1 - b2) < 0) count++;
    }
  }
  return count;
}

export function countCrossings(layers: ReadonlyArray<readonly string[]>, segments: readonly Segment[]): number {
  let total = 0;
  for (let r = 0; r + 1 < layers.length; r++) total += crossingsBetween(layers[r]!, layers[r + 1]!, segments);
  return total;
}

export function layoutFlow(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[], direction: Direction): FlowLayout {
  const ids = nodes.map((n) => n.id);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const back = backEdges(ids, edges);
  const rank = rankNodes(nodes, edges, back);
  const kinds: EdgeKind[] = edges.map((e) => {
    if (e.from === e.to) return 'self';
    const a = rank.get(e.from)!;
    const b = rank.get(e.to)!;
    return b > a ? 'forward' : b === a ? 'same' : 'back';
  });

  // Layers of real nodes and placeholders; segments join neighbouring layers only.
  const depth = Math.max(0, ...rank.values()) + 1;
  const layers: string[][] = Array.from({ length: depth }, () => []);
  for (const id of ids) layers[rank.get(id)!]!.push(id);
  const segments: Segment[] = [];
  const chains: string[][] = edges.map(() => []);
  const dummies = new Set<string>();
  edges.forEach((e, i) => {
    if (kinds[i] !== 'forward') return;
    let previous = e.from;
    for (let r = rank.get(e.from)! + 1; r < rank.get(e.to)!; r++) {
      const key = `\u0000${i}:${r}`;
      dummies.add(key);
      layers[r]!.push(key);
      chains[i]!.push(key);
      segments.push({ a: previous, b: key });
      previous = key;
    }
    segments.push({ a: previous, b: e.to });
  });
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const s of segments) {
    (preds.get(s.b) ?? preds.set(s.b, []).get(s.b)!).push(s.a);
    (succs.get(s.a) ?? succs.set(s.a, []).get(s.a)!).push(s.b);
  }

  // Ordering: barycentre sweeps down and up, each followed by swapping neighbours that cross less the other way round.
  const position = (layer: readonly string[]) => new Map(layer.map((id, i) => [id, i]));
  const sortBy = (layer: string[], fixed: readonly string[], neighbours: Map<string, string[]>) => {
    const at = position(fixed);
    const current = position(layer);
    const key = (id: string) => {
      const list = (neighbours.get(id) ?? []).map((n) => at.get(n)).filter((p): p is number => p !== undefined);
      return list.length > 0 ? list.reduce((s, p) => s + p, 0) / list.length : current.get(id)!;
    };
    const keys = new Map(layer.map((id) => [id, key(id)]));
    layer.sort((a, b) => keys.get(a)! - keys.get(b)! || current.get(a)! - current.get(b)!);
  };
  const pairCrossings = (v: string, w: string, r: number) => {
    let count = 0;
    for (const [neighbours, other] of [
      [preds, layers[r - 1]],
      [succs, layers[r + 1]],
    ] as const) {
      if (!other) continue;
      const at = position(other);
      for (const a of neighbours.get(v) ?? []) {
        for (const b of neighbours.get(w) ?? []) if (at.get(a)! > at.get(b)!) count++;
      }
    }
    return count;
  };
  const transpose = () => {
    for (let pass = 0; pass < 8; pass++) {
      let improved = false;
      layers.forEach((layer, r) => {
        for (let i = 0; i + 1 < layer.length; i++) {
          const v = layer[i]!;
          const w = layer[i + 1]!;
          if (pairCrossings(w, v, r) < pairCrossings(v, w, r)) {
            layer[i] = w;
            layer[i + 1] = v;
            improved = true;
          }
        }
      });
      if (!improved) break;
    }
  };
  for (let r = 1; r < depth; r++) sortBy(layers[r]!, layers[r - 1]!, preds);
  transpose();
  let best = layers.map((layer) => [...layer]);
  let fewest = countCrossings(layers, segments);
  for (let sweep = 0; sweep < SWEEPS && fewest > 0; sweep++) {
    if (sweep % 2 === 0) for (let r = depth - 2; r >= 0; r--) sortBy(layers[r]!, layers[r + 1]!, succs);
    else for (let r = 1; r < depth; r++) sortBy(layers[r]!, layers[r - 1]!, preds);
    transpose();
    const count = countCrossings(layers, segments);
    if (count < fewest) {
      fewest = count;
      best = layers.map((layer) => [...layer]);
    }
  }
  best.forEach((layer, r) => (layers[r] = layer));

  // Spacing along each layer: start packed and centred, then pull each node toward its neighbours.
  const down = direction === 'down';
  const extent = (id: string) => (dummies.has(id) ? DUMMY_EXTENT : down ? byId.get(id)!.w : byId.get(id)!.h);
  const gap = (a: string, b: string) => (dummies.has(a) && dummies.has(b) ? 10 : dummies.has(a) || dummies.has(b) ? 14 : ORDER_GAP);
  const separation = (a: string, b: string) => (extent(a) + extent(b)) / 2 + gap(a, b);
  const along = new Map<string, number>();
  for (const layer of layers) {
    let x = 0;
    layer.forEach((id, i) => {
      if (i > 0) x += separation(layer[i - 1]!, id);
      along.set(id, x);
    });
    const shift = x / 2;
    for (const id of layer) along.set(id, along.get(id)! - shift);
  }
  const place = (layer: readonly string[], desired: readonly number[]) => {
    const left: number[] = [];
    const right: number[] = new Array<number>(layer.length);
    layer.forEach((id, i) => left.push(i === 0 ? desired[0]! : Math.max(desired[i]!, left[i - 1]! + separation(layer[i - 1]!, id))));
    for (let i = layer.length - 1; i >= 0; i--) {
      right[i] = i === layer.length - 1 ? desired[i]! : Math.min(desired[i]!, right[i + 1]! - separation(layer[i]!, layer[i + 1]!));
    }
    layer.forEach((id, i) => along.set(id, (left[i]! + right[i]!) / 2));
  };
  const align = (layer: readonly string[], neighbours: Map<string, string[]>) => {
    if (layer.length === 0) return;
    place(
      layer,
      layer.map((id) => {
        const list = neighbours.get(id) ?? [];
        return list.length > 0 ? list.reduce((s, n) => s + along.get(n)!, 0) / list.length : along.get(id)!;
      }),
    );
  };
  for (let pass = 0; pass < 8; pass++) {
    for (let r = 1; r < depth; r++) align(layers[r]!, preds);
    for (let r = depth - 2; r >= 0; r--) align(layers[r]!, succs);
  }

  // Layers across: each as deep as its deepest node, with room for edge labels between them.
  const across = (id: string) => (dummies.has(id) ? 0 : down ? byId.get(id)!.h : byId.get(id)!.w);
  const labelled = new Set<number>();
  edges.forEach((e, i) => {
    if (kinds[i] === 'forward' && e.labelled) for (let r = rank.get(e.from)!; r < rank.get(e.to)!; r++) labelled.add(r);
  });
  const rankGap = down ? 56 : 72;
  const deepest = layers.map((layer) => Math.max(0, ...layer.map(across)));
  const rankAt: number[] = [];
  deepest.forEach((d, r) => {
    rankAt.push(r === 0 ? d / 2 : rankAt[r - 1]! + deepest[r - 1]! / 2 + rankGap + (labelled.has(r - 1) ? 16 : 0) + d / 2);
  });

  // Coordinates, shifted so the drawing starts at zero.
  const minAlong = Math.min(...[...along.entries()].map(([id, a]) => a - extent(id) / 2));
  const point = (id: string): Vec2 => {
    const a = along.get(id)! - minAlong;
    const b = rankAt[rank.get(id) ?? Number(id.slice(id.indexOf(':') + 1))]!;
    return down ? [a, b] : [b, a];
  };
  const placed = new Map<string, PlacedNode>();
  layers.forEach((layer) => {
    const real = layer.filter((id) => !dummies.has(id));
    real.forEach((id, order) => {
      const [x, y] = point(id);
      placed.set(id, { x, y, rank: rank.get(id)!, order });
    });
  });
  return {
    nodes: placed,
    edges: edges.map((_, i) => ({ kind: kinds[i]!, via: chains[i]!.map(point) })),
    ranks: layers.map((layer) => layer.filter((id) => !dummies.has(id))),
    crossings: fewest,
  };
}
