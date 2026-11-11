/**
 * Commands and built-in functions declared as data (core design section 5,
 * docs/features/language/design.md 3.11). The language owns the matcher; the command areas fill
 * the table. `FigureView` is the small interface the kernel implements for name lookups.
 */
import type { ObjId } from '../contracts/values';
import type { Env } from './runtime';
import { CORE_TYPE_NAMES, accepts, memberAccepts, setsIntersect, typeSet, typeTextProblem } from './types';
import type { Ty, TypeSet } from './types';

export type ParamKind = 'value' | 'binder' | 'body';

export type ConstValue = number | boolean | string;

export interface ParamSpec {
  readonly name: string;
  /**
   * A type, an alias or a union: `Number`, `List<Point>`, `Function<Number>`, `Shape`, `Number|Point`,
   * `Relation`, `Any`. See `typeSet` in types.ts.
   */
  readonly type: string;
  readonly optional?: boolean;
  /** Default `value`. A `binder` is a bare name that becomes a local; a `body` is checked in the binders' scope. */
  readonly kind?: ParamKind;
  /** Used when optional and omitted. */
  readonly default?: ConstValue;
  /** Names that exist only inside this body argument (for example `i u v age` in `Particles`). */
  readonly scope?: readonly { readonly name: string; readonly type: string }[];
}

/** What a rule factory receives for one argument. */
export interface BoundArg {
  readonly param: ParamSpec;
  /** The checked expression; absent when a default was used or for a binder. */
  readonly expr?: unknown;
  /** The binder's local name. */
  readonly binder?: string;
  /** The default value when the argument was omitted. */
  readonly value?: ConstValue;
  readonly omitted: boolean;
}

/** Builds the rule from checked inputs. Opaque to the language; the kernel defines it. */
export type RuleFactory = (args: readonly BoundArg[]) => unknown;

/**
 * What a check-time hook sees of one argument (errors design, "Check time"). The hook runs while the line is being
 * checked, before anything is committed, so it reads only what the text of the line fixes.
 */
export interface ArgFacts {
  /** The type as text: `Number`, `Line`, `List<Point>`, `Function<Number>(1)`. Empty for an omitted argument. */
  readonly type: string;
  /**
   * The value when the argument is written as a literal: a number (also `-2`, a named constant), a boolean, a text with
   * no interpolation, a point of literal numbers as `{ x, y }`, or a list of literals as an array. Otherwise `undefined`.
   */
  readonly literal: unknown;
  /** The argument as written. */
  readonly text: string;
  /** True when the argument was left out. */
  readonly omitted: boolean;
  /**
   * When the argument is the bare name of an existing object: its value now (`undefined` while the object is
   * undefined). A hook may read facts the value fixes (a polygon's corner count, whether a function is a polynomial).
   */
  readonly value?: unknown;
  /** When the argument is the bare name of an existing object: its defining line as text. */
  readonly source?: string;
}

/** The arguments of the chosen form, in parameter order, then the rest arguments. */
export interface FormCheck {
  readonly command: string;
  readonly args: readonly ArgFacts[];
  readonly rest: readonly ArgFacts[];
}

/** The arguments as written, when no form of the command fits them. */
export interface CallCheck {
  readonly command: string;
  readonly args: readonly ArgFacts[];
}

/**
 * A line refused at check time. The kind must be registered in the error table. `param` (an index into `args`, or into
 * `rest` when `inRest` is true) is the argument the error points at; without it the whole call is the span.
 */
export interface Refusal {
  readonly kind: string;
  /** One plain sentence. */
  readonly message: string;
  readonly hint?: string;
  readonly param?: number;
  readonly inRest?: boolean;
  /** Up to 3 complete replacement lines. */
  readonly suggest?: readonly string[];
  /** Params for the kind's message template, when it has one. */
  readonly params?: Readonly<Record<string, string | number | boolean | readonly string[]>>;
  /** For a `limit` refusal: the limit's name, its size and what the line asked for. */
  readonly limit?: { readonly name: string; readonly max: number; readonly got: number };
}

