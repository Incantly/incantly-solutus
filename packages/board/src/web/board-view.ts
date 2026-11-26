/**
 * The board on a web page (round 2): the painter's canvases, the input layer, the tool host, a frame loop, and a small
 * shell: a tool strip with a style strip, the page bar (switch and add pages) and a zoom bar. Round 4 replaces the shell
 * with the customisable one and puts `createBoard` on top; this file is the part that stays: it wires one `BoardCore`
 * to one `WebPainter` and one `WebInput`. The frame loop (B18) and the page bar (B13) are `*_MACHINE` tables.
 */
import { StateMachine } from '@incantly/kernel';
import { sendIfAble } from '../core/machine';
import type { MachineTable } from '@incantly/kernel';
import { BoardCore } from '../core/board';
import { Camera } from '../core/camera';
import type { BoardCoreOptions } from '../core/board';
import { addImage } from '../core/assets';
import { clipboardText, copySelection, pasteAny, readClipboardText, isBoardClipboard, pasteData } from '../core/clipboard';
import { diffRegions, tileBox, tileSpan } from '../core/draw';
import type { DrawItem, OverlayItems, Tile, TileContent } from '../core/draw';
import { alignShapes, deleteShapes, distributeShapes, flipShapes, groupShapes, orderShapes, setLocked, styleShapes, ungroupShapes } from '../core/edit';
import type { AlignHow } from '../core/edit';
import type { BoardError, BoardResult } from '../core/errors';
import { boardError, ok, refusedMove } from '../core/errors';
import { fixStrokes, strokesToFix } from '../core/fix';
import { shapeBounds, shapeGeometry, unionBounds } from '../core/geometry';
import type { InputSink, TouchDraws } from '../core/input';
import { DASHES, FONT_FAMILIES } from '../core/paint';
import type { Dash, FontFamily } from '../core/paint';
import { selectionView } from '../core/selection-view';
import { cssFontFor, setFontMeasure } from '../core/text';
import { SHAPE_TOOLS, createOverlayState, defaultStyles, defaultTools, editAction } from '../core/tools/index';
import type { ToolContext, ToolDef, ToolList } from '../core/tools/index';
import { ToolHost } from '../core/tools/host';
import type { StylePatch } from '../core/kinds/def';
import type { Bounds, ShapeRecord } from '../core/types';
import { isShape } from '../core/types';
import { ImageCache } from './images';
import { WebInput } from './input';
import { warmInk } from './warm-ink';

