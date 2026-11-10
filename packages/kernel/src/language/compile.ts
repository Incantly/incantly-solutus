/**
 * Compile target (docs/features/language/design.md 3.15): typed trees become JavaScript closures
 * over an `Env`. No `eval`, no `new Function`. Numbers use NaN as the undefined marker and write
 * the reason to `env.reason`; other types use `undefined`.
 */
import type { Result } from '../contracts/errors';
import type { ObjId, UndefReason } from '../contracts/values';
import { factorial, getMathLib, power } from './builtins';
import type { CheckedLine } from './check';
import { buildError } from './errors';
import type { LanguageError } from './errors';
import { children } from './relation';
import { fail, formatNumber } from './runtime';
import type { Env, FunctionValue, RelationValue } from './runtime';
import type { Pt } from '../contracts/values';
import type { CommandForm, CommandSpec, ParamSpec } from './table';
import type { RelTree, TNode } from './tnode';
import { tyStr } from './types';

type Fn = (env: Env) => any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Compiled<R> {
  readonly eval: (env: Env) => R;
  /** Object ids the expression reads: the rule's inputs. */
  readonly reads: ReadonlySet<ObjId>;
  readonly usesT: boolean;
}

export interface CompiledArg {
  readonly param: ParamSpec;
  /** Evaluates the argument; absent for a binder or an omitted argument. */
  readonly eval?: Fn;
  readonly binder?: string;
  readonly slot?: number;
  readonly omitted: boolean;
  readonly value?: number | boolean | string;
}

export interface CompileOptions {
  /** Runs a command form inside an expression. Provided by the kernel. */
  runCommand?: (spec: CommandSpec, form: CommandForm, args: readonly CompiledArg[], env: Env) => unknown;
}

export interface CompiledLine extends Compiled<unknown> {
  readonly line: CheckedLine;
  /** Objects read by style values: the inputs of the property rules (style edges), not of the value. */
  readonly styleReads: ReadonlySet<ObjId>;
  /** Objects read by the bounds of a slider range; not inputs of the value. */
  readonly rangeReads: ReadonlySet<ObjId>;
  /** True when a style value reads the clock (re-run the style rules on a tick). */
  readonly styleUsesT: boolean;
  /** True when a range bound reads the clock (re-run the range rule on a tick). */
  readonly rangeUsesT: boolean;
  /** Style values by key; each evaluates in the same environment. */
  readonly style: readonly { readonly key: string; readonly word?: string; readonly eval?: Fn }[];
  /** Slider range evaluators. */
  readonly range?: { readonly min: Fn; readonly max: Fn; readonly step?: Fn };
  /** For a command line: the arguments compiled for the kernel's rule factory. */
  readonly command?: { readonly spec: CommandSpec; readonly form: CommandForm; readonly args: readonly CompiledArg[] };
  /** State initial value and velocity. */
  readonly state?: { readonly initial: Fn; readonly velocity?: Fn };
}

const NAN = Number.NaN;

/** Longest text a value may have (errors.md section 7); literals are limited by the checker. */
const MAX_TEXT_LENGTH = 10000;

/**
 * Final check of a Number result. An infinity that reaches here came from an `inf` (written or stored) through operations
 * that each had an infinite input, because every operation that made one from finite inputs already failed with
 * `overflow` (see `guardInf`). It is a value (README decision 7); anything else that is not finite is undefined.
 */
function setNanReason(env: Env, v: number): number {
  if (v - v === 0) return v;
  if (v === Infinity || v === -Infinity) return v;
  if (env.reason === undefined) env.reason = 'not_finite';
  return NAN;
}

/**
 * Infinity follows the value, not the line: an operation may return an infinity only when one of its own inputs was
 * infinite. When it made one from finite inputs, that is overflow and the result is undefined (ruling Q4).
 */
function guardInf(env: Env, v: number, a: number, b: number): number {
  if (v - v === 0) return v;
  if (v !== v) {
    // a result that is not a number although no input was undefined (`inf - inf`, `0 * inf`)
    if (a === a && b === b) fail(env, 'not_finite');
    return v;
  }
  if (a - a === 0 && b - b === 0) {
    fail(env, 'overflow', 'a result too large to store');
    return NAN;
  }
  return v;
}

/** True when a point-like value holds a coordinate that is not a number. */
function hasNaN(v: object): boolean {
  return Object.values(v as Record<string, unknown>).some((x) => typeof x === 'number' && x !== x);
}

/** A Point or Vector from two coordinates; undefined when either is not a number (its reason is already on `env`). */
function mkPt(env: Env, x: number, y: number): Pt | undefined {
  if (x !== x || y !== y) {
    if (env.reason === undefined) env.reason = 'not_finite';
    return undefined;
  }
  return { x, y };
}

/** An operand of an arithmetic operation was undefined: the result is undefined with `input_undefined` unless a reason is already set. */
function undefIn(env: Env): void {
  if (env.reason === undefined) env.reason = 'input_undefined';
}

/** True when a value, or any number inside it (a point's coordinate, a list's item), is infinite or not a number. */
function hasNonFinite(v: unknown): boolean {
  if (typeof v === 'number') return v - v !== 0;
  if (v === null || typeof v !== 'object') return false;
  if (ArrayBuffer.isView(v) || Array.isArray(v)) {
    const xs = v as unknown as ArrayLike<unknown>;
    for (let i = 0; i < xs.length; i++) if (hasNonFinite(xs[i])) return true;
    return false;
  }
  for (const k of Object.keys(v)) if (hasNonFinite((v as Record<string, unknown>)[k])) return true;
  return false;
}

