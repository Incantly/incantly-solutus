import { sha256 } from '../sandbox/sha256';
import { wordStarts, type CompiledFilm } from './storyboard';

/**
 * The full player controls' shared model: link-to-time hashes, resume
 * positions, and the keyboard shortcut list. The playground page binds DOM to
 * these; tests drive them headlessly. Loop-a-beat and bookmarks live on the
 * PlayerModel (player.ts), next to the transport they drive.
 */

// ---------------------------------------------------------------------------
// Link to a time
// ---------------------------------------------------------------------------

/**
 * A deep link into a film: its beat and word when the linker knew them, or
 * plain seconds. Beat and word survive re-timed audio; seconds survive
 * nothing but stay valid whatever the film's version.
 */
export interface FilmLink {
  readonly film: string;
  readonly version: number;
  readonly beat?: string;
  readonly word?: number;
  readonly t?: number;
}

/** Longest a film or beat id in a link may be. */
const LINK_ID_CHARS = 80;

/**
 * Formats a deep link hash: `#film=pendulum&v=1&beat=s1b3&w=2`. Beat-first so
 * the link follows re-timed audio; versioned so an old link never lands a new
 * film in the wrong place.
 */
export function formatFilmLink(link: FilmLink): string {
  const params = new URLSearchParams();
  params.set('film', link.film);
  params.set('v', String(link.version));
  if (link.beat !== undefined) {
    params.set('beat', link.beat);
    params.set('w', String(Math.max(0, Math.floor(link.word ?? 0))));
  } else if (link.t !== undefined) {
    params.set('t', String(Math.max(0, link.t)));
  }
  return `#${params.toString()}`;
}

/** Parses a deep link hash, validating its shape. Null for anything malformed. */
export function parseFilmLink(hash: string): FilmLink | null {
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  if (text.trim() === '') return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(text);
  } catch {
    return null;
  }
  const film = params.get('film') ?? '';
  const version = Number(params.get('v'));
  if (film === '' || film.length > LINK_ID_CHARS || !Number.isInteger(version) || version < 1) return null;
  const beat = params.get('beat');
  if (beat !== null) {
    if (beat === '' || beat.length > LINK_ID_CHARS) return null;
    const rawWord = params.get('w');
    const word = rawWord === null ? 0 : Number(rawWord);
    if (!Number.isInteger(word) || word < 0 || word > 10_000) return null;
    return { film, version, beat, word };
  }
  const rawT = params.get('t');
  if (rawT !== null) {
    const t = Number(rawT);
    if (!Number.isFinite(t) || t < 0 || t > 24 * 3600) return null;
    return { film, version, t };
  }
  return { film, version };
}

/**
 * Resolves a link to film seconds: the beat's word start when the link names
 * a beat that exists, clamped seconds otherwise. Null when the link names
 * another film or another version, so an old link never mis-seeks a new film.
 */
export function resolveFilmLink(film: CompiledFilm, link: FilmLink): number | null {
  if (link.film !== film.id || link.version !== film.version) return null;
  if (link.beat !== undefined) {
    const beat = film.beats.find((candidate) => candidate.id === link.beat);
    if (!beat || beat.words.length === 0) return null;
    const index = Math.min(Math.max(link.word ?? 0, 0), beat.words.length - 1);
    return wordStarts(beat)[index] ?? beat.start;
  }
  if (link.t !== undefined) return Math.min(Math.max(link.t, 0), film.seconds);
  return film.beats[0]?.start ?? 0;
}

// ---------------------------------------------------------------------------
// Resume where the learner left off
// ---------------------------------------------------------------------------

/**
 * A resume position: the version, the beat and word, and the seconds, as ids
 * and numbers only. Never question or note text: the store's shape has no
 * field for them, so none can ever be written.
 */
export interface FilmPosition {
  readonly v: number;
  readonly beat: string;
  readonly w: number;
  readonly t: number;
}

/** Storage the resume store writes through: localStorage in the page, a Map-backed stub in tests. */
export interface ResumeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The resume key for one film, namespaced so films never share a position.
 * The sanitized id keeps the key readable; the hash of the full id keeps it
 * unique, since sanitizing is many-to-one ('my film' and 'my-film' read the
 * same, and long titles truncate to the same prefix).
 */
export function resumeKey(filmId: string): string {
  const id = filmId.trim().replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80) || 'film';
  const digest = [...sha256(new TextEncoder().encode(filmId.trim()))].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 12);
  return `incantly.film.resume.${id}.${digest}`;
}

