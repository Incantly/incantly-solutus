/**
 * Steps 3 and 4: resolve names and type-check (docs/features/language/design.md 3.8 to 3.13).
 * Produces a typed tree plus facts about the line (names, type, reads, free or dependent).
 * Collects up to 8 independent errors in one line; the first is the main error, the rest go in `more`.
 */
import type { ErrorKind, Notice } from '../contracts/errors';
import type { ObjId } from '../contracts/values';
import type { Arg, CmpOp, Expr, LineKind, ParsedLine } from './ast';
import { BUILTIN_FUNCTIONS, constantByName, getMathLib } from './builtins';
import { Diag, closestNames, notice, typeList } from './errors';
import type { ArgProblem, ErrorExtra, LanguageError, QuickFix } from './errors';
import { CONSTANT_NAMES, nameProblem, reservedGroup } from './names';
import { defineLine } from '../errors/suggest';
import { own } from './props';
import { classify } from './relation';
import type { FigureView, FormLike, FunctionTable, ObjectInfo, ParamSpec } from './table';
import { formText } from './table';
import type { RelTree, TArg, TNode } from './tnode';
import { T, accepts, binaryOp, legalOpsFor, listOf, setLabel, tyEq, tyStr, typeSet } from './types';
import type { Ty } from './types';
import type { LangLimits } from './source';

/* ------------------------------ public shapes ------------------------------ */

export interface CheckOptions {
  /** Names whose defining line failed earlier in this batch; reads of them set `blockedBy`. */
  failed?: ReadonlyMap<string, { line: number; kind: ErrorKind }>;
  /** Skip the cycle and dependents tests (used when re-checking dependents). */
  skipGraphChecks?: boolean;
  /** Host limits (objects, expression nodes, list size); the language's own values apply to what is left out. */
  limits?: LangLimits;
  /** The `with` keys an object of this type accepts. Without it every key of the property table is accepted for every type. */
  propertyKeys?: (type: string) => readonly string[];
}

export interface CheckedRange {
  readonly from: TNode;
  readonly to: TNode;
  readonly step?: TNode;
  /** Values when the bounds are constants. */
  readonly min?: number;
  readonly max?: number;
  readonly stepValue?: number;
}

export interface CheckedStyle {
  readonly key: string;
  /** A checked expression, or a bare word (`red`, `dashed`). */
  readonly value: TNode | { readonly word: string };
  /** Object ids this property's value reads (its rule's inputs); a `SELF_ID` read may be among them. */
  readonly reads?: readonly ObjId[];
}

export interface CheckedLine {
  readonly line: number;
  readonly kind: LineKind;
  /** What happens: a new object, a redefinition, a restyle, an action ... */
  readonly op: 'noop' | 'add' | 'redefine' | 'restyle' | 'rerange' | 'rate' | 'action' | 'directive';
  /** Names defined or targeted, in order. */
  readonly names: readonly string[];
  /** Result type of a definition. */
  readonly type?: Ty;
  /** Result types of a `defmany`. */
  readonly types?: readonly Ty[];
  readonly unit?: 'angle';
  /** True when the object holds its own value (a literal, constants, no reads, no command). */
  readonly free: boolean;
  /** True when the right-hand side is `state(...)`. */
  readonly isState: boolean;
  /** Existing object being redefined. */
  readonly existing?: ObjId;
  readonly expr?: TNode;
  readonly params?: readonly { readonly name: string; readonly slot: number }[];
  readonly range?: CheckedRange;
  readonly style?: readonly CheckedStyle[];
  /** Initial value and optional velocity of a state. */
  readonly state?: { readonly initial: TNode; readonly velocity?: TNode };
  /** For a rate line: the state and the derivative order. */
  readonly rate?: { readonly target: ObjId; readonly name: string; readonly order: number };
  readonly directive?: { readonly name: string; readonly words: readonly string[] };
  /** Object ids the value rule of the line reads (the inputs of the object's value, not of its range or style). */
  readonly reads: readonly ObjId[];
  readonly usesT: boolean;
  /** Object ids read by the bounds of a slider range; they are not inputs of the value. */
  readonly rangeReads?: readonly ObjId[];
  /** Object ids read by style values (`showIf`, `color`, `opacity`): the inputs of the property rules (style edges). */
  readonly styleReads?: readonly ObjId[];
  /** True when a style value reads the clock; the value and the range bounds may not. */
  readonly styleUsesT?: boolean;
  /** True when a range bound reads the clock; the value and the style values may not. */
  readonly rangeUsesT?: boolean;
  /** Number of local slots the compiled line needs. */
  readonly slots: number;
  /** Canonical source text of the line. */
  readonly text: string;
  /** Relation shape for an equation or inequality. */
  readonly shape?: 'line' | 'circle' | 'conic' | 'curve' | 'region';
  /** The source the checked line came from (for `toScript`). */
  readonly source: string;
}

export const MAX_ERRORS_PER_LINE = 8;
export const MAX_OBJECTS = 5000;
export const MAX_NODES = 2000;
export const MAX_FUNCTION_PARAMS = 4;
export const MAX_COMMAND_ARGS = 16;
export const MAX_RANGE_ELEMENTS = 100000;

const OP_WORDS: Record<string, string> = {
  '+': 'add', '-': 'subtract', '*': 'multiply', '/': 'divide', '^': 'use ^ on', and: 'use and on', or: 'use or on', xor: 'use xor on',
  '==': 'compare', '!=': 'compare', '<': 'compare', '<=': 'compare', '>': 'compare', '>=': 'compare',
};

/** Fields by type, appended to by other areas (docs/features/language/design.md 3.10 rule 9). */
export const FIELDS: Record<string, Record<string, Ty>> = {
  Point: { x: T.Number, y: T.Number },
  Vector: { x: T.Number, y: T.Number, length: T.Number },
  Segment: { length: T.Number, start: T.Point, end: T.Point },
  Circle: { center: T.Point, radius: T.Number },
  Arc: { center: T.Point, radius: T.Number, start: T.Number, end: T.Number },
  Polygon: { vertices: listOf(T.Point), area: T.Number, perimeter: T.Number },
  Line: { point: T.Point, direction: T.Vector },
  Text: { length: T.Number },
};

interface Frame {
  readonly vars: Map<string, { slot: number; ty: Ty; unit?: 'angle' }>;
}

type CallExpr = Expr & { k: 'call' };

const isUpperName = (s: string): boolean => s.length > 0 && (s[0] as string) >= 'A' && (s[0] as string) <= 'Z';

export class Bail extends Error {}

/** A figure with one object's info replaced; used to re-check dependents and to preview. */
export class OverlayFigure implements FigureView {
  constructor(
    private readonly base: FigureView,
    private readonly over: ReadonlyMap<string, ObjectInfo | null>,
  ) {}
  get commands() {
    return this.base.commands;
  }
  get functions(): FunctionTable | undefined {
    return this.base.functions;
  }
  get directives() {
    return this.base.directives;
  }
  get size() {
    return this.base.size;
  }
  lookup(name: string): ObjectInfo | undefined {
    if (this.over.has(name)) return this.over.get(name) ?? undefined;
    return this.base.lookup(name);
  }
  byId(id: ObjId): ObjectInfo | undefined {
    for (const o of this.over.values()) if (o && o.id === id) return o;
    return this.base.byId(id);
  }
  names(): readonly string[] {
    const n = this.base.names().filter((x) => !(this.over.has(x) && this.over.get(x) === null));
    for (const [k, v] of this.over) if (v && !n.includes(k)) n.push(k);
    return n;
  }
  inputsOf(id: ObjId): readonly ObjId[] {
    return this.base.inputsOf(id);
  }
  dependentsOf(id: ObjId): readonly ObjectInfo[] {
    return this.base.dependentsOf(id);
  }
  styleRulesReading(id: ObjId): readonly { readonly name: string; readonly source: string }[] {
    return this.base.styleRulesReading?.(id) ?? [];
  }
  read(id: ObjId): unknown {
    return this.base.read?.(id);
  }
  clock() {
    return this.base.clock?.() ?? { t: 0, bt: 0, beat: 0 };
  }
}

/* ------------------------------- the checker ------------------------------- */

class Checker {
  readonly diag: Diag;
  readonly sm;
  errors: LanguageError[] = [];
  notices: Notice[] = [];
  reads = new Set<ObjId>();
  usesT = false;
  hasCommand = false;
  /**
   * The one call that may be an action: the whole of an action line. Any other call to a command whose forms return
   * nothing is used as a value, and an action is not a value.
   */
  actionCall: CallExpr | null = null;
  /** Reads of range bounds and style values, kept apart from the reads of the value (see `apart`). */
  readonly rangeReads = new Set<ObjId>();
  readonly styleReads = new Set<ObjId>();
  styleUsesT = false;
  rangeUsesT = false;
  scopes: Frame[] = [];
  slotCount = 0;
  nodes = 0;
  readonly functions: FunctionTable;
  /** Text of the right-hand side and its owner, for fixes. */
  ctx: { name?: string | undefined; rhsStart?: number | undefined; rhsEnd?: number | undefined; defineLine?: boolean | undefined } = {};

  constructor(
    public fig: FigureView,
    readonly parsed: ParsedLine,
    readonly opts: CheckOptions,
  ) {
    this.sm = parsed.sm;
    this.diag = new Diag(parsed.sm);
    this.functions = fig.functions ?? BUILTIN_FUNCTIONS;
  }

  get text(): string {
    return this.sm.text;
  }

  /* ------------------------------ error sink ------------------------------ */

