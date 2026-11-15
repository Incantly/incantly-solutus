/**
 * The single entry point (cas/design.md 5.1, 5.13, 5.15): `run(op, args, opts, ctx)` with
 * budgets, caching and derivation logging. No rule is ever called directly from the kernel.
 * Heavy ops run in the worker with the full budget; the fast lane answers from the cache
 * or reports `pending`.
 */
import type { ErrorObject, Notice, ObjId, Phase } from '@incantly/kernel';
import type { Result } from '@incantly/kernel';
import type { ErrorKind } from '@incantly/kernel';
import type { Assumptions } from './assume';
import { assumptions as makeAssumptions } from './assume';
import type { Cell, OpName, RunContext, Step, SymArg, SymbolicLimits } from './contracts';
import { DEFAULT_LIMITS, HEAVY_OPS, SYMBOLIC_COMMANDS, SYMBOLIC_ERROR_CODES, undefinedCell } from './contracts';
import type { SymCond, SymNode } from './node';
import { freeSymbols, freeSymbolsCond } from './node';
import {
  ARENA_REBUILD_AT, arena, condKey, floatN, internCondTree, internTree, LimitExceeded, mapNodes, mapCondNodes,
  ratN, withDigitLimit,
} from './node';
import { shortestDecimalRational } from './num';
import type { Ticker } from './poly';
import { parseExprOrCond, ParseFailure } from './parse';
import { NonElementary, integrateNode } from './calc';
import { registerIntegrator, resetTrigParams, Unsupported } from './solve';
import { OPS, OpError } from './ops';
import type { OpCtx } from './ops';
import { parseCommandCall, stepsToText, TEACHING_RULES } from './steps';

export const ENGINE_VERSION = 1;

registerIntegrator((e, v, ctx) => integrateNode(e, v, ctx));

/* ---------------------------------- budget ----------------------------------- */

