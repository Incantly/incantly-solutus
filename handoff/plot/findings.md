# Plot: checker findings

Checker pass 1 (pipeline step 4) at commit `8f3a4c8` on `feat/plot`. Paths are under `packages/plot/src/` unless given in full. State machines P1 to P8 are in `docs/state-machines.md`, section `plot`.

Each finding was reproduced through the public API (`packages/plot/src/index.ts`) from a throwaway vitest file, deleted afterwards. Forged `FunctionValue`s (`{ arity: 1, ret: 'Number', call, call1, batch }`) stand in for compiled functions; enclosures are sound unless the finding says otherwise. Times are from Node 26, darwin arm64, on the checker's machine. `V` below is the view `{ x0: -5, x1: 5, y0: -5, y1: 5, widthPx: 800, heightPx: 600 }`.

Ranked by impact: security (unbounded time or memory), then wrong results, then wrong flags and slow paths, then cosmetic. Counts: 7 high, 6 medium, 3 low. Fix groups are at the end.

## High

### PLOT-SM-1: Marker de-duplication is quadratic, and markers are not capped

- **Impact:** hang from one input; output size unbounded.
- **Evidence:**
  - `implicit.ts:506-514` `uniqueMarkers` runs `out.some(...)` over every kept marker for every marker. `region.ts:378-382` `addMarker` does the same scan on every insert. Neither tracer counts markers against `maxSamples`.
  - Implicit: `traceImplicit({ residual: () => 0, enclosure: () => ({ lo: 0, hi: 0, def: 2 }) }, view, { maxEvals: 1e7 })` (the field of `x - x == 0`) gives one `isolated` marker per leaf from `probeSmallFeature`. Square views of 100, 200 and 400 px: 6,724 markers in 0.39 s, 17,424 in 2.5 s, 53,824 in **64 s**.
  - Region: `fillRegion({ test, enclosure: () => 'maybe' }, view, { maxEvals: 1e7, maxSamples: 65536 })` with `test` true only near one sub-cell centre per leaf: 100, 200 and 400 px give 6,724 markers in 0.39 s, 17,424 in 3.4 s, 53,824 in **33 s**. Without an enclosure, a 500 x 400 px checkerboard (`(floor(x) + floor(y)) % 2 == 0`, cells of 6 px) records 18,321 `isolated` markers at the points where diagonal cells touch and takes 5.4 s; 1,000 px takes 27 s and 2,000 px takes 104 s. A profile shows the time inside `addMarker`.
  - Both runs are within the allowed budgets (`HARD_MAX_EVALS` is 10,000,000).
- **Invariant broken:** P6 and P7: work and output follow the curve length and the sample cap, not the leaf count squared.
- **Suggested fix:** de-duplicate with a hash keyed by the rounded pixel cell (and kind), checking the 3 x 3 neighbouring cells, in `uniqueMarkers`, region `addMarker`, and the same pattern in `function.ts` `sortMarkers` and `param.ts` `sortMarkers` (sorted, so already linear, but keep one helper). Count markers against `maxSamples` and set `capped` when markers are dropped. Separately, a leaf whose covered sub-cells touch a covered neighbour is not an isolated point; only mark islands.
- **status:** open

### PLOT-SM-2: The implicit tracer can hold about 2 GB at the hard caps

- **Impact:** memory exhaustion (a crash on a phone, a killed worker on a laptop).
- **Evidence:** `implicit.ts:84-97` `gEval` memoises every call in `memo` under a string key `` `${x},${y}` ``, and `cornerAt` keeps a second map. Nothing bounds the grid: `checkView` (`errors.ts:99`) caps `widthPx * heightPx` in CSS pixels at 16,777,216, but the tracer works in device pixels (`devicePixelRatio` up to 4), so the grid can hold 16 times that. `fillRegion` refuses the same view (`MAX_BITMAP_CELLS`, `region.ts:69`); `traceImplicit` has no such check. Repro: `traceImplicit({ residual: (x, y) => Math.sin(10 * x) + Math.sin(10 * y) }, { x0: -5, x1: 5, y0: -5, y1: 5, widthPx: 4096, heightPx: 4096, devicePixelRatio: 4 }, { maxEvals: 1e7 })` grows the heap by **1,901 MB**, runs 16.6 s, and returns `complete: false` with no output. `fillRegion` on the same view returns `limit` ("67634176 leaf cells").
- **Invariant broken:** P5: memory per call is bounded by a figure-sized budget, and the view limits count the pixels the tracer actually samples.
- **Suggested fix:** check the view area in device pixels (`widthPx * heightPx * dpr^2`) in `checkView`, give `traceImplicit` the same leaf-cell limit as `fillRegion`, key `memo` and `corners` by number (grid indices, or a `Float64Array` hash) instead of strings, and drop `memo` entries for rows the dense scan has passed. Consider a lower hard cap for evaluations whose results are kept.
- **status:** open

