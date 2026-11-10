/**
 * Commands and built-in functions declared as data (core design section 5,
 * docs/features/language/design.md 3.11). The language owns the matcher; the command areas fill
 * the table. `FigureView` is the small interface the kernel implements for name lookups.
 */
import type { ObjId } from '../contracts/values';
import type { Env } from './runtime';
import { accepts, setsIntersect, typeSet } from './types';
import type { Ty } from './types';

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
}

export interface CommandSpec {
  readonly name: string;
  readonly kind: 'object' | 'action';
  readonly group: string;
  readonly forms: readonly CommandForm[];
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
    const t = p.kind === 'binder' ? 'name' : p.type;
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
}

export function createCommandTable(specs: readonly CommandSpec[]): CommandTable {
  const map = new Map<string, CommandSpec>();
  const fold = new Map<string, CommandSpec>();
  for (const s of specs) {
    map.set(s.name, s);
    fold.set(s.name.toLowerCase(), s);
  }
  const names = [...map.keys()].sort();
  return {
    lookup: (n) => map.get(n),
    lookupFold: (n) => fold.get(n.toLowerCase()),
    names: () => names,
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

/** Read-only facts the language needs from the kernel. The kernel implements it. */
export interface FigureView {
  lookup(name: string): ObjectInfo | undefined;
  byId(id: ObjId): ObjectInfo | undefined;
  /** All object names in creation order (the most recent last). */
  names(): readonly string[];
  /** Direct inputs of an object, for the cycle test. */
  inputsOf(id: ObjId): readonly ObjId[];
  /** Objects that read `id` directly, with their definition source. */
  dependentsOf(id: ObjId): readonly ObjectInfo[];
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
}

export function createFunctionTable(specs: readonly FunctionSpec[]): FunctionTable {
  const map = new Map<string, FunctionSpec>();
  for (const s of specs) map.set(s.name, s);
  const names = [...map.keys()].sort();
  return { lookup: (n) => map.get(n), names: () => names };
}

/* ----------------------- ambiguity test for a table ----------------------- */

export interface TableProblem {
  readonly command: string;
  readonly a: string;
  readonly b: string;
  readonly message: string;
}

/**
 * The "no ambiguous overloads" test: for every pair of forms that can both accept the same
 * arguments, one must be strictly more specific. Run in CI over the full command table.
 */
export function checkTable(table: CommandTable | readonly CommandSpec[]): TableProblem[] {
  const specs = Array.isArray(table) ? (table as readonly CommandSpec[]) : (table as CommandTable).names().map((n) => (table as CommandTable).lookup(n) as CommandSpec);
  const problems: TableProblem[] = [];
  for (const spec of specs) {
    const forms = spec.forms;
    for (let i = 0; i < forms.length; i++) {
      for (let j = i + 1; j < forms.length; j++) {
        const f = forms[i] as CommandForm;
        const g = forms[j] as CommandForm;
        const min = Math.max(requiredCount(f), requiredCount(g));
        const max = Math.min(f.params.length, g.params.length);
        for (let n = min; n <= max; n++) {
          let overlap = true;
          let sf = 0;
          let sg = 0;
          for (let k = 0; k < n; k++) {
            const a = typeSet((f.params[k] as ParamSpec).type);
            const b = typeSet((g.params[k] as ParamSpec).type);
            if (!setsIntersect(a, b)) {
              overlap = false;
              break;
            }
            sf += a.size;
            sg += b.size;
          }
          if (overlap && sf === sg) {
            problems.push({
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
  return problems;
}

function requiredCount(f: CommandForm): number {
  let n = 0;
  for (const p of f.params) if (!p.optional) n++;
  return n;
}

export { accepts };
