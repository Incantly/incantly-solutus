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
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!(ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) || a.constructor !== b.constructor) return false;
    const x = a as unknown as ArrayLike<number>;
    const y = b as unknown as ArrayLike<number>;
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (!sameValue(x[i], y[i])) return false;
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameValue(a[i], b[i], depth + 1)) return false;
    return true;
  }
  const oa = a as Record<string, unknown>;
  const ob = b as Record<string, unknown>;
  const ka = Object.keys(oa);
  if (ka.length !== Object.keys(ob).length) return false;
  for (const k of ka) {
    const va = oa[k];
    const vb = ob[k];
    if (typeof va === 'function' || typeof vb === 'function') {
      if (va !== vb) return false;
      continue;
    }
    if (!Object.hasOwn(ob, k) || !sameValue(va, vb, depth + 1)) return false;
  }
  return true;
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
      return undefined;
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
      return false;
  }
}
