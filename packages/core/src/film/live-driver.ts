import type { AskAnchor } from './ask';
import { liveToolDeclarations, LiveToolDispatcher, transcriptWordIndex, type LiveMakeExample, type LiveShowMe, type LiveToolResult } from './live-tools';
import type { LiveEvent, LiveVoice } from './live-voice';
import type { FilmController } from '../runtime/film';
import type { SceneRuntime } from '../runtime/runtime';
import type { CompiledBeat, CompiledFilm, FilmAdvance } from './storyboard';

/** Late echo of our own say(): an interrupted inside this window while the model's reply is up is our cutoff, not a barge-in. */
const SELF_INTERRUPT_WINDOW_MS = 1500;

/** How long a scheduled resume waits for the model's reply turn before reading anyway. */
const RESUME_FALLBACK_MS = 1500;

/**
 * What the teacher is: read each beat line exactly as written, answer about
 * what is on screen briefly, and resume only when the learner asks to
 * continue. Short by design: it ships on every live session's connect.
 */
export const LIVE_TEACHER_INSTRUCTION =
  'Read each beat line you are given exactly as written. ' +
  'The film pauses itself when the learner speaks or types a question, so never call pause for a question. ' +
  'Answer in one to three sentences using what is on screen. ' +
  'Call resume only when the learner asks to continue; show_me to show different values; make_example for another example. ' +
  'Describe only what a tool result says was made or shown; if a tool fails, say so in one short sentence, and never promise values outside the ranges in the show_me declaration. ' +
  'Never invent visuals.';

/** What the driver is doing: idle before start and after stop, live while the voice owns the film, done at the last beat. */
export type LiveDriverState = 'idle' | 'live' | 'done';

export type LiveDriverEvent =
  | { readonly type: 'started'; readonly beat: string }
  | { readonly type: 'said'; readonly beat: string; readonly turnId: string; readonly text: string }
  | { readonly type: 'anchor'; readonly anchor: AskAnchor }
  | { readonly type: 'tool'; readonly callId: string; readonly name: string; readonly result: LiveToolResult }
  | { readonly type: 'done' }
  | { readonly type: 'stopped' };

export interface LiveDriverOptions {
  readonly controller: FilmController;
  readonly film: CompiledFilm;
  readonly voice: LiveVoice;
  /** The live scene's runtime: control ranges, values and the default show-me. */
  readonly runtime?: SceneRuntime;
  readonly showMe?: LiveShowMe;
  readonly makeExample?: LiveMakeExample;
  readonly onEvent?: (event: LiveDriverEvent) => void;
}

/**
 * Owns the film while live voice is on. Start switches the controller to
 * click advance so beats wait for the voice, not the clock; each reading is
 * said with its own utterance id (`beat#n`), and only that utterance's
 * turn-complete moves to the next beat through the controller's own deck
 * path. Interrupt pauses the film and pins the word the transcript had
 * reached. Stop closes the voice and puts the controller back where it was.
 */
export class LiveDriver {
  private readonly controller: FilmController;
  private readonly film: CompiledFilm;
  private readonly voice: LiveVoice;
  private readonly runtime?: SceneRuntime;
  private readonly tools: LiveToolDispatcher;
  private readonly listeners = new Set<(event: LiveDriverEvent) => void>();
  private readonly transcripts = new Map<string, string>();
  private readonly said: CompiledBeat[] = [];
  private readonly saidIds = new Set<string>();

  private state: LiveDriverState = 'idle';
  private currentTurn: string | null = null;
  /** A start() still connecting: concurrent starts join it, and stop() ends it. */
  private starting: Promise<void> | null = null;
  /** Bumped by stop(): in-flight connects and tool results from an older epoch are dropped. */
  private epoch = 0;
  /** True once the learner cut in or paused, until resume or a seek speaks again. Late turn-completes land here and are ignored. */
  private paused = false;
  /** True while the model holds the floor answering: a null-turn speaking with no close yet. */
  private answering = false;
  /** A resume scheduled after the tool response, waiting for the model's reply turn or the fallback. */
  private pendingResume: { readonly at: number } | null = null;
  /** Fallback firing the pending resume when the model says nothing after the tool response. */
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  /** When our last say() went out, to tell our own cutoff apart from a learner barge-in. */
  private lastSayAt = 0;
  /** Turns the voice finished reading, so resume knows a beat was fully read. */
  private readonly completedTurns = new Set<string>();
  /** Every utterance said, by its unique turn id, back to its beat. */
  private readonly utteranceBeats = new Map<string, string>();
  /** Suffix for the next utterance id; reset with each fresh session. */
  private utterances = 0;
  private anchor: AskAnchor | null = null;
  private savedAdvance: FilmAdvance | null = null;
  private voiceOff: (() => void) | null = null;

