/**
 * Line-level checks: definitions, functions, rates, restyle, rerange, directives and actions
 * (docs/features/language/design.md 3.8, 3.12, 3.13). Built on the expression checker.
 */
import type { Result } from '../contracts/errors';
import type { ObjId } from '../contracts/values';
import type { Expr, LineNode, NameRef, ParsedLine, Pos, RangeClause, StyleItem } from './ast';
import { Bail, Checker, FIELDS, MAX_FUNCTION_PARAMS, MAX_OBJECTS, OverlayFigure, foldNumber, literalOf } from './check';
import type { CheckOptions, CheckedLine, CheckedRange, CheckedStyle } from './check';
import { buildError, closestNames, notice, withMore } from './errors';
import type { ErrorExtra, LanguageError } from './errors';
import { nameProblem, reservedGroup, reservedGroupText } from './names';
import { printLineNode } from './printer';
import { COLOR_WORDS, DIRECTIVES, PROPERTIES, own } from './props';
import { SELF_ID } from './table';
import type { ObjectInfo } from './table';
import type { TNode } from './tnode';
import { T, fnOf, predOf, tyEq, tyStr } from './types';
import type { Ty } from './types';

void FIELDS;

type SpanLike = { s: number; e: number };

const shapeType = (shape: string): Ty => (shape === 'line' ? T.Line : shape === 'circle' ? T.Circle : shape === 'region' ? T.Region : T.Curve);

/** Check one parsed line against the figure. Nothing is changed; the result is a typed description of the line. */
export function checkLine(parsed: ParsedLine, fig: import('./table').FigureView, opts: CheckOptions = {}): Result<CheckedLine> {
  const c = new Checker(fig, parsed, opts);
  let result: Partial0 | undefined;
  try {
    result = run(c, parsed.node);
  } catch (err) {
    if (!(err instanceof Bail)) {
      return buildError('internal', 'lang.internal', { where: 'checking the line' }, parsed.line, 1, 1, '', undefined, { recovery: 'report', fingerprintKey: 'check' });
    }
  }
  if (c.errors.length > 0 || result === undefined) {
    const errs = c.errors;
    if (errs.length === 0) return c.err('internal', 0, 0, 'lang.internal', { where: 'checking the line' }, { recovery: 'report' }) ?? errs[0] as LanguageError;
    return withMore(errs[0] as LanguageError, errs.slice(1));
  }
  const checked: CheckedLine = {
    ...result,
    line: parsed.line,
    text: printLineNode(parsed.node),
    source: parsed.source,
    reads: [...c.reads],
    usesT: c.usesT,
    ...(c.rangeReads.size > 0 ? { rangeReads: [...c.rangeReads] } : {}),
    ...(c.styleReads.size > 0 ? { styleReads: [...c.styleReads] } : {}),
    ...(c.styleUsesT ? { styleUsesT: true } : {}),
    ...(c.rangeUsesT ? { rangeUsesT: true } : {}),
    slots: c.slotCount,
  };
  return { ok: true, value: checked, notices: c.notices };
}

type Partial0 = Omit<CheckedLine, 'line' | 'text' | 'source' | 'reads' | 'usesT' | 'rangeReads' | 'styleReads' | 'styleUsesT' | 'rangeUsesT' | 'slots'>;

function run(c: Checker, node: LineNode): Partial0 | undefined {
  switch (node.k) {
    case 'noop':
      return { kind: 'noop', op: 'noop', names: [], free: false, isState: false };
    case 'directive':
      return checkDirective(c, node);
    case 'define':
      return checkDefine(c, node);
    case 'defmany':
      return checkDefMany(c, node);
    case 'function':
      return checkFunction(c, node);
    case 'rate':
      return checkRate(c, node);
    case 'restyle':
      return checkRestyle(c, node);
    case 'rerange':
      return checkRerange(c, node);
    case 'action':
      return checkAction(c, node);
  }
}

/* --------------------------------- names --------------------------------- */

function validateTarget(c: Checker, t: NameRef, rhsFieldHint?: string): boolean {
  const why = nameProblem(t.name);
  if (why) {
    c.err('bad_name', t.s, t.e, 'lang.bad_name', { name: t.name, why }, {
      hint: `Use letters, digits and _, starting with a letter; at most 32 characters.`,
      fingerprintKey: t.name,
    });
    return false;
  }
  const group = reservedGroup(t.name, c.fig.commands, c.functions);
  if (group) {
    const alts: string[] = [];
    if (rhsFieldHint && !reservedGroup(rhsFieldHint, c.fig.commands, c.functions) && !c.fig.lookup(rhsFieldHint)) alts.push(rhsFieldHint);
    let k = 1;
    while (alts.length < 2) {
      const cand = `${t.name}_${k++}`;
      if (!c.fig.lookup(cand)) alts.push(cand);
    }
    const useField = rhsFieldHint !== undefined && alts[0] === rhsFieldHint;
    const sugg = alts.map((a) => c.replaceRange(t.s, t.e, a));
    c.err('reserved_name', t.s, t.e, 'lang.reserved_name', { name: t.name, group: reservedGroupText(group) }, {
      hint: `Pick another name, such as ${alts[0]}.`,
      suggest: sugg,
      ...(useField ? { fix: sugg[0] as string } : {}),
      fingerprintKey: t.name,
    });
    return false;
  }
  return true;
}

function fieldHint(expr: Expr): string | undefined {
  if (expr.k === 'field' && expr.target.k === 'name') return expr.target.name.toLowerCase() + expr.field;
  return undefined;
}

/* ------------------------------- redefinition ------------------------------- */

function sameKind(old: Ty, neu: Ty): boolean {
  if (old.k !== neu.k) return false;
  if (old.k === 'Function') return old.ret === neu.ret;
  return tyEq(old, neu);
}

/**
 * Depth-first search from `from` along `inputsOf` for `target`. Iterative, so the stack depth does not grow with the
 * chain length; the path is read off the explicit stack only when the target is found.
 */
