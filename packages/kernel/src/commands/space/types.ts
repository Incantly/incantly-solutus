/**
 * The values of the space area (docs/features/space-3d/design.md 5; .kiro/specs/space-3d/design.md). A point or vector
 * in space is `{ x, y, z }`; every other value carries `shape3`, its type name, so texts and the screen can tell them
 * apart without the object's type.
 */
import type { Frame, V3 } from './v3';

export type Point3 = V3;
export type Vector3 = V3;

export interface Line3 { readonly shape3: 'Line3'; readonly o: V3; readonly d: V3 }
export interface Ray3 { readonly shape3: 'Ray3'; readonly o: V3; readonly d: V3 }
export interface Segment3 { readonly shape3: 'Segment3'; readonly a: V3; readonly b: V3 }
/** `n·x = c` with `n` a unit vector; `f` is a frame of the plane. */
export interface Plane3 { readonly shape3: 'Plane'; readonly n: V3; readonly c: number; readonly f: Frame }
export interface Polygon3 { readonly shape3: 'Polygon3'; readonly pts: readonly V3[]; readonly f: Frame }
export interface Circle3 { readonly shape3: 'Circle3'; readonly f: Frame; readonly r: number }

export interface Face {
  /** Vertex indices in order, counter-clockwise seen from outside. */
  readonly idx: readonly number[];
  /** Outward unit normal. */
  readonly normal: V3;
}

export type SolidKind = 'pyramid' | 'prism' | 'tetrahedron' | 'cube' | 'octahedron' | 'section' | 'general';

export interface Polyhedron {
  readonly shape3: 'Polyhedron';
  readonly verts: readonly V3[];
  readonly faces: readonly Face[];
  readonly kind: SolidKind;
  /** Every edge has exactly two faces. */
  readonly closed: boolean;
  /** For pyramids and prisms: the face that is the base (0), and the apex or top for `Height`. */
  readonly height?: number;
}

export interface Sphere3 { readonly shape3: 'Sphere'; readonly c: V3; readonly r: number }
/** Base centre `a`, top centre `b`, radius `r`. */
export interface Cylinder3 { readonly shape3: 'Cylinder'; readonly a: V3; readonly b: V3; readonly r: number }
/** Base centre `a`, apex `b`, base radius `r`. */
export interface Cone3 { readonly shape3: 'Cone'; readonly a: V3; readonly b: V3; readonly r: number }

export type Shape3 = Line3 | Ray3 | Segment3 | Plane3 | Polygon3 | Circle3 | Polyhedron | Sphere3 | Cylinder3 | Cone3;

export function shape3Of(v: unknown): Shape3['shape3'] | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const s = (v as { shape3?: unknown }).shape3;
  return typeof s === 'string' ? (s as Shape3['shape3']) : undefined;
}

export const is3 = <K extends Shape3['shape3']>(v: unknown, k: K): v is Extract<Shape3, { shape3: K }> => shape3Of(v) === k;

/** The 3D type names, for the table check and the mode catalogue. */
export const SPACE_TYPES: readonly string[] = [
  'Point3', 'Vector3', 'Line3', 'Segment3', 'Ray3', 'Plane', 'Polygon3', 'Circle3', 'Polyhedron', 'Sphere', 'Cylinder', 'Cone', 'View3',
];

/** The flat type a 3D type is the counterpart of, for `mixed_dimension`. */
export const FLAT_OF: Readonly<Record<string, string>> = {
  Point3: 'Point', Vector3: 'Vector', Line3: 'Line', Segment3: 'Segment', Ray3: 'Ray', Polygon3: 'Polygon', Circle3: 'Circle',
};
export const SPACE_OF: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(FLAT_OF).map(([a, b]) => [b, a]));
