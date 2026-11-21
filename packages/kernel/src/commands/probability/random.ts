/**
 * Seeded randomness (docs/features/probability/design.md 6): a counter-based generator whose output is a pure function of
 * a key and a draw index, so a figure gives the same numbers on every machine and every replay, and a sample keeps its
 * first values when it grows.
 *
 * Generator version `v1`. Changing anything here changes every saved figure that uses randomness.
 *
 * No DOM, no timers, no Date, no Math.random.
 */
import type { RandomContext } from '../../graph/registry';

/** A 32-bit avalanche mixer (two multiply-xorshift rounds). */
export function mix32(x: number): number {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d);
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** FNV-1a of a text, 32 bits. */
export function fnv32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A whole number folded to 32 bits (negative and large values keep distinct words). */
const word = (x: number): number => {
  if (!Number.isFinite(x)) return 0;
  const t = Math.trunc(x);
  return (mix32((t >>> 0) ^ mix32(Math.floor(t / 4294967296) >>> 0)) ^ (t < 0 ? 0x9e3779b9 : 0)) >>> 0;
};

/** The two key words of a random call (design 6.2). */
export interface Key {
  readonly a: number;
  readonly b: number;
}

/** The key of a random command from its context and its `seed =` argument. */
export function keyOf(ctx: RandomContext, seedArg: number): Key {
  let a = mix32(word(ctx.seed) ^ 0x243f6a88);
  a = mix32(a ^ fnv32(ctx.owner));
  a = mix32(a ^ word(ctx.site));
  let b = mix32(word(ctx.count) ^ 0x85a308d3);
  b = mix32(b ^ word(seedArg));
  b = mix32(b ^ word(ctx.reroll));
  b = mix32(b ^ a);
  a = mix32(a ^ b);
  return { a, b };
}

const TWO26 = 67108864;
const TWO53 = 9007199254740992;

/**
 * Sub-stream `index` of a key: a function returning uniforms in (0, 1) with 53 bits, never 0 or 1. Draw `i` of a sample
 * uses sub-stream `i`, so it may take as many uniforms as it needs without moving later draws.
 */
export function streamFor(key: Key, index: number): () => number {
  const i = index >= 0 && index < 4294967296 && Number.isInteger(index) ? index >>> 0 : word(index);
  const s = mix32(key.a ^ Math.imul(i, 0x9e3779b9));
  const t = mix32((key.b + i) >>> 0) ^ s;
  let m = 0;
  return () => {
    m++;
    const hi = mix32((s + Math.imul(m, 0x632be5ab)) >>> 0);
    const lo = mix32((hi ^ t ^ Math.imul(m, 0x85ebca6b)) >>> 0);
    return ((hi >>> 5) * TWO26 + (lo >>> 6) + 0.5) / TWO53;
  };
}
