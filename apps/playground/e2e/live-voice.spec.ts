import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';

// Serial: the dev server keeps one film library, so every test starts from no
// stored versions and writers never race readers.
test.describe.configure({ mode: 'serial' });

// A fake microphone for this spec only: permission arrives pre-granted and
// the device is fake, so the page's capture runs without real hardware.
test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

async function openPlayer(page: Page, film: string): Promise<void> {
  await page.request.get('/api/dev/films/clear');
  await page.goto(`/?page=player&film=${film}`);
  await page.waitForFunction(() => window.__playground?.ready === true);
}

interface PlayerStats {
  readonly time: number;
  readonly beat: string | null;
  readonly playing: boolean;
}

async function stats(page: Page): Promise<PlayerStats> {
  return page.evaluate(() => (window.__playground?.stats as () => PlayerStats)());
}

interface LiveState {
  readonly active: boolean;
  readonly status: string;
  readonly learner: string;
  readonly teacher: string;
  readonly error: string | null;
}

async function liveState(page: Page): Promise<LiveState> {
  return page.evaluate(() => (window.__playground?.live as () => LiveState)());
}

async function runtimeValues(page: Page): Promise<Record<string, number>> {
  return page.evaluate(
    () => (window.__playground?.figure as unknown as { runtime: { values(): Record<string, number> } }).runtime.values(),
  );
}

/** The first beat's line of the thirty film, for the fake teacher to read. */
const FIRST_BEAT = 'A pendulum hangs from its pivot, pulled straight down by gravity.';

/**
 * Stands in for the Gemini Live server: captures the setup and every client
 * message, answers setup immediately, and lets the test send transcripts,
 * interruptions and tool calls on demand.
 */
async function installLiveServer(page: Page): Promise<{
  setups: unknown[];
  clientMessages: unknown[];
  /** WebSocket URLs the guard blocked: any entry means the test leaked. */
  blocked: string[];
  says(): unknown[];
  toolResponses(): unknown[];
  send(message: unknown): Promise<void>;
  /** Closes the mocked socket as the server would, with a code and reason. */
  closeConnection(code: number, reason: string): void;
}> {
  const setups: unknown[] = [];
  const clientMessages: unknown[] = [];
  const blocked: string[] = [];
  let route: WebSocketRoute | null = null;
  const send = async (message: unknown): Promise<void> => {
    if (!route) throw new Error('The live socket is not open yet.');
    route.send(JSON.stringify(message));
  };
  // Awaited, so the mock owns the socket before the page can open it: an
  // un-awaited install races the Live click and leaks to the real server (a
  // 1007 from Google instead of setupComplete). One broad route, not two, so
  // no precedence question arises: the dev server's own sockets pass through,
  // the Live host is mocked, and anything else is closed at once with a
  // reason instead of reaching the network.
  await page.routeWebSocket(() => true, (ws) => {
    const host = new URL(ws.url()).hostname;
    if (host === 'generativelanguage.googleapis.com') {
      route = ws;
      ws.onMessage((message) => {
        const text = typeof message === 'string' ? message : message.toString();
        const parsed: unknown = JSON.parse(text);
        clientMessages.push(parsed);
        if (typeof parsed === 'object' && parsed !== null && 'setup' in parsed) {
          setups.push((parsed as { setup: unknown }).setup);
          ws.send(JSON.stringify({ setupComplete: {} }));
        }
      });
      return;
    }
    if (host === '127.0.0.1' || host === 'localhost') {
      ws.connectToServer();
      return;
    }
    blocked.push(ws.url());
    ws.close({ code: 4000, reason: 'unexpected websocket host in the live-voice spec' });
  });
  return {
    setups,
    clientMessages,
    blocked,
    says: () => clientMessages.filter((message) => typeof message === 'object' && message !== null && 'clientContent' in message),
    toolResponses: () =>
      clientMessages.filter((message) => typeof message === 'object' && message !== null && 'toolResponse' in message),
    send,
    closeConnection: (code, reason) => {
      if (!route) throw new Error('The live socket is not open yet.');
      route.close({ code, reason });
    },
  };
}

