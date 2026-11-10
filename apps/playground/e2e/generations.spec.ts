import { expect, test, type Page } from '@playwright/test';

/**
 * The Gallery of generations: films are searchable, open their intended
 * prompt, and keep their acceptance cards. The three figure acceptance cards
 * stay searchable and open their intended prompts too (AGENTS.md regression:
 * full generation of those cards needs a real model session, which this
 * suite never spends — it checks the cards reach the chat with the exact
 * prompt instead).
 */

interface GalleryCard {
  readonly title: string;
  readonly tag: string;
  readonly prompt: string;
  readonly sceneId: string | null;
  readonly playerFilm: string | null;
}

async function cards(page: Page): Promise<GalleryCard[]> {
  return page.evaluate(() => (window.__playground?.cards as GalleryCard[] | undefined) ?? []);
}

async function openGallery(page: Page): Promise<void> {
  await page.goto('/?page=generations');
  await page.waitForFunction(() => window.__playground?.ready === true);
}

const FILMS = [
  { title: 'How a pendulum keeps time', tag: 'Film · 30 s', prompt: 'Show me a 30-second film about how a pendulum keeps time.', film: 'thirty' },
  { title: 'What a wave carries', tag: 'Film · 1 min', prompt: 'Show me a one-minute film about what a wave carries.', film: 'sixty' },
  { title: 'Pythagoras: talk to the teacher', tag: 'Film · Live voice', prompt: 'Talk to the teacher in a one-minute film about Pythagoras theorem: a right triangle with squares on each side.', film: 'pythagoras' },
] as const;

const ACCEPTANCE = [
  { title: 'Meshing gears', prompt: 'Show me two gears meshing: a small gear driving a big one. How does the number of teeth change how fast each one turns?' },
  {
    title: 'Forces on a ramp',
    prompt: 'Show me the forces on a block on a ramp: its weight, the normal force and friction as arrows, and how tilting the ramp changes them.',
  },
  {
    title: 'Area under a curve',
    prompt: 'Show me how rectangles under a curve add up to its area, and how the estimate gets closer as I use more rectangles.',
  },
] as const;

test('film cards are searchable and open their intended prompt in the player', async ({ page }) => {
  await openGallery(page);
  for (const film of FILMS) {
    expect(await cards(page)).toContainEqual(expect.objectContaining({ title: film.title, tag: film.tag, prompt: film.prompt, playerFilm: film.film }));
  }

  // The tag narrows to the one film; a bare 'pendulum' would also match the reviewed pendulum figure.
  await page.getByLabel('Search generations').fill('Film · 30 s');
  await expect(page.locator('.gallery-card:not([hidden])')).toHaveCount(1);
  await expect(page.locator('.gallery-card:not([hidden]) .gallery-card__title')).toHaveText('How a pendulum keeps time');

  await page.locator('.gallery-card:not([hidden])').click();
  await expect(page.locator('.gallery-detail__title')).toHaveText('How a pendulum keeps time');
  await expect(page.locator('.gallery-detail__prompt')).toHaveText('Show me a 30-second film about how a pendulum keeps time.');
  await expect(page.locator('.gallery-detail__generate')).toHaveText('Open in player');

  await page.locator('.gallery-detail__generate').click();
  await page.waitForURL((url) => url.searchParams.get('page') === 'player' && url.searchParams.get('film') === 'thirty');
  await page.waitForFunction(() => window.__playground?.ready === true);
  await expect(page.locator('.inc-player h2')).toHaveText('How a pendulum keeps time');
});

test('a film tag search keeps all three films and hides the figures', async ({ page }) => {
  await openGallery(page);
  await page.getByLabel('Search generations').fill('Film ·');
  const visible = page.locator('.gallery-card:not([hidden]) .gallery-card__title');
  await expect(visible).toHaveCount(3);
  await expect(visible.first()).toHaveText('How a pendulum keeps time');
  await expect(visible.nth(1)).toHaveText('What a wave carries');
  await expect(visible.nth(2)).toHaveText('Pythagoras: talk to the teacher');
});

