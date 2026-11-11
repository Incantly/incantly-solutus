/**
 * Assumptions: symbol domains plus local facts (cas/design.md 5.12). Both are data, never
 * hidden state: the same line always gives the same answer and every answer can be cached.
 */
import type { Domain } from './contracts';
import type { SymCond, SymNode } from './node';
import { asInteger, asRational } from './node';

export interface Assumptions {
  readonly domains: ReadonlyMap<string, Domain>;
  readonly facts: readonly SymCond[];
}

export type Sign = 'pos' | 'neg' | 'zero' | 'nonneg' | 'nonpos' | 'nonzero' | 'unknown';

export const EMPTY_ASSUMPTIONS: Assumptions = { domains: new Map(), facts: [] };

export function assumptions(domains?: ReadonlyMap<string, Domain>, facts?: readonly SymCond[]): Assumptions {
  return { domains: domains ?? new Map(), facts: facts ?? [] };
}

function domainSign(d: Domain): Sign {
  switch (d) {
    case 'positive': return 'pos';
    case 'negative': return 'neg';
    case 'nonneg': return 'nonneg';
    case 'nonpos': return 'nonpos';
    case 'nonzero': return 'nonzero';
    case 'natural': return 'pos';
    case 'integer': case 'rational': case 'real': case 'complex': return 'unknown';
  }
}

function mulSign(a: Sign, b: Sign): Sign {
  if (a === 'zero' || b === 'zero') return 'zero';
  if (a === 'unknown' || b === 'unknown') return 'unknown';
  const table: Record<string, Record<string, Sign>> = {
    pos: { pos: 'pos', neg: 'neg', nonneg: 'nonneg', nonpos: 'nonpos', nonzero: 'nonzero' },
    neg: { pos: 'neg', neg: 'pos', nonneg: 'nonpos', nonpos: 'nonneg', nonzero: 'nonzero' },
    nonneg: { pos: 'nonneg', neg: 'nonpos', nonneg: 'nonneg', nonpos: 'nonpos', nonzero: 'unknown' },
    nonpos: { pos: 'nonpos', neg: 'nonneg', nonneg: 'nonpos', nonpos: 'nonneg', nonzero: 'unknown' },
    nonzero: { pos: 'nonzero', neg: 'nonzero', nonneg: 'unknown', nonpos: 'unknown', nonzero: 'nonzero' },
  };
  return (table[a] as Record<string, Sign>)[b] ?? 'unknown';
}

function addSign(a: Sign, b: Sign): Sign {
  if (a === 'zero') return b;
  if (b === 'zero') return a;
  if (a === 'unknown' || b === 'unknown') return 'unknown';
  if (a === b) return a === 'nonzero' ? 'unknown' : a;
  const nonneg = (s: Sign): boolean => s === 'pos' || s === 'nonneg' || s === 'zero';
  const nonpos = (s: Sign): boolean => s === 'neg' || s === 'nonpos' || s === 'zero';
  if (nonneg(a) && nonneg(b)) return a === 'pos' || b === 'pos' ? 'pos' : 'nonneg';
  if (nonpos(a) && nonpos(b)) return a === 'neg' || b === 'neg' ? 'neg' : 'nonpos';
  return 'unknown';
}

function numberSign(n: SymNode): Sign {
  const r = asRational(n);
  if (r !== null) return r.n === 0n ? 'zero' : r.n > 0n ? 'pos' : 'neg';
  if (n.k === 'float') return n.v === 0 ? 'zero' : n.v > 0 ? 'pos' : n.v < 0 ? 'neg' : 'unknown';
  if (n.k === 'dec') return n.mant === 0n ? 'zero' : n.mant > 0n ? 'pos' : 'neg';
  if (n.k === 'const') {
    if (n.name === 'pi' || n.name === 'e' || n.name === 'inf') return 'pos';
    return 'unknown';
  }
  return 'unknown';
}

/** Sign of a relation fact about a symbol, e.g. `a > 0`. */
function factSign(name: string, a: Assumptions): Sign {
  let out: Sign = 'unknown';
  for (let i = 0; i < a.facts.length; i++) {
    const f = a.facts[i] as SymCond;
    if (f.c !== 'rel') continue;
    let s = factSignOne(name, f.op, f.l, f.r);
    if (s === 'unknown') s = factSignBound(name, f.op, f.l, f.r, a, i);
    out = strengthen(out, s);
  }
  return out;
}

/**
 * A fact `v > b` (or `v >= b`, `b < v`, ...) against another expression `b` whose sign is
 * known from the remaining facts. The fact itself is dropped while `b` is analysed, so
 * circular facts (`a > b`, `b > a`) end.
 */
