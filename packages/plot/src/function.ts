/**
 * Adaptive sampling of `y = f(x)` (functions-calculus 9): coarse samples, then
 * screen-space refinement with breaks at discontinuities, pole/jump/hole
 * classification (exact with the kernel's interval enclosure, heuristic without
 * it), sub-pixel oscillation columns, sample budgets, and suspend/resume so a
 * frame budget never blocks: the final paths are identical however the work was
 * sliced, because refinement is a pure function of each span and emission sorts
 * everything by x.
 */
import type { ErrorObject, FunctionValue, Result } from '@incantly/kernel';
import {
  DEFAULT_MAX_EVALS_FUNCTION,
  HARD_MAX_SAMPLES,
  MAX_SAMPLES_PER_CURVE,
  REFINE_BEND_PX,
  REFINE_CHORD_PX,
  REFINE_MAX_DEPTH,
} from './contracts';
import type {
  DomainSpan,
  FunctionPlot,
  FunctionPlotOptions,
  FunctionResume,
  FunctionResumeSpan,
  InkColumn,
  MarkerKind,
  PlotMarker,
  PlotStats,
  ReplayBox,
  ResumePiece,
  SampleSeed,
  ScalarBox,
  ScalarEnclosure,
  ViewBox,
} from './contracts';
import { badArgument, checkBudgets, checkView, guard, isFiniteNumber } from './errors';
import { makeMarker } from './markers';
import { SNAP_FRACTION, snapGrid, trimSeedKeys } from './seed';
import { SortedSet } from './sortedset';
import { thinChains } from './thin';
import { createView, pointToChordPx } from './view';
import type { PlotView } from './view';

interface FSample {
  readonly x: number;
  readonly y: number;
  readonly defined: boolean;
}

interface FSpan {
  readonly xl: number;
  readonly xr: number;
  readonly depth: number;
}

interface FCfg {
  readonly coarse: number;
  readonly depth: number;
  readonly bendPx: number;
  readonly chordPx: number;
  readonly maxSamples: number;
  readonly maxEvals: number;
  readonly exact: boolean;
}

interface FState {
  readonly pv: PlotView;
  readonly samples: Map<number, FSample>;
  /**
   * Cached samples from an earlier view, by x. They are not in `samples` until
   * the run asks for that x, so they never count against the sample cap.
   */
  readonly seed: Map<number, FSample>;
  /** Every defined sample x, ordered, for neighbour lookups in O(log n). */
  readonly definedXs: SortedSet;
  readonly pending: FSpan[];
  readonly accepted: FSpan[];
  readonly suspicious: FSpan[];
  readonly markers: PlotMarker[];
  readonly ink: InkColumn[];
  readonly call1: (x: number) => number;
  readonly batch: ((xs: Float64Array, out: Float64Array) => void) | undefined;
  readonly enclosure: ScalarEnclosure | undefined;
  readonly cfg: FCfg;
  /** The function version the run belongs to (undefined when the caller gave none). */
  readonly version: number | undefined;
  /**
   * Interval results of the verdict in progress, by span. A verdict that is
   * interrupted is redone whole next call; these make the redo free, so every
   * call progresses however small its budget.
   */
  readonly replay: Map<string, ScalarBox>;
  /** Span key the replay entries belong to. */
  replayFor: string;
  /** True while a classification verdict runs (interval results are kept for its redo). */
  inVerdict: boolean;
  readonly heightEff: number;
  /** Evaluations spent before this call (a resume continues the totals; the budget is per call). */
  readonly base: number;
  pieces: readonly ResumePiece[];
  breaks: readonly number[];
  coarseXs: readonly number[];
  coarseDone: number;
  phase: 'setup' | 'refine' | 'classify' | 'band';
  evals: number;
  intervalEvals: number;
  maxDepthSeen: number;
  rigorous: boolean;
  capped: boolean;
  suspended: boolean;
  steps: number;
}

/** Hard step cap so the loop always terminates, even on adversarial input. */
const STEP_CAP = 2000000;
/** Bisection stops here: 0.1 device pixels in x (functions-calculus 9, stage 5). */
const EDGE_PX = 0.1;
/** A span narrower than half a pixel is one column: classify, never split. */
const COLUMN_PX = 0.5;
/** Partner search across a gap, in device pixels. */
const PARTNER_PX = 0.5;
/** Hole y-tolerance, in device pixels. */
const HOLE_PX = 2;

/* -------------------------------- validation -------------------------------- */

function checkFn(caller: string, fn: FunctionValue): ErrorObject | undefined {
  if (typeof fn !== 'object' || fn === null || typeof fn.call !== 'function') {
    return badArgument(caller, 'the function is not a compiled FunctionValue', 'Pass a one-variable Number function from the language.');
  }
  if (fn.arity !== 1 || fn.ret !== 'Number') {
    return badArgument(
      caller,
      `plotFunction needs a Function<Number>(1) (got arity ${String(fn.arity)}, ${String(fn.ret)})`,
      'Trace a point-valued curve with traceParamCurve instead.',
    );
  }
  return undefined;
}

function checkScalarOptions(
  caller: string,
  options: FunctionPlotOptions,
): { cfg: FCfg; problem: undefined } | { cfg: undefined; problem: ErrorObject } {
  const budgetProblem = checkBudgets(caller, options.maxSamples, options.maxEvals);
  if (budgetProblem) return { cfg: undefined, problem: budgetProblem };
  const coarse = options.coarse ?? 0;
  if (options.coarse !== undefined && (!isFiniteNumber(coarse) || coarse < 2 || coarse > 65536)) {
    return {
      cfg: undefined,
      problem: badArgument(caller, `coarse must be in 2..65536 (got ${String(options.coarse)})`, 'Pass a coarse sample count of at least 2.'),
    };
  }
  const depth = options.depth ?? REFINE_MAX_DEPTH;
  if (!isFiniteNumber(depth) || depth < 1 || depth > 24) {
    return {
      cfg: undefined,
      problem: badArgument(caller, `depth must be in 1..24 (got ${String(options.depth)})`, 'Pass a refinement depth between 1 and 24.'),
    };
  }
  const bendPx = options.bendPx ?? REFINE_BEND_PX;
  const chordPx = options.chordPx ?? REFINE_CHORD_PX;
  if (!isFiniteNumber(bendPx) || bendPx <= 0 || !isFiniteNumber(chordPx) || chordPx <= 0) {
    return {
      cfg: undefined,
      problem: badArgument(caller, 'bendPx and chordPx must be positive', 'Pass positive screen-space thresholds.'),
    };
  }
  return {
    cfg: {
      coarse: options.coarse === undefined ? 0 : Math.floor(coarse),
      depth: Math.floor(depth),
      bendPx,
      chordPx,
      maxSamples: options.maxSamples === undefined ? MAX_SAMPLES_PER_CURVE : Math.floor(options.maxSamples),
      maxEvals: options.maxEvals === undefined ? DEFAULT_MAX_EVALS_FUNCTION : Math.floor(options.maxEvals),
      exact: options.exact ?? false,
    },
    problem: undefined,
  };
}

function checkBreaks(caller: string, breaks: readonly number[] | undefined): ErrorObject | undefined {
  if (breaks === undefined) return undefined;
  if (breaks.length > 4096) {
    return badArgument(caller, `at most 4096 breaks (got ${breaks.length})`, 'Pass fewer break points.');
  }
  for (const b of breaks) {
    if (!isFiniteNumber(b)) {
      return badArgument(caller, `breaks must be finite numbers (got ${String(b)})`, 'Drop the non-finite break point.');
    }
  }
  return undefined;
}

function checkDomain(caller: string, domain: readonly DomainSpan[] | undefined): ErrorObject | undefined {
  if (domain === undefined) return undefined;
  if (domain.length > 4096) {
    return badArgument(caller, `at most 4096 domain spans (got ${domain.length})`, 'Pass fewer domain spans.');
  }
  for (const s of domain) {
    if (typeof s.lo !== 'number' || typeof s.hi !== 'number' || Number.isNaN(s.lo) || Number.isNaN(s.hi) || s.lo > s.hi) {
      return badArgument(caller, 'each domain span needs lo <= hi, both numbers', 'Fix the domain span bounds.');
    }
  }
  return undefined;
}

function checkSeed(caller: string, seed: SampleSeed | undefined): ErrorObject | undefined {
  if (seed === undefined) return undefined;
  if (!(seed.xs instanceof Float64Array) || !(seed.ys instanceof Float64Array) || seed.xs.length !== seed.ys.length) {
    return badArgument(caller, 'a seed needs xs and ys Float64Arrays of equal length', 'Pass matching xs/ys arrays.');
  }
  return undefined;
}

/* --------------------------------- pieces ---------------------------------- */

