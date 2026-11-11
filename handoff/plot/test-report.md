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

## Regression round

File: `packages/plot/test/spec/regressions.test.ts`, 120 tests, one `describe` per finding PLOT-SM-1 to PLOT-SM-16 in `handoff/plot/findings.md`. Written from each finding's observed behaviour and broken invariant, the docs, `packages/plot/src/index.ts` and `packages/plot/src/contracts.ts`; no other file under `packages/plot/src/` was opened. The tests were run against a clean checkout of `7d4bd5c` (the checker commit, no fixes), where 99 fail and 21 pass. `npx tsc -p tsconfig.json --noEmit` and `npx eslint` on the file are clean.

### Tests per finding (against the unfixed `7d4bd5c`)

| Finding | Tests | Fail on the defect | Pass on the defect (guards) | What the failing tests check |
|---|---|---|---|---|
| PLOT-SM-1 marker de-duplication and cap | 9 | 7 | 2 | implicit markers `<= maxSamples` (explicit 200 and default 4,000), `capped` set when markers drop, 200 px implicit square under 1 s (defect: 3.6 s), region checkerboard markers `<= 100`, diagonal-touching cells are not `isolated`, 300 x 204 checkerboard under 600 ms. Guards: no duplicate kind and pixel cell, a real isolated point (`x^2 + y^2 <= 0`) is still marked. |
| PLOT-SM-2 implicit memory and device pixels | 6 | 4 | 2 | `traceImplicit` returns `limit`, in under 1 s, for the four views `fillRegion` refuses (4096 px at dpr 4 and 3, 3000 px at dpr 4, 16384 x 1024 at dpr 4). Guards: the precondition that `fillRegion` refuses them, and an ordinary dpr 2 view still traces. |
| PLOT-SM-3 partner and fallback scans | 4 | 3 | 1 | `sin(1/x)` best of 5 under 25 ms (defect 45 ms), NaN storm at 70,000 evaluations under 500 ms (defect 1.8 to 2.1 s), parametric `sqrt(sin(100 s))` with many gaps under 450 ms (defect 570 ms). Guard: `sin(1/x)` still completes with paths. |
| PLOT-SM-4 budget stop in `refineUndefined` | 15 | 15 | 0 | `sqrt(-x) + sin(4x)` sliced by 16, 17, 20, 50, 100, 233 and 300 evaluations equals the direct plot (paths, markers, ink, `capped`, `rigorous`, samples); no slice call takes 40 ms or more (defect 80 ms); no mid-run token has `capped` or lost `rigorous`; `sqrt(x) + sin(4x)` and `sqrt(x + 2) * sin(3x)` sliced equal the direct plot. |
| PLOT-SM-5 resume token and function version | 6 | 5 | 1 | `x` resumed as `x + 3` (with and without a `version` option) is refused with `bad_argument` or restarted to the direct plot of `x + 3`; never 100 stitched paths or hundreds of markers; a film that bumps the version per frame never mixes. Guard: the same version resumes and equals the direct plot. |
| PLOT-SM-6 seeds and the sample cap | 8 | 8 | 0 | a 4,166-sample cached seed does not set `capped`, still refines to chords of 9 px or less, costs no more evaluations than no seed, same path count; panning by 0.25, 0.5 and 1 unit saves at least 70% of the overlapping coarse grid evaluations (defect saves 0); parametric seeds of 5,000 and 1,500 (with `maxSamples` 1,000) samples do not set `capped` and still refine. |
| PLOT-SM-7 regions without enclosures | 7 | 5 | 2 | at the default budget on 1,000 x 600: `x > 0` completes with 45 to 55% filled, the disc and `sin(x) * y > 1` complete with output, `x > 0` completes at `maxEvals` 100,000, `sin(x) + sin(y) == sin(x*y)` completes. Guards: the implicit circle still completes with a closed path; a 50-evaluation budget still reports `complete: false`. |
| PLOT-SM-8 verdict costs more than one budget | 7 | 4 | 3 | `sqrt` with `depth: 1, coarse: 2` completes in slices of 16 and 20 evaluations (defect: incomplete after 300 calls), the sliced plot equals the direct plot, no token remains after completion. A refusal with `bad_argument` is also accepted (the finding allows a minimum budget). Guards: slices of 32 on `sqrt`, and `1/x` and the removable-hole function at 16. |
| PLOT-SM-9 exact mode resumed without enclosure | 5 | 3 | 2 | in the band phase and in an early phase, a resume without the enclosure is refused with `bad_argument` or finishes with all 800 ink columns and no path (defect: complete with 201 columns, or 0). Guards: the direct exact plot has 800 columns, and a resume with the enclosure equals it. |
| PLOT-SM-10 cache identity and eviction | 6 | 5 | 1 | no duplicate x in a seed after two puts (defect: 200 values, 100 distinct), ascending seed x, re-put refreshes the key (capacity 2: `hot` survives), the same for `putParam`. Guard: capacity is respected. |
| PLOT-SM-11 parametric hole search | 6 | 6 | 0 | `(s/10, sqrt(sin(20 s)))` on `-40..40` with a sound enclosure completes with at most 10,000 interval evaluations (defect 19,789, incomplete) and draws at least half the paths of the unenclosed trace; a loose "always maybe" enclosure completes; `k = 5` needs at most 5,000 interval evaluations (defect 6,867); a loose enclosure on `k = 2` does not leave it emptier. |
| PLOT-SM-12 region sample cap | 6 | 5 | 1 | dense path with `maxSamples` 500: emitted points (rect corners, polygon and border vertices) and `stats.samples` at most 564, `capped` true (defect 32,974); an all-maybe enclosure with a tiny cap fills at most 65% of a checkerboard view and at most 25% of the filled pixels are false (defect: 100% and 50%); a capped disc emits at most 364 points and no more than 1.05 times the disc area. Guard: a small disc is not capped. |
| PLOT-SM-13 region border cost | 3 | 2 | 1 | half-plane with a border: evaluations at most twice the fill alone plus 1,000, and under 8,000 (defect 15,873). Guard: the border still lies on pixel x = 500 and is strict. |
| PLOT-SM-14 oscillation markers | 6 | 4 | 2 | `sin(1/x)` has at most 100 hole, open-end and jump markers on both views (defect 1,090 and 1,322), none within 1.5 px of an ink column, `sin(10/x)` at most 100. Guards: ink columns remain; `x * sin(1/x)` has at most 5 such markers. |
| PLOT-SM-15 token validation | 19 | 17 | 2 | the findings repro and every one of: `maxSamples` 1e9, 70,000, 0, NaN (`limit` or `bad_argument`), `depth` 60 and -1, `bendPx` 0 and NaN, `chordPx` -1 and Infinity, a pending span with depth -1e9 or 99, a NaN in `coarseXs`, a piece with `lo > hi`, a piece with an unknown end kind, a non-boolean `exact` are refused. Values were chosen because a fresh `plotFunction` refuses them (probed on the unfixed code). Guards: an untouched token survives `structuredClone` and resumes; the token carries pending spans, pieces and a coarse grid. |
| PLOT-SM-16 parametric markers | 7 | 6 | 1 | five curves (`(1e300 s, 1/s)`, `(s, tan s)`, `(1/s, 1/s)`, `(s, 1e200/s)`, `(s, sqrt(s)/s)`) have only finite markers inside the clip box `[-4w, 5w] x [-4h, 5h]`; the findings repro has no marker beyond 1e6 px. Guard: a circle keeps its markers in the clip box. |

