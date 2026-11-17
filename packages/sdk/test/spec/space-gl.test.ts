/**
 * The WebGL 2 painter of the Space view and its software fallback (.kiro/specs/physics R10.5; docs/features/physics
 * design.md 12.1, errors.md 5 and 7). happy-dom has no WebGL, so the GPU itself is a stand-in here: the split between
 * the software painter and the GPU, the coarse fallback, the notice, and the GPU painter's buffers against a recording
 * WebGL 2 context. The real GL path is checked in Chrome by `bench/chrome-gl.mjs`.
 */
import { describe, expect, it } from 'vitest';
import { Figure, physics, space } from '@incantly/kernel';
import type { Result } from '@incantly/kernel';
import { MeshPainter3, gridTriangles } from '@incantly/view/gl';
import type { GlFrame3, GlPainted3, GlSheet3 } from '@incantly/view/gl';
import { createHeadlessApp } from '../../src/index';
import { sdkRegistry } from '../../src/registry';
import { dropDots, mountSpace, paintSpace, sceneOf3, sheetFaces, strideIndices } from '../../src/screen/index';
import type { DropsItem, Item3, Scene3, SheetItem, SpaceGpu } from '../../src/screen/index';

const SPLASH = [
  'g = Ground()',
  'w1 = Box((-1.6, 0, 0.9), 0.2, 3.4, 1.8)',
  'w1 with solid = true, opacity = 0.15',
  'water = Liquid(Box((0, 0, 0.5), 3, 3, 1), 600)',
  'ball = Body(Sphere((0.3, 0.2, 3.2), 0.45), density = 0.6)',
  'pool = Box((6, 0, -0.6), 6, 6, 1.2)',
  'sea = Waves(pool, 40)',
];

const make = (lines: readonly string[]): Figure => {
  const f = new Figure({ commands: sdkRegistry() });
  for (const l of lines) if (!f.apply(l).ok) throw new Error(l);
  return f;
};

/** A canvas-2D context that counts what it is asked to do. */
function countingCtx(): { ctx: CanvasRenderingContext2D; calls: Record<string, number>; dashes: number[][] } {
  const calls: Record<string, number> = {};
  const dashes: number[][] = [];
  const props = new Set(['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'font', 'textAlign', 'textBaseline', 'lineJoin', 'lineCap']);
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, p) => {
      if (typeof p !== 'string') return undefined;
      if (props.has(p)) return t[p];
      return (...a: unknown[]) => {
        calls[p] = (calls[p] ?? 0) + 1;
        if (p === 'setLineDash') dashes.push(a[0] as number[]);
        return undefined;
      };
    },
    set: (t, p, v) => {
      if (typeof p === 'string') t[p] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, dashes };
}

/** A synthetic 64 × 32 cloth, as round 9's `Cloth` hands the Space view. */
function cloth(id = 77, z = 1): SheetItem {
  const nx = 64;
  const ny = 32;
  const pos = new Float32Array(nx * ny * 3);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const o = (j * nx + i) * 3;
    pos[o] = -3 + (6 * i) / (nx - 1);
    pos[o + 1] = -1.5 + (3 * j) / (ny - 1);
    pos[o + 2] = z + 0.1 * Math.sin(i / 5);
  }
  return { k: 'sheet', id, name: 'flag', nx, ny, pos, color: '#3d7fd1', alpha: 1, threads: 8, occludes: true, coarse: 2, fine: 1 };
}

function drops(n = 2000): DropsItem {
  const pos = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    pos[k * 3] = (k % 20) * 0.1;
    pos[k * 3 + 1] = (Math.floor(k / 20) % 10) * 0.1;
    pos[k * 3 + 2] = Math.floor(k / 200) * 0.1;
  }
  return { k: 'drops', id: 78, name: 'water', pos, count: n, color: '#5aa7e8', alpha: 0.85, radius: 0.04 };
}

/** A GPU painter that records its frames and returns a 1 × 1 picture. */
function fakeGpu(fail = false): SpaceGpu & { frames: GlFrame3[] } {
  const frames: GlFrame3[] = [];
  const source = { width: 1, height: 1 } as unknown as HTMLCanvasElement;
  return {
    frames,
    paint(f: GlFrame3): Result<GlPainted3> {
      frames.push(f);
      if (fail) return { ok: false, kind: 'internal', message: 'lost' } as unknown as Result<GlPainted3>;
      return { ok: true, notices: [], value: { source, sw: 1, sh: 1, stats: { drawCalls: 2, triangles: 0, drops: 0, uploadBytes: 0, indexBuilds: 0 } } };
    },
  };
}

