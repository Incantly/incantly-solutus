/**
 * The parametric tracer (curves-loci 5): interval culling of off-screen
 * parameter boxes, coarse sampling per box, then screen-space refinement in
 * parameter space with a turning-angle test, cusp detection, and gap/pole
 * verdicts. Output is pixel polylines plus markers, a pure function of the
 * curve, the view and the pixel size.
 *
 * Unlike `plotFunction` this tracer does not suspend: `maxEvals` exhaustion
 * returns `complete: false` with empty output and the caller re-runs with a
 * larger budget (heavy figures trace in a worker, performance.md 5.5).
 */
import type { ErrorObject, FunctionValue, Result } from '@incantly/kernel';
import {
  DEFAULT_MAX_EVALS_PARAM,
  MAX_SAMPLES_PER_CURVE,
  REFINE_BEND_PX,
  REFINE_CHORD_PX,
  REFINE_MAX_DEPTH,
  REFINE_TURN_DEGREES,
} from './contracts';
import type {
  MarkerKind,
  ParamBox,
  ParamCurveInput,
  ParamEnclosure,
  ParamPlot,
  ParamPlotOptions,
  ParamSeed,
  PlotMarker,
  PlotStats,
  ViewBox,
} from './contracts';
import { badArgument, checkBudgets, checkView, guard, isFiniteNumber } from './errors';
import { createView, pointToChordPx, turnDegrees } from './view';
import type { PlotView } from './view';

interface PSample {
  readonly s: number;
  readonly x: number;
  readonly y: number;
  readonly defined: boolean;
}

interface PSpan {
  readonly sl: number;
  readonly sr: number;
  readonly depth: number;
}

interface PState {
  readonly pv: PlotView;
  readonly samples: Map<number, PSample>;
  readonly pending: PSpan[];
  readonly accepted: PSpan[];
  readonly suspicious: PSpan[];
  readonly markers: PlotMarker[];
  readonly fn: FunctionValue;
  readonly enclosure: ParamEnclosure | undefined;
  readonly maxSamples: number;
  readonly maxEvals: number;
  readonly depth: number;
  readonly bendPx: number;
  readonly chordPx: number;
  readonly turnDegrees: number;
  evals: number;
  intervalEvals: number;
  maxDepthSeen: number;
  rigorous: boolean;
  capped: boolean;
  dead: boolean;
  steps: number;
}

const STEP_CAP = 2000000;
const CUSP_DEGREES = 120;
const COLUMN_PX = 0.5;
const CULL_SPLIT_PX = 128;
const CULL_DEPTH = 10;

/* -------------------------------- validation -------------------------------- */

function checkParamFn(caller: string, fn: FunctionValue): ErrorObject | undefined {
  if (typeof fn !== 'object' || fn === null || typeof fn.call !== 'function') {
    return badArgument(caller, 'the curve is not a compiled FunctionValue', 'Pass a one-parameter Point function from the language.');
  }
  if (fn.arity !== 1 || fn.ret !== 'Point') {
    return badArgument(
      caller,
      `traceParamCurve needs a Function<Point>(1) (got arity ${String(fn.arity)}, ${String(fn.ret)})`,
      'Plot a Number function with plotFunction instead.',
    );
  }
  return undefined;
}

function checkSeed(caller: string, seed: ParamSeed | undefined): ErrorObject | undefined {
  if (seed === undefined) return undefined;
  if (!(seed.ss instanceof Float64Array) || !(seed.xys instanceof Float64Array) || seed.xys.length !== seed.ss.length * 2) {
    return badArgument(caller, 'a param seed needs ss and xys Float64Arrays with xys twice as long', 'Pass matching ss/xys arrays.');
  }
  return undefined;
}

/* -------------------------------- evaluation -------------------------------- */

function toPSample(s: number, v: unknown): PSample {
  if (typeof v === 'object' && v !== null) {
    const x = (v as { x?: unknown }).x;
    const y = (v as { y?: unknown }).y;
    if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) {
      return { s, x, y, defined: true };
    }
  }
  return { s, x: Number.NaN, y: Number.NaN, defined: false };
}

