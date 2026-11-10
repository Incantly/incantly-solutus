import type { Beat, BeatMark, Waveform } from '../api/types';
import type { ProbedParam } from '../probe/probe';
import { accumulatedNotes, beatWrite, SFX_CUES, writeShownAt, type FilmController, type FilmEvent } from '../runtime/film';
import { SceneRuntime, type SceneFunction } from '../runtime/runtime';
import type { FigureHandle } from '../sandbox/adapter';
import type { CompiledBeat, CompiledFilm } from './storyboard';

/**
 * Films over generated scenes: the host never runs the scene's script. Beats
 * come from the sandboxed probe's snapshot, validated here; a stand-in scene
 * — trusted SDK code registering those beats — drives the film clock on the
 * host; and the mirror plays every cue into the sandboxed figure, which draws.
 */

// ---------------------------------------------------------------------------
// The snapshot, validated
// ---------------------------------------------------------------------------

/** A probed snapshot the host checked field by field: safe to compile and mount a stand-in from. */
export interface SanitizedSceneSnapshot {
  readonly steps: readonly Beat[];
  readonly params: readonly ProbedParam[];
  readonly parts: readonly string[];
  readonly hidden: readonly string[];
  readonly stage: { readonly width: number; readonly height: number } | null;
}

const MAX_STEPS = 8;
const MAX_PARAMS = 16;
const MAX_PARTS = 64;
const MAX_LIST = 64;
const MAX_NAME = 60;
const MAX_SAY = 2000;
const MAX_TEXT = 500;
const MAX_SFX = 40;
/** Bounds mirror the compiler's so a sanitized step always compiles. */
const MAX_LAYER_TEXT = 200;
const MAX_NOTES = 4;
const MAX_NOTE_TEXT = 140;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function shortText(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null;
}

function partName(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_NAME ? value : null;
}

function nameList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > MAX_LIST) return null;
  const out: string[] = [];
  for (const entry of value) {
    const name = partName(entry);
    if (name === null) return null;
    out.push(name);
  }
  return out;
}

function valueMap(value: unknown): Readonly<Record<string, number>> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_PARAMS) return null;
  const out: Record<string, number> = {};
  for (const [name, amount] of entries) {
    if (partName(name) === null || !isFiniteNumber(amount)) return null;
    out[name] = amount;
  }
  return out;
}

