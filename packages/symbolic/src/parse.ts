/**
 * A small expression parser for our syntax subset: numbers, names, operators, calls,
 * comparisons, `and`/`or`/`not`, `if`, lists, `rootof`, `ref`. Used by the public
 * `parseExpr`/`parseCond` entries, the bench round-trip, and tests. It accepts everything
 * `toText` prints (the round-trip property), including the display-only chained form
 * `a < v < b`, which becomes `a < v and v < b`.
 */
import type { SymCond, SymFn, SymNode, SymRelOp } from './node';
import { add, andCond, constN, divideNodes, floatN, fn, intN, listN, mul, negateNode, notCond, orCond, piecewiseN, pow, ratN, refN, rel, rootofN, symN } from './node';
import { shortestDecimalRational } from './num';
import { treeToUPoly, upolyIsolate } from './poly';

export class ParseFailure extends Error {
  readonly col: number;
  readonly endCol: number;
  readonly token: string;
  /** True when a size limit (not syntax) stopped the parse. */
  readonly limit: boolean;
  constructor(message: string, col: number, endCol: number, token: string, limit = false) {
    super(message);
    this.name = 'ParseFailure';
    this.col = col;
    this.endCol = endCol;
    this.token = token;
    this.limit = limit;
  }
}

type Tok =
  | { k: 'num'; text: string; col: number }
  | { k: 'name'; text: string; col: number }
  | { k: 'op'; text: string; col: number }
  | { k: 'lparen' | 'rparen' | 'lbracket' | 'rbracket' | 'comma'; col: number }
  | { k: 'deg'; col: number }
  | { k: 'end'; col: number };

const FN_NAMES = new Set<string>([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh',
  'asinh', 'acosh', 'atanh', 'ln', 'log10', 'log2', 'abs', 'sign', 'floor',
  'ceil', 'round', 'min', 'max', 'cbrt',
]);

function lex(text: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const pushOp = (t: string): void => {
    toks.push({ k: 'op', text: t, col: i + 1 });
    i += t.length;
  };
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      i++;
      continue;
    }
    if (ch === '°') {
      toks.push({ k: 'deg', col: i + 1 });
      i++;
      continue;
    }
    if (ch >= '0' && ch <= '9' || (ch === '.' && i + 1 < text.length && (text[i + 1] as string) >= '0' && (text[i + 1] as string) <= '9')) {
      const start = i;
      while (i < text.length && (((text[i] as string) >= '0' && (text[i] as string) <= '9') || (text[i] as string) === '.')) i++;
      if (i < text.length && ((text[i] as string) === 'e' || (text[i] as string) === 'E')) {
        let j = i + 1;
        if (j < text.length && ((text[j] as string) === '+' || (text[j] as string) === '-')) j++;
        if (j < text.length && (text[j] as string) >= '0' && (text[j] as string) <= '9') {
          while (j < text.length && (text[j] as string) >= '0' && (text[j] as string) <= '9') j++;
          i = j;
        }
      }
      toks.push({ k: 'num', text: text.slice(start, i), col: start + 1 });
      continue;
    }
    if (/[A-Za-z_θωαβγδλμφψ]/.test(ch)) {
      const start = i;
      while (i < text.length && /[A-Za-z0-9_θωαβγδλμφψ]/.test(text[i] as string)) i++;
      toks.push({ k: 'name', text: text.slice(start, i), col: start + 1 });
      continue;
    }
    if (ch === '(') {
      toks.push({ k: 'lparen', col: i + 1 });
      i++;
      continue;
    }
    if (ch === ')') {
      toks.push({ k: 'rparen', col: i + 1 });
      i++;
      continue;
    }
    if (ch === '[') {
      toks.push({ k: 'lbracket', col: i + 1 });
      i++;
      continue;
    }
    if (ch === ']') {
      toks.push({ k: 'rbracket', col: i + 1 });
      i++;
      continue;
    }
    if (ch === ',') {
      toks.push({ k: 'comma', col: i + 1 });
      i++;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (two === '==' || two === '!=' || two === '<=' || two === '>=') {
      pushOp(two);
      continue;
    }
    if ('+-*/^<>=!'.includes(ch)) {
      if (ch === '=') throw new ParseFailure('Expected == for equality', i + 1, i + 2, '=');
      if (ch === '!') throw new ParseFailure('Unexpected !', i + 1, i + 2, '!');
      pushOp(ch);
      continue;
    }
    throw new ParseFailure(`Unexpected ${ch}`, i + 1, i + 2, ch);
  }
  toks.push({ k: 'end', col: text.length + 1 });
  return toks;
}

class Parser {
  private pos = 0;
  private depth = 0;
  constructor(private readonly toks: Tok[]) {}

