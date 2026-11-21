/** App modes in the studio (.kiro/specs/app-modes R10.1 to R10.4, R3.6, R9). */
import { afterEach, describe, expect, it } from 'vitest';
import { mountStudio } from '../src/studio-page';
import type { Mounted } from '../src/studio-page';
import { frameStyle } from '@incantly/sdk/screen';

describe('app modes in the studio', () => {
  let root: HTMLElement;
  let m: Mounted;
  const mount = (mode?: Parameters<typeof mountStudio>[1] extends infer O ? O extends { mode?: infer M } ? M : never : never): void => {
    root = document.createElement('div');
    document.body.append(root);
    m = mountStudio(root, { raf: () => 1, caf: () => undefined, storage: null, ...(mode ? { mode } : {}) });
  };
  afterEach(() => {
    m.dispose();
    root.remove();
  });
  const typeLine = (text: string): void => {
    const input = root.querySelector<HTMLInputElement>('.expr-new .expr-input') as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  };

  it('opens in classic by default, with everything', () => {
    mount();
    expect(m.modes.mode.id).toBe('classic');
    expect(root.querySelector('.app')?.getAttribute('data-mode')).toBe('classic');
    expect((root.querySelector('.panel') as HTMLElement).hidden).toBe(false);
    expect(root.querySelector('.app-btn')?.textContent).toBe('☰ Classic');
  });

  it('the start screen shows only the modes this build has (R10.1)', () => {
    mount();
    m.modes.showStart();
    const tiles = [...root.querySelectorAll<HTMLElement>('.mode-tile')].map((t) => t.dataset['mode']);
    expect(tiles).toEqual(['graphing', 'geometry', 'scientific', 'probability', 'cas', 'notes', 'classic', 'graphing3d']);
    expect(root.querySelector('.mode-tile[data-mode="geometry"] .tile-purpose')?.textContent).toBe('build and measure');
  });

  it('geometry: graphics only, construction tools, no axes or grid (R10.2)', () => {
    mount('geometry');
    expect((root.querySelector('.panel') as HTMLElement).hidden).toBe(true);
    expect(frameStyle.axes).toBe(false);
    expect(frameStyle.grid).toBe('none');
    expect(m.tools.element.hidden).toBe(false);
    expect((root.querySelector('.top-tools button[title^="Open the data-analysis"]') as HTMLElement).hidden).toBe(true);
  });

  it('graphing: algebra and graphics, a compact tool set', () => {
    mount('graphing');
    expect((root.querySelector('.panel') as HTMLElement).hidden).toBe(false);
    const labels = [...m.tools.element.querySelectorAll('.strip-btn')].map((b) => b.getAttribute('aria-label') ?? '');
    expect(labels.some((l) => /group Points/i.test(l))).toBe(true);
    expect(labels.some((l) => /group Polygons/i.test(l))).toBe(false);
    m.tools.select('polygon');
    expect(m.tools.current()).not.toBe('polygon');
  });

  it('a line the mode forbids fails with mode_forbids and offers allowed commands (R3.1)', () => {
    mount('geometry');
    typeLine('f(x) = x^2');
    typeLine('d = Derivative(f)');
    expect(root.querySelector('.expr-new .err-msg')?.textContent).toBe('Derivative is not available in the geometry mode.');
    expect(root.querySelector('.expr-new .err-hint')?.textContent).toMatch(/are available\./);
    expect(m.session.figure.get('d')).toBeUndefined();
  });

  it('the slider chip shows only in modes with auto sliders (R3.6)', () => {
    mount('graphing');
    typeLine('g(x) = k * x');
    expect([...root.querySelectorAll('.expr-new .err-fix')].map((b) => b.textContent)).toContain('Make slider k');
    m.dispose();
    root.remove();
    mount('geometry');
    typeLine('P = (k, 1)');
    expect([...root.querySelectorAll('.expr-new .err-fix')].map((b) => b.textContent)).not.toContain('Make slider k');
  });

  it('a learner line may not set the mode', () => {
    mount('graphing');
    typeLine('@mode classic');
    expect(root.querySelector('.expr-new .err-msg')?.textContent).toBe('@mode is chosen by the host page, not by a line.');
  });

  it('switching asks before removing objects; force removes them in one undo step (R10.3)', () => {
    mount('graphing');
    m.session.applyLines(['f(x) = x^2', 'P = (1, 2)', 'n = 1 + 2'], 'test');
    const dry = m.modes.setMode('scientific', { ask: true });
    expect(dry.ok).toBe(false);
    expect(m.modes.mode.id).toBe('graphing');
    const dialog = m.modes.switchDialog;
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.querySelector('h2')?.textContent).toBe('Switch to Scientific?');
    expect(dialog.textContent).toMatch(/1 object can't be used there/);
    const go = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Switch and remove') as HTMLButtonElement;
    go.click();
    expect(m.modes.mode.id).toBe('scientific');
    expect(m.session.figure.get('f')).toBeUndefined();
    expect(m.session.figure.get('n')).toBeDefined();
    m.undo();
    expect(m.session.figure.get('f')).toBeDefined();
  });

  it('a switch that loses nothing applies at once and says so', () => {
    mount('graphing');
    m.session.applyLines(['A = (1, 2)'], 'test');
    expect(m.modes.setMode('geometry').ok).toBe(true);
    expect(m.modes.mode.id).toBe('geometry');
    expect(m.status.textContent).toBe('Geometry.');
  });

  it('a mode that is not built is refused', () => {
    mount();
    const r = m.modes.setMode('hologram');
    expect(r.error?.kind).toBe('unknown_mode');
    expect(m.modes.mode.id).toBe('classic');
  });

  it('the settings sheet offers the mode\'s settings, applies them live, with reset (R10.4)', () => {
    mount('scientific');
    m.modes.openSettings();
    const sheet = m.modes.settingsSheet;
    expect(sheet.hidden).toBe(false);
    const tabs = [...sheet.querySelectorAll('.settings-tabs .tab')].map((t) => t.textContent);
    expect(tabs).not.toContain('Graphics');
    m.modes.settings.set('textScale', 150);
    expect((root.querySelector('.app') as HTMLElement).style.getPropertyValue('--text-scale')).toBe('1.5');
    m.modes.settings.set('highContrast', true);
    expect(root.querySelector('.app')?.classList.contains('high-contrast')).toBe(true);
    m.modes.settings.set('reducedMotion', 'on');
    expect(root.querySelector('.app')?.classList.contains('reduced-motion')).toBe(true);
  });

  it('a file setting becomes a line of the figure', () => {
    mount('graphing');
    m.modes.settings.set('angleUnit', 'degree');
    expect(m.session.save()).toMatch(/^@angleunit degree$/m);
    m.modes.settings.set('axes', false);
    expect(frameStyle.axes).toBe(false);
    expect(m.session.save()).toMatch(/^@axes off$/m);
  });

  it('a loaded figure\'s setting lines are read without adding undo steps', () => {
    mount('graphing');
    m.session.load('@rounding 4\nA = (1.23456, 2)');
    expect(m.modes.settings.get('rounding')).toEqual({ mode: 'decimals', digits: 4 });
    expect(m.session.undoState().canUndo).toBe(false);
  });

  it('a script loaded in a mode is checked by its gate', () => {
    mount('scientific');
    const r = m.session.load('n = 1 + 2\nc = Circle((0, 0), 1)');
    expect(r.applied).toBe(1);
    expect(r.errors[0]?.kind).toBe('mode_forbids');
  });

  it('the language setting switches text and direction (R7)', async () => {
    mount('graphing');
    m.modes.settings.set('language', 'ar');
    const app = root.querySelector('.app') as HTMLElement;
    for (let i = 0; i < 200 && app.getAttribute('dir') !== 'rtl'; i++) await new Promise((r) => setTimeout(r, 10));
    expect(app.getAttribute('dir')).toBe('rtl');
    expect(app.getAttribute('lang')).toBe('ar');
    expect(root.querySelector('.app-btn')?.textContent).toBe('☰ الرسوم البيانية');
  });
});