Total: 120 tests, 99 fail and 21 pass on `7d4bd5c`.

### Choices the fixer should know about

- **PLOT-SM-5.** The findings suggest a `version` option on `FunctionPlotOptions` and `ResumeFunctionOptions`. The tests pass `version` through a cast and accept either a refusal (`bad_argument` or `limit`) or a restart whose result equals the direct plot of the new function. A resume that stitches old and new samples fails. If the fix uses another mechanism for detecting a changed function, the tests that pass `version` need the same option name.
- **PLOT-SM-6.** The pan tests expect a seed from an earlier plot of the same function to save at least 70% of the overlapping coarse grid (`0.7 * (201 - steps)` evaluations). That needs the coarse grid anchored on a lattice that a pan by whole grid steps reproduces exactly, as the finding suggests.
- **PLOT-SM-2.** Only the four views listed are asserted, because the region filler refuses them today. The tests do not assert that `createView` or `plotFunction` count device pixels.
- **PLOT-SM-12.** The emitted-point count is `rects.length` (four corners per rectangle) plus polygon vertices plus border vertices, with a slack of 64 points for the last leaf processed before the cap trips. `stats.samples` is only required to stay inside the same bound on a capped run, not to equal the count.
- **PLOT-SM-3.** The timing ceilings are about 2 to 5 times the expected fixed cost and 1.5 to 4 times below the measured defect on this machine (Node, darwin arm64): 25 ms (best of 5 runs), 500 ms and 450 ms. The inputs finish in about 2 s or less on the defective code, because a synchronous hang cannot be interrupted by the runner, so each case measures elapsed time after the call.
- **PLOT-SM-4.** The 40 ms ceiling per slice is a hang guard (defect 75 to 90 ms, fixed code a few ms).
- **PLOT-SM-13.** The speed targets in milliseconds are not asserted (machine dependent); the evaluation count of the border is.

### Isolation

Files read this round: `handoff/plot/findings.md`, `handoff/plot/test-report.md`, the existing tests and `helpers.ts` under `packages/plot/test/spec/`, `packages/plot/src/index.ts` and `packages/plot/src/contracts.ts`. `docs/` was not opened (the findings and the earlier report were enough). No other file under `packages/plot/src/` was opened, and `handoff/plot/fixer-notes.md` was not read. Source was exercised only by running tests (including a clean copy of `7d4bd5c` in a scratch worktree, deleted afterwards). `src/` and `findings.md` were not changed.
