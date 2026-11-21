/**
 * The pen and the highlighter (design 6.4). One tool over two styles: the stroke grows in the live stroke's own buffer,
 * and one fresh record is stored when the pen comes up (one undo step). The tool's state is the live stroke's
 * (`LIVE_MACHINE`, B7). The pen's nibs are `pen`, `marker` and `pencil`; a marker and the highlighter use tilt.
 */
import { fixStrokes } from '../fix';
import { HoldWatch } from '../ink/hold';
import { NIB_SPECS } from '../ink/outline';
import type { InputSample } from '../input';
import type { ToolContext, ToolDef, ToolHandlers } from './def';

class InkTool implements ToolHandlers {
  readonly #ctx: ToolContext;
  readonly #which: 'pen' | 'highlighter';
  /** Watches the pen for the hold that fixes a rough shape (B23); the highlighter never starts it. */
  readonly #hold = new HoldWatch();

  constructor(ctx: ToolContext, which: 'pen' | 'highlighter') {
    this.#ctx = ctx;
    this.#which = which;
  }

  get state(): string {
    return this.#ctx.core.live.state;
  }

  onDown(s: InputSample): void {
    const camera = this.#ctx.camera();
    const page = this.#ctx.core.pages.current;
    if (camera === undefined || page === null) return;
    const style = this.#ctx.styles[this.#which];
    // a new stroke drops a selection, as a click on the board does
    this.#ctx.core.selection.clear();
    if (this.#ctx.core.live.begin(s, camera, page, { ...style }, NIB_SPECS[style.nib].tilt)) {
      if (this.#which === 'pen' && this.#ctx.styles.fixHold !== false) this.#hold.begin(s.x, s.y, s.time);
      this.#ctx.requestFrame();
    }
  }

  onMove(s: InputSample): void {
    const camera = this.#ctx.camera();
    if (camera === undefined) return;
    if (s.predicted) this.#ctx.core.live.predict(s);
    else {
      this.#ctx.core.live.add(s, camera);
      this.#hold.move(s.x, s.y, s.time);
    }
    this.#ctx.requestFrame();
  }

  /** Each frame: when the pen has been still for 500 ms the stroke is stored and fixed; true while the hold is being watched. */
  tick(now: number): boolean {
    if (!this.#hold.watching) return false;
    if (!this.#hold.due(now)) return true;
    const live = this.#ctx.core.live;
    if (live.state !== 'drawing' || !this.#hold.fire()) return false;
    const done = live.end(this.#ctx.core.store);
    if (done.ok && done.value !== undefined) {
      this.#ctx.strokeEnded();
      // the stroke is its own undo step; the fix is the next one, so undo gives the ink back
      this.#ctx.core.history.seal();
      const fixed = fixStrokes(this.#ctx.core, [done.value.id]);
      if (fixed.ok && fixed.value.length > 0) this.#ctx.core.selection.set(fixed.value);
    } else {
      this.#ctx.strokeDropped();
    }
    this.#ctx.requestFrame();
    return false;
  }

  onPredicted(s: InputSample): void {
    this.#ctx.core.live.predict(s);
  }

  onUp(s: InputSample): void {
    this.#hold.end();
    const live = this.#ctx.core.live;
    if (live.state !== 'drawing') return;
    const camera = this.#ctx.camera();
    if (camera !== undefined) live.add(s, camera);
    const done = live.end(this.#ctx.core.store);
    if (done.ok && done.value !== undefined) this.#ctx.strokeEnded();
    else this.#ctx.strokeDropped();
    this.#ctx.requestFrame();
  }

  onCancel(): void {
    this.#hold.cancel();
    const live = this.#ctx.core.live;
    if (live.state !== 'drawing') return;
    live.cancel();
    this.#ctx.strokeDropped();
    this.#ctx.requestFrame();
  }
}

export const penTool: ToolDef = {
  id: 'pen',
  label: 'Pen',
  key: 'p',
  create: (ctx) => new InkTool(ctx, 'pen'),
};

export const highlighterTool: ToolDef = {
  id: 'highlighter',
  label: 'Highlighter',
  key: 'shift+p',
  create: (ctx) => new InkTool(ctx, 'highlighter'),
};
