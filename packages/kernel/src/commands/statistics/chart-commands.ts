/**
 * Charts (docs/features/statistics/design.md 6). A chart is a record of the numbers behind it; the view draws a record
 * whose schema is a chart schema. A chart of no data is defined with `n = 0`, so the figure keeps its place.
 */
import type { Pt } from '../../contracts/values';
import type { RuleCall } from '../../graph/registry';
import type { Env, FunctionValue } from '../../language/runtime';
import type { CommandSpec, ParamSpec } from '../../language/table';
import { checks, enumCheck, form, given, median, num, numbers, oneOf, opt, ordered, p, pairs, pearson, quartiles, record, sorted, spec, sum, text } from './core';
import { autoEdges, checkEdges, countClasses, residualsOf, scaled } from './describe-commands';
import { normalQuantile } from './dist';
import { CLOSED, MAX_PIE, MAX_STEM, QUANTILE_METHODS, SCALES, WHISKERS } from './types';
import type { QuantileMethod, Scale } from './types';

const L = 'List<Number>';
const P = 'List<Point>';
const chart = spec('charts');
const MAX_DOTS = 5_000;

/* ------------------------------ histogram ------------------------------ */

const uniformWidth = (edges: Float64Array): number | undefined => {
  const w = (edges[1] as number) - (edges[0] as number);
  for (let k = 2; k < edges.length; k++) if (Math.abs((edges[k] as number) - (edges[k - 1] as number) - w) > 1e-9 * Math.max(1, Math.abs(w))) return undefined;
  return w;
};

function histogram(edges: Float64Array, counts: Float64Array, heights: Float64Array, scale: Scale, closed: string, outside: number, n: number): unknown {
  const bw = uniformWidth(edges);
  const total = scale === 'density' ? sum(heights.map((h, k) => h * ((edges[k + 1] as number) - (edges[k] as number)))) : sum(heights);
  return record('Histogram', { edges, counts, heights, total, binWidth: bw, outside, n, scale, closed }, bw === undefined ? { binWidth: 'unequal_classes' } : undefined);
}

/** Histogram over raw data: equal widths give counts, unequal widths density (design 3.3). */
function fromData(call: RuleCall, edges: Float64Array, xs: Float64Array, scaleIdx: number, closedIdx: number): unknown {
  const closed = oneOf(call, closedIdx, 'left', CLOSED, 'closed');
  if (!closed || !checkEdges(call, edges)) return undefined;
  const equal = uniformWidth(edges) !== undefined;
  let scale: Scale | undefined;
  if (given(call, scaleIdx)) scale = oneOf(call, scaleIdx, 'count', SCALES, 'scale');
  else {
    scale = equal ? 'count' : 'density';
    if (!equal) call.notify('unequal_classes', {});
  }
  if (!scale) return undefined;
  const { counts, outside } = countClasses(edges, xs, closed);
  return histogram(edges, counts, scaled(counts, edges, scale, xs.length - outside), scale, closed, outside, xs.length);
}

function emptyHistogram(call: RuleCall, scale: string, closed: string): unknown {
  return histogram(Float64Array.of(0, 1), Float64Array.of(0), Float64Array.of(0), scale as Scale, closed, 0, 0);
}

function runHistAuto(call: RuleCall): unknown {
  const xs = numbers(call, 0);
  if (!xs) return undefined;
  if (xs.length === 0) return emptyHistogram(call, text(call, 1, 'count'), text(call, 2, 'left'));
  const a = autoEdges(xs);
  if (a.constant) call.notify('all_equal_values', { value: xs[0] as number });
  return fromData(call, a.edges, xs, 1, 2);
}

