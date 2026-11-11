/**
 * The rule engine and `Simplify` (cas/design.md 5.7): pure rewrite rules, the Simplify
 * candidate search, `Expand`, `Together`/cancel, partial fractions, `Rationalize`,
 * `CompleteSquare`, the trig forms, `Evaluate` and `Factor`.
 */
import type { Assumptions } from './assume';
import { EMPTY_ASSUMPTIONS, isNonneg, isPositive, signOf } from './assume';
import type { SymCond, SymFn, SymNode } from './node';
import {
  ONE, TWO, ZERO, add, andCond, asInteger, asRational, bigGcd, compareNodes, constN, divideNodes,
  factoredIntegerNode, floatN, fn, freeSymbols, intN, isExactNumber, isNumberNode, isOneNode, isZeroNode,
  LimitExceeded, mapNodes, mul, negateNode, nodeCount, pow, ratN, rel, symN, toFloat,
} from './node';
import { nearestFraction, primeFactorsBig } from './num';
import type { MPoly, Ticker } from './poly';
import {
  mpolyAdd, mpolyDivMod, mpolyFactor, mpolyGcd, mpolyIsZero, mpolyMul, mpolyNormalize, mpolyToTree,
  treeToMPoly, treeToUPoly, treeToUPolySym, upolyAdd, upolyDegree, upolyDivMod, upolyFactor, upolyGcd,
  upolyIsZero, upolyMul, upolyToTree, upolyFromInts,
} from './poly';
import type { UPoly } from './poly';
import { condText, toText } from './print';

/* ------------------------------- rule engine --------------------------------- */

export interface Rule {
  readonly id: string;
  readonly on: 'add' | 'mul' | 'pow' | 'fn' | 'rel' | 'any';
  /** True for rewrites worth showing to a learner. */
  readonly teaching: boolean;
  apply(n: SymNode, ctx: RuleCtx): SymNode | null;
}

export interface RuleCtx {
  readonly assume: Assumptions;
  readonly tick: Ticker;
  note(rule: string, before: SymNode, after: SymNode): void;
  addExcluded(c: SymCond): void;
}

export function ruleCtx(
  assume: Assumptions = EMPTY_ASSUMPTIONS,
  tick?: Ticker,
  note?: (rule: string, before: SymNode, after: SymNode) => void,
  addExcluded?: (c: SymCond) => void,
): RuleCtx {
  return {
    assume,
    tick: tick ?? { tick(): void {} },
    note: note ?? ((): void => {}),
    addExcluded: addExcluded ?? ((): void => {}),
  };
}

/** Run rule passes bottom-up until nothing changes or the step limit is reached. */
export function runPasses(n: SymNode, rules: readonly Rule[], ctx: RuleCtx, maxSteps = 10000): SymNode {
  let cur = n;
  let steps = 0;
  for (;;) {
    let changed = false;
    const once = (t: SymNode): SymNode => {
      for (const r of rules) {
        if (r.on !== 'any' && r.on !== t.k) continue;
        ctx.tick.tick(1);
        steps++;
        if (steps > maxSteps) return t;
        const out = r.apply(t, ctx);
        if (out !== null && out !== t) {
          ctx.note(r.id, t, out);
          changed = true;
          return out;
        }
      }
      return t;
    };
    cur = mapNodes(cur, once);
    if (!changed) return cur;
  }
}

/* ---------------------------------- rules ------------------------------------ */

function asBaseExpPow(t: SymNode): { base: SymNode; exp: SymNode } | null {
  return t.k === 'pow' ? { base: t.base, exp: t.exp } : null;
}

/** `(x^a)^b → x^(a b)` when `x > 0` or `b` is an integer (integers are canonical already). */
const powPower: Rule = {
  id: 'pow.power',
  on: 'pow',
  teaching: true,
  apply(n, ctx) {
    const pe = asBaseExpPow(n);
    if (pe === null) return null;
    const inner = asBaseExpPow(pe.base);
    if (inner === null) return null;
    if (asInteger(pe.exp) !== null) return null;
    if (!isPositive(inner.base, ctx.assume)) return null;
    return pow(inner.base, mul(inner.exp, pe.exp));
  },
};

/** `sqrt(x^2) → abs(x)`, or `x` when `x >= 0`. */
const rootsSquare: Rule = {
  id: 'roots.square',
  on: 'pow',
  teaching: true,
  apply(n, ctx) {
    const pe = asBaseExpPow(n);
    if (pe === null) return null;
    const er = asRational(pe.exp);
    if (er === null || er.n !== 1n || er.d !== 2n) return null;
    const ib = asBaseExpPow(pe.base);
    if (ib === null) return null;
    const ie = asInteger(ib.exp);
    if (ie === null || ie !== 2n) return null;
    if (isNonneg(ib.base, ctx.assume)) return ib.base;
    return fn('abs', ib.base);
  },
};

/** Pull perfect squares out of `sqrt(n)` for integer n: `sqrt(12) → 2 sqrt(3)`. */
const rootsPull: Rule = {
  id: 'roots.pull',
  on: 'pow',
  teaching: true,
  apply(n, ctx) {
    void ctx;
    const pe = asBaseExpPow(n);
    if (pe === null) return null;
    const er = asRational(pe.exp);
    if (er === null || er.n !== 1n || er.d !== 2n) return null;
    if (pe.base.k !== 'int' || pe.base.v <= 1n) return null;
    const v = pe.base.v;
    let outside = 1n;
    let inside = 1n;
    let rest = v;
    let f = 2n;
    while (f * f <= rest && f < 1000000n) {
      let count = 0;
      while (rest % f === 0n) {
        rest /= f;
        count++;
      }
      outside *= f ** BigInt(Math.floor(count / 2));
      if (count % 2 === 1) inside *= f;
      f += f === 2n ? 1n : 2n;
    }
    inside *= rest;
    if (outside === 1n) return null;
    const inner = inside === 1n ? null : pow(intN(inside), pe.exp);
    const o = intN(outside);
    return inner === null ? o : mul(o, inner);
  },
};

/** True when no free symbol is known-complex (real-by-default reading). */
function allReal(t: SymNode, ctx: RuleCtx): boolean {
  for (const s of freeSymbols(t)) {
    if ((ctx.assume.domains.get(s) ?? 'real') === 'complex') return false;
  }
  return true;
}

/** `ln(a b) → ln a + ln b` when `a, b > 0`; `exp(ln x) → x`; `ln(exp x) → x` (real). */
const logRules: Rule = {
  id: 'log.split',
  on: 'fn',
  teaching: true,
  apply(n, ctx) {
    if (n.k !== 'fn') return null;
    if (n.name === 'exp' && n.args.length === 1) {
      const a = n.args[0] as SymNode;
      if (a.k === 'fn' && a.name === 'ln' && a.args.length === 1 && isPositive(a.args[0] as SymNode, ctx.assume)) {
        return a.args[0] as SymNode;
      }
    }
    if (n.name === 'ln' && n.args.length === 1) {
      const a = n.args[0] as SymNode;
      if (a.k === 'fn' && a.name === 'exp' && a.args.length === 1) {
        const inner = a.args[0] as SymNode;
        if (allReal(inner, ctx)) return inner;
      }
      if (a.k === 'pow' && a.base.k === 'const' && a.base.name === 'e') {
        if (allReal(a.exp, ctx)) return a.exp;
      }
      if (a.k === 'mul') {
        const parts = a.factors;
        if (parts.every((p) => isPositive(p, ctx.assume))) {
          return add(...parts.map((p) => fn('ln', p)));
        }
      }
      if (a.k === 'pow') {
        const e = asInteger(a.exp);
        if (e !== null && isPositive(a.base, ctx.assume)) return mul(a.exp, fn('ln', a.base));
      }
    }
    return null;
  },
};

