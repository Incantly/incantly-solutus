/**
 * One shared GPU context per page (performance design 4.1): a single
 * offscreen context draws every live figure, and each figure owns a visible
 * canvas the result is copied to. Figures never create their own context.
 * Used by `sdk` and `tiptap`; worker hosting (OffscreenCanvas) is the sdk's.
 */
import { okResult, viewError } from '../errors';
import { WebGL2Backend } from '../backends/webgl2';
import type { Result } from '@incantly/kernel';
import type { GpuBackend, Target } from '../core/gpu';

export interface FigureBox {
  readonly id: string;
  /** The figure that owns this box; another figure with the same id is refused. */
  readonly owner: object | null;
  readonly canvas: HTMLCanvasElement;
  readonly ctx2d: CanvasRenderingContext2D | null;
  target: Target | null;
  width: number;
  height: number;
}

/** Canvas creation, injected so tests can substitute. */
export interface CanvasFactory {
  createOffscreen(width: number, height: number): HTMLCanvasElement | null;
  createVisible(id: string, width: number, height: number): HTMLCanvasElement | null;
}

export const domCanvasFactory: CanvasFactory = {
  createOffscreen: (width: number, height: number): HTMLCanvasElement | null => {
    try {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.floor(width));
      c.height = Math.max(1, Math.floor(height));
      return c;
    } catch {
      return null;
    }
  },
  createVisible: (_id: string, width: number, height: number): HTMLCanvasElement | null => {
    try {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.floor(width));
      c.height = Math.max(1, Math.floor(height));
      c.style.width = `${width}px`;
      c.style.height = `${height}px`;
      return c;
    } catch {
      return null;
    }
  },
};

/** Straight (non-premultiplied) alpha, so the blit and the readback agree. */
const GL_OPTIONS = { antialias: false, alpha: true, depth: true, premultipliedAlpha: false } as const;

export interface SharedStats {
  boxes: number;
  presents: number;
  lastPresentMs: number;
}

/**
 * The page-wide GPU owner. WebGL2 when the browser offers it; otherwise boxes
 * still register and `present` becomes a no-op, so 2D Canvas figures keep
 * working through their own visible canvases.
 */
export class SharedGpuContext {
  private readonly boxes = new Map<string, FigureBox>();
  private backendValue: GpuBackend | null = null;
  private readonly stats: SharedStats = { boxes: 0, presents: 0, lastPresentMs: 0 };
  /** The offscreen canvas that owns the GL context. */
  private glCanvas: HTMLCanvasElement | null = null;
  private lostFlag = false;
  private gen = 0;
  private readonly restoreListeners = new Set<() => void>();
  /** Reused readback buffers for the fallback present path, per box id. */
  private readonly readback = new Map<string, { w: number; h: number; flipped: Uint8ClampedArray; image: ImageData }>();

  private constructor(readonly factory: CanvasFactory) {}

  /** The context was lost and has not been restored yet; nothing can draw. */
  isLost(): boolean {
    return this.lostFlag;
  }

  /** Bumps on every restore; resources built under an older number are dead. */
  generation(): number {
    return this.gen;
  }

  /** Call `cb` after a lost context came back and every box target was rebuilt. */
  onRestore(cb: () => void): () => void {
    this.restoreListeners.add(cb);
    return (): void => {
      this.restoreListeners.delete(cb);
    };
  }

  private readonly onContextLost = (e: Event): void => {
    // preventDefault asks the browser to restore the context later.
    e.preventDefault();
    this.lostFlag = true;
  };

  private readonly onContextRestored = (): void => {
    this.restore();
  };

