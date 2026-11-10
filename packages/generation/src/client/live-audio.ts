/**
 * The browser side of live voice audio: microphone capture going in, model
 * speech coming out. Generic and reusable: nothing here knows about films,
 * beats or the Playground page. Capture downsamples to the 16 kHz mono
 * 16-bit PCM the Live API takes; playback turns the model's 24 kHz mono
 * 16-bit PCM into gapless sound that an interruption can silence at once.
 */

import type { LiveAudioListener } from './live-gemini';

/** What the Live API takes from the microphone: 16 kHz mono 16-bit PCM. */
export const LIVE_INPUT_SAMPLE_RATE = 16000;

/** A capture chunk: 640 samples, about 40 ms at 16 kHz. */
export const LIVE_INPUT_CHUNK_SAMPLES = 640;

/** What the Live API sends back: 24 kHz mono 16-bit PCM. */
export const LIVE_OUTPUT_SAMPLE_RATE = 24000;

export interface MicrophoneHandle {
  stop(): void;
}

/**
 * Clamps float samples to [-1, 1] and converts to 16-bit PCM, little-endian
 * rounding, symmetric about zero.
 */
export function floatToPcm16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    out[i] = Math.max(-32768, Math.min(32767, Math.round(clamped * 32768)));
  }
  return out;
}

/** Turns little-endian 16-bit PCM bytes back into float samples in [-1, 1]. */
export function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  const count = Math.floor(bytes.length / 2);
  const out = new Float32Array(count);
  const view = new DataView(bytes.buffer, bytes.byteOffset, count * 2);
  for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

/**
 * Single-shot linear-interpolation downsampling to 16 kHz mono. Pure, so
 * tests cover it; the streaming chunker below builds on the same math.
 */
export function downsampleTo16kMono(input: Float32Array, inputSampleRate: number): Int16Array {
  if (!(inputSampleRate > 0) || !Number.isFinite(inputSampleRate)) throw new Error('Downsampling needs a positive input sample rate.');
  if (input.length === 0) return new Int16Array(0);
  if (inputSampleRate === LIVE_INPUT_SAMPLE_RATE) return floatToPcm16(input);
  const step = inputSampleRate / LIVE_INPUT_SAMPLE_RATE;
  const count = Math.max(1, Math.floor(input.length / step));
  const floats = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const pos = i * step;
    const base = Math.floor(pos);
    const frac = pos - base;
    const first = input[Math.min(base, input.length - 1)]!;
    const second = input[Math.min(base + 1, input.length - 1)]!;
    floats[i] = first + (second - first) * frac;
  }
  return floatToPcm16(floats);
}

/**
 * Stateful mono capture: feeds the worklet's raw blocks in, emits full
 * ~40 ms 16 kHz PCM chunks. Keeps the fractional read position and the last
 * input sample across pushes, so chunk boundaries never click.
 */
export class LiveCaptureResampler {
  private readonly step: number;
  private pending = new Float32Array(0);
  private readPos = 0;

  constructor(inputSampleRate: number) {
    if (!(inputSampleRate > 0) || !Number.isFinite(inputSampleRate)) throw new Error('Capture needs a positive input sample rate.');
    this.step = inputSampleRate / LIVE_INPUT_SAMPLE_RATE;
  }

  /** Pushes raw mono input; returns zero or more full 16 kHz chunks. */
  push(input: Float32Array): Int16Array[] {
    if (input.length === 0) return [];
    const joined = new Float32Array(this.pending.length + input.length);
    joined.set(this.pending, 0);
    joined.set(input, this.pending.length);
    const chunks: Int16Array[] = [];
    const floats = new Float32Array(LIVE_INPUT_CHUNK_SAMPLES);
    for (;;) {
      const lastStart = this.readPos + (LIVE_INPUT_CHUNK_SAMPLES - 1) * this.step;
      if (lastStart > joined.length - 1) break;
      for (let i = 0; i < LIVE_INPUT_CHUNK_SAMPLES; i++) {
        const pos = this.readPos + i * this.step;
        const base = Math.floor(pos);
        const frac = pos - base;
        const first = joined[Math.min(base, joined.length - 1)]!;
        const second = joined[Math.min(base + 1, joined.length - 1)]!;
        floats[i] = first + (second - first) * frac;
      }
      this.readPos += LIVE_INPUT_CHUNK_SAMPLES * this.step;
      chunks.push(floatToPcm16(floats));
    }
    // Drops consumed input, keeping one sample for interpolation continuity.
    const consumed = Math.min(joined.length, Math.max(0, Math.floor(this.readPos)));
    if (consumed > 0) {
      this.pending = joined.slice(Math.max(0, consumed - 1));
      this.readPos -= Math.max(0, consumed - 1);
    } else {
      this.pending = joined;
    }
    return chunks;
  }
}

/**
 * The worklet only mixes to mono and posts raw blocks; every bit of
 * resampling math stays on the page in LiveCaptureResampler, where tests
 * cover it. Silent by itself: the page connects it through a zero gain.
 */
const CAPTURE_WORKLET_SOURCE = `
class IncantlyLiveCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channels = inputs && inputs[0];
    if (channels && channels.length > 0 && channels[0].length > 0) {
      const frames = channels[0].length;
      const mono = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (const channel of channels) sum += channel[i];
        mono[i] = sum / channels.length;
      }
      this.port.postMessage(mono, [mono.buffer]);
    }
    return true;
  }
}
registerProcessor('incantly-live-capture', IncantlyLiveCapture);
`;

