/**
 * Where the pen is going next (design 6.1, the predicted tail; BR-77). The browser's own guess (`getPredictedEvents()`)
 * hands over new event objects at every pointer move, which the page then has to collect, so the board makes its own:
 * the speed over the last samples, eased, carried forward a frame or so. The guess is only drawn on the overlay and is
 * never stored. Fixed arrays and numbers only: a sample makes nothing for the garbage collector. No DOM, no timers.
 */

/** How many recent samples the speed is taken over. */
const HISTORY = 4;
/** The samples to guess: this far ahead in milliseconds each. */
export const PREDICT_STEPS_MS: readonly number[] = [8, 16];
/** A guess never reaches further than this many screen pixels from the last sample. */
const MAX_REACH_PX = 48;
/** Samples further apart than this in time are a pause: no guess. */
const MAX_GAP_MS = 50;

export class Predictor {
  readonly #x = new Float64Array(HISTORY);
  readonly #y = new Float64Array(HISTORY);
  readonly #t = new Float64Array(HISTORY);
  #count = 0;
  #head = 0;

  /** Forgets the samples (a stroke began or ended). */
  reset(): void {
    this.#count = 0;
    this.#head = 0;
  }

  /** A real sample, in screen pixels and milliseconds. Samples out of time order or not finite are left out. */
  push(at: { readonly x: number; readonly y: number; readonly time: number }): void {
    const x = at.x;
    const y = at.y;
    const t = at.time;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(t)) return;
    if (this.#count > 0 && t < (this.#t[(this.#head + HISTORY - 1) % HISTORY] as number)) return;
    this.#x[this.#head] = x;
    this.#y[this.#head] = y;
    this.#t[this.#head] = t;
    this.#head = (this.#head + 1) % HISTORY;
    if (this.#count < HISTORY) this.#count++;
  }

  /** How many guesses `guess` can make now: none until there are two samples close enough in time. */
  get ready(): number {
    if (this.#count < 2) return 0;
    const last = (this.#head + HISTORY - 1) % HISTORY;
    const first = (this.#head + HISTORY - this.#count) % HISTORY;
    const span = (this.#t[last] as number) - (this.#t[first] as number);
    return span > 0 && span <= MAX_GAP_MS * (this.#count - 1) ? PREDICT_STEPS_MS.length : 0;
  }

  /**
   * Writes guess `i` (0 is the nearest) into `out` as `x, y, time` (screen pixels and milliseconds; a typed array, so the
   * numbers are not boxed). The speed is the mean over the
   * samples kept, so one jumpy sample does not throw the tail; the reach is capped.
   */
  guess(i: number, out: Float64Array): boolean {
    if (i < 0 || i >= this.ready) return false;
    const last = (this.#head + HISTORY - 1) % HISTORY;
    const first = (this.#head + HISTORY - this.#count) % HISTORY;
    const lx = this.#x[last] as number;
    const ly = this.#y[last] as number;
    const lt = this.#t[last] as number;
    const dt = lt - (this.#t[first] as number);
    const vx = (lx - (this.#x[first] as number)) / dt;
    const vy = (ly - (this.#y[first] as number)) / dt;
    const ahead = PREDICT_STEPS_MS[i] as number;
    let dx = vx * ahead;
    let dy = vy * ahead;
    const reach = Math.sqrt(dx * dx + dy * dy);
    if (reach > MAX_REACH_PX) {
      dx *= MAX_REACH_PX / reach;
      dy *= MAX_REACH_PX / reach;
    }
    out[0] = lx + dx;
    out[1] = ly + dy;
    out[2] = lt + ahead;
    return true;
  }
}