const sceneWith = (f: Figure, extra: Item3[]): { view: space.View3; scene: Scene3 } => {
  const view = space.viewOf(f);
  const s = sceneOf3(f, view);
  return { view, scene: { floor: s.floor, items: [...s.items, ...extra] } };
};

describe('the scene: sheets and drops are items of their own (R10.5, design 12.1)', () => {
  it('a liquid in space is one batch of drops and waves a sheet through the cell corners', () => {
    const f = make(SPLASH);
    for (let k = 1; k <= 30; k++) f.setClock(k / 60);
    const items = sceneOf3(f, space.viewOf(f)).items;
    const d = items.filter((i): i is DropsItem => i.k === 'drops');
    expect(d.length).toBe(1);
    expect(d[0]?.count).toBe(600);
    expect(d[0]?.pos.length).toBe(1800);
    expect(items.some((i) => i.k === 'dot')).toBe(false);
    const w = f.value('water') as physics.LiquidValue;
    expect(d[0]?.pos[3]).toBe(w.xs[1]);
    expect(d[0]?.pos[5]).toBe((w.zs as Float32Array)[1]);
    const sea = items.find((i): i is SheetItem => i.k === 'sheet');
    expect([sea?.nx, sea?.ny, sea?.threads, sea?.occludes]).toEqual([41, 41, 0, false]);
    // a grid of 40 is drawn by the software painter from every second corner, as in round 7
    expect(sea?.coarse).toBe(2);
    expect(sea?.fine).toBe(2);
  });

  it('every second point keeps the last row and column, so a coarse sheet has the same edges', () => {
    expect(strideIndices(64, 2)).toEqual([...Array.from({ length: 32 }, (_, i) => i * 2), 63]);
    expect(strideIndices(5, 1)).toEqual([0, 1, 2, 3, 4]);
    const s = cloth();
    const coarse = sheetFaces(s, 2);
    expect(coarse.length).toBe(32 * 16);
    expect(sheetFaces(s, 1).length).toBe(63 * 31);
    // threads every 8 points ride on the faces' sides, darker
    expect(coarse.filter((x) => x.edges?.some(Boolean)).length).toBeGreaterThan(0);
    expect(coarse.every((x) => x.stroke === '#224673')).toBe(true);
  });

  it('the clip box cuts the software faces and dots; the scene keeps sheets and drops whole for the GPU, which cuts per pixel', () => {
    const f = make([...SPLASH, 'space with clip = true, clipMin = (-1, -1, 0), clipMax = (1, 1, 0.5)']);
    for (let k = 1; k <= 30; k++) f.setClock(k / 60);
    const view = space.viewOf(f);
    const d = sceneOf3(f, view).items.find((i): i is DropsItem => i.k === 'drops');
    expect(d?.count).toBe(600);
    const box = { min: view.clipMin, max: view.clipMax };
    const kept = dropDots(d as DropsItem, 1, box);
    expect(kept.length).toBeLessThan(600);
    expect(kept.every((p) => p.p.z <= 0.5 + 1e-9 && Math.abs(p.p.x) <= 1 + 1e-9)).toBe(true);
    const faces = sheetFaces(cloth(77, 0.3), 1, box);
    expect(faces.every((x) => x.pts.every((p) => Math.abs(p.x) <= 1 + 1e-9 && Math.abs(p.y) <= 1 + 1e-9))).toBe(true);
  });

  it('seek equals play, and a reload of the saved script draws the same drops and waves', () => {
    const played = make(SPLASH);
    for (let k = 1; k <= 60; k++) played.setClock(k / 60);
    const sought = make(SPLASH);
    sought.setClock(1);
    const pick = (f: Figure): Float32Array[] => sceneOf3(f, space.viewOf(f)).items.filter((i): i is SheetItem | DropsItem => i.k === 'sheet' || i.k === 'drops').map((i) => i.pos);
    expect(pick(sought)).toEqual(pick(played));
    const a = createHeadlessApp({ mode: 'graphing3d', script: SPLASH.join('\n') });
    const b = createHeadlessApp({ mode: 'graphing3d', script: a.toScript() });
    a.clock.seek(0.75);
    b.clock.seek(0.75);
    expect(pick(b.figure)).toEqual(pick(a.figure));
  });
});

