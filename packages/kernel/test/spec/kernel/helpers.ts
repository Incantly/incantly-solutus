/**
 * Shared helpers for the kernel and errors spec tests. Imports only from the package's public entry.
 * Built from docs/features/kernel/* and docs/features/errors/*, never from the implementation.
 *
 * The kernel ships no geometry commands (the areas plug them in), so the tests register a few small commands
 * of their own through the public `CommandSpec` / `CommandRule` contract.
 */
import { expect } from 'vitest';
import { Figure, undef } from '@incantly/kernel';
import type {
  Cell,
  CommandRule,
  CommandSpec,
  ErrorObject,
  FigureOptions,
  FigureEvent,
  RuleCall,
  TxOk,
  TxResult,
} from '@incantly/kernel';

// ---------------------------------------------------------------------------------------------
// Test commands
// ---------------------------------------------------------------------------------------------

interface P2 {
  x: number;
  y: number;
}
interface L3 {
  a: number;
  b: number;
  c: number;
}

const P = (call: RuleCall, i: number): P2 => call.values[i] as P2;
const N = (call: RuleCall, i: number): number => call.values[i] as number;

export const p = (name: string, type: string, extra: Record<string, unknown> = {}) => ({ name, type, ...extra });

function obj(
  name: string,
  params: ReturnType<typeof p>[],
  returns: string | readonly string[],
  rule: CommandRule | ((call: RuleCall) => unknown),
  extra: Record<string, unknown> = {},
): CommandSpec {
  const r: CommandRule = typeof rule === 'function' ? { run: rule } : rule;
  return {
    name,
    kind: 'object',
    group: 'test',
    forms: [{ params, returns, rule: () => r, summary: `${name} (test command)`, ...extra }],
  } as CommandSpec;
}

/** Counts how many times each command's rule ran. Reset with `resetRuns()`. */
export const runs = new Map<string, number>();
export const resetRuns = (): void => runs.clear();
const bump = (name: string): void => void runs.set(name, (runs.get(name) ?? 0) + 1);

const lineThrough = (a: P2, b: P2): L3 => ({ a: b.y - a.y, b: a.x - b.x, c: (b.y - a.y) * a.x + (a.x - b.x) * a.y });

