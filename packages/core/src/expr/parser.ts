import type { BinaryOperator, Expr } from './ast';
import { ExpressionError, tokenize, type Token } from './tokens';

export const MAX_DEPTH = 64;

interface InfixRule {
  readonly precedence: number;
  readonly rightAssociative: boolean;
}

// Higher binds tighter. Unary operators bind at 8, so -x^2 is -(x^2).
const INFIX: Readonly<Record<string, InfixRule>> = {
  '?': { precedence: 1, rightAssociative: true },
  '||': { precedence: 2, rightAssociative: false },
  '&&': { precedence: 3, rightAssociative: false },
  '==': { precedence: 4, rightAssociative: false },
  '!=': { precedence: 4, rightAssociative: false },
  '<': { precedence: 5, rightAssociative: false },
  '<=': { precedence: 5, rightAssociative: false },
  '>': { precedence: 5, rightAssociative: false },
  '>=': { precedence: 5, rightAssociative: false },
  '+': { precedence: 6, rightAssociative: false },
  '-': { precedence: 6, rightAssociative: false },
  '*': { precedence: 7, rightAssociative: false },
  '/': { precedence: 7, rightAssociative: false },
  '%': { precedence: 7, rightAssociative: false },
  '^': { precedence: 9, rightAssociative: true },
};

const UNARY_PRECEDENCE = 8;

/** Parses a maths expression with a Pratt parser. Throws ExpressionError with a position. */
export function parseExpression(source: string): Expr {
  const tokens = tokenize(source);
  let index = 0;
  let depth = 0;

  const peek = (): Token => tokens[index] ?? tokens[tokens.length - 1]!;
  const next = (): Token => {
    const token = peek();
    if (token.type !== 'end') index++;
    return token;
  };
  const expect = (type: Token['type'], value: string, message: string): Token => {
    const token = peek();
    if (token.type !== type || token.value !== value) throw new ExpressionError(message, token.position);
    return next();
  };

  function parse(minPrecedence: number): Expr {
    if (++depth > MAX_DEPTH) throw new ExpressionError(`Expression nests deeper than ${MAX_DEPTH} levels`, peek().position);
    let left = parsePrefix();
    for (;;) {
      const token = peek();
      if (token.type !== 'operator') break;
      const rule = INFIX[token.value];
      if (!rule || rule.precedence < minPrecedence) break;
      next();
      if (token.value === '?') {
        const consequent = parse(0);
        expect('operator', ':', 'Expected ":" in a conditional expression');
        const alternate = parse(rule.precedence);
        left = { kind: 'conditional', test: left, consequent, alternate, position: token.position };
        continue;
      }
      const right = parse(rule.rightAssociative ? rule.precedence : rule.precedence + 1);
      left = { kind: 'binary', operator: token.value as BinaryOperator, left, right, position: token.position };
    }
    depth--;
    return left;
  }

  function parsePrefix(): Expr {
    const token = next();
    switch (token.type) {
      case 'number': {
        const value = Number(token.value);
        if (!Number.isFinite(value)) throw new ExpressionError(`Invalid number "${token.value}"`, token.position);
        return { kind: 'number', value, position: token.position };
      }
      case 'identifier': {
        if (peek().type === 'paren' && peek().value === '(') {
          next();
          const args: Expr[] = [];
          if (!(peek().type === 'paren' && peek().value === ')')) {
            for (;;) {
              args.push(parse(0));
              if (peek().type === 'comma') {
                next();
                continue;
              }
              break;
            }
          }
          expect('paren', ')', `Expected ")" to close the call to ${token.value}`);
          return { kind: 'call', name: token.value, args, position: token.position };
        }
        return { kind: 'variable', name: token.value, position: token.position };
      }
      case 'paren': {
        if (token.value !== '(') throw new ExpressionError('Unexpected ")"', token.position);
        const inner = parse(0);
        expect('paren', ')', 'Expected ")"');
        return inner;
      }
      case 'operator': {
        if (token.value === '-' || token.value === '+' || token.value === '!') {
          const operand = parse(UNARY_PRECEDENCE);
          return { kind: 'unary', operator: token.value, operand, position: token.position };
        }
        throw new ExpressionError(`Unexpected operator "${token.value}"`, token.position);
      }
      case 'comma':
        throw new ExpressionError('Unexpected ","', token.position);
      case 'end':
        throw new ExpressionError('Unexpected end of expression', token.position);
    }
  }

  const expr = parse(0);
  const rest = peek();
  if (rest.type !== 'end') throw new ExpressionError(`Unexpected "${rest.value}"`, rest.position);
  return expr;
}