  constructor(options: LiveDriverOptions) {
    this.controller = options.controller;
    this.film = options.film;
    this.voice = options.voice;
    if (options.runtime) this.runtime = options.runtime;
    if (options.onEvent) this.listeners.add(options.onEvent);
    this.tools = new LiveToolDispatcher({
      controller: options.controller,
      film: options.film,
      voice: options.voice,
      ...(options.runtime ? { runtime: options.runtime } : {}),
      ...(options.showMe ? { showMe: options.showMe } : {}),
      ...(options.makeExample ? { makeExample: options.makeExample } : {}),
      saidBeats: () => [...this.said],
      currentAnchor: () => this.anchor,
      recordAnchor: (next) => this.setAnchor(next),
      transcriptFor: (turnId) => (turnId === null ? undefined : this.transcripts.get(turnId)),
      notePaused: (next) => this.notePaused(next),
      isPaused: () => this.paused,
      sayBeat: (beat) => this.sayBeat(beat),
      sayBeatRemainder: (beat, wordIndex) => this.sayBeatRemainder(beat, wordIndex),
      scheduleResume: () => this.scheduleResume(),
      wasCompleted: (beatId) => this.completedTurns.has(beatId),
      isDone: () => this.state === 'done',
      restartAfterDone: () => this.restartAfterDone(),
      sessionEpoch: () => this.epoch,
      finish: () => this.finishBeats(),
      onResult: (info) => this.emit({ type: 'tool', callId: info.callId, name: info.name, result: info.result }),
    });
  }

