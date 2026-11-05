import { expect, test, type Page } from '@playwright/test';
import { SCENE_FIXTURES } from '../src/scene-fixtures';

async function openPlayer(page: Page, film: string): Promise<void> {
  await page.goto(`/?page=player&film=${film}`);
  await page.waitForFunction(() => window.__playground?.ready === true);
}

/** Seeks to a beat's start plus an offset, through the player's own model. */
async function seekBeat(page: Page, index: number, offset: number): Promise<void> {
  await page.evaluate(([i, off]) => {
    const playground = window.__playground as unknown as { model: { seek(seconds: number): void }; film: { beats: Array<{ start: number }> } };
    playground.model.seek(playground.film.beats[i]!.start + off);
  }, [index, offset] as const);
}

interface AskState {
  readonly sheet: boolean;
  readonly answer: string;
  readonly markers: number;
  readonly stack: number;
  readonly insert: string | null;
  readonly remaining: number;
  readonly showme: string | null;
  readonly example: string | null;
  readonly depth: string;
  readonly language: string;
}

async function askState(page: Page): Promise<AskState> {
  return page.evaluate(() => (window.__playground?.ask as () => AskState)());
}

interface FullState {
  readonly version: number;
  readonly history: string[];
  readonly loop: string | null;
  readonly bookmarks: Array<{ id: string; beat: string; word: number }>;
  readonly resumed: boolean;
  readonly hash: string;
  readonly reducedMotion: boolean;
}

async function fullState(page: Page): Promise<FullState> {
  return page.evaluate(() => (window.__playground?.full as () => FullState)());
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

test('tap-to-ask streams an Answer and pins question markers', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await seekBeat(page, 0, 0.5);
  await page.getByRole('button', { name: 'Ask about this moment' }).click();
  await expect(page.locator('.inc-ask-context')).toContainText('s1b1');
  await expect(page.locator('.inc-ask-context')).toContainText('pendulum');

  await page.locator('.inc-ask-input').fill('What hangs it?');
  await page.locator('.inc-ask-chips button').first().click();
  await expect(page.locator('.inc-ask-answer')).toContainText('fastest', { timeout: 15_000 });
  await expect(page.locator('.inc-ask-status')).toContainText('First words in');

  // Markers in the scrubber and the transcript, at the anchor.
  await expect(page.locator('.inc-scrub-markers .inc-marker')).toHaveCount(1);
  await expect(page.locator('.inc-transcript .inc-marker')).toHaveCount(1);
  expect((await askState(page)).markers).toBe(1);

  // The film stays paused where it was asked.
  const stats = await page.evaluate(() => (window.__playground?.stats as () => { playing: boolean; beat: string | null })());
  expect(stats.playing).toBe(false);
  expect(stats.beat).toBe('s1b1');

  // Answer speech is opt-in: the stub answers silently through the same endpoint.
  await page.getByRole('button', { name: 'Hear answer' }).click();
  await expect(page.locator('.inc-ask-speak-status')).toContainText('Answer speech:', { timeout: 15_000 });
});

test('Show me replays the beat on the live scene and restores it', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await seekBeat(page, 2, 0.6);
  await page.getByRole('button', { name: 'Ask about this moment' }).click();
  await page.locator('.inc-ask-chips button').nth(1).click();
  await expect(page.locator('.inc-showme')).toContainText('Showing s1b3');
  await expect.poll(async () => (await askState(page)).showme).toBe('s1b3');

  await page.locator('.inc-showme button').click();
  await expect(page.locator('.inc-showme')).toBeHidden();
  await expect.poll(async () => (await askState(page)).showme).toBeNull();
});

test('Explain deeper plays an insert and Back now resumes at the anchor word', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await seekBeat(page, 2, 0.6);
  await page.getByRole('button', { name: 'Ask about this moment' }).click();
  await page.locator('.inc-ask-chips button').nth(2).click();
  await expect(page.locator('.inc-insert')).toContainText('Explaining deeper', { timeout: 15_000 });
  await expect(page.locator('.inc-caption')).toContainText('Here is the step again');
  await expect.poll(async () => (await askState(page)).insert).toBe('insert');

  await page.locator('.inc-insert button').click();
  await expect.poll(async () => page.evaluate(() => (window.__playground?.stats as () => { playing: boolean })().playing)).toBe(true);
  await expect.poll(async () => page.evaluate(() => (window.__playground?.stats as () => { beat: string | null })().beat)).toBe('s1b3');
  await expect(page.locator('.inc-insert')).toBeHidden();
});

