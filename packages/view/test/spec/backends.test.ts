/**
 * performance.md 2 and space-3d 9.1/9.5: the GPU interface and its back-ends
 * (WebGL 2 through a stub context, software, Canvas2D through a recording
 * context), shader sources, colour packing and the batch packers.
 */
import { describe, expect, it } from 'vitest';
import {
  CanvasSurface,
  SOFTWARE_TRIANGLE_CAP,
  SoftwareBackend,
  WebGL2Backend,
  packColor,
  packLineQuads,
  packPointInstances,
  shaderSources,
  unpackColor,
} from '@incantly/view';
import type { ProgramKey, VertexLayout } from '@incantly/view';
import { fakeGl, okValue, recordingContext } from './helpers';

const layout: VertexLayout = { attributes: [{ name: 'pos', size: 3 }, { name: 'col', size: 1 }], strideBytes: 16 };
const red = { r: 255, g: 0, b: 0, a: 1 };

describe('performance 2 shaders written once', () => {
  const keys: ProgramKey[] = ['meshLit', 'meshFlat', 'lineQuad', 'pointImpostor', 'particle', 'composite'];

  it('2 GLSL ES 3.00 sources exist for every program', () => {
    const src = okValue(shaderSources('glsl'), 'glsl');
    for (const k of keys) {
      expect(src[k].vertex.length).toBeGreaterThan(20);
      expect(src[k].fragment.length).toBeGreaterThan(20);
      expect(Array.isArray(src[k].uniforms)).toBe(true);
    }
  });

  it('9.1 sources use the GLSL ES 3.00 version line', () => {
    const src = okValue(shaderSources('glsl'), 'glsl');
    for (const k of keys) {
      expect(src[k].vertex.trimStart().startsWith('#version 300 es')).toBe(true);
      expect(src[k].fragment.trimStart().startsWith('#version 300 es')).toBe(true);
    }
  });

  it('9.1 programs differ from each other', () => {
    const src = okValue(shaderSources('glsl'), 'glsl');
    const all = new Set(keys.map((k) => src[k].vertex + src[k].fragment));
    expect(all.size).toBe(keys.length);
  });

});

describe('space-3d 9.2 vertex colours are RGBA8 in a u32', () => {
  // Rgba in this package is r, g, b in 0..255 and alpha in 0..1 (styles.ts `Rgba`, ui.md colours).
  it('9.2 packing is lossless for 8-bit channels', () => {
    const c = unpackColor(packColor(10, 20, 30, 1));
    expect([c.r, c.g, c.b]).toEqual([10, 20, 30]);
    expect(c.a).toBeCloseTo(1, 2);
  });

  it('9.2 round trips for every channel value on a sample', () => {
    for (let v = 0; v < 256; v += 51) {
      const c = unpackColor(packColor(v, 255 - v, v, v / 255));
      expect([c.r, c.g, c.b]).toEqual([v, 255 - v, v]);
      expect(Math.abs(c.a - v / 255)).toBeLessThanOrEqual(1 / 255);
    }
  });

});

describe('performance 5 batching: one instanced draw', () => {
  const item = (i: number): { x: number; y: number; sizePx: number; r: number; g: number; b: number; a: number } =>
    ({ x: i, y: i * 2, sizePx: 4, r: 1, g: 0, b: 0, a: 1 });

  it('5 10,000 points pack into one set of typed arrays', () => {
    const items = Array.from({ length: 10000 }, (_v, i) => item(i));
    const { pos, col } = packPointInstances(items);
    expect(pos).toBeInstanceOf(Float32Array);
    expect(col).toBeInstanceOf(Float32Array);
    expect(pos.length % 10000).toBe(0);
    expect(col.length).toBe(40000);
  });

  it('5 point positions keep their order and values', () => {
    const { pos } = packPointInstances([item(3), item(7)]);
    expect(pos[0]).toBe(3);
    expect(pos[1]).toBe(6);
    const stride = pos.length / 2;
    expect(pos[stride]).toBe(7);
    expect(pos[stride + 1]).toBe(14);
  });

  it('9.2 line segments pack as screen-aligned quads of four vertices', () => {
    const segs = [
      { ax: 0, ay: 0, bx: 10, by: 0, r: 0, g: 0, b: 0, a: 1 },
      { ax: 5, ay: 5, bx: 5, by: 15, r: 1, g: 0, b: 0, a: 1 },
    ];
    const q = packLineQuads(segs);
    expect(q.sides.length).toBe(8);
    expect(q.ends.length).toBe(16);
    expect(q.others.length).toBe(16);
    expect(q.cols.length).toBe(32);
  });

});

