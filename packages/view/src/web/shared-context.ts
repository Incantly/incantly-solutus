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

  private constructor(readonly factory: CanvasFactory) {}

  static create(factory: CanvasFactory = domCanvasFactory): Result<SharedGpuContext> {
    const shared = new SharedGpuContext(factory);
    try {
      const off = factory.createOffscreen(16, 16);
      const gl = off?.getContext('webgl2', { antialias: false, alpha: true, depth: true });
      if (gl instanceof WebGL2RenderingContext) {
        shared.backendValue = new WebGL2Backend(gl);
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

  acquireBox(id: string, widthCss: number, heightCss: number, dpr: number): Result<FigureBox> {
    const old = this.boxes.get(id);
    if (old !== undefined) {
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
    const box: FigureBox = { id, canvas, ctx2d, target, width: widthCss, height: heightCss };
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
    if (this.backendValue !== null) {
      box.target?.dispose();
      const made = this.backendValue.createTarget({ width: pxW, height: pxH, samples: 4, depth: true, float: false });
      box.target = made.ok ? made.value : null;
    }
    return okResult(undefined);
  }

  releaseBox(id: string): void {
    const box = this.boxes.get(id);
    if (box === undefined) return;
    box.target?.dispose();
    box.target = null;
    this.boxes.delete(id);
  }

  box(id: string): FigureBox | undefined {
    return this.boxes.get(id);
  }

  /**
   * Copy a figure's box to its visible canvas. The shared context resolves
   * the MSAA target, reads the pixels and paints them into the 2D canvas.
   */
  present(id: string): Result<void> {
    const box = this.boxes.get(id);
    if (box === undefined || box.ctx2d === null) return okResult(undefined);
    const backend = this.backendValue;
    if (backend === null || box.target === null || backend.readPixels === undefined) return okResult(undefined);
    if (backend instanceof WebGL2Backend && box.target !== null) {
      // Resolve through a throwaway frame handle over the same size.
      const size = { width: box.width, height: box.height, dpr: box.canvas.width / Math.max(box.width, 1) };
      backend.resolveFrame({ target: box.target, size, dispose: (): void => undefined });
    }
    const w = box.canvas.width;
    const h = box.canvas.height;
    const t0 = performance.now();
    const pixels = backend.readPixels(box.target, { x: 0, y: 0, w, h });
    if (!pixels.ok) return pixels;
    try {
      const flipped = new Uint8ClampedArray(pixels.value.length);
      const row = w * 4;
      for (let y = 0; y < h; y++) {
        flipped.set(pixels.value.subarray(y * row, y * row + row), (h - 1 - y) * row);
      }
      box.ctx2d.putImageData(new ImageData(flipped, w, h), 0, 0);
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
    for (const box of this.boxes.values()) box.target?.dispose();
    this.boxes.clear();
    this.backendValue?.dispose();
    this.backendValue = null;
  }
}
