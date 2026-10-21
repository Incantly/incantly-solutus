import { expect, test, type Page } from '@playwright/test';

/**
 * The acceptance-test learner journey (docs/implementation/acceptance-tests.md)
 * through generation: ask, see the skeleton, receive a probe-approved figure,
 * use it, walk through it, reopen the note, and open it with reduced motion.
 * The service runs in the dev server with the reference model, so this tests
 * the pipeline, the device probe and the note, not a model.
 */

interface Handle {
  editor: { getJSON(): { content?: Array<{ type: string; attrs?: Record<string, unknown> }> } };
  signals: Array<Record<string, unknown>>;
  reopen(): void;
  records(): Promise<Array<Record<string, unknown>>>;
  setGeneration(on: boolean): Promise<unknown>;
}

async function ask(page: Page, prompt: string): Promise<void> {
  await page.getByLabel('Ask for a figure').fill(prompt);
  await page.getByRole('button', { name: 'Make a figure' }).click();
}

const card = (page: Page) => page.locator('figure.incantly-figure--generating');
const figure = (page: Page) => page.locator('figure.incantly-figure:not(.incantly-figure--generating)');
const frame = (page: Page) => figure(page).frameLocator('iframe');

async function figureAttrs(page: Page): Promise<Record<string, unknown> | undefined> {
  return page.evaluate(
    () => (window.__playground as unknown as Handle).editor.getJSON().content?.find((n) => n.type === 'incantlyFigure')?.attrs,
  );
}

async function waitDrawn(page: Page): Promise<void> {
  await expect(figure(page)).toHaveAttribute('data-state', 'live', { timeout: 15_000 });
  await figure(page).scrollIntoViewIfNeeded();
  await expect(frame(page).locator('svg.inc-stage')).toBeVisible();
}

const JOURNEYS = [
  { prompt: 'Explain projectile motion for a physics student.', concept: 'projectile motion', slider: 'Launch speed', steps: 4, animated: true },
  { prompt: 'Show me how amplitude and frequency change a sine wave.', concept: 'sine wave', slider: 'Amplitude', steps: 3, animated: true },
  { prompt: 'How does a convex lens form an image?', concept: 'thin lens', slider: 'Object distance', steps: 5, animated: false },
] as const;

test.describe('the learner journey through generation', () => {
  for (const journey of JOURNEYS) {
    test(`${journey.concept}: skeleton, approved figure, use, steps, reopen, reduced motion`, async ({ page }) => {
      await page.goto('/?page=generate');
      await ask(page, journey.prompt);

      // A structured loading skeleton, drawn from the plan.
      await expect(card(page)).toHaveAttribute('aria-busy', 'true');
      await expect(card(page).locator('.incantly-skeleton__title')).toHaveText(journey.concept);
      await expect(card(page).locator('input[type=range][disabled]')).toHaveCount(3);
      expect(await figureAttrs(page)).toBeUndefined();

      // A probe-approved figure, stored with its approval.
      await waitDrawn(page);
      await expect(card(page)).toHaveCount(0);
      const stored = await figureAttrs(page);
      expect(stored).toMatchObject({ concept: journey.concept, meta: { approvedAt: expect.any(String), validatorVersion: 1 } });
      expect(String((stored!.meta as { generationId?: string }).generationId)).toMatch(/^gen-/);

      // Paused, a parameter change redraws at once and time stays still.
      if (journey.animated) await frame(page).getByRole('button', { name: 'Pause' }).click();
      const readout = frame(page).locator('.inc-readout__value').first();
      const before = await readout.textContent();
      const slider = frame(page).getByRole('slider', { name: new RegExp(`^${journey.slider}`) });
      await slider.focus();
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
      await expect(readout).not.toHaveText(before ?? '');
      const value = await slider.inputValue();

      // Play: the figure animates again.
      if (journey.animated) {
        await frame(page).getByRole('button', { name: 'Play' }).click();
        await expect(frame(page).getByRole('button', { name: 'Pause' })).toBeVisible();
      }

      // The teaching steps, with the pointer and then the keyboard.
      await frame(page).getByRole('button', { name: 'Walk me through it' }).click();
      await expect(frame(page).getByText(`Step 1 of ${journey.steps}`, { exact: true })).toBeVisible();
      await frame(page).getByRole('button', { name: 'Next' }).focus();
      await page.keyboard.press('Enter');
      await expect(frame(page).getByText(`Step 2 of ${journey.steps}`, { exact: true })).toBeVisible();
      await expect.poll(async () => (await figureAttrs(page))?.step, { timeout: 5000 }).toBe(1);

      // Close and reopen the note: the values and the teaching position return.
      await page.evaluate(() => (window.__playground as unknown as Handle).reopen());
      await waitDrawn(page);
      await expect(frame(page).getByText(`Step 2 of ${journey.steps}`, { exact: true })).toBeVisible();
      await frame(page).getByRole('button', { name: 'Done' }).click();
      await expect(frame(page).getByRole('slider', { name: new RegExp(`^${journey.slider}`) })).toHaveValue(value);

      // With reduced motion the figure opens in a meaningful still state.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(() => (window.__playground as unknown as Handle).reopen());
      await waitDrawn(page);
      if (journey.animated) await expect(frame(page).getByRole('button', { name: 'Play' })).toBeVisible();
      await expect(frame(page).locator('svg.inc-stage path').first()).toHaveAttribute('d', /^M/);
    });
  }
});