function findPath(c: Checker, from: Iterable<ObjId>, target: ObjId): ObjId[] | undefined {
  const seen = new Set<ObjId>();
  for (const first of from) {
    if (first === target) return [first];
    if (seen.has(first)) continue;
    seen.add(first);
    const ids: ObjId[] = [first];
    const iters: Iterator<ObjId>[] = [c.fig.inputsOf(first)[Symbol.iterator]()];
    while (iters.length > 0) {
      const step = (iters[iters.length - 1] as Iterator<ObjId>).next();
      if (step.done) {
        iters.pop();
        ids.pop();
        continue;
      }
      const nx = step.value;
      if (nx === target) return [...ids, nx];
      if (seen.has(nx)) continue;
      seen.add(nx);
      ids.push(nx);
      iters.push(c.fig.inputsOf(nx)[Symbol.iterator]());
    }
  }
  return undefined;
}

/**
 * Cycle test (ruling SM-23): the value's reads and the range bounds' reads count as edges. Style edges never join the
 * test (kernel design 9.2: nothing reads a style). Only the value's reads decide free versus dependent. Reports `cycle` and returns true when `target` is reachable.
 */
function checkCycle(c: Checker, target: NameRef, existing: ObjectInfo, lineSpan: SpanLike): boolean {
  if (c.opts.skipGraphChecks) return false;
  const path = findPath(c, [...c.reads, ...c.rangeReads], existing.id);
  if (!path) return false;
  const names = [target.name, ...path.map((id) => c.fig.byId(id)?.name ?? String(id))];
  if (names[names.length - 1] !== target.name) names.push(target.name);
  const related = path
    .slice(0, -1)
    .map((id) => {
      const o = c.fig.byId(id);
      return `${o?.name ?? id}${o?.source ? ' is defined by ' + o.source : ''}`;
    });
  c.err('cycle', lineSpan.s, lineSpan.e, 'lang.cycle', { name: target.name, path: names.join(' -> ') }, {
    path: names,
    related,
    hint: 'Break the loop by making one of them a plain number.',
    fingerprintKey: names.join('>'),
  });
  return true;
}

function checkRedefinition(c: Checker, target: NameRef, existing: ObjectInfo | undefined, newTy: Ty, lineSpan: SpanLike, pending = 0): void {
  if (!existing) {
    const maxObjects = c.opts.limits?.objects ?? MAX_OBJECTS;
    if (c.fig.size !== undefined && c.fig.size + pending >= maxObjects) {
      c.err('limit', target.s, target.e, 'lang.limit', { limit: 'objects', max: maxObjects, got: c.fig.size + pending + 1, what: 'objects in a figure' }, {
        hint: 'Delete objects you no longer need, or build the shape from fewer objects.',
        limit: { name: 'objects', max: maxObjects, got: c.fig.size + pending + 1 },
        fingerprintKey: 'objects',
      });
    }
    return;
  }
  if (!sameKind(existing.type, newTy)) {
    // what Delete would take with it: every object that reads this one, directly or not
    const takes: string[] = [];
    const seen = new Set<ObjId>([existing.id]);
    for (let i = -1; i < takes.length && takes.length < 50; i++) {
      for (const d of c.fig.dependentsOf(i < 0 ? existing.id : (c.fig.lookup(takes[i] as string)?.id as ObjId))) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        takes.push(d.name);
      }
    }
    let fresh = target.name;
    for (let n = 2; n < 1000; n++) {
      fresh = `${target.name}${n}`;
      if (!c.fig.lookup(fresh)) break;
    }
    const removes = takes.length > 0 ? ` (this removes ${takes.length} object${takes.length === 1 ? '' : 's'} that use${takes.length === 1 ? 's' : ''} ${target.name}: ${takes.slice(0, 8).join(', ')}${takes.length > 8 ? ', …' : ''})` : '';
    c.err('type_change', lineSpan.s, lineSpan.e, 'lang.type_change', { name: target.name, from: tyStr(existing.type), to: tyStr(newTy) }, {
      hint: `Pick a new name, or Delete(${target.name}) first${removes}.`,
      suggest: [c.replaceRange(target.s, target.e, fresh)],
      left: tyStr(existing.type),
      right: tyStr(newTy),
      fingerprintKey: `${target.name}:${tyStr(existing.type)}:${tyStr(newTy)}`,
    });
    return;
  }
  if (c.opts.skipGraphChecks) return;
  if (checkCycle(c, target, existing, lineSpan)) return;
  // dependents
  const deps = c.fig.dependentsOf(existing.id);
  const rules = c.fig.styleRulesReading?.(existing.id) ?? [];
  if (deps.length === 0 && rules.length === 0) return;
  const info: ObjectInfo = { ...existing, type: newTy };
  const overlay = new OverlayFigure(c.fig, new Map([[target.name, info]]));
  const broken: string[] = [];
  const names: string[] = [];
  for (const d of deps) {
    if (!d.source) continue;
    const p = parseOne(d.source);
    if (!p) continue;
    const r = checkLine(p, overlay, { skipGraphChecks: true });
    if (!r.ok) {
      broken.push(`${d.name}: ${d.source} would be a ${r.kind} error`);
      names.push(d.name);
    } else if (r.value.type && !tyEq(r.value.type, d.type) && !(r.value.type.k === 'Function' && d.type.k === 'Function' && r.value.type.ret === d.type.ret)) {
      broken.push(`${d.name}: ${d.source} would change from ${tyStr(d.type)} to ${tyStr(r.value.type)}`);
      names.push(d.name);
    }
  }
  // separate property rules that read the object (`P with opacity = f(1)`) are re-checked the same way
  for (const r of c.fig.styleRulesReading?.(existing.id) ?? []) {
    const p = parseOne(r.source);
    if (!p) continue;
    const res = checkLine(p, overlay, { skipGraphChecks: true });
    if (!res.ok) {
      broken.push(`${r.name}: ${r.source} would be a ${res.kind} error`);
      if (!names.includes(r.name)) names.push(r.name);
    }
  }
  if (broken.length > 0) {
    c.err('breaks_dependents', lineSpan.s, lineSpan.e, 'lang.breaks_dependents', { name: target.name, n: broken.length }, {
      related: broken,
      hint: `Redefine ${names.join(', ')} first, or name the new definition differently.`,
      recovery: 'choose',
      fingerprintKey: target.name,
    });
  }
}

