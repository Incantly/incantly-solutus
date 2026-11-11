/**
 * Handler runs (controls-scripting/design.md 3.4): expansion against a staging
 * overlay, then one atomic batch.
 *
 * Runs are synchronous: guards, loop bounds and restyle values evaluate against
 * the overlay (later steps see earlier steps' writes), Click steps expand inline
 * (no nested runs, no queues), and the batch commits everything as one undo
 * entry. A limit abort happens before anything is applied, so either all writes
 * apply or none do. Also holds the action-outcome side table (area actions have
 * no error channel in the kernel) and Reset's initial-value tracking.
 */

import type { ErrorObject, Result } from '../../contracts/errors';
import type { ObjId } from '../../contracts/values';
import type { Figure } from '../../graph/figure';
import { valueText } from '../../language/runtime';
import { parseLine } from '../../language/parser';
import type { TNode } from '../../language/tnode';
import type { HandlerEvent, HandlerRun, SkipReason, StepResult } from './types';
import { NUMBERS_LIMITS } from './types';
import { numbersError } from './errors';
import { checkProbeLine, evalTNode, numLiteral, printExpr, printLineNode, substituteLine, valueLiteralExpr, valueLiteralText } from './eval';
import type { Binding } from './eval';
import { changeEventOf } from './events';
import { parseRangeRestyle, rangeLine } from './rangestep';
import type { RangeRestyle } from './rangestep';
import { emitControlEvent, expansionProbeName, getStoredHandler, recordRun } from './handlers';
import type { StoredStep } from './handlers';

/* ------------------------------ action outcomes ------------------------------ */

export type ActionOutcomeRecord =
  | { readonly status: 'done'; readonly wrote?: readonly ObjId[] }
  | { readonly status: 'skipped'; readonly reason: SkipReason }
  | { readonly status: 'error'; readonly error: ErrorObject };

const outcomes = new WeakMap<Figure, ActionOutcomeRecord[]>();

/** Record what an area action did (the kernel gives actions no error channel). */
export function pushActionOutcome(figure: Figure, outcome: ActionOutcomeRecord): void {
  const list = outcomes.get(figure) ?? [];
  list.push(outcome);
  while (list.length > 40) list.shift();
  outcomes.set(figure, list);
}

/** Drain outcomes recorded since the last call, in order. */
export function drainActionOutcomes(figure: Figure): ActionOutcomeRecord[] {
  const list = outcomes.get(figure) ?? [];
  outcomes.set(figure, []);
  return list;
}

/* ------------------------------ reset initials ------------------------------ */

interface ResetState {
  readonly initials: Map<ObjId, unknown>;
  tracked: boolean;
}

const resets = new WeakMap<Figure, ResetState>();

function resetStateFor(figure: Figure): ResetState {
  let s = resets.get(figure);
  if (!s) {
    s = { initials: new Map(), tracked: false };
    resets.set(figure, s);
  }
  return s;
}

function captureInitial(figure: Figure, id: ObjId): void {
  const s = resetStateFor(figure);
  if (s.initials.has(id)) return;
  const view = figure.get(id);
  if (!view) return;
  if (view.type === 'Choice') {
    const v = figure.value(id) as { index?: number } | undefined;
    if (typeof v?.index === 'number') s.initials.set(id, v.index);
    return;
  }
  if (view.free) s.initials.set(id, figure.value(id));
}

/**
 * Track initial free values for Reset: sweep the figure now and capture every
 * object added later. Author redefines should refresh initials too, but the
 * events do not distinguish a redefine from a write (kernel gap).
 */
export function ensureResetTracking(figure: Figure): void {
  const s = resetStateFor(figure);
  if (s.tracked) return;
  s.tracked = true;
  for (const o of figure.objects()) captureInitial(figure, o.id);
  figure.on((ev) => {
    if (ev.ev === 'add') captureInitial(figure, ev.id);
  });
}

