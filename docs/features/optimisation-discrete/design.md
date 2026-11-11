# Optimisation, discrete maths, financial and calculator commands: design

Status: draft for review. Follows `docs/design/formula-language-and-kernel.md` and the kernel, language and errors designs under `docs/features/`.

This folder holds four small command groups that share one need: answer a question by searching or iterating over the figure's values, with no symbolic engine. They are:

1. **Optimisation**: `Maximize`, `Minimize` (and `MaxValue`, `MinValue`).
2. **Discrete maths**: `ConvexHull`, `Hull`, `DelaunayTriangulation`, `Voronoi`, `MinimumSpanningTree`, `TravelingSalesman`, `ShortestDistance`, and a `Graph` value.
3. **Financial**: `Rate`, `Periods`, `Payment`, `FutureValue`, `PresentValue`.
4. **Scientific calculator group**: `Mean`, `SD`, `SampleSD`, `MAD`, `nPr`, `nCr`, `Binomial`, `BinomialDist`, `Normal`, and the calculator profile that exposes them.

Exact algebra (`Solve`, `Simplify`) is the symbolic area's job (`../cas/`). Where a command here can use it, the link is stated.

No GeoGebra code, text or names are used. Command names that are ordinary maths words are listed because teachers say them.

---

## 1. What the features do

### For the learner

- **Optimisation**: "Where is the area biggest?" Drag a slider, watch a measure change, then ask the machine for the best value and see it marked.
- **Discrete**: put down points and see their convex hull, the triangles that join near neighbours, the cells nearest to each point, the shortest network that joins them, and a short round trip through all of them. Build a small network of segments and find the shortest path between two places.
- **Financial**: how a loan, saving plan or mortgage behaves; change the rate with a slider and see the payment move.
- **Calculator**: a plain calculator for quick sums, fractions, combinations, averages and the normal and binomial distributions.

### For the teacher (the live AI voice)

- Ask for the optimum while speaking and mark it: `best = Maximize(A, w)`, then a point at the answer.
- Build a figure of points and give it structure in one line: `H = ConvexHull(S)`, `T = DelaunayTriangulation(S)`.
- Say "the shortest route is 12.4 long" with a number it got from the kernel (`Length(path)`), not an estimate.
- Work out a loan and speak the result: `m = Payment(0.04/12, 360, 250000)`.

### Sub-features

| # | Sub-feature | Phase |
|---|---|---|
| 1 | `Maximize`, `Minimize` of a number that depends on one slider or one point-on-path | 1 |
| 2 | Same for a function on an interval | 1 |
| 3 | `MaxValue`, `MinValue` (the optimum itself, not where it is) | 1 |
| 4 | Several variables (up to 4), constraints (`where`), all optima (`all`) | 2 |
| 5 | Exact optimum for algebraic targets (`exact`), through the symbolic layer | 2 |
| 6 | `ConvexHull` | 1 |
| 7 | `DelaunayTriangulation`, `Voronoi` | 1 |
| 8 | `MinimumSpanningTree` | 1 |
| 9 | `Graph` value, `ShortestDistance` | 1 |
| 10 | `TravelingSalesman` (exact for small sets, heuristic otherwise) | 1 |
| 11 | `Hull(points, r)` concave hull, `VoronoiCells` | 2 |
| 12 | `Rate`, `Periods`, `Payment`, `FutureValue`, `PresentValue` | 1 |
| 13 | `NPV`, `IRR`, loan table | 2 |
| 14 | `Mean`, `SD`, `SampleSD`, `MAD`, `nPr`, `nCr`, `Binomial`, `BinomialDist`, `Normal` | 1 |
| 15 | Calculator profile (command allow-list, exact/decimal display, angle mode, history) | 1 |

---

## 2. Commands, in our syntax

Conventions: `S` is a `List<Point>`; named arguments follow the core design (`from = 0`).

### 2.1 Optimisation

| Command | Forms | Returns |
|---|---|---|
| `Maximize` | `(target: Number, over: Number)`; `(target, over: Point)` where the point is a `PointOn`; `(target, [a, b, …])` up to 4 free Numbers; `(target, P: Point, from: Point, to: Point)` for a free Point in a box; `(f: Function, a: Number, b: Number)` | The optimising value, with the type of `over` (Number, Point, or `List<Number>`) |
| `Minimize` | same forms | same |
| `MaxValue`, `MinValue` | same forms | `Number`: the optimum value of `target` |

Named arguments for all four: `where: Bool` (a constraint; only places where it is true count), `from`, `to` (override the slider range), `samples: Number` (default 400 per variable, max 20,000), `all: Bool` (return every global optimiser as a list), `exact: Bool` (phase 2; uses the symbolic layer for algebraic targets).