export const TEST_COMMANDS: CommandSpec[] = [
  obj(
    'Midpoint',
    [p('a', 'Point'), p('b', 'Point')],
    'Point',
    {
      run(call) {
        bump('Midpoint');
        const a = P(call, 0);
        const b = P(call, 1);
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      },
      // Dragging the midpoint to `target` moves the first parent so the midpoint lands there.
      invert(target, call) {
        const t = target as P2;
        const b = call.values[1] as P2;
        return [{ param: 0, value: { x: 2 * t.x - b.x, y: 2 * t.y - b.y } }];
      },
    },
    { explain: '{name} is the midpoint of {0} and {1}' },
  ),
  obj('Vector', [p('x', 'Number'), p('y', 'Number')], 'Vector', (call) => {
    bump('Vector');
    return { x: N(call, 0), y: N(call, 1) };
  }),
  obj('Line', [p('a', 'Point'), p('b', 'Point')], 'Line', (call) => {
    bump('Line');
    const a = P(call, 0);
    const b = P(call, 1);
    if (a.x === b.x && a.y === b.y) return call.fail('degenerate');
    return lineThrough(a, b);
  }),
  obj('Parallel', [p('through', 'Point'), p('l', 'Line')], 'Line', (call) => {
    bump('Parallel');
    const t = P(call, 0);
    const l = call.values[1] as L3;
    return { a: l.a, b: l.b, c: l.a * t.x + l.b * t.y };
  }),
  obj('Intersect', [p('l', 'Line'), p('m', 'Line')], 'Point', (call) => {
    bump('Intersect');
    const l = call.values[0] as L3;
    const m = call.values[1] as L3;
    const det = l.a * m.b - m.a * l.b;
    if (Math.abs(det) < 1e-12) {
      const same = Math.abs(l.a * m.c - m.a * l.c) < 1e-9 && Math.abs(l.b * m.c - m.b * l.c) < 1e-9;
      return call.fail(same ? 'coincident' : 'parallel');
    }
    return { x: (l.c * m.b - m.c * l.b) / det, y: (l.a * m.c - m.a * l.c) / det };
  }),
  obj('Distance', [p('a', 'Point'), p('b', 'Point')], 'Number', (call) => {
    bump('Distance');
    const a = P(call, 0);
    const b = P(call, 1);
    return Math.hypot(a.x - b.x, a.y - b.y);
  }),
  obj('Segment', [p('a', 'Point'), p('b', 'Point')], 'Segment', (call) => {
    bump('Segment');
    return { a: P(call, 0), b: P(call, 1) };
  }),
  obj('Circle', [p('center', 'Point'), p('radius', 'Number')], 'Circle', (call) => {
    bump('Circle');
    const c = P(call, 0);
    const r = N(call, 1);
    if (r <= 0) return call.fail('degenerate');
    return { cx: c.x, cy: c.y, r };
  }),
  obj('Translate', [p('a', 'Point'), p('v', 'Vector')], 'Point', {
    run(call) {
      bump('Translate');
      const a = P(call, 0);
      const v = call.values[1] as P2;
      return { x: a.x + v.x, y: a.y + v.y };
    },
    invert(target, call) {
      const t = target as P2;
      const v = call.values[1] as P2;
      return [{ param: 0, value: { x: t.x - v.x, y: t.y - v.y } }];
    },
  }),
  // A command that fails with a reason from the input (for "specific reason" and chain tests).
  obj('Reciprocal', [p('x', 'Number')], 'Number', (call) => {
    bump('Reciprocal');
    const x = N(call, 0);
    if (x === 0) return call.fail('division_by_zero');
    return 1 / x;
  }),
  // A command that throws (a bug in a rule): must come back as `internal`, with a rollback.
  obj('Boom', [p('x', 'Number')], 'Number', () => {
    throw new Error('boom');
  }),
  // A command that throws only when its input is 13, so it can fail during a later pass.
  obj('Unlucky', [p('x', 'Number')], 'Number', (call) => {
    bump('Unlucky');
    const x = N(call, 0);
    if (x === 13) throw new Error('unlucky');
    return x;
  }),
  // Accepts undefined inputs: counts how many of the list are defined (kernel design 6.4).
  obj(
    'Defined',
    [p('x', 'Number')],
    'Number',
    {
      acceptsUndefined: true,
      run(call) {
        bump('Defined');
        return call.values[0] === undefined ? 0 : 1;
      },
    },
  ),
  // A tuple result: two points, the second undefined unless x > 0.
  obj('Pair', [p('x', 'Number')], ['Point', 'Point'], (call) => {
    const x = N(call, 0);
    return [{ x, y: 0 }, x > 0 ? { x: -x, y: 0 } : undef('no_intersection')];
  }),
  // A point on a circle at angle `a`. Used as `Orbit(2, t)` so the dependence on the clock is visible in the line.
  obj('Orbit', [p('r', 'Number'), p('a', 'Number')], 'Point', (call) => {
    bump('Orbit');
    const r = N(call, 0);
    const a = N(call, 1);
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  }),
  // A rule that returns a list: a list of n numbers (for list-size limits). A negative n is outside the domain.
  obj('Range', [p('n', 'Number')], 'List<Number>', (call) => {
    bump('Range');
    const n = N(call, 0);
    if (n < 0) return call.fail('out_of_domain');
    return Array.from({ length: n }, (_, i) => i);
  }),
  obj('Total', [p('xs', 'List<Number>')], 'Number', (call) => {
    bump('Total');
    return (call.values[0] as number[]).reduce((s, x) => s + x, 0);
  }),
  obj('Length', [p('s', 'Segment')], 'Number', (call) => {
    bump('Length');
    const s = call.values[0] as { a: P2; b: P2 };
    return Math.hypot(s.a.x - s.b.x, s.a.y - s.b.y);
  }),
  obj('Center', [p('c', 'Circle')], 'Point', (call) => {
    bump('Center');
    const c = call.values[0] as { cx: number; cy: number };
    return { x: c.cx, y: c.cy };
  }),
  // A point on a segment at parameter u in 0..1; dragging it projects the pointer onto the segment.
  obj('PointOn', [p('s', 'Segment'), p('u', 'Number')], 'Point', {
    run(call) {
      bump('PointOn');
      const s = call.values[0] as { a: P2; b: P2 };
      const u = N(call, 1);
      return { x: s.a.x + (s.b.x - s.a.x) * u, y: s.a.y + (s.b.y - s.a.y) * u };
    },
    invert(target, call) {
      const s = call.values[0] as { a: P2; b: P2 };
      const t = target as P2;
      const dx = s.b.x - s.a.x;
      const dy = s.b.y - s.a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) return undefined;
      const u = Math.min(1, Math.max(0, ((t.x - s.a.x) * dx + (t.y - s.a.y) * dy) / len2));
      return [{ param: 1, value: u }];
    },
  }),
];

