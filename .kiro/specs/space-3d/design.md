# Space (3D): design

The feature design is `docs/features/space-3d/design.md`. This file says where each part lives and what phase 1
decides differently.

## Kernel: `packages/kernel/src/commands/space/`

- `v3.ts`: vectors, `Frame`, plane frames, tolerances (`tol.flat`), the 3×3 determinant. Pure, no DOM.
- `types.ts`: the type names (appended to `AreaTypeNames` under `// space-3d`) and the value shapes.
- `points.ts`, `planes.ts`, `measures.ts`, `intersect.ts`: the rules of R1.
- `solids.ts`: polyhedra, the regular-solid table, spheres, cylinders, cones, volume and area (R2).
- `camera.ts`: the `Space` command and the `space` rewriter (R3).
- `index.ts`: `registerSpace(registry)`; the SDK's `sdkRegistry` and the studio call it.

### Types and values

| Type | Value |
|---|---|
| `Point3`, `Vector3` | `{ x, y, z }` |
| `Line3`, `Ray3` | `{ o, d }`, `d` a unit vector |
| `Segment3` | `{ a, b }` |
| `Plane` | `{ n, c, f }`: unit normal, `n·x = c`, and a frame `f = { o, u, v }` |
| `Polygon3` | `{ pts, f }` |
| `Circle3` | `{ f, r }`, centre `f.o` |
| `Polyhedron` | `{ verts, faces: [{ idx, normal }], kind, closed }` |
| `Sphere` | `{ c, r }` |
| `Cylinder`, `Cone` | `{ a, b, r }`: base centre, top centre or apex, radius |
| `View3` | the camera properties of `docs/features/space-3d/design.md` 8.1 |

Phase 1 gives the sphere, cylinder and cone their own types instead of one `Quadric` type: the forms of `Volume`,
`Intersect` and `PointOn` pick them by type, and errors name them as a teacher would. Phase 2 adds `Quadric` for
equations, and a parameter alias `Quadric3` that accepts all four.

### Changes to the core (design 15)

Each is a small registry the kernel offers to every area, in the kernel's own files:

1. The checker reads a tuple of three through `registerTupleType` (language `check.ts`); 3D registers
   `(Number, Number, Number) -> Point3`. Two items stay the core `Point`.
2. `registerFreeType(type, { source, fits })` in `graph/values.ts`, so a free `Point3` can be dragged and saved.
3. `Point3` fields `x`, `y`, `z` through the existing `registerFieldTyper`, `registerFieldNames`, `registerFieldReader`.
4. Operators through the existing `registerBinaryOp` and `registerUnaryOp`.
5. `mixed_dimension` (S001) through each command's `refuse` hook; the error kind is registered in the error table.

`z` is not reserved in phase 1: nothing yet reads equations in `x, y, z`, and reserving it would break figures that use
`z` as a name.

### The camera object

`space` is an object `space = Space(azimuth = …, …)` whose named arguments are the properties, so each may be a
formula of `t` or a slider. A line rewriter turns `space with azimuth = 40deg` into a redefinition that keeps the other
arguments, so the line the teacher writes is the design's, and the file holds the `Space(…)` form. `space` is created
the first time it is written to; until then the view uses the defaults. Any other name for `Space(…)`, or another
definition of `space`, is `reserved_name` (S009). `ViewPreset`, `ViewReset`, `ViewFacing` and `ViewAll` are actions that
write the same line.

## The screen: `packages/sdk/src/screen/space/`

- The camera maths is `packages/view/src/core/camera.ts` (quaternion camera, three projections, pointer rays), which is
  pure and already tested.
- `scene.ts`: kernel objects to draw items (points, lines, triangles with face ids, labels), with the defaults of ui 7.
  Pure.
- `paint.ts`: the software painter (design 9.5): triangles sorted by depth, flat shading with the key and fill lights
  of design 8.5, edges drawn after faces, hidden edges dashed by a depth test against the faces in front. It draws on
  any canvas-2D-like context, so `SvgContext` and the PNG export use it unchanged.
- `pick.ts`: ray picking with the priority of design 9.4, and the drag planes of design 10.1.
- `space-pane.ts`: the DOM pane: canvas, gestures, the style bar, the axis compass and the screen-reader list.

The WebGL2 back-end of design 9 is round 5. It is built only if the software painter misses the 16 ms frame for 500
objects; otherwise it moves to phase 2 with transparency (WBOIT) and the hide-depth pass, where it is needed.

## The studio

The `graphing3d` mode becomes available. Its screen shows the list on the left and the Space pane where the 2D graph
is; the File menu, undo and examples work as in the other modes.
