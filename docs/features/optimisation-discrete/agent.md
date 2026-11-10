# Optimisation, discrete, financial, calculator: how the model uses them

## 1. Catalogue entries

Four groups, loaded independently.

### 1.1 Optimisation (loads when the plan says best, biggest, smallest, maximum, minimum, optimal)

```text
best = Maximize(A, w)                   w: free Number with a slider range; A depends on w. Returns the w that makes A largest
best = Minimize(L, P)                   P: a PointOn point; returns the best position as a Point
best = Maximize(A, [w, h])              up to 4 free Numbers -> List<Number>
best = Maximize(f, a, b)                best x of a Function f on [a, b]
top = MaxValue(A, w)   low = MinValue(A, w)       the optimum value itself
options (named): where = (cond)  from = a  to = b  samples = 400  all = true  exact = true
```

Budget: about 190 tokens. Rule sentence (30 tokens): "The result is the value of the free number, not the optimum; use MaxValue for the optimum. Say 'the largest I found' when the notices say `narrow_feature_possible`."

### 1.2 Discrete (loads for hull, triangulation, nearest, network, shortest route, tour)

```text
S = [A, B, C, D, E]                     a list of points
H = ConvexHull(S)                       Polygon around all points
T = DelaunayTriangulation(S)            List<Polygon>, triangles of near neighbours
V = Voronoi(S)                          List<Segment>, edges of the cells nearest to each point (optional box = [x0, y0, x1, y1])
M = MinimumSpanningTree(S)              List<Segment>, shortest network joining all points
R = TravelingSalesman(S)                Polygon, a closed tour through every point
G = Graph([s1, s2, s3])                 network from segments that meet at their ends; Graph(S, [[0,1],[1,2]]) from index pairs
P = ShortestDistance(G, A, F)           List<Segment>, the path from A to F; Length(P) is its length
```

Budget: about 260 tokens. Rule sentences (50 tokens): "Outputs are ordinary polygons and segment lists; use Area and Length on them. The tour is exact up to 12 points, otherwise a good heuristic: say 'a short tour', not 'the shortest', when the notice says `heuristic`."

### 1.3 Financial (loads for loan, mortgage, saving, interest, instalment)

```text
r = 0.04 / 12                           rate per period, as a fraction (5% is 0.05)
m = Payment(r, 360, 250000)             payment each period (negative: money out)
n = Periods(r, -1500, 250000)           number of periods
i = Rate(360, -1200, 250000)            rate per period
f = FutureValue(r, 120, -200)           value after 120 periods of saving 200
v = PresentValue(r, 120, -200)          what the payments are worth now
options (named): fv = 0  pv = 0  atStart = false
```

Budget: about 150 tokens. Rule sentence (40 tokens): "Money you pay is negative, money you receive is positive. Rates are per period: divide a yearly rate by the periods per year."

### 1.4 Calculator (loads in the calculator profile, or for averages and counting)

```text
Mean(L)   SD(L) population   SampleSD(L)   MAD(L) mean absolute deviation
nCr(n, k)   nPr(n, k)   Binomial(n, k)
BinomialDist(n, p, k)   BinomialDist(n, p, k, cumulative = true)   BinomialDist(n, p) list of all probabilities
Normal(mean, sd, x)   Normal(mean, sd, x, cumulative = false)
```

Budget: about 130 tokens.

## 2. Lines the model writes

Best rectangle with a fixed perimeter:

```text
w = 3 in 0.5..9.5 step 0.1
R = Polygon((0, 0), (w, 0), (w, 10 - w), (0, 10 - w))
A = Area(R)
best = Maximize(A, w)
top = MaxValue(A, w)
B = (best, top)
```

Tour of points:

```text
S = [(0, 0), (4, 1), (5, 5), (1, 4), (2, 2)]
T = TravelingSalesman(S)
len = T.perimeter
```

The `.perimeter` field of the closed tour polygon is the tour length. For paths from `ShortestDistance` use `Length(List<Segment>)`.

Shortest path:

```text
A = (0, 0)
B = (3, 0)
C = (3, 2)
D = (0, 2)
s1 = Segment(A, B)
s2 = Segment(B, C)
s3 = Segment(C, D)
s4 = Segment(A, D)
s5 = Segment(A, C)
G = Graph([s1, s2, s3, s4, s5])
P = ShortestDistance(G, B, D)
d = Length(P)
```

Loan:

```text
rate = 0.06 / 12 in 0..0.02 step 0.0005
pay = Payment(rate, 240, 150000)
Readout("monthly payment", -pay)
```

## 3. What `draw` gives back

```json
{ "line": 4, "ok": true, "name": "best", "type": "Number", "value": "5.0000",
  "meta": { "global": "sampled", "xTol": 1e-8, "atBoundary": false, "optima": 1 } }
{ "line": 5, "ok": true, "name": "top", "type": "Number", "value": "25.0000" }
{ "line": 2, "ok": true, "name": "T", "type": "Polygon", "value": "closed tour, 5 vertices, length 17.38", "meta": { "optimal": true } }
{ "line": 3, "ok": true, "name": "H", "type": "Polygon", "value": "hull with 4 of 7 points, area 31.5" }
{ "line": 9, "ok": true, "name": "P", "type": "List<Segment>", "value": "path B -> C -> D, 3 segments, length 5" }
{ "line": 2, "ok": true, "name": "pay", "type": "Number", "value": "-1074.65" }
```

