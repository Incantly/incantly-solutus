# Plot area: builder notes

Branch `feat/plot` (uncommitted: the shell is unavailable in this session, so
nothing could be committed; see "Verification" below). Everything is in
`packages/plot/` plus this folder. No tests were written (the tester writes
them). One bench file: `packages/plot/bench/plot.bench.ts`.

## What was built (per design section)

Source of truth: `docs/features/functions-calculus/design.md` section 9 (the
hybrid function plotter), `docs/features/curves-loci/design.md` sections 5-7
(parametric tracer, implicit tracer, inequality filler), and
`docs/design/performance.md` (budgets, level of detail, workers).

| Design section | Status | Notes |
|---|---|---|
| FC 9, pieces (domain spans + breaks) | Done | `plotFunction` splits the visible range by `domain` spans and `breaks`, samples exact ends, draws open/closed circles, joins across continuous breaks and holes, marks jumps. |
| FC 9, coarse samples | Done | `max(64, widthPx/4)` per design, using the compiled `batch` form when it fits the budget. Counted in device pixels (see "Doc conflicts"). |
| FC 9, screen-space refinement | Done | Midpoint-to-chord 0.25 px, chord 8 px, depth 14, single-evaluation sample cache. A span narrower than half a pixel is one column and is classified, never split (bounds `sin(1/x)`-style work; the design's depth-14 rule alone would spend 2^14 evaluations per bad span). |
| FC 9, suspicious pairs + interval verdicts | Done | Non-finite ends, huge chords and depth-limit spans are classified in a second phase: pole / jump / hole / gap / steep / ink column. With `ScalarEnclosure` the verdicts follow the design's `def` rules; without it, bounded bisection heuristics decide and `rigorous` is false. |
| FC 9, sub-pixel oscillation | Done | `inkColumns` (pixel hairlines), oscillation told apart from sharp corners by a quarter-point sign-change test. |
| FC 9, emit paths | Done | Pixel polylines, y clipped to `[-4h, 5h]`, chained by exact x match, sorted output. |
| FC 9, budgets | Done | `maxSamples` (default 4000, performance.md) stops refinement; `maxEvals` (default 20000) suspends the run. See "Suspend/resume" below. |
| FC 9, `stats.complete` + frame budget | Done | No clock exists in this package (forbidden), so the frame budget counts evaluations. `complete: false` carries a `FunctionResume` token; `resumeFunctionPlot` continues. Finished paths are identical however the work was sliced (order-free refinement + sorted emission). |
| FC 9, cache and incremental update | Done | `createSampleCache`: versioned sample sets, `seedForRange` for pans (reused without re-evaluation), `clear` on version change. Zoom preview stays caller-side (the view keeps showing the old result). |
| FC 9, output stability | Done | Pure functions of (inputs, view, pixel size); no wall clock, no randomness; sorted deterministic output. |
| FC 9, `exact = true` band | Done | With an enclosure, one enclosure column per device-pixel column is emitted as `inkColumns` instead of paths. Without an enclosure it falls back to the normal curve with `rigorous: false`. |
| CL 5, parametric tracer | Done | `traceParamCurve`: enclosure culling of parameter boxes (kept boxes get proportional coarse samples, `max(64, widthPx/6)` total), chord/bend/12-degree refinement to depth 14, cusp markers past 120 degrees, `singular` where the curve stalls, `end` markers, gap/pole/hole-like verdicts, closed flags. No suspend/resume: exhaustion returns `complete: false` with empty output (re-run with a larger budget; heavy traces run in a worker per performance.md 5.5). |
| CL 5, closed curves | Done | Per-path `closed` flags; ends meeting within 1e-9 of the scale. |
| CL 6, implicit tracer | Done | `traceImplicit`: padded view, 32 px coarse cells, quadtree to 2 px leaves (draft 6 px) by leaf-index ranges, corner hash, marching squares with 1-2 damped Newton steps along the numeric gradient, saddle centre decider, small-feature probes with `isolated` markers, `singular` markers at vanishing gradients, linking by edge keys, chains sorted by first key. |
| CL 6, small features | Partial | Features below leaf resolution collapse to an `isolated` point marker (found by subgrid probe + Newton); no sub-leaf segments are emitted. The design's 0.5 px split is about certainty, which the marker preserves; mixed-resolution linking keys were judged not worth the complexity. |
| CL 6, saddle leaves | Partial | Resolved by the centre sign (the standard decider) with Newton-corrected crossings; the extra 1 px sub-split is not implemented. Same reason as above. |
| CL 6, singular points | Partial | No 0.5 px sub-split; crossings with a vanishing gradient keep their (sharp) joins and gain a `singular` marker. |
| CL 7, inequality filler | Done | `fillRegion`: quadtree (`true` fills, `false` skips, `maybe` splits to 2/6 px leaves), maximal-rectangle merge by rows, single-primitive boundary polygons with Newton-corrected crossings, 4x4 supersampling at multi-primitive corners, per-primitive borders traced and kept where the inside sample satisfies the body, `strict` flags, `isolated` markers for near-point islands. |
| CL 7, 1D predicates | Done | `fillPredicate1D`: bands spanning the view height plus axis intervals; transition edges bisected to 0.1 px against the abutting false spans of the tiling. |
| CL 7, `Boundary`/`Area`/`PointIn` | Left out | Kernel commands (no view involved); they need the rule graph, not the plotter. |
| Locus / envelope / `Path` sampling (CL 9, 11) | Left out | Needs `kernel.slice` (rule-graph slices on scratch values), which does not exist yet. Sampled curves arrive as polyline data, which needs no plotter pass. |
| `Length`/`Closest`/`Intersect`/`SlopeField` | Left out | Kernel-side queries, not sampling. |

## Public API

```ts
// y = f(x) — functions-calculus 9
plotFunction(fn: FunctionValue, view: ViewBox, options?: FunctionPlotOptions): Result<FunctionPlot>
resumeFunctionPlot(token: FunctionResume, fn: FunctionValue, options?: ResumeFunctionOptions): Result<FunctionPlot>
// parametric — curves-loci 5
traceParamCurve(curve: ParamCurveInput, view: ViewBox, options?: ParamPlotOptions): Result<ParamPlot>
// implicit — curves-loci 6
traceImplicit(field: ImplicitFieldInput, view: ViewBox, options?: ImplicitPlotOptions): Result<ImplicitPlot>
fieldFromRelation(relation: RelationValue, level?: number): Result<ImplicitFieldInput>
// regions — curves-loci 7
fillRegion(predicate: PredicateInput, view: ViewBox, options?: RegionPlotOptions): Result<RegionPlot>
fillPredicate1D(predicate: Predicate1DInput, view: ViewBox, options?: Predicate1DOptions): Result<Predicate1DPlot>
predicateFromRelation(relation: RelationValue): Result<PredicateInput>
// cache, views, thresholds (all in src/index.ts)
createSampleCache(capacity?: number): SampleCache
cacheKey(version: number, x0: number, x1: number, widthPx: number): string
createView(view: ViewBox): Result<PlotView>
```

Fallible entry points return `Result<T>` (shared `ErrorObject`, kinds
`bad_argument`/`limit`/`internal` only) and never throw; a throwing callback
becomes `internal`. Infallible pure helpers (`cacheKey`, the view mapping
functions) return plain values, following the language package's precedent.
`notices` is always `[]`: budgets and certainty travel in `PlotStats`
(`complete`, `capped`, `rigorous`, `evals`, `intervalEvals`, `maxDepth`,
`samples`), as the designs specify.

Conventions shared by every tracer: outputs are pixel polylines
(`Float64Array`, CSS pixels) plus markers with maths AND pixel coordinates;
`complete: false` always means empty output (the caller keeps the previous
frame); `maxEvals` bounds one call (a resume gets a fresh budget, stats carry
totals); `rigorous: false` means a verdict needed an enclosure that was not
supplied; inputs are validated (`bad_argument`) and over-cap budgets refused
(`limit`).

## Kernel handoff

Shapes the kernel's calculus layer will supply later, all declared in
`packages/plot/src/contracts.ts` (small, plain, callback-based so the kernel
never leaks expression trees into the plotter):

- `DomainSpan[]` (`FunctionPlotOptions.domain`): restricted/conditional domains.
- `breaks: number[]` (`FunctionPlotOptions.breaks`): formula change points.
- `ScalarEnclosure` (1D intervals + `Definedness`), `ParamEnclosure`
  (parameter-box culling), `FieldEnclosure` (implicit/border margins),
  `PredicateEnclosure` + `ScalarTriState` (three-valued bodies).
- `BoundaryInput[]` (`PredicateInput.boundaries`): per-primitive margins with
  `strict`/`equality` flags. `predicateFromRelation` derives only the FIRST
  comparison of a language relation (`residual` + `ops[0]`); chained bodies
  (`1 < x^2+y^2 < 4`) fill correctly via `test` but miss the later borders
  until the kernel supplies per-primitive margins.
- `version` stamps for cache keys (owned by the kernel; the cache just stores them).

The plotter works fully without every handoff item (sampling heuristics +
`rigorous: false`); with them, verdicts and culling are certain.

## Doc conflicts

1. Sample budget. `docs/design/performance.md` section 5 says
   "| Curve samples | 4,000 per curve on screen | Adaptive sampler stops refining |",
   while `docs/features/functions-calculus/design.md` section 9 says
   "About 1,200 function evaluations for a smooth curve at 1,000 px; at most
   20,000 for a hard one". Read as different units, both honoured:
   `maxSamples` (output samples, default 4000) stops refinement, `maxEvals`
   (function evaluations, default 20000) suspends the run.
2. Pixel output vs retained geometry. `docs/design/performance.md` section 3.4
   says "Moving the camera or zooming does not re-tessellate 2D paths; it
   changes one matrix", while functions-calculus 9 outputs "polylines in
   view-pixel coordinates". The core design section 8 settles it: "Results are
   cached per view range and redone on zoom or a change in the function."
   Plot output is per-view data (pixels), redone on zoom; the matrix rule
   applies to retained drawables. Followed the core + area reading.
3. Underspecification, not a conflict: functions-calculus 9 lists
   `devicePixelRatio` as a plotter input but never says how it is used.
   Sampling density and all pixel thresholds use device pixels; emitted paths
   stay in CSS pixels.

## Needs install

- `npm install` (or equivalent) to link the new `@incantly/plot` workspace
  package into `node_modules` for testers; no third-party dependency was added
  (plot has zero runtime dependencies, only type imports from
  `@incantly/kernel`).

## Speed numbers

Measured by the fixer; the builder's session had no shell, so the paragraph
below replaces its estimates. By construction: smooth-function plots spend
~1 coarse evaluation per 4 px plus refinement only where the screen test
fails; implicit/region cost follows boundary length (interval culling)
rather than area; the sample cap bounds output size.

Method: `packages/plot/bench/plot.bench.ts` is a plain `performance.now()`
script (see "Gate fixes"): 2 warmup runs, then repeated runs until at least
25 ms total (min 5, max 500 runs), reporting the mean ms per run; one extra
run supplies the eval counts. Executed 3 times via `npm run bench`
(`vitest bench --run` collects the file and runs its top-level code) on
Node v26.0.0, darwin arm64. Evaluation counts were identical across all runs
(deterministic output, as designed); timings reproduced within ~10% except
the spiral case, which sits on its target. All cases ran WITHOUT kernel
enclosures (sampling heuristics, `rigorous: false` where verdicts were
needed); the doc targets assume interval culling, so part of the
implicit/region gap should close when the handoff items land.

| Case | Mean ms (3 runs) | Doc target | Evals | Meets target |
|---|---|---|---|---|
| function: smooth sin(x)+x^2/10 | 0.19 | 0.3 | 499 | yes |
| function: tan(x) over 12 poles | 2.4 | 1.5 | 5704 | no (capped) |
| function: sin(1/x) | 12.1 | 5 | 5247 | no |
| function: floor(x) | 0.21 | 0.5 | 590 | yes |
| param: heart | 0.42 | 0.3 | 993 | no (close) |
| param: Lissajous 6 loops | 0.51 | 0.8 | 1425 | yes |
| param: spiral s in 0..1000 | 1.45 | 1.5 | 4000 | borderline (1.38/1.42/1.55) |
| implicit: unit circle | 7.8 | 2 | 32965 | no |
| implicit: lemniscate | 6.0 | 3 | 31417 | no |
| implicit: sin(x)+sin(y)==sin(x*y) | 21.3 | 15 | 105332 | no (capped) |
| implicit: unit circle (draft) | 10.9 | 0.5 (4x cheaper) | 41778 | no, and slower than final |
| region: half-plane | 10.7 | 0.3 | 111689 | no (capped) |
| region: disc and half-plane | 18.6 | 1.5 | 166484 | no |
| region: sin(x)*y>1 band | 14.6 | 8 | 148519 | no (capped) |

Observations for the integrator (not fixed: performance work is outside the
fixer brief): draft quality is SLOWER than final on the same input (10.9 vs
7.8 ms with more evaluations), which contradicts the "draft 4x cheaper"
target and looks like a real bug rather than a missing enclosure; the region
filler's biggest miss is the half-plane (10.7 ms vs 0.3 ms at 111k evals,
also capped), suggesting the no-enclosure path splits far more than the
design's quadtree intends.

