/**
 * The solver pipeline (cas/design.md 5.9): one equation in one unknown, inequalities by
 * sign charts, linear and small polynomial systems, `NSolve` numeric search, `CSolve`
 * over C, and `SolveODE` for three classes. Parameters stay symbolic with case splits.
 */
import type { Assumptions } from './assume';
import type { SolutionCase } from './contracts';
import { floatToRatPreferShort } from './num';
import type { SymCond, SymNode } from './node';
import {
  ONE, TWO, ZERO, add, andCond, asInteger, asRational, constN, divideNodes, floatN, fn, freeSymbols,
  intN, isOneNode, isZeroNode, LimitExceeded, listN, mapNodes, mul, negateNode, nodeCount, pow, ratN, rel, rootofN,
  symN,
} from './node';
import type { Ticker } from './poly';
import {
  containsGen, refineRootFloat, resultantY, treeToMPoly, treeToUPoly, treeToUPolySym, upolyDegree,
  upolyDerivative, upolyEvalRat, upolyFactor, upolyGcd,
  upolyIsZero, upolyIsolate, upolyNormalize, upolyToTree, upolyFromInts,
} from './poly';
import type { UPoly } from './poly';
import { evalAt, ruleCtx, simplifyNode, substituteList, togetherNode } from './rules';
import type { RuleCtx } from './rules';

/* --------------------------------- results ----------------------------------- */

export type ParamCase = SolutionCase;

export interface SolveResult {
  /** Solution values (empty list = no solutions, which is an answer, not undefined). */
  readonly solutions: readonly SymNode[];
  /** True when every value works (`[v in R]`). */
  readonly all: boolean;
  /** Special parameter cases for the generic answer. */
  readonly cases: readonly ParamCase[];
  /** Integer family parameter created for trig answers (`k1`, …). */
  readonly param?: string;
  /** Notices for the caller (`periodic_family`, `cases`, `multiple_root`, …). */
  readonly notices: readonly string[];
  /** Roots kept though the denominator could not be proved nonzero. */
  readonly unchecked: boolean;
}

export function noSolutions(notices: readonly string[] = []): SolveResult {
  return { solutions: [], all: false, cases: [], notices, unchecked: false };
}

export function allSolutions(): SolveResult {
  return { solutions: [], all: true, cases: [], notices: [], unchecked: false };
}

export class Unsupported extends Error {
  readonly detail: string;
  readonly stage: string;
  readonly suggest: readonly string[];
  constructor(detail: string, stage = 'classify', suggest: readonly string[] = []) {
    super(detail);
    this.name = 'Unsupported';
    this.detail = detail;
    this.stage = stage;
    this.suggest = suggest;
  }
}

export interface SolveOptions {
  readonly from?: number;
  readonly to?: number;
  readonly domain?: 'real' | 'complex';
}

/* ------------------------------ small utilities ------------------------------ */

function ctxWith(assume: Assumptions, tick: Ticker, note?: RuleCtx['note']): RuleCtx {
  return ruleCtx(assume, tick, note);
}

/** The variable name for numeric sampling; the numeric paths need a real symbol. */
function varName(v: SymNode): string {
  if (v.k !== 'sym') throw new Unsupported('an equation in one symbol', 'classify');
  return v.name;
}

/** Move everything to one side: `f(v) == 0` form. Returns the difference (l - r). */
export function toDifference(c: SymCond): SymNode | null {
  if (c.c !== 'rel') return null;
  return add(c.l, negateNode(c.r));
}

/** Collect denominators / radicands / log args containing `v` (domain facts). */
export function domainRestrictions(f: SymNode, v: SymNode): SymNode[] {
  const out: SymNode[] = [];
  const seen = new Set<number>();
  const walk = (t: SymNode): void => {
    if (seen.has(t.id)) return;
    seen.add(t.id);
    if (!containsGen(t, v)) return;
    if (t.k === 'pow' && asInteger(t.exp) !== null && (asInteger(t.exp) as bigint) < 0n) {
      out.push(t.base);
    }
    if (t.k === 'fn' && (t.name === 'ln' || t.name === 'log10' || t.name === 'log2')) {
      out.push(t.args[0] as SymNode);
    }
    if (t.k === 'pow' && asRational(t.exp) !== null) {
      const e = asRational(t.exp) as { n: bigint; d: bigint };
      if (e.d === 2n && e.n === 1n) out.push(t.base);
    }
    switch (t.k) {
      case 'add': for (const c of t.terms) walk(c); break;
      case 'mul': for (const c of t.factors) walk(c); break;
      case 'pow': walk(t.base); walk(t.exp); break;
      case 'fn': for (const c of t.args) walk(c); break;
      default: break;
    }
  };
  walk(f);
  return out;
}

/** Exact sign of a tree with no symbols: -1, 0, 1, or null when undecidable. */
function exactSign(t: SymNode): number | null {
  const r = asRational(t);
  if (r !== null) return r.n === 0n ? 0 : r.n > 0n ? 1 : -1;
  if (t.k === 'float') return t.v === 0 ? 0 : t.v > 0 ? 1 : t.v < 0 ? -1 : null;
  if (t.k === 'const') {
    if (t.name === 'pi' || t.name === 'e') return 1;
    if (t.name === 'inf') return 1;
    return null;
  }
  if (t.k === 'rootof') return t.hint === 0 ? 0 : t.hint > 0 ? 1 : -1;
  if (t.k === 'add' || t.k === 'mul' || t.k === 'pow' || t.k === 'fn') {
    const v = evalAt(t, new Map());
    if (v === null || !Number.isFinite(v)) return null;
    if (v === 0) return 0;
    return v > 0 ? 1 : -1;
  }
  return null;
}

/** Verify a root by exact substitution: `f(root)` simplifies to zero. */
function verifyRoot(f: SymNode, v: SymNode, root: SymNode, ctx: RuleCtx, domain: 'real' | 'complex' = 'real'): boolean {
  if (root.k === 'rootof') return true;
  const sub = substituteList(f, [[v, root]]);
  if (isZeroNode(sub)) return true;
  const s = simplifyNode(sub, ctx).node;
  if (isZeroNode(s)) return true;
  const syms = freeSymbols(s);
  if (syms.size === 0) {
    const val = evalAt(s, new Map());
    if (val !== null && Math.abs(val) < 1e-9) return true;
    if (domain === 'complex') {
      const c = evalComplex(s);
      if (c !== null && Math.hypot(c.re, c.im) < 1e-9) return true;
    }
    return false;
  }
  return false;
}

/** Filter roots by domain restrictions; undecidable inexact denominators keep the root. */
function applyDomainFilter(roots: readonly SymNode[], restrictions: readonly SymNode[], v: SymNode, ctx: RuleCtx): { kept: SymNode[]; unchecked: boolean } {
  const kept: SymNode[] = [];
  let unchecked = false;
  for (const r of roots) {
    let drop = false;
    for (const d of restrictions) {
      const sub = simplifyNode(substituteList(d, [[v, r]]), ctx).node;
      if (isZeroNode(sub)) {
        drop = true;
        break;
      }
      if (freeSymbols(sub).size === 0) {
        const s = exactSign(sub);
        if (s === 0) {
          drop = true;
          break;
        }
      } else if (freeSymbols(sub).size > 0) {
        unchecked = true;
      }
    }
    if (!drop) kept.push(r);
  }
  return { kept, unchecked };
}

function sortSolutions(sols: readonly SymNode[]): SymNode[] {
  const key = (t: SymNode): [number, number] => {
    const v = evalAt(t, new Map());
    if (v !== null && Number.isFinite(v)) return [v, 0];
    const c = evalComplex(t);
    if (c !== null) return [c.re, c.im];
    return [Infinity, 0];
  };
  return [...sols].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka[0] - kb[0] || ka[1] - kb[1];
  });
}

function inInterval(v: number, from?: number, to?: number): boolean {
  if (from !== undefined && v < from && !(Math.abs(v - from) < 1e-9)) return false;
  if (to !== undefined && v > to && !(Math.abs(v - to) < 1e-9)) return false;
  return true;
}

/* --------------------------- polynomial equations ---------------------------- */

/** Solve a factored univariate polynomial: linear/quadratic exact, cubic/quartic short forms, else rootof. */
function solvePolyUni(p: UPoly, v: SymNode, ctx: RuleCtx, domain: 'real' | 'complex'): SymNode[] {
  if (domain === 'real') {
    const power = solvePolyPower(p, v, ctx);
    if (power !== null) return power;
  }
  const { factors, irreducible } = upolyFactor(p, ctx.tick);
  const out: SymNode[] = [];
  const solveFactor = (f: UPoly): void => {
    const d = upolyDegree(f);
    if (d <= 0) return;
    if (d === 1) {
      const a = f.c[1] as bigint;
      const b = f.c[0] as bigint;
      out.push(ratN(-b, a));
      return;
    }
    if (d === 2) {
      out.push(...solveQuadraticRat(f, v, domain));
      return;
    }
    if (domain === 'complex') {
      out.push(...solvePolyComplexNumeric(f, ctx));
      return;
    }
    if (d <= 4) {
      const closed = solveClosedForm(f, v, domain);
      if (closed !== null) {
        out.push(...closed);
        return;
      }
    }
    out.push(...rootofSolutions(f, ctx));
  };
  for (const { f } of factors) solveFactor(f);
  for (const { f } of irreducible) solveFactor(f);
  return out;
}

function solveQuadraticRat(f: UPoly, v: SymNode, domain: 'real' | 'complex'): SymNode[] {
  void v;
  const A = ratN(f.c[2] as bigint, f.den);
  const B = ratN(f.c[1] as bigint, f.den);
  const C = ratN(f.c[0] as bigint, f.den);
  const discExact = simplifyNode(add(mul(B, B), negateNode(mul(intN(4), mul(A, C)))), ruleCtx()).node;
  const discRat = asRational(discExact);
  const s = discRat === null ? exactSign(discExact) ?? 1 : discRat.n === 0n ? 0 : discRat.n > 0n ? 1 : -1;
  if (s === 0) return [divideNodes(negateNode(B), mul(TWO, A))];
  if (s > 0) {
    const sq = pow(discExact, ratN(1n, 2n));
    const simp = simplifyNode(sq, ruleCtx()).node;
    return [
      divideNodes(add(negateNode(B), simp), mul(TWO, A)),
      divideNodes(add(negateNode(B), negateNode(simp)), mul(TWO, A)),
    ];
  }
  if (domain === 'complex') {
    const sq = simplifyNode(pow(negateNode(discExact), ratN(1n, 2n)), ruleCtx()).node;
    const i = constN('i');
    const re = divideNodes(negateNode(B), mul(TWO, A));
    const im = divideNodes(sq, mul(TWO, A));
    return [add(re, mul(i, im)), add(re, negateNode(mul(i, im)))];
  }
  return [];
}

/** Cardano for depressed cubics when short (<= 40 nodes), else null → rootof. */
function solveClosedForm(f: UPoly, v: SymNode, domain: 'real' | 'complex'): SymNode[] | null {
  void domain;
  const d = upolyDegree(f);
  if (d === 3) {
    const a3 = ratN(f.c[3] as bigint, f.den);
    const a2 = ratN(f.c[2] as bigint, f.den);
    const a1 = ratN(f.c[1] as bigint, f.den);
    const a0 = ratN(f.c[0] as bigint, f.den);
    const shift = divideNodes(a2, mul(intN(3), a3));
    const pN = add(mul(a3, a1), negateNode(divideNodes(mul(a2, a2), intN(3))));
    const p = divideNodes(pN, mul(a3, a3));
    const qN = add(mul(TWO, mul(a2, mul(a2, a2))), negateNode(mul(intN(9), mul(a3, mul(a2, a1)))), mul(intN(27), mul(a3, mul(a3, a0))));
    const q = divideNodes(qN, mul(intN(27), mul(a3, mul(a3, a3))));
    const half = divideNodes(q, TWO);
    const third = divideNodes(p, intN(3));
    const disc = add(mul(half, half), mul(third, mul(third, third)));
    const discVal = evalAt(disc, new Map());
    if (discVal === null || discVal <= 0) return null;
    const sq = pow(disc, ratN(1n, 2n));
    const u = fn('cbrt', add(negateNode(half), sq));
    const w = fn('cbrt', add(negateNode(half), negateNode(sq)));
    const root = add(add(u, w), negateNode(shift));
    if (nodeCount(root) > 40) return null;
    const simp = simplifyNode(root, ruleCtx()).node;
    if (nodeCount(simp) > 40) return null;
    return [simp];
  }
  if (d === 4) {
    const odd = [f.c[1], f.c[3]].some((c) => c !== 0n);
    if (!odd) {
      const quad: UPoly = upolyNormalize([f.c[0] as bigint, f.c[2] as bigint, f.c[4] as bigint], f.den);
      const mid = solveQuadraticRat(quad, v, 'real');
      const out: SymNode[] = [];
      for (const m of mid) {
        const s = exactSign(m);
        if (s === null || s < 0) continue;
        if (s === 0) {
          out.push(ZERO);
          continue;
        }
        const sq = simplifyNode(pow(m, ratN(1n, 2n)), ruleCtx()).node;
        out.push(sq, negateNode(sq));
      }
      return out;
    }
    return null;
  }
  return null;
}

