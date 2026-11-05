import type { FilmController, FilmEvent } from '../runtime/film';
import { wordStarts, type CompiledBeat, type CompiledFilm, type FilmAnchor } from './storyboard';

/**
 * The player model: everything a film player shows, without the DOM. The
 * playground page binds chrome to it; tests drive it headlessly with a
 * ManualClock. Transport, speed and volume go through the controller; captions,
 * transcript, chapters and the timeline debug view read here.
 */

export type CaptionSize = 'sm' | 'md' | 'lg';

export interface PlayerCaption {
  readonly beat: string;
  readonly say: string;
  readonly short: string | null;
  readonly title: { readonly text: string; readonly kind: 'card' | 'lower' } | null;
  readonly start: number;
  readonly seconds: number;
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
  private readonly listeners = new Set<(event: PlayerEvent) => void>();

  constructor(
    private readonly controller: FilmController,
    private readonly film: CompiledFilm,
  ) {
    this.controller.on((event) => this.emit(event));
  }

  on(listener: (event: PlayerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
  };
}
