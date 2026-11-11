/**
 * Calculus on expressions (cas/design.md 5.10): exact derivatives by tree rules,
 * integrals by linearity, tables, parts, partial fractions, trig reductions and
 * substitution attempts, and limits by substitution, cancellation, standard forms,
 * L'Hopital and one-sided analysis. Definite integrals fall back to numeric quadrature.
 */
import type { SymCond, SymFn, SymNode } from './node';
import {
  ONE, TWO, ZERO, add, asInteger, asRational, constN, divideNodes, floatN, fn, freeSymbols,
  intN, isNumberNode, isOneNode, isZeroNode, mapNodes, mul, negateNode, piecewiseN, pow, ratN, rel, symN,
} from './node';
import { containsGen, treeToUPoly, treeToUPolySym, upolyDegree, upolyIsolate, upolyIsZero } from './poly';
import { apartNode, evalAt, expandNode, simplifyNode, substituteList, togetherNode } from './rules';
import type { RuleCtx } from './rules';
import { Unsupported } from './solve';

/* --------------------------------- derivative --------------------------------- */

/** The variable name for numeric sampling; the numeric paths need a real symbol. */
function varName(v: SymNode): string {
  if (v.k !== 'sym') throw new Unsupported('a limit or integral in one symbol', 'classify');
  return v.name;
}

/** Exact derivative of `e` with respect to `v`, then a light simplify pass. */
export function diffNode(e: SymNode, v: SymNode, ctx: RuleCtx): SymNode {
  const d = diffRaw(e, v, ctx);
  return simplifyNode(d, ctx).node;
}

function diffRaw(e: SymNode, v: SymNode, ctx: RuleCtx): SymNode {
  ctx.tick.tick(1);
  switch (e.k) {
    case 'int': case 'rat': case 'float': case 'dec': case 'const': return ZERO;
    case 'sym': return e === v ? ONE : ZERO;
    case 'ref': return ZERO;
    case 'rootof': throw new Unsupported('the derivative of a rootof value', 'differentiate');
    case 'list': throw new Unsupported('the derivative of a list', 'differentiate');
    case 'add': return add(...e.terms.map((t) => diffRaw(t, v, ctx)));
    case 'mul': {
      if (e.factors.length === 0) return ZERO;
      const terms: SymNode[] = [];
      e.factors.forEach((f, i) => {
        const df = diffRaw(f, v, ctx);
        if (isZeroNode(df)) return;
        terms.push(mul(df, ...e.factors.filter((_, j) => j !== i)));
      });
      return add(...terms);
    }
    case 'pow': {
      const a = e.base;
      const b = e.exp;
      const da = containsGen(a, v) ? diffRaw(a, v, ctx) : ZERO;
      const db = containsGen(b, v) ? diffRaw(b, v, ctx) : ZERO;
      if (isZeroNode(db)) {
        if (isZeroNode(da)) return ZERO;
        return mul(b, mul(pow(a, add(b, negateNode(ONE))), da));
      }
      if (isZeroNode(da)) {
        return mul(mul(e, fn('ln', a)), db);
      }
      return mul(e, add(mul(db, fn('ln', a)), mul(b, divideNodes(da, a))));
    }
    case 'fn': return diffFn(e.name, e.args, v, ctx);
    case 'piecewise': {
      const cases = e.cases.map((cs) => ({ when: cs.when, then: diffRaw(cs.then, v, ctx) }));
      const other = e.other === undefined ? undefined : diffRaw(e.other, v, ctx);
      return piecewiseN(cases, other);
    }
  }
}

function diffFn(name: SymFn, args: readonly SymNode[], v: SymNode, ctx: RuleCtx): SymNode {
  const u = args[0] as SymNode;
  const du = containsGen(u, v) ? diffRaw(u, v, ctx) : ZERO;
  const chain = (outer: SymNode): SymNode => (isZeroNode(du) ? ZERO : mul(outer, du));
  switch (name) {
    case 'sin': return chain(fn('cos', u));
    case 'cos': return chain(negateNode(fn('sin', u)));
    case 'tan': return chain(add(ONE, mul(fn('tan', u), fn('tan', u))));
    case 'asin': return chain(divideNodes(ONE, pow(add(ONE, negateNode(mul(u, u))), ratN(1n, 2n))));
    case 'acos': return chain(negateNode(divideNodes(ONE, pow(add(ONE, negateNode(mul(u, u))), ratN(1n, 2n)))));
    case 'atan': return chain(divideNodes(ONE, add(ONE, mul(u, u))));
    case 'atan2': {
      const y = args[0] as SymNode;
      const x = args[1] as SymNode;
      const dy = containsGen(y, v) ? diffRaw(y, v, ctx) : ZERO;
      const dx = containsGen(x, v) ? diffRaw(x, v, ctx) : ZERO;
      return divideNodes(add(mul(x, dy), negateNode(mul(y, dx))), add(mul(x, x), mul(y, y)));
    }
    case 'sinh': return chain(fn('cosh', u));
    case 'cosh': return chain(fn('sinh', u));
    case 'tanh': return chain(add(ONE, negateNode(mul(fn('tanh', u), fn('tanh', u)))));
    case 'asinh': return chain(divideNodes(ONE, pow(add(ONE, mul(u, u)), ratN(1n, 2n))));
    case 'acosh': return chain(divideNodes(ONE, pow(add(mul(u, u), negateNode(ONE)), ratN(1n, 2n))));
    case 'atanh': return chain(divideNodes(ONE, add(ONE, negateNode(mul(u, u)))));
    case 'exp': return chain(fn('exp', u));
    case 'ln': case 'log10': case 'log2': {
      const base = name === 'ln' ? null : name === 'log10' ? intN(10) : TWO;
      const denom = base === null ? u : mul(u, fn('ln', base));
      return chain(divideNodes(ONE, denom));
    }
    case 'abs': return chain(fn('sign', u));
    case 'sign': case 'floor': case 'ceil': case 'round': return ZERO;
    case 'min': case 'max': {
      const a = args[0] as SymNode;
      const b = args[1] as SymNode;
      const da = containsGen(a, v) ? diffRaw(a, v, ctx) : ZERO;
      const db = containsGen(b, v) ? diffRaw(b, v, ctx) : ZERO;
      return name === 'min'
        ? piecewiseN([{ when: rel('<', a, b), then: da }], db)
        : piecewiseN([{ when: rel('>', a, b), then: da }], db);
    }
    case 'sqrt': return chain(divideNodes(ONE, mul(TWO, fn('sqrt', u))));
    case 'cbrt': return chain(divideNodes(ONE, mul(intN(3), mul(fn('cbrt', u), fn('cbrt', u)))));
  }
}

/* --------------------------------- integral ----------------------------------- */

export class NonElementary extends Error {
  readonly special: string;
  constructor(special: string) {
    super(`non-elementary: ${special}`);
    this.name = 'NonElementary';
    this.special = special;
  }
}

/** Indefinite integral of `e` with respect to `v`. Null when no rule applies. */
export function integrateNode(e: SymNode, v: SymNode, ctx: RuleCtx, depth = 0): SymNode | null {
  if (depth > 6) return null;
  ctx.tick.tick(2);
  if (!containsGen(e, v)) return mul(e, v);
  checkNonElementary(e, v);
  if (e.k === 'add') {
    let out: SymNode = ZERO;
    for (const t of e.terms) {
      const q = integrateNode(t, v, ctx, depth + 1);
      if (q === null) return null;
      out = add(out, q);
    }
    return out;
  }
  if (e.k === 'mul') {
    const constParts = e.factors.filter((f) => !containsGen(f, v));
    const varParts = e.factors.filter((f) => containsGen(f, v));
    if (constParts.length > 0 && varParts.length > 0) {
      const q = integrateNode(mul(...varParts), v, ctx, depth + 1);
      if (q !== null) return mul(mul(...constParts), q);
    }
    const parts = tryTabular(e, v, ctx, depth);
    if (parts !== null) return parts;
    const byParts = tryParts(e, v, ctx, depth);
    if (byParts !== null) return byParts;
  }
  const table = tryTable(e, v, ctx);
  if (table !== null) return table;
  const trig = tryTrigPowers(e, v, ctx, depth);
  if (trig !== null) return trig;
  const subst = trySubstitution(e, v, ctx, depth);
  if (subst !== null) return subst;
  const rat = tryRational(e, v, ctx, depth);
  if (rat !== null) return rat;
  const quad = trySqrtQuad(e, v, ctx);
  if (quad !== null) return quad;
  return null;
}

/** Known non-elementary integrals: throw with the special function named. */
function checkNonElementary(e: SymNode, v: SymNode): void {
  const isV = (t: SymNode): boolean => t === v;
  const expArg = (t: SymNode): SymNode | null => {
    if (t.k === 'fn' && t.name === 'exp' && t.args.length === 1) return t.args[0] as SymNode;
    if (t.k === 'pow' && t.base.k === 'const' && t.base.name === 'e') return t.exp;
    return null;
  };
  const match = (t: SymNode): string | null => {
    const ea = expArg(t);
    if (ea !== null) {
      const coeffs = treeToUPolySym(ea, v);
      if (coeffs !== null && coeffs.length === 3 && !isZeroNode(coeffs[2] as SymNode)) return 'erf';
    }
    if (t.k === 'mul') {
      const num = t.factors.filter((f) => !(f.k === 'pow' && asInteger(f.exp) !== null && (asInteger(f.exp) as bigint) < 0n));
      const den = t.factors.filter((f) => f.k === 'pow' && asInteger(f.exp) !== null && (asInteger(f.exp) as bigint) < 0n);
      if (den.length === 1 && num.length === 1) {
        const n = num[0] as SymNode;
        const d = (den[0] as SymNode & { k: 'pow' }).base;
        if (d === v || (d.k === 'mul' && d.factors.includes(v))) {
          if (n.k === 'fn' && (n.name === 'sin' || n.name === 'cos') && isV(n.args[0] as SymNode)) return 'Si';
          const na = expArg(n);
          if (na !== null && isV(na)) return 'Ei';
        }
      }
    }
    if (t.k === 'pow' && asInteger(t.exp) !== null && (asInteger(t.exp) as bigint) < 0n) {
      const b = t.base;
      if (b.k === 'fn' && b.name === 'ln' && isV(b.args[0] as SymNode)) return 'li';
      if (b.k === 'fn' && (b.name === 'sin' || b.name === 'cos') && t.exp !== undefined) return null;
    }
    if (t.k === 'fn' && (t.name === 'sin' || t.name === 'cos') && t.args.length === 1) {
      const a = t.args[0] as SymNode;
      const coeffs = treeToUPolySym(a, v);
      if (coeffs !== null && coeffs.length === 3) return 'Fresnel S/C';
    }
    return null;
  };
  const terms = e.k === 'add' ? e.terms : [e];
  for (const t of terms) {
    const s = match(t);
    if (s !== null) throw new NonElementary(s);
  }
}

