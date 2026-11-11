/**
 * The CAS commands (cas/design.md 2): every op as a pure function of converted arguments.
 * Type errors are the kernel's job (it typechecks); this layer validates values (digits,
 * domains, options) and returns result cells. Nothing throws except `OpError` (a line
 * error) and the engine's `Unsupported`/`NonElementary`/`LimitExceeded`, all caught by
 * `run` and turned into data.
 */
import type { Notice, NoticeKind } from '@incantly/kernel';
import type { Assumptions } from './assume';
import { assumptions as makeAssumptions, findContradiction } from './assume';
import type { Domain, OpName, SymArg, SymbolicLimits, SymbolicNoticeKind } from './contracts';
import { defined, SYMBOLIC_NOTICE_CODES } from './contracts';
import type { Cell } from './contracts';
import type { SymCond, SymNode } from './node';
import {
  add, asInteger, asRational, bigGcd, constN, decN, floatN, freeSymbols, intN,
  isZeroNode, LimitExceeded, mul, negateNode, nodeCount, pow, ratN, rel, symN,
} from './node';
import { freeSymbolsCond } from './node';
import {
  binomialBig, divisorsFromFactors, extendedGcdBig, factorMultiplicity,
  fromBaseText, isPrimeBig, isqrtBig, modPowBigInt, nearestFraction, nextPrimeBig,
  previousPrimeBig, primeFactorsBig, shortestDecimalRational, toBaseBig,
} from './num';
import type { Ticker } from './poly';
import {
  treeToUPoly, treeToUPolySym, upolyDivMod,
  upolyGcd, upolyIsZero, upolyMul, upolyToTree,
} from './poly';
import { parseExprOrCond, ParseFailure } from './parse';
import { condText, toText } from './print';
import {
  apartNode, completeSquareNode, evaluateNode, evalAt, expandNode, factorNode, rationalizeNode,
  ruleCtx, simplifyNode, substituteList, substituteNode,
  trigCombineNode, trigExpandNode, trigSimplifyNode,
} from './rules';
import type { RuleCtx } from './rules';
import {
  csolveEquation, nsolveEquation, nsolveSystem, solveEquation,
  solveInequality, solveODE, solveSystem, toDifference, Unsupported,
} from './solve';
import type { SolveResult } from './solve';
import { definiteIntegral, diffNode, integrateNode, limitNode, NoLimit } from './calc';
import { equivalent, equivalentCond, isZeroVerdict } from './equiv';
import { characteristicPolynomial, determinant, eigenvalues, eigenvectors, inverse, isSquare, Singular } from './matrix';
import type { Matrix } from './matrix';

/* --------------------------------- context ----------------------------------- */

export interface OpCtx {
  readonly assume: Assumptions;
  readonly tick: Ticker;
  readonly note: (rule: string, before: SymNode, after: SymNode) => void;
  readonly limits: SymbolicLimits;
  /** The result object's name (for `Symbol()`). */
  readonly name?: string;
}

export interface OpOut {
  readonly cell: Cell<SymArg>;
  readonly notices: readonly Notice[];
}

export function okOut(cell: Cell<SymArg>, notices: readonly Notice[] = []): OpOut {
  return { cell, notices };
}

/** A line error: caught by `run` and built into an `ErrorObject`. */
export class OpError extends Error {
  readonly kind: string;
  readonly token: string;
  readonly expected: readonly string[];
  readonly forms: readonly string[];
  readonly hint?: string;
  readonly suggest: readonly string[];
  readonly recovery: 'fix_line' | 'use_suggestion' | 'choose_form' | 'create_first' | 'fix_earlier' | 'choose' | 'rewrite' | 'skip' | 'report';
  readonly related?: readonly string[];
  constructor(
    kind: string,
    message: string,
    extra: {
      token?: string; expected?: readonly string[]; forms?: readonly string[]; hint?: string;
      suggest?: readonly string[]; recovery?: OpError['recovery']; related?: readonly string[];
    } = {},
  ) {
    super(message);
    this.name = 'OpError';
    this.kind = kind;
    this.token = extra.token ?? '';
    this.expected = extra.expected ?? [];
    this.forms = extra.forms ?? [];
    if (extra.hint !== undefined) this.hint = extra.hint;
    this.suggest = extra.suggest ?? [];
    this.recovery = extra.recovery ?? 'fix_line';
    if (extra.related !== undefined) this.related = extra.related;
  }
}

export function noticeOf(kind: SymbolicNoticeKind, message: string, severity: 'info' | 'warning' = 'info', names?: readonly string[]): Notice {
  return {
    severity,
    code: SYMBOLIC_NOTICE_CODES[kind],
    kind: kind as NoticeKind,
    message,
    params: {},
    ...(names === undefined ? {} : { names }),
  };
}

function ruleCtxOf(ctx: OpCtx): RuleCtx {
  return ruleCtx(ctx.assume, ctx.tick, ctx.note);
}

/* ------------------------------- arg helpers ---------------------------------- */

function need(args: readonly SymArg[], i: number, op: string): SymArg {
  const a = args[i];
  if (a === undefined) throw new OpError('no_matching_form', `${op} is missing argument ${i + 1}.`, { recovery: 'choose_form' });
  return a;
}

function noExtras(args: readonly SymArg[], n: number, op: string): void {
  if (args.length > n) {
    throw new OpError('no_matching_form', `${op} takes at most ${n} positional arguments; got ${args.length}.`, { recovery: 'choose_form' });
  }
}

function asExpr(a: SymArg, op: string): SymNode {
  if (a.k !== 'expr') throw new OpError('no_matching_form', `${op} needs an expression here.`, { recovery: 'choose_form' });
  return a.e;
}

function asCond(a: SymArg, op: string): SymCond {
  if (a.k !== 'cond') throw new OpError('no_matching_form', `${op} needs an equation or inequality here.`, { recovery: 'choose_form' });
  return a.c;
}

function asSym(a: SymArg, op: string): SymNode & { k: 'sym' } {
  if (a.k === 'sym') return symN(a.name);
  if (a.k === 'expr' && a.e.k === 'sym') return a.e;
  throw new OpError('bad_variable', `${op} needs a Symbol or x, y or z here.`, {
    token: a.k === 'expr' ? toText(a.e) : a.k,
    hint: 'Use x, y, z or a name made with k = Symbol().',
    recovery: 'rewrite',
  });
}

function asNum(a: SymArg, op: string): number {
  if (a.k === 'num') return a.v;
  if (a.k === 'int') return Number(a.v);
  throw new OpError('no_matching_form', `${op} needs a number here.`, { recovery: 'choose_form' });
}

function asText(a: SymArg, op: string): string {
  if (a.k !== 'text') throw new OpError('no_matching_form', `${op} needs text here.`, { recovery: 'choose_form' });
  return a.v;
}

function asList(a: SymArg, op: string): readonly SymArg[] {
  if (a.k !== 'list') throw new OpError('no_matching_form', `${op} needs a list here.`, { recovery: 'choose_form' });
  return a.items;
}

function asMatrix(a: SymArg, op: string): Matrix {
  if (a.k !== 'matrix') throw new OpError('no_matching_form', `${op} needs a matrix here.`, { recovery: 'choose_form' });
  return a.rows;
}

function namedArg(named: ReadonlyMap<string, SymArg>, name: string): SymArg | undefined {
  return named.get(name);
}

/** A Number result when small, else an exact Expr integer (calculator convention). */
export function numOrExpr(v: bigint): SymArg {
  if (v >= BigInt(-(2 ** 53)) && v <= BigInt(2 ** 53)) return { k: 'num', v: Number(v) };
  return { k: 'expr', e: intN(v), exact: true };
}

function exprArg(e: SymNode, exact = true, extra?: { typed?: SymNode; excluded?: readonly SymCond[] }): SymArg {
  return { k: 'expr', e, exact, ...(extra?.typed === undefined ? {} : { typed: extra.typed }), ...(extra?.excluded === undefined ? {} : { excluded: extra.excluded }) };
}

/** Exactness in (once inexact, always inexact) ANDed with exactness out. */
function outExact(args: readonly SymArg[], out: SymNode): boolean {
  const argExact = (a: SymArg): boolean => {
    switch (a.k) {
      case 'expr':
      case 'cond':
      case 'function': return a.exact;
      case 'list': return a.items.every(argExact);
      case 'matrix': return a.rows.every((row) => row.every((x) => !containsInexact(x)));
      case 'named': return argExact(a.v);
      default: return true;
    }
  };
  return args.every(argExact) && !containsInexact(out);
}

function condArg(c: SymCond, exact = true): SymArg {
  return { k: 'cond', c, exact };
}

function checkInputSize(t: SymNode, ctx: OpCtx, op: string): void {
  if (nodeCount(t) > ctx.limits.maxInputNodes) {
    throw new OpError('limit', `${op} input has more than ${ctx.limits.maxInputNodes} nodes.`, { recovery: 'rewrite' });
  }
}

/** Find a sub-expression that is not a polynomial in `v` (for `not_polynomial`). */
function nonPolyPart(t: SymNode, v: SymNode): SymNode | null {
  if (t === v || !containsVar(t, v)) return null;
  switch (t.k) {
    case 'add':
    case 'mul':
      for (const c of (t.k === 'add' ? t.terms : t.factors)) {
        const hit = nonPolyPart(c, v);
        if (hit !== null) return hit;
      }
      return null;
    case 'pow': {
      const e = asInteger(t.exp);
      if (e === null || e < 0n) return t;
      return nonPolyPart(t.base, v);
    }
    default: return t;
  }
}

function containsVar(t: SymNode, v: SymNode): boolean {
  if (t === v) return true;
  switch (t.k) {
    case 'add': return t.terms.some((x) => containsVar(x, v));
    case 'mul': return t.factors.some((x) => containsVar(x, v));
    case 'pow': return containsVar(t.base, v) || containsVar(t.exp, v);
    case 'fn': return t.args.some((x) => containsVar(x, v));
    default: return false;
  }
}

function notPolyErr(op: string, t: SymNode, v: SymNode): OpError {
  const part = nonPolyPart(t, v) ?? t;
  return new OpError('not_polynomial', `${toText(part)} is not a polynomial in ${toText(v)}.`, {
    token: toText(part),
    forms: [`${op}(e: Expr, v: Symbol) -> ...`],
    hint: `${op} works on sums of powers of ${toText(v)}.`,
    recovery: 'rewrite',
  });
}

