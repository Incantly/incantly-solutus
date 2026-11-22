/**
 * The lesson as a conversation on the board (lesson design 1, 6, docs/state-machines.md LE2): the learner says or types
 * what to learn, the teacher plans, speaks, writes and sketches on the board, asks something, and the microphone opens
 * again by itself. It goes on turn after turn until the learner ends it or the server says it ended. The conversation is
 * one field over `CONVERSATION_MACHINE`: `off`, `listening`, `thinking`, `speaking`, `paused`.
 *
 * It reuses the voice lesson's sentence queue and speech (`voice.ts`): each sentence asks for its audio when it is queued,
 * so the next one is made while this one plays, and a sentence whose audio failed is spoken with the browser's voice. The
 * microphone exists only in `listening` and the teacher is heard only in `thinking` and `speaking`, so the microphone never
 * hears the teacher; a barge-in is a tap on the microphone or Space. Where the browser cannot listen, `listening` is the
 * text box's turn. 8 seconds of silence pause the lesson.
 *
 * `say` goes into the transcript and the voice, `actions` go to the board through its agent runner (one undo step for each
 * answer, `ConversationTarget`), `lesson` replaces the plan view. Everything the browser or the server provides comes in
 * through `ConversationOptions`, so a test gives its own. Nothing throws.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import { endLesson, startLesson, streamLessonTurn } from './lesson-client';
import type { LessonBoard, LessonView } from './lesson-client';
import { SentenceQueue, TRANSCRIPT_MAX, speakSentence } from './voice';
import type { BrowserVoice, Clip, ClipSource, Recogniser, VoiceLine } from './voice';

export type ConversationState = 'off' | 'listening' | 'thinking' | 'speaking' | 'paused';
export type ConversationMove = 'start' | 'listen' | 'heard' | 'type' | 'play' | 'wait' | 'drained' | 'pause' | 'end';

/** docs/state-machines.md LE2. */
export const CONVERSATION_MACHINE: MachineTable<ConversationState, ConversationMove> = {
  off: { start: 'thinking', listen: 'listening' },
  listening: { heard: 'thinking', type: 'thinking', pause: 'paused', end: 'off' },
  thinking: { play: 'speaking', drained: 'listening', listen: 'listening', type: 'thinking', pause: 'paused', end: 'off' },
  speaking: { play: 'speaking', wait: 'thinking', drained: 'listening', listen: 'listening', type: 'thinking', pause: 'paused', end: 'off' },
  paused: { listen: 'listening', type: 'thinking', end: 'off' },
};

/** What the conversation acts on: the board the lesson is held on. */
export interface ConversationTarget {
  /** The board in view, sent with the lesson's first request and with every turn. */
  board(): LessonBoard;
  /** A turn begins: the board forgets what `$last` named and opens the gesture of the answer (one undo step). */
  begin(): void;
  /** Board actions of the turn; resolves when they are applied. */
  actions(actions: readonly unknown[]): Promise<void>;
  /** The turn ended (`stopped` false) or was stopped by a barge-in or an end (`stopped` true): the answer's gesture is committed. */
  finish(stopped: boolean): void;
}

/** Starts a timer; gives the function that cancels it. */
export type SilenceTimer = (fire: () => void, ms: number) => () => void;

export interface ConversationOptions {
  /** The board now, or undefined when there is none (the lesson then says so). */
  readonly target: () => ConversationTarget | undefined;
  readonly clips: ClipSource;
  readonly browserVoice?: BrowserVoice | undefined;
  /** Makes a recogniser; undefined where the browser cannot listen (the text box is then the input). */
  readonly recogniser?: (() => Recogniser | undefined) | undefined;
  /** True where the recogniser works, so a panel shows the microphone. */
  readonly canListen?: boolean;
  readonly fetch?: typeof fetch;
  /** How long the microphone may hear nothing before the lesson pauses; default 8 s. */
  readonly silenceMs?: number;
  /** For tests; default `setTimeout`. */
  readonly timer?: SilenceTimer;
  /** Called after every change of state, transcript or plan. */
  readonly onChange?: () => void;
  /** Hears a refused move of the machine (a bug). */
  readonly onFault?: (from: ConversationState, move: ConversationMove) => void;
}

