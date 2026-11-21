/**
 * Value shapes and registries of the statistics area (docs/features/statistics/design.md 3, 7.1, 8.1).
 *
 * Results with several values are records of the lists-matrices area: a fit is a `Record<Fit>`, a chart a
 * `Record<Histogram>` and so on (see "Decided against the design" in `.kiro/specs/statistics/requirements.md`).
 *
 * No DOM, no timers, no Date.
 */
import { T, fnOf, listOf, registerSchemaType } from '../../language/types';
import type { Ty } from '../../language/types';

declare module '../../contracts/values' {
  interface AreaTypeNames {
    // statistics: a chart is `Chart<Histogram>` and so on; a table is `Table`
    Chart: true;
    Table: true;
  }
  interface AreaUndefReasons {
    // statistics
    too_few_values: true;
    zero_variance: true;
    degenerate_x: true;
    not_linear_model: true;
    no_dof: true;
    bad_edges: true;
    not_discrete: true;
    negative_value: true;
    bad_weights: true;
    singular_fit: true;
    bad_parameter: true;
    cells_empty: true;
    groups_too_few: true;
  }
}

// Chart and Table carry a schema, like Record (`Chart<BoxPlot>`). Registered when the module loads, before any command
// table parses its type texts.
registerSchemaType('Chart');
registerSchemaType('Table');

/** Type names this area adds. Pass to `registry.problems({ types: STATISTICS_TYPES })`. */
export const STATISTICS_TYPES: readonly string[] = ['Chart', 'Table'];

/* ------------------------------ option sets ------------------------------ */

export const QUANTILE_METHODS = ['halves', 'hinges', 'linear', 'exclusive', 'nearest'] as const;
export type QuantileMethod = (typeof QUANTILE_METHODS)[number];

export const TAILS = ['two', 'left', 'right'] as const;
export type Tail = (typeof TAILS)[number];
/** Signs accepted for the tails (design 3.3). */
export const TAIL_ALIASES: Readonly<Record<string, Tail>> = { '!=': 'two', '<': 'left', '>': 'right' };

export const SCALES = ['count', 'relative', 'density'] as const;
export type Scale = (typeof SCALES)[number];
export const CLOSED = ['left', 'right'] as const;
export const WHISKERS = ['minmax', 'tukey'] as const;
export const SPACES = ['data', 'log'] as const;
export const PROP_METHODS = ['wald', 'wilson'] as const;

/* ------------------------------ limits (design 10.5) ------------------------------ */

export const MAX_FIT_POINTS = 100_000;
export const MAX_POLY_DEGREE = 12;
export const MAX_BINS = 10_000;
export const MAX_AUTO_CLASSES = 200;
export const MAX_ANOVA_GROUPS = 50;
export const MAX_CHI_TABLE = 30;
export const MAX_STEM = 2_000;
export const MAX_PIE = 200;
export const MAX_TABLE_ROWS = 1_000;
export const MAX_TABLE_COLS = 12;

/* ------------------------------ record schemas ------------------------------ */

const N = T.Number;
const NL = listOf(T.Number);
const PL = listOf(T.Point);
const TX = T.Text;
const rec = (schema: string): Ty => ({ k: 'Record', schema });
const chart = (schema: string): Ty => ({ k: 'Chart', schema });
const TABLE: Ty = { k: 'Table' };
const DIST: Ty = { k: 'ContinuousDistribution' };

type Fields = readonly { readonly name: string; readonly ty: Ty }[];
const f = (spec: Readonly<Record<string, Ty>>): Fields => Object.entries(spec).map(([name, ty]) => ({ name, ty }));

const DESCRIBE: Fields = f({
  n: N, sum: N, mean: N, median: N, mode: NL, min: N, max: N, range: N, q1: N, q3: N, iqr: N,
  variance: N, sd: N, sampleVariance: N, sampleSd: N, sumSq: N, sxx: N, skewness: N, kurtosis: N, method: TX,
});

