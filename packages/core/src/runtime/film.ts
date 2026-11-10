import type { Beat, NoteOptions, Waveform } from '../api/types';
import type { FrameClock } from '../engine/clock';
import type { RendererMessage, RuntimeUpdate } from '../protocol/runtime-messages';
import { stageBounds, type Box } from '../scene/bounds';
import type { VNode } from '../scene/graph';
import { askAnchorFor, resolveAskAnchor, type AskAnchor } from '../film/ask';
import { attachAudio, resolveAnchor, type BeatAudio, type CompiledBeat, type CompiledFilm, type FilmAdvance, type FilmAnchor } from '../film/storyboard';
import { FILM_STEP_SECONDS, SceneRuntime } from './runtime';

/**
 * The film controller: a beat scheduler over one scene of a compiled film. It
 * owns the fixed film clock driving the runtime in film mode (slice-1 API):
 * scene time is film time within the scene, beats apply at their starts, and
 * seeking replays the scene and re-applies the beats, so a seek draws what
 * playing there draws.
 *
 * Every cue executes through existing runtime and kit behaviors only: steps
 * for set, hold, view and focus, the focus highlight for marks, part hiding
 * for show and hide, view actions for kit-owned cameras, and note commands
 * for sfx. Titles live outside the drawing with the captions, as step text
 * does. Beats with explore or predict pause the film at their start; their
 * full behavior lands in a later slice.
 */

/** Named sfx cues, each one or more notes through the sound kit's own command. */
export const SFX_CUES: Readonly<Record<string, readonly NoteOptions[]>> = {
  arrive: [{ frequency: 660, duration: 0.12, wave: 'sine', gain: 0.5 }],
  click: [{ frequency: 1200, duration: 0.03, wave: 'square', gain: 0.3 }],
  chime: [
    { frequency: 880, duration: 0.2, wave: 'sine', gain: 0.4 },
    { frequency: 1320, duration: 0.3, wave: 'sine', gain: 0.3 },
  ],
  thunk: [{ frequency: 140, duration: 0.15, wave: 'triangle', gain: 0.5 }],
  tick: [{ frequency: 2000, duration: 0.02, wave: 'sine', gain: 0.25 }],
  pop: [{ frequency: 440, duration: 0.06, wave: 'square', gain: 0.4 }],
};

export function sfxNames(): string[] {
  return Object.keys(SFX_CUES);
}

/**
 * Plays a named cue: the same note command inc.sound.note queues, so the
 * renderer sounds it when audible. False for an unknown cue, which the film
 * checks report; the film plays on silently.
 */
export function cueSfx(runtime: SceneRuntime, name: string): boolean {
  const notes = SFX_CUES[name];
  if (!notes) return false;
  for (const note of notes) {
    runtime.graph.note({
      wave: (note.wave ?? 'sine') as Waveform,
      frequency: note.frequency,
      duration: note.duration ?? 0.2,
      gain: note.gain ?? 0.5,
    });
  }
  return true;
}

/** A beat's camera intent in stage units, for the solver, the checks and the player. */
export interface FramingIntent {
  readonly stage: number;
  readonly part: string;
  readonly center: readonly [number, number];
  readonly zoom: number;
  /** True where a kit owns the stage's view and the move was sent; 2D stages keep the wide view. */
  readonly moved: boolean;
}

/** What applying a beat did, for the checks and the player. */
export interface AppliedCues {
  readonly focusing: string | null;
  readonly framing: FramingIntent | null;
  readonly sfxPlayed: boolean;
  readonly title: { readonly text: string; readonly kind: 'card' | 'lower' } | null;
  /** The beat's write-on layer, or null. The shown prefix comes from writeShownAt. */
  readonly write: { readonly text: string; readonly math: boolean } | null;
  /** The note lines this beat introduces; what shows is accumulatedNotes of the scene. */
  readonly notes: readonly string[];
}

/** A beat's title as text and kind. */
export function beatTitle(beat: Beat): AppliedCues['title'] {
  if (beat.title === undefined) return null;
  return typeof beat.title === 'string' ? { text: beat.title, kind: 'lower' } : { text: beat.title.text, kind: beat.title.kind ?? 'lower' };
}

/** A beat's write-on layer, or null when the beat writes nothing. */
export function beatWrite(beat: Beat): AppliedCues['write'] {
  if (beat.write === undefined) return null;
  return { text: beat.write.text, math: beat.write.math ?? false };
}

/**
 * The notes showing on a scene beat: every line introduced by its beat or
 * an earlier one, in order. Beat-granular, so seeking to t shows what
 * playing to t shows.
 */
export function accumulatedNotes(beats: readonly { readonly step: Beat }[], index: number): readonly string[] {
  const out: string[] = [];
  for (let i = 0; i <= index && i < beats.length; i++) {
    for (const line of beats[i]!.step.notes ?? []) out.push(line);
  }
  return out;
}

/**
 * How much of a beat's write-on text shows at a film time: a prefix growing
 * fast, full within the first 40% of the beat, so the learner reads the
 * line while the teacher keeps talking. A pure function of the fixed film
 * clock, never wall time, so seeks draw what plays draw.
 */
