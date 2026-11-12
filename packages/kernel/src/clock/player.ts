/**
 * The player (animation-time design 3 and 4): play, pause, seek, frame steps, speed, loops and time sources over one
 * figure's clock `t`.
 *
 * Pure: the host gives the player a time source and calls `frame(now)` from its one animation-frame loop while
 * `needsFrame()` is true. The player never reads a clock or schedules anything itself, so the kernel stays free of
 * timers. Values come from `t`, never from how many frames ran, so the same `t` always gives the same figure.
 */
import type { ErrorObject, Notice } from '../contracts/errors';
import { err } from '../errors/table';
import { makeNotice } from '../errors/notices';
import type { Figure } from '../graph/figure';

export type PlayMode = 'stopped' | 'playing' | 'paused';
export type ClockSourceKind = 'wall' | 'external';
export type SeekWhy = 'user' | 'beat' | 'script';

/** Seconds on a monotonic clock. An `external` source is the audio clock while the teacher's voice plays. */
export interface ClockSource {
  now(): number;
}

export interface PlayerLoop {
  readonly from: number;
  readonly to: number;
}

export interface PlayerState {
  readonly mode: PlayMode;
  /** Film time in seconds. */
  readonly t: number;
  /** Speed multiplier; its sign is the direction. */
  readonly rate: number;
  /** Seconds, `Infinity` without `@clock`. */
  readonly duration: number;
  readonly loop: PlayerLoop | null;
  readonly source: ClockSourceKind;
}

export type PlayerEvent =
  | { readonly kind: 'frame'; readonly t: number }
  | { readonly kind: 'mode'; readonly mode: PlayMode }
  | { readonly kind: 'seek'; readonly t: number; readonly why: SeekWhy }
  | { readonly kind: 'beat'; readonly index: number }
  | { readonly kind: 'end' }
  | { readonly kind: 'behind'; readonly lag: number };

/** Work an area does each time the clock moves, before the pass (slider animation, traces). */
export type FrameTicker = (figure: Figure, t: number, how: 'frame' | 'seek') => void;

const TICKERS: FrameTicker[] = [];

/** An area registers the work it does when the clock moves. Registered once. */
export function registerFrameTicker(ticker: FrameTicker): void {
  if (!TICKERS.includes(ticker)) TICKERS.push(ticker);
}

/** The largest frame step, in seconds of source time: a hidden tab or a long pause gives one capped step. */
export const MAX_FRAME_DELTA = 0.1;
/** A frame step of `stepFrames` is 1/60 s of film time, whatever the monitor. */
export const FRAME_STEP = 1 / 60;
/** The clamp firing this many frames in a row reports that the figure fell behind the voice. */
const BEHIND_FRAMES = 3;
const RATE_MIN = 0.1;
const RATE_MAX = 4;

const AT = { line: 0, col: 1, endCol: 1 } as const;

export class Player {
  private modeNow: PlayMode = 'stopped';
  private tNow: number;
  private rateNow = 1;
  private loopNow: PlayerLoop | null = null;
  private sourceKind: ClockSourceKind;
  private last: number | undefined;
  private clampRun = 0;
  private readonly listeners = new Set<(e: PlayerEvent) => void>();
  /** Notices the last call gave (a clamped seek). */
  notices: Notice[] = [];

  constructor(
    readonly figure: Figure,
    private source: ClockSource,
    kind: ClockSourceKind = 'wall',
  ) {
    this.sourceKind = kind;
    this.tNow = figure.clock().t;
  }

  get state(): PlayerState {
    return { mode: this.modeNow, t: this.tNow, rate: this.rateNow, duration: this.range().to, loop: this.loopNow, source: this.sourceKind };
  }

  /** True while the host should keep calling `frame` (zero idle cost otherwise). */
  needsFrame(): boolean {
    return this.modeNow === 'playing';
  }

  /** The beat start times the figure was given, in seconds. */
  get beats(): readonly number[] {
    return this.figure.beats();
  }

  subscribe(fn: (e: PlayerEvent) => void): () => void {
    if (typeof fn === 'function') this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  play(): void {
    if (this.modeNow === 'playing') return;
    const { from, to } = this.range();
    // play at the end starts again from the beginning (or the loop's start)
    if (this.rateNow > 0 && this.tNow >= to) this.moveTo(this.loopNow?.from ?? from, 'seek');
    if (this.rateNow < 0 && this.tNow <= from) this.moveTo(this.loopNow?.to ?? to, 'seek');
    this.last = this.readSource();
    this.clampRun = 0;
    this.setMode('playing');
  }

  pause(): void {
    if (this.modeNow === 'paused') return;
    this.setMode('paused');
  }

  toggle(): void {
    if (this.modeNow === 'playing') this.pause();
    else this.play();
  }

  /** Back to `stopped` at the start of the film. */
  stop(): void {
    this.moveTo(this.range().from, 'seek');
    this.setMode('stopped');
  }

  /** Sets `t` and runs one pass; the frames in between are not needed. A time outside the film is clamped. */
  seek(t: number, why: SeekWhy = 'user'): PlayerState | ErrorObject {
    this.notices = [];
    if (typeof t !== 'number' || Number.isNaN(t)) {
      return err('bad_argument', AT, { command: 'seek', why: 'the time must be a number' }, { recovery: 'fix_line', fingerprintKey: 'seek' });
    }
    const { from, to } = this.range();
    const used = Math.min(to, Math.max(from, t));
    if (used !== t) this.notices.push(makeNotice('seek_clamped', { asked: t, used }));
    this.moveTo(used, 'seek');
    if (this.modeNow === 'playing') this.last = this.readSource();
    this.emit({ kind: 'seek', t: this.tNow, why });
    return this.state;
  }

  /** Pauses, then moves `t` by `n` frames of 1/60 s. */
  stepFrames(n: number): PlayerState | ErrorObject {
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      return err('bad_argument', AT, { command: 'stepFrames', why: 'the frame count must be a number' }, { recovery: 'fix_line', fingerprintKey: 'stepFrames' });
    }
    this.pause();
    return this.seek(this.tNow + Math.trunc(n) * FRAME_STEP, 'user');
  }

