/**
 * The bridge (cas/design.md 5.1): conversion between the kernel's checked trees (`TNode`)
 * and `SymNode`, following the symbolic-mode rules (5.3) and the number entry rules
 * (5.4), plus the numeric compiler behind `ToFunction`. Pure; failures are `BridgeError`
 * data the kernel maps to its error objects.
 */
import type { ObjId, TNode } from '@incantly/kernel';
import type { Domain } from './contracts';
import type { SymCond, SymFn, SymNode } from './node';
import {
  add, andCond, constN, divideNodes, floatN, fn, intN, listN, mul, negateNode, notCond,
  orCond, piecewiseN, pow, ratN, refN, rel, symN,
} from './node';
import { shortestDecimalRational } from './num';
import { evalAt, substituteList } from './rules';

export type BridgeErrorKind = 'unknown_name' | 'not_symbolic' | 'input_undefined' | 'unsupported_builtin' | 'time_dependent_input';

export class BridgeError extends Error {
  readonly kind: BridgeErrorKind;
  readonly objName?: string;
  readonly objType?: string;
  constructor(kind: BridgeErrorKind, message: string, extra: { name?: string; type?: string } = {}) {
    super(message);
    this.name = 'BridgeError';
    this.kind = kind;
    this.objName = extra.name;
    this.objType = extra.type;
  }
}

/** What the bridge needs to know about one figure object. */
export interface BridgeObject {
  readonly id: ObjId;
  readonly name: string;
  /** Kernel type name: `Number`, `Symbol`, `Expr`, `Function`, `Point`, … */
  readonly type: string;
  readonly free: boolean;
  /** Defined when the object currently holds a number. */
  readonly number?: number;
  /** Defined when free and defined by a literal or a slider (exact entry). */
  readonly literal?: number;
}

/** Read-only facts the kernel implements for symbolic-mode conversion. */
export interface BridgeScope {
  lookup(name: string): BridgeObject | undefined;
  byId(id: ObjId): BridgeObject | undefined;
  /** The symbolic tree of an `Expr` object. */
  exprOf?(id: ObjId): SymNode | undefined;
  /** The name and domain of a `Symbol` object. */
  symbolOf?(id: ObjId): { name: string; domain: Domain } | undefined;
  /** Parameters and body of a `Function` object. */
  functionBody?(id: ObjId): { params: readonly string[]; body: TNode } | undefined;
  /** Coordinates of a `Point` object (for `P.x`, `P.y`). */
  pointOf?(id: ObjId): { x: number; y: number } | undefined;
  /** Names to keep as live `ref` nodes instead of entering by value. */
  keepRefs?: ReadonlySet<string>;
  /** Binder slots in scope (for `ToExpr` of function bodies). */
  locals?: ReadonlyMap<number, string>;
}

export interface BridgeResult {
  readonly node: SymNode;
  /** True when the tree reads the film clock (heavy commands must refuse it). */
  readonly readsClock: boolean;
}

const SYM_FNS: ReadonlySet<string> = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh',
  'asinh', 'acosh', 'atanh', 'ln', 'log10', 'log2', 'abs', 'sign', 'floor',
  'ceil', 'round', 'min', 'max', 'cbrt',
]);