  /**
   * Runs `fn` with fresh checker state and records what it read in the range or style set instead of the value's reads,
   * so a slider bound or a style value never makes a free object dependent. Every field that decides whether the value
   * is free (`reads`, `usesT`, `hasCommand`) is saved and put back, so a command call or a clock read inside a bound or
   * a style value leaves the value's facts as they were.
   */
  apart<R>(bucket: 'range' | 'style', fn: () => R): R {
    const savedReads = this.reads;
    const savedT = this.usesT;
    const savedCommand = this.hasCommand;
    this.reads = new Set<ObjId>();
    this.usesT = false;
    try {
      return fn();
    } finally {
      const into = bucket === 'range' ? this.rangeReads : this.styleReads;
      for (const id of this.reads) into.add(id);
      if (this.usesT) {
        if (bucket === 'range') this.rangeUsesT = true;
        else this.styleUsesT = true;
      }
      this.reads = savedReads;
      this.usesT = savedT;
      this.hasCommand = savedCommand;
    }
  }

  /**
   * Runs `fn` with the object a defining line is making visible under its own name (Q-R4-1), so a name in the line's
   * `with` list resolves to it. `self` is undefined when the object already exists (its name resolves anyway) or its type
   * is not known because the line already has an error.
   */
  withSelf<R>(self: ObjectInfo | undefined, fn: () => R): R {
    if (!self) return fn();
    const saved = this.fig;
    this.fig = new OverlayFigure(saved, new Map([[self.name, self]]));
    try {
      return fn();
    } finally {
      this.fig = saved;
    }
  }

  err(kind: string, s: number, e: number, key: string, params: Record<string, string | number | boolean | readonly string[]>, extra: ErrorExtra = {}): null {
    if (this.errors.length < MAX_ERRORS_PER_LINE) this.errors.push(this.diag.at(kind, s, e, key, params, extra));
    return null;
  }

  warn(n: Notice): void {
    this.notices.push(n);
  }

  spanOf(s: number, e: number): { line: number; col: number; endCol: number } {
    const sp = this.sm.span(s, e);
    return { line: sp.line, col: sp.col, endCol: sp.endCol };
  }

  /* ------------------------------- scopes ------------------------------- */

