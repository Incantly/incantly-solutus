/**
 * The implicit tracer (curves-loci 6): a quadtree with certainty over the
 * view, marching squares in mixed leaves with Newton-corrected crossings,
 * small-feature probes, singular-point markers, and deterministic linking by
 * edge keys. With the kernel's interval enclosure the quadtree never drops a
 * cell the curve could cross; without it, sampling heuristics decide and
 * `rigorous` is false.
 */
import type { RelationValue, Result } from '@incantly/kernel';
import { DEFAULT_MAX_EVALS_IMPLICIT, MAX_SAMPLES_PER_CURVE } from './contracts';
import type {
  FieldEnclosure,
  ImplicitFieldInput,
  ImplicitPlot,
  ImplicitPlotOptions,
  PlotStats,
  ScalarBox,
  TraceQuality,
  ViewBox,
} from './contracts';
import { badArgument, checkBudgets, checkView, guard, isFiniteNumber, overLimit } from './errors';
import { caseIndex, crossingT, edgeEnds, linkSegments, segmentsForCase } from './squares';
import type { RawSegment, SquareEdge } from './squares';
import { clipPolyline } from './clip';
import { MarkerSet, makeMarker } from './markers';
import { PointMemo } from './memo';
import { thinChains } from './thin';
import { createView } from './view';
import type { PlotView } from './view';

interface INode {
  readonly i0: number;
  readonly i1: number;
  readonly j0: number;
  readonly j1: number;
  readonly level: number;
}

interface IState {
  readonly pv: PlotView;
  readonly residual: (x: number, y: number) => number;
  readonly level: number;
  readonly enclosure: FieldEnclosure | undefined;
  readonly leafEff: number;
  readonly cols: number;
  readonly rows: number;
  readonly padEff: number;
  readonly corners: Map<number, number>;
  /** Crossing per grid-edge key: both leaves sharing an edge use one point. */
  readonly crossings: Map<string, { x: number; y: number }>;
  /** Every residual call by exact input, so nothing is evaluated twice. */
  readonly memo: PointMemo;
  readonly segments: RawSegment[];
  readonly markers: MarkerSet;
  readonly maxSamples: number;
  readonly maxEvals: number;
  evals: number;
  intervalEvals: number;
  maxDepthSeen: number;
  rigorous: boolean;
  capped: boolean;
  dead: boolean;
}

/** Coarse cell size in effective pixels (curves-loci 6). */
const CELL_PX = 32;
/** Largest leaf grid (cells); larger views are refused with `limit`, as in the region filler. */
export const MAX_LEAF_CELLS = 32000000;
/** Most corner values and memoised inputs kept at once; older ones are re-evaluated if needed. */
const MAX_KEPT_VALUES = 1 << 20;

/* --------------------------------- helpers ---------------------------------- */

function leafCount(sizeEff: number, leafEff: number): number {
  return Math.max(1, Math.ceil(sizeEff / leafEff));
}

/** Maths x of grid line i. */
function gridX(st: IState, i: number): number {
  return st.pv.toX((-st.padEff + i * st.leafEff) / st.pv.dpr);
}

/** Maths y of grid line j (j grows downwards in pixels). */
function gridY(st: IState, j: number): number {
  return st.pv.toY((-st.padEff + j * st.leafEff) / st.pv.dpr);
}

/** Field minus level; NaN where undefined. Null when the budget is spent. Each input is evaluated once. */
function gEval(st: IState, x: number, y: number): number | null {
  const hit = st.memo.get(x, y);
  if (hit !== undefined) return hit;
  if (st.evals + st.intervalEvals >= st.maxEvals) {
    st.dead = true;
    return null;
  }
  st.evals += 1;
  const v = st.residual(x, y);
  const out = typeof v !== 'number' || Number.isNaN(v) ? Number.NaN : v - st.level;
  st.memo.set(x, y, out);
  return out;
}

/** Corner value, cached by grid indices so shared corners evaluate once. */
function cornerAt(st: IState, i: number, j: number): number | null {
  const key = (i + 2) * (st.rows + 6) + (j + 2);
  const hit = st.corners.get(key);
  if (hit !== undefined) return hit;
  const v = gEval(st, gridX(st, i), gridY(st, j));
  if (v === null) return null;
  if (st.corners.size >= MAX_KEPT_VALUES) st.corners.clear();
  st.corners.set(key, v);
  return v;
}

