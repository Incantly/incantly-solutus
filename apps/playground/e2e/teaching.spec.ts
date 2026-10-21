import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openScene, stats, waitIdle } from './helpers';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).include('.inc-figure').withTags(WCAG).analyze();
  return result.violations.map((v) => ({ id: v.id, help: v.help, targets: v.nodes.map((n) => n.target.join(' ')) }));
}

/** Tabs through the page, recording what took focus and whether the focus is visible. */
async function tabThrough(page: Page, presses: number) {
  const seen: Array<{ name: string; visible: boolean }> = [];
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press('Tab');
    seen.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | SVGElement | null;
        if (!el || el === document.body) return { name: 'body', visible: false };
        const style = getComputedStyle(el);
        const outlined = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
        const highlighted = el.classList.contains('is-focus') || el.matches('.inc-part:focus-visible');
        const name =
          el.getAttribute('aria-label') ??
          (el instanceof HTMLInputElement ? `${el.type}:${el.labels?.[0]?.textContent ?? ''}` : null) ??
          el.textContent?.trim() ??
          el.tagName;
        return { name, visible: outlined || highlighted };
      }),
    );
  }
  return seen;
}

test.describe('teaching and accessibility (Phase 2 gate)', () => {
  test('reaches every control, part and step with the keyboard, always with visible focus', async ({ page }) => {
    await openScene(page, 'scene=sine-wave&autoplay=0');
    const seen = await tabThrough(page, 20);
    const names = seen.map((s) => s.name);
    for (const expected of [
      'The wave: Its shape repeats every period.',
      'Amplitude guide: The crest height above the axis.',
      'One period: The length of one full wave.',
      'Marker: The height of the wave at x = 0.',
      'Walk me through it',
      'range:Amplitude',
      'Amplitude value',
      'range:Frequency (rad per unit)',
      'Frequency value',
      'range:Phase (rad)',
      'Phase value',
      'Play',
      'Restart',
      'Reset',
      'Text description',
    ]) {
      expect(names, `focus reaches ${expected}`).toContain(expected);
    }
    expect(names.some((n) => n.startsWith('0.25×'))).toBe(true); // the speed select
    const invisible = seen.filter((s) => s.name !== 'body' && !s.visible);
    expect(invisible).toEqual([]);
  });

  test('walks through the steps by keyboard and gives the learner their values back', async ({ page }) => {
    await openScene(page, 'scene=sine-wave&autoplay=0');
    const amplitude = page.getByRole('slider', { name: 'Amplitude' });
    await amplitude.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await waitIdle(page);
    const learner = (await stats(page)).values;
    expect(learner.amplitude).toBeCloseTo(2.2, 10);

    const start = page.getByRole('button', { name: 'Walk me through it' });
    await start.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Step 1 of 3', { exact: true })).toBeVisible();
    await expect(page.locator('.inc-steps__say')).toHaveText('The height of each crest above the axis is the amplitude.');
    await expect(page.locator('.inc-steps [aria-live]')).toHaveText(
      'Step 1 of 3. The height of each crest above the axis is the amplitude.',
    );
    await expect(page.getByRole('button', { name: 'Next' })).toBeFocused();
    await expect(page.locator('[data-part="Amplitude"]')).toHaveClass(/is-focus/);
    await expect(page.locator('.inc-figure')).toHaveClass(/has-focus/);

    await page.keyboard.press('ArrowRight');
    await expect(page.getByText('Step 2 of 3', { exact: true })).toBeVisible();
    await expect(page.locator('[data-part="Period"]')).toHaveClass(/is-focus/);
    await page.keyboard.press('Enter');
    await expect(page.getByText('Step 3 of 3', { exact: true })).toBeVisible();
    await waitIdle(page);
    expect((await stats(page)).values).toEqual({ amplitude: 3, frequency: 2, phase: 1.57 });
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByText('Step 2 of 3', { exact: true })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(start).toBeFocused();
    await waitIdle(page);
    expect((await stats(page)).values).toEqual(learner);
    await expect(amplitude).toHaveValue('2.2');
    await expect(page.locator('.inc-figure')).not.toHaveClass(/has-focus/);
  });

  test('animates step changes instead of jumping', async ({ page }) => {
    await openScene(page, 'scene=sine-wave&autoplay=0');
    await waitIdle(page);
    const samples: number[] = [];
    await page.getByRole('button', { name: 'Walk me through it' }).click();
    for (let i = 0; i < 8; i++) {
      samples.push((await stats(page)).values.amplitude!);
      await page.waitForTimeout(60);
    }
    await waitIdle(page);
    samples.push((await stats(page)).values.amplitude!);
    expect(samples.at(-1)).toBe(3);
    expect(samples.some((v) => v > 2 && v < 3)).toBe(true);
    expect((await stats(page)).time).toBe(0);
  });

  test('highlights a part under the pointer and names it outside the drawing', async ({ page }) => {
    await openScene(page, 'scene=sine-wave&autoplay=0');
    const info = page.locator('.inc-part-info');
    await expect(info).toHaveText('Point at or tap a part of the drawing to see what it shows.');
    await page.locator('[data-part="Marker"]').hover();
    await expect(page.locator('[data-part="Marker"]')).toHaveClass(/is-focus/);
    await expect(info).toHaveText('Marker: The height of the wave at x = 0.');
    // Everything else dims (after a short fade).
    await expect
      .poll(() => page.locator('[data-part="Wave"]').evaluate((el) => Number(getComputedStyle(el).opacity)))
      .toBeLessThan(0.5);
    expect(await page.locator('[data-part="Marker"]').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await page.mouse.move(2, 2);
    await expect(page.locator('.is-focus')).toHaveCount(0);
  });

  test('reduced motion opens a meaningful still state that the learner may still play', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openScene(page, 'scene=sine-wave');
    await waitIdle(page);
    const still = await stats(page);
    expect(still.time).toBe(0);
    expect(still.runtime.playingFrames).toBe(0);
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
    await expect(page.locator('svg.inc-stage path.inc-tone-lit').first()).toHaveAttribute('d', /^M.+L/);
    await expect(page.locator('.inc-readout__value').first()).toHaveText('2.0');

    // Steps jump rather than animate.
    await page.getByRole('button', { name: 'Walk me through it' }).click();
    expect((await stats(page)).values.amplitude).toBe(3);
    await waitIdle(page);

    await page.getByRole('button', { name: 'Play' }).click();
    await page.waitForTimeout(150);
    expect((await stats(page)).time).toBeGreaterThan(0);
  });

  test('pauses when reduced motion is switched on while the figure plays', async ({ page }) => {
    await openScene(page, 'scene=sine-wave');
    await page.waitForTimeout(100);
    expect((await stats(page)).runtime.playingFrames).toBeGreaterThan(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
    await waitIdle(page);
  });

  test('exposes titles, descriptions, parts, controls and steps to assistive technology', async ({ page }) => {
    await openScene(page, 'scene=sine-wave&autoplay=0');
    await waitIdle(page);
    const stage = page.locator('svg.inc-stage');
    await expect(stage).toHaveAccessibleName('Sine wave');
    await expect(stage).toHaveAccessibleDescription(/The curve y = A sin.*A sine wave with amplitude 2\.0/);
    await expect(page.getByRole('slider', { name: 'Frequency (rad per unit)' })).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: 'Phase value' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Walkthrough' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Figure controls' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Walkthrough' }).getByRole('button')).toHaveText(['Walk me through it']);
    await page.getByRole('button', { name: 'Walk me through it' }).click();
    for (const name of ['Back', 'Next', 'Done']) await expect(page.getByRole('button', { name })).toBeVisible();
  });

  test('the browser accessibility tree keeps the drawing a document with reachable parts, not an image', async ({
    page,
    browserName,
  }) => {
    // Playwright's own ARIA snapshot treats every svg as an image, so read what Chromium exposes instead.
    test.skip(browserName !== 'chromium', 'reads the tree through the Chrome DevTools Protocol');
    await openScene(page, 'scene=sine-wave&autoplay=0');
    await waitIdle(page);
    const cdp = await page.context().newCDPSession(page);
    const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as {
      nodes: Array<{ ignored: boolean; role?: { value: string }; name?: { value: string }; description?: { value: string } }>;
    };
    const exposed = nodes
      .filter((n) => !n.ignored)
      .map((n) => ({ role: n.role?.value ?? '', name: n.name?.value ?? '', description: n.description?.value ?? '' }));
    const documents = exposed.filter((n) => n.role === 'graphics-document');
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({ name: 'Sine wave' });
    expect(documents[0]!.description).toContain('with a marker riding the wave');
    expect(documents[0]!.description).toContain('A sine wave with amplitude 2.0, period 6.28 units');
    expect(exposed.filter((n) => n.role === 'graphics-symbol').map((n) => n.name)).toEqual([
      'The wave: Its shape repeats every period.',
      'Amplitude guide: The crest height above the axis.',
      'One period: The length of one full wave.',
      'Marker: The height of the wave at x = 0.',
    ]);
    expect(exposed.some((n) => n.role === 'img' || n.role === 'image')).toBe(false);
  });

  test('passes automated WCAG checks in light and dark, and in step mode', async ({ page }) => {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await openScene(page, 'scene=sine-wave&autoplay=0');
      await waitIdle(page);
      expect(await axe(page), `${scheme} at rest`).toEqual([]);
      await page.getByRole('button', { name: 'Walk me through it' }).click();
      await waitIdle(page);
      expect(await axe(page), `${scheme} in step mode`).toEqual([]);
    }
  });
});
