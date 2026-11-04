import { sha256 } from '../sandbox/sha256';
import { INSERT_MAX_LINES, INSERT_MAX_LINE_SECONDS, INSERT_MIN_LINE_SECONDS, type AskAnchor, type InsertClip, type InsertLine } from './ask';
import type { ResumeStorage } from './controls';
import { wordStarts, type CompiledFilm, type FilmSceneSource } from './storyboard';
import { applyFilmPatch, patchSummary, sanitizeFilmPatch, type FilmVersionPatch } from './versions';

/**
 * The film library: version storage over an immutable base, private inserts
 * pinned by anchor, the version picker model, and export flattening.
 *
 * The base film never changes: every version is a patch over it (versions.ts)
 * with a parent link, and the chain is append-only — a patch lands only on
 * the tip. Inserts are private to their asker, keyed by a one-way hash of the
 * asker id, so one asker never lists another's. Everything stored is treated
 * as untrusted: patches and inserts are sanitized with bounds and size caps
 * on load, before use.
 */

/** Bounds on everything the library keeps. */
export const FILM_LIBRARY_LIMITS = {
  /** Most versions one film keeps, base included. */
  versions: 32,
  /** Most base64 audio characters stored across a film's patches. */
  storedAudioChars: 8_000_000,
  /** Most inserts one asker keeps per film. */
  insertsPerFilm: 64,
  /** Longest one stored insert line. */
  insertSayChars: 2000,
} as const;

function copyDeep<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function freezeDeep<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) freezeDeep(item);
  } else {
    for (const item of Object.values(value)) freezeDeep(item);
  }
  return Object.freeze(value);
}

// ---------------------------------------------------------------------------
// Version storage: an immutable base plus a patch chain
// ---------------------------------------------------------------------------

/** One version as the picker lists it: its link, its reason, and what changed. */
export interface FilmVersionCard {
  readonly version: number;
  /** The parent version; null for the base. */
  readonly parent: number | null;
  readonly reason: string;
  /** The beats a renarration changed. */
  readonly beats: readonly string[];
  /** The inserts a promotion spliced: the anchor beat and the line count. */
  readonly inserts: ReadonlyArray<{ readonly after: string; readonly lines: number }>;
  readonly summary: string;
}

function cardOf(version: number, parent: number | null, reason: string, patch: FilmVersionPatch | null): FilmVersionCard {
  return {
    version,
    parent,
    reason,
    beats: patch ? patch.beats.map((beat) => beat.beat) : [],
    inserts: patch ? ((patch.inserts ?? []).map((group) => ({ after: group.after.beat, lines: group.lines.length }))) : [],
    summary: patch ? patchSummary(patch) : `v${version}`,
  };
}

/**
 * A film's versions: the base, frozen at construction so no caller can change
 * it, plus every patch applied in order. Chain integrity is enforced on the
 * way in — the film must match, the parent must be the tip, the version
 * exactly one above it — and the patch must apply cleanly, or nothing lands.
 */
export class FilmVersionStore {
  private readonly baseFilm: CompiledFilm;
  private readonly sources: readonly FilmSceneSource[];
  private readonly patches = new Map<number, FilmVersionPatch>();
  private readonly films = new Map<number, CompiledFilm>();
  private storedAudioChars = 0;

  constructor(base: CompiledFilm, sources: readonly FilmSceneSource[]) {
    this.baseFilm = freezeDeep(copyDeep(base));
    this.sources = sources;
    this.films.set(this.baseFilm.version, this.baseFilm);
  }

  /** The base film, frozen: callers can play it but never change it. */
  get base(): CompiledFilm {
    return this.baseFilm;
  }

  /** The tip of the chain: the version new patches must build on. */
  get latest(): number {
    return this.baseFilm.version + this.patches.size;
  }

  get count(): number {
    return 1 + this.patches.size;
  }

  /** One version's film, frozen. Null for a version the chain does not have. */
  get(version: number): CompiledFilm | null {
    return this.films.get(version) ?? null;
  }

