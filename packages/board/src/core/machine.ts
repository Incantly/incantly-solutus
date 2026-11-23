/**
 * A move that is allowed to find nothing to do. A state machine reports a refused move to the board's `onError` as
 * `internal` (`state-refusal-reported`), so a call that may arrive in any state (a cancel when nothing is going on, an
 * end after an end) asks first with `can`: the table says the move has no row, and that is the answer, not a fault.
 */
import type { StateMachine } from '@incantly/kernel';

/** Sends `event` when the table has a move for it; false, and nothing reported, when it has none. */
export function sendIfAble<S extends string, E extends string>(machine: StateMachine<S, E>, event: E): boolean {
  return machine.can(event) && machine.send(event);
}