describe('the painter split (design 12.1)', () => {
  it('without WebGL 2, a screen draws a 64 × 32 cloth from every second point and every second drop, and names them', () => {
    const f = make(['g = Ground()']);
    const { view, scene } = sceneWith(f, [cloth(), drops()]);
    const p = paintSpace(countingCtx().ctx, view, 800, 600, scene, { coarse: true });
    expect(p.sheets).toBe('software');
    expect(p.coarse).toEqual(['flag', 'water']);
    const { ctx, calls } = countingCtx();
    paintSpace(ctx, view, 800, 600, scene, { coarse: true });
    // 32 × 16 faces and 1,000 drops (one arc each), against 63 × 31 and 2,000 in an SVG
    expect(calls['arc']).toBe(1000);
    const fine = countingCtx();
    const q = paintSpace(fine.ctx, view, 800, 600, scene);
    expect(q.coarse).toEqual([]);
    expect(fine.calls['arc']).toBe(2000);
    expect((fine.calls['fill'] ?? 0) - (calls['fill'] ?? 0)).toBe(63 * 31 - 32 * 16 + 1000);
  });

  it('waves are not drawn coarser than in round 7, so they raise no notice', () => {
    const f = make(SPLASH.slice(5).concat(['g = Ground()']));
    const view = space.viewOf(f);
    const p = paintSpace(countingCtx().ctx, view, 800, 600, sceneOf3(f, view), { coarse: true });
    expect(p.sheets).toBe('software');
    expect(p.coarse).toEqual([]);
  });

  it('with a GPU painter the sheets and drops go to it, its picture is copied in once, and only solids one cannot see through fill its depth', () => {
    const f = make(['g = Ground()', 'b = Sphere((0, 0, 0.5), 0.5)', 'b with opacity = 1', 'glass = Box((3, 0, 0.5), 1, 1, 1)', 'glass with opacity = 0.15']);
    const { view, scene } = sceneWith(f, [cloth(), drops()]);
    const gpu = fakeGpu();
    const { ctx, calls } = countingCtx();
    const p = paintSpace(ctx, view, 800, 600, scene, { gpu, pixelRatio: 2 });
    expect(p.sheets).toBe('gl');
    expect(p.gl?.drawCalls).toBe(2);
    expect(calls['drawImage']).toBe(1);
    expect(calls['arc'] ?? 0).toBe(0);
    const fr = gpu.frames[0] as GlFrame3;
    expect([fr.width, fr.height, fr.pixelRatio]).toEqual([800, 600, 2]);
    expect(fr.sheets.map((s) => [s.key, s.nx, s.ny, s.threads])).toEqual([[77, 64, 32, 8]]);
    expect(fr.drops.map((d) => d.count)).toEqual([2000]);
    // the points go to the GPU as they are: no copy on the page
    expect(fr.sheets[0]?.pos).toBe((scene.items.find((i) => i.k === 'sheet') as SheetItem).pos);
    // the ball's 288 faces become triangles for the depth pass (the poles are triangles); the glass box is left out
    const ballFaces = scene.items.filter((i) => i.k === 'face' && i.alpha >= 0.5 && i.occludes);
    const tris = ballFaces.reduce((s, i) => s + (i.k === 'face' ? i.pts.length - 2 : 0), 0);
    expect(fr.occluderVerts).toBe(3 * tris);
    expect(fr.occluders.length).toBeGreaterThanOrEqual(fr.occluderVerts * 3);
    expect(Array.from(fr.vp)).toEqual(Array.from(p.camera.vp));
  });

  it('a GPU frame that fails is drawn by the software painter instead, at full detail', () => {
    const f = make(['g = Ground()']);
    const { view, scene } = sceneWith(f, [cloth(), drops(100)]);
    const { ctx, calls } = countingCtx();
    const p = paintSpace(ctx, view, 800, 600, scene, { gpu: fakeGpu(true) });
    expect(p.sheets).toBe('software');
    expect(calls['drawImage'] ?? 0).toBe(0);
    expect(calls['arc']).toBe(100);
  });

  it('a cloth drawn by the GPU still dashes the lines behind it', () => {
    const f = make(['s = Segment((0, 0, 0.2), (0, 0, 0.4))']);
    const { view, scene } = sceneWith(f, [cloth(77, 1)]);
    const top = { ...view, elevation: Math.PI / 2 - 0.01 };
    const on = countingCtx();
    paintSpace(on.ctx, top, 800, 600, scene, { gpu: fakeGpu() });
    expect(on.dashes.some((d) => d.length === 2 && d[0] === 4)).toBe(true);
    const bare = sceneWith(f, []);
    const off = countingCtx();
    paintSpace(off.ctx, top, 800, 600, bare.scene, { gpu: fakeGpu() });
    expect(off.dashes.some((d) => d.length === 2 && d[0] === 4)).toBe(false);
  });

  it('a figure with no sheets or drops never asks the GPU', () => {
    const f = make(['g = Ground()', 'b = Sphere((0, 0, 0.5), 0.5)']);
    const gpu = fakeGpu();
    const view = space.viewOf(f);
    const p = paintSpace(countingCtx().ctx, view, 800, 600, sceneOf3(f, view), { gpu });
    expect(p.sheets).toBe('none');
    expect(gpu.frames.length).toBe(0);
  });
});

