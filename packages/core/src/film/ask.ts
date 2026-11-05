import { estimateBeatSeconds, wordStarts, type CompiledBeat, type CompiledFilm } from './storyboard';

/**
 * Tap-to-ask interruption: word-boundary anchors, the cheapest-rung router,
 * the return stack, and insert clips pinned to anchors with auto-resume.
 *
 * A tap pauses the film clock at the current word (from word timings, or the
 * 2.5-words-per-second estimate while silent). The anchor names the beat and
 * the word, never seconds, plus the scene's control values and readouts as
 * the learner saw them; changed audio or edited versions never break it.
 */

/** A readout as the learner saw it when they asked. */
export interface AskReadout {
  readonly label: string;
  readonly text: string;
}

/**
 * Where a question is pinned: film, version, scene and beat, with the word
 * sounding when the learner asked and the scene's state then. Beat ids and
 * word indexes, never absolute seconds.
 */
export interface AskAnchor {
  readonly film: string;
  readonly version: number;
  readonly scene: string;
  readonly beat: string;
  readonly wordIndex: number;
  readonly controlValues: Readonly<Record<string, number>>;
  readonly readouts: ReadonlyArray<AskReadout>;
}

/** The scene's state at the tap: values from runtime.values, readouts from uiState. */
export interface AskSnapshot {
  readonly values: Readonly<Record<string, number>>;
  readonly readouts: ReadonlyArray<{ readonly label: string; readonly text: string }>;
}

const EMPTY_SNAPSHOT: AskSnapshot = { values: {}, readouts: [] };

/** The word sounding at a film time: the last one started, clamped into the beat. */
export function askWordIndex(beat: CompiledBeat, time: number): number {
  const starts = wordStarts(beat);
  let index = 0;
  starts.forEach((start, i) => {
    if (time + 1e-9 >= start) index = i;
  });
  return Math.min(Math.max(index, 0), Math.max(0, beat.words.length - 1));
}

/** Pins an anchor at the word sounding at a film time. Null for an unknown beat. */
export function askAnchorFor(film: CompiledFilm, beatId: string, time: number, snapshot: AskSnapshot = EMPTY_SNAPSHOT): AskAnchor | null {
  const beat = film.beats.find((candidate) => candidate.id === beatId);
  if (!beat) return null;
  const values: Record<string, number> = {};
  for (const [name, value] of Object.entries(snapshot.values)) {
    if (typeof value === 'number' && Number.isFinite(value)) values[name] = value;
  }
  return {
    film: film.id,
    version: film.version,
    scene: beat.sceneId,
    beat: beatId,
    wordIndex: askWordIndex(beat, time),
    controlValues: values,
    readouts: snapshot.readouts.map((readout) => ({ label: readout.label, text: readout.text })),
  };
}

/**
 * Resolves an anchor to film seconds: the anchor word's start. Anchors are
 * stored by beat id and word index; only playback resolves them, so re-timed
 * audio never breaks a stored anchor. Null when the film or version moved on.
 */
export function resolveAskAnchor(film: CompiledFilm, anchor: AskAnchor): number | null {
  if (anchor.film !== film.id || anchor.version !== film.version) return null;
  const beat = film.beats.find((candidate) => candidate.id === anchor.beat && candidate.sceneId === anchor.scene);
  if (!beat || beat.words.length === 0) return null;
  const index = Math.min(Math.max(anchor.wordIndex, 0), beat.words.length - 1);
  return wordStarts(beat)[index] ?? beat.start;
}

/** Words around the anchor word for the ask sheet's context line, two each side. */
export function anchorWords(film: CompiledFilm, anchor: AskAnchor): string {
  const beat = film.beats.find((candidate) => candidate.id === anchor.beat && candidate.sceneId === anchor.scene);
  if (!beat) return '';
  const from = Math.max(0, anchor.wordIndex - 2);
  const to = Math.min(beat.words.length, anchor.wordIndex + 3);
  const text = beat.words.slice(from, to).join(' ');
  return `${from > 0 ? '… ' : ''}${text}${to < beat.words.length ? ' …' : ''}`;
}

/** The ask sheet's context line: the beat and the words around the anchor. */
export function askContextLine(film: CompiledFilm, anchor: AskAnchor): string {
  return `${anchor.beat} · “${anchorWords(film, anchor)}”`;
}