describe('space-3d 9.5 software back-end', () => {
  function software(): SoftwareBackend {
    return new SoftwareBackend(recordingContext().ctx);
  }

  it('9.5 it is the second GpuBackend and reports kind software', () => {
    const be = software();
    expect(be.kind).toBe('software');
    be.dispose();
  });

  it('9.5 it is capped at 20,000 triangles', () => {
    expect(SOFTWARE_TRIANGLE_CAP).toBe(20000);
  });

  it('9.1 arenas hand out ranges and free them for reuse', () => {
    const be = software();
    const arena = okValue(be.createArena(layout, 16 * 100), 'arena');
    const a = arena.alloc(10);
    const b = arena.alloc(10);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).not.toBe(a);
    arena.free(a, 10);
    const c = arena.alloc(10);
    expect(c).toBeGreaterThanOrEqual(0);
    arena.dispose();
    be.dispose();
  });

  it('9.1 an arena that is full answers -1', () => {
    const be = software();
    const arena = okValue(be.createArena(layout, 16 * 10), 'arena');
    expect(arena.alloc(10)).toBeGreaterThanOrEqual(0);
    expect(arena.alloc(1)).toBe(-1);
    arena.dispose();
    be.dispose();
  });

});

describe('performance 2 the WebGL 2 back-end behind the GPU interface', () => {
  it('2 it reports kind webgl2 and its capabilities', () => {
    const be = new WebGL2Backend(fakeGl());
    expect(be.kind).toBe('webgl2');
    expect(be.capabilities.instancing).toBe(true);
    expect(be.capabilities.maxTextureSize).toBeGreaterThan(0);
    be.dispose();
  });

  it('2 a lost context returns errors instead of throwing', () => {
    const be = new WebGL2Backend(fakeGl({ lost: true }));
    expect(() => be.createArena(layout, 1600)).not.toThrow();
    expect(() => be.createTarget({ width: 8, height: 8, samples: 0, depth: true, float: false })).not.toThrow();
    be.dispose();
  });

});

describe('graphics-view 6 the Canvas2D surface', () => {
  function surface(): { s: CanvasSurface; calls: string[] } {
    const { ctx, calls } = recordingContext();
    return { s: new CanvasSurface(ctx), calls };
  }

  it('6 save and restore reach the context in order', () => {
    const { s, calls } = surface();
    s.save();
    s.restore();
    expect(calls.filter((c) => c === 'save' || c === 'restore')).toEqual(['save', 'restore']);
  });

  it('6 a typed-array path becomes one moveTo then lineTo calls', () => {
    const { s, calls } = surface();
    s.path(new Float32Array([0, 0, 10, 0, 10, 10]));
    const geometry = calls.filter((c) => c === 'moveTo' || c === 'lineTo');
    expect(geometry).toEqual(['moveTo', 'lineTo', 'lineTo']);
  });

  it('6 a command path with a close emits closePath', () => {
    const { s, calls } = surface();
    s.path([{ k: 'M', x: 0, y: 0 }, { k: 'L', x: 4, y: 0 }, { k: 'L', x: 4, y: 4 }, { k: 'Z' }]);
    expect(calls).toContain('closePath');
  });

  it('6 stroke applies width and dash before stroking', () => {
    const { s, calls } = surface();
    s.path(new Float32Array([0, 0, 10, 0]));
    s.stroke({ color: red, width: 3, dash: [4, 2], dashPhase: 1, cap: 'butt', join: 'miter', miterLimit: 4, opacity: 1 });
    expect(calls).toContain('set:lineWidth=3');
    expect(calls).toContain('setLineDash');
    expect(calls.lastIndexOf('stroke')).toBeGreaterThan(calls.indexOf('set:lineWidth=3'));
  });

  it('6 stroke carries the miter limit, cap and join', () => {
    const { s, calls } = surface();
    s.path(new Float32Array([0, 0, 10, 0]));
    s.stroke({ color: red, width: 2, dash: [], dashPhase: 0, cap: 'round', join: 'round', miterLimit: 4, opacity: 1 });
    expect(calls).toContain('set:lineCap=round');
    expect(calls).toContain('set:lineJoin=round');
    expect(calls).toContain('set:miterLimit=4');
  });

  it('6 a solid fill sets the colour and fills the path', () => {
    const { s, calls } = surface();
    s.path(new Float32Array([0, 0, 10, 0, 10, 10]));
    s.fill({ kind: 'solid', color: red, opacity: 0.15 });
    expect(calls).toContain('fill');
    expect(calls.some((c) => c.startsWith('set:fillStyle='))).toBe(true);
  });

  it('9.6 fill opacity and stroke opacity are separate settings on the context', () => {
    const { s, calls } = surface();
    s.path(new Float32Array([0, 0, 10, 0, 10, 10]));
    s.fill({ kind: 'solid', color: red, opacity: 0.2 });
    s.stroke({ color: red, width: 2, dash: [], dashPhase: 0, cap: 'butt', join: 'miter', miterLimit: 4, opacity: 0.8 });
    const text = calls.join('|');
    expect(text.includes('0.2')).toBe(true);
    expect(text.includes('0.8')).toBe(true);
  });

});
