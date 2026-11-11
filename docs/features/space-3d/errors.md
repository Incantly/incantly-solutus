# Space (3D): errors

Companion to `design.md`. Error objects use the unified format in `docs/features/errors/design.md` (fields `ok`, `committed`, `kind`, `code`, `phase`, `message`, `messageKey`, `params`, `line`, `col`, `endCol`, `token`, `expected`, `forms`, `hint`, `suggest`, `recovery`, `related`, `fingerprint`). Area code letter for Space: **S**, followed by three digits.

Three families, as everywhere in the system:

1. **Errors**: the line was refused; nothing changed (`ok: false`).
2. **Undefined values**: the line was accepted; the maths gives no value. The object carries a `reason` (and optional `cause`, plus our new `detail`).
3. **Notices and warnings**: success with a fact the caller should know (a mesh was cut short, the clip box hides an object).

A fourth, outside the language, is **host faults** of the renderer (no WebGL, context lost). They never block a line and never change the figure; they appear as notices on the next `figure` result and as a banner in the UI.

---

## 1. How the reference app handles 3D failures

- **Wrong inputs** to a command give the same generic “illegal argument” or “wrong number of arguments” dialog with the command's syntax lines; there is no hint that the mistake was mixing flat and spatial inputs. Spatial and flat objects are simply different classes, so the command table says “no form” and nothing more.
- **Maths that cannot work** (a plane through three points on a line, a pyramid whose apex lies in the base, a polygon that is not flat, parallel lines that never meet) sets the object to undefined with no reason. The object disappears. Users find out by seeing nothing.
- **Open polyhedra**: a volume of an open surface returns undefined silently.
- **Very dense surfaces**: the mesher stops splitting at its internal limit and leaves visible gaps or cracks, with no message.
- **No WebGL**: the web build falls back to a simpler software view; there is a notice that 3D is limited, shown once.
- **Camera**: no errors. Impossible view settings are clamped quietly.
- **Screen readers**: no per-failure text.

Weak: no reasons, no mixed-dimension message, silent loss of detail, silent clamping.

## 2. What we do better

- One new error kind (`mixed_dimension`) and an exact fix, because mixing `(x, y)` with `(x, y, z)` is the commonest 3D slip.
- Every undefined 3D value has a stable reason code plus a short `detail`, which the teacher can read aloud.
- Resource limits are notices with numbers (“1,024 of 300,000 triangles dropped”) and the object stays drawn (coarser), not blank.
- Renderer faults never throw into the kernel; they are data in `figure`.
- Camera property values are validated like any property (`bad_property_value` with the allowed range), never clamped silently.

---

## 3. Errors (line refused)

Kinds not new to this area use the shared kinds; the table says which. Recovery names are from the errors design section 3.

