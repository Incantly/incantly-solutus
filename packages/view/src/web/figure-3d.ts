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
import { ArenaAllocator, SceneIndex } from '../core/scene';
import { DEFAULT_BUDGETS, type BudgetLimits } from '../core/budgets';
import { viewNotice } from '../errors';
import {
  createDrawStats, shaderSources,
  type Arena, type Batch, type DrawStats, type FrameCtx, type FrameSize, type GpuBackend,
  type Program, type ProgramKey, type Target, type VertexLayout,
} from '../core/gpu';
import type { StyleStore } from '../core/drawables';
import { unpackColor } from '../core/gpu';
import { okResult } from '../errors';
import type { Notice, Result } from '@incantly/kernel';

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
const MESH_ARENA_BYTES = 24 * 1024 * 1024;
const POINT_ARENA_BYTES = 2 * 1024 * 1024;
const LINE_ARENA_BYTES = 8 * 1024 * 1024;

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
  /**
   * The shared context's generation. A new number means the GPU context was
   * lost and restored: every program and arena built before is dead.
   */
  readonly generation?: number;
}

interface MeshSlot {
  readonly item: DrawItem;
  readonly firstVertex: number;
  readonly vertexCount: number;
  readonly firstIndex: number;
  readonly indexCount: number;
  readonly alpha: number;
  readonly closed: boolean;
}

export class Figure3D {
  readonly scene = new SceneIndex();
  private readonly programs = new Map<ProgramKey, Program>();
  private meshArena: Arena | null = null;
  private pointArena: Arena | null = null;
  private lineArena: Arena | null = null;
  private sceneVersion = 0;
  private uploadedVersion = -1;
  private resourceGen = -1;
  /** One arena range per mesh item; an event rewrites only the items it touched (V12). */
  private readonly meshSlots = new Map<DrawItem, MeshSlot>();
  private meshIndexAlloc: ArenaAllocator | null = null;
  private uploadedTriangles = 0;
  private meshRanges: MeshSlot[] = [];
  private uploadedPoints: DrawItem[] = [];
  private pointRange = { firstVertex: 0, vertexCount: 0 };
  private origin: V3 = { x: 0, y: 0, z: 0 };
  private originSet = false;
  /** Items left out because an arena or a budget was full (reported once per change). */
  readonly dropped = { triangles: 0, points: 0, lines: 0 };
  private reportedDropped = '';
  camera: Camera | null = null;

  constructor(
    readonly kernel: KernelView,
    readonly styles: StyleStore,
    readonly meshes: MeshProvider,
    private readonly budgets: BudgetLimits = DEFAULT_BUDGETS,
  ) {}

  /** A warning when items were dropped since the last report, else null. */
  pendingNotice(): Notice | null {
    const key = `${this.dropped.triangles}/${this.dropped.points}/${this.dropped.lines}`;
    if (key === this.reportedDropped) return null;
    this.reportedDropped = key;
    if (this.dropped.triangles === 0 && this.dropped.points === 0 && this.dropped.lines === 0) return null;
    return viewNotice(
      'warning',
      'V101',
      'The 3D figure is over its budget; some solids, points or lines are not drawn.',
      { what: '3D items', triangles: this.dropped.triangles, points: this.dropped.points, lines: this.dropped.lines },
    );
  }

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