  /** One version's patch, frozen. Null for the base and the unknown. */
  patch(version: number): FilmVersionPatch | null {
    return this.patches.get(version) ?? null;
  }

  /** Every version, base first, as the picker lists them. */
  list(): readonly FilmVersionCard[] {
    const cards: FilmVersionCard[] = [cardOf(this.baseFilm.version, null, 'The film as made', null)];
    const versions = [...this.patches.keys()].sort((a, b) => a - b);
    for (const version of versions) {
      const patch = this.patches.get(version)!;
      cards.push(cardOf(version, patch.parent, patch.reason, patch));
    }
    return cards;
  }

  /**
   * Appends a patch as the next version. The input is untrusted: it is
   * sanitized, chain-checked against the tip, size-checked, and applied —
   * and only a patch that passes all four lands.
   */
  putPatch(input: unknown): { readonly ok: true; readonly version: number } | { readonly ok: false; readonly problems: readonly string[] } {
    const clean = sanitizeFilmPatch(input);
    if (!clean.ok) return clean;
    const patch = clean.patch;
    if (patch.film !== this.baseFilm.id) return { ok: false, problems: [`The patch changes "${patch.film}", not "${this.baseFilm.id}"`] };
    const tip = this.latest;
    if (patch.parent !== tip) {
      return { ok: false, problems: [`The patch applies to version ${patch.parent}, but the chain tip is version ${tip}`] };
    }
    if (patch.version !== tip + 1) return { ok: false, problems: ['The patch must create exactly the next version'] };
    if (this.count + 1 > FILM_LIBRARY_LIMITS.versions) {
      return { ok: false, problems: [`The film keeps ${FILM_LIBRARY_LIMITS.versions} versions; this patch would exceed them`] };
    }
    const audioChars = patch.audio.reduce((total, line) => total + (line.audioBase64?.length ?? 0), 0);
    if (this.storedAudioChars + audioChars > FILM_LIBRARY_LIMITS.storedAudioChars) {
      return { ok: false, problems: ['The patch audio would exceed what the film keeps'] };
    }
    const parent = this.films.get(patch.parent);
    if (!parent) return { ok: false, problems: [`Version ${patch.parent} is not in the chain`] };
    const applied = applyFilmPatch(parent, patch, this.sources);
    if (!applied.ok) return applied;
    this.patches.set(patch.version, freezeDeep(copyDeep(patch)));
    this.films.set(patch.version, freezeDeep(applied.film));
    this.storedAudioChars += audioChars;
    return { ok: true, version: patch.version };
  }

  /**
   * Rebuilds a store from a base and its stored patches. The patches are
   * untrusted: each is sanitized, chain-checked against the tip, and applied —
   * and each bad patch is skipped, never fatal. One poison patch costs the
   * versions behind it, never the good prefix: the film plays what loads.
   */
  static load(
    base: CompiledFilm,
    stored: unknown,
    sources: readonly FilmSceneSource[],
  ): { readonly ok: true; readonly store: FilmVersionStore; readonly dropped: number } | { readonly ok: false; readonly problems: readonly string[] } {
    if (!Array.isArray(stored)) return { ok: false, problems: ['Stored versions must be an array of patches'] };
    const store = new FilmVersionStore(base, sources);
    let dropped = 0;
    for (const candidate of stored) {
      const clean = sanitizeFilmPatch(candidate);
      if (!clean.ok) {
        dropped++;
        continue;
      }
      // putPatch re-checks the film, the tip, the caps, and the apply: a
      // poison patch is skipped, and the next good one still lands.
      const appended = store.putPatch(clean.patch);
      if (!appended.ok) dropped++;
    }
    return { ok: true, store, dropped };
  }
}

// ---------------------------------------------------------------------------
// Private inserts: pinned by anchor, private to the asker
// ---------------------------------------------------------------------------

