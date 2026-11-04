import { attachAudio, type CompiledFilm } from '@incantly/core';
import { LimitKeeper, type Refusal } from './limits';
import {
  StubNarrator,
  TtsError,
  contentHash,
  estimateWordTimings,
  speechCostUsd,
  timingsSeconds,
  validateWordTimings,
  type Narrator,
  type WordTiming,
} from './tts';

/**
 * The narration pipeline: per-beat speech requests fanned out as beat text
 * streams in, word timings validated before they drive anything, audio stored
 * by content hash beside the film (outside undo history), replies cached by
 * text hash. Failures degrade to estimated lengths and captions: narration
 * never blocks a film, retries at most once, and never loops.
 */

/** One beat's narration: its text, fanned out as it streams in. */
export interface NarrationBeat {
  readonly beatId: string;
  readonly text: string;
}

export interface NarratedBeat {
  readonly beatId: string;
  readonly chars: number;
  /** Seconds of audio, or the estimate when narration degraded. */
  readonly seconds: number;
  /** Word starts in beat seconds: provider timings when valid, text-derived otherwise. */
  readonly starts: readonly number[];
  /** Content hash of the stored audio; null when narration degraded. */
  readonly audioHash: string | null;
  /** Sample rate of the stored audio in Hz. */
  readonly sampleRate: number;
  /** True when the beat stays estimated: refused, failed, or missing key. */
  readonly estimated: boolean;
  /** True when the audio is real but its timings were not, so text-derived starts drive the captions. */
  readonly timingsEstimated: boolean;
  /** True when the line came from the text cache: billed once, not again. */
  readonly cached: boolean;
  readonly refused?: Refusal;
  readonly error?: string;
  readonly ms: number;
}

export interface NarrationRun {
  readonly beats: readonly NarratedBeat[];
  /** Characters billed: successful requests only, since failures consume no credits. */
  readonly chars: number;
  readonly usd: number;
  readonly ms: number;
  readonly msPerBeat: number;
}

export interface NarratedFilm extends NarrationRun {
  /** The film re-timed: narrated beats carry real lengths, degraded beats stay estimated. */
  readonly film: CompiledFilm;
}

/** Most clips the memory audio store keeps. */
export const NARRATION_MAX_CLIPS = 500;

/** Most audio bytes the memory audio store keeps. */
export const NARRATION_MAX_AUDIO_BYTES = 256 * 1024 * 1024;

/** Most lines the memory narration cache keeps. */
export const NARRATION_MAX_CACHED_LINES = 500;

/** Most characters one beat's text may carry through narrateBeats, whatever the caller: the dev endpoint takes the same. */
export const NARRATION_MAX_TEXT_CHARS = 2000;

/** Audio by content hash, beside the film: never inside scene commands or undo history. */
export interface AudioStore {
  put(audio: Uint8Array): string;
  get(hash: string): Uint8Array | undefined;
}

export class MemoryAudioStore implements AudioStore {
  private readonly clips = new Map<string, Uint8Array>();
  private bytes = 0;

  constructor(private readonly options: { readonly maxClips?: number; readonly maxBytes?: number } = {}) {}

  put(audio: Uint8Array): string {
    const hash = contentHash(audio);
    if (!this.clips.has(hash)) {
      this.clips.set(hash, audio.slice());
      this.bytes += audio.length;
      const maxClips = this.options.maxClips ?? NARRATION_MAX_CLIPS;
      const maxBytes = this.options.maxBytes ?? NARRATION_MAX_AUDIO_BYTES;
      while ((this.clips.size > maxClips || this.bytes > maxBytes) && this.clips.size > 0) {
        const oldest = this.clips.keys().next().value!;
        this.bytes -= this.clips.get(oldest)!.length;
        this.clips.delete(oldest);
      }
    } else {
      // Least recently used goes first: a hit moves to the end.
      const clip = this.clips.get(hash)!;
      this.clips.delete(hash);
      this.clips.set(hash, clip);
    }
    return hash;
  }

  get(hash: string): Uint8Array | undefined {
    const clip = this.clips.get(hash);
    if (!clip) return undefined;
    // Least recently used goes first: a hit moves to the end.
    this.clips.delete(hash);
    this.clips.set(hash, clip);
    return clip.slice();
  }

  get size(): number {
    return this.clips.size;
  }

  get byteLength(): number {
    return this.bytes;
  }
}

interface CacheEntry {
  readonly seconds: number;
  readonly words: readonly WordTiming[];
  readonly audioHash: string;
  readonly chars: number;
  readonly sampleRate: number;
}

