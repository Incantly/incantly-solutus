/**
 * The turn loop (teacher design 6): ask the model, run its tool calls as their arguments complete, give the results
 * back, and go on until a reply has no tool calls or a limit or a stop ends it. The loop's state is one field over
 * `TURN_MACHINE` (docs/state-machines.md TE1). It opens no socket: the model comes in as a `ModelClient`, time as `now()`.
 *
 * Nothing here throws. A fault becomes an `internal` error event; a model error becomes the stream's error event.
 */
import { StateMachine, compactError } from '@incantly/kernel';
import type { CommandRegistry, ErrorObject, MachineTable, Result } from '@incantly/kernel';
import { faultError, noticeOf, refusedMove, retrySpentError, streamCutError, streamErrorOf, turnLimitError } from '../errors';
import type { StreamError, TurnNotice } from '../errors';
import { buildPrompt, buildSystem } from '../prompt/build';
import type { PromptOptions, TurnRequest } from '../prompt/build';
import { catalogueFor } from '../prompt/catalogue';
import type { JobId } from '../prompt/jobs';
import { builtinTool, toolset } from '../tools/toolset';
import type { Target, ToolOutcome, ToolValue, Toolset, TurnOutput } from '../tools/types';
import { RetryBook, STREAK_LIMIT, Streak, commandsIn, lineKey } from './book';
import type { ChatEvent, ChatMessage, ModelClient, ModelToolCall } from './model';

export type TurnState = 'idle' | 'calling' | 'running_tool' | 'done' | 'limited' | 'stopped' | 'failed';
export type TurnMove = 'start' | 'toolCall' | 'replyEnd' | 'cut' | 'results' | 'limit' | 'abort' | 'modelError';

/** docs/state-machines.md TE1. The four last states take no event. */
export const TURN_MACHINE: MachineTable<TurnState, TurnMove> = {
  idle: { start: 'calling' },
  calling: { toolCall: 'running_tool', replyEnd: 'done', cut: 'done', limit: 'limited', abort: 'stopped', modelError: 'failed' },
  running_tool: { toolCall: 'running_tool', results: 'calling', cut: 'done', limit: 'limited', abort: 'stopped', modelError: 'failed' },
  done: {},
  limited: {},
  stopped: {},
  failed: {},
};

export interface TurnLimits {
  /** Model calls in a turn. */
  readonly modelCalls: number;
  /** Tool calls in a turn. */
  readonly toolCalls: number;
  /** Turn time in milliseconds, on the caller's clock; the caller's signal (`AbortSignal.timeout`) carries the same deadline. */
  readonly ms: number;
}

export const TURN_LIMITS: TurnLimits = { modelCalls: 8, toolCalls: 24, ms: 60_000 };

/** What a turn sends out, in order. The last event is `done` or `error`. */
export type TurnEvent =
  | { readonly say: string }
  | { readonly lines: readonly string[] }
  | { readonly actions: readonly unknown[] }
  | { readonly control: { readonly op: 'pause' | 'resume' | 'seek'; readonly t?: number } }
  | { readonly done: true; readonly notices?: readonly TurnNotice[] }
  | { readonly error: StreamError };

export interface TurnOptions {
  readonly job: JobId;
  readonly client: ModelClient;
  readonly toolset: Toolset;
  readonly target: Target;
  readonly request: TurnRequest;
  /** The caller's stop. A stop ends the turn at once; what was applied stays. */
  readonly signal?: AbortSignal;
  /** The caller's clock in milliseconds. The package reads no clock of its own. */
  readonly now: () => number;
  readonly limits?: Partial<TurnLimits>;
  /** The command table for the catalogue; default the SDK's. */
  readonly registry?: CommandRegistry;
}

/** Marks that the caller's signal fired while the loop waited for the model. */
const ABORTED = Symbol('aborted');

/** True when the signal's reason is a deadline (`AbortSignal.timeout`), which ends the turn as `turn_limit`, not as a stop. */
const isTimeout = (reason: unknown): boolean => typeof reason === 'object' && reason !== null && (reason as { name?: unknown }).name === 'TimeoutError';

const isOkResult = (r: unknown): boolean => typeof r === 'object' && r !== null && (r as { ok?: unknown }).ok === true;