/** Real roots of an irreducible factor as `rootof` values. */
function rootofSolutions(f: UPoly, ctx: RuleCtx): SymNode[] {
  const ivs = upolyIsolate(f, ctx.tick);
  return ivs.map((iv, i) => rootofN(f, i + 1, refineRootFloat(f, iv)));
}

/**
 * Polynomial in `v^g`: solve the compressed polynomial for `u`, then `v^g = m` for each.
 * Odd `g` gives one real root; even `g` gives two, one, or none by the sign of `m`.
 */
function solvePolyPower(p: UPoly, v: SymNode, ctx: RuleCtx): SymNode[] | null {
  const present: number[] = [];
  p.c.forEach((c, i) => {
    if (c !== 0n) present.push(i);
  });
  if (present.length === 0) return [];
  let g = 0;
  for (const e of present) g = gcdInt(g, e);
  if (g < 2) return null;
  const qc: bigint[] = new Array(Math.floor((p.c.length - 1) / g) + 1).fill(0n);
  p.c.forEach((c, i) => {
    if (i % g === 0) qc[i / g] = c;
  });
  const q = upolyNormalize(qc, p.den);
  const mid = solvePolyUni(q, symN('u__pow'), ctx, 'real');
  const out: SymNode[] = [];
  for (const m of mid) {
    if (g % 2 === 1) {
      out.push(foldOddRoot(m, g, ctx) ?? simplifyNode(pow(m, ratN(1n, BigInt(g))), ctx).node);
      continue;
    }
    const s = exactSign(simplifyNode(m, ctx).node);
    if (s === null) {
      const r = pow(m, ratN(1n, BigInt(g)));
      out.push(r, negateNode(r));
    } else if (s > 0) {
      const r = simplifyNode(pow(m, ratN(1n, BigInt(g))), ctx).node;
      out.push(r, negateNode(r));
    } else if (s === 0) {
      out.push(ZERO);
    }
  }
  return out;
}

function gcdInt(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/** Exact integer g-th root, or null unless a perfect power. */
function irootBig(a: bigint, g: number): bigint | null {
  if (a < 0n || g < 1 || g > 100000) return null;
  if (a < 2n) return a;
  const bits = BigInt(a.toString(2).length);
  let lo = 0n;
  let hi = 2n ** ((bits + BigInt(g) - 1n) / BigInt(g) + 1n);
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    const p = mid ** BigInt(g);
    if (p === a) return mid;
    if (p < a) lo = mid;
    else hi = mid - 1n;
  }
  return lo ** BigInt(g) === a ? lo : null;
}

/** Fold a real odd root of a negative rational when it is a perfect power. */
function foldOddRoot(m: SymNode, g: number, ctx: RuleCtx): SymNode | null {
  const s = simplifyNode(m, ctx).node;
  const r = asRational(s);
  if (r === null || r.n >= 0n) return null;
  const num = irootBig(-r.n, g);
  const den = irootBig(r.d, g);
  if (num === null || den === null) return null;
  return negateNode(ratN(num, den));
}

/* ------------------------- parametric linear/quadratic ----------------------- */

function solveLinearParam(a: SymNode, b: SymNode): SolveResult {
  const generic = divideNodes(negateNode(b), a);
  return {
    solutions: [generic],
    all: false,
    cases: [
      { when: andCond(rel('==', a, ZERO), rel('==', b, ZERO)), solutions: 'all' },
      { when: andCond(rel('==', a, ZERO), rel('!=', b, ZERO)), solutions: 'none' },
    ],
    notices: ['cases'],
    unchecked: false,
  };
}

function solveQuadraticParam(a: SymNode, b: SymNode, c: SymNode, v: SymNode, ctx: RuleCtx): SolveResult {
  const disc = simplifyNode(add(mul(b, b), negateNode(mul(intN(4), mul(a, c)))), ctx).node;
  const sq = pow(disc, ratN(1n, 2n));
  const twoA = mul(TWO, a);
  const r1 = divideNodes(add(negateNode(b), sq), twoA);
  const r2 = divideNodes(add(negateNode(b), negateNode(sq)), twoA);
  const linear = solveLinearParam(b, c);
  return {
    solutions: [r1, r2],
    all: false,
    cases: [
      { when: andCond(rel('==', a, ZERO), rel('!=', b, ZERO)), solutions: linear.solutions },
      { when: andCond(rel('==', a, ZERO), rel('==', b, ZERO), rel('==', c, ZERO)), solutions: 'all' },
      { when: andCond(rel('==', a, ZERO), rel('==', b, ZERO), rel('!=', c, ZERO)), solutions: 'none' },
    ],
    notices: ['cases'],
    unchecked: false,
  };
}

/* ------------------------------ main pipeline -------------------------------- */

export function solveEquation(
  f: SymNode,
  v: SymNode,
  assume: Assumptions,
  tick: Ticker,
  opts: SolveOptions = {},
  note?: RuleCtx['note'],
): SolveResult {
  const ctx = ctxWith(assume, tick, note);
  const domain = opts.domain ?? 'real';
  if (!containsGen(f, v)) {
    const s = simplifyNode(f, ctx).node;
    if (isZeroNode(s)) return allSolutions();
    if (freeSymbols(s).size === 0) {
      const val = evalAt(s, new Map());
      if (val !== null) return Math.abs(val) < 1e-12 ? allSolutions() : noSolutions();
    }
    return noSolutions();
  }
  const restrictions = domainRestrictions(f, v);
  const attempt = (fn_: () => SolveResult): SolveResult | null => {
    try {
      return fn_();
    } catch (e) {
      if (e instanceof Unsupported) return null;
      throw e;
    }
  };
  const exact = attempt(() => solveExact(f, v, ctx, domain)) ?? attempt(() => solveRational(f, v, ctx, domain))
    ?? attempt(() => solveRadical(f, v, ctx, domain, 0)) ?? attempt(() => solveExpLog(f, v, ctx, domain))
    ?? attempt(() => solveTrig(f, v, ctx, domain)) ?? attempt(() => solveAbs(f, v, ctx, domain))
    ?? attempt(() => solveBySubstitution(f, v, ctx, domain, 0));
  if (exact === null) throw unsupportedFor(f, v);
  if (exact.param !== undefined && opts.from !== undefined && opts.to !== undefined &&
    Number.isFinite(opts.from) && Number.isFinite(opts.to)) {
    return enumerateTrig(exact, v, opts.from, opts.to, ctx);
  }
  let sols = exact.solutions;
  sols = sols.filter((s) => {
    const val = evalAt(s, new Map());
    if (val === null || !Number.isFinite(val)) {
      if (freeSymbols(s).size > 0) return true;
      const c = evalComplex(s);
      if (c !== null) return true;
      return true;
    }
    return inInterval(val, opts.from, opts.to);
  });
  const { kept, unchecked } = applyDomainFilter(sols, restrictions, v, ctx);
  const verified = kept.filter((r) => verifyRoot(f, v, r, ctx, domain) || freeSymbols(r).size > 0);
  return {
    solutions: sortSolutions(verified),
    all: exact.all,
    cases: exact.cases,
    ...(exact.param === undefined ? {} : { param: exact.param }),
    notices: unchecked || exact.unchecked ? [...exact.notices, 'denominator_unchecked'] : exact.notices,
    unchecked: unchecked || exact.unchecked,
  };
}

/** Polynomial in `v`, numeric or parametric. */
function solveExact(f: SymNode, v: SymNode, ctx: RuleCtx, domain: 'real' | 'complex'): SolveResult {
  const coeffs = treeToUPolySym(f, v, ctx.tick);
  if (coeffs === null) throw new Unsupported('not a polynomial', 'classify');
  while (coeffs.length > 1 && isZeroNode(coeffs[coeffs.length - 1] as SymNode)) coeffs.pop();
  const deg = coeffs.length - 1;
  if (deg <= 0) {
    if (isZeroNode(coeffs[0] as SymNode)) return allSolutions();
    return freeSymbols(coeffs[0] as SymNode).size > 0 ? noSolutions() : noSolutions();
  }
  const params = new Set<string>();
  for (const c of coeffs) {
    for (const s of freeSymbols(c)) params.add(s);
  }
  const allNumbers = coeffs.every((c) => asRational(c) !== null || c.k === 'float');
  if (params.size === 0 && !allNumbers && deg === 1) {
    // A linear equation whose coefficients are constants such as e or pi: x = -b/a.
    return solveLinearParam(coeffs[1] as SymNode, coeffs[0] as SymNode);
  }
  if (params.size > 0) {
    if (deg === 1) return solveLinearParam(coeffs[1] as SymNode, coeffs[0] as SymNode);
    if (deg === 2) {
      return solveQuadraticParam(coeffs[2] as SymNode, coeffs[1] as SymNode, coeffs[0] as SymNode, v, ctx);
    }
    throw new Unsupported(`a degree-${deg} equation with parameters`, 'classify');
  }
  const rats = coeffs.map((c) => {
    const r = asRational(c);
    if (r !== null) return r;
    if (c.k === 'float') {
      const f = floatToRatPreferShort(c.v);
      if (f !== null) return f;
    }
    throw new Unsupported('non-rational coefficients', 'classify');
  });
  let den = 1n;
  for (const r of rats) den = (den * r.d) / bigGcdLocal(den, r.d);
  const p: UPoly = upolyNormalize(rats.map((r) => r.n * (den / r.d)), den);
  const sols = solvePolyUni(p, v, ctx, domain);
  if (sols.length > 0) ctx.note('solve.factor', f, listN(sols));
  return { solutions: sols, all: false, cases: [], notices: [], unchecked: false };
}

function bigGcdLocal(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a === 0n ? 1n : a;
}

/** Rational equation: clear denominators, solve, drop denominator zeros. */
function solveRational(f: SymNode, v: SymNode, ctx: RuleCtx, domain: 'real' | 'complex'): SolveResult {
  const tg = togetherNode(f, ctx);
  const num = numeratorOf(tg.node, v);
  const den = denominatorOf(tg.node, v);
  if (num === null || den === null) throw new Unsupported('not a rational equation', 'classify');
  const inner = solveExact(num, v, ctx, domain);
  if (inner.all) return { solutions: [], all: true, cases: [], notices: ['denominator_unchecked'], unchecked: true };
  ctx.note('solve.clear', f, num);
  const kept = inner.solutions.filter((r) => {
    const d = simplifyNode(substituteList(den, [[v, r]]), ctx).node;
    if (isZeroNode(d)) return false;
    if (freeSymbols(d).size === 0) {
      const s = exactSign(d);
      if (s === 0) return false;
    }
    return true;
  });
  return { ...inner, solutions: kept };
}

function numeratorOf(t: SymNode, _v: SymNode): SymNode | null {
  void _v;
  if (t.k === 'mul') {
    const parts = t.factors.filter((f) => {
      if (f.k !== 'pow') return true;
      const e = asInteger(f.exp);
      return e === null || e >= 0n;
    });
    if (parts.length === t.factors.length) return t;
    return parts.length === 0 ? ONE : mul(...parts);
  }
  if (t.k === 'pow') {
    const e = asInteger(t.exp);
    if (e !== null && e < 0n) return ONE;
    return t;
  }
  return t;
}

function denominatorOf(t: SymNode, _v: SymNode): SymNode | null {
  void _v;
  if (t.k === 'mul') {
    const parts: SymNode[] = [];
    for (const f of t.factors) {
      if (f.k === 'pow') {
        const e = asInteger(f.exp);
        if (e !== null && e < 0n) parts.push(e === -1n ? f.base : pow(f.base, intN(-e)));
      }
    }
    if (parts.length === 0) return ONE;
    return mul(...parts);
  }
  if (t.k === 'pow') {
    const e = asInteger(t.exp);
    if (e !== null && e < 0n) return e === -1n ? t.base : pow(t.base, intN(-e));
    return ONE;
  }
  return ONE;
}

/** Radicals: isolate one radical, raise, repeat, then discard extraneous roots. */
function solveRadical(f: SymNode, v: SymNode, ctx: RuleCtx, domain: 'real' | 'complex', depth: number): SolveResult {
  if (depth > 4) throw new Unsupported('nested radicals', 'isolate');
  const rad = findRadical(f, v);
  if (rad === null) throw new Unsupported('no radicals', 'isolate');
  const rest = removeFromSum(f, rad, v);
  if (rest === null) throw new Unsupported('radical not isolated in a sum', 'isolate');
  const base = rad.k === 'pow' ? rad.base : (rad as SymNode & { k: 'fn' }).args[0] as SymNode;
  const e = rad.k === 'pow' ? (asRational(rad.exp) as { n: bigint; d: bigint }) : { n: 1n, d: 2n };
  const q = e.d;
  const raised = add(pow(base, intN(e.n)), negateNode(pow(rest, intN(q))));
  ctx.note('solve.radical', f, raised);
  const inner = solveEquation(raised, v, ctx.assume, ctx.tick, { domain }, ctx.note);
  if (inner.all) return inner;
  const kept = inner.solutions.filter((r) => verifyRoot(f, v, r, ctx, domain));
  return { ...inner, solutions: kept };
}