import { parseLine as parseSource } from './parser';
function parseOne(source: string): ParsedLine | undefined {
  const r = parseSource(source);
  return r.ok ? r.value : undefined;
}

/* --------------------------------- ranges --------------------------------- */

/** The most steps a slider's range may hold (numbers-sliders design 3.9). */
const MAX_SLIDER_STEPS = 1_000_000;

function checkRange(c: Checker, r: RangeClause, initial: TNode | undefined): CheckedRange | undefined {
  const from = c.infer(r.from);
  const to = c.infer(r.to);
  const step = r.step ? c.infer(r.step) : undefined;
  if (!from || !to || (r.step && !step)) return undefined;
  for (const [b, label] of [[from, 'lower bound'], [to, 'upper bound'], ...(step ? [[step, 'step']] : [])] as [TNode, string][]) {
    if (b.ty.k !== 'Number') {
      c.err('bad_range', b.s, b.e, 'lang.bad_range', { why: `The ${label} of a range must be a Number, not a ${tyStr(b.ty)}` }, {
        forms: ['Name = value in min..max [step s]'],
        hint: 'Write numbers or number expressions on both sides of ..',
        fingerprintKey: label,
      });
      return undefined;
    }
  }
  const lo = foldNumber(from);
  const hi = foldNumber(to);
  const st = step ? foldNumber(step) : undefined;
  const forms = ['Name = value in min..max [step s]'];
  if (lo !== undefined && hi !== undefined) {
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      c.err('bad_range', r.s, r.e, 'lang.bad_range', { why: 'A slider range needs finite bounds' }, { forms, hint: 'Pick a finite bound; a slider cannot reach inf.', fingerprintKey: 'infinite' });
      return undefined;
    }
    if (lo >= hi) {
      const suggest = lo > hi ? [c.replaceRange(r.from.s, r.to.e, `${c.textOf(r.to)}..${c.textOf(r.from)}`)] : [];
      c.err('bad_range', r.from.s, r.to.e, 'lang.bad_range', { why: `The range ${c.textOf(r.from)}..${c.textOf(r.to)} is empty`, min: lo, max: hi, ...(st !== undefined ? { step: st } : {}) }, {
        forms,
        suggest,
        hint: 'The lower bound must be below the upper bound.',
        fingerprintKey: 'empty',
      });
      return undefined;
    }
    // a step larger than the range is allowed: only the two ends are left (numbers design 4)
    if (st !== undefined && (st <= 0 || !Number.isFinite(st))) {
      c.err('bad_range', step!.s, step!.e, 'lang.bad_range', { why: st <= 0 ? 'The step must be above zero' : 'The step must be a finite number', min: lo, max: hi, step: st }, {
        forms,
        hint: 'Use a finite step above 0.',
        fingerprintKey: 'step',
      });
      return undefined;
    }
    if (st !== undefined && (hi - lo) / st > MAX_SLIDER_STEPS) {
      const got = Math.floor((hi - lo) / st);
      c.err('limit', r.s, r.e, 'lang.limit', { limit: 'slider_steps', max: MAX_SLIDER_STEPS, got, what: 'slider steps' }, {
        limit: { name: 'slider_steps', max: MAX_SLIDER_STEPS, got },
        hint: `Use a larger step or a shorter range: at most ${MAX_SLIDER_STEPS} steps fit on a slider.`,
        fingerprintKey: 'slider_steps',
      });
      return undefined;
    }
    const iv = initial ? foldNumber(initial) : undefined;
    if (iv !== undefined && Number.isFinite(iv) && (iv < lo || iv > hi)) {
      const clamped = Math.min(hi, Math.max(lo, iv));
      c.warn(notice('clamped', 'warning', `The value ${iv} is outside ${lo}..${hi} and will be clamped to ${clamped}.`, { value: iv, min: lo, max: hi, ...c.spanOf(initial!.s, initial!.e) }));
    }
  } else if (st !== undefined && st <= 0) {
    c.err('bad_range', step!.s, step!.e, 'lang.bad_range', { why: 'The step must be above zero' }, { forms, fingerprintKey: 'step' });
    return undefined;
  }
  return {
    from,
    to,
    ...(step ? { step } : {}),
    ...(lo !== undefined ? { min: lo } : {}),
    ...(hi !== undefined ? { max: hi } : {}),
    ...(st !== undefined ? { stepValue: st } : {}),
  };
}

/* --------------------------------- styles --------------------------------- */

function hexWord(w: string): boolean {
  return /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(w);
}

function checkStyle(c: Checker, items: readonly StyleItem[], ty?: Ty): CheckedStyle[] {
  const out: CheckedStyle[] = [];
  const perType = ty !== undefined && c.opts.propertyKeys !== undefined ? c.opts.propertyKeys(ty.k) : undefined;
  const keys = perType ?? Object.keys(PROPERTIES);
  for (const it of items) {
    // each property rule keeps its own reads (kernel design 9.2: a property rule is an edge from its inputs), so a
    // later rule for the same property can drop exactly the edges of the rule it replaces
    const outer = c.reads;
    c.reads = new Set<ObjId>();
    const from = out.length;
    try {
      checkStyleItem(c, it, keys, out, ty, perType !== undefined);
      const reads = [...c.reads];
      for (let i = from; i < out.length; i++) out[i] = { ...(out[i] as CheckedStyle), reads };
    } finally {
      for (const id of c.reads) outer.add(id);
      c.reads = outer;
    }
  }
  return out;
}

