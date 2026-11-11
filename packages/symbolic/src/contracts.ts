/**
 * Kernel handoff: the shapes the kernel and this package share (cas/design.md 5.2, 5.13, 5.15).
 *
 * The kernel is built on another branch, so this file defines the shared shapes on our side.
 * The integrator copies the value types into the kernel union and wires the command catalogue
 * below into the command table. Everything here is plain data: no DOM, no timers, no clock.
 */
import type { ObjId } from '@incantly/kernel';
import type { SymCond, SymNode } from './node';

/* --------------------------------- values ---------------------------------- */

/** The domain of a Symbol (cas/design.md 5.2). `x`, `y`, `z` are `real` by default. */
export type Domain =
  | 'real'
  | 'positive'
  | 'nonneg'
  | 'negative'
  | 'nonpos'
  | 'nonzero'
  | 'integer'
  | 'natural'
  | 'rational'
  | 'complex';

/** Display hints carried on an exact value (cas/design.md 5.2). */
export interface DisplayHints {
  /** `MixedNumber`: print `2 3/4`. */
  readonly mixed?: boolean;
  /** `Hold`: print the tree as typed. */
  readonly asTyped?: boolean;
  /** `Numeric`: show this many digits, keep trailing zeros. */
  readonly digits?: number;
}

/** An exact expression value: the canonical tree, its typed form, and holes. */
export interface ExprValue {
  readonly t: 'Expr';
  /** Canonical tree. */
  readonly e: SymNode;
  /** False as soon as any inexact number (float or decimal) appears. */
  readonly exact: boolean;
  /** Values the expression is not defined at, when simplification cancelled a factor. */
  readonly excluded?: readonly SymCond[];
  readonly display?: DisplayHints;
  /** The tree exactly as typed, kept when `Hold` was used. */
  readonly typed?: SymNode;
}

/** An equation or inequality value. */
export interface CondValue {
  readonly t: 'Cond';
  readonly c: SymCond;
  readonly exact: boolean;
}

/** An unknown with a domain. */
export interface SymbolValue {
  readonly t: 'Symbol';
  readonly name: string;
  readonly domain: Domain;
}

export type SymbolicValue = ExprValue | CondValue | SymbolValue;

/* ------------------------------ undefined cells ----------------------------- */

/** New undefined reasons this layer adds (cas/design.md 12.4). */
export type SymbolicUndefReason =
  | 'pending'
  | 'unsupported'
  | 'non_elementary'
  | 'no_limit'
  | 'divergent'
  | 'indeterminate'
  | 'unproven'
  | 'singular';

/** The detail carried on an undefined symbolic cell (cas/errors.md). */
export interface UndefinedDetail {
  /** Stable code, `Y2xx`. */
  readonly code: string;
  /** One plain sentence. */
  readonly text: string;
  /** Up to 3 complete lines that may work. */
  readonly suggest?: readonly string[];
  /** Where the engine stopped: classify, factor, isolate, integrate, … */
  readonly stage?: string;
}

/** A symbolic result cell: a value, or an honest reason (never a throw). */
export type Cell<T> = { readonly defined: true; readonly value: T } | { readonly defined: false; readonly reason: string; readonly detail?: UndefinedDetail };

export function defined<T>(value: T): Cell<T> {
  return { defined: true, value };
}

export function undefinedCell<T>(reason: string, detail?: UndefinedDetail): Cell<T> {
  return detail === undefined ? { defined: false, reason } : { defined: false, reason, detail };
}

/* --------------------------------- errors ----------------------------------- */

/** New line-error kinds (cas/errors.md 1.2). The integrator adds these to `AreaErrorKinds`. */
export type SymbolicErrorKind =
  | 'not_symbolic'
  | 'bad_variable'
  | 'time_dependent_input'
  | 'not_polynomial'
  | 'bad_digits'
  | 'bad_domain'
  | 'bad_option'
  | 'solve_arity'
  | 'bad_assumption'
  | 'redefinition_domain'
  | 'division_by_zero_literal';

