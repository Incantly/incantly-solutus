import type { AskAnchor } from './ask';
import type { LiveToolDeclaration, LiveVoice } from './live-voice';
import { beginShowMe, type FilmController } from '../runtime/film';
import type { SceneRuntime } from '../runtime/runtime';
import { resolveAskAnchor } from './ask';
import type { CompiledBeat, CompiledFilm } from './storyboard';

/** What one live tool answered: data on success, a short reason on refusal. */
export type LiveToolResult = { readonly ok: true; readonly [detail: string]: unknown } | { readonly ok: false; readonly error: string };

/** Changes control values on the paused scene; core stays free of network code. */
export type LiveShowMe = (set: Readonly<Record<string, number>>, beat: CompiledBeat) => unknown | Promise<unknown>;

/** Draws another example through the host pipeline, pinned at the anchor. */
export type LiveMakeExample = (request: string, anchor: AskAnchor) => unknown | Promise<unknown>;

/** One control as the voice sees it: a number within its range, if known. */
interface LiveControlSchema {
  readonly name: string;
  readonly label: string;
  readonly unit: string;
  readonly min: number | null;
  readonly max: number | null;
}

/** The film's controls with their ranges: the runtime's params, or the beat sets' names when no runtime is given. */
function liveControls(film: CompiledFilm, runtime?: SceneRuntime): readonly LiveControlSchema[] {
  const params = runtime?.uiState().params;
  if (params && params.length > 0) {
    return params.map((param) => ({
      name: param.name,
      label: param.label !== '' ? param.label : param.name,
      unit: param.unit,
      min: Number.isFinite(param.min) ? param.min : null,
      max: Number.isFinite(param.max) ? param.max : null,
    }));
  }
  const names = new Set<string>();
  for (const beat of film.beats) {
    for (const key of Object.keys(beat.step.set ?? {})) names.add(key);
  }
  return [...names].map((name) => ({ name, label: name, unit: '', min: null, max: null }));
}

/**
 * The six tools of live-voice-films.md 5.3, declared for this film. The
 * voice only gets the OpenAPI subset providers accept (type, description,
 * properties, required, enum, minimum, maximum): no additionalProperties,
 * unions or minLength anywhere, so beat ids are an enum and every control is
 * a named number property with its range. The dispatcher still accepts a beat
 * index and still validates every value, whatever the declaration names.
 */
export function liveToolDeclarations(film: CompiledFilm, runtime?: SceneRuntime): readonly LiveToolDeclaration[] {
  const beats = film.beats.map((beat) => beat.id);
  const setProperties: Record<string, unknown> = {};
  for (const control of liveControls(film, runtime)) {
    setProperties[control.name] = {
      description: control.unit !== '' ? `${control.label} (${control.unit})` : control.label,
      type: 'number',
      ...(control.min !== null ? { minimum: control.min } : {}),
      ...(control.max !== null ? { maximum: control.max } : {}),
    };
  }
  return [
    {
      name: 'pause',
      description: 'Pause the film. Never call it for a question: the film pauses itself when the learner speaks or types.',
      parameters: { type: 'object', properties: {} },
      blocking: true,
    },
    {
      name: 'resume',
      description: 'Continue reading after the learner asks to carry on. Only call it when they say to continue.',
      parameters: { type: 'object', properties: {} },
      blocking: true,
    },
    {
      name: 'seek_beat',
      description: 'Jump to a beat by id or index, then read it.',
      parameters: {
        type: 'object',
        properties: { beat: { description: 'Beat id, or its index in the film.', type: 'string', enum: beats } },
        required: ['beat'],
      },
      blocking: true,
    },
    {
      name: 'get_context',
      description: 'Current beat, beats said so far, its source lines, control values and readouts.',
      parameters: { type: 'object', properties: {} },
      blocking: true,
    },
    {
      name: 'show_me',
      description: 'Change control values on the paused scene when the learner asks to see different values, and talk through what changed. Describe only what its result says was shown; never promise values outside the ranges in its declaration.',
      parameters: {
        type: 'object',
        properties: {
          set: { description: 'Control values to change to.', type: 'object', properties: setProperties },
          beat: { description: 'Beat id to replay; the current beat when left out.', type: 'string', enum: beats },
        },
        required: ['set'],
      },
      blocking: true,
    },
    {
      name: 'make_example',
      description: 'Draw another example as a detour when the learner asks for one, then return to the pinned word. Report only what its result says was made; if it fails, say so in one short sentence.',
      parameters: {
        type: 'object',
        properties: { request: { description: 'What to draw.', type: 'string' } },
        required: ['request'],
      },
      blocking: false,
    },
  ];
}

