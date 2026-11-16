/**
 * LaTeX of the language's expressions and values (text-logic design 4.1): the source the layout engine typesets, and
 * what `LaTeX(obj)` shows. Pure; no DOM.
 */
import type { Expr, LineNode } from '../../language/ast';
import { valueText } from '../../language/runtime';

const GREEK: ReadonlySet<string> = new Set([
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi',
  'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Phi', 'Psi', 'Omega',
]);
const UNICODE_GREEK: Readonly<Record<string, string>> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ζ: 'zeta', η: 'eta', θ: 'theta', λ: 'lambda', μ: 'mu', ξ: 'xi',
  π: 'pi', ρ: 'rho', σ: 'sigma', τ: 'tau', φ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega', Δ: 'Delta', Θ: 'Theta', Λ: 'Lambda', Σ: 'Sigma', Φ: 'Phi', Ω: 'Omega',
};
/** Functions LaTeX has an operator for. */
const OPERATORS: ReadonlySet<string> = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh', 'arcsin', 'arccos', 'arctan', 'ln', 'log', 'exp', 'min', 'max', 'det', 'gcd']);
const RENAME: Readonly<Record<string, string>> = { asin: 'arcsin', acos: 'arccos', atan: 'arctan' };

/** A number as LaTeX: an exponent becomes `\times 10^{…}`; `inf` is `\infty`. */
export function numberLatex(v: number): string {
  if (Number.isNaN(v)) return '\\text{undefined}';
  if (!Number.isFinite(v)) return v > 0 ? '\\infty' : '-\\infty';
  const s = valueText(v);
  const m = /^(-?[\d.]+)e([+-]?\d+)$/.exec(s);
  return m ? `${m[1]} \\times 10^{${Number(m[2])}}` : s;
}

/** A name as LaTeX: Greek letters by command, an index after `_` as a subscript, several letters upright. */
export function nameLatex(name: string, sub?: (n: string) => string | undefined): string {
  const val = sub?.(name);
  if (val !== undefined) return val;
  const [base, ...rest] = name.split('_');
  const b = base ?? name;
  const greek = UNICODE_GREEK[b] ?? (GREEK.has(b) ? b : undefined);
  const head = greek ? `\\${greek}` : b.length > 1 ? `\\mathrm{${b}}` : b;
  return rest.length > 0 ? `${head}_{${rest.join('_')}}` : head;
}

/** Binding strength, so brackets go only where they are needed. */
const PREC: Readonly<Record<string, number>> = { or: 1, xor: 1, and: 2, cmp: 3, '+': 4, '-': 4, '*': 5, '/': 5, unary: 6, '^': 7, atom: 9 };

const precOf = (e: Expr): number => {
  if (e.k === 'bin') return PREC[e.op] ?? 4;
  if (e.k === 'cmp') return PREC['cmp'] as number;
  if (e.k === 'unary') return PREC['unary'] as number;
  return PREC['atom'] as number;
};

const CMP: Readonly<Record<string, string>> = { '==': '=', '!=': '\\neq', '<': '<', '<=': '\\leq', '>': '>', '>=': '\\geq' };

/**
 * LaTeX of an expression. `sub` may put a value in place of a name (`substitute = true`, design 4.1), returning its
 * LaTeX, or `undefined` to keep the name.
 */
