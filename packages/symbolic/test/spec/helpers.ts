/**
 * Shared helpers for the symbolic spec tests. Imports only from the package's public entry.
 * Everything here is built from the docs (docs/features/cas/*, the symbolic parts of
 * docs/features/optimisation-discrete/*, docs/features/language/rulings.md), never from
 * the implementation.
 */
import { expect } from 'vitest';
import {
  condText,
  evalAt,
  parseCondition,
  parseExpression,
  run,
  toText,
} from '@incantly/symbolic/engine';
import type {
  Cell,
  Domain,
  ErrorObject,
  Notice,
  OpName,
  Result,
  RunContext,
  RunOptions,
  RunSuccess,
  SymArg,
  SymCond,
  SymNode,
  UndefinedDetail,
} from '@incantly/symbolic/engine';

// ---------------------------------------------------------------------------------------------
// Argument builders (SymArg shapes from the public contracts)
// ---------------------------------------------------------------------------------------------

/** An exact expression argument parsed from our syntax. */
export const ex = (s: string): SymArg => ({ k: 'expr', e: parseExpression(s), exact: true });

/** A condition argument parsed from our syntax. */
export const cd = (s: string): SymArg => ({ k: 'cond', c: parseCondition(s), exact: true });

/** A symbol argument. `x`, `y`, `z` are real by default (design 5.3, 5.12). */
export const sy = (name: string, domain: Domain = 'real'): SymArg => ({ k: 'sym', name, domain });

/** A whole/decimal number argument. */
export const nm = (v: number): SymArg => ({ k: 'num', v });

/** An exact big integer argument. */
export const bi = (v: bigint): SymArg => ({ k: 'int', v });

/** A text argument. */
export const tx = (v: string): SymArg => ({ k: 'text', v });

/** A list argument. */
export const li = (items: readonly SymArg[]): SymArg => ({ k: 'list', items });

/** A named (`name = value`) argument. */
export const named = (name: string, v: SymArg): SymArg => ({ k: 'named', name, v });

/** A matrix argument from rows of expression text. */
export const mt = (rows: readonly (readonly string[])[]): SymArg => ({
  k: 'matrix',
  rows: rows.map((r) => r.map((s) => parseExpression(s))),
});

/** The parsed tree of an expression text (for white-box engine checks). */
export const tree = (s: string): SymNode => parseExpression(s);

/** The parsed tree of a condition text. */
export const cond = (s: string): SymCond => parseCondition(s);

// ---------------------------------------------------------------------------------------------
// Running an op
// ---------------------------------------------------------------------------------------------

/** The runtime shape of a successful `run`: the cell plus any notices. */
export interface RunValue {
  readonly cell: Cell<SymArg>;
  readonly notices: readonly Notice[];
}

export function ran(op: OpName, args: readonly SymArg[], opts?: RunOptions, ctx?: RunContext): RunValue {
  const r: Result<RunSuccess> = run(op, args, opts, ctx);
  if (!r.ok) {
    const e = r as ErrorObject;
    throw new Error(`run(${op}) returned error ${e.kind} (${e.code}): ${e.message}`);
  }
  return { cell: r.value.cell, notices: r.notices };
}

/** Run an op and return its defined value, failing when the cell is undefined or an error. */
export function val(op: OpName, args: readonly SymArg[], opts?: RunOptions, ctx?: RunContext): SymArg {
  const { cell } = ran(op, args, opts, ctx);
  if (!cell.defined) {
    const d = cell.detail;
    throw new Error(`run(${op}) is undefined (${cell.reason}${d === undefined ? '' : `: ${d.text}`})`);
  }
  return cell.value;
}

/** A short readable form of a value, safe for bigint contents. */
export function showArg(v: SymArg): string {
  switch (v.k) {
    case 'expr':
      return toText(v.e);
    case 'cond':
      return condText(v.c);
    case 'list':
      return `[${v.items.map(showArg).join(', ')}]`;
    case 'num':
    case 'int':
    case 'bool':
      return String(v.v);
    case 'text':
      return JSON.stringify(v.v);
    case 'sym':
      return v.name;
    default:
      return v.k;
  }
}

/** Run an op expected to be undefined: returns reason + detail. */
export function undef(
  op: OpName,
  args: readonly SymArg[],
  opts?: RunOptions,
  ctx?: RunContext,
): { reason: string; detail: UndefinedDetail | undefined } {
  const { cell } = ran(op, args, opts, ctx);
  if (cell.defined) throw new Error(`run(${op}) unexpectedly defined: ${showArg(cell.value)}`);
  return { reason: cell.reason, detail: cell.detail };
}

