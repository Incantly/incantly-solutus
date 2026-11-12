/**
 * Check-time hooks of the geometry commands (errors design 5.0): a literal argument that can never work, or an
 * argument of a kind the command has no form for, is an error on the line instead of an undefined object
 * (points-lines, conics and polygons-transforms errors.md, "check time" rows). A value that is not a literal is left
 * to the rule, which gives the object an undefined reason.
 */
import type { ArgFacts, CallCheck, FormCheck, ParamSpec, Refusal } from '../../language/table';
import type { RuleWork } from '../../graph/registry';
import type { FunctionValue } from '../../language/runtime';
import { detectPolynomial } from '../functions/numeric';
import { sample1 } from '../functions/sample';
import { MAX_POLYGON_SIDES } from './polygons';
import { T_LINE_LIKE } from './types';

type Check = (c: FormCheck) => Refusal | undefined;

/** True or false when the value is a one-variable function that is, or is not, a polynomial; `undefined` when unknown. */
function isPolynomial(v: unknown): boolean | undefined {
  const fv = v as FunctionValue | undefined;
  if (typeof fv !== 'object' || fv === null || fv.arity !== 1 || typeof fv.call !== 'function') return undefined;
  let used = 0;
  const cap = 100_000;
  const work: RuleWork = {
    limit: cap,
    get used(): number {
      return used;
    },
    get left(): number {
      return Math.max(0, cap - used);
    },
    spend(n = 1): boolean {
      used += n;
      return used <= cap;
    },
  };
  try {
    const det = detectPolynomial(sample1(fv).f, 0, 1e-9, work);
    if (det.spent) return undefined;
    return det.degree !== null && det.coeffs !== undefined;
  } catch {
    return undefined;
  }
}
type Refuse = (c: CallCheck) => Refusal | undefined;

const num = (a: ArgFacts | undefined): number | undefined => (a !== undefined && typeof a.literal === 'number' ? a.literal : undefined);

/** A literal index must be a whole number from `lo` to `hi` (`hi` may be `Infinity`). */
const wholeIn = (param: number, lo: number, hi: number, what: string): Check => (c) => {
  const v = num(c.args[param]);
  if (v === undefined) return undefined;
  if (Number.isInteger(v) && v >= lo && v <= hi) return undefined;
  const range = hi === Infinity ? `a whole number from ${lo} up` : lo === hi ? `${lo}` : `a whole number from ${lo} to ${hi}`;
  return {
    kind: 'bad_argument',
    message: `${c.command}: ${what} must be ${range}; got ${c.args[param]?.text ?? ''}.`,
    hint: lo === 1 ? 'Indexes start at 1.' : `Use ${range}.`,
    param,
  };
};

const indexOf = (params: readonly ParamSpec[], name: string): number => params.findIndex((p) => p.name === name);

