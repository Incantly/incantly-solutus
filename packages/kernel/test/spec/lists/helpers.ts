/**
 * Shared helpers for the lists-matrices spec tests. Imports only from the package's public entry.
 * Built from docs/features/lists-matrices (design, errors), never from the implementation.
 */
import { expect } from 'vitest';
import { CommandRegistry, Figure, geometry, isMatrix, registerAnimation, registerLists, registerNumbers } from '@incantly/kernel';
import type { ErrorObject, MatrixValue, TxResult } from '@incantly/kernel';

/** The registry an app has: geometry and numbers next to this area. */
export const registry = new CommandRegistry();
geometry.registerGeometry(registry);
registerNumbers(registry);
registerAnimation(registry);
registerLists(registry);

export function fig(lines: readonly string[] = []): Figure {
  const f = new Figure({ commands: registry });
  for (const l of lines) {
    const r = f.apply(l);
    if (!r.ok) throw new Error(`setup line "${l}" failed: ${r.kind}: ${r.message}`);
  }
  return f;
}

export function ok(r: TxResult): void {
  if (!r.ok) throw new Error(`expected success, got ${r.kind}: ${r.message}`);
}

export function bad(r: TxResult, kind: string): ErrorObject {
  if (r.ok) throw new Error(`expected an error (${kind}), but the line passed`);
  expect(r.kind).toBe(kind);
  return r;
}

/** The value of `name` after defining it with `line` in a figure that holds `setup`. */
export function val(setup: readonly string[], line: string): unknown {
  const f = fig(setup);
  ok(f.apply(line));
  return f.value(line.split('=')[0]?.trim() ?? '');
}

export const nums = (v: unknown): number[] => {
  if (!(v instanceof Float64Array)) throw new Error(`not a list of numbers: ${JSON.stringify(v)}`);
  return Array.from(v);
};

export function mat(v: unknown): MatrixValue {
  if (!isMatrix(v)) throw new Error(`not a matrix: ${JSON.stringify(v)}`);
  return v;
}

/** Rows of a matrix as plain arrays. */
export const rows = (v: unknown): number[][] => {
  const m = mat(v);
  return Array.from({ length: m.rows }, (_, i) => Array.from(m.data.slice(i * m.cols, (i + 1) * m.cols)));
};

/** The reason an object is undefined. */
export function reasonOf(f: Figure, name: string): string | undefined {
  const o = f.get(name);
  if (!o) throw new Error(`no object ${name}`);
  const c = f.cellOf(o.id) as { defined: boolean; reason?: string };
  return c.defined ? undefined : c.reason;
}

export function undef(setup: readonly string[], line: string): string | undefined {
  const f = fig(setup);
  ok(f.apply(line));
  return reasonOf(f, line.split('=')[0]?.trim() ?? '');
}
