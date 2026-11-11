/**
 * The single entry point (cas/design.md 5.1, 5.13, 5.15): `run(op, args, opts, ctx)` with
 * budgets, caching and derivation logging. No rule is ever called directly from the kernel.
 * Heavy ops run in the worker with the full budget; the fast lane answers from the cache
 * or reports `pending`.
 */
import type { ErrorObject, Notice, ObjId } from '@incantly/kernel';
import type { Result } from '@incantly/kernel';
import type { ErrorKind } from '@incantly/kernel';
import type { Assumptions } from './assume';
import { assumptions as makeAssumptions } from './assume';
import type { Cell, OpName, RunContext, Step, SymArg, SymbolicLimits } from './contracts';
import { DEFAULT_LIMITS, HEAVY_OPS, SYMBOLIC_ERROR_CODES, undefinedCell } from './contracts';
import type { SymCond, SymNode } from './node';
import { floatN, intN, LimitExceeded, mapNodes, mapCondNodes, ratN } from './node';
import { shortestDecimalRational } from './num';
import type { Ticker } from './poly';
import { condText } from './print';
import { parseCondition, parseExprOrCond, ParseFailure } from './parse';
import { NonElementary, integrateNode } from './calc';
import { registerIntegrator, Unsupported } from './solve';
import { OPS, OpError } from './ops';
import type { OpCtx } from './ops';
import { parseCommandCall, stepsToText, TEACHING_RULES } from './steps';

export const ENGINE_VERSION = 1;

registerIntegrator((e, v, ctx) => integrateNode(e, v, ctx));

/* ---------------------------------- budget ----------------------------------- */

export class BudgetExceeded extends Error {
  readonly kind: 'steps' | 'ms' | 'nodes' | 'digits';
  constructor(kind: 'steps' | 'ms' | 'nodes' | 'digits') {
    super(`budget exceeded: ${kind}`);
    this.name = 'BudgetExceeded';
    this.kind = kind;
  }
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  return 0;
}

/**
 * Cooperative budget (cas/design.md 5.13). Steps are the deterministic primary budget;
 * the wall-clock check is a fallback that only ever produces `timeout`, never a value.
 */
export class Budget implements Ticker {
  private steps = 0;
  private sinceCheck = 0;
  private readonly t0: number;
  private readonly maxSteps: number;
  private readonly maxMs: number;
  constructor(limits: SymbolicLimits, fastLaneMs?: number) {
    this.maxSteps = limits.maxSteps;
    this.maxMs = fastLaneMs ?? limits.maxMs;
    this.t0 = nowMs();
  }
  tick(n = 1): void {
    this.steps += n;
    if (this.steps > this.maxSteps) throw new BudgetExceeded('steps');
    this.sinceCheck += n;
    if (this.sinceCheck >= 1024) {
      this.sinceCheck = 0;
      if (this.maxMs > 0 && nowMs() - this.t0 > this.maxMs) throw new BudgetExceeded('ms');
    }
  }
}

/* ---------------------------------- cache ------------------------------------ */

interface CacheEntry {
  readonly key: string;
  readonly bytes: number;
  readonly cell: Cell<SymArg>;
  readonly notices: readonly Notice[];
}

const cache = new Map<string, CacheEntry>();
let cacheBytes = 0;
const CACHE_MAX_ENTRIES = 4000;
const CACHE_MAX_BYTES = 32 * 1024 * 1024;

function argKey(a: SymArg): string {
  switch (a.k) {
    case 'expr': return `e${a.e.id}${a.exact ? '' : '~'}`;
    case 'cond': return `c${condText(a.c)}`;
    case 'sym': return `s${a.name}:${a.domain}`;
    case 'num': return `n${a.v}`;
    case 'int': return `i${a.v}`;
    case 'text': return `t${a.v}`;
    case 'bool': return `b${a.v}`;
    case 'list': return `l[${a.items.map(argKey).join(',')}]`;
    case 'matrix': return `m[${a.rows.map((r) => r.map((x) => x.id).join(',')).join(';')}]`;
    case 'function': return `f${a.param}=${a.body.id}`;
    case 'named': return `${a.name}=${argKey(a.v)}`;
  }
}

