/**
 * Handlers: the `on` line kind, handler storage and runs
 * (controls-scripting/design.md 3.3, 3.4).
 *
 * The kernel parser has no `on` line kind, so this module parses `on` lines
 * itself and stores handlers beside the figure (keyed weakly by Figure, so they
 * die with it). A run expands guards, loops and Click steps against a staging
 * overlay, then commits everything with one applyBatch: one transaction, one
 * update pass, one undo entry. Scripts change values and appearance only; they
 * never create objects, read the clock, or run JavaScript.
 */

import type { ErrorObject, Notice } from '../../contracts/errors';
import type { ObjId } from '../../contracts/values';
import type { Figure } from '../../graph/figure';
import { BUILTIN_FUNCTIONS } from '../../language/builtins';
import { closestNames } from '../../language/errors';
import { reservedGroup } from '../../language/names';
import { splitLogicalLines } from '../../language/source';
import type { HandlerEvent, HandlerRun } from './types';
import { NUMBERS_LIMITS } from './types';
import { numbersError, numbersNotice } from './errors';
import { checkProbeLine, printLineNode, substituteLine, valueLiteralExpr } from './eval';
import { parseRangeRestyle } from './rangestep';
import type { RangeRestyle } from './rangestep';
import type { Binding } from './eval';
import { parseLine } from '../../language/parser';
import type { TNode } from '../../language/tnode';

const EVENTS: readonly HandlerEvent[] = ['click', 'change', 'input', 'dragend', 'load'];

/** Steps may call these actions (3.3). The last seven belong to later areas. */
const STEP_ACTIONS: ReadonlySet<string> = new Set([
  'SetValue', 'Toggle', 'Animate', 'Show', 'Hide', 'Reset', 'Click',
  'Highlight', 'Trace', 'Untrace', 'Play', 'Pause', 'View', 'Axes', 'Grid',
]);
const FUTURE_ACTIONS: ReadonlySet<string> = new Set(['Highlight', 'Trace', 'Untrace', 'Play', 'Pause', 'View', 'Axes', 'Grid']);
/** Restyle keys that would create a rule; formulas for them are rejected in steps. */
const GRAPH_KEYS: ReadonlySet<string> = new Set(['showIf', 'min', 'max', 'step']);

/* ------------------------------ control events ------------------------------ */

export type ControlListener = (e: import('./types').ControlEvent) => void;

interface FigureHandlers {
  readonly handlers: Map<string, StoredHandler>;
  readonly runs: HandlerRun[];
  readonly listeners: Set<ControlListener>;
  /** Names of the objects at the last sync, by id: a rename (or its undo) is a difference against this. */
  readonly names: Map<ObjId, string>;
  /** Handlers of deleted targets, by the id the target had: an undo that brings the object back restores them. */
  readonly parked: Map<ObjId, StoredHandler[]>;
}

export interface StoredStep {
  readonly source: string;
  readonly guard?: string;
  readonly loop?: { readonly variable: string; readonly from: string; readonly to: string };
}

export interface StoredHandler {
  readonly target: string;
  readonly event: HandlerEvent;
  readonly steps: StoredStep[];
}

const stores = new WeakMap<Figure, FigureHandlers>();

function handlersFor(figure: Figure): FigureHandlers {
  let s = stores.get(figure);
  if (!s) {
    const fresh: FigureHandlers = { handlers: new Map(), runs: [], listeners: new Set(), names: new Map(), parked: new Map() };
    s = fresh;
    stores.set(figure, fresh);
    for (const o of figure.objects()) fresh.names.set(o.id, o.name);
    figure.on((ev) => followFigure(figure, fresh, ev));
  }
  return s;
}

/**
 * Keeps handlers with their objects (controls-scripting 3.7): a rename rewrites the steps that name the object,
 * deleting a target takes its handlers (an undo of the delete brings them back), and an undo or redo of a rename
 * rewrites the steps again. The kernel tells the area only through its events, so the area reads names from the figure.
 */
function followFigure(figure: Figure, s: FigureHandlers, ev: import('../../graph/types').FigureEvent): void {
  switch (ev.ev) {
    case 'add': {
      const o = figure.get(ev.id);
      if (!o) return;
      s.names.set(o.id, o.name);
      const back = s.parked.get(o.id);
      if (back) {
        s.parked.delete(o.id);
        for (const h of back) s.handlers.set(handlerKey(o.name, h.event), { target: o.name, event: h.event, steps: h.steps });
      }
      return;
    }
    case 'remove': {
      s.names.delete(ev.id);
      const gone: StoredHandler[] = [];
      for (const [key, h] of [...s.handlers]) {
        if (h.target !== ev.name) continue;
        gone.push(h);
        s.handlers.delete(key);
      }
      if (gone.length > 0) s.parked.set(ev.id, gone);
      return;
    }
    case 'rename':
    case 'undo':
    case 'redo': {
      const moved: [string, string][] = [];
      for (const o of figure.objects()) {
        const was = s.names.get(o.id);
        if (was !== undefined && was !== o.name) moved.push([was, o.name]);
        s.names.set(o.id, o.name);
      }
      for (const [from, to] of moved) renameInSteps(s, from, to);
      return;
    }
    default:
      return;
  }
}

const NAME_CHARS = 'A-Za-z0-9_\\u0370-\\u03FF';

function nameRe(name: string): RegExp {
  return new RegExp(`(?<![${NAME_CHARS}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![${NAME_CHARS}])`, 'g');
}

const TEXT_LITERAL = /("(?:[^"\\]|\\.)*")/;

/** Replaces a name in step text, leaving the inside of text literals alone. */
function replaceName(text: string, re: RegExp, to: string): string {
  return text
    .split(TEXT_LITERAL)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(re, () => to)))
    .join('');
}

function renameInSteps(store: FigureHandlers, from: string, to: string): number {
  const re = nameRe(from);
  let rewritten = 0;
  for (const [key, h] of [...store.handlers]) {
    let changed = false;
    const steps = h.steps.map((s) => {
      const source = replaceName(s.source, re, to);
      const guard = s.guard === undefined ? undefined : replaceName(s.guard, re, to);
      const loop = s.loop ? { variable: s.loop.variable, from: replaceName(s.loop.from, re, to), to: replaceName(s.loop.to, re, to) } : undefined;
      if (source !== s.source || guard !== s.guard || loop?.from !== s.loop?.from || loop?.to !== s.loop?.to) changed = true;
      return { source, ...(guard !== undefined ? { guard } : {}), ...(loop ? { loop } : {}) };
    });
    const target = h.target === from ? to : h.target;
    if (target !== h.target) changed = true;
    if (changed) {
      rewritten++;
      store.handlers.delete(key);
      store.handlers.set(handlerKey(target, h.event), { target, event: h.event, steps });
    }
  }
  return rewritten;
}

