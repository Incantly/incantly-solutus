/**
 * Live figure cards over the board's canvas (design 8; docs/state-machines.md B26 to B28). Every figure shape of the
 * current page has a card here. One `SchedulerHost` (view package) per board decides which cards are live: at most 3;
 * the others show their picture. A live card is a `createApp` host element placed over the canvas and moved by a CSS
 * transform, so panning and zooming never lay it out again. While the camera moves the cards show their picture, and 150
 * ms after it stops they are sized for the new zoom and paint again. A double click or Enter gives a card the input; Esc
 * gives it back. The script of the shape is the only source of truth; the picture is a cache written without an undo step.
 */
import { createApp, createHeadlessApp } from '@incantly/sdk';
import type { App, MountedApp } from '@incantly/sdk';
import { StateMachine } from '@incantly/kernel';
import { sendIfAble } from '../core/machine';
import type { MachineTable } from '@incantly/kernel';
import { MODE_IDS } from '@incantly/modes';
import { DEFAULT_SCHEDULER_CONFIG, SchedulerHost } from '@incantly/view';
import type { SchedulerAction } from '@incantly/view';
import type { BoardCore } from '../core/board';
import type { CameraView } from '../core/camera';
import { STEADY_DELAY_MS } from '../core/camera';
import { shapesOverCards } from '../core/card-over';
import { deleteShapes } from '../core/edit';
import { boardError, refusedMove } from '../core/errors';
import type { BoardError } from '../core/errors';
import { figuresOnPage, sdkMode, setFigureMode, setFigurePicture, setFigureScript } from '../core/figures';
import type { FigureProps } from '../core/kinds/media';
import type { Strings } from '../core/strings';
import type { AppModeId } from '@incantly/modes';
import type { ShapeRecord } from '../core/types';
import type { OverCardItem } from './painter';

// ---------------------------------------------------------------------------------------------------------------
// B26: one card

type CardState = 'picture' | 'mounting' | 'live' | 'moving' | 'saving' | 'failed' | 'dead' | 'gone';
type CardEvent = 'claim' | 'mounted' | 'move' | 'settle' | 'release' | 'unmounted' | 'fail' | 'giveUp' | 'revive' | 'remove';

export const CARD_MACHINE: MachineTable<CardState, CardEvent> = {
  picture: { claim: 'mounting', remove: 'gone' },
  mounting: { claim: 'mounting', mounted: 'live', release: 'picture', unmounted: 'picture', fail: 'failed', giveUp: 'dead', remove: 'gone' },
  live: { claim: 'live', move: 'moving', release: 'saving', unmounted: 'picture', remove: 'gone' },
  moving: { claim: 'moving', settle: 'live', release: 'saving', unmounted: 'picture', remove: 'gone' },
  saving: { claim: 'live', unmounted: 'picture', remove: 'gone' },
  failed: { claim: 'mounting', revive: 'picture', remove: 'gone' },
  dead: { revive: 'picture', remove: 'gone' },
  gone: {},
};

// ---------------------------------------------------------------------------------------------------------------
// B27: who has the input

type InputState = 'board' | 'input';
type InputEvent = 'give' | 'release';

export const INPUT_MACHINE: MachineTable<InputState, InputEvent> = {
  board: { give: 'input' },
  input: { release: 'board' },
};

// ---------------------------------------------------------------------------------------------------------------
// B28: the camera's motion as the cards see it

type MotionState = 'still' | 'moving';
type MotionEvent = 'moved' | 'settle';

export const MOTION_MACHINE: MachineTable<MotionState, MotionEvent> = {
  still: { moved: 'moving' },
  moving: { moved: 'moving', settle: 'still' },
};

/** At most this many cards hold an app at once (design 8). */
export const LIVE_CARDS = 3;
/** A picture over this many characters is not stored: it is a cache, not part of the document. */
export const PICTURE_LIMIT = 256 * 1024;
/** The picture of a card is made this long after it first paints, so the app has drawn. */
const PICTURE_DELAY_MS = 500;
/** The app inside a card is laid out at the zoom between these, and the rest is a CSS scale. */
const HOST_SCALE_MIN = 0.5;
const HOST_SCALE_MAX = 3;

const MODES: readonly string[] = (MODE_IDS as readonly string[]).filter((m) => m !== 'notes');
const MODE_LABELS: Readonly<Record<string, string>> = {
  figure: 'Figure', graphing: 'Graphing', geometry: 'Geometry', classic: 'Classic', scientific: 'Scientific', probability: 'Probability', cas: 'CAS', graphing3d: '3D',
};

const base64 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** The picture of an app as a data URL (SVG, PNG for 3D), or undefined when it cannot be made or is too big. Never throws. */
async function pictureOf(app: App, mode: string, width: number, height: number): Promise<string | undefined> {
  try {
    const png = mode === 'graphing3d';
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const r = await app.export(png ? { format: 'png', width: w, height: h, view: '3d' } : { format: 'svg', width: w, height: h });
    if (!r.ok) return undefined;
    const url = png
      ? `data:image/png;base64,${base64(new Uint8Array(await r.blob.arrayBuffer()))}`
      : `data:image/svg+xml;base64,${base64(new TextEncoder().encode(r.text ?? (await r.blob.text())))}`;
    return url.length <= PICTURE_LIMIT ? url : undefined;
  } catch {
    return undefined;
  }
}

const safe = <T>(fn: () => T): T | undefined => {
  try {
    return fn();
  } catch {
    return undefined;
  }
};

type Shape = ShapeRecord<'figure', FigureProps>;

