/**
 * Shared helpers for the functions-area spec tests (functions-calculus and curves-loci).
 * Imports only from the package's public entry. Built from the docs, never from the implementation.
 *
 * Every figure registers the functions commands plus a few small geometry commands of the tests' own
 * (Circle, Segment, Line, PointOn), because the points and conics areas plug those in elsewhere.
 */
import { expect, vi } from 'vitest';
import { CommandRegistry, Figure, registerFunctions } from '@incantly/kernel';
import type { CommandRule, CommandSpec, ErrorObject, RuleCall, TxOk, TxResult } from '@incantly/kernel';

/** Every test in the area gets this budget. A synchronous hang cannot be interrupted by the runner, see `within`. */
export const TEST_TIMEOUT = 15000;
export const useTimeout = (ms = TEST_TIMEOUT): void => void vi.setConfig({ testTimeout: ms });

// ---------------------------------------------------------------------------------------------
// Test-local geometry commands
// ---------------------------------------------------------------------------------------------

interface P2 {
  x: number;
  y: number;
}
const param = (name: string, type: string) => ({ name, type });
const P = (c: RuleCall, i: number): P2 => c.values[i] as P2;
const N = (c: RuleCall, i: number): number => c.values[i] as number;

function cmd(name: string, forms: { params: ReturnType<typeof param>[]; returns: string; run: (c: RuleCall) => unknown }[]): CommandSpec {
  return {
    name,
    kind: 'object',
    group: 'test',
    forms: forms.map((f) => ({
      params: f.params,
      returns: f.returns,
      rule: (): CommandRule => ({ run: f.run }),
      summary: `${name} (test command)`,
    })),
  } as CommandSpec;
}

export const GEOMETRY: CommandSpec[] = [
  cmd('Circle', [
    {
      params: [param('center', 'Point'), param('radius', 'Number')],
      returns: 'Circle',
      run: (c) => ({ cx: P(c, 0).x, cy: P(c, 0).y, r: N(c, 1) }),
    },
  ]),
  cmd('Segment', [{ params: [param('a', 'Point'), param('b', 'Point')], returns: 'Segment', run: (c) => ({ a: P(c, 0), b: P(c, 1) }) }]),
  cmd('Line', [
    {
      params: [param('a', 'Point'), param('b', 'Point')],
      returns: 'Line',
      run: (c) => {
        const a = P(c, 0);
        const b = P(c, 1);
        if (a.x === b.x && a.y === b.y) return c.fail('degenerate');
        return { a: b.y - a.y, b: a.x - b.x, c: (b.y - a.y) * a.x + (a.x - b.x) * a.y };
      },
    },
  ]),
  cmd('PointOn', [
    {
      params: [param('s', 'Segment'), param('u', 'Number')],
      returns: 'Point',
      run: (c) => {
        const s = c.values[0] as { a: P2; b: P2 };
        const u = N(c, 1);
        return { x: s.a.x + (s.b.x - s.a.x) * u, y: s.a.y + (s.b.y - s.a.y) * u };
      },
    },
    {
      params: [param('c', 'Circle'), param('u', 'Number')],
      returns: 'Point',
      run: (c) => {
        const k = c.values[0] as { cx: number; cy: number; r: number };
        const a = 2 * Math.PI * N(c, 1);
        return { x: k.cx + k.r * Math.cos(a), y: k.cy + k.r * Math.sin(a) };
      },
    },
  ]),
];

// ---------------------------------------------------------------------------------------------
// Figures and lines
// ---------------------------------------------------------------------------------------------

export function newFigure(): Figure {
  const reg = new CommandRegistry();
  registerFunctions(reg);
  reg.registerAll(GEOMETRY);
  return new Figure({ commands: reg });
}

const toArr = (lines: string | readonly string[]): readonly string[] =>
  typeof lines === 'string' ? lines.split('\n').filter((l) => l.trim() !== '') : lines;

/** Applies setup lines one by one; a setup line that fails is a test error with the error text. */
export function fig(lines: string | readonly string[] = []): Figure {
  const f = newFigure();
  for (const line of toArr(lines)) {
    const r = f.apply(line);
    if (!r.ok) throw new Error(`setup line "${line}" failed: ${r.kind} (${r.code}): ${r.message}`);
  }
  return f;
}

export function ok(f: Figure, line: string): TxOk {
  const r = f.apply(line);
  if (!r.ok) throw new Error(`expected "${line}" to pass, got ${r.kind} (${r.code}): ${r.message}`);
  return r;
}

export function fails(f: Figure, line: string, kind?: string | readonly string[]): ErrorObject {
  const r: TxResult = f.apply(line);
  const kinds = kind === undefined ? undefined : typeof kind === 'string' ? [kind] : kind;
  if (r.ok) throw new Error(`expected "${line}" to fail${kinds ? ` with ${kinds.join(' or ')}` : ''}, but it passed: ${r.summary}`);
  if (kinds !== undefined && !kinds.includes(r.kind)) throw new Error(`expected "${line}" to fail with ${kinds.join(' or ')}, got ${r.kind}: ${r.message}`);
  return r;
}