function findRadical(f: SymNode, v: SymNode): SymNode | null {
  let found: SymNode | null = null;
  const walk = (t: SymNode): void => {
    if (found !== null || !containsGen(t, v)) return;
    if (t.k === 'pow') {
      const e = asRational(t.exp);
      if (e !== null && e.d !== 1n && containsGen(t.base, v)) {
        found = t;
        return;
      }
    }
    if (t.k === 'fn' && t.name === 'sqrt' && containsGen(t.args[0] as SymNode, v)) {
      found = t;
      return;
    }
    switch (t.k) {
      case 'add': for (const c of t.terms) walk(c); break;
      case 'mul': for (const c of t.factors) walk(c); break;
      case 'pow': walk(t.base); break;
      case 'fn': for (const c of t.args) walk(c); break;
      default: break;
    }
  };
  walk(f);
  return found;
}

/**
 * The right-hand side for `part`: `f` is a sum, so `part = -(everything else)`,
 * divided by a constant coefficient when the radical sits inside one term.
 */
function removeFromSum(f: SymNode, part: SymNode, v: SymNode): SymNode | null {
  if (f.k !== 'add') {
    if (f === part) return ZERO;
    return null;
  }
  const rest = f.terms.filter((t) => t !== part);
  if (rest.length === f.terms.length) {
    for (const t of f.terms) {
      if (t.k === 'mul' && t.factors.includes(part)) {
        const coeff = t.factors.filter((c) => c !== part);
        if (coeff.length === 0 || coeff.some((c) => containsGen(c, v))) continue;
        const others = f.terms.filter((u) => u !== t);
        const rhs = others.length === 0 ? ZERO : add(...others.map((u) => negateNode(u)));
        return coeff.length === 1 ? divideNodes(rhs, coeff[0] as SymNode) : divideNodes(rhs, mul(...coeff));
      }
    }
    return null;
  }
  if (rest.length === 0) return ZERO;
  return add(...rest.map((t) => negateNode(t)));
}

/** Exponential and logarithmic with `v` in one place; substitution into a polynomial. */
function solveExpLog(f: SymNode, v: SymNode, ctx: RuleCtx, domain: 'real' | 'complex'): SolveResult {
  const rewrites = normalizeExpForms(f, v);
  for (const g of [f, rewrites]) {
    const atoms = expAtoms(g, v);
    for (const a of atoms) {
      const coeffs = treeToUPolySym(g, a, ctx.tick);
      if (coeffs === null || coeffs.length < 2) continue;
      const deg = coeffs.length - 1;
      if (deg === 1 && isZeroNode(coeffs[1] as SymNode)) continue;
      if (deg >= 1 && coeffs.every((c) => !containsGen(c, v))) {
        const r = solveAtomPoly(a, coeffs, v, ctx, domain);
        if (r !== null) {
          if (r.solutions.length > 0) ctx.note('solve.substitute', f, listN([...r.solutions]));
          return r;
        }
      }
    }
  }
  const sub = solveExpSubstitution(f, v, ctx, domain);
  if (sub !== null) return sub;
  const logged = isolateLog(f, v, ctx, domain);
  if (logged !== null) return logged;
  throw new Unsupported('exponential or logarithmic form', 'isolate');
}

/**
 * Every exponential in `f` is `b^(c x + d)` with one base `b` and a whole `c`: write them
 * with `u = b^x` (`exp(2x) - 3 exp(x) + 2` becomes `u^2 - 3u + 2`), solve for `u`, then
 * `x = ln(u) / ln(b)` for each positive `u`.
 */
function solveExpSubstitution(f: SymNode, v: SymNode, ctx: RuleCtx, domain: 'real' | 'complex'): SolveResult | null {
  let base: SymNode | null = null;
  let ok = true;
  const U = symN('u__exp');
  const mapped = mapNodes(f, (t) => {
    if (!ok || t.k !== 'pow' || containsGen(t.base, v) || !containsGen(t.exp, v)) return t;
    const c = treeToUPolySym(t.exp, v);
    if (c === null || c.length !== 2 || containsGen(c[0] as SymNode, v) || containsGen(c[1] as SymNode, v)) {
      ok = false;
      return t;
    }
    const k = asInteger(c[1] as SymNode);
    if (k === null || k === 0n || (base !== null && base !== t.base)) {
      ok = false;
      return t;
    }
    base = t.base;
    return mul(pow(t.base, c[0] as SymNode), pow(U, intN(k)));
  });
  if (!ok || base === null || containsGen(mapped, v)) return null;
  const coeffs = treeToUPolySym(mapped, U, ctx.tick);
  if (coeffs === null || coeffs.length < 3) return null;
  return solveAtomPoly(pow(base, v), coeffs, v, ctx, domain);
}

function normalizeExpForms(f: SymNode, v: SymNode): SymNode {
  const E = pow(constN('e'), v);
  const map = (t: SymNode): SymNode => {
    if (t.k === 'fn' && t.name === 'exp' && t.args.length === 1) {
      const arg = t.args[0] as SymNode;
      const coeffs = treeToUPolySym(arg, v);
      if (coeffs !== null && coeffs.length === 2 && !containsGen(coeffs[1] as SymNode, v) && !containsGen(coeffs[0] as SymNode, v)) {
        return mul(pow(constN('e'), coeffs[0] as SymNode), pow(E, coeffs[1] as SymNode));
      }
    }
    if (t.k === 'pow' && !containsGen(t.base, v) && containsGen(t.exp, v)) {
      const coeffs = treeToUPolySym(t.exp, v);
      if (coeffs !== null && coeffs.length === 2 && !containsGen(coeffs[1] as SymNode, v) && !containsGen(coeffs[0] as SymNode, v)) {
        const inner = pow(t.base, v);
        return mul(pow(t.base, coeffs[0] as SymNode), pow(inner, coeffs[1] as SymNode));
      }
    }
    return t;
  };
  return mapNodes(f, map);
}

function expAtoms(g: SymNode, v: SymNode): SymNode[] {
  const out: SymNode[] = [];
  const seen = new Set<number>();
  const walk = (t: SymNode): void => {
    if (seen.has(t.id) || !containsGen(t, v)) return;
    seen.add(t.id);
    if (t.k === 'fn' && t.name === 'exp' && t.args.length === 1 && (t.args[0] as SymNode) === v) {
      out.push(t);
      return;
    }
    if (t.k === 'pow' && !containsGen(t.base, v) && t.exp === v) {
      out.push(t);
      return;
    }
    switch (t.k) {
      case 'add': for (const c of t.terms) walk(c); break;
      case 'mul': for (const c of t.factors) walk(c); break;
      case 'pow': walk(t.base); walk(t.exp); break;
      case 'fn': for (const c of t.args) walk(c); break;
      default: break;
    }
  };
  walk(g);
  return out;
}

function solveAtomPoly(
  atom: SymNode, coeffs: readonly SymNode[], v: SymNode, ctx: RuleCtx, domain: 'real' | 'complex',
): SolveResult | null {
  const numeric = coeffs.every((c) => freeSymbols(c).size === 0);
  if (!numeric) return null;
  const deg = coeffs.length - 1;
  let atomVals: SymNode[];
  if (deg === 1) {
    const a = coeffs[1] as SymNode;
    const b = coeffs[0] as SymNode;
    if (isZeroNode(a)) return null;
    atomVals = [divideNodes(negateNode(b), a)];
  } else if (deg === 2) {
    const p = upolyFromTrees(coeffs);
    if (p === null) return null;
    atomVals = solvePolyUni(p, symN('u__atom'), ctx, domain);
  } else {
    return null;
  }
  const k = domain === 'complex' ? symN(`k${trigParamNext++}`) : null;
  const out: SymNode[] = [];
  for (const val of atomVals) {
    const simp = simplifyNode(val, ctx).node;
    const s = exactSign(simp);
    if (domain === 'real' && (s === null || s <= 0)) continue;
    if (domain === 'complex' && s === 0) continue;
    const principal = atom.k === 'fn' && atom.name === 'exp'
      ? fn('ln', val)
      : atom.k === 'pow'
        ? divideNodes(fn('ln', val), fn('ln', (atom as SymNode & { k: 'pow' }).base))
        : null;
    if (principal === null) continue;
    if (k === null) {
      out.push(simplifyNode(principal, ctx).node);
    } else if (atom.k === 'fn') {
      const i = constN('i');
      const pi = constN('pi');
      out.push(add(principal, mul(mul(TWO, pi), mul(i, k))));
    } else {
      const base = (atom as SymNode & { k: 'pow' }).base;
      const i = constN('i');
      const pi = constN('pi');
      out.push(divideNodes(add(fn('ln', val), mul(mul(TWO, pi), mul(i, k))), fn('ln', base)));
    }
  }
  if (out.length === 0 && atomVals.length > 0) return noSolutions();
  if (k === null) return { solutions: out, all: false, cases: [], notices: [], unchecked: false };
  return { solutions: out, all: false, cases: [], param: k.name, notices: ['periodic_family'], unchecked: false };
}

function upolyFromTrees(coeffs: readonly SymNode[]): UPoly | null {
  const rats: { n: bigint; d: bigint }[] = [];
  for (const c of coeffs) {
    const r = asRational(c);
    if (r === null) return null;
    rats.push(r);
  }
  let den = 1n;
  for (const r of rats) den = (den * r.d) / bigGcdLocal(den, r.d);
  return upolyNormalize(rats.map((r) => r.n * (den / r.d)), den);
}

function isolateLog(f: SymNode, v: SymNode, ctx: RuleCtx, domain: 'real' | 'complex'): SolveResult | null {
  if (f.k !== 'add' || f.terms.length !== 2) return null;
  const logs = f.terms.filter((t) => containsGen(t, v));
  const rest = f.terms.filter((t) => !containsGen(t, v));
  if (logs.length !== 1 || rest.length !== 1) return null;
  const l = logs[0] as SymNode;
  const r = negateNode(rest[0] as SymNode);
  let coeff: SymNode = ONE;
  let body = l;
  if (l.k === 'mul' && l.factors.length === 2 && !containsGen(l.factors[0] as SymNode, v)) {
    coeff = l.factors[0] as SymNode;
    body = l.factors[1] as SymNode;
  }
  if (body.k !== 'fn' || body.name !== 'ln' || body.args.length !== 1) return null;
  const inner = body.args[0] as SymNode;
  const target = divideNodes(r, coeff);
  const reduced = add(inner, negateNode(pow(constN('e'), target)));
  return solveEquation(reduced, v, ctx.assume, ctx.tick, { domain }, ctx.note);
}

/* ------------------------------ trig equations ------------------------------ */

let trigParamNext = 1;

export function resetTrigParams(): void {
  trigParamNext = 1;
}

function solveTrig(f: SymNode, v: SymNode, ctx: RuleCtx, domain: 'real' | 'complex'): SolveResult {
  const single = solveTrigSingle(f, v, ctx, domain);
  if (single !== null) {
    if (single.solutions.length > 0) ctx.note('solve.trig', f, listN([...single.solutions]));
    return single;
  }
  const linear = solveTrigLinearCombo(f, v, ctx, domain);
  if (linear !== null) {
    if (linear.solutions.length > 0) ctx.note('solve.trig', f, listN([...linear.solutions]));
    return linear;
  }
  throw new Unsupported('trigonometric form', 'classify');
}

function trigAtoms(f: SymNode, v: SymNode): { kind: 'sin' | 'cos' | 'tan'; arg: SymNode; node: SymNode }[] {
  const out: { kind: 'sin' | 'cos' | 'tan'; arg: SymNode; node: SymNode }[] = [];
  const seen = new Set<number>();
  const walk = (t: SymNode): void => {
    if (seen.has(t.id) || !containsGen(t, v)) return;
    seen.add(t.id);
    if (t.k === 'fn' && (t.name === 'sin' || t.name === 'cos' || t.name === 'tan') && t.args.length === 1) {
      out.push({ kind: t.name, arg: t.args[0] as SymNode, node: t });
      return;
    }
    switch (t.k) {
      case 'add': for (const c of t.terms) walk(c); break;
      case 'mul': for (const c of t.factors) walk(c); break;
      case 'pow': walk(t.base); walk(t.exp); break;
      case 'fn': for (const c of t.args) walk(c); break;
      default: break;
    }
  };
  walk(f);
  return out;
}

function solveTrigSingle(f: SymNode, v: SymNode, ctx: RuleCtx, domain: 'real' | 'complex' = 'real'): SolveResult | null {
  const atoms = trigAtoms(f, v);
  if (atoms.length === 0) return null;
  const kinds = new Set(atoms.map((a) => a.kind));
  const argsKey = new Set(atoms.map((a) => a.arg.id));
  if (kinds.size !== 1 || argsKey.size !== 1) return null;
  const atom = atoms[0] as { kind: 'sin' | 'cos' | 'tan'; arg: SymNode; node: SymNode };
  const coeffs = treeToUPolySym(f, atom.node, ctx.tick);
  if (coeffs === null || coeffs.length !== 2) return null;
  const [b, a] = coeffs as [SymNode, SymNode];
  if (containsGen(a, v) || containsGen(b, v)) return null;
  if (isZeroNode(a)) return null;
  const c = simplifyNode(divideNodes(negateNode(b), a), ctx).node;
  if (freeSymbols(c).size > 0) return null;
  const argCoeffs = treeToUPolySym(atom.arg, v, ctx.tick);
  if (argCoeffs === null || argCoeffs.length !== 2) return null;
  const [beta, alpha] = argCoeffs as [SymNode, SymNode];
  if (isZeroNode(alpha) || freeSymbols(alpha).size > 0 || freeSymbols(beta).size > 0) return null;
  const cv = evalAt(c, new Map());
  if (cv === null) return null;
  if (domain === 'real' && (atom.kind === 'sin' || atom.kind === 'cos') && Math.abs(cv) > 1 + 1e-12) return noSolutions();
  const k = symN(`k${trigParamNext++}`);
  const pi = constN('pi');
  const base: SymNode[] = [];
  if (atom.kind === 'sin') {
    const s0 = fn('asin', c);
    base.push(s0, add(pi, negateNode(s0)));
  } else if (atom.kind === 'cos') {
    const s0 = fn('acos', c);
    base.push(s0, negateNode(s0));
  } else {
    base.push(fn('atan', c));
  }
  const period = atom.kind === 'tan' ? pi : mul(TWO, pi);
  const sols = base.map((s) => divideNodes(add(s, mul(period, k)), alpha));
  const betaShift = isZeroNode(beta) ? sols : sols.map((s) => add(s, divideNodes(negateNode(beta), alpha)));
  return { solutions: betaShift, all: false, cases: [], param: k.name, notices: ['periodic_family'], unchecked: false };
}