/* ------------------------------- making values ------------------------------- */

function opExpr(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx): OpOut {
  void ctx;
  noExtras(args, 1, 'Expr');
  const a = need(args, 0, 'Expr');
  if (a.k === 'expr' || a.k === 'cond') return okOut(defined(a));
  if (a.k === 'text') {
    try {
      const parsed = parseExprOrCond(a.v);
      if ('cond' in parsed) return okOut(defined(condArg(parsed.cond)));
      return okOut(defined(exprArg(parsed.expr)));
    } catch (e) {
      if (e instanceof ParseFailure) {
        if (e.limit) throw new OpError('limit', e.message, { token: e.token, recovery: 'rewrite' });
        throw new OpError('syntax', e.message, { token: e.token, recovery: 'fix_line' });
      }
      throw e;
    }
  }
  throw new OpError('not_symbolic', 'Expr needs an expression, an equation or text.', { recovery: 'rewrite' });
}

function opSymbol(args: readonly SymArg[], named: ReadonlyMap<string, SymArg>, ctx: OpCtx): OpOut {
  noExtras(args, 0, 'Symbol');
  const name = ctx.name ?? 's';
  const dom = namedArg(named, 'domain');
  let domain: Domain = 'real';
  if (dom !== undefined) {
    if (dom.k !== 'text') throw new OpError('bad_domain', 'A domain is one of: real positive nonneg negative nonpos nonzero integer natural rational complex.', { recovery: 'fix_line' });
    domain = parseDomain(dom.v);
  }
  return okOut(defined({ k: 'sym', name, domain }));
}

function parseDomain(text: string): Domain {
  const d = text.trim().toLowerCase();
  if (d === 'real' || d === 'positive' || d === 'nonneg' || d === 'negative' || d === 'nonpos' ||
    d === 'nonzero' || d === 'integer' || d === 'natural' || d === 'rational' || d === 'complex') {
    return d;
  }
  throw new OpError('bad_domain', `Unknown domain ${text}. Use one of: real positive nonneg negative nonpos nonzero integer natural rational complex.`, {
    token: text,
    recovery: 'fix_line',
  });
}

function opHold(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx): OpOut {
  void ctx;
  noExtras(args, 1, 'Hold');
  const a = need(args, 0, 'Hold');
  const e = asExpr(a, 'Hold');
  return okOut(defined(exprArg(e, a.k === 'expr' ? a.exact : true, { typed: e })));
}

function opEvaluate(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx): OpOut {
  noExtras(args, 1, 'Evaluate');
  const e = asExpr(need(args, 0, 'Evaluate'), 'Evaluate');
  checkInputSize(e, ctx, 'Evaluate');
  const out = evaluateNode(e, ruleCtxOf(ctx));
  const odd = hasRealOddRoot(e) || hasRealOddRoot(out);
  return okOut(defined(exprArg(out, outExact(args, out))), odd ? [oddRootNotice()] : []);
}

function containsInexact(t: SymNode): boolean {
  if (t.k === 'float' || t.k === 'dec') return true;
  switch (t.k) {
    case 'add': return t.terms.some(containsInexact);
    case 'mul': return t.factors.some(containsInexact);
    case 'pow': return containsInexact(t.base) || containsInexact(t.exp);
    case 'fn': return t.args.some(containsInexact);
    case 'list': return t.items.some(containsInexact);
    case 'piecewise':
      return t.cases.some((cs) => containsInexact(cs.then) || condInexact(cs.when)) ||
        (t.other !== undefined && containsInexact(t.other));
    default: return false;
  }
}

function condInexact(c: SymCond): boolean {
  switch (c.c) {
    case 'rel': return containsInexact(c.l) || containsInexact(c.r);
    case 'in': return containsInexact(c.l);
    case 'not': return condInexact(c.of);
    case 'and':
    case 'or': return c.of.some(condInexact);
    default: return false;
  }
}

/** True when a tree takes a real odd root of a negative number. */
function hasRealOddRoot(t: SymNode): boolean {
  const negNum = (x: SymNode): boolean => {
    const r = asRational(x);
    if (r !== null) return r.n < 0n;
    if (x.k === 'float') return x.v < 0;
    if (x.k === 'dec') return x.mant < 0n;
    return false;
  };
  const walk = (x: SymNode): boolean => {
    if (x.k === 'pow') {
      const r = asRational(x.exp);
      if (r !== null && r.d !== 1n && r.d % 2n === 1n && negNum(x.base)) return true;
    }
    switch (x.k) {
      case 'add': return x.terms.some(walk);
      case 'mul': return x.factors.some(walk);
      case 'pow': return walk(x.base) || walk(x.exp);
      case 'fn': return x.args.some(walk);
      case 'list': return x.items.some(walk);
      case 'piecewise': return x.cases.some((cs) => walk(cs.then));
      default: return false;
    }
  };
  return walk(t);
}

function oddRootNotice(): Notice {
  return noticeOf('real_odd_root', 'An odd root of a negative number was taken as the real root.', 'info');
}

/** True when a tree divides by a literal zero. */
function hasZeroDenominator(t: SymNode): boolean {
  const walk = (x: SymNode): boolean => {
    if (x.k === 'pow') {
      const e = asInteger(x.exp);
      if (e !== null && e < 0n && isZeroNode(x.base)) return true;
    }
    switch (x.k) {
      case 'add': return x.terms.some(walk);
      case 'mul': return x.factors.some(walk);
      case 'pow': return walk(x.base) || walk(x.exp);
      case 'fn': return x.args.some(walk);
      default: return false;
    }
  };
  return walk(t);
}

function opSide(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, _ctx: OpCtx, which: 'l' | 'r', op: string): OpOut {
  void _ctx;
  noExtras(args, 1, op);
  const c = asCond(need(args, 0, op), op);
  if (c.c !== 'rel') {
    return okOut({ defined: false, reason: 'unsupported', detail: { code: 'Y201', text: `${op} needs a single equation or inequality.` } });
  }
  return okOut(defined(exprArg(which === 'l' ? c.l : c.r)));
}

function opToFunction(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, _ctx: OpCtx): OpOut {
  void _ctx;
  noExtras(args, 2, 'ToFunction');
  const e = asExpr(need(args, 0, 'ToFunction'), 'ToFunction');
  const v = asSym(need(args, 1, 'ToFunction'), 'ToFunction');
  const free = freeSymbols(e);
  for (const s of free) {
    if (s !== v.name && s !== 't') {
      return okOut({
        defined: false,
        reason: 'out_of_domain',
        detail: { code: 'Y210', text: `The expression also uses ${s}; a function takes one variable.` },
      });
    }
  }
  return okOut(defined({ k: 'function', param: v.name, body: e, exact: outExact(args, e) }));
}

function opToExpr(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, _ctx: OpCtx): OpOut {
  void _ctx;
  noExtras(args, 1, 'ToExpr');
  const a = need(args, 0, 'ToExpr');
  if (a.k === 'function') return okOut(defined(exprArg(a.body, a.exact)));
  if (a.k === 'expr') return okOut(defined(a));
  throw new OpError('no_matching_form', 'ToExpr needs a function.', { recovery: 'choose_form' });
}

function opToNumber(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, _ctx: OpCtx): OpOut {
  void _ctx;
  noExtras(args, 1, 'ToNumber');
  const e = asExpr(need(args, 0, 'ToNumber'), 'ToNumber');
  const free = freeSymbols(e);
  if (free.size > 0) {
    return okOut({
      defined: false,
      reason: 'out_of_domain',
      detail: { code: 'Y210', text: `The expression still uses ${[...free][0]}; substitute a value first.` },
    });
  }
  const val = evalAt(e, new Map());
  if (val === null || !Number.isFinite(val)) {
    if (hasZeroDenominator(e)) {
      return okOut({ defined: false, reason: 'division_by_zero', detail: { code: 'Y211', text: 'The expression divides by zero.' } });
    }
    return okOut({ defined: false, reason: 'not_finite', detail: { code: 'Y213', text: 'The expression is not a finite number.' } });
  }
  return okOut(defined({ k: 'num', v: val }), hasRealOddRoot(e) ? [oddRootNotice()] : []);
}

/* ---------------------------------- algebra ---------------------------------- */

function opSimplify(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx): OpOut {
  noExtras(args, 1, 'Simplify');
  const a = need(args, 0, 'Simplify');
  if (a.k === 'cond') return simplifyCond(a.c, a.exact, ctx);
  const e = asExpr(a, 'Simplify');
  checkInputSize(e, ctx, 'Simplify');
  const { node, excluded } = simplifyNode(e, ruleCtxOf(ctx));
  const notices = excluded.length > 0 ? [noticeOf('excluded_values', `Cancelled a factor; excluded: ${excluded.map((c) => condText(c)).join(', ')}.`, 'info', excluded.map((c) => condText(c)))] : [];
  return okOut(defined(exprArg(node, outExact(args, node), { excluded })), notices);
}

function simplifyCond(c: SymCond, exact: boolean, ctx: OpCtx): OpOut {
  const go = (t: SymNode): SymNode => simplifyNode(t, ruleCtxOf(ctx)).node;
  switch (c.c) {
    case 'rel': return okOut(defined(condArg(rel(c.op, go(c.l), go(c.r)), exact)));
    case 'in': return okOut(defined(condArg({ c: 'in', l: go(c.l), set: c.set }, exact)));
    case 'not': {
      const inner = simplifyCond(c.of, exact, ctx);
      if (!inner.cell.defined) return inner;
      const v = inner.cell.value;
      if (v.k !== 'cond') return inner;
      return okOut(defined(condArg({ c: 'not', of: v.c }, exact)));
    }
    case 'and':
    case 'or': {
      const parts: SymCond[] = [];
      for (const o of c.of) {
        const inner = simplifyCond(o, exact, ctx);
        if (!inner.cell.defined) return inner;
        const v = inner.cell.value;
        if (v.k !== 'cond') return inner;
        parts.push(v.c);
      }
      return okOut(defined(condArg({ c: c.c, of: parts }, exact)));
    }
    default: return okOut(defined(condArg(c, exact)));
  }
}

