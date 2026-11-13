/**
 * Statistics and charts: public API (docs/features/statistics).
 *
 * Plug in with `registerStatistics(registry)` after `registerLists(registry)`: this area's results are the records of
 * lists-matrices. It adds descriptive statistics, frequency and tables, charts, fits, tests and intervals, their record
 * schemas, warnings, reason phrases and summaries.
 */
import type { CommandRegistry } from '../../graph/registry';
import { registerNotice } from '../../errors/notices';
import { registerReasonPhrase } from '../../errors/phrases';
import { registerFieldNames, registerFieldTyper } from '../../language/check';
import { registerFieldReader } from '../../language/compile';
import { DIRECTIVES } from '../../language/props';
import { recordFieldNames } from '../lists/ops';
import { RECORD_SCHEMAS, isRecord, registerRecordSchema, registerRecordText } from '../lists/types';
import type { RecordValue } from '../lists/types';
import { CHART_COMMANDS } from './chart-commands';
import { fmt } from './core';
import { DESCRIBE_COMMANDS } from './describe-commands';
import { FIT_COMMANDS } from './fit-commands';
import { TEST_COMMANDS } from './test-commands';
import { STAT_SCHEMAS } from './types';

const NOTICES: Readonly<Record<string, { code: string; severity: 'info' | 'warning'; template: string }>> = {
  unequal_classes: { code: 'S101', severity: 'info', template: 'The classes have different widths, so the heights are densities.' },
  all_equal_values: { code: 'S102', severity: 'info', template: 'Every value is {value}; one class was made.' },
  ties_in_data: { code: 'S103', severity: 'info', template: '{ties} values are tied; average ranks were used.' },
  expected_count_low: { code: 'S104', severity: 'warning', template: 'Some expected counts are below 5 (cells {cells}); the chi-squared p-value is unreliable.' },
  normal_approx_weak: { code: 'S105', severity: 'warning', template: 'Fewer than 10 successes or failures; the normal approximation is weak. Try method = "wilson".' },
  overfit: { code: 'S106', severity: 'warning', template: 'Few degrees of freedom remain; the standard errors are unreliable.' },
  log_space_bias: { code: 'S107', severity: 'info', template: 'Fitted in log space: errors are measured in log y.' },
  no_repeated_value: { code: 'S108', severity: 'info', template: 'No value repeats, so every value is a mode.' },
};

const PHRASES: Readonly<Record<string, { noun: string; sentence: string }>> = {
  too_few_values: { noun: 'too few values', sentence: 'There are not enough values for this.' },
  zero_variance: { noun: 'no spread', sentence: 'All the values are the same, so there is no spread to work with.' },
  degenerate_x: { noun: 'all x the same', sentence: 'All the x values are the same, so no curve y = f(x) fits.' },
  not_linear_model: { noun: 'not a linear model', sentence: 'Bands need a model that is linear in its parameters.' },
  no_dof: { noun: 'no spare degrees of freedom', sentence: 'The fit passes through every point, so there are no standard errors.' },
  bad_edges: { noun: 'bad class edges', sentence: 'The class edges must go up strictly.' },
  not_discrete: { noun: 'not discrete', sentence: 'This needs a discrete distribution.' },
  negative_value: { noun: 'negative value', sentence: 'A pie chart needs values of 0 or more, not all 0.' },
  bad_weights: { noun: 'bad frequencies', sentence: 'Frequencies and weights must be 0 or more (frequencies whole).' },
  singular_fit: { noun: 'dependent basis', sentence: 'The basis functions depend on each other, so the fit has no single answer.' },
  bad_parameter: { noun: 'bad parameter', sentence: 'A number given to the test is outside what it allows.' },
  cells_empty: { noun: 'empty row or column', sentence: 'A row or column of the table sums to 0.' },
  groups_too_few: { noun: 'too few groups', sentence: 'ANOVA needs at least 2 groups, each with a value.' },
};

const f = (r: RecordValue, k: string): string => {
  const v = r.fields[k];
  return typeof v === 'number' ? fmt(v) : 'undefined';
};

const nums = (v: unknown, max = 8): string => {
  const a = v instanceof Float64Array ? Array.from(v) : [];
  return a.slice(0, max).map((x) => fmt(x)).join(' ') + (a.length > max ? ' …' : '');
};

const TAIL_WORD: Readonly<Record<string, string>> = { two: 'two-tailed', left: 'left-tailed', right: 'right-tailed' };
const STAT_SYMBOL: Readonly<Record<string, string>> = { ZTest: 'z', ZTest2: 'z', ZPropTest: 'z', ZPropTest2: 'z', CorrTest: 't' };