  pushFrame(): Frame {
    const f: Frame = { vars: new Map() };
    this.scopes.push(f);
    return f;
  }
  popFrame(): void {
    this.scopes.pop();
  }
  bindLocal(f: Frame, name: string, ty: Ty, s: number, e: number, unit?: 'angle'): number {
    const slot = this.slotCount++;
    f.vars.set(name, { slot, ty, ...(unit ? { unit } : {}) });
    const hid = this.fig.lookup(name);
    if (hid) {
      const sp = this.spanOf(s, e);
      this.warn(notice('shadowed', 'warning', `${name} hides the ${tyStr(hid.type)} object ${name} inside this expression.`, { name, ...sp }, [name]));
    }
    return slot;
  }
  warnShadow(name: string, s: number, e: number): void {
    const hid = this.fig.lookup(name);
    if (hid) this.warn(notice('shadowed', 'warning', `${name} hides the ${tyStr(hid.type)} object ${name} inside this expression.`, { name, ...this.spanOf(s, e) }, [name]));
  }
  lookupLocal(name: string): { slot: number; ty: Ty; unit?: 'angle' } | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const v = (this.scopes[i] as Frame).vars.get(name);
      if (v) return v;
    }
    return undefined;
  }

  /* -------------------------------- helpers -------------------------------- */

  node(): void {
    const max = this.opts.limits?.exprNodes ?? MAX_NODES;
    if (++this.nodes === max + 1) {
      this.err('limit', 0, this.text.length, 'lang.limit', { limit: 'expr_nodes', max, got: this.nodes, what: 'expression nodes in a line' }, {
        hint: 'Split the line into several objects.',
        limit: { name: 'expr_nodes', max, got: this.nodes },
        fingerprintKey: 'expr_nodes',
      });
      throw new Bail();
    }
  }

  textOf(e: { s: number; e: number }): string {
    return this.text.slice(e.s, e.e);
  }

  replaceRange(s: number, e: number, repl: string): string {
    return this.text.slice(0, s) + repl + this.text.slice(e);
  }

  /** Free `x`/`y` used in an expression, outside any binding. */
  freeVars(e: Expr, out = new Set<string>()): Set<string> {
    const walk = (n: Expr): void => {
      switch (n.k) {
        case 'name':
          if ((n.name === 'x' || n.name === 'y') && !this.lookupLocal(n.name)) out.add(n.name);
          break;
        case 'unary':
        case 'fact':
        case 'deg':
          walk(n.arg);
          break;
        case 'bin':
          walk(n.l);
          walk(n.r);
          break;
        case 'cmp':
          n.operands.forEach(walk);
          break;
        case 'call':
          n.args.forEach((a) => walk(a.value));
          break;
        case 'tick':
          n.args.forEach(walk);
          break;
        case 'index':
          walk(n.target);
          walk(n.index);
          break;
        case 'field':
          walk(n.target);
          break;
        case 'tuple':
        case 'list':
          n.items.forEach(walk);
          break;
        case 'cond':
          n.args.forEach(walk);
          break;
        case 'polar':
          walk(n.r);
          walk(n.a);
          break;
        case 'range':
          walk(n.from);
          walk(n.to);
          if (n.step) walk(n.step);
          break;
        case 'str':
          n.parts.forEach((p) => {
            if (typeof p !== 'string') walk(p.expr);
          });
          break;
        default:
          break;
      }
    };
    walk(e);
    return out;
  }

  /** Is the expression a comparison or a logic tree of comparisons? */
  relationCapable(e: Expr): boolean {
    if (e.k === 'cmp') return true;
    if (e.k === 'unary' && e.op === 'not') return this.relationCapable(e.arg);
    if (e.k === 'bin' && (e.op === 'and' || e.op === 'or' || e.op === 'xor')) return this.relationCapable(e.l) || this.relationCapable(e.r);
    return false;
  }

  /* ------------------------------ expressions ------------------------------ */

  infer(e: Expr, expected?: Ty): TNode | null {
    this.node();
    switch (e.k) {
      case 'num':
        return { n: 'num', v: e.v, ty: T.Number, s: e.s, e: e.e };
      case 'bool':
        return { n: 'bool', v: e.v, ty: T.Bool, s: e.s, e: e.e };
      case 'undef':
        return { n: 'undef', ty: expected && expected.k !== 'Relation' ? expected : T.Number, s: e.s, e: e.e };
      case 'str':
        return this.inferText(e);
      case 'name':
        return this.inferName(e);
      case 'unary':
        return this.inferUnary(e, expected);
      case 'bin':
        return this.inferBin(e);
      case 'cmp':
        return this.inferCmp(e);
      case 'call':
        return this.inferCall(e, expected);
      case 'tick':
        return this.inferTick(e);
      case 'index':
        return this.inferIndex(e);
      case 'field':
        return this.inferField(e);
      case 'fact': {
        const a = this.infer(e.arg);
        if (!a) return null;
        if (a.ty.k !== 'Number') return this.mismatchUnary('!', a, e);
        return { n: 'fact', arg: a, ty: T.Number, s: e.s, e: e.e };
      }
      case 'deg': {
        const a = this.infer(e.arg);
        if (!a) return null;
        if (a.ty.k !== 'Number') return this.mismatchUnary('°', a, e);
        const deg = constantByName('deg');
        const d: TNode = { n: 'const', name: 'deg', value: deg?.value, ty: T.Number, s: e.e - 1, e: e.e, unit: 'angle' };
        return { n: 'bin', op: '*', l: a, r: d, variant: 'num', ty: T.Number, unit: 'angle', s: e.s, e: e.e };
      }
      case 'tuple':
        return this.inferTuple(e);
      case 'polar': {
        const r = this.infer(e.r);
        const a = this.infer(e.a);
        if (!r || !a) return null;
        for (const [x, label] of [[r, 'radius'], [a, 'angle']] as const) {
          if (x.ty.k !== 'Number') {
            return this.err('type_mismatch', x.s, x.e, 'lang.type_mismatch_where', { why: `A polar point takes a ${label} that is a Number, not a ${tyStr(x.ty)}` }, {
              hint: 'Write (r; angle) with two numbers, for example (2; 30°).',
              left: tyStr(x.ty),
              fingerprintKey: 'polar',
            });
          }
        }
        return { n: 'polar', r, a, ty: T.Point, s: e.s, e: e.e };
      }
      case 'list':
        return this.inferList(e, expected);
      case 'range':
        return this.inferRange(e);
      case 'cond':
        return this.inferCond(e, expected);
    }
  }

  inferText(e: Expr & { k: 'str' }): TNode | null {
    const parts: (string | { e: TNode; fmt?: string })[] = [];
    let ok = true;
    let total = 0;
    for (const p of e.parts) {
      if (typeof p === 'string') {
        parts.push(p);
        total += p.length;
        continue;
      }
      const t = this.infer(p.expr);
      if (!t) {
        ok = false;
        continue;
      }
      if (!['Number', 'Bool', 'Text', 'Point', 'Vector'].includes(t.ty.k)) {
        this.err('type_mismatch', p.expr.s, p.expr.e, 'lang.type_mismatch_where', { why: `A text can show a Number, Bool, Text, Point or Vector, not a ${tyStr(t.ty)}` }, {
          hint: 'Show a number from it instead, for example its .length or .x.',
          left: tyStr(t.ty),
          fingerprintKey: 'text_part',
        });
        ok = false;
        continue;
      }
      parts.push(p.fmt !== undefined ? { e: t, fmt: p.fmt } : { e: t });
    }
    if (total > 10000) {
      return this.err('limit', e.s, e.e, 'lang.limit', { limit: 'text_length', max: 10000, got: total, what: 'characters in a text' }, {
        limit: { name: 'text_length', max: 10000, got: total },
        fingerprintKey: 'text_length',
      });
    }
    if (!ok) return null;
    return { n: 'text', parts, ty: T.Text, s: e.s, e: e.e };
  }

  inferName(e: Expr & { k: 'name' }): TNode | null {
    const name = e.name;
    const loc = this.lookupLocal(name);
    if (loc) return { n: 'local', slot: loc.slot, name, ty: loc.ty, s: e.s, e: e.e, ...(loc.unit ? { unit: loc.unit } : {}) };
    if (name === 't' || name === 'bt' || name === 'beat') {
      this.usesT = true;
      return { n: 'clock', which: name, ty: T.Number, s: e.s, e: e.e };
    }
    const c = constantByName(name);
    if (c) return { n: 'const', name, value: c.value, ty: c.type, s: e.s, e: e.e, ...(c.unit ? { unit: c.unit } : {}) };
    if (name === 'x' || name === 'y') return this.freeVariable(e);
    const obj = this.fig.lookup(name);
    if (obj) {
      this.reads.add(obj.id);
      return { n: 'ref', id: obj.id, name, ty: obj.type, s: e.s, e: e.e, ...(obj.unit ? { unit: obj.unit } : {}) };
    }
    return this.unknownName(e);
  }

  freeVariable(e: Expr & { k: 'name' }): null {
    const rhsStart = this.ctx.rhsStart;
    const rhsEnd = this.ctx.rhsEnd;
    const owner = this.ctx.name;
    const extra: ErrorExtra = { fingerprintKey: e.name };
    if (owner && this.ctx.defineLine && rhsStart !== undefined && rhsEnd !== undefined) {
      const rhs = this.text.slice(rhsStart, rhsEnd).trim();
      const rhsExpr = this.parsed.node.k === 'define' ? this.parsed.node.expr : undefined;
      const vars = rhsExpr ? [...this.freeVars(rhsExpr)] : [e.name];
      const isCall = rhsExpr?.k === 'call';
      const v = vars.length === 1 ? (vars[0] as string) : undefined;
      const lines: string[] = [];
      if (v) lines.push(`${owner}(${v}) = ${rhs}`);
      extra.hint = `Write a function: ${owner}(${v ?? 'x'}) = ${rhs}, ${isCall ? `or call ${(rhsExpr as CallExpr).callee} at a number: ${owner} = ${(rhsExpr as CallExpr).callee}(2).` : `or an equation: l = y == ${rhs}.`}`;
      if (lines.length > 0) extra.suggest = lines;
    } else {
      extra.hint = 'Use x and y only inside a function definition f(x) = … or an equation like l = y == 2x + 1.';
    }
    return this.err('free_variable', e.s, e.e, 'lang.free_variable', { name: e.name, owner: owner ?? 'this object', type: 'number' }, extra);
  }

  knownTokenNames(): string[] {
    const out: string[] = [...CONSTANT_NAMES.filter((n) => n !== 'undefined'), 't'];
    for (const f of this.scopes) for (const k of f.vars.keys()) out.push(k);
    for (const n of this.fig.names()) out.push(n);
    return out;
  }

  splitProduct(name: string): string[] | undefined {
    const known = new Set(this.knownTokenNames());
    const best: (string[] | undefined)[] = new Array(name.length + 1).fill(undefined);
    best[0] = [];
    for (let i = 1; i <= name.length; i++) {
      for (let j = 0; j < i; j++) {
        const prev = best[j];
        if (prev === undefined) continue;
        const piece = name.slice(j, i);
        if (known.has(piece) && prev.length < 4) {
          const cand = [...prev, piece];
          const cur = best[i];
          if (cur === undefined || cand.length < cur.length) best[i] = cand;
        }
      }
    }
    const r = best[name.length];
    return r && r.length >= 2 ? r : undefined;
  }

  unknownName(e: Expr & { k: 'name' }): null {
    const name = e.name;
    const blocked = this.opts.failed?.get(name);
    const extra: ErrorExtra = { fingerprintKey: name };
    if (blocked) {
      extra.blockedBy = { line: blocked.line, kind: blocked.kind };
      extra.after = blocked.line;
      extra.recovery = 'fix_earlier';
      extra.hint = `${name} was not created because line ${blocked.line} failed. Fix that line first, then send this one again.`;
      return this.err('unknown_name', e.s, e.e, 'lang.unknown_name', { name }, extra);
    }
    if (this.commandsHas(name)) {
      return this.err('unknown_command', e.s, e.e, 'lang.unknown_command', { name }, {
        hint: `${name} is a command: call it with arguments, for example ${name}(…).`,
        fingerprintKey: name,
      });
    }
    if (this.functions.lookup(name)) {
      return this.err('unknown_name', e.s, e.e, 'lang.unknown_name', { name }, {
        hint: `${name} is a built-in function: call it with brackets, for example ${name}(x).`,
        fingerprintKey: name,
      });
    }
    if (name === 'zaxis') {
      return this.err('unknown_name', e.s, e.e, 'lang.unknown_name', { name }, { hint: 'zaxis belongs to 3D figures.', fingerprintKey: name });
    }
    const split = this.simpleUnknown ? undefined : this.splitProduct(name);
    // a constant is never a near name for a typo (`e` would match every short name), and only a word of its own length can be
    const close = closestNames(name, [...this.fig.names(), ...CONSTANT_NAMES.filter((c) => c.length > 1), ...this.scopeNames()], 3);
    const want = this.wants.get(e);
    const suggest: string[] = [];
    if (split) {
      suggest.push(this.replaceRange(e.s, e.e, split.join(' * ')));
      const uniq = [...new Set(split)];
      extra.hint = uniq.length === split.length ? `${split.length === 2 ? split.join(' and ') : split.slice(0, -1).join(', ') + ' and ' + split[split.length - 1]} ${split.length === 2 ? 'both' : 'all'} exist. Did you mean ${split.join(' * ')}?` : `Did you mean ${split.join(' * ')}?`;
    } else if (close.length > 0) {
      extra.hint = `Did you mean ${close.join(' or ')}?`;
      for (const c of close.slice(0, 2)) suggest.push(this.replaceRange(e.s, e.e, c));
    } else {
      extra.hint = 'Make it a number first, or pick an existing name.';
    }
    if (suggest.length > 0) extra.suggest = suggest;
    if (split && suggest.length > 0) extra.fix = suggest[0] as string;
    // a slider that was never made
    if (!this.simpleUnknown && !nameProblem(name) && !reservedGroup(name, this.fig.commands, this.functions)) {
      const original = this.parsed.sm.text;
      // the line that makes the name what the argument needs: a slider for a number, a point for a point, nothing for a type with no plain literal
      if (want === undefined || want === 'Number') {
        const slider = `${name} = 1 in -5..5 step 0.1`;
        const qf: QuickFix[] = [{ label: `Create slider ${name} from -5 to 5`, lines: [slider, original] }];
        extra.quickFixes = qf;
      } else {
        const def = defineLine(name, want);
        if (def !== undefined) extra.quickFixes = [{ label: `Create ${want} ${name}`, lines: [def, original] }];
      }
    }
    return this.err('unknown_name', e.s, e.e, 'lang.unknown_name', want !== undefined ? { name, type: want } : { name }, extra);
  }

  unknownNameAt(t: { name: string; s: number; e: number }): null {
    this.simpleUnknown = true;
    try {
      return this.unknownName({ k: 'name', name: t.name, s: t.s, e: t.e });
    } finally {
      this.simpleUnknown = false;
    }
  }
  simpleUnknown = false;
  /** The type a bare name needs in its argument position, when the forms that fit agree; `Any` when it has no plain literal. */
  readonly wants = new Map<Expr, string>();

  scopeNames(): string[] {
    const out: string[] = [];
    for (const f of this.scopes) for (const k of f.vars.keys()) out.push(k);
    return out;
  }

  commandsHas(name: string): boolean {
    return this.fig.commands.lookup(name) !== undefined;
  }

  mismatchUnary(op: string, a: TNode, e: Expr): null {
    return this.err('type_mismatch', e.s, e.e, 'lang.type_mismatch_unary', { op, left: tyStr(a.ty) }, {
      left: tyStr(a.ty),
      hint: `${op} works on a Number.`,
      fingerprintKey: `${op}:${tyStr(a.ty)}`,
    });
  }

  inferUnary(e: Expr & { k: 'unary' }, expected?: Ty): TNode | null {
    const a = this.infer(e.arg, expected);
    if (!a) return null;
    if (e.op === 'not') {
      if (a.ty.k !== 'Bool') return this.mismatchUnary('not', a, e);
      return { n: 'unary', op: 'not', arg: a, ty: T.Bool, s: e.s, e: e.e };
    }
    const ok = a.ty.k === 'Number' || a.ty.k === 'Vector' || (a.ty.k === 'Function' && a.ty.ret === 'Number');
    if (!ok) return this.mismatchUnary(e.op, a, e);
    return { n: 'unary', op: e.op, arg: a, ty: a.ty, s: e.s, e: e.e, ...(a.unit ? { unit: a.unit } : {}) };
  }

  unitOf(op: string, l: TNode, r: TNode): 'angle' | undefined {
    if (l.ty.k !== 'Number' || r.ty.k !== 'Number') return undefined;
    const la = l.unit === 'angle';
    const ra = r.unit === 'angle';
    if ((op === '+' || op === '-') && la && ra) return 'angle';
    if (op === '*' && (la !== ra)) return 'angle';
    if (op === '/' && la && !ra) return 'angle';
    return undefined;
  }

  inferBin(e: Expr & { k: 'bin' }): TNode | null {
    const l = this.infer(e.l);
    const r = this.infer(e.r);
    if (!l || !r) return null;
    const res = binaryOp(e.op, l.ty, r.ty);
    if (!res) return this.mismatch(e.op, l, r, e);
    const unit = this.unitOf(e.op, l, r);
    return { n: 'bin', op: e.op, l, r, variant: res.variant, ty: res.result, s: e.s, e: e.e, ...(unit ? { unit } : {}) };
  }

  mismatch(op: string, l: TNode, r: TNode, e: { s: number; e: number }): null {
    const lt = tyStr(l.ty);
    const rt = tyStr(r.ty);
    const a = this.textOf(l);
    const b = this.textOf(r);
    const extra: ErrorExtra = { left: lt, right: rt, fingerprintKey: `${op}:${lt}:${rt}` };
    const whole = this.ctx.rhsStart === e.s && this.ctx.rhsEnd === e.e && this.ctx.name !== undefined;
    const name = this.ctx.name;
    const num = (t: Ty): boolean => t.k === 'Number';
    if (op === '*' && l.ty.k === 'Point' && r.ty.k === 'Point') {
      extra.hint = `For the distance, use Distance(${a}, ${b}). For a vector, use Vector(${a}, ${b}).`;
      if (whole) extra.suggest = [`${name} = Distance(${a}, ${b})`];
    } else if (op === '*' && ((num(l.ty) && r.ty.k === 'Point') || (l.ty.k === 'Point' && num(r.ty)))) {
      const k = num(l.ty) ? a : b;
      const p = num(l.ty) ? b : a;
      extra.hint = `A point is a position, not a vector. To scale a position about the origin write ${k} * Vector(${p}); to scale about a centre use Dilate(${p}, ${k}, C).`;
      if (whole) {
        extra.quickFixes = [
          { label: 'Position vector', lines: [`${name} = ${k} * Vector(${p})`] },
          { label: 'Dilate about the origin', lines: [`${name} = Dilate(${p}, ${k}, (0, 0))`] },
        ];
      }
    } else if (op === '+' && l.ty.k === 'Point' && r.ty.k === 'Point') {
      extra.hint = `Two positions cannot be added. Add a Vector to a Point, or use Midpoint(${a}, ${b}) for the point halfway between.`;
    } else if (op === '*' && l.ty.k === 'Vector' && r.ty.k === 'Vector') {
      extra.hint = `Use dot(${a}, ${b}) for the dot product or cross(${a}, ${b}) for the 2D cross product.`;
    } else {
      const legal = legalOpsFor(op, l.ty);
      extra.hint = legal.length > 0 ? `${lt} ${op} works with: ${legal.join(', ')}.` : `${op} is not defined for a ${lt} on the left.`;
    }
    return this.err('type_mismatch', e.s, e.e, 'lang.type_mismatch', { op: OP_WORDS[op] ?? op, left: lt, right: rt }, extra);
  }

  inferCmp(e: Expr & { k: 'cmp' }): TNode | null {
    const ops = e.operands.map((o) => this.infer(o));
    if (ops.some((o) => o === null)) return null;
    const ts = ops as TNode[];
    for (let i = 0; i < e.ops.length; i++) {
      const l = ts[i] as TNode;
      const r = ts[i + 1] as TNode;
      if (!binaryOp(e.ops[i] as string, l.ty, r.ty)) {
        const p = e.opPos[i];
        return this.mismatch(e.ops[i] as string, l, r, { s: l.s, e: r.e }) ?? (p ? null : null);
      }
    }
    return { n: 'cmp', ops: e.ops as readonly CmpOp[], operands: ts, ty: T.Bool, s: e.s, e: e.e };
  }

  inferTuple(e: Expr & { k: 'tuple' }): TNode | null {
    if (e.items.length !== 2) {
      const third = e.items[2] as Expr;
      return this.err('syntax', third.s, third.e, 'lang.syntax', { token: this.textOf(third), expected: ')' }, {
        expected: [')'],
        hint: 'A point has two coordinates: (x, y).',
        fingerprintKey: 'tuple',
      });
    }
    const xs = e.items.map((i) => this.infer(i));
    if (xs.some((x) => x === null)) return null;
    const [x, y] = xs as [TNode, TNode];
    for (const c of [x, y]) {
      if (c.ty.k !== 'Number') {
        return this.err('type_mismatch', c.s, c.e, 'lang.type_mismatch_where', { why: `A point takes two Numbers, but this is a ${tyStr(c.ty)}` }, {
          hint: 'Write (x, y) with two numbers. For a position built from points use Vector or Midpoint.',
          left: tyStr(c.ty),
          fingerprintKey: 'point',
        });
      }
    }
    return { n: 'point', x, y, ty: T.Point, s: e.s, e: e.e };
  }

  unify(items: TNode[], what: string): Ty | null {
    let ty: Ty | undefined;
    for (let i = 0; i < items.length; i++) {
      const it = items[i] as TNode;
      if (it.n === 'undef') continue;
      if (!ty) ty = it.ty;
      else if (!tyEq(ty, it.ty)) {
        this.err('type_mismatch', it.s, it.e, 'lang.type_mismatch_where', { why: `${what} item ${i + 1} is a ${tyStr(it.ty)} but the first is a ${tyStr(ty)}` }, {
          hint: `${what} holds one kind of value. Make every item a ${tyStr(ty)}.`,
          left: tyStr(ty),
          right: tyStr(it.ty),
          fingerprintKey: `${tyStr(ty)}:${tyStr(it.ty)}`,
        });
        return null;
      }
    }
    return ty ?? T.Number;
  }

  inferList(e: Expr & { k: 'list' }, expected?: Ty): TNode | null {
    const maxItems = this.opts.limits?.listSize ?? 10000;
    if (e.items.length > maxItems) {
      return this.err('limit', e.s, e.e, 'lang.limit', { limit: 'list_size', max: maxItems, got: e.items.length, what: 'items in a list literal' }, {
        hint: 'Split the list, or build it with a range or Seq.',
        limit: { name: 'list_size', max: maxItems, got: e.items.length },
        fingerprintKey: 'list_size',
      });
    }
    if (e.items.length === 0) {
      if (expected && expected.k === 'List' && expected.of) return { n: 'list', items: [], ty: expected, s: e.s, e: e.e };
      return this.err('empty_list_type', e.s, e.e, 'lang.empty_list_type', {}, {
        hint: 'Start the list with a first item, or build it with Seq.',
        fingerprintKey: 'empty',
      });
    }
    const hint = expected && expected.k === 'List' ? expected.of : undefined;
    const items = e.items.map((i) => this.infer(i, hint));
    if (items.some((i) => i === null)) return null;
    const ts = items as TNode[];
    const el = this.unify(ts, 'A list');
    if (!el) return null;
    if (el.k === 'List' && ts.every((x) => x.n === 'list')) {
      const len0 = (ts[0] as TNode & { n: 'list' }).items.length;
      const odd = ts.findIndex((x) => (x as TNode & { n: 'list' }).items.length !== len0);
      if (odd > 0) {
        const bad = ts[odd] as TNode;
        return this.err('type_mismatch', bad.s, bad.e, 'lang.type_mismatch_where', { why: `Row ${odd + 1} has ${(bad as TNode & { n: 'list' }).items.length} items but the first row has ${len0}` }, {
          hint: 'The rows of a matrix must have the same length.',
          fingerprintKey: 'matrix_rows',
        });
      }
    }
    return { n: 'list', items: ts, ty: listOf(el), s: e.s, e: e.e };
  }

  inferRange(e: Expr & { k: 'range' }): TNode | null {
    const from = this.infer(e.from);
    const to = this.infer(e.to);
    const step = e.step ? this.infer(e.step) : undefined;
    if (!from || !to || (e.step && !step)) return null;
    for (const b of [from, to, ...(step ? [step] : [])]) {
      if (b.ty.k !== 'Number') {
        return this.err('type_mismatch', b.s, b.e, 'lang.type_mismatch_where', { why: `A range [a..b] takes Numbers, not a ${tyStr(b.ty)}` }, {
          left: tyStr(b.ty),
          fingerprintKey: 'range',
        });
      }
    }
    const a = foldNumber(from);
    const z = foldNumber(to);
    const st = step ? foldNumber(step) : 1;
    if (a !== undefined && z !== undefined && st !== undefined && Number.isFinite(a) && Number.isFinite(z) && st !== 0) {
      const count = Math.floor((z - a) / st + 1e-9) + 1;
      const maxRange = this.opts.limits?.listSize ?? MAX_RANGE_ELEMENTS;
      if (count > maxRange) {
        return this.err('limit', e.s, e.e, 'lang.limit', { limit: 'range_elements', max: maxRange, got: count, what: 'list items' }, {
          hint: 'Use a smaller range, or Seq with a step, or compute the value with a formula instead of a list.',
          limit: { name: 'range_elements', max: maxRange, got: count },
          fingerprintKey: 'range_elements',
        });
      }
    }
    return { n: 'range', from, to, ...(step ? { step } : {}), ty: listOf(T.Number), s: e.s, e: e.e };
  }

  inferCond(e: Expr & { k: 'cond' }, expected?: Ty): TNode | null {
    const n = e.args.length;
    if (n < 2) {
      return this.err('arg_count', e.s, e.e, 'lang.arg_count', { name: 'if', n: 2, m: n }, {
        forms: ['if(condition, value)', 'if(condition, value, otherwise)', 'if(c1, v1, c2, v2, …, otherwise)'],
        hint: 'Give a condition and a value: if(x > 0, x, -x).',
        fingerprintKey: 'if',
      });
    }
    const hasOtherwise = n % 2 === 1;
    const armCount = hasOtherwise ? (n - 1) / 2 : n / 2;
    const arms: { c: TNode; v: TNode }[] = [];
    let ok = true;
    const values: TNode[] = [];
    for (let i = 0; i < armCount; i++) {
      const c = this.infer(e.args[2 * i] as Expr);
      const v = this.infer(e.args[2 * i + 1] as Expr, expected);
      if (!c || !v) {
        ok = false;
        continue;
      }
      if (c.ty.k !== 'Bool') {
        this.err('type_mismatch', c.s, c.e, 'lang.type_mismatch_where', { why: `An if condition must be a Bool, but this is a ${tyStr(c.ty)}` }, {
          hint: 'Use a comparison such as x > 0.',
          left: tyStr(c.ty),
          fingerprintKey: 'if_cond',
        });
        ok = false;
        continue;
      }
      arms.push({ c, v });
      values.push(v);
    }
    let otherwise: TNode | undefined;
    if (hasOtherwise) {
      const o = this.infer(e.args[n - 1] as Expr, expected);
      if (!o) ok = false;
      else {
        otherwise = o;
        values.push(o);
      }
    }
    if (!ok) return null;
    const ty = this.unify(values, 'An if');
    if (!ty) return null;
    const retyped = (x: TNode): TNode => (x.n === 'undef' ? { ...x, ty } : x);
    return { n: 'cond', arms: arms.map((a) => ({ c: a.c, v: retyped(a.v) })), ...(otherwise ? { otherwise: retyped(otherwise) } : {}), ty, s: e.s, e: e.e };
  }

  inferIndex(e: Expr & { k: 'index' }): TNode | null {
    const t = this.infer(e.target);
    const i = this.infer(e.index);
    if (!t || !i) return null;
    if (t.ty.k !== 'List' || !t.ty.of) {
      return this.err('type_mismatch', e.s, e.e, 'lang.type_mismatch_where', { why: `Only a List can be indexed, but this is a ${tyStr(t.ty)}` }, {
        left: tyStr(t.ty),
        hint: 'Index a list with L[1] (the first item). Fields use a dot: P.x.',
        fingerprintKey: 'index',
      });
    }
    if (i.ty.k !== 'Number') {
      return this.err('type_mismatch', i.s, i.e, 'lang.type_mismatch_where', { why: `A list index must be a Number, not a ${tyStr(i.ty)}` }, {
        left: tyStr(i.ty),
        fingerprintKey: 'index_type',
      });
    }
    if (i.n === 'num' && (i.v === 0 || !Number.isInteger(i.v))) {
      this.warn(
        notice('index_literal', 'warning', `Index ${i.v} is not a whole number from 1 (or -1 from the end); the result will be undefined.`, { index: i.v, ...this.spanOf(i.s, i.e) }),
      );
    }
    return { n: 'index', target: t, index: i, ty: t.ty.of, s: e.s, e: e.e };
  }

  inferField(e: Expr & { k: 'field' }): TNode | null {
    const t = this.infer(e.target);
    if (!t) return null;
    const table = own(FIELDS, t.ty.k);
    const f = table ? own(table, e.field) : undefined;
    if (!f) {
      const avail = table ? Object.keys(table) : [];
      return this.err('type_mismatch', e.fs, e.fe, 'lang.type_mismatch_where', { why: `A ${tyStr(t.ty)} has no field ${e.field}` }, {
        left: tyStr(t.ty),
        expected: avail,
        hint: avail.length > 0 ? `A ${tyStr(t.ty)} has the fields ${avail.join(', ')}.` : `A ${tyStr(t.ty)} has no fields.`,
        suggest: closestNames(e.field, avail, 2).map((c) => this.replaceRange(e.fs, e.fe, c)),
        fingerprintKey: `${t.ty.k}.${e.field}`,
      });
    }
    return { n: 'field', target: t, field: e.field, ty: f, s: e.s, e: e.e };
  }

  inferTick(e: Expr & { k: 'tick' }): TNode | null {
    const obj = this.fig.lookup(e.callee);
    if (!obj) return this.unknownName({ k: 'name', name: e.callee, s: e.cs, e: e.ce });
    if (obj.type.k !== 'Function' || obj.type.ret !== 'Number' || (obj.type.arity ?? 1) !== 1) {
      return this.err('not_callable', e.cs, e.ce, 'lang.not_callable', { name: e.callee, type: tyStr(obj.type) }, {
        hint: `${e.callee}'(x) needs a function of one variable.`,
        fingerprintKey: e.callee,
      });
    }
    if (e.ticks > 3) {
      return this.err('limit', e.cs, e.e, 'lang.limit', { limit: 'ticks', max: 3, got: e.ticks, what: 'derivative marks' }, {
        limit: { name: 'ticks', max: 3, got: e.ticks },
        fingerprintKey: 'ticks',
      });
    }
    this.reads.add(obj.id);
    if (e.args.length !== 1) {
      return this.err('arg_count', e.cs, e.e, 'lang.arg_count', { name: e.callee, n: 1, m: e.args.length }, {
        forms: [`${e.callee}'(x) -> Number`],
        hint: `Call it with one number: ${e.callee}'(2).`,
        fingerprintKey: e.callee,
      });
    }
    const a = this.infer(e.args[0] as Expr);
    if (!a) return null;
    if (a.ty.k !== 'Number') return this.mismatchUnary("'", a, e);
    return { n: 'tick', id: obj.id, name: e.callee, ticks: e.ticks, arg: a, ty: T.Number, s: e.s, e: e.e };
  }

  /* --------------------------------- calls --------------------------------- */

  notCallable(e: CallExpr, type: string, isNumber: boolean): null {
    const extra: ErrorExtra = { fingerprintKey: e.callee };
    if (isNumber) {
      extra.suggest = [this.replaceRange(e.ce, e.ce, this.text[e.ce] === ' ' ? ' *' : ' * ')];
      extra.hint = `${e.callee} is a Number, so (…) after it is not a call. To multiply write ${e.callee} * (…).`;
    } else {
      extra.hint = `${e.callee} is not a function or command.`;
    }
    return this.err('not_callable', e.cs, e.ce, 'lang.not_callable', { name: e.callee, type }, extra);
  }

  inferCall(e: CallExpr, expected?: Ty): TNode | null {
    const name = e.callee;
    if (e.args.length > MAX_COMMAND_ARGS) {
      return this.err('limit', e.s, e.e, 'lang.limit', { limit: 'command_args', max: MAX_COMMAND_ARGS, got: e.args.length, what: 'arguments in a call' }, {
        limit: { name: 'command_args', max: MAX_COMMAND_ARGS, got: e.args.length },
        fingerprintKey: 'command_args',
      });
    }
    // PascalCase: commands only
    if (isUpperName(name)) {
      const spec = this.fig.commands.lookup(name);
      if (!spec) return this.unknownCommand(e);
      return this.inferCommand(e, spec, expected);
    }
    const loc = this.lookupLocal(name);
    if (loc) return this.notCallable(e, tyStr(loc.ty), true);
    if (name === 'state') {
      return this.err('bad_argument', e.s, e.e, 'lang.bad_argument', { command: 'state', why: 'state(...) must be the whole right-hand side of a definition, such as θ = state(0.6)' }, {
        hint: 'Write θ = state(0.6) on its own line.',
        fingerprintKey: 'state',
      });
    }
    if (name === 't' || name === 'bt' || name === 'beat' || name === 'x' || name === 'y') {
      const fix = this.replaceRange(e.ce, e.ce, this.text[e.ce] === ' ' ? ' *' : ' * ');
      return this.err('not_callable', e.cs, e.ce, 'lang.not_callable', { name, type: 'Number' }, {
        hint: `${name} is a Number, so (…) after it is not a call. To multiply write ${name} * (…).`,
        suggest: [fix],
        fingerprintKey: name,
      });
    }
    if (constantByName(name)) return this.notCallable(e, 'Number', true);
    const bspec = this.functions.lookup(name);
    if (bspec) return this.inferBuiltin(e, bspec, expected);
    const obj = this.fig.lookup(name);
    if (obj) {
      if (obj.type.k === 'Function') return this.inferCallObj(e, obj);
      return this.notCallable(e, tyStr(obj.type), obj.type.k === 'Number');
    }
    return this.unknownFunction(e);
  }

  unknownCommand(e: CallExpr): null {
    const names = this.fig.commands.names();
    const close = closestNames(e.callee, names, 3);
    const extra: ErrorExtra = { fingerprintKey: e.callee };
    const obj = this.fig.lookup(e.callee);
    if (obj) {
      extra.hint = `${e.callee} is a ${tyStr(obj.type)} object, not a command. Names followed by ( are looked up as commands when they start with a capital letter.`;
    } else if (close.length > 0) {
      extra.hint = `Did you mean ${close.join(' or ')}?`;
      extra.suggest = close.map((c) => this.replaceRange(e.cs, e.ce, c));
    } else {
      extra.hint = 'Commands start with a capital letter, such as Midpoint or Circle.';
    }
    return this.err('unknown_command', e.cs, e.ce, 'lang.unknown_command', { name: e.callee }, extra);
  }

  unknownFunction(e: CallExpr): null {
    const blocked = this.opts.failed?.get(e.callee);
    if (blocked) return this.unknownName({ k: 'name', name: e.callee, s: e.cs, e: e.ce });
    const extra: ErrorExtra = { fingerprintKey: e.callee };
    const cmd = this.fig.commands.lookupFold(e.callee);
    const close = closestNames(e.callee, this.functions.names(), 3);
    if (cmd) {
      extra.hint = `Commands start with a capital letter: ${cmd.name}(…).`;
      extra.suggest = [this.replaceRange(e.cs, e.ce, cmd.name)];
    } else if (close.length > 0) {
      extra.hint = `Did you mean ${close.join(' or ')}?`;
      extra.suggest = close.slice(0, 2).map((c) => this.replaceRange(e.cs, e.ce, c));
    } else {
      extra.hint = 'Define a function first with f(x) = …, or use a built-in such as sin or sqrt.';
    }
    return this.err('unknown_function', e.cs, e.ce, 'lang.unknown_function', { name: e.callee }, extra);
  }

  inferCallObj(e: CallExpr, obj: ObjectInfo): TNode | null {
    const arity = obj.type.arity ?? 1;
    this.reads.add(obj.id);
    const named = e.args.find((a) => a.name !== undefined);
    if (named) {
      return this.err('bad_argument', named.ns as number, named.ne as number, 'lang.bad_argument', { command: e.callee, why: 'functions take positional arguments' }, { fingerprintKey: e.callee });
    }
    if (e.args.length !== arity) {
      const pn = ['x', 'y', 'z', 'w'].slice(0, arity);
      return this.err('arg_count', e.cs, e.e, 'lang.arg_count', { name: e.callee, n: arity, m: e.args.length }, {
        forms: [`${e.callee}(${pn.join(', ')}) -> ${obj.type.ret ?? 'Number'}`],
        hint: `Call ${e.callee} with ${arity} number${arity === 1 ? '' : 's'}.`,
        fingerprintKey: e.callee,
      });
    }
    const args: TNode[] = [];
    let ok = true;
    for (const a of e.args) {
      const t = this.infer(a.value);
      if (!t) {
        ok = false;
        continue;
      }
      if (t.ty.k !== 'Number') {
        this.err('type_mismatch', t.s, t.e, 'lang.type_mismatch_where', { why: `${e.callee} takes Numbers, but this is a ${tyStr(t.ty)}` }, {
          left: tyStr(t.ty),
          hint: t.ty.k === 'List' ? 'Functions do not map over lists. Use Map(list, k, f(k)).' : `Pass a Number to ${e.callee}.`,
          fingerprintKey: `${e.callee}:${tyStr(t.ty)}`,
        });
        ok = false;
        continue;
      }
      args.push(t);
    }
    if (!ok) return null;
    const ret = obj.type.ret === 'Point' ? T.Point : T.Number;
    return { n: 'callObj', id: obj.id, name: e.callee, args, ty: ret, s: e.s, e: e.e };
  }

  inferBuiltin(e: CallExpr, spec: { name: string; forms: readonly import('./table').FunctionForm[] }, expected?: Ty): TNode | null {
    const m = this.matchForms(spec.name, spec.forms, e, expected);
    if (!m) return null;
    const form = m.form;
    const args = m.bound.map((b) => b.expr as TNode).filter((x) => x !== undefined);
    const ty = this.returnType(form.returns, m.bound, form.params);
    const node: TNode = { n: 'builtin', spec: spec as import('./table').FunctionSpec, form, args, ty, s: e.s, e: e.e, ...(form.unit ? { unit: form.unit } : {}) };
    return node;
  }

  inferCommand(e: CallExpr, spec: import('./table').CommandSpec, expected?: Ty): TNode | null {
    this.hasCommand = true;
    const m = this.matchForms(spec.name, spec.forms, e, expected);
    if (!m) return null;
    const form = m.form;
    const ret = form.returns;
    if (ret === null && this.actionCall !== e) {
      return this.err('type_mismatch', e.s, e.e, 'lang.type_mismatch_where', { why: `${spec.name} is an action, not a value` }, {
        hint: 'Write it on its own line.',
        fingerprintKey: spec.name,
      });
    }
    let ty: Ty;
    let tuple: Ty[] | undefined;
    if (ret === null) ty = T.Bool;
    else if (typeof ret === 'string') ty = this.returnType(ret, m.bound, form.params);
    else {
      tuple = ret.map((r) => this.returnType(r, m.bound, form.params));
      ty = tuple[0] as Ty;
    }
    const node: TNode = {
      n: 'command',
      spec,
      form,
      args: m.bound,
      ty,
      s: e.s,
      e: e.e,
      ...(tuple ? { tuple } : {}),
      ...(form.unit ? { unit: form.unit } : {}),
    };
    return node;
  }

  returnType(text: string, bound: readonly TArg[], params: readonly ParamSpec[]): Ty {
    const ref = (p: string): Ty | undefined => {
      const i = params.findIndex((x) => x.name === p);
      return i >= 0 ? bound[i]?.ty : undefined;
    };
    if (text.startsWith('=')) return ref(text.slice(1)) ?? T.Number;
    const m = /^List<=(\w+)>$/.exec(text);
    if (m) return listOf(ref(m[1] as string) ?? T.Number);
    const set = typeSet(text);
    return set.members[0] ?? T.Number;
  }

  /** Notes, for each argument that is a bare name, the type the forms that fit want there (for an `unknown_name` repair). */
  noteWants(args: readonly Arg[], candidates: readonly { form: FormLike; bind: number[] }[]): void {
    const per = new Map<Expr, string[]>();
    for (const c of candidates) {
      c.form.params.forEach((p, k) => {
        const ai = c.bind[k] as number;
        if (ai === -1 || (p.kind !== undefined && p.kind !== 'value')) return;
        const v = (args[ai] as Arg).value;
        if (v.k !== 'name' || v.paren) return;
        const set = typeSet(p.type);
        const names = set.any || set.members.length === 0 ? ['Any'] : set.members.map((m) => m.k);
        const have = per.get(v) ?? [];
        for (const n of names) if (!have.includes(n)) have.push(n);
        per.set(v, have);
      });
    }
    for (const [v, names] of per) this.wants.set(v, names.includes('Number') ? 'Number' : (names[0] as string));
  }

  /* ------------------------------- matching ------------------------------- */

  matchForms<F extends FormLike>(
    specName: string,
    forms: readonly F[],
    call: CallExpr,
    _expected?: Ty,
  ): { form: F; bound: TArg[] } | null {
    const args = call.args;
    // names and duplicates
    const seen = new Map<string, number>();
    const allParamNames = new Set<string>();
    for (const f of forms) {
      for (const p of f.params) allParamNames.add(p.name);
      if (f.rest) allParamNames.add(f.rest.name);
    }
    for (let i = 0; i < args.length; i++) {
      const a = args[i] as Arg;
      if (a.name === undefined) continue;
      if (seen.has(a.name)) {
        return this.err('duplicate_arg', a.ns as number, a.ne as number, 'lang.duplicate_arg', { name: a.name }, {
          hint: `Give ${a.name} once.`,
          related: [`${a.name} is already given as argument ${(seen.get(a.name) as number) + 1}`],
          fingerprintKey: a.name,
        });
      }
      seen.set(a.name, i);
      if (!allParamNames.has(a.name)) {
        const close = closestNames(a.name, allParamNames, 3);
        return this.err('bad_argument', a.ns as number, a.ne as number, 'lang.bad_argument', { command: specName, why: `no form has a parameter called ${a.name}` }, {
          hint: close.length > 0 ? `Did you mean ${close.join(' or ')}?` : `Parameters: ${[...allParamNames].join(', ')}.`,
          forms: forms.map((f) => formText(specName, f)),
          fingerprintKey: a.name,
        });
      }
    }

    interface Binding {
      form: F;
      bind: number[]; // arg index per param (-1 = unbound)
      restArgs: number[];
      extra: number[];
      missing: number[]; // param indexes
      dupNamed?: number;
    }
    const bindings: Binding[] = forms.map((form) => {
      const bind: number[] = form.params.map(() => -1);
      const restArgs: number[] = [];
      const extra: number[] = [];
      let pos = 0;
      let dupNamed: number | undefined;
      for (let i = 0; i < args.length; i++) {
        const a = args[i] as Arg;
        if (a.name !== undefined) continue;
        if (pos < form.params.length) bind[pos++] = i;
        else if (form.rest) restArgs.push(i);
        else extra.push(i);
      }
      for (let i = 0; i < args.length; i++) {
        const a = args[i] as Arg;
        if (a.name === undefined) continue;
        const pi = form.params.findIndex((p) => p.name === a.name);
        if (pi >= 0) {
          if (bind[pi] !== -1) dupNamed = i;
          else bind[pi] = i;
        } else if (form.rest && form.rest.name === a.name) restArgs.push(i);
        else extra.push(i);
      }
      const missing: number[] = [];
      form.params.forEach((p, k) => {
        if (bind[k] === -1 && !p.optional) missing.push(k);
      });
      return { form, bind, restArgs, extra, missing, ...(dupNamed !== undefined ? { dupNamed } : {}) };
    });

    const dup = bindings.find((b) => b.dupNamed !== undefined);
    const candidates = bindings.filter((b) => b.extra.length === 0 && b.missing.length === 0 && b.dupNamed === undefined);
    if (candidates.length === 0 && dup && dup.dupNamed !== undefined) {
      const a = args[dup.dupNamed] as Arg;
      return this.err('duplicate_arg', a.ns as number, a.ne as number, 'lang.duplicate_arg', { name: a.name ?? '' }, { hint: `${a.name ?? 'This parameter'} is already given by position.`, fingerprintKey: a.name ?? '' });
    }

    this.noteWants(args, candidates);
    // value typing, lazy and cached; speculative when several forms compete
    const speculative = candidates.length > 1;
    // An argument is typed once per expected type: the same text can type differently under different forms (`[]`).
    const typed = new Map<string, { ai: number; node: TNode | null; errors: LanguageError[]; notices: Notice[] }>();
    const typedKeys = new Map<number, string[]>();
    const typedKey = (i: number, hint?: Ty): string => `${i}|${hint ? tyStr(hint) : ''}`;
    const wantsValue = (b: Binding, k: number): boolean => (b.form.params[k] as ParamSpec).kind === undefined || (b.form.params[k] as ParamSpec).kind === 'value';
    const valueArg = (i: number, hint?: Ty): TNode | null => {
      const key = typedKey(i, hint);
      const hit = typed.get(key);
      if (hit) return hit.node;
      const saved = this.errors;
      const savedN = this.notices;
      this.errors = [];
      this.notices = [];
      let node: TNode | null = null;
      try {
        node = this.inferArg((args[i] as Arg).value, hint);
      } finally {
        const got = { node, errors: this.errors, notices: this.notices };
        this.errors = saved;
        this.notices = savedN;
        typed.set(key, { ai: i, ...got });
        const ks = typedKeys.get(i);
        if (ks) ks.push(key);
        else typedKeys.set(i, [key]);
      }
      return node;
    };
    /** A typing of the argument for display (a diagnosis names its type): any form's will do, so none is typed again. */
    const shownArg = (i: number): TNode | null => {
      for (const k of typedKeys.get(i) ?? []) {
        const t = typed.get(k);
        if (t?.node) return t.node;
      }
      return valueArg(i);
    };
    const flushedArgs = new Set<number>();
    const flush = (i: number, hint?: Ty): void => {
      const t = typed.get(typedKey(i, hint));
      if (!t) return;
      flushedArgs.add(i);
      for (const er of t.errors) if (this.errors.length < MAX_ERRORS_PER_LINE) this.errors.push(er);
      this.notices.push(...t.notices);
      t.errors = [];
      t.notices = [];
    };

    const elementHint = (b: Binding, k: number): Ty | undefined => {
      const set = typeSet((b.form.params[k] as ParamSpec).type);
      return set.members.length === 1 && set.members[0]?.k === 'List' && set.members[0].of ? set.members[0] : undefined;
    };

    interface Test {
      b: Binding;
      problems: ArgProblem[];
      bound: TArg[];
      tys: (Ty | undefined)[];
      score: number;
      invalid: boolean;
      binderBad: { ai: number; arg: Arg }[];
      /** Errors found inside body arguments while several forms compete; reported if no form passes. */
      bodyErrors: LanguageError[];
    }
    const testForm = (b: Binding): Test => {
      const problems: ArgProblem[] = [];
      const bound: TArg[] = new Array<TArg>(b.form.params.length);
      const tys: (Ty | undefined)[] = [];
      let invalid = false;
      let score = 0;
      const binderBad: { ai: number; arg: Arg }[] = [];
      const bodyErrors: LanguageError[] = [];
      const frame: Frame = { vars: new Map() };
      // pass 1: values and binders
      b.form.params.forEach((p, k) => {
        const ai = b.bind[k] as number;
        const kind = p.kind ?? 'value';
        if (ai === -1) {
          bound[k] = { param: p, omitted: true, ...(p.default !== undefined ? { value: p.default } : {}) };
          return;
        }
        const a = args[ai] as Arg;
        const set = typeSet(p.type);
        score += set.size;
        if (kind === 'value') {
          const node = valueArg(ai, elementHint(b, k));
          if (!node) {
            invalid = true;
            bound[k] = { param: p, omitted: false };
            problems.push(this.problem(ai, p, a, 'an invalid value', setLabel(set)));
            return;
          }
          tys[k] = node.ty;
          bound[k] = { param: p, expr: node, omitted: false, ty: node.ty };
          if (!accepts(set, node.ty)) problems.push(this.problem(ai, p, a, tyStr(node.ty), setLabel(set)));
        } else if (kind === 'binder') {
          const v = a.value;
          if (v.k !== 'name' || v.paren) {
            problems.push(this.problem(ai, p, a, 'an expression', 'a bare name'));
            binderBad.push({ ai, arg: a });
            bound[k] = { param: p, omitted: false };
            return;
          }
          const bty = set.members[0] ?? T.Number;
          const slot = this.slotCount++;
          frame.vars.set(v.name, { slot, ty: bty });
          this.warnShadow(v.name, v.s, v.e);
          bound[k] = { param: p, binder: v.name, slot, omitted: false, ty: bty };
          tys[k] = bty;
        }
      });
      // pass 2: bodies, in the scope of the binders
      b.form.params.forEach((p, k) => {
        if ((p.kind ?? 'value') !== 'body') return;
        const ai = b.bind[k] as number;
        if (ai === -1) return;
        const a = args[ai] as Arg;
        const set = typeSet(p.type);
        this.scopes.push(frame);
        const extraFrame: Frame = { vars: new Map() };
        for (const sc of p.scope ?? []) {
          extraFrame.vars.set(sc.name, { slot: this.slotCount++, ty: typeSet(sc.type).members[0] ?? T.Number });
          this.warnShadow(sc.name, call.cs, call.ce);
        }
        this.scopes.push(extraFrame);
        const saved = this.errors;
        const savedN = this.notices;
        this.errors = [];
        this.notices = [];
        let node: TNode | null;
        try {
          node = this.inferArg(a.value, set.members.length === 1 ? set.members[0] : undefined);
        } finally {
          const errs = this.errors;
          this.errors = saved;
          this.notices = savedN.concat(this.notices);
          if (!speculative) {
            for (const er of errs) if (this.errors.length < MAX_ERRORS_PER_LINE) this.errors.push(er);
          } else if (errs.length > 0) {
            // keep them: if no form passes, the real mistake is reported instead of a form diagnosis
            invalid = true;
            bodyErrors.push(...errs);
          }
          this.scopes.pop();
          this.scopes.pop();
        }
        if (!node) {
          invalid = true;
          bound[k] = { param: p, omitted: false };
          return;
        }
        tys[k] = node.ty;
        bound[k] = { param: p, expr: node, omitted: false, ty: node.ty };
        // binders unused in a body get a notice
        if (!accepts(set, node.ty)) problems.push(this.problem(ai, p, a, tyStr(node.ty), setLabel(set)));
      });
      // rest
      const rest = b.form.rest;
      if (rest) {
        for (const ai of b.restArgs) {
          const a = args[ai] as Arg;
          const node = valueArg(ai);
          const set = typeSet(rest.type);
          score += set.size;
          if (!node) {
            invalid = true;
            continue;
          }
          bound.push({ param: rest, expr: node, omitted: false, ty: node.ty });
          if (!accepts(set, node.ty)) problems.push(this.problem(ai, rest, a, tyStr(node.ty), setLabel(set)));
        }
      }
      return { b, problems, bound, tys, score, invalid, binderBad, bodyErrors };
    };

    const tests = candidates.map(testForm);
    const passing = tests.filter((t) => t.problems.length === 0 && !t.invalid);
    if (passing.length >= 1) {
      let best = passing[0] as Test;
      let tie = false;
      for (const t of passing.slice(1)) {
        if (t.score < best.score) {
          best = t;
          tie = false;
        } else if (t.score === best.score) tie = true;
      }
      if (tie) {
        return this.err('internal', call.cs, call.ce, 'lang.internal', { where: `matching ${specName}` }, {
          hint: 'Two forms of this command accept the same arguments; report this.',
          recovery: 'report',
          fingerprintKey: specName,
        });
      }
      // flush errors of value args used by the chosen form (none expected: they typed fine)
      best.b.form.params.forEach((p, k) => {
        if (wantsValue(best.b, k) && best.b.bind[k] !== -1) flush(best.b.bind[k] as number, elementHint(best.b, k));
      });
      for (const ai of best.b.restArgs) flush(ai);
      for (const t of typed.values()) if (t.node && !flushedArgs.has(t.ai)) this.notices.push(...t.notices);
      this.checkBinderUse(best.bound, best.b.form, args);
      return { form: best.b.form as F, bound: best.bound };
    }

    // real errors inside arguments take priority over a form diagnosis
    const failedValueArgs = tests.filter((t) => t.invalid);
    if (failedValueArgs.length > 0) {
      const first = failedValueArgs[0] as Test;
      first.b.form.params.forEach((p, k) => {
        if (wantsValue(first.b, k) && first.b.bind[k] !== -1) flush(first.b.bind[k] as number, elementHint(first.b, k));
      });
      for (const ai of first.b.restArgs) flush(ai);
      if (this.errors.length === 0) {
        // errors inside a body argument, from the form that came closest, come before any form diagnosis
        const closest = failedValueArgs.filter((t) => t.bodyErrors.length > 0).sort((x, y) => x.problems.length - y.problems.length)[0];
        if (closest) for (const er of closest.bodyErrors) if (this.errors.length < MAX_ERRORS_PER_LINE) this.errors.push(er);
      }
      if (this.errors.length > 0) {
        this.reportBinders(first.binderBad);
        return null;
      }
    }
    const badBinders = tests.filter((t) => t.binderBad.length > 0).sort((x, y) => x.problems.length - y.problems.length)[0];
    if (badBinders) {
      this.reportBinders(badBinders.binderBad);
      return null;
    }
    return this.diagnose(specName, forms, call, bindings, tests, shownArg);
  }

  reportBinders(bad: readonly { ai: number; arg: Arg }[]): void {
    for (const { arg } of bad) {
      this.err('not_a_binder', arg.value.s, arg.value.e, 'lang.not_a_binder', {}, {
        expected: ['name'],
        hint: `This position names a variable that the expression uses. Write a plain name such as k, not ${this.textOf(arg.value)}.`,
        fingerprintKey: this.textOf(arg.value),
      });
    }
  }

  checkBinderUse(_bound: readonly TArg[], _form: FormLike, _args: readonly Arg[]): void {
    for (const b of _bound) {
      if (b.binder === undefined || b.slot === undefined) continue;
      let used = false;
      for (const o of _bound) if (o.expr && usesLocalSlot(o.expr, b.slot)) used = true;
      if (!used) {
        const a = _args.find((x) => x.value.k === 'name' && x.value.name === b.binder);
        const s = a ? this.spanOf(a.value.s, a.value.e) : { line: 0, col: 0, endCol: 0 };
        this.warn(notice('unused_binder', 'warning', `${b.binder} is not used in the expression.`, { name: b.binder, ...s }, [b.binder]));
      }
    }
  }

  problem(ai: number, p: ParamSpec, a: Arg, got: string, expected: string): ArgProblem {
    const sp = this.spanOf(a.value.s, a.value.e);
    return { argIndex: ai, param: p.name, expected, got, col: sp.col, endCol: sp.endCol };
  }

  inferArg(e: Expr, expected?: Ty): TNode | null {
    if (this.relationCapable(e) && this.freeVars(e).size > 0) return this.buildRelation(e);
    return this.infer(e, expected);
  }

  /* ----------------------------- diagnosis ----------------------------- */

  diagnose<F extends FormLike>(
    name: string,
    forms: readonly F[],
    call: CallExpr,
    bindings: readonly { form: F; bind: number[]; restArgs: number[]; extra: number[]; missing: number[] }[],
    tests: readonly { b: { form: F; bind: number[]; restArgs: number[]; extra: number[]; missing: number[] }; problems: ArgProblem[]; tys: (Ty | undefined)[] }[],
    valueArg: (i: number, hint?: Ty) => TNode | null,
  ): null {
    const args = call.args;
    const n = args.length;
    // problems per binding (arity problems when not a candidate)
    const scored = bindings.map((b, idx) => {
      const t = tests.find((x) => x.b.form === b.form);
      const typeProblems = t ? t.problems.length : 0;
      const arity = b.extra.length + b.missing.length;
      return { b, idx, count: typeProblems + arity, arity };
    });
    const pool = scored.some((x) => x.arity === 0) ? scored.filter((x) => x.arity === 0) : scored;
    pool.sort((x, y) => x.count - y.count || x.arity - y.arity || x.idx - y.idx);
    const closest = (pool[0] as (typeof scored)[number]).b;
    const t = tests.find((x) => x.b.form === closest.form);
    const problems: ArgProblem[] = [...(t?.problems ?? [])];
    const closeSpan = (ai: number): { col: number; endCol: number } => {
      const a = args[ai] as Arg;
      const sp = this.spanOf(a.value.s, a.value.e);
      return { col: sp.col, endCol: sp.endCol };
    };
    for (const ai of closest.extra) {
      const sp = closeSpan(ai);
      problems.push({ argIndex: ai, expected: 'no more arguments', got: 'extra', ...sp });
    }
    const closeParen = this.spanOf(call.close, call.close);
    for (const k of closest.missing) {
      const p = closest.form.params[k] as ParamSpec;
      problems.push({ argIndex: -1, param: p.name, expected: setLabel(typeSet(p.type)), got: 'missing', col: closeParen.col, endCol: closeParen.col });
    }
    const orderedForms = [closest.form, ...forms.filter((f) => f !== closest.form)];
    const formLines = orderedForms.map((f) => formText(name, f));
    const lo = (f: FormLike): number => f.params.filter((p) => !p.optional).length;
    const hi = (f: FormLike): number => (f.rest ? Infinity : f.params.length);
    const counts = [...new Set(forms.flatMap((f) => (hi(f) === Infinity ? [lo(f)] : Array.from({ length: hi(f) - lo(f) + 1 }, (_, i) => lo(f) + i))))].sort((a, b) => a - b);
    const arityOk = bindings.some((b) => b.extra.length === 0 && b.missing.length === 0);
    const extra: ErrorExtra = { forms: formLines, problems, fingerprintKey: '' };
    let kind = 'no_matching_form';
    let key = 'lang.no_matching_form';
    let message: string;
    let s = call.cs;
    let e = call.e;
    const given: string[] = [];
    for (let i = 0; i < n; i++) {
      const a = args[i] as Arg;
      if (a.name !== undefined) {
        given.push(`${a.name}=…`);
        continue;
      }
      const nd = valueArg(i);
      given.push(nd ? tyStr(nd.ty) : '?');
    }
    extra.fingerprintKey = `${name}:${given.join(',')}`;
    const cnt = counts.length === 0 ? '0' : counts.length === 1 ? String(counts[0]) : typeList(counts.map(String));
    if (!arityOk) {
      kind = 'arg_count';
      key = 'lang.arg_count';
      message = `${name} takes ${cnt} argument${counts.length === 1 && counts[0] === 1 ? '' : 's'}; got ${n}.`;
      // the count fits no form: the span is the whole call
      extra.hint = closest.extra.length > 0
        ? `Remove ${closest.extra.length === 1 ? 'the extra argument' : 'the extra arguments'}, or use another form: ${formText(name, closest.form)}.`
        : `Add the missing ${closest.missing.map((k) => (closest.form.params[k] as ParamSpec).name).join(', ')}: ${formText(name, closest.form)}.`;
      if (name === 'log' && n === 1) extra.hint = 'log needs a base: log(base, x). For one argument use ln, log10 or log2.';
    } else {
      const first = problems[0];
      if (first) {
        const a = args[first.argIndex] as Arg | undefined;
        const txt = a ? this.textOf(a.value) : '';
        message = `${name}: argument ${first.argIndex + 1}${first.param ? ` (${first.param})` : ''} should be ${first.expected.trim() === '' ? 'another type' : `${/^[AEIOU]/i.test(first.expected) ? 'an' : 'a'} ${first.expected}`}, but ${txt} is ${/^[aeiou]/i.test(first.got) ? 'an' : 'a'} ${first.got}.`;
        // one wrong argument is pointed at; several wrong arguments make the whole call the span
        if (a && problems.length === 1) {
          s = a.value.s;
          e = a.value.e;
        }
        extra.hint = `Closest form: ${name}(${closest.form.params.map((p) => p.name).join(', ')}).`;
      } else {
        message = `${name} has no form (${given.join(', ')}).`;
      }
    }
    // suggestions: drop one argument so that some form matches
    const sugg = this.dropSuggestions(forms, args, valueArg);
    if (sugg.length > 0) extra.suggest = sugg;
    extra.message = message;
    this.err(kind, s, e, key, kind === 'arg_count' ? { name, n: cnt, m: n } : { command: name, given: given.join(', ') }, extra);
    return null;
  }

  dropSuggestions<F extends FormLike>(forms: readonly F[], args: readonly Arg[], valueArg: (i: number) => TNode | null): string[] {
    const out: string[] = [];
    if (args.length < 2 || args.some((a) => a.name !== undefined)) return out;
    const tys: (Ty | undefined)[] = args.map((_, i) => valueArg(i)?.ty);
    if (tys.some((t) => t === undefined)) return out;
    const simple = forms.filter((f) => f.params.every((p) => (p.kind ?? 'value') === 'value'));
    const accepted = (ts: Ty[]): boolean =>
      simple.some((f) => {
        if (ts.length > f.params.length || ts.length < f.params.filter((p) => !p.optional).length) return false;
        return ts.every((t, i) => accepts(typeSet((f.params[i] as ParamSpec).type), t));
      });
    for (let i = 0; i < args.length && out.length < 3; i++) {
      const rest = (tys as Ty[]).filter((_, k) => k !== i);
      if (!accepted(rest)) continue;
      const a = args[i] as Arg;
      let s: number;
      let e: number;
      if (i > 0) {
        s = (args[i - 1] as Arg).value.e;
        e = a.value.e;
      } else {
        s = a.value.s;
        e = (args[1] as Arg).value.s;
      }
      out.push(this.replaceRange(s, e, ''));
    }
    return out;
  }

  /* ------------------------------ relations ------------------------------ */

  buildRelation(e: Expr): TNode | null {
    const f = this.pushFrame();
    const sx = this.slotCount++;
    const sy = this.slotCount++;
    f.vars.set('x', { slot: sx, ty: T.Number });
    f.vars.set('y', { slot: sy, ty: T.Number });
    try {
      const tree = this.relTree(e);
      if (!tree) return null;
      const cls = classify(tree, sx, sy);
      return { n: 'relation', tree, slotX: sx, slotY: sy, ...(cls.poly ? { poly: cls.poly } : {}), shape: cls.shape, ty: T.Relation, s: e.s, e: e.e };
    } finally {
      this.popFrame();
    }
  }

  relTree(e: Expr): RelTree | null {
    if (e.k === 'cmp') {
      const ops = e.operands.map((o) => this.infer(o));
      if (ops.some((o) => o === null)) return null;
      const ts = ops as TNode[];
      for (const t of ts) {
        if (t.ty.k !== 'Number') {
          return this.err('type_mismatch', t.s, t.e, 'lang.type_mismatch_where', { why: `An equation or inequality compares Numbers, but this is a ${tyStr(t.ty)}` }, {
            left: tyStr(t.ty),
            fingerprintKey: 'relation',
          });
        }
      }
      return { t: 'cmp', ops: e.ops as readonly CmpOp[], operands: ts };
    }
    if (e.k === 'unary' && e.op === 'not') {
      const a = this.relTree(e.arg);
      return a ? { t: 'not', a } : null;
    }
    if (e.k === 'bin' && (e.op === 'and' || e.op === 'or' || e.op === 'xor')) {
      if (!this.relationCapable(e.l) || !this.relationCapable(e.r)) {
        return this.err('type_mismatch', e.s, e.e, 'lang.type_mismatch_where', { why: 'A region combines relations in x and y with and, or and xor' }, {
          hint: 'Write each side as a comparison, for example x > 0 and y > 0.',
          fingerprintKey: 'relation_logic',
        });
      }
      const l = this.relTree(e.l);
      const r = this.relTree(e.r);
      return l && r ? { t: e.op, l, r } : null;
    }
    return this.err('free_variable', e.s, e.e, 'lang.free_variable', { name: this.textOf(e), owner: this.ctx.name ?? 'this object', type: 'number' }, {
      hint: 'x and y can only be used in a comparison such as y == 2x + 1, or in f(x) = …',
      fingerprintKey: 'relation_shape',
    });
  }
}

/* ------------------------------ small utilities ------------------------------ */

export function usesLocalSlot(n: TNode, slot: number): boolean {
  if (n.n === 'local') return n.slot === slot;
  if (n.n === 'command') {
    for (const a of n.args) if (a.expr && usesLocalSlot(a.expr, slot)) return true;
    return false;
  }
  return childNodes(n).some((c) => usesLocalSlot(c, slot));
}

import { children as childNodes } from './relation';

/** Constant-fold a Number tree built from literals and constants; undefined when it reads anything. */
export function foldNumber(n: TNode): number | undefined {
  switch (n.n) {
    case 'num':
      return n.v;
    case 'const':
      return typeof n.value === 'number' ? n.value : undefined;
    case 'unary': {
      const a = foldNumber(n.arg);
      if (a === undefined) return undefined;
      return n.op === '-' ? -a : n.op === '+' ? a : undefined;
    }
    case 'bin': {
      if (n.variant !== 'num') return undefined;
      const a = foldNumber(n.l);
      const b = foldNumber(n.r);
      if (a === undefined || b === undefined) return undefined;
      switch (n.op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          return b === 0 ? undefined : a / b;
        case '^':
          return getMathLib().pow(a, b);
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

export { Checker };
