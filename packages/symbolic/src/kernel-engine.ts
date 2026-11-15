/**
 * The engine as the kernel's CAS area sees it (cas/design.md 5.15; .kiro/specs/cas R2): one `evaluate` call per rule
 * run. It turns the checked argument trees into symbolic arguments through the bridge, runs the operation, and gives
 * back a figure value: a `SymValue` for Expr, Cond and Symbol (with its text and LaTeX printed once), numbers, texts,
 * booleans, lists, or a callable Function for `ToFunction`. Nothing throws out of it.
 */
import { isCasForm } from '@incantly/kernel';
import type { CasArgIn, CasEngine, CasHost, CasOut, FunctionValue, ObjId, SymValue, TNode } from '@incantly/kernel';
import { BridgeError, compileFunction, condFromTNode, nodeFromTNode } from './bridge';
import type { BridgeObject, BridgeScope } from './bridge';
import { HEAVY_OPS } from './contracts';
import type { Domain, OpName, SymArg } from './contracts';
import type { SymCond, SymNode } from './node';
import { andCond, floatN, intN, notCond, orCond, symN } from './node';
import { parseExpression } from './parse';
import { approxOf, condLatex, condText, isExactTree, toLatex, toText } from './print';
import { run } from './run';

/** A SymValue made by this engine: the engine's own argument is kept as `arg`. */
type Held = SymValue & { readonly arg: SymArg };

const isHeld = (v: unknown): v is Held =>
  typeof v === 'object' && v !== null && typeof (v as { sym?: unknown }).sym === 'string' && typeof (v as { arg?: unknown }).arg === 'object';

/** A figure value from an engine result. */
export function heldOf(a: SymArg): unknown {
  switch (a.k) {
    case 'expr': {
      const text = toText(a.e, { display: true, ...(a.display?.mixed ? { mixed: true } : {}) });
      return { sym: 'Expr', arg: a, text, latex: toLatex(a.e), exact: a.exact && isExactTree(a.e) } satisfies Held;
    }
    case 'cond':
      return { sym: 'Cond', arg: a, text: condText(a.c, { display: true }), latex: condLatex(a.c), exact: a.exact } satisfies Held;
    case 'sym':
      return { sym: 'Symbol', arg: a, text: a.name, latex: a.name.length === 1 ? a.name : `\\mathit{${a.name}}`, exact: true } satisfies Held;
    case 'num':
      return a.v;
    case 'int':
      return Number(a.v);
    case 'bool':
      return a.v;
    case 'text':
      return a.v;
    case 'list':
      return a.items.map(heldOf);
    case 'named':
      return heldOf(a.v);
    case 'function':
      return functionValue(a.param, a.body);
    case 'matrix':
      return a.rows.map((r) => r.map((e) => heldOf({ k: 'expr', e, exact: true })));
  }
}

/** A callable figure Function for a one-variable body (`ToFunction`), keeping the body for `ToExpr`. */
function functionValue(param: string, body: SymNode): FunctionValue & { readonly sym: { readonly param: string; readonly body: SymNode } } {
  const c = compileFunction(param, body);
  return {
    arity: 1,
    ret: 'Number',
    call: (x: number) => c.call(x),
    call1: (x: number) => c.call(x),
    batch: (xs: Float64Array, out: Float64Array) => c.batch(xs, out),
    sym: { param, body },
  };
}

/** Coerce a result to the type the kernel's form promised (a numeric Expr where a Number is wanted, and back). */
function coerce(v: unknown, returns: string): unknown {
  if (returns === 'Number') {
    if (typeof v === 'number') return v;
    if (isHeld(v) && v.arg.k === 'expr') {
      const n = approxOf(v.arg.e);
      return Number.isFinite(n) ? n : undefined;
    }
    return v;
  }
  if (returns === 'Expr' && typeof v === 'number') return heldOf(numberArg(v));
  const m = /^List<(.+)>$/.exec(returns);
  if (m && Array.isArray(v)) return v.map((x) => coerce(x, m[1] as string));
  return v;
}

function numberArg(v: number): SymArg {
  if (Number.isInteger(v) && Math.abs(v) < 2 ** 53) return { k: 'int', v: BigInt(v) };
  return { k: 'num', v };
}

/* ------------------------------ arguments ------------------------------ */

class Refused extends Error {
  constructor(
    readonly reason: string,
    readonly detail: string,
  ) {
    super(detail);
  }
}