function sanitizedStep(value: unknown): Beat | null {
  if (!isRecord(value)) return null;
  const say = shortText(value.say, MAX_SAY);
  if (say === null || say.trim() === '') return null;
  const step: { -readonly [K in keyof Beat]: Beat[K] } = { say };
  if (value.focus !== undefined) {
    const focus = partName(value.focus);
    if (focus === null) return null;
    step.focus = focus;
  }
  if (value.set !== undefined) {
    const set = valueMap(value.set);
    if (set === null) return null;
    step.set = set;
  }
  if (value.hold !== undefined) {
    if (typeof value.hold !== 'boolean') return null;
    step.hold = value.hold;
  }
  if (value.view !== undefined) {
    if (value.view !== 'front' && value.view !== 'side' && value.view !== 'top' && value.view !== 'iso') return null;
    step.view = value.view;
  }
  if (value.flat !== undefined) {
    if (typeof value.flat !== 'boolean') return null;
    step.flat = value.flat;
  }
  if (value.id !== undefined) {
    const id = partName(value.id);
    if (id === null) return null;
    step.id = id;
  }
  if (value.ease !== undefined) {
    if (!isFiniteNumber(value.ease)) return null;
    step.ease = value.ease;
  }
  if (value.cam !== undefined) {
    if (!isRecord(value.cam)) return null;
    const cam: { to?: string; zoom?: number } = {};
    if (value.cam.to !== undefined) {
      const to = partName(value.cam.to);
      if (to === null) return null;
      cam.to = to;
    }
    if (value.cam.zoom !== undefined) {
      if (!isFiniteNumber(value.cam.zoom)) return null;
      cam.zoom = value.cam.zoom;
    }
    step.cam = cam;
  }
  if (value.show !== undefined) {
    const show = nameList(value.show);
    if (show === null) return null;
    step.show = show;
  }
  if (value.hide !== undefined) {
    const hide = nameList(value.hide);
    if (hide === null) return null;
    step.hide = hide;
  }
  if (value.mark !== undefined) {
    if (!Array.isArray(value.mark) || value.mark.length > MAX_LIST) return null;
    const marks: BeatMark[] = [];
    for (const entry of value.mark) {
      if (!isRecord(entry)) return null;
      if (entry.type !== 'pulse' && entry.type !== 'draw' && entry.type !== 'arrow' && entry.type !== 'callout' && entry.type !== 'dim') return null;
      const part = partName(entry.part);
      if (part === null) return null;
      marks.push({ type: entry.type, part });
    }
    step.mark = marks;
  }
  if (value.title !== undefined) {
    if (typeof value.title === 'string') {
      const title = shortText(value.title, MAX_TEXT);
      if (title === null) return null;
      step.title = title;
    } else if (isRecord(value.title)) {
      const text = shortText(value.title.text, MAX_TEXT);
      if (text === null) return null;
      if (value.title.kind !== undefined && value.title.kind !== 'card' && value.title.kind !== 'lower') return null;
      step.title = value.title.kind === undefined ? { text } : { text, kind: value.title.kind };
    } else {
      return null;
    }
  }
  if (value.short !== undefined) {
    const short = shortText(value.short, MAX_TEXT);
    if (short === null) return null;
    step.short = short;
  }
  if (value.sfx !== undefined) {
    const sfx = shortText(value.sfx, MAX_SFX);
    if (sfx === null) return null;
    step.sfx = sfx;
  }
  if (value.write !== undefined) {
    if (!isRecord(value.write)) return null;
    const text = shortText(value.write.text, MAX_LAYER_TEXT);
    if (text === null || text.trim() === '') return null;
    if (value.write.math !== undefined && typeof value.write.math !== 'boolean') return null;
    step.write = value.write.math === undefined ? { text } : { text, math: value.write.math };
  }
  if (value.notes !== undefined) {
    if (!Array.isArray(value.notes) || value.notes.length === 0 || value.notes.length > MAX_NOTES) return null;
    const notes: string[] = [];
    for (const entry of value.notes) {
      const line = shortText(entry, MAX_NOTE_TEXT);
      if (line === null || line.trim() === '') return null;
      notes.push(line);
    }
    step.notes = notes;
  }
  // Full-stage cards are gone: a step still sending one is not a valid step.
  if (value.card !== undefined) return null;
  if (value.explore !== undefined) {
    if (!isRecord(value.explore)) return null;
    const control = partName(value.explore.control);
    if (control === null) return null;
    if (value.explore.hint !== undefined) {
      const hint = shortText(value.explore.hint, MAX_TEXT);
      if (hint === null) return null;
      step.explore = { control, hint };
    } else {
      step.explore = { control };
    }
  }
  if (value.predict !== undefined) {
    if (!isRecord(value.predict)) return null;
    const question = shortText(value.predict.question, MAX_TEXT);
    if (question === null) return null;
    if (!Array.isArray(value.predict.options) || value.predict.options.length < 2 || value.predict.options.length > 5) return null;
    const options: string[] = [];
    for (const option of value.predict.options) {
      const text = shortText(option, MAX_TEXT);
      if (text === null) return null;
      options.push(text);
    }
    const predict: { question: string; options: readonly string[]; answer: number; reveal?: Readonly<Record<string, number>>; explain?: string } = {
      question,
      options,
      answer: -1,
    };
    // A function answer never crosses the Worker boundary; the probe drops
    // it. The host never grades predictions — the figure does, with the real
    // scene — so an absent answer keeps its presence as -1, which every
    // bounds-checked reader treats as unknown.
    predict.answer =
      typeof value.predict.answer === 'number' && Number.isInteger(value.predict.answer) && value.predict.answer >= 0 ? value.predict.answer : -1;
    if (value.predict.reveal !== undefined) {
      const reveal = valueMap(value.predict.reveal);
      if (reveal === null) return null;
      predict.reveal = reveal;
    }
    if (value.predict.explain !== undefined) {
      const explain = shortText(value.predict.explain, MAX_SAY);
      if (explain === null) return null;
      predict.explain = explain;
    }
    step.predict = predict;
  }
  return step;
}