export interface CommandForm {
  readonly params: readonly ParamSpec[];
  /** Extra arguments of one type after `params`, such as the objects in `Hide(obj, …)`. */
  readonly rest?: ParamSpec;
  /** Result type text (`Point`, `List<Point>`), a tuple for `defmany`, or null for actions. */
  readonly returns: string | readonly string[] | null;
  readonly rule: RuleFactory;
  /** One line for the catalogue. */
  readonly summary: string;
  /** `'angle'` when the Number result is an angle. */
  readonly unit?: 'angle';
  /** Sentence template for the step list: `{name} is the midpoint of {0} and {1}` (kernel design 12.3). */
  readonly explain?: string;
  /** True when the rule wants to run with undefined arguments (kernel design 6.4); the rule's own flag also counts. */
  readonly acceptsUndefined?: boolean;
  /**
   * Check-time hook: called once the arguments fit this form. A returned refusal fails the line with that error, so a
   * literal that can never work (`Circle(O, -2)`) is an error on the line instead of an undefined object. Must be pure.
   */
  readonly check?: (c: FormCheck) => Refusal | undefined;
}

export interface CommandSpec {
  readonly name: string;
  readonly kind: 'object' | 'action';
  readonly group: string;
  readonly forms: readonly CommandForm[];
  /**
   * Check-time hook for arguments that fit no form: a returned refusal replaces the general `no_matching_form` or
   * `arg_count` error with a specific one (`PointOn(3)` is `not_a_path`). Must be pure.
   */
  readonly refuse?: (c: CallCheck) => Refusal | undefined;
  /** Template for the Algebra view. */
  readonly describe?: string;
}

export interface FunctionForm {
  readonly params: readonly ParamSpec[];
  /** Extra arguments of one type after `params` (for `min(a, b, c, …)`). */
  readonly rest?: ParamSpec;
  readonly returns: string;
  readonly summary: string;
  readonly unit?: 'angle';
  /** Fast paths for Number arguments. They set `env.reason` and return NaN when undefined. */
  readonly n1?: (a: number, env: Env) => number;
  readonly n2?: (a: number, b: number, env: Env) => number;
  readonly n3?: (a: number, b: number, c: number, env: Env) => number;
  /** General form. Arguments arrive as runtime values, already evaluated. */
  readonly call?: (env: Env, args: readonly unknown[]) => unknown;
}

export interface FunctionSpec {
  readonly name: string;
  readonly group: string;
  readonly forms: readonly FunctionForm[];
}

/** What the matcher needs from a form. */
export interface FormLike {
  readonly params: readonly ParamSpec[];
  readonly rest?: ParamSpec | undefined;
  readonly returns: string | readonly string[] | null;
  readonly summary: string;
}

export interface SpecLike<F extends FormLike> {
  readonly name: string;
  readonly forms: readonly F[];
}

/** The line a form prints in the catalogue: `Circle(center: Point, radius: Number) -> Circle`. */
export function formText(name: string, f: FormLike): string {
  const ps = f.params.map((p) => {
    // a function of one variable prints as `Function`, the name the docs use for it
    const t = p.kind === 'binder' ? 'name' : p.type.replace(/Function<Number, 1>/g, 'Function');
    const body = `${p.name}: ${t}`;
    return p.optional ? `[${body}]` : body;
  });
  if (f.rest) ps.push(`${f.rest.name}: ${f.rest.type}, …`);
  const named = (r: string): string => {
    const byName = (n: string): string => f.params.find((p) => p.name === n)?.type ?? n;
    if (r.startsWith('=')) return byName(r.slice(1));
    const m = /^List<=(\w+)>$/.exec(r);
    return m ? `List<${byName(m[1] as string)}>` : r;
  };
  const ret = f.returns === null ? '' : ' -> ' + (typeof f.returns === 'string' ? named(f.returns) : `(${f.returns.map(named).join(', ')})`);
  return `${name}(${ps.join(', ')})${ret}`;
}

/* ------------------------------ the tables ------------------------------ */

export interface CommandTable {
  lookup(name: string): CommandSpec | undefined;
  /** All command names, sorted. */
  names(): readonly string[];
  /** Case-insensitive lookup, for "did you mean". */
  lookupFold(name: string): CommandSpec | undefined;
  /**
   * Commands the table left out because an earlier command has the same name, or the same name in other letter case.
   * The earlier command stays. `checkTable` reports each of them. A table that cannot have any leaves this out.
   */
  duplicates?(): readonly DuplicateName[];
}

/** A later command (`name`) that collides with the earlier one kept in the table (`of`). */
export interface DuplicateName {
  readonly name: string;
  readonly of: string;
}

/**
 * Builds the table. Nothing throws: a command whose name repeats an earlier one (also in other letter case) is left
 * out and listed by `duplicates()`, and `checkTable` turns the list into problems.
 */
