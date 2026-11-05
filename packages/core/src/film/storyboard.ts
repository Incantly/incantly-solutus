import type { Beat, BeatMark, SceneCut } from '../api/types';

/**
 * The film compiler: checked storyboard data in, a timed film out. It owns
 * the timeline, the source map (beat to scene lines and parts) and the
 * anchors (by beat id, never seconds), so the player and the question ladder
 * never derive them themselves.
 *
 * Beat length is estimated from words until narration audio arrives (FV-9):
 * words at 2.5 words per second plus a hold. attachAudio replaces an estimate
 * with a real length and re-times what follows.
 */

/** Words per second a beat's estimate assumes until its audio arrives (bench). */
export const FILM_WORDS_PER_SECOND = 2.5;

/** Seconds a beat holds after its words, estimated or spoken. */
export const FILM_BEAT_HOLD_SECONDS = 0.5;

/** Shortest a beat may be, estimated or spoken. */
export const FILM_BEAT_MIN_SECONDS = 2;

/** Longest a beat may be: past this, seek and check tick loops would hang on one beat. */
export const FILM_BEAT_MAX_SECONDS = 120;

/** Most scenes a storyboard may hold; more is rejected, not compiled. */
export const FILM_MAX_SCENES = 32;

/** Most diagnostics compileFilm keeps; further ones are dropped, errors included in the count. */
export const FILM_MAX_DIAGNOSTICS = 200;

/** Fastest narration the film checks accept, in words per second. */
export const FILM_READING_WPS_LIMIT = 3.5;

/** Scene cuts the compiler accepts. */
const CUTS: readonly SceneCut[] = ['cut', 'fade', 'wipe', 'push'];

/** A beat as the storyboard names it. Execution fields must match the scene's step. */
export interface StoryboardBeat {
  readonly id: string;
  readonly say: string;
  readonly short?: string;
  readonly focus?: string;
  readonly set?: Readonly<Record<string, number>>;
  readonly ease?: number;
  readonly cam?: Beat['cam'];
  readonly show?: readonly string[];
  readonly hide?: readonly string[];
  readonly mark?: readonly BeatMark[];
  readonly title?: Beat['title'];
  readonly sfx?: string;
  readonly explore?: Beat['explore'];
  readonly predict?: Beat['predict'];
}

export interface StoryboardScene {
  readonly id: string;
  readonly idea?: string;
  readonly kit?: string;
  readonly beats: readonly StoryboardBeat[];
  /** How the scene ends; default 'cut'. */
  readonly cut?: SceneCut;
}

export interface StoryboardSpec {
  readonly film: { readonly id?: string; readonly title: string; readonly version?: number; readonly lengthTarget?: number };
  readonly scenes: readonly StoryboardScene[];
}

/** One compiled beat: its storyboard id, its scene step, and its film timing. */
export interface CompiledBeat {
  readonly id: string;
  readonly sceneId: string;
  /** Index within its scene, matching the scene's step. */
  readonly index: number;
  /** The scene's step, frozen: what the runtime executes. */
  readonly step: Beat;
  /** Seconds from the film's start. */
  readonly start: number;
  /** Beat length in seconds: estimated until audio arrives. */
  readonly seconds: number;
  readonly words: readonly string[];
  /** True once attachAudio replaced the estimate. */
  readonly timed: boolean;
  /** Word starts in beat seconds from the narration audio, when its timings validated; captions tick from these. */
  readonly audioStarts?: readonly number[];
}

export interface CompiledScene {
  readonly id: string;
  readonly title: string;
  readonly cut: SceneCut;
  readonly start: number;
  readonly seconds: number;
  readonly beats: readonly CompiledBeat[];
}

export interface CompiledFilm {
  readonly id: string;
  readonly title: string;
  readonly version: number;
  readonly scenes: readonly CompiledScene[];
  readonly beats: readonly CompiledBeat[];
  readonly seconds: number;
  /** Beat id to scene lines and parts, for questions and repair. */
  readonly sourceMap: Readonly<Record<string, SourceMapEntry>>;
}

