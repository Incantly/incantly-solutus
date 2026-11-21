/**
 * Value shapes and registries of the lists-matrices area (docs/features/lists-matrices/design.md 3, 5, 7).
 *
 * A list of numbers is a `Float64Array` and any other list an array of values (language design 3.10). A matrix is a
 * rectangular row-major `Float64Array`, with an exact rational grid when every entry came from a number literal. A
 * record is a fixed set of named fields from one command form.
 *
 * No DOM, no timers, no Date.
 */
import type { Pt } from '../../contracts/values';
import type { Ty } from '../../language/types';

declare module '../../contracts/values' {
  interface AreaTypeNames {
    // lists-matrices
    Matrix: true;
    Record: true;
  }
  interface AreaUndefReasons {
    // lists-matrices
    size_mismatch: true;
    not_rectangular: true;
    not_square: true;
    singular: true;
    not_positive_definite: true;
    complex_eigenvalues: true;
    needs_exact: true;
    bad_step: true;
    point_at_infinity: true;
    too_large: true;
    empty_matrix: true;
    has_undefined: true;
  }
}

/* ------------------------------ matrices ------------------------------ */

/** An exact entry: numerator and denominator, the denominator positive and the fraction in lowest terms. */
export interface Rat {
  readonly n: bigint;
  readonly d: bigint;
}

export interface MatrixValue {
  readonly kind: 'matrix';
  readonly rows: number;
  readonly cols: number;
  /** Row-major, `rows * cols` entries. */
  readonly data: Float64Array;
  /** Present when every entry is a small exact rational (design 5.3); `data` holds the nearest doubles. */
  readonly exact?: readonly Rat[];
}

export function isMatrix(v: unknown): v is MatrixValue {
  return typeof v === 'object' && v !== null && (v as { kind?: unknown }).kind === 'matrix';
}

export function makeMatrix(rows: number, cols: number, data: Float64Array, exact?: readonly Rat[]): MatrixValue {
  return exact ? { kind: 'matrix', rows, cols, data, exact } : { kind: 'matrix', rows, cols, data };
}

export function zeros(rows: number, cols: number): MatrixValue {
  return makeMatrix(rows, cols, new Float64Array(rows * cols));
}

export function identity(n: number): MatrixValue {
  const d = new Float64Array(n * n);
  for (let i = 0; i < n; i++) d[i * n + i] = 1;
  return makeMatrix(n, n, d);
}

/* ------------------------------ records ------------------------------ */

export interface RecordValue {
  readonly kind: 'record';
  readonly schema: string;
  /** A field is `undefined` when it has no value (its reason is in `reasons`). */
  readonly fields: Readonly<Record<string, unknown>>;
  readonly reasons?: Readonly<Record<string, string>>;
}

export function isRecord(v: unknown): v is RecordValue {
  return typeof v === 'object' && v !== null && (v as { kind?: unknown }).kind === 'record';
}

/** Field names and types of each record schema (design 7), fixed per command form. */
export const RECORD_SCHEMAS: Readonly<Record<string, readonly { readonly name: string; readonly ty: Ty }[]>> = {};

const schemas = RECORD_SCHEMAS as Record<string, readonly { readonly name: string; readonly ty: Ty }[]>;

/** Adds a schema; another area (statistics, probability) adds its own the same way. The first definition wins. */
export function registerRecordSchema(name: string, fields: readonly { readonly name: string; readonly ty: Ty }[]): void {
  if (!Object.hasOwn(schemas, name)) schemas[name] = fields;
}

/** Summary text of a record, per schema; other areas add their own (a fit prints its equation). */
export const RECORD_TEXT = new Map<string, (r: RecordValue) => string>();

/** Adds the summary text of a schema. The first definition wins. */
export function registerRecordText(schema: string, text: (r: RecordValue) => string): void {
  if (!RECORD_TEXT.has(schema)) RECORD_TEXT.set(schema, text);
}

export function record(schema: string, fields: Readonly<Record<string, unknown>>, reasons?: Readonly<Record<string, string>>): RecordValue {
  return reasons && Object.keys(reasons).length > 0 ? { kind: 'record', schema, fields, reasons } : { kind: 'record', schema, fields };
}

/* ------------------------------ lists ------------------------------ */

/** Limits (errors 5). */
export const MAX_LIST = 1_000_000;
export const MAX_LEAVES = 4_000_000;
export const MAX_DENSE = 300;
export const MAX_SYM_EIGEN = 150;
export const MAX_EIGEN = 100;
export const MAX_EXACT = 12;
export const MAX_EXACT_BITS = 4096;

export const isPt = (v: unknown): v is Pt => typeof (v as Pt | undefined)?.x === 'number' && typeof (v as Pt).y === 'number';

/** The items of a list value as an array (numbers from a `Float64Array`). */
export function itemsOf(v: unknown): unknown[] | undefined {
  if (v instanceof Float64Array) return Array.from(v);
  if (Array.isArray(v)) return v as unknown[];
  return undefined;
}

/** A list value from items: numbers become a `Float64Array`. */
export function listFrom(items: readonly unknown[], numeric: boolean): unknown {
  if (numeric) {
    const out = new Float64Array(items.length);
    for (let i = 0; i < items.length; i++) out[i] = items[i] as number;
    return out;
  }
  return items.slice();
}

/** Equality of two values of the same type, exact (design 3.1): numbers, texts, Bools, points, lists, matrices. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return a === b || (a !== a && b !== b);
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (isMatrix(a) && isMatrix(b)) {
    if (a.rows !== b.rows || a.cols !== b.cols) return false;
    for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
    return true;
  }
  const la = itemsOf(a);
  const lb = itemsOf(b);
  if (la && lb) {
    if (la.length !== lb.length) return false;
    for (let i = 0; i < la.length; i++) if (!sameValue(la[i], lb[i])) return false;
    return true;
  }
  if (isPt(a) && isPt(b)) return a.x === b.x && a.y === b.y;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}
