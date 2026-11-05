import { expect, test, type Page } from '@playwright/test';

async function openPlayer(page: Page, film: string): Promise<void> {
  await page.goto(`/?page=player&film=${film}`);
  await page.waitForFunction(() => window.__playground?.ready === true);
}

test('the player plays a silent film with captions and a transcript', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await expect(page.locator('.inc-player h2')).toHaveText('How a pendulum keeps time');
  await expect(page.locator('.inc-timeline-clip')).toHaveCount(6);
  await expect(page.locator('.inc-transcript li')).toHaveCount(6);

  await page.locator('.inc-player-transport button').first().click();
  await page.waitForFunction(() => {
    const stats = (window.__playground?.stats as () => { time: number })();
    return stats.time > 1;
  });
  await expect(page.locator('.inc-caption')).toContainText('pendulum hangs');

  // The transcript seeks: the last line jumps to the last beat.
  await page.locator('.inc-transcript li').last().locator('button').click();
  await page.waitForFunction(() => {
    const stats = (window.__playground?.stats as () => { beat: string | null })();
    return stats.beat === 's1b6';
  });
  await expect(page.locator('.inc-caption')).toContainText('keeps time');
});

test('caption toggles apply without waiting for the next beat', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await page.evaluate(() => (window.__playground?.model as unknown as { seek(seconds: number): void }).seek(1));
  await expect(page.locator('.inc-caption')).toContainText('pendulum hangs');
  // Caption sizes solve once the measured fonts arrive.
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(async () => page.locator('.inc-caption').evaluate((el) => el.style.fontSize)).not.toBe('');
  const beat = await page.evaluate(() => (window.__playground?.stats as () => { beat: string | null })().beat);

  const caption = page.locator('.inc-caption');
  const before = await caption.evaluate((el) => getComputedStyle(el).fontSize);
  await page.locator('select[aria-label="Caption size"]').selectOption('lg');
  await expect
    .poll(async () => caption.evaluate((el) => getComputedStyle(el).fontSize))
    .not.toBe(before);

  await page.getByLabel('Captions').uncheck();
  await expect(caption).toBeEmpty();
  await page.getByLabel('Captions').check();
  await expect(caption).toContainText('pendulum hangs');

  // Nothing above changed the beat: the chrome applied on its own events.
  await expect
    .poll(async () => page.evaluate(() => (window.__playground?.stats as () => { beat: string | null })().beat))
    .toBe(beat);
});

test('the one-minute film reports seek=play and passing film checks', async ({ page }) => {
  await openPlayer(page, 'sixty');
  await expect(page.locator('.inc-timeline-clip')).toHaveCount(8);
  await expect(page.locator('.inc-player-badge').nth(1)).toContainText('seek=play: pass', { timeout: 30_000 });
  await expect(page.locator('.inc-player-badge').nth(2)).toContainText('all 8 beats pass', { timeout: 60_000 });
});

test('stub narration times the beats and highlights caption words', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await expect
    .poll(async () => page.evaluate(() => (window.__playground?.narration as () => { source: string; timed: number; beats: number })()))
    .toMatchObject({ source: 'stub', timed: 6, beats: 6 });
  await page.evaluate(() => (window.__playground?.model as unknown as { seek(seconds: number): void }).seek(0.1));
  await expect(page.locator('.inc-caption-word')).not.toHaveCount(0);
  await expect(page.locator('.inc-caption-word.is-active').first()).toContainText('A');

  await page.locator('.inc-player-transport button').first().click();
  await page.waitForFunction(() => {
    const stats = (window.__playground?.stats as () => { time: number })();
    return stats.time > 1.2;
  });
  await expect.poll(async () => page.locator('.inc-caption-word.is-active').first().textContent()).not.toBe('A');
});

test('the sound toggle schedules narration and stays silent until then', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await page.evaluate(() => (window.__playground?.model as unknown as { seek(seconds: number): void }).seek(0.5));
  await page.locator('.inc-player-transport button').first().click();
  await page.waitForFunction(() => {
    const stats = (window.__playground?.stats as () => { time: number })();
    return stats.time > 0.8;
  });
  const silent = await page.evaluate(() => (window.__playground?.mixerEvents as () => Array<{ type: string }>)());
  expect(silent.filter((event) => event.type === 'play')).toHaveLength(0);

  const sound = page.getByRole('button', { name: 'Sound' });
  await expect(sound).toHaveText('Sound: off');
  await sound.click();
  await expect(sound).toHaveText('Sound: on');
  await expect
    .poll(async () => page.evaluate(() => (window.__playground?.mixerEvents as () => Array<{ type: string }>)()).then((events) => events.filter((e) => e.type === 'play').length))
    .toBeGreaterThan(0);
});

test('narration settings keep the key in memory and need none for the stub', async ({ page }) => {
  await openPlayer(page, 'thirty');
  const key = page.locator('.inc-narration-key');
  await expect(key).toHaveAttribute('type', 'password');
  await expect(key).toHaveAttribute('autocomplete', 'off');
  await expect(key).toHaveValue('');
  await expect(page.locator('.inc-narration-hint')).toContainText('never saved');
});
