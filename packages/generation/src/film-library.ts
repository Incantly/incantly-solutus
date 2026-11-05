import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FILM_LIBRARY_LIMITS, insertBeatId, patchAudioProblems, patchSummary, sanitizeFilmPatch, sanitizeStoredInsert, type FilmVersionPatch, type StoredInsert } from '@incantly/core';

/**
 * The service-side film library: shared versions and private inserts,
 * following the gallery's store patterns. Versions are patches over the
 * film's base, chained parent to tip; the learner who stores a film's first
 * version becomes its author. Inserts stay private to their asker, keyed by
 * a one-way hash of the asker id; only the author may promote one to a
 * shared version.
 *
 * Everything stored is untrusted: patches and inserts are sanitized with
 * bounds and size caps on the way in and re-validated on the way out, so a
 * corrupt record is skipped, never served.
 */

export interface FilmVersionEntry {
  readonly film: string;
  readonly version: number;
  readonly parent: number;
  readonly patch: FilmVersionPatch;
  /** A one-way hash of the film's author; never shown. */
  readonly author: string;
  readonly createdAt: string;
}

export interface FilmInsertEntry {
  readonly id: string;
  readonly film: string;
  /** A one-way hash of the asker; never shown. */
  readonly asker: string;
  readonly insert: StoredInsert;
  /** True once the author promoted it to a shared version. */
  readonly promoted: boolean;
  readonly createdAt: string;
}

/**
 * One version as the list path reads it: the link, the sanitized patch with
 * its audio bytes stripped, and the bytes' size for the cumulative cap. The
 * full payload stays in the version file, unread until one version is asked
 * for — listing thirty versions never loads thirty audio tracks.
 */
export interface FilmVersionMeta {
  readonly film: string;
  readonly version: number;
  readonly parent: number;
  readonly patch: unknown;
  readonly audioChars: number;
}

/** A patch with its audio bytes stripped; timings stay, so the list path still validates. */
function stripAudio(patch: FilmVersionPatch): FilmVersionPatch {
  return {
    ...patch,
    audio: patch.audio.map((line) => ({
      beat: line.beat,
      seconds: line.seconds,
      ...(line.words !== undefined ? { words: [...line.words] } : {}),
      ...(line.sampleRate !== undefined ? { sampleRate: line.sampleRate } : {}),
    })),
  };
}

function audioCharsOf(patch: FilmVersionPatch): number {
  return patch.audio.reduce((total, line) => total + (line.audioBase64?.length ?? 0), 0);
}

/** Where film versions and inserts are kept. */
export interface FilmLibraryStore {
  getVersion(film: string, version: number): Promise<FilmVersionEntry | null>;
  putVersion(entry: FilmVersionEntry): Promise<void>;
  listVersions(film: string): Promise<FilmVersionEntry[]>;
  /** Every version's metadata, oldest first, without the audio payloads. */
  listVersionMeta(film: string): Promise<FilmVersionMeta[]>;
  /** The film's author hash, or null before the first version lands. */
  authorOf(film: string): Promise<string | null>;
  /** Claims authorship for a new film: first writer wins, true when the film is now theirs. */
  claimAuthor(film: string, author: string): Promise<boolean>;
  getInsert(film: string, asker: string, id: string): Promise<FilmInsertEntry | null>;
  putInsert(entry: FilmInsertEntry): Promise<void>;
  listInserts(film: string, asker: string): Promise<FilmInsertEntry[]>;
  /** One insert by id whatever its asker, for promotion; null when no asker kept it. */
  findInsert(film: string, id: string): Promise<FilmInsertEntry | null>;
  /** Every insert kept under one id whatever the asker, for promotion; explicit ids may collide across askers. */
  findInserts(film: string, id: string): Promise<FilmInsertEntry[]>;
  /** The film's recorded beat ids, or null before any store records them. */
  beatsOf(film: string): Promise<ReadonlyArray<FilmBeatRef> | null>;
  /** Records the film's beat ids once; later calls keep the first record. */
  claimBeats(film: string, beats: ReadonlyArray<FilmBeatRef>): Promise<void>;
  /** Adds beat ids (spliced promotions) to the film's record. */
  addBeats(film: string, beats: ReadonlyArray<FilmBeatRef>): Promise<void>;
}

