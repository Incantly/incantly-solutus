/**
 * A machine-readable description of the v0.1 scene API.
 *
 * The validator uses it to reject unknown SDK calls, and the runtime tests use
 * it to prove the implementation exposes exactly this surface. The `satisfies`
 * clauses make the TypeScript compiler fail if this file and `types.ts` drift.
 */
import type {
  Choice,
  ColorParam,
  Dots,
  Formula,
  GeometryHelpers,
  Graph,
  GraphArrow,
  GraphCurve,
  GraphPoint,
  GraphSegment,
  GraphTrail,
  Handle,
  Inc,
  Line,
  Param,
  PathHandle,
  PathHelpers,
  Point,
  PolylineHandle,
  Segment,
  Stage,
  State,
  TextHandle,
  Toggle,
  Tone,
} from './types';

export const SDK_VERSION = '0.1.0';

/** Bumped when stored scenes would need migrating. */
export const SCENE_SCHEMA_VERSION = 1;

export type HandleKind =
  | 'Param'
  | 'Toggle'
  | 'Choice'
  | 'ColorParam'
  | 'Dots'
  | 'Model'
  | 'Stage'
  | 'Element'
  | 'Path'
  | 'Text'
  | 'Polyline'
  | 'Graph'
  | 'Curve'
  | 'GraphPoint'
  | 'GraphSegment'
  | 'GraphArrow'
  | 'GraphTrail'
  | 'Formula'
  | 'Point'
  | 'Line'
  | 'Segment';

/**
 * What a member returns: another handle kind, `self` for chainable methods,
 * `argument` when it returns the handle it was given, or null for a plain value.
 */
export type Returns = HandleKind | 'self' | 'argument' | null;

export interface HandleSpec {
  readonly methods: Readonly<Record<string, Returns>>;
  readonly properties: Readonly<Record<string, Returns>>;
  /** Open handles (the model) expose scene-defined properties. */
  readonly open?: boolean;
  /** Callable handles (formulas). */
  readonly callable?: boolean;
}

type Methods<T> = { [K in keyof T as T[K] extends (...args: never[]) => unknown ? K : never]: Returns };
type Properties<T> = { [K in keyof T as T[K] extends (...args: never[]) => unknown ? never : K]: Returns };

const elementMethods = {
  set: 'self',
  at: 'self',
  rotate: 'self',
  scale: 'self',
  show: 'self',
  hide: 'self',
  tone: 'self',
  dashed: 'self',
  flow: 'self',
} as const satisfies Methods<Handle>;

export const INC_FUNCTIONS = {
  param: 'Param',
  toggle: 'Toggle',
  choice: 'Choice',
  color: 'ColorParam',
  button: null,
  presets: null,
  link: null,
  model: 'Model',
  onFrame: null,
  simulate: null,
  timeline: null,
  onReset: null,
  onParamChange: null,
  onStep: null,
  readout: null,
  table: null,
  idea: null,
  steps: null,
  explain: null,
  describe: null,
  predict: null,
  compare: null,
  svg: 'Stage',
  graph2d: 'Graph',
  formula: 'Formula',
  random: null,
  tween: null,
} as const satisfies Methods<Inc>;

export const INC_NAMESPACES = {
  state: {
    get: null,
    set: null,
    on: null,
  } satisfies Methods<State>,
  path: {
    line: null,
    curve: null,
    param: null,
    arc: null,
    arrow: null,
  } satisfies Methods<PathHelpers>,
  geom: {
    point: 'Point',
    midpoint: 'Point',
    distance: null,
    lineThrough: 'Line',
    intersect: 'Point',
    clipRay: 'Segment',
    clipLine: 'Segment',
  } satisfies Methods<GeometryHelpers>,
} as const satisfies Record<'state' | 'path' | 'geom', Record<string, Returns>>;

