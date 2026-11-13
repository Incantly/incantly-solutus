/**
 * List commands (design 4.1 to 4.6): build, test and total, reorder, cut and join, sets, lists of points.
 * Positions are 1-based; negative positions count from the end (README decision 1).
 */
import type { Pt } from '../../contracts/values';
import type { CommandRule, RuleCall } from '../../graph/registry';
import type { Env } from '../../language/runtime';
import type { CommandForm, CommandSpec, ParamSpec, Refusal } from '../../language/table';
import { MAX_LIST, isPt, itemsOf, listFrom, record, sameValue } from './types';

/* ------------------------------ spec helpers ------------------------------ */

const p = (name: string, type: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ name, type, ...extra });
const body = (name: string, type = 'Any'): ParamSpec => ({ name, type, kind: 'body' });
const binder = (name: string, type: string): ParamSpec => ({ name, type, kind: 'binder' });

type Run = (call: RuleCall) => unknown;

function form(params: readonly ParamSpec[], returns: string, run: Run, summary: string, extra: Partial<CommandForm> = {}): CommandForm {
  const rule = (): CommandRule => ({ run });
  return { params, returns, rule, summary, ...extra };
}

const spec = (name: string, forms: readonly CommandForm[]): CommandSpec => ({ name, kind: 'object', group: 'lists', forms });

/* ------------------------------ argument helpers ------------------------------ */

const num = (call: RuleCall, i: number): number | undefined => {
  const v = call.values[i];
  return typeof v === 'number' && v === v ? v : undefined;
};

const list = (call: RuleCall, i: number): unknown[] | undefined => itemsOf(call.values[i]);

/** The type of the elements of a list argument, from its checked tree. */
function elemNumeric(call: RuleCall, i: number): boolean {
  const v = call.values[i];
  if (v instanceof Float64Array) return true;
  const ty = call.args[i]?.tree?.ty;
  return ty?.k === 'List' && ty.of?.k === 'Number';
}

const out = (items: readonly unknown[], numeric: boolean): unknown => listFrom(items, numeric);

/** Whole number from 0 to the list limit, or the reason. */
function count(call: RuleCall, n: number | undefined, what: string): number | undefined {
  if (n === undefined) return call.fail('input_undefined', `${what} is undefined`);
  if (!Number.isInteger(n) || n < 0) return call.fail('not_integer', `${what} must be a whole number from 0, not ${n}`);
  if (n > MAX_LIST) return call.fail('too_large', `${what} is ${n}; a list holds at most ${MAX_LIST.toLocaleString('en')} elements`);
  return n;
}

/** A position, 1-based or negative from the end, as a 0-based index; undefined when outside. */
function at(pos: number, len: number): number | undefined {
  if (!Number.isInteger(pos) || pos === 0) return undefined;
  const i = pos > 0 ? pos - 1 : len + pos;
  return i >= 0 && i < len ? i : undefined;
}

/**
 * Evaluates a body argument with its binders set: `slots` are the binders' local slots in order. Returns the value, or
 * `undefined` with the body's reason in `why`.
 */
function evaluator(call: RuleCall, bodyIdx: number, slots: readonly (number | undefined)[]): ((vals: readonly unknown[]) => { v: unknown; why?: string }) | undefined {
  const ev = call.args[bodyIdx]?.eval;
  if (!ev || slots.some((s) => s === undefined)) return undefined;
  const env: Env = call.env;
  return (vals) => {
    const saved = slots.map((s) => env.locals[s as number]);
    const sr = env.reason;
    const sd = env.detail;
    const sc = env.cause;
    for (let k = 0; k < slots.length; k++) env.locals[slots[k] as number] = vals[k];
    env.reason = undefined;
    env.detail = undefined;
    env.cause = undefined;
    let v: unknown;
    try {
      v = ev(env);
    } catch {
      v = undefined;
    }
    const why = env.reason;
    for (let k = 0; k < slots.length; k++) env.locals[slots[k] as number] = saved[k];
    env.reason = sr;
    env.detail = sd;
    env.cause = sc;
    const undef = v === undefined || (typeof v === 'number' && v !== v);
    return undef ? { v: undefined, why: why ?? 'input_undefined' } : { v };
  };
}

const slotOf = (call: RuleCall, i: number): number | undefined => call.args[i]?.slot;

/** Runs a body over values and builds the list; an undefined element makes the list undefined (language 3.10). */
function build(call: RuleCall, bodyIdx: number, slots: readonly (number | undefined)[], inputs: (k: number) => readonly unknown[], n: number): unknown {
  const f = evaluator(call, bodyIdx, slots);
  if (!f) return call.fail('input_undefined', 'the expression could not run');
  const numeric = call.args[bodyIdx]?.tree?.ty.k === 'Number';
  if (numeric) {
    const outN = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      if ((k & 1023) === 1023 && !call.work.spend(1024)) return call.fail('timeout', `stopped after ${k} elements`);
      const r = f(inputs(k));
      if (r.why !== undefined) return call.fail('has_undefined', `element ${k + 1} is undefined (${r.why})`);
      outN[k] = r.v as number;
    }
    return outN;
  }
  const items: unknown[] = [];
  for (let k = 0; k < n; k++) {
    if ((k & 1023) === 1023 && !call.work.spend(1024)) return call.fail('timeout', `stopped after ${k} elements`);
    const r = f(inputs(k));
    if (r.why !== undefined) return call.fail('has_undefined', `element ${k + 1} is undefined (${r.why})`);
    items.push(r.v);
  }
  return items;
}

