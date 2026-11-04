import type { Beat } from '../api/types';
import { FilmController } from '../runtime/film';
import { FILM_STEP_SECONDS, SceneRuntime, type SceneFunction } from '../runtime/runtime';
import type { KitRegistry } from '../runtime/kits';
import type { RuntimeUpdate } from '../protocol/runtime-messages';
import { splitWords, type CompiledBeat, type CompiledFilm } from './storyboard';
import type { FlattenedBeat, FlattenedTimeline } from './library';
import type { MixerClip } from './mixer';
import { muxMp4, type Mp4AudioTrack, type Mp4VideoCodec, type Mp4VideoTrack } from './mp4';

/**
 * Offline film export: a flattened timeline (film, film plus inserts, or one
 * insert) rendered to MP4 on the fixed film clock. The offline renderer steps
 * each scene's frames as lattice steps of 1/60 s — the controller is driven
 * with a constant frame duration and a constant clock, so no wall time reads
 * anywhere on the export path — captures each frame offscreen, encodes one
 * video track, assembles the narration clips into one audio track, and muxes
 * both. Scenes export one at a time and concatenate, so raw-frame memory
 * stays bounded whatever the film's length: one runtime and one frame at a
 * time, plus the encoded output itself.
 *
 * Where WebCodecs is missing, exportTimelineFallback records the same
 * flattened timeline in realtime through MediaRecorder instead. It is
 * labelled fallback everywhere it appears: it plays in realtime, so it takes
 * as long as the film.
 */

/** The default export frame rate; every allowed rate divides the 60 Hz film lattice. */
export const EXPORT_FPS_DEFAULT = 30;

/** The export audio track's sample rate. Narration clips are resampled to it. */
export const EXPORT_SAMPLE_RATE = 44100;

/** Samples per encoded audio frame (one AAC frame). */
export const EXPORT_AUDIO_FRAME_SAMPLES = 1024;

/** A keyframe at least this often, in frames: seeking stays near. */
export const EXPORT_KEYFRAME_EVERY = 60;

/** The seed every export scene mounts with, so exports are deterministic. */
export const EXPORT_SEED = 1;

/** Export heights the player offers; widths follow the stage's aspect, evened for encoders. */
export const EXPORT_HEIGHTS = [480, 720, 1080] as const;

/** Largest export dimension: encoders and the 32-bit muxer stay comfortable. */
export const EXPORT_MAX_DIMENSION = 2048;

/** Longest an export may run, in seconds: the audio track allocates the whole timeline, so the cap bounds it. */
export const EXPORT_MAX_AUDIO_SECONDS = 600;

/** Longest one export download filename segment; storage ids already truncate to this. */
export const EXPORT_FILENAME_SEGMENT_CHARS = 80;

/** Longest a whole export download filename may run: NAME_MAX on common filesystems. Segments sanitize to ASCII, so characters are bytes. */
export const EXPORT_FILENAME_MAX_CHARS = 255;

/** The export audio track's sample-rate bounds, in Hz: the patch gate's range, so duration x rate allocation stays bounded. */
export const EXPORT_MIN_SAMPLE_RATE = 1000;
export const EXPORT_MAX_SAMPLE_RATE = 96000;

/**
 * Film steps per export frame, or null when the rate is off the lattice.
 * Export rates are positive integers dividing 60 (60, 30, 20, 15, ...), so
 * every frame lands on the film clock the live player steps.
 */
export function exportStepsPerFrame(fps: number): number | null {
  if (!Number.isInteger(fps) || fps <= 0 || fps > 60 || 60 % fps !== 0) return null;
  return 60 / fps;
}

/** The A/V sync bound at a frame rate: narration starts within one video frame of its beat's first frame. */
export function exportAvSyncBound(fps: number): number {
  return 1 / fps;
}

/**
 * One download filename segment, safe for the download attribute: letters,
 * digits, dash and underscore only (no slashes, dots or traversal), capped
 * to EXPORT_FILENAME_SEGMENT_CHARS. Falls back to 'film' when nothing safe
 * remains.
 */
export function sanitizeExportFilenameSegment(segment: string): string {
  const clean = segment.trim().replace(/[^A-Za-z0-9_-]/g, '-').slice(0, EXPORT_FILENAME_SEGMENT_CHARS);
  return clean === '' ? 'film' : clean;
}