### PLOT-SM-3: Partner and fallback searches scan every sample, so edge-heavy functions are quadratic

- **Impact:** hang on functions with many undefined stretches; misses the `sin(1/x)` target by 9 times.
- **Evidence:** `function.ts:959-973` `findPartner` walks all of `st.samples` for every edge verdict (`finishEdge`), `function.ts:1234-1246` `edgeFallbackY` does the same per domain end, and `param.ts:479-498` `joinPartner` does the same in the parametric tracer.
  - `plotFunction(fnOf(x => Math.sin(1 / x)), { x0: -5, x1: 5, y0: -3, y1: 3, widthPx: 1000, heightPx: 600 })`: 44 to 54 ms per call (target 5 ms), of which 1.6 ms is spent in the function; a CPU profile puts 248 ms of 5 calls in `findPartner`.
  - NaN storm: `f(x) = h(x) < 0.5 ? NaN : sin(x)` with `h` a fixed hash of `x`: 177 ms at the default budget (20,000 evaluations, 9 µs each), and **189 s** with `{ maxEvals: 1e7, maxSamples: 65536 }` (501,100 evaluations).
  - `sqrt(sin(k x))` with `{ maxEvals: 1e7, maxSamples: 65536 }`: k = 20, 80, 320 take 15, 70 and 324 ms.
- **Invariant broken:** P2: cost per verdict is bounded by a constant number of evaluations and lookups.
- **Suggested fix:** keep the samples in a sorted array (or sort the keys once per classify phase, as `resolveBreaks` already does) and find the nearest defined neighbour on the far side by binary search, then step outward. Use the same helper in `edgeFallbackY` and `param.ts` `joinPartner` (sorted by `s`, then compare the screen distance of the nearest few).
- **status:** open

### PLOT-SM-4: A budget stop inside `refineUndefined` spins 2,000,000 steps and then throws work away

- **Impact:** wrong plot after slicing (breaks "the final result is identical regardless of how it was sliced"), wrong `capped` and `rigorous` flags, and an 80 ms stall in a call meant to fit a frame.
- **Evidence:** `function.ts:430-444` `refineUndefined` pushes the span back and returns when `evalAt` runs out of budget, but its caller (`function.ts:394-396`) does `continue`. The loop pops the same span, finds `l` and `r` cached, calls `refineUndefined` again, and repeats until `STEP_CAP` (`function.ts:365-367`). `forceCap` (`function.ts:446-452`) then moves every pending span to `accepted`, empties `suspicious`, and sets `capped = true` and `rigorous = false`. The run is still `suspended`, so the token carries the damage. Repro: `f(x) = sqrt(-x) + sin(4x)` on `V`. Direct: 177 output samples, `capped: false`. Sliced with `maxEvals` 16, 17, 20, 50, 100, 150, 200, 233 or 300 per call: 100 or 101 samples, `capped: true`, different paths; each slice that stops inside `refineUndefined` takes about 80 ms. The parametric tracer has the same `push; return` in `runRefine` (`param.ts:290-293`), but there `dead` ends the run, so no spin.
- **Invariant broken:** P2: a suspension leaves `pending`, `suspicious` and the flags exactly as they were before the interrupted step; P3: a span is in exactly one list.
- **Suggested fix:** have `refineUndefined` return a status, and have `runRefine` `return` when `st.suspended` is set. Also make `runRefine` and `runClassify` return at once on `st.suspended` before any `forceCap`, and make `forceCap` unreachable while suspended. Check every other caller of `evalAt` for the same pattern.
- **status:** open

### PLOT-SM-5: A resume token is not tied to a function version