describe('the Notes app shows the board (app-modes ui 2 Notes; board design 15)', () => {
  let root: HTMLElement;
  let m: Mounted;
  const mount = (mode?: 'notes' | 'graphing' | 'classic'): void => {
    root = document.createElement('div');
    document.body.append(root);
    m = mountStudio(root, { raf: () => 1, caf: () => undefined, storage: null, ...(mode ? { mode } : {}) });
  };
  afterEach(() => {
    m.dispose();
    root.remove();
  });

  it('opening in notes shows the board and no graph or expression list', () => {
    mount('notes');
    expect(m.modes.mode.id).toBe('notes');
    expect(root.querySelector('.app')?.getAttribute('data-mode')).toBe('notes');
    expect(m.board.element.hidden).toBe(false);
    expect(m.board.view()).toBeDefined();
    expect(m.board.element.querySelector('[data-board-view]')).not.toBeNull();
    expect((root.querySelector('.panel') as HTMLElement).hidden).toBe(true);
  });

  it('the board has its tools, a page bar with an add button, and undo and redo', () => {
    mount('notes');
    const board = m.board.element;
    expect([...board.querySelectorAll<HTMLElement>('[data-tool]')].map((b) => b.dataset['tool'])).toEqual(['pen', 'highlighter', 'eraser', 'laser', 'lasso', 'hand']);
    expect(board.querySelector('button[aria-label="Add a page"]')).not.toBeNull();
    expect(board.querySelector('button[aria-label="Undo"]')).not.toBeNull();
    expect(board.querySelector('button[aria-label="Redo"]')).not.toBeNull();
    expect(board.querySelector('output[aria-label="Zoom"]')).not.toBeNull();
  });

  it('the board starts with one page, and its add button adds a page', () => {
    mount('notes');
    const view = m.board.view();
    expect(view?.core.pages.list()).toHaveLength(1);
    (m.board.element.querySelector('button[aria-label="Add a page"]') as HTMLButtonElement).click();
    expect(view?.core.pages.list()).toHaveLength(2);
  });

  it('other apps do not make the board: it is made when Notes first shows it', () => {
    mount('graphing');
    expect(m.board.view()).toBeUndefined();
    expect(m.board.element.hidden).toBe(true);
    expect(m.board.element.querySelector('[data-board-view]')).toBeNull();
  });

  it('switching to Notes and back hides the board and keeps its board, so a drawing is still there', () => {
    mount('classic');
    expect(m.board.view()).toBeUndefined();
    expect(m.modes.setMode('notes').error).toBeUndefined();
    const view = m.board.view();
    expect(view).toBeDefined();
    expect(m.board.element.hidden).toBe(false);
    expect(m.modes.setMode('classic').error).toBeUndefined();
    expect(m.board.element.hidden).toBe(true);
    expect(m.modes.setMode('notes').error).toBeUndefined();
    expect(m.board.view()).toBe(view);
    expect(m.board.element.hidden).toBe(false);
    expect(m.board.element.querySelectorAll('[data-board-view]')).toHaveLength(1);
  });

  it('the start screen offers Notes between the maths apps and Classic, labelled and with its purpose', () => {
    mount();
    m.modes.showStart();
    const tile = root.querySelector('.mode-tile[data-mode="notes"]') as HTMLElement;
    expect(tile).not.toBeNull();
    expect(tile.querySelector('.tile-title')?.textContent).toBe('Notes');
    expect(tile.querySelector('.tile-purpose')?.textContent).toBe('write and draw');
    const ids = [...root.querySelectorAll<HTMLElement>('.mode-tile')].map((t) => t.dataset['mode']);
    expect(ids.indexOf('notes')).toBeLessThan(ids.indexOf('classic'));
  });

  it('?mode=notes opens it: the entry point reads the query and mounts the studio in notes', async () => {
    mount();
    const entry = document.createElement('div');
    entry.id = 'app';
    document.body.append(entry);
    window.history.replaceState({}, '', '/?mode=notes');
    try {
      await import('../src/main');
      expect(entry.querySelector('.app')?.getAttribute('data-mode')).toBe('notes');
      expect(entry.querySelector('.board-host [data-board-view]')).not.toBeNull();
    } finally {
      window.history.replaceState({}, '', '/');
      entry.remove();
    }
  });
});
