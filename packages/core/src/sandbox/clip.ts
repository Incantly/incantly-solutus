/**
 * A short video of a stage as it plays (PRD 6.10b). The drawing is copied to
 * a canvas as often as it can be, with the dot layers behind and in front of
 * it, and the browser's MediaRecorder records the canvas: WebM where the
 * browser makes it, MP4 otherwise. Equations go in as text, as in a PNG
 * snapshot, so the canvas stays readable and can be recorded.
 */
import { backgroundOf, rasterise } from './snapshot';

export interface ClipOptions {
  /** How long the clip runs, in seconds: 0.5 to 20. Default 4. */
  readonly seconds?: number;
  /** Frames per second: 4 to 30. Default 24. */
  readonly fps?: number;
}

export const CLIP_LIMITS = Object.freeze({ minSeconds: 0.5, maxSeconds: 20, minFps: 4, maxFps: 30, maxWidth: 1280, maxBytes: 64 * 1024 * 1024 });

/** Video formats in the order they are tried. */
const TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

/** Seconds and frames per second within the limits; missing or broken values take the defaults. */
export function clipSettings(options: ClipOptions = {}): { readonly seconds: number; readonly fps: number } {
  const pick = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  return {
    seconds: pick(options.seconds, 4, CLIP_LIMITS.minSeconds, CLIP_LIMITS.maxSeconds),
    fps: Math.round(pick(options.fps, 24, CLIP_LIMITS.minFps, CLIP_LIMITS.maxFps)),
  };
}

/** The first video format this browser can record, or null where it records none. */
export function clipType(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
  return TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

const even = (n: number) => Math.max(2, 2 * Math.round(n / 2));
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Records the stage for `seconds`, or resolves null where the browser cannot
 * record a canvas. Frames that are still being copied when the next is due
 * are skipped, so a slow drawing gives a clip at a lower frame rate, not a
 * slower one.
 */
export async function recordStage(svg: SVGSVGElement | null, options: ClipOptions = {}): Promise<Blob | null> {
  const type = clipType();
  if (!svg || !type) return null;
  const { seconds, fps } = clipSettings(options);
  const rect = svg.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return null;
  const scale = Math.min(window.devicePixelRatio || 1, CLIP_LIMITS.maxWidth / rect.width, 2);
  const canvas = svg.ownerDocument.createElement('canvas');
  // Video encoders want even sizes.
  canvas.width = even(rect.width * scale);
  canvas.height = even(rect.height * scale);
  const context = canvas.getContext('2d');
  if (!context || typeof canvas.captureStream !== 'function') return null;
  const background = backgroundOf(svg);
  const layers = (place: 'back' | 'front') => svg.parentElement?.querySelector<HTMLCanvasElement>(`canvas.inc-dots--${place}`) ?? null;
  let busy = false;
  const paint = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      const { image } = await rasterise(svg, true);
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (background) {
        context.fillStyle = background;
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      const back = layers('back');
      if (back && back.width > 0) context.drawImage(back, 0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const front = layers('front');
      if (front && front.width > 0) context.drawImage(front, 0, 0, canvas.width, canvas.height);
    } catch {
      // A frame that fails to copy keeps the last one.
    } finally {
      busy = false;
    }
  };
  await paint();
  const stream = canvas.captureStream(fps);
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4_000_000 });
  } catch {
    stream.getTracks().forEach((track) => track.stop());
    return null;
  }
  const chunks: Blob[] = [];
  let bytes = 0;
  recorder.ondataavailable = (event) => {
    if (event.data.size === 0 || bytes + event.data.size > CLIP_LIMITS.maxBytes) return;
    bytes += event.data.size;
    chunks.push(event.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  recorder.start(250);
  const timer = setInterval(() => void paint(), 1000 / fps);
  await wait(seconds * 1000);
  clearInterval(timer);
  recorder.stop();
  await stopped;
  stream.getTracks().forEach((track) => track.stop());
  return chunks.length > 0 ? new Blob(chunks, { type: type.split(';')[0] }) : null;
}