/** Linear argument `a v + b` with `a`, `b` free of `v`. */
function linearArg(t: SymNode, v: SymNode): { a: SymNode; b: SymNode } | null {
  const coeffs = treeToUPolySym(t, v);
  if (coeffs === null || coeffs.length > 2) return null;
  if (coeffs.length === 1) return null;
  const [b, a] = coeffs as [SymNode, SymNode];
  if (isZeroNode(a)) return null;
  return { a, b };
}

/** Elementary table with linear arguments. */
function tryTable(e: SymNode, v: SymNode, ctx: RuleCtx): SymNode | null {
  void ctx;
  if (e === v) return divideNodes(mul(v, v), TWO);
  if (e.k === 'pow' && e.base === v) {
    const n = asRational(e.exp);
    if (n !== null) {
      if (n.n === -1n && n.d === 1n) return fn('ln', fn('abs', v));
      return divideNodes(pow(v, add(e.exp, ONE)), add(e.exp, ONE));
    }
    return null;
  }
  const unlinear = (inner: SymNode, F: (u: SymNode) => SymNode): SymNode | null => {
    const la = linearArg(inner, v);
    if (la === null) return null;
    const u = add(mul(la.a, v), la.b);
    return divideNodes(F(u), la.a);
  };
  if (e.k === 'pow' && !containsGen(e.base, v) && containsGen(e.exp, v)) {
    return unlinear(e.exp, (u) => divideNodes(pow(e.base, u), fn('ln', e.base)));
  }
  if (e.k === 'fn' && e.args.length === 1) {
    const u = e.args[0] as SymNode;
    switch (e.name) {
      case 'exp': return unlinear(u, (w) => fn('exp', w));
      case 'sin': return unlinear(u, (w) => negateNode(fn('cos', w)));
      case 'cos': return unlinear(u, (w) => fn('sin', w));
      case 'tan': return unlinear(u, (w) => negateNode(fn('ln', fn('abs', fn('cos', w)))));
      case 'sinh': return unlinear(u, (w) => fn('cosh', w));
      case 'cosh': return unlinear(u, (w) => fn('sinh', w));
      case 'ln': {
        if (u === v) return add(mul(v, fn('ln', v)), negateNode(v));
        return unlinear(u, (w) => add(mul(w, fn('ln', w)), negateNode(w)));
      }
      case 'sqrt': {
        if (u === v) return mul(ratN(2n, 3n), mul(v, fn('sqrt', v)));
        return null;
      }
      case 'asin': {
        if (u === v) return add(mul(v, fn('asin', v)), pow(add(ONE, negateNode(mul(v, v))), ratN(1n, 2n)));
        return null;
      }
      case 'acos': {
        if (u === v) return add(mul(v, fn('acos', v)), negateNode(pow(add(ONE, negateNode(mul(v, v))), ratN(1n, 2n))));
        return null;
      }
      case 'atan': {
        if (u === v) return add(mul(v, fn('atan', v)), negateNode(divideNodes(fn('ln', add(ONE, mul(v, v))), TWO)));
        return null;
      }
      default: break;
    }
  }
  if (e.k === 'pow' && asInteger(e.exp) === -2n && e.base.k === 'fn' && e.base.args.length === 1 &&
    (e.base.name === 'cos' || e.base.name === 'sin')) {
    // 1/cos(u)^2 = sec^2: tan(u)/a;  1/sin(u)^2 = csc^2: -cos(u)/(a sin(u))
    const name = e.base.name;
    return unlinear(e.base.args[0] as SymNode, (w) => (name === 'cos'
      ? fn('tan', w)
      : negateNode(divideNodes(fn('cos', w), fn('sin', w)))));
  }
  if (e.k === 'pow' && asInteger(e.exp) === -1n) {
    const b = e.base;
    if (b.k === 'add') {
      const coeffs = treeToUPolySym(b, v);
      if (coeffs !== null && coeffs.length === 3) {
        const [c0, c1, c2] = coeffs as [SymNode, SymNode, SymNode];
        if (isZeroNode(c1) && !isZeroNode(c2) && !containsGen(c2, v) && !containsGen(c0, v)) {
          const r = divideNodes(c0, c2);
          if (isOneNode(r)) return divideNodes(fn('atan', v), c2);
          const s = exactSignLocal(r);
          if (s !== null && s > 0) {
            const sq = pow(r, ratN(1n, 2n));
            return divideNodes(fn('atan', divideNodes(v, sq)), mul(c2, sq));
          }
        }
      }
    }
  }
  return null;
}

function exactSignLocal(t: SymNode): number | null {
  const r = asRational(t);
  if (r !== null) return r.n === 0n ? 0 : r.n > 0n ? 1 : -1;
  if (t.k === 'float') return t.v === 0 ? 0 : t.v > 0 ? 1 : -1;
  if (t.k === 'const' && (t.name === 'pi' || t.name === 'e')) return 1;
  return null;
}

/** Sign of a symbol-free tree: exact when decidable, else a margined float sign. */
function signOfConst(t: SymNode, ctx: RuleCtx): number | null {
  const s = simplifyNode(t, ctx).node;
  const e = exactSignLocal(s);
  if (e !== null) return e;
  const v = evalAt(s, new Map());
  if (v === null || !Number.isFinite(v) || Math.abs(v) < 1e-12) return null;
  return v > 0 ? 1 : -1;
}

/** Tabular integration for `P(v) * exp/sin/cos(a v + b)` with P polynomial. */
function tryTabular(e: SymNode, v: SymNode, ctx: RuleCtx, depth: number): SymNode | null {
  if (e.k !== 'mul' || depth > 4) return null;
  const trig = e.factors.find((f) =>
    (f.k === 'fn' && (f.name === 'exp' || f.name === 'sin' || f.name === 'cos') && f.args.length === 1) ||
    (f.k === 'pow' && f.base.k === 'const' && f.base.name === 'e'));
  if (trig === undefined) return null;
  const targ = trig.k === 'fn' ? (trig.args[0] as SymNode) : (trig as SymNode & { k: 'pow' }).exp;
  const la = linearArg(targ, v);
  if (la === null) return null;
  const rest = e.factors.filter((f) => f !== trig);
  if (rest.length === 0) return null;
  const P = treeToUPoly(mul(...rest), v, ctx.tick);
  if (P === null) return null;
  const n = upolyDegree(P);
  if (n < 1 || n > 12) return null;
  let deriv: SymNode = mul(...rest);
  let acc: SymNode = ZERO;
  // P*G1 - P'*G2 + P''*G3 - ...: G1 is the first antiderivative of the exp/sin/cos factor.
  const first = integrateNode(trig, v, ctx, depth + 1);
  if (first === null) return null;
  let g: SymNode = first;
  for (let k = 0; k <= n; k++) {
    const term = mul(deriv, g);
    acc = k % 2 === 0 ? add(acc, term) : add(acc, negateNode(term));
    if (k === n) break;
    deriv = diffNode(deriv, v, ctx);
    if (isZeroNode(deriv)) break;
    const next = integrateNode(g, v, ctx, depth + 1);
    if (next === null) return null;
    g = next;
  }
  return acc;
}

/** One step of parts for `v^n ln(v)` and products the table missed. */
function tryParts(e: SymNode, v: SymNode, ctx: RuleCtx, depth: number): SymNode | null {
  if (e.k !== 'mul' || depth > 4) return null;
  const ln = e.factors.find((f) => f.k === 'fn' && f.name === 'ln');
  if (ln === undefined) return null;
  const rest = e.factors.filter((f) => f !== ln);
  const dv = rest.length === 0 ? ONE : mul(...rest);
  if (!containsGen(dv, v)) return null;
  const V = integrateNode(dv, v, ctx, depth + 1);
  if (V === null) return null;
  const u = ln as SymNode;
  const du = diffNode(u, v, ctx);
  const back = integrateNode(mul(V, du), v, ctx, depth + 1);
  if (back === null) return null;
  return add(mul(u, V), negateNode(back));
}

/** Powers and products of sines and cosines by the standard reductions. */
function tryTrigPowers(e: SymNode, v: SymNode, ctx: RuleCtx, depth: number): SymNode | null {
  const factors = e.k === 'mul' ? e.factors : [e];
  let sinPow = 0;
  let cosPow = 0;
  let arg: SymNode | null = null;
  for (const f of factors) {
    let base = f;
    let pw = 1;
    if (f.k === 'pow' && f.base.k === 'fn') {
      const ei = asInteger(f.exp);
      if (ei === null || ei < 0n || ei > 12n) return null;
      base = f.base;
      pw = Number(ei);
    }
    if (base.k !== 'fn' || base.args.length !== 1) return null;
    if (base.name !== 'sin' && base.name !== 'cos') return null;
    if (arg === null) arg = base.args[0] as SymNode;
    else if (arg !== base.args[0]) return null;
    if (base.name === 'sin') sinPow += pw;
    else cosPow += pw;
  }
  if (arg === null || (sinPow === 0 && cosPow === 0)) return null;
  const l = linearArg(arg, v);
  if (l === null) return null;
  if (!isOneNode(l.a) || !isZeroNode(l.b)) {
    const w = symN('w__trig');
    const ew = substituteList(e, [[arg, w]]);
    const F = tryTrigPowers(ew, w, ctx, depth + 1);
    if (F === null) return null;
    return divideNodes(substituteList(F, [[w, arg]]), l.a);
  }
  const u = symN('u__trig');
  if (sinPow % 2 === 1 && sinPow >= 1) {
    const k = (sinPow - 1) / 2;
    let p: SymNode = ONE;
    const base = add(ONE, negateNode(mul(u, u)));
    for (let i = 0; i < k; i++) p = mul(p, base);
    const cps = cosPow === 0 ? ONE : pow(u, intN(cosPow));
    const H = mul(p, cps);
    const F = integrateNode(H, u, ctx, depth + 1);
    if (F === null) return null;
    return negateNode(substituteList(F, [[u, fn('cos', v)]]));
  }
  if (cosPow % 2 === 1 && cosPow >= 1) {
    const k = (cosPow - 1) / 2;
    let p: SymNode = ONE;
    const base = add(ONE, negateNode(mul(u, u)));
    for (let i = 0; i < k; i++) p = mul(p, base);
    const sps = sinPow === 0 ? ONE : pow(u, intN(sinPow));
    const H = mul(p, sps);
    const F = integrateNode(H, u, ctx, depth + 1);
    if (F === null) return null;
    return substituteList(F, [[u, fn('sin', v)]]);
  }
  if (sinPow > 0 || cosPow > 0) {
    const half = (t: SymNode, isSin: boolean): SymNode => {
      const dbl = mul(TWO, (t as SymNode & { k: 'fn' }).args[0] as SymNode);
      return isSin ? divideNodes(add(ONE, negateNode(fn('cos', dbl))), TWO) : divideNodes(add(ONE, fn('cos', dbl)), TWO);
    };
    let out: SymNode = ONE;
    if (sinPow > 0) {
      const t = factors.find((f) => {
        const b = f.k === 'pow' ? f.base : f;
        return b.k === 'fn' && b.name === 'sin';
      }) as SymNode;
      const b = (t.k === 'pow' ? t.base : t) as SymNode;
      let p: SymNode = ONE;
      for (let i = 0; i < sinPow / 2; i++) p = mul(p, half(b, true));
      out = mul(out, p);
    }
    if (cosPow > 0) {
      const t = factors.find((f) => {
        const b = f.k === 'pow' ? f.base : f;
        return b.k === 'fn' && b.name === 'cos';
      }) as SymNode;
      const b = (t.k === 'pow' ? t.base : t) as SymNode;
      let p: SymNode = ONE;
      for (let i = 0; i < cosPow / 2; i++) p = mul(p, half(b, false));
      out = mul(out, p);
    }
    const exp = expandNode(out, ctx.tick);
    return integrateNode(exp, v, ctx, depth + 1);
  }
  return null;
}

