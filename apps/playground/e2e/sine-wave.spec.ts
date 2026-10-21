import { expect, test } from '@playwright/test';
import { drawingState, openScene, stats, waitIdle } from './helpers';

test.describe('reference sine wave (Phase 1 gate)', () => {
  test('renders in light and dark modes', async ({ page }) => {
    const strokes: Record<string, string> = {};
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await openScene(page, 'scene=sine-wave&autoplay=0');
      const curve = page.locator('svg.inc-stage path.inc-tone-lit').first();
      await expect(curve).toHaveAttribute('d', /^M/);
      strokes[scheme] = await curve.evaluate((el) => getComputedStyle(el).stroke);
      const background = await page.locator('.inc-figure').evaluate((el) => getComputedStyle(el).backgroundColor);
      strokes[`${scheme}-bg`] = background;
    }
    expect(strokes.light).not.toBe(strokes.dark);
    expect(strokes['light-bg']).not.toBe(strokes['dark-bg']);
  });

  test('every parameter redraws while paused, and time does not advance', async ({ page }) => {
    await openScene(page, 'scene=sine-wave&autoplay=0');
    await waitIdle(page);
    const sliders = page.locator('input[type=range]');
    await expect(sliders).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      const before = await drawingState(page);
      await sliders.nth(i).focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await waitIdle(page);
      const after = await drawingState(page);
      expect(after, `slider ${i}`).not.toBe(before);
    }
    expect((await stats(page)).time).toBe(0);
  });

  test('runs exactly one loop and does no work while paused and clean', async ({ page }) => {
    await openScene(page, 'scene=sine-wave');
    await page.waitForTimeout(300);
    const playing = await stats(page);
    expect(playing.renderer.loopStarts).toBe(1);
    expect(playing.runtime.playingFrames).toBeGreaterThan(5);

    await page.getByRole('button', { name: 'Pause' }).click();
    await waitIdle(page);
    const paused = await stats(page);
    const mutations = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let count = 0;
          const svg = document.querySelector('svg.inc-stage')!;
          const observer = new MutationObserver((records) => (count += records.length));
          observer.observe(svg, { subtree: true, attributes: true, childList: true, characterData: true });
          setTimeout(() => {
            observer.disconnect();
            resolve(count);
          }, 500);
        }),
    );
    const later = await stats(page);
    expect(mutations).toBe(0);
    expect(later.renderer.frameRequests).toBe(paused.renderer.frameRequests);
    expect(later.runtime.ticks).toBe(paused.runtime.ticks);
  });

  test('records the first performance baseline', async ({ page }, testInfo) => {
    await openScene(page, 'scene=sine-wave');
    await page.waitForTimeout(2000);
    const run = await stats(page);
    await page.getByRole('button', { name: 'Pause' }).click();
    await waitIdle(page);
    const idleStart = await stats(page);
    await page.waitForTimeout(1000);
    const idleEnd = await stats(page);

    const baseline = {
      scene: 'sine-wave',
      browser: testInfo.project.name,
      playingFrames: run.runtime.playingFrames,
      averageFrameWorkMs: Number((run.renderer.workMs / Math.max(1, run.renderer.workFrames)).toFixed(3)),
      idleFramesPerSecond: idleEnd.renderer.frameRequests - idleStart.renderer.frameRequests,
    };
    await testInfo.attach('baseline.json', { body: JSON.stringify(baseline, null, 2), contentType: 'application/json' });
    console.log('baseline', JSON.stringify(baseline));
    // PRD in-app check: average frame cost under 8 ms on the test device.
    expect(baseline.averageFrameWorkMs).toBeLessThan(8);
    expect(baseline.idleFramesPerSecond).toBe(0);
  });

  test('cleans up completely when destroyed', async ({ page }) => {
    await openScene(page, 'scene=sine-wave');
    await page.waitForTimeout(200);
    await page.evaluate(() => (window.__playground?.figure as { destroy(): void }).destroy());
    const before = await stats(page);
    await page.waitForTimeout(300);
    const after = await stats(page);
    expect(after.renderer.frameRequests).toBe(before.renderer.frameRequests);
    expect(await page.locator('.inc-figure').count()).toBe(0);
  });
});