/** `e^(ln x) → x` when `x > 0` (the power form of `exp`). */
const logExpPow: Rule = {
  id: 'log.split',
  on: 'pow',
  teaching: true,
  apply(n, ctx) {
    if (n.k !== 'pow') return null;
    if (!(n.base.k === 'const' && n.base.name === 'e')) return null;
    const a = n.exp;
    if (a.k === 'fn' && a.name === 'ln' && a.args.length === 1 && isPositive(a.args[0] as SymNode, ctx.assume)) {
      return a.args[0] as SymNode;
    }
    return null;
  },
};

/** `abs(a b) → abs(a) abs(b)`; `abs(x) → x` when `x >= 0`, `-x` when `x <= 0`. */
const absRules: Rule = {
  id: 'abs.split',
  on: 'fn',
  teaching: true,
  apply(n, ctx) {
    if (n.k !== 'fn' || n.name !== 'abs' || n.args.length !== 1) return null;
    const a = n.args[0] as SymNode;
    const s = signOf(a, ctx.assume);
    if (s === 'pos' || s === 'nonneg' || s === 'zero') return a;
    if (s === 'neg' || s === 'nonpos') return negateNode(a);
    if (a.k === 'mul') return mul(...a.factors.map((p) => fn('abs', p)));
    return null;
  },
};

/** `i` powers: `i^2 → -1`, cycling integer exponents. */
const complexPow: Rule = {
  id: 'complex.ipow',
  on: 'pow',
  teaching: false,
  apply(n) {
    if (n.k !== 'pow') return null;
    if (!(n.base.k === 'const' && n.base.name === 'i')) return null;
    const e = asInteger(n.exp);
    if (e === null) return null;
    const r = ((e % 4n) + 4n) % 4n;
    if (r === 0n) return ONE;
    if (r === 1n) return n.base;
    if (r === 2n) return intN(-1);
    return mul(intN(-1), n.base);
  },
};

/** Pythagoras: `sin(x)^2 + cos(x)^2 → 1` and `1 - sin(x)^2 → cos(x)^2`. */
const trigPythagoras: Rule = {
  id: 'trig.pythagoras',
  on: 'add',
  teaching: true,
  apply(n) {
    if (n.k !== 'add') return null;
    const sq = (t: SymNode): { f: string; arg: SymNode; coeff: SymNode } | null => {
      let coeff: SymNode = ONE;
      let body = t;
      if (t.k === 'mul' && t.factors.length === 2 && isNumberNode(t.factors[0] as SymNode)) {
        coeff = t.factors[0] as SymNode;
        body = t.factors[1] as SymNode;
      }
      if (body.k !== 'pow') return null;
      const e = asInteger(body.exp);
      if (e === null || e !== 2n) return null;
      if (body.base.k !== 'fn' || body.base.args.length !== 1) return null;
      if (body.base.name !== 'sin' && body.base.name !== 'cos') return null;
      return { f: body.base.name, arg: body.base.args[0] as SymNode, coeff };
    };
    for (let i = 0; i < n.terms.length; i++) {
      for (let j = i + 1; j < n.terms.length; j++) {
        const a = sq(n.terms[i] as SymNode);
        const b = sq(n.terms[j] as SymNode);
        if (a === null || b === null) continue;
        if (a.f === b.f || a.arg !== b.arg) continue;
        if (!isOneNode(a.coeff) || !isOneNode(b.coeff)) continue;
        const rest = n.terms.filter((_, k) => k !== i && k !== j);
        return add(ONE, ...rest);
      }
    }
    for (let i = 0; i < n.terms.length; i++) {
      if (!isOneNode(n.terms[i] as SymNode)) continue;
      for (let j = 0; j < n.terms.length; j++) {
        if (j === i) continue;
        const b = sq(n.terms[j] as SymNode);
        if (b === null) continue;
        if (!(b.coeff.k === 'int' && b.coeff.v === -1n)) continue;
        const other = b.f === 'sin' ? 'cos' : 'sin';
        const rest = n.terms.filter((_, k) => k !== i && k !== j);
        return add(pow(fn(other, b.arg), intN(2)), ...rest);
      }
    }
    return null;
  },
};

/** `2 sin(x) cos(x) → sin(2x)`. */
const trigDouble: Rule = {
  id: 'trig.double',
  on: 'mul',
  teaching: true,
  apply(n) {
    if (n.k !== 'mul') return null;
    const sins: SymNode[] = [];
    const coss: SymNode[] = [];
    let two = false;
    const rest: SymNode[] = [];
    for (const f of n.factors) {
      if (f.k === 'int' && f.v === 2n) {
        two = true;
        continue;
      }
      if (f.k === 'fn' && f.name === 'sin' && f.args.length === 1) {
        sins.push(f);
        continue;
      }
      if (f.k === 'fn' && f.name === 'cos' && f.args.length === 1) {
        coss.push(f);
        continue;
      }
      rest.push(f);
    }
    if (!two || sins.length === 0 || coss.length === 0) return null;
    const s = sins[0] as SymNode & { k: 'fn' };
    const c = coss.find((x) => (x as SymNode & { k: 'fn' }).args[0] === s.args[0]);
    if (c === undefined) return null;
    return mul(fn('sin', mul(TWO, s.args[0] as SymNode)), ...sins.slice(1), ...coss.filter((x) => x !== c), ...rest);
  },
};

const SIMPLIFY_RULES: readonly Rule[] = [powPower, rootsSquare, rootsPull, logRules, logExpPow, absRules, complexPow, trigPythagoras, trigDouble];

/* ---------------------------------- expand ----------------------------------- */

/**
 * Deterministic expansion: distribute products over sums, expand integer powers,
 * recurse into function arguments. Throws `LimitExceeded` past `maxTerms` terms.
 */
export function expandNode(t: SymNode, tick: Ticker, maxTerms = 5000): SymNode {
  /** Distribute the product of two already-expanded sums term by term. */
  const mulExpanded = (a: SymNode, b: SymNode): SymNode => {
    const pa = a.k === 'add' ? a.terms : [a];
    const pb = b.k === 'add' ? b.terms : [b];
    if (pa.length * pb.length > maxTerms * 4) throw new LimitExceeded('terms');
    const out: SymNode[] = [];
    for (const ta of pa) {
      for (const tb of pb) {
        out.push(mul(ta, tb));
        tick.tick(1);
      }
    }
    const r = add(...out);
    if (r.k === 'add' && r.terms.length > maxTerms) throw new LimitExceeded('terms');
    return r;
  };
  const go = (x: SymNode): SymNode => {
    tick.tick(1);
    switch (x.k) {
      case 'add': {
        const terms = x.terms.map(go);
        const flat: SymNode[] = [];
        for (const term of terms) {
          if (term.k === 'add') flat.push(...term.terms);
          else flat.push(term);
        }
        if (flat.length > maxTerms) throw new LimitExceeded('terms');
        return add(...flat);
      }
      case 'mul': {
        const factors = x.factors.map(go);
        let acc: SymNode[] = [ONE];
        for (const f of factors) {
          const parts = f.k === 'add' ? f.terms : [f];
          const next: SymNode[] = [];
          for (const a of acc) {
            for (const b of parts) {
              next.push(mul(a, b));
              tick.tick(1);
            }
          }
          if (next.length > maxTerms) throw new LimitExceeded('terms');
          acc = next;
        }
        return add(...acc);
      }
      case 'pow': {
        const b = go(x.base);
        const e = asInteger(x.exp);
        if (e !== null && e >= 0n && b.k === 'add') {
          if (e === 0n) return ONE;
          let acc: SymNode = ONE;
          let base: SymNode = b;
          let k = e;
          while (k > 0n) {
            if ((k & 1n) === 1n) acc = mulExpanded(acc, base);
            k >>= 1n;
            if (k > 0n) base = mulExpanded(base, base);
          }
          return acc;
        }
        return pow(b, go(x.exp));
      }
      case 'fn': {
        const args = x.args.map(go);
        return args.every((a, i) => a === x.args[i]) ? x : fn(x.name, ...args);
      }
      default: return x;
    }
  };
  const out = go(t);
  if (out.k === 'add' && out.terms.length > maxTerms) throw new LimitExceeded('terms');
  return out;
}

