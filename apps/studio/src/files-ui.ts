/**
 * The studio's File menu (embed-files-export ui.md 2, 3 and 5): Open, Save, Save script, Export PNG and SVG, and
 * Share. The SDK does the work on a headless copy of the figure, so the studio and an embedded app write the same
 * files, links and pictures.
 */
import { HEADER, apiError, createHeadlessApp, exportFigure } from '@incantly/sdk';
import type { ApiError, App, ExportResult, LoadResult } from '@incantly/sdk';
import { bytesOf, download, failedList, fileName, fragmentOf, openedText, pickFile, shareUrl } from '@incantly/sdk/screen';
import type { GraphPane } from '@incantly/sdk/screen';
import type { AppModeId } from '@incantly/modes';
import type { KernelSession } from './session';
import type { ExpressionList } from './expressions';

export interface FileMenuOptions {
  readonly session: KernelSession;
  readonly graph: GraphPane;
  readonly expressions: () => ExpressionList | undefined;
  /** The app mode in use, and a switch to a file's mode. */
  readonly mode: () => AppModeId;
  readonly setMode: (mode: AppModeId) => void;
  readonly say: (text: string) => void;
  /** The status line, where Open puts its `Show` button. */
  readonly status: HTMLElement;
  /** The page address the share link starts from; the current page by default. */
  readonly href?: () => string;
}

export interface FileMenu {
  /** The File button and its menu, for the top bar. */
  readonly element: HTMLElement;
  readonly menu: HTMLElement;
  readonly dialogs: readonly HTMLDialogElement[];
  save(): void;
  saveScript(): void;
  open(file?: Blob): Promise<LoadResult | ApiError | undefined>;
  /** Opens a figure from a page address with `#f=…`; nothing happens without one. */
  openLink(href: string): Promise<LoadResult | ApiError | undefined>;
  share(): Promise<string | ApiError>;
  exportPicture(format: 'png' | 'svg'): Promise<ExportResult | ApiError>;
  /** Ctrl/Cmd+S saves, Ctrl/Cmd+O opens; true when the key was one of them. */
  keyDown(e: KeyboardEvent): boolean;
}

const LINK_LIMIT = 8 * 1024;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids);
  return n;
}

function btn(label: string, cls: string, title: string, on: () => void): HTMLButtonElement {
  const b = h('button', { type: 'button', class: cls, title, 'aria-label': title }, label);
  b.addEventListener('click', on);
  return b;
}

const show = (d: HTMLDialogElement): void => (typeof d.showModal === 'function' ? d.showModal() : d.setAttribute('open', ''));
const hide = (d: HTMLDialogElement): void => (typeof d.close === 'function' ? d.close() : d.removeAttribute('open'));

