/**
 * Commands and direct APIs (numbers-sliders 3.2/3.7, controls-scripting 3.5/3.7):
 * Button, Choice, Input, SetValue, Toggle, Animate, Reset, Click, ClearHandler.
 *
 * Object commands are pure rules and work fully through the draw channel. Action
 * commands evaluate their arguments from the checked trees (the kernel passes
 * area actions no values) and record structured outcomes in a side table, because
 * actions have no error channel; the direct APIs below return full Results and
 * are the primary surface for hosts and the view.
 */

import type { ErrorObject, Notice, Result } from '../../contracts/errors';
import type { ObjId } from '../../contracts/values';
import type { SkipReason } from './types';
import type { Figure } from '../../graph/figure';
import type { CommandRegistry } from '../../graph/registry';
import type { ActionCall, CommandRule } from '../../graph/registry';
import { numberSource } from '../../graph/values';
import type { BoundArg, CommandForm, CommandSpec, ParamSpec } from '../../language/table';
import type { TArg } from '../../language/tnode';
import { valueText } from '../../language/runtime';
import { NUMBERS_LIMITS } from './types';
import { numbersError } from './errors';
import { makeNotice } from '../../errors/notices';
import { evalTNode } from './eval';
import { clearHandler, emitControlEvent } from './handlers';
import { clickButton as runClickButton, ensureResetTracking, initialOf, pushActionOutcome } from './run';
import { commitInputText, inputTextOf } from './input';
import { clearInputState } from './input';
import { choiceStateOf, defaultCaption, setChoiceCaption, setChoiceIndex, setListElement, toggleValue, writeNumberValue, writeSimpleValue } from './valuewrite';
import { animatingIds, animationValueAt, clearAnchor, getAnchor, lastTickT, onceFinished, setAnchor, startDir } from './animate';
import { buttonLabelOf, displayUnitOf, loopOf, periodOf, seedOf } from './props';

/** Type names the integrator passes to checkTable alongside the core names. */
export const NUMBERS_TYPE_NAMES: readonly string[] = ['Button', 'Choice', 'Input'];

const P = (name: string, type: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ name, type, ...extra });

function targsOf(args: readonly BoundArg[]): TArg[] {
  return args as unknown as TArg[];
}

function refId(t: TArg | undefined): ObjId | undefined {
  return t?.expr?.n === 'ref' ? t.expr.id : undefined;
}

function valueKind(v: unknown): string {
  if (typeof v === 'number') return 'Number';
  if (typeof v === 'boolean') return 'Bool';
  if (typeof v === 'string') return 'Text';
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    if (typeof o['x'] === 'number' && typeof o['y'] === 'number') return 'Point';
  }
  return 'value';
}

/* ------------------------------ object commands ------------------------------ */

function buttonSpec(): CommandSpec {
  return {
    name: 'Button',
    kind: 'object',
    group: 'controls',
    forms: [
      {
        params: [P('label', 'Text')],
        returns: 'Button',
        rule: () =>
          ({
            run: (call) => {
              const label = call.values[0];
              if (typeof label !== 'string') return call.fail('input_undefined');
              if (label.length > NUMBERS_LIMITS.labelLength) return call.fail('limit', 'a label of more than 120 characters');
              return { label };
            },
          }) as CommandRule,
        summary: 'a button with a label',
      },
    ],
  };
}

const CHOICE_ELEMENTS = 'List<Number>|List<Text>|List<Color>|List<Point>|List<Function>|List<Bool>';

function choiceSpec(): CommandSpec {
  // One form with a union: one form per element type would tie on an empty list
  // (each adopts its hint) and the matcher reports ties as internal.
  const forms: CommandForm[] = [
    {
      params: [P('options', CHOICE_ELEMENTS), P('index', 'Number', { optional: true, default: 1 })],
      returns: 'Choice',
      rule: () =>
        ({
          run: (call) => {
            const rawValue = call.values[0] as readonly unknown[] | undefined;
            const index = (call.values[1] as number | undefined) ?? 1;
            const raw = Array.isArray(rawValue) ? rawValue : rawValue instanceof Float64Array ? Array.from(rawValue) : undefined;
            if (!raw) return call.fail('input_undefined');
            const count = raw.length;
            if (count === 0) return call.fail('empty_choice');
            if (count > NUMBERS_LIMITS.choiceOptions) return call.fail('limit', `more than ${NUMBERS_LIMITS.choiceOptions} options`);
            if (typeof index !== 'number' || !Number.isInteger(index)) return call.fail('not_integer', `Choice index ${String(index)}`);
            const idx = Math.min(count, Math.max(1, index));
            return { options: raw, index: idx, value: raw[idx - 1], count };
          },
        }) as CommandRule,
      summary: 'a dropdown of options',
    },
  ];
  return { name: 'Choice', kind: 'object', group: 'controls', forms };
}