/* ------------------------------- together ------------------------------------ */

function collectAtoms(t: SymNode): SymNode[] {
  const atoms: SymNode[] = [];
  const seen = new Set<number>();
  const walk = (x: SymNode): void => {
    if (seen.has(x.id)) return;
    seen.add(x.id);
    switch (x.k) {
      case 'add': for (const c of x.terms) walk(c); return;
      case 'mul': for (const c of x.factors) walk(c); return;
      case 'pow': {
        const e = asInteger(x.exp);
        if (e !== null) {
          walk(x.base);
          return;
        }
        atoms.push(x);
        return;
      }
      case 'int': case 'rat': return;
      default: atoms.push(x); return;
    }
  };
  walk(t);
  atoms.sort(compareNodes);
  return atoms;
}

/**
 * Common-denominator form with the gcd of numerator and denominator cancelled.
 * Returns the node plus the cancelled factor's zero conditions (`excluded`).
 */
export function togetherNode(t: SymNode, ctx: RuleCtx): { node: SymNode; excluded: SymCond[] } {
  const atoms = collectAtoms(t);
  const syms = [...freeSymbols(t)].map((s) => symN(s)).sort(compareNodes);
  const gens = [...syms, ...atoms.filter((a) => a.k !== 'sym')];
  if (gens.length === 0) return { node: t, excluded: [] };
  const frac = treeToFraction(t, gens, ctx.tick);
  if (frac === null) return { node: t, excluded: [] };
  const g = mpolyGcd(frac.num, frac.den, ctx.tick);
  let num = frac.num;
  let den = frac.den;
  const excluded: SymCond[] = [];
  if (!mpolyIsZero(g) && g.terms.size > 1) {
    const qn = mpolyDivMod(num, g, ctx.tick);
    const qd = mpolyDivMod(den, g, ctx.tick);
    if (mpolyIsZero(qn.r) && mpolyIsZero(qd.r)) {
      num = qn.q;
      den = qd.q;
      excluded.push(...excludedFromFactor(g, gens, ctx));
      ctx.note('rational.cancel', t, mpolyToTree(num));
    }
  } else if (!mpolyIsZero(g) && g.terms.size === 1) {
    const qn = mpolyDivMod(num, g, ctx.tick);
    const qd = mpolyDivMod(den, g, ctx.tick);
    if (mpolyIsZero(qn.r) && mpolyIsZero(qd.r)) {
      num = qn.q;
      den = qd.q;
      const key = [...g.terms.keys()][0] as string;
      if (key.split(',').some((x) => x !== '0')) excluded.push(...excludedFromFactor(g, gens, ctx));
    }
  }
  const node = mpolyIsOne(den) ? mpolyToTree(num) : divideNodes(mpolyToTree(num), mpolyToTree(den));
  return { node, excluded };
}

function mpolyIsOne(p: { terms: ReadonlyMap<string, bigint>; den: bigint }): boolean {
  if (p.terms.size !== 1) return false;
  const e = [...p.terms.entries()][0] as [string, bigint];
  return e[1] === p.den && e[0].split(',').every((x) => x === '0');
}

function treeToFraction(t: SymNode, gens: readonly SymNode[], tick: Ticker): { num: MPoly; den: MPoly } | null {
  const asPoly = (x: SymNode): { num: MPoly; den: MPoly } | null => {
    const direct = treeToMPoly(x, gens, tick);
    if (direct !== null) return { num: direct, den: mpolyOne(gens) };
    if (x.k === 'pow') {
      const e = asInteger(x.exp);
      if (e !== null && e < 0n) {
        const b = treeToMPoly(x.base, gens, tick);
        if (b === null) return null;
        return { num: mpolyOne(gens), den: mpolyPow(b, -e, tick) };
      }
    }
    if (x.k === 'mul') {
      let num = mpolyOne(gens);
      let den = mpolyOne(gens);
      for (const f of x.factors) {
        const q = asPoly(f);
        if (q === null) return null;
        num = mpolyMul(num, q.num, tick);
        den = mpolyMul(den, q.den, tick);
      }
      return { num, den };
    }
    if (x.k === 'add') {
      let num: MPoly | null = null;
      let den = mpolyOne(gens);
      const parts: { num: MPoly; den: MPoly }[] = [];
      for (const term of x.terms) {
        const q = asPoly(term);
        if (q === null) return null;
        parts.push(q);
        den = mpolyMul(den, q.den, tick);
      }
      for (const q of parts) {
        const { q: co } = mpolyDivMod(den, q.den, tick);
        const term = mpolyMul(q.num, co, tick);
        num = num === null ? term : mpolyAdd(num, term, tick);
      }
      return { num: num ?? mpolyZero(gens), den };
    }
    return null;
  };
  return asPoly(t);
}

function mpolyOne(gens: readonly SymNode[]): MPoly {
  return mpolyNormalize(gens, new Map([[new Array<number>(gens.length).fill(0).join(','), 1n]]), 1n);
}

function mpolyZero(gens: readonly SymNode[]): MPoly {
  return mpolyNormalize(gens, new Map(), 1n);
}

function mpolyPow(p: MPoly, e: bigint, tick: Ticker): MPoly {
  let acc = mpolyOne(p.gens);
  let b = p;
  let k = e;
  while (k > 0n) {
    if ((k & 1n) === 1n) acc = mpolyMul(acc, b, tick);
    k >>= 1n;
    if (k > 0n) b = mpolyMul(b, b, tick);
  }
  return acc;
}

/** Zero conditions of a cancelled factor: linear univariate factors solve directly. */
function excludedFromFactor(g: { terms: ReadonlyMap<string, bigint>; den: bigint; gens: readonly SymNode[] }, gens: readonly SymNode[], ctx: RuleCtx): SymCond[] {
  void ctx;
  const tree = mpolyToTree(g as Parameters<typeof mpolyToTree>[0]);
  for (const v of gens) {
    if (v.k !== 'sym') continue;
    const coeffs = treeToUPolySym(tree, v);
    if (coeffs === null) continue;
    const others = freeSymbols(tree);
    others.delete(v.name);
    if (others.size > 0) continue;
    if (coeffs.length === 2 && !isZeroNode(coeffs[1] as SymNode)) {
      const root = divideNodes(negateNode(coeffs[0] as SymNode), coeffs[1] as SymNode);
      return [rel('!=', v, root)];
    }
  }
  return [rel('!=', tree, ZERO)];
}

/* ------------------------------ partial fractions ---------------------------- */

