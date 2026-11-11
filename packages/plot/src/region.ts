/**
 * The inequality filler (curves-loci 7): a quadtree over the view that fills
 * true cells (merged into maximal rectangles by rows), skips false cells, and
 * resolves boundary leaves into polygons, with borders traced per primitive
 * and one-variable predicates filled as bands. With the kernel's three-valued
 * enclosure the quadtree is certain; without it, sampling heuristics decide
 * and `rigorous` is false.
 */
import type { RelationValue, Result } from '@incantly/kernel';
import { DEFAULT_MAX_EVALS_REGION, MAX_SAMPLES_PER_CURVE } from './contracts';
import type {
  BoundaryInput,
  ImplicitFieldInput,
  PlotStats,
  Predicate1DInput,
  Predicate1DOptions,
  Predicate1DPlot,
  PredicateEnclosure,
  PredicateInput,
  RegionBorder,
  RegionPlot,
  RegionPlotOptions,
  TraceQuality,
  TriState,
  ViewBox,
} from './contracts';
import { badArgument, checkBudgets, checkView, guard, isFiniteNumber, overLimit } from './errors';
import { traceImplicit } from './implicit';
import { MarkerSet, makeMarker } from './markers';
import { caseIndex, crossingT, edgeEnds, numericGradient, polygonForCase, refineCrossing } from './squares';
import type { SquareEdge } from './squares';
import { createView } from './view';
import type { PlotView } from './view';

interface RNode {
  readonly i0: number;
  readonly i1: number;
  readonly j0: number;
  readonly j1: number;
  readonly level: number;
}

interface RState {
  readonly pv: PlotView;
  readonly test: (x: number, y: number) => boolean | undefined;
  readonly boundaries: readonly BoundaryInput[];
  readonly enclosure: PredicateEnclosure | undefined;
  readonly leafEff: number;
  readonly cols: number;
  readonly rows: number;
  readonly padEff: number;
  readonly filled: Uint8Array;
  readonly polygons: Float64Array[];
  readonly extraRects: number[];
  readonly markers: MarkerSet;
  readonly maxSamples: number;
  readonly maxEvals: number;
  evals: number;
  intervalEvals: number;
  maxDepthSeen: number;
  rigorous: boolean;
  capped: boolean;
  dead: boolean;
  points: number;
}

const CELL_PX = 32;
/** Largest leaf bitmap (cells); larger views are refused with `limit`. */
const MAX_BITMAP_CELLS = 32000000;

/* --------------------------------- helpers ---------------------------------- */

function gridX(st: RState, i: number): number {
  return st.pv.toX((-st.padEff + i * st.leafEff) / st.pv.dpr);
}

function gridY(st: RState, j: number): number {
  return st.pv.toY((-st.padEff + j * st.leafEff) / st.pv.dpr);
}

/** Body test; counts as an evaluation. */
function testAt(st: RState, x: number, y: number): boolean | undefined | null {
  if (st.evals + st.intervalEvals >= st.maxEvals) {
    st.dead = true;
    return null;
  }
  st.evals += 1;
  const v = st.test(x, y);
  return v === true ? true : v === false ? false : undefined;
}

/** Margin evaluation; counts as an evaluation. */
function marginAt(st: RState, residual: (x: number, y: number) => number, x: number, y: number): number | null {
  if (st.evals + st.intervalEvals >= st.maxEvals) {
    st.dead = true;
    return null;
  }
  st.evals += 1;
  const v = residual(x, y);
  return typeof v === 'number' ? v : Number.NaN;
}

function encloseAt(st: RState, node: RNode): TriState | null {
  const enc = st.enclosure;
  if (!enc) return null;
  if (st.evals + st.intervalEvals >= st.maxEvals) {
    st.dead = true;
    return null;
  }
  const v = enc(gridX(st, node.i0), gridX(st, node.i1), gridY(st, node.j1), gridY(st, node.j0));
  st.intervalEvals += 1;
  return v === 'true' || v === 'false' || v === 'maybe' ? v : 'maybe';
}

/* -------------------------------- quadtree ---------------------------------- */