function runHistBins(call: RuleCall): unknown {
  const xs = numbers(call, 0);
  const bins = num(call, 1);
  if (!xs) return undefined;
  if (bins === undefined || !Number.isInteger(bins) || bins < 1) return call.fail('bad_parameter', `bins must be a whole number from 1, not ${String(bins)}`);
  if (xs.length === 0) return emptyHistogram(call, text(call, 2, 'count'), text(call, 3, 'left'));
  const s = sorted(xs);
  let lo = s[0] as number;
  let hi = s[s.length - 1] as number;
  if (lo === hi) {
    call.notify('all_equal_values', { value: lo });
    lo -= 0.5;
    hi += 0.5;
  }
  const edges = new Float64Array(bins + 1);
  for (let k = 0; k <= bins; k++) edges[k] = lo + ((hi - lo) * k) / bins;
  edges[bins] = hi;
  return fromData(call, edges, xs, 2, 3);
}

/** `(edges, list)`: a list one shorter than the edges is heights, anything else data (design 6). */
function runHistEdges(call: RuleCall): unknown {
  const edges = numbers(call, 0, 'the edges');
  const ys = numbers(call, 1);
  if (!edges || !ys) return undefined;
  if (ys.length !== edges.length - 1) return fromData(call, edges, ys, 2, 3);
  const closed = oneOf(call, 3, 'left', CLOSED, 'closed');
  const scale = oneOf(call, 2, 'count', SCALES, 'scale');
  if (!closed || !scale || !checkEdges(call, edges)) return undefined;
  return histogram(edges, ys, ys, scale, closed, 0, scale === 'count' ? sum(ys) : ys.length);
}

/* ------------------------------ bar charts ------------------------------ */

function bars(xs: Float64Array, heights: Float64Array, width: number, labels?: readonly string[]): unknown {
  return record('BarChart', { xs, heights, width, total: sum(heights), labels: labels ? labels.slice() : Array.from(xs, (x) => String(x)) });
}

function runBarHeights(call: RuleCall): unknown {
  const h = numbers(call, 0, 'the heights');
  if (!h) return undefined;
  return bars(h.map((_, k) => k + 1), h, 1);
}

function runBarLabels(call: RuleCall): unknown {
  const labels = call.values[0];
  const h = numbers(call, 1, 'the heights');
  if (!h || !Array.isArray(labels)) return h ? call.fail('input_undefined', 'the labels are undefined') : undefined;
  if (labels.length !== h.length) return call.fail('size_mismatch', `${labels.length} labels for ${h.length} bars`);
  return bars(h.map((_, k) => k + 1), h, 1, labels.map(String));
}

function runBarXs(call: RuleCall): unknown {
  const xs = numbers(call, 0, 'xs');
  const h = numbers(call, 1, 'the heights');
  const w = num(call, 2);
  if (!xs || !h) return undefined;
  if (w === undefined || !(w > 0)) return call.fail('bad_parameter', `the width must be positive, not ${String(w)}`);
  if (xs.length !== h.length) return call.fail('size_mismatch', `${xs.length} positions for ${h.length} heights`);
  return bars(xs, h, w);
}

/** `(data, width)`: counts of each distinct value, a bar of that width centred on it. */
function runBarData(call: RuleCall): unknown {
  const xs = numbers(call, 0);
  const w = num(call, 1);
  if (!xs) return undefined;
  if (w === undefined || !(w > 0)) return call.fail('bad_parameter', `the width must be positive, not ${String(w)}`);
  const vals: number[] = [];
  const counts: number[] = [];
  for (const x of sorted(xs)) {
    if (vals.length > 0 && vals[vals.length - 1] === x) counts[counts.length - 1] = (counts[counts.length - 1] as number) + 1;
    else {
      vals.push(x);
      counts.push(1);
    }
  }
  return bars(Float64Array.from(vals), Float64Array.from(counts), w);
}

