/**
 * The film mixer: narration, sfx cues and an optional quiet bed, mixed in the
 * SDK. Narration clips attach by content hash as their audio arrives; the
 * controller tells the mixer when a beat starts, and the mixer plays that
 * beat's clip, ducking the bed under speech. Silent until the viewer turns
 * sound on, which doubles as the gesture autoplay rules need. The figure's
 * own sound button and volume stay as they are: the mixer follows the
 * player's volume, and cues keep playing through the scene's note commands.
 */

/** The bed's level under speech and between lines: quiet, and quieter still while narrating. */
export const BED_LEVEL = 0.3;
export const BED_DUCKED_LEVEL = 0.1;

/** Narration plays full; the learner's volume scales the whole mix. */
export const NARRATION_LEVEL = 1;

export interface MixerClip {
  readonly beatId: string;
  readonly hash: string;
  /** Mono 16-bit PCM. */
  readonly pcm: Uint8Array;
  readonly sampleRate: number;
  readonly seconds: number;
}

/**
 * What the mixer needs from audio output: load clips by hash, play one from
 * a beat start, stop on seek and pause, duck the bed, set the volume. The
 * WebAudio backend plays for real; the memory backend records for tests.
 */
export interface MixerBackend {
  load(clip: MixerClip): void;
  /** Plays a loaded clip `offset` seconds in (seeks land mid-line); silent when the clip never loaded. */
  play(hash: string, offset: number): void;
  stop(): void;
  setBedLevel(level: number): void;
  setVolume(volume: number): void;
  /** Starts audio output; the mixer calls it from the viewer's gesture that turns sound on. */
  unlock?(): void;
}

export interface MixerEvent {
  readonly type: 'load' | 'play' | 'stop' | 'bed' | 'volume';
  readonly hash?: string;
  readonly offset?: number;
  readonly level?: number;
}

/** A backend that records every call, for tests and the player page's debug view. */
export class MemoryMixerBackend implements MixerBackend {
  readonly events: MixerEvent[] = [];
  private readonly loaded = new Set<string>();

  load(clip: MixerClip): void {
    this.loaded.add(clip.hash);
    this.events.push({ type: 'load', hash: clip.hash });
  }

  play(hash: string, offset: number): void {
    if (!this.loaded.has(hash)) return;
    this.events.push({ type: 'play', hash, offset });
  }

  stop(): void {
    this.events.push({ type: 'stop' });
  }

  setBedLevel(level: number): void {
    this.events.push({ type: 'bed', level });
  }

  setVolume(volume: number): void {
    this.events.push({ type: 'volume', level: volume });
  }

  plays(): MixerEvent[] {
    return this.events.filter((event) => event.type === 'play');
  }
}

export class FilmMixer {
  private readonly clips = new Map<string, MixerClip>();
  private enabled = false;
  private volume = 0.5;
  private speaking = false;

  constructor(private readonly backend: MixerBackend = new MemoryMixerBackend()) {}

  get isOn(): boolean {
    return this.enabled;
  }

  get clipsAttached(): number {
    return this.clips.size;
  }

  /** Clips arrive with their narration, whether or not sound is on yet. */
  attach(clip: MixerClip): void {
    this.clips.set(clip.beatId, clip);
    this.backend.load(clip);
  }

  clipFor(beatId: string): MixerClip | null {
    return this.clips.get(beatId) ?? null;
  }

  /**
   * Switches film sound on or off. Call it from the viewer's click: silent
   * until then, which is also the gesture a browser needs before it plays
   * anything.
   */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) this.backend.unlock?.();
    else {
      this.speaking = false;
      this.backend.stop();
      this.backend.setBedLevel(BED_LEVEL);
    }
  }

  /** The learner's volume from 0 to 1, following the player's slider. */
  setVolume(volume: number): void {
    const next = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0.5));
    if (next === this.volume) return;
    this.volume = next;
    this.backend.setVolume(next);
  }

  /**
   * A beat started at `offset` seconds into it: its clip plays (when sound is
   * on and the clip arrived) and the bed ducks under the speech. Beats
   * without narration leave the bed up.
   */
  onBeat(beatId: string, offset = 0): void {
    const clip = this.clips.get(beatId);
    if (!this.enabled || !clip) {
      this.speaking = false;
      this.backend.setBedLevel(BED_LEVEL);
      return;
    }
    this.speaking = true;
    this.backend.setBedLevel(BED_DUCKED_LEVEL);
    this.backend.play(clip.hash, Math.min(Math.max(0, offset), clip.seconds));
  }

  /** The line ended: the bed comes back up. The player calls this at the beat's end. */
  onLineEnd(): void {
    if (!this.speaking) return;
    this.speaking = false;
    this.backend.setBedLevel(BED_LEVEL);
  }

  /** Seeks and pauses stop the line; the next beat starts its own. */
  onInterrupt(): void {
    if (!this.enabled) return;
    this.speaking = false;
    this.backend.stop();
    this.backend.setBedLevel(BED_LEVEL);
  }
}

