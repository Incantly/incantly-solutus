import { SDK_VERSION, validateScene, validateSceneCss, validateSceneHtml, validateSceneJs, type ProbeReport, type ScenePlan, type ValidatedScene } from '@incantly/core';
import { REFERENCE_SCENES, type ReferenceScene } from '@incantly/core/scenes';
import { planPrompt, scenePrompt, type LearnerRequest, type Prompt } from './context';
import { FragmentStream, missingFragments, parsePlanReply, type FragmentName, type FragmentSet } from './fragments';
import { ModelError, NO_USAGE, addUsage, costOf, type CallPurpose, type ModelClient, type ModelUsage } from './models';
import { formatPlanProblems, validatePlan, type PlanProblem } from './plan';
import { probeSpecFor, type SceneProber } from './probe';
import { parseReport, probeReport, repairPrompt, validationReport, type RepairReport } from './report';

/**
 * The generation pipeline (PRD 27.1):
 *
 *   plan -> validate plan (one re-plan) -> scene -> static validation -> probe
 *     fail -> structured report -> one repair -> validation and probe again
 *     -> approved, or failed (the caller falls back)
 *
 * On the service the probe runs on the learner's device, so the service
 * stops at validation and repairs a failed device probe on request; evals run
 * the whole pipeline in process with the isolated probe.
 */

/** Enough for a plan of about 600 tokens and a scene of about 2,000, with room; a runaway reply stops here. */
export const DEFAULT_MAX_TOKENS: Readonly<Record<CallPurpose, number>> = { plan: 1500, scene: 5000, repair: 5000 };

export interface GeneratorOptions {
  readonly model: ModelClient;
  /** Probes each candidate. Without one, candidates stop at static validation. */
  readonly probe?: SceneProber | null;
  /** Automatic repairs per generation. v0.1 allows one; a further one runs only if the previous repair changed something (RP-4). */
  readonly maxRepairs?: number;
  /** Re-plans after a rejected plan. */
  readonly replans?: number;
  /** Reviewed examples left out of the context, by id. */
  readonly withhold?: readonly string[];
  readonly examples?: Readonly<Record<string, ReferenceScene>>;
  readonly maxTokens?: Partial<Record<CallPurpose, number>>;
  readonly now?: () => number;
}

export interface GenerationHooks {
  readonly onPlan?: (plan: ScenePlan) => void;
  /** A fragment finished streaming, with whether it passed its own checks. */
  readonly onFragment?: (name: FragmentName, ok: boolean) => void;
  readonly onAttempt?: (attempt: Attempt) => void;
}

export interface CallRecord {
  readonly purpose: CallPurpose;
  readonly model: string;
  readonly usage: ModelUsage;
  readonly ms: number;
  readonly error?: string;
}

export type FailedCheck = 'reply' | 'validation' | 'probe';

export interface Attempt {
  readonly purpose: 'scene' | 'repair';
  /** The complete candidate: for a repair, the changed fragments over the ones before. */
  readonly fragments: FragmentSet;
  /** Fragments the reply changed. */
  readonly changed: readonly FragmentName[];
  readonly passed: boolean;
  readonly failed: FailedCheck | null;
  readonly report: RepairReport | null;
  readonly probe: ProbeReport | null;
  readonly scene: ValidatedScene | null;
}

export type GenerationStatus = 'planning' | 'building' | 'validated' | 'approved' | 'failed';

export interface GenerationFailure {
  readonly stage: 'plan' | 'scene' | 'model';
  readonly reason: string;
}

let counter = 0;

export function newGenerationId(): string {
  const random = new Uint8Array(8);
  crypto.getRandomValues(random);
  counter = (counter + 1) % 0x10000;
  return `gen-${Date.now().toString(36)}-${[...random].map((b) => b.toString(16).padStart(2, '0')).join('')}${counter.toString(16)}`;
}

/** Everything one generation did, kept by the service between requests and written to failure records. */
export class GenerationState {
  status: GenerationStatus = 'planning';
  plan: ScenePlan | null = null;
  planProblems: readonly PlanProblem[] = [];
  example: string | null = null;
  readonly attempts: Attempt[] = [];
  readonly calls: CallRecord[] = [];
  repairsUsed = 0;
  failure: GenerationFailure | null = null;
  readonly timings: { planMs?: number; firstFragmentMs?: number; sceneMs?: number; repairMs: number; totalMs?: number } = { repairMs: 0 };
  readonly sdkVersion = SDK_VERSION;