| Code | Kind | Phase | When | Recovery | Hint / suggest |
|---|---|---|---|---|---|
| S001 | `mixed_dimension` (new) | typecheck | A form needs `Point3`/`Vector3`/… and got a 2D `Point`/`Vector`/…, or the other way round | `use_suggestion` | `suggest` rewrites with `(x, y, 0)`; or `Lift(...)` for shapes |
| S002 | `no_matching_form` | typecheck | Types fit no form (for example `Plane(A, B)` with two points) | `choose_form` | forms listed (max 4 + `formsOmitted`) |
| S003 | `bad_argument` | typecheck | A literal argument is invalid: `Polygon(P, Q, 2, n)` (sides < 3), `Pyramid(base, 0)` height of exactly 0 written as a literal, a literal radius < 0, `Intersect(a, b, 3)` where max slot is 2 | `fix_line` | `expected` lists valid values |
| S004 | `unknown_property` | resolve | `space with azimut = 10deg` | `use_suggestion` | closest property names |
| S005 | `bad_property_value` | typecheck | `space with projection = isometric` (not a projection; it is a preset), `fov = 200deg`, `zoom = 0`, `elevation = 120deg`, `obliqueFactor = 3`, `clipSize = big` | `fix_line` | `expected` has the allowed set or range; for `projection = isometric` suggest `ViewPreset(isometric)` |
| S006 | `bad_property_value` | typecheck | A clip box with `clipMin` not below `clipMax` in every coordinate, when both are literals | `fix_line` | says which coordinate |
| S007 | `type_mismatch` | typecheck | `Point3 * Point3`, `Plane + Plane`, `Vector3 + Point3` (the reverse `Point3 + Vector3` is fine) | `rewrite` | suggests `Translate`, `Midpoint`, `Dot`, `Cross` |
| S008 | `type_change` | commit | Redefining a `Polygon3` as a `Polyhedron` and similar | `choose` | `Delete(name)` first |
| S009 | `reserved_name` | resolve | Defining `space`, `xAxis`, `yAxis`, `zAxis`, `floor` | `rewrite` | pick another name |
| S010 | `bad_directive` | parse | `@view3 5 −5 …` (reversed min and max) or wrong count of numbers | `fix_line` | accepted forms |
| S011 | `cycle` | commit | `Net(p, t)` where `p` depends on the net, and the like | `rewrite` | path given |
| S012 | `limit` | plan | A literal exceeds a budget: `Seq` of 3D points beyond 20,000, `Hull3` with more than 5,000 literal points, `@limit triangles` over 2,000,000 | `rewrite` | the limit and the current count |
| S013 | `not_a_path` | typecheck | `PointOn(sphere, 0.5)` (a surface needs two parameters: `PointOn(s, u, v)` or `PointIn`) | `use_suggestion` | the right form |
| S014 | `not_free` | commit | Dragging or setting a dependent point | `choose` | which parents can move |
| S015 | `tool_input` | tool | `figure` or `draw` with an unknown 3D view id | `fix_line` | list of views |

**Checks at plan time versus run time.** Whether three points are collinear, whether an apex is in the base plane, whether a polygon is flat: these depend on values, not on the text. They are **never errors**; they become undefined values (section 4). A literal-only violation that the checker can see is `bad_argument` (S003), because it can never become defined.

### 3.1 Error examples

**Mixed dimensions: a 2D point passed to a 3D form.**

```json
{
  "ok": false, "committed": false,
  "kind": "mixed_dimension", "code": "S001", "phase": "typecheck",
  "message": "Segment(A, B): A is a flat point (2 numbers) but B is a point in space (3 numbers).",
  "messageKey": "space.mixed_dimension",
  "params": { "command": "Segment", "arg": 1, "got": "Point", "want": "Point3", "other": "Point3" },
  "line": 3, "col": 13, "endCol": 14, "token": "A",
  "expected": ["Point3"],
  "forms": ["Segment(a: Point, b: Point) -> Segment", "Segment(a: Point3, b: Point3) -> Segment3"],
  "hint": "Both points must have the same number of coordinates. Give A a z value: A = (1, 2, 0).",
  "suggest": ["Segment((A.x, A.y, 0), B)"],
  "recovery": "use_suggestion",
  "related": ["A", "B"],
  "fingerprint": "mixed_dimension:Segment:1",
  "severity": "error"
}
```

**No plane from two points.**

```json
{
  "ok": false, "committed": false,
  "kind": "no_matching_form", "code": "S002", "phase": "typecheck",
  "message": "Plane has no form (Point3, Point3).",
  "messageKey": "kernel.no_matching_form",
  "params": { "command": "Plane", "given": ["Point3", "Point3"] },
  "line": 4, "col": 5, "endCol": 17, "token": "Plane(A, B)",
  "expected": [],
  "forms": [
    "Plane(a: Point3, b: Point3, c: Point3) -> Plane",
    "Plane(p: Point3, l: Line3) -> Plane",
    "Plane(p: Point3, normal: Vector3) -> Plane",
    "Plane(poly: Polygon3) -> Plane"
  ],
  "formsOmitted": 2,
  "hint": "A plane needs a third point, a line, or a normal direction.",
  "suggest": ["Plane(A, B, C)", "Plane(A, Vector(B, A))"],
  "recovery": "choose_form",
  "fingerprint": "no_matching_form:Plane:Point3,Point3",
  "severity": "error"
}
```

**A property value outside its range, and a wrong word that is a preset.**