Meaning: `Maximize(A, w)` finds the value of the free number `w`, within its slider range, that makes the number `A` (which depends on `w` through the figure) as large as possible. The result is a new number object; the slider `w` does not move. `MaxValue(A, w)` is `A` evaluated there.

### 2.2 Discrete maths

| Command | Forms | Returns |
|---|---|---|
| `Graph` | `(edges: List<Segment>)`: endpoints that coincide within 1e-9 of the figure scale are one vertex; weight is the length. `(S, pairs: List<List<Number>>)`: vertices and index pairs, optional `weights: List<Number>`. `(S)`: every pair of points joined (complete graph) | `Graph` |
| `ConvexHull` | `(S)` | `Polygon` (counter-clockwise, collinear boundary points dropped) |
| `Hull` | `(S)` same as `ConvexHull`; `(S, r: Number)` concave hull (phase 2) | `Polygon` |
| `DelaunayTriangulation` | `(S)` | `List<Polygon>` (the triangles) |
| `Voronoi` | `(S)`, with named `box = [x0, y0, x1, y1]` | `List<Segment>`: the cell edges, cut to the box (default: the points' bounding box grown by its own size on every side) |
| `VoronoiCells` (phase 2) | `(S)`, `box` | `List<Polygon>`: one cell per point, same order as `S` |
| `MinimumSpanningTree` | `(S)`: Euclidean; `(G: Graph)` | `List<Segment>` |
| `TravelingSalesman` | `(S)` | `Polygon`: a closed tour through every point once |
| `ShortestDistance` | `(G: Graph, from: Point, to: Point)`; `(edges: List<Segment>, from, to, weighted: Bool = true)`; `weighted = false` counts edges | `List<Segment>`: the path in order |

The length of a path or tour is `Length(path)`. The core design's `Length` gains a form `Length(List<Segment>)` that sums the lengths (section 11 lists this as a cross-area addition).

### 2.3 Financial

Cash flows follow the usual spreadsheet sign rule: money you pay out is negative, money you receive is positive. Interest `rate` is per period as a fraction (a monthly rate of 0.5 % is `0.005`).

| Command | Forms | Returns |
|---|---|---|
| `Rate` | `(nper, pmt, pv, fv = 0, atStart = false, guess = 0.05)` | the periodic rate |
| `Periods` | `(rate, pmt, pv, fv = 0, atStart = false)` | the number of periods |
| `Payment` | `(rate, nper, pv, fv = 0, atStart = false)` | the payment per period |
| `FutureValue` | `(rate, nper, pmt, pv = 0, atStart = false)` | the value after `nper` periods |
| `PresentValue` | `(rate, nper, pmt, fv = 0, atStart = false)` | the value now |

All five solve the same balance equation (section 6.1). Phase 2 adds `NPV(rate, flows: List<Number>)` and `IRR(flows, guess)` and `LoanTable(rate, nper, pv)`, which returns a table text.

### 2.4 Scientific calculator group

| Command | Forms | Notes |
|---|---|---|
| `Mean` | `(L: List<Number>)` | |
| `SD` | `(L)` | Standard deviation of the whole population (divide by n) |
| `SampleSD` | `(L)` | Divide by n-1 |
| `MAD` | `(L)` | Mean absolute deviation about the mean |
| `nCr` | `(n, k)` | Number of ways to choose `k` of `n`; exact |
| `nPr` | `(n, k)` | Number of ordered arrangements; exact |
| `Binomial` | `(n, k)` | Same value as `nCr` (the binomial coefficient) |
| `BinomialDist` | `(n, p, k)`: probability of exactly `k`; add `cumulative = true` for at most `k`; `(n, p)` returns the list of probabilities for k = 0 to n (n up to 10,000) | |
| `Normal` | `(mean, sd, x)`: probability of at most `x`; `cumulative = false` gives the density at `x` | |

The statistics and probability area owns the full set of such commands; this group is the part the calculator profile shows, with the forms above.

---

## 3. How GeoGebra does each

### 3.1 Maximize and Minimize

- Two forms: a dependent number with a free number that has a range (a slider), and a dependent number with a point that lies on a path.
- The command makes a private copy of the figure's construction state, changes the free object step by step, recomputes the dependent number after each step, and lets a one-dimensional extremum finder choose the next step. The result is a copy of the free object set to the best position.
- A guard flag stops the command from running inside itself. Without a range on the free number, the result is undefined.
- A comment in the code lists known issues: intermediate positions can leave traces in the graphics view, and recursion is awkward.
- Only one free object. No constraints. No report of whether the optimum is global or only local. The finder is a sampling-plus-refinement search whose limits are not exposed.

### 3.2 Discrete commands

- Each command takes a list of points (the shortest-path command takes a list of segments and two points, and a flag for weighted or unweighted). The output is a "locus" object: a set of connected drawing strokes, not a typed geometric value.
- Convex hull: a sorted-points scan (monotone chain). Delaunay triangulation: an incremental method written for large inputs (tens of thousands of points); duplicate points are ignored. Voronoi: built from the Delaunay triangles by taking the circumcentres. Minimum spanning tree: all pairs of points joined with their distances, then a library's tree algorithm. Shortest path: a graph library's Dijkstra. Travelling salesman: a local-search heuristic; no promise of the best tour.
- Graph vertices are the point *objects* of the segments: two segments are joined only if they share the same point object, not if their ends happen to coincide.
- A `Hull(list, number)` form exists in the command table but ignores the number and returns the convex hull.
- The results are drawn lines, so a student cannot ask for the area of a Voronoi cell or the length of the tour as a value without extra work.

### 3.3 Financial

- Five commands that mirror spreadsheet functions. All come from one balance equation. Payment, periods, present value and future value are solved directly; the rate has no direct solution, so it is found by a bracketing search around a starting guess with a final Newton polish, with 0.1 as a fallback.
- Undefined results for impossible inputs, no explanation.
- The code comment says the "type" flag is 0 for the start and 1 for the end of the period, while the formula it implements uses the flag the other way round (the usual spreadsheet convention, where 1 means the start). The documentation and behaviour are easy to mix up.

### 3.4 The calculator app

- The Scientific app is the same engine with a command allow-list: only nine named commands are visible there, and two of them (the binomial and normal distributions) are restricted to certain argument shapes. Everything else (geometry, graphing tools, most commands) is hidden by filters.
- The same pattern (a filter over one command table) is used for the Graphing, Geometry, Probability and CAS apps. Hidden does not mean absent: the commands are still in the engine.

### What is good and what to avoid

Good: one table of commands and a filter per app; spreadsheet-compatible financial formulas; a sampling-plus-refinement optimiser; Dijkstra and Delaunay as standard algorithms.
Avoid: the private-copy construction for optimising (slow, fragile, recursive), identity-based graphs, results that are only drawings, silent fallbacks, undefined with no reason, and comments that disagree with the code.

---

## 4. Shared kernel support: the slice

Optimisation, `Locus` and `Path` in the core design all need the same thing: "evaluate this target with this free value changed, without changing the figure". We make it one kernel service.

```ts
interface Slice {
  readonly sources: readonly ObjId[];            // free objects to vary
  readonly target: ObjId;                        // object read after each evaluation
  readonly chain: readonly string[];             // names of the objects that run, in order; empty when the target does not depend on the source
  run(values: Iterable<unknown>): Cell[];        // for each value: sets the source, runs only the rules between it and the target, returns the target's cell
}

interface KernelSlices {
  slice(sources: readonly ObjId[], target: ObjId): Slice | SliceError;
}
```

Rules:

- A slice runs on a scratch overlay: a map from object id to a temporary cell, over the committed cells. The figure, drawables and undo log never see it. Rules are pure (core section 2), so this is safe.
- The rules to run are the intersection of the sources' downstream lists and the target's upstream list, in `order`. The kernel works this out when `slice` is called and does not cache it; the area keeps the `Slice` it gets for as long as it needs it.
- A source must be free (`not_free` error otherwise). A target that does not depend on any source gives the error `no_dependency`.
- Cost target: under 2 microseconds per rule for number rules. A slice of 12 rules evaluates in under 30 microseconds, so 500 evaluations take about 15 ms in the worst case and about 3 ms for a typical short chain.
- A slice is valid only while the figure's structure is unchanged; the optimiser rule rebuilds it when its inputs change.

---

## 5. Optimisation: our design

### 5.1 The search

The search is an **anytime, resumable procedure** (a generator), not a blocking call. The kernel steps it in slices of at most 2 ms; at each slice end the best value so far is stored in the cell, flagged `refining`. If an upstream value changes, the job is cancelled and restarted warm.

One variable (a slider or a point-on-path parameter in a closed range `[lo, hi]`):

1. **Domain**: `lo`, `hi` from the slider's min and max, or `from`/`to`, or the path parameter range. A closed path (circle) is periodic, so the ends are one point and no endpoint effect exists. `lo >= hi`: the answer is `lo` with a notice. No range: undefined `unbounded` (detail: "give a, or set a range on the slider").
2. **Coarse sampling**: `samples` evenly spaced evaluations (default 400), plus the ends. Evaluations that are undefined, not finite, or that fail `where` are skipped. All skipped: undefined `infeasible`.
3. **Candidates**: the best sample, plus every local best in the sequence (a sample larger than both neighbours for `Maximize`), up to 6 candidates, in descending value.
4. **Refine** each candidate inside its bracket (the neighbouring samples) with a derivative-free bracket method: golden-section steps combined with parabolic interpolation, stopping when the bracket is under `1e-10 (hi - lo)` or after 100 steps. A smooth function can only be located to about the square root of machine precision (about 1.5e-8 relative) by value comparison alone; this is a property of the problem and the result states it (`xTol`). The optimum *value* is accurate to about 1e-15.
5. **Pick**: the best refined value. Ties within 1e-12 relative go to the smallest parameter, and the notice `multiple_optima` lists the others; with `all = true` the result is the list of them.
6. **Endpoints**: if the best is at an end of the range, the notice `at_boundary` is added. This matters for teaching: "the biggest area happens at the edge of what the slider allows."
7. **Warm start**: when the job restarts because an input changed, the previous optimiser's basin is refined first; if the new best differs from the old basin's best by less than 1e-9 relative, the old basin wins. This stops the answer flipping between two equal optima while a slider moves.

Several variables (2 to 4): the box is the product of ranges. A fixed-seed Latin-hypercube sample of `64 × k` points (k = number of variables), the best 8 as starts, a bounded Nelder-Mead from each (shrinking simplex, reflecting at the bounds), stop at simplex diameter under `1e-9` of the box size or 400 iterations per start. Pick as above. The seed comes from `rand` with a fixed constant, so results are reproducible.

Free Point in a box: the same N-dimensional search on `(x, y)`.

Function form `Maximize(f, a, b)`: the same 1-D search with `f(x)` as the evaluator (no slice needed). For polynomials, `exact = true` computes the critical points with the symbolic layer, includes the endpoints, and compares exactly; the result is exact and the notice `proved` is added.

### 5.2 Constraints and what "feasible" means

`where` is a Bool that depends on the same free objects. A trial value counts only if `where` is true. If the feasible set is disconnected, the sampling finds the pieces; refinement is clipped to the feasible brackets. An equality constraint is not supported directly (the feasible set has no width); the notice `where_is_thin` appears if fewer than 2 samples are feasible, and the hint explains how to eliminate a variable.

### 5.3 What is not guaranteed

- The result is the best of a dense sample refined locally. A feature narrower than one sample spacing can be missed. The result carries `global: 'sampled'`; exact mode carries `global: 'proved'`. The teacher is told to say "the largest I found" when the flag is `sampled` and a narrow feature is possible, and the notice `narrow_feature_possible` is set when the sampled values are not smooth (a second difference jump between neighbours larger than 100 times the median).
- A discontinuous target is searched like any other; the optimum can sit at a jump where the supremum is not attained. The notice `not_attained` appears when the best refined point is within one bracket of a detected jump.

### 5.4 Accuracy and speed

| Case | Accuracy | Time (typical) |
|---|---|---|
| 1 variable, smooth, 12-rule chain | x within 1e-8 relative; value within 1e-14 | under 3 ms |
| 1 variable, 400 samples, 100-rule chain | same | about 15 ms (sliced over frames) |
| 2 variables | x within 1e-7 | under 15 ms |
| 4 variables | x within 1e-6 | up to 120 ms (sliced) |
| exact polynomial | exact | under 20 ms |

### 5.5 Result types

- `Maximize(target, over: Number)` returns a Number (dependent: it updates when anything upstream changes).
- With a Point over a path it returns a Point at the best place (a free-standing point object).
- With a list it returns `List<Number>`.
- `all = true` returns a list of the above.

---

## 6. Financial: our design

### 6.1 The balance equation

For periodic rate `r`, number of periods `n`, payment `p`, present value `v`, future value `f`, and payment timing `s` (0 at the end of the period, 1 at the start):

```
v (1+r)^n  +  p (1 + r s) ((1+r)^n - 1) / r  +  f  =  0        (r != 0)
v + p n + f = 0                                                   (r = 0)
```

This is the spreadsheet convention; every result below follows from it by solving for one unknown. `atStart = true` means `s = 1`.

- `Payment`: `p = -(v (1+r)^n + f) r / ((1 + r s)((1+r)^n - 1))`.
- `FutureValue`: `f = -(v (1+r)^n + p (1 + r s)((1+r)^n - 1)/r)`.
- `PresentValue`: `v = -(f + p (1 + r s)((1+r)^n - 1)/r) / (1+r)^n`.
- `Periods`: `n = ln((p (1 + r s) - f r) / (p (1 + r s) + v r)) / ln(1 + r)`; for `r = 0`, `n = -(v + f)/p`.
- `Rate`: the unknown is inside a power; see 6.2.

### 6.2 Numerical care

- Compute `((1+r)^n - 1)/r` as `expm1(n log1p(r)) / r`, and use the series `n + n(n-1) r / 2 + …` when `|r| < 1e-8`, so that tiny rates do not lose digits.
- The rate must satisfy `r > -1`. Otherwise undefined `out_of_domain`.
- **Rate search**: define `g(r)` as the left side of the balance equation. Build a grid of 120 rates, log-spaced from 1e-8 to 10 on each side of zero and a few between -0.999 and -1e-8; evaluate `g`; collect sign changes; refine each by a bracketing method (Brent) to 1e-14 relative width; polish with one Newton step if it stays inside the bracket. With several roots (alternating cash flows), choose the one closest to `guess` (default 0.05) and add the notice `multiple_rates` listing the others. If `g` never changes sign and `|g|` is not near zero, undefined `no_root` with detail "all cash flows have the same sign" or "the payments cannot reach the target".
- **Periods**: if the log argument is not positive, undefined with detail: "The payment does not even cover the interest" (when the payment is smaller than `v r`) or "the target is on the wrong side". The reason code is `no_root`.
- **Large `n`** (up to 1e6) is fine; `(1+r)^n` overflow gives undefined `overflow`.
- **Fractional `n`** is allowed (spreadsheet behaviour); the notice `fractional_periods` is not emitted, because it is a normal use.
- **Warnings**: a periodic rate above 1 gets the notice `rate_looks_like_percent` (`0.05` is 5 %; `5` is 500 %).
- Rounding is never applied inside a rule. The text format `{m:2}` rounds for display.

Accuracy: relative error under 1e-12 on `Rate` for well-posed inputs; under 1e-14 on the closed forms. Time: under 0.05 ms for `Rate`.

### 6.3 Phase 2 additions

`NPV(rate, flows)`: sum of `flow_k / (1+rate)^k` for `k = 0…`, Neumaier-summed. `IRR(flows, guess)`: root search as in `Rate`. `LoanTable(rate, nper, pv)`: a Text table (period, payment, interest, principal, balance), with last-row rounding noted.

---

## 7. Discrete maths: our design

### 7.1 Value types and the Graph

```ts
type Value =
  | /* … existing … */
  | { t: 'Graph'; nodes: readonly Pt[]; edges: readonly { a: number; b: number; w: number }[] };
```

- `Graph(List<Segment>)` merges endpoints that differ by at most `1e-9 × scale`, where `scale` is the larger of 1 and the largest absolute coordinate. Vertices are numbered in order of first appearance.
- Vertex identity by **position**, not by object, so segments made independently but meeting at a corner still connect, and two points that merely overlap on screen but differ in value do not.
- `ShortestDistance(G, from, to)` needs `from` and `to` to be vertices: the nearest vertex within the same tolerance. Otherwise undefined `not_a_vertex` (detail: the nearest vertex and its distance).

### 7.2 Exact geometric tests

All of hull, Delaunay, Voronoi and MST use two predicates: `orient(a, b, c)` (which side of line `ab` the point `c` is on) and `inCircle(a, b, c, d)` (is `d` inside the circle through `a, b, c`). Both are evaluated with a floating-point filter, and when the result is within the filter's error bound, with exact arithmetic on the doubles (every double is an exact binary fraction, so BigInt arithmetic gives the exact sign). This removes the wrong or looping triangulations that near-degenerate inputs produce with plain floats.

### 7.3 Commands

**ConvexHull(S)**

1. Remove undefined points (the list is undefined if any is: the kernel's rule). Sort by x then y; drop exact duplicates.
2. Monotone chain with `orient`; collinear points are dropped.
3. Fewer than 3 distinct points, or all collinear: undefined `degenerate`, with `detail.suggest` offering `Segment(P, Q)` for the two extreme points.
4. Output: counter-clockwise starting at the lowest-leftmost vertex (stable under reordering of `S`).
Complexity `O(n log n)`; 10,000 points under 5 ms.

**DelaunayTriangulation(S)**

1. Remove duplicates (notice `duplicates_removed`).
2. Triangulate with an incremental or sweep-hull method using the exact `inCircle`. Library option in section 10.
3. Fewer than 3 distinct points or all collinear: undefined `degenerate`.
4. Four or more co-circular points make the triangulation non-unique; the choice is deterministic (smallest vertex indices win) and the notice `cocircular` is added.
5. Output: triangles as `Polygon`s, counter-clockwise, sorted by their smallest vertex index, so the list is stable while points move slightly.
Targets: 1,000 points under 8 ms; 10,000 under 60 ms; cap 20,000 (`limit`).

**Voronoi(S)**

1. From the Delaunay triangulation: circumcentres of triangles, joined across shared edges. Edges that go to infinity are cut at the box. The box is `box` if given, else the bounding box of `S` grown on each side by its own width or height (never the screen), so the figure does not change when the learner pans.
2. Output: `List<Segment>`.
3. Targets: 1,000 points under 15 ms.
`VoronoiCells` (phase 2) returns a polygon per site, so `Area(cell)` and shading work.

**MinimumSpanningTree**

- Euclidean: the minimum spanning tree is a subset of the Delaunay edges; run Kruskal's algorithm (sort the edges by length, union-find) on the Delaunay edge list. `O(n log n)`. For all points collinear, sort and chain. For up to 3 points the answer is direct.
- Graph: Kruskal on the given edges; a disconnected graph gives a minimum spanning forest and the notice `disconnected` with the component count.
- Ties are broken by (weight, smaller vertex index, larger vertex index), so the tree is the same each frame.
- Output: `List<Segment>`.
- Targets: 1,000 points under 12 ms.

**ShortestDistance**

- Dijkstra with a binary heap on the graph. Non-negative weights are guaranteed (lengths, user weights checked: negative weight is an error at `Graph(…, weights = …)`).
- Unweighted: breadth-first search, edges count 1.
- No path: undefined `no_path` with the two component sizes.
- Output: the path as `List<Segment>` in order. `Length(path)` is the total.
- Targets: 10,000 edges under 5 ms.

**TravelingSalesman(S)**

- Up to 12 points: exact dynamic programming over subsets (about `n² 2^n` steps, 600,000 for 12), under 10 ms. 13 to 15 points: the same, sliced over frames (up to 60 ms).
- More points: a deterministic heuristic: nearest-neighbour start from the lowest-index point, then 2-opt with neighbour lists, then Or-opt, until no improving move or until the time slice budget is spent (cap 2,000 points). Typically within a few percent of the best tour for random points; no guarantee, and the result carries `optimal: false`.
- Output orientation and start are fixed: start at the lowest index; go first to the neighbour with the lower index. So the polygon does not flip while points move slightly.
- A tour with fewer than 3 points is undefined `degenerate`.
- The output is a `Polygon`; a heuristic tour for clustered input can cross itself, in which case `Area` of the polygon is not meaningful and the notice `self_crossing` is set.

**Hull(S, r)** (phase 2): the concave hull as an alpha shape built from the Delaunay triangulation: keep triangles whose circumradius is at most `r`, take the outer boundary. `r` large gives the convex hull. If the kept triangles form several separate pieces, undefined `disconnected_hull` with the count.

### 7.4 Drawing

All outputs are standard typed values (Polygon, List of Segment), so they use the standard drawables, styles and layers. There is no special "stroke set" object. A group of segments in a list draws with one style; hover highlights the whole list.

### 7.5 Dragging

Hull, triangulation, Voronoi and MST recompute from scratch on each change of `S` (they are fast enough). Output ordering is canonical (section 7.3) so changes between frames are small and an animation looks continuous.

---

## 8. Scientific calculator group: our design

### 8.1 Number rules

- `nCr(n, k)`, `nPr(n, k)`, `Binomial(n, k)` take whole numbers `0 <= k <= n` (undefined `out_of_domain` otherwise, with detail "k must be between 0 and n"). They are computed exactly with BigInt (multiplicative formula with the smaller of `k` and `n-k`). The result is a Number when it is at most 2^53; above that it is an exact `Expr` integer (the symbolic layer's type) and the Number view shows it as `1.234e25 ≈`. `n` up to 100,000 is allowed; above, `limit`.
- `Mean(L)`: Neumaier-compensated sum divided by the count. `SD(L)` and `SampleSD(L)`: two-pass (mean, then sum of squared deviations), compensated. `MAD(L)`: the mean of `|x - mean|`.
- Empty list: `empty_list`. `SampleSD` of one value: `degenerate` with detail "needs at least two values".
- `BinomialDist(n, p, k)`: `p` in `[0, 1]`. The probability mass is computed in log space with a log-gamma (Lanczos) for large `n`, directly by a multiplicative recurrence from the mode for `n` up to 1,000; the cumulative form sums outward from the mode, or for `n` above 1,000 uses the regularised incomplete beta function (continued fraction). Relative error under 1e-12. `n` up to 1e6.
- `BinomialDist(n, p)`: the list of all `n + 1` probabilities (sums to 1 within 1e-12; the last is set so that the sum is exact to rounding).
- `Normal(mean, sd, x)`: cumulative probability through the complementary error function with a published rational approximation with relative error under 1e-15; `sd > 0` (else `out_of_domain`). Density form: `exp(-z²/2) / (sd √(2π))`.

### 8.2 The calculator profile

An app is a **profile**: data over the same kernel.

```ts
interface AppProfile {
  readonly id: 'scientific' | 'graphing' | 'geometry' | 'cas' | 'probability' | 'classic';
  readonly commands: { allow: readonly string[] | 'all'; formsOnly?: Record<string, readonly string[]> };
  readonly views: readonly ('figure' | 'cas' | 'calc' | 'table' | 'text')[];
  readonly numbers: { display: 'exact-first' | 'decimal'; digits: number; angle: 'rad' | 'deg' };
  readonly input: { transforms: readonly string[]; keyboard: string };   // e.g. angle suffix, fraction template
  readonly figure: { objectsAllowed: readonly string[] | 'all' };
}
```

The scientific profile:

- `commands.allow`: the nine commands above plus all built-in functions, constants and the symbolic `Evaluate`, `Numeric`, `Rationalize`, `MixedNumber`.
- `commands.formsOnly`: `Normal` and `BinomialDist` with the forms in section 2.4.
- `views`: `['calc']`. No figure.
- `numbers`: `display: 'exact-first'` (the `S⇔D` button in the UI toggles between exact and decimal), `digits: 10`, `angle: 'deg'`.
- `input.transforms`: `angle-suffix`: in degree mode a bare argument to `sin cos tan` gets the `deg` suffix in the saved line (`sin(30)` is stored as `sin(30deg)`), so a script never depends on a hidden mode.
- The filter hides the others; a hidden command is `unknown_command` with `hint` "not available in the calculator; open the Graphing profile".

The same profile type serves the other apps (a graphing profile hides conics and CAS commands, and so on). This is outside this area's scope; the type is defined here because the scientific profile is the first user.

### 8.3 Calculator history

The calc view is a list of lines, each a normal object line `r1 = 3/4 + 1/6`, so the history is a script, undo works, and the teacher can write rows. `ans` is a view helper that inserts the previous row's name; it is not a kernel name.

---

## 9. Better than GeoGebra

1. **Optimisation without mutating anything.** A slice evaluates the target on a scratch overlay: no private copy of the figure, no traces, no recursion guard, no flicker, and it also serves Locus.
2. **Honest about quality.** The result says whether the optimum was proved or sampled, whether it sits at the boundary, whether several optima tie, and the achievable accuracy.
3. **More forms.** Several variables, constraints, all optima, function form, exact mode.
4. **Anytime.** Heavy searches show a best-so-far result and refine; dragging cancels and warm-starts.
5. **Robust geometry.** Exact predicates make hull and triangulation correct for near-degenerate inputs.
6. **Typed outputs.** Polygons and segment lists instead of drawn strokes: area of a cell, length of a tour, shading, all become one line.
7. **Position-based graphs.** Segments connect where they meet, however they were made.
8. **Exact tours for small sets** and a stable orientation for large ones.
9. **Reasons.** `degenerate`, `no_path`, `not_a_vertex`, `unbounded`, `infeasible`, `no_root` each with a sentence.
10. **Financial results explained.** An impossible loan says why ("the payment does not cover the interest"), and a rate typed as a percent is flagged.
11. **Calculator without a second engine.** A profile (data) over the same kernel, with explicit rewritten lines instead of hidden angle modes.

---

## 10. Libraries

Checked 2026-11-10.

| Need | Library | Licence (as checked) | Verdict |
|---|---|---|---|
| Delaunay triangulation | Delaunator | ISC (licence file read) | Fits: small, fast, widely used. Requires keeping the copyright notice. We can use it for `DelaunayTriangulation`, `Voronoi` and Euclidean MST, with our own output ordering on top. |
| Exact orientation and in-circle | robust-predicates | Unlicense (public-domain dedication, licence file read) | Fits. Use for the predicates in section 7.2. |
| Convex hull | none | n/a | Write it: 40 lines with the exact predicate. |
| Graph search (Dijkstra, Kruskal) | none | n/a | Write them: each under 60 lines with a binary heap and union-find. |
| TSP | none | n/a | Write: Held-Karp and 2-opt/Or-opt are short and need the deterministic orientation rules above. |
| Optimisation | none | n/a | Write: the 1-D bracket method and bounded Nelder-Mead are short; ours must be resumable, which off-the-shelf minimisers are not. |
| Special functions (log-gamma, incomplete beta, erfc) | none vetted | n/a | Write from published approximations; test against high-precision tables. |

---

## 11. Plugging into the kernel and the command table

- Each command is a `CommandSpec` with `group: 'optimisation' | 'discrete' | 'financial' | 'calculator'`. Their `rule` factories are pure; the optimiser rules are **resumable** and so are registered with `heavy: 'sliced'` (the cell may be `pending` or `refining`, as in the CAS design).
- `Maximize`'s `over` parameter has the table type `FreeNumber | PointOn`, so the checker rejects dependent numbers with the kernel's `not_free`.
- The `slice` service (section 4) is a kernel addition (section 13).
- `Length(List<Segment>)` is added to the Length command (cross-area, shapes and measures).
- `Polygon` outputs from `ConvexHull`, `DelaunayTriangulation` and `TravelingSalesman` use the existing Polygon type.
- `Graph` is a new value type with a drawable (vertices as small points, edges as segments, weights as optional labels).

---

## 12. Edge cases

- `Maximize` where the target is constant: any value is optimal; the result is the first sample and the notice `flat_target`.
- Target undefined at the optimum bracket only: skipped; the notice `holes_in_target` lists the share skipped.
- Slider with step: the search ignores the step (continuous). The result is the continuous optimum, and the notice `off_step` says the nearest slider step is `s` (value there is shown); `snap = true` asks for the best step value instead (discrete search over the grid).
- Hull of points with one far outlier: normal.
- Delaunay with NaN: impossible (undefined points make the list undefined).
- Voronoi with 2 points: one segment (the perpendicular bisector), cut to the box.
- MST of 1 point: empty list; of 0: `empty_list`.
- TSP with duplicate points: allowed; zero-length edges.
- ShortestDistance where `from == to`: an empty path, length 0.
- `Rate` with all-zero inputs: `no_root`.
- `Payment` with `nper = 0`: `division_by_zero` (reason), detail "no periods".
- `nCr(1e6, 5e5)`: `limit`.
- `Normal` with `x` very far (`|z| > 40`): returns 0 or 1 exactly, no error.
- A graph with 100,000 edges: allowed; above, `limit`.

---

## 13. Changes to the core design

1. **Kernel service `slice`** (section 4): evaluate a target while varying free sources on a scratch overlay. `Locus` and `Path` (core 7.5) should use it too. Reason: one tested mechanism instead of three.
2. **Value type `Graph`** (section 7.1).
3. **Command table field `heavy: 'sliced'`** and the cell flag `refining` (a defined cell whose value is the best so far). Shared with the symbolic design's `pending`. Reason: some rules are search procedures that should not run in one go inside the 1 ms apply budget.
4. **Undefined reasons added**: `unbounded`, `infeasible`, `degenerate` (already in the list), `no_path`, `not_a_vertex`, `disconnected_hull`.
5. **Length gains `Length(List<Segment>)`** (cross-area).
6. **App profile type** (section 8.2). Reason: apps become data; the scientific profile is the first.
7. **Core section 6.6 actions**: none added; `Length` on lists covers the need.
8. **Section 1 "Not in v1"**: nothing changes; these groups are small enough for v1.

---

## 14. Acceptance tests

1. Optimisation: for 200 generated smooth targets with known optima, `Maximize` finds x within 1e-7 relative and the value within 1e-13; for 50 multimodal targets, the global optimum is found at 400 samples when the features are wider than 1/200 of the range; the notice flags are correct.
2. Slice: evaluating a target through a slice equals recomputing the figure with the sources changed, for 10,000 random figures and values; the figure is untouched afterwards.
3. Hull, Delaunay, Voronoi: against a brute-force oracle on small random sets, including grids, circles of points, collinear subsets, duplicates; no invalid triangulations (empty-circle property verified exactly).
4. MST: equals Prim's result total length on random sets; total weight identical, tie-breaks stable.
5. Dijkstra: equals a Bellman-Ford oracle on random graphs.
6. TSP: exact equals brute force for n up to 9; heuristic within 10 % of the exact tour for random n = 12 and always a valid permutation.
7. Financial: closed forms agree with a spreadsheet's published results on 100 reference cases; `Rate` round-trips: `Payment(Rate(...), …)` reproduces the payment to 1e-10.
8. Calculator: exact binomials against BigInt references; `BinomialDist` sums to 1; `Normal` against high-precision table values to 1e-14.
9. Frame time: dragging a point in a 1,000-point Delaunay figure keeps frames under 16 ms with the heavy rules sliced.

---

## 15. Open questions

1. Should `Maximize` also accept an `over` that is a dependent number and walk up to its free parents? Current answer: no, `not_free` with a suggestion.
2. Should the financial `rate` accept `5%` literals? Depends on the language area's percent literal.
3. Is a concave hull worth phase 2, or should `Hull(S, r)` be left out until a lesson needs it?
4. Should TSP expose the computed tour length as a field of the result?

---

## Sources studied

GeoGebra source (read only, commit 3608374), under `source/shared/common/src/main/java/org/geogebra/common/`:

- `kernel/advanced/` (optimiser classes and commands for Maximize and Minimize; the financial algorithm and its five commands)
- `kernel/optimization/` (extremum finder, fit helper)
- `kernel/discrete/` including `delaunay/`, `geom/` and `tsp/` (hull, triangulation, Voronoi, spanning tree, shortest distance, tour)
- `kernel/commands/` (command table groups, `filter/` and `selector/` for per-app command filters)
- `main/settings/config/` (Scientific app configuration)

Manual pages (not readable in the fetch tool; behaviour taken from the source and command tables): https://geogebra.github.io/docs/manual/en/commands/ groups "Optimization Commands", "Discrete Math Commands", "Financial Commands", and the Scientific Calculator pages.

Licence checks: https://github.com/mapbox/delaunator (ISC, licence file read), https://github.com/mourner/robust-predicates (Unlicense, licence file read).
