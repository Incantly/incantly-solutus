/**
 * The 3D frame painter: scene items to GPU batches through any `GpuBackend`
 * (WebGL2 normally, the software target as fallback). Owns programs, arenas
 * and the per-frame batch plan; the host owns the target and the overlay.
 */
import type { ObjId } from '@incantly/kernel';
import type { KernelEvent, KernelView } from '../contracts';
import {
  buildCamera, projectPoint, quatRotate, quatConj, type Camera,
  type SpaceCameraProps, type V3,
} from '../core/camera';
import {
  depthKey, planBatches, planFrame,
  type BatchPlan, type ClipBox, type DrawItem, type HiddenLineMode,
} from '../core/scene';
import { SceneIndex } from '../core/scene';
import {
  createDrawStats, shaderSources,
  type Arena, type Batch, type DrawStats, type FrameCtx, type FrameSize, type GpuBackend,
  type Program, type ProgramKey, type Target, type VertexLayout,
} from '../core/gpu';
import type { StyleStore } from '../core/drawables';
import { unpackColor } from '../core/gpu';
import { okResult } from '../errors';
import type { Result } from '@incantly/kernel';

const MESH_LAYOUT: VertexLayout = {
  attributes: [{ name: 'aPos', size: 3 }, { name: 'aNor', size: 3 }, { name: 'aCol', size: 4 }],
  strideBytes: 40,
};
const POINT_LAYOUT: VertexLayout = {
  attributes: [{ name: 'aPos', size: 3 }, { name: 'aCol', size: 4 }, { name: 'aSize', size: 1 }],
  strideBytes: 32,
};
const LINE_LAYOUT: VertexLayout = {
  attributes: [{ name: 'aEnd', size: 2 }, { name: 'aOther', size: 2 }, { name: 'aSide', size: 1 }, { name: 'aCol', size: 4 }],
  strideBytes: 36,
};

export interface MeshData {
  readonly pos: Float32Array;
  readonly nor: Float32Array;
  readonly idx: Uint32Array;
}

export interface MeshProvider {
  get(key: string): MeshData | undefined;
}

export interface Paint3DInput {
  readonly backend: GpuBackend;
  readonly target: Target;
  readonly size: FrameSize;
  readonly cameraProps: SpaceCameraProps;
  readonly clip: ClipBox;
  readonly hidden: HiddenLineMode;
  /** `on`, `off` or `flat` (space-3d 8.5). */
  readonly light: 'on' | 'off' | 'flat';
  readonly background: { r: number; g: number; b: number; a: number };
}

export class Figure3D {
  readonly scene = new SceneIndex();
  private readonly programs = new Map<ProgramKey, Program>();
  private meshArena: Arena | null = null;
  private pointArena: Arena | null = null;
  private lineArena: Arena | null = null;
  private sceneVersion = 0;
  private uploadedVersion = -1;
  private meshRanges: Array<{ item: DrawItem; firstVertex: number; vertexCount: number; firstIndex: number; indexCount: number; alpha: number; closed: boolean }> = [];
  private pointRange = { firstVertex: 0, vertexCount: 0 };
  private origin: V3 = { x: 0, y: 0, z: 0 };
  camera: Camera | null = null;

  constructor(
    readonly kernel: KernelView,
    readonly styles: StyleStore,
    readonly meshes: MeshProvider,
  ) {}

  applyEvents(events: readonly KernelEvent[]): void {
    for (const e of events) {
      this.scene.applyEvent(e, (id) => this.buildItems(id));
      this.sceneVersion++;
    }
  }