function failInput(env: Env, id: ObjId): void {
  if (env.reason === undefined) {
    env.reason = 'input_undefined';
    env.via = id;
  }
}

const isNum = (t: TNode): boolean => t.ty.k === 'Number';

function undefFor(t: TNode): unknown {
  return isNum(t) ? NAN : undefined;
}

/* ------------------------------ equality helpers ------------------------------ */

/**
 * Equality with a relative tolerance. The tolerance is for finite numbers: when either side is infinite the two are equal
 * only when they are the same value, so no number is equal to an infinity (design 3.5).
 */
function numEq(a: number, b: number, tol = 1e-12): boolean {
  if (a === b) return true;
  if (a - a !== 0 || b - b !== 0) return false;
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
}

function valueEq(a: unknown, b: unknown): boolean | undefined {
  if (a === undefined || b === undefined) return undefined;
  if (typeof a === 'number' && typeof b === 'number') {
    if (a !== a || b !== b) return undefined;
    return numEq(a, b);
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const p = a as Pt;
    const q = b as Pt;
    if (p.x !== p.x || q.x !== q.x) return undefined;
    return numEq(p.x, q.x) && numEq(p.y, q.y);
  }
  return a === b;
}

function cmpNum(op: string, a: number, b: number): boolean | undefined {
  if (a !== a || b !== b) return undefined;
  switch (op) {
    case '<':
      return a < b;
    case '<=':
      return a <= b || numEq(a, b);
    case '>':
      return a > b;
    default:
      return a >= b || numEq(a, b);
  }
}

/* --------------------------------- fields --------------------------------- */

function polygonArea(pts: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as Pt;
    const q = pts[(i + 1) % pts.length] as Pt;
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

function fieldOf(type: string, field: string, v: unknown): unknown {
  const o = v as Record<string, unknown>;
  const M = getMathLib();
  switch (type) {
    case 'Point':
    case 'Vector':
      if (field === 'x') return o['x'];
      if (field === 'y') return o['y'];
      return M.hypot(o['x'] as number, o['y'] as number);
    case 'Segment': {
      const a = o['a'] as Pt;
      const b = o['b'] as Pt;
      if (field === 'start') return a;
      if (field === 'end') return b;
      return M.hypot(b.x - a.x, b.y - a.y);
    }
    case 'Circle':
      return field === 'center' ? { x: o['cx'], y: o['cy'] } : o['r'];
    case 'Arc':
      if (field === 'center') return { x: o['cx'], y: o['cy'] };
      if (field === 'radius') return o['r'];
      return field === 'start' ? o['from'] : o['to'];
    case 'Polygon': {
      const pts = o['pts'] as readonly Pt[];
      if (field === 'vertices') return pts;
      if (field === 'area') return polygonArea(pts);
      let per = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i] as Pt;
        const q = pts[(i + 1) % pts.length] as Pt;
        per += M.hypot(q.x - p.x, q.y - p.y);
      }
      return per;
    }
    case 'Line': {
      const a = o['a'] as number;
      const b = o['b'] as number;
      const c = o['c'] as number;
      const n2 = a * a + b * b;
      return field === 'point' ? { x: (a * c) / n2, y: (b * c) / n2 } : { x: -b, y: a };
    }
    case 'Text':
      return (v as string).length;
    default:
      return undefined;
  }
}

/* --------------------------------- compiler --------------------------------- */

class Compiler {
  constructor(readonly opts: CompileOptions) {}

  isConstant(n: TNode): boolean {
    switch (n.n) {
      case 'ref':
      case 'local':
      case 'clock':
      case 'callObj':
      case 'tick':
      case 'command':
      case 'relation':
      case 'range':
        return false;
      case 'undef':
        return false;
      // These call the MathLib, which the host may swap after compiling, so they are evaluated every time, never folded.
      case 'builtin':
      case 'field':
        return false;
      case 'bin':
        return n.op !== '^' && children(n).every((c) => this.isConstant(c));
      default:
        return children(n).every((c) => this.isConstant(c));
    }
  }

  compile(n: TNode): Fn {
    if (n.n !== 'num' && n.n !== 'const' && n.n !== 'bool' && this.isConstant(n) && n.n !== 'text') {
      const f = this.compileRaw(n);
      const scratch: Env = { t: 0, bt: 0, beat: 0, reason: undefined, via: undefined, detail: undefined, locals: [], read: () => undefined };
      let v: unknown;
      try {
        v = f(scratch);
      } catch {
        return f;
      }
      if (scratch.reason === undefined && (v !== undefined) && !(typeof v === 'number' && v !== v)) {
        return () => v;
      }
      return f;
    }
    return this.compileRaw(n);
  }

