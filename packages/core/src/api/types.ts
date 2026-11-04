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
  /** What the step says, beside the drawing. */
  readonly say: string;
  /** A part to direct attention to. */
  readonly focus?: string;
  /** Values to move to on this step. */
  readonly set?: Readonly<Record<string, number>>;
  /** Pause time on this step. */
  readonly hold?: boolean;
  /** 3D stages turn to this view, eased; flat drops perspective. */
  readonly view?: View3D;
  readonly flat?: boolean;
}

/** How one scene ends and the next begins. */
export type SceneCut = 'cut' | 'fade' | 'wipe' | 'push';

/** A camera move to a part, eased; the next beat returns to wide unless it sets its own. */
export interface BeatCam {
  /** Part to frame. */
  readonly to?: string;
  /** Zoom factor about the part; 1 keeps the wide view. */
  readonly zoom?: number;
}

/** One emphasis on a part: a pulse of its highlight, a draw-on, an arrow, a callout, or dimming the rest. */
export interface BeatMark {
  readonly type: 'pulse' | 'draw' | 'arrow' | 'callout' | 'dim';
  /** Part to emphasize; annotation parts are drawn by the scene, hidden, and brought in by the beat. */
  readonly part: string;
}

/** A title card over the drawing, or a lower third in the caption band. */
export interface BeatTitle {
  readonly text: string;
  /** Default 'lower'. */
  readonly kind?: 'card' | 'lower';
}

/** Pause and invite the learner to try a control, then resume the film. */
export interface BeatExplore {
  /** Control the learner is invited to change. */
  readonly control: string;
  /** Short invitation shown beside the drawing. */
  readonly hint?: string;
}

/**
 * One narrated beat of a film: a step with cues. The scene names what it
 * wants on each beat (say this line, zoom to this part, pulse that one);
 * the engine does the timing, camera, captions and audio. Every field is
 * optional and additive over Step, so a beat is still a step.
 */