/** The count of a stepped range (design 4.1): `floor((to - from) / step + 1e-9) + 1`, zero when the sign is wrong. */
function rangeCount(call: RuleCall, from: number, to: number, step: number): number | undefined {
  if (step === 0 || !Number.isFinite(step)) return call.fail('bad_step', `step is ${step}`);
  const q = (to - from) / step;
  if (q < -1e-9) return 0;
  const n = Math.floor(q + 1e-9) + 1;
  if (n > MAX_LIST) return call.fail('too_large', `${n} elements; a list holds at most ${MAX_LIST.toLocaleString('en')}`);
  return n;
}

/* ------------------------------ check-time hooks ------------------------------ */

/** A literal count above the limit is `limit` at check time (errors 5). */
const literalCount = (...idx: number[]) => (c: { args: readonly { literal: unknown }[] }): Refusal | undefined => {
  for (const i of idx) {
    const v = c.args[i]?.literal;
    if (typeof v === 'number' && v > MAX_LIST) {
      return { kind: 'limit', message: `A list holds at most ${MAX_LIST.toLocaleString('en')} elements; this asks for ${v}.`, param: i, limit: { name: 'list_length', max: MAX_LIST, got: v }, hint: 'Use fewer elements, or a step.' };
    }
  }
  return undefined;
};

/** A literal `from`/`to`/`step` triple with too many elements. */
const literalRange = (fi: number, ti: number, si?: number) => (c: { args: readonly { literal: unknown }[] }): Refusal | undefined => {
  const from = c.args[fi]?.literal;
  const to = c.args[ti]?.literal;
  const step = si === undefined ? 1 : (c.args[si]?.literal ?? (c.args[si] === undefined ? 1 : undefined));
  if (typeof from !== 'number' || typeof to !== 'number' || typeof step !== 'number' || step === 0) return undefined;
  const n = Math.floor((to - from) / step + 1e-9) + 1;
  if (n > MAX_LIST) return { kind: 'limit', message: `A list holds at most ${MAX_LIST.toLocaleString('en')} elements; this range has ${n}.`, param: ti, limit: { name: 'list_length', max: MAX_LIST, got: n }, hint: 'Use a larger step or a shorter range.' };
  return undefined;
};

const ORDER_WORDS = ['up', 'down'] as const;
const literalOrder = (i: number) => (c: { args: readonly { literal: unknown; text: string }[] }): Refusal | undefined => {
  const v = c.args[i]?.literal;
  if (typeof v === 'string' && !(ORDER_WORDS as readonly string[]).includes(v)) {
    return { kind: 'bad_option', message: `The order must be "up" or "down", not "${v}".`, param: i, hint: 'Write Sort(xs, "down") for largest first.', params: { command: 'Sort', why: `The order must be "up" or "down", not "${v}".` } };
  }
  return undefined;
};

/* ------------------------------ build ------------------------------ */

function runSeqBody(call: RuleCall): unknown {
  const from = num(call, 2);
  const to = num(call, 3);
  const step = call.args[4] && !call.args[4].omitted ? num(call, 4) : 1;
  if (from === undefined || to === undefined || step === undefined) return call.fail('input_undefined', 'a bound is undefined');
  const n = rangeCount(call, from, to, step);
  if (n === undefined) return undefined;
  return build(call, 0, [slotOf(call, 1)], (k) => [from + k * step], n);
}

function runSeqN(call: RuleCall): unknown {
  const n = count(call, num(call, 0), 'the count');
  if (n === undefined) return undefined;
  const o = new Float64Array(n);
  for (let k = 0; k < n; k++) o[k] = k + 1;
  return o;
}

function runRange(call: RuleCall): unknown {
  const from = num(call, 0);
  const to = num(call, 1);
  const step = call.args[2] && !call.args[2].omitted ? num(call, 2) : 1;
  if (from === undefined || to === undefined || step === undefined) return call.fail('input_undefined', 'a bound is undefined');
  const n = rangeCount(call, from, to, step);
  if (n === undefined) return undefined;
  const o = new Float64Array(n);
  for (let k = 0; k < n; k++) o[k] = from + k * step;
  return o;
}

function runRepeat(call: RuleCall): unknown {
  const n = count(call, num(call, 1), 'the count');
  if (n === undefined) return undefined;
  const x = call.values[0];
  if (typeof x === 'number') return new Float64Array(n).fill(x);
  return Array.from({ length: n }, () => x);
}

function runLinspace(call: RuleCall): unknown {
  const a = num(call, 0);
  const b = num(call, 1);
  const n = count(call, num(call, 2), 'the count');
  if (a === undefined || b === undefined || n === undefined) return undefined;
  if (n === 0) return call.fail('bad_argument', 'Linspace needs at least one point');
  const o = new Float64Array(n);
  if (n === 1) o[0] = a;
  else for (let k = 0; k < n; k++) o[k] = k === n - 1 ? b : a + ((b - a) * k) / (n - 1);
  return o;
}

function runMap(call: RuleCall): unknown {
  const xs = list(call, 0);
  if (!xs) return call.fail('input_undefined', 'the list is undefined');
  return build(call, 2, [slotOf(call, 1)], (k) => [xs[k]], xs.length);
}

/** Zip(expr, a, listA, b, listB, …): one output per index; unequal lengths are `size_mismatch`. */
function runZip(pairs: number) {
  return (call: RuleCall): unknown => {
    const lists: unknown[][] = [];
    const slots: (number | undefined)[] = [];
    for (let k = 0; k < pairs; k++) {
      const l = list(call, 2 + 2 * k);
      if (!l) return call.fail('input_undefined', `list ${k + 1} is undefined`);
      lists.push(l);
      slots.push(slotOf(call, 1 + 2 * k));
    }
    const n = (lists[0] as unknown[]).length;
    const lens = lists.map((l) => l.length);
    if (lens.some((l) => l !== n)) return call.fail('size_mismatch', `lengths ${lens.join(' and ')}`);
    return build(call, 0, slots, (i) => lists.map((l) => l[i]), n);
  };
}