export const HANDLES: Readonly<Record<HandleKind, HandleSpec>> = {
  Param: {
    methods: {},
    properties: { name: null, value: null, min: null, max: null } satisfies Properties<Param>,
  },
  Toggle: {
    methods: {},
    properties: { name: null, value: null, min: null, max: null, on: null } satisfies Properties<Toggle>,
  },
  Choice: {
    methods: {},
    properties: { name: null, value: null, min: null, max: null, selected: null } satisfies Properties<Choice>,
  },
  ColorParam: {
    methods: {},
    properties: { name: null, value: null, min: null, max: null, tone: null } satisfies Properties<ColorParam>,
  },
  Dots: { methods: { set: 'self', tone: 'self' } satisfies Methods<Dots>, properties: {} },
  Model: { methods: {}, properties: {}, open: true },
  Stage: {
    methods: {
      group: 'Element',
      path: 'Path',
      line: 'Element',
      circle: 'Element',
      rect: 'Element',
      text: 'Text',
      polyline: 'Polyline',
      part: 'argument',
      drag: 'argument',
      connector: 'Path',
      callout: 'Text',
      repeat: null,
      dots: 'Dots',
    } satisfies Methods<Stage>,
    properties: { viewBox: null } satisfies Properties<Stage>,
  },
  Element: { methods: elementMethods, properties: {} },
  Path: { methods: { ...elementMethods, d: 'self' } satisfies Methods<PathHandle>, properties: {} },
  Text: { methods: { ...elementMethods, text: 'self' } satisfies Methods<TextHandle>, properties: {} },
  Polyline: {
    methods: { ...elementMethods, points: 'self' } satisfies Methods<PolylineHandle>,
    properties: {},
  },
  Graph: {
    methods: {
      toX: null,
      toY: null,
      plot: 'Curve',
      parametric: 'Curve',
      point: 'GraphPoint',
      segment: 'GraphSegment',
      arrow: 'GraphArrow',
      trail: 'GraphTrail',
      label: 'Text',
    } satisfies Methods<Graph>,
    properties: { stage: 'Stage' } satisfies Properties<Graph>,
  },
  Curve: {
    methods: { show: 'self', tone: 'self' } satisfies Methods<GraphCurve>,
    properties: { handle: 'Path' } satisfies Properties<GraphCurve>,
  },
  GraphPoint: {
    methods: { at: 'self', show: 'self', tone: 'self' } satisfies Methods<GraphPoint>,
    properties: { handle: 'Element' } satisfies Properties<GraphPoint>,
  },
  GraphSegment: {
    methods: { between: 'self', show: 'self', tone: 'self' } satisfies Methods<GraphSegment>,
    properties: { handle: 'Element' } satisfies Properties<GraphSegment>,
  },
  GraphArrow: {
    methods: { from: 'self', show: 'self', tone: 'self' } satisfies Methods<GraphArrow>,
    properties: { handle: 'Path' } satisfies Properties<GraphArrow>,
  },
  GraphTrail: {
    methods: { add: 'self', clear: 'self' } satisfies Methods<GraphTrail>,
    properties: { handle: 'Polyline' } satisfies Properties<GraphTrail>,
  },
  Formula: {
    methods: { evaluate: null } satisfies Methods<Formula>,
    properties: { source: null, variables: null } satisfies Properties<Formula>,
    callable: true,
  },
  Point: { methods: {}, properties: { x: null, y: null } satisfies Properties<Point> },
  Line: { methods: {}, properties: { a: 'Point', b: 'Point' } satisfies Properties<Line> },
  Segment: { methods: {}, properties: { from: 'Point', to: 'Point' } satisfies Properties<Segment> },
};

/** Pure Math members a scene may use. Math.random is excluded: use inc.random. */
export const ALLOWED_MATH = [
  'abs',
  'acos',
  'acosh',
  'asin',
  'asinh',
  'atan',
  'atan2',
  'atanh',
  'cbrt',
  'ceil',
  'cos',
  'cosh',
  'exp',
  'expm1',
  'floor',
  'hypot',
  'log',
  'log10',
  'log1p',
  'log2',
  'max',
  'min',
  'pow',
  'round',
  'sign',
  'sin',
  'sinh',
  'sqrt',
  'tan',
  'tanh',
  'trunc',
  'PI',
  'E',
  'LN2',
  'LN10',
  'LOG2E',
  'LOG10E',
  'SQRT1_2',
  'SQRT2',
] as const;

export const ALLOWED_NUMBER = [
  'isFinite',
  'isInteger',
  'isNaN',
  'parseFloat',
  'EPSILON',
  'MAX_SAFE_INTEGER',
  'MIN_SAFE_INTEGER',
  'MAX_VALUE',
  'MIN_VALUE',
  'POSITIVE_INFINITY',
  'NEGATIVE_INFINITY',
] as const;

/** Theme tones, the only way a scene picks a colour. */
export const TONES = ['lo', 'mid', 'hi', 'lit', 'faint', 'a', 'b', 'c'] as const satisfies readonly Tone[];
// Fails to compile if a tone is added to the type but not to the list.
const _everyTone: Exclude<Tone, (typeof TONES)[number]> extends never ? true : false = true;

/** Property names that lead to constructors, prototypes or other functions' internals. */
export const BLOCKED_PROPERTIES: ReadonlySet<string> = new Set([
  'constructor',
  'prototype',
  '__proto__',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  'caller',
  'callee',
  'arguments',
  'call',
  'apply',
  'bind',
]);

/** Free identifiers a scene may reference besides its own declarations. */
export const ALLOWED_GLOBALS = ['inc', 'Math', 'Number', 'isFinite', 'isNaN', 'Infinity', 'NaN', 'undefined'] as const;

/** Every handle kind named by the surface exists in HANDLES. */
export function referencedKinds(): HandleKind[] {
  const kinds = new Set<HandleKind>();
  const add = (r: Returns) => {
    if (r !== null && r !== 'self' && r !== 'argument') kinds.add(r);
  };
  Object.values(INC_FUNCTIONS).forEach(add);
  Object.values(INC_NAMESPACES).forEach((ns) => Object.values(ns).forEach(add));
  Object.values(HANDLES).forEach((spec) => {
    Object.values(spec.methods).forEach(add);
    Object.values(spec.properties).forEach(add);
  });
  return [...kinds];
}
