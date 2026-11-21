/**
 * The hand on the live layer (design 11.2, docs/state-machines.md B34): `HandPlayer` for the runner, driven by the board's
 * frame loop. The runner asks to play a plan; each frame `frame(now)` steps the animation and gives the draw item of what
 * has been drawn so far, which the view hands to the painter as an item that is in no tile. When the drawing is whole the
 * runner stores it as ink, and the hand's picture stays for two more frames so the stored shape never blinks. No timers:
 * the frame loop is the clock.
 */
import type { BoardCore } from '../core/board';
import type { DrawItem } from '../core/draw';
import type { BoardError } from '../core/errors';
import { HandAnimation } from '../core/agent-hand';
import type { HandPlan, HandPlayer } from '../core/agent-hand';

/** How many frames the hand's picture stays after the shape was stored. */
const LANDING_FRAMES = 2;

export interface WebHandOptions {
  readonly core: BoardCore;
  /** Asks the board for a frame. */
  readonly requestFrame: () => void;
  /** Where the hand is now, in page units (each frame of a drawing). */
  readonly onTip: (at: { readonly x: number; readonly y: number }) => void;
  readonly onError: (error: BoardError) => void;
}

export class WebHand implements HandPlayer {
  readonly #options: WebHandOptions;
  readonly #anim: HandAnimation;
  /** Resolves the runner's `play` promise with the progress reached. */
  #resolve: (progress: number) => void = () => undefined;
  #landed = 0;

  constructor(options: WebHandOptions) {
    this.#options = options;
    this.#anim = new HandAnimation(options.core.store.kinds, options.onError);
  }

  get animation(): HandAnimation {
    return this.#anim;
  }

  play(plan: HandPlan): Promise<number> {
    return new Promise((resolve) => {
      if (!this.#anim.begin(plan)) {
        resolve(1);
        return;
      }
      this.#landed = 0;
      this.#resolve = resolve;
      this.#options.requestFrame();
    });
  }

  cancel(): void {
    if (this.#anim.state !== 'playing') return;
    const progress = this.#anim.cancel();
    this.#resolve(progress);
    this.#options.requestFrame();
  }

  /**
   * One frame at `now`. Returns the item to draw, or undefined when the hand has nothing on show. `more` is true while
   * the hand still needs frames.
   */
  frame(now: number, scale: number): { readonly item: DrawItem | undefined; readonly more: boolean } {
    const anim = this.#anim;
    const was = anim.state;
    if (was === 'idle') return { item: undefined, more: false };
    let frame;
    if (was === 'playing') {
      frame = anim.step(now);
      if (frame !== undefined) this.#options.onTip(frame.tip);
      // the drawing is whole: the runner stores it, and this frame still shows it
      if (frame !== undefined && frame.progress >= 1) this.#resolve(1);
    } else {
      frame = anim.last();
      this.#landed++;
      if (this.#landed >= LANDING_FRAMES) anim.settle();
    }
    const item = frame === undefined ? undefined : this.#options.core.drawList.itemOf(frame.shape, scale);
    return { item, more: this.#anim.state !== 'idle' };
  }
}
