/**
 * `SymNode`: the interned, immutable symbolic tree (cas/design.md 5.2, 5.5).
 *
 * Nodes are immutable and interned: two equal trees are the same object, so equality is a
 * pointer test. Subtraction and division do not exist as nodes: `a - b` is `add(a, mul(-1, b))`
 * and `a / b` is `mul(a, pow(b, -1))`. `sqrt(x)` is `pow(x, 1/2)`.
 */
import type { ObjId } from '@incantly/kernel';
import type { UPoly } from './poly';

/** Built-in functions the symbolic layer understands. */
export type SymFn =
  | 'sin' | 'cos' | 'tan' | 'asin' | 'acos' | 'atan' | 'atan2'
  | 'sinh' | 'cosh' | 'tanh' | 'asinh' | 'acosh' | 'atanh'
  | 'exp' | 'ln' | 'log10' | 'log2'
  | 'abs' | 'sign' | 'floor' | 'ceil' | 'round'
  | 'min' | 'max' | 'sqrt' | 'cbrt';

export type SymNodeBody =
  | { readonly k: 'int'; readonly v: bigint }
  | { readonly k: 'rat'; readonly n: bigint; readonly d: bigint }
  | { readonly k: 'dec'; readonly mant: bigint; readonly exp: number; readonly prec: number }
  | { readonly k: 'float'; readonly v: number }
  | { readonly k: 'const'; readonly name: 'pi' | 'e' | 'i' | 'inf' }
  | { readonly k: 'sym'; readonly name: string }
  | { readonly k: 'ref'; readonly obj: number }
  | { readonly k: 'add'; readonly terms: readonly SymNode[] }
  | { readonly k: 'mul'; readonly factors: readonly SymNode[] }
  | { readonly k: 'pow'; readonly base: SymNode; readonly exp: SymNode }
  | { readonly k: 'fn'; readonly name: SymFn; readonly args: readonly SymNode[] }
  | { readonly k: 'rootof'; readonly poly: UPoly; readonly index: number; readonly hint: number }
  | { readonly k: 'list'; readonly items: readonly SymNode[] }
  | { readonly k: 'piecewise'; readonly cases: readonly { readonly when: SymCond; readonly then: SymNode }[]; readonly other?: SymNode };

export type SymNode = Readonly<SymNodeBody> & { readonly id: number; readonly hash: number };

/** A size limit stopped the computation (caught by `run` → undefined `limit`). */
export class LimitExceeded extends Error {
  readonly limit: string;
  constructor(limit: string) {
    super(`limit: ${limit}`);
    this.name = 'LimitExceeded';
    this.limit = limit;
  }
}

export type SymRelOp = '==' | '!=' | '<' | '<=' | '>' | '>=';

export type SymCond =
  | { readonly c: 'rel'; readonly op: SymRelOp; readonly l: SymNode; readonly r: SymNode }
  | { readonly c: 'in'; readonly l: SymNode; readonly set: 'R' | 'C' | 'Z' | 'N' | 'Q' }
  | { readonly c: 'and' | 'or'; readonly of: readonly SymCond[] }
  | { readonly c: 'not'; readonly of: SymCond }
  | { readonly c: 'true' | 'false' };

/* --------------------------------- interning -------------------------------- */

const KIND_RANK: Readonly<Record<string, number>> = {
  int: 0, rat: 1, dec: 2, float: 3, const: 4, sym: 5, ref: 6,
  add: 7, mul: 8, pow: 9, fn: 10, rootof: 11, list: 12, piecewise: 13,
};

function hashStr(s: string, h: number): number {
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h | 0;
}

function hashBig(v: bigint, h: number): number {
  if (v >= BigInt(-2147483648) && v <= BigInt(2147483647)) return (Math.imul(h, 31) + Number(v)) | 0;
  return hashStr(v.toString(36), h);
}

/** Structural hash of a body whose children are already interned. */
function hashBody(b: SymNodeBody): number {
  let h = (KIND_RANK[b.k] ?? 99) | 0;
  switch (b.k) {
    case 'int': return hashBig(b.v, h);
    case 'rat': return hashBig(b.d, hashBig(b.n, h));
    case 'dec': return hashBig(b.mant, (Math.imul(h, 31) + b.exp * 7 + b.prec) | 0);
    case 'float': return hashStr(String(b.v), h);
    case 'const': return hashStr(b.name, h);
    case 'sym': return hashStr(b.name, h);
    case 'ref': return (Math.imul(h, 31) + b.obj) | 0;
    case 'add':
      for (const t of b.terms) h = (Math.imul(h, 31) + t.hash) | 0;
      return h;
    case 'mul':
      for (const f of b.factors) h = (Math.imul(h, 31) + f.hash) | 0;
      return h;
    case 'pow': return (Math.imul(Math.imul(h, 31) + b.base.hash, 31) + b.exp.hash) | 0;
    case 'fn':
      h = hashStr(b.name, h);
      for (const a of b.args) h = (Math.imul(h, 31) + a.hash) | 0;
      return h;
    case 'rootof': return (Math.imul(hashStr(JSON.stringify(b.poly.c.map(String)) + '/' + String(b.poly.den), h), 31) + b.index) | 0;
    case 'list':
      for (const i of b.items) h = (Math.imul(h, 31) + i.hash) | 0;
      return h;
    case 'piecewise': {
      for (const cs of b.cases) h = (Math.imul(Math.imul(h, 31) + hashCond(cs.when), 31) + cs.then.hash) | 0;
      return b.other === undefined ? h : (Math.imul(h, 31) + b.other.hash) | 0;
    }
  }
}

function hashCond(c: SymCond): number {
  switch (c.c) {
    case 'true': return 1;
    case 'false': return 2;
    case 'rel': return (Math.imul(Math.imul(hashStr(c.op, 7), 31) + c.l.hash, 31) + c.r.hash) | 0;
    case 'in': return (Math.imul(hashStr(c.set, 13), 31) + c.l.hash) | 0;
    case 'not': return (Math.imul(17, 31) + hashCond(c.of)) | 0;
    case 'and':
    case 'or': {
      let h = c.c === 'and' ? 19 : 23;
      for (const o of c.of) h = (Math.imul(h, 31) + hashCond(o)) | 0;
      return h;
    }
  }
}

