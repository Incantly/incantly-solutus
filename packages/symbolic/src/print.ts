/**
 * Printers (cas/design.md 5.11): plain text, LaTeX and speech, all from the tree, never
 * from each other. Plain text is re-enterable as a line, so products print with `*`
 * (language/rulings.md Q-R4-1 docs round, item 3). Equations print `==` in text (the input
 * syntax); the display form prints `=` for the CAS view.
 */
import type { SymCond, SymNode } from './node';
import { asInteger, isNumberNode, isOneNode, isZeroNode, negateNode, pow, symN, toFloat } from './node';
import { ONE, ZERO, intN } from './node';
import { upolyToTree } from './poly';

/* ---------------------------------- text ------------------------------------ */

export interface TextOptions {
  /** Display form for the CAS view: `=` instead of `==`. Still prints `*`. */
  readonly display?: boolean;
  /** Show a mixed number as `2 3/4` (from `MixedNumber`). */
  readonly mixed?: boolean;
}

const PREC_ADD = 1;
const PREC_MUL = 2;
const PREC_POW = 3;
const PREC_UNARY = 4;
const PREC_ATOM = 5;

function precedence(n: SymNode): number {
  switch (n.k) {
    case 'add': return PREC_ADD;
    case 'mul': case 'rat': return PREC_MUL;
    case 'pow': return PREC_POW;
    case 'fn': case 'list': return PREC_ATOM;
    default: break;
  }
  if (isNegative(n)) return PREC_UNARY;
  return PREC_ATOM;
}

function isNegative(n: SymNode): boolean {
  if (n.k === 'int') return n.v < 0n;
  if (n.k === 'rat') return n.n < 0n;
  if (n.k === 'float') return n.v < 0;
  if (n.k === 'dec') return n.mant < 0n;
  if (n.k === 'mul' && n.factors.length > 0) return isNegative(n.factors[0] as SymNode);
  return false;
}

function negateText(n: SymNode, o: TextOptions): string {
  if (n.k === 'int') return (-n.v).toString();
  if (n.k === 'rat') return ratText(-n.n, n.d, o);
  if (n.k === 'float') return String(-n.v);
  if (n.k === 'dec') return decText(-n.mant, n.exp);
  return textOf(negateNode(n), o, PREC_MUL);
}

/** Presentation order of sum terms: highest degree first, plain numbers last. */
function termRank(t: SymNode): number {
  if (isNumberNode(t)) return -1;
  if (t.k === 'sym') return 1;
  if (t.k === 'pow') {
    const e = asInteger(t.exp);
    return e !== null && e > 0n && t.base.k === 'sym' ? Number(e) : 0;
  }
  if (t.k === 'mul') {
    let r = 0;
    for (const f of t.factors) {
      if (isNumberNode(f)) continue;
      // An integer family parameter (k1, k2, ...) orders after the base value: pi/6 + 2*pi*k1.
      if (f.k === 'sym' && /^k\d+$/.test(f.name)) r -= 0.5;
      else r += Math.max(termRank(f), 0);
    }
    return r;
  }
  return 0;
}

function displayTerms(terms: readonly SymNode[]): SymNode[] {
  return terms
    .map((t, i) => ({ t, i, r: termRank(t) }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .map((x) => x.t);
}

/** Presentation order of product factors: numbers, then atoms, then sums by their text. */
function displayFactors(factors: readonly SymNode[]): SymNode[] {
  const head = factors.filter((f) => f.k !== 'add');
  const sums = factors
    .filter((f) => f.k === 'add')
    .map((f) => ({ f, s: textOf(f, {}, 0).replace(/[+-]/g, (c) => (c === '-' ? '+' : '-')) }))
    .sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0))
    .map((x) => x.f);
  return [...head, ...sums];
}

function ratText(n: bigint, d: bigint, o: TextOptions): string {
  if (o.mixed && (n < 0n ? -n : n) > d) {
    const neg = n < 0n;
    const a = neg ? -n : n;
    const whole = a / d;
    const rem = a % d;
    if (rem === 0n) return (neg ? '-' : '') + whole.toString();
    return `${neg ? '-' : ''}${whole.toString()} ${rem.toString()}/${d.toString()}`;
  }
  if (n < 0n) return `-${(-n).toString()}/${d.toString()}`;
  return `${n.toString()}/${d.toString()}`;
}

