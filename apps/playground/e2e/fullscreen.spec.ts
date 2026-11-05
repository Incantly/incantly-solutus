import { expect, test, type Locator, type Page } from '@playwright/test';
import { openScene, stats } from './helpers';

/**
 * The figure's own fullscreen: the measured stage box grows strictly past its
 * windowed box at short and tall viewports, chrome stays usable at the new
 * size, dragging still maps, and leaving restores the exact windowed box.
 * (Player fullscreen — trusted and stored films — is asserted in
 * player.spec.ts, which owns the serial dev-store discipline those paths
 * need. These scene-page tests touch no shared store.)
 */

interface StageBox {
  readonly width: number;
  readonly height: number;
}

async function stageBox(stage: Locator): Promise<StageBox> {
  const box = await stage.boundingBox();
  if (!box) throw new Error('the stage has no box');
  return { width: box.width, height: box.height };
}

async function enterFullscreen(page: Page): Promise<void> {
  await page.locator('button[data-action="fullscreen"]').first().click();
  await page.waitForFunction(() => document.fullscreenElement !== null);
}

async function exitFullscreen(page: Page): Promise<void> {
  // The toggle is the committable exit path: a synthetic Escape does not
  // leave fullscreen in this harness, while the toggle drives the same
  // fullscreenchange restore a real Esc takes.
  await page.locator('button[data-action="fullscreen"]').first().click();
  await page.waitForFunction(() => document.fullscreenElement === null);
}

for (const height of [537, 900]) {
  test(`the stage grows past its windowed box at a ${height} px viewport`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height });
    await openScene(page, 'scene=sine-wave&autoplay=0');
    const stage = page.locator('svg.inc-stage').first();
    await expect(stage).toBeVisible();
    const before = await stageBox(stage);
    await enterFullscreen(page);
    const after = await stageBox(stage);
    expect(after.width, 'fullscreen stage width').toBeGreaterThan(before.width);
    expect(after.height, 'fullscreen stage height').toBeGreaterThan(before.height);
    // Chrome stays usable at the new size: play through the figure's own transport.
    await page.locator('button[data-action="toggle"]').first().click();
    expect((await stats(page)).renderer.running).toBe(true);
    await exitFullscreen(page);
    expect(await stageBox(stage)).toEqual(before);
  });
}

test('dragging maps at the fullscreen size', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 537 });
  await openScene(page, 'scene=pendulum&autoplay=0');
  const bob = page.locator('svg.inc-stage [data-drag]').first();
  await expect(bob).toBeVisible();
  const before = (await stats(page)).values.amplitude;
  await enterFullscreen(page);
  const target = await bob.boundingBox();
  if (!target) throw new Error('the bob has no box');
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2 + 60, target.y + target.height / 2 + 10, { steps: 5 });
  await page.mouse.up();
  expect((await stats(page)).values.amplitude).not.toBe(before);
  await exitFullscreen(page);
});