test('an insert auto-resumes at the anchor word after a back-to-film beat', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await seekBeat(page, 4, 0.3);
  await page.getByRole('button', { name: 'Ask about this moment' }).click();
  await page.locator('.inc-ask-chips button').nth(2).click();
  await expect(page.locator('.inc-insert')).toContainText('Explaining deeper', { timeout: 15_000 });
  await expect(page.locator('.inc-caption')).toContainText('Back to the film', { timeout: 15_000 });
  await expect
    .poll(async () => page.evaluate(() => (window.__playground?.stats as () => { playing: boolean })().playing), { timeout: 20_000 })
    .toBe(true);
  await expect.poll(async () => page.evaluate(() => (window.__playground?.stats as () => { beat: string | null })().beat)).toBe('s1b5');
  await expect(page.locator('.inc-insert')).toBeHidden();
});

test('narration settings keep the key in memory and need none for the stub', async ({ page }) => {
  await openPlayer(page, 'thirty');
  const key = page.locator('.inc-narration-key');
  await expect(key).toHaveAttribute('type', 'password');
  await expect(key).toHaveAttribute('autocomplete', 'off');
  await expect(key).toHaveValue('');
  await expect(page.locator('.inc-narration-hint')).toContainText('never saved');
});

test('Another example opens a side clip with its own playback and returns to the film', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await seekBeat(page, 2, 0.6);
  await page.getByRole('button', { name: 'Ask about this moment' }).click();
  await page.locator('.inc-ask-chips button').nth(3).click();
  await expect(page.locator('.inc-example')).toContainText('The same idea, shown another way.', { timeout: 15_000 });
  // The generated clip mounts sandboxed, never trusted on the page thread.
  await expect(page.locator('.inc-example-figure iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(page.frameLocator('.inc-example-figure iframe').locator('.inc-figure')).toBeVisible();
  await expect.poll(async () => (await askState(page)).example).toBe('The same idea, shown another way.');

  // The film waits, paused, while the example plays independently.
  const stats = await page.evaluate(() => (window.__playground?.stats as () => { playing: boolean; beat: string | null })());
  expect(stats.playing).toBe(false);
  expect(stats.beat).toBe('s1b3');
  await page.locator('.inc-example-toggle').click();
  await expect(page.locator('.inc-example-toggle')).toHaveText('Play example');
  await page.locator('.inc-example-toggle').click();
  await expect(page.locator('.inc-example-toggle')).toHaveText('Pause example');

  await page.locator('.inc-example-return').click();
  await expect.poll(async () => page.evaluate(() => (window.__playground?.stats as () => { playing: boolean })().playing)).toBe(true);
  await expect.poll(async () => page.evaluate(() => (window.__playground?.stats as () => { beat: string | null })().beat)).toBe('s1b3');
  await expect(page.locator('.inc-example')).toBeHidden();
  await expect.poll(async () => (await askState(page)).example).toBeNull();
});

test('the router sends example words to the side clip, the slowest rung', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await seekBeat(page, 1, 0.4);
  await page.getByRole('button', { name: 'Ask about this moment' }).click();
  await page.locator('.inc-ask-input').fill('Give me another example of the swing');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.locator('.inc-example')).toContainText('The same idea, shown another way.', { timeout: 15_000 });
  await expect.poll(async () => (await askState(page)).example).not.toBeNull();
});

test('a runaway side clip is rejected before playback and the page stays responsive', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await seekBeat(page, 2, 0.6);
  const runaway = SCENE_FIXTURES.runaway!;
  await page.route('**/api/v1/ask/example', (route) =>
    route.fulfill({
      json: {
        status: 'clip',
        clip: {
          anchor: { film: 'pendulum', version: 1, scene: 's1', beat: 's1b3', wordIndex: 0 },
          html: runaway.html,
          css: runaway.css,
          js: runaway.js,
          caption: 'A list that never stops growing.',
        },
      },
    }),
  );
  await page.getByRole('button', { name: 'Ask about this moment' }).click();
  await page.locator('.inc-ask-chips button').nth(3).click();
  // The probe rejects it in its hidden sandbox; nothing ever mounts on the page thread.
  await expect(page.locator('.inc-ask-status')).toContainText('did not pass its checks', { timeout: 30_000 });
  await expect(page.locator('.inc-example')).toBeHidden();
  await expect.poll(async () => (await askState(page)).example).toBeNull();
  // The page is still alive: the film waits, paused, where it was asked.
  const stats = await page.evaluate(() => (window.__playground?.stats as () => { playing: boolean; beat: string | null })());
  expect(stats.playing).toBe(false);
  expect(stats.beat).toBe('s1b3');
});

