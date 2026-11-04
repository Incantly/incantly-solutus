import { filmPresetFor, validateScene, type StoryboardSpec } from '@incantly/core';
import { wilson, type Rate } from './evals';
import { loadFilmEvalPrompts, type FilmEvalConcept, type FilmEvalPromptSet } from './film-eval-prompts';
import { generateFilm, sceneProbePlan, type FilmGenerationState } from './film';
import { filmReferenceModel } from './film-reference';
import { addUsage, NO_USAGE, type ModelClient, type ModelUsage } from './models';
import { isolatedProbe, probeSpecFor, type SceneProber } from './probe';
import { StubNarrator, type Narrator } from './tts';

/**
 * The film eval suite: the versioned film prompts, every concept at its
 * lengths, through whole-film generation. It reports first-attempt and
 * post-repair pass rates with 95% Wilson intervals, latency, tokens and
 * speech. Every complete film is re-validated and re-probed from scratch,
 * and the gate holds the line the figures hold: zero broken films shown —
 * a failing film blocks, never ships silently.
 */

export interface FilmEvalOptions {
  readonly model?: ModelClient;
  readonly narrator?: Narrator;
  readonly prompts?: FilmEvalPromptSet;
  /** Trials for each concept at each of its lengths. */
  readonly trialsPerConcept?: number;
  readonly concepts?: readonly string[];
  readonly lengths?: readonly number[];
  readonly probe?: SceneProber | null;
  readonly concurrency?: number;
  readonly maxRepairs?: number;
  readonly onTrial?: (trial: FilmTrialResult, done: number, total: number) => void;
}

export interface FilmTrialResult {
  readonly index: number;
  readonly concept: string;
  readonly length: number;
  readonly phrasing: number;
  readonly prompt: string;
  /** Complete with no scene repaired. */
  readonly firstAttempt: boolean;
  readonly passed: boolean;
  readonly scenes: number;
  readonly repairs: number;
  /** Where it failed: the generation's failure, or the re-check that broke it. */
  readonly failure: string | null;
  /** The storyboard matches what the eval set expects at this length. */
  readonly expectations: readonly string[];
  /** A complete film that fails an independent re-check: must never happen. */
  readonly broken: boolean;
  readonly ms: number;
  readonly firstSceneMs: number | null;
  readonly usage: ModelUsage;
  readonly cost: number;
  readonly speechChars: number;
  readonly speechUsd: number;
}

export interface FilmGroupSummary {
  readonly firstAttempt: Rate;
  readonly postRepair: Rate;
}

