/** Turning, zooming, picking and dragging in the Space view (.kiro/specs/space-3d R4.1 to R4.4; design 9.4, 10; ui 5, 6). */
import { afterEach, describe, expect, it } from 'vitest';
import { space } from '@incantly/kernel';
import { projectPoint } from '@incantly/view/camera';
import { createApp, createHeadlessApp } from '../../src/index';
import type { MountedApp, Scheduler } from '../../src/index';
import { cameraFor, cameraLine, dragTo, facingAxis, keyLine, keyMove, orbit, pan, pick3, zoomAt } from '../../src/screen/index';
import type { Hit3 } from '../../src/screen/index';

const DEG = Math.PI / 180;
const V = space.DEFAULT_VIEW3;

describe('the camera gestures (R4.1, design 10.4)', () => {
  it('orbit turns 0.4° a pixel, and the tilt stops at the poles', () => {
    const a = orbit(V, 100, 0);
    expect(a.azimuth).toBeCloseTo(V.azimuth - 40 * DEG, 12);
    expect(a.elevation).toBe(V.elevation);
    expect(orbit(V, 0, 1000).elevation).toBeCloseTo(90 * DEG, 12);
    expect(orbit(V, 0, -1000).elevation).toBeCloseTo(-90 * DEG, 12);
    // the angle stays within −180°..180°
    expect(Math.abs(orbit(V, 1000, 0).azimuth)).toBeLessThanOrEqual(Math.PI);
  });

  it('pan keeps the point under the pointer under it', () => {
    const cam = cameraFor(V, 600, 400);
    const before = projectPoint(cam, { x: 1, y: 1, z: 1 });
    const moved = pan(V, cam, 30, -20);
    const after = projectPoint(cameraFor(moved, 600, 400), { x: 1, y: 1, z: 1 });
    expect(after.x - before.x).toBeCloseTo(30, 6);
    expect(after.y - before.y).toBeCloseTo(-20, 6);
  });

  it('zoom about the pointer keeps the target-depth point under it', () => {
    const cam = cameraFor(V, 600, 400);
    const z = zoomAt(V, cam, 2, 450, 120);
    expect(z.zoom).toBe(2);
    // the point of the target plane under (450, 120) is still under it
    const dx = (450 - 300) / cam.scale;
    const dy = (200 - 120) / cam.scale;
    const p = space.add(V.target, space.add(space.scale(cam.right, dx), space.scale(cam.up, dy)));
    const q = projectPoint(cameraFor(z, 600, 400), p);
    expect(q.x).toBeCloseTo(450, 6);
    expect(q.y).toBeCloseTo(120, 6);
  });

  it('a gesture becomes one camera line with only what changed', () => {
    expect(cameraLine(V, V)).toBeUndefined();
    expect(cameraLine(V, { ...V, azimuth: 30 * DEG })).toBe('space with azimuth = 30deg');
    expect(cameraLine(V, { ...V, zoom: 2, target: { x: 1, y: 0, z: 0 } })).toBe('space with zoom = 2, target = (1, 0, 0)');
  });

  it('the camera keys write the lines of ui.md 5.4', () => {
    expect(keyLine('5', V)).toBe('ViewPreset(top)');
    expect(keyLine('0', V)).toBe('ViewPreset(isometric)');
    expect(keyLine('h', V)).toBe('ViewReset()');
    expect(keyLine('p', V)).toBe('space with projection = persp');
    expect(keyLine('p', { ...V, projection: 'persp' })).toBe('space with projection = ortho');
    expect(keyLine('+', V)).toBe('space with zoom = 1.25');
    expect(keyLine('q', V)).toBeUndefined();
  });
});