function scopeFor(host: CasHost, locals: ReadonlyMap<number, string>, domains: Map<string, Domain>): BridgeScope {
  const objectOf = (id: ObjId): BridgeObject | undefined => {
    const info = host.info(id);
    if (!info) return undefined;
    const value = host.read(id);
    const base = { id, name: info.name, type: info.type, free: info.free };
    if (typeof value === 'number') {
      // a free number typed as a literal or a slider enters exactly (design 5.4)
      return { ...base, number: value, ...(info.free ? { literal: value } : {}) };
    }
    return base;
  };
  return {
    lookup: () => undefined,
    byId: objectOf,
    exprOf: (id) => {
      const v = host.read(id);
      if (isHeld(v) && v.arg.k === 'expr') return v.arg.e;
      if (typeof v === 'number') return numberNode(v);
      return undefined;
    },
    symbolOf: (id) => {
      const v = host.read(id);
      if (isHeld(v) && v.arg.k === 'sym') {
        domains.set(v.arg.name, v.arg.domain);
        return { name: v.arg.name, domain: v.arg.domain };
      }
      return undefined;
    },
    pointOf: (id) => {
      const v = host.read(id) as { x?: unknown; y?: unknown } | undefined;
      return v && typeof v.x === 'number' && typeof v.y === 'number' ? { x: v.x, y: v.y } : undefined;
    },
    locals,
  };
}

function numberNode(v: number): SymNode {
  return Number.isInteger(v) && Math.abs(v) < 2 ** 53 ? intN(BigInt(v)) : floatN(v);
}

/** `f(x)` in a symbolic argument: the body of a function object, its parameters replaced (design 5.3 rule 2). */
function callBody(host: CasHost, id: ObjId, args: readonly SymNode[]): SymNode | undefined {
  const info = host.info(id);
  if (!info || info.type !== 'Function') return undefined;
  const m = /^\s*[^(=]+\(([^)]*)\)\s*=\s*(.+)$/.exec(info.definition);
  if (!m) return undefined;
  const params = (m[1] as string).split(',').map((s) => s.trim()).filter((s) => s !== '');
  if (params.length !== args.length) return undefined;
  let body: SymNode;
  try {
    body = parseExpression((m[2] as string).replace(/\swith\s.*$/, ''));
  } catch {
    return undefined;
  }
  return substituteSyms(body, new Map(params.map((p, i) => [p, args[i] as SymNode])));
}

function substituteSyms(t: SymNode, map: ReadonlyMap<string, SymNode>): SymNode {
  // the engine's substitution, through `run`, keeps canonical form
  const pairs: SymCond[] = [...map].map(([name, v]) => ({ c: 'rel', op: '==', l: symN(name), r: v }) as unknown as SymCond);
  const r = run('Substitute', [{ k: 'expr', e: t, exact: true }, { k: 'list', items: pairs.map((c) => ({ k: 'cond', c, exact: true }) as SymArg) }]);
  if (r.ok && r.value.cell.defined && r.value.cell.value.k === 'expr') return r.value.cell.value.e;
  return t;
}

interface Converted {
  readonly arg: SymArg;
  readonly readsClock: boolean;
}

/** Calls of function objects are replaced by their bodies before the bridge sees the tree. */
function inlineCalls(t: TNode, host: CasHost, scope: BridgeScope): TNode | { node: SymNode } {
  if (t.n === 'callObj') {
    const args = t.args.map((a) => toNode(a, host, scope).node);
    const body = callBody(host, t.id, args);
    if (body === undefined) throw new Refused('not_symbolic', `${t.name} cannot be used in an expression here; turn it into an expression with ToExpr(${t.name})`);
    return { node: body };
  }
  return t;
}