/** Intersects the domain with the view and splits at breaks, sorted by lo. */
function makePieces(view: ViewBox, domain: readonly DomainSpan[] | undefined, breaks: readonly number[]): ResumePiece[] {
  const spans: DomainSpan[] = domain === undefined ? [{ lo: Number.NEGATIVE_INFINITY, hi: Number.POSITIVE_INFINITY, loOpen: false, hiOpen: false }] : [...domain];
  spans.sort((a, b) => a.lo - b.lo);
  const cuts = [...breaks].sort((a, b) => a - b);
  const pieces: ResumePiece[] = [];
  for (const s of spans) {
    const lo = Math.max(s.lo, view.x0);
    const hi = Math.min(s.hi, view.x1);
    if (!(lo < hi)) continue;
    const loClipped = lo > s.lo;
    const hiClipped = hi < s.hi;
    const inner = cuts.filter((b) => b > lo && b < hi);
    const edges = [lo, ...inner, hi];
    for (let i = 0; i + 1 < edges.length; i++) {
      const a = edges[i] as number;
      const b = edges[i + 1] as number;
      pieces.push({
        lo: a,
        hi: b,
        loKind: i === 0 ? (loClipped ? 'view' : s.loOpen ? 'open' : 'closed') : 'break',
        hiKind: i + 2 === edges.length ? (hiClipped ? 'view' : s.hiOpen ? 'open' : 'closed') : 'break',
      });
    }
  }
  return pieces;
}

/**
 * Distance a sample keeps from a break, in maths units: the one-sided limit of
 * the function is read at `b - eps` and `b + eps`, and the value at the break
 * itself at `b` (functions-calculus 9, step 1: both sides of a break are
 * sampled exactly). Far below a pixel at any zoom the figure can show.
 */
function breakEps(view: ViewBox): number {
  return Math.max((view.x1 - view.x0) * 1e-13, Math.max(Math.abs(view.x0), Math.abs(view.x1)) * 1e-15);
}

/** The x range a piece is sampled over: break ends sit `eps` inside the piece. */
function sampleRange(p: ResumePiece, eps: number): readonly [number, number] {
  // The right edge of the view is read just inside: the value exactly there
  // may belong to the next piece of the function (steps are right-continuous).
  // The left edge stays exact, so cached samples on the view grid still match.
  return [p.loKind === 'break' ? p.lo + eps : p.lo, p.hiKind === 'break' || p.hiKind === 'view' ? p.hi - eps : p.hi];
}

/**
 * Coarse x values per piece, proportional to width, ends included. A piece
 * ending at a break gets its end at `eps` inside, and the break itself is
 * sampled once on its own (it belongs to no span).
 */
function makeCoarseXs(pieces: readonly ResumePiece[], coarse: number, eps: number, seedKeys: readonly number[] = []): number[] {
  const total = pieces.reduce((s, p) => s + (p.hi - p.lo), 0);
  const xs: number[] = [];
  for (const p of pieces) {
    const [ra, rb] = sampleRange(p, eps);
    const w = p.hi - p.lo;
    if (!(ra < rb)) {
      if (p.hiKind === 'break') xs.push(p.hi);
      continue;
    }
    const n = total > 0 ? Math.max(2, Math.round((coarse * w) / total)) : 2;
    // The grid is laid over the whole piece; only the ends move inside it.
    const grid: number[] = [];
    for (let i = 0; i < n; i++) grid.push(i === 0 ? ra : i === n - 1 ? rb : p.lo + ((p.hi - p.lo) * i) / (n - 1));
    // A pan reuses cached samples: grid points snap onto a cached x within a third of a step.
    for (const x of snapGrid(grid, seedKeys, (SNAP_FRACTION * (p.hi - p.lo)) / (n - 1))) xs.push(x);
    if (p.hiKind === 'break') xs.push(p.hi);
  }
  return xs;
}

/* -------------------------------- evaluation -------------------------------- */

function toSample(x: number, v: unknown): FSample {
  const y = typeof v === 'number' ? v : Number.NaN;
  return Number.isFinite(y) ? { x, y, defined: true } : { x, y: Number.NaN, defined: false };
}

/** Evaluations spent during this call (real plus interval). */
function spentThisCall(st: FState): number {
  return st.evals + st.intervalEvals - st.base;
}

/** Stores a sample; defined ones also join the ordered index. */
function putSample(st: FState, x: number, s: FSample): void {
  st.samples.set(x, s);
  if (s.defined) st.definedXs.add(x);
}

/** Evaluates at x, cached; returns null and suspends when the budget is spent. */
function evalAt(st: FState, x: number): FSample | null {
  const hit = st.samples.get(x);
  if (hit) return hit;
  const cached = st.seed.get(x);
  if (cached) {
    putSample(st, x, cached);
    return cached;
  }
  if (spentThisCall(st) >= st.cfg.maxEvals) {
    st.suspended = true;
    return null;
  }
  const s = toSample(x, st.call1(x));
  st.evals += 1;
  putSample(st, x, s);
  return s;
}

/** Interval enclosure over a span, validated; null when the budget is spent. */
function intervalAt(st: FState, lo: number, hi: number): ScalarBox | null {
  const enc = st.enclosure;
  if (!enc) return null;
  const key = st.inVerdict ? `${lo},${hi}` : '';
  if (st.inVerdict) {
    const kept = st.replay.get(key);
    if (kept) return kept;
  }
  if (spentThisCall(st) >= st.cfg.maxEvals) {
    st.suspended = true;
    return null;
  }
  const box = enc(lo, hi);
  st.intervalEvals += 1;
  const loV = typeof box.lo === 'number' ? box.lo : Number.NaN;
  const hiV = typeof box.hi === 'number' ? box.hi : Number.NaN;
  const def = box.def === 0 || box.def === 1 || box.def === 2 ? box.def : 1;
  const out: ScalarBox =
    Number.isNaN(loV) || Number.isNaN(hiV)
      ? { lo: Number.NEGATIVE_INFINITY, hi: Number.POSITIVE_INFINITY, def: 0 }
      : { lo: Math.min(loV, hiV), hi: Math.max(loV, hiV), def };
  if (st.inVerdict) st.replay.set(key, out);
  return out;
}

/* ------------------------------- setup + refine ------------------------------ */

/**
 * Evaluates the coarse grid; each new point completes one span with its
 * predecessor. Runs incrementally so it can suspend and resume. The first pass
 * uses the compiled batch form when it fits the remaining budget.
 */
function runSetup(st: FState): void {
  const xs = st.coarseXs;
  if (st.coarseDone === 0 && st.seed.size > 0) {
    for (const x of xs) {
      const cached = st.seed.get(x);
      if (cached && !st.samples.has(x)) putSample(st, x, cached);
    }
  }
  if (st.coarseDone === 0 && st.batch && xs.length > 0) {
    const missing = xs.filter((x) => !st.samples.has(x));
    if (missing.length > 0 && missing.length <= st.cfg.maxEvals - spentThisCall(st)) {
      const inArr = new Float64Array(missing);
      const out = new Float64Array(missing.length).fill(Number.NaN);
      st.batch(inArr, out);
      st.evals += missing.length;
      for (let i = 0; i < missing.length; i++) {
        const x = missing[i] as number;
        putSample(st, x, toSample(x, out[i] as number));
      }
    }
  }
  while (st.coarseDone < xs.length) {
    const x = xs[st.coarseDone] as number;
    const s = evalAt(st, x);
    if (!s) return;
    // A span ends here when the previous coarse x belongs to the same piece.
    if (st.coarseDone > 0) {
      const prev = xs[st.coarseDone - 1] as number;
      if (samePiece(st.pieces, breakEps(st.pv.box), prev, x)) st.pending.push({ xl: prev, xr: x, depth: 0 });
    }
    st.coarseDone += 1;
  }
  st.phase = 'refine';
}

function samePiece(pieces: readonly ResumePiece[], eps: number, a: number, b: number): boolean {
  // Consecutive coarse xs of one piece. The break sample and the ends of the two
  // pieces around a break sit in no common sampling range, so pieces never join here.
  if (!(a < b)) return false;
  for (const p of pieces) {
    const [ra, rb] = sampleRange(p, eps);
    if (a >= ra && b <= rb) return true;
  }
  return false;
}

function toEffX(pv: PlotView, x: number): number {
  return pv.toPx(x) * pv.dpr;
}

function toEffY(pv: PlotView, y: number): number {
  return pv.toPy(y) * pv.dpr;
}

function runRefine(st: FState): void {
  const { pv, cfg } = st;
  while (st.pending.length > 0) {
    if (st.suspended) return;
    if (st.steps++ > STEP_CAP) {
      forceCap(st);
      return;
    }
    if (st.samples.size >= cfg.maxSamples) {
      // The sample cap stops refinement; pending spans are drawn as they are.
      for (const s of st.pending) st.accepted.push(s);
      st.pending.length = 0;
      st.capped = true;
      return;
    }
    const span = st.pending.pop() as FSpan;
    if (span.depth > st.maxDepthSeen) st.maxDepthSeen = span.depth;
    const l = evalAt(st, span.xl);
    if (!l) {
      st.pending.push(span);
      return;
    }
    const r = evalAt(st, span.xr);
    if (!r) {
      st.pending.push(span);
      return;
    }
    const mid = (span.xl + span.xr) / 2;
    if (!(mid > span.xl && mid < span.xr)) {
      // Floating point cannot split this span; classify it as it stands.
      st.suspicious.push(span);
      continue;
    }
    if (!l.defined || !r.defined) {
      // A budget stop inside the helper must end the run now: the span is
      // back in `pending` and looping would only find it again (PLOT-SM-4).
      if (!refineUndefined(st, span, l, r, mid)) return;
      continue;
    }
    const m = evalAt(st, mid);
    if (!m) {
      st.pending.push(span);
      return;
    }
    if (!m.defined) {
      // A non-finite interior: shrink towards the defined sides.
      if (span.depth >= cfg.depth) st.suspicious.push(span);
      else {
        st.pending.push({ xl: span.xl, xr: mid, depth: span.depth + 1 });
        st.pending.push({ xl: mid, xr: span.xr, depth: span.depth + 1 });
      }
      continue;
    }
    const ax = toEffX(pv, span.xl);
    const ay = toEffY(pv, l.y);
    const bx = toEffX(pv, span.xr);
    const by = toEffY(pv, r.y);
    const chord = Math.hypot(bx - ax, by - ay);
    const bend = pointToChordPx(toEffX(pv, mid), toEffY(pv, m.y), ax, ay, bx, by);
    if ((chord > cfg.chordPx || bend > cfg.bendPx) && span.depth < cfg.depth && bx - ax >= COLUMN_PX) {
      st.pending.push({ xl: span.xl, xr: mid, depth: span.depth + 1 });
      st.pending.push({ xl: mid, xr: span.xr, depth: span.depth + 1 });
    } else if (chord > cfg.chordPx || bend > cfg.bendPx) {
      st.suspicious.push(span);
    } else {
      st.accepted.push(span);
    }
  }
}

