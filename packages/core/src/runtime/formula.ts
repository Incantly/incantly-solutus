import type { Formula, FormulaInput, FormulaOptions, Param } from '../api/types';
import { compileExpression, CONSTANTS, ExpressionError, type CompiledExpression } from '../expr';
import { SceneApiError } from '../scene/errors';

/** Longest formula a learner may type. */
export const MAX_FORMULA_LENGTH = 200;

/** A formula's own variable: x, or y for x = f(y), theta for r = f(theta), t for a parametric curve (G2-2). */
export const FORMULA_INPUTS: readonly FormulaInput[] = ['x', 'y', 'theta', 't'];

/**
 * One formula of a scene. Its compiled form can be replaced when the learner
 * edits the text (FM-2); everything holding the formula, such as a plotted
 * curve, sees the new one on the next frame.
 */
export class FormulaRecord {
  source: string;
  error: string | null = null;
  draft: string | null = null;
  compiled: CompiledExpression;
  /** Values bound from `vars`; names not there are looked up as parameters (FM-3). */
  private readonly scope: Record<string, number> = Object.create(null) as Record<string, number>;

  constructor(
    source: string,
    readonly label: string,
    readonly editable: boolean,
    private readonly vars: Readonly<Record<string, Param | number>>,
    private readonly params: () => ReadonlyMap<string, Param>,
    /** Its own variable: x, or y, theta or t (G2-2). */
    readonly input: FormulaInput = 'x',
  ) {
    this.source = source;
    this.compiled = compileExpression(source, this.allowedNames());
  }

  /** Names a formula may use: its own variable and t, its own variables, and every parameter declared so far, by its name (FM-3). */
  private allowedNames(): string[] {
    const names: string[] = [this.input, ...(this.input === 't' ? [] : ['t']), ...Object.keys(this.vars)];
    for (const name of this.params().keys()) if (!names.includes(name) && /^[A-Za-z_]\w*$/.test(name)) names.push(name);
    return names;
  }

  /** Tries the learner's text. Returns null when it compiled, or why it did not; the old formula stays in use. */
  edit(source: string): string | null {
    if (typeof source !== 'string') return 'The formula must be text';
    const text = source.trim();
    if (text === this.source) {
      this.error = null;
      this.draft = null;
      return null;
    }
    if (text.length > MAX_FORMULA_LENGTH) return this.reject(text, `Keep the formula under ${MAX_FORMULA_LENGTH} characters`);
    try {
      this.compiled = compileExpression(text, this.allowedNames());
    } catch (error) {
      const message = error instanceof ExpressionError ? `${error.message} at position ${error.position + 1}` : 'That is not a formula the figure can read';
      return this.reject(text, message);
    }
    this.source = text;
    this.error = null;
    this.draft = null;
    return null;
  }

  private reject(text: string, message: string): string {
    this.error = message;
    this.draft = text;
    return message;
  }

  /** The scope for one value of the formula's own variable at time t. A parametric formula's t is its parameter, not time. */
  bind(value: number, t: number): Record<string, number> {
    const scope = this.scope;
    for (const [name, bound] of Object.entries(this.vars)) scope[name] = typeof bound === 'number' ? bound : bound.value;
    for (const name of this.compiled.variables) {
      if (name === this.input || name === 't' || name in this.vars) continue;
      const param = this.params().get(name);
      if (param) scope[name] = param.value;
    }
    if (this.input !== 't') scope.t = t;
    scope[this.input] = value;
    return scope;
  }
}

/**
 * Builds a callable formula. `x` and `t` are always available; other names
 * are bound to parameters or numbers through `vars`.
 */
export function createFormula(
  source: string,
  options: FormulaOptions | undefined,
  params: ReadonlySet<Param>,
  time: () => number,
  register?: (record: FormulaRecord) => void,
  byName: () => ReadonlyMap<string, Param> = () => new Map(),
): Formula {
  if (typeof source !== 'string') throw new SceneApiError('inc.formula needs the formula as a string');
  const given = options?.vars ?? {};
  // A built-in constant bound to its own value, as { pi: Math.PI }, is the built-in already: it is left out.
  // Bound to another value, as an eccentricity named e, it is still an error, as reading it would read the constant.
  const vars = Object.fromEntries(
    Object.entries(given).filter(([name, value]) => !(Object.hasOwn(CONSTANTS, name) && typeof value === 'number' && Math.abs(value - CONSTANTS[name]!) < 1e-9)),
  ) as typeof given;
  const input = options?.input ?? 'x';
  if (!FORMULA_INPUTS.includes(input)) throw new SceneApiError(`A formula's input is ${FORMULA_INPUTS.join(', ')}, not "${String(input)}"`);
  const names = Object.keys(vars);
  for (const name of names) {
    if (name === input || name === 't') throw new SceneApiError(`"${name}" is reserved in formulas`);
    const value = vars[name];
    const ok = typeof value === 'number' ? Number.isFinite(value) : params.has(value as Param);
    if (!ok) throw new SceneApiError(`Formula variable "${name}" must be a parameter or a finite number`);
  }
  const label = options?.label ?? '';
  if (typeof label !== 'string' || label.length > 60) throw new SceneApiError('A formula label is a short piece of text');
  // Editable unless the scene says otherwise (FM-2): the learner may change a formula and see what follows.
  const record = new FormulaRecord(source, label, options?.editable !== false, vars, byName, input);
  register?.(record);
  const formula = (value: number, t: number = time()) => record.compiled.evaluate(record.bind(value, t));
  Object.defineProperties(formula, {
    source: { get: () => record.source, enumerable: true },
    variables: { get: () => Object.freeze([...record.compiled.variables]), enumerable: true },
    input: { value: input, enumerable: true },
    evaluate: {
      value: (extra: Readonly<Record<string, number>>) => {
        const scope = record.bind(Number.NaN, time());
        const merged: Record<string, number> = Object.assign(Object.create(null) as Record<string, number>, scope);
        for (const [key, value] of Object.entries(extra)) merged[key] = value;
        return record.compiled.evaluate(merged);
      },
    },
  });
  return Object.freeze(formula) as unknown as Formula;
}
