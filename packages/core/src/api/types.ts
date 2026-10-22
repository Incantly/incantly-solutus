/**
 * The public, scene-facing API of the Incantly SDK, version 0.1.
 *
 * Generated scenes reach the visualization environment only through the `inc`
 * object and the handles it returns. Nothing in this API returns a DOM node or
 * needs layout, so the same scene source runs in a Worker, in the main thread
 * or in Node (for the probe and the offline eval harness).
 */

/** Theme tones. Scenes never use literal colours. */
/** How a scene's panels sit together: side by side, one above another, or two by two. */
export type PanelLayout = 'row' | 'column' | 'grid';

/** Colours come only from tones; the theme gives each its light and dark value. `water` is for liquids. */
export type Tone = 'lo' | 'mid' | 'hi' | 'lit' | 'faint' | 'a' | 'b' | 'c' | 'water';

/** Shading for filled shapes: a lit ball, a lit cylinder or a soft top light. */
export type Shade = 'sphere' | 'cylinder' | 'soft';

export type Readable = string | number;

export type Vec2 = readonly [number, number];

export type Vec3 = readonly [number, number, number];

export type ViewBox = readonly [number, number, number, number];

/** Parameter values by name: what drags, buttons and presets set. */
export type Values = Readonly<Record<string, number>>;

// ---------------------------------------------------------------------------
// Parameters, model, frames
// ---------------------------------------------------------------------------

export interface ParamOptions {
  readonly min: number;
  readonly max: number;
  /** Authored default. */
  readonly value: number;
  readonly step?: number;
  readonly unit?: string;
  /** Display label. Defaults to the parameter name. */
  readonly label?: string;
  /** A short teaching note shown quietly beside the control. */
  readonly note?: string;
}

/** A learner-adjustable quantity. The engine builds its control. */
export interface Param {
  readonly name: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
}

export interface ToggleOptions {
  readonly value: boolean;
  readonly label?: string;
  readonly note?: string;
}

/** An on/off switch; its value is 1 or 0. */
export interface Toggle extends Param {
  readonly on: boolean;
}

export interface ChoiceOptions {
  readonly options: readonly string[];
  /** Index of the option chosen at first. */
  readonly value?: number;
  readonly label?: string;
  readonly note?: string;
  /** A row of buttons instead of a menu. */
  readonly buttons?: boolean;
}

/** One of several options; its value is the option's index. */
export interface Choice extends Param {
  readonly selected: string;
}

export interface ColorOptions {
  readonly value: Tone;
  readonly options?: readonly Tone[];
  readonly label?: string;
}

/** A tone the learner picks; its value is the index in `options`. */
export interface ColorParam extends Param {
  readonly tone: Tone;
}

/** Current parameter values by name. */
export type ParamValues = Readonly<Record<string, number>>;

/**
 * The single model of a scene. Reading a property returns the value computed
 * from the current parameters; it is recomputed when a parameter changes.
 */
export type Model<T extends object> = Readonly<T>;

export interface FrameInfo {
  /** Scene time in seconds. Does not advance while paused. */
  readonly time: number;
  /** Seconds since the previous frame; 0 for a paused redraw. */
  readonly dt: number;
  /** Position in the timeline's cycle, eased, from 0 to 1; 0 without a timeline. */
  readonly progress: number;
}

export interface TimelineOptions {
  /** Seconds per cycle. */
  readonly duration: number;
  readonly loop?: 'loop' | 'once' | 'pingpong';
  readonly ease?: Ease;
}

export interface SimulateOptions {
  /** Seconds per fixed step; default 1/120. */
  readonly step?: number;
}

export type StateValue = number | boolean | string;

/** Shared values: parameters by name, plus any the scene keeps. */
export interface State {
  get(key: string): StateValue | undefined;
  set(key: string, value: StateValue): void;
  /** Runs when the value changes, before the next frame. */
  on(key: string, callback: (value: StateValue) => void): void;
}

// ---------------------------------------------------------------------------
// Teaching
// ---------------------------------------------------------------------------

export interface Step {
  /** What the step says, shown outside the drawing. */
  readonly say: string;
  /** Name of a registered part to direct attention to. */
  readonly focus?: string;
  /** Parameter values to move to on this step. */
  readonly set?: Readonly<Record<string, number>>;
  /** Pause time while this step is shown. */
  readonly hold?: boolean;
}

/** Ask before revealing: the learner picks an answer, then the figure shows what happens. Never scored. */
export interface PredictOptions {
  readonly question: string;
  readonly options: readonly string[];
  /** Index of the right option, or a function of the model. */
  readonly answer: number | (() => number);
  /** Parameter values that show the answer. */
  readonly reveal?: Values;
  readonly explain?: string | (() => string);
}

export interface TableOptions {
  readonly title: string;
  readonly columns: readonly string[];
  /** Rows computed from the model. */
  readonly rows: () => ReadonlyArray<ReadonlyArray<Readable>>;
}

// ---------------------------------------------------------------------------
// SVG stage and element handles
// ---------------------------------------------------------------------------

export type Layer = 'back' | 'mid' | 'front' | 'labels';

export interface StageOptions {
  readonly viewBox: ViewBox;
  readonly title: string;
  readonly description?: string;
  /** Learners may zoom and pan; default true. */
  readonly zoom?: boolean;
}

export interface ElementOptions {
  readonly layer?: Layer;
  readonly tone?: Tone;
  readonly parent?: Group;
  readonly dashed?: boolean;
  /** Fill a path or polyline with its tone instead of stroking it; false outlines a circle or rect instead of filling it. */
  readonly fill?: boolean;
  readonly shade?: Shade;
}

/** Attributes a scene may set directly. Colours come only from tones. */
export type GeometryAttribute =
  | 'x'
  | 'y'
  | 'x1'
  | 'y1'
  | 'x2'
  | 'y2'
  | 'cx'
  | 'cy'
  | 'r'
  | 'rx'
  | 'ry'
  | 'width'
  | 'height'
  | 'd'
  | 'points'
  | 'stroke-width'
  | 'stroke-dasharray'
  | 'stroke-dashoffset'
  | 'stroke-linecap'
  | 'stroke-linejoin'
  | 'text-anchor'
  | 'dominant-baseline'
  | 'font-size'
  | 'opacity'
  | 'fill-opacity'
  | 'stroke-opacity';

export type AttributeValues = Readonly<Partial<Record<GeometryAttribute, number | string>>>;

export interface Handle {
  /** The element itself, as graph items have one: anything drawn can be passed as x.handle. */
  readonly handle: this;
  /** Writes attributes. Unchanged values cost nothing. */
  set(attributes: AttributeValues): this;
  at(x: number, y: number): this;
  rotate(degrees: number, cx?: number, cy?: number): this;
  scale(sx: number, sy?: number): this;
  show(visible?: boolean): this;
  hide(): this;
  tone(name: Tone): this;
  dashed(on?: boolean): this;
  /** Moves dashes along the stroke at `speed` units per second (current, flow); 0 stops. */
  flow(speed: number): this;
}

export interface PathHandle extends Handle {
  d(path: string): this;
}

export interface TextHandle extends Handle {
  text(value: Readable): this;
}

export interface PolylineHandle extends Handle {
  points(points: ReadonlyArray<Vec2>): this;
}

export type Group = Handle;

export interface PartOptions {
  readonly label?: string;
  readonly info?: string;
}

/** Where the pointer is during a drag, in the stage's units (a graph's data units). */
export interface DragInfo {
  readonly x: number;
  readonly y: number;
  readonly startX: number;
  readonly startY: number;
  readonly dx: number;
  readonly dy: number;
}

/** Turns a drag into parameter values. */
export type DragMap = (p: DragInfo) => Values | void;

export interface EquationOptions extends ElementOptions {
  /** Which side of the equation sits at x. Default 'middle'. */
  readonly anchor?: 'start' | 'middle' | 'end';
  /** Text size in stage units. Default 16. */
  readonly size?: number;
}