function runFill(st: RState): void {
  if (!st.enclosure) {
    runDense(st);
    return;
  }
  const per = Math.max(1, Math.round(CELL_PX / st.leafEff));
  const queue: RNode[] = [];
  for (let j = 0; j < st.rows; j += per) {
    for (let i = 0; i < st.cols; i += per) {
      queue.push({ i0: i, i1: Math.min(i + per, st.cols), j0: j, j1: Math.min(j + per, st.rows), level: 0 });
    }
  }
  let head = 0;
  while (head < queue.length) {
    if (st.dead) return;
    const node = queue[head] as RNode;
    head += 1;
    if (node.level > st.maxDepthSeen) st.maxDepthSeen = node.level;
    if (st.capped) {
      fillCoarse(st, node);
      continue;
    }
    const leaf = node.i1 - node.i0 <= 1 && node.j1 - node.j0 <= 1;
    const v = encloseAt(st, node);
    if (v === null) return;
    if (v === 'false') continue;
    if (v === 'true') {
      fillRect(st, node);
      continue;
    }
    if (leaf) {
      boundaryLeaf(st, node.i0, node.j0);
      checkCap(st);
      continue;
    }
    splitNode(queue, node);
  }
}

/**
 * Without a three-valued enclosure nothing proves a cell empty, so every leaf
 * corner is tested once: leaves with four true corners fill, leaves with four
 * false corners are skipped, mixed leaves are resolved. The result is honest
 * but not certain (`rigorous` is false), and the cost follows the area.
 */
function runDense(st: RState): void {
  st.rigorous = false;
  const w = st.cols + 1;
  const grid = new Int8Array(w * (st.rows + 1)).fill(-1);
  const at = (i: number, j: number): boolean | null => {
    const k = j * w + i;
    const cached = grid[k] as number;
    if (cached >= 0) return cached === 1;
    const v = testAt(st, gridX(st, i), gridY(st, j));
    if (v === null) return null;
    grid[k] = v === true ? 1 : 0;
    return v === true;
  };
  for (let j = 0; j < st.rows; j++) {
    for (let i = 0; i < st.cols; i++) {
      if (st.dead) return;
      const c = [at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)];
      if (c.some((v) => v === null)) return;
      const trues = c.filter((v) => v === true).length;
      if (trues === 0) continue;
      if (trues === 4) {
        fillRect(st, { i0: i, i1: i + 1, j0: j, j1: j + 1, level: 0 });
        continue;
      }
      boundaryLeaf(st, i, j);
    }
  }
}

