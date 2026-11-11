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
import { makeMarker } from './markers';
import { SortedSet } from './sortedset';
import { thinChains } from './thin';
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
  /** Every defined sample parameter, ordered, for neighbour lookups in O(log n). */
  readonly definedSs: SortedSet;
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

/** Stores a sample; defined ones also join the ordered index. */
function putSample(st: PState, s: number, sample: PSample): void {
  st.samples.set(s, sample);
  if (sample.defined) st.definedSs.add(s);
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
  putSample(st, s, sample);
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

/* ---------------------------------- holes ----------------------------------- */

/**
 * With an enclosure, bounded boxes that are only maybe defined (`def = 1`) can
 * hide a removable point. Bisect them to a vanishing width, then test the
 * centre: undefined there with matching neighbours is a hole (curves-loci 5,
 * step 3): the curve joins across and a marker is added.
 */
function findHoles(st: PState, boxes: readonly { s0: number; s1: number }[]): void {
  for (const b of boxes) {
    const stack: { s0: number; s1: number; depth: number }[] = [{ s0: b.s0, s1: b.s1, depth: 0 }];
    const tiny = (b.s1 - b.s0) * 1e-9;
    let found = 0;
    while (stack.length > 0 && !st.dead) {
      const { s0, s1, depth } = stack.pop() as { s0: number; s1: number; depth: number };
      const box = boxAt(st, s0, s1);
      if (!box) return;
      if (box.def !== 1) continue;
      if (![box.x0, box.x1, box.y0, box.y1].every(Number.isFinite)) continue;
      const mid = (s0 + s1) / 2;
      if (depth >= 40 || s1 - s0 <= tiny || !(mid > s0 && mid < s1)) {
        if (found < 8) {
          found += 1;
          probeHole(st, s0, s1, (b.s1 - b.s0) * 1e-6);
        }
        continue;
      }
      stack.push({ s0: mid, s1, depth: depth + 1 });
      stack.push({ s0, s1: mid, depth: depth + 1 });
    }
  }
}

/** A hole: undefined at the centre, defined and matching a tiny step either side. */
function probeHole(st: PState, s0: number, s1: number, step: number): void {
  // The undefined point is a "nice" value inside the tiny box: try the ends, the
  // centre and the centre rounded to 9 significant digits.
  const c = (s0 + s1) / 2;
  const rounded = Number(c.toPrecision(9));
  let hit = false;
  for (const t of [c, rounded, s0, s1]) {
    if (!(t >= s0 && t <= s1)) continue;
    const m = evalAt(st, t);
    if (!m) return;
    if (!m.defined) {
      hit = true;
      break;
    }
  }
  if (!hit) return;
  const a = evalAt(st, s0 - step);
  const z = evalAt(st, s1 + step);
  if (!a || !z || !a.defined || !z.defined) return;
  const d = Math.hypot(toEffX(st.pv, a.x) - toEffX(st.pv, z.x), toEffY(st.pv, a.y) - toEffY(st.pv, z.y));
  if (d < 1) addMarker(st, 'hole', (a.x + z.x) / 2, (a.y + z.y) / 2);
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
    // Entirely off the view on one side: nothing visible depends on the detail.
    const b = pv.box;
    if (
      (l.x < b.x0 && m.x < b.x0 && r.x < b.x0) ||
      (l.x > b.x1 && m.x > b.x1 && r.x > b.x1) ||
      (l.y < b.y0 && m.y < b.y0 && r.y < b.y0) ||
      (l.y > b.y1 && m.y > b.y1 && r.y > b.y1)
    ) {
      st.accepted.push(span);
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
    } else if (chord > st.chordPx) {
      // Still long at the depth limit: a jump to infinity (pole) or a very steep stretch.
      st.suspicious.push(span);
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
      classifyDefined(st, span, l, r);
      continue;
    }
    if (!l.defined && !r.defined) {
      classifyUndefined(st, span);
      continue;
    }
    classifyEdge(st, span, l.defined ? 'left' : 'right');
  }
}

/**
 * Both ends defined but the span still fails at the depth limit: a jump to
 * infinity (a branch of 1/s) breaks the curve and marks a pole; anything
 * shorter is a steep stretch and is drawn through.
 */