export class BudgetExceeded extends Error {
  readonly kind: 'steps' | 'ms' | 'nodes' | 'digits';
  /** Where the budget ran out: the command, and the last rule it applied. */
  stage = '';
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

/**
 * Key an argument by everything that can change an answer: node ids (one per structure),
 * the exact shape of a condition, the flags and the holes carried with a value. Text and
 * names are quoted, so no two different arguments print the same key.
 */
function argKey(a: SymArg): string {
  switch (a.k) {
    case 'expr': {
      const ex = a.excluded === undefined ? '' : `x[${a.excluded.map(condKey).join(',')}]`;
      const ty = a.typed === undefined ? '' : `y${a.typed.id}`;
      const di = a.display === undefined ? '' : `d${JSON.stringify(a.display)}`;
      return `e${a.e.id}${a.exact ? '' : '~'}${ex}${ty}${di}`;
    }
    case 'cond': return `c${condKey(a.c)}${a.exact ? '' : '~'}`;
    case 'sym': return `s${JSON.stringify(a.name)}:${a.domain}`;
    case 'num': return `n${Object.is(a.v, -0) ? '-0' : String(a.v)}`;
    case 'int': return `i${a.v}`;
    case 'text': return `t${JSON.stringify(a.v)}`;
    case 'bool': return `b${a.v}`;
    case 'list': {
      const cs = a.cases === undefined ? '' : `k[${a.cases.map((c) => `${condKey(c.when)}=${c.solutions === 'all' || c.solutions === 'none' ? c.solutions : c.solutions.map((x) => x.id).join('.')}`).join(',')}]`;
      return `l[${a.items.map(argKey).join(',')}]${cs}`;
    }
    case 'matrix': return `m[${a.rows.map((r) => r.map((x) => x.id).join(',')).join(';')}]`;
    case 'function': return `f${JSON.stringify(a.param)}=${a.body.id}${a.exact ? '' : '~'}`;
    case 'named': return `${JSON.stringify(a.name)}=${argKey(a.v)}`;
  }
}

function limitsKey(l: SymbolicLimits): string {
  return (Object.keys(DEFAULT_LIMITS) as (keyof SymbolicLimits)[]).map((k) => `${l[k]}`).join('/');
}

function cacheKey(op: OpName, args: readonly SymArg[], assume: Assumptions, limits: SymbolicLimits): string {
  const doms = [...assume.domains.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([k, v]) => `${JSON.stringify(k)}:${v}`).join(',');
  const facts = assume.facts.map(condKey).join(';');
  return `${ENGINE_VERSION}|${op}|${args.map(argKey).join('|')}|${doms}|${facts}|${limitsKey(limits)}`;
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

// A cache entry holds nodes of the arena; when the arena is rebuilt they are no longer its nodes.
arena.onRebuild(clearCache);

/** A registry answers only its own keys: `constructor` or `toString` is not an entry. */
function ownValue<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/**
 * Put a worker's answer in this realm's cache (design 5.13: the fast lane answers from
 * the cache the worker filled). `key` comes from `runCacheKey` on the worker side; the
 * cell and notices must already be interned here (see `acceptWorkerResponse`).
 */
export function seedCache(key: string, result: Result<RunSuccess>): void {
  if (result.ok) cachePut(key, result.value.cell, result.notices);
}

/* ---------------------------------- errors ----------------------------------- */

const OP_PHASES: Readonly<Record<string, Phase>> = {
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

/** The forms of a command as readable signatures, at most four (errors.md 1.1). */
function formsOf(op: string): string[] {
  const cmd = SYMBOLIC_COMMANDS.find((c) => c.name === op);
  if (cmd === undefined) return [];
  return cmd.forms.slice(0, 4).map((f) => `${op}(${f.params.map((q) => `${q.name}${q.optional === true ? '?' : ''}: ${q.type}`).join(', ')}) -> ${f.returns}`);
}

/** Parameters that are not options (the first, required ones): never listed as named arguments. */
function positionalOnly(op: string, name: string): boolean {
  const cmd = SYMBOLIC_COMMANDS.find((c) => c.name === op);
  if (cmd === undefined) return false;
  return cmd.forms.every((f) => f.params.some((q) => q.name === name && q.optional !== true));
}

/** Names a command accepts as named arguments: every parameter name of every form. */
function optionNamesOf(op: string): string[] {
  const cmd = SYMBOLIC_COMMANDS.find((c) => c.name === op);
  if (cmd === undefined) return [];
  const names = new Set<string>();
  for (const f of cmd.forms) for (const q of f.params) names.add(q.name);
  return [...names];
}

function opErrorToObject(e: OpError, op?: string): ErrorObject {
  const forms = e.forms.length > 0 || op === undefined || (e.kind !== 'no_matching_form' && e.kind !== 'arg_count') ? e.forms : formsOf(op);
  const code = ownValue(SYMBOLIC_ERROR_CODES as Readonly<Record<string, string>>, e.kind) ?? ownValue(CORE_ERROR_CODES, e.kind) ?? 'Y000';
  const phase = (ownValue(OP_PHASES, e.kind) ?? 'typecheck') as ErrorObject['phase'];
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
    forms,
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

/** Rebuild the arena at the start of a top-level run, never in the middle of one. */
let runDepth = 0;

/** Rebuild every argument tree as this arena's nodes (a no-op for nodes it already owns). */
function internArg(a: SymArg, memo: Map<SymNode, SymNode>): SymArg {
  switch (a.k) {
    case 'expr': {
      const out: { -readonly [K in keyof typeof a]: (typeof a)[K] } = { ...a, e: internTree(a.e, memo) };
      if (a.typed !== undefined) out.typed = internTree(a.typed, memo);
      if (a.excluded !== undefined) out.excluded = a.excluded.map((c) => internCondTree(c, memo));
      return out;
    }
    case 'cond': return { ...a, c: internCondTree(a.c, memo) };
    case 'list': {
      const out: { -readonly [K in keyof typeof a]: (typeof a)[K] } = { ...a, items: a.items.map((x) => internArg(x, memo)) };
      if (a.cases !== undefined) {
        out.cases = a.cases.map((c) => ({
          when: internCondTree(c.when, memo),
          solutions: c.solutions === 'all' || c.solutions === 'none' ? c.solutions : c.solutions.map((s) => internTree(s, memo)),
        }));
      }
      return out;
    }
    case 'matrix': return { ...a, rows: a.rows.map((r) => r.map((x) => internTree(x, memo))) };
    case 'function': return { ...a, body: internTree(a.body, memo) };
    case 'named': return { ...a, v: internArg(a.v, memo) };
    default: return a;
  }
}

export function run(op: OpName, args: readonly SymArg[], opts: RunOptions = {}, ctx: RunContext = {}): Result<RunSuccess> {
  const top = runDepth === 0;
  runDepth++;
  try {
    if (top) {
      arena.sealBase();
      if (arena.size() > ARENA_REBUILD_AT) arena.rebuild();
      // Family parameters are numbered from k1 in every call, so a result
      // does not depend on the calls made before it (SYM-SM-21).
      resetTrigParams(argSymbols(args));
    }
    return runMapped(op, args, opts, ctx);
  } finally {
    runDepth--;
  }
}

function runMapped(op: OpName, args: readonly SymArg[], opts: RunOptions, ctx: RunContext): Result<RunSuccess> {
  try {
    return runInner(op, args, opts, ctx);
  } catch (err) {
    if (err instanceof OpError) return opErrorToObject(err, op);
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
            stage: err.stage === '' ? op : err.stage,
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
  // `op` names an entry of the command table and nothing else (not `constructor`, not `toString`).
  if (typeof op !== 'string' || !Object.hasOwn(OPS, op)) {
    throw new OpError('unknown_command', `${String(op).slice(0, 40)} is not a command.`, { token: String(op).slice(0, 40), recovery: 'fix_line' });
  }
  const limits: SymbolicLimits = { ...DEFAULT_LIMITS, ...ctx.limits, ...opts.limits };
  const memo = new Map<SymNode, SymNode>();
  const internedArgs = args.map((a) => internArg(a, memo));
  const internedFacts = ctx.facts === undefined ? undefined : ctx.facts.map((c) => internCondTree(c, memo));
  const restoreNodes = arena.guard(limits.maxNodes);
  try {
    return withDigitLimit(limits.maxDigits, () => runLimited(op, internedArgs, opts, { ...ctx, ...(internedFacts === undefined ? {} : { facts: internedFacts }) }, limits));
  } finally {
    restoreNodes();
  }
}

function runLimited(op: OpName, args: readonly SymArg[], opts: RunOptions, ctx: RunContext, limits: SymbolicLimits): Result<RunSuccess> {
  const assume = makeAssumptions(ctx.domains, ctx.facts);
  const positional: SymArg[] = [];
  const named = new Map<string, SymArg>();
  for (const a of args) {
    if (a.k === 'named') named.set(a.name, a.v);
    else positional.push(a);
  }
  const allowedNames = optionNamesOf(op);
  for (const name of named.keys()) {
    if (op !== 'Steps' && allowedNames.length > 0 && !allowedNames.includes(name)) {
      throw new OpError('bad_option', `${op} has no named argument ${name}.`, {
        token: name,
        expected: allowedNames.filter((n) => !positionalOnly(op, n)),
        hint: `${op} accepts: ${allowedNames.join(', ')}.`,
        recovery: 'fix_line',
      });
    }
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
  const key = cacheKey(op, [...resolved, ...[...namedResolved.entries()].map(([k, v]) => ({ k: 'named' as const, name: k, v }))], assume, limits);
  if (!wantSteps) {
    const hit = cacheGet(key);
    if (hit !== undefined) return { ok: true, value: { cell: hit.cell }, notices: [...hit.notices] };
  }
  // A heavy op with a fast-lane budget gets that budget as its wall time: a cache hit or a
  // fast finish updates the cell now, and a miss that runs past it is `pending` (below).
  if (op === 'Steps') return runSteps(resolved, namedResolved, limits, assume, opts, ctx);
  const budget = new Budget(limits, opts.fastLaneMs);
  const logged: Step[] = [];
  let stage: string = op;
  const note = (rule: string, before: SymNode, after: SymNode): void => {
    stage = `${op}: ${rule}`;
    if (wantSteps) logged.push({ rule, before, after, teaching: TEACHING_RULES.has(rule) });
    ctx.note?.(rule, before, after);
  };
  const opCtx: OpCtx = {
    assume,
    tick: budget,
    note,
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
    if (err instanceof BudgetExceeded && err.stage === '') err.stage = stage;
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

function argTextToSym(text: string, force: 'num' | 'text' | undefined, tick: Ticker): SymArg {
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
  if (t.startsWith('[') && t.endsWith(']')) return parseListText(t, tick);
  const parsed = parseExprOrCond(t, tick);
  if ('cond' in parsed) return { k: 'cond', c: parsed.cond, exact: true };
  return { k: 'expr', e: parsed.expr, exact: true };
}

function parseListText(t: string, tick: Ticker): SymArg {
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
    const parsed = parseExprOrCond(pt, tick);
    if ('cond' in parsed) return { k: 'cond', c: parsed.cond, exact: true } as SymArg;
    return { k: 'expr', e: parsed.expr, exact: true } as SymArg;
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
  args: readonly SymArg[], _named: ReadonlyMap<string, SymArg>, limits: SymbolicLimits, _assume: Assumptions,
  opts: RunOptions, ctx: RunContext,
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
  if (!Object.hasOwn(OPS, call.op) || call.op === 'Steps') {
    throw new OpError('unknown_command', `Steps cannot run ${call.op.slice(0, 40)}.`, { token: call.op.slice(0, 40), recovery: 'fix_line' });
  }
  // The text of the call is read under the same budget as the command it names.
  const parseBudget = new Budget(limits);
  const symArgs = call.args.map((t) => argTextToSym(t, undefined, parseBudget));
  const symNamed = new Map<string, SymArg>();
  for (const [k, v] of call.named) {
    symNamed.set(k, argTextToSym(v, NUMERIC_ARG_NAMES.has(k) ? 'num' : TEXT_ARG_NAMES.has(k) ? 'text' : undefined, parseBudget));
  }
  const innerRes = run(
    call.op as OpName,
    [...symArgs, ...[...symNamed.entries()].map(([k, v]) => ({ k: 'named' as const, name: k, v }))],
    { steps: true, limits, ...(opts.fastLaneMs === undefined ? {} : { fastLaneMs: opts.fastLaneMs }) },
    ctx,
  );
  if (!innerRes.ok) return innerRes;
  const innerCell = innerRes.value.cell;
  if (!innerCell.defined && (innerCell.reason === 'pending' || innerCell.reason === 'timeout' || innerCell.reason === 'limit')) {
    return { ok: true, value: { cell: innerCell }, notices: innerRes.notices };
  }
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

/* ------------------------------ cache key export ------------------------------ */

/**
 * The key `run` would cache this call under, or null when the call is not a command.
 * A worker returns it with its answer so the host can `seedCache` its own cache.
 */
export function runCacheKey(op: OpName, args: readonly SymArg[], opts: RunOptions = {}, ctx: RunContext = {}): string | null {
  if (!Object.hasOwn(OPS, op)) return null;
  const limits: SymbolicLimits = { ...DEFAULT_LIMITS, ...ctx.limits, ...opts.limits };
  const memo = new Map<SymNode, SymNode>();
  const assume = makeAssumptions(ctx.domains, ctx.facts === undefined ? undefined : ctx.facts.map((c) => internCondTree(c, memo)));
  const positional: SymArg[] = [];
  const named: SymArg[] = [];
  for (const a of args) {
    const i = internArg(a, memo);
    if (i.k === 'named') named.push({ k: 'named', name: i.name, v: resolveRefs(i.v, ctx.resolveRef) });
    else positional.push(resolveRefs(i, ctx.resolveRef));
  }
  return cacheKey(op, [...positional, ...named], assume, limits);
}

// Every node made while the modules loaded (their constants) survives an arena rebuild.
arena.markBase();

/** Every symbol name free in the arguments of a call. */
function argSymbols(args: readonly SymArg[]): Set<string> {
  const out = new Set<string>();
  const walk = (a: SymArg): void => {
    if (a.k === 'expr') for (const s of freeSymbols(a.e)) out.add(s);
    else if (a.k === 'cond') for (const s of freeSymbolsCond(a.c)) out.add(s);
    else if (a.k === 'sym') out.add(a.name);
    else if (a.k === 'list') a.items.forEach(walk);
    else if (a.k === 'named') walk(a.v);
    else if (a.k === 'function') for (const s of freeSymbols(a.body)) out.add(s);
  };
  args.forEach(walk);
  return out;
}