/** Evaluates at s, cached; sets dead when the budget is spent. */
function evalAt(st: PState, s: number): PSample | null {
  const hit = st.samples.get(s);
  if (hit) return hit;
  if (st.evals + st.intervalEvals >= st.maxEvals) {
    st.dead = true;
    return null;
  }
  const sample = toPSample(s, st.fn.call(s));
  st.evals += 1;
  st.samples.set(s, sample);
  return sample;
}

function boxAt(st: PState, s0: number, s1: number): ParamBox | null {
  const enc = st.enclosure;
  if (!enc) return null;
  if (st.evals + st.intervalEvals >= st.maxEvals) {
    st.dead = true;
    return null;
  }
  const box = enc(s0, s1);
  st.intervalEvals += 1;
  const num = (v: unknown): number => (typeof v === 'number' && !Number.isNaN(v) ? v : Number.NaN);
  const x0 = num(box.x0);
  const x1 = num(box.x1);
  const y0 = num(box.y0);
  const y1 = num(box.y1);
  const def = box.def === 0 || box.def === 1 || box.def === 2 ? box.def : 1;
  if (Number.isNaN(x0) || Number.isNaN(x1) || Number.isNaN(y0) || Number.isNaN(y1)) {
    return { x0: Number.NEGATIVE_INFINITY, x1: Number.POSITIVE_INFINITY, y0: Number.NEGATIVE_INFINITY, y1: Number.POSITIVE_INFINITY, def: 0 };
  }
  return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: Math.min(y0, y1), y1: Math.max(y0, y1), def };
}

/* --------------------------------- culling ---------------------------------- */

/**
 * Splits the range into on-screen boxes with the interval enclosure (curves-loci
 * 5, step 1). Without an enclosure the whole range is one box: sampling-only
 * culling could drop visible parts of a wild curve.
 */
function cullBoxes(st: PState, lo: number, hi: number): { s0: number; s1: number }[] {
  if (!st.enclosure) return [{ s0: lo, s1: hi }];
  const pv = st.pv;
  const kept: { s0: number; s1: number }[] = [];
  const stack: { s0: number; s1: number; depth: number }[] = [{ s0: lo, s1: hi, depth: 0 }];
  while (stack.length > 0) {
    const { s0, s1, depth } = stack.pop() as { s0: number; s1: number; depth: number };
    const box = boxAt(st, s0, s1);
    if (!box) return [{ s0: lo, s1: hi }];
    if (box.def === 0) continue;
    const pad = 1 / pv.dpr / Math.min(pv.sx, pv.sy);
    if (box.x1 < pv.box.x0 - pad || box.x0 > pv.box.x1 + pad || box.y1 < pv.box.y0 - pad || box.y0 > pv.box.y1 + pad) {
      continue;
    }
    const wPx = (box.x1 - box.x0) * pv.sx;
    const hPx = (box.y1 - box.y0) * pv.sy;
    if ((wPx > CULL_SPLIT_PX || hPx > CULL_SPLIT_PX) && depth < CULL_DEPTH) {
      const mid = (s0 + s1) / 2;
      if (mid > s0 && mid < s1) {
        stack.push({ s0, s1: mid, depth: depth + 1 });
        stack.push({ s0: mid, s1, depth: depth + 1 });
        continue;
      }
    }
    kept.push({ s0, s1 });
  }
  kept.sort((a, b) => a.s0 - b.s0);
  return kept;
}

/* --------------------------------- refine ----------------------------------- */

function toEffX(pv: PlotView, x: number): number {
  return pv.toPx(x) * pv.dpr;
}

function toEffY(pv: PlotView, y: number): number {
  return pv.toPy(y) * pv.dpr;
}