function solveTrigLinearCombo(f: SymNode, v: SymNode, ctx: RuleCtx, domain: 'real' | 'complex' = 'real'): SolveResult | null {
  const atoms = trigAtoms(f, v);
  if (atoms.length !== 2) return null;
  const kinds = atoms.map((a) => a.kind).sort().join(',');
  if (kinds !== 'cos,sin') return null;
  if (atoms[0]?.arg !== atoms[1]?.arg) return null;
  const arg = atoms[0]?.arg as SymNode;
  const argCoeffs = treeToUPolySym(arg, v, ctx.tick);
  if (argCoeffs === null || argCoeffs.length !== 2) return null;
  const [beta, alpha] = argCoeffs as [SymNode, SymNode];
  if (isZeroNode(alpha)) return null;
  const sAtom = atoms.find((a) => a.kind === 'sin')?.node as SymNode;
  const cAtom = atoms.find((a) => a.kind === 'cos')?.node as SymNode;
  const aCoeff = linearCoeffIn(f, sAtom, v);
  const bCoeff = linearCoeffIn(f, cAtom, v);
  const cConst = remainderAfter(f, [sAtom, cAtom], v);
  if (aCoeff === null || bCoeff === null || cConst === null) return null;
  if (freeSymbols(aCoeff).size > 0 || freeSymbols(bCoeff).size > 0 || freeSymbols(cConst).size > 0) return null;
  const av = evalAt(aCoeff, new Map());
  const bv = evalAt(bCoeff, new Map());
  const cv = evalAt(negateNode(cConst), new Map());
  if (av === null || bv === null || cv === null) return null;
  const R = Math.hypot(av, bv);
  if (R === 0) return null;
  if (domain === 'real' && Math.abs(cv / R) > 1 + 1e-12) return noSolutions();
  const k = symN(`k${trigParamNext++}`);
  const pi = constN('pi');
  const phi = floatN(Math.atan2(bv, av));
  const s0 = fn('asin', floatN(cv / R));
  const fam1 = divideNodes(add(add(s0, negateNode(phi)), mul(mul(TWO, pi), k)), alpha);
  const fam2 = divideNodes(add(add(add(pi, negateNode(s0)), negateNode(phi)), mul(mul(TWO, pi), k)), alpha);
  const shift = (s: SymNode): SymNode => (isZeroNode(beta) ? s : add(s, divideNodes(negateNode(beta), alpha)));
  return { solutions: [shift(fam1), shift(fam2)], all: false, cases: [], param: k.name, notices: ['periodic_family'], unchecked: false };
}

function linearCoeffIn(f: SymNode, atom: SymNode, v: SymNode): SymNode | null {
  const terms = f.k === 'add' ? f.terms : [f];
  for (const t of terms) {
    if (t === atom) return ONE;
    if (t.k === 'mul' && t.factors.length === 2) {
      const f0 = t.factors[0] as SymNode;
      const f1 = t.factors[1] as SymNode;
      if (f1 === atom && !containsGen(f0, v)) return f0;
      if (f0 === atom && !containsGen(f1, v)) return f1;
    }
  }
  return null;
}

function remainderAfter(f: SymNode, atoms: readonly SymNode[], v: SymNode): SymNode | null {
  const terms = f.k === 'add' ? f.terms : [f];
  const rest: SymNode[] = [];
  for (const t of terms) {
    if (atoms.some((a) => t === a || containsGen(t, a))) continue;
    if (containsGen(t, v)) return null;
    rest.push(t);
  }
  return add(...rest);
}

/* ------------------------------ abs + substitute ----------------------------- */

function solveAbs(f: SymNode, v: SymNode, ctx: RuleCtx, domain: 'real' | 'complex'): SolveResult {
  const absNode = findAbs(f, v);
  if (absNode === null) throw new Unsupported('no absolute values', 'classify');
  const inner = (absNode as SymNode & { k: 'fn' }).args[0] as SymNode;
  const pos = substituteList(f, [[absNode, inner]]);
  const neg = substituteList(f, [[absNode, negateNode(inner)]]);
  const rp = solveEquation(pos, v, ctx.assume, ctx.tick, { domain }, ctx.note);
  const rn = solveEquation(neg, v, ctx.assume, ctx.tick, { domain }, ctx.note);
  const keep = (r: SymNode, wantPos: boolean): boolean => {
    const s = simplifyNode(substituteList(inner, [[v, r]]), ctx).node;
    if (freeSymbols(s).size === 0) {
      const val = evalAt(s, new Map());
      if (val !== null) return wantPos ? val >= -1e-12 : val <= 1e-12;
    }
    return true;
  };
  const sols = [
    ...(rp.all ? [] : rp.solutions.filter((r) => keep(r, true))),
    ...(rn.all ? [] : rn.solutions.filter((r) => keep(r, false))),
  ];
  if (rp.all || rn.all) return { solutions: sols, all: false, cases: [], notices: [], unchecked: true };
  if (sols.length > 0) ctx.note('solve.abs', f, listN(sols));
  return { solutions: sols, all: false, cases: [], notices: [], unchecked: false };
}

function findAbs(f: SymNode, v: SymNode): SymNode | null {
  let found: SymNode | null = null;
  const walk = (t: SymNode): void => {
    if (found !== null || !containsGen(t, v)) return;
    if (t.k === 'fn' && t.name === 'abs') {
      found = t;
      return;
    }
    switch (t.k) {
      case 'add': for (const c of t.terms) walk(c); break;
      case 'mul': for (const c of t.factors) walk(c); break;
      case 'pow': walk(t.base); walk(t.exp); break;
      case 'fn': for (const c of t.args) walk(c); break;
      default: break;
    }
  };
  walk(f);
  return found;
}

function solveBySubstitution(f: SymNode, v: SymNode, ctx: RuleCtx, domain: 'real' | 'complex', depth: number): SolveResult {
  if (depth > 2) throw new Unsupported('substitution depth', 'classify');
  const cands = substitutionCandidates(f, v);
  for (const s of cands.slice(0, 8)) {
    const coeffs = treeToUPolySym(f, s, ctx.tick);
    if (coeffs === null || coeffs.length < 2) continue;
    if (coeffs.some((c) => containsGen(c, v))) continue;
    const p = upolyFromTrees(coeffs);
    if (p === null) continue;
    const mid = solvePolyUni(p, symN('u__sub'), ctx, domain);
    const out: SymNode[] = [];
    let ok = true;
    for (const m of mid) {
      try {
        const inner = solveEquation(add(s, negateNode(m)), v, ctx.assume, ctx.tick, { domain }, ctx.note);
        if (inner.all) {
          ok = false;
          break;
        }
        out.push(...inner.solutions);
      } catch {
        ok = false;
        break;
      }
    }
    if (ok && out.length > 0) {
      ctx.note('solve.substitute', f, listN(out));
      return { solutions: out, all: false, cases: [], notices: [], unchecked: false };
    }
  }
  throw new Unsupported('substitution form', 'classify');
}

function substitutionCandidates(f: SymNode, v: SymNode): SymNode[] {
  const out: SymNode[] = [];
  const seen = new Set<number>();
  const walk = (t: SymNode): void => {
    if (seen.has(t.id) || !containsGen(t, v) || t === v) return;
    seen.add(t.id);
    if ((t.k === 'fn' || t.k === 'pow') && t !== f) {
      out.push(t);
      return;
    }
    switch (t.k) {
      case 'add': for (const c of t.terms) walk(c); break;
      case 'mul': for (const c of t.factors) walk(c); break;
      default: break;
    }
  };
  walk(f);
  return out;
}

function unsupportedFor(f: SymNode, v: SymNode): Unsupported {
  const kinds: string[] = [];
  const seen = new Set<number>();
  const walk = (t: SymNode): void => {
    if (seen.has(t.id) || !containsGen(t, v)) return;
    seen.add(t.id);
    if (t.k === 'fn') {
      if (t.name === 'exp') kinds.push('an exponential term');
      else if (t.name === 'ln') kinds.push('a logarithmic term');
      else if (t.name === 'sin' || t.name === 'cos' || t.name === 'tan') kinds.push('a trigonometric term');
      else kinds.push(`a ${t.name} term`);
      return;
    }
    if (t.k === 'pow' && containsGen(t.exp, v)) {
      kinds.push('a power with x in the exponent');
      return;
    }
    switch (t.k) {
      case 'add': kinds.push('a polynomial term'); break;
      default: break;
    }
    switch (t.k) {
      case 'add': for (const c of t.terms) walk(c); break;
      case 'mul': for (const c of t.factors) walk(c); break;
      case 'pow': walk(t.base); walk(t.exp); break;
      default: break;
    }
  };
  walk(f);
  const uniq = [...new Set(kinds)];
  const what = uniq.length >= 2 ? `an equation with x both in ${uniq[0]} and in ${uniq[1]}` : uniq.length === 1 ? `an equation with ${uniq[0]} containing x` : 'this equation';
  return new Unsupported(`No exact method for ${what}.`, 'classify', ['s = NSolve(x + exp(x) == 3, x)']);
}

/* ------------------------- trig family enumeration --------------------------- */

/** Concrete members of periodic families inside `[from, to]`. Over 1e6 periods: `limit`. */
function enumerateTrig(fam: SolveResult, v: SymNode, from: number, to: number, ctx: RuleCtx): SolveResult {
  const out: SymNode[] = [];
  const k = symN(fam.param as string);
  for (const sol of fam.solutions) {
    const b0 = evalAt(sol, new Map([[k.name, 0]]));
    const b1 = evalAt(sol, new Map([[k.name, 1]]));
    if (b0 === null || b1 === null || !Number.isFinite(b0) || !Number.isFinite(b1)) continue;
    const step = b1 - b0;
    if (step === 0) continue;
    const periods = Math.abs((to - from) / step);
    if (periods > 1000000) throw new LimitExceeded('periods');
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const kMin = Math.ceil((lo - b0) / step - 1e-9);
    const kMax = Math.floor((hi - b0) / step + 1e-9);
    const span = step > 0 ? { lo: kMin, hi: kMax } : { lo: kMax, hi: kMin };
    if (span.hi - span.lo > 100000) throw new LimitExceeded('periods');
    for (let kk = span.lo; kk <= span.hi; kk++) {
      out.push(simplifyNode(substituteList(sol, [[k, intN(kk)]]), ctx).node);
    }
  }
  return { solutions: sortSolutions(out), all: false, cases: [], notices: [], unchecked: false };
}

/* ------------------------------- inequalities -------------------------------- */

/** Solve `f(v) rel 0` for polynomial/rational `f` by a sign chart. */
export function solveInequality(
  f: SymNode,
  op: '!=' | '<' | '<=' | '>' | '>=',
  v: SymNode,
  assume: Assumptions,
  tick: Ticker,
  opts: SolveOptions = {},
  note?: RuleCtx['note'],
): SymCond[] {
  const ctx = ctxWith(assume, tick, note);
  const absForm = splitAbsInequality(f, op, v);
  if (absForm !== null) {
    // |g| op k: k < 0 decides at once; otherwise square both sides (k >= 0): g^2 - k^2 op 0.
    const { g, k, op: aop } = absForm;
    const kv = evalAt(k, new Map());
    if (kv !== null && kv < 0) {
      return aop === '<' || aop === '<=' ? [] : [{ c: 'in', l: v, set: 'R' }];
    }
    ctx.note('solve.abs', f, g);
    return solveInequality(add(pow(g, TWO), negateNode(pow(k, TWO))), aop, v, assume, tick, opts, note);
  }
  const { num, den } = rationalParts(f, v, ctx);
  if (num === null || den === null) throw new Unsupported('inequality is not polynomial or rational in x', 'classify');
  const numRoots = realRootsSorted(num, ctx);
  const denRoots = realRootsSorted(den, ctx);
  const crit = [...numRoots, ...denRoots].sort((a, b) => a.val - b.val);
  const dedup: { val: number; exact: SymNode }[] = [];
  for (const c of crit) {
    if (dedup.length === 0 || Math.abs((dedup[dedup.length - 1] as { val: number }).val - c.val) > 1e-9) {
      dedup.push(c);
    }
  }
  const lo = opts.from ?? -Infinity;
  const hi = opts.to ?? Infinity;
  const pieces: SymCond[] = [];
  const bounds: ({ val: number; exact: SymNode } | null)[] = [null, ...dedup, null];
  const want = (s: number): boolean => {
    if (op === '<') return s < 0;
    if (op === '<=') return s <= 0;
    if (op === '>') return s > 0;
    if (op === '>=') return s >= 0;
    return s !== 0;
  };
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i] ?? null;
    const b = bounds[i + 1] ?? null;
    const aVal = a === null ? -Infinity : a.val;
    const bVal = b === null ? Infinity : b.val;
    if (bVal <= lo || aVal >= hi) continue;
    const test = pickTestPoint(aVal, bVal);
    if (test === null) continue;
    const s = signAtRational(num, den, test.n, test.d);
    if (s === null || !want(s)) continue;
    pieces.push(pieceCond(a?.exact ?? null, b?.exact ?? null, v));
  }
  if (op === '<=' || op === '>=') {
    for (const c of dedup) {
      if (c.val < lo || c.val > hi) continue;
      if (isPole(c.exact, den, v, ctx)) continue;
      pieces.push(rel('==', v, c.exact));
    }
  }
  return mergePieces(pieces, v);
}

