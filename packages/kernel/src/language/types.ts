/**
 * Language types: core design section 4 plus `Relation`, `Function<R>` with a parameter count and
 * `List<T>` (docs/features/language/design.md 3.10), type sets for command parameters, and the
 * operator table.
 */
import type { TypeName } from '../contracts/values';

export interface Ty {
  readonly k: TypeName | 'Relation';
  /** Element type of a List. Undefined in a parameter spec means "any list". */
  readonly of?: Ty;
  /** Codomain of a Function: Number or Point. A predicate has Bool. */
  readonly ret?: TypeName;
  /** Parameter count of a Function (1 to 4). */
  readonly arity?: number;
  /** Schema name of a Record (`Record<LU>`): its fields come from `recordSchema`. Undefined in a parameter accepts any. */
  readonly schema?: string;
}

const mk = (k: Ty['k']): Ty => ({ k });

export const T = {
  Number: mk('Number'),
  Bool: mk('Bool'),
  Text: mk('Text'),
  Point: mk('Point'),
  Vector: mk('Vector'),
  Segment: mk('Segment'),
  Ray: mk('Ray'),
  Line: mk('Line'),
  Circle: mk('Circle'),
  Arc: mk('Arc'),
  Polygon: mk('Polygon'),
  Curve: mk('Curve'),
  Region: mk('Region'),
  Color: mk('Color'),
  Particles: mk('Particles'),
  Relation: mk('Relation'),
} as const;

declare module '../contracts/values' {
  interface AreaTypeNames {
    // language: a function of one or two numbers that returns a Bool (curves-loci design 1)
    Predicate: true;
    Predicate2: true;
    // language: a range of cells and a cell address, only as command arguments (spreadsheet design 3.2)
    Range: true;
    CellAddr: true;
  }
}

export const listOf = (of: Ty): Ty => ({ k: 'List', of });
/** The type of `p(x) = x^2 > 4` (one parameter) and `q(x, y) = x^2 + y^2 < 4` (two). */
export const predOf = (arity: 1 | 2): Ty => ({ k: arity === 1 ? 'Predicate' : 'Predicate2', ret: 'Bool', arity });
/** True for a type an object call `name(args)` can call: a function or a predicate. */
export const isCallableTy = (t: Ty): boolean => t.k === 'Function' || t.k === 'Predicate' || t.k === 'Predicate2';
export const fnOf = (ret: TypeName, arity: number): Ty => ({ k: 'Function', ret, arity });

/**
 * Type names that carry a schema, written `Name<Schema>`: `Record<LU>`, `Chart<Histogram>`. The fields of a value of such
 * a type come from its schema. An area adds a name with `registerSchemaType` (statistics adds `Chart` and `Table`).
 */
const SCHEMA_TYPES = new Set<string>(['Record']);

export function registerSchemaType(name: string): void {
  SCHEMA_TYPES.add(name);
}

export const isSchemaType = (k: string): boolean => SCHEMA_TYPES.has(k);

export function tyEq(a: Ty, b: Ty): boolean {
  if (a.k !== b.k) return false;
  if (a.k === 'List') return a.of !== undefined && b.of !== undefined ? tyEq(a.of, b.of) : a.of === b.of;
  if (a.k === 'Function') return a.ret === b.ret && a.arity === b.arity;
  if (SCHEMA_TYPES.has(a.k)) return a.schema === b.schema;
  return true;
}

/** Text of a type as written in messages and forms: `Number`, `List<Point>`, `Function<Number>`. */
export function tyStr(t: Ty): string {
  if (t.k === 'List') return t.of ? `List<${tyStr(t.of)}>` : 'List';
  if (t.k === 'Function') {
    const r = t.ret ?? 'Number';
    return t.arity !== undefined && t.arity > 1 ? `Function<${r}>(${t.arity})` : `Function<${r}>`;
  }
  if (SCHEMA_TYPES.has(t.k) && t.schema !== undefined) return `${t.k}<${t.schema}>`;
  return t.k;
}

/* ------------------------------ type sets ------------------------------ */

/** A set of acceptable types for a parameter. */
export interface TypeSet {
  readonly text: string;
  /** Members; a List without `of` accepts any list, a Function without `ret` accepts any function. */
  readonly members: readonly Ty[];
  /** Accepts any type. */
  readonly any: boolean;
  /** Smaller is more specific. */
  readonly size: number;
}

export const TYPE_ALIASES: Record<string, readonly string[]> = {
  Shape: ['Point', 'Segment', 'Ray', 'Line', 'Circle', 'Arc', 'Polygon', 'Curve', 'Vector'],
  Path: ['Segment', 'Ray', 'Line', 'Circle', 'Arc', 'Curve', 'Function'],
  Curvelike: ['Function<Point>', 'Curve'],
  Scalar: ['Number'],
};

