import { closureFor, removesCause, type ClosedClass } from './closed';
import { DEFAULT_DEADLINE_MS } from './pipeline';
import type { FailureRecord, Outcome } from './records';

/**
 * The generation dashboard (RP-13, PRD 25.7) from failure records: outcomes,
 * how often the first attempt passes and how often a repair was needed, how
 * often the reviewed starting scenes were used, stage timings against the
 * deadline, lines per figure (RM-4), cost, and the failures that keep coming
 * back, as candidates for new kit functions or rules (RP-12).
 */

export interface Spread {
  readonly count: number;
  readonly p50: number | null;
  readonly p90: number | null;
  readonly max: number | null;
  readonly mean: number | null;
}

export interface Recurring {
  readonly check: string;
  readonly count: number;
  /** Concepts it happened in, most frequent first. */
  readonly concepts: readonly string[];
  /** One report summary, for a feel of it. */
  readonly sample: string;
  /** What closed or named the class of its failures, and how many of them each covers (RP-12). */
  readonly closures: ReadonlyArray<{ readonly closure: ClosedClass; readonly count: number }>;
  /** Its failures no kit function or engine behaviour has closed: still to close, with or without a rule against them. */
  readonly open: number;
}

export interface Dashboard {
  readonly generations: number;
  readonly outcomes: Readonly<Record<Outcome, number>>;
  readonly firstAttemptRate: number | null;
  readonly repairShare: number | null;
  readonly failureRate: number | null;
  readonly adaptRate: number | null;
  readonly deadlineSkips: number;
  readonly timings: { readonly planMs: Spread; readonly firstFragmentMs: Spread; readonly sceneMs: Spread; readonly totalMs: Spread };
  /** Generations that took longer than the deadline. */
  readonly overDeadline: number;
  readonly lines: Spread;
  readonly costUsd: number;
  readonly recurring: readonly Recurring[];
}

export function spread(values: readonly number[]): Spread {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return { count: 0, p50: null, p90: null, max: null, mean: null };
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;
  return { count: sorted.length, p50: at(0.5), p90: at(0.9), max: sorted.at(-1)!, mean: sorted.reduce((a, b) => a + b, 0) / sorted.length };
}

const share = (part: number, whole: number) => (whole === 0 ? null : part / whole);

export function dashboard(records: readonly FailureRecord[], deadlineMs = DEFAULT_DEADLINE_MS): Dashboard {
  const outcomes: Record<Outcome, number> = { 'first-attempt': 0, repaired: 0, 'failed-plan': 0, 'failed-scene': 0, 'failed-model': 0, pending: 0 };
  for (const r of records) outcomes[r.outcome]++;
  const settled = records.filter((r) => r.outcome !== 'pending');
  const built = records.filter((r) => r.mode !== null);
  const failed = outcomes['failed-plan'] + outcomes['failed-scene'] + outcomes['failed-model'];
  const byCheck = new Map<string, { count: number; concepts: Map<string, number>; sample: string; closures: Map<ClosedClass, number>; open: number }>();
  for (const r of records) {
    for (const report of r.reports) {
      const entry = byCheck.get(report.check) ?? { count: 0, concepts: new Map<string, number>(), sample: report.summary, closures: new Map<ClosedClass, number>(), open: 0 };
      entry.count++;
      const concept = r.concept ?? 'unknown';
      entry.concepts.set(concept, (entry.concepts.get(concept) ?? 0) + 1);
      // Each failure by its own words: a closure may cover only some failures of a broad check, such as mount.
      const closure = closureFor(report);
      if (closure) entry.closures.set(closure, (entry.closures.get(closure) ?? 0) + 1);
      if (!closure || !removesCause(closure)) entry.open++;
      byCheck.set(report.check, entry);
    }
  }
  const recurring = [...byCheck.entries()]
    .filter(([, e]) => e.count >= 2)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([check, e]) => ({
      check,
      count: e.count,
      concepts: [...e.concepts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c),
      sample: e.sample,
      closures: [...e.closures.entries()].sort((a, b) => b[1] - a[1]).map(([closure, count]) => ({ closure, count })),
      open: e.open,
    }));
  const times = (pick: (r: FailureRecord) => number | undefined) => spread(records.map(pick).filter((v): v is number => v !== undefined));
  return {
    generations: records.length,
    outcomes,
    firstAttemptRate: share(outcomes['first-attempt'], settled.length),
    repairShare: share(records.filter((r) => r.repairs > 0).length, built.length),
    failureRate: share(failed, settled.length),
    adaptRate: share(records.filter((r) => r.mode === 'adapt').length, built.length),
    deadlineSkips: records.filter((r) => r.deadlineSkipped).length,
    timings: {
      planMs: times((r) => r.timings.planMs),
      firstFragmentMs: times((r) => r.timings.firstFragmentMs),
      sceneMs: times((r) => r.timings.sceneMs),
      totalMs: times((r) => r.timings.totalMs),
    },
    overDeadline: records.filter((r) => (r.timings.totalMs ?? 0) > deadlineMs).length,
    lines: spread(records.map((r) => r.lines).filter((v): v is number => v !== null)),
    costUsd: Math.round(records.reduce((sum, r) => sum + r.cost, 0) * 1e6) / 1e6,
    recurring,
  };
}