/** `a*abs(g) + b op 0` with `a`, `b` free of v: the argument `g`, the bound `k = -b/a` and the relation. */
function splitAbsInequality(
  f: SymNode, op: '!=' | '<' | '<=' | '>' | '>=', v: SymNode,
): { g: SymNode; k: SymNode; op: '!=' | '<' | '<=' | '>' | '>=' } | null {
  const terms = f.k === 'add' ? f.terms : [f];
  const withV = terms.filter((t) => containsGen(t, v));
  if (withV.length !== 1) return null;
  const rest = terms.filter((t) => !containsGen(t, v));
  const t = withV[0] as SymNode;
  let coeff: SymNode = ONE;
  let body: SymNode = t;
  if (t.k === 'mul' && t.factors.length === 2 && !containsGen(t.factors[0] as SymNode, v)) {
    coeff = t.factors[0] as SymNode;
    body = t.factors[1] as SymNode;
  }
  if (body.k !== 'fn' || body.name !== 'abs' || body.args.length !== 1) return null;
  const a = evalAt(coeff, new Map());
  if (a === null || a === 0 || freeSymbols(coeff).size > 0 || rest.some((r) => freeSymbols(r).size > 0)) return null;
  const k = divideNodes(negateNode(add(...rest)), coeff);
  const flip: Record<string, '!=' | '<' | '<=' | '>' | '>='> = { '<': '>', '<=': '>=', '>': '<', '>=': '<=', '!=': '!=' };
  return { g: body.args[0] as SymNode, k, op: a < 0 ? (flip[op] as '!=' | '<' | '<=' | '>' | '>=') : op };
}

function rationalParts(f: SymNode, v: SymNode, ctx: RuleCtx): { num: UPoly | null; den: UPoly | null } {
  const direct = treeToUPoly(f, v, ctx.tick);
  if (direct !== null) return { num: direct, den: upolyFromInts([1n]) };
  const tg = togetherNode(f, ctx);
  const num = treeToUPoly(numeratorOf(tg.node, v) ?? tg.node, v, ctx.tick);
  const den = treeToUPoly(denominatorOf(tg.node, v) ?? upolyToTree(upolyFromInts([1n]), v), v, ctx.tick);
  if (num === null || den === null) return { num: null, den: null };
  return { num, den };
}

function realRootsSorted(p: UPoly, ctx: RuleCtx): { val: number; exact: SymNode; key: string }[] {
  if (upolyDegree(p) <= 0) return [];
  const sols = solvePolyUni(p, symN('x__ineq'), ctx, 'real');
  const out: { val: number; exact: SymNode; key: string }[] = [];
  for (const s of sols) {
    const val = evalAt(s, new Map());
    if (val === null || !Number.isFinite(val)) continue;
    out.push({ val, exact: s, key: `${val}` });
  }
  return out;
}

/** An exact dyadic rational strictly inside the open interval `(a, b)`. */
function pickTestPoint(a: number, b: number): { n: bigint; d: bigint } | null {
  const lo = Number.isFinite(a) ? a : -1e6;
  const hi = Number.isFinite(b) ? b : 1e6;
  if (!(lo < hi)) return null;
  const width = hi - lo;
  const k = Math.max(0, Math.ceil(-Math.log2(width)) + 3);
  const d = 2n ** BigInt(Math.min(k, 60));
  const m = BigInt(Math.floor(lo * Number(d))) + 1n;
  if (Number(m) / Number(d) >= hi) {
    const m2 = m - 1n;
    if (Number(m2) / Number(d) <= lo) return null;
    return { n: m2, d };
  }
  return { n: m, d };
}

function signAtRational(num: UPoly, den: UPoly, n: bigint, d: bigint): number | null {
  const vn = upolyEvalRat(num, n, d);
  const vd = upolyEvalRat(den, n, d);
  if (vn.d === 0n || vd.d === 0n) return null;
  const sn = vn.n === 0n ? 0 : vn.n * vn.d > 0n ? 1 : -1;
  const sd = vd.n === 0n ? 0 : vd.n * vd.d > 0n ? 1 : -1;
  if (sd === 0) return null;
  return sn * sd;
}

function isPole(root: SymNode, den: UPoly, v: SymNode, ctx: RuleCtx): boolean {
  const sub = simplifyNode(substituteList(upolyToTree(den, v), [[v, root]]), ctx).node;
  if (isZeroNode(sub)) return true;
  if (freeSymbols(sub).size === 0) {
    const val = evalAt(sub, new Map());
    if (val !== null && Math.abs(val) < 1e-9) return true;
  }
  return false;
}

function pieceCond(a: SymNode | null, b: SymNode | null, v: SymNode): SymCond {
  if (a === null && b === null) return { c: 'in', l: v, set: 'R' };
  if (a === null) return rel('<', v, b as SymNode);
  if (b === null) return rel('>', v, a as SymNode);
  return andCond(rel('<', a, v), rel('<', v, b as SymNode));
}

/** Merge isolated roots into adjacent open pieces (`v < 2`, `v == 2` → `v <= 2`). */
function mergePieces(pieces: readonly SymCond[], v: SymNode): SymCond[] {
  const valOf = (t: SymNode): number | null => evalAt(t, new Map());
  const eqs = pieces.filter((p) => p.c === 'rel' && p.op === '==');
  const rest = pieces.filter((p) => !(p.c === 'rel' && p.op === '=='));
  const used = new Set<number>();
  const out: SymCond[] = [];
  for (const r of rest) {
    if (r.c === 'rel' && (r.op === '<' || r.op === '>')) {
      const bound = r.r;
      const bv = valOf(bound);
      const match = eqs.findIndex((e, i) => {
        if (used.has(i)) return false;
        if (e.c !== 'rel') return false;
        const ev = valOf(e.r);
        return bv !== null && ev !== null && Math.abs(bv - ev) < 1e-9;
      });
      if (match >= 0) {
        used.add(match);
        const closed = r.op === '<' ? '<=' : '>=';
        out.push(r.op === '<' ? rel(closed, v, bound) : rel(closed, v, bound));
        continue;
      }
    }
    if (r.c === 'and' && r.of.length === 2) {
      const [l, b] = r.of as [SymCond, SymCond];
      if (l.c === 'rel' && b.c === 'rel') {
        const lv = l.op === '<' ? valOf(l.l) : null;
        const bv = b.op === '<' ? valOf(b.r) : null;
        const lm = eqs.findIndex((e, i) => !used.has(i) && e.c === 'rel' && lv !== null && Math.abs((valOf(e.r) ?? 0) - lv) < 1e-9 && valOf(e.r) !== null);
        const bm = eqs.findIndex((e, i) => !used.has(i) && e.c === 'rel' && bv !== null && Math.abs((valOf(e.r) ?? 0) - bv) < 1e-9 && valOf(e.r) !== null);
        if (lm >= 0 || bm >= 0) {
          if (lm >= 0) used.add(lm);
          if (bm >= 0) used.add(bm);
          const nl = lm >= 0 ? rel('<=', l.l, v) : l;
          const nb = bm >= 0 ? rel('<=', v, b.r) : b;
          out.push(andCond(nl, nb));
          continue;
        }
      }
    }
    out.push(r);
  }
  eqs.forEach((e, i) => {
    if (!used.has(i)) out.push(e);
  });
  return out;
}

/* --------------------------------- systems ----------------------------------- */

export interface SystemResult {
  /** One inner list per solution, one `v == value` per unknown. Empty = no solutions. */
  readonly solutions: readonly (readonly SymNode[])[];
  readonly notices: readonly string[];
  readonly unchecked: boolean;
}

export function solveSystem(
  eqs: readonly SymNode[],
  vars: readonly SymNode[],
  assume: Assumptions,
  tick: Ticker,
  opts: SolveOptions = {},
  note?: RuleCtx['note'],
): SystemResult {
  void opts;
  const ctx = ctxWith(assume, tick, note);
  const linear = tryLinearSystem(eqs, vars, ctx);
  if (linear !== null) return linear;
  if (vars.length === 2 && eqs.length === 2) {
    const elim = tryResultantSystem(eqs[0] as SymNode, eqs[1] as SymNode, vars[0] as SymNode, vars[1] as SymNode, ctx);
    if (elim !== null) return elim;
    const subst = trySubstitutionSystem(eqs[0] as SymNode, eqs[1] as SymNode, vars[0] as SymNode, vars[1] as SymNode, ctx);
    if (subst !== null) return subst;
  }
  if (vars.length === eqs.length && vars.length <= 3) {
    const subst = tryGeneralSubstitution(eqs, vars, ctx);
    if (subst !== null) return subst;
  }
  throw new Unsupported('this system is not linear and has no elimination path', 'classify');
}

interface RatN {
  n: bigint;
  d: bigint;
}

function ratNorm(n: bigint, d: bigint): RatN {
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = bigGcdLocal(n < 0n ? -n : n, d);
  return { n: n / g, d: d / g };
}

/** RREF over the rationals; returns pivot columns and the reduced rows. */
export function rrefRat(a: readonly (readonly bigint[])[], b: readonly bigint[]): { rows: RatN[][]; pivots: number[]; inconsistent: boolean } {
  const m = a.length;
  const n = a.length === 0 ? 0 : (a[0] as bigint[]).length;
  const rows: RatN[][] = a.map((row, i) => [...row.map((x) => ratNorm(x, 1n)), ratNorm(b[i] as bigint, 1n)]);
  const pivots: number[] = [];
  let r = 0;
  for (let c = 0; c < n && r < m; c++) {
    let piv = -1;
    for (let i = r; i < m; i++) {
      if ((rows[i] as RatN[])[c]?.n !== 0n) {
        piv = i;
        break;
      }
    }
    if (piv < 0) continue;
    const tmp = rows[r] as RatN[];
    rows[r] = rows[piv] as RatN[];
    rows[piv] = tmp;
    const pv = (rows[r] as RatN[])[c] as RatN;
    for (let j = c; j <= n; j++) {
      const cell = (rows[r] as RatN[])[j] as RatN;
      (rows[r] as RatN[])[j] = ratNorm(cell.n * pv.d, cell.d * pv.n);
    }
    for (let i = 0; i < m; i++) {
      if (i === r) continue;
      const f = (rows[i] as RatN[])[c] as RatN;
      if (f.n === 0n) continue;
      for (let j = c; j <= n; j++) {
        const cell = (rows[i] as RatN[])[j] as RatN;
        const sub = (rows[r] as RatN[])[j] as RatN;
        (rows[i] as RatN[])[j] = ratSub(cell, ratMul(f, sub));
      }
    }
    pivots.push(c);
    r++;
  }
  let inconsistent = false;
  for (let i = 0; i < m; i++) {
    const row = rows[i] as RatN[];
    if (row.slice(0, n).every((x) => x.n === 0n) && row[n]?.n !== 0n) inconsistent = true;
  }
  return { rows, pivots, inconsistent };
}

function ratMul(a: RatN, b: RatN): RatN {
  return ratNorm(a.n * b.n, a.d * b.d);
}

function ratSub(a: RatN, b: RatN): RatN {
  return ratNorm(a.n * b.d - b.n * a.d, a.d * b.d);
}