describe('the Space pane without WebGL 2 (errors.md 5, 7)', () => {
  it('says cloth_drawn_coarse once, names the object, and keeps drawing', () => {
    const f = make(SPLASH.slice(0, 4));
    const said: string[] = [];
    const pane = mountSpace({ figure: () => f, notice: (n) => said.push(`${n.kind}: ${n.message}`), styleBar: false });
    pane.paint();
    f.setClock(0.5);
    pane.paint();
    expect(pane.renderer()).toBe('software');
    expect(said).toEqual(['cloth_drawn_coarse: water is drawn coarser on this computer; it moves the same.']);
    expect(pane.notices().map((n) => [n.kind, n.code, n.severity])).toEqual([['cloth_drawn_coarse', 'B114', 'info']]);
    expect(pane.last()?.sheets).toBe('software');
    pane.dispose();
  });

  it('with a GPU painter it raises nothing', () => {
    const f = make(SPLASH.slice(0, 4));
    const said: string[] = [];
    const gpu = fakeGpu();
    const pane = mountSpace({ figure: () => f, notice: (n) => said.push(n.kind), gpu, styleBar: false });
    pane.paint();
    expect(pane.renderer()).toBe('webgl2');
    expect(said).toEqual([]);
    pane.dispose();
  });

  it('the notice is the kernel\'s, with its template', () => {
    const n = physics.makeNotice('cloth_drawn_coarse', { name: 'flag' }, []);
    expect([n.code, n.severity, n.message]).toEqual(['B114', 'info', 'flag is drawn coarser on this computer; it moves the same.']);
  });
});

/* ------------------------------ the GPU painter against a recording WebGL 2 context ------------------------------ */

function fakeGl(): { canvas: HTMLCanvasElement; log: string[]; lose(): void; restore(): void; set noGl(v: boolean) } {
  const log: string[] = [];
  let lost = false;
  let noGl = false;
  const listeners: Record<string, ((e: Event) => void)[]> = {};
  let n = 0;
  const gl = new Proxy({} as Record<string, unknown>, {
    get: (_t, p) => {
      if (typeof p !== 'string') return undefined;
      if (/^[A-Z0-9_]+$/.test(p)) return p.length;
      if (p === 'isContextLost') return () => lost;
      if (p.startsWith('create')) return () => ({ id: ++n, kind: p });
      if (p === 'getShaderParameter' || p === 'getProgramParameter') return () => true;
      if (p === 'getUniformLocation') return (_p: unknown, name: string) => ({ name });
      if (p === 'bufferData' || p === 'texStorage2D' || p === 'texSubImage2D' || p === 'drawElements' || p === 'drawArraysInstanced' || p === 'drawArrays') {
        return (...a: unknown[]) => log.push(`${p}:${String(a[0])}`);
      }
      return () => undefined;
    },
  });
  const canvas = {
    width: 1,
    height: 1,
    getContext: (k: string) => (k === 'webgl2' && !noGl ? gl : null),
    addEventListener: (k: string, f: (e: Event) => void) => (listeners[k] ??= []).push(f),
    removeEventListener: () => undefined,
  } as unknown as HTMLCanvasElement;
  return {
    canvas,
    log,
    lose: () => {
      lost = true;
      for (const f of listeners['webglcontextlost'] ?? []) f({ preventDefault: () => undefined } as Event);
    },
    restore: () => {
      lost = false;
      for (const f of listeners['webglcontextrestored'] ?? []) f({} as Event);
    },
    set noGl(v: boolean) {
      noGl = v;
    },
  };
}