/** Solve Ax = b over the rationals (Bareiss fraction-free elimination). Null if singular. */
export function solveLinearRat(a: readonly (readonly bigint[])[], b: readonly bigint[]): { n: bigint; d: bigint }[] | null {
  const n = a.length;
  if (n === 0) return [];
  const m = a.map((row, i) => [...row, b[i] as bigint]);
  let prev = 1n;
  for (let k = 0; k < n - 1; k++) {
    if (m[k]?.[k] === 0n) {
      let swap = -1;
      for (let i = k + 1; i < n; i++) {
        if (m[i]?.[k] !== 0n) {
          swap = i;
          break;
        }
      }
      if (swap < 0) return null;
      const tmp = m[k] as bigint[];
      m[k] = (m[swap] as bigint[]).map((x) => x);
      m[swap] = tmp.map((x) => -x);
    }
    for (let i = k + 1; i < n; i++) {
      for (let j = k + 1; j <= n; j++) {
        (m[i] as bigint[])[j] = (((m[i] as bigint[])[j] as bigint) * ((m[k] as bigint[])[k] as bigint) - ((m[i] as bigint[])[k] as bigint) * ((m[k] as bigint[])[j] as bigint)) / prev;
      }
    }
    prev = (m[k] as bigint[])[k] as bigint;
    if (prev === 0n) return null;
  }
  const last = (m[n - 1] as bigint[])[n - 1] as bigint;
  if (last === 0n) return null;
  const x: { n: bigint; d: bigint }[] = new Array(n);
  for (let k = n - 1; k >= 0; k--) {
    let num = (m[k] as bigint[])[n] as bigint;
    let den = 1n;
    for (let j = k + 1; j < n; j++) {
      const c = (m[k] as bigint[])[j] as bigint;
      const xj = x[j] as { n: bigint; d: bigint };
      num = num * xj.d - c * xj.n * den;
      den = den * xj.d;
    }
    const d = (m[k] as bigint[])[k] as bigint;
    den = den * d;
    const g = bigGcd(num < 0n ? -num : num, den < 0n ? -den : den);
    x[k] = { n: num / g, d: den / g };
  }
  return x;
}

/**
 * Partial fractions in `v`: rational functions only. Repeated linear factors and single
 * irreducible quadratics; anything else returns null (left to `unsupported` upstream).
 */
export function apartNode(t: SymNode, v: SymNode, ctx: RuleCtx): SymNode | null {
  const { num, den } = togetherAsUPoly(t, v, ctx);
  if (num === null || den === null) return null;
  const { q: proper, r: rem } = upolyDivMod(num, den, ctx.tick);
  if (upolyIsZero(rem)) return upolyToTree(proper, v);
  const df = upolyFactor(den, ctx.tick);
  const all = [...df.factors, ...df.irreducible];
  interface Term { den: UPoly; numDeg: number }
  const terms: Term[] = [];
  for (const { f, m } of all) {
    const d = upolyDegree(f);
    if (d === 1) {
      for (let k = 1; k <= m; k++) {
        let dk: UPoly = upolyFromInts([1n]);
        for (let j = 0; j < k; j++) dk = upolyMul(dk, f, ctx.tick);
        terms.push({ den: dk, numDeg: 0 });
      }
    } else if (d === 2 && m === 1) {
      terms.push({ den: f, numDeg: 1 });
    } else {
      return null;
    }
  }
  const unknowns: { term: number; power: number }[] = [];
  terms.forEach((tm, ti) => {
    for (let pw = 0; pw <= tm.numDeg; pw++) unknowns.push({ term: ti, power: pw });
  });
  const deg = upolyDegree(den);
  const rr: bigint[][] = [];
  const bb: bigint[] = [];
  const cofactors: UPoly[] = [];
  for (const tm of terms) {
    const { q: co, r } = upolyDivMod(den, tm.den, ctx.tick);
    if (!upolyIsZero(r)) return null;
    cofactors.push(co);
  }
  if (unknowns.length !== deg) return null;
  let lcm = rem.den;
  for (const co of cofactors) lcm = (lcm * co.den) / bigGcd(lcm, co.den);
  for (let s = 0; s < deg; s++) {
    const row: bigint[] = new Array<bigint>(unknowns.length).fill(0n);
    unknowns.forEach((u, ui) => {
      const co = cofactors[u.term] as UPoly;
      const idx = s - u.power;
      const c = idx >= 0 && idx < co.c.length ? (co.c[idx] as bigint) : 0n;
      row[ui] = c * (lcm / co.den);
    });
    rr.push(row);
    bb.push((s < rem.c.length ? (rem.c[s] as bigint) : 0n) * (lcm / rem.den));
  }
  const sol = solveLinearRat(rr, bb);
  if (sol === null) return null;
  const parts: SymNode[] = [];
  if (!upolyIsZero(proper)) parts.push(upolyToTree(proper, v));
  terms.forEach((tm, ti) => {
    const coeffs = unknowns
      .map((u, ui) => ({ u, s: sol[ui] as { n: bigint; d: bigint } }))
      .filter(({ u }) => u.term === ti)
      .sort((a, b) => a.u.power - b.u.power);
    let numT: SymNode = ZERO;
    for (const { u, s } of coeffs) {
      const c = ratN(s.n, s.d);
      if (isZeroNode(c)) continue;
      numT = u.power === 0 ? add(numT, c) : add(numT, mul(c, pow(v, intN(u.power))));
    }
    if (!isZeroNode(numT)) parts.push(divideNodes(numT, upolyToTree(tm.den, v)));
  });
  return add(...parts);
}

/** Write `t` as num/den univariate polynomials in `v`. Null unless a rational function. */
function togetherAsUPoly(t: SymNode, v: SymNode, ctx: RuleCtx): { num: UPoly | null; den: UPoly | null } {
  const direct = treeToUPoly(t, v, ctx.tick);
  if (direct !== null) return { num: direct, den: upolyFromInts([1n]) };
  const rec = (x: SymNode): { num: UPoly; den: UPoly } | null => {
    const d = treeToUPoly(x, v, ctx.tick);
    if (d !== null) return { num: d, den: upolyFromInts([1n]) };
    if (x.k === 'pow') {
      const e = asInteger(x.exp);
      if (e !== null && e < 0n) {
        const b = treeToUPoly(x.base, v, ctx.tick);
        if (b === null) return null;
        let den = upolyFromInts([1n]);
        for (let i = 0n; i < -e; i++) den = upolyMul(den, b, ctx.tick);
        return { num: upolyFromInts([1n]), den };
      }
      return null;
    }
    if (x.k === 'mul') {
      let num = upolyFromInts([1n]);
      let den = upolyFromInts([1n]);
      for (const f of x.factors) {
        const q = rec(f);
        if (q === null) return null;
        num = upolyMul(num, q.num, ctx.tick);
        den = upolyMul(den, q.den, ctx.tick);
      }
      return { num, den };
    }
    if (x.k === 'add') {
      let den = upolyFromInts([1n]);
      const parts: { num: UPoly; den: UPoly }[] = [];
      for (const term of x.terms) {
        const q = rec(term);
        if (q === null) return null;
        parts.push(q);
        den = upolyMul(den, q.den, ctx.tick);
      }
      let num = upolyFromInts([0n]);
      for (const q of parts) {
        const { q: co, r } = upolyDivMod(den, q.den, ctx.tick);
        if (!upolyIsZero(r)) return null;
        num = upolyAdd(num, upolyMul(q.num, co, ctx.tick), ctx.tick);
      }
      return { num, den };
    }
    return null;
  };
  const out = rec(t);
  if (out === null) return { num: null, den: null };
  const g = upolyGcd(out.num, out.den, ctx.tick);
  if (!upolyIsZero(g) && upolyDegree(g) > 0) {
    return { num: upolyDivMod(out.num, g, ctx.tick).q, den: upolyDivMod(out.den, g, ctx.tick).q };
  }
  return out;
}

