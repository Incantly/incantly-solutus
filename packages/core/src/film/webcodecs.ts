import { mountTrusted, type Fragments, type MountedFigure } from '../engine/mount';
import type { KitRegistry } from '../runtime/kits';
import { isSoundCommand } from '../renderer/sound';
import { FilmController } from '../runtime/film';
import { FILM_STEP_SECONDS } from '../runtime/runtime';
import type { RuntimeUpdate } from '../protocol/runtime-messages';
import { sandboxAdapter, type FigureHandle } from '../sandbox/adapter';
import { backgroundOf, paintStages, placeStages, stackPictures, type PictureCache } from '../sandbox/snapshot';
import type { Mp4VideoCodec } from './mp4';
import { mountStubRuntime, pushAbsoluteState, type SanitizedSceneSnapshot } from './sandbox';
import type { CompiledFilm } from './storyboard';
import {
  EXPORT_AUDIO_FRAME_SAMPLES,
  EXPORT_SAMPLE_RATE,
  EXPORT_SEED,
  ExportError,
  type ExportAudioSink,
  type ExportCaptureSession,
  type ExportFrame,
  type ExportFrameSize,
  type ExportPlanChunk,
  type ExportVideoSample,
  type ExportVideoSink,
  type FallbackRecorder,
  type FallbackSession,
} from './export';

/**
 * The browser half of film export: capability detection, offscreen capture,
 * WebCodecs encoders, and the MediaRecorder fallback rig. Importing this
 * module touches no globals; every function degrades to null or throws
 * ExportError where its browser API is missing, so node tests can probe
 * selection logic with stubbed globals.
 */