export function initialOf(figure: Figure, id: ObjId): { readonly found: boolean; readonly value?: unknown } {
  const s = resetStateFor(figure);
  if (!s.initials.has(id)) return { found: false };
  return { found: true, value: s.initials.get(id) };
}

/**
 * Capture the current value as the initial unless one is already held. Write
 * paths call this before their first write, so the pre-write value (the true
 * initial when nothing wrote before) is kept even when tracking started late.
 */
export function captureResetInitial(figure: Figure, id: ObjId): void {
  captureInitial(figure, id);
}

/* ------------------------------ runs ------------------------------ */

export interface RunPayload {
  /** The new value (change events) or choice value. */
  readonly value?: unknown;
  /** The committed text (input events). */
  readonly text?: string;
  /** The object that changed (figure change events). */
  readonly changedName?: string;
  readonly by?: 'learner' | 'host';
}

export type RunTrigger = 'learner' | 'host' | 'click_call';

interface ExpandedLine {
  readonly text: string;
  readonly stepNo: number;
  /** True for our own action specs (SetValue, Toggle, Animate, Reset): outcomes zip to these. */
  readonly ours: boolean;
  readonly wrote: readonly ObjId[];
}

const OUR_ACTIONS: ReadonlySet<string> = new Set(['SetValue', 'Toggle', 'Animate', 'Reset']);

function runtimeBindings(
  figure: Figure,
  target: string,
  event: HandlerEvent,
  payload: RunPayload,
  selfName: string,
): Map<string, Binding> {
  const bindings = new Map<string, Binding>();
  bindings.set('self', { ref: selfName });
  const raw = payload.text ?? payload.value ?? figure.value(target === 'figure' ? selfName : target);
  const lit = valueLiteralExpr(raw);
  if (lit) bindings.set('value', { literal: lit });
  else bindings.set('value', { ref: target === 'figure' ? selfName : target });
  bindings.set('event', { literal: { k: 'str', parts: [event], s: 0, e: 0 } });
  void figure;
  return bindings;
}

function isConstNode(t: TNode): boolean {
  switch (t.n) {
    case 'num':
    case 'bool':
    case 'const':
    case 'undef':
      return true;
    case 'text':
      return t.parts.every((p) => typeof p === 'string');
    default:
      return false;
  }
}

interface Expansion {
  /** The object the handler is on (named in a limit error). */
  readonly target: string;
  lines: ExpandedLine[];
  /** Ranges set by earlier steps of this run (a later step edits the range its predecessor made). */
  readonly ranges: Map<ObjId, { min: number; max: number; step: number | 'auto' }>;
  results: StepResult[];
  overlay: Map<ObjId, unknown>;
  stepsUsed: number;
  discarded: string[];
  aborted?: ErrorObject;
}

function checkExprProbe(
  figure: Figure,
  text: string,
  bindings: ReadonlyMap<string, Binding>,
): { checked: import('../../language/check').CheckedLine } | { error: ErrorObject } {
  const name = expansionProbeName(figure);
  const parsed = parseLine(`${name} = ${text}`, { line: 1 });
  if (!parsed.ok) return { error: parsed };
  const substituted = printLineNode(substituteLine(parsed.value.node, bindings));
  const probe = checkProbeLine(figure, substituted, {});
  if ('error' in probe) return { error: probe.error };
  return { checked: probe.checked };
}