function boxAt(st: IState, node: INode): ScalarBox | null {
  const enc = st.enclosure;
  if (!enc) return null;
  if (st.evals + st.intervalEvals >= st.maxEvals) {
    st.dead = true;
    return null;
  }
  const box = enc(gridX(st, node.i0), gridX(st, node.i1), gridY(st, node.j1), gridY(st, node.j0));
  st.intervalEvals += 1;
  const num = (v: unknown): number => (typeof v === 'number' && !Number.isNaN(v) ? v : Number.NaN);
  const lo = num(box.lo);
  const hi = num(box.hi);
  const def = box.def === 0 || box.def === 1 || box.def === 2 ? box.def : 1;
  if (Number.isNaN(lo) || Number.isNaN(hi)) return { lo: Number.NEGATIVE_INFINITY, hi: Number.POSITIVE_INFINITY, def: 1 };
  return { lo: Math.min(lo, hi) - st.level, hi: Math.max(lo, hi) - st.level, def };
}

/* ------------------------------ Newton correct ------------------------------ */

/** One or two Newton steps along the numeric gradient; keeps the point when lost. */
function correctCrossing(st: IState, x: number, y: number): { x: number; y: number; singular: boolean } {
  const hMaths = Math.abs(gridX(st, 1) - gridX(st, 0)) / 4;
  const h = hMaths > 0 ? hMaths : 1e-9;
  let cx = x;
  let cy = y;
  for (let iter = 0; iter < 2; iter++) {
    const f = gEval(st, cx, cy);
    if (f === null) return { x, y, singular: false };
    if (!Number.isFinite(f)) return { x, y, singular: false };
    const fx1 = gEval(st, cx + h, cy);
    const fx0 = gEval(st, cx - h, cy);
    const fy1 = gEval(st, cx, cy + h);
    const fy0 = gEval(st, cx, cy - h);
    if (fx1 === null || fx0 === null || fy1 === null || fy0 === null) return { x: cx, y: cy, singular: false };
    if (!Number.isFinite(fx1) || !Number.isFinite(fx0) || !Number.isFinite(fy1) || !Number.isFinite(fy0)) {
      return { x: cx, y: cy, singular: false };
    }
    const gx = (fx1 - fx0) / (2 * h);
    const gy = (fy1 - fy0) / (2 * h);
    const n2 = gx * gx + gy * gy;
    const scale = Math.max(1, Math.abs(f), Math.abs(st.level));
    if (!(n2 > 0) || Math.sqrt(n2) * hMaths * 4 < 1e-9 * scale) return { x: cx, y: cy, singular: true };
    const step = f / n2;
    // Damped: never step further than two leaf widths from the crossing.
    const maxStep = hMaths * 8;
    const dx = step * gx;
    const dy = step * gy;
    const len = Math.hypot(dx, dy);
    if (!(len > 0) || !Number.isFinite(len)) return { x: cx, y: cy, singular: false };
    const k = len > maxStep ? maxStep / len : 1;
    cx -= dx * k;
    cy -= dy * k;
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return { x, y, singular: false };
    if (Math.abs(f) < 1e-12 * scale) break;
  }
  // Keep the correction only when it moved the point closer to the level set.
  const before = gEval(st, x, y);
  const after = gEval(st, cx, cy);
  if (before === null || after === null) return { x, y, singular: false };
  if (!Number.isFinite(after) || (Number.isFinite(before) && !(Math.abs(after) < Math.abs(before)))) {
    return { x, y, singular: false };
  }
  return { x: cx, y: cy, singular: false };
}

/* ------------------------------- leaf emit ---------------------------------- */

interface LeafCorners {
  readonly v00: number;
  readonly v10: number;
  readonly v11: number;
  readonly v01: number;
}

function leafCorners(st: IState, i: number, j: number): LeafCorners | null {
  const vNW = cornerAt(st, i, j);
  const vNE = cornerAt(st, i + 1, j);
  const vSW = cornerAt(st, i, j + 1);
  const vSE = cornerAt(st, i + 1, j + 1);
  if (vNW === null || vNE === null || vSW === null || vSE === null) return null;
  return { v00: vSW, v10: vSE, v11: vNE, v01: vNW };
}

