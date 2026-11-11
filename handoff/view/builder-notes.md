# Builder notes: view

Area `view`, package `packages/view/`. Our own 2D and 3D renderer from scratch:
a DOM-free core (`src/core/`, runs in Node, a worker and on mobile), a WebGL2
back-end plus software/SVG/Canvas2D targets in their own files, one shared GPU
context per page, instanced drawing, and the figure scheduler. WebGPU is an
interface, not a build (see `core/gpu.ts`: `shaderSources('wgsl')` returns an
error that names the later back-end).

## What was built (per design section)

### graphics-view/design.md

- 3 Coordinate systems: done. `core/coords.ts` has branded `Maths`/`Px`,
  `Viewport` (immutable), centre-relative `Mapper`, the 1e-10 relative floor,
  Liang-Barsky clipping, the `Anchor` union and degenerate-view detection.
- 4 Zoom/pan/view: done. `zoomAbout`/`panBy`, axis rescale, `tweenViewport`
  (log-scale + centre, `smooth` ease, pure in t), home/fit, gesture codes
  (`zoom_limit`, `precision_limit`) as feedback, not errors. Kinetic coast:
  left out (touch polish; pan applies immediately, which is correct without
  it).
- 5 Grid and axes: done. `core/grid.ts` (auto spacing 80px in [45,160] with
  hysteresis, 1/2/5 steps, pi steps, minor subdivisions, tick formatting with
  no `-0`, single origin `0`, edge pinning, label thinning, polar/iso).
  Log axes (5.5): left out as the doc says (later; `Mapper` stays linear).
- 6 Drawables: done. `PaintKind`, `Drawable`, `Surface` + `RecordSurface`,
  `GeometryDrawable` (one per object, pure update, null bbox when
  undefined/hidden/show-false), `Float32Array` pixel caches, `PathData`.
- 7 Painting: done. `KernelEvent` flow, value/view dirty flags, pan-shift
  optimisation, update/layout/paint phases, `ResolutionController` (3
  overruns down, 30 good up, max 2 levels), partial repaint split
  (lower/middle/upper with the 0.5 rule, bitmap cached), culling, RDP at
  0.3px, DPR rebuild, device snap. Frame scheduling merges into one
  callback; the player may inject its own (`scheduleFrame`).
- 8 Layers and draw order: done. Layers 0..9, `(layer, rank, order)` sort
  key with binary-search insert, the rank table, per-layer text pass,
  particles at rank 5, overlay always on top.
- 9 Styles: done. `AuthoredStyle`/`ResolvedStyle`, per-frame `{expr}`
  references via `StyleEvaluator`, named/rgb/hsl/hex colours with
  light/dark forms, linear-light `Gradient`, width-scaled dashes with
  `dashPhase`, 12 point shapes, fill/hatch (`renderHatchSpacing` clamps to
  4..40px), separate opacities + `group`, label modes, show-if, per-type
  defaults, `propsForKind`, all ranges from errors.md 6. Label auto
  placement: 8 candidates, overlap + marker scoring, 25% hysteresis, 200
  per frame cap, leader lines past 20px, user offsets from the style.
- 10 Hit testing: done. `HitCandidate`/`HitList`, the slack table (mouse /
  pen / touch), the 64px `HitIndex`, ranking (label 0 … image 5), cycling
  (3px / 800ms + `1 of 3` tooltip), tool filters, exact maths (segment,
  polyline + perpendicular refine, even-odd fills, text rects).
- 11 Selection: done. View-owned state, click/shift/rubber-band/Ctrl+A/Esc,
  the band-inside-fill exclusion, locked vs fixed, group edits left to the
  sdk (one `with` line per object; the view reports the ids).
- 12 Dragging: done. `DragPlan` + cached `computeDragPlan`, pointer
  lifecycle (3px / 8px thresholds, capture, coalesced moves, Esc cancel),
  grab offsets, closed-form projections (segment/ray/line/circle/arc/
  polygon) and coarse + golden-section projection for sampled paths with
  the 24px continuity window / 60px escape and closed-wrap deltas,
  parent moves by delta, commit rounding to displayed digits, keyboard
  nudges, slider quantisation. `kernel.drag`/`commitDrag` cross the
  `DragApplier` handoff; the final commit re-sends rounded moves, then
  commits, so the recorded line is rounded with no new interface.