/** `(expr, k, from, to)`: a bar at each whole k with height expr. */
function runBarExpr(call: RuleCall): unknown {
  const from = num(call, 2);
  const to = num(call, 3);
  if (from === undefined || to === undefined) return call.fail('input_undefined', 'a bound is undefined');
  const a = Math.ceil(from - 1e-9);
  const b = Math.floor(to + 1e-9);
  const n = Math.max(0, b - a + 1);
  if (n > 100_000) return call.fail('too_large', `${n} bars; at most 100,000`);
  const ev = call.args[0]?.eval;
  const slot = call.args[1]?.slot;
  if (!ev || slot === undefined) return call.fail('input_undefined', 'the expression could not run');
  const env: Env = call.env;
  const saved = env.locals[slot];
  const xs = new Float64Array(n);
  const h = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    env.locals[slot] = a + k;
    env.reason = undefined;
    const v = ev(env);
    if (typeof v !== 'number' || v !== v) {
      env.locals[slot] = saved;
      return call.fail('has_undefined', `the height at k = ${a + k} is undefined`);
    }
    xs[k] = a + k;
    h[k] = v;
  }
  env.locals[slot] = saved;
  env.reason = undefined;
  return bars(xs, h, 1);
}

/* ------------------------------ frequency polygon ------------------------------ */

function polygon(edges: Float64Array, heights: Float64Array, cumulative: boolean, density: boolean): Pt[] {
  const m = heights.length;
  if (cumulative) {
    const pts: Pt[] = [{ x: edges[0] as number, y: 0 }];
    let c = 0;
    for (let k = 0; k < m; k++) {
      c += density ? (heights[k] as number) * ((edges[k + 1] as number) - (edges[k] as number)) : (heights[k] as number);
      pts.push({ x: edges[k + 1] as number, y: c });
    }
    return pts;
  }
  const first = (edges[1] as number) - (edges[0] as number);
  const last = (edges[m] as number) - (edges[m - 1] as number);
  const pts: Pt[] = [{ x: (edges[0] as number) - first / 2, y: 0 }];
  for (let k = 0; k < m; k++) pts.push({ x: ((edges[k] as number) + (edges[k + 1] as number)) / 2, y: heights[k] as number });
  pts.push({ x: (edges[m] as number) + last / 2, y: 0 });
  return pts;
}

const pointsChart = (kind: string, points: readonly Pt[]): unknown => record('PointsChart', { kind, points: points.slice(), n: points.length });

function runPolyEdges(call: RuleCall): unknown {
  const edges = numbers(call, 0, 'the edges');
  const ys = numbers(call, 1);
  if (!edges || !ys || !checkEdges(call, edges)) return undefined;
  const cum = call.values[2] === true;
  if (ys.length === edges.length - 1) return pointsChart(cum ? 'ogive' : 'freqpoly', polygon(edges, ys, cum, false));
  const { counts } = countClasses(edges, ys, 'left');
  return pointsChart(cum ? 'ogive' : 'freqpoly', polygon(edges, counts, cum, false));
}

function runPolyHist(call: RuleCall): unknown {
  const h = call.values[0] as { fields: Record<string, unknown> } | undefined;
  if (!h) return call.fail('input_undefined', 'the histogram is undefined');
  const edges = h.fields['edges'] as Float64Array;
  const heights = h.fields['heights'] as Float64Array;
  const cum = call.values[1] === true;
  return pointsChart(cum ? 'ogive' : 'freqpoly', polygon(edges, heights, cum, h.fields['scale'] === 'density'));
}

/* ------------------------------ box plots ------------------------------ */

function boxOf(xs: Float64Array, y: number, hh: number, whisker: 'minmax' | 'tukey', method: QuantileMethod, label: string): ReturnType<typeof record> {
  if (xs.length === 0) {
    return record('BoxPlot', { y, halfHeight: hh, min: undefined, q1: undefined, median: undefined, q3: undefined, max: undefined, iqr: undefined, outliers: new Float64Array(0), whisker, method, n: 0, label }, { min: 'empty_list', q1: 'empty_list', median: 'empty_list', q3: 'empty_list', max: 'empty_list', iqr: 'empty_list' });
  }
  const o = ordered(xs);
  const { q1, q3 } = quartiles(o, method);
  const s = sorted(xs);
  let lo = s[0] as number;
  let hi = s[s.length - 1] as number;
  let outliers = new Float64Array(0);
  if (whisker === 'tukey') {
    const a = q1 - 1.5 * (q3 - q1);
    const b = q3 + 1.5 * (q3 - q1);
    const inside = s.filter((x) => x >= a && x <= b);
    outliers = s.filter((x) => x < a || x > b);
    lo = inside[0] ?? lo;
    hi = inside[inside.length - 1] ?? hi;
  }
  return record('BoxPlot', { y, halfHeight: hh, min: lo, q1, median: median(o), q3, max: hi, iqr: q3 - q1, outliers, whisker, method, n: xs.length, label });
}

