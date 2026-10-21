/**
 * The public, scene-facing API of the Incantly SDK, version 0.1.
 *
 * Generated scenes reach the visualization environment only through the `inc`
 * object and the handles it returns. Nothing in this API returns a DOM node or
 * needs layout, so the same scene source runs in a Worker, in the main thread
 * or in Node (for the probe and the offline eval harness).
 */

/** Theme tones. Scenes never use literal colours. */
export type Tone = 'lo' | 'mid' | 'hi' | 'lit' | 'faint' | 'a' | 'b' | 'c';

export type Readable = string | number;

export type Vec2 = readonly [number, number];

export type ViewBox = readonly [number, number, number, number];

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

// ---------------------------------------------------------------------------
// SVG stage and element handles
// ---------------------------------------------------------------------------

export type Layer = 'back' | 'mid' | 'front' | 'labels';

export interface StageOptions {
  readonly viewBox: ViewBox;
  readonly title: string;
  readonly description?: string;
}

export interface ElementOptions {
  readonly layer?: Layer;
  readonly tone?: Tone;
  readonly parent?: Group;
  readonly dashed?: boolean;
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
  /** Writes attributes. Unchanged values cost nothing. */
  set(attributes: AttributeValues): this;
  at(x: number, y: number): this;
  rotate(degrees: number, cx?: number, cy?: number): this;
  scale(sx: number, sy?: number): this;
  show(visible?: boolean): this;
  hide(): this;
  tone(name: Tone): this;
  dashed(on?: boolean): this;
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

export interface Stage {
  readonly viewBox: ViewBox;
  group(options?: ElementOptions): Group;
  path(d?: string, options?: ElementOptions): PathHandle;
  line(x1: number, y1: number, x2: number, y2: number, options?: ElementOptions): Handle;
  circle(cx: number, cy: number, r: number, options?: ElementOptions): Handle;
  rect(x: number, y: number, width: number, height: number, options?: ElementOptions): Handle;
  text(x: number, y: number, value: Readable, options?: ElementOptions): TextHandle;
  polyline(points: ReadonlyArray<Vec2>, options?: ElementOptions): PolylineHandle;
  /** Registers a named part for highlighting, focus, steps and descriptions. */
  part<H extends Handle>(name: string, handle: H, options?: PartOptions): H;
}

// ---------------------------------------------------------------------------
// Path and geometry helpers (concept-neutral primitives)
// ---------------------------------------------------------------------------

export interface PathHelpers {
  line(points: ReadonlyArray<Vec2>): string;
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
  readonly vars?: Readonly<Record<string, Param | number>>;
}

// ---------------------------------------------------------------------------
// Graph 2D
// ---------------------------------------------------------------------------

export interface GraphOptions {
  readonly x: Vec2;
  readonly y: Vec2;
  readonly title: string;
  readonly description?: string;
  readonly axes?: boolean;
  readonly grid?: boolean;
  readonly labels?: { readonly x?: string; readonly y?: string };
  readonly viewBox?: ViewBox;
}

export interface CurveOptions {
  readonly tone?: Tone;
  readonly samples?: number;
  readonly dashed?: boolean;
}

export type PlotFunction = ((x: number, time: number) => number) | Formula;

export interface GraphCurve {
  readonly handle: PathHandle;
  show(visible?: boolean): this;
  tone(name: Tone): this;
}

export interface GraphPoint {
  readonly handle: Handle;
  at(x: number, y: number): this;
  show(visible?: boolean): this;
  tone(name: Tone): this;
}

export interface GraphSegment {
  readonly handle: Handle;
  between(x1: number, y1: number, x2: number, y2: number): this;
  show(visible?: boolean): this;
  tone(name: Tone): this;
}

export interface GraphArrow {
  readonly handle: PathHandle;
  from(x: number, y: number, dx: number, dy: number): this;
  show(visible?: boolean): this;
  tone(name: Tone): this;
}

export interface GraphTrail {
  readonly handle: PolylineHandle;
  add(x: number, y: number): this;
  clear(): this;
}

export interface Graph {
  readonly stage: Stage;
  toX(x: number): number;
  toY(y: number): number;
  plot(fn: PlotFunction, options?: CurveOptions): GraphCurve;
  parametric(
    fx: (t: number) => number,
    fy: (t: number) => number,
    t0: number,
    t1: number,
    options?: CurveOptions,
  ): GraphCurve;
  point(x: number, y: number, options?: { readonly tone?: Tone; readonly r?: number }): GraphPoint;
  segment(x1: number, y1: number, x2: number, y2: number, options?: CurveOptions): GraphSegment;
  arrow(x: number, y: number, dx: number, dy: number, options?: CurveOptions): GraphArrow;
  trail(options?: { readonly tone?: Tone; readonly max?: number }): GraphTrail;
  label(x: number, y: number, value: Readable, options?: ElementOptions): TextHandle;
}

// ---------------------------------------------------------------------------
// Tweens
// ---------------------------------------------------------------------------

export type Ease = 'linear' | 'in' | 'out' | 'inOut';

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
  model<T extends object>(compute: (values: ParamValues) => T): Model<T>;
  onFrame(callback: (frame: FrameInfo) => void): void;
  readout(entries: Readonly<Record<string, () => Readable>>): void;
  idea(sentence: string): void;
  steps(steps: readonly Step[]): void;
  explain(text: () => string): void;
  describe(text: () => string): void;
  svg(selector: string, options: StageOptions): Stage;
  graph2d(selector: string, options: GraphOptions): Graph;
  formula(source: string, options?: FormulaOptions): Formula;
  /** Seeded random number in [0, 1). Same seed, same sequence. */
  random(): number;
  tween(options: TweenOptions): void;
  readonly path: PathHelpers;
  readonly geom: GeometryHelpers;
}
