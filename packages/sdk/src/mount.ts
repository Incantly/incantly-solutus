/**
 * `createApp` (embed-files-export design 3.2, ui.md 1 to 5): the headless app with a screen in a container. The
 * screen is the shared graph pane; around it an optional top bar (menu, title, reset, undo and redo), the clock bar
 * and the file dialogs. Every write the screen makes goes through the app, so the page sees the same events.
 */
import { animatingIds, tracedIds } from '@incantly/kernel';
import type { Figure } from '@incantly/kernel';
import { createHeadlessApp } from './app';
import type { App, HeadlessOptions } from './app';
import { apiError, need } from './errors';
import type { ApiError } from './errors';
import type { ExportEnv, ExportOptions, ExportResult } from './export';
import type { IncantlyFile, LoadResult } from './file';
import { mountGraph } from './screen/graph-pane';
import type { GraphPane } from './screen/graph-pane';
import { sceneBounds } from './screen/paint';
import { sceneOf } from './screen/scene';
import { mountSpace } from './screen/space/space-pane';
import type { SpacePane } from './screen/space/space-pane';
import { bytesOf, download, failedList, fileName, openedText, pickFile, shareUrl } from './screen/files';

/** The parts of the screen (design 3.2); defaults depend on the options (ui.md 1). */
export interface UiOptions {
  readonly menu: boolean;
  readonly undoRedo: boolean;
  readonly clockBar: boolean;
  readonly zoomButtons: boolean;
  readonly resetButton: boolean;
  readonly dragPoints: boolean;
  readonly panAndZoom: boolean;
  /** The menu's Open, Save, Export and Share items (ui.md 2: hidden in embeds that turn them off). */
  readonly fileFeatures: boolean;
  readonly borderColor: string | 'none';
  readonly background: string;
}

export interface AppOptions extends Omit<HeadlessOptions, 'size'> {
  readonly container: HTMLElement;
  /** A file to open, or its JSON text; instead of `script`. */
  readonly file?: IncantlyFile | string;
  readonly size?: { readonly width: number | 'fill'; readonly height: number | 'fill' };
  readonly ui?: Partial<UiOptions>;
  /** The page address the share link starts from; the current page by default. */
  readonly shareBase?: string;
}

/** The app with its screen. Everything else is the headless `App`. */
export interface MountedApp extends App {
  /** The frame element in the container. */
  readonly element: HTMLElement;
  readonly ui: UiOptions;
  readonly screen: {
    readonly graph: GraphPane;
    /** The Space view, in the 3D app (.kiro/specs/space-3d R3.3). */
    readonly space?: SpacePane;
    /** Paints now (tests and first paint). */
    paint(): void;
    /** The line under the screen: what the last action said. */
    readonly status: HTMLElement;
  };
  /** Menu actions, also reachable from the page. */
  saveFile(): void;
  saveScript(): void;
  openFile(file?: Blob): Promise<LoadResult | ApiError | undefined>;
  shareLink(): Promise<string | ApiError>;
  exportPicture(format: 'png' | 'svg'): Promise<ExportResult | ApiError>;
}

