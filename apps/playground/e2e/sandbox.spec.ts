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

  test('a live figure takes a frame booted before its scene existed, and gets its markup and styles by message (PRD 25.4)', async ({ page, browserName }) => {
    const refused: string[] = [];
    page.on('console', (message) => {
      if (/Content Security Policy|Refused to apply/i.test(message.text())) refused.push(message.text());
    });
    // In its own slot, where every browser can use it; and waiting in the page body, which needs moveBefore.
    const movable = await page.evaluate(() => 'moveBefore' in Element.prototype).catch(() => false);
    for (const place of ['place', 'body'] as const) {
      await open(page, `page=sandbox&scene=pendulum&live=warm&in=${place}&styled=1&wait=600&autoplay=0`);
      const state = (await read(page)) as unknown as { states: string[]; mountedAt: number; timings: { mountMs: number } };
      expect(state.states, place).toContain('live');
      const figure = page.locator('.figure-slot iframe');
      await expect(figure).toHaveCount(1);
      await expect(figure).toBeVisible();
      await expect(figure).toHaveAttribute('title', 'Interactive figure');
      await expect(figure).not.toHaveAttribute('aria-hidden', 'true');
      const frame = page.frameLocator('.figure-slot iframe');
      await expect(frame.locator('svg.inc-stage')).toBeVisible();
      const inside = await frame.locator('html').evaluate(() => ({
        bootedAt: performance.timeOrigin,
        // The scene's own CSS and the integrator's, both let in by the frame's nonce.
        stageWidth: getComputedStyle(document.querySelector('#stage')!).maxWidth,
        outline: getComputedStyle(document.querySelector('.inc-scene')!).outlineWidth,
        styles: [...document.querySelectorAll('style')].map((style) => style.dataset.incantly ?? (style.hasAttribute('data-incantly-theme') ? 'theme' : 'other')),
      }));
      if (place === 'body' && !movable) {
        // Without moveBefore the warm frame stays unused, and the figure boots one of its own.
        expect(inside.bootedAt, place).toBeGreaterThan(state.mountedAt - 50);
      } else {
        // The frame was running long before the scene arrived.
        expect(inside.bootedAt, place).toBeLessThan(state.mountedAt - 300);
        expect(inside.styles, place).toEqual(['theme', 'host', 'scene']);
      }
      expect(inside.stageWidth, place).toBe('760px');
      expect(inside.outline, place).toBe('3px');
      test.info().annotations.push({ type: `warm-mount-ms (${place}, ${browserName})`, description: state.timings.mountMs.toFixed(0) });
    }
    expect(refused).toEqual([]);
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

  test('a live figure records a short video of itself playing, even when paused (6.10b)', async ({ page }) => {
    await open(page, 'page=sandbox&scene=pendulum&autoplay=0');
    test.skip(!(await page.evaluate(() => typeof MediaRecorder !== 'undefined')), 'This browser cannot record a canvas');
    const clip = await page.evaluate(async () => {
      const figure = (window.__playground as unknown as { figure: { exportClip(options: { seconds: number; fps: number }): Promise<Blob | null> } }).figure;
      const video = await figure.exportClip({ seconds: 1.5, fps: 12 });
      if (!video) return null;
      // Played back by the browser: it has a picture of the figure's size, and the pendulum moves in it.
      const player = document.createElement('video');
      player.muted = true;
      player.src = URL.createObjectURL(video);
      document.body.append(player);
      await player.play();
      const canvas = document.createElement('canvas');
      const frames: string[] = [];
      await new Promise<void>((resolve) => {
        const grab = () => {
          if (frames.length >= 2 || player.ended) return resolve();
          if (player.currentTime >= frames.length * 0.6) {
            canvas.width = player.videoWidth;
            canvas.height = player.videoHeight;
            canvas.getContext('2d')!.drawImage(player, 0, 0);
            frames.push(canvas.toDataURL('image/png'));
          }
          player.requestVideoFrameCallback(grab);
        };
        player.requestVideoFrameCallback(grab);
        player.onended = () => resolve();
      });
      return { type: video.type, size: video.size, width: player.videoWidth, height: player.videoHeight, moved: frames.length === 2 && frames[0] !== frames[1] };
    });
    expect(clip).not.toBeNull();
    expect(clip!.type).toMatch(/^video\/(webm|mp4)$/);
    expect(clip!.size).toBeGreaterThan(2000);
    expect(clip!.width).toBeGreaterThan(200);
    expect(clip!.width % 2).toBe(0);
    expect(clip!.moved).toBe(true);
    // The figure was paused before the clip, and is paused again after it.
    await expect(page.frameLocator('iframe').locator('button[data-action="toggle"]')).toHaveAttribute('data-playing', 'false');
  });

  test('a stage stacks its back layer, the dots behind, the drawing and the dots in front, in the frame and in every picture of it (FX-1, BR-12)', async ({ page, browserName }, testInfo) => {
    await open(page, 'page=sandbox&fixture=layers&autoplay=0');
    const frame = page.frameLocator('iframe');
    const stage = frame.locator('svg.inc-stage');
    await expect(stage).toBeVisible();
    await expect(frame.locator('svg.inc-backdrop rect')).toHaveCount(1);
    await expect(frame.locator('canvas.inc-dots--back')).toHaveCount(1);
    // Each layer's colour, as the browser paints it, and where each should show in a 200 × 100 view box.
    const tone = await stage.evaluate((svg) => {
      const style = getComputedStyle(svg);
      const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
      const rgb = (name: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = style.getPropertyValue(`--inc-${name}`).trim();
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
      };
      const stacking = (selector: string) => getComputedStyle(svg.parentElement!.querySelector(selector)!).zIndex;
      return { band: rgb('a'), disc: rgb('b'), behind: rgb('c'), front: rgb('lit'), zBackdrop: stacking('svg.inc-backdrop'), zBehind: stacking('canvas.inc-dots--back') };
    });
    expect([tone.zBackdrop, tone.zBehind]).toEqual(['-2', '-1']);
    const POINTS: Array<readonly [string, number, number, number[]]> = [
      ['the band', 70, 40, tone.band],
      ['a dot behind the drawing, over the band', 40, 50, tone.behind],
      ['another, at the far end', 160, 50, tone.behind],
      ['the disc, over the dot behind it', 104.5, 50, tone.disc],
      ['the dot in front, over the disc', 100, 50, tone.front],
    ];
    /** The colour at each point, in stage units, of a picture of the stage. */
    const sample = (src: string) =>
      page.evaluate(
        async ({ src, points }) => {
          const image = new Image();
          image.src = src;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext('2d', { willReadFrequently: true })!;
          context.drawImage(image, 0, 0);
          const s = Math.min(canvas.width / 200, canvas.height / 100);
          const ox = (canvas.width - 200 * s) / 2;
          const oy = (canvas.height - 100 * s) / 2;
          return points.map(([x, y]) => [...context.getImageData(Math.round(ox + x * s), Math.round(oy + y * s), 1, 1).data.slice(0, 3)]);
        },
        { src, points: POINTS.map(([, x, y]) => [x, y] as const) },
      );
    const expectStack = (colours: number[][], picture: string) =>
      POINTS.forEach(([what, , , want], i) => {
        const got = colours[i]!;
        expect(Math.max(...got.map((v, c) => Math.abs(v - want[c]!))), `${what}, in ${picture}: ${got.join(',')} against ${want.join(',')}`).toBeLessThanOrEqual(12);
      });
    // On the page.
    const shot = await stage.screenshot();
    expectStack(await sample(`data:image/png;base64,${shot.toString('base64')}`), 'the frame');
    // In the PNG snapshot and the exported SVG, which carries a still of each canvas in its place.
    const pictures = await page.evaluate(async () => {
      const figure = (window.__playground as unknown as { figure: { exportSvg(): Promise<string | null>; snapshot(): Promise<string | null> } }).figure;
      return { svg: await figure.exportSvg(), png: await figure.snapshot() };
    });
    expectStack(await sample(pictures.png!), 'the PNG snapshot');
    const markup = decodeURIComponent(pictures.svg!.slice(pictures.svg!.indexOf(',') + 1));
    expect(markup.match(/<image /g)).toHaveLength(2);
    // The exported SVG as an image on a page, where the browser draws the stills it carries.
    await page.evaluate(({ svg, png }) => {
      document.body.replaceChildren();
      for (const src of [svg!, png!]) {
        const img = document.createElement('img');
        img.src = src;
        img.style.cssText = 'display:block;width:640px;margin:4px';
        document.body.append(img);
      }
    }, pictures);
    await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0));
    const exported = await page.locator('img').first().screenshot();
    expectStack(await sample(`data:image/png;base64,${exported.toString('base64')}`), 'the exported SVG');
    await page.screenshot({ path: testInfo.outputPath('layer-pictures.png'), fullPage: true });
    if (browserName !== 'chromium') return;
    // In a video too: its first frame, where colours come back near enough to tell the dot from the band and the disc.
    await open(page, 'page=sandbox&fixture=layers&autoplay=0');
    await expect(page.frameLocator('iframe').locator('svg.inc-backdrop rect')).toHaveCount(1);
    const frameColours = await page.evaluate(
      async ({ points }) => {
        const figure = (window.__playground as unknown as { figure: { exportClip(options: { seconds: number; fps: number }): Promise<Blob | null> } }).figure;
        const video = await figure.exportClip({ seconds: 0.6, fps: 10 });
        if (!video) return null;
        const player = document.createElement('video');
        player.muted = true;
        player.src = URL.createObjectURL(video);
        document.body.append(player);
        // The first frame the browser presents as it plays.
        await new Promise<void>((resolve) => {
          player.requestVideoFrameCallback(() => {
            player.pause();
            resolve();
          });
          void player.play();
        });
        const canvas = document.createElement('canvas');
        canvas.width = player.videoWidth;
        canvas.height = player.videoHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        context.drawImage(player, 0, 0);
        const s = Math.min(canvas.width / 200, canvas.height / 100);
        const ox = (canvas.width - 200 * s) / 2;
        const oy = (canvas.height - 100 * s) / 2;
        return points.map(([x, y]) => [...context.getImageData(Math.round(ox + x * s), Math.round(oy + y * s), 1, 1).data.slice(0, 3)]);
      },
      { points: POINTS.map(([, x, y]) => [x, y] as const) },
    );
    test.skip(frameColours === null, 'This browser cannot record a canvas');
    const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, c) => v - b[c]!));
    const [band, behind, , disc, front] = frameColours!;
    expect(distance(behind!, tone.behind)).toBeLessThan(distance(behind!, tone.band));
    expect(distance(disc!, tone.disc)).toBeLessThan(distance(disc!, tone.behind));
    expect(distance(front!, tone.front)).toBeLessThan(distance(front!, tone.disc));
    expect(distance(band!, tone.band)).toBeLessThan(distance(band!, tone.behind));
  });

  test('the layers of a stack stay over the drawing in a stage with a border and padding of its own (FX-1, BR-12)', async ({ page }) => {
    await open(page, 'page=sandbox&fixture=layers-framed&autoplay=0');
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('svg.inc-backdrop rect')).toHaveCount(1);
    const boxes = await frame.locator('svg.inc-stage').evaluate((svg) => {
      const box = (el: Element) => {
        const r = el.getBoundingClientRect();
        return [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10);
      };
      const host = svg.parentElement!;
      return {
        drawing: box(svg),
        backdrop: box(host.querySelector('svg.inc-backdrop')!),
        canvas: box(host.querySelector('canvas.inc-dots--back')!),
        // The band on the back layer, and the outline drawn over it in the drawing, at the same coordinates.
        band: box(host.querySelector('svg.inc-backdrop rect')!),
        outline: box(svg.querySelector('[data-layer="mid"] rect')!),
      };
    });
    expect(boxes.backdrop).toEqual(boxes.drawing);
    expect(boxes.canvas).toEqual(boxes.drawing);
    for (let i = 0; i < 4; i++) expect(Math.abs(boxes.band[i]! - boxes.outline[i]!), `band against outline, ${i}`).toBeLessThanOrEqual(1);
  });

  test('an equation draws as maths in the frame, and keeps it in the exported picture and the snapshot (DG-5)', async ({ page }, testInfo) => {
    await open(page, 'page=sandbox&scene=pendulum&autoplay=0');
    const frame = page.frameLocator('iframe');
    const maths = frame.locator('svg.inc-stage foreignObject[data-math] math');
    await expect(maths).toHaveCount(1);
    // The fraction under the root is laid out as maths: it has height, stacked over two lines.
    const fraction = await frame.locator('svg.inc-stage mfrac').evaluate((el) => el.getBoundingClientRect().height);
    const letter = await frame.locator('svg.inc-stage mi').first().evaluate((el) => el.getBoundingClientRect().height);
    expect(fraction).toBeGreaterThan(letter * 1.5);
    const pictures = await page.evaluate(async () => {
      const figure = (window.__playground as unknown as { figure: { exportSvg(): Promise<string | null>; snapshot(): Promise<string | null> } }).figure;
      return { svg: await figure.exportSvg(), png: await figure.snapshot() };
    });
    const markup = decodeURIComponent(pictures.svg!.slice(pictures.svg!.indexOf(',') + 1));
    expect(markup).toContain('<switch>');
    expect(markup).toContain('<math');
    expect(markup).toContain('T ≈ 2π√(L/g)</text>');
    expect(pictures.png).toMatch(/^data:image\/png;base64,/);
    // Both pictures drawn on the page, for a look at the contact sheet.
    await page.evaluate(({ svg, png }) => {
      document.body.replaceChildren();
      for (const src of [svg!, png!]) {
        const img = document.createElement('img');
        img.src = src;
        img.style.cssText = 'display:block;width:640px;border:1px solid #ccc;margin:4px';
        document.body.append(img);
      }
    }, pictures);
    await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0));
    await page.screenshot({ path: testInfo.outputPath('equation-pictures.png'), fullPage: true });
  });
});
