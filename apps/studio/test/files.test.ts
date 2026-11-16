/** The studio's File menu: open, save, export and share (.kiro/specs/sdk R5.2; embed-files-export ui.md 2 to 5). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHeadlessApp } from '@incantly/sdk';
import type { LoadResult } from '@incantly/sdk';
import { mountStudio } from '../src/studio-page';
import type { Mounted } from '../src/studio-page';

let root: HTMLElement;
let m: Mounted;
let downloads: { name: string; blob: Blob }[];

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
  m = mountStudio(root, { raf: () => 1, caf: () => undefined, storage: null });
  downloads = [];
  let last: Blob | undefined;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    last = b as Blob;
    return 'blob:x';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, blob: last as Blob });
  });
});
afterEach(() => {
  m.dispose();
  root.remove();
  vi.restoreAllMocks();
});

const names = (): string[] => [...m.session.figure.objects()].map((o) => o.name);
const status = (): string => root.querySelector('.status')?.textContent ?? '';

describe('the File menu (ui.md 2)', () => {
  it('sits in the top bar with Open, Save, Save script, Export PNG and SVG, and Share link', () => {
    const btn = root.querySelector('.file-menu-wrap > button') as HTMLButtonElement;
    expect(btn.textContent).toBe('File');
    const items = [...root.querySelectorAll('.file-menu [role="menuitem"] span')].map((x) => x.textContent);
    expect(items).toEqual(['Open…', 'Save', 'Save script', 'Export PNG', 'Export SVG', 'Share link…']);
    const menu = root.querySelector('.file-menu') as HTMLElement;
    expect(menu.hidden).toBe(true);
    btn.click();
    expect(menu.hidden).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.hidden).toBe(true);
  });

  it('saves the figure as a .incantly file with Ctrl+S, in the app\'s mode', async () => {
    m.session.load('A = (1, 2)\nB = (3, 4)');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    expect(downloads.map((d) => d.name)).toEqual(['figure.incantly']);
    const file = JSON.parse(await (downloads[0] as { blob: Blob }).blob.text());
    expect(file).toMatchObject({ format: 'incantly', mode: 'classic' });
    expect(file.script).toContain('A = (1, 2)');
    expect(status()).toBe('Saved the figure as a file.');
  });

  it('saves the script as a .inc file named from the title', async () => {
    m.session.load('@title "Unit circle"\nc = Circle((0, 0), 1)');
    m.files.saveScript();
    expect(downloads.map((d) => d.name)).toEqual(['Unit circle.inc']);
    expect(await (downloads[0] as { blob: Blob }).blob.text()).toMatch(/^# incantly 1 mode=classic\n[\s\S]*c = Circle\(\(0, 0\), 1\)/);
  });
});

describe('opening (ui.md 3)', () => {
  it('opens a saved file in place of the figure', async () => {
    m.session.load('Z = (9, 9)');
    const src = createHeadlessApp({ mode: 'classic', script: 'A = (1, 2)\nB = (3, 4)\ns = Segment(A, B)' });
    const r = (await m.files.open(new Blob([src.saveText()]))) as LoadResult;
    expect(r).toMatchObject({ ok: true, applied: 3 });
    expect(names()).toEqual(['A', 'B', 's']);
    expect(status()).toBe('Opened 3 lines.');
  });

  it('opens a script, says which lines failed, and lists them behind Show', async () => {
    const r = (await m.files.open(new Blob(['A = (1, 2)\nB = Circle(A)\nC = (3, 4)\n']))) as LoadResult;
    expect(r.applied).toBe(2);
    expect(names()).toEqual(['A', 'C']);
    expect(status()).toContain('Opened 2 of 3 lines. 1 could not be used.');
    const show = root.querySelector('.status .link-btn') as HTMLButtonElement;
    expect(show.textContent).toBe('Show');
    show.click();
    const items = root.querySelectorAll('.failed-lines li');
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toMatch(/^Line 2: /);
  });

  it('switches to the mode the file was saved in', async () => {
    const src = createHeadlessApp({ mode: 'geometry', script: 'A = (0, 0)\nB = (3, 4)' });
    await m.files.open(new Blob([src.saveText()]));
    expect(m.modes.mode.id).toBe('geometry');
    expect(names()).toEqual(['A', 'B']);
  });

  it('keeps the figure when nothing in the file can be used', async () => {
    m.session.load('A = (1, 2)');
    const r = await m.files.open(new Blob(['{"format": "incantly", "formatVersion": "x"}']));
    expect(r).toMatchObject({ ok: false });
    expect(names()).toEqual(['A']);
  });
});

describe('sharing (ui.md 5)', () => {
  it('makes a link that opens the same figure in another studio', async () => {
    m.session.load('A = (1, 2)\nB = (3, 4)\nM = Midpoint(A, B)');
    const url = (await m.files.share()) as string;
    expect(url).toMatch(/#f=[A-Za-z0-9_-]+$/);
    const dialog = root.querySelector('dialog.share-dialog') as HTMLDialogElement;
    expect((dialog.querySelector('.share-link') as HTMLInputElement).value).toBe(url);
    expect(dialog.textContent).toContain('Nothing is sent to a server.');

    const other = document.createElement('div');
    document.body.append(other);
    const m2 = mountStudio(other, { raf: () => 1, caf: () => undefined, storage: null });
    try {
      const r = await m2.files.openLink(url);
      expect(r).toMatchObject({ ok: true, applied: 3 });
      expect([...m2.session.figure.objects()].map((o) => o.name)).toEqual(['A', 'B', 'M']);
    } finally {
      m2.dispose();
      other.remove();
    }
  });

  it('does nothing for a page address without a figure', async () => {
    m.session.load('A = (1, 2)');
    expect(await m.files.openLink('http://127.0.0.1:5173/?mode=classic#top')).toBeUndefined();
    expect(names()).toEqual(['A']);
  });
});

describe('export (ui.md 4)', () => {
  it('exports an SVG of what the graph shows, with the list colours', async () => {
    m.session.load('@view -5 5 -5 5\nA = (1, 2)');
    m.graph.paint();
    const r = await m.files.exportPicture('svg');
    if (!r.ok) throw new Error(r.message);
    expect(downloads.map((d) => d.name)).toEqual(['figure.svg']);
    expect(r.width).toBe(Math.round(m.graph.viewport.w));
    expect(r.text).toContain(m.expressions.colorOf([...m.session.figure.objects()][0]?.id as number));
    expect(status()).toMatch(/^Exported SVG, \d+ x \d+ px\./);
  });

  it('leaves out objects hidden with visible = false', async () => {
    m.session.load('A = (1, 2)\nB = (3, 4) with visible = false');
    m.graph.paint();
    const r = await m.files.exportPicture('svg');
    if (!r.ok) throw new Error(r.message);
    expect(r.text).toMatch(/>A<\/text>/);
    expect(r.text).not.toMatch(/>B<\/text>/);
  });
});
