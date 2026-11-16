/** createApp on a container, the screen's drag, and its file actions (.kiro/specs/sdk R5; embed-files-export design 3.2, ui.md 1 to 5). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, createHeadlessApp, FORMAT_VERSION } from '../../src/index';
import type { AppEvent, AppOptions, LoadResult, MountedApp, Scheduler } from '../../src/index';
import { fileName, fragmentOf, openedText, shareUrl } from '../../src/screen/index';

// events go out at once, so a test reads them right after the call
const now: Scheduler = { micro: (fn) => fn(), frame: (fn) => fn() };

let container: HTMLElement;
let apps: MountedApp[] = [];
const mount = async (o: Partial<AppOptions> = {}): Promise<MountedApp> => {
  const app = await createApp({ container, mode: 'classic', scheduler: now, ...o });
  apps.push(app);
  return app;
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  apps = [];
});
afterEach(() => {
  for (const a of apps) a.destroy();
  container.remove();
  vi.restoreAllMocks();
});

const shown = (el: Element | null): boolean => el !== null && !(el as HTMLElement).hidden && !(el as HTMLElement).closest('[hidden]');

describe('createApp (design 3.2, ui.md 1)', () => {
  it('mounts one frame in the container, named by the figure title, with the app API on it', async () => {
    const app = await mount({ script: '@title "Quadratics"\nA = (1, 2)' });
    const frame = container.querySelector('.inc-app') as HTMLElement;
    expect(frame).toBe(app.element);
    expect(frame.getAttribute('role')).toBe('application');
    expect(frame.getAttribute('aria-label')).toBe('Quadratics');
    expect(frame.querySelector('.inc-title')?.textContent).toContain('Quadratics');
    expect(frame.querySelector('canvas.graph-canvas')).not.toBeNull();
    expect(app.apiVersion).toBe(1);
    expect(app.value('A')).toEqual({ x: 1, y: 2 });
  });

  it('refuses a missing container with a TypeError', async () => {
    await expect(createApp({} as AppOptions)).rejects.toThrow(TypeError);
    await expect(createApp({ container: 'x' as unknown as HTMLElement })).rejects.toThrow(TypeError);
  });

  it('has a 1 px #D5D7DD border by default, and none with borderColor none', async () => {
    const a = await mount();
    expect(a.element.style.border).toMatch(/1px solid/i);
    const b = await mount({ ui: { borderColor: 'none' } });
    expect(b.element.style.border).toMatch(/none/);
  });

  it('opens a file given as JSON text, with its mode', async () => {
    const src = createHeadlessApp({ mode: 'geometry', script: 'A = (0, 0)\nB = (3, 4)\ns = Segment(A, B)' });
    const app = await mount({ file: src.saveText() });
    expect(app.mode).toBe('geometry');
    expect(app.list().map((o) => o.name)).toEqual(['A', 'B', 's']);
    expect(app.saved).toBe(true);
  });

  it('shows no menu in an embed by default; ui.menu shows it with the file items', async () => {
    const a = await mount();
    expect(a.element.querySelector('button[aria-label="Menu"]')).toBeNull();
    const b = await mount({ ui: { menu: true } });
    const items = [...b.element.querySelectorAll('.inc-menu [role="menuitem"]')].map((x) => x.textContent);
    expect(items).toEqual(['Open…', 'Save', 'Save script', 'Export PNG', 'Export SVG', 'Share…', 'Undo', 'Redo']);
  });

  it('hides the file items with fileFeatures off (ui.md 2)', async () => {
    const app = await mount({ ui: { menu: true, fileFeatures: false } });
    const items = [...app.element.querySelectorAll('.inc-menu [role="menuitem"]')].map((x) => x.textContent);
    expect(items).toEqual(['Undo', 'Redo']);
  });

  it('switches off the zoom buttons, undo and redo, and the reset button by ui', async () => {
    const a = await mount({ ui: { zoomButtons: false, undoRedo: false } });
    expect(shown(a.element.querySelector('.graph-controls'))).toBe(false);
    expect(a.element.querySelector('button[aria-label="Undo"]')).toBeNull();
    const b = await mount({ ui: { resetButton: true } });
    expect(b.element.querySelector('button[aria-label="Reset the figure"]')).not.toBeNull();
    expect(shown(b.element.querySelector('.graph-controls'))).toBe(true);
  });

  it('hides the top bar when it would hold nothing', async () => {
    const app = await mount({ ui: { undoRedo: false } });
    expect(shown(app.element.querySelector('.inc-top'))).toBe(false);
  });

  it('opens the menu with its button, moves with the arrows and closes with Esc', async () => {
    const app = await mount({ ui: { menu: true } });
    const btn = app.element.querySelector('button[aria-label="Menu"]') as HTMLButtonElement;
    const menu = app.element.querySelector('.inc-menu') as HTMLElement;
    expect(menu.hidden).toBe(true);
    btn.click();
    expect(menu.hidden).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement?.textContent).toBe('Save');
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.hidden).toBe(true);
  });

  it('marks unsaved changes with a dot and clears it on save', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
    const app = await mount({ script: 'A = (1, 2)' });
    const dot = app.element.querySelector('.inc-dot') as HTMLElement;
    expect(dot.hidden).toBe(true);
    app.run('B = (3, 4)');
    expect(dot.hidden).toBe(false);
    app.saveFile();
    expect(dot.hidden).toBe(true);
    expect(app.saved).toBe(true);
  });

  it('shows the clock bar only when the figure moves with time', async () => {
    const app = await mount({ script: 'A = (1, 2)' });
    const bar = app.element.querySelector('.inc-clock') as HTMLElement;
    expect(bar.hidden).toBe(true);
    app.clock.setRange(0, 30);
    expect(bar.hidden).toBe(false);
    expect(bar.querySelector('output')?.textContent).toBe('0:00 / 0:30');
    const off = await mount({ script: 'A = (1, 2)', ui: { clockBar: false } });
    off.clock.setRange(0, 30);
    expect((off.element.querySelector('.inc-clock') as HTMLElement).hidden).toBe(true);
  });

  it('undoes with Ctrl+Z and redoes with Ctrl+Shift+Z', async () => {
    const app = await mount({ script: 'A = (1, 2)' });
    app.run('B = (3, 4)');
    app.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    expect(app.exists('B')).toBe(false);
    app.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Z', ctrlKey: true, shiftKey: true, bubbles: true }));
    expect(app.exists('B')).toBe(true);
  });

  it('takes the frame out of the container on destroy', async () => {
    const app = await mount();
    app.destroy();
    expect(container.querySelector('.inc-app')).toBeNull();
    expect(app.destroyed).toBe(true);
  });
});

describe('dragging points (design 3.3: drag events)', () => {
  it('sends dragStart, drag and dragEnd in that order, as the learner, and the drag is one undo step', () => {
    const app = createHeadlessApp({ mode: 'classic', script: 'A = (1, 2)\nB = (3, 2)\nM = Midpoint(A, B)', scheduler: now });
    const seen: string[] = [];
    for (const t of ['dragStart', 'drag', 'dragEnd'] as const) app.on(t, (e: AppEvent) => seen.push(`${e.type}:${e.source}`), { coalesce: 'none' });
    expect(app.dragPoint('A', 1.5, 2, false).ok).toBe(true);
    expect(app.dragPoint('A', 2, 2.5, true).ok).toBe(true);
    expect(seen).toEqual(['dragStart:user', 'drag:user', 'drag:user', 'dragEnd:user']);
    expect(app.value('A')).toEqual({ x: 2, y: 2.5 });
    expect(app.value('M')).toEqual({ x: 2.5, y: 2.25 });
    app.undo();
    expect(app.value('A')).toEqual({ x: 1, y: 2 });
  });

  it('moves a point built from free points through them', () => {
    const app = createHeadlessApp({ mode: 'classic', script: 'A = (1, 2)\nB = (3, 2)\nM = Midpoint(A, B)' });
    expect(app.draggable('M')).toBe(true);
    expect(app.dragPoint('M', 2, 0, true).ok).toBe(true);
    expect(app.value('M')).toEqual({ x: 2, y: 0 });
  });

  it('refuses a point whose rule cannot be worked backwards, a name that does not exist, and a read-only figure', () => {
    const app = createHeadlessApp({ mode: 'classic', script: 'P = Intersect(Line((0, 0), (1, 1)), Line((0, 1), (1, 0)))' });
    expect(app.draggable('P')).toBe(false);
    expect(app.dragPoint('P', 3, 3, true)).toMatchObject({ ok: false, kind: 'not_draggable', detail: { name: 'P' } });
    expect(app.value('P')).toEqual({ x: 0.5, y: 0.5 });
    expect(app.dragPoint('Q', 0, 0, true)).toMatchObject({ ok: false, kind: 'unknown_name' });
    expect(app.dragPoint('P', Number.NaN, 0, true)).toMatchObject({ ok: false, kind: 'bad_argument' });
    const ro = createHeadlessApp({ mode: 'classic', script: 'A = (1, 2)', readOnly: true });
    expect(ro.draggable('A')).toBe(false);
    expect(ro.dragPoint('A', 0, 0, true)).toMatchObject({ ok: false, kind: 'read_only' });
    expect(ro.value('A')).toEqual({ x: 1, y: 2 });
  });

  it('gives the page the last drag place before the drag ends, with coalesced drags', () => {
    const frames: (() => void)[] = [];
    const app = createHeadlessApp({ mode: 'classic', script: 'A = (1, 2)', scheduler: { micro: (fn) => fn(), frame: (fn) => frames.push(fn) } });
    const seen: string[] = [];
    app.on('drag', (e) => seen.push(`drag ${JSON.stringify(e.value)}`));
    app.on('dragEnd', () => seen.push('end'));
    app.dragPoint('A', 2, 2, false);
    app.dragPoint('A', 3, 2, false);
    app.dragPoint('A', 4, 2, true);
    expect(seen).toEqual(['drag {"x":4,"y":2}', 'end']);
  });
});

describe('the screen\'s files (ui.md 3 to 5)', () => {
  const fileOf = (text: string): Blob => new Blob([text], { type: 'application/json' });

  it('opens a picked file and says how many lines it used', async () => {
    const app = await mount();
    const src = createHeadlessApp({ mode: 'classic', script: 'A = (1, 2)\nB = (3, 4)' });
    const r = (await app.openFile(fileOf(src.saveText()))) as LoadResult;
    expect(r).toMatchObject({ ok: true, applied: 2 });
    expect(app.screen.status.textContent).toBe('Opened 2 lines.');
    expect(app.saved).toBe(true);
  });

  it('lists the lines that failed behind Show, with where, what and the hint', async () => {
    const app = await mount();
    const r = (await app.openFile(new Blob(['# incantly 1 mode=classic\nA = (1, 2)\nB = Circle(A)\nC = (3, 4)\n']))) as LoadResult;
    expect(r.applied).toBe(2);
    expect(r.failed).toHaveLength(1);
    expect(app.screen.status.textContent).toContain('Opened 2 of 3 lines. 1 could not be used.');
    const show = [...app.screen.status.querySelectorAll('button')].find((b) => b.textContent === 'Show') as HTMLButtonElement;
    show.click();
    const list = app.element.querySelector('.failed-lines') as HTMLElement;
    expect(list.querySelectorAll('li')).toHaveLength(1);
    expect(list.textContent).toMatch(/^Line \d+: /);
  });

  it('keeps the figure when a file is from a newer format, and says so in a dialog', async () => {
    const app = await mount({ script: 'A = (1, 2)' });
    const f = { ...JSON.parse(createHeadlessApp({ mode: 'classic', script: 'B = (0, 0)' }).saveText()), formatVersion: FORMAT_VERSION + 1 };
    const r = await app.openFile(fileOf(JSON.stringify(f)));
    expect(r).toMatchObject({ ok: false, kind: 'file_too_new' });
    expect(app.list().map((o) => o.name)).toEqual(['A']);
    const d = app.element.querySelector('dialog[aria-label="File from a newer version"]') as HTMLDialogElement;
    expect(d.textContent).toContain('newer version');
  });

  it('downloads the file as <title>.incantly and the script as <title>.inc', async () => {
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      blobs.push(b as Blob);
      return 'blob:x';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    const app = await mount({ script: '@title "Unit circle"\nc = Circle((0, 0), 1)' });
    app.saveFile();
    app.saveScript();
    expect(names).toEqual(['Unit circle.incantly', 'Unit circle.inc']);
    const file = JSON.parse(await (blobs[0] as Blob).text());
    expect(file).toMatchObject({ format: 'incantly', mode: 'classic' });
    expect(await (blobs[1] as Blob).text()).toMatch(/^# incantly 1 mode=classic\n/);
  });

  it('builds a share link that holds the figure and says nothing is sent', async () => {
    const app = await mount({ script: 'A = (1, 2)', shareBase: 'https://example.test/lesson?x=1#old' });
    const url = await app.shareLink();
    expect(typeof url).toBe('string');
    expect(url as string).toMatch(/^https:\/\/example\.test\/lesson\?x=1#f=[A-Za-z0-9_-]+$/);
    const dialog = app.element.querySelector('dialog[aria-label="Share"]') as HTMLDialogElement;
    expect((dialog.querySelector('input') as HTMLInputElement).value).toBe(url);
    expect(dialog.textContent).toContain('Nothing is sent to a server.');
    const other = createHeadlessApp({ mode: 'classic' });
    const r = await other.loadFragment(fragmentOf(url as string) as string);
    expect(r).toMatchObject({ ok: true, applied: 1 });
    expect(other.value('A')).toEqual({ x: 1, y: 2 });
  });

  it('exports what the screen shows: its window and its size', async () => {
    const app = await mount({ script: '@view -5 5 -5 5\nA = (1, 2)' });
    app.screen.paint();
    const vp = app.screen.graph.viewport;
    const r = await app.export({ format: 'svg' });
    if (!r.ok) throw new Error(r.message);
    expect(r.width).toBe(Math.round(vp.w));
    expect(r.height).toBe(Math.round(vp.h));
    // a pan on the screen moves the export with it, and writes no line
    vp.pan(100, 0);
    const before = app.toScript();
    const moved = await app.export({ format: 'svg' });
    if (!moved.ok) throw new Error(moved.message);
    expect(moved.text).not.toBe(r.text);
    expect(app.toScript()).toBe(before);
    // other regions go to the core as they are
    const all = await app.export({ format: 'svg', region: 'all', width: 200, height: 100 });
    expect(all).toMatchObject({ ok: true, width: 200, height: 100 });
  });
});

describe('file helpers', () => {
  it('names files from the title, with figure when there is none', () => {
    expect(fileName('Quadratics: part 1', 'incantly')).toBe('Quadratics part 1.incantly');
    expect(fileName(undefined, 'png')).toBe('figure.png');
    expect(fileName('../../etc', 'svg')).toBe('etc.svg');
  });

  it('words the open toast as ui.md 3 does', () => {
    const base = { ok: true, migrated: false, warnings: [] };
    expect(openedText({ ...base, applied: 41, failed: [] })).toBe('Opened 41 lines.');
    expect(openedText({ ...base, applied: 1, failed: [] })).toBe('Opened 1 line.');
    const failed = [{ message: 'x' }, { message: 'y' }] as unknown as LoadResult['failed'];
    expect(openedText({ ...base, ok: false, applied: 41, failed })).toBe('Opened 41 of 43 lines. 2 could not be used.');
    expect(openedText({ ...base, ok: false, applied: 0, failed })).toBe('Nothing opened: x');
  });

  it('puts the fragment on the page address and reads it back', () => {
    expect(shareUrl('f=abc', 'https://a.test/p#q')).toBe('https://a.test/p#f=abc');
    expect(fragmentOf('https://a.test/p#f=abc')).toBe('f=abc');
    expect(fragmentOf('https://a.test/p#top')).toBeUndefined();
    expect(fragmentOf('https://a.test/p')).toBeUndefined();
  });
});