/* -------------------------------- rationalize --------------------------------- */

/**
 * Remove surds from denominators; for numeric inputs find the nearest simple fraction.
 * Handles `1/sqrt(n)` and `1/(a ± b√c)`-style binomial denominators by conjugates.
 */
export function rationalizeNode(t: SymNode, ctx: RuleCtx): SymNode {
  if (isNumberNode(t) && (t.k === 'float')) {
    const f = nearestFraction(t.v);
    if (f !== null) {
      ctx.note('rationalize.numeric', t, ratN(f.n, f.d));
      return ratN(f.n, f.d);
    }
    return t;
  }
  return mapNodes(t, (x) => {
    if (x.k !== 'pow') return x;
    const e = asInteger(x.exp);
    if (e === null || e >= 0n) return x;
    const den = x.base;
    const conj = conjugateOf(den);
    if (conj === null) return x;
    ctx.tick.tick(4);
    const num = pow(conj, intN(Number(-e)));
    const dd = expandNode(mul(den, conj), ctx.tick);
    const folded = togetherNode(divideNodes(num, pow(dd, intN(Number(-e)))), ctx).node;
    ctx.note('rationalize.conj', x, folded);
    return folded;
  });
}

function conjugateOf(den: SymNode): SymNode | null {
  if (den.k === 'pow') {
    const e = asRational(den.exp);
    if (e !== null && e.n === 1n && e.d === 2n) return den;
    return null;
  }
  if (den.k === 'fn' && den.name === 'sqrt') return den;
  if (den.k === 'add' && den.terms.length === 2) {
    const a = den.terms[0] as SymNode;
    const b = den.terms[1] as SymNode;
    if (hasSqrt(b) && !hasSqrt(a)) return add(a, negateNode(b));
    if (hasSqrt(a) && !hasSqrt(b)) return add(negateNode(a), b);
  }
  return null;
}

function hasSqrt(t: SymNode): boolean {
  if (t.k === 'pow') {
    const e = asRational(t.exp);
    if (e !== null && e.d !== 1n) return true;
    return hasSqrt(t.base);
  }
  if (t.k === 'fn' && t.name === 'sqrt') return true;
  if (t.k === 'add') return t.terms.some(hasSqrt);
  if (t.k === 'mul') return t.factors.some(hasSqrt);
  if (t.k === 'fn') return t.args.some(hasSqrt);
  return false;
}

/* ------------------------------ complete square ------------------------------- */

/** Quadratics in `v` → `a (v + h)^2 + k`. Null unless quadratic in `v`. */
export function completeSquareNode(t: SymNode, v: SymNode, ctx: RuleCtx): SymNode | null {
  const coeffs = treeToUPolySym(t, v, ctx.tick);
  if (coeffs === null || coeffs.length !== 3) return null;
  const [c, b, a] = coeffs as [SymNode, SymNode, SymNode];
  if (isZeroNode(a)) return null;
  const h = divideNodes(b, mul(TWO, a));
  const k = add(c, negateNode(divideNodes(mul(b, b), mul(intN(4), a))));
  const out = add(mul(a, pow(add(v, h), TWO)), k);
  ctx.note('square.complete', t, out);
  return out;
}

/* --------------------------------- trig forms --------------------------------- */

/** Expand trig of sums: `sin(a+b)`, `cos(a-b)`, double angles. */
export function trigExpandNode(t: SymNode, ctx: RuleCtx): SymNode {
  return mapNodes(t, (x) => {
    if (x.k !== 'fn' || x.args.length !== 1) return x;
    const a = x.args[0] as SymNode;
    if (a.k !== 'add') return x;
    if (x.name !== 'sin' && x.name !== 'cos' && x.name !== 'tan') return x;
    if (a.terms.length < 2) return x;
    const u = a.terms[0] as SymNode;
    const w = a.terms.length === 2 ? (a.terms[1] as SymNode) : add(...a.terms.slice(1));
    ctx.tick.tick(2);
    let out: SymNode;
    if (x.name === 'sin') out = add(mul(fn('sin', u), fn('cos', w)), mul(fn('cos', u), fn('sin', w)));
    else if (x.name === 'cos') out = add(mul(fn('cos', u), fn('cos', w)), negateNode(mul(fn('sin', u), fn('sin', w))));
    else {
      const tu = fn('tan', u);
      const tw = fn('tan', w);
      out = divideNodes(add(tu, tw), add(ONE, negateNode(mul(tu, tw))));
    }
    ctx.note('trig.expand', x, out);
    return out;
  });
}

/** Combine trig products into sums; `a sin(v) + b cos(v)` becomes one sine. */
export function trigCombineNode(t: SymNode, ctx: RuleCtx): SymNode {
  const combined = mapNodes(t, (x) => {
    if (x.k !== 'mul') return x;
    const trigs = x.factors.filter((f) => f.k === 'fn' && (f.name === 'sin' || f.name === 'cos') && f.args.length === 1);
    if (trigs.length < 2) return x;
    const f1 = trigs[0] as SymNode & { k: 'fn' };
    const f2 = trigs[1] as SymNode & { k: 'fn' };
    const u = f1.args[0] as SymNode;
    const w = f2.args[0] as SymNode;
    const rest = x.factors.filter((f) => f !== f1 && f !== f2);
    ctx.tick.tick(2);
    let pair: SymNode;
    if (f1.name === 'sin' && f2.name === 'sin') pair = mul(ratN(1n, 2n), add(fn('cos', add(u, negateNode(w))), negateNode(fn('cos', add(u, w)))));
    else if (f1.name === 'cos' && f2.name === 'cos') pair = mul(ratN(1n, 2n), add(fn('cos', add(u, negateNode(w))), fn('cos', add(u, w))));
    else {
      const s = f1.name === 'sin' ? u : w;
      const c = f1.name === 'sin' ? w : u;
      pair = mul(ratN(1n, 2n), add(fn('sin', add(s, c)), fn('sin', add(s, negateNode(c)))));
    }
    const out = mul(pair, ...rest);
    ctx.note('trig.combine', x, out);
    return out;
  });
  return combineLinearTrig(combined, ctx);
}

function combineLinearTrig(t: SymNode, ctx: RuleCtx): SymNode {
  return mapNodes(t, (x) => {
    if (x.k !== 'add' || x.terms.length !== 2) return x;
    const parts = x.terms.map((term) => {
      let coeff: SymNode = ONE;
      let body = term;
      if (term.k === 'mul' && term.factors.length === 2 && isNumberNode(term.factors[0] as SymNode)) {
        coeff = term.factors[0] as SymNode;
        body = term.factors[1] as SymNode;
      }
      if (body.k === 'fn' && body.args.length === 1 && (body.name === 'sin' || body.name === 'cos')) {
        return { coeff, f: body.name, arg: body.args[0] as SymNode };
      }
      return null;
    });
    const p0 = parts[0] ?? null;
    const p1 = parts[1] ?? null;
    if (p0 === null || p1 === null) return x;
    if (p0.f === p1.f || p0.arg !== p1.arg) return x;
    const sPart = p0.f === 'sin' ? p0 : p1;
    const cPart = p0.f === 'cos' ? p0 : p1;
    if (!isNumberNode(sPart.coeff) || !isNumberNode(cPart.coeff)) return x;
    const a = toFloat(sPart.coeff);
    const b = toFloat(cPart.coeff);
    const r = Math.hypot(a, b);
    if (!(r > 0)) return x;
    const out = mul(floatN(r), fn('sin', add(sPart.arg, floatN(Math.atan2(b, a)))));
    ctx.note('trig.linear', x, out);
    return out;
  });
}

