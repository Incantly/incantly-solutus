/**
 * CAS commands in figures (cas/design.md 5.2, 5.3, 5.15; .kiro/specs/cas R2).
 *
 * The kernel never imports the algebra engine. A host registers the command catalogue (data, light) with `registerCas`,
 * and hands the engine over with `setCasEngine` once it has loaded it. Until then a symbolic object is undefined with
 * reason `pending`, and `setCasEngine` tells the host which figures to refresh (`onCasEngine`).
 *
 * Symbolic arguments (`mode: 'symbolic'`) are body arguments: `x`, `y` and `z` are unknowns in their scope, the checked
 * tree goes to the engine, and every object the argument names is an edge as usual. No DOM, timers or Date.
 */
import type { ObjId } from '../../contracts/values';
import type { CommandRegistry, CommandRule, RuleCall } from '../../graph/registry';
import { registerPropertyTypes } from '../../graph/props';
import { registerLineRewriter } from '../../graph/registry';
import { PROPERTIES, registerProperty } from '../../language/props';
import { registerValueText } from '../../language/runtime';
import type { CommandForm, CommandSpec, ParamSpec } from '../../language/table';
import type { TNode } from '../../language/tnode';
import { registerTypeAlias } from '../../language/types';

declare module '../../contracts/values' {
  interface AreaUndefReasons {
    // cas (errors.md 3): the engine's reasons
    pending: true;
    unsupported: true;
    no_limit: true;
    divergent: true;
    indeterminate: true;
    unproven: true;
    singular: true;
    not_symbolic: true;
    time_dependent_input: true;
  }
}

/* ------------------------------ the catalogue (data from the engine package) ------------------------------ */

/** One parameter of a CAS form, as the engine's catalogue gives it. */
export interface CasParam {
  readonly name: string;
  readonly type: string;
  readonly optional?: boolean;
  readonly mode?: 'value' | 'symbolic';
  readonly default?: number | boolean | string;
}
export interface CasForm {
  readonly params: readonly CasParam[];
  /** `null` for an action. */
  readonly returns: string | null;
  readonly summary: string;
}
export interface CasCommand {
  readonly name: string;
  readonly kind: 'object' | 'action';
  readonly heavy: boolean;
  readonly forms: readonly CasForm[];
  readonly phase?: number;
}

/* ------------------------------ the engine contract ------------------------------ */

/** What the engine gets for one argument of a call. */
export type CasArgIn =
  /** A symbolic argument: the checked tree, the names of the locals it may use by slot, and how to read it. */
  | { readonly k: 'tree'; readonly as: 'expr' | 'cond' | 'var' | 'list'; readonly tree: TNode; readonly locals: ReadonlyMap<number, string>; readonly name: string; readonly optional: boolean }
  /** A plain value (a number of digits, a text such as a domain), or an omitted optional parameter. */
  | { readonly k: 'value'; readonly value: unknown; readonly name: string; readonly omitted: boolean; readonly optional: boolean; readonly id?: ObjId };

/** What the engine may read of the figure while it converts arguments. */
export interface CasHost {
  read(id: ObjId): unknown;
  info(id: ObjId): { readonly name: string; readonly type: string; readonly free: boolean; readonly definition: string } | undefined;
}

export type CasOut = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: string; readonly detail?: string };

/**
 * Exact calculus for the functions area (cas/design.md 5.15): a Function object's definition (`f(x) = x^2 - 3x`) and the
 * numbers it reads go in; exact results come back as numbers, or `undefined` to fall back to the numeric method.
 */
export interface CasCalculus {
  /** The definite integral; `{ diverges }` when the engine proves it does not converge. */
  definite(def: string, inputs: ReadonlyMap<string, number>, a: number, b: number): { readonly value: number } | { readonly diverges: string } | undefined;
  /** The exact antiderivative as a callable function of x. */
  antiderivative(def: string, inputs: ReadonlyMap<string, number>): ((x: number) => number) | undefined;
  /** The exact zeros of f', sorted. */
  stationary(def: string, inputs: ReadonlyMap<string, number>): readonly number[] | undefined;
}