/** One beat of the film as the service records it: the pair applyFilmPatch matches. */
export interface FilmBeatRef {
  readonly scene: string;
  readonly beat: string;
}

/** Most beats one film's record may name: larger than any film, a bound on the registry. */
const FILM_BEATS_MAX = 1024;

/**
 * The film's beats as its player sends them with a store: the ground truth a
 * patch's beats and anchors are membership-checked against. Sent once — the
 * record keeps the first store's list — and absent from older clients, which
 * store unchecked as before.
 */
function sanitizeFilmBeats(input: unknown): { readonly ok: true; readonly beats: FilmBeatRef[] } | { readonly ok: false; readonly problems: readonly string[] } {
  if (!Array.isArray(input) || input.length === 0 || input.length > FILM_BEATS_MAX) {
    return { ok: false, problems: [`beats must name 1 to ${FILM_BEATS_MAX} beats of the film`] };
  }
  const beats: FilmBeatRef[] = [];
  for (let i = 0; i < input.length; i++) {
    const ref = input[i] as Partial<FilmBeatRef> | null;
    const beat = typeof ref?.beat === 'string' ? ref.beat.trim().slice(0, 80) : '';
    const scene = typeof ref?.scene === 'string' ? ref.scene.trim().slice(0, 80) : '';
    if (beat === '' || scene === '') return { ok: false, problems: [`Beat ${i + 1} must name its beat and scene`] };
    beats.push({ scene, beat });
  }
  return { ok: true, beats };
}

/** A patch's beats and insert anchors the film does not have, in applyFilmPatch's words. */
function beatsOutside(patch: FilmVersionPatch, ground: ReadonlyArray<FilmBeatRef>): string[] {
  const missing: string[] = [];
  const has = (scene: string, beat: string): boolean => ground.some((ref) => ref.scene === scene && ref.beat === beat);
  for (const beat of patch.beats) {
    if (!has(beat.scene, beat.beat)) missing.push(`Beat "${beat.beat}" is not a beat of scene "${beat.scene}"`);
  }
  (patch.inserts ?? []).forEach((group, i) => {
    if (!has(group.after.scene, group.after.beat)) missing.push(`Insert ${i + 1} follows "${group.after.beat}", which is not a beat of scene "${group.after.scene}"`);
  });
  return missing;
}

/** A learner as the film library keeps them: a hash that cannot be turned back into their id. */
export function filmAskerOf(learnerId: string): string {
  return createHash('sha256').update(`incantly-film:${learnerId}`).digest('base64url').slice(0, 16);
}

export class MemoryFilmLibraryStore implements FilmLibraryStore {
  readonly versions = new Map<string, FilmVersionEntry>();
  readonly authors = new Map<string, string>();
  readonly inserts = new Map<string, FilmInsertEntry>();
  readonly beatSets = new Map<string, FilmBeatRef[]>();

  private versionKey(film: string, version: number): string {
    return `${film}:v${version}`;
  }

  private insertKey(film: string, asker: string, id: string): string {
    return `${film}:${asker}:${id}`;
  }

  getVersion(film: string, version: number): Promise<FilmVersionEntry | null> {
    return Promise.resolve(this.versions.get(this.versionKey(film, version)) ?? null);
  }

  putVersion(entry: FilmVersionEntry): Promise<void> {
    this.versions.set(this.versionKey(entry.film, entry.version), entry);
    return Promise.resolve();
  }

  listVersions(film: string): Promise<FilmVersionEntry[]> {
    return Promise.resolve([...this.versions.values()].filter((entry) => entry.film === film).sort((a, b) => a.version - b.version));
  }

  listVersionMeta(film: string): Promise<FilmVersionMeta[]> {
    const metas = [...this.versions.values()]
      .filter((entry) => entry.film === film)
      .sort((a, b) => a.version - b.version)
      .map((entry): FilmVersionMeta => {
        const clean = sanitizeFilmPatch(entry.patch);
        return {
          film: entry.film,
          version: entry.version,
          parent: entry.parent,
          patch: clean.ok ? stripAudio(clean.patch) : entry.patch,
          audioChars: clean.ok ? audioCharsOf(clean.patch) : 0,
        };
      });
    return Promise.resolve(metas);
  }

  authorOf(film: string): Promise<string | null> {
    return Promise.resolve(this.authors.get(film) ?? null);
  }