export function writeShownAt(beat: CompiledBeat, time: number): string {
  const write = beat.step.write;
  if (write === undefined) return '';
  const chars = [...write.text];
  if (beat.seconds <= 0) return write.text;
  const progress = Math.min(1, Math.max(0, (time - beat.start) / (beat.seconds * 0.4)));
  // A hair past each character's threshold still shows it: float time rarely
  // lands exactly on a boundary.
  return chars.slice(0, Math.min(chars.length, Math.floor(progress * chars.length + 1e-6))).join('');
}

/** Beats that pause the film at their start until the learner resumes. */
export function isPausePoint(beat: Beat): boolean {
  return beat.hold === true || beat.explore !== undefined || beat.predict !== undefined;
}

/** The part on screen, in stage units: the union of its subtree's boxes, or null while hidden. */
export function partBox(runtime: SceneRuntime, part: string): { readonly stage: number; readonly box: Box } | null {
  const record = runtime.parts.parts.get(part);
  if (!record || record.node.hidden) return null;
  const stage = record.node.stage;
  const bounds = stageBounds(runtime.graph, stage);
  const ids = [record.node.id, ...subtreeIds(runtime.graph, record.node)];
  let box: Box | null = null;
  for (const id of ids) {
    const found = bounds.boxes.get(id);
    if (!found) continue;
    box = box
      ? { minX: Math.min(box.minX, found.minX), minY: Math.min(box.minY, found.minY), maxX: Math.max(box.maxX, found.maxX), maxY: Math.max(box.maxY, found.maxY) }
      : { ...found };
  }
  return box ? { stage, box } : null;
}

function subtreeIds(graph: SceneRuntime['graph'], node: VNode): number[] {
  const out: number[] = [];
  const visit = (current: VNode): void => {
    for (const id of current.children) {
      out.push(id);
      const child = graph.nodes.get(id);
      if (child) visit(child);
    }
  };
  visit(node);
  return out;
}

/** Every named part's box now, for the callout slot solver. */
export function partBoxes(runtime: SceneRuntime): ReadonlyMap<string, { readonly stage: number; readonly box: Box }> {
  const out = new Map<string, { readonly stage: number; readonly box: Box }>();
  for (const name of runtime.parts.parts.keys()) {
    const box = partBox(runtime, name);
    if (box) out.set(name, box);
  }
  return out;
}

/** Brings a beat's show list in and takes its hide list out, through part hiding. */
export function applyShowHide(runtime: SceneRuntime, beat: Beat): void {
  for (const name of beat.show ?? []) setPartVisible(runtime, name, true);
  for (const name of beat.hide ?? []) setPartVisible(runtime, name, false);
}

function setPartVisible(runtime: SceneRuntime, name: string, visible: boolean): void {
  const record = runtime.parts.parts.get(name);
  if (!record || record.node.hidden === !visible) return;
  runtime.graph.setFlags(record.node, { hidden: !visible });
}

/**
 * Applies one beat's cues to a mounted runtime whose step is already the
 * beat's: show and hide, camera, focus, marks and sfx. The step itself (set,
 * hold, view, focus) is applied by runtime.step, animated or immediate at the
 * caller's choice. Seeks pass sfx false: scrubbing stays silent.
 */
export function applyBeatCues(runtime: SceneRuntime, beat: Beat, options: { readonly sfx?: boolean } = {}): AppliedCues {
  applyShowHide(runtime, beat);
  // Annotation parts are drawn by the scene, hidden, and brought in by the mark.
  for (const mark of beat.mark ?? []) {
    if (mark.type === 'arrow' || mark.type === 'callout' || mark.type === 'draw') setPartVisible(runtime, mark.part, true);
  }
  const focusing = beat.focus ?? beat.cam?.to ?? beat.mark?.[0]?.part ?? null;
  runtime.focusPart(focusing);
  let framing: FramingIntent | null = null;
  if (beat.cam?.to) {
    framing = framePart(runtime, beat.cam.to, beat.cam.zoom ?? 1.5);
  }
  let sfxPlayed = false;
  if (options.sfx !== false && beat.sfx !== undefined) sfxPlayed = cueSfx(runtime, beat.sfx);
  return { focusing, framing, sfxPlayed, title: beatTitle(beat), write: beatWrite(beat), notes: [...(beat.notes ?? [])] };
}

/**
 * Frames a part on kit-owned stages through view actions: back to the wide
 * view first, then a zoom about the part's center, so a beat's camera is
 * absolute. 2D stages have no kit-owned camera; the intent is still returned,
 * and the focus highlight carries the beat.
 */
export function framePart(runtime: SceneRuntime, part: string, zoom: number): FramingIntent | null {
  const found = partBox(runtime, part);
  if (!found) return null;
  const factor = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const center = [(found.box.minX + found.box.maxX) / 2, (found.box.minY + found.box.maxY) / 2] as const;
  const controllers = new Map(runtime.viewControllers());
  let moved = false;
  if (controllers.has(found.stage)) {
    runtime.view(found.stage, { kind: 'reset' });
    if (factor !== 1) runtime.view(found.stage, { kind: 'zoom', x: center[0], y: center[1], factor });
    moved = true;
  }
  return { stage: found.stage, part, center, zoom: factor, moved };
}