/**
 * The video download filename: the sanitized film, version, insert and
 * height with a fixed suffix. The extension is fixed by the caller
 * (.mp4/.webm), never interpolated, so storage or DOM input cannot change
 * what the file claims to be. Triple-max hostile segments total past
 * NAME_MAX, so the builder shaves the longest segment until the whole name
 * (basename plus extension) fits EXPORT_FILENAME_MAX_CHARS; names already
 * short stay byte-identical.
 */
export function exportVideoFilename(filmId: string, version: number, insertId: string | null, heightP: string | number, extension: 'mp4' | 'webm', fallback: boolean): string {
  let film = sanitizeExportFilenameSegment(filmId);
  // Integers past 1e21 interpolate in exponential form ('1e+21'), injecting
  // '+' into the name, so only a safe positive integer's plain digits qualify.
  const digits = Number.isSafeInteger(version) && (version as number) > 0 ? String(version as number) : '1';
  const v = /^[0-9]+$/.test(digits) ? digits : '1';
  let insert = insertId === null ? '' : sanitizeExportFilenameSegment(insertId);
  let height = sanitizeExportFilenameSegment(String(heightP));
  const tail = fallback ? '-fallback' : '';
  const ext = extension === 'webm' ? 'webm' : 'mp4';
  const build = (): string => `${film}-v${v}${insertId === null ? '' : `-${insert}`}-${height}p${tail}.${ext}`;
  let name = build();
  while (name.length > EXPORT_FILENAME_MAX_CHARS) {
    const sizes = [film.length, insertId === null ? 0 : insert.length, height.length];
    const longest = sizes.indexOf(Math.max(...sizes));
    if ((sizes[longest] ?? 0) <= 1) {
      // The fixed parts alone overflow (an absurd version): slice the basename to fit.
      return `${film}-v${v}${insertId === null ? '' : `-${insert}`}-${height}p${tail}`.slice(0, EXPORT_FILENAME_MAX_CHARS - ext.length - 1) + `.${ext}`;
    }
    if (longest === 0) film = film.slice(0, -1);
    else if (longest === 1) insert = insert.slice(0, -1);
    else height = height.slice(0, -1);
    name = build();
  }
  return name;
}

export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportError';
  }
}

export class ExportCancelledError extends Error {
  constructor() {
    super('The export was cancelled');
    this.name = 'ExportCancelledError';
  }
}

/** Cooperative cancellation: the export checks it between frames and scenes, and stops all work when set. */
export class ExportCancellation {
  private stopped = false;

  get cancelled(): boolean {
    return this.stopped;
  }

  cancel(): void {
    this.stopped = true;
  }

  throwIfCancelled(): void {
    if (this.stopped) throw new ExportCancelledError();
  }
}

// ---------------------------------------------------------------------------
// The export plan: flattened beats grouped into per-scene chunks
// ---------------------------------------------------------------------------

export interface ExportSceneInput {
  readonly id: string;
  readonly scene: SceneFunction;
  readonly kits?: KitRegistry;
}

/**
 * One scene's export chunk: its flattened beats as a single-scene film, in
 * play order with starts relative to the chunk. Insert lines replay their
 * anchor beat's scene step under new narration, as promoted inserts do.
 */
export interface ExportPlanChunk {
  readonly chunk: number;
  readonly sceneId: string;
  readonly film: CompiledFilm;
  /** Export-timeline seconds where the chunk starts: cumulative frames over fps, never carried floats. */
  readonly start: number;
  /** What the chunk renders: frames over fps. Within half a frame of the timeline's own length. */
  readonly seconds: number;
  readonly frames: number;
  readonly fps: number;
}

export interface ExportPlan {
  readonly timeline: FlattenedTimeline;
  readonly fps: number;
  readonly chunks: readonly ExportPlanChunk[];
  readonly frames: number;
  readonly seconds: number;
}

export interface PlanExportOptions {
  readonly fps?: number;
}

/**
 * Plans an export: resolves every flattened beat to its scene step, groups
 * contiguous same-scene runs into chunks, and counts each chunk's frames.
 * Frames round up, so no beat — and no narration tail — is cut; the padding
 * is at most one frame of the chunk's held end state per scene.
 */