  claimAuthor(film: string, author: string): Promise<boolean> {
    const held = this.authors.get(film);
    if (held === undefined) {
      this.authors.set(film, author);
      return Promise.resolve(true);
    }
    return Promise.resolve(held === author);
  }

  getInsert(film: string, asker: string, id: string): Promise<FilmInsertEntry | null> {
    return Promise.resolve(this.inserts.get(this.insertKey(film, asker, id)) ?? null);
  }

  putInsert(entry: FilmInsertEntry): Promise<void> {
    this.inserts.set(this.insertKey(entry.film, entry.asker, entry.id), entry);
    return Promise.resolve();
  }

  listInserts(film: string, asker: string): Promise<FilmInsertEntry[]> {
    return Promise.resolve(
      [...this.inserts.values()]
        .filter((entry) => entry.film === film && entry.asker === asker)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
  }

  findInsert(film: string, id: string): Promise<FilmInsertEntry | null> {
    return Promise.resolve([...this.inserts.values()].find((entry) => entry.film === film && entry.id === id) ?? null);
  }

  findInserts(film: string, id: string): Promise<FilmInsertEntry[]> {
    return Promise.resolve([...this.inserts.values()].filter((entry) => entry.film === film && entry.id === id));
  }

  beatsOf(film: string): Promise<ReadonlyArray<FilmBeatRef> | null> {
    const beats = this.beatSets.get(film);
    return Promise.resolve(beats ? beats.map((ref) => ({ ...ref })) : null);
  }

  claimBeats(film: string, beats: ReadonlyArray<FilmBeatRef>): Promise<void> {
    if (!this.beatSets.has(film)) this.beatSets.set(film, beats.map((ref) => ({ ...ref })));
    return Promise.resolve();
  }

  addBeats(film: string, beats: ReadonlyArray<FilmBeatRef>): Promise<void> {
    const known = this.beatSets.get(film);
    if (!known) return Promise.resolve();
    for (const ref of beats) {
      if (!known.some((kept) => kept.scene === ref.scene && kept.beat === ref.beat)) known.push({ ...ref });
    }
    return Promise.resolve();
  }

  /** Empties the library; the dev server's clear endpoint and tests use it. */
  clear(): void {
    this.versions.clear();
    this.authors.clear();
    this.inserts.clear();
    this.beatSets.clear();
  }
}

const FILM_ID = /^[\w-]{1,80}$/;
const HASH = /^[A-Za-z0-9_-]{16}$/;
const INSERT_ID = /^[\w-]{1,80}$/;

/** One JSON file per record under a directory, written whole and renamed into place. */
export class FileFilmLibraryStore implements FilmLibraryStore {
  constructor(private readonly dir: string) {}

  private versionPath(film: string, version: number): string {
    if (!FILM_ID.test(film) || !Number.isInteger(version) || version < 2) throw new Error(`Not a film version: ${film} v${version}`);
    return join(this.dir, 'versions', film, `v${version}.json`);
  }

  private metaPath(film: string, version: number): string {
    if (!FILM_ID.test(film) || !Number.isInteger(version) || version < 2) throw new Error(`Not a film version: ${film} v${version}`);
    return join(this.dir, 'versions', film, `v${version}.meta.json`);
  }

  private authorPath(film: string): string {
    if (!FILM_ID.test(film)) throw new Error(`Not a film: ${film}`);
    return join(this.dir, 'authors', `${film}.json`);
  }

  private insertPath(film: string, asker: string, id: string): string {
    if (!FILM_ID.test(film) || !HASH.test(asker) || !INSERT_ID.test(id)) throw new Error(`Not a film insert: ${film} ${id}`);
    return join(this.dir, 'inserts', film, asker, `${id}.json`);
  }

  private beatsPath(film: string): string {
    if (!FILM_ID.test(film)) throw new Error(`Not a film: ${film}`);
    return join(this.dir, 'beats', `${film}.json`);
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(join(path, '..'), { recursive: true });
    // A unique name per write: concurrent saves to one path never share a
    // temporary, so neither rename steals the other's file.
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporary, path);
  }

