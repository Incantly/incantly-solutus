/**
 * The voice lesson (teacher design 8, server design 6, docs/state-machines.md TE4): the learner talks or types, the
 * teacher answers through `POST /v1/teach`, and its sentences are spoken in order while its lines, board actions and film
 * controls change the figure or the board at once. The lesson's states are one field over `VOICE_MACHINE`: `idle`,
 * `listening`, `thinking`, `speaking`.
 *
 * Each sentence queued asks for its audio at once, so the next sentence is being made while this one plays. A sentence whose
 * audio failed is spoken with the browser's voice, in its place in the order. A barge-in (the learner speaks or types while
 * the teacher talks, or presses Stop) stops the clip, drops the queue and aborts the turn; an event of an old turn that
 * arrives later is ignored, because its run is no longer the current one.
 *
 * Everything the browser or the server provides comes in through `VoiceOptions`, so a test gives its own. Nothing throws.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import { streamTeach } from './teach-client';
import type { FilmControl, TeachContext, TeachTurn } from './teach-client';

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';
export type VoiceMove = 'listen' | 'heard' | 'stop' | 'type' | 'play' | 'wait' | 'drained' | 'fail';

/** docs/state-machines.md TE4. */
export const VOICE_MACHINE: MachineTable<VoiceState, VoiceMove> = {
  idle: { listen: 'listening', type: 'thinking' },
  listening: { heard: 'thinking', stop: 'idle', type: 'thinking', fail: 'idle' },
  thinking: { play: 'speaking', drained: 'idle', listen: 'listening', type: 'thinking', stop: 'idle', fail: 'idle' },
  speaking: { play: 'speaking', wait: 'thinking', drained: 'idle', listen: 'listening', type: 'thinking', stop: 'idle', fail: 'idle' },
};

/** True when the browser or the learner refused the microphone (the recogniser's `not-allowed` failures). */
export function microphoneRefused(failure: string): boolean {
  return failure === 'not-allowed' || failure === 'service-not-allowed';
}

/** A sentence of the teacher's voice, ready to play. */
export interface Clip {
  /** Plays the clip; resolves when it ends or `signal` aborts. Rejects when the audio cannot be played. */
  play(signal: AbortSignal): Promise<void>;
  dispose(): void;
}

/** Fetches the audio of a sentence. Never rejects: `undefined` means the voice is not available, and the browser's voice speaks. */
export type ClipSource = (text: string, signal: AbortSignal) => Promise<Clip | undefined>;

/** The browser's own voice. */
export interface BrowserVoice {
  /** Speaks `text`; resolves when it ends or `signal` aborts. Never rejects. */
  say(text: string, signal: AbortSignal): Promise<void>;
}

export interface RecogniserHandlers {
  /** The words heard so far; `final` when the utterance is complete. */
  onText(text: string, final: boolean): void;
  /** The recogniser ended: undefined when nobody spoke or it was stopped, else the reason it failed. */
  onEnd(failure: string | undefined): void;
}

export interface Recogniser {
  start(handlers: RecogniserHandlers): void;
  stop(): void;
}

/** What the lesson acts on: a figure of the studio, or the board. */
export interface LessonTarget {
  /** The figure's mode, script and film time (and the board in view), read when a turn begins. */
  context(): TeachContext;
  /** A new turn begins (the board forgets what `$last` named). */
  begin(): void;
  /** Lines that passed the server's checks; the target applies them to its figure (the card in focus, on a board). */
  lines(lines: readonly string[]): void;
  /** Board actions; resolves when they are applied. */
  actions(actions: readonly unknown[]): Promise<void>;
  /** A film control; on a board it acts on the card made last, or the one in focus. */
  control(control: FilmControl): void;
}

export interface VoiceOptions {
  /** The target of the lesson now, or undefined when there is none (the lesson then says so). */
  readonly target: () => LessonTarget | undefined;
  readonly clips: ClipSource;
  readonly browserVoice?: BrowserVoice | undefined;
  /** Makes a recogniser; undefined where the browser cannot listen (the text box is then the input). */
  readonly recogniser?: (() => Recogniser | undefined) | undefined;
  /** True where the recogniser works, so a panel shows the microphone. */
  readonly canListen?: boolean;
  readonly fetch?: typeof fetch;
  /** Called after every change of state or transcript. */
  readonly onChange?: () => void;
  /** Hears a refused move of the machine (a bug). */
  readonly onFault?: (from: VoiceState, move: VoiceMove) => void;
}

/** One line of the lesson's transcript. */
export interface VoiceLine {
  readonly id: number;
  readonly who: 'you' | 'teacher' | 'notice';
  readonly text: string;
}

/** The transcript keeps at most this many lines. */
export const TRANSCRIPT_MAX = 60;
/** The history sent with a request: at most these turns and characters (server design 6). */
export const HISTORY_TURNS = 10;
export const HISTORY_CHARS = 8000;