function checkStyleItem(c: Checker, it: StyleItem, keys: readonly string[], out: CheckedStyle[], ty: Ty | undefined, perType: boolean): void {
  const spec = own(PROPERTIES, it.key);
  if (!spec || (perType && !keys.includes(it.key))) {
    const close = closestNames(it.key, keys, perType ? 1 : 3);
    c.err('unknown_property', it.ks, it.ke, 'lang.unknown_property', { type: ty?.k ?? 'An object', key: it.key }, {
      expected: keys,
      ...(perType ? { uncapped: true } : {}),
      hint: close.length > 0 ? (perType ? `Did you mean ${close.join(' or ')}?` : `Did you mean ${close.join(' or ')}? Properties: ${keys.join(', ')}.`) : `Properties: ${keys.join(', ')}.`,
      suggest: close.slice(0, 2).map((k) => c.replaceRange(it.ks, it.ke, k)),
      fingerprintKey: it.key,
    });
    return;
  }
  const v = it.value;
  const bad = (suggest?: string): void => {
    const extra: ErrorExtra = { hint: `${it.key} must be ${spec.allowed}.`, fingerprintKey: it.key, recovery: 'fix_line' };
    if (spec.values) extra.expected = spec.values;
    if (suggest !== undefined) extra.suggest = [suggest];
    c.err('bad_property_value', v.s, v.e, 'lang.bad_property_value', { key: it.key, allowed: spec.allowed, token: c.textOf(v) }, extra);
  };
  // a call in a position that takes a plain word still gets checked, so an action there says it is an action
  if ((spec.kind === 'bool' || spec.kind === 'enum') && v.k === 'call' && !c.infer(v)) return;
  const unboundWord = v.k === 'name' && !c.lookupLocal(v.name) && !c.fig.lookup(v.name) && !CONSTANT_LIKE.has(v.name);
  switch (spec.kind) {
    case 'bool':
      if (v.k !== 'bool') bad();
      else out.push({ key: it.key, value: { n: 'bool', v: v.v, ty: T.Bool, s: v.s, e: v.e } });
      break;
    case 'enum':
      if (v.k === 'name' && spec.values?.includes(v.name)) out.push({ key: it.key, value: { word: v.name } });
      else bad(v.k === 'name' && spec.values ? closestNames(v.name, spec.values, 1).map((x) => c.replaceRange(v.s, v.e, x))[0] : undefined);
      break;
    case 'int':
    case 'number': {
      const n = c.infer(v);
      if (!n) break;
      if (n.ty.k !== 'Number') {
        bad();
        break;
      }
      const lit = foldNumber(n);
      if (lit !== undefined) {
        const lo = spec.min ?? -Infinity;
        const hi = spec.max ?? Infinity;
        if (lit < lo || lit > hi || (spec.kind === 'int' && !Number.isInteger(lit))) {
          const near = Math.min(hi, Math.max(lo, spec.kind === 'int' ? Math.round(lit) : lit));
          bad(c.replaceRange(v.s, v.e, String(near)));
          break;
        }
      } else if (!spec.expr) {
        bad();
        break;
      }
      out.push({ key: it.key, value: n });
      break;
    }
    case 'text': {
      const n = c.infer(v);
      if (!n) break;
      if (n.ty.k !== 'Text') bad();
      else out.push({ key: it.key, value: n });
      break;
    }
    case 'boolexpr': {
      const n = c.infer(v);
      if (!n) break;
      if (n.ty.k !== 'Bool') bad();
      else out.push({ key: it.key, value: n });
      break;
    }
    case 'color': {
      if (v.k === 'name' && (COLOR_WORDS.includes(v.name) || hexWord(v.name) || unboundWord)) {
        if (COLOR_WORDS.includes(v.name) || hexWord(v.name)) out.push({ key: it.key, value: { word: v.name } });
        else {
          const close = closestNames(v.name, COLOR_WORDS, 1);
          bad(close[0] ? c.replaceRange(v.s, v.e, close[0]) : undefined);
        }
        break;
      }
      const n = c.infer(v);
      if (!n) break;
      if (n.ty.k !== 'Color' && n.ty.k !== 'Number') bad();
      else out.push({ key: it.key, value: n });
      break;
    }
    case 'textlist': {
      const n = c.infer(v);
      if (!n) break;
      if (!(n.ty.k === 'List' && n.ty.of?.k === 'Text')) bad();
      else out.push({ key: it.key, value: n });
      break;
    }
  }
}

const CONSTANT_LIKE: ReadonlySet<string> = new Set(['pi', 'tau', 'e', 'deg', 'inf', 't', 'bt', 'beat']);

/* ------------------------------- definitions ------------------------------- */

function lineSpan(c: Checker, node: { target: NameRef }, end: number): SpanLike {
  return { s: node.target.s, e: Math.max(end, node.target.e) + 0 * c.text.length };
}

