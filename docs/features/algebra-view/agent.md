# Algebra view and input bar: how the model uses it

The model never types into the bar or clicks rows. It uses `draw` and `figure`, and the learner sees the effect in the Algebra view. This file defines what the model gets from the view layer, how it controls what the learner sees, and how it talks about the list.

## 1. What the model can do

| Goal | Lines |
|---|---|
| Create an object the learner can read | Any define line; the row appears at the end of the list (creation order) |
| Create a slider | `a = 3 in 0..10 step 0.5` |
| Add a slider to an existing free number | `a in 0..10` |
| Hide a helper object from the list | `M with aux = true` |
| Hide an object on the canvas but keep its row | `Hide(M)` |
| Show an object's definition only, without the value (a puzzle) | `d with algebra = definition` |
| Show the description only | `d with algebra = description` |
| Set rounding for the lesson | `@algebra round 3` |
| Choose list order | `@algebra sort type` |
| Restrict what a learner may type | `@algebra input Midpoint Segment` |
| Rename an object | `Rename(A, "P")` |
| Read what the learner sees | `figure` (with `names` or `type` filter) |

The `@algebra` directives are part of the film's script; they take effect at the beat where they appear.

## 2. Results the model gets

### `draw` per-line result

```json
{ "ok": true, "line": 1, "name": "m", "type": "Number",
  "summary": "m = (B.y − A.y)/(B.x − A.x) = 1.33",
  "warnings": [], "undefined": [] }
```

The `summary` string is exactly the row text (`summarize`). Rules: `name = value` for free values; `definition = value` for dependent numbers; `name = Command(args) → value` for command results; `name = undefined (reason)` when undefined; truncated at 80 characters.

A line that created more than one object (`A, B = Intersect(c, d)`) returns `names: ["A", "B"]` and one summary per name.

A redefinition returns `"redefined": true` and the old summary in `was`, so the model can describe the change: "the point moved from (1, 2) to (1, 5)".

### `figure` result

```json
{ "objects": [
  { "name": "A", "type": "Point", "def": "A = (1, 2)", "value": "(1, 2)", "visible": true, "aux": false },
  { "name": "s", "type": "Segment", "def": "Segment(A, B)", "value": "5", "visible": true, "aux": false },
  { "name": "h", "type": "Number", "def": "h = √(a² + b²)", "value": "—",
    "undefined": { "reason": "input_undefined", "cause": "b" }, "visible": true, "aux": false }
] }
```

Per object about 15 tokens. Filters: `names: ["A", "s"]` or `type: "Point"` or `undefined: true`. The model uses `undefined: true` after a batch to check for unintended gaps.

## 3. Catalogue entries owned by this area

One-liners given to the model (they belong with the language card; about 90 tokens in all):

```text
STYLE (after 'with'): color, width, label (true/false/text), layer (0-9), visible, aux, algebra (value|definition|description|definitionAndValue), slider (list|canvas|both)
VIEW: @algebra mode|sort|round|aux|input   Rename(obj, "NewName")
```

The model is told once: *Use `aux = true` for helper objects the learner does not need to read. Use `a in lo..hi` only on free numbers.*

## 4. Error handling specific to this area

| Error | Model's action |
|---|---|
| `restricted` | The lesson limits learners, not the teacher tool; the teacher tool is never restricted. If `restricted` appears in a `draw` result it means a directive set `input` restrictions on the draw tool too (rare); read the allowed list in `forms` and rephrase with an allowed command |
| `name_taken` | Use the `fix` name |
| `slider_range`, `not_a_slider` | Apply `fix` or `quickFixes` |
| `bad_range` for a value outside the range | Choose widening the range unless the lesson says otherwise |
| `read_only` | Pick a new name; locked objects belong to the lesson template |

## 5. Worked lessons

### 5.1 A slider for the slope, with helpers hidden

> "Let me set up a line with a slope you can change."

```text
m = 1 in -5..5 step 0.25
b = 0 in -5..5 step 0.25
f(x) = m * x + b
```

> "I need two helper points to show rise over run, but you do not need to read them."

```text
P = (0, b)
Q = (1, b + m)
P with aux = true
Q with aux = true
R = Segment(P, Q)
```

> "The step to the right is one; the step up is the slope."

```text
Readout("rise per 1 run", m)
```

The learner sees `m`, `b`, `f` and the readout in the list; `P`, `Q`, `R` hidden by default (the AV filters aux). The model confirms with `figure undefined: true` (empty).

### 5.2 A puzzle: definition only, with a reveal

> "Here is a line. Can you find an equation that matches it? I will hide its equation for now."

```text
secret = Line((0, 1), (2, 5))
secret with algebra = description
```

The row shows `Line` (no equation). After the learner tries:

> "Let me show you."

```text
secret with algebra = definitionAndValue
```

The row now shows `secret = Line(...)` and `y = 2x + 1`.

### 5.3 Recovering from a name collision on rename

> "I will call this point P to match the diagram in your book."

```text
Rename(A, "P")
```

Result: `name_taken` ("P already names another point"), with `fix: Rename(A, "Q")`. The model decides: `Q` is wrong for the book, so it renames the other point first.

```text
Rename(P, "P_1")
Rename(A, "P")
```

> "Now your A is the book's P, and the old P is P one."

Two lines were needed, both succeeded. The model describes the effect in the learner's words and does not mention the failed attempt.

### 5.4 Explaining an undefined value

> "I will find the intersection of these two lines."

```text
l1 = y == 2x + 1
l2 = y == 2x - 3
I = Intersect(l1, l2)
```

Result for the last line: `ok`, `undefined: [{ name: "I", reason: "parallel" }]`, `summary: "I = undefined (the lines are parallel)"`. The model says: "These two never meet, because they climb at the same rate; they are parallel." It does not claim it drew a point.

## 6. Token budget

| Item | Tokens |
|---|---|
| Style and directive lines | ~90 |
| `figure` per object | ~15 |
| `draw` summary string | ~15 (included in the 35-token line result) |
| Reason texts (never sent; the model gets the `reason` code and a short text) | ~0 |

Rules for staying inside the budget: ask `figure` for filtered sets, not the whole figure, after the first few lines; rely on `draw`'s `summary` and `undefined` lists to learn about effects instead of calling `figure`.

## 7. Style guidance for the model

1. Name objects so rows read well: `m`, `b`, `A`, `f`; not `obj1`.
2. Make a slider when the sentence invites the learner to try values; do not make one for a number the lesson fixes.
3. Hide scaffolding with `aux`, not with `Delete`; the learner can still show aux objects if curious.
4. Use `algebra = description` for puzzles, and reveal with `algebra = definitionAndValue`.
5. Mention a value only after `draw` reported it.
6. Do not set `@algebra input` unless the lesson asks learners to type; restrictions reduce what a learner can try.
