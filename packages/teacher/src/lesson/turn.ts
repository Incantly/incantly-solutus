/**
 * The job `lesson` (lesson design 3, 5, 7; agent.md 1): one turn of a lesson. What the learner said and the board in view
 * come in, with the lesson's memory; a stream of turn events goes out: `say` (whole sentences, ready for the voice),
 * `actions` (the board actions that passed their checks), `lesson` (the plan and the step, when a lesson tool ran) and a
 * last `done` or `error`. The turn runs over the board target, with `board_read`, `board`, `lesson_plan` and `lesson_step`.
 *
 * Two rules of the turn live here. A board action equal to one the turn already sent is answered "already done" and not
 * sent again (TR-49); a `page` action starts the count again, since the same note on a new page is a new action. And a
 * learner who asks to end the lesson ("stop", "end the lesson", "that's all") gets a closing turn that only summarises,
 * with `done` carrying `ended: true`; only the learner ends a lesson, so the model has no tool for it.
 *
 * The memory is written as the turn goes (the plan, the step), and the turn is recorded in it when it ends with `done` and
 * was not stopped. Nothing here throws. No DOM, timers, network or `Date`.
 */
import { streamErrorOf } from '../errors';
import type { TurnRequest } from '../prompt/build';
import { LESSON_END_INSTRUCTION } from '../prompt/jobs';
import { SentenceSplitter } from '../stream/sentences';
import { boardTarget } from '../tools/board-target';
import type { BoardRequestData } from '../tools/board-target';
import type { TargetOptions } from '../tools/targets';
import { toolset } from '../tools/toolset';
import type { BoardCheck, BoardPort, Target } from '../tools/types';
import type { ModelClient } from '../loop/model';
import { runTurn } from '../loop/turn';
import type { TurnEvent, TurnLimits } from '../loop/turn';
import { historyOf, memoryBlock, newMemory, recordTurn } from './memory';
import type { LessonMemory } from './memory';
import { lessonTools } from './tools';

export interface LessonTurnOptions {
  readonly client: ModelClient;
  /** The lesson's memory. The tools write into it; the turn is recorded in it when it ends. */
  readonly memory: LessonMemory;
  /** The board in view. */
  readonly board: BoardRequestData;
  /** What the learner said or typed. */
  readonly text: string;
  /** The app mode the board's figure cards use (default `graphing`). */
  readonly mode?: string;
  readonly signal?: AbortSignal;
  readonly now: () => number;
  readonly limits?: Partial<TurnLimits>;
  /** Hears a refused move of the target's machines (a bug). */
  readonly onFault?: TargetOptions['onFault'];
}

const PUNCT = /[^\p{L}\p{N}\s]/gu;
const FILLER_HEAD = /^(?:ok|okay|alright|all right|well|so|yes|yeah|um|uh|please)\s+/;
const FILLER_TAIL = /\s+(?:please|thanks|thank you)$/;

/** What a learner says, whole, to end the lesson (design 3, last row). A longer sentence that holds one of these words is not an end. */
const END_PHRASES: ReadonlySet<string> = new Set([
  'stop', 'stop it', 'stop now', 'stop here', 'stop the lesson', 'stop lesson', 'stop the lesson now', 'stop teaching', 'stop the class',
  'end', 'end it', 'end now', 'end the lesson', 'end lesson', 'end the lesson now', 'end the class', 'end class',
  'finish', 'finish the lesson', 'quit', 'quit the lesson',
  'thats all', 'that is all', 'thats it', 'that is it', 'im done', 'i am done', 'were done', 'we are done', 'no more',
  'i want to stop', 'i want to end the lesson', 'i want to stop the lesson', 'lets stop', 'lets stop here', 'lets end', 'lets end it', 'lets end the lesson',
  'bye', 'goodbye', 'good bye',
]);