/** Fold and Scan: `acc` starts at `init`; for each element `v` the next `acc` is `expr`. */
function runFold(all: boolean) {
  return (call: RuleCall): unknown => {
    const xs = list(call, 0);
    if (!xs) return call.fail('input_undefined', 'the list is undefined');
    const f = evaluator(call, 4, [slotOf(call, 1), slotOf(call, 2)]);
    if (!f) return call.fail('input_undefined', 'the expression could not run');
    let acc = call.values[3];
    const steps: unknown[] = [];
    for (let k = 0; k < xs.length; k++) {
      const r = f([acc, xs[k]]);
      if (r.why !== undefined) return call.fail('has_undefined', `step ${k + 1} is undefined (${r.why})`);
      acc = r.v;
      if (all) steps.push(acc);
    }
    return all ? out(steps, typeof call.values[3] === 'number') : acc;
  };
}

function runIterate(all: boolean) {
  return (call: RuleCall): unknown => {
    const n = count(call, num(call, 3), 'the number of steps');
    if (n === undefined) return undefined;
    const f = evaluator(call, 0, [slotOf(call, 1)]);
    if (!f) return call.fail('input_undefined', 'the expression could not run');
    let x = call.values[2];
    const seq: unknown[] = [x];
    for (let k = 0; k < n; k++) {
      if ((k & 1023) === 1023 && !call.work.spend(1024)) return call.fail('timeout', `stopped after ${k} steps`);
      const r = f([x]);
      if (r.why !== undefined) return call.fail('has_undefined', `step ${k + 1} is undefined (${r.why})`);
      x = r.v;
      if (all) seq.push(x);
    }
    return all ? out(seq, typeof call.values[2] === 'number') : x;
  };
}

/** IterateList(expr, a, b, first, second, n): next = expr(a, b) with a the older term; n further terms. */
function runIterate2(call: RuleCall): unknown {
  const n = count(call, num(call, 5), 'the number of steps');
  if (n === undefined) return undefined;
  const f = evaluator(call, 0, [slotOf(call, 1), slotOf(call, 2)]);
  if (!f) return call.fail('input_undefined', 'the expression could not run');
  const seq: unknown[] = [call.values[3], call.values[4]];
  for (let k = 0; k < n; k++) {
    const r = f([seq[seq.length - 2], seq[seq.length - 1]]);
    if (r.why !== undefined) return call.fail('has_undefined', `term ${k + 3} is undefined (${r.why})`);
    seq.push(r.v);
  }
  return out(seq, typeof call.values[3] === 'number');
}

/* ------------------------------ test, count, total ------------------------------ */

function runCount(call: RuleCall): unknown {
  const xs = list(call, 0);
  if (!xs) return call.fail('input_undefined', 'the list is undefined');
  if (call.args.length < 3 || call.args[2]?.omitted) return xs.length;
  const f = evaluator(call, 2, [slotOf(call, 1)]);
  if (!f) return call.fail('input_undefined', 'the condition could not run');
  let c = 0;
  for (let k = 0; k < xs.length; k++) {
    const r = f([xs[k]]);
    if (r.why !== undefined) return call.fail('has_undefined', `the condition is undefined for element ${k + 1} (${r.why})`);
    if (r.v === true) c++;
  }
  return c;
}

function runFilter(call: RuleCall): unknown {
  const xs = list(call, 0);
  if (!xs) return call.fail('input_undefined', 'the list is undefined');
  const f = evaluator(call, 2, [slotOf(call, 1)]);
  if (!f) return call.fail('input_undefined', 'the condition could not run');
  const keep: unknown[] = [];
  for (let k = 0; k < xs.length; k++) {
    const r = f([xs[k]]);
    if (r.why !== undefined) return call.fail('has_undefined', `the condition is undefined for element ${k + 1} (${r.why})`);
    if (r.v === true) keep.push(xs[k]);
  }
  return out(keep, elemNumeric(call, 0));
}

function runContains(call: RuleCall): unknown {
  const xs = list(call, 0);
  if (!xs) return call.fail('input_undefined', 'the list is undefined');
  const x = call.values[1];
  return xs.some((y) => sameValue(x, y));
}

function runIndexOf(call: RuleCall): unknown {
  const xs = list(call, 1);
  if (!xs) return call.fail('input_undefined', 'the list is undefined');
  const x = call.values[0];
  const from = call.args[2] && !call.args[2].omitted ? num(call, 2) : 1;
  if (from === undefined || !Number.isInteger(from)) return call.fail('not_integer', 'the start must be a whole number');
  const start = from > 0 ? from - 1 : Math.max(0, xs.length + from);
  for (let k = start; k < xs.length; k++) if (sameValue(x, xs[k])) return k + 1;
  return 0;
}

/** Neumaier compensated sum (design 8.1). */
export function compensatedSum(xs: ArrayLike<number>): number {
  let s = 0;
  let c = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i] as number;
    const t = s + x;
    if (Math.abs(s) >= Math.abs(x)) c += s - t + x;
    else c += x - t + s;
    s = t;
  }
  return s + c;
}

function total(call: RuleCall, xs: readonly unknown[], numeric: boolean): unknown {
  if (numeric || xs.every((x) => typeof x === 'number')) {
    const s = compensatedSum(xs as number[]);
    return Number.isFinite(s) ? s : call.fail('not_finite', `the sum is ${s}`);
  }
  if (xs.every((x) => typeof x === 'string')) return (xs as string[]).join('');
  if (xs.every(isPt)) {
    return { x: compensatedSum((xs as Pt[]).map((q) => q.x)), y: compensatedSum((xs as Pt[]).map((q) => q.y)) };
  }
  return call.fail('bad_argument', 'Sum adds numbers, points, vectors or texts');
}