/**
 * An area adds a parameter-type alias: `Distribution` accepts `ContinuousDistribution` and `DiscreteDistribution`. An alias
 * is only for parameters; values always have one of its members as their type. The first call for a name wins.
 */
export function registerTypeAlias(name: string, members: readonly string[]): void {
  if (Object.hasOwn(TYPE_ALIASES, name)) return;
  TYPE_ALIASES[name] = members.slice();
  setCache.clear();
}

/**
 * Parse one type as written in a table: `Number`, `List<Point>`, `Function<Number>`, `Function<Number>(2)`,
 * `Function<Number, 2>`. `Function2` is the name README decision 5 gives to `Function<Number>(2)`, a user function of
 * two variables, and means the same type. The base name is not checked here; `typeProblem` does that.
 */
export function parseTy(text: string): Ty | undefined {
  const t = text.trim();
  if (t === 'Function2') return fnOf('Number', 2);
  if (t === 'Predicate') return predOf(1);
  if (t === 'Predicate2') return predOf(2);
  const m = /^(\w+)(?:<(.+)>)?(?:\((\d)\))?$/.exec(t);
  if (!m) return undefined;
  const base = m[1] as string;
  const inner = m[2];
  const count = m[3];
  if (count !== undefined && base !== 'Function') return undefined;
  if (base === 'List') {
    if (inner === undefined) return { k: 'List' };
    const el = parseTy(inner);
    return el ? { k: 'List', of: el } : undefined;
  }
  if (base === 'Function') {
    if (inner === undefined) return count === undefined ? { k: 'Function' } : undefined;
    const n = /^(\w+)(?:\s*,\s*(\d))?$/.exec(inner);
    if (!n) return undefined;
    const arity = n[2] ?? count;
    if (n[2] !== undefined && count !== undefined) return undefined;
    return arity ? { k: 'Function', ret: n[1] as TypeName, arity: Number(arity) } : { k: 'Function', ret: n[1] as TypeName };
  }
  if (SCHEMA_TYPES.has(base)) {
    if (inner === undefined) return { k: base as TypeName };
    return /^\w+$/.test(inner) ? { k: base as TypeName, schema: inner } : undefined;
  }
  if (inner !== undefined) return undefined;
  return { k: base as TypeName };
}

/** Type names the language itself knows. Areas that add a type pass it to `checkTable` as an extra name. */
export const CORE_TYPE_NAMES: readonly string[] = [
  'Number', 'Bool', 'Text', 'Point', 'Vector', 'Segment', 'Ray', 'Line', 'Circle', 'Arc', 'Polygon', 'Function', 'Curve',
  'Region', 'List', 'Color', 'Particles', 'Relation', 'Predicate', 'Predicate2',
];

/**
 * What is wrong with a parameter or return type text, or `undefined` when it is fine: the piece that is not a type
 * (`Fnord`, `List<Banana>`, an empty text). `known` is the set of base type names. Unions (`Number|Point`), aliases,
 * `Any`, `List<T>`, `Function<R>`, `Function<R>(n)` with n from 1 to 4, and `Function2` are accepted.
 */
export function typeTextProblem(text: string, known: ReadonlySet<string>): string | undefined {
  for (const part of text.split('|')) {
    const bad = oneTypeProblem(part.trim(), known);
    if (bad !== undefined) return bad;
  }
  return undefined;
}

function oneTypeProblem(t: string, known: ReadonlySet<string>): string | undefined {
  if (t === '') return 'an empty type';
  if (t === 'Any' || t === 'Function2' || Object.hasOwn(TYPE_ALIASES, t)) return undefined;
  // `@list`: the element type of the list parameter named list (a binder, a value or a result)
  if (/^@\w+$/.test(t)) return undefined;
  const m = /^(\w+)(?:<(.+)>)?(?:\((\d)\))?$/.exec(t);
  if (!m) return t;
  const base = m[1] as string;
  const inner = m[2];
  const count = m[3];
  if (base === 'List') return count === undefined ? (inner === undefined ? undefined : oneTypeProblem(inner.trim(), known)) : t;
  if (SCHEMA_TYPES.has(base)) return count === undefined && (inner === undefined || /^\w+$/.test(inner)) && known.has(base) ? undefined : t;
  if (base === 'Function') {
    if (inner === undefined) return count === undefined ? undefined : t;
    const n = /^(\w+)(?:\s*,\s*(\d))?$/.exec(inner);
    if (!n) return t;
    if (!known.has(n[1] as string)) return n[1] as string;
    if (n[2] !== undefined && count !== undefined) return t;
    const arity = n[2] ?? count;
    return arity === undefined || (Number(arity) >= 1 && Number(arity) <= 4) ? undefined : t;
  }
  if (inner !== undefined || count !== undefined) return t;
  return known.has(base) ? undefined : base;
}