/** Replies by text hash: the same line narrated once, however many films say it. */
export interface NarrationCache {
  get(key: string): CacheEntry | undefined;
  put(key: string, entry: CacheEntry): void;
}

export class MemoryNarrationCache implements NarrationCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly options: { readonly max?: number } = {}) {}

  get(key: string): CacheEntry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    // Least recently used goes first: a hit moves to the end.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  put(key: string, entry: CacheEntry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
    const max = this.options.max ?? NARRATION_MAX_CACHED_LINES;
    while (this.entries.size > max) this.entries.delete(this.entries.keys().next().value!);
  }

  get size(): number {
    return this.entries.size;
  }
}

/** The cache key for a line: its voice and its normalized text. */
export function narrationKey(text: string, voice: string): string {
  return contentHash(`${voice}\n${text.trim().replace(/\s+/g, ' ')}`);
}

export interface NarrateOptions {
  readonly narrator?: Narrator;
  readonly learnerId?: string;
  /** Spend caps; null narrates uncapped (tests, the stub). */
  readonly limits?: LimitKeeper | null;
  readonly store?: AudioStore;
  readonly cache?: NarrationCache | null;
  readonly voice?: string;
  /** How many speech requests run at once. Default 4. */
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
  /** Called as each beat's narration lands, in completion order. */
  readonly onBeat?: (beat: NarratedBeat) => void;
  readonly now?: () => number;
}

/**
 * A bounded fan-out: beats pushed as their text streams in, at most
 * `concurrency` speech requests running at once. Drain it to wait for every
 * pushed beat.
 */
export class NarrationQueue {
  private readonly order: Array<Promise<NarratedBeat>> = [];
  private running = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly run: (beat: NarrationBeat) => Promise<NarratedBeat>,
    private readonly concurrency: number = 4,
    private readonly onBeat?: (beat: NarratedBeat) => void,
  ) {}

  push(beat: NarrationBeat): Promise<NarratedBeat> {
    const done = this.admit().then(() => this.run(beat));
    this.order.push(done);
    void done.then(
      (narrated) => this.onBeat?.(narrated),
      () => undefined,
    );
    return done;
  }

  /** Every pushed beat's narration, in push order. */
  async drain(): Promise<NarratedBeat[]> {
    return Promise.all(this.order);
  }

  private async admit(): Promise<void> {
    if (this.running < this.concurrency) {
      this.running++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  /** Called by the runner when a beat settles; frees the next waiter. */
  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.running = Math.max(0, this.running - 1);
  }
}

/** Narrates beats as they stream in, without a film. */
export async function narrateBeats(source: Iterable<NarrationBeat> | AsyncIterable<NarrationBeat>, options: NarrateOptions = {}): Promise<NarrationRun> {
  const narrator = options.narrator ?? new StubNarrator();
  const store = options.store ?? new MemoryAudioStore();
  const cache = options.cache === undefined ? new MemoryNarrationCache() : options.cache;
  const voice = options.voice ?? '';
  const now = options.now ?? (() => Date.now());
  const started = now();
  const learnerId = options.learnerId ?? 'anonymous';
  const limits = options.limits ?? null;

  const queue = new NarrationQueue(
    async (beat) => {
      try {
        return await narrateOne(beat, { narrator, store, cache, voice, learnerId, limits, signal: options.signal, now });
      } finally {
        queue.release();
      }
    },
    Math.max(1, options.concurrency ?? 4),
    options.onBeat,
  );
  for await (const beat of source) queue.push(beat);
  const beats = await queue.drain();
  const ms = Math.max(0, now() - started);
  const chars = beats.filter((beat) => !beat.estimated && !beat.cached).reduce((sum, beat) => sum + beat.chars, 0);
  return { beats, chars, usd: speechCostUsd(chars), ms, msPerBeat: beats.length > 0 ? ms / beats.length : 0 };
}

/** Narrates a film's beats and re-times it: narrated beats carry real lengths, degraded beats stay estimated. */
export async function narrateFilm(film: CompiledFilm, options: NarrateOptions = {}): Promise<NarratedFilm> {
  const beats = film.beats.map((beat): NarrationBeat => ({ beatId: beat.id, text: beat.step.say }));
  const run = await narrateBeats(beats, options);
  let retimed = film;
  for (const narrated of run.beats) {
    if (narrated.estimated || narrated.audioHash === null) continue;
    retimed = attachAudio(retimed, narrated.beatId, { seconds: narrated.seconds, words: narrated.starts });
  }
  return { ...run, film: retimed };
}

