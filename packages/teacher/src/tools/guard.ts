/**
 * One tool call at a time on a target (docs/state-machines.md TE2). The guard is one field over `TOOL_MACHINE`.
 */
import { StateMachine } from '@incantly/kernel';
import type { ErrorObject, MachineTable } from '@incantly/kernel';
import { refusedMove } from '../errors';

export type ToolState = 'idle' | 'running';
export type ToolMove = 'begin' | 'end';

export const TOOL_MACHINE: MachineTable<ToolState, ToolMove> = {
  idle: { begin: 'running' },
  running: { end: 'idle' },
};

export class ToolGuard {
  private readonly machine: StateMachine<ToolState, ToolMove>;

  /** `report` hears a refused move (a bug); the host decides where it goes. */
  constructor(report: (e: ErrorObject) => void = () => undefined) {
    this.machine = new StateMachine(TOOL_MACHINE, 'idle', refusedMove('tool guard', report));
  }

  /** True, and the guard is `running`, when no call was running; false when one is (the caller answers `tool_busy`). */
  enter(): boolean {
    return this.machine.can('begin') && this.machine.send('begin');
  }

  /** Ends the call `enter` began. */
  leave(): void {
    if (this.machine.can('end')) this.machine.send('end');
  }

  get busy(): boolean {
    return this.machine.is('running');
  }
}