const setCache = new Map<string, TypeSet>();

/** Parse a parameter type: `Number`, `List<Point>`, `Function<Number>`, `Shape`, `Number|Point`, `Any`. */
export function typeSet(text: string): TypeSet {
  const hit = setCache.get(text);
  if (hit) return hit;
  const members: Ty[] = [];
  let any = false;
  for (const part of text.split('|')) {
    const p = part.trim();
    if (p === 'Any') {
      any = true;
      continue;
    }
    const alias = Object.hasOwn(TYPE_ALIASES, p) ? TYPE_ALIASES[p] : undefined;
    if (alias) {
      for (const a of alias) {
        const t = parseTy(a);
        if (t) members.push(t);
      }
      continue;
    }
    const t = parseTy(p);
    if (t) members.push(t);
  }
  const set: TypeSet = { text, members, any, size: any ? 1000 : members.length };
  setCache.set(text, set);
  return set;
}

/** Does `member` (possibly with wildcards) accept `t`? */
export function memberAccepts(member: Ty, t: Ty): boolean {
  if (member.k !== t.k) return false;
  if (member.k === 'List') {
    if (member.of === undefined) return true;
    return t.of !== undefined && memberAccepts(member.of, t.of);
  }
  if (member.k === 'Function') {
    if (member.ret !== undefined && member.ret !== t.ret) return false;
    if (member.arity !== undefined && member.arity !== t.arity) return false;
    return true;
  }
  if (SCHEMA_TYPES.has(member.k)) return member.schema === undefined || member.schema === t.schema;
  return true;
}

export function accepts(set: TypeSet, t: Ty): boolean {
  if (set.any) return true;
  for (const m of set.members) if (memberAccepts(m, t)) return true;
  return false;
}

/** Human text of what a set accepts: "Number or Point". */
export function setLabel(set: TypeSet): string {
  if (set.any) return 'any value';
  const names: string[] = [];
  for (const m of set.members) names.push(m.k === 'List' || m.k === 'Function' ? tyStr(m) : m.k);
  const uniq = [...new Set(names)];
  if (uniq.length === 0 || uniq.length > 6) return set.text;
  if (uniq.length <= 1) return uniq.join('');
  return uniq.slice(0, -1).join(', ') + ' or ' + uniq[uniq.length - 1];
}

/** Is there a type accepted by both sets (used by the table-ambiguity test)? */
export function setsIntersect(a: TypeSet, b: TypeSet): boolean {
  if (a.any || b.any) return true;
  for (const x of a.members) {
    for (const y of b.members) {
      if (memberAccepts(x, y) || memberAccepts(y, x)) return true;
    }
  }
  return false;
}

/* ----------------------------- operator table ----------------------------- */

export type OpVariant =
  | 'num' | 'num*vec' | 'vec*num' | 'vec/num' | 'vec+vec' | 'vec-vec' | 'pt+vec' | 'pt-vec' | 'pt-pt'
  | 'fn' | 'text+text' | 'bool' | 'list-num' | 'cmp-eq' | 'cmp-num' | 'area';

/**
 * An area's operator: it gets the two values (never undefined) and the evaluation environment, and returns the result or
 * `undefined` after setting a reason (`fail(env, reason, detail)`).
 */
export type AreaOpImpl = (a: unknown, b: unknown, env: unknown) => unknown;

export interface OpResult {
  readonly result: Ty;
  readonly variant: OpVariant;
  /** For an area's row (`variant: 'area'`). */
  readonly impl?: AreaOpImpl;
}

/** An area's rows of the operator table (a Matrix area adds `A * B`). Consulted only when no core row fits. */
export type AreaBinaryRow = (op: string, l: Ty, r: Ty) => { readonly result: Ty; readonly impl: AreaOpImpl } | undefined;
/** An area's unary rows (`-A`). */
export type AreaUnaryRow = (op: string, a: Ty) => { readonly result: Ty; readonly impl: (a: unknown, env: unknown) => unknown } | undefined;
/** An area's indexing (`M[i]`): the result type for a target and index type, and how to read it. */
export type AreaIndexRow = (target: Ty, index: Ty) => { readonly result: Ty; readonly impl: AreaOpImpl } | undefined;

const AREA_BINARY: AreaBinaryRow[] = [];
const AREA_UNARY: AreaUnaryRow[] = [];
const AREA_INDEX: AreaIndexRow[] = [];