function runSum(call: RuleCall): unknown {
  const xs = list(call, 0);
  if (!xs) return call.fail('input_undefined', 'the list is undefined');
  if (xs.length === 0) return elemNumeric(call, 0) || call.args[0]?.tree?.ty.of?.k === undefined ? 0 : call.args[0]?.tree?.ty.of?.k === 'Text' ? '' : call.args[0]?.tree?.ty.of?.k === 'Number' ? 0 : { x: 0, y: 0 };
  return total(call, xs, elemNumeric(call, 0));
}

function runSumOf(product: boolean) {
  return (call: RuleCall): unknown => {
    const xs = list(call, 0);
    if (!xs) return call.fail('input_undefined', 'the list is undefined');
    const f = evaluator(call, 2, [slotOf(call, 1)]);
    if (!f) return call.fail('input_undefined', 'the expression could not run');
    const vals: unknown[] = [];
    for (let k = 0; k < xs.length; k++) {
      const r = f([xs[k]]);
      if (r.why !== undefined) return call.fail('has_undefined', `the term for element ${k + 1} is undefined (${r.why})`);
      vals.push(r.v);
    }
    if (product) return prod(call, vals as number[]);
    if (vals.length === 0) return call.args[2]?.tree?.ty.k === 'Point' || call.args[2]?.tree?.ty.k === 'Vector' ? { x: 0, y: 0 } : call.args[2]?.tree?.ty.k === 'Text' ? '' : 0;
    return total(call, vals, call.args[2]?.tree?.ty.k === 'Number');
  };
}

function prod(call: RuleCall, xs: readonly number[]): unknown {
  let s = 1;
  for (const x of xs) s *= x;
  return Number.isFinite(s) ? s : call.fail('not_finite', `the product is ${s}`);
}

function runProduct(call: RuleCall): unknown {
  const xs = list(call, 0);
  if (!xs) return call.fail('input_undefined', 'the list is undefined');
  return prod(call, xs as number[]);
}

function cmp(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') {
    if (a !== a) return b !== b ? 0 : 1;
    if (b !== b) return -1;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (isPt(a) && isPt(b)) return cmp(a.x, b.x) || cmp(a.y, b.y);
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return 0;
}

function extreme(sign: 1 | -1, index: boolean) {
  return (call: RuleCall): unknown => {
    const xs = list(call, 0);
    if (!xs) return call.fail('input_undefined', 'the list is undefined');
    if (xs.length === 0) return call.fail('empty_list', 'the list has no elements');
    let best = 0;
    for (let k = 1; k < xs.length; k++) if (sign * cmp(xs[k], xs[best]) > 0) best = k;
    return index ? best + 1 : xs[best];
  };
}

function runCumSum(call: RuleCall): unknown {
  const xs = call.values[0];
  if (!(xs instanceof Float64Array)) return call.fail('input_undefined', 'the list is undefined');
  const o = new Float64Array(xs.length);
  let s = 0;
  let c = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i] as number;
    const t = s + x;
    if (Math.abs(s) >= Math.abs(x)) c += s - t + x;
    else c += x - t + s;
    s = t;
    o[i] = s + c;
  }
  return o;
}

function runDiff(call: RuleCall): unknown {
  const xs = call.values[0];
  if (!(xs instanceof Float64Array)) return call.fail('input_undefined', 'the list is undefined');
  const o = new Float64Array(Math.max(0, xs.length - 1));
  for (let i = 1; i < xs.length; i++) o[i - 1] = (xs[i] as number) - (xs[i - 1] as number);
  return o;
}

/* ------------------------------ reorder ------------------------------ */

function orderOf(call: RuleCall, i: number): 1 | -1 | undefined {
  if (!call.args[i] || call.args[i]?.omitted) return 1;
  const v = call.values[i];
  if (v === 'up') return 1;
  if (v === 'down') return -1;
  call.fail('bad_argument', `the order must be "up" or "down", not ${String(v)}`);
  return undefined;
}

function sortBy(call: RuleCall, xs: readonly unknown[], keys: readonly unknown[], dir: 1 | -1): unknown {
  const idx = xs.map((_, i) => i);
  // stable; undefined numbers last in either order
  idx.sort((a, b) => {
    const ka = keys[a];
    const kb = keys[b];
    const na = typeof ka === 'number' && ka !== ka;
    const nb = typeof kb === 'number' && kb !== kb;
    if (na || nb) return na === nb ? a - b : na ? 1 : -1;
    return dir * cmp(ka, kb) || a - b;
  });
  if (idx.every((v, i) => v === i) && call.values[0] !== undefined) return call.values[0];
  return out(idx.map((i) => xs[i]), elemNumeric(call, 0));
}

function runSort(withKey: boolean, withOrder: boolean) {
  return (call: RuleCall): unknown => {
    const xs = list(call, 0);
    if (!xs) return call.fail('input_undefined', 'the list is undefined');
    const dir = withOrder ? orderOf(call, withKey ? 3 : 1) : 1;
    if (dir === undefined) return undefined;
    if (!withKey) return sortBy(call, xs, xs, dir);
    const f = evaluator(call, 2, [slotOf(call, 1)]);
    if (!f) return call.fail('input_undefined', 'the key could not run');
    const keys: unknown[] = [];
    for (let k = 0; k < xs.length; k++) {
      const r = f([xs[k]]);
      if (r.why !== undefined) return call.fail('has_undefined', `the key of element ${k + 1} is undefined (${r.why})`);
      keys.push(r.v);
    }
    return sortBy(call, xs, keys, dir);
  };
}