/** 8 seconds of silence pause the lesson (design 6). */
export const SILENCE_MS = 8000;

/** What the server said about a turn: it goes on, or the lesson is over (the learner stopped it, the last turn, or it is gone). */
type TurnOutcome = 'open' | 'ended' | 'gone';

/** One turn: what stops it, the sentences it speaks, the board it works on, and what the server said about its end. */
interface ConversationRun {
  readonly controller: AbortController;
  readonly queue: SentenceQueue;
  readonly target: ConversationTarget;
  outcome: TurnOutcome;
}

/** The open microphone and the silence timer: one record, made on the move into `listening` and closed on every move out. */
interface Ear {
  readonly recogniser: Recogniser;
  cancelSilence: () => void;
}

/** The plan view before the server has sent one. */
const FRESH_VIEW: LessonView = { plan: [], step: 0, state: 'new' };

const browserTimer: SilenceTimer = (fire, ms) => {
  const id = setTimeout(fire, ms);
  return () => clearTimeout(id);
};

/** What to tell the learner when the microphone failed: the reason, and that typing works. */
export function microphoneMessage(failure: string): string {
  if (failure === 'not-allowed' || failure === 'service-not-allowed') return 'The microphone is blocked on this page. Allow it in the browser, or type your answer.';
  return `The microphone stopped (${failure}). You can type your answer.`;
}

export class LessonConversation {
  readonly #machine: StateMachine<ConversationState, ConversationMove>;
  readonly #options: ConversationOptions;
  readonly #lines: VoiceLine[] = [];
  /** The last `lesson` event of the server: plan and step. Data shown at the top of the panel, never decided on. */
  #view: LessonView = FRESH_VIEW;
  /** The server's id of this lesson: set when `/start` answered, dropped when the conversation goes `off`. */
  #lessonId: string | undefined;
  /** The turn in progress; dropped when the conversation leaves `thinking` and `speaking`. */
  #run: ConversationRun | undefined;
  /** The open microphone; closed on every move out of `listening`. */
  #ear: Ear | undefined;
  /** What the microphone has heard so far (interim, never sent). */
  #interim = '';
  #nextLine = 1;

  constructor(options: ConversationOptions) {
    this.#options = options;
    this.#machine = new StateMachine(CONVERSATION_MACHINE, 'off', (from, move) => options.onFault?.(from, move));
  }

  get state(): ConversationState {
    return this.#machine.state;
  }

  get transcript(): readonly VoiceLine[] {
    return this.#lines;
  }

  /** The plan and the step now, as the server last sent them. */
  get view(): LessonView {
    return this.#view;
  }

  /** The words heard so far while listening. */
  get interim(): string {
    return this.#interim;
  }

  /** True where the browser can listen: the microphone button works. */
  get canListen(): boolean {
    return this.#options.canListen === true;
  }

  /** True while the microphone is open (in `listening` where the browser can listen). */
  get micOpen(): boolean {
    return this.#ear !== undefined;
  }

  // ---- what the learner does