export function createCommandTable(specs: readonly CommandSpec[]): CommandTable {
  const map = new Map<string, CommandSpec>();
  const fold = new Map<string, CommandSpec>();
  const dups: DuplicateName[] = [];
  for (const s of specs) {
    const earlier = map.get(s.name) ?? fold.get(s.name.toLowerCase());
    if (earlier) {
      dups.push({ name: s.name, of: earlier.name });
      continue;
    }
    map.set(s.name, s);
    fold.set(s.name.toLowerCase(), s);
  }
  const names = [...map.keys()].sort();
  return {
    lookup: (n) => map.get(n),
    lookupFold: (n) => fold.get(n.toLowerCase()),
    names: () => names,
    duplicates: () => dups,
  };
}

export const EMPTY_COMMANDS: CommandTable = createCommandTable([]);

/* ------------------------------ the figure ------------------------------ */

export interface ObjectInfo {
  readonly id: ObjId;
  readonly name: string;
  readonly type: Ty;
  /** `'angle'` for an angle-tagged Number. */
  readonly unit?: 'angle';
  /** True for a free object (one that holds its own value). */
  readonly free?: boolean;
  /** True for a slider (a free Number with a range). */
  readonly slider?: boolean;
  /** True for a `state(...)` object. */
  readonly state?: boolean;
  /** The definition as source text, used to re-check dependents of a redefined object. */
  readonly source?: string;
}

/**
 * The id a style value uses for the object its own line is defining, when that object does not exist yet (Q-R4-1: in the
 * `with` list of a defining line the name being defined means the new object). It is never an input of anything: a style
 * edge cannot form a cycle. Compile with `selfId` set to the id the kernel gives the new object.
 */
export const SELF_ID = -1 as ObjId;

/** Read-only facts the language needs from the kernel. The kernel implements it. */
export interface FigureView {
  lookup(name: string): ObjectInfo | undefined;
  byId(id: ObjId): ObjectInfo | undefined;
  /** All object names in creation order (the most recent last). */
  names(): readonly string[];
  /** Direct inputs of an object, for the cycle test: value and slider-bound reads, never style reads (kernel design 9.2). */
  inputsOf(id: ObjId): readonly ObjId[];
  /**
   * Objects that read `id` directly, with their definition source: through their value, a slider bound or a style on
   * their defining line. This is the list a redefinition re-checks (language design 3.12 step 4). Unlike `inputsOf`, it
   * includes style readers, because a style edge cannot form a cycle but a redefined input can still break the style.
   */
  dependentsOf(id: ObjId): readonly ObjectInfo[];
  /**
   * Separate property rules (`P with opacity = f(1)` written after `P`) whose values read `id`, each as the line's source,
   * for the same re-check. Optional: a figure without separate rules leaves it out.
   */
  styleRulesReading?(id: ObjId): readonly { readonly name: string; readonly source: string }[];
  readonly commands: CommandTable;
  /** Built-in functions; defaults to the language's own table. */
  readonly functions?: FunctionTable | undefined;
  /** Directive names beyond the language's own. */
  readonly directives?: readonly string[] | undefined;
  /** Number of objects, for the object limit. */
  readonly size?: number | undefined;
  /** Current value of an object, for previews. `undefined` when the object is undefined. */
  read?(id: ObjId): unknown;
  /** Film time for previews. */
  clock?(): { t: number; bt: number; beat: number };
}

export interface FunctionTable {
  lookup(name: string): FunctionSpec | undefined;
  names(): readonly string[];
  /** Functions left out because an earlier function has the same name. `checkFunctionTable` reports them. */
  duplicates?(): readonly DuplicateName[];
}

export function createFunctionTable(specs: readonly FunctionSpec[]): FunctionTable {
  const map = new Map<string, FunctionSpec>();
  const dups: DuplicateName[] = [];
  for (const s of specs) {
    if (map.has(s.name)) {
      dups.push({ name: s.name, of: s.name });
      continue;
    }
    map.set(s.name, s);
  }
  const names = [...map.keys()].sort();
  return { lookup: (n) => map.get(n), names: () => names, duplicates: () => dups };
}

/* ----------------------- ambiguity test for a table ----------------------- */

export type TableProblemKind =
  | 'ambiguous'
  | 'unknown_type'
  | 'duplicate_param'
  | 'duplicate_command'
  | 'bad_name'
  | 'no_forms'
  | 'binder_without_body'
  | 'bad_param';

export interface TableProblem {
  readonly kind: TableProblemKind;
  readonly command: string;
  /** The form the problem is in, as `formText` prints it; empty when it is about the command as a whole. */
  readonly a: string;
  /** The second form of an ambiguous pair; empty otherwise. */
  readonly b: string;
  readonly message: string;
}

