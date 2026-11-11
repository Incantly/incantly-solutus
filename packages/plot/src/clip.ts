/**
 * Clips pixel polylines to the view rectangle (curves-loci 6, step 6: a chain
 * that ends at the view border ends there). Pure; pieces keep their order.
 */
export type Pt = readonly [number, number];

/** Liang-Barsky clip of one segment; null when it lies wholly outside. */
function clipSegment(a: Pt, b: Pt, w: number, h: number): readonly [Pt, Pt] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const edges: readonly (readonly [number, number])[] = [
    [-dx, a[0]],
    [dx, w - a[0]],
    [-dy, a[1]],
    [dy, h - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  return [
    t0 === 0 ? a : [a[0] + t0 * dx, a[1] + t0 * dy],
    t1 === 1 ? b : [a[0] + t1 * dx, a[1] + t1 * dy],
  ];
}

/**
 * Clips a polyline (closed ones are walked once round). Returns the pieces
 * inside the rectangle and whether anything was cut; a closed polyline that
 * was not cut comes back whole, with `cut` false.
 */
export function clipPolyline(points: readonly Pt[], closed: boolean, w: number, h: number): { pieces: Pt[][]; cut: boolean } {
  const walk: Pt[] = closed && points.length > 0 ? [...points, points[0] as Pt] : [...points];
  const pieces: Pt[][] = [];
  let current: Pt[] = [];
  let cut = false;
  for (let i = 0; i + 1 < walk.length; i++) {
    const a = walk[i] as Pt;
    const b = walk[i + 1] as Pt;
    const seg = clipSegment(a, b, w, h);
    if (seg === null) {
      cut = true;
      if (current.length > 1) pieces.push(current);
      current = [];
      continue;
    }
    if (seg[0] !== a) cut = true;
    if (seg[1] !== b) cut = true;
    if (current.length === 0 || seg[0] !== a) {
      if (current.length > 1) pieces.push(current);
      current = [seg[0]];
    }
    current.push(seg[1]);
    if (seg[1] !== b) {
      if (current.length > 1) pieces.push(current);
      current = [];
    }
  }
  if (current.length > 1) pieces.push(current);
  if (!cut && closed) return { pieces: [points.map((p) => p)], cut: false };
  return { pieces, cut };
}