const handlerKey = (target: string, event: string): string => `${target}\n${event}`;

/** Subscribe to control events (click, change, input, dragend, handlerRun). */
export function onControlEvent(figure: Figure, listener: ControlListener): () => void {
  const s = handlersFor(figure);
  s.listeners.add(listener);
  return () => {
    s.listeners.delete(listener);
  };
}

/** Emit a control event to host listeners. Never throws (a bad listener is dropped). */
export function emitControlEvent(figure: Figure, event: import('./types').ControlEvent): void {
  const s = handlersFor(figure);
  for (const l of [...s.listeners]) {
    try {
      l(event);
    } catch {
      s.listeners.delete(l);
    }
  }
}

/* ------------------------------ the `on` line ------------------------------ */

export interface ParsedHandler {
  readonly target: string;
  readonly event: HandlerEvent;
  readonly stepIndex?: number;
  readonly loop?: { readonly variable: string; readonly from: string; readonly to: string };
  readonly guard?: string;
  readonly step: string;
  /** 1-based column where the step starts in the submitted line. */
  readonly stepCol: number;
}

function splitTopLevel(text: string, sep: string): [string, string] | undefined {
  let depth = 0;
  let inString = false;
  for (let i = 0; i + sep.length <= text.length; i++) {
    const c = text[i] as string;
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    else if (c === '{' || c === '}') depth = Math.max(0, depth + (c === '{' ? 1 : -1));
    if (depth === 0 && text.startsWith(sep, i)) return [text.slice(0, i), text.slice(i + sep.length)];
  }
  return undefined;
}

/**
 * Parse an `on` line (3.3 grammar). Returns the parts or a syntax/unknown_event error.
 * Columns are 1-based into the submitted line.
 */
export function parseHandlerLine(source: string, line = 1): ParsedHandler | ErrorObject {
  const at = (col: number, endCol: number): { line: number; col: number; endCol: number } => ({ line, col, endCol });
  const fail = (col: number, endCol: number, token: string, expected: string, hint: string): ErrorObject =>
    numbersError('syntax', at(col, endCol), { token, expected }, { token, expected: [expected], forms: ['on <target> <event> [#n] [for k in a..b] [if cond]: <step>'], hint, suggest: ['on go click: SetValue(a, 0)'] });
  const text = source.trim();
  if (!text.startsWith('on ') && !text.startsWith('on\t')) {
    return fail(1, Math.min(3, text.length + 1), text.slice(0, 2), 'on', 'A handler line starts with on, for example: on go click: SetValue(a, 0)');
  }
  const colon = splitTopLevel(text, ':');
  if (!colon) {
    return fail(text.length + 1, text.length + 1, '', ':', "Write the step after a ':', for example: on go click: SetValue(a, 0)");
  }
  const [head, stepRaw] = [colon[0], colon[1]];
  const step = stepRaw.trim();
  const stepCol = head.length + 2 + (stepRaw.length - stepRaw.trimStart().length);
  if (step === '') return fail(head.length + 2, head.length + 2, '', 'step', 'Write one step after the colon, for example: SetValue(a, 0)');
  const words = head.trim().split(/\s+/);
  if (words.length < 3) {
    return fail(head.length + 1, head.length + 1, '', 'event', 'Name the target and the event: on go click: ...');
  }
  const target = words[1] as string;
  const eventWord = words[2] as string;
  if (!(EVENTS as readonly string[]).includes(eventWord)) {
    const col = head.indexOf(eventWord, head.indexOf(target) + target.length) + 1;
    const close = closestNames(eventWord, EVENTS, 1);
    return numbersError('unknown_event', at(col, col + eventWord.length), { event: eventWord }, {
      token: eventWord,
      expected: [...EVENTS],
      hint: close.length > 0 ? `Did you mean ${close[0]}? Events: click, change, input, dragend, load.` : 'Events: click, change, input, dragend, load.',
      suggest: close.length > 0 ? [`on ${target} ${close[0]}: ${step}`] : [`on ${target} click: ${step}`],
    });
  }
  const event = eventWord as HandlerEvent;
  // The rest of the head in grammar order: [#n] [for k in a..b] [if cond].
  let rest = words.slice(3);
  let stepIndex: number | undefined;
  if (rest.length > 0 && (rest[0] as string).startsWith('#')) {
    const raw = (rest[0] as string).slice(1);
    if (!/^\d+$/.test(raw)) {
      const col = head.lastIndexOf(rest[0] as string) + 1;
      return fail(col, col + (rest[0] as string).length, rest[0] as string, '#n', 'Write the step number after #, for example: on go click #2: SetValue(a, 1)');
    }
    stepIndex = Number(raw);
    rest = rest.slice(1);
  }
  let loop: ParsedHandler['loop'];
  if (rest.length > 0 && rest[0] === 'for') {
    const forText = head.slice(head.indexOf('for'));
    const inSplit = splitTopLevel(forText, ' in ');
    const inSplitTab = inSplit ?? splitTopLevel(forText, ' in\t');
    const parts = inSplit ?? inSplitTab;
    if (!parts) {
      const col = head.indexOf('for') + 1;
      return fail(col, head.length + 1, forText, 'for k in a..b', 'Write a loop as: for k in 1..5');
    }
    const varPart = parts[0].slice(3).trim();
    if (!/^[A-Za-z\u0370-\u03FF][A-Za-z0-9_\u0370-\u03FF]*$/.test(varPart)) {
      const col = head.indexOf('for') + 1;
      return fail(col, col + 3, varPart, 'name', 'The loop variable is a plain name, for example: for k in 1..5');
    }
    let boundsText = parts[1].trim();
    // A guard follows the bounds: cut at a top-level ` if `.
    let guardAfter: string | undefined;
    const ifSplit = splitTopLevel(` ${boundsText} `, ' if ');
    if (ifSplit) {
      boundsText = ifSplit[0].trim();
      guardAfter = ifSplit[1].trim();
    }
    const bounds = splitTopLevel(boundsText, '..');
    if (!bounds || bounds[0].trim() === '' || bounds[1].trim() === '') {
      const col = head.indexOf('for') + 1;
      return fail(col, head.length + 1, boundsText, 'a..b', 'Write the loop range as: for k in 1..5');
    }
    loop = { variable: varPart, from: bounds[0].trim(), to: bounds[1].trim() };
    rest = guardAfter !== undefined ? ['if', ...guardAfter.split(/\s+/)] : [];
  }
  let guard: string | undefined;
  if (rest.length > 0) {
    if (rest[0] !== 'if') {
      const col = head.lastIndexOf(rest[0] as string) + 1;
      return fail(col, col + (rest[0] as string).length, rest.join(' '), 'if cond', 'Only #n, a for loop and an if guard may stand before the colon.');
    }
    guard = rest.slice(1).join(' ').trim();
    if (guard === '' || guard.startsWith('(')) {
      const col = head.lastIndexOf('if') + 1;
      return fail(col, head.length + 1, guard, 'condition', 'Write the guard as: if a > 5');
    }
  }
  return { target, event, ...(stepIndex !== undefined ? { stepIndex } : {}), ...(loop ? { loop } : {}), ...(guard ? { guard } : {}), step, stepCol };
}