- 13 Snapping: done. Modes incl. `grid+points`, points → intersections →
  grid order, sticky hysteresis (1.5x), snap along paths, 15° shift limit.
  Intersection candidates come from the host (`intersections` option).
- 14 Export: done. `ExportRequest` validation (`Result`), view/objects/
  custom regions (5% + 12px pad), fresh export viewports, snapshot-at-time
  via the handoff, PNG (OffscreenCanvas, scale 1..3, 16,384 cap), SVG
  (2-decimal paths, `<pattern>` hatch, `<clipPath>`, `<text>` or paths
  with host glyphs, object-name ids with deterministic suffixes, 50,000
  cap), script via `toScript`, overlay/DOM exclusion, particle SVG
  sampling (5,000 + density multiplier), CPU particle path for PNG/SVG,
  deterministic output.
- 15 Accessibility: done. `role="application"`, hidden object list updated
  for changed objects only, `describe()` templates shared with `figure`,
  roving focus (creation order), focus ring, rate-limited live region
  (800ms), `@alt`/object `alt`, free-point ring halo, reduced-motion
  honours, 24px touch targets. Full WCAG validation still needs manual
  testing (as the doc says).
- 16 Better than the reference app: the listed items are the ones built above.
- 17 Changes C1..C11: view-side owned changes are built (extended `with`
  list with formula values tracked by `styleVersion`; `s` per path type;
  drag plans; `Highlight` as an overlay effect; `Show`/`Hide` literal
  rule via `effectiveVisibility`). Directives, `kernel.drag` batching,
  grouped undo, `dryRun` and error kinds are kernel/language work; the
  view consumes them through the handoff.
- 18 Sources: not code. Nothing from the reference app was read or copied while
  building; all names below are our docs' names.

### docs/design/performance.md (renderer parts)

- 2 Own renderer: done. `GpuBackend` (buffers/textures/programs/draw/
  scissor/viewport), WebGL2 default, WebGPU interface-only, software +
  SVG/Canvas2D recorders, DOM-free core, tessellate-once path caches,
  shader dashes, instanced points/particles, one-light meshes with
  back-face culling, 2D-overlay labels (glyph atlas: the host canvas text
  engine; KaTeX textures: host-provided via `ImageSource` keys).
- 3 Work only on what changed: done (view side). No-dirty-no-frame,
  drawable geometry caches, camera-only 2D moves via matrix/shift.
- 4 Many figures: done. `SharedGpuContext` (one offscreen context, visible
  canvas per figure, `present` copies the box), `SchedulerHost` + pure
  `schedulerTick` (placeholder/ready/live/paused/saved, 300px/150ms gate,
  3 live MRU, instant leave on viewport/tab-hide, 8s picture rule for 2D
  and 3D, pinned playing films, settle-gated builds), stats
  (registered/near/live/peak/mounts/saves/mount-to-first).
- 5 Budgets: done. `DEFAULT_BUDGETS` (5,000 / 50,000 / 20,000 / 200,000 /
  4,000 / 300), `limit` refusals for lines, facet/label notices for
  scenes; batching (one call per class + `packPointInstances`/
  `packLineQuads`), frustum + clip culling, LOD (curve sampling,
  `lodSegments`, label hiding), GPU particles (uniforms per frame),
  typed arrays. Workers: sdk-hosted (the core is worker-safe); drag
  deferral of heavy rules is kernel-side (cost hints).
- 6 Measuring: `bench/view.bench.ts` suite; `FigureStats` + scheduler
  stats feed the studio panel.
- 7 Placement: as tabled (`view` owns draw list, GPU interface,
  back-ends, batching, culling, LOD, picking, shared context,
  scheduler).

### space-3d/design.md (renderer parts only)

- 8.1 `space` props: done as `SpaceCameraProps` + `ClipBox` (+ caps flag;
  stencil caps are a documented later step, the flag is plumbed).