function expandSteps(
  figure: Figure,
  steps: readonly StoredStep[],
  bindings: ReadonlyMap<string, Binding>,
  selfName: string,
  clickDepth: number,
  ex: Expansion,
): void {
  steps.forEach((stored, index) => {
    if (ex.aborted) return;
    const stepNo = index + 1;
    if (stored.loop) {
      const from = checkExprProbe(figure, stored.loop.from, bindings);
      const to = checkExprProbe(figure, stored.loop.to, bindings);
      const fromOk = 'checked' in from && from.checked.expr?.ty.k === 'Number';
      const toOk = 'checked' in to && to.checked.expr?.ty.k === 'Number';
      if (!fromOk || !toOk) {
        ex.results.push({ step: stepNo, status: 'skipped', reason: 'loop_range' });
        ex.stepsUsed += 1;
        return;
      }
      const fromNode = (from as { checked: { expr?: TNode } }).checked.expr as TNode;
      const toNode = (to as { checked: { expr?: TNode } }).checked.expr as TNode;
      const a = evalTNode(figure, fromNode, { overlay: ex.overlay });
      const b = evalTNode(figure, toNode, { overlay: ex.overlay });
      const ai = a.defined && typeof a.value === 'number' ? a.value : NaN;
      const bi = b.defined && typeof b.value === 'number' ? b.value : NaN;
      const count = Number.isInteger(ai) && Number.isInteger(bi) ? bi - ai + 1 : 0;
      if (!Number.isInteger(ai) || !Number.isInteger(bi) || count < 1 || count > NUMBERS_LIMITS.loopIterations) {
        ex.results.push({ step: stepNo, status: 'skipped', reason: 'loop_range' });
        ex.stepsUsed += 1;
        return;
      }
      for (let i = ai; i <= bi; i++) {
        if (ex.aborted) return;
        const inner = new Map(bindings);
        inner.set(stored.loop.variable, { literal: numLiteral(i) });
        expandOnce(figure, stored, stepNo, inner, selfName, clickDepth, ex);
      }
      return;
    }
    expandOnce(figure, stored, stepNo, bindings, selfName, clickDepth, ex);
  });
}

