/**
 * The sound engine (sound design 4; .kiro/specs/sound R4): one per page. Each figure has a channel that is handed what
 * plays now (`soundsAt` from the kernel) once a frame; the engine keeps one voice per playing sound, ramps every change
 * over 10 ms, starts and ends at silence, fades a paused figure out over 50 ms, and caps each figure at 8 voices. Sound is
 * off until `enable()` runs from a click: that click is the gesture the browser needs.
 *
 * The audio itself is a `Backend`. `ToneBackend` (Tone.js, loaded on demand) is the real one; tests pass their own.
 */
import type { PlayingSound, SoundFrame } from '@incantly/kernel';

export const RAMP_S = 0.01;
export const PAUSE_FADE_S = 0.05;
export const VOICES_PER_FIGURE = 8;

export interface VoiceParams {
  readonly frequency?: number;
  readonly gain: number;
  readonly pan: number;
  readonly wave?: PlayingSound['wave'];
}

export interface Voice {
  /** Moves to these values over `rampS` seconds. */
  set(p: VoiceParams, rampS: number): void;
  /** Fades to silence over `fadeS` seconds and frees itself. */
  stop(fadeS: number): void;
}

export interface Backend {
  /** Starts audio; must run inside a user gesture. Rejects when the browser refuses. */
  start(): Promise<void>;
  /** A new voice at silence; `set` brings it in. */
  voice(sound: PlayingSound): Voice;
  setMaster(gain: number, rampS: number): void;
  /** The output level now, 0 to 1, for the speaker's bars. */
  level(): number;
  close(): void;
}

export type EngineState = 'off' | 'starting' | 'on' | 'blocked' | 'unavailable';

export interface EngineProblem {
  readonly kind: 'audio_blocked' | 'audio_unavailable';
  readonly message: string;
}

export interface Channel {
  /** What plays now. Call once a frame. */
  update(frame: SoundFrame): void;
  /** The figure was paused by the scheduler or left the screen: fade out over 50 ms. */
  pause(): void;
  resume(): void;
  /** True when the figure has any sound (the speaker shows). */
  hasSound(): boolean;
  dispose(): void;
}

type Listener = (state: EngineState) => void;

const params = (s: PlayingSound): VoiceParams => ({ ...(s.frequency !== undefined ? { frequency: s.frequency } : {}), gain: s.gain, pan: s.pan, ...(s.wave ? { wave: s.wave } : {}) });

export class SoundEngine {
  private stateNow: EngineState = 'off';
  private backend: Backend | undefined;
  private readonly channels = new Set<ChannelImpl>();
  private volume = 0.8;
  private readonly listeners = new Set<Listener>();
  problem: EngineProblem | undefined;

  /** `load` brings in the backend (a dynamic import of Tone.js); it runs the first time sound is turned on. */
  constructor(private readonly load: () => Promise<Backend>) {}

  get state(): EngineState {
    return this.stateNow;
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(s: EngineState): void {
    this.stateNow = s;
    for (const fn of [...this.listeners]) fn(s);
  }

  /** Turns sound on. Call from a click or a key press (the browser's gesture rule). */
  async enable(): Promise<EngineState> {
    if (this.stateNow === 'on' || this.stateNow === 'unavailable') return this.stateNow;
    this.set('starting');
    try {
      this.backend ??= await this.load();
    } catch {
      this.problem = { kind: 'audio_unavailable', message: 'Sound is not available in this browser.' };
      this.set('unavailable');
      return this.stateNow;
    }
    try {
      await this.backend.start();
    } catch {
      this.problem = { kind: 'audio_blocked', message: 'The browser did not allow sound yet. Tap to hear.' };
      this.set('blocked');
      return this.stateNow;
    }
    this.problem = undefined;
    this.backend.setMaster(this.volume, RAMP_S);
    this.set('on');
    return this.stateNow;
  }

  /** Turns sound off: every voice fades out. */
  disable(): void {
    for (const c of this.channels) c.silence(RAMP_S);
    if (this.stateNow !== 'unavailable') this.set('off');
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.stateNow === 'on') this.backend?.setMaster(this.volume, RAMP_S);
  }

  get masterVolume(): number {
    return this.volume;
  }

  level(): number {
    return this.stateNow === 'on' ? (this.backend?.level() ?? 0) : 0;
  }

  /** A figure's channel. */
  channel(): Channel {
    const c = new ChannelImpl(this);
    this.channels.add(c);
    return c;
  }

  /** @internal */
  voiceFor(s: PlayingSound): Voice | undefined {
    return this.stateNow === 'on' ? this.backend?.voice(s) : undefined;
  }

  /** @internal */
  drop(c: ChannelImpl): void {
    this.channels.delete(c);
  }

  dispose(): void {
    for (const c of [...this.channels]) c.dispose();
    this.backend?.close();
    this.backend = undefined;
    this.set('off');
  }
}

class ChannelImpl implements Channel {
  private readonly voices = new Map<string, Voice>();
  private paused = false;
  private any = false;
  private last: SoundFrame | undefined;

  constructor(private readonly engine: SoundEngine) {}

  hasSound(): boolean {
    return this.any;
  }

  update(frame: SoundFrame): void {
    this.any = frame.hasSound;
    this.last = frame;
    if (this.paused || this.engine.state !== 'on') {
      if (this.voices.size > 0) this.silence(RAMP_S);
      return;
    }
    const now = frame.sounds.filter((s) => s.gain > 0).slice(0, VOICES_PER_FIGURE);
    const keys = new Set(now.map((s) => s.key));
    for (const [k, v] of this.voices) {
      if (!keys.has(k)) {
        v.stop(RAMP_S);
        this.voices.delete(k);
      }
    }
    for (const s of now) {
      let v = this.voices.get(s.key);
      if (!v) {
        v = this.engine.voiceFor(s);
        if (!v) continue;
        this.voices.set(s.key, v);
      }
      v.set(params(s), RAMP_S);
    }
  }

  /** @internal */
  silence(fadeS: number): void {
    for (const v of this.voices.values()) v.stop(fadeS);
    this.voices.clear();
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.silence(PAUSE_FADE_S);
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.last) this.update(this.last);
  }

  dispose(): void {
    this.silence(RAMP_S);
    this.engine.drop(this);
  }
}

let shared: SoundEngine | undefined;

/** The page's one engine (design 4.3), with Tone.js loaded on first use. */
export function pageEngine(): SoundEngine {
  shared ??= new SoundEngine(async () => {
    if (typeof globalThis.AudioContext !== 'function' && typeof (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext !== 'function') {
      throw new Error('no Web Audio');
    }
    const m = await import('./tone-backend');
    return m.createToneBackend();
  });
  return shared;
}