export function registerBinaryOp(row: AreaBinaryRow): void {
  if (!AREA_BINARY.includes(row)) AREA_BINARY.push(row);
}
export function registerUnaryOp(row: AreaUnaryRow): void {
  if (!AREA_UNARY.includes(row)) AREA_UNARY.push(row);
}
export function registerIndexOp(row: AreaIndexRow): void {
  if (!AREA_INDEX.includes(row)) AREA_INDEX.push(row);
}

export function areaUnaryOp(op: string, a: Ty): ReturnType<AreaUnaryRow> {
  for (const row of AREA_UNARY) {
    const r = row(op, a);
    if (r) return r;
  }
  return undefined;
}

export function areaIndexOp(target: Ty, index: Ty): ReturnType<AreaIndexRow> {
  for (const row of AREA_INDEX) {
    const r = row(target, index);
    if (r) return r;
  }
  return undefined;
}

/** Binary arithmetic and comparison: the core rows, then the areas' rows. Exact match on both operand types, no coercion. */
export function binaryOp(op: string, l: Ty, r: Ty): OpResult | undefined {
  const core = coreBinaryOp(op, l, r);
  if (core) return core;
  for (const row of AREA_BINARY) {
    const x = row(op, l, r);
    if (x) return { result: x.result, variant: 'area', impl: x.impl };
  }
  return undefined;
}

const isFnNum = (t: Ty): boolean => t.k === 'Function' && t.ret === 'Number';
const EQ_TYPES: ReadonlySet<string> = new Set(['Number', 'Bool', 'Text', 'Point', 'Vector']);

function coreBinaryOp(op: string, l: Ty, r: Ty): OpResult | undefined {
  const arith = op === '+' || op === '-' || op === '*' || op === '/' || op === '^';
  if (arith) {
    if (l.k === 'Number' && r.k === 'Number') return { result: T.Number, variant: 'num' };
    if (op === '*' && l.k === 'Number' && r.k === 'Vector') return { result: T.Vector, variant: 'num*vec' };
    if (op === '*' && l.k === 'Vector' && r.k === 'Number') return { result: T.Vector, variant: 'vec*num' };
    if (op === '/' && l.k === 'Vector' && r.k === 'Number') return { result: T.Vector, variant: 'vec/num' };
    if (op === '+' && l.k === 'Vector' && r.k === 'Vector') return { result: T.Vector, variant: 'vec+vec' };
    if (op === '-' && l.k === 'Vector' && r.k === 'Vector') return { result: T.Vector, variant: 'vec-vec' };
    if (op === '+' && l.k === 'Point' && r.k === 'Vector') return { result: T.Point, variant: 'pt+vec' };
    if (op === '-' && l.k === 'Point' && r.k === 'Vector') return { result: T.Point, variant: 'pt-vec' };
    if (op === '-' && l.k === 'Point' && r.k === 'Point') return { result: T.Vector, variant: 'pt-pt' };
    if (op === '+' && l.k === 'Text' && r.k === 'Text') return { result: T.Text, variant: 'text+text' };
    if (op !== '^') {
      if (isFnNum(l) && (r.k === 'Number' || isFnNum(r))) return { result: fnOf('Number', Math.max(l.arity ?? 1, r.arity ?? 1)), variant: 'fn' };
      if (op !== '/' && l.k === 'Number' && isFnNum(r)) return { result: fnOf('Number', r.arity ?? 1), variant: 'fn' };
      if (l.k === 'List' && l.of?.k === 'Number' && r.k === 'Number') return { result: listOf(T.Number), variant: 'list-num' };
    } else if (isFnNum(l) && r.k === 'Number') {
      return { result: fnOf('Number', l.arity ?? 1), variant: 'fn' };
    }
    return undefined;
  }
  if (op === 'and' || op === 'or' || op === 'xor') {
    return l.k === 'Bool' && r.k === 'Bool' ? { result: T.Bool, variant: 'bool' } : undefined;
  }
  if (op === '==' || op === '!=') {
    return l.k === r.k && EQ_TYPES.has(l.k) ? { result: T.Bool, variant: 'cmp-eq' } : undefined;
  }
  if (op === '<' || op === '<=' || op === '>' || op === '>=') {
    return l.k === 'Number' && r.k === 'Number' ? { result: T.Bool, variant: 'cmp-num' } : undefined;
  }
  return undefined;
}

/** Operators that have some row for the left type: used to hint at the legal neighbours. */
export function legalOpsFor(op: string, l: Ty): string[] {
  const out: string[] = [];
  const tests: Ty[] = [T.Number, T.Vector, T.Point, T.Text, T.Bool, fnOf('Number', 1), listOf(T.Number)];
  for (const r of tests) if (binaryOp(op, l, r)) out.push(tyStr(r));
  return out;
}
