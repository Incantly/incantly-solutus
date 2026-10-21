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
  /** Fill a path or polyline with its tone instead of stroking it. */
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
  polyline(points: ReadonlyArray<Vec2>, options?: ElementOptions): PolylineHandle;
  /** Registers a named part for highlighting, focus, steps and descriptions. */
  part<H extends Handle>(name: string, handle: H, options?: PartOptions): H;
  /** Lets the learner drag an element; `map` turns the pointer into parameter values. */
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

export type Ease = 'linear' | 'in' | 'out' | 'inOut' | 'spring';

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
  steps(steps: readonly Step[]): void;
  explain(text: () => string): void;
  describe(text: () => string): void;
  predict(options: PredictOptions): void;
  /** Offers a button that keeps a faint copy of the curves to compare against. */
  compare(): void;
  svg(selector: string, options: StageOptions): Stage;
  graph2d(selector: string, options: GraphOptions): Graph;
  formula(source: string, options?: FormulaOptions): Formula;
  /** Seeded random number in [0, 1). Same seed, same sequence. */
  random(): number;
  tween(options: TweenOptions): void;
  readonly path: PathHelpers;
  readonly geom: GeometryHelpers;
}