/** Stable machine codes for the line errors above. */
export const SYMBOLIC_ERROR_CODES: Readonly<Record<SymbolicErrorKind, string>> = {
  not_symbolic: 'Y001',
  bad_variable: 'Y002',
  time_dependent_input: 'Y003',
  not_polynomial: 'Y004',
  bad_digits: 'Y005',
  bad_domain: 'Y006',
  bad_option: 'Y007',
  solve_arity: 'Y008',
  bad_assumption: 'Y009',
  redefinition_domain: 'Y010',
  division_by_zero_literal: 'Y011',
};

/** Notice kinds (cas/errors.md 1.3). The integrator adds these to `AreaNoticeKinds`. */
export type SymbolicNoticeKind =
  | 'numeric_fallback'
  | 'multiple_root'
  | 'irreducible'
  | 'denominator_unchecked'
  | 'real_odd_root'
  | 'precision_lost'
  | 'excluded_values'
  | 'periodic_family'
  | 'cases'
  | 'no_steps'
  | 'domain_changed'
  | 'differ_at';

export const SYMBOLIC_NOTICE_CODES: Readonly<Record<SymbolicNoticeKind, string>> = {
  numeric_fallback: 'Y101',
  multiple_root: 'Y102',
  irreducible: 'Y103',
  denominator_unchecked: 'Y104',
  real_odd_root: 'Y105',
  precision_lost: 'Y106',
  excluded_values: 'Y107',
  periodic_family: 'Y108',
  cases: 'Y109',
  no_steps: 'Y110',
  domain_changed: 'Y111',
  differ_at: 'Y112',
};

/** Stable detail codes for undefined cells (cas/errors.md 2). */
export const SYMBOLIC_UNDEF_CODES: Readonly<Record<string, string>> = {
  pending: 'Y200',
  unsupported: 'Y201',
  non_elementary: 'Y202',
  no_limit: 'Y203',
  divergent: 'Y204',
  indeterminate: 'Y205',
  unproven: 'Y206',
  singular: 'Y207',
  timeout: 'Y208',
  limit: 'Y209',
  out_of_domain: 'Y210',
  division_by_zero: 'Y211',
  index_out_of_range: 'Y212',
  not_finite: 'Y213',
};

/* ---------------------------------- limits ---------------------------------- */

export interface SymbolicLimits {
  /** Nodes in one input; above is the error `limit`. */
  readonly maxInputNodes: number;
  /** Nodes one command may create; above is undefined `limit`. */
  readonly maxNodes: number;
  /** Digits in any integer; above is undefined `limit`. */
  readonly maxDigits: number;
  /** Terms after Expand; above is undefined `limit`. */
  readonly maxExpandTerms: number;
  /** Unknowns in a system; above is `solve_arity`. */
  readonly maxSystemVars: number;
  /** Degree accepted by Factor; above is undefined `limit`. */
  readonly maxFactorDegree: number;
  /** Digits for Numeric; outside 1..200 is `bad_digits`. */
  readonly maxNumericDigits: number;
  /** Basic operations per command; above is undefined `timeout`. */
  readonly maxSteps: number;
  /** Wall time per command in ms; above is undefined `timeout` (`pending` in the fast lane). */
  readonly maxMs: number;
  /** Exact matrix size; above is undefined `limit`. */
  readonly maxMatrixSize: number;
}

export const DEFAULT_LIMITS: SymbolicLimits = {
  maxInputNodes: 20000,
  maxNodes: 200000,
  maxDigits: 100000,
  maxExpandTerms: 5000,
  maxSystemVars: 6,
  maxFactorDegree: 200,
  maxNumericDigits: 200,
  maxSteps: 2000000,
  maxMs: 1000,
  maxMatrixSize: 4,
};

/* ------------------------------- run protocol ------------------------------- */