function expandOnce(
  figure: Figure,
  stored: StoredStep,
  stepNo: number,
  bindings: ReadonlyMap<string, Binding>,
  selfName: string,
  clickDepth: number,
  ex: Expansion,
): void {
  void selfName;
  const skip = (reason: SkipReason): void => {
    ex.results.push({ step: stepNo, status: 'skipped', reason });
    ex.stepsUsed += 1;
    if (ex.stepsUsed > NUMBERS_LIMITS.stepsPerRun) abortSteps(figure, ex);
  };
  if (stored.guard !== undefined) {
    const probe = checkExprProbe(figure, stored.guard, bindings);
    if (!('checked' in probe) || probe.checked.expr?.ty.k !== 'Bool') {
      skip('broken');
      return;
    }
    const v = evalTNode(figure, probe.checked.expr as TNode, { overlay: ex.overlay });
    if (!v.defined || v.value !== true) {
      skip('guard_false');
      return;
    }
  }
  const rangeStep = parseRangeRestyle(stored.source);
  if (rangeStep) {
    expandRangeStep(figure, rangeStep, stepNo, bindings, ex, skip);
    return;
  }
  const parsed = parseLine(stored.source, { line: 1 });
  if (!parsed.ok) {
    skip('broken');
    return;
  }
  const node = parsed.value.node;
  if (node.k !== 'action' && node.k !== 'restyle') {
    skip('broken');
    return;
  }
  // A restyle target of `self` resolves to the raising object.
  if (node.k === 'restyle' && bindings.has(node.target.name)) {
    const b = bindings.get(node.target.name) as Binding;
    if (!('ref' in b)) {
      skip('broken');
      return;
    }
    const renamed = { ...node, target: { ...node.target, name: b.ref } };
    expandRestyle(figure, renamed, stored, stepNo, bindings, ex, skip);
    return;
  }
  if (node.k === 'restyle') {
    expandRestyle(figure, node, stored, stepNo, bindings, ex, skip);
    return;
  }
  const callee = node.expr.callee;
  const substituted = printLineNode(substituteLine(node, bindings));
  const probe = checkProbeLine(figure, substituted, {});
  if ('error' in probe) {
    skip('broken');
    return;
  }
  const checked = probe.checked;
  if (callee === 'Click') {
    const arg = checked.expr?.n === 'command' ? checked.expr.args[0]?.expr : undefined;
    const clickedId = arg?.n === 'ref' ? arg.id : undefined;
    const clickedName = clickedId !== undefined ? figure.view.byId(clickedId)?.name : undefined;
    if (clickedName === undefined) {
      skip('broken');
      return;
    }
    if (clickDepth + 1 > NUMBERS_LIMITS.clickDepth) {
      abortDepth(figure, ex);
      return;
    }
    const nested = getStoredHandler(figure, clickedName, 'click');
    ex.stepsUsed += 1;
    if (ex.stepsUsed > NUMBERS_LIMITS.stepsPerRun) {
      abortSteps(figure, ex);
      return;
    }
    if (!nested) {
      ex.results.push({ step: stepNo, status: 'done' });
      return;
    }
    const nestedBindings = new Map<string, Binding>();
    nestedBindings.set('self', { ref: clickedName });
    const cv = figure.value(clickedName);
    const lit = valueLiteralExpr(cv);
    if (lit) nestedBindings.set('value', { literal: lit });
    else nestedBindings.set('value', { ref: clickedName });
    nestedBindings.set('event', { literal: { k: 'str', parts: ['click'], s: 0, e: 0 } });
    const before = ex.results.length;
    expandSteps(figure, nested.steps, nestedBindings, clickedName, clickDepth + 1, ex);
    // Nested results belong to the Click step that raised them.
    for (let i = before; i < ex.results.length; i++) {
      const r = ex.results[i] as StepResult;
      ex.results[i] = r.status === 'done' ? { ...r, step: stepNo } : { ...r, step: stepNo };
    }
    if (!ex.aborted) ex.results.push({ step: stepNo, status: 'done' });
    return;
  }
  // Pre-evaluate value arguments against the overlay: an undefined argument skips now.
  if (callee === 'SetValue' || callee === 'Toggle' || callee === 'Animate') {
    const args = checked.expr?.n === 'command' ? checked.expr.args : [];
    const from = callee === 'SetValue' ? 1 : 0;
    for (let i = from; i < args.length; i++) {
      const expr = args[i]?.expr;
      if (!expr || args[i]?.omitted) continue;
      const v = evalTNode(figure, expr, { overlay: ex.overlay });
      if (!v.defined) {
        skip('undefined_argument');
        return;
      }
    }
  }
  const wrote: ObjId[] = [];
  if (callee === 'SetValue' && checked.expr?.n === 'command') {
    const cmd = checked.expr;
    const targetArg = cmd.args[0]?.expr;
    const noteWrite = (id: ObjId, label?: string): void => {
      wrote.push(id);
      const info = figure.view.byId(id);
      const shown = label ?? info?.name;
      if (shown !== undefined && !ex.discarded.includes(shown)) ex.discarded.push(shown);
    };
    // A list element: SetValue(L[k], v) or SetValue(L, k, v). The overlay holds the list with the element replaced.
    const listId = targetArg?.n === 'index' && targetArg.target.n === 'ref' ? targetArg.target.id : cmd.args.length > 2 && targetArg?.n === 'ref' ? targetArg.id : undefined;
    if (listId !== undefined) {
      const indexExpr = targetArg?.n === 'index' ? targetArg.index : cmd.args[1]?.expr;
      const valueExpr = targetArg?.n === 'index' ? cmd.args[1]?.expr : cmd.args[2]?.expr;
      const iv = indexExpr ? evalTNode(figure, indexExpr, { overlay: ex.overlay }) : undefined;
      const vv = valueExpr ? evalTNode(figure, valueExpr, { overlay: ex.overlay }) : undefined;
      if (iv?.defined && vv?.defined && typeof iv.value === 'number') {
        const cur = ex.overlay.has(listId) ? ex.overlay.get(listId) : figure.value(listId);
        const size = cur instanceof Float64Array ? cur.length : Array.isArray(cur) ? cur.length : 0;
        if (Number.isInteger(iv.value) && iv.value >= 1 && iv.value <= size) {
          const copy = cur instanceof Float64Array ? Float64Array.from(cur) : [...(cur as unknown[])];
          (copy as unknown as Record<number, unknown>)[iv.value - 1] = vv.value;
          ex.overlay.set(listId, copy);
        }
        noteWrite(listId, `${figure.view.byId(listId)?.name ?? '?'}[${iv.value}]`);
      } else noteWrite(listId);
    } else if (targetArg?.n === 'ref' && cmd.args[1]?.expr && !cmd.args[1]?.omitted) {
      const info = figure.view.byId(targetArg.id);
      const choiceLike = info?.type.k === 'Choice' || info?.type.k === 'Input';
      const v = evalTNode(figure, cmd.args[1].expr, { overlay: ex.overlay });
      if (info?.type.k === 'Choice' && v.defined && typeof v.value === 'number') {
        const choice = (ex.overlay.has(targetArg.id) ? undefined : figure.value(targetArg.id)) as { count?: number } | undefined;
        const count = typeof choice?.count === 'number' ? choice.count : undefined;
        if (count !== undefined && (!Number.isInteger(v.value) || v.value < 1 || v.value > count)) {
          skip('out_of_range');
          return;
        }
      }
      // a dropdown or an input box keeps its own value; only plain objects go in the overlay
      if (v.defined && !choiceLike) ex.overlay.set(targetArg.id, v.value);
      noteWrite(targetArg.id);
    }
  } else if (callee === 'Toggle' && checked.expr?.n === 'command') {
    const targetArg = checked.expr.args[0]?.expr;
    if (targetArg?.n === 'ref') {
      const cur = ex.overlay.has(targetArg.id) ? ex.overlay.get(targetArg.id) : figure.value(targetArg.id);
      if (typeof cur === 'boolean') ex.overlay.set(targetArg.id, !cur);
      wrote.push(targetArg.id);
      const info = figure.view.byId(targetArg.id);
      if (info && !ex.discarded.includes(info.name)) ex.discarded.push(info.name);
    }
  } else if (callee === 'Reset' && checked.expr?.n === 'command') {
    for (const a of checked.expr.args) {
      if (a.expr?.n === 'ref') {
        const initial = initialOf(figure, a.expr.id);
        if (initial.found) ex.overlay.set(a.expr.id, initial.value);
        wrote.push(a.expr.id);
        const info = figure.view.byId(a.expr.id);
        if (info && !ex.discarded.includes(info.name)) ex.discarded.push(info.name);
      }
    }
    if (checked.expr.args.length === 0) {
      for (const o of figure.objects()) {
        if (!o.free) continue;
        const initial = initialOf(figure, o.id);
        if (initial.found) ex.overlay.set(o.id, initial.value);
        wrote.push(o.id);
      }
      ex.discarded.push('all free objects');
    }
  }
  ex.lines.push({ text: substituted, stepNo, ours: OUR_ACTIONS.has(callee), wrote });
  ex.results.push({ step: stepNo, status: 'done' });
  ex.stepsUsed += 1;
  if (ex.stepsUsed > NUMBERS_LIMITS.stepsPerRun) abortSteps(figure, ex);
}