function runBox(call: RuleCall): unknown {
  const y = num(call, 0);
  const hh = num(call, 1);
  const xs = numbers(call, 2);
  const whisker = oneOf(call, 3, 'minmax', WHISKERS, 'whisker');
  const method = oneOf(call, 4, 'halves', QUANTILE_METHODS, 'method');
  if (y === undefined || hh === undefined) return call.fail('input_undefined', 'the position is undefined');
  if (!xs || !whisker || !method) return undefined;
  return boxOf(xs, y, hh, whisker, method, text(call, 5, ''));
}

function runBoxNumbers(call: RuleCall): unknown {
  const v = [0, 1, 2, 3, 4, 5, 6].map((i) => num(call, i));
  if (v.some((x) => x === undefined)) return call.fail('input_undefined', 'a number is undefined');
  const [y, hh, min, q1, med, q3, max] = v as number[];
  if (!((min as number) <= (q1 as number) && (q1 as number) <= (med as number) && (med as number) <= (q3 as number) && (q3 as number) <= (max as number))) {
    return call.fail('bad_parameter', `the five numbers must be in order: ${min}, ${q1}, ${med}, ${q3}, ${max}`);
  }
  return record('BoxPlot', { y, halfHeight: hh, min, q1, median: med, q3, max, iqr: (q3 as number) - (q1 as number), outliers: new Float64Array(0), whisker: 'minmax', method: 'halves', n: 5, label: '' });
}

function runBoxes(call: RuleCall): unknown {
  const lists = call.values[0];
  if (!Array.isArray(lists)) return call.fail('input_undefined', 'the lists are undefined');
  const labels = given(call, 1) ? (call.values[1] as unknown[] | undefined) : undefined;
  if (labels && labels.length !== lists.length) return call.fail('size_mismatch', `${labels.length} labels for ${lists.length} lists`);
  const whisker = oneOf(call, 2, 'minmax', WHISKERS, 'whisker');
  if (!whisker) return undefined;
  const m = lists.length;
  const plots = lists.map((l, k) => {
    const xs = l instanceof Float64Array ? l : Float64Array.from(l as number[]);
    return boxOf(xs, m - k, 0.35, whisker, 'halves', labels ? String(labels[k]) : `${k + 1}`);
  });
  return record('BoxPlots', { plots, labels: plots.map((b) => b.fields['label'] as string) });
}

/* ------------------------------ dot and stem plots ------------------------------ */

function runDot(call: RuleCall): unknown {
  const xs = numbers(call, 0);
  if (!xs) return undefined;
  if (xs.length > MAX_DOTS) return call.fail('too_large', `${xs.length} dots; a dot plot draws at most ${MAX_DOTS}, use a histogram`);
  const s = sorted(xs);
  const range = s.length ? (s[s.length - 1] as number) - (s[0] as number) : 0;
  const bw = given(call, 1) ? num(call, 1) : range / 60;
  if (bw === undefined || bw < 0) return call.fail('bad_parameter', `the bin width must be 0 or more, not ${String(bw)}`);
  const dots: Pt[] = [];
  let start = NaN;
  let height = 0;
  for (const x of s) {
    if (start === start && x - start <= bw && (bw > 0 || x === start)) height++;
    else {
      start = x;
      height = 1;
    }
    dots.push({ x: start, y: height });
  }
  return record('DotPlot', { values: xs, binWidth: bw, dots, n: xs.length });
}