  compileRaw(n: TNode): Fn {
    switch (n.n) {
      case 'num': {
        const v = n.v;
        return () => v;
      }
      case 'bool': {
        const v = n.v;
        return () => v;
      }
      case 'const': {
        const v = n.value;
        return () => v;
      }
      case 'undef':
        return (env) => {
          fail(env, 'explicit', 'the undefined constant');
          return undefFor(n);
        };
      case 'clock': {
        const w = n.which;
        return (env) => env[w];
      }
      case 'text':
        return this.compileText(n);
      case 'ref': {
        const id = n.id;
        const isN = isNum(n);
        return (env) => {
          const v = env.read(id);
          if (v === undefined || (isN && typeof v === 'number' && v !== v)) {
            failInput(env, id);
            return isN ? NAN : undefined;
          }
          return v;
        };
      }
      case 'local': {
        const slot = n.slot;
        const isN = isNum(n);
        return (env) => {
          const v = env.locals[slot];
          return v === undefined && isN ? NAN : v;
        };
      }
      case 'unary':
        return this.compileUnary(n);
      case 'bin':
        return this.compileBin(n);
      case 'cmp':
        return this.compileCmp(n);
      case 'fact': {
        const a = this.compile(n.arg);
        return (env) => {
          const x = a(env);
          return x !== x ? NAN : factorial(x, env);
        };
      }
      case 'callObj':
        return this.compileCallObj(n);
      case 'builtin':
        return this.compileBuiltin(n);
      case 'command':
        return this.compileCommand(n);
      case 'tick':
        return this.compileTick(n);
      case 'index':
        return this.compileIndex(n);
      case 'field': {
        const t = this.compile(n.target);
        const type = n.target.ty.k;
        const field = n.field;
        const isN = isNum(n);
        const undef = isN ? NAN : undefined;
        return (env) => {
          const v = t(env);
          if (v === undefined || (typeof v === 'number' && v !== v)) return undef;
          if (type === 'Line' && field === 'point' && (v as { a: number; b: number }).a === 0 && (v as { a: number; b: number }).b === 0) {
            fail(env, 'division_by_zero', 'a line with no direction has no foot point');
            return undefined;
          }
          const r = fieldOf(type, field, v);
          // a field follows the rules of a Number operation: an infinity is a value only when the object held an infinite number
          if (hasNonFinite(r) && !hasNonFinite(v)) {
            fail(env, typeof r === 'number' && r !== r ? 'not_finite' : 'overflow', `${type}.${field}`);
            return undef;
          }
          if (typeof r === 'number' && r !== r) {
            fail(env, 'not_finite');
          } else if (typeof r === 'object' && r !== null && hasNaN(r)) {
            fail(env, 'not_finite');
            return undefined;
          }
          return r;
        };
      }
      case 'point': {
        const x = this.compile(n.x);
        const y = this.compile(n.y);
        return (env) => {
          const a = x(env);
          const b = y(env);
          if (a !== a || b !== b) {
            undefIn(env);
            return undefined;
          }
          return { x: a, y: b };
        };
      }
      case 'polar': {
        const r = this.compile(n.r);
        const a = this.compile(n.a);
        return (env) => {
          const rr = r(env);
          const aa = a(env);
          if (rr !== rr || aa !== aa) {
            undefIn(env);
            return undefined;
          }
          if (aa - aa !== 0) {
            fail(env, 'not_finite', 'the angle of a polar point is infinite');
            return undefined;
          }
          const M = getMathLib();
          const c = M.cos(aa);
          const sn = M.sin(aa);
          return mkPt(env, guardInf(env, rr * c, rr, c), guardInf(env, rr * sn, rr, sn));
        };
      }
      case 'list': {
        const items = n.items.map((i) => this.compile(i));
        const numeric = n.ty.of?.k === 'Number';
        // a list with an undefined item is undefined as a whole
        return (env) => {
          if (numeric) {
            const out = new Float64Array(items.length);
            let bad = false;
            for (let i = 0; i < items.length; i++) {
              const v = (items[i] as Fn)(env) as number;
              if (v !== v) bad = true;
              out[i] = v;
            }
            if (bad) {
              undefIn(env);
              return undefined;
            }
            return out;
          }
          const out = items.map((f) => f(env));
          if (out.some((v) => v === undefined || (typeof v === 'number' && v !== v))) {
            undefIn(env);
            return undefined;
          }
          return out;
        };
      }
      case 'range':
        return this.compileRange(n);
      case 'cond':
        return this.compileCond(n);
      case 'relation':
        return this.compileRelation(n);
    }
  }

  compileText(n: TNode & { n: 'text' }): Fn {
    const parts = n.parts.map((p) => (typeof p === 'string' ? p : { f: this.compile(p.e), fmt: p.fmt, ty: p.e.ty.k }));
    return (env) => {
      let out = '';
      for (const p of parts) {
        if (typeof p === 'string') {
          out += p;
          continue;
        }
        const v = p.f(env);
        if (v === undefined || (typeof v === 'number' && v !== v)) out += 'undefined';
        else if (typeof v === 'number') out += formatNumber(v, p.fmt);
        else if (typeof v === 'boolean') out += v ? 'true' : 'false';
        else if (typeof v === 'string') out += v;
        else out += `(${formatNumber((v as Pt).x, p.fmt)}, ${formatNumber((v as Pt).y, p.fmt)})`;
        if (out.length > MAX_TEXT_LENGTH) {
          fail(env, 'limit', `a text of more than ${MAX_TEXT_LENGTH} characters`);
          return undefined;
        }
      }
      return out;
    };
  }