export interface CheckTableOptions {
  /** Type names beyond the language's own, such as `Point3` from the 3D area. */
  readonly types?: readonly string[];
}

const COMMAND_NAME = /^[A-Z][A-Za-z0-9_]*$/;
const FUNCTION_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * The load-time test for a command table. Every command has a capitalised name, appears once and has at least one
 * form. Every form has parameters with distinct names and known types, a known result type, and a body for each
 * binder. No two forms are ambiguous: for every pair of forms that can both accept the same arguments, one is
 * strictly more specific. Run in CI over the full command table and by the kernel when it loads one. Each problem
 * names the command.
 */
export function checkTable(table: CommandTable | readonly CommandSpec[], options: CheckTableOptions = {}): TableProblem[] {
  const specs = Array.isArray(table) ? (table as readonly CommandSpec[]) : (table as CommandTable).names().map((n) => (table as CommandTable).lookup(n) as CommandSpec);
  const problems: TableProblem[] = [];
  const known = knownTypes(options);
  if (Array.isArray(table)) {
    const seen = new Set<string>();
    const folded = new Map<string, string>();
    for (const spec of specs) {
      const earlier = seen.has(spec.name) ? spec.name : folded.get(spec.name.toLowerCase());
      if (earlier !== undefined) problems.push(duplicateProblem(spec.name, earlier, 'command'));
      else {
        seen.add(spec.name);
        folded.set(spec.name.toLowerCase(), spec.name);
      }
    }
  } else {
    for (const d of (table as CommandTable).duplicates?.() ?? []) problems.push(duplicateProblem(d.name, d.of, 'command'));
  }
  const visited = new Set<string>();
  for (const spec of specs) {
    if (visited.has(spec.name)) continue;
    visited.add(spec.name);
    if (!COMMAND_NAME.test(spec.name)) problems.push(badNameProblem(spec.name, 'command', 'starts with a capital letter and has only letters, digits and _ after it'));
    if (spec.forms.length === 0) {
      problems.push({ kind: 'no_forms', command: spec.name, a: '', b: '', message: `${spec.name} has no forms; a command needs at least one.` });
      continue;
    }
    for (const f of spec.forms) checkForm(spec.name, f, known, problems);
    checkAmbiguity(spec, problems);
  }
  return problems;
}

/** The same checks for a built-in function table, except that names are lower case and there are no binders. */
export function checkFunctionTable(table: FunctionTable | readonly FunctionSpec[], options: CheckTableOptions = {}): TableProblem[] {
  const specs = Array.isArray(table) ? (table as readonly FunctionSpec[]) : (table as FunctionTable).names().map((n) => (table as FunctionTable).lookup(n) as FunctionSpec);
  const problems: TableProblem[] = [];
  const known = knownTypes(options);
  const seen = new Set<string>();
  if (!Array.isArray(table)) for (const d of (table as FunctionTable).duplicates?.() ?? []) problems.push(duplicateProblem(d.name, d.of, 'function'));
  for (const spec of specs) {
    if (seen.has(spec.name)) {
      problems.push(duplicateProblem(spec.name, spec.name, 'function'));
      continue;
    }
    seen.add(spec.name);
    if (!FUNCTION_NAME.test(spec.name)) problems.push(badNameProblem(spec.name, 'function', 'starts with a lower-case letter and has only lower-case letters, digits and _ after it'));
    if (spec.forms.length === 0) {
      problems.push({ kind: 'no_forms', command: spec.name, a: '', b: '', message: `${spec.name} has no forms; a function needs at least one.` });
      continue;
    }
    for (const f of spec.forms) checkForm(spec.name, f, known, problems);
  }
  return problems;
}

function knownTypes(options: CheckTableOptions): ReadonlySet<string> {
  return new Set([...CORE_TYPE_NAMES, ...(options.types ?? [])]);
}

function badNameProblem(name: string, what: string, rule: string): TableProblem {
  const message = name === '' ? `A ${what} has an empty name.` : `${name}: a ${what} name ${rule}.`;
  return { kind: 'bad_name', command: name, a: '', b: '', message };
}

function duplicateProblem(name: string, of: string, what: string): TableProblem {
  const message =
    name === of
      ? `${name} is declared more than once; only the first ${what} of that name is used.`
      : `${name} has the same name as ${of} in other letter case; only ${of} is used.`;
  return { kind: 'duplicate_command', command: name, a: '', b: '', message };
}

