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
async function installLiveServer(page: Page, options: { setupComplete?: boolean } = {}): Promise<{
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
          // A silent server never answers setup: the start must time out
          // instead of hanging on the toggle forever.
          if (options.setupComplete !== false) ws.send(JSON.stringify({ setupComplete: {} }));
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

test('live voice on the Pythagoras film declares the a and b controls with ranges', async ({ page }) => {
  await mintToken(page);
  const server = await installLiveServer(page);
  await openPlayer(page, 'pythagoras');
  await expect(page.locator('.inc-player h2')).toHaveText('Pythagoras: talk to the teacher');
  await page.locator('.inc-live-toggle').click();

  // The setup carries per-film tools: show_me names this film's leg controls
  // with the ranges the scene declares.
  await expect.poll(() => server.setups.length).toBe(1);
  const setup = server.setups[0] as {
    tools?: Array<{ functionDeclarations?: Array<{ name?: string; parameters?: { properties?: { set?: { properties?: Record<string, { minimum?: number; maximum?: number }> } } } }> }>;
  };
  const showMe = setup.tools?.[0]?.functionDeclarations?.find((tool) => tool.name === 'show_me');
  expect(showMe?.parameters?.properties?.set?.properties?.a).toMatchObject({ minimum: 1, maximum: 8 });
  expect(showMe?.parameters?.properties?.set?.properties?.b).toMatchObject({ minimum: 1, maximum: 8 });
  expect(server.blocked).toEqual([]);

  await page.locator('.inc-live-toggle').click();
  await expect(page.locator('.inc-live-panel')).toBeHidden();
  expect((await liveState(page)).active).toBe(false);
});

test('mic denied still starts in listen-and-type mode with a typed question box', async ({ page }) => {
  await mintToken(page);
  const server = await installLiveServer(page);
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: { getUserMedia: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')) },
    });
  });
  await openPlayer(page, 'thirty');
  await page.locator('.inc-live-toggle').click();

  // No mic, no failure: the teacher still reads, and the panel says to type.
  await expect.poll(() => server.says().length).toBeGreaterThan(0);
  expect(server.blocked).toEqual([]);
  expect((await liveState(page)).active).toBe(true);
  await expect(page.locator('.inc-live-mic')).toHaveText('Microphone is off: type your question below.');

  // A typed question pauses the film like a spoken interruption and goes out
  // as a clientContent user turn with turnComplete.
  await page.locator('.inc-player-transport button', { hasText: 'Play' }).click();
  await expect.poll(async () => (await stats(page)).playing).toBe(true);
  const question = 'Why does it keep the same time?';
  await page.locator('.inc-live-input').fill(question);
  await page.locator('.inc-live-input').press('Enter');
  await expect.poll(async () => (await stats(page)).playing).toBe(false);
  await expect(page.locator('.inc-live-learner')).toContainText(question);
  const userTurns = server.clientMessages
    .map(
      (message) =>
        message as {
          clientContent?: { turns?: Array<{ role?: string; parts?: Array<{ text?: string }> }>; turnComplete?: boolean };
        },
    )
    .filter((message) => message.clientContent?.turns?.[0]?.role === 'user');
  expect(userTurns.length).toBeGreaterThan(0);
  const asked = userTurns[userTurns.length - 1]!;
  expect(asked.clientContent?.turns?.[0]?.parts?.[0]?.text).toBe(question);
  expect(asked.clientContent?.turnComplete).toBe(true);

  await page.locator('.inc-live-toggle').click();
  await expect(page.locator('.inc-live-panel')).toBeHidden();
  expect((await liveState(page)).active).toBe(false);
});

test('a server that never answers setup times out the start instead of hanging', async ({ page }) => {
  test.setTimeout(60_000);
  await mintToken(page);
  const server = await installLiveServer(page, { setupComplete: false });
  await openPlayer(page, 'thirty');
  await page.locator('.inc-live-toggle').click();

  // The socket opened and the setup went out; only setupComplete never comes.
  await expect.poll(() => server.setups.length).toBe(1);
  await expect(page.locator('.inc-live-error')).toContainText('Live voice could not connect in time.', { timeout: 25_000 });
  await expect(page.locator('.inc-live-panel')).toBeVisible();
  expect((await liveState(page)).active).toBe(false);
  expect((await liveState(page)).error).toContain('Live voice could not connect in time');
  // The toggle stays usable after the timeout.
  await expect(page.locator('.inc-live-toggle')).toHaveText('Live voice');
  await expect(page.locator('.inc-live-toggle')).toBeEnabled();
});

/**
 * The player asks through a model session: this stubs its creation, then
 * serves a canned insert on the session's routes and records where it
 * landed. The anchor echoes the request's own, so it always pins the beat
 * the driver paused on.
 */
async function installSessionInsert(page: Page, lines: unknown[]): Promise<string[]> {
  const askedUrls: string[] = [];
  await page.route('/api/dev/session', (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'e2e-session', baseUrl: '/api/session/e2e-session/v1', keySource: 'env' }),
    }),
  );
  await page.route('**/ask/insert', async (route) => {
    askedUrls.push(route.request().url());
    const body = route.request().postDataJSON() as { anchor: unknown };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'clip', clip: { anchor: body.anchor, lines } }),
    });
  });
  return askedUrls;
}

