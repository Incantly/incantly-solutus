import type { NoiseColor } from '../api/types';
import { SOUND_LIMITS } from '../kits/sound/limits';
import type { SceneCommand, SoundState } from '../protocol/scene-commands';

/**
 * Plays a figure's sounds with Web Audio, on the page that shows it. The
 * scene only describes its tones and noises; the browser makes every sample
 * natively, and a change reaches it at most once a frame, gliding over a few
 * milliseconds so a dragged slider never clicks.
 *
 * Silent until the learner switches sound on, which is also the gesture a
 * browser needs before it plays anything. Every figure on the page shares one
 * audio context and one limiter, so many figures cannot add up to a loud one.
 */

export type SoundCommand = Extract<SceneCommand, { op: 'sound' | 'silence' | 'note' }>;

export function isSoundCommand(command: SceneCommand): command is SoundCommand {
  return command.op === 'sound' || command.op === 'silence' || command.op === 'note';
}

/** Loudness of everything on the page together, after the limiter. */
export const MASTER_GAIN = 0.3;
/** One sound at gain 1, before the master: room for a few together. */
const VOICE_GAIN = 0.5;
/** Seconds a change glides over. */
const GLIDE = 0.012;
/** Seconds of noise generated once and looped. */
const NOISE_SECONDS = 2;

export type AudioContextFactory = () => AudioContext;

interface Output {
  readonly context: AudioContext;
  /** Where every figure connects: the limiter, then the master gain. */
  readonly input: AudioNode;
  readonly noise: Map<NoiseColor, AudioBuffer>;
}

let shared: Output | null = null;

function defaultFactory(): AudioContext {
  const view = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Context = view.AudioContext ?? view.webkitAudioContext;
  if (!Context) throw new Error('This browser cannot play sound');
  return new Context();
}

function output(factory: AudioContextFactory): Output {
  if (shared && shared.context.state !== 'closed') return shared;
  const context = factory();
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -12;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.1;
  const master = context.createGain();
  master.gain.value = MASTER_GAIN;
  limiter.connect(master);
  master.connect(context.destination);
  shared = { context, input: limiter, noise: new Map() };
  return shared;
}

/** For tests: forget the page's audio context. */
export function resetSoundOutput(): void {
  shared = null;
}

/** Two seconds of noise in a colour, made once per page. */
function noiseBuffer(out: Output, color: NoiseColor): AudioBuffer {
  const cached = out.noise.get(color);
  if (cached) return cached;
  const length = Math.floor(out.context.sampleRate * NOISE_SECONDS);
  const buffer = out.context.createBuffer(1, length, out.context.sampleRate);
  const data = buffer.getChannelData(0);
  // Pink by Paul Kellet's filter, brown by summing white; both scaled to about the loudness of white.
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    if (color === 'white') {
      data[i] = white;
    } else if (color === 'pink') {
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    } else {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  }
  out.noise.set(color, buffer);
  return buffer;
}

interface Playing {
  state: SoundState;
  source: OscillatorNode | AudioBufferSourceNode;
  readonly gain: GainNode;
}

export class SoundPlayer {
  /** Every sound the scene has now, played or not. */
  private readonly sounds = new Map<number, SoundState>();
  private readonly playing = new Map<number, Playing>();
  private out: Output | null = null;
  private bus: GainNode | null = null;
  private enabled = false;
  private audible = true;
  private recentNotes: number[] = [];
  private notesSeen = false;

  constructor(private readonly factory: AudioContextFactory = defaultFactory) {}

  /** Whether the scene has made any sound, so the figure offers its sound button. */
  get hasSound(): boolean {
    return this.sounds.size > 0 || this.notesSeen;
  }

  get isOn(): boolean {
    return this.enabled;
  }