function decText(mant: bigint, exp: number): string {
  const neg = mant < 0n;
  const digits = (neg ? -mant : mant).toString();
  if (exp >= 0) return (neg ? '-' : '') + digits + '0'.repeat(exp);
  const point = digits.length + exp;
  if (point > 0) return (neg ? '-' : '') + digits.slice(0, point) + '.' + digits.slice(point);
  return (neg ? '-' : '') + '0.' + '0'.repeat(-point) + digits;
}

/** Split a product into numerator and denominator factors (negative powers go down). */
function splitDiv(all: readonly SymNode[]): { num: SymNode[]; den: SymNode[] } {
  const num: SymNode[] = [];
  const den: SymNode[] = [];
  const factors = displayFactors(all);
  for (const f of factors) {
    if (f.k === 'rat') {
      if (f.n !== 1n) num.push(intN(f.n));
      den.push(intN(f.d));
      continue;
    }
    if (f.k === 'pow') {
      const e = asInteger(f.exp);
      if (e !== null && e < 0n && !isZeroNode(f.base)) {
        den.push(e === -1n ? f.base : pow(f.base, intN(-e)));
        continue;
      }
    }
    num.push(f);
  }
  return { num, den };
}

function needsParensAsBase(b: SymNode): boolean {
  if (b.k === 'pow') return true;
  if (isNegative(b) && (b.k === 'int' || b.k === 'rat' || b.k === 'float' || b.k === 'dec')) return true;
  return precedence(b) < PREC_POW;
}

function needsParensAsExp(e: SymNode): boolean {
  if (e.k === 'int' || e.k === 'sym' || e.k === 'const' || e.k === 'fn') return false;
  return true;
}

export function toText(n: SymNode, o: TextOptions = {}, parentPrec = 0): string {
  return textOf(n, o, parentPrec);
}

function textOf(n: SymNode, o: TextOptions, parentPrec: number): string {
  const wrap = (s: string, prec: number): string => (prec < parentPrec ? `(${s})` : s);
  switch (n.k) {
    case 'int': return wrap(n.v.toString(), n.v < 0n ? PREC_UNARY : PREC_ATOM);
    case 'rat': return wrap(ratText(n.n, n.d, o), PREC_MUL);
    case 'dec': return wrap(decText(n.mant, n.exp), n.mant < 0n ? PREC_UNARY : PREC_ATOM);
    case 'float': return wrap(String(n.v), n.v < 0 ? PREC_UNARY : PREC_ATOM);
    case 'const':
      if (n.name === 'pi') return 'pi';
      if (n.name === 'e') return 'e';
      if (n.name === 'i') return 'i';
      return 'inf';
    case 'sym': return n.name;
    case 'ref': return `ref(${n.obj})`;
    case 'add': {
      let s = '';
      displayTerms(n.terms).forEach((t, i) => {
        if (i === 0) {
          s += textOf(t, o, 0);
          return;
        }
        if (isNegative(t)) s += ` - ${negateText(t, o)}`;
        else s += ` + ${textOf(t, o, PREC_ADD)}`;
      });
      return wrap(s, PREC_ADD);
    }
    case 'mul': {
      const { num, den } = splitDiv(n.factors);
      let sign = '';
      let nums = num;
      const first = num[0] as SymNode | undefined;
      if (first !== undefined && first.k === 'int' && first.v === -1n) {
        sign = '-';
        nums = num.slice(1);
      }
      const numStr = nums.length === 0 ? '1' : nums.map((f) => textOf(f, o, PREC_MUL)).join(' * ');
      if (den.length === 0) return wrap(`${sign}${numStr}`, sign === '' ? PREC_MUL : PREC_UNARY);
      // A plain whole-number denominator (a rational coefficient) prints tight: `pi/6`.
      // A single plain token as the denominator (a number, a symbol, a constant) prints tight too.
      const only = den.length === 1 ? (den[0] as SymNode) : null;
      if (only !== null && nums.length > 0 && ((only.k === 'int' && only.v > 0n) || only.k === 'sym' || only.k === 'const')) {
        return wrap(`${sign}${numStr}/${textOf(only, o, PREC_ATOM)}`, sign === '' ? PREC_MUL : PREC_UNARY);
      }
      const denStr = den.map((f) => textOf(f, o, PREC_MUL + 1)).join(' * ');
      const dd = den.length > 1 ? `(${denStr})` : denStr;
      if (nums.length === 0) return wrap(`${sign}1 / ${dd}`, PREC_MUL);
      return wrap(`${sign}${numStr} / ${dd}`, PREC_MUL);
    }
    case 'pow': {
      if (n.base.k === 'const' && n.base.name === 'e') return wrap(`exp(${textOf(n.exp, o, 0)})`, PREC_ATOM);
      if (n.exp.k === 'rat' && n.exp.n === 1n && n.exp.d === 2n) {
        return wrap(`sqrt(${textOf(n.base, o, 0)})`, PREC_ATOM);
      }
      const b = needsParensAsBase(n.base) ? `(${textOf(n.base, o, 0)})` : textOf(n.base, o, PREC_POW);
      const e = needsParensAsExp(n.exp) ? `(${textOf(n.exp, o, 0)})` : textOf(n.exp, o, PREC_POW);
      return wrap(`${b}^${e}`, PREC_POW);
    }
    case 'fn': {
      const args = n.args.map((a) => textOf(a, o, 0)).join(', ');
      return `${n.name}(${args})`;
    }
    case 'rootof': {
      // The CAS view shows the decimal; the exact form is the hover (design 5.4).
      if (o.display === true) return wrap(String(Number(n.hint.toPrecision(5))), PREC_ATOM);
      const polyText = textOf(upolyToTree(n.poly, symN('x')), o, 0);
      return wrap(`rootof(${polyText}, ${n.index})`, PREC_ATOM);
    }
    case 'list': return `[${n.items.map((i) => textOf(i, o, 0)).join(', ')}]`;
    case 'piecewise': {
      const parts: string[] = [];
      for (const cs of n.cases) {
        parts.push(condText(cs.when, o));
        parts.push(textOf(cs.then, o, 0));
      }
      if (n.other !== undefined) parts.push(textOf(n.other, o, 0));
      return `if(${parts.join(', ')})`;
    }
  }
}