function tryLinearSystem(eqs: readonly SymNode[], vars: readonly SymNode[], ctx: RuleCtx): SystemResult | null {
  const polys: { coeffs: bigint[]; const: bigint; den: bigint }[] = [];
  for (const e of eqs) {
    const mp = treeToMPoly(e, vars, ctx.tick);
    if (mp === null) return null;
    let total = 0;
    for (const k of mp.terms.keys()) {
      const d = k.split(',').reduce((s, x) => s + Number(x), 0);
      if (d > total) total = d;
    }
    if (total > 1) return null;
    const coeffs = new Array<bigint>(vars.length).fill(0n);
    let c0 = 0n;
    for (const [k, v] of mp.terms) {
      const exps = k.split(',').map(Number);
      const idx = exps.findIndex((x) => x === 1);
      if (idx < 0) c0 += v;
      else coeffs[idx] = (coeffs[idx] as bigint) + v;
    }
    polys.push({ coeffs, const: c0, den: mp.den });
  }
  let den = 1n;
  for (const p of polys) den = (den * p.den) / bigGcdLocal(den, p.den);
  const a = polys.map((p) => p.coeffs.map((c) => c * (den / p.den)));
  const b = polys.map((p) => -p.const * (den / p.den));
  const { rows, pivots, inconsistent } = rrefRat(a, b);
  if (inconsistent) return { solutions: [], notices: [], unchecked: false };
  const free = vars.map((_, i) => i).filter((i) => !pivots.includes(i));
  if (free.length === 0) {
    const vals = new Array<SymNode>(vars.length).fill(ZERO);
    rows.forEach((row) => {
      const piv = row.findIndex((x, j) => j < vars.length && x.n !== 0n);
      if (piv >= 0) vals[piv] = ratN((row[vars.length] as RatN).n, (row[vars.length] as RatN).d);
    });
    return { solutions: [vals], notices: [], unchecked: false };
  }
  const vals = new Array<SymNode>(vars.length).fill(ZERO);
  free.forEach((i) => {
    vals[i] = vars[i] as SymNode;
  });
  const pivotRow = new Map<number, RatN[]>();
  rows.forEach((row) => {
    const piv = row.findIndex((x, j) => j < vars.length && x.n !== 0n);
    if (piv >= 0) pivotRow.set(piv, row);
  });
  for (const [piv, row] of pivotRow) {
    let expr = ratN((row[vars.length] as RatN).n, (row[vars.length] as RatN).d);
    free.forEach((j) => {
      const c = row[j] as RatN;
      if (c.n !== 0n) expr = add(expr, negateNode(mul(ratN(c.n, c.d), vars[j] as SymNode)));
    });
    vals[piv] = expr;
  }
  return { solutions: [vals], notices: [], unchecked: false };
}

function trySubstitutionSystem(a: SymNode, b: SymNode, x: SymNode, y: SymNode, ctx: RuleCtx): SystemResult | null {
  for (const [eq, other, v, w] of [[a, b, x, y], [a, b, y, x], [b, a, x, y], [b, a, y, x]] as const) {
    const coeffs = treeToUPolySym(eq, v, ctx.tick);
    if (coeffs === null || coeffs.length !== 2) continue;
    const [c0, c1] = coeffs as [SymNode, SymNode];
    if (containsGen(c1, v) || containsGen(c1, w) || containsGen(c0, v)) continue;
    if (isZeroNode(c1)) continue;
    const expr = divideNodes(negateNode(c0), c1);
    const reduced = substituteList(other, [[v, expr]]);
    try {
      const inner = solveEquation(reduced, w, ctx.assume, ctx.tick, {}, ctx.note);
      if (inner.all) continue;
      const sols: SymNode[][] = [];
      for (const r of inner.solutions) {
        const xv = simplifyNode(substituteList(expr, [[w, r]]), ctx).node;
        sols.push(v === x ? [xv, r] : [r, xv]);
      }
      return { solutions: sols, notices: [], unchecked: false };
    } catch {
      continue;
    }
  }
  return null;
}

function tryResultantSystem(a: SymNode, b: SymNode, x: SymNode, y: SymNode, ctx: RuleCtx): SystemResult | null {
  const pa = treeToMPoly(a, [x, y], ctx.tick);
  const pb = treeToMPoly(b, [x, y], ctx.tick);
  if (pa === null || pb === null) return null;
  const deg = (p: { terms: ReadonlyMap<string, bigint> }): number => {
    let m = 0;
    for (const k of p.terms.keys()) {
      const d = k.split(',').reduce((s, t) => s + Number(t), 0);
      if (d > m) m = d;
    }
    return m;
  };
  if (deg(pa) > 4 || deg(pb) > 4 || deg(pa) < 1 || deg(pb) < 1) return null;
  const yFree = (p: { terms: ReadonlyMap<string, bigint> }): boolean => {
    for (const k of p.terms.keys()) {
      if (Number(k.split(',')[1]) > 0) return false;
    }
    return true;
  };
  if (yFree(pa) || yFree(pb)) return solveYFreeSystem(a, b, x, y, ctx);
  const res = resultantY(a, b, x, y, ctx.tick);
  if (res === null || isZeroNode(res)) return null;
  try {
    const xs = solveEquation(res, x, ctx.assume, ctx.tick, {}, ctx.note);
    if (xs.all) return null;
    const sols: SymNode[][] = [];
    for (const xv of xs.solutions) {
      const bSub = substituteList(b, [[x, xv]]);
      try {
        const ys = solveEquation(bSub, y, ctx.assume, ctx.tick, {}, ctx.note);
        if (ys.all) continue;
        for (const yv of ys.solutions) {
          const checkA = simplifyNode(substituteList(a, [[x, xv], [y, yv]]), ctx).node;
          if (isZeroNode(checkA)) sols.push([xv, yv]);
          else if (freeSymbols(checkA).size === 0) {
            const val = evalAt(checkA, new Map());
            if (val !== null && Math.abs(val) < 1e-8) sols.push([xv, yv]);
          }
        }
      } catch {
        continue;
      }
    }
    return { solutions: sols, notices: [], unchecked: false };
  } catch {
    return null;
  }
}

/** One equation is free of `y`: solve it for `x`, back-substitute for `y`. */
function solveYFreeSystem(a: SymNode, b: SymNode, x: SymNode, y: SymNode, ctx: RuleCtx): SystemResult | null {
  const solo = containsGen(a, y) ? b : a;
  const other = containsGen(a, y) ? a : b;
  if (!containsGen(other, y)) {
    try {
      const xs = solveEquation(solo, x, ctx.assume, ctx.tick, {}, ctx.note);
      if (xs.all) return null;
      const sols: SymNode[][] = [];
      for (const xv of xs.solutions) {
        const check = simplifyNode(substituteList(other, [[x, xv]]), ctx).node;
        if (isZeroNode(check)) sols.push([xv, y]);
        else if (freeSymbols(check).size === 0) {
          const val = evalAt(check, new Map());
          if (val !== null && Math.abs(val) < 1e-8) sols.push([xv, y]);
        }
      }
      return { solutions: sols, notices: [], unchecked: false };
    } catch {
      return null;
    }
  }
  try {
    const xs = solveEquation(solo, x, ctx.assume, ctx.tick, {}, ctx.note);
    if (xs.all) return null;
    const out: SymNode[][] = [];
    for (const xv of xs.solutions) {
      const sub = substituteList(other, [[x, xv]]);
      try {
        const ys = solveEquation(sub, y, ctx.assume, ctx.tick, {}, ctx.note);
        if (ys.all) continue;
        for (const yv of ys.solutions) {
          const checkA = simplifyNode(substituteList(a, [[x, xv], [y, yv]]), ctx).node;
          if (isZeroNode(checkA)) out.push([xv, yv]);
          else if (freeSymbols(checkA).size === 0) {
            const val = evalAt(checkA, new Map());
            if (val !== null && Math.abs(val) < 1e-8) out.push([xv, yv]);
          }
        }
      } catch {
        continue;
      }
    }
    return { solutions: out, notices: [], unchecked: false };
  } catch {
    return null;
  }
}

function tryGeneralSubstitution(eqs: readonly SymNode[], vars: readonly SymNode[], ctx: RuleCtx): SystemResult | null {
  for (let ei = 0; ei < eqs.length; ei++) {
    for (let vi = 0; vi < vars.length; vi++) {
      const eq = eqs[ei] as SymNode;
      const v = vars[vi] as SymNode;
      const coeffs = treeToUPolySym(eq, v, ctx.tick);
      if (coeffs === null || coeffs.length !== 2) continue;
      const [c0, c1] = coeffs as [SymNode, SymNode];
      if (isZeroNode(c1)) continue;
      const others = vars.filter((_, j) => j !== vi);
      if (containsGen(c1, v) || others.some((w) => containsGen(c1, w))) continue;
      if (containsGen(c0, v)) continue;
      const expr = divideNodes(negateNode(c0), c1);
      const rest = eqs.filter((_, j) => j !== ei).map((e) => substituteList(e, [[v, expr]]));
      try {
        const inner = solveSystem(rest, others, ctx.assume, ctx.tick, {}, ctx.note);
        const sols: SymNode[][] = [];
        for (const s of inner.solutions) {
          const pairs = others.map((w, j) => [w, s[j] as SymNode] as readonly [SymNode, SymNode]);
          const vv = simplifyNode(substituteList(expr, pairs), ctx).node;
          const full = new Array<SymNode>(vars.length).fill(ZERO);
          others.forEach((_, j) => {
            full[varIndex(vars, others[j] as SymNode)] = s[j] as SymNode;
          });
          full[vi] = vv;
          sols.push(full);
        }
        return { solutions: sols, notices: inner.notices, unchecked: inner.unchecked };
      } catch {
        continue;
      }
    }
  }
  return null;
}

function varIndex(vars: readonly SymNode[], v: SymNode): number {
  return vars.findIndex((x) => x === v);
}

/* ---------------------------------- NSolve ----------------------------------- */

export interface NSolveOptions extends SolveOptions {
  readonly start?: number;
}

export function nsolveEquation(
  f: SymNode,
  v: SymNode,
  assume: Assumptions,
  tick: Ticker,
  opts: NSolveOptions = {},
  note?: RuleCtx['note'],
): SolveResult {
  void assume;
  void note;
  const from = opts.from ?? -100;
  const to = opts.to ?? 100;
  const p = treeToUPoly(f, v, tick);
  if (p !== null && upolyDegree(p) >= 1) {
    const ivs = upolyIsolate(p, tick);
    const sols: SymNode[] = [];
    const g = upolyGcd(p, upolyDerivative(p), tick);
    let multiple = !upolyIsZero(g) && upolyDegree(g) > 0;
    const seen: number[] = [];
    for (const iv of ivs) {
      const r = refineRootFloat(p, iv);
      if (!inInterval(r, opts.from, opts.to)) continue;
      if (seen.some((s) => Math.abs(s - r) < 1e-7 * Math.max(1, Math.abs(r)))) {
        multiple = true;
        continue;
      }
      seen.push(r);
      sols.push(floatN(r));
    }
    return {
      solutions: sols,
      all: false,
      cases: [],
      notices: multiple ? ['multiple_root'] : [],
      unchecked: false,
    };
  }
  return nsolveScan(f, v, from, to, tick, opts.start);
}

function nsolveScan(f: SymNode, v: SymNode, from: number, to: number, tick: Ticker, start?: number): SolveResult {
  const N = 2000;
  const xs: number[] = [];
  const ys: (number | null)[] = [];
  for (let i = 0; i <= N; i++) {
    const x = from + ((to - from) * i) / N;
    xs.push(x);
    const y = evalAt(f, new Map([[varName(v), x]]));
    ys.push(y === null || !Number.isFinite(y) ? null : y);
    tick.tick(2);
  }
  if (start !== undefined) {
    const brackets = bracketFromStart(f, v, start, from, to, tick);
    const sols: SymNode[] = [];
    for (const [a, b] of brackets) {
      const r = bisect(f, v, a, b, tick);
      if (r !== null) sols.push(floatN(r));
    }
    return { solutions: sols, all: false, cases: [], notices: [], unchecked: false };
  }
  const roots: number[] = [];
  let multiple = false;
  for (let i = 0; i < N; i++) {
    const a = xs[i] as number;
    const b = xs[i + 1] as number;
    const fa = ys[i] ?? null;
    const fb = ys[i + 1] ?? null;
    if (fa === null || fb === null) continue;
    if (fa === 0) {
      pushRoot(roots, a);
      continue;
    }
    if (fa * fb < 0) {
      if (isPoleBracket(f, v, a, b)) continue;
      const r = bisect(f, v, a, b, tick);
      if (r !== null) pushRoot(roots, r);
      continue;
    }
    const m = (a + b) / 2;
    const fm = evalAt(f, new Map([[varName(v), m]]));
    tick.tick(1);
    if (fm !== null && Math.abs(fm) < Math.abs(fa) / 4 && Math.abs(fm) < Math.abs(fb) / 4 && Math.abs(fm) < 1e-6) {
      const r = refineTouch(f, v, a, b, tick);
      if (r !== null) {
        pushRoot(roots, r);
        multiple = true;
      }
    }
  }
  const lastY = ys[N];
  if (lastY === 0) pushRoot(roots, xs[N] as number);
  return {
    solutions: roots.map((r) => floatN(r)),
    all: false,
    cases: [],
    notices: multiple ? ['multiple_root'] : [],
    unchecked: false,
  };
}

function pushRoot(roots: number[], r: number): void {
  if (!roots.some((s) => Math.abs(s - r) < 1e-9 * Math.max(1, Math.abs(r)))) roots.push(r);
}

/** A sign change whose magnitude grows as the bracket shrinks is a pole, not a root. */
function isPoleBracket(f: SymNode, v: SymNode, a: number, b: number): boolean {
  const fa = Math.abs(evalAt(f, new Map([[varName(v), a]])) ?? 0);
  const fb = Math.abs(evalAt(f, new Map([[varName(v), b]])) ?? 0);
  const m = (a + b) / 2;
  const fm = Math.abs(evalAt(f, new Map([[varName(v), m]])) ?? 0);
  return fm > 4 * Math.min(fa, fb) && fm > 1e6;
}

