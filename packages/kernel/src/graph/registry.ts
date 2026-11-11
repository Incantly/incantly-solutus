/**
 * The command registry: the hooks that geometry, functions, transforms and the other areas plug commands into
 * (core design section 5). The kernel provides the contract and the dispatch, not the commands.
 *
 * A command form's `rule` factory receives the bound arguments and returns a `CommandRule` (an object command) or an
 * `ActionRule` (an action). The kernel calls `run` whenever the object has to be computed.
 */
import type { UndefReason, ObjId } from '../contracts/values';
import type { CompiledArg } from '../language/compile';
import type { Env } from '../language/runtime';
import { checkTable, createCommandTable } from '../language/table';
import type { CheckTableOptions, CommandForm, CommandSpec, CommandTable, TableProblem } from '../language/table';

/** A component of a tuple result that is undefined while the others are not (`Intersect` of two circles that touch). */
export class RuleUndefined {
  constructor(
    readonly reason: UndefReason,
    readonly detail?: string,
  ) {}
}

/** `undef('no_intersection')` as a component of a tuple result. */
export const undef = (reason: UndefReason, detail?: string): RuleUndefined => new RuleUndefined(reason, detail);

/** What a rule sees when it runs. */
export interface RuleCall {
  readonly env: Env;
  readonly spec: CommandSpec;
  readonly form: CommandForm;
  readonly args: readonly CompiledArg[];
  /**
   * The evaluated value of each `value` argument, in parameter order. A binder, a body and an omitted argument without
   * a default are `undefined`; an omitted argument with a default holds the default.
   */
  readonly values: readonly unknown[];
  /** Film time. */
  readonly t: number;
  /** Records why the result is undefined and returns `undefined`: `return call.fail('parallel')`. */
  fail(reason: UndefReason, detail?: string): undefined;
  /** Evaluates argument `i` now (for a body argument, in the scope of its binders). */
  evalArg(i: number): unknown;
}

export interface CommandRule {
  /**
   * Computes the value, or fails with `call.fail`. For a form that returns a tuple, an array with one entry per name
   * (an entry may be `undef(...)`). Must be pure: the same inputs, the same output, no clock, no random source.
   */
  run(call: RuleCall): unknown;
  /**
   * When false (the default), a rule does not run if an argument is undefined: the result is `input_undefined` with
   * `cause`. Rules such as `Count` set it and receive `undefined` in `values`.
   */
  readonly acceptsUndefined?: boolean;
  /**
   * Drag support (kernel design 7): given the wanted value of the object, the new values for some parameters.
   * `param` is the parameter index; the kernel writes the value into the free object that argument names.
   */
  invert?(target: unknown, call: InvertCall): readonly { readonly param: number; readonly value: unknown }[] | undefined;
}

export interface InvertCall {
  readonly values: readonly unknown[];
  readonly form: CommandForm;
  readonly spec: CommandSpec;
}

/** What an action sees when it runs. */
export interface ActionCall {
  readonly figure: import('./figure').Figure;
  readonly spec: CommandSpec;
  /** The object ids named by `Any`-typed arguments that are plain object names, in order. */
  readonly objects: readonly ObjId[];
  /** Evaluated values of the other arguments, in parameter order (`undefined` for objects). */
  readonly values: readonly unknown[];
}

export interface ActionOutcome {
  readonly summary?: string;
  readonly data?: unknown;
}

export interface ActionRule {
  run(call: ActionCall): ActionOutcome | void;
}

/** A growing set of command specs. Areas call `register`; the figure builds one table from it. */
export class CommandRegistry {
  private readonly specs: CommandSpec[] = [];
  private cached: CommandTable | undefined;

  constructor(initial: readonly CommandSpec[] = []) {
    this.registerAll(initial);
  }

  register(spec: CommandSpec): void {
    this.specs.push(spec);
    this.cached = undefined;
  }

  registerAll(specs: readonly CommandSpec[]): void {
    for (const s of specs) this.register(s);
  }

  /** The table the language checks against. */
  table(): CommandTable {
    this.cached ??= createCommandTable(this.specs);
    return this.cached;
  }

  /** The load-time test of the table (ambiguous forms, bad types, duplicates). */
  problems(options: CheckTableOptions = {}): TableProblem[] {
    return checkTable(this.specs, options);
  }

  all(): readonly CommandSpec[] {
    return this.specs;
  }
}
