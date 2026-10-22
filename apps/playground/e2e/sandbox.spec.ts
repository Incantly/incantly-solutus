import { expect, test, type Page } from '@playwright/test';

/** The Phase 3 gate: the sandbox boundary, its bridge, watchdogs and probe. */

interface SandboxState {
  ready: boolean;
  states: string[];
  errors: Array<{ phase: string; message: string; line?: number; column?: number }>;
  values: Array<Record<string, number>>;
  steps: Array<number | null>;
  outcome?: { status?: string; ok: boolean; ms?: number; report: { failures: Array<{ check: string; message: string }> } | null };
  hostTicks: number;
  hostClicks?: number;
}

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => (window.__playground as { ready?: boolean } | undefined)?.ready === true, undefined, { timeout: 15_000 });
}

const read = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__playground)) as SandboxState);

async function drawing(root: ReturnType<Page['locator']> | ReturnType<ReturnType<Page['frameLocator']>['locator']>) {
  return root.evaluate((el) => {
    const shapes = [...el.querySelectorAll('svg.inc-stage [data-layer] *')].map((node) =>
      ['d', 'cx', 'cy', 'x1', 'y1', 'x2', 'y2', 'transform'].map((a) => node.getAttribute(a) ?? '').join('|'),
    );
    const text = [...el.querySelectorAll('.inc-readout__value, .inc-explain, .inc-idea')].map((node) => node.textContent);
    return JSON.stringify({ shapes, text });
  });
}