export interface FilmEvalSummary {
  readonly promptsVersion: number;
  readonly model: string;
  readonly trials: number;
  readonly firstAttempt: Rate;
  readonly postRepair: Rate;
  readonly byConcept: Readonly<Record<string, FilmGroupSummary>>;
  readonly byLength: Readonly<Record<string, FilmGroupSummary>>;
  readonly expectations: Rate;
  readonly brokenShown: number;
  /** Failures of complete-or-not films, by where they failed. */
  readonly failures: Readonly<Record<string, number>>;
  readonly latencyMs: Latency;
  readonly firstSceneMs: Latency;
  readonly repairs: number;
  readonly repairRate: number;
  readonly tokens: ModelUsage & { readonly perTrial: number };
  readonly speechChars: number;
  readonly speechUsd: number;
  readonly cost: number;
  /** The film gate: no broken film shown. */
  readonly gate: {
    readonly noBrokenFilms: boolean;
  };
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

interface PlannedFilm {
  readonly index: number;
  readonly concept: FilmEvalConcept;
  readonly length: number;
  readonly phrasing: number;
}

/** The trials: for each concept, each of its lengths, its phrasings in turn. */
export function planFilmTrials(
  prompts: FilmEvalPromptSet,
  options: { trialsPerConcept: number; concepts?: readonly string[]; lengths?: readonly number[] },
): PlannedFilm[] {
  const out: PlannedFilm[] = [];
  for (const concept of prompts.concepts) {
    if (options.concepts && !options.concepts.includes(concept.id)) continue;
    for (const length of concept.lengths) {
      if (options.lengths && !options.lengths.includes(length)) continue;
      for (let i = 0; i < options.trialsPerConcept; i++) {
        out.push({ index: out.length, concept, length, phrasing: i % concept.phrasings.length });
      }
    }
  }
  return out;
}

/** What the storyboard should hold at this length: the preset's scene count and the shared context past one scene. */
export function checkFilmExpectations(storyboard: StoryboardSpec | null, length: number): string[] {
  if (!storyboard) return ['no storyboard'];
  const problems: string[] = [];
  const preset = filmPresetFor(length);
  if (storyboard.film.title.trim() === '') problems.push('no title');
  if (storyboard.scenes.length !== preset.scenes) problems.push(`a ${preset.seconds} s film holds ${preset.scenes} scenes, not ${storyboard.scenes.length}`);
  if (storyboard.scenes.length > 1 && !storyboard.film.context) problems.push('no shared context for several scenes');
  return problems;
}

/** A complete film, re-validated and re-probed from scratch, scene by scene. Null when it holds; the breakage when it does not. */
export async function recheckFilm(state: FilmGenerationState, probe: SceneProber | null): Promise<string | null> {
  const storyboard = state.storyboard;
  if (!storyboard) return 'no storyboard';
  for (const result of state.scenes) {
    const slice = storyboard.scenes.find((candidate) => candidate.id === result.sceneId);
    if (!result.ok || !result.fragments || !slice) return `scene ${result.sceneId}: ${result.failure ?? 'failed'}`;
    const { html, css, js } = result.fragments;
    const validation = validateScene({ html, css, js });
    if (!validation.ok || !validation.scene) return `scene ${result.sceneId}: no longer validates`;
    if (probe) {
      const report = await probe(validation.scene, probeSpecFor(sceneProbePlan(slice)));
      if (!report.ok) return `scene ${result.sceneId}: no longer probes`;
    }
  }
  return null;
}

/** A complete film that fails its re-check: shown, but broken. */
async function brokenWhenShown(state: FilmGenerationState, probe: SceneProber | null): Promise<string | null> {
  if (!state.film || state.fallback || state.partial) return null;
  return recheckFilm(state, probe);
}

export async function runFilmEvals(options: FilmEvalOptions = {}): Promise<{ readonly trials: readonly FilmTrialResult[]; readonly summary: FilmEvalSummary }> {
  const prompts = options.prompts ?? loadFilmEvalPrompts();
  const model = options.model ?? filmReferenceModel();
  const narrator = options.narrator ?? new StubNarrator();
  const probe = options.probe === undefined ? isolatedProbe : options.probe;
  const planned = planFilmTrials(prompts, {
    trialsPerConcept: options.trialsPerConcept ?? 2,
    ...(options.concepts ? { concepts: options.concepts } : {}),
    ...(options.lengths ? { lengths: options.lengths } : {}),
  });
  const results: FilmTrialResult[] = new Array<FilmTrialResult>(planned.length);
  let next = 0;
  let done = 0;

  const run = async (trial: PlannedFilm): Promise<FilmTrialResult> => {
    const prompt = trial.concept.phrasings[trial.phrasing]!;
    const state = await generateFilm(
      { prompt, lengthTarget: trial.length },
      { model, narrator, probe, ...(options.maxRepairs !== undefined ? { maxRepairs: options.maxRepairs } : {}) },
    );
    const complete = state.film !== null && state.fallback === null && !state.partial;
    const breakage = await brokenWhenShown(state, probe);
    const broken = breakage !== null;
    const repairs = state.scenes.reduce((sum, scene) => sum + scene.repairsUsed, 0);
    return {
      index: trial.index,
      concept: trial.concept.id,
      length: trial.length,
      phrasing: trial.phrasing,
      prompt,
      firstAttempt: complete && repairs === 0 && !broken,
      passed: complete && !broken,
      scenes: state.scenes.length,
      repairs,
      failure: complete ? breakage : (state.failure ?? 'film'),
      expectations: checkFilmExpectations(state.storyboard, trial.length),
      broken,
      ms: state.timings.totalMs,
      firstSceneMs: state.timings.firstSceneMs,
      usage: state.usage,
      cost: state.cost + state.speechUsd,
      speechChars: state.speechChars,
      speechUsd: state.speechUsd,
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
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 2) }, worker));
  return { trials: results, summary: summarizeFilmEvals(results, prompts.version, model.name) };
}

