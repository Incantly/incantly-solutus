# Space (3D): design

Status: draft for review. Area: everything 3D. Companion files: `errors.md`, `agent.md`, `ui.md` in this folder.

This document learns from how GeoGebra builds its 3D layer. It copies no GeoGebra code, names or manual text. Names below are ours. Where we keep a plain maths word (`Sphere`, `Pyramid`, `Volume`) it is because that is the word a teacher uses.

Reading order: section 1 (what it gives people), 2 (the full feature list in our syntax), 3 (what GeoGebra does), 4 to 12 (our design), 13 (what we build first), 14 (better than GeoGebra), 15 (changes to the core design), 16 (sources).

---

## 1. What the learner and the teacher get

### For the learner

- A **Space view**: a 3D picture next to (or in place of) the 2D view. It shows points, lines, planes, polygons, solids, surfaces and curves, with axes and a floor grid.
- Turn the picture with one finger or the mouse. Zoom with the wheel or a pinch. Move a point in space without losing track of where it is going (a small handle shows which direction it moves).
- Build solids and see them as solid objects: a pyramid on a triangle, a cylinder along a line, a sphere through a point.
- Slice solids with planes and see the cross-section as a new shape. Unfold a solid into its net and fold it back with a slider.
- Plot `z = f(x, y)`, parametric surfaces and implicit surfaces such as `x² + y² − z² = 1`. Spin a curve around an axis to get a solid of revolution and read its volume.
- Read measures: distance, angle between lines and planes, area, surface area, volume.
- Pick a projection (orthographic, perspective, oblique), turn on a clipping box to cut the scene, see in stereo (red-cyan glasses or side by side), and in a later phase place the figure on a real table in AR.

### For the teacher (the live AI voice)

- Every 3D object is one line of the same language the 2D figure uses. `P = (1, 2, 3)`, `s = Sphere(P, 2)`, `c = Intersect(Plane(A, B, C), s)`.
- The camera is an object too, named `space`. The teacher turns it with `space with azimuth = 40deg`. That is a normal line, applied in under 1 ms, replayed exactly when a film seeks.
- A 3D scene is hard to read from words alone. So `figure` returns, for each 3D object, a short value summary and where it is in view (visible, behind another object, outside the clip box, off screen). The teacher can then say "the plane cuts the sphere in a circle of radius 1.7" with the number in hand.
- Errors are specific to 3D: mixing 2D and 3D points, points that are collinear when a plane was asked for, a polygon that is not flat. Each says what to write instead.

### Out of scope here

The 2D parts of conics, polygons, loci and transforms are other folders. This folder covers the 3D-specific objects, commands, intersections, the camera and renderer, and how 3D plugs into the shared kernel. Section 11 says exactly which 2D rules we reuse.

---

## 2. Everything the Space layer offers (full list, in our syntax)

Types are in section 5. A "form" is one accepted argument list. `P`, `Q`, `R` are `Point3`; `u`, `v`, `w` are `Vector3`; `L`, `M` are `Line3`; `Pl` is `Plane`. The command table is the single source (core design section 5); the catalogue printed from it is in `agent.md`.

### 2.1 The Space view and its objects

| Feature | In our language |
|---|---|
| Show the Space view | `@view3` (default bounds) or `@view3 x0 x1 y0 y1 z0 z1` |
| Camera, light, clip box, axes, floor | the reserved object `space` with `with` properties (section 8) |
| Axes as objects | `xAxis`, `yAxis`, `zAxis`, `floor` (the xOy plate). Reserved names, always present, hidden by default in 2D |
| 2D objects in 3D | A 2D object appears in the Space view lying on the floor (z = 0) when its `in3` property is true (default true) |
| Point literal | `(x, y, z)` makes a `Point3`; a pair `(x, y)` stays a 2D `Point` |

### 2.2 Object types

Points, vectors, lines, segments, rays, planes, polygons (flat, in any plane), polylines, circles, arcs, conics in a plane, polyhedra (pyramid, prism, tetrahedron, cube, octahedron, dodecahedron, icosahedron, general and convex hull), spheres, cylinders, cones (limited and infinite), general quadrics, parametric surfaces, graphs of two-variable functions, implicit surfaces, 3D parametric curves, surfaces and solids of revolution, nets, text and labels in space.

### 2.3 Commands: the 3D group

Everything is a form on a command in the one table. Where the command already exists in 2D (`Midpoint`, `Segment`, `Circle`, `Distance`, `Angle`, `Intersect`, `Rotate`, `Reflect`, `Translate`, `Dilate`, `Tangent`, `Length`, `Area`), 3D adds forms to the same command; the checker picks by exact types (core design section 5). **No automatic mixing:** a 2D `Point` is not accepted where `Point3` is wanted. That gives the error `mixed_dimension` with the fix `(x, y, 0)` (see `errors.md`).

**Points, vectors, lines**

| Command | Forms |
|---|---|
| `Vector` | `(x, y, z)`; `(P, Q) -> Vector3` |
| `Midpoint` | `(P, Q)`, `(Segment3)` |
| `Segment` | `(P, Q)` |
| `Ray` | `(P, Q)`, `(P, v)` |
| `Line` | `(P, Q)`, `(P, v)` |
| `PointOn` | `(Segment3 \| Ray3 \| Line3 \| Circle3 \| Curve3 \| Polygon3 \| Polyhedron, t)` along a path; `(Plane, u, v)` or `(Surface, u, v)` on a surface by its parameters; each draggable |
| `PointIn` | `(Polygon3 \| Plane \| Sphere-solid \| Polyhedron)`: a draggable point restricted to the region |
| `ClosestPoint` | `(path-or-surface, P)` |
| `Direction` | `(Line3 \| Segment3 \| Ray3) -> Vector3` (unit) |
| `UnitVector` | `(v)`, `(Line3)` |
| `Normal` | `(Plane \| Polygon3) -> Vector3` (unit); `(Surface, P) -> Vector3` at a point on the surface |
| `Dot`, `Cross` | `(u, v)`; `Cross` returns `Vector3` |

**Planes**

| Command | Forms |
|---|---|
| `Plane` | `(P, Q, R)`; `(P, L)`; `(L, M)` (parallel or intersecting lines); `(P, normal: u)`; `(Polygon3)`; `(Conic3)`; `(Bool equation)` such as `2x - y + 3z == 4` |
| `OrthogonalPlane` | `(P, L)`, `(P, u)`, `(P, Segment3)` |
| `Parallel` | `(P, L) -> Line3`, `(P, Pl) -> Plane` |
| `Perpendicular` | `(P, Pl) -> Line3`; `(P, L) -> Line3` (in the plane they span); `(L, M) -> Line3` (the common perpendicular) |
| `Bisector` | `(P, Q) -> Plane` (perpendicular bisector plane); `(P, V, Q) -> Line3` (angle bisector in the plane of the three points); `(Pl, Pl2, k) -> Plane`, `k` = 1 or 2 |

**Flat shapes and curves**

| Command | Forms |
|---|---|
| `Polygon` | `(P, Q, R, …)` (flat); `(List<Point3>)`; `(P, Q, n, normal: u)` regular n-gon on edge PQ |
| `Polyline` | `(List<Point3>)`, `(P, Q, R, …)` |
| `Circle` | `(center: P, radius, axis: u)`; `(P, Q, R)` through three points; `(center: P, through: Q, axis: u)`; `(axisLine: L, through: P)` |
| `Arc` | `(Circle3, from, to)`; `(center: P, from: Q, to: R)` the arc around P from Q towards R's direction |
| `Semicircle` | `(P, Q, normal: u)` |
| `Ellipse`, `Parabola`, `Hyperbola`, `Conic` | the 2D forms extended: `Ellipse(F1, F2, P)`, `Hyperbola(F1, F2, P)`, `Parabola(Focus, Line3 directrix)` in the plane of the inputs; `Conic(P1, …, P5)` flat |
| `Curve` | `(x(s), y(s), z(s), s, a, b) -> Curve3` |
| `Center`, `Radius`, `Axis`, `Focus`, `Vertex` | for circles, spheres, conics in space, quadrics. `Vertex` also lists polygon, polyhedron and cone corners |

**Solids**

