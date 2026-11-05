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
 * BOUNDARY (format vs storage): this module defines the patch format and
 * implements sanitize + apply + play-the-result, including promoted inserts
 * spliced after their anchors. Persistent version STORAGE (the immutable base
 * plus the patch chain) and private inserts live in library.ts client-side
 * and in the generation service's film library; the PICKER UI is the
 * playground's. The format already carries everything they need: the parent
 * link orders versions, changed beats render a version's diff, and the audio
 * rides with the patch so a stored version plays without re-narration.
 * Nothing here writes storage or draws a picker.
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

/** One promoted insert line: new narration for a beat spliced after an anchor. */
export interface FilmPatchInsertLine {
  readonly say: string;
  readonly short?: string;
}

/** Beats spliced after one anchor beat, in order, when an insert is promoted. */
export interface FilmPatchInsert {
  readonly after: { readonly scene: string; readonly beat: string };
  readonly lines: readonly FilmPatchInsertLine[];
}

/** An explicit edit as version N+1: the changed beats, any promoted inserts, their audio, and the link to N. */
export interface FilmVersionPatch {
  readonly film: string;
  /** The parent version this patch applies to. */
  readonly parent: number;
  /** The version it creates: always parent + 1. */
  readonly version: number;
  /** The learner's edit request in their words, excerpted for the version's history. */
  readonly reason: string;
  readonly beats: readonly FilmPatchBeat[];
  /** Promoted inserts, spliced after their anchors; absent when the patch only renarrates. */
  readonly inserts?: readonly FilmPatchInsert[];
  readonly audio: readonly FilmPatchAudio[];
}

/** Bounds on everything a patch may carry. */
export const FILM_PATCH_LIMITS = {
  /** Most beats one patch may change. */
  beats: 8,
  /** Most insert groups one patch may splice. */
  inserts: 4,
  /** Most lines one insert group may carry: the insert's own cap. */
  insertLines: 4,
  /** Longest one changed line. */
  sayChars: 2000,
  /** Longest a short line. */
  shortChars: 120,
  /** Longest the edit request quoted in the patch. */
  reasonChars: 500,
  /** Longest one audio payload: base64 of about two minutes of stub PCM. */
  audioChars: 2_000_000,
} as const;

/**
 * A promoted insert beat's id: its anchor, the version that spliced it, and
 * its ordinal across the patch's insert lines, in order. Deterministic, so
 * the promotion builder and the applier name the same beats, and unique
 * across versions, since each version splices under its own number.
 */
export function insertBeatId(afterBeat: string, version: number, ordinal: number): string {
  return `${afterBeat}-v${version}-${ordinal}`;
}

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
  // Promoted inserts are parsed before the beats check: a promotion-only
  // patch changes no beats, and beats may be empty only then.
  const inserts: FilmPatchInsert[] = [];
  if (input.inserts !== undefined) {
    if (!Array.isArray(input.inserts) || input.inserts.length === 0 || input.inserts.length > FILM_PATCH_LIMITS.inserts) {
      problems.push(`inserts must splice 1 to ${FILM_PATCH_LIMITS.inserts} groups`);
    } else {
      input.inserts.forEach((group, i) => {
        if (!isRecord(group) || !isRecord(group.after) || typeof group.after.beat !== 'string' || group.after.beat.trim() === '' || typeof group.after.scene !== 'string' || group.after.scene.trim() === '') {
          problems.push(`Insert ${i + 1} must name the beat it follows`);
          return;
        }
        for (const field of Object.keys(group)) {
          if (field !== 'after' && field !== 'lines') {
            problems.push(`Insert ${i + 1} carries "${field}", which patches never change; narration only`);
            return;
          }
        }
        for (const field of Object.keys(group.after)) {
          if (field !== 'scene' && field !== 'beat') {
            problems.push(`Insert ${i + 1} pins its anchor with "${field}", which anchors never carry`);
            return;
          }
        }
        if (!Array.isArray(group.lines) || group.lines.length === 0 || group.lines.length > FILM_PATCH_LIMITS.insertLines) {
          problems.push(`Insert ${i + 1} must carry 1 to ${FILM_PATCH_LIMITS.insertLines} lines`);
          return;
        }
        const lines: FilmPatchInsertLine[] = [];
        for (let at = 0; at < group.lines.length; at++) {
          const line = group.lines[at];
          if (!isRecord(line) || typeof line.say !== 'string' || cleanText(line.say) === '' || cleanText(line.say).length > FILM_PATCH_LIMITS.sayChars) {
            problems.push(`Insert ${i + 1} line ${at + 1} needs narration of 1 to ${FILM_PATCH_LIMITS.sayChars} characters`);
            return;
          }
          if (line.short !== undefined && (typeof line.short !== 'string' || cleanText(line.short).length > FILM_PATCH_LIMITS.shortChars)) {
            problems.push(`Insert ${i + 1} line ${at + 1} short runs past ${FILM_PATCH_LIMITS.shortChars} characters`);
            return;
          }
          for (const field of Object.keys(line)) {
            if (field !== 'say' && field !== 'short') {
              problems.push(`Insert ${i + 1} line ${at + 1} carries "${field}", which patches never change; narration only`);
              return;
            }
          }
          lines.push({ say: cleanText(line.say), ...(typeof line.short === 'string' && cleanText(line.short) !== '' ? { short: cleanText(line.short) } : {}) });
        }
        inserts.push({ after: { scene: group.after.scene.trim().slice(0, 80), beat: group.after.beat.trim().slice(0, 80) }, lines });
      });
    }
  }
  const rawBeats = input.beats;
  if (!Array.isArray(rawBeats)) {
    if (inserts.length === 0) problems.push(`beats must change 1 to ${FILM_PATCH_LIMITS.beats} beats`);
  } else if (rawBeats.length > FILM_PATCH_LIMITS.beats || (rawBeats.length === 0 && inserts.length === 0)) {
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
  return { ok: true, patch: { film, parent: parent as number, version: version as number, reason, beats, ...(inserts.length > 0 ? { inserts } : {}), audio } };
}

