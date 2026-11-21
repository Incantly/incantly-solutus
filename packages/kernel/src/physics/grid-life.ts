/**
 * The life of a smoke or fire grid (design 9.4, errors.md 4): it runs until a speed goes over the blow-up limit or
 * stops being a number, then stays `unstable` (every step does nothing) until it is reset or a checkpoint loads.
 */
import type { MachineTable } from '../contracts/state-machine';

export type GridLife = 'running' | 'unstable';
export type GridLifeEvent = 'blowUp' | 'reset';

export const GRID_MACHINE: MachineTable<GridLife, GridLifeEvent> = {
  running: { blowUp: 'unstable', reset: 'running' },
  unstable: { blowUp: 'unstable', reset: 'running' },
};
