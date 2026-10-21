import { readFileSync } from 'node:fs';
import type { Prompt, LearnerRequest } from './context';
import { ModelError, type CallPurpose, type ModelCall, type ModelClient, type ModelReply } from './models';
import { DELIVERY_MS, Generator, type GenerationState } from './pipeline';
import { isolatedProbe } from './probe';

/**
 * The agent bench: the real pipeline (plan, scene by edits or whole, checks,
 * repairs, the 25 s deadline) driven by models that answer from outside this
 * process, for example as subagents of a coding agent when no API key is at
 * hand. It runs in rounds. Each round replays every generation with the
 * replies recorded so far, on a clock that advances by each reply's measured
 * time, and stops a generation at its first call without a reply; those calls
 * are the next round's prompts. When no call is pending, the run is complete
 * and the report is the pipeline's own record of every generation.
 */

/** A learner request in the bench, with the reviewed example of its concept (withheld in the novel condition). */
export interface BenchRequest {
  readonly id: string;
  readonly concept: string;
  readonly request: LearnerRequest;
  /** Id of the concept's own reviewed scene. */
  readonly example?: string;
}

/**
 * library: the reviewed examples are all there, so a request for a reviewed
 * concept starts from its scene (adapt mode). novel: the concept's own
 * example is withheld, so the scene is written whole from the nearest other
 * one, as for a concept the library does not have yet.
 */
export type BenchCondition = 'library' | 'novel';

/** A recorded reply, with what the caller measured. */
export interface BenchReply {
  readonly key: string;
  readonly text: string;
  /** Wall time of the call in milliseconds. */
  readonly ms: number;
  readonly model?: string;
  readonly outputTokens?: number;
  readonly inputTokens?: number;
  readonly cacheReadTokens?: number;
}

/** A call the bench is waiting for. */
export interface PendingCall {
  readonly key: string;
  readonly purpose: CallPurpose;
  readonly prompt: string;
}

/** A prompt as one text: the service's system blocks, then the learner turn. */
export function promptText(prompt: Prompt): string {
  return [
    'You are standing in for a model endpoint in a latency benchmark. Do not use any tools and do not read any files. Reply with exactly what the instructions ask for and nothing else: no preamble, no explanation after.',
    '',
    '<system>',
    prompt.system.map((block) => block.text).join('\n\n'),
    '</system>',
    '',
    '<user>',
    prompt.user,
    '</user>',
  ].join('\n');
}

/** The key of a call: plans are shared by both conditions, since their prompt never sees the examples. */
export function callKey(request: string, condition: BenchCondition, purpose: CallPurpose, index: number): string {
  return purpose === 'plan' ? `${request}|plan|${index}` : `${request}|${condition}|${purpose}|${index}`;
}

/** Characters per token for code and English, to apply a call's token limit to a recorded reply. */
const CHARS_PER_TOKEN = 3.5;

/** Scene time as the learner would see it: recorded model time plus this process's own work. */
class BenchClock {
  private readonly started = performance.now();
  private modelMs = 0;

  now(): number {
    return this.modelMs + (performance.now() - this.started);
  }

  advance(ms: number): void {
    this.modelMs += ms;
  }
}


/** Answers from recorded replies; a call without one is recorded as pending and ends the generation. */
class ReplayModel implements ModelClient {
  readonly name = 'bench-replay';
  private readonly counts: Record<CallPurpose, number> = { plan: 0, scene: 0, repair: 0 };

  constructor(
    private readonly request: string,
    private readonly condition: BenchCondition,
    private readonly replies: ReadonlyMap<string, BenchReply>,
    private readonly pending: PendingCall[],
    private readonly clock: BenchClock,
    private readonly remaining: () => number,
  ) {}

  modelFor(purpose: CallPurpose): string {
    return purpose === 'plan' ? 'bench-plan' : 'bench-scene';
  }

  async complete(call: ModelCall): Promise<ModelReply> {
    const key = callKey(this.request, this.condition, call.purpose, this.counts[call.purpose]++);
    const reply = this.replies.get(key);
    if (!reply) {
      this.pending.push({ key, purpose: call.purpose, prompt: promptText(call.prompt) });
      throw new Error(`pending reply ${key}`);
    }
    // The real call is cut off at the deadline: a reply that took longer never arrived.
    const remaining = this.remaining();
    if (reply.ms > remaining) {
      this.clock.advance(Math.max(0, remaining));
      throw new ModelError('timeout', `The ${call.purpose} call would have run past the deadline (${Math.round(reply.ms)} ms with ${Math.round(remaining)} ms left)`);
    }
    this.clock.advance(reply.ms);
    // The real call stops at its token limit: a longer reply arrives cut off.
    const limit = Math.floor(call.maxTokens * CHARS_PER_TOKEN);
    const cut = reply.text.length > limit;
    const text = cut ? reply.text.slice(0, limit) : reply.text;
    // The pipeline reads a whole scene as it streams in.
    call.onText?.(text);
    return {
      text,
      model: reply.model ?? this.modelFor(call.purpose),
      usage: { inputTokens: reply.inputTokens ?? 0, outputTokens: reply.outputTokens ?? 0, cacheReadTokens: reply.cacheReadTokens ?? 0, cacheWriteTokens: 0 },
      stopReason: cut ? 'max_tokens' : 'end_turn',
      ms: reply.ms,
    };
  }
}