/** `a with min = 0, max = 20, step = auto` as a step: one `rerange` line with the new bounds (numbers-sliders 3.2). */
function expandRangeStep(
  figure: Figure,
  rr: RangeRestyle,
  stepNo: number,
  bindings: ReadonlyMap<string, Binding>,
  ex: Expansion,
  skip: (reason: SkipReason) => void,
): void {
  const named = bindings.get(rr.target);
  const name = named && 'ref' in named ? named.ref : rr.target;
  const view = figure.get(name);
  if (!view || view.type !== 'Number' || !view.free) {
    skip('broken');
    return;
  }
  const current = ex.ranges.get(view.id) ?? (view.range ? { min: view.range.min, max: view.range.max, step: view.range.step ?? ('auto' as const) } : undefined);
  const next = { min: current?.min, max: current?.max, step: current?.step ?? ('auto' as number | 'auto') };
  for (const item of rr.items) {
    if (item.value === 'auto' && item.key === 'step') {
      next.step = 'auto';
      continue;
    }
    const probe = checkExprProbe(figure, item.value, bindings);
    if (!('checked' in probe) || probe.checked.expr?.ty.k !== 'Number') {
      skip('broken');
      return;
    }
    const v = evalTNode(figure, probe.checked.expr as TNode, { overlay: ex.overlay });
    if (!v.defined || typeof v.value !== 'number') {
      skip('undefined_argument');
      return;
    }
    if (item.key === 'min') next.min = v.value;
    else if (item.key === 'max') next.max = v.value;
    else next.step = v.value;
  }
  if (next.min === undefined || next.max === undefined) {
    // a number with no range needs both ends
    skip('broken');
    return;
  }
  const range = { min: next.min, max: next.max, step: next.step };
  ex.ranges.set(view.id, range);
  ex.lines.push({ text: rangeLine(view.name, range.min, range.max, range.step), stepNo, ours: false, wrote: [view.id] });
  if (!ex.discarded.includes(view.name)) ex.discarded.push(view.name);
  ex.results.push({ step: stepNo, status: 'done' });
  ex.stepsUsed += 1;
  if (ex.stepsUsed > NUMBERS_LIMITS.stepsPerRun) abortSteps(figure, ex);
}

