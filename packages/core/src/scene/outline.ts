import type { Vec2 } from '../api/types';
import { equationExtent } from '../protocol/equation';
import { IDENTITY, local, multiply, worldMatrix, type Matrix } from './bounds';
import type { SceneGraph, VNode } from './graph';

/**
 * What each element of a stage draws, in the stage's own units, for the
 * line-end check (CH-2): open strokes as lists of points, closed or filled
 * shapes as outlines, and text as its box. Curves are flattened; transforms
 * of the element and its groups are applied.
 */

/** One piece of an element's drawing. */
export interface Outline {
  /** The element that draws it. */
  readonly id: number;
  readonly points: readonly Vec2[];
  /** A closed outline (a shape, a filled path, a text box); open strokes are false. */
  readonly closed: boolean;
  /** A box round text or an equation, which lines point at from a little way off. */
  readonly text?: boolean;
}

/** Steps a curve or arc is flattened into. */
const CURVE_STEPS = 8;

/** A subpath of path data: its points, curves flattened, and whether it closes. */
export interface Subpath {
  readonly points: Vec2[];
  closed: boolean;
  /** Made only of straight lines. */
  straight: boolean;
}

/** Path data as subpaths of points (SVG path grammar, absolute and relative commands). */
export function flattenPath(d: string): Subpath[] {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const out: Subpath[] = [];
  let current: Subpath | null = null;
  let command = 'M';
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // The last control point, for smooth curves.
  let cx = 0;
  let cy = 0;
  let i = 0;
  const read = () => Number(tokens[i++]);
  const add = (px: number, py: number) => {
    if (Number.isFinite(px) && Number.isFinite(py)) current?.points.push([px, py]);
  };
  const cubic = (x1: number, y1: number, x2: number, y2: number, ex: number, ey: number) => {
    for (let k = 1; k <= CURVE_STEPS; k++) {
      const t = k / CURVE_STEPS;
      const u = 1 - t;
      add(u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey);
    }
  };
  const quadratic = (x1: number, y1: number, ex: number, ey: number) => {
    for (let k = 1; k <= CURVE_STEPS; k++) {
      const t = k / CURVE_STEPS;
      const u = 1 - t;
      add(u * u * x + 2 * u * t * x1 + t * t * ex, u * u * y + 2 * u * t * y1 + t * t * ey);
    }
  };
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (/[A-Za-z]/.test(token)) {
      command = token;
      i++;
      if (command === 'Z' || command === 'z') {
        if (current) current.closed = true;
        x = startX;
        y = startY;
        current = null;
      }
      continue;
    }
    const relative = command === command.toLowerCase();
    const at = (vx: number, vy: number): Vec2 => (relative ? [x + vx, y + vy] : [vx, vy]);
    const upper = command.toUpperCase();
    if (upper !== 'M' && !current) {
      // Drawing on after a close starts a new subpath where the last one began.
      current = { points: [[x, y]], closed: false, straight: true };
      out.push(current);
    }
    switch (upper) {
      case 'M': {
        [x, y] = at(read(), read());
        startX = x;
        startY = y;
        current = { points: [[x, y]], closed: false, straight: true };
        out.push(current);
        command = relative ? 'l' : 'L';
        cx = x;
        cy = y;
        break;
      }
      case 'L': {
        [x, y] = at(read(), read());
        add(x, y);
        cx = x;
        cy = y;
        break;
      }
      case 'H':
        x = relative ? x + read() : read();
        add(x, y);
        cx = x;
        cy = y;
        break;
      case 'V':
        y = relative ? y + read() : read();
        add(x, y);
        cx = x;
        cy = y;
        break;
      case 'C': {
        const [x1, y1] = at(read(), read());
        const [x2, y2] = at(read(), read());
        const [ex, ey] = at(read(), read());
        cubic(x1, y1, x2, y2, ex, ey);
        current!.straight = false;
        [cx, cy, x, y] = [x2, y2, ex, ey];
        break;
      }
      case 'S': {
        const x1 = 2 * x - cx;
        const y1 = 2 * y - cy;
        const [x2, y2] = at(read(), read());
        const [ex, ey] = at(read(), read());
        cubic(x1, y1, x2, y2, ex, ey);
        current!.straight = false;
        [cx, cy, x, y] = [x2, y2, ex, ey];
        break;
      }
      case 'Q': {
        const [x1, y1] = at(read(), read());
        const [ex, ey] = at(read(), read());
        quadratic(x1, y1, ex, ey);
        current!.straight = false;
        [cx, cy, x, y] = [x1, y1, ex, ey];
        break;
      }
      case 'T': {
        const x1 = 2 * x - cx;
        const y1 = 2 * y - cy;
        const [ex, ey] = at(read(), read());
        quadratic(x1, y1, ex, ey);
        current!.straight = false;
        [cx, cy, x, y] = [x1, y1, ex, ey];
        break;
      }
      case 'A': {
        const rx = Math.abs(read());
        const ry = Math.abs(read());
        const rotation = (read() * Math.PI) / 180;
        const large = read() !== 0;
        const sweep = read() !== 0;
        const [ex, ey] = at(read(), read());
        arc(x, y, rx, ry, rotation, large, sweep, ex, ey, add);
        current!.straight = false;
        [cx, cy, x, y] = [ex, ey, ex, ey];
        break;
      }
      default:
        i++;
    }
  }
  return out.filter((sub) => sub.points.length > 0);
}