  peek(): Tok {
    return this.toks[this.pos] as Tok;
  }

  next(): Tok {
    const t = this.toks[this.pos] as Tok;
    this.pos++;
    return t;
  }

  fail(message: string, t: Tok): never {
    const col = t.col;
    const token = t.k === 'num' || t.k === 'name' || t.k === 'op' ? t.text : '';
    throw new ParseFailure(message, col, col + Math.max(1, token.length), token);
  }

  parseTop(): { expr: SymNode } | { cond: SymCond } {
    if (this.isCondStart()) {
      const c = this.parseOr();
      this.expectEnd();
      return { cond: c };
    }
    const e = this.parseExpr();
    const inCond = this.tryInCond(e);
    if (inCond !== null) {
      this.expectEnd();
      return { cond: inCond };
    }
    const t = this.peek();
    if (t.k === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(t.text)) {
      const ops: SymRelOp[] = [];
      const operands: SymNode[] = [e];
      while (this.peek().k === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes((this.peek() as { text: string }).text)) {
        const op = this.next() as { text: string };
        ops.push(op.text as SymRelOp);
        operands.push(this.parseExpr());
      }
      this.expectEnd();
      if (ops.length === 1) return { cond: rel(ops[0] as SymRelOp, operands[0] as SymNode, operands[1] as SymNode) };
      const parts: SymCond[] = [];
      for (let i = 0; i < ops.length; i++) {
        parts.push(rel(ops[i] as SymRelOp, operands[i] as SymNode, operands[i + 1] as SymNode));
      }
      return { cond: andCond(...parts) };
    }
    this.expectEnd();
    return { expr: e };
  }

  private isCondStart(): boolean {
    const t = this.peek();
    return t.k === 'name' && (t.text === 'not' || t.text === 'true' || t.text === 'false');
  }

  /** `expr in R|C|Z|N|Q` (set membership). Null when the next token is not `in`. */
  private tryInCond(e: SymNode): SymCond | null {
    const t = this.peek();
    if (t.k !== 'name' || t.text !== 'in') return null;
    this.next();
    const s = this.next();
    if (s.k !== 'name' || !['R', 'C', 'Z', 'N', 'Q'].includes(s.text)) this.fail('Expected a set R, C, Z, N or Q', s);
    return { c: 'in', l: e, set: (s as { text: string }).text as 'R' | 'C' | 'Z' | 'N' | 'Q' };
  }

  private expectEnd(): void {
    const t = this.peek();
    if (t.k !== 'end') this.fail('Unexpected text', t);
  }

  parseOr(): SymCond {
    let l = this.parseAnd();
    for (;;) {
      const t = this.peek();
      if (t.k === 'name' && t.text === 'or') {
        this.next();
        l = orCond(l, this.parseAnd());
      } else return l;
    }
  }

  parseAnd(): SymCond {
    let l = this.parseNot();
    for (;;) {
      const t = this.peek();
      if (t.k === 'name' && t.text === 'and') {
        this.next();
        l = andCond(l, this.parseNot());
      } else return l;
    }
  }

  parseNot(): SymCond {
    const t = this.peek();
    if (t.k === 'name' && t.text === 'not') {
      this.next();
      return notCond(this.parseNot());
    }
    if (t.k === 'name' && (t.text === 'true' || t.text === 'false')) {
      this.next();
      return { c: t.text };
    }
    if (t.k === 'lparen') {
      const save = this.pos;
      this.next();
      try {
        const inner = this.parseOr();
        const r = this.peek();
        if (r.k === 'rparen') {
          this.next();
          return inner;
        }
      } catch {
        void 0;
      }
      this.pos = save;
    }
    const l = this.parseExpr();
    const inCond = this.tryInCond(l);
    if (inCond !== null) return inCond;
    const op = this.peek();
    if (op.k === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(op.text)) {
      this.next();
      const r = this.parseExpr();
      return rel(op.text as SymRelOp, l, r);
    }
    this.fail('Expected a comparison', op);
  }

  parseExpr(): SymNode {
    return this.parseSum();
  }

  parseSum(): SymNode {
    let l = this.parseProduct();
    for (;;) {
      const t = this.peek();
      if (t.k === 'op' && (t.text === '+' || t.text === '-')) {
        this.next();
        const r = this.parseProduct();
        l = t.text === '+' ? add(l, r) : add(l, negateNode(r));
      } else return l;
    }
  }

  parseProduct(): SymNode {
    let l = this.parseUnary();
    let prevWasNumber = this.prevWasNumberLiteral();
    for (;;) {
      const t = this.peek();
      if (t.k === 'op' && (t.text === '*' || t.text === '/')) {
        this.next();
        const r = this.parseUnary();
        l = t.text === '*' ? mul(l, r) : divideNodes(l, r);
        prevWasNumber = this.prevWasNumberLiteral();
        continue;
      }
      if (prevWasNumber && (t.k === 'name' || t.k === 'lparen')) {
        const r = this.parseUnary();
        l = mul(l, r);
        prevWasNumber = this.prevWasNumberLiteral();
        continue;
      }
      return l;
    }
  }

