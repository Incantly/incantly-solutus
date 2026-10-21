export class ExpressionError extends Error {
  constructor(
    message: string,
    /** Zero-based character offset into the source. */
    readonly position: number,
  ) {
    super(message);
    this.name = 'ExpressionError';
  }
}

export type TokenType = 'number' | 'identifier' | 'operator' | 'paren' | 'comma' | 'end';

export interface Token {
  readonly type: TokenType;
  readonly value: string;
  readonly position: number;
}

export const MAX_SOURCE_LENGTH = 2000;

const OPERATORS = ['<=', '>=', '==', '!=', '&&', '||', '+', '-', '*', '/', '%', '^', '<', '>', '!', '?', ':'];

const isDigit = (c: string) => c >= '0' && c <= '9';
const isIdentStart = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isIdentPart = (c: string) => isIdentStart(c) || isDigit(c);

export function tokenize(source: string): Token[] {
  if (source.length > MAX_SOURCE_LENGTH) {
    throw new ExpressionError(`Expression is longer than ${MAX_SOURCE_LENGTH} characters`, MAX_SOURCE_LENGTH);
  }
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source.charAt(i);
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (isDigit(c) || (c === '.' && isDigit(source.charAt(i + 1)))) {
      const start = i;
      while (isDigit(source.charAt(i))) i++;
      if (source.charAt(i) === '.') {
        i++;
        while (isDigit(source.charAt(i))) i++;
      }
      if (source.charAt(i) === 'e' || source.charAt(i) === 'E') {
        const save = i;
        i++;
        if (source.charAt(i) === '+' || source.charAt(i) === '-') i++;
        if (!isDigit(source.charAt(i))) {
          i = save; // an identifier `e` follows, not an exponent
        } else {
          while (isDigit(source.charAt(i))) i++;
        }
      }
      tokens.push({ type: 'number', value: source.slice(start, i), position: start });
      continue;
    }
    if (isIdentStart(c)) {
      const start = i;
      while (i < source.length && isIdentPart(source.charAt(i))) i++;
      tokens.push({ type: 'identifier', value: source.slice(start, i), position: start });
      continue;
    }
    if (c === '(' || c === ')') {
      tokens.push({ type: 'paren', value: c, position: i });
      i++;
      continue;
    }
    if (c === ',') {
      tokens.push({ type: 'comma', value: c, position: i });
      i++;
      continue;
    }
    const op = OPERATORS.find((candidate) => source.startsWith(candidate, i));
    if (op) {
      tokens.push({ type: 'operator', value: op, position: i });
      i += op.length;
      continue;
    }
    throw new ExpressionError(`Unexpected character "${c}"`, i);
  }
  tokens.push({ type: 'end', value: '', position: source.length });
  return tokens;
}