  /** Starts a lesson with the learner's first words. False when there are none or a lesson is on. */
  start(text: string): boolean {
    const words = text.trim();
    if (words === '' || !this.#machine.can('start')) return false;
    this.#fresh();
    this.#machine.send('start');
    this.#begin(words);
    return true;
  }

  /** The microphone: from `off` it starts a lesson by listening; elsewhere it interrupts the teacher and listens. False when it cannot. */
  listen(): boolean {
    if (!this.#machine.can('listen')) return false;
    const fromOff = this.#machine.state === 'off';
    if (fromOff && !this.canListen) return false;
    if (fromOff) this.#fresh();
    else this.#abandon();
    this.#machine.send('listen');
    this.#openEar();
    this.#changed();
    return true;
  }

  /** A tap on the microphone button: pauses while listening, else interrupts and listens. */
  tap(): boolean {
    return this.#machine.state === 'listening' ? this.pause() : this.listen();
  }

  /** Space: interrupts the teacher (or a paused lesson) and listens. False in `off` and `listening`. */
  interrupt(): boolean {
    const now = this.#machine.state;
    return now === 'thinking' || now === 'speaking' || now === 'paused' ? this.listen() : false;
  }

  /** The learner typed `text`. A barge-in when the teacher is talking. False when there is nothing to send or no lesson is on. */
  type(text: string): boolean {
    const words = text.trim();
    if (words === '' || !this.#machine.can('type')) return false;
    this.#abandon();
    this.#machine.send('type');
    this.#begin(words);
    return true;
  }

  /** Stops everything and waits (the panel was closed, or the learner paused it). The lesson stays. */
  pause(): boolean {
    if (!this.#machine.can('pause')) return false;
    this.#abandon();
    this.#machine.send('pause');
    this.#changed();
    return true;
  }

  /** The End button: stops everything, and the server forgets the lesson. */
  end(): boolean {
    if (!this.#machine.can('end')) return false;
    const id = this.#lessonId;
    this.#goOff();
    if (id !== undefined) void endLesson(id, undefined, this.#options.fetch);
    return true;
  }

  dispose(): void {
    this.#abandon();
    this.#lines.length = 0;
  }

  // ---- the microphone

  /** Opens the microphone and the silence timer, where the browser can listen. */
  #openEar(): void {
    const recogniser = this.#options.recogniser?.();
    if (recogniser === undefined) return;
    const timer = this.#options.timer ?? browserTimer;
    const ear: Ear = { recogniser, cancelSilence: () => undefined };
    this.#ear = ear;
    this.#interim = '';
    ear.cancelSilence = timer(() => this.#onSilence(recogniser), this.#options.silenceMs ?? SILENCE_MS);
    recogniser.start({
      onText: (text, final) => this.#onHeard(recogniser, text, final),
      onEnd: (failure) => this.#onEarEnd(recogniser, failure),
    });
  }

  #closeEar(): void {
    const ear = this.#ear;
    this.#ear = undefined;
    this.#interim = '';
    if (ear === undefined) return;
    ear.cancelSilence();
    ear.recogniser.stop();
  }

  #onSilence(recogniser: Recogniser): void {
    if (this.#ear?.recogniser === recogniser) this.pause();
  }

  #onHeard(recogniser: Recogniser, text: string, final: boolean): void {
    const ear = this.#ear;
    if (ear?.recogniser !== recogniser || !this.#machine.can('heard')) return;
    // somebody is speaking: the silence timer is done
    if (text !== '') ear.cancelSilence();
    this.#interim = text;
    if (!final || text === '') {
      this.#changed();
      return;
    }
    this.#closeEar();
    this.#machine.send('heard');
    this.#begin(text);
  }

  #onEarEnd(recogniser: Recogniser, failure: string | undefined): void {
    if (this.#ear?.recogniser !== recogniser) return;
    const words = this.#interim.trim();
    this.#closeEar();
    if (failure !== undefined) {
      this.#note('notice', microphoneMessage(failure));
    } else if (words !== '' && this.#machine.can('heard')) {
      // the browser ended the recognition on words it had not marked final: they were said, so they are sent
      this.#machine.send('heard');
      this.#begin(words);
      return;
    }
    this.pause();
  }

  // ---- a turn

  /** Clears what the last lesson left: a new lesson begins on an empty transcript and plan. */
  #fresh(): void {
    this.#lines.length = 0;
    this.#view = FRESH_VIEW;
    this.#interim = '';
  }

  /** Stops what the lesson is doing: the microphone, the clip, the queue and the request, and commits the board's gesture. */
  #abandon(): void {
    this.#closeEar();
    const run = this.#run;
    this.#run = undefined;
    if (run === undefined) return;
    run.controller.abort();
    run.queue.clear();
    run.target.finish(true);
  }

  /** The lesson is over here: everything is stopped, and the conversation is `off`. */
  #goOff(): void {
    this.#abandon();
    if (this.#machine.can('end')) this.#machine.send('end');
    this.#lessonId = undefined;
    this.#changed();
  }

  #note(who: VoiceLine['who'], text: string): void {
    this.#lines.push({ id: this.#nextLine++, who, text });
    if (this.#lines.length > TRANSCRIPT_MAX) this.#lines.splice(0, this.#lines.length - TRANSCRIPT_MAX);
    this.#changed();
  }

  #changed(): void {
    try {
      this.#options.onChange?.();
    } catch {
      // the panel failed to refresh; the lesson goes on
    }
  }

  #begin(text: string): void {
    const target = this.#options.target();
    if (target === undefined) {
      this.#note('notice', 'There is no board to teach on here.');
      this.#goOff();
      return;
    }
    const run: ConversationRun = { controller: new AbortController(), queue: new SentenceQueue(), target, outcome: 'open' };
    this.#run = run;
    this.#note('you', text);
    target.begin();
    void this.#turn(run, text);
    void this.#player(run);
  }

  /** The lesson's id: the one held, or a new lesson from the server (the first turn). Undefined when it could not be made. */
  async #lessonFor(run: ConversationRun): Promise<string | undefined> {
    const known = this.#lessonId;
    if (known !== undefined) return known;
    const started = await startLesson({ board: run.target.board() }, run.controller.signal, this.#options.fetch);
    if (this.#run !== run) return undefined;
    if (!started.ok) {
      // a lesson that could not start is over: the notice says why, and the panel offers Start lesson
      if (started.kind !== 'aborted') this.#note('notice', started.message);
      run.outcome = 'gone';
      return undefined;
    }
    this.#lessonId = started.lessonId;
    return started.lessonId;
  }

  /** Reads the turn's events as they come: sentences are queued for the voice, board actions are applied at once. */
  async #turn(run: ConversationRun, text: string): Promise<void> {
    try {
      const id = await this.#lessonFor(run);
      if (id === undefined || this.#run !== run) return;
      const request = { lessonId: id, text, board: run.target.board() };
      for await (const ev of streamLessonTurn(request, run.controller.signal, this.#options.fetch)) {
        if (this.#run !== run) return;
        if ('say' in ev) {
          this.#note('teacher', ev.say);
          run.queue.push({ kind: 'say', text: ev.say, clip: this.#options.clips(ev.say, run.controller.signal) });
        } else if ('actions' in ev) {
          await run.target.actions(ev.actions);
        } else if ('lesson' in ev) {
          this.#view = ev.lesson;
          this.#changed();
        } else if ('error' in ev) {
          if (ev.error.kind === 'lesson_unknown') {
            run.outcome = 'gone';
            this.#note('notice', 'This lesson has ended. Start a new lesson to go on.');
          } else this.#note('notice', ev.error.message);
          break;
        } else {
          if (ev.ended === true) run.outcome = 'ended';
          break;
        }
      }
    } catch {
      if (this.#run === run) this.#note('notice', 'The lesson stopped.');
    } finally {
      if (this.#run === run) run.queue.push({ kind: 'end' });
    }
  }

  /** Plays the queue in order. The state follows what is audible: `speaking` while a clip plays, `thinking` between sentences. */
  async #player(run: ConversationRun): Promise<void> {
    const signal = run.controller.signal;
    for (;;) {
      const item = await run.queue.take(signal);
      if (this.#run !== run || item === undefined) return;
      if (item.kind === 'end') {
        this.#run = undefined;
        run.target.finish(false);
        if (run.outcome !== 'open') this.#goOff();
        else if (this.#machine.can('drained')) {
          this.#machine.send('drained');
          this.#openEar();
        }
        this.#changed();
        return;
      }
      const clip: Clip | undefined = await item.clip.catch(() => undefined);
      if (this.#run !== run) {
        clip?.dispose();
        return;
      }
      if (this.#machine.can('play')) this.#machine.send('play');
      this.#changed();
      await speakSentence(item.text, clip, signal, this.#options.browserVoice);
      if (this.#run !== run) return;
      // the clip ended: with nothing queued the teacher is thinking again until the next sentence is ready
      if (run.queue.size === 0 && this.#machine.can('wait')) {
        this.#machine.send('wait');
        this.#changed();
      }
    }
  }
}