function runReverse(call: RuleCall): unknown {
  const xs = list(call, 0);
  if (!xs) return call.fail('input_undefined', 'the list is undefined');
  return out(xs.slice().reverse(), elemNumeric(call, 0));
}

/** A small seeded generator (mulberry32): the same seed gives the same order everywhere. */
function seeded(seed: number): () => number {
  let a = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function runShuffle(call: RuleCall): unknown {
  const xs = list(call, 0);
  if (!xs) return call.fail('input_undefined', 'the list is undefined');
  const seed = call.args[1] && !call.args[1].omitted ? num(call, 1) : 0;
  if (seed === undefined) return call.fail('input_undefined', 'the seed is undefined');
  const rnd = seeded(seed);
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return out(a, elemNumeric(call, 0));
}

function canon(x: unknown): string {
  if (typeof x === 'number') return Object.is(x, -0) ? 'n0' : `n${x}`;
  if (typeof x === 'string') return `s${x}`;
  if (typeof x === 'boolean') return `b${x}`;
  if (isPt(x)) return `p${canon(x.x)},${canon(x.y)}`;
  const items = itemsOf(x);
  if (items) return `[${items.map(canon).join(';')}]`;
  return `o${JSON.stringify(x)}`;
}

function runUnique(call: RuleCall): unknown {
  const xs = list(call, 0);
  if (!xs) return call.fail('input_undefined', 'the list is undefined');
  const tolGiven = call.args[1] && !call.args[1].omitted;
  if (tolGiven) {
    const tol = num(call, 1);
    if (tol === undefined || tol < 0) return call.fail('bad_argument', 'the tolerance must be a number from 0');
    // numbers within tol of the first kept one merge; order of first occurrence is kept
    const order = xs.map((_, i) => i).sort((a, b) => cmp(xs[a], xs[b]) || a - b);
    const keep = new Set<number>();
    let group: number[] = [];
    const flush = (): void => {
      if (group.length > 0) keep.add(Math.min(...group));
      group = [];
    };
    for (const i of order) {
      if (group.length > 0 && Math.abs((xs[i] as number) - (xs[group[0] as number] as number)) > tol) flush();
      group.push(i);
    }
    flush();
    return out(xs.filter((_, i) => keep.has(i)), elemNumeric(call, 0));
  }
  const seen = new Set<string>();
  const kept: unknown[] = [];
  for (const x of xs) {
    const k = canon(x);
    if (seen.has(k)) continue;
    seen.add(k);
    kept.push(x);
  }
  if (kept.length === xs.length) return call.values[0];
  return out(kept, elemNumeric(call, 0));
}

function runTally(call: RuleCall): unknown {
  const xs = list(call, 0);
  if (!xs) return call.fail('input_undefined', 'the list is undefined');
  const counts = new Map<string, { v: unknown; n: number }>();
  for (const x of xs) {
    const k = canon(x);
    const e = counts.get(k);
    if (e) e.n++;
    else counts.set(k, { v: x, n: 1 });
  }
  const entries = [...counts.values()].sort((a, b) => cmp(a.v, b.v));
  return record('Tally', { values: out(entries.map((e) => e.v), elemNumeric(call, 0)), counts: Float64Array.from(entries.map((e) => e.n)) });
}

/* ------------------------------ cut, grow, join ------------------------------ */

function end(last: boolean) {
  return (call: RuleCall): unknown => {
    const xs = list(call, 0);
    if (!xs) return call.fail('input_undefined', 'the list is undefined');
    if (xs.length === 0) return call.fail('empty_list', 'the list has no elements');
    return last ? xs[xs.length - 1] : xs[0];
  };
}

function runHeadTail(tail: boolean) {
  return (call: RuleCall): unknown => {
    const xs = list(call, 0);
    const n = num(call, 1);
    if (!xs || n === undefined) return call.fail('input_undefined', 'an argument is undefined');
    if (!Number.isInteger(n) || n < 0) return call.fail('not_integer', `the count must be a whole number from 0, not ${n}`);
    return out(tail ? xs.slice(Math.max(0, xs.length - n)) : xs.slice(0, n), elemNumeric(call, 0));
  };
}

function runRest(call: RuleCall): unknown {
  const xs = list(call, 0);
  if (!xs) return call.fail('input_undefined', 'the list is undefined');
  return out(xs.slice(1), elemNumeric(call, 0));
}

function runSlice(call: RuleCall): unknown {
  const xs = list(call, 0);
  const a = num(call, 1);
  const b = num(call, 2);
  if (!xs || a === undefined || b === undefined) return call.fail('input_undefined', 'an argument is undefined');
  if (!Number.isInteger(a) || !Number.isInteger(b)) return call.fail('not_integer', 'positions must be whole numbers');
  const len = xs.length;
  // negative counts from the end; clamps to the list
  const lo = Math.max(0, a > 0 ? a - 1 : a < 0 ? len + a : 0);
  const hi = Math.min(len - 1, b > 0 ? b - 1 : b < 0 ? len + b : -1);
  return out(hi >= lo ? xs.slice(lo, hi + 1) : [], elemNumeric(call, 0));
}

function runAppend(call: RuleCall): unknown {
  const xs = list(call, 0);
  if (!xs) return call.fail('input_undefined', 'the list is undefined');
  if (xs.length + 1 > MAX_LIST) return call.fail('too_large', `a list holds at most ${MAX_LIST} elements`);
  return out([...xs, call.values[1]], elemNumeric(call, 0) || (xs.length === 0 && typeof call.values[1] === 'number'));
}

function runPrepend(call: RuleCall): unknown {
  const xs = list(call, 1);
  if (!xs) return call.fail('input_undefined', 'the list is undefined');
  return out([call.values[0], ...xs], elemNumeric(call, 1) || (xs.length === 0 && typeof call.values[0] === 'number'));
}

function runInsert(many: boolean) {
  return (call: RuleCall): unknown => {
    const xs = list(call, 1);
    const pos = num(call, 2);
    if (!xs || pos === undefined) return call.fail('input_undefined', 'an argument is undefined');
    if (!Number.isInteger(pos) || pos === 0) return call.fail('not_integer', 'the position must be a whole number, not 0');
    // pos is the position the first inserted item will have; negative counts from the end
    const i = pos > 0 ? pos - 1 : xs.length + 1 + pos;
    if (i < 0 || i > xs.length) return call.fail('index_out_of_range', `the list has ${xs.length} elements, asked for position ${pos}`);
    const add = many ? (itemsOf(call.values[0]) ?? []) : [call.values[0]];
    return out([...xs.slice(0, i), ...add, ...xs.slice(i)], elemNumeric(call, 1));
  };
}

function runRemove(call: RuleCall): unknown {
  const xs = list(call, 0);
  if (!xs) return call.fail('input_undefined', 'the list is undefined');
  return out(xs.filter((y) => !sameValue(y, call.values[1])), elemNumeric(call, 0));
}

function runRemoveAt(call: RuleCall): unknown {
  const xs = list(call, 0);
  const pos = num(call, 1);
  if (!xs || pos === undefined) return call.fail('input_undefined', 'an argument is undefined');
  const i = at(pos, xs.length);
  if (i === undefined) return call.fail('index_out_of_range', `the list has ${xs.length} elements, asked for ${pos}`);
  return out([...xs.slice(0, i), ...xs.slice(i + 1)], elemNumeric(call, 0));
}

function runRemoveUndefined(call: RuleCall): unknown {
  const xs = list(call, 0);
  if (!xs) return call.fail('input_undefined', 'the list is undefined');
  const ok = (v: unknown): boolean => v !== undefined && !(typeof v === 'number' && v !== v) && !(isPt(v) && (v.x !== v.x || v.y !== v.y));
  return out(xs.filter(ok), elemNumeric(call, 0));
}

function runJoin(call: RuleCall): unknown {
  const parts: unknown[][] = [];
  for (let i = 0; i < call.values.length; i++) {
    const l = list(call, i);
    if (!l) return call.fail('input_undefined', `list ${i + 1} is undefined`);
    parts.push(l);
  }
  const all = parts.flat();
  if (all.length > MAX_LIST) return call.fail('too_large', `${all.length} elements; a list holds at most ${MAX_LIST}`);
  return out(all, elemNumeric(call, 0));
}

function runJoinLists(call: RuleCall): unknown {
  const ls = list(call, 0);
  if (!ls) return call.fail('input_undefined', 'the list is undefined');
  const parts = ls.map((l) => itemsOf(l) ?? []);
  const all = parts.flat();
  const ty = call.args[0]?.tree?.ty;
  return out(all, ls[0] instanceof Float64Array || (ty?.of?.k === 'List' && ty.of.of?.k === 'Number'));
}

/* ------------------------------ sets ------------------------------ */

function runSet(kind: 'union' | 'intersection' | 'difference') {
  return (call: RuleCall): unknown => {
    const a = list(call, 0);
    const b = list(call, 1);
    if (!a || !b) return call.fail('input_undefined', 'a list is undefined');
    const tolGiven = call.args[2] && !call.args[2].omitted;
    const tol = tolGiven ? num(call, 2) : undefined;
    if (tolGiven && (tol === undefined || tol < 0)) return call.fail('bad_argument', 'the tolerance must be a number from 0');
    const same = (x: unknown, y: unknown): boolean => (tol !== undefined && typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) <= tol : sameValue(x, y));
    const inB = (x: unknown): boolean => (tol === undefined ? bKeys.has(canon(x)) : b.some((y) => same(x, y)));
    const bKeys = new Set(b.map(canon));
    const result: unknown[] = [];
    const has = (x: unknown): boolean => result.some((y) => same(x, y));
    if (kind === 'union') {
      for (const x of [...a, ...b]) if (!has(x)) result.push(x);
    } else if (kind === 'intersection') {
      for (const x of a) if (inB(x) && !has(x)) result.push(x);
    } else {
      for (const x of a) if (!inB(x) && !has(x)) result.push(x);
    }
    return out(result, elemNumeric(call, 0));
  };
}