describe('picking (R4.4, design 9.4)', () => {
  const hits: Hit3[] = [
    { k: 'face', id: 1, pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], depth: 0.1, alpha: 0.25 },
    { k: 'face', id: 2, pts: [{ x: 40, y: 40 }, { x: 80, y: 40 }, { x: 80, y: 80 }, { x: 40, y: 80 }], depth: 0.5, alpha: 0.4 },
    { k: 'line', id: 3, x0: 0, y0: 50, x1: 100, y1: 50, depth: 0.6 },
    { k: 'point', id: 4, name: 'A', x: 60, y: 60, r: 8, depth: 0.7, free: true },
  ];

  it('a point beats a line, a line beats a solid face, a solid beats a see-through plane', () => {
    expect(pick3(hits, 61, 61)?.id).toBe(4);
    expect(pick3(hits, 50, 51)?.id).toBe(3);
    expect(pick3(hits, 45, 70)?.id).toBe(2);
    expect(pick3(hits, 10, 10)?.id).toBe(1);
    expect(pick3(hits, 200, 200)).toBeUndefined();
  });

  it('the axes and the floor are never picked', () => {
    expect(pick3([{ k: 'line', id: -2, x0: 0, y0: 0, x1: 10, y1: 0, depth: 0 }], 5, 0)).toBeUndefined();
  });
});