function checkDefine(c: Checker, node: Extract<LineNode, { k: 'define' }>): Partial0 | undefined {
  const t = node.target;
  const expr = node.expr;
  validateTarget(c, t, fieldHint(expr));
  c.ctx = { name: t.name, rhsStart: expr.s, rhsEnd: expr.e, defineLine: true };

  let tn: TNode | null;
  let isState = false;
  let state: { initial: TNode; velocity?: TNode } | undefined;
  if (expr.k === 'call' && expr.callee === 'state' && !c.lookupLocal('state')) {
    const r = checkState(c, expr);
    tn = r?.node ?? null;
    state = r?.state;
    isState = true;
  } else if (c.relationCapable(expr) && c.freeVars(expr).size > 0) {
    tn = c.buildRelation(expr);
  } else {
    tn = c.infer(expr);
  }

  let range: CheckedRange | undefined;
  if (node.range) {
    if (tn && tn.ty.k !== 'Number') {
      c.err('type_mismatch', node.range.s, node.range.e, 'lang.type_mismatch_where', { why: `Only a Number can have a range, but ${t.name} is a ${tyStr(tn.ty)}` }, {
        left: tyStr(tn.ty),
        hint: 'Remove the in clause, or make the value a Number.',
        fingerprintKey: 'range_type',
      });
    } else {
      const rangeClause = node.range;
      range = c.apart('range', () => checkRange(c, rangeClause, tn ?? undefined));
    }
  }
  const existing = c.fig.lookup(t.name);
  // Q-R4-1: in the `with` list of a first definition the name being defined is the new object
  const ownTy = tn ? (tn.n === 'relation' ? shapeType(tn.shape) : tn.ty) : undefined;
  const self: ObjectInfo | undefined = ownTy && !existing ? { id: SELF_ID, name: t.name, type: ownTy, free: false, ...(tn?.unit ? { unit: tn.unit } : {}) } : undefined;
  const style = node.style ? c.apart('style', () => c.withSelf(self, () => checkStyle(c, node.style as readonly StyleItem[], ownTy ?? existing?.type))) : undefined;
  c.styleReads.delete(SELF_ID);
  if (!tn) return undefined;

  const type = tn.n === 'relation' ? shapeType(tn.shape) : tn.ty;
  if (c.errors.length === 0) {
    checkRedefinition(c, t, existing, type, lineSpan(c, node, expr.e));
    if (existing && existing.type.k === 'Number' && type.k === 'Number' && existing.slider && !node.range && !isFreeNode(c, tn)) {
      // a slider redefined as a dependent number loses its range: allowed, nothing to check
    }
  }
  const free = isFreeNode(c, tn) && !isState;
  return {
    kind: 'define',
    op: existing ? 'redefine' : 'add',
    names: [t.name],
    type,
    ...(tn.unit ? { unit: tn.unit } : {}),
    free,
    isState,
    ...(existing ? { existing: existing.id } : {}),
    expr: tn,
    ...(range ? { range } : {}),
    ...(style ? { style } : {}),
    ...(state ? { state } : {}),
    ...(tn.n === 'relation' ? { shape: tn.shape } : {}),
  };
}

function isFreeNode(c: Checker, tn: TNode): boolean {
  return c.reads.size === 0 && !c.usesT && !c.hasCommand && tn.n !== 'relation' && tn.ty.k !== 'Function';
}

function checkState(c: Checker, call: Expr & { k: 'call' }): { node: TNode; state: { initial: TNode; velocity?: TNode } } | null {
  if (call.args.length < 1 || call.args.length > 2 || call.args.some((a) => a.name !== undefined)) {
    return c.err('arg_count', call.s, call.e, 'lang.arg_count', { name: 'state', n: '1 or 2', m: call.args.length }, {
      forms: ['state(initial) -> Number | Point', 'state(initial, velocity) -> Number | Point'],
      hint: 'Write θ = state(0.6), or θ = state(0.6, 0) for a second-order state.',
      fingerprintKey: 'state',
    });
  }
  const init = c.infer((call.args[0] as { value: Expr }).value);
  const vel = call.args[1] ? c.infer(call.args[1].value) : undefined;
  if (!init || (call.args[1] && !vel)) return null;
  if (init.ty.k !== 'Number' && init.ty.k !== 'Point') {
    return c.err('type_mismatch', init.s, init.e, 'lang.type_mismatch_where', { why: `A state holds a Number or a Point, not a ${tyStr(init.ty)}` }, {
      left: tyStr(init.ty),
      fingerprintKey: 'state',
    });
  }
  if (vel && vel.ty.k !== init.ty.k && !(init.ty.k === 'Point' && vel.ty.k === 'Vector')) {
    return c.err('type_mismatch', vel.s, vel.e, 'lang.type_mismatch_where', { why: `The velocity of a ${tyStr(init.ty)} state must be a ${init.ty.k === 'Point' ? 'Vector' : 'Number'}, not a ${tyStr(vel.ty)}` }, {
      left: tyStr(init.ty),
      right: tyStr(vel.ty),
      fingerprintKey: 'state_velocity',
    });
  }
  return { node: init, state: { initial: init, ...(vel ? { velocity: vel } : {}) } };
}

function checkDefMany(c: Checker, node: Extract<LineNode, { k: 'defmany' }>): Partial0 | undefined {
  for (const t of node.targets) validateTarget(c, t);
  const seen = new Set<string>();
  for (const t of node.targets) {
    if (seen.has(t.name)) {
      c.err('duplicate_param', t.s, t.e, 'lang.duplicate_param', { name: t.name }, { hint: 'Each result needs its own name.', fingerprintKey: t.name });
    }
    seen.add(t.name);
  }
  c.ctx = { name: node.targets[0]?.name, rhsStart: node.expr.s, rhsEnd: node.expr.e, defineLine: false };
  if (node.expr.k !== 'call' || !/^[A-Z]/.test(node.expr.callee)) {
    c.err('type_mismatch', node.expr.s, node.expr.e, 'lang.type_mismatch_where', { why: `Several names on the left need a command that returns that many results` }, {
      hint: 'Write A, B = Intersect(c, d), or name one object per line.',
      fingerprintKey: 'defmany',
    });
    return undefined;
  }
  const tn = c.infer(node.expr);
  if (!tn || tn.n !== 'command') return undefined;
  const tuple = tn.tuple ?? [tn.ty];
  if (tuple.length !== node.targets.length) {
    c.err('type_mismatch', node.expr.s, node.expr.e, 'lang.type_mismatch_where', { why: `${tn.spec.name} returns ${tuple.length} result${tuple.length === 1 ? '' : 's'}, but ${node.targets.length} names are given` }, {
      hint: tuple.length === 1 ? `Name one object: ${node.targets[0]?.name} = ${c.textOf(node.expr)}.` : `Give ${tuple.length} names.`,
      fingerprintKey: `${tn.spec.name}:${tuple.length}:${node.targets.length}`,
    });
    return undefined;
  }
  if (c.errors.length > 0) return undefined;
  let existingId: ObjId | undefined;
  let pending = 0;
  node.targets.forEach((t, i) => {
    const ex = c.fig.lookup(t.name);
    if (ex && existingId === undefined) existingId = ex.id;
    checkRedefinition(c, t, ex, tuple[i] as Ty, { s: node.targets[0]!.s, e: node.expr.e }, pending);
    if (!ex) pending++;
  });
  return {
    kind: 'defmany',
    op: existingId !== undefined ? 'redefine' : 'add',
    names: node.targets.map((t) => t.name),
    type: tuple[0] as Ty,
    types: tuple,
    free: false,
    isState: false,
    ...(existingId !== undefined ? { existing: existingId } : {}),
    expr: tn,
  };
}

