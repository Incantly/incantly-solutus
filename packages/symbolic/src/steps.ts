/**
 * Steps (cas/design.md 11): derivations as data. Every rewrite notes its rule id; this
 * module turns teaching steps into text lines through a phrase table keyed by rule id,
 * so phrases can be reviewed and localised. Lines print with `toText`, so products use
 * `*` and every line stays re-enterable.
 */
import type { Step } from './contracts';
import type { SymNode } from './node';
import { toText } from './print';

/** Which rule ids are worth showing to a learner. */
export const TEACHING_RULES: ReadonlySet<string> = new Set([
  'pow.power', 'roots.square', 'roots.pull', 'roots.rationalize', 'log.split', 'abs.split',
  'trig.pythagoras', 'trig.double', 'simplify.choose',
  'factor.int', 'factor.poly', 'factor.complex',
  'rationalize.numeric', 'rationalize.conj', 'square.complete',
  'trig.expand', 'trig.combine', 'trig.linear', 'trig.tan',
  'rational.cancel',
  'solve.factor', 'solve.clear', 'solve.radical', 'solve.substitute', 'solve.trig', 'solve.abs',
]);

type Phrase = (before: SymNode, after: SymNode) => string;

const t = (n: SymNode): string => toText(n);

/** The phrase table: one line builder per rule id. */
export const PHRASES: Readonly<Record<string, Phrase>> = {
  'pow.power': (b, a) => `Combine the powers in ${t(b)}: ${t(a)}`,
  'roots.square': (_b, a) => `A square under a root gives an absolute value: ${t(a)}`,
  'roots.rationalize': (_b, a) => `Move the root out of the denominator: ${t(a)}`,
  'roots.pull': (_b, a) => `Take the perfect square out of the root: ${t(a)}`,
  'log.split': (_b, a) => `Split the logarithm: ${t(a)}`,
  'abs.split': (_b, a) => `Drop the absolute value: ${t(a)}`,
  'trig.pythagoras': (_b, a) => `Use sine squared plus cosine squared equals one: ${t(a)}`,
  'trig.double': (_b, a) => `Use the double-angle identity: ${t(a)}`,
  'simplify.choose': (_b, a) => `Simplify: ${t(a)}`,
  'factor.int': (_b, a) => `Factor into primes: ${t(a)}`,
  'factor.poly': (_b, a) => `Factor: ${t(a)}`,
  'factor.complex': (_b, a) => `Split over the complex numbers: ${t(a)}`,
  'rationalize.numeric': (b, a) => `Write ${t(b)} as a fraction: ${t(a)}`,
  'rationalize.conj': (_b, a) => `Multiply top and bottom by the conjugate: ${t(a)}`,
  'square.complete': (_b, a) => `Complete the square: ${t(a)}`,
  'trig.expand': (_b, a) => `Expand the trig of a sum: ${t(a)}`,
  'trig.combine': (_b, a) => `Combine the products into sums: ${t(a)}`,
  'trig.linear': (_b, a) => `Combine into one sine: ${t(a)}`,
  'trig.tan': (_b, a) => `Write tangent as sine over cosine: ${t(a)}`,
  'rational.cancel': (_b, a) => `Cancel the common factor: ${t(a)}`,
  'solve.factor': (b, a) => `Factor ${t(b)} and solve each factor: ${t(a)}`,
  'solve.clear': (_b, a) => `Clear denominators: ${t(a)} = 0`,
  'solve.radical': (_b, a) => `Isolate the radical and raise to the power: ${t(a)} = 0`,
  'solve.substitute': (_b, a) => `Substitute and solve: ${t(a)}`,
  'solve.trig': (b, a) => `Solve ${t(b)} = 0 with the base solutions: ${t(a)}`,
  'solve.abs': (_b, a) => `Split by the sign of the absolute value: ${t(a)}`,
};

export interface StepsText {
  readonly lines: readonly string[];
  /** True when no step had a phrase (`no_steps` notice, single fallback line). */
  readonly noSteps: boolean;
}

/**
 * Format a derivation: teaching steps with phrases, capped at 12 lines (the rest is
 * merged into "simplify"). Steps without a phrase are skipped; with none at all, one
 * fallback line and `noSteps`.
 */
export function stepsToText(steps: readonly Step[]): StepsText {
  const teaching = steps.filter((s) => s.teaching && PHRASES[s.rule] !== undefined);
  if (teaching.length === 0) return { lines: ['(no steps available)'], noSteps: true };
  if (teaching.length <= 12) {
    return { lines: teaching.map((s) => (PHRASES[s.rule] as Phrase)(s.before, s.after)), noSteps: false };
  }
  const head = teaching.slice(0, 11).map((s) => (PHRASES[s.rule] as Phrase)(s.before, s.after));
  const last = teaching[teaching.length - 1] as Step;
  return { lines: [...head, `Simplify to ${t(last.after)}`], noSteps: false };
}

/* ------------------------------ command calls --------------------------------- */

export interface ParsedCall {
  readonly op: string;
  /** Positional arguments as source text. */
  readonly args: readonly string[];
  /** Named arguments as source text by name. */
  readonly named: ReadonlyMap<string, string>;
}

/**
 * Parse `Name(arg, arg, name = value)` for `Steps(cmd)`. Arguments stay source text;
 * the caller parses each one. Throws a plain `Error` with a span-free message.
 */
export function parseCommandCall(text: string): ParsedCall {
  const m = /^([A-Za-z][A-Za-z0-9]*)\((.*)\)$/.exec(text.trim());
  if (m === null) throw new Error(`Steps needs a command call such as Solve(x^2 - 1 == 0, x); got: ${text}`);
  const op = m[1] as string;
  const body = m[2] as string;
  const args: string[] = [];
  const named = new Map<string, string>();
  let depth = 0;
  let cur = '';
  const parts: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim() !== '' || parts.length > 0) parts.push(cur);
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq > 0 && !p.slice(0, eq).includes('(') && /^[A-Za-z][A-Za-z0-9]*\s*$/.test(p.slice(0, eq))) {
      const name = p.slice(0, eq).trim();
      const value = p.slice(eq + 1).trim();
      if (value.startsWith('=')) {
        args.push(p.trim());
      } else {
        named.set(name, value);
      }
    } else {
      args.push(p.trim());
    }
  }
  return { op, args, named };
}