function bisect(f: SymNode, v: SymNode, a: number, b: number, tick: Ticker): number | null {
  let fa = evalAt(f, new Map([[varName(v), a]]));
  let lo = a;
  let hi = b;
  if (fa === null) return null;
  for (let i = 0; i < 100; i++) {
    tick.tick(1);
    const m = (lo + hi) / 2;
    const fm = evalAt(f, new Map([[varName(v), m]]));
    if (fm === null) return null;
    if (fm === 0) return m;
    if (fa * fm < 0) hi = m;
    else {
      lo = m;
      fa = fm;
    }
    if (hi - lo < 1e-12 * Math.max(1, Math.abs(m))) return (lo + hi) / 2;
  }
  return (lo + hi) / 2;
}

function refineTouch(f: SymNode, v: SymNode, a: number, b: number, tick: Ticker): number | null {
  let lo = a;
  let hi = b;
  for (let i = 0; i < 60; i++) {
    tick.tick(1);
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const f1 = Math.abs(evalAt(f, new Map([[varName(v), m1]])) ?? Infinity);
    const f2 = Math.abs(evalAt(f, new Map([[varName(v), m2]])) ?? Infinity);
    if (f1 < f2) hi = m2;
    else lo = m1;
    if (hi - lo < 1e-7 * Math.max(1, Math.abs(lo))) break;
  }
  const m = (lo + hi) / 2;
  const fm = evalAt(f, new Map([[varName(v), m]]));
  if (fm === null || Math.abs(fm) > 1e-6) return null;
  return m;
}

function bracketFromStart(f: SymNode, v: SymNode, start: number, from: number, to: number, tick: Ticker): [number, number][] {
  const out: [number, number][] = [];
  let step = Math.max(1e-6, Math.abs(start) * 1e-3);
  let prev = start;
  let fp = evalAt(f, new Map([[varName(v), prev]]));
  for (let i = 0; i < 60; i++) {
    tick.tick(1);
    const x = prev + step;
    if (x > to && prev > start) break;
    if (x < from) break;
    const fx = evalAt(f, new Map([[varName(v), x]]));
    if (fp !== null && fx !== null && fp * fx < 0) {
      out.push([prev, x]);
      if (out.length >= 4) break;
    }
    if (fx !== null) {
      prev = x;
      fp = fx;
    }
    step *= 1.5;
  }
  step = Math.max(1e-6, Math.abs(start) * 1e-3);
  prev = start;
  fp = evalAt(f, new Map([[varName(v), prev]]));
  for (let i = 0; i < 60; i++) {
    tick.tick(1);
    const x = prev - step;
    if (x < from && prev < start) break;
    if (x > to) break;
    const fx = evalAt(f, new Map([[varName(v), x]]));
    if (fp !== null && fx !== null && fp * fx < 0) {
      out.push([x, prev]);
      if (out.length >= 8) break;
    }
    if (fx !== null) {
      prev = x;
      fp = fx;
    }
    step *= 1.5;
  }
  return out;
}

/** Damped Newton from a start grid for small systems. */
export function nsolveSystem(
  eqs: readonly SymNode[],
  vars: readonly SymNode[],
  starts: readonly number[],
  tick: Ticker,
): SystemResult {
  const n = vars.length;
  const grid = starts.length === n ? [starts] : gridStarts(n, 5);
  const sols: number[][] = [];
  for (const g of grid) {
    const r = dampedNewton(eqs, vars, g, tick);
    if (r !== null && !sols.some((s) => s.every((x, i) => Math.abs(x - (r[i] as number)) < 1e-8))) {
      sols.push(r);
    }
  }
  return {
    solutions: sols.map((s) => s.map((x) => floatN(x))),
    notices: [],
    unchecked: false,
  };
}

function gridStarts(n: number, per: number): number[][] {
  const vals = Array.from({ length: per }, (_, i) => -4 + (8 * i) / (per - 1));
  let out: number[][] = [[]];
  for (let i = 0; i < n; i++) {
    const next: number[][] = [];
    for (const o of out) {
      for (const val of vals) next.push([...o, val]);
    }
    out = next;
  }
  return out.slice(0, 200);
}

function dampedNewton(eqs: readonly SymNode[], vars: readonly SymNode[], start: readonly number[], tick: Ticker): number[] | null {
  const n = vars.length;
  let x = [...start];
  const evalSys = (xx: readonly number[]): number[] | null => {
    const m = new Map(vars.map((v, i) => [varName(v), xx[i] as number] as [string, number]));
    const out: number[] = [];
    for (const e of eqs) {
      const y = evalAt(e, m);
      if (y === null || !Number.isFinite(y)) return null;
      out.push(y);
    }
    return out;
  };
  for (let iter = 0; iter < 60; iter++) {
    tick.tick(n * n);
    const fx = evalSys(x);
    if (fx === null) return null;
    const norm = Math.sqrt(fx.reduce((s, y) => s + y * y, 0));
    if (norm < 1e-12) return x;
    const h = 1e-7;
    const jac: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row: number[] = [];
      for (let j = 0; j < n; j++) {
        const xp = [...x];
        xp[j] = (xp[j] as number) + h;
        const fp = evalSys(xp);
        if (fp === null) return null;
        row.push(((fp[i] as number) - (fx[i] as number)) / h);
      }
      jac.push(row);
    }
    const step = gaussSolve(jac, fx.map((y) => -y));
    if (step === null) return null;
    let lambda = 1;
    for (let d = 0; d < 12; d++) {
      const trial = x.map((xi, i) => xi + lambda * (step[i] as number));
      const ft = evalSys(trial);
      if (ft !== null && Math.sqrt(ft.reduce((s, y) => s + y * y, 0)) < norm) {
        x = trial;
        break;
      }
      lambda /= 2;
      if (d === 11) return null;
    }
  }
  return null;
}