/** An elliptical arc as points, by the SVG endpoint-to-centre conversion. */
function arc(x1: number, y1: number, rx: number, ry: number, phi: number, large: boolean, sweep: boolean, x2: number, y2: number, add: (x: number, y: number) => void): void {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) {
    add(x2, y2);
    return;
  }
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  // Radii too small for the endpoints grow until they reach.
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * rx * yp) / ry;
  const cyp = (-k * ry * xp) / rx;
  const ox = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const oy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let delta = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;
  const steps = Math.max(2, Math.ceil((Math.abs(delta) / (Math.PI / 2)) * CURVE_STEPS));
  for (let s = 1; s <= steps; s++) {
    const t = start + (delta * s) / steps;
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    add(cos * ex - sin * ey + ox, sin * ex + cos * ey + oy);
  }
}

const num = (node: VNode, name: string, fallback = 0): number => {
  const raw = node.attrs.get(name);
  if (raw === undefined) return fallback;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
};

const apply = (m: Matrix, [px, py]: Vec2): Vec2 => [m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]];

/** The outlines one element draws in its own coordinates. */
function own(node: VNode): Array<{ points: Vec2[]; closed: boolean; text?: boolean }> {
  switch (node.kind) {
    case 'line':
      return [
        {
          points: [
            [num(node, 'x1'), num(node, 'y1')],
            [num(node, 'x2'), num(node, 'y2')],
          ],
          closed: false,
        },
      ];
    case 'circle': {
      const cx = num(node, 'cx');
      const cy = num(node, 'cy');
      const r = num(node, 'r');
      const points: Vec2[] = [];
      for (let k = 0; k < 24; k++) points.push([cx + r * Math.cos((k * Math.PI) / 12), cy + r * Math.sin((k * Math.PI) / 12)]);
      return [{ points, closed: true }];
    }
    case 'rect': {
      const x = num(node, 'x');
      const y = num(node, 'y');
      const w = num(node, 'width');
      const h = num(node, 'height');
      return [
        {
          points: [
            [x, y],
            [x + w, y],
            [x + w, y + h],
            [x, y + h],
          ],
          closed: true,
        },
      ];
    }
    case 'path':
      return flattenPath(node.attrs.get('d') ?? '').map((sub) => ({ points: sub.points, closed: sub.closed || node.fill }));
    case 'polyline': {
      const points = (node.attrs.get('points') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((pair): Vec2 => {
          const [px = Number.NaN, py = Number.NaN] = pair.split(',').map(Number);
          return [px, py];
        })
        .filter(([px, py]) => Number.isFinite(px) && Number.isFinite(py));
      return [{ points, closed: node.fill }];
    }
    case 'text':
    case 'math': {
      const size = num(node, 'font-size', node.kind === 'math' ? 16 : 14);
      const { width, height } = node.kind === 'math' ? equationExtent(node.text ?? '', size) : { width: (node.text ?? '').length * size * 0.6, height: size };
      const x = num(node, 'x');
      const y = num(node, 'y');
      const anchor = node.attrs.get('text-anchor');
      const left = anchor === 'middle' || (node.kind === 'math' && anchor !== 'start' && anchor !== 'end') ? x - width / 2 : anchor === 'end' ? x - width : x;
      const top = node.kind === 'math' || node.attrs.get('dominant-baseline') === 'middle' ? y - height / 2 : y - height * 0.8;
      return [
        {
          points: [
            [left, top],
            [left + width, top],
            [left + width, top + height],
            [left, top + height],
          ],
          closed: true,
          text: true,
        },
      ];
    }
    default:
      return [];
  }
}

/** Every visible element's outlines on a stage, in the stage's units. */
export function stageOutlines(graph: SceneGraph, stageId: number): Outline[] {
  const out: Outline[] = [];
  const visit = (id: number, matrix: Matrix, owner: number | null) => {
    const node = graph.nodes.get(id);
    if (!node || node.hidden) return;
    const m = node.kind === 'stage' ? matrix : multiply(matrix, local(node.transform));
    if (node.kind === 'g' || node.kind === 'stage') {
      for (const child of node.children) visit(child, m, owner);
      return;
    }
    if (node.kind === 'use') {
      // A copy draws its source at its own place.
      const source = node.source === null ? undefined : graph.nodes.get(node.source);
      if (source) for (const piece of own(source)) out.push({ ...piece, id: owner ?? node.id, points: piece.points.map((p) => apply(multiply(m, local(source.transform)), p)) });
      return;
    }
    for (const piece of own(node)) out.push({ ...piece, id: owner ?? node.id, points: piece.points.map((p) => apply(m, p)) });
  };
  visit(stageId, IDENTITY, null);
  return out;
}

/** An element's own outlines in the stage's units, through its groups' transforms. */
export function elementOutlines(graph: SceneGraph, node: VNode): Outline[] {
  const m = worldMatrix(graph, node);
  return own(node).map((piece) => ({ ...piece, id: node.id, points: piece.points.map((p) => apply(m, p)) }));
}
