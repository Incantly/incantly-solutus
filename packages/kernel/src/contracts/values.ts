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
export interface AreaTypeNames {
  // sound
  Sound: true;
  // space-3d
  Point3: true;
  Vector3: true;
  Line3: true;
  Segment3: true;
  Ray3: true;
  Plane: true;
  Polygon3: true;
  Circle3: true;
  Polyhedron: true;
  Sphere: true;
  Cylinder: true;
  Cone: true;
  View3: true;
  Surface: true;
  Curve3: true;
}

export type TypeName = CoreTypeName | Extract<keyof AreaTypeNames, string>;

export type CoreUndefReason =
  | 'parallel' | 'coincident' | 'no_intersection' | 'out_of_domain' | 'division_by_zero'
  | 'no_root' | 'not_finite' | 'overflow' | 'degenerate' | 'index_out_of_range' | 'empty_list'
  | 'no_convergence' | 'timeout' | 'input_undefined' | 'not_set' | 'limit' | 'condition_false';

/** One registry of reason codes (README decision 2). Areas append theirs, one per line under their comment. */
export interface AreaUndefReasons {
  // language
  explicit: true;
  not_integer: true;
  no_value_yet: true;
  // animation-time
  not_time_dependent: true;
  // sound
  bad_note_name: true;
  // spreadsheet
  off_sheet: true;
  deleted_cell: true;
  empty_cell: true;
  not_numeric: true;
  // space-3d
  skew: true;
  not_coplanar: true;
  not_closed: true;
}

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