function runRefine(st: PState): void {
  const { pv } = st;
  while (st.pending.length > 0) {
    if (st.steps++ > STEP_CAP) {
      st.capped = true;
      for (const s of st.pending) st.accepted.push(s);
      st.pending.length = 0;
      st.suspicious.length = 0;
      return;
    }
    if (st.dead) return;
    if (st.samples.size >= st.maxSamples) {
      for (const s of st.pending) st.accepted.push(s);
      st.pending.length = 0;
      st.capped = true;
      return;
    }
    const span = st.pending.pop() as PSpan;
    if (span.depth > st.maxDepthSeen) st.maxDepthSeen = span.depth;
    const l = evalAt(st, span.sl);
    if (!l) return;
    const r = evalAt(st, span.sr);
    if (!r) return;
    const mid = (span.sl + span.sr) / 2;
    if (!(mid > span.sl && mid < span.sr)) {
      st.suspicious.push(span);
      continue;
    }
    if (!l.defined || !r.defined) {
      if (span.depth >= st.depth) {
        st.suspicious.push(span);
        continue;
      }
      const m = evalAt(st, mid);
      if (!m) {
        st.pending.push(span);
        return;
      }
      if (l.defined || m.defined) st.pending.push({ sl: span.sl, sr: mid, depth: span.depth + 1 });
      if (m.defined || r.defined) st.pending.push({ sl: mid, sr: span.sr, depth: span.depth + 1 });
      continue;
    }
    const m = evalAt(st, mid);
    if (!m) {
      st.pending.push(span);
      return;
    }
    if (!m.defined) {
      if (span.depth >= st.depth) st.suspicious.push(span);
      else {
        st.pending.push({ sl: span.sl, sr: mid, depth: span.depth + 1 });
        st.pending.push({ sl: mid, sr: span.sr, depth: span.depth + 1 });
      }
      continue;
    }
    const ax = toEffX(pv, l.x);
    const ay = toEffY(pv, l.y);
    const bx = toEffX(pv, m.x);
    const by = toEffY(pv, m.y);
    const cx = toEffX(pv, r.x);
    const cy = toEffY(pv, r.y);
    const chord = Math.hypot(cx - ax, cy - ay);
    const bend = pointToChordPx(bx, by, ax, ay, cx, cy);
    const turn = turnDegrees(ax, ay, bx, by, cx, cy);
    const failing = chord > st.chordPx || bend > st.bendPx || turn > st.turnDegrees;
    if (failing && span.depth < st.depth && chord >= COLUMN_PX) {
      st.pending.push({ sl: span.sl, sr: mid, depth: span.depth + 1 });
      st.pending.push({ sl: mid, sr: span.sr, depth: span.depth + 1 });
    } else if (!failing) {
      st.accepted.push(span);
    } else if (turn > CUSP_DEGREES) {
      // A sharp join after the depth limit: a cusp, or a singular point where
      // the curve stalls (both chords are sub-pixel over a parameter span).
      const stall = Math.hypot(bx - ax, by - ay) < COLUMN_PX && Math.hypot(cx - bx, cy - by) < COLUMN_PX;
      addMarker(st, stall ? 'singular' : 'cusp', m.x, m.y);
      st.accepted.push(span);
    } else {
      st.accepted.push(span);
    }
  }
}

/* -------------------------------- classify ---------------------------------- */

function runClassify(st: PState): void {
  while (st.suspicious.length > 0) {
    if (st.steps++ > STEP_CAP || st.dead) {
      if (st.steps > STEP_CAP) {
        st.capped = true;
        for (const s of st.pending) st.accepted.push(s);
        st.pending.length = 0;
        st.suspicious.length = 0;
      }
      return;
    }
    const span = st.suspicious.pop() as PSpan;
    const l = evalAt(st, span.sl);
    if (!l) return;
    const r = evalAt(st, span.sr);
    if (!r) return;
    if (l.defined && r.defined) {
      st.accepted.push(span);
      continue;
    }
    if (!l.defined && !r.defined) {
      classifyUndefined(st, span);
      continue;
    }
    classifyEdge(st, span, l.defined ? 'left' : 'right');
  }
}

/** Neither end defined: subdivide while an enclosure allows certainty, else gap. */
function classifyUndefined(st: PState, span: PSpan): void {
  if (st.enclosure) {
    const box = boxAt(st, span.sl, span.sr);
    if (!box) return;
    if (box.def === 0) return;
    if (box.def === 2) return; // Overflow at the ends; the span is a gap.
    const mid = (span.sl + span.sr) / 2;
    if (!(mid > span.sl && mid < span.sr)) return;
    st.suspicious.push({ sl: span.sl, sr: mid, depth: span.depth });
    st.suspicious.push({ sl: mid, sr: span.sr, depth: span.depth });
    return;
  }
  st.rigorous = false;
  const mid = (span.sl + span.sr) / 2;
  if (!(mid > span.sl && mid < span.sr)) return;
  const m = evalAt(st, mid);
  if (!m) return;
  if (!m.defined) return; // A gap until proven otherwise.
  st.suspicious.push({ sl: span.sl, sr: mid, depth: span.depth });
  st.suspicious.push({ sl: mid, sr: span.sr, depth: span.depth });
}