/** What the tool dispatcher needs from the driver and the host. */
export interface LiveToolDeps {
  readonly controller: FilmController;
  readonly film: CompiledFilm;
  readonly voice: LiveVoice;
  /** The live scene's runtime: control ranges, values and the default show-me. */
  readonly runtime?: SceneRuntime;
  readonly showMe?: LiveShowMe;
  readonly makeExample?: LiveMakeExample;
  /** Beats the voice has said so far, in order, for get_context. */
  saidBeats(): readonly CompiledBeat[];
  /** The last recorded interrupt or pause anchor, for resume. */
  currentAnchor(): AskAnchor | null;
  recordAnchor(anchor: AskAnchor): void;
  /** The voice's transcript for a turn, for the transcript-based anchor word. */
  transcriptFor(turnId: string | null): string | undefined;
  /** Records an interrupt or pause anchor and stops tracking the spoken turn. */
  notePaused(anchor: AskAnchor): void;
  /** True while the spoken turn is suspended, until resume or a seek speaks again. */
  isPaused(): boolean;
  /** Reads a beat aloud and tracks it as the current turn. */
  sayBeat(beat: CompiledBeat): void;
  /** Reads a beat from its anchor word on and tracks it as the current turn. */
  sayBeatRemainder(beat: CompiledBeat, wordIndex: number): void;
  /**
   * Schedules a resume after the tool response: it runs once the model's
   * reply turn ends, or on the fallback when the model says nothing. False
   * when a resume is already waiting, making repeats idempotent.
   */
  scheduleResume(): boolean;
  /** True once a beat's turn completed, so resume knows it was fully read. */
  wasCompleted(beatId: string): boolean;
  /** True once the film has been read to the end. */
  isDone(): boolean;
  /** Restarts a finished film from beat one for resume-after-done. */
  restartAfterDone(): CompiledBeat | null;
  /** The live session's epoch: results from an older epoch are dropped. */
  sessionEpoch(): number;
  /** Marks the film read to the end with nothing left to say. */
  finish(): void;
  onResult?(info: { readonly callId: string; readonly name: string; readonly result: LiveToolResult }): void;
}

/**
 * The default show-me binding: replays the beat on the live scene through
 * beginShowMe (the same path the film itself uses), then lands the requested
 * values on top. Resuming by seek replays the film's own values there.
 */
export function defaultShowMeBinding(runtime: SceneRuntime): LiveShowMe {
  return (set, beat) => {
    const session = beginShowMe(runtime, beat);
    runtime.setValues({ ...set });
    return session.cues;
  };
}

/**
 * Runs the six live tools against the film and answers the voice with
 * respondTool. Every argument is validated against the film first; a bad call
 * answers { ok: false, error } and never throws.
 */
export class LiveToolDispatcher {
  /** Tool calls with a host round-trip still running, by call id. */
  private readonly inflight = new Set<string>();

  constructor(private readonly deps: LiveToolDeps) {}

  /** Runs one tool call and answers the voice; never throws. */
  async dispatch(callId: string, name: string, args: unknown): Promise<void> {
    const at = this.deps.sessionEpoch();
    // One host call per id: a repeated tool call joins nothing and answers nothing.
    if (this.inflight.has(callId)) return;
    this.inflight.add(callId);
    try {
      const result = await this.run(name, args);
      // The session ended while the host ran: drop the late result entirely.
      if (this.deps.sessionEpoch() !== at) return;
      try {
        this.deps.voice.respondTool(callId, result);
      } catch {
        // A broken voice must not break the film; the result is still reported.
      }
      this.deps.onResult?.({ callId, name, result });
    } catch (error) {
      if (this.deps.sessionEpoch() !== at) return;
      const result: LiveToolResult = { ok: false, error: shortMessage(error) };
      try {
        this.deps.voice.respondTool(callId, result);
      } catch {
        // A broken voice must not break the film; the result is still reported.
      }
      this.deps.onResult?.({ callId, name, result });
    } finally {
      this.inflight.delete(callId);
    }
  }