export function mountFileMenu(opts: FileMenuOptions): FileMenu {
  const { session, graph, say } = opts;

  /** The figure as a headless SDK app, sized like the graph. The caller destroys it. */
  const copy = (): App => {
    const vp = graph.viewport;
    return createHeadlessApp({ mode: opts.mode(), script: session.save().replace(HEADER, ''), size: { width: Math.max(1, Math.round(vp.w)), height: Math.max(1, Math.round(vp.h)) } });
  };
  const titleOf = (app: App): string | undefined => app.save().meta.title;

  const save = (): void => {
    const app = copy();
    try {
      download(new Blob([app.saveText()], { type: 'application/json' }), fileName(titleOf(app), 'incantly'));
      say('Saved the figure as a file.');
    } finally {
      app.destroy();
    }
  };
  const saveScript = (): void => {
    const app = copy();
    try {
      download(new Blob([app.toScript()], { type: 'text/plain' }), fileName(titleOf(app), 'inc'));
      say('Saved the script.');
    } finally {
      app.destroy();
    }
  };

  /* ------------------------------ open ------------------------------ */

  const failedDialog = h('dialog', { class: 'script-dialog', 'aria-label': 'Lines that could not be used' });
  const showFailed = (r: LoadResult): void => {
    failedDialog.replaceChildren(
      h('h2', {}, 'Lines that could not be used'),
      h('p', { class: 'muted' }, 'The rest of the file was opened. Each line below changed nothing.'),
      failedList(r.failed),
      h('div', { class: 'dialog-actions' }, btn('Close', 'secondary', 'Close', () => hide(failedDialog))),
    );
    show(failedDialog);
  };
  const tooNew = h('dialog', { class: 'script-dialog', role: 'alertdialog', 'aria-label': 'File from a newer version' });

  /** Puts what a headless app opened into the studio. */
  const take = (app: App, r: LoadResult | ApiError): LoadResult | ApiError => {
    if (!('applied' in r)) {
      if (r.kind === 'file_too_new') {
        tooNew.replaceChildren(h('h2', {}, 'This file is from a newer version'), h('p', {}, r.message), h('p', { class: 'muted' }, 'Your figure is unchanged.'),
          h('div', { class: 'dialog-actions' }, btn('Close', 'secondary', 'Close', () => hide(tooNew))));
        show(tooNew);
      } else say(r.message);
      return r;
    }
    if (!r.ok && r.applied === 0) {
      say(openedText(r));
      return r;
    }
    if (app.mode !== opts.mode()) opts.setMode(app.mode);
    session.load(app.toScript().replace(HEADER, ''));
    graph.fit();
    say(openedText(r));
    if (r.failed.length > 0) opts.status.append(' ', btn('Show', 'link-btn', 'Show the lines that could not be used', () => showFailed(r)));
    return r;
  };
  const open = async (file?: Blob): Promise<LoadResult | ApiError | undefined> => {
    const f = file ?? (await pickFile());
    if (!f) return undefined;
    const app = createHeadlessApp({ mode: opts.mode() });
    try {
      return take(app, await app.loadBytes(await bytesOf(f)));
    } finally {
      app.destroy();
    }
  };
  const openLink = async (href: string): Promise<LoadResult | ApiError | undefined> => {
    const fragment = fragmentOf(href);
    if (!fragment) return undefined;
    const app = createHeadlessApp({ mode: opts.mode() });
    try {
      return take(app, await app.loadFragment(fragment));
    } finally {
      app.destroy();
    }
  };

  /* ------------------------------ share ------------------------------ */

  const shareDialog = h('dialog', { class: 'script-dialog share-dialog', 'aria-label': 'Share' });
  const share = async (): Promise<string | ApiError> => {
    const app = copy();
    let fragment: string;
    try {
      fragment = await app.toFragment();
    } finally {
      app.destroy();
    }
    const tooBig = fragment.length > LINK_LIMIT;
    const url = shareUrl(fragment, opts.href?.() ?? location.href);
    const field = h('input', { type: 'text', class: 'share-link', readonly: '', 'aria-label': 'Link' });
    field.value = tooBig ? '' : url;
    const copyBtn = btn('Copy', 'primary', 'Copy the link', () => {
      void navigator.clipboard?.writeText(url).then(() => say('Link copied.'), () => say('Select the link and copy it.'));
    });
    shareDialog.replaceChildren(
      h('h2', {}, 'Share'),
      h('label', { class: 'muted' }, 'Link'),
      field,
      h('p', { class: 'muted' }, tooBig
        ? `This figure needs ${Math.ceil(fragment.length / 1024)} KB, over the ${LINK_LIMIT / 1024} KB a link can hold. Save the file and send it instead.`
        : 'Everything in this link stays in the link. Nothing is sent to a server.'),
      h('div', { class: 'dialog-actions' }, tooBig ? btn('Save file', 'primary', 'Save the figure as a file', save) : copyBtn, btn('Close', 'secondary', 'Close', () => hide(shareDialog))),
    );
    show(shareDialog);
    field.select?.();
    return tooBig ? apiError('file', 'file_too_large', 'The figure is too large for a link.', { hint: 'Save the file instead.', detail: { limitBytes: LINK_LIMIT } }) : url;
  };

  /* ------------------------------ export ------------------------------ */

  // "what I see": the graph's window at its size, with the list's colours and hidden rows
  const exportPicture = async (format: 'png' | 'svg'): Promise<ExportResult | ApiError> => {
    const app = copy();
    const vp = graph.viewport;
    const ex = opts.expressions();
    try {
      const size = { region: vp.box(), width: Math.round(vp.w), height: Math.round(vp.h) };
      const r = await exportFigure(app, format === 'png' ? { format, ...size, scale: 2 } : { format, ...size }, {
        scene: ex ? { color: (o) => ex.colorOf(o.id as number), hidden: (o) => ex.isHidden(o.id as number) } : {},
      });
      if (r.ok) {
        download(r.blob, fileName(titleOf(app), format));
        say(`Exported ${format.toUpperCase()}, ${r.width} x ${r.height} px.${r.warnings.length ? ` ${r.warnings.map((w) => w.message).join(' ')}` : ''}`);
      } else say(r.message);
      return r;
    } finally {
      app.destroy();
    }
  };

  /* ------------------------------ the menu ------------------------------ */

  const menu = h('div', { class: 'file-menu', role: 'menu', 'aria-label': 'File' });
  menu.hidden = true;
  const button = btn('File', 'tool-btn', 'Open, save, export or share the figure', () => toggle());
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  const toggle = (on = menu.hidden): void => {
    menu.hidden = !on;
    button.setAttribute('aria-expanded', String(on));
    if (on) (menu.querySelector('button') as HTMLButtonElement | null)?.focus();
  };
  const item = (label: string, keys: string, run: () => void): HTMLButtonElement => {
    const b = h('button', { type: 'button', role: 'menuitem' }, h('span', {}, label), h('kbd', {}, keys));
    b.addEventListener('click', () => {
      toggle(false);
      run();
    });
    return b;
  };
  const mod = typeof navigator === 'object' && /Mac|iPhone|iPad/.test(navigator.platform ?? '') ? '⌘' : 'Ctrl+';
  menu.append(
    item('Open…', `${mod}O`, () => void open()),
    item('Save', `${mod}S`, save),
    item('Save script', '.inc', saveScript),
    h('hr', {}),
    item('Export PNG', '2x', () => void exportPicture('png')),
    item('Export SVG', '', () => void exportPicture('svg')),
    h('hr', {}),
    item('Share link…', '', () => void share()),
  );
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      toggle(false);
      button.focus();
    } else if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus();
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus();
    else return;
    e.preventDefault();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !element.contains(e.target as Node)) toggle(false);
  });
  const element = h('div', { class: 'file-menu-wrap' }, button, menu);

  return {
    element,
    menu,
    dialogs: [failedDialog, tooNew, shareDialog],
    save,
    saveScript,
    open,
    openLink,
    share,
    exportPicture,
    keyDown(e) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return false;
      const k = e.key.toLowerCase();
      if (k === 's') save();
      else if (k === 'o') void open();
      else return false;
      return true;
    },
  };
}