- 8.2 Camera maths: done. Quaternion orientation from az/el/roll,
  direct-quaternion user rotation with az/el read-back, per-frame
  near/far fitting, Float64 view/proj/vp, floating origin
  (`chunkOriginFor`/`relativize`).
- 8.3 Projections: done. Ortho/perspective/oblique shear, zoom-as-dolly,
  the 7 presets (`viewPreset`).
- 8.4 ViewFacing: partial. `viewFacingAzEl` (nearest normal, shorter
  turn) is pure and exported; interactive double-click retargets to the
  hit with a 400ms ease. Full `ViewFacing(obj)` needs kernel plane
  normals, so the sdk calls the exported helper with kernel values.
- 8.5 Lighting: done. Camera-fixed key (-0.4,0.6,0.7) + 30% fill + 35%
  ambient, Lambert + Blinn-Phong (24/0.12, opaque only), two-sided back
  at 85%, per-object colour/alpha, `off`/`flat` modes.
- 8.6 Stereo/AR/XR: left out (phase 4/5 in the doc; `planFrame` already
  takes a stereo flag and returns per-eye passes, so the shape is ready).
- 8.7 Clip box: done (shader discard via `uClipMin/uClipMax`, meshing
  culls by box, size presets). Stencil caps: flag only, as above.
- 9.1 GPU interface + second back-end: done (see performance 2).
- 9.2 Scene graph: done. `DrawItem` (points/lines/mesh/label),
  `SceneIndex` on kernel events, `ArenaAllocator` free-list batching,
  per-frame compact rewrite (one call per class), floating origin,
  screen-quad lines, sphere-impostor points, 2D-overlay labels with
  greedy offsets. Restyle-only colour rewrites are incremental work
  later; edits rewrite the affected arenas (bounded, not per frame).
- 9.3 Frame sequence: done except the hide-depth pre-pass and WBOIT.
  Opaque MSAA, hidden-line GREATER pass (dashed/faded), sorted
  transparents (back-to-front by centre, no depth write). WBOIT needs
  texture-binding batches; the fallback the doc allows is what ships.
  Stereo runs the pass list per eye when enabled.
- 9.4 Picking: done. Analytic CPU picking (`pick` + `rayBvh` with a
  median-split BVH), pointer rays per projection, screen-space
  point/path tests, gizmo > label > point > path > surface priority,
  transparent last, opaque occlusion of points. No GPU readback.
