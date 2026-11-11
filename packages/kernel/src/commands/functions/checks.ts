/**
 * Check-time hooks of the functions area (errors design 5.0; functions-calculus errors 2; curves-loci errors 1).
 *
 * A rule can only make its object undefined. These hooks run while the line is checked, so a literal that can never
 * work (`Riemann(f, 0, 1, 0)`, `Taylor(f, 0, -1)`) and a function that the command cannot take (`Roots(f)` for a
 * non-polynomial) fail the line. A value that comes from a slider is not a literal: the rule still handles it and
 * the object goes undefined.
 */
import type { RuleWork } from '../../graph/registry';
import type { FunctionValue } from '../../language/runtime';
import type { ArgFacts, CommandForm, CommandSpec, FormCheck, Refusal } from '../../language/table';
import { detectPolynomial, detectRational } from './numeric';
import { sample1 } from './sample';

/** The arguments of one call, read by parameter name. */
interface Call {
  readonly command: string;
  arg(name: string): ArgFacts | undefined;
  index(name: string): number;
  num(name: string): number | undefined;
  text(name: string): string | undefined;
  list(name: string): readonly unknown[] | undefined;
}

type Check = (c: Call) => Refusal | undefined;

const CHECK_TOL = 1e-9;
const CHECK_STEPS = 200_000;

function budget(): RuleWork {
  let used = 0;
  return {
    limit: CHECK_STEPS,
    get used(): number {
      return used;
    },
    get left(): number {
      return Math.max(0, CHECK_STEPS - used);
    },
    spend(n = 1): boolean {
      used += n;
      return used <= CHECK_STEPS;
    },
  };
}

function bad(c: Call, name: string, message: string, hint?: string): Refusal {
  const i = c.index(name);
  return {
    kind: 'bad_argument',
    message,
    params: { command: c.command, why: message.replace(/\.$/, ''), param: name },
    ...(hint !== undefined ? { hint } : {}),
    ...(i >= 0 ? { param: i } : {}),
  };
}

function over(c: Call, name: string, limitName: string, max: number, got: number, what: string): Refusal {
  const i = c.index(name);
  return {
    kind: 'limit',
    message: `${c.command} takes at most ${max} ${what}; this line asks for ${got}.`,
    params: { max, what },
    limit: { name: limitName, max, got },
    hint: `Use ${max} ${what} or fewer.`,
    ...(i >= 0 ? { param: i } : {}),
  };
}

const whole = (v: number): boolean => Number.isInteger(v);

/* ------------------------------ sums ------------------------------ */

export const SUM_RULE_NAMES = ['left', 'right', 'mid', 'upper', 'lower', 'trapezoid', 'simpson'] as const;
export const MAX_SLICES = 100000;

const sliceCount: Check = (c) => {
  const n = c.num('n');
  if (n === undefined) return undefined;
  if (!whole(n) || n < 1) return bad(c, 'n', `The number of slices must be a whole number of 1 or more, not ${n}.`, 'Write a count such as 4 or 10.');
  if (n > MAX_SLICES) return over(c, 'n', 'slices', MAX_SLICES, n, 'slices');
  return undefined;
};

const sumRule: Check = (c) => {
  const rule = c.text('rule');
  if (rule !== undefined && !(SUM_RULE_NAMES as readonly string[]).includes(rule)) {
    return bad(c, 'rule', `"${rule}" is not a sum rule. The rules are ${SUM_RULE_NAMES.map((r) => `"${r}"`).join(', ')}.`);
  }
  const offset = c.num('offset');
  if (offset !== undefined && !(offset >= 0 && offset <= 1)) return bad(c, 'offset', `The offset is a fraction from 0 to 1, not ${offset}.`);
  return undefined;
};

/* ------------------------------ derivatives, series, limits ------------------------------ */

export const MAX_DERIVATIVE_ORDER = 20;
export const MAX_TAYLOR_ORDER = 40;
export const MAX_ITERATIONS = 100000;