function cornerPoint(st: IState, i: number, j: number, corner: number): readonly [number, number] {
  switch (corner) {
    case 0:
      return [gridX(st, i), gridY(st, j + 1)];
    case 1:
      return [gridX(st, i + 1), gridY(st, j + 1)];
    case 2:
      return [gridX(st, i + 1), gridY(st, j)];
    default:
      return [gridX(st, i), gridY(st, j)];
  }
}

function edgeKey(i: number, j: number, edge: SquareEdge): string {
  // Bottom/top edges are horizontal grid lines, left/right vertical ones.
  switch (edge) {
    case 0:
      return `H:${i}:${j + 1}`;
    case 1:
      return `V:${i + 1}:${j}`;
    case 2:
      return `H:${i}:${j}`;
    default:
      return `V:${i}:${j}`;
  }
}

/** Emits marching-squares segments for one leaf; uniform leaves probe for small features. */
function emitLeaf(st: IState, i: number, j: number): void {
  const c = leafCorners(st, i, j);
  if (!c) return;
  const vals = [c.v00, c.v10, c.v11, c.v01];
  if (vals.some((v) => Number.isNaN(v))) return;
  const pos = vals.map((v) => !(v < 0));
  const idx = caseIndex(pos[0] as boolean, pos[1] as boolean, pos[2] as boolean, pos[3] as boolean);
  if (idx === 0 || idx === 15) {
    probeSmallFeature(st, i, j);
    // A corner exactly on the level with every neighbour strictly on one side:
    // a touching point (a tangency, or an isolated solution).
    for (let k = 0; k < 4; k++) {
      if (vals[k] !== 0) continue;
      const ci = i + (k === 1 || k === 2 ? 1 : 0);
      const cj = j + (k === 0 || k === 1 ? 1 : 0);
      let pos = 0;
      let neg = 0;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          if (di === 0 && dj === 0) continue;
          const v = cornerAt(st, ci + di, cj + dj);
          if (v === null) return;
          if (v > 0) pos += 1;
          else if (v < 0) neg += 1;
        }
      }
      if (pos === 8 || neg === 8) {
        const pt = cornerPoint(st, i, j, k);
        addMarker(st, 'isolated', pt[0], pt[1]);
      }
    }
    return;
  }
  let centerInside = false;
  if (idx === 5 || idx === 10) {
    const cx = (gridX(st, i) + gridX(st, i + 1)) / 2;
    const cy = (gridY(st, j) + gridY(st, j + 1)) / 2;
    const vc = gEval(st, cx, cy);
    if (vc === null) return;
    centerInside = !(vc < 0) && !Number.isNaN(vc);
  }
  const segs = segmentsForCase(idx, centerInside);
  const crossing = (edge: SquareEdge): readonly [number, number] | null => {
    // Both leaves sharing an edge use the same crossing point, computed once.
    const key = edgeKey(i, j, edge);
    const cached = st.crossings.get(key);
    if (cached) return [cached.x, cached.y];
    const [ca, cb] = edgeEnds(edge);
    const va = vals[ca] as number;
    const vb = vals[cb] as number;
    const t = crossingT(va, vb);
    const pa = cornerPoint(st, i, j, ca);
    const pb = cornerPoint(st, i, j, cb);
    const fixed = correctCrossing(st, pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t);
    if (st.dead) return null;
    if (fixed.singular) addMarker(st, 'singular', fixed.x, fixed.y);
    st.crossings.set(key, { x: fixed.x, y: fixed.y });
    return [fixed.x, fixed.y];
  };
  for (const [ea, eb] of segs) {
    const pa = crossing(ea);
    if (!pa) return;
    const pb = crossing(eb);
    if (!pb) return;
    if (!Number.isFinite(pa[0]) || !Number.isFinite(pa[1]) || !Number.isFinite(pb[0]) || !Number.isFinite(pb[1])) continue;
    st.segments.push({ keyA: edgeKey(i, j, ea), keyB: edgeKey(i, j, eb), ax: pa[0], ay: pa[1], bx: pb[0], by: pb[1] });
  }
}

/**
 * A uniform-sign leaf whose enclosure still contains the level may hold a tiny
 * loop or an isolated point: probe a subgrid and Newton-locate the zero.
 * Without an enclosure there is nothing to test, so nothing is probed.
 */
