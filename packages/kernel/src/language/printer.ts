/**
 * Pretty-printing of syntax trees back to canonical source text. Used for definitions in
 * summaries and `toScript`. Brackets are added only where precedence needs them.
 */
import type { Arg, Expr, LineNode, RangeClause, StyleItem } from './ast';

const PREC: Record<string, number> = { or: 1, xor: 2, and: 3, not: 4, cmp: 5, '+': 6, '-': 6, '*': 7, '/': 7, unary: 8, '^': 9 };

function prec(e: Expr): number {
  switch (e.k) {
    case 'bin':
      return e.implicit ? 7 : (PREC[e.op] as number);
    case 'unary':
      return e.op === 'not' ? 4 : 8;
    case 'cmp':
      return 5;
    default:
      return 20;
  }
}

function fmtNumber(v: number, text?: string): string {
  if (text !== undefined && text !== '') return text;
  return String(v);
}

function wrap(e: Expr, min: number): string {
  const s = printExpr(e);
  return prec(e) < min ? `(${s})` : s;
}

function printArg(a: Arg): string {
  return a.name !== undefined ? `${a.name} = ${printExpr(a.value)}` : printExpr(a.value);
}

export function printExpr(e: Expr): string {
  switch (e.k) {
    case 'num':
      return fmtNumber(e.v, e.text);
    case 'bool':
      return e.v ? 'true' : 'false';
    case 'undef':
      return 'undefined';
    case 'name':
      return e.name;
    case 'str': {
      let out = '"';
      for (const p of e.parts) {
        if (typeof p === 'string') out += p.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, '\\n');
        else out += `{${printExpr(p.expr)}${p.fmt !== undefined ? ':' + p.fmt : ''}}`;
      }
      return out + '"';
    }
    case 'unary':
      if (e.op === 'not') return `not ${wrap(e.arg, 4)}`;
      return `${e.op}${wrap(e.arg, 8)}`;
    case 'bin': {
      if (e.implicit) {
        const rt = wrap(e.r, 8);
        return `${printExpr(e.l)}${/^[eE]\d/.test(rt) ? ' ' : ''}${rt}`;
      }
      const p = PREC[e.op] as number;
      if (e.op === '^') {
        const l = prec(e.l) <= 9 ? `(${printExpr(e.l)})` : printExpr(e.l);
        const r = e.r.k === 'unary' || prec(e.r) < 9 ? (e.r.k === 'unary' ? printExpr(e.r) : `(${printExpr(e.r)})`) : printExpr(e.r);
        return `${l}^${r}`;
      }
      const right = prec(e.r) <= p && e.op !== 'and' && e.op !== 'or' ? `(${printExpr(e.r)})` : wrap(e.r, p);
      return `${wrap(e.l, p)} ${e.op} ${right}`;
    }
    case 'cmp': {
      let out = wrap(e.operands[0] as Expr, 6);
      for (let i = 0; i < e.ops.length; i++) out += ` ${e.ops[i]} ${wrap(e.operands[i + 1] as Expr, 6)}`;
      return out;
    }
    case 'call':
      return `${e.callee}(${e.args.map(printArg).join(', ')})`;
    case 'tick':
      return `${e.callee}${"'".repeat(e.ticks)}(${e.args.map(printExpr).join(', ')})`;
    case 'index':
      return `${wrap(e.target, 10)}[${printExpr(e.index)}]`;
    case 'field':
      return `${wrap(e.target, 10)}.${e.field}`;
    case 'fact':
      return `${wrap(e.arg, 10)}!`;
    case 'deg':
      return `${wrap(e.arg, 10)}°`;
    case 'tuple':
      return `(${e.items.map(printExpr).join(', ')})`;
    case 'polar':
      return `(${printExpr(e.r)}; ${printExpr(e.a)})`;
    case 'list':
      return `[${e.items.map(printExpr).join(', ')}]`;
    case 'range':
      return `[${printExpr(e.from)}..${printExpr(e.to)}${e.step ? ' step ' + printExpr(e.step) : ''}]`;
    case 'cond':
      return `if(${e.args.map(printExpr).join(', ')})`;
  }
}

export function printRange(r: RangeClause): string {
  return `in ${printExpr(r.from)}..${printExpr(r.to)}${r.step ? ' step ' + printExpr(r.step) : ''}`;
}

export function printStyle(items: readonly StyleItem[]): string {
  return 'with ' + items.map((i) => `${i.key} = ${printExpr(i.value)}`).join(', ');
}

/** Canonical text of a parsed line. */
export function printLineNode(n: LineNode): string {
  switch (n.k) {
    case 'noop':
      return n.comment ?? '';
    case 'directive':
      return `@${n.name}${n.words.map((w) => ' ' + w.text).join('')}`;
    case 'define':
      return `${n.target.name} = ${printExpr(n.expr)}${n.range ? ' ' + printRange(n.range) : ''}${n.style ? ' ' + printStyle(n.style) : ''}`;
    case 'defmany':
      return `${n.targets.map((t) => t.name).join(', ')} = ${printExpr(n.expr)}`;
    case 'function':
      return `${n.target.name}(${n.params.map((p) => p.name).join(', ')}) = ${printExpr(n.expr)}${n.style ? ' ' + printStyle(n.style) : ''}`;
    case 'rate':
      return `${n.target.name}${"'".repeat(n.order)} = ${printExpr(n.expr)}`;
    case 'restyle':
      return `${n.target.name} ${printStyle(n.style)}`;
    case 'rerange':
      return `${n.target.name} ${printRange(n.range)}`;
    case 'action':
      return printExpr(n.expr);
  }
}