function runStem(call: RuleCall): unknown {
  const xs = numbers(call, 0);
  if (!xs) return undefined;
  if (xs.length > MAX_STEM) return call.fail('too_large', `${xs.length} values; a stem plot takes at most ${MAX_STEM}`);
  const shift = given(call, 1) ? num(call, 1) : 0;
  if (shift === undefined || !Number.isInteger(shift)) return call.fail('bad_parameter', `the scale must be a whole number, not ${String(shift)}`);
  if (xs.length === 0) return record('StemPlot', { stems: new Float64Array(0), leaves: [], unit: 1, text: '', n: 0 });
  const s = sorted(xs);
  const big = Math.max(Math.abs(s[0] as number), Math.abs(s[s.length - 1] as number));
  // the leaf unit: one digit below the largest stem digit
  const e = big === 0 ? 0 : Math.floor(Math.log10(big));
  const unit = 10 ** (e - 1 + shift);
  const rows = new Map<string, { stem: number; neg: boolean; leaves: number[] }>();
  for (const x of s) {
    const k = Math.floor(Math.abs(x) / unit + 1e-9);
    const stem = Math.floor(k / 10);
    const neg = x < 0;
    const id = `${neg ? '-' : '+'}${stem}`;
    const row = rows.get(id) ?? { stem, neg, leaves: [] };
    row.leaves.push(k % 10);
    rows.set(id, row);
  }
  const list = [...rows.values()].sort((a, b) => (a.neg ? -a.stem - 0.5 : b.neg ? a.stem + 0.5 : a.stem) - (b.neg ? -b.stem - 0.5 : b.stem));
  for (const r of list) r.leaves.sort((a, b) => (r.neg ? b - a : a - b));
  const stemText = (r: { stem: number; neg: boolean }): string => `${r.neg ? '-' : ''}${r.stem}`;
  const w = Math.max(...list.map((r) => stemText(r).length));
  const lines = list.map((r) => `${stemText(r).padStart(w)} | ${r.leaves.join('')}`);
  lines.push(`key: 1 | 2 = ${Number((12 * unit).toPrecision(12))}`);
  return record('StemPlot', {
    stems: Float64Array.from(list.map((r) => (r.neg ? -r.stem : r.stem))), leaves: list.map((r) => r.leaves.join('')), unit, text: lines.join('\n'), n: xs.length,
  });
}

/* ------------------------------ pie chart ------------------------------ */

function runPie(call: RuleCall): unknown {
  const vs = numbers(call, 0, 'the values');
  if (!vs) return undefined;
  if (vs.length > MAX_PIE) return call.fail('too_large', `${vs.length} slices; at most ${MAX_PIE}`);
  const neg = vs.findIndex((v) => v < 0);
  if (neg >= 0) return call.fail('negative_value', `value ${neg + 1} is ${vs[neg]}`);
  const total = sum(vs);
  if (vs.length > 0 && total === 0) return call.fail('negative_value', 'all values are 0');
  const labels = given(call, 1) ? (call.values[1] as unknown[] | undefined) : undefined;
  if (labels && labels.length !== vs.length) return call.fail('size_mismatch', `${labels.length} labels for ${vs.length} values`);
  const centre = (given(call, 2) ? call.values[2] : { x: 0, y: 0 }) as Pt | undefined;
  const radius = given(call, 3) ? num(call, 3) : 1;
  const start = given(call, 4) ? num(call, 4) : Math.PI / 2;
  if (!centre || radius === undefined || start === undefined) return call.fail('input_undefined', 'the centre or radius is undefined');
  if (!(radius > 0)) return call.fail('bad_parameter', `the radius must be positive, not ${radius}`);
  const fractions = vs.map((v) => (total > 0 ? v / total : 0));
  return record('PieChart', {
    values: vs, fractions, angles: fractions.map((f) => f * 2 * Math.PI), total, centre, radius, start,
    labels: labels ? labels.map(String) : Array.from(vs, (_, k) => `${k + 1}`),
  });
}

/* ------------------------------ point charts ------------------------------ */

