/**
 * The board on a web page (round 2): the painter's canvases, the input layer, the tool host, a frame loop, and a small
 * shell: a tool strip with a style strip, the page bar (switch and add pages) and a zoom bar. Round 4 replaces the shell
 * with the customisable one and puts `createBoard` on top; this file is the part that stays: it wires one `BoardCore`
 * to one `WebPainter` and one `WebInput`. The frame loop (B18) and the page bar (B13) are `*_MACHINE` tables.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import { BoardCore } from '../core/board';
import type { BoardCoreOptions } from '../core/board';
import { diffRegions, tileBox } from '../core/draw';
import type { OverlayItems, Tile } from '../core/draw';
import type { BoardError, BoardResult } from '../core/errors';
import { ok } from '../core/errors';
import { shapeBounds } from '../core/geometry';
import type { InputSink, TouchDraws } from '../core/input';
import { createOverlayState, defaultStyles, defaultTools } from '../core/tools/index';
import type { ToolContext, ToolList } from '../core/tools/index';
import { ToolHost } from '../core/tools/host';
import type { Bounds } from '../core/types';
import { WebInput } from './input';
import { WebPainter } from './painter';
import { TILE_GUTTER } from './painter-2d';

// ---------------------------------------------------------------------------------------------------------------
// B18: the frame loop

type LoopState = 'idle' | 'queued' | 'running' | 'again';
type LoopEvent = 'request' | 'run' | 'done';

export const LOOP_MACHINE: MachineTable<LoopState, LoopEvent> = {
  idle: { request: 'queued' },
  queued: { request: 'queued', run: 'running' },
  running: { request: 'again', done: 'idle' },
  again: { request: 'again', done: 'queued' },
};

/** A frame is asked for from anywhere, runs once on the next animation frame, and one asked for during a frame runs after it. */
class FrameLoop {
  readonly #machine = new StateMachine(LOOP_MACHINE, 'idle');
  readonly #schedule: (cb: (now: number) => void) => number;
  readonly #cancel: (id: number) => void;
  readonly #body: (now: number) => boolean;
  #handle = 0;

  constructor(schedule: (cb: (now: number) => void) => number, cancel: (id: number) => void, body: (now: number) => boolean) {
    this.#schedule = schedule;
    this.#cancel = cancel;
    this.#body = body;
  }

  get state(): LoopState {
    return this.#machine.state;
  }

  request(): void {
    const was = this.#machine.state;
    this.#machine.send('request');
    if (was === 'idle') this.#handle = this.#schedule((now) => this.#run(now));
  }