const percent = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v * 1000) / 10}%`);
const seconds = (v: number | null) => (v === null ? 'n/a' : `${(v / 1000).toFixed(1)} s`);

/** The dashboard as Markdown. */
export function dashboardText(d: Dashboard): string {
  const timing = (name: string, s: Spread) => `| ${name} | ${s.count} | ${seconds(s.p50)} | ${seconds(s.p90)} | ${seconds(s.max)} |`;
  return [
    `# Generation dashboard`,
    '',
    `${d.generations} generations. First attempt passed: ${percent(d.firstAttemptRate)}. Needed a repair: ${percent(d.repairShare)}. Failed: ${percent(d.failureRate)}.`,
    `Adapted from a reviewed scene: ${percent(d.adaptRate)}. Repairs skipped for the deadline: ${d.deadlineSkips}. Over the deadline: ${d.overDeadline}.`,
    '',
    '| Stage | Count | Median | 90th percentile | Slowest |',
    '| --- | --- | --- | --- | --- |',
    timing('Plan', d.timings.planMs),
    timing('First fragment', d.timings.firstFragmentMs),
    timing('Scene call', d.timings.sceneMs),
    timing('Total', d.timings.totalMs),
    '',
    `Lines per figure: median ${d.lines.p50 ?? 'n/a'}, 90th percentile ${d.lines.p90 ?? 'n/a'}, most ${d.lines.max ?? 'n/a'}. Cost: $${d.costUsd.toFixed(4)}.`,
    '',
    '## Recurring failures',
    '',
    d.recurring.length === 0
      ? 'None seen twice yet.'
      : [
          '| Check | Times | Concepts | Example | Closed so far |',
          '| --- | --- | --- | --- | --- |',
          ...d.recurring.map(
            (r) => `| ${r.check} | ${r.count} | ${r.concepts.slice(0, 3).join(', ')} | ${r.sample.replace(/\|/g, '/')} | ${closedSoFar(r).replace(/\|/g, '/')} |`,
          ),
          '',
          openLine(d.recurring),
        ].join('\n'),
    '',
  ].join('\n');
}

/** What has closed a recurring failure's class so far: all of it, part of it, only a rule against it, or nothing. */
function closedSoFar(r: Recurring): string {
  const fixes = r.closures.map(({ closure, count }) => `${closure.by}${count < r.count ? ` (${count} of ${r.count})` : ''}: ${closure.fix}`).join(' ');
  if (r.closures.length === 0) return 'open';
  if (r.open === 0) return `closed by ${fixes}`;
  return r.open === r.count ? `open, ${fixes}` : `partly closed by ${fixes}`;
}

/** The recurring failures no kit function or engine behaviour has closed yet, rule or not: the next to close (RP-12). */
function openLine(recurring: readonly Recurring[]): string {
  const open = recurring.filter((r) => r.open > 0).map((r) => r.check);
  return open.length === 0
    ? 'Every recurring failure has a kit function or an engine behaviour against it; one that still recurs needs a stronger one.'
    : `Open: ${open.join(', ')}. Close each with a kit function or an engine behaviour that removes the cause, or at least a core rule, with a test, and list it in closed.ts.`;
}
