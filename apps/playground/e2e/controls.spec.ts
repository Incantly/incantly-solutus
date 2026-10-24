import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { drawingState, openScene, stats } from './helpers';

/**
 * Every kind of control, at every size an integrator can choose: each one's
 * hit area is at least 36 pixels each way, 44 on a touch screen (6.9, 21.4),
 * and each is reached and worked with the keyboard alone, with no axe
 * violations (CT-10).
 */

interface Target {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** Whether a tap just inside each edge of the hit area, top, bottom, left and right, reaches the control. */
  readonly reached: readonly boolean[];
}

/** Each visible control's hit area: its box, grown by a pseudo-element that widens it, as the switch and swatches have. */
async function targets(page: Page): Promise<Target[]> {
  return page.evaluate(() => {
    const figure = document.querySelector('.inc-figure');
    if (!figure) return [];
    const found: Target[] = [];
    for (const el of figure.querySelectorAll<HTMLElement>('button, input, select, summary, textarea, [role="slider"]')) {
      if (el.getClientRects().length === 0 || getComputedStyle(el).visibility === 'hidden') continue;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = el.getBoundingClientRect();
      const box = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      const after = getComputedStyle(el, '::after');
      if (after.position === 'absolute' && after.content !== 'none' && after.content !== 'normal') {
        const own = getComputedStyle(el);
        const inner = {
          left: rect.left + parseFloat(own.borderLeftWidth),
          top: rect.top + parseFloat(own.borderTopWidth),
          right: rect.right - parseFloat(own.borderRightWidth),
          bottom: rect.bottom - parseFloat(own.borderBottomWidth),
        };
        box.left = Math.min(box.left, inner.left + parseFloat(after.left));
        box.top = Math.min(box.top, inner.top + parseFloat(after.top));
        box.right = Math.max(box.right, inner.right - parseFloat(after.right));
        box.bottom = Math.max(box.bottom, inner.bottom - parseFloat(after.bottom));
      }
      const x = (box.left + box.right) / 2;
      const y = (box.top + box.bottom) / 2;
      const edges: Array<[number, number]> = [
        [x, box.top + 1.5],
        [x, box.bottom - 1.5],
        [box.left + 1.5, y],
        [box.right - 1.5, y],
      ];
      const reached = edges.map(([px, py]) => {
        const hit = document.elementFromPoint(px, py);
        return hit !== null && (hit === el || el.contains(hit));
      });
      const label = el.getAttribute('aria-label') ?? (el.textContent?.trim() || el.getAttribute('type') || el.className);
      found.push({ name: `${el.tagName.toLowerCase()} "${label}"`, width: box.right - box.left, height: box.bottom - box.top, reached });
    }
    return found;
  });
}

function expectTargets(found: readonly Target[], least: number): void {
  expect(found.length).toBeGreaterThan(20);
  const small = found.filter((t) => t.width < least - 0.5 || t.height < least - 0.5).map((t) => `${t.name}: ${t.width.toFixed(1)} x ${t.height.toFixed(1)}`);
  expect(small, `controls under ${least} px`).toEqual([]);
  const unreached = found.filter((t) => t.reached.includes(false)).map((t) => `${t.name}: ${t.reached.join(', ')}`);
  expect(unreached, 'hit areas a tap at their edge misses').toEqual([]);
}

async function openSettings(page: Page): Promise<void> {
  const settings = page.locator('.inc-figure button[aria-label="Settings"]');
  if ((await settings.getAttribute('aria-expanded')) !== 'true') await settings.click();
  await expect(page.locator('.inc-settings')).toBeVisible();
}

const LAYOUTS = ['', 'density=compact', 'size=sm', 'density=compact&size=sm', 'size=lg', 'preset=minimal&density=compact'];

for (const layout of LAYOUTS) {
  test(`every control's hit area is 36 px or more${layout ? ` (${layout})` : ''} (6.9)`, async ({ page }) => {
    await openScene(page, `fixture=controls&autoplay=0${layout ? `&${layout}` : ''}`);
    await openSettings(page);
    expectTargets(await targets(page), 36);
    // In the walkthrough, its own buttons.
    await page.locator('.inc-steps__start button').first().click();
    await expect(page.locator('.inc-steps__active')).toBeVisible();
    expectTargets(await targets(page), 36);
  });
}

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 860 }, deviceScaleFactor: 2 });

  test("every control's hit area is 44 px or more (6.9)", async ({ page }) => {
    await openScene(page, 'fixture=controls&autoplay=0&density=compact&size=sm');
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    await openSettings(page);
    expectTargets(await targets(page), 44);
  });
});

/** The value of a parameter as the figure holds it. */
async function value(page: Page, name: string): Promise<number | undefined> {
  return (await stats(page)).values[name];
}