  /** Runs the body now (a test, or the first frame). */
  runNow(now: number): void {
    if (this.#machine.is('queued')) this.#cancel(this.#handle);
    else if (!this.#machine.is('idle')) return;
    this.#machine.send('request');
    this.#run(now);
  }

  #run(now: number): void {
    if (!this.#machine.send('run')) return;
    let more = false;
    try {
      more = this.#body(now);
    } catch {
      // a frame that failed is dropped; the next request draws again
    }
    const again = this.#machine.is('again');
    this.#machine.send('done');
    if (again || more) {
      if (this.#machine.is('idle')) this.request();
      else this.#handle = this.#schedule((t) => this.#run(t));
    }
  }

  dispose(): void {
    if (this.#machine.is('queued')) this.#cancel(this.#handle);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// B13: the page bar

type PageBarState = 'closed' | 'open';
type PageBarEvent = 'open' | 'close';

export const PAGEBAR_MACHINE: MachineTable<PageBarState, PageBarEvent> = {
  closed: { open: 'open' },
  open: { close: 'closed' },
};

export interface BoardViewOptions {
  readonly container: HTMLElement;
  /** A core to show; default a new board with one page. */
  readonly core?: BoardCore;
  readonly coreOptions?: BoardCoreOptions;
  /** The tools; default `defaultTools`. */
  readonly tools?: ToolList;
  readonly touchDraws?: TouchDraws;
  /** Draw with Canvas 2D only. */
  readonly canvas2dOnly?: boolean;
  /** Called with errors the view can only report (`render_failed`). */
  readonly onError?: (error: BoardError) => void;
}

export interface BoardView {
  readonly core: BoardCore;
  readonly host: ToolHost;
  readonly painter: WebPainter;
  readonly element: HTMLElement;
  /** Draws a frame now. */
  render(now: number): void;
  requestFrame(): void;
  /** Reads the container's size again. */
  resize(): void;
  /** Goes to a page (saving the camera of the one left). */
  goToPage(id: string): BoardResult<undefined>;
  /** Adds a page after the current one and goes to it. */
  addPage(): BoardResult<undefined>;
  dispose(): void;
}

const STYLE_ID = 'incantly-board-view-style';
const CSS = `
.ib-view{position:relative;width:100%;height:100%;min-height:200px;overflow:hidden;background:#fbfbfa;color:#1f2430;font:13px/1.3 system-ui,sans-serif;user-select:none;-webkit-user-select:none}
.ib-surface{position:absolute;inset:0;outline:none;cursor:crosshair}
.ib-bar{position:absolute;display:flex;align-items:center;gap:4px;padding:4px;background:#fff;border:1px solid #d5d7dd;border-radius:10px;box-shadow:0 2px 8px rgba(15,23,42,.12)}
.ib-bar button,.ib-bar select{font:inherit;border:1px solid transparent;border-radius:7px;background:transparent;padding:5px 9px;cursor:pointer;color:inherit}
.ib-bar button:hover{background:#eef0f4}.ib-bar button[aria-pressed=true]{background:#e0e7ff;border-color:#a5b4fc}
.ib-bar button:disabled{opacity:.4;cursor:default}
.ib-tools{left:50%;bottom:14px;transform:translateX(-50%);flex-wrap:wrap;justify-content:center;max-width:94%}
.ib-style{left:50%;bottom:64px;transform:translateX(-50%)}
.ib-style[hidden],.ib-list[hidden]{display:none}
.ib-sep{width:1px;align-self:stretch;background:#d5d7dd;margin:2px 2px}
.ib-swatch{width:22px;height:22px;padding:0!important;border-radius:50%!important;border:2px solid #fff!important;box-shadow:0 0 0 1px #c5c8d0}
.ib-swatch[aria-pressed=true]{box-shadow:0 0 0 2px #4f46e5!important;background-clip:padding-box}
.ib-pages{left:12px;top:12px}
.ib-list{position:absolute;left:0;top:100%;margin-top:6px;min-width:170px;background:#fff;border:1px solid #d5d7dd;border-radius:10px;box-shadow:0 6px 18px rgba(15,23,42,.16);padding:4px;display:flex;flex-direction:column}
.ib-list button{text-align:start}
.ib-zoom{right:12px;bottom:14px}
.ib-zoom output{min-width:46px;text-align:center}
.ib-size{width:90px}
`;

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids);
  return n;
};

const SWATCHES = ['#1f2430', '#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#7c3aed'] as const;
const HIGHLIGHTS = ['#ffd400', '#ff7aa8', '#5eead4', '#a3e635', '#93c5fd'] as const;
const NIB_LABELS = [['pen', 'Pen nib'], ['marker', 'Marker nib'], ['pencil', 'Pencil nib']] as const;
/** At most this many tiles are drawn in one frame; the rest follow on the next ones. */
const TILES_PER_FRAME = 6;

/** Mounts a board in `options.container`. Returns `render_failed` only when no drawing at all is possible. */
export function mountBoardView(options: BoardViewOptions): BoardResult<BoardView> {
  const created = options.core !== undefined ? ok(options.core) : BoardCore.create(options.coreOptions ?? {});
  if (!created.ok) return created;
  const core = created.value;
  const doc = options.container.ownerDocument;
  if (doc.getElementById(STYLE_ID) === null) {
    const style = h('style', { id: STYLE_ID }, CSS);
    doc.head.append(style);
  }

  const painter = new WebPainter({
    ...(options.canvas2dOnly === true ? { canvas2dOnly: true } : {}),
    onNotice: (e) => options.onError?.(e),
    requestFrame: () => loop.request(),
  });
  const overlay = createOverlayState();
  const styles = defaultStyles();
  const list: Tile[] = [];

  const ctx: ToolContext = {
    core,
    styles,
    overlay,
    camera: () => core.camera,
    requestFrame: () => loop.request(),
    strokeEnded: () => painter.releaseLive(),
    strokeDropped: () => painter.abortLive(),
  };
  const host = new ToolHost(ctx, options.tools ?? defaultTools, 'pen');

  // ---- DOM
  const root = h('div', { class: 'ib-view', 'data-board-view': '' });
  const surface = h('div', { class: 'ib-surface', role: 'application', 'aria-label': 'Board', tabindex: '0' });
  surface.append(painter.element);
  const toolBar = h('div', { class: 'ib-bar ib-tools', role: 'toolbar', 'aria-label': 'Tools' });
  const styleBar = h('div', { class: 'ib-bar ib-style', 'aria-label': 'Style' });
  const pageBar = h('div', { class: 'ib-bar ib-pages', 'aria-label': 'Pages' });
  const zoomBar = h('div', { class: 'ib-bar ib-zoom', 'aria-label': 'Zoom' });
  root.append(surface, styleBar, toolBar, pageBar, zoomBar);
  options.container.append(root);

  // ---- the frame
  const sizeOf = (): { w: number; h: number } => ({ w: surface.clientWidth, h: surface.clientHeight });
  const render = (now: number): boolean => {
    const camera = core.camera;
    const page = core.pages.current;
    if (camera === undefined || page === null) return false;
    const { w, h: height } = sizeOf();
    if (w < 1 || height < 1) return false;
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    painter.resize(w, height, dpr);
    let more = host.tick(now);
    camera.tick(now);
    if (camera.motion === 'zooming') more = true;
    painter.tiles.beginFrame();
    painter.tiles.visible(camera, w, height, dpr, list);
    // the tiles nearest the middle first, so a busy page fills in from where the eyes are
    const cx = camera.x + w / camera.zoom / 2;
    const cy = camera.y + height / camera.zoom / 2;
    list.sort((a, b) => Math.hypot(a.box.minX - cx, a.box.minY - cy) - Math.hypot(b.box.minX - cx, b.box.minY - cy));
    const began = painter.beginFrame(camera, dpr);
    if (!began.ok) return true;
    let drawn = 0;
    let waiting = 0;
    for (const tile of list) {
      if (tile.needsDraw && drawn < TILES_PER_FRAME) {
        const scale = Math.pow(2, tile.k);
        const box = tileBox(tile.k, tile.tx, tile.ty);
        const grow = TILE_GUTTER / scale;
        const region: Bounds = { minX: box.minX - grow, minY: box.minY - grow, maxX: box.maxX + grow, maxY: box.maxY + grow };
        painter.drawTile(tile, { box: region, items: core.drawList.itemsIn(region, scale) });
        drawn++;
      } else {
        if (tile.needsDraw) waiting++;
        painter.drawTile(tile, null);
      }
    }
    if (waiting > 0) more = true;
    const live = core.live;
    if (live.state === 'drawing') {
      live.rebuild(camera.zoom * dpr);
      painter.drawLiveStroke(live.view());
    } else {
      painter.drawLiveStroke(null);
    }
    if (waiting === 0) painter.settleLive();
    const selected: Bounds[] = [];
    for (const id of core.selection.ids) {
      const s = core.index.shape(id);
      const b = s === undefined ? undefined : shapeBounds(s);
      if (b !== undefined) selected.push(b);
    }
    const items: OverlayItems = { laser: overlay.laser, loop: overlay.loop, selection: selected, cursor: overlay.cursor };
    painter.drawOverlay(items);
    painter.endFrame();
    zoomOut.value = `${Math.round(camera.zoom * 100)}%`;
    root.dataset['backend'] = painter.backend;
    root.dataset['tiles'] = String(painter.tiles.size);
    return more;
  };
  const loop = new FrameLoop(
    (cb) => window.requestAnimationFrame(cb),
    (id) => window.cancelAnimationFrame(id),
    render,
  );

  // ---- input
  const sink: InputSink = {
    sample: (s) => host.sample(s),
    key: (k) => {
      if (host.key(k)) loop.request();
    },
    wheel: (w) => host.wheel(w),
    gesture: (g) => host.gesture(g),
  };
  const input = new WebInput({ element: surface, sink, ...(options.touchDraws !== undefined ? { touchDraws: options.touchDraws } : {}) });

  // ---- store and pages
  const stopStore = core.store.on((diff) => {
    const page = core.pages.current;
    if (page !== null) for (const region of diffRegions(diff, page)) painter.tiles.invalidate(region);
    loop.request();
  });
  let lastPage = core.pages.current;
  const saveCamera = (page: string | null): void => {
    if (page !== null && core.pages.get(page) !== undefined) core.cameras.save(page);
  };
  const stopPages = core.pages.onCurrent((page) => {
    saveCamera(lastPage);
    lastPage = page;
    host.cancel();
    painter.abortLive();
    painter.tiles.clear();
    core.selection.clear();
    overlay.laser = null;
    overlay.loop = null;
    pageName.textContent = `${core.pages.get(page ?? '')?.name ?? 'Page'} ▾`;
    pageList.hidden = true;
    pagesState.send('close');
    loop.request();
  });
  const stopSelection = core.selection.on(() => loop.request());

  // ---- tool strip and style strip
  const toolButtons = new Map<string, HTMLButtonElement>();
  for (const def of host.tools) {
    const b = h('button', { type: 'button', 'aria-pressed': 'false', title: def.key !== undefined ? `${def.label} (${def.key})` : def.label, 'data-tool': def.id }, def.label);
    b.addEventListener('click', () => host.setTool(def.id));
    toolBar.append(b);
    toolButtons.set(def.id, b);
  }
  const undoBtn = h('button', { type: 'button', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo' }, '↶');
  const redoBtn = h('button', { type: 'button', title: 'Redo (Ctrl+Shift+Z)', 'aria-label': 'Redo' }, '↷');
  undoBtn.addEventListener('click', () => {
    core.history.undo();
    loop.request();
  });
  redoBtn.addEventListener('click', () => {
    core.history.redo();
    loop.request();
  });
  toolBar.append(h('span', { class: 'ib-sep' }), undoBtn, redoBtn);
  const syncHistory = (): void => {
    undoBtn.disabled = !core.history.canUndo;
    redoBtn.disabled = !core.history.canRedo;
  };
  const stopHistory = core.history.on(syncHistory);
  syncHistory();

  const renderStyle = (): void => {
    const tool = host.tool;
    const kids: (Node | string)[] = [];
    if (tool === 'pen' || tool === 'highlighter') {
      const which = tool;
      const st = styles[which];
      if (tool === 'pen') {
        const nib = h('select', { 'aria-label': 'Nib' });
        for (const [id, label] of NIB_LABELS) nib.append(h('option', { value: id }, label));
        nib.value = st.nib;
        nib.addEventListener('change', () => {
          styles.pen = { ...styles.pen, nib: nib.value as typeof st.nib };
        });
        kids.push(nib);
      }
      for (const color of tool === 'pen' ? SWATCHES : HIGHLIGHTS) {
        const sw = h('button', { type: 'button', class: 'ib-swatch', 'aria-label': `Colour ${color}`, 'aria-pressed': String(st.color === color), style: `background:${color}` });
        sw.addEventListener('click', () => {
          styles[which] = { ...styles[which], color };
          renderStyle();
        });
        kids.push(sw);
      }
      const size = h('input', { class: 'ib-size', type: 'range', min: '1', max: tool === 'pen' ? '24' : '48', step: '1', value: String(st.size), 'aria-label': 'Size' });
      size.addEventListener('input', () => {
        styles[which] = { ...styles[which], size: Number(size.value) };
      });
      kids.push(size);
    } else if (tool === 'eraser') {
      for (const [mode, label] of [['whole', 'Whole stroke'], ['partial', 'Partial']] as const) {
        const b = h('button', { type: 'button', 'aria-pressed': String(styles.eraser.mode === mode) }, label);
        b.addEventListener('click', () => {
          styles.eraser.mode = mode;
          renderStyle();
        });
        kids.push(b);
      }
      const size = h('input', { class: 'ib-size', type: 'range', min: '4', max: '40', step: '1', value: String(styles.eraser.radius), 'aria-label': 'Eraser size' });
      size.addEventListener('input', () => {
        styles.eraser.radius = Number(size.value);
      });
      kids.push(size);
    }
    styleBar.replaceChildren(...kids);
    styleBar.hidden = kids.length === 0;
    for (const [id, b] of toolButtons) b.setAttribute('aria-pressed', String(id === tool));
    surface.style.cursor = tool === 'hand' ? 'grab' : 'crosshair';
  };
  host.onTool(() => {
    renderStyle();
    loop.request();
  });
  renderStyle();

  // ---- page bar
  const pagesState = new StateMachine(PAGEBAR_MACHINE, 'closed');
  const pageName = h('button', { type: 'button', 'aria-haspopup': 'listbox', 'aria-label': 'Pages' }, `${core.pages.get(core.pages.current ?? '')?.name ?? 'Page'} ▾`);
  const addBtn = h('button', { type: 'button', title: 'Add a page', 'aria-label': 'Add a page' }, '+');
  const pageList = h('div', { class: 'ib-list', role: 'listbox', 'aria-label': 'Pages' });
  pageList.hidden = true;
  const fillList = (): void => {
    pageList.replaceChildren(
      ...core.pages.list().map((p) => {
        const b = h('button', { type: 'button', role: 'option', 'aria-selected': String(p.id === core.pages.current), 'data-page': p.id }, p.name);
        b.addEventListener('click', () => api.goToPage(p.id));
        return b;
      }),
    );
  };
  pageName.addEventListener('click', () => {
    if (pagesState.state === 'closed' && pagesState.send('open')) {
      fillList();
      pageList.hidden = false;
    } else if (pagesState.send('close')) {
      pageList.hidden = true;
    }
  });
  addBtn.addEventListener('click', () => api.addPage());
  pageBar.append(pageName, addBtn, pageList);
  const onKeyEscape = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && pagesState.send('close')) pageList.hidden = true;
  };
  root.addEventListener('keydown', onKeyEscape);

  // ---- zoom bar
  const zoomOut = h('output', { 'aria-label': 'Zoom' }, '100%');
  const zoomBy = (factor: number): void => {
    const { w, h: height } = sizeOf();
    core.camera?.zoomBy(factor, w / 2, height / 2, performance.now());
    loop.request();
  };
  const minus = h('button', { type: 'button', title: 'Zoom out', 'aria-label': 'Zoom out' }, '−');
  const plus = h('button', { type: 'button', title: 'Zoom in', 'aria-label': 'Zoom in' }, '+');
  const reset = h('button', { type: 'button', title: 'Zoom to 100%', 'aria-label': 'Zoom to 100%' }, '1:1');
  minus.addEventListener('click', () => zoomBy(1 / 1.25));
  plus.addEventListener('click', () => zoomBy(1.25));
  reset.addEventListener('click', () => {
    const camera = core.camera;
    if (camera === undefined) return;
    const { w, h: height } = sizeOf();
    camera.zoomAbout(1, w / 2, height / 2, performance.now());
    loop.request();
  });
  zoomBar.append(minus, zoomOut, plus, reset);

  // ---- resizing
  let observer: ResizeObserver | undefined;
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => {
      input.measure();
      loop.request();
    });
    observer.observe(surface);
  }

  const api: BoardView = {
    core,
    host,
    painter,
    element: root,
    render: (now) => {
      loop.runNow(now);
    },
    requestFrame: () => loop.request(),
    resize: () => {
      input.measure();
      loop.request();
    },
    goToPage: (id) => {
      const moved = core.pages.goToPage(id);
      return moved.ok ? ok(undefined) : moved;
    },
    addPage: () => {
      const made = core.pages.addPage({ ...(core.pages.current !== null ? { after: core.pages.current } : {}) });
      if (!made.ok) return made;
      return api.goToPage(made.value.id);
    },
    dispose: () => {
      saveCamera(core.pages.current);
      loop.dispose();
      observer?.disconnect();
      input.dispose();
      stopStore();
      stopPages();
      stopSelection();
      stopHistory();
      root.removeEventListener('keydown', onKeyEscape);
      painter.dispose();
      root.remove();
    },
  };
  loop.request();
  return ok(api);
}

