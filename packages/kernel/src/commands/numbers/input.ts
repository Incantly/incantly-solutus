/**
 * Input boxes: the learner-text pipeline (controls-scripting/design.md 3.2).
 *
 * The box shows the target's value as text. On commit the text goes through one
 * pipeline; if any stage fails the target is UNCHANGED and the box shows the
 * error as data. Learner text is values and formulas only: no commands, no
 * statements, no clock.
 */

import type { ErrorObject, Notice, Result } from '../../contracts/errors';
import type { Figure } from '../../graph/figure';
import type { Name, ObjId } from '../../contracts/values';
import { valueText } from '../../language/runtime';
import { children } from '../../language/relation';
import type { TNode } from '../../language/tnode';
import { NUMBERS_LIMITS } from './types';
import { numbersError } from './errors';
import { checkProbeLine, evalTNode } from './eval';
import { parseLine } from '../../language/parser';
import type { Expr } from '../../language/ast';
import { expansionProbeName, emitControlEvent } from './handlers';
import { formatDisplayNumber } from './format';
import { resolveDisplay } from './format';
import { emitChange, writeNumberValue, writeSimpleValue } from './valuewrite';

/* ------------------------------ typing state ------------------------------ */

export interface InputState {
  readonly text: string;
  readonly valid: boolean;
  readonly error: ErrorObject | null;
  readonly notice: Notice | null;
}

const states = new WeakMap<Figure, Map<ObjId, InputState>>();

function statesFor(figure: Figure): Map<ObjId, InputState> {
  let m = states.get(figure);
  if (!m) {
    m = new Map();
    states.set(figure, m);
  }
  return m;
}

function setState(figure: Figure, id: ObjId, state: InputState): void {
  statesFor(figure).set(id, state);
}

/** Forget typing state (Reset of an input box, or the target changed elsewhere). */
export function clearInputState(figure: Figure, x: Name | ObjId): void {
  const id = figure.get(x)?.id;
  if (id !== undefined) statesFor(figure).delete(id);
}

/* ------------------------------ targets ------------------------------ */

const LINKABLE: ReadonlySet<string> = new Set(['Number', 'Text', 'Point', 'Vector', 'Bool', 'Function']);

/** The linked target's id, from the input's rule value. */
export function inputTargetOf(figure: Figure, x: Name | ObjId): ObjId | undefined {
  const id = figure.get(x)?.id;
  if (id === undefined) return undefined;
  const v = figure.value(id) as { target?: unknown } | undefined;
  return typeof v?.target === 'number' ? (v.target as ObjId) : undefined;
}

/**
 * Definition-time check of an Input target: it must exist, be free (or a
 * linked function), and have a type with a text form. Returns the error, if any.
 */
export function checkInputTarget(figure: Figure, targetName: string): ErrorObject | undefined {
  const target = figure.get(targetName);
  if (!target) {
    return numbersError('unknown_name', { line: 0, col: 1, endCol: 1 }, { name: targetName }, { token: targetName, hint: 'Create the target first.' });
  }
  if (!LINKABLE.has(target.type)) {
    return numbersError('bad_input_target', { line: 0, col: 1, endCol: 1 }, { name: targetName, why: `a ${target.type} has no text form`, reason: 'bad_type' }, {
      token: targetName,
      hint: 'Link a free Number, Text, Point, Vector, Bool or Function.',
    });
  }
  if (!target.free && target.type !== 'Function') {
    return numbersError('bad_input_target', { line: 0, col: 1, endCol: 1 }, { name: targetName, why: `${targetName} is computed, so the box could not write to it`, reason: 'dependent' }, {
      token: targetName,
      hint: 'Link a free object.',
    });
  }
  return undefined;
}

/** The target's current value as box text. */
export function targetTextOf(figure: Figure, target: Name | ObjId): string {
  const view = figure.get(target);
  const v = figure.value(target);
  if (!view) return '';
  if (v === undefined) return '–';
  switch (view.type) {
    case 'Number':
      return formatDisplayNumber(v as number, resolveDisplay(figure, target));
    case 'Bool':
    case 'Text':
      return String(v);
    case 'Point':
    case 'Vector': {
      const p = v as { x: number; y: number };
      const auto = { unit: 'none' as const, format: { mode: 'auto' as const }, trim: true };
      return `(${formatDisplayNumber(p.x, auto)}, ${formatDisplayNumber(p.y, auto)})`;
    }
    default:
      return valueText(v);
  }
}