interface MadeExample {
  readonly ok?: boolean;
  readonly request?: string;
  readonly error?: string;
  readonly result?: unknown;
}

function madeResult(server: { toolResponses(): unknown[] }, callId: string): MadeExample | undefined {
  return server
    .toolResponses()
    .map(
      (message) =>
        message as {
          toolResponse?: { functionResponses?: Array<{ id?: string; response?: { result?: MadeExample } }> };
        },
    )
    .flatMap((message) => message.toolResponse?.functionResponses ?? [])
    .find((response) => response.id === callId)?.response?.result;
}

test('live make_example answers with what the insert actually made', async ({ page }) => {
  test.setTimeout(60_000);
  await mintToken(page);
  const server = await installLiveServer(page);
  const askedUrls = await installSessionInsert(page, [
    { say: 'The swing keeps its period.', seconds: 1, set: { angle: 0.5 } },
  ]);
  await openPlayer(page, 'thirty');
  await page.evaluate(() => (window.__playground?.model as unknown as { seek(seconds: number): void }).seek(0));
  await page.locator('.inc-live-toggle').click();
  await expect.poll(() => server.says().length).toBeGreaterThan(0);

  await server.send({ toolCall: { functionCalls: [{ id: 'make-1', name: 'make_example', args: { request: 'another swing' } }] } });
  await expect.poll(() => madeResult(server, 'make-1'), { timeout: 20_000 }).toMatchObject({ ok: true });
  const made = madeResult(server, 'make-1')!;
  expect(made.request).toBe('another swing');
  // The tool describes the real insert — its lines and the values it sets —
  // not the request that produced it.
  expect(made.result).toMatchObject({
    kind: 'insert',
    says: ['The swing keeps its period.'],
    sets: { angle: 0.5 },
  });
  // The insert went to the session's routes, not the reference path...
  expect(askedUrls.length).toBeGreaterThan(0);
  expect(askedUrls[0]).toContain('/api/session/e2e-session/v1/ask/insert');
  // ...and the panel names the answering model.
  await expect(page.locator('.inc-live-model')).toContainText('claude-sonnet-5-5');
  // The insert plays to its back-to-film beat, then live carries on from it.
  await expect(page.locator('.inc-insert')).toContainText('Explaining deeper', { timeout: 15_000 });
  await expect(page.locator('.inc-insert')).toBeHidden({ timeout: 20_000 });

  await page.locator('.inc-live-toggle').click();
  await expect(page.locator('.inc-live-panel')).toBeHidden();
  expect((await liveState(page)).active).toBe(false);
});

test('an empty insert answers make_example with ok:false', async ({ page }) => {
  await mintToken(page);
  const server = await installLiveServer(page);
  await installSessionInsert(page, []);
  await openPlayer(page, 'thirty');
  await page.evaluate(() => (window.__playground?.model as unknown as { seek(seconds: number): void }).seek(0));
  await page.locator('.inc-live-toggle').click();
  await expect.poll(() => server.says().length).toBeGreaterThan(0);

  await server.send({ toolCall: { functionCalls: [{ id: 'make-2', name: 'make_example', args: { request: 'another swing' } }] } });
  await expect.poll(() => madeResult(server, 'make-2'), { timeout: 20_000 }).toMatchObject({ ok: false });
  expect(String(madeResult(server, 'make-2')?.error ?? '')).toContain('empty');

  // A refused tool records no error: stopping still hides a clean panel.
  await page.locator('.inc-live-toggle').click();
  await expect(page.locator('.inc-live-panel')).toBeHidden();
  expect((await liveState(page)).error).toBeNull();
});

test('show_me on a card beat hides the section card while paused', async ({ page }) => {
  await mintToken(page);
  const server = await installLiveServer(page);
  await openPlayer(page, 'pythagoras');
  await expect(page.locator('.inc-player h2')).toHaveText('Pythagoras: talk to the teacher');
  await page.evaluate(() => (window.__playground?.model as unknown as { seek(seconds: number): void }).seek(0));
  // Beat 1 carries a section card over the stage before live starts.
  await expect(page.locator('.inc-player-xcard')).toContainText('Pythagoras and the right triangle');
  await page.locator('.inc-live-toggle').click();
  await expect.poll(() => server.says().length).toBeGreaterThan(0);

  // show_me pauses for the demonstration: the card hides so the changed
  // triangle is visible, while the caption keeps flowing.
  await server.send({ toolCall: { functionCalls: [{ id: 'show-2', name: 'show_me', args: { set: { a: 6, b: 8 } } }] } });
  await expect(page.locator('.inc-player-xcard')).toBeHidden();
  await expect
    .poll(() => server.toolResponses().length, { timeout: 15_000 })
    .toBeGreaterThan(0);

  // Resume reads on: the beat's own card comes back with it.
  const saysBefore = server.says().length;
  await server.send({ toolCall: { functionCalls: [{ id: 'resume-2', name: 'resume', args: {} }] } });
  await expect.poll(() => server.says().length).toBeGreaterThan(saysBefore);
  await expect(page.locator('.inc-player-xcard')).toContainText('Pythagoras and the right triangle');

  await page.locator('.inc-live-toggle').click();
  await expect(page.locator('.inc-live-panel')).toBeHidden();
  expect((await liveState(page)).active).toBe(false);
});
