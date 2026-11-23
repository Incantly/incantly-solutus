/**
 * The shapes an open gesture moves (design 9, item 7; BR-82). While a shape is dragged, resized, turned or drawn out,
 * its tiles would be drawn again at every move, a few each frame within the frame's budget, and the tiles not drawn yet
 * would show it where it was: parts of a dragged picture or square would lag behind and seem to fall off. So the
 * shapes a gesture writes are lifted out of the tiles: the tiles are drawn once without them, and the view draws them
 * on the overlay at their place in each frame. When the gesture ends they settle: they go back into the tiles, and the
 * overlay draws them, clipped to the tiles not drawn again yet, until every tile that shows them holds them. The lift
 * machine is B36 in docs/state-machines.md. No DOM, no timers.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import { sendIfAble } from './machine';
import { refusedMove } from './errors';
import type { ErrorSink } from './errors';
import type { Diff } from './types';
import { isShape } from './types';

/** More shapes than this in one gesture, and the rest stay in the tiles (the overlay is drawn with Canvas 2D every frame). */
export const LIFT_MAX = 400;

type LiftState = 'resting' | 'held';
type LiftEvent = 'hold' | 'release';

/** B36: shapes are held while a gesture writes them; the gesture's end releases them, and they settle. */
export const LIFT_MACHINE: MachineTable<LiftState, LiftEvent> = {
  resting: { hold: 'held' },
  held: { hold: 'held', release: 'resting' },
};

/** The shapes lifted out of the tiles while a gesture moves them, and the ones settling back after it. */
export class Lift {
  readonly #machine: StateMachine<LiftState, LiftEvent>;
  /** Left out of the tiles; the view draws them on the overlay every frame. */
  readonly #held = new Set<string>();
  /** Back in the tiles; the view draws them on the overlay over the tiles that are not drawn again yet. */
  readonly #settling = new Set<string>();
  /** The ids the last release let go, handed to the listeners (one set, emptied at each release). */
  readonly #released = new Set<string>();
  readonly #listeners: ((ids: ReadonlySet<string>) => void)[] = [];

  constructor(report?: () => ErrorSink | undefined) {
    this.#machine = new StateMachine(LIFT_MACHINE, 'resting', refusedMove('lift', report ?? (() => undefined)));
  }

  /** `resting` or `held`. */
  get state(): LiftState {
    return this.#machine.state;
  }

  /** The ids the tiles leave out: the held shapes (empty while resting). */
  get held(): ReadonlySet<string> {
    return this.#held;
  }

  /** The ids drawn over the tiles that do not hold them yet. */
  get settling(): ReadonlySet<string> {
    return this.#settling;
  }

  /** True when the shape is held out of the tiles now. */
  isHeld(id: string): boolean {
    return this.#held.has(id);
  }

  /**
   * Takes the shapes a gesture's write changed or added (a removed one is let go). A shape is held from the write after
   * the one that first changed it, so the tiles that showed it before are drawn again once, without it.
   */
  take(diff: Diff): void {
    for (const r of diff.removed) {
      this.#held.delete(r.id);
      this.#settling.delete(r.id);
    }
    for (const r of diff.added) this.#hold(r.id, isShape(r));
    for (const u of diff.updated) this.#hold(u.after.id, isShape(u.after));
    if (this.#held.size > 0) sendIfAble(this.#machine, 'hold');
  }

  #hold(id: string, shape: boolean): void {
    if (!shape || this.#held.has(id) || this.#held.size >= LIFT_MAX) return;
    this.#settling.delete(id);
    this.#held.add(id);
  }

  /** The gesture ended: the held shapes go back into the tiles and settle; `onRelease` listeners get their ids. */
  release(): void {
    if (!sendIfAble(this.#machine, 'release')) return;
    this.#released.clear();
    for (const id of this.#held) {
      this.#settling.add(id);
      this.#released.add(id);
    }
    this.#held.clear();
    for (const fn of this.#listeners) fn(this.#released);
  }

  /** The shape is in every tile that shows it: the overlay stops drawing it. */
  settled(id: string): void {
    this.#settling.delete(id);
  }

  /** Forgets every shape (a page change): nothing is held or settling. */
  clear(): void {
    sendIfAble(this.#machine, 'release');
    this.#held.clear();
    this.#settling.clear();
  }

  /** Calls `fn` with the ids a gesture's end let go, so the view draws their tiles again. Returns a stop function. */
  onRelease(fn: (ids: ReadonlySet<string>) => void): () => void {
    this.#listeners.push(fn);
    return () => {
      const at = this.#listeners.indexOf(fn);
      if (at >= 0) this.#listeners.splice(at, 1);
    };
  }
}