/**
 * A span with a non-finite end: shrink towards defined sub-intervals. Returns
 * false when the budget ran out (the span is back in `pending`, untouched).
 */
function refineUndefined(st: FState, span: FSpan, l: FSample, r: FSample, mid: number): boolean {
  if (span.depth >= st.cfg.depth) {
    st.suspicious.push(span);
    return true;
  }
  const m = evalAt(st, mid);
  if (!m) {
    st.pending.push(span);
    return false;
  }
  // Keep only halves that touch a defined end; a fully undefined span is a gap.
  if (l.defined || m.defined) st.pending.push({ xl: span.xl, xr: mid, depth: span.depth + 1 });
  if (m.defined || r.defined) st.pending.push({ xl: mid, xr: span.xr, depth: span.depth + 1 });
  return true;
}

/**
 * Step cap reached: accept everything pending and stop (unreachable in
 * practice). Never while suspended: a suspension must leave the lists as they
 * were, so it is not a reason to give up work.
 */
function forceCap(st: FState): void {
  if (st.suspended) return;
  for (const s of st.pending) st.accepted.push(s);
  st.pending.length = 0;
  st.suspicious.length = 0;
  st.capped = true;
  st.rigorous = false;
}

/* -------------------------------- classify ---------------------------------- */

/**
 * Verdicts for suspicious spans (functions-calculus 9, stage 5). With the
 * kernel's interval enclosure the verdicts are certain; without it, bounded
 * bisection heuristics decide and `rigorous` is set to false.
 */
function runClassify(st: FState): void {
  st.phase = 'classify';
  while (st.suspicious.length > 0) {
    if (st.suspended) return;
    if (st.steps++ > STEP_CAP) {
      forceCap(st);
      return;
    }
    const span = st.suspicious.pop() as FSpan;
    const l = evalAt(st, span.xl);
    if (!l) {
      st.suspicious.push(span);
      return;
    }
    const r = evalAt(st, span.xr);
    if (!r) {
      st.suspicious.push(span);
      return;
    }
    // A verdict is atomic: remember how long every output list was, so a
    // suspension in the middle can undo its partial pushes and redo it whole
    // (cached samples keep the redo free). This keeps the finished plot the
    // same however the work was sliced.
    const mark = {
      pending: st.pending.length,
      accepted: st.accepted.length,
      suspicious: st.suspicious.length,
      markers: st.markers.length,
      ink: st.ink.length,
    };
    // Interval results are kept for the redo of an interrupted verdict only.
    const spanKey = `${span.xl},${span.xr},${span.depth}`;
    if (st.replayFor !== spanKey) {
      st.replay.clear();
      st.replayFor = spanKey;
    }
    st.inVerdict = true;
    if (l.defined && r.defined) classifyDefined(st, span, l, r);
    else if (!l.defined && !r.defined) classifyUndefined(st, span);
    else classifyEdge(st, span, l.defined ? 'left' : 'right');
    st.inVerdict = false;
    if (st.suspended) {
      st.pending.length = mark.pending;
      st.accepted.length = mark.accepted;
      st.suspicious.length = mark.suspicious;
      st.markers.length = mark.markers;
      st.ink.length = mark.ink;
      st.suspicious.push(span);
      return;
    }
  }
}

/** True when y lies more than one view height above or below the view. */
function isTall(st: FState, y: number): boolean {
  const py = toEffY(st.pv, y);
  return py < -st.heightEff || py > 2 * st.heightEff;
}

/** Two values that land within a quarter pixel of each other on screen. */
function sameY(st: FState, a: number, b: number): boolean {
  return Math.abs(toEffY(st.pv, a) - toEffY(st.pv, b)) < st.cfg.bendPx;
}

/** Where a pole or jump sits inside a suspicious span, narrowed by bisection. */
interface Narrowed {
  readonly a: number;
  readonly b: number;
  readonly ya: number;
  readonly yb: number;
  /** Best estimate of the location (the midpoint of a..b, or the undefined x). */
  readonly x: number;
}

/**
 * Bisects a span with defined ends towards the half that carries the larger
 * screen-space change, until the stretch is vanishingly narrow. A pole keeps
 * growing towards its location; a jump keeps its full height; a steep rise
 * spreads out. Null when the budget ran out (the verdict is redone later).
 */
function narrowSpan(st: FState, span: FSpan, l: FSample, r: FSample): Narrowed | null {
  let lo = span.xl;
  let hi = span.xr;
  let ylo = l.y;
  let yhi = r.y;
  const minWidth = (st.pv.box.x1 - st.pv.box.x0) * 1e-12;
  for (let i = 0; i < 80 && hi - lo > minWidth; i++) {
    const mid = (lo + hi) / 2;
    if (!(mid > lo && mid < hi)) break;
    const m = evalAt(st, mid);
    if (!m) return null;
    if (!m.defined) return { a: lo, b: hi, ya: ylo, yb: yhi, x: mid };
    const d1 = Math.abs(toEffY(st.pv, m.y) - toEffY(st.pv, ylo));
    const d2 = Math.abs(toEffY(st.pv, yhi) - toEffY(st.pv, m.y));
    if (d1 >= d2) {
      hi = mid;
      yhi = m.y;
    } else {
      lo = mid;
      ylo = m.y;
    }
  }
  return { a: lo, b: hi, ya: ylo, yb: yhi, x: (lo + hi) / 2 };
}

/** Breaks the path at a located feature: both sides are drawn up to it. */
function splitAt(st: FState, span: FSpan, at: Narrowed): void {
  if (at.a > span.xl) st.accepted.push({ xl: span.xl, xr: at.a, depth: span.depth });
  if (span.xr > at.b) st.accepted.push({ xl: at.b, xr: span.xr, depth: span.depth });
}

/** True when a known break sits within a device pixel of x (breaks are sorted: binary search). */
function isNearBreak(st: FState, x: number): boolean {
  const bs = st.breaks;
  let lo = 0;
  let hi = bs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((bs[mid] as number) < x) lo = mid + 1;
    else hi = mid;
  }
  const cx = toEffX(st.pv, x);
  for (const k of [lo - 1, lo]) {
    if (k >= 0 && k < bs.length && Math.abs(toEffX(st.pv, bs[k] as number) - cx) < 1) return true;
  }
  return false;
}

/** Records a pole at x; the renderer draws the dashed vertical from the view centre. */
function markPole(st: FState, x: number): void {
  addMarker(st, 'pole', x, (st.pv.box.y0 + st.pv.box.y1) / 2);
}

/**
 * Records a jump between the sides a and b: the side the function's value at
 * the jump belongs to gets a closed end, the other an open one.
 */
function markJump(st: FState, a: number, ya: number, b: number, yb: number): boolean {
  const c = (a + b) / 2;
  const at = evalAt(st, c);
  if (!at) return false;
  const nearBreak = isNearBreak(st, c);
  if (!nearBreak) {
    const closedLeft = at.defined && sameY(st, at.y, ya);
    const closedRight = at.defined && sameY(st, at.y, yb);
    addMarker(st, closedLeft ? 'closedEnd' : 'openEnd', a, ya);
    addMarker(st, closedRight ? 'closedEnd' : 'openEnd', b, yb);
  }
  addMarker(st, 'jump', c, (ya + yb) / 2);
  return true;
}

