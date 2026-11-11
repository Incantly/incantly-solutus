/**
 * Shared helpers for the language spec tests. Imports only from the package's public entry.
 * Everything here is built from the docs (docs/features/language/*), never from the implementation.
 */
import { expect } from 'vitest';
import { ScratchFigure, analyseLine, createCommandTable } from '@incantly/kernel';
import type { Applied, CheckedLine, CommandForm, CommandSpec, LanguageError, ParamSpec, Result } from '@incantly/kernel';

// ---------------------------------------------------------------------------------------------
// A command table built in the tests (docs/features/language/design.md 3.11).
// ---------------------------------------------------------------------------------------------

const rule = (): unknown => ({});

export const p = (name: string, type: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ name, type, ...extra });

export const form = (
  params: ParamSpec[],
  returns: string | readonly string[] | null,
  summary = 'a form',
  extra: Partial<CommandForm> = {},
): CommandForm => ({ params, returns, rule, summary, ...extra });

export const COMMANDS: CommandSpec[] = [
  {
    name: 'Circle',
    kind: 'object',
    group: 'geometry',
    forms: [
      form([p('center', 'Point'), p('radius', 'Number')], 'Circle', 'circle by centre and radius'),
      form([p('center', 'Point'), p('through', 'Point')], 'Circle', 'circle through a point'),
      form([p('a', 'Point'), p('b', 'Point'), p('c', 'Point')], 'Circle', 'circle through three points'),
    ],
  },
  {
    name: 'Midpoint',
    kind: 'object',
    group: 'geometry',
    forms: [
      form([p('a', 'Point'), p('b', 'Point')], 'Point', 'midpoint of two points'),
      form([p('s', 'Segment')], 'Point', 'midpoint of a segment'),
    ],
  },
  { name: 'Segment', kind: 'object', group: 'geometry', forms: [form([p('a', 'Point'), p('b', 'Point')], 'Segment')] },
  { name: 'Distance', kind: 'object', group: 'geometry', forms: [form([p('a', 'Point'), p('b', 'Point')], 'Number')] },
  { name: 'Vector', kind: 'object', group: 'geometry', forms: [form([p('p', 'Point')], 'Vector')] },
  {
    name: 'Line',
    kind: 'object',
    group: 'geometry',
    forms: [form([p('a', 'Point'), p('b', 'Point')], 'Line'), form([p('rel', 'Relation')], 'Line')],
  },
  {
    name: 'Intersect',
    kind: 'object',
    group: 'geometry',
    forms: [form([p('a', 'Circle'), p('b', 'Circle')], ['Point', 'Point'])],
  },
  {
    name: 'Angle',
    kind: 'object',
    group: 'geometry',
    forms: [form([p('a', 'Point'), p('b', 'Point'), p('c', 'Point')], 'Number', 'angle at b', { unit: 'angle' })],
  },
  {
    name: 'Polygon',
    kind: 'object',
    group: 'geometry',
    forms: [form([p('a', 'Point'), p('b', 'Point'), p('c', 'Point')], 'Polygon', 'polygon', { rest: p('more', 'Point') })],
  },
  {
    name: 'Seq',
    kind: 'object',
    group: 'lists',
    forms: [
      form(
        [p('body', 'Number', { kind: 'body' }), p('k', 'Number', { kind: 'binder' }), p('from', 'Number'), p('to', 'Number')],
        'List<Number>',
        'sequence',
      ),
    ],
  },
  {
    name: 'Round3',
    kind: 'object',
    group: 'numbers',
    forms: [form([p('x', 'Number'), p('digits', 'Number', { optional: true, default: 2 })], 'Number', 'round')],
  },
  {
    name: 'Pick',
    kind: 'object',
    group: 'misc',
    forms: [form([p('p', 'Number|Point')], 'Number', 'one of two types')],
  },
  {
    name: 'Many',
    kind: 'object',
    group: 'misc',
    forms: [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
      form(
        Array.from({ length: n }, (_, i) => p(`n${i + 1}`, 'Number')),
        'Number',
      ),
    ),
  },
  {
    name: 'Hide',
    kind: 'action',
    group: 'style',
    forms: [form([p('obj', 'Any')], null, 'hide objects', { rest: p('more', 'Any') })],
  },
];

// ---------------------------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------------------------

export function throwIfError(r: Result<unknown>, what: string): void {
  if (!r.ok) throw new Error(`setup line "${what}" failed: ${r.kind}: ${r.message}`);
}

/** A figure with a fixed cast of objects. Tests that need a clean slate use `emptyFig()`. */
export function newFig(commands: readonly CommandSpec[] = COMMANDS): ScratchFigure {
  const fig = new ScratchFigure({ commands: createCommandTable(commands) });
  for (const line of [
    'a = 3',
    'b = 4',
    'A = (1, 2)',
    'B = (4, 6)',
    'C = (0, 5)',
    'P = (2, 3)',
    'f(x) = x^2',
    'g(x) = x + 1',
    'L = [1, 2, 3]',
    'm = "hi"',
    'flag = true',
  ]) {
    throwIfError(fig.apply(line), line);
  }
  fig.define('u', 'Vector', { x: 1, y: 2 }, { free: true });
  fig.define('w', 'Vector', { x: 3, y: 4 }, { free: true });
  fig.define('z0', 'Vector', { x: 0, y: 0 }, { free: true });
  fig.define('s', 'Segment', { a: { x: 0, y: 0 }, b: { x: 3, y: 4 } }, { free: true });
  fig.define('c1', 'Circle', { cx: 0, cy: 0, r: 2 }, { free: true });
  fig.define('c2', 'Circle', { cx: 1, cy: 0, r: 2 }, { free: true });
  fig.define('ln', 'Line', { a: 0, b: 1, c: 0 }, { free: true });
  fig.define('pg', 'Polygon', { pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }, { free: true });
  fig.define('ang', 'Number', 1, { free: true, unit: 'angle' });
  fig.define('E', 'List<Number>', [], { free: true });
  fig.define('PL', 'List<Point>', [{ x: 0, y: 0 }, { x: 1, y: 1 }], { free: true });
  return fig;
}