function cacheKey(op: OpName, args: readonly SymArg[], assume: Assumptions): string {
  const doms = [...assume.domains.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([k, v]) => `${k}:${v}`).join(',');
  const facts = assume.facts.map((f) => condText(f)).join(';');
  return `${ENGINE_VERSION}|${op}|${args.map(argKey).join('|')}|${doms}|${facts}`;
}

function cacheGet(key: string): CacheEntry | undefined {
  const hit = cache.get(key);
  if (hit === undefined) return undefined;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cachePut(key: string, cell: Cell<SymArg>, notices: readonly Notice[]): void {
  if (!cell.defined && cell.reason === 'pending') return;
  const bytes = key.length * 2 + 512;
  while ((cache.size >= CACHE_MAX_ENTRIES || cacheBytes + bytes > CACHE_MAX_BYTES) && cache.size > 0) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    const entry = cache.get(oldest.value as string);
    cache.delete(oldest.value as string);
    if (entry !== undefined) cacheBytes -= entry.bytes;
  }
  cache.set(key, { key, bytes, cell, notices });
  cacheBytes += bytes;
}

/** Clear the run cache (tests, memory pressure). */
export function clearCache(): void {
  cache.clear();
  cacheBytes = 0;
}

/* ---------------------------------- errors ----------------------------------- */

const OP_PHASES: Readonly<Record<string, 'typecheck' | 'plan' | 'resolve'>> = {
  not_symbolic: 'resolve',
  bad_variable: 'typecheck',
  time_dependent_input: 'plan',
  not_polynomial: 'typecheck',
  bad_digits: 'typecheck',
  bad_domain: 'typecheck',
  bad_option: 'typecheck',
  solve_arity: 'typecheck',
  bad_assumption: 'typecheck',
  redefinition_domain: 'commit',
  division_by_zero_literal: 'resolve',
};

/**
 * Kernel codes for the shared kinds we reuse. The kernel owns these numbers; the
 * `K000` values are placeholders the integrator replaces with the real codes.
 */
const CORE_ERROR_CODES: Readonly<Record<string, string>> = {
  syntax: 'K000',
  no_matching_form: 'K000',
  bad_argument: 'K000',
  unknown_command: 'K000',
  limit: 'K000',
  internal: 'K999',
};

function opErrorToObject(e: OpError): ErrorObject {
  const code = (SYMBOLIC_ERROR_CODES as Readonly<Record<string, string>>)[e.kind] ?? CORE_ERROR_CODES[e.kind] ?? 'Y000';
  const phase = (OP_PHASES[e.kind] ?? 'typecheck') as ErrorObject['phase'];
  return {
    ok: false,
    committed: false,
    kind: e.kind as ErrorKind,
    code,
    phase,
    message: e.message,
    messageKey: `symbolic.${e.kind}`,
    params: {},
    line: 1,
    col: 1,
    endCol: 1,
    token: e.token,
    expected: e.expected,
    forms: e.forms,
    ...(e.hint === undefined ? {} : { hint: e.hint }),
    suggest: e.suggest,
    recovery: e.recovery,
    ...(e.related === undefined ? {} : { related: e.related }),
    fingerprint: `${e.kind}:${e.token}`,
    severity: 'error',
  };
}

function internalError(message: string): ErrorObject {
  return {
    ok: false,
    committed: false,
    kind: 'internal',
    code: 'K999',
    phase: 'plan',
    message,
    messageKey: 'symbolic.internal',
    params: {},
    line: 1,
    col: 1,
    endCol: 1,
    token: '',
    expected: [],
    forms: [],
    suggest: [],
    recovery: 'report',
    fingerprint: 'internal:symbolic',
    severity: 'error',
  };
}

/* ------------------------------- refs + options ------------------------------- */

export interface RunOptions {
  /** Record the derivation log (for `Steps`). Bypasses the cache. */
  readonly steps?: boolean;
  /** The result object's name (for `Symbol()`). */
  readonly name?: string;
  readonly limits?: Partial<SymbolicLimits>;
  /** Fast-lane budget in ms; heavy cache misses report `pending`. */
  readonly fastLaneMs?: number;
}

export interface RunSuccess {
  readonly cell: Cell<SymArg>;
  readonly steps?: readonly Step[];
}