/** Both ends defined but the span still fails: a pole, jump, steep rise, corner or oscillation. */
function classifyDefined(st: FState, span: FSpan, l: FSample, r: FSample): void {
  const q1x = (3 * span.xl + span.xr) / 4;
  const q3x = (span.xl + 3 * span.xr) / 4;
  const q1 = evalAt(st, q1x);
  if (!q1) return;
  const q3 = evalAt(st, q3x);
  if (!q3) return;
  if (!q1.defined || !q3.defined) {
    // Non-finite quarters: treat as an edge problem on each half.
    st.suspicious.push({ xl: span.xl, xr: (span.xl + span.xr) / 2, depth: span.depth });
    st.suspicious.push({ xl: (span.xl + span.xr) / 2, xr: span.xr, depth: span.depth });
    return;
  }
  const mid = (span.xl + span.xr) / 2;
  const m = evalAt(st, mid);
  if (!m || !m.defined) {
    if (m) {
      st.suspicious.push({ xl: span.xl, xr: mid, depth: span.depth });
      st.suspicious.push({ xl: mid, xr: span.xr, depth: span.depth });
    }
    return;
  }
  const ys = [l.y, q1.y, m.y, q3.y, r.y];
  const pys = ys.map((y) => toEffY(st.pv, y));
  let flips = 0;
  let prev = 0;
  for (let i = 1; i < ys.length; i++) {
    const d = (ys[i] as number) - (ys[i - 1] as number);
    const sign = d > 0 ? 1 : d < 0 ? -1 : 0;
    if (sign !== 0) {
      if (prev !== 0 && sign !== prev) flips += 1;
      prev = sign;
    }
  }
  const up = pys.map((p) => p < -st.heightEff);
  const down = pys.map((p) => p > 2 * st.heightEff);
  let straddle = false;
  for (let i = 1; i < pys.length; i++) {
    if ((up[i - 1] && down[i]) || (down[i - 1] && up[i])) straddle = true;
  }
  const peak = flips >= 1 && (up.every(Boolean) || down.every(Boolean));
  let box: ScalarBox | null = null;
  if (straddle || peak) {
    // A pole candidate: values leave the view on both sides of one place.
    if (st.enclosure) {
      box = intervalAt(st, span.xl, span.xr);
      if (!box) return;
      if (box.def === 0) return; // Undefined throughout: a gap.
    } else {
      st.rigorous = false;
    }
    const unbounded = box !== null && (!Number.isFinite(box.lo) || !Number.isFinite(box.hi));
    if (unbounded || box === null) {
      const at = narrowSpan(st, span, l, r);
      if (!at) return;
      const tallBoth = isTall(st, at.ya) && isTall(st, at.yb);
      if (unbounded || tallBoth) {
        markPole(st, at.x);
        splitAt(st, span, at);
        return;
      }
      // Not a pole after all (a finite step): judge it as a jump.
      if (Math.abs(toEffY(st.pv, at.ya) - toEffY(st.pv, at.yb)) > 1) {
        if (!markJump(st, at.a, at.ya, at.b, at.yb)) return;
        splitAt(st, span, at);
        return;
      }
    }
  }
  // Entirely off the view on one side: nothing visible depends on the detail.
  if (pys.every((p) => p < 0) || pys.every((p) => p > st.heightEff)) {
    st.accepted.push(span);
    return;
  }
  if (flips >= 2) {
    inkForSpan(st, span, ys);
    return;
  }
  const dy = Math.abs((pys[4] as number) - (pys[0] as number));
  let biggest = 0;
  for (let i = 1; i < pys.length; i++) biggest = Math.max(biggest, Math.abs((pys[i] as number) - (pys[i - 1] as number)));
  if (dy <= st.cfg.chordPx || biggest < 0.8 * dy) {
    // A sharp corner, or a rise spread over the whole stretch: drawn joined.
    st.accepted.push(span);
    return;
  }
  // The change sits in one place at a width far below a pixel: a steep rise or a jump.
  if (st.enclosure) {
    const enc = box ?? intervalAt(st, span.xl, span.xr);
    if (!enc) return;
    if (enc.def === 2 && Number.isFinite(enc.lo) && Number.isFinite(enc.hi)) {
      st.accepted.push(span); // Continuous: the steep slope is real.
      return;
    }
    if (enc.def === 0) return;
  } else {
    st.rigorous = false;
  }
  const at = narrowSpan(st, span, l, r);
  if (!at) return;
  const finalDy = Math.abs(toEffY(st.pv, at.ya) - toEffY(st.pv, at.yb));
  if (finalDy > 2 && finalDy >= 0.5 * dy) {
    const flat = stepIsFlat(st, span, at);
    if (flat === null) return;
    if (!flat) {
      // The sides are not steady: oscillation at the resolution limit, not a step.
      inkForSpan(st, span, ys);
      return;
    }
    if (!markJump(st, at.a, at.ya, at.b, at.yb)) return;
    splitAt(st, span, at);
    return;
  }
  st.accepted.push(span);
}

/**
 * A real step keeps its level on both sides. Probes a few hundredths of a
 * pixel away from the located jump; null when the budget ran out.
 */
function stepIsFlat(st: FState, span: FSpan, at: Narrowed): boolean | null {
  const dx = (st.pv.box.x1 - st.pv.box.x0) / (st.pv.box.widthPx * st.pv.dpr) / 50;
  const left = evalAt(st, Math.max(span.xl, at.a - dx));
  if (!left) return null;
  const right = evalAt(st, Math.min(span.xr, at.b + dx));
  if (!right) return null;
  if (!left.defined || !right.defined) return false;
  return (
    Math.abs(toEffY(st.pv, left.y) - toEffY(st.pv, at.ya)) <= 2 && Math.abs(toEffY(st.pv, right.y) - toEffY(st.pv, at.yb)) <= 2
  );
}

/** Oscillation inside one column: a hairline instead of a sawtooth. */
function inkForSpan(st: FState, span: FSpan, ys: readonly number[]): void {
  let loY = Math.min(...ys);
  let hiY = Math.max(...ys);
  if (st.enclosure) {
    const enc = intervalAt(st, span.xl, span.xr);
    if (!enc) return;
    if (enc.def !== 0) {
      loY = Math.min(loY, enc.lo);
      hiY = Math.max(hiY, enc.hi);
    }
  } else {
    st.rigorous = false;
  }
  pushInk(st, (span.xl + span.xr) / 2, loY, hiY);
}

/** Records an enclosure column, clipped to the view; drops columns outside it. */
function pushInk(st: FState, x: number, loY: number, hiY: number): void {
  const pv = st.pv;
  const y0 = Math.max(0, Math.min(pv.box.heightPx, pv.toPy(hiY)));
  const y1 = Math.max(0, Math.min(pv.box.heightPx, pv.toPy(loY)));
  if (y1 < y0) return;
  if (y0 === y1 && (hiY < pv.box.y0 || loY > pv.box.y1)) return;
  st.ink.push({ x: pv.toPx(x), y0, y1 });
}

/** Neither end defined: look for a defined sub-interval, else a gap. */
function classifyUndefined(st: FState, span: FSpan): void {
  const pv = st.pv;
  const widthPx = toEffX(pv, span.xr) - toEffX(pv, span.xl);
  if (st.enclosure) {
    const box = intervalAt(st, span.xl, span.xr);
    if (!box) return;
    if (box.def === 0) return; // Gap: nothing defined here.
    if (box.def === 2) {
      // Defined everywhere, yet the ends are not finite: an overflow; treat as a gap.
      return;
    }
    if (widthPx < EDGE_PX) return;
    const mid = (span.xl + span.xr) / 2;
    if (!(mid > span.xl && mid < span.xr)) return;
    st.suspicious.push({ xl: span.xl, xr: mid, depth: span.depth });
    st.suspicious.push({ xl: mid, xr: span.xr, depth: span.depth });
    return;
  }
  st.rigorous = false;
  if (widthPx < EDGE_PX) return;
  const mid = (span.xl + span.xr) / 2;
  if (!(mid > span.xl && mid < span.xr)) return;
  const m = evalAt(st, mid);
  if (!m) return;
  st.suspicious.push({ xl: span.xl, xr: mid, depth: span.depth });
  st.suspicious.push({ xl: mid, xr: span.xr, depth: span.depth });
}

/**
 * One end defined: bisect to the last defined x, then decide pole, hole, jump
 * or plain gap by what the values do near the edge.
 */
function classifyEdge(st: FState, span: FSpan, side: 'left' | 'right'): void {
  const pv = st.pv;
  if (st.enclosure) {
    classifyEdgeEnclosed(st, span, side);
    return;
  }
  st.rigorous = false;
  // Bisect between a defined point d and an undefined point u until they meet.
  let d = side === 'left' ? span.xl : span.xr;
  let u = side === 'left' ? span.xr : span.xl;
  for (let i = 0; i < 40; i++) {
    const widthPx = Math.abs(toEffX(pv, u) - toEffX(pv, d));
    if (widthPx < EDGE_PX) break;
    const mid = (d + u) / 2;
    if (!(mid > Math.min(d, u) && mid < Math.max(d, u))) break;
    const m = evalAt(st, mid);
    if (!m) return;
    if (m.defined) d = mid;
    else u = mid;
  }
  const edge = d;
  const bound = u;
  const edgeS = evalAt(st, edge);
  if (!edgeS || !edgeS.defined) return;
  // Bands of defined values past the edge (sqrt(sin(1/x))): recurse when found.
  const gapLo = side === 'left' ? edge : span.xl;
  const gapHi = side === 'left' ? span.xr : edge;
  if (probeDefinedInside(st, gapLo, gapHi)) {
    const mid = (gapLo + gapHi) / 2;
    if (mid > gapLo && mid < gapHi) {
      st.suspicious.push({ xl: gapLo, xr: mid, depth: span.depth });
      st.suspicious.push({ xl: mid, xr: gapHi, depth: span.depth });
    }
  }
  finishEdge(st, span, side, edge, edgeS.y, bound);
}

