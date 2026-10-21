import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type CDPSession, type Frame, type Page } from '@playwright/test';

/**
 * The performance suite from docs/architecture/performance-tiptap.md, run
 * against real notes with live figures in the sandbox. Deterministic gates
 * (live figures, opening position, persistence traffic, cleanup, placeholder
 * size, idle work) are asserted outright. Timing-sensitive measures (scroll
 * smoothness, long tasks, typing latency, frame rate, memory) are recorded,
 * held to the initial gates, and compared with the accepted baseline so a
 * regression fails. Set PERF_WRITE_BASELINE=1 to record a new baseline on the
 * controlled runner.
 */

const PROFILES = [1, 10, 50, 100, 300] as const;
const here = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(here, 'baseline.json');
/** Timing measures may be this much worse than the baseline before the suite fails. */
const TOLERANCE = 1.75;

interface Metrics {
  profile: number;
  editorReadyMs: number;
  firstFigureReadyMs: number;
  openMiddleMounts: number;
  peakLiveFigures: number;
  scrollLongTasks: number;
  scrollLongestTaskMs: number;
  scrollDroppedFrameRate: number;
  typingLatencyP95Ms: number;
  dragPersistTransactions: number;
  dragFramesP95Ms: number;
  idleFrameRequests: number;
  placeholderElements: number;
  heapGrowthRatio: number;
  /** Heap growth between the last two full scroll cycles: near zero once memory levels off. */
  heapCycleGrowthRatio: number;
  framesAfterSwitching: number;
}

type Baseline = Record<string, Partial<Metrics> & { environment?: string }>;

/** Host-page instrumentation: long tasks, frame intervals and typing latency. */
const INSTRUMENT = () => {
  // Init scripts run in every frame; only the host page is instrumented.
  if (window !== window.top) return;
  const perf = {
    longTasks: [] as number[],
    frames: [] as number[],
    keys: [] as number[],
    recording: false,
  };
  (window as unknown as { __perf: typeof perf }).__perf = perf;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (perf.recording) perf.longTasks.push(entry.duration);
    }).observe({ type: 'longtask', buffered: false });
  } catch {
    // Long tasks are a Chromium API.
  }
  let last = 0;
  const loop = (t: number) => {
    if (!perf.recording) {
      last = 0;
      return;
    }
    if (last) perf.frames.push(t - last);
    last = t;
    requestAnimationFrame(loop);
  };
  (perf as unknown as { start(): void }).start = () => {
    perf.recording = true;
    perf.frames = [];
    perf.longTasks = [];
    requestAnimationFrame(loop);
  };
  (perf as unknown as { stop(): void }).stop = () => {
    perf.recording = false;
  };
  // Typing latency: from keydown to the editor's first DOM change.
  let pressed = 0;
  document.addEventListener('keydown', () => (pressed = performance.now()), true);
  const watch = () => {
    const editor = document.querySelector('.ProseMirror');
    if (!editor) {
      requestAnimationFrame(watch);
      return;
    }
    new MutationObserver(() => {
      if (pressed) {
        perf.keys.push(performance.now() - pressed);
        pressed = 0;
      }
    }).observe(editor, { subtree: true, childList: true, characterData: true });
  };
  watch();
};

interface Handle {
  editorReadyMs: number;
  reopen(): void;
  recreate(): void;
  scheduler(): { live: number; mounts: number; suspends: number; peakLive: number; ready: number; readyMsMax: number };
  transactions: Record<string, number>;
}

const handle = <T>(page: Page, fn: (h: Handle) => T) =>
  page.evaluate((source) => new Function('h', `return (${source})(h)`)(window.__playground) as T, fn.toString());

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
};

async function heap(cdp: CDPSession): Promise<number> {
  await cdp.send('HeapProfiler.collectGarbage');
  const { metrics } = (await cdp.send('Performance.getMetrics')) as { metrics: Array<{ name: string; value: number }> };
  return metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0;
}

async function liveFrames(page: Page): Promise<number> {
  return page.locator('figure.incantly-figure iframe').count();
}

async function figureFrame(page: Page, index: number): Promise<Frame> {
  const element = await page.locator('figure.incantly-figure').nth(index).locator('iframe').elementHandle();
  const frame = await element?.contentFrame();
  if (!frame) throw new Error(`figure ${index} has no frame`);
  return frame;
}