export function emptyFig(commands: readonly CommandSpec[] = COMMANDS): ScratchFigure {
  return new ScratchFigure({ commands: createCommandTable(commands) });
}

// ---------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------

export function okValue<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected success, got ${r.kind} at ${r.line}:${r.col}: ${r.message}`);
  return r.value;
}

export function errOf<T>(r: Result<T>, context = ''): LanguageError {
  if (r.ok) throw new Error(`expected an error but the line passed ${context}`);
  return r as LanguageError;
}

export function check(src: string, fig: ScratchFigure = newFig()): Result<CheckedLine> {
  return analyseLine(src, fig);
}

export function checked(src: string, fig: ScratchFigure = newFig()): CheckedLine {
  return okValue(check(src, fig));
}

export function failure(src: string, fig: ScratchFigure = newFig()): LanguageError {
  return errOf(check(src, fig), `for "${src}"`);
}

export interface Evaluated {
  readonly applied: Applied;
  readonly value: unknown;
}

/** Applies `out = <expr>` to the figure and returns the outcome. A failing line throws with the error text. */
export function ev(expr: string, fig: ScratchFigure = newFig()): Evaluated {
  const src = `out = ${expr}`;
  const r = fig.apply(src);
  if (!r.ok) throw new Error(`"${src}" failed: ${r.kind} (${r.code}) at ${r.line}:${r.col}: ${r.message}`);
  return { applied: r.value, value: fig.valueOf('out') };
}

export function num(expr: string, fig?: ScratchFigure): number {
  const e = ev(expr, fig);
  if (!e.applied.defined) throw new Error(`"${expr}" is undefined (${String(e.applied.reason)}), expected a number`);
  if (typeof e.value !== 'number') throw new Error(`"${expr}" is not a number: ${JSON.stringify(e.value)}`);
  return e.value;
}

export function bool(expr: string, fig?: ScratchFigure): boolean | undefined {
  const e = ev(expr, fig);
  if (!e.applied.defined) return undefined;
  if (typeof e.value !== 'boolean') throw new Error(`"${expr}" is not a Bool: ${JSON.stringify(e.value)}`);
  return e.value;
}

export function undefinedReason(expr: string, fig?: ScratchFigure): string | undefined {
  const e = ev(expr, fig);
  return e.applied.defined ? `defined:${JSON.stringify(e.value)}` : e.applied.reason;
}

// ---------------------------------------------------------------------------------------------
// Error shape (docs/features/errors/design.md 3, language/errors.md 1)
// ---------------------------------------------------------------------------------------------

export function expectWellFormed(e: LanguageError): void {
  expect(e.ok).toBe(false);
  expect(e.committed).toBe(false);
  expect(e.severity).toBe('error');
  expect(e.code).toMatch(/^[A-Z]\d{3}$/);
  expect(typeof e.kind).toBe('string');
  expect(e.message.length).toBeGreaterThan(0);
  expect(e.messageKey.length).toBeGreaterThan(0);
  expect(e.fingerprint.length).toBeGreaterThan(0);
  expect(Array.isArray(e.expected)).toBe(true);
  expect(Array.isArray(e.forms)).toBe(true);
  expect(Array.isArray(e.suggest)).toBe(true);
  expect(e.line).toBeGreaterThanOrEqual(1);
  expect(e.col).toBeGreaterThanOrEqual(1);
  expect(e.endCol).toBeGreaterThanOrEqual(e.col);
}

/** language/errors.md 1: "hint is always present, never empty". */
export function hasHint(e: LanguageError): boolean {
  return typeof e.hint === 'string' && e.hint.length > 0;
}

export interface At {
  line?: number;
  col: number;
  endCol?: number;
  token?: string;
}

export function expectAt(e: LanguageError, at: At): void {
  expect(e.line).toBe(at.line ?? 1);
  expect(e.col).toBe(at.col);
  if (at.endCol !== undefined) expect(e.endCol).toBe(at.endCol);
  if (at.token !== undefined) expect(e.token).toBe(at.token);
}

/** errors/design.md 3.5: the compact form sent to a model is at most about 800 characters. */
export function compact(e: LanguageError): string {
  const { source: _source, ...rest } = e as LanguageError & { source?: string };
  void _source;
  const c = {
    ...rest,
    forms: e.forms.slice(0, 4),
    formsOmitted: (e.formsOmitted ?? 0) + Math.max(0, e.forms.length - 4),
    expected: e.expected.slice(0, 8),
    suggest: e.suggest.slice(0, 3),
  };
  return JSON.stringify(c);
}

/** language/errors.md 1: "`fix`, if present, is something that would pass the same checks". */
export function expectFixPasses(e: LanguageError, fig: ScratchFigure): void {
  if (e.fix === undefined) return;
  const r = analyseLine(e.fix, fig);
  if (!r.ok) throw new Error(`fix "${e.fix}" does not pass: ${r.kind}: ${r.message}`);
}

/** Small deterministic PRNG for the junk tests (mulberry32). */
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