export function condText(c: SymCond, o: TextOptions = {}): string {
  // A bounded interval prints as a chain, `a < v < b`; the parser reads the chain back.
  const chain = intervalChain(c, o);
  if (chain !== null) return chain;
  const eq = (op: string): string => (o.display === true && op === '==' ? '=' : op);
  switch (c.c) {
    case 'true': return 'true';
    case 'false': return 'false';
    case 'rel':
      if (o.display === true && c.op === '==' && (c.r.k === 'rootof' || c.l.k === 'rootof')) {
        return `${toText(c.l, o, 0)} ≈ ${toText(c.r, o, 0)}`;
      }
      return `${toText(c.l, o, 0)} ${eq(c.op)} ${toText(c.r, o, 0)}`;
    case 'in': return `${toText(c.l, o, 0)} in ${c.set}`;
    // Brackets keep the shape through a parse: `or` binds looser than `and`,
    // and `not` takes one condition (SYM-SM-19).
    case 'not': return c.of.c === 'and' || c.of.c === 'or' ? `not (${condText(c.of, o)})` : `not ${condText(c.of, o)}`;
    case 'and': return c.of.map((x) => (x.c === 'or' ? `(${condText(x, o)})` : condText(x, o))).join(' and ');
    case 'or': return c.of.map((x) => condText(x, o)).join(' or ');
  }
}

/** Display form of an interval piece `a < v and v < b` as `a < v < b`. */
function intervalChain(c: SymCond, o: TextOptions): string | null {
  if (c.c !== 'and' || c.of.length !== 2) return null;
  const l = c.of[0] as SymCond;
  const r = c.of[1] as SymCond;
  if (l.c !== 'rel' || r.c !== 'rel') return null;
  if ((l.op !== '<' && l.op !== '<=') || (r.op !== '<' && r.op !== '<=')) return null;
  if (l.r.k !== 'sym' || r.l.k !== 'sym' || l.r.name !== r.l.name) return null;
  return `${toText(l.l, o, 0)} ${l.op} ${l.r.name} ${r.op} ${toText(r.r, o, 0)}`;
}