```json
{
  "ok": false, "committed": false,
  "kind": "bad_property_value", "code": "S005", "phase": "typecheck",
  "message": "projection cannot be isometric. Projections are ortho, persp, oblique.",
  "messageKey": "space.bad_projection",
  "params": { "property": "projection", "value": "isometric" },
  "line": 1, "col": 28, "endCol": 37, "token": "isometric",
  "expected": ["ortho", "persp", "oblique"],
  "forms": [],
  "hint": "Isometric is a camera angle in orthographic projection. Use ViewPreset(isometric).",
  "suggest": ["ViewPreset(isometric)"],
  "recovery": "use_suggestion",
  "related": ["space"],
  "fingerprint": "bad_property_value:space.projection",
  "severity": "error"
}
```

```json
{
  "ok": false, "committed": false,
  "kind": "bad_property_value", "code": "S005", "phase": "typecheck",
  "message": "fov must be between 5deg and 120deg; got 200deg.",
  "messageKey": "space.fov_range",
  "params": { "property": "fov", "min": 0.0873, "max": 2.0944, "value": 3.4907 },
  "line": 2, "col": 21, "endCol": 27, "token": "200deg",
  "expected": ["5deg", "120deg"],
  "forms": [],
  "hint": "A wide angle above 120deg bends straight lines too much. Try 60deg.",
  "suggest": ["space with fov = 60deg"],
  "recovery": "use_suggestion",
  "fingerprint": "bad_property_value:space.fov",
  "severity": "error"
}
```

**An index that cannot exist.**

```json
{
  "ok": false, "committed": false,
  "kind": "bad_argument", "code": "S003", "phase": "typecheck",
  "message": "Intersect of a line and a sphere has at most 2 points; index 3 is out of range.",
  "messageKey": "kernel.index_range",
  "params": { "command": "Intersect", "param": "index", "max": 2, "value": 3 },
  "line": 6, "col": 28, "endCol": 29, "token": "3",
  "expected": ["1", "2"],
  "forms": ["Intersect(l: Line3, s: Sphere, k: Number) -> Point3"],
  "hint": "Use 1 or 2, or Intersect(l, s) for the list.",
  "suggest": ["P = Intersect(l, s, 2)"],
  "recovery": "use_suggestion",
  "fingerprint": "bad_argument:Intersect:index",
  "severity": "error"
}
```

**Surface used as a path.**

```json
{
  "ok": false, "committed": false,
  "kind": "not_a_path", "code": "S013", "phase": "typecheck",
  "message": "PointOn(s, 0.5): s is a Sphere (a surface), so a point on it needs two parameters.",
  "messageKey": "space.surface_needs_uv",
  "params": { "command": "PointOn", "arg": "s", "type": "Sphere" },
  "line": 5, "col": 12, "endCol": 13, "token": "s",
  "expected": ["path"],
  "forms": ["PointOn(path, t: Number) -> Point3", "PointOn(surface, u: Number, v: Number) -> Point3"],
  "hint": "Use PointOn(s, 0.2, 0.7), or a circle on the sphere for one parameter.",
  "suggest": ["PointOn(s, 0.2, 0.7)"],
  "recovery": "use_suggestion",
  "fingerprint": "not_a_path:PointOn:Sphere",
  "severity": "error"
}
```

---

## 4. Undefined values (the line is accepted)

The cell form is `{ defined: false, reason, cause?, detail? }`. `detail` is new: a short phrase with the quantities involved, for the teacher to read aloud. Reasons marked **new** extend the kernel's catalogue (see `design.md` section 15).

