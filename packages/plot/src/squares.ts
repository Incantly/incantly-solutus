/**
 * Marching squares: segment and polygon tables plus deterministic linking.
 * Pure tables over corner signs; the tracers supply values and correct the
 * crossings. Shared by the implicit tracer and the inequality filler
 * (curves-loci 6 and 7).
 *
 * Corners: 0 = SW(x0,y0), 1 = SE(x1,y0), 2 = NE(x1,y1), 3 = NW(x0,y1).
 * Edges: 0 = bottom (SW-SE), 1 = right (SE-NE), 2 = top (NE-NW), 3 = left (NW-SW).
 */
export type SquareEdge = 0 | 1 | 2 | 3;

const EDGE_ENDS: Readonly<Record<SquareEdge, readonly [number, number]>> = {
  0: [0, 1],
  1: [1, 2],
  2: [2, 3],
  3: [3, 0],
};

/** Case index from inside flags (bit i = corner i inside). */
export function caseIndex(sw: boolean, se: boolean, ne: boolean, nw: boolean): number {
  return (sw ? 1 : 0) | (se ? 2 : 0) | (ne ? 4 : 0) | (nw ? 8 : 0);
}

export function isSaddleCase(idx: number): boolean {
  return idx === 5 || idx === 10;
}

function pair(a: SquareEdge, b: SquareEdge): readonly [SquareEdge, SquareEdge] {
  return [a, b];
}

/**
 * Boundary segments of a leaf as edge pairs. Saddles (5 and 10) follow the
 * centre decider: `centerInside` picks the configuration that connects (or
 * splits) the inside corners through the centre.
 */
export function segmentsForCase(idx: number, centerInside: boolean): readonly (readonly [SquareEdge, SquareEdge])[] {
  switch (idx) {
    case 0:
    case 15:
      return [];
    case 1:
      return [pair(3, 0)];
    case 2:
      return [pair(0, 1)];
    case 3:
      return [pair(3, 1)];
    case 4:
      return [pair(1, 2)];
    case 5:
      return centerInside ? [pair(0, 1), pair(2, 3)] : [pair(3, 0), pair(1, 2)];
    case 6:
      return [pair(0, 2)];
    case 7:
      return [pair(3, 2)];
    case 8:
      return [pair(2, 3)];
    case 9:
      return [pair(0, 2)];
    case 10:
      return centerInside ? [pair(3, 0), pair(1, 2)] : [pair(0, 1), pair(2, 3)];
    case 11:
      return [pair(2, 1)];
    case 12:
      return [pair(1, 3)];
    case 13:
      return [pair(0, 1)];
    case 14:
      return [pair(3, 0)];
    default:
      return [];
  }
}

