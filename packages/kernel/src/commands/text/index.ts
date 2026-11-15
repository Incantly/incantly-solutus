/**
 * Text and logic commands (docs/features/text-logic/design.md 4 and 5): making text, numbers as exact-looking text,
 * tables, string tools on code points, counting and filtering, tests, and named relations. The text value is the plain
 * string the language already uses; typeset parts are `$…$` inside it, drawn by the view's layout engine.
 *
 * Plug in with `registerText(registry)`. No DOM, no timers, no Date.
 */
import type { ObjId } from '../../contracts/values';
import type { CommandRegistry, CommandRule, RuleCall } from '../../graph/registry';
import type { LineNode } from '../../language/ast';
import { valueText } from '../../language/runtime';
import type { CommandForm, CommandSpec, ParamSpec } from '../../language/table';
import { registerNotice } from '../../errors/notices';
import { registerPropertyTypes } from '../../graph/props';
import { PROPERTIES } from '../../language/props';
import { registerStyleLift } from '../../language/lines';
import { lineLatex, numberLatex, valueLatex } from './latex';
import { bestRational, continuedFraction, continuedFractionLatex, fractionLatex, scientificLatex, surd } from './numtext';

declare module '../../contracts/values' {
  interface AreaUndefReasons {
    // text-logic errors.md 3: a pair of objects the relation table does not cover
    unsupported: true;
  }
}

/* ------------------------------ spec helpers ------------------------------ */

const p = (name: string, type: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ name, type, ...extra });
const named = (name: string, type: string, def?: number | boolean | string): ParamSpec => ({ name, type, optional: true, named: true, ...(def !== undefined ? { default: def } : {}) });
const body = (name: string, type = 'Bool'): ParamSpec => ({ name, type, kind: 'body' });
const binder = (name: string, type: string): ParamSpec => ({ name, type, kind: 'binder' });

type Run = (call: RuleCall) => unknown;

function form(params: readonly ParamSpec[], returns: string, run: Run, summary: string, extra: Partial<CommandForm> = {}): CommandForm {
  const rule = (): CommandRule => ({ run, ...(extra.acceptsUndefined ? { acceptsUndefined: true } : {}) });
  const { acceptsUndefined: _a, ...rest } = extra as Partial<CommandForm> & { acceptsUndefined?: boolean };
  return { params, returns, rule, summary, ...rest };
}

const spec = (name: string, group: string, forms: readonly CommandForm[]): CommandSpec => ({ name, kind: 'object', group, forms });

const num = (call: RuleCall, i: number): number | undefined => {
  const v = call.values[i];
  return typeof v === 'number' && v === v ? v : undefined;
};
const str = (call: RuleCall, i: number): string | undefined => (typeof call.values[i] === 'string' ? (call.values[i] as string) : undefined);
const itemsOf = (v: unknown): unknown[] | undefined => (v instanceof Float64Array ? Array.from(v) : Array.isArray(v) ? v : undefined);

/* ------------------------------ making text (4.1) ------------------------------ */

/** The definition's right-hand side as plain text: `Midpoint(A, B)`. */
function definitionRhs(call: RuleCall, id: ObjId | undefined): string | undefined {
  const d = id === undefined ? undefined : call.definitionOf?.(id);
  if (!d) return undefined;
  const at = d.text.indexOf('=');
  return at >= 0 ? d.text.slice(at + 1).replace(/\swith\s.*$/, '').trim() : d.text;
}

function runText(call: RuleCall): unknown {
  const v = call.values[0];
  const show = str(call, 2) ?? 'value';
  if (show !== 'value' && show !== 'definition') return call.fail('bad_argument', `show must be "value" or "definition", not "${show}"`);
  if (show === 'definition') {
    const rhs = definitionRhs(call, call.ids[0]);
    if (rhs !== undefined) return rhs;
  }
  if (v === undefined || (typeof v === 'number' && v !== v)) return call.fail('input_undefined', 'the object is undefined');
  return typeof v === 'string' ? v : valueText(v);
}