/** What one queued thing is: a sentence with the promise of its audio, or the mark that the turn ended. */
export type QueueItem = { readonly kind: 'say'; readonly text: string; readonly clip: Promise<Clip | undefined> } | { readonly kind: 'end' };

/**
 * The sentences of a turn in order. `take` waits for the next one; `clear` drops what is queued (and frees the clips
 * that were fetched) and ends a wait.
 */
export class SentenceQueue {
  readonly #items: QueueItem[] = [];
  #waiter: ((item: QueueItem | undefined) => void) | undefined;

  push(item: QueueItem): void {
    const waiter = this.#waiter;
    if (waiter !== undefined) {
      this.#waiter = undefined;
      waiter(item);
    } else this.#items.push(item);
  }

  /** The next item, waiting for one; undefined when `signal` aborts first or the queue is cleared. */
  take(signal: AbortSignal): Promise<QueueItem | undefined> {
    const next = this.#items.shift();
    if (next !== undefined) return Promise.resolve(next);
    if (signal.aborted) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const done = (item: QueueItem | undefined): void => {
        signal.removeEventListener('abort', onAbort);
        resolve(item);
      };
      const onAbort = (): void => {
        if (this.#waiter === done) this.#waiter = undefined;
        resolve(undefined);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.#waiter = done;
    });
  }

  /** How many items wait. */
  get size(): number {
    return this.#items.length;
  }

  clear(): void {
    for (const item of this.#items.splice(0)) {
      if (item.kind === 'say') void item.clip.then((c) => c?.dispose()).catch(() => undefined);
    }
    const waiter = this.#waiter;
    this.#waiter = undefined;
    waiter?.(undefined);
  }
}

/** One turn: what stops it, and the sentences it speaks. */
interface VoiceRun {
  readonly controller: AbortController;
  readonly queue: SentenceQueue;
}

export class VoiceLesson {
  readonly #machine: StateMachine<VoiceState, VoiceMove>;
  readonly #options: VoiceOptions;
  readonly #lines: VoiceLine[] = [];
  readonly #history: TeachTurn[] = [];
  /** The turn in progress; dropped on the move to `idle` or `listening`. */
  #run: VoiceRun | undefined;
  /** The open recogniser; closed on every move out of `listening`. */
  #recogniser: Recogniser | undefined;
  /** What the recogniser has heard so far (interim, never sent). */
  #interim = '';
  #nextLine = 1;

  constructor(options: VoiceOptions) {
    this.#options = options;
    this.#machine = new StateMachine(VOICE_MACHINE, 'idle', (from, move) => options.onFault?.(from, move));
  }

  get state(): VoiceState {
    return this.#machine.state;
  }

  get transcript(): readonly VoiceLine[] {
    return this.#lines;
  }

  /** The words heard so far while listening. */
  get interim(): string {
    return this.#interim;
  }

  /** True where the browser can listen: the microphone button works. */
  get canListen(): boolean {
    return this.#options.canListen === true;
  }

  /** Starts listening. Also a barge-in: it stops the clip, drops the queue and aborts the turn first. False when it cannot. */
  listen(): boolean {
    if (!this.#machine.can('listen')) return false;
    const recogniser = this.#options.recogniser?.();
    if (recogniser === undefined) return false;
    this.#abandon();
    this.#machine.send('listen');
    this.#interim = '';
    this.#recogniser = recogniser;
    recogniser.start({
      onText: (text, final) => this.#onHeard(recogniser, text, final),
      onEnd: (failure) => this.#onRecogniserEnd(recogniser, failure),
    });
    this.#changed();
    return true;
  }

  /** The learner typed or said `text`. A barge-in when the teacher is talking. False when there is nothing to send. */
  type(text: string): boolean {
    const words = text.trim();
    if (words === '' || !this.#machine.can('type')) return false;
    this.#abandon();
    this.#machine.send('type');
    this.#begin(words);
    return true;
  }

  /** The Stop button, or the microphone pressed again while listening. */
  stop(): boolean {
    if (!this.#machine.can('stop')) return false;
    this.#abandon();
    this.#machine.send('stop');
    this.#changed();
    return true;
  }

  dispose(): void {
    this.#abandon();
    this.#lines.length = 0;
  }

  // ---- the recogniser

  #onHeard(recogniser: Recogniser, text: string, final: boolean): void {
    if (this.#recogniser !== recogniser || !this.#machine.can('heard')) return;
    this.#interim = text;
    if (!final || text === '') {
      this.#changed();
      return;
    }
    this.#closeRecogniser();
    this.#machine.send('heard');
    this.#begin(text);
  }

  #onRecogniserEnd(recogniser: Recogniser, failure: string | undefined): void {
    if (this.#recogniser !== recogniser) return;
    this.#closeRecogniser();
    if (failure === undefined) {
      if (this.#machine.can('stop')) this.#machine.send('stop');
    } else this.#fail(microphoneRefused(failure) ? 'The microphone is off. Type your question below.' : `The microphone stopped: ${failure}.`);
    this.#changed();
  }

  #closeRecogniser(): void {
    const recogniser = this.#recogniser;
    this.#recogniser = undefined;
    this.#interim = '';
    recogniser?.stop();
  }

  // ---- a turn

  /** Stops what the lesson is doing: the recogniser, the clip, the queue and the request. */
  #abandon(): void {
    this.#closeRecogniser();
    const run = this.#run;
    this.#run = undefined;
    if (run === undefined) return;
    run.controller.abort();
    run.queue.clear();
  }

  #fail(message: string): void {
    this.#abandon();
    this.#note('notice', message);
    if (this.#machine.can('fail')) this.#machine.send('fail');
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
      this.#fail('There is no figure or board to teach on here.');
      return;
    }
    const run: VoiceRun = { controller: new AbortController(), queue: new SentenceQueue() };
    this.#run = run;
    this.#note('you', text);
    target.begin();
    void this.#turn(run, target, text);
    void this.#player(run);
  }

  /** The history of earlier turns for a request: the last 10, and no more than 8,000 characters in all. */
  #historyNow(): readonly TeachTurn[] {
    const out = this.#history.slice(-HISTORY_TURNS);
    let chars = out.reduce((n, h) => n + h.text.length, 0);
    while (out.length > 0 && chars > HISTORY_CHARS) chars -= (out.shift() as TeachTurn).text.length;
    return out;
  }