// ---------------------------------------------------------------------------------------------
// Reading values
// ---------------------------------------------------------------------------------------------

export function num(f: Figure, name: string): number {
  const c = f.cellOf(name);
  if (c === undefined) throw new Error(`no object ${name}`);
  if (!c.defined) throw new Error(`${name} is undefined (${c.reason}${c.detail ? `: ${c.detail}` : ''})`);
  if (typeof c.value !== 'number') throw new Error(`${name} is not a number: ${JSON.stringify(c.value)}`);
  return c.value;
}

export function val<T = unknown>(f: Figure, name: string): T {
  const c = f.cellOf(name);
  if (c === undefined) throw new Error(`no object ${name}`);
  if (!c.defined) throw new Error(`${name} is undefined (${c.reason}${c.detail ? `: ${c.detail}` : ''})`);
  return c.value as T;
}

export const pt = (f: Figure, name: string): P2 => val<P2>(f, name);

/** A list value as a plain array (lists may be arrays or array-likes). */
export function list<T = unknown>(f: Figure, name: string): T[] {
  const v = val<unknown>(f, name);
  if (Array.isArray(v)) return v as T[];
  if (typeof v === 'object' && v !== null) return Object.values(v as Record<string, T>);
  throw new Error(`${name} is not a list: ${JSON.stringify(v)}`);
}

export const pts = (f: Figure, name: string): P2[] => list<P2>(f, name);

export interface Ln {
  a: number;
  b: number;
  c: number;
}
export const lineOf = (f: Figure, name: string): Ln => val<Ln>(f, name);

export function reasonOf(f: Figure, name: string): string | undefined {
  const c = f.cellOf(name);
  if (c === undefined) throw new Error(`no object ${name}`);
  return c.defined ? undefined : c.reason;
}

export function detailOf(f: Figure, name: string): string | undefined {
  const c = f.cellOf(name);
  return c !== undefined && !c.defined ? c.detail : undefined;
}

export function expectUndefined(f: Figure, name: string, reasons: string | readonly string[]): void {
  const c = f.cellOf(name);
  if (c === undefined) throw new Error(`no object ${name}`);
  if (c.defined) throw new Error(`expected ${name} to be undefined, but it is ${JSON.stringify(c.value, (_k, v) => (typeof v === 'function' ? 'fn' : v))?.slice(0, 120)}`);
  const allowed = typeof reasons === 'string' ? [reasons] : reasons;
  expect(allowed, `reason of ${name}`).toContain(c.reason);
}

let counter = 0;
const fresh = (): string => `tmp${++counter}`;

/** Evaluates an expression in the figure on a fresh name; a failing line or an undefined result throws. */
export function ev(f: Figure, expr: string): number {
  const name = fresh();
  ok(f, `${name} = ${expr}`);
  return num(f, name);
}

export function evP(f: Figure, expr: string): P2 {
  const name = fresh();
  ok(f, `${name} = ${expr}`);
  return pt(f, name);
}

export function evB(f: Figure, expr: string): boolean {
  const name = fresh();
  ok(f, `${name} = ${expr}`);
  return val<boolean>(f, name);
}

/** Evaluates and returns the reason when the result is undefined, or undefined when it is defined. */
export function evReason(f: Figure, expr: string): string | undefined {
  const name = fresh();
  ok(f, `${name} = ${expr}`);
  return reasonOf(f, name);
}

export function evDefined(f: Figure, expr: string): boolean {
  return evReason(f, expr) === undefined;
}

// ---------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------

/** |a - b| <= tol * (1 + |b|). */
export function near(a: number, b: number, tol = 1e-9, what = ''): void {
  if (Number.isNaN(a) || Number.isNaN(b)) throw new Error(`NaN in near(${a}, ${b}) ${what}`);
  if (!Number.isFinite(b)) {
    expect(a, what).toBe(b);
    return;
  }
  const d = Math.abs(a - b);
  if (!(d <= tol * (1 + Math.abs(b)))) throw new Error(`${what ? `${what}: ` : ''}expected ${a} to be within ${tol} of ${b} (off by ${d})`);
}

export function nearPt(p: P2, x: number, y: number, tol = 1e-9): void {
  near(p.x, x, tol, 'x');
  near(p.y, y, tol, 'y');
}

export function nearList(a: readonly number[], b: readonly number[], tol = 1e-9): void {
  expect(a.length, `length of ${JSON.stringify(a)}`).toBe(b.length);
  a.forEach((v, i) => near(v, b[i] as number, tol, `item ${i + 1}`));
}