/* ------------------------------ definition checks ------------------------------ */

function freshProbeName(figure: Figure): string {
  const functions = figure.view.functions ?? BUILTIN_FUNCTIONS;
  for (let i = 1; i < 100000; i++) {
    const n = `hdlprobe${i}`;
    if (!figure.view.lookup(n) && !reservedGroup(n, figure.view.commands, functions)) return n;
  }
  return 'hdlprobe';
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

function objectNames(figure: Figure, ids: readonly ObjId[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const info = figure.view.byId(id);
    if (info) out.push(info.name);
  }
  return out;
}

/** Bindings for definition-time checks: placeholders of the right shape. */
function definitionBindings(figure: Figure, target: string, event: HandlerEvent): Map<string, Binding> {
  const bindings = new Map<string, Binding>();
  if (target === 'figure') {
    if (event === 'change') {
      const first = figure.view.names()[0];
      bindings.set('self', { ref: first ?? 'figure' });
      const v = first ? figure.value(first) : undefined;
      const lit = valueLiteralExpr(v) ?? { k: 'num', v: 0, text: '0', int: true, s: 0, e: 0 } as const;
      bindings.set('value', { literal: lit });
    } else {
      bindings.set('self', { ref: 'figure' });
      bindings.set('value', { ref: 'figure' });
    }
  } else {
    bindings.set('self', { ref: target });
    const v = figure.value(target);
    const lit = valueLiteralExpr(v) ?? ({ k: 'num', v: 0, text: '0', int: true, s: 0, e: 0 } as const);
    bindings.set('value', { literal: lit });
  }
  bindings.set('event', { literal: { k: 'str', parts: [event], s: 0, e: 0 } });
  return bindings;
}

function remap(error: ErrorObject, line: number, colOffset: number): ErrorObject {
  return { ...error, line, col: error.col + colOffset, endCol: error.endCol + colOffset };
}

/**
 * Definition-time check of a step that sets min, max or step. A constant is a valid step; a formula would make
 * the range follow other objects, which a handler may not do (`handler_graph_change`).
 */
function checkRangeStep(
  figure: Figure,
  target: string,
  event: HandlerEvent,
  rr: RangeRestyle,
  stepSource: string,
  loopVar: string | undefined,
  line: number,
  stepCol: number,
): StepCheck | ErrorObject {
  const span = { line, col: stepCol, endCol: stepCol + stepSource.length };
  const bindings = definitionBindings(figure, target, event);
  if (loopVar) bindings.set(loopVar, { literal: { k: 'num', v: 1, text: '1', int: true, s: 0, e: 0 } });
  const bound = bindings.get(rr.target);
  const name = bound && 'ref' in bound ? bound.ref : rr.target;
  const view = figure.get(name);
  if (!view) {
    return numbersError('unknown_name', span, { name: rr.target }, { token: rr.target, hint: 'Create the object first.' });
  }
  if (rr.others.length > 0) {
    return numbersError('bad_argument', span, { command: 'on', why: 'min, max and step change the range; put other properties in their own step' }, {
      token: stepSource,
      hint: `Write ${rr.target} with ${rr.items.map((i) => `${i.key} = ${i.value}`).join(', ')} as one step and the rest as another.`,
    });
  }
  if (view.type !== 'Number') {
    return numbersError('type_mismatch', span, { op: 'give a range to', left: view.type, right: 'Number' }, { token: rr.target, hint: 'Only a Number can have a range.' });
  }
  if (!view.free) {
    const deps = objectNames(figure, view.inputs);
    return numbersError('not_free', span, { name: view.name, inputs: deps.join(', ') }, { token: view.name, hint: `Set ${deps.join(', ')} instead.` });
  }
  for (const item of rr.items) {
    if (item.value === 'none' || (item.value === 'auto' && item.key !== 'step')) {
      return numbersError('bad_argument', span, { command: 'on', why: item.value === 'none' ? 'a handler cannot remove a slider range' : `${item.key} = auto is not a value; only step can be auto` }, {
        token: item.value,
        hint: item.value === 'none' ? `Remove the range on its own line: ${rr.target} with ${item.key} = none.` : `Write a number for ${item.key}.`,
      });
    }
    if (item.value === 'auto') continue;
    const parsed = parseLine(`${freshProbeName(figure)} = ${item.value}`, { line: 1 });
    if (!parsed.ok) return remap(parsed, line, stepCol - 1);
    const probe = checkProbeLine(figure, printLineNode(substituteLine(parsed.value.node, bindings)), { line: 1 });
    if ('error' in probe) return remap(probe.error, line, stepCol - 1);
    const checked = probe.checked;
    if (checked.expr?.ty.k !== 'Number') {
      return numbersError('bad_argument', span, { command: 'on', why: `${item.key} must be a Number` }, { token: item.value, hint: `Write a number, for example: ${rr.target} with ${item.key} = 5.` });
    }
    if (checked.usesT) {
      return numbersError('handler_structure', span, { what: 'read the clock', step_kind: 'clock' }, { token: stepSource, hint: 'Handlers are replay-safe: they cannot read t, bt or beat.' });
    }
    if (checked.reads.length > 0) {
      return numbersError('handler_graph_change', span, { property: item.key }, {
        token: `${item.key} = ${item.value}`,
        hint: `Put the rule in its own line: ${rr.target} with ${item.key} = .... Then use SetValue in the handler.`,
      });
    }
  }
  return { source: stepSource };
}

interface StepCheck {
  /** The checked line, with locals substituted. */
  readonly source: string;
  readonly usesClick?: string;
  readonly deferred?: boolean;
}

/**
 * Check one step's source at definition time. Returns the substituted source
 * (locals replaced by placeholders) or the error, remapped into the on-line.
 */
function checkStepSource(
  figure: Figure,
  target: string,
  event: HandlerEvent,
  stepSource: string,
  loopVar: string | undefined,
  line: number,
  stepCol: number,
): StepCheck | ErrorObject {
  // Another `on` line as a step: the kernel parser does not know the `on` line kind, so name it here.
  if (/^on\s+\S+\s+(?:click|change|input|dragend|load)\b/.test(stepSource.trim())) {
    return numbersError('handler_structure', { line, col: stepCol, endCol: stepCol + stepSource.length }, { what: 'add another handler', step_kind: 'on' }, {
      token: stepSource.trim(),
      hint: `A step is one action. Add the other handler as its own line: ${stepSource.trim()}`,
    });
  }
  // min, max and step are range edits, not kernel properties: the step is read and checked here
  const rangeStep = parseRangeRestyle(stepSource);
  if (rangeStep) return checkRangeStep(figure, target, event, rangeStep, stepSource, loopVar, line, stepCol);
  // `showIf = none` drops the condition; the figure reads it as `showIf = true` (numbers rewrite), and so does the check
  const parsed = parseLine(stepSource.replace(/(\bshowIf\s*=\s*)none\b/, '$1true'), { line: 1 });
  if (!parsed.ok) return remap(parsed, line, stepCol - 1);
  const node = parsed.value.node;
  if (node.k === 'define') {
    const isCall = node.expr.k === 'call' && /^[A-Z]/.test(node.expr.callee);
    if (isCall) {
      return numbersError('handler_structure', { line, col: stepCol, endCol: stepCol + stepSource.length }, { what: `create ${node.target.name}`, step_kind: 'define' }, {
        token: printLineNode(node),
        hint: `Create objects with draw, not in a handler. To hide ${node.target.name}, write: on ${target} ${event}: Hide(${node.target.name}).`,
      });
    }
    const suggestion = `SetValue(${node.target.name}, ${printLineNode(node).replace(/^[^=]*=\s*/, '')})`;
    return numbersError('handler_define', { line, col: stepCol, endCol: stepCol + stepSource.length }, { name: node.target.name, suggestion }, {
      token: printLineNode(node),
      hint: `Write: on ${target} ${event}: ${suggestion}`,
      suggest: [`on ${target} ${event}: ${suggestion}`],
    });
  }
  if (node.k !== 'action' && node.k !== 'restyle') {
    const what = node.k === 'function' || node.k === 'defmany' ? 'define objects' : node.k === 'rate' ? 'add a rate rule' : node.k === 'directive' ? 'use a directive' : node.k === 'rerange' ? 'change a slider range' : 'do that';
    return numbersError('handler_structure', { line, col: stepCol, endCol: stepCol + stepSource.length }, { what, step_kind: node.k }, {
      token: printLineNode(node),
      hint: 'A handler step is an action (SetValue, Toggle, Animate, Show, Hide, Reset, Click, ...) or a restyle (X with prop = value).',
    });
  }
  if (node.k === 'action') {
    const callee = node.expr.callee;
    if (!STEP_ACTIONS.has(callee)) {
      const what = callee === 'Delete' ? 'delete objects' : callee === 'Rename' ? 'rename objects' : `run ${callee}`;
      const hint = callee === 'Delete' ? `To hide it, write: on ${target} ${event}: Hide(${node.expr.args.length > 0 ? 'obj' : 'obj'}).` : 'Handlers change values and appearance. Do structural changes with draw instead.';
      return numbersError('handler_structure', { line, col: stepCol, endCol: stepCol + stepSource.length }, { what, step_kind: `action ${callee}` }, {
        token: printLineNode(node),
        hint,
      });
    }
  }
  // Substitute locals, print, and run the kernel's own check on the result.
  const bindings = definitionBindings(figure, target, event);
  if (loopVar) bindings.set(loopVar, { literal: { k: 'num', v: 1, text: '1', int: true, s: 0, e: 0 } });
  const substituted = printLineNode(substituteLine(node, bindings));
  const probe = checkProbeLine(figure, substituted, { line: 1 });
  if ('error' in probe) {
    const errObj = probe.error;
    if (errObj.kind === 'unknown_command' && node.k === 'action' && FUTURE_ACTIONS.has(node.expr.callee)) {
      return { source: substituted, deferred: true };
    }
    if (errObj.kind === 'unknown_name' && errObj.token === 'figure' && target === 'figure') {
      return remap({ ...errObj, hint: 'self and value name the object that raised the event; on figure load there is none.' }, line, stepCol - 1);
    }
    return remap(errObj, line, stepCol - 1);
  }
  const checked = probe.checked;
  if (checked.usesT || checked.styleUsesT || checked.rangeUsesT) {
    return numbersError('handler_structure', { line, col: stepCol, endCol: stepCol + stepSource.length }, { what: 'read the clock', step_kind: 'clock' }, {
      token: stepSource,
      hint: 'Handlers are replay-safe: they cannot read t, bt or beat. Use a formula of t in a normal line instead.',
    });
  }
  if (node.k === 'restyle') {
    for (const s of checked.style ?? []) {
      const value = s.value;
      const isFormula = !('word' in value) && !isConstNode(value);
      if (GRAPH_KEYS.has(s.key) && isFormula) {
        return numbersError('handler_graph_change', { line, col: stepCol, endCol: stepCol + stepSource.length }, { property: s.key }, {
          token: `${s.key} = ${stepSource}`,
          hint: `Put the rule in its own line: ${target} with ${s.key} = .... Then use SetValue in the handler.`,
        });
      }
    }
    return { source: substituted };
  }
  // Action-specific checks against the figure.
  const call = checked.expr;
  if (!call || call.n !== 'command') return { source: substituted, deferred: true };
  const callee = node.expr.callee;
  const firstRef = call.args[0]?.expr?.n === 'ref' ? call.args[0].expr.id : undefined;
  if (callee === 'SetValue') {
    // SetValue(L[k], v) names a list element: the object is the list.
    const firstExpr = call.args[0]?.expr;
    const elementOf = firstExpr?.n === 'index' && firstExpr.target.n === 'ref' ? firstExpr.target.id : undefined;
    const targetId = firstRef ?? elementOf;
    if (targetId === undefined) {
      return numbersError('bad_argument', { line, col: stepCol, endCol: stepCol + stepSource.length }, { command: 'SetValue', why: 'the target must be an object' }, {
        token: stepSource,
        hint: 'Write SetValue(obj, value) with the object first.',
      });
    }
    const info = figure.view.byId(targetId);
    // A dropdown and an input box are set by a value of their own kind, not by being free.
    if (info && (info.type.k === 'Choice' || info.type.k === 'Input')) {
      const indexArg = info.type.k === 'Choice' ? call.args[1]?.expr : undefined;
      if (indexArg?.n === 'num') {
        const choice = figure.value(targetId) as { count?: number } | undefined;
        const count = typeof choice?.count === 'number' ? choice.count : undefined;
        if (count !== undefined && (!Number.isInteger(indexArg.v) || indexArg.v < 1 || indexArg.v > count)) {
          return numbersError('bad_index', { line, col: stepCol, endCol: stepCol + stepSource.length }, { index: indexArg.v, count }, {
            token: String(indexArg.v),
            hint: `Use 1..${count}.`,
          });
        }
      }
      return { source: substituted };
    }
    if (info && info.free !== true) {
      const deps = objectNames(figure, figure.view.inputsOf(targetId));
      return numbersError('not_free', { line, col: stepCol, endCol: stepCol + stepSource.length }, { name: info.name, inputs: deps.join(', ') }, {
        token: info.name,
        hint: `Set ${deps.join(', ')} instead: SetValue(${deps[0] ?? info.name}, ...).`,
      });
    }
    return { source: substituted };
  }
  if (callee === 'Toggle') {
    if (firstRef === undefined) {
      return numbersError('bad_argument', { line, col: stepCol, endCol: stepCol + stepSource.length }, { command: 'Toggle', why: 'the target must be a checkbox' }, {
        token: stepSource,
        hint: 'Write Toggle(show) with a free Bool.',
      });
    }
    const info = figure.view.byId(firstRef);
    if (info && info.free !== true) {
      const deps = objectNames(figure, figure.view.inputsOf(firstRef));
      return numbersError('not_free', { line, col: stepCol, endCol: stepCol + stepSource.length }, { name: info.name, inputs: deps.join(', ') }, {
        token: info.name,
        hint: `Toggle ${deps.join(', ')} instead.`,
      });
    }
    return { source: substituted };
  }
  if (callee === 'Animate') {
    if (firstRef === undefined && call.args.length > 0 && call.args[0]?.expr?.n !== undefined) {
      // The all-sliders form Animate(on): no target to check.
      return { source: substituted };
    }
    if (firstRef !== undefined) {
      const info = figure.view.byId(firstRef);
      const view = figure.get(firstRef);
      if (info && info.type.k !== 'Number') {
        return numbersError('not_animatable', { line, col: stepCol, endCol: stepCol + stepSource.length }, { name: info.name, why: `${info.name} is a ${info.type.k}, not a Number`, reason: 'wrong_type' }, {
          token: info.name,
          hint: 'Animate needs a slider: a free Number with a range.',
        });
      }
      if (info && info.free !== true) {
        const deps = objectNames(figure, figure.view.inputsOf(firstRef));
        return numbersError('not_animatable', { line, col: stepCol, endCol: stepCol + stepSource.length }, { name: info.name, why: `${info.name} is computed from ${deps.join(', ')}`, reason: 'dependent' }, {
          token: info.name,
          hint: `Animate ${deps.join(', ')} instead, or make ${info.name} a free number with a range.`,
        });
      }
      if (view && !view.range) {
        const name = info?.name ?? 'it';
        return numbersError('not_animatable', { line, col: stepCol, endCol: stepCol + stepSource.length }, { name, why: `${name} has no range, so it has nothing to sweep`, reason: 'no_range' }, {
          token: name,
          hint: `Add a range first: ${name} in 0..5. Then Animate(${name}).`,
          suggest: [`${name} in 0..5`],
        });
      }
    }
    return { source: substituted };
  }
  if (callee === 'Click' && firstRef !== undefined) {
    const info = figure.view.byId(firstRef);
    const clickable = info?.name === undefined ? false : isClickableName(figure, info.name);
    if (info && !clickable) {
      return numbersError('bad_event', { line, col: stepCol, endCol: stepCol + stepSource.length }, { name: info.name, what: describeType(info.type.k), event: 'click' }, {
        token: info.name,
        hint: `Make it clickable first: ${info.name} with clickable = true. Or press a button.`,
      });
    }
    return { source: substituted, ...(info?.name !== undefined ? { usesClick: info.name } : {}) };
  }
  return { source: substituted };
}

function isClickableName(figure: Figure, name: string): boolean {
  const view = figure.get(name);
  if (!view) return false;
  if (view.type === 'Button') return true;
  return (view.style.ext as Record<string, unknown>)['clickable'] === true;
}

function describeType(k: string): string {
  switch (k) {
    case 'Number':
      return 'a number';
    case 'Bool':
      return 'a checkbox';
    case 'Text':
      return 'a text';
    case 'Point':
      return 'a point';
    case 'Button':
      return 'a button';
    case 'Choice':
      return 'a dropdown';
    case 'Input':
      return 'an input box';
    default:
      return `a ${k}`;
  }
}

function allowedEvents(figure: Figure, target: string): HandlerEvent[] | undefined {
  if (target === 'figure') return ['load', 'change'];
  const view = figure.get(target);
  if (!view) return undefined;
  if (view.type === 'Button') return ['click'];
  if (view.type === 'Input') return ['change', 'input', 'dragend'];
  if (view.type === 'Choice') return ['change'];
  if (view.type === 'Bool') return view.free ? ['change'] : [];
  if (view.type === 'Number' || view.type === 'Point') {
    const out: HandlerEvent[] = view.free ? ['change', 'dragend'] : [];
    if (isClickableName(figure, target)) out.unshift('click');
    return out;
  }
  return isClickableName(figure, target) ? ['click'] : [];
}

export interface AddHandlerValue {
  readonly summary: string;
  readonly steps: readonly string[];
  readonly target: string;
  readonly event: HandlerEvent;
}

/**
 * Add one step to a handler from an `on` line. Without #n the step is appended;
 * with #n it replaces step n. Returns the whole step list so the model sees order.
 */
export function addHandler(
  figure: Figure,
  lineText: string,
  opts: { line?: number } = {},
): import('../../contracts/errors').Result<AddHandlerValue> {
  const line = opts.line ?? 1;
  const parsed = parseHandlerLine(lineText, line);
  if ('ok' in parsed && parsed.ok === false) return parsed;
  const p = parsed as ParsedHandler;
  const store = handlersFor(figure);
  if (p.target !== 'figure' && !figure.view.lookup(p.target)) {
    const close = closestNames(p.target, figure.view.names(), 2);
    return numbersError('unknown_name', { line, col: 4, endCol: 4 + p.target.length }, { name: p.target }, {
      token: p.target,
      hint: close.length > 0 ? `Did you mean ${close.join(' or ')}? Create it first.` : 'Create the object first.',
    });
  }
  const allowed = allowedEvents(figure, p.target);
  if (!allowed || !allowed.includes(p.event)) {
    const what = p.target === 'figure' ? 'the figure' : describeType(figure.get(p.target)?.type ?? 'object');
    const hint =
      p.event === 'click' && p.target !== 'figure'
        ? `Use 'on ${p.target} change: ...', make a button: go = Button("Go"), or add with clickable = true.`
        : `Allowed events for ${p.target}: ${(allowed ?? []).join(', ') || 'none'}.`;
    return numbersError('bad_event', { line, col: 4, endCol: 4 + p.target.length }, { name: p.target, what, event: p.event, target_type: figure.get(p.target)?.type ?? 'figure', allowed: (allowed ?? []).join(', ') }, {
      token: p.target,
      hint,
    });
  }
  const key = handlerKey(p.target, p.event);
  const existing = store.handlers.get(key);
  const steps = existing ? [...existing.steps] : [];
  if (p.stepIndex !== undefined && (p.stepIndex < 1 || p.stepIndex > steps.length + 1)) {
    return numbersError('bad_step_index', { line, col: p.stepCol, endCol: p.stepCol }, { index: p.stepIndex, steps: steps.length }, {
      token: `#${p.stepIndex}`,
      hint: steps.length === 0 ? 'The handler has no steps yet; leave out #n to add the first.' : `Use #1..#${steps.length + 1}.`,
    });
  }
  if ((!existing && store.handlers.size >= NUMBERS_LIMITS.handlersPerFigure) || steps.length >= NUMBERS_LIMITS.stepsPerHandler) {
    const what = !existing ? 'handlers' : 'steps';
    const limit = !existing ? NUMBERS_LIMITS.handlersPerFigure : NUMBERS_LIMITS.stepsPerHandler;
    return numbersError('handler_limit', { line, col: 1, endCol: lineText.length + 1 }, { name: p.target, limit, actual: limit + 1, what }, {
      token: p.target,
      hint: 'Merge steps or split the work across buttons.',
    });
  }
  // Guard and loop checks (definition time).
  if (p.guard !== undefined) {
    const probeName = freshProbeName(figure);
    const bindings = definitionBindings(figure, p.target, p.event);
    // the guard sits on the loop step, so it sees the loop variable
    if (p.loop) bindings.set(p.loop.variable, { literal: { k: 'num', v: 1, text: '1', int: true, s: 0, e: 0 } });
    const guardParsed = parseLine(`${probeName} = ${p.guard}`, { line: 1 });
    if (!guardParsed.ok) return remap(guardParsed, line, 0);
    const substituted = printLineNode(substituteLine(guardParsed.value.node, bindings));
    const probe = checkProbeLine(figure, substituted, { line });
    if ('error' in probe) return probe.error;
    if (probe.checked.expr?.ty.k !== 'Bool') {
      const got = probe.checked.expr?.ty.k ?? 'nothing';
      return numbersError('bad_argument', { line, col: 1, endCol: lineText.length + 1 }, { command: 'on', why: `the guard must be a Bool, not a ${got}` }, {
        token: p.guard,
        hint: `Write a test, for example: on ${p.target} ${p.event} if ${p.target === 'figure' ? 'true' : p.target} > 5: ...`,
      });
    }
    if (probe.checked.usesT) {
      return numbersError('handler_structure', { line, col: 1, endCol: lineText.length + 1 }, { what: 'read the clock', step_kind: 'clock' }, {
        token: p.guard,
        hint: 'Guards cannot read t, bt or beat.',
      });
    }
  }
  if (p.loop !== undefined) {
    for (const [label, bound] of [['from', p.loop.from], ['to', p.loop.to]] as const) {
      const probeName = freshProbeName(figure);
      const bindings = definitionBindings(figure, p.target, p.event);
      const boundParsed = parseLine(`${probeName} = ${bound}`, { line: 1 });
      if (!boundParsed.ok) return remap(boundParsed, line, 0);
      const substituted = printLineNode(substituteLine(boundParsed.value.node, bindings));
      const probe = checkProbeLine(figure, substituted, { line });
      if ('error' in probe) return probe.error;
      if (probe.checked.expr?.ty.k !== 'Number') {
        return numbersError('bad_argument', { line, col: 1, endCol: lineText.length + 1 }, { command: 'on', why: `the loop ${label} must be a Number` }, {
          token: bound,
          hint: 'Write whole numbers, for example: for k in 1..5',
        });
      }
    }
    const fromLit = numLiteralOf(p.loop.from);
    const toLit = numLiteralOf(p.loop.to);
    if (fromLit !== undefined && toLit !== undefined && Number.isInteger(fromLit) && Number.isInteger(toLit)) {
      const count = toLit - fromLit + 1;
      if (count > NUMBERS_LIMITS.loopIterations || count < 1) {
        return numbersError('handler_limit', { line, col: 1, endCol: lineText.length + 1 }, { name: p.target, limit: NUMBERS_LIMITS.loopIterations, actual: Math.max(count, 0), what: 'loop iterations' }, {
          token: `${p.loop.from}..${p.loop.to}`,
          hint: 'Keep the loop range within 1000 iterations.',
        });
      }
    }
  }
  const checked = checkStepSource(figure, p.target, p.event, p.step, p.loop?.variable, line, p.stepCol);
  if ('ok' in checked && checked.ok === false) return checked;
  const stepCheck = checked as StepCheck;
  void stepCheck;
  const stored: StoredStep = {
    source: p.step,
    ...(p.guard !== undefined ? { guard: p.guard } : {}),
    ...(p.loop ? { loop: p.loop } : {}),
  };
  if (p.stepIndex !== undefined && p.stepIndex <= steps.length) steps[p.stepIndex - 1] = stored;
  else steps.push(stored);
  // Static Click-cycle detection over the new handler graph.
  const cycle = findClickCycle(figure, store.handlers, key, steps);
  if (cycle) {
    return numbersError('handler_cycle', { line, col: p.stepCol, endCol: p.stepCol + p.step.length }, { names: p.target, cycle: cycle.join(', ') }, {
      token: p.step,
      hint: 'Remove the Click, or press a different button.',
    });
  }
  store.handlers.set(key, { target: p.target, event: p.event, steps });
  const list = steps.map((s, i) => `${i + 1}: ${describeStoredStep(s)}`);
  return {
    ok: true,
    value: { summary: `${p.target} ${p.event}: ${steps.length} step${steps.length === 1 ? '' : 's'}`, steps: list, target: p.target, event: p.event },
    notices: [],
  };
}

function numLiteralOf(text: string): number | undefined {
  const t = text.trim();
  if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(t)) return undefined;
  return Number(t);
}

