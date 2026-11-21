/**
 * The lasso (design 6.4, docs/state-machines.md B10): the loop the pointer draws selects the strokes it encloses (more
 * than half of a stroke's points). The loop is drawn on the overlay only, and the selection is not an undo step.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import { isInk, shapeGeometry } from '../geometry';
import { pointInPolygon } from '../index-grid';
import { expandGroups } from '../shapes';
import { mostlyInside } from '../ink/geometry';
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
    // the grid gives the strokes whose boxes meet the loop; one whose box is wholly inside is in without a point test
    // (BR-15), and only the others count points, stopping as soon as the answer is known
    const ids: string[] = [];
    const whole: boolean[] = [];
    index.grid.queryLassoSplit(polygon, ids, whole);
    const picked: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      const shape = index.shape(ids[i] as string);
      if (shape === undefined || shape.locked || shape.kind === 'group') continue;
      if (!isInk(shape)) {
        // any other shape is in when the middle of its box is inside the loop (B10)
        const g = shapeGeometry(shape, index.kinds);
        if (g !== undefined && pointInPolygon(g.pageCx, g.pageCy, polygon)) picked.push(shape.id);
        continue;
      }
      if (shape.props.points.length === 0) continue;
      if (whole[i] === true || mostlyInside(shape, polygon)) picked.push(shape.id);
    }
    // a shape of a group brings the whole group
    selection.set(expandGroups(this.#ctx.core.store, picked));
  }
}

export const lassoTool: ToolDef = {
  id: 'lasso',
  label: 'Lasso',
  key: 'l',
  create: (ctx) => new LassoTool(ctx),
};
