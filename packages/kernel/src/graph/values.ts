/**
 * Value equality (the early cut-off of kernel design 6.3) and value text for scripts.
 */
import type { Ty } from '../language/types';

/**
 * Structural equality of two stored values. Numbers compare with `NaN` equal to `NaN` and `-0` equal to `0`.
 * Functions, relations and anything else with a method compare by identity: a rule that ran again made a new one,
 * and whatever reads it must run again.
 */
export function sameValue(a: unknown, b: unknown, depth = 0): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return a !== a && b !== b;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || depth > 8) return false;
  // (numbers inside a list are compared in line, and the keys of an object walked with `for … in`: a call made with each
  // number, and a keys array made for each object, are garbage in every frame a world driver writes a cell, design 11.4)
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!(ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) || a.constructor !== b.constructor) return false;
    const x = a as unknown as ArrayLike<number>;
    const y = b as unknown as ArrayLike<number>;
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) {
      const p = x[i];
      const q = y[i];
      if (p !== q && !(p !== p && q !== q)) return false;
    }
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const p: unknown = a[i];
      const q: unknown = b[i];
      if (p === q) continue;
      if (typeof p === 'number' && typeof q === 'number') {
        if (p !== p && q !== q) continue;
        return false;
      }
      if (!sameValue(p, q, depth + 1)) return false;
    }
    return true;
  }
  const oa = a as Record<string, unknown>;
  const ob = b as Record<string, unknown>;
  // the own enumerable keys of each, counted: the same keys when a's all are b's and the counts are equal
  let na = 0;
  for (const k in oa) {
    if (!Object.hasOwn(oa, k)) continue;
    na++;
    const va = oa[k];
    const vb = ob[k];
    if (va === vb) {
      if (typeof va === 'function' || Object.hasOwn(ob, k)) continue;
      return false;
    }
    // two numbers are compared here, not by a call that would box them
    if (typeof va === 'number' && typeof vb === 'number') {
      if (va !== va && vb !== vb && Object.hasOwn(ob, k)) continue;
      return false;
    }
    if (typeof va === 'function' || typeof vb === 'function') {
      if (va !== vb) return false;
      continue;
    }
    if (!Object.hasOwn(ob, k) || !sameValue(va, vb, depth + 1)) return false;
  }
  let nb = 0;
  for (const k in ob) if (Object.hasOwn(ob, k)) nb++;
  return na === nb;
}

/** Shortest text that reads back as the same number. `inf` and `-inf` for infinities; `undefined` for NaN. */
export function numberSource(v: number): string {
  if (v !== v) return 'undefined';
  if (v === Infinity) return 'inf';
  if (v === -Infinity) return '-inf';
  if (Object.is(v, -0)) return '0';
  const s = String(v);
  // `1e+21` is written `1e21`; the language reads an exponent only when digits follow
  return s.replace('e+', 'e');
}

function textSource(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, '\\n') + '"';
}

/** How an area's type is held as a free value: its literal text and the values `setFree` accepts. */
export interface FreeType {
  readonly source: (v: unknown) => string | undefined;
  readonly fits: (v: unknown) => boolean;
  /** A copy the figure can keep (the caller's object may change later). */
  readonly own?: (v: unknown) => unknown;
}

const FREE_TYPES = new Map<string, FreeType>();

/** An area registers a type it owns that can be free (a `Point3` written `(1, 2, 3)` is dragged like a point). */
export function registerFreeType(type: string, t: FreeType): void {
  if (typeof type === 'string' && type !== '' && !FREE_TYPES.has(type)) FREE_TYPES.set(type, t);
}

/** True when an area registered this type as one that can be free (and so dragged). */
export const isFreeType = (type: string): boolean => FREE_TYPES.has(type);

/** An area's own copy of a free value, or the value itself. */
export function ownAreaValue(type: string, v: unknown): unknown {
  const t = FREE_TYPES.get(type);
  return t?.own ? t.own(v) : v;
}

/**
 * The source text of a free value of this type, or `undefined` when the type has no literal (a list, a colour, a
 * function): the caller then keeps the text the line was written with.
 */
export function valueSource(ty: Ty, v: unknown): string | undefined {
  switch (ty.k) {
    case 'Number':
      return typeof v === 'number' ? numberSource(v) : 'undefined';
    case 'Bool':
      return typeof v === 'boolean' ? String(v) : undefined;
    case 'Text':
      return typeof v === 'string' ? textSource(v) : undefined;
    case 'Point': {
      const p = v as { x: number; y: number } | undefined;
      return p && typeof p.x === 'number' ? `(${numberSource(p.x)}, ${numberSource(p.y)})` : undefined;
    }
    default:
      return FREE_TYPES.get(ty.k)?.source(v);
  }
}

/** True when `v` is a value this type can hold as a free value (what `setFree` accepts). */
export function fitsType(ty: Ty, v: unknown): boolean {
  switch (ty.k) {
    case 'Number':
      return typeof v === 'number';
    case 'Bool':
      return typeof v === 'boolean';
    case 'Text':
      return typeof v === 'string';
    case 'Point':
    case 'Vector':
      return typeof v === 'object' && v !== null && typeof (v as { x?: unknown }).x === 'number' && typeof (v as { y?: unknown }).y === 'number';
    default:
      return FREE_TYPES.get(ty.k)?.fits(v) ?? false;
  }
}
