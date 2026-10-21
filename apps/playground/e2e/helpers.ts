import type { Page } from '@playwright/test';

export interface SceneStats {
  renderer: {
    frameRequests: number;
    loopStarts: number;
    ticksSent: number;
    updates: number;
    workMs: number;
    workFrames: number;
    running: boolean;
  };
  runtime: { ticks: number; framesExecuted: number; playingFrames: number; pausedRedraws: number; idleTicks: number };
  time: number;
  values: Record<string, number>;
}

export async function openScene(page: Page, query: string): Promise<void> {
  await page.goto(`/?page=scene&${query}`);
  await page.waitForFunction(() => window.__playground?.ready === true);
}

export async function stats(page: Page): Promise<SceneStats> {
  return page.evaluate(() => (window.__playground?.stats as () => SceneStats)());
}

/** Waits until the figure's loop has gone idle (paused and clean). */
export async function waitIdle(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const s = (window.__playground?.stats as () => { renderer: { running: boolean } })();
    return !s.renderer.running;
  });
}

/** Everything a learner can see change: path data, positions, readouts. */
export async function drawingState(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.querySelector('.inc-figure');
    if (!root) return '';
    const shapes = [...root.querySelectorAll('svg.inc-stage [data-layer] *')].map((el) =>
      ['d', 'cx', 'cy', 'x1', 'y1', 'x2', 'y2', 'points', 'transform'].map((a) => el.getAttribute(a) ?? '').join('|'),
    );
    const readouts = [...root.querySelectorAll('.inc-readout__value')].map((el) => el.textContent);
    return JSON.stringify({ shapes, readouts });
  });
}
