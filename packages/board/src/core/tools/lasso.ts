/**
 * The lasso (design 6.4, docs/state-machines.md B10): the loop the pointer draws selects the strokes it encloses (more
 * than half of a stroke's points). The loop is drawn on the overlay only, and the selection is not an undo step.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import { isInk } from '../geometry';
import { pointsInside } from '../ink/geometry';
import type { InputSample } from '../input';
import type { ToolContext, ToolDef, ToolHandlers } from './def';

type LassoState = 'idle' | 'drawing';
type LassoEvent = 'down' | 'move' | 'up' | 'cancel';

export const LASSO_MACHINE: MachineTable<LassoState, LassoEvent> = {
  idle: { down: 'drawing' },
  drawing: { move: 'drawing', up: 'idle', cancel: 'idle' },
};

/** A loop point closer than this many screen pixels to the last one is dropped. */
const MIN_STEP_PX = 0.5;

class LassoTool implements ToolHandlers {
  readonly #ctx: ToolContext;
  readonly #machine = new StateMachine(LASSO_MACHINE, 'idle');
  #xy = new Float32Array(512);
  #count = 0;
  #lastSx = 0;
  #lastSy = 0;

  constructor(ctx: ToolContext) {
    this.#ctx = ctx;
  }

  get state(): string {
    return this.#machine.state;
  }

  onDown(s: InputSample): void {
    if (!this.#machine.send('down')) return;
    this.#count = 0;
    this.#push(s, true);
  }

  onMove(s: InputSample): void {
    if (this.#machine.is('drawing')) this.#push(s, false);
  }

  onUp(s: InputSample): void {
    if (!this.#machine.is('drawing')) return;
    this.#push(s, false);
    this.#machine.send('up');
    this.#select();
    this.#ctx.overlay.loop = null;
    this.#ctx.requestFrame();
  }

  onCancel(): void {
    this.#machine.send('cancel');
    this.#ctx.overlay.loop = null;
    this.#ctx.requestFrame();
  }

  #push(s: InputSample, first: boolean): void {
    const camera = this.#ctx.camera();
    if (camera === undefined) return;
    if (!first && Math.hypot(s.x - this.#lastSx, s.y - this.#lastSy) < MIN_STEP_PX) return;
    if ((this.#count + 1) * 2 > this.#xy.length) {
      const grown = new Float32Array(this.#xy.length * 2);
      grown.set(this.#xy);
      this.#xy = grown;
    }
    const p = camera.toPage(s.x, s.y);
    this.#xy[this.#count * 2] = p.x;
    this.#xy[this.#count * 2 + 1] = p.y;
    this.#count++;
    this.#lastSx = s.x;
    this.#lastSy = s.y;
    this.#ctx.overlay.loop = { xy: this.#xy, count: this.#count };
    this.#ctx.requestFrame();
  }

  /** Selects what the loop encloses; a loop of fewer than 3 points selects nothing. */
  #select(): void {
    const { selection, index } = this.#ctx.core;
    if (this.#count < 3) {
      selection.clear();
      return;
    }
    const polygon = Array.from(this.#xy.subarray(0, this.#count * 2));
    const ids = index.grid.queryLasso(polygon);
    const picked: string[] = [];
    for (const id of ids) {
      const shape = index.shape(id);
      if (shape === undefined || shape.locked || !isInk(shape)) continue;
      const n = shape.props.points.length / shape.props.stride;
      if (n > 0 && pointsInside(shape, polygon) * 2 > n) picked.push(id);
    }
    selection.set(picked);
  }
}

export const lassoTool: ToolDef = {
  id: 'lasso',
  label: 'Lasso',
  key: 'l',
  create: (ctx) => new LassoTool(ctx),
};