/** The LaTeX of an argument: the definition of a named object, else its value. */
function latexOf(call: RuleCall, i: number, substitute: boolean): string | undefined {
  const id = call.ids[i];
  const d = id === undefined ? undefined : call.definitionOf?.(id);
  const v = call.values[i];
  const type = call.args[i]?.tree?.ty.k ?? '';
  const free = d && (d.node as LineNode).k === 'define' && isLiteral((d.node as { expr: { k: string } }).expr.k);
  if (d && !free) {
    // with substitute, the names the definition reads take their values now
    const values = new Map<string, unknown>();
    if (substitute && id !== undefined) for (const x of call.inputsOf(id)) values.set(x.name, x.value);
    const sub = substitute ? (name: string): string | undefined => (values.has(name) ? valueLatex(values.get(name)) : undefined) : undefined;
    const l = lineLatex(d.node as LineNode, sub);
    if (l) return (d.node as LineNode).k === 'function' ? l.full : l.rhs;
  }
  if (v === undefined || (typeof v === 'number' && v !== v)) return undefined;
  return valueLatex(v, type);
}

const isLiteral = (k: string): boolean => k === 'num' || k === 'tuple' || k === 'list' || k === 'bool' || k === 'str';

function runLatex(call: RuleCall): unknown {
  return latexOf(call, 0, false) ?? call.fail('input_undefined', 'the object is undefined');
}

function runFormulaText(call: RuleCall): unknown {
  const l = latexOf(call, 0, call.values[1] === true);
  return l === undefined ? call.fail('input_undefined', 'the object is undefined') : `$${l}$`;
}

/* ------------------------------ numbers as text (4.2 to 4.5) ------------------------------ */

const finite = (call: RuleCall, i: number, what = 'x'): number | undefined => {
  const x = num(call, i);
  if (x === undefined) return call.fail('input_undefined', `${what} is undefined`);
  if (!Number.isFinite(x)) return call.fail('not_finite', `${what} is not a finite number`);
  return x;
};

function runFractionText(call: RuleCall): unknown {
  const x = finite(call, 0);
  if (x === undefined) return undefined;
  const maxDen = num(call, 1) ?? 1e6;
  const tol = num(call, 2) ?? 1e-9;
  if (!(maxDen >= 1)) return call.fail('bad_argument', `maxDen must be at least 1, not ${maxDen}`);
  const r = bestRational(x, maxDen, tol);
  if (!r.ok) return call.fail('no_convergence', `about ${r.f.p}/${r.f.q}`);
  return `$${fractionLatex(r.f)}$`;
}

function runSurdText(call: RuleCall): unknown {
  const x = finite(call, 0);
  if (x === undefined) return undefined;
  const m = surd(x, num(call, 1) ?? 1e-10, (v) => valueText(v));
  return m.exact ? `$${m.latex}$` : m.latex;
}

function runScientificText(call: RuleCall): unknown {
  const x = finite(call, 0);
  if (x === undefined) return undefined;
  const sig = num(call, 1) ?? 6;
  if (!Number.isInteger(sig) || sig < 1 || sig > 21) return call.fail('bad_argument', `sig must be a whole number from 1 to 21, not ${sig}`);
  return `$${scientificLatex(x, sig)}$`;
}