describe('dragging a point (R4.2, design 10.1)', () => {
  it('the plane is the axis plane that faces the camera most', () => {
    expect(facingAxis(cameraFor({ ...V, elevation: 60 * DEG }, 600, 400))).toEqual({ x: 0, y: 0, z: 1 });
    expect(facingAxis(cameraFor({ ...V, azimuth: 0, elevation: 10 * DEG }, 600, 400))).toEqual({ x: 0, y: 1, z: 0 });
    expect(facingAxis(cameraFor({ ...V, azimuth: 90 * DEG, elevation: 10 * DEG }, 600, 400))).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('a point dragged in the floor plane stays at its height and lands under the pointer', () => {
    const view = { ...V, elevation: 60 * DEG };
    const cam = cameraFor(view, 600, 400);
    const from = { x: 1, y: 1, z: 2 };
    const want = { x: 3, y: -1, z: 2 };
    const at = projectPoint(cam, want);
    const p = dragTo(cam, from, at.x, at.y, 'plane') as space.V3;
    expect(p.z).toBe(2);
    expect(p.x).toBeCloseTo(3, 6);
    expect(p.y).toBeCloseTo(-1, 6);
  });

  it('with Shift a point moves straight up and down', () => {
    const cam = cameraFor(V, 600, 400);
    const from = { x: 1, y: 1, z: 0 };
    const at = projectPoint(cam, { x: 1, y: 1, z: 3 });
    const p = dragTo(cam, from, at.x, at.y, 'vertical') as space.V3;
    expect(p.x).toBe(1);
    expect(p.y).toBe(1);
    expect(p.z).toBeCloseTo(3, 6);
  });

  it('looking edge on at the plane gives no place, so the point does not jump', () => {
    const cam = cameraFor({ ...V, elevation: 0 }, 600, 400);
    expect(dragTo(cam, { x: 0, y: 0, z: 0 }, 300, 100, 'plane', { x: 0, y: 0, z: 1 })).toBeUndefined();
  });

  it('the arrow keys move a step, Shift ten, Alt a tenth; PageUp and PageDown move in z', () => {
    expect(keyMove('ArrowRight', false, false)).toEqual({ x: 1, y: 0, z: 0 });
    expect(keyMove('ArrowUp', true, false)).toEqual({ x: 0, y: 10, z: 0 });
    expect(keyMove('PageDown', false, true)).toEqual({ x: 0, y: 0, z: -0.1 });
    expect(keyMove('a', false, false)).toBeUndefined();
  });

  it('the app drags a point in space with its z, and a dependent one through its parents', () => {
    const app = createHeadlessApp({ mode: 'graphing3d', script: 'A = (0, 0, 0)\nB = (2, 0, 0)\nM = Midpoint(A, B)' });
    expect(app.draggable('A')).toBe(true);
    expect(app.dragPoint('A', 1, 2, true, 3).ok).toBe(true);
    expect(app.value('A')).toEqual({ x: 1, y: 2, z: 3 });
    expect(app.draggable('M')).toBe(true);
    expect(app.dragPoint('M', 2, 2, true, 2).ok).toBe(true);
    expect(app.value('M')).toEqual({ x: 2, y: 2, z: 2 });
  });
});

describe('the pane in createApp (R4.1, R4.2)', () => {
  const now: Scheduler = { micro: (fn) => fn(), frame: (fn) => fn() };
  let app: MountedApp | undefined;
  afterEach(() => app?.destroy());
  const ptr = (type: string, x: number, y: number, extra: Record<string, unknown> = {}): PointerEvent =>
    new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, buttons: type === 'pointerup' ? 0 : 1, ...extra }) as unknown as PointerEvent;

  const mount = async (script: string): Promise<{ app: MountedApp; canvas: HTMLCanvasElement }> => {
    const container = document.createElement('div');
    document.body.append(container);
    app = await createApp({ container, mode: 'graphing3d', scheduler: now, script });
    app.screen.paint();
    return { app, canvas: container.querySelector('.space-canvas') as HTMLCanvasElement };
  };

  it('dragging the background turns the camera and writes one line, which undo takes back', async () => {
    const { app: a, canvas } = await mount('A = (0, 0, 0)');
    canvas.dispatchEvent(ptr('pointerdown', 700, 500));
    canvas.dispatchEvent(ptr('pointermove', 720, 500));
    canvas.dispatchEvent(ptr('pointermove', 750, 510));
    canvas.dispatchEvent(ptr('pointerup', 750, 510));
    // 50 px right and 10 px down: 20° round and 4° up from −40° and 22°
    expect(space.viewOf(a.figure).azimuth).toBeCloseTo(-60 * DEG, 9);
    expect(space.viewOf(a.figure).elevation).toBeCloseTo(26 * DEG, 9);
    expect(a.definition('space')).toMatch(/^space = Space\(azimuth = .*60deg.*, elevation = 26deg\)$/);
    a.undo();
    expect(a.exists('space')).toBe(false);
  });

  it('dragging a point moves it as the learner; a click selects it; arrow keys then move it', async () => {
    const { app: a, canvas } = await mount('A = (1, 1, 0)\nspace with elevation = 60deg');
    a.screen.paint();
    const hit = a.screen.space?.last()?.hits.find((h) => h.k === 'point') as { x: number; y: number };
    const cam = a.screen.space?.last()?.camera;
    if (!cam) throw new Error('no frame');
    const to = projectPoint(cam, { x: 2, y: -1, z: 0 });
    const seen: string[] = [];
    a.on('dragEnd', (e) => seen.push(`${e.name}:${e.source}`));
    canvas.dispatchEvent(ptr('pointerdown', hit.x, hit.y));
    canvas.dispatchEvent(ptr('pointermove', to.x, to.y));
    canvas.dispatchEvent(ptr('pointerup', to.x, to.y));
    const A = a.value('A') as space.V3;
    expect(A.x).toBeCloseTo(2, 3);
    expect(A.y).toBeCloseTo(-1, 3);
    expect(A.z).toBe(0);
    expect(seen).toEqual(['A:user']);
    a.screen.paint();
    const h2 = a.screen.space?.last()?.hits.find((h) => h.k === 'point') as { x: number; y: number };
    canvas.dispatchEvent(ptr('pointerdown', h2.x, h2.y));
    canvas.dispatchEvent(ptr('pointerup', h2.x, h2.y));
    expect(a.screen.space?.selected()).toBe('A');
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }));
    expect((a.value('A') as space.V3).z).toBeCloseTo(1, 6);
  });

  it('the camera keys and the style bar write camera lines', async () => {
    const { app: a, canvas, } = await mount('A = (0, 0, 0)');
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '5', bubbles: true }));
    expect(space.viewOf(a.figure).elevation).toBeCloseTo(90 * DEG, 6);
    const reset = a.element.querySelector('button[aria-label="Reset the view"]') as HTMLButtonElement;
    reset.click();
    expect(a.definition('space')).toBe('space = Space()');
    (a.element.querySelector('button[aria-label="Orthographic or perspective"]') as HTMLButtonElement).click();
    expect(space.viewOf(a.figure).projection).toBe('persp');
  });

  it('a read-only figure turns but does not drag', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    app = await createApp({ container, mode: 'graphing3d', scheduler: now, script: 'A = (1, 1, 0)', readOnly: true });
    app.screen.paint();
    const canvas = container.querySelector('.space-canvas') as HTMLCanvasElement;
    const hit = app.screen.space?.last()?.hits.find((h) => h.k === 'point') as { x: number; y: number };
    canvas.dispatchEvent(ptr('pointerdown', hit.x, hit.y));
    canvas.dispatchEvent(ptr('pointermove', hit.x + 60, hit.y));
    canvas.dispatchEvent(ptr('pointerup', hit.x + 60, hit.y));
    expect(app.value('A')).toEqual({ x: 1, y: 1, z: 0 });
  });
});