function keyOf(b: SymNodeBody): string {
  switch (b.k) {
    case 'int': return `i${b.v.toString(36)}`;
    case 'rat': return `r${b.n.toString(36)}/${b.d.toString(36)}`;
    case 'dec': return `d${b.mant.toString(36)}e${b.exp}p${b.prec}`;
    case 'float': return `f${String(b.v)}`;
    case 'const': return `c${b.name}`;
    case 'sym': return `s${b.name}`;
    case 'ref': return `R${b.obj}`;
    case 'add': return `a[${b.terms.map((t) => t.id).join(',')}]`;
    case 'mul': return `m[${b.factors.map((t) => t.id).join(',')}]`;
    case 'pow': return `p${b.base.id}^${b.exp.id}`;
    case 'fn': return `${b.name}(${b.args.map((t) => t.id).join(',')})`;
    case 'rootof': return `t${b.poly.c.map(String).join(',')}/${String(b.poly.den)}#${b.index}`;
    case 'list': return `l[${b.items.map((t) => t.id).join(',')}]`;
    case 'piecewise': return `w[${b.cases.map((cs) => `${condKey(cs.when)}:${cs.then.id}`).join(',')}]${b.other === undefined ? '' : `|${b.other.id}`}`;
  }
}

function condKey(c: SymCond): string {
  switch (c.c) {
    case 'true': return 'T';
    case 'false': return 'F';
    case 'rel': return `${c.l.id}${c.op}${c.r.id}`;
    case 'in': return `${c.l.id}in${c.set}`;
    case 'not': return `!${condKey(c.of)}`;
    case 'and': return `&(${c.of.map(condKey).join(',')})`;
    case 'or': return `|(${c.of.map(condKey).join(',')})`;
  }
}

/** The arena: every node of one engine instance. Rebuild drops unreachable nodes. */
export interface Arena {
  intern(b: SymNodeBody): SymNode;
  size(): number;
  clear(): void;
}

export function createArena(): Arena {
  const map = new Map<string, SymNode>();
  let next = 1;
  return {
    intern(b: SymNodeBody): SymNode {
      const key = keyOf(b);
      const hit = map.get(key);
      if (hit !== undefined) return hit;
      const n = { ...b, id: next++, hash: hashBody(b) } as SymNode;
      map.set(key, n);
      return n;
    },
    size(): number {
      return map.size;
    },
    clear(): void {
      map.clear();
      next = 1;
    },
  };
}

/** The shared arena. Engines that need isolation create their own. */
export const arena: Arena = createArena();

function intern(b: SymNodeBody): SymNode {
  return arena.intern(b);
}

/* ------------------------------ total ordering ------------------------------ */

/**
 * Total order over nodes: kind rank, then structural comparison, then id.
 * Never depends on insertion time, so results are reproducible across runs.
 */
export function compareNodes(a: SymNode, b: SymNode): number {
  if (a === b) return 0;
  const ra = KIND_RANK[a.k] ?? 99;
  const rb = KIND_RANK[b.k] ?? 99;
  if (ra !== rb) return ra - rb;
  switch (a.k) {
    case 'int': {
      const o = b as SymNode & { k: 'int' };
      return a.v < o.v ? -1 : a.v > o.v ? 1 : a.id - b.id;
    }
    case 'rat': {
      const o = b as SymNode & { k: 'rat' };
      const l = a.n * o.d;
      const r = o.n * a.d;
      return l < r ? -1 : l > r ? 1 : a.id - b.id;
    }
    case 'sym': {
      const o = b as SymNode & { k: 'sym' };
      return a.name < o.name ? -1 : a.name > o.name ? 1 : 0;
    }
    case 'const': {
      const o = b as SymNode & { k: 'const' };
      return a.name < o.name ? -1 : a.name > o.name ? 1 : 0;
    }
    default:
      if (a.hash !== b.hash) return a.hash - b.hash;
      return compareStructural(a, b);
  }
}

/**
 * Structural tiebreak for hash collisions: a total order that never consults node ids,
 * so canonical order is identical however the trees were built.
 */
function compareStructural(a: SymNode, b: SymNode): number {
  if (a === b) return 0;
  const kids = (t: SymNode): readonly SymNode[] => {
    switch (t.k) {
      case 'add': return t.terms;
      case 'mul': return t.factors;
      case 'pow': return [t.base, t.exp];
      case 'fn': return t.args;
      case 'list': return t.items;
      default: return [];
    }
  };
  if (a.k === 'int' && b.k === 'int') return a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
  if (a.k === 'rat' && b.k === 'rat') {
    const l = a.n * b.d;
    const r = b.n * a.d;
    return l < r ? -1 : l > r ? 1 : 0;
  }
  if (a.k === 'dec' && b.k === 'dec') {
    if (a.exp !== b.exp) return a.exp - b.exp;
    return a.mant < b.mant ? -1 : a.mant > b.mant ? 1 : 0;
  }
  if (a.k === 'float' && b.k === 'float') return a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
  if (a.k === 'sym' && b.k === 'sym') return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  if (a.k === 'const' && b.k === 'const') return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  if (a.k === 'ref' && b.k === 'ref') return a.obj - b.obj;
  if (a.k === 'fn' && b.k === 'fn' && a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.k === 'rootof' && b.k === 'rootof') {
    if (a.index !== b.index) return a.index - b.index;
    if (a.poly.c.length !== b.poly.c.length) return a.poly.c.length - b.poly.c.length;
    for (let i = 0; i < a.poly.c.length; i++) {
      const x = a.poly.c[i] as bigint;
      const y = b.poly.c[i] as bigint;
      if (x !== y) return x < y ? -1 : 1;
    }
    if (a.poly.den !== b.poly.den) return a.poly.den < b.poly.den ? -1 : 1;
    return 0;
  }
  const ka = kids(a);
  const kb = kids(b);
  const n = Math.min(ka.length, kb.length);
  for (let i = 0; i < n; i++) {
    const c = compareStructural(ka[i] as SymNode, kb[i] as SymNode);
    if (c !== 0) return c;
  }
  if (ka.length !== kb.length) return ka.length - kb.length;
  if (a.k === 'piecewise' && b.k === 'piecewise') {
    if (a.cases.length !== b.cases.length) return a.cases.length - b.cases.length;
    for (let i = 0; i < a.cases.length; i++) {
      const ca = a.cases[i] as { when: SymCond; then: SymNode };
      const cb = b.cases[i] as { when: SymCond; then: SymNode };
      const ha = hashCond(ca.when);
      const hb = hashCond(cb.when);
      if (ha !== hb) return ha - hb;
      const c = compareStructural(ca.then, cb.then);
      if (c !== 0) return c;
    }
    if ((a.other === undefined) !== (b.other === undefined)) return a.other === undefined ? -1 : 1;
    if (a.other !== undefined && b.other !== undefined) return compareStructural(a.other, b.other);
  }
  return 0;
}