- 9.5 Software/export: done. `SoftwareBackend` (painter's algorithm,
  flat shading, 20k cap with simplify flag), PNG/SVG through the same
  items. glTF/STL: left out (export formats owned by sdk with kernel
  mesh data; the view's items carry what they need).

### animation-time/design.md (GPU particle drawing only)

- 10.5 GPU path: done (view side). One instanced draw (`particle`
  program shell; the kernel compiler appends the pure formula bodies),
  `chooseParticleRenderer` (auto → GPU when `gpuOk`, WebGL2 and count >
  1,500), `packUniforms` per frame (64-slot layout owned by the kernel
  source; over-slot systems are kernel-flagged CPU-only).
- 10.6 Load shedding: done. `ParticleQuality` (14ms × 5 down in 25%
  steps to 25%, 60 good frames up), `drawnCount` +
  `qualityLookScale` (`1/sqrt(q)`).
- 10.7 Determinism: CPU float64 path is the kernel's; the view defaults
  export to CPU (`paintParticlesSvg`, PNG note) and documents the GPU
  tolerance (1e-4 / 0.05px).
- 10.8 Drawing/interaction/access: done. No hit test, never culled,
  layer rank 5, `describeParticles`, `Hide` stops work (no geometry),
  reduced-motion stills (no loop runs unless the player frames).

Left out with reasons (all): kinetic coast (touch polish); log axes
(doc says later); WBOIT composite + hide-depth pre-pass (doc-allowed
fallback ships; needs texture-batch extension); stencil clip caps
(phase 3); stereo/AR/XR (phase 4/5); glTF/STL writers (sdk-owned);
two-finger roll + axis-scale drags in 3D (minor gestures; orbit/pan/
zoom/point-drag are in); group-edit line writing (sdk batches the
view's selection); KaTeX texture baking (host provides images by key).

## Public API

Everything is exported from `packages/view/src/index.ts`:

- `contracts.ts`: `KernelEvent`, `ViewObjectHead`, `ViewValue`,
  `ValueOrUndef`, `ParticleSpecPlain`, `ParticleUniformSlot`,
  `ParticleShaderSource`, `ParticleProgram`, `ParticleBatchPlain`,
  `KernelView`, `DragApplier`, `DragMove`, `SnapshotProvider`,
  `SnapshotToken`, `KernelStateHost`, `PathInfo`.
- `errors.ts`: `viewError`, `okResult`, `guard`, `viewNotice`,
  `VIEW_ERROR_CODES`, `VIEW_MESSAGE_TEMPLATES`, `renderViewMessage`.
- `core/coords.ts`: spaces, `Viewport`, `Mapper`, `ViewState`, `Anchor`,
  create/fit/zoom/pan/tween/clip/anchor/fit-all helpers.
- `core/camera.ts`: `V3`/`Quat`/`Mat4` maths, `SpaceCameraProps`,
  `Camera`, presets, orientation/rotation/read-back, near/far, dolly,
  project/unproject-ray, frustum tests, `viewFacingAzEl`, clip tests,
  floating origin.
- `core/grid.ts`, `core/styles.ts`, `core/surface.ts` (+ `RecordSurface`),
  `core/drawables.ts` (`DrawList`, phases, split, `ResolutionController`),
  `core/drawable.ts` (`GeometryDrawable`), `core/geometry.ts`
  (builders, RDP, hit maths), `core/hit.ts` (`HitIndex`, ranking,
  cycling, filters), `core/drag.ts` (plans, projections, rounding,
  nudges), `core/snap.ts`, `core/selection.ts`, `core/labels.ts`.
- `core/scene.ts` (`DrawItem`, `SceneIndex`, `ArenaAllocator`,
  batch/frame planners, LOD), `core/pick3d.ts` (ray primitives, BVH,
  `pick`), `core/particles.ts` (renderer choice, quality, sprites,
  uniforms, export sampling), `core/scheduler.ts` (states, `schedulerTick`,
  stats), `core/export.ts` (validate/region/viewport/SVG helpers),
  `core/describe.ts` (shared reader words), `core/budgets.ts`,
  `core/gpu.ts` (`GpuBackend`, arenas/targets/programs/batches,
  `shaderSources`, colour packing).
- `backends/`: `WebGL2Backend` (+ instancing packers),
  `SoftwareBackend`, `SvgSurface`, `CanvasSurface`.
- `web/`: `SharedGpuContext`, `SchedulerHost`, `Figure3D`,
  `FigureView` (+ `kindForType`, `PersistedView`).

Fallible entry points return `Result<T>` (`V001..V005`, `V999`); pure
maths returns plain values; nothing throws across the boundary
(`guard` wraps the GPU/DOM entries that could).

## Kernel handoff

Defined in `packages/view/src/contracts.ts` (plus two view-side readers
the integrator wires):

- `KernelView`: `heads`/`head`/`valueOf` (→ `ViewValue`, 19 plain
  variants, or `Undefined`), `freeParentsOf` (drag plans),
  `particlesOf` (→ `ParticleProgram`), `pathOf` (→ `PathInfo`).
- `StyleStore` (`core/drawables.ts`): `authoredOf` (kind/free/style per
  object) + `StyleEvaluator` for `{expr}` references each frame.
- `DragApplier`: `drag(moves)` / `commitDrag` / `cancelDrag`; `DragMove`
  covers 2D points, `point3`, path params and numbers.
- `SnapshotProvider.snapshotAt(t)` for export-at-time (view releases).
- `KernelStateHost.saveKernel`/`restoreKernel` (opaque blob the
  scheduler's `saved` state holds; the view only keeps
  `FigureView.persistView()` for its own slice).
- `ParticleUniformReader` (`core/particles.ts`): one slot value per
  frame from kernel values. `MeshProvider` (`web/figure-3d.ts`): mesher
  chunks by key. `FigureViewOptions.valueText`: kernel number
  formatting for labels/readers; `intersections`: snap candidates;
  `onDelete`/`onRestyle`/`toScript`: line-writing callbacks.
- The kernel appends the view's error kinds (`bad_layer`, `bad_export`,
  `conflicting_style`, `property_not_for_type`) and 3D type names to
  its registries; until then the view reports the closest core kinds
  (`bad_property_value`, `bad_argument`, `limit`) with stable `view.*`
  message keys.

## Doc conflicts

1. Picking: performance 2.5 says "an id buffer drawn on demand … gives
   the object under the pointer", graphics-view 10.3 says "A uniform
   grid of 64 px cells … then calls `hit` on those few drawables", and
   space-3d 9.4 says "analytic ray casting on the CPU, not a colour
   readback". Reading: grid index for 2D, analytic rays for 3D (the two
   area designs); no id buffer. Rationale: closest to the area
   `design.md`s, and the 3D doc explicitly rejects readback.
