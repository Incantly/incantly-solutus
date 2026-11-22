/**
 * docs/design/performance.md 2.2 item 4 (paths are tessellated once) and board design 9 item 4 (BR-73): vector paths as
 * indexed triangles for the GPU. A fill is a fan or an ear-clipped polygon; a stroke is quads, round joins and round caps
 * whose union is the line; what cannot be filled is refused with `false`.
 */
import { describe, expect, it } from 'vitest';
import { PATH_OP_CLOSE, PATH_OP_CUBIC, PATH_OP_LINE, PATH_OP_MOVE, fillMesh, flattenPath, newSink, strokeMesh } from '@incantly/view';
import type { Contour, MeshSink } from '@incantly/view';

const M = PATH_OP_MOVE;
const L = PATH_OP_LINE;
const Z = PATH_OP_CLOSE;
const C = PATH_OP_CUBIC;

const square = (x: number, y: number, w: number, h: number): number[] => [M, x, y, L, x + w, y, L, x + w, y + h, L, x, y + h, Z];

/** The area covered by the triangles of a sink (each counted once, whatever its winding). */
function area(sink: MeshSink): number {
  let a = 0;
  for (let i = 0; i + 2 < sink.indices.length; i += 3) {
    const [p, q, r] = [sink.indices[i] as number, sink.indices[i + 1] as number, sink.indices[i + 2] as number];
    const ax = sink.vertices[p * 2] as number;
    const ay = sink.vertices[p * 2 + 1] as number;
    a += Math.abs(((sink.vertices[q * 2] as number) - ax) * ((sink.vertices[r * 2 + 1] as number) - ay) - ((sink.vertices[r * 2] as number) - ax) * ((sink.vertices[q * 2 + 1] as number) - ay)) / 2;
  }
  return a;
}

const bounds = (sink: MeshSink): { minX: number; minY: number; maxX: number; maxY: number } => {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let i = 0; i < sink.vertices.length; i += 2) {
    b.minX = Math.min(b.minX, sink.vertices[i] as number);
    b.maxX = Math.max(b.maxX, sink.vertices[i] as number);
    b.minY = Math.min(b.minY, sink.vertices[i + 1] as number);
    b.maxY = Math.max(b.maxY, sink.vertices[i + 1] as number);
  }
  return b;
};

describe('flattening a path', () => {
  it('a rectangle is one closed contour of its four corners', () => {
    const c = flattenPath(square(0, 0, 10, 5), 0.1);
    expect(c).toHaveLength(1);
    expect(c[0]?.closed).toBe(true);
    expect(c[0]?.points.slice(0, 8)).toEqual([0, 0, 10, 0, 10, 5, 0, 5]);
  });

  it('a curve gets more segments for a smaller tolerance, and every point is within the tolerance of the curve', () => {
    const d = [M, 0, 0, C, 0, 55, 100, 55, 100, 0];
    const coarse = flattenPath(d, 2)[0] as Contour;
    const fine = flattenPath(d, 0.05)[0] as Contour;
    expect(fine.points.length).toBeGreaterThan(coarse.points.length);
    // the curve's top is at y = 41.25 (t = 0.5); the fine polyline gets within the tolerance of it
    const top = Math.max(...fine.points.filter((_, i) => i % 2 === 1));
    expect(Math.abs(top - 41.25)).toBeLessThan(0.05 + 1e-6);
  });

  it('a path with two runs gives two contours, and an open run stays open', () => {
    const c = flattenPath([M, 0, 0, L, 5, 0, M, 10, 10, L, 20, 10], 0.1);
    expect(c.map((x) => x.closed)).toEqual([false, false]);
  });
});

describe('filling', () => {
  it('a rectangle is two triangles that cover its area', () => {
    const sink = newSink();
    expect(fillMesh(flattenPath(square(0, 0, 10, 5), 0.1), sink)).toBe(true);
    expect(sink.indices).toHaveLength(6);
    expect(area(sink)).toBeCloseTo(50, 9);
  });

  it('a clockwise and a counter-clockwise path fill the same area', () => {
    const a = newSink();
    const b = newSink();
    fillMesh(flattenPath([M, 0, 0, L, 10, 0, L, 10, 10, L, 0, 10, Z], 0.1), a);
    fillMesh(flattenPath([M, 0, 0, L, 0, 10, L, 10, 10, L, 10, 0, Z], 0.1), b);
    expect(area(a)).toBeCloseTo(100, 9);
    expect(area(b)).toBeCloseTo(100, 9);
  });

  it('an ellipse covers about pi a b', () => {
    const k = 0.5522847498307936;
    const rx = 50;
    const ry = 30;
    const d = [M, rx * 2, ry, C, rx * 2, ry + ry * k, rx + rx * k, ry * 2, rx, ry * 2, C, rx - rx * k, ry * 2, 0, ry + ry * k, 0, ry, C, 0, ry - ry * k, rx - rx * k, 0, rx, 0, C, rx + rx * k, 0, rx * 2, ry - ry * k, rx * 2, ry, Z];
    const sink = newSink();
    expect(fillMesh(flattenPath(d, 0.05), sink)).toBe(true);
    expect(area(sink)).toBeGreaterThan(Math.PI * rx * ry * 0.995);
    expect(area(sink)).toBeLessThan(Math.PI * rx * ry * 1.005);
  });

  it('a concave star is ear-clipped: its area is the polygon\'s, none of it outside', () => {
    const pts: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 50 : 20;
      const a = (Math.PI * i) / 5 - Math.PI / 2;
      pts.push(50 + r * Math.cos(a), 50 + r * Math.sin(a));
    }
    const d: number[] = [];
    for (let i = 0; i < pts.length; i += 2) d.push(i === 0 ? M : L, pts[i] as number, pts[i + 1] as number);
    d.push(Z);
    let shoelace = 0;
    for (let i = 0; i < pts.length; i += 2) {
      const j = (i + 2) % pts.length;
      shoelace += (pts[i] as number) * (pts[j + 1] as number) - (pts[j] as number) * (pts[i + 1] as number);
    }
    const sink = newSink();
    expect(fillMesh(flattenPath(d, 0.1), sink)).toBe(true);
    expect(sink.indices).toHaveLength((10 - 2) * 3);
    expect(area(sink)).toBeCloseTo(Math.abs(shoelace) / 2, 6);
  });

  it('refuses what it cannot fill: two contours, a bow tie, no area', () => {
    const two = newSink();
    expect(fillMesh(flattenPath([...square(0, 0, 10, 10), ...square(2, 2, 3, 3)], 0.1), two)).toBe(false);
    const bow = newSink();
    expect(fillMesh(flattenPath([M, 0, 0, L, 10, 10, L, 10, 0, L, 0, 10, Z], 0.1), bow)).toBe(false);
    const flat = newSink();
    expect(fillMesh(flattenPath([M, 0, 0, L, 5, 0, L, 10, 0, Z], 0.1), flat)).toBe(false);
    expect([two, bow, flat].map((s) => s.indices.length)).toEqual([0, 0, 0]);
  });

  it('a repeated closing point does not make a bad triangle', () => {
    const sink = newSink();
    expect(fillMesh(flattenPath([M, 0, 0, L, 10, 0, L, 10, 10, L, 0, 10, L, 0, 0, Z], 0.1), sink)).toBe(true);
    expect(area(sink)).toBeCloseTo(100, 9);
  });
});