| Command | Forms |
|---|---|
| `Pyramid` | `(Polygon3, apex: P)`, `(Polygon3, height)`, `(P1, P2, P3, …, apex)` |
| `Prism` | `(Polygon3, top: P)` (P is the image of the first vertex), `(Polygon3, height)`, `(P1, …, Pn, top: P)` |
| `Extrude` | `(Polygon3 \| Circle3, height)`, `(shape, u)` with `u` any vector (an oblique prism or cylinder) |
| `Tetrahedron` | `(P, Q, R)` regular on the triangle PQR if equilateral, else `degenerate`; `(P, Q)` regular on edge PQ, orientation from `(P, Q, side: R)` |
| `Cube` | `(P, Q, side: R)` edge PQ; the cube lies on the side of line PQ where R is |
| `Octahedron`, `Dodecahedron`, `Icosahedron` | `(P, Q, side: R)` |
| `Polyhedron` | `(vertices: List<Point3>, faces: List<List<Number>>)` explicit; `Hull3(List<Point3>)` convex hull |
| `Net` | `(Polyhedron, t)`, `t` 0 (folded) to 1 (flat); `(Polyhedron, t, base: faceIndex)` |
| `Vertices`, `Edges`, `Faces` | `(Polyhedron) -> List` |
| `Cylinder` | `(P, Q, radius)`; `(Circle3, height)`; `(P, Q, radius, caps: false)` open |
| `Cone` | `(P, apex: Q, radius)`; `(Circle3, height)`; `(P, Q, radius, caps: false)` |
| `InfiniteCylinder` | `(L, radius)` |
| `InfiniteCone` | `(apex: P, axis: u, halfAngle)`, `(apex: P, axisPoint: Q, halfAngle)` |
| `Sphere` | `(center: P, radius)`, `(center: P, through: Q)`, `(diameter: Segment3)` |
| `TopFace`, `BottomFace`, `Lateral` | `(Cylinder \| Cone)`: the pieces as separate objects |
| `Height` | `(Cylinder \| Cone \| Pyramid \| Prism)` |
| Quadric by equation | `S = x^2/4 + y^2/9 + z^2 == 1` (any quadratic in x, y, z compared with `==`) gives a `Quadric` |

**Surfaces and curves of revolution**

| Command | Forms |
|---|---|
| (definition) | `f(x, y) = sin(x y)`: a two-variable `Function`, drawn as a surface over the visible `x`, `y` |
| `Surface` | `(x(u,v), y(u,v), z(u,v), u, u0, u1, v, v0, v1)` |
| (definition) | `F = x^2 + y^2 - z^2 == 1`: an implicit surface when the equation is not quadratic; quadratic gives a `Quadric` |
| `Revolve` | `(Function, a, b, axis: L)`; `(Curve3 \| Curve, from, to, axis: L, angle)` a surface |
| `SolidOfRevolution` | `(Function, a, b, axis: L)`; `(Function, Function, a, b, axis: L)` between two graphs; a closed `Solid` with a volume |
| `TangentPlane` | `(Surface \| Quadric \| Function2, P)` |
| `Gradient` | `(Function2, x, y) -> Vector3` as (fx, fy, −1) normal direction |

**Intersections.** Full table in section 7. Short form: `Intersect(a, b)` where the pair is any of line, plane, polygon, polyhedron, sphere, quadric, surface, curve; `Intersect(a, b, k)` picks slot `k`.

**Measures**

| Command | Forms |
|---|---|
| `Distance` | `(P, Q)`, `(P, L)`, `(P, Pl)`, `(L, M)`, `(Pl, Pl2)` (0 if they meet), `(P, Sphere)` signed, `(L, Pl)` |
| `Angle` | `(u, v)`; `(P, V, Q)` 0..π; `(P, V, Q, axis: u)` oriented 0..2π about u; `(L, M)`; `(L, Pl)`; `(Pl, Pl2)`; `(Polygon3)` list of interior angles |
| `Length` | `(Vector3)`, `(Segment3)`, `(Arc3)`, `(Circle3)` circumference, `(Curve3, a, b)` |
| `Area` | `(Polygon3)`, `(Circle3)`, `(Sector3)` |
| `SurfaceArea` | `(Polyhedron \| Sphere \| Cylinder \| Cone \| Surface, …)` |
| `Volume` | `(Polyhedron \| Sphere \| Cylinder \| Cone \| Solid)` |

**Transforms**

| Command | Forms |
|---|---|
| `Translate` | `(shape, u)` |
| `Rotate` | `(shape, angle, axis: L)`; `(shape, angle, center: P, direction: u)` |
| `Reflect` | `(shape, Pl)`, `(shape, L)`, `(shape, P)` |
| `Dilate` | `(shape, factor, center: P)` |

`shape` = any object above. The result has the input's type. A transform keeps the input live, so a moved cube follows its source.

**Camera and view actions** (the view is the `space` object; these are shortcuts)

| Action | Effect |
|---|---|
| `ViewFacing(obj)` | Turn the camera to look straight at a plane, polygon, face or line direction (the “view in front of” idea) |
| `ViewAll()` | Fit the camera to the bounding box of visible objects |
| `ViewReset()` | Standard view |
| `ViewPreset(name)` | `front`, `back`, `left`, `right`, `top`, `bottom`, `isometric` |
| `Spin(deg_per_second)` | The camera azimuth advances with film time `t`; `Spin(0)` stops |

### 2.4 Tools the learner can pick

Full detail and sketches are in `ui.md`. The groups, in toolbar order: Move; Points (point, point on object, intersect, midpoint); Lines (segment, line, ray, vector, perpendicular, parallel, tangent, bisector); Planes (three points, plane+line, parallel, orthogonal); Polygons; Circles and conics (circle with axis and point, circle by centre-radius-direction, three points, arcs); Solids (pyramid, prism, extrude, cone, cylinder, tetrahedron, cube, net, sphere two ways, surface of revolution, conify); Measure (angle, distance, area, volume); Transform (reflect in plane, rotate around line, translate, dilate, reflect in point or line); Intersection curve; Text; View (rotate view, move view, zoom, view in front of, copy style, show/hide object and label, delete).

---

## 3. How GeoGebra does it, in plain words

**One kernel, two dimensions.** Every 3D object is an ordinary kernel object with extra data; every 3D construction step is an ordinary kernel step with a 3D result. The kernel files that make 3D are a thin layer: new object types (point, vector, line, segment, ray, plane, polygon, polyhedron, quadric, surface, implicit surface), new construction steps (about 200: one per command form), and command processors that choose a step by the types of the arguments. Shared "dimension-neutral" interfaces let one command (say `Midpoint`) accept 2D or 3D inputs and make the right step. Flat shapes in space (circles, conics, polygons) are a 2D shape plus a "coordinate system of a plane": the same 2D conic maths runs in plane coordinates. This sharing works well and is the right idea.

**The view owns the camera.** The 3D view keeps rotation as two angles (around the vertical axis and the tilt), a translation of the scene origin, and separate scales for x, y, z (so axes can have different units). Projection is one of four: orthographic, perspective (eye distance), oblique (angle and a depth factor) and “glasses” (stereo). Moves (rotate, translate, zoom, axis-scale) run as small animations that the view steps each frame, which gives the eased fly-to when you pick “view in front of”, or reset. Weak points: two Euler angles limit the poses to “z up”; large rotations drift; the scene is z-up only unless a switch swaps y vertical.

**Drawing.** Each kernel object has a drawable. A drawable fills big shared vertex buffers (points, curves, surfaces are packed into a few large buffers, with free-lists) and the renderer draws these buffers in a fixed sequence: hidden parts of lines (dashed), opaque surfaces, then transparent surfaces in several rounds interleaved with depth-only passes of closed solids, then visible lines, then labels. Order-independence of transparency is approximated by that repeated pass sequence rather than by a real technique. Lighting is two fixed lights with ambient and a small shine, set in the shader. Clipping to the box is done in the shader by dropping fragments whose world position is outside it; the box's size has five preset reductions.

**Surfaces.** A parametric surface or two-variable function is meshed adaptively: a coarse grid of the parameter domain is split where the screen distance between corners exceeds a limit or where the surface bends more than an angle; splitting is time-sliced across frames, with a “speed” and a “quality” level. Cracks between neighbours of different depth are the known weak point. Implicit surfaces and intersection curves are also traced adaptively, with limits.

**Picking.** The renderer draws object colours into an off-screen buffer and reads pixels around the pointer; hits are sorted by depth with a priority (points, then curves, then surfaces). A moving-point preview (“cursor”) snaps to the nearest object under the pointer: free, on a path, on a region, or dependent.

**Dragging.** A free point has two modes you toggle by clicking it: move parallel to the floor, or move up and down. Arrow keys and Page Up/Down also move it. Points on paths or regions slide by projecting the pointer ray.

**Other.** Intersections of two arbitrary objects are dispatched by type pair through many special steps. There is a software-drawn fallback for browsers without WebGL. There is an AR layer (place the scene on a real surface, units in metres or centimetres) and a stereo layer (anaglyph, side by side), and an XR hook. There is a 2D view that shows any plane of the scene.

**What works:** the shared kernel; the thin dimension layer; adaptive meshing; packed buffers; the clipping box; the plane-view idea.

**What is weak:** Euler-angle camera; many near-duplicate algo files; transparency approximated by pass interleaving; mode toggling to move in z (users do not discover it); surface cracks; no solid-body Boolean (cut, union), no sections that stay closed with a cap; screen readers get little.

---

## 4. Principles for our design