test.describe('repair and fallback in the note', () => {
  test('a scene that fails on the device is repaired once and then shown', async ({ page }) => {
    await page.goto('/?page=generate&fault=frame-throw');
    await ask(page, 'Explain projectile motion.');
    await expect(card(page).locator('.incantly-figure__status')).toHaveText(/Fixing a problem|Checking that it works/, { timeout: 10_000 });
    await waitDrawn(page);
    const records = await page.evaluate(async () => (window.__playground as unknown as Handle).records());
    expect(records.at(-1)).toMatchObject({ outcome: 'repaired', repairs: 1, probedOn: 'device' });
  });

  test('when the repair does not help, the reviewed figure for the concept is shown with a notice', async ({ page }) => {
    await page.goto('/?page=generate&fault=missing-part-stubborn');
    await ask(page, 'How does a convex lens form an image?');
    await waitDrawn(page);
    await expect(figure(page).locator('.incantly-figure__status')).toHaveText('This is a standard version of this figure.');
    expect(await figureAttrs(page)).toMatchObject({ concept: 'thin lens', meta: { approvedAt: expect.any(String) } });
    expect(((await figureAttrs(page))!.meta as { generationId?: string }).generationId).toBeUndefined();
  });

  test('a figure that cannot be built leaves one line, the request and Retry, and nothing in the note', async ({ page }) => {
    await page.goto('/?page=generate');
    await ask(page, 'Explain photosynthesis in leaves');
    await expect(card(page).locator('.incantly-figure__status')).toHaveText('This figure could not be built.', { timeout: 10_000 });
    await expect(card(page)).toHaveAttribute('aria-label', 'Figure not built');
    await expect(card(page).locator('.incantly-skeleton__request')).toHaveText('Explain photosynthesis in leaves');
    expect(await figureAttrs(page)).toBeUndefined();
    await card(page).getByRole('button', { name: 'Retry' }).click();
    await expect(card(page)).toHaveAttribute('aria-busy', 'true');
    await expect(card(page).locator('.incantly-figure__status')).toHaveText('This figure could not be built.', { timeout: 10_000 });
    await card(page).getByRole('button', { name: 'Dismiss' }).click();
    await expect(card(page)).toHaveCount(0);
  });

  test('switching generation off stops new figures and leaves stored ones working', async ({ page }) => {
    await page.goto('/?page=generate');
    await ask(page, 'Show me a sine wave.');
    await waitDrawn(page);
    await page.evaluate(async () => (window.__playground as unknown as Handle).setGeneration(false));
    try {
      await ask(page, 'Explain projectile motion.');
      await expect(card(page).locator('.incantly-figure__status')).toHaveText('This figure could not be built. Making new figures is switched off for now.');
      // The stored figure never calls the service: it still runs after the note is reopened.
      await page.evaluate(() => (window.__playground as unknown as Handle).reopen());
      await waitDrawn(page);
    } finally {
      await page.evaluate(async () => (window.__playground as unknown as Handle).setGeneration(true));
    }
  });
});

test('product signals describe the journey without any note content', async ({ page }) => {
  await page.goto('/?page=generate');
  const prompt = 'Explain projectile motion to my study group tomorrow';
  await ask(page, prompt);
  await waitDrawn(page);
  const slider = frame(page).getByRole('slider', { name: /^Launch angle/ });
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(async () => (await page.evaluate(() => (window.__playground as unknown as Handle).signals)).map((s) => s.type))
    .toEqual(expect.arrayContaining(['time-to-skeleton', 'generation', 'figure-shown', 'first-paint', 'interactive', 'parameter-changed']));
  const signals = await page.evaluate(() => (window.__playground as unknown as Handle).signals);
  expect(signals.find((s) => s.type === 'parameter-changed')).toMatchObject({ parameter: 'angle' });
  expect(signals.find((s) => s.type === 'generation')).toMatchObject({ outcome: 'approved', repaired: false });
  const text = JSON.stringify(signals);
  expect(text).not.toContain('study group');
  expect(text).not.toContain('projectile');
});
