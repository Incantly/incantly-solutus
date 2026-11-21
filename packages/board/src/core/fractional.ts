/**
 * Fractional order keys (design 4: `index`). A key is a string of base-62 digits read as a fraction between 0 and 1;
 * keys sort as plain strings, so moving one shape or page never rewrites another. A key never ends in the digit `0`, so
 * there is always a key between two different keys. Keys grow by about one character for every five inserts at the
 * same place.
 */
import { boardError, ok } from './errors';
import type { BoardError, BoardResult } from './errors';

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;

/** The first key of an empty list. */
export const FIRST_KEY = 'V';

/** The value of a digit character code, or -1. The values follow the character order, so strings sort as numbers. */
function digitOf(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 90) return code - 55;
  if (code >= 97 && code <= 122) return code - 61;
  return -1;
}

/** True for a well-formed key: digits only, not empty, not ending in `0`. */
export function isKey(key: unknown): key is string {
  if (typeof key !== 'string' || key === '' || key.endsWith('0')) return false;
  for (let i = 0; i < key.length; i++) if (digitOf(key.charCodeAt(i)) < 0) return false;
  return true;
}

/** A fraction strictly between `a` (empty for 0) and `b` (null for 1). Requires `a < b`. */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a === '' ? 0 : digitOf(a.charCodeAt(0));
  const db = b === null ? BASE : digitOf(b.charCodeAt(0));
  if (db - da > 1) return DIGITS.charAt(Math.round((da + db) / 2));
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS.charAt(da) + midpoint(a.slice(1), null);
}

/** A key between `a` and `b`; null means no neighbour on that side. Needs `a < b`. */
export function keyBetween(a: string | null, b: string | null): BoardResult<string> {
  if (a !== null && !isKey(a)) return boardError('bad_argument', `"${a}" is not an order key.`, { detail: { key: a } });
  if (b !== null && !isKey(b)) return boardError('bad_argument', `"${b}" is not an order key.`, { detail: { key: b } });
  if (a !== null && b !== null && a >= b) {
    return boardError('bad_argument', 'The lower order key must be less than the upper one.', { detail: { a, b } });
  }
  return ok(midpoint(a ?? '', b));
}

/** `count` keys in order, all between `a` and `b`, spread evenly so the keys stay short. */
export function keysBetween(a: string | null, b: string | null, count: number): BoardResult<readonly string[]> {
  if (!Number.isInteger(count) || count < 0 || count > 100_000) {
    return boardError('bad_argument', 'The number of keys must be a whole number from 0 to 100,000.', { detail: { count } });
  }
  const out: string[] = [];
  const fill = (lo: string | null, hi: string | null, n: number): BoardError | undefined => {
    if (n === 0) return undefined;
    const mid = keyBetween(lo, hi);
    if (!mid.ok) return mid;
    const left = Math.floor((n - 1) / 2);
    const first = fill(lo, mid.value, left);
    if (first) return first;
    out.push(mid.value);
    return fill(mid.value, hi, n - 1 - left);
  };
  const failed = fill(a, b, count);
  return failed ?? ok(out);
}