const STYLE_ID = 'incantly-app-style';
const CSS = `
.inc-app{position:relative;display:flex;flex-direction:column;box-sizing:border-box;border-radius:8px;overflow:hidden;font:14px/1.4 Inter,"Segoe UI",system-ui,-apple-system,sans-serif;color:#1f2430}
.inc-app *{box-sizing:border-box}
.inc-top{display:flex;align-items:center;gap:4px;padding:4px 6px;border-bottom:1px solid #e3e6eb;background:#fafbfc}
.inc-title{flex:1;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.inc-dot{color:#e07b1a;margin-left:4px}
.inc-btn{min-width:32px;height:32px;border:1px solid transparent;border-radius:6px;background:none;cursor:pointer;font:inherit}
.inc-btn:hover,.inc-btn:focus-visible{background:#eef1f5;border-color:#d5d7dd}
.inc-menu{position:absolute;top:42px;left:6px;z-index:5;display:flex;flex-direction:column;min-width:190px;padding:4px;background:#fff;border:1px solid #d5d7dd;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.12)}
.inc-menu[hidden]{display:none}
.inc-menu button{text-align:left;min-height:36px;padding:0 10px;border:0;border-radius:6px;background:none;font:inherit;cursor:pointer}
.inc-menu button:hover,.inc-menu button:focus-visible{background:#eef1f5}
.inc-menu hr{width:100%;border:0;border-top:1px solid #e3e6eb;margin:4px 0}
.inc-app .graph{position:relative;flex:1;min-height:0}
.inc-app .graph[hidden]{display:none}
.inc-app .space-view{position:relative;flex:1;min-height:0}
.inc-app .space-canvas{display:block;width:100%;height:100%;touch-action:none}
.inc-app .graph-canvas{display:block;width:100%;height:100%;touch-action:none}
.inc-app .graph-controls{position:absolute;right:8px;bottom:8px;display:flex;flex-direction:column;gap:4px}
.inc-app .graph-controls[hidden]{display:none}
.inc-app .graph-btn{width:32px;height:32px;border:1px solid #d5d7dd;border-radius:6px;background:#fff;cursor:pointer}
.inc-app .graph-tip{position:absolute;padding:2px 6px;background:#1f2430;color:#fff;border-radius:4px;font-size:12px;pointer-events:none}
.inc-clock{display:flex;align-items:center;gap:8px;padding:4px 8px;border-top:1px solid #e3e6eb;background:#fafbfc}
.inc-clock[hidden]{display:none}
.inc-clock input{flex:1}
.inc-status{position:absolute;left:8px;bottom:8px;margin:0;padding:4px 8px;max-width:70%;background:rgba(31,36,48,.88);color:#fff;border-radius:6px;font-size:13px}
.inc-status:empty{display:none}
.inc-status button{margin-left:8px;color:#9cc2ff;background:none;border:0;cursor:pointer;font:inherit;text-decoration:underline}
.inc-dialog{max-width:min(560px,92vw);border:1px solid #d5d7dd;border-radius:10px;padding:16px}
.inc-dialog h2{margin:0 0 8px;font-size:16px}
.inc-dialog input[type=text]{width:100%;font:13px ui-monospace,monospace;padding:6px}
.inc-dialog .muted{color:#5b6472;font-size:13px}
.inc-dialog .row{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
.failed-lines{padding-left:20px}
.failed-lines code{font-size:12px;color:#5b6472}
.failed-lines .hint{margin:2px 0 6px;color:#5b6472}
`;

function addStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const s = doc.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  doc.head.append(s);
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids);
  return n;
}

function button(label: string, title: string, on: () => void, cls = 'inc-btn'): HTMLButtonElement {
  const b = h('button', { type: 'button', class: cls, title, 'aria-label': title }, label);
  b.addEventListener('click', on);
  return b;
}

function openDialog(d: HTMLDialogElement): void {
  if (typeof d.showModal === 'function') d.showModal();
  else d.setAttribute('open', '');
}

function closeDialog(d: HTMLDialogElement): void {
  if (typeof d.close === 'function') d.close();
  else d.removeAttribute('open');
}

/** True when the figure moves with time: a film range, animated sliders, traces or particles (the clock bar shows). */
export function hasClock(figure: Figure): boolean {
  if (Number.isFinite(figure.clockRange().to)) return true;
  if (tracedIds(figure).length > 0 || animatingIds(figure).length > 0) return true;
  for (const o of figure.objects()) if (o.type === 'Particles' || /\banimate\s*=/.test(o.definition)) return true;
  return false;
}

