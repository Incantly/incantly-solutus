import { expect, test, type Page } from '@playwright/test';
import { referenceSceneIds } from '@incantly/core/scenes';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Golden images (CH-2): every reviewed scene, at three widths in light and
 * dark, compared with the picture kept for it. Figures are drawn paused,
 * with reduced motion and in a font every test machine has, and shrunk to
 * 240 pixels across.
 *
 * Where the golden images were made, drawing is exact, so the comparison is
 * strict: a figure fails when more than 0.01% of its pixels change by more
 * than a tenth, which a 3-unit change in a pendulum's bob is. Elsewhere,
 * where text is smoothed differently, it is loose: a figure fails when its
 * height changes by more than 3%, or more than 1% of its pixels change by
 * more than a fifth. A fingerprint of the browser and of how it draws text
 * in the pinned font, kept beside the images, tells the two apart.
 *
 * After a change meant to alter figures, look at the pictures the failing
 * run saved, then write new golden images:
 *   UPDATE_GOLDENS=1 npx playwright test golden --project=chromium
 */

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden');
const FINGERPRINT = join(GOLDEN, 'fingerprint.json');
const WIDTHS = [360, 640, 960] as const;
const THEMES = ['light', 'dark'] as const;
/** Pixels across a figure is compared at. */
const ACROSS = 240;
const UPDATE = process.env.UPDATE_GOLDENS === '1';
/** How much of a figure may change, by how much a channel: where the golden images were made, and anywhere else. */
const STRICT = { level: 25, share: 0.0001, height: 0 };
const LOOSE = { level: 51, share: 0.01, height: 0.03 };

interface GalleryHandle {
  figures(): Array<{ id: string; state: string; errors: string[] }>;
  whenReady(): Promise<unknown>;
}

interface Compared {
  /** The figure shrunk to ACROSS pixels, as base64 PNG. */
  readonly png: string;
  readonly height: number;
  /** Against the golden image, when there is one. */
  readonly golden?: { readonly height: number; readonly changed: number; readonly diff: string };
}

/** The browser, and a hash of how it draws a line of text in the pinned font. */
async function fingerprint(page: Page): Promise<{ readonly browser: string; readonly text: string }> {
  const text = await page.evaluate(() => {
    const canvas = new OffscreenCanvas(320, 40);
    const context = canvas.getContext('2d')!;
    context.font = "16px 'DejaVu Sans', 'Liberation Sans', sans-serif";
    context.fillText('Incantly 0123456789 ρUΓ ½ figures', 4, 28);
    const pixels = context.getImageData(0, 0, 320, 40).data;
    let hash = 2166136261;
    for (let i = 3; i < pixels.length; i += 4) hash = Math.imul(hash ^ pixels[i]!, 16777619) >>> 0;
    return hash.toString(16);
  });
  return { browser: page.context().browser()?.version() ?? 'unknown', text };
}

/** Shrinks a screenshot in the page and compares it with its golden image there, where the browser decodes PNG. */
function compare(page: Page, shot: Buffer, golden: Buffer | null, level: number): Promise<Compared> {
  return page.evaluate(
    async ({ actual, reference, across, level }) => {
      const load = async (b64: string) => createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const encode = async (canvas: OffscreenCanvas) => {
        const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
        let text = '';
        for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(text);
      };
      const draw = (image: ImageBitmap, width: number, height: number) => {
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d')!;
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, width, height);
        return { canvas, pixels: context.getImageData(0, 0, width, height).data };
      };
      const shot = await load(actual);
      const height = Math.max(1, Math.round((shot.height * across) / shot.width));
      const small = draw(shot, across, height);
      const png = await encode(small.canvas);
      if (!reference) return { png, height };
      const ref = await load(reference);
      // The figure at the golden image's size, pixel against pixel.
      const a = height === ref.height ? small.pixels : draw(shot, ref.width, ref.height).pixels;
      const b = draw(ref, ref.width, ref.height).pixels;
      const diff = new OffscreenCanvas(ref.width, ref.height);
      const context = diff.getContext('2d')!;
      const marks = context.createImageData(ref.width, ref.height);
      let changed = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d = Math.max(Math.abs(a[i]! - b[i]!), Math.abs(a[i + 1]! - b[i + 1]!), Math.abs(a[i + 2]! - b[i + 2]!));
        const grey = (b[i]! + b[i + 1]! + b[i + 2]!) / 3;
        // The outermost pixels take in a sliver of the page around the figure, wherever it lies on the pixel grid.
        const x = (i / 4) % ref.width;
        const y = Math.floor(i / 4 / ref.width);
        const edge = x === 0 || y === 0 || x === ref.width - 1 || y === ref.height - 1;
        if (d > level && !edge) {
          changed++;
          marks.data.set([255, 0, 64, 255], i);
        } else marks.data.set([grey, grey, grey, 64], i);
      }
      context.putImageData(marks, 0, 0);
      return { png, height, golden: { height: ref.height, changed: changed / (a.length / 4), diff: await encode(diff) } };
    },
    { actual: shot.toString('base64'), reference: golden ? golden.toString('base64') : null, across: ACROSS, level },
  );
}