// ---------------------------------------------------------------------------
// The cheapest-rung router
// ---------------------------------------------------------------------------

/** The rung a question is answered on, cheapest first: a streamed Answer, a beat replay, an insert clip, or a new side-clip scene. The slowest rung runs only when the router picks it. Change-the-film is never routed: it is an explicit learner action (versions.ts). */
export type AskRung = 'answer' | 'showme' | 'deeper' | 'example';

/** Words that ask for a demonstration on the live scene. */
const SHOW_WORDS = ['show', 'demonstrate', 'demonstration', 'demo', 'replay', 'watch', 'see it', 'again', 'animate', 'move it', 'how does it move'];

/** Words that ask for an insert clip: more than an answer and a replay can carry. */
const DEEPER_WORDS = ['deeper', 'more detail', 'tell me more', 'go deeper', 'full explanation', 'step by step', 'from the start', 'slow down'];

/** Words that ask for another example: a new scene beside the film. The slowest rung, picked only on these words. */
const EXAMPLE_WORDS = ['another example', 'different example', 'a new example', 'other example', 'one more example', 'side by side', 'side-by-side', 'compare with', 'compared to'];

/**
 * Routes a question to its cheapest rung: an Answer first, Show me when a
 * demonstration fits, Explain deeper when it needs an insert, Another example
 * only when it asks for a new scene outright. The fuller need wins over the
 * cheaper match, so "show me another example" takes the side clip, not the
 * replay. Deterministic: the same words always take the same rung.
 */
export function routeQuestion(question: string): AskRung {
  const text = question.toLowerCase();
  if (EXAMPLE_WORDS.some((word) => text.includes(word))) return 'example';
  if (DEEPER_WORDS.some((word) => text.includes(word))) return 'deeper';
  if (SHOW_WORDS.some((word) => text.includes(word))) return 'showme';
  return 'answer';
}

// ---------------------------------------------------------------------------
// The return stack
// ---------------------------------------------------------------------------

/** Most anchors the return stack holds: an insert may nest one question deep. */
export const ASK_RETURN_STACK_MAX = 2;

/**
 * Where interrupted films resume: each insert pushes its anchor, each ending
 * pops back to the anchor word. Nesting allowed to depth 2; a third push is
 * refused, not dropped, so the learner finishes one question first.
 */
export class AskReturnStack {
  private readonly stack: AskAnchor[] = [];

  get depth(): number {
    return this.stack.length;
  }

  peek(): AskAnchor | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  /** Pushes an anchor; false when the stack is full. */
  push(anchor: AskAnchor): boolean {
    if (this.stack.length >= ASK_RETURN_STACK_MAX) return false;
    this.stack.push(anchor);
    return true;
  }

  pop(): AskAnchor | null {
    return this.stack.pop() ?? null;
  }

