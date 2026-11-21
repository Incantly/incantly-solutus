/**
 * The pen and the highlighter (design 6.4). One tool over two styles: the stroke grows in the live stroke's own buffer,
 * and one fresh record is stored when the pen comes up (one undo step). The tool's state is the live stroke's
 * (`LIVE_MACHINE`, B7). The pen's nibs are `pen`, `marker` and `pencil`; a marker and the highlighter use tilt.
 */
import { NIB_SPECS } from '../ink/outline';
import type { InputSample } from '../input';
import type { ToolContext, ToolDef, ToolHandlers } from './def';

class InkTool implements ToolHandlers {
  readonly #ctx: ToolContext;
  readonly #which: 'pen' | 'highlighter';

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
    if (this.#ctx.core.live.begin(s, camera, page, { ...style }, NIB_SPECS[style.nib].tilt)) this.#ctx.requestFrame();
  }

  onMove(s: InputSample): void {
    const camera = this.#ctx.camera();
    if (camera === undefined) return;
    if (s.predicted) this.#ctx.core.live.predict(s);
    else this.#ctx.core.live.add(s, camera);
    this.#ctx.requestFrame();
  }

  onPredicted(s: InputSample): void {
    this.#ctx.core.live.predict(s);
  }

  onUp(s: InputSample): void {
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
