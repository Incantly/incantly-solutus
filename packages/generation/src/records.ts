import { appendFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScenePlan } from '@incantly/core';
import type { FragmentSet } from './fragments';
import type { ModelUsage } from './models';
import type { GenerationState } from './pipeline';
import type { PlanProblem } from './plan';

/**
 * Failure records (RP-11, PRD 27.7). Every generation leaves one: the
 * concept, the plan, the fragments before and after any repair, the reports,
 * the SDK version and the outcome. They are the material for new SDK
 * functions, rules, examples and regression fixtures. They never hold the
 * learner's request or note text: those go to the model and nowhere else.
 */

export type Outcome = 'first-attempt' | 'repaired' | 'failed-plan' | 'failed-scene' | 'failed-model' | 'pending';

export interface ReportRecord {
  readonly kind: string;
  readonly check: string;
  readonly summary: string;
  readonly text: string;
}

export interface FailureRecord {
  readonly id: string;
  readonly at: string;
  readonly sdkVersion: string;
  readonly outcome: Outcome;
  /** Where the scene was probed: in process (evals) or on the learner's device. */
  readonly probedOn: 'process' | 'device' | 'none';
  readonly concept: string | null;
  readonly plan: ScenePlan | null;
  readonly planProblems: readonly PlanProblem[];
  /** The first scene, when it failed; null after a clean first attempt. */
  readonly before: FragmentSet | null;
  /** The last candidate, when a repair ran. */
  readonly after: FragmentSet | null;
  readonly reports: readonly ReportRecord[];
  readonly repairs: number;
  readonly example: string | null;
  readonly models: readonly string[];
  readonly usage: ModelUsage;
  readonly cost: number;
  readonly timings: GenerationState['timings'];
  readonly failure: string | null;
  /** How the scene was made: written whole, adapted by edits, or from the concept cache. */
  readonly mode: GenerationState['mode'];
  /** A repair was due but skipped because it would have ended after the deadline. */
  readonly deadlineSkipped: boolean;
  /** Lines of the agent's script in the last candidate (RM-4). */
  readonly lines: number | null;
}

export function outcomeOf(state: GenerationState): Outcome {
  if (state.failure?.stage === 'plan') return 'failed-plan';
  if (state.failure?.stage === 'model') return 'failed-model';
  if (state.status === 'failed') return 'failed-scene';
  if (state.status === 'approved') return state.firstAttemptPassed ? 'first-attempt' : 'repaired';
  return 'pending';
}

export function failureRecord(state: GenerationState, probedOn: FailureRecord['probedOn'], at: Date = new Date()): FailureRecord {
  const first = state.attempts[0];
  const last = state.attempts.at(-1);
  const failedFirst = first !== undefined && !first.passed;
  return {
    id: state.id,
    at: at.toISOString(),
    sdkVersion: state.sdkVersion,
    outcome: outcomeOf(state),
    probedOn,
    concept: state.plan?.concept ?? null,
    plan: state.plan,
    planProblems: state.planProblems,
    before: failedFirst ? first.fragments : null,
    after: state.attempts.length > 1 && last ? last.fragments : null,
    reports: state.attempts.flatMap((a) => (a.report ? [{ kind: a.report.kind, check: a.report.check, summary: a.report.summary, text: a.report.text }] : [])),
    repairs: state.repairsUsed,
    example: state.example,
    models: [...new Set(state.calls.map((c) => c.model))],
    usage: state.usage,
    cost: Math.round(state.cost * 1e6) / 1e6,
    timings: { ...state.timings },
    failure: state.failure ? `${state.failure.stage}: ${state.failure.reason}` : null,
    mode: state.mode,
    deadlineSkipped: state.deadlineSkipped,
    lines: last?.fragments.js ? last.fragments.js.replace(/\n$/, '').split('\n').length : null,
  };
}

export interface RecordSink {
  write(record: FailureRecord): Promise<void>;
}

export class MemoryRecords implements RecordSink {
  readonly records: FailureRecord[] = [];

  write(record: FailureRecord): Promise<void> {
    this.records.push(record);
    return Promise.resolve();
  }
}

/**
 * Records as JSON lines, one file per day, kept for a stated number of days
 * and then deleted by `purge`.
 */
export class JsonlRecords implements RecordSink {
  constructor(
    private readonly directory: string,
    readonly retentionDays = 30,
  ) {}

  private file(at: string): string {
    return join(this.directory, `records-${at.slice(0, 10)}.jsonl`);
  }

  async write(record: FailureRecord): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await appendFile(this.file(record.at), `${JSON.stringify(record)}\n`, 'utf8');
  }

  /** Deletes the files of days older than the retention period. Returns the files deleted. */
  async purge(now: Date = new Date()): Promise<string[]> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch {
      return [];
    }
    const cutoff = new Date(now.getTime() - this.retentionDays * 86_400_000).toISOString().slice(0, 10);
    const old = names.filter((name) => /^records-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name) && name.slice(8, 18) < cutoff);
    await Promise.all(old.map((name) => rm(join(this.directory, name))));
    return old;
  }
}