/** The check-time hook for one form, chosen by the command and the form's parameters; `undefined` when it has none. */
export function formCheckFor(command: string, params: readonly ParamSpec[]): Check | undefined {
  if (command === 'Intersect' && params.length === 2) {
    // every crossing of two functions can be found without an interval only when both are polynomials
    return (c) => {
      const [f, g] = c.args;
      if (!f || !g || !f.type.startsWith('Function') || !g.type.startsWith('Function')) return undefined;
      const other = [f, g].find((a) => isPolynomial(a.value) === false);
      if (!other) return undefined;
      return {
        kind: 'no_matching_form',
        message: `Intersect: ${other.text} is not a polynomial, so the crossings need an interval to search.`,
        hint: `Give the interval: Intersect(${f.text}, ${g.text}, a, b), for example Intersect(${f.text}, ${g.text}, -10, 10).`,
        params: { command: c.command, given: `${f.type}, ${g.type}` },
      };
    };
  }
  const index = indexOf(params, 'index');
  if (index >= 0) {
    if (command === 'Vertex' && params[0]?.type === 'Segment') return wholeIn(index, 1, 2, 'the index of a segment end');
    // Two line-likes cross at most once, so the only slot is 1.
    if (command === 'Intersect' && params[0]?.type === T_LINE_LIKE && params[1]?.type === T_LINE_LIKE) return wholeIn(index, 1, 1, 'the index of a crossing of two lines');
    if ((command === 'Side' || command === 'Vertex') && params[0]?.name === 'poly') {
      // the polygon behind a name says how many corners there are: a literal index above that can never work
      const whole = wholeIn(index, 1, Infinity, 'the index');
      return (c) => {
        const r = whole(c);
        if (r) return r;
        const v = num(c.args[index]);
        const pts = (c.args[0]?.value as { pts?: unknown } | undefined)?.pts;
        if (v === undefined || !Array.isArray(pts) || v <= pts.length) return undefined;
        return {
          kind: 'bad_argument',
          message: `${c.command}: ${c.args[0]?.text ?? 'the polygon'} has ${pts.length} ${command === 'Side' ? 'sides' : 'corners'}; got index ${c.args[index]?.text ?? ''}.`,
          hint: `Use a whole number from 1 to ${pts.length}.`,
          param: index,
        };
      };
    }
    return wholeIn(index, 1, Infinity, 'the index');
  }
  if (command === 'TriangleCenter') return wholeIn(indexOf(params, 'n'), 1, 13, 'the centre number');
  if (command === 'Circle' && params.length === 2 && params[1]?.name === 'radius') {
    return (c) => {
      const r = num(c.args[1]);
      if (r === undefined || !(r < 0)) return undefined;
      return { kind: 'bad_argument', message: `Circle: the radius must not be negative; got ${c.args[1]?.text ?? ''}.`, hint: 'Use a radius of 0 or more.', param: 1 };
    };
  }
  if (command === 'Conic' && params.length === 1 && params[0]?.name === 'coeffs') {
    return (c) => {
      const list = c.args[0]?.literal;
      if (!Array.isArray(list) || list.length === 6) return undefined;
      return {
        kind: 'bad_argument',
        message: `Conic: the list must hold 6 coefficients; got ${list.length}.`,
        hint: 'The coefficients are a, b, c, d, e, f of a x^2 + b x y + c y^2 + d x + e y + f = 0.',
        param: 0,
      };
    };
  }
  if (command === 'Conic' && params.length === 1 && params[0]?.name === 'equation') {
    return (c) => {
      const eq = c.args[0];
      if (!eq || eq.relation === undefined || eq.relation === 'line' || eq.relation === 'circle' || eq.relation === 'conic') return undefined;
      if (eq.relation === 'region') {
        return { kind: 'bad_equation', message: 'Conic needs an equation, written with ==.', hint: `${eq.text} is an inequality. Write the two sides with == between them.`, param: 0 };
      }
      // x or y inside a function call is not a polynomial at all; otherwise the degree is above 2
      if (/[A-Za-z_][A-Za-z_0-9]*\s*\([^()]*\b[xy]\b/.test(eq.text)) {
        return { kind: 'not_polynomial', message: 'Conic needs a polynomial in x and y.', hint: 'Keep x and y out of functions such as sin or sqrt. Curve(…) draws other equations.', param: 0 };
      }
      return { kind: 'not_quadratic', message: 'Conic needs an equation of degree 2 in x and y.', hint: 'The highest power here is above 2. Curve(…) draws equations of higher degree.', param: 0 };
    };
  }
  const sides = indexOf(params, 'sides');
  if (command === 'Polygon' && sides >= 0) {
    return (c) => {
      const n = num(c.args[sides]);
      if (n === undefined) return undefined;
      if (n > MAX_POLYGON_SIDES) {
        return {
          kind: 'limit',
          message: `That would exceed the limit of ${MAX_POLYGON_SIDES} sides.`,
          params: { max: MAX_POLYGON_SIDES, what: 'sides' },
          param: sides,
        };
      }
      if (Number.isInteger(n) && n >= 3) return undefined;
      return { kind: 'bad_argument', message: `Polygon: the number of sides must be a whole number of 3 or more; got ${c.args[sides]?.text ?? ''}.`, hint: 'A polygon has at least 3 sides.', param: sides };
    };
  }
  return undefined;
}

const article = (type: string): string => (/^[AEIOU]/.test(type) ? 'an' : 'a');

/** Types that are certainly not a path or a region, so the refusal is not a guess about an unknown argument. */
const PLAIN = new Set(['Number', 'Text', 'Bool', 'Point', 'Vector']);

/** The hook for arguments that fit no form of a command; `undefined` when the command has none. */
export function refuseFor(command: string): Refuse | undefined {
  switch (command) {
    case 'PointOn':
      return (c) => {
        const a = c.args[0];
        if (a === undefined || c.args.length > 2 || !PLAIN.has(a.type)) return undefined;
        return {
          kind: 'not_a_path',
          message: 'PointOn needs a line, segment, circle, conic, polygon, function or curve.',
          hint: `${a.text} is ${article(a.type)} ${a.type}. Make the path first, then put the point on it.`,
          param: 0,
        };
      };
    case 'Conic':
      return (c) => {
        const a = c.args[0];
        if (c.args.length !== 1 || a === undefined || a.text.includes('==') || (a.type !== 'Number' && a.type !== '')) return undefined;
        return {
          kind: 'bad_equation',
          message: 'Conic needs an equation, written with ==.',
          hint: `${a.text} has no ==. Write both sides, for example ${a.text} == 1.`,
          param: 0,
        };
      };
    case 'PointIn':
      return (c) => {
        const a = c.args[0];
        if (a === undefined || (c.args.length !== 1 && c.args.length !== 3) || a.type === '') return undefined;
        return {
          kind: 'not_a_region',
          message: 'PointIn needs a polygon, circle, conic or sector.',
          hint: `${a.text} is ${article(a.type)} ${a.type}, which has no inside.`,
          param: 0,
        };
      };
    case 'Polygon':
      return (c) => {
        if (c.args.length !== 2 || !c.args.every((a) => a.type === 'Point')) return undefined;
        const [a, b] = c.args as [ArgFacts, ArgFacts];
        return {
          kind: 'too_few_points',
          message: 'Polygon needs at least 3 points; got 2.',
          hint: `Two points make a segment: Segment(${a.text}, ${b.text}).`,
        };
      };
    case 'Reflect':
      return (c) => {
        const shape = c.args[0];
        const mirror = c.args[1];
        if (shape === undefined || mirror === undefined || c.args.length !== 2 || mirror.type !== 'Circle' || shape.type === '') return undefined;
        return {
          kind: 'not_supported',
          message: `Reflect in a circle works on points, lines and circles; the image of ${article(shape.type)} ${shape.type} is not supported.`,
          hint: 'Invert the points of the shape, or a line through them, instead.',
          param: 0,
        };
      };
    case 'Move':
      return (c) => {
        const t = c.args[1];
        if (t === undefined || c.args.length !== 2 || t.type === '' || t.type === 'Transform') return undefined;
        return {
          kind: 'not_a_transform',
          message: `Move needs a transform as its second argument; ${t.text} is ${article(t.type)} ${t.type}.`,
          hint: 'Make one with Shift, Turn, Mirror or Scale, or use Translate, Rotate, Reflect or Dilate directly.',
          param: 1,
        };
      };
    default:
      return undefined;
  }
}