  private buildItems(id: ObjId): DrawItem[] | null {
    const head = this.kernel.head(id);
    if (head === undefined) return null;
    const value = this.kernel.valueOf(id);
    if (!value.defined) return null;
    const authored = this.styles.authoredOf(id);
    const color = 0xff222831;
    void authored;
    const v = value.value;
    switch (v.k) {
      case 'point3':
        return [{ k: 'points', pos: new Float32Array([v.x, v.y, v.z]), size: 6, color, objId: id }];
      case 'mesh':
        return [{
          k: 'mesh',
          pos: new Float32Array(v.pos), nor: new Float32Array(v.nor), idx: new Uint32Array(v.idx),
          color, alpha: 1, closed: v.closed, objId: id,
        }];
      case 'meshref': {
        const m = this.meshes.get(v.key);
        if (m === undefined) return null;
        return [{
          k: 'mesh',
          pos: new Float32Array(m.pos), nor: new Float32Array(m.nor), idx: new Uint32Array(m.idx),
          color, alpha: 1, closed: true, objId: id,
        }];
      }
      case 'segment':
        return [{
          k: 'lines',
          pos: new Float32Array([v.ax, v.ay, 0, v.bx, v.by, 0]),
          width: 2, color, dash: null, closed: false, objId: id,
        }];
      case 'polyline':
      case 'curve': {
        const runs = v.k === 'polyline' ? [v.pts] : v.runs;
        const out: DrawItem[] = [];
        for (const run of runs) {
          const pos = new Float32Array(Math.floor(run.length / 2) * 3);
          for (let i = 0; i + 1 < run.length; i += 2) {
            pos[(i / 2) * 3] = run[i] ?? 0;
            pos[(i / 2) * 3 + 1] = run[i + 1] ?? 0;
          }
          out.push({ k: 'lines', pos, width: 2, color, dash: null, closed: false, objId: id });
        }
        return out;
      }
      case 'point':
        return [{ k: 'points', pos: new Float32Array([v.x, v.y, 0]), size: 6, color, objId: id }];
      case 'polygon': {
        const n = Math.floor(v.pts.length / 2);
        const pos = new Float32Array(n * 3);
        const nor = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          pos[i * 3] = v.pts[i * 2] ?? 0;
          pos[i * 3 + 1] = v.pts[i * 2 + 1] ?? 0;
          nor[i * 3 + 2] = 1;
        }
        const idx = new Uint32Array(Math.max(0, (n - 2) * 3));
        for (let i = 0; i + 2 < n; i++) {
          idx[i * 3] = 0;
          idx[i * 3 + 1] = i + 1;
          idx[i * 3 + 2] = i + 2;
        }
        return [{ k: 'mesh', pos, nor, idx, color, alpha: 0.35, closed: false, objId: id }];
      }
      default:
        return null;
    }
  }

  private ensureResources(backend: GpuBackend): Result<void> {
    if (this.programs.size === 0) {
      const src = shaderSources(backend.kind === 'webgpu' ? 'wgsl' : 'glsl');
      if (!src.ok) return src;
      for (const key of ['meshLit', 'lineQuad', 'pointImpostor'] as const) {
        const made = backend.createProgram(src.value[key]);
        if (!made.ok) return made;
        this.programs.set(key, made.value);
      }
    }
    if (this.meshArena === null) {
      const made = backend.createArena(MESH_LAYOUT, 24 * 1024 * 1024);
      if (!made.ok) return made;
      this.meshArena = made.value;
    }
    if (this.pointArena === null) {
      const made = backend.createArena(POINT_LAYOUT, 2 * 1024 * 1024);
      if (!made.ok) return made;
      this.pointArena = made.value;
    }
    if (this.lineArena === null) {
      const made = backend.createArena(LINE_LAYOUT, 8 * 1024 * 1024);
      if (!made.ok) return made;
      this.lineArena = made.value;
    }
    return okResult(undefined);
  }

  /** Compact rewrite of mesh/point arenas when the scene changed. */
  private uploadAll(): void {
    const meshArena = this.meshArena;
    const pointArena = this.pointArena;
    if (meshArena === null || pointArena === null) return;
    this.meshRanges = [];
    let voff = 0;
    let ioff = 0;
    for (const item of this.scene.all()) {
      if (item.k !== 'mesh') continue;
      const n = Math.floor(item.pos.length / 3);
      if (n === 0) continue;
      const col = unpackColor(item.color);
      const verts = new Float32Array(n * 10);
      for (let i = 0; i < n; i++) {
        verts[i * 10] = (item.pos[i * 3] ?? 0) - this.origin.x;
        verts[i * 10 + 1] = (item.pos[i * 3 + 1] ?? 0) - this.origin.y;
        verts[i * 10 + 2] = (item.pos[i * 3 + 2] ?? 0) - this.origin.z;
        verts[i * 10 + 3] = item.nor[i * 3] ?? 0;
        verts[i * 10 + 4] = item.nor[i * 3 + 1] ?? 0;
        verts[i * 10 + 5] = item.nor[i * 3 + 2] ?? 1;
        verts[i * 10 + 6] = col.r / 255;
        verts[i * 10 + 7] = col.g / 255;
        verts[i * 10 + 8] = col.b / 255;
        verts[i * 10 + 9] = col.a * item.alpha;
      }
      const idx = new Uint32Array(item.idx.length);
      for (let i = 0; i < item.idx.length; i++) idx[i] = (item.idx[i] ?? 0) + voff;
      meshArena.writeVertices(voff, verts);
      meshArena.writeIndices(ioff, idx);
      this.meshRanges.push({ item, firstVertex: voff, vertexCount: n, firstIndex: ioff, indexCount: idx.length, alpha: item.alpha, closed: item.closed });
      voff += n;
      ioff += idx.length;
    }
    let pcount = 0;
    for (const item of this.scene.all()) {
      if (item.k !== 'points') continue;
      const n = Math.floor(item.pos.length / 3);
      if (n === 0) continue;
      const col = unpackColor(item.color);
      const verts = new Float32Array(n * 8);
      for (let i = 0; i < n; i++) {
        verts[i * 8] = (item.pos[i * 3] ?? 0) - this.origin.x;
        verts[i * 8 + 1] = (item.pos[i * 3 + 1] ?? 0) - this.origin.y;
        verts[i * 8 + 2] = (item.pos[i * 3 + 2] ?? 0) - this.origin.z;
        verts[i * 8 + 3] = col.r / 255;
        verts[i * 8 + 4] = col.g / 255;
        verts[i * 8 + 5] = col.b / 255;
        verts[i * 8 + 6] = col.a;
        verts[i * 8 + 7] = item.size;
      }
      pointArena.writeVertices(pcount, verts);
      pcount += n;
    }
    this.pointRange = { firstVertex: 0, vertexCount: pcount };
    this.uploadedVersion = this.sceneVersion;
  }

  /**
   * Paint one frame: opaque meshes, CPU-projected line quads, point
   * impostors, the hidden-line pass and sorted transparents. Returns stats.
   */
  paint(input: Paint3DInput): Result<DrawStats> {
    const ready = this.ensureResources(input.backend);
    if (!ready.ok) return ready;
    const stats = createDrawStats();
    const bounds = this.scene.sceneBounds();
    this.origin = { x: Math.round(bounds.c.x), y: Math.round(bounds.c.y), z: Math.round(bounds.c.z) };
    const camera = buildCamera({
      props: input.cameraProps,
      viewport: { w: input.size.width, h: input.size.height, dpr: input.size.dpr },
      fitDist: Math.max(bounds.r * 2.2, 1e-6),
      fitRadius: Math.max(bounds.r, 1e-6),
    });
    this.camera = camera;
    if (this.uploadedVersion !== this.sceneVersion) this.uploadAll();
    const frame = input.backend.beginFrame(input.target, input.size);
    if (!frame.ok) return frame;
    const items = this.scene.visibleItems(camera.vp, input.clip.on ? input.clip : null);
    const batches = planBatches(items);
    const passes = planFrame({
      hasClosedTransparent: batches.transparent.some((i) => i.k === 'mesh' && i.closed),
      hidden: input.hidden,
      hasTransparent: batches.transparent.length > 0,
      floatTargets: input.backend.capabilities.floatTargets,
      stereo: false,
    })[0] ?? [];
    // Light fixed in camera space (space-3d 8.5), transformed to world.
    const keyCam = { x: -0.4, y: 0.6, z: 0.7 };
    const keyWorld = quatRotate(quatConj(camera.q), keyCam);
    const fillWorld = { x: -keyWorld.x, y: -keyWorld.y, z: -keyWorld.z };
    const clipMin: readonly [number, number, number, number] = input.clip.on
      ? [input.clip.min.x, input.clip.min.y, input.clip.min.z, 1]
      : [0, 0, 0, 0];
    const clipMax: readonly [number, number, number, number] = input.clip.on
      ? [input.clip.max.x, input.clip.max.y, input.clip.max.z, 0]
      : [0, 0, 0, 0];
    const meshProg = this.programs.get('meshLit');
    const lineProg = this.programs.get('lineQuad');
    const pointProg = this.programs.get('pointImpostor');
    if (meshProg === undefined || lineProg === undefined || pointProg === undefined) {
      return okResult(stats);
    }
    const vpF = new Float32Array(camera.vp);
    const meshUniforms = (alpha: number): Batch['uniforms'] => ({
      uVp: vpF,
      uOrigin: [this.origin.x, this.origin.y, this.origin.z],
      uClipMin: clipMin,
      uClipMax: clipMax,
      uKeyDir: [keyWorld.x, keyWorld.y, keyWorld.z],
      uFillDir: [fillWorld.x, fillWorld.y, fillWorld.z],
      uFlat: input.light === 'on' ? 0 : 1,
      uAlpha: alpha,
    });
    const drawBatch = (b: Batch): boolean => {
      const r = input.backend.draw(frame.value, b, stats);
      return r.ok;
    };
    for (const pass of passes) {
      if (pass === 'opaque' && this.meshArena !== null) {
        for (const range of this.meshRanges) {
          if (range.alpha < 0.999) continue;
          drawBatch({
            program: meshProg, arena: this.meshArena,
            firstVertex: range.firstVertex, vertexCount: range.vertexCount,
            firstIndex: range.firstIndex, indexCount: range.indexCount,
            mode: 'triangles', instances: 1, uniforms: meshUniforms(1),
            scissor: null, depthTest: true, depthFunc: 'less', depthWrite: true,
            blend: 'none', cullBack: true,
          });
        }
        this.drawLines(input, frame.value, batches, camera, lineProg, stats, false);
        if (this.pointArena !== null && this.pointRange.vertexCount > 0) {
          drawBatch({
            program: pointProg, arena: this.pointArena,
            firstVertex: this.pointRange.firstVertex, vertexCount: this.pointRange.vertexCount,
            firstIndex: 0, indexCount: 0,
            mode: 'points', instances: 1,
            uniforms: { uVp: vpF, uOrigin: [this.origin.x, this.origin.y, this.origin.z], uScale: camera.scale },
            scissor: null, depthTest: true, depthFunc: 'less', depthWrite: true,
            blend: 'none', cullBack: false,
          });
        }
      } else if (pass === 'hiddenLines') {
        this.drawLines(input, frame.value, batches, camera, lineProg, stats, true);
      } else if (pass === 'transparent' && this.meshArena !== null) {
        // Back-to-front by object centre (the no-WBOIT fallback).
        const sorted = this.meshRanges
          .filter((range) => range.alpha < 0.999)
          .map((range) => ({ range, key: depthKey(range.item, camera.eye) }))
          .sort((a, b) => b.key - a.key);
        for (const { range } of sorted) {
          drawBatch({
            program: meshProg, arena: this.meshArena,
            firstVertex: range.firstVertex, vertexCount: range.vertexCount,
            firstIndex: range.firstIndex, indexCount: range.indexCount,
            mode: 'triangles', instances: 1, uniforms: meshUniforms(range.alpha),
            scissor: null, depthTest: true, depthFunc: 'less', depthWrite: false,
            blend: 'alpha', cullBack: false,
          });
        }
      }
    }
    frame.value.dispose();
    return okResult(stats);
  }

  /**
   * 3D lines project on the CPU to screen-space quads through the 2D line
   * program (v1 approach; GPU-side 3D expansion is the later optimisation).
   */
  private drawLines(
    input: Paint3DInput,
    frame: FrameCtx,
    batches: BatchPlan,
    camera: Camera,
    program: Program,
    stats: DrawStats,
    hidden: boolean,
  ): void {
    const arena = this.lineArena;
    if (arena === null || batches.lines.length === 0) return;
    // Screen-space orthographic uVp: pixels to clip.
    const w = input.size.width;
    const h = input.size.height;
    const ortho = new Float32Array([
      2 / w, 0, 0, 0,
      0, -2 / h, 0, 0,
      0, 0, -1, 0,
      -1, 1, 0, 1,
    ]);
    const groups = new Map<string, { width: number; dashOn: number; dashOff: number; quads: number[]; cols: number[] }>();
    for (const item of batches.lines) {
      if (item.k !== 'lines') continue;
      const n = Math.floor(item.pos.length / 3);
      const col = unpackColor(item.color);
      const alpha = hidden ? col.a * 0.4 : col.a;
      const dashOn = hidden && input.hidden === 'dashed' ? 6 : (item.dash?.pattern[0] ?? 0);
      const dashOff = hidden && input.hidden === 'dashed' ? 4 : (item.dash?.pattern[1] ?? 0);
      const key = `${item.width}/${dashOn}/${dashOff}`;
      let g = groups.get(key);
      if (g === undefined) {
        g = { width: item.width, dashOn, dashOff, quads: [], cols: [] };
        groups.set(key, g);
      }
      const proj = (i: number): { x: number; y: number } | null => {
        const p = projectPoint(camera, {
          x: item.pos[i * 3] ?? 0, y: item.pos[i * 3 + 1] ?? 0, z: item.pos[i * 3 + 2] ?? 0,
        });
        return p.behind ? null : { x: p.x, y: p.y };
      };
      const segs = item.closed ? n : Math.max(n - 1, 0);
      for (let i = 0; i < segs; i++) {
        const a = proj(i);
        const b = proj((i + 1) % n);
        if (a === null || b === null) continue;
        const quad: ReadonlyArray<readonly [number, number, number, number, number]> = [
          [a.x, a.y, b.x, b.y, -1], [a.x, a.y, b.x, b.y, 1],
          [b.x, b.y, a.x, a.y, -1], [b.x, b.y, a.x, a.y, 1],
        ];
        for (const [ex, ey, ox, oy, side] of quad) {
          g.quads.push(ex, ey, ox, oy, side);
          g.cols.push(col.r / 255, col.g / 255, col.b / 255, alpha);
        }
      }
    }
    let voff = 0;
    let ioff = 0;
    for (const g of groups.values()) {
      const quads = g.quads.length / 5;
      if (quads === 0) continue;
      const verts = new Float32Array(quads * 9);
      for (let i = 0; i < quads; i++) {
        verts[i * 9] = g.quads[i * 5] ?? 0;
        verts[i * 9 + 1] = g.quads[i * 5 + 1] ?? 0;
        verts[i * 9 + 2] = g.quads[i * 5 + 2] ?? 0;
        verts[i * 9 + 3] = g.quads[i * 5 + 3] ?? 0;
        verts[i * 9 + 4] = g.quads[i * 5 + 4] ?? 0;
        verts[i * 9 + 5] = g.cols[i * 4] ?? 0;
        verts[i * 9 + 6] = g.cols[i * 4 + 1] ?? 0;
        verts[i * 9 + 7] = g.cols[i * 4 + 2] ?? 0;
        verts[i * 9 + 8] = g.cols[i * 4 + 3] ?? 0;
      }
      arena.writeVertices(voff, verts);
      const segs = Math.floor(quads / 4);
      const idx = new Uint32Array(segs * 6);
      for (let q = 0; q < segs; q++) {
        const v = voff + q * 4;
        idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], q * 6);
      }
      arena.writeIndices(ioff, idx);
      input.backend.draw(frame, {
        program,
        arena,
        firstVertex: voff,
        vertexCount: quads,
        firstIndex: ioff,
        indexCount: idx.length,
        mode: 'triangles',
        instances: 1,
        uniforms: {
          uVp: ortho,
          uViewport: [input.size.width, input.size.height],
          uWidth: g.width * input.size.dpr,
          uDashOn: g.dashOn,
          uDashOff: g.dashOff,
          uDashPhase: 0,
        },
        scissor: null,
        depthTest: !hidden,
        depthFunc: hidden ? 'greater' : 'less',
        depthWrite: false,
        blend: 'alpha',
        cullBack: false,
      }, stats);
      voff += quads;
      ioff += idx.length;
    }
  }

  dispose(): void {
    for (const p of this.programs.values()) p.dispose();
    this.programs.clear();
    this.meshArena?.dispose();
    this.pointArena?.dispose();
    this.lineArena?.dispose();
    this.meshArena = null;
    this.pointArena = null;
    this.lineArena = null;
  }
}