/** Substitution: divide by `g'` first, then check the rest is a function of `g`. */
function trySubstitution(e: SymNode, v: SymNode, ctx: RuleCtx, depth: number): SymNode | null {
  if (depth > 2) return null;
  const cands = substitutionCandidates(e, v);
  for (const g of cands.slice(0, 10)) {
    const dg = diffNode(g, v, ctx);
    if (isZeroNode(dg)) continue;
    const u = symN('u__subst');
    const ratio = togetherNode(divideNodes(e, dg), ctx).node;
    const replaced = substituteList(ratio, [[g, u]]);
    if (containsGen(replaced, v)) continue;
    const F = integrateNode(replaced, u, ctx, depth + 1);
    if (F === null) continue;
    return substituteList(F, [[u, g]]);
  }
  return null;
}

function substitutionCandidates(e: SymNode, v: SymNode): SymNode[] {
  const out: SymNode[] = [];
  const seen = new Set<number>();
  const walk = (t: SymNode): void => {
    if (seen.has(t.id) || !containsGen(t, v) || t === v) return;
    seen.add(t.id);
    if (t !== e && (t.k === 'fn' || (t.k === 'pow' && containsGen(t.base, v)))) {
      out.push(t);
    }
    switch (t.k) {
      case 'add': for (const c of t.terms) walk(c); break;
      case 'mul': for (const c of t.factors) walk(c); break;
      case 'pow': walk(t.base); walk(t.exp); break;
      case 'fn': for (const c of t.args) walk(c); break;
      default: break;
    }
  };
  walk(e);
  return out;
}

/** Rational functions by partial fractions (`log` and `atan` terms). */
function integratePoly(p: { c: readonly bigint[]; den: bigint }, v: SymNode): SymNode {
  let out: SymNode = ZERO;
  p.c.forEach((c, i) => {
    if (c === 0n) return;
    const coeff = ratN(c, p.den);
    out = i === 0 ? add(out, mul(coeff, v)) : add(out, mul(divideNodes(coeff, intN(i + 1)), pow(v, intN(i + 1))));
  });
  return out;
}

/** `den = lc·(v − r)^m`: the leading coefficient, root and multiplicity (exact check). */
function repeatedLinear(dp: { c: readonly bigint[]; den: bigint }, v: SymNode): { a: SymNode; root: SymNode; m: number } | null {
  void v;
  const d = dp.c.length - 1;
  if (d < 1) return null;
  const cd = dp.c[d] as bigint;
  const root = divideNodes(ratN(-(dp.c[d - 1] as bigint), dp.den), mul(intN(d), ratN(cd, dp.den)));
  const rr = asRational(root);
  if (rr === null) return null;
  for (let i = 0; i <= d; i++) {
    const bin = BigInt(binomInt(d, i));
    const pw = d - i;
    const num = cd * bin * (rr.n ** BigInt(pw)) * (pw % 2 === 0 ? 1n : -1n);
    const lhs = (dp.c[i] as bigint) * (rr.d ** BigInt(pw)) * dp.den;
    const rhs = num * dp.den;
    if (lhs !== rhs) return null;
  }
  return { a: ratN(cd, dp.den), root: ratN(rr.n, rr.d), m: d };
}

function binomInt(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
}

function tryRational(e: SymNode, v: SymNode, ctx: RuleCtx, depth: number): SymNode | null {
  void depth;
  const direct = treeToUPoly(e, v, ctx.tick);
  if (direct !== null) return integratePoly(direct, v);
  const apart = apartNode(e, v, ctx);
  if (apart === null) return null;
  const terms = apart.k === 'add' ? apart.terms : [apart];
  let out: SymNode = ZERO;
  for (const t of terms) {
    const q = integrateApartTerm(t, v, ctx);
    if (q === null) return null;
    out = add(out, q);
  }
  return out;
}

function integrateApartTerm(t: SymNode, v: SymNode, ctx: RuleCtx): SymNode | null {
  const poly = treeToUPoly(t, v, ctx.tick);
  if (poly !== null) return integratePoly(poly, v);
  if (t.k === 'mul' || t.k === 'pow' || t.k === 'fn' || t.k === 'sym') {
    const { num, den } = splitNumDen(t);
    if (den === null) return null;
    const dp = treeToUPoly(den, v, ctx.tick);
    if (dp === null) return null;
    const np = treeToUPoly(num, v, ctx.tick);
    const repeated = repeatedLinear(dp, v);
    if (repeated !== null && np !== null && upolyDegree(np) <= 0) {
      const c = np.c.length === 0 ? ZERO : ratN(np.c[0] as bigint, np.den);
      if (repeated.m === 1) {
        const scaled = divideNodes(c, repeated.a);
        return mul(scaled, fn('ln', fn('abs', add(v, negateNode(repeated.root)))));
      }
      const scaled = divideNodes(c, mul(repeated.a, intN(repeated.m - 1)));
      return mul(negateNode(scaled), pow(add(v, negateNode(repeated.root)), intN(1 - repeated.m)));
    }
    const d = upolyDegree(dp);
    if (d === 1) {
      if (np !== null && upolyDegree(np) <= 0) {
        const a = dp.c[1] as bigint;
        const b = dp.c[0] as bigint;
        const root = ratN(-b, a);
        const c = np.c.length === 0 ? ZERO : ratN(np.c[0] as bigint, np.den);
        const scaled = divideNodes(c, ratN(a, dp.den));
        return mul(scaled, fn('ln', fn('abs', add(v, negateNode(root)))));
      }
    }
    if (d === 2) {
      const a = Number(dp.c[2]);
      const b = Number(dp.c[1]);
      const c0 = Number(dp.c[0]);
      const disc = b * b - 4 * a * c0;
      if (disc < 0) {
        const h = divideNodes(ratN(dp.c[1] as bigint, dp.den), mul(TWO, ratN(dp.c[2] as bigint, dp.den)));
        const k = divideNodes(ratN(dp.c[0] as bigint, dp.den), ratN(dp.c[2] as bigint, dp.den));
        const np = treeToUPoly(num, v, ctx.tick);
        if (np === null) return null;
        const A = np.c.length > 1 ? ratN(np.c[1] as bigint, np.den) : ZERO;
        const B = np.c.length > 0 ? ratN(np.c[0] as bigint, np.den) : ZERO;
        const scale = ratN(dp.den, dp.c[2] as bigint);
        const dLog = mul(divideNodes(A, TWO), fn('ln', add(mul(v, v), add(mul(mul(TWO, h), v), k))));
        const rest = add(B, negateNode(mul(A, h)));
        const discNode = add(mul(k, intN(4)), negateNode(mul(mul(TWO, h), mul(TWO, h))));
        const sq = pow(divideNodes(discNode, intN(4)), ratN(1n, 2n));
        const dAtan = mul(divideNodes(rest, sq), fn('atan', divideNodes(add(v, h), sq)));
        return mul(scale, add(dLog, dAtan));
      }
    }
  }
  return null;
}

function splitNumDen(t: SymNode): { num: SymNode; den: SymNode | null } {
  if (t.k === 'pow' && asInteger(t.exp) === -1n) return { num: ONE, den: t.base };
  if (t.k === 'mul') {
    const num: SymNode[] = [];
    const den: SymNode[] = [];
    for (const f of t.factors) {
      if (f.k === 'pow' && asInteger(f.exp) !== null && (asInteger(f.exp) as bigint) < 0n) {
        const e = asInteger(f.exp) as bigint;
        den.push(e === -1n ? f.base : pow(f.base, intN(-e)));
      } else num.push(f);
    }
    if (den.length === 0) return { num: t, den: null };
    return { num: num.length === 0 ? ONE : mul(...num), den: mul(...den) };
  }
  return { num: t, den: null };
}

/** `1/sqrt(quadratic)` and `sqrt(quadratic)` by completing the square. */
function trySqrtQuad(e: SymNode, v: SymNode, ctx: RuleCtx): SymNode | null {
  const root = e.k === 'pow' ? e : e.k === 'fn' && e.name === 'sqrt' && e.args.length === 1
    ? pow(e.args[0] as SymNode, ratN(1n, 2n))
    : null;
  if (root === null || root.k !== 'pow') return null;
  const er = asRational(root.exp);
  if (er === null) return null;
  const isSqrt = er.n === 1n && er.d === 2n;
  const isInvSqrt = er.n === -1n && er.d === 2n;
  if (!isSqrt && !isInvSqrt) return null;
  const coeffs = treeToUPolySym(root.base, v);
  if (coeffs === null || coeffs.length !== 3) return null;
  const [c0, c1, c2] = coeffs as [SymNode, SymNode, SymNode];
  if (isZeroNode(c2) || freeSymbols(c2).size > 0 || freeSymbols(c1).size > 0 || freeSymbols(c0).size > 0) return null;
  const sa = signOfConst(c2, ctx);
  if (sa === null || sa === 0) return null;
  const h = divideNodes(c1, mul(TWO, c2));
  const k = add(c0, negateNode(divideNodes(mul(c1, c1), mul(intN(4), c2))));
  const sk = signOfConst(k, ctx);
  const vh = add(v, h);
  const inner = root.base;
  if (isInvSqrt) {
    if (sa > 0) {
      const sq = pow(divideNodes(inner, c2), ratN(1n, 2n));
      return divideNodes(fn('ln', fn('abs', add(vh, sq))), pow(c2, ratN(1n, 2n)));
    }
    if (sk !== null && sk > 0) {
      const kk = divideNodes(negateNode(k), c2);
      return divideNodes(fn('asin', divideNodes(vh, pow(kk, ratN(1n, 2n)))), pow(negateNode(c2), ratN(1n, 2n)));
    }
    return null;
  }
  if (sa > 0) {
    const sq = pow(inner, ratN(1n, 2n));
    const term1 = divideNodes(mul(vh, sq), TWO);
    const logArg = add(vh, divideNodes(sq, pow(c2, ratN(1n, 2n))));
    const term2 = divideNodes(mul(k, fn('ln', fn('abs', logArg))), mul(TWO, pow(c2, ratN(1n, 2n))));
    return add(term1, term2);
  }
  return null;
}