/* ------------------------------ smart constructors --------------------------- */

export function intN(v: bigint | number): SymNode {
  const b = typeof v === 'number' ? BigInt(Math.trunc(v)) : v;
  return intern({ k: 'int', v: b });
}

export function ratN(n: bigint, d: bigint): SymNode {
  if (d === 0n) throw new Error('ratN: zero denominator');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = bigGcd(n < 0n ? -n : n, d);
  n /= g;
  d /= g;
  if (d === 1n) return intern({ k: 'int', v: n });
  return intern({ k: 'rat', n, d });
}

export function decN(mant: bigint, exp: number, prec: number): SymNode {
  return intern({ k: 'dec', mant, exp, prec });
}

export function floatN(v: number): SymNode {
  return intern({ k: 'float', v });
}

export function constN(name: 'pi' | 'e' | 'i' | 'inf'): SymNode {
  return intern({ k: 'const', name });
}

export function symN(name: string): SymNode & { k: 'sym' } {
  return intern({ k: 'sym', name }) as SymNode & { k: 'sym' };
}

export function refN(obj: ObjId | number): SymNode {
  return intern({ k: 'ref', obj: Number(obj) });
}

export const ZERO: SymNode = intern({ k: 'int', v: 0n });
export const ONE: SymNode = intern({ k: 'int', v: 1n });
export const MINUS_ONE: SymNode = intern({ k: 'int', v: -1n });
export const TWO: SymNode = intern({ k: 'int', v: 2n });
export const HALF: SymNode = intern({ k: 'rat', n: 1n, d: 2n });

export function bigGcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a === 0n ? 1n : a;
}

export function isZeroNode(n: SymNode): boolean {
  return (n.k === 'int' && n.v === 0n) || (n.k === 'float' && n.v === 0) || (n.k === 'dec' && n.mant === 0n);
}

export function isOneNode(n: SymNode): boolean {
  return (n.k === 'int' && n.v === 1n) || (n.k === 'float' && n.v === 1);
}

/** True for exact numeric leaves: int, rat. */
export function isExactNumber(n: SymNode): boolean {
  return n.k === 'int' || n.k === 'rat';
}

export function isNumberNode(n: SymNode): boolean {
  return n.k === 'int' || n.k === 'rat' || n.k === 'dec' || n.k === 'float';
}

/** Split a term into its numeric coefficient and the rest (for like-term collection). */
function splitCoeff(t: SymNode): { coeff: SymNode; rest: SymNode | null } {
  if (isNumberNode(t)) return { coeff: t, rest: null };
  if (t.k === 'mul') {
    const first = t.factors[0];
    if (first !== undefined && isNumberNode(first)) {
      const rest = t.factors.slice(1);
      if (rest.length === 0) return { coeff: first, rest: null };
      if (rest.length === 1) return { coeff: first, rest: rest[0] as SymNode };
      return { coeff: first, rest: intern({ k: 'mul', factors: rest }) };
    }
  }
  if (t.k === 'pow' || t.k === 'fn' || t.k === 'sym' || t.k === 'const' || t.k === 'ref' || t.k === 'rootof' || t.k === 'add' || t.k === 'list' || t.k === 'piecewise' || t.k === 'dec' || t.k === 'float' || t.k === 'int' || t.k === 'rat') {
    return { coeff: ONE, rest: t };
  }
  return { coeff: ONE, rest: t };
}

function addNumbers(a: SymNode, b: SymNode): SymNode {
  if (a.k === 'float' || b.k === 'float') return floatN(toFloat(a) + toFloat(b));
  if (a.k === 'dec' || b.k === 'dec') return floatN(toFloat(a) + toFloat(b));
  if (a.k === 'int' && b.k === 'int') return intN(a.v + b.v);
  const an = a.k === 'int' ? a.v : (a as { n: bigint }).n;
  const ad = a.k === 'int' ? 1n : (a as { d: bigint }).d;
  const bn = b.k === 'int' ? b.v : (b as { n: bigint }).n;
  const bd = b.k === 'int' ? 1n : (b as { d: bigint }).d;
  return ratN(an * bd + bn * ad, ad * bd);
}

function mulNumbers(a: SymNode, b: SymNode): SymNode {
  if (a.k === 'float' || b.k === 'float') return floatN(toFloat(a) * toFloat(b));
  if (a.k === 'dec' || b.k === 'dec') return floatN(toFloat(a) * toFloat(b));
  if (a.k === 'int' && b.k === 'int') return intN(a.v * b.v);
  const an = a.k === 'int' ? a.v : (a as { n: bigint }).n;
  const ad = a.k === 'int' ? 1n : (a as { d: bigint }).d;
  const bn = b.k === 'int' ? b.v : (b as { n: bigint }).n;
  const bd = b.k === 'int' ? 1n : (b as { d: bigint }).d;
  return ratN(an * bn, ad * bd);
}

export function negateNode(n: SymNode): SymNode {
  if (n.k === 'int') return intN(-n.v);
  if (n.k === 'rat') return ratN(-n.n, n.d);
  if (n.k === 'float') return floatN(-n.v);
  if (n.k === 'dec') return decN(-n.mant, n.exp, n.prec);
  return mul(MINUS_ONE, n);
}

