import type { AskAnchor } from './ask';
import { LIVE_TOOL_DECLARATIONS, LiveToolDispatcher, transcriptWordIndex, type LiveMakeExample, type LiveShowMe, type LiveToolResult } from './live-tools';
import type { LiveEvent, LiveVoice } from './live-voice';
import type { FilmController } from '../runtime/film';
import type { SceneRuntime } from '../runtime/runtime';
import type { CompiledBeat, CompiledFilm, FilmAdvance } from './storyboard';

/**
 * What the teacher is: read each beat line exactly as written, answer about
 * what is on screen briefly, use the tools to pause, resume, show and make
 * examples, and never invent visuals. Short by design: it ships on every
 * live session's connect.
 */
export const LIVE_TEACHER_INSTRUCTION =
  'Read each beat line you are given exactly as written. ' +
  'Answer learner questions about what is on screen briefly. ' +
  'Use your tools to pause, resume, show and make examples. ' +
  'Never invent visuals.';

/** What the driver is doing: idle before start and after stop, live while the voice owns the film, done at the last beat. */
export type LiveDriverState = 'idle' | 'live' | 'done';

export type LiveDriverEvent =
  | { readonly type: 'started'; readonly beat: string }
  | { readonly type: 'said'; readonly beat: string; readonly text: string }
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
 * click advance so beats wait for the voice, not the clock; each beat is read
 * with say(beat.step.say, beat.id), and the voice's turn-complete moves to the
 * next beat through the controller's own deck path. Interrupt pauses the film
 * and pins the word the transcript had reached. Stop closes the voice and
 * puts the controller back where it was.
 */
export class LiveDriver {
  private readonly controller: FilmController;
  private readonly film: CompiledFilm;
  private readonly voice: LiveVoice;
  private readonly tools: LiveToolDispatcher;
  private readonly listeners = new Set<(event: LiveDriverEvent) => void>();
  private readonly transcripts = new Map<string, string>();
  private readonly said: CompiledBeat[] = [];
  private readonly saidIds = new Set<string>();

  private state: LiveDriverState = 'idle';
  private currentTurn: string | null = null;
  /** True once the learner cut in or paused, until resume or a seek speaks again. Late turn-completes land here and are ignored. */
  private paused = false;
  /** Turns the voice finished reading, so resume knows a beat was fully read. */
  private readonly completedTurns = new Set<string>();
  private anchor: AskAnchor | null = null;
  private savedAdvance: FilmAdvance | null = null;
  private voiceOff: (() => void) | null = null;

  constructor(options: LiveDriverOptions) {
    this.controller = options.controller;
    this.film = options.film;
    this.voice = options.voice;
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
      wasCompleted: (beatId) => this.completedTurns.has(beatId),
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
   */
  caption(): string {
    const current = this.controller.currentBeat;
    if (!current) return '';
    const said = this.currentTurn !== null ? this.transcripts.get(this.currentTurn) : undefined;
    return said !== undefined && said !== '' ? said : current.step.say;
  }

  /**
   * Remembers the advance mode and position, switches to click advance, and
   * starts the voice on the current beat (opening the film when it has none).
   */
  async start(): Promise<void> {
    if (this.state !== 'idle') return;
    this.savedAdvance = this.controller.advance;
    this.paused = false;
    this.completedTurns.clear();
    this.controller.setAdvance('click');
    await this.voice.connect({ instruction: LIVE_TEACHER_INSTRUCTION, tools: LIVE_TOOL_DECLARATIONS });
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
    if (this.state === 'idle') return;
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
    this.emit({ type: 'stopped' });
  }

  /** The host's way back in after an insert: the resume rung, without the voice. */
  resume(): LiveToolResult {
    if (this.state === 'idle') return { ok: false, error: 'Live voice is not on.' };
    return this.tools.resumeNow();
  }

  private sayBeat(beat: CompiledBeat): void {
    if (!this.saidIds.has(beat.id)) {
      this.saidIds.add(beat.id);
      this.said.push(beat);
    }
    // Speaking again ends the pause: the turn being read is current once more.
    this.paused = false;
    this.currentTurn = beat.id;
    this.voice.say(beat.step.say, beat.id);
    this.emit({ type: 'said', beat: beat.id, text: beat.step.say });
  }

  /** Re-reads a beat from its anchor word on, under the same turn id. */
  private sayBeatRemainder(beat: CompiledBeat, wordIndex: number): void {
    if (!this.saidIds.has(beat.id)) {
      this.saidIds.add(beat.id);
      this.said.push(beat);
    }
    const from = beat.words.length === 0 ? 0 : Math.min(Math.max(wordIndex, 0), beat.words.length - 1);
    const text = beat.words.slice(from).join(' ') || beat.step.say;
    this.paused = false;
    this.currentTurn = beat.id;
    this.voice.say(text, beat.id);
    this.emit({ type: 'said', beat: beat.id, text });
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
      case 'transcript':
        if (event.turnId !== null) this.transcripts.set(event.turnId, event.text);
        return;
      case 'turn-complete':
        this.onTurnComplete(event.turnId);
        return;
      case 'interrupted':
        this.onInterrupted();
        return;
      case 'tool-call':
        void this.tools.dispatch(event.callId, event.name, event.args);
        return;
      default:
        return;
    }
  }

  /** Advances only when the finished turn is the beat being read; stale turns and turns finishing while paused are ignored. */
  private onTurnComplete(turnId: string | null): void {
    if (this.state !== 'live' || this.paused || turnId === null || turnId !== this.currentTurn) return;
    this.completedTurns.add(turnId);
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

  /** Pauses the film and pins the word the transcript had reached. */
  private onInterrupted(): void {
    if (this.state !== 'live') return;
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
  }

  private emit(event: LiveDriverEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