  constructor(
    readonly id: string,
    readonly startedAt: number,
  ) {}

  get current(): Attempt | undefined {
    return this.attempts.at(-1);
  }

  /** The approved, or on the service the validated, scene. */
  get scene(): ValidatedScene | null {
    const current = this.current;
    return current?.passed ? current.scene : null;
  }

  get usage(): ModelUsage {
    return this.calls.reduce((sum, call) => addUsage(sum, call.usage), NO_USAGE);
  }

  get cost(): number {
    return this.calls.reduce((sum, call) => sum + costOf(call.model, call.usage), 0);
  }

  /** Passed on the first scene, without a repair. */
  get firstAttemptPassed(): boolean {
    return this.attempts[0]?.passed === true;
  }
}

export class Generator {
  private readonly maxRepairs: number;
  private readonly replans: number;
  private readonly now: () => number;

  constructor(private readonly options: GeneratorOptions) {
    this.maxRepairs = Math.max(0, options.maxRepairs ?? 1);
    this.replans = Math.max(0, options.replans ?? 1);
    this.now = options.now ?? (() => Date.now());
  }

  /** The whole pipeline, in process. */
  async generate(request: LearnerRequest, hooks: GenerationHooks = {}, signal?: AbortSignal): Promise<GenerationState> {
    const state = this.begin();
    await this.planStage(state, request, hooks, signal);
    if (state.plan) await this.buildStage(state, hooks, signal);
    return this.finish(state);
  }

  begin(): GenerationState {
    return new GenerationState(newGenerationId(), this.now());
  }

  /** Plans, re-planning once with the problems when the plan is rejected. */
  async planStage(state: GenerationState, request: LearnerRequest, hooks: GenerationHooks = {}, signal?: AbortSignal): Promise<void> {
    const started = this.now();
    let replan: { previous: string; problems: string } | undefined;
    for (let attempt = 0; attempt <= this.replans; attempt++) {
      const reply = await this.call(state, 'plan', planPrompt(request, replan), signal);
      if (reply === null) return;
      const parsed = parsePlanReply(reply);
      const validation = parsed.problem
        ? { ok: false, plan: null, problems: [{ rule: 'schema' as const, path: 'plan', message: parsed.problem }] }
        : validatePlan(parsed.value);
      state.planProblems = validation.problems;
      if (validation.plan) {
        state.plan = validation.plan;
        state.timings.planMs = this.now() - started;
        hooks.onPlan?.(validation.plan);
        return;
      }
      replan = { previous: reply.trim().slice(0, 4000), problems: formatPlanProblems(validation.problems) };
    }
    state.timings.planMs = this.now() - started;
    this.fail(state, 'plan', `The plan was rejected: ${state.planProblems.map((p) => p.rule).join(', ')}`);
  }

  /** The scene call and its checks, then repairs while the budget allows. */
  async buildStage(state: GenerationState, hooks: GenerationHooks = {}, signal?: AbortSignal): Promise<void> {
    const plan = state.plan;
    if (!plan) throw new Error('Plan first');
    state.status = 'building';
    const started = this.now();
    const { prompt, example } = scenePrompt(plan, {
      ...(this.options.withhold ? { withhold: this.options.withhold } : {}),
      ...(this.options.examples ? { examples: this.options.examples } : {}),
    });
    state.example = example;
    const stream = new FragmentStream((name, source) => {
      state.timings.firstFragmentMs ??= this.now() - state.startedAt;
      hooks.onFragment?.(name, fragmentPasses(name, source));
    });
    const reply = await this.call(state, 'scene', prompt, signal, (text) => stream.push(text));
    if (reply === null) return;
    const parsed = stream.end();
    state.timings.sceneMs = this.now() - started;
    const attempt = await this.check(state, 'scene', parsed.fragments, [...missingFragments(parsed.fragments)], parsed.problems, Object.keys(parsed.fragments) as FragmentName[]);
    hooks.onAttempt?.(attempt);
    await this.repairWhileAllowed(state, hooks, signal);
  }