/**
 * Merges replay updates into one, in order: every command lands, later UI
 * wins, and the last step, values and formulas carried are kept. The seek's
 * reset update already went through the transport, so the merge never resets.
 */
function mergeUpdates(updates: readonly RuntimeUpdate[]): RuntimeUpdate {
  const commands = updates.flatMap((update) => update.commands);
  const ui = Object.assign({}, ...updates.map((update) => update.ui));
  const merged: { -readonly [K in keyof RuntimeUpdate]: RuntimeUpdate[K] } = { commands, ui, needsFrame: updates[updates.length - 1]?.needsFrame ?? false };
  for (const update of updates) {
    if (update.values) merged.values = { ...merged.values, ...update.values };
    if (update.step !== undefined) merged.step = update.step;
    if (update.formulas) merged.formulas = { ...merged.formulas, ...update.formulas };
  }
  return merged;
}

export type FilmEvent =
  | { readonly type: 'play' }
  | { readonly type: 'pause' }
  | { readonly type: 'beat'; readonly beat: CompiledBeat }
  | { readonly type: 'held'; readonly beat: CompiledBeat }
  | { readonly type: 'pausePoint'; readonly beat: CompiledBeat; readonly kind: 'hold' | 'explore' | 'predict' }
  | { readonly type: 'end' }
  | { readonly type: 'cut'; readonly from: string; readonly to: string }
  | { readonly type: 'seek'; readonly beat: CompiledBeat; readonly time: number }
  | { readonly type: 'sfx'; readonly beat: CompiledBeat; readonly name: string; readonly played: boolean }
  | { readonly type: 'retime'; readonly film: CompiledFilm };

export interface TranscriptLine {
  readonly beat: string;
  readonly scene: string;
  readonly say: string;
  readonly short: string | null;
  readonly start: number;
  readonly seconds: number;
}

export interface FilmChapter {
  readonly scene: string;
  readonly title: string;
  readonly start: number;
  readonly seconds: number;
  readonly beats: readonly string[];
}

export interface AskContext {
  readonly question: string;
  readonly anchor: AskAnchor;
  readonly beat: CompiledBeat;
  /** The beat's narration and its neighbours, for the answering call. */
  readonly lines: readonly TranscriptLine[];
}

/**
 * A Show-me replay on the live scene: the beat's set, focus, camera and
 * marks, re-applied through the same runtime and kit behaviors the beat
 * itself used — no new scene code. The replay is deterministic: the same
 * beat on the same scene draws the same frame every time. Restoring returns
 * the scene's values, visibility and focus; the camera stays where the
 * replay framed it, which is where the film's own beat frames it too.
 */
export interface ShowMeSession {
  readonly beat: CompiledBeat;
  readonly cues: AppliedCues;
  readonly restored: boolean;
  /** Re-applies the beat's fields; the same inputs draw the same frame. */
  replay(): AppliedCues;
  /** Returns the scene's values, visibility and focus. */
  restore(): void;
}

/** Replays a beat's fields on the live scene, pausing its values for a later restore. */
export function beginShowMe(runtime: SceneRuntime, beat: CompiledBeat): ShowMeSession {
  const step = beat.step;
  const values = runtime.values();
  const focus = runtime.uiState().focus;
  const parts = [step.focus, step.cam?.to, ...(step.show ?? []), ...(step.hide ?? []), ...(step.mark ?? []).map((mark) => mark.part)].filter(
    (name): name is string => typeof name === 'string' && name !== '',
  );
  const hidden = new Map<string, boolean>();
  for (const name of new Set(parts)) {
    const record = runtime.parts.parts.get(name);
    if (record) hidden.set(name, record.node.hidden);
  }
  let restored = false;
  const apply = (): AppliedCues => {
    // setValues lands at once (no tween), through the learner's own change path, so the replay is exact.
    if (step.set) runtime.setValues(step.set);
    return applyBeatCues(runtime, step, { sfx: false });
  };
  const session: ShowMeSession = {
    beat,
    cues: apply(),
    get restored() {
      return restored;
    },
    replay: () => {
      restored = false;
      return apply();
    },
    restore: () => {
      if (restored) return;
      restored = true;
      runtime.setValues(values);
      for (const [name, was] of hidden) {
        const record = runtime.parts.parts.get(name);
        if (record && record.node.hidden !== was) runtime.graph.setFlags(record.node, { hidden: was });
      }
      if (runtime.uiState().focus !== focus) runtime.focusPart(focus);
    },
  };
  return session;
}

/**
 * Transport to the figure's renderer in observer mode: messages down, and the
 * cue-replay updates back up. A seek replays beats through direct runtime
 * calls no message can carry, so the replayed drawing updates come back
 * through apply; without it the figure keeps showing the seek's reset frame.
 */
export interface FilmTransport {
  send(message: RendererMessage): void;
  apply?(update: RuntimeUpdate): void;
}