- **Impact:** wrong plot: samples of two different functions are joined into one figure. While a film plays, a function of `t` bumps its version every frame (functions-calculus 10, "Time"), and the design resumes an incomplete plot next frame (functions-calculus 9, "Budgets"), so this is the normal path for animated figures.
- **Evidence:** `FunctionResume` (`contracts.ts`) has no version, and `resumeFunctionPlot` (`function.ts:1499`) accepts any `FunctionValue`. Repro: `first = plotFunction(fnOf(x => x), V, { maxEvals: 100 })`, then `resumeFunctionPlot(first.resume, fnOf(x => x + 3), { maxEvals: 1e6 })` returns `complete: true` with 100 paths and 498 markers (the direct plot of `x + 3` is 1 path), stitched from the old coarse samples of `x` and new samples of `x + 3`.
- **Invariant broken:** P2: every sample in a run belongs to one `(function version, view, pixel size)`.
- **Suggested fix:** add `version` to `FunctionPlotOptions` and to the token, require it in `ResumeFunctionOptions`, and refuse a mismatch with `bad_argument` (or restart). Document that a version change discards the token, as it discards the cache.
- **status:** open

### PLOT-SM-6: Seed samples count against the sample cap, so a pan with a cached seed skips refinement

- **Impact:** wrong plot on the most common interaction (a pan): a coarse-only curve, flagged `capped`.
- **Evidence:** seed samples go into `st.samples` (`function.ts:1479-1484`, `param.ts:642-647`), and refinement stops when `st.samples.size >= maxSamples` (`function.ts:369`, `param.ts:268`). `seedForRange` (`cache.ts:63-77`) returns every overlapping sample of every entry with that version, so a seed easily exceeds 4,000. Repro: put 5,000 samples of `sin(3x)` over `[-6, 6]` and a 300-sample token of the same function in one cache, pan `V` to `x0 = -4.5, x1 = 5.5`, `plotFunction(f, pan, { seed: cache.seedForRange(1, -4.5, 5.5) })`: 200 evaluations, `maxDepth: 0`, `capped: true`, 200 output samples. Without the seed: 587 evaluations, `maxDepth: 1`, 294 samples, `capped: false`. Also, most seed samples are never used: spans are built from the new coarse grid, whose x values are recomputed from the new `x0` and only match old values by chance (a pan of exactly 10 coarse steps matches 155 of 200 grid points).
- **Invariant broken:** P1 and P2: a seed only saves evaluations; the plot is the same with or without it.
- **Suggested fix:** count only samples evaluated or used by this run for the cap (keep a separate counter), and trim the seed to the pan range and to the cap before use. Lay coarse grids on a lattice anchored at a multiple of the grid step (for example `k * step` for integer `k`), so a pan hits the cached x values exactly.
- **status:** open

### PLOT-SM-7: Without enclosures, every region and the many-component implicit curve fail at the default budget

- **Impact:** nothing is drawn: until the kernel supplies enclosures (builder notes, "Kernel handoff"), every `fillRegion` from `predicateFromRelation` on an ordinary 1,000 x 600 view returns `complete: false` with empty output.
- **Evidence:** `npm run bench` (`packages/plot/bench/plot.bench.ts`): region half-plane, disc and half-plane, and `sin(x) * y > 1` all report `complete=false samples=0` at 197,000 to 200,000 evaluations; implicit `sin(x) + sin(y) == sin(x*y)` reports `complete=false`. The dense paths (`region.ts:162-189`, `implicit.ts:370-379`) test every leaf corner of the padded view (about 176,000 at 2 px leaves) and then supersample each boundary leaf 16 times, which passes `DEFAULT_MAX_EVALS_REGION` (200,000) before the borders are traced. The doc says "the caller re-runs with a larger budget", but nothing tells the caller which budget would suffice.
- **Invariant broken:** P5 and P7: the default budget completes an ordinary figure; `complete: false` is the exception.
- **Suggested fix:** size the dense path to the budget (for example fall back to draft 6 px leaves, or to a corner grid of `maxEvals / 3` points, when the full grid does not fit), and reuse the corner grid values for border tracing instead of a second dense pass. Report the estimated budget in the stats when a run stops.
- **status:** open

## Medium

### PLOT-SM-8: A verdict that costs more than one call's budget never completes

