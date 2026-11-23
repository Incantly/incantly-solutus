/**
 * The life of a smoke or fire grid (design 9.4, errors.md 4): it runs until a speed goes over the blow-up limit or
 * stops being a number, then stays `unstable` (every step does nothing) until it is reset or a checkpoint loads.
 */
import type { MachineTable, StateMachine } from '../contracts/state-machine';

export type GridLife = 'running' | 'unstable';
export type GridLifeEvent = 'blowUp' | 'reset';

export const GRID_MACHINE: MachineTable<GridLife, GridLifeEvent> = {
  running: { blowUp: 'unstable' },
  unstable: { reset: 'running' },
};

/** A checkpoint load: puts the life in the state the checkpoint saved, sending an event only when the state differs. */
export function restoreLife(life: StateMachine<GridLife, GridLifeEvent>, unstable: boolean): void {
  if (unstable && life.is('running')) life.send('blowUp');
  else if (!unstable && life.is('unstable')) life.send('reset');
}