  /** Whether another automatic repair may run (RP-4). */
  canRepair(state: GenerationState): boolean {
    if (state.repairsUsed >= this.maxRepairs) return false;
    const last = state.attempts.at(-1);
    if (!last || last.passed) return false;
    // A further repair only when the previous one changed something: identical output means nothing more to offer.
    return state.repairsUsed === 0 || (last.purpose === 'repair' && last.changed.length > 0);
  }

  private async repairWhileAllowed(state: GenerationState, hooks: GenerationHooks, signal?: AbortSignal): Promise<void> {
    while (this.canRepair(state) && state.status !== 'failed') {
      await this.repair(state, state.current!.report!, hooks, signal);
    }
    this.settle(state);
  }

  /**
   * Repairs the current candidate from a report: the service calls this with
   * a report built from the learner device's probe.
   */
  async repair(state: GenerationState, report: RepairReport, hooks: GenerationHooks = {}, signal?: AbortSignal): Promise<Attempt | null> {
    const plan = state.plan;
    const current = state.current;
    if (!plan || !current) throw new Error('Nothing to repair');
    state.repairsUsed++;
    const started = this.now();
    const reply = await this.call(state, 'repair', repairPrompt(report, current.fragments, plan), signal);
    state.timings.repairMs += this.now() - started;
    if (reply === null) return null;
    const parsed = new FragmentStream();
    parsed.push(reply);
    const { fragments: returned, problems } = parsed.end();
    const changed = (Object.keys(returned) as FragmentName[]).filter((name) => returned[name] !== current.fragments[name]);
    let attempt: Attempt;
    if (Object.keys(returned).length === 0) {
      attempt = await this.check(state, 'repair', current.fragments, [], [...problems, 'The reply contained no fenced blocks'], []);
    } else if (changed.length === 0) {
      // The same fragments again: the failure stands, and there is nothing more to try (RP-4).
      attempt = { ...current, purpose: 'repair', changed: [] };
      state.attempts.push(attempt);
    } else {
      const merged: FragmentSet = { ...current.fragments, ...returned };
      attempt = await this.check(state, 'repair', merged, missingFragments(merged), problems, changed);
    }
    hooks.onAttempt?.(attempt);
    return attempt;
  }

  /**
   * The learner's device probed the validated scene and it failed. Records
   * that against the current candidate and returns the report a repair sends.
   */
  deviceFailed(state: GenerationState, report: ProbeReport): RepairReport {
    const plan = state.plan;
    const current = state.current;
    if (!plan || !current || !current.passed) throw new Error('No validated scene to fail');
    const number = state.repairsUsed + 1;
    const repairReport = probeReport(report, current.fragments, plan, number, Math.max(this.maxRepairs, number));
    state.attempts[state.attempts.length - 1] = { ...current, passed: false, failed: 'probe', report: repairReport, probe: report };
    state.status = 'failed';
    state.failure = { stage: 'scene', reason: repairReport.summary };
    return repairReport;
  }

  /** The learner's device approved the validated scene. */
  deviceApproved(state: GenerationState, report: ProbeReport): void {
    const current = state.current;
    if (!current || !current.passed) throw new Error('No validated scene to approve');
    state.attempts[state.attempts.length - 1] = { ...current, probe: report };
    state.status = 'approved';
  }

  /** Runs the checks on a candidate and records the attempt. */
  private async check(
    state: GenerationState,
    purpose: Attempt['purpose'],
    fragments: FragmentSet,
    missing: readonly FragmentName[],
    problems: readonly string[],
    changed: readonly FragmentName[],
  ): Promise<Attempt> {
    const plan = state.plan!;
    const number = state.repairsUsed + 1;
    const of = Math.max(this.maxRepairs, number);
    const record = (attempt: Omit<Attempt, 'purpose' | 'fragments' | 'changed'>): Attempt => {
      const full: Attempt = { purpose, fragments, changed, ...attempt };
      state.attempts.push(full);
      return full;
    };
    if (missing.length > 0 || problems.length > 0) {
      return record({ passed: false, failed: 'reply', report: parseReport(problems, missing, number, of), probe: null, scene: null });
    }
    const validation = validateScene({ html: fragments.html!, css: fragments.css!, js: fragments.js! });
    if (!validation.ok || !validation.scene) {
      return record({ passed: false, failed: 'validation', report: validationReport(validation.diagnostics, fragments, number, of), probe: null, scene: null });
    }
    if (!this.options.probe) return record({ passed: true, failed: null, report: null, probe: null, scene: validation.scene });
    const report = await this.options.probe(validation.scene, probeSpecFor(plan));
    if (!report.ok) {
      return record({ passed: false, failed: 'probe', report: probeReport(report, fragments, plan, number, of), probe: report, scene: validation.scene });
    }
    return record({ passed: true, failed: null, report: null, probe: report, scene: validation.scene });
  }

