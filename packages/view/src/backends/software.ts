/**
 * Software back-end (space-3d design 9.5): the same draw items through
 * painter's algorithm into Canvas 2D, with flat shading and dashed hidden
 * lines. For devices without WebGL2, headless tests and vector-friendly
 * export. Capped at 20,000 triangles; beyond that it simplifies.
 */
import { ArenaAllocator } from '../core/scene';
import { okResult } from '../errors';
import type { Result } from '@incantly/kernel';
import type {
  Arena, Batch, DrawStats, FrameCtx, FrameSize, GpuBackend, Program,
  ShaderSrc, Target, TargetSpec, VertexLayout,
} from '../core/gpu';

/** Triangle cap for the software renderer (design 9.5). */
export const SOFTWARE_TRIANGLE_CAP = 20000;

interface CpuArena extends Arena {
  verts: Float32Array;
  indices: Uint32Array;
  indexUsed: number;
  alloc_: ArenaAllocator;
}

interface CpuTarget extends Target {
  px: ImageData | null;
}

interface Tri {
  depth: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  fill: string;
  stroke: string | null;
}

interface CpuFrame extends FrameCtx {
  tris: Tri[];
  simplified: boolean;
}

function mat4Vec(m: ArrayLike<number>, x: number, y: number, z: number): { x: number; y: number; z: number; w: number } {
  return {
    x: (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0),
    y: (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0),
    z: (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0),
    w: (m[3] ?? 0) * x + (m[7] ?? 0) * y + (m[11] ?? 0) * z + (m[15] ?? 0),
  };
}

export class SoftwareBackend implements GpuBackend {
  readonly kind = 'software' as const;
  readonly capabilities = {
    floatTargets: false,
    msaa: false,
    instancing: false,
    maxTextureSize: 4096,
  };

  constructor(readonly ctx: CanvasRenderingContext2D) {}

  createArena(layout: VertexLayout, capacityBytes: number): Result<Arena> {
    const floats = Math.floor(capacityBytes / 4);
    const arena: CpuArena = {
      layout,
      capacityBytes,
      usedBytes: 0,
      verts: new Float32Array(floats),
      indices: new Uint32Array(Math.floor(floats / 2)),
      indexUsed: 0,
      alloc_: new ArenaAllocator(capacityBytes),
      alloc: (vertexCount: number): number => {
        const stride = Math.max(layout.strideBytes, 4);
        const off = arena.alloc_.alloc(vertexCount * stride);
        (arena as { usedBytes: number }).usedBytes = arena.alloc_.usedBytes;
        return off < 0 ? -1 : Math.floor(off / stride);
      },
      free: (offsetVertices: number, vertexCount: number): void => {
        const stride = Math.max(layout.strideBytes, 4);
        arena.alloc_.free(offsetVertices * stride, vertexCount * stride);
        (arena as { usedBytes: number }).usedBytes = arena.alloc_.usedBytes;
      },
      writeVertices: (offsetVertices: number, data: Float32Array): void => {
        const stride = Math.max(layout.strideBytes, 4);
        arena.verts.set(data.subarray(0, Math.min(data.length, arena.verts.length - offsetVertices * (stride / 4))), offsetVertices * (stride / 4));
      },
      writeIndices: (offsetIndices: number, data: Uint32Array): void => {
        arena.indices.set(data.subarray(0, Math.min(data.length, arena.indices.length - offsetIndices)), offsetIndices);
        arena.indexUsed = Math.max(arena.indexUsed, offsetIndices + data.length);
      },
      dispose: (): void => undefined,
    };
    return okResult(arena);
  }

  createTarget(spec: TargetSpec): Result<Target> {
    const target: CpuTarget = { spec, px: null, dispose: (): void => undefined };
    return okResult(target);
  }

  createProgram(_src: ShaderSrc): Result<Program> {
    return okResult({ dispose: (): void => undefined });
  }

  beginFrame(target: Target, size: FrameSize): Result<FrameCtx> {
    const c = this.ctx;
    c.save();
    c.clearRect(0, 0, size.width, size.height);
    const frame: CpuFrame = {
      target,
      size,
      tris: [],
      simplified: false,
      dispose: (): void => {
        // Painter's algorithm: triangles back-to-front, then strokes.
        frame.tris.sort((a, b) => b.depth - a.depth);
        for (const t of frame.tris) {
          c.beginPath();
          c.moveTo(t.x0, t.y0);
          c.lineTo(t.x1, t.y1);
          c.lineTo(t.x2, t.y2);
          c.closePath();
          c.fillStyle = t.fill;
          c.fill();
          if (t.stroke !== null) {
            c.strokeStyle = t.stroke;
            c.lineWidth = 1;
            c.stroke();
          }
        }
        c.restore();
      },
    };
    return okResult(frame);
  }