export interface FilmControllerOptions {
  readonly runtime: SceneRuntime;
  readonly film: CompiledFilm;
  /**
   * How beats advance: the audio clock, or the learner's click. Defaults to
   * the film's own advance, which defaults to time. Time mode is exactly
   * today's behavior; click mode holds every beat until nextBeat, prevBeat,
   * a seek, or play-then-boundary moves it.
   */
  readonly advance?: FilmAdvance;
  /** Scene to play; one-scene films play scene 0. */
  readonly sceneIndex?: number;
  /**
   * One runtime per scene, in film order, for multi-scene films: the
   * controller sequences across them, switching on seeks and scene ends. When
   * absent the controller drives one scene through `runtime`, as before.
   */
  readonly runtimes?: readonly SceneRuntime[];
  /** Transport to the runtime's renderer, so play, pause and seek stay in sync with the figure. */
  readonly transport?: FilmTransport;
  /** Frame clock for controller-driven play; without one the host ticks or polls. */
  readonly clock?: FrameClock;
  readonly autoplay?: boolean;
  readonly reducedMotion?: boolean;
  readonly now?: () => number;
  readonly onEvent?: (event: FilmEvent) => void;
}

/**
 * Drives a compiled film through runtimes in film mode: one scene through
 * `runtime`, or every scene through `runtimes`, sequencing across them. In
 * driver mode (no transport) the controller ticks the active runtime itself,
 * from its clock or from manual tick calls. In observer mode (with transport)
 * the figure's renderer owns the frame loop and the host polls the controller
 * once per frame.
 */
export class FilmController {
  private readonly runtime: SceneRuntime;
  private film: CompiledFilm;
  private readonly scene: number;
  private runtimes: SceneRuntime[] | null;
  private active: number;
  private readonly transport: FilmTransport | null;
  private readonly clock: FrameClock | null;
  private readonly reducedMotion: boolean;
  private readonly now: () => number;
  private readonly listeners = new Set<(event: FilmEvent) => void>();
  private advanceMode: FilmAdvance;
  private playing = false;
  private beatIndex = -1;
  private frameHandle: number | null = null;
  private lastNow = 0;
  private ended = false;
  /** Authored visibility per part, captured before the film first touches it; cleared on seek. */
  private authored = new Map<string, boolean>();
  /** Parts the film's show and hide lists have hidden, in order. */
  private hiddenByFilm = new Set<string>();
  private lastCamBeat = -1;
  private lastCues: AppliedCues | null = null;
  private boundaryMs = 0;
  private beatsApplied = 0;
  private seeks = 0;

  constructor(options: FilmControllerOptions) {
    this.runtime = options.runtime;
    this.film = options.film;
    this.advanceMode = options.advance ?? options.film.advance ?? 'time';
    this.scene = options.sceneIndex ?? 0;
    this.runtimes = options.runtimes && options.runtimes.length === options.film.scenes.length ? [...options.runtimes] : null;
    this.active = this.runtimes ? 0 : this.scene;
    this.transport = options.transport ?? null;
    this.clock = options.clock ?? null;
    this.reducedMotion = options.reducedMotion ?? false;
    this.now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    if (options.onEvent) this.listeners.add(options.onEvent);
    if (options.autoplay === true && !this.reducedMotion) this.play();
  }

  /** True once the controller sequences across one runtime per scene. */
  get multiScene(): boolean {
    return this.runtimes !== null;
  }

  /** The active scene's index in the film. */
  get sceneIndex(): number {
    return this.runtimes ? this.active : this.scene;
  }

  /** How beats advance now: the audio clock, or the learner's click. */
  get advance(): FilmAdvance {
    return this.advanceMode;
  }

  /**
   * Switches advance modes on any film, with no narration required. Entering
   * click pauses the clock and holds the beat on screen; entering time leaves
   * the film paused for the learner to resume. Anything but time or click is
   * ignored. Retime never touches the mode, so narration arriving later and
   * version switches never flip the learner's toggle.
   */
  setAdvance(mode: FilmAdvance): void {
    if (mode !== 'time' && mode !== 'click') return;
    if (mode === this.advanceMode) return;
    this.advanceMode = mode;
    if (mode === 'click') {
      if (this.playing) this.pauseAtPoint();
      const beat = this.currentBeat;
      if (beat) this.emit({ type: 'held', beat });
    }
  }

  private get activeRuntime(): SceneRuntime {
    return this.runtimes ? this.runtimes[this.active]! : this.runtime;
  }

  private get sceneData() {
    return this.film.scenes[this.runtimes ? this.active : this.scene]!;
  }

  private get sceneBeats(): readonly CompiledBeat[] {
    return this.sceneData.beats;
  }

  /**
   * Later scenes join as they pass their checks: the host mounts each new
   * scene's runtime and hands the whole ordered list back. Null clears back
   * to one scene through `runtime`.
   */
  setRuntimes(runtimes: readonly SceneRuntime[] | null): void {
    if (runtimes && runtimes.length === this.film.scenes.length) {
      const id = this.film.scenes[this.runtimes ? this.active : this.scene]?.id;
      this.runtimes = [...runtimes];
      this.active = Math.max(0, this.film.scenes.findIndex((scene) => scene.id === id));
    } else {
      this.runtimes = null;
    }
  }

  /** Film seconds now: the active scene's start plus its runtime's scene time. */
  get time(): number {
    return this.sceneData.start + this.activeRuntime.time;
  }