function opExpand(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx): OpOut {
  noExtras(args, 2, 'Expand');
  const e = asExpr(need(args, 0, 'Expand'), 'Expand');
  checkInputSize(e, ctx, 'Expand');
  if (args.length > 1) {
    const v = asSym(args[1] as SymArg, 'Expand');
    const coeffs = treeToUPolySym(e, v, ctx.tick);
    if (coeffs !== null) {
      const parts: SymNode[] = [];
      coeffs.forEach((c, i) => {
        if (isZeroNode(c)) return;
        const ec = expandNode(c, ctx.tick, ctx.limits.maxExpandTerms);
        parts.push(i === 0 ? ec : mul(ec, pow(v, intN(i))));
      });
      const grouped = add(...parts);
      return okOut(defined(exprArg(grouped, outExact(args, grouped))));
    }
  }
  const out = expandNode(e, ctx.tick, ctx.limits.maxExpandTerms);
  return okOut(defined(exprArg(out, outExact(args, out))));
}

function opFactor(args: readonly SymArg[], named: ReadonlyMap<string, SymArg>, ctx: OpCtx): OpOut {
  noExtras(args, 1, 'Factor');
  const a = need(args, 0, 'Factor');
  const overArg = namedArg(named, 'over');
  let over: 'rational' | 'complex' = 'rational';
  if (overArg !== undefined) {
    if (overArg.k !== 'text') throw new OpError('bad_option', 'Factor over is "rational" or "complex".', { recovery: 'fix_line' });
    const t = overArg.v.trim().toLowerCase();
    if (t === 'complex') over = 'complex';
    else if (t !== 'rational') {
      throw new OpError('bad_option', `Factor over is "rational" or "complex"; got ${overArg.v}.`, {
        token: overArg.v,
        recovery: 'fix_line',
      });
    }
  }
  if (a.k === 'num' || a.k === 'int') {
    const v = a.k === 'int' ? a.v : Number.isInteger(a.v) ? BigInt(a.v) : null;
    if (v === null) throw new OpError('bad_argument', 'Factor of a number needs a whole number.', { recovery: 'rewrite' });
    const { node, irreducible } = factorNode(intN(v), ruleCtxOf(ctx));
    const notices = irreducible ? [noticeOf('irreducible', `${v} is prime.`, 'info')] : [];
    return okOut(defined(exprArg(node, true)), notices);
  }
  const e = asExpr(a, 'Factor');
  checkInputSize(e, ctx, 'Factor');
  checkFactorDegree(e, ctx);
  const { node, irreducible } = factorNode(e, ruleCtxOf(ctx), over);
  const notices = irreducible ? [noticeOf('irreducible', 'This does not factor over the rationals.', 'info')] : [];
  return okOut(defined(exprArg(node, outExact(args, node))), notices);
}

/** `Factor` accepts degree 200; above is undefined `limit`. */
function checkFactorDegree(e: SymNode, ctx: OpCtx): void {
  const syms = [...freeSymbols(e)].map((s) => symN(s));
  for (const v of syms.slice(0, 4)) {
    const p = treeToUPoly(e, v, ctx.tick);
    if (p !== null && p.c.length - 1 > ctx.limits.maxFactorDegree) throw new LimitExceeded('degree');
  }
}

function opRationalize(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx): OpOut {
  noExtras(args, 1, 'Rationalize');
  const e = asExpr(need(args, 0, 'Rationalize'), 'Rationalize');
  checkInputSize(e, ctx, 'Rationalize');
  if (e.k === 'float') {
    const f = nearestFraction(e.v);
    if (f !== null) return okOut(defined(exprArg(ratN(f.n, f.d), true)));
  }
  const out = rationalizeNode(e, ruleCtxOf(ctx));
  return okOut(defined(exprArg(out, outExact(args, out))));
}

function opPartialFractions(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx): OpOut {
  noExtras(args, 2, 'PartialFractions');
  const e = asExpr(need(args, 0, 'PartialFractions'), 'PartialFractions');
  const v = asSym(need(args, 1, 'PartialFractions'), 'PartialFractions');
  checkInputSize(e, ctx, 'PartialFractions');
  if (!isRatFunc(e, v)) throw notPolyErr('PartialFractions', e, v);
  const out = apartNode(e, v, ruleCtxOf(ctx));
  if (out === null) {
    return okOut({
      defined: false,
      reason: 'unsupported',
      detail: { code: 'Y201', text: 'Partial fractions needs distinct linear factors or single quadratics.', stage: 'isolate' },
    });
  }
  return okOut(defined(exprArg(out, outExact(args, out))));
}

function isRatFunc(t: SymNode, v: SymNode): boolean {
  if (!containsVar(t, v)) return true;
  switch (t.k) {
    case 'add': return t.terms.every((x) => isRatFunc(x, v));
    case 'mul': return t.factors.every((x) => isRatFunc(x, v));
    case 'pow': {
      const e = asInteger(t.exp);
      if (e === null) return false;
      return isRatFunc(t.base, v);
    }
    case 'sym': return t === v;
    case 'int': case 'rat': return true;
    default: return false;
  }
}

function opCompleteSquare(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx): OpOut {
  noExtras(args, 2, 'CompleteSquare');
  const e = asExpr(need(args, 0, 'CompleteSquare'), 'CompleteSquare');
  const v = asSym(need(args, 1, 'CompleteSquare'), 'CompleteSquare');
  checkInputSize(e, ctx, 'CompleteSquare');
  const coeffs = treeToUPolySym(e, v, ctx.tick);
  if (coeffs === null) throw notPolyErr('CompleteSquare', e, v);
  const out = completeSquareNode(e, v, ruleCtxOf(ctx));
  if (out === null) {
    throw new OpError('bad_argument', `CompleteSquare needs a quadratic in ${toText(v)}.`, {
      token: toText(e),
      recovery: 'rewrite',
    });
  }
  return okOut(defined(exprArg(out, outExact(args, out))));
}

function opCoefficients(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx): OpOut {
  noExtras(args, 2, 'Coefficients');
  const e = asExpr(need(args, 0, 'Coefficients'), 'Coefficients');
  const v = asSym(need(args, 1, 'Coefficients'), 'Coefficients');
  checkInputSize(e, ctx, 'Coefficients');
  const coeffs = treeToUPolySym(e, v, ctx.tick);
  if (coeffs === null) throw notPolyErr('Coefficients', e, v);
  const inExact = outExact(args, e);
  const items = [...coeffs].reverse().map((c) => exprArg(c, inExact && !containsInexact(c)));
  return okOut(defined({ k: 'list', items }));
}

function opDegree(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx): OpOut {
  noExtras(args, 2, 'Degree');
  const e = asExpr(need(args, 0, 'Degree'), 'Degree');
  const v = asSym(need(args, 1, 'Degree'), 'Degree');
  checkInputSize(e, ctx, 'Degree');
  const coeffs = treeToUPolySym(e, v, ctx.tick);
  if (coeffs === null) throw notPolyErr('Degree', e, v);
  return okOut(defined({ k: 'num', v: coeffs.length - 1 }));
}

function opDivMod(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx, which: 'div' | 'mod', op: string): OpOut {
  noExtras(args, 3, op);
  const a = need(args, 0, op);
  const b = need(args, 1, op);
  if ((a.k === 'num' || a.k === 'int') && (b.k === 'num' || b.k === 'int')) {
    const av = a.k === 'int' ? a.v : Number.isInteger(a.v) ? BigInt(a.v) : null;
    const bv = b.k === 'int' ? b.v : Number.isInteger(b.v) ? BigInt(b.v) : null;
    if (av === null || bv === null) {
      throw new OpError('bad_argument', `${op} of numbers needs whole numbers.`, { recovery: 'rewrite' });
    }
    if (bv === 0n) {
      return okOut({ defined: false, reason: 'division_by_zero', detail: { code: 'Y211', text: `${op} by zero.` } });
    }
    const r = ((av % bv) + bv) % bv;
    return okOut(defined(numOrExpr(which === 'div' ? divSign(av, bv) : r)));
  }
  const p = asExpr(a, op);
  const q = asExpr(b, op);
  const v = asSym(need(args, 2, op), op);
  checkInputSize(p, ctx, op);
  checkInputSize(q, ctx, op);
  const pp = treeToUPoly(p, v, ctx.tick);
  const qp = treeToUPoly(q, v, ctx.tick);
  if (pp === null) throw notPolyErr(op, p, v);
  if (qp === null) throw notPolyErr(op, q, v);
  if (upolyIsZero(qp)) {
    return okOut({ defined: false, reason: 'division_by_zero', detail: { code: 'Y211', text: `${op} by the zero polynomial.` } });
  }
  const { q: quot, r } = upolyDivMod(pp, qp, ctx.tick);
  const out = which === 'div' ? upolyToTree(quot, v) : upolyToTree(r, v);
  return okOut(defined(exprArg(out, outExact(args, out))));
}

/** Floored quotient, consistent with `Mod` (which follows the sign of the divisor). */
function divSign(a: bigint, b: bigint): bigint {
  return (a - (((a % b) + b) % b)) / b;
}

function opDivision(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, _ctx: OpCtx): OpOut {
  void _ctx;
  noExtras(args, 2, 'Division');
  const a = need(args, 0, 'Division');
  const b = need(args, 1, 'Division');
  const av = a.k === 'int' ? a.v : a.k === 'num' && Number.isInteger(a.v) ? BigInt(a.v) : null;
  const bv = b.k === 'int' ? b.v : b.k === 'num' && Number.isInteger(b.v) ? BigInt(b.v) : null;
  if (av === null || bv === null) {
    throw new OpError('bad_argument', 'Division needs whole numbers.', { recovery: 'rewrite' });
  }
  if (bv === 0n) {
    return okOut({ defined: false, reason: 'division_by_zero', detail: { code: 'Y211', text: 'Division by zero.' } });
  }
  const r = ((av % bv) + bv) % bv;
  const q = (av - r) / bv;
  return okOut(defined({ k: 'list', items: [numOrExpr(q), numOrExpr(r)] }));
}