/** One end defined: bisect to the edge, then pole, hole-like join or gap. */
function classifyEdge(st: PState, span: PSpan, side: 'left' | 'right'): void {
  const pv = st.pv;
  let lo = side === 'left' ? span.sl : span.sr;
  let hi = side === 'left' ? span.sr : span.sl;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (!(mid > Math.min(lo, hi) && mid < Math.max(lo, hi))) break;
    const m = evalAt(st, mid);
    if (!m) return;
    if (side === 'left') {
      if (m.defined) lo = mid;
      else hi = mid;
    } else if (m.defined) hi = mid;
    else lo = mid;
  }
  const edge = side === 'left' ? lo : hi;
  const edgeS = evalAt(st, edge);
  if (!edgeS || !edgeS.defined || st.dead) return;
  const nearLo = side === 'left' ? span.sl : edge;
  const nearHi = side === 'left' ? edge : span.sr;
  if (nearHi > nearLo) st.pending.push({ sl: nearLo, sr: nearHi, depth: span.depth });
  if (st.enclosure) {
    const gapLo = side === 'left' ? edge : span.sl;
    const gapHi = side === 'left' ? span.sr : edge;
    const box = boxAt(st, gapLo, gapHi);
    if (!box) return;
    if (!Number.isFinite(box.x0) || !Number.isFinite(box.x1) || !Number.isFinite(box.y0) || !Number.isFinite(box.y1)) {
      addMarker(st, 'pole', edgeS.x, edgeS.y);
      return;
    }
    if (box.def === 0) return;
    // Bounded and maybe defined: a hole-like join when the partner is close.
    if (joinPartner(st, edge, edgeS, side)) return;
    return;
  }
  st.rigorous = false;
  const px = toEffX(pv, edgeS.x);
  const py = toEffY(pv, edgeS.y);
  if (Math.abs(px) > 2 * pv.widthEff || Math.abs(py) > 2 * pv.heightEff) {
    addMarker(st, 'pole', edgeS.x, edgeS.y);
    return;
  }
  joinPartner(st, edge, edgeS, side);
}

/** Joins across a tiny gap when a partner edge sits within half a pixel. */
function joinPartner(st: PState, edge: number, edgeS: PSample, side: 'left' | 'right'): boolean {
  let best: PSample | undefined;
  let bestD = Number.POSITIVE_INFINITY;
  for (const s of st.samples.values()) {
    if (!s.defined || s.s === edge) continue;
    if (side === 'left' && !(s.s > edge)) continue;
    if (side === 'right' && !(s.s < edge)) continue;
    const d = Math.hypot(toEffX(st.pv, s.x) - toEffX(st.pv, edgeS.x), toEffY(st.pv, s.y) - toEffY(st.pv, edgeS.y));
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  if (best === undefined || !(bestD < COLUMN_PX)) return false;
  const a = Math.min(edge, best.s);
  const b = Math.max(edge, best.s);
  st.accepted.push({ sl: a, sr: b, depth: 0 });
  addMarker(st, 'hole', (edgeS.x + best.x) / 2, (edgeS.y + best.y) / 2);
  return true;
}

function addMarker(st: PState, kind: MarkerKind, x: number, y: number): void {
  const pv = st.pv;
  st.markers.push({ kind, x, y, px: pv.toPx(x), py: pv.toPy(y) });
}

/* ---------------------------------- emit ----------------------------------- */

function makeStats(st: PState, complete: boolean, samples: number): PlotStats {
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

function chainSpans(st: PState): { x: number; y: number }[][] {
  const spans = [...st.accepted];
  spans.sort((a, b) => a.sl - b.sl || a.sr - b.sr);
  const chains: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  let prevSr = Number.NaN;
  const flush = (): void => {
    if (current.length > 1) chains.push(current);
    current = [];
    prevSr = Number.NaN;
  };
  let prevKey = '';
  for (const s of spans) {
    const key = `${s.sl},${s.sr}`;
    if (key === prevKey) continue;
    prevKey = key;
    const l = st.samples.get(s.sl);
    const r = st.samples.get(s.sr);
    if (!l || !r || !l.defined || !r.defined) {
      flush();
      continue;
    }
    if (current.length === 0) {
      current.push({ x: l.x, y: l.y });
      current.push({ x: r.x, y: r.y });
    } else if (s.sl === prevSr) {
      current.push({ x: r.x, y: r.y });
    } else {
      flush();
      current.push({ x: l.x, y: l.y });
      current.push({ x: r.x, y: r.y });
    }
    prevSr = s.sr;
  }
  flush();
  return chains;
}

function sortMarkers(st: PState): PlotMarker[] {
  const ms = [...st.markers];
  ms.sort((a, b) => a.x - b.x || a.y - b.y);
  const out: PlotMarker[] = [];
  for (const m of ms) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.kind === m.kind &&
      Math.abs(toEffX(st.pv, m.x) - toEffX(st.pv, prev.x)) < COLUMN_PX &&
      Math.abs(toEffY(st.pv, m.y) - toEffY(st.pv, prev.y)) < COLUMN_PX
    ) {
      continue;
    }
    out.push(m);
  }
  return out;
}