/* ------------------------------ lists of points ------------------------------ */

function runPoints(call: RuleCall): unknown {
  const xs = call.values[0];
  if (!(xs instanceof Float64Array)) return call.fail('input_undefined', 'the list is undefined');
  if (call.args.length < 2 || call.args[1]?.omitted) return Array.from(xs, (y, i) => ({ x: i + 1, y }));
  const ys = call.values[1];
  if (!(ys instanceof Float64Array)) return call.fail('input_undefined', 'the list is undefined');
  if (xs.length !== ys.length) return call.fail('size_mismatch', `lengths ${xs.length} and ${ys.length}`);
  return Array.from(xs, (x, i) => ({ x, y: ys[i] as number }));
}

function coords(which: 'x' | 'y') {
  return (call: RuleCall): unknown => {
    const ps = list(call, 0);
    if (!ps) return call.fail('input_undefined', 'the list is undefined');
    return Float64Array.from(ps as Pt[], (q) => q[which]);
  };
}

function runOnAxis(call: RuleCall): unknown {
  const xs = call.values[0];
  if (!(xs instanceof Float64Array)) return call.fail('input_undefined', 'the list is undefined');
  return Array.from(xs, (x) => ({ x, y: 0 }));
}

/* ------------------------------ the table ------------------------------ */