function inputSpec(): CommandSpec {
  return {
    name: 'Input',
    kind: 'object',
    group: 'controls',
    forms: [
      {
        params: [P('target', 'Number|Text|Point|Vector|Bool|Function'), P('caption', 'Text', { optional: true, default: '' })],
        returns: 'Input',
        rule: () =>
          ({
            run: (call) => {
              const target = call.ids[0];
              if (target === undefined) return call.fail('target_not_free', 'the target must be a free object');
              const v = call.values[0];
              if (typeof v === 'number') {
                if (!Number.isFinite(v)) return call.fail('not_finite');
                return { text: String(v), valid: true, target };
              }
              if (typeof v === 'boolean') return { text: String(v), valid: true, target };
              if (typeof v === 'string') return { text: v, valid: true, target };
              if (typeof v === 'object' && v !== null) {
                const o = v as Record<string, unknown>;
                if (typeof o['x'] === 'number' && typeof o['y'] === 'number') {
                  return { text: `(${String(o['x'])}, ${String(o['y'])})`, valid: true, target };
                }
                if (typeof o['arity'] === 'number') return { text: 'function', valid: true, target };
              }
              return call.fail('input_undefined');
            },
          }) as CommandRule,
        summary: 'an input box linked to a free object',
      },
    ],
  };
}

/* ------------------------------ action commands ------------------------------ */

function done(figure: Figure, wrote: readonly ObjId[], summary: string): { summary: string } {
  pushActionOutcome(figure, { status: 'done', wrote });
  return { summary };
}

function skipped(figure: Figure, reason: SkipReason, summary: string): { summary: string } {
  pushActionOutcome(figure, { status: 'skipped', reason });
  return { summary };
}

function failed(figure: Figure, error: ErrorObject, summary: string): { summary: string } {
  pushActionOutcome(figure, { status: 'error', error });
  return { summary };
}

function setValueSpec(): CommandSpec {
  const forms: CommandForm[] = [
    { params: [P('obj', 'Number'), P('value', 'Number')], returns: null, rule: setValueRule, summary: 'set a free number' },
    { params: [P('obj', 'Bool'), P('value', 'Bool')], returns: null, rule: setValueRule, summary: 'set a free checkbox' },
    { params: [P('obj', 'Text'), P('value', 'Text')], returns: null, rule: setValueRule, summary: 'set a free text' },
    { params: [P('obj', 'Point'), P('value', 'Point')], returns: null, rule: setValueRule, summary: 'set a free point' },
    { params: [P('obj', 'Vector'), P('value', 'Vector')], returns: null, rule: setValueRule, summary: 'set a free vector' },
    { params: [P('obj', 'Choice'), P('index', 'Number')], returns: null, rule: setValueRule, summary: 'select a dropdown option by index' },
    { params: [P('obj', 'Choice'), P('caption', 'Text')], returns: null, rule: setValueRule, summary: 'select a dropdown option by caption' },
    { params: [P('obj', 'Input'), P('text', 'Text')], returns: null, rule: setValueRule, summary: 'type into an input box' },
    // One union form: one form per element type would tie on an empty list target.
    // The element type is validated at run time (an outcome error, not a check error).
    { params: [P('obj', 'List<Number>|List<Text>|List<Bool>|List<Point>'), P('index', 'Number'), P('value', 'Number|Text|Bool|Point')], returns: null, rule: setValueRule, summary: 'set an element of a list' },
  ];
  return { name: 'SetValue', kind: 'action', group: 'controls', forms };
}