/** Linear-interpolation factor of the zero along edge ends with values va, vb. */
export function crossingT(va: number, vb: number): number {
  if (!Number.isFinite(va) || !Number.isFinite(vb)) return 0.5;
  const d = va - vb;
  if (!(d !== 0)) return 0.5;
  const t = va / d;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export type PolyVertex = { readonly corner: number } | { readonly edge: SquareEdge; readonly t: number };

/**
 * The inside polygon of a leaf: corners and edge crossings in perimeter order
 * (SW, bottom, SE, right, NE, top, NW, left). Saddles return `saddle: true`
 * instead of a bowtie; the caller supersamples those leaves.
 */
export function polygonForCase(
  idx: number,
  ts: Readonly<Record<SquareEdge, number | undefined>>,
): { readonly saddle: true } | { readonly saddle: false; readonly vertices: readonly PolyVertex[] } {
  if (isSaddleCase(idx)) return { saddle: true };
  const inside = (bit: number): boolean => (idx & bit) !== 0;
  const vertices: PolyVertex[] = [];
  const corners: Readonly<{ bit: number; corner: number; edge: SquareEdge }[]> = [
    { bit: 1, corner: 0, edge: 0 },
    { bit: 2, corner: 1, edge: 1 },
    { bit: 4, corner: 2, edge: 2 },
    { bit: 8, corner: 3, edge: 3 },
  ];
  for (const c of corners) {
    if (inside(c.bit)) vertices.push({ corner: c.corner });
    const t = ts[c.edge];
    if (t !== undefined) vertices.push({ edge: c.edge, t });
  }
  return { saddle: false, vertices };
}

/** Ends of an edge as corner indices, for interpolating crossing positions. */
export function edgeEnds(edge: SquareEdge): readonly [number, number] {
  return EDGE_ENDS[edge];
}

/* ---------------------------- numeric refinement ---------------------------- */

/**
 * Central-difference gradient of f at (x, y); null when any sample is not finite.
 * Pure: the caller counts evaluations and enforces budgets.
 */
export function numericGradient(
  f: (x: number, y: number) => number,
  x: number,
  y: number,
  h: number,
): { readonly gx: number; readonly gy: number } | null {
  const fx1 = f(x + h, y);
  const fx0 = f(x - h, y);
  const fy1 = f(x, y + h);
  const fy0 = f(x, y - h);
  if (!Number.isFinite(fx1) || !Number.isFinite(fx0) || !Number.isFinite(fy1) || !Number.isFinite(fy0)) return null;
  return { gx: (fx1 - fx0) / (2 * h), gy: (fy1 - fy0) / (2 * h) };
}

export interface RefinedCrossing {
  readonly x: number;
  readonly y: number;
  readonly singular: boolean;
}

/**
 * One or two damped Newton steps towards `f = 0` from (x, y). Steps never
 * exceed `maxStep`; a vanishing gradient reports `singular` and keeps the
 * point. Pure: the caller counts evaluations.
 */
export function refineCrossing(
  f: (x: number, y: number) => number,
  x: number,
  y: number,
  h: number,
  maxStep: number,
  scale: number,
): RefinedCrossing {
  let cx = x;
  let cy = y;
  for (let iter = 0; iter < 2; iter++) {
    const v = f(cx, cy);
    if (!Number.isFinite(v)) return { x, y, singular: false };
    const g = numericGradient(f, cx, cy, h);
    if (!g) return { x: cx, y: cy, singular: false };
    const n2 = g.gx * g.gx + g.gy * g.gy;
    if (!(n2 > 0) || Math.sqrt(n2) * maxStep < 1e-9 * scale) return { x: cx, y: cy, singular: true };
    const dx = (v * g.gx) / n2;
    const dy = (v * g.gy) / n2;
    const len = Math.hypot(dx, dy);
    if (!(len > 0) || !Number.isFinite(len)) return { x: cx, y: cy, singular: false };
    const k = len > maxStep ? maxStep / len : 1;
    cx -= dx * k;
    cy -= dy * k;
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return { x, y, singular: false };
    if (Math.abs(v) < 1e-12 * scale) break;
  }
  return { x: cx, y: cy, singular: false };
}

/* --------------------------------- linking ---------------------------------- */

export interface RawSegment {
  readonly keyA: string;
  readonly keyB: string;
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
}

export interface LinkedChain {
  /** Points in maths units, without a repeated closing point. */
  readonly points: readonly (readonly [number, number])[];
  readonly closed: boolean;
  readonly firstKey: string;
}

/**
 * Chains segments that share edge keys into polylines. Degree-3+ joints
 * (singular points) pair nearest endpoints. Output order is deterministic:
 * segments are processed sorted by key and chains sorted by first key
 * (curves-loci 6, step 6).
 */
export function linkSegments(segments: readonly RawSegment[]): LinkedChain[] {
  const segs = [...segments].sort((a, b) => (a.keyA < b.keyA ? -1 : a.keyA > b.keyA ? 1 : a.keyB < b.keyB ? -1 : a.keyB > b.keyB ? 1 : 0));
  const atKey = new Map<string, number[]>();
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i] as RawSegment;
    const la = atKey.get(s.keyA);
    if (la) la.push(i);
    else atKey.set(s.keyA, [i]);
    const lb = atKey.get(s.keyB);
    if (lb) lb.push(i);
    else atKey.set(s.keyB, [i]);
  }
  const used = new Array<boolean>(segs.length).fill(false);
  const chains: LinkedChain[] = [];
  const farPoint = (i: number, key: string): readonly [number, number] => {
    const s = segs[i] as RawSegment;
    return s.keyA === key && s.keyB !== key ? [s.bx, s.by] : [s.ax, s.ay];
  };
  const farKey = (i: number, key: string): string => {
    const s = segs[i] as RawSegment;
    return s.keyA === key && s.keyB !== key ? s.keyB : s.keyA;
  };
  const dist2 = (p: readonly [number, number], q: readonly [number, number]): number => {
    const dx = p[0] - q[0];
    const dy = p[1] - q[1];
    return dx * dx + dy * dy;
  };
  for (let start = 0; start < segs.length; start++) {
    if (used[start]) continue;
    used[start] = true;
    const s0 = segs[start] as RawSegment;
    if (s0.keyA === s0.keyB) {
      chains.push({ points: [[s0.ax, s0.ay], [s0.bx, s0.by]], closed: true, firstKey: s0.keyA });
      continue;
    }
    const keys: string[] = [s0.keyA, s0.keyB];
    const points: [number, number][] = [[s0.ax, s0.ay], [s0.bx, s0.by]];
    // Extend the front (last key).
    for (;;) {
      const tip = keys[keys.length - 1] as string;
      if (tip === keys[0] && points.length > 2) break;
      const cands = (atKey.get(tip) ?? []).filter((i) => !used[i]);
      if (cands.length === 0) break;
      const tipPt = points[points.length - 1] as [number, number];
      cands.sort((a, b) => dist2(farPoint(a, tip), tipPt) - dist2(farPoint(b, tip), tipPt) || a - b);
      const next = cands[0] as number;
      used[next] = true;
      keys.push(farKey(next, tip));
      const fp = farPoint(next, tip);
      points.push([fp[0], fp[1]]);
    }
    // Extend the back (first key), unless already closed.
    if (keys[0] !== keys[keys.length - 1]) {
      for (;;) {
        const tip = keys[0] as string;
        const cands = (atKey.get(tip) ?? []).filter((i) => !used[i]);
        if (cands.length === 0) break;
        const tipPt = points[0] as [number, number];
        cands.sort((a, b) => dist2(farPoint(a, tip), tipPt) - dist2(farPoint(b, tip), tipPt) || a - b);
        const next = cands[0] as number;
        used[next] = true;
        keys.unshift(farKey(next, tip));
        const fp = farPoint(next, tip);
        points.unshift([fp[0], fp[1]]);
        if (keys[0] === keys[keys.length - 1]) break;
      }
    }
    const closed = keys[0] === keys[keys.length - 1] && points.length > 2;
    const pts = closed ? points.slice(0, points.length - 1) : points;
    chains.push({ points: pts, closed, firstKey: [...keys].sort()[0] as string });
  }
  chains.sort((a, b) => (a.firstKey < b.firstKey ? -1 : a.firstKey > b.firstKey ? 1 : 0));
  return chains;
}