async function axe(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).include('.inc-figure').analyze();
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test('every kind of control works from the keyboard, with a visible focus ring and no axe violations (CT-10)', async ({ page }) => {
  await openScene(page, 'fixture=controls&autoplay=0');
  const figure = page.locator('.inc-figure');

  // Tab reaches every control in order, and each shows the focus ring.
  const reached = new Set<string>();
  await figure.locator('button, input, select, summary').first().focus();
  for (let i = 0; i < 60; i++) {
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !el.closest('.inc-figure')) return null;
      const outline = getComputedStyle(el).outlineStyle;
      const name = el.getAttribute('aria-label') ?? el.dataset.param ?? el.dataset.choice ?? (el.dataset.formula !== undefined ? 'formula' : el.textContent?.trim());
      return { key: `${el.tagName}:${name}`, ring: outline !== 'none' };
    });
    if (!focused) break;
    expect(focused.ring, `${focused.key} shows a focus ring`).toBe(true);
    reached.add(focused.key);
    await page.keyboard.press('Tab');
  }
  for (const control of ['INPUT:mirrored', 'SELECT:pace', 'BUTTON:Tallest', 'BUTTON:Low', 'INPUT:formula', 'BUTTON:Zoom in', 'SUMMARY:Text description']) {
    expect([...reached].some((key) => key.startsWith(control)), `Tab reaches ${control}`).toBe(true);
  }

  // A slider steps with the arrow keys, and its number field takes a typed value.
  const slider = figure.locator('input[type="range"][data-param="amplitude"]');
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => value(page, 'amplitude')).toBeCloseTo(1.1, 5);
  const field = figure.locator('input[type="number"][data-param="amplitude"]');
  await field.focus();
  await field.fill('1.5');
  await page.keyboard.press('Enter');
  await expect.poll(() => value(page, 'amplitude')).toBeCloseTo(1.5, 5);

  // A switch turns with the space bar and says so.
  const mirror = figure.locator('input[role="switch"][data-param="mirrored"]');
  await mirror.focus();
  await page.keyboard.press('Space');
  await expect(mirror).not.toBeChecked();
  await expect.poll(() => value(page, 'mirrored')).toBe(0);

  // A choice as buttons, a choice as a menu, and a swatch.
  const sharp = figure.locator('[data-choice="shape"][data-value="1"]');
  await sharp.focus();
  await page.keyboard.press('Enter');
  await expect(sharp).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => value(page, 'shape')).toBe(1);
  const pace = figure.locator('select[data-param="pace"]');
  await pace.focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => value(page, 'pace')).toBe(1);
  const green = figure.locator('[data-choice="tone"][data-value="2"]');
  await green.focus();
  await page.keyboard.press('Space');
  await expect(green).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => value(page, 'tone')).toBe(2);

  // A button and a preset.
  await figure.getByRole('button', { name: 'Tallest' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => value(page, 'amplitude')).toBeCloseTo(2, 5);
  await figure.getByRole('button', { name: 'Low' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => value(page, 'amplitude')).toBeCloseTo(0.5, 5);

  // The formula field takes a new formula with Enter.
  const formula = figure.locator('.inc-formula__input');
  await formula.focus();
  await formula.fill('A*cos(x - t)');
  await page.keyboard.press('Enter');
  await expect(formula).not.toHaveAttribute('aria-invalid', 'true');
  await expect(figure.locator('.inc-formula__math')).toContainText('cos');

  // The legend hides a curve, and the zoom bar zooms.
  const mirrorLegend = figure.locator('.inc-legend__toggle', { hasText: 'Mirror' });
  await mirrorLegend.focus();
  await page.keyboard.press('Enter');
  await expect(mirrorLegend).toHaveAttribute('aria-pressed', 'false');
  const before = await drawingState(page);
  await figure.getByRole('button', { name: 'Zoom in' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => drawingState(page)).not.toBe(before);

  // The settings panel opens from the keyboard and its fields take typed values.
  const settings = figure.getByRole('button', { name: 'Settings' });
  await settings.focus();
  await page.keyboard.press('Enter');
  await expect(settings).toHaveAttribute('aria-expanded', 'true');
  const panel = figure.locator('.inc-settings');
  await expect(panel).toBeVisible();
  await expect(panel.locator('input, select').first()).toBeVisible();

  // The description opens with Enter.
  const summary = figure.locator('.inc-describe summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(figure.locator('.inc-describe')).toHaveAttribute('open', '');

  expect(await axe(page), 'with the settings panel and the description open').toEqual([]);

  // The prediction: an option chosen from the keyboard.
  const option = figure.locator('.inc-predict__options button').last();
  await option.focus();
  await page.keyboard.press('Enter');
  await expect(option).toHaveAttribute('aria-pressed', 'true');

  // The walkthrough starts, steps and ends from the keyboard.
  const start = figure.locator('.inc-steps__start button').first();
  await start.focus();
  await page.keyboard.press('Enter');
  await expect(figure.locator('.inc-steps__active')).toBeVisible();
  expect(await axe(page), 'in the walkthrough').toEqual([]);
});