/** What a card needs from its layer. */
interface CardHome {
  readonly doc: Document;
  readonly scheduler: SchedulerHost;
  readonly strings: Strings;
  /** True while another card may hold an app. */
  hasRoom(me: FigureCard): boolean;
  /** Saves the least recently used card that is not live, until `me` fits; false when every one is live. */
  makeRoom(me: FigureCard): boolean;
  report(error: BoardError): void;
  /** The zoom the host of a new app is laid out for. */
  hostScale(): number;
  changed(): void;
  /** Gives the board its keys back. */
  focusBoard(): void;
  /** True while the camera is moving (B28). */
  isMoving(): boolean;
  readonly core: BoardCore;
}

/** A figure card: one figure shape of the current page, its slot over the canvas, and its app while it holds one. */
export class FigureCard {
  readonly id: string;
  readonly slot: HTMLElement;
  readonly hostEl: HTMLElement;
  readonly picEl: HTMLImageElement;
  readonly badge: HTMLElement;
  /** The card's lifecycle; every change goes through `CARD_MACHINE`. */
  readonly life = new StateMachine(CARD_MACHINE, 'picture', refusedMove('figure card', () => this.#home.report));
  /** Who has the input (B27). */
  readonly input = new StateMachine(INPUT_MACHINE, 'board', refusedMove('card input', () => this.#home.report));
  shape: Shape;
  /** The zoom the host is laid out for (CSS pixels of the host for each page unit). */
  hostScale = 1;
  /** Marks that do not depend on each other. */
  readonly facts = { pictureAsked: false, inputAsked: false, pictureDue: false };
  /** The lines of the script that did not apply the last time it was loaded. */
  problems = 0;
  #app: MountedApp | undefined;
  #chain: Promise<void> = Promise.resolve();
  #failures = 0;
  #lastFailSeq = -1;
  #orderSeq = 0;
  /** The reader's lines while the app is gone, and the script they came from. */
  #saved: { readonly script: string; readonly readerScript: string } | undefined;
  /** The script the app holds. */
  #applied = '';
  #appliedMode = '';
  #offApp: (() => void)[] = [];
  #pictureTimer = 0;
  #watch: MutationObserver | undefined;
  /** The host scale the graph was last drawn at. Board zoom updates it and the pixels per unit together, so the maths window stays. */
  #laidScale = 0;
  readonly #home: CardHome;

  constructor(shape: Shape, home: CardHome) {
    this.id = shape.id;
    this.shape = shape;
    this.#home = home;
    const doc = home.doc;
    this.slot = doc.createElement('div');
    this.slot.className = 'ib-card';
    this.slot.dataset['figure'] = shape.id;
    this.slot.setAttribute('role', 'group');
    this.picEl = doc.createElement('img');
    this.picEl.className = 'ib-card-pic';
    this.picEl.alt = '';
    this.picEl.draggable = false;
    this.picEl.hidden = true;
    this.hostEl = doc.createElement('div');
    this.hostEl.className = 'ib-card-host';
    this.hostEl.hidden = true;
    this.badge = doc.createElement('div');
    this.badge.className = 'ib-card-badge';
    this.badge.hidden = true;
    this.slot.append(this.picEl, this.hostEl, this.badge);
    // while a card has the input, nothing it receives reaches the board
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel', 'keydown', 'keyup', 'contextmenu', 'dblclick'] as const) {
      this.slot.addEventListener(type, (e) => e.stopPropagation());
    }
    this.slot.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.releaseInput();
        home.focusBoard();
        home.core.selection.set([this.id]);
      }
    });
    // a lost graphics context does not bubble: the capture phase of the host sees it from the app's canvas
    this.hostEl.addEventListener('webglcontextlost', () => this.#lost(), true);
    // an app destroyed from outside takes its element out of the host
    if (typeof MutationObserver === 'function') {
      this.#watch = new MutationObserver(() => {
        if (this.#app?.destroyed === true) this.#lost();
      });
      this.#watch.observe(this.hostEl, { childList: true });
    }
    this.#home.scheduler.register(this.id);
    this.render();
  }

  /** True while the card holds, or is about to hold, an app. */
  get wantsMount(): boolean {
    return this.life.is('mounting', 'live', 'moving');
  }

  get app(): MountedApp | undefined {
    return this.#app;
  }

  get hasInput(): boolean {
    return this.input.is('input');
  }

  get mode(): string {
    return sdkMode(this.shape.props.mode);
  }

  // ---- the scheduler's orders

