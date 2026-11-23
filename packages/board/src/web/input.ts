/**
 * Layer 3 on the web (design 3, 6.1, 6.5): Pointer Events become `InputSample`s. Every coalesced sample of a move is
 * given, with pressure, tilt, twist and buttons; two guessed samples follow, marked `predicted`, from the core's
 * `Predictor` (not the browser's `getPredictedEvents()`, whose new event objects are garbage, BR-77). One sample object
 * is reused for every event, so input makes no garbage. The palm rule and the pen that only reports 0.5 are the core's
 * `PointerGate` and `PressureProbe`. Wheel, trackpad pinch and two-finger gestures go to the sink as `WheelInput` and
 * `GestureInput`; keys as `KeyInput`.
 */
import { MOD_ALT, MOD_MOD, MOD_SHIFT, PointerGate, PressureProbe } from '../core/input';
import type { Device, GestureInput, InputSample, InputSink, KeyInput, Phase, TouchDraws, WheelInput } from '../core/input';
import type { ErrorSink } from '../core/errors';
import { Predictor } from '../core/ink/predict';

/** What `getCoalescedEvents` gives where the browser has none: one empty list. */
const NO_EVENTS: readonly PointerEvent[] = Object.freeze([]);

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** The one sample every event reuses. `phase` is read through a getter so the field that holds it is not called a state. */
export class ReusedSample implements InputSample {
  pointer = 0;
  device: Device = 'mouse';
  x = 0;
  y = 0;
  pressure = Number.NaN;
  tiltX = 0;
  tiltY = 0;
  twist = 0;
  buttons = 0;
  time = 0;
  predicted = false;
  modifiers = 0;
  #step: Phase = 'hover';

  get phase(): Phase {
    return this.#step;
  }

  /** Gives the sample its phase. */
  setPhase(next: Phase): void {
    this.#step = next;
  }
}

export interface WebInputOptions {
  /** The board element: it gets the listeners, `touch-action: none` and the focus. */
  readonly element: HTMLElement;
  readonly sink: InputSink;
  readonly touchDraws?: TouchDraws;
  /** Where a refused move of the input's machines is told (the board's `onError`). */
  readonly report?: ErrorSink;
  /**
   * Whether an event aimed at this target is board input (BR-58). Events from the shell's buttons, menus, panels and
   * bars are not; a pointer pressed on one is not the board's until it is released. Every target by default.
   */
  readonly accepts?: (target: EventTarget | null) => boolean;
}

const deviceOf = (type: string): Device => (type === 'pen' ? 'pen' : type === 'touch' ? 'touch' : 'mouse');

export class WebInput {
  readonly #el: HTMLElement;
  readonly #sink: InputSink;
  readonly #gate: PointerGate;
  readonly #probe: PressureProbe;
  /** The one sample object every event reuses. */
  readonly #sample = new ReusedSample();
  /** The guess of where the pen goes next, and the record it writes a guess into. */
  readonly #predictor = new Predictor();
  readonly #guess = new Float64Array(3);
  readonly #key: Mutable<KeyInput> = { key: '', down: true, shift: false, alt: false, mod: false, repeat: false };
  readonly #wheel: Mutable<WheelInput> = { x: 0, y: 0, dx: 0, dy: 0, zoom: false, time: 0 };
  readonly #gesture: Mutable<GestureInput> = { x: 0, y: 0, dx: 0, dy: 0, scale: 1, time: 0 };
  /** Fingers down: their positions, for the two-finger gesture. */
  readonly #touches = new Map<number, { x: number; y: number }>();
  /** Pointers pressed on something that is not board input: the board hears nothing of them until they are released. */
  readonly #refused = new Set<number>();
  readonly #accepts: (target: EventTarget | null) => boolean;
  #left = 0;
  #top = 0;
  /** The gesture's last centre and spread. */
  #gx = 0;
  #gy = 0;
  #gd = 1;
  readonly #listeners: readonly (readonly [EventTarget, string, EventListener, AddEventListenerOptions | undefined])[];

