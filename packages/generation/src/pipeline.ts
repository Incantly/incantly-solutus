import { KIT_OF, SCENE_LIMITS, SDK_VERSION, SIZE_BUDGETS, fixScene, validateScene, validateSceneCss, validateSceneHtml, validateSceneJs, type ProbeReport, type ScenePlan, type ValidatedScene } from '@incantly/core';
import type { ReferenceScene } from '@incantly/core/scenes';
import { changePrompt, libraryPrompt, planPrompt, scenePrompt, standardFigure, type LearnerRequest, type Prompt } from './context';
import { MARKER_LINE, applyFragmentEdits, parseEdits, withoutEditBlocks, type Edit } from './edits';
import { FRAGMENT_NAMES, FragmentStream, missingFragments, parsePlanReply, type FragmentName, type FragmentSet } from './fragments';
import { ModelError, NO_USAGE, addUsage, costOf, type CallPurpose, type ModelClient, type ModelUsage } from './models';
import { formatPlanProblems, validatePlan, type PlanProblem } from './plan';
import { probeSpecFor, type SceneProber } from './probe';
import type { ModelReply } from './models';
import { parseReport, probeReport, repairPrompt, validationReport, type RepairReport } from './report';
import { aboutScene, retrieveExample } from './retrieve';

/**
 * The generation pipeline (PRD 27.1):
 *
 *   plan -> validate plan (one re-plan) -> scene -> static validation -> probe
 *     fail -> structured report -> repair -> validation and probe again
 *     (up to three repairs of any failure, stopping early when a repair
 *     brings back the same failures, or more of them)
 *     -> approved, or failed (the caller falls back)
 *
 * The scene call either writes the scene whole, following the nearest
 * reviewed example, or, when a reviewed scene of the same concept exists,
 * asks only for edits to it (PRD 25.5), which is several times faster. When
 * the request itself plainly names a reviewed concept, that scene is adapted
 * at once, with the plan call running beside it only to confirm the concept.
 * Repairs are edits too. Everything runs against a deadline (three minutes
 * by default): a repair that would not finish in time is not started, and the
 * caller falls back to the reviewed figure.
 *
 * On the service the probe runs on the learner's device, so the service
 * stops at validation and repairs a failed device probe on request; evals run
 * the whole pipeline in process with the isolated probe.
 */

/** Enough for a plan of about 600 tokens and a scene of about 2,000, with room; a runaway reply stops here. */
export const DEFAULT_MAX_TOKENS: Readonly<Record<CallPurpose, number>> = { plan: 1500, scene: 5000, repair: 3000 };

/** A call retried after a max_tokens cut-off is never asked for more than this. */
export const MAX_REPLY_TOKENS = 16_000;

/**
 * The build's deadline: five minutes counting from the moment the build
 * begins, not from the request, so the plan call never eats the scene's time.
 */
export const DEFAULT_DEADLINE_MS = 300_000;
/** Time to keep in hand for validation, the probe and delivery after the last model call. */
export const DELIVERY_MS = 1_500;
/**
 * How long writing a prefix ahead usually takes: the scene call waits for it
 * no later than this long after it began. A write that began just before the
 * plan ended saves little more than this wait, so it is never waited out.
 */
export const WARM_MS = 1_000;
/** The plan's own deadline, counted from its first call; the build never waits past it. */
export const PLAN_DEADLINE_MS = 120_000;

export interface GeneratorOptions {
  readonly model: ModelClient;
  /** Probes each candidate. Without one, candidates stop at static validation. */
  readonly probe?: SceneProber | null;
  /** Automatic repairs per generation, of any kind; default three. A further one runs only while the repair before it made progress (RP-4). */
  readonly maxRepairs?: number;
  /** Re-plans after a rejected plan. */
  readonly replans?: number;
  /** Reviewed examples left out of the context, by id. */
  readonly withhold?: readonly string[];
  readonly examples?: Readonly<Record<string, ReferenceScene>>;
  readonly maxTokens?: Partial<Record<CallPurpose, number>>;
  /** Milliseconds from the start of a build to a checked scene; 0 for none. Default five minutes. */
  readonly deadlineMs?: number;
  /** Milliseconds from the first plan call to a plan; 0 for none. Default two minutes. */
  readonly planDeadlineMs?: number;
  /** Start from a reviewed scene of the same concept and ask only for edits. Default true. */
  readonly adapt?: boolean;
  /** Start adapting the reviewed scene a request names before its plan arrives. Default true; needs adapt. */
  readonly retrieve?: boolean;
  /**
   * Write the scene call's cached prefix while the plan is still streaming,
   * once the plan's head (concept, kind, capabilities and parameters) is in,
   * so the scene call reads it instead of waiting for it. Default true; a
   * model client without `warm` skips it.
   */
  readonly warm?: boolean;
  readonly now?: () => number;
}

export interface GenerationHooks {
  readonly onPlan?: (plan: ScenePlan) => void;
  /** Raw model text as it streams, for developer tooling and progress UIs. */
  readonly onText?: (purpose: CallPurpose, delta: string) => void;
  /** A fragment finished streaming, with whether it passed its own checks. */
  readonly onFragment?: (name: FragmentName, ok: boolean) => void;
  readonly onAttempt?: (attempt: Attempt) => void;
}

