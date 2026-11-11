/**
 * The command registry: the hooks that geometry, functions, transforms and the other areas plug commands into
 * (core design section 5). The kernel provides the contract and the dispatch, not the commands.
 *
 * A command form's `rule` factory receives the bound arguments and returns a `CommandRule` (an object command) or an
 * `ActionRule` (an action). The kernel calls `run` whenever the object has to be computed.
 */
import type { ErrorObject } from '../contracts/errors';
import type { UndefReason, ObjId } from '../contracts/values';
import type { Limits } from '../errors/limits';
import type { Slice } from './types';
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
  /** For each argument, the object it names when it is a plain object name (`Locus(P, M)`), else `undefined`. */
  readonly ids: readonly (ObjId | undefined)[];
  /**
   * The figure's tolerance for equality tests (parallel, coincident, collinear, root and integral checks): `1e-9` unless the
   * figure says otherwise (`@tol N` or the `tolerance` option). Rules scale it themselves: `tol * max(1, |scale|)`.
   */
  readonly tol: number;
  /** The work budget of this run of the rule. */
  readonly work: RuleWork;
  /** The figure's size limits, `extra` included. */
  readonly limits: Limits;
  /**
   * Evaluates the rules between a free object (or `'t'`, the clock) and a target object on a scratch copy, leaving the figure
   * as it was; safe to call inside a rule. Both are ids from `ids`. An error when an id is unknown or the source is not free.
   */
  slice(source: ObjId | 't', target: ObjId): Slice | ErrorObject;
}

/**
 * A count of the steps a rule run may take, so that an iteration cap is the same on every machine (errors design 8).
 * The limit is `Limits.ruleWork`. A rule that loops calls `spend` each time round and, when it returns false, ends with
 * `call.fail('no_convergence')` or `call.fail('timeout')`.
 */
export interface RuleWork {
  readonly limit: number;
  /** Steps spent so far in this run. */
  readonly used: number;
  /** Steps left, never below 0. */
  readonly left: number;
  /** Spends `n` steps (default 1). False when the budget is spent; once false it stays false. */
  spend(n?: number): boolean;
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
  /** As `RuleCall.ids`. */
  readonly ids: readonly (ObjId | undefined)[];
  /** As `RuleCall.tol`. */
  readonly tol: number;
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