test.describe('sandbox (Phase 3 gate)', () => {
  test('the same scene source draws the same figure on both adapters', async ({ page }) => {
    await open(page, 'page=compare&scene=sine-wave');
    const inThread = page.locator('[data-adapter="in-thread"] .inc-figure');
    const sandboxed = page.frameLocator('[data-adapter="sandbox"] iframe').locator('.inc-figure');
    // Off-screen figures do not draw, so bring the sandboxed one into view first.
    await page.locator('[data-adapter="sandbox"] iframe').scrollIntoViewIfNeeded();
    await expect(sandboxed.locator('svg.inc-stage path').first()).toHaveAttribute('d', /^M/);
    await expect.poll(async () => (await drawing(sandboxed)) === (await drawing(inThread))).toBe(true);
  });

  test('frames are sandboxed with scripts only, under the ADR 005 policy', async ({ page }) => {
    await open(page, 'page=sandbox&scene=sine-wave&autoplay=0');
    const iframe = page.locator('iframe');
    await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(iframe).toHaveAttribute('title', 'Interactive figure');
    expect(await iframe.evaluate((el) => (el as HTMLIFrameElement).contentDocument)).toBeNull();
    const policy = await page.frameLocator('iframe').locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(policy?.split('; ')).toEqual([
      "default-src 'none'",
      expect.stringMatching(/^script-src 'sha256-[A-Za-z0-9+/]+=*'$/),
      expect.stringMatching(/^style-src 'sha256-[A-Za-z0-9+/]+=*' 'sha256-[A-Za-z0-9+/]+=*'$/),
      'img-src blob: data:',
      'font-src data:',
      'worker-src blob:',
      "form-action 'none'",
      "base-uri 'none'",
    ]);
  });

  test('learner values and steps reach the host over the bridge, throttled', async ({ page }) => {
    await open(page, 'page=sandbox&scene=sine-wave&autoplay=0');
    const frame = page.frameLocator('iframe');
    const slider = frame.getByRole('slider', { name: 'Amplitude' });
    await slider.focus();
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await read(page)).values.at(-1)?.amplitude).toBeCloseTo(3, 10);
    expect((await read(page)).values.length).toBeLessThan(10);
    await frame.getByRole('button', { name: 'Walk me through it' }).click();
    await expect.poll(async () => (await read(page)).steps).toEqual([0]);
  });

  test('a scene is probed hidden before it is shown', async ({ page }) => {
    await open(page, 'page=sandbox&scene=sine-wave&probe=1&autoplay=0');
    const state = await read(page);
    expect(state.outcome).toMatchObject({ status: 'live', ok: true });
    await expect(page.locator('iframe')).toHaveCount(1);
    await expect(page.locator('iframe')).toHaveAttribute('title', 'Interactive figure');
  });

  test('a frame warmed before the scene exists checks it, kits and all, and then closes (PRD 25.4)', async ({ page }) => {
    for (const scene of ['buoyancy', 'normal']) {
      await open(page, `page=sandbox&scene=${scene}&probe=warm&wait=300`);
      const state = await read(page);
      expect(state.outcome, scene).toMatchObject({ status: 'passed', ok: true });
      await expect(page.locator('iframe')).toHaveCount(0);
    }
    await open(page, 'page=sandbox&fixture=nan-at-max&probe=warm&wait=0');
    expect((await read(page)).outcome).toMatchObject({ status: 'rejected', ok: false });
  });

  test('a scene that fails the probe never appears to the learner', async ({ page }) => {
    await open(page, 'page=sandbox&fixture=nan-at-max&probe=1');
    const state = await read(page);
    expect(state.outcome).toMatchObject({ status: 'rejected', ok: false });
    expect(state.outcome!.report!.failures.map((f) => f.check)).toContain('numbers');
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.getByText('This figure could not be built.')).toBeVisible();
  });

  test("a scene error is reported at the agent's own line and the figure keeps its controls", async ({ page }) => {
    await open(page, 'page=sandbox&fixture=throws-later');
    await expect.poll(async () => (await read(page)).errors.length, { timeout: 5000 }).toBeGreaterThan(0);
    const [error] = (await read(page)).errors;
    expect(error).toMatchObject({ phase: 'frame', line: 7 });
    expect(error!.column).toBeGreaterThanOrEqual(19);
    expect(error!.column).toBeLessThanOrEqual(36);
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('.inc-error')).toBeVisible();
    await expect(frame.getByRole('slider', { name: 'speed' })).toBeVisible();
  });

  test('fuel stops a runaway loop within moments and the page stays responsive', async ({ page }) => {
    await open(page, 'page=sandbox&fixture=runaway');
    await expect.poll(async () => (await read(page)).errors.map((e) => e.phase), { timeout: 3000 }).toContain('runaway');
    const ticks = (await read(page)).hostTicks;
    await page.waitForTimeout(300);
    expect((await read(page)).hostTicks).toBeGreaterThan(ticks + 2);
  });

  test('a scene that never returns is terminated while the editor stays responsive', async ({ page }) => {
    await open(page, 'page=attack&case=hang-frame');
    const start = (await read(page)).hostTicks;
    await page.locator('#host-button').click();
    await page.locator('#host-button').click();
    expect((await read(page)).hostClicks).toBe(2);
    await expect.poll(async () => (await read(page)).states, { timeout: 8000 }).toContain('failed');
    const state = await read(page);
    expect(state.errors.map((e) => e.phase)).toContain('unresponsive');
    // The host's own 50 ms heartbeat kept running all through the hang.
    expect(state.hostTicks - start).toBeGreaterThan(20);
    await expect(page.locator('iframe')).toHaveCount(0);
  });

  test('a scene that never finishes mounting is removed', async ({ page }) => {
    await open(page, 'page=attack&case=hang-mount');
    await expect.poll(async () => (await read(page)).states, { timeout: 8000 }).toContain('failed');
    await expect(page.locator('iframe')).toHaveCount(0);
  });

  test('the probe watchdog stops a scene that never finishes', async ({ page }) => {
    await open(page, 'page=attack&case=hang-probe');
    const { outcome } = await read(page);
    expect(outcome!.ok).toBe(false);
    expect(outcome!.report!.failures[0]).toMatchObject({ check: 'timeout' });
    expect(outcome!.ms).toBeLessThan(4000);
    await expect(page.locator('iframe')).toHaveCount(0);
  });

  test('without the validator, a scene still cannot reach the host, storage or the network', async ({ page, browserName }) => {
    const reached: string[] = [];
    const blocked: string[] = [];
    await page.route(/attacker\.example/, (route) => {
      reached.push(route.request().url());
      return route.abort();
    });
    page.on('requestfinished', (request) => {
      if (request.url().includes('attacker.example')) reached.push(request.url());
    });
    page.on('requestfailed', (request) => {
      if (request.url().includes('attacker.example')) blocked.push(request.failure()?.errorText ?? '');
    });
    await open(page, 'page=attack&case=escape');
    const description = page.frameLocator('iframe').locator('.inc-print-only');
    await expect(description).toContainText('import:blocked');
    const results = Object.fromEntries(
      ((await description.textContent()) ?? '').split(' ').map((entry) => entry.split(':') as [string, string]),
    );
    expect(results).toMatchObject({
      globalThis: 'undefined',
      self: 'undefined',
      fetch: 'TypeError',
      websocket: 'TypeError',
      importScripts: 'TypeError',
      indexedDB: 'TypeError',
      eval: 'EvalError',
      postMessage: 'TypeError',
      import: 'blocked',
    });
    expect(reached).toEqual([]);
    // Chromium reports each attempt (image, CSS image, module import) as blocked by the policy.
    if (browserName === 'chromium') expect(blocked).toEqual(['csp', 'csp', 'csp']);
    expect(await page.evaluate(() => document.body.dataset.pwned ?? null)).toBeNull();
    // The figure itself kept working, so nothing here relied on crashing it.
    expect((await read(page)).states).toEqual(['live']);
  });

  test('a frame that navigates is removed', async ({ page }) => {
    await open(page, 'page=attack&case=navigate');
    await expect.poll(async () => (await read(page)).states).toEqual(['live']);
    await page.frameLocator('iframe').locator('#go').click();
    await expect.poll(async () => (await read(page)).states).toContain('failed');
    await expect(page.locator('iframe')).toHaveCount(0);
  });

  test('a live figure can be snapshotted to a PNG', async ({ page }) => {
    await open(page, 'page=sandbox&scene=sine-wave&autoplay=0');
    const png = await page.evaluate(async () => {
      const figure = (window.__playground as unknown as { figure: { snapshot(): Promise<string | null> } }).figure;
      return figure.snapshot();
    });
    expect(png).toMatch(/^data:image\/png;base64,/);
    const size = await page.evaluate(async (src) => {
      const image = new Image();
      image.src = src!;
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    }, png);
    expect(size.width).toBeGreaterThan(100);
    expect(size.height).toBeGreaterThan(50);
  });

  test('a live figure exports its drawing as an SVG image with the theme written in (SV-14)', async ({ page }) => {
    await open(page, 'page=sandbox&scene=sine-wave&autoplay=0');
    const svg = await page.evaluate(async () => {
      const figure = (window.__playground as unknown as { figure: { exportSvg(): Promise<string | null> } }).figure;
      return figure.exportSvg();
    });
    expect(svg).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    const markup = decodeURIComponent(svg!.slice(svg!.indexOf(',') + 1));
    // Colours written in, not CSS variables or classes, so it stands alone.
    expect(markup).toContain('<svg');
    expect(markup).not.toContain('var(--inc-');
    expect(markup).not.toContain('class="inc-');
    expect(markup).toMatch(/stroke="rgb\(/);
    const size = await page.evaluate(async (src) => {
      const image = new Image();
      image.src = src!;
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    }, svg);
    expect(size.width).toBeGreaterThan(100);
  });
});
