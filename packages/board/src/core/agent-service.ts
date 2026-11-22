/**
 * The agent on the board (design 11.3, docs/state-machines.md B32): the protocol with the server and the job that applies
 * its answer. `BoardAgentTransport` is `(request, signal) => AsyncIterable<BoardAgentEvent>`, as Tiptap's `AiTransport`;
 * the HTTP client is `web/agent-http.ts`. A request is one `AgentJob`; the answer is a stream of `actions` events, each
 * applied by the runner (`core/agent.ts`) as it arrives, then `done`. A newer request aborts the older; Stop ends the job
 * at once; what was made stays. No DOM, no timers, no `Date`.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import type { BoardAgent } from './agent';
import { beginGesture } from './edit';
import type { Gesture } from './edit';
import type { ActionResult, AgentItem, Box } from './agent-types';
import type { BoardError, BoardResult, ErrorSink } from './errors';
import { boardError, ok, refusedMove } from './errors';
import { sendIfAble } from './machine';

/** What the user picked on a circle (design 11.1). `ask` carries the user's own words in `text`. */
export type CircleChoice = 'graph' | 'formula' | 'solve' | 'steps' | 'measure' | 'geometry' | 'explain' | 'animate' | 'slider' | 'ask';
export const CIRCLE_CHOICES: readonly CircleChoice[] = ['graph', 'formula', 'solve', 'steps', 'measure', 'geometry', 'explain', 'animate', 'slider', 'ask'];

/** The request of agent.md 3: a circle on the board and what the user wants of it. */
export interface CircleRequest {
  readonly kind: 'circle';
  readonly choice: CircleChoice;
  readonly text?: string;
  readonly items: readonly AgentItem[];
  /** How many more items the circle holds than are listed. */
  readonly more: number;
  /** The circle's area, so the answer can be placed `near` it. */
  readonly circle: Box;
  /** A picture of the circled area; sent only when the board's `agent.vision` option is on. */
  readonly picture?: string;
  readonly page: string;
}

/** What the user says to the talking agent (design 11.2), with what is in view. */
export interface TalkRequest {
  readonly kind: 'talk';
  readonly text: string;
  readonly items: readonly AgentItem[];
  readonly more: number;
  readonly page: string;
  /** The user lets the agent change the work they made. */
  readonly allowEdit: boolean;
}

export type BoardAgentRequest = CircleRequest | TalkRequest;

/** One line of the server's answer. */
export type BoardAgentEvent =
  | { readonly say: string }
  | { readonly actions: readonly unknown[] }
  | { readonly done: true }
  | { readonly error: { readonly kind: string; readonly message: string } };

export type BoardAgentTransport = (request: BoardAgentRequest, signal: AbortSignal) => AsyncIterable<BoardAgentEvent>;

type JobState = 'ready' | 'waiting' | 'working' | 'done' | 'stopped' | 'failed' | 'replaced';
type JobEvent = 'start' | 'actions' | 'done' | 'stop' | 'fail' | 'replace';

export const JOB_MACHINE: MachineTable<JobState, JobEvent> = {
  ready: { start: 'waiting' },
  waiting: { actions: 'working', done: 'done', stop: 'stopped', fail: 'failed', replace: 'replaced' },
  working: { actions: 'working', done: 'done', stop: 'stopped', fail: 'failed', replace: 'replaced' },
  done: {},
  stopped: {},
  failed: {},
  replaced: {},
};

/** What a job did: the shapes it made and the actions that did not work. */
export interface AgentOutcome {
  readonly made: readonly string[];
  readonly failed: readonly BoardError[];
}

/** One request and its answer. */
export class AgentJob {
  readonly request: BoardAgentRequest;
  readonly controller = new AbortController();
  /** The ids of what the job made, in order. */
  readonly made: string[] = [];
  readonly failed: BoardError[] = [];
  /** Why a failed job failed. */
  readonly reason: { message: string; kind: string } = { message: '', kind: '' };
  readonly #machine: StateMachine<JobState, JobEvent>;