const L = 'List';

export const LIST_COMMANDS: readonly CommandSpec[] = [
  spec('Seq', [
    form([body('expr'), binder('k', 'Number'), p('from', 'Number'), p('to', 'Number')], 'List<=expr>', runSeqBody, 'the list of expr for k = from, from + 1, …, to', { check: literalRange(2, 3) }),
    form([body('expr'), binder('k', 'Number'), p('from', 'Number'), p('to', 'Number'), p('step', 'Number')], 'List<=expr>', runSeqBody, 'the list of expr for k from from to to in steps', { check: literalRange(2, 3, 4) }),
    form([p('n', 'Number')], 'List<Number>', runSeqN, 'the list 1, 2, …, n', { check: literalCount(0) }),
    form([p('from', 'Number'), p('to', 'Number')], 'List<Number>', runRange, 'the whole numbers from from to to', { check: literalRange(0, 1) }),
  ]),
  spec('Range', [
    form([p('from', 'Number'), p('to', 'Number')], 'List<Number>', runRange, 'the numbers from from to to in steps of 1', { check: literalRange(0, 1) }),
    form([p('from', 'Number'), p('to', 'Number'), p('step', 'Number')], 'List<Number>', runRange, 'the numbers from from to to in steps', { check: literalRange(0, 1, 2) }),
  ]),
  spec('Repeat', [form([p('x', 'Any'), p('n', 'Number')], 'List<=x>', runRepeat, 'n copies of x', { check: literalCount(1) })]),
  spec('Linspace', [form([p('from', 'Number'), p('to', 'Number'), p('n', 'Number')], 'List<Number>', runLinspace, 'n numbers evenly spaced from from to to', { check: literalCount(2) })]),
  spec('Map', [form([p('list', L), binder('k', '@list'), body('expr')], 'List<=expr>', runMap, 'expr for each element k of the list')]),
  spec('Zip', [
    form([body('expr'), binder('a', '@listA'), p('listA', L), binder('b', '@listB'), p('listB', L)], 'List<=expr>', runZip(2), 'expr for each index, reading a from listA and b from listB'),
    form([body('expr'), binder('a', '@listA'), p('listA', L), binder('b', '@listB'), p('listB', L), binder('c', '@listC'), p('listC', L)], 'List<=expr>', runZip(3), 'expr for each index of three lists'),
    form([body('expr'), binder('a', '@listA'), p('listA', L), binder('b', '@listB'), p('listB', L), binder('c', '@listC'), p('listC', L), binder('d', '@listD'), p('listD', L)], 'List<=expr>', runZip(4), 'expr for each index of four lists'),
  ]),
  spec('Fold', [form([p('list', L), binder('acc', '=init'), binder('v', '@list'), p('init', 'Any'), body('expr')], '=init', runFold(false), 'reduce: acc starts at init, then becomes expr for each element v')]),
  spec('Scan', [form([p('list', L), binder('acc', '=init'), binder('v', '@list'), p('init', 'Any'), body('expr')], 'List<=init>', runFold(true), 'every step of Fold')]),
  spec('Iterate', [form([body('expr'), binder('x', '=start'), p('start', 'Number|Point'), p('n', 'Number')], '=start', runIterate(false), 'apply expr n times from start', { check: literalCount(3) })]),
  spec('IterateList', [
    form([body('expr'), binder('x', '=start'), p('start', 'Number|Point'), p('n', 'Number')], 'List<=start>', runIterate(true), 'start and the n values after it', { check: literalCount(3) }),
    form([body('expr'), binder('a', '=first'), binder('b', '=first'), p('first', 'Number|Point'), p('second', 'Number|Point'), p('n', 'Number')], 'List<=first>', runIterate2, 'a two-term recurrence: first, second and n more terms', { check: literalCount(5) }),
  ]),
  spec('Count', [
    form([p('list', L)], 'Number', runCount, 'the number of elements'),
    form([p('list', L), binder('k', '@list'), body('cond', 'Bool')], 'Number', runCount, 'how many elements satisfy the condition'),
  ]),
  spec('Contains', [form([p('list', L), p('x', '@list')], 'Bool', runContains, 'true when the list holds x')]),
  spec('IndexOf', [
    form([p('x', 'Any'), p('list', L)], 'Number', runIndexOf, 'the first position of x, or 0'),
    form([p('x', 'Any'), p('list', L), p('from', 'Number')], 'Number', runIndexOf, 'the first position of x at or after from, or 0'),
  ]),
  spec('Sum', [
    form([p('list', 'List<Number>|List<Point>|List<Vector>|List<Text>')], '@list', runSum, 'the total of the elements'),
    form([p('list', L), binder('k', '@list'), body('expr')], '=expr', runSumOf(false), 'the total of expr over the elements'),
  ]),
  spec('Product', [
    form([p('list', 'List<Number>')], 'Number', runProduct, 'the product of the elements'),
    form([p('list', L), binder('k', '@list'), body('expr', 'Number')], 'Number', runSumOf(true), 'the product of expr over the elements'),
  ]),
  spec('Min', [form([p('list', 'List<Number>|List<Text>')], '@list', extreme(-1, false), 'the smallest element')]),
  spec('Max', [form([p('list', 'List<Number>|List<Text>')], '@list', extreme(1, false), 'the largest element')]),
  spec('ArgMin', [form([p('list', 'List<Number>|List<Text>')], 'Number', extreme(-1, true), 'the position of the first smallest element')]),
  spec('ArgMax', [form([p('list', 'List<Number>|List<Text>')], 'Number', extreme(1, true), 'the position of the first largest element')]),
  spec('CumSum', [form([p('list', 'List<Number>')], 'List<Number>', runCumSum, 'the running totals')]),
  spec('Diff', [form([p('list', 'List<Number>')], 'List<Number>', runDiff, 'the differences of neighbours')]),
  spec('Filter', [form([p('list', L), binder('k', '@list'), body('cond', 'Bool')], '=list', runFilter, 'the elements for which the condition holds, in order')]),
  spec('Sort', [
    form([p('list', L)], '=list', runSort(false, false), 'sorted, smallest first (stable)'),
    form([p('list', L), p('order', 'Text')], '=list', runSort(false, true), 'sorted "up" or "down"', { check: literalOrder(1) }),
    form([p('list', L), binder('k', '@list'), body('key')], '=list', runSort(true, false), 'sorted by a key computed per element'),
    form([p('list', L), binder('k', '@list'), body('key'), p('order', 'Text')], '=list', runSort(true, true), 'sorted by a key, "up" or "down"', { check: literalOrder(3) }),
  ]),
  spec('Reverse', [form([p('list', L)], '=list', runReverse, 'the list backwards')]),
  spec('Shuffle', [
    form([p('list', L)], '=list', runShuffle, 'the list in a mixed order (seed 0)'),
    form([p('list', L), p('seed', 'Number')], '=list', runShuffle, 'the list in a mixed order fixed by the seed'),
  ]),
  spec('Unique', [
    form([p('list', L)], '=list', runUnique, 'each value once, first occurrence, original order'),
    form([p('list', 'List<Number>'), p('tol', 'Number')], '=list', runUnique, 'numbers closer than tol count as one'),
  ]),
  spec('Tally', [form([p('list', L)], 'Record<Tally>', runTally, 'the distinct values (sorted) and how often each occurs')]),
  spec('First', [form([p('list', L)], '@list', end(false), 'the first element')]),
  spec('Last', [form([p('list', L)], '@list', end(true), 'the last element')]),
  spec('Head', [form([p('list', L), p('n', 'Number')], '=list', runHeadTail(false), 'the first n elements')]),
  spec('Tail', [form([p('list', L), p('n', 'Number')], '=list', runHeadTail(true), 'the last n elements')]),
  spec('Rest', [form([p('list', L)], '=list', runRest, 'all but the first element')]),
  spec('Slice', [form([p('list', L), p('from', 'Number'), p('to', 'Number')], '=list', runSlice, 'the elements from position from to to (inclusive)')]),
  spec('Append', [form([p('list', L), p('x', '@list')], '=list', runAppend, 'the list with x added at the end')]),
  spec('Prepend', [form([p('x', 'Any'), p('list', L)], '=list', runPrepend, 'the list with x added at the front')]),
  spec('Insert', [
    form([p('x', 'Any'), p('list', L), p('pos', 'Number')], '=list', runInsert(false), 'the list with x at position pos'),
    form([p('items', L), p('list', L), p('pos', 'Number')], '=list', runInsert(true), 'the list with the items from position pos'),
  ]),
  spec('Remove', [form([p('list', L), p('x', '@list')], '=list', runRemove, 'the list without any element equal to x')]),
  spec('RemoveAt', [form([p('list', L), p('pos', 'Number')], '=list', runRemoveAt, 'the list without the element at pos')]),
  spec('RemoveUndefined', [form([p('list', L)], '=list', runRemoveUndefined, 'the list without undefined elements')]),
  spec('Join', [
    form([p('lists', 'List<List>')], '@lists', runJoinLists, 'the lists one after another'),
    { ...form([p('list1', L), p('list2', L)], '=list1', runJoin, 'the lists one after another'), rest: p('more', L) },
  ]),
  spec('Flatten', [form([p('list', 'List<List>')], '@list', runJoinLists, 'a list of lists as one list')]),
  spec('Union', [
    form([p('a', L), p('b', L)], '=a', runSet('union'), 'the values in a or b, each once'),
    form([p('a', 'List<Number>'), p('b', 'List<Number>'), p('tol', 'Number')], '=a', runSet('union'), 'union with numbers closer than tol counted as one'),
  ]),
  spec('Intersection', [
    form([p('a', L), p('b', L)], '=a', runSet('intersection'), 'the values in both a and b'),
    form([p('a', 'List<Number>'), p('b', 'List<Number>'), p('tol', 'Number')], '=a', runSet('intersection'), 'intersection with a tolerance'),
  ]),
  spec('Difference', [
    form([p('a', L), p('b', L)], '=a', runSet('difference'), 'the values in a that are not in b'),
    form([p('a', 'List<Number>'), p('b', 'List<Number>'), p('tol', 'Number')], '=a', runSet('difference'), 'difference with a tolerance'),
  ]),
  spec('Points', [
    form([p('xs', 'List<Number>'), p('ys', 'List<Number>')], 'List<Point>', runPoints, 'the points (x, y) from two lists'),
    form([p('ys', 'List<Number>')], 'List<Point>', runPoints, 'the points (1, y1), (2, y2), …'),
  ]),
  spec('Xs', [form([p('points', 'List<Point>')], 'List<Number>', coords('x'), 'the x coordinates')]),
  spec('Ys', [form([p('points', 'List<Point>')], 'List<Number>', coords('y'), 'the y coordinates')]),
  spec('OnAxis', [form([p('xs', 'List<Number>')], 'List<Point>', runOnAxis, 'the points (x, 0)')]),
];

