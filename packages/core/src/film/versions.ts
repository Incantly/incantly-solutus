import { estimateBeatSeconds, sanitizeWordStarts, splitWords, FILM_BEAT_HOLD_SECONDS, FILM_BEAT_MAX_SECONDS, FILM_BEAT_MIN_SECONDS, type CompiledBeat, type CompiledFilm, type FilmSceneSource } from './storyboard';

/**
 * Change-the-film versions: an explicit edit creates version N+1 as a patch —
 * the changed beats and their audio — linked to its parent. Older versions
 * stay playable; the base film never changes.
 *
 * A patch changes narration (a beat's say, and its short line) and carries
 * the changed beats' audio. The scenes' motion is untouched, so a patched
 * film probes like its parent: the player runs the validator, the probe and
 * the film checks over the result before it plays, exactly as for version 1.
 * Behavioral edits (sets, cameras, marks) ride the figure change path, not
 * patches; a patch carrying them is rejected, not half-applied.
 *
 * BOUNDARY (this slice vs the next): this module defines the patch format and
 * implements sanitize + apply + play-the-result. Persistent version STORAGE
 * (keeping every version across sessions), the PROMOTION action (an insert
 * becoming part of the film as a new version) and the version PICKER UI all
 * land in the next slice. The format already carries everything they need:
 * the parent link orders versions, changed beats render a version's diff, and
 * the audio rides with the patch so a stored version plays without
 * re-narration. Nothing here writes storage or draws a picker.
 */

/** One changed beat: its new narration. */
export interface FilmPatchBeat {
  readonly beat: string;
  readonly scene: string;
  readonly say: string;
  readonly short?: string;
}

/**
 * A changed beat's audio: its length, its word starts in seconds, and the
 * mono 16-bit PCM as base64, so a stored version plays without re-narration.
 * Estimated audio carries timings but no bytes: the beat plays silent until
 * it is narrated.
 */
export interface FilmPatchAudio {
  readonly beat: string;
  readonly seconds: number;
  readonly words?: readonly number[];
  readonly audioBase64?: string;
  readonly sampleRate?: number;
}

/** An explicit edit as version N+1: the changed beats, their audio, and the link to N. */
export interface FilmVersionPatch {
  readonly film: string;
  /** The parent version this patch applies to. */
  readonly parent: number;
  /** The version it creates: always parent + 1. */
  readonly version: number;
  /** The learner's edit request in their words, excerpted for the version's history. */
  readonly reason: string;
  readonly beats: readonly FilmPatchBeat[];
  readonly audio: readonly FilmPatchAudio[];
}