/**
 * Canonical sum: flatten, fold numbers, collect like terms, drop zeros, sort.
 * The number (if any) sorts first.
 */
export function add(...terms: SymNode[]): SymNode {
  const flat: SymNode[] = [];
  for (const t of terms) {
    if (t.k === 'add') flat.push(...t.terms);
    else flat.push(t);
  }
  let num: SymNode | null = null;
  const byRest = new Map<number, { rest: SymNode; coeff: SymNode }>();
  const order: number[] = [];
  for (const t of flat) {
    if (isZeroNode(t)) continue;
    const { coeff, rest } = splitCoeff(t);
    if (rest === null) {
      num = num === null ? coeff : addNumbers(num, coeff);
      continue;
    }
    const hit = byRest.get(rest.id);
    if (hit === undefined) {
      byRest.set(rest.id, { rest, coeff });
      order.push(rest.id);
    } else {
      hit.coeff = addNumbers(hit.coeff, coeff);
    }
  }
  const out: SymNode[] = [];
  if (num !== null && !isZeroNode(num)) out.push(num);
  for (const id of order) {
    const e = byRest.get(id);
    if (e === undefined || isZeroNode(e.coeff)) continue;
    if (isOneNode(e.coeff)) out.push(e.rest);
    else if (e.coeff.k === 'int' && e.coeff.v === -1n) out.push(mul(MINUS_ONE, e.rest));
    else out.push(mul(e.coeff, e.rest));
  }
  if (out.length === 0) return ZERO;
  if (out.length === 1) return out[0] as SymNode;
  out.sort(compareNodes);
  const numFirst = out.filter((t) => isNumberNode(t)).concat(out.filter((t) => !isNumberNode(t)));
  return intern({ k: 'add', terms: numFirst });
}

/** True when the base may evaluate to zero (anything but a nonzero number or constant). */
function canVanish(base: SymNode): boolean {
  if (isNumberNode(base)) return isZeroNode(base);
  return !(base.k === 'const' && (base.name === 'pi' || base.name === 'e'));
}

/** True for a negative exponent: a negative number or a product led by one. */
function isReciprocalExp(exp: SymNode): boolean {
  if (isNegativeNumber(exp)) return true;
  if (exp.k === 'mul') {
    const first = exp.factors[0];
    return first !== undefined && isNegativeNumber(first);
  }
  return false;
}

/** Split a factor into base and exponent. */
function splitPow(f: SymNode): { base: SymNode; exp: SymNode } {
  if (f.k === 'pow') return { base: f.base, exp: f.exp };
  return { base: f, exp: ONE };
}

/**
 * Canonical product: flatten, fold numbers, combine equal bases, sort.
 * `0` annihilates unless an `inf` factor is present (then the product stays unfolded).
 */
export function mul(...factors: SymNode[]): SymNode {
  const flat: SymNode[] = [];
  for (const f of factors) {
    if (f.k === 'mul') flat.push(...f.factors);
    else flat.push(f);
  }
  let hasInf = false;
  let hasZero = false;
  for (const f of flat) {
    if (f.k === 'const' && f.name === 'inf') hasInf = true;
    if (isZeroNode(f)) hasZero = true;
  }
  if (hasZero && !hasInf) return ZERO;
  let num: SymNode | null = null;
  const byBase = new Map<number, { base: SymNode; exp: SymNode }>();
  const order: number[] = [];
  const others: SymNode[] = [];
  for (const f of flat) {
    if (isNumberNode(f)) {
      num = num === null ? f : mulNumbers(num, f);
      continue;
    }
    if (f.k === 'const' && f.name === 'inf') {
      others.push(f);
      continue;
    }
    const { base, exp } = splitPow(f);
    // A factor and its reciprocal power are not merged while the base may be zero:
    // `x * x^-1` keeps its denominator so Simplify can record the excluded value x != 0.
    const key = canVanish(base) && isReciprocalExp(exp) ? -base.id : base.id;
    const hit = byBase.get(key);
    if (hit === undefined) {
      byBase.set(key, { base, exp });
      order.push(key);
    } else {
      hit.exp = add(hit.exp, exp);
    }
  }
  if (num !== null && isZeroNode(num) && !hasInf) return ZERO;
  const out: SymNode[] = [];
  const refold: SymNode[] = [];
  for (const id of order) {
    const e = byBase.get(id);
    if (e === undefined) continue;
    const p = pow(e.base, e.exp);
    if (isNumberNode(p) || p.k === 'mul') refold.push(p);
    else out.push(p);
  }
  if (refold.length > 0) {
    return mul(...(num === null ? [] : [num]), ...refold, ...out, ...others);
  }
  if (num !== null && !isOneNode(num)) out.push(num);
  out.push(...others);
  const filtered = out.filter((t) => !isOneNode(t));
  if (filtered.length === 0) return num ?? ONE;
  if (filtered.length === 1) return filtered[0] as SymNode;
  filtered.sort(compareNodes);
  const numFirst = filtered.filter((t) => isNumberNode(t)).concat(filtered.filter((t) => !isNumberNode(t)));
  return intern({ k: 'mul', factors: numFirst });
}

/**
 * Canonical power. Folds number^integer exactly, `(a b)^n` for integer n,
 * `(x^a)^n` for integer n. `0^0` stays unfolded (indeterminate).
 */
export function pow(base: SymNode, exp: SymNode): SymNode {
  if (isZeroNode(exp)) {
    if (isZeroNode(base)) return intern({ k: 'pow', base, exp });
    return ONE;
  }
  if (isOneNode(exp)) return base;
  if (isOneNode(base)) return ONE;
  if (isZeroNode(base)) {
    if (exp.k === 'int') return exp.v > 0n ? ZERO : intern({ k: 'pow', base, exp });
    if (exp.k === 'rat') return exp.n > 0n ? ZERO : intern({ k: 'pow', base, exp });
    if (exp.k === 'float') return exp.v > 0 ? ZERO : intern({ k: 'pow', base, exp });
    if (exp.k === 'dec') return exp.mant > 0n ? ZERO : intern({ k: 'pow', base, exp });
    return intern({ k: 'pow', base, exp });
  }
  if (isNumberNode(base) && exp.k === 'int') {
    const folded = intPowNumber(base, exp.v);
    if (folded !== null) return folded;
  }
  if (base.k === 'mul' && exp.k === 'int') {
    return mul(...base.factors.map((f) => pow(f, exp)));
  }
  if (base.k === 'pow' && exp.k === 'int') {
    return pow(base.base, mul(base.exp, exp));
  }
  return intern({ k: 'pow', base, exp });
}

