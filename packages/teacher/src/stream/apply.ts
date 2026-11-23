/**
 * Prompt to figure (teacher design 7, core design 10 "Non-live generation"): a plan call, a script call and one repair
 * call. The script call streams; each line is applied to the target the moment its newline arrives, and goes out as a
 * `lines` event only when it passed, so what the client commits is always a script that loads. The phase is one field
 * over `FIGURE_STREAM_MACHINE` (docs/state-machines.md TE3). Nothing here throws, opens a socket or reads a clock.
 */
import { StateMachine } from '@incantly/kernel';
import type { CommandRegistry, ErrorObject, MachineTable } from '@incantly/kernel';
import { faultError, noticeOf, refusedMove, retrySpentError, streamCutError, streamErrorOf, turnLimitError } from '../errors';
import type { StreamError, TurnNotice } from '../errors';
import { commandsIn, lineKey } from '../loop/book';
import type { ChatMessage, ModelClient } from '../loop/model';
import { presentResult } from '../loop/turn';
import type { TurnEvent } from '../loop/turn';
import { buildMessages, buildSystem } from '../prompt/build';
import type { TurnRequest } from '../prompt/build';
import { catalogueFor } from '../prompt/catalogue';
import type { Target } from '../tools/types';
import { ABORTED, raceStream, whenAborted } from './race';
import { LineSplitter } from './split';

export type FigureStreamState = 'idle' | 'planning' | 'scripting' | 'repairing' | 'done' | 'limited' | 'stopped' | 'failed';
export type FigureStreamMove = 'plan' | 'script' | 'planned' | 'repair' | 'finish' | 'cut' | 'unusable' | 'limit' | 'abort' | 'modelError';

/** docs/state-machines.md TE3. The four last states take no event. */
export const FIGURE_STREAM_MACHINE: MachineTable<FigureStreamState, FigureStreamMove> = {
  idle: { plan: 'planning', script: 'scripting' },
  planning: { planned: 'scripting', limit: 'limited', abort: 'stopped', modelError: 'failed' },
  scripting: { repair: 'repairing', finish: 'done', cut: 'done', unusable: 'failed', limit: 'limited', abort: 'stopped', modelError: 'failed' },
  repairing: { finish: 'done', cut: 'done', unusable: 'failed', limit: 'limited', abort: 'stopped' },
  done: {},
  limited: {},
  stopped: {},
  failed: {},
};

export interface FigureLimits {
  /** Turn time in milliseconds, on the caller's clock; the caller's signal (`AbortSignal.timeout`) carries the same deadline. */
  readonly ms: number;
  /** The most characters of script the stream may add (the script limit of the host, less what the figure holds). */
  readonly scriptChars: number;
}

export const FIGURE_LIMITS: FigureLimits = { ms: 60_000, scriptChars: 64 * 1024 };

/** When the plan call runs: `auto` skips it for an edit of a figure with fewer than 3 objects and when `choice` names the result. */
export type PlanMode = 'auto' | 'always' | 'never';

/** A figure with fewer objects than this, being edited, needs no plan call. */
export const PLAN_MIN_OBJECTS = 3;

export interface FigureStreamOptions {
  readonly client: ModelClient;
  readonly target: Target;
  readonly request: TurnRequest;
  readonly signal?: AbortSignal;
  /** The caller's clock in milliseconds. */
  readonly now: () => number;
  readonly limits?: Partial<FigureLimits>;
  readonly plan?: PlanMode;
  /** A result the request already names (`graph`, `solve`, `steps`): the plan call is skipped. */
  readonly choice?: string;
  readonly registry?: CommandRegistry;
}

const PLAN_ASK = 'STEP 1: PLAN. List, in plain words and in order, the objects the figure needs. No lines of the formula language yet, and no code.';
const SCRIPT_ASK = 'Write the lines now: one line of the formula language a line, nothing else. No numbering, no code fences, no comments and no explanation.';
const REPAIR_ASK = 'These lines did not draw. Write one replacement line for each line that can be fixed, one a line, nothing else. Leave out any line that cannot be fixed.';