export function planExportFilm(
  film: CompiledFilm,
  timeline: FlattenedTimeline,
  scenes: readonly ExportSceneInput[],
  options: PlanExportOptions = {},
): { readonly ok: true; readonly plan: ExportPlan } | { readonly ok: false; readonly problems: readonly string[] } {
  const fps = options.fps ?? EXPORT_FPS_DEFAULT;
  if (exportStepsPerFrame(fps) === null) {
    return { ok: false, problems: [`The export runs at ${fps} frames per second, but export rates divide 60 (60, 30, 20, 15, …)`] };
  }
  if (timeline.film !== film.id || timeline.version !== film.version) {
    return { ok: false, problems: ['The timeline is for another film or version'] };
  }
  if (timeline.beats.length === 0) return { ok: false, problems: ['The timeline has no beats to export'] };
  const byId = new Map(scenes.map((scene) => [scene.id, scene]));
  const compiled = new Map(film.beats.map((beat) => [beat.id, beat]));
  // The scene steps come from a scratch mount per scene, read once and kept for the plan.
  const stepsByScene = new Map<string, readonly Beat[]>();
  const problems: string[] = [];
  for (const flat of timeline.beats) {
    if (!byId.has(flat.sceneId)) problems.push(`Scene "${flat.sceneId}" has no source to export`);
  }
  if (problems.length > 0) return { ok: false, problems };
  for (const sceneId of new Set(timeline.beats.map((beat) => beat.sceneId))) {
    const input = byId.get(sceneId)!;
    const runtime = new SceneRuntime({ ...(input.kits ? { kits: input.kits } : {}), seed: EXPORT_SEED });
    try {
      runtime.mount(input.scene);
      const steps = runtime.isMounted ? runtime.beats() : null;
      if (!steps) {
        problems.push(`Scene "${sceneId}" has no steps to export`);
        continue;
      }
      stepsByScene.set(sceneId, steps);
    } finally {
      runtime.destroy();
    }
  }
  if (problems.length > 0) return { ok: false, problems };

  interface Resolved {
    readonly flat: FlattenedBeat;
    readonly index: number;
    readonly step: Beat;
  }
  const resolved: Resolved[] = [];
  timeline.beats.forEach((flat) => {
    const steps = stepsByScene.get(flat.sceneId)!;
    if (flat.from === 'film') {
      const beat = compiled.get(flat.id);
      if (!beat || beat.sceneId !== flat.sceneId) {
        problems.push(`Beat "${flat.id}" is not a beat of scene "${flat.sceneId}"`);
        return;
      }
      if (beat.index < 0 || beat.index >= steps.length) {
        problems.push(`Beat "${flat.id}" points past its scene's steps`);
        return;
      }
      resolved.push({ flat, index: beat.index, step: steps[beat.index]! });
      return;
    }
    const anchor = flat.anchorBeat ? compiled.get(flat.anchorBeat) : undefined;
    if (!anchor || anchor.sceneId !== flat.sceneId) {
      problems.push(`Insert line "${flat.id}" is pinned past scene "${flat.sceneId}"`);
      return;
    }
    if (anchor.index < 0 || anchor.index >= steps.length) {
      problems.push(`Insert line "${flat.id}" replays a step its scene does not have`);
      return;
    }
    const replay = steps[anchor.index]!;
    resolved.push({ flat, index: anchor.index, step: Object.freeze({ ...replay, say: flat.say }) });
  });
  if (problems.length > 0) return { ok: false, problems };

  const chunks: ExportPlanChunk[] = [];
  let at = 0;
  let start = 0;
  while (at < resolved.length) {
    const run: Resolved[] = [resolved[at]!];
    while (at + run.length < resolved.length && resolved[at + run.length]!.flat.sceneId === run[0]!.flat.sceneId) run.push(resolved[at + run.length]!);
    const runSeconds = run.reduce((total, beat) => total + beat.flat.seconds, 0);
    const frames = Math.max(1, Math.ceil(runSeconds * fps - 1e-9));
    const seconds = frames / fps;
    const beats: CompiledBeat[] = [];
    let clock = 0;
    for (const beat of run) {
      beats.push({ id: beat.flat.id, sceneId: beat.flat.sceneId, index: beat.index, step: beat.step, start: clock, seconds: beat.flat.seconds, words: splitWords(beat.step.say), timed: false });
      clock += beat.flat.seconds;
    }
    const sceneId = run[0]!.flat.sceneId;
    chunks.push({
      chunk: chunks.length,
      sceneId,
      film: { id: film.id, title: film.title, version: film.version, scenes: [{ id: sceneId, title: sceneId, cut: 'cut', start: 0, seconds: runSeconds, beats }], beats, seconds: runSeconds, sourceMap: {} },
      start,
      seconds,
      frames,
      fps,
    });
    start += seconds;
    at += run.length;
  }
  return { ok: true, plan: { timeline, fps, chunks, frames: chunks.reduce((total, chunk) => total + chunk.frames, 0), seconds: start } };
}

