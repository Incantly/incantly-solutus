import type { Formula, FormulaOptions, Param } from '../api/types';
import { compileExpression } from '../expr';
import { SceneApiError } from '../scene/errors';

/**
 * Builds a callable formula. `x` and `t` are always available; other names
 * are bound to parameters or numbers through `vars`.
 */
export function createFormula(
  source: string,
  options: FormulaOptions | undefined,
  params: ReadonlySet<Param>,
  time: () => number,
): Formula {
  if (typeof source !== 'string') throw new SceneApiError('inc.formula needs the formula as a string');
  const vars = options?.vars ?? {};
  const names = Object.keys(vars);
  for (const name of names) {
    if (name === 'x' || name === 't') throw new SceneApiError(`"${name}" is reserved in formulas`);
    const value = vars[name];
    const ok = typeof value === 'number' ? Number.isFinite(value) : params.has(value as Param);
    if (!ok) throw new SceneApiError(`Formula variable "${name}" must be a parameter or a finite number`);
  }
  const compiled = compileExpression(source, ['x', 't', ...names]);
  const scope: Record<string, number> = Object.create(null) as Record<string, number>;
  const bind = () => {
    for (const name of names) {
      const value = vars[name];
      scope[name] = typeof value === 'number' ? value : (value as Param).value;
    }
  };
  const formula = (x: number, t: number = time()) => {
    bind();
    scope.x = x;
    scope.t = t;
    return compiled.evaluate(scope);
  };
  Object.defineProperties(formula, {
    source: { value: source, enumerable: true },
    variables: { value: Object.freeze([...compiled.variables]), enumerable: true },
    evaluate: {
      value: (extra: Readonly<Record<string, number>>) => {
        bind();
        const merged: Record<string, number> = Object.assign(Object.create(null) as Record<string, number>, scope);
        for (const [key, value] of Object.entries(extra)) merged[key] = value;
        return compiled.evaluate(merged);
      },
    },
  });
  return Object.freeze(formula) as unknown as Formula;
}
