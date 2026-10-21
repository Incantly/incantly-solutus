import { collectVariables, compileExpr, type Evaluator } from './compile';
import { isReservedName } from './functions';
import { parseExpression } from './parser';
import { ExpressionError } from './tokens';

export { ExpressionError } from './tokens';
export { FUNCTIONS, CONSTANTS } from './functions';
export type { Scope } from './compile';

export interface CompiledExpression {
  readonly source: string;
  /** Variables the expression reads, in first-use order. */
  readonly variables: readonly string[];
  readonly evaluate: Evaluator;
}

/**
 * Parses and compiles a formula. `variables` lists every name the formula may
 * read; anything else is an error with a source position.
 */
export function compileExpression(source: string, variables: readonly string[]): CompiledExpression {
  for (const name of variables) {
    if (isReservedName(name)) {
      throw new ExpressionError(`"${name}" is a built-in name and cannot be a variable`, 0);
    }
  }
  const expr = parseExpression(source);
  const evaluate = compileExpr(expr, new Set(variables));
  return { source, variables: collectVariables(expr), evaluate };
}

export function tryCompileExpression(
  source: string,
  variables: readonly string[],
): { ok: true; value: CompiledExpression } | { ok: false; error: ExpressionError } {
  try {
    return { ok: true, value: compileExpression(source, variables) };
  } catch (error) {
    if (error instanceof ExpressionError) return { ok: false, error };
    throw error;
  }
}