/** Every operation `run` accepts. One per command, plus `exactOptimum` for the optimiser area. */
export type OpName =
  | 'Expr' | 'Symbol' | 'Hold' | 'Evaluate' | 'LeftSide' | 'RightSide' | 'ToFunction' | 'ToExpr' | 'ToNumber'
  | 'Simplify' | 'Expand' | 'Factor' | 'Rationalize' | 'PartialFractions' | 'CompleteSquare'
  | 'Coefficients' | 'Degree' | 'Div' | 'Mod' | 'Division' | 'GCD' | 'LCM'
  | 'Equivalent' | 'IsZero'
  | 'Solve' | 'Solutions' | 'NSolve' | 'NSolutions' | 'CSolve' | 'CSolutions'
  | 'Substitute' | 'Numeric' | 'MixedNumber' | 'Assume'
  | 'Derivative' | 'Integral' | 'Limit' | 'LimitAbove' | 'LimitBelow' | 'SolveODE'
  | 'IsPrime' | 'NextPrime' | 'PreviousPrime' | 'PrimeFactors' | 'Divisors' | 'DivisorsList' | 'DivisorsSum'
  | 'ToBase' | 'FromBase' | 'ExtendedGCD' | 'ModularExponent'
  | 'TrigExpand' | 'TrigCombine' | 'TrigSimplify'
  | 'Eigenvalues' | 'Eigenvectors' | 'CharacteristicPolynomial' | 'Inverse' | 'Determinant'
  | 'Steps';

/** Commands that must not read the clock and may go async (cas/design.md 12.2). */
export const HEAVY_OPS: ReadonlySet<OpName> = new Set<OpName>([
  'Simplify', 'Factor', 'Solve', 'Solutions', 'NSolve', 'NSolutions', 'CSolve', 'CSolutions',
  'Integral', 'Limit', 'LimitAbove', 'LimitBelow', 'SolveODE', 'PartialFractions',
  'Eigenvalues', 'Eigenvectors', 'Steps',
]);

/** A parameter case split: special values where the generic answer does not apply. */
export interface SolutionCase {
  readonly when: SymCond;
  readonly solutions: readonly SymNode[] | 'all' | 'none';
}

/** An argument to `run`: already converted to symbolic trees or plain values. */
export type SymArg =
  | { readonly k: 'expr'; readonly e: SymNode; readonly exact: boolean; readonly typed?: SymNode; readonly excluded?: readonly SymCond[]; readonly display?: DisplayHints }
  | { readonly k: 'cond'; readonly c: SymCond; readonly exact: boolean }
  | { readonly k: 'sym'; readonly name: string; readonly domain: Domain }
  | { readonly k: 'num'; readonly v: number }
  | { readonly k: 'int'; readonly v: bigint }
  | { readonly k: 'text'; readonly v: string }
  | { readonly k: 'bool'; readonly v: boolean }
  | { readonly k: 'list'; readonly items: readonly SymArg[]; readonly cases?: readonly SolutionCase[] }
  | { readonly k: 'matrix'; readonly rows: readonly (readonly SymNode[])[] }
  | { readonly k: 'function'; readonly param: string; readonly body: SymNode; readonly exact: boolean }
  | { readonly k: 'named'; readonly name: string; readonly v: SymArg };

/** A derivation step: one named rewrite (cas/design.md 5.15, 11). */
export interface Step {
  readonly rule: string;
  readonly before: SymNode;
  readonly after: SymNode;
  /** True for rewrites worth showing to a learner. */
  readonly teaching: boolean;
}

/** Context the kernel passes to `run`. */
export interface RunContext {
  /** Domains of symbols and local facts (cas/design.md 5.12). */
  readonly domains?: ReadonlyMap<string, Domain>;
  readonly facts?: readonly SymCond[];
  /** Current values of `ref` nodes the tree kept (cas/design.md 5.4). */
  readonly resolveRef?: (id: ObjId) => number | undefined;
  /** Record a derivation step; a shared no-op unless `Steps` is on. */
  readonly note?: (rule: string, before: SymNode, after: SymNode) => void;
  readonly limits?: Partial<SymbolicLimits>;
  /** Fast-lane budget in ms; when spent, heavy ops report `pending` instead of running. */
  readonly fastLaneMs?: number;
}

/* --------------------------- command catalogue data -------------------------- */