/** Bounds on everything a patch may carry. */
export const FILM_PATCH_LIMITS = {
  /** Most beats one patch may change. */
  beats: 8,
  /** Longest one changed line. */
  sayChars: 2000,
  /** Longest a short line. */
  shortChars: 120,
  /** Longest the edit request quoted in the patch. */
  reasonChars: 500,
  /** Longest one audio payload: base64 of about two minutes of stub PCM. */
  audioChars: 2_000_000,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const cleanText = (text: string): string => text.trim().replace(/\s+/g, ' ');

/**
 * A patch as generated, reduced to what may touch a film: the parent link,
 * changed beats that say something new, and audio shaped like narration.
 * Unknown beat fields are rejected: patches change narration, never behavior.
 */
export function sanitizeFilmPatch(input: unknown): { readonly ok: true; readonly patch: FilmVersionPatch } | { readonly ok: false; readonly problems: readonly string[] } {
  if (!isRecord(input)) return { ok: false, problems: ['The patch must be a JSON object'] };
  const problems: string[] = [];
  const film = typeof input.film === 'string' ? input.film.trim().slice(0, 80) : '';
  if (film === '') problems.push('film must name the film this patch changes');
  const parent = input.parent;
  const version = input.version;
  if (typeof parent !== 'number' || !Number.isInteger(parent) || parent < 1) problems.push('parent must be the parent version, a positive integer');
  if (typeof version !== 'number' || !Number.isInteger(version) || version !== (typeof parent === 'number' ? parent + 1 : -1)) {
    problems.push('version must be exactly one above the parent');
  }
  const reason = typeof input.reason === 'string' ? cleanText(input.reason).slice(0, FILM_PATCH_LIMITS.reasonChars) : '';
  if (reason === '') problems.push('reason must quote the edit request');
  const rawBeats = input.beats;
  if (!Array.isArray(rawBeats) || rawBeats.length === 0 || rawBeats.length > FILM_PATCH_LIMITS.beats) {
    problems.push(`beats must change 1 to ${FILM_PATCH_LIMITS.beats} beats`);
  }
  const beats: FilmPatchBeat[] = [];
  const seen = new Set<string>();
  if (Array.isArray(rawBeats)) {
    rawBeats.forEach((line, i) => {
      if (!isRecord(line) || typeof line.beat !== 'string' || line.beat.trim() === '' || typeof line.scene !== 'string' || line.scene.trim() === '') {
        problems.push(`Beat ${i + 1} must name its beat and scene`);
        return;
      }
      if (typeof line.say !== 'string' || cleanText(line.say) === '' || cleanText(line.say).length > FILM_PATCH_LIMITS.sayChars) {
        problems.push(`Beat ${i + 1} needs new narration of 1 to ${FILM_PATCH_LIMITS.sayChars} characters`);
        return;
      }
      if (line.short !== undefined && (typeof line.short !== 'string' || cleanText(line.short).length > FILM_PATCH_LIMITS.shortChars)) {
        problems.push(`Beat ${i + 1} short runs past ${FILM_PATCH_LIMITS.shortChars} characters`);
        return;
      }
      for (const field of Object.keys(line)) {
        if (field !== 'beat' && field !== 'scene' && field !== 'say' && field !== 'short') {
          problems.push(`Beat ${i + 1} carries "${field}", which patches never change; narration only`);
          return;
        }
      }
      const key = `${line.scene} ${line.beat}`;
      if (seen.has(key)) {
        problems.push(`Beat "${line.beat}" is changed twice; one change per beat`);
        return;
      }
      seen.add(key);
      beats.push({
        beat: line.beat.trim().slice(0, 80),
        scene: line.scene.trim().slice(0, 80),
        say: cleanText(line.say),
        ...(typeof line.short === 'string' && cleanText(line.short) !== '' ? { short: cleanText(line.short) } : {}),
      });
    });
  }
  const audio: FilmPatchAudio[] = [];
  if (input.audio !== undefined) {
    if (!Array.isArray(input.audio) || input.audio.length > FILM_PATCH_LIMITS.beats) {
      problems.push(`audio must be an array of at most ${FILM_PATCH_LIMITS.beats} beats`);
    } else {
      input.audio.forEach((line, i) => {
        if (!isRecord(line) || typeof line.beat !== 'string' || line.beat.trim() === '' || typeof line.seconds !== 'number' || !Number.isFinite(line.seconds) || line.seconds <= 0 || line.seconds > FILM_BEAT_MAX_SECONDS) {
          problems.push(`Audio ${i + 1} must name its beat with 0 to ${FILM_BEAT_MAX_SECONDS} seconds`);
          return;
        }
        if (line.words !== undefined && (!Array.isArray(line.words) || line.words.some((start) => typeof start !== 'number' || !Number.isFinite(start)))) {
          problems.push(`Audio ${i + 1} word starts must be numbers`);
          return;
        }
        if (line.audioBase64 !== undefined && (typeof line.audioBase64 !== 'string' || line.audioBase64.length > FILM_PATCH_LIMITS.audioChars || !/^[A-Za-z0-9+/=]*$/.test(line.audioBase64))) {
          problems.push(`Audio ${i + 1} must be base64 of at most ${FILM_PATCH_LIMITS.audioChars} characters`);
          return;
        }
        if (line.sampleRate !== undefined && (typeof line.sampleRate !== 'number' || !Number.isInteger(line.sampleRate) || line.sampleRate < 1000 || line.sampleRate > 96000)) {
          problems.push(`Audio ${i + 1} sample rate must be 1000 to 96000 Hz`);
          return;
        }
        audio.push({
          beat: line.beat.trim().slice(0, 80),
          seconds: line.seconds,
          ...(Array.isArray(line.words) ? { words: [...(line.words as number[])] } : {}),
          ...(typeof line.audioBase64 === 'string' ? { audioBase64: line.audioBase64 } : {}),
          ...(typeof line.sampleRate === 'number' ? { sampleRate: line.sampleRate } : {}),
        });
      });
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, patch: { film, parent: parent as number, version: version as number, reason, beats, audio } };
}

/**
 * Applies a patch to its parent film: the changed beats take the patch's
 * narration and audio, everything else is untouched, the timeline is re-laid
 * and the version moves to N+1. Fails cleanly — the parent is never half
 * changed — when the parent link, a beat, or the audio does not fit.
 *
 * The caller re-runs the validator, the probe and the film checks over the
 * result before it plays; the tests prove a patched fixture film passes all
 * three.
 */
export function applyFilmPatch(
  film: CompiledFilm,
  patch: FilmVersionPatch,
  sources: readonly FilmSceneSource[],
): { readonly ok: true; readonly film: CompiledFilm } | { readonly ok: false; readonly problems: readonly string[] } {
  if (patch.film !== film.id) return { ok: false, problems: [`The patch changes "${patch.film}", not "${film.id}"`] };
  if (patch.parent !== film.version) return { ok: false, problems: [`The patch applies to version ${patch.parent}, but this film is version ${film.version}`] };
  if (patch.version !== film.version + 1) return { ok: false, problems: ['The patch must create exactly the next version'] };
  const problems: string[] = [];
  const changed = new Map(patch.beats.map((beat) => [`${beat.scene} ${beat.beat}`, beat]));
  const sounded = new Map(patch.audio.map((line) => [line.beat, line]));
  for (const beat of patch.beats) {
    const found = film.beats.find((candidate) => candidate.id === beat.beat && candidate.sceneId === beat.scene);
    if (!found) problems.push(`Beat "${beat.beat}" is not a beat of scene "${beat.scene}"`);
    const audio = sounded.get(beat.beat);
    if (audio?.words !== undefined) {
      const words = splitWords(beat.say);
      if (sanitizeWordStarts(audio.words, words.length, audio.seconds) === undefined) {
        problems.push(`Beat "${beat.beat}" audio does not time its ${words.length} words`);
      }
    }
  }
  for (const line of patch.audio) {
    if (!changed.has(`${film.beats.find((candidate) => candidate.id === line.beat)?.sceneId ?? ''} ${line.beat}`) && !film.beats.some((candidate) => candidate.id === line.beat)) {
      problems.push(`Audio for "${line.beat}" names no beat of this film`);
    }
  }
  if (problems.length > 0) return { ok: false, problems };

  // The source map is rebuilt from the scenes' scripts, as at compile time, so
  // questions on the new version quote the right lines.
  const scripts = new Map(sources.map((source) => [source.id, source.js]));
  let clock = 0;
  const beats: CompiledBeat[] = film.beats.map((beat) => {
    const change = changed.get(`${beat.sceneId} ${beat.id}`);
    if (!change) {
      const next = { ...beat, start: clock };
      clock += beat.seconds;
      return next;
    }
    const words = splitWords(change.say);
    const audio = sounded.get(beat.id);
    const seconds = audio ? Math.min(FILM_BEAT_MAX_SECONDS, Math.max(FILM_BEAT_MIN_SECONDS, audio.seconds + FILM_BEAT_HOLD_SECONDS)) : estimateBeatSeconds(change.say);
    const starts = audio?.words !== undefined ? sanitizeWordStarts(audio.words, words.length, audio.seconds) : undefined;
    const step = { ...beat.step, say: change.say, ...(change.short !== undefined ? { short: change.short } : {}) };
    const next: CompiledBeat = {
      ...beat,
      step: Object.freeze(step),
      start: clock,
      seconds,
      words,
      timed: audio !== undefined ? true : false,
      ...(starts ? { audioStarts: starts } : {}),
    };
    clock += seconds;
    return next;
  });
  const scenes = film.scenes.map((scene) => {
    const sceneBeats = beats.filter((beat) => beat.sceneId === scene.id);
    return { ...scene, start: sceneBeats[0]?.start ?? 0, beats: sceneBeats, seconds: sceneBeats.reduce((total, beat) => total + beat.seconds, 0) };
  });
  const sourceMap: Record<string, { beat: string; scene: string; lines: readonly number[]; parts: readonly string[] }> = {};
  for (const beat of beats) {
    const js = scripts.get(beat.sceneId);
    if (js === undefined) {
      const entry = film.sourceMap[beat.id];
      sourceMap[beat.id] = entry ? { beat: entry.beat, scene: entry.scene, lines: [...entry.lines], parts: [...entry.parts] } : { beat: beat.id, scene: beat.sceneId, lines: [], parts: [] };
      continue;
    }
    const step = beat.step;
    const parts = [step.focus, step.cam?.to, ...(step.show ?? []), ...(step.hide ?? []), ...(step.mark ?? []).map((mark) => mark.part)].filter(
      (name): name is string => typeof name === 'string' && name !== '',
    );
    const values = Object.keys(step.set ?? {});
    const names = [...new Set([...parts, ...values])];
    const lines = js.split('\n');
    const hits: number[] = [];
    lines.forEach((text, index) => {
      if (hits.length >= 12) return;
      if (names.some((name) => text.includes(`'${name}'`) || text.includes(`"${name}"`) || new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text))) hits.push(index + 1);
    });
    sourceMap[beat.id] = { beat: beat.id, scene: beat.sceneId, lines: hits, parts: [...new Set(parts)] };
  }
  return {
    ok: true,
    film: { ...film, version: patch.version, scenes, beats, seconds: clock, sourceMap },
  };
}

/** The beats a patch changes, for the version's history line the picker will show. */
export function patchSummary(patch: FilmVersionPatch): string {
  return `v${patch.version} (${patch.beats.map((beat) => beat.beat).join(', ')})`;
}