/** A stored insert: the clip plus when it was asked. */
export interface StoredInsert {
  readonly id: string;
  readonly anchor: AskAnchor;
  readonly lines: readonly InsertLine[];
  readonly seconds: number;
  readonly askedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const cleanText = (text: string): string => text.trim().replace(/\s+/g, ' ');

/**
 * A stored insert, structurally validated without its film: ids, the anchor,
 * and bounded lines. The player re-validates against the film and its
 * controls before anything plays (validateInsertClip); this is the load-time
 * gate that keeps corrupt or oversized records out of the list.
 */
export function sanitizeStoredInsert(input: unknown): { readonly ok: true; readonly insert: StoredInsert } | { readonly ok: false; readonly problems: readonly string[] } {
  if (!isRecord(input)) return { ok: false, problems: ['The insert must be an object'] };
  const problems: string[] = [];
  const id = typeof input.id === 'string' ? input.id.trim().slice(0, 80) : '';
  if (id === '') problems.push('The insert needs an id');
  const rawAnchor = input.anchor;
  let anchor: AskAnchor | null = null;
  if (!isRecord(rawAnchor)) {
    problems.push('The insert needs the anchor it interrupted');
  } else {
    const film = typeof rawAnchor.film === 'string' ? rawAnchor.film.trim().slice(0, 80) : '';
    const scene = typeof rawAnchor.scene === 'string' ? rawAnchor.scene.trim().slice(0, 80) : '';
    const beat = typeof rawAnchor.beat === 'string' ? rawAnchor.beat.trim().slice(0, 80) : '';
    const version = rawAnchor.version;
    const wordIndex = rawAnchor.wordIndex;
    if (film === '' || scene === '' || beat === '') problems.push('The anchor must name its film, scene and beat');
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) problems.push('The anchor needs its film version');
    if (typeof wordIndex !== 'number' || !Number.isInteger(wordIndex) || wordIndex < 0 || wordIndex > 10_000) problems.push('The anchor needs its word');
    const controlValues: Record<string, number> = {};
    if (rawAnchor.controlValues !== undefined) {
      if (!isRecord(rawAnchor.controlValues) || Object.keys(rawAnchor.controlValues).length > 32) {
        problems.push('The anchor carries too many control values');
      } else {
        for (const [name, value] of Object.entries(rawAnchor.controlValues)) {
          if (name.length > 80 || typeof value !== 'number' || !Number.isFinite(value)) {
            problems.push('The anchor carries a control value that is not a number');
            break;
          }
          controlValues[name] = value;
        }
      }
    }
    const readouts: Array<{ label: string; text: string }> = [];
    if (rawAnchor.readouts !== undefined) {
      if (!Array.isArray(rawAnchor.readouts) || rawAnchor.readouts.length > 16) {
        problems.push('The anchor carries too many readouts');
      } else {
        for (const readout of rawAnchor.readouts) {
          if (!isRecord(readout) || typeof readout.label !== 'string' || typeof readout.text !== 'string' || readout.label.length > 200 || readout.text.length > 200) {
            problems.push('The anchor carries a readout that is not label and text');
            break;
          }
          readouts.push({ label: readout.label, text: readout.text });
        }
      }
    }
    if (problems.length === 0) {
      anchor = { film, version: version as number, scene, beat, wordIndex: wordIndex as number, controlValues, readouts };
    }
  }
  const lines: InsertLine[] = [];
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > INSERT_MAX_LINES) {
    problems.push(`The insert needs 1 to ${INSERT_MAX_LINES} lines`);
  } else {
    input.lines.forEach((line, i) => {
      if (!isRecord(line) || typeof line.say !== 'string' || cleanText(line.say) === '' || cleanText(line.say).length > FILM_LIBRARY_LIMITS.insertSayChars) {
        problems.push(`Line ${i + 1} needs something to say of 1 to ${FILM_LIBRARY_LIMITS.insertSayChars} characters`);
        return;
      }
      const seconds = Number(line.seconds);
      if (!Number.isFinite(seconds) || seconds < INSERT_MIN_LINE_SECONDS || seconds > INSERT_MAX_LINE_SECONDS) {
        problems.push(`Line ${i + 1} runs outside ${INSERT_MIN_LINE_SECONDS} to ${INSERT_MAX_LINE_SECONDS} seconds`);
        return;
      }
      if (line.set !== undefined) {
        if (!isRecord(line.set) || Object.keys(line.set).length > 8) {
          problems.push(`Line ${i + 1} sets too many values`);
          return;
        }
        for (const [name, value] of Object.entries(line.set)) {
          if (name === '' || name.length > 80 || typeof value !== 'number' || !Number.isFinite(value)) {
            problems.push(`Line ${i + 1} sets "${name}", which is not a number`);
            return;
          }
        }
      }
      lines.push({ say: cleanText(line.say), seconds, ...(line.set ? { set: { ...(line.set as Record<string, number>) } } : {}) });
    });
  }
  const askedAt = input.askedAt === undefined ? 0 : input.askedAt;
  if (typeof askedAt !== 'number' || !Number.isInteger(askedAt) || askedAt < 0) problems.push('askedAt must be a timestamp');
  if (problems.length > 0 || !anchor || typeof askedAt !== 'number') return { ok: false, problems };
  return { ok: true, insert: { id, anchor, lines, seconds: lines.reduce((total, line) => total + line.seconds, 0), askedAt } };
}