- **Impact:** livelock: `resumeFunctionPlot` returns `complete: false` forever.
- **Evidence:** `runClassify` (`function.ts:487-499`) rolls back a verdict when it suspends and redoes it whole on the next call. Real samples are cached, so a redo gets further each time, but interval evaluations are not cached. `classifyEdgeEnclosed` (`function.ts:818-853`) needs 2 interval evaluations per bisection step, up to 80. When that exceeds `maxEvals`, every call spends its budget on the same verdict and rolls it back. Repro: `plotFunction(fnOf(Math.sqrt), V, { enclosure: sqrtEnc, depth: 1, coarse: 2, maxEvals: 16 })`, then 500 calls of `resumeFunctionPlot(token, f, { enclosure: sqrtEnc, maxEvals: 16 })`: still `complete: false`, 3 real and 7,997 interval evaluations. (`maxEvals: 16` is the smallest allowed budget; with the default `depth` and `coarse` the same budget completes in 21 calls.)
- **Invariant broken:** P2: every call with a positive budget makes progress.
- **Suggested fix:** cache interval results by `(lo, hi)` in the state and the token, or let a verdict that has already been rolled back once run to completion in the next call, or require `maxEvals` at least the largest verdict cost (about 100).
- **status:** open

### PLOT-SM-9: An exact-mode run resumed without its enclosure reports `complete: true` with a partial band

- **Impact:** wrong result marked complete.
- **Evidence:** in the band phase, `runExact` (`function.ts:1001-1004`) treats a null `intervalAt` as a budget stop (`pending.push; return`), but `intervalAt` (`function.ts:291-293`) returns null without setting `suspended` when there is no enclosure. `finishComplete` then sees `exactActive` false and returns the curve paths plus the band columns drawn so far. Repro: `plotFunction(fnOf(Math.sin), V, { exact: true, enclosure: sinEnc, maxEvals: 300 })`, resume with the enclosure until `resume.phase === 'band'` (599 columns pending), then `resumeFunctionPlot(token, f, { maxEvals: 1e6 })` without the enclosure: `complete: true`, 201 of 800 ink columns, 1 path. The direct run gives 800 columns and no path.
- **Invariant broken:** P2: `complete: true` means every phase drained; `band` is entered only with an enclosure.
- **Suggested fix:** refuse a resume without an enclosure when the token says it used one (`token.exact` or `token.intervalEvals > 0`) with `bad_argument`, or restart the band from the curve verdicts. In `runExact`, distinguish "no enclosure" from "budget spent".
- **status:** open

### PLOT-SM-10: The sample cache has no function or view identity, and evicts by insertion order

- **Impact:** wrong plot when a cache is shared, slower plots when it is not.
- **Evidence:** `cache.ts:63-77` `seedForRange` merges every entry whose `version` matches. Versions are per-object stamps, so two functions (or the same function in two figures) can share a number. Repro: one cache, `f = sin(3x)` and `g = x^2` both at version 1, each stored from a 400-evaluation token, `f` first: the seed holds 800 samples with 247 duplicate x values, the later `g` value wins in `plotFunction`'s map, and 4 vertices of `f`'s plot lie on `g`. `cacheKey` is ignored by lookups (only by `put`). Eviction (`trim`, `cache.ts:49-55`) drops the first-inserted key, and `Map.set` on an existing key keeps its position: after `put('hot')`, `put('b')`, `put('hot')`, `put('c')` with capacity 2, `hot` is gone. The builder notes say a version change clears the cache; the code never clears on its own.
- **Invariant broken:** P1: a seed for `(function, version)` holds only that function's samples, one value per x.
- **Suggested fix:** key entries by a function identity plus version (or make `seedForRange` take the key prefix), clear older versions of the same identity on `put`, de-duplicate x values, and move a re-put key to the end (`delete` then `set`).
- **status:** open

### PLOT-SM-11: The parametric hole search bisects every maybe-defined box to depth 40

- **Impact:** an enclosure makes a curve fail where sampling alone succeeds.
- **Evidence:** `param.ts:198-222` `findHoles` caps probes at 8 per box (`found`) but keeps bisecting every `def = 1` box down to depth 40, so each defined/undefined boundary costs about 80 interval evaluations before any sampling starts. Repro: `(s / 10, sqrt(sin(20 s)))` for `s` in `-40..40` with a sound enclosure (`def` 2, 0 or 1 by the sign range of `sin`): `complete: false`, 211 real and 19,789 interval evaluations, no output. Without the enclosure: `complete: true`. With `k = 2` and `k = 5` the enclosure run completes (2,940 and 6,867 interval evaluations). A loose but sound enclosure that answers `def = 1` over a whole undefined stretch never completes at any budget (2,000,000 tried).
- **Invariant broken:** P4: the hole search costs a bounded share of the budget, and an enclosure never makes a trace less likely to finish.
- **Suggested fix:** give `findHoles` a budget share (for example 10%), stop descending once a box is narrower than a tenth of a pixel on screen, and skip boxes whose ends are both undefined (gaps, not holes).
- **status:** open

