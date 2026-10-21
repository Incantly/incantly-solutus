import { expect, test, type Page } from '@playwright/test';

/** The Phase 4 gate inside a real note: live figures in TipTap, persisted and reachable by keyboard. */

interface EditorHandle {
  editor: {
    getJSON(): { content?: Array<{ type: string; attrs?: Record<string, unknown> }> };
    state: { doc: { descendants(f: (node: { type: { name: string } }, pos: number) => boolean | void): void }; selection: unknown };
    commands: { setNodeSelection(pos: number): boolean; focus(): boolean; setTextSelection(pos: number): boolean };
  };
  reopen(): void;
  scheduler(): { live: number; suspends: number; mounts: number; peakLive: number };
  transactions: Record<string, number>;
}

async function openNote(page: Page, query: string): Promise<void> {
  await page.goto(`/?page=editor&live=1&${query}`);
  await page.waitForFunction(() => Boolean((window.__playground as unknown as EditorHandle | undefined)?.editor));
}

const figure = (page: Page, i: number) => page.locator('figure.incantly-figure').nth(i);
const frameOf = (page: Page, i: number) => figure(page, i).frameLocator('iframe');

async function waitLive(page: Page, i: number): Promise<void> {
  await expect(figure(page, i)).toHaveAttribute('data-state', 'live', { timeout: 10_000 });
  // Browsers do not draw cross-origin frames that are out of view, so bring it in.
  await figure(page, i).scrollIntoViewIfNeeded();
  await expect(frameOf(page, i).locator('svg.inc-stage path').first()).toHaveAttribute('d', /^M/, { timeout: 10_000 });
}

function firstFigureAttrs(page: Page): Promise<Record<string, unknown> | undefined> {
  return page.evaluate(
    () => (window.__playground as unknown as EditorHandle).editor.getJSON().content?.find((n) => n.type === 'incantlyFigure')?.attrs,
  );
}

const selectionKind = (page: Page) =>
  page.evaluate(() => {
    const selection = (window.__playground as unknown as EditorHandle).editor.state.selection as {
      constructor: { name: string };
      node?: { type: { name: string } };
      toJSON(): { type: string };
    };
    return `${selection.toJSON().type}${selection.node ? `:${selection.node.type.name}` : ''}`;
  });

test.describe('figures in notes (Phase 4 gate)', () => {
  test('closing and reopening a note restores the learner values and teaching position', async ({ page }) => {
    await openNote(page, 'size=3');
    await waitLive(page, 0);
    const frame = frameOf(page, 0);
    await frame.getByRole('slider', { name: 'Amplitude' }).focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await frame.getByRole('button', { name: 'Walk me through it' }).click();
    await frame.getByRole('button', { name: 'Next' }).click();
    await expect.poll(async () => (await firstFigureAttrs(page))?.step, { timeout: 5000 }).toBe(1);
    expect((await firstFigureAttrs(page))?.values).toMatchObject({ amplitude: 2.3 });

    await page.evaluate(() => (window.__playground as unknown as EditorHandle).reopen());
    await waitLive(page, 0);
    const reopened = frameOf(page, 0);
    await expect(reopened.getByText('Step 2 of 3', { exact: true })).toBeVisible();
    await reopened.getByRole('button', { name: 'Done' }).click();
    await expect(reopened.getByRole('slider', { name: 'Amplitude' })).toHaveValue('2.3');
    // Exploring never entered the undo history.
    const persisted = await page.evaluate(() => (window.__playground as unknown as EditorHandle).transactions.persist ?? 0);
    expect(persisted).toBeGreaterThan(0);
  });

  test('keyboard focus moves from the text into a figure and back out', async ({ page }) => {
    await openNote(page, 'size=3');
    await waitLive(page, 0);
    // From the end of the text before the figure, the arrow key selects the figure.
    await page.evaluate(() => {
      const { editor } = window.__playground as unknown as EditorHandle;
      let pos = -1;
      editor.state.doc.descendants((node, p) => {
        if (pos < 0 && node.type.name === 'incantlyFigure') pos = p;
      });
      editor.commands.setTextSelection(pos - 1);
      editor.commands.focus();
    });
    // TipTap focuses on the next animation frame.
    await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('ProseMirror'))).toBe(true);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => selectionKind(page)).toBe('node:incantlyFigure');
    await expect(figure(page, 0)).toHaveClass(/is-selected/);

    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME');
    const frame = frameOf(page, 0);
    await expect(frame.locator(':focus')).toHaveAttribute('data-part', 'Wave');
    await page.keyboard.press('Tab');
    await expect(frame.locator(':focus')).toHaveAttribute('data-part', 'Amplitude');

    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('ProseMirror'))).toBe(true);
    expect(await selectionKind(page)).toBe('node:incantlyFigure');

    // Shift+Tab from the first stop leaves before the figure, into the text.
    await page.keyboard.press('Enter');
    await expect(frame.locator(':focus')).toHaveAttribute('data-part', 'Wave');
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => selectionKind(page)).toBe('text');
    await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('ProseMirror'))).toBe(true);
  });

  test('a figure in a note has an accessible name, and its parts, controls and steps inside', async ({ page }) => {
    await openNote(page, 'size=3');
    await waitLive(page, 0);
    await expect(figure(page, 0).locator('iframe')).toHaveAttribute('title', 'Interactive figure: sine wave');
    await expect(figure(page, 0)).toHaveAttribute('aria-label', 'Interactive figure: sine wave. Press Enter to use it.');
    const frame = frameOf(page, 0);
    await expect(frame.locator('svg.inc-stage')).toHaveAccessibleName('Sine wave');
    await expect(frame.locator('[role="graphics-symbol"]')).toHaveCount(4);
    await expect(frame.getByRole('slider', { name: 'Frequency (rad per unit)' })).toBeVisible();
    await expect(frame.getByRole('group', { name: 'Walkthrough' })).toBeVisible();
  });

  test('scrolling a 50-figure note keeps at most three live figures and leaves snapshots behind', async ({ page }) => {
    await openNote(page, 'size=50&suspendAfter=400');
    await waitLive(page, 0);
    let peak = 0;
    for (let i = 0; i < 30; i++) {
      await page.mouse.wheel(0, 700);
      await page.waitForTimeout(150);
      const live = await page.evaluate(() => document.querySelectorAll('figure.incantly-figure iframe').length);
      peak = Math.max(peak, live);
    }
    await page.waitForTimeout(1500);
    const stats = await page.evaluate(() => (window.__playground as unknown as EditorHandle).scheduler());
    expect(stats.peakLive).toBeLessThanOrEqual(3);
    expect(peak).toBeLessThanOrEqual(3);
    expect(stats.suspends).toBeGreaterThan(0);
    const snapshots = await page.locator('figure.incantly-figure img.incantly-figure__snapshot').count();
    expect(snapshots).toBeGreaterThan(0);
    // Suspended figures keep their place: their placeholders reserve the live figure's measured shape.
    const aspects = await page.evaluate(() =>
      (window.__playground as unknown as EditorHandle).editor
        .getJSON()
        .content?.filter((n) => n.type === 'incantlyFigure' && n.attrs?.snapshotRef)
        .map((n) => n.attrs?.aspect as number),
    );
    expect(aspects!.length).toBeGreaterThan(0);
    for (const aspect of aspects!) expect(aspect).toBeGreaterThan(0.6);
  });
});