type BrowserView = {
  readonly AudioContext?: typeof AudioContext;
  readonly navigator?: { readonly mediaDevices?: { getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> } };
};

/**
 * Captures the microphone with echo cancellation and noise suppression,
 * posting ~40 ms 16 kHz mono PCM chunks to the callback. The returned handle
 * stops the tracks, the worklet and the context; call it when live voice
 * stops or the page goes away.
 */
export async function startMicrophone(onPcm16k: (pcm: Int16Array) => void): Promise<MicrophoneHandle> {
  const view = globalThis as unknown as BrowserView;
  const media = view.navigator?.mediaDevices;
  if (!media?.getUserMedia) throw new Error('This browser cannot capture microphone audio.');
  let stream: MediaStream;
  try {
    stream = await media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
      throw new Error('Microphone permission was denied: allow the microphone and try Live voice again.', { cause: error });
    }
    throw new Error('The microphone did not start: check it is plugged in and no other tab holds it.', { cause: error });
  }
  if (!view.AudioContext) {
    for (const track of stream.getTracks()) track.stop();
    throw new Error('This browser cannot process microphone audio.');
  }
  const context = new view.AudioContext();
  const moduleUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET_SOURCE], { type: 'application/javascript' }));
  const stopTracks = (): void => {
    for (const track of stream.getTracks()) track.stop();
  };
  try {
    await context.audioWorklet.addModule(moduleUrl);
  } catch {
    stopTracks();
    URL.revokeObjectURL(moduleUrl);
    throw new Error('This browser cannot run microphone capture.');
  }
  const resampler = new LiveCaptureResampler(context.sampleRate);
  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, 'incantly-live-capture');
  node.port.onmessage = (event: MessageEvent): void => {
    const mono = event.data as Float32Array;
    if (!(mono instanceof Float32Array)) return;
    for (const chunk of resampler.push(mono)) onPcm16k(chunk);
  };
  // A zero gain keeps the worklet processing without ever sounding the mic.
  const silence = context.createGain();
  silence.gain.value = 0;
  source.connect(node);
  node.connect(silence);
  silence.connect(context.destination);
  await context.resume().catch(() => undefined);
  let stopped = false;
  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      try {
        source.disconnect();
        node.disconnect();
        silence.disconnect();
        void node.port.close?.();
      } catch {
        // Tearing down a half-started capture still stops the mic.
      }
      stopTracks();
      URL.revokeObjectURL(moduleUrl);
      void context.close().catch(() => undefined);
    },
  };
}

export interface PcmPlayer {
  /** Plays one 24 kHz 16-bit PCM chunk, gaplessly after the chunks before it. */
  push(bytes: Uint8Array): void;
  /** Stops every scheduled chunk at once: the teacher goes silent, for interruptions. */
  flush(): void;
  setVolume(volume: number): void;
  close(): void;
}

/**
 * Gapless chunk playback: every push schedules an AudioBufferSourceNode to
 * start exactly when the chunk before it ends, so the teacher's voice never
 * stutters between Live messages. Flush drops the schedule for interruptions.
 */
export function createPcmPlayer(options: { readonly sampleRate?: number; readonly volume?: number } = {}): PcmPlayer {
  const sampleRate = options.sampleRate ?? LIVE_OUTPUT_SAMPLE_RATE;
  let volume = options.volume ?? 0.5;
  const view = globalThis as unknown as BrowserView;
  let context: AudioContext | null = null;
  let gain: GainNode | null = null;
  let nextTime = 0;
  const scheduled = new Set<AudioBufferSourceNode>();

  const ensure = (): boolean => {
    if (context) {
      void context.resume().catch(() => undefined);
      return true;
    }
    if (!view.AudioContext) return false;
    context = new view.AudioContext({ sampleRate });
    gain = context.createGain();
    gain.gain.value = volume;
    gain.connect(context.destination);
    nextTime = context.currentTime;
    void context.resume().catch(() => undefined);
    return true;
  };

  return {
    push(bytes: Uint8Array): void {
      if (bytes.length < 2 || !ensure() || !context || !gain) return;
      const floats = pcm16ToFloat32(bytes);
      if (floats.length === 0) return;
      const buffer = context.createBuffer(1, floats.length, sampleRate);
      buffer.getChannelData(0).set(floats);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      scheduled.add(source);
      source.onended = (): void => {
        scheduled.delete(source);
      };
      const startAt = Math.max(nextTime, context.currentTime);
      try {
        source.start(startAt);
      } catch {
        scheduled.delete(source);
        return;
      }
      nextTime = startAt + buffer.duration;
    },
    flush(): void {
      for (const source of [...scheduled]) {
        try {
          source.stop();
        } catch {
          // Already ended: onended drops it from the set.
        }
      }
      scheduled.clear();
      if (context) nextTime = context.currentTime;
    },
    setVolume(next: number): void {
      volume = Math.min(1, Math.max(0, Number.isFinite(next) ? next : 0.5));
      if (gain && context) gain.gain.setValueAtTime(volume, context.currentTime);
    },
    close(): void {
      for (const source of [...scheduled]) {
        try {
          source.stop();
        } catch {
          // Already ended.
        }
      }
      scheduled.clear();
      const closing = context;
      context = null;
      gain = null;
      if (closing) void closing.close().catch(() => undefined);
    },
  };
}

/** Pipes one voice's audio chunks into a player; returns the unsubscribe. */
export function pipeVoiceAudio(voice: { onAudio(listener: LiveAudioListener): () => void }, player: PcmPlayer): () => void {
  return voice.onAudio((pcm) => player.push(pcm));
}