/** Convert a checked tree in symbolic mode (cas/design.md 5.3). */
export function nodeFromTNode(t: TNode, scope: BridgeScope): BridgeResult {
  switch (t.n) {
    case 'num': {
      const r = shortestDecimalRational(t.v);
      if (r !== null) return { node: r.d === 1n ? intN(r.n) : ratN(r.n, r.d), readsClock: false };
      return { node: floatN(t.v), readsClock: false };
    }
    case 'bool':
    case 'text':
      throw new BridgeError('not_symbolic', `A ${t.n} cannot be used in an expression.`);
    case 'undef':
      throw new BridgeError('input_undefined', 'An input is undefined.');
    case 'const': return { node: constFromName(t.name), readsClock: false };
    case 'clock': return { node: symN('t'), readsClock: true };
    case 'ref': return refFromTNode(t.id, t.name, scope);
    case 'local': {
      const name = scope.locals?.get(t.slot);
      if (name === undefined) throw new BridgeError('not_symbolic', `The name ${t.name} is not in scope here.`, { name: t.name });
      return { node: symN(name), readsClock: false };
    }
    case 'unary': {
      const a = nodeFromTNode(t.arg, scope);
      if (t.op === 'not') throw new BridgeError('not_symbolic', 'not combines conditions, not expressions.');
      return { node: t.op === '-' ? negateNode(a.node) : a.node, readsClock: a.readsClock };
    }
    case 'bin': {
      const l = nodeFromTNode(t.l, scope);
      const r = nodeFromTNode(t.r, scope);
      const readsClock = l.readsClock || r.readsClock;
      if (t.op === 'and' || t.op === 'or' || t.op === 'xor') {
        throw new BridgeError('not_symbolic', `${t.op} combines conditions, not expressions.`);
      }
      if (t.op === '+') return { node: add(l.node, r.node), readsClock };
      if (t.op === '-') return { node: add(l.node, negateNode(r.node)), readsClock };
      if (t.op === '*') return { node: mul(l.node, r.node), readsClock };
      if (t.op === '/') return { node: divideNodes(l.node, r.node), readsClock };
      if (t.op === '^') return { node: pow(l.node, r.node), readsClock };
      throw new BridgeError('not_symbolic', `The operator ${t.op} cannot be used in an expression.`);
    }
    case 'cmp':
    case 'relation':
      throw new BridgeError('not_symbolic', 'A comparison is a condition; use it where a Cond is expected.');
    case 'fact': {
      const a = nodeFromTNode(t.arg, scope);
      if (a.node.k === 'int' && a.node.v >= 0n && a.node.v <= 1000n) {
        return { node: intN(factorialLocal(a.node.v)), readsClock: a.readsClock };
      }
      throw new BridgeError('unsupported_builtin', 'Factorial of a non-literal is not supported in expressions.');
    }
    case 'callObj': return callObjFromTNode(t.id, t.name, t.args, scope);
    case 'builtin': {
      if (t.spec.name === 'sqrt' || t.spec.name === 'exp') {
        if (t.args.length !== 1) {
          throw new BridgeError('not_symbolic', `The function ${t.spec.name} takes one argument.`, { name: t.spec.name });
        }
        const a = nodeFromTNode(t.args[0] as TNode, scope);
        const node = t.spec.name === 'sqrt' ? pow(a.node, ratN(1n, 2n)) : pow(constN('e'), a.node);
        return { node, readsClock: a.readsClock };
      }
      if (!SYM_FNS.has(t.spec.name)) {
        throw new BridgeError('unsupported_builtin', `The function ${t.spec.name} cannot be used in an expression.`, { name: t.spec.name });
      }
      const args = t.args.map((a) => nodeFromTNode(a, scope));
      return {
        node: fn(t.spec.name as SymFn, ...args.map((a) => a.node)),
        readsClock: args.some((a) => a.readsClock),
      };
    }
    case 'command':
      throw new BridgeError('not_symbolic', `The command ${t.spec.name} cannot be used inside an expression.`, { name: t.spec.name });
    case 'tick':
      throw new BridgeError('not_symbolic', 'Derivative notation cannot be used inside an expression yet.');
    case 'index':
      throw new BridgeError('not_symbolic', 'Indexing cannot be used inside an expression.');
    case 'field': return fieldFromTNode(t, scope);
    case 'point':
    case 'polar':
      throw new BridgeError('not_symbolic', 'A point cannot be used in an expression.');
    case 'list': {
      const items = t.items.map((x) => nodeFromTNode(x, scope));
      return { node: listN(items.map((x) => x.node)), readsClock: items.some((x) => x.readsClock) };
    }
    case 'range':
      throw new BridgeError('not_symbolic', 'A range cannot be used in an expression.');
    case 'cond': {
      let readsClock = false;
      const cases = t.arms.map((arm) => {
        const when = condFromTNode(arm.c, scope);
        const then = nodeFromTNode(arm.v, scope);
        readsClock = readsClock || when.readsClock || then.readsClock;
        return { when: when.cond, then: then.node };
      });
      if (t.otherwise !== undefined) {
        const other = nodeFromTNode(t.otherwise, scope);
        return { node: piecewiseN(cases, other.node), readsClock: readsClock || other.readsClock };
      }
      return { node: piecewiseN(cases), readsClock };
    }
  }
}