/* ------------------------------ definite ------------------------------ */

export interface DefiniteResult {
  readonly node: SymNode;
  /** False when a numeric fallback produced the value. */
  readonly exact: boolean;
  readonly notice?: 'numeric_fallback';
}

/**
 * Definite integral: the antiderivative when found and continuous on `[a, b]`, else
 * numeric quadrature with `numeric_fallback`. A pole inside is `divergent` unless the
 * quadrature converges on the split intervals.
 */
export function definiteIntegral(
  e: SymNode,
  v: SymNode,
  a: number,
  b: number,
  ctx: RuleCtx,
): DefiniteResult | { divergent: true; at: number } {
  const swap = a > b;
  const lo = swap ? b : a;
  const hi = swap ? a : b;
  // A pole of a `tan`, `1/cos` or `1/sin` inside the interval that the
  // integrand approaches like `1 / distance` makes the integral divergent.
  // The antiderivative must not be used across it (design 5.10, SYM-SM-14).
  for (const p of trigPolesBetween(e, v, lo, hi)) {
    if (growsLikeSimplePole(e, v, p)) return { divergent: true, at: p };
  }
  let F: SymNode | null;
  try {
    F = integrateNode(e, v, ctx);
  } catch (err) {
    if (err instanceof NonElementary) F = null;
    else throw err;
  }
  if (F !== null) {
    const poles = interiorPoles(e, v, lo, hi, ctx);
    if (poles.length === 0) {
      // An endpoint where the antiderivative is not finite is an improper integral: the
      // one-sided limit there decides it, and an infinite one diverges.
      const endValue = (x: number, side: LimitSide): SymNode | { divergent: true; at: number } | null => {
        const direct = simplifyNode(substituteList(F, [[v, numNode(x)]]), ctx).node;
        const dv = freeSymbols(direct).size === 0 ? evalAt(direct, new Map()) : 0;
        if (dv !== null && Number.isFinite(dv) && !containsInf(direct)) return direct;
        try {
          const L = limitNode(F, v, numNode(x), side, ctx);
          const lv = evalAt(L.node, new Map());
          if (lv !== null && Number.isFinite(lv) && !containsInf(L.node)) return L.node;
          return { divergent: true, at: x };
        } catch (err) {
          if (err instanceof Unsupported || err instanceof NoLimit) return null;
          throw err;
        }
      };
      const top = endValue(hi, 'below');
      const bottom = endValue(lo, 'above');
      if (top !== null && bottom !== null) {
        if ('divergent' in top) return top;
        if ('divergent' in bottom) return bottom;
        const s = simplifyNode(add(top, negateNode(bottom)), ctx).node;
        return { node: swap ? negateNode(s) : s, exact: true };
      }
    }
  }
  const num = quadSplit(e, v, lo, hi, ctx);
  if (num === null) {
    const poles = interiorPoles(e, v, lo, hi, ctx);
    return { divergent: true, at: poles.length > 0 ? (poles[0] as number) : (lo + hi) / 2 };
  }
  return { node: floatN(swap ? -num : num), exact: false, notice: 'numeric_fallback' };
}

function interiorPoles(e: SymNode, v: SymNode, lo: number, hi: number, ctx: RuleCtx): number[] {
  const tg = togetherNode(e, ctx).node;
  const { den } = splitNumDenFlat(tg);
  if (den === null) return [];
  const dp = treeToUPoly(den, v, ctx.tick);
  if (dp === null || upolyIsZero(dp) || upolyDegree(dp) <= 0) return [];
  const ivs = upolyIsolate(dp, ctx.tick);
  const out: number[] = [];
  for (const iv of ivs) {
    if (iv.mid > lo && iv.mid < hi) out.push(iv.mid);
  }
  return out;
}

function splitNumDenFlat(t: SymNode): { num: SymNode; den: SymNode | null } {
  if (t.k === 'pow' && asInteger(t.exp) !== null && (asInteger(t.exp) as bigint) < 0n) {
    const ex = asInteger(t.exp) as bigint;
    return { num: ONE, den: ex === -1n ? t.base : pow(t.base, intN(-ex)) };
  }
  if (t.k === 'mul') {
    const num: SymNode[] = [];
    const den: SymNode[] = [];
    for (const f of t.factors) {
      if (f.k === 'pow' && asInteger(f.exp) !== null && (asInteger(f.exp) as bigint) < 0n) {
        const ex = asInteger(f.exp) as bigint;
        den.push(ex === -1n ? f.base : pow(f.base, intN(-ex)));
      } else {
        num.push(f);
      }
    }
    if (den.length === 0) return { num: t, den: null };
    return { num: num.length === 0 ? ONE : mul(...num), den: mul(...den) };
  }
  return { num: t, den: null };
}

/** Adaptive Simpson with a Kahan-compensated stack, split at breakpoints. */
function quadSplit(e: SymNode, v: SymNode, lo: number, hi: number, ctx: RuleCtx): number | null {
  const breaks = quadBreaks(e, v);
  const pts = [lo, ...breaks.filter((x) => x > lo && x < hi), hi].sort((x, y) => x - y);
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const q = adaptiveSimpson(e, v, pts[i] as number, pts[i + 1] as number, ctx);
    if (q === null) return null;
    total += q;
  }
  return total;
}

function quadBreaks(e: SymNode, v: SymNode): number[] {
  const out: number[] = [];
  const walk = (t: SymNode): void => {
    if (t.k === 'fn' && (t.name === 'abs' || t.name === 'floor' || t.name === 'ceil' || t.name === 'sign') && t.args.length === 1) {
      const a = t.args[0] as SymNode;
      const coeffs = treeToUPolySym(a, v);
      if (coeffs !== null && coeffs.length === 2 && !isZeroNode(coeffs[1] as SymNode)) {
        const r = evalAt(divideNodes(negateNode(coeffs[0] as SymNode), coeffs[1] as SymNode), new Map());
        if (r !== null && Number.isFinite(r)) out.push(r);
      }
    }
    if (t.k === 'piecewise') {
      for (const cs of t.cases) {
        if (cs.when.c === 'rel') {
          const d = add(cs.when.l, negateNode(cs.when.r));
          const coeffs = treeToUPolySym(d, v);
          if (coeffs !== null && coeffs.length === 2 && !isZeroNode(coeffs[1] as SymNode)) {
            const r = evalAt(divideNodes(negateNode(coeffs[0] as SymNode), coeffs[1] as SymNode), new Map());
            if (r !== null && Number.isFinite(r)) out.push(r);
          }
        }
      }
    }
    switch (t.k) {
      case 'add': for (const c of t.terms) walk(c); break;
      case 'mul': for (const c of t.factors) walk(c); break;
      case 'pow': walk(t.base); break;
      case 'fn': for (const c of t.args) walk(c); break;
      default: break;
    }
  };
  walk(e);
  return out;
}

function adaptiveSimpson(e: SymNode, v: SymNode, a: number, b: number, ctx: RuleCtx): number | null {
  const f = (x: number): number | null => {
    const y = evalAt(e, new Map([[varName(v), x]]));
    return y === null || !Number.isFinite(y) ? null : y;
  };
  const fa = f(a);
  const fb = f(b);
  const m = (a + b) / 2;
  const fm = f(m);
  if (fa === null || fb === null || fm === null) return null;
  const whole = ((b - a) / 6) * (fa + 4 * fm + fb);
  let evals = 3;
  const stack: { a: number; b: number; fa: number; fb: number; fm: number; whole: number }[] = [{ a, b, fa, fb, fm, whole }];
  let total = 0;
  let comp = 0;
  while (stack.length > 0) {
    if (evals > 10000) return null;
    const s = stack.pop() as { a: number; b: number; fa: number; fb: number; fm: number; whole: number };
    ctx.tick.tick(2);
    const mid = (s.a + s.b) / 2;
    const lm = (s.a + mid) / 2;
    const rm = (mid + s.b) / 2;
    const flm = f(lm);
    const frm = f(rm);
    evals += 2;
    if (flm === null || frm === null) return null;
    const left = ((mid - s.a) / 6) * (s.fa + 4 * flm + s.fm);
    const right = ((s.b - mid) / 6) * (s.fm + 4 * frm + s.fb);
    const delta = left + right - s.whole;
    if (Math.abs(delta) < 1e-12 * Math.max(1, Math.abs(left + right))) {
      const y = left + right + delta / 15 - comp;
      const t = total + y;
      comp = t - total - y;
      total = t;
    } else if (s.b - s.a < 1e-14 * Math.max(1, Math.abs(s.a))) {
      return null;
    } else {
      stack.push(
        { a: mid, b: s.b, fa: s.fm, fb: s.fb, fm: frm, whole: right },
        { a: s.a, b: mid, fa: s.fa, fb: s.fm, fm: flm, whole: left },
      );
    }
  }
  return total;
}

/* ---------------------------------- limit ------------------------------------ */

export type LimitSide = 'both' | 'above' | 'below';

export interface LimitResult {
  readonly node: SymNode;
  readonly exact: boolean;
}

/**
 * Limits: continuity, rational cancellation, dominant terms at infinity, known standard
 * limits, L'Hopital up to 6 times, one-sided analysis through `u → 0+`. Throws
 * `Unsupported` when no route applies and a `NoLimit` (below) when the limit provably
 * does not exist.
 */