export const must = <T>(x: T | undefined | null, what = 'value'): T => {
  if (x === undefined || x === null) throw new Error(`expected ${what} to exist`);
  return x;
};

export const idOf = (f: Figure, name: string): number => must(f.get(name), `object ${name}`).id as number;

export const nameOfId = (f: Figure, id: number | undefined): string | undefined =>
  id === undefined ? undefined : f.objects().find((o) => (o.id as number) === id)?.name;

// ---------------------------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------------------------

export function newFigure(opts: FigureOptions = {}): Figure {
  resetRuns();
  return new Figure({ commands: TEST_COMMANDS, ...opts });
}

/** Applies lines one by one and fails the test with the error when one does not pass. */
export function build(f: Figure, lines: string | readonly string[]): Figure {
  const list = typeof lines === 'string' ? lines.split('\n').filter((l) => l.trim() !== '') : lines;
  for (const line of list) {
    const r = f.apply(line);
    if (!r.ok) throw new Error(`setup line "${line}" failed: ${r.kind} (${r.code}): ${r.message}`);
  }
  return f;
}

export function figure(lines: string | readonly string[] = [], opts: FigureOptions = {}): Figure {
  return build(newFigure(opts), lines);
}

/** The standard small figure used by many tests: two points, their midpoint, a line, a slider. */
export const BASIC = ['A = (0, 0)', 'B = (4, 0)', 'M = Midpoint(A, B)', 'a = 3 in 0..10 step 0.5'];

// ---------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------

export function ok(r: TxResult, context = ''): TxOk {
  if (!r.ok) throw new Error(`expected success${context ? ` (${context})` : ''}, got ${r.kind} (${r.code}) at ${r.line}:${r.col}: ${r.message}`);
  return r;
}

export function bad(r: TxResult, kind?: string): ErrorObject {
  if (r.ok) throw new Error(`expected an error${kind ? ` (${kind})` : ''}, but the line passed: ${r.summary}`);
  if (kind !== undefined && r.kind !== kind) {
    throw new Error(`expected error kind ${kind}, got ${r.kind} (${r.code}): ${r.message}`);
  }
  return r;
}

export function isErr(x: unknown): x is ErrorObject {
  return typeof x === 'object' && x !== null && (x as { ok?: unknown }).ok === false && 'kind' in x;
}

export function errOf(x: unknown, kind?: string): ErrorObject {
  if (!isErr(x)) throw new Error(`expected an ErrorObject, got ${JSON.stringify(x)?.slice(0, 200)}`);
  if (kind !== undefined && x.kind !== kind) throw new Error(`expected error kind ${kind}, got ${x.kind}: ${x.message}`);
  return x;
}