export interface ConnectorOptions {
  readonly tone?: Tone;
  readonly dashed?: boolean;
  /** Bends the line sideways by this many units. */
  readonly bend?: number;
  readonly arrow?: boolean;
  /** Space left at each end. */
  readonly gap?: number;
}

export interface CalloutOptions {
  /** Where the label sits relative to the element. */
  readonly dx?: number;
  readonly dy?: number;
  readonly tone?: Tone;
}

export interface DotsOptions {
  readonly tone?: Tone;
  readonly r?: number;
  readonly layer?: 'back' | 'front';
}

/** Many small dots (particles) drawn on a canvas sharing the stage's coordinates. */
export interface Dots {
  set(points: ReadonlyArray<Vec2>): this;
  tone(name: Tone): this;
}

export interface Stage {
  readonly viewBox: ViewBox;
  group(options?: ElementOptions): Group;
  path(d?: string, options?: ElementOptions): PathHandle;
  line(x1: number, y1: number, x2: number, y2: number, options?: ElementOptions): Handle;
  circle(cx: number, cy: number, r: number, options?: ElementOptions): Handle;
  rect(x: number, y: number, width: number, height: number, options?: ElementOptions): Handle;
  text(x: number, y: number, value: Readable, options?: ElementOptions): TextHandle;
  /**
   * An equation drawn as maths, centred on (x, y): fractions stack, powers
   * rise, roots and Greek letters show as written, such as
   * stage.equation(400, 40, 'F = G*m1*m2/r^2'). Its text() takes new source.
   */
  equation(x: number, y: number, source: Readable, options?: EquationOptions): TextHandle;
  polyline(points: ReadonlyArray<Vec2>, options?: ElementOptions): PolylineHandle;
  /** Registers a named part for highlighting, focus, steps and descriptions. */
  part<H extends Handle>(name: string, handle: H, options?: PartOptions): H;
  /** Lets the learner drag an element; `map` turns the pointer into parameter values. A later drag on the same element replaces the earlier one. */
  drag<H extends Handle>(handle: H, map: DragMap, options?: { readonly label?: string }): H;
  /** A line between two elements that follows them. */
  connector(a: Handle, b: Handle, options?: ConnectorOptions): PathHandle;
  /** A label with a leader line that follows an element. */
  callout(target: Handle, text: Readable | (() => Readable), options?: CalloutOptions): TextHandle;
  /** Copies of an element, each placed with at(). */
  repeat(handle: Handle, count: number): Handle[];
  dots(options?: DotsOptions): Dots;
}

// ---------------------------------------------------------------------------
// Path and geometry helpers (concept-neutral primitives)
// ---------------------------------------------------------------------------

