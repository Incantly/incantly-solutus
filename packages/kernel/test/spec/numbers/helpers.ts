/**
 * Shared helpers for the numbers spec tests. Built from docs/features/numbers-sliders/* and
 * docs/features/controls-scripting/*; imports only from the package's public entry.
 *
 * Every figure registers the numbers area on a fresh registry and passes `withNumbersFunctions()`.
 */
import { expect, it } from 'vitest';
import { CommandRegistry, Figure, registerNumbers, withNumbersFunctions } from '@incantly/kernel';
import type { Cell, ErrorObject, NumberDisplay, ObjId, TxOk, TxResult } from '@incantly/kernel';

/** A hard time limit for any test that could hang (milliseconds). Pass as the third argument of `it`. */
export const T = 5000;

export function newFigure(): Figure {
  const reg = new CommandRegistry();
  registerNumbers(reg);
  return new Figure({ commands: reg, functions: withNumbersFunctions() });
}

/** Applies lines one by one and throws with the error when one fails. */
export function build(f: Figure, lines: string | readonly string[]): Figure {
  const list = typeof lines === 'string' ? lines.split('\n').filter((l) => l.trim() !== '') : lines;
  for (const line of list) {
    const r = f.apply(line);
    if (!r.ok) throw new Error(`setup line "${line}" failed: ${String(r.kind)} (${r.code}): ${r.message}`);
  }
  return f;
}

export function fig(lines: string | readonly string[] = []): Figure {
  return build(newFigure(), lines);
}

export function ok(r: TxResult, ctx = ''): TxOk {
  if (!r.ok) throw new Error(`expected success${ctx ? ` (${ctx})` : ''}, got ${String(r.kind)} (${r.code}): ${r.message}`);
  return r;
}

/** Asserts the result is an error, of the given kind when one is named. Returns the error. */
export function bad(r: { readonly ok: boolean }, kind?: string): ErrorObject {
  const e = r as ErrorObject;
  if (e.ok) throw new Error(`expected an error${kind ? ` (${kind})` : ''}, but it succeeded: ${JSON.stringify(r).slice(0, 200)}`);
  if (kind !== undefined && String(e.kind) !== kind) throw new Error(`expected error kind ${kind}, got ${String(e.kind)}: ${e.message}`);
  return e;
}

/** Applies a line and returns the error, failing the test when the line passes. */
export function reject(f: Figure, line: string, kind?: string): ErrorObject {
  return bad(f.apply(line), kind);
}

export const val = (f: Figure, name: string): unknown => f.value(name);
export const num = (f: Figure, name: string): number => {
  const v = f.value(name);
  if (typeof v !== 'number') throw new Error(`${name} is not a defined number: ${JSON.stringify(v)}`);
  return v;
};

export function reasonOf(f: Figure, name: string): string | undefined {
  const c: Cell | undefined = f.cellOf(name);
  if (c === undefined) throw new Error(`no object ${name}`);
  return c.defined ? undefined : c.reason;
}

export const idOf = (f: Figure, name: string): number => {
  const o = f.get(name);
  if (o === undefined) throw new Error(`no object ${name}`);
  return o.id as number;
};

/** The branded id of an object, for the area's id-based functions. */
export const oid = (f: Figure, name: string): ObjId => idOf(f, name) as ObjId;

/** The notice kinds of a successful result. */
export const noticeKinds = (r: { readonly notices: readonly { readonly kind: string }[] }): string[] => r.notices.map((n) => String(n.kind));

/** Compact, comparable state of a figure: the script, every value, and the undo depth. */
export function snapshot(f: Figure): string {
  const vals = f.objects().map((o) => `${o.name}:${JSON.stringify(o.cell, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v))}`);
  return `${f.toScript()}\n${vals.join('|')}\nundo=${f.undoInfo().depth}`;
}

export const NONE: NumberDisplay = { unit: 'none', format: { mode: 'auto' }, trim: true };
export const disp = (over: Partial<{ unit: NumberDisplay['unit']; format: NumberDisplay['format']; trim: boolean }> = {}): NumberDisplay => ({
  unit: over.unit ?? 'none',
  format: over.format ?? { mode: 'auto' },
  trim: over.trim ?? true,
});
export const decimalsFmt = (n: number, trim = false): NumberDisplay => disp({ format: { mode: 'decimals', n }, trim });
export const sigFmt = (n: number, trim = false): NumberDisplay => disp({ format: { mode: 'sig', n }, trim });

/** Small deterministic PRNG (mulberry32). */
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

/** Runs `fn` and fails when it takes longer than `ms` milliseconds (tests only; the kernel never reads a clock). */
export function within<R>(ms: number, fn: () => R): R {
  const t0 = performance.now();
  const r = fn();
  const dt = performance.now() - t0;
  expect(dt, `took ${dt.toFixed(1)} ms, limit ${ms} ms`).toBeLessThan(ms);
  return r;
}

/** The standard small figure many tests start from. */
export const BASE = ['a = 3 in 0..10 step 0.5', 'b = 2 * a', 'show = true', 'P = (1, 2)', 'go = Button("Reset")'];

/**
 * A table test: one test, one promise, every row checked. A failing run lists the rows that failed.
 * Use as `each(rows)('name', (a, b) => { ... })`; a row that is not an array is one argument.
 */
export function each(rows: readonly unknown[]) {
  // The row shapes differ per table, so the callback is loosely typed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (name: string, fn: (...args: any[]) => void, timeout?: number): void => {
    it(
      name.replace(/%[sjd]/g, '*'),
      () => {
        const failures: string[] = [];
        for (const row of rows) {
          const args: unknown[] = Array.isArray(row) ? row : [row];
          try {
            fn(...args);
          } catch (e) {
            failures.push(`  row ${JSON.stringify(row, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v))}: ${String((e as Error).message).split('\n')[0]}`);
          }
        }
        if (failures.length > 0) throw new Error(`${failures.length} of ${rows.length} rows failed:\n${failures.join('\n')}`);
      },
      timeout,
    );
  };
}

/** The figure the control and handler tests start from. */
export const CTRL_BASE = [
  'a = 3 in 0..10 step 0.5',
  'b = 2 * a',
  'c = 1 in 0..10',
  'chk = true',
  's = "x"',
  'P = (1, 2)',
  'Q = (3, 4)',
  'go = Button("Go")',
  'go2 = Button("Two")',
  'L = [1, 2, 3]',
  'd = Choice([10, 20, 30])',
  'r = 2 in 0..5',
  'q = Input(r, "r =")',
];