export interface CasEngine {
  readonly calculus?: CasCalculus;
  evaluate(req: { readonly op: string; readonly returns: string; readonly args: readonly CasArgIn[]; readonly owner: string; readonly t: number; readonly host: CasHost }): CasOut;
}

/** A symbolic value as figures hold it: the engine's own data, with its text and LaTeX printed once. */
export interface SymValue {
  readonly sym: 'Expr' | 'Cond' | 'Symbol';
  /** The engine's argument form of the value (opaque to the kernel). */
  readonly arg: unknown;
  readonly text: string;
  readonly latex: string;
  /** False when an inexact number entered (printed with ≈). */
  readonly exact: boolean;
  /** The text in the input syntax (`==` for an equation), so the value can be typed back as a line. */
  readonly input?: string;
  /** Spoken form for screen readers (ui.md 8). */
  readonly speech?: string;
  /** The free unknowns, sorted. */
  readonly unknowns?: readonly string[];
  /** The decimal value of an Expr with no unknowns (the hover of an exact output, ui.md 5). */
  readonly approx?: number;
  /** For an equation `v == number` in one unknown: that unknown and number (a solution, drawn as a point). */
  readonly solved?: { readonly name: string; readonly value: number };
  /** What the value draws (ui.md 7), built once by the engine. */
  readonly plot?: SymPlot;
}

/** The drawing of a symbolic value (cas ui.md 7). Functions are of the screen's x (and y). */
export type SymPlot =
  /** An Expr in one unknown: the curve y = e, with open circles at the excluded values. */
  | { readonly kind: 'curve'; readonly f: (x: number) => number; readonly holes: readonly number[] }
  /** A Cond in one unknown: points on the x axis for ==, shaded intervals for an inequality. */
  | { readonly kind: 'axis'; readonly residual: (x: number) => number; readonly test: (x: number) => boolean | undefined; readonly ops: readonly string[] }
  /** A Cond in two unknowns: an implicit curve or a shaded region. */
  | { readonly kind: 'relation'; readonly residual: (x: number, y: number) => number; readonly test: (x: number, y: number) => boolean | undefined; readonly ops: readonly string[] };

export function isSymValue(v: unknown): v is SymValue {
  return typeof v === 'object' && v !== null && typeof (v as { sym?: unknown }).sym === 'string' && typeof (v as { text?: unknown }).text === 'string';
}

let engine: CasEngine | undefined;
const waiting = new Set<() => void>();

/** Hands the engine over. Everything registered with `onCasEngine` is told once. */
export function setCasEngine(e: CasEngine): void {
  engine = e;
  for (const f of [...waiting]) {
    try {
      f();
    } catch {
      // one host's refresh must not stop the others
    }
  }
  waiting.clear();
}

/** The engine's exact calculus, when an engine with one is set. */
export function casCalculus(): CasCalculus | undefined {
  return engine?.calculus;
}

export function casEngineReady(): boolean {
  return engine !== undefined;
}

/** Runs `f` when the engine is set (at once when it already is). */
export function onCasEngine(f: () => void): void {
  if (engine) f();
  else waiting.add(f);
}

/* ------------------------------ types ------------------------------ */


/** The body type a parameter takes: an expression, a condition, an unknown, or a list of them. */
function bodyType(p: CasParam): string {
  if (p.type === 'Expr') return 'CasExpr';
  if (p.type === 'Cond') return 'CasCond';
  if (p.type === 'Symbol') return 'CasVar';
  return 'Any';
}

function isSymbolic(p: CasParam): boolean {
  return p.mode === 'symbolic' || p.type === 'Symbol' || /^List<(Cond|Expr|Symbol)>$/.test(p.type);
}

function treeAs(p: CasParam): 'expr' | 'cond' | 'var' | 'list' {
  if (p.type.startsWith('List<')) return 'list';
  if (p.type === 'Cond') return 'cond';
  if (p.type === 'Symbol') return 'var';
  return 'expr';
}

/* ------------------------------ rules ------------------------------ */