  compileUnary(n: TNode & { n: 'unary' }): Fn {
    const a = this.compile(n.arg);
    if (n.op === 'not') {
      return (env) => {
        const v = a(env);
        return v === undefined ? undefined : !v;
      };
    }
    const neg = n.op === '-';
    switch (n.ty.k) {
      case 'Number':
        return neg ? (env) => -a(env) : a;
      case 'Vector':
        return (env) => {
          const v = a(env) as Pt | undefined;
          if (v === undefined) {
            undefIn(env);
            return undefined;
          }
          return neg ? { x: -v.x, y: -v.y } : v;
        };
      default:
        // Function
        return neg
          ? (env) => {
              const f = a(env);
              if (f === undefined) {
                undefIn(env);
                return undefined;
              }
              return pointwise(env, [f], 'neg', n.ty.arity ?? 1);
            }
          : a;
    }
  }

  compileBin(n: TNode & { n: 'bin' }): Fn {
    const l = this.compile(n.l);
    const r = this.compile(n.r);
    const op = n.op;
    switch (n.variant) {
      case 'num':
        switch (op) {
          case '+':
            return (env) => {
              const a = l(env);
              const b = r(env);
              const v = a + b;
              return v - v === 0 ? v : guardInf(env, v, a, b);
            };
          case '-':
            return (env) => {
              const a = l(env);
              const b = r(env);
              const v = a - b;
              return v - v === 0 ? v : guardInf(env, v, a, b);
            };
          case '*':
            return (env) => {
              const a = l(env);
              const b = r(env);
              const v = a * b;
              return v - v === 0 ? v : guardInf(env, v, a, b);
            };
          case '/':
            return (env) => {
              const a = l(env);
              const b = r(env);
              if (b === 0) {
                fail(env, 'division_by_zero', 'division by zero');
                return NAN;
              }
              const v = a / b;
              return v - v === 0 ? v : guardInf(env, v, a, b);
            };
          default:
            return (env) => {
              const a = l(env);
              const b = r(env);
              if (a !== a || b !== b) return NAN;
              const v = power(a, b, env);
              return v - v === 0 ? v : guardInf(env, v, a, b);
            };
        }
      case 'num*vec':
        return (env) => {
          const k = l(env);
          const v = r(env) as Pt | undefined;
          if (k !== k || v === undefined) {
            undefIn(env);
            return undefined;
          }
          return mkPt(env, guardInf(env, k * v.x, k, v.x), guardInf(env, k * v.y, k, v.y));
        };
      case 'vec*num':
        return (env) => {
          const v = l(env) as Pt | undefined;
          const k = r(env);
          if (k !== k || v === undefined) {
            undefIn(env);
            return undefined;
          }
          return mkPt(env, guardInf(env, v.x * k, v.x, k), guardInf(env, v.y * k, v.y, k));
        };
      case 'vec/num':
        return (env) => {
          const v = l(env) as Pt | undefined;
          const k = r(env);
          if (k === 0) {
            fail(env, 'division_by_zero', 'vector divided by zero');
            return undefined;
          }
          if (k !== k || v === undefined) {
            undefIn(env);
            return undefined;
          }
          return mkPt(env, guardInf(env, v.x / k, v.x, k), guardInf(env, v.y / k, v.y, k));
        };
      case 'vec+vec':
      case 'pt+vec':
        return (env) => {
          const a = l(env) as Pt | undefined;
          const b = r(env) as Pt | undefined;
          if (a === undefined || b === undefined) {
            undefIn(env);
            return undefined;
          }
          return mkPt(env, guardInf(env, a.x + b.x, a.x, b.x), guardInf(env, a.y + b.y, a.y, b.y));
        };
      case 'vec-vec':
      case 'pt-vec':
      case 'pt-pt':
        return (env) => {
          const a = l(env) as Pt | undefined;
          const b = r(env) as Pt | undefined;
          if (a === undefined || b === undefined) {
            undefIn(env);
            return undefined;
          }
          return mkPt(env, guardInf(env, a.x - b.x, a.x, b.x), guardInf(env, a.y - b.y, a.y, b.y));
        };
      case 'text+text':
        return (env) => {
          const a = l(env) as string | undefined;
          const b = r(env) as string | undefined;
          if (a === undefined || b === undefined) {
            fail(env, 'input_undefined', 'a text that is undefined');
            return undefined;
          }
          if (a.length + b.length > MAX_TEXT_LENGTH) {
            fail(env, 'limit', `a text of ${a.length + b.length} characters`);
            return undefined;
          }
          return a + b;
        };
      case 'bool':
        if (op === 'and') {
          return (env) => {
            const a = l(env);
            if (a === false) return false;
            const b = r(env);
            if (b === false) return false;
            return a === undefined || b === undefined ? undefined : true;
          };
        }
        if (op === 'or') {
          return (env) => {
            const a = l(env);
            if (a === true) return true;
            const b = r(env);
            if (b === true) return true;
            return a === undefined || b === undefined ? undefined : false;
          };
        }
        return (env) => {
          const a = l(env);
          const b = r(env);
          return a === undefined || b === undefined ? undefined : a !== b;
        };
      case 'list-num':
        return (env) => {
          const list = l(env) as ArrayLike<number> | undefined;
          const k = r(env);
          if (list === undefined || k !== k) {
            undefIn(env);
            return undefined;
          }
          // the same rules as a single Number, per item; an item that is undefined makes the whole list undefined
          if (op === '/' && k === 0) {
            fail(env, 'division_by_zero', 'division by zero');
            return undefined;
          }
          const out = new Float64Array(list.length);
          for (let i = 0; i < list.length; i++) {
            const x = list[i] as number;
            if (x !== x) {
              undefIn(env);
              return undefined;
            }
            const v = op === '+' ? x + k : op === '-' ? x - k : op === '*' ? x * k : op === '/' ? x / k : power(x, k, env);
            const g = v - v === 0 ? v : guardInf(env, v, x, k);
            if (g !== g) {
              if (env.reason === undefined) env.reason = 'not_finite';
              return undefined;
            }
            out[i] = g;
          }
          return out;
        };
      case 'fn':
        return (env) => {
          const a = l(env);
          const b = r(env);
          if (a === undefined || b === undefined) {
            if (env.reason === undefined) env.reason = 'input_undefined';
            return undefined;
          }
          const arity = Math.max(typeof a === 'object' ? (a as FunctionValue).arity : 1, typeof b === 'object' ? (b as FunctionValue).arity : 1);
          // a Number operand that is undefined makes the whole function undefined
          if ((typeof a === 'number' && a !== a) || (typeof b === 'number' && b !== b)) {
            undefIn(env);
            return undefined;
          }
          return pointwise(env, [a, b], op, arity);
        };
      default:
        return () => undefined;
    }
  }

