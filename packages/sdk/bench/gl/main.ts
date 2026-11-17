/**
 * The synthetic scene of the WebGL 2 painter's Chrome bench (physics design 11.2, 12.1): a 64 × 32 sheet that ripples
 * over a ball, 2,000 drops falling in a box beside it, and the Space view's floor, axes and solids. `chrome-gl.mjs`
 * serves this page and drives `window.glBench`. `?soft=1` draws it with the software painter's coarse fallback, as on a
 * computer without WebGL 2.
 */
import { space } from '@incantly/kernel';
import { createHeadlessApp } from '../../src/app';
import { paintSpace } from '../../src/screen/space/paint3';
import type { Painted3 } from '../../src/screen/space/paint3';
import { sceneOf3 } from '../../src/screen/space/scene3';
import type { DropsItem, Item3, Scene3, SheetItem } from '../../src/screen/space/scene3';
import { sharedSpaceGpu } from '../../src/screen/space/gpu3';

const NX = 64;
const NY = 32;
const DROPS = 2000;

const app = createHeadlessApp({
  mode: 'graphing3d',
  script: [
    'ball = Sphere((0, 0, 0.7), 0.7)',
    'ball with color = orange, opacity = 1',
    'tank = Box((3.2, 0, 0.6), 2, 2, 1.2)',
    'tank with color = gray, opacity = 0.15',
    'space with target = (0.8, 0, 0.6), azimuth = -35deg, elevation = 28deg, zoom = 1.4',
  ].join('\n'),
});
const view = space.viewAt(app.figure);
const base = sceneOf3(app.figure, view);

const sheetPos = new Float32Array(NX * NY * 3);
const dropPos = new Float32Array(DROPS * 3);

/** The sheet and the drops at time t: what the physics worker would hand the page (untimed). */
function step(t: number): void {
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const x = -2.2 + (4.4 * i) / (NX - 1);
      const y = -1.1 + (2.2 * j) / (NY - 1);
      const r = Math.hypot(x, y);
      // draped over the ball, sagging away from it, with a travelling ripple
      const drape = r < 0.75 ? 1.45 - 0.35 * r * r : Math.max(0.05, 1.45 - 0.2 - 0.55 * (r - 0.75));
      const o = (j * NX + i) * 3;
      sheetPos[o] = x;
      sheetPos[o + 1] = y;
      sheetPos[o + 2] = drape + 0.06 * Math.sin(3 * x - 2.4 * t) * Math.cos(2 * y + t);
    }
  }
  for (let k = 0; k < DROPS; k++) {
    // a seeded spread in the tank, sloshing
    const a = (k * 0.61803398875) % 1;
    const b = (k * 0.7548776662) % 1;
    const c = (k * 0.5698402910) % 1;
    const o = k * 3;
    dropPos[o] = 2.3 + 1.8 * a + 0.15 * Math.sin(t * 2 + k);
    dropPos[o + 1] = -0.9 + 1.8 * b;
    dropPos[o + 2] = 0.06 + 0.7 * c + 0.12 * Math.sin(1.7 * t + 3 * a) * (0.5 + b);
  }
}

const sheet: SheetItem = { k: 'sheet', id: 9001, name: 'flag', nx: NX, ny: NY, pos: sheetPos, color: '#3d7fd1', alpha: 1, threads: 8, occludes: true, coarse: 2, fine: 1 };
const drops: DropsItem = { k: 'drops', id: 9002, name: 'water', pos: dropPos, count: DROPS, color: '#5aa7e8', alpha: 0.85, radius: 0.045 };
const full: Scene3 = { floor: base.floor, items: [...base.items, sheet, drops] as Item3[] };

const soft = new URLSearchParams(location.search).get('soft') === '1';
const gpu = soft ? undefined : sharedSpaceGpu();
const canvas = document.getElementById('view') as HTMLCanvasElement;
const info = document.getElementById('info') as HTMLDivElement;
const W = 1000;
const H = 640;
const dpr = window.devicePixelRatio || 1;
canvas.width = Math.round(W * dpr);
canvas.height = Math.round(H * dpr);
canvas.style.width = `${W}px`;
canvas.style.height = `${H}px`;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

function paint(scene: Scene3): Painted3 {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return paintSpace(ctx, view, W, H, scene, { pixelRatio: dpr, coarse: !gpu, ...(gpu ? { gpu } : {}) });
}

step(0);
const first = paint(full);
info.textContent = `${first.sheets === 'gl' ? 'WebGL 2' : 'software (coarse)'}: a ${NX} × ${NY} sheet and ${DROPS} drops`;

interface Run {
  readonly renderer: string;
  readonly frames: number;
  /** Per frame, ms: the whole Space view; the same without the sheet and drops; the difference is their draw. */
  readonly full: number[];
  readonly base: number[];
  readonly stats: unknown;
}

/** `frames` animation frames, alternating the scene with and without the sheet and drops. */
function bench(frames: number): Promise<Run> {
  const fullMs: number[] = [];
  const baseMs: number[] = [];
  let k = 0;
  let last: Painted3 | undefined;
  return new Promise((done) => {
    const tick = (): void => {
      step(k / 60);
      const withSheet = k % 2 === 0;
      const t0 = performance.now();
      const p = paint(withSheet ? full : base);
      const dt = performance.now() - t0;
      if (k >= 20) (withSheet ? fullMs : baseMs).push(dt);
      if (withSheet) last = p;
      k++;
      if (k < frames + 20) requestAnimationFrame(tick);
      else done({ renderer: last?.sheets ?? 'none', frames, full: fullMs, base: baseMs, stats: last?.gl ?? null });
    };
    requestAnimationFrame(tick);
  });
}

/** Shows one still frame at time t (for screenshots). */
function still(t: number): string {
  step(t);
  return paint(full).sheets;
}

(window as unknown as { glBench: unknown }).glBench = { bench, still, renderer: first.sheets };