// ---------------------------------------------------------------------------
// The offline renderer: fixed-clock frames, no wall time
// ---------------------------------------------------------------------------

/** One rendered frame: its scene time on the film lattice, its beat, and the update that draws it. */
export interface ExportFrame {
  readonly chunk: number;
  readonly frame: number;
  readonly time: number;
  readonly beatId: string;
  readonly caption: string;
  readonly update: RuntimeUpdate;
}

export interface RenderExportHooks {
  /** Observes each frame's runtime before it is destroyed, for tests. */
  readonly inspect?: (runtime: SceneRuntime, frame: ExportFrame) => void;
}

/** Plays through pause points: holds and questions pause a live film for the learner, but the export plays on. */
function resumeThroughPausePoints(controller: FilmController, film: CompiledFilm): void {
  let guard = film.beats.length + 1;
  while (!controller.isPlaying && controller.time + FILM_STEP_SECONDS / 2 < film.seconds && guard-- > 0) controller.play();
}

/**
 * Renders one chunk's frames on the fixed film clock: the runtime mounts in
 * film mode, the controller plays with a constant frame duration, and each
 * frame is an exact number of 1/60 s lattice steps. The controller's clock
 * reads a constant (it only times its own bookkeeping), so no wall time
 * reaches the export path; the same plan renders the same frames every run.
 *
 * Frame 0 carries the full mount state plus the scene's initial frame
 * (onFrame at t = 0), exactly as seek-by-replay lands it — the established
 * ground truth for what playing there draws. Capture sessions apply it with
 * reset, rebuilding the figure from full state.
 */
export function* renderExportChunk(chunk: ExportPlanChunk, scene: ExportSceneInput, cancel: ExportCancellation, hooks: RenderExportHooks = {}): Generator<ExportFrame, void, void> {
  const stepsPerFrame = exportStepsPerFrame(chunk.fps);
  if (stepsPerFrame === null) throw new ExportError(`The export runs at ${chunk.fps} frames per second, but export rates divide 60`);
  const frameDur = stepsPerFrame * FILM_STEP_SECONDS;
  const runtime = new SceneRuntime({ ...(scene.kits ? { kits: scene.kits } : {}), film: true, seed: EXPORT_SEED });
  try {
    const mounted = runtime.mount(scene.scene);
    if (!runtime.isMounted) throw new ExportError(`Scene "${scene.id}" threw while mounting for export`);
    const controller = new FilmController({ runtime, film: chunk.film, now: () => 0 });
    const frame = (index: number, update: RuntimeUpdate): ExportFrame => {
      const beat = controller.currentBeat;
      const next: ExportFrame = { chunk: chunk.chunk, frame: index, time: runtime.time, beatId: beat?.id ?? '', caption: beat?.step.say ?? '', update };
      hooks.inspect?.(runtime, next);
      return next;
    };
    controller.play();
    resumeThroughPausePoints(controller, chunk.film);
    yield frame(0, mergeExportUpdates(mounted, runtime.redraw()));
    for (let index = 1; index < chunk.frames; index++) {
      cancel.throwIfCancelled();
      const update = controller.tick(frameDur);
      resumeThroughPausePoints(controller, chunk.film);
      yield frame(index, update);
    }
  } finally {
    runtime.destroy();
  }
}

/** Merges two updates in order: every command lands, later UI wins. */
function mergeExportUpdates(first: RuntimeUpdate, second: RuntimeUpdate): RuntimeUpdate {
  return {
    commands: [...first.commands, ...second.commands],
    ui: { ...first.ui, ...second.ui },
    needsFrame: second.needsFrame,
    ...(second.values ?? first.values ? { values: { ...first.values, ...second.values } } : {}),
    ...(second.step !== undefined ? { step: second.step } : first.step !== undefined ? { step: first.step } : {}),
    ...(second.formulas ?? first.formulas ? { formulas: { ...first.formulas, ...second.formulas } } : {}),
  };
}

// ---------------------------------------------------------------------------
// The audio track: narration clips placed at beat offsets
// ---------------------------------------------------------------------------