function isNegativeNumber(n: SymNode): boolean {
  if (n.k === 'int') return n.v < 0n;
  if (n.k === 'rat') return n.n < 0n;
  if (n.k === 'float') return n.v < 0;
  if (n.k === 'dec') return n.mant < 0n;
  return false;
}

/** Exact number^integer with a size guard (100,000 digits). Null when it must stay folded later. */
function intPowNumber(base: SymNode, e: bigint): SymNode | null {
  const neg = e < 0n;
  const ae = neg ? -e : e;
  if (ae > 1000000n) return null;
  if (base.k === 'int') {
    if (ae === 0n) return ONE;
    let r = 1n;
    let b = base.v;
    let k = ae;
    while (k > 0n) {
      if ((k & 1n) === 1n) {
        r *= b;
        if (r.toString().length > 100000) return null;
      }
      k >>= 1n;
      if (k > 0n) b *= b;
    }
    return neg ? ratN(1n, r) : intN(r);
  }
  if (base.k === 'rat') {
    if (ae === 0n) return ONE;
    const nn = intPowNumber(intN(base.n), ae);
    const dd = intPowNumber(intN(base.d), ae);
    if (nn === null || dd === null || nn.k !== 'int' || dd.k !== 'int') return null;
    return neg ? ratN(dd.v, nn.v) : ratN(nn.v, dd.v);
  }
  if (base.k === 'float') return floatN(Math.pow(base.v, Number(e)));
  return null;
}

/** Exact trig values at school angles, as (angle multiple of pi, fn) -> node. */
const EXACT_TRIG = new Map<string, SymNode>();

function exactTrigKey(fn: string, num: bigint, den: bigint): string {
  return `${fn}:${num.toString()}/${den.toString()}`;
}

/**
 * Fold `fn` of exact arguments where the value is known: exact trig at multiples of
 * pi/12, pi/10, pi/8, pi/6, pi/5, pi/4, pi/3, pi/2, plus parity rules. Null when unknown.
 */
function foldFn(name: SymFn, args: readonly SymNode[]): SymNode | null {
  const a0 = args[0];
  if (a0 === undefined) return null;
  if (name === 'abs' && isNumberNode(a0)) {
    if (isNegativeNumber(a0)) return negateNode(a0);
    return a0;
  }
  if (name === 'sign' && isNumberNode(a0)) {
    if (isZeroNode(a0)) return ZERO;
    return isNegativeNumber(a0) ? MINUS_ONE : ONE;
  }
  if ((name === 'floor' || name === 'ceil' || name === 'round') && isNumberNode(a0)) {
    const v = toFloat(a0);
    const r = name === 'floor' ? Math.floor(v) : name === 'ceil' ? Math.ceil(v) : Math.round(v);
    return Number.isSafeInteger(r) ? intN(r) : floatN(r);
  }
  if ((name === 'min' || name === 'max') && args.length >= 2 && args.every(isNumberNode)) {
    let best = args[0] as SymNode;
    for (const a of args.slice(1)) {
      const c = compareNumbers(a, best);
      if ((name === 'min' && c < 0) || (name === 'max' && c > 0)) best = a;
    }
    return best;
  }
  if (name === 'sqrt' && isNumberNode(a0)) {
    const r = sqrtNumber(a0);
    if (r !== null) return r;
  }
  if (name === 'exp' && isZeroNode(a0)) return ONE;
  if (name === 'ln' && isOneNode(a0)) return ZERO;
  if (name === 'ln' && a0.k === 'const' && a0.name === 'e') return ONE;
  if (name === 'sin' && isZeroNode(a0)) return ZERO;
  if (name === 'cos' && isZeroNode(a0)) return ONE;
  if (name === 'tan' && isZeroNode(a0)) return ZERO;
  const trig = foldTrig(name, a0);
  if (trig !== null) return trig;
  const parity = parityRule(name, a0);
  if (parity !== null) return parity;
  return null;
}

function compareNumbers(a: SymNode, b: SymNode): number {
  if (a.k === 'float' || b.k === 'float' || a.k === 'dec' || b.k === 'dec') {
    const d = toFloat(a) - toFloat(b);
    return d < 0 ? -1 : d > 0 ? 1 : 0;
  }
  const an = a.k === 'int' ? a.v : (a as { n: bigint }).n;
  const ad = a.k === 'int' ? 1n : (a as { d: bigint }).d;
  const bn = b.k === 'int' ? b.v : (b as { n: bigint }).n;
  const bd = b.k === 'int' ? 1n : (b as { d: bigint }).d;
  const l = an * bd;
  const r = bn * ad;
  return l < r ? -1 : l > r ? 1 : 0;
}

function sqrtNumber(a: SymNode): SymNode | null {
  if (a.k === 'int' && a.v >= 0n) {
    const r = bigIsqrt(a.v);
    if (r * r === a.v) return intN(r);
    return null;
  }
  if (a.k === 'rat' && a.n >= 0n) {
    const rn = bigIsqrt(a.n);
    const rd = bigIsqrt(a.d);
    if (rn * rn === a.n && rd * rd === a.d) return ratN(rn, rd);
    return null;
  }
  if (a.k === 'float') return a.v < 0 ? null : floatN(Math.sqrt(a.v));
  return null;
}

export function bigIsqrt(v: bigint): bigint {
  if (v < 0n) return 0n;
  if (v < 2n) return v;
  let x = 1n << ((BigInt(v.toString(2).length) + 1n) / 2n);
  for (;;) {
    const y = (x + v / x) / 2n;
    if (y >= x) return x;
    x = y;
  }
}