2. Triangle budget: performance 5 says 200,000; space-3d 6.3 says
   "300,000 triangles per figure". Reading: 200,000 default
   (`DEFAULT_BUDGETS`), configurable. Rationale: the brief names
   performance.md for budgets.
3. Object budget: performance 5 says 5,000; graphics-view errors.md 6
   says "Visible drawables 10,000". Reading: 5,000 objects (line
   budget), drawables follow. Rationale: performance.md governs.
4. Label budget: performance 5 says 300 shown; errors.md 6 says "500
   auto-placed". Reading: 300 shown (hide the rest + notice); the
   layout cap stays 200/frame (design 9.7). Rationale: performance.md
   governs the shown count.
5. Hatch spacing: design 9.5 says "spacing 4 to 40"; errors.md 6 says
   "Hatch spacing 2 .. 80 px". Reading: accept 2..80, render clamped to
   4..40 (`renderHatchSpacing`). Rationale: both hold (author vs
   render range).
6. `labelOpacity`/`group` appear in 9.6 but not in the 9.1 record:
   both accepted (9.6 defines their meaning).

## Needs install

Nothing. No third-party dependency was added (`package.json`
unchanged). KaTeX (allowed for `view` by libraries.md) is consumed
behind the `ImageSource`-by-key interface: the host bakes maths to
textures and the core only holds keys, so no install is needed for
this package. Manifold (boolean solids) belongs to kernel meshing,
not the view.

## Speed numbers

MEASURED by the fixer (2026-11-11, macOS arm64, Node v26.0.0) with
`bench/view.bench.ts`, a plain `performance.now()` script (10 warmup
iterations, then a timed loop printing mean ms/op). Executed in place
with the repo's own runner, which prints the script's output:

`npx vitest bench --run packages/view/bench/view.bench.ts`

(Plain `node` cannot run the script directly: this repo's imports are
extensionless, which only a bundler-style resolver such as tsx or
vitest resolves. `npx tsx` was not installed here, so vitest ran it.)

- Hit query at 5,000 objects: 0.0014 ms/op over 2,000 iterations
  (target 0.2ms). O(1) cells + a few `hit` calls.
- Grid spacing choice: 0.0001 ms/op over 20,000 iterations. O(1)
  arithmetic on the hysteresis-hit path (`chooseStep(80, unit, 1, null)`).
- Label placement, 200 labels: ~0.6 ms/op over 50 iterations
  (0.61 / 0.65 on two back-to-back runs; target under 2ms). O(n²)
  worst-case overlap checks (~20k rect tests).
- RDP simplify, 1,000 points: ~0.18 ms/op over 200 iterations
  (0.176 / 0.175 on two back-to-back runs; expectation < 0.5ms).
- Scheduler tick, 50 figures: 0.0045 ms/op over 2,000 iterations
  (steady state after the first ticks build the near figures).
- Frame composition (update+layout+paint < 6ms at 500 objects via
  partial repaint; kernel pass separate) is NOT measured: it needs
  live DOM figures and is not covered by this script.

## Environment failure (verification + commits blocked)

