/**
 * The lessons the server holds (lesson design 4, 6, 7; docs/state-machines.md LE1). Each lesson is one field over
 * `LESSON_MACHINE` and its memory (plain data, in the server's memory only). The store is a map of lessons by id with
 * three limits, all read from the injected clock when a call reaches the store, never by a timer: a lesson idle for 15
 * minutes ends, a lesson ends when its 200th turn ends, and at most 100 are held (a new one past that ends the idle lesson
 * with the oldest last call).
 *
 * Nothing here throws, and nothing awaits: a call reads and changes the store in one step.
 */
import { randomUUID } from 'node:crypto';
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import { newMemory } from '@incantly/teacher';
import type { LessonMemory } from '@incantly/teacher';
import { internalError, lessonBusy, lessonFull, lessonUnknown } from '../errors';
import type { ServerError } from '../errors';

export type LessonState = 'new' | 'planning' | 'teaching' | 'waiting' | 'ended';
export type LessonMove = 'begin' | 'planned' | 'replan' | 'turnEnd' | 'speak' | 'end';

/** docs/state-machines.md LE1. `ended` takes no event. */
export const LESSON_MACHINE: MachineTable<LessonState, LessonMove> = {
  new: { begin: 'planning', end: 'ended' },
  planning: { planned: 'teaching', turnEnd: 'waiting', end: 'ended' },
  teaching: { turnEnd: 'waiting', end: 'ended' },
  waiting: { speak: 'teaching', replan: 'planning', end: 'ended' },
  ended: {},
};

export interface LessonLimits {
  /** A lesson with no turn for this long ends. */
  readonly idleMs: number;
  /** A lesson ends when this many turns have begun and the last one ends. */
  readonly turns: number;
  /** Lessons held at once. */
  readonly held: number;
}

/** Lesson design 4: 15 minutes idle, 200 turns, 100 lessons. */
export const LESSON_STORE_LIMITS: LessonLimits = { idleMs: 15 * 60_000, turns: 200, held: 100 };

export interface StoreOptions {
  readonly limits?: Partial<LessonLimits>;
  /** Makes a lesson id; default `crypto.randomUUID`. */
  readonly newId?: () => string;
  /** Hears a refused move of a lesson's machine (a bug). */
  readonly onFault?: (from: string, event: string) => void;
}

/** The turn that runs: its number, the client that started it and what stops it. One record, so it cannot half exist. */
interface Run {
  readonly turn: number;
  readonly client: string;
  readonly stop: () => void;
}

/** The record of a lesson with no turn running. */
const NO_RUN: Run = { turn: 0, client: '', stop: () => undefined };

/** One lesson: its machine, its memory and what the limits need. */
export class Lesson {
  /** The memory the lesson tools write into and the prompt reads. */
  readonly memory: LessonMemory;
  private readonly machine: StateMachine<LessonState, LessonMove>;
  private run: Run = NO_RUN;
  /** Turns begun; a turn's number, never reused. */
  private began = 0;
  /** The time of the last call that began or ended a turn, from the injected clock. */
  private touched: number;

  constructor(
    readonly id: string,
    /** The app mode the board's figure cards use. */
    readonly mode: string,
    topic: string,
    at: number,
    onFault: ((from: string, event: string) => void) | undefined,
  ) {
    this.memory = newMemory(topic);
    this.touched = at;
    this.machine = new StateMachine(LESSON_MACHINE, 'new', onFault === undefined ? undefined : (from, event) => onFault(from, event));
  }

  get state(): LessonState {
    return this.machine.state;
  }

  /** True while a turn runs: `planning` and `teaching` are the states that have one. */
  get running(): boolean {
    return this.machine.is('planning', 'teaching');
  }

  /** The client of the running turn; '' when none runs. */
  get client(): string {
    return this.run.client;
  }

  /** Turns begun so far. */
  get turns(): number {
    return this.began;
  }

  /** The time of the last call that began or ended a turn (or of the start). */
  get lastAt(): number {
    return this.touched;
  }

  /** True when `turn` is the turn that runs now. */
  current(turn: number): boolean {
    return turn !== 0 && this.run.turn === turn && this.running;
  }

  /** A turn begins. Returns its number, or 0 when the machine refused (a turn is running, or the lesson ended). */
  begin(client: string, stop: () => void, at: number): number {
    const event: LessonMove = this.machine.is('new') ? 'begin' : this.memory.plan.length > 0 ? 'speak' : 'replan';
    if (!this.machine.send(event)) return 0;
    this.began += 1;
    this.run = { turn: this.began, client, stop };
    this.touched = at;
    return this.began;
  }

  /** The turn that runs is replaced: it is stopped and counts as ended, so a new one can begin. */
  interrupt(at: number): void {
    if (!this.running) return;
    this.run.stop();
    if (this.machine.send('turnEnd')) this.run = NO_RUN;
    this.touched = at;
  }