export interface CallRecord {
  readonly purpose: CallPurpose;
  readonly model: string;
  readonly usage: ModelUsage;
  readonly ms: number;
  /** Milliseconds to the first streamed text, when the model streamed. */
  readonly firstTextMs?: number;
  /** The output-token cap the call was made with. */
  readonly maxTokens?: number;
  error?: string;
  /** The reply was cut off at max_tokens and the call was retried (or gave up) with a larger budget. */
  truncated?: boolean;
}

export type FailedCheck = 'reply' | 'validation' | 'probe';

/**
 * Whether a repair moved on from the failure before it. Failing a different
 * check is progress; failing the same one is progress only with fewer
 * failures, or different ones. The same failures again, or more of them,
 * mean another repair would likely go round in circles.
 */
/**
 * A probe failure as a fault: its check and message with the numbers taken
 * out, so a text pushed further off the stage is the same fault, and a loop
 * that never ends is a different one from a property read of undefined.
 */
export function probeFaults(report: ProbeReport): string[] {
  return report.failures.map((f) => `${f.check}: ${f.message.replace(/-?\d[\d.,]*/g, '#')}`);
}

export function progressed(before: Attempt, after: Attempt): boolean {
  if (before.failed !== after.failed) return true;
  const was = [...(before.faults ?? [])].sort();
  const now = [...(after.faults ?? [])].sort();
  if (now.length !== was.length) return now.length < was.length;
  return now.some((fault, i) => fault !== was[i]);
}

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
  /** The failing checks or validator rules, one per failure, to tell whether a repair made progress. */
  readonly faults?: readonly string[];
  readonly scene: ValidatedScene | null;
  /** Certain fixes the validator applied to this candidate itself, with no model call. */
  readonly fixed?: readonly string[];
}

export type GenerationStatus = 'planning' | 'building' | 'validated' | 'approved' | 'failed';

export interface GenerationFailure {
  readonly stage: 'plan' | 'scene' | 'model';
  readonly reason: string;
}

/** The shortest repeat of a reply's end that a continuation is taken to have restated. */
const MIN_OVERLAP = 24;
/** How much of a continuation's start is held back to look for that repeat. */
const OVERLAP_WINDOW = 400;

/**
 * Streams the rest of a reply cut off at max_tokens. Asked to go on from the
 * exact character, a model sometimes restates the last stretch first: the
 * start of the continuation is held until that repeat can be dropped, then
 * everything streams on as it comes.
 */
export class Continuation {
  private held = '';
  private decided = false;
  private kept = '';

  constructor(
    private readonly before: string,
    private readonly emit?: (text: string) => void,
  ) {}

  push(delta: string): void {
    if (this.decided) {
      this.kept += delta;
      this.emit?.(delta);
      return;
    }
    this.held += delta;
    if (this.held.length >= OVERLAP_WINDOW) this.decide();
  }

  /** The continuation with any repeat dropped; `whole` is the full reply text, for a model that did not stream it. */
  end(whole: string): string {
    if (!this.decided && this.held === '' && this.kept === '' && whole !== '') this.held = whole;
    if (!this.decided) this.decide();
    return this.kept;
  }

  private decide(): void {
    this.decided = true;
    const repeat = overlap(this.before, this.held);
    const rest = this.held.slice(repeat);
    this.held = '';
    this.kept += rest;
    if (rest) this.emit?.(rest);
  }
}