Every shell invocation in this session failed before starting:
`muse.bash` returned `environment failure: sandbox enforcement
unavailable … status=exit status: 71`. Per the tool instruction I did
not retry or fabricate output. Consequences:

- `npx eslint .`, `npx tsc -p tsconfig.json` and `npx vitest run`
  (brief step 1) could NOT be run. The code was self-reviewed twice
  against strict TS (exact optionals, unchecked indices, exhaustive
  switches, `import type`) and the repo ESLint rules (no `console`,
  no eval, DOM-free core, `eqeqeq`), but that is not a substitute for
  the gates. The integrator MUST run `npm run lint`, `npm run
  typecheck` and `npm test` before merging.
- `git add`/`git commit` (brief "Saving work") could NOT be run: no
  commits exist. All work is in the working tree under
  `packages/view/` and `handoff/view/` only (no other paths touched).
  Suggested commits for the integrator:
  `feat(view): kernel handoff contracts and error helper`,
  `feat(view): 2D core (coords, grid, styles, drawables, hit, drag,
  snap, selection, labels)`, `feat(view): 3D core (camera, scene,
  picking)`, `feat(view): particles, scheduler, export, describe,
  budgets, GPU interface`, `feat(view): WebGL2, software, SVG,
  Canvas2D back-ends`, `feat(view): shared context, scheduler host,
  3D painter, figure view`, `feat(view): public API, benchmarks,
  builder notes`.
- No push was attempted (nothing to push without commits); `main`
  untouched.

## Gate fixes

Fixer session, 2026-11-11. The shell works in this session, so the
blockers in the previous section are cleared: `npx tsc -p
tsconfig.json`, `npx eslint .` and `npx vitest run` all pass from the
repo root (27 type errors and 7 lint errors in `packages/view/`,
fixed with no disable comments and no `any`), and the work below is
committed on `feat/view`. Nothing was pushed; `main` untouched. No
tests were written (testers own them); the full existing suite passes
(17 files, 2,118 tests).

What was fixed and why:

- `core/drawable.ts`: the `describe*` helpers and `VIEW_REASON_TEXT`
  live in `core/describe.ts`, not `core/styles.ts` (17 import
  errors); the import source was wrong, so it now points at
  `./describe`. The `describeFunction` import was dropped: no
  `ViewValue` variant is a bare function (functions arrive as
  `curve`), so nothing calls it. The unused `fillOf` result in
  `paintMarker` was removed, and the text background now defaults
  with `?? 'none'` because `TextStyleSpec.background` is optional
  while `TextStyle.background` is required.
- `core/styles.ts` (`dashToArray`): `Array.isArray` does not narrow
  `readonly number[]`, so the `{ on, off }` access never typechecked;
  the code now discriminates with `'on' in pattern`. The `let h = 0`
  in `rgbToHsl` assigned a value every branch overwrites, so the
  initializer was removed.
- `core/surface.ts`: dropped the unused `Px` import.
- `backends/canvas2d.ts`: the hatch fallback compared `spec.kind`
  (already narrowed to `lines | honeycomb | weave | bricks` by the
  earlier branches) against `'cross'`; only `lines` carries an angle
  there, so the check is now `spec.kind === 'lines'`.
- `backends/webgl2.ts`: `WebGLObject` does not exist in the TS DOM
  types; the owned-handle list and `track` now use a `GlOwned` union
  of the six real handle types.
- `web/scheduler-host.ts`: the `nearObserver` could be null at
  `observe` time because only `viewObserver` was null-checked; both
  observers are now (re)created when either is missing.
- `web/figure-view.ts` (`painted`, `drawCalls`) and
  `web/shared-context.ts` (`ctx2d`): initializers that every path
  overwrote were removed in favour of declared-then-assigned.
- `bench/view.bench.ts`: rewritten as a plain `performance.now()`
  script that prints timings (Vitest 5 has no `bench` export). No
  bench runner was added. Fixtures are now fully typed (`LabelInput[]`,
  `px()` constructors) instead of `as never` casts. See Speed numbers
  for the measured results and how they were taken.

Needs the integrator: nothing. The branch is ready for the gates.