/* ---------------------------------- LaTeX ----------------------------------- */

function latexOf(n: SymNode): string {
  switch (n.k) {
    case 'int': return n.v.toString();
    case 'rat': return `\\frac{${n.n.toString()}}{${n.d.toString()}}`;
    case 'dec': return decText(n.mant, n.exp);
    case 'float': return String(n.v);
    case 'const':
      if (n.name === 'pi') return '\\pi ';
      if (n.name === 'e') return 'e';
      if (n.name === 'i') return 'i';
      return '\\infty ';
    case 'sym': return latexName(n.name);
    case 'ref': return `\\mathrm{ref}_{${n.obj}}`;
    case 'add': {
      let s = '';
      displayTerms(n.terms).forEach((t, i) => {
        if (i === 0) {
          s += latexOf(t);
          return;
        }
        if (isNegative(t)) s += ` - ${latexNeg(t)}`;
        else s += ` + ${latexOf(t)}`;
      });
      return s;
    }
    case 'mul': {
      const { num, den } = splitDiv(n.factors);
      const numStr = num.length === 0 ? '1' : num.map(latexFactor).join(' \\cdot ');
      if (den.length === 0) return numStr;
      const denStr = den.map(latexFactor).join(' \\cdot ');
      return `\\frac{${numStr}}{${denStr}}`;
    }
    case 'pow': {
      if (n.base.k === 'const' && n.base.name === 'e') return `\\exp\\left(${latexOf(n.exp)}\\right)`;
      if (n.exp.k === 'rat' && n.exp.n === 1n && n.exp.d === 2n) return `\\sqrt{${latexOf(n.base)}}`;
      return `{${latexBase(n.base)}}^{${latexOf(n.exp)}}`;
    }
    case 'fn': return latexFn(n.name, n.args.map(latexOf));
    case 'rootof': return `\\mathrm{root}_{${n.index}}`;
    case 'list': return `\\left[${n.items.map(latexOf).join(', ')}\\right]`;
    case 'piecewise': return '\\mathrm{if}';
  }
}

const LATEX_GREEK = new Map<string, string>([
  ['theta', '\\theta '], ['omega', '\\omega '], ['alpha', '\\alpha '], ['beta', '\\beta '], ['gamma', '\\gamma '],
  ['delta', '\\delta '], ['lambda', '\\lambda '], ['mu', '\\mu '], ['phi', '\\phi '], ['psi', '\\psi '],
]);

/** A symbol name in LaTeX. A `Map` answers only its own keys (SYM-SM-5). */
function latexName(name: string): string {
  return LATEX_GREEK.get(name) ?? name;
}

/** Functions that are LaTeX operators under their own name. */
const LATEX_OPERATORS = new Set(['sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh', 'ln', 'min', 'max', 'exp', 'log', 'gcd']);
const LATEX_RENAMED = new Map<string, string>([
  ['asin', '\\arcsin'], ['acos', '\\arccos'], ['atan', '\\arctan'],
  ['log10', '\\log_{10}'], ['log2', '\\log_{2}'],
]);

/**
 * A function call in LaTeX. Only real LaTeX commands are used; any other name
 * goes through `\operatorname` so the typesetter never meets an undefined
 * control sequence (SYM-SM-20).
 */
function latexFn(name: string, args: readonly string[]): string {
  const one = args[0] ?? '';
  const list = args.join(', ');
  if (name === 'abs' && args.length === 1) return `\\left|${one}\\right|`;
  if (name === 'floor' && args.length === 1) return `\\left\\lfloor ${one}\\right\\rfloor`;
  if (name === 'ceil' && args.length === 1) return `\\left\\lceil ${one}\\right\\rceil`;
  if (name === 'cbrt' && args.length === 1) return `\\sqrt[3]{${one}}`;
  if (name === 'sqrt' && args.length === 1) return `\\sqrt{${one}}`;
  const renamed = LATEX_RENAMED.get(name);
  if (renamed !== undefined) return `${renamed}\\left(${list}\\right)`;
  if (LATEX_OPERATORS.has(name)) return `\\${name}\\left(${list}\\right)`;
  const safe = name.replace(/[^A-Za-z0-9]/g, '');
  return `\\operatorname{${safe}}\\left(${list}\\right)`;
}

