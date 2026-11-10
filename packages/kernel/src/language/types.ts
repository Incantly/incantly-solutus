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
  /** Codomain of a Function: Number or Point. */
  readonly ret?: TypeName;
  /** Parameter count of a Function (1 to 4). */
  readonly arity?: number;
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

export const listOf = (of: Ty): Ty => ({ k: 'List', of });
export const fnOf = (ret: TypeName, arity: number): Ty => ({ k: 'Function', ret, arity });

export function tyEq(a: Ty, b: Ty): boolean {
  if (a.k !== b.k) return false;
  if (a.k === 'List') return a.of !== undefined && b.of !== undefined ? tyEq(a.of, b.of) : a.of === b.of;
  if (a.k === 'Function') return a.ret === b.ret && a.arity === b.arity;
  return true;
}

/** Text of a type as written in messages and forms: `Number`, `List<Point>`, `Function<Number>`. */
export function tyStr(t: Ty): string {
  if (t.k === 'List') return t.of ? `List<${tyStr(t.of)}>` : 'List';
  if (t.k === 'Function') {
    const r = t.ret ?? 'Number';
    return t.arity !== undefined && t.arity > 1 ? `Function<${r}>(${t.arity})` : `Function<${r}>`;
  }
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

export const TYPE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  Shape: ['Point', 'Segment', 'Ray', 'Line', 'Circle', 'Arc', 'Polygon', 'Curve', 'Vector'],
  Path: ['Segment', 'Ray', 'Line', 'Circle', 'Arc', 'Curve', 'Function'],
  Curvelike: ['Function<Point>', 'Curve'],
  Scalar: ['Number'],
};

export function parseTy(text: string): Ty | undefined {
  const t = text.trim();
  const m = /^(\w+)(?:<(.+)>)?$/.exec(t);
  if (!m) return undefined;
  const base = m[1] as string;
  const inner = m[2];
  if (base === 'List') {
    if (inner === undefined) return { k: 'List' };
    const el = parseTy(inner);
    return el ? { k: 'List', of: el } : undefined;
  }
  if (base === 'Function') {
    if (inner === undefined) return { k: 'Function' };
    const n = /^(\w+)(?:\s*,\s*(\d))?$/.exec(inner);
    if (!n) return undefined;
    return n[2] ? { k: 'Function', ret: n[1] as TypeName, arity: Number(n[2]) } : { k: 'Function', ret: n[1] as TypeName };
  }
  return { k: base as TypeName };
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
    const alias = TYPE_ALIASES[p];
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
  if (uniq.length > 6) return set.text;
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
  | 'fn' | 'text+text' | 'bool' | 'list-num' | 'cmp-eq' | 'cmp-num';

export interface OpResult {
  readonly result: Ty;
  readonly variant: OpVariant;
}

const isFnNum = (t: Ty): boolean => t.k === 'Function' && t.ret === 'Number';
const EQ_TYPES: ReadonlySet<string> = new Set(['Number', 'Bool', 'Text', 'Point', 'Vector']);

/** Binary arithmetic and comparison. Exact match on both operand types, no coercion. */
export function binaryOp(op: string, l: Ty, r: Ty): OpResult | undefined {
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
