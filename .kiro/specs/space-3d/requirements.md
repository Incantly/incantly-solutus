# Space (3D): requirements

Area: `docs/features/space-3d/` (`design.md`, `errors.md`, `ui.md`, `agent.md`). Kernel code in
`packages/kernel/src/commands/space/`, the screen in `packages/sdk/src/screen/space/`, the app in `apps/studio`.
Branch: `feat/space-3d-*`.

Scope: phase 1 of design section 13, "a cube I can turn, slice and drag". Phases 2 to 5 (quadrics by equation,
surfaces, clip box, stereo, AR, WebGPU) are later specs.

### R1. Points, vectors, lines and planes (design 2.3, 5, 7, 11; errors 3, 4)

1. `(x, y, z)` with three Numbers SHALL make a `Point3`; `(x, y)` stays a 2D `Point`. A Point3 written as a literal is
   free, and it has the fields `x`, `y`, `z`.
2. The operators SHALL be `Point3 + Vector3`, `Point3 - Vector3`, `Point3 - Point3 -> Vector3`, `Vector3 ± Vector3`,
   `Number * Vector3`, `Vector3 * Number`, `Vector3 / Number`, `-Vector3`. Other mixes are `type_mismatch` (S007).
3. Commands SHALL have 3D forms: `Vector(x, y, z)`, `Vector(P, Q)`, `Segment`, `Line(P, Q)`, `Line(P, v)`, `Ray`,
   `Midpoint`, `Plane(P, Q, R)`, `Plane(P, normal)`, `Plane(P, L)`, `Polygon(P, Q, R, …)` (flat), `Dot`, `Cross`,
   `Normal`, `Direction`, `UnitVector`, `Distance`, `Angle`, `Length`, `Area`, `Intersect` (line–line, line–plane,
   plane–plane, line–polygon, segment and ray filters).
4. A 2D argument where a form wants a 3D one, or the other way round, SHALL be `mixed_dimension` (S001) with a hint and
   a `suggest` that adds `, 0`.
5. Value failures SHALL be undefined values, never errors: `parallel`, `coincident`, `skew` (with the gap),
   `degenerate` (three points in a row), `not_coplanar` (with the distance off the plane).

### R2. Solids and their measures (design 6.1, 6.2, 7; errors 4)

1. `Pyramid(base, apex)`, `Pyramid(base, height)`, `Prism(base, top)`, `Prism(base, height)`, `Cube(P, Q, side: R)`,
   `Tetrahedron(P, Q, side: R)`, `Octahedron`, `Sphere(center, radius)`, `Sphere(center, through)`,
   `Cylinder(P, Q, radius)`, `Cone(P, apex, radius)` SHALL make solids with outward faces in a fixed order.
2. `Volume`, `SurfaceArea`, `Height`, `Vertices`, `Edges`, `Faces` SHALL read them; values exact to double rounding.
3. `Intersect` SHALL also cover plane–polyhedron (the cross-section `Polygon3`), plane–sphere (`Circle3`, radius 0 when
   it touches), line–sphere (two slots, tangent gives two equal points), line–polyhedron (sorted along the line).
4. A pyramid apex in the base plane, a zero radius or height SHALL be `degenerate`.

### R3. The camera object and the Space view (design 8, 9.5; ui 2, 6, 7)

1. `space` SHALL be the figure's camera: `space with azimuth = 40deg` (and `elevation`, `roll`, `zoom`, `target`,
   `projection`, `fov`, `axes`, `floor`, `grid`, `light`, `background`) is a line, so undo, files and films keep it.
   Bad values are `bad_property_value` (S005); `projection = isometric` suggests `ViewPreset(isometric)`.
2. `ViewPreset(name)`, `ViewReset()`, `ViewFacing(obj)`, `ViewAll()` SHALL write the camera lines.
3. The Space view SHALL draw points, lines, planes (a patch the size of the view), polygons, solids (flat shading,
   pastel at 40% opacity, dashed hidden edges), spheres, cylinders and cones, circles in space, labels, the axes and the
   floor grid, in orthographic, perspective and oblique projection, with the colours of ui 7.
4. PNG and SVG export SHALL draw the same picture as the screen.

### R4. Using the Space view (ui 4 to 6, 12)

1. Drag the background to orbit, Shift-drag to pan, wheel to zoom about the pointer; double-click empty space resets.
2. A free point SHALL drag on the axis plane that faces the camera most, with a guide down to the floor; Shift drags in
   z only. Arrow keys and PageUp/PageDown move a selected free point.
3. A dependent point SHALL move its free parents through the kernel's drag plan; an intersection says it cannot move.
4. Picking SHALL prefer points, then lines, then surfaces; a see-through plane does not steal a click.
5. The 3D app (`graphing3d`) SHALL be available: the list on the left, the Space view on the right, a style bar (home,
   axes and floor, projection, presets), three examples (a sliced cube, a sphere cut by a plane, a pyramid's volume).
6. The view SHALL have a text list of what it shows for screen readers.

### R5. Speed (design 12, 13)

1. A 200-line 3D figure SHALL apply in under 200 ms; one 3D line in under 1 ms.
2. A frame of 500 objects SHALL paint in under 16 ms; a pick SHALL take under 0.5 ms.
