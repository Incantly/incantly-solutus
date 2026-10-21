import { validateScene, type ScenePlan } from '@incantly/core';
import { REFERENCE_SCENES } from '@incantly/core/scenes';
import { loadEvalPrompts, type EvalConcept, type EvalPromptSet } from './eval-prompts';
import { costOf, type ModelClient, type ModelUsage, NO_USAGE, addUsage } from './models';
import { Generator, type GenerationState } from './pipeline';
import { isolatedProbe, probeSpecFor, type SceneProber } from './probe';
import { failureRecord, type FailureRecord } from './records';

/**
 * The eval suite (EX-2): the versioned learner prompts, several phrasings per
 * concept, through the whole pipeline. It reports first-attempt and
 * post-repair pass rates with 95% Wilson intervals, latency and tokens. Each
 * concept also runs with its own reviewed example withheld, because for the
 * v0.1 concepts the nearest example is the answer.
 */

export type Condition = 'with-example' | 'example-withheld';

export interface EvalOptions {
  readonly model: ModelClient;
  readonly prompts?: EvalPromptSet;
  /** Trials for each concept in each condition: 100 gives 300 per condition for the three concepts. */
  readonly trialsPerConcept?: number;
  readonly conditions?: readonly Condition[];
  readonly concepts?: readonly string[];
  readonly probe?: SceneProber;
  readonly concurrency?: number;
  readonly maxRepairs?: number;
  readonly onTrial?: (trial: TrialResult, done: number, total: number) => void;
}

export interface TrialResult {
  readonly index: number;
  readonly concept: string;
  readonly condition: Condition;
  readonly phrasing: number;
  readonly prompt: string;
  readonly firstAttempt: boolean;
  readonly passed: boolean;
  readonly repairs: number;
  /** Where it failed: the plan, the model, or the first check the final candidate failed. */
  readonly failure: string | null;
  /** The plan matches what the eval set expects of the concept. */
  readonly expectations: readonly string[];
  /** An approved scene that fails an independent re-check: must never happen. */
  readonly broken: boolean;
  readonly ms: number;
  readonly firstFragmentMs: number | null;
  readonly repairMs: number;
  readonly usage: ModelUsage;
  readonly cost: number;
  readonly record: FailureRecord;
}

export interface Rate {
  readonly passed: number;
  readonly total: number;
  readonly rate: number;
  /** The 95% Wilson score interval. */
  readonly low: number;
  readonly high: number;
}

/** The Wilson score interval for a binomial proportion. */
export function wilson(passed: number, total: number, z = 1.96): Rate {
  if (total === 0) return { passed, total, rate: 0, low: 0, high: 1 };
  const p = passed / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denominator;
  const round = (x: number) => Math.round(x * 10000) / 10000;
  return { passed, total, rate: round(p), low: round(Math.max(0, centre - half)), high: round(Math.min(1, centre + half)) };
}