/** One generation as the bench saw it. */
export interface BenchResult {
  readonly id: string;
  readonly concept: string;
  readonly condition: BenchCondition;
  /** Waiting for a reply: not finished yet. */
  readonly pending: boolean;
  readonly status: GenerationState['status'];
  readonly mode: GenerationState['mode'];
  readonly example: string | null;
  readonly size: string | null;
  readonly firstAttempt: boolean;
  readonly passed: boolean;
  readonly repairs: number;
  /** The check each failed attempt failed. */
  readonly failures: readonly string[];
  readonly failureReason: string | null;
  readonly deadlineSkipped: boolean;
  readonly timings: { readonly planMs: number; readonly sceneMs: number; readonly repairMs: number; readonly totalMs: number; readonly checkMs: number };
  readonly calls: ReadonlyArray<{ readonly purpose: CallPurpose; readonly ms: number; readonly outputTokens: number; readonly model: string; readonly error?: string }>;
  readonly jsChars: number;
  readonly jsLines: number;
}

export interface BenchRound {
  readonly results: readonly BenchResult[];
  readonly pending: readonly PendingCall[];
}

/** Runs every request in every condition with the replies so far. */
export async function benchRound(
  requests: readonly BenchRequest[],
  conditions: readonly BenchCondition[],
  replies: readonly BenchReply[],
  options: { readonly deadlineMs?: number } = {},
): Promise<BenchRound> {
  const byKey = new Map(replies.map((r) => [r.key, r] as const));
  const pending: PendingCall[] = [];
  const results: BenchResult[] = [];
  for (const condition of conditions) {
    for (const request of requests) {
      const clock = new BenchClock();
      const before = pending.length;
      let generator: Generator | null = null;
      let state: GenerationState | null = null;
      // A call is cut off when the deadline, less the time to deliver a fallback, passes: as in the service.
      const model = new ReplayModel(request.id, condition, byKey, pending, clock, () => (generator && state ? generator.remainingMs(state) - DELIVERY_MS : Infinity));
      generator = new Generator({
        model,
        probe: isolatedProbe,
        now: () => clock.now(),
        ...(options.deadlineMs !== undefined ? { deadlineMs: options.deadlineMs } : {}),
        ...(condition === 'novel' && request.example ? { withhold: [request.example] } : {}),
      });
      state = generator.begin();
      await generator.planStage(state, request.request);
      if (state.plan) await generator.buildStage(state);
      generator.finish(state);
      // A plan reply shared by both conditions is only asked for once.
      if (pending.length > before) {
        const fresh = pending.slice(before).filter((p, i, all) => all.findIndex((q) => q.key === p.key) === i && !pending.slice(0, before).some((q) => q.key === p.key));
        pending.splice(before, pending.length - before, ...fresh);
      }
      results.push(resultOf(request, condition, state, pending.length > before || waiting(state)));
    }
  }
  return { results, pending };
}

function waiting(state: GenerationState): boolean {
  return state.failure?.stage === 'model' && state.failure.reason.startsWith('pending reply');
}

function resultOf(request: BenchRequest, condition: BenchCondition, state: GenerationState, pending: boolean): BenchResult {
  const attempts = state.attempts;
  const last = attempts.at(-1);
  const js = last?.fragments.js ?? '';
  const modelMs = state.calls.reduce((sum, c) => sum + c.ms, 0);
  return {
    id: request.id,
    concept: request.concept,
    condition,
    pending,
    status: state.status,
    mode: state.mode,
    example: state.example,
    size: state.plan?.size ?? null,
    firstAttempt: attempts[0]?.passed ?? false,
    passed: last?.passed ?? false,
    repairs: state.repairsUsed,
    failures: attempts.filter((a) => !a.passed).map((a) => (a.failed === 'probe' ? `probe:${a.report?.check ?? '?'}` : (a.failed ?? 'unknown'))),
    failureReason: state.failure?.reason ?? null,
    deadlineSkipped: state.deadlineSkipped,
    timings: {
      planMs: state.timings.planMs ?? 0,
      sceneMs: state.timings.sceneMs ?? 0,
      repairMs: state.timings.repairMs,
      totalMs: state.timings.totalMs ?? 0,
      checkMs: Math.max(0, (state.timings.totalMs ?? 0) - modelMs),
    },
    calls: state.calls.map((c) => ({ purpose: c.purpose, ms: c.ms, outputTokens: c.usage.outputTokens, model: c.model, ...(c.error ? { error: c.error } : {}) })),
    jsChars: js.length,
    jsLines: js ? js.split('\n').length : 0,
  };
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