/** One defined end with an enclosure: interval bisection for the edge. */
function classifyEdgeEnclosed(st: FState, span: FSpan, side: 'left' | 'right'): void {
  const pv = st.pv;
  // d is the defined end of the shrinking stretch, u the undefined one.
  let d = side === 'left' ? span.xl : span.xr;
  let u = side === 'left' ? span.xr : span.xl;
  const between = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a]);
  for (let i = 0; i < 40; i++) {
    const widthPx = Math.abs(toEffX(pv, u) - toEffX(pv, d));
    if (widthPx < EDGE_PX) break;
    const mid = (d + u) / 2;
    if (!(mid > Math.min(d, u) && mid < Math.max(d, u))) break;
    const [n0, n1] = between(d, mid);
    const near = intervalAt(st, n0, n1);
    if (!near) return;
    const [f0, f1] = between(mid, u);
    const far = intervalAt(st, f0, f1);
    if (!far) return;
    // A sound enclosure agrees with the sampled ends; on contradiction drop the span.
    if (near.def === 0 || far.def === 2) return;
    if (near.def === 2) {
      // The defined side is clean: the edge sits in the far half.
      d = mid;
    } else {
      // The edge may sit in the near half; the far half's bands are verdicts of their own.
      // One push covers every later iteration (later far halves sit inside it).
      if (i === 0 && far.def === 1) st.suspicious.push({ xl: f0, xr: f1, depth: span.depth });
      u = mid;
    }
  }
  const edge = d;
  const bound = u;
  const edgeS = evalAt(st, edge);
  if (!edgeS || !edgeS.defined) return;
  finishEdge(st, span, side, edge, edgeS.y, bound);
}

/** True when a defined sample sits strictly inside a gap (band check). */
function probeDefinedInside(st: FState, lo: number, hi: number): boolean {
  if (!(hi > lo)) return false;
  for (const t of [0.25, 0.5, 0.75]) {
    const x = lo + (hi - lo) * t;
    const s = evalAt(st, x);
    if (!s) return false;
    if (s.defined && x !== lo && x !== hi) return true;
  }
  return false;
}

/** Decides pole, hole, jump or gap at a refined edge and records the outcome. */
function finishEdge(st: FState, span: FSpan, side: 'left' | 'right', edge: number, edgeY: number, bound: number): void {
  const pv = st.pv;
  const edgePx = Math.abs(toEffY(pv, edgeY));
  const tall = edgePx > 2 * st.heightEff;
  // Refine the approach on the defined side.
  const nearLo = side === 'left' ? span.xl : edge;
  const nearHi = side === 'left' ? edge : span.xr;
  if (nearHi > nearLo) st.pending.push({ xl: nearLo, xr: nearHi, depth: span.depth });
  if (tall) {
    // Unbounded growth towards the gap: a pole between the edge and the bound.
    let d = edge;
    let u = bound;
    const minWidth = (pv.box.x1 - pv.box.x0) * 1e-12;
    for (let i = 0; i < 80 && Math.abs(u - d) > minWidth; i++) {
      const mid = (d + u) / 2;
      if (!(mid > Math.min(d, u) && mid < Math.max(d, u))) break;
      const m = evalAt(st, mid);
      if (!m) return;
      if (m.defined) d = mid;
      else u = mid;
    }
    if (st.enclosure) {
      // The verdict is checked with intervals over the narrowed stretch.
      const box = intervalAt(st, Math.min(d, u), Math.max(d, u));
      if (!box) return;
      if (box.def === 0) return;
    }
    markPole(st, (d + u) / 2);
    return;
  }
  // A single undefined point: look just beyond it for the matching value (a hole).
  if (!probeHole(st, edge, edgeY, bound, side)) return;
  // Look for a partner edge just across the gap: a hole or a jump.
  const partner = findPartner(st, edge, side);
  if (partner !== undefined) {
    const gapPx = Math.abs(toEffX(pv, partner.x) - toEffX(pv, edge));
    const dyPx = Math.abs(toEffY(pv, partner.y) - toEffY(pv, edgeY));
    if (gapPx < PARTNER_PX && dyPx < HOLE_PX) {
      const a = Math.min(edge, partner.x);
      const b = Math.max(edge, partner.x);
      st.accepted.push({ xl: a, xr: b, depth: span.depth });
      addMarker(st, 'hole', (a + b) / 2, (edgeY + partner.y) / 2);
      return;
    }
    if (gapPx < PARTNER_PX) {
      const c = (edge + partner.x) / 2;
      const lo = Math.min(edge, partner.x);
      const hi = Math.max(edge, partner.x);
      const yLo = edge < partner.x ? edgeY : partner.y;
      const yHi = edge < partner.x ? partner.y : edgeY;
      const flat = stepIsFlat(st, { xl: Number.NEGATIVE_INFINITY, xr: Number.POSITIVE_INFINITY, depth: 0 }, { a: lo, b: hi, ya: yLo, yb: yHi, x: c });
      if (flat === null) return;
      if (!flat) {
        // Not a steady step: oscillation at the resolution limit, drawn as a hairline.
        pushInk(st, c, Math.min(yLo, yHi), Math.max(yLo, yHi));
        return;
      }
      const at = evalAt(st, c);
      if (!at) return;
      // Near a known break the break verdict below owns the end markers.
      const nearBreak = isNearBreak(st, c);
      if (!nearBreak) {
        const closedLeft = at.defined && closeY(at.y, side === 'left' ? edgeY : partner.y);
        const closedRight = at.defined && closeY(at.y, side === 'left' ? partner.y : edgeY);
        addMarker(st, closedLeft ? 'closedEnd' : 'openEnd', edge, edgeY);
        addMarker(st, closedRight ? 'closedEnd' : 'openEnd', partner.x, partner.y);
      }
      addMarker(st, 'jump', c, (edgeY + partner.y) / 2);
      return;
    }
  }
}

/**
 * Probes the mirror image of the edge across the undefined point. A defined,
 * matching value there means one missing point: join across and mark a hole.
 * Returns false when the verdict is settled (or the budget ran out).
 */
function probeHole(st: FState, edge: number, edgeY: number, bound: number, side: 'left' | 'right'): boolean {
  const beyond = bound + (bound - edge);
  if (!(beyond !== bound) || !Number.isFinite(beyond)) return true;
  const p = evalAt(st, beyond);
  if (!p) return false;
  if (!p.defined || !sameY(st, p.y, edgeY)) return true;
  const a = side === 'left' ? edge : beyond;
  const b = side === 'left' ? beyond : edge;
  st.accepted.push({ xl: Math.min(a, b), xr: Math.max(a, b), depth: 0 });
  addMarker(st, 'hole', bound, (edgeY + p.y) / 2);
  return false;
}

/** Nearest defined sample across the gap, if any. */
function findPartner(st: FState, edge: number, side: 'left' | 'right'): FSample | undefined {
  const x = side === 'left' ? st.definedXs.successor(edge) : st.definedXs.predecessor(edge);
  return x === undefined ? undefined : st.samples.get(x);
}