/**
 * A function line that makes a curve (curves-loci design 5 and 6): an equation in `x, y` is an implicit curve and a pair
 * with a range is a parametric curve. Both are checked as the `Curve` command they stand for. `undefined` when the line
 * is an ordinary function line; `null` when it failed.
 */
function curveLine(c: Checker, node: Extract<LineNode, { k: 'function' }>): Partial0 | null | undefined {
  const e = node.expr;
  const names = node.params.map((p) => p.name);
  const asCurve = (args: readonly Expr[]): Partial0 | null => {
    const call: Expr = { k: 'call', callee: 'Curve', cs: e.s, ce: e.s, args: args.map((value) => ({ value })), open: e.s, close: e.e, s: e.s, e: e.e };
    return checkDefine(c, { k: 'define', target: node.target, expr: call, ...(node.style ? { style: node.style } : {}) }) ?? null;
  };
  if (e.k === 'cmp' && e.paren !== true && e.ops.length === 1 && e.ops[0] === '==' && !node.domain) {
    if (names.length === 1) {
      validateTarget(c, node.target);
      const [l, r] = [c.textOf(e.operands[0] as Expr), c.textOf(e.operands[1] as Expr)];
      c.err('bad_argument', e.s, e.e, 'lang.bad_argument', { command: node.target.name, why: 'an equation in one variable gives isolated numbers, not a curve' }, {
        hint: `For the numbers where it holds, write g(${names[0]}) = ${l} - (${r}) and then Roots(g, a, b). A curve needs two variables: ${node.target.name}(x, y) = … == ….`,
        fingerprintKey: 'equation_one_variable',
      });
      return null;
    }
    if (names.length === 2 && names[0] === 'x' && names[1] === 'y' && c.fig.commands.lookup('Curve')) return asCurve([e]);
    return undefined;
  }
  const range = node.domain?.[0];
  if (e.k === 'tuple' && e.items.length === 2 && names.length === 1 && range && node.domain?.length === 1 && c.fig.commands.lookup('Curve')) {
    const p = node.params[0] as NameRef;
    return asCurve([e.items[0] as Expr, e.items[1] as Expr, { k: 'name', name: p.name, s: p.s, e: p.e }, range.from, range.to]);
  }
  return undefined;
}