/** A narration clip decoded to mono samples. */
function decodeMono16(pcm: Uint8Array): Int16Array {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const samples = Math.floor(view.byteLength / 2);
  const out = new Int16Array(samples);
  for (let i = 0; i < samples; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

/** Linear resampling to the export rate; an already-matching clip is copied bit-exact. */
export function resampleMono16(samples: Int16Array, fromRate: number, toRate: number, cancel?: ExportCancellation): Int16Array {
  if (!(fromRate > 0) || !(toRate > 0)) throw new ExportError('Resampling needs positive sample rates');
  cancel?.throwIfCancelled();
  if (fromRate === toRate) return samples.slice();
  const length = Math.max(1, Math.round((samples.length * toRate) / fromRate));
  const out = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    if (i % 8192 === 0) cancel?.throwIfCancelled();
    const at = (i * (samples.length - 1)) / Math.max(1, length - 1);
    const lo = Math.floor(at);
    const hi = Math.min(samples.length - 1, lo + 1);
    const mix = at - lo;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(samples[lo]! * (1 - mix) + samples[hi]! * mix)));
  }
  return out;
}

export interface AssembledExportAudio {
  /** The whole track: narration placed at beat offsets, silence elsewhere, padded to the export's length. */
  readonly pcm: Int16Array;
  readonly sampleRate: number;
  readonly clipsPlaced: number;
  readonly seconds: number;
}

/**
 * Assembles the export's audio track: each film beat's mixer clip, resampled
 * to the export rate, placed at the beat's export start and cut at its end
 * (as the live mixer cuts it when the next beat starts). Insert lines carry
 * no audio and stay silent. Clips keyed to the same beat resolve last-wins,
 * as mixer.attach does.
 *
 * Refuses timelines past EXPORT_MAX_AUDIO_SECONDS before allocating, so a
 * hostile timeline cannot allocate hundreds of megabytes, and refuses
 * sample rates outside EXPORT_MIN_SAMPLE_RATE..EXPORT_MAX_SAMPLE_RATE, so
 * duration x rate stays bounded; checks cancellation per beat and per mix
 * chunk, as the video phase checks per frame. The track is local: throwing
 * on cancel discards it.
 */
export function assembleExportAudio(plan: ExportPlan, clips: readonly MixerClip[], sampleRate: number = EXPORT_SAMPLE_RATE, cancel?: ExportCancellation): AssembledExportAudio {
  if (!Number.isInteger(sampleRate) || sampleRate < EXPORT_MIN_SAMPLE_RATE || sampleRate > EXPORT_MAX_SAMPLE_RATE) {
    throw new ExportError(`The export audio runs ${EXPORT_MIN_SAMPLE_RATE} to ${EXPORT_MAX_SAMPLE_RATE} Hz, not ${sampleRate}`);
  }
  if (plan.seconds > EXPORT_MAX_AUDIO_SECONDS) {
    throw new ExportError(`The export runs ${Math.ceil(plan.seconds)} seconds of audio; at most ${EXPORT_MAX_AUDIO_SECONDS}`);
  }
  cancel?.throwIfCancelled();
  const total = Math.max(1, Math.ceil(plan.seconds * sampleRate - 1e-9));
  const pcm = new Int16Array(total);
  const byBeat = new Map<string, MixerClip>();
  for (const clip of clips) byBeat.set(clip.beatId, clip);
  let placed = 0;
  for (const chunk of plan.chunks) {
    for (const beat of chunk.film.beats) {
      cancel?.throwIfCancelled();
      const clip = byBeat.get(beat.id);
      if (!clip || clip.pcm.length < 2 || !(clip.sampleRate > 0)) continue;
      const resampled = resampleMono16(decodeMono16(clip.pcm), clip.sampleRate, sampleRate, cancel);
      const at = Math.round((chunk.start + beat.start) * sampleRate);
      // The live mixer cuts the line when the next beat starts; the export cuts it at the beat's end.
      const room = Math.min(resampled.length, Math.max(0, Math.round(beat.seconds * sampleRate)), Math.max(0, total - at));
      for (let i = 0; i < room; i++) {
        if (i % 8192 === 0) cancel?.throwIfCancelled();
        const mixed = pcm[at + i]! + resampled[i]!;
        pcm[at + i] = Math.max(-32768, Math.min(32767, mixed));
      }
      placed++;
    }
  }
  cancel?.throwIfCancelled();
  return { pcm, sampleRate, clipsPlaced: placed, seconds: total / sampleRate };
}

export interface ExportSyncLine {
  readonly beat: string;
  /** Where the clip starts, in export seconds. */
  readonly clipStart: number;
  /** Where the beat's first video frame starts, in export seconds. */
  readonly videoStart: number;
  /** How far the clip starts after its first frame: within one frame, by construction. */
  readonly errorSeconds: number;
}