/** What one model call gives the stream. */
type Piece = { readonly text: string } | { readonly error: StreamError } | { readonly aborted: true };

/** How a script or repair call ended. `stop` means a final event was already sent. */
type WriteEnd = { readonly end: 'ended' } | { readonly end: 'cut' } | { readonly end: 'error'; readonly error: StreamError } | { readonly end: 'stop' };

interface Failure {
  readonly line: string;
  readonly error: unknown;
}

const isTimeout = (reason: unknown): boolean => typeof reason === 'object' && reason !== null && (reason as { name?: unknown }).name === 'TimeoutError';

const withAsk = (messages: readonly ChatMessage[], ask: string): ChatMessage[] => {
  const last = messages[messages.length - 1];
  if (last !== undefined && last.role === 'user') return [...messages.slice(0, -1), { role: 'user', content: `${last.content}\n\n${ask}` }];
  return [...messages, { role: 'user', content: ask }];
};

class FigureStream {
  private readonly machine: StateMachine<FigureStreamState, FigureStreamMove>;
  private readonly faults: ErrorObject[] = [];
  private readonly passed: string[] = [];
  private readonly failures: Failure[] = [];
  private readonly leftOut: string[] = [];
  private readonly notices: TurnNotice[] = [];
  /** Catalogue groups the lines used, most recent first, so the next call loads their forms. */
  private readonly usedGroups: string[] = [];
  private readonly limits: FigureLimits;
  private readonly signal: AbortSignal;
  private readonly aborted: Promise<typeof ABORTED>;
  private readonly startedAt: number;
  private scriptChars = 0;

  constructor(private readonly o: FigureStreamOptions) {
    this.machine = new StateMachine(FIGURE_STREAM_MACHINE, 'idle', refusedMove('figure stream', (e) => this.faults.push(e)));
    this.limits = { ...FIGURE_LIMITS, ...(o.limits ?? {}) };
    this.signal = o.signal ?? new AbortController().signal;
    this.aborted = whenAborted(this.signal);
    this.startedAt = o.now();
  }

  async *run(): AsyncGenerator<TurnEvent> {
    try {
      yield* this.drive();
    } catch (e) {
      yield { error: streamErrorOf(faultError('figure stream', e instanceof Error ? e.message : 'unknown')) };
    }
  }

  private skipPlan(): boolean {
    const mode = this.o.plan ?? 'auto';
    if (mode === 'always') return false;
    if (mode === 'never' || this.o.choice !== undefined) return true;
    const objects = this.o.target.figureSummary().objects;
    return objects >= 1 && objects < PLAN_MIN_OBJECTS;
  }

  private system(): { readonly ok: true; readonly text: string } | { readonly ok: false; readonly event: TurnEvent } {
    const built = buildSystem('figure', this.o.target, this.o.request, { tools: [], groups: this.usedGroups, ...(this.o.registry ? { registry: this.o.registry } : {}) });
    return built.ok ? { ok: true, text: built.value.system } : { ok: false, event: { error: streamErrorOf(built) } };
  }