/** Substitute live `ref` values at compute time (exact when the decimal is short). */
function resolveRefs(a: SymArg, resolveRef: ((id: ObjId) => number | undefined) | undefined): SymArg {
  if (resolveRef === undefined) return a;
  const go = (t: SymNode): SymNode => mapNodes(t, (x) => {
    if (x.k !== 'ref') return x;
    const v = resolveRef(x.obj as ObjId);
    if (v === undefined) return x;
    const r = shortestDecimalRational(v);
    if (r !== null) return ratN(r.n, r.d);
    return floatN(v);
  });
  const goCond = (c: SymCond): SymCond => mapCondNodes(c, go);
  switch (a.k) {
    case 'expr': return { ...a, e: go(a.e) };
    case 'cond': return { ...a, c: goCond(a.c) };
    case 'list': return { ...a, items: a.items.map((x) => resolveRefs(x, resolveRef)) };
    case 'matrix': return { ...a, rows: a.rows.map((row) => row.map(go)) };
    case 'function': return { ...a, body: go(a.body) };
    case 'named': return { ...a, v: resolveRefs(a.v, resolveRef) };
    default: return a;
  }
}

/** True when an argument tree reads the clock symbol `t`. */
function readsClockArg(a: SymArg): boolean {
  const inTree = (t: SymNode): boolean => {
    if (t.k === 'sym') return t.name === 't';
    switch (t.k) {
      case 'add': return t.terms.some(inTree);
      case 'mul': return t.factors.some(inTree);
      case 'pow': return inTree(t.base) || inTree(t.exp);
      case 'fn': return t.args.some(inTree);
      case 'list': return t.items.some(inTree);
      case 'piecewise': return t.cases.some((cs) => inTree(cs.then) || inCond(cs.when));
      default: return false;
    }
  };
  const inCond = (c: SymCond): boolean => {
    switch (c.c) {
      case 'rel': return inTree(c.l) || inTree(c.r);
      case 'in': return inTree(c.l);
      case 'not': return inCond(c.of);
      case 'and':
      case 'or': return c.of.some(inCond);
      default: return false;
    }
  };
  switch (a.k) {
    case 'expr': return inTree(a.e);
    case 'cond': return inCond(a.c);
    case 'list': return a.items.some(readsClockArg);
    case 'matrix': return a.rows.some((row) => row.some(inTree));
    case 'function': return inTree(a.body);
    case 'named': return readsClockArg(a.v);
    default: return false;
  }
}

/* ----------------------------------- run -------------------------------------- */

export function run(op: OpName, args: readonly SymArg[], opts: RunOptions = {}, ctx: RunContext = {}): Result<RunSuccess> {
  try {
    return runInner(op, args, opts, ctx);
  } catch (err) {
    if (err instanceof OpError) return opErrorToObject(err);
    if (err instanceof Unsupported) {
      return {
        ok: true,
        value: {
          cell: undefinedCell<SymArg>('unsupported', {
            code: 'Y201',
            text: err.detail,
            ...(err.suggest.length > 0 ? { suggest: [...err.suggest] } : {}),
            stage: err.stage,
          }),
        },
        notices: [],
      };
    }
    if (err instanceof NonElementary) {
      return {
        ok: true,
        value: {
          cell: undefinedCell<SymArg>('non_elementary', {
            code: 'Y202',
            text: `No elementary antiderivative (needs ${err.special}).`,
            suggest: ['Use a definite integral: Integral(e, x, a, b).'],
            stage: 'integrate',
          }),
        },
        notices: [],
      };
    }
    if (err instanceof LimitExceeded) {
      return {
        ok: true,
        value: {
          cell: undefinedCell<SymArg>('limit', {
            code: 'Y209',
            text: `A size limit stopped the computation (${err.limit}).`,
            stage: err.limit,
          }),
        },
        notices: [],
      };
    }
    if (err instanceof BudgetExceeded) {
      const reason = err.kind === 'steps' || err.kind === 'ms' ? 'timeout' : 'limit';
      return {
        ok: true,
        value: {
          cell: undefinedCell<SymArg>(reason, {
            code: reason === 'timeout' ? 'Y208' : 'Y209',
            text: reason === 'timeout' ? 'The step budget ran out.' : 'A size limit stopped the computation.',
          }),
        },
        notices: [],
      };
    }
    if (err instanceof ParseFailure) {
      if (err.limit) return opErrorToObject(new OpError('limit', err.message, { token: err.token, recovery: 'rewrite' }));
      return opErrorToObject(new OpError('syntax', err.message, { token: err.token, recovery: 'fix_line' }));
    }
    return internalError(err instanceof Error ? err.message : 'Unknown symbolic failure.');
  }
}

