/**
 * A WebGL 2 stand-in and a Canvas 2D stand-in that write every call into one list, in the order they happen, so a test can
 * see what a tile was drawn with and in what order (design 9 item 4). happy-dom has neither context. Only the calls a
 * test cares about are kept: GPU draw calls, copies of a picture into a texture, copies to the screen, and the Canvas 2D
 * calls that put ink or paper on a canvas.
 */
import { vi } from 'vitest';

/** One thing that happened: `gl:draw` (indexed draw call, with its index count), `gl:upload` (a whole tile layer copied into a texture), `gl:atlas` (a piece of text copied into the glyph atlas), `gl:blit` (a copy to the screen) or `2d:<method>`. */
export interface GlEvent {
  readonly what: string;
  /** The number of indices of a `gl:draw`. */
  readonly count?: number;
  /** Where a `gl:draw` went: `screen` is the canvas's own framebuffer (nothing the board draws goes there), `target` one of the back-end's targets. */
  readonly into?: 'screen' | 'target';
}

export interface GpuProbe {
  /** Every recorded call, in order. */
  readonly log: GlEvent[];
  /** How many contexts of each type were asked for. */
  readonly contexts: { webgl2: number; twoD: number };
  /** Forgets what was recorded so far. */
  clear(): void;
  restore(): void;
}

/** The Canvas 2D calls that put pixels down; the others (state, transforms) are not kept. */
const PAINTING = new Set(['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'drawImage', 'clearRect']);

/** Indices of a tile's picture drawn as one quad (two triangles). */
export const QUAD_INDICES = 6;

function fakeGl(log: GlEvent[]): WebGL2RenderingContext {
  let made = 0;
  let bound: unknown = null;
  return new Proxy(
    {},
    {
      get: (_t, p) => {
        if (typeof p !== 'string') return undefined;
        if (p === 'canvas') return null;
        if (p === 'isContextLost') return () => false;
        if (p === 'getError') return () => 0;
        if (p === 'getParameter') return () => 4096;
        if (p === 'getExtension') return () => ({});
        if (p === 'getShaderParameter' || p === 'getProgramParameter') return () => true;
        if (p === 'getShaderInfoLog' || p === 'getProgramInfoLog') return () => '';
        if (p === 'getUniformLocation') return () => ({});
        if (p === 'getAttribLocation') return () => 0;
        if (p === 'checkFramebufferStatus') return () => 1;
        if (/^(create|gen)/.test(p)) {
          return () => {
            made += 1;
            return { __id: made };
          };
        }
        if (p === 'bindFramebuffer') {
          return (_target: number, framebuffer: unknown) => {
            bound = framebuffer;
          };
        }
        if (p === 'drawElements' || p === 'drawElementsInstanced') {
          return (_mode: number, count: number) => {
            log.push({ what: 'gl:draw', count, into: bound === null ? 'screen' : 'target' });
          };
        }
        if (p === 'texSubImage2D') {
          // a whole tile layer is a picture 516 pixels square; the text atlas takes small ones, a piece of text at a time
          return (_t: number, _l: number, _x: number, _y: number, _f: number, _ty: number, source: { width?: number }) => {
            log.push({ what: (source.width ?? 0) >= 516 ? 'gl:upload' : 'gl:atlas' });
          };
        }
        if (p === 'blitFramebuffer') {
          return () => {
            log.push({ what: 'gl:blit' });
          };
        }
        if (/^[A-Z0-9_]+$/.test(p)) return 1;
        return () => undefined;
      },
    },
  ) as unknown as WebGL2RenderingContext;
}

/**
 * Makes `getContext('webgl2')` give a recording stand-in and `getContext('2d')` a recording context. The stand-in is
 * enough for the view package's WebGL 2 back-end to build its programs, targets and buffers, so the painter opens its
 * GPU path.
 */
export function installGpu(): GpuProbe {
  const log: GlEvent[] = [];
  const contexts = { webgl2: 0, twoD: 0 };
  const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) => {
    if (type === 'webgl2') {
      contexts.webgl2++;
      return fakeGl(log);
    }
    if (type !== '2d') return null;
    contexts.twoD++;
    return new Proxy(
      {},
      {
        get: (_t, name) => {
          if (typeof name !== 'string') return undefined;
          // a piece of text is 20 pixels wide and 13 tall, as far as the glyph atlas asks
          if (name === 'measureText') return () => ({ width: 20, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 20, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 3 });
          return (..._args: unknown[]): unknown => {
            if (PAINTING.has(name)) log.push({ what: `2d:${name}` });
            return undefined;
          };
        },
        set: () => true,
      },
    );
  }) as unknown as HTMLCanvasElement['getContext']);
  return {
    log,
    contexts,
    clear: () => {
      log.length = 0;
    },
    restore: () => spy.mockRestore(),
  };
}

/** `what` of every recorded event. */
export const whats = (probe: GpuProbe): string[] => probe.log.map((e) => e.what);

/** The events a tile's drawing made, as a short list of words: `paper-or-shapes` for a layer (the copy of its picture and the quad that shows it), `strokes` for a draw call of triangles. */
export function tileOrder(probe: GpuProbe): string[] {
  const out: string[] = [];
  for (const e of probe.log) {
    if (e.what === 'gl:upload') out.push('layer');
    else if (e.what === 'gl:draw' && (e.count ?? 0) > QUAD_INDICES) out.push('strokes');
  }
  return out;
}

/** How many draw calls and copies to the screen the log holds: what composing the tiles costs. */
export const composeCost = (probe: GpuProbe): number => probe.log.filter((e) => e.what === 'gl:blit' || (e.what === 'gl:draw' && e.count === QUAD_INDICES)).length;