  compileCmp(n: TNode & { n: 'cmp' }): Fn {
    const fs = n.operands.map((o) => this.compile(o));
    const ops = n.ops;
    const tys = n.operands.map((o) => o.ty.k);
    return (env) => {
      let prev = (fs[0] as Fn)(env);
      let all: boolean | undefined = true;
      for (let i = 0; i < ops.length; i++) {
        const next = (fs[i + 1] as Fn)(env);
        const op = ops[i] as string;
        let res: boolean | undefined;
        if (op === '==' || op === '!=') {
          const eq = valueEq(prev, next);
          res = eq === undefined ? undefined : op === '==' ? eq : !eq;
        } else {
          res = cmpNum(op, prev, next);
        }
        void tys;
        if (res === false) return false;
        if (res === undefined) all = undefined;
        prev = next;
      }
      return all;
    };
  }

  compileCallObj(n: TNode & { n: 'callObj' }): Fn {
    const args = n.args.map((a) => this.compile(a));
    const id = n.id;
    const isN = isNum(n);
    return (env) => {
      const fv = env.read(id) as FunctionValue | undefined;
      if (fv === undefined) {
        failInput(env, id);
        return isN ? NAN : undefined;
      }
      const xs: number[] = [];
      for (const a of args) {
        const x = a(env);
        if (x !== x) return isN ? NAN : undefined;
        xs.push(x);
      }
      const v = xs.length === 1 && fv.call1 && isN ? fv.call1(xs[0] as number) : fv.call(...xs);
      if (v === undefined || (typeof v === 'number' && v !== v)) {
        fail(env, fv.reason ?? 'not_finite');
        return isN ? NAN : undefined;
      }
      return v;
    };
  }