function describeStoredStep(s: StoredStep): string {
  let prefix = '';
  if (s.loop) prefix += `[for ${s.loop.variable} in ${s.loop.from}..${s.loop.to}] `;
  if (s.guard) prefix += `[if ${s.guard}] `;
  return `${prefix}${s.source}`;
}

/** Click edges (target,click) -> (other,click) with the candidate steps in place. */
function findClickCycle(figure: Figure, handlers: Map<string, StoredHandler>, changedKey: string, changedSteps: StoredStep[]): string[] | undefined {
  const edges = new Map<string, string[]>();
  const stepTargets = (steps: readonly StoredStep[]): string[] => {
    const out: string[] = [];
    for (const s of steps) {
      const parsed = parseLine(s.source, { line: 1 });
      if (!parsed.ok || parsed.value.node.k !== 'action') continue;
      const call = parsed.value.node.expr;
      if (call.callee !== 'Click' || call.args.length === 0) continue;
      const first = call.args[0]?.value;
      if (first?.k === 'name') out.push(first.name);
    }
    return out;
  };
  for (const [key, h] of handlers) {
    if (h.event !== 'click') continue;
    const steps = key === changedKey ? changedSteps : h.steps;
    edges.set(key, stepTargets(steps).map((t) => handlerKey(t, 'click')));
  }
  if (!edges.has(changedKey)) {
    const [target, event] = changedKey.split('\n') as [string, string];
    if (event === 'click') edges.set(changedKey, stepTargets(changedSteps).map((t) => handlerKey(t, 'click')));
    void target;
  }
  void figure;
  // Depth-first search from the changed handler for a path back to itself.
  const stack: string[] = [changedKey];
  const path: string[] = [changedKey];
  const visited = new Set<string>([changedKey]);
  const show = (key: string): string => {
    const [t, e] = key.split('\n') as [string, string];
    return `${t} ${e}`;
  };
  while (stack.length > 0) {
    const top = stack[stack.length - 1] as string;
    const next = (edges.get(top) ?? []).filter((n) => !visited.has(n) || n === changedKey);
    const unvisited = next.find((n) => n !== changedKey);
    if (next.includes(changedKey) && path.length > 0) return [...path.map(show), show(changedKey)];
    if (!unvisited) {
      stack.pop();
      path.pop();
      continue;
    }
    visited.add(unvisited);
    stack.push(unvisited);
    path.push(unvisited);
  }
  return undefined;
}