/** Pixels as data: what the identity check compares, in node or the browser. */
export interface PixelMap {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

/** Bits per pixel the export encodes at, before clamping. */
const BITS_PER_PIXEL = 0.1;

/** The export video bitrate: 0.1 bits per pixel, between 500 kbps and 12 Mbps. */
export function exportBitrate(width: number, height: number, fps: number): number {
  return Math.min(12_000_000, Math.max(500_000, Math.round(width * height * fps * BITS_PER_PIXEL)));
}

export interface ExportCodecSupport {
  readonly video: Mp4VideoCodec | null;
  readonly videoCodecString: string | null;
  readonly audio: boolean;
}

interface CodecGlobals {
  readonly VideoEncoder?: {
    isConfigSupported(config: Record<string, unknown>): Promise<{ supported?: boolean }>;
  };
  readonly AudioEncoder?: {
    isConfigSupported(config: Record<string, unknown>): Promise<{ supported?: boolean }>;
  };
}

const VIDEO_CANDIDATES: ReadonlyArray<{ readonly codec: Mp4VideoCodec; readonly strings: readonly string[] }> = [
  { codec: 'avc', strings: ['avc1.640028', 'avc1.42001f'] },
  { codec: 'vp09', strings: ['vp09.00.10.08'] },
  { codec: 'vp08', strings: ['vp8'] },
];

export const EXPORT_AUDIO_CODEC = 'mp4a.40.2';
export const EXPORT_AUDIO_BITRATE = 96000;

/**
 * Detects what the export can encode here: H.264 where the encoder takes it,
 * VP9 then VP8 by capability detection, and AAC for the narration track. Null
 * video means the export must take the MediaRecorder fallback; false audio
 * means the MP4 ships video-only.
 */
export async function probeExportCodecs(width: number, height: number, fps = 30): Promise<ExportCodecSupport> {
  const view = globalThis as unknown as CodecGlobals;
  if (typeof view.VideoEncoder === 'undefined' || typeof view.VideoEncoder.isConfigSupported !== 'function') {
    return { video: null, videoCodecString: null, audio: false };
  }
  let picked: { readonly codec: Mp4VideoCodec; readonly codecString: string } | null = null;
  for (const candidate of VIDEO_CANDIDATES) {
    for (const codecString of candidate.strings) {
      try {
        const supported = await view.VideoEncoder.isConfigSupported({ codec: codecString, width, height, bitrate: exportBitrate(width, height, fps), framerate: fps });
        if (supported.supported === true) {
          picked = { codec: candidate.codec, codecString };
          break;
        }
      } catch {
        // An encoder that throws on probe takes nothing.
      }
    }
    if (picked) break;
  }
  let audio = false;
  if (picked && typeof view.AudioEncoder !== 'undefined' && typeof view.AudioEncoder.isConfigSupported === 'function') {
    try {
      const supported = await view.AudioEncoder.isConfigSupported({ codec: EXPORT_AUDIO_CODEC, sampleRate: EXPORT_SAMPLE_RATE, numberOfChannels: 1, bitrate: EXPORT_AUDIO_BITRATE });
      audio = supported.supported === true;
    } catch {
      audio = false;
    }
  }
  return picked ? { video: picked.codec, videoCodecString: picked.codecString, audio } : { video: null, videoCodecString: null, audio: false };
}

function descriptionBytes(description: unknown): Uint8Array {
  if (description instanceof Uint8Array) return new Uint8Array(description);
  if (description instanceof ArrayBuffer) return new Uint8Array(description);
  if (ArrayBuffer.isView(description)) return new Uint8Array(description.buffer, description.byteOffset, description.byteLength);
  return new Uint8Array(0);
}

/**
 * Opens the video encoder: realtime latency, so decode order equals
 * presentation order and the muxer writes no composition offsets. VP tracks
 * carry no extradata from WebCodecs; the muxer writes a generic vpcC for
 * them, so their description is empty.
 */
export async function openWebCodecsVideo(width: number, height: number, fps: number, codec: Mp4VideoCodec, codecString: string): Promise<ExportVideoSink> {
  const view = globalThis as unknown as { VideoEncoder?: typeof VideoEncoder; VideoFrame?: typeof VideoFrame };
  if (typeof view.VideoEncoder === 'undefined' || typeof view.VideoFrame === 'undefined') throw new ExportError('This browser has no WebCodecs video encoder');
  const samples: ExportVideoSample[] = [];
  let description: Uint8Array = new Uint8Array(0);
  let failed: unknown = null;
  const encoder = new view.VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      if (meta?.decoderConfig?.description) description = descriptionBytes(meta.decoderConfig.description);
      samples.push({ data, keyframe: chunk.type === 'key' });
    },
    error: (error) => {
      failed = error;
    },
  });
  try {
    encoder.configure({ codec: codecString, width, height, bitrate: exportBitrate(width, height, fps), framerate: fps, latencyMode: 'realtime' });
  } catch (error) {
    try {
      encoder.close();
    } catch {
      // Configuring failed; closing releases nothing further.
    }
    throw error instanceof Error ? error : new ExportError('The video encoder refused its configuration');
  }
  const Frame = view.VideoFrame;
  return {
    encode: async (image, timestampUs, keyFrame) => {
      if (failed) throw failed instanceof Error ? failed : new ExportError('The video encoder failed');
      const frame = new Frame(image as HTMLCanvasElement, { timestamp: timestampUs, duration: Math.round(1_000_000 / fps) });
      try {
        encoder.encode(frame, { keyFrame });
      } finally {
        frame.close();
      }
    },
    finish: async () => {
      await encoder.flush();
      if (failed) throw failed instanceof Error ? failed : new ExportError('The video encoder failed');
      if (samples.length === 0) throw new ExportError('The video encoder produced no samples');
      if (codec === 'avc' && description.length === 0) throw new ExportError('The H.264 encoder produced no codec description');
      return { codec, description, samples };
    },
    close: () => {
      try {
        encoder.close();
      } catch {
        // Closed twice, or after a failure: already released.
      }
    },
  };
}

/**
 * Opens the AAC encoder for the narration track, or null where this browser
 * has none (then the MP4 ships video-only). The whole track encodes as 1024-
 * sample frames, the last padded with silence; AAC priming shifts the encoded
 * track by up to 1024 samples past the assembled one.
 */