  private lastNumberPos = -1;

  private prevWasNumberLiteral(): boolean {
    return this.lastNumberPos === this.pos;
  }

  parseUnary(): SymNode {
    const t = this.peek();
    if (t.k === 'op' && t.text === '-') {
      this.next();
      return negateNode(this.parsePower());
    }
    if (t.k === 'op' && t.text === '+') {
      this.next();
      return this.parsePower();
    }
    return this.parsePower();
  }

  parsePower(): SymNode {
    const b = this.parsePostfix();
    const t = this.peek();
    if (t.k === 'op' && t.text === '^') {
      this.next();
      const e = this.parseUnary();
      return pow(b, e);
    }
    return b;
  }

  parsePostfix(): SymNode {
    let n = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (t.k === 'deg') {
        this.next();
        n = mul(n, divideNodes(constN('pi'), intN(180)));
      } else return n;
    }
  }

  parsePrimary(): SymNode {
    this.depth++;
    if (this.depth > 500) {
      const t = this.peek();
      throw new ParseFailure('The expression is nested too deep (over 500).', t.col, t.col + 1, '', true);
    }
    try {
      return this.parsePrimaryInner();
    } finally {
      this.depth--;
    }
  }

  parsePrimaryInner(): SymNode {
    const t = this.next();
    switch (t.k) {
      case 'num': {
        this.lastNumberPos = this.pos;
        return numNode(t.text, t.col);
      }
      case 'name': {
        const next = this.peek();
        if (next.k === 'lparen') return this.parseCall(t.text, t.col);
        return nameNode(t.text, t.col);
      }
      case 'lparen': {
        const e = this.parseExpr();
        const r = this.next();
        if (r.k !== 'rparen') this.fail('Expected )', r);
        return e;
      }
      case 'lbracket': {
        const items: SymNode[] = [];
        if (this.peek().k !== 'rbracket') {
          for (;;) {
            items.push(this.parseExpr());
            const s = this.peek();
            if (s.k === 'comma') {
              this.next();
              continue;
            }
            break;
          }
        }
        const r = this.next();
        if (r.k !== 'rbracket') this.fail('Expected ]', r);
        return listN(items);
      }
      default:
        this.fail('Expected an expression', t);
    }
  }

  parseCall(name: string, col: number): SymNode {
    this.next();
    if (name === 'if') return this.parseIfCall(col);
    const args: SymNode[] = [];
    if (this.peek().k !== 'rparen') {
      for (;;) {
        args.push(this.parseExpr());
        const s = this.peek();
        if (s.k === 'comma') {
          this.next();
          continue;
        }
        break;
      }
    }
    const r = this.next();
    if (r.k !== 'rparen') throw new ParseFailure(`Expected )`, col, col + 1, name);
    return callNode(name, args, col);
  }

  /** `if(c1, v1, …, otherwise)`: each argument is tried as a condition first. */
  parseIfCall(col: number): SymNode {
    const parts: (SymNode | SymCond)[] = [];
    if (this.peek().k !== 'rparen') {
      for (;;) {
        parts.push(this.parseCondOrExpr());
        const s = this.peek();
        if (s.k === 'comma') {
          this.next();
          continue;
        }
        break;
      }
    }
    const r = this.next();
    if (r.k !== 'rparen') throw new ParseFailure(`Expected )`, col, col + 1, 'if');
    if (parts.length < 2) throw new ParseFailure('if needs at least a condition and a value', col, col + 1, 'if');
    const cases: { when: SymCond; then: SymNode }[] = [];
    let i = 0;
    while (i + 1 < parts.length) {
      const head = parts[i];
      const next = parts[i + 1];
      if (head === undefined || next === undefined || !isCondPart(head)) break;
      if (isCondPart(next)) throw new ParseFailure('if needs a value after each condition', col, col + 1, 'if');
      cases.push({ when: head, then: next });
      i += 2;
    }
    if (cases.length === 0) throw new ParseFailure('if needs a condition first', col, col + 1, 'if');
    const other = i < parts.length ? (parts[i] as SymNode) : undefined;
    if (other !== undefined && isCondPart(other)) throw new ParseFailure('if has a trailing condition with no value', col, col + 1, 'if');
    return piecewiseN(cases, other);
  }

  /** Try a full condition; fall back to an expression when there is no comparison. */
  parseCondOrExpr(): SymNode | SymCond {
    const save = this.pos;
    try {
      const c = this.parseOr();
      const t = this.peek();
      if (t.k === 'comma' || t.k === 'rparen') return c;
    } catch {
      void 0;
    }
    this.pos = save;
    return this.parseExpr();
  }
}