function toNode(t: TNode, host: CasHost, scope: BridgeScope): { node: SymNode; readsClock: boolean } {
  if (t.n === 'command') {
    const v = nested(t, host, scope);
    if (v.arg.k === 'expr') return { node: v.arg.e, readsClock: v.readsClock };
    if (v.arg.k === 'num') return { node: numberNode(v.arg.v), readsClock: v.readsClock };
    if (v.arg.k === 'int') return { node: intN(v.arg.v), readsClock: v.readsClock };
    throw new Refused('not_symbolic', `${t.spec.name} does not give an expression here`);
  }
  if (t.n === 'index') {
    // `r[1]`: an item of a list of solutions (lists are counted from 1)
    const item = indexed(t, host);
    if (item.k === 'expr') return { node: item.e, readsClock: false };
    if (item.k === 'num') return { node: numberNode(item.v), readsClock: false };
    if (item.k === 'int') return { node: intN(item.v), readsClock: false };
    throw new Refused('not_symbolic', 'That item is not an expression');
  }
  if (hasCommand(t)) return nodeWithCalls(t, host, scope);
  const inl = inlineCalls(t, host, scope);
  if ('node' in inl) return { node: inl.node, readsClock: false };
  if (hasCallObj(t)) {
    // rebuild the tree with each call replaced: the bridge reads `ref`s of Expr objects, so the body goes in as one
    return nodeWithCalls(t, host, scope);
  }
  return nodeFromTNode(t, scope);
}

function hasCommand(t: TNode): boolean {
  if (t.n === 'command') return true;
  const kids = (t as unknown as { l?: TNode; r?: TNode; arg?: TNode; args?: readonly unknown[]; operands?: readonly TNode[]; items?: readonly TNode[] });
  return [kids.l, kids.r, kids.arg, ...((kids.args ?? []) as TNode[]), ...(kids.operands ?? []), ...(kids.items ?? [])].some((k) => k !== undefined && typeof k === 'object' && 'n' in k && hasCommand(k));
}

/**
 * A CAS command written inside a symbolic argument (`Equivalent(Expand((x + 1)^2), …)`, agent.md 1): the engine runs
 * it on the spot, with the same budget, and its result enters the outer tree.
 */
function nested(t: TNode & { n: 'command' }, host: CasHost, scope: BridgeScope): Converted {
  if (!isCasForm(t.form)) throw new Refused('not_symbolic', `The command ${t.spec.name} cannot be used inside an expression; name its result on a line of its own`);
  const domains = new Map<string, Domain>();
  const ins: CasArgIn[] = t.form.params.map((p, i) => {
    const a = t.args[i];
    const tree = a?.expr as TNode | undefined;
    if ((p.kind ?? 'value') === 'body' && a && !a.omitted && tree) {
      const locals = new Map(scope.locals ?? []);
      for (const s of a.scopeSlots ?? []) locals.set(s.slot, s.name);
      const as = p.type === 'CasCond' ? 'cond' : p.type === 'CasVar' ? 'var' : p.type === 'Any' ? 'list' : 'expr';
      return { k: 'tree', as, tree, locals, name: p.name, optional: p.optional === true };
    }
    if (a && !a.omitted && tree) {
      const lit = literalValue(tree, host);
      return { k: 'value', value: lit, name: p.name, omitted: false, optional: p.optional === true };
    }
    return { k: 'value', value: a?.value, name: p.name, omitted: a?.omitted ?? true, optional: p.optional === true };
  });
  const returns = typeof t.form.returns === 'string' ? t.form.returns : 'Expr';
  const out = casEngine.evaluate({ op: t.spec.name, returns, args: ins, owner: '', t: 0, host });
  if (!out.ok) throw new Refused(out.reason, out.detail ?? `${t.spec.name} is undefined`);
  void domains;
  return { arg: asArg(out.value), readsClock: false };
}

function indexed(t: TNode & { n: 'index' }, host: CasHost): SymArg {
  const target = t.target.n === 'ref' ? host.read(t.target.id) : undefined;
  const i = t.index.n === 'num' ? t.index.v : t.index.n === 'ref' ? host.read(t.index.id) : undefined;
  const list = Array.isArray(target) ? target : target instanceof Float64Array ? Array.from(target) : undefined;
  if (!list || typeof i !== 'number' || !Number.isInteger(i)) throw new Refused('not_symbolic', 'Index a named list with a whole number, such as r[1]');
  if (i < 1 || i > list.length) throw new Refused('index_out_of_range', `index ${i} of ${list.length}`);
  return asArg(list[i - 1]);
}

/** A plain argument of a nested command: a number literal, a text, or an object's value. */
function literalValue(t: TNode, host: CasHost): unknown {
  if (t.n === 'num') return t.v;
  if (t.n === 'text') return (t as unknown as { v: string }).v;
  if (t.n === 'bool') return t.v;
  if (t.n === 'ref') return host.read(t.id);
  if (t.n === 'unary' && t.op === '-' && t.arg.n === 'num') return -t.arg.v;
  if (t.n === 'const' && t.name === 'inf') return Infinity;
  throw new Refused('not_symbolic', 'Give a number here');
}