/* ------------------------------ removal ------------------------------ */

/**
 * Remove a handler, or one of its steps. Idempotent: clearing what is not there
 * succeeds silently.
 */
export function clearHandler(
  figure: Figure,
  target: string,
  event: string,
  step?: number,
): import('../../contracts/errors').Result<{ readonly summary: string }> {
  const store = handlersFor(figure);
  const key = handlerKey(target, event);
  const existing = store.handlers.get(key);
  if (!existing) return { ok: true, value: { summary: `no handler on ${target} ${event}` }, notices: [] };
  if (step === undefined) {
    store.handlers.delete(key);
    return { ok: true, value: { summary: `cleared ${target} ${event}` }, notices: [] };
  }
  if (!Number.isInteger(step) || step < 1 || step > existing.steps.length) {
    return numbersError('bad_step_index', { line: 0, col: 1, endCol: 1 }, { index: step, steps: existing.steps.length }, {
      token: `#${step}`,
      hint: existing.steps.length === 0 ? 'The handler has no steps.' : `Use #1..#${existing.steps.length}.`,
    });
  }
  const steps = existing.steps.filter((_, i) => i !== step - 1);
  if (steps.length === 0) store.handlers.delete(key);
  else store.handlers.set(key, { target: existing.target, event: existing.event, steps });
  return { ok: true, value: { summary: `cleared ${target} ${event} #${step}` }, notices: [] };
}