/** Every schema this area adds, in registration order. */
export const STAT_SCHEMAS: Readonly<Record<string, Fields>> = {
  Describe: DESCRIBE,
  Describe2: f({ x: rec('Describe'), y: rec('Describe'), r: N, r2: N, cov: N, sampleCov: N, sxy: N, spearman: N, n: N }),
  FiveNumber: f({ min: N, q1: N, median: N, q3: N, max: N, method: TX }),
  Table: f({ rows: N, cols: N, titles: listOf(T.Text), columns: { k: 'List' }, caption: TX }),
  Contingency: f({ observed: { k: 'Matrix' }, rowLabels: { k: 'List' }, colLabels: { k: 'List' }, table: TABLE }),
  Fit: f({
    f: fnOf('Number', 1), equation: TX, params: NL, names: listOf(T.Text), stderr: NL, r2: N, adjR2: N, sse: N, rmse: N,
    n: N, dof: N, residuals: NL, model: TX, space: TX, iterations: N, from: N, to: N,
  }),
  Test: f({ statistic: N, p: N, df: N, tail: TX, estimate: N, se: N, n: N, test: TX, dist: DIST }),
  ChiSquared: f({ statistic: N, p: N, df: N, tail: TX, n: N, expected: { k: 'Matrix' }, contributions: { k: 'Matrix' }, test: TX, dist: DIST }),
  ANOVA: f({
    F: N, p: N, dfBetween: N, dfWithin: N, ssBetween: N, ssWithin: N, msBetween: N, msWithin: N, grandMean: N,
    groupMeans: NL, table: TABLE, dist: DIST,
  }),
  Interval: f({ lo: N, hi: N, level: N, margin: N, estimate: N, se: N, df: N, test: TX, dist: DIST }),
  // charts (design 6)
  Histogram: f({ edges: NL, counts: NL, heights: NL, total: N, binWidth: N, outside: N, n: N, scale: TX, closed: TX }),
  BarChart: f({ xs: NL, heights: NL, width: N, total: N, labels: listOf(T.Text) }),
  // the bars of a discrete distribution with an interval picked out (probability design 4.3): inside[i] is 1 or 0
  ShadedBars: f({ xs: NL, heights: NL, width: N, total: N, labels: listOf(T.Text), inside: NL, lo: N, hi: N, ends: TX, mass: N, tails: T.Bool }),
  BoxPlot: f({ y: N, halfHeight: N, min: N, q1: N, median: N, q3: N, max: N, iqr: N, outliers: NL, whisker: TX, method: TX, n: N, label: TX }),
  BoxPlots: f({ plots: listOf(chart('BoxPlot')), labels: listOf(T.Text) }),
  DotPlot: f({ values: NL, binWidth: N, dots: PL, n: N }),
  StemPlot: f({ stems: NL, leaves: listOf(T.Text), unit: N, text: TX, n: N }),
  PieChart: f({ values: NL, fractions: NL, angles: NL, total: N, centre: T.Point, radius: N, start: N, labels: listOf(T.Text) }),
  PointsChart: f({ kind: TX, points: PL, n: N }),
  NormalQuantilePlot: f({ z: NL, x: NL, points: PL, r: N, slope: N, intercept: N, n: N }),
};

/** Schemas the view draws as charts. */
export const CHART_SCHEMAS: readonly string[] = ['Histogram', 'BarChart', 'ShadedBars', 'BoxPlot', 'BoxPlots', 'DotPlot', 'StemPlot', 'PieChart', 'PointsChart', 'NormalQuantilePlot'];

/** Every undefined reason this area's rules can report, its own and the shared ones. */
export const STATISTICS_REASONS: readonly string[] = [
  'too_few_values', 'zero_variance', 'degenerate_x', 'not_linear_model', 'no_dof', 'bad_edges', 'not_discrete', 'negative_value',
  'bad_weights', 'singular_fit', 'bad_parameter', 'cells_empty', 'groups_too_few', 'empty_list', 'has_undefined', 'size_mismatch',
  'out_of_domain', 'no_convergence', 'not_finite',
];
