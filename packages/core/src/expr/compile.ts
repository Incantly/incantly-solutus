import type { Expr } from './ast';
import { CONSTANTS, FUNCTIONS } from './functions';
import { ExpressionError } from './tokens';

export type Scope = Readonly<Record<string, number>>;
export type Evaluator = (scope: Scope) => number;

const truth = (x: number) => (x !== 0 && !Number.isNaN(x) ? 1 : 0);

/**
 * Compiles an expression tree into nested closures. Variables are read with
 * Object.hasOwn so inherited properties can never be reached.
 */
export function compileExpr(expr: Expr, variables: ReadonlySet<string>): Evaluator {
  switch (expr.kind) {
    case 'number': {
      const value = expr.value;
      return () => value;
    }
    case 'variable': {
      const name = expr.name;
      if (Object.hasOwn(CONSTANTS, name)) {
        const value = CONSTANTS[name]!;
        return () => value;
      }
      if (!variables.has(name)) throw new ExpressionError(`Unknown variable "${name}"`, expr.position);
      return (scope) => (Object.hasOwn(scope, name) ? Number(scope[name]) : Number.NaN);
    }
    case 'unary': {
      const operand = compileExpr(expr.operand, variables);
      if (expr.operator === '-') return (scope) => -operand(scope);
      if (expr.operator === '!') return (scope) => 1 - truth(operand(scope));
      return operand;
    }
    case 'binary': {
      const left = compileExpr(expr.left, variables);
      const right = compileExpr(expr.right, variables);
      const position = expr.position;
      switch (expr.operator) {
        case '+':
          return (s) => left(s) + right(s);
        case '-':
          return (s) => left(s) - right(s);
        case '*':
          return (s) => left(s) * right(s);
        case '/':
          return (s) => left(s) / right(s);
        case '%':
          return (s) => left(s) % right(s);
        case '^':
          return (s) => Math.pow(left(s), right(s));
        case '<':
          return (s) => (left(s) < right(s) ? 1 : 0);
        case '<=':
          return (s) => (left(s) <= right(s) ? 1 : 0);
        case '>':
          return (s) => (left(s) > right(s) ? 1 : 0);
        case '>=':
          return (s) => (left(s) >= right(s) ? 1 : 0);
        case '==':
          return (s) => (left(s) === right(s) ? 1 : 0);
        case '!=':
          return (s) => (left(s) !== right(s) ? 1 : 0);
        case '&&':
          return (s) => (truth(left(s)) ? truth(right(s)) : 0);
        case '||':
          return (s) => (truth(left(s)) ? 1 : truth(right(s)));
      }
      // The switch is exhaustive; this satisfies noImplicitReturns.
      throw new ExpressionError('Unknown operator', position);
    }
    case 'call': {
      if (!Object.hasOwn(FUNCTIONS, expr.name)) {
        throw new ExpressionError(`Unknown function "${expr.name}"`, expr.position);
      }
      const spec = FUNCTIONS[expr.name]!;
      const [min, max] = typeof spec.arity === 'number' ? [spec.arity, spec.arity] : spec.arity;
      if (expr.args.length < min || expr.args.length > max) {
        const expected = min === max ? `${min}` : `${min} to ${max}`;
        throw new ExpressionError(
          `${expr.name} takes ${expected} argument${max === 1 ? '' : 's'}, got ${expr.args.length}`,
          expr.position,
        );
      }
      const args = expr.args.map((arg) => compileExpr(arg, variables));
      const fn = spec.fn;
      if (args.length === 1) {
        const [a] = args as [Evaluator];
        return (s) => fn(a(s));
      }
      if (args.length === 2) {
        const [a, b] = args as [Evaluator, Evaluator];
        return (s) => fn(a(s), b(s));
      }
      return (s) => fn(...args.map((arg) => arg(s)));
    }
    case 'conditional': {
      const test = compileExpr(expr.test, variables);
      const consequent = compileExpr(expr.consequent, variables);
      const alternate = compileExpr(expr.alternate, variables);
      return (s) => (truth(test(s)) ? consequent(s) : alternate(s));
    }
  }
}

/** Names of the variables an expression reads, in first-use order. */
export function collectVariables(expr: Expr, out: string[] = []): string[] {
  switch (expr.kind) {
    case 'variable':
      if (!Object.hasOwn(CONSTANTS, expr.name) && !out.includes(expr.name)) out.push(expr.name);
      break;
    case 'unary':
      collectVariables(expr.operand, out);
      break;
    case 'binary':
      collectVariables(expr.left, out);
      collectVariables(expr.right, out);
      break;
    case 'call':
      expr.args.forEach((arg) => collectVariables(arg, out));
      break;
    case 'conditional':
      collectVariables(expr.test, out);
      collectVariables(expr.consequent, out);
      collectVariables(expr.alternate, out);
      break;
    case 'number':
      break;
  }
  return out;
}