### PLOT-SM-12: The region sample cap counts the wrong thing, is skipped on the dense path, and over-fills when it trips

- **Impact:** wrong fills and wrong `capped`/`samples` stats.
- **Evidence:**
  - `st.points` adds the number of covered sub-cells per supersampled leaf (`region.ts:375`), not output points, so an ordinary disc of radius 200 px trips the 4,000 cap (`capped: true`) at the default budget.
  - When it trips, `runFill` (`region.ts:135-138`) fills every remaining queued node that is not `false` (`fillCoarse`). With an enclosure that answers `maybe` for every box, the checkerboard above becomes 1 rectangle covering the whole view. For the disc the extra area is 643 px² (0.5%).
  - `checkCap` is only called on the enclosure path (`region.ts:149`); the dense path never checks it. Repro: `fillRegion` of `sin(8x) * sin(8y) > 0` with its margin on `V` and `{ maxEvals: 1e7 }`: 19,272 polygons, 2,300 rectangles, `samples: 90131` against `maxSamples` 4,000. The 2,000 px checkerboard returns 11,189 rectangles, `samples: 44756`, `capped: false`.
  - `samples` is computed as `(rects.length / 4) * 4` (`region.ts:624`), which is the number of floats, not rectangles or corners.
- **Invariant broken:** P7: emitted points are at most `maxSamples`; `capped` is set exactly when output was limited; a capped fill never claims area the predicate does not hold.
- **Suggested fix:** count emitted vertices (4 per rectangle after merging, polygon vertices, border vertices), check the cap on both paths, and when it trips stop splitting but resolve the remaining `maybe` leaves by one centre test instead of filling them whole.
- **status:** open

### PLOT-SM-13: Speed targets are missed even with enclosures

- **Impact:** frames over budget.
- **Evidence:** with sound enclosures on the bench view (`1000 x 600`, `[-5, 5] x [-3, 3]`), mean of repeated warm runs: implicit unit circle 2.35 ms (target 2), draft circle 0.67 ms (target 0.5), half-plane with its border 5.7 ms (target 0.3; 0.67 ms without the border), `tan(x)` over 12 poles 2.1 ms (target 1.5). Without enclosures (`npm run bench`): heart 0.51 ms (0.3), spiral 1.9 to 2.0 ms (1.5), `tan` 2.5 to 2.8 ms (1.5), `sin(1/x)` 44 ms (5, see PLOT-SM-3), implicit circle 124 ms (2). The largest gap with an enclosure is the region border: `traceBorder` (`region.ts:441-496`) runs a second quadtree through `traceImplicit` and then spends 5 more evaluations per border segment in `segmentOnBoundary` (15,873 evaluations for a straight line).
- **Invariant broken:** performance.md section 1 and section 6 (benchmarks gate CI).
- **Suggested fix:** after PLOT-SM-1, 3 and 7, profile again. For borders, emit the boundary segments from the fill's own boundary leaves (the crossings are already Newton-corrected there) instead of a second trace, and test "on the combined boundary" once per leaf, not per segment.
- **status:** open

## Low

### PLOT-SM-14: `sin(1/x)` without an enclosure still records about 1,000 spurious markers

- **Impact:** visual noise (open circles and jump marks near 0) on a classic classroom function.
- **Evidence:** `plotFunction(fnOf(x => Math.sin(1 / x)), V)`: 81 `hole`, 646 `openEnd` and 363 `jump` markers, 110 ink columns, `rigorous: false`; on the bench view, 1,324 markers and 159 paths. The fixer notes report the same and that no spec test asserts it.
- **Invariant broken:** P3: a marker is recorded only for a verdict the heuristics can support; spans that are oscillation become ink.
- **Suggested fix:** apply the `stepIsFlat` oscillation test before the edge, hole and jump verdicts, and suppress marker verdicts inside or next to a span already turned into an ink column.
- **status:** open

