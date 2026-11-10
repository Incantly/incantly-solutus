/**
 * Identity, type names and undefined values shared by every package
 * (docs/features/kernel/design.md section 4, and docs/features/README.md decisions 1 to 7).
 * Owned by the kernel area. Other areas may only append entries to the registries below.
 */

/** Stable for the life of a figure; kept across redefinition, undo and reload. */
export type ObjId = number & { readonly __brand: 'ObjId' };

/** Unique and case-sensitive. */
export type Name = string;

export type CoreTypeName =
  | 'Number' | 'Bool' | 'Text' | 'Point' | 'Vector' | 'Segment' | 'Ray' | 'Line'
  | 'Circle' | 'Arc' | 'Polygon' | 'Function' | 'Curve' | 'Region'
  | 'List' | 'Color' | 'Particles';

/** Area type names, append-only, one per line under the area's comment, such as `Point3: true;` under `// space-3d`. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AreaTypeNames {}

export type TypeName = CoreTypeName | Extract<keyof AreaTypeNames, string>;

export type CoreUndefReason =
  | 'parallel' | 'coincident' | 'no_intersection' | 'out_of_domain' | 'division_by_zero'
  | 'no_root' | 'not_finite' | 'overflow' | 'degenerate' | 'index_out_of_range' | 'empty_list'
  | 'no_convergence' | 'timeout' | 'input_undefined' | 'not_set' | 'limit' | 'condition_false';

/** One registry of reason codes (README decision 2). Areas append theirs, one per line under their comment. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AreaUndefReasons {}

export type UndefReason = CoreUndefReason | Extract<keyof AreaUndefReasons, string>;

/** An undefined value: why, a short plain fact, and the first undefined object upstream. */
export interface Undefined {
  readonly reason: UndefReason;
  readonly detail?: string;
  readonly cause?: ObjId;
}

export interface Pt {
  readonly x: number;
  readonly y: number;
}