| Reason | Where | When | `detail` example | Phrase the teacher says |
|---|---|---|---|---|
| `parallel` | Line–plane, plane–plane, line–line | Direction test `|sin| ≤ tol.parallel` | “direction is parallel to the plane” | “the line runs parallel to the plane, so they never meet” |
| `coincident` | same | Same line or plane | “the two planes are the same” | “the two planes are the same plane” |
| `skew` **new** | Line–line | Not parallel, never meet (gap > tol) | “closest distance 1.5” | “the lines are skew: they pass 1.5 apart” |
| `no_intersection` | most intersections | Empty result | “plane is 3.2 from the centre; radius is 2” | “the plane misses the sphere by 1.2” |
| `degenerate` | `Plane(A,B,C)`, `Circle(A,B,C)`, `Pyramid` apex in base, zero radius, zero height, equal points | Input falls to a lower dimension | “A, B and C lie on one line” | “those three points are in a row, so no plane” |
| `not_coplanar` **new** | `Polygon`, `Plane(poly)`, `Circle`, `Conic` from points | Points not on one plane within `tol.flat` | “D is 0.04 off the plane of A, B, C” | “the fourth point is off the plane, so it isn't a flat polygon” |
| `not_closed` **new** | `Volume`, `SurfaceArea` of `Polyhedron(verts, faces)` | Edges not paired | “edge 3–7 has one face” | “the solid has a hole, so no volume” |
| `not_convex` **new** | `Net`, `Hull3` features | Net needs convex | “face 4 is a concave polygon” | “the net is only built for convex solids” |
| `self_overlap` **new** | `SolidOfRevolution` between two graphs | Graphs cross the axis or each other in the interval | “f and g cross at x = 1.3” | “the two graphs cross at 1.3, so the washers overlap” |
| `out_of_domain` | `Surface` params, `Revolve` outside function domain, `Volume` of a function negative inside sqrt | Function undefined across the whole interval | “sqrt of negative for all u in [0, 1]” | “the formula isn't defined there” |
| `no_root` | `PointOn(surface…)`, line–surface search | No sign change found within bounds | “no crossing in the view box” | “I can't find where the line meets the surface in the view” |
| `no_convergence` | surface–surface, quadric–quadric curve | Newton failed after 40 steps | “stalled at residual 3e-6” | “I can't follow the curve here” |
| `timeout` | surface–surface, large implicit | Progressive budget ran out | “stopped after 20 ms” | “the curve is still being computed” |
| `not_finite` | any 3D rule | NaN or ±∞ in an output | “z = ∞ at the centre” | “the value blows up” |
| `too_far` | any 3D rule | Beyond `tol.far` | | |
| `overflow` | big volumes | Result above 1e300 | | |
| `index_out_of_range` | `Faces(p)[7]` | Index past end | “polyhedron has 6 faces” | |
| `empty_list` | `Hull3([])`, `Polygon([])` | | | |
| `tangent_degenerate` **new** | `Tangent` from a point on or inside | No tangents | “point is inside the sphere” | “the point is inside, so no tangent plane through it” |
| `input_undefined` | any | An input is undefined; `cause` points at it | | “because \<cause\> is undefined” |

Rules for rules: each 3D rule declares the reasons it may return; a test iterates them and checks each is reachable (as in the kernel design). Reasons are never generic: a rule that has no better word still returns `degenerate` with a `detail`.

### 4.1 Examples (`figure` entries)

```json
{ "name": "pl", "type": "Plane", "undefined": {
    "reason": "degenerate", "detail": "A, B and C lie on one line" } }
```

```json
{ "name": "I", "type": "Point3", "undefined": {
    "reason": "skew", "detail": "closest distance 1.5" } }
```

```json
{ "name": "V", "type": "Number", "undefined": {
    "reason": "not_closed", "detail": "edge 3–7 has one face" } }
```

```json
{ "name": "v", "type": "Number", "undefined": {
    "reason": "input_undefined", "cause": "s", "root": "no_intersection" } }
```

---

## 5. Notices and warnings (success with a fact)

Located in `changed.warnings` and in `figure.warnings`, never mixed with errors.

| Code | Kind | Meaning | Params |
|---|---|---|---|
| S101 | `mesh_truncated` | A mesh was capped by the triangle budget; the object is drawn coarser | `name`, `triangles`, `limit` |
| S102 | `mesh_refining` | A surface is being refined; the current view is approximate | `name`, `level`, `maxLevel` |
| S103 | `net_overlap` | No overlap-free net found within 24 spanning trees; the best layout is shown | `name`, `faces` |
| S104 | `clipped_out` | The object lies fully outside the clip box and is invisible | `name` |
| S105 | `offscreen` | The object is outside the camera frame | `name` |
| S106 | `occluded` | The object is behind an opaque surface | `name`, `by` |
| S107 | `camera_inside` | The camera is inside a solid (perspective); surfaces are seen from within | `name` |
| S108 | `topology_changed` | An intersection curve changed its number of components during a move | `name`, `from`, `to` |
| S109 | `approximate` | A result is numerical with stated error (surface–surface) | `name`, `error` |
| S110 | `open_solid` | A polyhedron is not closed; volume undefined | `name` |
| S111 | `degenerate_view` | The scene's visible extent is zero (nothing to fit) | |
| S112 | `many_objects` | More than 5,000 objects in space; picking and labels are reduced | `count` |