function opGcdLcm(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx, which: 'gcd' | 'lcm', op: string): OpOut {
  noExtras(args, 3, op);
  const a = need(args, 0, op);
  if (a.k === 'list') {
    const items = a.items.map((x) => {
      if (x.k === 'int') return x.v;
      if (x.k === 'num' && Number.isInteger(x.v)) return BigInt(x.v);
      throw new OpError('bad_argument', `${op} of a list needs whole numbers.`, { recovery: 'rewrite' });
    });
    if (items.length === 0) {
      return okOut({ defined: false, reason: 'empty_list', detail: { code: 'Y212', text: `${op} of an empty list.` } });
    }
    let acc = items[0] as bigint;
    for (const x of items.slice(1)) acc = which === 'gcd' ? gcdBig(acc, x) : lcmBig(acc, x);
    return okOut(defined(numOrExpr(acc)));
  }
  if ((a.k === 'num' || a.k === 'int') && args.length > 1 && (args[1]?.k === 'num' || args[1]?.k === 'int')) {
    const b = args[1] as SymArg;
    const av = a.k === 'int' ? a.v : Number.isInteger((a as { v: number }).v) ? BigInt((a as { v: number }).v) : null;
    const bv = b.k === 'int' ? b.v : Number.isInteger((b as { v: number }).v) ? BigInt((b as { v: number }).v) : null;
    if (av === null || bv === null) throw new OpError('bad_argument', `${op} needs whole numbers.`, { recovery: 'rewrite' });
    return okOut(defined(numOrExpr(which === 'gcd' ? gcdBig(av, bv) : lcmBig(av, bv))));
  }
  const p = asExpr(a, op);
  const q = asExpr(need(args, 1, op), op);
  const v = asSym(need(args, 2, op), op);
  checkInputSize(p, ctx, op);
  const pp = treeToUPoly(p, v, ctx.tick);
  const qp = treeToUPoly(q, v, ctx.tick);
  if (pp === null) throw notPolyErr(op, p, v);
  if (qp === null) throw notPolyErr(op, q, v);
  const g = upolyGcd(pp, qp, ctx.tick);
  if (which === 'gcd') {
    const out = upolyToTree(g, v);
    return okOut(defined(exprArg(out, outExact(args, out))));
  }
  if (upolyIsZero(g)) {
    return okOut({ defined: false, reason: 'division_by_zero', detail: { code: 'Y211', text: 'LCM of zero polynomials.' } });
  }
  const prod = upolyMul(pp, qp, ctx.tick);
  const { q: l } = upolyDivMod(prod, g, ctx.tick);
  const out = upolyToTree(l, v);
  return okOut(defined(exprArg(out, outExact(args, out))));
}

function gcdBig(a: bigint, b: bigint): bigint {
  return bigGcd(a, b);
}

function lcmBig(a: bigint, b: bigint): bigint {
  if (a === 0n || b === 0n) return 0n;
  const g = bigGcd(a, b);
  const l = (a / g) * b;
  return l < 0n ? -l : l;
}

function opEquivalent(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx): OpOut {
  noExtras(args, 2, 'Equivalent');
  const a = need(args, 0, 'Equivalent');
  const b = need(args, 1, 'Equivalent');
  const rctx = ruleCtxOf(ctx);
  if (a.k === 'cond' && b.k === 'cond') {
    const v = equivalentCond(a.c, b.c, rctx);
    return boolOrUnproven(v, 'Equivalent');
  }
  if (a.k === 'expr' && b.k === 'expr') {
    checkInputSize(a.e, ctx, 'Equivalent');
    checkInputSize(b.e, ctx, 'Equivalent');
    const v = equivalent(a.e, b.e, rctx);
    if (v === 'true' && excludedDiffer(a, b)) {
      return okOut(defined({ k: 'bool', v: true }), [noticeOf('differ_at', 'The forms differ at the excluded values.', 'info')]);
    }
    return boolOrUnproven(v, 'Equivalent');
  }
  throw new OpError('no_matching_form', 'Equivalent needs two expressions or two conditions.', { recovery: 'choose_form' });
}

function excludedDiffer(a: SymArg & { k: 'expr' }, b: SymArg & { k: 'expr' }): boolean {
  const ea = a.excluded ?? [];
  const eb = b.excluded ?? [];
  if (ea.length === 0 && eb.length === 0) return false;
  const ka = ea.map((c) => condText(c)).sort().join(';');
  const kb = eb.map((c) => condText(c)).sort().join(';');
  return ka !== kb;
}

function boolOrUnproven(v: 'true' | 'false' | 'unknown', op: string): OpOut {
  if (v === 'true') return okOut(defined({ k: 'bool', v: true }));
  if (v === 'false') return okOut(defined({ k: 'bool', v: false }));
  return okOut({
    defined: false,
    reason: 'unproven',
    detail: { code: 'Y206', text: `${op} could not decide; random testing found no difference (probably equal).` },
  });
}

function opIsZero(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx): OpOut {
  noExtras(args, 1, 'IsZero');
  const e = asExpr(need(args, 0, 'IsZero'), 'IsZero');
  checkInputSize(e, ctx, 'IsZero');
  return boolOrUnproven(isZeroVerdict(e, ruleCtxOf(ctx)), 'IsZero');
}

/* --------------------------------- equations ---------------------------------- */

interface SolveBounds {
  readonly from?: number;
  readonly to?: number;
  readonly domain: 'real' | 'complex';
}

function solveBounds(
  args: readonly SymArg[], named: ReadonlyMap<string, SymArg>, startIdx: number, op: string,
): SolveBounds {
  let from: number | undefined;
  let to: number | undefined;
  let domain: 'real' | 'complex' = 'real';
  const pos = args.slice(startIdx);
  if (pos.length > 0) from = asNum(pos[0] as SymArg, op);
  if (pos.length > 1) to = asNum(pos[1] as SymArg, op);
  if (pos.length > 2) {
    const d = pos[2] as SymArg;
    if (d.k !== 'text') throw new OpError('no_matching_form', `${op} takes from, to and domain after the variable.`, { recovery: 'choose_form' });
    const dd = d.v.trim().toLowerCase();
    if (dd !== 'real' && dd !== 'complex') {
      throw new OpError('bad_domain', `Solve domain is "real" or "complex"; got ${d.v}.`, { token: d.v, recovery: 'fix_line' });
    }
    domain = dd;
  }
  if (pos.length > 3) throw new OpError('no_matching_form', `${op} takes at most from, to and domain after the variable.`, { recovery: 'choose_form' });
  const nFrom = namedArg(named, 'from');
  const nTo = namedArg(named, 'to');
  const nDomain = namedArg(named, 'domain');
  if (nFrom !== undefined) from = asNum(nFrom, op);
  if (nTo !== undefined) to = asNum(nTo, op);
  if (nDomain !== undefined) {
    if (nDomain.k !== 'text') throw new OpError('bad_domain', 'Solve domain is "real" or "complex".', { recovery: 'fix_line' });
    const d = nDomain.v.trim().toLowerCase();
    if (d !== 'real' && d !== 'complex') {
      throw new OpError('bad_domain', `Solve domain is "real" or "complex"; got ${nDomain.v}.`, { token: nDomain.v, recovery: 'fix_line' });
    }
    domain = d;
  }
  if (from !== undefined && to !== undefined && from > to) {
    throw new OpError('bad_option', `Solve needs from <= to; got from = ${from}, to = ${to}.`, { recovery: 'fix_line' });
  }
  return { ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }), domain };
}

function inferVar(c: SymCond, op: string): SymNode & { k: 'sym' } {
  const free = [...freeSymbolsCond(c)];
  if (free.length !== 1) {
    throw new OpError('bad_variable', `${op} needs exactly one free symbol, or pass the variable.`, {
      hint: `Write ${op}(..., x) with the variable to solve for.`,
      recovery: 'rewrite',
    });
  }
  return symN(free[0] as string);
}

function solveNotices(r: SolveResult): Notice[] {
  const out: Notice[] = [];
  for (const n of r.notices) {
    if (n === 'periodic_family') out.push(noticeOf('periodic_family', 'Solutions are families with an integer parameter.', 'info'));
    else if (n === 'cases') out.push(noticeOf('cases', 'The answer is generic; special parameter cases are listed.', 'info'));
    else if (n === 'denominator_unchecked') out.push(noticeOf('denominator_unchecked', 'A root was kept though the denominator could not be proved nonzero.', 'warning'));
    else if (n === 'multiple_root') out.push(noticeOf('multiple_root', 'A multiple root is reported once.', 'info'));
  }
  return out;
}

function solutionsToConds(v: SymNode, r: SolveResult): SymArg[] {
  if (r.all) return [condArg({ c: 'in', l: v, set: 'R' })];
  return r.solutions.map((s) => condArg(rel('==', v, s), !containsInexact(s)));
}

/** Solve one condition: equations, inequalities, `and`/`or`/`not` combinations. */
function solveOneCond(
  c: SymCond, v: SymNode, exact: boolean, ctx: OpCtx, bounds: SolveBounds, op: string,
): { items: SymArg[]; result: SolveResult } {
  if (c.c === 'rel' && c.op === '==') {
    const f = toDifference(c) as SymNode;
    checkInputSize(f, ctx, op);
    const r = bounds.domain === 'complex'
      ? csolveEquation(f, v, ctx.assume, ctx.tick, ctx.note)
      : solveEquation(f, v, ctx.assume, ctx.tick, bounds, ctx.note);
    return { items: solutionsToConds(v, r), result: r };
  }
  if (c.c === 'rel' && (c.op === '!=' || c.op === '<' || c.op === '<=' || c.op === '>' || c.op === '>=')) {
    if (bounds.domain === 'complex') {
      throw new OpError('bad_domain', 'Inequalities solve over the reals only.', { recovery: 'rewrite' });
    }
    const f = toDifference(c) as SymNode;
    checkInputSize(f, ctx, op);
    const pieces = solveInequality(f, c.op, v, ctx.assume, ctx.tick, bounds, ctx.note);
    const r: SolveResult = { solutions: [], all: false, cases: [], notices: [], unchecked: false };
    if (pieces.length === 1 && pieces[0]?.c === 'in') return { items: [condArg(pieces[0] as SymCond, exact)], result: r };
    return { items: pieces.map((p) => condArg(p, exact)), result: r };
  }
  if (c.c === 'or') {
    const items: SymArg[] = [];
    const notes: string[] = [];
    for (const o of c.of) {
      const inner = solveOneCond(o, v, exact, ctx, bounds, op);
      items.push(...inner.items);
      notes.push(...inner.result.notices);
    }
    const dedup = dedupConds(items);
    return { items: dedup, result: { solutions: [], all: false, cases: [], notices: [...new Set(notes)], unchecked: false } };
  }
  if (c.c === 'and') {
    if (c.of.length === 0) return { items: [condArg({ c: 'in', l: v, set: 'R' }, exact)], result: { solutions: [], all: false, cases: [], notices: [], unchecked: false } };
    const eqIdx = c.of.findIndex((o) => o.c === 'rel' && o.op === '==');
    if (eqIdx < 0) throw new Unsupported('conjunctions of inequalities', 'classify');
    const first = solveOneCond(c.of[eqIdx] as SymCond, v, exact, ctx, bounds, op);
    const rest = c.of.filter((_, i) => i !== eqIdx);
    if (rest.every((o) => o.c === 'rel')) {
      const rctx = ruleCtxOf(ctx);
      const kept = first.items.filter((item) => {
        if (item.k !== 'cond' || item.c.c !== 'rel' || item.c.op !== '==') return false;
        const val = item.c.r;
        return rest.every((o) => {
          if (o.c !== 'rel') return false;
          const sub = simplifyNode(substituteList(add(o.l, negateNode(o.r)), [[v, val]]), rctx).node;
          if (isZeroNode(sub)) return true;
          const s = evalAt(sub, new Map());
          if (s === null) return false;
          return holdsRel(o.op, s);
        });
      });
      return { items: kept, result: first.result };
    }
    throw new Unsupported('conjunctions of inequalities', 'classify');
  }
  if (c.c === 'not' && c.of.c === 'rel' && c.of.op === '==') {
    const inner = toDifference(c.of) as SymNode;
    return solveOneCond({ c: 'rel', op: '!=', l: inner, r: intN(0) }, v, exact, ctx, bounds, op);
  }
  throw new Unsupported('this condition shape', 'classify');
}