async function waitDrawn(page: Page, index: number): Promise<void> {
  const figure = page.locator('figure.incantly-figure').nth(index);
  await figure.scrollIntoViewIfNeeded();
  await expect(figure).toHaveAttribute('data-state', 'live', { timeout: 15_000 });
  await expect(figure.frameLocator('iframe').locator('svg.inc-stage path').first()).toHaveAttribute('d', /^M/, { timeout: 15_000 });
}

/** Scrolls the whole note down and back up in wheel steps, sampling the live frames. */
async function scrollCycle(page: Page, peak: { value: number }, step: number): Promise<void> {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const steps = Math.ceil(height / step);
  for (const direction of [1, -1]) {
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, step * direction);
      await page.waitForTimeout(30);
      if (i % 4 === 0) peak.value = Math.max(peak.value, await liveFrames(page));
    }
    await page.waitForTimeout(400);
    peak.value = Math.max(peak.value, await liveFrames(page));
  }
}

function loadBaseline(): Baseline {
  return existsSync(BASELINE_PATH) ? (JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline) : {};
}

test.describe.configure({ mode: 'serial' });

for (const size of PROFILES) {
  test(`performance: a note with ${size} figure${size === 1 ? '' : 's'}`, async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'uses the Chrome DevTools Protocol for memory and long tasks');
    test.setTimeout(size >= 300 ? 600_000 : size >= 100 ? 300_000 : 150_000);
    await page.addInitScript(INSTRUMENT);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const metrics: Partial<Metrics> = { profile: size };
    const base = `/?page=editor&live=1&size=${size}&suspendAfter=1500`;

    await test.step('open at the top: the first figure draws quickly', async () => {
      await page.goto(base);
      await waitDrawn(page, 0);
      metrics.editorReadyMs = Math.round(await handle(page, (h) => h.editorReadyMs));
      const stats = await handle(page, (h) => h.scheduler());
      metrics.firstFigureReadyMs = Math.round(stats.readyMsMax);
      // Phase 4 gate: first render under 1 second.
      expect(metrics.firstFigureReadyMs).toBeLessThan(1000);
    });

    await test.step('placeholders stay small and shallow', async () => {
      metrics.placeholderElements = await page.evaluate(() =>
        Math.max(
          0,
          ...[...document.querySelectorAll('figure.incantly-figure[data-state="placeholder"]')].map((f) => f.querySelectorAll('*').length),
        ),
      );
      expect(metrics.placeholderElements).toBeLessThanOrEqual(6);
    });

    if (size >= 10) {
      await test.step('open in the middle: only the figures there mount', async () => {
        await page.goto(`${base}&at=0.5`);
        const middle = Math.floor(size * 0.5);
        await waitDrawn(page, middle);
        const stats = await handle(page, (h) => h.scheduler());
        metrics.openMiddleMounts = stats.mounts;
        expect(stats.mounts).toBeLessThanOrEqual(3);
        await page.goto(base);
        await waitDrawn(page, 0);
      });
    }

    const heapStart = await heap(cdp);
    const peak = { value: 0 };
    await test.step('scroll the whole note down and back, repeatedly', async () => {
      await page.evaluate(() => (window as unknown as { __perf: { start(): void } }).__perf.start());
      const cycles = 3;
      const heaps: number[] = [];
      for (let i = 0; i < cycles; i++) {
        // The 300-figure note is scrolled in longer strides so a run stays within minutes.
        await scrollCycle(page, peak, size >= 300 ? 1500 : 600);
        await page.waitForTimeout(size >= 100 ? 2000 : 1700); // let away figures suspend
        heaps.push(await heap(cdp));
      }
      await page.evaluate(() => (window as unknown as { __perf: { stop(): void } }).__perf.stop());
      // Memory levels off: the last full cycle adds (almost) nothing to the one before.
      metrics.heapCycleGrowthRatio = Number((heaps[cycles - 1]! / Math.max(1, heaps[cycles - 2]!)).toFixed(3));
      expect(metrics.heapCycleGrowthRatio).toBeLessThan(1.1);
      const perf = await page.evaluate(() => (window as unknown as { __perf: { frames: number[]; longTasks: number[] } }).__perf);
      metrics.scrollLongTasks = perf.longTasks.filter((d) => d > 50).length;
      metrics.scrollLongestTaskMs = Math.round(Math.max(0, ...perf.longTasks));
      metrics.scrollDroppedFrameRate = Number((perf.frames.filter((f) => f > 25).length / Math.max(1, perf.frames.length)).toFixed(3));
      const stats = await handle(page, (h) => h.scheduler());
      metrics.peakLiveFigures = Math.max(peak.value, stats.peakLive);
      expect(metrics.peakLiveFigures).toBeLessThanOrEqual(3);
    });

    await test.step('start a figure, scroll it away: it pauses, then suspends with a snapshot', async () => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await waitDrawn(page, 0);
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 3));
      const first = page.locator('figure.incantly-figure').first();
      if (size > 1) {
        await expect(first).toHaveAttribute('data-state', 'placeholder', { timeout: 6000 });
        await expect(first.locator('img.incantly-figure__snapshot')).toHaveCount(1);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await waitDrawn(page, 0);
    });

    await test.step('type in the note while figures run', async () => {
      await page.locator('.ProseMirror p').first().click();
      await page.evaluate(() => {
        (window as unknown as { __perf: { keys: number[] } }).__perf.keys = [];
      });
      await page.keyboard.type('The wave keeps moving while I type these notes. ', { delay: 25 });
      const keys = await page.evaluate(() => (window as unknown as { __perf: { keys: number[] } }).__perf.keys);
      metrics.typingLatencyP95Ms = Number(percentile(keys, 95).toFixed(1));
      expect(keys.length).toBeGreaterThan(30);
      expect(metrics.typingLatencyP95Ms).toBeLessThan(50);
    });

    await test.step('drag a parameter continuously: smooth, and saved once it settles', async () => {
      await waitDrawn(page, 0);
      const frame = await figureFrame(page, 0);
      await frame.evaluate(() => {
        const w = window as unknown as { __frames: number[]; __measuring: boolean };
        w.__frames = [];
        w.__measuring = true;
        let last = 0;
        const loop = (t: number) => {
          if (!w.__measuring) return;
          if (last) w.__frames.push(t - last);
          last = t;
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      });
      const before = await handle(page, (h) => h.transactions.persist ?? 0);
      const slider = page.locator('figure.incantly-figure').first().frameLocator('iframe').getByRole('slider').first();
      const box = (await slider.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const seconds = size >= 100 ? 3 : 5;
      for (let i = 0; i < seconds * 30; i++) {
        const fraction = 0.5 + 0.45 * Math.sin(i / 8);
        await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2);
        await page.waitForTimeout(33);
      }
      const during = (await handle(page, (h) => h.transactions.persist ?? 0)) - before;
      await page.mouse.up();
      await page.waitForTimeout(1200);
      const after = (await handle(page, (h) => h.transactions.persist ?? 0)) - before;
      metrics.dragPersistTransactions = during;
      // No transaction per pointer event. A save happens only when values stop changing for the
      // settle time (a slow turn at the end of a stroke can count), or after the stroke.
      const pointerEvents = seconds * 30;
      expect(during).toBeLessThan(pointerEvents / 10);
      expect(after).toBeLessThanOrEqual(during + 2);
      // And the value the stroke ended on is the one the note keeps.
      const shown = Number(await slider.inputValue());
      const saved = await page.evaluate(
        () =>
          (window.__playground as unknown as { editor: { getJSON(): { content: Array<{ type: string; attrs: { values: Record<string, number> } }> } } }).editor
            .getJSON()
            .content.find((n) => n.type === 'incantlyFigure')?.attrs.values,
      );
      expect(Object.values(saved ?? {})).toContain(shown);
      const frames = await frame.evaluate(() => {
        const w = window as unknown as { __frames: number[]; __measuring: boolean };
        w.__measuring = false;
        return w.__frames;
      });
      metrics.dragFramesP95Ms = Number(percentile(frames.slice(5), 95).toFixed(1));
      // Phase 4 gate: at least 30 fps at p95.
      expect(metrics.dragFramesP95Ms).toBeLessThan(1000 / 30);
    });

    await test.step('undo and redo prose; figure values stay', async () => {
      const values = await page.evaluate(
        () =>
          (window.__playground as unknown as { editor: { getJSON(): { content: Array<{ type: string; attrs: { values: unknown } }> } } }).editor
            .getJSON()
            .content.find((n) => n.type === 'incantlyFigure')?.attrs.values,
      );
      await page.locator('.ProseMirror p').first().click();
      await page.keyboard.type('More text. ');
      await page.keyboard.press('ControlOrMeta+z');
      await page.keyboard.press('ControlOrMeta+Shift+z');
      const after = await page.evaluate(
        () =>
          (window.__playground as unknown as { editor: { getJSON(): { content: Array<{ type: string; attrs: { values: unknown } }> } } }).editor
            .getJSON()
            .content.find((n) => n.type === 'incantlyFigure')?.attrs.values,
      );
      expect(after).toEqual(values);
    });

    await test.step('pause the live figures: idle means no frames at all', async () => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await waitDrawn(page, 0);
      await page.waitForTimeout(400);
      let requests = 0;
      const frames = page.locator('figure.incantly-figure iframe');
      const count = await frames.count();
      for (let i = 0; i < count; i++) {
        const frame = await (await frames.nth(i).elementHandle())!.contentFrame();
        if (!frame) continue;
        const pause = frame.getByRole('button', { name: 'Pause' });
        if (await pause.isVisible().catch(() => false)) await pause.click();
      }
      await page.waitForTimeout(300);
      for (let i = 0; i < count; i++) {
        const frame = await (await frames.nth(i).elementHandle())!.contentFrame();
        if (!frame) continue;
        requests += await frame.evaluate(
          () =>
            new Promise<number>((resolve) => {
              let n = 0;
              const original = window.requestAnimationFrame.bind(window);
              window.requestAnimationFrame = (callback) => {
                n++;
                return original(callback);
              };
              setTimeout(() => {
                window.requestAnimationFrame = original;
                resolve(n);
              }, 1000);
            }),
        );
      }
      metrics.idleFrameRequests = requests;
      expect(requests).toBe(0);
    });

    await test.step('switch notes and recreate the editor: nothing leaks', async () => {
      for (let i = 0; i < 3; i++) {
        await handle(page, (h) => h.reopen());
        await page.waitForTimeout(300);
      }
      for (let i = 0; i < 2; i++) {
        await handle(page, (h) => h.recreate());
        await page.waitForTimeout(300);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await waitDrawn(page, 0);
      await page.waitForTimeout(500);
      metrics.framesAfterSwitching = await liveFrames(page);
      expect(metrics.framesAfterSwitching).toBeLessThanOrEqual(3);
      const heapEnd = await heap(cdp);
      // Includes the snapshots the session store now holds, so it is recorded rather than gated.
      metrics.heapGrowthRatio = Number((heapEnd / Math.max(1, heapStart)).toFixed(2));
    });

    // Record the run, and compare timing measures with the accepted baseline.
    const version = page.context().browser()?.version() ?? 'unknown';
    const result = {
      ...metrics,
      environment: `${browserName} ${version}, ${process.platform} ${process.arch}, ${process.env.CI ? 'CI runner' : 'local'}`,
    };
    await testInfo.attach(`perf-${size}.json`, { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
    writeFileSync(testInfo.outputPath(`perf-${size}.json`), JSON.stringify(result, null, 2));
    console.log(`perf ${size}`, JSON.stringify(result));
    const baseline = loadBaseline();
    if (process.env.PERF_WRITE_BASELINE === '1') {
      baseline[String(size)] = result;
      writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
      return;
    }
    const accepted = baseline[String(size)];
    if (!accepted) return;
    for (const key of ['typingLatencyP95Ms', 'dragFramesP95Ms', 'scrollDroppedFrameRate', 'firstFigureReadyMs', 'editorReadyMs'] as const) {
      const was = accepted[key];
      const now = metrics[key];
      if (typeof was !== 'number' || typeof now !== 'number') continue;
      // Small absolute floors keep a near-zero baseline from failing on noise.
      const floor = key === 'scrollDroppedFrameRate' ? 0.05 : 10;
      expect(now, `${key} regressed against the baseline`).toBeLessThanOrEqual(Math.max(was * TOLERANCE, was + floor));
    }
  });
}
