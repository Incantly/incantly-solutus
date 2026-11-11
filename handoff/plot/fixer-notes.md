# Plot area: fixer notes

## Fixer round

Round 1 of the step-3 fixer. Input: `handoff/plot/test-report.md` (44 failing spec tests). Result: 447 of 448 plot spec tests pass; one is contested (below). No file in `packages/plot/test/spec/` was touched.

### Fixes, by group

1. **Sample caps** (PERF 83, FC 455). The cap now binds the emitted points, not only refinement: the coarse grid is clamped to `maxSamples` (`capped` is set when it clamps), and a final thinning step (`packages/plot/src/thin.ts`, first and last point of each polyline kept, even spacing by index) enforces it on the function plotter, the parametric tracer and the implicit tracer. Same rule applied to the implicit tracer's border traces inside `fillRegion` (they pass `maxSamples` through).
2. **Resume equivalence** (FC 455). Every classification verdict is now atomic: if the budget runs out mid-verdict, the partial pushes (pending, accepted, suspicious, markers, ink) are rolled back and the verdict is redone whole on resume. Sliced and direct runs now give identical paths, markers and ink at 300, 1000 and 5000 evaluations.
3. **Errors** (ERR 251, 11.3). `limit` errors carry a `limit` param naming the cap (`overLimit` is the only constructor of `limit`, so every case is covered). `traceParamCurve(null)` is `bad_argument`; a missing view (`null`) is `bad_argument` in every tracer (`checkView`).
4. **Function plotter verdicts** (FC 447-451). Rewrote the verdict code in `function.ts`:
   - Poles: a span whose samples leave the view on both sides (or peak off-view) is located by bisection to 1e-12 of the view width; with an enclosure an unbounded box confirms it (interval work stays at 4 evaluations for `tan` over 4 poles). One `pole` marker at the located x, view centre y; the path is cut there.
   - Jumps: a change concentrated in one place at a width far below a pixel is a jump unless the enclosure says bounded and `def = 2` (steep rise, drawn through). A jump must keep its level on both sides (`stepIsFlat`); otherwise it is oscillation and becomes an ink column (this also stopped `sin(1/x)` from producing thousands of jump markers).
   - Holes: a probe just beyond a single undefined point joins across and marks a `hole`.
   - Breaks: a piece that ends at a break is sampled at `b - eps` / `b + eps` (one-sided limits) and the break value at `b`; at each break, matching limits and value join into one path with no marker, matching limits with an undefined value give a hole, a tall limit gives a pole, otherwise `openEnd`/`closedEnd`/`jump`. The right view edge is read at `x1 - eps` so a step function does not draw a spurious rise at the edge. `eps` is `max(1e-13 * range, 1e-15 * max|x|)`.
   - Edge bisection (`classifyEdge`, `classifyEdgeEnclosed`): the defined and undefined ends were swapped for spans with the undefined end on the left; now tracked as separate `d`/`u` points (same bug fixed in the parametric tracer).
   - `exact = true` keeps the verdict pass and its markers (same code path, FC 463); the band is added on top.
   - Markers with non-finite coordinates are never recorded.
5. **Parametric tracer** (CL 181-183). Poles (a span still huge at the depth limit; enclosure unbounded, or heuristic with `rigorous: false`), hole search with an enclosure (bisect `def = 1` boxes, test the undefined point), cusps found at the join between neighbouring chords (turn above 120 degrees, also catches a tip that falls on a sample), stalls (a vertex far slower than the fastest on screen) as `singular`, off-view spans accepted without refinement, a closed curve has no `end` markers, closed flags use each chain's own scale.
6. **Implicit tracer** (CL 205-213). Each residual input is evaluated once (memo), shared edges use one crossing, the Newton correction is kept only if it lowers `|F|`, coinciding crossings are merged, tiny closed loops (under 0.25 px) collapse to an `isolated` marker, a corner exactly on the level with all neighbours on one side is an `isolated` marker, paths are clipped to the view, open chains start at their smaller end and chains are sorted by their first point, the sampling fallback (no enclosure) now visits every leaf (`rigorous: false`) so nothing is missed and draft (6 px) is cheaper than final (2 px).
7. **Region filler** (CL 253, 256). Wholly covered supersampled leaves join the grid so neighbours merge into maximal rectangles (the half-plane is a handful of rectangles); leaves where two or more primitive boundaries meet keep sub-cell rectangles (CL 7 step 2). Isolated true points (`x^2 + y^2 <= 0`) are marked, also when the point is a leaf corner. Without an enclosure the fill tests every leaf corner once; borders then trace on the draft grid to stay inside the evaluation budget.

### Contested test

- `implicit.test.ts > CL6§5: a cusp is traced up to its tip`. The test also asserts `maxX > 3` for `y^2 == x^3` in the view `[-5, 5]^2`. Within that view `|y| <= 5` forces `x <= 25^(1/3) = 2.924`, so no correct trace can pass. The cusp tip itself is reached (nearest vertex to the origin is exactly the origin) and the curve extends to the view edge at `x = 2.924`. Doc line (curves-loci 6, Output, step 7): "Paths in pixel coordinates, markers, and a `complete` flag." and the goal: "a faithful drawing of `F(x, y) = level` in the view, including ... cusps." The curve is drawn faithfully; the assertion is wrong, not the tracer. Left failing for the tester to correct (`maxX > 2.9`).

### Readings of docs-silent points

- Continuous break: left as the tester read it (one path, no marker); implemented that way.
- "Sorted by first key" (CL 6 step 6): the API exposes no keys, so chains are sorted by first vertex (x, then y), as the test reads it.

### Performance observations (not part of this round)

- Without an enclosure the implicit tracer and the region filler now evaluate every leaf corner (about 110,000 evaluations at 600 x 600 and 2 px leaves, 80 to 100 ms), so the doc time targets (2 ms circle, 0.3 ms half-plane) are only reachable with the kernel's enclosures. With an enclosure the quadtree cost still follows the curve length.
- The `sin(1/x)` plot (no enclosure) still records a few hundred `jump`/`hole`/`openEnd` markers near 0; ink columns carry the oscillation, the markers are noise. Not asserted by any spec test.

## Findings round, second part (PLOT-SM-6, 7, 10 to 14)

Result: 15 of 16 findings fixed; the rest of PLOT-SM-13 is `to be implemented`. Lint and typecheck are clean and all 578 plot tests pass, with no test changed.

### Fixes, by file

- `region.ts`: leaf size by budget on the dense path; a crossing belongs to its grid edge and is corrected once and shared by both leaves; borders are linked from those crossings (`chainBorders`), with a second trace only for a margin the fill cannot see (an equality or `!=` curve, or a margin with no crossing in the fill); a margin that is exactly zero along one side of a leaf decides the leaf from its sign (`onGridLine`); the cap counts emitted output and is enforced once more on the finished output (`capOutput`).
- `implicit.ts`: leaf size by budget on the dense path.
- `param.ts`: the hole search has a budget share and stops at gap edges; maybe-defined boxes are split and touching boxes merged.
- `function.ts`: `stepIsFlat` probes are not clamped to the span; markers in ink columns are dropped.

### Choices where the docs are silent

- When the finished region output is over the cap, borders may keep up to 40% of it, rectangles come next, then sub-cell rectangles and edge polygons while there is room.
- A region corner where two margins cross leaves a gap of one leaf in the border.
- `packages/plot/test/fixer-scratch.test.ts` is an earlier scratch file. It is not committed.