  /** The resume rung on its own, so the host can resume after an insert. */
  resumeNow(): LiveToolResult {
    // A finished reading has no anchor worth returning to: resume restarts
    // the film instead of stranding the driver in done.
    if (this.deps.isDone()) {
      const first = this.deps.restartAfterDone();
      if (!first) return { ok: false, error: 'The film has no beats to read.' };
      return { ok: true, beat: first.id, restarted: true };
    }
    const anchor = this.deps.currentAnchor();
    if (!anchor) return { ok: false, error: 'Nothing to resume: pause or interrupt the film first.' };
    const beat = this.deps.film.beats.find((candidate) => candidate.id === anchor.beat) ?? null;
    if (!beat) return { ok: false, error: 'The pinned beat is no longer in this film.' };
    const at = resolveAskAnchor(this.deps.film, anchor);
    if (at === null) return { ok: false, error: 'The pinned word no longer resolves in this film.' };
    // The anchor is where the film stands (interrupt, pause, or a seek that
    // re-pinned it): re-read it from the anchor word on, so nothing it said
    // is lost. Only a film that drifted past a completed anchor moves on.
    if (this.deps.controller.currentBeat?.id === anchor.beat) {
      this.deps.controller.seek(at);
      this.deps.sayBeatRemainder(beat, anchor.wordIndex);
      return { ok: true, beat: beat.id, fromWord: anchor.wordIndex };
    }
    this.deps.controller.seek(at);
    if (!this.deps.wasCompleted(anchor.beat)) {
      this.deps.sayBeatRemainder(beat, anchor.wordIndex);
      return { ok: true, beat: beat.id, fromWord: anchor.wordIndex };
    }
    const atIndex = this.deps.film.beats.findIndex((candidate) => candidate.id === anchor.beat);
    const next = this.deps.film.beats[atIndex + 1] ?? null;
    if (!next) {
      this.deps.finish();
      return { ok: true, beat: null, done: true };
    }
    if (!this.deps.controller.nextBeat()) {
      this.deps.finish();
      return { ok: true, beat: null, done: true };
    }
    const current = this.deps.controller.currentBeat ?? next;
    this.deps.sayBeat(current);
    return { ok: true, beat: current.id };
  }

  private async run(name: string, args: unknown): Promise<LiveToolResult> {
    switch (name) {
      case 'pause':
        return this.pause();
      case 'resume':
        return this.requestResume();
      case 'seek_beat':
        return this.seekBeat(args);
      case 'get_context':
        return this.context();
      case 'show_me':
        return this.showMe(args);
      case 'make_example':
        return this.makeExample(args);
      default:
        return { ok: false, error: `Unknown tool "${name}".` };
    }
  }

  /**
   * Validates resume and schedules it after the model's reply turn; the
   * result describes the plan the scheduled run will carry out. The driver
   * re-runs the same decision at run time, so a moved anchor still lands.
   */
  private requestResume(): LiveToolResult {
    // A finished reading restarts at once: there is no paused beat whose
    // re-read could talk over the model.
    if (this.deps.isDone()) return this.resumeNow();
    const planned = this.planResume();
    if (!planned.ok) return planned;
    if (!this.deps.scheduleResume()) return { ok: true, already: true };
    return planned.result;
  }

  /** The resume plan without acting: validation shared with the scheduled run. */
  private planResume(): { ok: true; result: LiveToolResult } | { ok: false; error: string } {
    const anchor = this.deps.currentAnchor();
    if (!anchor) return { ok: false, error: 'Nothing to resume: pause or interrupt the film first.' };
    const beat = this.deps.film.beats.find((candidate) => candidate.id === anchor.beat) ?? null;
    if (!beat) return { ok: false, error: 'The pinned beat is no longer in this film.' };
    const at = resolveAskAnchor(this.deps.film, anchor);
    if (at === null) return { ok: false, error: 'The pinned word no longer resolves in this film.' };
    if (this.deps.controller.currentBeat?.id === anchor.beat || !this.deps.wasCompleted(anchor.beat)) {
      return { ok: true, result: { ok: true, beat: beat.id, fromWord: anchor.wordIndex } };
    }
    const atIndex = this.deps.film.beats.findIndex((candidate) => candidate.id === anchor.beat);
    const next = this.deps.film.beats[atIndex + 1] ?? null;
    if (!next) return { ok: true, result: { ok: true, beat: null, done: true } };
    return { ok: true, result: { ok: true, beat: next.id } };
  }

  private pause(): LiveToolResult {
    const pinned = this.pauseForTool();
    if (!pinned.ok) return pinned;
    return { ok: true, beat: pinned.anchor.beat, wordIndex: pinned.anchor.wordIndex };
  }