function probeSmallFeature(st: IState, i: number, j: number): void {
  if (!st.enclosure) return;
  const x0 = gridX(st, i);
  const x1 = gridX(st, i + 1);
  const yTop = gridY(st, j);
  const yBot = gridY(st, j + 1);
  const scale = Math.max(1, Math.abs(st.level));
  let bestX = 0;
  let bestY = 0;
  let bestAbs = Number.POSITIVE_INFINITY;
  let mixed = false;
  let firstSign = 0;
  for (let a = 0; a <= 4; a++) {
    for (let b = 0; b <= 4; b++) {
      const x = x0 + ((x1 - x0) * a) / 4;
      const y = yBot + ((yTop - yBot) * b) / 4;
      const v = gEval(st, x, y);
      if (v === null) return;
      if (Number.isNaN(v)) continue;
      const av = Math.abs(v);
      if (av < bestAbs) {
        bestAbs = av;
        bestX = x;
        bestY = y;
      }
      const sign = v > 0 ? 1 : v < 0 ? -1 : 0;
      if (sign !== 0) {
        if (firstSign === 0) firstSign = sign;
        else if (sign !== firstSign) mixed = true;
      }
    }
  }
  if (!mixed && !(bestAbs < 1e-3 * scale)) return;
  // Newton from the centre along the gradient, a few steps.
  let cx = (x0 + x1) / 2;
  let cy = (yTop + yBot) / 2;
  const h = Math.abs(x1 - x0) / 8 || 1e-12;
  for (let iter = 0; iter < 6; iter++) {
    const f = gEval(st, cx, cy);
    if (f === null) return;
    if (!Number.isFinite(f)) break;
    if (Math.abs(f) < 1e-9 * scale) {
      addMarker(st, 'isolated', cx, cy);
      return;
    }
    const fx1 = gEval(st, cx + h, cy);
    const fx0 = gEval(st, cx - h, cy);
    const fy1 = gEval(st, cx, cy + h);
    const fy0 = gEval(st, cx, cy - h);
    if (fx1 === null || fx0 === null || fy1 === null || fy0 === null) return;
    if (!Number.isFinite(fx1) || !Number.isFinite(fx0) || !Number.isFinite(fy1) || !Number.isFinite(fy0)) break;
    const gx = (fx1 - fx0) / (2 * h);
    const gy = (fy1 - fy0) / (2 * h);
    const n2 = gx * gx + gy * gy;
    if (!(n2 > 0)) break;
    cx -= (f * gx) / n2;
    cy -= (f * gy) / n2;
    if (cx < x0 - (x1 - x0) || cx > x1 + (x1 - x0) || cy < yBot - (yTop - yBot) || cy > yTop + (yTop - yBot)) break;
  }
  if (mixed) addMarker(st, 'isolated', bestX, bestY);
}

function addMarker(st: IState, kind: 'singular' | 'isolated', x: number, y: number): void {
  const marker = makeMarker(st.pv, kind, x, y);
  if (marker !== undefined) st.markers.add(marker);
}

/* -------------------------------- quadtree ---------------------------------- */

/**
 * Without an interval enclosure nothing proves a cell empty, so every leaf is
 * looked at: corners are evaluated once each, mixed leaves are traced. The
 * trace is honest but not certain (`rigorous` is false), and the cost follows
 * the area instead of the curve length.
 */
function runDense(st: IState): void {
  st.rigorous = false;
  for (let j = 0; j < st.rows; j++) {
    for (let i = 0; i < st.cols; i++) {
      if (st.dead) return;
      emitLeaf(st, i, j);
    }
  }
}

/**
 * Quadtree with certainty (curves-loci 6, step 1): a node whose enclosure
 * excludes the level (or is undefined) is dropped with all its children;
 * the rest split down to leaves, which are traced.
 */
function runQuadtree(st: IState): void {
  if (!st.enclosure) {
    runDense(st);
    return;
  }
  const per = Math.max(1, Math.round(CELL_PX / st.leafEff));
  const queue: INode[] = [];
  for (let j = 0; j < st.rows; j += per) {
    for (let i = 0; i < st.cols; i += per) {
      queue.push({ i0: i, i1: Math.min(i + per, st.cols), j0: j, j1: Math.min(j + per, st.rows), level: 0 });
    }
  }
  let head = 0;
  while (head < queue.length) {
    if (st.dead) return;
    const node = queue[head] as INode;
    head += 1;
    if (node.level > st.maxDepthSeen) st.maxDepthSeen = node.level;
    const leaf = node.i1 - node.i0 <= 1 && node.j1 - node.j0 <= 1;
    const box = boxAt(st, node);
    if (!box) return;
    if (box.def === 0 || box.lo > 0 || box.hi < 0) continue;
    if (leaf) {
      emitLeaf(st, node.i0, node.j0);
      continue;
    }
    splitNode(queue, node);
  }
}