export interface Beat extends Step {
  /** Stable id within the film, such as `s1b1`; the storyboard and anchors use it. */
  readonly id?: string;
  /** Seconds over which `set` moves; default is the step transition. */
  readonly ease?: number;
  /** Camera move to a part, eased. */
  readonly cam?: BeatCam;
  /** Parts brought in on this beat. */
  readonly show?: readonly string[];
  /** Parts taken out on this beat. */
  readonly hide?: readonly string[];
  /** Emphasis on parts, at most one moving at a time. */
  readonly mark?: readonly BeatMark[];
  /** Title card or lower third, placed by the layout solver. */
  readonly title?: string | BeatTitle;
  /** Short on-screen text for titles and callouts. */
  readonly short?: string;
  /** Named cue from the sound kit, such as `arrive` or `chime`. */
  readonly sfx?: string;
  /** Pause and invite the learner to try a control. */
  readonly explore?: BeatExplore;
  /** A prediction question that waits for the learner. */
  readonly predict?: PredictOptions;
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

/** A pivot in the same units as at(). */
export interface RotateOptions {
  readonly about: Vec2;
}

export interface StageOptions {
  readonly viewBox?: ViewBox;
  readonly title: string;
  readonly description?: string;
  /** Learners may zoom and pan; default true. */
  readonly zoom?: boolean;
  /** Offers the measuring tool, reading lengths in `unit` with `per` stage units to one, such as { unit: 'm', per: 110 }. */
  readonly measure?: { readonly unit: string; readonly per: number };
  /** Frames whatever it draws. */
  readonly fit?: boolean;
}

export interface ElementOptions {
  readonly layer?: Layer;
  readonly tone?: Tone;
  readonly parent?: Group;
  readonly dashed?: boolean;
  /** Fill a path or polyline with its tone instead of stroking it; false outlines a circle or rect instead of filling it. */
  readonly fill?: boolean;
  readonly shade?: Shade;
  /** A soft halo in its own tone, for light, heat or a charge. */
  readonly glow?: boolean;
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
  /** Moves it so its own (0, 0) sits at x, y. */
  at(x: number, y: number): this;
  /** Clockwise, about where at() put it or a point. */
  rotate(degrees: number, pivot?: RotateOptions): this;
  scale(sx: number, sy?: number): this;
  show(visible?: boolean): this;
  hide(): this;
  tone(name: Tone): this;
  dashed(on?: boolean): this;
  /** Moves dashes along the stroke at `speed` units per second (current, flow); 0 stops. */
  flow(speed: number): this;
  /** A soft halo in its own tone, such as a lamp that is on. */
  glow(on?: boolean): this;
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
  /** 'front' (default) over the whole drawing; 'back' over the back layer and under the rest of the drawing. */
  readonly layer?: 'back' | 'front';
  /** Each dot glows in its tone, as sparks, stars or charges. */
  readonly glow?: boolean;
}

/** Many small dots (particles) drawn on a canvas sharing the stage's coordinates. */
export interface Dots {
  set(points: ReadonlyArray<Vec2>): this;
  tone(name: Tone): this;
}

export interface FluidOptions {
  /** Particles carried by the flow, from 10 to 2000. Default 400. */
  readonly count?: number;
  /** Where particles start, and start again when they leave it: [x, y, width, height] in stage units. Default the view box. */
  readonly region?: ViewBox;
  /** Seconds a particle drifts before it starts again elsewhere, so the flow stays filled. Default 4. */
  readonly life?: number;
  /** Seconds a particle's streak takes to fade, from 0 (dots only) to 3. Default 0.6. */
  readonly trail?: number;
  readonly tone?: Tone;
  /** Dot radius and streak width. Default 1.5. */
  readonly r?: number;
  /** Default 'back': over the back layer (a grid, a tank's water) and under the rest of the drawing, so what stands in the flow stays on top. */
  readonly layer?: 'back' | 'front';
  readonly glow?: boolean;
}

/** Particles carried by a velocity field, drawn with fading streaks on the stage's canvas layer (FX-1). */
export interface Fluid {
  tone(name: Tone): this;
  show(visible?: boolean): this;
  hide(): this;
  /** Scatters every particle afresh. */
  reset(): this;
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
  /** Registers a named part for highlighting, focus, steps and descriptions. Naming a part again renames it. */
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
  /**
   * A flowing fluid, wind or current: particles carried by `velocity`, a
   * function of the stage point giving [vx, vy] in stage units per second
   * (y points down), that move while the figure plays and leave fading streaks.
   */
  fluid(velocity: (x: number, y: number) => Vec2, options?: FluidOptions): Fluid;
}

// ---------------------------------------------------------------------------
// Path and geometry helpers (concept-neutral primitives)
// ---------------------------------------------------------------------------

/** Where an arrow starts and where its tip is: give to, or by for an offset from the start. */
export type ArrowPoints = { readonly from: Vec2; readonly to: Vec2 } | { readonly from: Vec2; readonly by: Vec2 };

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
  /** An arrow from a point to its tip: { from: [x, y], to: [x, y] }, or { from, by: [dx, dy] } for a tip at from + by. */
  arrow(arrow: ArrowPoints, head?: number): string;
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

export interface GearOptions {
  readonly center: Vec2;
  readonly radius: number;
  readonly teeth?: number;
  /** How tall the teeth stand, in stage units. */
  readonly toothDepth?: number;
  /** How far it has turned, in radians, as regular() takes it. */
  readonly rotation?: number;
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
  /** A gear or sprocket: its centre, its outer radius and its teeth, toothDepth in stage units (default 0.18 of the radius). */
  gear(gear: GearOptions): string;
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
  /** The formula at a value of its own variable, x unless it was made with another, and a time t (scene time by default). */
  (value: number, t?: number): number;
  readonly source: string;
  readonly variables: readonly string[];
  /** Its own variable: x, or y, theta or t when made with that input. */
  readonly input: FormulaInput;
  evaluate(scope: Readonly<Record<string, number>>): number;
}

/**
 * A formula's own variable. x for y = f(x); y for x = f(y) (graph.plotX);
 * theta for r = f(theta) (graph.polar); t for a parametric curve's
 * parameter (graph.parametric), when scene time is not available in it.
 */
export type FormulaInput = 'x' | 'y' | 'theta' | 't';

export interface FormulaOptions {
  /** Short names for parameters or numbers, such as { A: amplitude }. Parameters declared before the formula can also be used by their own names. */
  readonly vars?: Readonly<Record<string, Param | number>>;
  /** The learner can edit the formula, shown as maths beside its field; their edit replaces it everywhere. Default true; false keeps it fixed. */
  readonly editable?: boolean;
  readonly label?: string;
  /** Its own variable, x by default: y for x = f(y), theta for r = f(theta), t for a parametric curve. */
  readonly input?: FormulaInput;
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
  /** x = f(y): a function of y, or a formula made with input: 'y', shown as x = its source. */
  plotX(fn: (y: number, time: number) => number, options?: CurveOptions): GraphCurve;
  /** r = f(theta), theta from `from` to `to` (default a full turn): a function, or a formula made with input: 'theta', shown as r = its source. */
  polar(fn: (theta: number, time: number) => number, options?: CurveOptions & { readonly from?: number; readonly to?: number }): GraphCurve;
  /** (x(t), y(t)) for t from t0 to t1: two functions, or two formulas made with input: 't', shown as (x, y) = their sources. */
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
  /** Text at a point in data units; its at(x, y) moves it in data units too, as a point's does. */
  label(x: number, y: number, value: Readable, options?: ElementOptions): TextHandle;
  /** An equation drawn as maths at a point in data units, as stage.equation does (DG-5); its at() takes data units. */
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
  /** Degrees looking down; 90 is straight down. Default 25. */
  readonly pitch?: number;
  /** Stage units per world unit. Default: fits the view. */
  readonly scale?: number;
  /** Distance for perspective, in world units; 0 for none. Default 5 × the scene's size. */
  readonly distance?: number;
  /** The world point at the centre of the view. Default [0, 0, 0]. */
  readonly target?: Vec3;
}

/** Named camera views: front looks along +y, side along -x, top straight down, iso is isometric. */
export type View3D = 'front' | 'side' | 'top' | 'iso';

/** Eases the camera there over seconds (default 0, a cut), even paused. flat: true drops perspective, false restores it. */
export interface CameraMove {
  readonly seconds?: number;
  readonly ease?: Ease;
  readonly flat?: boolean;
}

export interface Space3DOptions {
  readonly title: string;
  readonly description?: string;
  /** Default [0, 0, 640, 440]. */
  readonly viewBox?: ViewBox;
  readonly camera?: CameraOptions;
  /** 'orbit' (default): dragging turns the camera; 'iso': fixed isometric; 'fixed': the scene's camera only. */
  readonly mode?: 'orbit' | 'iso' | 'fixed';
  /** Learners may zoom; default true. */
  readonly zoom?: boolean;
  /** Most faces drawn at once; above it round solids get fewer facets. Default 1200. */
  readonly budget?: number;
}

export interface Solid3DOptions {
  readonly at?: Vec3;
  /** Degrees about x, then y, then z. */
  readonly rotate?: Vec3;
  readonly scale?: number | Vec3;
  readonly tone?: Tone;
  readonly parent?: Group3D;
  /** 'solid' (default) is shaded; 'wire' draws edges only; 'ghost' is faint and see-through; 'shadow' is a dark see-through layer, for a night side or a shadow. */
  readonly look?: 'solid' | 'wire' | 'ghost' | 'shadow';
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
  /** The label at its tip; an arrow made without the label option gets one the first time. */
  label(text: Readable): this;
}

export interface Dots3DOptions {
  readonly tone?: Tone;
  /** Dot radius in stage units, the same near and far: from 0 to 50. Default 3. */
  readonly r?: number;
  /** 'back' (default) behind every solid, showing through a see-through look: 'ghost'; 'front' over the whole figure. */
  readonly layer?: 'back' | 'front';
  /** Each dot glows in its tone, as stars, sparks or charges. */
  readonly glow?: boolean;
  /** A group the dots move, turn and hide with. */
  readonly parent?: Group3D;
}

/** Up to 2000 dots at points [x, y, z], placed, turned and scaled as one object. Points that are not three numbers are left out. */
export interface Dots3D extends Object3D {
  set(points: ReadonlyArray<Vec3>): this;
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

export interface LatheOptions extends Solid3DOptions {
  /** Leave ends off the axis open, as for a glass, instead of capping them. */
  readonly open?: boolean;
}

/**
 * Ready-made models (S3-9), 2 units on their largest side, standing on z = 0 or centred (c), vehicles facing +x.
 * Pieces in brackets, * hidden: rocket [nose body window fins engine flame*], satellite c [body panels dish],
 * airplane c [fuselage wings tail engines], car [body cabin wheels], cart [body wheels], boat [hull cabin],
 * wind-turbine [tower nacelle rotor], tree and pine [trunk leaves], house [walls roof door windows chimney],
 * person [head body legs], table [top legs], ramp (30°, down toward +x), pulley c [wheel axle mount],
 * mass [weight hook], magnet [north south], compass [case needle], battery [body cap terminal],
 * bulb [glass filament base], flask, beaker and test-tube [glass liquid], burner [base barrel flame],
 * prism, lens c, concave-lens c (axis x), gear c [gear hub], planet c [planet axis*], ringed-planet c [planet rings].
 */
export type ModelName =
  | 'rocket'
  | 'satellite'
  | 'airplane'
  | 'car'
  | 'cart'
  | 'boat'
  | 'wind-turbine'
  | 'tree'
  | 'pine'
  | 'house'
  | 'person'
  | 'table'
  | 'ramp'
  | 'pulley'
  | 'mass'
  | 'magnet'
  | 'compass'
  | 'battery'
  | 'bulb'
  | 'flask'
  | 'beaker'
  | 'test-tube'
  | 'burner'
  | 'prism'
  | 'lens'
  | 'concave-lens'
  | 'gear'
  | 'planet'
  | 'ringed-planet';

/**
 * One node of a model of your own, glTF-style: at most one solid, given as
 * the Space3D call of the same name takes it, placed and turned within its
 * parent, with children placed within it.
 */
export interface ModelNode {
  /** Makes it a piece: model.piece(name) reaches it, and the parts and labels options name it. */
  readonly name?: string;
  /** What the legend and labels call it. Default its name. */
  readonly label?: string;
  readonly box?: number | Vec3;
  readonly sphere?: number;
  /** [r, h]: standing along z, centred. */
  readonly cylinder?: readonly [number, number];
  /** [r, h]: standing along z, centred, its tip up. */
  readonly cone?: readonly [number, number];
  /** [R, r]: lying in the xy plane. */
  readonly torus?: readonly [number, number];
  /** [w, d]: flat in the xy plane. */
  readonly plane?: readonly [number, number];
  /** [from, to, r]. */
  readonly tube?: readonly [Vec3, Vec3, number];
  /** A profile of [r, z] points turned about z, as space.lathe takes it. */
  readonly lathe?: ReadonlyArray<Vec2>;
  /** For a lathe: leave ends off the axis open. */
  readonly open?: boolean;
  readonly mesh?: Mesh3DData;
  readonly at?: Vec3;
  /** Degrees about x, then y, then z. */
  readonly rotate?: Vec3;
  readonly scale?: number | Vec3;
  /** 'main' and 'trim' are the model's two colours, set by its tone and trim options. Default the parent's, or 'main'. */
  readonly tone?: Tone | 'main' | 'trim';
  /** Default the parent's, or 'solid'. */
  readonly look?: 'solid' | 'wire' | 'ghost' | 'shadow';
  readonly segments?: number;
  /** Starts hidden, for piece(name).show() to reveal. */
  readonly hidden?: boolean;
  /** Moves it toward the viewer in the drawing order, in the model's units, for something flat on a face such as a door. Default the parent's. */
  readonly bias?: number;
  readonly children?: ReadonlyArray<ModelNode>;
}

/** A model of your own, in the shape of the ready-made ones. */
export interface ModelData {
  readonly nodes: ReadonlyArray<ModelNode>;
  /** What 'main' stands for. Default 'mid'. */
  readonly tone?: Tone;
  /** What 'trim' stands for. Default 'a'. */
  readonly trim?: Tone;
}

export interface ModelOptions extends Solid3DOptions {
  /** Its largest side. Default 2 for a ready-made model; data keeps its own size. */
  readonly size?: number;
  /** Its second colour; tone sets the main one. */
  readonly trim?: Tone;
  /** Names its pieces as parts (true, or a list of pieces). */
  readonly parts?: boolean | ReadonlyArray<string>;
  /** Labels its pieces beside it, joined by leaders (true, or a list). */
  readonly labels?: boolean | ReadonlyArray<string>;
}

/** A placed model: a group of named pieces. */
export interface Model3D extends Group3D {
  /** A piece by name, such as 'nose': an object that turns about its own origin. */
  piece(name: string): Object3D;
  readonly pieces: ReadonlyArray<string>;
}

export interface GridOptions {
  /** 'xy' (default, the floor), 'xz', 'yz', or any plane through `at` square to `normal`, such as { normal: [1, 1, 0] }. */
  readonly plane?: 'xy' | 'xz' | 'yz' | { readonly normal: Vec3 };
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
  /** A solid of revolution: [r, z] profile points (2 to 120) turned about z. */
  lathe(profile: ReadonlyArray<Vec2>, options?: LatheOptions): Object3D;
  /** A ready-made model (ModelName), or ModelData of your own. */
  model(name: ModelName | ModelData, options?: ModelOptions): Model3D;
  group(options?: Solid3DOptions): Group3D;
  line(points: ReadonlyArray<Vec3>, options?: Line3DOptions): Line3D;
  /** A 3D segment with a head that always faces the viewer. */
  arrow(from: Vec3, to: Vec3, options?: Line3DOptions): Arrow3D;
  /** A helix along z (a spring, a solenoid's wire), sorted piece by piece so it wraps what runs through it. */
  coil(r: number, h: number, turns: number, options?: Line3DOptions): Line3D;
  /** An angle arc: `from` (a vector from `center`) turned about `axis` by `degrees`. */
  arc(center: Vec3, from: Vec3, axis: Vec3, degrees: number, options?: Line3DOptions): Line3D;
  /** A dot that keeps its size on screen. */
  point(at: Vec3, options?: { readonly tone?: Tone; readonly parent?: Group3D; readonly r?: number }): Object3D;
  /** Dots at world points (stars, a gas, charge) on the canvas layer: they follow the camera and do not widen the view. */
  dots(options?: Dots3DOptions): Dots3D;
  /** Text at a point or object, pushed outward so labels do not collide. */
  label(target: Vec3 | Object3D, text: Readable, options?: { readonly tone?: Tone; readonly offset?: number }): Label3D;
  grid(options?: GridOptions): Object3D;
  axes(options?: AxesOptions): Group3D;
  /** Field lines traced through a vector field from seed points. */
  fieldLines(field: (p: Vec3) => Vec3, seeds: ReadonlyArray<Vec3>, options?: FieldLineOptions): Group3D;
  /** Names an object for highlighting, steps, legend and descriptions; naming it again renames it. */
  part<T extends Object3D>(name: string, object: T, options?: PartOptions): T;
  /** Lets the learner drag an object; `map` gets the pointer in stage units (see pick). */
  drag<T extends Object3D>(object: T, map: DragMap, options?: { readonly label?: string }): T;
  /** The world point at height z under a stage point, or null. */
  pick(x: number, y: number, z?: number): Vec3 | null;
  /** Moves the camera; options not given stay. */
  camera(options: CameraOptions, move?: CameraMove): void;
  view(name: View3D, move?: CameraMove): void;
  /** A world point in stage units. */
  project(p: Vec3): Vec2;
  /** The 2D stage underneath, for flat overlays. */
  readonly stage: Stage;
}

/** [min, max]; an end may be a function, read every draw, to follow a parameter: t: [0, () => turns.value * 2 * Math.PI]. */
export type Span = readonly [number | (() => number), number | (() => number)];

export interface Graph3DOptions {
  readonly title: string;
  readonly description?: string;
  /** The box grows to hold a curve whose t range follows a parameter. */
  readonly x: Span;
  readonly y: Span;
  readonly z: Span;
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
  readonly u: Span;
  readonly v: Span;
}

export interface Curve3DOptions {
  readonly t: Span;
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
  camera(options: CameraOptions, move?: CameraMove): void;
  view(name: View3D, move?: CameraMove): void;
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
  /** Centre in metres, as an [x, y] pair. */
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
  /** N/m, above 0. Default 50. */
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
  /** Names an element, or a kit object with a handle such as a body, a tank or a molecule, for highlighting, steps and descriptions, as stage.part does. Naming a part again renames it. */
  part<T extends Handle | { readonly handle: Handle }>(name: string, item: T, options?: PartOptions): T;
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

/** A series handle: updates the series, and is not an element for part(). The series is already a part under its name. */
export interface ChartSeries {
  readonly name: string;
  set(data: ChartData | ReadonlyArray<Vec2> | (() => ReadonlyArray<Vec2>)): this;
  tone(name: Tone): this;
  show(visible?: boolean): this;
  hide(): this;
}

export interface Chart {
  /** Exactly one value per category, 1 to 60 values; histograms and box plots take up to 20000 raw samples, one series per box. */
  series(name: string, data: ChartData, options?: ChartSeriesOptions): ChartSeries;
  /** Scatter points as [x, y] pairs, 1 to 2000. */
  points(name: string, data: ReadonlyArray<Vec2> | (() => ReadonlyArray<Vec2>), options?: ChartSeriesOptions): ChartSeries;
  /** A level reference line, such as a mean. */
  rule(value: number | (() => number), options?: { readonly label?: string; readonly tone?: Tone; readonly dashed?: boolean }): Handle;
  /** Picks out one category by index, or none with null. */
  highlight(index: number | null): void;
  readonly stage: Stage;
  /** Names an element, or a kit object with a handle such as a body, a tank or a molecule, for highlighting, steps and descriptions, as stage.part does. Naming a part again renames it. */
  part<T extends Handle | { readonly handle: Handle }>(name: string, item: T, options?: PartOptions): T;
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
  /** Names an element, or a kit object with a handle such as a body, a tank or a molecule, for highlighting, steps and descriptions, as stage.part does. Naming a part again renames it. */
  part<T extends Handle | { readonly handle: Handle }>(name: string, item: T, options?: PartOptions): T;
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
  /** Names an element, or a kit object with a handle such as a body, a tank or a molecule, for highlighting, steps and descriptions, as stage.part does. Naming a part again renames it. */
  part<T extends Handle | { readonly handle: Handle }>(name: string, item: T, options?: PartOptions): T;
}

// ---------------------------------------------------------------------------
// Biology: inc.biology (the biology kit, loaded on demand)
// ---------------------------------------------------------------------------

export interface BiologyOptions {
  readonly title: string;
  readonly description?: string;
  /** Default [0, 0, 640, 400]. */
  readonly viewBox?: ViewBox;
}

export type CellKind = 'animal' | 'plant' | 'bacterium';

export type Organelle =
  | 'membrane'
  | 'cytoplasm'
  | 'nucleus'
  | 'nucleolus'
  | 'mitochondria'
  | 'ribosomes'
  | 'er'
  | 'golgi'
  | 'vacuole'
  | 'chloroplasts'
  | 'wall'
  | 'nucleoid'
  | 'plasmids'
  | 'flagellum';

export interface CellOptions {
  /** Default 'animal'. */
  readonly kind?: CellKind;
  /** Its width in stage units. Default 300. */
  readonly size?: number;
  /** The organelles to draw. Default: every one the kind has. */
  readonly organelles?: readonly Organelle[];
  /** The same seed draws the same outline. Default 1. */
  readonly seed?: number;
}

/** A cell with its organelles: animal, plant or bacterium. */
export interface Cell {
  readonly kind: CellKind;
  /** The organelles drawn. */
  readonly organelles: readonly Organelle[];
  /** An organelle's drawing, for parts, callouts and connectors. */
  organelle(name: Organelle): Handle;
  /** A point on an organelle, for labels and arrows. */
  where(name: Organelle): Vec2;
  at(x: number, y: number): this;
  show(visible?: boolean): this;
  hide(): this;
  readonly handle: Handle;
}

export interface MembraneOptions {
  /** Where it is drawn: [x, y, width, height]; the membrane runs down the middle. Default: the stage. */
  readonly box?: ViewBox;
  /** Particles on the left and the right at the start, rounded to whole particles. */
  readonly particles: readonly [number, number];
  /** Channel proteins particles pass through. Default 3; 0 lets them cross anywhere. */
  readonly channels?: number;
  /** The chance a particle reaching a channel goes through, 0 to 1. Default 1. */
  readonly permeability?: number;
  /** Particles a second pumped from left to right against the gradient, as in active transport. Default 0. */
  readonly pump?: number;
  /** Stage units a second. Default 60. */
  readonly speed?: number;
  readonly tone?: Tone;
}

/** Particles diffusing across a membrane: down their gradient through channels, or pumped against it. */
export interface Membrane {
  /** Particles on each side now. */
  readonly left: number;
  readonly right: number;
  /** Particles that have crossed: left to right, minus right to left. */
  readonly crossed: number;
  set(values: { readonly permeability?: number; readonly pump?: number; readonly speed?: number }): this;
  /** Starts again with these particles on each side. */
  reset(left: number, right: number): this;
  readonly handle: Handle;
}

export interface HelixOptions {
  /** One strand's bases, read 5′ to 3′: A, T, G and C. */
  readonly sequence: string;
  /** Its two ends. */
  readonly from: Vec2;
  readonly to: Vec2;
  /** Half its width. Default 34. */
  readonly radius?: number;
  /** Base pairs per full turn. Default 10. */
  readonly perTurn?: number;
  /** Letters on the bases. Default true. */
  readonly letters?: boolean;
  /** Turns per second while playing. Default 0. */
  readonly spin?: number;
}

/** DNA's double helix: two backbones and the base pairs between them, A with T and G with C. */
export interface Helix {
  readonly sequence: string;
  /** The paired strand, base by base: ATGC pairs with TACG. */
  readonly partner: string;
  /** Opens the strands from the start: 0 joined, 1 fully apart, as in replication. */
  unzip(fraction: number): this;
  /** One base pair's drawing, for parts. */
  base(index: number): Handle;
  readonly handle: Handle;
}

export interface StreamOptions {
  /** Particles along the path. Default 12. */
  readonly count?: number;
  /** Stage units a second; negative runs backwards. Default 40. */
  readonly speed?: number;
  /** 'dot' (default) or 'cell', a disc like a red blood cell. */
  readonly shape?: 'dot' | 'cell';
  /** Radius in stage units. Default 5. */
  readonly size?: number;
  readonly tone?: Tone;
  /** Draws the path as a vessel this wide. Default 0: not drawn. */
  readonly width?: number;
}

/** Particles flowing along a path, such as blood cells through a vessel. */
export interface Stream {
  set(values: { readonly speed?: number }): this;
  /** Where particle `index` is now. */
  at(index: number): Vec2;
  readonly handle: Handle;
}

export interface Biology {
  /** A cell with its organelles, centred on (x, y). */
  cell(x: number, y: number, options?: CellOptions): Cell;
  membrane(options: MembraneOptions): Membrane;
  helix(options: HelixOptions): Helix;
  /** Particles flowing along the path through these points. */
  stream(points: ReadonlyArray<Vec2>, options?: StreamOptions): Stream;
  readonly stage: Stage;
  /** Names an element, or a kit object with a handle such as a body, a tank or a molecule, for highlighting, steps and descriptions, as stage.part does. Naming a part again renames it. */
  part<T extends Handle | { readonly handle: Handle }>(name: string, item: T, options?: PartOptions): T;
}

// ---------------------------------------------------------------------------
// Anatomy: animals grown from their bones
// ---------------------------------------------------------------------------

export interface AnatomyOptions {
  readonly title: string;
  readonly description?: string;
  /** Default [0, 0, 800, 400]. */
  readonly viewBox?: ViewBox;
}

/** How a foot meets the ground: on the whole sole, on the toes, or on the tip of a hoof. */
export type FootPosture = 'plantigrade' | 'digitigrade' | 'unguligrade';

/** One limb, each bone as a fraction of the body length. */
export interface LimbBones {
  /** Thigh, or upper arm. */
  readonly upper: number;
  /** Shin, or forearm. */
  readonly lower: number;
  /** Foot or hand: the bones from the ankle or wrist to the tips of the toes. */
  readonly foot: number;
  /** Overrides the posture the kit reads from the foot's length. */
  readonly posture?: FootPosture;
}

/** The ways of moving a skeleton may support. */
export type AnatomyMode = 'quadruped' | 'bipedal';

/**
 * A skeleton: the only thing a scene writes about an animal, measured from
 * what you know of that animal's real bones. Lengths are fractions of `size`,
 * the body length in metres from the nose to the root of the tail. The kit
 * reads the posture, muscles, outline and gait from them, so get the
 * proportions right: a cheetah's shin is longer than its thigh; a horse's
 * foot bones (cannon and pastern) are as long as its shin, so it stands on
 * hooves; a mouse has a long tail and short legs; a bird has wings: true,
 * no forelimb, long legs and a level body. Lengths are fractions, rarely
 * above 1 (a spine is about 0.5 to 0.7 of the body). The kit
 * gives it only a plain body, like no animal in particular: then draw what
 * makes it this animal with animal.skin (its ears, muzzle, coat colour and
 * markings, tail), as a cheetah's spots and tear lines or a zebra's stripes.
 */
export interface SkeletonSpec {
  /** Body length in metres, nose to the root of the tail. */
  readonly size?: number;
  /** `depth` is the skull's height as a fraction of its length; `snout` the share of the skull ahead of the eye. */
  readonly skull?: { readonly length: number; readonly depth?: number; readonly snout?: number };
  readonly neck?: { readonly length: number };
  /** `flex`, from 0 (stiff, a horse) to 1 (a cheetah), is how far the back bends when running. */
  readonly spine?: { readonly length: number; readonly flex?: number };
  /** Leave out for an animal with none, or set hints.wings. */
  readonly forelimb?: LimbBones;
  readonly hindlimb?: LimbBones;
  /** `stiffness` from 0 (whippy) to 1. Length 0 for no tail. */
  readonly tail?: { readonly length: number; readonly stiffness?: number };
  /** Limbs under the body (default) or out to the side, as a lizard's. */
  readonly stance?: 'upright' | 'sprawl';
  /** Ways of moving it supports; the first is how it starts. Default from the build. */
  readonly modes?: readonly AnatomyMode[];
  /** The forelimbs are folded wings, as a bird's. */
  readonly wings?: boolean;
  /**
   * Where its feet stand on the stage: the middle of the animal, on the
   * ground. Leave it out to stand several animals side by side on one
   * ground line. Every animal on a stage is drawn at one scale, so their
   * sizes compare as in life.
   */
  readonly at?: Vec2;
  /** Stage units the animal may take across; it is scaled to fit. */
  readonly width?: number;
  readonly facing?: 'right' | 'left';
  /** Body tone. Default mid. */
  readonly tone?: Tone;
  /** Draws a ground line under it that moves with its speed. Default true. */
  readonly ground?: boolean;
  /** What shows: the skin (default), the muscles under it, or the bones. */
  readonly show?: AnatomyLayer;
}

export type AnatomyLayer = 'skin' | 'muscles' | 'bones';

/** The pieces of an animal a part can name. */
export type AnatomyPiece = 'body' | 'head' | 'neck' | 'tail' | 'forelimbs' | 'hindlimbs' | 'muscles' | 'bones';

export type Gait = 'stand' | 'walk' | 'trot' | 'gallop' | 'bound' | 'run';

export interface MoveOptions {
  /** Metres a second: a number, a parameter, or a function of the model. */
  readonly speed?: number | Param | (() => number);
  /** Switches to this way of moving, at scene time `at` seconds or now; a function is read every frame. */
  readonly mode?: AnatomyMode | (() => AnatomyMode);
  readonly at?: number;
  /** A gait to move in rather than the one the speed calls for; the speed still sets how fast the legs go. */
  readonly gait?: Gait | (() => Gait);
  /** Degrees to raise the neck and head (negative lowers them, as to graze): a number, a parameter, or a function. */
  readonly neck?: number | Param | (() => number);
}

/**
 * The bones skin is drawn on. Each is a frame that moves and bends with the
 * animal: thigh, shin and hindfoot one bone each, hindleg the three as one
 * chain that bends at the knee and ankle (likewise the foreleg). ear sits at
 * the back of the skull and points the way the skull does.
 */
export type SkinBone = 'spine' | 'neck' | 'skull' | 'ear' | 'tail' | 'wing' | 'hindleg' | 'thigh' | 'shin' | 'hindfoot' | 'foreleg' | 'upperArm' | 'forearm' | 'forefoot';

/**
 * A piece of skin drawn in a bone's frame. Every point is [along, across],
 * measured in lengths of that bone (or chain): along runs from 0 at its start
 * (the hip end of the spine, the back of the skull, the top of a leg, the
 * root of the tail) to 1 at its end, and across is up for the spine, neck,
 * skull, ear, wing and tail, and forward for the legs. The kit moves it with
 * the bone on every frame and outlines it with the body.
 */
export interface SkinShape {
  /** The outline's points, at least 3; for a line, at least 2. */
  readonly points?: readonly Vec2[];
  /** Or an ellipse centred here, with radius r, or [along, across] radii. */
  readonly at?: Vec2;
  readonly r?: number | Vec2;
  /** A smooth curve through the points (default), or straight sides. */
  readonly smooth?: boolean;
  /**
   * flesh (default) joins the body: same tone, one outline round both.
   * part sits over the body with its own outline: an ear, a collar, a horn.
   * mark paints the skin with no outline: spots, a saddle, an eye, a nose.
   * line is an open stroke: whiskers, a mouth, fur.
   */
  readonly as?: 'flesh' | 'part' | 'mark' | 'line';
  /** Default: the body's tone for flesh and parts, hi for marks and lines. */
  readonly tone?: Tone;
  /** Removes the kit's own skin on this bone first, to draw it your own way. Replacing the skull takes its eye and nose too. */
  readonly replace?: boolean;
}

/** An animal the kit grew from a skeleton. Its gait comes from its speed and build. */
export interface Animal {
  /** Sets how it moves; the kit picks the gait. */
  move(options: MoveOptions): this;
  /**
   * Draws skin on a bone: the shapes that make the breed or species, such as
   * a long muzzle, tall ears, a mane or a saddle. The kit's own plain skin
   * stays everywhere else. Limb skin is drawn on both sides.
   */
  skin(bone: SkinBone, shape: SkinShape): Handle;
  show(layer: AnatomyLayer): this;
  /**
   * A piece to name as a part, highlight or fade: one of the pieces, or a
   * skin bone name or everyday word (hindleg, skull, "left leg"), meaning the
   * piece it is in. Seen from the side, a pair of legs is one piece; each name
   * asked for gets its own handle, so each can be its own part.
   */
  piece(name: AnatomyPiece | SkinBone | (string & {})): Handle;
  readonly gait: Gait;
  readonly mode: AnatomyMode;
  /** Metres a second. */
  readonly speed: number;
  /** Metres from one footfall of a foot to its next. */
  readonly stride: number;
  /** Strides a second. */
  readonly frequency: number;
  /** Share of each stride with no foot on the ground. */
  readonly airborne: number;
  /** Share of each stride a foot is on the ground. */
  readonly duty: number;
  /** Dimensionless speed, v squared over g times hip height. */
  readonly froude: number;
  /** Hip height in metres. */
  readonly hipHeight: number;
  /** How its hind feet meet the ground. */
  readonly posture: FootPosture;
  readonly handle: Handle;
}

export interface Anatomy {
  /** An animal grown from its bones. */
  skeleton(spec: SkeletonSpec): Animal;
  readonly stage: Stage;
  /** Names an element or an animal for highlighting, steps and descriptions, as stage.part does. */
  part<T extends Handle | { readonly handle: Handle }>(name: string, item: T, options?: PartOptions): T;
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
// Sound
// ---------------------------------------------------------------------------

/** The shape of a tone's wave. */
export type Waveform = 'sine' | 'square' | 'sawtooth' | 'triangle';

/** White noise has every frequency equally; pink and brown lean ever more to the low ones. */
export type NoiseColor = 'white' | 'pink' | 'brown';

export interface VoiceOptions {
  /** Hertz, from 20 to 20,000; middle A is 440. */
  readonly frequency: number;
  /** Default 'sine'. */
  readonly wave?: Waveform;
  /** Loudness from 0 to 1. Default 0.5. */
  readonly gain?: number;
}

export interface NoiseOptions {
  /** Default 'white'. */
  readonly color?: NoiseColor;
  /** Loudness from 0 to 1. Default 0.5. */
  readonly gain?: number;
}

export interface NoteOptions {
  /** Hertz, from 20 to 20,000. */
  readonly frequency: number;
  /** Seconds, from 0.02 to 2. Default 0.2. */
  readonly duration?: number;
  /** Default 'sine'. */
  readonly wave?: Waveform;
  /** Loudness from 0 to 1. Default 0.5. */
  readonly gain?: number;
}

/** A tone that sounds until it is stopped; create it once, and set it in inc.onFrame to follow the controls. */
export interface Voice {
  set(changes: Partial<VoiceOptions>): Voice;
  /** Silences it for good; start another to sound again. */
  stop(): void;
}

/** Noise that sounds until it is stopped; set({ color }) changes its colour in place. */
export interface Noise {
  set(changes: NoiseOptions): Noise;
  /** Silences it for good; start another to sound again. */
  stop(): void;
}

/**
 * Sound the learner switches on with the figure's sound button; it is silent
 * until then, and while the figure is paused or out of sight. At most 8 tones
 * and noises at once.
 */
export interface Sound {
  /** A tone: inc.sound.voice({ frequency: freq.value, wave: 'sine' }). */
  voice(options: VoiceOptions): Voice;
  noise(options?: NoiseOptions): Noise;
  /** A short pluck that fades out, such as a pendulum crossing the middle. */
  note(options: NoteOptions): void;
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
  /** Cells and their organelles, membranes, DNA and flows. */
  biology(selector: string, options: BiologyOptions): Biology;
  /** Animals grown from a skeleton. */
  anatomy(selector: string, options: AnatomyOptions): Anatomy;
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
  readonly sound: Sound;
}