function gaussSolve(a: number[][], b: number[]): number[] | null {
  const n = a.length;
  const m = a.map((row, i) => [...row, b[i] as number]);
  for (let k = 0; k < n; k++) {
    let piv = k;
    for (let i = k + 1; i < n; i++) {
      if (Math.abs((m[i] as number[])[k] as number) > Math.abs((m[piv] as number[])[k] as number)) piv = i;
    }
    if (Math.abs((m[piv] as number[])[k] as number) < 1e-14) return null;
    const tmp = m[k] as number[];
    m[k] = m[piv] as number[];
    m[piv] = tmp;
    for (let i = k + 1; i < n; i++) {
      const f = ((m[i] as number[])[k] as number) / ((m[k] as number[])[k] as number);
      for (let j = k; j <= n; j++) (m[i] as number[])[j] = ((m[i] as number[])[j] as number) - f * ((m[k] as number[])[j] as number);
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let k = n - 1; k >= 0; k--) {
    let s = (m[k] as number[])[n] as number;
    for (let j = k + 1; j < n; j++) s -= ((m[k] as number[])[j] as number) * (x[j] as number);
    const d = (m[k] as number[])[k] as number;
    if (Math.abs(d) < 1e-14) return null;
    x[k] = s / d;
  }
  return x;
}

/* ------------------------------ complex numbers ------------------------------ */

export interface Complex {
  readonly re: number;
  readonly im: number;
}

/** Evaluate a tree over C. Null when symbols remain or an op is unsupported. */
export function evalComplex(t: SymNode): Complex | null {
  const addC = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
  const mulC = (a: Complex, b: Complex): Complex => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
  const go = (x: SymNode): Complex | null => {
    switch (x.k) {
      case 'int': return { re: Number(x.v), im: 0 };
      case 'rat': return { re: Number(x.n) / Number(x.d), im: 0 };
      case 'float': return { re: x.v, im: 0 };
      case 'dec': return { re: Number(x.mant) * Math.pow(10, x.exp), im: 0 };
      case 'const':
        if (x.name === 'pi') return { re: Math.PI, im: 0 };
        if (x.name === 'e') return { re: Math.E, im: 0 };
        if (x.name === 'i') return { re: 0, im: 1 };
        return null;
      case 'add': {
        let s: Complex = { re: 0, im: 0 };
        for (const c of x.terms) {
          const v = go(c);
          if (v === null) return null;
          s = addC(s, v);
        }
        return s;
      }
      case 'mul': {
        let p: Complex = { re: 1, im: 0 };
        for (const c of x.factors) {
          const v = go(c);
          if (v === null) return null;
          p = mulC(p, v);
        }
        return p;
      }
      case 'pow': {
        const b = go(x.base);
        const e = go(x.exp);
        if (b === null || e === null) return null;
        if (e.im !== 0) return null;
        if (Number.isInteger(e.re)) {
          let r: Complex = { re: 1, im: 0 };
          const ae = Math.abs(e.re);
          for (let i = 0; i < ae; i++) r = mulC(r, b);
          if (e.re < 0) {
            const d = r.re * r.re + r.im * r.im;
            if (d === 0) return null;
            r = { re: r.re / d, im: -r.im / d };
          }
          return r;
        }
        if (b.im === 0 && b.re >= 0) return { re: Math.pow(b.re, e.re), im: 0 };
        const rho = Math.hypot(b.re, b.im);
        const theta = Math.atan2(b.im, b.re);
        const rr = Math.pow(rho, e.re);
        const tt = theta * e.re;
        return { re: rr * Math.cos(tt), im: rr * Math.sin(tt) };
      }
      case 'fn': {
        if (x.args.length !== 1) return null;
        const a = go(x.args[0] as SymNode);
        if (a === null) return null;
        return evalFnComplex(x.name, a);
      }
      case 'rootof': return { re: x.hint, im: 0 };
      default: return null;
    }
  };
  return go(t);
}

/** Elementary functions over C (principal branches). */
function evalFnComplex(name: string, a: Complex): Complex | null {
  const { re: x, im: y } = a;
  switch (name) {
    case 'sin': return { re: Math.sin(x) * Math.cosh(y), im: Math.cos(x) * Math.sinh(y) };
    case 'cos': return { re: Math.cos(x) * Math.cosh(y), im: -Math.sin(x) * Math.sinh(y) };
    case 'tan': {
      const s = evalFnComplex('sin', a) as Complex;
      const c = evalFnComplex('cos', a) as Complex;
      const d = c.re * c.re + c.im * c.im;
      if (d === 0) return null;
      return { re: (s.re * c.re + s.im * c.im) / d, im: (s.im * c.re - s.re * c.im) / d };
    }
    case 'exp': {
      const r = Math.exp(x);
      return { re: r * Math.cos(y), im: r * Math.sin(y) };
    }
    case 'ln': {
      const rho = Math.hypot(x, y);
      if (rho === 0) return null;
      return { re: Math.log(rho), im: Math.atan2(y, x) };
    }
    case 'sqrt': {
      const rho = Math.hypot(x, y);
      const r = Math.sqrt(rho);
      const t = Math.atan2(y, x) / 2;
      return { re: r * Math.cos(t), im: r * Math.sin(t) };
    }
    case 'asin': {
      const iz: Complex = { re: -y, im: x };
      const oneMinus: Complex = { re: 1 - (x * x - y * y), im: 2 * x * y };
      const sq = evalFnComplex('sqrt', { re: oneMinus.re, im: -oneMinus.im }) as Complex;
      const w: Complex = { re: iz.re + sq.re, im: iz.im + sq.im };
      const l = evalFnComplex('ln', w);
      if (l === null) return null;
      return { re: l.im, im: -l.re };
    }
    case 'acos': {
      const s = evalFnComplex('asin', a);
      if (s === null) return null;
      return { re: Math.PI / 2 - s.re, im: -s.im };
    }
    case 'atan': {
      if (x === 0 && Math.abs(y) === 1) return null;
      const num: Complex = { re: 1 - y, im: x };
      const den: Complex = { re: 1 + y, im: -x };
      const d = den.re * den.re + den.im * den.im;
      if (d === 0) return null;
      const q: Complex = { re: (num.re * den.re + num.im * den.im) / d, im: (num.im * den.re - num.re * den.im) / d };
      const l = evalFnComplex('ln', q);
      if (l === null) return null;
      return { re: l.im / 2, im: -l.re / 2 };
    }
    case 'abs': return y === 0 ? { re: Math.abs(x), im: 0 } : null;
    case 'sinh': return { re: Math.sinh(x) * Math.cos(y), im: Math.cosh(x) * Math.sin(y) };
    case 'cosh': return { re: Math.cosh(x) * Math.cos(y), im: Math.sinh(x) * Math.sin(y) };
    case 'tanh': {
      const s = evalFnComplex('sinh', a) as Complex;
      const c = evalFnComplex('cosh', a) as Complex;
      const d = c.re * c.re + c.im * c.im;
      if (d === 0) return null;
      return { re: (s.re * c.re + s.im * c.im) / d, im: (s.im * c.re - s.re * c.im) / d };
    }
    default: return null;
  }
}

export function complexNode(re: number, im: number): SymNode {
  const i = constN('i');
  if (im === 0) return floatN(re);
  if (re === 0) return im === 1 ? i : im === -1 ? negateNode(i) : mul(floatN(im), i);
  return im > 0 ? add(floatN(re), mul(floatN(im), i)) : add(floatN(re), negateNode(mul(floatN(-im), i)));
}

/** Durand-Kerner complex roots of a polynomial (numeric, inexact). */
function solvePolyComplexNumeric(p: UPoly, ctx: RuleCtx): SymNode[] {
  const d = upolyDegree(p);
  if (d <= 0) return [];
  const coeff = (i: number): number => (i < p.c.length ? Number(p.c[i]) / Number(p.den) : 0);
  const lead = coeff(d);
  const roots: Complex[] = [];
  for (let k = 0; k < d; k++) {
    const ang = (2 * Math.PI * k) / d + 0.3;
    roots.push({ re: 0.4 * Math.cos(ang), im: 0.4 * Math.sin(ang) });
  }
  const evalP = (z: Complex): Complex => {
    let r: Complex = { re: 0, im: 0 };
    for (let i = d; i >= 0; i--) {
      r = { re: r.re * z.re - r.im * z.im + coeff(i) / lead, im: r.re * z.im + r.im * z.re };
    }
    return r;
  };
  for (let iter = 0; iter < 200; iter++) {
    ctx.tick.tick(d);
    let max = 0;
    for (let k = 0; k < d; k++) {
      const zk = roots[k] as Complex;
      let den: Complex = { re: 1, im: 0 };
      for (let j = 0; j < d; j++) {
        if (j === k) continue;
        const zj = roots[j] as Complex;
        const df = { re: zk.re - zj.re, im: zk.im - zj.im };
        den = { re: den.re * df.re - den.im * df.im, im: den.re * df.im + den.im * df.re };
      }
      const dd = den.re * den.re + den.im * den.im;
      if (dd === 0) continue;
      const num = evalP(zk);
      const delta = {
        re: (num.re * den.re + num.im * den.im) / dd,
        im: (num.im * den.re - num.re * den.im) / dd,
      };
      roots[k] = { re: zk.re - delta.re, im: zk.im - delta.im };
      const m = Math.hypot(delta.re, delta.im);
      if (m > max) max = m;
    }
    if (max < 1e-13) break;
  }
  return roots.map((z) => complexNode(z.re, z.im));
}

/** `CSolve`: factor, solve the factors over C, `a + b i` forms. */
export function csolveEquation(
  f: SymNode,
  v: SymNode,
  assume: Assumptions,
  tick: Ticker,
  note?: RuleCtx['note'],
): SolveResult {
  const ctx = ctxWith(assume, tick, note);
  if (!containsGen(f, v)) {
    const s = simplifyNode(f, ctx).node;
    if (isZeroNode(s)) return allSolutions();
    return noSolutions();
  }
  try {
    return solveEquation(f, v, assume, tick, { domain: 'complex' }, note);
  } catch (e) {
    if (!(e instanceof Unsupported)) throw e;
  }
  const atoms = trigAtoms(f, v);
  if (atoms.length > 0) {
    const r = solveTrigSingleComplex(f, v, ctx);
    if (r !== null) return r;
  }
  const exp = solveExpComplex(f, v, ctx);
  if (exp !== null) return exp;
  throw new Unsupported('this equation over the complex numbers', 'classify');
}

function solveTrigSingleComplex(f: SymNode, v: SymNode, ctx: RuleCtx): SolveResult | null {
  const atoms = trigAtoms(f, v);
  if (atoms.length === 0) return null;
  try {
    return solveTrig(f, v, ctx, 'complex');
  } catch {
    return null;
  }
}

function solveExpComplex(f: SymNode, v: SymNode, ctx: RuleCtx): SolveResult | null {
  const atoms = expAtoms(f, v);
  if (atoms.length !== 1) return null;
  const coeffs = treeToUPolySym(f, atoms[0] as SymNode, ctx.tick);
  if (coeffs === null || coeffs.length !== 2) return null;
  const [b, a] = coeffs as [SymNode, SymNode];
  if (containsGen(a, v) || containsGen(b, v) || isZeroNode(a)) return null;
  const c = simplifyNode(divideNodes(negateNode(b), a), ctx).node;
  if (freeSymbols(c).size > 0) return null;
  const k = symN(`k${trigParamNext++}`);
  const i = constN('i');
  const pi = constN('pi');
  const principal = fn('ln', c);
  const fam = add(principal, mul(mul(TWO, pi), mul(i, k)));
  const atom = atoms[0] as SymNode;
  const out = atom.k === 'fn' ? fam : divideNodes(fam, fn('ln', (atom as SymNode & { k: 'pow' }).base));
  return { solutions: [out], all: false, cases: [], param: k.name, notices: ['periodic_family'], unchecked: false };
}

/* --------------------------------- SolveODE ---------------------------------- */

/**
 * ODEs in `y(x)`: write `y'` as the symbol `yp` and `y''` as `ypp`. Classes: first-order
 * separable, first-order linear, second-order constant coefficients (homogeneous, plus a
 * constant right-hand side). Returns a general solution as a Cond in `x`, `y`, `C1`
 * (`C2`); with `init` the constant is solved and the particular solution returned.
 */
export function solveODE(
  f: SymNode,
  y: SymNode,
  x: SymNode,
  assume: Assumptions,
  tick: Ticker,
  init?: readonly [number, number],
  note?: RuleCtx['note'],
): { cond: SymCond; notices: readonly string[] } {
  const ctx = ctxWith(assume, tick, note);
  const yp = symN('yp');
  const ypp = symN('ypp');
  const has2 = containsGen(f, ypp);
  const has1 = containsGen(f, yp);
  if (!has1 && !has2) throw new Unsupported('the equation has no yp or ypp term', 'classify');
  const C1 = symN('C1');
  const C2 = symN('C2');
  let cond: SymCond;
  if (has2) {
    cond = solveODE2(f, y, x, yp, ypp, C1, C2, ctx);
  } else {
    const linear = solveODELinear1(f, y, x, yp, C1, ctx);
    if (linear !== null) cond = linear;
    else {
      const sep = solveODESeparable(f, y, x, yp, C1, ctx);
      if (sep === null) throw new Unsupported('this ODE is not separable or linear first-order, or constant-coefficient second-order', 'classify');
      cond = sep;
    }
  }
  if (init !== undefined) {
    const [x0, y0] = init;
    const sub = substituteList(condToDiff(cond, y, x), [[x, floatN(x0)], [y, floatN(y0)]]);
    try {
      const c1 = solveEquation(sub, C1, assume, tick, {}, note);
      if (!c1.all && c1.solutions.length === 1) {
        return { cond: substituteCond(cond, [[C1, c1.solutions[0] as SymNode]]), notices: [] };
      }
    } catch {
      void 0;
    }
    throw new Unsupported('the initial condition could not be solved for C1', 'isolate');
  }
  return { cond, notices: [] };
}

function condToDiff(c: SymCond, _y: SymNode, _x: SymNode): SymNode {
  void _y;
  void _x;
  if (c.c === 'rel') return add(c.l, negateNode(c.r));
  throw new Unsupported('solution is not an equation', 'isolate');
}

function substituteCond(c: SymCond, pairs: readonly (readonly [SymNode, SymNode])[]): SymCond {
  const go = (t: SymNode): SymNode => substituteList(t, pairs);
  if (c.c === 'rel') return rel(c.op, go(c.l), go(c.r));
  return c;
}

/** First-order linear: `yp + P(x) y = Q(x)` by the integrating factor. */
function solveODELinear1(f: SymNode, y: SymNode, x: SymNode, yp: SymNode, C1: SymNode, ctx: RuleCtx): SymCond | null {
  const coeffs = treeToUPolySym(f, yp, ctx.tick);
  if (coeffs === null || coeffs.length !== 2) return null;
  const [rest, a1] = coeffs as [SymNode, SymNode];
  if (containsGen(a1, y) || containsGen(a1, yp)) return null;
  const yCoeffs = treeToUPolySym(rest, y, ctx.tick);
  if (yCoeffs === null || yCoeffs.length > 2) return null;
  const P = divideNodes(yCoeffs.length === 2 ? (yCoeffs[1] as SymNode) : ZERO, a1);
  const Q = divideNodes(negateNode(yCoeffs[0] as SymNode), a1);
  if (containsGen(P, y) || containsGen(Q, y)) return null;
  const intP = lazyIntegrate(P, x, ctx);
  if (intP === null) return null;
  const mu = pow(constN('e'), intP);
  const intMuQ = lazyIntegrate(mul(mu, Q), x, ctx);
  if (intMuQ === null) return null;
  const sol = divideNodes(add(intMuQ, C1), mu);
  return rel('==', y, simplifyNode(sol, ctx).node);
}

type IntegrateFn = (e: SymNode, v: SymNode, ctx: RuleCtx) => SymNode | null;
let lazyIntegrate: IntegrateFn = () => null;

/** The calculus module registers its integrator here (avoids a module cycle). */
export function registerIntegrator(fn_: IntegrateFn): void {
  lazyIntegrate = fn_;
}

/** First-order separable: `yp = A(x) B(y)`. */
function solveODESeparable(f: SymNode, y: SymNode, x: SymNode, yp: SymNode, C1: SymNode, ctx: RuleCtx): SymCond | null {
  const coeffs = treeToUPolySym(f, yp, ctx.tick);
  if (coeffs === null || coeffs.length !== 2) return null;
  const [rest, a1] = coeffs as [SymNode, SymNode];
  if (!isOneNode(a1) && (containsGen(a1, x) || containsGen(a1, y))) {
    if (!isOneNode(simplifyNode(a1, ctx).node)) return null;
  }
  const rhs = divideNodes(negateNode(rest), a1);
  const sep = splitSeparable(rhs, x, y);
  if (sep === null) return null;
  const [A, B] = sep;
  if (isOneNode(simplifyNode(B, ctx).node)) {
    const G = lazyIntegrate(A, x, ctx);
    if (G === null) return null;
    return rel('==', y, add(G, C1));
  }
  if (isOneNode(simplifyNode(A, ctx).node)) {
    const H = lazyIntegrate(divideNodes(ONE, B), y, ctx);
    if (H === null) return null;
    return rel('==', H, add(x, C1));
  }
  const G = lazyIntegrate(A, x, ctx);
  const H = lazyIntegrate(divideNodes(ONE, B), y, ctx);
  if (G === null || H === null) return null;
  return rel('==', H, add(G, C1));
}

function splitSeparable(rhs: SymNode, x: SymNode, y: SymNode): [SymNode, SymNode] | null {
  const factors = rhs.k === 'mul' ? rhs.factors : [rhs];
  const inX: SymNode[] = [];
  const inY: SymNode[] = [];
  for (const f of factors) {
    const hx = containsGen(f, x);
    const hy = containsGen(f, y);
    if (hx && hy) return null;
    if (hx) inX.push(f);
    else if (hy) inY.push(f);
    else inX.push(f);
  }
  return [inX.length === 0 ? ONE : mul(...inX), inY.length === 0 ? ONE : mul(...inY)];
}

/** Second-order constant coefficients: `a ypp + b yp + c y = rhs` (constant rhs). */
function solveODE2(
  f: SymNode, y: SymNode, x: SymNode, yp: SymNode, ypp: SymNode, C1: SymNode, C2: SymNode, ctx: RuleCtx,
): SymCond {
  const c2 = treeToUPolySym(f, ypp, ctx.tick);
  if (c2 === null || c2.length !== 2) throw new Unsupported('the ODE is not linear in ypp', 'classify');
  const [r1, a] = c2 as [SymNode, SymNode];
  const c1 = treeToUPolySym(r1, yp, ctx.tick);
  if (c1 === null || c1.length !== 2) throw new Unsupported('the ODE is not linear in yp', 'classify');
  const [r0, b] = c1 as [SymNode, SymNode];
  const c0 = treeToUPolySym(r0, y, ctx.tick);
  if (c0 === null || c0.length > 2) throw new Unsupported('the ODE is not linear in y', 'classify');
  const c = c0.length === 2 ? (c0[1] as SymNode) : ZERO;
  const rhs = negateNode(c0[0] as SymNode);
  for (const t of [a, b, c]) {
    if (containsGen(t, x) || containsGen(t, y)) throw new Unsupported('the ODE has non-constant coefficients', 'classify');
  }
  if (containsGen(rhs, x) || containsGen(rhs, y)) throw new Unsupported('the right-hand side is not constant', 'classify');
  if (isZeroNode(a)) throw new Unsupported('the ypp coefficient is zero', 'classify');
  const A = a;
  const B = b;
  const C = c;
  const disc = simplifyNode(add(mul(B, B), negateNode(mul(intN(4), mul(A, C)))), ctx).node;
  const s = exactSign(disc);
  if (s === null) throw new Unsupported('the discriminant sign is undecidable', 'classify');
  const twoA = mul(TWO, A);
  let hom: SymNode;
  if (s > 0) {
    const sq = pow(disc, ratN(1n, 2n));
    const r1v = divideNodes(add(negateNode(B), sq), twoA);
    const r2v = divideNodes(add(negateNode(B), negateNode(sq)), twoA);
    hom = add(mul(C1, pow(constN('e'), mul(r1v, x))), mul(C2, pow(constN('e'), mul(r2v, x))));
  } else if (s === 0) {
    const r = divideNodes(negateNode(B), twoA);
    hom = mul(add(C1, mul(C2, x)), pow(constN('e'), mul(r, x)));
  } else {
    const re = divideNodes(negateNode(B), twoA);
    const im = divideNodes(pow(negateNode(disc), ratN(1n, 2n)), twoA);
    const osc = add(mul(C1, fn('cos', mul(im, x))), mul(C2, fn('sin', mul(im, x))));
    hom = mul(pow(constN('e'), mul(re, x)), osc);
  }
  if (isZeroNode(rhs)) return rel('==', y, hom);
  if (isZeroNode(C)) throw new Unsupported('a constant right-hand side with c == 0 needs resonance handling', 'isolate');
  const particular = divideNodes(rhs, C);
  return rel('==', y, add(hom, particular));
}