/** Reduce an angle to a multiple of pi: returns [num, den] with angle = num/den * pi, or null. */
function asPiMultiple(a: SymNode): { n: bigint; d: bigint } | null {
  if (isZeroNode(a)) return { n: 0n, d: 1n };
  if (a.k === 'const' && a.name === 'pi') return { n: 1n, d: 1n };
  if (a.k === 'mul' && a.factors.length === 2) {
    const f0 = a.factors[0] as SymNode;
    const f1 = a.factors[1] as SymNode;
    if (isNumberNode(f0) && f1.k === 'const' && f1.name === 'pi') {
      if (f0.k === 'int') return { n: f0.v, d: 1n };
      if (f0.k === 'rat') return { n: f0.n, d: f0.d };
    }
  }
  return null;
}

function foldTrig(name: SymFn, a: SymNode): SymNode | null {
  if (name !== 'sin' && name !== 'cos' && name !== 'tan') return null;
  const m = asPiMultiple(a);
  if (m === null) return null;
  const key = exactTrigKey(name, ((m.n % (2n * m.d)) + 2n * m.d) % (2n * m.d), m.d);
  const hit = EXACT_TRIG.get(key);
  if (hit !== undefined) return hit;
  const known: SymNode | null = exactTrigValue(name, m.n, m.d);
  if (known === null) return null;
  EXACT_TRIG.set(key, known);
  return known;
}

/** Exact sin/cos/tan of n/d * pi for school denominators. */
function exactTrigValue(name: SymFn, n: bigint, d: bigint): SymNode | null {
  const two = 2n * d;
  const r = ((n % two) + two) % two;
  const s2 = intern({ k: 'pow', base: TWO, exp: HALF });
  const s3 = intern({ k: 'pow', base: intN(3), exp: HALF });
  const half = (v: SymNode): SymNode => mul(HALF, v);
  const neg = (v: SymNode): SymNode => negateNode(v);
  const sinOf = (nn: bigint, dd: bigint): SymNode | null => {
    const key = `${nn.toString()}/${dd.toString()}`;
    switch (key) {
      case '0/1': return ZERO;
      case '1/6': return HALF;
      case '1/4': return half(s2);
      case '1/3': return half(s3);
      case '1/2': return ONE;
      case '2/3': return half(s3);
      case '3/4': return half(s2);
      case '5/6': return HALF;
      case '1/1': return ZERO;
      case '7/6': return neg(HALF);
      case '5/4': return neg(half(s2));
      case '4/3': return neg(half(s3));
      case '3/2': return MINUS_ONE;
      case '5/3': return neg(half(s3));
      case '7/4': return neg(half(s2));
      case '11/6': return neg(HALF);
      default: break;
    }
    if (dd === 12n || dd === 24n) {
      const reduced = reduceTrig12(nn, dd);
      if (reduced !== null) return reduced;
    }
    if (dd === 10n || dd === 5n) {
      const reduced = reduceTrig10(nn, dd);
      if (reduced !== null) return reduced;
    }
    if (dd === 8n || dd === 16n) {
      const s = intern({ k: 'pow', base: add(TWO, s2), exp: HALF });
      const sm = intern({ k: 'pow', base: add(TWO, neg(s2)), exp: HALF });
      const table: Record<string, SymNode> = {
        '1/8': half(sm), '3/8': half(s), '5/8': half(s), '7/8': half(sm),
        '9/8': neg(half(sm)), '11/8': neg(half(s)), '13/8': neg(half(s)), '15/8': neg(half(sm)),
      };
      const hit = table[`${((nn % (2n * dd)) + 2n * dd) % (2n * dd)}/${dd}`];
      return hit ?? null;
    }
    return null;
  };
  if (name === 'sin') return sinOf(r, d);
  if (name === 'cos') return cosViaSin(r, d, sinOf);
  if (name === 'tan') {
    const s = sinOf(r, d);
    const c = cosViaSin(r, d, sinOf);
    if (s === null || c === null || isZeroNode(c)) return null;
    return divideNodes(s, c);
  }
  return null;
}

/** cos(r/d·π) = sin((2r+d)/(2d)·π), reduced before the table lookup. */
function cosViaSin(r: bigint, d: bigint, sinOf: (nn: bigint, dd: bigint) => SymNode | null): SymNode | null {
  const num = r * 2n + d;
  const den = 2n * d;
  const mod = 2n * den;
  const q = ((num % mod) + mod) % mod;
  const g = bigGcd(q < 0n ? -q : q, den);
  return sinOf(q / g, den / g);
}

function reduceTrig12(nn: bigint, dd: bigint): SymNode | null {
  const two = 2n * dd;
  const r = (((nn % two) + two) % two) * 12n / dd;
  const s6 = intern({ k: 'pow', base: intN(6), exp: HALF });
  const s2 = intern({ k: 'pow', base: TWO, exp: HALF });
  const a = mul(ratN(1n, 4n), add(s6, negateNode(s2)));
  const b = mul(ratN(1n, 4n), add(s6, s2));
  const table: Record<string, SymNode> = {
    '1': a, '5': b, '7': b, '11': a,
    '13': negOf(a), '17': negOf(b), '19': negOf(b), '23': negOf(a),
  };
  if (r === 0n || r === 12n) return ZERO;
  if (r === 6n) return ONE;
  if (r === 18n) return MINUS_ONE;
  return table[r.toString()] ?? null;
}

function negOf(v: SymNode): SymNode {
  return negateNode(v);
}

function reduceTrig10(nn: bigint, dd: bigint): SymNode | null {
  const two = 2n * dd;
  const r = (((nn % two) + two) % two) * 10n / dd;
  const s5 = intern({ k: 'pow', base: intN(5), exp: HALF });
  const q = (v: SymNode): SymNode => mul(ratN(1n, 4n), v);
  const t1 = q(add(MINUS_ONE, s5));
  const t3 = q(add(ONE, s5));
  const u2 = intern({ k: 'pow', base: mul(ratN(1n, 16n), add(intN(10), mul(negateNode(TWO), s5))), exp: HALF });
  const u4 = intern({ k: 'pow', base: mul(ratN(1n, 16n), add(intN(10), mul(TWO, s5))), exp: HALF });
  const table: Record<string, SymNode> = {
    '1': t1, '3': t3, '7': t3, '9': t1,
    '11': negOf(t1), '13': negOf(t3), '17': negOf(t3), '19': negOf(t1),
    '2': u2, '4': u4, '6': u4, '8': u2,
    '12': negOf(u2), '14': negOf(u4), '16': negOf(u4), '18': negOf(u2),
  };
  if (r === 0n || r === 10n) return ZERO;
  if (r === 5n) return ONE;
  if (r === 15n) return MINUS_ONE;
  return table[r.toString()] ?? null;
}