function latexFactor(f: SymNode): string {
  if (f.k === 'add') return `\\left(${latexOf(f)}\\right)`;
  return latexOf(f);
}

function latexBase(b: SymNode): string {
  if (b.k === 'add' || b.k === 'mul' || b.k === 'pow') return `\\left(${latexOf(b)}\\right)`;
  return latexOf(b);
}

function latexNeg(t: SymNode): string {
  if (t.k === 'int') return (-t.v).toString();
  if (t.k === 'rat') return `\\frac{${(-t.n).toString()}}{${t.d.toString()}}`;
  if (t.k === 'float') return String(-t.v);
  return latexOf(negateNode(t));
}

export function toLatex(n: SymNode): string {
  return latexOf(n);
}

export function condLatex(c: SymCond): string {
  switch (c.c) {
    case 'true': return '\\mathrm{true}';
    case 'false': return '\\mathrm{false}';
    case 'rel': {
      const op = c.op === '==' ? '=' : c.op === '!=' ? '\\ne ' : c.op === '<=' ? '\\le ' : c.op === '>=' ? '\\ge ' : c.op;
      return `${latexOf(c.l)} ${op} ${latexOf(c.r)}`;
    }
    case 'in': return `${latexOf(c.l)} \\in \\mathbb{${c.set}}`;
    case 'not': return c.of.c === 'and' || c.of.c === 'or' ? `\\lnot \\left(${condLatex(c.of)}\\right)` : `\\lnot ${condLatex(c.of)}`;
    case 'and': return c.of.map((x) => (x.c === 'or' ? `\\left(${condLatex(x)}\\right)` : condLatex(x))).join(' \\land ');
    case 'or': return c.of.map(condLatex).join(' \\lor ');
  }
}

/* ---------------------------------- speech ----------------------------------- */

const SMALL_NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

/** Conditions spell small numbers out; expression readings keep digits ("5 x"). */
let speechWords = false;

function speechInt(v: bigint): string {
  if (v < 0n) return `minus ${speechInt(-v)}`;
  if (speechWords && v <= 20n) return SMALL_NUMBERS[Number(v)] as string;
  return v.toString();
}

function speechPower(e: SymNode): string {
  if (e.k === 'int') {
    if (e.v === 2n) return 'squared';
    if (e.v === 3n) return 'cubed';
    return `to the power ${speechInt(e.v)}`;
  }
  return `to the power ${speechOf(e)}`;
}

function speechOf(n: SymNode): string {
  switch (n.k) {
    case 'int': return speechInt(n.v);
    case 'rat': return `${speechInt(n.n)} over ${speechInt(n.d)}`;
    case 'dec': return decText(n.mant, n.exp);
    case 'float': return String(n.v);
    case 'const':
      if (n.name === 'pi') return 'pi';
      if (n.name === 'e') return 'e';
      if (n.name === 'i') return 'i';
      return 'infinity';
    case 'sym': return n.name;
    case 'ref': return 'a value';
    case 'add': {
      let s = '';
      displayTerms(n.terms).forEach((t, i) => {
        if (i === 0) {
          s += speechOf(t);
          return;
        }
        if (isNegative(t)) s += ` minus ${speechNeg(t)}`;
        else s += ` plus ${speechOf(t)}`;
      });
      return s;
    }
    case 'mul': {
      const { num, den } = splitDiv(n.factors);
      let numStr = 'one';
      if (num.length > 0) {
        numStr = speechFactor(num[0] as SymNode);
        for (let i = 1; i < num.length; i++) {
          const prev = num[i - 1] as SymNode;
          const cur = num[i] as SymNode;
          const glue = isNumberNode(prev) && (cur.k === 'sym' || cur.k === 'const' || (cur.k === 'pow' && cur.base.k === 'sym')) ? ' ' : ' times ';
          numStr += glue + speechFactor(cur);
        }
      }
      if (den.length === 0) return numStr;
      return `${numStr} over ${den.map(speechFactor).join(' times ')}`;
    }
    case 'pow': {
      if (n.base.k === 'const' && n.base.name === 'e') return `e to the power ${speechGroup(n.exp)}`;
      if (n.exp.k === 'rat' && n.exp.n === 1n && n.exp.d === 2n) return `the square root of ${speechGroup(n.base)}`;
      return `${speechGroup(n.base)} ${speechPower(n.exp)}`;
    }
    case 'fn': return `${n.name} of ${speechGroup(n.args[0] ?? ZERO)}`;
    case 'rootof': return `a root, about ${n.hint}`;
    case 'list': return n.items.map(speechOf).join(', ');
    case 'piecewise': return 'a piecewise expression';
  }
}