  compileBuiltin(n: TNode & { n: 'builtin' }): Fn {
    const form = n.form;
    const args = n.args.map((a) => this.compile(a));
    const retNum = form.returns === 'Number';
    const undef = retNum ? NAN : undefined;
    // an infinite result is allowed only when one of this call's own arguments was infinite
    const fin = (env: Env, v: number, anyInf: boolean): number => {
      if (v - v === 0) return v;
      if (anyInf && (v === Infinity || v === -Infinity)) return v;
      if (env.reason === undefined) env.reason = v !== v || anyInf ? 'not_finite' : 'overflow';
      return NAN;
    };
    if (form.n1 && args.length === 1) {
      const f = form.n1;
      const a = args[0] as Fn;
      return (env) => {
        const x = a(env);
        if (x !== x) return NAN;
        return fin(env, f(x, env), x === Infinity || x === -Infinity);
      };
    }
    if (form.n2 && args.length === 2) {
      const f = form.n2;
      const a = args[0] as Fn;
      const b = args[1] as Fn;
      return (env) => {
        const x = a(env);
        const y = b(env);
        if (x !== x || y !== y) return NAN;
        return fin(env, f(x, y, env), !Number.isFinite(x) || !Number.isFinite(y));
      };
    }
    if (form.n3 && args.length === 3) {
      const f = form.n3;
      const a = args[0] as Fn;
      const b = args[1] as Fn;
      const c = args[2] as Fn;
      return (env) => {
        const x = a(env);
        const y = b(env);
        const z = c(env);
        if (x !== x || y !== y || z !== z) return NAN;
        return fin(env, f(x, y, z, env), !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z));
      };
    }
    const call = form.call;
    if (!call) return () => undef;
    return (env) => {
      const vals: unknown[] = [];
      for (const a of args) {
        const v = a(env);
        if (v === undefined || (typeof v === 'number' && v !== v)) return undef;
        vals.push(v);
      }
      const out = call(env, vals);
      if (typeof out === 'number') return fin(env, out, vals.some(hasNonFinite));
      return out;
    };
  }

  compileCommand(n: TNode & { n: 'command' }): Fn {
    const args = this.compileArgs(n);
    const run = this.opts.runCommand;
    const undef = undefFor(n);
    return (env) => {
      if (!run) {
        fail(env, 'not_set', `${n.spec.name} is evaluated by the kernel`);
        return undef;
      }
      return run(n.spec, n.form, args, env);
    };
  }

  compileArgs(n: TNode & { n: 'command' }): CompiledArg[] {
    return n.args.map((a) => ({
      param: a.param,
      omitted: a.omitted,
      ...(a.expr ? { eval: this.compile(a.expr) } : {}),
      ...(a.binder !== undefined ? { binder: a.binder } : {}),
      ...(a.slot !== undefined ? { slot: a.slot } : {}),
      ...(a.value !== undefined ? { value: a.value } : {}),
    }));
  }

  compileTick(n: TNode & { n: 'tick' }): Fn {
    const a = this.compile(n.arg);
    const id = n.id;
    const ticks = n.ticks;
    return (env) => {
      const x = a(env);
      if (x !== x) return NAN;
      const fv = env.read(id) as FunctionValue | undefined;
      if (fv === undefined) {
        failInput(env, id);
        return NAN;
      }
      const f = (t: number): number => {
        const v = fv.call1 ? fv.call1(t) : (fv.call(t) as number);
        return typeof v === 'number' ? v : NAN;
      };
      const scale = Math.max(1, Math.abs(x));
      let d: number;
      if (ticks === 1) {
        const h = 6e-6 * scale;
        d = (f(x + h) - f(x - h)) / (2 * h);
      } else if (ticks === 2) {
        const h = 1.2e-4 * scale;
        d = (f(x + h) - 2 * f(x) + f(x - h)) / (h * h);
      } else {
        const h = 7e-4 * scale;
        d = (f(x + 2 * h) - 2 * f(x + h) + 2 * f(x - h) - f(x - 2 * h)) / (2 * h * h * h);
      }
      if (d !== d || !Number.isFinite(d)) {
        fail(env, fv.reason ?? 'not_finite');
        return NAN;
      }
      return d;
    };
  }

  compileIndex(n: TNode & { n: 'index' }): Fn {
    const t = this.compile(n.target);
    const i = this.compile(n.index);
    const isN = isNum(n);
    return (env) => {
      const list = t(env) as ArrayLike<unknown> | undefined;
      const k = i(env);
      if (list === undefined || k !== k) return isN ? NAN : undefined;
      if (!Number.isInteger(k)) {
        fail(env, 'not_integer', `index ${k}`);
        return isN ? NAN : undefined;
      }
      const len = list.length;
      const idx = k > 0 ? k - 1 : len + k;
      if (k === 0 || idx < 0 || idx >= len) {
        fail(env, 'index_out_of_range', `index ${k} of ${len}`);
        return isN ? NAN : undefined;
      }
      const v = list[idx];
      if (v === undefined || (typeof v === 'number' && v !== v)) {
        if (env.reason === undefined) env.reason = 'input_undefined';
        return isN ? NAN : undefined;
      }
      return v;
    };
  }

  compileRange(n: TNode & { n: 'range' }): Fn {
    const from = this.compile(n.from);
    const to = this.compile(n.to);
    const step = n.step ? this.compile(n.step) : undefined;
    return (env) => {
      const a = from(env);
      const b = to(env);
      const s = step ? step(env) : 1;
      if (a !== a || b !== b || s !== s) return undefined;
      if (!Number.isFinite(a) || !Number.isFinite(b) || s === 0 || !Number.isFinite(s)) {
        fail(env, 'out_of_domain', 'a range needs finite bounds and a step that is not 0');
        return undefined;
      }
      const count = Math.floor((b - a) / s + 1e-9) + 1;
      if (count > 100000) {
        fail(env, 'limit', `${count} items`);
        return undefined;
      }
      const out = new Float64Array(Math.max(0, count));
      for (let i = 0; i < out.length; i++) out[i] = a + i * s;
      return out;
    };
  }

  compileCond(n: TNode & { n: 'cond' }): Fn {
    const arms = n.arms.map((a) => ({ c: this.compile(a.c), v: this.compile(a.v) }));
    const otherwise = n.otherwise ? this.compile(n.otherwise) : undefined;
    const undef = undefFor(n);
    return (env) => {
      for (const arm of arms) {
        const c = arm.c(env);
        if (c === undefined) {
          if (env.reason === undefined) env.reason = 'input_undefined';
          return undef;
        }
        if (c === true) return arm.v(env);
      }
      if (otherwise) return otherwise(env);
      fail(env, 'condition_false', 'no condition held');
      return undef;
    };
  }

  compileRelation(n: TNode & { n: 'relation' }): Fn {
    const sx = n.slotX;
    const sy = n.slotY;
    const tree = this.compileTree(n.tree);
    const first = firstCmp(n.tree);
    const lhs = this.compile(first.operands[0] as TNode);
    const rhs = this.compile(first.operands[1] as TNode);
    const poly = n.poly
      ? { xx: this.compile(n.poly.xx), xy: this.compile(n.poly.xy), yy: this.compile(n.poly.yy), x: this.compile(n.poly.x), y: this.compile(n.poly.y), c: this.compile(n.poly.c) }
      : undefined;
    const ops = collectOps(n.tree);
    return (env): RelationValue => {
      // x and y are written into the shared locals for the call only, so another line sharing the Env keeps its own slots
      const residual = (x: number, y: number): number => {
        const ox = env.locals[sx];
        const oy = env.locals[sy];
        env.locals[sx] = x;
        env.locals[sy] = y;
        const v = lhs(env) - rhs(env);
        env.locals[sx] = ox;
        env.locals[sy] = oy;
        return v;
      };
      const test = (x: number, y: number): boolean | undefined => {
        const ox = env.locals[sx];
        const oy = env.locals[sy];
        env.locals[sx] = x;
        env.locals[sy] = y;
        const v = tree(env);
        env.locals[sx] = ox;
        env.locals[sy] = oy;
        return v;
      };
      let p: RelationValue['poly'];
      if (poly) {
        const c = { xx: poly.xx(env), xy: poly.xy(env), yy: poly.yy(env), x: poly.x(env), y: poly.y(env), c: poly.c(env) };
        p = Object.values(c).every((v) => v === v) ? c : undefined;
      }
      return { ops, residual, test, poly: p };
    };
  }

  compileTree(t: RelTree): (env: Env) => boolean | undefined {
    if (t.t === 'cmp') {
      const fs = t.operands.map((o) => this.compile(o));
      const ops = t.ops;
      return (env) => {
        let prev = (fs[0] as Fn)(env);
        let all: boolean | undefined = true;
        for (let i = 0; i < ops.length; i++) {
          const next = (fs[i + 1] as Fn)(env);
          const op = ops[i] as string;
          let res: boolean | undefined;
          if (op === '==' || op === '!=') {
            if (prev !== prev || next !== next) res = undefined;
            else {
              const eq = numEq(prev, next, 1e-9);
              res = op === '==' ? eq : !eq;
            }
          } else res = cmpNum(op, prev, next);
          if (res === false) return false;
          if (res === undefined) all = undefined;
          prev = next;
        }
        return all;
      };
    }
    if (t.t === 'not') {
      const a = this.compileTree(t.a);
      return (env) => {
        const v = a(env);
        return v === undefined ? undefined : !v;
      };
    }
    const l = this.compileTree(t.l);
    const r = this.compileTree(t.r);
    if (t.t === 'and') {
      return (env) => {
        const a = l(env);
        if (a === false) return false;
        const b = r(env);
        return b === false ? false : a === undefined || b === undefined ? undefined : true;
      };
    }
    if (t.t === 'or') {
      return (env) => {
        const a = l(env);
        if (a === true) return true;
        const b = r(env);
        return b === true ? true : a === undefined || b === undefined ? undefined : false;
      };
    }
    return (env) => {
      const a = l(env);
      const b = r(env);
      return a === undefined || b === undefined ? undefined : a !== b;
    };
  }
}