Notice example inside a `draw` result:

```json
{
  "ok": true, "line": 4, "name": "S", "type": "Surface",
  "summary": "z = sin(x y) over x -5..5, y -5..5",
  "warnings": [{
    "severity": "warning", "code": "S101", "kind": "mesh_truncated",
    "message": "S was drawn with 300,000 of about 410,000 triangles; zoom in or add a clip box for more detail.",
    "params": { "name": "S", "triangles": 300000, "limit": 300000 }, "names": ["S"]
  }]
}
```

---

## 6. Numeric failures and limits

| Situation | Handling |
|---|---|
| Plane normal from nearly collinear points | `|n|` below `tol.parallel · |AB| · |AC|` → `degenerate`; no normalisation of noise |
| Plane–plane nearly parallel | The line's point comes from the two equations by the least ill-conditioned coordinate (pivot on the largest component of `n₁×n₂`); below tolerance → `parallel` |
| Line–sphere grazing | Discriminant within `tol.tangent` of 0 → two equal slots, not none |
| Cancellation in the quadratic | Stable root form (section 7 of design) |
| Newton on surfaces diverges | After 40 steps or residual not falling for 6 steps → `no_convergence` with the last residual |
| Surface values NaN at isolated samples | Skipped samples form holes at the finest level; a boundary refined to `maxDepth`; no error |
| Camera at exactly 90° elevation | Quaternion path; no singularity |
| Zoom to 0 or ∞ | `bad_property_value` for literals; for formulas, the camera clamps to `[1e-6, 1e6]` and a notice `S111`-like `zoom_clamped` is issued |
| Huge coordinates (1e7) | Floating origin; positions in Float32 are chunk-relative |
| Triangles over budget | `S101` |
| Time slice over budget | Progressive meshing continues next frame; `S102` |
| Out of GPU memory | Mesh arenas shrink: the lowest-priority (far, tiny) objects fall back to bounding-box proxies; notice `S113 gpu_memory` |

---

## 7. Host faults (renderer; not in the language)

| Fault | Behaviour | Where the user and the model hear of it |
|---|---|---|
| WebGL2 not available | Software backend; 20k-triangle cap | Banner “3D is in basic mode”; `figure.render = { backend: 'software', reason: 'no_webgl2' }` |
| Float render target missing | Fallback transparency (sorted) | `figure.render.degraded = ['wboit']` |
| Context lost | Pause, restore on `webglcontextrestored`, rebuild buffers from draw items (kept on CPU) | Silent if restored within 1 s, banner otherwise |
| Shader compile fails | Fall back to the software backend for the session and report | Banner; `figure.render` as above; logged with the GPU string |
| Worker meshing unavailable | Meshes on the main thread in 3 ms slices | None (just slower) |
| `OffscreenCanvas` unsupported | Overlay labels on main thread | None |

These use phase `runtime-host`, `ok` stays true for lines, and the figure keeps the same content.

---

## 8. Cross-links

- Undefined reason names `parallel`, `coincident`, `no_intersection`, `out_of_domain`, `no_root`, `not_finite`, `overflow`, `degenerate`, `index_out_of_range`, `empty_list`, `no_convergence`, `timeout`, `input_undefined`, `not_set`, `limit`, `too_far` come from the kernel and points-lines designs and keep their meaning.
- New reasons for the kernel catalogue: `skew`, `not_coplanar`, `not_closed`, `not_convex`, `self_overlap`, `tangent_degenerate`, and the optional `detail` field.
- New error kind for the errors design kind list: `mixed_dimension`.
- Notices S101–S113 join the notice code space with area letter S.