/** Every handler with its steps, in the order they were added. */
export function listHandlers(figure: Figure): StoredHandler[] {
  return [...handlersFor(figure).handlers.values()].map((h) => ({ target: h.target, event: h.event, steps: [...h.steps] }));
}

/** The last handler runs, newest last (at most 20 are kept). */
export function lastRuns(figure: Figure): readonly HandlerRun[] {
  return [...handlersFor(figure).runs];
}

/** Steps that reference a deleted object: each fails its check now. */
export function brokenSteps(figure: Figure, target: string, event: HandlerEvent): number[] {
  const h = handlersFor(figure).handlers.get(handlerKey(target, event));
  if (!h) return [];
  const out: number[] = [];
  h.steps.forEach((s, i) => {
    const bindings = definitionBindings(figure, target, event);
    if (s.loop) bindings.set(s.loop.variable, { literal: { k: 'num', v: 1, text: '1', int: true, s: 0, e: 0 } });
    const range = parseRangeRestyle(s.source);
    if (range) {
      const named = bindings.get(range.target);
      if (!figure.get(named && 'ref' in named ? named.ref : range.target)) out.push(i + 1);
      return;
    }
    const parsed = parseLine(s.source, { line: 1 });
    if (!parsed.ok) {
      out.push(i + 1);
      return;
    }
    const probe = checkProbeLine(figure, printLineNode(substituteLine(parsed.value.node, bindings)), {});
    if ('error' in probe) out.push(i + 1);
  });
  return out;
}