1. **Same kernel, same language.** 3D adds types, forms and rules. It adds no second object system, no second command table, no second error format.
2. **Pure maths first, GPU second.** Everything the kernel does for 3D (planes, solids, intersections, meshes) is pure TypeScript in `packages/kernel/src/space/`. It runs in Node tests and Web Workers. The view only draws what the kernel already computed.
3. **One camera model, quaternion based.** Any orientation is reachable; “z up” is a setting (`zUp`), not a limit.
4. **Exact where cheap, tolerant where not.** Planes, lines, spheres use closed forms. Surfaces and surface–surface intersections use adaptive numerics with stated accuracy.
5. **Unambiguous picking and dragging.** A learner can always move a point where they intend; the gizmo (ui.md) shows the constraint.
6. **Degrade gracefully.** WebGL2 first; a software (Canvas 2D) renderer for old devices, tests and export.

---

## 5. Types

All 3D values are immutable records like the 2D ones (core design: `Value`). `V3` is `{ x, y, z }` (a readonly tuple-like object; same shape rules as `V2` in the points-lines design section 3.1).

```ts
export interface V3 { readonly x: number; readonly y: number; readonly z: number }

/** Orthonormal frame of a plane: origin and two perpendicular unit axes. The normal is u × v. */
export interface Frame { readonly o: V3; readonly u: V3; readonly v: V3 }

export type Value3 =
  | { t: 'Point3';   p: V3 }
  | { t: 'Vector3';  v: V3 }
  | { t: 'Line3';    o: V3; d: V3 }                              // d unit; o any point on the line
  | { t: 'Segment3'; a: V3; b: V3 }
  | { t: 'Ray3';     o: V3; d: V3 }                              // d unit
  | { t: 'Plane';    n: V3; c: number }                          // n unit, n·x = c; stored with a Frame lazily
  | { t: 'Circle3';  f: Frame; r: number }                       // centre = f.o, in the plane of f
  | { t: 'Arc3';     f: Frame; r: number; from: number; to: number }
  | { t: 'Conic3';   f: Frame; conic: ConicValue2D }             // reuses the 2D conic value (section 11)
  | { t: 'Polygon3'; pts: readonly V3[]; f: Frame }              // flat; f is a frame of the plane
  | { t: 'PolyLine3'; pts: readonly V3[]; closed: boolean }
  | { t: 'Polyhedron'; verts: readonly V3[]; faces: readonly Face[]; kind: SolidKind }
  | { t: 'Quadric';  q: QuadricSpec }                            // sphere, cylinder, cone, ... (section 6)
  | { t: 'Surface';  s: SurfaceSpec }                            // parametric, explicit z=f(x,y), implicit, revolution
  | { t: 'Curve3';   c: CompiledCurve3 }
  | { t: 'Solid';    s: SolidSpec }                              // closed solid of revolution; has a volume
  | { t: 'Net';      poly: Polyhedron; t: number; layout: NetLayout };

export interface Face { readonly idx: readonly number[]; readonly normal: V3 }  // idx in order, outward normal
export type SolidKind =
  | 'pyramid' | 'prism' | 'tetrahedron' | 'cube' | 'octahedron' | 'dodecahedron' | 'icosahedron' | 'hull' | 'general';
```

The 2D `TypeName` gains: `Point3 Vector3 Line3 Segment3 Ray3 Plane Circle3 Arc3 Conic3 Polygon3 PolyLine3 Polyhedron Quadric Surface Curve3 Solid Net Function2` (`Function2` = a function of two numbers). `shape`, `path` and `region` are type classes in the command table (core design sections 5 and 6), widened to include these.

### 5.1 Paths and regions in space

The 2D `Path` interface (points-lines design section 3.2) generalises:

```ts
export interface Path3 {
  readonly kind: 'line' | 'ray' | 'segment' | 'circle' | 'arc' | 'conic' | 'polyline' | 'polygon-edge' | 'curve' | 'intersection-curve';
  readonly closed: boolean;
  readonly domain: readonly [number, number];
  at(s: number): V3;
  tangent(s: number): V3 | undefined;
  project(p: V3, hint?: number): { s: number; dist: number };
  norm(s: number): number;
  unnorm(u: number): number;
}

/** Things a point can be dragged on besides paths. */
export interface Surf3 {
  readonly param: { u: readonly [number, number]; v: readonly [number, number] };
  at(u: number, v: number): V3;
  normal(u: number, v: number): V3 | undefined;
  /** Nearest parameters to p (Newton from `hint`, then coarse search). */
  project(p: V3, hint?: readonly [number, number]): { u: number; v: number; dist: number };
  /** Ray hit, nearest first; used for picking and dragging. */
  rayHits(o: V3, d: V3, maxHits: number): readonly { u: number; v: number; t: number }[];
}
```

A `PointOn(path, s)` uses `norm`/`unnorm` exactly as in 2D, so a point's saved position is a stable 0..1 number.

### 5.2 Tolerances