/** Simplify with trig identities: Pythagoras, double-angle, `tan → sin/cos`. */
export function trigSimplifyNode(t: SymNode, ctx: RuleCtx): SymNode {
  const tanSplit = mapNodes(t, (x) => {
    if (x.k === 'fn' && x.name === 'tan' && x.args.length === 1) {
      const a = x.args[0] as SymNode;
      const out = divideNodes(fn('sin', a), fn('cos', a));
      ctx.note('trig.tan', x, out);
      return out;
    }
    return x;
  });
  return runPasses(tanSplit, [trigPythagoras, trigDouble], ctx);
}

/* --------------------------------- evaluate ----------------------------------- */

/** Arithmetic only: fold number-only subtrees, no algebraic strategy. */
export function evaluateNode(t: SymNode, ctx: RuleCtx): SymNode {
  return mapNodes(t, (x) => {
    if (isNumberNode(x)) return x;
    if (freeSymbols(x).size > 0) return x;
    if (x.k === 'ref' || x.k === 'rootof' || x.k === 'sym') return x;
    if (x.k === 'fn' || x.k === 'pow' || x.k === 'add' || x.k === 'mul') {
      const v = evalFloatTree(x);
      if (v !== null && Number.isFinite(v)) {
        if (Number.isInteger(v) && Math.abs(v) < 2 ** 53) {
          const folded = intN(v);
          ctx.note('eval.fold', x, folded);
          return folded;
        }
        const folded = floatN(v);
        ctx.note('eval.fold', x, folded);
        return folded;
      }
    }
    return x;
  });
}

function evalFloatTree(x: SymNode): number | null {
  switch (x.k) {
    case 'int': return Number(x.v);
    case 'rat': return Number(x.n) / Number(x.d);
    case 'float': return x.v;
    case 'dec': return Number(x.mant) * Math.pow(10, x.exp);
    case 'const':
      if (x.name === 'pi') return Math.PI;
      if (x.name === 'e') return Math.E;
      if (x.name === 'inf') return Infinity;
      return null;
    case 'add': {
      let s = 0;
      for (const t of x.terms) {
        const v = evalFloatTree(t);
        if (v === null) return null;
        s += v;
      }
      return s;
    }
    case 'mul': {
      let p = 1;
      for (const f of x.factors) {
        const v = evalFloatTree(f);
        if (v === null) return null;
        p *= v;
      }
      return p;
    }
    case 'pow': {
      const b = evalFloatTree(x.base);
      const e = evalFloatTree(x.exp);
      if (b === null || e === null) return null;
      if (b < 0) {
        const r = asRational(x.exp);
        if (r !== null && r.d !== 1n && r.d % 2n === 1n) {
          const s = r.n % 2n === 0n ? 1 : -1;
          return s * Math.pow(-b, e);
        }
      }
      return Math.pow(b, e);
    }
    case 'fn': {
      const args: number[] = [];
      for (const a of x.args) {
        const v = evalFloatTree(a);
        if (v === null) return null;
        args.push(v);
      }
      return evalFnFloat(x.name, args);
    }
    default: return null;
  }
}

function evalFnFloat(name: SymFn, args: readonly number[]): number | null {
  const a = args[0] as number;
  const b = args[1] as number;
  switch (name) {
    case 'sin': return Math.sin(a);
    case 'cos': return Math.cos(a);
    case 'tan': return Math.tan(a);
    case 'asin': return Math.asin(a);
    case 'acos': return Math.acos(a);
    case 'atan': return Math.atan(a);
    case 'atan2': return Math.atan2(a, b);
    case 'sinh': return Math.sinh(a);
    case 'cosh': return Math.cosh(a);
    case 'tanh': return Math.tanh(a);
    case 'asinh': return Math.asinh(a);
    case 'acosh': return Math.acosh(a);
    case 'atanh': return Math.atanh(a);
    case 'exp': return Math.exp(a);
    case 'ln': return Math.log(a);
    case 'log10': return Math.log10(a);
    case 'log2': return Math.log2(a);
    case 'abs': return Math.abs(a);
    case 'sign': return Math.sign(a);
    case 'floor': return Math.floor(a);
    case 'ceil': return Math.ceil(a);
    case 'round': return Math.round(a);
    case 'min': return Math.min(...args);
    case 'max': return Math.max(...args);
    case 'sqrt': return Math.sqrt(a);
    case 'cbrt': return Math.cbrt(a);
  }
}

/* ---------------------------------- factor ------------------------------------ */

export interface FactorResult {
  readonly node: SymNode;
  readonly irreducible: boolean;
}

/**
 * Factor an expression: whole numbers into primes; polynomials over the rationals
 * (univariate via `upolyFactor`, multivariate via Kronecker + trial division); atoms
 * such as `sin(x)` as generators. `over = complex` splits irreducible quadratics.
 * Irreducible input returns itself with `irreducible: true`.
 */
export function factorNode(t: SymNode, ctx: RuleCtx, over: 'rational' | 'complex' = 'rational'): FactorResult {
  if (t.k === 'int') {
    if (t.v === 0n || t.v === 1n || t.v === -1n) return { node: t, irreducible: true };
    const neg = t.v < 0n;
    const factors = primeFactorsBig(neg ? -t.v : t.v);
    if (factors === null) return { node: t, irreducible: true };
    if (factors.length <= 1) return { node: t, irreducible: true };
    const node = factoredIntegerNode([...factors].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), neg);
    ctx.note('factor.int', t, node);
    return { node, irreducible: false };
  }
  if (t.k === 'rat') {
    const n = factorNode(intN(t.n), ctx);
    const d = factorNode(intN(t.d), ctx);
    if (n.irreducible && d.irreducible) return { node: t, irreducible: true };
    return { node: divideNodes(n.node, d.node), irreducible: false };
  }
  const atoms = collectAtoms(t);
  const syms = [...freeSymbols(t)].map((s) => symN(s)).sort(compareNodes);
  const gens = [...syms, ...atoms.filter((a) => a.k !== 'sym')];
  if (gens.length === 0) return { node: t, irreducible: true };
  if (gens.length === 1 && (gens[0] as SymNode).k === 'sym') {
    const p = treeToUPoly(t, gens[0] as SymNode, ctx.tick);
    if (p !== null && upolyDegree(p) > 1) return factorUni(t, p, gens[0] as SymNode, ctx, over);
  }
  const mp = treeToMPoly(t, gens, ctx.tick);
  if (mp === null || mpolyIsZero(mp)) return { node: t, irreducible: true };
  const { content, factors, rest } = mpolyFactor(mp, ctx.tick);
  if (factors.length === 0) {
    if (over === 'complex') {
      const c = factorComplexUni(t, gens, ctx);
      if (c !== null) return c;
    }
    return { node: t, irreducible: true };
  }
  const parts: SymNode[] = [];
  if (content !== 1n) parts.push(intN(content));
  const merged = mergeFactorTrees(factors.map(({ f, m }) => ({ tree: mpolyToTree(f), m })));
  for (const { tree, m } of merged) {
    parts.push(m === 1 ? tree : pow(tree, intN(m)));
  }
  const restTree = mpolyToTree(rest);
  if (!isOneNode(restTree)) parts.push(restTree);
  const built = parts.length === 0 ? ONE : mul(...parts);
  const node = verifyFactor(t, built, ctx);
  if (node === null || node.id === t.id) return { node: t, irreducible: true };
  ctx.note('factor.poly', t, node);
  return { node, irreducible: false };
}

