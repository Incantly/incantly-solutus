/**
 * The hold that turns a rough stroke into a clean shape (design 7.3, docs/state-machines.md B23). The pen tool tells
 * the watch about each move and asks it at each frame whether the pen has been still for 500 ms. The clock is the input
 * layer's: the `time` of the samples and the `now` of `tick`. No DOM, no timers, no `Date`.
 */
import { StateMachine } from '@incantly/kernel';
import { sendIfAble } from '../machine';
import { refusedMove } from '../errors';
import type { ErrorSink } from '../errors';
import type { MachineTable } from '@incantly/kernel';

type HoldState = 'idle' | 'watching' | 'fired';
type HoldEvent = 'begin' | 'move' | 'fire' | 'end' | 'cancel';

export const HOLD_MACHINE: MachineTable<HoldState, HoldEvent> = {
  idle: { begin: 'watching' },
  watching: { move: 'watching', fire: 'fired', end: 'idle', cancel: 'idle' },
  fired: { end: 'idle', cancel: 'idle' },
};

/** How long the pen stays still before the stroke is fixed. */
export const HOLD_MS = 500;
/** The pen has moved when it is further than this from where it last moved, in screen pixels. */
export const HOLD_SLOP_PX = 3;
/** A stroke shorter than this many screen pixels, or with fewer points, is a tap or a dot and is never fixed. */
export const HOLD_MIN_LENGTH_PX = 40;
export const HOLD_MIN_POINTS = 8;

export class HoldWatch {
  readonly #report: ErrorSink | undefined;
  readonly #machine = new StateMachine(HOLD_MACHINE, 'idle', refusedMove('hold watch', () => this.#report));
  /** The data of `watching`: where and when the pen last moved, and how long and how many the stroke is. */
  readonly #since = { x: 0, y: 0, time: 0, length: 0, points: 0, lastX: 0, lastY: 0 };

  constructor(report?: ErrorSink) {
    this.#report = report;
  }

  get state(): HoldState {
    return this.#machine.state;
  }

  /** The stroke began at the screen point `x, y` at `time`. */
  begin(x: number, y: number, time: number): boolean {
    if (!this.#machine.send('begin')) return false;
    const s = this.#since;
    s.x = x;
    s.y = y;
    s.lastX = x;
    s.lastY = y;
    s.time = time;
    s.length = 0;
    s.points = 1;
    return true;
  }

  /**
   * The pen reached the screen point `at.x, at.y` at `at.time` (or `move(x, y, time)`). The pen tool passes the sample whole: three numbers as arguments would
   * be boxed on the heap at every sample when the call is not inlined (BR-77).
   */
  move(at: { readonly x: number; readonly y: number; readonly time: number } | number, atY = 0, atTime = 0): void {
    if (!sendIfAble(this.#machine, 'move')) return;
    // the three numbers on their own are still taken (`move(x, y, time)`)
    const x = typeof at === 'number' ? at : at.x;
    const y = typeof at === 'number' ? atY : at.y;
    const time = typeof at === 'number' ? atTime : at.time;
    const s = this.#since;
    const mx = x - s.lastX;
    const my = y - s.lastY;
    s.length += Math.sqrt(mx * mx + my * my);
    s.lastX = x;
    s.lastY = y;
    s.points++;
    const dx = x - s.x;
    const dy = y - s.y;
    if (dx * dx + dy * dy > HOLD_SLOP_PX * HOLD_SLOP_PX) {
      s.x = x;
      s.y = y;
      s.time = time;
    }
  }

  /** True when the pen has been still for 500 ms and the stroke is long enough to be a shape. */
  due(now: number): boolean {
    const s = this.#since;
    return this.#machine.state === 'watching' && now - s.time >= HOLD_MS && s.length >= HOLD_MIN_LENGTH_PX && s.points >= HOLD_MIN_POINTS;
  }

  /** True while the pen is down and could still hold. */
  get watching(): boolean {
    return this.#machine.state === 'watching';
  }

  /** The hold happened: the stroke is handed to shape fixing. */
  fire(): boolean {
    return this.#machine.send('fire');
  }

  end(): void {
    sendIfAble(this.#machine, 'end');
  }

  cancel(): void {
    sendIfAble(this.#machine, 'cancel');
  }
}