/** Mounts an app in a container (design 3.2). */
export async function createApp(opts: AppOptions): Promise<MountedApp> {
  need(typeof opts === 'object' && opts !== null, 'createApp', 'options must be an object');
  const container = opts.container as HTMLElement | undefined;
  if (typeof container !== 'object' || container === null || typeof container.append !== 'function') throw new TypeError('createApp: it needs a container element');
  const ui: UiOptions = {
    menu: false,
    undoRedo: opts.readOnly !== true,
    clockBar: true,
    zoomButtons: true,
    resetButton: false,
    dragPoints: opts.readOnly !== true,
    panAndZoom: true,
    fileFeatures: true,
    borderColor: '#D5D7DD',
    background: '#ffffff',
    ...(opts.ui ?? {}),
  };
  const doc = container.ownerDocument;
  addStyle(doc);

  const { container: _c, file, size, ui: _u, shareBase, script, ...headless } = opts;
  void _c;
  void _u;
  // a file wins over a script; it is opened through `load` so its settings, assets and mode come with it
  const core = createHeadlessApp({ ...headless, ...(file === undefined && script !== undefined ? { script } : {}) });
  if (file !== undefined) {
    const r = core.load(file);
    if ('kind' in r && !('applied' in r)) core.reportError(r);
  }
  const start = { script: core.toScript(), file: file !== undefined ? core.saveText() : undefined };
  core.markSaved();

  /* ------------------------------ the frame ------------------------------ */

  const element = h('div', { class: 'inc-app', role: 'application' });
  element.style.border = ui.borderColor === 'none' ? 'none' : `1px solid ${ui.borderColor}`;
  element.style.background = ui.background;
  element.style.width = size && size.width !== 'fill' ? `${size.width}px` : '100%';
  element.style.height = size && size.height !== 'fill' ? `${size.height}px` : '100%';
  const status = h('p', { class: 'inc-status', role: 'status', 'aria-live': 'polite' });
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  const say = (text: string, action?: { label: string; run: () => void }): void => {
    status.replaceChildren(text);
    if (action) status.append(button(action.label, action.label, action.run, ''));
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => status.replaceChildren(), action ? 12000 : 4000);
  };

  // the screen's own window: the figure's `@view` at start and after a script sets it; pans and zooms stay here
  const graph = mountGraph({
    items: () => sceneOf(core.figure, { draggable: (o) => ui.dragPoints && core.draggable(o.name) }),
    bounds: () => {
      const b = sceneBounds(sceneOf(core.figure));
      return b;
    },
    home: () => {
      const v = core.view.get();
      return { x0: v.x0, x1: v.x1, y0: v.y0, y1: v.y1 };
    },
    zoomButtons: ui.zoomButtons,
    panAndZoom: ui.panAndZoom,
    drag: (name, x, y, done) => {
      if (!ui.dragPoints) return;
      const r = core.dragPoint(name, x, y, done);
      if (!r.ok) say(r.message);
      graph.redraw();
    },
  });

  // the 3D app shows the Space view where the graph would be
  const space3: SpacePane | undefined = core.mode === 'graphing3d' ? mountSpace({ figure: () => core.figure }) : undefined;
  if (space3) graph.element.hidden = true;

  /* ------------------------------ top bar and menu ------------------------------ */

  const titleText = h('span', {});
  const dot = h('span', { class: 'inc-dot', 'aria-label': 'Unsaved changes', title: 'Unsaved changes' }, '•');
  const title = h('span', { class: 'inc-title' }, titleText, dot);
  const undoBtn = button('↶', 'Undo', () => core.undo());
  const redoBtn = button('↷', 'Redo', () => core.redo());
  const resetBtn = button('⟲', 'Reset the figure', () => {
    if (start.file !== undefined) core.load(start.file);
    else core.loadScript(start.script);
    core.markSaved();
    graph.fit();
    say('The figure is back at its start.');
  });
  const menu = h('div', { class: 'inc-menu', role: 'menu', 'aria-label': 'Menu' });
  menu.hidden = true;
  const menuBtn = button('☰', 'Menu', () => {
    menu.hidden = !menu.hidden;
    menuBtn.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) (menu.querySelector('button') as HTMLButtonElement | null)?.focus();
  });
  menuBtn.setAttribute('aria-haspopup', 'menu');
  menuBtn.setAttribute('aria-expanded', 'false');
  const item = (label: string, run: () => void): HTMLButtonElement => {
    const b = button(label, label, () => {
      menu.hidden = true;
      menuBtn.setAttribute('aria-expanded', 'false');
      run();
    }, '');
    b.setAttribute('role', 'menuitem');
    return b;
  };
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('button')];
    const i = items.indexOf(doc.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      menu.hidden = true;
      menuBtn.focus();
    } else if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus();
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus();
    else return;
    e.preventDefault();
  });

  const top = h('div', { class: 'inc-top', role: 'toolbar', 'aria-label': 'Figure' });
  if (ui.menu) top.append(menuBtn);
  top.append(title);
  if (ui.resetButton) top.append(resetBtn);
  if (ui.undoRedo) top.append(undoBtn, redoBtn);

  /* ------------------------------ dialogs ------------------------------ */

  const failedDialog = h('dialog', { class: 'inc-dialog', 'aria-label': 'Lines that could not be used' });
  const showFailed = (r: LoadResult): void => {
    failedDialog.replaceChildren(
      h('h2', {}, 'Lines that could not be used'),
      failedList(r.failed),
      h('div', { class: 'row' }, button('Close', 'Close', () => closeDialog(failedDialog), 'inc-btn')),
    );
    openDialog(failedDialog);
  };
  const shareDialog = h('dialog', { class: 'inc-dialog', 'aria-label': 'Share' });
  const tooNewDialog = h('dialog', { class: 'inc-dialog', role: 'alertdialog', 'aria-label': 'File from a newer version' });

  /* ------------------------------ the clock bar ------------------------------ */

  const play = button('▶', 'Play', () => (core.clock.playing ? core.clock.pause() : core.clock.play()));
  const scrub = h('input', { type: 'range', 'aria-label': 'Time', step: 'any', min: '0', max: '10' });
  const readout = h('output', {});
  const clockBar = h('div', { class: 'inc-clock', role: 'group', 'aria-label': 'Clock' }, play, scrub, readout);
  scrub.addEventListener('input', () => core.as('user', () => core.clock.seek(Number(scrub.value))));
  const clockText = (t: number): string => {
    const s = Math.max(0, t);
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  };

  element.append(top, graph.element, ...(space3 ? [space3.element] : []), clockBar, menu, status, failedDialog, shareDialog, tooNewDialog);
  container.append(element);

  /* ------------------------------ keeping the screen up to date ------------------------------ */

  const sync = (): void => {
    if (core.destroyed) return;
    const name = core.figure.directive('title')?.join(' ') ?? core.save().meta.title ?? '';
    titleText.textContent = name;
    element.setAttribute('aria-label', name || 'Figure');
    dot.hidden = core.saved;
    top.hidden = !ui.menu && !ui.undoRedo && !ui.resetButton && name === '';
    clockBar.hidden = !ui.clockBar || !hasClock(core.figure);
    if (!clockBar.hidden) {
      const range = core.figure.clockRange();
      const t = core.clock.t;
      scrub.max = String(Number.isFinite(range.to) ? range.to : Math.max(10, Math.ceil(t)));
      scrub.min = String(range.from);
      scrub.value = String(t);
      readout.textContent = Number.isFinite(range.to) ? `${clockText(t)} / ${clockText(range.to)}` : clockText(t);
      play.textContent = core.clock.playing ? '❚❚' : '▶';
      play.title = core.clock.playing ? 'Pause' : 'Play';
      play.setAttribute('aria-label', play.title);
    }
    graph.redraw();
    space3?.redraw();
  };
  const offs = (['ready', 'loaded', 'modeChanged', 'added', 'removed', 'changed', 'restyled', 'renamed', 'redefined', 'cleared', 'drag', 'dragEnd', 'clockChanged', 'play', 'pause', 'undoPoint', 'undone', 'redone'] as const).map((t) => core.on(t, sync));
  // a script that sets `@view` moves the screen to it; the learner's own pans do not write lines
  offs.push(core.on('viewChanged', () => {
    graph.paint();
    const v = core.view.get();
    graph.viewport.fit({ x0: v.x0, x1: v.x1, y0: v.y0, y1: v.y1 }, 0, false);
    graph.redraw();
  }));
  offs.push(core.on('loaded', () => {
    const v = core.view.get();
    graph.viewport.fit({ x0: v.x0, x1: v.x1, y0: v.y0, y1: v.y1 }, 0, false);
  }));

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    const r = graph.element.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) core.resize(r.width, r.height);
  }) : undefined;
  ro?.observe(graph.element);

  /* ------------------------------ menu actions ------------------------------ */

  const titleOf = (): string | undefined => core.figure.directive('title')?.join(' ') ?? core.save().meta.title;
  const saveFile = (): void => {
    download(new Blob([core.saveText()], { type: 'application/json' }), fileName(titleOf(), 'incantly'));
    core.markSaved();
    sync();
    say('Saved.');
  };
  const saveScript = (): void => {
    download(new Blob([core.toScript()], { type: 'text/plain' }), fileName(titleOf(), 'inc'));
    say('Saved the script.');
  };
  const openFile = async (picked?: Blob): Promise<LoadResult | ApiError | undefined> => {
    const f = picked ?? (await pickFile());
    if (!f) return undefined;
    const r = await core.loadBytes(await bytesOf(f));
    if ('applied' in r) {
      if (r.applied > 0 || r.ok) core.markSaved();
      graph.fit();
      sync();
      if (r.failed.length > 0 && r.applied > 0) say(openedText(r), { label: 'Show', run: () => showFailed(r) });
      else say(openedText(r));
    } else if (r.kind === 'file_too_new') {
      tooNewDialog.replaceChildren(h('h2', {}, 'This file is from a newer version'), h('p', {}, r.message), h('p', { class: 'muted' }, 'The figure is unchanged.'),
        h('div', { class: 'row' }, button('Close', 'Close', () => closeDialog(tooNewDialog), 'inc-btn')));
      openDialog(tooNewDialog);
    } else say(r.message);
    return r;
  };
  const shareLink = async (): Promise<string | ApiError> => {
    const fragment = await core.toFragment();
    const base = shareBase ?? (typeof location === 'object' ? location.href : 'https://incantly.app/');
    const tooBig = fragment.length > 8 * 1024;
    const url = shareUrl(fragment, base);
    const field = h('input', { type: 'text', readonly: '', 'aria-label': 'Link' });
    field.value = tooBig ? '' : url;
    const copy = button('Copy', 'Copy the link', () => {
      void navigator.clipboard?.writeText(url).then(() => say('Link copied.'), () => say('Select the link and copy it.'));
    }, 'inc-btn');
    copy.disabled = tooBig;
    shareDialog.replaceChildren(
      h('h2', {}, 'Share'),
      field,
      h('p', { class: 'muted' }, tooBig ? 'This figure is too large for a link. Save the file and send it instead.' : 'Everything in this link stays in the link. Nothing is sent to a server.'),
      h('div', { class: 'row' }, ...(tooBig ? [button('Download', 'Download the file', saveFile, 'inc-btn')] : [copy]), button('Close', 'Close', () => closeDialog(shareDialog), 'inc-btn')),
    );
    openDialog(shareDialog);
    field.select?.();
    return tooBig ? apiError('file', 'file_too_large', 'The figure is too large for a link.', { hint: 'Save the file instead.', detail: { limitBytes: 8 * 1024 } }) : url;
  };
  // "what I see": the screen's window at the screen's size
  const shotOf = (format: 'png' | 'svg'): ExportOptions => {
    if (space3) {
      const sz = space3.size();
      return format === 'png' ? { format, width: Math.round(sz.w), height: Math.round(sz.h), scale: 2, view: '3d' } : { format, width: Math.round(sz.w), height: Math.round(sz.h), view: '3d' };
    }
    const b = graph.viewport.box();
    const w = Math.round(graph.viewport.w);
    const hgt = Math.round(graph.viewport.h);
    return format === 'png' ? { format, region: b, width: w, height: hgt, scale: 2 } : { format, region: b, width: w, height: hgt };
  };
  const exportPicture = async (format: 'png' | 'svg'): Promise<ExportResult | ApiError> => {
    const r = await core.export(shotOf(format));
    if (r.ok) {
      download(r.blob, fileName(titleOf(), format));
      say(`Exported ${format.toUpperCase()}${r.warnings.length ? `. ${r.warnings.map((w) => w.message).join(' ')}` : '.'}`);
    } else say(r.message);
    return r;
  };

  if (ui.fileFeatures) {
    menu.append(
      item('Open…', () => void openFile()),
      item('Save', saveFile),
      item('Save script', saveScript),
      h('hr', {}),
      item('Export PNG', () => void exportPicture('png')),
      item('Export SVG', () => void exportPicture('svg')),
      item('Share…', () => void shareLink()),
    );
  }
  if (ui.undoRedo) menu.append(...(ui.fileFeatures ? [h('hr', {})] : []), item('Undo', () => core.undo()), item('Redo', () => core.redo()));
  if (menu.childElementCount === 0) menuBtn.hidden = true;

  // keyboard (ui.md 2): Ctrl/Cmd+S save, +O open, +Z undo, +Shift+Z redo
  element.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 's' && ui.fileFeatures) saveFile();
    else if (k === 'o' && ui.fileFeatures) void openFile();
    else if (k === 'z' && ui.undoRedo) {
      if (e.shiftKey) core.redo();
      else core.undo();
    } else return;
    e.preventDefault();
  });
  // a file dropped on the frame opens (ui.md 3)
  if (ui.fileFeatures) {
    element.addEventListener('dragover', (e) => e.preventDefault());
    element.addEventListener('drop', (e) => {
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      e.preventDefault();
      void openFile(f);
    });
  }

  /* ------------------------------ the app ------------------------------ */

  const coreDestroy = core.destroy.bind(core);
  const coreExport = core.export.bind(core);
  const extra = {
    element,
    ui,
    screen: { graph, ...(space3 ? { space: space3 } : {}), paint: () => (space3 ? space3.paint() : graph.paint()), status },
    saveFile,
    saveScript,
    openFile,
    shareLink,
    exportPicture,
    // "view" is what the screen shows, which the learner may have panned
    export: (o: ExportOptions, env?: ExportEnv): Promise<ExportResult | ApiError> => {
      if (typeof o !== 'object' || o === null || (o.format !== 'png' && o.format !== 'svg') || (o.region !== undefined && o.region !== 'view')) return coreExport(o, env);
      if (space3) {
        const sz = space3.size();
        return coreExport({ ...o, width: o.width ?? Math.round(sz.w), height: o.height ?? Math.round(sz.h) }, env);
      }
      const here = { region: graph.viewport.box(), width: o.width ?? Math.round(graph.viewport.w), height: o.height ?? Math.round(graph.viewport.h) };
      return coreExport({ ...o, ...here }, env);
    },
    destroy: (): void => {
      if (core.destroyed) return;
      for (const off of offs) off();
      ro?.disconnect();
      graph.dispose();
      space3?.dispose();
      if (statusTimer) clearTimeout(statusTimer);
      element.remove();
      coreDestroy();
    },
  };
  // the screen's names sit on the core object: none may hide a member of the core other than the two it wraps
  for (const k of Object.keys(extra)) if (k !== 'export' && k !== 'destroy' && k in core) throw new Error(`createApp: ${k} is already a member of the app`);
  const mounted = Object.assign(core, extra) as unknown as MountedApp;

  graph.paint();
  space3?.paint();
  sync();
  return mounted;
}
