/**
 * A machine-readable description of the v0.1 scene API.
 *
 * The validator uses it to reject unknown SDK calls, and the runtime tests use
 * it to prove the implementation exposes exactly this surface. The `satisfies`
 * clauses make the TypeScript compiler fail if this file and `types.ts` drift.
 */
import type {
  Arrow3D,
  Body2D,
  Calculus,
  Chart,
  ChartSeries,
  Choice,
  ColorParam,
  Dots,
  Flow,
  FlowEdge,
  FlowNode,
  Formula,
  GeometryHelpers,
  Graph,
  GraphArrow,
  GraphCurve,
  GraphPoint,
  GraphSegment,
  GraphMark,
  GraphTrail,
  Graph3D,
  Group3D,
  Handle,
  Inc,
  Joint2D,
  Label3D,
  Line,
  Line3D,
  MotionHelpers,
  Object3D,
  Param,
  PathHandle,
  PathHelpers,
  Point,
  PolylineHandle,
  Segment,
  ShapeHelpers,
  Space3D,
  Stage,
  State,
  Surface3D,
  Tank2D,
  TextHandle,
  Toggle,
  Tone,
  Units,
  VectorHelpers,
  World2D,
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
  | 'GraphMark'
  | 'Formula'
  | 'Point'
  | 'Line'
  | 'Segment'
  | 'Space3D'
  | 'Graph3D'
  | 'Object3D'
  | 'Group3D'
  | 'Line3D'
  | 'Arrow3D'
  | 'Label3D'
  | 'Surface3D'
  | 'World2D'
  | 'Body2D'
  | 'Joint2D'
  | 'Tank2D'
  | 'Chart'
  | 'ChartSeries'
  | 'Flow'
  | 'FlowNode'
  | 'FlowEdge';

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

const object3dMethods = {
  at: 'self',
  rotate: 'self',
  orient: 'self',
  scale: 'self',
  tone: 'self',
  show: 'self',
  hide: 'self',
  screen: null,
} as const satisfies Methods<Object3D>;

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
  layout: null,
  steps: null,
  explain: null,
  describe: null,
  predict: null,
  compare: null,
  svg: 'Stage',
  graph2d: 'Graph',
  space3d: 'Space3D',
  graph3d: 'Graph3D',
  physics2d: 'World2D',
  chart: 'Chart',
  flow: 'Flow',
  formula: 'Formula',
  random: null,
  tween: null,
  idle: null,
  sym: null,
  chem: null,
} as const satisfies Methods<Inc>;