### PLOT-SM-15: Resume tokens are trusted for their configuration fields

- **Impact:** a malformed or edited token can disable the sample cap and the thresholds. Tokens cross a worker boundary as plain data.
- **Evidence:** `checkToken` (`function.ts:1353-1391`) checks spans, samples, view and counters, but not `depth`, `bendPx`, `chordPx`, `maxSamples`, `exact`, `coarseXs` or the contents of `pieces`. `resumeFunctionPlot({ ...token, maxSamples: 1e9, bendPx: 1e-9, depth: 60 }, f, { maxEvals: 1e7 })` and a span with `depth: -1e9` both run with `ok: true`. The per-call `maxEvals` still bounds each call.
- **Invariant broken:** P2: a resumed run has the same limits as a fresh one (`checkScalarOptions`).
- **Suggested fix:** run the token's configuration through `checkScalarOptions` and `checkBudgets`, check `coarseXs` and `pieces` like the other arrays, and require span depths in `0..depth`.
- **status:** open

### PLOT-SM-16: Parametric markers are not filtered or clipped

- **Impact:** markers far off screen at astronomical pixel coordinates.
- **Evidence:** `param.ts:500-503` `addMarker` records any coordinates, while `function.ts:979-984` drops non-finite ones. `traceParamCurve({ fn: s => (1e300 s, 1/s), lo: -1, hi: 1 }, V)` returns `pole` markers at `py = ±7.1e19` and `end` markers at `px = ±8e301`.
- **Invariant broken:** P4: markers carry drawable pixel coordinates.
- **Suggested fix:** share the function plotter's `addMarker` guard, and drop or clamp markers outside the clip box `[-4w, 5w] x [-4h, 5h]` the paths already use.
- **status:** open

## Fix groups

1. **Linear lookups** (PLOT-SM-1, PLOT-SM-3): a pixel-cell hash for marker de-duplication, and sorted samples with binary search for partner and fallback lookups, in all four tracers.
2. **Budgets and memory** (PLOT-SM-2, PLOT-SM-7, PLOT-SM-12, PLOT-SM-11): device-pixel view limits, numeric memo keys, a dense path sized to the budget, one output-point counter for the cap, a budget share for the hole search.
3. **Suspend and resume** (PLOT-SM-4, PLOT-SM-5, PLOT-SM-8, PLOT-SM-9, PLOT-SM-15): propagate suspension out of every helper, version and enclosure checks on resume, interval caching or a progress guarantee, full token validation. Rule for the fixer: every function that can call `evalAt` or `intervalAt` must leave the lists untouched when it suspends.
4. **Cache** (PLOT-SM-6, PLOT-SM-10): identity plus version keys, seeds that do not count against the cap, a grid lattice that pans onto cached x values.
5. **Speed** (PLOT-SM-13): after groups 1 and 2, profile the bench cases again; borders from the fill's own boundary leaves.
6. **Marker quality** (PLOT-SM-14, PLOT-SM-16).

## Categories with nothing found

- **Interleaved and forked runs:** resuming the same token twice, or two suspended runs of different functions interleaved, give independent results. `resumeFunctionPlot` copies every list and rebuilds the sample map, and tokens are never mutated.
- **Deep recursion:** every tracer uses explicit stacks or queues (`pending`, `suspicious`, quadtree queues, `findHoles` and `cullBoxes` stacks). No recursive function depends on input.
- **Callbacks that throw:** every public entry runs inside `guard` and returns `internal`.
- **Huge values and infinities in the function plotter and the implicit tracer:** `1e308 * sin(x)` gives finite, clipped paths; `1e308 * (x^2 + y^2 - 1)` traces one path. `crossingT` falls back to 0.5 for non-finite ends.
- **Implicit linking:** `linkSegments` stays linear for long chains (one 4,000 px sine: 214,520 evaluations in 170 ms, the same per-evaluation cost as 1,000 px).
- **One-variable predicates:** `fillPredicate1D` stayed linear with 200 to 625 bands; its budget and its bisection to 0.1 px held.
- **Run code, read keys, DOM, timers, randomness:** none in `packages/plot/src` (no `eval`, `Function`, `Date`, `Math.random`, `console` or globals).
- **Edge bisection direction** (fixed in round 1): the defined end and the undefined end are tracked separately in `classifyEdge`, `classifyEdgeEnclosed` and `param.ts` `classifyEdge`.