const UNKNOWNS = [
  { name: 'x', type: 'Number' },
  { name: 'y', type: 'Number' },
  { name: 'z', type: 'Number' },
] as const;

function ruleFor(cmd: CasCommand, form: CasForm): () => CommandRule {
  const run = (call: RuleCall): unknown => {
    const e = engine;
    if (!e) return call.fail('pending', 'the algebra engine is loading');
    const args: CasArgIn[] = form.params.map((p, i) => {
      const a = call.args[i];
      if (isSymbolic(p) && a && !a.omitted && a.tree) {
        const locals = new Map<number, string>();
        for (const s of a.scopeSlots ?? []) locals.set(s.slot, s.name);
        return { k: 'tree', as: treeAs(p), tree: a.tree, locals, name: p.name, optional: p.optional === true };
      }
      const id = call.ids[i];
      return { k: 'value', value: call.values[i], name: p.name, omitted: a?.omitted ?? true, optional: p.optional === true, ...(id !== undefined ? { id } : {}) };
    });
    const figure = call.env.host as { get?(id: ObjId): { name: string; type: string; free: boolean; definition: string } | undefined } | undefined;
    const host: CasHost = {
      read: (id) => call.env.read(id),
      info: (id) => {
        const v = figure?.get?.(id);
        return v ? { name: v.name, type: v.type, free: v.free, definition: v.definition } : undefined;
      },
    };
    let out: CasOut;
    try {
      out = e.evaluate({ op: cmd.name, returns: form.returns ?? '', args, owner: call.random.owner, t: call.t, host });
    } catch {
      return call.fail('unsupported', `${cmd.name} could not be computed`);
    }
    if (!out.ok) return call.fail(out.reason as never, out.detail);
    return out.value;
  };
  return () => ({ run, acceptsUndefined: false });
}

function kernelForm(cmd: CasCommand, form: CasForm): CommandForm {
  const params: ParamSpec[] = form.params.map((p) => {
    if (isSymbolic(p)) return { name: p.name, type: bodyType(p), kind: 'body', scope: UNKNOWNS, ...(p.optional ? { optional: true } : {}) };
    return { name: p.name, type: p.type, ...(p.optional ? { optional: true } : {}), ...(p.default !== undefined ? { default: p.default } : {}) };
  });
  const f: CommandForm = { params, returns: form.returns, rule: ruleFor(cmd, form), summary: form.summary };
  CAS_FORMS.add(f);
  return f;
}

const CAS_FORMS = new WeakSet<object>();

/** True for a form the CAS added (a command of the same name may also have forms from another area). */
export function isCasForm(form: object): boolean {
  return CAS_FORMS.has(form);
}

/** Commands of later phases (trig forms, matrices, ODEs, steps) are kept out until the engine passes their tests. */
const PHASE_1_LEFT_OUT = new Set(['TrigExpand', 'TrigCombine', 'TrigSimplify', 'Eigenvalues', 'Eigenvectors', 'CharacteristicPolynomial', 'Inverse', 'Determinant', 'Steps', 'SolveODE']);

let registeredTypes = false;

