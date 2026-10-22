import { expect, test } from '@playwright/test';
import { referenceSceneIds } from '@incantly/core/scenes';

/**
 * Offline checks over every reviewed scene in a real browser (CH-2): each one
 * mounts in its sandbox in light and dark, reports no problem, draws
 * something, and keeps every drawn element and every line end inside its
 * drawing, measured from the browser's own layout rather than the runtime's
 * geometry. Each figure's picture is saved with the test results as a contact
 * sheet for review, and compared with its golden image in golden.spec.ts. The
 * depth order of 3D figures is audited in the space3d kit's tests.
 */

interface GalleryHandle {
  figures(): Array<{ id: string; state: string; errors: string[] }>;
  whenReady(): Promise<unknown>;
}

const ids = referenceSceneIds();

for (const theme of ['light', 'dark'] as const) {
  test(`every reviewed scene draws inside its stage, without a problem (${theme})`, async ({ page }, testInfo) => {
    await page.goto(`/?page=gallery&theme=${theme}`);
    await page.waitForFunction(() => (window.__playground as unknown as GalleryHandle | undefined)?.figures !== undefined);
    await page.evaluate(() => (window.__playground as unknown as GalleryHandle).whenReady());
    const figures = await page.evaluate(() => (window.__playground as unknown as GalleryHandle).figures());
    expect(figures.map((f) => f.id).sort()).toEqual([...ids].sort());
    for (const figure of figures) {
      expect(figure.state, figure.id).toBe('live');
      expect(figure.errors, figure.id).toEqual([]);
    }

    for (const id of ids) {
      const cell = page.locator(`.gallery__cell[data-scene="${id}"]`);
      await cell.scrollIntoViewIfNeeded();
      const frame = cell.frameLocator('iframe');
      await expect(frame.locator('svg.inc-stage').first()).toBeVisible();
      await expect(frame.locator('.inc-error')).toBeHidden();
      // Every visible element inside its drawing, with the probe's own 5% margin; lines too, end to end.
      const report = await frame.locator('svg.inc-stage').evaluateAll((stages) =>
        stages.map((svg) => {
          const box = svg.getBoundingClientRect();
          const mx = box.width * 0.05;
          const my = box.height * 0.05;
          const outside: string[] = [];
          let drawn = 0;
          for (const el of svg.querySelectorAll('circle, rect, line, path, polyline, polygon, ellipse, text')) {
            if (el.closest('defs, [hidden]')) continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
            drawn++;
            if (r.left < box.left - mx || r.right > box.right + mx || r.top < box.top - my || r.bottom > box.bottom + my) {
              outside.push(`${el.tagName}${el.getAttribute('data-part') ? ` "${el.getAttribute('data-part')}"` : ''} at ${Math.round(r.left - box.left)},${Math.round(r.top - box.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
            }
          }
          return { drawn, outside };
        }),
      );
      for (const stage of report) {
        expect(stage.drawn, id).toBeGreaterThanOrEqual(5);
        expect(stage.outside, id).toEqual([]);
      }
      await cell.screenshot({ path: testInfo.outputPath(`${id}-${theme}.png`) });
    }
  });
}