export interface Latency {
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

function latency(values: readonly number[]): Latency {
  if (values.length === 0) return { p50: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return { p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1]! };
}

export interface GroupSummary {
  readonly firstAttempt: Rate;
  readonly postRepair: Rate;
}

export interface EvalSummary {
  readonly promptsVersion: number;
  readonly model: string;
  readonly trials: number;
  readonly firstAttempt: Rate;
  readonly postRepair: Rate;
  readonly byConcept: Readonly<Record<string, GroupSummary>>;
  readonly byCondition: Readonly<Record<string, GroupSummary>>;
  readonly expectations: Rate;
  readonly brokenShown: number;
  /** Failures of the final candidate, by where they failed. */
  readonly failures: Readonly<Record<string, number>>;
  readonly latencyMs: Latency;
  readonly firstFragmentMs: Latency;
  readonly repairMs: Latency;
  readonly tokens: ModelUsage & { readonly perTrial: number };
  /** Share of trials whose calls read the fixed context from the prompt cache (SP-1). */
  readonly cacheHitRate: number;
  readonly cost: number;
  /** The v0.1 gate: at least 85% first time and 95% after one repair, and no broken figure shown. */
  readonly gate: {
    readonly firstAttempt: boolean;
    readonly postRepair: boolean;
    readonly noBrokenFigures: boolean;
    /** The same targets met by the lower bound of the interval, not just the estimate. */
    readonly confident: boolean;
  };
}

// camelCase splits into words, but a lone capital stays put: pH is one word.
const words = (name: string) =>
  name
    .replace(/([a-z])([A-Z])(?=[a-z])/g, '$1 $2')
    .toLowerCase()
    .trim();

/** What the plan should contain for this concept, from the eval set: problems, or none. */
export function checkExpectations(plan: ScenePlan | null, concept: EvalConcept, js: string | null): string[] {
  if (!plan) return ['no plan'];
  const problems: string[] = [];
  const expects = concept.expects;
  const names = [...plan.parameters.map((p) => p.name), ...plan.model.outputs.map((o) => o.name)].map(words);
  // Short names such as f or v must match exactly; longer ones may be part of a name.
  const matches = (name: string, alt: string) => name === alt || (alt.length > 2 && name.includes(alt));
  const has = (alternatives: readonly string[]) => alternatives.some((alt) => names.some((n) => matches(n, alt)));
  for (const quantity of expects.quantities) if (!has(quantity)) problems.push(`no quantity named ${quantity.join(' or ')}`);
  if (plan.parameters.length < expects.minParams) problems.push(`fewer than ${expects.minParams} parameters`);
  if (plan.parameters.length > expects.maxParams) problems.push(`more than ${expects.maxParams} parameters`);
  if (expects.readouts.length > 0) {
    const readouts = js ? [...js.matchAll(/^\s*['"]?([A-Za-z][\w ]*)['"]?\s*:\s*\(\)\s*=>/gm)].map((m) => words(m[1]!)) : [];
    for (const readout of expects.readouts) {
      if (!readout.some((alt) => readouts.some((r) => matches(r, alt)) || has([alt]))) problems.push(`no readout of ${readout.join(' or ')}`);
    }
  }
  if (expects.singularPoints && (plan.singularPoints ?? []).length === 0) problems.push('no singular point declared');
  return problems;
}

interface Planned {
  readonly index: number;
  readonly concept: EvalConcept;
  readonly condition: Condition;
  readonly phrasing: number;
}

/** The trials: for each condition, each concept, its phrasings in turn. */
export function planTrials(prompts: EvalPromptSet, options: { trialsPerConcept: number; conditions: readonly Condition[]; concepts?: readonly string[] }): Planned[] {
  const out: Planned[] = [];
  for (const condition of options.conditions) {
    for (const concept of prompts.concepts) {
      if (options.concepts && !options.concepts.includes(concept.id)) continue;
      for (let i = 0; i < options.trialsPerConcept; i++) {
        out.push({ index: out.length, concept, condition, phrasing: i % concept.phrasings.length });
      }
    }
  }
  return out;
}

/** An approved scene, checked again from scratch: the invariant that no broken figure is shown. */
async function brokenWhenShown(state: GenerationState, probe: SceneProber): Promise<boolean> {
  if (state.status !== 'approved' || !state.scene || !state.plan) return false;
  const { html, css, js } = state.current!.fragments;
  const validation = validateScene({ html: html ?? '', css: css ?? '', js: js ?? '' });
  if (!validation.scene) return true;
  const report = await probe(validation.scene, probeSpecFor(state.plan));
  return !report.ok;
}

export async function runEvals(options: EvalOptions): Promise<{ readonly trials: readonly TrialResult[]; readonly summary: EvalSummary }> {
  const prompts = options.prompts ?? loadEvalPrompts();
  const probe = options.probe ?? isolatedProbe;
  const planned = planTrials(prompts, {
    trialsPerConcept: options.trialsPerConcept ?? 100,
    conditions: options.conditions ?? ['with-example', 'example-withheld'],
    ...(options.concepts ? { concepts: options.concepts } : {}),
  });
  const results: TrialResult[] = new Array<TrialResult>(planned.length);
  let next = 0;
  let done = 0;

  const run = async (trial: Planned): Promise<TrialResult> => {
    const prompt = trial.concept.phrasings[trial.phrasing]!;
    const own = REFERENCE_SCENES[trial.concept.example] ? [trial.concept.example] : [];
    const generator = new Generator({
      model: options.model,
      probe,
      ...(options.maxRepairs !== undefined ? { maxRepairs: options.maxRepairs } : {}),
      ...(trial.condition === 'example-withheld' ? { withhold: own } : {}),
    });
    const state = await generator.generate({ prompt });
    const broken = await brokenWhenShown(state, probe);
    const last = state.current;
    const failure =
      state.status === 'approved'
        ? null
        : state.failure?.stage === 'plan' || state.failure?.stage === 'model'
          ? state.failure.stage
          : `${last?.failed ?? 'scene'}:${last?.report?.check ?? 'unknown'}`;
    return {
      index: trial.index,
      concept: trial.concept.id,
      condition: trial.condition,
      phrasing: trial.phrasing,
      prompt,
      firstAttempt: state.firstAttemptPassed,
      passed: state.status === 'approved' && !broken,
      repairs: state.repairsUsed,
      failure,
      expectations: checkExpectations(state.plan, trial.concept, state.current?.fragments.js ?? null),
      broken,
      ms: state.timings.totalMs ?? 0,
      firstFragmentMs: state.timings.firstFragmentMs ?? null,
      repairMs: state.timings.repairMs,
      usage: state.usage,
      cost: state.calls.reduce((sum, call) => sum + costOf(call.model, call.usage), 0),
      record: failureRecord(state, 'process'),
    };
  };

  const worker = async () => {
    while (next < planned.length) {
      const trial = planned[next++]!;
      const result = await run(trial);
      results[trial.index] = result;
      done++;
      options.onTrial?.(result, done, planned.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 4) }, worker));
  return { trials: results, summary: summarize(results, prompts.version, options.model.name) };
}

export function summarize(trials: readonly TrialResult[], promptsVersion: number, model: string): EvalSummary {
  const group = (list: readonly TrialResult[]): GroupSummary => ({
    firstAttempt: wilson(list.filter((t) => t.firstAttempt && !t.broken).length, list.length),
    postRepair: wilson(list.filter((t) => t.passed).length, list.length),
  });
  const by = (key: (t: TrialResult) => string) => {
    const groups: Record<string, TrialResult[]> = {};
    for (const trial of trials) (groups[key(trial)] ??= []).push(trial);
    return Object.fromEntries(Object.entries(groups).map(([k, list]) => [k, group(list)]));
  };
  const failures: Record<string, number> = {};
  for (const trial of trials) if (trial.failure) failures[trial.failure] = (failures[trial.failure] ?? 0) + 1;
  const usage = trials.reduce((sum, t) => addUsage(sum, t.usage), NO_USAGE);
  const overall = group(trials);
  const brokenShown = trials.filter((t) => t.broken).length;
  return {
    promptsVersion,
    model,
    trials: trials.length,
    ...overall,
    byConcept: by((t) => t.concept),
    byCondition: by((t) => t.condition),
    expectations: wilson(trials.filter((t) => t.expectations.length === 0).length, trials.length),
    brokenShown,
    failures,
    latencyMs: latency(trials.map((t) => t.ms)),
    firstFragmentMs: latency(trials.flatMap((t) => (t.firstFragmentMs === null ? [] : [t.firstFragmentMs]))),
    repairMs: latency(trials.filter((t) => t.repairs > 0).map((t) => t.repairMs)),
    tokens: { ...usage, perTrial: trials.length ? Math.round((usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens) / trials.length) : 0 },
    cacheHitRate: trials.length ? Math.round((trials.filter((t) => t.usage.cacheReadTokens > 0).length / trials.length) * 1000) / 1000 : 0,
    cost: Math.round(trials.reduce((sum, t) => sum + t.cost, 0) * 100) / 100,
    gate: {
      firstAttempt: overall.firstAttempt.rate >= 0.85,
      postRepair: overall.postRepair.rate >= 0.95,
      noBrokenFigures: brokenShown === 0,
      confident: overall.firstAttempt.low >= 0.85 && overall.postRepair.low >= 0.95 && brokenShown === 0,
    },
  };
}

const percent = (x: number) => `${(x * 100).toFixed(1)}%`;
const rate = (r: Rate) => `${percent(r.rate)} (95% CI ${percent(r.low)} to ${percent(r.high)}; ${r.passed} of ${r.total})`;

/** The summary as Markdown, for the eval results folder and pull requests. */
export function summaryMarkdown(summary: EvalSummary): string {
  const lines = [
    `# Generation evals: ${summary.model}, prompts v${summary.promptsVersion}`,
    '',
    `${summary.trials} trials.`,
    '',
    '| Measure | Result | Gate |',
    '| --- | --- | --- |',
    `| First attempt | ${rate(summary.firstAttempt)} | ${summary.gate.firstAttempt ? 'meets 85%' : 'below 85%'} |`,
    `| After one repair | ${rate(summary.postRepair)} | ${summary.gate.postRepair ? 'meets 95%' : 'below 95%'} |`,
    `| Broken figures shown | ${summary.brokenShown} | ${summary.gate.noBrokenFigures ? 'none' : 'FAILS'} |`,
    `| Plan matches the eval set | ${rate(summary.expectations)} | reported |`,
    '',
    '| Group | First attempt | After one repair |',
    '| --- | --- | --- |',
    ...Object.entries({ ...summary.byConcept, ...summary.byCondition }).map(([name, g]) => `| ${name} | ${rate(g.firstAttempt)} | ${rate(g.postRepair)} |`),
    '',
    `Latency: p50 ${summary.latencyMs.p50} ms, p95 ${summary.latencyMs.p95} ms, max ${summary.latencyMs.max} ms. First fragment p50 ${summary.firstFragmentMs.p50} ms. Repairs p50 ${summary.repairMs.p50} ms.`,
    '',
    `Tokens: ${summary.tokens.inputTokens} input, ${summary.tokens.cacheReadTokens} cache reads, ${summary.tokens.cacheWriteTokens} cache writes, ${summary.tokens.outputTokens} output; ${summary.tokens.perTrial} a trial. Cost about $${summary.cost.toFixed(2)}.`,
    '',
    `Prompt cache: the fixed context was read from the cache in ${percent(summary.cacheHitRate)} of trials.`,
    '',
    'Failures of the final candidate:',
    '',
    ...(Object.keys(summary.failures).length === 0 ? ['- none'] : Object.entries(summary.failures).sort((a, b) => b[1] - a[1]).map(([kind, n]) => `- ${kind}: ${n}`)),
    '',
  ];
  return lines.join('\n');
}