function checkFunction(c: Checker, node: Extract<LineNode, { k: 'function' }>): Partial0 | undefined {
  const t = node.target;
  const curve = curveLine(c, node);
  if (curve !== undefined) return curve ?? undefined;
  validateTarget(c, t);
  c.ctx = { name: t.name, rhsStart: node.expr.s, rhsEnd: node.expr.e, defineLine: false };
  if (node.params.length > MAX_FUNCTION_PARAMS) {
    c.err('limit', node.params[MAX_FUNCTION_PARAMS]!.s, node.params[node.params.length - 1]!.e, 'lang.limit', { limit: 'function_params', max: MAX_FUNCTION_PARAMS, got: node.params.length, what: 'parameters' }, {
      limit: { name: 'function_params', max: MAX_FUNCTION_PARAMS, got: node.params.length },
      fingerprintKey: 'function_params',
    });
    return undefined;
  }
  const frame = c.pushFrame();
  const params: { name: string; slot: number }[] = [];
  const seen = new Set<string>();
  let ok = true;
  for (const p of node.params) {
    if (seen.has(p.name)) {
      c.err('duplicate_param', p.s, p.e, 'lang.duplicate_param', { name: p.name }, { hint: `Give each parameter a different name.`, fingerprintKey: p.name });
      ok = false;
      continue;
    }
    seen.add(p.name);
    const why = nameProblem(p.name);
    if (why) {
      c.err('bad_name', p.s, p.e, 'lang.bad_name', { name: p.name, why }, { fingerprintKey: p.name });
      ok = false;
      continue;
    }
    const group = reservedGroup(p.name, c.fig.commands, c.functions);
    if (group && !['x', 'y', 't'].includes(p.name)) {
      c.err('reserved_name', p.s, p.e, 'lang.reserved_name', { name: p.name, group: reservedGroupText(group) }, {
        hint: `Pick another parameter name, such as ${p.name}_1. Only x, y and t may be reused as parameters.`,
        suggest: [c.replaceRange(p.s, p.e, `${p.name}_1`)],
        fingerprintKey: p.name,
      });
      ok = false;
      continue;
    }
    const slot = c.bindLocal(frame, p.name, T.Number, p.s, p.e);
    params.push({ name: p.name, slot });
  }
  let body: TNode | null;
  try {
    body = c.infer(node.expr);
  } finally {
    c.popFrame();
  }
  // the interval of each parameter: its ends are plain expressions, read outside the parameters
  let domain: { from: TNode; to: TNode }[] | undefined;
  if (node.domain) {
    domain = [];
    if (node.domain.length !== node.params.length) {
      const d = node.domain[Math.min(node.domain.length, node.params.length)] ?? (node.domain[node.domain.length - 1] as Pos);
      c.err('bad_range', d.s, d.e, 'lang.bad_range', { why: `${t.name} has ${node.params.length} parameter${node.params.length === 1 ? '' : 's'}, and the line gives ${node.domain.length} range${node.domain.length === 1 ? '' : 's'}` }, {
        hint: `Give one range for each parameter, separated by commas: in ${node.params.map(() => '0..1').join(', ')}.`,
        fingerprintKey: 'domain_count',
      });
      ok = false;
    }
    for (const d of node.domain) {
      const from = c.infer(d.from);
      const to = c.infer(d.to);
      for (const end of [from, to]) {
        if (end && end.ty.k !== 'Number') {
          c.err('type_mismatch', end.s, end.e, 'lang.type_mismatch_where', { why: `The end of a range is a Number, but this is a ${tyStr(end.ty)}` }, { left: tyStr(end.ty), fingerprintKey: tyStr(end.ty) });
          ok = false;
        }
      }
      if (!from || !to) {
        ok = false;
        continue;
      }
      const lo = literalOf(from);
      const hi = literalOf(to);
      if (typeof lo === 'number' && typeof hi === 'number' && lo > hi) {
        c.err('bad_range', d.s, d.e, 'lang.bad_range', { why: `The range runs backwards, from ${lo} down to ${hi}` }, { hint: `Write the low end first: ${hi}..${lo}.`, fingerprintKey: 'domain_backwards' });
        ok = false;
      }
      domain.push({ from, to });
    }
  }
  const existing = c.fig.lookup(t.name);
  const isPredicate = body !== null && body.ty.k === 'Bool' && (params.length === 1 || params.length === 2);
  const typeOf = (b: TNode): Ty => (b.ty.k === 'Bool' ? predOf(params.length as 1 | 2) : fnOf(b.ty.k === 'Point' ? 'Point' : 'Number', params.length));
  const ownTy = body && ok && (body.ty.k === 'Number' || body.ty.k === 'Point' || isPredicate) ? typeOf(body) : undefined;
  const self: ObjectInfo | undefined = ownTy && !existing ? { id: SELF_ID, name: t.name, type: ownTy, free: false } : undefined;
  const style = node.style ? c.apart('style', () => c.withSelf(self, () => checkStyle(c, node.style as readonly StyleItem[], ownTy ?? existing?.type))) : undefined;
  c.styleReads.delete(SELF_ID);
  if (!body || !ok) return undefined;
  if (body.ty.k !== 'Number' && body.ty.k !== 'Point' && !isPredicate) {
    c.err('type_mismatch', body.s, body.e, 'lang.type_mismatch_where', { why: `A function returns a Number or a Point, but this is a ${tyStr(body.ty)}` }, {
      left: tyStr(body.ty),
      hint: body.ty.k === 'Bool' ? 'A condition takes one or two parameters, such as p(x) = x > 1. Use if(condition, a, b) to choose between numbers.' : 'Write an expression in the parameters that gives a number or a point (x, y).',
      fingerprintKey: tyStr(body.ty),
    });
    return undefined;
  }
  const type = typeOf(body);
  if (c.errors.length === 0) checkRedefinition(c, t, existing, type, { s: t.s, e: node.expr.e });
  if (c.errors.length > 0) return undefined;
  return {
    kind: 'function',
    op: existing ? 'redefine' : 'add',
    names: [t.name],
    type,
    ...(body.unit ? { unit: body.unit } : {}),
    free: false,
    isState: false,
    ...(existing ? { existing: existing.id } : {}),
    expr: body,
    params,
    ...(domain && domain.length > 0 ? { domain } : {}),
    ...(style ? { style } : {}),
  };
}

function checkRate(c: Checker, node: Extract<LineNode, { k: 'rate' }>): Partial0 | undefined {
  const t = node.target;
  const obj = c.fig.lookup(t.name);
  c.ctx = { name: t.name, rhsStart: node.expr.s, rhsEnd: node.expr.e, defineLine: false };
  if (!obj) {
    const blocked = c.opts.failed?.get(t.name);
    c.err('unknown_name', t.s, t.e, 'lang.unknown_name', { name: t.name }, {
      hint: `Declare it first: ${t.name} = state(0).`,
      suggest: [`${t.name} = state(0)`],
      ...(blocked ? { blockedBy: { line: blocked.line, kind: blocked.kind }, after: blocked.line, recovery: 'fix_earlier' as const } : {}),
      fingerprintKey: t.name,
    });
    c.infer(node.expr);
    return undefined;
  }
  const rhs = c.infer(node.expr);
  if (!obj.state) {
    c.err('bad_argument', t.s, t.e, 'lang.bad_argument', { command: `${t.name}'`, why: `${t.name} is not a state` }, {
      hint: `Declare it first: ${t.name} = state(0).`,
      fingerprintKey: t.name,
    });
    return undefined;
  }
  if (!rhs) return undefined;
  const want = obj.type.k;
  const okType = rhs.ty.k === want || (want === 'Point' && rhs.ty.k === 'Vector');
  if (!okType) {
    c.err('type_mismatch', rhs.s, rhs.e, 'lang.type_mismatch_where', { why: `The rate of the ${tyStr(obj.type)} state ${t.name} must be a ${want === 'Point' ? 'Vector or Point' : 'Number'}, not a ${tyStr(rhs.ty)}` }, {
      left: tyStr(obj.type),
      right: tyStr(rhs.ty),
      fingerprintKey: `${want}:${rhs.ty.k}`,
    });
    return undefined;
  }
  if (node.order > 2) {
    c.err('limit', t.e, t.e + node.order, 'lang.limit', { limit: 'rate_order', max: 2, got: node.order, what: 'derivative marks' }, {
      limit: { name: 'rate_order', max: 2, got: node.order },
      fingerprintKey: 'rate_order',
    });
    return undefined;
  }
  return {
    kind: 'rate',
    op: 'rate',
    names: [t.name],
    free: false,
    isState: false,
    expr: rhs,
    rate: { target: obj.id, name: t.name, order: node.order },
  };
}

function checkRestyle(c: Checker, node: Extract<LineNode, { k: 'restyle' }>): Partial0 | undefined {
  const t = node.target;
  const obj = c.fig.lookup(t.name);
  if (!obj) {
    c.unknownNameAt(t);
    return undefined;
  }
  const style = c.apart('style', () => checkStyle(c, node.style, obj.type));
  if (c.errors.length > 0) return undefined;
  return { kind: 'restyle', op: 'restyle', names: [t.name], type: obj.type, free: false, isState: false, existing: obj.id, style };
}

