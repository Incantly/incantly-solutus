/**
 * Equivalence and zero tests (cas/design.md 2.2, sub-feature 12): `true` only when proved,
 * `false` only when a counter-example exists, otherwise undefined `unproven`. Proof by
 * exact normal forms; counter-examples by deterministic random-point testing (fixed seed,
 * so runs are reproducible on every machine).
 */
import type { SymCond, SymNode } from './node';
import { add, asRational, divideNodes, freeSymbols, isZeroNode, negateNode } from './node';
import { evalAt, hasImaginaryUnit, reduceImaginary, ruleCtx, simplifyNode, togetherNode } from './rules';
import type { RuleCtx } from './rules';

export type EquivVerdict = 'true' | 'false' | 'unknown';

/** Deterministic PRNG (mulberry32) with a fixed seed: reproducible counter-examples. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function testPoints(syms: readonly string[], count: number): Map<string, number>[] {
  const rand = rng(0xC0FFEE);
  const pts: Map<string, number>[] = [];
  const fixed = [-2, -1, -0.5, 0.5, 1, 2, 3];
  for (let i = 0; i < count; i++) {
    const m = new Map<string, number>();
    for (const s of syms) {
      if (i < fixed.length) m.set(s, fixed[i] as number);
      else m.set(s, (rand() * 20 - 10) * (rand() < 0.3 ? 0.1 : 1));
    }
    pts.push(m);
  }
  return pts;
}

/**
 * Try to prove `d` is zero, or find a counter-example. Exact normal forms first
 * (difference simplifies to zero, or both sides share a cancelled form), then points.
 */
export function zeroVerdict(d: SymNode, ctx: RuleCtx): EquivVerdict {
  if (isZeroNode(d)) return 'true';
  if (freeSymbols(d).size === 0) {
    const val = evalAt(d, new Map());
    if (val !== null) return Math.abs(val) < 1e-12 ? 'true' : 'false';
    return 'unknown';
  }
  if (hasImaginaryUnit(d)) {
    try {
      if (isZeroNode(reduceImaginary(d, ctx))) return 'true';
    } catch {
      void 0;
    }
  }
  const s = simplifyNode(d, ctx).node;
  if (isZeroNode(s)) return 'true';
  try {
    const tg = togetherNode(s, ctx).node;
    if (isZeroNode(tg)) return 'true';
  } catch {
    void 0;
  }
  const syms = [...freeSymbols(s)];
  let tested = 0;
  for (const pt of testPoints(syms, 24)) {
    const val = evalAt(s, pt);
    if (val === null || !Number.isFinite(val)) continue;
    tested++;
    const scale = 1 + Math.abs(val);
    if (Math.abs(val) > 1e-9 * scale) return 'false';
  }
  if (tested < 4) return 'unknown';
  return 'unknown';
}

/** `Equivalent(e1, e2)`: prove equal, find a counter-example, or give up honestly. */
export function equivalent(e1: SymNode, e2: SymNode, ctx: RuleCtx): EquivVerdict {
  if (e1 === e2) return 'true';
  return zeroVerdict(add(e1, negateNode(e2)), ctx);
}

/** `IsZero(e)`. */
export function isZeroVerdict(e: SymNode, ctx: RuleCtx): EquivVerdict {
  return zeroVerdict(e, ctx);
}

/**
 * `Equivalent(c1, c2)` for conditions, structural part: the same relation up to a nonzero
 * constant factor of both sides (`2x == 4` and `x == 2`). It only ever proves `true`; a
 * different shape says nothing about the solution sets, so the caller compares those.
 */
export function equivalentCond(c1: SymCond, c2: SymCond, ctx: RuleCtx): EquivVerdict {
  if (c1.c === 'rel' && c2.c === 'rel' && c1.op === c2.op) {
    const l = equivalent(c1.l, c2.l, ctx);
    const r = equivalent(c1.r, c2.r, ctx);
    if (l === 'true' && r === 'true') return 'true';
    const d1 = add(c1.l, negateNode(c1.r));
    const d2 = add(c2.l, negateNode(c2.r));
    if (isZeroNode(d2)) return isZeroNode(d1) ? 'true' : 'unknown';
    try {
      const ratio = asRational(togetherNode(divideNodes(d1, d2), ctx).node);
      if (ratio !== null && ratio.n !== 0n) {
        if (c1.op === '==' || c1.op === '!=') return 'true';
        if (ratio.n > 0n) return 'true';
      }
    } catch {
      void 0;
    }
    return 'unknown';
  }
  if (c1.c === 'true' && c2.c === 'true') return 'true';
  if (c1.c === 'false' && c2.c === 'false') return 'true';
  if ((c1.c === 'true' && c2.c === 'false') || (c1.c === 'false' && c2.c === 'true')) return 'false';
  if (c1.c === 'not' && c2.c === 'not') return equivalentCond(c1.of, c2.of, ctx);
  if ((c1.c === 'and' || c1.c === 'or') && c2.c === c1.c && c1.of.length === c2.of.length) {
    for (let i = 0; i < c1.of.length; i++) {
      if (equivalentCond(c1.of[i] as SymCond, c2.of[i] as SymCond, ctx) !== 'true') return 'unknown';
    }
    return 'true';
  }
  return 'unknown';
}

/** Convenience entry with a fresh context. */
export function equivalentWith(e1: SymNode, e2: SymNode): EquivVerdict {
  return equivalent(e1, e2, ruleCtx());
}