function expandRestyle(
  figure: Figure,
  node: Extract<import('../../language/ast').LineNode, { k: 'restyle' }>,
  _stored: StoredStep,
  stepNo: number,
  bindings: ReadonlyMap<string, Binding>,
  ex: Expansion,
  skip: (reason: SkipReason) => void,
): void {
  void _stored;
  const substitutedNode = substituteLine(node, bindings);
  const substituted = printLineNode(substitutedNode);
  const probe = checkProbeLine(figure, substituted, {});
  if ('error' in probe) {
    skip('broken');
    return;
  }
  // Freeze dynamic values: a handler restyle evaluates once, it never adds a rule.
  const checked = probe.checked;
  const items = substitutedNode.k === 'restyle' ? substitutedNode.style : [];
  const frozen: string[] = [];
  const styles = checked.style ?? [];
  for (let i = 0; i < styles.length; i++) {
    const s = styles[i] as { key: string; value: TNode | { word: string } };
    const item = items[i];
    if (!item) continue;
    if ('word' in s.value) {
      frozen.push(`${s.key} = ${s.value.word}`);
      continue;
    }
    if (isConstNode(s.value)) {
      frozen.push(`${s.key} = ${printExpr(item.value)}`);
      continue;
    }
    const v = evalTNode(figure, s.value, { overlay: ex.overlay });
    if (!v.defined) {
      skip('undefined_argument');
      return;
    }
    const lit = valueLiteralText(v.value);
    if (lit === undefined) {
      skip('broken');
      return;
    }
    frozen.push(`${s.key} = ${lit}`);
  }
  const target = substitutedNode.k === 'restyle' ? substitutedNode.target.name : node.target.name;
  ex.lines.push({ text: `${target} with ${frozen.join(', ')}`, stepNo, ours: false, wrote: [] });
  ex.results.push({ step: stepNo, status: 'done' });
  ex.stepsUsed += 1;
  if (ex.stepsUsed > NUMBERS_LIMITS.stepsPerRun) abortSteps(figure, ex);
}

function abortSteps(figure: Figure, ex: Expansion): void {
  void figure;
  if (ex.aborted) return;
  const discarded = ex.discarded.slice(0, 10);
  if (ex.discarded.length > 10) discarded.push('...');
  ex.aborted = numbersError('handler_limit', { line: 0, col: 1, endCol: 1 }, { name: ex.target, limit: NUMBERS_LIMITS.stepsPerRun, actual: ex.stepsUsed, what: 'steps', discarded }, {
    token: ex.target,
    hint: 'Reduce the loop range, or split the work across buttons.',
  });
}