/** An asker as storage keys them: a hash that cannot be turned back into their id. */
export function askerHashOf(askerId: string): string {
  const digest = [...sha256(new TextEncoder().encode(`incantly-film:${askerId}`))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return digest.slice(0, 16);
}

function keyPart(id: string): string {
  const readable = id.trim().replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40) || 'film';
  const digest = [...sha256(new TextEncoder().encode(id.trim()))].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 12);
  return `${readable}.${digest}`;
}

/**
 * The asker-scoped index key for one film's inserts: the asker hash keeps one
 * asker's inserts out of another's listing, the film part keeps films apart.
 */
export function insertIndexKey(askerId: string, filmId: string): string {
  return `incantly.film.inserts.${askerHashOf(askerId)}.${keyPart(filmId)}.index`;
}

/** The asker-scoped record key for one insert. */
export function insertRecordKey(askerId: string, filmId: string, insertId: string): string {
  return `incantly.film.inserts.${askerHashOf(askerId)}.${keyPart(filmId)}.${keyPart(insertId)}`;
}

/**
 * Private inserts in key storage: asker-scoped keys, so `list` only ever
 * sees the asker's own. Records are validated on the way out; corrupt ones
 * are dropped from the listing, never thrown.
 */
export class PrivateInsertStore {
  constructor(private readonly storage: ResumeStorage) {}

  /** Saves an insert for its asker. The input is untrusted and sanitized. */
  save(askerId: string, input: unknown): { readonly ok: true; readonly id: string } | { readonly ok: false; readonly problems: readonly string[] } {
    if (typeof askerId !== 'string' || askerId.trim() === '' || askerId.length > 128) {
      return { ok: false, problems: ['The insert needs its asker'] };
    }
    const clean = sanitizeStoredInsert(input);
    if (!clean.ok) return clean;
    const insert = clean.insert;
    const index = this.indexOf(askerId, insert.anchor.film);
    if (!index.includes(insert.id) && index.length >= FILM_LIBRARY_LIMITS.insertsPerFilm) {
      return { ok: false, problems: [`One asker keeps ${FILM_LIBRARY_LIMITS.insertsPerFilm} inserts per film`] };
    }
    try {
      this.storage.setItem(insertRecordKey(askerId, insert.anchor.film, insert.id), JSON.stringify(insert));
      if (!index.includes(insert.id)) this.storage.setItem(insertIndexKey(askerId, insert.anchor.film), JSON.stringify([...index, insert.id]));
    } catch {
      return { ok: false, problems: ['The insert could not be kept'] };
    }
    return { ok: true, id: insert.id };
  }

  /** The asker's own inserts for one film, validated on load; corrupt records are dropped. */
  list(askerId: string, filmId: string): StoredInsert[] {
    if (typeof askerId !== 'string' || askerId === '') return [];
    const found: StoredInsert[] = [];
    for (const id of this.indexOf(askerId, filmId)) {
      const record = this.get(askerId, filmId, id);
      if (record) found.push(record);
    }
    return found.sort((a, b) => a.askedAt - b.askedAt);
  }

