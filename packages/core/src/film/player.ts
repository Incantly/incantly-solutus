import type { FilmController, FilmEvent } from '../runtime/film';
import { markerSeconds, type AskAnchor, type AskMarker } from './ask';
import { wordStarts, type CompiledBeat, type CompiledFilm, type FilmAnchor } from './storyboard';

/**
 * The player model: everything a film player shows, without the DOM. The
 * playground page binds chrome to it; tests drive it headlessly with a
 * ManualClock. Transport, speed and volume go through the controller; captions,
 * transcript, chapters and the timeline debug view read here.
 */

export type CaptionSize = 'sm' | 'md' | 'lg';

/**
 * A bookmarked moment: the film, its version, the beat and the word sounding
 * there. Beat ids and word indexes, never seconds, so re-timed audio moves
 * the bookmark along with its word. In-memory: the page never persists the
 * label, which is the learner's own text.
 */
export interface FilmBookmark {
  readonly id: string;
  readonly film: string;
  readonly version: number;
  readonly beat: string;
  readonly wordIndex: number;
  readonly label: string;
}

export interface PlayerCaption {
  readonly beat: string;
  readonly say: string;
  readonly short: string | null;
  readonly title: { readonly text: string; readonly kind: 'card' | 'lower' } | null;
  readonly start: number;
  readonly seconds: number;
  /** The beat's words with their starts in film seconds, for the karaoke highlight. */
  readonly words: readonly string[];
  readonly wordStarts: readonly number[];
}

export interface PlayerState {
  readonly playing: boolean;
  readonly time: number;
  readonly duration: number;
  readonly beat: string | null;
  readonly caption: PlayerCaption | null;
  readonly captionsOn: boolean;
  readonly captionSize: CaptionSize;
  readonly speed: number;
  readonly volume: number;
}

export type PlayerEvent = FilmEvent | { readonly type: 'chrome' };

/** Caption size multipliers over the solver's font. */
export const CAPTION_SCALES: Readonly<Record<CaptionSize, number>> = { sm: 0.85, md: 1, lg: 1.25 };

/** Most word ticks the timeline draws per beat; a runaway say cannot flood the lane. */
export const TIMELINE_WORD_TICKS_PER_BEAT = 200;

export class PlayerModel {
  private captionsOn = true;
  private captionSize: CaptionSize = 'md';
  private speed = 1;
  private volume = 0.5;
  private selected: string | null = null;
  private readonly marks: AskMarker[] = [];
  private looped: string | null = null;
  private readonly bookmarksById = new Map<string, FilmBookmark>();
  private bookmarkCounter = 0;
  private readonly listeners = new Set<(event: PlayerEvent) => void>();

  constructor(
    private readonly controller: FilmController,
    private film: CompiledFilm,
  ) {
    this.controller.on((event) => this.emit(event));
  }