  #remember(text: string, said: readonly string[]): void {
    this.#history.push({ role: 'user', text });
    if (said.length > 0) this.#history.push({ role: 'assistant', text: said.join(' ') });
    if (this.#history.length > HISTORY_TURNS * 2) this.#history.splice(0, this.#history.length - HISTORY_TURNS * 2);
  }

  /** Reads the turn's events as they come: sentences are queued for the voice, everything else changes the figure at once. */
  async #turn(run: VoiceRun, target: LessonTarget, text: string): Promise<void> {
    const said: string[] = [];
    try {
      const request = { ...target.context(), text, history: this.#historyNow() };
      for await (const ev of streamTeach(request, run.controller.signal, this.#options.fetch)) {
        if (this.#run !== run) return;
        if ('say' in ev) {
          said.push(ev.say);
          this.#note('teacher', ev.say);
          run.queue.push({ kind: 'say', text: ev.say, clip: this.#options.clips(ev.say, run.controller.signal) });
        } else if ('lines' in ev) {
          target.lines(ev.lines);
        } else if ('actions' in ev) {
          await target.actions(ev.actions);
        } else if ('control' in ev) {
          target.control(ev.control);
        } else if ('error' in ev) {
          this.#note('notice', ev.error.message);
          break;
        } else {
          break;
        }
      }
    } catch {
      if (this.#run === run) this.#note('notice', 'The lesson stopped.');
    } finally {
      if (this.#run === run) {
        this.#remember(text, said);
        run.queue.push({ kind: 'end' });
      }
    }
  }

  /** Plays the queue in order. The state follows what is audible: `speaking` while a clip plays, `thinking` between sentences. */
  async #player(run: VoiceRun): Promise<void> {
    const signal = run.controller.signal;
    for (;;) {
      const item = await run.queue.take(signal);
      if (this.#run !== run || item === undefined) return;
      if (item.kind === 'end') {
        this.#run = undefined;
        if (this.#machine.can('drained')) this.#machine.send('drained');
        this.#changed();
        return;
      }
      const clip = await item.clip.catch(() => undefined);
      if (this.#run !== run) {
        clip?.dispose();
        return;
      }
      if (this.#machine.can('play')) this.#machine.send('play');
      this.#changed();
      await this.#speak(item.text, clip, signal);
      if (this.#run !== run) return;
      // the clip ended: with nothing queued the teacher is thinking again until the next sentence is ready
      if (run.queue.size === 0 && this.#machine.can('wait')) {
        this.#machine.send('wait');
        this.#changed();
      }
    }
  }

  /** Plays the sentence's clip; the browser's voice speaks it when there is no clip or the clip cannot play. */
  #speak(text: string, clip: Clip | undefined, signal: AbortSignal): Promise<void> {
    return speakSentence(text, clip, signal, this.#options.browserVoice);
  }
}

/**
 * Plays one sentence: its clip when there is one, else (or when the clip cannot play) the browser's voice. Resolves when
 * the sentence ends or `signal` aborts. The clip is disposed. Shared by the single-turn voice lesson and the conversation.
 */
export async function speakSentence(text: string, clip: Clip | undefined, signal: AbortSignal, voice: BrowserVoice | undefined): Promise<void> {
  try {
    if (clip !== undefined) {
      await clip.play(signal);
      return;
    }
  } catch {
    // the audio could not be played: the browser's voice says it instead
  } finally {
    clip?.dispose();
  }
  if (signal.aborted) return;
  await voice?.say(text, signal);
}