  constructor(options: WebInputOptions) {
    this.#el = options.element;
    this.#sink = options.sink;
    this.#accepts = options.accepts ?? (() => true);
    this.#probe = new PressureProbe(options.report);
    this.#gate = new PointerGate({ ...(options.touchDraws !== undefined ? { touchDraws: options.touchDraws } : {}), ...(options.report !== undefined ? { report: options.report } : {}) });
    const el = this.#el;
    el.style.touchAction = 'none';
    if (el.tabIndex < 0) el.tabIndex = 0;
    const on = (type: string, fn: (e: never) => void, opts?: AddEventListenerOptions): readonly [EventTarget, string, EventListener, AddEventListenerOptions | undefined] => [el, type, fn as unknown as EventListener, opts];
    this.#listeners = [
      on('pointerdown', (e: PointerEvent) => this.#down(e)),
      on('pointermove', (e: PointerEvent) => this.#move(e)),
      on('pointerup', (e: PointerEvent) => this.#up(e, 'up')),
      on('pointercancel', (e: PointerEvent) => this.#up(e, 'cancel')),
      on('pointerleave', (e: PointerEvent) => {
        if (e.pointerType === 'pen') this.#gate.penAway();
      }),
      on('wheel', (e: WheelEvent) => this.#onWheel(e), { passive: false }),
      on('keydown', (e: KeyboardEvent) => this.#onKey(e, true)),
      on('keyup', (e: KeyboardEvent) => this.#onKey(e, false)),
      on('contextmenu', (e: Event) => e.preventDefault()),
    ];
    for (const [t, type, fn, opts] of this.#listeners) t.addEventListener(type, fn, opts);
    this.#measure();
  }

  /** Removes every listener. */
  dispose(): void {
    for (const [t, type, fn, opts] of this.#listeners) t.removeEventListener(type, fn, opts);
    this.#touches.clear();
    this.#refused.clear();
  }

  /** Reads the element's place again (it moved or was resized). */
  measure(): void {
    this.#measure();
  }

  #measure(): void {
    const r = this.#el.getBoundingClientRect();
    this.#left = r.left;
    this.#top = r.top;
  }

  #fill(e: PointerEvent, phase: Phase, predicted: boolean): ReusedSample {
    const s = this.#sample;
    const device = deviceOf(e.pointerType);
    s.pointer = e.pointerId;
    s.device = device;
    s.setPhase(phase);
    s.x = e.clientX - this.#left;
    s.y = e.clientY - this.#top;
    s.pressure = device === 'pen' ? (phase === 'hover' ? 0 : this.#probe.observe(e.pressure)) : Number.NaN;
    s.tiltX = e.tiltX || 0;
    s.tiltY = e.tiltY || 0;
    s.twist = e.twist || 0;
    s.buttons = e.buttons;
    s.time = e.timeStamp;
    s.predicted = predicted;
    s.modifiers = (e.shiftKey ? MOD_SHIFT : 0) | (e.altKey ? MOD_ALT : 0) | (e.ctrlKey || e.metaKey ? MOD_MOD : 0);
    return s;
  }

  #down(e: PointerEvent): void {
    if (!this.#accepts(e.target)) {
      this.#refused.add(e.pointerId);
      return;
    }
    this.#measure();
    this.#el.focus({ preventScroll: true });
    try {
      this.#el.setPointerCapture(e.pointerId);
    } catch {
      // a pointer that is already gone cannot be captured; the events still come
    }
    if (e.pointerType === 'touch') this.#touches.set(e.pointerId, { x: e.clientX - this.#left, y: e.clientY - this.#top });
    e.preventDefault();
    this.#predictor.reset();
    this.#route(this.#fill(e, 'down', false), e);
  }

  #move(e: PointerEvent): void {
    if (this.#refused.has(e.pointerId)) return;
    const device = deviceOf(e.pointerType);
    const phase: Phase = e.buttons === 0 && device !== 'touch' ? 'hover' : 'move';
    if (device === 'touch') {
      const t = this.#touches.get(e.pointerId);
      if (t !== undefined) {
        t.x = e.clientX - this.#left;
        t.y = e.clientY - this.#top;
      }
    }
    const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : NO_EVENTS;
    if (coalesced.length > 0) {
      for (let i = 0; i < coalesced.length; i++) {
        const c = coalesced[i] as PointerEvent;
        const s = this.#fill(c, phase, false);
        if (phase === 'move') this.#predictor.push(s);
        this.#route(s, c);
      }
    } else {
      const s = this.#fill(e, phase, false);
      if (phase === 'move') this.#predictor.push(s);
      this.#route(s, e);
    }
    // the tail is guessed here from the samples (BR-77): the browser's `getPredictedEvents()` makes new event objects at every move
    const gate = this.#gate.state;
    if (phase !== 'move' || (gate !== 'penDown' && gate !== 'mouseDown' && gate !== 'touchDown')) return;
    const s = this.#sample;
    const n = this.#predictor.ready;
    for (let i = 0; i < n; i++) {
      if (!this.#predictor.guess(i, this.#guess)) break;
      s.x = this.#guess[0] as number;
      s.y = this.#guess[1] as number;
      s.time = this.#guess[2] as number;
      s.predicted = true;
      this.#sink.sample(s);
    }
  }

  #up(e: PointerEvent, phase: 'up' | 'cancel'): void {
    if (this.#refused.delete(e.pointerId)) return;
    this.#predictor.reset();
    this.#route(this.#fill(e, phase, false), e);
    this.#touches.delete(e.pointerId);
    try {
      this.#el.releasePointerCapture(e.pointerId);
    } catch {
      // not captured any more
    }
  }

  /** Asks the gate and gives the sample to the sink, or turns it into a gesture. */
  #route(s: ReusedSample, e: PointerEvent): void {
    const verdict = this.#gate.admit(s);
    switch (verdict) {
      case 'draw':
        this.#sink.sample(s);
        break;
      case 'ignore':
        break;
      case 'cancelThenDraw':
        this.#cancelFinger(s);
        this.#sink.sample(s);
        break;
      case 'gestureStart':
        this.#cancelFinger(s);
        this.#gestureBegin(e.timeStamp);
        break;
      case 'gesture':
        this.#gestureMove(e.timeStamp);
        break;
      case 'gestureEnd':
        break;
    }
  }

  /** Cancels the stroke the finger was drawing, with a sample of its own. */
  #cancelFinger(current: ReusedSample): void {
    const id = this.#gate.dropDrawing();
    if (id < 0) return;
    const keep = { pointer: current.pointer, device: current.device, phase: current.phase };
    current.pointer = id;
    current.device = 'touch';
    current.setPhase('cancel');
    this.#sink.sample(current);
    current.pointer = keep.pointer;
    current.device = keep.device;
    current.setPhase(keep.phase);
  }

  #spread(): { cx: number; cy: number; d: number } | undefined {
    const [a, b] = [...this.#touches.values()];
    if (a === undefined || b === undefined) return undefined;
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  }

  #gestureBegin(time: number): void {
    const g = this.#spread();
    if (g === undefined) return;
    this.#gx = g.cx;
    this.#gy = g.cy;
    this.#gd = g.d;
    void time;
  }

  #gestureMove(time: number): void {
    const g = this.#spread();
    if (g === undefined) return;
    const out = this.#gesture;
    out.x = g.cx;
    out.y = g.cy;
    out.dx = g.cx - this.#gx;
    out.dy = g.cy - this.#gy;
    out.scale = g.d / this.#gd;
    out.time = time;
    this.#gx = g.cx;
    this.#gy = g.cy;
    this.#gd = g.d;
    if (out.dx !== 0 || out.dy !== 0 || out.scale !== 1) this.#sink.gesture(out);
  }

  #onWheel(e: WheelEvent): void {
    if (!this.#accepts(e.target)) return;
    e.preventDefault();
    const w = this.#wheel;
    w.x = e.clientX - this.#left;
    w.y = e.clientY - this.#top;
    w.time = e.timeStamp;
    // a mouse wheel notch (a line, or a whole pixel step with no sideways part) zooms; a trackpad's smooth scroll pans
    const notch = e.deltaMode !== 0 || (Math.abs(e.deltaY) >= 40 && e.deltaX === 0 && Number.isInteger(e.deltaY));
    const unit = e.deltaMode === 1 ? 33 : 1;
    if (e.ctrlKey || e.metaKey) {
      // a trackpad pinch reports small steps with Ctrl held
      w.zoom = true;
      w.dx = 0;
      w.dy = e.deltaY * unit * (e.deltaMode === 0 && Math.abs(e.deltaY) < 40 ? 6 : 1);
    } else if (notch) {
      w.zoom = true;
      w.dx = 0;
      w.dy = e.deltaY * unit;
    } else {
      w.zoom = false;
      w.dx = e.deltaX;
      w.dy = e.deltaY;
    }
    this.#sink.wheel(w);
  }

  #onKey(e: KeyboardEvent, down: boolean): void {
    const k = this.#key;
    k.key = e.key;
    k.down = down;
    k.shift = e.shiftKey;
    k.alt = e.altKey;
    k.mod = e.ctrlKey || e.metaKey;
    k.repeat = e.repeat;
    const before = e.defaultPrevented;
    this.#sink.key(k);
    // Space is the hand, not a scroll
    if (!before && e.key === ' ') e.preventDefault();
  }
}
