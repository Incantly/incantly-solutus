import { expect, test, type Page } from '@playwright/test';

/** Integrator styles: a settings panel restyles a live sandboxed figure without remounting it. */

interface StyleState {
  ready: boolean;
  mounts: number;
  restyles: number;
  style: { preset?: string; layout?: Record<string, string>; show?: Record<string, boolean>; classNames?: Record<string, string> };
}

const read = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify({ ...window.__playground, figure: undefined })) as StyleState);

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/?page=style${query}`);
  await page.waitForFunction(() => (window.__playground as { ready?: boolean } | undefined)?.ready === true, undefined, { timeout: 15_000 });
}

test.describe('figure looks', () => {
  test('restyles a live sandboxed figure from settings, keeping what the learner changed', async ({ page }) => {
    await open(page, '&scene=sine-wave&preset=glass');
    const figure = page.frameLocator('iframe').locator('.inc-figure');
    await expect(figure).toHaveAttribute('data-preset', 'glass');
    // The learner moves a slider; restyling must keep it.
    const slider = figure.locator('input[type=range]').first();
    await slider.fill('3');
    await expect(slider).toHaveValue('3');

    await page.getByLabel('Preset').selectOption('outline');
    await page.getByLabel('Controls placement').selectOption('right');
    await page.getByLabel('Size').selectOption('lg');
    await page.getByRole('checkbox', { name: 'transport' }).uncheck();
    await expect(figure).toHaveAttribute('data-preset', 'outline');
    await expect(figure).toHaveAttribute('data-layout', 'right');
    await expect(figure).toHaveAttribute('data-size', 'lg');
    await expect(figure.locator('.inc-transport')).toBeHidden();
    await expect(slider).toHaveValue('3');
    const state = await read(page);
    expect(state.mounts).toBe(1);
    expect(state.restyles).toBeGreaterThanOrEqual(4);
    expect(state.style).toMatchObject({ preset: 'outline', layout: { controls: 'right', size: 'lg' }, show: { transport: false } });

    // A fixed drawing height reaches the stage.
    await page.getByLabel('Drawing height', { exact: true }).fill('300');
    await expect.poll(() => figure.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--inc-scene-height'))).toBe('300px');
    await page.getByLabel('Theme').selectOption('dark');
    await expect(figure).toHaveAttribute('data-theme', 'dark');
  });

  test('carries utility classes and their stylesheet into the frame', async ({ page }) => {
    await open(page, '&scene=ohm');
    await page.getByLabel('Utility classes').check();
    await page.waitForFunction(() => (window.__playground as { mounts?: number } | undefined)?.mounts === 2);
    const figure = page.frameLocator('iframe').locator('.inc-figure');
    await expect(figure).toHaveClass(/u-ring/);
    const button = figure.locator('button[data-action="reset"]');
    await expect(button).toHaveClass(/u-pill/);
    // The class does something: the host's stylesheet made it into the sandboxed frame.
    await expect.poll(() => button.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('999px');
  });
});