/** One line of the bench report: the film's narration cost and pace. */
export function summarizeNarration(filmId: string, run: NarrationRun): string {
  const degraded = run.beats.filter((beat) => beat.estimated).length;
  return (
    `film ${filmId}: ${run.beats.length} beats, ${run.chars} speech chars, ` +
    `$${run.usd.toFixed(4)} speech, ${run.msPerBeat.toFixed(1)} ms/beat${degraded > 0 ? `, ${degraded} estimated` : ''}`
  );
}

/** A speech-cap breach as HTTP: 429 with Retry-After, like every other limit. */
export function speechRefusalHttp(refusal: Refusal): { readonly status: 429; readonly headers: Readonly<Record<string, string>>; readonly body: { readonly code: string; readonly message: string } } {
  return { status: 429, headers: { 'retry-after': String(refusal.retryAfterSeconds) }, body: { code: refusal.code, message: refusal.message } };
}

interface OneOptions {
  readonly narrator: Narrator;
  readonly store: AudioStore;
  readonly cache: NarrationCache | null;
  readonly voice: string;
  readonly learnerId: string;
  readonly limits: LimitKeeper | null;
  readonly signal?: AbortSignal;
  readonly now: () => number;
}

/** Settles a speech reservation against what the provider billed: usually the same count. */
function settleSpeech(limits: LimitKeeper | null, learnerId: string, diff: number): void {
  if (diff > 0) limits?.spendSpeech(learnerId, diff);
  else if (diff < 0) limits?.refundSpeech(learnerId, -diff);
}

async function narrateOne(beat: NarrationBeat, options: OneOptions): Promise<NarratedBeat> {
  const started = options.now();
  const ms = () => Math.max(0, options.now() - started);
  const chars = beat.text.length;
  const estimated = estimateWordTimings(beat.text);
  const degraded = (extra: Partial<NarratedBeat>): NarratedBeat => ({
    beatId: beat.beatId,
    chars,
    seconds: timingsSeconds(estimated),
    starts: estimated.map((word) => word.start),
    audioHash: null,
    sampleRate: 8000,
    estimated: true,
    timingsEstimated: true,
    cached: false,
    ms: ms(),
    ...extra,
  });

  // Direct callers get the same text cap as the dev endpoint: overlong lines degrade, unbilled.
  if (beat.text.length > NARRATION_MAX_TEXT_CHARS) return degraded({ error: 'invalid-request' });

  // A cached line costs nothing and spends nothing: it was paid for already.
  const key = narrationKey(beat.text, options.voice);
  const cached = options.cache?.get(key);
  if (cached && options.store.get(cached.audioHash)) {
    return {
      beatId: beat.beatId,
      chars: cached.chars,
      seconds: cached.seconds,
      starts: cached.words.map((word) => word.start),
      audioHash: cached.audioHash,
      sampleRate: cached.sampleRate,
      estimated: false,
      timingsEstimated: false,
      cached: true,
      ms: ms(),
    };
  }
  if (options.limits) {
    const refusal = options.limits.reserveSpeech(options.learnerId, chars);
    if (refusal) return degraded({ refused: refusal });
  }
  let reply;
  try {
    reply = await options.narrator.speak({ text: beat.text, ...(options.voice ? { voice: options.voice } : {}), ...(options.signal ? { signal: options.signal } : {}) });
  } catch (error) {
    // A failed line degrades to its estimate and refunds its reservation: failures consume no credits.
    options.limits?.refundSpeech(options.learnerId, chars);
    return degraded({ error: error instanceof TtsError ? error.kind : 'unknown' });
  }
  if (!Number.isFinite(reply.sampleRate) || reply.sampleRate <= 0) {
    // The speech happened, so its reservation stands; the beat still degrades, since no length can be trusted.
    settleSpeech(options.limits, options.learnerId, reply.chars - chars);
    return degraded({ error: 'protocol' });
  }
  const audioSeconds = reply.audio.length / 2 / reply.sampleRate;
  const valid = validateWordTimings(reply.words, audioSeconds);
  const words = valid.ok && reply.words.length > 0 ? reply.words : estimated;
  const seconds = Math.max(audioSeconds, timingsSeconds(words));
  const audioHash = options.store.put(reply.audio);
  options.cache?.put(key, { seconds, words, audioHash, chars: reply.chars, sampleRate: reply.sampleRate });
  settleSpeech(options.limits, options.learnerId, reply.chars - chars);
  return {
    beatId: beat.beatId,
    chars: reply.chars,
    seconds,
    starts: words.map((word) => word.start),
    audioHash,
    sampleRate: reply.sampleRate,
    estimated: false,
    timingsEstimated: !valid.ok || reply.words.length === 0,
    cached: false,
    ms: ms(),
  };
}