/** Run an op expected to fail with a line error: returns the error object. */
export function err(op: OpName, args: readonly SymArg[], opts?: RunOptions, ctx?: RunContext): ErrorObject {
  const r: Result<RunSuccess> = run(op, args, opts, ctx);
  if (r.ok) throw new Error(`run(${op}) unexpectedly succeeded`);
  return r as ErrorObject;
}

// ---------------------------------------------------------------------------------------------
// Reading values out
// ---------------------------------------------------------------------------------------------

export function asExpr(v: SymArg, what: string): SymNode {
  if (v.k !== 'expr') throw new Error(`${what}: expected expr, got ${v.k}`);
  return v.e;
}

export function asNum(v: SymArg, what: string): number {
  if (v.k !== 'num') throw new Error(`${what}: expected num, got ${v.k}`);
  return v.v;
}

export function asBool(v: SymArg, what: string): boolean {
  if (v.k !== 'bool') throw new Error(`${what}: expected bool, got ${v.k}`);
  return v.v;
}

export function asText(v: SymArg, what: string): string {
  if (v.k !== 'text') throw new Error(`${what}: expected text, got ${v.k}`);
  return v.v;
}

export function asList(v: SymArg, what: string): readonly SymArg[] {
  if (v.k !== 'list') throw new Error(`${what}: expected list, got ${v.k}`);
  return v.items;
}

export function asCond(v: SymArg, what: string): SymCond {
  if (v.k !== 'cond') throw new Error(`${what}: expected cond, got ${v.k}`);
  return v.c;
}

/** The printed text of an op result that is an Expr. */
export function exprText(op: OpName, args: readonly SymArg[], opts?: RunOptions, ctx?: RunContext): string {
  return toText(asExpr(val(op, args, opts, ctx), `${op} result`));
}

/** The printed texts of an op result that is a list of Conds. */
export function condTexts(op: OpName, args: readonly SymArg[], opts?: RunOptions, ctx?: RunContext): string[] {
  return asList(val(op, args, opts, ctx), `${op} result`).map((item) => condText(asCond(item, `${op} item`)));
}

/** The printed texts of an op result that is a list of Exprs. */
export function exprTexts(op: OpName, args: readonly SymArg[], opts?: RunOptions, ctx?: RunContext): string[] {
  return asList(val(op, args, opts, ctx), `${op} result`).map((item) => toText(asExpr(item, `${op} item`)));
}

/** The exact flag of an op result that is an Expr. */
export function exprExact(op: OpName, args: readonly SymArg[], opts?: RunOptions, ctx?: RunContext): boolean {
  const v = val(op, args, opts, ctx);
  if (v.k !== 'expr') throw new Error(`${op}: expected expr, got ${v.k}`);
  return v.exact;
}

/** Notices of an op run, by kind. */
export function noticeKinds(op: OpName, args: readonly SymArg[], opts?: RunOptions, ctx?: RunContext): string[] {
  return ran(op, args, opts, ctx).notices.map((n) => n.kind);
}

// ---------------------------------------------------------------------------------------------
// Equivalence: "prove equal, or fail" (design 2.2: true only when proved)
// ---------------------------------------------------------------------------------------------

/** True when `Equivalent(a, b)` proves equality (fails the test on `false` or `unproven`). */
export function provedEqual(a: string, b: string): boolean {
  const v = val('Equivalent', [ex(a), ex(b)]);
  return asBool(v, `Equivalent(${a}, ${b})`);
}

export function expectProvedEqual(a: string, b: string): void {
  expect(provedEqual(a, b), `Equivalent(${a}, ${b}) should be proved true`).toBe(true);
}

/** The raw Equivalent verdict: true, false, or 'unproven' (undefined cell). */
export function equivVerdict(a: string, b: string): boolean | 'unproven' {
  const { cell } = ran('Equivalent', [ex(a), ex(b)]);
  if (!cell.defined) {
    if (cell.reason !== 'unproven') throw new Error(`Equivalent(${a}, ${b}): reason ${cell.reason}`);
    return 'unproven';
  }
  return asBool(cell.value, 'Equivalent');
}

// ---------------------------------------------------------------------------------------------
// Error shape (docs/features/errors/design.md 3)
// ---------------------------------------------------------------------------------------------

