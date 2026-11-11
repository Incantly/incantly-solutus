/**
 * Value writes shared by SetValue, Toggle, input boxes and handler expansion.
 * Every slider write goes through commit(); every write emits a change event.
 */

import type { ErrorObject, Notice, Result } from '../../contracts/errors';
import type { ObjId } from '../../contracts/values';
import type { Figure } from '../../graph/figure';
import { numberSource } from '../../graph/values';
import { valueText } from '../../language/runtime';
import { notice as langNotice } from '../../language/errors';
import { becameUndefinedNotice, makeNotice } from '../../errors/notices';
import { commit, unitScale } from './commit';
import type { CommitSource } from './commit';
import { displayUnitOf } from './props';
import { formatDisplayNumber } from './format';
import { numbersError, numbersNotice } from './errors';
import { emitControlEvent } from './handlers';
import { captureResetInitial } from './run';

export interface WriteOk {
  readonly notices: readonly Notice[];
  readonly wrote: { readonly name: string; readonly from: string; readonly to: string };
}

function notFreeError(figure: Figure, id: ObjId): ErrorObject {
  const view = figure.get(id);
  const name = view?.name ?? String(id);
  const deps: string[] = [];
  for (const input of view?.inputs ?? []) {
    const info = figure.view.byId(input);
    if (info) deps.push(info.name);
  }
  return numbersError('not_free', { line: 0, col: 1, endCol: 1 }, { name, inputs: deps.join(', ') }, {
    token: name,
    hint: deps.length > 0 ? `Set ${deps.join(', ')} instead: SetValue(${deps[0]}, ...).` : `Redefine ${name} as a plain value first.`,
  });
}

function emitChange(figure: Figure, id: ObjId, by: 'learner' | 'host'): void {
  const view = figure.get(id);
  if (!view) return;
  emitControlEvent(figure, { event: 'change', name: view.name, type: view.type, value: valueText(figure.value(id)), by });
}

/**
 * Write a free Number through commit() (sliders) or directly (plain numbers,
 * where inf stays storable per README decision 7).
 */
export function writeNumberValue(
  figure: Figure,
  id: ObjId,
  raw: number,
  opts: { source: CommitSource; by?: 'learner' | 'host' },
): Result<WriteOk> {
  const view = figure.get(id);
  if (!view || view.type !== 'Number' || !view.free) return notFreeError(figure, id);
  captureResetInitial(figure, id);
  const by = opts.by ?? 'host';
  const from = valueText(figure.value(id));
  const range = view.range;
  if (!range) {
    const r = figure.setFree(id, raw, 'api');
    if (!r.ok) return r;
    emitChange(figure, id, by);
    return { ok: true, value: { notices: [], wrote: { name: view.name, from, to: valueText(figure.value(id)) } }, notices: [] };
  }
  const unit = displayUnitOf(figure, id);
  const c = commit(raw, { lo: range.min, hi: range.max, step: range.step ?? 'auto', unit, source: opts.source });
  if (!c.ok) {
    const wr = figure.setFree(id, NaN, 'api');
    if (!wr.ok) return wr;
    emitChange(figure, id, by);
    return {
      ok: true,
      value: { notices: [becameUndefinedNotice([view.name], c.reason)], wrote: { name: view.name, from, to: valueText(figure.value(id)) } },
      notices: [],
    };
  }
  const wr = figure.setFree(id, c.value, 'api');
  if (!wr.ok) return wr;
  figure.flush();
  const notices: Notice[] = [];
  if (c.clamped) {
    const end = c.clamped.to > c.clamped.from ? 'low end' : 'high end';
    notices.push(makeNotice('clamped', { name: view.name, value: valueText(c.value), end }));
  }
  if (c.snapped) notices.push(numbersNotice('snapped', { name: view.name, value: valueText(c.value) }));
  if (c.stepFallback) notices.push(numbersNotice('step_fallback', { name: view.name }));
  if (c.belowPrecision) notices.push(numbersNotice('step_below_precision', { name: view.name }));
  if (c.precisionLoss) {
    notices.push(langNotice('precision_loss', 'warning', `${view.name} is very large for an angle; precision may be lost.`, { name: view.name }, [view.name]));
  }
  emitChange(figure, id, by);
  return { ok: true, value: { notices, wrote: { name: view.name, from, to: valueText(figure.value(id)) } }, notices: [] };
}

