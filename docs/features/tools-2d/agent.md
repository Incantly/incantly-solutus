# 2D tools: how the model uses them

The model does not click tools. It writes the lines a tool would have written. This file covers three things: the construction recipes the model needs (one line each, same as the tool's output), the events it receives when the learner uses a tool, and how it points a learner at a tool.

## 1. What the model gets

### 1.1 Recipe catalogue (about 140 tokens)

A short block telling the model which command each classic construction uses, so it does not invent a form. It sits with the command catalogue.

```text
Constructions:
 midpoint            M = Midpoint(A, B)
 perpendicular       l = Perpendicular(A, m)            parallel   l = Parallel(A, m)
 perp. bisector      l = Bisector(A, B)                 angle bisector  l = Bisector(A, B, C)
 circle              Circle(O, P) | Circle(O, r) | Circle(A, B, C)
 compass             c = Circle(C, Distance(A, B))      (radius copied from A–B)
 fixed-length seg    c = Circle(A, 3)  B = PointOn(c, 0)  s = Segment(A, B)  Hide(c)
 image of a shape    A_1 = Reflect(A, l) | Rotate(A, angle, O) | Translate(A, v) | Dilate(A, k, O)
 tangent             Tangent(f, x0) for functions; Tangent(P, c, 1) for conics
 measure             d = Distance(A, B)  α = Angle(A, V, C)  s = Area(p)
```

Names: points capital, others lowercase; images of A are `A_1`. The model does not need a tool list; the list of tools is for the learner. The model is only told the tool ids when it wants to point at one (section 3).

### 1.2 What the tool id list is for

The catalogue builder can print the tool table as `circle-three-points: pick A, B, C -> Circle(A, B, C)`, about 15 tokens per tool, 1,100 tokens for all 75. We do **not** send it by default. It is available on request (`figure` with `tools: true`) when a lesson is about how to construct something with the tools.

## 2. Events from the learner's tools

The learner's tool use arrives as an event the model sees at the start of its next turn, with the names and lines the tool wrote:

```json
{
  "event": "learner_lines",
  "tool": "circle-three-points",
  "lines": ["C = (2, 1)", "c = Circle(A, B, C)"],
  "created": [
    { "name": "C", "type": "Point", "summary": "(2, 1)" },
    { "name": "c", "type": "Circle", "summary": "centre (0.5, 0.5), radius 1.6" }
  ],
  "undefined": []
}
```

When the learner's construction is degenerate:

```json
{
  "event": "learner_lines",
  "tool": "intersect",
  "lines": ["X = Intersect(l, m, 1)"],
  "created": [{ "name": "X", "type": "Point", "summary": "undefined" }],
  "undefined": [{ "name": "X", "reason": "parallel" }]
}
```

Rules the model follows:

- Talk about what the event says. Do not assume a tool was used in a way the lines do not show.
- Do not rename the learner's objects.
- To build on the learner's construction, use their names.
- If the event shows an undefined object, say the reason in plain words (it is in `reason`); do not blame the learner.
- Events are batched when several arrive within 700 ms; the model gets one list.

Other learner events (from graphics-view): `learner_moved`, `learner_selected`, `learner_view`.

## 3. Pointing at a tool

When the lesson asks the learner to do the construction, the teacher says the instruction and can point at the tool:

```text
Suggest(circle-three-points)
```

`Suggest(toolId)` is an action (no object, not saved in the figure). It pulses the toolbar button and shows the first hint ("Click three points"). It returns:

```json
{ "ok": true, "tool": "circle-three-points", "hint": "Click three points" }
```

Unknown id: core-format error `unknown_name` with `closest`. It lists the group if no near match exists. Cost: about 25 tokens in the catalogue.

## 4. Worked lesson snippets

### 4.1 The teacher builds, then hands over

Teacher says: "A circle needs a centre and a point on it. Here is the centre."

```text
O = (0, 0)
A = (2, 0)
c = Circle(O, A)
```

Results: three `ok`. Teacher: "Now it's your turn: draw another circle through three points." and calls `Suggest(circle-three-points)`.

The learner builds three points and a circle; the next turn starts with:

```json
{ "event": "learner_lines", "tool": "circle-three-points",
  "lines": ["B = (-1, 1)", "C = (1, 2)", "D = (3, 0.5)", "d = Circle(B, C, D)"],
  "created": [ ... ], "undefined": [] }
```

Teacher: "Your circle d goes through B, C and D. Drag one and watch the centre move." It draws the centre so the learner sees it:

```text
Z = Center(d)
Z with color = orange, label = name
```

### 4.2 Recovering from an error

Teacher says: "The perpendicular bisector of AB is the line of points the same distance from both."

```text
m = Bisector(A, B)
n = Bisector(A, B, 1)
```

Second line returns `no_matching_form` with forms `Bisector(Point, Point)` and `Bisector(Point, Point, Point)`. The teacher's next call is:

```text
Hide(n)
```

and it says only: "The line m is exactly halfway between A and B." It does not mention the failed line.

### 4.3 Degenerate learner construction

Event: `learner_lines` with `undefined: [{ name: "c", reason: "collinear" }]`.

Teacher says: "Those three points are in a straight line, so no circle goes through all of them. Drag one off the line and the circle appears." No lines needed.

### 4.4 Building a tool-like construction quickly

Teacher says: "Copy the length AB onto the new centre with a compass."

```text
C = (4, 1)
c = Circle(C, Distance(A, B))
c with color = blue, dash = dashed
```

## 5. Token budget

| Entry | Tokens |
|---|---|
| Recipe catalogue (1.1) | 140 |
| Learner event handling rules (2) | 90 |
| `Suggest` entry | 25 |
| **Total always sent** | **~255** |
| Full tool table (on request) | ~1,100 |

## 6. How the model fixes errors from this area

Refusals from tools do not reach the model (the learner sees them). Line errors from the model's own lines follow the core flow: use `forms` and `hint`, retry at most twice per line, then continue and describe only what was drawn. Common ones in this area:

| Error | Fix |
|---|---|
| `no_matching_form` on `Circle`, `Angle`, `Bisector` | Read `forms`; choose the one with the right argument count |
| `unknown_command` on a construction name the model remembered from elsewhere | Use the recipe catalogue |
| `unnamed_object` | Add a name on the left |
| `type_change` on redefining a point as a line | `Delete` then define again |
| Undefined `Intersect` | Say the reason (`parallel`, `no_intersection`); do not keep re-drawing |

## 7. As built

- The catalogue is `TOOLS` in `packages/ui/src/tools/catalog.ts`; `catalogText()` prints one line per tool for the
  prompt. Deferred tools and the reason are in `DEFERRED`.
- A tool writes the same lines a model would: `G = (-3, 2)`, `d = Circle(A, G, C)`. New points come first. Names follow
  design 5.7: `A`… for points, `l, m, n` for lines, `c, d, k` for circles, `α, β` for angles, `poly1` for polygons.
- Tangents from a point write one `List<Line>` (`L = Tangent(A, c)`); roots and extrema one list over the view.
- Hidden objects are `with visible = false`.