export const defined = (c: Cell | undefined): unknown => {
  if (c === undefined || !c.defined) throw new Error(`expected a defined cell, got ${JSON.stringify(c)}`);
  return c.value;
};

export function reasonOf(f: Figure, name: string): string | undefined {
  const c = f.cellOf(name);
  if (c === undefined) throw new Error(`no object ${name}`);
  return c.defined ? undefined : c.reason;
}

export function valueOf(f: Figure, name: string): unknown {
  return f.value(name);
}

/** errors/design.md 3: every error object has these fields, with these shapes. */
export function expectWellFormedError(e: ErrorObject): void {
  expect(e.ok).toBe(false);
  expect(e.committed).toBe(false);
  expect(e.severity).toBe('error');
  expect(e.code).toMatch(/^[A-Z]\d{3}$/);
  expect(typeof e.kind).toBe('string');
  expect(typeof e.phase).toBe('string');
  expect(e.message.length).toBeGreaterThan(0);
  expect(e.messageKey.length).toBeGreaterThan(0);
  expect(e.fingerprint.length).toBeGreaterThan(0);
  expect(Array.isArray(e.expected)).toBe(true);
  expect(Array.isArray(e.forms)).toBe(true);
  expect(Array.isArray(e.suggest)).toBe(true);
  expect(e.suggest.length).toBeLessThanOrEqual(3);
  expect(typeof e.recovery).toBe('string');
  expect(typeof e.token).toBe('string');
  expect(e.line).toBeGreaterThanOrEqual(0);
  expect(e.col).toBeGreaterThanOrEqual(0);
  expect(e.endCol).toBeGreaterThanOrEqual(e.col);
  // errors.md 6: plain JSON-safe data
  const json = JSON.stringify(e);
  expect(json.length).toBeGreaterThan(2);
  expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(JSON.parse(json))));
}

// ---------------------------------------------------------------------------------------------
// Snapshots of "the figure is bit-for-bit what it was" (kernel errors.md 5 rule 1)
// ---------------------------------------------------------------------------------------------

export interface Snap {
  script: string;
  names: string[];
  ids: number[];
  undo: number;
  redo: number;
  values: string;
  t: number;
}

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (typeof x === 'number' && !Number.isFinite(x) ? String(x) : typeof x === 'function' ? 'fn' : x));

export function snap(f: Figure): Snap {
  const info = f.undoInfo();
  return {
    script: f.toScript(),
    names: [...f.names()],
    ids: f.objects().map((o) => o.id as number),
    undo: info.depth,
    redo: info.redoDepth,
    values: f.objects().map((o) => `${o.name}:${stable(o.cell)}`).join('|'),
    t: f.clock().t,
  };
}

export function expectUnchanged(f: Figure, before: Snap, why = ''): void {
  const after = snap(f);
  expect(after, why).toEqual(before);
}

// ---------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------

export function recordEvents(f: Figure): { events: FigureEvent[]; stop: () => void } {
  const events: FigureEvent[] = [];
  const stop = f.on((ev) => events.push(ev));
  return { events, stop };
}

// ---------------------------------------------------------------------------------------------
// Determinism helpers
// ---------------------------------------------------------------------------------------------

/** Small deterministic PRNG (mulberry32), so random figures are the same on every run. */
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

/** Runs `fn` and returns elapsed milliseconds (tests only; the kernel itself never reads a clock). */
export function timed<T>(fn: () => T): { ms: number; value: T } {
  const t0 = performance.now();
  const value = fn();
  return { ms: performance.now() - t0, value };
}

/** Median of n timed runs, to keep timing assertions steady on a busy CI machine. */
export function medianMs(n: number, fn: () => void): number {
  const xs: number[] = [];
  for (let i = 0; i < n; i++) xs.push(timed(fn).ms);
  xs.sort((a, b) => a - b);
  return xs[Math.floor(xs.length / 2)] ?? 0;
}