function parityRule(name: SymFn, a: SymNode): SymNode | null {
  const neg = isNegated(a);
  if (name === 'sin' || name === 'tan' || name === 'sinh' || name === 'tanh') {
    if (neg !== null) return negateNode(fn(name, neg));
  }
  if (name === 'cos' || name === 'cosh') {
    if (neg !== null) return fn(name, neg);
  }
  return null;
}

function isNegated(a: SymNode): SymNode | null {
  if (a.k === 'mul' && a.factors.length === 2) {
    const f0 = a.factors[0] as SymNode;
    if (f0.k === 'int' && f0.v === -1n) return a.factors[1] as SymNode;
  }
  if (a.k === 'int' && a.v < 0n) return intN(-a.v);
  if (a.k === 'rat' && a.n < 0n) return ratN(-a.n, a.d);
  if (a.k === 'float' && a.v < 0) return floatN(-a.v);
  return null;
}

export function divideNodes(a: SymNode, b: SymNode): SymNode {
  return mul(a, pow(b, MINUS_ONE));
}

/**
 * The product of primes that `Factor(n)` returns for a whole number. It is a display
 * product: the canonical constructors would fold it straight back into `n`, so the node
 * is built directly (`2^2 * 3`). Parsing its text gives the number again.
 */
export function factoredIntegerNode(primes: readonly bigint[], negative: boolean): SymNode {
  const parts: SymNode[] = negative ? [MINUS_ONE] : [];
  let i = 0;
  while (i < primes.length) {
    const p = primes[i] as bigint;
    let k = 0;
    while (i < primes.length && primes[i] === p) {
      k++;
      i++;
    }
    parts.push(k === 1 ? intN(p) : intern({ k: 'pow', base: intN(p), exp: intN(k) }));
  }
  if (parts.length === 1) return parts[0] as SymNode;
  return intern({ k: 'mul', factors: parts });
}

/** Canonical function application with folding. */
export function fn(name: SymFn, ...args: SymNode[]): SymNode {
  const folded = foldFn(name, args);
  if (folded !== null) return folded;
  return intern({ k: 'fn', name, args });
}

export function rootofN(poly: UPoly, index: number, hint: number): SymNode {
  return intern({ k: 'rootof', poly, index, hint });
}

export function listN(items: readonly SymNode[]): SymNode {
  return intern({ k: 'list', items });
}

export function piecewiseN(cases: readonly { readonly when: SymCond; readonly then: SymNode }[], other?: SymNode): SymNode {
  return other === undefined ? intern({ k: 'piecewise', cases }) : intern({ k: 'piecewise', cases, other });
}

/* --------------------------------- conds ------------------------------------ */

export function rel(op: SymRelOp, l: SymNode, r: SymNode): SymCond {
  return { c: 'rel', op, l, r };
}

export function andCond(...of: SymCond[]): SymCond {
  const flat: SymCond[] = [];
  for (const o of of) {
    if (o.c === 'false') return { c: 'false' };
    if (o.c === 'true') continue;
    if (o.c === 'and') flat.push(...o.of);
    else flat.push(o);
  }
  if (flat.length === 0) return { c: 'true' };
  if (flat.length === 1) return flat[0] as SymCond;
  return { c: 'and', of: flat };
}

export function orCond(...of: SymCond[]): SymCond {
  const flat: SymCond[] = [];
  for (const o of of) {
    if (o.c === 'true') return { c: 'true' };
    if (o.c === 'false') continue;
    if (o.c === 'or') flat.push(...o.of);
    else flat.push(o);
  }
  if (flat.length === 0) return { c: 'false' };
  if (flat.length === 1) return flat[0] as SymCond;
  return { c: 'or', of: flat };
}

export function notCond(o: SymCond): SymCond {
  if (o.c === 'true') return { c: 'false' };
  if (o.c === 'false') return { c: 'true' };
  if (o.c === 'not') return o.of;
  if (o.c === 'rel') {
    const flip: Record<SymRelOp, SymRelOp> = { '==': '!=', '!=': '==', '<': '>=', '<=': '>', '>': '<=', '>=': '<' };
    return { c: 'rel', op: flip[o.op], l: o.l, r: o.r };
  }
  return { c: 'not', of: o };
}

/* --------------------------------- queries ----------------------------------- */

export function toFloat(n: SymNode): number {
  switch (n.k) {
    case 'int': return Number(n.v);
    case 'rat': return Number(n.n) / Number(n.d);
    case 'dec': return Number(n.mant) * Math.pow(10, n.exp);
    case 'float': return n.v;
    case 'const':
      if (n.name === 'pi') return Math.PI;
      if (n.name === 'e') return Math.E;
      if (n.name === 'inf') return Infinity;
      return NaN;
    default: return NaN;
  }
}

/** Exact value as [num, den], or null when not an exact rational. */
export function asRational(n: SymNode): { n: bigint; d: bigint } | null {
  if (n.k === 'int') return { n: n.v, d: 1n };
  if (n.k === 'rat') return { n: n.n, d: n.d };
  return null;
}

/** Exact value as bigint, or null when not an integer. */
export function asInteger(n: SymNode): bigint | null {
  if (n.k === 'int') return n.v;
  if (n.k === 'rat' && n.d === 1n) return n.n;
  return null;
}