function splitNode(queue: RNode[], node: RNode): void {
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

function fillRect(st: RState, node: RNode): void {
  for (let j = node.j0; j < node.j1; j++) {
    for (let i = node.i0; i < node.i1; i++) st.filled[j * st.cols + i] = 1;
  }
}

/** Capped fallback: over-fills mixed nodes so coverage survives coarsely. */
function fillCoarse(st: RState, node: RNode): void {
  const v = encloseAt(st, node);
  if (v === null || v === 'false') return;
  fillRect(st, node);
}

function checkCap(st: RState): void {
  if (!st.capped && st.points > st.maxSamples) st.capped = true;
}

/* ----------------------------- boundary leaves ------------------------------ */

/**
 * Resolves a boundary leaf: one crossing primitive gives a clipped polygon,
 * corners where primitives meet (or no margins at all) supersample at 4x4.
 */
function boundaryLeaf(st: RState, i: number, j: number): void {
  const xs = [gridX(st, i), gridX(st, i + 1)];
  const ys = [gridY(st, j + 1), gridY(st, j)];
  // Corner order SW, SE, NE, NW.
  const corners: (readonly [number, number])[] = [
    [xs[0] as number, ys[0] as number],
    [xs[1] as number, ys[0] as number],
    [xs[1] as number, ys[1] as number],
    [xs[0] as number, ys[1] as number],
  ];
  const crossing: number[] = [];
  const margins: number[][] = [];
  for (let b = 0; b < st.boundaries.length; b++) {
    const residual = (st.boundaries[b] as BoundaryInput).residual;
    const vals: number[] = [];
    for (const [x, y] of corners) {
      const v = marginAt(st, residual, x, y);
      if (v === null) return;
      vals.push(v);
    }
    margins.push(vals);
    const pos = vals.map((v) => v > 0);
    const neg = vals.map((v) => v < 0);
    if (pos.some((p) => p) && neg.some((n) => n)) crossing.push(b);
  }
  if (crossing.length !== 1) {
    if (st.boundaries.length > 0 && !st.enclosure) st.rigorous = false;
    // Two or more primitive boundaries meeting here: a corner of the region (curves-loci 7, step 2).
    const meeting = margins.filter((m) => Math.min(...m) <= 0 && Math.max(...m) >= 0).length;
    supersample(st, i, j, meeting >= 2);
    return;
  }
  const vals = margins[crossing[0] as number] as number[];
  const idx = caseIndex(vals[0] as number > 0, vals[1] as number > 0, vals[2] as number > 0, vals[3] as number > 0);
  if (idx === 0 || idx === 15) {
    supersample(st, i, j);
    return;
  }
  const residual = (st.boundaries[crossing[0] as number] as BoundaryInput).residual;
  const ts: Partial<Record<SquareEdge, number>> = {};
  const edges: SquareEdge[] = [0, 1, 2, 3];
  for (const edge of edges) {
    const [ca, cb] = edgeEnds(edge);
    const va = vals[ca] as number;
    const vb = vals[cb] as number;
    if (va > 0 === vb > 0 || !Number.isFinite(va) || !Number.isFinite(vb)) continue;
    ts[edge] = crossingT(va, vb);
  }
  const poly = polygonForCase(idx, ts as Record<SquareEdge, number | undefined>);
  if (poly.saddle) {
    supersample(st, i, j);
    return;
  }
  const h = Math.abs((xs[1] as number) - (xs[0] as number)) / 4 || 1e-12;
  const pts: number[] = [];
  for (const v of poly.vertices) {
    if ('corner' in v) {
      const p = corners[v.corner] as readonly [number, number];
      pts.push(p[0], p[1]);
    } else {
      const [ca, cb] = edgeEnds(v.edge);
      const pa = corners[ca] as readonly [number, number];
      const pb = corners[cb] as readonly [number, number];
      const f = (x: number, y: number): number => {
        if (st.evals + st.intervalEvals >= st.maxEvals) return Number.NaN;
        st.evals += 1;
        const r = residual(x, y);
        return typeof r === 'number' ? r : Number.NaN;
      };
      const fixed = refineCrossing(f, pa[0] + (pb[0] - pa[0]) * v.t, pa[1] + (pb[1] - pa[1]) * v.t, h, h * 8, 1);
      if (st.evals + st.intervalEvals >= st.maxEvals) {
        st.dead = true;
        return;
      }
      pts.push(fixed.x, fixed.y);
    }
  }
  if (pts.length >= 6) {
    st.polygons.push(new Float64Array(pts));
    st.points += pts.length / 2;
  }
}

/** Fills covered sub-cells of a corner leaf; marks near-point regions. */
function supersample(st: RState, i: number, j: number, corner = false): void {
  const pv = st.pv;
  const x0 = gridX(st, i);
  const x1 = gridX(st, i + 1);
  const yT = gridY(st, j);
  const yB = gridY(st, j + 1);
  const hit: boolean[][] = [];
  let covered = 0;
  let mx = 0;
  let my = 0;
  for (let a = 0; a < 4; a++) {
    const col: boolean[] = [];
    for (let b = 0; b < 4; b++) {
      const x = x0 + ((x1 - x0) * (a + 0.5)) / 4;
      const y = yB + ((yT - yB) * (b + 0.5)) / 4;
      const v = testAt(st, x, y);
      if (v === null) return;
      col.push(v === true);
      if (v === true) {
        covered += 1;
        mx = x;
        my = y;
      }
    }
    hit.push(col);
  }
  if (covered === 16 && !corner) {
    // Wholly covered: the leaf joins the grid, so neighbours merge into maximal rectangles.
    fillRect(st, { i0: i, i1: i + 1, j0: j, j1: j + 1, level: 0 });
  } else {
    // One rectangle per run of covered sub-cells in a column (b = 0 is the bottom row).
    for (let a = 0; a < 4; a++) {
      const col = hit[a] as boolean[];
      let b = 0;
      while (b < 4) {
        if (!col[b]) {
          b += 1;
          continue;
        }
        let e = b;
        while (e < 4 && col[e]) e += 1;
        const sx0 = x0 + ((x1 - x0) * a) / 4;
        const sx1 = x0 + ((x1 - x0) * (a + 1)) / 4;
        const syT = yB + ((yT - yB) * e) / 4;
        const syB = yB + ((yT - yB) * b) / 4;
        st.extraRects.push(pv.toPx(sx0), pv.toPy(syT), pv.toPx(sx1), pv.toPy(syB));
        b = e;
      }
    }
  }
  // A near-point island (x^2 + y^2 <= 0): sub-pixel rects plus a marker.
  if (covered > 0 && covered <= 2) {
    const island = isIsland(st, mx, my, x1 - x0, yT - yB);
    if (island === null) return;
    if (island) addMarker(st, 'isolated', mx, my);
  }
  if (covered === 0) {
    // A true point on a leaf corner that no sub-cell centre sees.
    for (const [x, y] of [[x0, yB], [x1, yB], [x1, yT], [x0, yT]] as const) {
      const v = testAt(st, x, y);
      if (v === null) return;
      if (v !== true) continue;
      const island = isIsland(st, x, y, x1 - x0, yT - yB);
      if (island === null) return;
      if (island) addMarker(st, 'isolated', x, y);
    }
  }
  if (!st.enclosure && covered > 0) st.rigorous = false;
  st.points += covered;
}

function addMarker(st: RState, kind: 'isolated', x: number, y: number): void {
  const marker = makeMarker(st.pv, kind, x, y);
  if (marker !== undefined) st.markers.add(marker);
}

/**
 * A covered spot is an island only when nothing one leaf away in any of the 8
 * directions is covered; a spot that touches covered area (cells meeting at a
 * corner, the end of a thin band) is part of the fill, not a point of its own.
 * Null when the budget ran out.
 */
function isIsland(st: RState, x: number, y: number, dx: number, dy: number): boolean | null {
  for (const [kx, ky] of RING) {
    const v = testAt(st, x + kx * dx, y + ky * dy);
    if (v === null) return null;
    if (v === true) return false;
  }
  return true;
}

/** Diagonals first: cells that meet at a corner are found by the first probes. */
const RING: readonly (readonly [number, number])[] = [
  [1, 1], [-1, -1], [1, -1], [-1, 1], [1, 0], [-1, 0], [0, 1], [0, -1],
];

/* ------------------------------- rect merge --------------------------------- */

/** Merges filled leaf cells into maximal rectangles, row by row. */
function mergeRects(st: RState): Float64Array {
  const out: number[] = [];
  const pushClipped = (x0: number, y0: number, x1: number, y1: number): void => {
    const pv = st.pv;
    const cx0 = Math.max(0, pv.toPx(x0));
    const cy0 = Math.max(0, pv.toPy(y1));
    const cx1 = Math.min(pv.box.widthPx, pv.toPx(x1));
    const cy1 = Math.min(pv.box.heightPx, pv.toPy(y0));
    if (cx1 > cx0 && cy1 > cy0) out.push(cx0, cy0, cx1, cy1);
  };
  let active: { x0: number; x1: number; y0row: number }[] = [];
  for (let j = 0; j < st.rows; j++) {
    const runs: { x0: number; x1: number }[] = [];
    let run: { x0: number; x1: number } | undefined;
    for (let i = 0; i <= st.cols; i++) {
      const on = i < st.cols && st.filled[j * st.cols + i] === 1;
      if (on && !run) run = { x0: i, x1: i + 1 };
      else if (on && run) run.x1 = i + 1;
      else if (!on && run) {
        runs.push(run);
        run = undefined;
      }
    }
    const next: { x0: number; x1: number; y0row: number }[] = [];
    for (const r of runs) {
      const cont = active.find((a) => a.x0 === r.x0 && a.x1 === r.x1);
      if (cont) next.push(cont);
      else next.push({ x0: r.x0, x1: r.x1, y0row: j });
    }
    for (const a of active) {
      if (!next.includes(a)) pushClipped(gridX(st, a.x0), gridY(st, j), gridX(st, a.x1), gridY(st, a.y0row));
    }
    active = next;
  }
  for (const a of active) pushClipped(gridX(st, a.x0), gridY(st, st.rows), gridX(st, a.x1), gridY(st, a.y0row));
  const pv = st.pv;
  for (let k = 0; k + 3 < st.extraRects.length + 1; k += 4) {
    const cx0 = Math.max(0, st.extraRects[k] as number);
    const cy0 = Math.max(0, st.extraRects[k + 1] as number);
    const cx1 = Math.min(pv.box.widthPx, st.extraRects[k + 2] as number);
    const cy1 = Math.min(pv.box.heightPx, st.extraRects[k + 3] as number);
    if (cx1 > cx0 && cy1 > cy0) out.push(cx0, cy0, cx1, cy1);
  }
  return new Float64Array(out);
}

/* --------------------------------- borders ---------------------------------- */

/**
 * Traces one margin's zero set and keeps the segments on the combined region's
 * boundary: a sample just inside the margin must satisfy the whole body
 * (curves-loci 7, step 3). Equality margins are kept where the body holds on
 * them. Consumes the shared evaluation budget.
 */
function traceBorder(st: RState, boundary: BoundaryInput, view: ViewBox, quality: TraceQuality, budget: number): RegionBorder[] {
  const field: ImplicitFieldInput = boundary.enclosure === undefined
    ? { residual: boundary.residual }
    : { residual: boundary.residual, enclosure: boundary.enclosure };
  // Without an enclosure the trace visits every leaf, so it runs on the coarse
  // grid; Newton-corrected crossings keep the polyline within a fraction of a pixel.
  const traceQuality: TraceQuality = boundary.enclosure === undefined ? 'draft' : quality;
  const traced = traceImplicit(field, view, { quality: traceQuality, maxEvals: Math.max(64, Math.floor(budget)), maxSamples: st.maxSamples });
  if (!traced.ok) {
    st.dead = true;
    return [];
  }
  const plot = traced.value;
  st.evals += plot.stats.evals;
  st.intervalEvals += plot.stats.intervalEvals;
  if (!plot.stats.rigorous) st.rigorous = false;
  if (plot.stats.capped) st.capped = true;
  if (!plot.stats.complete) {
    st.dead = true;
    return [];
  }
  if (st.evals + st.intervalEvals >= st.maxEvals) {
    st.dead = true;
    return [];
  }
  const pv = st.pv;
  const delta = Math.max(pv.dx, pv.dy) * st.leafEff;
  const h = delta / 4 || 1e-12;
  const out: RegionBorder[] = [];
  for (const path of plot.paths) {
    const keep: boolean[] = [];
    const n = path.length / 2;
    for (let i = 0; i + 1 < n; i++) {
      const mx = pv.toX(((path[2 * i] as number) + (path[2 * i + 2] as number)) / 2);
      const my = pv.toY(((path[2 * i + 1] as number) + (path[2 * i + 3] as number)) / 2);
      keep.push(segmentOnBoundary(st, boundary, mx, my, delta, h));
      if (st.dead) return [];
    }
    // Split the path into kept runs (endpoints match exactly within one path).
    let run: number[] = [];
    const flush = (): void => {
      if (run.length >= 4) out.push({ path: new Float64Array(run), strict: boundary.strict });
      run = [];
    };
    for (let i = 0; i + 1 < n; i++) {
      if (keep[i]) {
        if (run.length === 0) run.push(path[2 * i] as number, path[2 * i + 1] as number);
        run.push(path[2 * i + 2] as number, path[2 * i + 3] as number);
      } else {
        flush();
      }
    }
    flush();
  }
  return out;
}

function segmentOnBoundary(
  st: RState,
  boundary: BoundaryInput,
  mx: number,
  my: number,
  delta: number,
  h: number,
): boolean {
  if (boundary.equality === true) {
    const v = testAt(st, mx, my);
    if (v === null) return false;
    return v === true;
  }
  // Offset towards the inside (margin > 0) and test the whole body there.
  const f = (x: number, y: number): number => {
    const r = boundary.residual(x, y);
    return typeof r === 'number' ? r : Number.NaN;
  };
  const g = numericGradient(f, mx, my, h);
  st.evals += 4;
  if (st.evals + st.intervalEvals >= st.maxEvals) {
    st.dead = true;
    return false;
  }
  if (!g) return true; // Near-singular margins keep their border.
  const len = Math.hypot(g.gx, g.gy);
  if (!(len > 0)) return true;
  const v = testAt(st, mx + (g.gx / len) * delta, my + (g.gy / len) * delta);
  if (v === null) return false;
  return v === true;
}

/* --------------------------------- public ---------------------------------- */

function makeStats(st: RState, complete: boolean, samples: number): PlotStats {
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
 * Fills a two-variable predicate over a view (curves-loci 7). On `maxEvals`
 * exhaustion the result is `complete: false` with empty output; re-run with a
 * larger budget.
 */
export function fillRegion(predicate: PredicateInput, view: ViewBox, options: RegionPlotOptions = {}): Result<RegionPlot> {
  return guard('fillRegion', () => {
    const caller = 'fillRegion';
    if (typeof predicate !== 'object' || predicate === null || typeof predicate.test !== 'function') {
      return badArgument(caller, 'the predicate needs a test(x, y) function', 'Pass a test or predicateFromRelation(relation).');
    }
    if (predicate.boundaries !== undefined) {
      if (!Array.isArray(predicate.boundaries) || predicate.boundaries.length > 64) {
        return badArgument(caller, 'boundaries must be a list of at most 64 margins', 'Pass up to 64 boundary margins.');
      }
      for (const b of predicate.boundaries) {
        if (typeof b !== 'object' || b === null || typeof b.residual !== 'function' || typeof b.strict !== 'boolean') {
          return badArgument(caller, 'each boundary needs a residual(x, y) and a strict flag', 'Fix the boundary margins.');
        }
      }
    }
    const viewProblem = checkView(caller, view);
    if (viewProblem) return viewProblem;
    const budgetProblem = checkBudgets(caller, options.maxSamples, options.maxEvals);
    if (budgetProblem) return budgetProblem;
    const quality: TraceQuality = options.quality ?? 'final';
    if (quality !== 'draft' && quality !== 'final') {
      return badArgument(caller, `quality must be "draft" or "final" (got ${String(options.quality)})`, 'Pass quality "draft" while interacting, "final" after.');
    }
    const pvResult = createView(view);
    if (!pvResult.ok) return pvResult;
    const pv = pvResult.value;
    const leafEff = quality === 'final' ? 2 : 6;
    const padEff = Math.max(1, Math.round(32 / leafEff)) * leafEff;
    const cols = Math.max(1, Math.ceil((pv.widthEff + 2 * padEff) / leafEff));
    const rows = Math.max(1, Math.ceil((pv.heightEff + 2 * padEff) / leafEff));
    if (cols * rows > MAX_BITMAP_CELLS) {
      return overLimit(caller, 'leaf cells', MAX_BITMAP_CELLS, cols * rows);
    }
    const maxSamples = options.maxSamples === undefined ? MAX_SAMPLES_PER_CURVE : Math.floor(options.maxSamples);
    const st: RState = {
      pv,
      test: predicate.test,
      boundaries: predicate.boundaries ?? [],
      enclosure: predicate.enclosure,
      leafEff,
      cols,
      rows,
      padEff,
      filled: new Uint8Array(cols * rows),
      polygons: [],
      extraRects: [],
      markers: new MarkerSet(maxSamples),
      maxSamples,
      maxEvals: options.maxEvals === undefined ? DEFAULT_MAX_EVALS_REGION : Math.floor(options.maxEvals),
      evals: 0,
      intervalEvals: 0,
      maxDepthSeen: 0,
      rigorous: true,
      capped: false,
      dead: false,
      points: 0,
    };
    runFill(st);
    if (st.dead) return { ok: true, value: emptyRegion(st), notices: [] };
    const borders: RegionBorder[] = [];
    const bounds = st.boundaries;
    for (let i = 0; i < bounds.length; i++) {
      const remaining = st.maxEvals - st.evals - st.intervalEvals;
      if (remaining < 64) {
        st.dead = true;
        break;
      }
      const share = Math.floor(remaining / (bounds.length - i));
      const traced = traceBorder(st, bounds[i] as BoundaryInput, view, quality, share);
      if (st.dead) break;
      for (const b of traced) borders.push(b);
    }
    if (st.dead) return { ok: true, value: emptyRegion(st), notices: [] };
    const rects = mergeRects(st);
    const polygons: Float64Array[] = [];
    let samples = (rects.length / 4) * 4;
    for (const poly of st.polygons) {
      const arr = new Float64Array(poly.length);
      for (let i = 0; i + 1 < poly.length; i += 2) {
        arr[i] = pv.toPx(poly[i] as number);
        arr[i + 1] = pv.toPy(poly[i + 1] as number);
      }
      samples += poly.length / 2;
      polygons.push(arr);
    }
    for (const b of borders) samples += b.path.length / 2;
    if (st.markers.dropped) st.capped = true;
    const markers = st.markers.sorted();
    return { ok: true, value: { rects, polygons, borders, markers, stats: makeStats(st, true, Math.round(samples)) }, notices: [] };
  });
}

function emptyRegion(st: RState): RegionPlot {
  return { rects: new Float64Array(0), polygons: [], borders: [], markers: [], stats: makeStats(st, false, 0) };
}

/* ------------------------------- 1D predicates ------------------------------ */

interface OneDState {
  evals: number;
  intervalEvals: number;
  maxDepth: number;
  dead: boolean;
}

/**
 * Fills a one-variable predicate over a view (curves-loci 7): vertical bands
 * spanning the view height plus the true intervals on the axis. Transition
 * edges are bisected to a tenth of a pixel.
 */
export function fillPredicate1D(predicate: Predicate1DInput, view: ViewBox, options: Predicate1DOptions = {}): Result<Predicate1DPlot> {
  return guard('fillPredicate1D', () => {
    const caller = 'fillPredicate1D';
    if (typeof predicate !== 'object' || predicate === null || typeof predicate.test !== 'function') {
      return badArgument(caller, 'the predicate needs a test(x) function', 'Pass a one-variable test.');
    }
    const viewProblem = checkView(caller, view);
    if (viewProblem) return viewProblem;
    const budgetProblem = checkBudgets(caller, undefined, options.maxEvals);
    if (budgetProblem) return budgetProblem;
    const coarse = options.coarse === undefined ? 128 : Math.floor(options.coarse);
    if (!isFiniteNumber(coarse) || coarse < 2 || coarse > 65536) {
      return badArgument(caller, `coarse must be in 2..65536 (got ${String(options.coarse)})`, 'Pass a coarse sample count of at least 2.');
    }
    const pvResult = createView(view);
    if (!pvResult.ok) return pvResult;
    const pv = pvResult.value;
    const maxEvals = options.maxEvals === undefined ? DEFAULT_MAX_EVALS_REGION : Math.floor(options.maxEvals);
    const st: OneDState = { evals: 0, intervalEvals: 0, maxDepth: 0, dead: false };
    const spent = (): number => st.evals + st.intervalEvals;
    const test = (x: number): boolean | undefined | null => {
      if (spent() >= maxEvals) {
        st.dead = true;
        return null;
      }
      st.evals += 1;
      const v = predicate.test(x);
      return v === true ? true : v === false ? false : undefined;
    };
    const enc = predicate.enclosure;
    const spanState = (lo: number, hi: number): 'true' | 'false' | 'maybe' | null => {
      if (enc) {
        if (spent() >= maxEvals) {
          st.dead = true;
          return null;
        }
        st.intervalEvals += 1;
        const v = enc(lo, hi);
        return v === 'true' || v === 'false' || v === 'maybe' ? v : 'maybe';
      }
      const a = test(lo);
      if (a === null) return null;
      const b = test(hi);
      if (b === null) return null;
      const m = test((lo + hi) / 2);
      if (m === null) return null;
      if (a === true && b === true && m === true) return 'true';
      if (a === false && b === false && m === false) return 'false';
      return 'maybe';
    };
    // Coarse partition, refined where mixed. False spans are kept too: the
    // partition tiles the range, so every true edge abuts a false span that
    // brackets the sharpening bisection.
    const spans: { lo: number; hi: number }[] = [];
    const falses: { lo: number; hi: number }[] = [];
    const stack: { lo: number; hi: number; depth: number }[] = [];
    for (let i = 0; i < coarse; i++) {
      stack.push({ lo: view.x0 + ((view.x1 - view.x0) * i) / coarse, hi: view.x0 + ((view.x1 - view.x0) * (i + 1)) / coarse, depth: 0 });
    }
    let rigorous = true;
    while (stack.length > 0) {
      const s = stack.pop() as { lo: number; hi: number; depth: number };
      if (s.depth > st.maxDepth) st.maxDepth = s.depth;
      const v = spanState(s.lo, s.hi);
      if (v === null) break;
      if (v === 'true') {
        spans.push({ lo: s.lo, hi: s.hi });
        continue;
      }
      if (v === 'false') {
        falses.push({ lo: s.lo, hi: s.hi });
        continue;
      }
      if (!enc) rigorous = false;
      const widthPx = Math.abs(pv.toPx(s.hi) - pv.toPx(s.lo)) * pv.dpr;
      if (widthPx < 0.5) {
        // Sub-pixel maybe: probe the centre once.
        const c = test((s.lo + s.hi) / 2);
        if (c === null) break;
        if (c === true) spans.push({ lo: s.lo, hi: s.hi });
        else falses.push({ lo: s.lo, hi: s.hi });
        continue;
      }
      const mid = (s.lo + s.hi) / 2;
      if (!(mid > s.lo && mid < s.hi)) {
        spans.push({ lo: s.lo, hi: s.hi });
        continue;
      }
      stack.push({ lo: s.lo, hi: mid, depth: s.depth + 1 });
      stack.push({ lo: mid, hi: s.hi, depth: s.depth + 1 });
    }
    const stats = (complete: boolean, extra: number): PlotStats => ({
      evals: st.evals,
      intervalEvals: st.intervalEvals,
      maxDepth: st.maxDepth,
      complete,
      capped: false,
      rigorous,
      samples: extra,
    });
    const empty = (): Predicate1DPlot => ({ bands: new Float64Array(0), intervals: new Float64Array(0), stats: stats(false, 0) });
    if (st.dead) return { ok: true, value: empty(), notices: [] };
    spans.sort((a, b) => a.lo - b.lo);
    falses.sort((a, b) => a.lo - b.lo);
    const merged: { lo: number; hi: number }[] = [];
    for (const s of spans) {
      const prev = merged[merged.length - 1];
      if (prev && s.lo <= prev.hi) prev.hi = Math.max(prev.hi, s.hi);
      else merged.push({ ...s });
    }
    const refineEdge = (lo: number, hi: number, loTrue: boolean): number | null => {
      // Bisects a true/false transition to a tenth of a pixel.
      let a = lo;
      let b = hi;
      for (let i = 0; i < 60; i++) {
        if (Math.abs(pv.toPx(b) - pv.toPx(a)) * pv.dpr < 0.1) break;
        const mid = (a + b) / 2;
        if (!(mid > a && mid < b)) break;
        const vv = test(mid);
        if (vv === null) return null;
        if ((vv === true) === loTrue) a = mid;
        else b = mid;
      }
      return (a + b) / 2;
    };
    const bands: number[] = [];
    const intervals: number[] = [];
    for (const m of merged) {
      let lo = m.lo;
      let hi = m.hi;
      // Sharpen against the abutting false spans (exact tiling boundaries).
      const leftFalse = falses.find((f) => f.hi === m.lo);
      if (m.lo > view.x0 && leftFalse) {
        const e = refineEdge(leftFalse.lo, m.lo, false);
        if (e === null) break;
        lo = e;
      }
      const rightFalse = falses.find((f) => f.lo === m.hi);
      if (m.hi < view.x1 && rightFalse) {
        const e = refineEdge(m.hi, rightFalse.hi, true);
        if (e === null) break;
        hi = e;
      }
      const clo = Math.max(view.x0, lo);
      const chi = Math.min(view.x1, hi);
      if (chi > clo) {
        bands.push(pv.toPx(clo), 0, pv.toPx(chi), view.heightPx);
        intervals.push(clo, chi);
      }
    }
    if (st.dead) return { ok: true, value: empty(), notices: [] };
    return {
      ok: true,
      value: { bands: new Float64Array(bands), intervals: new Float64Array(intervals), stats: stats(true, intervals.length / 2) },
      notices: [],
    };
  });
}

/** Adapts a language relation to a fillable predicate with its first margin as border. */
export function predicateFromRelation(relation: RelationValue): Result<PredicateInput> {
  return guard('predicateFromRelation', () => {
    if (typeof relation !== 'object' || relation === null || typeof relation.test !== 'function') {
      return badArgument('predicateFromRelation', 'the relation has no test(x, y)', 'Pass a RelationValue from the language.');
    }
    const test = relation.test;
    const op = Array.isArray(relation.ops) ? relation.ops[0] : undefined;
    const boundaries: BoundaryInput[] = [];
    if (typeof relation.residual === 'function' && typeof op === 'string') {
      const residual = relation.residual;
      if (op === '<' || op === '<=') {
        boundaries.push({ residual: (x, y) => -residual(x, y), strict: op === '<' });
      } else if (op === '>' || op === '>=') {
        boundaries.push({ residual: (x, y) => residual(x, y), strict: op === '>' });
      } else if (op === '==' || op === '!=') {
        boundaries.push({ residual: (x, y) => residual(x, y), strict: op === '!=', equality: op === '==' });
      }
      // Later comparisons of a chain add no margins here; the kernel supplies
      // per-primitive margins for those (see the builder notes).
    }
    const predicate: PredicateInput = boundaries.length > 0 ? { test, boundaries } : { test };
    return { ok: true, value: predicate, notices: [] };
  });
}