function factSignBound(name: string, op: string, l: SymNode, r: SymNode, a: Assumptions, skip: number): Sign {
  const isSym = (t: SymNode): boolean => t.k === 'sym' && t.name === name;
  let other: SymNode;
  let rel: string;
  if (isSym(l) && !isSym(r)) {
    other = r;
    rel = op;
  } else if (isSym(r) && !isSym(l)) {
    other = l;
    rel = ({ '<': '>', '<=': '>=', '>': '<', '>=': '<=', '==': '==', '!=': '!=' } as Record<string, string>)[op] ?? op;
  } else {
    return 'unknown';
  }
  if (rel === '!=' || rel === '==') return 'unknown';
  const rest: Assumptions = { domains: a.domains, facts: a.facts.filter((_f, i) => i !== skip) };
  const os = signOf(other, rest);
  if (rel === '>') return os === 'pos' || os === 'nonneg' || os === 'zero' ? 'pos' : 'unknown';
  if (rel === '>=') return os === 'pos' ? 'pos' : os === 'nonneg' || os === 'zero' ? 'nonneg' : 'unknown';
  if (rel === '<') return os === 'neg' || os === 'nonpos' || os === 'zero' ? 'neg' : 'unknown';
  if (rel === '<=') return os === 'neg' ? 'neg' : os === 'nonpos' || os === 'zero' ? 'nonpos' : 'unknown';
  return 'unknown';
}

function strengthen(a: Sign, b: Sign): Sign {
  if (a === 'unknown') return b;
  if (b === 'unknown') return a;
  if (a === b) return a;
  if (a === 'nonzero' && (b === 'pos' || b === 'neg')) return b;
  if (b === 'nonzero' && (a === 'pos' || a === 'neg')) return a;
  if (a === 'nonneg' && b === 'nonzero') return 'pos';
  if (b === 'nonneg' && a === 'nonzero') return 'pos';
  if (a === 'nonpos' && b === 'nonzero') return 'neg';
  if (b === 'nonpos' && a === 'nonzero') return 'neg';
  return a;
}

function factSignOne(name: string, op: string, l: SymNode, r: SymNode): Sign {
  const symSide = (t: SymNode): boolean => t.k === 'sym' && t.name === name;
  const zeroSide = (t: SymNode): boolean => (t.k === 'int' && t.v === 0n) || (t.k === 'float' && t.v === 0);
  if (symSide(l) && zeroSide(r)) {
    if (op === '>') return 'pos';
    if (op === '>=') return 'nonneg';
    if (op === '<') return 'neg';
    if (op === '<=') return 'nonpos';
    if (op === '==') return 'zero';
    if (op === '!=') return 'nonzero';
  }
  if (symSide(r) && zeroSide(l)) {
    if (op === '<') return 'pos';
    if (op === '<=') return 'nonneg';
    if (op === '>') return 'neg';
    if (op === '>=') return 'nonpos';
    if (op === '==') return 'zero';
    if (op === '!=') return 'nonzero';
  }
  return 'unknown';
}

/**
 * Sign of a node under assumptions. Propagates through sums, products, powers, exp,
 * abs, sqrt. A rule that needs a sign and gets `unknown` must not fire.
 */
export function signOf(n: SymNode, a: Assumptions): Sign {
  switch (n.k) {
    case 'int':
    case 'rat':
    case 'float':
    case 'dec':
    case 'const':
      return numberSign(n);
    case 'sym': {
      const d = a.domains.get(n.name);
      const ds: Sign = d === undefined ? 'unknown' : domainSign(d);
      return strengthen(ds, factSign(n.name, a));
    }
    case 'ref': return 'unknown';
    case 'add': {
      let s: Sign = 'zero';
      for (const t of n.terms) s = addSign(s, signOf(t, a));
      return s;
    }
    case 'mul': {
      let s: Sign = 'pos';
      for (const t of n.factors) s = mulSign(s, signOf(t, a));
      return s;
    }
    case 'pow': {
      const bs = signOf(n.base, a);
      const e = asInteger(n.exp);
      if (e !== null) {
        if (e === 0n) return 'pos';
        if (bs === 'zero') return e > 0n ? 'zero' : 'unknown';
        if ((e & 1n) === 0n) return bs === 'pos' || bs === 'neg' || bs === 'nonzero' ? 'pos' : 'nonneg';
        return bs;
      }
      const er = asRational(n.exp);
      if (er !== null && er.d === 2n && er.n === 1n) return bs === 'neg' ? 'unknown' : 'nonneg';
      if (bs === 'pos') return 'pos';
      return 'unknown';
    }
    case 'fn': {
      const s0 = n.args.length > 0 ? signOf(n.args[0] as SymNode, a) : 'unknown';
      switch (n.name) {
        case 'exp': return 'pos';
        case 'abs': return s0 === 'zero' ? 'zero' : 'nonneg';
        case 'sqrt': return s0 === 'neg' ? 'unknown' : 'nonneg';
        case 'ln': case 'log10': case 'log2': return 'unknown';
        case 'sin': case 'cos': case 'tan': return 'unknown';
        case 'floor': case 'ceil': case 'round': return s0 === 'unknown' ? 'unknown' : s0;
        case 'sign': return 'unknown';
        case 'min': case 'max': {
          let s: Sign | null = null;
          for (const arg of n.args) {
            const as = signOf(arg, a);
            s = s === null ? as : n.name === 'min' ? minSign(s, as) : maxSign(s, as);
          }
          return s ?? 'unknown';
        }
        default: return 'unknown';
      }
    }
    case 'rootof': return n.hint === 0 ? 'zero' : n.hint > 0 ? 'pos' : n.hint < 0 ? 'neg' : 'unknown';
    case 'list': return 'unknown';
    case 'piecewise': return 'unknown';
  }
}