test('the Pythagoras card opens the player on the Pythagoras film', async ({ page }) => {
  await openGallery(page);
  await page.getByLabel('Search generations').fill('Pythagoras');
  await expect(page.locator('.gallery-card:not([hidden])')).toHaveCount(1);
  await page.locator('.gallery-card:not([hidden])').click();
  await expect(page.locator('.gallery-detail__title')).toHaveText('Pythagoras: talk to the teacher');
  await expect(page.locator('.gallery-detail__prompt')).toHaveText(
    'Talk to the teacher in a one-minute film about Pythagoras theorem: a right triangle with squares on each side.',
  );
  await expect(page.locator('.gallery-detail__generate')).toHaveText('Open in player');
  await page.locator('.gallery-detail__generate').click();
  await page.waitForURL((url) => url.searchParams.get('page') === 'player' && url.searchParams.get('film') === 'pythagoras');
  await page.waitForFunction(() => window.__playground?.ready === true);
  await expect(page.locator('.inc-player h2')).toHaveText('Pythagoras: talk to the teacher');
});

for (const card of ACCEPTANCE) {
  test(`acceptance card still opens its intended prompt: ${card.title}`, async ({ page }) => {
    await openGallery(page);
    expect(await cards(page)).toContainEqual(expect.objectContaining({ title: card.title, prompt: card.prompt, playerFilm: null }));
    await page.getByLabel('Search generations').fill(card.title);
    await expect(page.locator('.gallery-card:not([hidden])')).toHaveCount(1);
    await page.locator('.gallery-card:not([hidden])').click();
    await expect(page.locator('.gallery-detail__title')).toHaveText(card.title);
    await expect(page.locator('.gallery-detail__prompt')).toHaveText(card.prompt);
    await expect(page.locator('.gallery-detail__generate')).toHaveText('Generate in chat');
    await page.locator('.gallery-detail__generate').click();
    await page.waitForURL((url) => url.searchParams.get('page') === 'generate' && url.searchParams.get('prompt') === card.prompt);
  });
}

test('the generate-film box offers prompt, length presets and Generate', async ({ page }) => {
  await openGallery(page);
  await expect(page.locator('.film-generate__heading')).toHaveText('Generate a film');
  await expect(page.getByLabel('Film prompt')).toBeVisible();
  const length = page.getByLabel('Length');
  await expect(length.locator('option')).toHaveCount(5);
  await expect(length).toHaveValue('60');
  await expect(page.locator('.film-generate__generate')).toHaveText('Generate film');
});

test('a film card links to the box instead of duplicating it', async ({ page }) => {
  await openGallery(page);
  await page.getByLabel('Search generations').fill('Film · 30 s');
  await page.locator('.gallery-card:not([hidden])').click();
  await expect(page.locator('.gallery-detail__film-generate')).toBeVisible();
  await page.locator('.gallery-detail__film-generate').click();
  await expect(page.getByLabel('Film prompt')).toHaveValue('Show me a 30-second film about how a pendulum keeps time.');
});

test('Generate film streams skeleton, scenes and timings through the reference model', async ({ page }) => {
  await page.goto('/?page=generations&reference=1');
  await page.waitForFunction(() => window.__playground?.ready === true);
  await page.getByLabel('Film prompt').fill('How dots shift');
  await page.getByLabel('Length').selectOption('30');
  await page.locator('.film-generate__generate').click();
  await page.waitForFunction(() => (window.__playground?.filmGenerate as () => { skeleton: unknown })().skeleton !== null, null, { timeout: 15_000 });
  await expect(page.locator('.film-generate__timings')).toContainText('plan', { timeout: 60_000 });
  await expect(page.locator('.film-generate__timings')).toContainText('first scene');
  await expect(page.locator('.film-generate__open')).toHaveText('Open in player');
  const href = await page.locator('.film-generate__open').getAttribute('href');
  expect(href).toMatch(/page=player&film=/);
  await page.locator('.film-generate__open').click();
  await page.waitForURL((url) => url.searchParams.get('page') === 'player');
  await page.waitForFunction(() => window.__playground?.ready === true);
  await expect(page.locator('.inc-player h2')).toContainText('Film about');
});