/** True when the learner's words, as a whole, ask to end the lesson. Punctuation, case and a polite word at either end do not matter. */
export function isEndRequest(text: string): boolean {
  let t = text.toLowerCase().replace(/['’]/g, '').replace(PUNCT, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3 && FILLER_HEAD.test(t); i++) t = t.replace(FILLER_HEAD, '');
  t = t.replace(FILLER_TAIL, '');
  return END_PHRASES.has(t);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The action as one string that is the same for equal actions, whatever the order of its keys. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isObject(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

/**
 * The board port of a turn that does not send an action twice (TR-49). A passed action's key is kept for the rest of the
 * turn; an equal action is answered "already done" and not checked or sent again. An action that names `$last` is the same
 * only while nothing was sent between the two (`$last` is then the same shape). A `page` action that passed empties the keys.
 */
class OnceBoard implements BoardPort {
  /** Keys of the actions that passed in this turn, on this page. */
  private readonly passed = new Set<string>();
  /** How many actions passed in the turn; it tells two `$last` apart. */
  private sent = 0;

  constructor(private readonly inner: BoardPort) {}

  get page(): string {
    return this.inner.page;
  }

  read(input: unknown): ReturnType<BoardPort['read']> {
    return this.inner.read(input);
  }

  describe(): ReturnType<BoardPort['describe']> {
    return this.inner.describe();
  }

  check(actions: readonly unknown[]): readonly BoardCheck[] {
    return actions.map((raw) => this.checkOne(raw));
  }

  private keyOf(raw: unknown): string | undefined {
    if (!isObject(raw)) return undefined;
    const key = canonical(raw);
    return key.includes('"$last"') ? `${key}@${this.sent}` : key;
  }

  private checkOne(raw: unknown): BoardCheck {
    const key = this.keyOf(raw);
    if (key !== undefined && this.passed.has(key)) {
      return { result: { ok: true, already: 'done', message: 'This action is already done in this answer, so it was not sent again.' } };
    }
    const checked = this.inner.check([raw])[0] ?? { result: { ok: false } };
    if (checked.send !== undefined) {
      if (isObject(raw) && raw['op'] === 'page') this.passed.clear();
      this.sent += 1;
      // the key is made after the count, so an action that names `$last` is the same only until the next one passes
      const after = this.keyOf(raw);
      if (after !== undefined) this.passed.add(after);
    }
    return checked;
  }
}

/** The target of the lesson: the board target with its port wrapped so a repeated action is not sent twice. */
function lessonTarget(o: LessonTurnOptions): Target {
  const target = boardTarget(o.board, { mode: o.mode ?? 'graphing', allowEdit: false, ...(o.onFault !== undefined ? { onFault: o.onFault } : {}) });
  return target.board === undefined ? target : { ...target, board: new OnceBoard(target.board) };
}

async function* run(o: LessonTurnOptions): AsyncGenerator<TurnEvent> {
  const ending = isEndRequest(o.text);
  const tools = ending ? toolset(['board_read']) : toolset(['board_read', 'board'], lessonTools(o.memory));
  if (!tools.ok) {
    yield { error: streamErrorOf(tools) };
    return;
  }
  if (o.memory.topic === '' && o.memory.turns.length === 0 && !ending) o.memory.topic = newMemory(o.text).topic;
  const history = historyOf(o.memory);
  const memory = memoryBlock(o.memory);
  const request: TurnRequest = {
    text: o.text,
    ...(ending ? { instruction: LESSON_END_INSTRUCTION } : {}),
    ...(history.length > 0 ? { history } : {}),
    ...(memory !== '' ? { memory } : {}),
  };
  const splitter = new SentenceSplitter();
  const said: string[] = [];
  const flush = function* (): Generator<TurnEvent> {
    for (const sentence of splitter.flush()) {
      said.push(sentence);
      yield { say: sentence };
    }
  };
  for await (const ev of runTurn({
    job: 'lesson',
    client: o.client,
    toolset: tools.value,
    target: lessonTarget(o),
    request,
    now: o.now,
    ...(o.signal !== undefined ? { signal: o.signal } : {}),
    ...(o.limits !== undefined ? { limits: o.limits } : {}),
  })) {
    if ('say' in ev) {
      for (const sentence of splitter.push(ev.say)) {
        said.push(sentence);
        yield { say: sentence };
      }
      continue;
    }
    // anything but words ends the sentence being written: a reply's text comes before its tool calls
    yield* flush();
    if ('done' in ev && o.signal?.aborted !== true) {
      if (!ending) recordTurn(o.memory, o.text, said.join(' '));
      yield ending ? { ...ev, ended: true } : ev;
      continue;
    }
    yield ev;
  }
}

/**
 * Runs one turn of a lesson. Every `say` is a whole sentence. The last event is `done` (with `ended: true` when the
 * learner asked to end the lesson) or `error`. Never throws.
 */
export function lessonTurn(options: LessonTurnOptions): AsyncIterable<TurnEvent> {
  return run(options);
}