/** Where a beat comes from in its scene: its own lines and the parts it touches. */
export interface SourceMapEntry {
  readonly beat: string;
  readonly scene: string;
  /** 1-based line numbers in the scene's own script. */
  readonly lines: readonly number[];
  readonly parts: readonly string[];
}

/**
 * Where a question or insert is pinned: film, version, scene and beat, with an
 * offset into the beat. Anchors use beat ids, never absolute seconds, so
 * changed audio or edited versions do not break them.
 */
export interface FilmAnchor {
  readonly film: string;
  readonly version: number;
  readonly scene: string;
  readonly beat: string;
  readonly offsetMs: number;
}

export interface FilmDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly scene?: string;
  readonly beat?: string;
  readonly message: string;
}

export interface CompiledFilmResult {
  readonly ok: boolean;
  readonly diagnostics: readonly FilmDiagnostic[];
  readonly film: CompiledFilm | null;
}

/** A scene's own script and steps, as read from a mounted runtime. */
export interface FilmSceneSource {
  readonly id: string;
  readonly js: string;
  readonly steps: readonly Beat[];
}

/** Narration audio for one beat: its length and its word starts in seconds. */
export interface BeatAudio {
  readonly seconds: number;
  readonly words?: readonly number[];
}

/**
 * Word starts worth driving captions with: finite, monotonic, inside the
 * audio, one per word. Anything else is dropped and the beat ticks from its
 * estimate, so invalid timings never drive anything.
 */
export function sanitizeWordStarts(words: readonly number[] | undefined, wordCount: number, audioSeconds: number): readonly number[] | undefined {
  if (words === undefined || words.length !== wordCount) return undefined;
  let last = -Infinity;
  for (const start of words) {
    if (!Number.isFinite(start) || start < -1e-6 || start + 1e-9 < last || start - 1e-6 > audioSeconds) return undefined;
    last = Math.max(last, start);
  }
  return [...words];
}

export function countWords(say: string): number {
  return say
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '').length;
}

export function splitWords(say: string): string[] {
  return say
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '');
}

/** A beat's estimated seconds from its words: words at 2.5 per second plus the hold, at least the minimum. */
export function estimateBeatSeconds(say: string): number {
  return Math.max(FILM_BEAT_MIN_SECONDS, countWords(say) / FILM_WORDS_PER_SECOND + FILM_BEAT_HOLD_SECONDS);
}

const normalizeSay = (say: string): string => say.trim().replace(/\s+/g, ' ');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Longest storyboard text quoted in a diagnostic; longer lines are excerpted, never embedded verbatim. */
const SAY_EXCERPT_CHARS = 120;

/** One line of storyboard text — say, an id or a cut — excerpted past the cap so a malicious storyboard cannot flood diagnostics. */
function excerpt(say: string): string {
  const flat = say.trim().replace(/\s+/g, ' ');
  return flat.length > SAY_EXCERPT_CHARS ? `${flat.slice(0, SAY_EXCERPT_CHARS)}…` : flat;
}

/** Longest a drift comparison stringifies before it compares a length-tagged prefix. */
const DRIFT_MAX_TEXT = 4000;

/** Deepest the bounded drift walk descends before it stops. */
const DRIFT_MAX_DEPTH = 8;

/**
 * A drift field's fingerprint for comparison: plain JSON within the cap, a
 * length-tagged prefix past it, and a depth-capped walk when JSON refuses
 * (circular or too deep). Never throws.
 */
function driftFingerprint(value: unknown): string {
  try {
    const text = JSON.stringify(value ?? null) ?? 'null';
    return text.length <= DRIFT_MAX_TEXT ? text : `${text.slice(0, DRIFT_MAX_TEXT)}…(${text.length})`;
  } catch {
    return walkBounded(value ?? null, 0, new Set());
  }
}