/** What is in the box: typing state while dirty, else the target's text. */
export function inputTextOf(figure: Figure, x: Name | ObjId): string {
  const id = figure.get(x)?.id;
  if (id === undefined) return '';
  const s = statesFor(figure).get(id);
  if (s) return s.text;
  const target = inputTargetOf(figure, id);
  return target === undefined ? '' : targetTextOf(figure, target);
}

/** Whether the box text parses and type-checks right now. */
export function inputValidOf(figure: Figure, x: Name | ObjId): boolean {
  const id = figure.get(x)?.id;
  if (id === undefined) return false;
  return statesFor(figure).get(id)?.valid ?? true;
}

/** The last parse/type error from the learner's text, as data. */
export function inputErrorOf(figure: Figure, x: Name | ObjId): ErrorObject | null {
  const id = figure.get(x)?.id;
  if (id === undefined) return null;
  return statesFor(figure).get(id)?.error ?? null;
}

/* ------------------------------ the pipeline ------------------------------ */

/** Forbidden top-level tokens: statements, directives and comments are not values. */
function scanForbidden(text: string): { index: number; word: string } | undefined {
  let depth = 0;
  let inString = false;
  const isWordChar = (c: string): boolean => /[A-Za-z0-9_\u0370-\u03FF]/.test(c);
  for (let i = 0; i < text.length; i++) {
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
    if (c === '(' || c === '[' || c === '{') {
      depth++;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0) continue;
    if (c === '@' || c === '#') return { index: i, word: c };
    if (c === '=') {
      const prev = text[i - 1] as string | undefined;
      const next = text[i + 1] as string | undefined;
      if (prev === '=' || prev === '!' || prev === '<' || prev === '>' || next === '=') continue;
      return { index: i, word: '=' };
    }
    if (c === 'w' && text.startsWith('with', i) && !isWordChar(text[i + 4] ?? '') && !isWordChar(text[i - 1] ?? '')) {
      return { index: i, word: 'with' };
    }
    if (c === 'o' && text.startsWith('on', i) && !isWordChar(text[i + 2] ?? '') && !isWordChar(text[i - 1] ?? '')) {
      return { index: i, word: 'on' };
    }
  }
  return undefined;
}

function findCommand(t: TNode): TNode | undefined {
  if (t.n === 'command') return t;
  for (const c of children(t)) {
    const hit = findCommand(c);
    if (hit) return hit;
  }
  return undefined;
}

/** PascalCase calls in the raw syntax tree (commands, before any name is resolved). */
function findSyntaxCommand(e: Expr): { callee: string; s: number } | undefined {
  switch (e.k) {
    case 'call':
      if (/^[A-Z]/.test(e.callee)) return { callee: e.callee, s: e.cs };
      for (const a of e.args) {
        const hit = findSyntaxCommand(a.value);
        if (hit) return hit;
      }
      return undefined;
    case 'unary':
    case 'fact':
    case 'deg':
      return findSyntaxCommand(e.arg);
    case 'bin':
      return findSyntaxCommand(e.l) ?? findSyntaxCommand(e.r);
    case 'cmp':
      for (const o of e.operands) {
        const hit = findSyntaxCommand(o);
        if (hit) return hit;
      }
      return undefined;
    case 'tick':
      for (const a of e.args) {
        const hit = findSyntaxCommand(a);
        if (hit) return hit;
      }
      return undefined;
    case 'index':
      return findSyntaxCommand(e.target) ?? findSyntaxCommand(e.index);
    case 'field':
      return findSyntaxCommand(e.target);
    case 'tuple':
    case 'list':
      for (const o of e.items) {
        const hit = findSyntaxCommand(o);
        if (hit) return hit;
      }
      return undefined;
    case 'polar':
      return findSyntaxCommand(e.r) ?? findSyntaxCommand(e.a);
    case 'range': {
      const hit = findSyntaxCommand(e.from) ?? findSyntaxCommand(e.to);
      if (hit) return hit;
      return e.step ? findSyntaxCommand(e.step) : undefined;
    }
    case 'cond':
      for (const o of e.args) {
        const hit = findSyntaxCommand(o);
        if (hit) return hit;
      }
      return undefined;
    case 'str':
      for (const p of e.parts) {
        if (typeof p === 'string') continue;
        const hit = findSyntaxCommand(p.expr);
        if (hit) return hit;
      }
      return undefined;
    default:
      return undefined;
  }
}

function treeDepth(t: TNode): number {
  let deep = 0;
  for (const c of children(t)) deep = Math.max(deep, treeDepth(c));
  return deep + 1;
}

interface Validated {
  readonly checked: import('../../language/check').CheckedLine;
  readonly expr: TNode;
}