  get duration(): number {
    return this.runtimes ? this.film.seconds : this.sceneData.start + this.sceneData.seconds;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get currentBeat(): CompiledBeat | null {
    return this.beatIndex >= 0 ? (this.sceneBeats[this.beatIndex] ?? null) : null;
  }

  /** The cues the last applied beat landed, or null before the first beat. */
  get currentCues(): AppliedCues | null {
    return this.lastCues;
  }

  get cut(): CompiledFilm['scenes'][number]['cut'] {
    return this.sceneData.cut;
  }

  /** Controller overhead: boundary work only, never the runtime's own ticks. */
  get stats(): { readonly beatsApplied: number; readonly seeks: number; readonly boundaryMs: number } {
    return { beatsApplied: this.beatsApplied, seeks: this.seeks, boundaryMs: this.boundaryMs };
  }

  on(listener: (event: FilmEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: FilmEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  play(): void {
    this.activeRuntime.setFilm(true);
    if (this.ended || this.time >= this.duration) {
      if (this.runtimes) this.seek(0);
      else this.seekBeat(this.sceneBeats[0]!.id);
      if (this.advanceMode === 'click') {
        // A restarted deck holds on its first beat instead of playing it
        // through; the beat event starts its narration, as arrivals do.
        const beat = this.currentBeat;
        if (beat) this.emit({ type: 'beat', beat });
        return;
      }
    }
    this.ended = false;
    this.playing = true;
    if (this.transport) this.transport.send({ type: 'play' });
    else this.activeRuntime.play();
    this.scan();
    if (this.clock && this.frameHandle === null) {
      this.lastNow = this.now();
      this.frameHandle = this.clock.request(this.loop);
    }
    this.emit({ type: 'play' });
  }

  pause(): void {
    this.playing = false;
    if (this.transport) this.transport.send({ type: 'pause' });
    else this.activeRuntime.pause();
    if (this.clock && this.frameHandle !== null) {
      this.clock.cancel(this.frameHandle);
      this.frameHandle = null;
    }
    this.emit({ type: 'pause' });
  }

  setSpeed(value: number): void {
    if (this.transport) this.transport.send({ type: 'speed', value });
    else this.activeRuntime.setSpeed(value);
  }

  setVolume(value: number): void {
    const volume = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5));
    if (this.transport) this.transport.send({ type: 'setValues', values: { $volume: volume } });
    else this.activeRuntime.setValues({ $volume: volume });
  }

  /**
   * Advances the film by wall seconds, ticking the runtime in film mode, and
   * returns the frame: the tick's update plus whatever the crossed beats
   * applied. Driver mode only; observer mode polls while the renderer ticks.
   */
  tick(dt: number): RuntimeUpdate {
    if (this.transport) return { commands: [], ui: {}, needsFrame: false };
    if (!this.playing) return { commands: [], ui: {}, needsFrame: false };
    const first = this.activeRuntime.tick(dt);
    this.scan();
    const second = this.activeRuntime.flush();
    if (second.commands.length === 0 && Object.keys(second.ui).length === 0 && second.values === undefined && second.step === undefined && second.formulas === undefined && second.reset === undefined) {
      return first;
    }
    return mergeUpdates([first, second]);
  }

  /** Applies whatever beats the clock has crossed. Observer mode calls this once per frame. */
  poll(): void {
    if (!this.playing) return;
    this.scan();
  }

  private loop = (now: number): void => {
    this.frameHandle = null;
    if (!this.playing) return;
    const dt = Math.max(0, (now - this.lastNow) / 1000);
    this.lastNow = now;
    // The clock drives the runtime; the scan applies the beats it crossed.
    this.activeRuntime.tick(dt);
    this.scan();
    if (this.playing && this.clock) this.frameHandle = this.clock.request(this.loop);
  };

  /** Applies each beat whose start the clock has crossed, in order, sequencing across scenes. */
  private scan(): void {
    const started = this.now();
    try {
      for (;;) {
        const beats = this.sceneBeats;
        const end = this.sceneData.start + this.sceneData.seconds;
        for (;;) {
          const next = this.beatIndex + 1;
          const beat = beats[next];
          if (!beat || this.time + 1e-9 < beat.start) break;
          const cues = this.applyBeat(next, true);
          this.emit({ type: 'beat', beat });
          if (beat.step.sfx !== undefined) this.emit({ type: 'sfx', beat, name: beat.step.sfx, played: cues.sfxPlayed });
          if (this.advanceMode === 'click') {
            // A click beat holds at its opening: the clock stops, the beat's
            // narration (started by the beat event above) plays on, and only
            // the learner's click moves the film. Pause points still report.
            this.pauseAtPoint();
            this.emit({ type: 'held', beat });
          }
          if (isPausePoint(beat.step)) {
            const kind = beat.step.explore !== undefined ? 'explore' : beat.step.predict !== undefined ? 'predict' : 'hold';
            this.pauseAtPoint();
            this.emit({ type: 'pausePoint', beat, kind });
            return;
          }
          if (this.advanceMode === 'click') return;
        }
        if (!(this.time + FILM_STEP_SECONDS / 2 >= end && this.beatIndex >= beats.length - 1)) return;
        if (!this.advanceScene()) {
          this.finish();
          return;
        }
      }
    } finally {
      this.boundaryMs += this.now() - started;
    }
  }

  /** Moves to the next scene while playing, or false at the film's end. Single-scene controllers never advance. */
  private advanceScene(): boolean {
    if (!this.runtimes || this.active + 1 >= this.film.scenes.length) return false;
    const from = this.film.scenes[this.active]!;
    this.active++;
    const to = this.film.scenes[this.active]!;
    this.resetSceneState();
    this.activeRuntime.setFilm(true);
    if (this.playing && !this.transport) this.activeRuntime.play();
    else if (this.playing && this.transport) this.transport.send({ type: 'play' });
    this.emit({ type: 'cut', from: from.id, to: to.id });
    return true;
  }

  /** Clears per-scene beat state when the active scene changes. */
  private resetSceneState(): void {
    this.beatIndex = -1;
    this.authored.clear();
    this.hiddenByFilm.clear();
    this.lastCamBeat = -1;
    this.lastCues = null;
  }

  private pauseAtPoint(): void {
    this.playing = false;
    if (this.transport) this.transport.send({ type: 'pause' });
    else this.activeRuntime.pause();
    if (this.clock && this.frameHandle !== null) {
      this.clock.cancel(this.frameHandle);
      this.frameHandle = null;
    }
  }

  private finish(): void {
    if (!this.runtimes) {
      const next = this.film.scenes[this.scene + 1];
      if (next) this.emit({ type: 'cut', from: this.sceneData.id, to: next.id });
    }
    this.ended = true;
    this.pauseAtPoint();
    this.emit({ type: 'end' });
  }

  /** Applies beat `index`: its step through runtime steps, its cues through kit behaviors. */
  private applyBeat(index: number, sfx: boolean): AppliedCues {
    const beat = this.sceneBeats[index]!;
    this.beatIndex = index;
    this.beatsApplied++;
    // Mark-only annotation parts leave with their beat; show and hide accumulate.
    this.restoreMarks();
    this.activeRuntime.step('goto', beat.index);
    if (this.playing && !this.transport) this.activeRuntime.play();
    else if (this.playing && this.transport) this.transport.send({ type: 'play' });
    this.captureAuthored(beat.step);
    applyShowHide(this.activeRuntime, beat.step);
    for (const name of beat.step.show ?? []) this.hiddenByFilm.delete(name);
    for (const name of beat.step.hide ?? []) this.hiddenByFilm.add(name);
    const cues = applyBeatCues(this.activeRuntime, beat.step, { sfx });
    this.lastCues = cues;
    if (beat.step.cam) this.lastCamBeat = index;
    else if (this.lastCamBeat !== -1 && this.lastCamBeat !== index) this.toWide();
    return cues;
  }

  /** Beats without a camera return kit-owned stages to the wide view. */
  private toWide(): void {
    for (const [stage] of this.activeRuntime.viewControllers()) this.activeRuntime.view(stage, { kind: 'reset' });
    this.lastCamBeat = -1;
  }

  private captureAuthored(step: Beat): void {
    for (const name of [...(step.show ?? []), ...(step.hide ?? []), ...(step.mark ?? []).map((mark) => mark.part)]) {
      if (this.authored.has(name)) continue;
      const record = this.activeRuntime.parts.parts.get(name);
      if (record) this.authored.set(name, record.node.hidden);
    }
  }

  /** Mark-only annotation parts hide again when their beat ends. */
  private restoreMarks(): void {
    const beat = this.beatIndex >= 0 ? this.sceneBeats[this.beatIndex] : null;
    if (!beat) return;
    for (const mark of beat.step.mark ?? []) {
      if (mark.type !== 'arrow' && mark.type !== 'callout' && mark.type !== 'draw') continue;
      if (beat.step.show?.includes(mark.part)) continue;
      const authored = this.authored.get(mark.part);
      const record = this.activeRuntime.parts.parts.get(mark.part);
      if (!record) continue;
      const hidden = this.hiddenByFilm.has(mark.part) ? true : (authored ?? true);
      if (record.node.hidden !== hidden) this.activeRuntime.graph.setFlags(record.node, { hidden });
    }
  }

  /**
   * Seeks to film seconds and draws what playing there draws, mid-transition
   * included: the scene replays to the beat's start, earlier beats land their
   * sets at once, the beat applies as at its boundary, and exact steps play
   * forward to the target. Transport mode needs the same thread (the
   * renderer's own channel), so the replay's reset reaches the figure.
   * Multi-scene controllers switch to the scene holding the target first.
   */
  seek(seconds: number): void {
    if (this.runtimes) {
      const target = Number.isFinite(seconds) ? seconds : 0;
      let sceneIndex = 0;
      this.film.scenes.forEach((scene, i) => {
        if (target + 1e-9 >= scene.start) sceneIndex = i;
      });
      if (sceneIndex !== this.active) this.switchScene(sceneIndex);
    }
    const start = this.sceneData.start;
    const end = start + this.sceneData.seconds;
    const clamped = Math.min(Math.max(Number.isFinite(seconds) ? seconds : start, start), end);
    const beats = this.sceneBeats;
    let index = 0;
    beats.forEach((beat, i) => {
      if (clamped + 1e-9 >= beat.start) index = i;
    });
    const beat = beats[index]!;
    this.seeks++;
    if (this.transport) this.transport.send({ type: 'seek', seconds: beat.start - start });
    else this.activeRuntime.seek(beat.start - start);
    this.ended = false;
    this.authored.clear();
    this.hiddenByFilm.clear();
    this.lastCamBeat = -1;
    this.beatIndex = -1;
    // Earlier beats land their sets, as a played film has them landed when the beat starts.
    this.activeRuntime.setReducedMotion(true);
    if (index > 0) this.activeRuntime.step('goto', beats[index - 1]!.index);
    this.activeRuntime.setReducedMotion(this.reducedMotion);
    for (let i = 0; i <= index; i++) {
      const earlier = beats[i]!;
      this.captureAuthored(earlier.step);
      applyShowHide(this.activeRuntime, earlier.step);
      for (const name of earlier.step.show ?? []) this.hiddenByFilm.delete(name);
      for (const name of earlier.step.hide ?? []) this.hiddenByFilm.add(name);
    }
    this.beatIndex = index;
    this.beatsApplied++;
    this.activeRuntime.step('goto', beat.index);
    this.lastCues = applyBeatCues(this.activeRuntime, beat.step, { sfx: false });
    if (beat.step.cam) this.lastCamBeat = index;
    // The replay's drawing updates reach the figure through the transport:
    // redraw and tick drain the command journal, and the graph only emits on
    // change, so discarding them would leave the figure showing the seek's
    // reset frame with no later repair. Driver mode has no figure to tell.
    const transport = this.transport;
    const replay: RuntimeUpdate[] = [];
    const redrawn = this.activeRuntime.redraw();
    if (transport) replay.push(redrawn);
    // Forward steps play the beat's opening exactly as playing there does, transitions included.
    // They run as direct frames, never wall ticks: ticks skip hidden or idle figures, which would
    // strand the seek at the beat's start.
    this.activeRuntime.play();
    const forward = Math.max(0, Math.round((clamped - beat.start) / FILM_STEP_SECONDS));
    const stepped = this.activeRuntime.playFilmSteps(forward);
    if (transport) replay.push(stepped);
    if (transport) transport.apply?.(mergeUpdates(replay));
    const resume = this.playing;
    const filmEnd = this.runtimes ? this.film.seconds : end;
    const atEnd = clamped + FILM_STEP_SECONDS / 2 >= filmEnd;
    // A seek in click mode always holds where it lands: the learner's next
    // click moves the film, never the clock the seek interrupted.
    this.playing = resume && !isPausePoint(beat.step) && !atEnd && this.advanceMode !== 'click';
    if (this.transport) this.transport.send(this.playing ? { type: 'play' } : { type: 'pause' });
    else if (this.playing) this.activeRuntime.play();
    else this.activeRuntime.pause();
    this.lastNow = this.now();
    if (this.clock && this.playing && this.frameHandle === null) {
      this.frameHandle = this.clock.request(this.loop);
    }
    this.emit({ type: 'seek', beat, time: clamped });
    if (isPausePoint(beat.step)) {
      const kind = beat.step.explore !== undefined ? 'explore' : beat.step.predict !== undefined ? 'predict' : 'hold';
      this.emit({ type: 'pausePoint', beat, kind });
    }
    if (atEnd) this.finish();
  }

  /** Switches the active scene for a seek, clearing per-scene state and emitting the cut. */
  private switchScene(sceneIndex: number): void {
    const from = this.film.scenes[this.active]!;
    this.active = sceneIndex;
    this.resetSceneState();
    this.activeRuntime.setFilm(true);
    this.emit({ type: 'cut', from: from.id, to: this.film.scenes[this.active]!.id });
  }

  /** Seeks to a beat by id, switching scenes when the beat lives elsewhere. */
  seekBeat(id: string): boolean {
    if (this.runtimes) {
      const beat = this.film.beats.find((candidate) => candidate.id === id);
      if (!beat) return false;
      this.seek(beat.start);
      return true;
    }
    const beat = this.sceneBeats.find((candidate) => candidate.id === id);
    if (!beat) return false;
    this.seek(beat.start);
    return true;
  }

  /** Seeks to a chapter: its scene's first beat. False for an unknown scene. */
  seekChapter(sceneId: string): boolean {
    const scene = this.film.scenes.find((candidate) => candidate.id === sceneId);
    if (!scene || scene.beats.length === 0) return false;
    if (!this.runtimes && scene.id !== this.sceneData.id) return false;
    this.seek(scene.start);
    return true;
  }

  /**
   * Advances one beat in film order, crossing scenes and chapters through the
   * same seek every jump reuses. Before the first beat it opens the film.
   * False at the film's end, where a click deck finishes instead of wrapping.
   * In click mode the arrival holds (paused) and emits its beat event, so the
   * beat's narration starts as it does on a played boundary; in time mode this
   * is exactly a seek to the next beat's start.
   */
  nextBeat(): boolean {
    const beats = this.film.beats;
    const at = beats.findIndex((beat) => beat.id === this.currentBeat?.id);
    const next = at >= 0 ? beats[at + 1] : beats[0];
    if (!next) {
      if (this.advanceMode === 'click' && !this.ended && this.currentBeat) this.finish();
      return false;
    }
    this.seek(next.start);
    if (this.advanceMode === 'click' && this.currentBeat) this.emit({ type: 'beat', beat: this.currentBeat });
    return true;
  }

  /**
   * Steps one beat back in film order, through the same seek. On the first
   * beat it re-opens it. In click mode the arrival holds and emits its beat
   * event; in time mode this is exactly a seek to the previous beat's start.
   */
  prevBeat(): boolean {
    const beats = this.film.beats;
    const at = beats.findIndex((beat) => beat.id === this.currentBeat?.id);
    const prev = at > 0 ? beats[at - 1] : beats[0];
    if (!prev) return false;
    this.seek(prev.start);
    if (this.advanceMode === 'click' && this.currentBeat) this.emit({ type: 'beat', beat: this.currentBeat });
    return true;
  }

  /** Seeks to an anchor: beat ids, never seconds. */
  seekAnchor(anchor: FilmAnchor): boolean {
    const seconds = resolveAnchor(this.film, anchor);
    if (seconds === null) return false;
    if (!this.runtimes) {
      const beat = this.film.beats.find((candidate) => candidate.id === anchor.beat && candidate.sceneId === anchor.scene);
      if (!beat || beat.sceneId !== this.sceneData.id) return false;
    }
    this.seek(seconds);
    return true;
  }

  /** The film's transcript: every beat's line with its timing. */
  transcript(): TranscriptLine[] {
    return this.film.beats.map((beat) => ({ beat: beat.id, scene: beat.sceneId, say: beat.step.say, short: beat.step.short ?? null, start: beat.start, seconds: beat.seconds }));
  }

  /** A chapter per scene. */
  chapters(): FilmChapter[] {
    return this.film.scenes.map((scene) => ({ scene: scene.id, title: scene.title, start: scene.start, seconds: scene.seconds, beats: scene.beats.map((beat) => beat.id) }));
  }

  /**
   * Pins the film where it stands: pauses the clock at the current word and
   * anchors there, with the scene's values and readouts as the learner sees
   * them. The ask sheet captures this when it opens.
   */
  anchorNow(): AskAnchor | null {
    const beat = this.currentBeat;
    if (!beat) return null;
    this.pause();
    return askAnchorFor(this.film, beat.id, this.time, { values: this.activeRuntime.values(), readouts: this.activeRuntime.uiState().readouts });
  }

  /**
   * Asks about the film where it stands: the word-boundary anchor, the beat
   * and its neighbours for the answering call. Pauses the film clock at the
   * current word.
   */
  ask(question: string): AskContext | null {
    const beat = this.currentBeat;
    const anchor = this.anchorNow();
    if (!beat || !anchor) return null;
    const at = this.film.beats.findIndex((candidate) => candidate.id === beat.id);
    const lines = this.transcript().slice(Math.max(0, at - 1), at + 2);
    return { question, anchor, beat, lines };
  }

  /** Seeks to an ask anchor: its beat, at the anchor word's start. */
  seekAskAnchor(anchor: AskAnchor): boolean {
    const seconds = resolveAskAnchor(this.film, anchor);
    if (seconds === null) return false;
    this.seek(seconds);
    return true;
  }

  /**
   * Attaches one beat's narration audio as it arrives: the beat takes the
   * audio's length plus the hold, what follows re-times, and the beat on
   * screen stays on screen. Estimated 2.5 words per second until then.
   */
  attachAudio(beatId: string, audio: BeatAudio): void {
    this.retime(attachAudio(this.film, beatId, audio));
  }

  /**
   * Re-times the film as narration audio arrives, keeping the beat on screen.
   * Until audio arrives every beat stays estimated.
   */
  retime(film: CompiledFilm): void {
    const id = this.currentBeat?.id;
    const sceneId = this.runtimes ? this.film.scenes[this.active]?.id : undefined;
    this.film = film;
    if (this.runtimes) {
      if (this.runtimes.length !== film.scenes.length) this.runtimes = null;
      else if (sceneId) this.active = Math.max(0, film.scenes.findIndex((scene) => scene.id === sceneId));
      this.active = Math.min(this.active, film.scenes.length - 1);
    }
    this.beatIndex = id ? Math.max(0, this.sceneBeats.findIndex((beat) => beat.id === id)) : -1;
    if (this.beatIndex < 0 && id) {
      const beat = film.beats.find((candidate) => candidate.id === id);
      if (beat && this.runtimes) {
        this.active = Math.max(0, film.scenes.findIndex((scene) => scene.id === beat.sceneId));
        this.beatIndex = Math.max(0, this.sceneBeats.findIndex((candidate) => candidate.id === id));
      }
    }
    this.emit({ type: 'retime', film });
  }

  destroy(): void {
    if (this.clock && this.frameHandle !== null) {
      this.clock.cancel(this.frameHandle);
      this.frameHandle = null;
    }
    this.listeners.clear();
    this.playing = false;
  }
}