function splitNode(queue: INode[], node: INode): void {
  // Split only axes wider than one leaf; degenerate children would loop forever.
  const mx = (node.i0 + node.i1) >> 1;
  const my = (node.j0 + node.j1) >> 1;
  const xs: readonly (readonly [number, number])[] =
    node.i1 - node.i0 > 1 ? [[node.i0, mx], [mx, node.i1]] : [[node.i0, node.i1]];
  const ys: readonly (readonly [number, number])[] =
    node.j1 - node.j0 > 1 ? [[node.j0, my], [my, node.j1]] : [[node.j0, node.j1]];
  for (const [i0, i1] of xs) {
    for (const [j0, j1] of ys) {
      if (i1 > i0 && j1 > j0) queue.push({ i0, i1, j0, j1, level: node.level + 1 });
    }
  }
}

/* --------------------------------- public ---------------------------------- */

function makeStats(st: IState, complete: boolean, samples: number): PlotStats {
  return {
    evals: st.evals,
    intervalEvals: st.intervalEvals,
    maxDepth: st.maxDepthSeen,
    complete,
    capped: st.capped,
    rigorous: st.rigorous,
    samples,
  };
}

/**
 * Traces `residual(x, y) = level` over a view (curves-loci 6). On `maxEvals`
 * exhaustion the result is `complete: false` with empty output; re-run with a
 * larger budget.
 */
export function traceImplicit(field: ImplicitFieldInput, view: ViewBox, options: ImplicitPlotOptions = {}): Result<ImplicitPlot> {
  return guard('traceImplicit', () => {
    const caller = 'traceImplicit';
    if (typeof field !== 'object' || field === null || typeof field.residual !== 'function') {
      return badArgument(caller, 'the field needs a residual(x, y) function', 'Pass a residual or fieldFromRelation(relation).');
    }
    const viewProblem = checkView(caller, view);
    if (viewProblem) return viewProblem;
    const budgetProblem = checkBudgets(caller, options.maxSamples, options.maxEvals);
    if (budgetProblem) return budgetProblem;
    const level = field.level ?? 0;
    if (!isFiniteNumber(level)) {
      return badArgument(caller, `level must be finite (got ${String(field.level)})`, 'Pass a finite level.');
    }
    const quality: TraceQuality = options.quality ?? 'final';
    if (quality !== 'draft' && quality !== 'final') {
      return badArgument(caller, `quality must be "draft" or "final" (got ${String(options.quality)})`, 'Pass quality "draft" while interacting, "final" after.');
    }
    const pvResult = createView(view);
    if (!pvResult.ok) return pvResult;
    const pv = pvResult.value;
    const leafEff = quality === 'final' ? 2 : 6;
    const padEff = Math.max(1, Math.round(CELL_PX / leafEff)) * leafEff;
    const cols = leafCount(pv.widthEff + 2 * padEff, leafEff);
    const rows = leafCount(pv.heightEff + 2 * padEff, leafEff);
    if (cols * rows > MAX_LEAF_CELLS) return overLimit(caller, 'leaf cells', MAX_LEAF_CELLS, cols * rows);
    const maxSamples = options.maxSamples === undefined ? MAX_SAMPLES_PER_CURVE : Math.floor(options.maxSamples);
    const st: IState = {
      pv,
      residual: field.residual,
      level,
      enclosure: field.enclosure,
      leafEff,
      cols,
      rows,
      padEff,
      corners: new Map(),
      crossings: new Map(),
      memo: new PointMemo(MAX_KEPT_VALUES),
      segments: [],
      markers: new MarkerSet(maxSamples),
      maxSamples,
      maxEvals: options.maxEvals === undefined ? DEFAULT_MAX_EVALS_IMPLICIT : Math.floor(options.maxEvals),
      evals: 0,
      intervalEvals: 0,
      maxDepthSeen: 0,
      rigorous: true,
      capped: false,
      dead: false,
    };
    runQuadtree(st);
    if (st.dead) {
      return { ok: true, value: { paths: [], closed: [], markers: [], stats: makeStats(st, false, 0) }, notices: [] };
    }
    const { paths, closed, samples } = finishChains(st, linkSegments(st.segments));
    if (st.markers.dropped) st.capped = true;
    const markers = st.markers.sorted();
    return { ok: true, value: { paths, closed, markers, stats: makeStats(st, true, samples) }, notices: [] };
  });
}

