/**
 * BR-83 (handoff/board/findings.md): a WebGL clear writes only what the depth and colour masks let through. A draw with
 * depth writes off (a quad laid over a picture, a see-through face) leaves the mask off, and the next frame's clear then
 * kept the target's old depth: the board's tiles are drawn one after another into one shared target, so parts of the
 * strokes and shapes of a tile drawn after such a draw failed the depth test against the last tile's and were missing
 * until it was drawn again. `beginFrame` must clear the whole target whatever the last draw left.
 */
import { describe, expect, it } from 'vitest';
import { WebGL2Backend } from '@incantly/view';
import { fakeGl } from './helpers';

/** A WebGL 2 stand-in that keeps the depth and colour masks and, for each clear, what they were. */
function maskedGl(): { gl: WebGL2RenderingContext; clears: { depth: boolean; color: boolean }[] } {
  const base = fakeGl() as unknown as Record<string, unknown>;
  const state = { depth: true, color: true };
  const clears: { depth: boolean; color: boolean }[] = [];
  const gl = new Proxy(
    {},
    {
      get: (_t, p) => {
        if (p === 'depthMask') return (on: boolean) => void (state.depth = on);
        if (p === 'colorMask') return (r: boolean, g: boolean, b: boolean, a: boolean) => void (state.color = r && g && b && a);
        if (p === 'clear') return () => void clears.push({ ...state });
        return base[p as string];
      },
    },
  ) as unknown as WebGL2RenderingContext;
  return { gl, clears };
}

describe('BR-83 a frame begins with the whole target cleared', () => {
  it('after a draw that left depth and colour writes off, beginFrame clears depth and colour', () => {
    const { gl, clears } = maskedGl();
    const backend = new WebGL2Backend(gl);
    const target = backend.createTarget({ width: 64, height: 64, samples: 4, depth: true, float: false });
    expect(target.ok).toBe(true);
    if (!target.ok) return;
    // what a draw with `depthWrite: false` and a masked colour leaves behind
    gl.depthMask(false);
    gl.colorMask(false, false, false, false);
    const frame = backend.beginFrame(target.value, { width: 64, height: 64, dpr: 1 });
    expect(frame.ok).toBe(true);
    expect(clears.at(-1)).toEqual({ depth: true, color: true });
  });
});