  /** One model call, recorded; null when it failed (the generation is then failed). */
  private async call(
    state: GenerationState,
    purpose: CallPurpose,
    prompt: Prompt,
    signal: AbortSignal | undefined,
    onText?: (text: string) => void,
  ): Promise<string | null> {
    const started = this.now();
    try {
      const reply = await this.options.model.complete({
        purpose,
        prompt,
        maxTokens: this.options.maxTokens?.[purpose] ?? DEFAULT_MAX_TOKENS[purpose],
        ...(signal ? { signal } : {}),
        ...(onText ? { onText } : {}),
      });
      state.calls.push({ purpose, model: reply.model, usage: reply.usage, ms: reply.ms });
      return reply.text;
    } catch (error) {
      const reason = error instanceof ModelError ? `${error.kind}: ${error.message}` : error instanceof Error ? error.message : String(error);
      state.calls.push({ purpose, model: this.options.model.modelFor(purpose), usage: NO_USAGE, ms: this.now() - started, error: reason });
      this.fail(state, 'model', reason);
      return null;
    }
  }

  private fail(state: GenerationState, stage: GenerationFailure['stage'], reason: string): void {
    state.status = 'failed';
    state.failure = { stage, reason };
  }

  /** Sets the status from the last attempt. */
  settle(state: GenerationState): void {
    if (state.status === 'failed' && state.failure?.stage !== 'scene') return;
    const last = state.current;
    if (!last) return;
    if (last.passed) {
      state.status = this.options.probe ? 'approved' : 'validated';
      state.failure = null;
    } else {
      state.status = 'failed';
      state.failure = { stage: 'scene', reason: last.report?.summary ?? 'The scene failed its checks' };
    }
  }

  finish(state: GenerationState): GenerationState {
    state.timings.totalMs = this.now() - state.startedAt;
    return state;
  }
}

/** A streamed fragment's own checks; the whole scene is validated together once it is complete. */
function fragmentPasses(name: FragmentName, source: string): boolean {
  const diagnostics =
    name === 'html' ? validateSceneHtml(source).diagnostics : name === 'css' ? validateSceneCss(source).diagnostics : validateSceneJs(source).diagnostics;
  return !diagnostics.some((d) => d.severity === 'error');
}

// ---------------------------------------------------------------------------
// The reviewed standard figure (fallback level 2)
// ---------------------------------------------------------------------------

function conceptWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2)
      .map((w) => w.replace(/(es|s)$/, '')),
  );
}

/**
 * The reviewed figure for the same concept, if there is one: the second rung
 * of the fallback ladder (RP-9). Unlike the nearest example in the context, it
 * must be the same concept, not merely a similar scene.
 */
export function standardFigure(concept: string, examples: Readonly<Record<string, ReferenceScene>> = REFERENCE_SCENES): ReferenceScene | null {
  const wanted = conceptWords(concept);
  let best: ReferenceScene | null = null;
  let bestScore = 0;
  for (const example of Object.values(examples)) {
    const words = conceptWords(`${example.plan.concept} ${example.id.replace(/-/g, ' ')}`);
    let shared = 0;
    for (const w of wanted) if (words.has(w)) shared++;
    const score = wanted.size === 0 ? 0 : shared / Math.min(wanted.size, conceptWords(example.plan.concept).size);
    if (score > bestScore) {
      best = example;
      bestScore = score;
    }
  }
  return bestScore >= 0.5 ? best : null;
}
