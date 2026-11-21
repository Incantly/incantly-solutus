/**
 * The laser (design 6.4, docs/state-machines.md B9): a trail that fades, for pointing. Nothing is stored. The trail
 * has no clock of its own: the time of each sample and the `now` given to `tick` come from the input layer.
 */
import { StateMachine } from '@incantly/kernel';
import { sendIfAble } from '../machine';
import { refusedMove } from '../errors';
import type { MachineTable } from '@incantly/kernel';
import type { TrailView } from '../draw';
import type { InputSample } from '../input';
import type { ToolContext, ToolDef, ToolHandlers } from './def';

type LaserState = 'idle' | 'pointing' | 'fading';
type LaserEvent = 'down' | 'move' | 'up' | 'cancel' | 'faded';

export const LASER_MACHINE: MachineTable<LaserState, LaserEvent> = {
  idle: { down: 'pointing' },
  pointing: { move: 'pointing', up: 'fading', cancel: 'fading' },
  fading: { down: 'pointing', faded: 'idle' },
};

/** A point of the trail lives this long, in milliseconds. */
export const LASER_FADE_MS = 1200;
/** The trail holds at most this many points. */
export const LASER_MAX_POINTS = 256;

class LaserTool implements ToolHandlers {
  readonly #ctx: ToolContext;
  readonly #machine = new StateMachine(LASER_MACHINE, 'idle', refusedMove('laser', () => this.#ctx.core.store.sink));
  readonly #xy = new Float32Array(LASER_MAX_POINTS * 2);
  readonly #time = new Float64Array(LASER_MAX_POINTS);
  readonly #age = new Float32Array(LASER_MAX_POINTS);
  #count = 0;

  constructor(ctx: ToolContext) {
    this.#ctx = ctx;
  }

  get state(): string {
    return this.#machine.state;
  }

  onDown(s: InputSample): void {
    if (!this.#machine.send('down')) return;
    this.#add(s);
  }

  onMove(s: InputSample): void {
    if (this.#machine.is('pointing')) this.#add(s);
  }

  onUp(s: InputSample): void {
    if (!this.#machine.is('pointing')) return;
    this.#add(s);
    this.#machine.send('up');
  }

  onCancel(): void {
    sendIfAble(this.#machine, 'cancel');
  }

  tick(now: number): boolean {
    if (this.#machine.is('idle')) return false;
    let keep = 0;
    for (let i = 0; i < this.#count; i++) {
      const age = (now - (this.#time[i] as number)) / LASER_FADE_MS;
      if (age >= 1) continue;
      this.#xy[keep * 2] = this.#xy[i * 2] as number;
      this.#xy[keep * 2 + 1] = this.#xy[i * 2 + 1] as number;
      this.#time[keep] = this.#time[i] as number;
      this.#age[keep] = Math.max(0, age);
      keep++;
    }
    this.#count = keep;
    if (keep === 0 && this.#machine.is('fading')) {
      this.#machine.send('faded');
      this.#ctx.overlay.laser = null;
      return false;
    }
    this.#ctx.overlay.laser = this.view();
    return true;
  }

  view(): TrailView {
    return { xy: this.#xy, age: this.#age, count: this.#count };
  }

  #add(s: InputSample): void {
    const camera = this.#ctx.camera();
    if (camera === undefined) return;
    if (this.#count === LASER_MAX_POINTS) {
      this.#xy.copyWithin(0, 2, LASER_MAX_POINTS * 2);
      this.#time.copyWithin(0, 1, LASER_MAX_POINTS);
      this.#count--;
    }
    const p = camera.toPage(s.x, s.y);
    this.#xy[this.#count * 2] = p.x;
    this.#xy[this.#count * 2 + 1] = p.y;
    this.#time[this.#count] = s.time;
    this.#age[this.#count] = 0;
    this.#count++;
    this.#ctx.overlay.laser = this.view();
    this.#ctx.requestFrame();
  }
}

export const laserTool: ToolDef = {
  id: 'laser',
  label: 'Laser',
  key: 'k',
  create: (ctx) => new LaserTool(ctx),
};