/**
 * Self-check a factorization: `t / built` must cancel to a nonzero constant, which is
 * absorbed (fixing any dropped sign or denominator). Null when it does not hold, in
 * which case the caller keeps the input. Uses `together` only (never `simplify`, which
 * would recurse back into factoring).
 */
function verifyFactor(t: SymNode, built: SymNode, ctx: RuleCtx): SymNode | null {
  if (hasImaginaryUnit(built)) {
    // Complex factors: multiply out, reduce powers of i, compare with the input.
    try {
      const back = runPasses(expandNode(built, ctx.tick), [complexPow], ctx);
      const flat = runPasses(expandNode(t, ctx.tick), [complexPow], ctx);
      return back === flat ? built : null;
    } catch {
      return null;
    }
  }
  const ratio = togetherNode(divideNodes(t, built), ctx).node;
  if (isOneNode(ratio)) return built;
  if (ratio.k === 'int' && ratio.v === -1n) return negateNode(built);
  const r = asRational(ratio);
  if (r !== null) return mul(divideNodes(intN(r.n), intN(r.d)), built);
  if (ratio.k === 'float' && Number.isFinite(ratio.v) && ratio.v !== 0) return mul(ratio, built);
  return null;
}

/** Multiply out and reduce powers of `i` (`i^2 -> -1`). */
export function reduceImaginary(t: SymNode, ctx: RuleCtx): SymNode {
  return runPasses(expandNode(t, ctx.tick), [complexPow], ctx);
}

export function hasImaginaryUnit(t: SymNode): boolean {
  let found = false;
  mapNodes(t, (x) => {
    if (x.k === 'const' && x.name === 'i') found = true;
    return x;
  });
  return found;
}

function mergeFactorTrees(factors: readonly { tree: SymNode; m: number }[]): { tree: SymNode; m: number }[] {
  const merged: { tree: SymNode; m: number }[] = [];
  for (const f of factors) {
    const last = merged[merged.length - 1];
    if (last !== undefined && last.tree === f.tree) last.m += f.m;
    else {
      const hit = merged.find((e) => e.tree === f.tree);
      if (hit !== undefined) hit.m += f.m;
      else merged.push({ tree: f.tree, m: f.m });
    }
  }
  return merged;
}

function factorUni(t: SymNode, p: UPoly, v: SymNode, ctx: RuleCtx, over: 'rational' | 'complex'): FactorResult {
  const { content, factors, irreducible } = upolyFactor(p, ctx.tick);
  const parts: SymNode[] = [];
  if (content !== 1n) parts.push(intN(content));
  if ((p.c[p.c.length - 1] as bigint) < 0n) parts.push(intN(-1));
  const merged = mergeFactorTrees([...factors, ...irreducible].map(({ f, m }) => ({ tree: upolyToTree(f, v), m })));
  const out: SymNode[] = [...parts];
  let changed = factors.length > 0;
  for (const { tree, m } of merged) {
    const isIrr = irreducible.some(({ f }) => upolyToTree(f, v) === tree);
    if (isIrr && over === 'complex') {
      const split = splitComplexQuadratic(tree, v, ctx);
      if (split !== null) {
        out.push(m === 1 ? split : pow(split, intN(m)));
        changed = true;
        continue;
      }
    }
    out.push(m === 1 ? tree : pow(tree, intN(m)));
  }
  if (!changed) return { node: t, irreducible: true };
  const built = mul(...out);
  const node = verifyFactor(t, built, ctx);
  if (node === null || node.id === t.id) return { node: t, irreducible: true };
  ctx.note('factor.poly', t, node);
  return { node, irreducible: false };
}

/** Split an irreducible quadratic over C into complex linear factors. */
function splitComplexQuadratic(tree: SymNode, v: SymNode, ctx: RuleCtx): SymNode | null {
  const coeffs = treeToUPolySym(tree, v, ctx.tick);
  if (coeffs === null || coeffs.length !== 3) return null;
  const [c0, c1, c2] = coeffs as [SymNode, SymNode, SymNode];
  if (!isExactNumber(c2) && !isNumberNode(c2)) return null;
  const disc = add(mul(c1, c1), negateNode(mul(intN(4), mul(c2, c0))));
  const discRat = asRational(disc);
  if (discRat === null || discRat.n >= 0n) return null;
  const twoA = mul(TWO, c2);
  const re = divideNodes(negateNode(c1), twoA);
  const im = divideNodes(pow(negateNode(disc), ratN(1n, 2n)), twoA);
  const i = constN('i');
  const f1 = add(v, negateNode(add(re, mul(i, im))));
  const f2 = add(v, negateNode(add(re, negateNode(mul(i, im)))));
  const out = mul(c2, f1, f2);
  ctx.note('factor.complex', tree, out);
  return out;
}

function factorComplexUni(t: SymNode, gens: readonly SymNode[], ctx: RuleCtx): FactorResult | null {
  for (const g of gens) {
    if (g.k !== 'sym') continue;
    const p = treeToUPoly(t, g, ctx.tick);
    if (p === null || upolyDegree(p) !== 2) continue;
    const { irreducible } = upolyFactor(p, ctx.tick);
    if (irreducible.length === 0) continue;
    const split = splitComplexQuadratic(t, g, ctx);
    if (split !== null) return { node: split, irreducible: false };
  }
  return null;
}

/* --------------------------------- simplify ----------------------------------- */

function countFn(t: SymNode): number {
  let n = 0;
  const seen = new Set<number>();
  const stack: SymNode[] = [t];
  while (stack.length > 0) {
    const x = stack.pop() as SymNode;
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    if (x.k === 'fn') n++;
    if (x.k === 'add') stack.push(...x.terms);
    if (x.k === 'mul') stack.push(...x.factors);
    if (x.k === 'pow') stack.push(x.base, x.exp);
    if (x.k === 'fn') stack.push(...x.args);
  }
  return n;
}

function countDiv(t: SymNode): number {
  let n = 0;
  const seen = new Set<number>();
  const stack: SymNode[] = [t];
  while (stack.length > 0) {
    const x = stack.pop() as SymNode;
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    if (x.k === 'pow' && asInteger(x.exp) !== null && (asInteger(x.exp) as bigint) < 0n) n++;
    if (x.k === 'rat') n++;
    if (x.k === 'add') stack.push(...x.terms);
    if (x.k === 'mul') stack.push(...x.factors);
    if (x.k === 'pow') stack.push(x.base, x.exp);
    if (x.k === 'fn') stack.push(...x.args);
  }
  return n;
}

function bigDigits(t: SymNode): number {
  let n = 0;
  const seen = new Set<number>();
  const stack: SymNode[] = [t];
  while (stack.length > 0) {
    const x = stack.pop() as SymNode;
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    if (x.k === 'int') {
      const d = x.v.toString().length;
      if (d > 4) n += d;
    }
    if (x.k === 'add') stack.push(...x.terms);
    if (x.k === 'mul') stack.push(...x.factors);
    if (x.k === 'pow') stack.push(x.base, x.exp);
    if (x.k === 'fn') stack.push(...x.args);
  }
  return n;
}

