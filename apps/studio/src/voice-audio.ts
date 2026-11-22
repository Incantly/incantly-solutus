/**
 * The sound side of the voice lesson (teacher design 8, server design 6): the teacher's voice from `POST /v1/speech`
 * (an audio element for MP3, Web Audio for PCM at the `x-sample-rate` header), the browser's own voice for when the
 * server's is busy, fails or is off, and the browser's speech recognition for listening. No library; every part is
 * behind a small interface (`voice.ts`) so a test gives its own. Nothing here throws out of a function.
 */
import type { BrowserVoice, Clip, ClipSource, Recogniser, RecogniserHandlers } from './voice';

/** The sample rate of PCM when the server names none (teacher design 8). */
const DEFAULT_RATE = 24_000;

interface AudioGlobals {
  readonly AudioContext?: typeof AudioContext;
  readonly webkitAudioContext?: typeof AudioContext;
  readonly SpeechRecognition?: new () => RawRecognition;
  readonly webkitSpeechRecognition?: new () => RawRecognition;
}

const g = (): AudioGlobals => globalThis as unknown as AudioGlobals;

/** One Web Audio context for the page, made when the first PCM clip is played. */
const context: { current?: AudioContext } = {};

function audioContext(): AudioContext | undefined {
  if (context.current === undefined) {
    const Ctor = g().AudioContext ?? g().webkitAudioContext;
    if (Ctor === undefined) return undefined;
    try {
      context.current = new Ctor();
    } catch {
      return undefined;
    }
  }
  return context.current;
}

/**
 * Lets the page play sound. A browser allows it only after a gesture, so the Talk button calls this when it is pressed:
 * the context is made and resumed there, before any clip plays.
 */
export function unlockAudio(): void {
  const ctx = audioContext();
  if (ctx !== undefined && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
}

/** A clip of MP3 bytes, played by an audio element. */
function mp3Clip(bytes: Uint8Array, type: string): Clip {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: type !== '' ? type : 'audio/mpeg' }));
  const audio = new Audio(url);
  return {
    play: (signal) =>
      new Promise<void>((resolve, reject) => {
        if (signal.aborted) return resolve();
        const onAbort = (): void => {
          audio.pause();
          resolve();
        };
        signal.addEventListener('abort', onAbort, { once: true });
        audio.onended = () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        };
        audio.onerror = () => {
          signal.removeEventListener('abort', onAbort);
          reject(new Error('The audio could not be played.'));
        };
        audio.play().catch((e: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(e instanceof Error ? e : new Error('The audio could not be played.'));
        });
      }),
    dispose: () => {
      audio.pause();
      URL.revokeObjectURL(url);
    },
  };
}

/** A clip of 16-bit little-endian mono PCM, played through Web Audio at `rate` samples a second. */
function pcmClip(bytes: Uint8Array, rate: number): Clip | undefined {
  const ctx = audioContext();
  if (ctx === undefined) return undefined;
  const count = Math.floor(bytes.length / 2);
  if (count === 0) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, count * 2);
  const buffer = ctx.createBuffer(1, count, rate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < count; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  return {
    play: (signal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        const onAbort = (): void => {
          try {
            source.stop();
          } catch {
            // it had not started
          }
          resolve();
        };
        signal.addEventListener('abort', onAbort, { once: true });
        source.onended = () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        };
        void ctx.resume().catch(() => undefined);
        source.start();
      }),
    dispose: () => source.disconnect(),
  };
}

/**
 * The teacher's voice: each sentence is fetched from `POST /v1/speech` the moment it is asked for, and the clip is whole
 * when it arrives (the next sentence's request is already out while this one plays). Gives `undefined` for any failure,
 * so the lesson speaks that sentence with the browser's voice.
 */
export function speechClips(fetchImpl: typeof fetch = (input, init) => fetch(input, init)): ClipSource {
  return async (text, signal) => {
    try {
      const res = await fetchImpl('/v1/speech', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'audio/*' }, body: JSON.stringify({ text }), signal });
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return undefined;
      }
      const type = res.headers.get('content-type') ?? '';
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length === 0) return undefined;
      if (type.includes('audio/pcm')) {
        const named = Number(res.headers.get('x-sample-rate'));
        return pcmClip(bytes, Number.isInteger(named) && named >= 8000 && named <= 192_000 ? named : DEFAULT_RATE);
      }
      return mp3Clip(bytes, type);
    } catch {
      return undefined;
    }
  };
}

/** The browser's own voice (speech synthesis), or undefined where the browser has none. */
export function browserVoice(): BrowserVoice | undefined {
  const synth = (globalThis as unknown as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
  if (synth === undefined || typeof SpeechSynthesisUtterance === 'undefined') return undefined;
  return {
    say: (text, signal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        const utterance = new SpeechSynthesisUtterance(text);
        const done = (): void => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        };
        const onAbort = (): void => {
          synth.cancel();
          done();
        };
        signal.addEventListener('abort', onAbort, { once: true });
        utterance.onend = done;
        utterance.onerror = done;
        synth.speak(utterance);
      }),
  };
}

interface RawResult {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}
interface RawRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { readonly results: ArrayLike<RawResult> }) => void) | null;
  onerror: ((e: { readonly error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

/** Whether the browser can listen. */
export const canListen = (): boolean => g().SpeechRecognition !== undefined || g().webkitSpeechRecognition !== undefined;

/** The errors of speech recognition that are only "nobody spoke" or "stopped on purpose". */
const QUIET = new Set(['no-speech', 'aborted']);

/** A recogniser over the browser's speech recognition, or undefined where there is none. One utterance, with interim text. */
export function browserRecogniser(): Recogniser | undefined {
  const Ctor = g().SpeechRecognition ?? g().webkitSpeechRecognition;
  if (Ctor === undefined) return undefined;
  const rec = new Ctor();
  rec.lang = typeof navigator !== 'undefined' && navigator.language !== '' ? navigator.language : 'en-US';
  rec.continuous = false;
  rec.interimResults = true;
  return {
    start(h: RecogniserHandlers): void {
      rec.onresult = (e) => {
        let text = '';
        let final = false;
        for (let i = 0; i < e.results.length; i++) {
          const r = e.results[i] as RawResult;
          text += r[0].transcript;
          if (r.isFinal) final = true;
        }
        h.onText(text.trim(), final);
      };
      rec.onerror = (e) => h.onEnd(QUIET.has(e.error) ? undefined : e.error);
      rec.onend = () => h.onEnd(undefined);
      try {
        rec.start();
      } catch {
        h.onEnd('start');
      }
    },
    stop(): void {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.abort();
      } catch {
        // it was not running
      }
    },
  };
}