function hasCallObj(t: TNode): boolean {
  if (t.n === 'callObj') return true;
  const kids = (t as unknown as { l?: TNode; r?: TNode; arg?: TNode; args?: readonly TNode[]; operands?: readonly TNode[]; items?: readonly TNode[] });
  return [kids.l, kids.r, kids.arg, ...(kids.args ?? []), ...(kids.operands ?? []), ...(kids.items ?? [])].some((k) => k !== undefined && typeof k === 'object' && hasCallObj(k));
}

const CALL_PREFIX = '__call';

/** Converts a tree with `f(…)` calls: each call becomes a placeholder symbol, then the bodies are substituted in. */
function nodeWithCalls(t: TNode, host: CasHost, scope: BridgeScope): { node: SymNode; readsClock: boolean } {
  const bodies = new Map<string, SymNode>();
  const locals = new Map(scope.locals ?? []);
  let k = 0;
  const swap = (n: TNode): TNode => {
    if (n.n === 'command') {
      const name = `${CALL_PREFIX}${k++}`;
      bodies.set(name, toNode(n, host, scope).node);
      const slot = 100000 + k;
      locals.set(slot, name);
      return { n: 'local', slot, name, ty: n.ty, s: n.s, e: n.e } as unknown as TNode;
    }
    if (n.n === 'callObj') {
      const name = `${CALL_PREFIX}${k++}`;
      const args = n.args.map((a) => toNode(a, host, scope).node);
      const body = callBody(host, n.id, args);
      if (body === undefined) throw new Refused('not_symbolic', `${n.name} cannot be used in an expression here; turn it into an expression with ToExpr(${n.name})`);
      bodies.set(name, body);
      const slot = 100000 + k;
      locals.set(slot, name);
      return { n: 'local', slot, name, ty: n.ty, s: n.s, e: n.e } as unknown as TNode;
    }
    const o = n as unknown as Record<string, unknown>;
    const copy: Record<string, unknown> = { ...o };
    for (const key of ['l', 'r', 'arg']) if (o[key] && typeof o[key] === 'object') copy[key] = swap(o[key] as TNode);
    for (const key of ['args', 'operands', 'items']) if (Array.isArray(o[key])) copy[key] = (o[key] as TNode[]).map(swap);
    return copy as unknown as TNode;
  };
  const swapped = swap(t);
  const r = nodeFromTNode(swapped, { ...scope, locals });
  return { node: bodies.size > 0 ? substituteSyms(r.node, bodies) : r.node, readsClock: r.readsClock };
}

function condOf(t: TNode, host: CasHost, scope: BridgeScope): { cond: SymCond; readsClock: boolean } {
  // `q and x > 0` with q a Cond object: each side on its own
  if (t.n === 'bin' && (t.op === 'and' || t.op === 'or')) {
    const l = condOf(t.l, host, scope);
    const r = condOf(t.r, host, scope);
    return { cond: t.op === 'and' ? andCond(l.cond, r.cond) : orCond(l.cond, r.cond), readsClock: l.readsClock || r.readsClock };
  }
  if (t.n === 'unary' && t.op === 'not') {
    const a = condOf(t.arg, host, scope);
    return { cond: notCond(a.cond), readsClock: a.readsClock };
  }
  if (t.n === 'ref') {
    const v = host.read(t.id);
    if (isHeld(v) && v.arg.k === 'cond') return { cond: v.arg.c, readsClock: false };
    if (v === undefined) throw new Refused('input_undefined', `${t.name} is undefined`);
  }
  if (hasCommand(t) || hasCallObj(t)) {
    // `Expand(p) == 0`, `f(x) > 1`: each side through toNode
    if (t.n === 'cmp' && t.ops.length === 1) {
      const l = toNode(t.operands[0] as TNode, host, scope);
      const r = toNode(t.operands[1] as TNode, host, scope);
      return { cond: { c: 'rel', op: t.ops[0], l: l.node, r: r.node } as unknown as SymCond, readsClock: l.readsClock || r.readsClock };
    }
  }
  return condFromTNode(t, scope);
}