function minSign(a: Sign, b: Sign): Sign {
  if (a === 'unknown' || b === 'unknown') return 'unknown';
  if (a === 'neg' || b === 'neg') return 'neg';
  if (a === 'nonpos' || b === 'nonpos') return 'nonpos';
  if (a === 'zero' || b === 'zero') return 'nonpos';
  if (a === 'pos' && b === 'pos') return 'pos';
  return 'nonneg';
}

function maxSign(a: Sign, b: Sign): Sign {
  if (a === 'unknown' || b === 'unknown') return 'unknown';
  if (a === 'pos' || b === 'pos') return 'pos';
  if (a === 'nonneg' || b === 'nonneg') return 'nonneg';
  if (a === 'zero' || b === 'zero') return 'nonneg';
  if (a === 'neg' && b === 'neg') return 'neg';
  return 'nonpos';
}

/** True when the node is provably an integer under the assumptions. */
export function isInteger(n: SymNode, a: Assumptions): boolean | 'unknown' {
  switch (n.k) {
    case 'int': return true;
    case 'rat': return n.d === 1n;
    case 'float': return Number.isInteger(n.v);
    case 'dec': return n.exp >= 0 ? true : 'unknown';
    case 'const': return n.name === 'i' || n.name === 'inf' ? false : 'unknown';
    case 'sym': {
      const d = a.domains.get(n.name);
      if (d === 'integer' || d === 'natural') return true;
      return 'unknown';
    }
    case 'add':
    case 'mul': {
      const parts = n.k === 'add' ? n.terms : n.factors;
      for (const t of parts) {
        const r = isInteger(t, a);
        if (r !== true) return r === false && n.k === 'mul' ? 'unknown' : r;
      }
      return true;
    }
    case 'pow': {
      const e = asInteger(n.exp);
      if (e === null || e < 0n) return 'unknown';
      return isInteger(n.base, a);
    }
    case 'fn':
      if (n.name === 'floor' || n.name === 'ceil' || n.name === 'round') return true;
      if (n.name === 'abs' || n.name === 'sign') return n.args.length > 0 ? isInteger(n.args[0] as SymNode, a) : 'unknown';
      return 'unknown';
    default: return 'unknown';
  }
}

/** True when the node is provably nonzero under the assumptions. */
export function isNonzero(n: SymNode, a: Assumptions): boolean {
  const s = signOf(n, a);
  return s === 'pos' || s === 'neg' || s === 'nonzero';
}

/** True when the node is provably positive under the assumptions. */
export function isPositive(n: SymNode, a: Assumptions): boolean {
  return signOf(n, a) === 'pos';
}

/** True when the node is provably nonnegative under the assumptions. */
export function isNonneg(n: SymNode, a: Assumptions): boolean {
  const s = signOf(n, a);
  return s === 'pos' || s === 'nonneg' || s === 'zero';
}

/**
 * Check local facts for a direct contradiction (`a > 0 and a < 0`). Returns the pair
 * when found, for the `bad_assumption` error.
 */
export function findContradiction(facts: readonly SymCond[]): { a: SymCond; b: SymCond } | null {
  const rels = facts.filter((f) => f.c === 'rel');
  for (let i = 0; i < rels.length; i++) {
    for (let j = i + 1; j < rels.length; j++) {
      const a = rels[i] as Extract<SymCond, { c: 'rel' }>;
      const b = rels[j] as Extract<SymCond, { c: 'rel' }>;
      if (contradict(a, b)) return { a, b };
    }
  }
  return null;
}

function asSymZero(c: Extract<SymCond, { c: 'rel' }>): { name: string; op: string } | null {
  const zero = (t: SymNode): boolean => t.k === 'int' && t.v === 0n;
  if (c.l.k === 'sym' && zero(c.r)) return { name: c.l.name, op: c.op };
  if (c.r.k === 'sym' && zero(c.l)) {
    const flip: Record<string, string> = { '<': '>', '<=': '>=', '>': '<', '>=': '<=', '==': '==', '!=': '!=' };
    return { name: c.r.name, op: flip[c.op] as string };
  }
  return null;
}

function contradict(a: Extract<SymCond, { c: 'rel' }>, b: Extract<SymCond, { c: 'rel' }>): boolean {
  const sa = asSymZero(a);
  const sb = asSymZero(b);
  if (sa === null || sb === null || sa.name !== sb.name) return false;
  const pair = [sa.op, sb.op].sort().join(',');
  return pair === '<,>' || pair === '<,>=' || pair === '<=,>' || pair === '==,!=' || pair === '<,==' || pair === '>,==';
}