function setValueRule(args: readonly BoundArg[]): unknown {
  const targs = targsOf(args);
  return {
    run: (call: ActionCall) => {
      const figure = call.figure;
      const targetId = refId(targs[0]);
      if (targetId === undefined) {
        return failed(figure, numbersError('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'SetValue', why: 'the target must be an object' }, { token: 'SetValue' }), 'SetValue needs an object target');
      }
      const view = figure.get(targetId);
      if (!view) {
        return failed(figure, numbersError('unknown_name', { line: 0, col: 1, endCol: 1 }, { name: String(targetId) }, { token: '' }), 'SetValue target is gone');
      }
      if (targs.length > 2) {
        const indexArg = targs[1]?.expr;
        const valueArg = targs[2]?.expr;
        if (!indexArg || !valueArg) return failed(figure, numbersError('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'SetValue', why: 'an index and a value are needed' }, { token: view.name }), 'SetValue needs an index and a value');
        const ii = evalTNode(figure, indexArg, {});
        const vv = evalTNode(figure, valueArg, {});
        if (!ii.defined || !vv.defined) return skipped(figure, 'undefined_argument', `SetValue(${view.name}) skipped: an argument is undefined`);
        if (typeof ii.value !== 'number') {
          return failed(figure, numbersError('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'SetValue', why: 'the index must be a number' }, { token: view.name }), 'SetValue needs a number index');
        }
        const r = setListElement(figure, targetId, ii.value, vv.value, {});
        if (!r.ok) return failed(figure, r, `SetValue(${view.name}) failed`);
        return done(figure, [targetId], `set ${view.name}[${ii.value}]`);
      }
      const valueArg = targs[1]?.expr;
      if (!valueArg) {
        return failed(figure, numbersError('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'SetValue', why: 'a value is needed' }, { token: view.name }), 'SetValue needs a value');
      }
      const vv = evalTNode(figure, valueArg, {});
      if (!vv.defined) return skipped(figure, 'undefined_argument', `SetValue(${view.name}) skipped: the value is undefined`);
      const v = vv.value;
      if (view.type === 'Choice') {
        if (typeof v !== 'number' && typeof v !== 'string') {
          return failed(figure, numbersError('type_mismatch', { line: 0, col: 1, endCol: 1 }, { op: 'store', left: valueKind(v), right: 'Choice' }, { token: view.name }), 'SetValue needs an index or a caption');
        }
        const r = typeof v === 'number' ? setChoiceIndex(figure, targetId, v, {}) : setChoiceCaption(figure, targetId, v, {});
        if (!r.ok) return failed(figure, r, `SetValue(${view.name}) failed`);
        return done(figure, [targetId], `set ${view.name}`);
      }
      if (view.type === 'Input') {
        if (typeof v !== 'string') {
          return failed(figure, numbersError('type_mismatch', { line: 0, col: 1, endCol: 1 }, { op: 'store', left: valueKind(v), right: 'Input' }, { token: view.name }), 'SetValue needs a text');
        }
        const r = commitInputText(figure, view.name, v, { by: 'host' });
        if (!r.ok) return failed(figure, r, `SetValue(${view.name}) failed`);
        return done(figure, [targetId], `set ${view.name}`);
      }
      if (view.type === 'Number' && typeof v === 'number') {
        const r = writeNumberValue(figure, targetId, v, { source: 'setValue', by: 'host' });
        if (!r.ok) return failed(figure, r, `SetValue(${view.name}) failed`);
        return done(figure, [targetId], `set ${view.name}`);
      }
      if ((view.type === 'Bool' && typeof v === 'boolean') || (view.type === 'Text' && typeof v === 'string')) {
        const r = writeSimpleValue(figure, targetId, v, { by: 'host' });
        if (!r.ok) return failed(figure, r, `SetValue(${view.name}) failed`);
        return done(figure, [targetId], `set ${view.name}`);
      }
      if ((view.type === 'Point' || view.type === 'Vector') && typeof v === 'object' && v !== null && typeof (v as { x?: unknown }).x === 'number' && typeof (v as { y?: unknown }).y === 'number') {
        const r = writeSimpleValue(figure, targetId, v as { x: number; y: number }, { by: 'host' });
        if (!r.ok) return failed(figure, r, `SetValue(${view.name}) failed`);
        return done(figure, [targetId], `set ${view.name}`);
      }
      return failed(figure, numbersError('type_mismatch', { line: 0, col: 1, endCol: 1 }, { op: 'store', left: valueKind(v), right: view.type }, { token: view.name }), `SetValue(${view.name}) failed`);
    },
  };
}

function toggleSpec(): CommandSpec {
  return {
    name: 'Toggle',
    kind: 'action',
    group: 'controls',
    forms: [{ params: [P('obj', 'Bool')], returns: null, rule: toggleRule, summary: 'flip a checkbox' }],
  };
}

function toggleRule(args: readonly BoundArg[]): unknown {
  const targs = targsOf(args);
  return {
    run: (call: ActionCall) => {
      const figure = call.figure;
      const targetId = refId(targs[0]);
      if (targetId === undefined) {
        return failed(figure, numbersError('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'Toggle', why: 'the target must be a checkbox' }, { token: 'Toggle' }), 'Toggle needs a checkbox');
      }
      const r = toggleValue(figure, targetId, { by: 'host' });
      if (!r.ok) return failed(figure, r, 'Toggle failed');
      return done(figure, [targetId], `toggled ${r.value.wrote.name}`);
    },
  };
}

function animateSpec(): CommandSpec {
  return {
    name: 'Animate',
    kind: 'action',
    group: 'controls',
    forms: [
      { params: [P('n', 'Number'), P('on', 'Bool', { optional: true, default: true })], returns: null, rule: animateRule, summary: 'start or stop a slider moving by itself' },
      { params: [P('on', 'Bool')], returns: null, rule: animateRule, summary: 'start or stop every animatable slider' },
    ],
  };
}

function notAnimatable(figure: Figure, id: ObjId): ErrorObject | undefined {
  const view = figure.get(id);
  if (!view) return numbersError('unknown_name', { line: 0, col: 1, endCol: 1 }, { name: String(id) }, { token: '' });
  if (view.type !== 'Number') {
    return numbersError('not_animatable', { line: 0, col: 1, endCol: 1 }, { name: view.name, why: `${view.name} is a ${view.type}, not a Number`, reason: 'wrong_type' }, { token: view.name });
  }
  if (!view.free) {
    const deps: string[] = [];
    for (const input of view.inputs) {
      const info = figure.view.byId(input);
      if (info) deps.push(info.name);
    }
    return numbersError('not_animatable', { line: 0, col: 1, endCol: 1 }, { name: view.name, why: `${view.name} is computed from ${deps.join(', ')}`, reason: 'dependent' }, { token: view.name });
  }
  if (!view.range) {
    return numbersError('not_animatable', { line: 0, col: 1, endCol: 1 }, { name: view.name, why: `${view.name} has no range, so it has nothing to sweep`, reason: 'no_range' }, {
      token: view.name,
      hint: `Add a range first: ${view.name} in 0..5. Then Animate(${view.name}).`,
    });
  }
  return undefined;
}

function animateRule(args: readonly BoundArg[]): unknown {
  const targs = targsOf(args);
  return {
    run: (call: ActionCall) => {
      const figure = call.figure;
      const t = lastTickT(figure);
      if (targs.length === 1 && targs[0]?.param.name === 'on') {
        const expr = targs[0]?.expr;
        const vv = expr ? evalTNode(figure, expr, {}) : { defined: true as const, value: true as unknown };
        if (!vv.defined) return skipped(figure, 'undefined_argument', 'Animate skipped: the switch is undefined');
        const on = vv.value === true;
        const names: string[] = [];
        for (const o of figure.objects()) {
          if (o.type !== 'Number' || !o.free || !o.range) continue;
          if (on) {
            if (animatingIds(figure).length >= NUMBERS_LIMITS.animating) break;
            const r = startAnimation(figure, o.id, t);
            if (r.started) names.push(o.name);
          } else if (clearAnchor(figure, o.id)) names.push(o.name);
        }
        return done(figure, [], on ? `animating ${names.length} sliders` : `stopped ${names.length} sliders`);
      }
      const targetId = refId(targs[0]);
      if (targetId === undefined) {
        return failed(figure, numbersError('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'Animate', why: 'the target must be a slider' }, { token: 'Animate' }), 'Animate needs a slider');
      }
      const onTarg = targs[1];
      const vv = onTarg?.expr && !onTarg.omitted ? evalTNode(figure, onTarg.expr, {}) : { defined: true as const, value: true as unknown };
      if (!vv.defined) return skipped(figure, 'undefined_argument', 'Animate skipped: the switch is undefined');
      const view = figure.get(targetId);
      const bad = notAnimatable(figure, targetId);
      if (bad) return failed(figure, bad, `Animate(${view?.name ?? ''}) failed`);
      if (vv.value !== true) {
        stopAnimation(figure, targetId, t);
        return done(figure, [], `stopped ${view?.name ?? ''}`);
      }
      if (animatingIds(figure).length >= NUMBERS_LIMITS.animating) {
        return failed(figure, numbersError('limit', { line: 0, col: 1, endCol: 1 }, { limit: 'animating_sliders', max: NUMBERS_LIMITS.animating, got: animatingIds(figure).length + 1, what: 'animating sliders' }, { token: view?.name ?? '' }), 'Too many sliders are animating');
      }
      const r = startAnimation(figure, targetId, t);
      return done(figure, [], r.started ? `animating ${view?.name ?? ''}` : `${view?.name ?? ''} is already at the top`);
    },
  };
}

function resetSpec(): CommandSpec {
  return {
    name: 'Reset',
    kind: 'action',
    group: 'controls',
    forms: [
      { params: [], returns: null, rule: resetRule, summary: 'restore every free value' },
      { params: [P('obj', 'Any')], rest: P('more', 'Any', { optional: true }), returns: null, rule: resetRule, summary: 'restore listed free values' },
    ],
  };
}

function resetRule(args: readonly BoundArg[]): unknown {
  const targs = targsOf(args);
  return {
    run: (call: ActionCall) => {
      const figure = call.figure;
      const r = resetObjects(figure, targs.length === 0 ? undefined : targs.map((t) => t.expr?.n === 'ref' ? figure.view.byId(t.expr.id)?.name ?? '' : ''), { by: 'host' });
      if (!r.ok) return failed(figure, r, 'Reset failed');
      return done(figure, [], r.value.summary);
    },
  };
}

function clickSpec(): CommandSpec {
  return {
    name: 'Click',
    kind: 'action',
    group: 'controls',
    forms: [{ params: [P('obj', 'Any')], returns: null, rule: clickRule, summary: 'press a button by code' }],
  };
}

function clickRule(args: readonly BoundArg[]): unknown {
  const targs = targsOf(args);
  return {
    run: (call: ActionCall) => {
      const figure = call.figure;
      const targetId = refId(targs[0]);
      const name = targetId === undefined ? undefined : figure.view.byId(targetId)?.name;
      if (targetId === undefined || name === undefined) {
        return failed(figure, numbersError('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'Click', why: 'the target must be a button' }, { token: 'Click' }), 'Click needs a button');
      }
      const r = runClickButton(figure, name, { by: 'host' });
      if (!r.ok) return failed(figure, r, `Click(${name}) failed`);
      const run = r.value;
      if (!run.ok) return failed(figure, run.error ?? numbersError('handler_limit', { line: 0, col: 1, endCol: 1 }, { name, limit: 0, actual: 0, what: 'steps' }, { token: name }), `Click(${name}) was aborted`);
      return done(figure, [], `clicked ${name} (${run.stepsUsed} steps)`);
    },
  };
}

function clearHandlerSpec(): CommandSpec {
  return {
    name: 'ClearHandler',
    kind: 'action',
    group: 'controls',
    forms: [
      { params: [P('target', 'Any'), P('event', 'Text'), P('step', 'Number', { optional: true })], returns: null, rule: clearHandlerRule, summary: 'remove handlers or one step' },
    ],
  };
}

function clearHandlerRule(args: readonly BoundArg[]): unknown {
  const targs = targsOf(args);
  return {
    run: (call: ActionCall) => {
      const figure = call.figure;
      const targetId = refId(targs[0]);
      const target = targetId === undefined ? undefined : (figure.view.byId(targetId)?.name ?? (targs[0]?.expr?.n === 'ref' ? undefined : undefined));
      const eventExpr = targs[1]?.expr;
      const eventValue = eventExpr ? evalTNode(figure, eventExpr, {}) : { defined: false as const, reason: 'input_undefined' };
      const event = eventValue.defined && typeof eventValue.value === 'string' ? eventValue.value : undefined;
      if (target === undefined || event === undefined) {
        return failed(figure, numbersError('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'ClearHandler', why: 'a target and an event name are needed' }, { token: 'ClearHandler' }), 'ClearHandler needs a target and an event');
      }
      const stepExpr = targs[2]?.expr;
      const stepValue = stepExpr && !targs[2]?.omitted ? evalTNode(figure, stepExpr, {}) : undefined;
      const step = stepValue && stepValue.defined && typeof stepValue.value === 'number' ? stepValue.value : undefined;
      const r = clearHandler(figure, target, event, step);
      if (!r.ok) return failed(figure, r, 'ClearHandler failed');
      return done(figure, [], r.value.summary);
    },
  };
}

/** Every command spec this area owns. */
export function numbersCommandSpecs(): CommandSpec[] {
  return [buttonSpec(), choiceSpec(), inputSpec(), setValueSpec(), toggleSpec(), animateSpec(), resetSpec(), clickSpec(), clearHandlerSpec()];
}

/* ------------------------------ animation cores ------------------------------ */

export interface StartResult {
  readonly started: boolean;
  readonly atTop: boolean;
}

/** Set an anchor at the current value (a `once` slider at the top stays put). */
export function startAnimation(figure: Figure, id: ObjId, t: number): StartResult {
  const view = figure.get(id);
  const v = figure.value(id);
  const range = view?.range;
  if (!view || typeof v !== 'number' || !range) return { started: false, atTop: false };
  if (loopOf(figure, id) === 'once' && v >= range.max) return { started: false, atTop: true };
  setAnchor(figure, id, { t0: t, v0: v, dir: startDir(v, range.min, range.max) });
  return { started: true, atTop: false };
}

/** Clear the anchor, freezing the value at the current computed value. */
export function stopAnimation(figure: Figure, id: ObjId, t?: number): void {
  const view = figure.get(id);
  const range = view?.range;
  const current = view ? getAnchor(figure, id) : undefined;
  if (view && range && current && typeof figure.value(id) === 'number') {
    const r = animationValueAt({
      loop: loopOf(figure, id),
      lo: range.min,
      hi: range.max,
      period: periodOf(figure, id),
      anchor: current,
      seed: seedOf(figure, id),
      step: range.step ?? 'auto',
      unit: displayUnitOf(figure, id),
      t: t ?? lastTickT(figure),
    });
    if (r.ok) figure.setFree(id, r.value, 'anim');
  }
  clearAnchor(figure, id);
}

/* ------------------------------ direct APIs ------------------------------ */

/** Set a free value by name (Number, Bool, Text, Point, Vector, Choice, Input). */
export function setValue(figure: Figure, name: string, value: unknown, opts: { by?: 'learner' | 'host' } = {}): Result<{ summary: string; notices: readonly Notice[] }> {
  const view = figure.get(name);
  if (!view) return numbersError('unknown_name', { line: 0, col: 1, endCol: 1 }, { name }, { token: name });
  const mismatch = (right: string): ErrorObject =>
    numbersError('type_mismatch', { line: 0, col: 1, endCol: 1 }, { op: 'store', left: valueKind(value), right }, { token: name, hint: `Give a ${right}.` });
  let r: Result<{ notices: readonly Notice[]; wrote: { name: string; from: string; to: string } }>;
  switch (view.type) {
    case 'Number':
      if (typeof value !== 'number') return mismatch('Number');
      r = writeNumberValue(figure, view.id, value, { source: 'setValue', ...(opts.by !== undefined ? { by: opts.by } : {}) });
      break;
    case 'Bool':
      if (typeof value !== 'boolean') return mismatch('Bool');
      r = writeSimpleValue(figure, view.id, value, opts);
      break;
    case 'Text':
      if (typeof value !== 'string') return mismatch('Text');
      r = writeSimpleValue(figure, view.id, value, opts);
      break;
    case 'Point':
    case 'Vector':
      if (typeof value !== 'object' || value === null || typeof (value as { x?: unknown }).x !== 'number' || typeof (value as { y?: unknown }).y !== 'number') {
        return mismatch(view.type);
      }
      r = writeSimpleValue(figure, view.id, value as { x: number; y: number }, opts);
      break;
    case 'Choice':
      if (typeof value !== 'number' && typeof value !== 'string') return mismatch('Number or Text');
      r = typeof value === 'number' ? setChoiceIndex(figure, view.id, value, opts) : setChoiceCaption(figure, view.id, value, opts);
      break;
    case 'Input':
      if (typeof value !== 'string') return mismatch('Text');
      return commitInputText(figure, name, value, opts);
    default:
      return numbersError('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'SetValue', why: `${name} is a ${view.type}, which SetValue cannot set` }, { token: name });
  }
  if (!r.ok) return r;
  return { ok: true, value: { summary: `set ${name}`, notices: r.value.notices }, notices: [] };
}

/** Set one element of a free list by name (1-based). */
export function setListElementByName(figure: Figure, name: string, index: number, value: unknown, opts: { by?: 'learner' | 'host' } = {}): Result<{ summary: string }> {
  const view = figure.get(name);
  if (!view) return numbersError('unknown_name', { line: 0, col: 1, endCol: 1 }, { name }, { token: name });
  const r = setListElement(figure, view.id, index, value, opts);
  if (!r.ok) return r;
  return { ok: true, value: { summary: `set ${name}[${index}]` }, notices: [] };
}

/** Flip a checkbox by name. */
export function toggleCheckbox(figure: Figure, name: string, opts: { by?: 'learner' | 'host' } = {}): Result<{ summary: string }> {
  const view = figure.get(name);
  if (!view) return numbersError('unknown_name', { line: 0, col: 1, endCol: 1 }, { name }, { token: name });
  const r = toggleValue(figure, view.id, opts);
  if (!r.ok) return r;
  return { ok: true, value: { summary: `toggled ${name}` }, notices: [] };
}

/** Start or stop one slider. The host passes the clock (draw lines anchor at the last tick). */
export function animateSlider(figure: Figure, name: string, on = true, opts: { t?: number; by?: 'learner' | 'host' } = {}): Result<{ summary: string; animating: boolean }> {
  void opts.by;
  const view = figure.get(name);
  if (!view) return numbersError('unknown_name', { line: 0, col: 1, endCol: 1 }, { name }, { token: name });
  const bad = notAnimatable(figure, view.id);
  if (bad) return bad;
  const t = opts.t ?? lastTickT(figure);
  if (!on) {
    stopAnimation(figure, view.id, t);
    return { ok: true, value: { summary: `stopped ${name}`, animating: false }, notices: [] };
  }
  if (animatingIds(figure).length >= NUMBERS_LIMITS.animating && !animatingIds(figure).includes(view.id)) {
    return numbersError('limit', { line: 0, col: 1, endCol: 1 }, { limit: 'animating_sliders', max: NUMBERS_LIMITS.animating, got: animatingIds(figure).length + 1, what: 'animating sliders' }, {
      token: name,
      hint: 'Stop another slider first.',
    });
  }
  const r = startAnimation(figure, view.id, t);
  if (!r.started) return { ok: true, value: { summary: `${name} is already at the top`, animating: false }, notices: [] };
  return { ok: true, value: { summary: `animating ${name}`, animating: true }, notices: [] };
}

/** Start or stop every animatable slider. */
export function animateAll(figure: Figure, on: boolean, opts: { t?: number } = {}): Result<{ summary: string; count: number }> {
  const t = opts.t ?? lastTickT(figure);
  let count = 0;
  for (const o of figure.objects()) {
    if (o.type !== 'Number' || !o.free || !o.range) continue;
    if (on) {
      if (animatingIds(figure).length >= NUMBERS_LIMITS.animating) break;
      if (startAnimation(figure, o.id, t).started) count++;
    } else if (clearAnchor(figure, o.id)) count++;
  }
  return { ok: true, value: { summary: on ? `animating ${count} sliders` : `stopped ${count} sliders`, count }, notices: [] };
}

/** Whether a slider is currently animating (finished `once` sliders report false). */
export function isAnimating(figure: Figure, name: string): boolean {
  const view = figure.get(name);
  const anchor = view ? getAnchor(figure, view.id) : undefined;
  const range = view?.range;
  if (!view || !anchor || !range) return false;
  if (loopOf(figure, view.id) === 'once') {
    const w = range.max - range.min;
    const p0 = w > 0 ? (anchor.v0 - range.min) / w : 0;
    const s = periodOf(figure, view.id) > 0 ? (lastTickT(figure) - anchor.t0) / periodOf(figure, view.id) : 0;
    return !onceFinished(p0, s);
  }
  return true;
}

/** Restore initial free values (all of them, or the listed ones). Atomic: checked first. */
export function resetObjects(figure: Figure, names?: readonly string[], opts: { by?: 'learner' | 'host' } = {}): Result<{ summary: string }> {
  ensureResetTracking(figure);
  const by = opts.by ?? 'host';
  const targets = names ?? figure.objects().filter((o) => o.free || o.type === 'Choice' || o.type === 'Input').map((o) => o.name);
  const ids: ObjId[] = [];
  for (const name of targets) {
    const view = figure.get(name);
    if (!view) return numbersError('unknown_name', { line: 0, col: 1, endCol: 1 }, { name }, { token: name });
    if (!view.free && view.type !== 'Choice' && view.type !== 'Input' && view.type !== 'Button') {
      const deps: string[] = [];
      for (const input of view.inputs) {
        const info = figure.view.byId(input);
        if (info) deps.push(info.name);
      }
      return numbersError('not_free', { line: 0, col: 1, endCol: 1 }, { name, inputs: deps.join(', ') }, { token: name });
    }
    ids.push(view.id);
  }
  for (const id of ids) {
    const view = figure.get(id);
    if (!view) continue;
    if (view.type === 'Input') {
      clearInputState(figure, id);
      emitControlEvent(figure, { event: 'change', name: view.name, type: 'Input', value: inputTextOf(figure, id), by });
      continue;
    }
    if (view.type === 'Button') continue;
    if (view.type === 'Choice') {
      const initial = initialOf(figure, id);
      const state = choiceStateOf(figure, id);
      const want = typeof initial.value === 'number' && initial.found ? initial.value : 1;
      const count = state?.count ?? 1;
      const idx = Math.min(count, Math.max(1, Math.floor(want)));
      const r = setChoiceIndex(figure, id, idx, { by });
      if (!r.ok) return r;
      continue;
    }
    const initial = initialOf(figure, id);
    if (!initial.found) continue;
    const r = figure.setFree(id, initial.value, 'api');
    if (!r.ok) return r;
  }
  figure.flush();
  return { ok: true, value: { summary: names ? `reset ${names.join(', ')}` : 'reset all' }, notices: [] };
}

/** How many Buttons, Choices and Inputs the figure holds (limit: 100, host-enforced). */
export function countControls(figure: Figure): number {
  let n = 0;
  for (const o of figure.objects()) {
    if (o.type === 'Button' || o.type === 'Choice' || o.type === 'Input') n++;
  }
  return n;
}

/** The catalogue summary of a control (`button "Reset"`, `Red (1 of 3: ...)`, ...). */
export function summarizeControl(figure: Figure, name: string): string | undefined {
  const view = figure.get(name);
  if (!view) return undefined;
  if (view.type === 'Button') return `button "${buttonLabelOf(figure, view.id)}"`;
  if (view.type === 'Choice') {
    const state = choiceStateOf(figure, view.id);
    if (!state || state.count === 0) return 'empty choice';
    const ext = (view.style.ext ?? {}) as Record<string, unknown>;
    const override = ext['captions'];
    const captions = Array.isArray(override) && override.every((x) => typeof x === 'string') ? (override as readonly string[]) : state.options.map(defaultCaption);
    const current = captions[state.index - 1] ?? '';
    return `${current} (${state.index} of ${state.count}: ${captions.join(', ')})`;
  }
  if (view.type === 'Input') {
    const target = figure.value(view.id) as { target?: number } | undefined;
    const targetName = typeof target?.target === 'number' ? figure.view.byId(target.target as ObjId)?.name ?? '?' : '?';
    return `input for ${targetName}, shows ${inputTextOf(figure, view.id)}`;
  }
  return undefined;
}

/** The selected value / index / count / options of a dropdown. */
export function choiceValueOf(figure: Figure, name: string): unknown {
  const view = figure.get(name);
  return view ? choiceStateOf(figure, view.id)?.value : undefined;
}

export function choiceIndexOf(figure: Figure, name: string): number | undefined {
  const view = figure.get(name);
  return view ? choiceStateOf(figure, view.id)?.index : undefined;
}

export function choiceCountOf(figure: Figure, name: string): number | undefined {
  const view = figure.get(name);
  return view ? choiceStateOf(figure, view.id)?.count : undefined;
}

export function choiceOptionsOf(figure: Figure, name: string): readonly unknown[] | undefined {
  const view = figure.get(name);
  return view ? choiceStateOf(figure, view.id)?.options : undefined;
}

/* ------------------------------ ranges ------------------------------ */

const BARE_NUMBER = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;

/**
 * Line-time unit check for slider bounds: on an angle-unit object, bare numeric
 * bounds (`in 0..360`) are `unit_mismatch` (the hint adds deg). Bounds that
 * mention pi, tau, a unit or a name are explicit or dynamic and pass.
 */
export function checkSliderLineUnits(
  bounds: { readonly lo: string; readonly hi: string; readonly step?: string },
  unit: 'none' | 'rad' | 'deg' | 'turn' | 'grad',
): ErrorObject | undefined {
  if (unit !== 'deg' && unit !== 'turn' && unit !== 'grad') return undefined;
  const suffix = unit === 'deg' ? 'deg' : unit;
  for (const text of [`${bounds.lo}..${bounds.hi}`, bounds.step ?? '']) {
    if (text === '') continue;
    const parts = text.split('..');
    for (const part of parts) {
      // A bare zero is the same in every unit; only nonzero bare numbers are ambiguous.
      if (BARE_NUMBER.test(part.trim()) && Number(part.trim()) !== 0) {
        return numbersError('unit_mismatch', { line: 0, col: 1, endCol: 1 }, { name: '', bounds: `${bounds.lo}..${bounds.hi}`, unit }, {
          token: `${bounds.lo}..${bounds.hi}`,
          forms: [`θ = 30${suffix} in 0${suffix}..360${suffix} step 1${suffix}`],
          hint: `Write 0${suffix}..360${suffix}.`,
        });
      }
    }
  }
  return undefined;
}

export interface SliderRange {
  readonly min?: number;
  readonly max?: number;
  readonly step?: number | 'auto';
}

/**
 * Change a slider's range later (`a with min = 0, max = 20, step = auto` in the
 * docs; the kernel has no with-to-range hook, so this applies a rerange line).
 * Missing ends keep their current value; an omitted step keeps the fixed step.
 */
export function applySliderRange(figure: Figure, name: string, range: SliderRange): Result<{ summary: string; notices: readonly Notice[] }> {
  const view = figure.get(name);
  if (!view) return numbersError('unknown_name', { line: 0, col: 1, endCol: 1 }, { name }, { token: name });
  if (view.type !== 'Number') {
    return numbersError('type_mismatch', { line: 0, col: 1, endCol: 1 }, { op: 'give a range to', left: view.type, right: 'Number' }, {
      token: name,
      hint: 'Only a Number can have a range.',
    });
  }
  if (!view.free) {
    const deps: string[] = [];
    for (const input of view.inputs) {
      const info = figure.view.byId(input);
      if (info) deps.push(info.name);
    }
    return numbersError('not_free', { line: 0, col: 1, endCol: 1 }, { name, inputs: deps.join(', ') }, { token: name });
  }
  const current = view.range;
  const lo = range.min ?? current?.min;
  const hi = range.max ?? current?.max;
  if (lo === undefined || hi === undefined) {
    return numbersError('bad_range', { line: 0, col: 1, endCol: 1 }, { why: 'a range needs a minimum and a maximum' }, {
      token: name,
      forms: [`${name} in 0..10`],
      hint: `Write ${name} in 0..10.`,
    });
  }
  const step = range.step ?? current?.step ?? 'auto';
  if (typeof step === 'number') {
    if (!(step > 0) || !Number.isFinite(step)) {
      return numbersError('bad_range', { line: 0, col: 1, endCol: 1 }, { why: 'the step must be above zero' }, { token: name });
    }
    if (!(lo < hi)) {
      return numbersError('bad_range', { line: 0, col: 1, endCol: 1 }, { why: `the range ${lo}..${hi} is empty` }, { token: `${lo}..${hi}` });
    }
    const count = (hi - lo) / step;
    if (count > NUMBERS_LIMITS.sliderSteps) {
      return numbersError('limit', { line: 0, col: 1, endCol: 1 }, { limit: 'slider_steps', max: NUMBERS_LIMITS.sliderSteps, got: count, what: 'slider steps' }, { token: name });
    }
  } else if (!(lo < hi)) {
    return numbersError('bad_range', { line: 0, col: 1, endCol: 1 }, { why: `the range ${lo}..${hi} is empty` }, { token: `${lo}..${hi}` });
  }
  const before = figure.value(name);
  const line = step === 'auto' ? `${name} in ${numberSource(lo)}..${numberSource(hi)}` : `${name} in ${numberSource(lo)}..${numberSource(hi)} step ${numberSource(step)}`;
  const r = figure.apply(line);
  if (!r.ok) return r;
  const notices: Notice[] = [...r.notices];
  const after = figure.value(name);
  if (typeof before === 'number' && typeof after === 'number' && before !== after) {
    notices.push(makeNotice('clamped', { name, value: valueText(after), end: after > before ? 'low end' : 'high end' }));
  }
  return { ok: true, value: { summary: `${name} in ${lo}..${hi}`, notices }, notices: [] };
}

/** Register every command spec of this area on a registry. */
export function registerNumbersCommands(registry: CommandRegistry): void {
  registry.registerAll(numbersCommandSpecs());
}