function varOf(t: TNode, host: CasHost, locals: ReadonlyMap<number, string>, domains: Map<string, Domain>): SymArg {
  if (t.n === 'local') {
    const name = locals.get(t.slot) ?? t.name;
    return { k: 'sym', name, domain: domains.get(name) ?? 'real' };
  }
  if (t.n === 'ref') {
    const v = host.read(t.id);
    if (isHeld(v) && v.arg.k === 'sym') {
      domains.set(v.arg.name, v.arg.domain);
      return v.arg;
    }
    if (t.name === 'x' || t.name === 'y' || t.name === 'z') return { k: 'sym', name: t.name, domain: 'real' };
    throw new Refused('not_symbolic', `${t.name} is not an unknown; make one with ${t.name.length === 1 ? `${t.name} = Symbol()` : 'Symbol()'}`);
  }
  throw new Refused('not_symbolic', 'Name the unknown: x, y, z or a Symbol');
}

function convert(a: CasArgIn & { k: 'tree' }, host: CasHost, domains: Map<string, Domain>): Converted {
  const scope = scopeFor(host, a.locals, domains);
  if (a.as === 'var') return { arg: varOf(a.tree, host, a.locals, domains), readsClock: false };
  if (a.as === 'cond') {
    const c = condOf(a.tree, host, scope);
    return { arg: { k: 'cond', c: c.cond, exact: true }, readsClock: c.readsClock };
  }
  if (a.as === 'list') {
    const items = a.tree.n === 'list' ? a.tree.items : undefined;
    if (items) {
      let clock = false;
      const out = items.map((it) => {
        const v = listItem(it, host, a.locals, scope, domains);
        clock ||= v.readsClock;
        return v.arg;
      });
      return { arg: { k: 'list', items: out }, readsClock: clock };
    }
    if (a.tree.n === 'ref') {
      const v = host.read(a.tree.id);
      if (Array.isArray(v)) return { arg: { k: 'list', items: v.map(asArg) }, readsClock: false };
    }
    throw new Refused('not_symbolic', 'Give a list such as [x == 1, y == 2]');
  }
  // an Expr object used whole keeps its exactness
  if (a.tree.n === 'ref') {
    const v = host.read(a.tree.id);
    if (isHeld(v) && v.arg.k === 'expr') return { arg: v.arg, readsClock: false };
  }
  const n = toNode(a.tree, host, scope);
  return { arg: { k: 'expr', e: n.node, exact: isExactTree(n.node) }, readsClock: n.readsClock };
}

function listItem(t: TNode, host: CasHost, locals: ReadonlyMap<number, string>, scope: BridgeScope, domains: Map<string, Domain>): Converted {
  if (t.n === 'local') return { arg: varOf(t, host, locals, domains), readsClock: false };
  if (t.n === 'ref') {
    const v = host.read(t.id);
    if (isHeld(v)) return { arg: v.arg, readsClock: false };
  }
  if (t.n === 'cmp' || t.n === 'relation' || (t.n === 'bin' && (t.op === 'and' || t.op === 'or'))) {
    const c = condFromTNode(t, scope);
    return { arg: { k: 'cond', c: c.cond, exact: true }, readsClock: c.readsClock };
  }
  const n = toNode(t, host, scope);
  return { arg: { k: 'expr', e: n.node, exact: isExactTree(n.node) }, readsClock: n.readsClock };
}

/** A plain figure value as an engine argument. */
function asArg(v: unknown): SymArg {
  if (isHeld(v)) return v.arg;
  if (typeof v === 'number') return numberArg(v);
  if (typeof v === 'string') return { k: 'text', v };
  if (typeof v === 'boolean') return { k: 'bool', v };
  if (v instanceof Float64Array) return { k: 'list', items: Array.from(v, numberArg) };
  if (Array.isArray(v)) return { k: 'list', items: v.map(asArg) };
  const f = v as { sym?: { param: string; body: SymNode } } | undefined;
  if (f?.sym) return { k: 'function', param: f.sym.param, body: f.sym.body, exact: true };
  throw new Refused('not_symbolic', 'This value cannot be used by an algebra command');
}