test.describe('golden images of every reviewed scene (CH-2)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'The golden images are drawn by Chromium');

  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      test(`every reviewed scene matches its golden image (${theme}, ${width} px)`, async ({ page }, testInfo) => {
        test.setTimeout(120_000);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(`/?page=gallery&theme=${theme}&width=${width}&font=pinned`);
        await page.waitForFunction(() => (window.__playground as unknown as GalleryHandle | undefined)?.figures !== undefined);
        await page.evaluate(() => (window.__playground as unknown as GalleryHandle).whenReady());
        const figures = await page.evaluate(() => (window.__playground as unknown as GalleryHandle).figures());
        for (const figure of figures) expect(figure.state, figure.id).toBe('live');
        mkdirSync(GOLDEN, { recursive: true });
        const here = await fingerprint(page);
        if (UPDATE) writeFileSync(FINGERPRINT, `${JSON.stringify(here, null, 2)}\n`);
        const made = existsSync(FINGERPRINT) ? (JSON.parse(readFileSync(FINGERPRINT, 'utf8')) as typeof here) : null;
        const limits = made && made.browser === here.browser && made.text === here.text ? STRICT : LOOSE;
        const failures: string[] = [];
        for (const id of referenceSceneIds()) {
          const figure = page.locator(`.gallery__cell[data-scene="${id}"] .gallery__figure`);
          await figure.scrollIntoViewIfNeeded();
          // The frame has drawn and taken its height.
          await expect(figure.frameLocator('iframe').locator('svg.inc-stage').first()).toBeVisible();
          await expect.poll(async () => (await figure.boundingBox())?.height ?? 0, { timeout: 5_000 }).toBeGreaterThan(100);
          const shot = await figure.screenshot({ animations: 'disabled', caret: 'hide' });
          const name = `${id}-${theme}-${width}.png`;
          const file = join(GOLDEN, name);
          const result = await compare(page, shot, UPDATE || !existsSync(file) ? null : readFileSync(file), limits.level);
          if (UPDATE) {
            writeFileSync(file, Buffer.from(result.png, 'base64'));
            continue;
          }
          writeFileSync(testInfo.outputPath(name), Buffer.from(result.png, 'base64'));
          if (!result.golden) {
            failures.push(`${name}: no golden image yet; look at the picture this run saved, then write it with UPDATE_GOLDENS=1`);
            continue;
          }
          const { height, changed, diff } = result.golden;
          if (Math.abs(result.height - height) > limits.height * height || changed > limits.share) {
            writeFileSync(testInfo.outputPath(`diff-${name}`), Buffer.from(diff, 'base64'));
            failures.push(`${name}: ${(changed * 100).toFixed(3)}% of pixels changed, ${result.height} px tall against ${height}`);
          }
        }
        expect(failures, limits === STRICT ? 'compared strictly, as where the golden images were made' : 'compared loosely, on another machine').toEqual([]);
      });
    }
  }
});
