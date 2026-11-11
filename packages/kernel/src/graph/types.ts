/**
 * Shapes of the figure: cells, objects, definitions, results and events
 * (docs/features/kernel/design.md sections 4 to 6, 9, 11).
 *
 * Values are the language's runtime values (numbers, `{x, y}` points, arrays, ...), kept as the type of the object says.
 * They are immutable by convention: the kernel never changes a value after it is stored.
 */
import type { ErrorObject, Notice } from '../contracts/errors';
import type { Name, ObjId, TypeName, UndefReason } from '../contracts/values';
import type { LineNode, StyleItem } from '../language/ast';
import type { CheckedLine, CheckedStyle } from '../language/check';
import type { CompiledLine } from '../language/compile';
import type { Ty } from '../language/types';

/* ------------------------------ cells ------------------------------ */

/** A value, or the reason there is none. `cause` is the nearest undefined input (a direct input), never the root. */
export type Cell =
  | { readonly defined: true; readonly value: unknown }
  | { readonly defined: false; readonly reason: UndefReason; readonly detail?: string; readonly cause?: ObjId };

/** Cell of an object that has not been computed yet. */
export const NOT_SET: Cell = Object.freeze({ defined: false, reason: 'not_set' as UndefReason });

/* ------------------------------ properties ------------------------------ */