/** Handlers and steps that mention a name (for Delete/Rename reports). */
export function stepsMentioning(figure: Figure, name: string): { readonly target: string; readonly event: HandlerEvent; readonly steps: readonly number[] }[] {
  const out: { target: string; event: HandlerEvent; steps: number[] }[] = [];
  for (const h of handlersFor(figure).handlers.values()) {
    const hits: number[] = [];
    h.steps.forEach((s, i) => {
      const texts = [s.source, ...(s.guard ? [s.guard] : []), ...(s.loop ? [s.loop.from, s.loop.to] : [])];
      if (texts.some((t) => t.split(TEXT_LITERAL).some((part, k) => k % 2 === 0 && nameRe(name).test(part)))) {
        hits.push(i + 1);
      }
    });
    if (hits.length > 0 || h.target === name) out.push({ target: h.target, event: h.event, steps: hits });
  }
  return out;
}

/**
 * Rewrite stored step sources after a rename. The figure's own `rename` and `Rename` already do this through its
 * events, so a host only needs this for renames it applied some other way.
 */
export function rewriteStepsForRename(figure: Figure, from: string, to: string): number {
  return renameInSteps(handlersFor(figure), from, to);
}

/* ------------------------------ scripts ------------------------------ */

/** Every handler as `on` lines, in step order (the integrator appends these to toScript). */
export function handlersToScript(figure: Figure): string {
  const lines: string[] = [];
  for (const h of handlersFor(figure).handlers.values()) {
    for (const s of h.steps) {
      let line = `on ${h.target} ${h.event}`;
      if (s.loop) line += ` for ${s.loop.variable} in ${s.loop.from}..${s.loop.to}`;
      if (s.guard) line += ` if ${s.guard}`;
      line += `: ${s.source}`;
      lines.push(line);
    }
  }
  return lines.length > 0 ? lines.join('\n') + '\n' : '';
}

