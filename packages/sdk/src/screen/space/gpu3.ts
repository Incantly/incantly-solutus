/**
 * The Space view's WebGL 2 painter for the page (physics design 12.1): one context for every Space view and the PNG
 * export, on a canvas that is never shown; each user copies its picture with `drawImage` (performance 4.1). Without
 * WebGL 2 there is none, the host fault `webgl_unavailable`, and the software painter draws sheets and drops coarser.
 */
import type { Result } from '@incantly/kernel';
import { MeshPainter3 } from '@incantly/view/gl';
import type { GlFrame3, GlPainted3 } from '@incantly/view/gl';

/** What the software painter asks of a GPU painter: one frame of sheets and drops. `MeshPainter3` is one. */
export interface SpaceGpu {
  paint(frame: GlFrame3): Result<GlPainted3>;
}

let shared: { gpu: SpaceGpu | undefined } | undefined;

function makeCanvas(): HTMLCanvasElement | OffscreenCanvas | undefined {
  try {
    const doc = (globalThis as { document?: Document }).document;
    if (doc && typeof doc.createElement === 'function') {
      const c = doc.createElement('canvas');
      c.width = 1;
      c.height = 1;
      return c;
    }
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(1, 1);
  } catch {
    // no canvas here: the software painter draws
  }
  return undefined;
}

/** The page's WebGL 2 painter, made on first use; `undefined` when this browser has no WebGL 2. */
export function sharedSpaceGpu(): SpaceGpu | undefined {
  if (shared) return shared.gpu;
  const canvas = makeCanvas();
  const p = canvas ? MeshPainter3.create(canvas) : undefined;
  shared = { gpu: p?.ok ? p.value : undefined };
  return shared.gpu;
}

/** `webgl_unavailable` when the page has no WebGL 2 for the Space view (physics errors.md 7). */
export function spaceGpuFault(): 'webgl_unavailable' | undefined {
  return sharedSpaceGpu() ? undefined : 'webgl_unavailable';
}

/** Forgets the page's painter (tests, or a host that wants to try again). */
export function resetSpaceGpu(): void {
  const g = shared?.gpu;
  if (g instanceof MeshPainter3) g.dispose();
  shared = undefined;
}