/**
 * Per-film resume positions in localStorage: ids and numbers only. A position
 * from another version is kept but never applied, so an edited film starts at
 * its beginning instead of a word that moved.
 */
export class ResumeStore {
  constructor(private readonly storage: ResumeStorage) {}

  save(filmId: string, position: FilmPosition): void {
    const clean: FilmPosition = {
      v: Math.max(1, Math.floor(position.v)),
      beat: position.beat.slice(0, LINK_ID_CHARS),
      w: Math.max(0, Math.floor(position.w)),
      t: Math.max(0, position.t),
    };
    if (!Number.isFinite(clean.t) || !Number.isInteger(clean.v) || clean.beat === '') return;
    try {
      this.storage.setItem(resumeKey(filmId), JSON.stringify(clean));
    } catch {
      // Private browsing and quotas: the film plays on without resume.
    }
  }

  /** The stored position, validated. Null when nothing was stored, or it is not a position. */
  load(filmId: string): FilmPosition | null {
    let raw: string | null;
    try {
      raw = this.storage.getItem(resumeKey(filmId));
    } catch {
      return null;
    }
    if (raw === null || raw === '') return null;
    try {
      const parsed = JSON.parse(raw) as Partial<FilmPosition>;
      if (typeof parsed !== 'object' || parsed === null) return null;
      const { v, beat, w, t } = parsed;
      if (!Number.isInteger(v) || (v as number) < 1) return null;
      if (typeof beat !== 'string' || beat === '' || beat.length > LINK_ID_CHARS) return null;
      if (!Number.isInteger(w) || (w as number) < 0 || (w as number) > 10_000) return null;
      if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > 24 * 3600) return null;
      return { v: v as number, beat, w: w as number, t };
    } catch {
      return null;
    }
  }

  clear(filmId: string): void {
    try {
      this.storage.removeItem(resumeKey(filmId));
    } catch {
      // Nothing stored, or storage is gone: either way there is nothing to do.
    }
  }
}

/**
 * Resolves a stored position to film seconds: the beat's word start when the
 * film is still the stored version and the beat exists, else null. The caller
 * seeks; the store never seeks on its own.
 */
export function resolveFilmPosition(film: CompiledFilm, position: FilmPosition): number | null {
  if (position.v !== film.version) return null;
  const beat = film.beats.find((candidate) => candidate.id === position.beat);
  if (!beat || beat.words.length === 0) return null;
  const index = Math.min(Math.max(position.w, 0), beat.words.length - 1);
  return wordStarts(beat)[index] ?? beat.start;
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

export type ShortcutAction = 'playPause' | 'back' | 'forward' | 'prevBeat' | 'nextBeat' | 'captions' | 'sound' | 'ask' | 'loop' | 'bookmark';

export interface PlayerShortcut {
  /** The key as KeyboardEvent.key, matched case-insensitively for letters. */
  readonly key: string;
  readonly action: ShortcutAction;
  readonly label: string;
}

/**
 * The documented shortcut list, rendered by the player's help and matched by
 * shortcutFor. Single letters and punctuation only, all without modifiers:
 * nothing here is a browser-reserved key (no Tab, Escape, arrows, function
 * keys or Ctrl/Meta chords), and the page fires them only when focus is not
 * in a field, a control that consumes keys, or a menu — so screen-reader
 * browse mode, which swallows single letters first, and every text field keep
 * working untouched. Space is deliberately not play/pause: it activates the
 * focused button and scrolls the page.
 */
export const SHORTCUTS: readonly PlayerShortcut[] = [
  { key: 'k', action: 'playPause', label: 'Play / pause' },
  { key: 'j', action: 'back', label: 'Back 5 seconds' },
  { key: 'l', action: 'forward', label: 'Forward 5 seconds' },
  { key: ',', action: 'prevBeat', label: 'Previous beat' },
  { key: '.', action: 'nextBeat', label: 'Next beat' },
  { key: 'c', action: 'captions', label: 'Captions on / off' },
  { key: 'm', action: 'sound', label: 'Sound on / off' },
  { key: 'a', action: 'ask', label: 'Ask about this moment' },
  { key: 'o', action: 'loop', label: 'Loop the beat on / off' },
  { key: 'b', action: 'bookmark', label: 'Bookmark this moment' },
];

/** Matches a key press to its shortcut, or null. The page checks focus guards before calling. */
export function shortcutFor(key: string): PlayerShortcut | null {
  if (key.length !== 1) return null;
  const lower = key.toLowerCase();
  return SHORTCUTS.find((shortcut) => shortcut.key === lower || shortcut.key === key) ?? null;
}