  /**
   * After a restore every GL handle is dead: build a fresh back-end, give each
   * box a new target and bump the generation so each `Figure3D` rebuilds its
   * programs and arenas (V2).
   */
  private restore(): void {
    const canvas = this.glCanvas;
    if (canvas === null) return;
    let gl: unknown;
    try {
      gl = canvas.getContext('webgl2', GL_OPTIONS);
    } catch {
      gl = null;
    }
    // Old handles died with the context: drop them without deleting.
    this.backendValue = null;
    if (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) {
      this.backendValue = new WebGL2Backend(gl);
    }
    for (const box of this.boxes.values()) {
      box.target = null;
      this.readback.delete(box.id);
      if (this.backendValue !== null) {
        const made = this.backendValue.createTarget({
          width: Math.max(1, box.canvas.width), height: Math.max(1, box.canvas.height),
          samples: 4, depth: true, float: false,
        });
        if (made.ok) box.target = made.value;
      }
    }
    this.lostFlag = false;
    this.gen++;
    for (const cb of [...this.restoreListeners]) {
      try {
        cb();
      } catch {
        // A listener that throws does not stop the others.
      }
    }
  }

  static create(factory: CanvasFactory = domCanvasFactory): Result<SharedGpuContext> {
    const shared = new SharedGpuContext(factory);
    try {
      const off = factory.createOffscreen(16, 16);
      const gl = off?.getContext('webgl2', GL_OPTIONS);
      if (off !== null && off !== undefined && gl !== null && gl !== undefined) {
        // Any canvas that gave a context can lose it: listen before deciding
        // whether the context is one this back-end can use (VIEW-SM-6).
        shared.glCanvas = off;
        if (typeof off.addEventListener === 'function') {
          off.addEventListener('webglcontextlost', shared.onContextLost);
          off.addEventListener('webglcontextrestored', shared.onContextRestored);
        }
        if (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) {
          shared.backendValue = new WebGL2Backend(gl);
        }
      }
    } catch {
      shared.backendValue = null;
    }
    return okResult(shared);
  }

  backend(): GpuBackend | null {
    return this.backendValue;
  }

  hasGpu(): boolean {
    return this.backendValue !== null;
  }

  statsSnapshot(): SharedStats {
    return { ...this.stats, boxes: this.boxes.size };
  }

  acquireBox(id: string, widthCss: number, heightCss: number, dpr: number, owner: object | null = null): Result<FigureBox> {
    const old = this.boxes.get(id);
    if (old !== undefined) {
      // A box belongs to one figure (V2). Only the owner that holds it may
      // acquire it again; any other caller, named or not, is refused.
      if (owner === null || old.owner !== owner) {
        return viewError({
          kind: 'internal',
          messageKey: 'view.internal',
          params: { where: 'figure box already in use' },
          token: id,
          hint: 'Two figures use the same id. Give each figure its own id.',
        });
      }
      const resized = this.resizeBox(id, widthCss, heightCss, dpr);
      if (!resized.ok) return resized;
      return okResult(old);
    }
    const canvas = this.factory.createVisible(id, widthCss, heightCss);
    if (canvas === null) {
      return viewError({
        kind: 'internal',
        messageKey: 'view.internal',
        params: { where: 'figure canvas' },
        token: id,
      });
    }
    const pxW = Math.max(1, Math.floor(widthCss * dpr));
    const pxH = Math.max(1, Math.floor(heightCss * dpr));
    canvas.width = pxW;
    canvas.height = pxH;
    let ctx2d: CanvasRenderingContext2D | null;
    try {
      ctx2d = canvas.getContext('2d');
    } catch {
      ctx2d = null;
    }
    let target: Target | null = null;
    if (this.backendValue !== null) {
      const made = this.backendValue.createTarget({ width: pxW, height: pxH, samples: 4, depth: true, float: false });
      if (made.ok) target = made.value;
    }
    const box: FigureBox = { id, owner, canvas, ctx2d, target, width: widthCss, height: heightCss };
    this.boxes.set(id, box);
    return okResult(box);
  }

  resizeBox(id: string, widthCss: number, heightCss: number, dpr: number): Result<void> {
    const box = this.boxes.get(id);
    if (box === undefined) return okResult(undefined);
    box.width = widthCss;
    box.height = heightCss;
    const pxW = Math.max(1, Math.floor(widthCss * dpr));
    const pxH = Math.max(1, Math.floor(heightCss * dpr));
    box.canvas.width = pxW;
    box.canvas.height = pxH;
    box.canvas.style.width = `${widthCss}px`;
    box.canvas.style.height = `${heightCss}px`;
    this.readback.delete(id);
    if (this.backendValue !== null && !this.lostFlag) {
      box.target?.dispose();
      const made = this.backendValue.createTarget({ width: pxW, height: pxH, samples: 4, depth: true, float: false });
      box.target = made.ok ? made.value : null;
    }
    return okResult(undefined);
  }