describe('stroking', () => {
  it('a straight butt-capped line is a rectangle of its length and width', () => {
    const sink = newSink();
    strokeMesh(flattenPath([M, 0, 0, L, 100, 0], 0.1), 10, 'butt', [], 0.1, sink);
    expect(area(sink)).toBeCloseTo(1000, 6);
    expect(bounds(sink)).toEqual({ minX: 0, maxX: 100, minY: -5, maxY: 5 });
  });

  it('round caps add half a disc at each end', () => {
    const sink = newSink();
    strokeMesh(flattenPath([M, 0, 0, L, 100, 0], 0.1), 10, 'round', [], 0.01, sink);
    const b = bounds(sink);
    // the arc is within the tolerance (0.01) of the circle, so its far point is at least 4.99 out
    expect(b.minX).toBeLessThan(-4.99);
    expect(b.minX).toBeGreaterThan(-5.0001);
    expect(b.maxX).toBeGreaterThan(104.99);
    expect(area(sink)).toBeGreaterThan(1000 + Math.PI * 25 * 0.99);
  });

  it('a closed square has joins on every corner: the outer corners are round, the inner ones are filled', () => {
    const sink = newSink();
    strokeMesh(flattenPath(square(0, 0, 100, 100), 0.1), 10, 'butt', [], 0.01, sink);
    const b = bounds(sink);
    expect(b.minX).toBeLessThan(-4.99);
    expect(b.maxX).toBeGreaterThan(104.99);
    // a ring of width 10 round a 100 square: the area of the ring with round outer corners
    const expected = 4 * 100 * 10 + Math.PI * 25;
    expect(area(sink)).toBeGreaterThan(expected * 0.99);
    expect(area(sink)).toBeLessThan(expected * 1.01 + 1);
  });

  it('a dashed line is pieces with gaps: the covered area is the dash share of the line', () => {
    const sink = newSink();
    strokeMesh(flattenPath([M, 0, 0, L, 100, 0], 0.1), 4, 'butt', [10, 10], 0.1, sink);
    expect(area(sink)).toBeCloseTo(50 * 4, 6);
    // there is nothing in a gap: x from 10 to 20 holds no vertex
    const xs = sink.vertices.filter((_, i) => i % 2 === 0);
    expect(xs.some((x) => x > 10.001 && x < 19.999)).toBe(false);
  });

  it('a dotted line with round caps is a row of discs', () => {
    const sink = newSink();
    strokeMesh(flattenPath([M, 0, 0, L, 100, 0], 0.1), 6, 'round', [0.5, 12], 0.05, sink);
    const b = bounds(sink);
    expect(b.minY).toBeCloseTo(-3, 2);
    expect(b.maxY).toBeCloseTo(3, 2);
    expect(area(sink)).toBeGreaterThan(8 * Math.PI * 9 * 0.9);
  });

  it('a width of zero or less, or a single point with butt caps, adds nothing', () => {
    const none = newSink();
    strokeMesh(flattenPath([M, 0, 0, L, 100, 0], 0.1), 0, 'butt', [], 0.1, none);
    strokeMesh(flattenPath([M, 5, 5], 0.1), 4, 'butt', [], 0.1, none);
    expect(none.indices).toEqual([]);
  });

  it('every index points at a vertex', () => {
    const sink = newSink();
    strokeMesh(flattenPath([M, 0, 0, C, 0, 55, 100, 55, 100, 0, L, 50, -30, Z], 0.1), 7, 'round', [12, 5], 0.1, sink);
    expect(sink.indices.length).toBeGreaterThan(0);
    expect(Math.max(...sink.indices)).toBeLessThan(sink.vertices.length / 2);
    expect(sink.vertices.every(Number.isFinite)).toBe(true);
  });
});