/** One parameter of a symbolic command form, for the kernel's command table. */
export interface SymbolicParam {
  readonly name: string;
  readonly type: string;
  readonly optional?: boolean;
  /** `symbolic` parameters parse `x y z` as symbols and comparisons as Conds (5.3). */
  readonly mode?: 'value' | 'symbolic';
  readonly default?: number | boolean | string;
}

/** One form of a symbolic command. */
export interface SymbolicForm {
  readonly params: readonly SymbolicParam[];
  readonly returns: string | null;
  readonly summary: string;
}

/** One command: data the integrator turns into a `CommandSpec` with `group: 'symbolic'`. */
export interface SymbolicCommand {
  readonly name: OpName;
  readonly kind: 'object' | 'action';
  readonly forms: readonly SymbolicForm[];
  readonly heavy: boolean;
}

function p(name: string, type: string, extra?: Partial<SymbolicParam>): SymbolicParam {
  return { name, type, ...extra };
}

const E = (name: string, extra?: Partial<SymbolicParam>): SymbolicParam => p(name, 'Expr', { mode: 'symbolic', ...extra });
const C = (name: string, extra?: Partial<SymbolicParam>): SymbolicParam => p(name, 'Cond', { mode: 'symbolic', ...extra });
const V = (name: string, extra?: Partial<SymbolicParam>): SymbolicParam => p(name, 'Symbol', { ...extra });