The model reads `meta` to choose its words: `global: sampled` and `narrow_feature_possible` mean "the largest I found"; `global: proved` means "the largest"; `atBoundary: true` means "at the edge of the slider range"; `optimal: false` means "a short tour"; `optima: 2` means "two places tie".

Undefined results come with `reason` and `detail.text` (see `errors.md`).

## 4. Fixing errors

| Error | Fix |
|---|---|
| `no_dependency` | Use the free number the target depends on (in `suggest`) |
| `not_free` | Use the free parent |
| `missing_range` | Add the range in the same `draw` call before resending |
| undefined `degenerate` | Add points; do not describe a hull that is not there |
| undefined `no_path` | Add a segment joining the parts, or say the two places are not connected |
| undefined `no_root` for a loan | Raise the payment as suggested, or say that no rate exists |
| `rate_looks_like_percent` | Divide the rate by 100 and resend |
| undefined `infeasible` | Drop the `where`, or say that nothing satisfies it |

## 5. The live teacher: worked snippets

### 5.1 The biggest rectangle

> "You have a fence of twenty metres. What rectangle holds the most grass?"

```text
w = 3 in 0.5..9.5 step 0.1
R = Polygon((0, 0), (w, 0), (w, 10 - w), (0, 10 - w))
A = Area(R)
Readout("area", A)
```

> "Drag the width. Notice the area goes up and then down."

(The learner drags; the `show_me` tool is not needed.)

> "Let's ask where it peaks."

```text
best = Maximize(A, w)
M = (best, MaxValue(A, w))
```

`draw` returns `best = 5`, `meta.atBoundary = false`, `global = sampled`.

> "It peaks at a width of five, which is a square. The largest area I found is twenty-five."

(Says "I found" because the flag is `sampled`.)

### 5.2 Recovering from a slider with no range

> "Let's find the best angle for the throw."

```text
a = 30deg
R = 100 * sin(2 a) / 9.8
best = Maximize(R, a)
```

(The teacher defined `a` as a plain number with no range.)

`draw` returns `missing_range` with `suggest: ["a with min = 0, max = 90deg"]`.

> "I need to give the angle limits first: zero to ninety degrees."

```text
a with min = 0deg, max = 90deg
best = Maximize(R, a)
```

`draw` returns `best = 45deg`.

> "Forty-five degrees gives the longest throw."

### 5.3 Nearest-neighbour regions

> "Here are four towns."

```text
S = [(1, 1), (6, 2), (3, 6), (7, 7)]
```

> "Every spot on the map is closest to one of them. The lines show where the closest town changes."

```text
V = Voronoi(S)
```

> "Now the roads: the shortest set of roads that joins every town."

```text
M = MinimumSpanningTree(S)
len = Length(M)
Readout("road length", len)
```

> "It takes about eleven and a half units of road."

### 5.4 A tour, and being honest about it

> "A delivery van must visit all of these shops and come back."

```text
shops = [(0, 0), (4, 1), (5, 5), (1, 4), (2, 2), (6, 3), (3, 6), (7, 6), (8, 1), (0, 5), (5, 0), (9, 4), (1, 8), (6, 8)]
T = TravelingSalesman(shops)
```

`draw` returns `meta.optimal: false` (14 points but the sliced exact search has not finished yet) then, after settle, `optimal: true`.

> "This is a short tour. I'll let it settle... yes, it's the shortest possible one."

(Only says "shortest possible" after `figure` shows `optimal: true`.)

### 5.5 A mortgage with a slider

> "Suppose you borrow a hundred and fifty thousand over twenty years."

```text
rate = 0.06 / 12 in 0..0.01 step 0.0005
pay = Payment(rate, 240, 150000)
Readout("monthly payment", -pay)
Readout("total paid", -pay * 240)
```

> "Drag the rate and see how much more you pay each month."

## 6. Events from the learner

Drag a free point of `S` and the report lists changed objects (`H`, `T`, `V`, `M`) with their new short summaries. If `Maximize` is `refining`, the report says so and the teacher waits for the next `figure` before quoting its value.

## 7. Rules of thumb

1. `Maximize` returns where, `MaxValue` returns how much.
2. Read `meta`; do not say "the largest" unless `global` is `proved`.
3. A hull needs three points not in a line; a tour needs three; a triangulation needs three.
4. Rates are per period fractions; money out is negative.
5. For path questions, build a `Graph` first; do not draw the path yourself.
6. Use `Length` on results; do not compute lengths by hand.

## 8. Prompt size

Optimisation 220 tokens, discrete 310, financial 190, calculator 130: about 850 for all four, loaded on demand (usually one or two groups).
