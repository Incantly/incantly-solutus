/**
 * Shared helpers of the teacher spec tests. They use only the package's public exports (`src/index.ts`), the SDK's
 * headless app and the kernel's contracts.
 */
import type { ErrorObject } from '@incantly/kernel';
import { createHeadlessApp } from '@incantly/sdk';
import type { App } from '@incantly/sdk';
import { fakeModel, figureTarget, runTurn, toolset } from '../../src/index';
import type { ChatEvent, ChatRequest, FakeModel, JobId, ModelClient, RecordedReply, Target, ToolOutcome, TurnEvent, Toolset, TurnOptions } from '../../src/index';

type HeadlessOptions = NonNullable<Parameters<typeof createHeadlessApp>[0]>;
export type ModeName = NonNullable<HeadlessOptions['mode']>;

export interface Rig {
  readonly app: App;
  readonly target: Target;
}

/** A figure target over a headless app in `mode`, optionally holding `script`. */
export function makeRig(mode: string = 'geometry', script?: string): Rig {
  const app = createHeadlessApp({ mode: mode as ModeName, ...(script !== undefined ? { script } : {}) });
  return { app, target: figureTarget(app) };
}

/** The toolset of `names` (a failure to build it fails the test). */
export function tools(names: readonly string[] = ['draw', 'figure']): Toolset {
  const r = toolset(names);
  if (!r.ok) throw new Error(`toolset(${names.join(',')}) failed: ${r.message}`);
  return r.value;
}

/** The value of a successful tool result; throws (failing the test) on an error. */
export function valueOf(outcome: ToolOutcome): Record<string, unknown> {
  const r = outcome.result;
  if (!r.ok) throw new Error(`tool failed: ${r.kind}: ${r.message}`);
  return r.value as Record<string, unknown>;
}

/** The error object of a failed tool result (throws when the result is ok). */
export function errorOf(outcome: ToolOutcome): ErrorObject {
  const r = outcome.result;
  if (r.ok) throw new Error('the tool succeeded');
  return r as ErrorObject;
}

/** The per-line results of a `draw` result. */
export function drawLines(outcome: ToolOutcome): readonly Record<string, unknown>[] {
  const lines = valueOf(outcome)['lines'];
  if (!Array.isArray(lines)) throw new Error('the draw result has no "lines" list');
  return lines as Record<string, unknown>[];
}

/** The names of the objects on a target. */
export const namesOn = (target: Target): string[] => target.objects().list.map((o) => o.name).sort();

export async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

/** A clock the test moves by hand. */
export function makeClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  const box = { t: start };
  return {
    now: () => box.t,
    advance: (ms) => {
      box.t += ms;
    },
  };
}

export interface TurnRig {
  readonly rig: Rig;
  readonly model: FakeModel;
  readonly events: TurnEvent[];
}

export interface RunOptions {
  readonly job?: JobId;
  readonly mode?: string;
  readonly script?: string;
  readonly toolNames?: readonly string[];
  readonly text?: string;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
  readonly limits?: TurnOptions['limits'];
  readonly client?: ModelClient;
  readonly target?: Target;
}

/** Runs one turn over a recording and collects its events. */
export async function turnOver(replies: readonly RecordedReply[], options: RunOptions = {}): Promise<TurnRig> {
  const rig = options.target !== undefined ? { app: undefined as unknown as App, target: options.target } : makeRig(options.mode ?? 'geometry', options.script);
  const model = fakeModel(replies);
  const events = await collect(
    runTurn({
      job: options.job ?? 'live',
      client: options.client ?? model,
      toolset: tools(options.toolNames),
      target: rig.target,
      request: { text: options.text ?? 'Draw something.' },
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      now: options.now ?? (() => 0),
      ...(options.limits !== undefined ? { limits: options.limits } : {}),
    }),
  );
  return { rig, model, events };
}

/** A reply that calls `draw` with these lines. */
export const drawReply = (lines: readonly string[], text?: string): RecordedReply => ({ ...(text !== undefined ? { text } : {}), toolCalls: [{ name: 'draw', args: { lines } }] });

/** The last event of a turn. */
export const lastOf = (events: readonly TurnEvent[]): TurnEvent => events[events.length - 1] as TurnEvent;

export const isSay = (e: TurnEvent): e is { readonly say: string } => 'say' in e;
export const isLines = (e: TurnEvent): e is { readonly lines: readonly string[] } => 'lines' in e;
export const isDone = (e: TurnEvent): e is Extract<TurnEvent, { done: true }> => 'done' in e;
export const isError = (e: TurnEvent): e is Extract<TurnEvent, { error: unknown }> => 'error' in e;

/** Every `lines` event's lines, in order. */
export const drawnLines = (events: readonly TurnEvent[]): string[] => events.filter(isLines).flatMap((e) => [...e.lines]);

/** A model client that wraps another and runs `after(n)` once the n-th reply (1-based) has been fully sent. */
export function wrapClient(inner: ModelClient, after: (n: number) => void): ModelClient {
  const box = { n: 0 };
  return {
    async *chat(request: ChatRequest, signal: AbortSignal): AsyncGenerator<ChatEvent> {
      for await (const ev of inner.chat(request, signal)) yield ev;
      box.n += 1;
      after(box.n);
    },
  };
}

/** The text of a message in a request. */
export const contentOf = (m: ChatRequest['messages'][number]): string => m.content;

/** The `tool` messages of a request, in order. */
export const toolMessages = (request: ChatRequest): { name: string; content: string; toolCallId: string }[] =>
  request.messages.flatMap((m) => (m.role === 'tool' ? [{ name: m.name, content: m.content, toolCallId: m.toolCallId }] : []));

/** A target that counts the lines it was asked to run (a wrapper over the real one). */
export function countingTarget(inner: Target): { target: Target; runs: string[][] } {
  const runs: string[][] = [];
  const target: Target = {
    kind: inner.kind,
    get mode() {
      return inner.mode;
    },
    guard: inner.guard,
    lineLimit: inner.lineLimit,
    run: (lines) => {
      runs.push([...lines]);
      return inner.run(lines);
    },
    objects: () => inner.objects(),
    figureSummary: () => inner.figureSummary(),
    undefinedObjects: () => inner.undefinedObjects(),
    clock: inner.clock,
  };
  return { target, runs };
}