/** Write a free Bool/Text/Point/Vector directly. */
export function writeSimpleValue(
  figure: Figure,
  id: ObjId,
  value: boolean | string | { readonly x: number; readonly y: number },
  opts: { by?: 'learner' | 'host' } = {},
): Result<WriteOk> {
  const view = figure.get(id);
  if (!view || !view.free) return notFreeError(figure, id);
  captureResetInitial(figure, id);
  const by = opts.by ?? 'host';
  const from = valueText(figure.value(id));
  const r = figure.setFree(id, value, 'api');
  if (!r.ok) return r;
  figure.flush();
  emitChange(figure, id, by);
  return { ok: true, value: { notices: [], wrote: { name: view.name, from, to: valueText(figure.value(id)) } }, notices: [] };
}

/** Flip a free Bool. */
export function toggleValue(figure: Figure, id: ObjId, opts: { by?: 'learner' | 'host' } = {}): Result<WriteOk> {
  const view = figure.get(id);
  if (!view || view.type !== 'Bool' || !view.free) return notFreeError(figure, id);
  const cur = figure.value(id);
  if (typeof cur !== 'boolean') {
    return numbersError('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'Toggle', why: `${view.name} is undefined` }, { token: view.name });
  }
  return writeSimpleValue(figure, id, !cur, opts);
}

/* ------------------------------ choices ------------------------------ */

export interface ChoiceState {
  readonly options: readonly unknown[];
  readonly index: number;
  readonly value: unknown;
  readonly count: number;
}

export function choiceStateOf(figure: Figure, id: ObjId): ChoiceState | undefined {
  const v = figure.value(id) as ChoiceState | undefined;
  if (!v || typeof v !== 'object' || !Array.isArray(v.options) || typeof v.index !== 'number' || typeof v.count !== 'number') return undefined;
  return v;
}

/** Default caption of one option: the formatted value. */
export function defaultCaption(v: unknown): string {
  if (typeof v === 'number') return formatDisplayNumber(v, { unit: 'none', format: { mode: 'auto' }, trim: true });
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    if (typeof o['x'] === 'number' && typeof o['y'] === 'number') {
      return `(${formatDisplayNumber(o['x'], { unit: 'none', format: { mode: 'auto' }, trim: true })}, ${formatDisplayNumber(o['y'], { unit: 'none', format: { mode: 'auto' }, trim: true })})`;
    }
  }
  return valueText(v);
}

function splitTopLevelArgs(text: string): string[] | undefined {
  const out: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;
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
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

/**
 * Change the selected index by redefining the Choice line (the index is a free
 * value saved in the script). One undo entry, like any redefine.
 */
export function setChoiceIndex(
  figure: Figure,
  id: ObjId,
  index: number,
  opts: { by?: 'learner' | 'host' } = {},
): Result<WriteOk> {
  const view = figure.get(id);
  if (!view || view.type !== 'Choice') {
    return numbersError('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'SetValue', why: 'the target is not a dropdown' }, { token: view?.name ?? '' });
  }
  captureResetInitial(figure, id);
  const state = choiceStateOf(figure, id);
  const count = state?.count;
  if (count === undefined || !Number.isInteger(index) || index < 1 || (count > 0 && index > count)) {
    return numbersError('bad_index', { line: 0, col: 1, endCol: 1 }, { index, count: count ?? 0 }, {
      token: String(index),
      hint: `Use 1..${count ?? 0}.`,
    });
  }
  const def = view.definition;
  const open = def.indexOf('Choice(');
  if (open < 0 || !def.trimEnd().endsWith(')')) {
    return numbersError('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'SetValue', why: `the definition of ${view.name} was not recognised` }, { token: view.name });
  }
  const argsText = def.slice(open + 'Choice('.length, def.trimEnd().length - 1);
  const args = splitTopLevelArgs(argsText);
  if (!args || args.length < 1 || args.length > 2) {
    return numbersError('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'SetValue', why: `the definition of ${view.name} was not recognised` }, { token: view.name });
  }
  const from = valueText(figure.value(id));
  const line = `${view.name} = Choice(${args[0]?.trim()}, ${index})`;
  const r = figure.apply(line);
  if (!r.ok) return r;
  emitChange(figure, id, opts.by ?? 'host');
  return { ok: true, value: { notices: [], wrote: { name: view.name, from, to: valueText(figure.value(id)) } }, notices: [] };
}

/** Change the selection by caption text. */
export function setChoiceCaption(
  figure: Figure,
  id: ObjId,
  caption: string,
  opts: { by?: 'learner' | 'host' } = {},
): Result<WriteOk> {
  const view = figure.get(id);
  if (!view || view.type !== 'Choice') {
    return numbersError('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'SetValue', why: 'the target is not a dropdown' }, { token: view?.name ?? '' });
  }
  const state = choiceStateOf(figure, id);
  if (!state) {
    return numbersError('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'SetValue', why: `${view.name} has no options right now` }, { token: view.name });
  }
  const captions = captionsFor(figure, id, state);
  const index = captions.findIndex((c) => c === caption) + 1;
  if (index < 1) {
    return numbersError('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'SetValue', why: `"${caption}" is not an option of ${view.name}` }, {
      token: caption,
      hint: `Options: ${captions.join(', ') || 'none'}.`,
    });
  }
  return setChoiceIndex(figure, id, index, opts);
}

function captionsFor(figure: Figure, id: ObjId, state: ChoiceState): readonly string[] {
  const ext = (figure.get(id)?.style.ext ?? {}) as Record<string, unknown>;
  const override = ext['captions'];
  if (Array.isArray(override) && override.every((x) => typeof x === 'string')) return override as readonly string[];
  return state.options.map(defaultCaption);
}

/* ------------------------------ list elements ------------------------------ */

function elementLiteral(v: unknown): string | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? numberSource(v) : undefined;
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'string') {
    if (v.length > 500) return undefined;
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, '\\n')}"`;
  }
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    if (typeof o['x'] === 'number' && typeof o['y'] === 'number' && Number.isFinite(o['x']) && Number.isFinite(o['y'])) {
      return `(${numberSource(o['x'])}, ${numberSource(o['y'])})`;
    }
  }
  return undefined;
}