  constructor(request: BoardAgentRequest, report?: () => ErrorSink | undefined) {
    this.request = request;
    this.#machine = new StateMachine(JOB_MACHINE, 'ready', refusedMove('agent job', report ?? (() => undefined)));
  }

  get state(): JobState {
    return this.#machine.state;
  }

  /** True while the job is waiting for the server or working on its answer. */
  get live(): boolean {
    return this.#machine.is('waiting', 'working');
  }

  start(): boolean {
    return sendIfAble(this.#machine, 'start');
  }

  /** An `actions` event came. False when the job is no longer live (the event is dropped). */
  gotActions(): boolean {
    return sendIfAble(this.#machine, 'actions');
  }

  finish(): boolean {
    return sendIfAble(this.#machine, 'done');
  }

  /** The user pressed Stop. Aborts the request. */
  stop(): boolean {
    const moved = sendIfAble(this.#machine, 'stop');
    if (moved) this.controller.abort();
    return moved;
  }

  fail(kind: string, message: string): boolean {
    const moved = sendIfAble(this.#machine, 'fail');
    if (moved) {
      this.reason.kind = kind;
      this.reason.message = message;
      this.controller.abort();
    }
    return moved;
  }

  /** A newer request takes over. Aborts the request. */
  replace(): boolean {
    const moved = sendIfAble(this.#machine, 'replace');
    if (moved) this.controller.abort();
    return moved;
  }
}

/** One line of the conversation the panel shows. */
export interface AgentEntry {
  readonly id: number;
  /** `you` is the user's words, `agent` what the agent did, `notice` what went wrong or was stopped. */
  readonly who: 'you' | 'agent' | 'notice';
  readonly text: string;
}

/** The conversation keeps at most this many lines. */
export const ENTRIES_MAX = 200;

const CREATING = new Set(['write', 'shape', 'arrow', 'stroke', 'figure', 'mark']);
const clip = (t: string, n = 40): string => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** What an action did, in a few words, from the action and its result (rule 4: say only what the results report). */
export function describeResult(raw: unknown, result: ActionResult): { readonly text: string; readonly good: boolean } {
  const a = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const op = typeof a['op'] === 'string' ? a['op'] : 'action';
  if (!result.ok) return { text: `Could not ${op}: ${result.message}`, good: false };
  const lost = result.lineErrors !== undefined && result.lineErrors.length > 0 ? ` (${result.lineErrors.length} ${result.lineErrors.length === 1 ? 'line' : 'lines'} did not run)` : '';
  switch (op) {
    case 'write':
      return { text: `Wrote “${clip(String(a['text'] ?? ''))}”`, good: true };
    case 'shape':
      return { text: `Drew a ${String(a['kind'] ?? 'shape')}`, good: true };
    case 'arrow':
      return { text: 'Drew an arrow', good: true };
    case 'stroke':
      return { text: 'Drew a stroke', good: true };
    case 'figure':
      return { text: `Made a figure card${lost}`, good: true };
    case 'mark':
      return { text: `Marked it (${String(a['how'] ?? 'mark')})`, good: true };
    case 'point':
      return { text: 'Pointed at it', good: true };
    case 'move':
      return { text: 'Moved a shape', good: true };
    case 'edit':
      return { text: `Changed a shape${lost}`, good: true };
    case 'delete':
      return { text: 'Deleted a shape', good: true };
    case 'camera':
      return { text: 'Moved the view', good: true };
    case 'page':
      return { text: 'Went to a page', good: true };
    default:
      return { text: `Did ${op}`, good: true };
  }
}

export interface AgentServiceOptions {
  readonly transport?: BoardAgentTransport;
  readonly onError?: ErrorSink;
}

/** The choices on which the user asks the agent to change a figure they made. */
export const EDITS_MINE: readonly CircleChoice[] = ['slider', 'animate'];

/** The agent of one board: the runner, the transport, the jobs and the conversation. */
export class AgentService {
  readonly runner: BoardAgent;
  readonly #onError: ErrorSink | undefined;
  readonly #jobs: AgentJob[] = [];
  readonly #entries: AgentEntry[] = [];
  readonly #listeners = new Set<() => void>();
  #transport: BoardAgentTransport | undefined;
  #nextEntry = 1;
  #started = 0;

  constructor(runner: BoardAgent, options: AgentServiceOptions = {}) {
    this.runner = runner;
    this.#transport = options.transport;
    this.#onError = options.onError;
  }

  /** True when a transport is set: without one `ask` says the agent is unavailable. */
  get available(): boolean {
    return this.#transport !== undefined;
  }

  setTransport(transport: BoardAgentTransport | undefined): void {
    this.#transport = transport;
    this.#changed();
  }

  /** The conversation, oldest first. */
  get entries(): readonly AgentEntry[] {
    return this.#entries;
  }

  /** The newest job, or undefined before any request. */
  get job(): AgentJob | undefined {
    return this.#jobs[this.#jobs.length - 1];
  }

  /** How many requests were sent since the board opened (the panel opens when it grows). */
  get started(): number {
    return this.#started;
  }

  /** True while the newest job waits for the server or works on its answer. */
  get busy(): boolean {
    return this.job?.live === true;
  }

  /** Calls `listener` when the conversation or the job changes. Returns the function that stops it. */
  on(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  /** Writes a line in the conversation (the panel and the circle use it). */
  say(who: AgentEntry['who'], text: string): void {
    this.#entries.push({ id: this.#nextEntry++, who, text });
    if (this.#entries.length > ENTRIES_MAX) this.#entries.splice(0, this.#entries.length - ENTRIES_MAX);
    this.#changed();
  }

  /** The user says something to the talking agent (design 11.2); the board in view goes with it. */
  async talk(text: string, allowEdit = false): Promise<BoardResult<AgentOutcome>> {
    const words = typeof text === 'string' ? text.trim() : '';
    if (words === '') return boardError('bad_argument', 'Write what you want the agent to do.', { detail: { field: 'text' } });
    const read = this.runner.read();
    if (!read.ok) return read;
    return this.ask({ kind: 'talk', text: words, items: read.value.items, more: read.value.more, page: read.value.page, allowEdit }, words);
  }

  /** Ends the running job at once; what it drew stays. */
  stop(): void {
    const job = this.job;
    if (job === undefined || !job.stop()) return;
    this.runner.stop();
    this.say('notice', 'Stopped. What the agent drew so far stays.');
  }

  /**
   * Sends a request and applies the answer as it streams in. `say` is the user's words for the conversation. Returns
   * what the job made, or `agent_unavailable` (no transport, or it failed with nothing made) or `agent_partial` (it
   * stopped or failed part of the way: what it made stays). Nothing throws.
   */
  async ask(request: BoardAgentRequest, say: string): Promise<BoardResult<AgentOutcome>> {
    const transport = this.#transport;
    if (transport === undefined) {
      const none = boardError('agent_unavailable', 'There is no agent: no server or transport was set.', { hint: 'Pass the agent option to createBoard, or draw by hand.' });
      this.#report(none);
      this.say('notice', none.message);
      return none;
    }
    const older = this.job;
    if (older !== undefined && older.replace()) this.runner.stop();
    this.runner.forget();
    const job = new AgentJob(request, () => this.#onError);
    this.#jobs.push(job);
    if (this.#jobs.length > 20) this.#jobs.splice(0, this.#jobs.length - 20);
    job.start();
    this.#started++;
    this.say('you', say);
    // the whole answer is one gesture: one undo takes all of it back
    const gesture = beginGesture(this.runner.core, 'model');
    const allow = request.kind === 'talk' ? request.allowEdit : EDITS_MINE.includes(request.choice);
    // the pieces of the agent's words, joined into one line of the conversation when the answer ends
    const said: string[] = [];
    try {
      for await (const event of transport(request, job.controller.signal)) {
        if (!job.live) break;
        if ('say' in event) {
          if (typeof event.say !== 'string') {
            job.fail('bad_stream', 'The server sent words that are not text.');
            break;
          }
          said.push(event.say);
        } else if ('actions' in event) {
          if (!Array.isArray(event.actions)) {
            job.fail('bad_stream', 'The server sent actions that are not a list.');
            break;
          }
          job.gotActions();
          await this.#apply(job, event.actions, allow, gesture);
        } else if ('done' in event) {
          job.finish();
          break;
        } else if ('error' in event) {
          job.fail(event.error.kind, event.error.message);
          break;
        } else {
          job.fail('bad_stream', 'The server sent an answer that is not actions.');
          break;
        }
      }
    } catch (e) {
      job.fail('transport', e instanceof Error ? e.message : 'the request failed');
    }
    // an answer that ended with no `done` and was not stopped did not finish
    if (job.live) job.fail('ended', 'The answer ended before it was finished.');
    gesture.commit();
    // a replaced job's words are not shown: a newer request has begun and its lines follow the user's
    const words = job.state === 'replaced' ? '' : said.join('').trim();
    if (words !== '') this.say('agent', words);
    const outcome = this.#outcome(job, words !== '');
    this.#changed();
    return outcome;
  }

  async #apply(job: AgentJob, actions: readonly unknown[], allowForeign: boolean, gesture: Gesture): Promise<void> {
    const run = await this.runner.run({ actions }, { allowForeign, gesture });
    if (!run.ok) {
      job.failed.push(run);
      this.say('notice', run.message);
      this.#report(run);
      return;
    }
    run.value.forEach((result, i) => {
      const raw = actions[i];
      const op = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)['op'] : undefined;
      const said = describeResult(raw, result);
      if (result.ok) {
        if (result.id !== undefined && typeof op === 'string' && CREATING.has(op)) job.made.push(result.id);
      } else if (result.kind !== 'agent_partial') {
        job.failed.push(result);
        this.#report(result);
      }
      if (result.ok || result.kind !== 'agent_partial') this.say(said.good ? 'agent' : 'notice', said.text);
    });
  }

  #outcome(job: AgentJob, spoke: boolean): BoardResult<AgentOutcome> {
    const outcome: AgentOutcome = { made: [...job.made], failed: [...job.failed] };
    if (job.state === 'done') {
      if (job.made.length === 0 && job.failed.length === 0 && !spoke) this.say('notice', 'The agent made nothing.');
      return ok(outcome);
    }
    const detail = { made: outcome.made, failed: outcome.failed.map((f) => ({ kind: f.kind, message: f.message })) };
    let error: BoardError;
    if (job.state === 'failed' && job.made.length === 0) {
      error = boardError('agent_unavailable', `The agent could not answer: ${job.reason.message}`, { hint: 'Try again, or draw by hand.', detail: { ...detail, serverKind: job.reason.kind } });
      this.say('notice', error.message);
    } else {
      const why = job.state === 'stopped' ? 'stopped' : job.state === 'replaced' ? 'was replaced by a newer request' : `failed: ${job.reason.message}`;
      error = boardError('agent_partial', `The agent ${why} after making ${job.made.length} ${job.made.length === 1 ? 'thing' : 'things'}.`, {
        hint: 'What it made stays. Try the request again, or undo.',
        detail: { ...detail, reason: job.state },
      });
      if (job.state === 'failed') this.say('notice', error.message);
    }
    this.#report(error);
    return error;
  }

  #report(error: BoardError): void {
    try {
      this.#onError?.(error);
    } catch {
      // the host's listener failed; there is nobody to tell
    }
  }

  #changed(): void {
    for (const l of [...this.#listeners]) {
      try {
        l();
      } catch (e) {
        this.#report(boardError('internal', `A listener of the agent threw: ${e instanceof Error ? e.message : 'unknown'}.`));
      }
    }
  }
}
