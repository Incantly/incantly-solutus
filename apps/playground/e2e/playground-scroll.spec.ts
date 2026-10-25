import { expect, test } from '@playwright/test';

test('the conversation scrolls when the pointer is over the surrounding UI', async ({ page }) => {
  await page.goto('/?page=generate');
  await page.evaluate(() => {
    const messages = document.querySelector('.messages-container');
    if (!(messages instanceof HTMLElement)) throw new Error('The conversation was not mounted');
    for (let index = 0; index < 30; index += 1) {
      const message = document.createElement('div');
      message.className = 'message';
      message.style.minHeight = '100px';
      message.textContent = `Test message ${index + 1}`;
      messages.append(message);
    }
  });

  const messages = page.locator('.messages-container');
  await expect.poll(() => messages.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  await page.locator('.chat-header').hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => messages.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  const afterHeader = await messages.evaluate((element) => element.scrollTop);
  await page.locator('.input-container').hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => messages.evaluate((element) => element.scrollTop)).toBeGreaterThan(afterHeader);

  const afterComposer = await messages.evaluate((element) => element.scrollTop);
  await page.locator('.sidebar-header').hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => messages.evaluate((element) => element.scrollTop)).toBeGreaterThan(afterComposer);
});