export function summarizeFilmEvals(trials: readonly FilmTrialResult[], promptsVersion: number, model: string): FilmEvalSummary {
  const group = (list: readonly FilmTrialResult[]): FilmGroupSummary => ({
    firstAttempt: wilson(list.filter((t) => t.firstAttempt).length, list.length),
    postRepair: wilson(list.filter((t) => t.passed).length, list.length),
  });
  const by = (key: (t: FilmTrialResult) => string) => {
    const groups: Record<string, FilmTrialResult[]> = {};
    for (const trial of trials) (groups[key(trial)] ??= []).push(trial);
    return Object.fromEntries(Object.entries(groups).map(([k, list]) => [k, group(list)]));
  };
  const failures: Record<string, number> = {};
  for (const trial of trials) if (trial.failure) failures[trial.failure] = (failures[trial.failure] ?? 0) + 1;
  const usage = trials.reduce((sum, t) => addUsage(sum, t.usage), NO_USAGE);
  const overall = group(trials);
  const brokenShown = trials.filter((t) => t.broken).length;
  const repairs = trials.reduce((sum, t) => sum + t.repairs, 0);
  const scenes = trials.reduce((sum, t) => sum + t.scenes, 0);
  return {
    promptsVersion,
    model,
    trials: trials.length,
    ...overall,
    byConcept: by((t) => t.concept),
    byLength: by((t) => `${t.length}s`),
    expectations: wilson(trials.filter((t) => t.expectations.length === 0).length, trials.length),
    brokenShown,
    failures,
    latencyMs: latency(trials.map((t) => t.ms)),
    firstSceneMs: latency(trials.flatMap((t) => (t.firstSceneMs === null ? [] : [t.firstSceneMs]))),
    repairs,
    repairRate: scenes === 0 ? 0 : Math.round((repairs / scenes) * 10000) / 10000,
    tokens: { ...usage, perTrial: trials.length ? Math.round((usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens) / trials.length) : 0 },
    speechChars: trials.reduce((sum, t) => sum + t.speechChars, 0),
    speechUsd: Math.round(trials.reduce((sum, t) => sum + t.speechUsd, 0) * 10000) / 10000,
    cost: Math.round(trials.reduce((sum, t) => sum + t.cost, 0) * 10000) / 10000,
    gate: {
      noBrokenFilms: brokenShown === 0,
    },
  };
}

const percent = (x: number) => `${(x * 100).toFixed(1)}%`;
const rate = (r: Rate) => `${percent(r.rate)} (95% CI ${percent(r.low)} to ${percent(r.high)}; ${r.passed} of ${r.total})`;

/** The summary as Markdown, for the eval results folder and pull requests. */
export function filmSummaryMarkdown(summary: FilmEvalSummary): string {
  const lines = [
    `# Film evals: ${summary.model}, prompts v${summary.promptsVersion}`,
    '',
    `${summary.trials} trials.`,
    '',
    '| Measure | Result | Gate |',
    '| --- | --- | --- |',
    `| First attempt | ${rate(summary.firstAttempt)} | reported |`,
    `| After repairs | ${rate(summary.postRepair)} | reported |`,
    `| Broken films shown | ${summary.brokenShown} | ${summary.gate.noBrokenFilms ? 'none' : 'FAILS'} |`,
    `| Storyboard matches the eval set | ${rate(summary.expectations)} | reported |`,
    '',
    '| Group | First attempt | After repairs |',
    '| --- | --- | --- |',
    ...Object.entries({ ...summary.byConcept, ...summary.byLength }).map(([name, g]) => `| ${name} | ${rate(g.firstAttempt)} | ${rate(g.postRepair)} |`),
    '',
    `Latency: p50 ${summary.latencyMs.p50} ms, p95 ${summary.latencyMs.p95} ms, max ${summary.latencyMs.max} ms. First scene p50 ${summary.firstSceneMs.p50} ms.`,
    '',
    `Repairs: ${summary.repairs} across ${summary.trials} trials (${percent(summary.repairRate)} of scenes).`,
    '',
    `Tokens: ${summary.tokens.inputTokens} input, ${summary.tokens.cacheReadTokens} cache reads, ${summary.tokens.cacheWriteTokens} cache writes, ${summary.tokens.outputTokens} output; ${summary.tokens.perTrial} a trial. Speech: ${summary.speechChars} chars, $${summary.speechUsd.toFixed(4)}. Cost about $${summary.cost.toFixed(4)}.`,
    '',
    'Failures:',
    '',
    ...(Object.keys(summary.failures).length === 0 ? ['- none'] : Object.entries(summary.failures).sort((a, b) => b[1] - a[1]).map(([kind, n]) => `- ${kind}: ${n}`)),
    '',
  ];
  return lines.join('\n');
}