function validateText(
  figure: Figure,
  targetId: ObjId,
  text: string,
  opts: { params?: readonly string[] },
): Validated | { error: ErrorObject } {
  if (text.length > NUMBERS_LIMITS.inputLength) {
    return {
      error: numbersError('input_too_long', { line: 1, col: 1, endCol: Math.min(text.length + 1, 501) }, { got: text.length, max: NUMBERS_LIMITS.inputLength }, {
        token: text.slice(0, 20),
        hint: `Keep the text under ${NUMBERS_LIMITS.inputLength} characters.`,
      }),
    };
  }
  const forbidden = scanForbidden(text);
  if (forbidden) {
    const col = forbidden.index + 1;
    return {
      error: numbersError('input_not_expression', { line: 1, col, endCol: col + forbidden.word.length }, {}, {
        token: forbidden.word,
        hint: 'Type a value, not a statement.',
      }),
    };
  }
  const probe = expansionProbeName(figure);
  const params = opts.params;
  const source = params ? `${probe}(${params.join(', ')}) = ${text}` : `${probe} = ${text}`;
  const syntax = parseLine(source, { line: 1 });
  if (syntax.ok) {
    const node = syntax.value.node;
    const expr = node.k === 'define' || node.k === 'function' ? node.expr : undefined;
    const call = expr ? findSyntaxCommand(expr) : undefined;
    if (call) {
      const col = remapCol(call.s, probe, params);
      return {
        error: numbersError('input_command', { line: 1, col, endCol: Math.min(text.length + 1, col + call.callee.length + 3) }, {}, {
          token: `${call.callee}(...)`,
          hint: 'Try: 2*pi',
        }),
      };
    }
  }
  const parsed = checkProbeLine(figure, source, { limits: { exprNodes: NUMBERS_LIMITS.inputNodes } });
  if ('error' in parsed) return { error: remapProbe(parsed.error, probe, params) };
  const checked = parsed.checked;
  const expr = checked.expr;
  if (!expr) {
    return {
      error: numbersError('input_not_expression', { line: 1, col: 1, endCol: text.length + 1 }, {}, {
        token: text,
        hint: 'Type a value, not a statement.',
      }),
    };
  }
  if (treeDepth(expr) > NUMBERS_LIMITS.inputDepth) {
    return {
      error: numbersError('input_too_deep', { line: 1, col: 1, endCol: text.length + 1 }, { got: treeDepth(expr), max: NUMBERS_LIMITS.inputDepth }, {
        token: text.slice(0, 20),
        hint: `Keep nesting under ${NUMBERS_LIMITS.inputDepth} levels.`,
      }),
    };
  }
  const command = findCommand(expr);
  if (command) {
    const col = Math.max(1, remapCol(command.s, probe, params));
    return {
      error: numbersError('input_command', { line: 1, col, endCol: col + 1 }, {}, {
        token: text.slice(Math.max(0, col - 1), Math.max(0, col - 1) + 10),
        hint: 'Try: 2*pi',
      }),
    };
  }
  if (checked.usesT) {
    return {
      error: numbersError('input_not_expression', { line: 1, col: 1, endCol: text.length + 1 }, {}, {
        token: text,
        hint: 'The clock is not available in an input box.',
      }),
    };
  }
  void targetId;
  return { checked, expr };
}

function remapProbe(error: ErrorObject, probe: string, params: readonly string[] | undefined): ErrorObject {
  const offset = params ? probe.length + params.join(', ').length + 4 : probe.length + 3;
  return { ...error, line: 1, col: Math.max(1, error.col - offset), endCol: Math.max(1, error.endCol - offset) };
}

function remapCol(s: number, probe: string, params: readonly string[] | undefined): number {
  const offset = params ? probe.length + params.join(', ').length + 4 : probe.length + 3;
  // s is a normalised offset into the probe line; the prefix is plain ASCII.
  return Math.max(1, s + 1 - offset);
}

function functionParams(figure: Figure, targetId: ObjId): readonly string[] | undefined {
  const def = figure.get(targetId)?.definition ?? '';
  const eq = def.indexOf('=');
  const head = (eq < 0 ? def : def.slice(0, eq)).trim();
  const m = /^[A-Za-z\u0370-\u03FF][A-Za-z0-9_\u0370-\u03FF]*\(([^)]*)\)$/.exec(head);
  if (!m) return undefined;
  const params = m[1]
    ?.split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  if (!params || params.length === 0 || params.length > 4) return undefined;
  if (!params.every((p) => /^[A-Za-z\u0370-\u03FF][A-Za-z0-9_\u0370-\u03FF]*$/.test(p))) return undefined;
  return params;
}