function holdsRel(op: string, diff: number): boolean {
  if (op === '==') return Math.abs(diff) < 1e-9;
  if (op === '!=') return Math.abs(diff) >= 1e-9;
  if (op === '<') return diff < 0;
  if (op === '<=') return diff <= 1e-9;
  if (op === '>') return diff > 0;
  return diff >= -1e-9;
}

function dedupConds(items: readonly SymArg[]): SymArg[] {
  const seen = new Set<string>();
  const out: SymArg[] = [];
  for (const item of items) {
    const key = item.k === 'cond' ? condText(item.c) : `${item.k}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function opSolve(args: readonly SymArg[], named: ReadonlyMap<string, SymArg>, ctx: OpCtx, valuesOnly: boolean, op: string): OpOut {
  const a = need(args, 0, op);
  if (a.k === 'list' && args.length > 1 && (args[1] as SymArg).k === 'list') {
    return opSystem(a.items, (args[1] as SymArg & { k: 'list' }).items, named, ctx, op);
  }
  const c = asCond(a, op);
  let v: SymNode & { k: 'sym' };
  let bounds: SolveBounds;
  if (args.length > 1 && (args[1] as SymArg).k !== 'named') {
    const second = args[1] as SymArg;
    if (second.k === 'sym' || (second.k === 'expr' && second.e.k === 'sym')) {
      v = asSym(second, op);
      bounds = solveBounds(args, named, 2, op);
    } else {
      v = inferVar(c, op);
      bounds = solveBounds(args, named, 1, op);
    }
  } else {
    v = inferVar(c, op);
    bounds = solveBounds(args, named, 1, op);
  }
  if (ctx.assume.domains.get(v.name) === 'complex' && bounds.domain === 'real') bounds = { ...bounds, domain: 'complex' };
  const inputInexact = condInexact(c);
  const { items, result } = solveOneCond(c, v, !inputInexact, ctx, bounds, op);
  const notices = solveNotices(result);
  if (items.some((s) => s.k === 'cond' && (s.c.c === 'rel' ? hasRealOddRoot(s.c.l) || hasRealOddRoot(s.c.r) : false))) {
    notices.push(oddRootNotice());
  }
  const mark = (s: SymArg): SymArg => (s.k === 'cond' || s.k === 'expr' ? { ...s, exact: s.exact && !inputInexact } : s);
  if (valuesOnly) {
    const vals: SymArg[] = [];
    for (const item of items) {
      if (item.k === 'cond' && item.c.c === 'rel' && item.c.op === '==') vals.push(exprArg(item.c.r, item.exact && !inputInexact));
    }
    if (vals.length === 0 && items.length > 0) {
      for (const b of criticalValues(c, v, ctx)) vals.push(exprArg(b, !inputInexact && !containsInexact(b)));
    }
    return okOut(defined({ k: 'list', items: vals }), notices);
  }
  const cases = result.cases.length > 0 ? { cases: result.cases } : {};
  return okOut(defined({ k: 'list', items: items.map(mark), ...cases }), notices);
}

/** Boundary values of an inequality (for `Solutions` of an inequality). */
function criticalValues(c: SymCond, v: SymNode, ctx: OpCtx): SymNode[] {
  if (c.c !== 'rel') return [];
  const f = toDifference(c);
  if (f === null) return [];
  try {
    const r = solveEquation(f, v, ctx.assume, ctx.tick, {});
    return [...r.solutions];
  } catch (err) {
    if (err instanceof Unsupported) return [];
    throw err;
  }
}

function opSystem(
  cs: readonly SymArg[], vs: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx, op: string,
): OpOut {
  void _named;
  if (vs.length > ctx.limits.maxSystemVars) {
    throw new OpError('solve_arity', `${op} takes at most ${ctx.limits.maxSystemVars} unknowns; got ${vs.length}.`, { recovery: 'rewrite' });
  }
  const vars = vs.map((s) => asSym(s, op));
  const inputInexact = cs.some((s) => s.k === 'cond' && condInexact(s.c));
  const eqs: SymNode[] = cs.map((s) => {
    if (s.k !== 'cond' || s.c.c !== 'rel' || s.c.op !== '==') {
      throw new OpError('no_matching_form', `${op} systems need equations (==).`, { recovery: 'choose_form' });
    }
    return toDifference(s.c) as SymNode;
  });
  const r = solveSystem(eqs, vars, ctx.assume, ctx.tick, {});
  const items = r.solutions.map((sol) => ({
    k: 'list' as const,
    items: sol.map((val, i) => condArg(rel('==', vars[i] as SymNode, val), !inputInexact && !containsInexact(val))),
  }));
  return okOut(defined({ k: 'list', items }), []);
}

function opNSolve(args: readonly SymArg[], named: ReadonlyMap<string, SymArg>, ctx: OpCtx, valuesOnly: boolean, op: string): OpOut {
  const a = need(args, 0, op);
  if (a.k === 'list') {
    const cs = a.items;
    const vs = asList(need(args, 1, op), op);
    const starts = asList(need(args, 2, op), op);
    if (vs.length > ctx.limits.maxSystemVars) {
      throw new OpError('solve_arity', `${op} takes at most ${ctx.limits.maxSystemVars} unknowns.`, { recovery: 'rewrite' });
    }
    const vars = vs.map((s) => asSym(s, op));
    const eqs = cs.map((s) => {
      if (s.k !== 'cond' || s.c.c !== 'rel' || s.c.op !== '==') {
        throw new OpError('no_matching_form', `${op} systems need equations (==).`, { recovery: 'choose_form' });
      }
      return toDifference(s.c) as SymNode;
    });
    const nums = starts.map((s) => asNum(s, op));
    const r = nsolveSystem(eqs, vars, nums, ctx.tick);
    const items = r.solutions.map((sol) => ({
      k: 'list' as const,
      items: sol.map((val, i) => condArg(rel('==', vars[i] as SymNode, val), false)),
    }));
    return okOut(defined({ k: 'list', items }), solveNotices({ ...r, solutions: [], all: false, cases: [] }));
  }
  const c = asCond(a, op);
  if (c.c !== 'rel' || c.op !== '==') {
    throw new OpError('no_matching_form', `${op} needs an equation (==).`, { recovery: 'choose_form' });
  }
  const v = args.length > 1 ? asSym(need(args, 1, op), op) : inferVar(c, op);
  const rest = args.slice(2);
  let start: number | undefined;
  let from: number | undefined;
  let to: number | undefined;
  if (rest.length > 2) throw new OpError('no_matching_form', `${op} takes a start or from and to after the variable.`, { recovery: 'choose_form' });
  if (rest.length === 1) start = asNum(rest[0] as SymArg, op);
  if (rest.length === 2) {
    from = asNum(rest[0] as SymArg, op);
    to = asNum(rest[1] as SymArg, op);
  }
  const nFrom = namedArg(named, 'from');
  const nTo = namedArg(named, 'to');
  if (nFrom !== undefined) from = asNum(nFrom, op);
  if (nTo !== undefined) to = asNum(nTo, op);
  if (from !== undefined && to !== undefined && from > to) {
    throw new OpError('bad_option', `${op} needs from <= to.`, { recovery: 'fix_line' });
  }
  const f = toDifference(c) as SymNode;
  checkInputSize(f, ctx, op);
  const r = nsolveEquation(f, v, ctx.assume, ctx.tick, {
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    ...(start === undefined ? {} : { start }),
  });
  const notices = solveNotices(r);
  if (valuesOnly) return okOut(defined({ k: 'list', items: r.solutions.map((s) => exprArg(s, false)) }), notices);
  return okOut(defined({ k: 'list', items: r.solutions.map((s) => condArg(rel('==', v, s), false)) }), notices);
}

function opCSolve(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx, valuesOnly: boolean, op: string): OpOut {
  void _named;
  noExtras(args, 2, op);
  const c = asCond(need(args, 0, op), op);
  if (c.c !== 'rel' || c.op !== '==') {
    throw new OpError('no_matching_form', `${op} needs an equation (==).`, { recovery: 'choose_form' });
  }
  const v = args.length > 1 ? asSym(need(args, 1, op), op) : inferVar(c, op);
  const f = toDifference(c) as SymNode;
  checkInputSize(f, ctx, op);
  const inputInexact = condInexact(c);
  const r = csolveEquation(f, v, ctx.assume, ctx.tick, ctx.note);
  const notices = solveNotices(r);
  if (r.all) {
    const all = solutionsToConds(v, r);
    if (valuesOnly) return okOut(defined({ k: 'list', items: [] }), notices);
    return okOut(defined({ k: 'list', items: all }), notices);
  }
  if (valuesOnly) return okOut(defined({ k: 'list', items: r.solutions.map((s) => exprArg(s, !inputInexact && !containsInexact(s))) }), notices);
  return okOut(defined({ k: 'list', items: r.solutions.map((s) => condArg(rel('==', v, s), !inputInexact && !containsInexact(s))) }), notices);
}

/* --------------------------- substitute and numeric ---------------------------- */

function opSubstitute(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx): OpOut {
  void ctx;
  noExtras(args, 3, 'Substitute');
  const e = asExpr(need(args, 0, 'Substitute'), 'Substitute');
  const old = need(args, 1, 'Substitute');
  if (old.k === 'list') {
    const pairs: (readonly [SymNode, SymNode])[] = old.items.map((p) => {
      if (p.k !== 'cond' || p.c.c !== 'rel' || p.c.op !== '==') {
        throw new OpError('no_matching_form', 'Substitute pairs are old == new equations.', { recovery: 'choose_form' });
      }
      return [p.c.l, p.c.r] as const;
    });
    const out = substituteList(e, pairs);
    return okOut(defined(exprArg(out, outExact(args, out))));
  }
  const nw = need(args, 2, 'Substitute');
  const oldNode = old.k === 'sym' ? symN(old.name) : old.k === 'expr' ? old.e : null;
  const newNode = nw.k === 'sym' ? symN(nw.name) : nw.k === 'expr' ? nw.e : nw.k === 'num' ? floatN(nw.v) : null;
  if (oldNode === null || newNode === null) {
    throw new OpError('no_matching_form', 'Substitute(e, old, new) needs expressions or symbols.', { recovery: 'choose_form' });
  }
  const out = substituteNode(e, oldNode, newNode);
  return okOut(defined(exprArg(out, outExact(args, out))));
}

/* ---------------------------------- numeric ----------------------------------- */

function opNumeric(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx): OpOut {
  noExtras(args, 2, 'Numeric');
  const e = asExpr(need(args, 0, 'Numeric'), 'Numeric');
  checkInputSize(e, ctx, 'Numeric');
  let digits = 15;
  if (args.length > 1) {
    const d = asNum(need(args, 1, 'Numeric'), 'Numeric');
    if (!Number.isInteger(d) || d < 1 || d > ctx.limits.maxNumericDigits) {
      throw new OpError('bad_digits', `Numeric digits is a whole number from 1 to ${ctx.limits.maxNumericDigits}.`, {
        token: `${d}`,
        recovery: 'fix_line',
      });
    }
    digits = d;
  }
  const odd = hasRealOddRoot(e) ? [oddRootNotice()] : [];
  const dec = toDecimal(e, digits, ctx.tick);
  if (dec !== null) return okOut(defined({ k: 'expr', e: dec, exact: false, display: { digits } }), odd);
  const val = evalAt(e, new Map());
  if (val === null || !Number.isFinite(val)) {
    if (freeSymbols(e).size > 0) {
      return okOut({ defined: false, reason: 'out_of_domain', detail: { code: 'Y210', text: 'Numeric needs a value for every symbol.' } });
    }
    if (hasZeroDenominator(e)) {
      return okOut({ defined: false, reason: 'division_by_zero', detail: { code: 'Y211', text: 'The expression divides by zero.' } });
    }
    return okOut({ defined: false, reason: 'not_finite', detail: { code: 'Y213', text: 'The expression is not finite.' } });
  }
  const node = decFromFloat(val, digits);
  return okOut(defined({ k: 'expr', e: node, exact: false, display: { digits: Math.min(digits, 17) } }), odd);
}

/** A float as a decimal node with up to 17 significant digits. */
function decFromFloat(val: number, digits: number): SymNode {
  const prec = Math.min(Math.max(1, digits), 17);
  if (val === 0) return decN(0n, 0, digits);
  const text = val.toPrecision(prec);
  const m = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (m === null) return decN(BigInt(Math.round(val)), 0, digits);
  const neg = m[1] === '-';
  const frac = m[3] ?? '';
  const exp = m[4] === undefined ? 0 : Number.parseInt(m[4], 10);
  const digitsOnly = ((m[2] as string) + frac).replace(/^0+/, '') || '0';
  let mant = BigInt(digitsOnly);
  if (neg) mant = -mant;
  const pointExp = exp - frac.length;
  return decN(mant, pointExp, digits);
}

/**
 * Exact decimal evaluation with guard digits: rationals by long division, square roots
 * by integer Newton iteration, pi by Machin's formula and e by its series. Null when
 * the tree needs other transcendental functions (the documented decimal.js job) — the
 * caller falls back to floats.
 */
function toDecimal(e: SymNode, digits: number, tick: Ticker): SymNode | null {
  const guard = digits + 10;
  const scale = 10n ** BigInt(guard);
  const val = scaledInt(e, scale, tick);
  if (val === null) return null;
  const rounded = roundHalfEven(val, 10n ** 10n);
  return decN(rounded, -digits, digits);
}

function roundHalfEven(v: bigint, unit: bigint): bigint {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const q = a / unit;
  const r = a % unit;
  const twice = r * 2n;
  let out = q;
  if (twice > unit || (twice === unit && q % 2n === 1n)) out = q + 1n;
  return neg ? -out : out;
}

/** Scaled integer value `round(v * scale)`, or null when not exactly evaluable. */
function scaledInt(e: SymNode, scale: bigint, tick: Ticker): bigint | null {
  tick.tick(1);
  switch (e.k) {
    case 'int': return e.v * scale;
    case 'rat': return (e.n * scale) / e.d;
    case 'float': {
      const r = shortestDecimalRational(e.v);
      if (r === null) return null;
      return (r.n * scale) / r.d;
    }
    case 'dec': {
      if (e.exp >= 0) return e.mant * (10n ** BigInt(e.exp)) * scale;
      return (e.mant * scale) / (10n ** BigInt(-e.exp));
    }
    case 'const': {
      if (e.name === 'pi') return piScaled(scale, tick);
      if (e.name === 'e') return eScaled(scale, tick);
      return null;
    }
    case 'add': {
      let s = 0n;
      for (const t of e.terms) {
        const v = scaledInt(t, scale, tick);
        if (v === null) return null;
        s += v;
      }
      return s;
    }
    case 'mul': {
      let p = scale;
      for (const f of e.factors) {
        const v = scaledInt(f, scale, tick);
        if (v === null) return null;
        p = (p * v) / scale;
      }
      return p;
    }
    case 'pow': {
      const ei = asInteger(e.exp);
      if (ei !== null && ei >= 0n) {
        const b = scaledInt(e.base, scale, tick);
        if (b === null) return null;
        let p = scale;
        for (let i = 0n; i < ei; i++) {
          p = (p * b) / scale;
          tick.tick(1);
        }
        return p;
      }
      if (ei !== null && ei < 0n) {
        const b = scaledInt(e.base, scale, tick);
        if (b === null || b === 0n) return null;
        let p = scale;
        for (let i = 0n; i < -ei; i++) {
          p = (p * scale) / b;
          tick.tick(1);
        }
        return p;
      }
      const er = asRational(e.exp);
      if (er !== null && er.n === 1n && er.d === 2n) {
        const b = scaledInt(e.base, scale, tick);
        if (b === null || b < 0n) return null;
        return isqrtBig(b * scale);
      }
      return null;
    }
    case 'fn': {
      if (e.name === 'abs' && e.args.length === 1) {
        const v = scaledInt(e.args[0] as SymNode, scale, tick);
        return v === null ? null : v < 0n ? -v : v;
      }
      if (e.name === 'sqrt' && e.args.length === 1) {
        const b = scaledInt(e.args[0] as SymNode, scale, tick);
        if (b === null || b < 0n) return null;
        return isqrtBig(b * scale);
      }
      return null;
    }
    default: return null;
  }
}

/** pi scaled by `scale`: Machin's formula `pi = 16 atan(1/5) − 4 atan(1/239)`. */
function piScaled(scale: bigint, tick: Ticker): bigint {
  return 16n * arctanScaled(5n, scale, tick) - 4n * arctanScaled(239n, scale, tick);
}

function arctanScaled(q: bigint, scale: bigint, tick: Ticker): bigint {
  let sum = 0n;
  let qpw = q;
  const q2 = q * q;
  let k = 0n;
  for (;;) {
    const term = scale / (qpw * (2n * k + 1n));
    if (term === 0n) break;
    sum = k % 2n === 0n ? sum + term : sum - term;
    tick.tick(1);
    k++;
    qpw *= q2;
    if (k > 10000n) break;
  }
  return sum;
}

/** e scaled by `scale`: the series `Σ 1/k!`. */
function eScaled(scale: bigint, tick: Ticker): bigint {
  let sum = scale;
  let fact = 1n;
  for (let k = 1n; k < 10000n; k++) {
    fact *= k;
    const term = scale / fact;
    if (term === 0n) break;
    sum += term;
    tick.tick(1);
  }
  return sum;
}

function opMixedNumber(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, _ctx: OpCtx): OpOut {
  void _ctx;
  noExtras(args, 1, 'MixedNumber');
  const e = asExpr(need(args, 0, 'MixedNumber'), 'MixedNumber');
  const r = asRational(e);
  if (r === null) {
    throw new OpError('bad_argument', 'MixedNumber needs a rational number.', {
      token: toText(e),
      recovery: 'rewrite',
    });
  }
  const node = r.d === 1n ? intN(r.n) : ratN(r.n, r.d);
  return okOut(defined({ k: 'expr', e: node, exact: true, display: { mixed: true } }));
}

function opAssume(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx): OpOut {
  noExtras(args, 2, 'Assume');
  const c = asCond(need(args, 0, 'Assume'), 'Assume');
  const e = asExpr(need(args, 1, 'Assume'), 'Assume');
  checkInputSize(e, ctx, 'Assume');
  const facts = c.c === 'and' ? c.of : [c];
  for (const f of facts) {
    if (f.c !== 'rel' && f.c !== 'in' && f.c !== 'not' && f.c !== 'and' && f.c !== 'or') {
      throw new OpError('bad_assumption', 'Assume needs a condition about symbols.', { recovery: 'rewrite' });
    }
  }
  const contra = findContradiction(facts);
  if (contra !== null) {
    throw new OpError('bad_assumption', 'The assumptions contradict each other.', {
      hint: 'Change one of the two facts.',
      recovery: 'rewrite',
    });
  }
  const assume = makeAssumptions(ctx.assume.domains, [...ctx.assume.facts, ...facts]);
  const out = simplifyNode(e, ruleCtx(assume, ctx.tick, ctx.note)).node;
  return okOut(defined(exprArg(out, outExact(args, out))));
}

/* --------------------------------- calculus ----------------------------------- */

function opDerivative(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx): OpOut {
  noExtras(args, 3, 'Derivative');
  const e = asExpr(need(args, 0, 'Derivative'), 'Derivative');
  checkInputSize(e, ctx, 'Derivative');
  const second = need(args, 1, 'Derivative');
  const rctx = ruleCtxOf(ctx);
  if (second.k === 'list') {
    let cur = e;
    for (const s of second.items) {
      const v = asSym(s, 'Derivative');
      cur = diffNode(cur, v, rctx);
    }
    return okOut(defined(exprArg(cur, outExact(args, cur))));
  }
  const v = asSym(second, 'Derivative');
  let n = 1;
  if (args.length > 2) {
    const nn = asNum(need(args, 2, 'Derivative'), 'Derivative');
    if (!Number.isInteger(nn) || nn < 0 || nn > 100) {
      throw new OpError('bad_argument', 'The derivative order is a whole number from 0 to 100.', { recovery: 'fix_line' });
    }
    n = nn;
  }
  let cur = e;
  for (let i = 0; i < n; i++) cur = diffNode(cur, v, rctx);
  return okOut(defined(exprArg(cur, outExact(args, cur))));
}

function opIntegral(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx): OpOut {
  noExtras(args, 4, 'Integral');
  const e = asExpr(need(args, 0, 'Integral'), 'Integral');
  const v = asSym(need(args, 1, 'Integral'), 'Integral');
  checkInputSize(e, ctx, 'Integral');
  const rctx = ruleCtxOf(ctx);
  if (args.length > 2) {
    const a = asNum(need(args, 2, 'Integral'), 'Integral');
    const b = asNum(need(args, 3, 'Integral'), 'Integral');
    if (!Number.isFinite(a) || !Number.isFinite(b)) return opImproper(e, v, a, b, ctx, outExact(args, e));
    const r = definiteIntegral(e, v, a, b, rctx);
    if ('divergent' in r) {
      return okOut({
        defined: false,
        reason: 'divergent',
        detail: { code: 'Y204', text: `The integral does not converge; singular near ${r.at}.` },
      });
    }
    const notices = r.notice === 'numeric_fallback'
      ? [noticeOf('numeric_fallback', 'No exact form was found; the value is numeric.', 'info')]
      : [];
    return okOut(defined(exprArg(r.node, r.exact && outExact(args, r.node))), notices);
  }
  const F = integrateNode(e, v, rctx);
  if (F === null) {
    return okOut({
      defined: false,
      reason: 'unsupported',
      detail: { code: 'Y201', text: 'No integration rule applies to this form.', stage: 'integrate' },
    });
  }
  return okOut(defined(exprArg(F, outExact(args, F))));
}

/** Infinite bounds through limits of the antiderivative. */
function opImproper(e: SymNode, v: SymNode, a: number, b: number, ctx: OpCtx, inExact = true): OpOut {
  const rctx = ruleCtxOf(ctx);
  const F = integrateNode(e, v, rctx);
  if (F === null) {
    return okOut({
      defined: false,
      reason: 'unsupported',
      detail: { code: 'Y201', text: 'An infinite bound needs an antiderivative; none was found.', stage: 'integrate' },
    });
  }
  const endValue = (x: number): SymNode | null => {
    if (Number.isFinite(x)) {
      return substituteList(F, [[v, Number.isInteger(x) ? intN(x) : floatN(x)]]);
    }
    try {
      const L = limitNode(F, v, x > 0 ? constN('inf') : negateNode(constN('inf')), 'both', rctx);
      return L.node;
    } catch {
      return null;
    }
  };
  const fa = endValue(a);
  const fb = endValue(b);
  if (fa === null || fb === null) {
    return okOut({
      defined: false,
      reason: 'unsupported',
      detail: { code: 'Y201', text: 'The antiderivative has no limit at an infinite bound.', stage: 'limit' },
    });
  }
  const val = simplifyNode(add(fb, negateNode(fa)), rctx).node;
  if (containsInexact(val) && !containsInexact(F)) {
    return okOut(defined(exprArg(val, false)), [noticeOf('numeric_fallback', 'A bound was taken as a limit.', 'info')]);
  }
  return okOut(defined(exprArg(val, inExact && !containsInexact(val))));
}

function opLimit(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx, side: 'both' | 'above' | 'below', op: string): OpOut {
  noExtras(args, 3, op);
  const e = asExpr(need(args, 0, op), op);
  const v = asSym(need(args, 1, op), op);
  checkInputSize(e, ctx, op);
  const aArg = need(args, 2, op);
  const a = aArg.k === 'num' ? (aArg.v === Infinity ? constN('inf') : aArg.v === -Infinity ? negateNode(constN('inf')) : Number.isInteger(aArg.v) ? intN(aArg.v) : floatN(aArg.v))
    : aArg.k === 'expr' ? aArg.e
      : null;
  if (a === null) throw new OpError('no_matching_form', `${op} needs a number or inf as the point.`, { recovery: 'choose_form' });
  try {
    const r = limitNode(e, v, a, side, ruleCtxOf(ctx));
    return okOut(defined(exprArg(r.node, r.exact && outExact(args, r.node))));
  } catch (err) {
    if (err instanceof NoLimit) {
      return okOut({ defined: false, reason: 'no_limit', detail: { code: 'Y203', text: err.detail } });
    }
    throw err;
  }
}

function opSolveODE(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx): OpOut {
  noExtras(args, 4, 'SolveODE');
  const c = asCond(need(args, 0, 'SolveODE'), 'SolveODE');
  if (c.c !== 'rel' || c.op !== '==') {
    throw new OpError('no_matching_form', 'SolveODE needs an equation (==) with yp for y prime and ypp for y double prime.', { recovery: 'choose_form' });
  }
  const y = asSym(need(args, 1, 'SolveODE'), 'SolveODE');
  const x = asSym(need(args, 2, 'SolveODE'), 'SolveODE');
  const f = toDifference(c) as SymNode;
  checkInputSize(f, ctx, 'SolveODE');
  let init: readonly [number, number] | undefined;
  if (args.length > 3) {
    const items = asList(need(args, 3, 'SolveODE'), 'SolveODE');
    if (items.length !== 2) throw new OpError('bad_argument', 'SolveODE initial data is [x0, y0].', { recovery: 'fix_line' });
    init = [asNum(items[0] as SymArg, 'SolveODE'), asNum(items[1] as SymArg, 'SolveODE')];
  }
  const r = solveODE(f, y, x, ctx.assume, ctx.tick, init, ctx.note);
  return okOut(defined(condArg(r.cond, true)));
}

/* ------------------------------- whole numbers --------------------------------- */

function wholeArg(a: SymArg, op: string): bigint {
  if (a.k === 'int') return a.v;
  if (a.k === 'num' && Number.isInteger(a.v)) return BigInt(a.v);
  if (a.k === 'expr' && a.e.k === 'int') return a.e.v;
  throw new OpError('bad_argument', `${op} needs a whole number.`, { recovery: 'rewrite' });
}

/** Primality-scale work needs bounded digits; above is undefined `limit`. */
function checkPrimeDigits(n: bigint): void {
  const digits = (n < 0n ? -n : n).toString().length;
  if (digits > 6000) throw new LimitExceeded('digits');
}

function opIsPrime(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, _ctx: OpCtx): OpOut {
  void _ctx;
  noExtras(args, 1, 'IsPrime');
  const n = wholeArg(need(args, 0, 'IsPrime'), 'IsPrime');
  checkPrimeDigits(n);
  return okOut(defined({ k: 'bool', v: isPrimeBig(n < 0n ? -n : n) }));
}

function opNextPrime(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, _ctx: OpCtx): OpOut {
  void _ctx;
  noExtras(args, 1, 'NextPrime');
  const n = wholeArg(need(args, 0, 'NextPrime'), 'NextPrime');
  checkPrimeDigits(n);
  return okOut(defined(numOrExpr(nextPrimeBig(n))));
}

function opPreviousPrime(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, _ctx: OpCtx): OpOut {
  void _ctx;
  noExtras(args, 1, 'PreviousPrime');
  const n = wholeArg(need(args, 0, 'PreviousPrime'), 'PreviousPrime');
  checkPrimeDigits(n);
  const p = previousPrimeBig(n);
  if (p === null) {
    return okOut({ defined: false, reason: 'out_of_domain', detail: { code: 'Y210', text: 'There is no prime below 2.' } });
  }
  return okOut(defined(numOrExpr(p)));
}

function opPrimeFactors(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, _ctx: OpCtx): OpOut {
  void _ctx;
  noExtras(args, 1, 'PrimeFactors');
  const n = wholeArg(need(args, 0, 'PrimeFactors'), 'PrimeFactors');
  if (n === 0n || n === 1n || n === -1n) return okOut(defined({ k: 'list', items: [] }));
  const f = primeFactorsBig(n);
  if (f === null) {
    return okOut({ defined: false, reason: 'timeout', detail: { code: 'Y208', text: 'Factorisation ran out of steps.', stage: 'factor' } });
  }
  return okOut(defined({ k: 'list', items: f.map((x) => numOrExpr(x)) }));
}

function opDivisors(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx, which: 'count' | 'list' | 'sum', op: string): OpOut {
  void ctx;
  noExtras(args, 1, op);
  const n = wholeArg(need(args, 0, op), op);
  if (n === 0n) {
    return okOut({ defined: false, reason: 'out_of_domain', detail: { code: 'Y210', text: `${op} needs a nonzero number.` } });
  }
  const f = primeFactorsBig(n);
  if (f === null) {
    return okOut({ defined: false, reason: 'timeout', detail: { code: 'Y208', text: 'Factorisation ran out of steps.', stage: 'factor' } });
  }
  const divs = divisorsFromFactors(factorMultiplicity(f));
  if (which === 'count') return okOut(defined(numOrExpr(BigInt(divs.length))));
  if (which === 'list') return okOut(defined({ k: 'list', items: divs.map((x) => numOrExpr(x)) }));
  return okOut(defined(numOrExpr(divs.reduce((s, x) => s + x, 0n))));
}

function opToBase(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, _ctx: OpCtx): OpOut {
  void _ctx;
  noExtras(args, 2, 'ToBase');
  const n = wholeArg(need(args, 0, 'ToBase'), 'ToBase');
  const b = wholeArg(need(args, 1, 'ToBase'), 'ToBase');
  if (b < 2n || b > 36n) {
    return okOut({ defined: false, reason: 'out_of_domain', detail: { code: 'Y210', text: 'The base is a whole number from 2 to 36.' } });
  }
  return okOut(defined({ k: 'text', v: toBaseBig(n, b) }));
}

function opFromBase(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, _ctx: OpCtx): OpOut {
  void _ctx;
  noExtras(args, 2, 'FromBase');
  const text = asText(need(args, 0, 'FromBase'), 'FromBase');
  const b = wholeArg(need(args, 1, 'FromBase'), 'FromBase');
  if (b < 2n || b > 36n) {
    return okOut({ defined: false, reason: 'out_of_domain', detail: { code: 'Y210', text: 'The base is a whole number from 2 to 36.' } });
  }
  const v = fromBaseText(text, b);
  if (v === null) {
    return okOut({ defined: false, reason: 'out_of_domain', detail: { code: 'Y210', text: `${text} is not a base-${b} number.` } });
  }
  return okOut(defined(numOrExpr(v)));
}

function opExtendedGCD(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, _ctx: OpCtx): OpOut {
  void _ctx;
  noExtras(args, 2, 'ExtendedGCD');
  const a = wholeArg(need(args, 0, 'ExtendedGCD'), 'ExtendedGCD');
  const b = wholeArg(need(args, 1, 'ExtendedGCD'), 'ExtendedGCD');
  const [g, s, t] = extendedGcdBig(a, b);
  return okOut(defined({ k: 'list', items: [numOrExpr(g), numOrExpr(s), numOrExpr(t)] }));
}

function opModularExponent(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, _ctx: OpCtx): OpOut {
  void _ctx;
  noExtras(args, 3, 'ModularExponent');
  const a = wholeArg(need(args, 0, 'ModularExponent'), 'ModularExponent');
  const e = wholeArg(need(args, 1, 'ModularExponent'), 'ModularExponent');
  const m = wholeArg(need(args, 2, 'ModularExponent'), 'ModularExponent');
  if (m <= 0n) {
    return okOut({ defined: false, reason: 'out_of_domain', detail: { code: 'Y210', text: 'The modulus is a positive whole number.' } });
  }
  if (e < 0n) {
    const [g, s] = extendedGcdBig(((a % m) + m) % m, m);
    if (g !== 1n) {
      return okOut({ defined: false, reason: 'out_of_domain', detail: { code: 'Y210', text: `${a} has no inverse mod ${m}.` } });
    }
    return okOut(defined(numOrExpr(modPowBigInt(((s % m) + m) % m, -e, m))));
  }
  return okOut(defined(numOrExpr(modPowBigInt(a, e, m))));
}

/* ------------------------------ trig and matrices ------------------------------ */

function opTrig(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx, which: 'expand' | 'combine' | 'simplify', op: string): OpOut {
  noExtras(args, 1, op);
  const e = asExpr(need(args, 0, op), op);
  checkInputSize(e, ctx, op);
  const rctx = ruleCtxOf(ctx);
  const out = which === 'expand' ? trigExpandNode(e, rctx) : which === 'combine' ? trigCombineNode(e, rctx) : trigSimplifyNode(e, rctx);
  return okOut(defined(exprArg(out, outExact(args, out))));
}

function checkMatrix(a: SymArg, ctx: OpCtx, op: string): Matrix {
  const m = asMatrix(a, op);
  if (!isSquare(m)) throw new OpError('bad_argument', `${op} needs a square matrix.`, { recovery: 'rewrite' });
  if (m.length > ctx.limits.maxMatrixSize) {
    throw new OpError('limit', `${op} takes matrices up to ${ctx.limits.maxMatrixSize} by ${ctx.limits.maxMatrixSize}.`, { recovery: 'rewrite' });
  }
  return m;
}

function opDeterminant(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx): OpOut {
  noExtras(args, 1, 'Determinant');
  const m = checkMatrix(need(args, 0, 'Determinant'), ctx, 'Determinant');
  const d = simplifyNode(determinant(m, ctx.tick), ruleCtxOf(ctx)).node;
  return okOut(defined(exprArg(d, outExact(args, d))));
}

function opInverse(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx): OpOut {
  noExtras(args, 1, 'Inverse');
  const m = checkMatrix(need(args, 0, 'Inverse'), ctx, 'Inverse');
  try {
    const inv = inverse(m, ruleCtxOf(ctx));
    return okOut(defined({ k: 'matrix', rows: inv }));
  } catch (err) {
    if (err instanceof Singular) {
      return okOut({ defined: false, reason: 'singular', detail: { code: 'Y207', text: `The matrix is singular (rank ${err.rank}).` } });
    }
    throw err;
  }
}

function opCharPoly(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx): OpOut {
  noExtras(args, 1, 'CharacteristicPolynomial');
  const m = checkMatrix(need(args, 0, 'CharacteristicPolynomial'), ctx, 'CharacteristicPolynomial');
  const { poly } = characteristicPolynomial(m, ruleCtxOf(ctx));
  return okOut(defined(exprArg(poly, outExact(args, poly))));
}

function opEigenvalues(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx): OpOut {
  noExtras(args, 1, 'Eigenvalues');
  const m = checkMatrix(need(args, 0, 'Eigenvalues'), ctx, 'Eigenvalues');
  const vals = eigenvalues(m, ruleCtxOf(ctx));
  return okOut(defined({ k: 'list', items: vals.map((v) => exprArg(v, outExact(args, v))) }));
}

function opEigenvectors(args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, ctx: OpCtx): OpOut {
  noExtras(args, 1, 'Eigenvectors');
  const m = checkMatrix(need(args, 0, 'Eigenvectors'), ctx, 'Eigenvectors');
  const vecs = eigenvectors(m, ruleCtxOf(ctx));
  return okOut(defined({
    k: 'list',
    items: vecs.map((vec) => ({ k: 'list' as const, items: vec.map((v) => exprArg(v, outExact(args, v))) })),
  }));
}

/* --------------------------------- dispatch ----------------------------------- */

export type OpFn = (args: readonly SymArg[], named: ReadonlyMap<string, SymArg>, ctx: OpCtx) => OpOut;

export const OPS: Readonly<Record<OpName, OpFn>> = {
  Expr: opExpr,
  Symbol: opSymbol,
  Hold: opHold,
  Evaluate: opEvaluate,
  LeftSide: (a, n, c) => opSide(a, n, c, 'l', 'LeftSide'),
  RightSide: (a, n, c) => opSide(a, n, c, 'r', 'RightSide'),
  ToFunction: opToFunction,
  ToExpr: opToExpr,
  ToNumber: opToNumber,
  Simplify: opSimplify,
  Expand: opExpand,
  Factor: opFactor,
  Rationalize: opRationalize,
  PartialFractions: opPartialFractions,
  CompleteSquare: opCompleteSquare,
  Coefficients: opCoefficients,
  Degree: opDegree,
  Div: (a, n, c) => opDivMod(a, n, c, 'div', 'Div'),
  Mod: (a, n, c) => opDivMod(a, n, c, 'mod', 'Mod'),
  Division: opDivision,
  GCD: (a, n, c) => opGcdLcm(a, n, c, 'gcd', 'GCD'),
  LCM: (a, n, c) => opGcdLcm(a, n, c, 'lcm', 'LCM'),
  Equivalent: opEquivalent,
  IsZero: opIsZero,
  Solve: (a, n, c) => opSolve(a, n, c, false, 'Solve'),
  Solutions: (a, n, c) => opSolve(a, n, c, true, 'Solutions'),
  NSolve: (a, n, c) => opNSolve(a, n, c, false, 'NSolve'),
  NSolutions: (a, n, c) => opNSolve(a, n, c, true, 'NSolutions'),
  CSolve: (a, n, c) => opCSolve(a, n, c, false, 'CSolve'),
  CSolutions: (a, n, c) => opCSolve(a, n, c, true, 'CSolutions'),
  Substitute: opSubstitute,
  Numeric: opNumeric,
  MixedNumber: opMixedNumber,
  Assume: opAssume,
  Derivative: opDerivative,
  Integral: opIntegral,
  Limit: (a, n, c) => opLimit(a, n, c, 'both', 'Limit'),
  LimitAbove: (a, n, c) => opLimit(a, n, c, 'above', 'LimitAbove'),
  LimitBelow: (a, n, c) => opLimit(a, n, c, 'below', 'LimitBelow'),
  SolveODE: opSolveODE,
  IsPrime: opIsPrime,
  NextPrime: opNextPrime,
  PreviousPrime: opPreviousPrime,
  PrimeFactors: opPrimeFactors,
  Divisors: (a, n, c) => opDivisors(a, n, c, 'count', 'Divisors'),
  DivisorsList: (a, n, c) => opDivisors(a, n, c, 'list', 'DivisorsList'),
  DivisorsSum: (a, n, c) => opDivisors(a, n, c, 'sum', 'DivisorsSum'),
  ToBase: opToBase,
  FromBase: opFromBase,
  ExtendedGCD: opExtendedGCD,
  ModularExponent: opModularExponent,
  TrigExpand: (a, n, c) => opTrig(a, n, c, 'expand', 'TrigExpand'),
  TrigCombine: (a, n, c) => opTrig(a, n, c, 'combine', 'TrigCombine'),
  TrigSimplify: (a, n, c) => opTrig(a, n, c, 'simplify', 'TrigSimplify'),
  Eigenvalues: opEigenvalues,
  Eigenvectors: opEigenvectors,
  CharacteristicPolynomial: opCharPoly,
  Inverse: opInverse,
  Determinant: opDeterminant,
  Steps: () => { throw new OpError('internal', 'Steps runs through run().', { recovery: 'report' }); },
};

/* --------------------- helpers for the optimisation area ---------------------- */

/**
 * Exact stationary points of an exact expression in `v` (for `Maximize exact = true`):
 * critical points of the derivative plus the `from`/`to` endpoints are compared exactly
 * by the caller. Returns null when the derivative is not solvable exactly.
 */
export function exactStationaryPoints(f: SymNode, v: SymNode, ctx: OpCtx): SymNode[] | null {
  const rctx = ruleCtxOf(ctx);
  let d: SymNode;
  try {
    d = diffNode(f, v, rctx);
  } catch (err) {
    if (err instanceof Unsupported) return null;
    throw err;
  }
  try {
    const r = solveEquation(d, v, ctx.assume, ctx.tick, {}, ctx.note);
    if (r.all) return [];
    return [...r.solutions];
  } catch (err) {
    if (err instanceof Unsupported) return null;
    throw err;
  }
}

/** Exact binomial coefficient for the calculator area (`nCr`, `nPr`, `Binomial`). */
export function binomialExact(n: bigint, k: bigint): bigint {
  return binomialBig(n, k);
}