## Verification

- `npx eslint .`, `npx tsc -p tsconfig.json`, `npx vitest run`: NOT RUN.
  The first `muse.bash` call failed with an environment failure ("sandbox
  enforcement unavailable: ... Operation not permitted ... every later command
  will fail the same way. Do not retry"), so no shell command could run in
  this session: no lint, no typecheck, no tests, no commits.
- Mitigation: every file was re-read after writing and hand-checked against
  the strictness settings (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`,
  `noFallthroughCasesInSwitch`, `noImplicitReturns`), the repo ESLint rules
  (`eqeqeq`, `no-console`, `no-eval`/`no-new-func`, DOM-free globals for
  `packages/plot`), and the `Result<T>` boundary rule. One strict-mode fix
  (explicit `undefined` into an optional prop) and one device-pixel slip were
  found and fixed during that pass.
- No test files were touched or added (builders write no tests); the 2,118
  existing tests are unaffected by these additive files, but that is
  unverified here.
- Nothing was committed (no shell). All work is in `packages/plot/` and
  `handoff/plot/` only; `packages/kernel/`, `docs/` and other packages are
  untouched.

## Gate fixes

The fixer session had a shell. Two type errors, no lint errors, no test
failures; no source behaviour was changed except through the missing import.

1. `packages/plot/src/region.ts`: added `ImplicitFieldInput` to the type
   imports from `./contracts`. Real cause: `traceBorder` annotates its local
   `field` with that type (it calls `traceImplicit`, whose first parameter
   has exactly that type) but the import list never included it. One line;
   no `any`, no disable comments.
2. `packages/plot/bench/plot.bench.ts`: rewrote from `bench` from `vitest`
   (which Vitest 5.0.5 does not export: `TS2724`) to a plain script that
   times each case with `performance.now()` and prints a one-line result
   with eval counts and a PASS/FAIL verdict against the doc target. No bench
   runner was added. The rewrite keeps the 11 old cases and adds the 3 doc
   targets the old file missed: the `s in 0..1000` spiral (curves-loci 5),
   draft-quality circle (curves-loci 6, "4x cheaper") and the
   `sin(x)*y > 1` band (curves-loci 7). Run with
   `npx tsx packages/plot/bench/plot.bench.ts`; `npm run bench` also
   executes it (verified: exit 0, timings print).
3. Measured every speed number (see "Speed numbers" above, which replaces
   the builder's estimates) and committed in two parts: the code fixes,
   then these notes.

Gates from the repo root, all green: `npx tsc -p tsconfig.json` clean,
`npx eslint .` clean, `npx vitest run` 2,118 passed / 0 failed (the same
2,118 the builder counted). No tests written or touched; the temporary
vitest config used to execute the bench script was deleted before
committing.

Needs the integrator: the measured numbers miss 10 of 14 doc targets on
this machine (see "Speed numbers"); the draft-slower-than-final result in
particular looks like a tracer bug. Performance work is outside the fixer
brief, so all of it is left for the area owner.