export class NoLimit extends Error {
  readonly detail: string;
  readonly left?: SymNode;
  readonly right?: SymNode;
  constructor(detail: string, left?: SymNode, right?: SymNode) {
    super(detail);
    this.name = 'NoLimit';
    this.detail = detail;
    if (left !== undefined) this.left = left;
    if (right !== undefined) this.right = right;
  }
}

export function limitNode(e: SymNode, v: SymNode, a: SymNode, side: LimitSide, ctx: RuleCtx): LimitResult {
  if (a.k === 'const' && a.name === 'inf') return limitInfinity(e, v, 1, ctx);
  if (isNegativeInf(a)) return limitInfinity(e, v, -1, ctx);
  const av = evalAt(a, new Map());
  if (av === null || !Number.isFinite(av)) throw new Unsupported('the limit point is not a number', 'limit');
  if (side === 'both' && hasJump(e)) {
    // abs, sign, floor, ceil, round, min, max and piecewise forms can jump: compare both sides.
    return limitBothSides(e, v, av, ctx);
  }
  if (side === 'both' && isTrigPoleAt(e, v, a, ctx)) {
    // The point is exactly a pole of a `tan`, `1/cos` or `1/sin` inside. A
    // float put into the function there gives a large finite number, which is
    // not a limit (SYM-SM-14): the two sides decide.
    const left = blowUpSign(e, v, av, -1);
    const right = blowUpSign(e, v, av, 1);
    if (left !== 0 && right !== 0) {
      const inf = (sign: 1 | -1): SymNode => (sign > 0 ? constN('inf') : negateNode(constN('inf')));
      if (left === right) return { node: inf(left), exact: true };
      throw new NoLimit(`The left limit is ${left > 0 ? 'inf' : '-inf'} and the right limit is ${right > 0 ? 'inf' : '-inf'}.`, inf(left), inf(right));
    }
  }
  if (side === 'both') {
    const direct = tryDirect(e, v, av, ctx);
    if (direct !== null) return direct;
    const cancelled = tryCancelled(e, v, av, ctx);
    if (cancelled !== null) return cancelled;
    const std = tryStandard(e, v, av, ctx);
    if (std !== null) return std;
    const lhop = tryLHopital(e, v, av, ctx, 0);
    if (lhop !== null) return lhop;
    return limitBothSides(e, v, av, ctx);
  }
  return limitOneSided(e, v, av, side === 'above' ? 1 : -1, ctx);
}

/** The trig functions whose zeros are poles here: `tan(u)` (zeros of `cos(u)`), and `cos`/`sin` under a negative power. */
function trigPoleArgs(t: SymNode, out: { u: SymNode; of: 'cos' | 'sin' }[] = []): { u: SymNode; of: 'cos' | 'sin' }[] {
  switch (t.k) {
    case 'fn':
      if (t.name === 'tan' && t.args.length === 1) out.push({ u: t.args[0] as SymNode, of: 'cos' });
      for (const a of t.args) trigPoleArgs(a, out);
      break;
    case 'add': for (const x of t.terms) trigPoleArgs(x, out); break;
    case 'mul': for (const x of t.factors) trigPoleArgs(x, out); break;
    case 'pow': {
      const ex = asRational(t.exp);
      if (ex !== null && ex.n < 0n && t.base.k === 'fn' && (t.base.name === 'cos' || t.base.name === 'sin') && t.base.args.length === 1) {
        out.push({ u: t.base.args[0] as SymNode, of: t.base.name });
      }
      trigPoleArgs(t.base, out);
      trigPoleArgs(t.exp, out);
      break;
    }
    case 'list': for (const x of t.items) trigPoleArgs(x, out); break;
    default: break;
  }
  return out;
}

/** True when `v = a` is exactly a zero of a `cos` or `sin` that the tree divides by. Decided in exact arithmetic. */
function isTrigPoleAt(e: SymNode, v: SymNode, a: SymNode, ctx: RuleCtx): boolean {
  for (const { u, of } of trigPoleArgs(e)) {
    if (!containsGen(u, v)) continue;
    const at = simplifyNode(divideNodes(substituteList(u, [[v, a]]), constN('pi')), ctx).node;
    const q = asRational(at);
    if (q === null) continue;
    // cos is zero at odd multiples of pi/2, sin at whole multiples of pi.
    if (of === 'cos' ? q.d === 2n : q.d === 1n) return true;
  }
  return false;
}

/**
 * Poles of the trig kind strictly inside `(lo, hi)`, for arguments that are
 * linear in `v` with number coefficients. Found numerically from two samples
 * of the argument.
 */
function trigPolesBetween(e: SymNode, v: SymNode, lo: number, hi: number): number[] {
  const name = varName(v);
  const out: number[] = [];
  for (const { u, of } of trigPoleArgs(e)) {
    if (!containsGen(u, v)) continue;
    const u0 = evalAt(u, new Map([[name, 0]]));
    const u1 = evalAt(u, new Map([[name, 1]]));
    const u2 = evalAt(u, new Map([[name, 2]]));
    if (u0 === null || u1 === null || u2 === null) continue;
    const slope = u1 - u0;
    if (!(Math.abs(slope) > 1e-12) || Math.abs(u2 - u1 - slope) > 1e-9 * Math.max(1, Math.abs(slope))) continue;
    const shift = of === 'cos' ? Math.PI / 2 : 0;
    const ua = u0 + slope * lo;
    const ub = u0 + slope * hi;
    const k0 = Math.ceil((Math.min(ua, ub) - shift) / Math.PI);
    const k1 = Math.floor((Math.max(ua, ub) - shift) / Math.PI);
    for (let k = k0; k <= k1 && out.length < 64; k++) {
      const x = (shift + k * Math.PI - u0) / slope;
      if (x > lo + 1e-12 && x < hi - 1e-12) out.push(x);
    }
  }
  return out.sort((x, y) => x - y);
}

/**
 * Which infinity the tree runs to as `v` nears `a` from one side: 1, -1, or 0
 * when it does not blow up there (a pole that cancels, as in `cos(x) tan(x)`).
 * Three samples, each a hundred times closer, must each be much larger.
 */
function blowUpSign(e: SymNode, v: SymNode, a: number, side: 1 | -1): 1 | -1 | 0 {
  const name = varName(v);
  const at = (h: number): number | null => evalAt(e, new Map([[name, a + side * h]]));
  const f1 = at(1e-2);
  const f2 = at(1e-4);
  const f3 = at(1e-6);
  if (f1 === null || f2 === null || f3 === null || !Number.isFinite(f2) || !Number.isFinite(f3)) return 0;
  if (!(Math.abs(f2) > 30 * Math.abs(f1)) || !(Math.abs(f3) > 30 * Math.abs(f2))) return 0;
  if (Math.sign(f2) !== Math.sign(f3)) return 0;
  return f3 > 0 ? 1 : -1;
}

/**
 * A pole is not integrable when the integrand grows at least like
 * `1 / distance`: then `|f(p + h)| * h` does not shrink as `h` does.
 */
function growsLikeSimplePole(e: SymNode, v: SymNode, p: number): boolean {
  const name = varName(v);
  const g = (h: number): number | null => {
    const a = evalAt(e, new Map([[name, p + h]]));
    const b = evalAt(e, new Map([[name, p - h]]));
    if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.max(Math.abs(a), Math.abs(b)) * h;
  };
  const far = g(1e-3);
  const near = g(1e-6);
  if (far === null || near === null) return false;
  return far > 1e-9 && near >= 0.5 * far;
}

/** True when the tree holds a function that can jump or has a corner. */
function hasJump(t: SymNode): boolean {
  switch (t.k) {
    case 'fn':
      if (t.name === 'abs' || t.name === 'sign' || t.name === 'floor' || t.name === 'ceil' || t.name === 'round' ||
        t.name === 'min' || t.name === 'max') return true;
      return t.args.some(hasJump);
    case 'piecewise': return true;
    case 'add': return t.terms.some(hasJump);
    case 'mul': return t.factors.some(hasJump);
    case 'pow': return hasJump(t.base) || hasJump(t.exp);
    case 'list': return t.items.some(hasJump);
    default: return false;
  }
}

function isNegativeInf(a: SymNode): boolean {
  if (a.k === 'float') return a.v === -Infinity;
  if (a.k === 'mul' && a.factors.length === 2) {
    const f0 = a.factors[0] as SymNode;
    const f1 = a.factors[1] as SymNode;
    return f0.k === 'int' && f0.v === -1n && f1.k === 'const' && f1.name === 'inf';
  }
  return false;
}

/** Dominant terms at ±infinity for rational functions, else `v = ±1/u`. */
function limitInfinity(e: SymNode, v: SymNode, sign: 1 | -1, ctx: RuleCtx, depth = 0): LimitResult {
  const p = treeToUPoly(e, v, ctx.tick);
  if (p !== null) {
    const d = upolyDegree(p);
    if (d <= 0) return { node: p.c.length === 0 ? ZERO : ratN(p.c[0] as bigint, p.den), exact: true };
    const lc = Number(p.c[d]) / Number(p.den);
    const s = lc > 0 ? 1 : -1;
    const end = d % 2 === 0 ? s : s * sign;
    return { node: end > 0 ? constN('inf') : negateNode(constN('inf')), exact: true };
  }
  const tg = togetherNode(e, ctx).node;
  const { num, den } = splitNumDenFlat(tg);
  if (den !== null) {
    const pn = treeToUPoly(num, v, ctx.tick);
    const pd = treeToUPoly(den, v, ctx.tick);
    if (pn !== null && pd !== null && !upolyIsZero(pd)) {
      const dn = upolyDegree(pn);
      const dd = upolyDegree(pd);
      if (dn < dd) return { node: ZERO, exact: true };
      const ratio = ratN((pn.c[dn] as bigint) * pd.den, (pd.c[dd] as bigint) * pn.den);
      if (dn === dd) return { node: ratio, exact: true };
      const sr = asRational(ratio) as { n: bigint; d: bigint };
      const s = (sr.n > 0n ? 1 : -1) * (sign === 1 ? 1 : (dn - dd) % 2 === 0 ? 1 : -1);
      return { node: s > 0 ? constN('inf') : negateNode(constN('inf')), exact: true };
    }
  }
  const lh = tryLHopitalInfinity(e, v, sign, ctx, depth);
  if (lh !== null) return lh;
  const u = symN('u__lim');
  const sub = substituteList(e, [[v, divideNodes(intN(sign), u)]]);
  try {
    return limitOneSided(sub, u, 0, 1, ctx);
  } catch (err) {
    if (err instanceof Unsupported && looksOscillatingAtInfinity(e, v, sign)) {
      throw new NoLimit('The function oscillates and has no limit.');
    }
    throw err;
  }
}