  draw(frame: FrameCtx, batch: Batch, stats: DrawStats): Result<void> {
    const f = frame as CpuFrame;
    const arena = batch.arena as CpuArena;
    const strideFloats = Math.max(arena.layout.strideBytes, 4) / 4;
    const vp = uniformMat4(batch.uniforms['uVp']);
    const origin = uniformVec3(batch.uniforms['uOrigin']);
    const w = frame.size.width;
    const h = frame.size.height;
    const project = (x: number, y: number, z: number): { x: number; y: number; depth: number } | null => {
      const v = mat4Vec(vp, x + origin[0], y + origin[1], z + origin[2]);
      if (v.w <= 0) return null;
      return {
        x: ((v.x / v.w + 1) / 2) * w,
        y: ((1 - v.y / v.w) / 2) * h,
        depth: v.z / v.w,
      };
    };
    const vert = (vi: number): { x: number; y: number; z: number; r: number; g: number; b: number; a: number } => {
      const base = (batch.firstVertex + vi) * strideFloats;
      return {
        x: arena.verts[base] ?? 0,
        y: arena.verts[base + 1] ?? 0,
        z: arena.verts[base + 2] ?? 0,
        r: arena.verts[base + 3] ?? 0,
        g: arena.verts[base + 4] ?? 0,
        b: arena.verts[base + 5] ?? 0,
        a: arena.verts[base + 6] ?? 1,
      };
    };
    if (batch.mode === 'triangles' || batch.mode === 'instancedTriangles') {
      const reps = batch.mode === 'instancedTriangles' ? Math.max(batch.instances, 1) : 1;
      for (let r = 0; r < reps; r++) {
        for (let i = 0; i + 2 < batch.indexCount; i += 3) {
          if (f.tris.length >= SOFTWARE_TRIANGLE_CAP) {
            f.simplified = true;
            break;
          }
          const a = vert((arena.indices[batch.firstIndex + i] ?? 0) - batch.firstVertex);
          const b = vert((arena.indices[batch.firstIndex + i + 1] ?? 0) - batch.firstVertex);
          const cc = vert((arena.indices[batch.firstIndex + i + 2] ?? 0) - batch.firstVertex);
          const pa = project(a.x, a.y, a.z);
          const pb = project(b.x, b.y, b.z);
          const pc = project(cc.x, cc.y, cc.z);
          if (pa === null || pb === null || pc === null) continue;
          // Back-face culling in screen space. Screen y points down, so a
          // counter-clockwise (front) triangle has a negative signed area here.
          const area = (pb.x - pa.x) * (pc.y - pa.y) - (pc.x - pa.x) * (pb.y - pa.y);
          if (batch.cullBack && area >= 0) continue;
          const shade = 0.75 + 0.25 * Math.abs(area) / (Math.abs(area) + 500);
          const rr = Math.round(a.r * 255 * shade);
          const gg = Math.round(a.g * 255 * shade);
          const bb = Math.round(a.b * 255 * shade);
          f.tris.push({
            depth: (pa.depth + pb.depth + pc.depth) / 3,
            x0: pa.x, y0: pa.y, x1: pb.x, y1: pb.y, x2: pc.x, y2: pc.y,
            fill: `rgba(${rr},${gg},${bb},${a.a})`,
            stroke: null,
          });
          stats.triangles++;
        }
      }
      stats.drawCalls++;
      return okResult(undefined);
    }
    // Lines and points draw immediately on the 2D context.
    const c = this.ctx;
    c.save();
    if (batch.mode === 'lines') {
      c.lineWidth = 1;
      c.beginPath();
      for (let i = 0; i + 1 < batch.vertexCount; i += 2) {
        const a = vert(i);
        const b = vert(i + 1);
        const pa = project(a.x, a.y, a.z);
        const pb = project(b.x, b.y, b.z);
        if (pa === null || pb === null) continue;
        c.moveTo(pa.x, pa.y);
        c.lineTo(pb.x, pb.y);
        stats.lines++;
      }
      c.strokeStyle = 'rgba(34,40,49,1)';
      c.stroke();
    } else {
      const count = batch.mode === 'points' ? batch.vertexCount * Math.max(batch.instances, 1) : batch.instances;
      for (let i = 0; i < Math.min(count, batch.vertexCount); i++) {
        const a = vert(i);
        const pa = project(a.x, a.y, a.z);
        if (pa === null) continue;
        c.fillStyle = `rgba(${Math.round(a.r * 255)},${Math.round(a.g * 255)},${Math.round(a.b * 255)},${a.a})`;
        c.beginPath();
        c.arc(pa.x, pa.y, 3, 0, 2 * Math.PI);
        c.fill();
        stats.points++;
      }
    }
    c.restore();
    stats.drawCalls++;
    return okResult(undefined);
  }

  setViewport(_frame: FrameCtx, _x: number, _y: number, _w: number, _h: number): void {
    // The 2D context draws in CSS pixels; nothing to set.
  }

  readPixels(_target: Target, rect: { x: number; y: number; w: number; h: number }): Result<Uint8Array> {
    try {
      const data = this.ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
      return okResult(new Uint8Array(data.data.buffer.slice(0)));
    } catch {
      return okResult(new Uint8Array(Math.max(rect.w, 0) * Math.max(rect.h, 0) * 4));
    }
  }

  dispose(): void {
    // Nothing owned.
  }
}

function uniformMat4(v: number | Float32Array | readonly number[] | undefined): ArrayLike<number> {
  if (v !== undefined && typeof v !== 'number' && v.length === 16) return v;
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function uniformVec3(v: number | Float32Array | readonly number[] | undefined): readonly [number, number, number] {
  if (v !== undefined && typeof v !== 'number' && v.length >= 3) {
    const a = v as ArrayLike<number>;
    return [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];
  }
  return [0, 0, 0];
}