  private async readJson(path: string): Promise<unknown | null> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as unknown;
    } catch {
      return null;
    }
  }

  async getVersion(film: string, version: number): Promise<FilmVersionEntry | null> {
    // Stored versions start at 2; anything below reads as missing, like the
    // memory store, so one version answers 404 on both.
    if (!FILM_ID.test(film) || !Number.isInteger(version) || version < 2) return null;
    const entry = (await this.readJson(this.versionPath(film, version))) as FilmVersionEntry | null;
    return entry && entry.film === film && entry.version === version ? entry : null;
  }

  async putVersion(entry: FilmVersionEntry): Promise<void> {
    await this.writeJson(this.versionPath(entry.film, entry.version), entry);
    // The list path reads only this sidecar, never the audio payload above.
    const clean = sanitizeFilmPatch(entry.patch);
    const meta: FilmVersionMeta = {
      film: entry.film,
      version: entry.version,
      parent: entry.parent,
      patch: clean.ok ? stripAudio(clean.patch) : entry.patch,
      audioChars: clean.ok ? audioCharsOf(clean.patch) : 0,
    };
    await this.writeJson(this.metaPath(entry.film, entry.version), meta);
  }

  async listVersions(film: string): Promise<FilmVersionEntry[]> {
    if (!FILM_ID.test(film)) return [];
    let names: string[];
    try {
      names = await readdir(join(this.dir, 'versions', film));
    } catch {
      return [];
    }
    const entries = await Promise.all(
      names
        .filter((name) => /^v\d+\.json$/.test(name))
        .map((name) => this.getVersion(film, Number(name.slice(1, -'.json'.length)))),
    );
    return entries.filter((entry): entry is FilmVersionEntry => entry !== null).sort((a, b) => a.version - b.version);
  }

  async listVersionMeta(film: string): Promise<FilmVersionMeta[]> {
    if (!FILM_ID.test(film)) return [];
    let names: string[];
    try {
      names = await readdir(join(this.dir, 'versions', film));
    } catch {
      return [];
    }
    const metas = await Promise.all(
      names
        .filter((name) => /^v\d+\.meta\.json$/.test(name))
        .map(async (name): Promise<FilmVersionMeta | null> => {
          const version = Number(name.slice(1, -'.meta.json'.length));
          if (!Number.isInteger(version) || version < 2) return null;
          const meta = (await this.readJson(this.metaPath(film, version))) as Partial<FilmVersionMeta> | null;
          if (!meta || meta.film !== film || meta.version !== version || typeof meta.parent !== 'number' || !('patch' in meta)) return null;
          return { film, version, parent: meta.parent, patch: meta.patch, audioChars: typeof meta.audioChars === 'number' ? meta.audioChars : 0 };
        }),
    );
    return metas.filter((meta): meta is FilmVersionMeta => meta !== null).sort((a, b) => a.version - b.version);
  }

  async authorOf(film: string): Promise<string | null> {
    if (!FILM_ID.test(film)) return null;
    const record = (await this.readJson(this.authorPath(film))) as { author?: unknown } | null;
    return typeof record?.author === 'string' && HASH.test(record.author) ? record.author : null;
  }

  /** One claim per film at a time: the corrupt-record replace path re-reads, so concurrent claims serialize to one holder. */
  private readonly claimLocks = new Map<string, Promise<void>>();

  private async withClaimLock<T>(film: string, run: () => Promise<T>): Promise<T> {
    const prior = this.claimLocks.get(film) ?? Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = prior.then(() => turn);
    this.claimLocks.set(film, chained);
    await prior;
    try {
      return await run();
    } finally {
      release();
      if (this.claimLocks.get(film) === chained) this.claimLocks.delete(film);
    }
  }

  async claimAuthor(film: string, author: string): Promise<boolean> {
    return this.withClaimLock(film, async () => {
      const held = await this.authorOf(film);
      if (held !== null) return held === author;
      // Exclusive create: concurrent first writers race here, exactly one wins,
      // and the loser reads the winner — never last-write-wins.
      const target = this.authorPath(film);
      await mkdir(join(target, '..'), { recursive: true });
      try {
        await writeFile(target, `${JSON.stringify({ author }, null, 2)}\n`, { flag: 'wx', encoding: 'utf8' });
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error;
        const winner = await this.authorOf(film);
        if (winner !== null) return winner === author;
        // A corrupt record reads as missing: replace it, as a fresh claim would.
        await this.writeJson(target, { author });
        return true;
      }
    });
  }

  async getInsert(film: string, asker: string, id: string): Promise<FilmInsertEntry | null> {
    if (!FILM_ID.test(film) || !HASH.test(asker) || !INSERT_ID.test(id)) return null;
    const entry = (await this.readJson(this.insertPath(film, asker, id))) as FilmInsertEntry | null;
    return entry && entry.film === film && entry.asker === asker && entry.id === id ? entry : null;
  }

  async putInsert(entry: FilmInsertEntry): Promise<void> {
    await this.writeJson(this.insertPath(entry.film, entry.asker, entry.id), entry);
  }

  async listInserts(film: string, asker: string): Promise<FilmInsertEntry[]> {
    if (!FILM_ID.test(film) || !HASH.test(asker)) return [];
    let names: string[];
    try {
      names = await readdir(join(this.dir, 'inserts', film, asker));
    } catch {
      return [];
    }
    const entries = await Promise.all(names.filter((name) => name.endsWith('.json')).map((name) => this.getInsert(film, asker, name.slice(0, -'.json'.length))));
    return entries
      .filter((entry): entry is FilmInsertEntry => entry !== null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async findInsert(film: string, id: string): Promise<FilmInsertEntry | null> {
    const found = await this.findInserts(film, id);
    return found[0] ?? null;
  }

  async findInserts(film: string, id: string): Promise<FilmInsertEntry[]> {
    if (!FILM_ID.test(film) || !INSERT_ID.test(id)) return [];
    let askers: string[];
    try {
      askers = await readdir(join(this.dir, 'inserts', film));
    } catch {
      return [];
    }
    const found: FilmInsertEntry[] = [];
    for (const asker of askers) {
      if (!HASH.test(asker)) continue;
      const entry = await this.getInsert(film, asker, id);
      if (entry) found.push(entry);
    }
    return found;
  }

  async beatsOf(film: string): Promise<ReadonlyArray<FilmBeatRef> | null> {
    if (!FILM_ID.test(film)) return null;
    const record = (await this.readJson(this.beatsPath(film))) as { beats?: unknown } | null;
    // A corrupt record reads as missing, so a later store records over it.
    if (!record || !Array.isArray(record.beats) || record.beats.length === 0 || record.beats.length > FILM_BEATS_MAX) return null;
    const beats: FilmBeatRef[] = [];
    for (const ref of record.beats as Array<Partial<FilmBeatRef>>) {
      if (typeof ref?.scene !== 'string' || ref.scene === '' || typeof ref?.beat !== 'string' || ref.beat === '') return null;
      beats.push({ scene: ref.scene, beat: ref.beat });
    }
    return beats;
  }

  async claimBeats(film: string, beats: ReadonlyArray<FilmBeatRef>): Promise<void> {
    if (await this.beatsOf(film)) return;
    await this.writeJson(this.beatsPath(film), { beats: beats.map((ref) => ({ scene: ref.scene, beat: ref.beat })) });
  }

  async addBeats(film: string, beats: ReadonlyArray<FilmBeatRef>): Promise<void> {
    const known = await this.beatsOf(film);
    if (!known) return;
    const grown = [...known];
    for (const ref of beats) {
      if (!grown.some((kept) => kept.scene === ref.scene && kept.beat === ref.beat)) grown.push({ scene: ref.scene, beat: ref.beat });
    }
    await this.writeJson(this.beatsPath(film), { beats: grown });
  }
}

/** One version as the service lists it: its link, its reason, and what changed. */
export interface FilmVersionSummary {
  readonly version: number;
  readonly parent: number;
  readonly reason: string;
  readonly beats: readonly string[];
  readonly inserts: ReadonlyArray<{ readonly after: string; readonly lines: number }>;
  readonly summary: string;
}

export function versionSummary(patch: FilmVersionPatch): FilmVersionSummary {
  return {
    version: patch.version,
    parent: patch.parent,
    reason: patch.reason,
    beats: patch.beats.map((beat) => beat.beat),
    inserts: (patch.inserts ?? []).map((group) => ({ after: group.after.beat, lines: group.lines.length })),
    summary: patchSummary(patch),
  };
}

/**
 * The film library: chain-checked version storage, asker-private inserts,
 * and author-only promotion. Every input is untrusted and sanitized; every
 * stored record is re-validated on the way out, so corruption is skipped,
 * never served.
 */
export class FilmLibrary {
  private readonly now: () => number;

  constructor(
    private readonly store: FilmLibraryStore,
    options: { readonly now?: () => number } = {},
  ) {
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * The contiguous valid chain for a film, oldest first, with the audio its
   * patches keep; corrupt records are skipped. Metadata only: the audio
   * payloads are never loaded to list.
   */
  async versions(film: string): Promise<{ readonly versions: readonly FilmVersionSummary[]; readonly dropped: number; readonly audioChars: number }> {
    const metas = await this.store.listVersionMeta(film);
    const versions: FilmVersionSummary[] = [];
    let dropped = 0;
    let audioChars = 0;
    let tip = 1;
    for (const meta of metas) {
      const clean = sanitizeFilmPatch(meta.patch);
      if (!clean.ok || clean.patch.film !== film || clean.patch.parent !== tip || clean.patch.version !== tip + 1) {
        dropped++;
        continue;
      }
      versions.push(versionSummary(clean.patch));
      audioChars += meta.audioChars;
      tip = clean.patch.version;
    }
    return { versions, dropped, audioChars };
  }

  /** One version's patch, validated on load. Null when it is missing or corrupt. */
  async version(film: string, version: number): Promise<FilmVersionPatch | null> {
    const entry = await this.store.getVersion(film, version);
    if (!entry) return null;
    const clean = sanitizeFilmPatch(entry.patch);
    if (!clean.ok || clean.patch.film !== film || clean.patch.version !== version) return null;
    return clean.patch;
  }

  /**
   * Stores an explicit-edit patch as the next version. Author-only past the
   * first version, which claims authorship for the storing learner; the chain
   * must run contiguously from the base, the film's kept audio must fit the
   * cap, and the patch must be appliable — or nothing lands. Shared inserts
   * land only through promotion, never on this path.
   *
   * The player sends the film's beats with the store; the first store's list
   * is recorded, and every patch's beats and insert anchors are
   * membership-checked against it, so a patch naming beats the film does not
   * have is refused before it can wedge the chain. A seated version that
   * provably never applied — missing, corrupt, or outside the recorded
   * beats — heals: the author stores its corrected same-slot replacement,
   * and the versions behind it load again. Anything else on a taken slot
   * still conflicts, and re-posting a slot verbatim is always a conflict.
   */
  async storePatch(
    learnerId: string,
    input: unknown,
    options: { readonly promotion?: boolean; readonly beats?: unknown } = {},
  ): Promise<
    | { readonly ok: true; readonly version: number }
    | { readonly ok: false; readonly refused: 'not-author' | null; readonly conflict: boolean; readonly problems: readonly string[] }
  > {
    const clean = sanitizeFilmPatch(input);
    if (!clean.ok) return { ok: false, refused: null, conflict: false, problems: clean.problems };
    const patch = clean.patch;
    if (!FILM_ID.test(patch.film)) return { ok: false, refused: null, conflict: false, problems: ['The patch names no film'] };
    if (!options.promotion && (patch.inserts?.length ?? 0) > 0) {
      return { ok: false, refused: null, conflict: false, problems: ['Inserts join the shared versions only when the author promotes them'] };
    }
    const audioProblems = patchAudioProblems(patch);
    if (audioProblems.length > 0) return { ok: false, refused: null, conflict: false, problems: audioProblems };
    let provided: FilmBeatRef[] | null = null;
    if (options.beats !== undefined) {
      const refs = sanitizeFilmBeats(options.beats);
      if (!refs.ok) return { ok: false, refused: null, conflict: false, problems: refs.problems };
      provided = refs.beats;
    }
    const me = filmAskerOf(learnerId);
    const held = await this.store.authorOf(patch.film);
    if (held !== null && held !== me) return { ok: false, refused: 'not-author', conflict: false, problems: ['Only the film\u2019s author can store a version'] };
    const { versions, audioChars } = await this.versions(patch.film);
    const recorded = await this.store.beatsOf(patch.film);
    const tip = versions.length === 0 ? 1 : versions[versions.length - 1]!.version;
    const healing = patch.version >= 2 && patch.version <= tip && patch.parent === patch.version - 1;
    if (healing) {
      // A taken slot heals only when it provably never applied: re-posting
      // it verbatim, or overwriting a good slot, still conflicts.
      const seated = await this.store.getVersion(patch.film, patch.version);
      const seatedPatch = seated ? sanitizeFilmPatch(seated.patch) : null;
      const identical = seatedPatch !== null && seatedPatch.ok && JSON.stringify(seatedPatch.patch) === JSON.stringify(patch);
      const seatedBad = !seatedPatch || !seatedPatch.ok || (recorded !== null && beatsOutside(seatedPatch.patch, recorded).length > 0);
      if (identical || !seatedBad) {
        return { ok: false, refused: null, conflict: true, problems: [`The patch applies to version ${patch.parent}, but the chain tip is version ${tip}`] };
      }
    } else {
      if (versions.length + 1 >= FILM_LIBRARY_LIMITS.versions) {
        return { ok: false, refused: null, conflict: false, problems: [`The film keeps ${FILM_LIBRARY_LIMITS.versions} versions; this patch would exceed them`] };
      }
      if (patch.parent !== tip || patch.version !== tip + 1) {
        return { ok: false, refused: null, conflict: true, problems: [`The patch applies to version ${patch.parent}, but the chain tip is version ${tip}`] };
      }
    }
    // The recording store's own patch is checked against the beats it sent;
    // later stores check against the record, never against what they sent.
    const ground = recorded ?? provided;
    if (ground) {
      const outside = beatsOutside(patch, ground);
      if (outside.length > 0) return { ok: false, refused: null, conflict: false, problems: outside };
    }
    // A heal swaps one slot's audio for the replacement's; anything else adds.
    let kept = audioChars + audioCharsOf(patch);
    if (healing) {
      const metas = await this.store.listVersionMeta(patch.film);
      kept -= metas.find((meta) => meta.version === patch.version)?.audioChars ?? 0;
    }
    if (kept > FILM_LIBRARY_LIMITS.storedAudioChars) return { ok: false, refused: null, conflict: false, problems: ['The patch audio would exceed what the film keeps'] };
    // The claim is atomic: concurrent first writers race here, and the loser
    // is refused — authorship never moves, and the entry always names it.
    const mine = await this.store.claimAuthor(patch.film, me);
    if (!mine) return { ok: false, refused: 'not-author', conflict: false, problems: ['Only the film\u2019s author can store a version'] };
    if (provided) await this.store.claimBeats(patch.film, provided);
    if (options.promotion && (patch.inserts?.length ?? 0) > 0) {
      // The spliced beats join the record, placed exactly as applyFilmPatch
      // seats them; only renarrations of real beats pass afterwards.
      const base = await this.store.beatsOf(patch.film);
      if (base) {
        const taken = new Set(base.map((ref) => ref.beat));
        const spliced: FilmBeatRef[] = [];
        let ordinal = 0;
        for (const group of patch.inserts ?? []) {
          for (const _line of group.lines) {
            ordinal++;
            const wanted = insertBeatId(group.after.beat, patch.version, ordinal);
            let id = wanted;
            for (let bump = 2; taken.has(id); bump++) id = `${wanted}-${bump}`;
            taken.add(id);
            spliced.push({ scene: group.after.scene, beat: id });
          }
        }
        if (spliced.length > 0) await this.store.addBeats(patch.film, spliced);
      }
    }
    await this.store.putVersion({
      film: patch.film,
      version: patch.version,
      parent: patch.parent,
      patch,
      author: me,
      createdAt: new Date(this.now()).toISOString(),
    });
    return { ok: true, version: patch.version };
  }

  /** Saves a private insert for its asker. */
  async saveInsert(learnerId: string, input: unknown): Promise<{ readonly ok: true; readonly id: string } | { readonly ok: false; readonly problems: readonly string[] }> {
    const clean = sanitizeStoredInsert(input);
    if (!clean.ok) return clean;
    const insert = clean.insert;
    if (!FILM_ID.test(insert.anchor.film)) return { ok: false, problems: ['The insert names no film'] };
    // The boundary both stores share: ids outside it would throw on the file
    // store (and wander the directory tree) while storing on memory.
    if (!INSERT_ID.test(insert.id)) return { ok: false, problems: ['The insert id may only use letters, numbers, underscore and dash'] };
    const asker = filmAskerOf(learnerId);
    const kept = await this.store.listInserts(insert.anchor.film, asker);
    if (!kept.some((entry) => entry.id === insert.id) && kept.length >= FILM_LIBRARY_LIMITS.insertsPerFilm) {
      return { ok: false, problems: [`One asker keeps ${FILM_LIBRARY_LIMITS.insertsPerFilm} inserts per film`] };
    }
    const existing = await this.store.getInsert(insert.anchor.film, asker, insert.id);
    await this.store.putInsert({
      id: insert.id,
      film: insert.anchor.film,
      asker,
      insert,
      promoted: existing?.promoted ?? false,
      createdAt: existing?.createdAt ?? new Date(this.now()).toISOString(),
    });
    return { ok: true, id: insert.id };
  }

  /** The asker's own inserts for a film, validated on load; corrupt records are skipped. */
  async insertsFor(learnerId: string, film: string): Promise<readonly FilmInsertEntry[]> {
    const entries = await this.store.listInserts(film, filmAskerOf(learnerId));
    const found: FilmInsertEntry[] = [];
    for (const entry of entries) {
      const clean = sanitizeStoredInsert(entry.insert);
      if (!clean.ok || clean.insert.anchor.film !== film) continue;
      found.push(entry);
    }
    return found;
  }

  /**
   * Promotes a private insert to a shared version. Author-only: anyone but
   * the film's author is refused, and the first promotion claims authorship
   * for a film that has none yet. The client builds the promotion patch
   * (promoteInsertClip); the service re-validates it, chain-checks it, stores
   * it as the next version, and marks the insert promoted. Explicit ids may
   * collide across askers, so every insert under the id is matched: the
   * patch promotes whichever asker's lines it actually carries.
   */
  async promote(
    learnerId: string,
    film: string,
    insertId: string,
    patchInput: unknown,
    options: { readonly beats?: unknown } = {},
  ): Promise<
    | { readonly ok: true; readonly version: number; readonly patch: FilmVersionPatch }
    | { readonly ok: false; readonly refused: 'not-author' | 'missing' | null; readonly conflict: boolean; readonly problems: readonly string[] }
  > {
    if (!FILM_ID.test(film) || typeof insertId !== 'string' || !INSERT_ID.test(insertId)) {
      return { ok: false, refused: 'missing', conflict: false, problems: ['No such insert'] };
    }
    const candidates = await this.store.findInserts(film, insertId);
    if (candidates.length === 0) return { ok: false, refused: 'missing', conflict: false, problems: ['No such insert'] };
    // First writer claims authorship, as for an explicit edit: a promotion
    // may be a film's first version.
    const me = filmAskerOf(learnerId);
    let author = await this.store.authorOf(film);
    if (author === null) {
      await this.store.claimAuthor(film, me);
      author = await this.store.authorOf(film);
    }
    if (author !== me) return { ok: false, refused: 'not-author', conflict: false, problems: ['Only the film\u2019s author can promote an insert'] };
    // The patch must actually promote that insert: its lines spliced after
    // its anchor — not an unrelated renarration wearing its id.
    const candidate = sanitizeFilmPatch(patchInput);
    const checked = candidates.map((entry) => ({ entry, clean: sanitizeStoredInsert(entry.insert) }));
    if (!candidate.ok || checked.every((named) => !named.clean.ok)) {
      return { ok: false, refused: null, conflict: false, problems: ['The promotion does not fit'] };
    }
    let matched: FilmInsertEntry | null = null;
    for (const { entry, clean } of checked) {
      if (!clean.ok) continue;
      const anchor = clean.insert.anchor;
      const carries = (candidate.patch.inserts ?? []).some(
        (group) =>
          group.after.scene === anchor.scene &&
          group.after.beat === anchor.beat &&
          group.lines.length === clean.insert.lines.length &&
          group.lines.every((line, i) => line.say === clean.insert.lines[i]!.say),
      );
      if (carries) {
        matched = entry;
        break;
      }
    }
    if (!matched) return { ok: false, refused: null, conflict: false, problems: ['The patch does not promote that insert'] };
    const stored = await this.storePatch(learnerId, patchInput, { promotion: true, ...(options.beats !== undefined ? { beats: options.beats } : {}) });
    if (!stored.ok) return { ok: false, refused: null, conflict: stored.conflict, problems: stored.problems };
    await this.store.putInsert({ ...matched, promoted: true });
    const patch = await this.version(film, stored.version);
    return { ok: true, version: stored.version, patch: patch! };
  }
}