function factorialLocal(n: bigint): bigint {
  let r = 1n;
  for (let i = 2n; i <= n; i++) r *= i;
  return r;
}

function constFromName(name: string): SymNode {
  if (name === 'pi') return constN('pi');
  if (name === 'e') return constN('e');
  if (name === 'tau') return mul(intN(2), constN('pi'));
  if (name === 'deg') return divideNodes(constN('pi'), intN(180));
  if (name === 'inf') return constN('inf');
  throw new BridgeError('not_symbolic', `The constant ${name} cannot be used in an expression.`, { name });
}

function refFromTNode(id: ObjId, name: string, scope: BridgeScope): BridgeResult {
  if (name === 'x' || name === 'y' || name === 'z') return { node: symN(name), readsClock: false };
  if (name === 'i') return { node: constN('i'), readsClock: false };
  const obj = scope.byId(id) ?? scope.lookup(name);
  if (obj === undefined) {
    const err = new BridgeError('unknown_name', `${name} is not defined.`, { name });
    if (name.length === 1) {
      throw new BridgeError('unknown_name', `${name} is not defined. Make an unknown first: ${name} = Symbol().`, { name });
    }
    throw err;
  }
  if (scope.keepRefs?.has(name) === true) return { node: refN(id), readsClock: false };
  if (obj.type === 'Symbol') {
    const s = scope.symbolOf?.(id);
    return { node: symN(s?.name ?? name), readsClock: false };
  }
  if (obj.type === 'Expr') {
    const e = scope.exprOf?.(id);
    if (e === undefined) throw new BridgeError('input_undefined', `${name} has no value yet.`, { name });
    return { node: e, readsClock: false };
  }
  if (obj.type === 'Number') {
    if (obj.literal !== undefined) {
      const r = shortestDecimalRational(obj.literal);
      if (r !== null) return { node: r.d === 1n ? intN(r.n) : ratN(r.n, r.d), readsClock: false };
    }
    if (obj.number === undefined) throw new BridgeError('input_undefined', `${name} has no value yet.`, { name });
    return { node: floatN(obj.number), readsClock: false };
  }
  throw new BridgeError('not_symbolic', `${name} is a ${obj.type} and cannot be used in an expression.`, { name, type: obj.type });
}

function callObjFromTNode(id: ObjId, name: string, args: readonly TNode[], scope: BridgeScope): BridgeResult {
  const obj = scope.byId(id) ?? scope.lookup(name);
  if (obj === undefined) throw new BridgeError('unknown_name', `${name} is not defined.`, { name });
  if (obj.type !== 'Function') {
    throw new BridgeError('not_symbolic', `${name} is a ${obj.type} and cannot be called in an expression.`, { name, type: obj.type });
  }
  const body = scope.functionBody?.(id);
  if (body === undefined) throw new BridgeError('input_undefined', `${name} has no body.`, { name });
  if (body.params.length !== args.length) {
    throw new BridgeError('not_symbolic', `${name} takes ${body.params.length} arguments.`, { name });
  }
  const converted = args.map((a) => nodeFromTNode(a, scope));
  const compiled = converted.map((c) => c.node);
  const substituted = substituteParams(body.body, body.params, compiled, scope);
  return { node: substituted.node, readsClock: converted.some((c) => c.readsClock) || substituted.readsClock };
}