/* --------------------------------- public ---------------------------------- */

/**
 * Traces a parametric curve over a view (curves-loci 5). On `maxEvals`
 * exhaustion the result is `complete: false` with empty output; re-run with a
 * larger budget.
 */
export function traceParamCurve(curve: ParamCurveInput, view: ViewBox, options: ParamPlotOptions = {}): Result<ParamPlot> {
  return guard('traceParamCurve', () => {
    const caller = 'traceParamCurve';
    const fnProblem = checkParamFn(caller, curve.fn);
    if (fnProblem) return fnProblem;
    const viewProblem = checkView(caller, view);
    if (viewProblem) return viewProblem;
    const budgetProblem = checkBudgets(caller, options.maxSamples, options.maxEvals);
    if (budgetProblem) return budgetProblem;
    const seedProblem = checkSeed(caller, curve.seed);
    if (seedProblem) return seedProblem;
    if (!isFiniteNumber(curve.lo) || !isFiniteNumber(curve.hi) || !(curve.lo < curve.hi)) {
      return badArgument(caller, 'the parameter range needs finite lo < hi', 'Pass a finite range, for example in 0..tau.');
    }
    const maxSamples = options.maxSamples === undefined ? MAX_SAMPLES_PER_CURVE : Math.floor(options.maxSamples);
    const maxEvals = options.maxEvals === undefined ? DEFAULT_MAX_EVALS_PARAM : Math.floor(options.maxEvals);
    const depth = options.depth === undefined ? REFINE_MAX_DEPTH : Math.floor(options.depth);
    if (!isFiniteNumber(depth) || depth < 1 || depth > 24) {
      return badArgument(caller, `depth must be in 1..24 (got ${String(options.depth)})`, 'Pass a refinement depth between 1 and 24.');
    }
    const bendPx = options.bendPx ?? REFINE_BEND_PX;
    const chordPx = options.chordPx ?? REFINE_CHORD_PX;
    const turn = options.turnDegrees ?? REFINE_TURN_DEGREES;
    if (!isFiniteNumber(bendPx) || bendPx <= 0 || !isFiniteNumber(chordPx) || chordPx <= 0 || !isFiniteNumber(turn) || turn <= 0) {
      return badArgument(caller, 'bendPx, chordPx and turnDegrees must be positive', 'Pass positive screen-space thresholds.');
    }
    const coarse = options.coarse === undefined ? 0 : Math.floor(options.coarse);
    if (options.coarse !== undefined && (!isFiniteNumber(coarse) || coarse < 2 || coarse > 65536)) {
      return badArgument(caller, `coarse must be in 2..65536 (got ${String(options.coarse)})`, 'Pass a coarse sample count of at least 2.');
    }
    const pvResult = createView(view);
    if (!pvResult.ok) return pvResult;
    const pv = pvResult.value;
    const st: PState = {
      pv,
      samples: new Map(),
      pending: [],
      accepted: [],
      suspicious: [],
      markers: [],
      fn: curve.fn,
      enclosure: curve.enclosure,
      maxSamples,
      maxEvals,
      depth,
      bendPx,
      chordPx,
      turnDegrees: turn,
      evals: 0,
      intervalEvals: 0,
      maxDepthSeen: 0,
      rigorous: true,
      capped: false,
      dead: false,
      steps: 0,
    };
    if (curve.seed) {
      for (let i = 0; i < curve.seed.ss.length; i++) {
        const s = curve.seed.ss[i] as number;
        st.samples.set(s, toPSample(s, { x: curve.seed.xys[2 * i] as number, y: curve.seed.xys[2 * i + 1] as number }));
      }
    }
    const boxes = cullBoxes(st, curve.lo, curve.hi);
    if (st.dead) return { ok: true, value: emptyParam(st), notices: [] };
    const total = coarse > 0 ? coarse : Math.max(64, Math.round(pv.widthEff / 6));
    const width = boxes.reduce((s, b) => s + (b.s1 - b.s0), 0);
    for (const b of boxes) {
      const n = width > 0 ? Math.max(2, Math.round((total * (b.s1 - b.s0)) / width)) : 2;
      let prev: number | undefined;
      for (let i = 0; i < n; i++) {
        const s = b.s0 + ((b.s1 - b.s0) * i) / (n - 1);
        const sample = evalAt(st, s);
        if (!sample) return { ok: true, value: emptyParam(st), notices: [] };
        if (prev !== undefined) st.pending.push({ sl: prev, sr: s, depth: 0 });
        prev = s;
      }
    }
    // Classification refines edge approaches; alternate until both drain.
    for (;;) {
      if (!st.dead && !st.capped) runRefine(st);
      if (st.dead || st.capped || st.suspicious.length === 0) break;
      runClassify(st);
      if (st.dead || st.capped || st.pending.length === 0) break;
    }
    if (st.dead) return { ok: true, value: emptyParam(st), notices: [] };
    return { ok: true, value: finishParam(st, curve), notices: [] };
  });
}