/** A kernel error object (it has a fingerprint), as opposed to an SDK API error. */
const isKernelError = (v: unknown): v is ErrorObject =>
  typeof v === 'object' && v !== null && (v as { ok?: unknown }).ok === false && typeof (v as { fingerprint?: unknown }).fingerprint === 'string' && typeof (v as { forms?: unknown }).forms === 'object';

/** The model's view of a result: the kernel's error objects in their compact form (errors design 3.5), the rest as it is. */
function compactAll(v: unknown, depth: number): unknown {
  if (isKernelError(v)) return compactError(v, { sentSource: true });
  if (depth > 4) return v;
  if (Array.isArray(v)) return v.map((x) => compactAll(x, depth + 1));
  if (typeof v === 'object' && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, compactAll(x, depth + 1)]));
  return v;
}

export function presentResult(r: Result<ToolValue>): string {
  return JSON.stringify(compactAll(r.ok ? r.value : r, 0));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function linesOf(args: unknown): string[] | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const lines = (args as { lines?: unknown }).lines;
  return Array.isArray(lines) && lines.length > 0 && lines.every((l) => typeof l === 'string') ? (lines as string[]) : undefined;
}

class Turn {
  private readonly machine: StateMachine<TurnState, TurnMove>;
  private readonly faults: ErrorObject[] = [];
  private readonly book = new RetryBook();
  private readonly streak = new Streak();
  private readonly notices: TurnNotice[] = [];
  private readonly spentKeys = new Set<string>();
  /** Catalogue groups the turn's lines used, most recent first. */
  private readonly usedGroups: string[] = [];
  private readonly failedKeys: string[] = [];
  private readonly leftOutKeys: string[] = [];
  private readonly messages: ChatMessage[] = [];
  private readonly limits: TurnLimits;
  private readonly signal: AbortSignal;
  /** Settles when the caller's signal fires (a stop or the deadline); each wait for the model races it. */
  private readonly aborted: Promise<typeof ABORTED>;
  private readonly startedAt: number;
  private readonly figureOnly: Toolset | undefined;
  private modelCalls = 0;
  private toolCalls = 0;
  /** Lines that passed, for the `stream_cut` notice. */
  private drawn = 0;

  constructor(private readonly o: TurnOptions) {
    this.machine = new StateMachine(TURN_MACHINE, 'idle', refusedMove('turn', (e) => this.faults.push(e)));
    this.limits = { ...TURN_LIMITS, ...(o.limits ?? {}) };
    this.signal = o.signal ?? new AbortController().signal;
    const signal = this.signal;
    this.aborted = new Promise((resolve) => {
      if (signal.aborted) resolve(ABORTED);
      else signal.addEventListener('abort', () => resolve(ABORTED), { once: true });
    });
    this.startedAt = o.now();
    const fig = toolset(['figure']);
    this.figureOnly = fig.ok ? fig.value : undefined;
  }

  async *run(): AsyncGenerator<TurnEvent> {
    try {
      yield* this.drive();
    } catch (e) {
      yield { error: streamErrorOf(faultError('turn', e instanceof Error ? e.message : 'unknown')) };
    }
  }

  private promptOptions(groups: readonly string[]): PromptOptions {
    return { tools: this.o.toolset.names, groups, ...(this.o.registry ? { registry: this.o.registry } : {}) };
  }