function speechFactor(f: SymNode): string {
  if (f.k === 'add') return `the quantity ${speechOf(f)}`;
  return speechOf(f);
}

function speechGroup(g: SymNode): string {
  if (g.k === 'add' || g.k === 'mul') return `the quantity ${speechOf(g)}`;
  return speechOf(g);
}

function speechNeg(t: SymNode): string {
  if (t.k === 'int') return speechInt(-t.v);
  if (t.k === 'rat') return speechInt(-t.n) + ` over ${speechInt(t.d)}`;
  return speechOf(negateNode(t));
}

/**
 * Plain-English reading for screen readers and the teacher. Long expressions (over 30
 * tokens) are shortened: "a long expression with N terms, starting …".
 */
export function toSpeech(n: SymNode): string {
  const full = speechWith(false, () => speechOf(n));
  const tokens = full.split(' ');
  if (tokens.length <= 30) return full;
  const terms = n.k === 'add' ? n.terms.length : n.k === 'mul' ? n.factors.length : 1;
  return `a long expression with ${terms} terms, starting ${tokens.slice(0, 12).join(' ')}`;
}

function speechWith<T>(words: boolean, f: () => T): T {
  const before = speechWords;
  speechWords = words;
  try {
    return f();
  } finally {
    speechWords = before;
  }
}

export function condSpeech(c: SymCond): string {
  return speechWith(true, () => condSpeechOf(c));
}

function condSpeechOf(c: SymCond): string {
  switch (c.c) {
    case 'true': return 'true';
    case 'false': return 'false';
    case 'rel': {
      const op = c.op === '==' ? 'equals' : c.op === '!=' ? 'is not' : c.op === '<' ? 'is less than' : c.op === '<=' ? 'is at most' : c.op === '>' ? 'is greater than' : 'is at least';
      return `${speechOf(c.l)} ${op} ${speechOf(c.r)}`;
    }
    case 'in': return `${speechOf(c.l)} in ${c.set}`;
    case 'not': return c.of.c === 'and' || c.of.c === 'or' ? `not both of: ${condSpeechOf(c.of)}` : `not ${condSpeechOf(c.of)}`;
    case 'and': return c.of.map((x) => (x.c === 'or' ? `either ${condSpeechOf(x)}` : condSpeechOf(x))).join(' and ');
    case 'or': return c.of.map(condSpeechOf).join(' or ');
  }
}

/* ------------------------------ small helpers -------------------------------- */

export function isExactTree(n: SymNode): boolean {
  switch (n.k) {
    case 'float': case 'dec': return false;
    case 'add': return n.terms.every(isExactTree);
    case 'mul': return n.factors.every(isExactTree);
    case 'pow': return isExactTree(n.base) && isExactTree(n.exp);
    case 'fn': return n.args.every(isExactTree);
    case 'list': return n.items.every(isExactTree);
    case 'piecewise': return n.cases.every((cs) => isExactTree(cs.then)) && (n.other === undefined || isExactTree(n.other));
    default: return true;
  }
}

export function approxOf(n: SymNode): number {
  return toFloat(n);
}

export function nodeSummary(n: SymNode, maxChars = 120): string {
  const s = toText(n);
  if (s.length <= maxChars) return s;
  const terms = n.k === 'add' ? n.terms.length : n.k === 'mul' ? n.factors.length : 0;
  return `${s.slice(0, maxChars)}… (${terms} terms)`;
}

export function isOneOrMinusOne(n: SymNode): boolean {
  return isOneNode(n) || (n.k === 'int' && n.v === -1n);
}

export function oneNode(): SymNode {
  return ONE;
}