test('Change the film creates a playable version 2', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await seekBeat(page, 0, 0.5);
  await page.getByRole('button', { name: 'Ask about this moment' }).click();
  await page.locator('.inc-change-open').click();
  await page.locator('.inc-change-input').fill('Open on the moment itself');
  await page.locator('.inc-change-send').click();
  await expect(page.locator('.inc-version')).toContainText('Version 2', { timeout: 60_000 });
  expect((await fullState(page)).version).toBe(2);
  await page.evaluate(() => (window.__playground?.model as unknown as { seekBeat(id: string): void }).seekBeat('s1b1'));
  await expect(page.locator('.inc-caption')).toContainText('Watch the same moment again');
});

test('a tampered patch is rejected client-side before it touches the film', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await page.route('**/api/v1/ask/change', (route) =>
    route.fulfill({
      json: {
        status: 'patch',
        patch: {
          film: 'pendulum',
          parent: 1,
          version: 2,
          reason: 'Open on the moment itself',
          beats: [{ beat: 's1b1', scene: 's1', say: 'Watch the same moment again, closely.', set: { angle: 1 } }],
          audio: [],
        },
      },
    }),
  );
  await seekBeat(page, 0, 0.5);
  await page.getByRole('button', { name: 'Ask about this moment' }).click();
  await page.locator('.inc-change-open').click();
  await page.locator('.inc-change-input').fill('Open on the moment itself');
  await page.locator('.inc-change-send').click();
  await expect(page.locator('.inc-ask-status')).toContainText('did not fit');
  await expect(page.locator('.inc-version')).toContainText('Version 1');
  expect((await fullState(page)).version).toBe(1);
});

test('patch audio sounds only on beats the patch changed', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await page.route('**/api/v1/ask/change', (route) =>
    route.fulfill({
      json: {
        status: 'patch',
        patch: {
          film: 'pendulum',
          parent: 1,
          version: 2,
          reason: 'Open on the moment itself',
          beats: [{ beat: 's1b1', scene: 's1', say: 'Watch the same moment again, closely.' }],
          audio: [
            { beat: 's1b1', seconds: 2.4, words: [0, 0.4, 0.8, 1.2, 1.6, 2], audioBase64: 'AA==', sampleRate: 8000 },
            { beat: 's1b2', seconds: 2, words: [0, 0.4], audioBase64: 'AA==', sampleRate: 8000 },
          ],
        },
      },
    }),
  );
  await seekBeat(page, 0, 0.5);
  await page.getByRole('button', { name: 'Ask about this moment' }).click();
  await page.locator('.inc-change-open').click();
  await page.locator('.inc-change-input').fill('Open on the moment itself');
  await page.locator('.inc-change-send').click();
  await expect(page.locator('.inc-version')).toContainText('Version 2', { timeout: 60_000 });
  const loads = await page.evaluate(() =>
    (window.__playground?.mixerEvents as () => Array<{ type: string; hash?: string }>)()
      .filter((event) => event.type === 'load')
      .map((event) => event.hash),
  );
  expect(loads).toContain('v2-s1b1');
  expect(loads).not.toContain('v2-s1b2');
});

test('loop-a-beat replays the beat until it is switched off', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await page.evaluate(() => {
    const playground = window.__playground as unknown as { model: { seek(seconds: number): void }; film: { beats: Array<{ start: number; seconds: number }> } };
    const beat = playground.film.beats[2]!;
    playground.model.seek(beat.start + beat.seconds - 0.4);
  });
  await page.locator('.inc-player-loop').click();
  await expect(page.locator('.inc-player-loop')).toContainText('Loop: s1b3');
  expect((await fullState(page)).loop).toBe('s1b3');
  await page.locator('.inc-player-transport button').first().click();
  await page.waitForTimeout(1200);
  const stats = await page.evaluate(() => (window.__playground?.stats as () => { playing: boolean; beat: string | null })());
  expect(stats.beat).toBe('s1b3');
  expect(stats.playing).toBe(true);
  await page.locator('.inc-player-loop').click();
  await expect(page.locator('.inc-player-loop')).toContainText('Loop: off');
});

test('bookmarks add, jump and remove by beat and word', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await seekBeat(page, 2, 0.6);
  await page.locator('.inc-bookmark-add').click();
  await expect(page.locator('.inc-bookmarks li[data-bookmark]')).toHaveCount(1);
  expect((await fullState(page)).bookmarks).toHaveLength(1);
  await seekBeat(page, 5, 0.2);
  await page.locator('.inc-bookmarks li[data-bookmark] button').first().click();
  await expect.poll(async () => page.evaluate(() => (window.__playground?.stats as () => { beat: string | null })().beat)).toBe('s1b3');
  await page.locator('.inc-bookmarks li[data-bookmark] button').nth(1).click();
  await expect(page.locator('.inc-bookmarks li[data-bookmark]')).toHaveCount(0);
});