  on(listener: (event: LiveDriverEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get driverState(): LiveDriverState {
    return this.state;
  }

  /** The beat the voice is reading now, or null before the first beat. */
  get currentBeat(): CompiledBeat | null {
    return this.controller.currentBeat;
  }

  /** The last recorded interrupt or pause anchor, for resume. */
  get lastAnchor(): AskAnchor | null {
    return this.anchor;
  }

  /** Beats the voice has said so far, in order. */
  get saidBeats(): readonly CompiledBeat[] {
    return [...this.said];
  }

  /**
   * What the player shows: the voice's own transcript for the current beat
   * when it has started saying it, else the beat text it was asked to read.
   * Transcripts land keyed by beat, so re-reads keep following the beat.
   */
  caption(): string {
    const current = this.controller.currentBeat;
    if (!current) return '';
    const said = this.transcripts.get(current.id);
    return said !== undefined && said !== '' ? said : current.step.say;
  }

  /**
   * Remembers the advance mode and position, switches to click advance, and
   * starts the voice on the current beat (opening the film when it has none).
   */
  async start(): Promise<void> {
    if (this.state !== 'idle') return;
    // A second start while connecting joins the first: one setup, one reading.
    if (this.starting) return this.starting;
    const run = this.startNow();
    this.starting = run;
    try {
      await run;
    } finally {
      this.starting = null;
    }
  }

  private async startNow(): Promise<void> {
    const at = this.epoch;
    this.savedAdvance = this.controller.advance;
    this.paused = false;
    this.answering = false;
    this.pendingResume = null;
    if (this.resumeTimer !== null) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
    this.completedTurns.clear();
    this.utteranceBeats.clear();
    this.utterances = 0;
    this.transcripts.clear();
    this.controller.setAdvance('click');
    try {
      await this.voice.connect({ instruction: LIVE_TEACHER_INSTRUCTION, tools: liveToolDeclarations(this.film, this.runtime) });
    } catch (error) {
      // A refused setup leaves no live session behind: the film plays on as before.
      if (this.epoch === at) {
        if (this.savedAdvance) this.controller.setAdvance(this.savedAdvance);
        this.state = 'idle';
      }
      throw error;
    }
    if (this.epoch !== at) {
      // Stopped while connecting: close the just-opened voice and stay stopped.
      try {
        this.voice.close();
      } catch {
        // The teardown already ran; the film still restores below.
      }
      if (this.savedAdvance) this.controller.setAdvance(this.savedAdvance);
      return;
    }
    this.voiceOff = this.voice.on((event) => this.onVoice(event));
    this.state = 'live';
    if (!this.controller.currentBeat) this.controller.nextBeat();
    const beat = this.controller.currentBeat;
    if (!beat) {
      this.state = 'idle';
      return;
    }
    this.emit({ type: 'started', beat: beat.id });
    this.sayBeat(beat);
  }

  /** Closes the voice where the learner stands and restores the advance mode. */
  stop(): void {
    const wasStarting = this.starting !== null;
    this.epoch++;
    if (this.state === 'idle' && !wasStarting) return;
    this.voiceOff?.();
    this.voiceOff = null;
    try {
      this.voice.close();
    } catch {
      // The film still restores when the voice fails to close.
    }
    if (this.savedAdvance) this.controller.setAdvance(this.savedAdvance);
    this.state = 'idle';
    this.currentTurn = null;
    this.paused = false;
    this.answering = false;
    this.pendingResume = null;
    if (this.resumeTimer !== null) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
    this.emit({ type: 'stopped' });
  }

  /** The host's way back in after an insert: the resume rung, without the voice. */
  resume(): LiveToolResult {
    if (this.state === 'idle') return { ok: false, error: 'Live voice is not on.' };
    if (this.pendingResume) return { ok: true, already: true };
    // Never talk over the model: defer behind its answer like a tool call.
    if (this.answering) {
      this.scheduleResume();
      return { ok: true, queued: true };
    }
    return this.tools.resumeNow();
  }

  /**
   * Schedules a resume after the tool response: it runs once the model's
   * reply turn ends, or on the fallback when the model says nothing. A
   * resume already waiting makes later ones idempotent no-ops.
   */
  private scheduleResume(): boolean {
    if (this.pendingResume) return false;
    this.pendingResume = { at: this.epoch };
    this.resumeTimer = setTimeout(() => this.runPendingResume(), RESUME_FALLBACK_MS);
    return true;
  }

  /** Runs the scheduled resume once, re-evaluating the anchor at run time. */
  private runPendingResume(): void {
    const pending = this.pendingResume;
    this.pendingResume = null;
    if (this.resumeTimer !== null) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
    if (!pending || this.epoch !== pending.at || this.state === 'idle') return;
    this.tools.resumeNow();
  }

  private sayBeat(beat: CompiledBeat): void {
    if (!this.saidIds.has(beat.id)) {
      this.saidIds.add(beat.id);
      this.said.push(beat);
    }
    const turnId = this.nextUtterance(beat.id);
    // Speaking again ends the pause: the turn being read is current once more.
    this.paused = false;
    this.currentTurn = turnId;
    this.lastSayAt = Date.now();
    this.voice.say(beat.step.say, turnId);
    this.emit({ type: 'said', beat: beat.id, turnId, text: beat.step.say });
  }

  /** Re-reads a beat from its anchor word on, as a new utterance of the beat. */
  private sayBeatRemainder(beat: CompiledBeat, wordIndex: number): void {
    if (!this.saidIds.has(beat.id)) {
      this.saidIds.add(beat.id);
      this.said.push(beat);
    }
    const from = beat.words.length === 0 ? 0 : Math.min(Math.max(wordIndex, 0), beat.words.length - 1);
    const text = beat.words.slice(from).join(' ') || beat.step.say;
    const turnId = this.nextUtterance(beat.id);
    this.paused = false;
    this.currentTurn = turnId;
    this.lastSayAt = Date.now();
    this.voice.say(text, turnId);
    this.emit({ type: 'said', beat: beat.id, turnId, text });
  }

  /** Restarts a finished film from beat one: back to live with a fresh slate. */
  private restartAfterDone(): CompiledBeat | null {
    const first = this.film.beats[0] ?? null;
    if (!first) return null;
    this.controller.seek(first.start);
    this.completedTurns.clear();
    this.utteranceBeats.clear();
    this.transcripts.clear();
    const now = this.controller.anchorNow();
    if (now) this.setAnchor({ ...now, wordIndex: 0 });
    this.state = 'live';
    this.sayBeat(first);
    return first;
  }

  /**
   * Tags another utterance of a beat with its own turn id. Turn ids are
   * opaque to providers, but the real client clears its turn on interrupt,
   * so the cut-off utterance may close as null or never: only the live
   * utterance's id may advance the film.
   */
  private nextUtterance(beatId: string): string {
    const turnId = `${beatId}#${this.utterances++}`;
    this.utteranceBeats.set(turnId, beatId);
    return turnId;
  }

  /** The beat an utterance id (or a bare beat id) names, or null. */
  private beatOfTurn(turnId: string | null): string | null {
    if (turnId === null) return null;
    const mapped = this.utteranceBeats.get(turnId);
    if (mapped !== undefined) return mapped;
    return this.film.beats.some((beat) => beat.id === turnId) ? turnId : null;
  }

  /** Records an interrupt or pause anchor and drops the spoken turn, so its late turn-complete cannot advance the paused film. */
  private notePaused(anchor: AskAnchor): void {
    this.paused = true;
    this.currentTurn = null;
    this.setAnchor(anchor);
  }

  private setAnchor(anchor: AskAnchor): void {
    this.anchor = anchor;
    this.emit({ type: 'anchor', anchor });
  }

  private finishBeats(): void {
    if (this.state !== 'live') return;
    this.state = 'done';
    this.currentTurn = null;
    this.emit({ type: 'done' });
  }

  private onVoice(event: LiveEvent): void {
    switch (event.type) {
      case 'transcript': {
        // Transcripts land on the beat through the utterance id, so captions
        // follow the reading even when a beat is read more than once.
        const beat = this.beatOfTurn(event.turnId);
        if (beat !== null) this.transcripts.set(beat, event.text);
        return;
      }
      case 'speaking':
        // A null-turn speaking is the model's own answer holding the floor.
        if (event.turnId === null) this.answering = true;
        return;
      case 'turn-complete':
        if (event.turnId === null) {
          // The model's reply ended: a scheduled resume may read again now.
          this.answering = false;
          this.runPendingResume();
        }
        this.onTurnComplete(event.turnId);
        return;
      case 'interrupted':
        this.interrupt();
        return;
      case 'tool-call':
        void this.tools.dispatch(event.callId, event.name, event.args);
        return;
      default:
        return;
    }
  }

  /**
   * Advances only when the completing turn id is exactly the live
   * utterance's. Older utterances of the same beat, other beats, and the
   * provider-cleared null turn are stale. While paused the live utterance
   * is cleared, so every close is stale by the same rule.
   */
  private onTurnComplete(turnId: string | null): void {
    if (this.state !== 'live' || turnId === null || turnId !== this.currentTurn) return;
    const finished = this.beatOfTurn(turnId);
    if (finished !== null) this.completedTurns.add(finished);
    if (!this.controller.nextBeat()) {
      this.finishBeats();
      return;
    }
    const beat = this.controller.currentBeat;
    if (!beat) {
      this.finishBeats();
      return;
    }
    this.sayBeat(beat);
  }

  /**
   * Pins the learner's question: pauses the film at the spoken word and
   * pushes the screen state to the voice before it answers, so the answer
   * uses what is on screen. Spoken questions (the provider's interrupted
   * event) and typed ones (the host calls this, then asks) share this path.
   */
  interrupt(): void {
    if (this.state !== 'live') return;
    // Our own say() can echo back as interrupted while the model's reply is
    // still up: that is our cutoff, not a barge-in, so the film holds steady.
    if (this.answering && Date.now() - this.lastSayAt < SELF_INTERRUPT_WINDOW_MS) return;
    // Already paused on a pin (a typed follow-up like "carry on"): keep the
    // anchor and the context already pushed instead of re-pinning.
    if (this.paused && this.anchor) return;
    const beat = this.controller.currentBeat;
    if (!beat) {
      this.controller.pause();
      return;
    }
    const anchor = this.controller.anchorNow();
    if (!anchor) {
      this.controller.pause();
      return;
    }
    this.notePaused({ ...anchor, wordIndex: transcriptWordIndex(this.transcripts.get(beat.id), beat) });
    const line = this.tools.contextLine();
    if (line !== null) {
      try {
        this.voice.sendContext(line);
      } catch {
        // Context is advisory: the answer still carries the anchor.
      }
    }
  }

  private emit(event: LiveDriverEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