export async function openWebCodecsAudio(sampleRate: number = EXPORT_SAMPLE_RATE): Promise<ExportAudioSink | null> {
  const view = globalThis as unknown as { AudioEncoder?: typeof AudioEncoder; AudioData?: typeof AudioData };
  if (typeof view.AudioEncoder === 'undefined' || typeof view.AudioData === 'undefined') return null;
  try {
    const supported = await view.AudioEncoder.isConfigSupported({ codec: EXPORT_AUDIO_CODEC, sampleRate, numberOfChannels: 1, bitrate: EXPORT_AUDIO_BITRATE });
    if (supported.supported !== true) return null;
  } catch {
    return null;
  }
  const samples: Uint8Array[] = [];
  let description: Uint8Array = new Uint8Array(0);
  let failed: unknown = null;
  const encoder = new view.AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      if (meta?.decoderConfig?.description) description = descriptionBytes(meta.decoderConfig.description);
      samples.push(data);
    },
    error: (error) => {
      failed = error;
    },
  });
  try {
    encoder.configure({ codec: EXPORT_AUDIO_CODEC, sampleRate, numberOfChannels: 1, bitrate: EXPORT_AUDIO_BITRATE });
  } catch {
    try {
      encoder.close();
    } catch {
      // Configuring failed; closing releases nothing further.
    }
    return null;
  }
  const Data = view.AudioData;
  return {
    encode: async (track, _rate, cancel) => {
      if (failed) throw failed instanceof Error ? failed : new ExportError('The audio encoder failed');
      cancel?.throwIfCancelled();
      const frames = Math.max(1, Math.ceil(track.length / EXPORT_AUDIO_FRAME_SAMPLES));
      for (let i = 0; i < frames; i++) {
        if (i % 16 === 0) {
          cancel?.throwIfCancelled();
          if (i > 0) await Promise.resolve();
        }
        const padded = new Int16Array(EXPORT_AUDIO_FRAME_SAMPLES);
        padded.set(track.subarray(i * EXPORT_AUDIO_FRAME_SAMPLES, Math.min(track.length, (i + 1) * EXPORT_AUDIO_FRAME_SAMPLES)));
        const data = new Data({ format: 's16', sampleRate, numberOfFrames: EXPORT_AUDIO_FRAME_SAMPLES, numberOfChannels: 1, timestamp: Math.round((i * EXPORT_AUDIO_FRAME_SAMPLES * 1_000_000) / sampleRate), data: padded.buffer as ArrayBuffer });
        try {
          encoder.encode(data);
        } finally {
          data.close();
        }
      }
      cancel?.throwIfCancelled();
    },
    finish: async () => {
      await encoder.flush();
      if (failed) throw failed instanceof Error ? failed : new ExportError('The audio encoder failed');
      if (samples.length === 0 || description.length === 0) return null;
      return { description, samples };
    },
    close: () => {
      try {
        encoder.close();
      } catch {
        // Closed twice, or after a failure: already released.
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Offscreen capture: the export figure is a raster surface, never a player
// ---------------------------------------------------------------------------

/** Visual commands only: sfx cues never sound on the export figure. */
function visualUpdate(update: RuntimeUpdate): RuntimeUpdate {
  if (!update.commands.some((command) => isSoundCommand(command))) return { ...update, needsFrame: false };
  return { ...update, commands: update.commands.filter((command) => !isSoundCommand(command)), needsFrame: false };
}

/** Paints the beat's line into the caption band, deterministically for the same fonts. */
export function paintExportCaption(context: CanvasRenderingContext2D, caption: string, x: number, y: number, width: number, height: number): void {
  context.save();
  context.fillStyle = '#101418';
  context.fillRect(x, y, width, height);
  const text = caption.trim().replace(/\s+/g, ' ');
  if (text !== '') {
    const fontPx = Math.max(10, Math.min(28, height * 0.42));
    context.font = `${fontPx}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
    context.fillStyle = '#f5f7fa';
    context.textBaseline = 'middle';
    const words = text.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const next = line === '' ? word : `${line} ${word}`;
      if (context.measureText(next).width <= width - 24 || line === '') line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line !== '') lines.push(line);
    const shown = lines.slice(0, 2);
    const lineHeight = fontPx * 1.25;
    const top = y + height / 2 - ((shown.length - 1) * lineHeight) / 2;
    shown.forEach((row, i) => context.fillText(row, x + 12, top + i * lineHeight));
  }
  context.restore();
}

export interface BrowserCaptureEnv {
  readonly document: Document;
  readonly fragments: (sceneId: string) => Fragments;
  readonly kits: KitRegistry;
  readonly size: ExportFrameSize;
  /** Global frame indexes whose pixels to keep, for debug identity checks. */
  readonly keepFrames?: ReadonlySet<number>;
  /** Where kept pixels land, by global frame index. */
  readonly kept?: Map<number, ImageData>;
  /** The chunk's first global frame index. */
  readonly globalOffset?: number;
}

let captureCounter = 0;

/**
 * Opens one chunk's capture session: the scene mounted offscreen at the
 * export width (laid out but invisible, so stages measure), frames applied
 * from the offline renderer, each rasterized to the export canvas with its
 * caption. The mounted figure is a surface only: its own runtime never ticks
 * (manual applies carry needsFrame false), and sound commands never reach it.
 */
export async function openBrowserCapture(chunk: ExportPlanChunk, env: BrowserCaptureEnv): Promise<ExportCaptureSession> {
  const doc = env.document;
  const box = doc.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = `position:fixed;left:-100000px;top:0;width:${env.size.width}px;visibility:hidden;pointer-events:none;`;
  doc.body.append(box);
  const figure = mountTrusted(box, env.fragments(chunk.sceneId), { kits: env.kits, film: true, autoplay: false, figureId: `export${++captureCounter}` });
  figure.runtime.setReducedMotion(false);
  const canvas = doc.createElement('canvas');
  canvas.width = env.size.frameWidth;
  canvas.height = env.size.frameHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    figure.destroy();
    box.remove();
    throw new ExportError('The export canvas has no 2D context');
  }
  const caches = new Map<SVGSVGElement, PictureCache>();
  const offset = env.globalOffset ?? 0;
  let destroyed = false;
  return {
    capture: async (frame: ExportFrame) => {
      if (destroyed) throw new ExportError('The capture session is destroyed');
      figure.renderer.apply(visualUpdate(frame.update));
      const svgs = [...box.querySelectorAll('svg.inc-stage')] as SVGSVGElement[];
      if (svgs.length === 0) throw new ExportError(`Scene "${chunk.sceneId}" draws no stage to export`);
      const { stages, width } = placeStages(svgs);
      const scale = env.size.width / Math.max(1, width);
      const pictures = await Promise.all(
        stages.map((stage) => {
          let cache = caches.get(stage.svg);
          if (!cache) {
            cache = new Map();
            caches.set(stage.svg, cache);
          }
          return stackPictures(stage.svg, true, cache);
        }),
      );
      context.clearRect(0, 0, canvas.width, canvas.height);
      const background = backgroundOf(svgs[0]!);
      // Stages narrower than the frame centre; the drawing never exceeds the export height.
      const dx = Math.round((env.size.width - Math.round(width * scale)) / 2);
      context.save();
      context.translate(dx, 0);
      paintStages(context, stages, pictures, scale, background);
      context.restore();
      paintExportCaption(context, frame.caption, 0, env.size.height, env.size.width, env.size.band);
      const global = offset + frame.frame;
      if (env.keepFrames?.has(global) && env.kept) {
        env.kept.set(global, context.getImageData(0, 0, canvas.width, canvas.height));
      }
      return canvas;
    },
    destroy: () => {
      destroyed = true;
      figure.destroy();
      box.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// Pixels: hashing and the live-rendered comparison
// ---------------------------------------------------------------------------

/** FNV-1a over RGB (alpha ignored: raster alpha is always opaque). */
export function hashPixels(pixels: PixelMap): string {
  let hash = 0x811c9dc5;
  const data = pixels.data;
  for (let i = 0; i + 3 < data.length + 1; i += 4) {
    hash ^= data[i]!;
    hash = Math.imul(hash, 0x01000193);
    hash ^= data[i + 1]!;
    hash = Math.imul(hash, 0x01000193);
    hash ^= data[i + 2]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * The mean absolute channel difference over RGB, 0 for identical frames. NaN
 * when the maps differ in size: incomparable, never silently zero.
 */
export function meanPixelDifference(a: PixelMap, b: PixelMap): number {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) return NaN;
  let total = 0;
  let count = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    total += Math.abs(a.data[i]! - b.data[i]!) + Math.abs(a.data[i + 1]! - b.data[i + 1]!) + Math.abs(a.data[i + 2]! - b.data[i + 2]!);
    count += 3;
  }
  return count === 0 ? NaN : total / count;
}

export interface LiveExportFrameEnv {
  readonly document: Document;
  readonly fragments: Fragments;
  readonly kits: KitRegistry;
  readonly film: CompiledFilm;
  readonly sceneIndex?: number;
  readonly size: ExportFrameSize;
}

/**
 * Renders what live playback shows at a film time, through the same raster
 * pipeline the export captures with: a hidden figure, a seek (seek-by-replay
 * draws what playing there draws), the beat's cues, the export frame size and
 * the export caption painter. The identity check compares these pixels
 * against exported frames at the same timestamps.
 */
export async function renderLiveExportPixels(env: LiveExportFrameEnv, timeSeconds: number): Promise<ImageData> {
  const doc = env.document;
  const box = doc.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = `position:fixed;left:-100000px;top:0;width:${env.size.width}px;visibility:hidden;pointer-events:none;`;
  doc.body.append(box);
  const figure: MountedFigure = mountTrusted(box, env.fragments, { kits: env.kits, film: true, autoplay: false, figureId: `liveframe${++captureCounter}` });
  try {
    figure.runtime.setReducedMotion(false);
    const controller = new FilmController({ runtime: figure.runtime, film: env.film, sceneIndex: env.sceneIndex ?? 0, now: () => 0 });
    controller.seek(timeSeconds);
    // The seek's updates are spent inside the replay; the full state rebuilds the figure from what it landed.
    figure.renderer.apply(visualUpdate(figure.runtime.fullState()));
    const caption = controller.currentBeat?.step.say ?? '';
    controller.destroy();
    const svgs = [...box.querySelectorAll('svg.inc-stage')] as SVGSVGElement[];
    if (svgs.length === 0) throw new ExportError('The live figure draws no stage to compare');
    const canvas = doc.createElement('canvas');
    canvas.width = env.size.frameWidth;
    canvas.height = env.size.frameHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new ExportError('The comparison canvas has no 2D context');
    const { stages, width } = placeStages(svgs);
    const scale = env.size.width / Math.max(1, width);
    const pictures = await Promise.all(stages.map((stage) => stackPictures(stage.svg, true)));
    const dx = Math.round((env.size.width - Math.round(width * scale)) / 2);
    context.save();
    context.translate(dx, 0);
    paintStages(context, stages, pictures, scale, backgroundOf(svgs[0]!));
    context.restore();
    paintExportCaption(context, caption, 0, env.size.height, env.size.width, env.size.band);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    figure.destroy();
    box.remove();
  }
}

// ---------------------------------------------------------------------------
// The fallback rig: realtime playback plus MediaRecorder
// ---------------------------------------------------------------------------

/** Fallback containers in preference order: MP4 first, so the download stays .mp4 where the browser records it. */
const FALLBACK_TYPES = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

/** The first container this browser's MediaRecorder takes, or null where it records none. */
export function fallbackRecorderType(): string | null {
  const view = globalThis as unknown as { MediaRecorder?: typeof MediaRecorder };
  if (typeof view.MediaRecorder === 'undefined' || typeof view.MediaRecorder.isTypeSupported !== 'function') return null;
  return FALLBACK_TYPES.find((type) => view.MediaRecorder!.isTypeSupported(type)) ?? null;
}

/**
 * Plays one chunk through pause points, for the fallback's realtime
 * playback: holds and questions play on, as in the offline renderer.
 */
export function resumeFallbackPlayback(controller: FilmController, film: CompiledFilm): void {
  let guard = film.beats.length + 1;
  while (!controller.isPlaying && controller.time + FILM_STEP_SECONDS / 2 < film.seconds && guard-- > 0) controller.play();
}

export interface FallbackRigEnv {
  readonly document: Document;
  readonly fragments: (sceneId: string) => Fragments;
  readonly kits: KitRegistry;
  readonly size: ExportFrameSize;
  readonly fps: number;
}

/**
 * The fallback's rig: a canvas MediaRecorder captures, figures mounted one
 * chunk at a time and played in realtime, a paint loop copying the current
 * figure to the canvas with its caption. Video-only: the recorder captures
 * the canvas stream, and narration stays out of the fallback file (the result
 * and the UI label say so).
 */
export function createBrowserFallbackRig(env: FallbackRigEnv): { readonly openSession: (chunk: ExportPlanChunk) => Promise<FallbackSession>; readonly recorder: FallbackRecorder; readonly clock: { wait(ms: number): Promise<void> } } {
  const doc = env.document;
  const canvas = doc.createElement('canvas');
  canvas.width = env.size.frameWidth;
  canvas.height = env.size.frameHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new ExportError('The fallback canvas has no 2D context');
  let current: { readonly figure: MountedFigure; readonly box: HTMLElement; readonly controller: FilmController } | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const caches = new Map<SVGSVGElement, PictureCache>();
  let busy = false;
  const paint = async (): Promise<void> => {
    const live = current;
    if (!live || busy) return;
    busy = true;
    try {
      const svgs = [...live.box.querySelectorAll('svg.inc-stage')] as SVGSVGElement[];
      if (svgs.length === 0) return;
      const { stages, width } = placeStages(svgs);
      if (!(width > 1)) return;
      const scale = env.size.width / width;
      const pictures = await Promise.all(
        stages.map((stage) => {
          let cache = caches.get(stage.svg);
          if (!cache) {
            cache = new Map();
            caches.set(stage.svg, cache);
          }
          return stackPictures(stage.svg, true, cache);
        }),
      );
      const dx = Math.round((env.size.width - Math.round(width * scale)) / 2);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.translate(dx, 0);
      paintStages(context, stages, pictures, scale, backgroundOf(svgs[0]!));
      context.restore();
      paintExportCaption(context, live.controller.currentBeat?.step.say ?? '', 0, env.size.height, env.size.width, env.size.band);
    } catch {
      // A frame that fails to copy keeps the last one, as in clip recording.
    } finally {
      busy = false;
    }
  };
  const openSession = async (chunk: ExportPlanChunk): Promise<FallbackSession> => {
    if (current) throw new ExportError('The fallback plays one chunk at a time');
    const box = doc.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = `position:fixed;left:-100000px;top:0;width:${env.size.width}px;visibility:hidden;pointer-events:none;`;
    doc.body.append(box);
    const figure = mountTrusted(box, env.fragments(chunk.sceneId), { kits: env.kits, film: true, autoplay: false, figureId: `fallback${++captureCounter}` });
    figure.runtime.setReducedMotion(false);
    figure.runtime.setFilm(true);
    const controller = new FilmController({ runtime: figure.runtime, film: chunk.film });
    controller.play();
    resumeFallbackPlayback(controller, chunk.film);
    figure.renderer.apply(visualUpdate(figure.runtime.flush()));
    current = { figure, box, controller };
    await paint();
    return {
      applyAhead: (seconds) => {
        if (!current) return;
        const update = controller.tick(seconds);
        resumeFallbackPlayback(controller, chunk.film);
        figure.renderer.apply(visualUpdate(update));
      },
      destroy: () => {
        caches.clear();
        controller.destroy();
        figure.destroy();
        box.remove();
        if (current?.figure === figure) current = null;
      },
    };
  };
  const rig: { active: { readonly recorder: MediaRecorder; readonly stopped: Promise<Uint8Array> } | null } = { active: null };
  const recorder: FallbackRecorder = {
    mimeType: fallbackRecorderType() ?? 'video/webm',
    start: () => {
      const type = fallbackRecorderType();
      if (!type) throw new ExportError('This browser records no video container');
      const view = globalThis as unknown as { MediaRecorder: typeof MediaRecorder };
      const stream = typeof canvas.captureStream === 'function' ? canvas.captureStream(env.fps) : null;
      if (!stream) throw new ExportError('This browser cannot capture its canvas');
      const active = new view.MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4_000_000 });
      const chunks: Blob[] = [];
      const stopped = new Promise<Uint8Array>((resolve) => {
        active.onstop = () => {
          void (async () => {
            stream.getTracks().forEach((track) => track.stop());
            const blob = new Blob(chunks, { type: type.split(';')[0] });
            resolve(new Uint8Array(await blob.arrayBuffer()));
          })();
        };
      });
      active.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      rig.active = { recorder: active, stopped };
      timer = setInterval(() => void paint(), 1000 / env.fps);
      active.start(250);
    },
    stop: async () => {
      const active = rig.active;
      rig.active = null;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      if (!active) return new Uint8Array(0);
      active.recorder.stop();
      return active.stopped;
    },
  };
  return { openSession, recorder, clock: { wait: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)) } };
}

// ---------------------------------------------------------------------------
// Sandboxed capture: generated scenes export without ever running on the host
// ---------------------------------------------------------------------------

/** A checked snapshot per scene: the stand-in seeks it, the figure draws it. */
export interface SandboxedCaptureEnv extends BrowserCaptureEnv {
  readonly snapshots: (sceneId: string) => SanitizedSceneSnapshot | null;
}

export interface SandboxedLiveFrameEnv {
  readonly document: Document;
  readonly fragments: Fragments;
  readonly snapshot: SanitizedSceneSnapshot;
  readonly film: CompiledFilm;
  readonly sceneIndex?: number;
  readonly size: ExportFrameSize;
}

export interface SandboxedFallbackRigEnv extends FallbackRigEnv {
  readonly snapshots: (sceneId: string) => SanitizedSceneSnapshot | null;
}

/** An offscreen box at the export width: laid out but invisible, so stages measure. */
function hiddenSandboxBox(doc: Document, widthPx: number): HTMLElement {
  const box = doc.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = `position:fixed;left:-100000px;top:0;width:${widthPx}px;visibility:hidden;pointer-events:none;`;
  doc.body.append(box);
  return box;
}

function decodePicture(doc: Document, png: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = doc.createElement('img');
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ExportError('The export picture did not decode'));
    img.src = png;
  });
}

/** Draws a capture picture into the export canvas at the drawing size, as the trusted capture paints its stages. */
function drawPicture(context: CanvasRenderingContext2D, img: HTMLImageElement, size: ExportFrameSize): void {
  context.clearRect(0, 0, size.frameWidth, size.frameHeight);
  context.drawImage(img, 0, 0, size.width, size.height);
}

/**
 * Opens one chunk's sandboxed capture session: the scene mounted offscreen in
 * the sandbox at the export width, every frame sought fresh on a stand-in and
 * landed on the figure, each rasterized from the figure's own snapshot with
 * its caption. The offline frames carry the stand-in's timing; the pixels
 * come from the real scene, which never runs on the host.
 */
export async function openSandboxedCapture(chunk: ExportPlanChunk, env: SandboxedCaptureEnv): Promise<ExportCaptureSession> {
  const doc = env.document;
  const snapshot = env.snapshots(chunk.sceneId);
  if (!snapshot) throw new ExportError(`Scene "${chunk.sceneId}" has no checked scene to export`);
  const box = hiddenSandboxBox(doc, env.size.width);
  const handle = sandboxAdapter.mount(box, env.fragments(chunk.sceneId), {
    title: `Export: ${chunk.sceneId}`,
    film: true,
    autoplay: false,
    reducedMotion: false,
    seed: EXPORT_SEED,
  });
  if ((await handle.ready) !== 'live' || handle.state !== 'live') {
    handle.destroy();
    box.remove();
    throw new ExportError(`Scene "${chunk.sceneId}" did not start for export`);
  }
  const stub = mountStubRuntime(snapshot, { seed: EXPORT_SEED });
  const controller = new FilmController({ runtime: stub, film: chunk.film, now: () => 0 });
  const canvas = doc.createElement('canvas');
  canvas.width = env.size.frameWidth;
  canvas.height = env.size.frameHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    controller.destroy();
    stub.destroy();
    handle.destroy();
    box.remove();
    throw new ExportError('The export canvas has no 2D context');
  }
  const offset = env.globalOffset ?? 0;
  let destroyed = false;
  return {
    capture: async (frame: ExportFrame) => {
      if (destroyed) throw new ExportError('The capture session is destroyed');
      // Seek-by-replay draws what playing there draws; the settled snapshot
      // then pictures the sought state, never the frame before.
      controller.seek(Math.max(0, Math.min(frame.time, chunk.film.seconds)));
      pushAbsoluteState(handle, stub, controller.currentBeat?.step.cam ?? null);
      const png = await handle.snapshot();
      if (!png) throw new ExportError(`Scene "${chunk.sceneId}" gave no picture for frame ${frame.frame}`);
      drawPicture(context, await decodePicture(doc, png), env.size);
      paintExportCaption(context, frame.caption, 0, env.size.height, env.size.width, env.size.band);
      const global = offset + frame.frame;
      if (env.keepFrames?.has(global) && env.kept) {
        env.kept.set(global, context.getImageData(0, 0, canvas.width, canvas.height));
      }
      return canvas;
    },
    destroy: () => {
      destroyed = true;
      controller.destroy();
      stub.destroy();
      handle.destroy();
      box.remove();
    },
  };
}

/**
 * Renders what sandboxed playback shows at a film time, through the same
 * snapshot pipeline the sandboxed export captures with: a hidden figure, a
 * seek, the beat's absolute state, the export frame size and the export
 * caption painter. The identity check compares these pixels against exported
 * frames at the same timestamps.
 */
export async function renderSandboxedLivePixels(env: SandboxedLiveFrameEnv, timeSeconds: number): Promise<ImageData> {
  const doc = env.document;
  const box = hiddenSandboxBox(doc, env.size.width);
  const handle = sandboxAdapter.mount(box, env.fragments, { title: 'Export comparison', film: true, autoplay: false, reducedMotion: false, seed: EXPORT_SEED });
  try {
    if ((await handle.ready) !== 'live' || handle.state !== 'live') throw new ExportError('The live figure did not start to compare');
    const stub = mountStubRuntime(env.snapshot, { seed: EXPORT_SEED });
    try {
      const controller = new FilmController({ runtime: stub, film: env.film, sceneIndex: env.sceneIndex ?? 0, now: () => 0 });
      controller.seek(timeSeconds);
      const beat = controller.currentBeat;
      pushAbsoluteState(handle, stub, beat?.step.cam ?? null);
      const caption = beat?.step.say ?? '';
      controller.destroy();
      const png = await handle.snapshot();
      if (!png) throw new ExportError('The live figure gave no picture to compare');
      const canvas = doc.createElement('canvas');
      canvas.width = env.size.frameWidth;
      canvas.height = env.size.frameHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new ExportError('The comparison canvas has no 2D context');
      drawPicture(context, await decodePicture(doc, png), env.size);
      paintExportCaption(context, caption, 0, env.size.height, env.size.width, env.size.band);
      return context.getImageData(0, 0, canvas.width, canvas.height);
    } finally {
      stub.destroy();
    }
  } finally {
    handle.destroy();
    box.remove();
  }
}

/**
 * The sandboxed fallback rig: as the browser rig, but each chunk plays
 * through a stand-in on the host while its sandboxed figure draws, and the
 * paint loop copies the figure's snapshots to the canvas the recorder
 * captures. Video-only, labelled fallback, and silent: captures never sound
 * sfx, so no notes reach the figure.
 */
export function createSandboxedFallbackRig(env: SandboxedFallbackRigEnv): {
  readonly openSession: (chunk: ExportPlanChunk) => Promise<FallbackSession>;
  readonly recorder: FallbackRecorder;
  readonly clock: { wait(ms: number): Promise<void> };
} {
  const doc = env.document;
  const canvas = doc.createElement('canvas');
  canvas.width = env.size.frameWidth;
  canvas.height = env.size.frameHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new ExportError('The fallback canvas has no 2D context');
  let current: { readonly handle: FigureHandle; readonly box: HTMLElement; readonly stub: ReturnType<typeof mountStubRuntime>; readonly controller: FilmController } | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false;
  const paint = async (): Promise<void> => {
    const live = current;
    if (!live || busy) return;
    busy = true;
    try {
      const png = await live.handle.snapshot();
      if (!png) return;
      drawPicture(context, await decodePicture(doc, png), env.size);
      paintExportCaption(context, live.controller.currentBeat?.step.say ?? '', 0, env.size.height, env.size.width, env.size.band);
    } catch {
      // A frame that fails to copy keeps the last one, as in clip recording.
    } finally {
      busy = false;
    }
  };
  const openSession = async (chunk: ExportPlanChunk): Promise<FallbackSession> => {
    if (current) throw new ExportError('The fallback plays one chunk at a time');
    const snapshot = env.snapshots(chunk.sceneId);
    if (!snapshot) throw new ExportError(`Scene "${chunk.sceneId}" has no checked scene to export`);
    const box = hiddenSandboxBox(doc, env.size.width);
    const handle = sandboxAdapter.mount(box, env.fragments(chunk.sceneId), {
      title: `Export: ${chunk.sceneId}`,
      film: true,
      autoplay: false,
      reducedMotion: false,
      seed: EXPORT_SEED,
    });
    if ((await handle.ready) !== 'live' || handle.state !== 'live') {
      handle.destroy();
      box.remove();
      throw new ExportError(`Scene "${chunk.sceneId}" did not start for export`);
    }
    const stub = mountStubRuntime(snapshot, { seed: EXPORT_SEED });
    const controller = new FilmController({ runtime: stub, film: chunk.film });
    controller.play();
    resumeFallbackPlayback(controller, chunk.film);
    pushAbsoluteState(handle, stub, controller.currentBeat?.step.cam ?? null);
    current = { handle, box, stub, controller };
    await paint();
    return {
      applyAhead: (seconds) => {
        if (!current) return;
        // The tick's update stays inside the stand-in; its landed state is what the figure draws.
        controller.tick(seconds);
        resumeFallbackPlayback(controller, chunk.film);
        pushAbsoluteState(handle, stub, controller.currentBeat?.step.cam ?? null);
      },
      destroy: () => {
        controller.destroy();
        stub.destroy();
        handle.destroy();
        box.remove();
        if (current?.handle === handle) current = null;
      },
    };
  };
  const rig: { active: { readonly recorder: MediaRecorder; readonly stopped: Promise<Uint8Array> } | null } = { active: null };
  const recorder: FallbackRecorder = {
    mimeType: fallbackRecorderType() ?? 'video/webm',
    start: () => {
      const type = fallbackRecorderType();
      if (!type) throw new ExportError('This browser records no video container');
      const view = globalThis as unknown as { MediaRecorder: typeof MediaRecorder };
      const stream = typeof canvas.captureStream === 'function' ? canvas.captureStream(env.fps) : null;
      if (!stream) throw new ExportError('This browser cannot capture its canvas');
      const active = new view.MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4_000_000 });
      const chunks: Blob[] = [];
      const stopped = new Promise<Uint8Array>((resolve) => {
        active.onstop = () => {
          void (async () => {
            stream.getTracks().forEach((track) => track.stop());
            const blob = new Blob(chunks, { type: type.split(';')[0] });
            resolve(new Uint8Array(await blob.arrayBuffer()));
          })();
        };
      });
      active.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      rig.active = { recorder: active, stopped };
      timer = setInterval(() => void paint(), 1000 / env.fps);
      active.start(250);
    },
    stop: async () => {
      const active = rig.active;
      rig.active = null;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      if (!active) return new Uint8Array(0);
      active.recorder.stop();
      return active.stopped;
    },
  };
  return { openSession, recorder, clock: { wait: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)) } };
}
