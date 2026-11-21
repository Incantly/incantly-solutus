/**
 * The Ask tool (design 11.1, docs/state-machines.md B33): the loop the pointer draws is a circle to ask about. The tool
 * only feeds points to `CircleAsk`, which finds the items, makes the suggestions and sends the request. The loop stays on
 * the overlay while the suggestions show and the answer arrives. Without an agent the tool says so (`agent_unavailable`).
 * The pen's barrel button held gives this tool for one stroke (B12).
 */
import { boardError } from '../errors';
import type { InputSample } from '../input';
import type { ToolContext, ToolDef, ToolHandlers } from './def';

/** What the tool says when the board has no agent at all. */
export const NO_AGENT = boardError('agent_unavailable', 'There is no agent on this board.', { hint: 'Pass the agent option to createBoard, or draw by hand.' });

class AskTool implements ToolHandlers {
  readonly #ctx: ToolContext;

  constructor(ctx: ToolContext) {
    this.#ctx = ctx;
    // the loop on the overlay follows the circle's own state: shown from the first point until it goes idle
    ctx.circle?.on(() => {
      const circle = ctx.circle;
      ctx.overlay.loop = circle !== undefined && circle.state !== 'idle' ? circle.view() : null;
      ctx.requestFrame();
    });
  }

  get state(): string {
    return this.#ctx.circle?.state ?? 'idle';
  }

  onDown(s: InputSample): void {
    const camera = this.#ctx.camera();
    if (camera === undefined) return;
    if (this.#ctx.circle === undefined) {
      this.#unavailable();
      return;
    }
    const p = camera.toPage(s.x, s.y);
    this.#ctx.circle.down(p.x, p.y);
  }

  onMove(s: InputSample): void {
    const camera = this.#ctx.camera();
    if (camera === undefined) return;
    const p = camera.toPage(s.x, s.y);
    this.#ctx.circle?.move(p.x, p.y);
  }

  onUp(s: InputSample): void {
    this.onMove(s);
    this.#ctx.circle?.up();
  }

  /** A second finger, another tool or Esc: the loop is dropped and the suggestions go. */
  onCancel(): void {
    this.#ctx.circle?.cancel();
    this.#ctx.circle?.dismiss();
  }

  #unavailable(): void {
    this.#ctx.core.store.sink(NO_AGENT);
    this.#ctx.say?.(NO_AGENT.message);
  }
}

export const askTool: ToolDef = {
  id: 'ask',
  label: 'Ask',
  key: '?',
  cursor: 'help',
  create: (ctx) => new AskTool(ctx),
};