/** Load `on` lines (other lines are ignored). */
export function loadHandlers(figure: Figure, text: string): { readonly added: number; readonly errors: readonly ErrorObject[] } {
  const errors: ErrorObject[] = [];
  let added = 0;
  for (const l of splitLogicalLines(text)) {
    if (!l.text.trimStart().startsWith('on ')) continue;
    const r = addHandler(figure, l.text, { line: l.firstLine });
    if (r.ok) added++;
    else errors.push(r);
  }
  return { added, errors };
}

/* ------------------------------ run support ------------------------------ */

/** The stored handler for a run (a copy; the runner never mutates it). */
export function getStoredHandler(figure: Figure, target: string, event: HandlerEvent): StoredHandler | undefined {
  const h = handlersFor(figure).handlers.get(handlerKey(target, event));
  return h ? { target: h.target, event: h.event, steps: [...h.steps] } : undefined;
}

/** Append a run to the last-20 list. */
export function recordRun(figure: Figure, run: HandlerRun): void {
  const runs = handlersFor(figure).runs;
  runs.push(run);
  while (runs.length > 20) runs.shift();
}

/** A fresh probe name for expansion checks. */
export function expansionProbeName(figure: Figure): string {
  return freshProbeName(figure);
}

/* ------------------------------ on lines through Figure.apply ------------------------------ */

type HandlerSnapshot = readonly (readonly [string, StoredHandler])[];

function snapshotHandlers(store: FigureHandlers): HandlerSnapshot {
  return [...store.handlers].map(([k, h]) => [k, { target: h.target, event: h.event, steps: [...h.steps] }] as const);
}

function restoreHandlers(store: FigureHandlers, snap: HandlerSnapshot): void {
  store.handlers.clear();
  for (const [k, h] of snap) store.handlers.set(k, { target: h.target, event: h.event, steps: [...h.steps] });
}

const CLEAR_LINE = /^\s*ClearHandler\(\s*([A-Za-zͰ-Ͽ][A-Za-z0-9_Ͱ-Ͽ]*)\s*,\s*"?(click|change|input|dragend|load)"?\s*(?:,\s*(\d+)\s*)?\)\s*$/;

/**
 * The `on` line and `ClearHandler(go, click)` as lines of the figure (controls-scripting design 3.3): the steps live with
 * the figure, and the line is one undo entry like any other.
 */
export function numbersLineHandler(host: unknown, text: string, opts: { readonly dryRun: boolean; readonly line: number }): import('../../graph/registry').LineHandled | ErrorObject | undefined {
  const figure = host as Figure;
  const isOn = /^\s*on\s+\S/.test(text);
  const clear = isOn ? null : CLEAR_LINE.exec(text);
  if (!isOn && !clear) return undefined;
  const store = handlersFor(figure);
  const before = snapshotHandlers(store);
  const r = isOn
    ? addHandler(figure, text.trim(), { line: opts.line })
    : clearHandler(figure, clear?.[1] as string, clear?.[2] as string, clear?.[3] !== undefined ? Number(clear[3]) : undefined);
  if (!r.ok) {
    restoreHandlers(store, before);
    return r;
  }
  const after = snapshotHandlers(store);
  if (opts.dryRun) restoreHandlers(store, before);
  const summary = isOn ? `on ${(r.value as { target?: string }).target ?? ''} ${(r.value as { event?: string }).event ?? ''}`.trim() : (r.value as { summary: string }).summary;
  return {
    summary,
    notices: r.notices,
    undo: () => restoreHandlers(store, before),
    redo: () => restoreHandlers(store, after),
  };
}

/** The `on` lines at the end of the script, after every object they name. */
export function handlerScriptLines(host: unknown): readonly string[] {
  const text = handlersToScript(host as Figure);
  return text === '' ? [] : text.trimEnd().split('\n');
}

/** The handler steps a delete leaves broken, one notice per handler (controls-scripting design 5). */
export function handlerDeleteNotes(host: unknown, names: readonly string[]): readonly Notice[] {
  const figure = host as Figure;
  const gone = new Set(names);
  const out: Notice[] = [];
  for (const name of names) {
    for (const hit of stepsMentioning(figure, name)) {
      if (gone.has(hit.target)) continue;
      out.push(numbersNotice('handler_steps_broken', { target: hit.target, event: hit.event, name, steps: hit.steps.join(', ') }, [hit.target, name]));
    }
  }
  return out;
}