function countAdd(t: SymNode): number {
  let n = 0;
  const seen = new Set<number>();
  const stack: SymNode[] = [t];
  while (stack.length > 0) {
    const x = stack.pop() as SymNode;
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    if (x.k === 'add') n++;
    if (x.k === 'add') stack.push(...x.terms);
    if (x.k === 'mul') stack.push(...x.factors);
    if (x.k === 'pow') stack.push(x.base, x.exp);
    if (x.k === 'fn') stack.push(...x.args);
  }
  return n;
}

/**
 * Cost of a candidate: nodes, plus weight 2 per function node, plus large-integer
 * digits / 4, plus 3 per division.
 */
export function costOf(t: SymNode): number {
  return nodeCount(t) + 2 * countFn(t) + bigDigits(t) / 4 + 3 * countDiv(t);
}

function tryCandidate(build: () => SymNode, out: SymNode[]): void {
  try {
    out.push(build());
  } catch {
    void 0;
  }
}

export interface SimplifyResult {
  readonly node: SymNode;
  readonly excluded: SymCond[];
}

/**
 * Simplify by candidate search: canonicalise, then the input, its expansion, its
 * common-denominator form, the factored form, the trig-reduced form, the log-combined
 * form and the radical-simplified form. Lowest cost wins; up to three rounds.
 */
export function simplifyNode(t: SymNode, ctx: RuleCtx): SimplifyResult {
  let cur = runPasses(t, SIMPLIFY_RULES, ctx);
  const excluded: SymCond[] = [];
  const addExcluded = (cs: readonly SymCond[]): void => {
    for (const c of cs) {
      if (!excluded.some((e) => condText(e) === condText(c))) excluded.push(c);
    }
  };
  for (let round = 0; round < 3; round++) {
    const cands: SymNode[] = [cur];
    const cancelled = new Map<SymNode, SymCond[]>();
    tryCandidate(() => expandNode(cur, ctx.tick), cands);
    tryCandidate(() => {
      const tg = togetherNode(cur, ctx);
      if (tg.excluded.length > 0) cancelled.set(tg.node, tg.excluded);
      return tg.node;
    }, cands);
    tryCandidate(() => factorNode(cur, ctx).node, cands);
    tryCandidate(() => trigSimplifyNode(cur, ctx), cands);
    tryCandidate(() => runPasses(cur, [logRules, powPower], ctx), cands);
    tryCandidate(() => runPasses(cur, [rootsPull, rootsSquare], ctx), cands);
    const scored = cands.map((c) => ({ c, cost: costOf(c), adds: countAdd(c), text: toText(c) }));
    scored.sort((a, b) => a.cost - b.cost || a.adds - b.adds || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
    const best = (scored[0] as { c: SymNode }).c;
    if (best === cur) break;
    ctx.note('simplify.choose', cur, best);
    const gone = cancelled.get(best);
    if (gone !== undefined) addExcluded(gone);
    cur = best;
  }
  try {
    const tg = togetherNode(cur, ctx);
    if (tg.excluded.length > 0 && costOf(tg.node) <= costOf(cur) + 1) {
      cur = tg.node;
      addExcluded(tg.excluded);
    }
  } catch {
    void 0;
  }
  return { node: cur, excluded };
}

/* ------------------------------ numeric helpers ------------------------------- */

/** Evaluate a tree at symbol values (floats). Null when not evaluable. */
export function evalAt(t: SymNode, vals: ReadonlyMap<string, number>): number | null {
  switch (t.k) {
    case 'int': return Number(t.v);
    case 'rat': return Number(t.n) / Number(t.d);
    case 'float': return t.v;
    case 'dec': return Number(t.mant) * Math.pow(10, t.exp);
    case 'const':
      if (t.name === 'pi') return Math.PI;
      if (t.name === 'e') return Math.E;
      if (t.name === 'inf') return Infinity;
      return null;
    case 'sym': {
      const v = vals.get(t.name);
      return v === undefined ? null : v;
    }
    case 'ref': return null;
    case 'add': {
      let s = 0;
      for (const c of t.terms) {
        const v = evalAt(c, vals);
        if (v === null) return null;
        s += v;
      }
      return s;
    }
    case 'mul': {
      let p = 1;
      for (const c of t.factors) {
        const v = evalAt(c, vals);
        if (v === null) return null;
        p *= v;
      }
      return p;
    }
    case 'pow': {
      const b = evalAt(t.base, vals);
      const e = evalAt(t.exp, vals);
      if (b === null || e === null) return null;
      if (b < 0) {
        const r = asRational(t.exp);
        if (r !== null && r.d !== 1n && r.d % 2n === 1n) {
          const s = r.n % 2n === 0n ? 1 : -1;
          return s * Math.pow(-b, e);
        }
      }
      return Math.pow(b, e);
    }
    case 'fn': {
      const args: number[] = [];
      for (const a of t.args) {
        const v = evalAt(a, vals);
        if (v === null) return null;
        args.push(v);
      }
      return evalFnFloat(t.name, args);
    }
    case 'rootof': return t.hint;
    case 'list': return null;
    case 'piecewise': {
      for (const cs of t.cases) {
        const w = evalCondAt(cs.when, vals);
        if (w === null) return null;
        if (w) return evalAt(cs.then, vals);
      }
      return t.other === undefined ? null : evalAt(t.other, vals);
    }
  }
}

export function evalCondAt(c: SymCond, vals: ReadonlyMap<string, number>): boolean | null {
  switch (c.c) {
    case 'true': return true;
    case 'false': return false;
    case 'rel': {
      const l = evalAt(c.l, vals);
      const r = evalAt(c.r, vals);
      if (l === null || r === null) return null;
      switch (c.op) {
        case '==': return l === r;
        case '!=': return l !== r;
        case '<': return l < r;
        case '<=': return l <= r;
        case '>': return l > r;
        case '>=': return l >= r;
      }
      break;
    }
    case 'in': return null;
    case 'not': {
      const v = evalCondAt(c.of, vals);
      return v === null ? null : !v;
    }
    case 'and': {
      for (const o of c.of) {
        const v = evalCondAt(o, vals);
        if (v === null) return null;
        if (!v) return false;
      }
      return true;
    }
    case 'or': {
      for (const o of c.of) {
        const v = evalCondAt(o, vals);
        if (v === null) return null;
        if (v) return true;
      }
      return false;
    }
  }
}

/** Substitute `old → nw` everywhere (structural, simultaneous for lists via `substituteList`). */
export function substituteNode(t: SymNode, old: SymNode, nw: SymNode): SymNode {
  if (t === old) return nw;
  return mapNodes(t, (x) => (x === old ? nw : x));
}

/** Simultaneous substitution of several pairs. */
export function substituteList(t: SymNode, pairs: readonly (readonly [SymNode, SymNode])[]): SymNode {
  const map = new Map<number, SymNode>();
  for (const [o, n] of pairs) map.set(o.id, n);
  return mapNodes(t, (x) => map.get(x.id) ?? x);
}

export function substituteCond(c: SymCond, pairs: readonly (readonly [SymNode, SymNode])[]): SymCond {
  const map = new Map<number, SymNode>();
  for (const [o, n] of pairs) map.set(o.id, n);
  const go = (t: SymNode): SymNode => mapNodes(t, (x) => map.get(x.id) ?? x);
  switch (c.c) {
    case 'rel': return rel(c.op, go(c.l), go(c.r));
    case 'in': return { c: 'in', l: go(c.l), set: c.set };
    case 'not': return { c: 'not', of: substituteCond(c.of, pairs) };
    case 'and': return andCond(...c.of.map((o) => substituteCond(o, pairs)));
    case 'or': {
      const parts = c.of.map((o) => substituteCond(o, pairs));
      return { c: 'or', of: parts };
    }
    default: return c;
  }
}
