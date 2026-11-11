# Plot: blind spec test report

Area `plot`, package `packages/plot/` (entry `@incantly/plot`). Tests live in `packages/plot/test/spec/`.

## Totals

448 tests in 10 files: 404 pass, 44 fail. The failures are tracer defects against the docs; no source was changed. `npx tsc -p tsconfig.json` and `npx eslint .` are clean. `npx vitest run` shows only these 44 plot failures; all other projects pass (2522 passed overall).

## Pass/fail by doc section

| File | Doc section | Pass | Fail |
|---|---|---|---|
| contracts.test.ts | performance §5 (budgets, level of detail), FC §9 and CL §5 constants, view helpers | 30 | 0 |
| errors.test.ts | errors/design §3-6 (Result, bad_argument, limit, internal, never throws) | 68 | 2 |
| function-pieces.test.ts | FC §9 steps 1-2, cache and incremental update | 51 | 1 |
| function-refine.test.ts | FC §9 steps 3-4 (0.25 px, 8 px, depth 14, single evaluation, suspicious pairs) | 37 | 0 |
| function-classify.test.ts | FC §9 step 5 (steep, gap, hole, pole, jump), marker coordinates | 32 | 13 |
| function-output.test.ts | FC §9 steps 6-7, PlotResult shape, `exact` band | 42 | 1 |
| function-budgets.test.ts | FC §9 budgets, frame budget and resume, output stability, time targets | 27 | 5 |
| param.test.ts | CL §5 parametric tracer | 39 | 9 |
| implicit.test.ts | CL §6 implicit tracer | 35 | 10 |
| region.test.ts | CL §7 inequality filler and 1D predicates | 43 | 3 |

## Failing tests

FC = `docs/features/functions-calculus/design.md`, CL = `docs/features/curves-loci/design.md`, PERF = `docs/design/performance.md`, ERR = `docs/features/errors/design.md`.

### Budgets (PERF line 83, FC line 455, CL §5/§6)

| Test | Doc line checked | Observed |
|---|---|---|
| function-budgets: maxSamples 50 caps the output | FC 455, PERF 83 | 200 samples |
| function-budgets: maxSamples 100 caps the output | FC 455, PERF 83 | 200 samples |
| function-budgets: the default cap is 4,000 samples | PERF 83 ("4,000 per curve") | 5000 samples |
| param: an explicit sample cap binds the output | PERF 83 | 133 > 100 |
| param: the default cap is 4,000 samples | PERF 83 | 5000 |
| implicit: an explicit sample cap binds the output | PERF 83 | 478 > 100 |
| function-budgets: finished plot identical however sliced (maxEvals 300) | FC 455 ("identical regardless of how it was sliced") | resume did not converge in 22 slices |
| function-budgets: finished plot identical however sliced (maxEvals 1000) | FC 455 | 289 samples sliced vs 231 whole |

### Function plotter, step 5 verdicts (FC lines 447-451)

| Test | Observed |
|---|---|
| 1/x: an unbounded enclosure yields exactly one pole marker at x = 0 | 0 pole markers |
| 1/x: the pole marker sits at the view vertical centre | 0 pole markers |
| 1/x: a pole is not a jump and not a hole | a marker of another kind is emitted |
| tan: one pole marker per pole | 0 of 4 |
| tan: five paths, one per piece | 3 paths |
| tan: no path spans a pole | a path spans x = -pi/2 |
| tan: poles are breaks, never sub-pixel oscillation | extra output (ink columns) present |
| floor: a jump breaks the path (ten steps, ten paths) | 1 path |
| floor: every step segment is flat | not flat |
| sqrt/steep: a suspicious stretch with an enclosure is verified with intervals | `intervalEvals` is 0 |
| no enclosure: every heuristic marker stays drawable (finite coordinates) | `openEnd` py not finite |
| no enclosure: marker counts stay sane | 3027 markers (bound 200 is a choice, see below) |
| no enclosure: no tan path joins across a pole | a path spans x = -pi/2 |
| exact band: a hole band still marks the hole (FC 463, "same code path"): markers equal those of the plain plot | the exact plot has no markers, the plain plot has the hole |
| pieces: `x^2` with declared breaks joins across them into one path (FC 442 and 447; reading, see below) | 2 paths |

### Parametric tracer (CL lines 181-183)

| Test | Doc line | Observed |
|---|---|---|
| a closed curve has no end markers (ui §1) | CL ui line 10 | one `end` marker |
| an unbounded enclosure breaks the curve and marks the pole | CL 182 | 0 pole markers |
| without an enclosure the infinite branch still breaks honestly | CL 182 | `stats.rigorous` is true, expected false |
| the sqrt gap holds without an enclosure, honestly flagged | CL 182 | `stats.rigorous` is true, expected false |
| a hole-like point joins with a marker | CL 182 | 0 markers |
| a cusp past 120 degrees is marked | CL 183 | 0 cusp markers |
| a stalling curve marks the stall as a cusp or singular point | CL 183 | 0 markers |