export const INC_NAMESPACES = {
  state: {
    get: null,
    set: null,
    on: null,
  } satisfies Methods<State>,
  path: {
    line: null,
    polyline: null,
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
  calc: {
    derivative: null,
    integral: null,
    root: null,
    roots: null,
    extrema: null,
    interp: null,
    euler: null,
    rk4: null,
    normal: null,
    normalCdf: null,
    clamp: null,
    lerp: null,
    map: null,
    noise: null,
  } satisfies Methods<Calculus>,
  vec: {
    add: null,
    sub: null,
    scale: null,
    dot: null,
    cross: null,
    length: null,
    normalize: null,
    rotate: null,
    angle: null,
    lerp: null,
    rotA: null,
    mul: null,
    apply: null,
  } satisfies Methods<VectorHelpers>,
  units: {
    format: null,
    convert: null,
  } satisfies Methods<Units>,
  motion: {
    follow: null,
    spring: null,
    tour: null,
    ease: null,
    wave: null,
  } satisfies Methods<MotionHelpers>,
  shapes: {
    spring: null,
    zigzag: null,
    resistor: null,
    coil: null,
    wave: null,
    gear: null,
    hull: null,
    lens: null,
    battery: null,
    capacitor: null,
    ground: null,
    bulb: null,
    switch: null,
    tank: null,
    brace: null,
    blob: null,
    polygon: null,
    regular: null,
  } satisfies Methods<ShapeHelpers>,
} as const satisfies Record<'state' | 'path' | 'geom' | 'calc' | 'vec' | 'units' | 'motion' | 'shapes', Record<string, Returns>>;

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
      equation: 'Text',
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
  Element: { methods: elementMethods, properties: { handle: 'Element' } },
  Path: { methods: { ...elementMethods, d: 'self' } satisfies Methods<PathHandle>, properties: { handle: 'Path' } },
  Text: { methods: { ...elementMethods, text: 'self' } satisfies Methods<TextHandle>, properties: { handle: 'Text' } },
  Polyline: {
    methods: { ...elementMethods, points: 'self' } satisfies Methods<PolylineHandle>,
    properties: { handle: 'Polyline' },
  },
  Graph: {
    methods: {
      toX: null,
      toY: null,
      plot: 'Curve',
      plotX: 'Curve',
      polar: 'Curve',
      parametric: 'Curve',
      scatter: 'Curve',
      bars: 'Curve',
      histogram: 'Curve',
      area: 'Curve',
      between: 'Curve',
      field: 'Curve',
      slopes: 'Curve',
      implicit: 'Curve',
      point: 'GraphPoint',
      segment: 'GraphSegment',
      arrow: 'GraphArrow',
      trail: 'GraphTrail',
      label: 'Text',
      equation: 'Text',
      bracket: 'GraphMark',
      dimension: 'GraphMark',
      trace: 'GraphPoint',
      handle: 'GraphPoint',
      drag: null,
      part: 'argument',
      marks: null,
      crossings: null,
    } satisfies Methods<Graph>,
    properties: { stage: 'Stage' } satisfies Properties<Graph>,
  },
  Curve: {
    methods: { show: 'self', hide: 'self', tone: 'self', reveal: 'self' } satisfies Methods<GraphCurve>,
    properties: { handle: 'Path' } satisfies Properties<GraphCurve>,
  },
  GraphPoint: {
    methods: { at: 'self', show: 'self', hide: 'self', tone: 'self' } satisfies Methods<GraphPoint>,
    properties: { handle: 'Element' } satisfies Properties<GraphPoint>,
  },
  GraphSegment: {
    methods: { between: 'self', show: 'self', hide: 'self', tone: 'self' } satisfies Methods<GraphSegment>,
    properties: { handle: 'Element' } satisfies Properties<GraphSegment>,
  },
  GraphArrow: {
    methods: { from: 'self', show: 'self', hide: 'self', tone: 'self' } satisfies Methods<GraphArrow>,
    properties: { handle: 'Path' } satisfies Properties<GraphArrow>,
  },
  GraphTrail: {
    methods: { add: 'self', clear: 'self' } satisfies Methods<GraphTrail>,
    properties: { handle: 'Polyline' } satisfies Properties<GraphTrail>,
  },
  GraphMark: {
    methods: { between: 'self', text: 'self', show: 'self', hide: 'self', tone: 'self' } satisfies Methods<GraphMark>,
    properties: { handle: 'Path' } satisfies Properties<GraphMark>,
  },
  Formula: {
    methods: { evaluate: null } satisfies Methods<Formula>,
    properties: { source: null, variables: null } satisfies Properties<Formula>,
    callable: true,
  },
  Point: { methods: {}, properties: { x: null, y: null } satisfies Properties<Point> },
  Line: { methods: {}, properties: { a: 'Point', b: 'Point' } satisfies Properties<Line> },
  Segment: { methods: {}, properties: { from: 'Point', to: 'Point' } satisfies Properties<Segment> },
  Space3D: {
    methods: {
      box: 'Object3D',
      sphere: 'Object3D',
      cylinder: 'Object3D',
      cone: 'Object3D',
      plane: 'Object3D',
      torus: 'Object3D',
      tube: 'Object3D',
      mesh: 'Object3D',
      group: 'Group3D',
      line: 'Line3D',
      arrow: 'Arrow3D',
      coil: 'Line3D',
      arc: 'Line3D',
      point: 'Object3D',
      label: 'Label3D',
      grid: 'Object3D',
      axes: 'Group3D',
      fieldLines: 'Group3D',
      part: 'argument',
      drag: 'argument',
      pick: null,
      camera: null,
      view: null,
      project: null,
    } satisfies Methods<Space3D>,
    properties: { stage: 'Stage' } satisfies Properties<Space3D>,
  },
  Graph3D: {
    methods: {
      surface: 'Surface3D',
      parametric: 'Surface3D',
      curve: 'Line3D',
      point: 'Object3D',
      vector: 'Arrow3D',
      line: 'Line3D',
      plane: 'Surface3D',
      label: 'Label3D',
      part: 'argument',
      camera: null,
      view: null,
      project: null,
    } satisfies Methods<Graph3D>,
    properties: { stage: 'Stage' } satisfies Properties<Graph3D>,
  },
  Object3D: { methods: object3dMethods, properties: {} },
  Group3D: { methods: { ...object3dMethods, explode: 'self' } satisfies Methods<Group3D>, properties: {} },
  Line3D: { methods: { ...object3dMethods, points: 'self' } satisfies Methods<Line3D>, properties: {} },
  Arrow3D: { methods: { ...object3dMethods, set: 'self', label: 'self' } satisfies Methods<Arrow3D>, properties: {} },
  Label3D: {
    methods: { at: 'self', text: 'self', tone: 'self', show: 'self', hide: 'self' } satisfies Methods<Label3D>,
    properties: {},
  },
  Surface3D: { methods: { ...object3dMethods, section: 'Line3D' } satisfies Methods<Surface3D>, properties: {} },
  World2D: {
    methods: {
      ball: 'Body2D',
      box: 'Body2D',
      polygon: 'Body2D',
      ramp: 'Body2D',
      spring: 'Joint2D',
      rope: 'Joint2D',
      rod: 'Joint2D',
      hinge: 'Joint2D',
      pulley: 'Joint2D',
      tank: 'Tank2D',
      field: null,
      forces: null,
      onHit: null,
      onTouch: null,
      energy: null,
      restart: null,
      toStage: null,
    } satisfies Methods<World2D>,
    properties: { time: null, stage: 'Stage' } satisfies Properties<World2D>,
  },
  Body2D: {
    methods: { force: null, place: 'self', velocity: 'self', push: 'self', tone: 'self', show: 'self', hide: 'self' } satisfies Methods<Body2D>,
    properties: { x: null, y: null, angle: null, vx: null, vy: null, speed: null, mass: null, handle: 'Element' } satisfies Properties<Body2D>,
  },
  Joint2D: {
    methods: { setLength: 'self', show: 'self', hide: 'self' } satisfies Methods<Joint2D>,
    properties: { tension: null, length: null, handle: 'Element' } satisfies Properties<Joint2D>,
  },
  Tank2D: {
    methods: { buoyancy: null } satisfies Methods<Tank2D>,
    properties: { level: null, displaced: null, handle: 'Path' } satisfies Properties<Tank2D>,
  },
  Chart: {
    methods: { series: 'ChartSeries', points: 'ChartSeries', rule: 'Element', highlight: null } satisfies Methods<Chart>,
    properties: { stage: 'Stage' } satisfies Properties<Chart>,
  },
  ChartSeries: {
    methods: { set: 'self', tone: 'self', show: 'self', hide: 'self' } satisfies Methods<ChartSeries>,
    properties: { name: null } satisfies Properties<ChartSeries>,
  },
  Flow: {
    methods: { node: 'FlowNode', edge: 'FlowEdge', active: null } satisfies Methods<Flow>,
    properties: { stage: 'Stage' } satisfies Properties<Flow>,
  },
  FlowNode: {
    methods: { label: 'self', tone: 'self', centre: null } satisfies Methods<FlowNode>,
    properties: { id: null } satisfies Properties<FlowNode>,
  },
  FlowEdge: {
    methods: { label: 'self', tone: 'self', dashed: 'self', flow: 'self' } satisfies Methods<FlowEdge>,
    properties: {},
  },
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
export const TONES = ['lo', 'mid', 'hi', 'lit', 'faint', 'a', 'b', 'c', 'water'] as const satisfies readonly Tone[];
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