/** Summaries of design: agent.md 2. */
const TEXTS: Readonly<Record<string, (r: RecordValue) => string>> = {
  Describe: (r) => `Describe n ${f(r, 'n')}, mean ${f(r, 'mean')}, median ${f(r, 'median')}, sd(n) ${f(r, 'sd')}, min ${f(r, 'min')}, max ${f(r, 'max')}, q1 ${f(r, 'q1')} (${String(r.fields['method'])}), q3 ${f(r, 'q3')}`,
  Describe2: (r) => `Describe points n ${f(r, 'n')}, r ${f(r, 'r')}, r² ${f(r, 'r2')}, cov ${f(r, 'cov')}`,
  FiveNumber: (r) => `FiveNumber min ${f(r, 'min')}, q1 ${f(r, 'q1')}, median ${f(r, 'median')}, q3 ${f(r, 'q3')}, max ${f(r, 'max')}`,
  Fit: (r) => `Fit ${String(r.fields['model'])}: ${String(r.fields['equation'])}, R² ${f(r, 'r2')}, n ${f(r, 'n')}, rmse ${f(r, 'rmse')}`,
  Test: (r) => {
    const name = String(r.fields['test']);
    const sym = STAT_SYMBOL[name] ?? 't';
    const df = typeof r.fields['df'] === 'number' ? `, df ${f(r, 'df')}` : '';
    return `${name} ${TAIL_WORD[String(r.fields['tail'])] ?? ''}: ${sym} ${f(r, 'statistic')}${df}, p ${f(r, 'p')}`;
  },
  ChiSquared: (r) => `ChiSquaredTest: chi² ${f(r, 'statistic')}, df ${f(r, 'df')}, p ${f(r, 'p')}`,
  ANOVA: (r) => `ANOVA: F ${f(r, 'F')}, df ${f(r, 'dfBetween')} and ${f(r, 'dfWithin')}, p ${f(r, 'p')}`,
  Interval: (r) => `${String(r.fields['test'])} ${fmt((r.fields['level'] as number) * 100)}%: [${f(r, 'lo')}, ${f(r, 'hi')}], estimate ${f(r, 'estimate')}, margin ${f(r, 'margin')}`,
  Table: (r) => `Table ${f(r, 'rows')} rows × ${f(r, 'cols')} columns (${(r.fields['titles'] as string[]).join(', ')})`,
  Histogram: (r) => {
    const e = r.fields['edges'] as Float64Array;
    const scale = String(r.fields['scale']);
    return `Histogram ${e.length - 1} classes [${fmt(e[0] as number)}, ${fmt(e[e.length - 1] as number)}], counts ${nums(r.fields['counts'])}, heights are ${scale === 'count' ? 'counts' : scale}`;
  },
  BoxPlot: (r) => {
    const o = r.fields['outliers'] as Float64Array;
    const extra = o.length > 0 ? `, ${o.length} outlier${o.length > 1 ? 's' : ''} (${nums(o, 4)})` : '';
    return `BoxPlot min ${f(r, 'min')} q1 ${f(r, 'q1')} median ${f(r, 'median')} q3 ${f(r, 'q3')} max ${f(r, 'max')}${extra}`;
  },
  BarChart: (r) => `BarChart ${(r.fields['heights'] as Float64Array).length} bars, heights ${nums(r.fields['heights'])}`,
  ShadedBars: (r) => `ShadedBars ${(r.fields['heights'] as Float64Array).length} bars, mass ${f(r, 'mass')}`,
  PieChart: (r) => `PieChart ${(r.fields['values'] as Float64Array).length} slices, total ${f(r, 'total')}`,
  PointsChart: (r) => `${String(r.fields['kind'])} chart of ${f(r, 'n')} points`,
  NormalQuantilePlot: (r) => `NormalQuantilePlot n ${f(r, 'n')}, r ${f(r, 'r')}`,
  StemPlot: (r) => `StemPlot n ${f(r, 'n')}`,
  DotPlot: (r) => `DotPlot n ${f(r, 'n')}`,
};

let registered = false;

/** Registers the area. Idempotent. */
export function registerStatistics(registry: CommandRegistry): void {
  registry.registerAll(DESCRIBE_COMMANDS);
  registry.registerAll(CHART_COMMANDS);
  registry.registerAll(FIT_COMMANDS);
  registry.registerAll(TEST_COMMANDS);
  if (registered) return;
  registered = true;
  for (const [name, fields] of Object.entries(STAT_SCHEMAS)) registerRecordSchema(name, fields);
  // the data-analysis panel's saved state (design 9): mode, data sources, plot or model
  DIRECTIVES['datalab'] = ['@datalab one data histogram', '@datalab two P line', '@datalab several a b c'];
  for (const [name, text] of Object.entries(TEXTS)) registerRecordText(name, text);
  // Chart<Schema> and Table read their fields from the record schemas, like Record
  for (const kind of ['Chart', 'Table'] as const) {
    const schemaOf = (s: string | undefined): string | undefined => (kind === 'Table' ? 'Table' : s);
    registerFieldTyper(kind, (field, target) => {
      const schema = schemaOf(target.ty.schema);
      const fields = schema !== undefined && Object.hasOwn(RECORD_SCHEMAS, schema) ? RECORD_SCHEMAS[schema] : undefined;
      return fields?.find((x) => x.name === field)?.ty;
    });
    registerFieldNames(kind, (ty) => recordFieldNames(schemaOf(ty.schema)));
    registerFieldReader(kind, (field, value) => (isRecord(value) && Object.hasOwn(value.fields, field) ? value.fields[field] : undefined));
  }
  for (const [kind, spec] of Object.entries(NOTICES)) registerNotice(kind, spec);
  for (const [reason, phrase] of Object.entries(PHRASES)) registerReasonPhrase(reason, phrase);
}

export { CHART_COMMANDS, DESCRIBE_COMMANDS, FIT_COMMANDS, TEST_COMMANDS };
export { CHART_SCHEMAS, STATISTICS_REASONS, STATISTICS_TYPES, STAT_SCHEMAS } from './types';
export { betaI, chiSqCdf, chiSqQuantile, chiSqSf, erfc, fSf, gammaPQ, lgamma, normalCdf, normalPdf, normalQuantile, normalSf, tCdf, tQuantile, tSf } from './dist';