function walkBounded(value: unknown, depth: number, seen: Set<object>): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value.length > 128 ? `${value.slice(0, 128)}…(${value.length})` : value);
    case 'number':
    case 'boolean':
      return JSON.stringify(value) ?? 'null';
    case 'bigint':
      return `${value}n`;
    case 'undefined':
    case 'function':
    case 'symbol':
      return 'null';
    case 'object': {
      if (seen.has(value)) return '[circular]';
      if (depth >= DRIFT_MAX_DEPTH) return '…';
      seen.add(value);
      try {
        if (Array.isArray(value)) return `[${value.map((item) => walkBounded(item, depth + 1, seen)).join(',')}]`;
        return `{${Object.entries(value as Record<string, unknown>)
          .map(([key, item]) => `${JSON.stringify(key)}:${walkBounded(item, depth + 1, seen)}`)
          .join(',')}}`;
      } finally {
        seen.delete(value);
      }
    }
    default:
      return 'null';
  }
}

/**
 * Compiles a storyboard against its scenes' scripts and steps. Counts, ids
 * and say text must agree; the scene's step is what the runtime executes, so
 * it carries the beat's execution fields.
 */
export function compileFilm(spec: unknown, sources: readonly FilmSceneSource[]): CompiledFilmResult {
  const diagnostics: FilmDiagnostic[] = [];
  const push = (diagnostic: FilmDiagnostic): void => {
    if (diagnostics.length < FILM_MAX_DIAGNOSTICS) diagnostics.push(diagnostic);
  };
  const error = (message: string, scene?: string, beat?: string) => push({ severity: 'error', ...(scene ? { scene } : {}), ...(beat ? { beat } : {}), message });
  const warn = (message: string, scene?: string, beat?: string) => push({ severity: 'warning', ...(scene ? { scene } : {}), ...(beat ? { beat } : {}), message });

  if (!isRecord(spec) || !isRecord(spec.film) || typeof spec.film.title !== 'string' || spec.film.title.trim() === '') {
    return { ok: false, diagnostics: [{ severity: 'error', message: 'The storyboard needs a film with a title' }], film: null };
  }
  if (!Array.isArray(spec.scenes) || spec.scenes.length === 0) {
    return { ok: false, diagnostics: [{ severity: 'error', message: 'The storyboard needs at least one scene' }], film: null };
  }
  if (spec.scenes.length > FILM_MAX_SCENES) {
    return { ok: false, diagnostics: [{ severity: 'error', message: `The storyboard has ${spec.scenes.length} scenes; at most ${FILM_MAX_SCENES}` }], film: null };
  }
  const filmId = typeof spec.film.id === 'string' && spec.film.id.trim() !== '' ? spec.film.id : 'film';
  const version = typeof spec.film.version === 'number' && Number.isInteger(spec.film.version) && spec.film.version > 0 ? spec.film.version : 1;
  const byId = new Map(sources.map((source) => [source.id, source]));
  const seenBeats = new Set<string>();

  interface BuiltScene {
    readonly scene: StoryboardScene;
    readonly source: FilmSceneSource;
    readonly beats: CompiledBeat[];
  }
  const built: BuiltScene[] = [];
  let start = 0;
  spec.scenes.forEach((rawScene, sceneIndex) => {
    if (!isRecord(rawScene) || typeof rawScene.id !== 'string' || rawScene.id.trim() === '') {
      error(`Scene ${sceneIndex + 1} needs an id`);
      return;
    }
    const scene = rawScene as unknown as StoryboardScene;
    const source = byId.get(scene.id);
    if (!source) {
      error(`Scene "${excerpt(scene.id)}" has no source`, scene.id);
      return;
    }
    const cut = scene.cut ?? 'cut';
    if (!CUTS.includes(cut)) error(`Scene "${excerpt(scene.id)}" cuts with "${excerpt(String(scene.cut))}", which is not cut, fade, wipe or push`, scene.id);
    if (!Array.isArray(scene.beats) || scene.beats.length === 0) {
      error(`Scene "${excerpt(scene.id)}" needs at least one beat`, scene.id);
      return;
    }
    if (scene.beats.length !== source.steps.length) {
      error(`Scene "${excerpt(scene.id)}" has ${scene.beats.length} storyboard beats but ${source.steps.length} scene steps`, scene.id);
      return;
    }
    const beats: CompiledBeat[] = [];
    let beatStart = start;
    scene.beats.forEach((rawBeat, index) => {
      const step = source.steps[index]!;
      if (!isRecord(rawBeat) || typeof rawBeat.id !== 'string' || rawBeat.id.trim() === '') {
        error(`Scene "${excerpt(scene.id)}" beat ${index + 1} needs an id`, scene.id);
        return;
      }
      const beat = rawBeat as unknown as StoryboardBeat;
      if (seenBeats.has(beat.id)) error(`Beat "${excerpt(beat.id)}" is used twice`, scene.id, beat.id);
      seenBeats.add(beat.id);
      if (typeof beat.say !== 'string' || beat.say.trim() === '') {
        error(`Beat "${excerpt(beat.id)}" needs something to say`, scene.id, beat.id);
        return;
      }
      if (normalizeSay(beat.say) !== normalizeSay(step.say)) {
        error(`Beat "${excerpt(beat.id)}" says "${excerpt(beat.say)}" in the storyboard but "${excerpt(step.say)}" in the scene`, scene.id, beat.id);
      }
      if (step.id !== undefined && step.id !== beat.id) {
        error(`Beat "${excerpt(beat.id)}" is step ${index + 1} but the scene calls it "${excerpt(step.id)}"`, scene.id, beat.id);
      }
      // The scene's step is what runs; where the storyboard drifted from it, the storyboard is stale.
      for (const field of ['focus', 'set', 'ease', 'cam', 'show', 'hide', 'mark', 'title', 'short', 'sfx', 'explore', 'predict'] as const) {
        if (driftFingerprint(beat[field]) !== driftFingerprint(step[field])) {
          warn(`Beat "${excerpt(beat.id)}" ${field} drifted from the storyboard; the scene wins`, scene.id, beat.id);
        }
      }
      const seconds = estimateBeatSeconds(step.say);
      beats.push({ id: beat.id, sceneId: scene.id, index, step: Object.freeze({ ...step }), start: beatStart, seconds, words: splitWords(step.say), timed: false });
      beatStart += seconds;
    });
    const seconds = beatStart - start;
    built.push({ scene, source, beats });
    start = beatStart;
    void seconds;
  });

  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return { ok: false, diagnostics, film: null };
  const compiledScenes: CompiledScene[] = built.map(({ scene, beats }) => {
    const sceneStart = beats[0]?.start ?? 0;
    const sceneSeconds = beats.reduce((total, beat) => total + beat.seconds, 0);
    return {
      id: scene.id,
      title: scene.idea ?? scene.id,
      cut: scene.cut ?? 'cut',
      start: sceneStart,
      seconds: sceneSeconds,
      beats,
    };
  });
  const compiledBeats = compiledScenes.flatMap((scene) => scene.beats);
  const film: CompiledFilm = {
    id: filmId,
    title: (spec.film as { title: string }).title,
    version,
    scenes: compiledScenes,
    beats: compiledBeats,
    seconds: compiledBeats.reduce((total, beat) => total + beat.seconds, 0),
    sourceMap: buildSourceMap(built),
  };
  for (const beat of compiledBeats) {
    const entry = film.sourceMap[beat.id]!;
    if (entry.lines.length === 0) warn(`Beat "${excerpt(beat.id)}" names no part or value its scene draws from`, beat.sceneId, beat.id);
  }
  return { ok: diagnostics.every((diagnostic) => diagnostic.severity !== 'error'), diagnostics, film };
}

