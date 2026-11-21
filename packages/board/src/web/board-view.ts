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
import { addImage } from '../core/assets';
import { clipboardText, copySelection, pasteAny, readClipboardText, isBoardClipboard, pasteData } from '../core/clipboard';
import { diffRegions, tileBox } from '../core/draw';
import type { OverlayItems, Tile } from '../core/draw';
import { alignShapes, deleteShapes, distributeShapes, flipShapes, groupShapes, orderShapes, setLocked, styleShapes, ungroupShapes } from '../core/edit';
import type { AlignHow } from '../core/edit';
import type { BoardError, BoardResult } from '../core/errors';
import { ok } from '../core/errors';
import { fixStrokes, strokesToFix } from '../core/fix';
import { shapeGeometry } from '../core/geometry';
import type { InputSink, TouchDraws } from '../core/input';
import { DASHES, FONT_FAMILIES } from '../core/paint';
import type { Dash, FontFamily } from '../core/paint';
import { selectionView } from '../core/selection-view';
import { cssFontFor, setFontMeasure } from '../core/text';
import { SHAPE_TOOLS, createOverlayState, defaultStyles, defaultTools } from '../core/tools/index';
import type { ToolContext, ToolList } from '../core/tools/index';
import { ToolHost } from '../core/tools/host';
import type { StylePatch } from '../core/kinds/def';
import type { Bounds, ShapeRecord } from '../core/types';
import { ImageCache } from './images';
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
  /** Turns the selected strokes, or the newest stroke, into clean shapes (the toolbar's Fix). Returns the new shape ids. */
  fix(): BoardResult<string[]>;
  /** Adds an image from its bytes at the middle of the view (`asset_invalid` when they are not an image). */
  insertImage(bytes: Uint8Array): BoardResult<undefined>;
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
.ib-style{right:12px;top:70px;flex-wrap:wrap;max-width:300px;justify-content:flex-start}
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
.ib-actions{left:50%;top:12px;transform:translateX(-50%);flex-wrap:wrap;justify-content:center;max-width:92%}
.ib-actions[hidden]{display:none}
.ib-actions button{padding:4px 7px;font-size:12px}
.ib-swatch-none{background:linear-gradient(135deg,#fff 45%,#dc2626 45%,#dc2626 55%,#fff 55%)}
.ib-edit{position:absolute;margin:0;padding:4px;border:2px solid #2563eb;border-radius:4px;outline:none;resize:none;overflow:hidden;box-sizing:border-box;background:#fff;color:#1f2430;white-space:pre-wrap;line-height:1.3;z-index:5;transform-origin:center center}
.ib-edit[hidden]{display:none}
.ib-fixed{position:absolute;left:50%;top:60px;transform:translateX(-50%);background:#1f2430;color:#fff;border-radius:8px;padding:6px 12px;font-size:12px;opacity:.92}
.ib-fixed[hidden]{display:none}
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

/** The widths of glyphs from a canvas, for the text and maths layout of the core. */
function installFontMeasure(doc: Document): void {
  const ctx = doc.createElement('canvas').getContext('2d');
  if (ctx === null) return;
  setFontMeasure((text, font, px, family) => {
    ctx.font = cssFontFor(font, family, px);
    const m = ctx.measureText(text);
    if (font === 'text') return { w: m.width, asc: m.fontBoundingBoxAscent > 0 ? m.fontBoundingBoxAscent : px * 0.8, desc: m.fontBoundingBoxDescent > 0 ? m.fontBoundingBoxDescent : px * 0.22 };
    return { w: m.width, asc: Math.max(px * 0.3, m.actualBoundingBoxAscent), desc: Math.max(0, m.actualBoundingBoxDescent) };
  });
}

/** Size steps of the style bar: line widths, and text sizes follow from them. */
const SIZE_STEPS = [['S', 2], ['M', 4], ['L', 8], ['XL', 14]] as const;
const SHAPE_COLORS = ['#1f2430', '#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#7c3aed'] as const;
const FILL_COLORS = ['none', '#fecaca', '#bfdbfe', '#bbf7d0', '#fde68a', '#ddd6fe'] as const;
const FONT_LABELS: Readonly<Record<FontFamily, string>> = { sans: 'Sans', serif: 'Serif', mono: 'Mono', hand: 'Hand' };

/** Mounts a board in `options.container`. Returns `render_failed` only when no drawing at all is possible. */
export function mountBoardView(options: BoardViewOptions): BoardResult<BoardView> {
  const created = options.core !== undefined ? ok(options.core) : BoardCore.create(options.coreOptions ?? {});
  if (!created.ok) return created;
  const core = created.value;
  const editor = core.editor;
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
  installFontMeasure(doc);
  core.index.refresh();
  const images = new ImageCache(core.store, () => {
    painter.tiles.invalidateAll();
    loop.request();
  });
  painter.setImages(images.lookup);

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
    const items: OverlayItems = {
      laser: overlay.laser,
      loop: overlay.loop,
      selection: [],
      cursor: overlay.cursor,
      selected: editor.state === 'closed' ? selectionView(core, camera.zoom) : null,
      guides: overlay.guides,
      marquee: overlay.marquee,
      hint: overlay.hint,
    };
    placeField();
    painter.drawOverlay(items);
    painter.endFrame();
    zoomOut.value = `${Math.round(camera.zoom * 100)}%`;
    root.dataset['backend'] = painter.backend;
    root.dataset['selected'] = String(core.selection.size);
    root.dataset['shapes'] = String(core.store.shapeCount(page));
    root.dataset['tool'] = host.tool;
    root.dataset['editing'] = editor.state;
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
    sample: (s) => {
      pointer = { x: s.x, y: s.y };
      host.sample(s);
    },
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
    if (page !== null) for (const region of diffRegions(diff, page, core.store.kinds)) painter.tiles.invalidate(region);
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
  const stopSelection = core.selection.on(() => {
    renderStyle();
    renderActions();
    loop.request();
  });

  // ---- tool strip and style strip
  const toolButtons = new Map<string, HTMLButtonElement>();
  const shapeToolIds = new Set(SHAPE_TOOLS.map((t) => t.id));
  for (const def of host.tools) {
    // the shape tools sit in a group of their own
    if (def.id === SHAPE_TOOLS[0]?.id) toolBar.append(h('span', { class: 'ib-sep' }));
    const b = h('button', { type: 'button', 'aria-pressed': 'false', title: def.key !== undefined ? `${def.label} (${def.key})` : def.label, 'data-tool': def.id }, def.label);
    b.addEventListener('click', () => host.setTool(def.id));
    toolBar.append(b);
    toolButtons.set(def.id, b);
  }
  // an image comes from a file; Fix turns the newest stroke (or the selected ones) into a clean shape
  const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml', hidden: '', 'aria-label': 'Choose an image' });
  const imageBtn = h('button', { type: 'button', title: 'Add an image (or paste one)', 'data-action': 'image' }, 'Image');
  imageBtn.addEventListener('click', () => fileInput.click());
  const fixBtn = h('button', { type: 'button', title: 'Fix a rough shape: line, circle, polygon or arrow (or hold the pen still for half a second)', 'data-action': 'fix' }, 'Fix');
  const note = h('div', { class: 'ib-fixed', role: 'status', hidden: '' });
  let noteTimer = 0;
  const say = (text: string): void => {
    note.textContent = text;
    note.hidden = false;
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => {
      note.hidden = true;
    }, 2200);
  };
  const viewCentre = (): { x: number; y: number } => {
    const { w, h: height } = sizeOf();
    const p = core.camera?.toPage(w / 2, height / 2);
    return p ?? { x: 0, y: 0 };
  };
  const addImageBytes = (bytes: Uint8Array, at: { x: number; y: number }): BoardResult<undefined> => {
    const added = addImage(core, bytes, { at });
    if (!added.ok) {
      options.onError?.(added);
      say(added.message);
      return added;
    }
    core.selection.set([added.value.id]);
    host.setTool('select');
    loop.request();
    return ok(undefined);
  };
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file === undefined) return;
    void file.arrayBuffer().then((buf) => addImageBytes(new Uint8Array(buf), viewCentre()));
  });
  fixBtn.addEventListener('click', () => {
    const fixed = fixStrokes(core, strokesToFix(core));
    if (fixed.ok && fixed.value.length > 0) core.selection.set(fixed.value);
    else say(fixed.ok ? 'No clean shape fits that stroke.' : fixed.message);
    loop.request();
  });
  root.append(note, fileInput);
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
  toolBar.append(h('span', { class: 'ib-sep' }), imageBtn, fixBtn, h('span', { class: 'ib-sep' }), undoBtn, redoBtn);
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
    } else if (shapeToolIds.has(tool) || (tool === 'select' && core.selection.size > 0)) {
      kids.push(...shapeStyleControls());
    }
    styleBar.replaceChildren(...kids);
    styleBar.hidden = kids.length === 0;
    for (const [id, b] of toolButtons) b.setAttribute('aria-pressed', String(id === tool));
    surface.style.cursor = tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
  };

  /** Colour, fill, dash, size and font: they set what new shapes are made with and change the selected shapes. */
  const shapeStyleControls = (): (Node | string)[] => {
    const st = styles.shape;
    const kids: (Node | string)[] = [];
    const apply = (patch: StylePatch): void => {
      styles.shape = {
        ...styles.shape,
        ...(patch.color !== undefined ? { color: patch.color } : {}),
        ...(patch.fill !== undefined ? { fill: patch.fill } : {}),
        ...(patch.dash !== undefined ? { dash: patch.dash } : {}),
        ...(patch.size !== undefined ? { size: patch.size } : {}),
        ...(patch.font !== undefined ? { font: patch.font } : {}),
      };
      if (host.tool === 'select' && core.selection.size > 0) styleShapes(core, core.selection.ids, patch);
      renderStyle();
      loop.request();
    };
    for (const color of SHAPE_COLORS) {
      const sw = h('button', { type: 'button', class: 'ib-swatch', 'data-style': 'color', 'aria-label': `Colour ${color}`, 'aria-pressed': String(st.color === color), style: `background:${color}` });
      sw.addEventListener('click', () => apply({ color }));
      kids.push(sw);
    }
    kids.push(h('span', { class: 'ib-sep' }));
    for (const fill of FILL_COLORS) {
      const sw = h('button', {
        type: 'button',
        class: fill === 'none' ? 'ib-swatch ib-swatch-none' : 'ib-swatch',
        'data-style': 'fill',
        'aria-label': fill === 'none' ? 'No fill' : `Fill ${fill}`,
        'aria-pressed': String(st.fill === fill),
        ...(fill === 'none' ? {} : { style: `background:${fill}` }),
      });
      sw.addEventListener('click', () => apply({ fill }));
      kids.push(sw);
    }
    kids.push(h('span', { class: 'ib-sep' }));
    const dash = h('select', { 'aria-label': 'Dash', 'data-style': 'dash' });
    for (const d of DASHES) dash.append(h('option', { value: d }, d));
    dash.value = st.dash;
    dash.addEventListener('change', () => apply({ dash: dash.value as Dash }));
    kids.push(dash);
    for (const [label, size] of SIZE_STEPS) {
      const b = h('button', { type: 'button', 'data-style': 'size', title: `Size ${label}`, 'aria-pressed': String(st.size === size) }, label);
      b.addEventListener('click', () => apply({ size }));
      kids.push(b);
    }
    const font = h('select', { 'aria-label': 'Font', 'data-style': 'font' });
    for (const f of FONT_FAMILIES) font.append(h('option', { value: f }, FONT_LABELS[f]));
    font.value = st.font;
    font.addEventListener('change', () => apply({ font: font.value as FontFamily }));
    kids.push(font);
    return kids;
  };
  host.onTool(() => {
    renderStyle();
    loop.request();
  });
  renderStyle();

  // ---- what to do with the selection
  const actionBar = h('div', { class: 'ib-bar ib-actions', 'aria-label': 'Selection' });
  actionBar.hidden = true;
  root.append(actionBar);
  const act = (label: string, title: string, run: () => void): HTMLButtonElement => {
    const b = h('button', { type: 'button', title, 'data-action': label.toLowerCase() }, label);
    b.addEventListener('click', () => {
      run();
      loop.request();
    });
    return b;
  };
  const menu = (label: string, choices: readonly (readonly [string, () => void])[]): HTMLSelectElement => {
    const sel = h('select', { 'aria-label': label, 'data-action': label.toLowerCase() }, h('option', { value: '' }, label));
    choices.forEach(([name], i) => sel.append(h('option', { value: String(i) }, name)));
    sel.addEventListener('change', () => {
      const pick = choices[Number(sel.value)];
      sel.value = '';
      if (pick !== undefined) pick[1]();
      loop.request();
    });
    return sel;
  };
  const ids = (): readonly string[] => core.selection.ids;
  const align = (how: AlignHow): void => void alignShapes(core, ids(), how);
  const renderActions = (): void => {
    actionBar.hidden = core.selection.size === 0 || editor.state !== 'closed';
  };
  actionBar.append(
    act('Duplicate', 'Duplicate (Ctrl+D)', () => {
      const copies = pasteData(core, copySelectionData(), undefined);
      if (copies.ok) core.selection.set(copies.value);
    }),
    act('Group', 'Group (Ctrl+G)', () => {
      const g = groupShapes(core, ids());
      if (g.ok) core.selection.set(g.value);
    }),
    act('Ungroup', 'Ungroup (Ctrl+Shift+G)', () => {
      const g = ungroupShapes(core, ids());
      if (g.ok) core.selection.set(g.value);
    }),
    act('Lock', 'Lock or unlock', () => void setLocked(core, ids())),
    act('Flip H', 'Flip left to right', () => void flipShapes(core, ids(), 'x')),
    act('Flip V', 'Flip top to bottom', () => void flipShapes(core, ids(), 'y')),
    act('Front', 'Bring to front (Ctrl+])', () => void orderShapes(core, ids(), 'front')),
    act('Back', 'Send to back (Ctrl+[)', () => void orderShapes(core, ids(), 'back')),
    menu('Align', [
      ['Left', () => align('left')],
      ['Centre', () => align('centerX')],
      ['Right', () => align('right')],
      ['Top', () => align('top')],
      ['Middle', () => align('middleY')],
      ['Bottom', () => align('bottom')],
    ]),
    menu('Distribute', [
      ['Horizontally', () => void distributeShapes(core, ids(), 'x')],
      ['Vertically', () => void distributeShapes(core, ids(), 'y')],
    ]),
    act('Delete', 'Delete (Delete)', () => {
      const going = [...ids()];
      core.selection.clear();
      deleteShapes(core, going);
    }),
  );
  function copySelectionData(): Parameters<typeof pasteData>[1] {
    const data = copySelection(core, ids());
    return data.ok ? data.value : { shapes: [], bindings: [], assets: [] };
  }

  // ---- typing in a shape: a text field over it, the core keeps the text
  const field = h('textarea', { class: 'ib-edit', 'aria-label': 'Edit text', spellcheck: 'false', rows: '1' });
  field.hidden = true;
  root.append(field);
  const lineCount = (text: string): number => text.split('\n').length;
  function placeField(): void {
    if (editor.state === 'closed') return;
    const camera = core.camera;
    const r = core.store.get(editor.shapeId);
    const shape = r !== undefined && r.id.startsWith('shape:') ? (r as ShapeRecord) : undefined;
    const g = shape === undefined ? undefined : shapeGeometry(shape, core.store.kinds);
    if (camera === undefined || shape === undefined || g === undefined) return;
    const p = shape.props as Record<string, unknown>;
    const zoom = camera.zoom;
    let px: number;
    let family: FontFamily = 'sans';
    let align: string = 'center';
    let bg = '#ffffff';
    let box = g.box;
    let rotate = shape.rotation;
    if (shape.kind === 'text') {
      px = p['size'] as number;
      family = p['font'] as FontFamily;
      align = p['align'] === 'center' ? 'center' : p['align'] === 'end' ? 'right' : 'left';
    } else if (shape.kind === 'sticky') {
      px = p['size'] as number;
      family = p['font'] as FontFamily;
      align = 'left';
      bg = p['color'] as string;
    } else if (shape.kind === 'frame') {
      px = 14;
      box = { minX: 0, minY: -26, maxX: Math.max(160, Math.min(g.box.maxX, 320)), maxY: -2 };
      align = 'left';
      rotate = 0;
    } else {
      px = 18;
      family = (p['font'] as FontFamily | undefined) ?? 'sans';
    }
    const screenPx = px * zoom;
    const centre = g.toPage((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2);
    const bw = Math.max(70, (box.maxX - box.minX) * zoom);
    const bh = Math.max(screenPx * 1.3 + 12, (box.maxY - box.minY) * zoom);
    const st = field.style;
    st.left = `${(centre.x - camera.x) * zoom - bw / 2}px`;
    st.top = `${(centre.y - camera.y) * zoom - bh / 2}px`;
    st.width = `${bw}px`;
    st.height = `${bh}px`;
    st.font = cssFontFor('text', family, screenPx);
    st.lineHeight = '1.3';
    st.textAlign = align;
    st.background = bg;
    st.transform = rotate === 0 ? '' : `rotate(${rotate}rad)`;
    const boxLabel = shape.kind !== 'text' && shape.kind !== 'sticky' && shape.kind !== 'frame';
    st.paddingTop = boxLabel ? `${Math.max(4, (bh - lineCount(field.value) * screenPx * 1.3) / 2)}px` : '4px';
  }
  const openField = (): void => {
    field.value = editor.text;
    field.hidden = false;
    renderActions();
    placeField();
    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
  };
  const closeField = (): void => {
    field.hidden = true;
    renderActions();
    renderStyle();
    surface.focus({ preventScroll: true });
    loop.request();
  };
  const stopEditor = editor.on((open) => (open ? openField() : closeField()));
  field.addEventListener('input', () => {
    editor.set(field.value, field.selectionStart, field.selectionEnd);
    placeField();
  });
  field.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      editor.commit();
    }
  });
  field.addEventListener('compositionstart', () => void editor.compose());
  field.addEventListener('compositionend', () => void editor.endCompose());
  field.addEventListener('blur', () => {
    if (editor.state !== 'closed') editor.commit();
  });

  // ---- the system clipboard: a copy is board JSON with a type tag, so it moves between boards
  let pointer = { x: 0, y: 0 };
  const pasteAt = (): { x: number; y: number } => {
    const p = core.camera?.toPage(pointer.x, pointer.y);
    return p ?? viewCentre();
  };
  const copied = (e: ClipboardEvent, cut: boolean): void => {
    if (editor.state !== 'closed' || e.target === field || core.selection.size === 0) return;
    const data = copySelection(core, core.selection.ids);
    if (!data.ok) return;
    const text = clipboardText(core, data.value);
    if (!text.ok) return;
    e.clipboardData?.setData('text/plain', text.value);
    e.preventDefault();
    if (cut) {
      const going = [...core.selection.ids];
      core.selection.clear();
      deleteShapes(core, going);
    }
    loop.request();
  };
  const onCopy = (e: ClipboardEvent): void => copied(e, false);
  const onCut = (e: ClipboardEvent): void => copied(e, true);
  const onPaste = (e: ClipboardEvent): void => {
    if (editor.state !== 'closed' || e.target === field) return;
    const clip = e.clipboardData;
    if (clip === null) return;
    const picture = Array.from(clip.files).find((f) => f.type.startsWith('image/'));
    e.preventDefault();
    if (picture !== undefined) {
      const at = pasteAt();
      void picture.arrayBuffer().then((buf) => addImageBytes(new Uint8Array(buf), at));
      return;
    }
    const text = clip.getData('text/plain');
    const made = isBoardClipboard(text) ? readClipboardText(core, text) : undefined;
    const pasted = made !== undefined && !made.ok ? made : pasteAny(core, text, pasteAt());
    if (!pasted.ok) {
      options.onError?.(pasted);
      say(pasted.message);
      return;
    }
    if (pasted.value.length > 0) core.selection.set(pasted.value);
    host.setTool('select');
    loop.request();
  };
  root.addEventListener('copy', onCopy);
  root.addEventListener('cut', onCut);
  root.addEventListener('paste', onPaste);

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
    fix: () => {
      const fixed = fixStrokes(core, strokesToFix(core));
      if (fixed.ok && fixed.value.length > 0) core.selection.set(fixed.value);
      loop.request();
      return fixed;
    },
    insertImage: (bytes) => addImageBytes(bytes, viewCentre()),
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
      stopEditor();
      images.dispose();
      window.clearTimeout(noteTimer);
      root.removeEventListener('copy', onCopy);
      root.removeEventListener('cut', onCut);
      root.removeEventListener('paste', onPaste);
      root.removeEventListener('keydown', onKeyEscape);
      painter.dispose();
      root.remove();
    },
  };
  loop.request();
  return ok(api);
}