/** Free symbol names in a tree. */
export function freeSymbols(n: SymNode): Set<string> {
  const out = new Set<string>();
  const seen = new Set<number>();
  const walk = (t: SymNode): void => {
    if (seen.has(t.id)) return;
    seen.add(t.id);
    switch (t.k) {
      case 'sym': out.add(t.name); return;
      case 'add': for (const c of t.terms) walk(c); return;
      case 'mul': for (const c of t.factors) walk(c); return;
      case 'pow': walk(t.base); walk(t.exp); return;
      case 'fn': for (const c of t.args) walk(c); return;
      case 'list': for (const c of t.items) walk(c); return;
      case 'piecewise':
        for (const cs of t.cases) {
          walkCondSyms(cs.when, out, seen);
          walk(cs.then);
        }
        if (t.other !== undefined) walk(t.other);
        return;
      default: return;
    }
  };
  walk(n);
  return out;
}

function walkCondSyms(c: SymCond, out: Set<string>, seen: Set<number>): void {
  const walk = (t: SymNode): void => {
    if (seen.has(t.id)) return;
    seen.add(t.id);
    switch (t.k) {
      case 'sym': out.add(t.name); return;
      case 'add': for (const x of t.terms) walk(x); return;
      case 'mul': for (const x of t.factors) walk(x); return;
      case 'pow': walk(t.base); walk(t.exp); return;
      case 'fn': for (const x of t.args) walk(x); return;
      case 'list': for (const x of t.items) walk(x); return;
      case 'piecewise':
        for (const cs of t.cases) {
          walkCondSyms(cs.when, out, seen);
          walk(cs.then);
        }
        if (t.other !== undefined) walk(t.other);
        return;
      default: return;
    }
  };
  switch (c.c) {
    case 'rel': walk(c.l); walk(c.r); return;
    case 'in': walk(c.l); return;
    case 'not': walkCondSyms(c.of, out, seen); return;
    case 'and':
    case 'or': for (const o of c.of) walkCondSyms(o, out, seen); return;
    default: return;
  }
}

export function freeSymbolsCond(c: SymCond): Set<string> {
  const out = new Set<string>();
  walkCondSyms(c, out, new Set<number>());
  return out;
}

/** Count distinct nodes in a tree. */
export function nodeCount(n: SymNode): number {
  const seen = new Set<number>();
  const stack: SymNode[] = [n];
  while (stack.length > 0) {
    const t = stack.pop() as SymNode;
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    switch (t.k) {
      case 'add': stack.push(...t.terms); break;
      case 'mul': stack.push(...t.factors); break;
      case 'pow': stack.push(t.base, t.exp); break;
      case 'fn': stack.push(...t.args); break;
      case 'list': stack.push(...t.items); break;
      case 'piecewise':
        for (const cs of t.cases) {
          stack.push(cs.then);
          condNodes(cs.when, stack);
        }
        if (t.other !== undefined) stack.push(t.other);
        break;
      default: break;
    }
  }
  return seen.size;
}

function condNodes(c: SymCond, stack: SymNode[]): void {
  switch (c.c) {
    case 'rel': stack.push(c.l, c.r); return;
    case 'in': stack.push(c.l); return;
    case 'not': condNodes(c.of, stack); return;
    case 'and':
    case 'or': for (const o of c.of) condNodes(o, stack); return;
    default: return;
  }
}

/** True when the tree holds any inexact number (float or decimal). */
export function hasInexact(n: SymNode): boolean {
  const seen = new Set<number>();
  const stack: SymNode[] = [n];
  while (stack.length > 0) {
    const t = stack.pop() as SymNode;
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    if (t.k === 'float' || t.k === 'dec') return true;
    switch (t.k) {
      case 'add': stack.push(...t.terms); break;
      case 'mul': stack.push(...t.factors); break;
      case 'pow': stack.push(t.base, t.exp); break;
      case 'fn': stack.push(...t.args); break;
      case 'list': stack.push(...t.items); break;
      case 'piecewise':
        for (const cs of t.cases) {
          stack.push(cs.then);
          condNodes(cs.when, stack);
        }
        if (t.other !== undefined) stack.push(t.other);
        break;
      default: break;
    }
  }
  return false;
}

/** Map every node bottom-up; `f` sees rebuilt children. Shared nodes map once. */
export function mapNodes(n: SymNode, f: (t: SymNode) => SymNode): SymNode {
  const memo = new Map<number, SymNode>();
  const go = (t: SymNode): SymNode => {
    const hit = memo.get(t.id);
    if (hit !== undefined) return hit;
    let rebuilt = t;
    switch (t.k) {
      case 'add': {
        const terms = t.terms.map(go);
        rebuilt = terms.every((x, i) => x === t.terms[i]) ? t : add(...terms);
        break;
      }
      case 'mul': {
        const factors = t.factors.map(go);
        rebuilt = factors.every((x, i) => x === t.factors[i]) ? t : mul(...factors);
        break;
      }
      case 'pow': {
        const b = go(t.base);
        const e = go(t.exp);
        rebuilt = b === t.base && e === t.exp ? t : pow(b, e);
        break;
      }
      case 'fn': {
        const args = t.args.map(go);
        rebuilt = args.every((x, i) => x === t.args[i]) ? t : intern({ k: 'fn', name: t.name, args });
        break;
      }
      case 'list': {
        const items = t.items.map(go);
        rebuilt = items.every((x, i) => x === t.items[i]) ? t : listN(items);
        break;
      }
      case 'piecewise': {
        const cases = t.cases.map((cs) => ({ when: mapCondNodes(cs.when, go), then: go(cs.then) }));
        const other = t.other === undefined ? undefined : go(t.other);
        rebuilt = intern({ k: 'piecewise', cases, ...(other === undefined ? {} : { other }) });
        break;
      }
      default: break;
    }
    const out = f(rebuilt);
    memo.set(t.id, out);
    return out;
  };
  return go(n);
}

export function mapCondNodes(c: SymCond, f: (t: SymNode) => SymNode): SymCond {
  switch (c.c) {
    case 'rel': return { c: 'rel', op: c.op, l: mapNodes(c.l, f), r: mapNodes(c.r, f) };
    case 'in': return { c: 'in', l: mapNodes(c.l, f), set: c.set };
    case 'not': return { c: 'not', of: mapCondNodes(c.of, f) };
    case 'and': return { c: 'and', of: c.of.map((o) => mapCondNodes(o, f)) };
    case 'or': return { c: 'or', of: c.of.map((o) => mapCondNodes(o, f)) };
    default: return c;
  }
}