/**
 * Runs `fn` and fails when it took longer than `ms`. The runner cannot interrupt a synchronous loop, so a true
 * hang still ends at the outer `timeout` that the suite is run under; this catches "slow but finishes".
 */
export function within<T>(ms: number, fn: () => T): T {
  const t0 = performance.now();
  const out = fn();
  const dt = performance.now() - t0;
  if (dt > ms) throw new Error(`took ${dt.toFixed(1)} ms, over the ${ms} ms limit`);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Lines (ax + by = c)
// ---------------------------------------------------------------------------------------------

export const isVertical = (l: Ln): boolean => Math.abs(l.b) <= 1e-9 * Math.max(Math.abs(l.a), 1e-300);
export const isHorizontal = (l: Ln): boolean => Math.abs(l.a) <= 1e-9 * Math.max(Math.abs(l.b), 1e-300);
export const slopeOf = (l: Ln): number => -l.a / l.b;
export const interceptOf = (l: Ln): number => l.c / l.b;
export const xOfVertical = (l: Ln): number => l.c / l.a;
export const lineY = (l: Ln, x: number): number => (l.c - l.a * x) / l.b;
export const distToLine = (l: Ln, x: number, y: number): number => Math.abs(l.a * x + l.b * y - l.c) / Math.hypot(l.a, l.b);

export function expectLine(l: Ln, m: number, c: number, tol = 1e-6): void {
  expect(isVertical(l), 'not vertical').toBe(false);
  near(slopeOf(l), m, tol, 'slope');
  near(interceptOf(l), c, tol, 'intercept');
}

export function expectVertical(l: Ln, x: number, tol = 1e-6): void {
  expect(isVertical(l), `expected a vertical line, got ${JSON.stringify(l)}`).toBe(true);
  near(xOfVertical(l), x, tol, 'x of vertical line');
}

export function expectHorizontal(l: Ln, y: number, tol = 1e-6): void {
  expect(isHorizontal(l), `expected a horizontal line, got ${JSON.stringify(l)}`).toBe(true);
  near(l.c / l.b, y, tol, 'y of horizontal line');
}

// ---------------------------------------------------------------------------------------------
// Curve values (shapes from the area's public API table)
// ---------------------------------------------------------------------------------------------

export interface CurveVal {
  kind: 'curve';
  curve: 'param' | 'implicit' | 'piecewise' | 'sampled';
  fx?: (s: number) => number;
  fy?: (s: number) => number;
  lo?: number;
  hi?: number;
  closed?: boolean | boolean[];
  f?: (x: number, y: number) => number;
  /** The language's relation value for `F == G` (residual is F - G). */
  residual?: (x: number, y: number) => number;
  level?: number;
  poly?: { i: number; j: number; c: number }[];
  text?: string;
  pieces?: Float64Array[];
  origin?: string;
}

export const curveVal = (f: Figure, name: string): CurveVal => val<CurveVal>(f, name);

export function xy(f: Figure, name: string, s: number): [number, number] {
  const c = curveVal(f, name);
  if (c.fx === undefined || c.fy === undefined) throw new Error(`${name} is not a parametric curve`);
  return [c.fx(s), c.fy(s)];
}

/** F(x, y) - level for an implicit curve, zero on the curve. */
export function implicitAt(f: Figure, name: string, x: number, y: number): number {
  const c = curveVal(f, name);
  if (c.f !== undefined) return c.f(x, y) - (c.level ?? 0);
  if (c.residual !== undefined) return c.residual(x, y);
  throw new Error(`${name} is not an implicit curve (no field f and no residual)`);
}

export function samples(f: Figure, name: string): [number, number][] {
  const c = curveVal(f, name);
  if (c.pieces === undefined) throw new Error(`${name} is not a sampled curve`);
  const out: [number, number][] = [];
  for (const p of c.pieces) for (let i = 0; i + 1 < p.length; i += 2) out.push([p[i] as number, p[i + 1] as number]);
  return out;
}

export const pieceCount = (f: Figure, name: string): number => curveVal(f, name).pieces?.length ?? 0;

/** Sets a free value (a slider) and runs the update pass. */
export function setFree(f: Figure, name: string, value: number): void {
  const r = f.setFree(name, value, 'slider');
  if (!(r as { ok: boolean }).ok) throw new Error(`setFree(${name}, ${value}) failed: ${JSON.stringify(r)}`);
  f.flush();
}

/** A notice code on the last result of a line. */
export const noticeCodes = (r: TxOk): string[] => r.notices.map((n) => n.code);

/** The `value` (signed) and `area` (unsigned) of a Region object, read from the cell. */
export function region(f: Figure, name: string): { value: number; area: number } {
  const r = val<{ kind: string; value: number; area: number }>(f, name);
  if (r.kind !== 'region') throw new Error(`${name} is not a region: ${JSON.stringify(r).slice(0, 100)}`);
  return r;
}