  /**
   * Switches sound on or off. Call it from the learner's click: a browser
   * starts audio only in answer to a gesture.
   */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) {
      try {
        this.out = output(this.factory);
      } catch {
        this.enabled = false;
        return;
      }
      if (this.out.context.state === 'suspended') void this.out.context.resume();
      this.bus = this.out.context.createGain();
      this.bus.gain.value = 0;
      this.bus.connect(this.out.input);
      for (const [id, state] of this.sounds) this.start(id, state);
      this.fade();
    } else {
      this.teardown();
    }
  }

  /** Whether the figure may sound now: playing, or still with nothing to play, and in sight. */
  setAudible(audible: boolean): void {
    if (audible === this.audible) return;
    this.audible = audible;
    this.fade();
  }

  apply(commands: readonly SoundCommand[]): void {
    for (const command of commands) {
      if (command.op === 'sound') {
        this.sounds.set(command.id, command.sound);
        if (this.enabled) this.change(command.id, command.sound);
      } else if (command.op === 'silence') {
        this.sounds.delete(command.id);
        this.stop(command.id);
      } else {
        this.notesSeen = true;
        this.note(command);
      }
    }
  }

  /** The scene was rebuilt: its sounds begin again from its new commands. */
  clear(): void {
    this.sounds.clear();
    for (const id of [...this.playing.keys()]) this.stop(id);
  }

  destroy(): void {
    this.clear();
    this.teardown();
  }

  private teardown(): void {
    for (const id of [...this.playing.keys()]) this.stop(id);
    this.bus?.disconnect();
    this.bus = null;
  }

  private fade(): void {
    if (!this.bus || !this.out) return;
    this.bus.gain.setTargetAtTime(this.audible ? 1 : 0, this.out.context.currentTime, GLIDE);
  }

  private start(id: number, state: SoundState): void {
    const out = this.out;
    if (!out || !this.bus || this.playing.size >= SOUND_LIMITS.voices) return;
    const context = out.context;
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.connect(this.bus);
    let source: OscillatorNode | AudioBufferSourceNode;
    if (state.kind === 'tone') {
      const oscillator = context.createOscillator();
      oscillator.type = state.wave;
      oscillator.frequency.value = frequency(state.frequency);
      source = oscillator;
    } else {
      const noise = context.createBufferSource();
      noise.buffer = noiseBuffer(out, state.color);
      noise.loop = true;
      source = noise;
    }
    source.connect(gain);
    source.start();
    // From silence, so it begins without a click.
    gain.gain.setTargetAtTime(level(state.gain), context.currentTime, GLIDE);
    this.playing.set(id, { state, source, gain });
  }

  private change(id: number, state: SoundState): void {
    const now = this.playing.get(id);
    if (!now) return this.start(id, state);
    const sameSource = now.state.kind === state.kind && (state.kind === 'tone' || (now.state.kind === 'noise' && now.state.color === state.color));
    if (!sameSource) {
      this.stop(id);
      return this.start(id, state);
    }
    const time = this.out!.context.currentTime;
    if (state.kind === 'tone') {
      const oscillator = now.source as OscillatorNode;
      if (oscillator.type !== state.wave) oscillator.type = state.wave;
      oscillator.frequency.setTargetAtTime(frequency(state.frequency), time, GLIDE);
    }
    now.gain.gain.setTargetAtTime(level(state.gain), time, GLIDE);
    now.state = state;
  }

  private stop(id: number): void {
    const now = this.playing.get(id);
    if (!now) return;
    this.playing.delete(id);
    const context = this.out?.context;
    if (!context) return;
    // Down to silence before it stops, so it ends without a click.
    now.gain.gain.setTargetAtTime(0, context.currentTime, GLIDE);
    now.source.stop(context.currentTime + GLIDE * 6);
    now.source.onended = () => now.gain.disconnect();
  }

  private note(command: Extract<SoundCommand, { op: 'note' }>): void {
    const out = this.out;
    if (!this.enabled || !this.audible || !out || !this.bus) return;
    const context = out.context;
    const time = context.currentTime;
    // Notes a second ago and more drop out: a scene that calls note every frame does not become a buzz.
    this.recentNotes = this.recentNotes.filter((at) => at > time - 1);
    if (this.recentNotes.length >= SOUND_LIMITS.notesPerSecond) return;
    this.recentNotes.push(time);
    const duration = Math.min(SOUND_LIMITS.maxNote, Math.max(SOUND_LIMITS.minNote, command.duration));
    const oscillator = context.createOscillator();
    oscillator.type = command.wave;
    oscillator.frequency.value = frequency(command.frequency);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(level(command.gain), time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(gain);
    gain.connect(this.bus);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.02);
    oscillator.onended = () => gain.disconnect();
  }
}

function frequency(hz: number): number {
  return Number.isFinite(hz) ? Math.min(SOUND_LIMITS.maxFrequency, Math.max(SOUND_LIMITS.minFrequency, hz)) : 440;
}

function level(gain: number): number {
  return (Number.isFinite(gain) ? Math.min(1, Math.max(0, gain)) : 0) * VOICE_GAIN;
}