function abortDepth(figure: Figure, ex: Expansion): void {
  void figure;
  if (ex.aborted) return;
  const discarded = ex.discarded.slice(0, 10);
  if (ex.discarded.length > 10) discarded.push('...');
  ex.aborted = numbersError('handler_limit', { line: 0, col: 1, endCol: 1 }, { name: ex.target, limit: NUMBERS_LIMITS.clickDepth, actual: NUMBERS_LIMITS.clickDepth + 1, what: 'Click nesting', discarded }, {
    token: ex.target,
    hint: 'Remove a Click: handlers press each other at most 8 deep.',
  });
}

/**
 * Run a handler: expand against the overlay, then commit one atomic batch.
 * Nothing is applied when the handler is missing, every step is skipped, or a
 * limit aborts the run.
 */
export function runHandler(
  figure: Figure,
  target: string,
  event: HandlerEvent,
  payload: RunPayload = {},
  trigger: RunTrigger = 'host',
): HandlerRun {
  const by = payload.by ?? 'host';
  const empty: HandlerRun = { handler: { target, event }, trigger, ok: true, stepsUsed: 0, results: [], dropped: 0 };
  const stored = getStoredHandler(figure, target, event);
  if (!stored) return empty;
  if (target === 'figure' && event === 'change' && !payload.changedName) {
    return {
      handler: { target, event },
      trigger,
      ok: false,
      stepsUsed: 0,
      results: [],
      error: numbersError('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'on figure change', why: 'the changed object is not named' }, { token: target }),
      dropped: 0,
    };
  }
  ensureResetTracking(figure);
  const selfName = target === 'figure' ? (payload.changedName as string) : target;
  const bindings = runtimeBindings(figure, target, event, payload, selfName);
  const ex: Expansion = { target, ranges: new Map(), lines: [], results: [], overlay: new Map(), stepsUsed: 0, discarded: [] };
  expandSteps(figure, stored.steps, bindings, selfName, 0, ex);
  if (ex.aborted) {
    const run: HandlerRun = { handler: { target, event }, trigger, ok: false, stepsUsed: ex.stepsUsed, results: ex.results, error: ex.aborted, dropped: 0 };
    recordRun(figure, run);
    emitControlEvent(figure, { event: trigger === 'click_call' ? 'click' : event, name: target, type: 'Handler', by });
    emitControlEvent(figure, { event: 'handlerRun', name: `${target} ${event}`, type: 'Handler', value: `aborted after ${ex.stepsUsed} steps`, by });
    return run;
  }
  if (ex.lines.length === 0) {
    const run: HandlerRun = { handler: { target, event }, trigger, ok: true, stepsUsed: ex.stepsUsed, results: ex.results, dropped: 0 };
    recordRun(figure, run);
    return run;
  }
  const from = new Map<ObjId, string>();
  for (const l of ex.lines) for (const id of l.wrote) {
    if (!from.has(id)) from.set(id, valueText(figure.value(id)));
  }
  drainActionOutcomes(figure);
  const batch = figure.applyBatch(
    ex.lines.map((l) => l.text),
    { group: `${event} ${target}`, mode: 'atomic' },
  );
  if (!batch.ok) {
    const first = batch.results.find((r) => !r.ok) as ErrorObject | undefined;
    const run: HandlerRun = {
      handler: { target, event },
      trigger,
      ok: false,
      stepsUsed: ex.stepsUsed,
      results: ex.results,
      ...(first ? { error: first } : {}),
      dropped: 0,
    };
    recordRun(figure, run);
    emitControlEvent(figure, { event: 'handlerRun', name: `${target} ${event}`, type: 'Handler', value: 'aborted; nothing was changed', by });
    return run;
  }
  // Zip action outcomes onto our steps: a residual skip/error flips the record.
  const outcomesList = drainActionOutcomes(figure);
  const finalResults: StepResult[] = [];
  const oursLines = ex.lines.filter((l) => l.ours);
  const outcomeByStep = new Map<number, ActionOutcomeRecord>();
  oursLines.forEach((l, i) => {
    const o = outcomesList[i];
    if (o) outcomeByStep.set(l.stepNo, o);
  });
  for (const r of ex.results) {
    if (r.status !== 'done') {
      finalResults.push(r);
      continue;
    }
    const o = outcomeByStep.get(r.step);
    if (o && o.status === 'skipped') {
      finalResults.push({ step: r.step, status: 'skipped', reason: o.reason });
      continue;
    }
    if (o && o.status === 'error') {
      finalResults.push({ step: r.step, status: 'skipped', reason: 'broken' });
      continue;
    }
    const wrote = ex.lines.filter((l) => l.stepNo === r.step).flatMap((l) => l.wrote);
    if (wrote.length === 0) {
      finalResults.push(r);
      continue;
    }
    finalResults.push({
      step: r.step,
      status: 'done',
      wrote: wrote.map((id) => {
        const info = figure.view.byId(id);
        return { name: info?.name ?? String(id), from: from.get(id) ?? '?', to: valueText(figure.value(id)) };
      }),
    });
  }
  const run: HandlerRun = { handler: { target, event }, trigger, ok: true, stepsUsed: ex.stepsUsed, results: finalResults, dropped: 0 };
  recordRun(figure, run);
  emitControlEvent(figure, { event, name: target, type: figure.get(target)?.type ?? 'figure', ...(payload.value !== undefined ? { value: valueText(payload.value) } : {}), by });
  for (const l of ex.lines) {
    for (const id of l.wrote) {
      const ev = changeEventOf(figure, id, by);
      if (ev) emitControlEvent(figure, ev);
    }
  }
  emitControlEvent(figure, {
    event: 'handlerRun',
    name: `${target} ${event}`,
    type: 'Handler',
    value: `${ex.stepsUsed} steps`,
    by,
  });
  return run;
}

/**
 * A learner changed `name`: run the `change` handler of the object (with its new value), then `on figure change`
 * (with the object as `self`). The writes these runs make raise no further handler.
 */
export function runChangeHandlers(figure: Figure, name: string, value: unknown): void {
  runHandler(figure, name, 'change', { value, by: 'learner' }, 'learner');
  runHandler(figure, 'figure', 'change', { changedName: name, by: 'learner' }, 'learner');
}

/** Run `on figure load` once, unless the host passes autorun: false. */
export function runLoadHandlers(figure: Figure, opts: { autorun?: boolean; by?: 'learner' | 'host' } = {}): HandlerRun | undefined {
  if (opts.autorun === false) return undefined;
  if (!getStoredHandler(figure, 'figure', 'load')) return undefined;
  return runHandler(figure, 'figure', 'load', { by: opts.by ?? 'host' }, 'host');
}

/** Press a button (or clickable object) by code. */
export function clickButton(figure: Figure, name: string, opts: { by?: 'learner' | 'host'; trigger?: RunTrigger } = {}): Result<HandlerRun> {
  const view = figure.get(name);
  if (!view) {
    return numbersError('unknown_name', { line: 0, col: 1, endCol: 1 }, { name }, { token: name, hint: 'Create the button first.' });
  }
  const clickable = view.type === 'Button' || (view.style.ext as Record<string, unknown>)['clickable'] === true;
  if (!clickable) {
    return numbersError('bad_event', { line: 0, col: 1, endCol: 1 }, { name, what: `a ${view.type}`, event: 'click' }, {
      token: name,
      hint: `Make it clickable first: ${name} with clickable = true. Or press a button.`,
    });
  }
  const by = opts.by ?? 'host';
  // A press with no handler still tells the host (3.6); with a handler the run emits the event itself.
  if (!getStoredHandler(figure, name, 'click')) emitControlEvent(figure, { event: 'click', name, type: view.type, by });
  return { ok: true, value: runHandler(figure, name, 'click', { by }, opts.trigger ?? by), notices: [] };
}