function registerTypes(): void {
  if (registeredTypes) return;
  registeredTypes = true;
  // what a symbolic argument may be (design 5.3): a number formula in x y z, an Expr, or an unknown
  registerTypeAlias('CasExpr', ['Number', 'Expr', 'Symbol']);
  registerTypeAlias('CasCond', ['Bool', 'Cond']);
  registerTypeAlias('CasVar', ['Number', 'Symbol']);
  registerValueText((v) => (isSymValue(v) ? v.text : undefined));
  // `k = Symbol() with domain = positive` (agent.md 1): the domain is part of the unknown, so the line is read as
  // `k = Symbol(domain = "positive")`
  if (!Object.hasOwn(PROPERTIES, 'domain')) registerProperty('domain', {
    kind: 'enum',
    values: ['real', 'positive', 'nonneg', 'negative', 'nonpos', 'nonzero', 'integer', 'natural', 'rational', 'complex'],
    allowed: 'real, positive, nonneg, negative, nonpos, nonzero, integer, natural, rational or complex',
  } as (typeof PROPERTIES)[string]);
  registerPropertyTypes('domain', ['Symbol']);
  // the row's show switch (ui.md 1 and 4): off by default, so a worked solution does not fill the graph by itself
  if (!Object.hasOwn(PROPERTIES, 'plot')) registerProperty('plot', { kind: 'bool', allowed: 'true or false' } as (typeof PROPERTIES)[string]);
  registerPropertyTypes('plot', ['Expr', 'Cond', 'List']);
  registerLineRewriter((_fig, text) => {
    const m = /^(\s*[A-Za-z\u0370-\u03FF][\w\u0370-\u03FF]*\s*=\s*Symbol\(\s*\))\s+with\s+(.*)$/.exec(text);
    if (!m) return undefined;
    const items = (m[2] as string).split(',').map((s) => s.trim());
    const dom = items.find((s) => /^domain\s*=/.test(s));
    if (!dom) return undefined;
    const word = dom.replace(/^domain\s*=\s*/, '').replace(/^"|"$/g, '');
    const rest = items.filter((s) => s !== dom);
    const head = (m[1] as string).replace(/Symbol\(\s*\)$/, `Symbol(domain = "${word}")`);
    return { text: rest.length > 0 ? `${head} with ${rest.join(', ')}` : head };
  });
}

/** Names the CAS adds, for a host that wants to know when a line needs the engine. */
export const CAS_COMMAND_NAMES = new Set<string>();

/** Plugs the CAS commands of the catalogue into a registry (design 5.15). */
export function registerCas(registry: CommandRegistry, catalogue: readonly CasCommand[]): void {
  registerTypes();
  const specs: CommandSpec[] = [];
  for (const cmd of catalogue) {
    if (cmd.kind !== 'object' || PHASE_1_LEFT_OUT.has(cmd.name) || cmd.forms.some((f) => f.returns === null)) continue;
    const forms = withoutPrefixForms(cmd.forms).map((f) => kernelForm(cmd, withSymbolDomain(cmd, f)));
    // `Substitute(sol, s0, t)` over a list of solutions (agent.md 2)
    if (cmd.name === 'Substitute') {
      forms.push(kernelForm(cmd, { params: [{ name: 'list', type: 'List' }, { name: 'old', type: 'Expr', mode: 'symbolic' }, { name: 'new', type: 'Expr', mode: 'symbolic' }], returns: '=list', summary: 'Replace in every item of a list' }));
    }
    // `Expr` of a comparison is a Cond (design 2.1)
    if (cmd.name === 'Expr') forms.push(kernelForm(cmd, { params: [{ name: 'c', type: 'Cond', mode: 'symbolic' }], returns: 'Cond', summary: 'An equation or inequality written with unknowns' }));
    specs.push({ name: cmd.name, kind: 'object', group: 'symbolic', forms });
    CAS_COMMAND_NAMES.add(cmd.name);
  }
  registry.registerAll(specs);
}

/**
 * A form whose parameters are the start of another form, the rest optional, is the same form: `Factor(e)` and
 * `Factor(e, over)`. Keeping both would make one argument fit two forms equally well.
 */
function withoutPrefixForms(forms: readonly CasForm[]): CasForm[] {
  return forms.filter((f) => !forms.some((g) => g !== f && g.params.length > f.params.length
    && f.params.every((p, i) => g.params[i]?.type === p.type && (g.params[i]?.mode ?? 'value') === (p.mode ?? 'value'))
    && g.params.slice(f.params.length).every((p) => p.optional === true)));
}

/** `Symbol()` also takes its domain by name, which the `with domain` rewrite writes. */
function withSymbolDomain(cmd: CasCommand, f: CasForm): CasForm {
  if (cmd.name !== 'Symbol' || f.params.some((p) => p.name === 'domain')) return f;
  return { ...f, params: [...f.params, { name: 'domain', type: 'Text', optional: true }] };
}

export const CAS_TYPE_NAMES: readonly string[] = ['Expr', 'Cond', 'Symbol'];