  build(): void {
    if (this.life.is('gone', 'dead') || this.#failures > 0 || this.#app !== undefined || this.wantsMount) return;
    if (!this.#home.hasRoom(this)) return;
    this.#claim();
  }

  goLive(): void {
    if (this.life.is('gone', 'dead')) return;
    const seq = ++this.#orderSeq;
    if (this.#app === undefined && !this.wantsMount) {
      // no place, no claim: the card stays a picture and the scheduler's next order decides
      if (!this.#home.makeRoom(this)) return;
      this.#claim(seq);
    } else this.life.send('claim');
  }

  restore(): void {
    this.goLive();
  }

  pause(): void {
    safe(() => this.#app?.clock.pause());
    this.#home.scheduler.setPlaying(this.id, false);
  }

  save(): void {
    if (!this.wantsMount) return;
    this.releaseInput();
    this.life.send('release');
    this.#queue(() => this.#doSave());
  }

  #claim(seq = Number.POSITIVE_INFINITY): void {
    if (!this.life.send('claim')) return;
    this.render();
    this.#queue(() => this.#doMount(seq));
  }

  // ---- the camera

  /** The camera started to move: show the picture instead of the app. */
  move(): void {
    if (!sendIfAble(this.life, 'move')) return;
    this.slot.dataset['state'] = this.life.state;
    // a calculator or a probability panel has no graph picture that should cover it
    if (this.mode === 'scientific' || this.mode === 'probability') return;
    const snap = this.mode === 'graphing3d' ? undefined : this.#snapshot();
    const url = snap ?? this.shape.props.picture ?? undefined;
    if (url !== undefined) {
      this.picEl.src = url;
      this.picEl.hidden = false;
      this.hostEl.style.visibility = 'hidden';
    }
  }

  /** The camera stopped: the host is sized for the zoom again, and the app shows. The paint waits until the slot has that size. */
  settle(scale: number): void {
    if (!sendIfAble(this.life, 'settle')) return;
    this.hostScale = scale;
    this.hostEl.style.visibility = '';
    this.picEl.hidden = this.shape.props.picture === null;
    if (this.shape.props.picture !== null) this.picEl.src = this.shape.props.picture;
    this.render();
  }

  /**
   * The slot's layout size now matches `hostScale`. When that size change resizes the graph's canvas, the pixels per
   * unit follow it, so a board zoom does not zoom the maths. Resizing the card does not change `hostScale`, so it still
   * shows more of the graph.
   */
  keepMathsWindow(): void {
    const next = this.hostScale;
    const laid = this.#laidScale;
    if (laid === next) return;
    if (this.mode === 'scientific' || this.mode === 'probability') {
      this.#laidScale = next;
      return;
    }
    const app = this.#app;
    if (!(laid > 0) || app === undefined) {
      this.#laidScale = next;
      return;
    }
    const vp = app.screen.graph.viewport;
    const beforeW = vp.w;
    const beforeH = vp.h;
    const beforePpu = vp.ppu;
    const beforePpuY = vp.ppuY;
    safe(() => app.screen.paint());
    this.#laidScale = next;
    if (this.mode === 'graphing3d' || beforeW <= 1 || beforeH <= 1) return;
    const sx = vp.w / beforeW;
    const sy = vp.h / beforeH;
    if (Math.abs(sx - 1) < 1e-3 && Math.abs(sy - 1) < 1e-3) return;
    vp.ppu = beforePpu * sx;
    vp.ppuY = beforePpuY * sy;
    safe(() => app.screen.paint());
  }

  #snapshot(): string | undefined {
    const canvas = this.hostEl.querySelector('canvas');
    if (canvas === null) return undefined;
    const url = safe(() => canvas.toDataURL('image/png'));
    return url !== undefined && url.length > 64 ? url : undefined;
  }

  // ---- the input

  giveInput(): boolean {
    if (!this.life.is('live')) {
      this.facts.inputAsked = true;
      this.goLive();
      return false;
    }
    if (!this.input.send('give')) return true;
    this.facts.inputAsked = false;
    this.#home.scheduler.touch(this.id);
    this.slot.style.pointerEvents = 'auto';
    this.slot.classList.add('ib-card-input');
    this.hostEl.tabIndex = -1;
    this.hostEl.focus({ preventScroll: true });
    this.#home.changed();
    return true;
  }

  releaseInput(): void {
    this.facts.inputAsked = false;
    if (!sendIfAble(this.input, 'release')) return;
    this.slot.style.pointerEvents = '';
    this.slot.classList.remove('ib-card-input');
    this.#home.changed();
  }

  // ---- what the shape says

  /** The shape changed (a script from outside, a mode, a size, a picture). */
  update(next: Shape): void {
    const before = this.shape.props;
    this.shape = next;
    const p = next.props;
    if (this.life.is('gone')) return;
    if (p.mode !== before.mode || p.script !== before.script) {
      this.facts.pictureAsked = false;
      if (this.life.is('failed', 'dead')) {
        this.#failures = 0;
        this.life.send('revive');
        this.badge.hidden = true;
        this.#home.scheduler.register(this.id);
      }
    }
    if (p.mode !== before.mode) {
      this.#saved = undefined;
      if (this.#app !== undefined) {
        this.#unmount();
        if (this.#wanted()) this.#claim();
      }
    } else if (p.script !== before.script) {
      if (this.#saved !== undefined && this.#saved.script !== p.script) this.#saved = undefined;
      if (this.#app !== undefined && this.life.is('live', 'moving')) this.#applyScript();
    }
    if (p.picture !== before.picture) this.render();
  }

  #wanted(): boolean {
    const rec = this.#home.scheduler.state.figures.get(this.id);
    return rec?.state === 'live' || rec?.state === 'ready' || rec?.state === 'paused';
  }

  #applyScript(): void {
    const app = this.#app;
    if (app === undefined || app.destroyed) return;
    const script = this.shape.props.script;
    const r = safe(() => app.loadScript(script));
    this.#applied = script;
    this.problems = r?.failed.length ?? 0;
    this.#showProblems(r?.failed.map((f) => ({ line: f.line, message: f.message })) ?? []);
    this.#schedulePicture();
  }

  #showProblems(failed: readonly { readonly line: number; readonly message: string }[]): void {
    if (failed.length === 0) {
      this.badge.hidden = true;
      return;
    }
    this.badge.hidden = false;
    this.badge.textContent = this.#home.strings.t('card.linesFailed', undefined, { n: failed.length });
    this.#home.report(
      boardError('figure_failed', `${failed.length} line${failed.length === 1 ? '' : 's'} of the figure did not apply.`, {
        hint: 'Open the lines of the card to see them.',
        detail: { record: this.id, lines: failed.map((f) => ({ line: f.line, message: f.message })) },
      }),
    );
  }

  /** The script as the app has it now (for the lines panel); the shape's own script when no app is there. */
  lines(): string {
    return this.shape.props.script;
  }

  // ---- mount, save, unmount

  #queue(fn: () => Promise<void> | void): void {
    this.#chain = this.#chain.then(fn).catch(() => undefined);
  }