export function exprLatex(e: Expr, sub?: (name: string) => string | undefined): string {
  const go = (x: Expr): string => exprLatex(x, sub);
  const wrap = (x: Expr, min: number): string => (precOf(x) < min ? `\\left(${go(x)}\\right)` : go(x));
  switch (e.k) {
    case 'num': return numberLatex(e.v);
    case 'bool': return `\\text{${e.v}}`;
    case 'undef': return '\\text{undefined}';
    case 'str': return `\\text{${e.parts.map((p) => (typeof p === 'string' ? p : '…')).join('').replace(/[{}\\]/g, '')}}`;
    case 'name': return nameLatex(e.name, sub);
    case 'cells': return `\\text{${e.from.name}:${e.to.name}}`;
    case 'unary': return e.op === 'not' ? `\\neg ${wrap(e.arg, PREC['unary'] as number)}` : `${e.op}${wrap(e.arg, PREC['unary'] as number)}`;
    case 'bin': {
      const p = PREC[e.op] ?? 4;
      if (e.op === '/') return `\\frac{${go(e.l)}}{${go(e.r)}}`;
      if (e.op === '^') return `${wrap(e.l, (PREC['^'] as number) + 1)}^{${go(e.r)}}`;
      if (e.op === '*') {
        // a number times a name or a bracket reads as juxtaposition; otherwise a centred dot
        const l = wrap(e.l, p);
        const r = wrap(e.r, p + 1);
        // a name replaced by a number (substitute = true) reads as a number too: 2x, not 2 · x
        const numLeft = e.l.k === 'num' || /^-?[\d.]+$/.test(l);
        const juxt = e.implicit === true || (numLeft && (e.r.k === 'name' || e.r.k === 'call' || (e.r.k === 'bin' && e.r.op === '^')));
        return juxt ? `${l} ${r}` : `${l} \\cdot ${r}`;
      }
      if (e.op === 'and') return `${wrap(e.l, p)} \\land ${wrap(e.r, p)}`;
      if (e.op === 'or') return `${wrap(e.l, p)} \\lor ${wrap(e.r, p)}`;
      if (e.op === 'xor') return `${wrap(e.l, p)} \\oplus ${wrap(e.r, p)}`;
      return `${wrap(e.l, p)} ${e.op} ${wrap(e.r, p + 1)}`;
    }
    case 'cmp': return e.operands.map((x, i) => `${i > 0 ? ` ${CMP[e.ops[i - 1] as string] ?? e.ops[i - 1]} ` : ''}${wrap(x, (PREC['cmp'] as number) + 1)}`).join('');
    case 'call': {
      const args = e.args.map((a) => go(a.value));
      const f = RENAME[e.callee] ?? e.callee;
      if (f === 'sqrt' && args.length === 1) return `\\sqrt{${args[0]}}`;
      if (f === 'cbrt' && args.length === 1) return `\\sqrt[3]{${args[0]}}`;
      if (f === 'abs' && args.length === 1) return `\\left|${args[0]}\\right|`;
      if (f === 'floor' && args.length === 1) return `\\left\\lfloor ${args[0]}\\right\\rfloor`;
      if (f === 'ceil' && args.length === 1) return `\\left\\lceil ${args[0]}\\right\\rceil`;
      if (f === 'exp' && args.length === 1) return `e^{${args[0]}}`;
      const head = OPERATORS.has(f) ? `\\${f}` : /^[A-Z]/.test(f) || f.length > 1 ? `\\operatorname{${f}}` : f;
      return `${head}\\left(${args.join(', ')}\\right)`;
    }
    case 'tick': return `${nameLatex(e.callee)}${"'".repeat(e.ticks)}\\left(${e.args.map(go).join(', ')}\\right)`;
    case 'index': return `${wrap(e.target, PREC['atom'] as number)}_{${go(e.index)}}`;
    case 'field': return `${wrap(e.target, PREC['atom'] as number)}.\\mathrm{${e.field}}`;
    case 'fact': return `${wrap(e.arg, PREC['atom'] as number)}!`;
    case 'deg': return `${wrap(e.arg, PREC['atom'] as number)}^{\\circ}`;
    case 'tuple': return `\\left(${e.items.map(go).join(', ')}\\right)`;
    case 'polar': return `\\left(${go(e.r)}; ${go(e.a)}\\right)`;
    case 'list': return `\\left\\{${e.items.map(go).join(', ')}\\right\\}`;
    case 'range': return `${go(e.from)} .. ${go(e.to)}`;
    case 'cond': {
      // if(c1, v1, c2, v2, …, otherwise) as a cases block
      const rows: string[] = [];
      const a = e.args;
      for (let i = 0; i + 1 < a.length; i += 2) rows.push(`${go(a[i + 1] as Expr)} & \\text{if } ${go(a[i] as Expr)}`);
      if (a.length % 2 === 1) rows.push(`${go(a[a.length - 1] as Expr)} & \\text{otherwise}`);
      return `\\begin{cases} ${rows.join(' \\\\ ')} \\end{cases}`;
    }
  }
}

/** LaTeX of a line: `f(x) = x^{2} - 2`, `M = \operatorname{Midpoint}\left(A, B\right)`. Undefined for other line kinds. */
export function lineLatex(node: LineNode, sub?: (name: string) => string | undefined): { readonly full: string; readonly rhs: string } | undefined {
  if (node.k === 'define') {
    const rhs = exprLatex(node.expr, sub);
    return { full: `${nameLatex(node.target.name)} = ${rhs}`, rhs };
  }
  if (node.k === 'function') {
    const rhs = exprLatex(node.expr, sub);
    return { full: `${nameLatex(node.target.name)}\\left(${node.params.map((p) => nameLatex(p.name)).join(', ')}\\right) = ${rhs}`, rhs };
  }
  return undefined;
}

const isPt = (v: unknown): v is { x: number; y: number } => typeof v === 'object' && v !== null && typeof (v as { x?: unknown }).x === 'number' && typeof (v as { y?: unknown }).y === 'number';

/** LaTeX of a value (design 4.1, "Formula" column) when there is no definition to show. */
export function valueLatex(v: unknown, type = ''): string {
  if (typeof v === 'number') return numberLatex(v);
  if (typeof v === 'boolean') return `\\text{${v}}`;
  if (typeof v === 'string') return `\\text{${v.replace(/[{}\\$]/g, '')}}`;
  if (isPt(v)) {
    if (type === 'Vector') return `\\begin{pmatrix} ${numberLatex(v.x)} \\\\ ${numberLatex(v.y)} \\end{pmatrix}`;
    return `\\left(${numberLatex(v.x)}, ${numberLatex(v.y)}\\right)`;
  }
  const items = v instanceof Float64Array ? Array.from(v) : Array.isArray(v) ? v : undefined;
  if (items) {
    // a list of equal-length lists is a matrix
    const rows = items.map((r) => (r instanceof Float64Array ? Array.from(r) : r));
    if (rows.length > 0 && rows.every((r) => Array.isArray(r) && r.length === (rows[0] as unknown[]).length)) {
      return `\\begin{pmatrix} ${rows.map((r) => (r as unknown[]).map((c) => valueLatex(c)).join(' & ')).join(' \\\\ ')} \\end{pmatrix}`;
    }
    return `\\left\\{${items.map((x) => valueLatex(x)).join(', ')}\\right\\}`;
  }
  return `\\text{${valueText(v).replace(/[{}\\$]/g, '')}}`;
}
