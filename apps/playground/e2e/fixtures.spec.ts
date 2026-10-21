import { expect, test } from '@playwright/test';

for (const size of [10, 300]) {
  test(`the ${size}-node document loads in the test host and accepts input`, async ({ page }) => {
    await page.goto(`/?page=editor&size=${size}`);
    await page.waitForFunction(() => window.__playground?.ready === true);

    const figures = await page.evaluate(() => (window.__playground?.figureCount as () => number)());
    expect(figures).toBe(size);
    await expect(page.locator('figure.incantly-figure')).toHaveCount(size);

    const readyMs = await page.evaluate(() => window.__playground?.editorReadyMs ?? -1);
    test.info().annotations.push({ type: 'editor-ready-ms', description: readyMs.toFixed(0) });

    const editor = page.locator('.editor');
    await editor.click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.type('Typed text ');
    await expect(editor.locator('h1')).toContainText('Typed text');
  });
}