const frameOf = (sheets: GlSheet3[], dropsCount = 0): GlFrame3 => ({
  width: 400, height: 300, pixelRatio: 2, vp: new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), rot: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, light: 'lit', clip: null, occluders: new Float32Array(9), occluderVerts: 3,
  sheets, drops: dropsCount > 0 ? [{ pos: new Float32Array(dropsCount * 3), count: dropsCount, color: [0, 0, 1], alpha: 0.85, radius: 0.05 }] : [],
});

const glSheet = (key: number, nx = 64, ny = 32, extra: Partial<GlSheet3> = {}): GlSheet3 => ({ key, nx, ny, pos: new Float32Array(nx * ny * 3), color: [0.2, 0.4, 0.8], alpha: 1, threads: 8, ...extra });

describe('MeshPainter3, the WebGL 2 painter (design 12.1)', () => {
  it('no WebGL 2 is the host fault webgl_unavailable, as a result, not a throw', () => {
    const g = fakeGl();
    g.noGl = true;
    const r = MeshPainter3.create(g.canvas);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.token).toBe('webgl_unavailable');
  });

  it('a sheet\'s triangles are made once; each frame copies only its points, and the drops are one instanced call', () => {
    const g = fakeGl();
    const r = MeshPainter3.create(g.canvas);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.value;
    const a = p.paint(frameOf([glSheet(1)], 2000));
    expect(a.ok && a.value.stats).toMatchObject({ indexBuilds: 1, drops: 2000, drawCalls: 3, triangles: 1 + 63 * 31 * 2 + 4000 });
    // the canvas grows to the frame's device pixels, and the picture is its top-left corner
    expect([g.canvas.width, g.canvas.height]).toEqual([800, 600]);
    expect(a.ok && [a.value.sw, a.value.sh]).toEqual([800, 600]);
    g.log.length = 0;
    const b = p.paint(frameOf([glSheet(1)], 2000));
    expect(b.ok && b.value.stats.indexBuilds).toBe(0);
    expect(g.log.filter((l) => l.startsWith('texSubImage2D')).length).toBe(1);
    expect(g.log.filter((l) => l.startsWith('drawArraysInstanced')).length).toBe(1);
    expect(g.log.filter((l) => l.startsWith('texStorage2D')).length).toBe(0);
    // 64 × 32 points of 12 bytes, 2,000 drops of 12, and the depth triangle
    expect(b.ok && b.value.stats.uploadBytes).toBe(64 * 32 * 12 + 2000 * 12 + 36);
  });

  it('a new topology (a torn cloth) makes the triangles again; bad triangles are dropped', () => {
    const g = fakeGl();
    const r = MeshPainter3.create(g.canvas);
    if (!r.ok) throw new Error('no painter');
    const p = r.value;
    p.paint(frameOf([glSheet(1)]));
    const torn = gridTriangles(64, 32).slice(6);
    const c = p.paint(frameOf([glSheet(1, 64, 32, { tris: torn, topology: 1 })]));
    expect(c.ok && c.value.stats.indexBuilds).toBe(1);
    expect(c.ok && c.value.stats.triangles).toBe(1 + torn.length / 3);
    const bad = Uint32Array.from([0, 1, 64, 0, 1, 99999]);
    const d = p.paint(frameOf([glSheet(1, 64, 32, { tris: bad, topology: 2 })]));
    expect(d.ok && d.value.stats.triangles).toBe(2);
    // a sheet too small or with too few points is skipped
    const e = p.paint(frameOf([glSheet(2, 1, 1), { ...glSheet(3), pos: new Float32Array(3) }]));
    expect(e.ok && e.value.stats.drawCalls).toBe(1);
  });

  it('a lost context is a result; once it is back, everything is made again', () => {
    const g = fakeGl();
    const r = MeshPainter3.create(g.canvas);
    if (!r.ok) throw new Error('no painter');
    const p = r.value;
    p.paint(frameOf([glSheet(1)]));
    expect(p.kept()).toBe(1);
    g.lose();
    const lost = p.paint(frameOf([glSheet(1)]));
    expect(lost.ok).toBe(false);
    if (!lost.ok) expect(lost.token).toBe('webgl_lost');
    g.restore();
    const back = p.paint(frameOf([glSheet(1)]));
    expect(back.ok && back.value.stats.indexBuilds).toBe(1);
    p.dispose();
    expect(p.kept()).toBe(0);
  });
});