/** The full CAS command catalogue (cas/design.md 2). */
export const SYMBOLIC_COMMANDS: readonly SymbolicCommand[] = [
  { name: 'Expr', kind: 'object', heavy: false, forms: [{ params: [E('e')], returns: 'Expr', summary: 'An expression written with unknowns' }] },
  { name: 'Symbol', kind: 'object', heavy: false, forms: [{ params: [], returns: 'Symbol', summary: 'A new unknown with a domain' }] },
  { name: 'Hold', kind: 'object', heavy: false, forms: [{ params: [E('e')], returns: 'Expr', summary: 'Keep the expression exactly as typed' }] },
  { name: 'Evaluate', kind: 'object', heavy: false, forms: [{ params: [E('e')], returns: 'Expr', summary: 'Do the arithmetic only' }] },
  { name: 'LeftSide', kind: 'object', heavy: false, forms: [{ params: [C('c')], returns: 'Expr', summary: 'The left side of an equation' }] },
  { name: 'RightSide', kind: 'object', heavy: false, forms: [{ params: [C('c')], returns: 'Expr', summary: 'The right side of an equation' }] },
  { name: 'ToFunction', kind: 'object', heavy: false, forms: [{ params: [E('e'), V('v')], returns: 'Function', summary: 'A plottable function from an expression' }] },
  { name: 'ToExpr', kind: 'object', heavy: false, forms: [{ params: [p('f', 'Function')], returns: 'Expr', summary: 'The body of a function as an expression' }] },
  { name: 'ToNumber', kind: 'object', heavy: false, forms: [{ params: [E('e')], returns: 'Number', summary: 'A numeric expression as a number' }] },
  {
    name: 'Simplify', kind: 'object', heavy: true, forms: [
      { params: [E('e')], returns: 'Expr', summary: 'The simplest form of an expression' },
      { params: [C('c')], returns: 'Cond', summary: 'Simplify both sides of a condition' },
    ],
  },
  {
    name: 'Expand', kind: 'object', heavy: false, forms: [
      { params: [E('e')], returns: 'Expr', summary: 'Multiply out brackets' },
      { params: [E('e'), V('v')], returns: 'Expr', summary: 'Expand collected by a variable' },
    ],
  },
  {
    name: 'Factor', kind: 'object', heavy: true, forms: [
      { params: [E('e')], returns: 'Expr', summary: 'Factor over the rationals' },
      { params: [E('e'), p('over', 'Text', { optional: true })], returns: 'Expr', summary: 'Factor over another field' },
      { params: [p('n', 'Number')], returns: 'Expr', summary: 'Factor a whole number into primes' },
    ],
  },
  { name: 'Rationalize', kind: 'object', heavy: false, forms: [{ params: [E('e')], returns: 'Expr', summary: 'Remove surds from denominators' }] },
  { name: 'PartialFractions', kind: 'object', heavy: true, forms: [{ params: [E('e'), V('v')], returns: 'Expr', summary: 'Split a rational function into parts' }] },
  { name: 'CompleteSquare', kind: 'object', heavy: false, forms: [{ params: [E('e'), V('v')], returns: 'Expr', summary: 'Write a quadratic as a square plus a constant' }] },
  { name: 'Coefficients', kind: 'object', heavy: false, forms: [{ params: [E('e'), V('v')], returns: 'List<Expr>', summary: 'Coefficients of a polynomial, highest power first' }] },
  { name: 'Degree', kind: 'object', heavy: false, forms: [{ params: [E('e'), V('v')], returns: 'Number', summary: 'The degree of a polynomial' }] },
  {
    name: 'Div', kind: 'object', heavy: false, forms: [
      { params: [p('a', 'Number'), p('b', 'Number')], returns: 'Number', summary: 'Whole-number quotient' },
      { params: [E('a'), E('b'), V('v')], returns: 'Expr', summary: 'Polynomial quotient' },
    ],
  },
  {
    name: 'Mod', kind: 'object', heavy: false, forms: [
      { params: [p('a', 'Number'), p('b', 'Number')], returns: 'Number', summary: 'Whole-number remainder' },
      { params: [E('a'), E('b'), V('v')], returns: 'Expr', summary: 'Polynomial remainder' },
    ],
  },
  { name: 'Division', kind: 'object', heavy: false, forms: [{ params: [p('a', 'Number'), p('b', 'Number')], returns: 'List<Number>', summary: 'Quotient and remainder' }] },
  {
    name: 'GCD', kind: 'object', heavy: false, forms: [
      { params: [p('a', 'Number'), p('b', 'Number')], returns: 'Number', summary: 'Greatest common divisor' },
      { params: [p('ns', 'List<Number>')], returns: 'Number', summary: 'Greatest common divisor of a list' },
      { params: [E('a'), E('b'), V('v')], returns: 'Expr', summary: 'Polynomial greatest common divisor' },
    ],
  },
  {
    name: 'LCM', kind: 'object', heavy: false, forms: [
      { params: [p('a', 'Number'), p('b', 'Number')], returns: 'Number', summary: 'Least common multiple' },
      { params: [p('ns', 'List<Number>')], returns: 'Number', summary: 'Least common multiple of a list' },
      { params: [E('a'), E('b'), V('v')], returns: 'Expr', summary: 'Polynomial least common multiple' },
    ],
  },
  {
    name: 'Equivalent', kind: 'object', heavy: false, forms: [
      { params: [E('e1'), E('e2')], returns: 'Bool', summary: 'True only when two expressions are proved equal' },
      { params: [C('c1'), C('c2')], returns: 'Bool', summary: 'True only when two conditions are proved equal' },
    ],
  },
  { name: 'IsZero', kind: 'object', heavy: false, forms: [{ params: [E('e')], returns: 'Bool', summary: 'True only when an expression is proved zero' }] },
  {
    name: 'Solve', kind: 'object', heavy: true, forms: [
      { params: [C('c'), V('v'), p('from', 'Number', { optional: true }), p('to', 'Number', { optional: true }), p('domain', 'Text', { optional: true }), p('keep', 'List<Any>', { optional: true })], returns: 'List<Cond>', summary: 'Solve an equation or inequality' },
      { params: [p('cs', 'List<Cond>'), p('vs', 'List<Symbol>')], returns: 'List<List<Cond>>', summary: 'Solve a system' },
      { params: [C('c')], returns: 'List<Cond>', summary: 'Solve for the one free symbol' },
    ],
  },
  {
    name: 'Solutions', kind: 'object', heavy: true, forms: [
      { params: [C('c'), V('v'), p('from', 'Number', { optional: true }), p('to', 'Number', { optional: true }), p('domain', 'Text', { optional: true }), p('keep', 'List<Any>', { optional: true })], returns: 'List<Expr>', summary: 'The values that solve an equation' },
      { params: [C('c')], returns: 'List<Expr>', summary: 'The values for the one free symbol' },
    ],
  },
  {
    name: 'NSolve', kind: 'object', heavy: true, forms: [
      { params: [C('c'), V('v')], returns: 'List<Cond>', summary: 'Numeric solutions' },
      { params: [C('c'), V('v'), p('start', 'Number')], returns: 'List<Cond>', summary: 'Numeric solutions from a start' },
      { params: [C('c'), V('v'), p('from', 'Number'), p('to', 'Number')], returns: 'List<Cond>', summary: 'Numeric solutions in an interval' },
      { params: [p('cs', 'List<Cond>'), p('vs', 'List<Symbol>'), p('starts', 'List<Number>')], returns: 'List<List<Cond>>', summary: 'Numeric solutions of a system' },
    ],
  },
  {
    name: 'NSolutions', kind: 'object', heavy: true, forms: [
      { params: [C('c'), V('v')], returns: 'List<Expr>', summary: 'Numeric solution values' },
      { params: [C('c'), V('v'), p('start', 'Number')], returns: 'List<Expr>', summary: 'Numeric solution values from a start' },
      { params: [C('c'), V('v'), p('from', 'Number'), p('to', 'Number')], returns: 'List<Expr>', summary: 'Numeric solution values in an interval' },
    ],
  },
  {
    name: 'CSolve', kind: 'object', heavy: true, forms: [{ params: [C('c'), V('v')], returns: 'List<Cond>', summary: 'Solve over the complex numbers' }],
  },
  {
    name: 'CSolutions', kind: 'object', heavy: true, forms: [{ params: [C('c'), V('v')], returns: 'List<Expr>', summary: 'Complex solution values' }],
  },
  {
    name: 'Substitute', kind: 'object', heavy: false, forms: [
      { params: [E('e'), E('old'), E('new')], returns: 'Expr', summary: 'Replace a symbol or sub-expression' },
      { params: [E('e'), p('pairs', 'List<Cond>')], returns: 'Expr', summary: 'Replace several at once' },
    ],
  },
  {
    name: 'Numeric', kind: 'object', heavy: false, forms: [
      { params: [E('e')], returns: 'Expr', summary: 'A decimal value with 15 digits' },
      { params: [E('e'), p('digits', 'Number')], returns: 'Expr', summary: 'A decimal value with N digits' },
    ],
  },
  { name: 'MixedNumber', kind: 'object', heavy: false, forms: [{ params: [E('e')], returns: 'Expr', summary: 'Print a fraction as a mixed number' }] },
  { name: 'Assume', kind: 'object', heavy: false, forms: [{ params: [C('c'), E('e')], returns: 'Expr', summary: 'Compute while a condition holds' }] },
  {
    name: 'Derivative', kind: 'object', heavy: false, forms: [
      { params: [E('e'), V('v')], returns: 'Expr', summary: 'Differentiate an expression' },
      { params: [E('e'), V('v'), p('n', 'Number')], returns: 'Expr', summary: 'The n-th derivative' },
      { params: [E('e'), p('vs', 'List<Symbol>')], returns: 'Expr', summary: 'A mixed partial derivative' },
    ],
  },
  {
    name: 'Integral', kind: 'object', heavy: true, forms: [
      { params: [E('e'), V('v')], returns: 'Expr', summary: 'An antiderivative' },
      { params: [E('e'), V('v'), p('a', 'Number'), p('b', 'Number')], returns: 'Expr', summary: 'A definite integral' },
    ],
  },
  {
    name: 'Limit', kind: 'object', heavy: true, forms: [{ params: [E('e'), V('v'), p('a', 'Number')], returns: 'Expr', summary: 'A two-sided limit' }],
  },
  {
    name: 'LimitAbove', kind: 'object', heavy: true, forms: [{ params: [E('e'), V('v'), p('a', 'Number')], returns: 'Expr', summary: 'A limit from above' }],
  },
  {
    name: 'LimitBelow', kind: 'object', heavy: true, forms: [{ params: [E('e'), V('v'), p('a', 'Number')], returns: 'Expr', summary: 'A limit from below' }],
  },
  {
    name: 'SolveODE', kind: 'object', heavy: true, forms: [
      { params: [C('c'), V('y'), V('x')], returns: 'Expr', summary: 'The general solution of an ODE' },
      { params: [C('c'), V('y'), V('x'), p('init', 'List<Number>')], returns: 'Expr', summary: 'A particular solution through a point' },
    ],
  },
  { name: 'IsPrime', kind: 'object', heavy: false, forms: [{ params: [p('n', 'Number')], returns: 'Bool', summary: 'True when a whole number is prime' }] },
  { name: 'NextPrime', kind: 'object', heavy: false, forms: [{ params: [p('n', 'Number')], returns: 'Number', summary: 'The next prime above a number' }] },
  { name: 'PreviousPrime', kind: 'object', heavy: false, forms: [{ params: [p('n', 'Number')], returns: 'Number', summary: 'The prime below a number' }] },
  { name: 'PrimeFactors', kind: 'object', heavy: false, forms: [{ params: [p('n', 'Number')], returns: 'List<Number>', summary: 'Prime factors with repeats' }] },
  { name: 'Divisors', kind: 'object', heavy: false, forms: [{ params: [p('n', 'Number')], returns: 'Number', summary: 'How many divisors a number has' }] },
  { name: 'DivisorsList', kind: 'object', heavy: false, forms: [{ params: [p('n', 'Number')], returns: 'List<Number>', summary: 'Every divisor of a number' }] },
  { name: 'DivisorsSum', kind: 'object', heavy: false, forms: [{ params: [p('n', 'Number')], returns: 'Number', summary: 'The sum of the divisors' }] },
  { name: 'ToBase', kind: 'object', heavy: false, forms: [{ params: [p('n', 'Number'), p('b', 'Number')], returns: 'Text', summary: 'Write a number in another base' }] },
  { name: 'FromBase', kind: 'object', heavy: false, forms: [{ params: [p('text', 'Text'), p('b', 'Number')], returns: 'Number', summary: 'Read a number from another base' }] },
  { name: 'ExtendedGCD', kind: 'object', heavy: false, forms: [{ params: [p('a', 'Number'), p('b', 'Number')], returns: 'List<Number>', summary: '[g, s, t] with s a + t b == g' }] },
  { name: 'ModularExponent', kind: 'object', heavy: false, forms: [{ params: [p('a', 'Number'), p('e', 'Number'), p('m', 'Number')], returns: 'Number', summary: 'a^e mod m' }] },
  { name: 'TrigExpand', kind: 'object', heavy: false, forms: [{ params: [E('e')], returns: 'Expr', summary: 'Expand trig of sums into products' }] },
  { name: 'TrigCombine', kind: 'object', heavy: false, forms: [{ params: [E('e')], returns: 'Expr', summary: 'Combine trig products into sums' }] },
  { name: 'TrigSimplify', kind: 'object', heavy: false, forms: [{ params: [E('e')], returns: 'Expr', summary: 'Simplify with trig identities' }] },
  { name: 'Eigenvalues', kind: 'object', heavy: true, forms: [{ params: [p('m', 'Matrix')], returns: 'List<Expr>', summary: 'Eigenvalues of a small exact matrix' }] },
  { name: 'Eigenvectors', kind: 'object', heavy: true, forms: [{ params: [p('m', 'Matrix')], returns: 'List<List<Expr>>', summary: 'Eigenvectors of a small exact matrix' }] },
  { name: 'CharacteristicPolynomial', kind: 'object', heavy: true, forms: [{ params: [p('m', 'Matrix')], returns: 'Expr', summary: 'det(M - x I)' }] },
  { name: 'Inverse', kind: 'object', heavy: true, forms: [{ params: [p('m', 'Matrix')], returns: 'Matrix', summary: 'The inverse of a matrix' }] },
  { name: 'Determinant', kind: 'object', heavy: true, forms: [{ params: [p('m', 'Matrix')], returns: 'Expr', summary: 'The determinant of a matrix' }] },
  { name: 'Steps', kind: 'object', heavy: true, forms: [{ params: [p('cmd', 'Text')], returns: 'List<Text>', summary: 'The teaching steps of a derivation' }] },
];