/** How many characters at the start of `after` repeat the end of `before`; 0 below MIN_OVERLAP. */
export function overlap(before: string, after: string): number {
  for (let k = Math.min(before.length, after.length, OVERLAP_WINDOW); k >= MIN_OVERLAP; k--) {
    if (before.endsWith(after.slice(0, k))) return k;
  }
  return 0;
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
  /** When the build began; the deadline counts from here, not from the request. */
  buildStartedAt: number | null = null;
  /** A deadline cut a call off: the service reports that as `timeout`, not a plain model error. */
  deadlineHit = false;
  readonly timings: { planMs?: number; firstFragmentMs?: number; sceneMs?: number; repairMs: number; totalMs?: number } = { repairMs: 0 };
  /**
   * How the scene was made: written whole, adapted from a reviewed scene by
   * edits, brought from a note to be repaired, or changed as the learner asks.
   */
  mode: 'write' | 'adapt' | 'stored' | 'change' | null = null;
  /** The reviewed scene the request named, adapted before the plan arrived; null otherwise. */
  retrieved: string | null = null;
  /** A repair that was due but would not have finished before the deadline. */
  deadlineSkipped = false;
  /** The scene prefix written while the plan streamed: its model and what it cost. Not a call: it writes no reply. */
  warmed: { readonly model: string; readonly usage: ModelUsage } | null = null;
  /** That write while it runs, and when it began: the scene call waits a moment for it rather than write the same prefix beside it. */
  warming: { readonly done: Promise<void>; readonly at: number } | null = null;
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
    return this.calls.reduce((sum, call) => addUsage(sum, call.usage), this.warmed?.usage ?? NO_USAGE);
  }

  get cost(): number {
    return this.calls.reduce((sum, call) => sum + costOf(call.model, call.usage), this.warmed ? costOf(this.warmed.model, this.warmed.usage) : 0);
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
    this.maxRepairs = Math.max(0, options.maxRepairs ?? 3);
    this.replans = Math.max(0, options.replans ?? 1);
    this.now = options.now ?? (() => Date.now());
  }

  /** The whole pipeline, in process. */
  async generate(request: LearnerRequest, hooks: GenerationHooks = {}, signal?: AbortSignal): Promise<GenerationState> {
    const state = this.begin();
    await this.run(state, request, hooks, signal);
    return this.finish(state);
  }

  /**
   * Plans and builds. A request that plainly names a reviewed concept is
   * built from that scene at once, while the plan call confirms the concept.
   */
  async run(state: GenerationState, request: LearnerRequest, hooks: GenerationHooks = {}, signal?: AbortSignal): Promise<void> {
    const retrieved =
      this.options.adapt === false || this.options.retrieve === false
        ? null
        : retrieveExample(request, {
            ...(this.options.withhold ? { withhold: this.options.withhold } : {}),
            ...(this.options.examples ? { examples: this.options.examples } : {}),
          });
    if (retrieved) {
      await this.libraryStage(state, retrieved, request, hooks, signal);
      return;
    }
    await this.planStage(state, request, hooks, signal);
    if (state.plan) await this.buildStage(state, hooks, signal);
  }

  /**
   * The library path (PRD 25.5): the reviewed scene the request names is
   * adapted to the request at once, and its plan is the skeleton the learner
   * sees straight away. The plan call runs beside the build only to confirm
   * the concept, which it does as soon as its concept and idea have streamed
   * in; if it names another one, the build stops and the pipeline goes on
   * from that plan as usual, having lost no time. Once the build is in, a
   * plan still writing is stopped: the learner never waits for its last
   * words.
   */
  private async libraryStage(state: GenerationState, scene: ReferenceScene, request: LearnerRequest, hooks: GenerationHooks, signal?: AbortSignal): Promise<void> {
    state.status = 'building';
    state.buildStartedAt ??= this.now();
    state.mode = 'adapt';
    state.example = scene.id;
    state.retrieved = scene.id;
    state.plan = scene.plan;
    hooks.onPlan?.(scene.plan);
    state.timings.firstFragmentMs ??= this.now() - state.startedAt;
    hooks.onFragment?.('html', true);
    hooks.onFragment?.('css', true);
    const started = this.now();
    const stop = new AbortController();
    const buildSignal = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
    const maxTokens = Math.min(this.options.maxTokens?.scene ?? SIZE_BUDGETS[scene.plan.size ?? 'quick'].sceneTokens, 2500);
    const building = this.call(state, 'scene', libraryPrompt(scene, request), this.deadlineSignal(state, buildSignal), this.streamed(hooks, 'scene'), maxTokens);
    const beside = this.planBeside(request, scene, hooks, signal);
    if (!(await beside.verdict)) {
      // Another concept: stop the build, which was ours to stop, and go on from the plan as usual.
      stop.abort();
      await building;
      const check = await beside.finished;
      state.calls.push(...check.state.calls);
      state.timings.planMs = check.plan ? check.state.timings.planMs : check.verdictMs;
      state.failure = null;
      state.status = 'planning';
      state.mode = null;
      state.example = null;
      state.retrieved = null;
      state.plan = null;
      if (check.plan) {
        state.plan = check.plan;
        hooks.onPlan?.(check.plan);
      } else {
        await this.planStage(state, request, hooks, signal);
      }
      if (state.plan) await this.buildStage(state, hooks, signal);
      return;
    }
    // Confirmed. Once the build is in, a plan still writing is stopped.
    const first = await Promise.race([building.then(() => 'build' as const), beside.finished.then(() => 'plan' as const)]);
    if (first === 'build') beside.stop();
    const check = await beside.finished;
    state.calls.push(...check.state.calls);
    state.timings.planMs = check.plan ? check.state.timings.planMs : check.verdictMs;
    const reply = await building;
    if (reply === null) return;
    return this.finishLibrary(state, scene, reply, started, hooks, signal);
  }

  /** Checks a library reply: its edits over the reviewed scene, and any plan it brings. */
  private async finishLibrary(state: GenerationState, scene: ReferenceScene, reply: string, started: number, hooks: GenerationHooks, signal?: AbortSignal): Promise<void> {
    // The build's own time: it often ends before the plan call that confirms it, which the learner waits for too.
    const build = [...state.calls].reverse().find((c) => c.purpose === 'scene' && !c.error);
    state.timings.sceneMs = build ? build.ms : this.now() - started;
    await this.applyEdits(state, { html: scene.html, css: scene.css, js: scene.js }, reply, hooks, signal);
  }

  /**
   * A reply of edits over `base`, with an updated plan in a json block when
   * the request needed other names or steps: checked, then repaired while
   * allowed. `unchanged` decides what a reply that changes nothing means: by
   * default it is checked like any other.
   */
  private async applyEdits(state: GenerationState, base: FragmentSet, reply: string, hooks: GenerationHooks, signal?: AbortSignal, unchanged?: () => boolean): Promise<void> {
    const json = /```json\s*\n[\s\S]*?\n\s*```/i.exec(reply);
    const problems: string[] = [];
    let planChanged = false;
    if (json) {
      const parsed = parsePlanReply(json[0]);
      const validation = parsed.problem ? null : validatePlan(parsed.value);
      if (validation?.plan) {
        planChanged = JSON.stringify(validation.plan) !== JSON.stringify(state.plan);
        state.plan = validation.plan;
      } else problems.push(`The updated plan was not accepted: ${parsed.problem ?? formatPlanProblems(validation?.problems ?? [])}`);
    }
    const edited = this.edited(base, json ? reply.replace(json[0], '') : reply);
    if (unchanged && edited.changed.length === 0 && !planChanged && edited.problems.length === 0 && problems.length === 0 && unchanged()) return;
    hooks.onFragment?.('js', edited.problems.length === 0 && edited.fragments.js !== undefined && fragmentPasses('js', edited.fragments.js));
    const attempt = await this.check(state, 'scene', edited.fragments, missingFragments(edited.fragments), [...edited.problems, ...problems], edited.changed);
    hooks.onAttempt?.(attempt);
    await this.repairWhileAllowed(state, hooks, signal);
  }

  /**
   * Changes a figure the learner has, as they ask (HO-8): one call for edits
   * over its fragments, from the plan and fragments a ticket signed, checked
   * and repaired like any scene. A reply that changes nothing fails as
   * 'unchanged', so the learner hears that the change could not be made.
   */
  async change(state: GenerationState, figure: { readonly plan: ScenePlan; readonly fragments: Required<FragmentSet> }, request: LearnerRequest, hooks: GenerationHooks = {}, signal?: AbortSignal): Promise<void> {
    state.plan = figure.plan;
    state.mode = 'change';
    state.status = 'building';
    state.buildStartedAt ??= this.now();
    const started = this.now();
    const maxTokens = Math.min(this.options.maxTokens?.scene ?? SIZE_BUDGETS[figure.plan.size ?? 'quick'].sceneTokens, 2500);
    const reply = await this.call(state, 'scene', changePrompt(figure.plan, figure.fragments, request), this.deadlineSignal(state, signal), this.streamed(hooks, 'scene'), maxTokens);
    if (reply === null) return;
    state.timings.sceneMs = this.now() - started;
    await this.applyEdits(state, { ...figure.fragments }, reply, hooks, signal, () => {
      this.fail(state, 'scene', 'unchanged');
      return true;
    });
  }

  /**
   * One plan call beside the library build. Its concept and idea confirm the
   * retrieval, or name another concept, as soon as both have streamed in
   * (they come first in the plan format), or else when the call ends.
   */
  private planBeside(request: LearnerRequest, scene: ReferenceScene, hooks: GenerationHooks, signal?: AbortSignal): PlanBeside {
    const check = this.begin();
    const started = this.now();
    const stop = new AbortController();
    const planSignal = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
    // The plan's concept decides, not its idea: an idea may mention the reviewed concept as a part of another,
    // as a plan of Euler's formula says its helix looks like a sine wave side-on, and that is not a sine wave figure.
    const judge = (concept: string | null, idea: string): boolean =>
      concept === null ||
      standardFigure(concept, { [scene.id]: scene }) !== null ||
      aboutScene(concept.trim() === '' ? idea : concept, scene.id, {
        ...(this.options.withhold ? { withhold: this.options.withhold } : {}),
        ...(this.options.examples ? { examples: this.options.examples } : {}),
      });
    let verdictMs: number | null = null;
    let settle: (confirmed: boolean) => void = () => {};
    const verdict = new Promise<boolean>((resolve) => {
      settle = (confirmed) => {
        if (verdictMs !== null) return;
        verdictMs = this.now() - started;
        resolve(confirmed);
      };
    });
    let streamed = '';
    const onText = (delta: string) => {
      if (verdictMs !== null) return;
      streamed += delta;
      const early = conceptAndIdea(streamed);
      if (early) settle(judge(early.concept, early.idea));
    };
    const finished = this.call(check, 'plan', planPrompt(request), this.planDeadlineSignal(planSignal), this.streamed(hooks, 'plan', onText)).then((reply) => {
      // Without a plan to say otherwise, the request's own words stand.
      if (reply === null) {
        settle(true);
        return { plan: null, state: check, verdictMs: verdictMs ?? this.now() - started };
      }
      const parsed = parsePlanReply(reply);
      const value = parsed.value as { concept?: unknown; idea?: unknown } | null;
      const plan = parsed.problem ? null : validatePlan(parsed.value).plan;
      if (plan) check.timings.planMs = this.now() - started;
      settle(judge(typeof value?.concept === 'string' ? value.concept : null, typeof value?.idea === 'string' ? value.idea : ''));
      return { plan, state: check, verdictMs: verdictMs ?? this.now() - started };
    });
    return { verdict, finished, stop: () => stop.abort() };
  }

  begin(): GenerationState {
    return new GenerationState(newGenerationId(), this.now());
  }

  /** Plans, re-planning once with the problems when the plan is rejected. */
  async planStage(state: GenerationState, request: LearnerRequest, hooks: GenerationHooks = {}, signal?: AbortSignal): Promise<void> {
    const started = this.now();
    let replan: { previous: string; problems: string } | undefined;
    for (let attempt = 0; attempt <= this.replans; attempt++) {
      const warm = attempt === 0 ? this.warmer(state, signal) : undefined;
      const reply = await this.call(state, 'plan', planPrompt(request, replan), this.planDeadlineSignal(signal), this.streamed(hooks, 'plan', warm));
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

  /**
   * Watches the plan as it streams and, once its head is in, writes the
   * scene call's cached prefix (PRD 25.1): the scene call then starts on a
   * warm cache instead of writing ten thousand tokens of contract and example
   * first. It runs beside the plan, writes no reply, and its failure costs
   * nothing but the time it would have saved.
   */
  private warmer(state: GenerationState, signal?: AbortSignal): ((text: string) => void) | undefined {
    const model = this.options.model;
    if (this.options.warm === false || !model.warm) return undefined;
    let streamed = '';
    let sent = false;
    return (delta) => {
      if (sent) return;
      streamed += delta;
      const head = planHead(streamed);
      if (!head) return;
      sent = true;
      const { prompt } = scenePrompt(head, {
        ...(this.options.withhold ? { withhold: this.options.withhold } : {}),
        ...(this.options.examples ? { examples: this.options.examples } : {}),
        ...(this.options.adapt === false ? { adapt: false } : {}),
      });
      const at = this.now();
      const done = model.warm!({ purpose: 'scene', prompt, ...(signal ? { signal } : {}) }).then(
        (usage) => {
          state.warmed = { model: model.modelFor('scene'), usage };
        },
        () => {
          // A prefix not written ahead is written by the scene call itself, as before.
        },
      );
      state.warming = { done, at };
    };
  }

  /** The scene call and its checks, then repairs while the budget and the deadline allow. */
  async buildStage(state: GenerationState, hooks: GenerationHooks = {}, signal?: AbortSignal): Promise<void> {
    const plan = state.plan;
    if (!plan) throw new Error('Plan first');
    state.status = 'building';
    state.buildStartedAt ??= this.now();
    const started = this.now();
    const { prompt, example, mode, start } = scenePrompt(plan, {
      ...(this.options.withhold ? { withhold: this.options.withhold } : {}),
      ...(this.options.examples ? { examples: this.options.examples } : {}),
      ...(this.options.adapt === false ? { adapt: false } : {}),
    });
    state.example = example;
    state.mode = mode;
    const maxTokens = this.options.maxTokens?.scene ?? SIZE_BUDGETS[plan.size ?? 'quick'].sceneTokens;
    // A prefix still being written ahead may be nearly done: a scene call sent beside it would write it again and
    // start no sooner. It is waited for only until its usual length has passed since it began.
    const wait = state.warming ? state.warming.at + WARM_MS - this.now() : 0;
    if (state.warming && wait > 0) await Promise.race([state.warming.done, new Promise((resolve) => setTimeout(resolve, wait))]);
    if (mode === 'adapt' && start) {
      // The starting scene's markup is known now: the host can lay it out before the edits arrive.
      state.timings.firstFragmentMs ??= this.now() - state.startedAt;
      hooks.onFragment?.('html', true);
      hooks.onFragment?.('css', true);
      const reply = await this.call(state, 'scene', prompt, this.deadlineSignal(state, signal), this.streamed(hooks, 'scene'), Math.min(maxTokens, 2500));
      if (reply === null) return;
      state.timings.sceneMs = this.now() - started;
      const base: FragmentSet = { html: start.html, css: start.css, js: start.js };
      const { fragments, problems, changed } = this.edited(base, reply);
      hooks.onFragment?.('js', problems.length === 0 && fragments.js !== undefined && fragmentPasses('js', fragments.js));
      const attempt = await this.check(state, 'scene', fragments, [...missingFragments(fragments)], problems, changed);
      hooks.onAttempt?.(attempt);
    } else {
      const stream = new FragmentStream((name, source) => {
        state.timings.firstFragmentMs ??= this.now() - state.startedAt;
        hooks.onFragment?.(name, fragmentPasses(name, source));
      });
      const reply = await this.call(state, 'scene', prompt, this.deadlineSignal(state, signal), this.streamed(hooks, 'scene', (text) => stream.push(text)), maxTokens, () => stream.reset());
      if (reply === null) return;
      const parsed = stream.end();
      state.timings.sceneMs = this.now() - started;
      const attempt = await this.check(state, 'scene', parsed.fragments, [...missingFragments(parsed.fragments)], parsed.problems, Object.keys(parsed.fragments) as FragmentName[]);
      hooks.onAttempt?.(attempt);
    }
    await this.repairWhileAllowed(state, hooks, signal);
  }

  /**
   * A reply of edits and whole fragments, applied over `base`. Two shapes of
   * reply are read for what they are, not as whole fragments that would
   * overwrite the scene: SEARCH/REPLACE edits sent under a plain fence, and a
   * script block that is only a piece of the script.
   */
  private edited(base: FragmentSet, reply: string): { fragments: FragmentSet; problems: string[]; changed: FragmentName[] } {
    const parsedEdits = parseEdits(reply);
    const stream = new FragmentStream();
    stream.push(withoutEditBlocks(reply));
    const whole = stream.end();
    const wholeFragments: Partial<Record<FragmentName, string>> = { ...whole.fragments };
    const edits: Partial<Record<FragmentName, Edit[]>> = { ...parsedEdits.edits };
    const extra: string[] = [];
    let found = parsedEdits.found;
    for (const name of FRAGMENT_NAMES) {
      const text = wholeFragments[name];
      if (text === undefined) continue;
      // Edits sent under a plain ```js fence: read them as edits to that fragment.
      if (EDIT_MARKER.test(text)) {
        const fenced = parseEdits(`\`\`\`edit ${name}\n${text}\`\`\``);
        edits[name] = [...(edits[name] ?? []), ...(fenced.edits[name] ?? [])];
        extra.push(...fenced.problems);
        found = true;
        delete wholeFragments[name];
      }
    }
    // A script block that sets up no stage, over a script that does, is a piece of the script, not all of it.
    const js = wholeFragments.js;
    if (js !== undefined && base.js !== undefined && STAGE_CALL.test(base.js) && !STAGE_CALL.test(js)) {
      extra.push('The js block held only part of the script (it sets up no stage), so it was not used. Send the lines you change as a SEARCH/REPLACE edit in an ```edit js block, or the whole script.');
      delete wholeFragments.js;
    }
    const applied = applyFragmentEdits(base, edits);
    const merged: FragmentSet = { ...applied.fragments, ...wholeFragments };
    // Edit markers left in a fragment would reach the script as code: keep the fragment as it was and say why.
    const fragments: FragmentSet = { ...merged };
    for (const name of FRAGMENT_NAMES) {
      if (merged[name] !== undefined && merged[name] !== base[name] && MARKER_LINE.test(merged[name]!)) {
        extra.push(`The ${name} fragment would have kept a SEARCH, ======= or REPLACE line as code, so the reply was not used for it. Send each change as one complete SEARCH/REPLACE pair.`);
        if (base[name] === undefined) delete fragments[name];
        else fragments[name] = base[name];
      }
    }
    // What actually differs from the base: a fragment returned unchanged is not a change.
    const changed = (['html', 'css', 'js'] as const).filter((name) => fragments[name] !== base[name]);
    const problems = [...parsedEdits.problems, ...whole.problems, ...extra, ...applied.failed.map((f) => `Edit failed: ${f}`)];
    if (!found && Object.keys(whole.fragments).length === 0) problems.push('The reply held no edit blocks and no fragments');
    return { fragments, problems, changed };
  }

  /** The remaining time before the build's deadline, in milliseconds; Infinity without one. */
  remainingMs(state: GenerationState): number {
    const deadline = this.options.deadlineMs ?? DEFAULT_DEADLINE_MS;
    const from = state.buildStartedAt ?? state.startedAt;
    return deadline > 0 ? deadline - (this.now() - from) : Number.POSITIVE_INFINITY;
  }

  /** The caller's signal, also aborted when the deadline passes; the abort marks the state as out of time. */
  private deadlineSignal(state: GenerationState, signal?: AbortSignal): AbortSignal | undefined {
    const remaining = this.remainingMs(state);
    if (!Number.isFinite(remaining)) return signal;
    const timeout = AbortSignal.timeout(Math.max(1, Math.floor(remaining - DELIVERY_MS)));
    timeout.addEventListener('abort', () => {
      state.deadlineHit = true;
    });
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  /** A plan's own signal: it never eats the build's deadline, and it runs no longer than the plan's budget. */
  private planDeadlineSignal(signal?: AbortSignal): AbortSignal | undefined {
    const deadline = this.options.planDeadlineMs ?? PLAN_DEADLINE_MS;
    if (deadline <= 0) return signal;
    const timeout = AbortSignal.timeout(deadline);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  /**
   * How long a repair is likely to take. It replies with edits, a few lines,
   * so it takes a fraction of the scene call: two benches measured 1 to 3.3 s
   * after scenes of 7 to 20 s. A repair that runs long is cut off at the
   * deadline anyway, so the estimate only spares a call that cannot finish.
   */
  private repairEstimateMs(state: GenerationState): number {
    const scene = state.calls.find((c) => c.purpose === 'scene' && !c.error);
    return Math.min(4_000, Math.max(2_000, (scene?.ms ?? 8_000) * 0.2)) + DELIVERY_MS;
  }

  /**
   * Takes up a figure approved before, from a learner's note, to repair it
   * after it hit a problem while live (RP-7). Its plan and fragments come
   * from a ticket the service signed. It is validated again: a scene the
   * current validator rejects is recorded as failing validation, so the
   * repair can fix that too.
   */
  adopt(state: GenerationState, figure: { readonly plan: ScenePlan; readonly fragments: Required<FragmentSet> }): Attempt {
    const plan = figure.plan;
    state.plan = plan;
    state.mode = 'stored';
    state.status = 'building';
    state.buildStartedAt ??= this.now();
    const limits = { ...SCENE_LIMITS, params: SIZE_BUDGETS[plan.size ?? 'quick'].controls };
    const validation = validateScene(figure.fragments, { limits });
    const fragments: FragmentSet = { ...figure.fragments };
    const attempt: Attempt =
      validation.ok && validation.scene
        ? { purpose: 'scene', fragments, changed: [], passed: true, failed: null, report: null, probe: null, scene: validation.scene }
        : { purpose: 'scene', fragments, changed: [], passed: false, failed: 'validation', report: validationReport(validation.diagnostics, fragments, 1, Math.max(this.maxRepairs, 1)), probe: null, scene: null };
    state.attempts.push(attempt);
    state.status = attempt.passed ? 'validated' : 'failed';
    if (!attempt.passed) state.failure = { stage: 'scene', reason: attempt.report!.summary };
    return attempt;
  }

  /** Whether another automatic repair may run (RP-4): within the budget, and only while the repairs make progress. */
  canRepair(state: GenerationState): boolean {
    const last = state.attempts.at(-1);
    if (!last || last.passed) return false;
    if (state.repairsUsed >= this.maxRepairs) return false;
    if (last.purpose !== 'repair') return true;
    // Identical output means nothing more to offer; the same failure again, or a worse one, means going round in circles.
    // A reply in the wrong shape changed nothing but was told the shape to use: the next repair may still fix the scene.
    const before = state.attempts.at(-2);
    return (last.changed.length > 0 || last.failed === 'reply') && (!before || progressed(before, last));
  }

  private async repairWhileAllowed(state: GenerationState, hooks: GenerationHooks, signal?: AbortSignal): Promise<void> {
    while (this.canRepair(state)) {
      if (this.remainingMs(state) < this.repairEstimateMs(state)) {
        // It would not finish in time: fall back now rather than make the learner wait past the deadline.
        state.deadlineSkipped = true;
        break;
      }
      if (!(await this.repair(state, state.current!.report!, hooks, signal))) break;
    }
    this.settle(state);
  }

  /**
   * Repairs a failure the learner's device reported, then whatever that
   * repair fails before it runs, while the budget and the progress allow.
   */
  async repairReported(state: GenerationState, report: RepairReport, hooks: GenerationHooks = {}, signal?: AbortSignal): Promise<void> {
    if (await this.repair(state, report, hooks, signal)) await this.repairWhileAllowed(state, hooks, signal);
    else this.settle(state);
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
    // A repair that must return a whole fragment the scene could not fit needs the scene's own budget.
    const reply = await this.call(state, 'repair', repairPrompt(report, current.fragments, plan), this.deadlineSignal(state, signal), this.streamed(hooks, 'repair'), SIZE_BUDGETS[plan.size ?? 'quick'].sceneTokens);
    state.timings.repairMs += this.now() - started;
    if (reply === null) return null;
    const { fragments: merged, problems, changed } = this.edited(current.fragments, reply);
    let attempt: Attempt;
    if (changed.length === 0 && problems.length === 0 && current.failed !== 'reply') {
      // The same fragments again: the failure stands, and there is nothing more to try (RP-4).
      // (After an unreadable reply, the same fragments in a readable one are worth checking.)
      attempt = { ...current, purpose: 'repair', changed: [] };
      state.attempts.push(attempt);
    } else {
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
    const repairReport = probeReport(report, current.fragments, plan, number, this.maxRepairs);
    state.attempts[state.attempts.length - 1] = { ...current, passed: false, failed: 'probe', report: repairReport, probe: report, faults: probeFaults(report) };
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
    const of = this.maxRepairs;
    let fixes: readonly string[] = [];
    const record = (attempt: Omit<Attempt, 'purpose' | 'fragments' | 'changed'>): Attempt => {
      const full: Attempt = { purpose, fragments, changed, ...attempt, ...(fixes.length > 0 ? { fixed: fixes } : {}) };
      state.attempts.push(full);
      return full;
    };
    if (missing.length > 0 || problems.length > 0) {
      return record({ passed: false, failed: 'reply', report: parseReport(problems, missing, number, of), probe: null, scene: null, faults: [...problems, ...missing] });
    }
    // The plan's size sets how many controls the scene may declare.
    const limits = { ...SCENE_LIMITS, params: SIZE_BUDGETS[plan.size ?? 'quick'].controls };
    // What the validator can fix for certain, it fixes, as a compiler applies its own suggestions; only the rest needs a repair.
    const fixed = fixScene({ html: fragments.html!, css: fragments.css!, js: fragments.js! }, { limits });
    const validation = fixed.validation;
    if (fixed.applied.length > 0) {
      fragments = { ...fragments, js: fixed.fragments.js };
      fixes = fixed.applied;
    }
    if (!validation.ok || !validation.scene) {
      const faults = validation.diagnostics.filter((d) => d.severity === 'error').map((d) => d.rule);
      return record({ passed: false, failed: 'validation', report: validationReport(validation.diagnostics, fragments, number, of), probe: null, scene: null, faults });
    }
    if (!this.options.probe) return record({ passed: true, failed: null, report: null, probe: null, scene: validation.scene });
    const report = await this.options.probe(validation.scene, probeSpecFor(plan));
    if (!report.ok) {
      return record({ passed: false, failed: 'probe', report: probeReport(report, fragments, plan, number, of), probe: report, scene: validation.scene, faults: probeFaults(report) });
    }
    return record({ passed: true, failed: null, report: null, probe: report, scene: validation.scene });
  }

  /** A call's streamed text for the onText hook, and for `also` when given; nothing to stream without either. */
  private streamed(hooks: GenerationHooks, purpose: CallPurpose, also?: (text: string) => void): ((text: string) => void) | undefined {
    const onText = hooks.onText;
    if (!onText) return also;
    return (text) => {
      also?.(text);
      onText(purpose, text);
    };
  }

  private async call(
    state: GenerationState,
    purpose: CallPurpose,
    prompt: Prompt,
    signal: AbortSignal | undefined,
    onText?: (text: string) => void,
    maxTokens?: number,
    /** Starts the reply's consumer over: a retried call re-streams from the top. */
    reset?: () => void,
  ): Promise<string | null> {
    const started = this.now();
    const budget = maxTokens ?? this.options.maxTokens?.[purpose] ?? DEFAULT_MAX_TOKENS[purpose];
    // A reply cut off at max_tokens is not a format error: it is a budget one.
    // The next call asks for the rest only, so the text already streamed
    // stands and the learner never waits for it twice. A call cut off before
    // it wrote anything (its thinking ate the cap) is asked again whole. Each
    // retry doubles the cap up to the hard ceiling.
    let sofar = '';
    for (let attempt = 0; ; attempt++) {
      const capped = attempt === 0 ? budget : Math.min(budget * 2 ** attempt, MAX_REPLY_TOKENS);
      const join = sofar ? new Continuation(sofar, onText) : null;
      const stream = join ? (text: string) => join.push(text) : onText;
      let reply: ModelReply;
      try {
        reply = await this.options.model.complete({
          purpose,
          prompt,
          maxTokens: capped,
          ...(signal ? { signal } : {}),
          ...(stream ? { onText: stream } : {}),
          ...(sofar ? { continueFrom: sofar } : {}),
        });
      } catch (error) {
        const reason = error instanceof ModelError ? `${error.kind}: ${error.message}` : error instanceof Error ? error.message : String(error);
        state.calls.push({ purpose, model: this.options.model.modelFor(purpose), usage: NO_USAGE, ms: this.now() - started, maxTokens: capped, error: reason });
        this.fail(state, 'model', reason);
        return null;
      }
      const text = join ? sofar + join.end(reply.text) : reply.text;
      if (reply.stopReason === 'max_tokens') {
        state.calls.push({ purpose, model: reply.model, usage: reply.usage, ms: reply.ms, ...firstText(reply), maxTokens: capped, truncated: true });
        if (capped >= MAX_REPLY_TOKENS) return text;
        if (text.trim() === '') reset?.();
        sofar = text;
        continue;
      }
      state.calls.push({ purpose, model: reply.model, usage: reply.usage, ms: reply.ms, ...firstText(reply), maxTokens: capped });
      return text;
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

/** A SEARCH marker line, as in an edit block. */
const EDIT_MARKER = /^\s*<{5,9}\s*SEARCH\s*$/m;
/** The call that sets up a scene's stage: a whole script has one. */
const STAGE_CALL = new RegExp(`\\binc\\.(?:${['svg', 'graph2d', ...Object.keys(KIT_OF)].join('|')})\\s*\\(`);

/** The plan call beside a library build. */
interface PlanBeside {
  /** Whether the plan names the retrieved scene's concept: as soon as its concept and idea are in, or at its end. */
  readonly verdict: Promise<boolean>;
  /** The call, ended or stopped: its plan, if it got that far, and when its verdict came. */
  readonly finished: Promise<{ readonly plan: ScenePlan | null; readonly state: GenerationState; readonly verdictMs: number }>;
  /** Stops the call: its plan is not needed any more. */
  stop(): void;
}

/**
 * The plan as far as the scene call's prefix needs it, once its head has
 * streamed in: everything before "model" (concept, idea, kind, size,
 * capabilities and parameters, in the plan format's order), checked as a
 * plan with the rest filled in. The prefix depends only on the head, so the
 * filler never reaches it. Null before the head is complete, or when it is
 * not a plan.
 */
export function planHead(text: string): ScenePlan | null {
  const open = text.indexOf('{');
  const model = /"model"\s*:\s*\{/.exec(text)?.index ?? -1;
  if (open < 0 || model < open) return null;
  let head: Record<string, unknown>;
  try {
    head = JSON.parse(`${text.slice(open, model).replace(/[\s,]+$/, '')}}`) as Record<string, unknown>;
  } catch {
    return null;
  }
  const names = (Array.isArray(head.parameters) ? head.parameters : []).flatMap((p) =>
    typeof p === 'object' && p !== null && typeof (p as { name?: unknown }).name === 'string' ? [(p as { name: string }).name] : [],
  );
  return validatePlan({
    ...head,
    model: { inputs: names, outputs: [{ name: 'value', dependsOn: names }] },
    parts: ['figure'],
    moves: 'It moves.',
    steps: ['Look.'],
    singularPoints: [],
  }).plan;
}

/** A plan's concept and idea as it streams in, once both strings are complete; null before. */
export function conceptAndIdea(text: string): { readonly concept: string; readonly idea: string } | null {
  const field = (name: string): string | null => {
    const match = new RegExp(`"${name}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(text);
    if (!match) return null;
    try {
      return JSON.parse(`"${match[1]!}"`) as string;
    } catch {
      return null;
    }
  };
  const concept = field('concept');
  const idea = concept === null ? null : field('idea');
  return concept !== null && idea !== null ? { concept, idea } : null;
}

function firstText(reply: ModelReply): { firstTextMs?: number } {
  return reply.firstTextMs !== undefined ? { firstTextMs: reply.firstTextMs } : {};
}

/** A streamed fragment's own checks; the whole scene is validated together once it is complete. */
function fragmentPasses(name: FragmentName, source: string): boolean {
  const diagnostics =
    name === 'html' ? validateSceneHtml(source).diagnostics : name === 'css' ? validateSceneCss(source).diagnostics : validateSceneJs(source).diagnostics;
  return !diagnostics.some((d) => d.severity === 'error');
}

export { standardFigure } from './context';