export interface PathHelpers {
  line(points: ReadonlyArray<Vec2>): string;
  /** The same as line. */
  polyline(points: ReadonlyArray<Vec2>): string;
  /** Samples y = f(x). Starts a new subpath after a non-finite sample. */
  curve(
    fn: (x: number) => number,
    x0: number,
    x1: number,
    steps?: number,
    map?: (x: number, y: number) => Vec2,
  ): string;
  /** Samples a parametric curve (x(t), y(t)). */
  param(
    fx: (t: number) => number,
    fy: (t: number) => number,
    t0: number,
    t1: number,
    steps?: number,
  ): string;
  /** Circular arc; angles in radians. */
  arc(cx: number, cy: number, r: number, a0: number, a1: number): string;
  arrow(x: number, y: number, dx: number, dy: number, head?: number): string;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Line {
  readonly a: Point;
  readonly b: Point;
}

export interface Segment {
  readonly from: Point;
  readonly to: Point;
}

/** A rectangle as [x, y, width, height], usually a stage view box. */
export type Bounds = ViewBox;

export interface GeometryHelpers {
  point(x: number, y: number): Point;
  midpoint(a: Point, b: Point): Point;
  distance(a: Point, b: Point): number;
  lineThrough(a: Point, b: Point): Line;
  /** Intersection of two infinite lines, or null when they are parallel. */
  intersect(first: Line, second: Line): Point | null;
  /** The part of the ray from `origin` through `through` that lies inside `bounds`. */
  clipRay(origin: Point, through: Point, bounds: Bounds): Segment | null;
  /** The part of the infinite line through `a` and `b` that lies inside `bounds`. */
  clipLine(a: Point, b: Point, bounds: Bounds): Segment | null;
}

// ---------------------------------------------------------------------------
// Kit helpers: numbers, vectors, units, motion, shapes and symbols
// ---------------------------------------------------------------------------

/** A turning point of a function. */
export interface Extremum {
  readonly x: number;
  readonly y: number;
  readonly kind: 'max' | 'min';
}

/** dy/dt for an ODE step: one rate per value of y. */
export type Rate = (t: number, y: readonly number[]) => readonly number[];

/** inc.calc: numerical tools, so scenes never hand-roll them. */
export interface Calculus {
  /** The slope of f at x. */
  derivative(f: (x: number) => number, x: number, h?: number): number;
  /** The area under f from a to b (Simpson's rule, n intervals). */
  integral(f: (x: number) => number, a: number, b: number, n?: number): number;
  /** One root of f in [a, b] where f changes sign, or null. */
  root(f: (x: number) => number, a: number, b: number): number | null;
  /** Every root of f in [a, b], scanning n intervals. */
  roots(f: (x: number) => number, a: number, b: number, n?: number): number[];
  /** Every maximum and minimum of f in [a, b]. */
  extrema(f: (x: number) => number, a: number, b: number, n?: number): Extremum[];
  /** Linear interpolation in a table; xs increasing. */
  interp(xs: readonly number[], ys: readonly number[], x: number): number;
  /** One Euler step of dy/dt = f(t, y); returns the new y. */
  euler(f: Rate, t: number, y: readonly number[], dt: number): number[];
  /** One Runge-Kutta (RK4) step of dy/dt = f(t, y); returns the new y. */
  rk4(f: Rate, t: number, y: readonly number[], dt: number): number[];
  /** The normal distribution's density. */
  normal(x: number, mean?: number, sd?: number): number;
  /** The normal distribution's cumulative probability. */
  normalCdf(x: number, mean?: number, sd?: number): number;
  clamp(x: number, lo: number, hi: number): number;
  lerp(a: number, b: number, k: number): number;
  /** Maps x from [a0, a1] to [b0, b1]. */
  map(x: number, a0: number, a1: number, b0: number, b1: number): number;
  /** Smooth noise from -1 to 1, the same on every device: features about one unit apart, 0 at whole numbers. */
  noise(x: number, y?: number): number;
}

/** A 3x3 matrix: nine numbers, row by row. */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

/** inc.vec: vectors as plain arrays of 2 or 3 numbers; every call returns a new array. */
export interface VectorHelpers {
  add(a: readonly number[], b: readonly number[]): number[];
  sub(a: readonly number[], b: readonly number[]): number[];
  scale(a: readonly number[], k: number): number[];
  dot(a: readonly number[], b: readonly number[]): number;
  /** The cross product of 3D vectors. */
  cross(a: Vec3, b: Vec3): Vec3;
  /** For 2D vectors, the z component of the cross product. */
  cross(a: Vec2, b: Vec2): number;
  length(a: readonly number[]): number;
  normalize(a: readonly number[]): number[];
  /** Rotates a 2D vector counter-clockwise by radians. */
  rotate(a: Vec2, radians: number): Vec2;
  /** The angle between two vectors in radians, 0 to pi. */
  angle(a: readonly number[], b: readonly number[]): number;
  lerp(a: readonly number[], b: readonly number[], k: number): number[];
  /** The rotation by radians about an axis. */
  rotA(axis: Vec3, radians: number): Mat3;
  mul(a: Mat3, b: Mat3): Mat3;
  apply(m: Mat3, v: Vec3): Vec3;
}

/** inc.units: values with units for display, and conversions within one quantity. */
export interface Units {
  /** format(12.345, 'm/s') is "12.35 m/s"; format(30, '°', 0) is "30°". */
  format(value: number, unit?: string, digits?: number): string;
  /** convert(100, 'C', 'F') is 212. Knows SI and common units of length, time, angle, mass, force, energy, power, pressure, speed, temperature, volume, frequency, current, voltage, resistance, amount and concentration. */
  convert(value: number, from: string, to: string): number;
}

export interface SpringOptions {
  readonly stiffness?: number;
  readonly damping?: number;
}

export interface TourOptions {
  /** Seconds to hold each value. */
  readonly hold?: number;
  /** Seconds to move to the next. */
  readonly move?: number;
  readonly ease?: Ease;
}

/** inc.motion: calm motion as pure functions of time, so it pauses with the figure. */
export interface MotionHelpers {
  /** Moves current toward target, closing half the gap every halfLife seconds. */
  follow(current: number, target: number, dt: number, halfLife?: number): number;
  /** A damped spring toward target; returns [position, velocity]. */
  spring(position: number, velocity: number, target: number, dt: number, options?: SpringOptions): Vec2;
  /** An idle tour: holds each value, then eases to the next, looping. */
  tour(time: number, values: readonly number[], options?: TourOptions): number;
  /** Eases k from [0, 1]. */
  ease(k: number, name?: Ease): number;
  /** Swings smoothly from 0 to 1 and back every period seconds. */
  wave(time: number, period?: number): number;
}

/**
 * inc.shapes: path data for shapes diagrams keep drawing. Each returns a
 * string for stage.path(d) or handle.set(d); lines run from (x1, y1) to (x2, y2).
 */
export interface ShapeHelpers {
  spring(x1: number, y1: number, x2: number, y2: number, options?: { readonly coils?: number; readonly width?: number }): string;
  /** A resistor. */
  zigzag(x1: number, y1: number, x2: number, y2: number, options?: { readonly teeth?: number; readonly width?: number }): string;
  /** The same as zigzag. */
  resistor(x1: number, y1: number, x2: number, y2: number, options?: { readonly teeth?: number; readonly width?: number }): string;
  /** An inductor or solenoid seen side on. */
  coil(x1: number, y1: number, x2: number, y2: number, options?: { readonly loops?: number; readonly width?: number }): string;
  wave(x1: number, y1: number, x2: number, y2: number, options?: { readonly amplitude?: number; readonly wavelength?: number; readonly phase?: number }): string;
  gear(cx: number, cy: number, r: number, options?: { readonly teeth?: number; readonly depth?: number }): string;
  /** The outline around circles [cx, cy, r], such as a belt over pulleys. */
  hull(circles: ReadonlyArray<Vec3>): string;
  /** A lens; bulge above 0 is convex, below 0 concave. */
  lens(cx: number, cy: number, height: number, options?: { readonly bulge?: number }): string;
  battery(x1: number, y1: number, x2: number, y2: number, options?: { readonly cells?: number }): string;
  capacitor(x1: number, y1: number, x2: number, y2: number, options?: { readonly gap?: number; readonly plate?: number }): string;
  ground(x: number, y: number, size?: number): string;
  bulb(cx: number, cy: number, r: number): string;
  switch(x1: number, y1: number, x2: number, y2: number, closed: boolean): string;
  /** An open-topped container. */
  tank(x: number, y: number, w: number, h: number): string;
  /** A curly brace with its point `depth` to the left of the line. */
  brace(x1: number, y1: number, x2: number, y2: number, depth?: number): string;
  /** A closed, gently irregular outline, such as a cell; the same seed draws the same shape. */
  blob(cx: number, cy: number, r: number, options?: { readonly wobble?: number; readonly seed?: number }): string;
  polygon(points: ReadonlyArray<Vec2>): string;
  /** A regular polygon with `sides` sides. */
  regular(cx: number, cy: number, r: number, sides: number, rotation?: number): string;
}

// ---------------------------------------------------------------------------
// Formulas
// ---------------------------------------------------------------------------

/**
 * An authored maths expression. Its source stays visible; the SDK compiles it
 * with a restricted parser, never with eval.
 */
export interface Formula {
  (x: number, t?: number): number;
  readonly source: string;
  readonly variables: readonly string[];
  evaluate(scope: Readonly<Record<string, number>>): number;
}

export interface FormulaOptions {
  /** Short names for parameters or numbers, such as { A: amplitude }. Parameters declared before the formula can also be used by their own names. */
  readonly vars?: Readonly<Record<string, Param | number>>;
  /** Show the formula as maths the learner can edit; their edit replaces it everywhere. */
  readonly editable?: boolean;
  readonly label?: string;
}

// ---------------------------------------------------------------------------
// Graph 2D
// ---------------------------------------------------------------------------

export interface GraphOptions {
  readonly x: Vec2;
  readonly y: Vec2;
  readonly title: string;
  readonly description?: string;
  /** `x` draws only the horizontal axis: a number line. */
  readonly axes?: boolean | 'x';
  readonly grid?: boolean;
  readonly labels?: { readonly x?: string; readonly y?: string };
  readonly viewBox?: ViewBox;
  readonly scale?: { readonly x?: 'linear' | 'log'; readonly y?: 'linear' | 'log' };
  /** Learners may zoom and pan the axes; default true. */
  readonly zoom?: boolean;
}

export interface CurveOptions {
  readonly tone?: Tone;
  readonly samples?: number;
  readonly dashed?: boolean;
  /** Names the curve in the legend, where the learner can hide it. */
  readonly label?: string;
  /** Fill under it with its tone. */
  readonly fill?: boolean;
}

export type PlotFunction = ((x: number, time: number) => number) | Formula;

/** Points in data units, or a function of the model that returns them. */
export type PointsSource = ReadonlyArray<Vec2> | (() => ReadonlyArray<Vec2>);

/** Numbers, or a function of the model that returns them. */
export type ValuesSource = readonly number[] | (() => readonly number[]);

/** A bound that can follow the model. */
export type Bound = number | (() => number);

export interface GraphCurve {
  readonly handle: PathHandle;
  show(visible?: boolean): this;
  hide(): this;
  tone(name: Tone): this;
  /** Draws only the first fraction of it, from 0 to 1, to animate plotting. */
  reveal(fraction: number): this;
}

export interface SeriesOptions {
  readonly tone?: Tone;
  readonly label?: string;
  /** Dot radius for scatter plots, in stage units. */
  readonly r?: number;
}

export interface BarOptions extends SeriesOptions {
  /** Bar width in data units; by default most of the gap between bars. */
  readonly width?: number;
}

export interface HistogramOptions extends SeriesOptions {
  readonly bins: number;
  /** The range binned; by default the graph's x range. */
  readonly range?: Vec2;
  /** Heights as densities (area 1) rather than counts. */
  readonly density?: boolean;
}

export interface FieldOptions {
  readonly tone?: Tone;
  /** Grid spacing in data units; by default about 16 arrows across. */
  readonly step?: number;
  /** Data units of arrow per unit of field; by default arrows are scaled to fit. */
  readonly scale?: number;
}

export interface GraphPoint {
  readonly handle: Handle;
  at(x: number, y: number): this;
  show(visible?: boolean): this;
  hide(): this;
  tone(name: Tone): this;
}

export interface GraphSegment {
  readonly handle: Handle;
  between(x1: number, y1: number, x2: number, y2: number): this;
  show(visible?: boolean): this;
  hide(): this;
  tone(name: Tone): this;
}

export interface GraphArrow {
  readonly handle: PathHandle;
  from(x: number, y: number, dx: number, dy: number): this;
  show(visible?: boolean): this;
  hide(): this;
  tone(name: Tone): this;
}

export interface GraphTrail {
  readonly handle: PolylineHandle;
  add(x: number, y: number): this;
  clear(): this;
}

/** A bracket or a dimension line with its text, in data units. */
export interface GraphMark {
  readonly handle: PathHandle;
  between(x1: number, y1: number, x2: number, y2: number): this;
  text(value: Readable): this;
  show(visible?: boolean): this;
  hide(): this;
  tone(name: Tone): this;
}

export interface HandleOptions {
  /** A parameter name to drag, or a fixed number. */
  readonly x: string | number;
  readonly y: string | number;
  readonly tone?: Tone;
  readonly r?: number;
  /** What the learner drags, for the hint and screen readers. */
  readonly label?: string;
}

export interface Graph {
  readonly stage: Stage;
  toX(x: number): number;
  toY(y: number): number;
  plot(fn: PlotFunction, options?: CurveOptions): GraphCurve;
  /** x = f(y). */
  plotX(fn: (y: number, time: number) => number, options?: CurveOptions): GraphCurve;
  /** r = f(theta), theta from `from` to `to` (default a full turn). */
  polar(fn: (theta: number, time: number) => number, options?: CurveOptions & { readonly from?: number; readonly to?: number }): GraphCurve;
  parametric(
    fx: (t: number) => number,
    fy: (t: number) => number,
    t0: number,
    t1: number,
    options?: CurveOptions,
  ): GraphCurve;
  scatter(points: PointsSource, options?: SeriesOptions): GraphCurve;
  /** Bars from y = 0 to each point's y, centred on its x. */
  bars(points: PointsSource, options?: BarOptions): GraphCurve;
  histogram(values: ValuesSource, options: HistogramOptions): GraphCurve;
  /** The area between y = f(x) and y = 0 from `from` to `to`. */
  area(fn: PlotFunction, from: Bound, to: Bound, options?: CurveOptions): GraphCurve;
  /** The region between two curves from `from` to `to`. */
  between(f: PlotFunction, g: PlotFunction, from: Bound, to: Bound, options?: CurveOptions): GraphCurve;
  /** Arrows of a vector field. */
  field(fn: (x: number, y: number) => Vec2, options?: FieldOptions): GraphCurve;
  /** Short segments with slope dy/dx = f(x, y). */
  slopes(fn: (x: number, y: number) => number, options?: FieldOptions): GraphCurve;
  /** The curve F(x, y) = 0; with fill, the region where F < 0 is shaded. */
  implicit(fn: (x: number, y: number) => number, options?: CurveOptions): GraphCurve;
  point(x: number, y: number, options?: { readonly tone?: Tone; readonly r?: number }): GraphPoint;
  segment(x1: number, y1: number, x2: number, y2: number, options?: CurveOptions): GraphSegment;
  arrow(x: number, y: number, dx: number, dy: number, options?: CurveOptions): GraphArrow;
  trail(options?: { readonly tone?: Tone; readonly max?: number }): GraphTrail;
  label(x: number, y: number, value: Readable, options?: ElementOptions): TextHandle;
  /** An equation drawn as maths at a point in data units, as stage.equation does (DG-5). */
  equation(x: number, y: number, source: Readable, options?: EquationOptions): TextHandle;
  bracket(x1: number, y1: number, x2: number, y2: number, text?: Readable, options?: { readonly tone?: Tone }): GraphMark;
  dimension(x1: number, y1: number, x2: number, y2: number, text?: Readable, options?: { readonly tone?: Tone }): GraphMark;
  /** A point the learner can drag along a curve, showing its coordinates. Follows the pointer on hover. */
  trace(curve: GraphCurve, options?: { readonly tone?: Tone; readonly digits?: number }): GraphPoint;
  /** A point the learner drags to set parameters. */
  handle(options: HandleOptions): GraphPoint;
  /** Lets the learner drag an item; `map` gets the pointer in data units. A later drag on the same item replaces the earlier one. */
  drag(item: GraphPoint | GraphSegment | GraphArrow | GraphCurve | Handle, map: DragMap, options?: { readonly label?: string }): void;
  /** Names an item for highlighting, steps, the legend and descriptions, as stage.part does for elements. */
  part<T extends GraphPoint | GraphSegment | GraphArrow | GraphCurve | GraphMark | GraphTrail | Handle>(name: string, item: T, options?: PartOptions): T;
  /** Marks roots and turning points of a curve. */
  marks(curve: GraphCurve, options?: { readonly roots?: boolean; readonly extrema?: boolean; readonly tone?: Tone }): void;
  /** Marks where two curves cross. */
  crossings(a: GraphCurve, b: GraphCurve, options?: { readonly tone?: Tone }): void;
}

// ---------------------------------------------------------------------------
// 3D: inc.space3d and inc.graph3d (the space3d kit, loaded on demand).
// World axes: x and y are level, z points up.
// ---------------------------------------------------------------------------

export interface CameraOptions {
  /** Turn about the upright z axis, in degrees. Default 35. */
  readonly yaw?: number;
  /** Look down by this many degrees; 90 looks straight down. Default 25. */
  readonly pitch?: number;
  /** Stage units per world unit. Default: fits everything in view. */
  readonly scale?: number;
  /** Camera distance in world units, for perspective; 0 for none. Default: five times the scene's size. */
  readonly distance?: number;
  /** The world point at the centre of the view. Default [0, 0, 0]. */
  readonly target?: Vec3;
}

/** Named camera views: front looks along +y, side along -x, top straight down, iso is isometric. */
export type View3D = 'front' | 'side' | 'top' | 'iso';

export interface Space3DOptions {
  readonly title: string;
  readonly description?: string;
  /** Default [0, 0, 640, 440]. */
  readonly viewBox?: ViewBox;
  readonly camera?: CameraOptions;
  /** 'orbit' (default): dragging the background turns the camera; 'iso': fixed isometric; 'fixed': the camera options only. */
  readonly mode?: 'orbit' | 'iso' | 'fixed';
  /** Learners may zoom; default true. */
  readonly zoom?: boolean;
  /** Most faces drawn at once; above it round solids get fewer facets and the figure warns. Default 1200. */
  readonly budget?: number;
}

export interface Solid3DOptions {
  readonly at?: Vec3;
  /** Degrees about x, then y, then z. */
  readonly rotate?: Vec3;
  readonly scale?: number | Vec3;
  readonly tone?: Tone;
  readonly parent?: Group3D;
  /** 'solid' (default) is shaded; 'wire' draws edges only; 'ghost' is faint and see-through. */
  readonly look?: 'solid' | 'wire' | 'ghost';
  /** Moves it toward the viewer in the depth order, for a sticker on a face. */
  readonly bias?: number;
  /** Facets around round solids. Default 24. */
  readonly segments?: number;
}

/** Something placed in 3D. Setters replace the value; they do not add to it. */
export interface Object3D {
  at(x: number, y: number, z: number): this;
  /** Degrees about x, then y, then z. */
  rotate(rx: number, ry: number, rz: number): this;
  /** Rotation as a matrix, such as inc.vec.rotA(axis, radians). */
  orient(m: Mat3): this;
  scale(s: number | Vec3): this;
  tone(name: Tone): this;
  show(visible?: boolean): this;
  hide(): this;
  /** Where its centre is drawn, in stage units. */
  screen(): Vec2;
}

export interface Group3D extends Object3D {
  /** Spreads the children away from the group's centre: 0 together, 1 twice as far apart (exploded view). */
  explode(amount: number): this;
}

export interface Line3DOptions {
  readonly tone?: Tone;
  readonly parent?: Group3D;
  readonly dashed?: boolean;
  /** An arrowhead at the end. */
  readonly arrow?: boolean;
  readonly label?: Readable;
}

export interface Line3D extends Object3D {
  points(points: ReadonlyArray<Vec3>): this;
}

export interface Arrow3D extends Object3D {
  set(from: Vec3, to: Vec3): this;
  label(text: Readable): this;
}

export interface Label3D {
  /** Moves the label to a point or onto an object. */
  at(target: Vec3 | Object3D): this;
  text(value: Readable): this;
  tone(name: Tone): this;
  show(visible?: boolean): this;
  hide(): this;
}

/** A solid of your own: corner points and faces, as lists of corner indices counter-clockwise from outside. */
export interface Mesh3DData {
  readonly vertices: ReadonlyArray<Vec3>;
  readonly faces: ReadonlyArray<readonly number[]>;
}

export interface GridOptions {
  /** 'xy' (default, the floor), 'xz' or 'yz'. */
  readonly plane?: 'xy' | 'xz' | 'yz';
  /** Half the width. Default 5. */
  readonly size?: number;
  /** Spacing between lines. Default 1. */
  readonly step?: number;
  readonly at?: Vec3;
  readonly tone?: Tone;
}

export interface AxesOptions {
  /** Length of each axis. Default 4. */
  readonly length?: number;
  readonly labels?: readonly [string, string, string];
  /** Draw the negative halves too. */
  readonly both?: boolean;
}

export interface FieldLineOptions {
  /** Steps along each line. Default 120. */
  readonly steps?: number;
  /** World units per step. Default 0.08. */
  readonly step?: number;
  readonly tone?: Tone;
  /** Arrowheads along the lines. Default true. */
  readonly arrows?: boolean;
  /** A line ends when it comes this close to one of these points, such as charges. */
  readonly sinks?: ReadonlyArray<Vec3>;
}

export interface Space3D {
  /** Every solid is centred on its position; cylinders, cones and tori stand along z. */
  box(size: number | Vec3, options?: Solid3DOptions): Object3D;
  sphere(r: number, options?: Solid3DOptions): Object3D;
  cylinder(r: number, h: number, options?: Solid3DOptions): Object3D;
  cone(r: number, h: number, options?: Solid3DOptions): Object3D;
  /** A flat rectangle in the xy plane, seen from both sides. */
  plane(w: number, d: number, options?: Solid3DOptions): Object3D;
  torus(R: number, r: number, options?: Solid3DOptions): Object3D;
  /** A cylinder from one point to another: a rod, a bond, a strut. */
  tube(from: Vec3, to: Vec3, r: number, options?: Solid3DOptions): Object3D;
  mesh(data: Mesh3DData, options?: Solid3DOptions): Object3D;
  group(options?: Solid3DOptions): Group3D;
  line(points: ReadonlyArray<Vec3>, options?: Line3DOptions): Line3D;
  /** A 3D segment with a head that always faces the viewer. */
  arrow(from: Vec3, to: Vec3, options?: Line3DOptions): Arrow3D;
  /** A helix standing along z, such as a spring or a solenoid's wire; sorted piece by piece, so it wraps whatever runs through it. */
  coil(r: number, h: number, turns: number, options?: Line3DOptions): Line3D;
  /** An angle arc: `from` (a vector from `center`) turned about `axis` by `degrees`. */
  arc(center: Vec3, from: Vec3, axis: Vec3, degrees: number, options?: Line3DOptions): Line3D;
  /** A dot that keeps its size on screen. */
  point(at: Vec3, options?: { readonly tone?: Tone; readonly parent?: Group3D; readonly r?: number }): Object3D;
  /** Text at a point or object, pushed outward from the figure's centre so labels do not collide. */
  label(target: Vec3 | Object3D, text: Readable, options?: { readonly tone?: Tone; readonly offset?: number }): Label3D;
  grid(options?: GridOptions): Object3D;
  axes(options?: AxesOptions): Group3D;
  /** Lines traced through a vector field from seed points, such as electric or magnetic field lines. */
  fieldLines(field: (p: Vec3) => Vec3, seeds: ReadonlyArray<Vec3>, options?: FieldLineOptions): Group3D;
  /** Names an object for highlighting, steps, the legend and descriptions. */
  part<T extends Object3D>(name: string, object: T, options?: PartOptions): T;
  /** Lets the learner drag an object; `map` gets the pointer in stage units (see pick). */
  drag<T extends Object3D>(object: T, map: DragMap, options?: { readonly label?: string }): T;
  /** The world point at height z under a stage point, or null when the view ray misses it. */
  pick(x: number, y: number, z?: number): Vec3 | null;
  /** Moves the camera; options not given stay. */
  camera(options: CameraOptions): void;
  view(name: View3D): void;
  /** A world point in stage units. */
  project(p: Vec3): Vec2;
  /** The 2D stage underneath, for flat overlays. */
  readonly stage: Stage;
}

export interface Graph3DOptions {
  readonly title: string;
  readonly description?: string;
  readonly x: Vec2;
  readonly y: Vec2;
  readonly z: Vec2;
  readonly viewBox?: ViewBox;
  readonly camera?: CameraOptions;
  /** Axis names. Default ['x', 'y', 'z']. */
  readonly labels?: readonly [string, string, string];
  /** Axes with ticks. Default true. */
  readonly axes?: boolean;
  /** Grid planes. Default ['xy']; false for none. */
  readonly grid?: boolean | ReadonlyArray<'xy' | 'xz' | 'yz'>;
  readonly zoom?: boolean;
  /** Most faces drawn at once; surfaces get coarser above it. Default 1600. */
  readonly budget?: number;
}

export interface SurfaceOptions {
  readonly tone?: Tone;
  /** 'solid' (default) shaded faces, 'wire' a mesh of lines, 'ghost' faint. */
  readonly look?: 'solid' | 'wire' | 'ghost';
  /** Samples along each side. Default 24; lowered on slow devices and above the budget. */
  readonly resolution?: number;
  /** Contour lines drawn on the surface at these heights. */
  readonly contours?: readonly number[];
}

export interface ParametricSurfaceOptions extends SurfaceOptions {
  readonly u: Vec2;
  readonly v: Vec2;
}

export interface Curve3DOptions {
  readonly t: Vec2;
  readonly tone?: Tone;
  readonly steps?: number;
  readonly dashed?: boolean;
}

/** A surface; its function is sampled again on every draw, so it follows parameters. */
export interface Surface3D extends Object3D {
  /** Where the surface meets the plane x = value or y = value, as a curve (a cross-section). */
  section(axis: 'x' | 'y', value: number | (() => number), options?: { readonly tone?: Tone }): Line3D;
}

/** A 3D graph in data units; functions given to it are sampled again on every draw. */
export interface Graph3D {
  /** z = f(x, y) over the graph's x and y ranges. */
  surface(f: (x: number, y: number) => number, options?: SurfaceOptions): Surface3D;
  /** The surface (x, y, z) = f(u, v). */
  parametric(f: (u: number, v: number) => Vec3, options: ParametricSurfaceOptions): Surface3D;
  /** The curve (x, y, z) = f(t). */
  curve(f: (t: number) => Vec3, options: Curve3DOptions): Line3D;
  point(at: Vec3 | (() => Vec3), options?: { readonly tone?: Tone; readonly label?: Readable }): Object3D;
  vector(from: Vec3, to: Vec3, options?: Line3DOptions): Arrow3D;
  line(points: ReadonlyArray<Vec3>, options?: Line3DOptions): Line3D;
  /** The plane n·p = d, clipped to the graph's box. */
  plane(normal: Vec3, d: number, options?: { readonly tone?: Tone; readonly look?: 'solid' | 'wire' | 'ghost' }): Surface3D;
  label(at: Vec3, text: Readable, options?: { readonly tone?: Tone }): Label3D;
  part<T extends Object3D>(name: string, object: T, options?: PartOptions): T;
  camera(options: CameraOptions): void;
  view(name: View3D): void;
  project(p: Vec3): Vec2;
  readonly stage: Stage;
}

// ---------------------------------------------------------------------------
// Physics 2D: inc.physics2d (the physics2d kit, loaded on demand).
// Metres, kilograms and seconds; y points up from the bottom of the stage.
// ---------------------------------------------------------------------------

/** A value, or a function read again whenever the world restarts. */
export type Live<T> = T | (() => T);

export interface Physics2DOptions {
  readonly title: string;
  readonly description?: string;
  /** Default [0, 0, 600, 400]. */
  readonly viewBox?: ViewBox;
  /** Stage units per metre. Default 50: a 12 m by 8 m world. */
  readonly scale?: number;
  /** Downward acceleration in m/s². Default 9.8. A function is read every step. */
  readonly gravity?: number | (() => number);
  /** Air drag on every body, newtons per m/s. Default 0. A function is read every step. */
  readonly air?: number | (() => number);
  /** Walls at the stage's edges: true for all four, or a list. Default ['floor']. */
  readonly walls?: boolean | ReadonlyArray<'floor' | 'left' | 'right' | 'ceiling'>;
  /** Start again from the initial state when a parameter changes. Default true. */
  readonly restart?: boolean;
  readonly zoom?: boolean;
}

export interface BodyOptions {
  /** Centre in metres. */
  readonly at: Live<Vec2>;
  /** Degrees counter-clockwise. */
  readonly angle?: Live<number>;
  /** Kilograms. Default 1, or density times area when density is given. */
  readonly mass?: Live<number>;
  /** kg/m³ over 1 m of depth; decides floating (water is 1000). */
  readonly density?: Live<number>;
  /** Starting velocity, m/s. */
  readonly velocity?: Live<Vec2>;
  /** Starting spin, degrees per second counter-clockwise. */
  readonly spin?: Live<number>;
  /** Never moves: floors, ramps and pegs. */
  readonly fixed?: boolean;
  /** 0 slides freely, 1 grips. Default 0.3. */
  readonly friction?: Live<number>;
  /** 0 stops dead, 1 bounces back fully. Default 0.2. */
  readonly bounce?: Live<number>;
  /** Electric charge in microcoulombs; like charges repel. */
  readonly charge?: Live<number>;
  /** Magnet strength; north points along the body's angle. */
  readonly magnet?: Live<number>;
  /** The learner can drag it. */
  readonly draggable?: boolean;
  /** Passes through other bodies and reports what touches it. */
  readonly sensor?: boolean;
  readonly tone?: Tone;
  readonly label?: Readable;
}

export interface JointOptions {
  /** Metres. Default: the starting distance. */
  readonly length?: Live<number>;
  /** Where it attaches, in metres from body A's centre (turns with the body). */
  readonly anchorA?: Vec2;
  readonly anchorB?: Vec2;
  readonly tone?: Tone;
}

export interface SpringJointOptions extends JointOptions {
  /** N/m. Default 50. */
  readonly stiffness?: Live<number>;
  /** N per m/s. Default 0.5. */
  readonly damping?: Live<number>;
}

export interface HingeOptions {
  /** A second body pinned at the same point. */
  readonly to?: Body2D;
  /** Motor speed, degrees per second. */
  readonly motor?: Live<number>;
  /** Most torque the motor gives, N·m. Default 100. */
  readonly torque?: number;
}

export interface TankOptions {
  /** Left edge in metres. */
  readonly x: number;
  readonly w: number;
  /** Liquid depth with nothing in it, metres. */
  readonly depth: Live<number>;
  /** Wall height. Default 1.5 times the depth. */
  readonly h?: number;
  /** kg/m³. Default 1000. */
  readonly density?: Live<number>;
  readonly tone?: Tone;
}

export type ForceKind = 'gravity' | 'normal' | 'friction' | 'tension' | 'spring' | 'buoyancy' | 'drag' | 'electric' | 'magnetic' | 'applied' | 'net';

export interface ForceArrowOptions {
  /** Which forces. Default: every force acting, and the net force. */
  readonly show?: readonly ForceKind[];
  /** Also draw x and y components, dashed. */
  readonly components?: boolean;
  /** Stage units per newton. Default: the largest force is 80 long. */
  readonly scale?: number;
  /** Name each arrow. Default true. */
  readonly labels?: boolean;
}

export interface Body2D {
  readonly x: number;
  readonly y: number;
  /** Degrees counter-clockwise. */
  readonly angle: number;
  readonly vx: number;
  readonly vy: number;
  readonly speed: number;
  readonly mass: number;
  /** A force acting now, in newtons. */
  force(kind: ForceKind): Vec2;
  /** Moves the body and stops it. */
  place(x: number, y: number, angle?: number): this;
  /** Sets its velocity, m/s. */
  velocity(vx: number, vy: number): this;
  /** A steady push in newtons until changed; push(0, 0) stops it. */
  push(fx: number, fy: number): this;
  tone(name: Tone): this;
  show(visible?: boolean): this;
  hide(): this;
  /** The drawn shape, for parts, callouts and connectors. */
  readonly handle: Handle;
}

export interface Joint2D {
  /** Pull along it now, newtons. */
  readonly tension: number;
  /** Length now, metres. */
  readonly length: number;
  /** Changes the rest length. */
  setLength(metres: number): this;
  show(visible?: boolean): this;
  hide(): this;
  readonly handle: Handle;
}

export interface Tank2D {
  /** Height of the surface now, metres. */
  readonly level: number;
  /** The liquid, for parts and callouts. */
  readonly handle: PathHandle;
  /** Liquid pushed aside, m³ per metre of depth. */
  readonly displaced: number;
  /** The upward push on a body now, newtons. */
  buoyancy(body: Body2D): number;
}

export interface Energy {
  readonly kinetic: number;
  readonly potential: number;
  readonly elastic: number;
  readonly total: number;
}

export interface World2D {
  ball(options: BodyOptions & { readonly r: Live<number> }): Body2D;
  box(options: BodyOptions & { readonly w: Live<number>; readonly h: Live<number> }): Body2D;
  /** A convex polygon; points in metres around its centre. */
  polygon(options: BodyOptions & { readonly points: ReadonlyArray<Vec2> }): Body2D;
  /** A fixed slope from one point to another. */
  ramp(from: Vec2, to: Vec2, options?: { readonly friction?: number; readonly tone?: Tone }): Body2D;
  /** Ends are bodies or fixed points in metres. */
  spring(a: Body2D | Vec2, b: Body2D | Vec2, options?: SpringJointOptions): Joint2D;
  /** Pulls only when taut. */
  rope(a: Body2D | Vec2, b: Body2D | Vec2, options?: JointOptions): Joint2D;
  /** Keeps its length, pushing or pulling. */
  rod(a: Body2D | Vec2, b: Body2D | Vec2, options?: JointOptions): Joint2D;
  /** A pin at a point that the body turns about; a motor turns it. */
  hinge(body: Body2D, at: Vec2, options?: HingeOptions): Joint2D;
  /** An ideal pulley at `at`: one rope from a over the wheel to b. */
  pulley(a: Body2D, b: Body2D, at: Vec2, options?: { readonly r?: number; readonly tone?: Tone }): Joint2D;
  /** Liquid that bodies float or sink in; its level rises with what they displace. */
  tank(options: TankOptions): Tank2D;
  /** A force on every moving body each step, in newtons, such as wind or a planet's pull. */
  field(force: (body: Body2D) => Vec2 | void): void;
  /** Live arrows for the forces on a body, from the simulation itself. */
  forces(body: Body2D, options?: ForceArrowOptions): void;
  onHit(callback: (a: Body2D, b: Body2D, speed: number) => void): void;
  /** Runs when a body enters a sensor. */
  onTouch(sensor: Body2D, callback: (body: Body2D) => void): void;
  energy(): Energy;
  /** Starts again from the initial state. */
  restart(): void;
  /** A world point in stage units, for overlays. */
  toStage(p: Vec2): Vec2;
  /** Simulated seconds since the start. */
  readonly time: number;
  readonly stage: Stage;
}

// ---------------------------------------------------------------------------
// Charts: inc.chart (the chart kit, loaded on demand)
// ---------------------------------------------------------------------------

export type ChartKind = 'bar' | 'line' | 'area' | 'stacked' | 'pie' | 'histogram' | 'box' | 'scatter';

export interface ChartOptions {
  readonly title: string;
  readonly description?: string;
  /** Default [0, 0, 600, 380]. */
  readonly viewBox?: ViewBox;
  /** Default 'bar'. */
  readonly kind?: ChartKind;
  /** Names along the x axis, or a pie's slices. */
  readonly categories?: readonly string[];
  /** The value axis range. Default: from the data, from 0 for bars. */
  readonly range?: Vec2;
  /** The x range of a scatter chart or histogram. */
  readonly x?: Vec2;
  readonly xLabel?: string;
  readonly yLabel?: string;
  readonly unit?: string;
  /** Histogram bins. Default 10. */
  readonly bins?: number;
  /** A legend for two or more series. Default true. */
  readonly legend?: boolean;
}

/** Values, or a function read again on every draw. */
export type ChartData = readonly number[] | (() => readonly number[]);

export interface ChartSeriesOptions {
  readonly tone?: Tone;
  /** Print each value on its bar, slice or point. */
  readonly values?: boolean;
  /** Scatter only: a least-squares line through the points. */
  readonly trend?: boolean;
}

export interface ChartSeries {
  readonly name: string;
  set(data: ChartData | ReadonlyArray<Vec2> | (() => ReadonlyArray<Vec2>)): this;
  tone(name: Tone): this;
  show(visible?: boolean): this;
  hide(): this;
}

export interface Chart {
  /** One value per category; histograms and box plots take raw samples, one series per box. */
  series(name: string, data: ChartData, options?: ChartSeriesOptions): ChartSeries;
  /** Points for a scatter chart. */
  points(name: string, data: ReadonlyArray<Vec2> | (() => ReadonlyArray<Vec2>), options?: ChartSeriesOptions): ChartSeries;
  /** A level reference line, such as a mean. */
  rule(value: number | (() => number), options?: { readonly label?: string; readonly tone?: Tone; readonly dashed?: boolean }): Handle;
  /** Picks out one category by index, or none with null. */
  highlight(index: number | null): void;
  readonly stage: Stage;
}

// ---------------------------------------------------------------------------
// Flowcharts and state diagrams: inc.flow (the flow kit, loaded on demand)
// ---------------------------------------------------------------------------

export interface FlowOptions {
  readonly title: string;
  readonly description?: string;
  /** Default [0, 0, 640, 420]; the diagram scales to fit. */
  readonly viewBox?: ViewBox;
  /** Default 'down'. */
  readonly direction?: 'down' | 'right';
}

export interface FlowNodeOptions {
  /** 'box' (default), 'round', 'diamond' for a decision, 'circle' for a state, 'pill' for start and end. */
  readonly shape?: 'box' | 'round' | 'diamond' | 'circle' | 'pill';
  readonly tone?: Tone;
  /** Shown when the learner points at the node. */
  readonly info?: string;
  /** Pins the node to a row (or column), counted from 0. */
  readonly layer?: number;
}

export interface FlowEdgeOptions {
  readonly label?: string;
  readonly tone?: Tone;
  readonly dashed?: boolean;
  /** Moving dashes along the edge: stage units per second. */
  readonly flow?: number;
}

export interface FlowNode {
  readonly id: string;
  label(text: Readable): this;
  tone(name: Tone): this;
  /** Its centre in stage units, once laid out. */
  centre(): Vec2;
}

export interface FlowEdge {
  label(text: Readable): this;
  tone(name: Tone): this;
  dashed(on?: boolean): this;
  flow(speed: number): this;
}

/** Nodes are parts named by their id, so steps can focus them. */
export interface Flow {
  node(id: string, label: string, options?: FlowNodeOptions): FlowNode;
  edge(from: string, to: string, options?: FlowEdgeOptions): FlowEdge;
  /** Picks out a node, such as the current state; null for none. */
  active(id: string | null): void;
  readonly stage: Stage;
}

// ---------------------------------------------------------------------------
// Chemistry: inc.chemistry (the chemistry kit, loaded on demand)
// ---------------------------------------------------------------------------

export interface ChemistryOptions {
  readonly title: string;
  readonly description?: string;
  /** Default [0, 0, 640, 400]. */
  readonly viewBox?: ViewBox;
  /** Stage units per ångström for molecules. Default 40: a C–H bond is 44 long. */
  readonly scale?: number;
  /** 'balls' (default) shades each atom as a ball; 'symbols' writes symbols joined by lines, as a displayed formula. */
  readonly look?: 'balls' | 'symbols';
}

export interface AtomOptions {
  readonly tone?: Tone;
  /** Radius in stage units. Default: from the element's size. */
  readonly r?: number;
  /** An ion's charge: 1 shows +, -2 shows 2−. */
  readonly charge?: number;
  /** The learner can drag it; its bonds follow. */
  readonly draggable?: boolean;
}

export interface Atom {
  /** Its symbol, such as 'O'. */
  readonly element: string;
  readonly x: number;
  readonly y: number;
  at(x: number, y: number): this;
  charge(value: number): this;
  /** A partial charge beside it, δ+ or δ−; null removes it. */
  partial(sign: '+' | '-' | null): this;
  tone(name: Tone): this;
  show(visible?: boolean): this;
  hide(): this;
  /** The drawn atom, for parts, callouts and connectors. */
  readonly handle: Handle;
}

export interface BondOptions {
  /** 1, 2 or 3 lines; 1.5 is one solid and one dashed, as in benzene. Default 1. */
  readonly order?: 1 | 1.5 | 2 | 3;
  /** 'ionic' draws no line; 'hydrogen' a dotted one between the atoms' surfaces. Default 'covalent'. */
  readonly kind?: 'covalent' | 'ionic' | 'hydrogen';
  readonly tone?: Tone;
}

export interface Bond {
  readonly a: Atom;
  readonly b: Atom;
  order(value: 1 | 1.5 | 2 | 3): this;
  /** How formed it is, from 0 to 1: it thins and fades as it breaks. */
  strength(value: number): this;
  tone(name: Tone): this;
  show(visible?: boolean): this;
  hide(): this;
  readonly handle: Handle;
}

/** A structure of your own: atoms as [element, x, y, charge?] in ångströms (y down), bonds as [from, to, order?] by index. */
export interface MoleculeStructure {
  readonly atoms: ReadonlyArray<readonly [string, number, number, number?]>;
  readonly bonds?: ReadonlyArray<readonly [number, number, number?]>;
  /** A polyatomic ion's charge, shown at its top right. */
  readonly charge?: number;
}

export interface MoleculeOptions {
  /** Its centre. Default: the middle of the stage. */
  readonly at?: Vec2;
  /** Degrees clockwise. */
  readonly angle?: number;
  /** Dots for each atom's lone pairs, from its valence electrons. */
  readonly lonePairs?: boolean;
  /** δ+ and δ− on atoms at the ends of polar bonds, from electronegativity. */
  readonly polar?: boolean;
  /** The learner can drag it around. */
  readonly draggable?: boolean;
}

export interface Molecule {
  /** As given, such as 'H2O'. */
  readonly formula: string;
  /** Its atoms in the order the formula writes them: H2O is H, H, O. */
  readonly atoms: readonly Atom[];
  readonly bonds: readonly Bond[];
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  at(x: number, y: number): this;
  /** Turns it to an angle in degrees, clockwise. */
  rotate(degrees: number): this;
  show(visible?: boolean): this;
  hide(): this;
  readonly handle: Handle;
}

export interface ShellOptions {
  /** Electrons in each shell, innermost first. Default: the ground state. */
  readonly electrons?: readonly number[];
  /** Radius of the first shell. Default 27; each next one is `gap` further out (default 16). */
  readonly r?: number;
  readonly gap?: number;
  /** 'dot' (default) or 'cross', for dot-and-cross diagrams. */
  readonly mark?: 'dot' | 'cross';
  /** Turns per second while playing. Default 0. */
  readonly spin?: number;
  /** The electrons' tone. Default 'b'. */
  readonly tone?: Tone;
}

/** A Bohr model: the nucleus and its electrons in shells; an ion shows in brackets with its charge. */
export interface Shells {
  readonly element: string;
  /** Protons in the nucleus. */
  readonly protons: number;
  /** Electrons in each shell now, innermost first. */
  readonly electrons: readonly number[];
  /** Protons minus electrons: 0 for an atom, 1 for Na+. */
  readonly charge: number;
  /** Sets the electrons in each shell, as when an atom gives one away. */
  setElectrons(perShell: readonly number[]): this;
  /** Where an electron is drawn now, by shell (0 is innermost) and index. */
  electron(shell: number, index: number): Vec2;
  at(x: number, y: number): this;
  show(visible?: boolean): this;
  hide(): this;
  readonly handle: Handle;
}

export interface ReactionOptions {
  /** Where it plays: [x, y, width, height]. Default: the stage. */
  readonly box?: ViewBox;
  /** Structures for formulas the kit does not know. */
  readonly structures?: Readonly<Record<string, MoleculeStructure>>;
  /** Write the equation beneath it. Default true. */
  readonly equation?: boolean;
}

/** Bond energies in kJ/mol from average bond enthalpies: in to break, out to make, and the change (negative gives energy out). */
export interface ReactionEnergy {
  readonly broken: number;
  readonly formed: number;
  readonly change: number;
}

/** A balanced equation acted out: the reactants' bonds break, their atoms move, the products' bonds form. */
export interface Reaction {
  /** 0 shows the reactants, 1 the products. */
  progress(value: number): this;
  /** Every bond in the reactants, such as 'H–H' and 'O=O'. */
  readonly broken: readonly string[];
  /** Every bond in the products. */
  readonly formed: readonly string[];
  /** Null when a bond is ionic or has no tabled value. */
  readonly energy: ReactionEnergy | null;
  /** Each atom, the same one throughout. */
  readonly atoms: readonly Atom[];
  readonly handle: Handle;
}

export interface ProfileOptions {
  /** Energies of the reactants, the top of the hump and the products. */
  readonly reactants: number;
  readonly peak: number;
  readonly products: number;
  /** A lower top for the catalysed path, drawn dashed. */
  readonly catalysed?: number;
  /** Where it is drawn: [x, y, width, height]. Default: the stage. */
  readonly box?: ViewBox;
  /** Default 'kJ/mol'. */
  readonly unit?: string;
  /** Arrows and values for the activation energy and the energy change. Default true. */
  readonly labels?: boolean;
  /** Default ['reactants', 'products']. */
  readonly names?: readonly [string, string];
}

/** An energy profile: reactants, the activation hump and products. */
export interface Profile {
  set(values: { readonly reactants?: number; readonly peak?: number; readonly products?: number; readonly catalysed?: number | null }): this;
  /** A ball on the curve at this point of the reaction, 0 to 1; null hides it. */
  marker(progress: number | null): this;
  /** The energy on the curve at a point of the reaction, 0 to 1. */
  energy(progress: number): number;
  /** The peak above the reactants. */
  readonly activation: number;
  /** Products minus reactants: negative when energy is given out. */
  readonly change: number;
  readonly handle: Handle;
}

export interface Chemistry {
  /** One atom, drawn as a ball (or a symbol) in the element's tone. */
  atom(element: string, x: number, y: number, options?: AtomOptions): Atom;
  /** A bond between two atoms that follows them as they move. */
  bond(a: Atom, b: Atom, options?: BondOptions): Bond;
  /** A molecule or ion from its formula (H2O, CO2, NH4+, SO4^2-, C2H5OH, NaCl, CCl4, ...), with real bond lengths and angles, or from a structure you give. */
  molecule(formula: string | MoleculeStructure, options?: MoleculeOptions): Molecule;
  /** The electron shells of an element, centred on (x, y). */
  shells(element: string, x: number, y: number, options?: ShellOptions): Shells;
  /** A balanced equation, such as '2H2 + O2 -> 2H2O', acted out by its atoms. */
  reaction(equation: string, options?: ReactionOptions): Reaction;
  profile(options: ProfileOptions): Profile;
  readonly stage: Stage;
}

// ---------------------------------------------------------------------------
// Tweens
// ---------------------------------------------------------------------------

export type Ease = 'linear' | 'in' | 'out' | 'inOut' | 'spring';

/** A calm tour of one parameter while nobody touches the figure. */
export interface IdleOptions {
  /** The parameter to sweep across its range. */
  readonly sweep: string;
  /** Seconds without a touch before the tour starts. Default 4. */
  readonly after?: number;
  /** Seconds for one sweep there and back. Default 8. */
  readonly period?: number;
}

export interface TweenOptions {
  /** Duration in seconds of scene time. */
  readonly duration: number;
  readonly ease?: Ease;
  /** Called every frame with the eased fraction k from 0 to 1. */
  apply(k: number): void;
  /** Called once when the tween completes. */
  commit?(): void;
}

// ---------------------------------------------------------------------------
// The inc object
// ---------------------------------------------------------------------------

export interface Inc {
  param(name: string, options: ParamOptions): Param;
  toggle(name: string, options: ToggleOptions): Toggle;
  choice(name: string, options: ChoiceOptions): Choice;
  color(name: string, options: ColorOptions): ColorParam;
  /** A button; its action may return parameter values to set. */
  button(label: string, action: () => Values | void): void;
  /** Named sets of values, each a one-tap button. */
  presets(presets: Readonly<Record<string, Values>>): void;
  /** Keeps two parameters in step, such as frequency and period. */
  link(a: string, b: string, aToB: (a: number) => number, bToA: (b: number) => number): void;
  model<T extends object>(compute: (values: ParamValues) => T): Model<T>;
  onFrame(callback: (frame: FrameInfo) => void): void;
  /** Advances a simulation in fixed steps while playing; draw it in onFrame. */
  simulate(step: (dt: number) => void, options?: SimulateOptions): void;
  /** A cycle the learner can time in the settings panel; read it as frame.progress. */
  timeline(options: TimelineOptions): void;
  readonly state: State;
  /** Runs when the figure starts or restarts. */
  onReset(callback: () => void): void;
  onParamChange(callback: (name: string, value: number) => void): void;
  /** Runs when the teaching step changes; null when the walkthrough ends. */
  onStep(callback: (index: number | null) => void): void;
  readout(entries: Readonly<Record<string, () => Readable>>): void;
  /** A live table beside the drawing. */
  table(options: TableOptions): void;
  idea(sentence: string): void;
  /**
   * Lays the scene's panels, the elements its stages are drawn in, out
   * together: 'row' puts them side by side and stacks them when the figure is
   * narrow, 'column' puts them one above another, 'grid' two by two. Panels
   * of one scene share its model, controls and timeline (VI-7, C3-9).
   */
  layout(kind: PanelLayout): void;
  steps(steps: readonly Step[]): void;
  explain(text: () => string): void;
  describe(text: () => string): void;
  predict(options: PredictOptions): void;
  /** Offers a button that keeps a faint copy of the curves to compare against. */
  compare(): void;
  svg(selector: string, options: StageOptions): Stage;
  graph2d(selector: string, options: GraphOptions): Graph;
  /** A 3D scene the learner can turn. */
  space3d(selector: string, options: Space3DOptions): Space3D;
  /** A 3D graph of surfaces, curves and vectors. */
  graph3d(selector: string, options: Graph3DOptions): Graph3D;
  /** A 2D physics world: bodies, joints, liquids and forces, drawn for you. */
  physics2d(selector: string, options: Physics2DOptions): World2D;
  /** A bar, line, area, stacked, pie, histogram, box or scatter chart. */
  chart(selector: string, options: ChartOptions): Chart;
  /** A flowchart or state diagram that lays itself out. */
  flow(selector: string, options: FlowOptions): Flow;
  /** Atoms, bonds, molecules, electron shells, reactions and energy profiles. */
  chemistry(selector: string, options: ChemistryOptions): Chemistry;
  /** A formula of x, t, the parameters by name and its vars, such as inc.formula('A*sin(k*x - w*t)', { vars: { A: amplitude } }). */
  formula(source: string, options?: FormulaOptions): Formula;
  /** Seeded random number in [0, 1). Same seed, same sequence. */
  random(): number;
  tween(options: TweenOptions): void;
  /** Sweeps a parameter gently when nobody touches the figure; stops at the first touch and under reduced motion. */
  idle(options: IdleOptions): void;
  /** Symbols as text for labels: sym('v_0^2') is "v₀²", sym('Delta theta') is "Δ θ", sym('F -> m*a') is "F → m·a". */
  sym(source: string): string;
  /** A chemical formula as text: chem('SO4^2-') is "SO₄²⁻"; chem('2H2 + O2 -> 2H2O') is "2H₂ + O₂ → 2H₂O". Charges need ^ except a single + or -. */
  chem(source: string): string;
  readonly path: PathHelpers;
  readonly geom: GeometryHelpers;
  readonly calc: Calculus;
  readonly vec: VectorHelpers;
  readonly units: Units;
  readonly motion: MotionHelpers;
  readonly shapes: ShapeHelpers;
}