/**
 * A WebAudio backend: narration clips as buffers, an optional quiet bed of
 * soft noise looped underneath, the learner's volume over the mix. Silent
 * without an AudioContext, and output starts only in unlock, which the mixer
 * calls from the viewer's gesture. Every call is logged for the debug view.
 */
export class WebAudioMixerBackend implements MixerBackend {
  readonly events: MixerEvent[] = [];
  private readonly clips = new Map<string, MixerClip>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private bedGain: GainNode | null = null;
  private narration: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private volume = 0.5;

  unlock(): void {
    try {
      const view = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const Context = view.AudioContext ?? view.webkitAudioContext;
      if (!Context) return;
      if (!this.context || this.context.state === 'closed') {
        this.context = new Context();
        this.master = this.context.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.context.destination);
        this.narration = this.context.createGain();
        this.narration.gain.value = NARRATION_LEVEL;
        this.narration.connect(this.master);
        this.startBed();
      }
      if (this.context.state === 'suspended') void this.context.resume();
    } catch {
      this.context = null;
    }
  }

  load(clip: MixerClip): void {
    this.clips.set(clip.hash, clip);
    this.events.push({ type: 'load', hash: clip.hash });
  }

  play(hash: string, offset: number): void {
    this.events.push({ type: 'play', hash, offset });
    const context = this.context;
    if (!context || !this.narration) return;
    const buffer = this.bufferFor(hash);
    if (!buffer) return;
    this.stopSource();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.narration);
    source.start(0, Math.min(Math.max(0, offset), buffer.duration));
    source.onended = () => {
      if (this.source === source) this.source = null;
    };
    this.source = source;
  }

  stop(): void {
    this.events.push({ type: 'stop' });
    this.stopSource();
  }

  setBedLevel(level: number): void {
    this.events.push({ type: 'bed', level });
    if (this.context && this.bedGain) this.bedGain.gain.setTargetAtTime(level, this.context.currentTime, 0.1);
  }

  setVolume(volume: number): void {
    this.events.push({ type: 'volume', level: volume });
    this.volume = volume;
    if (this.context && this.master) this.master.gain.setTargetAtTime(volume, this.context.currentTime, 0.012);
  }

  private stopSource(): void {
    try {
      this.source?.stop();
    } catch {
      // Already stopped.
    }
    this.source?.disconnect();
    this.source = null;
  }

  private bufferFor(hash: string): AudioBuffer | null {
    const context = this.context;
    const clip = this.clips.get(hash);
    if (!context || !clip) return null;
    const cached = this.buffers.get(hash);
    if (cached) return cached;
    const view = new DataView(clip.pcm.buffer, clip.pcm.byteOffset, clip.pcm.byteLength);
    const samples = Math.floor(view.byteLength / 2);
    const buffer = context.createBuffer(1, Math.max(1, samples), clip.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i++) data[i] = view.getInt16(i * 2, true) / 32768;
    this.buffers.set(hash, buffer);
    return buffer;
  }

  /** The quiet bed: two seconds of soft lowpassed noise, looped. */
  private startBed(): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;
    const length = context.sampleRate * 2;
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 0.5;
    }
    const loop = context.createBufferSource();
    loop.buffer = buffer;
    loop.loop = true;
    const gain = context.createGain();
    gain.gain.value = BED_LEVEL;
    loop.connect(gain);
    gain.connect(master);
    loop.start();
    this.bedGain = gain;
  }
}
