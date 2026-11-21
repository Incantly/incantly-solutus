/**
 * The frame style belongs to each app (board review BR-38; docs/features/board/design.md 8): the axes and the grid of an app
 * come from its own `@axes` and `@grid` lines, so a card live on a board draws what its picture draws, and two apps on one
 * page, with different `@axes`, each keep their own.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SvgContext, createApp, createHeadlessApp } from '../../src/index';
import type { MountedApp } from '../../src/index';
import { DEFAULT_FRAME_STYLE, paintScene, sceneOf } from '../../src/screen/index';
import { Viewport } from '../../src/screen/viewport';

const AXIS_COLOUR = '#2b2f36';
const GRID_COLOUR = '#d8dde4';

let container: HTMLElement;
let apps: MountedApp[] = [];

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  apps = [];
});
afterEach(() => {
  for (const a of apps) a.destroy();
  container.remove();
});

/** Mounts an app whose graph canvas records into SVG, so a test can read what the screen drew. */
async function mount(script: string): Promise<{ app: MountedApp; ctx: SvgContext }> {
  const app = await createApp({ container, mode: 'classic', script });
  apps.push(app);
  const ctx = new SvgContext(800, 600);
  (app.element.querySelector('canvas.graph-canvas') as HTMLCanvasElement).getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
  app.screen.paint();
  return { app, ctx };
}

const drawsAxes = (svg: string): boolean => svg.includes(AXIS_COLOUR);
const drawsGrid = (svg: string): boolean => svg.includes(GRID_COLOUR);

describe('the frame style of an app (BR-38)', () => {
  it('two apps on one page, with different @axes and @grid, each draw their own', async () => {
    const plain = await mount('@axes off\n@grid off\nA = (1, 1)');
    const full = await mount('A = (1, 1)');
    // painting the second app does not change what the first one draws next
    plain.app.screen.paint();
    const a = plain.ctx.toString();
    const b = full.ctx.toString();
    expect(drawsAxes(a)).toBe(false);
    expect(drawsGrid(a)).toBe(false);
    expect(drawsAxes(b)).toBe(true);
    expect(drawsGrid(b)).toBe(true);
  });

  it('a mounted app and its picture draw the same axes and grid', async () => {
    for (const script of ['@axes off\n@grid off\nA = (1, 1)', '@axes on\n@grid major\nA = (1, 1)', 'A = (1, 1)']) {
      const { app, ctx } = await mount(script);
      const live = ctx.toString();
      const exported = await createHeadlessApp({ mode: 'classic', script }).export({ format: 'svg' });
      if (!exported.ok) throw new Error(exported.message);
      const picture = exported.text as string;
      expect(drawsAxes(live), `${script}: axes`).toBe(drawsAxes(picture));
      expect(drawsGrid(live), `${script}: grid`).toBe(drawsGrid(picture));
      app.destroy();
    }
  });

  it('the picture of an app does not change the style of the next paint on the page', async () => {
    const off = createHeadlessApp({ script: '@axes off\n@grid off\nA = (1, 1)' });
    await off.export({ format: 'svg' });
    const { ctx } = await mount('A = (1, 1)');
    expect(drawsAxes(ctx.toString())).toBe(true);
  });

  it('a paint with no style given draws the default: axes and a minor grid on a white page', () => {
    const app = createHeadlessApp({ script: 'A = (1, 1)' });
    const vp = new Viewport();
    vp.resize(400, 300);
    const ctx = new SvgContext(400, 300);
    paintScene(ctx as unknown as CanvasRenderingContext2D, vp, sceneOf(app.figure));
    const svg = ctx.toString();
    expect(drawsAxes(svg)).toBe(DEFAULT_FRAME_STYLE.axes);
    expect(DEFAULT_FRAME_STYLE).toMatchObject({ axes: true, grid: 'minor', background: '#ffffff' });
    expect(Object.isFrozen(DEFAULT_FRAME_STYLE)).toBe(true);
  });
});