/** A colour with channels 0..255 and alpha 0..1. */
export interface ColorSpec {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** The static properties of an object (kernel design 9). Dynamic rules live beside them, see `StyleEntry`. */
export interface Props {
  visible: boolean;
  label: 'name' | 'value' | 'both' | 'caption' | 'none';
  caption?: string;
  aux: boolean;
  fixed: boolean;
  selectable: boolean;
  layer: number;
  color: ColorSpec;
  opacity: number;
  width: number;
  lineStyle: 'solid' | 'dashed' | 'dotted' | 'dashdot';
  pointSize: number;
  pointStyle: 'dot' | 'circle' | 'cross' | 'plus' | 'diamond' | 'square' | 'triangle';
  fill: 'solid' | 'hatch' | 'cross' | 'dots' | 'checker';
  fillAngle?: number;
  fillGap?: number;
  trace: boolean;
  tip: 'auto' | 'name' | 'value' | 'caption' | 'off';
  tags?: readonly string[];
  /** Properties an area appended to the language table, stored as written. */
  ext: Readonly<Record<string, unknown>>;
}

/**
 * One `with` item of an object: the property, its value as written, and how it is evaluated. A value that reads nothing
 * is evaluated once and kept in `value`; a value that reads objects or the clock is a property rule (a style edge).
 */
export interface StyleEntry {
  readonly key: string;
  /** The value as source text, for `toScript`. */
  readonly text: string;
  readonly item: StyleItem;
  readonly checked: CheckedStyle;
  /** Evaluator for a rule; absent for a word or a constant. */
  readonly eval?: (env: import('../language/runtime').Env) => unknown;
  readonly word?: string;
  /** Objects the rule reads (never `SELF_ID`: the owner's own id is used). */
  readonly reads: readonly ObjId[];
  readonly usesT: boolean;
  /** Constant value (when `reads` is empty and the clock is unused). */
  readonly value?: unknown;
}

/** What a view needs to draw an object: static properties with the rules evaluated now. */
export interface EffectiveStyle {
  readonly visible: boolean;
  /** Effective visibility: `visible` and the `showIf` rule (undefined means hidden). */
  readonly shown: boolean;
  /** Why an object is hidden, in words, when it is. */
  readonly why?: string;
  readonly label: Props['label'];
  readonly caption?: string;
  readonly aux: boolean;
  readonly fixed: boolean;
  readonly selectable: boolean;
  readonly layer: number;
  readonly color: ColorSpec;
  readonly opacity: number;
  readonly width: number;
  readonly lineStyle: Props['lineStyle'];
  readonly pointSize: number;
  readonly pointStyle: Props['pointStyle'];
  readonly fill: Props['fill'];
  readonly trace: boolean;
  readonly tip: Props['tip'];
  readonly tags: readonly string[];
  readonly ext: Readonly<Record<string, unknown>>;
}

/* ------------------------------ objects ------------------------------ */

export type DefKind = 'free' | 'rule' | 'state';

/**
 * Everything about an object that undo restores. A `Persist` is replaced as a whole, never edited, so a journal entry
 * holds two references and an undo is exact.
 */
export interface Persist {
  readonly name: Name;
  readonly type: Ty;
  readonly unit?: 'angle';
  readonly kind: DefKind;
  /** The defining line without its `with` list. The range clause stays in it. */
  readonly node: LineNode;
  readonly checked: CheckedLine;
  readonly compiled: CompiledLine | undefined;
  /** For a defmany target: the position of this object in the command's result. */
  readonly tupleIndex?: number;
  /** For a free object: its current value (also in the cell). */
  readonly value?: unknown;
  /** For a free object whose value is undefined: why. */
  readonly freeReason?: UndefReason;
  /** The `with` items by property, in the order they were first written. */
  readonly style: ReadonlyMap<string, StyleEntry>;
  /** Rate rules of a state, by derivative order (1 or 2). */
  readonly rates?: ReadonlyMap<number, RateRule>;
}

export interface RateRule {
  readonly order: number;
  readonly node: LineNode;
  readonly checked: CheckedLine;
  readonly compiled: CompiledLine;
}

/** The kinds of change a flush reports for one object. */
export interface UndefChange {
  readonly id: ObjId;
  readonly name: Name;
  readonly now: Cell;
  readonly was: Cell | undefined;
}

export interface FrameDelta {
  /** Objects whose value changed. */
  readonly valueIds: ObjId[];
  /** Objects whose style rules read something that changed. */
  readonly styleIds: ObjId[];
  readonly undefinedChanges: UndefChange[];
  /** Number of rules that ran. */
  readonly ran: number;
  /** Listeners that threw while the events of this frame were delivered (absent when none did). */
  readonly listenerFailures?: number;
}

/* ------------------------------ events ------------------------------ */

export type FigureEvent =
  | { readonly ev: 'add'; readonly id: ObjId }
  | { readonly ev: 'remove'; readonly id: ObjId; readonly name: Name }
  | { readonly ev: 'value'; readonly ids: readonly ObjId[] }
  | { readonly ev: 'style'; readonly ids: readonly ObjId[] }
  | { readonly ev: 'rename'; readonly id: ObjId; readonly from: Name; readonly to: Name }
  | { readonly ev: 'reorder'; readonly ids: readonly ObjId[] }
  | { readonly ev: 'step'; readonly n: number }
  | { readonly ev: 'undo'; readonly group: string }
  | { readonly ev: 'redo'; readonly group: string }
  | { readonly ev: 'directive'; readonly name: string }
  | { readonly ev: 'clock'; readonly t: number };

/* ------------------------------ results ------------------------------ */

export interface UndefinedName {
  readonly name: Name;
  readonly reason: UndefReason;
  readonly detail?: string;
  readonly cause?: Name;
}

export interface ChangeReport {
  added: Name[];
  /** Deleted by cascade, in deletion order. */
  removed: Name[];
  redefined: Name[];
  /** Objects moved earlier by a redefinition. */
  moved: Name[];
  becameUndefined: UndefinedName[];
  becameDefined: Name[];
  /** The same list as `TxResult.notices` (README decision 4 names the field `notices`). */
  warnings: Notice[];
}

export type TxOp = 'add' | 'redefine' | 'restyle' | 'rerange' | 'rate' | 'delete' | 'rename' | 'action' | 'undo' | 'redo' | 'directive' | 'comment' | 'noop';

export interface TxOk {
  readonly ok: true;
  readonly line: number;
  readonly name?: Name;
  readonly names?: readonly Name[];
  readonly id?: ObjId;
  readonly type?: TypeName;
  readonly op: TxOp;
  /** "M = (2, 3)", or "I is undefined (parallel)". */
  readonly summary: string;
  readonly changed: ChangeReport;
  readonly notices: readonly Notice[];
  /** Set on a dry run: nothing was committed. */
  readonly dryRun?: true;
  /** Objects that read the changed object, directly or not (a dry run lists them). */
  readonly affected?: readonly Name[];
  /** Data an action returns (`Describe`, `DependsOn`, `Uses`). */
  readonly data?: unknown;
}

export type TxResult = TxOk | ErrorObject;

export interface ApplyOptions {
  /** 1-based number of the line in the batch or file. */
  line?: number;
  /** Check and plan, evaluate nothing downstream, commit nothing. */
  dryRun?: boolean;
  /** Names whose defining line failed earlier in this batch. */
  failed?: ReadonlyMap<string, { line: number; kind: import('../contracts/errors').ErrorKind }>;
  /** Insert the new object at this order index instead of at the end. */
  insertAt?: number;
  /** The teacher's tools may change a fixed object when they say so. */
  force?: boolean;
}

export interface BatchOptions {
  /** The label of the undo group. */
  group: string;
  /** `atomic` (default): all lines or none. `independent`: every line applies or fails on its own. */
  mode?: 'atomic' | 'independent';
  force?: boolean;
  /** The line number of each entry in the file it came from (default: its position, from 1). */
  lines?: readonly number[];
}

export interface BatchResult {
  /** True when no line failed. */
  readonly ok: boolean;
  readonly results: readonly TxResult[];
  /** Lines committed (0 after a rollback). */
  readonly applied: number;
  /** True when an atomic batch failed and was undone. */
  readonly rolledBack: boolean;
  /** The merged change of the batch. */
  readonly changed: ChangeReport;
  readonly notices: readonly Notice[];
}

/* ------------------------------ descriptions ------------------------------ */

export interface Description {
  readonly name: Name;
  readonly id: ObjId;
  readonly type: string;
  readonly definition: string;
  readonly value: string;
  readonly defined: boolean;
  readonly undefined?: { readonly reason: UndefReason; readonly cause?: Name; readonly root?: UndefReason };
  readonly free: boolean;
  readonly visible: boolean;
  readonly shown: boolean;
  readonly why?: string;
  readonly fixed: boolean;
  readonly aux: boolean;
  readonly layer: number;
  readonly inputs: readonly Name[];
  readonly dependents: readonly Name[];
}
