/**
 * Kernel values as SDK values (design 3.4): plain data a page can use with no parsing. Numbers, Bools and texts as they
 * are, points as `{x, y}`, lists as arrays; other kinds as a tagged object with their text.
 */
import { valueText } from '@incantly/kernel';

export type Value =
  | number
  | boolean
  | string
  | { readonly x: number; readonly y: number }
  | readonly Value[]
  | { readonly kind: 'undefined'; readonly reason: string }
  | { readonly kind: string; readonly text: string; readonly [key: string]: unknown };

const isPoint = (v: unknown): v is { x: number; y: number } =>
  typeof v === 'object' && v !== null && typeof (v as { x?: unknown }).x === 'number' && typeof (v as { y?: unknown }).y === 'number' && Object.keys(v).length <= 3;

/** One kernel value as an SDK value. */
export function toValue(v: unknown, depth = 0): Value {
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  if (v === undefined || v === null) return { kind: 'undefined', reason: 'not_set' };
  if (v instanceof Float64Array || v instanceof Int32Array) return Array.from(v);
  if (Array.isArray(v)) return depth > 8 ? { kind: 'list', text: valueText(v) } : v.map((x) => toValue(x, depth + 1));
  if (isPoint(v)) return { x: v.x, y: v.y };
  const o = v as { kind?: unknown; schema?: unknown; arity?: unknown; call?: unknown; rows?: unknown; cols?: unknown; data?: unknown };
  if (typeof o.call === 'function') return { kind: 'function', text: valueText(v), arity: typeof o.arity === 'number' ? o.arity : 1 };
  if (o.kind === 'matrix' && o.data instanceof Float64Array) return { kind: 'matrix', text: valueText(v), rows: o.rows, cols: o.cols, data: Array.from(o.data) };
  const kind = typeof o.kind === 'string' ? o.kind : typeof o.schema === 'string' ? o.schema.toLowerCase() : 'object';
  return { kind, text: valueText(v) };
}

/** The value of a cell: its value, or why it is undefined. */
export function cellValue(cell: { readonly defined: boolean; readonly value?: unknown; readonly reason?: string }): Value {
  return cell.defined ? toValue(cell.value) : { kind: 'undefined', reason: cell.reason ?? 'not_set' };
}