/**
 * Numerator and denominator of a product, also reading `b^(-k x)` as `1 / b^(k x)` so that
 * `x^2 * exp(-x)` is the quotient `x^2 / exp(x)`.
 */
function splitQuotient(t: SymNode): { num: SymNode; den: SymNode | null } {
  const flat = splitNumDenFlat(t);
  const factors = flat.num.k === 'mul' ? [...flat.num.factors] : [flat.num];
  const num: SymNode[] = [];
  const den: SymNode[] = flat.den === null ? [] : [flat.den];
  for (const f of factors) {
    if (f.k === 'pow' && f.exp.k === 'mul') {
      const lead = f.exp.factors[0];
      if (lead !== undefined && ((lead.k === 'int' && lead.v < 0n) || (lead.k === 'rat' && lead.n < 0n))) {
        den.push(pow(f.base, negateNode(f.exp)));
        continue;
      }
    }
    num.push(f);
  }
  if (den.length === 0) return { num: t, den: null };
  return { num: num.length === 0 ? ONE : mul(...num), den: mul(...den) };
}

/** `inf/inf` and `0/0` at infinity by L'Hopital on the original variable. */
function tryLHopitalInfinity(e: SymNode, v: SymNode, sign: 1 | -1, ctx: RuleCtx, depth: number): LimitResult | null {
  if (depth > 6) return null;
  let tg: SymNode;
  try {
    tg = togetherNode(e, ctx).node;
  } catch {
    return null;
  }
  const { num, den } = splitQuotient(tg);
  if (den === null) return null;
  const at = constN('inf');
  const point = sign > 0 ? at : mul(negateNode(ONE), at);
  const valueAt = (t: SymNode): number | null => {
    const folded = foldExtended(substituteList(t, [[v, point]]));
    if (folded === null) return null;
    if (folded.k === 'const' && folded.name === 'inf') return Infinity;
    if (isNegativeInf(folded)) return -Infinity;
    const x = evalAt(folded, new Map());
    return x === null || Number.isNaN(x) ? null : x;
  };
  const nv = valueAt(num);
  const dv = valueAt(den);
  if (nv === null || dv === null) return null;
  const infInf = !Number.isFinite(nv) && !Number.isFinite(dv);
  const zeroZero = Math.abs(nv) < 1e-12 && Math.abs(dv) < 1e-12;
  if (!infInf && !zeroZero) return null;
  try {
    const dn = diffNode(num, v, ctx);
    const dd = diffNode(den, v, ctx);
    if (isZeroNode(dd)) return null;
    return limitInfinity(divideNodes(dn, dd), v, sign, ctx, depth + 1);
  } catch (err) {
    if (err instanceof Unsupported) return null;
    throw err;
  }
}

/** Sampled far out, the values keep swinging instead of settling. */
function looksOscillatingAtInfinity(e: SymNode, v: SymNode, sign: 1 | -1): boolean {
  const ys: number[] = [];
  for (let j = 0; j < 80; j++) {
    const x = sign * (1000 + j * 0.37);
    const y = evalAt(e, new Map([[varName(v), x]]));
    if (y !== null && Number.isFinite(y)) ys.push(y);
  }
  if (ys.length < 40) return false;
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  if (max - min < 0.2 * Math.max(1, Math.abs(max), Math.abs(min))) return false;
  let changes = 0;
  for (let i = 2; i < ys.length; i++) {
    const d1 = (ys[i - 1] as number) - (ys[i - 2] as number);
    const d2 = (ys[i] as number) - (ys[i - 1] as number);
    if (d1 * d2 < 0) changes++;
  }
  return changes >= 4;
}

/** Exact node for a limit point or bound: an integer when whole, else a float. */
function numNode(a: number): SymNode {
  return Number.isInteger(a) && Math.abs(a) < 2 ** 53 ? intN(a) : floatN(a);
}

/** Direct substitution when defined and no denominator vanishes. */
function tryDirect(e: SymNode, v: SymNode, a: number, ctx: RuleCtx): LimitResult | null {
  const sub = simplifyNode(substituteList(e, [[v, numNode(a)]]), ctx).node;
  if (freeSymbols(sub).size > 0) return null;
  if (containsInf(sub)) return null;
  const val = evalAt(sub, new Map());
  if (val === null || !Number.isFinite(val)) return null;
  if (denominatorVanishes(e, v, a)) return null;
  return { node: floatClean(sub), exact: true };
}

function containsInf(t: SymNode): boolean {
  if (t.k === 'const' && t.name === 'inf') return true;
  if (t.k === 'add') return t.terms.some(containsInf);
  if (t.k === 'mul') return t.factors.some(containsInf);
  if (t.k === 'pow') return containsInf(t.base) || containsInf(t.exp);
  if (t.k === 'fn') return t.args.some(containsInf);
  return false;
}

function denominatorVanishes(e: SymNode, v: SymNode, a: number): boolean {
  const dens: SymNode[] = [];
  const walk = (t: SymNode): void => {
    if (t.k === 'pow' && asInteger(t.exp) !== null && (asInteger(t.exp) as bigint) < 0n) dens.push(t.base);
    if (t.k === 'add') for (const c of t.terms) walk(c);
    if (t.k === 'mul') for (const c of t.factors) walk(c);
    if (t.k === 'pow') walk(t.base);
    if (t.k === 'fn') for (const c of t.args) walk(c);
  };
  walk(e);
  return dens.some((d) => {
    const val = evalAt(d, new Map([[varName(v), a]]));
    return val !== null && Math.abs(val) < 1e-15;
  });
}

function floatClean(t: SymNode): SymNode {
  return mapNodes(t, (x) => {
    if (x.k === 'float' && Number.isInteger(x.v) && Math.abs(x.v) < 2 ** 53) return intN(x.v);
    return x;
  });
}

/** Cancel common factors, then direct substitution. */
function tryCancelled(e: SymNode, v: SymNode, a: number, ctx: RuleCtx): LimitResult | null {
  const tg = togetherNode(e, ctx);
  if (tg.node === e) return null;
  return tryDirect(tg.node, v, a, ctx);
}