  private async *drive(): AsyncGenerator<TurnEvent> {
    const built = buildPrompt(this.o.job, this.o.target, this.o.request, this.promptOptions([]));
    if (!built.ok) {
      yield { error: streamErrorOf(built) };
      return;
    }
    this.messages.push(...built.value.messages);
    let system = built.value.system;
    this.machine.send('start');
    for (;;) {
      const stop = this.halt('model') ?? this.fault();
      if (stop) {
        yield stop;
        return;
      }
      if (this.modelCalls > 0 && this.usedGroups.length > 0) {
        const again = buildSystem(this.o.job, this.o.target, this.o.request, this.promptOptions(this.usedGroups));
        if (again.ok) system = again.value.system;
      }
      this.modelCalls += 1;
      const calls: ModelToolCall[] = [];
      const results: ChatMessage[] = [];
      let text = '';
      const stream = this.o.client.chat({ system, messages: [...this.messages], tools: this.o.toolset.specs() }, this.signal);
      const it = stream[Symbol.asyncIterator]();
      for (;;) {
        // each step races the caller's signal, so a model that sends nothing is still stopped (a stop, or the deadline)
        const pending = it.next();
        pending.catch(() => undefined);
        let step: IteratorResult<ChatEvent> | typeof ABORTED;
        try {
          step = await Promise.race([pending, this.aborted]);
        } catch (e) {
          if (!this.signal.aborted) throw e;
          step = ABORTED;
        }
        if (step === ABORTED) {
          void Promise.resolve(it.return?.()).catch(() => undefined);
          const halted = this.halt('none') ?? this.fault();
          if (halted) yield halted;
          return;
        }
        if (step.done === true) break;
        const ev = step.value;
        if ('text' in ev) {
          text += ev.text;
          if (ev.text !== '') yield { say: ev.text };
        } else if ('toolCall' in ev) {
          const halted = this.halt('tool');
          if (halted) {
            yield halted;
            return;
          }
          this.machine.send('toolCall');
          this.toolCalls += 1;
          const outcome = this.runCall(ev.toolCall);
          calls.push(ev.toolCall);
          results.push({ role: 'tool', toolCallId: ev.toolCall.id, name: ev.toolCall.name, content: presentResult(outcome.result) });
          for (const out of outcome.outputs) yield out;
          const fault = this.fault();
          if (fault) {
            yield fault;
            return;
          }
        } else if ('error' in ev) {
          if (ev.error.kind === 'stream_cut') {
            this.machine.send('cut');
            this.notices.push(noticeOf(streamCutError(this.drawn)));
            yield this.finish();
            return;
          }
          this.machine.send('modelError');
          yield { error: ev.error };
          return;
        }
      }
      const halted = this.halt('none') ?? this.fault();
      if (halted) {
        yield halted;
        return;
      }
      if (calls.length === 0) {
        this.machine.send('replyEnd');
        yield this.fault() ?? this.finish();
        return;
      }
      this.machine.send('results');
      this.messages.push({ role: 'assistant', content: text, toolCalls: calls }, ...results);
      const note = this.notDrawnLine();
      if (note !== undefined) this.messages.push({ role: 'user', content: note });
    }
  }

  /** The event that ends the turn when a stop or a limit is reached, or undefined. `what` says which limit to read. */
  private halt(what: 'model' | 'tool' | 'none'): TurnEvent | undefined {
    if (this.signal.aborted && !isTimeout(this.signal.reason)) {
      this.machine.send('abort');
      return this.finish();
    }
    let limit: string | undefined;
    if (this.signal.aborted || this.o.now() - this.startedAt >= this.limits.ms) limit = `${this.limits.ms / 1000} s`;
    else if (what === 'model' && this.modelCalls >= this.limits.modelCalls) limit = `${this.limits.modelCalls} model calls`;
    else if (what === 'tool' && this.toolCalls >= this.limits.toolCalls) limit = `${this.limits.toolCalls} tool calls`;
    if (limit === undefined) return undefined;
    this.machine.send('limit');
    return { error: streamErrorOf(turnLimitError(limit)) };
  }

  /** A refused machine move is a bug: it ends the turn with an `internal` error. */
  private fault(): TurnEvent | undefined {
    const first = this.faults[0];
    return first === undefined ? undefined : { error: streamErrorOf(first) };
  }

  private finish(): TurnEvent {
    return this.notices.length > 0 ? { done: true, notices: [...this.notices] } : { done: true };
  }

  private runCall(call: ModelToolCall): ToolOutcome {
    return call.name === 'draw' && this.o.toolset.has('draw') ? this.runDraw(call) : this.o.toolset.call(this.o.target, call.name, call.args);
  }