/**
 * A patch's audio against the beats it carries, without the film: every audio
 * entry must name a beat the patch changes or splices, and its word starts
 * must time the carried line — the same checks applyFilmPatch runs where the
 * film is known. The service runs this at store time so a patch that cannot
 * apply is never stored; anything film-shaped (beats the film does not have)
 * still fails at apply time, where the loader skips it.
 */
export function patchAudioProblems(patch: FilmVersionPatch): readonly string[] {
  const problems: string[] = [];
  const says = new Map<string, Array<{ readonly say: string; readonly label: string }>>();
  const carried = (beat: string, say: string, label: string): void => {
    const lines = says.get(beat) ?? [];
    lines.push({ say, label });
    says.set(beat, lines);
  };
  for (const beat of patch.beats) carried(beat.beat, beat.say, `Beat "${beat.beat}"`);
  let ordinal = 0;
  (patch.inserts ?? []).forEach((group, i) => {
    group.lines.forEach((line, at) => {
      ordinal++;
      carried(insertBeatId(group.after.beat, patch.version, ordinal), line.say, `Insert ${i + 1} line ${at + 1}`);
    });
  });
  for (const line of patch.audio) {
    const timed = says.get(line.beat);
    if (!timed) {
      problems.push(`Audio for "${line.beat}" names no beat this patch carries`);
      continue;
    }
    for (const { say, label } of timed) {
      const words = splitWords(say).length;
      if (line.words !== undefined && sanitizeWordStarts(line.words, words, line.seconds) === undefined) {
        problems.push(`${label} audio does not time its ${words} words`);
      }
    }
  }
  return problems;
}

