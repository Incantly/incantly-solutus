/**
 * Tools as data (docs/features/tools-2d/design.md 4). A tool is a table entry; one engine runs them all. Nothing here
 * touches the DOM or the kernel: what only the figure knows comes through `ToolHost`.
 */

export type ToolId = string;

export type ToolGroup =
  | 'move' | 'point' | 'line' | 'special-line' | 'polygon' | 'circle-arc' | 'conic' | 'measure' | 'transform' | 'action' | 'general' | 'physics';

export type PointCreate = 'existing' | 'free' | 'on-path' | 'intersection';

export interface Pt {
  readonly x: number;
  readonly y: number;
}

export type Slot =
  | { readonly kind: 'point'; readonly prompt: string; readonly create: readonly PointCreate[] }
  | { readonly kind: 'object'; readonly prompt: string; readonly accept: readonly string[]; readonly distinct?: boolean }
  | {
    readonly kind: 'number';
    readonly prompt: string;
    readonly unit?: 'length' | 'angle' | 'count' | 'factor';
    readonly def?: number;
    readonly range?: readonly [number, number];
    readonly integer?: boolean;
  }
  | { readonly kind: 'position'; readonly prompt: string };

/** A pick, resolved: the text that stands for it in a line, and what it is. */
export interface Arg {
  readonly text: string;
  /** The object type (`Point`, `Line`, `List<Point>`), `Number` for a typed number, `Position` for a place. */
  readonly type: string;
  /** For a point or a position: where it is. For a number: its value. */
  readonly at?: Pt;
  readonly value?: number;
  /** True when the pick made a new point (a pending point). */
  readonly made?: boolean;
  /** A typed literal turned into a slider with Alt: the slider's line, written before the tool's own lines. */
  readonly slider?: string;
}

/** What `emit` may ask while it writes lines. */
export interface EmitContext {
  /** The visible maths box, for tools that scan the view (roots, extrema, intersections of functions). */
  readonly view: { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number };
  /** How many intersection points two objects have now. */
  intersections(a: string, b: string): number;
  /** Alt was held on the click or Enter that finished the tool: the tool's special alternative (ui.md 2, Keyboard). */
  readonly alt?: boolean;
}

/** An edit the tool asks the host to do instead of writing a defining line. */
export interface ToolAction {
  readonly op: 'delete' | 'toggle-visible';
  readonly name: string;
}

export interface ToolVariant {
  readonly id: string;
  readonly slots: readonly Slot[];
  /** A repeating last slot (polygon vertices): at least `min` picks of it, closed by Enter or a click on the first. */
  readonly tail?: { readonly slot: Slot; readonly min: number; readonly max: number; readonly closeOnFirst?: boolean };
  /**
   * Lines from the picks. `{kind}` is a new name of that kind (`{point}`, `{line}`, `{circle}`, `{number}`, `{angle}`,
   * `{list}`, …); the same `{kind#k}` twice is one name.
   */
  readonly emit?: (args: readonly Arg[], ctx: EmitContext) => readonly string[];
  /** For an edit tool: the edit. */
  readonly act?: (args: readonly Arg[]) => ToolAction;
}

export type ToolKind = 'construct' | 'query' | 'mode' | 'edit';

export interface ToolSpec {
  readonly id: ToolId;
  readonly group: ToolGroup;
  readonly label: string;
  /** One sentence for the tooltip and the model's catalogue. */
  readonly description: string;
  readonly icon: string;
  readonly kind: ToolKind;
  readonly sticky: boolean;
  readonly variants: readonly ToolVariant[];
}

/** An object under the pointer, as the view ranks them (nearest first). */
export interface Hit {
  readonly name: string;
  readonly type: string;
  /** Pixels from the pointer. */
  readonly dist: number;
}

/** What only the figure knows. The studio builds it on a scratch copy of the figure. */
export interface ToolHost {
  /** The type of an object (`Point`, `List<Point>`), or undefined when there is none. */
  typeOf(name: string): string | undefined;
  /** The normalised parameter of the point of `path` nearest `at`, for `PointOn(path, u)`. */
  paramOn(path: string, at: Pt): number | undefined;
  /** The `Intersect(a, b, i)` index whose point is nearest `at`, with that point; undefined when they do not meet near it. */
  nearestIntersection(a: string, b: string, at: Pt): { readonly index: number | undefined; readonly at: Pt } | undefined;
  /** How many points two objects meet in. */
  intersections(a: string, b: string): number;
  /** A typed number checked by the language: its value, or the error's message and hint. */
  checkNumber(text: string): { readonly ok: true; readonly value: number } | { readonly ok: false; readonly message: string; readonly hint?: string };
  /** True when `name` may name a new object (not used, not reserved). */
  nameFree(name: string): boolean;
  /**
   * The undefined reason a tool's lines would leave on one of `results` when the picks do not make the object
   * (`collinear`, `coincident`, `parallel`, `zero_length`, `degenerate`), or undefined (errors.md 2, `degenerate`).
   */
  degenerate?(lines: readonly string[], results: readonly string[]): string | undefined;
}

export type RefusalCode =
  | 'no_target' | 'wrong_type' | 'already_picked' | 'not_a_path' | 'bad_number' | 'number_out_of_range' | 'mixed_types'
  | 'too_few' | 'limit' | 'degenerate';

/** A click or entry that does not fit the step (errors.md 2). The session stays on its step. */
export interface ToolRefusal {
  readonly ok: false;
  readonly source: 'tool';
  readonly code: RefusalCode;
  readonly tool: ToolId;
  readonly step: number;
  readonly prompt: string;
  readonly message: string;
  readonly hint: string;
  readonly accepted?: readonly string[];
  readonly got?: readonly string[];
}

/** A finished tool: the lines to apply as one batch, the names of its results, or an edit. */
export interface ToolDone {
  readonly ok: true;
  readonly tool: ToolId;
  readonly variant: string;
  readonly lines: readonly string[];
  /** Names the tool's own lines define (not its new points). */
  readonly results: readonly string[];
  /** Names of the new points it made. */
  readonly points: readonly string[];
  readonly action?: ToolAction;
  /** Alt was held on the input that finished the tool: commit even an undefined result (errors.md 2, degenerate). */
  readonly alt?: boolean;
}

/** Objects a point slot can sit on: what design 7.3 calls path-like. */
export const PATH_TYPES: readonly string[] = ['Line', 'Ray', 'Segment', 'Circle', 'Arc', 'Polygon', 'Conic', 'Function', 'Curve', 'Polyline', 'Sector'];
