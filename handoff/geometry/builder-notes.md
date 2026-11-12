# Geometry area: builder notes

Branch `feat/geometry`. Code is in `packages/kernel/src/commands/geometry/`,
exported from `packages/kernel/src/index.ts` by one appended line
(`export * as geometry`). No tests were written. `npx eslint .`,
`npx tsc -p tsconfig.json` and `npx vitest run` (3,480 tests) pass.

## What was built

| File | Holds |
|---|---|
| `types.ts` | Area registry appends (`Conic`, `Sector`, `Polyline`, `Transform`; 39 undefined reasons); `V2`, `HLine`, `Path`, `Tol`, conic/arc/polygon/transform/curve value shapes; runtime shape guards; parameter-union constants |
| `numerics.ts` | `det2` (Dekker two-product + compensation, ~1 ulp with bound), `orient`, `tolOf` (from the rule context), stable quadratic/cubic solvers, Brent, `sincos` quarter-turn snap, deterministic `hashRand`, polynomial fit + Durand-Kerner roots |
| `paths.ts` | `Path` for line, ray, segment, circle, ellipse (global polar angle), parabola (cubic project), hyperbola (two branches), arc (range clamp), polyline, polygon, function (sample + Newton), curve (pieces) |
| `conics.ts` | 3x3 matrix helpers, relative classification + frames, native constructors, `toConic`, `conicPath`, five-point conic (Hartley + Jacobi SVD), property readers, dual tests, poles, curvature, AGM circumference, Gauss-Kronrod arc length |
| `intersect.ts` | Line x line (det2 sine, identical test, limits, far), line x conic (stable pair, tangency, degenerate-as-lines, polish), circle x circle (radical line, left/right order), conic x conic (pencil cubic, best-conditioned split, Newton polish, validation, sampled fallback, angle order), line/conic x polygon, function roots (polynomial path + scan + Newton), curve x curve (sample + 2-D Newton), tangents (point/parallel/common) |
| `points.ts` | All points-lines rules: constructors, `PointOn`/`Along`/`PointIn` (+ drag `invert`), `RandomIn`, centres, full `Intersect` dispatch (carriers, ranges, intervals, index/near/extend), measures, `Relation`, all 9 predicates with per-call `tol` |
| `conicrules.ts` | All conics rules: constructors (+ equation with cubic/transcendental probe), properties, tangents, polars, asymptotes, curvature |
| `polygons.ts` | Compensated measures, constructors (incl. regular centre/edge/vector), `Rigid`, accessors, `Area`/`SignedArea`/`Perimeter`/`Circumference`/`Length`/`InteriorAngles`, `IntersectPath`, Greiner-Hormann `Union`/`Difference`/`IntersectPath` with Sutherland-Hodgman convex fast path and deterministic perturbation |
| `transforms.ts` | Centre-based `applyStored`, per-shape mapping (6.5 table), progress maps, provisional list-matrix parsing, `Transform` values, `Then`/`Inverse`/`Move`, drag inverts |
| `locus.ts` | `Locus(Q, s, from, to)` by kernel slice with adaptive sampling; `Locus(Q, P)` fails `no_dependency` (kernel gap) |
| `commands.ts` | 116 command specs, ~230 forms, all params required (variants differ by arity, so no ambiguity) |
| `index.ts` | `registerGeometry(registry)`: specs, type styles, `vertexlabels` + `fillRule` properties, 39 reason phrases, type names for the table check |

### Per design section (points-lines)

Sections 1-2 (coverage, background): built as the command table. 3 (shared
model): built (`V2`, `HLine` as `ax+by=c` per the kernel `LineValue`
convention, `Path`, relative `Tol` from `call.tol`, `det2`/`orient`, slot
rules). 4 (`Intersect`): built, all pairs incl. function intervals and the
`near`/`extend` forms. 5 (special lines, centres): built, incl. all 13 triangle
centres. 6 (points on paths/regions): built, except free-parameter ownership
(kernel gap: `PointOn`/`PointIn` drag through a named free number; `Rigid`
pose through `dx,dy`; `P.param`/`R.anchor`/`R.turn` fields unreadable).
`PointIn` on polygons uses a centroid-ray map (see Doc conflicts). 7
(measures): built. 8 (loci): the sweep form built; the `(Q, P)` form fails
(kernel gap). 9 (command table): built with one form per line-like family
(subtype unions). 10 (robustness): built; value notes dropped (kernel gap:
cells carry no notes). 11 (better list): holds except notes/labels (view).
13 (core changes): 1 params (gap), 2 notes (gap), 3 reasons (built, names
kept), 4 result-by-form (built), 5 1-based (kernel), 6 operators (kernel
already has them), 7 named args (built), 8 types (built via unions, no
`LineLike`/`Angle` checker names needed), 9 `@tol` (kernel reads it; rules see
one number), 10 `no_dependency` at run time (gap: check-time needs a hook).

### Per design section (conics)