/**
 * Applies a patch to its parent film: the changed beats take the patch's
 * narration and audio, promoted inserts splice new beats after their anchors,
 * everything else is untouched, the timeline is re-laid and the version moves
 * to N+1. Fails cleanly — the parent is never half changed — when the parent
 * link, a beat, an anchor, or the audio does not fit.
 *
 * A spliced beat replays its anchor's scene step (its index, cues and motion)
 * under new narration: the insert's words join the film, the scene is
 * untouched. Later beats keep their indices, so the controller still steps
 * the scene's own beats.
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
  // Promoted inserts name their beats deterministically, so their audio is
  // checked against the line each entry times, exactly like renarration.
  const taken = new Set(film.beats.map((beat) => beat.id));
  const spliced = new Set<string>();
  const placed: Array<{ after: string; id: string; audioId: string; say: string; short?: string }> = [];
  (patch.inserts ?? []).forEach((group, i) => {
    const anchor = film.beats.find((candidate) => candidate.id === group.after.beat && candidate.sceneId === group.after.scene);
    if (!anchor) {
      problems.push(`Insert ${i + 1} follows "${group.after.beat}", which is not a beat of scene "${group.after.scene}"`);
      return;
    }
    group.lines.forEach((line, at) => {
      const ordinal = placed.length + 1;
      const wanted = insertBeatId(group.after.beat, patch.version, ordinal);
      let id = wanted;
      for (let bump = 2; taken.has(id); bump++) id = `${wanted}-${bump}`;
      taken.add(id);
      spliced.add(wanted);
      spliced.add(id);
      placed.push({ after: `${group.after.scene} ${group.after.beat}`, id, audioId: wanted, say: line.say, ...(line.short !== undefined ? { short: line.short } : {}) });
      const audio = sounded.get(wanted);
      if (audio?.words !== undefined) {
        const words = splitWords(line.say);
        if (sanitizeWordStarts(audio.words, words.length, audio.seconds) === undefined) {
          problems.push(`Insert ${i + 1} line ${at + 1} audio does not time its ${words.length} words`);
        }
      }
    });
  });
  for (const line of patch.audio) {
    if (!changed.has(`${film.beats.find((candidate) => candidate.id === line.beat)?.sceneId ?? ''} ${line.beat}`) && !film.beats.some((candidate) => candidate.id === line.beat) && !spliced.has(line.beat)) {
      problems.push(`Audio for "${line.beat}" names no beat of this film`);
    }
  }
  if (problems.length > 0) return { ok: false, problems };

  // The source map is rebuilt from the scenes' scripts, as at compile time, so
  // questions on the new version quote the right lines.
  const scripts = new Map(sources.map((source) => [source.id, source.js]));
  const afterAnchor = new Map<string, typeof placed>();
  for (const line of placed) {
    const list = afterAnchor.get(line.after) ?? [];
    list.push(line);
    afterAnchor.set(line.after, list);
  }
  let clock = 0;
  const beats: CompiledBeat[] = [];
  for (const beat of film.beats) {
    const change = changed.get(`${beat.sceneId} ${beat.id}`);
    let anchor: CompiledBeat;
    if (!change) {
      const next = { ...beat, start: clock };
      clock += beat.seconds;
      beats.push(next);
      anchor = next;
    } else {
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
      beats.push(next);
      anchor = next;
    }
    for (const line of afterAnchor.get(`${beat.sceneId} ${beat.id}`) ?? []) {
      const words = splitWords(line.say);
      const audio = sounded.get(line.audioId);
      const seconds = audio ? Math.min(FILM_BEAT_MAX_SECONDS, Math.max(FILM_BEAT_MIN_SECONDS, audio.seconds + FILM_BEAT_HOLD_SECONDS)) : estimateBeatSeconds(line.say);
      const starts = audio?.words !== undefined ? sanitizeWordStarts(audio.words, words.length, audio.seconds) : undefined;
      const step = { ...anchor.step, say: line.say, ...(line.short !== undefined ? { short: line.short } : {}) };
      const next: CompiledBeat = {
        id: line.id,
        sceneId: anchor.sceneId,
        index: anchor.index,
        step: Object.freeze(step),
        start: clock,
        seconds,
        words,
        timed: audio !== undefined ? true : false,
        ...(starts ? { audioStarts: starts } : {}),
      };
      clock += seconds;
      beats.push(next);
    }
  }
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
  const beats = patch.beats.map((beat) => beat.beat).join(', ');
  const added = (patch.inserts ?? []).map((group) => `+${group.lines.length} after ${group.after.beat}`).join(', ');
  return `v${patch.version} (${[beats, added].filter((part) => part !== '').join('; ')})`;
}

/**
 * Promotes a private insert to a shared patch: the insert's lines become new
 * beats spliced after the anchor, timed by the insert's own line lengths.
 * The insert's transient scene motion (a line's set) is not carried: shared
 * beats replay the anchor's scene state, so the patch stays narration-only.
 * The result is re-sanitized, so the builder only ever emits a valid patch.
 */
export function promoteInsertClip(
  film: CompiledFilm,
  clip: { readonly anchor: { readonly film: string; readonly scene: string; readonly beat: string }; readonly lines: ReadonlyArray<{ readonly say: string; readonly seconds: number }> },
  reason: string,
): { readonly ok: true; readonly patch: FilmVersionPatch } | { readonly ok: false; readonly problems: readonly string[] } {
  if (clip.anchor.film !== film.id) return { ok: false, problems: [`The insert is pinned to "${clip.anchor.film}", not "${film.id}"`] };
  const anchor = film.beats.find((candidate) => candidate.id === clip.anchor.beat && candidate.sceneId === clip.anchor.scene);
  if (!anchor) return { ok: false, problems: [`The insert follows "${clip.anchor.beat}", which is not a beat of this film`] };
  if (clip.lines.length === 0 || clip.lines.length > FILM_PATCH_LIMITS.insertLines) {
    return { ok: false, problems: [`The insert has ${clip.lines.length} lines; promotions carry 1 to ${FILM_PATCH_LIMITS.insertLines}`] };
  }
  const cleaned = typeof reason === 'string' ? cleanText(reason) : '';
  if (cleaned === '') return { ok: false, problems: ['The promotion needs a reason quoting why the insert joins the film'] };
  const version = film.version + 1;
  return sanitizeFilmPatch({
    film: film.id,
    parent: film.version,
    version,
    reason: cleaned,
    beats: [],
    inserts: [{ after: { scene: anchor.sceneId, beat: anchor.id }, lines: clip.lines.map((line) => ({ say: line.say })) }],
    audio: clip.lines.map((line, i) => ({ beat: insertBeatId(anchor.id, version, i + 1), seconds: line.seconds })),
  });
}