  /**
   * Suspends the spoken turn for a tool call: the film pauses and the anchor
   * pins the transcript word, exactly as on interrupt. An already-paused film
   * keeps its anchor, so a detour never moves the pin the learner resumes to.
   */
  private pauseForTool(): { readonly ok: true; readonly anchor: AskAnchor } | { readonly ok: false; readonly error: string } {
    this.deps.controller.pause();
    if (this.deps.isPaused()) {
      const existing = this.deps.currentAnchor();
      if (existing) return { ok: true, anchor: existing };
    }
    const anchor = this.deps.controller.anchorNow();
    if (!anchor) return { ok: false, error: 'Nothing to pin: the film has no current beat.' };
    const beat = this.deps.film.beats.find((candidate) => candidate.id === anchor.beat) ?? null;
    // Click mode never follows the voice, so the word comes from what was
    // said, exactly as on interrupt — never from the clock.
    const pinned = beat ? { ...anchor, wordIndex: transcriptWordIndex(this.deps.transcriptFor(anchor.beat), beat) } : anchor;
    this.deps.notePaused(pinned);
    return { ok: true, anchor: pinned };
  }

  private seekBeat(args: unknown): LiveToolResult {
    const ref = isRecord(args) ? args.beat : undefined;
    const beat = resolveBeat(this.deps.film, ref);
    if (!beat) return { ok: false, error: `Unknown beat ${JSON.stringify(ref) ?? 'missing'}.` };
    if (!this.deps.controller.seekBeat(beat.id)) return { ok: false, error: `Cannot seek to beat "${beat.id}".` };
    const current = this.deps.controller.currentBeat ?? beat;
    // A deliberate seek retires the old pin: resume must not drag the film
    // back to where it stood before the jump.
    const now = this.deps.controller.anchorNow();
    if (now) this.deps.recordAnchor({ ...now, wordIndex: 0 });
    this.deps.sayBeat(current);
    return { ok: true, beat: current.id };
  }

  /**
   * Compact one-line screen state for the voice: the current beat's text,
   * the beats said so far as ids, control values with units, and readouts.
   * Null with no current beat.
   */
  contextLine(): string | null {
    const screen = this.screen();
    if (!screen) return null;
    const parts = [`On screen: ${screen.current.step.say}`];
    const said = this.deps.saidBeats().map((beat) => beat.id);
    if (said.length > 0) parts.push(`Said: ${said.join(' ')}`);
    const shown = Object.entries(screen.values).map(([name, value]) => {
      const unit = screen.units[name];
      return `${name}=${value}${unit ? ` ${unit}` : ''}`;
    });
    if (shown.length > 0) parts.push(shown.join(', '));
    for (const readout of screen.readouts) parts.push(`${readout.label}: ${readout.text}`);
    return parts.join(' | ');
  }

  private context(): LiveToolResult {
    const screen = this.screen();
    if (!screen) return { ok: false, error: 'The film has no current beat yet.' };
    return {
      ok: true,
      current: { id: screen.current.id, text: screen.current.step.say },
      said: this.deps.saidBeats().map((beat) => ({ id: beat.id, text: beat.step.say })),
      sourceLines: [...(this.deps.film.sourceMap[screen.current.id]?.lines ?? [])],
      values: screen.values,
      readouts: screen.readouts,
    };
  }

  /** The screen state both get_context and the interrupt push share. */
  private screen(): {
    readonly current: CompiledBeat;
    readonly values: Record<string, number>;
    readonly units: Readonly<Record<string, string>>;
    readonly readouts: ReadonlyArray<{ readonly label: string; readonly text: string }>;
  } | null {
    const current = this.deps.controller.currentBeat;
    if (!current) return null;
    const anchor = this.deps.currentAnchor();
    const runtime = this.deps.runtime;
    const params = runtime?.uiState().params ?? [];
    const units: Record<string, string> = {};
    for (const param of params) {
      if (param.unit !== '') units[param.name] = param.unit;
    }
    const values = { ...(runtime ? runtime.values() : (anchor?.controlValues ?? {})) };
    const seen = runtime ? runtime.uiState().readouts : (anchor?.readouts ?? []);
    const readouts = seen.map((readout) => ({ label: readout.label, text: readout.text }));
    return { current, values, units, readouts };
  }

