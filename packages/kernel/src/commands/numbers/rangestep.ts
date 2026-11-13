/**
 * The range properties as handler steps (controls-scripting 3.3, numbers-sliders 3.2):
 * `a with min = 0`, `a with max = 20`, `a with step = auto`.
 *
 * The kernel keeps a slider range in its range clause, not in `with`, so these keys are not kernel properties and
 * the kernel parser does not accept `step` as a property name. A handler step that names them is read here, checked
 * at definition (a constant is a valid step, a formula is `handler_graph_change`), and run as a `rerange` line.
 */

import { numberSource } from '../../graph/values';

export type RangeKey = 'min' | 'max' | 'step';

export interface RangeItem {
  readonly key: RangeKey;
  /** The value text as written: a number, an expression of constants, or `none` / `auto`. */
  readonly value: string;
}

export interface RangeRestyle {
  /** The object the step restyles (a name, or `self`). */
  readonly target: string;
  readonly items: readonly RangeItem[];
  /** Items of the same `with` that are not range keys. */
  readonly others: readonly string[];
}

const RANGE_KEYS: ReadonlySet<string> = new Set(['min', 'max', 'step']);

function splitCommas(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

/** Reads a step such as `a with min = 0, max = 20`. Undefined when no item names min, max or step. */
export function parseRangeRestyle(source: string): RangeRestyle | undefined {
  const m = /^\s*([A-Za-z\u0370-\u03FF][A-Za-z0-9_\u0370-\u03FF]*)\s+with\s+(.+)$/s.exec(source);
  if (!m) return undefined;
  const items: RangeItem[] = [];
  const others: string[] = [];
  for (const part of splitCommas(m[2] as string)) {
    const eq = part.indexOf('=');
    const key = (eq < 0 ? part : part.slice(0, eq)).trim();
    if (eq >= 0 && RANGE_KEYS.has(key)) items.push({ key: key as RangeKey, value: part.slice(eq + 1).trim() });
    else others.push(part.trim());
  }
  return items.length > 0 ? { target: m[1] as string, items, others } : undefined;
}

/** The kernel line that gives a slider its new range: `a in 0..20 step 0.5` (no step leaves the automatic step). */
export function rangeLine(name: string, lo: number, hi: number, step: number | 'auto'): string {
  return `${name} in ${numberSource(lo)}..${numberSource(hi)}${step === 'auto' ? '' : ` step ${numberSource(step)}`}`;
}
