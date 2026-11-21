/**
 * What the input layer gives the core (design 3): `InputSample` for a pen, a touch or a mouse, `KeyInput`, wheel and
 * two-finger gestures; and the two small machines every input adapter shares, so the web and React Native agree on
 * them: the palm rule (`PointerGate`, B5) and the pen that only reports 0.5 (`PressureProbe`, B6). No DOM, no timers,
 * no `Date`: `time` always comes from the adapter's own clock.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';

export type Device = 'pen' | 'touch' | 'mouse';
export type Phase = 'down' | 'move' | 'up' | 'cancel' | 'hover';

/** `InputSample.buttons`: bit 1 tip, 2 barrel, 4 middle, 32 eraser end. */
export const BUTTON_TIP = 1;
export const BUTTON_BARREL = 2;
export const BUTTON_MIDDLE = 4;
export const BUTTON_ERASER = 32;

/**
 * One pen, touch or mouse sample in screen pixels. The adapter reuses one object for every event, so a consumer reads
 * it during the call and copies what it keeps.
 */
export interface InputSample {
  /** Stable id while the pointer is down. */
  readonly pointer: number;
  readonly device: Device;
  readonly phase: Phase;
  readonly x: number;
  readonly y: number;
  /** 0 to 1; NaN when the device has no sensor, so the core simulates it from speed. */
  readonly pressure: number;
  /** Degrees, 0 when unknown. */
  readonly tiltX: number;
  readonly tiltY: number;
  readonly twist: number;
  readonly buttons: number;
  /** Milliseconds, from the input layer's own clock. */
  readonly time: number;
  /** A guess of a future sample; never stored. */
  readonly predicted: boolean;
}

/** A key going down or up; `mod` is Ctrl or Cmd. */
export interface KeyInput {
  readonly key: string;
  readonly down: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly mod: boolean;
  readonly repeat: boolean;
}

/** A wheel step or a trackpad pinch (`zoom` true): `dx, dy` in screen pixels, about the point `x, y`. */
export interface WheelInput {
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
  readonly zoom: boolean;
  readonly time: number;
}

/** A change of a two-finger gesture since the last one: the centre moved by `dx, dy`, the fingers' distance grew by `scale`. */
export interface GestureInput {
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
  readonly scale: number;
  readonly time: number;
}

/** What an input adapter calls. Every method returns at once and never throws. */
export interface InputSink {
  sample(s: InputSample): void;
  key(k: KeyInput): void;
  wheel(w: WheelInput): void;
  gesture(g: GestureInput): void;
}

// ---------------------------------------------------------------------------------------------------------------
// B5: the palm rule

type GateState = 'idle' | 'penNear' | 'penDown' | 'mouseDown' | 'touchDown' | 'gesture';
type GateEvent =
  | 'penHover'
  | 'penDown'
  | 'penUp'
  | 'penAway'
  | 'penCancel'
  | 'mouseDown'
  | 'mouseUp'
  | 'touchDown'
  | 'touchUp'
  | 'secondTouch'
  | 'gestureEnd';

export const GATE_MACHINE: MachineTable<GateState, GateEvent> = {
  idle: { penHover: 'penNear', penDown: 'penDown', mouseDown: 'mouseDown', touchDown: 'touchDown', secondTouch: 'gesture' },
  penNear: { penHover: 'penNear', penDown: 'penDown', penAway: 'idle', mouseDown: 'mouseDown', secondTouch: 'gesture' },
  penDown: { penUp: 'penNear', penCancel: 'idle' },
  mouseDown: { mouseUp: 'idle' },
  touchDown: { touchUp: 'idle', secondTouch: 'gesture', penHover: 'penNear', penDown: 'penDown' },
  gesture: { secondTouch: 'gesture', gestureEnd: 'idle' },
};

/** What the adapter does with a sample. */
export type Verdict =
  /** Give it to the tool. */
  | 'draw'
  /** A palm, a second pointer, or a pen during a gesture: drop it. */
  | 'ignore'
  /** Cancel the finger's stroke in progress, then give this sample to the tool. */
  | 'cancelThenDraw'
  /** Two fingers are down: the adapter computes the gesture; the first sample of it also cancels the finger stroke. */
  | 'gesture'
  /** The gesture just began: cancel the finger's stroke, then treat as `gesture`. */
  | 'gestureStart'
  /** The last gesture finger came up. */
  | 'gestureEnd';

/** A touch lands this long after the last pen sample and still counts as the palm. */
export const PALM_GRACE_MS = 600;

export type TouchDraws = 'auto' | 'never' | 'always';

export interface GateOptions {
  /** `auto`: a finger draws unless a pen is near; `never`: pen only; `always`: a finger draws even with a pen near. */
  readonly touchDraws?: TouchDraws;
}

export class PointerGate {
  readonly #machine = new StateMachine(GATE_MACHINE, 'idle');
  readonly #touchDraws: TouchDraws;
  /** Data next to the machine: the fingers down, the pointer that draws, the last pen sample's time. */
  #touches = 0;
  #drawing = -1;
  #penTime = -Infinity;

