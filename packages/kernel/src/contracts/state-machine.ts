/**
 * Explicit state machines (docs/state-machines.md, lint rules `incantly/state-*`). A machine is a table of states and
 * the events each one accepts; the state changes only through the table, so a move nobody wrote down cannot happen.
 * No DOM, no timers, no Date.
 */

/** For each state, the events it accepts and the state each one leads to. */
export type MachineTable<S extends string, E extends string> = { readonly [K in S]: { readonly [V in E]?: S } };

/** The state after `event` in `from`, or `undefined` when the table has no such move. */
export function transition<S extends string, E extends string>(table: MachineTable<S, E>, from: S, event: E): S | undefined {
  const row = table[from] as { readonly [V in E]?: S } | undefined;
  return row?.[event];
}

/** True when the table has a move for `event` in `from`. */
export function canTransition<S extends string, E extends string>(table: MachineTable<S, E>, from: S, event: E): boolean {
  return transition(table, from, event) !== undefined;
}

/** One state held with its table. A refused event changes nothing and is given to `onRefused`. */
export class StateMachine<S extends string, E extends string> {
  #state: S;

  constructor(
    readonly table: MachineTable<S, E>,
    initial: S,
    private readonly onRefused?: (from: S, event: E) => void,
  ) {
    this.#state = initial;
  }

  get state(): S {
    return this.#state;
  }

  /** True when the machine is in one of `states`. */
  is(...states: readonly S[]): boolean {
    return states.includes(this.#state);
  }

  can(event: E): boolean {
    return canTransition(this.table, this.#state, event);
  }

  /** Moves on `event`; returns false, and changes nothing, when the table has no such move. */
  send(event: E): boolean {
    const next = transition(this.table, this.#state, event);
    if (next === undefined) {
      this.onRefused?.(this.#state, event);
      return false;
    }
    this.#state = next;
    return true;
  }
}