function firstCmp(t: RelTree): { operands: readonly TNode[] } {
  if (t.t === 'cmp') return t;
  if (t.t === 'not') return firstCmp(t.a);
  return firstCmp(t.l);
}
function collectOps(t: RelTree): string[] {
  if (t.t === 'cmp') return [...t.ops];
  if (t.t === 'not') return collectOps(t.a);
  return [...collectOps(t.l), ...collectOps(t.r)];
}

/**
 * A function whose value at x is `op` applied to the operands' values at x. It follows the same rules as a single Number:
 * an undefined operand gives `input_undefined`, a zero divisor (or `0 ^ negative`) gives `division_by_zero`, a negative base
 * with a fractional exponent gives `out_of_domain`, an infinity made from finite inputs gives `overflow`, an infinity that
 * follows an infinite input is a value, and a result that is not a number (`inf - inf`) gives `not_finite`.
 */
function pointwise(env: Env, operands: unknown[], op: string, arity: number): FunctionValue {
  const evalAt = (o: unknown, xs: number[]): number => {
    if (typeof o === 'number') return o;
    const fv = o as FunctionValue;
    const v = fv.call(...xs.slice(0, fv.arity));
    return typeof v === 'number' ? v : NAN;
  };
  const self: FunctionValue & { reason?: UndefReason | undefined } = {
    arity,
    ret: 'Number',
    call: (...xs: number[]) => {
      self.reason = undefined;
      const a = evalAt(operands[0], xs);
      const b = operands.length > 1 ? evalAt(operands[1], xs) : a;
      if (a !== a || b !== b) {
        self.reason = 'input_undefined';
        return NAN;
      }
      let v: number;
      switch (op) {
        case 'neg':
          v = -a;
          break;
        case '+':
          v = a + b;
          break;
        case '-':
          v = a - b;
          break;
        case '*':
          v = a * b;
          break;
        case '/':
          if (b === 0) {
            self.reason = 'division_by_zero';
            return NAN;
          }
          v = a / b;
          break;
        default:
          if (a === 0 && b < 0) {
            self.reason = 'division_by_zero';
            return NAN;
          }
          if (a < 0 && !Number.isInteger(b)) {
            self.reason = 'out_of_domain';
            return NAN;
          }
          v = getMathLib().pow(a, b);
      }
      if (v - v !== 0) {
        if (v !== v) {
          self.reason = 'not_finite';
          return NAN;
        }
        if (a - a === 0 && b - b === 0) {
          self.reason = 'overflow';
          return NAN;
        }
      }
      return v;
    },
  };
  void env;
  return self;
}

/* ------------------------------- public compile ------------------------------- */

/** Compile one typed expression. */
export function compileNode(n: TNode, opts: CompileOptions = {}): Compiled<unknown> {
  const c = new Compiler(opts);
  const f = c.compile(n);
  const reads = new Set<ObjId>();
  let usesT = false;
  const walk = (x: TNode): void => {
    if (x.n === 'ref' || x.n === 'callObj' || x.n === 'tick') reads.add(x.id);
    if (x.n === 'clock') usesT = true;
    children(x).forEach(walk);
  };
  walk(n);
  const isN = isNum(n);
  return {
    reads,
    usesT,
    eval: (env) => {
      const v = f(env);
      if (isN) return setNanReason(env, v as number);
      return v;
    },
  };
}

