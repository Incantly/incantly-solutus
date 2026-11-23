/**
 * The figure node view (design 3): a placeholder until the scheduler orders a mount, then a live figure from
 * `createApp`. It follows the scheduler's orders, applies script changes that come from outside, refreshes the
 * picture when saved, and shows errors in its own box. Nothing here throws out to the editor.
 */
import type { Editor, NodeViewRenderer } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import type { EditorView, NodeView } from '@tiptap/pm/view';
import { createApp } from '@incantly/sdk';
import type { LineResult, MountedApp } from '@incantly/sdk';
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import { FIGURE_DEFAULTS, FULL_WIDTH_PX, HEIGHT_MAX, HEIGHT_MIN, SCRIPT_HEADER, checkAttrs, isPictureUrl } from './attrs';
import type { IncantlyFigureAttrs } from './attrs';
import { CodePanel } from './code-panel';
import { askIncantly } from './ai';
import { tiptapError } from './errors';
import type { TiptapError } from './errors';
import { PICTURE_LIMIT, pictureOf } from './picture';
import { reportError } from './report';
import { runtimeOf } from './runtime';
import type { EditorRuntime } from './runtime';
import type { SchedulerView } from './scheduler';
import { ensureStyles } from './styles';
import { FigureToolbar } from './toolbar';
import type { IncantlyTiptapOptions } from './types';

/** A line of the script that did not apply, with its position in the node's script (1-based). */
export interface LineProblem {
  readonly line: number;
  readonly kind: string;
  readonly message: string;
  readonly hint?: string;
}

const OBJECT_LIST_LIMIT = 60;

/** Lines the header takes at the start of a script. */
export function headerLines(script: string): number {
  const m = SCRIPT_HEADER.exec(script);
  return m ? (m[0].match(/\n/g)?.length ?? 0) : 0;
}

export function createFigureView(editor: Editor, options: IncantlyTiptapOptions): NodeViewRenderer {
  return ({ node, getPos, view }) => new FigureNodeView(editor, options, node, getPos, view);
}

/**
 * The figure's lifecycle (docs/state-machines.md T1). A figure holds a place under the live cap ("claim") while it is
 * `mounting`, `live` or `lost`; it holds an app while it is `live`, `saving` or `lost`.
 *
 * - `idle`: no app, no claim; the placeholder or the saved picture shows.
 * - `mounting`: claimed, the app is being made.
 * - `live`: claimed, with an app.
 * - `saving`: not claimed, the app is still there while its picture is made.
 * - `lost`: claimed, with an app whose drawing context the browser took away.
 * - `dead`: failed twice; a picture until its script or mode changes.
 * - `destroyed`: the node view is gone.
 */
export type FigureLife = 'idle' | 'mounting' | 'live' | 'saving' | 'lost' | 'dead' | 'destroyed';
export type FigureLifeEvent = 'claim' | 'release' | 'mounted' | 'unmounted' | 'lose' | 'regain' | 'giveUp' | 'revive' | 'destroy';

export const FIGURE_MACHINE: MachineTable<FigureLife, FigureLifeEvent> = {
  idle: { claim: 'mounting', release: 'idle', unmounted: 'idle', giveUp: 'dead', destroy: 'destroyed' },
  mounting: { claim: 'mounting', release: 'idle', mounted: 'live', unmounted: 'idle', destroy: 'destroyed' },
  live: { claim: 'live', release: 'saving', unmounted: 'idle', lose: 'lost', destroy: 'destroyed' },
  saving: { claim: 'live', release: 'saving', unmounted: 'idle', destroy: 'destroyed' },
  lost: { claim: 'lost', release: 'saving', unmounted: 'idle', regain: 'live', destroy: 'destroyed' },
  dead: { revive: 'idle', unmounted: 'dead', destroy: 'destroyed' },
  destroyed: {},
};

export class FigureNodeView implements NodeView, SchedulerView {
  readonly dom: HTMLElement;
  readonly box: HTMLElement;
  readonly badge: HTMLButtonElement;
  readonly notice: HTMLElement;
  readonly captionEl: HTMLElement;
  readonly srList: HTMLElement;
  readonly resizeEl: HTMLElement;
  node: PmNode;
  /** The figure's lifecycle; every change goes through `FIGURE_MACHINE`. */
  readonly life = new StateMachine(FIGURE_MACHINE, 'idle', (from, event) =>
    reportError(this.editor, this.options, tiptapError('internal', `The figure machine refused "${event}" in the state "${from}".`, { node: this.figureId, detail: { machine: 'figure', state: from, event } })),
  );

  /** True while the view holds, or is about to hold, a mounted app. */
  get wantsMount(): boolean {
    return this.life.is('mounting', 'live', 'lost');
  }

  private get destroyed(): boolean {
    return this.life.is('destroyed');
  }

  private get dead(): boolean {
    return this.life.is('dead');
  }