/**
 * Checks a probed snapshot field by field and rebuilds it fresh: the scene
 * controlled every value, so nothing crosses on trust. Null rejects the
 * scene — the film never plays it.
 */
export function sanitizeProbedSnapshot(value: unknown): SanitizedSceneSnapshot | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.steps) || value.steps.length === 0 || value.steps.length > MAX_STEPS) return null;
  const steps: Beat[] = [];
  for (const entry of value.steps) {
    const step = sanitizedStep(entry);
    if (step === null) return null;
    steps.push(step);
  }
  if (!Array.isArray(value.params) || value.params.length > MAX_PARAMS) return null;
  const params: ProbedParam[] = [];
  const names = new Set<string>();
  for (const entry of value.params) {
    if (!isRecord(entry)) return null;
    const name = partName(entry.name);
    if (name === null || names.has(name)) return null;
    if (!isFiniteNumber(entry.value) || !isFiniteNumber(entry.min) || !isFiniteNumber(entry.max) || !isFiniteNumber(entry.step)) return null;
    if (entry.min > entry.max || entry.value < entry.min || entry.value > entry.max || entry.step <= 0) return null;
    names.add(name);
    params.push({ name, value: entry.value, min: entry.min, max: entry.max, step: entry.step });
  }
  if (!Array.isArray(value.parts) || value.parts.length > MAX_PARTS) return null;
  const parts: string[] = [];
  const known = new Set<string>();
  for (const entry of value.parts) {
    const name = partName(entry);
    if (name === null || known.has(name)) return null;
    known.add(name);
    parts.push(name);
  }
  if (!Array.isArray(value.hidden) || value.hidden.length > MAX_PARTS) return null;
  const hidden: string[] = [];
  for (const entry of value.hidden) {
    const name = partName(entry);
    if (name === null || !known.has(name)) return null;
    hidden.push(name);
  }
  let stage: SanitizedSceneSnapshot['stage'] = null;
  if (value.stage !== null && value.stage !== undefined) {
    if (!isRecord(value.stage) || !isFiniteNumber(value.stage.width) || !isFiniteNumber(value.stage.height)) return null;
    if (value.stage.width <= 0 || value.stage.height <= 0 || value.stage.width > 10000 || value.stage.height > 10000) return null;
    stage = { width: value.stage.width, height: value.stage.height };
  }
  return { steps, params, parts, hidden, stage };
}

// ---------------------------------------------------------------------------
// The stand-in scene
// ---------------------------------------------------------------------------

/**
 * A trusted scene from a checked snapshot: the same steps, parameters and
 * parts, drawn as dots on a stub stage that is never shown. The film
 * controller drives it for timing, beats and cues; the sandboxed figure
 * draws what the mirror sends it.
 */
export function buildStubScene(snapshot: SanitizedSceneSnapshot): SceneFunction {
  return (inc) => {
    inc.idea('A stand-in scene keeps the film clock while the drawing plays in the sandbox.');
    for (const param of snapshot.params) {
      inc.param(param.name, { min: param.min, max: param.max, value: param.value, step: param.step });
    }
    const stage = inc.svg('#stub', { viewBox: [0, 0, 100, 100], title: 'Stand-in stage' });
    for (const name of snapshot.parts) {
      stage.part(name, stage.circle(0, 0, 1, {}));
    }
    // Reading time keeps the stand-in animated, so its film clock ticks in
    // driver mode exactly while playing — a still scene would idle its clock.
    inc.onFrame((frame) => {
      void frame.time;
    });
    inc.steps([...snapshot.steps]);
  };
}