/** How long after the board opens the pen's code is warmed (BR-77): after the first frames, before a hand reaches the pen. */
const WARM_AFTER_MS = 400;
import { WebPainter } from './painter';
import type { OverCardItem } from './painter';
import { TILE_GUTTER } from './painter-2d';
import { FigureLayer, overCardItems } from './figures';
import { createAgentKit, pictureOf } from './agent';
import type { AgentKit, AgentOption } from './agent';
import { AgentPanel } from './ui/agent-panel';
import { CircleMenu } from './ui/circle-menu';
import { defaultIcon } from './ui/icons';
import { MenuHost } from './ui/menus';
import type { MenuItem, MenuTarget } from './ui/menus';
import { FIGURE_ACTIONS, MORE_SHAPES, resolveShell, toolsFor } from './ui/shell';
import type { Shell, ShellOptions } from './ui/shell';
import { CSS, STYLE_ID } from './ui/styles';
import { describeKey } from '../core/keymap';
import { addFigure } from '../core/figures';
import { pickShape } from '../core/pick';
import { selectionFor } from '../core/shapes';
import { saveBoard } from '../core/file';
import type { PageBackground } from '../core/types';
import { PAGE_BACKGROUNDS } from '../core/types';

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
  readonly #machine: StateMachine<LoopState, LoopEvent>;
  readonly #schedule: (cb: (now: number) => void) => number;
  readonly #cancel: (id: number) => void;
  readonly #body: (now: number) => boolean;
  #handle = 0;
  /** The callback handed to every animation frame request: made once, so a frame makes no closure. */
  readonly #tick = (now: number): void => this.#run(now);

  constructor(schedule: (cb: (now: number) => void) => number, cancel: (id: number) => void, body: (now: number) => boolean, report?: (error: BoardError) => void) {
    this.#machine = new StateMachine(LOOP_MACHINE, 'idle', refusedMove('frame loop', () => report));
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
    if (was === 'idle') this.#handle = this.#schedule(this.#tick);
  }

  /** Runs the body now (a test, or the first frame). */
  runNow(now: number): void {
    if (this.#machine.state === 'queued') this.#cancel(this.#handle);
    else if (this.#machine.state !== 'idle') return;
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
    const again = this.#machine.state === 'again';
    this.#machine.send('done');
    if (again || more) {
      if (this.#machine.state === 'idle') this.request();
      else this.#handle = this.#schedule((t) => this.#run(t));
    }
  }

  dispose(): void {
    if (this.#machine.state === 'queued') this.#cancel(this.#handle);
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
  /** The shell, resolved by `resolveShell` (what `createBoard` does); default the defaults. */
  readonly shell?: Shell;
  /** The customisation options, when `shell` is not given. */
  readonly shellOptions?: ShellOptions;
  /** Draw with Canvas 2D only. */
  readonly canvas2dOnly?: boolean;
  /** The agent (design 11): a transport or a server, vision, the label of the panel. Without it the Ask tool says there is none. */
  readonly agent?: AgentOption;
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
  /** The shell the view was made with: toolbar, keys, strings, parts. */
  readonly shell: Shell;
  /** The live figure cards over the canvas. */
  readonly figures: FigureLayer;
  /** The menus of the board (main, page, context). */
  readonly menus: MenuHost;
  /** The agent of the board: the runner of the board tools, the service, the circle to ask and the hand. */
  readonly agent: AgentKit;
  /** Adds a figure card with its middle at the middle of the view and gives it the input. */
  addFigure(mode?: string): BoardResult<string>;
  /** Sets the paper of the current page (BR-18): plain, grid, dots or lines. */
  setBackground(background: PageBackground): BoardResult<undefined>;
  /** Goes to the next page (`1`) or the previous one (`-1`); false at the end of the list. */
  stepPage(direction: 1 | -1): boolean;
  dispose(): void;
}

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
/** Tiles are drawn until a frame has spent this long (at least one a frame): a heavy tile is one frame, never six. */
const TILE_BUDGET_MS = 4;

/** The middle of the view in page units, for ordering the tiles of one frame. */
const order = { cx: 0, cy: 0 };
const needsDraw = (t: Tile): boolean => t.needsDraw;
/** The distance of a tile's middle from the view's middle, squared: no object and no root, so ordering makes no garbage. */
const farFromMiddle = (t: Tile): number => {
  const span = tileSpan(t.k);
  const dx = (t.tx + 0.5) * span - order.cx;
  const dy = (t.ty + 0.5) * span - order.cy;
  return dx * dx + dy * dy;
};
const nearTheMiddle = (a: Tile, b: Tile): number => farFromMiddle(a) - farFromMiddle(b);
/** What the top layer is given when no card is on show. */
const NO_OVER_CARDS: readonly OverCardItem[] = Object.freeze([]);
const meets = (a: Bounds, b: Bounds): boolean => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
const isHighlighter = (s: ShapeRecord): boolean => s.kind === 'ink' && (s.props as { nib?: unknown }).nib === 'highlighter';
/** The tiles' order: highlighters under the rest, then the shape's order key, then its id. */
const byLayerAndOrder = (a: ShapeRecord, b: ShapeRecord): number => {
  const la = isHighlighter(a) ? 0 : 1;
  const lb = isHighlighter(b) ? 0 : 1;
  if (la !== lb) return la - lb;
  return a.index < b.index ? -1 : a.index > b.index ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/** The widths of glyphs from a canvas, for the text and maths layout of the core. */
function installFontMeasure(doc: Document): void {
  const ctx = doc.createElement('canvas').getContext('2d');
  if (ctx === null) return;
  setFontMeasure((text, font, px, family) => {
    ctx.font = cssFontFor(font, family, px);
    const m = ctx.measureText(text);
    if (font === 'text') return { w: m.width, asc: m.fontBoundingBoxAscent > 0 ? m.fontBoundingBoxAscent : px * 0.8, desc: m.fontBoundingBoxDescent > 0 ? m.fontBoundingBoxDescent : px * 0.22, right: m.actualBoundingBoxRight };
    return { w: m.width, asc: Math.max(px * 0.3, m.actualBoundingBoxAscent), desc: Math.max(0, m.actualBoundingBoxDescent), right: m.actualBoundingBoxRight };
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
  const report = (e: BoardError): void => options.onError?.(e);
  const wantReadOnly = options.shell !== undefined ? options.shell.readOnly : options.shellOptions?.readOnly === true;
  const tools = toolsFor(options.tools ?? defaultTools, wantReadOnly);
  const shell =
    options.shell ??
    resolveShell({ ...options.shellOptions, ...(options.touchDraws !== undefined ? { pen: { touchDraws: options.touchDraws } } : {}) }, tools, report);
  const { strings } = shell;
  const readOnly = shell.readOnly;

  const painter = new WebPainter({
    ...(options.canvas2dOnly === true ? { canvas2dOnly: true } : {}),
    onNotice: (e) => options.onError?.(e),
    onError: report,
    requestFrame: () => loop.request(),
  });
  const overlay = createOverlayState();
  const styles = defaultStyles();
  const list: Tile[] = [];
  /** The tile being drawn in slices over several frames, with what it is drawn from; dropped when the board changes. */
  let tileJob: { readonly tile: Tile; readonly content: TileContent } | null = null;
  // the shapes a gesture moves, drawn on the overlay each frame (BR-82), and what a frame finds for them: kept between frames
  const liftShapes: ShapeRecord[] = [];
  const liftItems: DrawItem[] = [];
  const staleBoxes: Bounds[] = [];
  /** True when `s` is a figure whose card is on show this frame. */
  const cardOnShow = (s: ShapeRecord): boolean => {
    if (s.kind !== 'figure') return false;
    for (const card of figures.covering) if (card.id === s.id) return true;
    return false;
  };
  /** The draw items of `liftShapes` in the board's order, into `liftItems`. */
  const liftedItems = (scale: number): void => {
    liftShapes.sort(byLayerAndOrder);
    let n = 0;
    for (let i = 0; i < liftShapes.length; i++) {
      const item = core.drawList.itemOf(liftShapes[i] as ShapeRecord, scale);
      if (item !== undefined) liftItems[n++] = item;
    }
    liftItems.length = n;
  };
  /**
   * The held shapes at their place now, over the tiles; the settling ones over the tiles on show that are not drawn again yet
   * (a settling shape on no such tile is in its tiles: it is let go). A figure whose card is on show is the card's to draw.
   */
  const drawLifted = (page: string, scale: number): void => {
    const lift = core.lift;
    const kinds = core.store.kinds;
    if (lift.held.size > 0) {
      let n = 0;
      for (const id of lift.held) {
        const s = core.store.get(id);
        if (s !== undefined && isShape(s) && s.page === page && !cardOnShow(s)) liftShapes[n++] = s;
      }
      liftShapes.length = n;
      liftedItems(scale);
      if (liftItems.length > 0) painter.drawItems(liftItems);
    }
    if (lift.settling.size === 0) return;
    let stale = 0;
    for (let t = 0; t < list.length; t++) if ((list[t] as Tile).needsDraw) staleBoxes[stale++] = (list[t] as Tile).box;
    staleBoxes.length = stale;
    let n = 0;
    for (const id of lift.settling) {
      const s = core.store.get(id);
      const b = s !== undefined && isShape(s) && s.page === page ? shapeBounds(s, kinds) : undefined;
      if (s === undefined || b === undefined || !staleBoxes.some((box) => meets(box, b))) {
        lift.settled(id);
        continue;
      }
      if (isShape(s) && !cardOnShow(s)) liftShapes[n++] = s;
    }
    liftShapes.length = n;
    liftedItems(scale);
    if (liftItems.length > 0) painter.drawItems(liftItems, staleBoxes);
  };

  // the agent (design 11): the closures below are called only after the view is built
  let panel: AgentPanel | undefined;
  let pointTimer = 0;
  const viewBounds = (): Bounds => {
    const { w, h: height } = sizeOf();
    return (core.camera ?? new Camera()).visibleBounds(Math.max(1, w), Math.max(1, height));
  };
  const kit = createAgentKit(core, options.agent, {
    view: viewBounds,
    viewSize: () => {
      const { w, h: height } = sizeOf();
      return { w: Math.max(1, w), h: Math.max(1, height) };
    },
    clock: () => (typeof performance !== 'undefined' ? performance.now() : 0),
    requestFrame: () => loop.request(),
    onTip: (at) => {
      panel?.handAt(at.x, at.y);
      loop.request();
    },
    onHand: (at) => {
      panel?.handAt(at.x, at.y);
      loop.request();
    },
    onPoint: (box) => {
      // the laser, not stored: the box is ringed on the overlay for a moment
      const pad = 12;
      overlay.hint = [box.minX - pad, box.minY - pad, box.maxX + pad, box.minY - pad, box.maxX + pad, box.maxY + pad, box.minX - pad, box.maxY + pad];
      window.clearTimeout(pointTimer);
      pointTimer = window.setTimeout(() => {
        overlay.hint = null;
        loop.request();
      }, 1600);
      loop.request();
    },
    picture: (area) => pictureOf(core, doc, images.lookup, area),
    onError: report,
  });

  const ctx: ToolContext = {
    core,
    styles,
    overlay,
    circle: kit.circle,
    say: (text) => say(text),
    camera: () => core.camera,
    requestFrame: () => loop.request(),
    strokeEnded: () => painter.releaseLive(),
    strokeDropped: () => painter.abortLive(),
    activate: (id) => figures.activate(id),
  };
  const host = new ToolHost(ctx, tools, readOnly ? 'hand' : 'pen', shell.keys);
  installFontMeasure(doc);
  core.index.refresh();
  const images = new ImageCache(core.store, () => {
    painter.tiles.invalidateAll();
    loop.request();
  });
  painter.setImages(images.lookup);

  // ---- DOM
  const root = h('div', { class: 'ib-view', 'data-board-view': '', 'data-theme': shell.theme.name, 'data-toolbar': shell.position });
  for (const [name, value] of Object.entries(shell.theme.vars)) root.style.setProperty(name, value);
  const surface = h('div', { class: 'ib-surface', role: 'application', 'aria-label': strings.t('board.label'), tabindex: '0' });
  surface.append(painter.element);
  const toolBar = h('div', { class: 'ib-bar ib-tools', role: 'toolbar', 'aria-label': strings.t('toolbar.label'), 'data-position': shell.position });
  const styleBar = h('div', { class: 'ib-bar ib-style', 'aria-label': strings.t('style.label') });
  const penBar = h('div', { class: 'ib-bar ib-penbar', role: 'group', 'aria-label': strings.t('style.pen', 'Pen'), hidden: '' });
  const pageBar = h('div', { class: 'ib-bar ib-pages', 'aria-label': strings.t('pages.label') });
  const zoomBar = h('div', { class: 'ib-bar ib-zoom', 'aria-label': strings.t('zoom.label') });
  root.append(surface);
  if (shell.ui.styleBar && !readOnly) root.append(styleBar, penBar);
  if (shell.position !== 'none') root.append(toolBar);
  if (shell.ui.pages) root.append(pageBar);
  if (shell.ui.zoom) root.append(zoomBar);
  options.container.append(root);
  // the figure cards sit between the tiles and the live layer; what is above a card in the board's order is drawn over it (BR-55), and handles and guides over both
  const figures = new FigureLayer({
    core,
    doc,
    bars: root,
    strings,
    readOnly,
    onError: report,
    requestFrame: () => loop.request(),
    focusBoard: () => surface.focus({ preventScroll: true }),
  });
  painter.mountCards(figures.element);
  const circleMenu = new CircleMenu({ doc, root, circle: kit.circle, strings, focusBoard: () => surface.focus({ preventScroll: true }) });
  if (kit.enabled && !readOnly) {
    panel = new AgentPanel({ doc, root, service: kit.service, strings, onError: report, ...(options.agent?.label !== undefined ? { label: options.agent.label } : {}) });
  }
  // without an agent, what the service says (no agent, no transport) shows on the board's status line
  const stopSay = kit.service.on(() => {
    const last = kit.service.entries[kit.service.entries.length - 1];
    if (panel === undefined && last?.who === 'notice') say(last.text);
  });
  const menus = new MenuHost({ root, fns: shell.menus, label: (k) => strings.t(k), onError: report, requestFrame: () => loop.request(), mac: shell.mac });

  // ---- the frame
  const sizeOf = (): { w: number; h: number } => ({ w: surface.clientWidth, h: surface.clientHeight });
  // the overlay's items and what the root's data attributes say, kept between frames (a frame makes no new object for them)
  const items: { -readonly [K in keyof OverlayItems]: OverlayItems[K] } = { laser: null, loop: null, selection: [], cursor: null, selected: null, guides: [], marquee: null, hint: null };
  const shown = { percent: -1, backend: '', selected: -1, shapes: -1, tool: '', editing: '', tiles: -1, cards: -1, live: -1 };
  const render = (now: number): boolean => {
    const camera = core.camera;
    const page = core.pages.current;
    if (camera === undefined || page === null) return false;
    const w = surface.clientWidth;
    const height = surface.clientHeight;
    if (w < 1 || height < 1) return false;
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    painter.resize(w, height, dpr);
    let more = host.tick(now);
    camera.tick(now);
    if (camera.motion === 'zooming') more = true;
    painter.tiles.beginFrame();
    painter.tiles.visible(camera, w, height, dpr, list);
    // the tiles nearest the middle first, so a busy page fills in from where the eyes are (only when one has to be drawn: a
    // frame that draws no tile keeps the order it has and makes nothing for the garbage collector)
    if (list.some(needsDraw)) {
      order.cx = camera.x + w / camera.zoom / 2;
      order.cy = camera.y + height / camera.zoom / 2;
      list.sort(nearTheMiddle);
    }
    const began = painter.beginFrame(camera, dpr);
    if (!began.ok) return true;
    const frameStart = typeof performance !== 'undefined' ? performance.now() : now;
    const background = core.pages.get(page)?.background ?? 'none';
    let drawn = 0;
    let waiting = 0;
    // a tile with many shapes is drawn in slices that stop at the frame's budget (and go on in the next frame); while one is
    // unfinished no other tile is started
    const deadline = frameStart + TILE_BUDGET_MS;
    let busy = false;
    for (let t = 0; t < list.length; t++) {
      const tile = list[t] as Tile;
      if (tile.needsDraw && !busy && drawn < TILES_PER_FRAME && (drawn === 0 || performance.now() < deadline)) {
        let job = tileJob;
        if (job === null || job.tile !== tile) {
          const scale = Math.pow(2, tile.k);
          const box = tileBox(tile.k, tile.tx, tile.ty);
          const grow = TILE_GUTTER / scale;
          const region: Bounds = { minX: box.minX - grow, minY: box.minY - grow, maxX: box.maxX + grow, maxY: box.maxY + grow };
          // the shapes a gesture moves are not in the tiles: the overlay draws them where they are each frame (BR-82)
          const plan = core.drawList.plan(region, scale, core.lift.held);
          job = { tile, content: { box: region, items: plan.items, background, total: plan.total, more: plan.more } };
          tileJob = job;
        }
        painter.drawTile(tile, job.content, deadline);
        if (tile.needsDraw) {
          // stopped at the budget: the rest of it comes in the next frame
          busy = true;
          waiting++;
        } else {
          tileJob = null;
        }
        drawn++;
      } else {
        if (tile.needsDraw) waiting++;
        painter.drawTile(tile, null);
      }
    }
    if (waiting > 0) more = true;
    const live = core.live;
    // device pixels per page unit, worked out once (each number handed to a call is boxed on the heap, BR-77)
    const scale = camera.zoom * dpr;
    if (live.state === 'drawing') {
      live.rebuild(scale);
      painter.drawLiveStroke(live.view());
    } else {
      painter.drawLiveStroke(null);
    }
    if (waiting === 0) painter.settleLive();
    items.laser = overlay.laser;
    items.loop = overlay.loop;
    items.cursor = overlay.cursor;
    items.selected = editor.state === 'closed' && core.selection.size > 0 ? selectionView(core, camera.zoom) : null;
    items.guides = overlay.guides;
    items.marquee = overlay.marquee;
    items.hint = overlay.hint;
    placeField();
    if (figures.sync(camera, w, height, now)) more = true;
    painter.drawOverCards(figures.covering.length > 0 ? overCardItems(core, figures.covering, scale) : NO_OVER_CARDS);
    if (core.lift.held.size > 0 || core.lift.settling.size > 0) drawLifted(page, scale);
    const hand = kit.hand;
    if (hand !== undefined && hand.animation.state !== 'idle') {
      const handFrame = hand.frame(now, scale);
      if (handFrame.item !== undefined) painter.drawItems([handFrame.item]);
      if (handFrame.more) more = true;
    }
    panel?.place(camera);
    circleMenu.place(camera);
    painter.drawOverlay(items);
    painter.endFrame();
    // what the page shows of the board is written when it changes, not every frame (a write makes a string and a style check)
    const percent = Math.round(camera.zoom * 100);
    if (percent !== shown.percent) {
      shown.percent = percent;
      zoomOut.value = `${percent}%`;
    }
    const d = root.dataset;
    if (shown.backend !== painter.backend) d['backend'] = shown.backend = painter.backend;
    if (shown.selected !== core.selection.size) d['selected'] = String((shown.selected = core.selection.size));
    const shapes = core.store.shapeCount(page);
    if (shown.shapes !== shapes) d['shapes'] = String((shown.shapes = shapes));
    if (shown.tool !== host.tool) d['tool'] = shown.tool = host.tool;
    if (shown.editing !== editor.state) d['editing'] = shown.editing = editor.state;
    if (shown.tiles !== painter.tiles.size) d['tiles'] = String((shown.tiles = painter.tiles.size));
    if (shown.cards !== figures.cards.size) d['cards'] = String((shown.cards = figures.cards.size));
    if (shown.live !== figures.liveCount) d['live'] = String((shown.live = figures.liveCount));
    return more;
  };
  const loop = new FrameLoop(
    (cb) => window.requestAnimationFrame(cb),
    (id) => window.cancelAnimationFrame(id),
    render,
    report,
  );

  // ---- input
  const sink: InputSink = {
    sample: (s) => {
      // kept in one record: a pen sends hundreds of samples a second
      pointer.x = s.x;
      pointer.y = s.y;
      // a selection held in the margin pans the page, so the shape can leave the view (the tool then reads the new page point)
      if (s.phase === 'move' && s.buttons !== 0 && host.tool === 'select' && core.editor.state === 'closed') {
        const camera = core.camera;
        if (camera !== undefined) {
          const { w: viewW, h: viewH } = sizeOf();
          const edge = 28;
          const step = 8;
          let dx = 0;
          let dy = 0;
          if (s.x < edge) dx = step;
          else if (s.x > viewW - edge) dx = -step;
          if (s.y < edge) dy = step;
          else if (s.y > viewH - edge) dy = -step;
          if (dx !== 0 || dy !== 0) camera.panBy(dx, dy);
        }
      }
      host.sample(s);
    },
    key: (k) => {
      if (host.key(k)) loop.request();
    },
    wheel: (w) => host.wheel(w),
    gesture: (g) => host.gesture(g),
  };
  const input = new WebInput({ element: surface, sink, report, accepts: (t) => t === surface || (t instanceof Node && painter.element.contains(t)), ...(options.touchDraws !== undefined ? { touchDraws: options.touchDraws } : {}) });

  // ---- store and pages
  /** The tiles that meet `region` are drawn again; a tile being drawn in slices that meets it starts again (its plan is old). */
  const invalidate = (region: Bounds): void => {
    painter.tiles.invalidate(region);
    if (tileJob !== null && meets(tileJob.content.box, region)) tileJob = null;
  };
  const stopStore = core.store.on((diff) => {
    const page = core.pages.current;
    // a shape a gesture holds is in no tile: moving it again draws no tile again (BR-82), and a tile being drawn in slices goes on
    if (page !== null) for (const region of diffRegions(diff, page, core.store.kinds, core.lift.held)) invalidate(region);
    // a page's paper changed: every tile shows it
    if (diff.updated.some((u) => (u.after as { background?: string }).background !== (u.before as { background?: string }).background)) {
      painter.tiles.invalidateAll();
      tileJob = null;
    }
    loop.request();
  });
  // a gesture ended: its shapes go back into the tiles where they are now
  const stopLift = core.lift.onRelease((ids) => {
    const page = core.pages.current;
    for (const id of ids) {
      const s = core.store.get(id);
      const b = s !== undefined && isShape(s) && s.page === page ? shapeBounds(s, core.store.kinds) : undefined;
      if (b !== undefined) invalidate(b);
    }
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
    kit.circle.dismiss();
    painter.abortLive();
    painter.tiles.clear();
    tileJob = null;
    core.lift.clear();
    core.selection.clear();
    overlay.laser = null;
    overlay.loop = null;
    pageName.textContent = `${core.pages.get(page ?? '')?.name ?? 'Page'} ▾`;
    pageList.hidden = true;
    sendIfAble(pagesState, 'close');
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
  const hintFor = (action: string): string => {
    const k = shell.keys.keysOf(action)[0];
    return k === undefined ? '' : ` (${describeKey(k, shell.mac)})`;
  };
  /** The icon of a tool or action: the host's SVG text or factory, else the built-in one; undefined when there is none (the label shows). */
  const iconFor = (id: string): HTMLElement | undefined => {
    const holder = h('span', { class: 'ib-ico', 'aria-hidden': 'true' });
    const custom = shell.icons.get(id);
    if (typeof custom === 'function') {
      try {
        holder.append(custom(doc));
        return holder;
      } catch (e) {
        report(boardError('icon_invalid', `The icon factory of "${id}" threw: ${e instanceof Error ? e.message : String(e)}.`, { detail: { tool: id } }));
      }
    }
    const svg = typeof custom === 'string' ? custom : defaultIcon(id);
    if (svg === undefined) return undefined;
    holder.innerHTML = svg;
    return holder;
  };
  /** A toolbar button: the icon (and the label when the host asks for labels), or the label alone when there is no icon. */
  const makeButton = (id: string, label: string, title: string, attrs: Record<string, string>, labelled = shell.ui.labels): HTMLButtonElement => {
    const b = h('button', { type: 'button', title, 'aria-label': label, ...attrs });
    const icon = iconFor(id);
    if (icon === undefined) b.append(label);
    else {
      b.append(icon);
      if (labelled) b.append(label);
    }
    return b;
  };
  const toolLabel = (id: string, fallback: string): string => strings.t(`tool.${id}`, fallback);
  // triangle, diamond and star are in a "More shapes" menu on the rectangle's group, so the strip stays one row (ui.md)
  const placed = new Set(shell.groups.flat());
  const moreIds = MORE_SHAPES.filter((id) => host.tools.some((t) => t.id === id) && !placed.has(id));
  const moreLabel = strings.t('action.moreShapes');
  const moreMenu = h('div', { class: 'ib-list ib-more', role: 'menu', 'aria-label': moreLabel, hidden: '' });
  const moreBtn = h('button', { type: 'button', title: moreLabel, 'aria-label': moreLabel, 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-pressed': 'false', 'data-action': 'more-shapes' }, '▾');
  const figLabel = strings.t('action.figures');
  const figMenu = h('div', { class: 'ib-list ib-figmenu', role: 'menu', 'aria-label': figLabel, hidden: '' });
  const figBtn = makeButton('figures', figLabel, strings.t('action.figures.title'), { 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-pressed': 'false', 'data-action': 'figures' });
  /** Puts a menu on its button. The menu's `hidden` is its state: no other field says it. */
  const placeMenu = (menu: HTMLElement, btn: HTMLElement): void => {
    const at = btn.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    menu.style.left = `${Math.max(0, at.left - box.left)}px`;
    if (shell.position === 'left' || shell.position === 'right') menu.style.top = `${Math.max(0, at.top - box.top)}px`;
  };
  const showMore = (open: boolean): void => {
    moreMenu.hidden = !open;
    moreBtn.setAttribute('aria-expanded', String(open));
    if (!open) return;
    figMenu.hidden = true;
    figBtn.setAttribute('aria-expanded', 'false');
    placeMenu(moreMenu, moreBtn);
  };
  const showFigures = (open: boolean): void => {
    figMenu.hidden = !open;
    figBtn.setAttribute('aria-expanded', String(open));
    if (!open) return;
    moreMenu.hidden = true;
    moreBtn.setAttribute('aria-expanded', 'false');
    placeMenu(figMenu, figBtn);
  };
  const makeToolButton = (def: ToolDef): HTMLButtonElement => {
    const label = toolLabel(def.id, def.label);
    const b = makeButton(def.id, label, `${label}${hintFor(def.id)}`, { 'aria-pressed': 'false', 'data-tool': def.id });
    b.addEventListener('click', () => {
      showMore(false);
      showFigures(false);
      host.setTool(def.id);
    });
    toolButtons.set(def.id, b);
    return b;
  };
  // an image comes from a file; Fix turns the newest stroke (or the selected ones) into a clean shape
  const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml', hidden: '', 'aria-label': strings.t('action.image') });
  const note = h('div', { class: 'ib-fixed', role: 'status', hidden: '' });
  let noteTimer = 0;
  let warmTimer = 0;
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
  const fixNow = (): void => {
    const fixed = fixStrokes(core, strokesToFix(core));
    if (fixed.ok && fixed.value.length > 0) core.selection.set(fixed.value);
    else say(fixed.ok ? strings.t('note.noFix') : fixed.message);
    loop.request();
  };
  /** Adds a figure card at the middle of the view, selects it and asks for the input (it goes live and takes it). */
  const addFigureHere = (mode?: string): BoardResult<string> => {
    showFigures(false);
    const made = addFigure(core, { at: viewCentre(), ...(mode !== undefined ? { mode } : {}) });
    if (!made.ok) {
      report(made);
      say(made.message);
      return made;
    }
    core.selection.set([made.value]);
    host.setTool('select');
    figures.activate(made.value);
    loop.request();
    return made;
  };
  const undoLabel = strings.t('action.undo');
  const redoLabel = strings.t('action.redo');
  const undoBtn = makeButton('undo', undoLabel, `${undoLabel}${hintFor('undo')}`, { 'data-action': 'undo' });
  const redoBtn = makeButton('redo', redoLabel, `${redoLabel}${hintFor('redo')}`, { 'data-action': 'redo' });
  undoBtn.addEventListener('click', () => {
    core.history.undo();
    loop.request();
  });
  redoBtn.addEventListener('click', () => {
    core.history.redo();
    loop.request();
  });
  /** The buttons that are not tools, by the id a toolbar group names. */
  const actionButton = (id: string): HTMLElement | undefined => {
    if (id === 'more-shapes') return moreIds.length > 0 ? moreBtn : undefined;
    if (readOnly) return undefined;
    if (id === 'figures') return figBtn;
    if (id === 'undo') return shell.ui.history ? undoBtn : undefined;
    if (id === 'redo') return shell.ui.history ? redoBtn : undefined;
    if (id === 'image') {
      const b = makeButton('image', strings.t('action.image'), strings.t('action.image.title'), { 'data-action': 'image' });
      b.addEventListener('click', () => fileInput.click());
      return b;
    }
    if (id === 'figure') {
      const b = makeButton('figure', strings.t('action.figure'), `${strings.t('action.figure.title')}${hintFor('figure')}`, { 'data-action': 'figure' });
      b.addEventListener('click', () => void addFigureHere());
      return b;
    }
    const figure = FIGURE_ACTIONS.find((a) => a.id === id);
    if (figure !== undefined) {
      const b = makeButton(id, strings.t(`action.${id}`), strings.t(`action.${id}.title`), { 'data-action': id });
      b.addEventListener('click', () => void addFigureHere(figure.mode));
      return b;
    }
    if (id === 'fix') {
      const b = makeButton('fix', strings.t('action.fix'), strings.t('action.fix.title'), { 'data-action': 'fix' });
      b.addEventListener('click', fixNow);
      return b;
    }
    return undefined;
  };
  for (const group of shell.groups) {
    const buttons: HTMLElement[] = [];
    for (const id of group) {
      const def = host.tools.find((t) => t.id === id);
      const b = def !== undefined ? makeToolButton(def) : actionButton(id);
      if (b !== undefined) buttons.push(b);
    }
    if (buttons.length === 0) continue;
    if (toolBar.childElementCount > 0) toolBar.append(h('span', { class: 'ib-sep' }));
    toolBar.append(...buttons);
  }
  // the shapes of the More menu are tools too, with the same buttons
  for (const id of moreIds) {
    const def = host.tools.find((t) => t.id === id);
    if (def === undefined) continue;
    const b = makeToolButton(def);
    b.setAttribute('role', 'menuitem');
    moreMenu.append(b);
  }
  if (moreIds.length > 0) {
    moreBtn.addEventListener('click', () => showMore(moreMenu.hasAttribute('hidden')));
    moreBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') showMore(false);
    });
    moreMenu.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      showMore(false);
      moreBtn.focus();
    });
    // a press anywhere else on the board closes the menu
    root.addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      if (!moreMenu.hasAttribute('hidden') && !moreMenu.contains(t) && !moreBtn.contains(t)) showMore(false);
    });
    root.append(moreMenu);
  }
  // Figure, Graph, Geometry, Calculator, Probability and 3D. A host who names one of those ids still gets its own button.
  if (figBtn.isConnected) {
    const choices: readonly { readonly id: string; readonly mode?: string }[] = [{ id: 'figure' }, ...FIGURE_ACTIONS.map((a) => ({ id: a.id, mode: a.mode }))];
    for (const choice of choices) {
      const label = strings.t(`action.${choice.id}`);
      const b = makeButton(choice.id, label, strings.t(`action.${choice.id}.title`), { role: 'menuitem', 'data-action': choice.id }, true);
      b.addEventListener('click', () => void addFigureHere(choice.mode));
      figMenu.append(b);
    }
    figBtn.addEventListener('click', () => showFigures(figMenu.hasAttribute('hidden')));
    figBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') showFigures(false);
    });
    figMenu.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      showFigures(false);
      figBtn.focus();
    });
    root.addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      if (!figMenu.hasAttribute('hidden') && !figMenu.contains(t) && !figBtn.contains(t)) showFigures(false);
    });
    root.append(figMenu);
  }
  root.append(note, fileInput);
  const syncHistory = (): void => {
    undoBtn.disabled = !core.history.canUndo;
    redoBtn.disabled = !core.history.canRedo;
  };
  const stopHistory = core.history.on(syncHistory);
  syncHistory();

  /** Puts the pen row on the ink tool's button. A hidden toolbar leaves the controls in the style bar. */
  const placePenBar = (): void => {
    if (penBar.hidden) return;
    const btn = toolButtons.get(host.tool);
    if (btn === undefined) return;
    const at = btn.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    const gap = 8;
    penBar.style.right = 'auto';
    penBar.style.bottom = 'auto';
    if (shell.position === 'left') {
      penBar.style.left = `${at.right - box.left + gap}px`;
      penBar.style.top = `${Math.max(0, at.top - box.top)}px`;
    } else if (shell.position === 'right') {
      penBar.style.left = 'auto';
      penBar.style.right = `${box.right - at.left + gap}px`;
      penBar.style.top = `${Math.max(0, at.top - box.top)}px`;
    } else if (shell.position === 'top') {
      penBar.style.left = `${Math.max(0, at.left - box.left)}px`;
      penBar.style.top = `${at.bottom - box.top + gap}px`;
    } else {
      penBar.style.left = `${Math.max(0, at.left - box.left)}px`;
      penBar.style.top = 'auto';
      penBar.style.bottom = `${box.bottom - at.top + gap}px`;
    }
  };
  const renderStyle = (): void => {
    const tool = host.tool;
    const kids: (Node | string)[] = [];
    if (tool === 'pen' || tool === 'highlighter') {
      const which = tool;
      const st = styles[which];
      if (tool === 'pen') {
        for (const [nib, label] of NIB_LABELS) {
          const b = h('button', { type: 'button', class: 'ib-nib', title: label, 'aria-label': label, 'aria-pressed': String(styles.pen.nib === nib) });
          const icon = iconFor(nib);
          if (icon !== undefined) {
            if (styles.pen.nib === nib) icon.style.color = styles.pen.color;
            b.append(icon);
          } else b.append(label);
          b.addEventListener('click', () => {
            styles.pen = { ...styles.pen, nib };
            renderStyle();
          });
          kids.push(b);
        }
        kids.push(h('span', { class: 'ib-sep' }));
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
    } else if ((tool === 'select' || tool === 'hand') && core.selection.size === 0) {
      kids.push(...backgroundControls());
    }
    const ink = tool === 'pen' || tool === 'highlighter' || tool === 'eraser';
    const docked = ink && shell.position !== 'none' && shell.ui.styleBar;
    if (docked) {
      penBar.replaceChildren(...kids);
      penBar.hidden = false;
      styleBar.replaceChildren();
      styleBar.hidden = true;
      placePenBar();
    } else {
      penBar.replaceChildren();
      penBar.hidden = true;
      styleBar.replaceChildren(...kids);
      styleBar.hidden = kids.length === 0;
    }
    for (const [id, b] of toolButtons) b.setAttribute('aria-pressed', String(id === tool));
    const tint = (id: string, color: string): void => {
      const svg = toolButtons.get(id)?.querySelector('svg');
      if (svg instanceof SVGElement) svg.style.color = color;
    };
    tint('pen', styles.pen.color);
    tint('highlighter', styles.highlighter.color);
    moreBtn.setAttribute('aria-pressed', String(MORE_SHAPES.includes(tool)));
    surface.style.cursor = tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
  };

  /** The page's paper (BR-18): plain, grid, dots or lines. Shown when nothing is selected and the tool has no style of its own. */
  const backgroundControls = (): (Node | string)[] => {
    const page = core.pages.current;
    const current = page === null ? 'none' : (core.pages.get(page)?.background ?? 'none');
    const kids: (Node | string)[] = [h('span', {}, strings.t('page.background'))];
    for (const bg of PAGE_BACKGROUNDS) {
      const b = h('button', { type: 'button', 'data-background': bg, 'aria-pressed': String(bg === current) }, strings.t(`background.${bg}`));
      b.addEventListener('click', () => {
        api.setBackground(bg);
        renderStyle();
      });
      kids.push(b);
    }
    return kids;
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
        ...(patch.labelAlign !== undefined ? { labelAlign: patch.labelAlign } : {}),
        ...(patch.labelV !== undefined ? { labelV: patch.labelV } : {}),
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
    const boxes = new Set(['rect', 'ellipse', 'triangle', 'diamond', 'star']);
    let across = st.labelAlign ?? 'center';
    let down = st.labelV ?? 'middle';
    if (host.tool === 'select') {
      for (const id of core.selection.ids) {
        const r = core.store.get(id);
        if (r === undefined || !r.id.startsWith('shape:')) continue;
        const s = r as ShapeRecord;
        if (!boxes.has(s.kind)) continue;
        const p = s.props as { labelAlign?: typeof across; labelV?: typeof down };
        if (p.labelAlign !== undefined) across = p.labelAlign;
        if (p.labelV !== undefined) down = p.labelV;
        break;
      }
    }
    kids.push(h('span', { class: 'ib-sep' }));
    for (const [id, label] of [['start', 'Left'], ['center', 'Centre'], ['end', 'Right']] as const) {
      const b = h('button', { type: 'button', class: 'ib-align', 'data-style': 'label-align', title: label, 'aria-label': `Align ${label}`, 'aria-pressed': String(across === id) }, label.slice(0, 1));
      b.addEventListener('click', () => apply({ labelAlign: id }));
      kids.push(b);
    }
    for (const [id, label] of [['start', 'Top'], ['middle', 'Middle'], ['end', 'Bottom']] as const) {
      const b = h('button', { type: 'button', class: 'ib-align', 'data-style': 'label-anchor', title: label, 'aria-label': `Align ${label}`, 'aria-pressed': String(down === id) }, label.slice(0, 1));
      b.addEventListener('click', () => apply({ labelV: id }));
      kids.push(b);
    }
    return kids;
  };
  host.onTool(() => {
    renderStyle();
    loop.request();
  });
  renderStyle();

  // ---- what to do with the selection
  const actionBar = h('div', { class: 'ib-bar ib-actions', 'aria-label': strings.t('selection.label') });
  actionBar.hidden = true;
  if (shell.ui.selectionBar && !readOnly) root.append(actionBar);
  /** `Flip H` as the string key `selection.flipH`. */
  const selKey = (label: string): string => `selection.${label.charAt(0).toLowerCase()}${label.slice(1).replace(/ (\w)/g, (_m, c: string) => c.toUpperCase())}`;
  const act = (label: string, title: string, run: () => void): HTMLButtonElement => {
    const b = h('button', { type: 'button', title, 'data-action': label.toLowerCase() }, strings.t(selKey(label), label));
    b.addEventListener('click', () => {
      run();
      loop.request();
    });
    return b;
  };
  const menu = (label: string, choices: readonly (readonly [string, () => void])[]): HTMLSelectElement => {
    const shown = strings.t(selKey(label), label);
    const sel = h('select', { 'aria-label': shown, 'data-action': label.toLowerCase() }, h('option', { value: '' }, shown));
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
    const bw = Math.max(70, (box.maxX - box.minX) * zoom);
    const bh = Math.max(screenPx * 1.3 + 12, (box.maxY - box.minY) * zoom);
    const boxLabel = shape.kind !== 'text' && shape.kind !== 'sticky' && shape.kind !== 'frame';
    if (boxLabel) {
      const ha = p['labelAlign'];
      align = ha === 'start' ? 'left' : ha === 'end' ? 'right' : 'center';
    }
    const down = p['labelV'] === 'start' ? 'start' : p['labelV'] === 'end' ? 'end' : 'middle';
    const block = lineCount(field.value) * screenPx * 1.3;
    const pad = !boxLabel ? 4 : down === 'start' ? 4 : down === 'end' ? Math.max(4, bh - block - 4) : Math.max(4, (bh - block) / 2);
    // a text shape grows down from its top left, so a new letter does not move the line that is already there
    const anchor = shape.kind === 'text' ? g.toPage(box.minX, box.minY) : g.toPage((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2);
    const left = shape.kind === 'text' ? (anchor.x - camera.x) * zoom : (anchor.x - camera.x) * zoom - bw / 2;
    const top = shape.kind === 'text' ? (anchor.y - camera.y) * zoom : (anchor.y - camera.y) * zoom - bh / 2;
    const place = `${left.toFixed(1)}|${top.toFixed(1)}|${bw.toFixed(1)}|${bh.toFixed(1)}|${align}|${pad.toFixed(1)}|${bg}|${rotate}|${screenPx.toFixed(1)}|${family}`;
    if (field.dataset['place'] === place) return;
    field.dataset['place'] = place;
    const st = field.style;
    st.left = `${left}px`;
    st.top = `${top}px`;
    st.width = `${bw}px`;
    st.height = `${bh}px`;
    st.font = cssFontFor('text', family, screenPx);
    st.lineHeight = '1.3';
    st.textAlign = align;
    st.background = bg;
    st.transform = rotate === 0 ? '' : `rotate(${rotate}rad)`;
    st.paddingTop = `${pad}px`;
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
    delete field.dataset['place'];
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
  const pointer = { x: 0, y: 0 };
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
  const pagesState = new StateMachine(PAGEBAR_MACHINE, 'closed', refusedMove('page bar', () => report));
  const pageName = h('button', { type: 'button', 'aria-haspopup': 'listbox', 'aria-label': strings.t('pages.label') }, `${core.pages.get(core.pages.current ?? '')?.name ?? 'Page'} ▾`);
  const addBtn = h('button', { type: 'button', title: strings.t('pages.add'), 'aria-label': strings.t('pages.add') }, '+');
  const pageList = h('div', { class: 'ib-list', role: 'listbox', 'aria-label': strings.t('pages.label') });
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
    } else if (sendIfAble(pagesState, 'close')) {
      pageList.hidden = true;
    }
  });
  addBtn.addEventListener('click', () => api.addPage());
  // the main menu and the menu of the current page: lists the host can change (B29)
  const mainBtn = makeButton('menu', strings.t('menu.main'), strings.t('menu.main'), { 'aria-haspopup': 'menu', 'data-action': 'main-menu' }, false);
  const pageMenuBtn = h('button', { type: 'button', title: strings.t('pages.menu'), 'aria-label': strings.t('pages.menu'), 'aria-haspopup': 'menu', 'data-action': 'page-menu' }, '⋯');
  menus.addAnchor(mainBtn);
  menus.addAnchor(pageMenuBtn);
  mainBtn.addEventListener('click', () => menus.open('main', mainItems(), { kind: 'main' }, mainBtn));
  pageMenuBtn.addEventListener('click', () => {
    const page = core.pages.current;
    if (page !== null) menus.open('page', pageItems(), { kind: 'page', page }, pageMenuBtn);
  });
  if (shell.ui.mainMenu && !readOnly) pageBar.append(mainBtn);
  pageBar.append(pageName, addBtn);
  if (!readOnly) pageBar.append(pageMenuBtn);
  pageBar.append(pageList);
  const onKeyEscape = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && sendIfAble(pagesState, 'close')) pageList.hidden = true;
  };
  root.addEventListener('keydown', onKeyEscape);

  // ---- zoom bar
  const zoomOut = h('output', { 'aria-label': strings.t('zoom.label') }, '100%');
  const zoomBy = (factor: number): void => {
    const { w, h: height } = sizeOf();
    core.camera?.zoomBy(factor, w / 2, height / 2, performance.now());
    loop.request();
  };
  const minus = h('button', { type: 'button', title: strings.t('zoom.out'), 'aria-label': strings.t('zoom.out') }, '−');
  const plus = h('button', { type: 'button', title: strings.t('zoom.in'), 'aria-label': strings.t('zoom.in') }, '+');
  const reset = h('button', { type: 'button', title: strings.t('zoom.reset'), 'aria-label': strings.t('zoom.reset') }, '1:1');
  const fitBtn = h('button', { type: 'button', title: strings.t('zoom.fit'), 'aria-label': strings.t('zoom.fit'), 'data-action': 'zoom-fit' }, '⤢');
  const selBtn = h('button', { type: 'button', title: strings.t('zoom.selection'), 'aria-label': strings.t('zoom.selection'), 'data-action': 'zoom-selection' }, '◎');
  /** Puts the camera so `box` fills the view with a margin; a box with no area keeps the zoom. */
  const zoomToBox = (box: Bounds | undefined): void => {
    const camera = core.camera;
    if (camera === undefined || box === undefined) return;
    const { w, h: height } = sizeOf();
    const bw = Math.max(1, box.maxX - box.minX);
    const bh = Math.max(1, box.maxY - box.minY);
    const zoom = Math.min(20, Math.max(0.05, Math.min((w - 160) / bw, (height - 200) / bh)));
    const z = Math.min(zoom, 2);
    camera.moveTo((box.minX + box.maxX) / 2 - w / z / 2, (box.minY + box.maxY) / 2 - height / z / 2, z, performance.now());
    loop.request();
  };
  const boxOf = (shapes: readonly ShapeRecord[]): Bounds | undefined => {
    let all: Bounds | undefined;
    for (const sh of shapes) all = unionBounds(all, shapeBounds(sh, core.store.kinds));
    return all;
  };
  const zoomFit = (): void => {
    const page = core.pages.current;
    if (page !== null) zoomToBox(boxOf(core.store.shapesOn(page)));
  };
  const zoomSelection = (): void => {
    const picked = core.selection.ids.map((id) => core.store.get(id)).filter((r): r is ShapeRecord => r !== undefined && r.id.startsWith('shape:'));
    zoomToBox(boxOf(picked));
  };
  fitBtn.addEventListener('click', zoomFit);
  selBtn.addEventListener('click', zoomSelection);
  minus.addEventListener('click', () => zoomBy(1 / 1.25));
  plus.addEventListener('click', () => zoomBy(1.25));
  reset.addEventListener('click', () => {
    const camera = core.camera;
    if (camera === undefined) return;
    const { w, h: height } = sizeOf();
    camera.zoomAbout(1, w / 2, height / 2, performance.now());
    loop.request();
  });
  zoomBar.append(minus, zoomOut, plus, reset, fitBtn, selBtn);

  // ---- menus (B29): default items, wrapped by the host's functions when a menu opens
  const saveFile = (): void => {
    const text = saveBoard(core.store);
    if (!text.ok) {
      report(text);
      say(text.message);
      return;
    }
    const url = URL.createObjectURL(new Blob([text.value], { type: 'application/json' }));
    const a = h('a', { href: url, download: 'board.incantly-board' });
    doc.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  const item = (id: string, label: string, run: (t: MenuTarget) => void, extra: { icon?: string; key?: string; enabled?: (t: MenuTarget) => boolean } = {}): MenuItem => {
    const keyText = extra.key ?? shell.keys.keysOf(id)[0];
    return {
      id,
      label,
      ...(extra.icon !== undefined ? { icon: extra.icon } : {}),
      ...(keyText !== undefined ? { key: keyText } : {}),
      ...(extra.enabled !== undefined ? { enabled: extra.enabled } : {}),
      run,
    };
  };
  const mainItems = (): readonly MenuItem[] => [
    item('undo', strings.t('action.undo'), () => void core.history.undo(), { icon: 'undo', enabled: () => core.history.canUndo }),
    item('redo', strings.t('action.redo'), () => void core.history.redo(), { icon: 'redo', enabled: () => core.history.canRedo }),
    item('image', strings.t('action.image'), () => fileInput.click(), { icon: 'image' }),
    item('figure', strings.t('action.figure'), () => void addFigureHere(), { icon: 'figure' }),
    item('fix', strings.t('action.fix'), fixNow, { icon: 'fix' }),
    item('zoomFit', strings.t('menu.zoomFit'), zoomFit),
    item('save', strings.t('menu.save'), saveFile),
  ];
  const pageItems = (): readonly MenuItem[] => {
    const named = (t: MenuTarget): string => core.pages.get(t.page ?? '')?.name ?? '';
    return [
      item(
        'rename',
        strings.t('page.rename'),
        (t) => {
          const next = doc.defaultView?.prompt(strings.t('page.renamePrompt'), named(t));
          if (typeof next === 'string' && next !== '' && t.page !== undefined) {
            const done = core.pages.renamePage(t.page, next);
            if (!done.ok) report(done);
          }
        },
      ),
      item('duplicate', strings.t('page.duplicate'), (t) => {
        const made = t.page === undefined ? undefined : core.pages.duplicatePage(t.page);
        if (made !== undefined && !made.ok) report(made);
      }),
      item(
        'delete',
        strings.t('page.delete'),
        (t) => {
          const done = t.page === undefined ? undefined : core.pages.removePage(t.page);
          if (done !== undefined && !done.ok) report(done);
        },
        { enabled: () => core.pages.list().length > 1 },
      ),
      ...PAGE_BACKGROUNDS.map((bg) =>
        item(`background.${bg}`, `${strings.t('page.background')}: ${strings.t(`background.${bg}`)}`, (t) => void (t.page !== undefined && core.pages.setBackground(t.page, bg)), {
          enabled: (t) => core.pages.get(t.page ?? '')?.background !== bg,
        }),
      ),
    ];
  };
  const hasSelection = (): boolean => core.selection.size > 0;
  const contextItems = (): readonly MenuItem[] => [
    item('duplicate', strings.t('selection.duplicate'), () => void editAction(ctx, 'duplicate'), { enabled: hasSelection }),
    item('group', strings.t('selection.group'), () => void editAction(ctx, 'group'), { enabled: hasSelection }),
    item('ungroup', strings.t('selection.ungroup'), () => void editAction(ctx, 'ungroup'), { enabled: hasSelection }),
    item('lock', strings.t('selection.lock'), () => void setLocked(core, core.selection.ids), { enabled: hasSelection }),
    item('front', strings.t('selection.front'), () => void editAction(ctx, 'front'), { enabled: hasSelection }),
    item('back', strings.t('selection.back'), () => void editAction(ctx, 'back'), { enabled: hasSelection }),
    item('delete', strings.t('selection.delete'), () => void deleteSelected(), { enabled: hasSelection }),
    item('selectAll', strings.t('menu.selectAll'), () => void editAction(ctx, 'selectAll')),
    item('figure', strings.t('menu.addFigure'), (t) => void (t.at !== undefined && addFigureAt(t.at)), { icon: 'figure' }),
    item('zoomFit', strings.t('menu.zoomFit'), zoomFit),
  ];
  const deleteSelected = (): void => {
    const going = [...core.selection.ids];
    core.selection.clear();
    deleteShapes(core, going);
  };
  const addFigureAt = (at: { x: number; y: number }): void => {
    const made = addFigure(core, { at });
    if (!made.ok) {
      report(made);
      return;
    }
    core.selection.set([made.value]);
    host.setTool('select');
    figures.activate(made.value);
  };
  surface.addEventListener('contextmenu', (e) => {
    if (readOnly || core.camera === undefined) return;
    const box = root.getBoundingClientRect();
    const sx = e.clientX - box.left;
    const sy = e.clientY - box.top;
    const at = core.camera.toPage(sx, sy);
    const hit = pickShape(core, at.x, at.y, 6 / core.camera.zoom);
    if (hit !== undefined && !core.selection.ids.includes(hit.id)) core.selection.set(selectionFor(core.store, hit.id));
    const target: MenuTarget = { kind: core.selection.size > 0 ? 'shape' : 'board', shapes: [...core.selection.ids], at };
    menus.open('context', contextItems(), target, { x: sx, y: sy });
  });

  // ---- resizing
  /** Keeps the toolbar in the space beside the zoom bar, so the zoom never sits on a tool. */
  const placeBars = (): void => {
    placePenBar();
    if (shell.position !== 'bottom' || toolBar.parentElement === null) return;
    const viewW = root.clientWidth;
    if (viewW <= 0) return;
    const zoomW = zoomBar.parentElement !== null && !zoomBar.hidden ? zoomBar.offsetWidth : 0;
    const reserve = zoomW > 0 ? zoomW + 28 : 0;
    const available = Math.max(120, viewW - 24 - reserve);
    toolBar.style.marginLeft = '0';
    toolBar.style.marginRight = '0';
    toolBar.style.right = 'auto';
    toolBar.style.maxWidth = `${available}px`;
    const shift = Math.max(0, (available - toolBar.offsetWidth) / 2);
    toolBar.style.left = `${12 + shift}px`;
  };
  let observer: ResizeObserver | undefined;
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => {
      input.measure();
      placeBars();
      loop.request();
    });
    observer.observe(surface);
    if (zoomBar.parentElement !== null) observer.observe(zoomBar);
  }
  placeBars();

  const api: BoardView = {
    core,
    host,
    painter,
    element: root,
    shell,
    figures,
    menus,
    agent: kit,
    addFigure: (mode) => (readOnly ? boardError('bad_argument', 'This board is read only.') : addFigureHere(mode)),
    setBackground: (background) => {
      const page = core.pages.current;
      if (page === null) return boardError('bad_argument', 'The board has no page.', { detail: { field: 'page' } });
      const set = core.pages.setBackground(page, background);
      loop.request();
      return set.ok ? ok(undefined) : set;
    },
    stepPage: (direction) => {
      const list = core.pages.list();
      const at = list.findIndex((p) => p.id === core.pages.current);
      const next = list[at + direction];
      if (at < 0 || next === undefined) return false;
      return core.pages.goToPage(next.id).ok;
    },
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
      stopLift();
      stopPages();
      stopSelection();
      stopHistory();
      stopEditor();
      images.dispose();
      kit.service.stop();
      stopSay();
      circleMenu.dispose();
      panel?.dispose();
      window.clearTimeout(pointTimer);
      window.clearTimeout(noteTimer);
      window.clearTimeout(warmTimer);
      root.removeEventListener('copy', onCopy);
      root.removeEventListener('cut', onCut);
      root.removeEventListener('paste', onPaste);
      root.removeEventListener('keydown', onKeyEscape);
      painter.dispose();
      figures.dispose();
      menus.dispose();
      root.remove();
    },
  };
  // the actions the key map names and the shell carries out (ui.md, Keys)
  host.setAction('zoomIn', () => (zoomBy(1.25), true));
  host.setAction('zoomOut', () => (zoomBy(1 / 1.25), true));
  host.setAction('zoom100', () => (reset.click(), true));
  host.setAction('zoomFit', () => (zoomFit(), true));
  host.setAction('zoomSelection', () => (zoomSelection(), true));
  host.setAction('nextPage', () => api.stepPage(1));
  host.setAction('prevPage', () => api.stepPage(-1));
  host.setAction('figure', () => !readOnly && (void addFigureHere(), true));
  // the pen's code is warmed once the board is idle after it opens, so the first stroke runs optimised (BR-77)
  if (!readOnly) {
    warmTimer = window.setTimeout(() => {
      const camera = core.camera;
      if (camera !== undefined) warmInk(camera);
    }, WARM_AFTER_MS);
  }
  loop.request();
  return ok(api);
}