function emptyParam(st: PState): ParamPlot {
  return { paths: [], closed: [], markers: [], stats: makeStats(st, false, 0) };
}

function finishParam(st: PState, curve: ParamCurveInput): ParamPlot {
  const pv = st.pv;
  const loS = st.samples.get(curve.lo);
  const hiS = st.samples.get(curve.hi);
  if (loS && loS.defined) addMarker(st, 'end', loS.x, loS.y);
  if (hiS && hiS.defined) addMarker(st, 'end', hiS.x, hiS.y);
  const chains = chainSpans(st);
  const w = pv.box.widthPx;
  const h = pv.box.heightPx;
  const paths: Float64Array[] = [];
  const closed: boolean[] = [];
  let samples = 0;
  // Closed when the ends meet within 1e-9 of the scale (curves-loci 5).
  let diag = 0;
  for (const c of chains) {
    for (const p of c) diag = Math.max(diag, Math.abs(p.x), Math.abs(p.y));
  }
  const tol = 1e-9 * Math.max(1, diag);
  for (const c of chains) {
    const arr = new Float64Array(c.length * 2);
    for (let i = 0; i < c.length; i++) {
      const p = c[i] as { x: number; y: number };
      const px = pv.toPx(p.x);
      const py = pv.toPy(p.y);
      arr[2 * i] = px < -4 * w ? -4 * w : px > 5 * w ? 5 * w : px;
      arr[2 * i + 1] = py < -4 * h ? -4 * h : py > 5 * h ? 5 * h : py;
    }
    samples += c.length;
    const first = c[0] as { x: number; y: number };
    const last = c[c.length - 1] as { x: number; y: number };
    closed.push(Math.hypot(last.x - first.x, last.y - first.y) <= tol && c.length > 2);
    paths.push(arr);
  }
  return { paths, closed, markers: sortMarkers(st), stats: makeStats(st, true, samples) };
}