  private async showMe(args: unknown): Promise<LiveToolResult> {
    const fields = isRecord(args) ? args : {};
    const beat = fields.beat === undefined ? (this.deps.controller.currentBeat ?? null) : resolveBeat(this.deps.film, fields.beat);
    if (!beat) return { ok: false, error: `Unknown beat ${JSON.stringify(fields.beat) ?? 'missing'}.` };
    if (!isRecord(fields.set)) return { ok: false, error: 'show_me needs a set of control values.' };
    const checked = checkControls(this.controlBounds(), fields.set);
    if (!checked.ok) return checked;
    // A refused tool has no side effects: the host is validated first.
    const show = this.deps.showMe ?? (this.deps.runtime ? defaultShowMeBinding(this.deps.runtime) : undefined);
    if (!show) return { ok: false, error: 'show_me has no host: pass a showMe callback or a runtime.' };
    // The paused scene must not move under the demonstration.
    const pinned = this.pauseForTool();
    if (!pinned.ok) return pinned;
    let shown: unknown;
    try {
      shown = await show(checked.set, beat);
    } catch (error) {
      return { ok: false, error: shortMessage(error) };
    }
    return { ok: true, beat: beat.id, set: checked.set, shown: shown ?? null };
  }

  private async makeExample(args: unknown): Promise<LiveToolResult> {
    const request = isRecord(args) ? args.request : undefined;
    if (typeof request !== 'string' || request.trim() === '') return { ok: false, error: 'make_example needs a request to draw.' };
    // A refused tool has no side effects: the host is validated first.
    const make = this.deps.makeExample;
    if (!make) return { ok: false, error: 'make_example has no host: pass a makeExample callback.' };
    // The film stays paused until the example has played and the learner
    // resumes; the insert must never play over an advanced film.
    const pinned = this.pauseForTool();
    if (!pinned.ok) return pinned;
    const anchor = pinned.anchor;
    let made: unknown;
    try {
      made = await make(request.trim(), anchor);
    } catch (error) {
      return { ok: false, error: shortMessage(error) };
    }
    // The host's description passes through untouched: the model must repeat
    // what was actually made, not what was asked for.
    return { ok: true, made };
  }

  /** Control bounds from the runtime's params, or film set-keys with no bounds. */
  /** Validation bounds from the same control list the declarations name. */
  private controlBounds(): ReadonlyMap<string, { readonly min: number; readonly max: number }> {
    return new Map(
      liveControls(this.deps.film, this.deps.runtime).map((control) => [
        control.name,
        { min: control.min ?? -Infinity, max: control.max ?? Infinity },
      ]),
    );
  }
}

/**
 * Where an interruption landed: words the voice had actually said, as a
 * 0-based index into the beat, clamped into it. Silence pins the first word.
 */
export function transcriptWordIndex(transcript: string | undefined, beat: CompiledBeat): number {
  const said = transcript === undefined ? [] : transcript.trim().split(/\s+/).filter((word) => word !== '');
  if (said.length === 0 || beat.words.length === 0) return 0;
  return Math.min(Math.max(said.length - 1, 0), beat.words.length - 1);
}

/** A beat by id or by index in the film; null for anything else. */
export function resolveBeat(film: CompiledFilm, ref: unknown): CompiledBeat | null {
  if (typeof ref === 'string') return film.beats.find((beat) => beat.id === ref) ?? null;
  if (typeof ref === 'number' && Number.isInteger(ref)) return film.beats[ref] ?? null;
  return null;
}

type CheckedControls =
  | { readonly ok: true; readonly set: Readonly<Record<string, number>> }
  | { readonly ok: false; readonly error: string };

function checkControls(
  bounds: ReadonlyMap<string, { readonly min: number; readonly max: number }>,
  set: Record<string, unknown>,
): CheckedControls {
  const clean: Record<string, number> = {};
  for (const [name, value] of Object.entries(set)) {
    const bound = bounds.get(name);
    if (!bound) return { ok: false, error: `Unknown control "${name}".` };
    if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, error: `Control "${name}" needs a number.` };
    if (!(value >= bound.min && value <= bound.max)) {
      return { ok: false, error: `Control "${name}" must be between ${bound.min} and ${bound.max}.` };
    }
    clean[name] = value;
  }
  if (Object.keys(clean).length === 0) return { ok: false, error: 'show_me needs at least one control value.' };
  return { ok: true, set: clean };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shortMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const flat = text.trim().replace(/\s+/g, ' ');
  return (flat === '' ? 'The tool failed.' : flat).slice(0, 200);
}