/** A Function object as an engine argument (`ToExpr(f)`): its own body when the engine made it, else its definition. */
function functionArg(v: unknown, host: CasHost, id: ObjId | undefined): SymArg {
  const f = v as { sym?: { param: string; body: SymNode } } | undefined;
  if (f?.sym) return { k: 'function', param: f.sym.param, body: f.sym.body, exact: true };
  const info = id === undefined ? undefined : host.info(id);
  const m = info ? /^\s*[^(=]+\(\s*([A-Za-z]\w*)\s*\)\s*=\s*(.+)$/.exec(info.definition) : null;
  if (!m) throw new Refused('not_symbolic', 'Only a function of one variable defined by a formula can become an expression');
  try {
    const body = parseExpression((m[2] as string).replace(/\swith\s.*$/, ''));
    return { k: 'function', param: m[1] as string, body, exact: true };
  } catch {
    throw new Refused('unsupported', 'The function uses something the algebra engine cannot read');
  }
}

/* ------------------------------ the engine ------------------------------ */

export const casEngine: CasEngine = {
  evaluate(req): CasOut {
    const domains = new Map<string, Domain>();
    const args: SymArg[] = [];
    let readsClock = false;
    try {
      for (const a of req.args) {
        if (a.k === 'tree') {
          const c = convert(a, req.host, domains);
          readsClock ||= c.readsClock;
          // given optional arguments go by name, so an omitted one before them does not shift the rest
          args.push(args.length < requiredCount(req) ? c.arg : { k: 'named', name: a.name, v: c.arg });
          continue;
        }
        if (a.omitted) continue;
        const v = a.value;
        const arg = typeof v === 'object' && v !== null && typeof (v as { arity?: unknown }).arity === 'number'
          ? functionArg(v, req.host, a.id)
          : typeof v === 'number' ? ({ k: 'num', v } as SymArg) : asArg(v);
        args.push(args.length < requiredCount(req) ? arg : { k: 'named', name: a.name, v: arg });
      }
    } catch (err) {
      if (err instanceof Refused) return { ok: false, reason: err.reason, detail: err.detail };
      if (err instanceof BridgeError) return { ok: false, reason: err.kind === 'unknown_name' ? 'not_symbolic' : err.kind, detail: err.message };
      return { ok: false, reason: 'unsupported', detail: 'The argument could not be read' };
    }
    const op = req.op as OpName;
    if (op === 'Substitute' && args[0]?.k === 'list') return substituteEach(args, domains, req.returns);
    if (readsClock && HEAVY_OPS.has(op)) {
      return { ok: false, reason: 'time_dependent_input', detail: `${req.op} cannot use the clock t; do the algebra with a Symbol, then Substitute the clock` };
    }
    const r = run(op, args, {}, { domains });
    if (!r.ok) return { ok: false, reason: 'unsupported', detail: r.message };
    const cell = r.value.cell;
    if (!cell.defined) return { ok: false, reason: cell.reason, ...(cell.detail?.text ? { detail: cell.detail.text } : {}) };
    let value = cell.value;
    // an unknown is named after the object that holds it (`k = Symbol()` is the unknown k)
    if (op === 'Symbol' && value.k === 'sym' && req.owner) value = { ...value, name: req.owner };
    return { ok: true, value: coerce(heldOf(value), req.returns) };
  },
};

/** How many leading arguments go by position: the required ones. */
function requiredCount(req: Parameters<CasEngine['evaluate']>[0]): number {
  return req.args.filter((a) => !a.optional).length;
}

/** `Substitute(sol, s0, t)` over a list of solutions (agent.md 2): each item, both sides of a condition. */
function substituteEach(args: readonly SymArg[], domains: Map<string, Domain>, returns: string): CasOut {
  const [list, ...rest] = args as [SymArg & { k: 'list' }, ...SymArg[]];
  const one = (e: SymNode): SymNode | CasOut => {
    const r = run('Substitute', [{ k: 'expr', e, exact: true }, ...rest], {}, { domains });
    if (!r.ok) return { ok: false, reason: 'unsupported', detail: r.message };
    const c = r.value.cell;
    if (!c.defined) return { ok: false, reason: c.reason, ...(c.detail?.text ? { detail: c.detail.text } : {}) };
    return c.value.k === 'expr' ? c.value.e : numberNode(c.value.k === 'num' ? c.value.v : 0);
  };
  const items: SymArg[] = [];
  for (const it of list.items) {
    if (it.k === 'cond' && it.c.c === 'rel') {
      const l = one(it.c.l);
      if ('ok' in l) return l;
      const r = one(it.c.r);
      if ('ok' in r) return r;
      items.push({ k: 'cond', c: { ...it.c, l, r } as SymCond, exact: it.exact });
    } else if (it.k === 'expr') {
      const v = one(it.e);
      if ('ok' in v) return v;
      items.push({ k: 'expr', e: v, exact: it.exact });
    } else items.push(it);
  }
  return { ok: true, value: coerce(heldOf({ k: 'list', items }), returns) };
}