const runPoints = (kind: string) => (call: RuleCall): unknown => {
  const d = pairs(call, 0, true);
  if (!d) return undefined;
  const idx = Array.from(d.xs.keys()).sort((a, b) => (d.xs[a] as number) - (d.xs[b] as number) || a - b);
  return pointsChart(kind, idx.map((i) => ({ x: d.xs[i] as number, y: d.ys[i] as number })));
};

function runNormalQuantile(call: RuleCall): unknown {
  const xs = numbers(call, 0);
  if (!xs) return undefined;
  const n = xs.length;
  if (n === 0) return record('NormalQuantilePlot', { z: new Float64Array(0), x: new Float64Array(0), points: [], r: undefined, slope: undefined, intercept: undefined, n: 0 }, { r: 'empty_list', slope: 'empty_list', intercept: 'empty_list' });
  const s = sorted(xs);
  if (s[0] === s[n - 1]) return call.fail('zero_variance', `all values are ${s[0]}`);
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) z[i] = normalQuantile((i + 1 - 0.375) / (n + 0.25));
  const { q1, q3 } = quartiles(ordered(xs), 'halves');
  const z1 = normalQuantile(0.25);
  const z3 = -z1;
  // the reference line through (q1, z1) and (q3, z3), in the plane of the points (x, z)
  const slope = q3 > q1 ? (z3 - z1) / (q3 - q1) : undefined;
  const intercept = slope === undefined ? undefined : z1 - slope * q1;
  const r = pearson(Float64Array.from(s), z);
  return record('NormalQuantilePlot', {
    z, x: Float64Array.from(s), points: Array.from(s, (x, i) => ({ x, y: z[i] as number })), r, slope, intercept, n,
  }, slope === undefined ? { slope: 'zero_variance', intercept: 'zero_variance' } : undefined);
}

function runResidualPlot(call: RuleCall): unknown {
  const d = pairs(call, 0, true);
  const f = call.values[1] as FunctionValue | undefined;
  if (!d) return undefined;
  if (!f) return call.fail('input_undefined', 'the function is undefined');
  const res = residualsOf(call, d.xs, d.ys, f);
  if (!res) return undefined;
  return pointsChart('residual', Array.from(d.xs, (x, i) => ({ x, y: res[i] as number })));
}

/** For each point, the square whose side is the residual, on the side away from the curve (design 6). */
function runSquares(call: RuleCall): unknown {
  const d = pairs(call, 0, true);
  const f = call.values[1] as FunctionValue | undefined;
  if (!d) return undefined;
  if (!f) return call.fail('input_undefined', 'the function is undefined');
  const res = residualsOf(call, d.xs, d.ys, f);
  if (!res) return undefined;
  return Array.from(d.xs, (x, i) => {
    const y = d.ys[i] as number;
    const r = res[i] as number;
    const fx = y - r;
    const side = Math.abs(r);
    return { pts: [{ x, y: fx }, { x, y }, { x: x + side, y }, { x: x + side, y: fx }] };
  });
}

/* ------------------------------ the table ------------------------------ */

const sc = (): ParamSpec => opt('scale', 'Text');
const cl = (): ParamSpec => opt('closed', 'Text', 'left');
const histCheck = (i: number) => checks(enumCheck(i, 'scale', SCALES), enumCheck(i + 1, 'closed', CLOSED));
const boxCheck = checks(enumCheck(3, 'whisker', WHISKERS), enumCheck(4, 'method', QUANTILE_METHODS));

