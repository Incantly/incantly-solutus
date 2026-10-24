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

/** Unicode scripts for the plain-text form of an equation, where a font has them. */
const SUPERSCRIPT: Readonly<Record<string, string>> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', n: 'ⁿ', i: 'ⁱ', x: 'ˣ', t: 'ᵗ', k: 'ᵏ',
};
const SUBSCRIPT: Readonly<Record<string, string>> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
};

/** Every character through a script table, or null when one has no script form. */
function scripted(text: string, table: Readonly<Record<string, string>>): string | null {
  let out = '';
  for (const c of text) {
    const mapped = table[c];
    if (mapped === undefined) return null;
    out += mapped;
  }
  return out;
}

/** One letter, Latin or Greek, with any primes after it: the name of a function such as f′ or φ. */
function isLetterName(name: string): boolean {
  return /^[A-Za-z\u0391-\u03A9\u03B1-\u03C9]['\u2032]*$/.test(name);
}

/** A name as maths: Greek words become letters, trailing digits become a subscript, and primes stay primes (L' is L′). */
export function symbolText(name: string): { base: string; sub: string | null } {
  const primes = /['\u2032]*$/.exec(name)![0].length;
  const bare = name.slice(0, name.length - primes);
  const match = /^([A-Za-z\u0391-\u03A9\u03B1-\u03C9]+?)(?:_?(\d+))?$/.exec(bare);
  const word = match?.[1] ?? bare;
  const sub = match?.[2] ?? null;
  return { base: (GREEK[word] ?? word) + '\u2032'.repeat(primes), sub };
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

function numberText(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(6)));
}

/**
 * Whether a product is written side by side, without a dot: a number before a
 * name or a bracket (2x) always, and in an equation any factor before a name,
 * a call, a power of a name or a bracket (mgh, ½mv², G m₁m₂).
 */
function sideBySide(left: Expr, right: Expr, implicit: boolean): boolean {
  const fenced = precedenceOf(right) < PRECEDENCE['*'];
  const named = right.kind === 'variable' || right.kind === 'call';
  if (left.kind === 'number') return named || fenced;
  const power = right.kind === 'binary' && right.operator === '^' && right.left.kind === 'variable';
  return implicit && (named || fenced || power);
}

class Builder {
  /** `implicit` writes products side by side, as equations are printed. */
  constructor(
    private readonly doc: Document,
    private readonly implicit = false,
  ) {}

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
      case 'number':
        return this.el('mn', numberText(expr.value));
      case 'variable': {
        const { base, sub } = symbolText(expr.name);
        const mi = this.symbol(base);
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
    if (operator === '*' && sideBySide(left, right, this.implicit)) return this.el('mrow', l, r);
    return this.el('mrow', l, this.mo(OPERATOR_TEXT[operator] ?? operator), r);
  }

  /** A symbol: a letter in italic, with any primes after it set close (L′). */
  symbol(base: string): Element {
    const primed = /^(.)(\u2032+)$/u.exec(base);
    if (!primed) return this.el('mi', base);
    const prime = this.mo(primed[2]!);
    prime.setAttribute('lspace', '0');
    prime.setAttribute('rspace', '0');
    return this.el('mrow', this.el('mi', primed[1]!), prime);
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
    // A function of one letter, such as f′ or φ, is a symbol in italic; a named one, such as sin, is upright.
    const letter = isLetterName(name);
    const fn = letter ? this.symbol(symbolText(name).base) : this.el('mi', name);
    if (!letter) fn.setAttribute('mathvariant', 'normal');
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
    const mi = builder.symbol(base);
    math.append(builder.el('mrow', sub ? builder.el('msub', mi, builder.el('mn', sub)) : mi, builder.mo('='), body));
  } else math.append(body);
  return math;
}

/** The same tree as one line of Unicode text, for pictures that cannot hold MathML. */
class Linear {
  operand(expr: Expr, min: number): string {
    const text = this.node(expr);
    return precedenceOf(expr) < min ? `(${text})` : text;
  }

  /** A root's or a function's argument: bare when it is one symbol. */
  argument(expr: Expr): string {
    return expr.kind === 'number' || expr.kind === 'variable' ? this.node(expr) : `(${this.node(expr)})`;
  }

  node(expr: Expr): string {
    switch (expr.kind) {
      case 'number':
        return numberText(expr.value);
      case 'variable': {
        const { base, sub } = symbolText(expr.name);
        return sub ? base + (scripted(sub, SUBSCRIPT) ?? `_${sub}`) : base;
      }
      case 'unary':
        return (expr.operator === '-' ? '−' : expr.operator === '!' ? '¬' : '+') + this.operand(expr.operand, 8);
      case 'binary':
        return this.binary(expr.operator, expr.left, expr.right);
      case 'call':
        return this.call(expr.name, expr.args);
      case 'conditional':
        return `${this.operand(expr.test, 2)} ? ${this.operand(expr.consequent, 2)} : ${this.operand(expr.alternate, 2)}`;
    }
  }

  power(base: string, exponent: Expr): string {
    const text = this.node(exponent);
    const simple = exponent.kind === 'number' || exponent.kind === 'variable' || (exponent.kind === 'unary' && exponent.operand.kind === 'number');
    const raised = simple ? scripted(text, SUPERSCRIPT) : null;
    if (raised !== null) return base + raised;
    return `${base}^${simple ? text : `(${text})`}`;
  }

  binary(operator: BinaryOperator, left: Expr, right: Expr): string {
    const p = PRECEDENCE[operator];
    if (operator === '^') return this.power(this.operand(left, 10), right);
    if (operator === '/') return `${this.operand(left, p)}/${this.operand(right, p + 1)}`;
    const rightMin = operator === '-' || operator === '%' ? p + 1 : p;
    const l = this.operand(left, p);
    const r = this.operand(right, rightMin);
    // Side by side after a fraction reads as one bigger fraction in a line, so the fraction keeps brackets: (1/2)mv².
    if (operator === '*') return sideBySide(left, right, true) ? (left.kind === 'binary' && left.operator === '/' ? `(${l})` : l) + r : `${l}·${r}`;
    return `${l} ${(OPERATOR_TEXT[operator] ?? operator).trim()} ${r}`;
  }

  call(name: string, args: readonly Expr[]): string {
    const [first] = args;
    if (name === 'sqrt' && first) return `√${this.argument(first)}`;
    if (name === 'cbrt' && first) return `∛${this.argument(first)}`;
    if (name === 'abs' && first) return `|${this.node(first)}|`;
    if (name === 'exp' && first) return this.power('e', first);
    if (name === 'pow' && args.length === 2) return this.power(this.operand(first!, 10), args[1]!);
    return `${isLetterName(name) ? symbolText(name).base : name}(${args.map((arg) => this.node(arg)).join(', ')})`;
  }
}

/** Equals and approximately-equals signs between the sides of an equation, not inside <=, >=, == or !=. */
const RELATION = /((?<![<>=!])=(?!=)|≈)/;

interface Side {
  /** The sign before this side; empty for the first. */
  readonly relation: string;
  readonly text: string;
  /** The side's syntax tree, or null when it is not a formula. */
  readonly expr: Expr | null;
}

function sidesOf(source: string): Side[] {
  const pieces = source.split(RELATION);
  const sides: Side[] = [];
  for (let i = 0; i < pieces.length; i += 2) {
    const text = pieces[i]!.trim();
    let expr: Expr | null = null;
    if (text) {
      try {
        expr = parseExpression(text);
      } catch {
        expr = null;
      }
    }
    sides.push({ relation: i === 0 ? '' : pieces[i - 1]!, text, expr });
  }
  return sides;
}

/**
 * An equation drawn in a stage, as MathML (DG-5): each side of its = signs is
 * read by the same safe parser as formulas, so F = G*m1*m2/r^2 shows its
 * fraction stacked and its factors side by side. A side that is not a
 * formula is shown as it was written.
 */
export function equationElement(doc: Document, source: string): Element {
  const builder = new Builder(doc, true);
  const row = builder.el('mrow');
  for (const side of sidesOf(source)) {
    if (side.relation) row.append(builder.mo(side.relation));
    if (side.expr) row.append(builder.node(side.expr));
    else if (side.text) row.append(builder.el('mtext', side.text));
  }
  const math = builder.el('math', row);
  math.setAttribute('display', 'inline');
  // Fractions and roots at full size, as in a displayed equation, not shrunk to fit a line of text.
  math.setAttribute('displaystyle', 'true');
  return math;
}

/** The equation as one line of text, F = Gm₁m₂/r², for pictures that cannot hold MathML. */
export function linearEquation(source: string): string {
  const linear = new Linear();
  return sidesOf(source)
    .map((side) => (side.relation ? ` ${side.relation} ` : '') + (side.expr ? linear.node(side.expr) : side.text))
    .join('');
}