  protected readonly runtime: EditorRuntime;
  protected readonly doc: Document;
  private app: MountedApp | undefined;
  private liveHost: HTMLElement | undefined;
  private key: string | undefined;
  private chain: Promise<void> = Promise.resolve();
  private failures = 0;
  private lastFailSeq = -1;
  private orderSeq = 0;
  private saved: { readonly script: string; readonly readerScript: string } | undefined;
  /** The script the live figure reflects. */
  private applied = '';
  /** The script this view just wrote to the node; the update that brings it back is not applied again. */
  private ownCommit: string | undefined;
  private problems: LineProblem[] = [];
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private lastBad = '';
  private offApp: (() => void)[] = [];
  private offDom: (() => void)[] = [];
  private storeId = '';
  /** The elements that belong to the view's own interface (events in them are not the editor's). */
  protected readonly uiRoots: HTMLElement[] = [];
  private panel: CodePanel | undefined;
  private toolbar: FigureToolbar | undefined;
  private selected = false;
  private wasWritable: boolean | undefined;
  private readonly onEditorUpdate = (): void => this.syncWritable();

  constructor(
    protected readonly editor: Editor,
    protected readonly options: IncantlyTiptapOptions,
    node: PmNode,
    protected readonly getPos: () => number | undefined,
    protected readonly view: EditorView,
  ) {
    this.node = node;
    this.doc = view.dom.ownerDocument;
    ensureStyles(this.doc);
    this.runtime = runtimeOf(editor, options);
    this.runtime.views.add(this);
    const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] => {
      const el = this.doc.createElement(tag);
      el.className = cls;
      return el;
    };
    this.dom = h('div', 'inc-tt-figure');
    this.box = h('div', 'inc-tt-box');
    this.box.setAttribute('role', 'figure');
    this.box.tabIndex = 0;
    this.badge = h('button', 'inc-tt-badge');
    this.badge.type = 'button';
    this.badge.hidden = true;
    this.badge.addEventListener('click', () => this.openLines(this.problems[0]?.line));
    this.notice = h('p', 'inc-tt-notice');
    this.notice.setAttribute('role', 'status');
    this.notice.hidden = true;
    this.captionEl = h('div', 'inc-tt-caption');
    this.srList = h('ul', 'inc-tt-sr');
    this.srList.setAttribute('aria-label', 'Objects in the figure');
    this.resizeEl = h('div', 'inc-tt-resize');
    this.resizeEl.setAttribute('role', 'slider');
    this.resizeEl.setAttribute('aria-label', 'Figure height');
    this.resizeEl.setAttribute('aria-valuemin', String(HEIGHT_MIN));
    this.resizeEl.setAttribute('aria-valuemax', String(HEIGHT_MAX));
    this.resizeEl.tabIndex = 0;
    this.dom.append(this.box, this.badge, this.notice, this.captionEl, this.resizeEl, this.srList);
    this.uiRoots.push(this.box, this.badge, this.notice, this.resizeEl);
    this.attachBoxEvents();
    this.attachResize();
    this.render();
    this.syncWritable();
    this.editor.on('update', this.onEditorUpdate);
    this.key = this.runtime.scheduler.register(this);
    // "Ask AI for a figure" in the slash menu: the new figure is selected with its AI box open
    if (this.runtime.askOnNext !== undefined && this.runtime.askOnNext === this.figureId) {
      this.runtime.askOnNext = undefined;
      queueMicrotask(() => {
        if (this.destroyed || !this.writable) return;
        this.selectSelf();
        this.ensureToolbar().show();
        this.toolbar?.toggleAi(true);
      });
    }
  }

  /** What only a writer sees follows the editor's editable state and the extension's `readOnly`. */
  private syncWritable(): void {
    if (this.destroyed) return;
    const w = this.writable;
    if (w === this.wasWritable) return;
    this.wasWritable = w;
    this.dom.classList.toggle('inc-tt-writable', w);
    this.resizeEl.hidden = !w;
    if (!w) {
      this.toolbar?.hide();
      this.panel?.close();
    } else if (this.selected) this.ensureToolbar().show();
    this.showBadge();
    if (this.box.dataset['state'] === 'bad') this.render();
  }

  /* ------------------------------ what the node says ------------------------------ */

  /** The node's attributes if they pass the checks. */
  protected attrs(): IncantlyFigureAttrs | undefined {
    const c = checkAttrs(this.node.attrs);
    return c.ok ? c.value : undefined;
  }

  get figureId(): string {
    const id = this.node.attrs['id'];
    return typeof id === 'string' ? id : '';
  }

  /** True when the writer may change the figure. */
  protected get writable(): boolean {
    return this.options.readOnly !== true && this.editor.isEditable;
  }

  get live(): MountedApp | undefined {
    return this.app;
  }

  get lineProblems(): readonly LineProblem[] {
    return this.problems;
  }

  /** The script of the node, as text ('' when it is not text). */
  protected nodeScript(): string {
    const s = this.node.attrs['script'];
    return typeof s === 'string' ? s : '';
  }

  /* ------------------------------ drawing the box ------------------------------ */

  private render(): void {
    const a = this.node.attrs as Record<string, unknown>;
    const checked = checkAttrs(a);
    const raw = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback);
    const width = checked.ok ? checked.value.width : typeof a['width'] === 'number' ? raw(a['width'], 0) || 'full' : 'full';
    const height = checked.ok ? checked.value.height : raw(a['height'], FIGURE_DEFAULTS.height);
    this.dom.dataset['id'] = this.figureId;
    this.box.style.width = width === 'full' ? '100%' : `${width}px`;
    this.box.style.height = `${height}px`;
    this.resizeEl.setAttribute('aria-valuenow', String(height));
    const caption = typeof a['caption'] === 'string' ? a['caption'] : '';
    this.box.setAttribute('aria-label', caption || 'Incantly figure');
    this.captionEl.textContent = caption;

    if (!checked.ok) {
      // a node that turned bad while live frees its figure and shows the message
      if (this.app) {
        this.life.send('release');
        // good again before the queue runs (an undo): the figure stays as it is
        this.queue(() => {
          if (!this.wantsMount) this.unmountNow();
        });
      }
      this.showBad(checked);
      return;
    }
    const wasBad = this.box.dataset['state'] === 'bad';
    this.lastBad = '';
    if (wasBad) this.box.dataset['state'] = 'placeholder';
    this.syncStore(checked.value);
    if (!this.app) this.showPlaceholder(checked.value);
    else if (this.liveHost) this.box.dataset['state'] = 'live';
    if (wasBad) this.askAgain();
  }

  /**
   * A figure that was bad took no order, but the scheduler may still hold it as live or ready and will send nothing
   * new: ask for the mount it should have now.
   */
  private askAgain(): void {
    if (this.destroyed || this.dead) return;
    const state = this.runtime.scheduler.stateOf(this)?.state;
    if (state === 'live') this.goLive();
    else if (state === 'ready') this.build();
  }

  private syncStore(a: IncantlyFigureAttrs): void {
    if (this.storeId !== '' && this.storeId !== a.id) this.runtime.store.drop(this.storeId);
    this.storeId = a.id;
    this.runtime.store.set(a.id, a.script, a.mode);
  }

  private showBad(error: TiptapError): void {
    this.box.dataset['state'] = 'bad';
    this.box.querySelector('.inc-tt-ph, .inc-tt-ph-text')?.remove();
    for (const old of this.box.querySelectorAll('.inc-tt-bad')) old.remove();
    const text = this.doc.createElement('div');
    text.className = 'inc-tt-bad';
    text.textContent = 'This figure could not be loaded';
    const why = this.doc.createElement('div');
    why.className = 'inc-tt-bad';
    why.textContent = error.message;
    this.box.append(text, why);
    if (this.writable) {
      const b = this.doc.createElement('button');
      b.type = 'button';
      b.className = 'inc-tt-bad';
      b.textContent = 'Edit lines';
      b.addEventListener('click', () => this.openLines());
      this.box.append(b);
    }
    // the placeholder of a bad node never mounts
    const key = `${error.node ?? ''}|${error.message}`;
    if (key !== this.lastBad) {
      this.lastBad = key;
      reportError(this.editor, this.options, error);
    }
  }

  private showPlaceholder(a: IncantlyFigureAttrs): void {
    for (const old of this.box.querySelectorAll('.inc-tt-bad')) old.remove();
    if (this.box.dataset['state'] !== 'saved') this.box.dataset['state'] = 'placeholder';
    let img = this.box.querySelector<HTMLImageElement>('img.inc-tt-ph');
    let text = this.box.querySelector<HTMLElement>('.inc-tt-ph-text');
    if (isPictureUrl(a.picture)) {
      text?.remove();
      if (!img) {
        img = this.doc.createElement('img');
        img.className = 'inc-tt-ph';
        img.draggable = false;
        this.box.prepend(img);
      }
      if (img.getAttribute('src') !== a.picture) img.setAttribute('src', a.picture);
      img.alt = '';
      img.width = typeof a.width === 'number' ? a.width : this.box.clientWidth || FULL_WIDTH_PX;
      img.height = a.height;
    } else {
      img?.remove();
      if (!text) {
        text = this.doc.createElement('div');
        text.className = 'inc-tt-ph-text';
        text.setAttribute('aria-hidden', 'true');
        this.box.prepend(text);
      }
      text.textContent = a.caption;
    }
  }

  /** Shows a short message under the figure; a timed one goes away by itself. */
  protected say(text: string, forMs = 0): void {
    if (this.noticeTimer !== undefined) clearTimeout(this.noticeTimer);
    this.noticeTimer = undefined;
    this.notice.textContent = text;
    this.notice.hidden = text === '';
    if (text !== '' && forMs > 0) {
      this.noticeTimer = setTimeout(() => {
        this.notice.textContent = '';
        this.notice.hidden = true;
      }, forMs);
    }
  }

  private showBadge(): void {
    const n = this.problems.length;
    // the badge opens the code panel, which only a writer has
    this.badge.hidden = n === 0 || this.app === undefined || !this.writable;
    this.badge.textContent = n === 1 ? '1 line has an error' : `${n} lines have errors`;
    this.badge.setAttribute('aria-label', n === 1 ? '1 line has an error. Open the lines.' : `${n} lines have errors. Open the lines.`);
  }

  private refreshObjects(): void {
    const app = this.app;
    if (!app || app.destroyed) {
      this.srList.replaceChildren();
      return;
    }
    try {
      const items = app.list().slice(0, OBJECT_LIST_LIMIT);
      this.srList.replaceChildren(
        ...items.map((o) => {
          const li = this.doc.createElement('li');
          li.textContent = o.summary;
          return li;
        }),
      );
    } catch {
      this.srList.replaceChildren();
    }
  }

  /* ------------------------------ the scheduler's orders ------------------------------ */

  /** Chains work so mounts, saves and applies never overlap. */
  private queue(fn: () => Promise<void> | void): void {
    this.chain = this.chain.then(fn).catch(() => undefined);
  }

  build(): void {
    if (this.destroyed || this.dead || this.failures > 0 || this.app || this.wantsMount) return;
    if (this.attrs() === undefined) return;
    if (!this.runtime.scheduler.hasRoom(this)) return;
    this.life.send('claim');
    this.queue(() => this.doMount());
  }

  goLive(): void {
    if (this.destroyed || this.dead) return;
    const seq = ++this.orderSeq;
    if (this.attrs() === undefined) return;
    if (!this.app && !this.wantsMount) {
      this.runtime.scheduler.makeRoom(this);
      this.life.send('claim');
      this.queue(() => this.doMount(seq));
    } else this.life.send('claim');
  }

  restore(): void {
    this.goLive();
  }

  pause(): void {
    try {
      this.app?.clock.pause();
    } catch {
      // the figure is gone
    }
    if (this.key !== undefined) this.runtime.scheduler.host.setPlaying(this.key, false);
  }

  save(): void {
    if (this.destroyed || !this.wantsMount) return;
    this.life.send('release');
    this.queue(() => this.doSave());
  }

  /* ------------------------------ mount, save, unmount ------------------------------ */

  private async doMount(seq = Number.POSITIVE_INFINITY): Promise<void> {
    if (this.destroyed || this.dead || this.app || !this.wantsMount) return;
    // a figure that failed is tried again only by a live order given after the failure
    if (this.failures > 0 && seq <= this.lastFailSeq) return;
    const first = this.attrs();
    if (!first) {
      this.life.send('release');
      return;
    }
    const host = this.doc.createElement('div');
    host.className = 'inc-tt-live';
    this.box.append(host);
    let app: MountedApp;
    try {
      app = await createApp({
        container: host,
        mode: first.mode,
        size: { width: 'fill', height: first.height },
        // The SDK's `readOnly` also stops a reader dragging a point, which a read-only page must allow (finding TT-1),
        // so it stays off; the extension never writes a reader's change back to the document.
        ui: { menu: false, undoRedo: false, fileFeatures: false, resetButton: false, zoomButtons: false, panAndZoom: true, dragPoints: true, clockBar: true, borderColor: 'none' },
      });
    } catch (e) {
      host.remove();
      this.mountFailed(e);
      return;
    }
    if (this.destroyed || !this.wantsMount) {
      this.safe(() => app.destroy());
      host.remove();
      return;
    }
    const attrs = this.attrs();
    if (!attrs) {
      this.safe(() => app.destroy());
      host.remove();
      this.life.send('release');
      return;
    }
    if (attrs.mode !== first.mode) {
      // the mode changed while the app was being made: start again in the new one
      this.safe(() => app.destroy());
      host.remove();
      this.queue(() => this.doMount(seq));
      return;
    }
    this.app = app;
    this.liveHost = host;
    this.failures = 0;
    this.life.send('mounted');
    try {
      this.loadInto(app, attrs);
      this.followApp(app);
      app.screen.paint();
    } catch (e) {
      this.unmountNow();
      this.mountFailed(e);
      return;
    }
    this.box.dataset['state'] = 'live';
    this.say('');
    this.runtime.store.setLive(attrs.id, app);
    if (this.key !== undefined) {
      this.runtime.scheduler.host.noteMounted(this.key);
      this.runtime.scheduler.host.noteFirstDraw(this.key);
    }
    this.showBadge();
    this.refreshObjects();
    this.onMounted(app);
  }

  /** Puts the figure's lines into a fresh app: the saved reader state if the script is unchanged, else the script. */
  private loadInto(app: MountedApp, attrs: IncantlyFigureAttrs): void {
    let text = attrs.script;
    let fromSaved = false;
    if (this.saved) {
      if (this.saved.script === attrs.script) {
        text = this.saved.readerScript;
        fromSaved = true;
      } else {
        const e = tiptapError('restore_failed', 'The figure was changed while it was saved, so your changes to it were reset.', {
          hint: 'The figure starts from its script again.',
          node: attrs.id,
        });
        reportError(this.editor, this.options, e);
        this.say('Your changes were reset', 6000);
      }
      this.saved = undefined;
    }
    const r = app.loadScript(text);
    this.applied = attrs.script;
    if (!fromSaved) {
      const off = headerLines(attrs.script);
      this.problems = r.failed.map((f) => ({ line: f.line + off, kind: f.kind, message: f.message, ...(f.hint !== undefined ? { hint: f.hint } : {}) }));
    }
  }

  private followApp(app: MountedApp): void {
    const refresh = (): void => this.refreshObjects();
    for (const t of ['loaded', 'added', 'removed', 'redefined', 'renamed', 'cleared'] as const) this.offApp.push(app.on(t, refresh));
    this.offApp.push(
      app.on('play', () => this.key !== undefined && this.runtime.scheduler.host.setPlaying(this.key, true)),
      app.on('pause', () => this.key !== undefined && this.runtime.scheduler.host.setPlaying(this.key, false)),
    );
  }

  /** The app is live: the toolbar offers "Save view as default". */
  protected onMounted(_app: MountedApp): void {
    this.toolbar?.sync();
  }

  protected onUnmounted(): void {
    this.toolbar?.sync();
  }

  private mountFailed(cause: unknown): void {
    this.life.send('release');
    this.failures++;
    this.lastFailSeq = this.orderSeq;
    const why = cause instanceof Error ? cause.message : 'the browser refused';
    const e = tiptapError('mount_failed', `The live figure could not be created: ${why}.`, {
      hint: 'The picture is shown instead. The figure is tried once more the next time it comes into view.',
      node: this.figureId,
    });
    reportError(this.editor, this.options, e);
    this.say('Live figure unavailable');
    if (this.failures >= 2) this.giveUp();
  }

  /** After a second failure the figure stays a picture: it leaves the scheduler, so it takes no more orders. */
  private giveUp(): void {
    this.life.send('giveUp');
    if (this.key !== undefined) {
      this.runtime.scheduler.unregister(this.key, this);
      this.key = undefined;
    }
  }

  private async doSave(): Promise<void> {
    const app = this.app;
    if (!app || this.destroyed || this.wantsMount) return;
    const attrs = this.attrs();
    const readerScript = this.safe(() => app.toScript()) ?? '';
    this.saved = { script: this.applied, readerScript };
    let picture: string | undefined;
    if (attrs) {
      const width = typeof attrs.width === 'number' ? attrs.width : this.box.clientWidth || FULL_WIDTH_PX;
      picture = await pictureOf(app, attrs.mode, width, attrs.height);
    }
    // the figure was wanted again while the picture was made: keep it as it is
    if (this.wantsMount || this.destroyed || this.app !== app) {
      if (this.wantsMount) this.saved = undefined;
      return;
    }
    this.unmountNow();
    this.box.dataset['state'] = 'saved';
    // the mode changed while the picture was made: that picture shows the old mode (TT-R10)
    const now = this.attrs();
    if (attrs && now && now.mode !== attrs.mode) {
      await this.refreshPictureFromScript();
      return;
    }
    // the picture is a cache: writing it is not an undo step
    if (attrs && picture !== undefined && picture.length <= PICTURE_LIMIT && picture !== attrs.picture) this.commitAttrs({ picture }, false);
  }

  /** Frees the live app and shows the placeholder again. */
  private unmountNow(): void {
    const app = this.app;
    for (const off of this.offApp) off();
    this.offApp = [];
    this.app = undefined;
    this.life.send('unmounted');
    this.runtime.store.setLive(this.storeId || this.figureId, undefined);
    this.onUnmounted();
    if (app) this.safe(() => app.destroy());
    this.liveHost?.remove();
    this.liveHost = undefined;
    this.badge.hidden = true;
    this.srList.replaceChildren();
    const a = this.attrs();
    if (a) {
      this.box.dataset['state'] = 'placeholder';
      this.showPlaceholder(a);
    }
  }

  private safe<T>(fn: () => T): T | undefined {
    try {
      return fn();
    } catch {
      return undefined;
    }
  }

  /* ------------------------------ lines from outside, and from the panel ------------------------------ */

  /**
   * Runs lines in the live figure (a new line from the AI, or the lines after what is already there). Returns the
   * results, or `undefined` when the figure is not live.
   */
  runLines(lines: readonly string[]): readonly LineResult[] | undefined {
    const app = this.app;
    if (!app || app.destroyed) return undefined;
    return this.safe(() => app.run(lines));
  }

  /** Replaces the live figure's lines with a script. Returns the lines that failed. */
  loadLines(script: string): readonly LineProblem[] | undefined {
    const app = this.app;
    if (!app || app.destroyed) return undefined;
    const r = this.safe(() => app.loadScript(script));
    if (!r) return undefined;
    const off = headerLines(script);
    const problems = r.failed.map((f) => ({ line: f.line + off, kind: f.kind, message: f.message, ...(f.hint !== undefined ? { hint: f.hint } : {}) }));
    this.problems = problems;
    this.applied = script;
    this.showBadge();
    this.refreshObjects();
    return problems;
  }

  /** Writes a script to the node as one transaction; the update that comes back is not applied again. */
  commitScript(script: string): void {
    this.ownCommit = script;
    this.applied = script;
    this.commitAttrs({ script }, true);
  }

  /** Writes attributes to the node in one transaction, after the current update has finished. */
  commitAttrs(patch: Readonly<Record<string, unknown>>, addToHistory: boolean): void {
    queueMicrotask(() => {
      if (this.destroyed || this.view.isDestroyed) return;
      const pos = this.getPos();
      if (typeof pos !== 'number') return;
      const current = this.view.state.doc.nodeAt(pos);
      if (!current || current.type !== this.node.type) return;
      let tr = this.view.state.tr;
      for (const [k, v] of Object.entries(patch)) tr = tr.setNodeAttribute(pos, k, v);
      if (!addToHistory) tr = tr.setMeta('addToHistory', false);
      try {
        this.view.dispatch(tr);
      } catch {
        // the document moved on; the next change will carry the value
      }
    });
  }

  /* ------------------------------ the writer's interface ------------------------------ */

  /** Opens the code panel under the figure, with the caret at a line when one is given. Writers only. */
  openLines(line?: number): void {
    if (!this.writable || this.destroyed) return;
    this.ensurePanel().open(this.nodeScript(), line);
    this.toolbar?.sync();
  }

  /** Closes the panel and gives the document its focus back, with the figure selected. */
  closeLines(): void {
    this.panel?.close();
    this.toolbar?.sync();
    this.leaveToDocument();
  }

  toggleLines(): void {
    if (this.panel?.isOpen) this.closeLines();
    else this.openLines(this.problems[0]?.line);
  }

  get linesOpen(): boolean {
    return this.panel?.isOpen === true;
  }

  private ensurePanel(): CodePanel {
    if (!this.panel) {
      this.panel = new CodePanel(this, this.doc);
      this.box.after(this.panel.el);
      this.uiRoots.push(this.panel.el);
    }
    return this.panel;
  }

  private ensureToolbar(): FigureToolbar {
    if (!this.toolbar) {
      this.toolbar = new FigureToolbar(this, this.doc);
      this.dom.prepend(this.toolbar.el);
      this.uiRoots.push(this.toolbar.el);
    }
    return this.toolbar;
  }

  /** An attribute of the node as the toolbar shows it. */
  attrOf<T extends string | number>(name: string, fallback: T): T {
    const v = this.node.attrs[name];
    return (typeof v === typeof fallback ? v : fallback) as T;
  }

  currentScript(): string {
    return this.nodeScript();
  }

  currentMode(): IncantlyFigureAttrs['mode'] | undefined {
    return this.attrs()?.mode;
  }

  /** "Save view as default": the figure as it is now becomes its script. */
  saveViewAsDefault(): void {
    const app = this.app;
    if (!app || app.destroyed) return;
    const text = this.safe(() => app.toScript());
    if (text === undefined) return;
    this.commitScript(text);
    this.panel?.showStreamed(text);
  }

  /** Deletes the figure from the document. */
  deleteSelf(): void {
    const pos = this.getPos();
    if (typeof pos !== 'number' || this.view.isDestroyed) return;
    this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize));
    this.view.focus();
  }

  /** Makes the live figure show a script: new lines at the end run alone, any other change loads the whole script. */
  applyScript(script: string): void {
    const old = this.applied;
    this.applied = script;
    const app = this.app;
    if (!app || app.destroyed) return;
    const rest = script.slice(old.length);
    if (old !== '' && script.startsWith(old) && (old.endsWith('\n') || rest.startsWith('\n'))) {
      const lines = rest.replace(/^\n/, '').split('\n');
      const results = this.safe(() => app.run(lines)) ?? [];
      // the first new line is line `base + 1` of the script
      const oldLines = old.split('\n').length;
      const base = old.endsWith('\n') ? oldLines - 1 : oldLines;
      const added: LineProblem[] = [];
      for (const r of results) {
        if (r.ok) continue;
        const at = 'line' in r && typeof r.line === 'number' ? r.line : 1;
        added.push({ line: base + at, kind: r.kind, message: r.message, ...('hint' in r && typeof r.hint === 'string' ? { hint: r.hint } : {}) });
      }
      this.problems = [...this.problems, ...added];
      this.showBadge();
      this.refreshObjects();
    } else this.loadLines(script);
  }

  /** The panel's lines were replaced by an outside change while the writer had typed some. */
  reportConflict(): void {
    const e = tiptapError('collab_conflict', 'Someone else committed this figure first, so their lines are shown.', {
      hint: 'Your lines are kept in the panel: re-apply them or discard them.',
      node: this.figureId,
    });
    reportError(this.editor, this.options, e);
    this.say('Someone else changed this figure first', 8000);
  }

  reportPanelError(e: TiptapError): void {
    reportError(this.editor, this.options, e);
  }

  /** The AI box sends a request; the answer shows under the box, and the lines show in the panel as they arrive. */
  async ask(request: string): Promise<void> {
    const r = await askIncantly(this.editor, this.figureId, request);
    if (!r.ok && r.detail?.['superseded'] !== true) this.aiStatus(r.hint ? `${r.message} ${r.hint}` : r.message, false);
  }

  /** The AI starts: the live figure goes back to the node's script, and the panel opens to show the lines. */
  beginAi(base: string): void {
    if (this.app) this.loadLines(base);
    this.applied = base;
    if (this.writable) this.ensurePanel().open(base);
  }

  /** The AI's lines so far: the figure already has them; the panel shows them. */
  progressAi(script: string): void {
    this.applied = script;
    this.panel?.showStreamed(script);
  }

  /** What the AI box says, and whether it is waiting for an answer. */
  aiStatus(text: string, busy: boolean): void {
    if (!this.writable) return;
    const tb = this.ensureToolbar();
    tb.message(text);
    tb.setBusy(busy);
  }

  /** The AI request ended without a commit: the live figure shows the node's script again. */
  resetToNode(): void {
    const script = this.nodeScript();
    if (this.app && this.applied !== script) this.loadLines(script);
    this.applied = script;
    this.panel?.showStreamed(script);
  }

  /** Adds an element of the view's own interface, so the editor leaves its events alone. */
  registerUi(el: HTMLElement): void {
    this.uiRoots.push(el);
  }

  /* ------------------------------ updates from the editor ------------------------------ */

  update(node: PmNode): boolean {
    if (this.destroyed || node.type !== this.node.type) return false;
    const prev = this.node;
    if (node === prev) return true;
    this.node = node;
    const changed = (k: string): boolean => prev.attrs[k] !== node.attrs[k];
    this.render();
    if (changed('script')) this.scriptChanged(typeof node.attrs['script'] === 'string' ? node.attrs['script'] : '');
    if (changed('mode')) this.modeChanged();
    if (changed('height') || changed('width')) this.resized();
    if (this.dead && (changed('script') || changed('mode'))) this.revive();
    this.toolbar?.sync();
    return true;
  }

  private scriptChanged(script: string): void {
    if (script === this.ownCommit) {
      this.ownCommit = undefined;
      this.applied = script;
      return;
    }
    this.ownCommit = undefined;
    // an outside change wins over lines the writer has typed and not committed (the panel keeps them)
    this.panel?.outsideScript(script);
    this.applyScript(script);
  }

  private modeChanged(): void {
    const app = this.app;
    if (!app) return;
    const a = this.attrs();
    if (!a) return;
    // the 3D app has its own screen: moving into or out of it, and a refused change, start the figure again
    const wasThree = app.mode === 'graphing3d';
    const r = wasThree || a.mode === 'graphing3d' ? undefined : this.safe(() => app.setMode(a.mode));
    if (r?.ok) return;
    this.remount(() => undefined);
  }

  /**
   * Frees the app and makes a new one. The figure keeps its place under the cap while it waits, so no other figure can
   * take the place and the count never passes `liveLimit`. A `save` order that arrives first wins: the figure is
   * freed and stays saved. `reader` gives the state to restore into the new app, if any.
   */
  private remount(reader: () => { readonly script: string; readonly readerScript: string } | undefined): void {
    const app = this.app;
    this.queue(async () => {
      if (this.destroyed || this.dead || !app || this.app !== app) return;
      const wanted = this.wantsMount;
      const state = reader();
      this.saved = state;
      this.unmountNow();
      if (!wanted) {
        this.saved = undefined;
        this.box.dataset['state'] = 'saved';
        // after a mode change the old picture shows the old mode: make one from the script in the new mode (TT-R10)
        if (state === undefined) await this.refreshPictureFromScript();
        return;
      }
      this.life.send('claim');
      await this.doMount();
    });
  }

  /** A picture of the node's script in its mode, from the store's headless figure; written without an undo step. */
  private async refreshPictureFromScript(): Promise<void> {
    const attrs = this.attrs();
    if (!attrs) return;
    const headless = this.runtime.store.appFor(attrs.id);
    if (!headless) return;
    const width = typeof attrs.width === 'number' ? attrs.width : this.box.clientWidth || FULL_WIDTH_PX;
    const picture = await pictureOf(headless, attrs.mode, width, attrs.height);
    // the figure was wanted again, or changed, while the picture was made: the next save makes the picture
    if (this.destroyed || this.wantsMount || this.app) return;
    const now = this.attrs();
    if (!now || now.mode !== attrs.mode || now.script !== attrs.script) return;
    if (picture !== undefined && picture.length <= PICTURE_LIMIT && picture !== now.picture) this.commitAttrs({ picture }, false);
  }

  private resized(): void {
    const a = this.attrs();
    const app = this.app;
    if (!a || !app) return;
    this.safe(() => {
      app.element.style.height = `${a.height}px`;
      app.element.style.width = typeof a.width === 'number' ? `${a.width}px` : '100%';
      app.resize(typeof a.width === 'number' ? a.width : this.box.clientWidth || FULL_WIDTH_PX, a.height);
    });
  }

  /** A figure that gave up gets another chance when its script or mode changes. */
  private revive(): void {
    this.life.send('revive');
    this.failures = 0;
    this.lastFailSeq = -1;
    this.say('');
    this.key = this.runtime.scheduler.register(this);
  }

  /* ------------------------------ the editor's side ------------------------------ */

  private attachBoxEvents(): void {
    const on = <E extends Event>(target: EventTarget, type: string, fn: (e: E) => void, capture = false): void => {
      target.addEventListener(type, fn as EventListener, capture);
      this.offDom.push(() => target.removeEventListener(type, fn as EventListener, capture));
    };
    const touch = (): void => {
      if (this.key !== undefined) this.runtime.scheduler.host.touch(this.key);
    };
    on(this.box, 'pointerdown', touch, true);
    on(this.box, 'focusin', touch);
    // a drag that starts inside the figure moves a point, not the node
    on(this.box, 'mousedown', () => {
      this.suspendNodeDrag();
      if (this.writable) this.selectSelf();
    }, true);
    on<KeyboardEvent>(this.box, 'keydown', (e) => {
      touch();
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        this.leaveToDocument();
      }
    });
    on(this.box, 'webglcontextlost', (e: Event) => this.onContextLost(e), true);
    on(this.box, 'webglcontextrestored', () => this.onContextRestored(), true);
  }

  /** Selects the node, so the toolbar shows. */
  selectSelf(): void {
    const pos = this.getPos();
    if (typeof pos !== 'number' || this.view.isDestroyed) return;
    const sel = this.view.state.selection;
    if (sel instanceof NodeSelection && sel.from === pos) return;
    this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
  }

  /** Escape inside the figure: the document gets focus back, with the figure selected. */
  leaveToDocument(): void {
    this.selectSelf();
    this.view.focus();
  }

  private onContextLost(e: Event): void {
    // the browser may give the context back, and only if the loss is not final
    e.preventDefault();
    this.life.send('lose');
    const error = tiptapError('context_lost', 'The figure lost its drawing context. It shows its picture until the context comes back.', {
      hint: 'Nothing is lost: the figure is rebuilt from its script.',
      node: this.figureId,
    });
    reportError(this.editor, this.options, error);
    this.say('The figure is paused. Rebuilding it…');
    const a = this.attrs();
    if (a && isPictureUrl(a.picture)) this.box.dataset['state'] = 'saved';
  }

  private onContextRestored(): void {
    if (!this.life.is('lost')) return;
    this.life.send('regain');
    const app = this.app;
    if (!app) return;
    // remount from the reader's state, the way a saved figure comes back
    this.remount(() => ({ script: this.applied, readerScript: this.safe(() => app.toScript()) ?? '' }));
  }

  /** True when an event came from the view's own interface, which the editor must leave alone. */
  protected isInsideUi(target: EventTarget | null): boolean {
    if (!(target instanceof Node)) return false;
    return this.uiRoots.some((el) => el.contains(target));
  }

  stopEvent(event: Event): boolean {
    return this.isInsideUi(event.target);
  }

  ignoreMutation(): boolean {
    return true;
  }

  selectNode(): void {
    this.selected = true;
    this.dom.classList.add('inc-tt-selected');
    if (this.writable) this.ensureToolbar().show();
  }

  deselectNode(): void {
    this.selected = false;
    this.dom.classList.remove('inc-tt-selected');
    this.toolbar?.hide();
  }

  /** A drag that starts inside the figure or on its handle is the figure's own, so the node must not be dragged. */
  private suspendNodeDrag(): void {
    this.dom.draggable = false;
    const restore = (): void => {
      this.dom.draggable = true;
      this.doc.removeEventListener('mouseup', restore, true);
    };
    this.doc.addEventListener('mouseup', restore, true);
  }

  /** The bottom edge drags to change the height: live while dragging, one transaction on release. */
  private attachResize(): void {
    const el = this.resizeEl;
    let drag: { y: number; h: number; now: number } | undefined;
    const clamp = (h: number): number => Math.round(Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, h)));
    const current = (): number => this.attrs()?.height ?? FIGURE_DEFAULTS.height;
    el.addEventListener('mousedown', () => this.suspendNodeDrag(), true);
    el.addEventListener('pointerdown', (e) => {
      if (!this.writable) return;
      e.preventDefault();
      drag = { y: e.clientY, h: current(), now: current() };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // no pointer capture: the move events still reach the handle while the pointer is over it
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      drag.now = clamp(drag.h + e.clientY - drag.y);
      this.setHeightNow(drag.now);
    });
    const end = (): void => {
      if (!drag) return;
      const h = drag.now;
      const from = drag.h;
      drag = undefined;
      if (h !== from) this.commitAttrs({ height: h }, true);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', (e) => {
      if (!this.writable) return;
      const step = e.shiftKey ? 100 : 20;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.commitAttrs({ height: clamp(current() + (e.key === 'ArrowDown' ? step : -step)) }, true);
      }
    });
  }

  /** Changes the box and the live figure to a height now, before the node says so. */
  private setHeightNow(h: number): void {
    this.box.style.height = `${h}px`;
    this.resizeEl.setAttribute('aria-valuenow', String(h));
    const app = this.app;
    if (!app) return;
    this.safe(() => {
      app.element.style.height = `${h}px`;
      const a = this.attrs();
      app.resize(typeof a?.width === 'number' ? a.width : this.box.clientWidth || FULL_WIDTH_PX, h);
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.life.send('destroy');
    this.editor.off('update', this.onEditorUpdate);
    this.runtime.views.delete(this);
    this.panel?.dispose();
    this.toolbar?.el.remove();
    if (this.noticeTimer !== undefined) clearTimeout(this.noticeTimer);
    for (const off of this.offDom) off();
    this.offDom = [];
    if (this.key !== undefined) {
      this.runtime.scheduler.unregister(this.key, this);
      this.key = undefined;
    }
    const app = this.app;
    for (const off of this.offApp) off();
    this.offApp = [];
    this.app = undefined;
    this.onUnmounted();
    if (app) this.safe(() => app.destroy());
    this.liveHost?.remove();
    this.runtime.store.drop(this.storeId || this.figureId);
  }
}