/** Known standard limits with `g(v) → 0` or `g → ±inf`. */
function tryStandard(e: SymNode, v: SymNode, a: number, ctx: RuleCtx): LimitResult | null {
  const g0 = (g: SymNode): boolean => {
    const val = evalAt(g, new Map([[varName(v), a]]));
    return val !== null && Math.abs(val) < 1e-12;
  };
  const { num, den } = splitNumDenFlat(e);
  if (den !== null) {
    if (num.k === 'fn' && num.name === 'sin' && num.args.length === 1 && num.args[0] === den && g0(den)) {
      return { node: ONE, exact: true };
    }
    if (num.k === 'fn' && num.name === 'tan' && num.args.length === 1 && num.args[0] === den && g0(den)) {
      return { node: ONE, exact: true };
    }
    if (num.k === 'add' && num.terms.length === 2 && den !== null) {
      const hasExp = num.terms.find((t) => (t.k === 'fn' && t.name === 'exp') || (t.k === 'pow' && t.base.k === 'const' && t.base.name === 'e'));
      const hasOne = num.terms.find((t) => t.k === 'int' && t.v === -1n);
      if (hasExp !== undefined && hasOne !== undefined) {
        const he = hasExp as SymNode;
        const arg = he.k === 'fn' ? (he.args[0] as SymNode) : (he as SymNode & { k: 'pow' }).exp;
        if (arg === den && g0(den)) return { node: ONE, exact: true };
      }
    }
    if (num.k === 'fn' && num.name === 'ln' && num.args.length === 1) {
      const inner = num.args[0] as SymNode;
      if (inner.k === 'add' && inner.terms.length === 2 && inner.terms.includes(ONE) && inner.terms.includes(den) && g0(den)) {
        return { node: ONE, exact: true };
      }
    }
  }
  if (e.k === 'pow' && e.base.k === 'add') {
    const g = e.base.terms.find((t) => containsGen(t, v));
    const one = e.base.terms.find((t) => isOneNode(t));
    if (g !== undefined && one !== undefined && e.base.terms.length === 2) {
      const gv = evalAt(g, new Map([[varName(v), a]]));
      const ev = evalAt(e.exp, new Map([[varName(v), a]]));
      if (gv !== null && Math.abs(gv) < 1e-12 && ev !== null && !Number.isFinite(ev)) {
        const prod = simplifyNode(mul(e.exp, g), ctx).node;
        try {
          const L = limitNode(prod, v, floatN(a), 'both', ctx);
          return { node: pow(constN('e'), L.node), exact: L.exact };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** L'Hopital up to 6 times for `0/0` and `inf/inf`, after rewriting exotic forms. */
function tryLHopital(e: SymNode, v: SymNode, a: number, ctx: RuleCtx, depth: number): LimitResult | null {
  if (depth > 6) return null;
  const powInd = tryPowIndeterminate(e, v, a, ctx, depth);
  if (powInd !== null) return powInd;
  const rewritten = rewriteExotic(e, v, a, ctx);
  const { num, den } = splitNumDenFlat(rewritten ?? e);
  if (den === null) return null;
  const nv = evalAt(num, new Map([[varName(v), a]]));
  const dv = evalAt(den, new Map([[varName(v), a]]));
  if (nv === null || dv === null) return null;
  const zeroZero = Math.abs(nv) < 1e-12 && Math.abs(dv) < 1e-12;
  const infInf = !Number.isFinite(nv) && !Number.isFinite(dv);
  if (!zeroZero && !infInf) return null;
  let dn: SymNode;
  let dd: SymNode;
  try {
    dn = diffNode(num, v, ctx);
    dd = diffNode(den, v, ctx);
  } catch {
    return null;
  }
  const next = divideNodes(dn, dd);
  const direct = tryDirect(next, v, a, ctx);
  if (direct !== null) return direct;
  return tryLHopital(next, v, a, ctx, depth + 1);
}

/** `b^e` indeterminate forms through `exp(e·ln b)`; the exponent limit recurses. */
function tryPowIndeterminate(e: SymNode, v: SymNode, a: number, ctx: RuleCtx, depth: number): LimitResult | null {
  if (e.k !== 'pow') return null;
  const bv = evalAt(e.base, new Map([[varName(v), a]]));
  const ev = evalAt(e.exp, new Map([[varName(v), a]]));
  if (bv === null || ev === null) return null;
  const is1 = Math.abs(bv - 1) < 1e-12;
  const is0b = Math.abs(bv) < 1e-12;
  const isInfB = !Number.isFinite(bv);
  const is0e = Math.abs(ev) < 1e-12;
  const isInfE = !Number.isFinite(ev);
  if (!((is1 && isInfE) || (is0b && is0e) || (isInfB && is0e))) return null;
  const expo = mul(e.exp, fn('ln', e.base));
  const direct = tryDirect(expo, v, a, ctx);
  if (direct !== null) return { node: pow(constN('e'), direct.node), exact: direct.exact };
  const lhop = tryLHopital(expo, v, a, ctx, depth + 1);
  if (lhop !== null) return { node: pow(constN('e'), lhop.node), exact: lhop.exact };
  return null;
}

/** Rewrite `0·inf` into a quotient. */
function rewriteExotic(e: SymNode, v: SymNode, a: number, ctx: RuleCtx): SymNode | null {
  void ctx;
  if (e.k === 'mul') {
    const vals = e.factors.map((f) => evalAt(f, new Map([[varName(v), a]])));
    const zero = vals.findIndex((x) => x !== null && Math.abs(x) < 1e-12);
    const inf = vals.findIndex((x) => x !== null && !Number.isFinite(x));
    if (zero >= 0 && inf >= 0) {
      const zf = e.factors[zero] as SymNode;
      const infF = e.factors[inf] as SymNode;
      const rest = e.factors.filter((_, i) => i !== zero && i !== inf);
      return mul(divideNodes(zf, divideNodes(ONE, infF)), ...rest);
    }
  }
  return null;
}

/** Two-sided limit by comparing both sides; mismatch is `no_limit`. */
function limitBothSides(e: SymNode, v: SymNode, a: number, ctx: RuleCtx): LimitResult {
  let left: LimitResult | null = null;
  let right: LimitResult | null = null;
  try {
    left = limitOneSided(e, v, a, -1, ctx);
  } catch (err) {
    if (!(err instanceof Unsupported)) throw err;
  }
  try {
    right = limitOneSided(e, v, a, 1, ctx);
  } catch (err) {
    if (!(err instanceof Unsupported)) throw err;
  }
  if (left !== null && right !== null) {
    if (limitEqual(left.node, right.node)) return left;
    throw new NoLimit(`The left limit is ${limitText(left.node)} and the right limit is ${limitText(right.node)}.`, left.node, right.node);
  }
  if (left === null && right === null) {
    if (looksOscillating(e, v, a)) throw new NoLimit('The function oscillates near the point.', undefined, undefined);
    throw new Unsupported('this limit', 'limit');
  }
  throw new Unsupported('this limit from one side', 'limit');
}

function limitEqual(a: SymNode, b: SymNode): boolean {
  if (a === b) return true;
  const va = evalAt(a, new Map());
  const vb = evalAt(b, new Map());
  if (va !== null && vb !== null) {
    if (!Number.isFinite(va) || !Number.isFinite(vb)) return va === vb;
    return Math.abs(va - vb) < 1e-9 * Math.max(1, Math.abs(va));
  }
  return false;
}

function limitText(t: SymNode): string {
  const val = evalAt(t, new Map());
  if (val !== null) {
    if (val === Infinity) return 'inf';
    if (val === -Infinity) return '-inf';
    return `${val}`;
  }
  return 'a value';
}

function looksOscillating(e: SymNode, v: SymNode, a: number): boolean {
  const vals: number[] = [];
  for (let k = 2; k <= 10; k++) {
    for (const s of [1, -1]) {
      const x = a + s * Math.pow(10, -k);
      const y = evalAt(e, new Map([[varName(v), x]]));
      if (y !== null && Number.isFinite(y)) vals.push(y);
    }
  }
  if (vals.length < 6) return false;
  let changes = 0;
  for (let i = 2; i < vals.length; i++) {
    const d1 = (vals[i - 1] as number) - (vals[i - 2] as number);
    const d2 = (vals[i] as number) - (vals[i - 1] as number);
    if (d1 * d2 < 0) changes++;
  }
  return changes >= 3;
}

/**
 * One-sided limit: substitute `v = a + s·u`, decide `abs`/`sign`/`floor`/`piecewise`
 * at `0+`, then the standard routes in `u`.
 */
function limitOneSided(e: SymNode, v: SymNode, a: number, s: 1 | -1, ctx: RuleCtx): LimitResult {
  const u = symN('u__side');
  const sub = substituteList(e, [[v, add(floatN(a), mul(intN(s), u))]]);
  const decided = splitRootsZeroPlus(simplifyZeroPlus(sub, u, ctx), u, ctx);
  const r = zeroPlusCore(decided, u, ctx, 0);
  if (r !== null) return r;
  throw new Unsupported('this one-sided limit', 'limit');
}

/** The routes for `u → 0+`, in order: substitute, powers, cancel, standard, L'Hopital. */
function zeroPlusCore(e: SymNode, u: SymNode, ctx: RuleCtx, depth: number): LimitResult | null {
  if (depth > 6) return null;
  // Powers first: substituting u = 0 into 1^(1/u) would fold it to 1 before it is seen.
  const viaPow = tryPowIndeterminateZeroPlus(e, u, ctx, depth);
  if (viaPow !== null) return viaPow;
  const direct = tryDirectZeroPlus(e, u, ctx);
  if (direct !== null) return direct;
  const tg = togetherNode(e, ctx);
  const d2 = tryDirectZeroPlus(tg.node, u, ctx);
  if (d2 !== null) return d2;
  const std = tryStandardZeroPlus(tg.node, u, ctx);
  if (std !== null) return std;
  return tryLHopitalZeroPlus(tg.node, u, ctx, depth);
}

/** Value of `t` as `u → 0+` when it is a number or +-inf, else null. */
function zeroPlusValue(t: SymNode, u: SymNode, ctx: RuleCtx): number | null {
  void ctx;
  const sub = substituteList(t, [[u, ZERO]]);
  if (freeSymbols(sub).size > 0) return null;
  const folded = foldExtended(sub);
  if (folded === null) return null;
  if (folded.k === 'const' && folded.name === 'inf') return Infinity;
  if (isNegativeInf(folded)) return -Infinity;
  const val = evalAt(folded, new Map());
  return val === null || Number.isNaN(val) ? null : val;
}

/**
 * Near `u = 0+` every factor that is a power of `u` is positive, so a root of a product
 * splits: `sqrt((1 + u)/u^2)` is `sqrt(1 + u)/u`.
 */
function splitRootsZeroPlus(e: SymNode, u: SymNode, ctx: RuleCtx): SymNode {
  return mapNodes(e, (x) => {
    if (x.k !== 'pow') return x;
    const r = asRational(x.exp);
    if (r === null || r.d === 1n || !containsGen(x.base, u)) return x;
    let base = x.base;
    if (base.k !== 'mul') {
      try {
        base = togetherNode(base, ctx).node;
      } catch {
        return x;
      }
    }
    if (base.k !== 'mul') return x;
    const parts: SymNode[] = [];
    for (const f of base.factors) {
      if (f === u) parts.push(pow(u, x.exp));
      else if (f.k === 'pow' && f.base === u && f.exp.k === 'int') parts.push(pow(u, mul(f.exp, x.exp)));
      else if (!containsGen(f, u) || (subZero(f, u, ctx) ?? 0) > 0) parts.push(pow(f, x.exp));
      else return x;
    }
    return mul(...parts);
  });
}

/** `1^inf`, `0^0` and `inf^0` through `exp(exponent * ln(base))`. */
function tryPowIndeterminateZeroPlus(e: SymNode, u: SymNode, ctx: RuleCtx, depth: number): LimitResult | null {
  if (e.k !== 'pow' || !containsGen(e.exp, u)) return null;
  const b0 = zeroPlusValue(e.base, u, ctx);
  const x0 = zeroPlusValue(e.exp, u, ctx);
  if (b0 === null || x0 === null) return null;
  const one = Math.abs(b0 - 1) < 1e-12 && !Number.isFinite(x0);
  const zeroZero = Math.abs(b0) < 1e-12 && Math.abs(x0) < 1e-12;
  const infZero = !Number.isFinite(b0) && Math.abs(x0) < 1e-12;
  if (!one && !zeroZero && !infZero) return null;
  const expo = mul(e.exp, fn('ln', e.base));
  const inner = zeroPlusCore(expo, u, ctx, depth + 1);
  if (inner === null) return null;
  const folded = foldExtended(pow(constN('e'), inner.node));
  if (folded !== null && (isNumberNode(folded) || folded.k === 'const')) return { node: floatClean(folded), exact: inner.exact };
  return { node: pow(constN('e'), inner.node), exact: inner.exact };
}

/** Rewrite `abs`/`sign`/`floor`/`ceil`/`piecewise` using `u > 0` infinitesimal. */
function simplifyZeroPlus(e: SymNode, u: SymNode, ctx: RuleCtx): SymNode {
  return mapNodes(e, (x) => {
    if (x.k === 'fn' && x.args.length === 1) {
      const w = x.args[0] as SymNode;
      if (x.name === 'abs') {
        if (w === u) return u;
        const h = divideByU(w, u);
        if (h !== null) return mul(u, fn('abs', h));
        const w0 = subZero(w, u, ctx);
        if (w0 !== null) {
          if (w0 > 0) return w;
          if (w0 < 0) return negateNode(w);
        }
        return x;
      }
      if (x.name === 'sign') {
        if (w === u) return ONE;
        const w0 = subZero(w, u, ctx);
        if (w0 !== null && w0 !== 0) return w0 > 0 ? ONE : negateNode(ONE);
        const h = divideByU(w, u);
        if (h !== null) {
          const h0 = subZero(h, u, ctx);
          if (h0 !== null && h0 !== 0) return h0 > 0 ? ONE : negateNode(ONE);
        }
        return x;
      }
      if (x.name === 'floor' || x.name === 'ceil') {
        const w0 = subZero(w, u, ctx);
        if (w0 !== null && !Number.isInteger(w0)) {
          return intN(x.name === 'floor' ? Math.floor(w0) : Math.ceil(w0));
        }
        if (w0 !== null && Number.isInteger(w0)) {
          const c = intN(w0);
          const h = divideByU(add(w, negateNode(c)), u);
          if (h !== null) {
            const h0 = subZero(h, u, ctx);
            if (h0 !== null && h0 !== 0) {
              if (x.name === 'floor') return h0 > 0 ? c : intN(w0 - 1);
              return h0 > 0 ? intN(w0 + 1) : c;
            }
          }
        }
        return x;
      }
    }
    if (x.k === 'piecewise') {
      const out = decidePiecewise(x, u, ctx);
      return out ?? x;
    }
    return x;
  });
}

/** `w(0)` by substitution, or null when not a finite number. */
function subZero(w: SymNode, u: SymNode, ctx: RuleCtx): number | null {
  const s = simplifyNode(substituteList(w, [[u, ZERO]]), ctx).node;
  if (freeSymbols(s).size > 0) return null;
  const val = evalAt(s, new Map());
  return val !== null && Number.isFinite(val) ? val : null;
}

/** `h` when `w = u·h` structurally, else null. */
function divideByU(w: SymNode, u: SymNode): SymNode | null {
  if (w === u) return ONE;
  if (w.k !== 'mul') return null;
  const idx = w.factors.findIndex((f) => f === u);
  if (idx < 0) return null;
  const rest = w.factors.filter((_, i) => i !== idx);
  return rest.length === 0 ? ONE : mul(...rest);
}

function decidePiecewise(p: SymNode & { k: 'piecewise' }, u: SymNode, ctx: RuleCtx): SymNode | null {
  for (const cs of p.cases) {
    const d = decideCondZeroPlus(cs.when, u, ctx);
    if (d === null) return null;
    if (d) return cs.then;
  }
  return p.other ?? null;
}

function decideCondZeroPlus(c: SymCond, u: SymNode, ctx: RuleCtx): boolean | null {
  switch (c.c) {
    case 'true': return true;
    case 'false': return false;
    case 'not': {
      const v = decideCondZeroPlus(c.of, u, ctx);
      return v === null ? null : !v;
    }
    case 'and': {
      for (const o of c.of) {
        const v = decideCondZeroPlus(o, u, ctx);
        if (v === null) return null;
        if (!v) return false;
      }
      return true;
    }
    case 'or': {
      for (const o of c.of) {
        const v = decideCondZeroPlus(o, u, ctx);
        if (v === null) return null;
        if (v) return true;
      }
      return false;
    }
    case 'in': return null;
    case 'rel': {
      const d = add(c.l, negateNode(c.r));
      const d0 = subZero(d, u, ctx);
      if (d0 !== null && d0 !== 0) return relHolds(c.op, d0);
      if (d0 !== null && d0 === 0) {
        const s = approachSign(d, u, ctx);
        if (s === null) return c.op === '==' || c.op === '<=' || c.op === '>=' ? null : null;
        return relHolds(c.op, s);
      }
      return null;
    }
  }
}

function relHolds(op: string, d: number): boolean {
  if (op === '==') return d === 0;
  if (op === '!=') return d !== 0;
  if (op === '<') return d < 0;
  if (op === '<=') return d <= 0;
  if (op === '>') return d > 0;
  return d >= 0;
}

/** Sign of approach of `d(u)` as `u → 0+`, by derivatives at 0 (up to order 4). */
function approachSign(d: SymNode, u: SymNode, ctx: RuleCtx): number | null {
  let cur = d;
  for (let k = 1; k <= 4; k++) {
    try {
      cur = diffNode(cur, u, ctx);
    } catch {
      return null;
    }
    const v0 = subZero(cur, u, ctx);
    if (v0 !== null && v0 !== 0) return v0 > 0 ? 1 : -1;
    if (v0 === null) return null;
  }
  return null;
}

/** Direct substitution `u = 0` with extended-real arithmetic. */
function tryDirectZeroPlus(e: SymNode, u: SymNode, ctx: RuleCtx): LimitResult | null {
  void ctx;
  const sub = substituteList(e, [[u, ZERO]]);
  if (freeSymbols(sub).size > 0) return null;
  const folded = foldExtended(sub);
  if (folded === null) return null;
  if (folded.k === 'const' && folded.name === 'inf') return { node: folded, exact: true };
  if (folded.k === 'mul' && folded.factors.length === 2 && folded.factors[0] === negateNode(ONE) && folded.factors[1] === constN('inf')) {
    return { node: folded, exact: true };
  }
  const val = evalAt(folded, new Map());
  if (val === null || !Number.isFinite(val)) return null;
  return { node: floatClean(folded), exact: true };
}

/** Fold `inf` arithmetic; null on indeterminate forms. */
function foldExtended(t: SymNode): SymNode | null {
  const INF = constN('inf');
  const NEG_INF = mul(negateNode(ONE), INF);
  const isInf = (x: SymNode): boolean => x.k === 'const' && x.name === 'inf';
  const isNegInf = (x: SymNode): boolean =>
    x.k === 'mul' && x.factors.length === 2 && x.factors[0] === negateNode(ONE) && x.factors[1] === INF;
  const numVal = (x: SymNode): number | null => (isNumberNode(x) ? evalAt(x, new Map()) : null);
  const fromFloat = (v: number): SymNode | null => {
    if (Number.isFinite(v)) return floatN(v);
    if (v === Infinity) return INF;
    if (v === -Infinity) return NEG_INF;
    return null;
  };
  if (isInf(t) || isNegInf(t) || isNumberNode(t)) return t;
  if (t.k === 'const' && (t.name === 'e' || t.name === 'pi')) return t;
  if (t.k === 'add') {
    let hasInf = false;
    let hasNegInf = false;
    let sum: SymNode = ZERO;
    for (const term of t.terms) {
      const f = foldExtended(term);
      if (f === null) return null;
      if (isInf(f)) hasInf = true;
      else if (isNegInf(f)) hasNegInf = true;
      else sum = add(sum, f);
    }
    if (hasInf && hasNegInf) return null;
    if (hasInf) return INF;
    if (hasNegInf) return NEG_INF;
    return sum;
  }
  if (t.k === 'mul') {
    // Fold every factor first: a zero next to an infinite factor is indeterminate whatever the order.
    let sign = 1;
    let hasInf = false;
    let hasZero = false;
    let prod: SymNode = ONE;
    for (const f of t.factors) {
      const folded = foldExtended(f);
      if (folded === null) return null;
      if (isInf(folded)) hasInf = true;
      else if (isNegInf(folded)) {
        hasInf = true;
        sign = -sign;
      } else {
        const val = evalAt(folded, new Map());
        if (val === null) return null;
        if (val === 0) hasZero = true;
        else if (val < 0) sign = -sign;
        prod = mul(prod, folded);
      }
    }
    if (hasZero && hasInf) return null;
    if (hasZero) return ZERO;
    if (hasInf) return sign > 0 ? INF : NEG_INF;
    return prod;
  }
  if (t.k === 'pow') {
    const b = foldExtended(t.base);
    const ex = foldExtended(t.exp);
    if (b === null || ex === null) return null;
    const bv = b.k === 'const' && b.name === 'e' ? Math.E : b.k === 'const' && b.name === 'pi' ? Math.PI : numVal(b);
    const ev = numVal(ex);
    if (bv !== null && ev !== null) {
      const val = Math.pow(bv, ev);
      return Number.isNaN(val) ? null : fromFloat(val);
    }
    if (isInf(b) && ev !== null) {
      if (ev > 0) return INF;
      if (ev < 0) return ZERO;
      return null;
    }
    if (bv !== null && (isInf(ex) || isNegInf(ex))) {
      const up = isInf(ex);
      if (bv === 1 || bv < 0) return null;
      if (bv === 0) return up ? ZERO : INF;
      return (bv > 1) === up ? INF : ZERO;
    }
    return t;
  }
  if (t.k === 'fn') {
    const args: SymNode[] = [];
    for (const a of t.args) {
      const f = foldExtended(a);
      if (f === null) return null;
      args.push(f);
    }
    if (args.every(isNumberNode)) {
      const vals = args.map((a) => evalAt(a, new Map()) as number);
      const v = evalFnLimit(t.name, vals);
      return v === null ? null : fromFloat(v);
    }
    const a0 = args[0];
    if (args.length === 1 && a0 !== undefined && (isInf(a0) || isNegInf(a0))) {
      const up = isInf(a0);
      switch (t.name) {
        case 'exp': return up ? INF : ZERO;
        case 'ln': case 'log10': case 'log2': case 'sqrt': return up ? INF : null;
        case 'abs': case 'cosh': return INF;
        case 'sinh': return up ? INF : NEG_INF;
        case 'atan': return up ? mul(HALF_PI_COEFF, constN('pi')) : mul(negateNode(HALF_PI_COEFF), constN('pi'));
        case 'tanh': return up ? ONE : negateNode(ONE);
        default: return null;
      }
    }
    return t;
  }
  return t;
}

const HALF_PI_COEFF = ratN(1n, 2n);

function evalFnLimit(name: SymFn, args: readonly number[]): number | null {
  const a = args[0] as number;
  switch (name) {
    case 'sin': return Math.sin(a);
    case 'cos': return Math.cos(a);
    case 'tan': return Math.tan(a);
    case 'exp': return Math.exp(a);
    case 'ln': return a > 0 ? Math.log(a) : a === 0 ? -Infinity : NaN;
    case 'sqrt': return a >= 0 ? Math.sqrt(a) : NaN;
    case 'abs': return Math.abs(a);
    default: return null;
  }
}

function tryStandardZeroPlus(e: SymNode, u: SymNode, ctx: RuleCtx): LimitResult | null {
  return tryStandard(e, u, 0, ctx);
}

function tryLHopitalZeroPlus(e: SymNode, u: SymNode, ctx: RuleCtx, depth: number): LimitResult | null {
  if (depth > 6) return null;
  let { num, den } = splitNumDenFlat(e);
  if (den === null) {
    // 0 * inf becomes inf / (1/zero).
    if (e.k !== 'mul') return null;
    const vals = e.factors.map((f) => zeroPlusValue(f, u, ctx));
    const zi = vals.findIndex((x) => x !== null && Math.abs(x) < 1e-12);
    const ii = vals.findIndex((x) => x !== null && !Number.isFinite(x));
    if (zi < 0 || ii < 0) return null;
    const rest = e.factors.filter((_f, i) => i !== zi && i !== ii);
    num = mul(e.factors[ii] as SymNode, ...rest);
    den = pow(e.factors[zi] as SymNode, intN(-1));
  }
  const nv = zeroPlusValue(num, u, ctx);
  const dv = zeroPlusValue(den, u, ctx);
  if (nv === null || dv === null) return null;
  const zeroZero = Math.abs(nv) < 1e-12 && Math.abs(dv) < 1e-12;
  const infInf = !Number.isFinite(nv) && !Number.isFinite(dv);
  if (!zeroZero && !infInf) return null;
  let dn: SymNode;
  let dd: SymNode;
  try {
    dn = diffNode(num, u, ctx);
    dd = diffNode(den, u, ctx);
  } catch {
    return null;
  }
  if (isZeroNode(dd)) return null;
  let next = divideNodes(dn, dd);
  try {
    next = togetherNode(next, ctx).node;
  } catch {
    void 0;
  }
  return zeroPlusCore(next, u, ctx, depth + 1);
}
