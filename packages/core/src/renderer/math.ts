import type { BinaryOperator, Expr } from '../expr/ast';
import { parseExpression } from '../expr/parser';

/**
 * Rendered maths for formulas (FM-4): the same safe parser's syntax tree,
 * written out as MathML elements with the DOM, never as markup text.
 * Fractions, powers, roots, absolute values and Greek letters display the
 * way they are written on paper.
 */

export const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

const GREEK: Readonly<Record<string, string>> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  phi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Sigma: 'Σ',
  Phi: 'Φ',
  Omega: 'Ω',
};

const PRECEDENCE: Readonly<Record<BinaryOperator, number>> = {
  '||': 2,
  '&&': 3,
  '==': 4,
  '!=': 4,
  '<': 5,
  '<=': 5,
  '>': 5,
  '>=': 5,
  '+': 6,
  '-': 6,
  '*': 7,
  '/': 7,
  '%': 7,
  '^': 9,
};

const OPERATOR_TEXT: Readonly<Partial<Record<BinaryOperator, string>>> = {
  '-': '−',
  '*': '·',
  '%': ' mod ',
  '<=': '≤',
  '>=': '≥',
  '==': '=',
  '!=': '≠',
  '&&': ' and ',
  '||': ' or ',
};

/** A name as maths: Greek words become letters, trailing digits become a subscript. */
export function symbolText(name: string): { base: string; sub: string | null } {
  const match = /^([A-Za-z]+?)(?:_?(\d+))?$/.exec(name);
  const word = match?.[1] ?? name;
  const sub = match?.[2] ?? null;
  return { base: GREEK[word] ?? word, sub };
}

function precedenceOf(expr: Expr): number {
  switch (expr.kind) {
    case 'binary':
      return PRECEDENCE[expr.operator];
    case 'conditional':
      return 1;
    case 'unary':
      return 8;
    default:
      return 10;
  }
}

class Builder {
  constructor(private readonly doc: Document) {}

  el(tag: string, ...children: Array<Element | string>): Element {
    const element = this.doc.createElementNS(MATHML_NS, tag);
    for (const child of children) element.append(child);
    return element;
  }

  mo(text: string): Element {
    return this.el('mo', text);
  }

  fenced(inner: Element): Element {
    return this.el('mrow', this.mo('('), inner, this.mo(')'));
  }

  /** `expr`, in brackets when it binds more loosely than its context needs. */
  operand(expr: Expr, min: number): Element {
    const node = this.node(expr);
    return precedenceOf(expr) < min ? this.fenced(node) : node;
  }

  node(expr: Expr): Element {
    switch (expr.kind) {
      case 'number': {
        const text = Number.isInteger(expr.value) ? String(expr.value) : String(Number(expr.value.toPrecision(6)));
        return this.el('mn', text);
      }
      case 'variable': {
        const { base, sub } = symbolText(expr.name);
        const mi = this.el('mi', base);
        return sub ? this.el('msub', mi, this.el('mn', sub)) : mi;
      }
      case 'unary': {
        const sign = expr.operator === '-' ? '−' : expr.operator === '!' ? '¬' : '+';
        return this.el('mrow', this.mo(sign), this.operand(expr.operand, 8));
      }
      case 'binary':
        return this.binary(expr.operator, expr.left, expr.right);
      case 'call':
        return this.call(expr.name, expr.args);
      case 'conditional':
        return this.el('mrow', this.operand(expr.test, 2), this.mo('?'), this.operand(expr.consequent, 2), this.mo(':'), this.operand(expr.alternate, 2));
    }
  }

  binary(operator: BinaryOperator, left: Expr, right: Expr): Element {
    const p = PRECEDENCE[operator];
    if (operator === '/') return this.el('mfrac', this.node(left), this.node(right));
    if (operator === '^') return this.el('msup', this.operand(left, 10), this.node(right));
    // Right operands of non-commutative operators need brackets at equal precedence: a − (b + c).
    const rightMin = operator === '-' || operator === '%' ? p + 1 : p;
    const l = this.operand(left, p);
    const r = this.operand(right, rightMin);
    // A number times a name or a bracket reads as 2x, without a dot.
    if (operator === '*' && left.kind === 'number' && (right.kind === 'variable' || right.kind === 'call' || precedenceOf(right) < p)) {
      return this.el('mrow', l, r);
    }
    return this.el('mrow', l, this.mo(OPERATOR_TEXT[operator] ?? operator), r);
  }

  call(name: string, args: readonly Expr[]): Element {
    const [first] = args;
    if (name === 'sqrt' && first) return this.el('msqrt', this.node(first));
    if (name === 'cbrt' && first) return this.el('mroot', this.node(first), this.el('mn', '3'));
    if (name === 'abs' && first) return this.el('mrow', this.mo('|'), this.node(first), this.mo('|'));
    if (name === 'exp' && first) return this.el('msup', this.el('mi', 'e'), this.node(first));
    if (name === 'pow' && args.length === 2) return this.el('msup', this.operand(first!, 10), this.node(args[1]!));
    const list = this.el('mrow');
    args.forEach((arg, i) => {
      if (i > 0) list.append(this.mo(','));
      list.append(this.node(arg));
    });
    const fn = this.el('mi', name === 'ln' || name === 'log' ? name : name);
    fn.setAttribute('mathvariant', 'normal');
    return this.el('mrow', fn, this.mo('⁡'), this.fenced(list));
  }
}

/** The formula as a MathML element, or null when it does not parse. */
export function mathElement(doc: Document, source: string, lead?: string): Element | null {
  let expr: Expr;
  try {
    expr = parseExpression(source);
  } catch {
    return null;
  }
  const builder = new Builder(doc);
  const body = builder.node(expr);
  const math = builder.el('math');
  math.setAttribute('display', 'inline');
  if (lead) {
    const { base, sub } = symbolText(lead);
    const mi = builder.el('mi', base);
    math.append(builder.el('mrow', sub ? builder.el('msub', mi, builder.el('mn', sub)) : mi, builder.mo('='), body));
  } else math.append(body);
  return math;
}