  /** `lesson_plan` passed in `turn`: a lesson that was planning has a plan now. A turn that is not the current one changes nothing. */
  planned(turn: number): void {
    if (this.current(turn) && this.memory.plan.length > 0 && this.machine.can('planned')) this.machine.send('planned');
  }

  /** `turn` ended. False, and nothing changes, when it is not the turn that runs (it was replaced, or the lesson ended). */
  finish(turn: number, at: number): boolean {
    if (!this.current(turn)) return false;
    if (!this.machine.send('turnEnd')) return false;
    this.run = NO_RUN;
    this.touched = at;
    return true;
  }

  /** The lesson ends: its running turn is stopped. */
  end(): void {
    if (this.running) this.run.stop();
    if (this.machine.send('end')) this.run = NO_RUN;
  }
}

export class LessonStore {
  private readonly lessons = new Map<string, Lesson>();
  private readonly limits: LessonLimits;
  private readonly newId: () => string;

  constructor(
    private readonly now: () => number,
    private readonly options: StoreOptions = {},
  ) {
    this.limits = { ...LESSON_STORE_LIMITS, ...(options.limits ?? {}) };
    this.newId = options.newId ?? randomUUID;
  }

  /** Lessons held now (idle ones that ran out are counted until a call reaches them). */
  get size(): number {
    return this.lessons.size;
  }

  /** True when the lesson is over its idle time. A lesson with a turn running is never idle. */
  private idle(lesson: Lesson): boolean {
    return !lesson.running && this.now() - lesson.lastAt >= this.limits.idleMs;
  }

  private drop(lesson: Lesson): void {
    lesson.end();
    this.lessons.delete(lesson.id);
  }

  /** The lesson with this id after the idle limit was applied, or undefined. */
  private held(id: string): Lesson | undefined {
    const lesson = this.lessons.get(id);
    if (lesson === undefined) return undefined;
    if (this.idle(lesson)) {
      this.drop(lesson);
      return undefined;
    }
    return lesson;
  }

  /**
   * Makes a lesson. Idle lessons end first; at the limit the idle lesson with the oldest last call ends to make room; when
   * every lesson held has a turn running there is none to end, and the answer is `lesson_full`.
   */
  start(topic: string, mode: string): Lesson | ServerError {
    for (const lesson of [...this.lessons.values()]) if (this.idle(lesson)) this.drop(lesson);
    if (this.lessons.size >= this.limits.held) {
      let oldest: Lesson | undefined;
      for (const lesson of this.lessons.values()) if (!lesson.running && (oldest === undefined || lesson.lastAt < oldest.lastAt)) oldest = lesson;
      if (oldest === undefined) return lessonFull();
      this.drop(oldest);
    }
    const lesson = new Lesson(this.newId(), mode, topic, this.now(), this.options.onFault);
    this.lessons.set(lesson.id, lesson);
    return lesson;
  }

  /**
   * The lesson a turn from `client` may go to: `lesson_unknown` when the id is not held, `lesson_busy` when a turn of another
   * client's still runs. A turn of the same client that still runs is a barge-in: `begin` replaces it.
   */
  check(id: string, client: string): Lesson | ServerError {
    const lesson = this.held(id);
    if (lesson === undefined) return lessonUnknown();
    if (lesson.running && lesson.client !== client) return lessonBusy();
    return lesson;
  }

  /** A turn of `client` begins on `lesson` (from `check`). A turn of the same client that still runs is stopped first. Returns the turn's number, or the error. */
  begin(lesson: Lesson, client: string, stop: () => void): number | ServerError {
    if (this.lessons.get(lesson.id) !== lesson) return lessonUnknown();
    if (lesson.running) {
      if (lesson.client !== client) return lessonBusy();
      lesson.interrupt(this.now());
    }
    const turn = lesson.begin(client, stop, this.now());
    return turn === 0 ? internalError('internal:lesson.begin') : turn;
  }

  /**
   * `turn` ended. Returns whether the lesson ended with it: the learner asked to end (`endRequested`), or the turn was the
   * lesson's last of 200. A turn that is not the one that runs (replaced, or the lesson ended) changes nothing.
   */
  finish(lesson: Lesson, turn: number, endRequested: boolean): { readonly current: boolean; readonly ended: boolean } {
    if (!lesson.finish(turn, this.now())) return { current: false, ended: false };
    if (endRequested || lesson.turns >= this.limits.turns) {
      this.drop(lesson);
      return { current: true, ended: true };
    }
    return { current: true, ended: false };
  }

  /** The browser ends a lesson: it is forgotten at once and its running turn is stopped. `lesson_unknown` when it is not held. */
  end(id: string): true | ServerError {
    const lesson = this.held(id);
    if (lesson === undefined) return lessonUnknown();
    this.drop(lesson);
    return true;
  }
}