  /** Release a box; with `owner`, only the figure that acquired it can release it. */
  releaseBox(id: string, owner: object | null = null): void {
    const box = this.boxes.get(id);
    if (box === undefined) return;
    if (owner !== null && box.owner !== null && box.owner !== owner) return;
    if (!this.lostFlag) box.target?.dispose();
    box.target = null;
    this.readback.delete(id);
    this.boxes.delete(id);
  }

  box(id: string): FigureBox | undefined {
    return this.boxes.get(id);
  }

  /**
   * Copy a figure's box to its visible canvas. The shared context resolves
   * the MSAA target and blits it to its own canvas; the visible
   * canvas copies that with `drawImage`, so no pixels pass through the CPU.
   * If the blit is not available the pixels are read back into buffers that
   * are reused from frame to frame.
   */
  present(id: string): Result<void> {
    const box = this.boxes.get(id);
    if (box === undefined || box.ctx2d === null || this.lostFlag) return okResult(undefined);
    const backend = this.backendValue;
    if (backend === null || box.target === null || backend.readPixels === undefined) return okResult(undefined);
    const w = box.canvas.width;
    const h = box.canvas.height;
    const t0 = performance.now();
    if (backend instanceof WebGL2Backend) {
      // Resolve through a throwaway frame handle over the same size.
      const size = { width: box.width, height: box.height, dpr: w / Math.max(box.width, 1) };
      backend.resolveFrame({ target: box.target, size, dispose: (): void => undefined });
      const gl = this.glCanvas;
      if (gl !== null) {
        if (gl.width < w) gl.width = w;
        if (gl.height < h) gl.height = h;
        const blitted = backend.blitToCanvas(box.target, w, h);
        if (blitted.ok) {
          try {
            box.ctx2d.clearRect(0, 0, w, h);
            box.ctx2d.drawImage(gl, 0, gl.height - h, w, h, 0, 0, w, h);
            this.stats.presents++;
            this.stats.lastPresentMs = performance.now() - t0;
            return okResult(undefined);
          } catch {
            // Fall through to the readback path.
          }
        }
      }
    }
    const pixels = backend.readPixels(box.target, { x: 0, y: 0, w, h });
    if (!pixels.ok) return pixels;
    try {
      let buf = this.readback.get(id);
      if (buf === undefined || buf.w !== w || buf.h !== h) {
        const flipped = new Uint8ClampedArray(w * h * 4);
        buf = { w, h, flipped, image: new ImageData(flipped, w, h) };
        this.readback.set(id, buf);
      }
      const row = w * 4;
      for (let y = 0; y < h; y++) {
        buf.flipped.set(pixels.value.subarray(y * row, y * row + row), (h - 1 - y) * row);
      }
      box.ctx2d.putImageData(buf.image, 0, 0);
    } catch {
      return viewError({
        kind: 'internal',
        messageKey: 'view.internal',
        params: { where: 'figure present' },
        token: id,
      });
    }
    this.stats.presents++;
    this.stats.lastPresentMs = performance.now() - t0;
    return okResult(undefined);
  }

  dispose(): void {
    const gl = this.glCanvas;
    if (gl !== null && typeof gl.removeEventListener === 'function') {
      gl.removeEventListener('webglcontextlost', this.onContextLost);
      gl.removeEventListener('webglcontextrestored', this.onContextRestored);
    }
    this.glCanvas = null;
    this.restoreListeners.clear();
    this.readback.clear();
    if (!this.lostFlag) for (const box of this.boxes.values()) box.target?.dispose();
    this.boxes.clear();
    this.backendValue?.dispose();
    this.backendValue = null;
  }
}
