/**
 * Shared helpers for the statistics spec tests. Imports only from the package's public entry.
 * Built from docs/features/statistics (design, errors, agent), never from the implementation.
 */
import { expect } from 'vitest';
import { CommandRegistry, Figure, geometry, isRecord, registerAnimation, registerFunctions, registerLists, registerNumbers, registerProbability, registerStatistics } from '@incantly/kernel';
import type { ErrorObject, RecordValue, TxResult } from '@incantly/kernel';

export const registry = new CommandRegistry();
geometry.registerGeometry(registry);
registerNumbers(registry);
registerFunctions(registry);
registerAnimation(registry);
registerLists(registry);
registerStatistics(registry);
registerProbability(registry);

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

const nameOf = (line: string): string => line.split('=')[0]?.trim() ?? '';

/** The value of `name` after defining it with `line` in a figure that holds `setup`. */
export function val(setup: readonly string[], line: string): unknown {
  const f = fig(setup);
  ok(f.apply(line));
  return f.value(nameOf(line));
}

export const num = (setup: readonly string[], line: string): number => {
  const v = val(setup, line);
  if (typeof v !== 'number') throw new Error(`not a number: ${String(v)}`);
  return v;
};

export const nums = (v: unknown): number[] => {
  if (!(v instanceof Float64Array)) throw new Error(`not a list of numbers: ${JSON.stringify(v)}`);
  return Array.from(v);
};

export function rec(v: unknown): RecordValue {
  if (!isRecord(v)) throw new Error(`not a record: ${JSON.stringify(v)}`);
  return v;
}

export const fields = (setup: readonly string[], line: string): Record<string, unknown> => rec(val(setup, line)).fields as Record<string, unknown>;

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
  return reasonOf(f, nameOf(line));
}

/** The result of applying a line (to look at its notices and summary). */
export function apply(setup: readonly string[], line: string): TxResult {
  return fig(setup).apply(line);
}