/**
 * Mounts a stand-in runtime and lands the parts' authored visibility, as the
 * scene mounted them. Throws when the snapshot refuses to mount, like any
 * scene that throws: the film never plays it.
 */
export function mountStubRuntime(snapshot: SanitizedSceneSnapshot, options: { readonly seed?: number } = {}): SceneRuntime {
  const runtime = new SceneRuntime({ film: true, autoplay: false, ...(options.seed !== undefined ? { seed: options.seed } : {}) });
  runtime.mount(buildStubScene(snapshot));
  for (const name of snapshot.hidden) {
    const record = runtime.parts.parts.get(name);
    if (record && !record.node.hidden) runtime.graph.setFlags(record.node, { hidden: true });
  }
  return runtime;
}

// ---------------------------------------------------------------------------
// One beat's absolute cue state, for capture
// ---------------------------------------------------------------------------

/** Everything a beat shows: its step, focus, part visibility and camera. */
export interface BeatCueState {
  readonly step: number;
  readonly focus: string | null;
  readonly visible: ReadonlyMap<string, boolean>;
  readonly frame: { readonly part: string; readonly zoom: number } | null;
  /** The beat's write-on layer with its shown prefix at the captured time, or null. */
  readonly write: { readonly text: string; readonly math: boolean; readonly shown: string } | null;
  /** Every note line showing on this beat: its scene's lines up to and including it. */
  readonly notes: readonly string[];
  /** True when the beat's scene renders split: the same compiled value the player, checks and export read. */
  readonly split: boolean;
}

/**
 * A beat's cue state from film data alone: authored visibility, earlier
 * beats' show and hide lists landed in order, the beat's own marks brought
 * in. The capture sessions seek each frame fresh, so every frame applies the
 * absolute state — the same state the controller's seek lands.
 */
export function beatCueState(
  film: CompiledFilm,
  sceneId: string,
  beatIndex: number,
  authoredHidden: ReadonlySet<string>,
  /** Film seconds of the captured frame: the write-on reveal follows it. Default the beat's start. */
  at?: number,
): BeatCueState | null {
  const scene = film.scenes.find((candidate) => candidate.id === sceneId);
  const beat = scene?.beats.find((candidate) => candidate.index === beatIndex);
  if (!scene || !beat) return null;
  const write = beatWrite(beat.step);
  const visible = new Map<string, boolean>();
  const names = new Set<string>();
  for (const earlier of scene.beats) {
    if (earlier.index > beatIndex) break;
    for (const name of [...(earlier.step.show ?? []), ...(earlier.step.hide ?? [])]) names.add(name);
  }
  for (const mark of beat.step.mark ?? []) names.add(mark.part);
  for (const name of names) visible.set(name, !authoredHidden.has(name));
  for (const earlier of scene.beats) {
    if (earlier.index > beatIndex) break;
    for (const name of earlier.step.show ?? []) visible.set(name, true);
    for (const name of earlier.step.hide ?? []) visible.set(name, false);
  }
  for (const mark of beat.step.mark ?? []) {
    if (mark.type === 'arrow' || mark.type === 'callout' || mark.type === 'draw') visible.set(mark.part, true);
  }
  return {
    step: beat.index,
    focus: beat.step.focus ?? beat.step.cam?.to ?? beat.step.mark?.[0]?.part ?? null,
    visible,
    frame: beat.step.cam?.to ? { part: beat.step.cam.to, zoom: beat.step.cam.zoom ?? 1.5 } : null,
    // Layers ride the host's DOM as titles do — the figure has no drawing op
    // for them — so the cue state carries what to show, not how to draw it.
    write: write ? { ...write, shown: writeShownAt(beat, at ?? beat.start) } : null,
    notes: accumulatedNotes(scene.beats, beatIndex),
    split: scene.split,
  };
}