function isCondPart(p: SymNode | SymCond): p is SymCond {
  return (p as SymCond).c !== undefined && ((p as SymCond).c === 'rel' || (p as SymCond).c === 'and' || (p as SymCond).c === 'or' || (p as SymCond).c === 'not' || (p as SymCond).c === 'true' || (p as SymCond).c === 'false' || (p as SymCond).c === 'in');
}

function numNode(text: string, col: number): SymNode {
  void col;
  if (/^[+-]?\d+$/.test(text)) {
    try {
      return intN(BigInt(text));
    } catch {
      return floatN(Number(text));
    }
  }
  const v = Number(text);
  if (!Number.isFinite(v)) return floatN(v);
  const r = shortestDecimalRational(v);
  if (r !== null) return r.d === 1n ? intN(r.n) : ratN(r.n, r.d);
  return floatN(v);
}

function nameNode(name: string, col: number): SymNode {
  void col;
  if (name === 'pi') return constN('pi');
  if (name === 'e') return constN('e');
  if (name === 'i') return constN('i');
  if (name === 'inf') return constN('inf');
  if (name === 'tau') return mul(intN(2), constN('pi'));
  if (name === 'deg') return divideNodes(constN('pi'), intN(180));
  if (name === 'true') return intN(1);
  if (name === 'false') return intN(0);
  return symN(name);
}

function callNode(name: string, args: SymNode[], col: number): SymNode {
  if (name === 'sqrt') {
    if (args.length !== 1) throw new ParseFailure('sqrt needs 1 argument', col, col + 1, name);
    return pow(args[0] as SymNode, ratN(1n, 2n));
  }
  if (name === 'exp') {
    if (args.length !== 1) throw new ParseFailure('exp needs 1 argument', col, col + 1, name);
    return pow(constN('e'), args[0] as SymNode);
  }
  if (FN_NAMES.has(name)) {
    if (name === 'min' || name === 'max') {
      if (args.length < 2) throw new ParseFailure(`${name} needs at least 2 arguments`, col, col + 1, name);
      return fn(name as SymFn, ...args);
    }
    if (name === 'atan2') {
      if (args.length !== 2) throw new ParseFailure('atan2 needs 2 arguments', col, col + 1, name);
      return fn(name, args[0] as SymNode, args[1] as SymNode);
    }
    if (args.length !== 1) throw new ParseFailure(`${name} needs 1 argument`, col, col + 1, name);
    return fn(name as SymFn, args[0] as SymNode);
  }
  if (name === 'rootof') {
    if (args.length !== 2) throw new ParseFailure('rootof needs a polynomial and an index', col, col + 1, name);
    const index = args[1] as SymNode;
    if (index.k !== 'int') throw new ParseFailure('rootof index must be a whole number', col, col + 1, name);
    const p = treeToUPoly(args[0] as SymNode, symN('x'));
    if (p === null) throw new ParseFailure('rootof needs a polynomial in x', col, col + 1, name);
    const ivs = upolyIsolate(p);
    const idx = Number(index.v);
    const iv = ivs[idx - 1];
    return rootofN(p, idx, iv === undefined ? 0 : iv.mid);
  }
  if (name === 'ref') {
    if (args.length !== 1 || (args[0] as SymNode).k !== 'int') {
      throw new ParseFailure('ref needs an object id', col, col + 1, name);
    }
    const id = args[0] as SymNode & { k: 'int' };
    return refN(Number(id.v));
  }
  throw new ParseFailure(`Unknown function ${name}`, col, col + name.length, name);
}

/** Parse text as an expression. Throws `ParseFailure` with a span. */
export function parseExpression(text: string): SymNode {
  const toks = lex(text);
  const p = new Parser(toks);
  const out = p.parseTop();
  if ('cond' in out) throw new ParseFailure('Expected an expression, found a condition', 1, Math.min(2, text.length + 1), text.slice(0, 8));
  return out.expr;
}

/** Parse text as a condition. Throws `ParseFailure` with a span. */
export function parseCondition(text: string): SymCond {
  const toks = lex(text);
  const p = new Parser(toks);
  const out = p.parseTop();
  if ('expr' in out) throw new ParseFailure('Expected a condition, found an expression', 1, Math.min(2, text.length + 1), text.slice(0, 8));
  return out.cond;
}

/** Parse text as either an expression or a condition (for `Expr(…)`). */
export function parseExprOrCond(text: string): { expr: SymNode } | { cond: SymCond } {
  const toks = lex(text);
  const p = new Parser(toks);
  return p.parseTop();
}