  private async *drive(): AsyncGenerator<TurnEvent> {
    const base = buildMessages(this.o.target, this.o.request);
    let scriptMessages: ChatMessage[];
    if (this.skipPlan()) {
      this.machine.send('script');
      scriptMessages = withAsk(base, SCRIPT_ASK);
    } else {
      this.machine.send('plan');
      const planned = yield* this.plan(withAsk(base, PLAN_ASK));
      if (planned === undefined) return;
      this.machine.send('planned');
      scriptMessages = [...base, { role: 'assistant', content: planned }, { role: 'user', content: SCRIPT_ASK }];
    }
    const first = yield* this.writeCall(scriptMessages);
    if (first.end === 'stop') return;
    if (first.end === 'error') {
      this.machine.send('modelError');
      yield { error: first.error };
      return;
    }
    if (first.end === 'cut') {
      this.machine.send('cut');
      this.notices.push(noticeOf(streamCutError(this.passed.length)));
      yield* this.close();
      return;
    }
    if (this.failures.length === 0) {
      yield* this.close();
      return;
    }
    this.machine.send('repair');
    const earlier = this.failures.splice(0);
    const repair = withAsk([...scriptMessages, { role: 'assistant', content: this.passed.length > 0 ? this.passed.join('\n') : 'No line passed.' }], this.repairText(earlier));
    const second = yield* this.writeCall(repair);
    if (second.end === 'stop') return;
    if (second.end === 'cut' || second.end === 'error') {
      // the figure already holds the lines that passed; a failed repair call only leaves the failures out
      this.machine.send('cut');
      this.leave(earlier);
      this.leaveNew();
      yield* this.close();
      return;
    }
    this.leave(earlier);
    this.leaveNew();
    yield* this.close();
  }

  /** The plan call: its text, or `undefined` when a final event was sent. */
  private async *plan(messages: readonly ChatMessage[]): AsyncGenerator<TurnEvent, string | undefined> {
    const system = this.system();
    if (!system.ok) {
      this.machine.send('modelError');
      yield system.event;
      return undefined;
    }
    let text = '';
    for await (const piece of this.call(system.text, messages)) {
      if ('aborted' in piece) {
        const halted = this.halt() ?? this.fault();
        if (halted) yield halted;
        return undefined;
      }
      if ('error' in piece) {
        this.machine.send('modelError');
        yield { error: piece.error };
        return undefined;
      }
      text += piece.text;
      const halted = this.halt();
      if (halted) {
        yield halted;
        return undefined;
      }
    }
    return text.trim() === '' ? 'No plan.' : text.trim();
  }

  /** One script or repair call: each line is applied as its newline arrives. */
  private async *writeCall(messages: readonly ChatMessage[]): AsyncGenerator<TurnEvent, WriteEnd> {
    const system = this.system();
    if (!system.ok) {
      this.machine.send('modelError');
      yield system.event;
      return { end: 'stop' };
    }
    const split = new LineSplitter();
    for await (const piece of this.call(system.text, messages)) {
      if ('aborted' in piece) {
        const halted = this.halt() ?? this.fault();
        if (halted) yield halted;
        return { end: 'stop' };
      }
      if ('error' in piece) {
        if (piece.error.kind === 'stream_cut') {
          split.end(true);
          return { end: 'cut' };
        }
        return { end: 'error', error: piece.error };
      }
      for (const line of split.push(piece.text)) {
        const stop = yield* this.applyLine(line);
        if (stop) return { end: 'stop' };
      }
      const halted = this.halt();
      if (halted) {
        yield halted;
        return { end: 'stop' };
      }
    }
    for (const line of split.end(false).lines) {
      const stop = yield* this.applyLine(line);
      if (stop) return { end: 'stop' };
    }
    return { end: 'ended' };
  }

  /** One model call as pieces: the reply's text, an error, or that the caller's signal fired. Tool calls are ignored. */
  private async *call(system: string, messages: readonly ChatMessage[]): AsyncGenerator<Piece> {
    const stream = this.o.client.chat({ system, messages: [...messages], tools: [] }, this.signal);
    for await (const item of raceStream(stream, this.signal, this.aborted)) {
      if (item === ABORTED) {
        yield { aborted: true };
        return;
      }
      if ('text' in item) {
        if (item.text !== '') yield { text: item.text };
      } else if ('error' in item) {
        yield { error: item.error };
        return;
      }
    }
  }