  private ensureResources(backend: GpuBackend, generation: number): Result<void> {
    if (this.resourceGen !== generation) {
      // The GPU context was lost and restored: the old handles are dead, so
      // they are dropped without deleting and rebuilt below (V2, V12).
      this.programs.clear();
      this.meshArena = null;
      this.pointArena = null;
      this.lineArena = null;
      this.meshIndexAlloc = null;
      this.meshSlots.clear();
      this.meshRanges = [];
      this.uploadedPoints = [];
      this.uploadedTriangles = 0;
      this.uploadedVersion = -1;
      this.originSet = false;
      this.resourceGen = generation;
    }
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
      const made = backend.createArena(MESH_LAYOUT, MESH_ARENA_BYTES);
      if (!made.ok) return made;
      this.meshArena = made.value;
      // Index space in elements: the arena keeps capacity / 8 index slots.
      this.meshIndexAlloc = new ArenaAllocator(Math.floor(MESH_ARENA_BYTES / 8) * 4);
      this.meshSlots.clear();
      this.uploadedVersion = -1;
    }
    if (this.pointArena === null) {
      const made = backend.createArena(POINT_LAYOUT, POINT_ARENA_BYTES);
      if (!made.ok) return made;
      this.pointArena = made.value;
      this.uploadedPoints = [];
      this.uploadedVersion = -1;
    }
    if (this.lineArena === null) {
      const made = backend.createArena(LINE_LAYOUT, LINE_ARENA_BYTES);
      if (!made.ok) return made;
      this.lineArena = made.value;
    }
    return okResult(undefined);
  }

  private freeSlot(slot: MeshSlot): void {
    this.meshArena?.free(slot.firstVertex, slot.vertexCount);
    this.meshIndexAlloc?.free(slot.firstIndex * 4, slot.indexCount * 4);
    this.uploadedTriangles = Math.max(0, this.uploadedTriangles - Math.floor(slot.indexCount / 3));
  }

  private resetMeshUploads(): void {
    for (const slot of this.meshSlots.values()) this.freeSlot(slot);
    this.meshSlots.clear();
    this.meshRanges = [];
    this.uploadedPoints = [];
    this.uploadedTriangles = 0;
  }

  /**
   * Bring the arenas up to date with the scene. Only items that are new since
   * the last upload are written and only items that are gone are freed, so
   * moving one point rewrites that point, not every mesh (V12). The origin
   * that coordinates are stored relative to moves only when the scene centre
   * has left it by more than the scene radius, which rewrites everything.
   */
  private syncUploads(): void {
    const meshArena = this.meshArena;
    const pointArena = this.pointArena;
    const indexAlloc = this.meshIndexAlloc;
    if (meshArena === null || pointArena === null || indexAlloc === null) return;
    const bounds = this.scene.sceneBounds();
    const centre = { x: Math.round(bounds.c.x), y: Math.round(bounds.c.y), z: Math.round(bounds.c.z) };
    const away = Math.hypot(centre.x - this.origin.x, centre.y - this.origin.y, centre.z - this.origin.z);
    if (!this.originSet || away > Math.max(1, bounds.r)) {
      this.resetMeshUploads();
      this.origin = centre;
      this.originSet = true;
    }
    const items = this.scene.all();
    const present = new Set<DrawItem>(items);
    for (const [item, slot] of this.meshSlots) {
      if (present.has(item)) continue;
      this.freeSlot(slot);
      this.meshSlots.delete(item);
    }
    let droppedTriangles = 0;
    for (const item of items) {
      if (item.k !== 'mesh' || this.meshSlots.has(item)) continue;
      const n = Math.floor(item.pos.length / 3);
      if (n === 0 || item.idx.length === 0) continue;
      const tris = Math.floor(item.idx.length / 3);
      if (this.uploadedTriangles + tris > this.budgets.triangles) {
        droppedTriangles += tris;
        continue;
      }
      const voff = meshArena.alloc(n);
      const ibyte = voff < 0 ? -1 : indexAlloc.alloc(item.idx.length * 4);
      if (voff < 0 || ibyte < 0) {
        if (voff >= 0) meshArena.free(voff, n);
        droppedTriangles += tris;
        continue;
      }
      const ioff = ibyte / 4;
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
      this.uploadedTriangles += tris;
      this.meshSlots.set(item, {
        item, firstVertex: voff, vertexCount: n, firstIndex: ioff, indexCount: idx.length,
        alpha: item.alpha, closed: item.closed,
      });
    }
    this.meshRanges = [];
    for (const item of items) {
      const slot = item.k === 'mesh' ? this.meshSlots.get(item) : undefined;
      if (slot !== undefined) this.meshRanges.push(slot);
    }
    // Points live in one compact range, rewritten only when the set of point items changed.
    const pointItems = items.filter((i) => i.k === 'points');
    const samePoints = pointItems.length === this.uploadedPoints.length &&
      pointItems.every((p, i) => p === this.uploadedPoints[i]);
    let droppedPoints = 0;
    if (!samePoints) {
      const capacity = Math.min(Math.floor(pointArena.capacityBytes / POINT_LAYOUT.strideBytes), this.budgets.pointsAndParticles);
      let total = 0;
      const kept: Array<{ item: DrawItem; n: number }> = [];
      for (const item of pointItems) {
        if (item.k !== 'points') continue;
        const n = Math.floor(item.pos.length / 3);
        if (n === 0) continue;
        if (total + n > capacity) {
          droppedPoints += n;
          continue;
        }
        total += n;
        kept.push({ item, n });
      }
      const verts = new Float32Array(total * 8);
      let at = 0;
      for (const { item, n } of kept) {
        if (item.k !== 'points') continue;
        const col = unpackColor(item.color);
        for (let i = 0; i < n; i++, at++) {
          verts[at * 8] = (item.pos[i * 3] ?? 0) - this.origin.x;
          verts[at * 8 + 1] = (item.pos[i * 3 + 1] ?? 0) - this.origin.y;
          verts[at * 8 + 2] = (item.pos[i * 3 + 2] ?? 0) - this.origin.z;
          verts[at * 8 + 3] = col.r / 255;
          verts[at * 8 + 4] = col.g / 255;
          verts[at * 8 + 5] = col.b / 255;
          verts[at * 8 + 6] = col.a;
          verts[at * 8 + 7] = item.size;
        }
      }
      if (total > 0) pointArena.writeVertices(0, verts);
      this.pointRange = { firstVertex: 0, vertexCount: total };
      this.uploadedPoints = pointItems;
    }
    this.dropped.triangles = droppedTriangles;
    this.dropped.points = droppedPoints;
    this.uploadedVersion = this.sceneVersion;
  }

  /**
   * Paint one frame: opaque meshes, CPU-projected line quads, point
   * impostors, the hidden-line pass and sorted transparents. Returns stats.
   */
  paint(input: Paint3DInput): Result<DrawStats> {
    const ready = this.ensureResources(input.backend, input.generation ?? 0);
    if (!ready.ok) return ready;
    const stats = createDrawStats();
    const bounds = this.scene.sceneBounds();
    const camera = buildCamera({
      props: input.cameraProps,
      viewport: { w: input.size.width, h: input.size.height, dpr: input.size.dpr },
      fitDist: Math.max(bounds.r * 2.2, 1e-6),
      fitRadius: Math.max(bounds.r, 1e-6),
    });
    this.camera = camera;
    if (this.uploadedVersion !== this.sceneVersion) this.syncUploads();
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
          .map((range) => ({ range, key: depthKey(range.item, camera.eye, this.scene.boundsOf(range.item)) }))
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
    // The line arena is written from the start on every call: segments past
    // its vertex or index space are not drawn and are counted (V12).
    const maxSegs = Math.min(
      Math.floor(arena.capacityBytes / LINE_LAYOUT.strideBytes / 4),
      Math.floor(arena.capacityBytes / 8 / 6),
    );
    let usedSegs = 0;
    let droppedSegs = 0;
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
        if (usedSegs >= maxSegs) {
          droppedSegs++;
          continue;
        }
        usedSegs++;
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
    if (!hidden) this.dropped.lines = droppedSegs;
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
    this.meshIndexAlloc = null;
    this.meshSlots.clear();
    this.meshRanges = [];
    this.uploadedPoints = [];
    this.uploadedTriangles = 0;
    this.uploadedVersion = -1;
    this.originSet = false;
  }
}