/**
 * Turns linked chains into output paths: loops smaller than a quarter pixel
 * collapse to an `isolated` marker (curves-loci 6, step 4), polylines are
 * clipped to the view, open chains run from their smaller end, chains are
 * sorted by their first point, and the sample cap thins what remains.
 */
function finishChains(
  st: IState,
  linked: readonly { readonly points: readonly (readonly [number, number])[]; readonly closed: boolean }[],
): { paths: Float64Array[]; closed: boolean[]; samples: number } {
  const pv = st.pv;
  const pieces: { pts: (readonly [number, number])[]; closed: boolean }[] = [];
  for (const chain of linked) {
    const px: (readonly [number, number])[] = [];
    for (const p of chain.points) {
      const q: readonly [number, number] = [pv.toPx(p[0]), pv.toPy(p[1])];
      const prev = px[px.length - 1];
      // Crossings that coincide (a curve through a grid corner) are one vertex.
      if (prev === undefined || Math.abs(prev[0] - q[0]) > 1e-9 || Math.abs(prev[1] - q[1]) > 1e-9) px.push(q);
    }
    if (px.length < 2) continue;
    if (chain.closed) {
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const p of px) {
        minX = Math.min(minX, p[0]);
        maxX = Math.max(maxX, p[0]);
        minY = Math.min(minY, p[1]);
        maxY = Math.max(maxY, p[1]);
      }
      if (Math.max(maxX - minX, maxY - minY) * pv.dpr < 0.25) {
        addMarker(st, 'isolated', pv.toX((minX + maxX) / 2), pv.toY((minY + maxY) / 2));
        continue;
      }
    }
    const clipped = clipPolyline(px, chain.closed, pv.box.widthPx, pv.box.heightPx);
    for (const piece of clipped.pieces) {
      const isClosed = chain.closed && !clipped.cut;
      let pts = piece;
      if (!isClosed) {
        const f = pts[0] as readonly [number, number];
        const l = pts[pts.length - 1] as readonly [number, number];
        if (l[0] < f[0] || (l[0] === f[0] && l[1] < f[1])) pts = [...pts].reverse();
      }
      pieces.push({ pts, closed: isClosed });
    }
  }
  pieces.sort((a, b) => {
    const fa = a.pts[0] as readonly [number, number];
    const fb = b.pts[0] as readonly [number, number];
    return fa[0] - fb[0] || fa[1] - fb[1];
  });
  // The sample cap bounds the emitted points too (performance.md 5).
  const thin = thinChains(
    pieces.map((p) => p.pts),
    st.maxSamples,
  );
  if (thin.thinned) st.capped = true;
  const paths: Float64Array[] = [];
  const closed: boolean[] = [];
  let samples = 0;
  for (let k = 0; k < thin.chains.length; k++) {
    const pts = thin.chains[k] as readonly (readonly [number, number])[];
    const arr = new Float64Array(pts.length * 2);
    for (let i = 0; i < pts.length; i++) {
      arr[2 * i] = (pts[i] as readonly [number, number])[0];
      arr[2 * i + 1] = (pts[i] as readonly [number, number])[1];
    }
    samples += pts.length;
    paths.push(arr);
    closed.push((pieces[k] as { closed: boolean }).closed);
  }
  return { paths, closed, samples };
}

/** Adapts a language relation (`lhs == rhs`, `lhs < rhs`, ...) to a traced field. */
export function fieldFromRelation(relation: RelationValue, level = 0): Result<ImplicitFieldInput> {
  return guard('fieldFromRelation', () => {
    if (typeof relation !== 'object' || relation === null || typeof relation.residual !== 'function') {
      return badArgument('fieldFromRelation', 'the relation has no residual(x, y)', 'Pass a RelationValue from the language.');
    }
    if (!isFiniteNumber(level)) {
      return badArgument('fieldFromRelation', `level must be finite (got ${String(level)})`, 'Pass a finite level.');
    }
    const residual = relation.residual;
    return { ok: true, value: { residual: (x: number, y: number): number => residual(x, y), level }, notices: [] };
  });
}