  /** Applies one line to the target. A line that passes goes out at once; a failed one is kept with its error. True when the stream ended. */
  private *applyLine(line: string): Generator<TurnEvent, boolean> {
    if (this.scriptChars + line.length + 1 > this.limits.scriptChars) {
      this.machine.send('limit');
      yield { error: streamErrorOf(turnLimitError(`${Math.round(this.limits.scriptChars / 1024)} KB of script`)) };
      return true;
    }
    const result = this.o.target.run([line])[0];
    if (result !== undefined && result.ok) {
      this.passed.push(line);
      this.scriptChars += line.length + 1;
      this.markGroups(line);
      yield { lines: [line] };
      return false;
    }
    this.failures.push({ line, error: result ?? { ok: false, kind: 'internal', message: 'The target gave no result for the line.' } });
    this.markGroups(line);
    return false;
  }

  /** The failures as the model reads them (kernel errors in their compact form). */
  private repairText(failures: readonly Failure[]): string {
    const value = { failed: failures.map((f) => ({ line: f.line, error: f.error })) };
    return `${REPAIR_ASK}\n${presentResult({ ok: true, value, notices: [] })}`;
  }

  /** The failures of the earlier call that no replacement line made good are left out. */
  private leave(earlier: readonly Failure[]): void {
    const made = new Set(this.passed.map(lineKey));
    for (const f of earlier) {
      const key = lineKey(f.line);
      if (!made.has(key) && !this.leftOut.includes(key)) this.leftOut.push(key);
    }
  }

  /** Replacement lines that failed again are left out. */
  private leaveNew(): void {
    for (const f of this.failures.splice(0)) {
      const key = lineKey(f.line);
      if (!this.leftOut.includes(key)) this.leftOut.push(key);
    }
  }

  private markGroups(line: string): void {
    const catalogue = this.o.registry ? catalogueFor(this.o.target.mode, this.o.registry) : catalogueFor(this.o.target.mode);
    if (!catalogue.ok) return;
    for (const name of commandsIn(line)) {
      const group = catalogue.value.groupOf(name);
      if (group === undefined) continue;
      const at = this.usedGroups.indexOf(group);
      if (at >= 0) this.usedGroups.splice(at, 1);
      this.usedGroups.unshift(group);
    }
  }

  /** The event that ends the stream when a stop or the deadline is reached, or undefined. */
  private halt(): TurnEvent | undefined {
    if (this.signal.aborted && !isTimeout(this.signal.reason)) {
      this.machine.send('abort');
      return this.finish();
    }
    if (this.signal.aborted || this.o.now() - this.startedAt >= this.limits.ms) {
      this.machine.send('limit');
      return { error: streamErrorOf(turnLimitError(`${this.limits.ms / 1000} s`)) };
    }
    return undefined;
  }

  /** A refused machine move is a bug: it ends the stream with an `internal` error. */
  private fault(): TurnEvent | undefined {
    const first = this.faults[0];
    return first === undefined ? undefined : { error: streamErrorOf(first) };
  }

  private finish(): TurnEvent {
    return this.notices.length > 0 ? { done: true, notices: [...this.notices] } : { done: true };
  }

  /** The last event of a stream that ended on its own: `done` with the notices, or `model_bad_output` when no line passed. */
  private *close(): Generator<TurnEvent> {
    for (const key of this.leftOut) this.notices.push(noticeOf(retrySpentError(key, 0, key), [key]));
    const broken = this.fault();
    if (broken) {
      yield broken;
      return;
    }
    if (this.passed.length === 0 && this.machine.can('unusable')) {
      this.machine.send('unusable');
      yield { error: { ok: false, kind: 'model_bad_output', message: 'The AI could not draw this.', hint: 'Say it in other words.' } };
      return;
    }
    if (this.machine.can('finish')) this.machine.send('finish');
    yield this.fault() ?? this.finish();
  }
}

/**
 * Prompt to figure as a stream of events: `lines` (one line a event, only lines that passed on the target), then a last
 * `done` with the notices (`retry_spent` for each line left out, `stream_cut`) or an `error` (`turn_limit`,
 * `model_bad_output`, or the model's own). Never throws. The target holds the lines that passed when it ends.
 */
export function streamFigure(options: FigureStreamOptions): AsyncIterable<TurnEvent> {
  return new FigureStream(options).run();
}