  clear(): void {
    this.stack.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Insert clips
// ---------------------------------------------------------------------------

/** One insert line: narration, its length, and values the live scene moves to. */
export interface InsertLine {
  readonly say: string;
  readonly seconds: number;
  readonly set?: Readonly<Record<string, number>>;
}

/** An Explain-deeper clip, pinned to the anchor it interrupted. */
export interface InsertClip {
  readonly id: string;
  readonly anchor: AskAnchor;
  readonly lines: readonly InsertLine[];
  readonly seconds: number;
}

/** Most lines one insert may carry. */
export const INSERT_MAX_LINES = 4;

/** Longest one insert line may be spoken. */
export const INSERT_MAX_LINE_SECONDS = 30;

/** Shortest one insert line may be: captions need a frame to land. */
export const INSERT_MIN_LINE_SECONDS = 1;

/** The short beat between an insert's end and the film's resume. */
export const BACK_TO_FILM_SECONDS = 1.5;

/**
 * Validates a generated insert against its film: pinned to a beat that
 * exists, lines short and bounded, set keys the scene's own parameters.
 */
export function validateInsertClip(
  input: unknown,
  film: CompiledFilm,
  params: ReadonlySet<string>,
): { readonly ok: true; readonly clip: InsertClip } | { readonly ok: false; readonly problems: readonly string[] } {
  const problems: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, problems: ['The insert must be an object'] };
  const { id, anchor, lines } = input as { id?: unknown; anchor?: unknown; lines?: unknown };
  // Unasked-for ids are unique per clip, never derived from the lines alone:
  // two askers asking the same words — or one asker twice — must not share an
  // insert, or promotion cannot tell whose is whose.
  const clipId = typeof id === 'string' && id !== '' ? id.slice(0, 80) : `insert-${Math.abs(hashLines(lines))}-${Math.random().toString(36).slice(2, 10)}`;
  if (typeof anchor !== 'object' || anchor === null) return { ok: false, problems: ['The insert needs the anchor it interrupted'] };
  const pinned = anchor as Partial<AskAnchor>;
  const beat = film.beats.find((candidate) => candidate.id === pinned.beat && candidate.sceneId === pinned.scene);
  if (pinned.film !== film.id || pinned.version !== film.version || !beat) {
    return { ok: false, problems: ['The insert is pinned to a beat this film does not have'] };
  }
  if (!Array.isArray(lines) || lines.length === 0) return { ok: false, problems: ['The insert needs at least one line'] };
  if (lines.length > INSERT_MAX_LINES) return { ok: false, problems: [`The insert has ${lines.length} lines; at most ${INSERT_MAX_LINES}`] };
  const clean: InsertLine[] = [];
  lines.forEach((line, i) => {
    if (typeof line !== 'object' || line === null) {
      problems.push(`Line ${i + 1} must be an object`);
      return;
    }
    const { say, seconds, set } = line as { say?: unknown; seconds?: unknown; set?: unknown };
    if (typeof say !== 'string' || say.trim() === '') {
      problems.push(`Line ${i + 1} needs something to say`);
      return;
    }
    const length = seconds === undefined ? estimateBeatSeconds(say) : Number(seconds);
    if (!Number.isFinite(length) || length < INSERT_MIN_LINE_SECONDS || length > INSERT_MAX_LINE_SECONDS) {
      problems.push(`Line ${i + 1} runs ${typeof seconds === 'number' ? seconds : 'far'}; lines run ${INSERT_MIN_LINE_SECONDS} to ${INSERT_MAX_LINE_SECONDS} seconds`);
      return;
    }
    if (set !== undefined) {
      if (typeof set !== 'object' || set === null || Array.isArray(set)) {
        problems.push(`Line ${i + 1} sets values that are not an object`);
        return;
      }
      for (const [name, value] of Object.entries(set as Record<string, unknown>)) {
        if (!params.has(name)) {
          problems.push(`Line ${i + 1} sets "${name}", which is not a control`);
          return;
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          problems.push(`Line ${i + 1} sets "${name}" to no number`);
          return;
        }
      }
    }
    clean.push({ say: say.trim().replace(/\s+/g, ' '), seconds: length, ...(set ? { set: { ...(set as Record<string, number>) } } : {}) });
  });
  if (problems.length > 0) return { ok: false, problems };
  const askAnchor: AskAnchor = {
    film: film.id,
    version: film.version,
    scene: beat.sceneId,
    beat: beat.id,
    wordIndex: typeof pinned.wordIndex === 'number' ? Math.min(Math.max(Math.floor(pinned.wordIndex), 0), Math.max(0, beat.words.length - 1)) : 0,
    controlValues: {},
    readouts: [],
  };
  return { ok: true, clip: { id: clipId, anchor: askAnchor, lines: clean, seconds: clean.reduce((total, line) => total + line.seconds, 0) } };
}

function hashLines(lines: unknown): number {
  const text = JSON.stringify(lines ?? null) ?? '';
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return hash;
}

/** What an insert player needs from the film: seek, play and pause. The controller satisfies it. */
export interface InsertHost {
  readonly time: number;
  readonly isPlaying: boolean;
  seek(seconds: number): void;
  play(): void;
  pause(): void;
}

export type InsertPhase = 'insert' | 'back' | 'done';

export type InsertEvent =
  | { readonly type: 'line'; readonly index: number; readonly line: InsertLine }
  | { readonly type: 'back' }
  | { readonly type: 'resume'; readonly anchor: AskAnchor; readonly seconds: number };

/**
 * Plays an insert over a paused film: its lines in order, then the short
 * back-to-film beat, then an auto-resume at the anchor word. Back now skips
 * straight to the resume. Line sets move the live scene's values; the resume
 * seeks the anchor, which replays the film's own values there.
 */
export class InsertPlayer {
  private phase: InsertPhase = 'insert';
  private lineIndex = 0;
  private elapsed = 0;
  private started = false;
  private readonly anchorSeconds: number | null;
  private readonly listeners = new Set<(event: InsertEvent) => void>();