/** Every error object carries the unified fields. */
export function expectWellFormed(e: ErrorObject): void {
  expect(e.ok).toBe(false);
  expect(e.committed).toBe(false);
  expect(e.severity).toBe('error');
  expect(e.code).toMatch(/^[A-Z]\d{3}$/);
  expect(typeof e.kind).toBe('string');
  expect(e.message.length).toBeGreaterThan(0);
  expect(e.messageKey.length).toBeGreaterThan(0);
  expect(e.fingerprint.length).toBeGreaterThan(0);
  expect(Array.isArray(e.expected)).toBe(true);
  expect(Array.isArray(e.forms)).toBe(true);
  expect(Array.isArray(e.suggest)).toBe(true);
  expect(e.suggest.length).toBeLessThanOrEqual(3);
  expect(e.line).toBeGreaterThanOrEqual(1);
  expect(e.col).toBeGreaterThanOrEqual(1);
  expect(e.endCol).toBeGreaterThanOrEqual(e.col);
}

/** Small deterministic PRNG for generated tests (mulberry32). */
export function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// Independent numeric checks (do not depend on Equivalent, which is itself under test)
// ---------------------------------------------------------------------------------------------

/** Value of an expression node at the given variable values; null when it is not a finite number. */
export function numericAt(n: SymNode, vals: Readonly<Record<string, number>> = {}): number | null {
  const v = evalAt(n, new Map(Object.entries(vals)));
  return v === null || !Number.isFinite(v) ? null : v;
}

/** Value of an expression text at the given variable values (fails when it is not a number). */
export function numeric(text: string, vals: Readonly<Record<string, number>> = {}): number {
  const v = numericAt(parseExpression(text), vals);
  if (v === null) throw new Error(`"${text}" is not a finite number at ${JSON.stringify(vals)}`);
  return v;
}

/** Sample points (away from simple poles) used by the numeric agreement check. */
export const SAMPLE_POINTS: readonly number[] = [0.37, 0.91, 1.43, 2.17, 3.29, -0.52, -1.7, 4.6];

/**
 * True when the two expression texts agree numerically at every sample point where both are
 * defined, and are defined together at (at least) `minPoints` points. Variables: the single
 * name given (default `x`), other names are set to fixed values from `extra`.
 */
export function agree(
  a: string,
  b: string,
  v = 'x',
  extra: Readonly<Record<string, number>> = {},
  minPoints = 3,
): boolean {
  const ta = parseExpression(a);
  const tb = parseExpression(b);
  let both = 0;
  for (const p of SAMPLE_POINTS) {
    const env = { ...extra, [v]: p };
    const va = numericAt(ta, env);
    const vb = numericAt(tb, env);
    if (va === null || vb === null) continue;
    both += 1;
    const tol = 1e-8 * Math.max(1, Math.abs(va), Math.abs(vb));
    if (Math.abs(va - vb) > tol) return false;
  }
  return both >= minPoints;
}

export function expectAgree(a: string, b: string, v = 'x', extra: Readonly<Record<string, number>> = {}): void {
  expect(agree(a, b, v, extra), `"${a}" should equal "${b}" numerically`).toBe(true);
}

/** Numeric value of an Expr result of an op. */
export function numResult(op: OpName, args: readonly SymArg[], opts?: RunOptions, ctx?: RunContext): number {
  const e = asExpr(val(op, args, opts, ctx), `${op} result`);
  const v = numericAt(e);
  if (v === null) throw new Error(`${op} result ${toText(e)} is not a finite number`);
  return v;
}

/** A whole or real result as a JS number, whether the op returned Number, big integer or Expr. */
export function scalarOf(v: SymArg, what: string): number {
  if (v.k === 'num') return v.v;
  if (v.k === 'int') return Number(v.v);
  if (v.k === 'expr') {
    const n = numericAt(v.e);
    if (n === null) throw new Error(`${what}: ${toText(v.e)} is not a finite number`);
    return n;
  }
  throw new Error(`${what}: expected a number, got ${v.k}`);
}

/** A whole-number result as an exact bigint (Number, big integer or integer Expr). */
export function bigOf(v: SymArg, what: string): bigint {
  if (v.k === 'int') return v.v;
  if (v.k === 'num') {
    if (!Number.isInteger(v.v)) throw new Error(`${what}: ${v.v} is not a whole number`);
    return BigInt(v.v);
  }
  if (v.k === 'expr') return BigInt(toText(v.e));
  throw new Error(`${what}: expected a whole number, got ${v.k}`);
}

export function scalar(op: OpName, args: readonly SymArg[], opts?: RunOptions, ctx?: RunContext): number {
  return scalarOf(val(op, args, opts, ctx), `${op} result`);
}