/** Parameter names and types, binders and the result type of one form. */
function checkForm(name: string, f: FormLike, known: ReadonlySet<string>, problems: TableProblem[]): void {
  const text = formText(name, f);
  const add = (kind: TableProblemKind, message: string): void => {
    problems.push({ kind, command: name, a: text, b: '', message: `${name}: ${message}` });
  };
  const all: ParamSpec[] = [...f.params, ...(f.rest ? [f.rest] : [])];
  const names = new Set<string>();
  for (const q of all) {
    if (names.has(q.name)) add('duplicate_param', `the parameter ${q.name} appears twice in ${text}.`);
    names.add(q.name);
    if (q.name === '') add('bad_param', `a parameter has an empty name in ${text}.`);
    const kind: string = q.kind ?? 'value';
    if (kind !== 'value' && kind !== 'binder' && kind !== 'body') add('bad_param', `the parameter ${q.name} has the unknown kind ${kind}.`);
    const bad = typeTextProblem(q.type, known);
    if (bad !== undefined) add('unknown_type', `the parameter ${q.name} has the type ${q.type === '' ? '(empty)' : q.type}, and ${bad} is not a type.`);
    for (const sc of q.scope ?? []) {
      const badScope = typeTextProblem(sc.type, known);
      if (badScope !== undefined) add('unknown_type', `the name ${sc.name} in the scope of ${q.name} has the type ${sc.type}, and ${badScope} is not a type.`);
    }
  }
  if (f.rest && (f.rest.kind === 'binder' || f.rest.kind === 'body')) add('bad_param', `the rest parameter ${f.rest.name} must take values, not a ${f.rest.kind}.`);
  const hasBody = all.some((q) => q.kind === 'body');
  for (const q of all) {
    if (q.kind === 'binder' && !hasBody) add('binder_without_body', `the binder ${q.name} has no body parameter to use it in.`);
  }
  const returns: readonly string[] = f.returns === null ? [] : typeof f.returns === 'string' ? [f.returns] : f.returns;
  if (typeof f.returns === 'object' && f.returns !== null && returns.length === 0) add('unknown_type', 'the result is an empty tuple.');
  for (const r of returns) {
    const ref = /^=(\w+)$/.exec(r) ?? /^List<=(\w+)>$/.exec(r);
    if (ref) {
      if (!names.has(ref[1] as string)) add('unknown_type', `the result type ${r} refers to ${ref[1]}, which is not a parameter.`);
      continue;
    }
    const bad = typeTextProblem(r, known);
    if (bad !== undefined) add('unknown_type', `the result type ${r === '' ? '(empty)' : r} is not a type: ${bad}.`);
  }
}

/** The "no ambiguous overloads" test of one command. */
function checkAmbiguity(spec: CommandSpec, problems: TableProblem[]): void {
  const forms = spec.forms;
  for (let i = 0; i < forms.length; i++) {
    for (let j = i + 1; j < forms.length; j++) {
      const f = forms[i] as CommandForm;
      const g = forms[j] as CommandForm;
      const min = Math.max(requiredCount(f), requiredCount(g));
      const max = Math.min(f.params.length, g.params.length);
      for (let n = min; n <= max; n++) {
        let overlap = true;
        let fLeG = true;
        let gLeF = true;
        for (let k = 0; k < n; k++) {
          const a = typeSet((f.params[k] as ParamSpec).type);
          const b = typeSet((g.params[k] as ParamSpec).type);
          if (!setsIntersect(a, b)) {
            overlap = false;
            break;
          }
          if (!setWithin(a, b)) fLeG = false;
          if (!setWithin(b, a)) gLeF = false;
        }
        // f is strictly more specific than g when it fits inside g everywhere and g does not fit inside f
        const ordered = (fLeG && !gLeF) || (gLeF && !fLeG);
        if (overlap && !ordered) {
          problems.push({
            kind: 'ambiguous',
            command: spec.name,
            a: formText(spec.name, f),
            b: formText(spec.name, g),
            message: `${spec.name}: two forms accept the same ${n}-argument calls and neither is more specific.`,
          });
          break;
        }
      }
    }
  }
}

/** Does every type accepted by `a` also get accepted by `b`? */
function setWithin(a: TypeSet, b: TypeSet): boolean {
  if (b.any) return true;
  if (a.any) return false;
  return a.members.every((m) => b.members.some((n) => memberAccepts(n, m)));
}

function requiredCount(f: CommandForm): number {
  let n = 0;
  for (const p of f.params) if (!p.optional) n++;
  return n;
}

export { accepts };