3D rules use the same `Tol` object as 2D (points-lines design section 3.3), with the same scale-aware meaning. Two additions for 3D: `tol.flat` (relative bound for “these points are coplanar”, default 1e-9 of the polygon's diameter) and `tol.tangent` (default 1e-9 relative: two surfaces counted as touching rather than crossing).

---

## 6. Solids, quadrics and surfaces: representation and algorithms

### 6.1 Polyhedra

`Polyhedron { verts, faces, kind }`: faces are index loops with outward normals; edges are derived (each edge shared by exactly two faces for a closed solid; checked once at build). Builders:

- **Pyramid(base, apex)**: base vertices in order, apex above or below the base plane (a point in the plane is `degenerate`). Triangular side faces. **Height form:** apex = base centroid + height · unit normal (the centroid of the polygon's area, not of the vertices).
- **Prism(base, top)**: translate the base by `top − first vertex`. Side faces are parallelograms (planar by construction). **Height form:** translate by height · unit normal.
- **Regular solids from an edge**: Cube, Tetrahedron, Octahedron, Dodecahedron, Icosahedron come from tabulated canonical vertex and face lists (unit edge, centred), then a similarity transform that maps the canonical edge to PQ and puts the solid on the `side` point's half-space. One table, one transform; no per-solid rules.
- **Hull3**: incremental convex hull (quickhull). Complexity O(n log n) average, n up to 2,000 points. Coplanar-everything → `degenerate`; duplicates merged at `tol.eq`.
- **Polyhedron(verts, faces)**: validates each face is flat within `tol.flat`, edges are matched, orientation made consistent by walking face adjacency, then outward direction fixed by signed volume. Non-manifold input is accepted as `kind: 'general'` with `closed = false` flagged, so `Volume` reports `not_closed` while drawing still works.
- **Volume**: for a closed solid, the sum over faces of the signed volume of the tetrahedron (origin, triangle) after triangulating each face by ear clipping (concave faces allowed). **SurfaceArea**: sum of face areas. Both exact to double rounding; Kahan summation; sanity target: relative error < 1e-12 on a unit cube translated 1e6 away (translate to centroid before summing).
- **Faces / Edges / Vertices** lists are stable: indices follow the builder's documented order, so scripts like `Faces(p)[1]` mean the same after a drag.

### 6.2 Quadrics

One record covers every quadric a learner meets, in the frame in which it is simplest:

```ts
export type QuadricKind =
  | 'sphere' | 'ellipsoid' | 'hyperboloid1' | 'hyperboloid2'
  | 'paraboloid' | 'hyperbolic-paraboloid'
  | 'cone' | 'cylinder' | 'parabolic-cylinder' | 'hyperbolic-cylinder'
  | 'two-planes' | 'two-parallel-planes' | 'plane' | 'line' | 'point' | 'empty';

export interface QuadricSpec {
  readonly kind: QuadricKind;
  /** Symmetric 4×4 matrix Q so that [x y z 1] Q [x y z 1]ᵀ = 0. Source of truth for intersections. */
  readonly Q: Float64Array;                       // 16 numbers
  /** Principal frame: centre or vertex, and orthonormal axes (a, b, c). */
  readonly frame: { readonly o: V3; readonly a: V3; readonly b: V3; readonly c: V3 };
  /** Semi-axes or shape numbers in the frame; meaning depends on kind. */
  readonly k: readonly [number, number, number];
  /** For limited cones and cylinders: axial range [h0, h1] and whether the ends are closed. */
  readonly limit?: { readonly h0: number; readonly h1: number; readonly caps: boolean };
}
```

- **Classification** (from any quadratic equation): take the 3×3 block `A` and the 4×4 matrix `Q`. Diagonalise `A` with the Jacobi rotation method (3×3, converges in under 10 sweeps; accurate to 1e-15 relative). Count signs of eigenvalues of `A` (zero if below `tol.eq · max|λ|`) and the rank and signature of `Q`; a lookup of (rank A, rank Q, signs) gives the kind. Then compute centre (solve `A c = −b` when A is invertible) and semi-axes. This is a handful of 3×3 operations, microseconds.
- **Direct builders** (`Sphere`, `Cylinder`, `Cone`, …) fill `frame`, `k`, `limit` exactly, then derive `Q`. So a sphere is exactly a sphere, not “classified from numbers”.
- **Drawing infinite quadrics** (cones, cylinders, hyperboloids, paraboloids, planes pairs): the renderer asks for the axial range that covers the clip box (or the view's visible bounds), computed by projecting the box's 8 corners onto the quadric axis; the mesh covers only that range.
- **Limited cone/cylinder**: three drawable pieces (lateral, top face, bottom face) that are also objects through `Lateral`, `TopFace`, `BottomFace`.

### 6.3 Surfaces

```ts
export type SurfaceSpec =
  | { kind: 'explicit';   f: CompiledFn2 }                                         // z = f(x, y)
  | { kind: 'parametric'; x: CompiledFn2; y: CompiledFn2; z: CompiledFn2;
      u: readonly [number, number]; v: readonly [number, number] }
  | { kind: 'implicit';   F: CompiledFn3; level: 0 }                               // F(x, y, z) = 0
  | { kind: 'revolution'; profile: Path3 | CompiledFn1; axis: { o: V3; d: V3 };
      s: readonly [number, number]; angle: readonly [number, number] };
```

**Meshing.** Surfaces are tessellated off the main thread into `MeshChunk`s (positions, normals, indices; Float32/Uint32). Three algorithms:

1. **Explicit and parametric** (adaptive quadtree in parameter space). Start with a coarse grid (16 × 16). A cell splits when any of these hold: (a) the screen-space distance between two adjacent corners exceeds `maxEdgePx` (default 8); (b) the normals at adjacent corners differ by more than `maxBend` (default 12°); (c) a sample is undefined or non-finite next to a defined one (to find the boundary of the domain, up to depth `maxDepth` = 9); (d) the cell crosses a face of the clip box. A cell wholly outside the clip box or the camera frustum is not split and not emitted. The quadtree is **2:1 balanced** (neighbours differ by at most one level) and **T-junctions are fixed** by inserting the neighbour's midpoint into the coarser cell's edge, so there are no cracks (GeoGebra's weak point). Poles (for example `v = 0` on a sphere parametrisation) are detected from zero-length edges and collapsed to a fan.
2. **Implicit** (marching cubes on an adaptive octree with edge refinement). A coarse 24³ grid over the clip box (or the view bounds); cubes whose corner signs differ are subdivided by the same screen-size test, to depth 7. Each surface vertex is refined with 3 secant steps along the cube edge, then its normal is the normalised gradient of `F` (analytic if `F` is differentiable by the kernel's derivative; else central difference with step 1e-4 × box size). Thin sheets where no corner flips are caught by sampling `F` and `|∇F|` at cube centres (cheap Lipschitz test): cubes where `|F| < L · size` are refined even if signs agree.
3. **Revolution**: sweep the profile polyline (adaptive in `s` as for a curve) by rotation about the axis in `angle` steps chosen by the screen-size test on the largest radius (minimum 24 steps per full turn). A profile that touches the axis makes a pole (fan).

**Budgets and progressive refinement.** A hard cap of 300,000 triangles per figure (configurable: `@limit triangles 300000`); beyond it, meshes stay at the coarsest level that fits and the object reports a `mesh_truncated` warning (not an error). Meshing runs in slices of at most 3 ms on the main thread, or in a Web Worker: a first coarse mesh appears within one frame (target: under 16 ms for a 16 × 16 grid), then refines over the next frames, then re-refines on zoom or rotation (the screen-size test depends on the camera, so camera moves queue a refinement, throttled to 10 per second).

**Wireframe.** A surface shows `uLines × vLines` iso-lines (default 12 × 12 in parameter space for parametric surfaces; a grid aligned with the x and y axes at the grid step for explicit ones), drawn as polylines on the mesh, not as part of the triangles. A property `mesh = off` hides them.

**Solid of revolution.** `SolidOfRevolution(f, a, b, L)` is `Solid { profile, axis }` and its volume is computed in closed form where possible: for a function that is a polynomial of degree ≤ 4 in the kernel's syntax tree the integral `π ∫ f² ds` is exact by symbolic expansion; otherwise adaptive Gauss–Kronrod with relative tolerance 1e-10. Area between two graphs uses the washer formula `π ∫ (f² − g²)`, valid when `f ≥ g ≥ 0` or both on the same side of the axis; otherwise the rule returns `undefined` with reason `self_overlap` and `detail` that names the interval where the graphs cross the axis. The surface area of revolution is the numeric integral `2π ∫ r(s) √(r'² + z'²) ds`.

### 6.4 Nets

`Net(poly, t)`: unfold a closed convex polyhedron (prisms, pyramids and the regular solids first; any convex one by the same rule).

1. Build the **face adjacency graph** (nodes: faces; edges: shared polyhedron edges, weighted by edge length).
2. Pick a **root face** (the base for a pyramid or prism; otherwise the largest face).
3. Choose a **spanning tree** by breadth-first search from the root, trying several tie-breaks (longest shared edge first, then shortest) until the flat layout has **no overlap** between faces (polygon intersection test with a bounding-box prefilter); stop at the first non-overlapping tree, at most 24 tries. If none succeeds (rare), return the best layout and flag `net_overlap` in the figure warnings.
4. For each tree edge, the dihedral angle `φ` between the parent and child face is known from face normals. With slider `t ∈ [0, 1]` the child rotates about the shared edge by `(1 − t) · φ'` where `φ'` is the exterior angle, so `t = 0` is the folded solid and `t = 1` lies flat in the root face's plane.
5. Output the faces' vertices at that `t` (a `Polyhedron`-like list of polygons) plus the tree edges (fold lines, drawn dashed).

All at O(F²) for F faces in the overlap test; F ≤ 60 in practice. Target: net of a dodecahedron in under 3 ms.

### 6.5 Level of detail for lines and points

Lines and curves are polylines with screen-space error ≤ 0.5 px (same recursive subdivision as the 2D plotter, applied to the projected curve). Points are drawn as sphere impostors.

---

## 7. Intersections in 3D

`Intersect(a, b)` returns the same shapes as in points-lines (design section 4 and 3.5): a **list with fixed length and undefined slots** where the maximum count is bounded, a compact sorted list otherwise; `Intersect(a, b, k)` picks one slot. This table is the 3D addition. “→” shows the result type.

| a | b | Result | Method | Notes on slots |
|---|---|---|---|---|
| Line3 | Line3 | Point3 | Solve closest approach; if the gap ≤ `tol.on` · scale then point, else `skew` | Parallel: `parallel`; same line: `coincident` |
| Line3 | Plane | Point3 | `t = (c − n·o) / (n·d)` | `parallel` when `|n·d| ≤ tol.parallel`; lies in plane: `coincident` |
| Plane | Plane | Line3 | Direction `n₁ × n₂`; point from the two plane equations | Parallel: `parallel`; same plane: `coincident` |
| Plane, Plane, Plane (3 arguments) | | Point3 | 3×3 solve (Cramer with `det3` error bound) | `degenerate` if singular (no single common point) |
| Line3 | Sphere / Quadric | 2 slots Point3 | Substitute `o + t d` into `Q`: quadratic in `t`. Stable form `q = −(b + sign(b)√disc)/2`, roots `q/a` and `c/q` | Slot order: ascending `t` along `d`. Tangent: both slots equal. For limited cone/cylinder, hits on the lateral piece and on the caps are merged then filtered by limits and sorted by `t` (up to 4 raw hits → at most 2 kept for a convex body; ≥ 2 for concave) |
| Line3 | Polygon3 | Point3 | Line–plane, then point-in-polygon in plane coordinates (winding number, with boundary tolerance) | `no_intersection` if outside |
| Line3 | Polyhedron | List<Point3> (≤ 2 for convex) | Slab/BVH over faces; per face as above; merge hits on shared edges | Sorted by `t` |
| Line3 / Segment3 / Ray3 | any of the above | same | Same method, then filter by the segment/ray's parameter range | The type of path decides the filter |
| Line3 | Surface (explicit/parametric/implicit) | List<Point3> | Sample along the line inside the bounds (adaptive, 64 samples then bisection per sign change, then Brent root finding to 1e-12) | Compact, sorted by `t`; also stops at 64 hits (`limit`) |
| Plane | Sphere | Circle3 | Distance from centre to plane vs radius | `no_intersection` when farther. Touching returns a `Circle3` with `r = 0` (so the result type stays the same for scripts); `Center` of it is the touching point |
| Plane | Quadric | Conic3 | Write plane in frame `(o,u,v)`; substitute `x = o + s u + t v` into `Q` → a 3×3 symmetric matrix of a 2D conic in `(s,t)`; classify with the 2D conic code (reused) | Result type Conic3 (ellipse/parabola/hyperbola/pair of lines/point/empty). An empty conic → undefined `no_intersection` |
| Plane | Limited cone/cylinder | Conic3 clipped (an arc, or two arcs plus segments on the caps) → `Path3` list | Conic section, then clip by the axial range and add cap intersections | A `PolyPath3` value |
| Plane | Polygon3 | Segment3 | Clip polygon edges against plane; collect two crossing points | Coplanar: the polygon itself (`coincident`) |
| Plane | Polyhedron | Polygon3 (the cross-section) | For each face, plane–polygon segment; link segments into one loop by shared endpoints; area/centroid available | Convex solid → one loop; concave → a list of loops (a `List<Polygon3>`). Hits only a vertex or edge → degenerate point or segment, returned as `Point3` / `Segment3` with a flag |
| Plane | Curve3 | List<Point3> | Root finding of `n·c(s) − c` on a sample grid then Brent | Compact |
| Plane | Surface | Curve3-like `Path3` list | Explicit surface `z = f`: contour of `g(x,y) = f(x,y) − (c − n_x x − n_y y)/n_z` by marching squares in the plane, with the same adaptive refinement as meshing; implicit: marching squares of `F` restricted to the plane's frame; parametric: contour tracing in `(u,v)` | Returns polylines with Hermite refinement to 0.5 px screen error |
| Sphere | Sphere | Circle3 | Radical plane then plane–sphere | Concentric: `coincident` (same radius) or `no_intersection` |
| Quadric | Quadric | `Path3` list (intersection curve) | Special cases first: sphere–sphere, coaxial cylinder/cone/sphere pairs → circles/lines; otherwise marching: find seed points by sampling one quadric's mesh against the other's `Q`, then follow the curve with predictor–corrector steps (tangent = `∇Q₁ × ∇Q₂`, corrector Newton on both equations), step by screen size, closed-loop detection, branch handling at singular points by stopping and reseeding | Accuracy: both equations satisfied to < 1e-10 relative at every output point; at most 8 components; `timeout` at 20 ms per update (progressive) |
| Surface | Surface | `Path3` list | Same marching scheme as quadric–quadric using `F` (implicit) or the parametric map plus an implicit form; for two parametric surfaces solve for `(u,v,s,t)` with Newton from seeds found by mesh–mesh triangle intersection (BVH) | Progressive; marked `approximate` |
| Circle3 / Conic3 | Line3 | List<Point3> | Plane–line then 2D conic–line in frame coordinates | 2 slots, undefined if absent |
| Circle3 / Conic3 | Plane | List<Point3> | Line = plane ∩ conic's plane, then conic–line; coplanar → `coincident` | 2 slots |
| Circle3 | Sphere / Quadric | List<Point3> | Parametrise circle: `A cos θ + B sin θ + C` → quartic in `tan(θ/2)` solved with a robust polynomial solver | Up to 4 slots for quadrics, 2 for spheres, sorted by angle |
| Curve3 | Curve3 | List<Point3> | Closest-approach search (same sampling + Newton), accepted if gap ≤ `tol.on` | Rare; compact |
| Polyhedron | Polyhedron | `List<PolyPath3>` (closed loops of segments) | Triangle–triangle intersection across a BVH, then loop linking | Convex–convex fast path through plane clipping |
| Polygon3 | Polygon3 | Segment3 | Plane–plane line, interval overlap of each polygon along that line | Coplanar: the polygon overlap (2D polygon intersection, reused) |

**Surface/solid Boolean (cut, union, difference of polyhedra)** is not in v1 (section 14 lists it as a stretch).

**Result stability.** All lists obey the “fixed length, undefined slots, order depends only on inputs” rule from points-lines section 3.5, so dragging changes values continuously and films replay exactly. For intersection curves, “slot” is the component index sorted by the smallest parameter along the first input's longest path, then by a position tiebreak. Components can still appear and disappear when topology changes (two loops merge): that is a real discontinuity, flagged in the change report (`topology_changed`).

**Tolerance.** All hit tests use `Tol.on` scaled by the larger input size. Tangency is decided by `tol.tangent` and reported as an equal pair rather than a missing pair.

---

## 8. Camera, projection, light, clip box: the `space` object

### 8.1 The reserved object

`space` is a kernel object of type `View3`, created on `@view3` or on the first 3D object. It cannot be deleted. It has no value of its own; its properties are the rules `with` writes (core design section 9: properties are in the graph, so any may be a formula of `t` or a slider).

| Property | Type / values | Default | Meaning |
|---|---|---|---|
| `azimuth` | angle | −40° | Turn about the up axis; 0 looks along +y |
| `elevation` | angle (−90°..90°) | 22° | Tilt above the floor |
| `roll` | angle | 0 | Tilt of the horizon; usually 0 |
| `target` | Point3 | origin | Look-at point; the camera orbits it |
| `zoom` | number > 0 | 1 | Scale: ortho = pixels per unit relative to the fit; perspective = moves the eye in/out |
| `projection` | `ortho`, `persp`, `oblique` | `ortho` | Section 8.3 |
| `fov` | angle 5°..120° | 40° | Perspective vertical field of view |
| `obliqueAngle` | angle | 30° | Oblique: direction the depth axis recedes |
| `obliqueFactor` | 0..1 | 0.5 | Oblique: foreshortening of depth |
| `zUp` | bool | true | Up axis is z (else y) |
| `aspect` | (ax, ay, az) | (1,1,1) | Axis scale ratios, e.g. z drawn twice as tall |
| `axes`, `floor`, `grid` | bool | true, true, true | Axes, the floor plate, the grid on the floor |
| `light` | `on`, `off`, `flat` | `on` | Section 8.5 |
| `clip` | bool | false | Clip box on |
| `clipMin`, `clipMax` | Point3 | (−5,−5,−5), (5,5,5) | The box |
| `clipSize` | `tiny`..`huge` | `medium` | Presets that scale the box about its centre |
| `stereo` | `off`, `anaglyph`, `sidebyside` | `off` | Section 8.6 |
| `eyeSep` | number | 0.03 | Eye separation as a fraction of the eye distance |
| `background` | Color | white | |
| `spin` | number deg/s | 0 | Azimuth advances with film time |

Setting `elevation` to ±90° is allowed: the camera uses a quaternion internally and chooses a stable “up” on the screen (continuing the previous screen-up) so there is no flip or lock.

### 8.2 Camera maths

State is derived from the properties each frame:

```ts
export interface Camera {
  readonly q: Quat;                 // orientation: world → camera
  readonly target: V3;
  readonly dist: number;            // eye distance from target (persp) or a fit distance (ortho)
  readonly scale: number;           // pixels per world unit at the target
  readonly projection: 'ortho' | 'persp' | 'oblique';
  readonly fovY: number;
  readonly shear: { readonly kx: number; readonly kz: number };    // oblique
  readonly aspectAxes: V3;
  readonly viewport: { readonly w: number; readonly h: number; readonly dpr: number };
  readonly near: number; readonly far: number;                      // fitted each frame
  readonly view: Float64Array; readonly proj: Float64Array;          // 4×4
  readonly vp: Float64Array;                                         // proj·view, kept in Float64 on CPU
}
```

- **Orientation** from azimuth, elevation, roll by composing quaternions; user rotation (drag) multiplies the quaternion directly (rotate about the screen's vertical axis for horizontal drags, about the screen's horizontal axis for vertical drags), then azimuth/elevation properties are read back for the file (`space with azimuth = …`). Two paths, one result.
- **Near/far fit every frame** from the bounding sphere of what is visible (and the clip box if on), with a margin. Depth precision target: 24-bit depth buffer resolves two surfaces separated by 1e-4 of the scene size at the fit distance. (GeoGebra's fixed ranges cause z-fighting at extremes.)
- **Rendering matrices** are built in Float64 on the CPU and the model-view is applied relative to the camera target (floating origin): vertex positions in GPU buffers are stored relative to a chunk origin, so a scene centred 1e6 away still shows without jitter.

### 8.3 Projections

- **Orthographic**: parallel rays. `screen = scale · (R · (p − target))`. Depth only for ordering.
- **Perspective**: eye at `target + R⁻¹ · (0, 0, dist)`; `fov` sets the focal length for the viewport height: `f = (h/2) / tan(fov/2)`. Eye distance and zoom: `zoom` moves the eye along the view axis (dolly), not the field of view, so perspective is not distorted by zoom.
- **Oblique** (cabinet/cavalier family): the plane facing the viewer (xz when azimuth = 0 and elevation = 0) keeps true shape; the depth axis is drawn as a vector of length `obliqueFactor` at screen angle `obliqueAngle`. Implementation: a shear on top of an orthographic camera at azimuth 0, elevation 0: screen `x' = x + kf · cos θ · depth`, `y' = z + kf · sin θ · depth` (`kf` = `obliqueFactor`, θ = `obliqueAngle`). Because it is a pure shear, rotating the camera is allowed: shear is applied after rotation to the camera's own depth axis.
- **Presets** (`ViewPreset`): `front`, `back`, `left`, `right`, `top`, `bottom` are orthographic with exact azimuth/elevation; `isometric` is orthographic with azimuth 45° and elevation arcsin(1/√3) ≈ 35.26°.

### 8.4 Look at a plane or object (“view in front of”)

`ViewFacing(obj)` sets azimuth and elevation (and `roll` to 0) so the camera looks along the negative normal of a plane/polygon/face, or perpendicular to a line, with the nearest of the two normal directions picked by the current camera (so the move is the shorter turn). `target` goes to the object's centre. In interactive use the view animates over 400 ms with ease-in-out; in a script it is instantaneous, and the film's beat transition may add an ease (core design: `@beat`).

### 8.5 Lighting and materials

- **Model.** One key light fixed in camera space (up-left-front, direction normalised (−0.4, 0.6, 0.7)), one fill light from the opposite side at 30% strength, and ambient 35%. Diffuse is Lambert; specular is a small Blinn–Phong highlight (shininess 24, strength 0.12) on opaque surfaces only. Fixed to the camera so the shading of a rotating solid changes with rotation; “flat” mode removes shading.
- **Two-sided.** The back side of a surface is shaded with the flipped normal and 85% brightness; clipping and hidden line tests use the front.
- **Colour.** Per object: `color`, `opacity` (0..1), `mesh` (iso-lines on/off), `lineWidth`, `dash`. Defaults (ui.md): points dark blue, lines dark gray, planes light blue at opacity 0.25, solids per-object pastel at 0.4, surfaces gradient by height at 0.9.
- **Light off** (`light = off`): all surfaces render with ambient only plus a rim shade (no highlights), so a flat classroom print looks right.

### 8.6 Stereo, AR, XR

- **Stereo** (phase 4): render the scene twice with horizontally offset eyes `±eyeSep · dist / 2` along the camera's right axis, using an **off-axis** frustum so both eyes converge on the target plane (zero parallax there). `anaglyph`: left eye red channel, right eye green+blue, with a luminance-weighted colour matrix to keep colour readable; `sidebyside`: two half-viewport renders (for cardboard-style or cross-view). In stereo, labels and the cursor are drawn at target depth to avoid double images.
- **AR / XR** (phase 5): WebXR `immersive-ar` with hit-test and anchors. The user taps a detected surface; the figure is placed there with `1 unit = 1 cm` (selectable 1 mm, 1 cm, 10 cm, 1 m), z up to y up conversion done by a root transform; drag moves it, twist rotates, pinch scales; “Take picture” composites camera and canvas. Fallback for devices without WebXR: export `.glb` and offer the platform's native viewer. The scene graph (section 9) is renderer-neutral, so XR needs only a new camera source and a render target.

### 8.7 Clip box

- `clip = on` cuts all objects to the axis-aligned box `[clipMin, clipMax]`. The box outline is drawn (thin gray), with its corner handles in edit mode.
- In shaders: every fragment compares its world position against the box and is discarded outside. Lines and points are clipped in their vertex stage using the quad's world position. This is fast and exact at pixel level.
- **Caps** (optional `clipCaps = on`, phase 3): for closed solids the cut face is filled using the stencil-count technique (increment on back faces, decrement on front faces inside the box; where the count is odd the cut plane is inside the solid; fill with the solid's colour). Gives solid-looking cross-sections without computing geometry. GeoGebra shows hollow cuts.
- Meshing uses the box: surfaces are meshed only inside it (section 6.3), which is also why clip is the standard way to show a bounded piece of an infinite quadric.

---

## 9. Rendering design (WebGL2 first)

### 9.1 Why WebGL2, and the WebGPU plan

WebGL2 runs on every current desktop browser and on iOS 15+, has multisampled render buffers, instancing, 3D textures, float render targets (with the `EXT_color_buffer_float` extension, absent on a few older mobiles), and is what the 2D layer's particles already use (core design section 8). WebGPU adds compute shaders (GPU tessellation, GPU order-independent transparency) but is not yet universal on mobile and Safari. Decision: **write the renderer against a small `GpuBackend` interface, implement it for WebGL2 now, add a WebGPU implementation when 90% of target browsers have it.** Shaders are written once in a tiny TS shader builder that emits GLSL ES 3.00 now and WGSL later; no `#ifdef` forests.

```ts
export interface GpuBackend {
  readonly kind: 'webgl2' | 'webgpu' | 'software';
  createArena(layout: VertexLayout, capacityBytes: number): Arena;      // big shared vertex/index buffers
  createTarget(spec: TargetSpec): Target;                               // colour/depth/MSAA/float targets
  createProgram(src: ShaderSrc): Program;
  beginFrame(cam: Camera, size: Size): FrameCtx;
  draw(frame: FrameCtx, batch: Batch): void;
  readPixels?(t: Target, rect: Rect): Uint8Array;                       // only for export
  dispose(): void;
}
```

### 9.2 Scene graph: from kernel events to draw items

The kernel emits add, update, remove, restyle events (core design section 8). `packages/view/src/space/` turns each object into **draw items**:

```ts
export type DrawItem =
  | { k: 'points';  pos: Float32Array; size: number; color: u32; objId: ObjId }   // sphere impostors
  | { k: 'lines';   pos: Float32Array; width: number; color: u32; dash?: Dash; closed: boolean; objId: ObjId }
  | { k: 'mesh';    pos: Float32Array; nor: Float32Array; idx: Uint32Array; color: u32; alpha: number; closed: boolean; objId: ObjId }
  | { k: 'label';   anchor: V3; text: LabelSpec; objId: ObjId };
```

- **Arena batching.** All meshes share one vertex buffer and one index buffer (per vertex layout) with an offset allocator; each object owns a range. Updating an object rewrites its range (`bufferSubData`) or re-allocates (free list). The draw loop issues one call per material class, not per object (GeoGebra does similar). Vertex colour (RGBA8) carries object colour/alpha, so restyle rewrites only the colour bytes.
- **Floating origin.** Each chunk stores positions relative to a chunk origin (Float32) and a per-chunk offset uniform (Float64 split into two Float32). Precision is steady for far-from-origin scenes.
- **Lines** are drawn as screen-aligned quads (instanced segments), with round joins by overlapping caps and analytic antialiasing; the line width is in CSS pixels × dpr. WebGL's 1 px line primitive is not used.
- **Points** are instanced quads with a fragment shader that fakes a lit sphere (impostor): correct depth written from the sphere surface.
- **Labels** go to a 2D canvas overlay positioned from projected anchors (crisp, cheap, reuses the 2D text engine and maths rendering); labels get a halo and avoid each other by greedy offset search (8 positions around the anchor, cost ≤ 0.3 ms for 100 labels). Labels also feed the screen-reader list.

### 9.3 Frame sequence

1. **Update:** consume kernel events, rebuild changed items, upload ranges. Budget: under 2 ms per frame for typical edits.
2. **Hide-depth pass** (only if any closed transparent solid or `hidden = dashed` exists): render closed solids' *front* faces into a depth-only texture `H`. Cost: one pass over solids.
3. **Opaque pass:** MSAA 4× colour+depth target. Draw opaque meshes (depth write), then opaque lines and points with the depth test `LESS`.
4. **Hidden-line pass:** lines/edges again with the test `GREATER` against the opaque depth *and* `H`: drawn dashed and at 40% alpha (setting `hidden = dashed | faded | off`). Shader compares fragment depth to the depth texture rather than relying on the depth test alone, so edges behind a *transparent* solid are also dashed (the common textbook look).
5. **Transparent pass:** weighted blended order-independent transparency (WBOIT): two float targets (accumulation RGBA16F and revealage R8/R16F), no depth write, test against opaque depth; then a full-screen composite. Where `EXT_color_buffer_float` is missing: fallback to **back-to-front by object centre** with two-pass culling for closed convex solids (back faces, then front faces).
6. **Overlay:** axes arrows and labels, selection halo, drag gizmo, cursor, labels canvas.
7. **Resolve** MSAA and present; for stereo, steps 3–7 run twice.

Draw-call and memory budget: 300k triangles, 50k line segments, 10k points on a mid laptop at 60 fps (sub 8 ms GPU); phones: 30 fps at 100k triangles.

### 9.4 Picking

Picking is **analytic ray casting on the CPU**, not a colour readback. Reasons: no GPU stall, works headless in tests, returns exact parameters (`u`, `v`, `s`) for dragging and snapping, and unaffected by antialiasing or transparency.

```ts
export interface PickHit {
  readonly objId: ObjId;
  readonly kind: 'point' | 'path' | 'surface' | 'label' | 'gizmo';
  readonly t: number;               // distance along the ray
  readonly world: V3;
  readonly param?: { s?: number; u?: number; v?: number };
  readonly screenDist: number;      // pixels from the pointer, for points and paths
}
export function pick(scene: SceneIndex, ray: Ray, px: number, opts: PickOpts): readonly PickHit[];
```

- The pointer ray: orthographic parallel to the view direction; perspective from the eye through the pixel.
- **Points and paths** hit if the closest approach in *screen space* is within `px` (default 10 CSS px for touch 22). Closest points are found analytically for lines/segments/rays/circles, by polyline for curves.
- **Surfaces and solids**: ray–triangle on the objects' own meshes through a BVH built on mesh update (a build is O(n log n); 100k triangles in about 25 ms off-thread).
- **Priority** (so a small point on a big plane is pickable): gizmo > labels > points > paths > surfaces; ties by depth. Within px tolerance a point beats a surface in front of it, as long as the point is not hidden behind an *opaque* surface.
- **Transparent surfaces** are pickable only on their visible mesh and rank last, so a ghost plane does not steal clicks.

### 9.5 Software and export renderers

A second `GpuBackend` (`software`) draws the same draw items with painter's algorithm into Canvas 2D (triangles sorted by view depth, flat shading, dashed hidden lines). Use: devices without WebGL2, headless tests (node-canvas), and **SVG/PDF export** where vector output is wanted. It is O(n log n) in triangles and capped at 20k triangles; beyond that it simplifies by dropping iso-lines. It is not meant to look as good; it must be correct.

Other exports: PNG at ×1..×4 scale from the real renderer; `.glb` (glTF binary) with materials; `.stl` for closed solids (watertight check first, else a warning).

---

## 10. Dragging, snapping and handles in 3D

### 10.1 Free points

A free `Point3` is dragged through a **constraint** chosen by the learner, not toggled by clicking:

- **Default drag** (grab the point itself): move on the plane through the point **facing the camera most** among the three axis-aligned planes (xOy, xOz, yOz): pick the plane whose normal has the largest dot product with the view direction. The pointer ray is intersected with that plane. This is the “it follows the mouse” behaviour. A thin dotted guide drops to the floor so the learner sees where it is.
- **Handles** (shown when a point is selected or hovered): three arrows (x red, y green, z blue) and three small squares (xy, xz, yz). Dragging an arrow constrains to that axis line; dragging a square constrains to that plane.
- **Modifier**: hold Shift while dragging = vertical only (z); Alt = along the line from the camera (depth). Touch: the handles are larger (44 px) and a long-press toggles “vertical mode”.
- **Keyboard**: arrow keys move in x and y by one grid step (Shift: ×10, Alt: ÷10), PageUp/PageDown move in z (matches common expectation), Home/End step to nearest grid point. Screen reader announces the new coordinates.

Math: **ray–plane** (`t = (c − n·o)/(n·d)`) with a guard: if `|n·d| < 0.05` (looking edge-on at the plane) switch to the next-best plane for the rest of this drag (keeping continuity by moving the point to the old position on the new plane). **Ray–line closest approach** for an axis drag: with ray `o + t d`, line `a + s e`, solve the 2×2 for `(t, s)`; if `1 − (d·e)² < 1e-6` (ray parallel to the axis) hold the last value.

### 10.2 Snapping

Snap to the grid (on the floor and its z multiples) when `snap = on` (default: auto, snaps within 0.15 of a step in screen terms); snap to other objects: a dragged point near an object under the pointer becomes “on” that object only when the tool is Point or PointOn (see 10.3). The snap target is previewed (a ring) before release.

### 10.3 Points on objects and dependents

- **On a path** (`PointOn(path, s)`): the parameter is the closest point on the path to the pointer ray (closest approach between a ray and a curve, solved by sampling then Newton, continuity guard: prefer the solution nearest the previous `s`; for closed curves wrap-around is allowed).
- **On a surface/plane/face**: ray–surface hit (nearest hit visible from the camera); fallback to the closest parameters if the ray misses but is within px.
- **Dependent points** (such as `M = Midpoint(A, B)`) are dragged by moving their free parents through the kernel's `dragPlan` (kernel design section 7): `Midpoint` moves both ends by the same shift; `Intersect` points are not draggable and the cursor says why.
- **Whole-object drags** (a sphere by its centre, a prism by its base) move the free inputs the way 2D does.

### 10.4 Camera gestures

| Input | Effect |
|---|---|
| Drag background, or right-drag | Orbit (trackball style: horizontal = azimuth, vertical = elevation; quaternion update, so passes over poles) |
| Shift-drag, middle-drag, two-finger drag | Pan: translate target in the screen plane |
| Wheel, pinch | Zoom toward the pointer position (ortho: scale about the pointer; persp: dolly toward the point under the pointer) |
| Two-finger twist | Roll (hidden unless `roll` is enabled) |
| Release with velocity | Inertial spin that decays with time constant 350 ms (can be disabled) |
| Double-click empty space | `ViewReset` animated; double-click an object `ViewFacing` it |
| Hold Ctrl+drag on an axis arrow | Change that axis' scale (aspect) |

Orbit sensitivity: 0.4° per CSS px by default.

---

## 11. How 3D shares the 2D kernel

1. **Same object model.** A 3D object is an object with `type` in the 3D set, `def`, `value`, `style`, `order`. Rules are pure functions from input values to an output value, same as 2D. Nothing about the graph, undo, journal, redefinition, free versus dependent, sliders, clock or `with` changes.
2. **Same command table.** 3D forms are rows added to existing and new commands; the form checker is exact-type, in table order. A command's group (`space`) decides which catalogue chunk a model loads.
3. **Same numeric core.** `Tol`, `det2`, `orient` (extended to `orient3` with a 3×3 error-bounded determinant for point-versus-plane tests), ordinal slots, `Path`.
4. **Plane-coordinate reuse.** Anything flat in space (circle, conic, polygon) is a 2D value plus a `Frame`. Operations that are intrinsically 2D run in the frame: conic classification, polygon area and winding, 2D polygon intersection (for coplanar polygon overlap), conic–line intersection. Results map back with `o + x u + y v`. This is the pattern GeoGebra uses, kept deliberately.
5. **2D objects in the Space view.** A 2D object's value is drawn lying on the floor. It is not a 3D object and cannot be used in a 3D rule until lifted: `Lift(shape2d, frame)` (a small command; default frame = floor) makes a `Polygon3` / `Circle3` / `Conic3` / `Segment3` etc. from a 2D shape.
6. **Plane view.** `PlaneView(plane)` (an `@view2on` directive form) is a 2D Graphics view whose coordinates are the plane's frame. Objects of the 3D scene intersect the plane live and the 2D view shows the cross-section with exact 2D tools (area, measure). This is GeoGebra's best idea in the area; we keep it and extend it with a “cut view” for solids (cross-section polygon + its area readout).
7. **Dimension-agnostic user functions.** `f(x) = …` stays 1-variable; `f(x, y) = …` is a `Function2`. A function of two variables is a normal function value that the 2D calculus area owns; the Space view draws it. Partial derivative commands live in the calculus area (`Derivative(f, x)`).
8. **Same errors.** Section 9 of the core design applies; kinds are added (section 15).

Package layout (ours, from our needs):

| Package | New in Space |
|---|---|
| `packages/kernel/src/space/` | `v3.ts` (vectors, quaternions, matrices, `Frame`), `values.ts`, `rules/` (planes, lines, solids, measures, transforms, intersections), `quadric.ts`, `mesh/` (tessellators; pure, worker-safe), `net.ts`, `catalogue.ts` (the space command group) |
| `packages/view/src/space/` | `camera.ts`, `controls.ts` (gestures, drag constraints, gizmo logic), `scene.ts` (draw items), `pick.ts`, `bvh.ts`, `backend-webgl2.ts`, `backend-software.ts`, `labels.ts`, `shaders/` |
| `packages/teacher` | `figure` additions for 3D summaries; no new tool |

---

## 12. Numerical methods: accuracy and speed targets

| Item | Method | Accuracy | Time (mid laptop) |
|---|---|---|---|
| Apply one 3D line (parse → commit) | as core | n/a | < 1 ms |
| Plane from 3 points; line–plane; plane–plane | closed form | 1e-14 relative | < 5 µs each |
| Line–quadric | stable quadratic | 1e-14 | < 10 µs |
| Plane–quadric conic classification | Jacobi on 3×3 | 1e-12 | < 30 µs |
| Convex hull of 1,000 points | quickhull | exact topology via `orient3` | < 5 ms |
| Plane–polyhedron (60 faces) | per-face clip + loop link | 1e-14 | < 50 µs |
| Explicit surface mesh, 64×64 coarse, then refinement | adaptive quadtree | screen error ≤ 1 px at rest | first mesh < 16 ms; refined < 150 ms |
| Implicit surface (sphere-like) | adaptive marching cubes | vertex error < 1e-6 of box (secant) | first mesh < 40 ms; refined < 250 ms |
| Surface ∩ plane contour | adaptive marching squares | 1e-6 of box, 0.5 px at screen | < 60 ms |
| Quadric ∩ quadric | seed + march | residual < 1e-10 | < 20 ms (progressive) |
| Net of a dodecahedron | spanning tree + overlap test | exact | < 3 ms |
| Solid of revolution volume | exact or Gauss–Kronrod | 1e-10 relative | < 1 ms |
| BVH build for 100k triangles | median split | n/a | < 25 ms (worker) |
| Pick (ray) | BVH + analytic | exact | < 0.5 ms with 100 objects |
| Frame, 100k triangles, 5k lines | WebGL2 | n/a | GPU < 8 ms, CPU < 2 ms |

Edge cases the rules must handle (each has a test): a plane through a vertex only; a plane containing an edge; a line along a polyhedron edge; tangent line to a sphere (two equal slots); a cone with zero height; a prism with a zero-area base; surface sample returning NaN at isolated points; a cylinder radius 0; two spheres externally tangent; two identical planes; a polygon whose points are 1e-12 off-plane (accepted) and 1e-3 off-plane (not coplanar); view elevation exactly 90°; zoom approaching 0; a figure centred at 1e7.

---

## 13. What we build first

**Phase 1 (the first deliverable, 4 steps): “a cube I can turn, slice and drag”.**

1. **Maths and types.** `V3`, `Frame`, quaternion, matrices, `Tol` extensions, values `Point3 … Polyhedron`, the lines `(x,y,z)`, `Vector`, `Segment`, `Line`, `Plane`, `Polygon`, `Pyramid`, `Prism`, `Cube`, `Sphere`, `Cylinder`, `Cone`, `Intersect` for line/plane/polygon/polyhedron/sphere, `Distance`, `Angle`, `Volume`, `SurfaceArea`. All pure, unit-tested in Node. No GPU yet.
2. **Software renderer + camera.** The `Camera` and the Canvas 2D backend draw points, lines, polygons, flat-shaded solids. The camera supports orbit, zoom, pan and the three projections. This makes demos and golden-image tests possible before any WebGL code.
3. **WebGL2 backend.** Arena batching, lines as quads, point impostors, opaque lit meshes with MSAA, labels overlay, CPU picking, free-point drag with handles, hidden dashed lines. At the end the same scene looks right in both backends.
4. **Teacher integration.** `draw`/`figure` with 3D objects, the `space` object, `ViewFacing`, the 3D catalogue chunk, three acceptance lessons: a cube and a plane section, a sphere cut by a plane (circle), a pyramid's volume as one third of a prism.

**Phase 2: Intersections and curved solids.** Quadrics (all kinds), plane–quadric conics, line–quadric, circles in space, conics in planes, `Tangent`/`TangentPlane`, `Net`, `Hull3`, `Polyhedron(verts, faces)`, transparent pass (WBOIT plus fallback), hide-depth pass.

**Phase 3: Surfaces and clipping.** Explicit and parametric adaptive meshing in a worker, surface–plane contours, line–surface, surface of revolution and `SolidOfRevolution`, the clip box with caps, mesh iso-lines, BVH picking on meshes.

**Phase 4: Implicit surfaces, surface–surface and quadric–quadric curves, stereo (anaglyph, side by side), plane view, glTF/STL export.**

**Phase 5: WebXR AR, WebGPU backend, Boolean operations on polyhedra.**

Acceptance measures (Phase 1): a 200-line 3D figure applies in under 200 ms total; orbiting a figure of 500 objects holds 60 fps; a pick takes under 0.5 ms; software and WebGL2 images of the acceptance scenes differ by < 3% of pixels (silhouette only, ignoring shading).

---

## 14. Better than GeoGebra

1. **Quaternion camera** with free orientation, roll, trackball orbit; `zUp` is a setting, not a limit.
2. **Camera as a normal object.** Formulas of `t`, sliders and films drive it, and it replays and seeks exactly.
3. **Handles for dragging** instead of a hidden click-to-toggle mode; camera-facing default plane so dragging does what the eye expects.
4. **No cracks, no pole artefacts** in adaptive meshes (2:1 balanced tree with T-junction repair; pole fans).
5. **Order-independent transparency** (WBOIT) with a clean fallback, instead of repeated pass interleaving.
6. **Hidden-line test by depth texture**, so edges behind transparent closed solids are dashed correctly in one extra pass.
7. **Caps for clipping** (stencil caps): cross-sections look solid.
8. **Analytic CPU picking** with exact parameters and no GPU readback; testable headless.
9. **Software renderer** that is the same scene as the GPU one: tests, export, old devices.
10. **Exact solid measures** and a repair-friendly polyhedron builder (non-flat faces, non-manifold input flagged, not silent).
11. **Nets for any convex solid** with overlap-avoiding spanning-tree search, plus a fold slider.
12. **Floating origin** so far-from-origin figures do not jitter.
13. **Plane view with cross-section readouts** for solids.
14. **Specific undefined reasons** (`not_coplanar`, `not_closed`, `skew`, …) and `mixed_dimension` errors with a one-line fix; the teacher can say why.
15. **Exports**: glTF, STL, SVG.
16. **Stable list orders** for `Faces`, `Edges`, `Vertices`, `Intersect` slots, so scripts survive edits.

---

## 15. Changes to the core design

1. **Types.** Add the 3D types in section 5 to `TypeName` and `Value` (core design section 4). Reason: values must be typed to be checked. Also the type classes `shape`, `path`, `region` widen.
2. **Literal.** `(e, e, e)` is a `Point3`. Core design section 3 says `(e, e)` is a pair/Point; add the three-element form to `primary`.
3. **Equation forms.** The `Bool equation` form for `Line` / `Curve` (core section 6) widens to equations in `x, y, z`: three-variable equations that are linear make `Plane`, quadratic make `Quadric`, otherwise an implicit `Surface`. `z` becomes reserved (alongside `x`, `y`, `t`) for equations, and surface parameters `u`, `v` are ordinary names unless used inside `Surface(...)` or `Particles`.
4. **Reserved objects.** Add `space` (type `View3`), `xAxis`, `yAxis`, `zAxis`, `floor`. Reason: camera and axes need to be properties in the graph (core section 9.2 already permits property rules).
5. **Directive.** `@view3 [x0 x1 y0 y1 z0 z1]` and `@limit triangles N`. Reason: the Space view needs bounds and a cost cap.
6. **Property names.** New property family for the view (section 8.1) and for solids/surfaces: `opacity`, `mesh`, `hidden`, `in3`, `clipCaps`.
7. **Undefined reasons.** Add `skew`, `not_coplanar`, `not_closed`, `not_convex`, `self_overlap`, `tangent_degenerate` and an optional `detail: string` on the undefined cell (core kernel design section 4.2). Reason: 3D failures are varied and the teacher needs words.
8. **Error kinds.** Add `mixed_dimension` (2D and 3D inputs mixed) to the kind table. Reason: it is the most common 3D mistake and has a one-line fix.
9. **Slots rule.** `Intersect` slot lists as in points-lines section 3.5 extend to curves in space; intersection curves return `List<Path3>` with `topology_changed` in the change report.
10. **Warnings in `figure`/`draw` results.** Add a `warnings` array (mesh truncated, net overlap, clip box hides the object, camera inside solid) separate from errors. Reason: not failures; the teacher should know.
11. **Change report.** `draw` and `figure` add per 3D object a `view` summary (`visible`, `occluded`, `clipped`, `offscreen`) so the model can reason about what the learner can see.
12. **Worker meshing contract.** Add to kernel design section 15: rules may offer a `mesh` function that runs in a Worker; the main thread consumes `MeshChunk`s. Reason: dense surfaces need it; the kernel value is unaffected.

---

## 16. Sources studied

GeoGebra source (read-only, commit 3608374), under `source/shared/common/src/main/java/org/geogebra/common/`:

- `geogebra3D/kernel3D/` (objects: `geos/`; construction steps: `algos/`; command processors: `commands/`; implicit surfaces: `implicit3D/`; solids: `solid/`; transformations: `transform/`)
- `geogebra3D/euclidian3D/` (view, controller, hit testing, target types), `euclidian3D/draw/` (drawables, surface mesher, curve and quadric drawing), `euclidian3D/openGL/` (renderer, buffer managers, brush and surface plotters), `euclidian3D/animator/` (view animations), `euclidian3D/xr/` (XR hook)
- `geogebra3D/euclidianFor3D/`, `geogebra3D/euclidianForPlane/` (2D views of a plane), `geogebra3D/input3D/` (3D input devices), `geogebra3D/main/` (shaders, companion)
- `main/settings/EuclidianSettings3D.java` (view settings and defaults)
- `kernel/kernelND/` (dimension-neutral interfaces, quadric constants)
- `euclidian/EuclidianConstants.java`, `gui/toolbar/ToolBar.java`, `gui/toolcategorization/impl/` (3D tool set and grouping)
- `kernel/commands/Commands.java` (the 3D command group)

GeoGebra web code, under `source/web/web/src/main/java/org/geogebra/web/geogebra3D/web/`: `euclidian3D/` and `euclidian3DnoWebGL/` (web view, controller, software fallback).

Manual (read): https://geogebra.github.io/docs/manual/en/3D_Graphics_View/ and https://geogebra.github.io/docs/manual/en/tools/3D_Graphics_Tools/ (the commands index page was empty to our fetcher, so the command and tool coverage here is derived from the source's command table and tool lists, in our own words).

Our own documents: `docs/research/engine-study.md`, `docs/design/formula-language-and-kernel.md`, `docs/features/kernel/design.md`, `docs/features/points-lines/design.md`.