/** Convert a function body with parameters bound to placeholder names, then substitute. */
function substituteParams(body: TNode, params: readonly string[], values: readonly SymNode[], scope: BridgeScope): BridgeResult {
  const placeholders = params.map((_, i) => `__arg${i}__`);
  const extended: BridgeScope = {
    ...scope,
    locals: new Map([...(scope.locals ?? []), ...params.map((_, i) => [i, placeholders[i] as string] as const)]),
  };
  const conv = nodeFromTNode(body, extended);
  const pairs = placeholders.map((p, i) => [symN(p), values[i] as SymNode] as const);
  return { node: substituteList(conv.node, pairs), readsClock: conv.readsClock };
}

function fieldFromTNode(t: Extract<TNode, { n: 'field' }>, scope: BridgeScope): BridgeResult {
  if (t.target.n !== 'ref') {
    throw new BridgeError('not_symbolic', 'Only a point coordinate such as P.x can be used in an expression.');
  }
  const obj = scope.byId(t.target.id) ?? scope.lookup(t.target.name);
  if (obj === undefined) throw new BridgeError('unknown_name', `${t.target.name} is not defined.`, { name: t.target.name });
  if (obj.type !== 'Point') {
    throw new BridgeError('not_symbolic', `${obj.name} is a ${obj.type} and has no ${t.field} coordinate.`, { name: obj.name, type: obj.type });
  }
  const pt = scope.pointOf?.(obj.id);
  if (pt === undefined) throw new BridgeError('input_undefined', `${obj.name} has no value yet.`, { name: obj.name });
  if (t.field === 'x' || t.field === 'y') {
    const v = t.field === 'x' ? pt.x : pt.y;
    const r = shortestDecimalRational(v);
    if (r !== null) return { node: r.d === 1n ? intN(r.n) : ratN(r.n, r.d), readsClock: false };
    return { node: floatN(v), readsClock: false };
  }
  throw new BridgeError('not_symbolic', `A point has no ${t.field} coordinate for expressions.`, { name: obj.name });
}

export interface BridgeCondResult {
  readonly cond: SymCond;
  readonly readsClock: boolean;
}

/** Convert a checked tree in a condition position (comparisons become Conds). */
export function condFromTNode(t: TNode, scope: BridgeScope): BridgeCondResult {
  switch (t.n) {
    case 'bool': return { cond: t.v ? { c: 'true' } : { c: 'false' }, readsClock: false };
    case 'cmp': {
      const operands = t.operands.map((o) => nodeFromTNode(o, scope));
      const parts = t.ops.map((op, i) => rel(op, (operands[i] as BridgeResult).node, (operands[i + 1] as BridgeResult).node));
      return {
        cond: parts.length === 1 ? (parts[0] as SymCond) : andCond(...parts),
        readsClock: operands.some((o) => o.readsClock),
      };
    }
    case 'relation': return relTreeFromTNode(t.tree, scope);
    case 'unary': {
      if (t.op !== 'not') throw new BridgeError('not_symbolic', 'Expected a condition.');
      const a = condFromTNode(t.arg, scope);
      return { cond: notCond(a.cond), readsClock: a.readsClock };
    }
    case 'bin': {
      if (t.op !== 'and' && t.op !== 'or' && t.op !== 'xor') throw new BridgeError('not_symbolic', 'Expected a condition.');
      const l = condFromTNode(t.l, scope);
      const r = condFromTNode(t.r, scope);
      const readsClock = l.readsClock || r.readsClock;
      if (t.op === 'and') return { cond: andCond(l.cond, r.cond), readsClock };
      if (t.op === 'or') return { cond: orCond(l.cond, r.cond), readsClock };
      return { cond: andCond(orCond(l.cond, r.cond), notCond(andCond(l.cond, r.cond))), readsClock };
    }
    case 'ref': {
      const obj = scope.byId(t.id) ?? scope.lookup(t.name);
      if (obj?.type === 'Bool') {
        throw new BridgeError('not_symbolic', 'A Bool object cannot be used as a symbolic condition yet.', { name: t.name });
      }
      throw new BridgeError('not_symbolic', 'Expected a condition.');
    }
    default:
      throw new BridgeError('not_symbolic', 'Expected a condition.');
  }
}