  constructor(
    private readonly host: InsertHost,
    private readonly film: CompiledFilm,
    private readonly clip: InsertClip,
    private readonly options: {
      readonly onEvent?: (event: InsertEvent) => void;
      readonly applySet?: (set: Readonly<Record<string, number>>) => void;
      /**
       * False for a nested insert: it ends by emitting resume without
       * seeking or playing, so the outer insert carries on. The bottom
       * insert resumes the film itself.
       */
      readonly resumeToFilm?: boolean;
    } = {},
  ) {
    this.anchorSeconds = resolveAskAnchor(film, clip.anchor);
    if (options.onEvent) this.listeners.add(options.onEvent);
  }

  on(listener: (event: InsertEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: InsertEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  get currentPhase(): InsertPhase {
    return this.phase;
  }

  get currentLine(): InsertLine | null {
    return this.phase === 'insert' ? (this.clip.lines[this.lineIndex] ?? null) : null;
  }

  get currentLineIndex(): number {
    return this.lineIndex;
  }

  /** Seconds left before the film resumes: the insert's rest plus the back-to-film beat. */
  get remaining(): number {
    if (this.phase === 'done') return 0;
    const rest = this.clip.lines.slice(this.lineIndex).reduce((total, line) => total + line.seconds, 0) - this.elapsed;
    return Math.max(0, rest + (this.phase === 'insert' ? BACK_TO_FILM_SECONDS : 0));
  }

  /** Starts the insert, pausing the film. False when its anchor no longer resolves: the film plays on instead. */
  play(): boolean {
    if (this.anchorSeconds === null) {
      this.phase = 'done';
      if (this.options.resumeToFilm !== false) this.host.play();
      else this.emit({ type: 'resume', anchor: this.clip.anchor, seconds: this.host.time });
      return false;
    }
    this.started = true;
    this.host.pause();
    this.applyLine();
    this.emit({ type: 'line', index: 0, line: this.clip.lines[0]! });
    return true;
  }

  /** Advances the insert by seconds; the host ticks or polls while it runs. */
  tick(dt: number): void {
    if (!this.started || this.phase === 'done' || !(dt > 0)) return;
    this.elapsed += dt;
    if (this.phase === 'back') {
      if (this.elapsed >= BACK_TO_FILM_SECONDS) this.resume();
      return;
    }
    for (;;) {
      const line = this.clip.lines[this.lineIndex];
      if (!line) {
        this.toBack();
        return;
      }
      if (this.elapsed < line.seconds) return;
      this.elapsed -= line.seconds;
      this.lineIndex++;
      const next = this.clip.lines[this.lineIndex];
      if (!next) {
        this.toBack();
        return;
      }
      this.applyLine();
      this.emit({ type: 'line', index: this.lineIndex, line: next });
    }
  }

  /** Back now: skips the insert's rest and resumes at the anchor word. */
  skipToFilm(): void {
    if (!this.started || this.phase === 'done') return;
    this.resume();
  }

  private applyLine(): void {
    const set = this.clip.lines[this.lineIndex]?.set;
    if (set) this.options.applySet?.(set);
  }

  private toBack(): void {
    this.phase = 'back';
    this.elapsed = 0;
    this.emit({ type: 'back' });
  }

  private resume(): void {
    this.phase = 'done';
    const seconds = this.anchorSeconds ?? this.host.time;
    // A nested insert ends back in its outer insert; only the bottom one seeks the film.
    if (this.options.resumeToFilm !== false) {
      this.host.seek(seconds);
      this.host.play();
    }
    this.emit({ type: 'resume', anchor: this.clip.anchor, seconds });
  }
}

// ---------------------------------------------------------------------------
// Question markers
// ---------------------------------------------------------------------------

/** A question asked in the film, pinned where it was asked for the scrubber and the transcript. */
export interface AskMarker {
  readonly anchor: AskAnchor;
  readonly question: string;
  readonly askedAt: number;
}

/** A marker's film seconds now: resolved from its beat and word, so re-timed audio moves it along. */
export function markerSeconds(film: CompiledFilm, marker: AskMarker): number | null {
  return resolveAskAnchor(film, marker.anchor);
}