export interface ExportSyncReport {
  /** The bound: one video frame at the export rate. */
  readonly bound: number;
  readonly maxError: number;
  readonly ok: boolean;
  readonly lines: readonly ExportSyncLine[];
}

/**
 * Verifies A/V sync before encoding: every placed clip starts within one
 * video frame of its beat's first frame. The clip lands exactly on the
 * beat's start sample; the beat's first frame is the frame covering that
 * start, so the error is always under a frame. (AAC priming shifts the
 * encoded track by up to 1024 samples past this; the mux test bounds the
 * encoded tracks too.)
 */
export function exportSyncReport(plan: ExportPlan, clips: readonly MixerClip[]): ExportSyncReport {
  const bound = exportAvSyncBound(plan.fps);
  const beats = new Set(clips.map((clip) => clip.beatId));
  const lines: ExportSyncLine[] = [];
  for (const chunk of plan.chunks) {
    for (const beat of chunk.film.beats) {
      if (!beats.has(beat.id)) continue;
      const clipStart = chunk.start + beat.start;
      const videoStart = Math.floor(clipStart * plan.fps + 1e-9) / plan.fps;
      lines.push({ beat: beat.id, clipStart, videoStart, errorSeconds: clipStart - videoStart });
    }
  }
  const maxError = lines.reduce((worst, line) => Math.max(worst, line.errorSeconds), 0);
  return { bound, maxError, ok: maxError <= bound + 1e-9, lines };
}

// ---------------------------------------------------------------------------
// Frame size: the drawing at the export height, plus a caption band
// ---------------------------------------------------------------------------

export interface ExportFrameSize {
  /** The drawing, at the stage's aspect, evened for encoders. */
  readonly width: number;
  readonly height: number;
  /** The caption band under the drawing, evened. */
  readonly band: number;
  /** The encoded frame: width by height plus band. */
  readonly frameWidth: number;
  readonly frameHeight: number;
}

/**
 * Sizes an export frame: the drawing scaled to the target height at the
 * stage's aspect, with a caption band underneath carrying the beat's line.
 * All even, all within the dimension cap.
 */
export function exportFrameSize(stageWidth: number, stageHeight: number, targetHeight: number): ExportFrameSize {
  if (!Number.isFinite(stageWidth) || stageWidth <= 0 || !Number.isFinite(stageHeight) || stageHeight <= 0) {
    throw new ExportError('The export needs the stage size to frame its drawing');
  }
  if (!Number.isFinite(targetHeight) || targetHeight < 120 || targetHeight > EXPORT_MAX_DIMENSION) {
    throw new ExportError(`The export height runs 120 to ${EXPORT_MAX_DIMENSION}, not ${targetHeight}`);
  }
  const even = (value: number): number => Math.max(2, 2 * Math.round(value / 2));
  const height = even(targetHeight);
  const width = even((stageWidth * height) / stageHeight);
  const band = even(height * 0.18);
  if (width > EXPORT_MAX_DIMENSION || height + band > EXPORT_MAX_DIMENSION) throw new ExportError(`The export frame ${width}x${height + band} runs past ${EXPORT_MAX_DIMENSION}`);
  return { width, height, band, frameWidth: width, frameHeight: height + band };
}

// ---------------------------------------------------------------------------
// The offline export: frames, narration, mux
// ---------------------------------------------------------------------------

export type ExportPhase = 'video' | 'audio' | 'mux';

export interface ExportProgress {
  readonly phase: ExportPhase;
  readonly chunk: number;
  readonly chunks: number;
  readonly frame: number;
  readonly frames: number;
}

export interface ExportVideoSample {
  readonly data: Uint8Array;
  readonly keyframe: boolean;
}

/** A video encoder behind an interface: WebCodecs in the browser, a recorder in tests. */
export interface ExportVideoSink {
  encode(image: unknown, timestampUs: number, keyFrame: boolean): Promise<void>;
  finish(): Promise<{ readonly codec: Mp4VideoCodec; readonly description: Uint8Array; readonly samples: readonly ExportVideoSample[] }>;
  close(): void;
}

/**
 * An audio encoder behind an interface. Null — from openAudio or finish —
 * means audio is unavailable here, and the export ships video-only.
 */
export interface ExportAudioSink {
  encode(track: Int16Array, sampleRate: number, cancel?: ExportCancellation): Promise<void>;
  finish(): Promise<{ readonly description: Uint8Array; readonly samples: readonly Uint8Array[] } | null>;
  close(): void;
}

