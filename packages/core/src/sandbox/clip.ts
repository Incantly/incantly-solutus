/**
 * A short video of a figure's drawing as it plays (PRD 6.10b). Each stage is
 * copied to a canvas as often as it can be, layer by layer as it is stacked
 * (the back layer, the canvases behind, the drawing, the canvases in front),
 * where it sits on the page, so a figure of two panels is recorded whole;
 * the browser's MediaRecorder records the canvas: WebM where the browser
 * makes it, MP4 otherwise. Equations go in as text, as in a PNG snapshot, so
 * the canvas stays readable and can be recorded.
 */
import { backgroundOf, paintStages, placeStages, stackPictures, type PictureCache } from './snapshot';

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

/** Records one stage; see recordStages. */
export async function recordStage(svg: SVGSVGElement | null, options: ClipOptions = {}): Promise<Blob | null> {
  return recordStages(svg ? [svg] : [], options);
}

/**
 * Records a figure's stages for `seconds`, or resolves null where the browser
 * cannot record a canvas. Frames that are still being copied when the next
 * is due are skipped, so a slow drawing gives a clip at a lower frame rate,
 * not a slower one.
 */
export async function recordStages(svgs: readonly SVGSVGElement[], options: ClipOptions = {}): Promise<Blob | null> {
  const type = clipType();
  const first = svgs[0];
  if (!first || !type) return null;
  const { seconds, fps } = clipSettings(options);
  if (!svgs.every((svg) => svg.getBoundingClientRect().width > 0)) return null;
  const { stages, width, height } = placeStages(svgs);
  if (!(width > 1 && height > 1)) return null;
  const scale = Math.min(window.devicePixelRatio || 1, CLIP_LIMITS.maxWidth / width, 2);
  const canvas = first.ownerDocument.createElement('canvas');
  // Video encoders want even sizes.
  canvas.width = even(width * scale);
  canvas.height = even(height * scale);
  const context = canvas.getContext('2d');
  if (!context || typeof canvas.captureStream !== 'function') return null;
  const background = backgroundOf(first);
  // A layer that has not changed since the last frame, such as the back layer under a fluid, is not decoded again.
  const caches: PictureCache[] = stages.map(() => new Map());
  // Even sizes may round the canvas up a pixel: stages are drawn at the scale of its width.
  const drawScale = canvas.width / width;
  let busy = false;
  const paint = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      const pictures = await Promise.all(stages.map((stage, i) => stackPictures(stage.svg, true, caches[i])));
      paintStages(context, stages, pictures, drawScale, background);
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