export const CHART_COMMANDS: readonly CommandSpec[] = [
  chart('Histogram', [
    form([p('list', L), sc(), cl()], 'Record<Histogram>', runHistAuto, 'a histogram with automatic classes', { check: histCheck(1) }),
    form([p('list', L), p('bins', 'Number'), sc(), cl()], 'Record<Histogram>', runHistBins, 'a histogram with equal classes', { check: histCheck(2) }),
    form([p('edges', L), p('list', L), sc(), cl()], 'Record<Histogram>', runHistEdges, 'a histogram of data or of ready heights on the edges', { check: histCheck(2) }),
  ]),
  chart('BarChart', [
    form([p('heights', L)], 'Record<BarChart>', runBarHeights, 'bars at 1, 2, 3, …'),
    form([p('labels', 'List<Text>'), p('heights', L)], 'Record<BarChart>', runBarLabels, 'labelled bars'),
    form([p('xs', L), p('heights', L), p('width', 'Number')], 'Record<BarChart>', runBarXs, 'bars of a width at positions'),
    form([p('list', L), p('width', 'Number')], 'Record<BarChart>', runBarData, 'a bar for each distinct value, as tall as its count'),
    form([{ name: 'expr', type: 'Number', kind: 'body' }, { name: 'k', type: 'Number', kind: 'binder' }, p('from', 'Number'), p('to', 'Number')], 'Record<BarChart>', runBarExpr, 'a bar at each whole k from from to to'),
  ]),
  chart('FrequencyPolygon', [
    form([p('edges', L), p('list', L), opt('cumulative', 'Bool', false)], 'Record<PointsChart>', runPolyEdges, 'the frequency polygon (an ogive when cumulative)'),
    form([p('histogram', 'Record<Histogram>'), opt('cumulative', 'Bool', false)], 'Record<PointsChart>', runPolyHist, 'the polygon of a histogram'),
  ]),
  chart('BoxPlot', [
    form([p('y', 'Number'), p('halfHeight', 'Number'), p('list', L), opt('whisker', 'Text', 'minmax'), opt('method', 'Text', 'halves'), opt('label', 'Text', '')], 'Record<BoxPlot>', runBox, 'a box plot of the data', { check: boxCheck }),
    form(['y', 'halfHeight', 'min', 'q1', 'median', 'q3', 'max'].map((n) => p(n, 'Number')), 'Record<BoxPlot>', runBoxNumbers, 'a box plot from five numbers'),
  ]),
  chart('BoxPlots', [
    form([p('lists', 'List<List<Number>>'), opt('labels', 'List<Text>'), opt('whisker', 'Text', 'minmax')], 'Record<BoxPlots>', runBoxes, 'stacked box plots on one axis', { check: enumCheck(2, 'whisker', WHISKERS) }),
  ]),
  chart('DotPlot', [form([p('list', L), opt('binWidth', 'Number')], 'Record<DotPlot>', runDot, 'stacked dots at each value')]),
  chart('StemPlot', [form([p('list', L), opt('scale', 'Number', 0)], 'Record<StemPlot>', runStem, 'a stem-and-leaf plot as text')]),
  chart('PieChart', [
    form([p('values', L), opt('labels', 'List<Text>'), opt('centre', 'Point'), opt('radius', 'Number', 1), opt('start', 'Number')], 'Record<PieChart>', runPie, 'a pie chart', {
      check: (c) => {
        const v = c.args[0]?.literal;
        const l = c.args[1]?.literal;
        if (Array.isArray(v) && Array.isArray(l) && v.length !== l.length) return { kind: 'bad_argument', message: `${l.length} labels for ${v.length} values.`, param: 1, params: { command: 'PieChart', why: 'the label count must match the values' } };
        return undefined;
      },
    }),
  ]),
  chart('LineGraph', [form([p('points', P)], 'Record<PointsChart>', runPoints('line'), 'a polyline through the points, by x')]),
  chart('StepGraph', [form([p('points', P)], 'Record<PointsChart>', runPoints('step'), 'steps through the points, by x')]),
  chart('StickGraph', [form([p('points', P)], 'Record<PointsChart>', runPoints('stick'), 'a vertical stick at each point')]),
  chart('NormalQuantilePlot', [form([p('list', L)], 'Record<NormalQuantilePlot>', runNormalQuantile, 'sorted data against normal scores')]),
  chart('ResidualPlot', [form([p('points', P), p('f', 'Function<Number>')], 'Record<PointsChart>', runResidualPlot, 'the points (x, y - f(x))')]),
  chart('Squares', [form([p('points', P), p('f', 'Function<Number>')], 'List<Polygon>', runSquares, 'the squares of the residuals')]),
];

