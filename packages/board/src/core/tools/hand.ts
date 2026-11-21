/**
 * The hand (docs/state-machines.md B11): a drag moves the camera by the pointer's screen delta. Space held and the
 * middle button pick it for as long as they last; the wheel and the two-finger pan do not need it.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import type { InputSample } from '../input';
import type { ToolContext, ToolDef, ToolHandlers } from './def';

type HandState = 'idle' | 'panning';
type HandEvent = 'down' | 'move' | 'up' | 'cancel';

export const HAND_MACHINE: MachineTable<HandState, HandEvent> = {
  idle: { down: 'panning' },
  panning: { move: 'panning', up: 'idle', cancel: 'idle' },
};

class HandTool implements ToolHandlers {
  readonly #ctx: ToolContext;
  readonly #machine = new StateMachine(HAND_MACHINE, 'idle');
  #lastX = 0;
  #lastY = 0;

  constructor(ctx: ToolContext) {
    this.#ctx = ctx;
  }

  get state(): string {
    return this.#machine.state;
  }

  onDown(s: InputSample): void {
    if (!this.#machine.send('down')) return;
    this.#lastX = s.x;
    this.#lastY = s.y;
  }

  onMove(s: InputSample): void {
    if (!this.#machine.send('move')) return;
    this.#ctx.camera()?.panBy(s.x - this.#lastX, s.y - this.#lastY);
    this.#lastX = s.x;
    this.#lastY = s.y;
    this.#ctx.requestFrame();
  }

  onUp(s: InputSample): void {
    if (this.#machine.state !== 'panning') return;
    this.onMove(s);
    this.#machine.send('up');
  }

  onCancel(): void {
    this.#machine.send('cancel');
  }
}

export const handTool: ToolDef = {
  id: 'hand',
  label: 'Hand',
  key: 'h',
  create: (ctx) => new HandTool(ctx),
};