function runInner(op: OpName, args: readonly SymArg[], opts: RunOptions, ctx: RunContext): Result<RunSuccess> {
  const limits: SymbolicLimits = { ...DEFAULT_LIMITS, ...ctx.limits, ...opts.limits };
  const assume = makeAssumptions(ctx.domains, ctx.facts);
  const positional: SymArg[] = [];
  const named = new Map<string, SymArg>();
  for (const a of args) {
    if (a.k === 'named') named.set(a.name, a.v);
    else positional.push(a);
  }
  const resolved = positional.map((a) => resolveRefs(a, ctx.resolveRef));
  const namedResolved = new Map<string, SymArg>();
  for (const [k, v] of named) namedResolved.set(k, resolveRefs(v, ctx.resolveRef));
  const heavy = HEAVY_OPS.has(op);
  if (heavy && resolved.some(readsClockArg)) {
    throw new OpError('time_dependent_input', `${op} cannot read the clock t; it would redo the algebra on every frame.`, {
      token: 't',
      hint: 'Do the algebra with a Symbol, then put the clock in: r0 = Solve(a*x == s, x) then r = Substitute(r0, s, t).',
      suggest: ['s = Symbol()'],
      recovery: 'rewrite',
    });
  }
  const wantSteps = opts.steps === true;
  const key = cacheKey(op, [...resolved, ...[...namedResolved.entries()].map(([k, v]) => ({ k: 'named' as const, name: k, v }))], assume);
  if (heavy && opts.fastLaneMs !== undefined) {
    const hit = cacheGet(key);
    if (hit !== undefined) return { ok: true, value: { cell: hit.cell }, notices: [...hit.notices] };
    return {
      ok: true,
      value: { cell: undefinedCell<SymArg>('pending', { code: 'Y200', text: 'The job is running in the worker.' }) },
      notices: [],
    };
  }
  if (!wantSteps) {
    const hit = cacheGet(key);
    if (hit !== undefined) return { ok: true, value: { cell: hit.cell }, notices: [...hit.notices] };
  }
  if (op === 'Steps') return runSteps(resolved, namedResolved, limits, assume, opts, ctx);
  const budget = new Budget(limits, opts.fastLaneMs);
  const logged: Step[] = [];
  const note = wantSteps || ctx.note !== undefined
    ? (rule: string, before: SymNode, after: SymNode): void => {
      if (wantSteps) logged.push({ rule, before, after, teaching: TEACHING_RULES.has(rule) });
      ctx.note?.(rule, before, after);
    }
    : undefined;
  const opCtx: OpCtx = {
    assume,
    tick: budget,
    note: note ?? ((): void => {}),
    limits,
    ...(opts.name === undefined ? {} : { name: opts.name }),
  };
  try {
    const out = OPS[op](resolved, namedResolved, opCtx);
    if (!wantSteps) cachePut(key, out.cell, out.notices);
    return {
      ok: true,
      value: wantSteps ? { cell: out.cell, steps: logged } : { cell: out.cell },
      notices: [...out.notices],
    };
  } catch (err) {
    if (err instanceof BudgetExceeded && err.kind === 'ms' && opts.fastLaneMs !== undefined) {
      return {
        ok: true,
        value: { cell: undefinedCell<SymArg>('pending', { code: 'Y200', text: 'The job is running in the worker.' }) },
        notices: [],
      };
    }
    throw err;
  }
}

/* ---------------------------------- Steps ------------------------------------- */

const NUMERIC_ARG_NAMES = new Set(['from', 'to', 'digits', 'start', 'n']);
const TEXT_ARG_NAMES = new Set(['over', 'domain']);