1-2: built. 3 (values): built; arcs/sectors over hyperbola/parabola fail
`wrong_kind` (design inconsistency, see below). 4 (constructors): built, incl.
five-point SVD and live equation conics. 5 (properties): built with the
documented slot orders; `Tilt` of a circle is `wrong_kind`. 6 (special lines):
built; function/curve forms of `Tangent`/`Asymptote`/`Curvature` belong to the
calculus area (needs the integrator to merge forms). 7 (curvature): built with
`CurvatureVector = kappa * unit-gradient` (see Doc conflicts). 8-10:
intersections shared; rendering data is the view's job. 11 (robustness):
built. 13 open questions: kept `Along` on the shared path parameter (no
eccentric-angle special case).

### Per design section (polygons-transforms)

1-2: built. 3 (polygons): built; no automatic vertex/side objects. 4
(operations): built with `has_hole` (no polygon-clipping: not installed, v1
has no holes by design). 5 (rigid): built live (snapshot semantics need kernel
support; pose persists via `dx,dy` only). 6 (transforms): built per the 6.5
table, incl. `progress`, exact quarter turns, singular/projective/inversion
cases; `Stretch(shape, vector)` axes through the origin (vectors have no
start); `Translate(v, P)` is identity (same reason). 7 (dependency): kernel
behaviour. 8 (better list): built. 11 (core changes): 1 params (gap), 2
result-type functions realised as `=shape` + split forms, 3 `Polyline` +
`Transform` built (`Matrix` borrowed-pending, `Shape` as explicit unions), 4
`vertexlabels` built, 5 named args built, 6 no-centre forms built, 7 fill rule
as `fillRule` (see Doc conflicts), 8 prime naming (tools' job), 9 notes
dropped (gap). 12 open questions: kept defaults (vertex up, v1.1 `Transform`
values built anyway: cheap, same module).

## Public API (`geometry` namespace on the kernel entry)

```ts
import { CommandRegistry, Figure, geometry } from '@incantly/kernel';
const registry = new CommandRegistry();
geometry.registerGeometry(registry); // specs, styles, with-keys, phrases, type names
const figure = new Figure({ commands: registry });
```

Also exported: `GEOMETRY_COMMANDS` (116 specs for inspection/handover),
`GEOMETRY_TYPES` (`['Conic','Sector','Polyline','Transform']`), the value
types (`V2`, `HLine`, `Path`, `Tol`, `ConicValue`, `ArcValue`, `PolygonValue`,
`PolylineValue`, `StoredTransform`, `GeomCurveValue`, ...), `DEFAULT_TOL`,
`Slot`, `LineSlot`, `LineLike`, and the parameter-union constants.
`registry.problems()` is clean after registration (bare and with
`{ types: [...] }`).

Value shapes follow the kernel where it has them (`{x,y}` points/vectors,
`{a,b}` segments, `{from,dir}` rays, `{a,b,c}` lines as `ax+by=c`, `{cx,cy,r}`
circles, `{pts,...}` polygons) and the docs elsewhere (`ConicValue`,
`{conic,from,sweep}` arcs/sectors, `{pts}` polylines, `{tag:'transform',...}`
transforms, `{tag:'geomCurve',...}` provisional curves).

## Kernel gaps

1. **No per-command check hook.** Doc check-time kinds I cannot emit:
   `no_dependency`, `not_a_path`, `not_a_region`, `not_quadratic`,
   `not_polynomial`, `bad_equation`, `too_few_points`, `not_supported`,
   `not_a_transform`, literal `bad_argument`. Realised instead as: the generic
   matcher's `arg_count`/`no_matching_form`/`type_mismatch` where the form
   shape allows (backed by language rulings Q5-Q7), else run-time reasons with
   the doc names (`no_dependency`, `not_quadratic`, `not_polynomial`,
   `bad_equation`, `too_few_points`, `too_few_sides`, `not_whole`,
   `index_out_of_range`, `limit`, `out_of_domain`). `Reflect(seg, circle)`
   etc. are `no_matching_form`, not `not_supported`.
2. **No owned free parameters** (points-lines 13.1). `PointOn`/`PointIn` drag
   only through a named free number; `Rigid` pose persists only via `dx,dy`;
   `P.param`, `R.anchor`, `R.turn` field reads impossible (`fieldOf` is kernel
   code); `Rigid(A,B,C)` stays live instead of snapshotting.
3. **No value notes.** `tangent`, `ill_conditioned`, `sampled`, `clamped`,
   `overlap`, `truncated`, `near_boundary`, `projected`, `asymptote`,
   `self_intersecting`, `unchecked`, `perturbed`, `flat` are computed nowhere
   storable; cells carry `{defined, value|reason}` only. Values stay correct;
   the teacher speech is lost.
4. **`slice` needs a free source; rules cannot read definitions.** Hence
   `Locus(Q, P)` and single-argument `ParamOf(P)` cannot run: they fail
   (`no_dependency` / `out_of_domain`) with a detail pointing at the working
   forms `Locus(Q, s, from, to)` and `ParamOf(P, path)`.
5. **No name-sequence registry** (ruling K15). New types get the kernel default
   (`obj1`, ...). No hook to register `c`/`s`/etc.
6. **No form-merging across areas.** The calculus/curves areas' `Tangent`,
   `Asymptote`, `Curvature*`, `Intersect`, `Closest`, `Distance`, `PointOn`,
   `Length`, `Area` forms for `Function`/`Curve`/`Region` cannot be appended
   to my specs (duplicate names are dropped). See Needs the integrator.
7. **New check-time error kinds impossible.** `errorTable` is frozen from a
   private map; unknown kinds fall back to `internal`. Only reasons (which
   have `registerReasonPhrase`) were added.
8. **`Line.direction` field disagrees in sign with `Direction(l)`.** The
   kernel field assumes right-normal storage; the doc mandates `(b,-a)`
   oriented P->Q, so lines store the left normal. Fields are kernel code.
9. **Rich value summaries** (`agent.md` value strings) need a kernel or view
   hook; `valueText` prints `...` for the new shapes.

## Doc conflicts

1. `undefined_input` (points-lines errors.md 4) vs kernel `input_undefined`
   (core reason; README decision 2). Kernel wins; never set manually.
2. Conics 3.3 step 5 says the major axis is "the eigenvector of the
   larger-magnitude eigenvalue" and also "`a^2 = -D/(d*l_a)` with `l_a` the
   smaller-magnitude eigenvalue (the longer axis)". Only the second is right
   (`x^2/9+y^2/4=1` majors on 1/9); implemented the second.
3. Conics 4.5/`Length` mention parabola/hyperbola arcs, but `ArcValue` is
   "circle or ellipse" and no form supplies a branch. `Arc`/`Sector` over
   hyperbola/parabola fail `wrong_kind`.
4. Polygons-transforms 6.4 `Stretch(shape, Vector)` needs "the line through
   its start"; kernel vectors have no start. Axis through the origin.
   Same cause: `Translate(v, P)` is identity.
5. Polygons-transforms 11.7 `with fill = evenodd` collides with the kernel
   `fill` pattern enum. Added `fillRule = evenodd | nonzero` instead.
6. Points-lines 6.4 stores polygon `PointIn` as mean-value weights (n values)
   but the form takes 2 numbers. Implemented a centroid-ray `(u, v)` map.
7. `Closest(region, Point)` vs `Closest(path, Point)` overlap on
   circle/conic/polygon (ambiguous in the table). Kept `(Path, Point)` with
   boundary semantics (matches `Distance`) plus `(Sector, Point)` for regions.
8. `TriangleCenter` n=12 "Feuerbach point reflection" names no centre:
   implemented as reflection of X11 across the nine-point centre.
9. `CurvatureVector` "N the unit normal on the concave side
   (equivalently T'/|r'|)" contradicts the signed formula; implemented
   `kappa * unit-gradient`, which makes the osculating centre exact.
10. `Ray` under a projective map crossing the horizon: "Ray or Segment ...
    crosses_horizon" read as fail `crosses_horizon` (as for segments).
11. Points-lines 1.1 points at "the short list in section 5.6"; the list is
    in 5.4. Used 5.4.
12. `Length(Ray)` is specified as undefined: realised as a form failing
    `unbounded`.

## Needs the integrator

- Replace `STUDIO_COMMANDS` in `apps/studio/src/commands.ts` with this
  table (`geometry.registerGeometry` + `new Figure({ commands: registry })`
  in `apps/studio/src/session.ts`). Not my job per the brief.
- Merge the calculus/curves areas' `Function`/`Curve`/`Region` forms into
  `Tangent`, `Asymptote`, `Curvature`, `CurvatureVector`, `OsculatingCircle`,
  `Intersect`, `Closest`, `Distance`, `PointOn`, `Along`, `Length`, `Area`
  (kernel gap 6), and confirm my provisional `GeomCurveValue` shape (or its
  replacement) with the curves area.
- Confirm my provisional list-matrix shapes for `ApplyMatrix`/`Linear` with
  the numbers area when `Matrix` lands (nested 2x2/3x3, flat 4/6/9).
- `polygon-clipping` is not installed: install it when polygons with holes
  (v2 rings) are built. `robust-predicates` was not needed: `det2` inlines
  the same Dekker guarantee with no dependency.
- Bare `registry.problems()` is clean because registration appends the new
  type names (incl. borrowed `Matrix`) to the language's known types; a
  proper per-area hook would be better.

## Speed (Node, warm, Apple silicon laptop)

| Measure | Target | Result |
|---|---|---|
| line x line | 60 ns | 65 ns |
| line x circle/conic | 400 ns | 210 ns |
| conic x conic, well-conditioned | 15 us | 9.4 us |
| classify + frame | 0.2 + 0.3 us | 0.51 us |
| five-point conic | 8 us | 13.5 us (over; Jacobi SVD) |
| tangent from a point | 0.8 us | not measured separately |
| common tangents | 15 us | not measured separately |
| closest point on ellipse | 1 us | not measured separately |
| AGM circumference | 0.3 us | 0.08 us |
| 100-gon area incl. checks | n/a | ~1 ms for the whole line |
| 2,000 point lines | 1,000 < 100 ms | 37.5 ms |
