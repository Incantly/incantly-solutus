/**
 * Shared helpers for the animation-time spec tests. Imports only from the package's public entry.
 * Built from docs/features/animation-time (design, errors), never from the implementation.
 */
import { expect } from 'vitest';
import { CommandRegistry, Figure, geometry, registerAnimation, registerNumbers } from '@incantly/kernel';
import type { ErrorObject, TxResult } from '@incantly/kernel';

/** The registry an app has: geometry and numbers next to this area. */
export const registry = new CommandRegistry();
geometry.registerGeometry(registry);
registerNumbers(registry);
registerAnimation(registry);

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

export function num(f: Figure, name: string): number {
  const v = f.value(name);
  if (typeof v !== 'number') throw new Error(`${name} is not a number: ${JSON.stringify(v)}`);
  return v;
}

export function pt(f: Figure, name: string): { x: number; y: number } {
  const v = f.value(name) as { x?: unknown; y?: unknown } | undefined;
  if (typeof v?.x !== 'number' || typeof v.y !== 'number') throw new Error(`${name} is not a point: ${JSON.stringify(v)}`);
  return { x: v.x, y: v.y };
}

/** A clock source the test moves by hand. */
export function manualClock(start = 0): { now: () => number; set: (s: number) => void } {
  let s = start;
  return { now: () => s, set: (x: number) => { s = x; } };
}