function relTreeFromTNode(tree: Extract<TNode, { n: 'relation' }>['tree'], scope: BridgeScope): BridgeCondResult {
  switch (tree.t) {
    case 'cmp': {
      const operands = tree.operands.map((o) => nodeFromTNode(o, scope));
      const parts = tree.ops.map((op, i) => rel(op, (operands[i] as BridgeResult).node, (operands[i + 1] as BridgeResult).node));
      return {
        cond: parts.length === 1 ? (parts[0] as SymCond) : andCond(...parts),
        readsClock: operands.some((o) => o.readsClock),
      };
    }
    case 'and':
    case 'or': {
      const l = relTreeFromTNode(tree.l, scope);
      const r = relTreeFromTNode(tree.r, scope);
      const readsClock = l.readsClock || r.readsClock;
      return { cond: tree.t === 'and' ? andCond(l.cond, r.cond) : orCond(l.cond, r.cond), readsClock };
    }
    case 'xor': {
      const l = relTreeFromTNode(tree.l, scope);
      const r = relTreeFromTNode(tree.r, scope);
      return {
        cond: andCond(orCond(l.cond, r.cond), notCond(andCond(l.cond, r.cond))),
        readsClock: l.readsClock || r.readsClock,
      };
    }
    case 'not': {
      const a = relTreeFromTNode(tree.a, scope);
      return { cond: notCond(a.cond), readsClock: a.readsClock };
    }
  }
}

/**
 * Substitute the current clock value for `t` (cheap ops re-run every frame with the
 * current `t`; heavy ops refuse `t` outright). Exact when the decimal is short.
 */
export function substituteClock(t: SymNode, value: number): SymNode {
  const r = shortestDecimalRational(value);
  const node = r === null ? floatN(value) : r.d === 1n ? intN(r.n) : ratN(r.n, r.d);
  return substituteList(t, [[symN('t'), node]]);
}

/* ------------------------------ numeric compiler ------------------------------ */

export interface CompiledFunction {
  /** Call with `x` (and film time `t` when the body reads the clock). NaN when undefined. */
  readonly call: (x: number, t?: number) => number;
  readonly batch: (xs: Float64Array, out: Float64Array, t?: number) => void;
  readonly readsClock: boolean;
}

/** Compile a one-variable body to a numeric closure (the `ToFunction` back-end). */
export function compileFunction(param: string, body: SymNode): CompiledFunction {
  const readsClock = readsSym(body, 't');
  const call = (x: number, t = 0): number => {
    const vals = new Map<string, number>([[param, x]]);
    if (readsClock) vals.set('t', t);
    const v = evalAt(body, vals);
    return v === null || !Number.isFinite(v) ? NaN : v;
  };
  const batch = (xs: Float64Array, out: Float64Array, t = 0): void => {
    for (let i = 0; i < xs.length; i++) out[i] = call(xs[i] as number, t);
  };
  return { call, batch, readsClock };
}

function readsSym(t: SymNode, name: string): boolean {
  if (t.k === 'sym') return t.name === name;
  switch (t.k) {
    case 'add': return t.terms.some((x) => readsSym(x, name));
    case 'mul': return t.factors.some((x) => readsSym(x, name));
    case 'pow': return readsSym(t.base, name) || readsSym(t.exp, name);
    case 'fn': return t.args.some((x) => readsSym(x, name));
    default: return false;
  }
}