/** One chunk's offscreen capture: frames in, encoder images out. */
export interface ExportCaptureSession {
  capture(frame: ExportFrame, first: boolean): Promise<unknown>;
  destroy(): void;
}

export interface ExportDrivers {
  openCapture(chunk: ExportPlanChunk): Promise<ExportCaptureSession>;
  openVideo(width: number, height: number, fps: number): Promise<ExportVideoSink>;
  openAudio(): Promise<ExportAudioSink | null>;
}

export interface ExportVideoOptions {
  readonly film: CompiledFilm;
  readonly timeline: FlattenedTimeline;
  readonly scenes: readonly ExportSceneInput[];
  readonly clips?: readonly MixerClip[];
  readonly fps?: number;
  readonly size: ExportFrameSize;
  readonly drivers: ExportDrivers;
  readonly cancel?: ExportCancellation;
  readonly onProgress?: (progress: ExportProgress) => void;
  readonly audioSampleRate?: number;
}

export interface ExportVideoResult {
  readonly bytes: Uint8Array;
  readonly mimeType: 'video/mp4';
  readonly codec: Mp4VideoCodec;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly frames: number;
  readonly seconds: number;
  readonly hasAudio: boolean;
  readonly fallback: false;
}

/**
 * Exports a flattened timeline to MP4: each scene chunk renders its frames on
 * the fixed film clock and encodes them into one video track, the narration
 * clips assemble into one audio track at beat offsets, and the muxer joins
 * both. Progress reports every frame; cancellation stops stepping, closes the
 * encoders and destroys the scene, and rejects with ExportCancelledError.
 * Without narration clips — or without an audio encoder — the file ships
 * video-only, and hasAudio says so.
 */
export async function exportTimelineMp4(options: ExportVideoOptions): Promise<ExportVideoResult> {
  const cancel = options.cancel ?? new ExportCancellation();
  const planned = planExportFilm(options.film, options.timeline, options.scenes, options.fps !== undefined ? { fps: options.fps } : {});
  if (!planned.ok) throw new ExportError(planned.problems.join('; '));
  const plan = planned.plan;
  if (plan.seconds > EXPORT_MAX_AUDIO_SECONDS) {
    throw new ExportError(`The export runs ${Math.ceil(plan.seconds)} seconds of audio; at most ${EXPORT_MAX_AUDIO_SECONDS}`);
  }
  const byScene = new Map(options.scenes.map((scene) => [scene.id, scene]));
  const progress = (phase: ExportPhase, chunk: number, frame: number): void => {
    options.onProgress?.({ phase, chunk, chunks: plan.chunks.length, frame, frames: plan.frames });
  };
  const video = await options.drivers.openVideo(options.size.frameWidth, options.size.frameHeight, plan.fps);
  try {
    let global = 0;
    for (const chunk of plan.chunks) {
      cancel.throwIfCancelled();
      const scene = byScene.get(chunk.sceneId);
      if (!scene) throw new ExportError(`Scene "${chunk.sceneId}" has no source to export`);
      const session = await options.drivers.openCapture(chunk);
      try {
        let first = true;
        for (const frame of renderExportChunk(chunk, scene, cancel)) {
          const image = await session.capture(frame, first);
          first = false;
          await video.encode(image, Math.round((global * 1_000_000) / plan.fps), global % EXPORT_KEYFRAME_EVERY === 0);
          global++;
          progress('video', chunk.chunk, global);
        }
      } finally {
        session.destroy();
      }
    }
    const encoded = await video.finish();
    const videoTrack: Mp4VideoTrack = { codec: encoded.codec, width: options.size.frameWidth, height: options.size.frameHeight, fps: plan.fps, description: encoded.description, samples: encoded.samples };
    let audioTrack: Mp4AudioTrack | undefined;
    const clips = options.clips ?? [];
    cancel.throwIfCancelled();
    const assembled = assembleExportAudio(plan, clips, options.audioSampleRate ?? EXPORT_SAMPLE_RATE, cancel);
    if (assembled.clipsPlaced > 0) {
      progress('audio', plan.chunks.length, plan.frames);
      cancel.throwIfCancelled();
      const audio = await options.drivers.openAudio();
      if (audio) {
        try {
          await audio.encode(assembled.pcm, assembled.sampleRate, cancel);
          cancel.throwIfCancelled();
          const out = await audio.finish();
          if (out && out.samples.length > 0) audioTrack = { sampleRate: assembled.sampleRate, channels: 1, description: out.description, samples: out.samples };
        } finally {
          audio.close();
        }
      }
    }
    cancel.throwIfCancelled();
    progress('mux', plan.chunks.length, plan.frames);
    return {
      bytes: muxMp4(videoTrack, audioTrack),
      mimeType: 'video/mp4',
      codec: encoded.codec,
      width: options.size.frameWidth,
      height: options.size.frameHeight,
      fps: plan.fps,
      frames: plan.frames,
      seconds: plan.seconds,
      hasAudio: audioTrack !== undefined,
      fallback: false,
    };
  } finally {
    video.close();
  }
}