/**
 * The source map: for each beat, the scene lines that mention what the beat
 * touches (its parts and the values it sets) and those parts. Lines are the
 * scene's own 1-based lines, as the repair path maps them.
 */
function buildSourceMap(built: Array<{ scene: StoryboardScene; source: FilmSceneSource; beats: CompiledBeat[] }>): Readonly<Record<string, SourceMapEntry>> {
  const map: Record<string, SourceMapEntry> = {};
  for (const { source, beats } of built) {
    const lines = source.js.split('\n');
    for (const beat of beats) {
      const step = beat.step;
      const parts = [step.focus, step.cam?.to, ...(step.show ?? []), ...(step.hide ?? []), ...(step.mark ?? []).map((mark) => mark.part)].filter(
        (name): name is string => typeof name === 'string' && name !== '',
      );
      const values = Object.keys(step.set ?? {});
      const names = [...new Set([...parts, ...values])];
      const hits: number[] = [];
      lines.forEach((text, index) => {
        if (hits.length >= 12) return;
        if (names.some((name) => text.includes(`'${name}'`) || text.includes(`"${name}"`) || new RegExp(`\\b${escapeRegExp(name)}\\b`).test(text))) hits.push(index + 1);
      });
      map[beat.id] = { beat: beat.id, scene: source.id, lines: hits, parts: [...new Set(parts)] };
    }
  }
  return map;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The anchor at a beat's start, optionally offset into the beat. */
export function anchorFor(film: CompiledFilm, beatId: string, offsetMs = 0): FilmAnchor | null {
  const beat = film.beats.find((candidate) => candidate.id === beatId);
  if (!beat) return null;
  const offset = Math.min(Math.max(Number.isFinite(offsetMs) ? offsetMs : 0, 0), beat.seconds * 1000);
  return { film: film.id, version: film.version, scene: beat.sceneId, beat: beatId, offsetMs: offset };
}

/**
 * Resolves an anchor to film seconds. Anchors are stored by beat id; only
 * playback resolves them, so re-timed audio never breaks a stored anchor.
 */
export function resolveAnchor(film: CompiledFilm, anchor: FilmAnchor): number | null {
  if (anchor.film !== film.id || anchor.version !== film.version) return null;
  const beat = film.beats.find((candidate) => candidate.id === anchor.beat && candidate.sceneId === anchor.scene);
  if (!beat) return null;
  return beat.start + Math.min(Math.max(anchor.offsetMs, 0), beat.seconds * 1000) / 1000;
}

/**
 * Replaces a beat's estimated length with its narration audio's, and re-times
 * the beats after it. The narration slice calls this as each beat's audio
 * arrives; until then every beat stays estimated.
 */
export function attachAudio(film: CompiledFilm, beatId: string, audio: BeatAudio): CompiledFilm {
  const at = film.beats.findIndex((beat) => beat.id === beatId);
  if (at === -1) return film;
  const audioSeconds = Number.isFinite(audio.seconds) ? audio.seconds : 0;
  const seconds = Math.min(FILM_BEAT_MAX_SECONDS, Math.max(FILM_BEAT_MIN_SECONDS, audioSeconds + FILM_BEAT_HOLD_SECONDS));
  const starts = sanitizeWordStarts(audio.words, film.beats[at]!.words.length, audioSeconds);
  let clock = 0;
  const beats = film.beats.map((beat, index) => {
    const length = index === at ? seconds : beat.seconds;
    const next = { ...beat, start: clock, seconds: length, timed: index === at ? true : beat.timed, ...(index === at ? { audioStarts: starts } : {}) };
    clock += length;
    return next;
  });
  const scenes = film.scenes.map((scene) => {
    const sceneBeats = beats.filter((beat) => beat.sceneId === scene.id);
    return { ...scene, start: sceneBeats[0]?.start ?? 0, beats: sceneBeats, seconds: sceneBeats.reduce((total, beat) => total + beat.seconds, 0) };
  });
  return { ...film, scenes, beats, seconds: clock };
}

/**
 * A beat's word starts in film seconds: its narration audio's when they
 * validated, estimated from 2.5 words per second until audio arrives.
 */
export function wordStarts(beat: CompiledBeat): readonly number[] {
  if (beat.audioStarts && beat.audioStarts.length === beat.words.length) return beat.audioStarts.map((start) => beat.start + start);
  return beat.words.map((_, index) => beat.start + index / FILM_WORDS_PER_SECOND);
}