/**
 * Validate without committing (typing feedback, `q.valid`). Records the state.
 */
export function typeInputText(figure: Figure, name: string, text: string): { readonly valid: boolean; readonly error: ErrorObject | null } {
  const view = figure.get(name);
  if (!view || view.type !== 'Input') {
    const error = numbersError('unknown_name', { line: 1, col: 1, endCol: 1 }, { name }, { token: name });
    return { valid: false, error };
  }
  const target = inputTargetOf(figure, view.id);
  if (target === undefined) {
    const error = numbersError('bad_input_target', { line: 1, col: 1, endCol: 1 }, { name, why: 'the box is not linked', reason: 'unlinked' }, { token: name });
    setState(figure, view.id, { text, valid: false, error, notice: null });
    return { valid: false, error };
  }
  const targetView = figure.get(target);
  if (!targetView) {
    const error = numbersError('bad_input_target', { line: 1, col: 1, endCol: 1 }, { name, why: 'the target is gone', reason: 'gone' }, { token: name });
    setState(figure, view.id, { text, valid: false, error, notice: null });
    return { valid: false, error };
  }
  if (targetView.type === 'Text') {
    const valid = text.length <= NUMBERS_LIMITS.inputLength;
    const error = valid
      ? null
      : numbersError('input_too_long', { line: 1, col: 1, endCol: 501 }, { got: text.length, max: NUMBERS_LIMITS.inputLength }, { token: text.slice(0, 20) });
    setState(figure, view.id, { text, valid, error, notice: null });
    return { valid, error };
  }
  const params = targetView.type === 'Function' ? functionParams(figure, target) : undefined;
  if (targetView.type === 'Function' && !params) {
    const error = numbersError('input_not_expression', { line: 1, col: 1, endCol: 1 }, {}, { token: text, hint: 'Type the function body, for example: x^2 - 3.' });
    setState(figure, view.id, { text, valid: false, error, notice: null });
    return { valid: false, error };
  }
  const checked = validateText(figure, target, text, params ? { params } : {});
  if ('error' in checked) {
    setState(figure, view.id, { text, valid: false, error: checked.error, notice: null });
    return { valid: false, error: checked.error };
  }
  const want = targetView.type === 'Vector' ? 'Vector' : targetView.type;
  const got = checked.expr.ty.k;
  const match = want === 'Function' ? got === 'Number' || got === 'Point' : got === want;
  if (!match) {
    const error = numbersError('type_mismatch', { line: 1, col: 1, endCol: text.length + 1 }, { op: 'store in the box', left: got, right: want }, {
      token: text,
      hint: targetView.type === 'Point' ? 'Expected a point, like (1, 2).' : `Expected ${want === 'Number' ? 'a number' : `a ${want}`}.`,
    });
    setState(figure, view.id, { text, valid: false, error, notice: null });
    return { valid: false, error };
  }
  const v = targetView.type === 'Function' ? undefined : evalTNode(figure, checked.expr, {});
  if (v && !v.defined) {
    const error = numbersError('input_value_undefined', { line: 1, col: 1, endCol: text.length + 1 }, { reason: v.reason }, {
      token: text,
      hint: 'Change the text so it has a value.',
    });
    setState(figure, view.id, { text, valid: false, error, notice: null });
    return { valid: false, error };
  }
  setState(figure, view.id, { text, valid: true, error: null, notice: null });
  return { valid: true, error: null };
}

export interface CommitInputValue {
  readonly summary: string;
  readonly notices: readonly Notice[];
}

/**
 * Commit learner text to the target. On any failure the target is unchanged and
 * the box keeps the text with the error as data.
 */