function closeY(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

function addMarker(st: FState, kind: MarkerKind, x: number, y: number): void {
  // A marker that cannot be drawn (non-finite coordinates) is never recorded.
  const marker = makeMarker(st.pv, kind, x, y);
  if (marker === undefined) return;
  // Markers obey the sample cap too (performance.md 5).
  if (st.markers.length >= st.cfg.maxSamples) {
    st.capped = true;
    return;
  }
  st.markers.push(marker);
}

/* ------------------------------- exact + loop ------------------------------ */

/**
 * `with exact = true` (functions-calculus 9): one enclosure per pixel column,
 * drawn as a band. Pending spans are whole columns here.
 */
function runExact(st: FState): void {
  const pv = st.pv;
  st.phase = 'band';
  // The band is only entered with an enclosure (resume refuses one without).
  if (!st.enclosure) throw new Error('the band phase needs an enclosure');
  while (st.pending.length > 0) {
    if (st.suspended) return;
    if (st.steps++ > STEP_CAP) {
      forceCap(st);
      return;
    }
    const span = st.pending.pop() as FSpan;
    const box = intervalAt(st, span.xl, span.xr);
    if (!box) {
      st.pending.push(span);
      return;
    }
    if (box.def === 0) continue;
    const loY = Number.isFinite(box.lo) ? box.lo : pv.box.y0 - (pv.box.y1 - pv.box.y0);
    const hiY = Number.isFinite(box.hi) ? box.hi : pv.box.y1 + (pv.box.y1 - pv.box.y0);
    pushInk(st, (span.xl + span.xr) / 2, loY, hiY);
  }
}

/** Exact mode is active only with an enclosure; otherwise the curve is normal. */
function exactActive(st: FState): boolean {
  return st.cfg.exact && st.enclosure !== undefined;
}

/** Drains setup, refinement and classification until suspended or done. */
function runLoop(st: FState): void {
  if (st.phase !== 'band') {
    runCurve(st);
    if (st.suspended || !exactActive(st)) return;
    // The band is drawn on top of the same verdicts: markers come from the curve pass.
    st.ink.length = 0;
    setupExactColumns(st);
    st.phase = 'band';
  }
  runExact(st);
}

/** The curve pass: setup, refinement and classification until suspended or drained. */
function runCurve(st: FState): void {
  for (;;) {
    if (st.phase === 'setup') {
      runSetup(st);
      if (st.suspended) return;
    }
    if (st.phase === 'refine') {
      runRefine(st);
      if (st.suspended) return;
      if (st.suspicious.length === 0) return;
      st.phase = 'classify';
    }
    // Classification may push spans back to pending; alternate until both drain.
    runClassify(st);
    if (st.suspended) return;
    if (st.pending.length === 0) return;
    st.phase = 'refine';
  }
}

/** Exact mode: one pending span per device-pixel column over every piece. */
function setupExactColumns(st: FState): void {
  const pv = st.pv;
  const cols: FSpan[] = [];
  for (const p of st.pieces) {
    const x0 = Math.max(p.lo, pv.box.x0);
    const x1 = Math.min(p.hi, pv.box.x1);
    const c0 = Math.floor(pv.toPx(x0) * pv.dpr);
    const c1 = Math.ceil(pv.toPx(x1) * pv.dpr);
    for (let c = c0; c < c1; c++) {
      const xl = Math.max(x0, pv.toX(c / pv.dpr));
      const xr = Math.min(x1, pv.toX((c + 1) / pv.dpr));
      if (xr > xl) cols.push({ xl, xr, depth: 0 });
    }
  }
  // Ascending so the stack pops them in a stable order.
  cols.sort((a, b) => a.xl - b.xl);
  for (const c of cols) st.pending.push(c);
}

/* ---------------------------------- emit ----------------------------------- */

function makeStats(st: FState, complete: boolean, samples: number): PlotStats {
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

/** Chains accepted spans into polylines, splitting at non-finite ends. */
function chainSpans(st: FState): number[][][] {
  const spans = [...st.accepted];
  spans.sort((a, b) => (a.xl - b.xl) || (a.xr - b.xr));
  const chains: number[][][] = [];
  let current: number[][] = [];
  let prevXr = Number.NaN;
  const flush = (): void => {
    if (current.length > 1) chains.push(current);
    current = [];
    prevXr = Number.NaN;
  };
  let prevKey = '';
  for (const s of spans) {
    const key = `${s.xl},${s.xr}`;
    if (key === prevKey) continue; // Verdict overlaps can accept a span twice.
    prevKey = key;
    const l = st.samples.get(s.xl);
    const r = st.samples.get(s.xr);
    if (!l || !r || !l.defined || !r.defined) {
      flush();
      continue;
    }
    if (current.length === 0) {
      current.push([s.xl, l.y]);
      current.push([s.xr, r.y]);
    } else if (s.xl === prevXr) {
      current.push([s.xr, r.y]);
    } else {
      flush();
      current.push([s.xl, l.y]);
      current.push([s.xr, r.y]);
    }
    prevXr = s.xr;
  }
  flush();
  return chains;
}

/** Merges chains across continuous breaks and hole breaks; marks jumps. */
function resolveBreaks(st: FState, chains: number[][][]): number[][][] {
  const pv = st.pv;
  const sampleAt = (x: number): FSample | undefined => st.samples.get(x);
  const limitBelow = (b: number): FSample | undefined => {
    const x = st.definedXs.predecessor(b);
    return x === undefined ? undefined : sampleAt(x);
  };
  const limitAbove = (b: number): FSample | undefined => {
    const x = st.definedXs.successor(b);
    return x === undefined ? undefined : sampleAt(x);
  };
  const merged: boolean[] = chains.map(() => false);
  for (const b of st.breaks) {
    if (!(b > pv.box.x0 && b < pv.box.x1)) continue;
    if (!inPieces(st.pieces, b)) continue;
    const at = sampleAt(b);
    const loS = limitBelow(b);
    const hiS = limitAbove(b);
    if (!loS || !hiS) continue;
    const agree = sameY(st, loS.y, hiS.y);
    if (at && at.defined && agree && sameY(st, at.y, loS.y)) {
      mergeAcross(pv, chains, merged, b); // Continuous corner: join, no marker.
    } else if ((!at || !at.defined) && agree) {
      if (!st.enclosure) st.rigorous = false;
      mergeAcross(pv, chains, merged, b);
      addMarker(st, 'hole', b, (loS.y + hiS.y) / 2);
    } else if (!agree && (isTall(st, loS.y) || isTall(st, hiS.y))) {
      // Values leave the view at the break: a pole, no ends to mark.
      if (!st.enclosure) st.rigorous = false;
      markPole(st, b);
    } else if (agree) {
      // Defined at the break but off the limits: a removable point shown as a hole.
      if (!st.enclosure) st.rigorous = false;
      mergeAcross(pv, chains, merged, b);
      addMarker(st, 'hole', b, (loS.y + hiS.y) / 2);
    } else {
      if (!st.enclosure) st.rigorous = false;
      const closedLo = at !== undefined && at.defined && sameY(st, at.y, loS.y);
      const closedHi = at !== undefined && at.defined && sameY(st, at.y, hiS.y);
      addMarker(st, closedLo ? 'closedEnd' : 'openEnd', b, loS.y);
      addMarker(st, closedHi ? 'closedEnd' : 'openEnd', b, hiS.y);
      addMarker(st, 'jump', b, (loS.y + hiS.y) / 2);
    }
  }
  return chains.filter((_, i) => !merged[i]);
}

function inPieces(pieces: readonly ResumePiece[], b: number): boolean {
  return pieces.some((p) => b >= p.lo && b <= p.hi);
}

/** Concatenates the two chains straddling a continuous break. */
function mergeAcross(pv: PlotView, chains: number[][][], merged: boolean[], b: number): void {
  const chainEnd = (c: number[][]): number => (c[c.length - 1] as number[])[0] as number;
  const chainStart = (c: number[][]): number => (c[0] as number[])[0] as number;
  let left = -1;
  let right = -1;
  for (let i = 0; i < chains.length; i++) {
    if (merged[i]) continue;
    const c = chains[i] as number[][];
    if (chainEnd(c) <= b && (left === -1 || chainEnd(c) > chainEnd(chains[left] as number[][]))) left = i;
    if (chainStart(c) >= b && (right === -1 || chainStart(c) < chainStart(chains[right] as number[][]))) right = i;
  }
  if (left === -1 || right === -1 || left === right) return;
  const gapPx = Math.abs(toEffX(pv, chainStart(chains[right] as number[][])) - toEffX(pv, chainEnd(chains[left] as number[][])));
  if (!(gapPx < 2)) return;
  const into = chains[left] as number[][];
  const from = chains[right] as number[][];
  for (const pt of from) into.push(pt);
  merged[right] = true;
}

/** End markers for domain bounds (view-clipped ends get none). */
function markDomainEnds(st: FState): void {
  for (const p of st.pieces) {
    for (const [x, kind] of [[p.lo, p.loKind], [p.hi, p.hiKind]] as const) {
      if (kind === 'view' || kind === 'break') continue;
      const s = st.samples.get(x);
      if (!s || !s.defined) {
        if (kind === 'closed' || kind === 'open') addMarker(st, 'openEnd', x, edgeFallbackY(st, x));
        continue;
      }
      addMarker(st, kind === 'closed' ? 'closedEnd' : 'openEnd', x, s.y);
    }
  }
}

/** Fallback y for an undefined domain end: the nearest defined sample's y. */
function edgeFallbackY(st: FState, x: number): number {
  const below = st.definedXs.predecessor(x);
  const above = st.definedXs.successor(x);
  let best: number | undefined = below;
  if (above !== undefined && (below === undefined || above - x < x - below)) best = above;
  const sample = best === undefined ? undefined : st.samples.get(best);
  return sample ? sample.y : (st.pv.box.y0 + st.pv.box.y1) / 2;
}

function sortMarkers(st: FState): PlotMarker[] {
  const order = (k: MarkerKind): number =>
    k === 'pole' ? 0 : k === 'hole' ? 1 : k === 'jump' ? 2 : k === 'closedEnd' ? 3 : k === 'openEnd' ? 4 : 5;
  const ms = [...st.markers];
  ms.sort((a, b) => a.x - b.x || a.y - b.y || order(a.kind) - order(b.kind));
  // Verdicts redone after a suspend can record a marker twice; collapse those.
  const out: PlotMarker[] = [];
  for (const m of ms) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.kind === m.kind &&
      Math.abs(toEffX(st.pv, m.x) - toEffX(st.pv, prev.x)) < PARTNER_PX &&
      Math.abs(toEffY(st.pv, m.y) - toEffY(st.pv, prev.y)) < PARTNER_PX
    ) {
      continue;
    }
    out.push(m);
  }
  return out;
}

function sortInk(st: FState): InkColumn[] {
  const cols = [...st.ink];
  cols.sort((a, b) => a.x - b.x || a.y0 - b.y0);
  const out: InkColumn[] = [];
  for (const c of cols) {
    const prev = out[out.length - 1];
    if (prev && c.x === prev.x) {
      // Same column recorded twice (a redone verdict): keep the widest span.
      if (c.y0 < prev.y0 || c.y1 > prev.y1) {
        out[out.length - 1] = { x: prev.x, y0: Math.min(prev.y0, c.y0), y1: Math.max(prev.y1, c.y1) };
      }
      continue;
    }
    out.push(c);
  }
  return out;
}

/** Converts chains to clipped pixel polylines. */
function toPaths(st: FState, chains: number[][][]): { paths: Float64Array[]; samples: number } {
  const pv = st.pv;
  const h = pv.box.heightPx;
  const loClip = -4 * h;
  const hiClip = 5 * h;
  const paths: Float64Array[] = [];
  let samples = 0;
  for (const c of chains) {
    const arr = new Float64Array(c.length * 2);
    for (let i = 0; i < c.length; i++) {
      const pt = c[i] as number[];
      const px = pv.toPx(pt[0] as number);
      const pyRaw = pv.toPy(pt[1] as number);
      arr[2 * i] = px;
      arr[2 * i + 1] = pyRaw < loClip ? loClip : pyRaw > hiClip ? hiClip : pyRaw;
    }
    samples += c.length;
    paths.push(arr);
  }
  return { paths, samples };
}

/* ------------------------------ suspend/resume ----------------------------- */