function runOrdinal(call: RuleCall): unknown {
  const n = num(call, 0);
  if (n === undefined) return call.fail('input_undefined', 'n is undefined');
  if (!Number.isInteger(n) || n < 0) return call.fail('out_of_domain', `Ordinal needs a whole number from 0, not ${n}`);
  const h = n % 100;
  const s = h >= 11 && h <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${s}`;
}

function runContinuedFraction(call: RuleCall): unknown {
  const x = finite(call, 0);
  if (x === undefined) return undefined;
  const levels = num(call, 1) ?? 5;
  if (!Number.isInteger(levels) || levels < 1 || levels > 100) return call.fail('bad_argument', `levels must be a whole number from 1 to 100, not ${levels}`);
  const cf = continuedFraction(x, levels);
  return `$${continuedFractionLatex(cf.terms, call.values[2] === true, cf.truncated)}$`;
}

/* ------------------------------ tables (4.6) ------------------------------ */

const BRACKETS: Readonly<Record<string, [string, string]>> = { none: ['', ''], paren: ['\\left(', '\\right)'], square: ['\\left[', '\\right]'], brace: ['\\left\\{', '\\right\\}'], bar: ['\\left|', '\\right|'] };

/** A cell's LaTeX: a math text unwrapped, a plain text as `\text{}`, anything else by value. */
function cellLatex(v: unknown, fmt: string | undefined): string {
  if (typeof v === 'string') {
    const m = /^\$(.*)\$$/s.exec(v);
    return m ? (m[1] as string) : `\\text{${v.replace(/[{}\\$]/g, '')}}`;
  }
  if (typeof v === 'number' && fmt !== undefined && /^\d+$/.test(fmt)) return numberLatex(Number(v.toFixed(Number(fmt))));
  return valueLatex(v);
}

function runTableText(call: RuleCall): unknown {
  const outer = itemsOf(call.values[0]);
  if (!outer) return call.fail('input_undefined', 'the rows are undefined');
  let rows = outer.map((r) => itemsOf(r) ?? [r]);
  if (call.values[4] === true) {
    // each inner list is a column
    const n = Math.max(0, ...rows.map((r) => r.length));
    rows = Array.from({ length: n }, (_, i) => rows.map((c) => c[i]));
  }
  const cols = Math.max(0, ...rows.map((r) => r.length));
  if (rows.length * cols > 10000) return call.fail('too_large', `${rows.length * cols} cells; a table holds at most 10,000`);
  if (rows.some((r) => r.length !== cols)) call.notify('ragged_table', { rows: rows.length, cols });
  const alignText = str(call, 1) ?? 'l';
  const align = Array.from({ length: cols }, (_, i) => {
    const a = alignText[Math.min(i, alignText.length - 1)] ?? 'l';
    return a === '.' ? 'r' : 'lcr'.includes(a) ? a : 'l';
  }).join('');
  const header = call.values[2] === true;
  const br = BRACKETS[str(call, 3) ?? 'none'];
  if (!br) return call.fail('bad_argument', `brackets must be ${Object.keys(BRACKETS).join(', ')}`);
  const fmt = str(call, 5);
  const lines = rows.map((r, ri) => Array.from({ length: cols }, (_, i) => {
    const c = cellLatex(r[i] ?? '', fmt);
    return header && ri === 0 ? `\\mathbf{${c}}` : c;
  }).join(' & '));
  const body = lines.map((l, i) => (header && i === 0 && lines.length > 1 ? `${l} \\\\ \\hline` : l)).join(' \\\\ ').replace(/\\\\ \\hline \\\\/g, '\\\\ \\hline');
  return `$${br[0]}\\begin{array}{${align}} ${body} \\end{array}${br[1]}$`;
}

/* ------------------------------ string tools (4.8) ------------------------------ */

const okCodePoint = (n: number): boolean => Number.isInteger(n) && n >= 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) && (n >= 32 || n === 9 || n === 10) && !(n >= 0x7f && n <= 0x9f);

function runReplaceAll(call: RuleCall): unknown {
  const t = str(call, 0);
  const a = str(call, 1);
  const b = str(call, 2);
  if (t === undefined || a === undefined || b === undefined) return call.fail('input_undefined', 'a text is undefined');
  return a === '' ? t : t.split(a).join(b);
}

function runSplit(call: RuleCall): unknown {
  const t = str(call, 0);
  const sep = str(call, 1);
  if (t === undefined || sep === undefined) return call.fail('input_undefined', 'a text is undefined');
  const parts = sep === '' ? Array.from(t) : t.split(sep);
  if (parts.length > 100000) return call.fail('too_large', `${parts.length} pieces; at most 100,000`);
  return parts;
}

function runLetterToUnicode(call: RuleCall): unknown {
  const t = str(call, 0);
  if (t === undefined) return call.fail('input_undefined', 'the text is undefined');
  if (t === '') return call.fail('empty_list', 'the text is empty');
  return t.codePointAt(0) as number;
}

function runTextToUnicode(call: RuleCall): unknown {
  const t = str(call, 0);
  if (t === undefined) return call.fail('input_undefined', 'the text is undefined');
  return Float64Array.from(Array.from(t, (c) => c.codePointAt(0) as number));
}

function runUnicodeToText(call: RuleCall): unknown {
  const xs = itemsOf(call.values[0]);
  if (!xs) return call.fail('input_undefined', 'the list is undefined');
  for (let i = 0; i < xs.length; i++) {
    const n = xs[i] as number;
    if (!okCodePoint(n)) return call.fail('out_of_domain', `code point ${i + 1} is ${n}; it must be a whole number from 0 to 1,114,111, not a surrogate or a control character`);
  }
  return String.fromCodePoint(...(xs as number[]));
}

function runUnicodeToLetter(call: RuleCall): unknown {
  const n = num(call, 0);
  if (n === undefined) return call.fail('input_undefined', 'n is undefined');
  if (!okCodePoint(n)) return call.fail('out_of_domain', `${n} is not a code point from 0 to 1,114,111 (no surrogates or control characters)`);
  return String.fromCodePoint(n);
}

/* ------------------------------ counting and filtering (5.2) ------------------------------ */

/** Runs the condition for each item; true, false or undefined (`null`). */
function conditions(call: RuleCall): (boolean | null)[] | undefined {
  const xs = itemsOf(call.values[0]);
  const ev = call.args[2]?.eval;
  const slot = call.args[1]?.slot;
  if (!xs || !ev || slot === undefined) return undefined;
  const env = call.env;
  const saved = env.locals[slot];
  const out: (boolean | null)[] = [];
  for (let i = 0; i < xs.length; i++) {
    if ((i & 1023) === 1023 && !call.work.spend(1024)) return undefined;
    env.locals[slot] = xs[i];
    const sr = env.reason;
    env.reason = undefined;
    let v: unknown;
    try {
      v = ev(env);
    } catch {
      v = undefined;
    }
    const bad = env.reason !== undefined || typeof v !== 'boolean';
    env.reason = sr;
    out.push(bad ? null : (v as boolean));
  }
  env.locals[slot] = saved;
  return out;
}

function runCountIf(call: RuleCall): unknown {
  const c = conditions(call);
  if (!c) return call.fail('input_undefined', 'the list is undefined');
  const skipped = c.filter((x) => x === null).length;
  if (skipped > 0) call.notify('skipped_undefined', { n: skipped });
  return c.filter((x) => x === true).length;
}

function runKeepIf(call: RuleCall): unknown {
  const raw = call.values[0];
  const xs = itemsOf(raw);
  const c = conditions(call);
  if (!xs || !c) return call.fail('input_undefined', 'the list is undefined');
  const skipped = c.filter((x) => x === null).length;
  if (skipped > 0) call.notify('skipped_undefined', { n: skipped });
  const kept = xs.filter((_, i) => c[i] === true);
  return raw instanceof Float64Array ? Float64Array.from(kept as number[]) : kept;
}

/* ------------------------------ tests (5.3) ------------------------------ */

function runIsInteger(call: RuleCall): unknown {
  const x = num(call, 0);
  if (x === undefined) return call.fail('input_undefined', 'x is undefined');
  if (!Number.isFinite(x)) return false;
  return Math.abs(x) >= 2 ** 53 || Math.abs(x - Math.round(x)) <= 1e-12 * Math.max(1, Math.abs(x));
}

function runIsDefined(call: RuleCall): unknown {
  const v = call.values[0];
  return !(v === undefined || (typeof v === 'number' && v !== v));
}

/** Undefined reasons in words (algebra-view design 3.7 uses the same phrases). */
const REASON_WORDS: Readonly<Record<string, string>> = {
  input_undefined: 'an input is undefined', out_of_domain: 'outside the domain', not_finite: 'not a finite number', parallel: 'the lines are parallel',
  collinear: 'the points are in a line', coincident: 'the points coincide', no_intersection: 'they do not meet', division_by_zero: 'division by zero',
  bad_parameter: 'a parameter is out of range', empty_list: 'the list is empty', no_root: 'no root here', condition_false: 'no condition holds',
};

function runUndefinedReason(call: RuleCall): unknown {
  const v = call.values[0];
  if (!(v === undefined || (typeof v === 'number' && v !== v))) return '';
  const id = call.ids[0];
  const d = id === undefined ? undefined : call.definitionOf?.(id);
  const reason = d?.reason;
  return reason ? (REASON_WORDS[reason] ?? reason.replace(/_/g, ' ')) : 'it is undefined';
}

const isPt = (v: unknown): v is { x: number; y: number } => typeof v === 'object' && v !== null && typeof (v as { x?: unknown }).x === 'number' && typeof (v as { y?: unknown }).y === 'number';

function polygonVertices(v: unknown): { x: number; y: number }[] | undefined {
  const o = v as { vertices?: unknown; pts?: unknown; points?: unknown } | undefined;
  const raw = itemsOf(o?.vertices) ?? itemsOf(o?.pts) ?? itemsOf(o?.points) ?? itemsOf(v);
  return raw && raw.every(isPt) ? (raw as { x: number; y: number }[]) : undefined;
}

/** Does the closed path cross itself (two edges that are not neighbours meet)? */
function selfCrossing(ps: readonly { x: number; y: number }[]): boolean {
  const n = ps.length;
  const cross = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let i = 0; i < n; i++) {
    const a = ps[i] as { x: number; y: number };
    const b = ps[(i + 1) % n] as { x: number; y: number };
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = ps[j] as { x: number; y: number };
      const d = ps[(j + 1) % n] as { x: number; y: number };
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return true;
    }
  }
  return false;
}

function runIsInRegion(call: RuleCall): unknown {
  const P = call.values[0];
  const R = call.values[1];
  if (!isPt(P) || R === undefined) return call.fail('input_undefined', 'an input is undefined');
  const circ = circleOf(R);
  if (circ) {
    const { c, r } = circ;
    const scale = Math.max(1, Math.abs(c.x), Math.abs(c.y), Math.abs(r));
    return Math.hypot(P.x - c.x, P.y - c.y) <= r + 1e-9 * scale;
  }
  const ps = polygonVertices(R);
  if (!ps || ps.length < 3) return call.fail('unsupported', 'IsInRegion takes a Polygon or a Circle');
  const scale = Math.max(1, ...ps.map((q) => Math.max(Math.abs(q.x), Math.abs(q.y))));
  const eps = 1e-9 * scale;
  // the boundary counts as inside
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i] as { x: number; y: number };
    const b = ps[(i + 1) % ps.length] as { x: number; y: number };
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const dist = len === 0 ? Math.hypot(P.x - a.x, P.y - a.y) : Math.abs((b.x - a.x) * (P.y - a.y) - (b.y - a.y) * (P.x - a.x)) / len;
    const along = len === 0 ? 0 : ((P.x - a.x) * (b.x - a.x) + (P.y - a.y) * (b.y - a.y)) / (len * len);
    if (dist <= eps && along >= -eps && along <= 1 + eps) return true;
  }
  const crossing = selfCrossing(ps);
  if (crossing) call.notify('self_crossing');
  // winding number; even-odd for a self-crossing polygon
  let wind = 0;
  let parity = false;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i] as { x: number; y: number };
    const b = ps[(i + 1) % ps.length] as { x: number; y: number };
    const side = (b.x - a.x) * (P.y - a.y) - (P.x - a.x) * (b.y - a.y);
    if (a.y <= P.y) {
      if (b.y > P.y && side > 0) wind++;
    } else if (b.y <= P.y && side < 0) wind--;
    if ((a.y > P.y) !== (b.y > P.y) && P.x < ((b.x - a.x) * (P.y - a.y)) / (b.y - a.y) + a.x) parity = !parity;
  }
  return crossing ? parity : wind !== 0;
}

/* ------------------------------ Related (5.4) ------------------------------ */

export const RELATION_KINDS = ['equal', 'distinct', 'parallel', 'perpendicular', 'coincident', 'intersecting', 'on', 'inside', 'outside', 'tangent', 'secant', 'disjoint', 'concentric', 'nested', 'less', 'greater', 'congruent'] as const;

interface LineLike { readonly p: { x: number; y: number }; readonly d: { x: number; y: number } }

/** A line, ray or segment as a point and a direction, from the shapes the geometry area stores. */
function lineOf(v: unknown): LineLike | undefined {
  const o = v as Record<string, unknown> | undefined;
  if (!o || typeof o !== 'object') return undefined;
  if (isPt(o['a']) && isPt(o['b'])) return { p: o['a'], d: { x: o['b'].x - o['a'].x, y: o['b'].y - o['a'].y } };
  if (isPt(o['start']) && isPt(o['end'])) return { p: o['start'], d: { x: o['end'].x - o['start'].x, y: o['end'].y - o['start'].y } };
  if (isPt(o['p']) && isPt(o['d'])) return { p: o['p'], d: o['d'] };
  if (typeof o['a'] === 'number' && typeof o['b'] === 'number' && typeof o['c'] === 'number') {
    const [A, B, C] = [o['a'] as number, o['b'] as number, o['c'] as number];
    const n2 = A * A + B * B;
    if (n2 === 0) return undefined;
    // a x + b y = c
    return { p: { x: (A * C) / n2, y: (B * C) / n2 }, d: { x: -B, y: A } };
  }
  return undefined;
}

function circleOf(v: unknown): { c: { x: number; y: number }; r: number } | undefined {
  const o = v as Record<string, unknown> | undefined;
  if (!o || typeof o !== 'object') return undefined;
  // the geometry area stores a circle as { cx, cy, r }
  const c = typeof o['cx'] === 'number' && typeof o['cy'] === 'number' ? { x: o['cx'], y: o['cy'] } : isPt(o['center']) ? o['center'] : undefined;
  const r = typeof o['r'] === 'number' ? o['r'] : typeof o['radius'] === 'number' ? o['radius'] : undefined;
  return c && r !== undefined ? { c, r } : undefined;
}

/** The relations that hold now between two values, and the kinds that apply to the pair. */
function relationsNow(a: unknown, b: unknown, tol: number): { holds: Set<string>; applies: readonly string[] } | undefined {
  const holds = new Set<string>();
  if (typeof a === 'number' && typeof b === 'number') {
    const e = tol * Math.max(1, Math.abs(a), Math.abs(b));
    if (Math.abs(a - b) <= e) holds.add('equal');
    else holds.add(a < b ? 'less' : 'greater');
    return { holds, applies: ['equal', 'less', 'greater'] };
  }
  if (isPt(a) && isPt(b)) {
    const e = tol * Math.max(1, Math.abs(a.x), Math.abs(a.y), Math.abs(b.x), Math.abs(b.y));
    holds.add(Math.hypot(a.x - b.x, a.y - b.y) <= e ? 'equal' : 'distinct');
    return { holds, applies: ['equal', 'distinct'] };
  }
  const ca = circleOf(a);
  const cb = circleOf(b);
  const la = lineOf(a);
  const lb = lineOf(b);
  if (isPt(a) && (cb || lb)) return pointWith(a, cb, lb, tol);
  if (isPt(b) && (ca || la)) return pointWith(b, ca, la, tol);
  if (la && lb) {
    const cross = la.d.x * lb.d.y - la.d.y * lb.d.x;
    const dot = la.d.x * lb.d.x + la.d.y * lb.d.y;
    const n = Math.hypot(la.d.x, la.d.y) * Math.hypot(lb.d.x, lb.d.y);
    if (n === 0) return undefined;
    if (Math.abs(cross) <= tol * n) {
      const off = (lb.p.x - la.p.x) * la.d.y - (lb.p.y - la.p.y) * la.d.x;
      holds.add(Math.abs(off) <= tol * Math.max(1, Math.hypot(la.d.x, la.d.y)) * Math.max(1, Math.abs(la.p.x), Math.abs(la.p.y)) ? 'coincident' : 'parallel');
    } else {
      holds.add('intersecting');
      if (Math.abs(dot) <= tol * n) holds.add('perpendicular');
    }
    return { holds, applies: ['coincident', 'parallel', 'perpendicular', 'intersecting'] };
  }
  if ((la && cb) || (lb && ca)) {
    const l = (la ?? lb) as LineLike;
    const c = (cb ?? ca) as { c: { x: number; y: number }; r: number };
    const dist = Math.abs((c.c.x - l.p.x) * l.d.y - (c.c.y - l.p.y) * l.d.x) / Math.hypot(l.d.x, l.d.y);
    const e = tol * Math.max(1, c.r);
    holds.add(Math.abs(dist - c.r) <= e ? 'tangent' : dist < c.r ? 'secant' : 'disjoint');
    return { holds, applies: ['tangent', 'secant', 'disjoint'] };
  }
  if (ca && cb) {
    const d = Math.hypot(ca.c.x - cb.c.x, ca.c.y - cb.c.y);
    const e = tol * Math.max(1, ca.r, cb.r, Math.abs(ca.c.x), Math.abs(ca.c.y));
    if (d <= e) holds.add(Math.abs(ca.r - cb.r) <= e ? 'coincident' : 'concentric');
    if (Math.abs(d - (ca.r + cb.r)) <= e || (d > e && Math.abs(d - Math.abs(ca.r - cb.r)) <= e)) holds.add('tangent');
    else if (d < ca.r + cb.r && d > Math.abs(ca.r - cb.r)) holds.add('intersecting');
    else if (d < Math.abs(ca.r - cb.r)) holds.add('nested');
    else if (d > ca.r + cb.r) holds.add('disjoint');
    return { holds, applies: ['coincident', 'concentric', 'tangent', 'intersecting', 'nested', 'disjoint'] };
  }
  return undefined;
}

function pointWith(P: { x: number; y: number }, c: { c: { x: number; y: number }; r: number } | undefined, l: LineLike | undefined, tol: number): { holds: Set<string>; applies: readonly string[] } {
  const holds = new Set<string>();
  if (c) {
    const d = Math.hypot(P.x - c.c.x, P.y - c.c.y);
    const e = tol * Math.max(1, c.r, Math.abs(c.c.x), Math.abs(c.c.y));
    holds.add(Math.abs(d - c.r) <= e ? 'on' : d < c.r ? 'inside' : 'outside');
    return { holds, applies: ['on', 'inside', 'outside'] };
  }
  const L = l as LineLike;
  const dist = Math.abs((P.x - L.p.x) * L.d.y - (P.y - L.p.y) * L.d.x) / Math.hypot(L.d.x, L.d.y);
  if (dist <= tol * Math.max(1, Math.abs(P.x), Math.abs(P.y), Math.abs(L.p.x), Math.abs(L.p.y))) holds.add('on');
  return { holds, applies: ['on'] };
}

function runRelated(call: RuleCall): unknown {
  const kind = str(call, 2);
  if (kind === undefined) return call.fail('input_undefined', 'the kind is undefined');
  const a = call.values[0];
  const b = call.values[1];
  if (a === undefined || b === undefined) return call.fail('input_undefined', 'an object is undefined');
  const r = relationsNow(a, b, call.tol);
  if (!r) return call.fail('unsupported', 'supported pairs: numbers, points, lines, segments, rays, circles, and a point with a line or a circle');
  if (!(RELATION_KINDS as readonly string[]).includes(kind) || !r.applies.includes(kind)) {
    return call.fail('bad_argument', `"${kind}" does not apply to these two; use one of ${r.applies.join(', ')}`);
  }
  // `always = true` asks for a relation by construction, which this round does not derive (design 5.4)
  if (call.values[3] === true) return false;
  return r.holds.has(kind);
}

/* ------------------------------ the table ------------------------------ */

const TEXT_COMMANDS: readonly CommandSpec[] = [
  spec('Text', 'text', [form([p('obj', 'Any'), p('at', 'Point', { optional: true }), named('show', 'Text', 'value')], 'Text', runText, 'any object as text: its value, or show = "definition"', { acceptsUndefined: false })]),
  spec('LaTeX', 'text', [form([p('obj', 'Any')], 'Text', runLatex, 'the LaTeX source of an object')]),
  spec('FormulaText', 'text', [form([p('obj', 'Any'), named('substitute', 'Bool', false)], 'Text', runFormulaText, 'an object as a typeset formula')]),
  spec('FractionText', 'text', [form([p('x', 'Number'), p('maxDen', 'Number', { optional: true }), named('tol', 'Number', 1e-9)], 'Text', runFractionText, 'the best fraction for x, typeset')]),
  spec('SurdText', 'text', [form([p('x', 'Number'), p('tol', 'Number', { optional: true })], 'Text', runSurdText, 'the simplest exact form that matches x')]),
  spec('ScientificText', 'text', [form([p('x', 'Number'), named('sig', 'Number', 6)], 'Text', runScientificText, 'x as a times a power of ten')]),
  spec('Ordinal', 'text', [form([p('n', 'Number')], 'Text', runOrdinal, '1st, 2nd, 3rd …')]),
  spec('ContinuedFraction', 'text', [form([p('x', 'Number'), p('levels', 'Number', { optional: true }), p('short', 'Bool', { optional: true, default: false })], 'Text', runContinuedFraction, 'the continued fraction of x')]),
  spec('TableText', 'text', [form([
    p('rows', 'List'), named('align', 'Text', 'l'), named('header', 'Bool', false), named('brackets', 'Text', 'none'), named('byColumns', 'Bool', false), named('fmt', 'Text'),
  ], 'Text', runTableText, 'a typeset table of a list of rows')]),
  // conveniences for `T with vertical = true` and `T with rotate = a` (design 4.7); a definition is read as that, so
  // the rule only runs where the call sits inside a larger expression, and then it is the text unchanged
  spec('VerticalText', 'text', [form([p('T', 'Text')], 'Text', (call) => call.values[0], 'the text with its letters stacked top to bottom')]),
  spec('RotateText', 'text', [form([p('T', 'Text'), p('angle', 'Number')], 'Text', (call) => call.values[0], 'the text turned by an angle about its anchor')]),
  spec('ReplaceAll', 'text', [form([p('T', 'Text'), p('old', 'Text'), p('new', 'Text')], 'Text', runReplaceAll, 'every old in T replaced by new')]),
  spec('Split', 'text', [form([p('T', 'Text'), p('sep', 'Text')], 'List<Text>', runSplit, 'T cut at each sep')]),
  spec('LetterToUnicode', 'text', [form([p('T', 'Text')], 'Number', runLetterToUnicode, 'the code point of the first character')]),
  spec('TextToUnicode', 'text', [form([p('T', 'Text')], 'List<Number>', runTextToUnicode, 'the code points of a text')]),
  spec('UnicodeToText', 'text', [form([p('L', 'List<Number>')], 'Text', runUnicodeToText, 'a text from code points')]),
  spec('UnicodeToLetter', 'text', [form([p('n', 'Number')], 'Text', runUnicodeToLetter, 'one character from its code point')]),
  spec('CountIf', 'logic', [form([p('L', 'List'), binder('k', '@list'), body('cond')], 'Number', runCountIf, 'how many items k of L make cond true')]),
  spec('KeepIf', 'logic', [form([p('L', 'List'), binder('k', '@list'), body('cond')], '=L', runKeepIf, 'the items k of L that make cond true')]),
  spec('IsInteger', 'logic', [form([p('x', 'Number')], 'Bool', runIsInteger, 'true when x is a whole number')]),
  spec('IsDefined', 'logic', [form([p('obj', 'Any')], 'Bool', runIsDefined, 'true when the object is defined', { acceptsUndefined: true })]),
  spec('UndefinedReason', 'logic', [form([p('obj', 'Any')], 'Text', runUndefinedReason, 'why the object is undefined, in words', { acceptsUndefined: true })]),
  spec('IsInRegion', 'logic', [form([p('P', 'Point'), p('region', 'Polygon|Circle')], 'Bool', runIsInRegion, 'true when P is inside or on the region')]),
  spec('Related', 'logic', [form([p('a', 'Any'), p('b', 'Any'), p('kind', 'Text'), named('always', 'Bool', false)], 'Bool', runRelated, 'true when the named relation holds now')]),
];

const NOTICES: Readonly<Record<string, { code: string; severity: 'info' | 'warning'; template: string }>> = {
  ragged_table: { code: 'X101', severity: 'info', template: 'The rows had different lengths, so short rows were padded with empty cells.' },
  skipped_undefined: { code: 'X102', severity: 'info', template: '{n} items were skipped because the condition was undefined for them.' },
  self_crossing: { code: 'X105', severity: 'info', template: 'The polygon crosses itself, so inside was decided by the even-odd rule.' },
};

let registered = false;

export function registerText(registry: CommandRegistry): void {
  registry.registerAll(TEXT_COMMANDS);
  if (registered) return;
  registered = true;
  for (const [kind, s] of Object.entries(NOTICES)) registerNotice(kind, s);
  // placement and style of a text (design 2.1); properties, so they never make the text recompute
  const props = {
    at: { kind: 'point', allowed: 'a point, such as (1, 2) or the name of a point', expr: true },
    anchor: { kind: 'enum', values: ['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se'], allowed: 'nw, n, ne, w, c, e, sw, s or se' },
    size: { kind: 'number', min: 4, max: 200, allowed: 'a size in points from 4 to 200', expr: true },
    rotate: { kind: 'number', allowed: 'an angle', expr: true },
    bg: { kind: 'color', allowed: 'a colour name, rgb(r, g, b) or hsl(h, s, l)', expr: true },
    vertical: { kind: 'bool', allowed: 'true or false' },
    // `full` draws the `$…$` parts with KaTeX instead of the built-in subset (design 6.4)
    latex: { kind: 'enum', values: ['subset', 'full'], allowed: 'subset or full' },
  } as const;
  registerStyleLift('VerticalText', { args: 1, type: 'Text', props: [{ key: 'vertical' }] });
  registerStyleLift('RotateText', { args: 2, type: 'Text', props: [{ key: 'rotate', arg: 1 }] });
  for (const [key, spec] of Object.entries(props)) {
    const old = PROPERTIES[key];
    if (!old) PROPERTIES[key] = spec as (typeof PROPERTIES)[string];
    else if (old.kind === 'enum' && spec.kind === 'enum') {
      // another area owns the key (controls use tl, tr, bl, br): the compass words are added beside its words
      const values = [...new Set([...(old.values ?? []), ...spec.values])];
      PROPERTIES[key] = { ...old, values, allowed: values.join(', ') };
    }
    registerPropertyTypes(key, ['Text']);
  }
}

export { exprLatex, lineLatex, nameLatex, numberLatex, valueLatex } from './latex';
export { bestRational, continuedFraction, fractionLatex, scientificLatex, surd } from './numtext';