  /** The speed: from 0.1 to 4 times, forward or backward. */
  setRate(r: number): PlayerState | ErrorObject {
    const a = Math.abs(r);
    if (typeof r !== 'number' || !Number.isFinite(r) || a < RATE_MIN || a > RATE_MAX) {
      return err('bad_argument', AT, { command: 'setRate', why: `the speed must be from ${RATE_MIN} to ${RATE_MAX}, forward or backward` }, {
        hint: 'Use a speed such as 0.5, 1, 2 or -1.',
        recovery: 'fix_line',
        fingerprintKey: 'setRate',
      });
    }
    this.rateNow = r;
    return this.state;
  }

  /** A loop inside the film, or `null` for none. */
  setLoop(l: PlayerLoop | null): PlayerState | ErrorObject {
    if (l === null) {
      this.loopNow = null;
      return this.state;
    }
    const { from, to } = this.range();
    if (typeof l !== 'object' || !Number.isFinite(l.from) || !Number.isFinite(l.to) || l.from >= l.to || l.from < from || l.to > to) {
      return err('bad_argument', AT, { command: 'setLoop', why: 'a loop needs two times inside the film, the first before the second' }, {
        recovery: 'fix_line',
        fingerprintKey: 'setLoop',
      });
    }
    this.loopNow = { from: l.from, to: l.to };
    return this.state;
  }

  /** Changes the time source without a jump in `t`: the next frame measures from the new source's reading. */
  setSource(source: ClockSource, kind: ClockSourceKind): void {
    if (!source || typeof source.now !== 'function') return;
    this.source = source;
    this.sourceKind = kind;
    this.last = this.readSource();
  }

  /** One frame of the host's loop. `now` is the source's reading; without it the player reads the source. */
  frame(now?: number): PlayerState {
    this.notices = [];
    if (this.modeNow !== 'playing') return this.state;
    const reading = typeof now === 'number' && Number.isFinite(now) ? now : this.readSource();
    const raw = this.last === undefined ? 0 : reading - this.last;
    this.last = reading;
    const clamped = raw > MAX_FRAME_DELTA;
    this.clampRun = clamped ? this.clampRun + 1 : 0;
    if (this.clampRun === BEHIND_FRAMES) this.emit({ kind: 'behind', lag: raw });
    const dt = Math.min(MAX_FRAME_DELTA, Math.max(0, raw)) * this.rateNow;
    let next = this.tNow + dt;
    const { from, to } = this.range();
    const lo = this.loopNow?.from ?? from;
    const hi = this.loopNow?.to ?? to;
    let ended = false;
    if (dt > 0 && next >= hi) {
      if (this.loopNow) next = lo + ((next - lo) % (hi - lo));
      else {
        next = hi;
        ended = true;
      }
    } else if (dt < 0 && next <= lo) {
      if (this.loopNow) next = hi - ((hi - next) % (hi - lo));
      else {
        next = lo;
        ended = true;
      }
    }
    this.moveTo(next, 'frame');
    this.emit({ kind: 'frame', t: this.tNow });
    if (ended) {
      this.emit({ kind: 'end' });
      this.setMode('paused');
    }
    return this.state;
  }

  /* ------------------------------ inside ------------------------------ */

  private range(): { from: number; to: number } {
    return this.figure.clockRange();
  }

  private readSource(): number {
    try {
      const v = this.source.now();
      return typeof v === 'number' && Number.isFinite(v) ? v : (this.last ?? 0);
    } catch {
      return this.last ?? 0;
    }
  }

  /** Moves the figure's clock, lets the areas do their per-frame work, runs one pass and reports a beat change. */
  private moveTo(t: number, how: 'frame' | 'seek'): void {
    const beatBefore = this.figure.clock().beat;
    this.figure.setClock(t, { flush: false });
    this.tNow = this.figure.clock().t;
    for (const tick of TICKERS) {
      try {
        tick(this.figure, this.tNow, how);
      } catch {
        // an area's broken ticker must not stop the clock
      }
    }
    this.figure.flush();
    const beat = this.figure.clock().beat;
    if (beat !== beatBefore && this.beats.length > 0) this.emit({ kind: 'beat', index: beat });
  }

  private setMode(mode: PlayMode): void {
    if (this.modeNow === mode) return;
    this.modeNow = mode;
    this.emit({ kind: 'mode', mode });
  }

  private emit(e: PlayerEvent): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(e);
      } catch {
        // a listener that throws does not stop the others
      }
    }
  }
}

const PLAYERS = new WeakMap<Figure, Player>();

/** The figure's player, made on first use. A host that has a real time source passes it the first time. */
export function playerOf(figure: Figure, source?: ClockSource, kind: ClockSourceKind = 'wall'): Player {
  let p = PLAYERS.get(figure);
  if (!p) {
    // without a source the host passes each frame's reading to `frame(now)`
    p = new Player(figure, source ?? { now: () => 0 }, kind);
    PLAYERS.set(figure, p);
  } else if (source) p.setSource(source, kind);
  return p;
}
