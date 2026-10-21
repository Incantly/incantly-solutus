import type { SceneGraph, Transform, VNode } from './graph';

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Affine matrix [a, b, c, d, e, f] as in SVG: x' = a x + c y + e, y' = b x + d y + f. */
type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function local(t: Transform): Matrix {
  let m: Matrix = [1, 0, 0, 1, t.tx, t.ty];
  if (t.rotation !== 0) {
    const r = (t.rotation * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    m = multiply(m, [1, 0, 0, 1, t.rcx, t.rcy]);
    m = multiply(m, [cos, sin, -sin, cos, 0, 0]);
    m = multiply(m, [1, 0, 0, 1, -t.rcx, -t.rcy]);
  }
  if (t.sx !== 1 || t.sy !== 1) m = multiply(m, [t.sx, 0, 0, t.sy, 0, 0]);
  return m;
}

const num = (node: VNode, name: string, fallback = 0): number => {
  const raw = node.attrs.get(name);
  if (raw === undefined) return fallback;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
};

/** Every coordinate pair in path data, including control points (a safe over-estimate). */
export function pathPoints(d: string): Array<[number, number]> {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const out: Array<[number, number]> = [];
  let command = 'M';
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let i = 0;
  const read = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (/[A-Za-z]/.test(token)) {
      command = token;
      i++;
      if (command === 'Z' || command === 'z') {
        x = startX;
        y = startY;
      }
      continue;
    }
    const relative = command === command.toLowerCase();
    const base = (vx: number, vy: number): [number, number] => (relative ? [x + vx, y + vy] : [vx, vy]);
    switch (command.toUpperCase()) {
      case 'M':
      case 'L':
      case 'T': {
        [x, y] = base(read(), read());
        if (command.toUpperCase() === 'M') {
          startX = x;
          startY = y;
          command = relative ? 'l' : 'L';
        }
        out.push([x, y]);
        break;
      }
      case 'H':
        x = relative ? x + read() : read();
        out.push([x, y]);
        break;
      case 'V':
        y = relative ? y + read() : read();
        out.push([x, y]);
        break;
      case 'C': {
        out.push(base(read(), read()), base(read(), read()));
        [x, y] = base(read(), read());
        out.push([x, y]);
        break;
      }
      case 'S':
      case 'Q': {
        out.push(base(read(), read()));
        [x, y] = base(read(), read());
        out.push([x, y]);
        break;
      }
      case 'A': {
        const rx = Math.abs(read());
        const ry = Math.abs(read());
        i += 3; // rotation and flags
        const [nx, ny] = base(read(), read());
        out.push([x - rx, y - ry], [x + rx, y + ry], [nx - rx, ny - ry], [nx + rx, ny + ry], [nx, ny]);
        x = nx;
        y = ny;
        break;
      }
      default:
        i++;
    }
  }
  return out.filter(([px, py]) => Number.isFinite(px) && Number.isFinite(py));
}