  constructor(options: GateOptions = {}) {
    this.#touchDraws = options.touchDraws ?? 'auto';
  }

  get state(): GateState {
    return this.#machine.state;
  }

  /** The number of fingers down. */
  get touches(): number {
    return this.#touches;
  }

  /** The pointer id of the finger that is drawing, or -1. */
  get drawing(): number {
    return this.#drawing;
  }

  /** Forgets the finger that was drawing and gives its pointer id, or -1: the adapter then cancels that stroke. */
  dropDrawing(): number {
    const id = this.#drawing;
    this.#drawing = -1;
    return id;
  }

  /** Decides what to do with one sample, and moves the machine. */
  admit(s: InputSample): Verdict {
    if (s.device === 'pen') return this.#pen(s);
    if (s.device === 'mouse') return this.#mouse(s);
    return this.#touch(s);
  }

  #pen(s: InputSample): Verdict {
    this.#penTime = s.time;
    const was = this.#machine.state;
    switch (s.phase) {
      case 'hover':
        if (!this.#machine.send('penHover')) return 'ignore';
        return was === 'touchDown' ? 'cancelThenDraw' : 'draw';
      case 'down':
        if (!this.#machine.send('penDown')) return 'ignore';
        return was === 'touchDown' ? 'cancelThenDraw' : 'draw';
      case 'move':
        return was === 'penDown' ? 'draw' : 'ignore';
      case 'up':
        return this.#machine.send('penUp') ? 'draw' : 'ignore';
      case 'cancel':
        return this.#machine.send('penCancel') ? 'draw' : 'ignore';
    }
  }

  /** The pen left hover range (`pointerleave`). */
  penAway(): void {
    this.#machine.send('penAway');
  }

  #mouse(s: InputSample): Verdict {
    const was = this.#machine.state;
    switch (s.phase) {
      case 'down':
        return this.#machine.send('mouseDown') ? 'draw' : 'ignore';
      case 'up':
      case 'cancel':
        return this.#machine.send('mouseUp') ? 'draw' : 'ignore';
      case 'move':
        return was === 'mouseDown' ? 'draw' : 'ignore';
      case 'hover':
        return was === 'idle' || was === 'penNear' ? 'draw' : 'ignore';
    }
  }

  #touch(s: InputSample): Verdict {
    switch (s.phase) {
      case 'down': {
        this.#touches++;
        if (this.#touches >= 2) {
          const was = this.#machine.state;
          if (!this.#machine.send('secondTouch')) return 'ignore';
          return was === 'gesture' ? 'gesture' : 'gestureStart';
        }
        if (!this.#mayDraw(s.time) || !this.#machine.send('touchDown')) return 'ignore';
        this.#drawing = s.pointer;
        return 'draw';
      }
      case 'move':
        if (this.#machine.state === 'gesture') return 'gesture';
        return s.pointer === this.#drawing && this.#machine.state === 'touchDown' ? 'draw' : 'ignore';
      case 'up':
      case 'cancel': {
        if (this.#touches > 0) this.#touches--;
        if (this.#machine.state === 'gesture') {
          if (this.#touches >= 2) return 'gesture';
          this.#machine.send('gestureEnd');
          return 'gestureEnd';
        }
        if (s.pointer === this.#drawing && this.#machine.send('touchUp')) {
          this.#drawing = -1;
          return 'draw';
        }
        return 'ignore';
      }
      case 'hover':
        return 'ignore';
    }
  }

  #mayDraw(time: number): boolean {
    if (this.#touchDraws === 'never') return false;
    if (this.#touchDraws === 'always') return true;
    return !(this.#machine.is('penNear', 'penDown') || time - this.#penTime < PALM_GRACE_MS);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// B6: a pen that only reports 0.5

type ProbeState = 'unknown' | 'flat' | 'real';
type ProbeEvent = 'flat' | 'varied';

export const PROBE_MACHINE: MachineTable<ProbeState, ProbeEvent> = {
  unknown: { flat: 'flat', varied: 'real' },
  flat: { varied: 'real' },
  real: {},
};

/** Samples of exactly 0.5 in a row before a pen is called flat. */
export const PROBE_FLAT_SAMPLES = 8;

export class PressureProbe {
  readonly #machine = new StateMachine(PROBE_MACHINE, 'unknown');
  #flatSeen = 0;

  get state(): ProbeState {
    return this.#machine.state;
  }

  /** The pressure to report for a raw one: NaN while the pen has shown no sensor, else the value itself. */
  observe(pressure: number): number {
    if (!Number.isFinite(pressure)) return Number.NaN;
    if (pressure <= 0) return pressure;
    if (pressure !== 0.5) {
      this.#machine.send('varied');
      return pressure;
    }
    if (this.#machine.is('real')) return pressure;
    this.#flatSeen++;
    if (this.#flatSeen >= PROBE_FLAT_SAMPLES) this.#machine.send('flat');
    return Number.NaN;
  }
}