// ---------------------------------------------------------------------------
// The realtime fallback: the same timeline through MediaRecorder
// ---------------------------------------------------------------------------

/** One chunk's live playback: wall seconds in, beats and frames out. */
export interface FallbackSession {
  applyAhead(seconds: number): void;
  destroy(): void;
}

export interface FallbackRecorder {
  readonly mimeType: string;
  start(): void;
  stop(): Promise<Uint8Array>;
}

export interface FallbackClock {
  wait(ms: number): Promise<void>;
}

export interface ExportFallbackOptions {
  readonly film: CompiledFilm;
  readonly timeline: FlattenedTimeline;
  readonly scenes: readonly ExportSceneInput[];
  /** Capture rate; wall-timed, so any whole rate 1 to 60. Default 24. */
  readonly fps?: number;
  readonly openSession: (chunk: ExportPlanChunk) => Promise<FallbackSession>;
  readonly recorder: FallbackRecorder;
  readonly clock: FallbackClock;
  readonly cancel?: ExportCancellation;
  readonly onProgress?: (progress: ExportProgress) => void;
}

export interface ExportFallbackResult {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly fallback: true;
  readonly label: 'fallback · realtime';
  readonly frames: number;
  readonly seconds: number;
  readonly fps: number;
}

/**
 * Records a flattened timeline in realtime where WebCodecs is missing: the
 * chunks play back to back through a live figure while MediaRecorder captures
 * it. The input is the same flattened timeline the offline path consumes;
 * the output is labelled fallback everywhere, and takes as long as the film.
 * Pause points play through, as offline; cancellation stops the recorder and
 * the playback, and rejects with ExportCancelledError.
 */
export async function exportTimelineFallback(options: ExportFallbackOptions): Promise<ExportFallbackResult> {
  const fps = options.fps ?? 24;
  if (!Number.isInteger(fps) || fps < 1 || fps > 60) throw new ExportError(`The fallback records 1 to 60 frames per second, not ${fps}`);
  const cancel = options.cancel ?? new ExportCancellation();
  const planned = planExportFilm(options.film, options.timeline, options.scenes, {});
  if (!planned.ok) throw new ExportError(planned.problems.join('; '));
  const plan = planned.plan;
  if (plan.seconds > EXPORT_MAX_AUDIO_SECONDS) {
    throw new ExportError(`The export runs ${Math.ceil(plan.seconds)} seconds; at most ${EXPORT_MAX_AUDIO_SECONDS}`);
  }
  const slots = plan.chunks.map((chunk) => Math.max(1, Math.round(chunk.seconds * fps)));
  const total = slots.reduce((sum, count) => sum + count, 0);
  const progress = (chunk: number, frame: number): void => {
    options.onProgress?.({ phase: 'video', chunk, chunks: plan.chunks.length, frame, frames: total });
  };
  options.recorder.start();
  try {
    let global = 0;
    for (const chunk of plan.chunks) {
      cancel.throwIfCancelled();
      const session = await options.openSession(chunk);
      try {
        const slot = chunk.seconds / slots[chunk.chunk]!;
        for (let i = 0; i < slots[chunk.chunk]!; i++) {
          cancel.throwIfCancelled();
          session.applyAhead(slot);
          global++;
          progress(chunk.chunk, global);
          await options.clock.wait(slot * 1000);
        }
      } finally {
        session.destroy();
      }
    }
    cancel.throwIfCancelled();
    return { bytes: await options.recorder.stop(), mimeType: options.recorder.mimeType, fallback: true, label: 'fallback · realtime', frames: total, seconds: plan.seconds, fps };
  } catch (error) {
    try {
      await options.recorder.stop();
    } catch {
      // The recorder releases its capture even when the export failed or cancelled.
    }
    throw error;
  }
}