  /** One insert, validated on load. Null when it is missing or corrupt. */
  get(askerId: string, filmId: string, id: string): StoredInsert | null {
    let raw: string | null;
    try {
      raw = this.storage.getItem(insertRecordKey(askerId, filmId, id));
    } catch {
      return null;
    }
    if (raw === null || raw === '') return null;
    try {
      const clean = sanitizeStoredInsert(JSON.parse(raw) as unknown);
      if (!clean.ok || clean.insert.anchor.film !== filmId) return null;
      return clean.insert;
    } catch {
      return null;
    }
  }

  /** Forgets one insert. False when it was already gone. */
  remove(askerId: string, filmId: string, id: string): boolean {
    const index = this.indexOf(askerId, filmId);
    if (!index.includes(id)) return false;
    try {
      this.storage.removeItem(insertRecordKey(askerId, filmId, id));
      this.storage.setItem(insertIndexKey(askerId, filmId), JSON.stringify(index.filter((entry) => entry !== id)));
    } catch {
      return false;
    }
    return true;
  }

  private indexOf(askerId: string, filmId: string): string[] {
    let raw: string | null;
    try {
      raw = this.storage.getItem(insertIndexKey(askerId, filmId));
    } catch {
      return [];
    }
    if (raw === null || raw === '') return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((entry): entry is string => typeof entry === 'string' && entry !== '' && entry.length <= 80).slice(0, FILM_LIBRARY_LIMITS.insertsPerFilm);
    } catch {
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// The version picker model: list, switch, and play any version
// ---------------------------------------------------------------------------

/** One version as the picker offers it. */
export interface VersionChoice {
  readonly version: number;
  readonly summary: string;
  readonly reason: string;
  readonly beats: readonly string[];
  readonly current: boolean;
}

/**
 * The picker model: everything a version picker shows, without the DOM. The
 * playground binds a select to it; switching hands back the version's film,
 * and the caller re-resolves the position by beat id (reanchorAskAnchor) and
 * plays. Anchors are never carried as seconds across versions.
 */
export class VersionPicker {
  private currentVersion: number;

  constructor(private readonly store: FilmVersionStore) {
    this.currentVersion = store.latest;
  }

  get current(): CompiledFilm {
    return this.store.get(this.currentVersion) ?? this.store.base;
  }

  choices(): readonly VersionChoice[] {
    return this.store.list().map((card) => ({
      version: card.version,
      summary: card.summary,
      reason: card.reason,
      beats: card.beats,
      current: card.version === this.currentVersion,
    }));
  }

  /** Switches to a version's film. Null for a version the chain does not have. */
  switchTo(version: number): CompiledFilm | null {
    const film = this.store.get(version);
    if (!film) return null;
    this.currentVersion = version;
    return film;
  }
}

/**
 * Re-resolves a beat-id anchor on another version of its film: the same beat,
 * the same word clamped into it. Null when the film moved past the beat.
 * Versions never share seconds — only beat ids survive a switch.
 */
export function reanchorAskAnchor(film: CompiledFilm, anchor: AskAnchor): { readonly anchor: AskAnchor; readonly seconds: number } | null {
  if (anchor.film !== film.id) return null;
  const beat = film.beats.find((candidate) => candidate.id === anchor.beat);
  if (!beat || beat.words.length === 0) return null;
  const wordIndex = Math.min(Math.max(anchor.wordIndex, 0), beat.words.length - 1);
  return {
    anchor: { ...anchor, film: film.id, version: film.version, scene: beat.sceneId, wordIndex },
    seconds: wordStarts(beat)[wordIndex] ?? beat.start,
  };
}

// ---------------------------------------------------------------------------
// Export: a flattened timeline the renderer will consume (data only)
// ---------------------------------------------------------------------------

/** One flattened beat: film beats and spliced insert lines in play order, re-timed. */
export interface FlattenedBeat {
  readonly id: string;
  readonly sceneId: string;
  /** Position in play order. */
  readonly index: number;
  readonly say: string;
  readonly short?: string;
  /** Seconds from the export's start: recomputed, never carried. */
  readonly start: number;
  readonly seconds: number;
  readonly from: 'film' | 'insert';
  readonly insertId?: string;
  /** The anchor beat, for spliced lines. */
  readonly anchorBeat?: string;
}

/** A flattened timeline: beats in play order with recomputed timing. MP4 rendering consumes this next slice. */
export interface FlattenedTimeline {
  readonly film: string;
  readonly title: string;
  readonly version: number;
  readonly beats: readonly FlattenedBeat[];
  readonly seconds: number;
  readonly selection: 'film' | 'film+inserts' | 'insert';
  /** The inserts spliced in, in splice order. */
  readonly inserts: readonly string[];
}

/**
 * Flattens a film, alone or with chosen inserts spliced after their pins:
 * every beat in play order with recomputed starts. Pins resolve by beat id;
 * an insert pinned to a beat the film does not have (or another film) is
 * skipped, since stored data is untrusted. Line sets do not ride along:
 * the export is beats and timing, the renderer owns the scene.
 */
export function flattenFilm(film: CompiledFilm, inserts: readonly InsertClip[] = []): FlattenedTimeline {
  const byAnchor = new Map<string, InsertClip[]>();
  const used: string[] = [];
  for (const clip of inserts) {
    if (clip.anchor.film !== film.id) continue;
    const anchor = film.beats.find((candidate) => candidate.id === clip.anchor.beat);
    if (!anchor) continue;
    const list = byAnchor.get(anchor.id) ?? [];
    list.push(clip);
    byAnchor.set(anchor.id, list);
    used.push(clip.id);
  }
  const beats: FlattenedBeat[] = [];
  for (const beat of film.beats) {
    beats.push({
      id: beat.id,
      sceneId: beat.sceneId,
      index: 0,
      say: beat.step.say,
      ...(beat.step.short !== undefined ? { short: beat.step.short } : {}),
      start: 0,
      seconds: beat.seconds,
      from: 'film',
    });
    for (const clip of byAnchor.get(beat.id) ?? []) {
      clip.lines.forEach((line, i) => {
        beats.push({
          id: `${clip.id}-l${i + 1}`,
          sceneId: clip.anchor.scene,
          index: 0,
          say: line.say,
          start: 0,
          seconds: line.seconds,
          from: 'insert',
          insertId: clip.id,
          anchorBeat: beat.id,
        });
      });
    }
  }
  let clock = 0;
  const timed = beats.map((beat, index) => {
    const next = { ...beat, index, start: clock };
    clock += beat.seconds;
    return next;
  });
  return { film: film.id, title: film.title, version: film.version, beats: timed, seconds: clock, selection: used.length > 0 ? 'film+inserts' : 'film', inserts: used };
}

/** Flattens a single insert: its lines in order with recomputed timing. */
export function flattenInsert(film: CompiledFilm, clip: InsertClip): FlattenedTimeline {
  let clock = 0;
  const beats = clip.lines.map((line, i) => {
    const next: FlattenedBeat = {
      id: `${clip.id}-l${i + 1}`,
      sceneId: clip.anchor.scene,
      index: i,
      say: line.say,
      start: clock,
      seconds: line.seconds,
      from: 'insert',
      insertId: clip.id,
      anchorBeat: clip.anchor.beat,
    };
    clock += line.seconds;
    return next;
  });
  return { film: film.id, title: film.title, version: film.version, beats, seconds: clock, selection: 'insert', inserts: [clip.id] };
}

/**
 * A timeline's transcript: beat text only, one line per beat. No ids, no
 * anchors, no timing — what the learner heard, nothing else.
 */
export function flattenTranscript(timeline: FlattenedTimeline): readonly string[] {
  return timeline.beats.filter((beat) => beat.say !== '').map((beat) => beat.say);
}
