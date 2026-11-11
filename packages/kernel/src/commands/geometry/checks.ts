/**
 * Check-time hooks of the geometry commands (errors design 5.0): a literal argument that can never work, or an
 * argument of a kind the command has no form for, is an error on the line instead of an undefined object
 * (points-lines, conics and polygons-transforms errors.md, "check time" rows). A value that is not a literal is left
 * to the rule, which gives the object an undefined reason.
 */
import type { ArgFacts, CallCheck, FormCheck, ParamSpec, Refusal } from '../../language/table';
import { MAX_POLYGON_SIDES } from './polygons';
import { T_LINE_LIKE } from './types';

type Check = (c: FormCheck) => Refusal | undefined;
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
  const index = indexOf(params, 'index');
  if (index >= 0) {
    if (command === 'Vertex' && params[0]?.type === 'Segment') return wholeIn(index, 1, 2, 'the index of a segment end');
    // Two line-likes cross at most once, so the only slot is 1.
    if (command === 'Intersect' && params[0]?.type === T_LINE_LIKE && params[1]?.type === T_LINE_LIKE) return wholeIn(index, 1, 1, 'the index of a crossing of two lines');
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