function checkRerange(c: Checker, node: Extract<LineNode, { k: 'rerange' }>): Partial0 | undefined {
  const t = node.target;
  const obj = c.fig.lookup(t.name);
  if (!obj) {
    c.unknownNameAt(t);
    return undefined;
  }
  if (obj.type.k !== 'Number') {
    c.err('type_mismatch', t.s, t.e, 'lang.type_mismatch_where', { why: `Only a Number can have a range, but ${t.name} is a ${tyStr(obj.type)}` }, { left: tyStr(obj.type), fingerprintKey: 'rerange' });
    return undefined;
  }
  if (obj.free === false) {
    c.err('not_free', t.s, t.e, 'lang.type_mismatch_where', { why: `${t.name} is computed from other objects, so it has no slider range` }, {
      hint: `Redefine it as a plain number first: ${t.name} = 1 ${c.textOf(node.range)}.`,
      fingerprintKey: t.name,
    });
    return undefined;
  }
  const range = c.apart('range', () => checkRange(c, node.range, undefined));
  if (!range) return undefined;
  checkCycle(c, t, obj, { s: t.s, e: Math.max(t.e, node.range.e) });
  if (c.errors.length > 0) return undefined;
  return { kind: 'rerange', op: 'rerange', names: [t.name], type: obj.type, free: true, isState: false, existing: obj.id, range };
}

function checkAction(c: Checker, node: Extract<LineNode, { k: 'action' }>): Partial0 | undefined {
  const call = node.expr;
  const spec = c.fig.commands.lookup(call.callee);
  if (spec && spec.kind === 'object') {
    const ret = spec.forms[0]?.returns;
    const rt: Ty = typeof ret === 'string' ? ({ k: ret.replace(/<.*$/, '').replace(/^=.*/, 'Number') } as Ty) : T.Number;
    const taken = new Set(c.fig.names());
    const name = suggestNameFor(rt, taken, c);
    const text = c.text.trim();
    c.err('unnamed_object', call.s, call.e, 'lang.unnamed_object', { line: text, name }, {
      hint: `Give it a name, for example ${name} = ${text}.`,
      suggest: [`${name} = ${text}`],
      fingerprintKey: call.callee,
    });
    return undefined;
  }
  c.ctx = {};
  c.actionCall = call;
  const tn = c.infer(call);
  c.actionCall = null;
  if (!tn || tn.n !== 'command') return undefined;
  return { kind: 'action', op: 'action', names: [], free: false, isState: false, expr: tn };
}

import { suggestName } from './names';
function suggestNameFor(t: Ty, taken: Set<string>, c: Checker): string {
  return suggestName(t, taken, { commands: c.fig.commands, functions: c.functions });
}

/* -------------------------------- directives -------------------------------- */

function checkDirective(c: Checker, node: Extract<LineNode, { k: 'directive' }>): Partial0 | undefined {
  const known = [...Object.keys(DIRECTIVES), ...(c.fig.directives ?? [])];
  const forms = own(DIRECTIVES, node.name);
  if (!forms && !(c.fig.directives ?? []).includes(node.name)) {
    const close = closestNames(node.name, known, 3);
    c.err('unknown_directive', node.ns - 1, node.ne, 'lang.unknown_directive', { token: '@' + node.name }, {
      expected: known.slice(0, 8).map((k) => '@' + k),
      hint: close.length > 0 ? `Did you mean ${close.map((k) => '@' + k).join(' or ')}?` : `Directives: ${known.map((k) => '@' + k).join(' ')}.`,
      suggest: close.slice(0, 2).map((k) => c.replaceRange(node.ns, node.ne, k)),
      fingerprintKey: node.name,
    });
    return undefined;
  }
  const words = node.words;
  const bad = (need: string): undefined => {
    c.err('bad_directive', node.ns - 1, words.length > 0 ? (words[words.length - 1] as { e: number }).e : node.ne, 'lang.bad_directive', { directive: '@' + node.name, need }, {
      forms: forms ? [...forms] : [],
      hint: `Write ${(forms ?? [`@${node.name} …`])[0]}.`,
      fingerprintKey: node.name,
    });
    return undefined;
  };
  switch (node.name) {
    case 'view': {
      if (words.length === 1 && words[0]?.text === 'home') break;
      if (words.length < 4 || words.slice(0, 4).some((w) => w.num === undefined)) return bad('four numbers: x0 x1 y0 y1');
      const [x0, x1, y0, y1] = words.slice(0, 4).map((w) => w.num as number) as [number, number, number, number];
      if (x0 >= x1 || y0 >= y1) return bad('x0 < x1 and y0 < y1');
      break;
    }
    case 'grid':
    case 'axes':
    case 'snap':
      if (words.length < 1) return bad('on, off, or an option');
      if ((node.name === 'axes' || node.name === 'snap') && !['on', 'off'].includes(words[0]?.text ?? '')) return bad('on or off');
      break;
    case 'beat':
      if (words.length < 1) return bad('an id and an optional "title"');
      break;
    case 'tol':
    case 'tolerance':
      if (words.length !== 1 || words[0]?.num === undefined || !(words[0].num > 0) || !Number.isFinite(words[0].num)) return bad('a positive number like 1e-9');
      break;
    case 'clock':
      if (words.length !== 1 || !/^\d+(?:\.\d+)?\.\.\d+(?:\.\d+)?$/.test(words[0]?.text ?? '')) return bad('a range like 0..30');
      {
        const [a, b] = (words[0] as { text: string }).text.split('..').map(Number) as [number, number];
        if (a >= b) return bad('a range with start before end');
      }
      break;
    default:
      break;
  }
  return {
    kind: 'directive',
    op: 'directive',
    names: [],
    free: false,
    isState: false,
    directive: { name: node.name, words: words.map((w) => w.str ?? w.text) },
  };
}