function toToken(st: FState): FunctionResume {
  const keys = [...st.samples.keys()].sort((a, b) => a - b);
  const xs = new Float64Array(keys.length);
  const ys = new Float64Array(keys.length);
  const defined: number[] = [];
  for (let i = 0; i < keys.length; i++) {
    const s = st.samples.get(keys[i] as number) as FSample;
    xs[i] = s.x;
    ys[i] = s.defined ? s.y : Number.NaN;
    defined.push(s.defined ? 1 : 0);
  }
  const spans = (ss: FSpan[]): FunctionResumeSpan[] => ss.map((s) => ({ xl: s.xl, xr: s.xr, depth: s.depth }));
  return {
    kind: 'function-plot',
    pending: spans(st.pending),
    accepted: spans(st.accepted),
    suspicious: spans(st.suspicious),
    samples: { xs, ys },
    defined,
    markers: [...st.markers],
    inkColumns: [...st.ink],
    evals: st.evals,
    intervalEvals: st.intervalEvals,
    maxDepthSeen: st.maxDepthSeen,
    rigorous: st.rigorous,
    capped: st.capped,
    phase: st.phase,
    pieces: [...st.pieces],
    breaks: [...st.breaks],
    coarseXs: [...st.coarseXs],
    coarseDone: st.coarseDone,
    view: st.pv.box,
    depth: st.cfg.depth,
    bendPx: st.cfg.bendPx,
    chordPx: st.cfg.chordPx,
    maxSamples: st.cfg.maxSamples,
    exact: st.cfg.exact,
    ...(st.version === undefined ? {} : { version: st.version }),
    enclosed: st.enclosure !== undefined,
    replayFor: st.replayFor,
    replay: [...st.replay].map(([key, box]): ReplayBox => {
      const [lo, hi] = key.split(',');
      return { lo: Number(lo), hi: Number(hi), boxLo: box.lo, boxHi: box.hi, def: box.def };
    }),
  };
}

/** Tokens cross a worker boundary as plain data, so every field is checked like a fresh call's options. */
const TOKEN_MAX_ITEMS = 1 << 22;
const TOKEN_MAX_COARSE = 1 << 18;
const TOKEN_MAX_PIECES = 1 << 14;
const MARKER_KINDS: ReadonlySet<string> = new Set([
  'hole', 'openEnd', 'closedEnd', 'pole', 'jump', 'cusp', 'singular', 'isolated', 'end',
]);
const PIECE_KINDS: ReadonlySet<string> = new Set(['view', 'closed', 'open', 'break']);

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function checkToken(caller: string, token: FunctionResume): ErrorObject | undefined {
  if (typeof token !== 'object' || token === null || token.kind !== 'function-plot') {
    return badArgument(caller, 'the resume token is not a function-plot token', 'Resume with the token from a suspended plotFunction result.');
  }
  const malformed = (what: string): ErrorObject =>
    badArgument(caller, `the resume token has ${what}`, 'Resume with the token from a suspended plotFunction result.');
  const depthLimit = isFiniteNumber(token.depth) ? token.depth : -1;
  const spansOk = (ss: readonly FunctionResumeSpan[]): boolean =>
    Array.isArray(ss) &&
    ss.length <= TOKEN_MAX_ITEMS &&
    ss.every(
      (s) =>
        s &&
        isFiniteNumber(s.xl) &&
        isFiniteNumber(s.xr) &&
        s.xl <= s.xr &&
        Number.isInteger(s.depth) &&
        s.depth >= 0 &&
        s.depth <= depthLimit,
    );
  if (!spansOk(token.pending) || !spansOk(token.accepted) || !spansOk(token.suspicious)) return malformed('malformed spans');
  if (
    !(token.samples?.xs instanceof Float64Array) ||
    !(token.samples?.ys instanceof Float64Array) ||
    token.samples.xs.length !== token.samples.ys.length ||
    token.samples.xs.length > TOKEN_MAX_ITEMS ||
    !Array.isArray(token.defined) ||
    token.defined.length !== token.samples.xs.length
  ) {
    return malformed('malformed samples');
  }
  for (let i = 0; i < token.samples.xs.length; i++) {
    if (!Number.isFinite(token.samples.xs[i] as number)) return malformed('malformed samples');
  }
  if (!Array.isArray(token.markers) || !Array.isArray(token.inkColumns) || !Array.isArray(token.pieces) || !Array.isArray(token.breaks)) {
    return malformed('a malformed shape');
  }
  const badView = checkView(caller, token.view);
  if (badView) return badView;
  if (
    !isCount(token.evals) ||
    !isCount(token.intervalEvals) ||
    !isCount(token.maxDepthSeen) ||
    !isCount(token.coarseDone) ||
    typeof token.rigorous !== 'boolean' ||
    typeof token.capped !== 'boolean' ||
    (token.phase !== 'setup' && token.phase !== 'refine' && token.phase !== 'classify' && token.phase !== 'band')
  ) {
    return malformed('a malformed shape');
  }
  // The configuration is held to the limits of a fresh call (checkScalarOptions, checkBudgets).
  if (!Number.isInteger(token.depth) || token.depth < 1 || token.depth > 24) return malformed('a depth outside 1..24');
  if (!isFiniteNumber(token.bendPx) || token.bendPx <= 0 || !isFiniteNumber(token.chordPx) || token.chordPx <= 0) {
    return malformed('non-positive bendPx or chordPx');
  }
  if (!Number.isInteger(token.maxSamples) || token.maxSamples < 16 || token.maxSamples > HARD_MAX_SAMPLES) {
    return malformed('a maxSamples outside 16..65536');
  }
  if (typeof token.exact !== 'boolean') return malformed('a malformed exact flag');
  if (token.version !== undefined && !isFiniteNumber(token.version)) return malformed('a malformed version');
  if (token.replayFor !== undefined && typeof token.replayFor !== 'string') return malformed('a malformed replay key');
  if (token.enclosed !== undefined && typeof token.enclosed !== 'boolean') return malformed('a malformed enclosure flag');
  if (token.phase === 'band' && !token.exact) return malformed('a band phase without exact mode');
  if (!Array.isArray(token.coarseXs) || token.coarseXs.length > TOKEN_MAX_COARSE || !token.coarseXs.every((x) => isFiniteNumber(x))) {
    return malformed('malformed coarse samples');
  }
  if (token.coarseDone > token.coarseXs.length) return malformed('a coarse count past its grid');
  if (
    token.pieces.length > TOKEN_MAX_PIECES ||
    !token.pieces.every(
      (p) =>
        p &&
        isFiniteNumber(p.lo) &&
        isFiniteNumber(p.hi) &&
        p.lo <= p.hi &&
        PIECE_KINDS.has(p.loKind) &&
        PIECE_KINDS.has(p.hiKind),
    )
  ) {
    return malformed('malformed pieces');
  }
  if (
    token.breaks.length > 4096 ||
    !token.breaks.every((b, i, all) => isFiniteNumber(b) && (i === 0 || b > (all[i - 1] as number)))
  ) {
    return malformed('breaks that are not sorted finite numbers');
  }
  if (
    token.markers.length > token.maxSamples ||
    !token.markers.every(
      (m) => m && MARKER_KINDS.has(m.kind) && isFiniteNumber(m.x) && isFiniteNumber(m.y) && isFiniteNumber(m.px) && isFiniteNumber(m.py),
    )
  ) {
    return malformed('malformed markers');
  }
  if (
    token.inkColumns.length > TOKEN_MAX_ITEMS ||
    !token.inkColumns.every((c) => c && isFiniteNumber(c.x) && isFiniteNumber(c.y0) && isFiniteNumber(c.y1))
  ) {
    return malformed('malformed ink columns');
  }
  if (
    token.replay !== undefined &&
    (!Array.isArray(token.replay) ||
      token.replay.length > 4096 ||
      !token.replay.every(
        (r) =>
          r &&
          typeof r.lo === 'number' &&
          typeof r.hi === 'number' &&
          typeof r.boxLo === 'number' &&
          typeof r.boxHi === 'number' &&
          !Number.isNaN(r.lo + r.hi + r.boxLo + r.boxHi) &&
          (r.def === 0 || r.def === 1 || r.def === 2),
      ))
  ) {
    return malformed('malformed interval results');
  }
  return undefined;
}

/** Up to three sample positions (first, middle, last) the resume spot-checks. */
function probeIndices(token: FunctionResume): number[] {
  const n = token.samples.xs.length;
  const found: number[] = [];
  for (const at of [0, Math.floor(n / 2), n - 1]) {
    for (let i = at; i < n && i <= at + 8; i++) {
      if (!found.includes(i)) {
        found.push(i);
        break;
      }
    }
  }
  return found;
}

/* --------------------------------- public ---------------------------------- */

function finishSuspended(st: FState): FunctionPlot {
  return { paths: [], markers: [], inkColumns: [], stats: makeStats(st, false, 0), resume: toToken(st) };
}

function finishComplete(st: FState): FunctionPlot {
  let chains = chainSpans(st);
  chains = resolveBreaks(st, chains);
  const thin = thinChains(chains, st.cfg.maxSamples);
  if (thin.thinned) {
    chains = thin.chains as number[][][];
    st.capped = true;
  }
  markDomainEnds(st);
  const { paths, samples } = toPaths(st, chains);
  if (exactActive(st)) {
    // The band replaces the curve; the verdict markers stay (same code path).
    return { paths: [], markers: sortMarkers(st), inkColumns: sortInk(st), stats: makeStats(st, true, 0) };
  }
  const plot: FunctionPlot = {
    paths,
    markers: sortMarkers(st),
    inkColumns: sortInk(st),
    stats: makeStats(st, true, samples),
  };
  return plot;
}