  on(listener: (event: PlayerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Follows the controller onto a re-timed film; call it after controller.retime. */
  retime(film: CompiledFilm): void {
    this.film = film;
    this.emit({ type: 'chrome' });
  }

  private emit(event: PlayerEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  get state(): PlayerState {
    const beat = this.controller.currentBeat;
    return {
      playing: this.controller.isPlaying,
      time: this.controller.time,
      duration: this.controller.duration,
      beat: beat?.id ?? null,
      caption: beat && this.captionsOn ? toCaption(beat) : null,
      captionsOn: this.captionsOn,
      captionSize: this.captionSize,
      speed: this.speed,
      volume: this.volume,
    };
  }

  get progress(): number {
    const duration = this.controller.duration;
    return duration > 0 ? Math.min(1, Math.max(0, this.controller.time / duration)) : 0;
  }

  play(): void {
    this.controller.play();
  }

  pause(): void {
    this.controller.pause();
  }

  toggle(): void {
    if (this.controller.isPlaying) this.controller.pause();
    else this.controller.play();
  }

  seek(seconds: number): void {
    this.controller.seek(seconds);
  }

  seekBeat(id: string): boolean {
    return this.controller.seekBeat(id);
  }

  seekAnchor(anchor: FilmAnchor): boolean {
    return this.controller.seekAnchor(anchor);
  }

  nextBeat(): boolean {
    const beats = this.film.beats;
    const at = beats.findIndex((beat) => beat.id === this.controller.currentBeat?.id);
    const next = at >= 0 ? beats[at + 1] : beats[0];
    if (!next) return false;
    this.controller.seek(next.start);
    return true;
  }

  prevBeat(): boolean {
    const beats = this.film.beats;
    const at = beats.findIndex((beat) => beat.id === this.controller.currentBeat?.id);
    const prev = at > 0 ? beats[at - 1] : beats[0];
    if (!prev) return false;
    this.controller.seek(prev.start);
    return true;
  }

  setSpeed(value: number): void {
    this.speed = value;
    this.controller.setSpeed(value);
    this.emit({ type: 'chrome' });
  }

  setVolume(value: number): void {
    this.volume = Math.min(1, Math.max(0, value));
    this.controller.setVolume(this.volume);
    this.emit({ type: 'chrome' });
  }

  setCaptions(on: boolean): void {
    this.captionsOn = on;
    this.emit({ type: 'chrome' });
  }

  setCaptionSize(size: CaptionSize): void {
    this.captionSize = size;
    this.emit({ type: 'chrome' });
  }

  selectBeat(id: string | null): void {
    this.selected = id;
    this.emit({ type: 'chrome' });
  }

  get selectedBeat(): CompiledBeat | null {
    if (this.selected) return (this.film.beats.find((beat) => beat.id === this.selected) ?? this.controller.currentBeat) || null;
    return this.controller.currentBeat;
  }

  transcript() {
    return this.controller.transcript();
  }

  chapters() {
    return this.controller.chapters();
  }

  /** Word starts for the timeline's narration lane, in film seconds, capped per beat. */
  wordTicks(beatId: string): readonly number[] {
    const beat = this.film.beats.find((candidate) => candidate.id === beatId);
    return beat ? wordStarts(beat).slice(0, TIMELINE_WORD_TICKS_PER_BEAT) : [];
  }

  /**
   * The word sounding at a film time: the last one started, or -1 before the
   * first. The highlight follows the same starts the audio was timed with, so
   * caption and audio stay within a frame of each other.
   */
  wordIndexAt(beatId: string, time: number): number {
    const beat = this.film.beats.find((candidate) => candidate.id === beatId);
    if (!beat) return -1;
    const starts = wordStarts(beat);
    let index = -1;
    starts.forEach((start, i) => {
      if (time + 1e-9 >= start) index = i;
    });
    return index;
  }

  /** The word sounding now in the current beat, for the karaoke highlight. */
  get currentWordIndex(): number {
    const beat = this.controller.currentBeat;
    return beat ? this.wordIndexAt(beat.id, this.controller.time) : -1;
  }

  /** Evenly spaced film times for the scrubber's thumbnails. */
  thumbTimes(count: number): number[] {
    const duration = this.controller.duration;
    if (!(count > 0) || !(duration > 0)) return [];
    if (count === 1) return [duration / 2];
    return Array.from({ length: count }, (_, i) => (duration * (i + 0.5)) / count);
  }

  ask(question: string) {
    return this.controller.ask(question);
  }

  /** Pins the film where it stands for the ask sheet, pausing at the current word. */
  anchorNow() {
    return this.controller.anchorNow();
  }

  seekAskAnchor(anchor: AskAnchor): boolean {
    return this.controller.seekAskAnchor(anchor);
  }

  /** Pins a question marker where it was asked, for the scrubber and the transcript. */
  addMarker(anchor: AskAnchor, question = ''): void {
    this.marks.push({ anchor, question, askedAt: Date.now() });
    this.emit({ type: 'chrome' });
  }

  get markers(): readonly AskMarker[] {
    return this.marks;
  }

  /** Every marker's film seconds now, re-timing along with the audio. */
  markerTimes(): number[] {
    const times: number[] = [];
    for (const marker of this.marks) {
      const seconds = markerSeconds(this.film, marker);
      if (seconds !== null) times.push(seconds);
    }
    return times;
  }

  /** The markers pinned to one beat, for the transcript. */
  markersForBeat(beatId: string): readonly AskMarker[] {
    return this.marks.filter((marker) => marker.anchor.beat === beatId);
  }

  clearMarkers(): void {
    if (this.marks.length === 0) return;
    this.marks.length = 0;
    this.emit({ type: 'chrome' });
  }

  /**
   * Loops one beat: while playing, the beat's end seeks back to its start.
   * Null, or an unknown beat, loops nothing. The page calls applyLoop once
   * per frame after the controller's poll or tick.
   */
  loopBeat(id: string | null): void {
    this.looped = id && this.film.beats.some((beat) => beat.id === id) ? id : null;
    this.emit({ type: 'chrome' });
  }

  get loopedBeat(): string | null {
    return this.looped;
  }

  /** Seeks back to the looped beat's start when play crossed its end. */
  applyLoop(): void {
    if (!this.looped || !this.controller.isPlaying) return;
    const beat = this.film.beats.find((candidate) => candidate.id === this.looped);
    if (!beat) {
      this.looped = null;
      return;
    }
    if (this.controller.time + 1e-9 >= beat.start + beat.seconds) this.controller.seek(beat.start);
  }

  /**
   * Bookmarks the moment on screen: the current beat and the word sounding
   * there. Null before the first beat. The label defaults to the beat id.
   */
  addBookmark(label?: string): FilmBookmark | null {
    const beat = this.controller.currentBeat;
    if (!beat) return null;
    const wordIndex = Math.max(0, this.wordIndexAt(beat.id, this.controller.time));
    this.bookmarkCounter++;
    const bookmark: FilmBookmark = {
      id: `bookmark-${this.bookmarkCounter}`,
      film: this.film.id,
      version: this.film.version,
      beat: beat.id,
      wordIndex,
      label: label?.trim() === '' || label === undefined ? beat.id : label.trim().slice(0, 80),
    };
    this.bookmarksById.set(bookmark.id, bookmark);
    this.emit({ type: 'chrome' });
    return bookmark;
  }

  get bookmarks(): readonly FilmBookmark[] {
    return [...this.bookmarksById.values()];
  }

  /** Jumps to a bookmark: its beat, at its word's start. False when it is gone or its film moved on. */
  jumpBookmark(id: string): boolean {
    const bookmark = this.bookmarksById.get(id);
    if (!bookmark || bookmark.film !== this.film.id || bookmark.version !== this.film.version) return false;
    const beat = this.film.beats.find((candidate) => candidate.id === bookmark.beat);
    if (!beat || beat.words.length === 0) return false;
    const index = Math.min(Math.max(bookmark.wordIndex, 0), beat.words.length - 1);
    this.controller.seek(wordStarts(beat)[index] ?? beat.start);
    return true;
  }

  /** Removes a bookmark. False when it was already gone. */
  removeBookmark(id: string): boolean {
    if (!this.bookmarksById.delete(id)) return false;
    this.emit({ type: 'chrome' });
    return true;
  }

  /** The bookmark's film seconds now, re-timing along with the audio. Null when its film moved on. */
  bookmarkTime(id: string): number | null {
    const bookmark = this.bookmarksById.get(id);
    if (!bookmark || bookmark.film !== this.film.id || bookmark.version !== this.film.version) return null;
    const beat = this.film.beats.find((candidate) => candidate.id === bookmark.beat);
    if (!beat || beat.words.length === 0) return null;
    const index = Math.min(Math.max(bookmark.wordIndex, 0), beat.words.length - 1);
    return wordStarts(beat)[index] ?? beat.start;
  }
}

function toCaption(beat: CompiledBeat): PlayerCaption {
  const title = beat.step.title;
  return {
    beat: beat.id,
    say: beat.step.say,
    short: beat.step.short ?? null,
    title: title === undefined ? null : typeof title === 'string' ? { text: title, kind: 'lower' } : { text: title.text, kind: title.kind ?? 'lower' },
    start: beat.start,
    seconds: beat.seconds,
    words: beat.words,
    wordStarts: wordStarts(beat),
  };
}