/** Built-ins with no derivative rule (functions-calculus design 7.1). */
const NO_RULE = /(?<![A-Za-z0-9_])(noise|rand[A-Za-z0-9_]*|random[A-Za-z0-9_]*)\s*\(/;

const derivativeOrder: Check = (c) => {
  const n = c.num('n');
  if (n === undefined) return undefined;
  if (!whole(n) || n < 0) return bad(c, 'n', `The order must be a whole number from 0 to ${MAX_DERIVATIVE_ORDER}, not ${n}.`, 'Write 1 for the first derivative, 2 for the second.');
  if (n > MAX_DERIVATIVE_ORDER) return over(c, 'n', 'derivative order', MAX_DERIVATIVE_ORDER, n, 'as the order');
  return undefined;
};

const hasRule: Check = (c) => {
  const f = c.arg('f');
  if (!f) return undefined;
  // the body as written: the object's own line after the `=`, or the inline expression
  const body = f.source !== undefined ? f.source.slice(f.source.indexOf('=') + 1) : f.text;
  const m = NO_RULE.exec(body);
  if (!m) return undefined;
  const name = m[1] as string;
  const who = f.source !== undefined ? f.text : 'The expression';
  return {
    kind: 'not_differentiable',
    message: `${who} uses ${name}, which has no derivative rule.`,
    hint: `No derivative rule for ${name}. NDerivative(${f.text}) differentiates numerically.`,
    params: { command: c.command, why: `${who} uses ${name}, which has no derivative rule`, token: name },
    param: c.index('f'),
  };
};

const taylorOrder: Check = (c) => {
  const n = c.num('n');
  if (n === undefined) return undefined;
  if (!whole(n) || n < 0) return bad(c, 'n', `The order must be a whole number from 0 to ${MAX_TAYLOR_ORDER}, not ${n}.`);
  if (n > MAX_TAYLOR_ORDER) return over(c, 'n', 'Taylor order', MAX_TAYLOR_ORDER, n, 'as the order');
  return undefined;
};

const limitSide: Check = (c) => {
  const side = c.text('side');
  if (side !== undefined && side !== 'left' && side !== 'right') return bad(c, 'side', `"${side}" is not a side. The side is "left" or "right".`);
  return undefined;
};

const iterations: Check = (c) => {
  const n = c.num('n');
  if (n === undefined) return undefined;
  if (!whole(n) || n < 0) return bad(c, 'n', `The count must be a whole number of 0 or more, not ${n}.`);
  if (n > MAX_ITERATIONS) return over(c, 'n', 'iterations', MAX_ITERATIONS, n, 'steps');
  return undefined;
};

/* ------------------------------ commands that take a polynomial without an interval ------------------------------ */

function fnOf(a: ArgFacts | undefined): FunctionValue | undefined {
  const v = a?.value as FunctionValue | undefined;
  return typeof v === 'object' && v !== null && v.arity === 1 && typeof v.call === 'function' ? v : undefined;
}

function needsInterval(rationalToo: boolean): Check {
  return (c) => {
    const a = c.arg('f');
    const fv = fnOf(a);
    if (!a || !fv) return undefined;
    const work = budget();
    const s = sample1(fv);
    let fits: boolean;
    try {
      const det = detectPolynomial(s.f, 0, CHECK_TOL, work);
      if (det.spent) return undefined;
      fits = det.degree !== null && det.coeffs !== undefined;
      if (!fits && rationalToo) fits = detectRational(s.f, work) !== null;
    } catch {
      return undefined;
    }
    // a function that is undefined where it was sampled is the rule's business
    if (fits || !work.spend(0)) return undefined;
    const probe = s.f(0.37);
    if (probe !== probe && s.f(1.37) !== s.f(1.37)) return undefined;
    const takes = rationalToo ? 'polynomials and rational functions' : 'polynomials';
    const line = `${c.command}(${a.text}, -10, 10)`;
    return {
      kind: 'needs_interval',
      message: `${a.text} is not ${rationalToo ? 'a polynomial or a rational function' : 'a polynomial'}, so ${c.command} needs an interval.`,
      hint: `${c.command}(${a.text}) with no interval works for ${takes}. Write ${c.command}(${a.text}, a, b), for example ${line}.`,
      params: { command: c.command, why: `${a.text} needs an interval` },
    };
  };
}

/* ------------------------------ curves ------------------------------ */

export const MAX_BEZIER_POINTS = 12;
export const MAX_CONTOUR_LEVELS = 50;
export const FIT_POINT_COUNTS = [5, 9, 14, 20] as const;
export const SPLINE_KINDS = ['natural', 'centripetal'] as const;
export const MAX_ODE_VARIABLES = 16;

const paramRange: Check = (c) => {
  const a = c.num('a');
  const b = c.num('b');
  const inf = (v: number | undefined): boolean => v !== undefined && !Number.isFinite(v);
  if (inf(a) || inf(b)) {
    return {
      kind: 'missing_range',
      message: `${c.command} needs a finite range, and this one has no end.`,
      hint: 'Write a finite range, for example 0, tau for one full turn.',
      params: { command: c.command, why: 'the range has no end' },
      param: c.index(inf(a) ? 'a' : 'b'),
    };
  }
  if (a === undefined || b === undefined) return undefined;
  if (a === b) return bad(c, 'b', `The range from ${a} to ${b} is empty, so there is no curve to draw.`, 'Give two different ends, the low one first.');
  if (b < a) return bad(c, 'b', `The range runs backwards, from ${a} down to ${b}.`, `Write the low end first: ${b}, ${a}.`);
  return undefined;
};

const bezierPoints: Check = (c) => {
  const pts = c.list('pts');
  if (pts !== undefined && pts.length > MAX_BEZIER_POINTS) return over(c, 'pts', 'Bezier points', MAX_BEZIER_POINTS, pts.length, 'control points');
  return undefined;
};

const splineKind: Check = (c) => {
  const kind = c.text('kind');
  if (kind !== undefined && !(SPLINE_KINDS as readonly string[]).includes(kind)) {
    return bad(c, 'kind', `"${kind}" is not a spline kind. The kinds are "natural" and "centripetal".`);
  }
  return undefined;
};

const contourLevels: Check = (c) => {
  const levels = c.list('levels');
  if (levels !== undefined && levels.length > MAX_CONTOUR_LEVELS) return over(c, 'levels', 'contour levels', MAX_CONTOUR_LEVELS, levels.length, 'levels');
  return undefined;
};

const fitPoints: Check = (c) => {
  const pts = c.list('pts');
  if (pts === undefined || (FIT_POINT_COUNTS as readonly number[]).includes(pts.length)) return undefined;
  return bad(
    c, 'pts',
    `${pts.length} points do not fix one curve. Pass 5 points for a conic, 9 for a cubic, 14 for a quartic or 20 for a quintic.`,
    'Add or remove points to reach 5, 9, 14 or 20.',
  );
};

const odeSize: Check = (c) => {
  const n = c.list('rhs')?.length ?? c.list('init')?.length ?? c.list('vars')?.length;
  if (n !== undefined && n > MAX_ODE_VARIABLES) return over(c, c.index('rhs') >= 0 ? 'rhs' : 'init', 'ODE variables', MAX_ODE_VARIABLES, n, 'variables');
  return undefined;
};

/* ------------------------------ the table ------------------------------ */

const SUMS: readonly Check[] = [sliceCount, sumRule];
const CHECKS: Readonly<Record<string, readonly Check[]>> = {
  Riemann: SUMS, LeftSum: SUMS, RightSum: SUMS, UpperSum: SUMS, LowerSum: SUMS, RectangleSum: SUMS, TrapezoidalSum: SUMS,
  Derivative: [derivativeOrder, hasRule],
  Taylor: [taylorOrder], TaylorPolynomial: [taylorOrder],
  Limit: [limitSide],
  Iterate: [iterations], IterateList: [iterations], Cobweb: [iterations],
  Roots: [needsInterval(true)],
  Extremum: [needsInterval(false)], TurningPoint: [needsInterval(false)], Inflection: [needsInterval(false)],
  Curve: [paramRange, fitPoints],
  Polar: [paramRange],
  Bezier: [bezierPoints],
  Spline: [splineKind],
  Contours: [contourLevels],
  NSolveODE: [odeSize],
};

/** Commands whose one-argument form is the one that needs a polynomial. */
const ONE_ARG_ONLY = new Set(['Roots', 'Extremum', 'TurningPoint', 'Inflection']);

function hookFor(command: string, form: CommandForm, checks: readonly Check[]): (c: FormCheck) => Refusal | undefined {
  const names = form.params.map((p) => p.name);
  return (fc) => {
    const index = (name: string): number => names.indexOf(name);
    const arg = (name: string): ArgFacts | undefined => {
      const a = fc.args[index(name)];
      return a && !a.omitted ? a : undefined;
    };
    const call: Call = {
      command,
      index,
      arg,
      num: (name) => {
        const v = arg(name)?.literal;
        return typeof v === 'number' && v === v ? v : undefined;
      },
      text: (name) => {
        const v = arg(name)?.literal;
        return typeof v === 'string' ? v : undefined;
      },
      list: (name) => {
        const v = arg(name)?.literal;
        return Array.isArray(v) ? (v as readonly unknown[]) : undefined;
      },
    };
    for (const check of checks) {
      const r = check(call);
      if (r) return r;
    }
    return undefined;
  };
}

/** Attaches the area's check-time hooks to the forms of its commands. */
export function withChecks(specs: readonly CommandSpec[]): CommandSpec[] {
  return specs.map((s) => {
    const checks = CHECKS[s.name];
    if (!checks) return s;
    return {
      ...s,
      forms: s.forms.map((f) => (ONE_ARG_ONLY.has(s.name) && f.params.length !== 1 ? f : { ...f, check: hookFor(s.name, f, checks) })),
    };
  });
}