/**
 * Plots `y = f(x)` over a view (functions-calculus 9). `maxEvals` bounds the
 * evaluations spent by one call; when it runs out the result carries
 * `stats.complete: false` and a resume token, the caller keeps showing the
 * previous frame, and `resumeFunctionPlot` continues with a fresh budget. The
 * finished paths are identical however the work was sliced.
 */
export function plotFunction(fn: FunctionValue, view: ViewBox, options: FunctionPlotOptions = {}): Result<FunctionPlot> {
  return guard('plotFunction', () => {
    const fnProblem = checkFn('plotFunction', fn);
    if (fnProblem) return fnProblem;
    const viewProblem = checkView('plotFunction', view);
    if (viewProblem) return viewProblem;
    const checked = checkScalarOptions('plotFunction', options);
    if (checked.problem) return checked.problem;
    const breaksProblem = checkBreaks('plotFunction', options.breaks);
    if (breaksProblem) return breaksProblem;
    const domainProblem = checkDomain('plotFunction', options.domain);
    if (domainProblem) return domainProblem;
    const seedProblem = checkSeed('plotFunction', options.seed);
    if (seedProblem) return seedProblem;
    if (options.version !== undefined && !isFiniteNumber(options.version)) {
      return badArgument('plotFunction', `version must be a finite number (got ${String(options.version)})`, 'Pass the version stamp of the function.');
    }
    const pvResult = createView(view);
    if (!pvResult.ok) return pvResult;
    const pv = pvResult.value;
    const cfg = checked.cfg;
    const wantCoarse = cfg.coarse > 0 ? cfg.coarse : Math.max(64, Math.round(pv.widthEff / 4));
    // The sample cap bounds the coarse grid too (performance.md 5).
    const coarse = Math.min(wantCoarse, cfg.maxSamples);
    const breaks = [...(options.breaks ?? [])].sort((a, b) => a - b).filter((b, i, arr) => i === 0 || b !== arr[i - 1]);
    const pieces = makePieces(view, options.domain, breaks);
    // The seed is trimmed to the view and to the sample cap before use (PLOT-SM-6).
    const seedSamples = new Map<number, FSample>();
    if (options.seed) {
      const seed = options.seed;
      const at = new Map<number, number>();
      for (let i = 0; i < seed.xs.length; i++) at.set(seed.xs[i] as number, i);
      for (const x of trimSeedKeys(at.keys(), view.x0, view.x1, cfg.maxSamples)) {
        seedSamples.set(x, toSample(x, seed.ys[at.get(x) as number] as number));
      }
    }
    const fast = fn.call1;
    const call1 = fast ? (x: number): number => fast(x) : (x: number): number => fn.call(x) as number;
    const st: FState = {
      pv,
      samples: new Map(),
      seed: seedSamples,
      definedXs: new SortedSet(),
      pending: [],
      accepted: [],
      suspicious: [],
      markers: [],
      ink: [],
      call1,
      batch: typeof fn.batch === 'function' ? fn.batch : undefined,
      enclosure: options.enclosure,
      cfg: { ...cfg, coarse },
      version: options.version,
      replay: new Map(),
      replayFor: '',
      inVerdict: false,
      heightEff: pv.heightEff,
      base: 0,
      pieces,
      breaks,
      coarseXs: makeCoarseXs(pieces, coarse, breakEps(view), [...seedSamples.keys()].sort((a, b) => a - b)),
      coarseDone: 0,
      phase: 'setup',
      evals: 0,
      intervalEvals: 0,
      maxDepthSeen: 0,
      rigorous: true,
      capped: coarse < wantCoarse,
      suspended: false,
      steps: 0,
    };
    if (options.exact === true && !options.enclosure) st.rigorous = false;
    runLoop(st);
    return { ok: true, value: st.suspended ? finishSuspended(st) : finishComplete(st), notices: [] };
  });
}

export interface ResumeFunctionOptions {
  /** The same enclosure the suspended run used, when it had one. */
  readonly enclosure?: ScalarEnclosure;
  /** Fresh evaluation budget for this call. */
  readonly maxEvals?: number;
  /**
   * The function's current version stamp. It must equal the `version` the run
   * was started with (both absent counts as equal); a different version means
   * a different function, and the suspended run is refused.
   */
  readonly version?: number;
}

/** Continues a suspended `plotFunction` run with the same function. */
export function resumeFunctionPlot(token: FunctionResume, fn: FunctionValue, options: ResumeFunctionOptions = {}): Result<FunctionPlot> {
  return guard('resumeFunctionPlot', () => {
    const tokenProblem = checkToken('resumeFunctionPlot', token);
    if (tokenProblem) return tokenProblem;
    const fnProblem = checkFn('resumeFunctionPlot', fn);
    if (fnProblem) return fnProblem;
    const budgetProblem = checkBudgets('resumeFunctionPlot', undefined, options.maxEvals);
    if (budgetProblem) return budgetProblem;
    if (options.version !== undefined && !isFiniteNumber(options.version)) {
      return badArgument('resumeFunctionPlot', `version must be a finite number (got ${String(options.version)})`, 'Pass the version stamp of the function.');
    }
    if ((token.version ?? null) !== (options.version ?? null)) {
      return badArgument(
        'resumeFunctionPlot',
        `the token belongs to function version ${String(token.version)}, not ${String(options.version)}`,
        'A new function version discards the suspended plot; start again with plotFunction.',
      );
    }
    // A run that used an enclosure needs it again: its verdicts and the exact band depend on it.
    if ((token.enclosed ?? token.intervalEvals > 0) && !options.enclosure) {
      return badArgument(
        'resumeFunctionPlot',
        'the suspended plot used an enclosure and none was given',
        'Resume with the same enclosure, or start again with plotFunction.',
      );
    }
    const pvResult = createView(token.view);
    if (!pvResult.ok) return pvResult;
    const pv = pvResult.value;
    const fast = fn.call1;
    const call1 = fast ? (x: number): number => fast(x) : (x: number): number => fn.call(x) as number;
    // Without a version stamp a different function would be stitched in silently,
    // so the token's own samples are spot-checked against this function.
    const probes = probeIndices(token);
    for (const i of probes) {
      const x = token.samples.xs[i] as number;
      const stored = token.samples.ys[i] as number;
      const now = toSample(x, call1(x));
      const same = now.defined ? Math.abs(now.y - stored) <= 1e-9 * Math.max(1, Math.abs(stored)) : Number.isNaN(stored);
      if (!same) {
        return badArgument(
          'resumeFunctionPlot',
          `the function gives ${String(now.y)} at x = ${String(x)}, the token holds ${String(stored)}`,
          'The token belongs to another function; start again with plotFunction.',
        );
      }
    }
    const samples = new Map<number, FSample>();
    const definedXs = new SortedSet();
    for (let i = 0; i < token.samples.xs.length; i++) {
      const x = token.samples.xs[i] as number;
      const sample = toSample(x, token.samples.ys[i] as number);
      samples.set(x, sample);
      if (sample.defined) definedXs.add(x);
    }
    const spans = (ss: readonly FunctionResumeSpan[]): FSpan[] => ss.map((s) => ({ xl: s.xl, xr: s.xr, depth: s.depth }));
    const st: FState = {
      pv,
      samples,
      seed: new Map(),
      definedXs,
      pending: spans(token.pending),
      accepted: spans(token.accepted),
      suspicious: spans(token.suspicious),
      markers: [...token.markers],
      ink: [...token.inkColumns],
      call1,
      batch: typeof fn.batch === 'function' ? fn.batch : undefined,
      enclosure: options.enclosure,
      cfg: {
        coarse: token.coarseXs.length,
        depth: token.depth,
        bendPx: token.bendPx,
        chordPx: token.chordPx,
        maxSamples: token.maxSamples,
        maxEvals: options.maxEvals === undefined ? DEFAULT_MAX_EVALS_FUNCTION : Math.floor(options.maxEvals),
        exact: token.exact,
      },
      version: token.version,
      replay: new Map((token.replay ?? []).map((r): [string, ScalarBox] => [`${r.lo},${r.hi}`, { lo: r.boxLo, hi: r.boxHi, def: r.def }])),
      replayFor: token.replayFor ?? '',
      inVerdict: false,
      heightEff: pv.heightEff,
      base: token.evals + token.intervalEvals + probes.length,
      pieces: [...token.pieces],
      breaks: [...token.breaks],
      coarseXs: [...token.coarseXs],
      coarseDone: token.coarseDone,
      phase: token.phase,
      evals: token.evals + probes.length,
      intervalEvals: token.intervalEvals,
      maxDepthSeen: token.maxDepthSeen,
      rigorous: token.rigorous,
      capped: token.capped,
      suspended: false,
      steps: 0,
    };
    // A resumed run without the original enclosure cannot stay rigorous.
    if (token.intervalEvals > 0 && !options.enclosure) st.rigorous = false;
    if (token.exact && !options.enclosure) st.rigorous = false;
    runLoop(st);
    if (st.suspended) {
      const plot = finishSuspended(st);
      return { ok: true, value: plot, notices: [] };
    }
    return { ok: true, value: finishComplete(st), notices: [] };
  });
}
