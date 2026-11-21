/**
 * The hold that turns a rough stroke into a clean shape (design 7.3, docs/state-machines.md B23). The pen tool tells
 * the watch about each move and asks it at each frame whether the pen has been still for 500 ms. The clock is the input
 * layer's: the `time` of the samples and the `now` of `tick`. No DOM, no timers, no `Date`.
 */
import { StateMachine } from '@incantly/kernel';
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
  readonly #machine = new StateMachine(HOLD_MACHINE, 'idle');
  /** The data of `watching`: where and when the pen last moved, and how long and how many the stroke is. */
  readonly #since = { x: 0, y: 0, time: 0, length: 0, points: 0, lastX: 0, lastY: 0 };

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

  /** The pen reached the screen point `x, y` at `time`. */
  move(x: number, y: number, time: number): void {
    if (!this.#machine.send('move')) return;
    const s = this.#since;
    s.length += Math.hypot(x - s.lastX, y - s.lastY);
    s.lastX = x;
    s.lastY = y;
    s.points++;
    if (Math.hypot(x - s.x, y - s.y) > HOLD_SLOP_PX) {
      s.x = x;
      s.y = y;
      s.time = time;
    }
  }

  /** True when the pen has been still for 500 ms and the stroke is long enough to be a shape. */
  due(now: number): boolean {
    const s = this.#since;
    return this.#machine.is('watching') && now - s.time >= HOLD_MS && s.length >= HOLD_MIN_LENGTH_PX && s.points >= HOLD_MIN_POINTS;
  }

  /** True while the pen is down and could still hold. */
  get watching(): boolean {
    return this.#machine.is('watching');
  }

  /** The hold happened: the stroke is handed to shape fixing. */
  fire(): boolean {
    return this.#machine.send('fire');
  }

  end(): void {
    this.#machine.send('end');
  }

  cancel(): void {
    this.#machine.send('cancel');
  }
}