function argTextToSym(text: string, force?: 'num' | 'text'): SymArg {
  const t = text.trim();
  if (force === 'num' || (force === undefined && /^-?\d+(\.\d+)?$/.test(t))) {
    const v = Number(t);
    if (Number.isInteger(v) && Math.abs(v) < 2 ** 53) return { k: 'int', v: BigInt(v) };
    return { k: 'num', v };
  }
  if (force === 'text') return { k: 'text', v: t.replace(/^"|"$/g, '') };
  if (/^[A-Za-z][A-Za-z0-9_]*$/.test(t)) {
    if (t === 'true' || t === 'false') return { k: 'bool', v: t === 'true' };
    return { k: 'sym', name: t, domain: 'real' };
  }
  if (t.startsWith('[') && t.endsWith(']')) return parseListText(t);
  const parsed = parseExprOrCond(t);
  if ('cond' in parsed) return { k: 'cond', c: parsed.cond, exact: true };
  return { k: 'expr', e: parsed.expr, exact: true };
}

function parseListText(t: string): SymArg {
  const body = t.slice(1, -1).trim();
  if (body === '') return { k: 'list', items: [] };
  const parts = splitTop(body);
  const items: SymArg[] = parts.map((p) => {
    const pt = p.trim();
    if (/^[A-Za-z][A-Za-z0-9_]*$/.test(pt)) return { k: 'sym', name: pt, domain: 'real' } as SymArg;
    if (/^-?\d+(\.\d+)?$/.test(pt)) {
      const v = Number(pt);
      return Number.isInteger(v) ? { k: 'int', v: BigInt(v) } as SymArg : { k: 'num', v } as SymArg;
    }
    try {
      const c = parseCondition(pt);
      return { k: 'cond', c, exact: true } as SymArg;
    } catch {
      const parsed = parseExprOrCond(pt);
      if ('cond' in parsed) return { k: 'cond', c: parsed.cond, exact: true } as SymArg;
      return { k: 'expr', e: parsed.expr, exact: true } as SymArg;
    }
  });
  return { k: 'list', items };
}

function splitTop(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim() !== '' || parts.length > 0) parts.push(cur);
  return parts;
}

function runSteps(
  args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, _limits: SymbolicLimits, _assume: Assumptions,
  _opts: RunOptions, ctx: RunContext,
): Result<RunSuccess> {
  const a = args[0];
  if (a === undefined || a.k !== 'text') {
    throw new OpError('no_matching_form', 'Steps needs the command call as text, such as Solve(x^2 - 1 == 0, x).', {
      recovery: 'choose_form',
    });
  }
  let call: { op: string; args: readonly string[]; named: ReadonlyMap<string, string> };
  try {
    call = parseCommandCall(a.v);
  } catch (err) {
    throw new OpError('syntax', err instanceof Error ? err.message : 'Steps needs a command call.', { recovery: 'fix_line' });
  }
  const inner = OPS[call.op as OpName];
  if (inner === undefined || call.op === 'Steps') {
    throw new OpError('unknown_command', `Steps cannot run ${call.op}.`, { token: call.op, recovery: 'fix_line' });
  }
  const symArgs = call.args.map((t) => argTextToSym(t));
  const symNamed = new Map<string, SymArg>();
  for (const [k, v] of call.named) {
    symNamed.set(k, argTextToSym(v, NUMERIC_ARG_NAMES.has(k) ? 'num' : TEXT_ARG_NAMES.has(k) ? 'text' : undefined));
  }
  const innerRes = run(call.op as OpName, [...symArgs, ...[...symNamed.entries()].map(([k, v]) => ({ k: 'named' as const, name: k, v }))], { steps: true }, ctx);
  if (!innerRes.ok) return innerRes;
  const { lines, noSteps } = stepsToText(innerRes.value.steps ?? []);
  const items: SymArg[] = lines.map((line) => ({ k: 'text', v: line }));
  const notices: Notice[] = noSteps
    ? [{
      severity: 'info' as const,
      code: 'Y110',
      kind: 'no_steps' as Notice['kind'],
      message: 'This derivation has no teaching steps.',
      params: {},
    }]
    : [];
  return { ok: true, value: { cell: { defined: true, value: { k: 'list', items } } }, notices };
}