function localPoints(node: VNode): Array<[number, number]> {
  switch (node.kind) {
    case 'line':
      return [
        [num(node, 'x1'), num(node, 'y1')],
        [num(node, 'x2'), num(node, 'y2')],
      ];
    case 'circle': {
      const cx = num(node, 'cx');
      const cy = num(node, 'cy');
      const r = num(node, 'r');
      return [
        [cx - r, cy - r],
        [cx + r, cy + r],
      ];
    }
    case 'rect': {
      const x = num(node, 'x');
      const y = num(node, 'y');
      return [
        [x, y],
        [x + num(node, 'width'), y + num(node, 'height')],
      ];
    }
    case 'path':
      return pathPoints(node.attrs.get('d') ?? '');
    case 'polyline':
      return (node.attrs.get('points') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((pair) => pair.split(',').map(Number) as [number, number])
        .filter(([px, py]) => Number.isFinite(px) && Number.isFinite(py));
    case 'text': {
      const size = num(node, 'font-size', 14);
      const width = (node.text ?? '').length * size * 0.6;
      const x = num(node, 'x');
      const y = num(node, 'y');
      const anchor = node.attrs.get('text-anchor');
      const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
      return [
        [left, y - size * 0.8],
        [left + width, y + size * 0.25],
      ];
    }
    default:
      return [];
  }
}

export interface StageBounds {
  /** Union of every visible element's box, or null when nothing is visible. */
  readonly box: Box | null;
  readonly visibleElements: number;
  readonly boxes: ReadonlyMap<number, Box>;
}

/** World-space bounds of the visible elements of one stage, with transforms applied. */
export function stageBounds(graph: SceneGraph, stageId: number): StageBounds {
  const boxes = new Map<number, Box>();
  let union: Box | null = null;
  const visit = (id: number, matrix: Matrix) => {
    const node = graph.nodes.get(id);
    if (!node || node.hidden) return;
    const m = node.kind === 'stage' ? matrix : multiply(matrix, local(node.transform));
    if (node.kind === 'g' || node.kind === 'stage') {
      node.children.forEach((child) => visit(child, m));
      return;
    }
    const points = localPoints(node);
    if (points.length === 0) return;
    const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const [px, py] of points) {
      const wx = m[0] * px + m[2] * py + m[4];
      const wy = m[1] * px + m[3] * py + m[5];
      box.minX = Math.min(box.minX, wx);
      box.minY = Math.min(box.minY, wy);
      box.maxX = Math.max(box.maxX, wx);
      box.maxY = Math.max(box.maxY, wy);
    }
    boxes.set(id, box);
    union = union
      ? {
          minX: Math.min(union.minX, box.minX),
          minY: Math.min(union.minY, box.minY),
          maxX: Math.max(union.maxX, box.maxX),
          maxY: Math.max(union.maxY, box.maxY),
        }
      : { ...box };
  };
  visit(stageId, IDENTITY);
  return { box: union, visibleElements: boxes.size, boxes };
}

/** The transform from an element's own coordinates to its stage's, through every parent group. */
function worldMatrix(graph: SceneGraph, node: VNode): Matrix {
  const chain: VNode[] = [];
  let current: VNode | undefined = node;
  while (current && current.kind !== 'stage') {
    chain.push(current);
    current = current.parent === null ? undefined : graph.nodes.get(current.parent);
  }
  let m: Matrix = IDENTITY;
  for (let i = chain.length - 1; i >= 0; i--) m = multiply(m, local(chain[i]!.transform));
  return m;
}

/** An element's box in its stage's coordinates (a group's covers its children), or null when it draws nothing. */
export function elementBox(graph: SceneGraph, id: number): Box | null {
  const node = graph.nodes.get(id);
  if (!node || node.kind === 'stage') return null;
  const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (m: Matrix, points: ReadonlyArray<readonly [number, number]>) => {
    for (const [px, py] of points) {
      const wx = m[0] * px + m[2] * py + m[4];
      const wy = m[1] * px + m[3] * py + m[5];
      box.minX = Math.min(box.minX, wx);
      box.minY = Math.min(box.minY, wy);
      box.maxX = Math.max(box.maxX, wx);
      box.maxY = Math.max(box.maxY, wy);
    }
  };
  const visit = (n: VNode, m: Matrix) => {
    if (n.kind === 'g') {
      for (const child of n.children) {
        const c = graph.nodes.get(child);
        if (c && !c.hidden) visit(c, multiply(m, local(c.transform)));
      }
      return;
    }
    if (n.kind === 'use' && n.source !== null) {
      const source = graph.nodes.get(n.source);
      if (source) visit(source, m);
      return;
    }
    add(m, localPoints(n));
  };
  visit(node, worldMatrix(graph, node));
  return Number.isFinite(box.minX) ? box : null;
}

/** The centre of an element in its stage's coordinates, or null when it draws nothing. */
export function elementCentre(graph: SceneGraph, id: number): readonly [number, number] | null {
  const box = elementBox(graph, id);
  return box ? [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2] : null;
}