function elementKind(v: unknown): string {
  if (typeof v === 'number') return 'Number';
  if (typeof v === 'boolean') return 'Bool';
  if (typeof v === 'string') return 'Text';
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    if (typeof o['x'] === 'number' && typeof o['y'] === 'number') return 'Point';
  }
  return 'value';
}

/**
 * Write one element of a free list by redefining its literal. Only lists of
 * Number, Text, Bool or Point have literals; anything else needs the lists area.
 */
export function setListElement(
  figure: Figure,
  id: ObjId,
  index: number,
  value: unknown,
  opts: { by?: 'learner' | 'host' } = {},
): Result<WriteOk> {
  const view = figure.get(id);
  if (!view || !view.typeText.startsWith('List')) {
    return numbersError('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'SetValue', why: 'the target is not a list' }, { token: view?.name ?? '' });
  }
  if (!view.free) return notFreeError(figure, id);
  captureResetInitial(figure, id);
  const raw = figure.value(id) as readonly unknown[] | undefined;
  const list = Array.isArray(raw) ? raw : raw instanceof Float64Array ? Array.from(raw) : undefined;
  if (!list) {
    return numbersError('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'SetValue', why: `${view.name} is undefined right now` }, { token: view.name });
  }
  if (!Number.isInteger(index) || index < 1 || index > list.length) {
    return numbersError('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'SetValue', why: `${view.name} has ${list.length} items; ${index} is out of range` }, {
      token: String(index),
      hint: `Use 1..${list.length}. Lists are 1-based.`,
    });
  }
  const first = list[0];
  const want = elementKind(first);
  const got = elementKind(value);
  if (want !== got) {
    return numbersError('type_mismatch', { line: 0, col: 1, endCol: 1 }, { op: 'store', left: got, right: `List of ${want}` }, {
      token: valueText(value),
      hint: `Give a ${want}.`,
    });
  }
  const lit = elementLiteral(value);
  if (lit === undefined) {
    return numbersError('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'SetValue', why: 'that value cannot be written into a list' }, { token: view.name });
  }
  const items: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = i === index - 1 ? lit : elementLiteral(list[i]);
    if (item === undefined) {
      return numbersError('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'SetValue', why: `${view.name} holds values that cannot be rewritten` }, { token: view.name });
    }
    items.push(item);
  }
  const from = valueText(figure.value(id));
  const r = figure.apply(`${view.name} = [${items.join(', ')}]`);
  if (!r.ok) return r;
  emitChange(figure, id, opts.by ?? 'host');
  return { ok: true, value: { notices: [], wrote: { name: view.name, from, to: valueText(figure.value(id)) } }, notices: [] };
}

export { unitScale };