test('link-to-time deep links seek on load and copy from the transport', async ({ page }) => {
  await page.goto('/?page=player&film=thirty#film=pendulum&v=1&beat=s1b4&w=1');
  await page.waitForFunction(() => window.__playground?.ready === true);
  await expect.poll(async () => page.evaluate(() => (window.__playground?.stats as () => { beat: string | null })().beat)).toBe('s1b4');

  await page.locator('.inc-player-link').click();
  await expect(page.locator('.inc-player-link-note')).toContainText('Link to s1b4 copied');
  expect((await fullState(page)).hash).toContain('beat=s1b4');
});

test('keyboard shortcuts play, move and ask without touching fields', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await expect(page.locator('.inc-shortcuts li')).toHaveCount(10);
  await page.locator('.inc-player h2').click();
  await page.keyboard.press('k');
  await expect.poll(async () => page.evaluate(() => (window.__playground?.stats as () => { playing: boolean })().playing)).toBe(true);
  await page.keyboard.press('k');
  await expect.poll(async () => page.evaluate(() => (window.__playground?.stats as () => { playing: boolean })().playing)).toBe(false);
  await page.keyboard.press('.');
  await expect.poll(async () => page.evaluate(() => (window.__playground?.stats as () => { beat: string | null })().beat)).toBe('s1b2');
  // Fields keep their keys: typing in the ask box asks, never seeks.
  await page.getByRole('button', { name: 'Ask about this moment' }).click();
  await page.locator('.inc-ask-input').fill('kl,');
  await page.locator('.inc-ask-input').press('k');
  await expect.poll(async () => page.evaluate(() => (window.__playground?.stats as () => { beat: string | null })().beat)).toBe('s1b2');
});

test('resume restores the film where it was left', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await seekBeat(page, 3, 0.4);
  await page.locator('.inc-player-transport button').first().click();
  await page.waitForTimeout(400);
  await page.locator('.inc-player-transport button').first().click();
  // Pausing saves the position: ids and numbers only.
  const stored = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((name) => name.startsWith('incantly.film.resume.pendulum.'));
    return key ? window.localStorage.getItem(key) : null;
  });
  expect(stored).not.toBeNull();
  expect(Object.keys(JSON.parse(stored!) as Record<string, unknown>).sort()).toEqual(['beat', 't', 'v', 'w']);
  await page.reload();
  await page.waitForFunction(() => window.__playground?.ready === true);
  await expect.poll(async () => page.evaluate(() => (window.__playground?.stats as () => { beat: string | null })().beat)).toBe('s1b4');
  expect((await fullState(page)).resumed).toBe(true);
  await expect(page.locator('.inc-resume')).toContainText('Resumed where you left off');
});

test('reduced motion starts on a still beat with its caption', async ({ page }) => {
  await page.goto('/?page=player&film=thirty&reduced-motion=1');
  await page.waitForFunction(() => window.__playground?.ready === true);
  expect((await fullState(page)).reducedMotion).toBe(true);
  const stats = await page.evaluate(() => (window.__playground?.stats as () => { playing: boolean; beat: string | null })());
  expect(stats.playing).toBe(false);
  expect(stats.beat).toBe('s1b1');
  await expect(page.locator('.inc-caption')).toContainText('pendulum hangs');
});

test('Simpler re-runs the answer at another depth', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await seekBeat(page, 0, 0.5);
  await page.getByRole('button', { name: 'Ask about this moment' }).click();
  await page.locator('.inc-ask-input').fill('What hangs it?');
  await page.locator('.inc-ask-chips button').first().click();
  await expect(page.locator('.inc-ask-answer')).toContainText('fastest', { timeout: 15_000 });
  await page.locator('.inc-ask-simpler').click();
  await expect(page.locator('.inc-ask-status')).toContainText('(simpler)', { timeout: 15_000 });
  await expect.poll(async () => (await askState(page)).depth).toBe('answer');
});

test('language and voice choices are offered for answers', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await seekBeat(page, 0, 0.5);
  await page.getByRole('button', { name: 'Ask about this moment' }).click();
  await expect(page.locator('.inc-ask-language option')).toHaveCount(6);
  await expect.poll(async () => page.locator('.inc-ask-voice option').count(), { timeout: 15_000 }).toBeGreaterThan(1);
  await page.locator('.inc-ask-language').selectOption('es');
  expect((await askState(page)).language).toBe('es');
});