  /**
   * A `draw` call with the loop's two rules on lines (errors design 6): a line whose retries are spent is not run again,
   * and after three lines in a row failing with one kind the call is answered with `figure` instead.
   */
  private runDraw(call: ModelToolCall): ToolOutcome {
    const args = parseJson(call.args);
    const lines = linesOf(args);
    const through = (): ToolOutcome => this.o.toolset.call(this.o.target, 'draw', call.args);
    if (lines === undefined) return through();
    if (this.streak.length >= STREAK_LIMIT && this.figureOnly !== undefined) {
      this.streak.reset();
      const read = this.figureOnly.call(this.o.target, 'figure', {});
      if (!read.result.ok) return read;
      const why = 'The last three lines failed with the same kind of error, so this call was not run. Here is the figure; write the next lines from it.';
      return { result: { ok: true, value: { draw: 'not run', why, figure: read.result.value }, notices: [] }, outputs: [] };
    }
    const keys = lines.map(lineKey);
    const spent = lines.map((l, i) => this.book.isSpent(keys[i] as string, l));
    const sendIdx = lines.map((_, i) => i).filter((i) => !spent[i]);
    let sent: ToolOutcome | undefined;
    if (sendIdx.length > 0) {
      sent = this.o.toolset.call(this.o.target, 'draw', { ...(args as Record<string, unknown>), lines: sendIdx.map((i) => lines[i] as string) });
      if (!sent.result.ok) return sent;
    }
    const sentValue: ToolValue = sent !== undefined && sent.result.ok ? sent.result.value : { lines: [], applied: 0, undefined: [] };
    const results = sentValue['lines'] as readonly unknown[];
    if (results.length !== sendIdx.length) return sent ?? through();
    const merged: unknown[] = [];
    let k = 0;
    for (let i = 0; i < lines.length; i++) {
      const key = keys[i] as string;
      const text = lines[i] as string;
      if (spent[i]) {
        merged.push(retrySpentError(key, i + 1, text));
        this.leftOutKeys.push(key);
        continue;
      }
      const r = results[k++];
      merged.push(r);
      this.account(key, text, r);
    }
    this.markGroups(sendIdx.map((i) => lines[i] as string));
    const value: ToolValue = { ...sentValue, lines: merged };
    const outputs: readonly TurnOutput[] = builtinTool('draw')?.outputs?.({ lines }, value) ?? [];
    return { result: { ok: true, value, notices: [] }, outputs };
  }

  /** Books one line's result: the retry book, the failure streak and the notices. */
  private account(key: string, text: string, r: unknown): void {
    if (isOkResult(r)) {
      this.book.passed(key);
      this.streak.add(undefined);
      this.drawn += 1;
      return;
    }
    const e = r as { kind?: string; fingerprint?: string; recovery?: ErrorObject['recovery'] };
    const kind = e.kind ?? 'unknown';
    this.streak.add({ kind: kind as ErrorObject['kind'] });
    this.failedKeys.push(key);
    const spent = this.book.failed(key, text, { kind, ...(e.fingerprint !== undefined ? { fingerprint: e.fingerprint } : {}), ...(e.recovery !== undefined ? { recovery: e.recovery } : {}) });
    if (spent && !this.spentKeys.has(key)) {
      this.spentKeys.add(key);
      this.notices.push(noticeOf(retrySpentError(key, 0, text), [key]));
      this.leftOutKeys.push(key);
    }
  }

  /** Notes the catalogue groups the lines used, so the next model call loads them. */
  private markGroups(lines: readonly string[]): void {
    const catalogue = this.o.registry ? catalogueFor(this.o.target.mode, this.o.registry) : catalogueFor(this.o.target.mode);
    if (!catalogue.ok) return;
    for (const line of lines) {
      for (const name of commandsIn(line)) {
        const group = catalogue.value.groupOf(name);
        if (group === undefined) continue;
        const at = this.usedGroups.indexOf(group);
        if (at >= 0) this.usedGroups.splice(at, 1);
        this.usedGroups.unshift(group);
      }
    }
  }

  /** One line for the next call naming what did not draw (design 6), or undefined when everything did. */
  private notDrawnLine(): string | undefined {
    const failed = [...new Set(this.failedKeys.splice(0))];
    const left = [...new Set(this.leftOutKeys.splice(0))];
    const parts: string[] = [];
    if (failed.length > 0) parts.push(`Not drawn: ${failed.join(', ')}.`);
    if (left.length > 0) parts.push(`Left out for good, do not send again: ${left.join(', ')}.`);
    return parts.length > 0 ? `${parts.join(' ')} Say only what was drawn.` : undefined;
  }
}

/**
 * Runs one turn as a stream of events: `say` text, the `lines` that passed, board `actions`, film `control`, and a last
 * `done` (with the turn's notices) or `error`. Never throws.
 */
export function runTurn(options: TurnOptions): AsyncIterable<TurnEvent> {
  return new Turn(options).run();
}