export function commitInputText(
  figure: Figure,
  name: string,
  text: string,
  opts: { by?: 'learner' | 'host' } = {},
): Result<CommitInputValue> {
  const view = figure.get(name);
  if (!view || view.type !== 'Input') {
    return numbersError('unknown_name', { line: 1, col: 1, endCol: 1 }, { name }, { token: name });
  }
  const target = inputTargetOf(figure, view.id);
  const targetView = target === undefined ? undefined : figure.get(target);
  if (target === undefined || !targetView) {
    const error = numbersError('bad_input_target', { line: 1, col: 1, endCol: 1 }, { name, why: 'the box is not linked', reason: 'unlinked' }, { token: name });
    setState(figure, view.id, { text, valid: false, error, notice: null });
    return error;
  }
  if (!targetView.free && targetView.type !== 'Function') {
    const error = numbersError('bad_input_target', { line: 1, col: 1, endCol: 1 }, { name, why: `${targetView.name} is computed, so the box is disabled`, reason: 'target_not_free' }, { token: name });
    setState(figure, view.id, { text, valid: false, error, notice: null });
    return error;
  }
  const typed = typeInputText(figure, name, text);
  if (!typed.valid) return typed.error as ErrorObject;
  const by = opts.by ?? 'learner';
  if (targetView.type === 'Text') {
    const r = writeSimpleValue(figure, target, text, { by });
    if (!r.ok) {
      setState(figure, view.id, { text, valid: false, error: r, notice: null });
      return r;
    }
    setState(figure, view.id, { text: targetTextOf(figure, target), valid: true, error: null, notice: null });
    emitControlEvent(figure, { event: 'change', name, type: 'Input', value: text, by });
    return { ok: true, value: { summary: `input for ${targetView.name}, shows ${text}`, notices: [] }, notices: [] };
  }
  if (targetView.type === 'Function') {
    const params = functionParams(figure, target) as readonly string[];
    const line = `${targetView.name}(${params.join(', ')}) = ${text}`;
    const r = figure.apply(line);
    if (!r.ok) {
      setState(figure, view.id, { text, valid: false, error: r, notice: null });
      return r;
    }
    setState(figure, view.id, { text: targetTextOf(figure, target), valid: true, error: null, notice: null });
    emitControlEvent(figure, { event: 'change', name, type: 'Input', value: text, by });
    emitChange(figure, target, by);
    return { ok: true, value: { summary: `input for ${targetView.name}, shows ${text}`, notices: [] }, notices: [] };
  }
  // Number, Bool, Point, Vector: re-validate to get the checked tree, then write once.
  const checked = validateText(figure, target, text, {});
  if ('error' in checked) {
    setState(figure, view.id, { text, valid: false, error: checked.error, notice: null });
    return checked.error;
  }
  const v = evalTNode(figure, (checked as Validated).expr, {});
  if (!v.defined) {
    const error = numbersError('input_value_undefined', { line: 1, col: 1, endCol: text.length + 1 }, { reason: v.reason }, { token: text });
    setState(figure, view.id, { text, valid: false, error, notice: null });
    return error;
  }
  const value = v.value;
  if (targetView.type === 'Number' && typeof value === 'number') {
    const r = writeNumberValue(figure, target, value, { source: 'typed', by });
    if (!r.ok) {
      setState(figure, view.id, { text, valid: false, error: r, notice: null });
      return r;
    }
    const first = r.value.notices[0] ?? null;
    setState(figure, view.id, { text: targetTextOf(figure, target), valid: true, error: null, notice: first });
    emitControlEvent(figure, { event: 'change', name, type: 'Input', value: targetTextOf(figure, target), by });
    return { ok: true, value: { summary: `input for ${targetView.name}, shows ${targetTextOf(figure, target)}`, notices: r.value.notices }, notices: [] };
  }
  if (targetView.type === 'Bool' && typeof value === 'boolean') {
    return commitSimple(figure, view.id, target, targetView.name, text, value, by);
  }
  if ((targetView.type === 'Point' || targetView.type === 'Vector') && isPt(value)) {
    return commitSimple(figure, view.id, target, targetView.name, text, { x: value.x, y: value.y }, by);
  }
  const error = numbersError('input_value_undefined', { line: 1, col: 1, endCol: text.length + 1 }, { reason: 'not_finite' }, { token: text });
  setState(figure, view.id, { text, valid: false, error, notice: null });
  return error;
}

function isPt(v: unknown): v is { x: number; y: number } {
  return typeof v === 'object' && v !== null && typeof (v as { x?: unknown }).x === 'number' && typeof (v as { y?: unknown }).y === 'number';
}

function commitSimple(
  figure: Figure,
  boxId: ObjId,
  target: ObjId,
  targetName: string,
  text: string,
  value: boolean | { readonly x: number; readonly y: number },
  by: 'learner' | 'host',
): Result<CommitInputValue> {
  const boxName = figure.get(boxId)?.name ?? targetName;
  const r = writeSimpleValue(figure, target, value, { by });
  if (!r.ok) {
    setState(figure, boxId, { text, valid: false, error: r, notice: null });
    return r;
  }
  setState(figure, boxId, { text: targetTextOf(figure, target), valid: true, error: null, notice: null });
  emitControlEvent(figure, { event: 'change', name: boxName, type: 'Input', value: targetTextOf(figure, target), by });
  return { ok: true, value: { summary: `input for ${targetName}, shows ${targetTextOf(figure, target)}`, notices: [] }, notices: [] };
}
