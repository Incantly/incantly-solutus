/**
 * `KindDef` and the registry of kinds (design 7.2). Round 1 holds what a record needs to be checked and loaded;
 * geometry, drawing and handles are added to the same interface in round 3. Built-in kinds and a host's own kinds are
 * registered the same way.
 */
import { boardError, DONE } from '../errors';
import type { BoardResult } from '../errors';
import type { Dash, FontFamily, Part } from '../paint';
import type { Bounds, ShapeRecord } from '../types';
import { RECORD_TYPES } from '../types';

/** How much detail a kind draws at the size its shape has on screen (design 9, item 6). */
export type DrawLod = 'skip' | 'coarse' | 'full';

/** What a kind knows of where a shape is, in the shape's own coordinates (before the shape's rotation is applied). */
export interface KindGeometry {
  /** The box the shape fills: what its handles, align and snap use. */
  readonly box: Bounds;
  /** How far the drawing reaches beyond `box` (a line's width, an arrow's head, a frame's name). */
  readonly pad: number;
  /** The corners of the shape's outline, `[x0, y0, x1, y1, …]`, closed; arrows stick to it and the lasso reads it. Absent when `box` is the outline. */
  readonly poly?: readonly number[];
  /** True when the point is on the shape: its fill or its line, grown by `tol` units. */
  hit(x: number, y: number, tol: number): boolean;
}

/** A handle of a kind, at a point in the shape's own coordinates (an arrow's end or bend, a line's point). */
export interface Handle {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/** What the style bar changes. A kind takes the parts it has and leaves the others. */
export interface StylePatch {
  readonly color?: string;
  readonly fill?: string;
  readonly dash?: Dash;
  readonly size?: number;
  readonly font?: FontFamily;
}

/** How a kind holds the text that is typed into it. */
export interface TextAccess<P> {
  get(props: P): string;
  set(props: P, text: string): Partial<P>;
}

export interface KindDef<P = unknown> {
  /** The kind's name, as in `ShapeRecord.kind`. Not a record type name (`shape`, `page`, …). */
  readonly kind: string;
  /** The props of a new shape of this kind. */
  readonly defaults: P;
  /** Schema check on every write and every load; returns the props to store (defaults filled, values cleaned). */
  check(props: unknown): BoardResult<P>;
  /** Props written by an older file format version, brought to this one. Runs on load only. */
  migrate?(props: unknown, fromVersion: number): unknown;
  /** How many ink points these props hold, for the page limit. Kinds with no ink leave it out. */
  points?(props: P): number;
  /** The shape's box and hit test, cached per record by the core. A kind without it is not drawn, indexed or selected. */
  geometry?(shape: ShapeRecord<string, P>): KindGeometry;
  /** The level of detail for a shape drawn at `scale` device pixels per page unit; absent, the core decides from the shape's size on screen. */
  lod?(shape: ShapeRecord<string, P>, scale: number): DrawLod;
  /** The vector parts of the shape in its own coordinates, cached per record and level of detail by the core. */
  draw?(shape: ShapeRecord<string, P>, lod: DrawLod): readonly Part[];
  /** The kind's own handles; with them, a shape that is alone in the selection shows these instead of the 8 resize handles. */
  handles?(shape: ShapeRecord<string, P>): readonly Handle[];
  /** The props after a handle of the kind moved to a point in the shape's coordinates. */
  moveHandle?(shape: ShapeRecord<string, P>, handle: string, x: number, y: number): Partial<P>;
  /** The props after the shape's box became `box` (in the shape's coordinates; the core moves the shape so the box lands in the right place). */
  onResize?(shape: ShapeRecord<string, P>, box: Bounds): Partial<P>;
  /** The props after the style bar changed `style`. */
  applyStyle?(props: P, style: StylePatch): Partial<P>;
  /** The props after the shape was mirrored across its own vertical (`x`) or horizontal (`y`) middle line; absent for a shape that looks the same mirrored. */
  flip?(shape: ShapeRecord<string, P>, axis: 'x' | 'y'): Partial<P>;
  /** Present when text can be typed into the shape. */
  text?: TextAccess<P>;
  /** True when the shape's size cannot be changed with the resize handles (a sticky note). Default false. */
  fixedSize?: boolean;
  /** Drawn only when it meets the viewport; default true (design 7.2). */
  canCull?: boolean;
}

export class KindRegistry {
  readonly #defs = new Map<string, KindDef>();

  /** Adds a kind. A name that is empty, reserved, or already registered is refused. */
  register<P>(def: KindDef<P>): BoardResult<undefined> {
    if (typeof def !== 'object' || def === null || typeof def.kind !== 'string' || def.kind === '') {
      return boardError('bad_argument', 'A kind needs a name.', { detail: { field: 'kind' } });
    }
    if ((RECORD_TYPES as readonly string[]).includes(def.kind)) {
      return boardError('bad_argument', `"${def.kind}" is the name of a record type; give the kind another name.`, { detail: { kind: def.kind } });
    }
    if (typeof def.check !== 'function') {
      return boardError('bad_argument', `Kind "${def.kind}" needs a check function.`, { detail: { kind: def.kind, field: 'check' } });
    }
    if (this.#defs.has(def.kind)) {
      return boardError('bad_argument', `Kind "${def.kind}" is already registered.`, { detail: { kind: def.kind } });
    }
    this.#defs.set(def.kind, def as KindDef);
    return DONE;
  }

  get(kind: string): KindDef | undefined {
    return this.#defs.get(kind);
  }

  has(kind: string): boolean {
    return this.#defs.has(kind);
  }

  /** The registered kind names, in the order they were registered. */
  kinds(): readonly string[] {
    return [...this.#defs.keys()];
  }
}