/** Plays one beat's absolute cue state into a sandboxed figure. Silent: captures never sound sfx. */
export function applyCueState(handle: FigureHandle, state: BeatCueState): void {
  handle.restore({ step: state.step });
  for (const [name, shown] of state.visible) handle.setPartVisible(name, shown);
  handle.focusPart(state.focus);
  if (state.frame) handle.framePart(state.frame.part, state.frame.zoom);
}

/**
 * Lands a stand-in's absolute state into a sandboxed figure: step, every
 * value, focus, every part's visibility, and the camera — or wide when the
 * beat carries none. Captures seek the stand-in fresh for every frame, then
 * land here and snapshot: the same state the controller's seek lands, with
 * no lockstep to drift. Silent, as applyCueState is.
 */
export function pushAbsoluteState(handle: FigureHandle, stub: SceneRuntime, cam: { readonly to?: string; readonly zoom?: number } | null | undefined): void {
  // Steps ride restore's teaching-position half, as saved positions do; the
  // values follow, so a step's own sets never linger past the absolute state.
  handle.restore({ step: stub.currentStep });
  handle.setValues({ ...stub.values() });
  handle.focusPart(stub.uiState().focus ?? null);
  for (const [name, record] of stub.parts.parts) handle.setPartVisible(name, !record.node.hidden);
  if (cam?.to) handle.framePart(cam.to, cam.zoom ?? 1.5);
  else handle.framePart(null);
}

// ---------------------------------------------------------------------------
// The live mirror
// ---------------------------------------------------------------------------

/** One sandboxed scene with the stand-in runtime the controller drives. */
export interface SandboxFilmScene {
  readonly id: string;
  readonly stub: SceneRuntime;
  readonly handle: FigureHandle;
}

interface MirroredState {
  step: number | null;
  values: Record<string, number>;
  focus: string | null;
  visible: Map<string, boolean>;
  /** A camera beat landed since the last seek or scene change, as the controller's lastCamBeat. */
  lastCam: boolean;
}

/**
 * Plays a film controller into sandboxed figures. The controller drives the
 * stand-ins in driver mode; every event lands the same cues across the
 * bridge: beats as step, values, focus, visibility and camera, seeks as a
 * seek plus the full state, sfx as notes, play and pause as playing. Speed
 * and volume wrap the controller's own, so every caller stays mirrored.
 */
export class SandboxFilmMirror {
  private readonly states: MirroredState[];
  private active = 0;
  private readonly unsubscribe: () => void;
  private readonly setSpeed: (value: number) => void;
  private readonly setVolume: (value: number) => void;