/**
 * Compile a checked line. The result evaluates the line's right-hand side; for a function
 * definition it returns a `FunctionValue` bound to the environment.
 */
export function compileLine(line: CheckedLine, opts: CompileOptions = {}): Result<CompiledLine> {
  try {
    const c = new Compiler(opts);
    const reads = new Set<ObjId>(line.reads);
    const style = (line.style ?? []).map((s) => ('word' in s.value ? { key: s.key, word: s.value.word } : { key: s.key, eval: c.compile(s.value) }));
    let evalFn: (env: Env) => unknown = () => undefined;
    let command: CompiledLine['command'];
    let state: CompiledLine['state'];
    const expr = line.expr;
    if (expr) {
      const f = c.compile(expr);
      const isN = expr.ty.k === 'Number';
      if (line.kind === 'function') {
        const params = line.params ?? [];
        const ret = expr.ty.k === 'Point' ? 'Point' : 'Number';
        evalFn = (env) => {
          const fv: FunctionValue & { reason?: UndefReason | undefined } = {
            arity: params.length,
            ret,
            reason: undefined,
            call: (...xs: number[]) => {
              const saved = env.reason;
              const savedVia = env.via;
              env.reason = undefined;
              // the parameters live in the shared locals only for this call: put back what the caller had there
              const before = params.map((p) => env.locals[p.slot]);
              for (let i = 0; i < params.length; i++) env.locals[(params[i] as { slot: number }).slot] = xs[i];
              const v = f(env);
              let out: unknown = v;
              if (isN) out = setNanReason(env, v as number);
              for (let i = 0; i < params.length; i++) env.locals[(params[i] as { slot: number }).slot] = before[i];
              fv.reason = env.reason;
              env.reason = saved;
              env.via = savedVia;
              return out as number | Pt | undefined;
            },
          };
          if (isN && params.length === 1) {
            const slot = (params[0] as { slot: number }).slot;
            fv.call1 = (x: number): number => {
              const saved = env.reason;
              env.reason = undefined;
              const before = env.locals[slot];
              env.locals[slot] = x;
              const v = setNanReason(env, f(env) as number);
              env.locals[slot] = before;
              fv.reason = env.reason;
              env.reason = saved;
              return v;
            };
            fv.batch = (xs: Float64Array, out: Float64Array): void => {
              const saved = env.reason;
              const before = env.locals[slot];
              for (let i = 0; i < xs.length; i++) {
                env.reason = undefined;
                env.locals[slot] = xs[i];
                out[i] = setNanReason(env, f(env) as number);
              }
              env.locals[slot] = before;
              env.reason = saved;
            };
          }
          return fv;
        };
      } else {
        evalFn = (env) => {
          const v = f(env);
          return isN ? setNanReason(env, v as number) : v;
        };
        if (expr.n === 'command') {
          command = { spec: expr.spec, form: expr.form, args: c.compileArgs(expr) };
        }
      }
    }
    if (line.state) {
      state = { initial: c.compile(line.state.initial), ...(line.state.velocity ? { velocity: c.compile(line.state.velocity) } : {}) };
    }
    const range = line.range
      ? { min: c.compile(line.range.from), max: c.compile(line.range.to), ...(line.range.step ? { step: c.compile(line.range.step) } : {}) }
      : undefined;
    const compiled: CompiledLine = {
      line,
      reads,
      usesT: line.usesT,
      styleReads: new Set<ObjId>(line.styleReads ?? []),
      rangeReads: new Set<ObjId>(line.rangeReads ?? []),
      styleUsesT: line.styleUsesT ?? false,
      rangeUsesT: line.rangeUsesT ?? false,
      eval: evalFn,
      style,
      ...(range ? { range } : {}),
      ...(command ? { command } : {}),
      ...(state ? { state } : {}),
    };
    return { ok: true, value: compiled, notices: [] };
  } catch (err) {
    return internal(line, err);
  }
}

function internal(line: CheckedLine, err: unknown): LanguageError {
  void err;
  return buildError('internal', 'lang.internal', { where: 'compiling the line' }, line.line, 1, 1, '', undefined, { recovery: 'report', fingerprintKey: 'compile' });
}

/* --------------------------------- evaluation --------------------------------- */

export type EvalResult =
  | { readonly defined: true; readonly value: unknown }
  | { readonly defined: false; readonly reason: UndefReason; readonly detail?: string; readonly via?: ObjId };

/** Run a compiled line's right-hand side and report the value or why it is undefined. Never throws. */
export function evaluate(compiled: Compiled<unknown>, env: Env): EvalResult {
  env.reason = undefined;
  env.via = undefined;
  env.detail = undefined;
  let v: unknown;
  try {
    v = compiled.eval(env);
  } catch {
    return { defined: false, reason: 'not_finite', detail: 'internal evaluation fault' };
  }
  if (v === undefined || (typeof v === 'number' && v !== v)) {
    return {
      defined: false,
      reason: env.reason ?? 'not_finite',
      ...(env.detail !== undefined ? { detail: env.detail } : {}),
      ...(env.via !== undefined ? { via: env.via } : {}),
    };
  }
  return { defined: true, value: v };
}

export { tyStr };