async function mintToken(page: Page): Promise<void> {
  await page.route('/api/v1/live/token', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'test-token', model: 'test-live-model', expiresAt: Date.now() + 3_600_000 }),
    }),
  );
}

test('token 404 shows live voice is off and starts nothing', async ({ page }) => {
  await page.route('/api/v1/live/token', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({}) }),
  );
  await openPlayer(page, 'thirty');
  await page.locator('.inc-live-toggle').click();
  await expect(page.locator('.inc-live-error')).toContainText(
    'Live voice is off on this server (set GEMINI_LIVE_RETENTION_ACCEPTED=1 with a Gemini key)',
  );
  expect((await liveState(page)).active).toBe(false);
  expect((await liveState(page)).error).toContain('Live voice is off');
});

test('live start reads beats, captions follow the transcript, and stop resumes playback', async ({ page }) => {
  // Both routes install before the player loads: the token mock was already
  // awaited in mintToken, and the socket mock below, so the Live click can
  // never race them and leak to the real server.
  await mintToken(page);
  const server = await installLiveServer(page);
  await openPlayer(page, 'thirty');

  // A deterministic start: paused on the first beat, so the teacher must
  // read that beat from its start, whatever the clock did before.
  await page.evaluate(() => (window.__playground?.model as unknown as { seek(seconds: number): void }).seek(0));
  await expect.poll(async () => (await stats(page)).beat).toBe('s1b1');

  await page.locator('.inc-live-toggle').click();

  // The setup declares audio responses and all six tools, make_example aside.
  await expect.poll(() => server.setups.length).toBe(1);
  const setup = server.setups[0] as {
    generationConfig?: { responseModalities?: string[] };
    tools?: Array<{ functionDeclarations?: Array<{ name?: string; behavior?: string }> }>;
  };
  expect(setup.generationConfig?.responseModalities).toContain('AUDIO');
  const declarations = setup.tools?.[0]?.functionDeclarations ?? [];
  expect(declarations.map((tool) => tool.name).sort()).toEqual(
    ['get_context', 'make_example', 'pause', 'resume', 'seek_beat', 'show_me'].sort(),
  );
  expect(declarations.find((tool) => tool.name === 'show_me')?.behavior).toBe('BLOCKING');
  expect(declarations.find((tool) => tool.name === 'make_example')?.behavior).toBe('NON_BLOCKING');

  // The teacher reads the beat the learner is on, from the start of it.
  await expect.poll(() => server.says().length).toBeGreaterThan(0);
  expect(JSON.stringify(server.says()[0])).toContain('A pendulum hangs from its pivot');
  // The page's socket went to the mock: a leak would have closed the session
  // with a 4000 and a panel error instead of saying anything.
  expect(server.blocked).toEqual([]);

  // The teacher's transcript captions the film while it is the current beat.
  await server.send({ serverContent: { outputTranscription: { text: FIRST_BEAT } } });
  await expect(page.locator('.inc-caption')).toContainText('pendulum hangs');
  // Turn complete moves the driver to the next beat: the caption falls back
  // to that beat's text until the voice's transcript for it arrives.
  await server.send({ serverContent: { turnComplete: true } });
  await expect.poll(async () => (await stats(page)).beat).toBe('s1b2');
  await expect.poll(() => server.says().length).toBeGreaterThanOrEqual(2);
  await expect(page.locator('.inc-caption')).toContainText('Pull the bob aside');

  // The live toggle shows on, and switching to click advance paused the film.
  await expect(page.locator('.inc-live-toggle')).toHaveText('Live voice: on');
  expect((await liveState(page)).active).toBe(true);
  expect((await stats(page)).playing).toBe(false);

  // The learner's words stream into the panel.
  await server.send({ serverContent: { inputTranscription: { text: 'what does this angle mean' } } });
  await expect(page.locator('.inc-live-learner')).toContainText('what does this angle mean');

  // Playing again, then an interruption pauses the film at once.
  await page.locator('.inc-player-transport button', { hasText: 'Play' }).click();
  await expect.poll(async () => (await stats(page)).playing).toBe(true);
  await server.send({ serverContent: { interrupted: true } });
  await expect.poll(async () => (await stats(page)).playing).toBe(false);
  await expect(page.locator('.inc-live-status')).toContainText('Interrupted');

  // The teacher's own reply carries no beat turn, so it streams beside the
  // caption instead of replacing it.
  await server.send({ serverContent: { outputTranscription: { text: 'The angle sets how wide the swing starts.' } } });
  await expect(page.locator('.inc-live-teacher')).toContainText('how wide the swing starts');

  // show_me changes the figure: the panel narrates it and the tool answers.
  await server.send({ toolCall: { functionCalls: [{ id: 'show-1', name: 'show_me', args: { set: { angle: 0.9 } } }] } });
  await expect(page.locator('.inc-live-tools li[data-tool="show_me"]')).toContainText('Showing angle = 0.9');
  await expect
    .poll(async () => server.toolResponses().length, { timeout: 15_000 })
    .toBeGreaterThan(0);
  const response = server.toolResponses()[0] as {
    toolResponse?: { functionResponses?: Array<{ id?: string; response?: { result?: { ok?: boolean } } }> };
  };
  expect(response.toolResponse?.functionResponses?.[0]?.id).toBe('show-1');
  expect(response.toolResponse?.functionResponses?.[0]?.response?.result?.ok).toBe(true);
  await expect(page.locator('.inc-live-tools li[data-tool="show_me"]')).toContainText('done');
  expect((await runtimeValues(page)).angle).toBeCloseTo(0.9, 5);

  // Resume reads on from the interrupted beat with a new say.
  const saysBefore = server.says().length;
  await server.send({ toolCall: { functionCalls: [{ id: 'resume-1', name: 'resume', args: {} }] } });
  await expect.poll(() => server.says().length).toBeGreaterThan(saysBefore);
  await expect.poll(async () => (await liveState(page)).status).toContain('Live ·');

  // Stopping live returns to normal playback at the current position.
  const at = (await stats(page)).time;
  await page.locator('.inc-live-toggle').click();
  await expect(page.locator('.inc-live-toggle')).toHaveText('Live voice');
  await expect(page.locator('.inc-live-panel')).toBeHidden();
  expect((await liveState(page)).active).toBe(false);
  // A deliberate stop records no error: the panel hides because it is clean.
  expect((await liveState(page)).error).toBeNull();
  await expect.poll(async () => (await stats(page)).playing).toBe(true);
  expect((await stats(page)).time).toBeGreaterThanOrEqual(at);
});

test('a server-side close shows its reason and keeps the panel open', async ({ page }) => {
  await mintToken(page);
  const server = await installLiveServer(page);
  await openPlayer(page, 'thirty');
  await page.evaluate(() => (window.__playground?.model as unknown as { seek(seconds: number): void }).seek(0));
  await page.locator('.inc-live-toggle').click();
  await expect.poll(() => server.says().length).toBeGreaterThan(0);
  expect(server.blocked).toEqual([]);

  // The server drops the session mid-film: the close code and reason reach
  // the panel in plain words, and the panel stays up with its message.
  await server.closeConnection(1011, 'billing is disabled for this key');
  await expect(page.locator('.inc-live-error')).toContainText('billing is disabled for this key');
  await expect(page.locator('.inc-live-error')).toContainText('1011');
  await expect(page.locator('.inc-live-panel')).toBeVisible();
  expect((await liveState(page)).active).toBe(false);
  expect((await liveState(page)).error).toContain('billing is disabled for this key');
});