  constructor(
    private readonly controller: FilmController,
    private readonly scenes: readonly SandboxFilmScene[],
    private readonly film: () => CompiledFilm,
  ) {
    this.states = scenes.map((scene) => ({
      step: scene.stub.currentStep,
      values: { ...scene.stub.values() },
      focus: scene.stub.uiState().focus ?? null,
      visible: new Map([...scene.stub.parts.parts].map(([name, record]) => [name, !record.node.hidden] as const)),
      lastCam: false,
    }));
    this.unsubscribe = controller.on((event) => this.onEvent(event));
    this.setSpeed = controller.setSpeed.bind(controller);
    this.setVolume = controller.setVolume.bind(controller);
    controller.setSpeed = (value: number): void => {
      this.setSpeed(value);
      this.scenes[controller.sceneIndex]?.handle.setSpeed(value);
    };
    controller.setVolume = (value: number): void => {
      this.setVolume(value);
      const volume = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5));
      this.scenes[controller.sceneIndex]?.handle.setValues({ $volume: volume });
    };
  }

  /**
   * Syncs one scene's stand-in to its figure: step, changed values, focus and
   * changed visibility. The ask sheet calls this after its direct runtime
   * writes, through the renderer's apply, as the seek path does.
   */
  syncScene(index: number): void {
    const scene = this.scenes[index];
    const state = this.states[index];
    if (!scene || !state) return;
    if (scene.stub.currentStep !== state.step) {
      state.step = scene.stub.currentStep;
      // Steps ride restore's teaching-position half, as saved positions do.
      scene.handle.restore({ step: state.step });
    }
    const values = scene.stub.values();
    const changed: Record<string, number> = {};
    for (const [name, value] of Object.entries(values)) {
      if (state.values[name] !== value) {
        changed[name] = value;
        state.values[name] = value;
      }
    }
    if (Object.keys(changed).length > 0) scene.handle.setValues(changed);
    const focus = scene.stub.uiState().focus ?? null;
    if (focus !== state.focus) {
      state.focus = focus;
      scene.handle.focusPart(focus);
    }
    for (const [name, record] of scene.stub.parts.parts) {
      const shown = !record.node.hidden;
      if (state.visible.get(name) !== shown) {
        state.visible.set(name, shown);
        scene.handle.setPartVisible(name, shown);
      }
    }
  }

  private switchActive(index: number): void {
    if (index === this.active) return;
    this.scenes[this.active]?.handle.setPlaying(false);
    this.active = index;
  }

  /** Lands one beat's cues: the stand-in's state, plus the camera the stand-in cannot frame. */
  private onBeat(beat: CompiledBeat, forward: boolean): void {
    const scene = this.scenes[this.active];
    const state = this.states[this.active];
    if (!scene || !state) return;
    this.syncScene(this.active);
    if (beat.step.cam?.to) {
      scene.handle.framePart(beat.step.cam.to, beat.step.cam.zoom ?? 1.5);
      state.lastCam = true;
    } else if (forward && state.lastCam) {
      scene.handle.framePart(null);
      state.lastCam = false;
    } else if (!forward) {
      state.lastCam = false;
    }
    // A step lands at once and may pause, as under the controller: play is re-asserted after it.
    scene.handle.setPlaying(this.controller.isPlaying);
  }

  private onEvent(event: FilmEvent): void {
    switch (event.type) {
      case 'beat':
        this.switchActive(this.controller.sceneIndex);
        this.onBeat(event.beat, true);
        break;
      case 'sfx': {
        const scene = this.scenes[this.active];
        const notes = event.played ? SFX_CUES[event.name] : undefined;
        if (scene && notes) {
          for (const note of notes) {
            scene.handle.note({
              wave: (note.wave ?? 'sine') as Waveform,
              frequency: note.frequency,
              duration: note.duration ?? 0.2,
              gain: note.gain ?? 0.5,
            });
          }
        }
        break;
      }
      case 'play':
        this.scenes[this.controller.sceneIndex]?.handle.setPlaying(true);
        break;
      case 'pause':
      case 'pausePoint':
      case 'held':
      case 'end':
        this.scenes[this.controller.sceneIndex]?.handle.setPlaying(false);
        break;
      case 'cut':
        this.switchActive(this.controller.sceneIndex);
        this.scenes[this.active]?.handle.setPlaying(this.controller.isPlaying);
        break;
      case 'seek': {
        this.switchActive(this.controller.sceneIndex);
        const scene = this.scenes[this.active];
        if (!scene) break;
        const film = this.film();
        const start = film.scenes.find((candidate) => candidate.id === event.beat.sceneId)?.start ?? 0;
        scene.handle.seek(Math.max(0, event.beat.start - start));
        this.onBeat(event.beat, false);
        break;
      }
      case 'retime':
        break;
    }
  }

  destroy(): void {
    this.unsubscribe();
    this.controller.setSpeed = this.setSpeed;
    this.controller.setVolume = this.setVolume;
  }
}