  async #doMount(seq: number): Promise<void> {
    if (this.life.is('gone', 'dead') || this.#app !== undefined || !this.wantsMount) return;
    if (this.#failures > 0 && seq <= this.#lastFailSeq) return;
    const first = this.shape.props;
    const mode = sdkMode(first.mode);
    if (!MODES.includes(mode)) {
      this.#mountFailed(`"${first.mode}" is not a mode`);
      return;
    }
    this.hostScale = this.#home.hostScale();
    this.render();
    this.hostEl.hidden = false;
    let app: MountedApp;
    try {
      app = await createApp({
        container: this.hostEl,
        mode: mode as AppModeId,
        size: { width: 'fill', height: 'fill' },
        ui: { menu: false, undoRedo: false, fileFeatures: false, resetButton: false, zoomButtons: false, panAndZoom: true, dragPoints: true, clockBar: false, borderColor: 'none' },
      });
    } catch (e) {
      this.hostEl.replaceChildren();
      this.hostEl.hidden = true;
      // released while the app was being made: nobody wants it, so the failure is not the card's
      if (this.wantsMount) this.#mountFailed(e instanceof Error ? e.message : 'the browser refused');
      return;
    }
    if (this.life.is('gone') || !this.wantsMount) {
      safe(() => app.destroy());
      this.hostEl.replaceChildren();
      this.hostEl.hidden = true;
      return;
    }
    if (sdkMode(this.shape.props.mode) !== mode) {
      // the mode changed while the app was being made: start again in the new one
      safe(() => app.destroy());
      this.hostEl.replaceChildren();
      this.#queue(() => this.#doMount(seq));
      return;
    }
    this.#app = app;
    this.#appliedMode = mode;
    try {
      this.#loadInto(app);
      this.#follow(app);
      app.screen.paint();
    } catch (e) {
      // `fail` goes first, while the card is still `mounting`; then the app is freed
      this.#mountFailed(e instanceof Error ? e.message : 'the script could not be loaded');
      this.#freeApp();
      return;
    }
    this.#failures = 0;
    this.life.send('mounted');
    this.#home.scheduler.noteMounted(this.id);
    this.#home.scheduler.noteFirstDraw(this.id);
    this.render();
    if (this.#home.isMoving()) this.move();
    this.#schedulePicture();
    if (this.facts.inputAsked) this.giveInput();
    this.#home.changed();
  }

  #loadInto(app: MountedApp): void {
    const script = this.shape.props.script;
    let text = script;
    let fromSaved = false;
    if (this.#saved !== undefined) {
      if (this.#saved.script === script) {
        text = this.#saved.readerScript;
        fromSaved = true;
      }
      this.#saved = undefined;
    }
    const r = app.loadScript(text);
    this.#applied = script;
    if (!fromSaved) {
      this.problems = r.failed.length;
      this.#showProblems(r.failed.map((f) => ({ line: f.line, message: f.message })));
    }
  }

  #follow(app: MountedApp): void {
    this.#offApp.push(
      app.on('play', () => {
        this.#home.scheduler.setPlaying(this.id, true);
        this.#home.changed();
      }),
      app.on('pause', () => {
        this.#home.scheduler.setPlaying(this.id, false);
        this.#home.changed();
      }),
    );
  }

  #mountFailed(why: string): void {
    this.#failures++;
    this.#lastFailSeq = this.#orderSeq;
    this.life.send(this.#failures >= 2 ? 'giveUp' : 'fail');
    this.badge.hidden = false;
    this.badge.textContent = this.#home.strings.t('card.failed');
    this.#home.report(
      boardError('figure_failed', `The live figure could not be created: ${why}.`, {
        hint: 'The picture is shown instead. The card is tried once more the next time it comes into view.',
        detail: { record: this.id },
      }),
    );
    if (this.life.is('dead')) this.#home.scheduler.unregister(this.id);
    this.render();
  }

  async #doSave(): Promise<void> {
    const app = this.#app;
    if (app === undefined || this.life.is('gone') || this.wantsMount) return;
    const mode = this.#appliedMode;
    const readerScript = safe(() => app.toScript()) ?? '';
    this.#saved = { script: this.#applied, readerScript };
    const props = this.shape.props;
    const picture = await pictureOf(app, mode, props.w, props.h);
    // wanted again while the picture was made: keep it as it is
    if (this.wantsMount || this.life.is('gone') || this.#app !== app) {
      if (this.wantsMount) this.#saved = undefined;
      return;
    }
    this.#unmount();
    // the script or mode changed while the picture was made: that picture shows the old figure
    const now = this.shape.props;
    const same = now.script === props.script && sdkMode(now.mode) === mode;
    if (picture !== undefined && same) setFigurePicture(this.#home.core, this.id, picture);
    this.#home.changed();
  }

  /** Frees the app and its host; the card's own state is the caller's to move. */
  #freeApp(): void {
    const app = this.#app;
    window.clearTimeout(this.#pictureTimer);
    this.facts.pictureDue = false;
    for (const off of this.#offApp) off();
    this.#offApp = [];
    this.#app = undefined;
    this.releaseInput();
    if (app !== undefined) safe(() => app.destroy());
    this.hostEl.replaceChildren();
    this.hostEl.hidden = true;
    this.hostEl.style.visibility = '';
    this.render();
  }

  #unmount(): void {
    this.life.send('unmounted');
    this.#freeApp();
    this.badge.hidden = true;
    this.render();
  }

  /** The app is lost (the graphics context went, or something destroyed it): free it, and ask again when the scheduler still wants the card. */
  #lost(): void {
    if (this.#app === undefined || !this.life.is('live', 'moving', 'saving')) return;
    this.#unmount();
    if (this.#wanted() && this.#home.hasRoom(this)) this.#claim();
  }

  /** Makes the card's picture 500 ms after the app last drew, when the card has none or the script changed. */
  #schedulePicture(): void {
    if (this.shape.props.picture !== null || this.facts.pictureDue) return;
    this.facts.pictureDue = true;
    window.clearTimeout(this.#pictureTimer);
    this.#pictureTimer = window.setTimeout(() => {
      this.facts.pictureDue = false;
      const app = this.#app;
      if (app === undefined || app.destroyed || !this.life.is('live', 'moving')) return;
      const props = this.shape.props;
      const mode = this.#appliedMode;
      void pictureOf(app, mode, props.w, props.h).then((url) => {
        if (url === undefined || this.life.is('gone') || this.shape.props.script !== props.script) return;
        setFigurePicture(this.#home.core, this.id, url);
      });
    }, PICTURE_DELAY_MS);
  }

  /** Picks what the slot shows from the card's state and the shape's picture. */
  render(): void {
    const p = this.shape.props;
    const shows = this.#app !== undefined && this.life.is('live', 'moving', 'saving');
    this.hostEl.hidden = !shows && !this.life.is('mounting');
    if (this.life.is('moving')) {
      // `move` chose the picture; it stays until the camera settles
    } else if (this.life.is('live') || p.picture === null) {
      this.picEl.hidden = true;
    } else {
      if (this.picEl.getAttribute('src') !== p.picture) this.picEl.src = p.picture;
      this.picEl.hidden = false;
    }
    this.slot.dataset['state'] = this.life.state;
    this.slot.setAttribute('aria-label', this.#home.strings.t('card.label', undefined, { mode: MODE_LABELS[this.mode] ?? this.mode }));
  }

  // ---- gone

  destroy(): void {
    if (this.life.is('gone')) return;
    window.clearTimeout(this.#pictureTimer);
    this.#watch?.disconnect();
    this.releaseInput();
    this.life.send('remove');
    const app = this.#app;
    this.#app = undefined;
    for (const off of this.#offApp) off();
    this.#offApp = [];
    if (app !== undefined) safe(() => app.destroy());
    this.#home.scheduler.unregister(this.id);
    this.slot.remove();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// what is drawn over the cards (BR-55)

/** Nothing is over a card: the one empty list every such frame is given. */
const NO_OVER_CARDS: readonly OverCardItem[] = Object.freeze([]);

/**
 * The draw items of the shapes above the shown `cards`, each with the card outlines it shows inside, at `scale` device pixels
 * per page unit. The shapes a gesture holds are left out: the overlay draws them over everything while they move (BR-82).
 */
export function overCardItems(core: BoardCore, cards: readonly ShapeRecord[], scale: number): readonly OverCardItem[] {
  if (cards.length === 0) return NO_OVER_CARDS;
  const out: OverCardItem[] = [];
  const held = core.lift.held;
  for (const over of shapesOverCards(core, cards)) {
    if (held.has(over.shape.id)) continue;
    const item = core.drawList.itemOf(over.shape, scale);
    if (item !== undefined) out.push({ item, clip: over.clip });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// the layer

export interface FigureLayerOptions {
  readonly core: BoardCore;
  readonly doc: Document;
  /** Where the card toolbar and the lines panel go: the board's root element. */
  readonly bars: HTMLElement;
  readonly strings: Strings;
  /** A reader may use a card (drag, play) but not change its script, mode or existence. */
  readonly readOnly: boolean;
  readonly onError: (error: BoardError) => void;
  /** Asks for a frame. */
  readonly requestFrame: () => void;
  /** Where the board's keys come back to when a card gives the input back. */
  readonly focusBoard: () => void;
}

export class FigureLayer {
  readonly element: HTMLElement;
  readonly scheduler: SchedulerHost;
  readonly cards = new Map<string, FigureCard>();
  readonly motion = new StateMachine(MOTION_MACHINE, 'still', refusedMove('card motion', () => this.#opts.onError));
  readonly #core: BoardCore;
  readonly #opts: FigureLayerOptions;
  readonly #home: CardHome;
  readonly #stop: () => void;
  readonly #bar: CardBar;
  /** The page whose cards these are. */
  #page = '';
  /** Marks that do not depend on each other. */
  readonly #marks = { stale: true, started: false, disposed: false };
  readonly #last = { x: Number.NaN, y: Number.NaN, zoom: Number.NaN, at: 0 };
  #visible = new Set<string>();
  #near = new Set<string>();
  /** The shapes of the cards whose slot is on show this frame: each one hides what the tiles draw under it. */
  readonly #covering: Shape[] = [];
  /** A headless picture job for cards that have never been live, one at a time. */
  #jobs: Promise<void> = Promise.resolve();

  constructor(options: FigureLayerOptions) {
    this.#opts = options;
    this.#core = options.core;
    this.element = options.doc.createElement('div');
    this.element.className = 'ib-figures';
    this.element.dataset['figureLayer'] = '';
    this.scheduler = new SchedulerHost({ ...DEFAULT_SCHEDULER_CONFIG, maxLive: LIVE_CARDS }, { onAction: (a) => this.#route(a) });
    this.#home = {
      doc: options.doc,
      scheduler: this.scheduler,
      strings: options.strings,
      core: options.core,
      hasRoom: (me) => this.#mountedCount(me) < LIVE_CARDS,
      makeRoom: (me) => this.#makeRoom(me),
      report: (e) => options.onError(e),
      hostScale: () => this.#hostScale(),
      changed: () => options.requestFrame(),
      focusBoard: () => options.focusBoard(),
      isMoving: () => this.motion.is('moving'),
    };
    this.#bar = new CardBar(this, options);
    options.bars.addEventListener('pointerdown', this.#onPress, true);
    this.#stop = options.core.store.on((diff) => {
      const touched = (s: unknown): boolean => typeof s === 'object' && s !== null && (s as { kind?: unknown }).kind === 'figure';
      if (diff.added.some(touched) || diff.removed.some(touched) || diff.updated.some((u) => touched(u.after))) {
        this.#marks.stale = true;
        options.requestFrame();
      }
    });
  }

  /** Cards that hold an app now, and the ones the scheduler has promoted. */
  get liveCount(): number {
    return this.#mountedCount();
  }

  /** The shapes of the cards that cover the board this frame (their slot is shown: live or picture), in the store's order. */
  get covering(): readonly Shape[] {
    return this.#covering;
  }

  /** The id of the card that has the input, or undefined: it is the card whose own machine says so. */
  get inputId(): string | undefined {
    for (const card of this.cards.values()) if (card.hasInput) return card.id;
    return undefined;
  }

  // ---- called by the board

  /** True when the shape is a figure card and it was given the input (or will be, when it goes live). */
  activate(id: string): boolean {
    if (this.#core.pages.current !== this.#page) this.#changePage();
    if (this.#marks.stale) this.#reconcile();
    const card = this.cards.get(id);
    if (card === undefined) return false;
    const holder = this.inputId;
    if (holder !== undefined && holder !== id) this.cards.get(holder)?.releaseInput();
    card.giveInput();
    return true;
  }

  /** Takes the input back from the card that has it. */
  releaseInput(): void {
    const id = this.inputId;
    if (id === undefined) return;
    this.cards.get(id)?.releaseInput();
    this.#opts.focusBoard();
  }

  /** A press on the board outside the card that has the input gives the input back (B27). */
  readonly #onPress = (e: Event): void => {
    const id = this.inputId;
    if (id === undefined) return;
    const target = e.target as Node;
    if (this.cards.get(id)?.slot.contains(target) === true || this.#bar.contains(target)) return;
    this.releaseInput();
  };

  /**
   * Called every frame: brings the cards in line with the shapes, tells them the camera moves or stopped (B28), places the
   * slots, tells the scheduler which are in view. True while frames are still needed (the camera has not settled).
   */
  sync(camera: CameraView, width: number, height: number, now: number): boolean {
    if (this.#marks.disposed) return false;
    if (this.#core.pages.current !== this.#page) this.#changePage();
    if (this.#marks.stale) this.#reconcile();
    // written by index and cut to its count each frame (`no-length-reset`, BR-77)
    let covered = 0;
    if (this.cards.size === 0) {
      this.#covering.length = 0;
      this.#bar.sync(undefined, camera, width, height);
      return false;
    }
    this.#notice(camera, now);
    const near = DEFAULT_SCHEDULER_CONFIG.nearPx;
    const visible = new Set<string>();
    const nearSet = new Set<string>();
    for (const card of this.cards.values()) {
      const s = card.shape;
      const x = (s.x - camera.x) * camera.zoom;
      const y = (s.y - camera.y) * camera.zoom;
      const w = s.props.w * camera.zoom;
      const h = s.props.h * camera.zoom;
      const inView = x + w > 0 && y + h > 0 && x < width && y < height;
      const isNear = x + w > -near && y + h > -near && x < width + near && y < height + near;
      if (inView) visible.add(card.id);
      if (isNear || inView) nearSet.add(card.id);
      card.slot.style.display = isNear || inView ? '' : 'none';
      if (isNear || inView) {
        this.#place(card, camera, x, y);
        this.#covering[covered++] = s;
      }
    }
    this.#covering.length = covered;
    this.#publish(visible, nearSet);
    this.#bar.sync(this.#activeCard(), camera, width, height);
    this.#askForPictures(nearSet);
    return this.motion.is('moving');
  }

  /** The camera's motion (B28): a change since the last frame is `moved`; 150 ms of none is `settle`. */
  #notice(camera: CameraView, now: number): void {
    const last = this.#last;
    const changed = camera.x !== last.x || camera.y !== last.y || camera.zoom !== last.zoom;
    if (changed) {
      const first = Number.isNaN(last.x);
      last.x = camera.x;
      last.y = camera.y;
      last.zoom = camera.zoom;
      last.at = now;
      if (first) return;
      const was = this.motion.state;
      this.motion.send('moved');
      this.scheduler.noteScroll();
      if (was === 'still') for (const card of this.cards.values()) card.move();
      return;
    }
    if (this.motion.is('moving') && now - last.at >= STEADY_DELAY_MS) {
      this.motion.send('settle');
      const scale = this.#hostScale();
      for (const card of this.cards.values()) card.settle(scale);
    }
  }

  #hostScale(): number {
    const z = this.#last.zoom;
    return Number.isFinite(z) ? Math.min(HOST_SCALE_MAX, Math.max(HOST_SCALE_MIN, z)) : 1;
  }

  /** Puts a card's slot at its place: the shape's page position and turn, scaled from the host's layout to the screen. */
  #place(card: FigureCard, camera: CameraView, sx: number, sy: number): void {
    const s = card.hostScale;
    const props = card.shape.props;
    const w = props.w * s;
    const h = props.h * s;
    const k = camera.zoom / s;
    const st = card.slot.style;
    const width = `${w}px`;
    const height = `${h}px`;
    if (st.width !== width) st.width = width;
    if (st.height !== height) st.height = height;
    const rot = card.shape.rotation;
    st.transform = `translate(${sx}px,${sy}px) scale(${k})${rot === 0 ? '' : ` translate(${w / 2}px,${h / 2}px) rotate(${rot}rad) translate(${-w / 2}px,${-h / 2}px)`}`;
    card.keepMathsWindow();
  }

  #publish(visible: Set<string>, near: Set<string>): void {
    const same = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size === b.size && [...a].every((id) => b.has(id));
    if (same(visible, this.#visible) && same(near, this.#near)) return;
    this.#visible = visible;
    this.#near = near;
    this.scheduler.setVisible(visible);
    this.scheduler.setNear(near);
    if (!this.#marks.started) {
      this.#marks.started = true;
      this.scheduler.start();
    }
    this.scheduler.tick();
  }

  #activeCard(): FigureCard | undefined {
    const held = this.inputId;
    if (held !== undefined) return this.cards.get(held);
    const ids = this.#core.selection.ids;
    if (ids.length !== 1) return undefined;
    return this.cards.get(ids[0] as string);
  }

  // ---- cards and the page

  #changePage(): void {
    for (const card of this.cards.values()) card.destroy();
    this.cards.clear();
    this.#visible = new Set();
    this.#near = new Set();
    this.#page = this.#core.pages.current ?? '';
    sendIfAble(this.motion, 'settle');
    this.#last.x = Number.NaN;
    this.#marks.stale = true;
  }

  #reconcile(): void {
    this.#marks.stale = false;
    const shapes = figuresOnPage(this.#core);
    const seen = new Set<string>();
    for (const shape of shapes) {
      seen.add(shape.id);
      const known = this.cards.get(shape.id);
      if (known === undefined) {
        const card = new FigureCard(shape, this.#home);
        card.hostScale = this.#hostScale();
        this.cards.set(shape.id, card);
        this.element.append(card.slot);
      } else if (known.shape !== shape) {
        known.update(shape);
      }
    }
    for (const [id, card] of this.cards) {
      if (seen.has(id)) continue;
      card.destroy();
      this.cards.delete(id);
    }
    // the stack order of the cards is the shapes' own
    shapes.forEach((shape, i) => {
      const card = this.cards.get(shape.id);
      if (card !== undefined && card.slot.style.zIndex !== String(i)) card.slot.style.zIndex = String(i);
    });
  }

  #mountedCount(except?: FigureCard): number {
    if (this.cards.size === 0) return 0;
    let n = 0;
    for (const card of this.cards.values()) if (card !== except && card.wantsMount) n++;
    return n;
  }

  /** Makes room for `me`: while the cap is reached, the least recently used card that is not live saves and frees its app. */
  #makeRoom(me: FigureCard): boolean {
    for (let guard = 0; guard < this.cards.size + 1; guard++) {
      if (this.#mountedCount(me) < LIVE_CARDS) return true;
      let victim: FigureCard | undefined;
      let used = Number.POSITIVE_INFINITY;
      for (const card of this.cards.values()) {
        if (card === me || !card.wantsMount || card.hasInput) continue;
        const rec = this.scheduler.state.figures.get(card.id);
        if (rec?.state === 'live') continue;
        const t = rec?.lastUsedMs ?? 0;
        if (t < used) {
          used = t;
          victim = card;
        }
      }
      if (victim === undefined) return false;
      victim.save();
    }
    return this.#mountedCount(me) < LIVE_CARDS;
  }

  #route(action: SchedulerAction): void {
    if (this.#marks.disposed) return;
    const card = this.cards.get(action.id);
    if (card === undefined) return;
    try {
      if (action.k === 'build') card.build();
      else if (action.k === 'goLive') card.goLive();
      else if (action.k === 'pause') card.pause();
      else if (action.k === 'save') card.save();
      else card.restore();
    } catch {
      // an order a card cannot follow never stops the others
    }
  }

  /** A card that is only a picture and has none gets one made from its script in a headless app, one at a time. */
  #askForPictures(near: ReadonlySet<string>): void {
    for (const card of this.cards.values()) {
      if (!near.has(card.id) || !card.life.is('picture') || card.shape.props.picture !== null || card.facts.pictureAsked) continue;
      card.facts.pictureAsked = true;
      const props = card.shape.props;
      const mode = sdkMode(props.mode);
      if (!MODES.includes(mode)) continue;
      this.#jobs = this.#jobs.then(async () => {
        if (this.#marks.disposed || card.life.is('gone') || card.shape.props.script !== props.script) return;
        let app: App | undefined;
        try {
          app = createHeadlessApp({ mode: mode as AppModeId, script: props.script, size: { width: props.w, height: props.h } });
          const url = await pictureOf(app, mode, props.w, props.h);
          if (url !== undefined && !this.#marks.disposed && !card.life.is('gone') && card.shape.props.script === props.script && card.shape.props.picture === null) {
            setFigurePicture(this.#core, card.id, url);
          }
        } catch {
          // a picture that cannot be made leaves the placeholder
        } finally {
          if (app !== undefined) safe(() => app?.destroy());
        }
      });
    }
  }

  /** Drops every card, stops the scheduler and removes the layer. */
  dispose(): void {
    if (this.#marks.disposed) return;
    this.#marks.disposed = true;
    this.#stop();
    this.#opts.bars.removeEventListener('pointerdown', this.#onPress, true);
    for (const card of this.cards.values()) card.destroy();
    this.cards.clear();
    this.scheduler.stop();
    this.#bar.dispose();
    this.element.remove();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// the card's toolbar and lines panel

/** The toolbar over the card that is selected or has the input: edit lines, mode, play and pause, delete. */
class CardBar {
  readonly element: HTMLElement;
  readonly #layer: FigureLayer;
  readonly #opts: FigureLayerOptions;
  readonly #edit: HTMLButtonElement;
  readonly #mode: HTMLSelectElement;
  readonly #play: HTMLButtonElement;
  readonly #del: HTMLButtonElement;
  readonly #panel: HTMLElement;
  readonly #text: HTMLTextAreaElement;
  readonly #status: HTMLElement;
  /** The card the bar is for; the panel's open state is the panel's own `hidden`. */
  #shown = '';
  #at = '';

  constructor(layer: FigureLayer, options: FigureLayerOptions) {
    this.#layer = layer;
    this.#opts = options;
    const doc = options.doc;
    const s = options.strings;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, attrs: Record<string, string> = {}, text = ''): HTMLElementTagNameMap[K] => {
      const n = doc.createElement(tag);
      n.className = cls;
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      if (text !== '') n.textContent = text;
      return n;
    };
    this.element = el('div', 'ib-bar ib-cardbar', { role: 'toolbar', 'aria-label': s.t('card.label', undefined, { mode: '' }).trim() });
    this.element.hidden = true;
    this.#edit = el('button', '', { type: 'button', 'data-card': 'edit' }, s.t('card.editLines'));
    this.#mode = el('select', '', { 'aria-label': s.t('card.mode'), 'data-card': 'mode' });
    for (const m of MODES) this.#mode.append(el('option', '', { value: m }, s.t(`mode.${m}`, MODE_LABELS[m] ?? m)));
    this.#play = el('button', '', { type: 'button', 'data-card': 'play' }, s.t('card.play'));
    this.#del = el('button', '', { type: 'button', 'data-card': 'delete' }, s.t('card.delete'));
    this.element.append(this.#edit, this.#mode, this.#play, this.#del);
    this.#panel = el('div', 'ib-bar ib-cardlines', { 'aria-label': s.t('card.editLines') });
    this.#panel.hidden = true;
    this.#text = el('textarea', '', { spellcheck: 'false', 'aria-label': s.t('card.editLines'), rows: '8' });
    this.#status = el('div', 'ib-cardstatus', { role: 'status' });
    const apply = el('button', '', { type: 'button', 'data-card': 'apply' }, s.t('card.apply'));
    const close = el('button', '', { type: 'button', 'data-card': 'close' }, s.t('card.close'));
    const row = el('div', 'ib-cardrow');
    row.append(apply, close);
    this.#panel.append(this.#text, row, this.#status);
    options.bars.append(this.element, this.#panel);

    this.#edit.addEventListener('click', () => this.#toggle());
    close.addEventListener('click', () => this.#hidePanel());
    apply.addEventListener('click', () => this.#apply());
    this.#mode.addEventListener('change', () => {
      if (this.#shown !== '') setFigureMode(options.core, this.#shown, this.#mode.value);
    });
    this.#play.addEventListener('click', () => this.#playPause());
    this.#del.addEventListener('click', () => {
      const id = this.#shown;
      if (id === '' || options.readOnly) return;
      options.core.selection.clear();
      deleteShapes(options.core, [id]);
    });
    this.#text.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.#hidePanel();
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) this.#apply();
    });
    if (options.readOnly) {
      this.#edit.hidden = true;
      this.#mode.hidden = true;
      this.#del.hidden = true;
    }
  }

  #toggle(): void {
    if (this.#panel.hidden) this.#showPanel();
    else this.#hidePanel();
  }

  #showPanel(): void {
    const card = this.#layer.cards.get(this.#shown);
    if (card === undefined || this.#opts.readOnly) return;
    this.#text.value = card.lines();
    this.#status.textContent = '';
    this.#panel.hidden = false;
    this.#edit.setAttribute('aria-pressed', 'true');
    this.#text.focus({ preventScroll: true });
  }

  #hidePanel(): void {
    this.#panel.hidden = true;
    this.#edit.setAttribute('aria-pressed', 'false');
    this.#opts.focusBoard();
  }

  #apply(): void {
    const id = this.#shown;
    if (id === '' || this.#opts.readOnly) return;
    const done = setFigureScript(this.#opts.core, id, this.#text.value);
    this.#status.textContent = done.ok ? '' : done.message;
    this.#opts.requestFrame();
  }

  #playPause(): void {
    const card = this.#layer.cards.get(this.#shown);
    if (card === undefined) return;
    const app = card.app;
    if (app === undefined) {
      card.giveInput();
      return;
    }
    if (app.clock.playing) app.clock.pause();
    else app.clock.play();
    this.#opts.requestFrame();
  }

  /** Shows the bar over `card`, or hides it when there is none. Called every frame; it writes only what changed. */
  sync(card: FigureCard | undefined, camera: CameraView, width: number, height: number): void {
    if (card === undefined || card.life.is('gone')) {
      if (!this.element.hidden) this.element.hidden = true;
      if (!this.#panel.hidden) this.#hidePanel();
      this.#shown = '';
      return;
    }
    if (this.#shown !== card.id) {
      if (!this.#panel.hidden) this.#hidePanel();
      this.#shown = card.id;
    }
    this.element.hidden = false;
    const s = card.shape;
    const x = (s.x - camera.x) * camera.zoom;
    const y = (s.y - camera.y) * camera.zoom;
    const h = s.props.h * camera.zoom;
    const left = Math.max(8, Math.min(width - 280, x));
    const top = y - 44 < 8 ? Math.min(height - 44, y + 8) : y - 44;
    const at = `${Math.round(left)},${Math.round(top)}`;
    if (at !== this.#at) {
      this.#at = at;
      this.element.style.left = `${Math.round(left)}px`;
      this.element.style.top = `${Math.round(top)}px`;
      this.#panel.style.left = `${Math.round(Math.max(8, Math.min(width - 360, x)))}px`;
      this.#panel.style.top = `${Math.round(Math.min(height - 230, y + h + 8))}px`;
    }
    const mode = card.mode;
    if (this.#mode.value !== mode) this.#mode.value = mode;
    const playing = card.app?.clock.playing === true;
    const label = this.#opts.strings.t(playing ? 'card.pause' : 'card.play');
    if (this.#play.textContent !== label) this.#play.textContent = label;
  }

  /** True when the node is inside the bar or its lines panel. */
  contains(node: Node): boolean {
    return this.element.contains(node) || this.#panel.contains(node);
  }

  dispose(): void {
    this.element.remove();
    this.#panel.remove();
  }
}