function classifyDefined(st: PState, span: PSpan, l: PSample, r: PSample): void {
  const pv = st.pv;
  const chord = Math.hypot(toEffX(pv, r.x) - toEffX(pv, l.x), toEffY(pv, r.y) - toEffY(pv, l.y));
  const huge = chord > 2 * Math.max(pv.widthEff, pv.heightEff);
  if (!huge) {
    st.accepted.push(span);
    return;
  }
  if (st.enclosure) {
    const box = boxAt(st, span.sl, span.sr);
    if (!box) return;
    if (box.def === 0) return; // Undefined throughout: a gap.
    const bounded = Number.isFinite(box.x0) && Number.isFinite(box.x1) && Number.isFinite(box.y0) && Number.isFinite(box.y1);
    if (bounded) {
      st.accepted.push(span); // Continuous: the steep slope is real.
      return;
    }
  } else {
    st.rigorous = false;
  }
  addMarker(st, 'pole', l.x, l.y);
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
  // Bisect between a defined parameter d and an undefined one u until they meet.
  let d = side === 'left' ? span.sl : span.sr;
  let u = side === 'left' ? span.sr : span.sl;
  for (let i = 0; i < 40; i++) {
    const mid = (d + u) / 2;
    if (!(mid > Math.min(d, u) && mid < Math.max(d, u))) break;
    const m = evalAt(st, mid);
    if (!m) return;
    if (m.defined) d = mid;
    else u = mid;
  }
  const edge = d;
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
    joinPartner(st, edge, edgeS, side);
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

/** Defined neighbours examined on the far side of an edge when looking for a partner. */
const PARTNER_PROBES = 8;

/**
 * Joins across a tiny gap when a partner edge sits within half a pixel. The
 * candidates are the nearest few defined samples on the far side in parameter
 * order, found by binary search, so the cost of a verdict does not grow with
 * the number of samples.
 */
function joinPartner(st: PState, edge: number, edgeS: PSample, side: 'left' | 'right'): boolean {
  let best: PSample | undefined;
  let bestD = Number.POSITIVE_INFINITY;
  let at = edge;
  for (let k = 0; k < PARTNER_PROBES; k++) {
    const next = side === 'left' ? st.definedSs.successor(at) : st.definedSs.predecessor(at);
    if (next === undefined) break;
    at = next;
    const s = st.samples.get(next);
    if (!s || !s.defined) continue;
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
  const marker = makeMarker(st.pv, kind, x, y);
  if (marker === undefined) return;
  // Markers obey the sample cap too (performance.md 5).
  if (st.markers.length >= st.maxSamples) {
    st.capped = true;
    return;
  }
  st.markers.push(marker);
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

function chainSpans(st: PState): ChainPoint[][] {
  const spans = [...st.accepted];
  spans.sort((a, b) => a.sl - b.sl || a.sr - b.sr);
  const chains: ChainPoint[][] = [];
  let current: ChainPoint[] = [];
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
      current.push({ x: l.x, y: l.y, s: s.sl });
      current.push({ x: r.x, y: r.y, s: s.sr });
    } else if (s.sl === prevSr) {
      current.push({ x: r.x, y: r.y, s: s.sr });
    } else {
      flush();
      current.push({ x: l.x, y: l.y, s: s.sl });
      current.push({ x: r.x, y: r.y, s: s.sr });
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
    if (typeof curve !== 'object' || curve === null) {
      return badArgument(caller, 'the curve input is missing', 'Pass { fn, lo, hi } for a parametric curve.');
    }
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
      definedSs: new SortedSet(),
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
        putSample(st, s, toPSample(s, { x: curve.seed.xys[2 * i] as number, y: curve.seed.xys[2 * i + 1] as number }));
      }
    }
    const boxes = cullBoxes(st, curve.lo, curve.hi);
    if (st.dead) return { ok: true, value: emptyParam(st), notices: [] };
    if (st.enclosure) {
      findHoles(st, boxes);
      if (st.dead) return { ok: true, value: emptyParam(st), notices: [] };
    }
    const wantTotal = coarse > 0 ? coarse : Math.max(64, Math.round(pv.widthEff / 6));
    // The sample cap bounds the coarse grid too (performance.md 5).
    const total = Math.min(wantTotal, maxSamples);
    if (total < wantTotal) st.capped = true;
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
      else if (st.capped && st.pending.length > 0) {
        for (const s of st.pending) st.accepted.push(s);
        st.pending.length = 0;
      }
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

interface ChainPoint {
  readonly x: number;
  readonly y: number;
  readonly s: number;
}

/**
 * Marks cusps and stalls at the joins between neighbouring chords
 * (curves-loci 5, step 4): a turn of more than 120 degrees is a `cusp`; a
 * stretch where the curve crawls (a speed far below the fastest on the chain)
 * is a `singular` point, one marker at its slowest vertex.
 */
function markJoins(st: PState, chains: readonly (readonly ChainPoint[])[]): void {
  const pv = st.pv;
  for (const c of chains) {
    if (c.length < 3) continue;
    const px = c.map((p) => toEffX(pv, p.x));
    const py = c.map((p) => toEffY(pv, p.y));
    const speed = new Array<number>(c.length).fill(Number.NaN);
    let vmax = 0;
    for (let i = 0; i + 1 < c.length; i++) {
      const ds = Math.abs((c[i + 1] as ChainPoint).s - (c[i] as ChainPoint).s);
      const d = Math.hypot((px[i + 1] as number) - (px[i] as number), (py[i + 1] as number) - (py[i] as number));
      // Off-screen rushes towards infinity say nothing about the visible speed.
      if (ds > 0 && d <= 2 * Math.max(pv.widthEff, pv.heightEff)) vmax = Math.max(vmax, d / ds);
    }
    const cuspAt = new Array<boolean>(c.length).fill(false);
    for (let i = 1; i + 1 < c.length; i++) {
      const ax = (px[i] as number) - (px[i - 1] as number);
      const ay = (py[i] as number) - (py[i - 1] as number);
      const bx = (px[i + 1] as number) - (px[i] as number);
      const by = (py[i + 1] as number) - (py[i] as number);
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      if (!(la > 0) || !(lb > 0)) continue;
      const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
      if ((Math.acos(cos) * 180) / Math.PI > CUSP_DEGREES) {
        cuspAt[i] = true;
        const p = c[i] as ChainPoint;
        addMarker(st, 'cusp', p.x, p.y);
      }
      const dsA = Math.abs((c[i] as ChainPoint).s - (c[i - 1] as ChainPoint).s);
      const dsB = Math.abs((c[i + 1] as ChainPoint).s - (c[i] as ChainPoint).s);
      if (dsA > 0 && dsB > 0) speed[i] = (la + lb) / (dsA + dsB);
    }
    // Runs of crawling vertices: one marker at the slowest, unless a cusp already marks the run.
    const slow = (i: number): boolean => speed[i] !== undefined && (speed[i] as number) < 0.02 * vmax;
    let i = 1;
    while (i + 1 < c.length) {
      if (!slow(i)) {
        i += 1;
        continue;
      }
      let best = i;
      let marked = false;
      let j = i;
      while (j + 1 < c.length && slow(j)) {
        if ((speed[j] as number) < (speed[best] as number)) best = j;
        if (cuspAt[j]) marked = true;
        j += 1;
      }
      if (!marked) {
        const p = c[best] as ChainPoint;
        addMarker(st, 'singular', p.x, p.y);
      }
      i = j;
    }
  }
}

function finishParam(st: PState, curve: ParamCurveInput): ParamPlot {
  const pv = st.pv;
  const loS = st.samples.get(curve.lo);
  const hiS = st.samples.get(curve.hi);
  // A closed curve has no ends (ui §1): its two end points coincide.
  const scale = Math.max(1, Math.abs(loS?.x ?? 0), Math.abs(loS?.y ?? 0));
  const wholeClosed =
    loS !== undefined && hiS !== undefined && loS.defined && hiS.defined && Math.hypot(hiS.x - loS.x, hiS.y - loS.y) <= 1e-9 * scale;
  if (!wholeClosed) {
    if (loS && loS.defined) addMarker(st, 'end', loS.x, loS.y);
    if (hiS && hiS.defined) addMarker(st, 'end', hiS.x, hiS.y);
  }
  const linked = chainSpans(st);
  markJoins(st, linked);
  const thin = thinChains(linked, st.maxSamples);
  if (thin.thinned) st.capped = true;
  const chains = thin.chains;
  const w = pv.box.widthPx;
  const h = pv.box.heightPx;
  const paths: Float64Array[] = [];
  const closed: boolean[] = [];
  let samples = 0;
  for (const c of chains) {
    const arr = new Float64Array(c.length * 2);
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < c.length; i++) {
      const p = c[i] as ChainPoint;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
      const px = pv.toPx(p.x);
      const py = pv.toPy(p.y);
      arr[2 * i] = px < -4 * w ? -4 * w : px > 5 * w ? 5 * w : px;
      arr[2 * i + 1] = py < -4 * h ? -4 * h : py > 5 * h ? 5 * h : py;
    }
    samples += c.length;
    const first = c[0] as ChainPoint;
    const last = c[c.length - 1] as ChainPoint;
    // Closed when the ends meet within 1e-9 of the chain's scale (curves-loci 5).
    const tol = 1e-9 * Math.max(1, maxX - minX, maxY - minY);
    closed.push(Math.hypot(last.x - first.x, last.y - first.y) <= tol && c.length > 2);
    paths.push(arr);
  }
  return { paths, closed, markers: sortMarkers(st), stats: makeStats(st, true, samples) };
}