### Implicit tracer (CL lines 205-213)

| Test | Doc line | Observed |
|---|---|---|
| draft is cheaper than final (heuristic path) | CL 213 | draft 27341 evals vs final 26449 |
| a line `x + y = 0` crossing the view ends at its borders (within 2 px) | CL 210 | a path ends at (168, 168), inside the view |
| no residual input is evaluated twice | CL 206 | 4728 repeated evaluations |
| a touching point emits an isolated marker at the origin | CL 208 | 0 markers |
| a sub-quarter-pixel loop collapses to an isolated marker | CL 208 | 0 markers |
| a lemniscate node is crossed, not rounded | CL 209 | node rounded |
| a cusp is traced up to its tip | CL 209 | tip missing |
| a smooth circle links into one closed chain | CL 210 | 8 chains |
| chain order is sorted by first key | CL 210 | not sorted |

### Region filler (CL lines 253, 256)

| Test | Doc line | Observed |
|---|---|---|
| maximal merging keeps a half-plane to a few rectangles | CL 253 | 3762 rectangles for `x > 0` (bound 100 is a choice) |
| an isolated true point is marked (`x^2 + y^2 <= 0`, from a language relation) | CL 256 | 0 markers |
| an isolated true point is marked on the certain path | CL 256 | 0 markers |

### Errors (ERR line 251 and PERF line 83)

| Test | Observed |
|---|---|
| `traceParamCurve(null)` is refused with `bad_argument` | `internal` |
| a `limit` error carries a `limit` param (ERR line 251, "`limit` carries a `limit` param naming which") | no `limit` key in `params` |

## Choices where the docs are silent

- Time targets (0.3 ms, 1.5 ms and so on) are not asserted as wall-clock times, because CI machines vary. Each case gets a hard timeout plus an evaluation-count ceiling taken from the "about 1,200 evaluations" and "20,000 for a hard one" budgets.
- The upper bound on marker counts without an enclosure (200) and the half-plane rectangle bound (100) are generous readings of "stay sane" and "maximal rectangles".
- Hard caps (65536 samples, 16384 px per side, 16777216 px area, the eval cap) come from `contracts.ts` constants and are tested as exported. A view or budget over them must be `limit`; malformed values are `bad_argument`.
- "Each piece is plotted on its own" (FC line 442) does not say whether a break of a continuous function splits the path. Reading chosen: a continuous function stays one path across its breaks, with no jump, pole or hole marker (one failing test; the fixer may overrule the reading).
- `stats.rigorous` (from `contracts.ts`) is the certainty flag: false when a verdict came from sampling heuristics without an enclosure, true when intervals proved it. The docs say heuristic output must be "honestly flagged" without naming the field.
- Negative capacities for the sample cache are untested: the docs never say whether they throw or clamp.
- Marker `x`,`y` are maths coordinates and `px`,`py` pixel coordinates (from `contracts.ts`). Pole markers sit at the view's vertical centre.
- Test doubles for interval enclosures are sound (they contain every true value), so a failure blames the tracer, not the double.

## Not tested, and why

- Kernel-side queries in the same docs (Derivative, Slope, Tangent, Closest, PointOn, Intersect, Asymptote, Boundary, Area, PointIn, Length): not sampling; they belong to the kernel spec tests.
- Loci and envelopes (CL §9-11): sampled by the kernel, not by this package.
- Rendering of markers, dashed borders and the pole line (UI docs): drawing is in `view`; here only the plain data (`strict` flag, marker kinds) is checked.
- Wall-clock benchmark limits (PERF §6): covered by `packages/plot/bench`, not by spec tests.
- Draft-versus-final timing "4x cheaper" is checked as an evaluation-count comparison (one failing test); a 4x ratio is not asserted.
- Worker execution (PERF §5.5): the package is browser-free and pure; no worker is involved in the tests.

## Needs the integrator

- Nothing outside the allowed list was needed.

## Isolation

This run (continuation) read: `handoff/plot/continue-plot-test.md`, `handoff/plot/test-brief.md`, `packages/plot/src/index.ts`, `docs/features/functions-calculus/design.md` (section 9), `docs/features/curves-loci/design.md` (sections 5-7), `docs/design/performance.md` (section 5), `docs/features/errors/design.md` (grep only), `docs/features/curves-loci/errors.md` (grep only), `vitest.config.ts`, and the test files under `packages/plot/test/spec/` written by the earlier agents. No other file under `packages/plot/src/` and no other handoff file was opened.

The earlier agents' test headers cite `packages/plot/src/contracts.ts` (allowed by the brief) and the kernel's public API; their own reads were not re-verified in this run. They left probe files (`zz-probe*.test.ts`, `tsconfig.probe.json`), which this run deleted.
