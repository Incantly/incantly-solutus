# Text, typeset maths, logic: how the model uses them

## 1. Catalogue entries

Two groups, loaded independently. The text group is nearly always loaded because most figures have labels.

### 1.1 Text (about 330 tokens)

```text
Text("words {x:2} words $\frac{a}{b}$", (px, py))     live text: {name} {name:2} {name:3sf} {angle:deg} {p:%} {x:f} {x:sci}; $…$ typeset maths
Text(obj)  Text(obj, at)  Text(obj, at, show = definition)       any object as text
FormulaText(obj)  FormulaText(obj, substitute = true)            an object as a typeset formula
LaTeX(obj)                                                       the LaTeX source of an object, as text
FractionText(x[, maxDen])  SurdText(x)  ScientificText(x[, sig])  Ordinal(n)  ContinuedFraction(x[, levels[, short]])
TableText(rows, align = "lcr", header = true, border = all, brackets = none, fmt = "2")
VerticalText(T)  RotateText(T, 30deg)
ReplaceAll(T, "old", "new")  Split(T, ",")
TextToUnicode(T)  UnicodeToText(L)  LetterToUnicode(T)  UnicodeToLetter(n)
T with at = P, anchor = nw, size = 18, bold = true, italic = true, color = red, bg = white, border = black, rotate = 30deg, width = 200, align = center
```

Rules the model is told (about 70 tokens):

- Put `{name:fmt}` in the string to show a live value; use `$…$` for maths; use `\$` for a literal dollar sign.
- The text tool supports common LaTeX: `\frac \sqrt ^ _ \sum \int \lim \left \right` matrices, Greek letters, operators. If a macro is rejected, write the words instead.
- A text shows a dash for an undefined value; do not read the dash aloud as a number.
- Name every text: `t1 = Text(...)`. A bare `Text(...)` line is the error `unnamed_object` (the short forms in the core catalogue omit the name for space).

### 1.2 Logic (about 240 tokens)

```text
if(c, a, b)    cases(c1, v1, c2, v2, otherwise)       conditional value; also piecewise functions: f(x) = if(x < 0, -x, x)
xor(a, b)  implies(a, b)  and  or  not  ==  !=
CountIf(L, k, k > 2)    KeepIf(L, k, k mod 2 == 0)     k is a name you choose, local to the condition
IsInteger(x)   IsDefined(obj)   UndefinedReason(obj) -> Text   IsInRegion(P, region)
Relation(a, b) -> Text sentence     Related(a, b, "parallel") -> Bool     Related(a, b, "parallel", always = true)
relation kinds: equal distinct parallel perpendicular coincident intersecting on inside outside tangent secant disjoint concentric nested less greater
```

Rules the model is told (about 60 tokens):

- `if` always needs an else. Write `undefined` if there is no value.
- Use `Related(..., always = true)` before saying something "stays true when you drag"; plain `Related` only says it is true now.
- `Relation` returns a sentence; read it, do not guess.

## 2. Lines the model writes

Labels and live values:

```text
A = (1, 2)
B = (5, 4)
d = Distance(A, B)
t1 = Text("distance = {d:2}", (3, 4.5))
t2 = Text("A is at {A}", (1, 1.2)) 
```

Maths in text:

```text
t3 = Text("The area of a triangle is $\frac{1}{2} b h$.", (-4, 5))
t4 = Text("With b = {b:1} and h = {h:1}, area = {b * h / 2:2}", (-4, 4))
```

Words that change with the figure:

```text
θ = 70deg in 0deg..180deg step 1deg
kind = if(θ < 90deg, "acute", if(θ == 90deg, "right", "obtuse"))
t5 = Text("The angle is {θ:deg}, so it is {kind}.", (0, 3))
```

A table:

```text
rows = [["x", "x^2"], [1, 1], [2, 4], [3, 9]]
tbl = TableText(rows, header = true, border = all, align = "cc")
```


Format helpers:

```text
f1 = FractionText(0.375)
s1 = SurdText(0.70710678118)
sc = ScientificText(12345.678, 4)
o = Ordinal(22)
cf = ContinuedFraction(3.14159265, 4, true)
```

Strings:

```text
parts = Split("red,green,blue", ",")
shout = ReplaceAll("hello world", "world", "there")
codes = TextToUnicode("Aé")
```

Logic and counting:

```text
P = [(0, 0), (1, 3), (4, 1), (6, 6), (2, 5)]
poly = Polygon((0, 0), (5, 0), (5, 5), (0, 5))
inside = CountIf(P, k, IsInRegion(k, poly))
kept = KeepIf(P, k, IsInRegion(k, poly))
t6 = Text("{inside} of {len(P)} points are inside", (0, 7))
```

Relations:

```text
l1 = Line((0, 0), (4, 2))
l2 = Parallel((1, 3), l1)
s = Relation(l1, l2)
ok = Related(l1, l2, "parallel", always = true)
```

## 3. What `draw` gives back

```json
{ "line": 4, "ok": true, "name": "t1", "type": "Text", "value": "distance = 4.47" }
{ "line": 1, "ok": true, "name": "f1", "type": "Text", "value": "3/8", "meta": { "exact": true } }
{ "line": 2, "ok": true, "name": "s1", "type": "Text", "value": "√2/2", "meta": { "match": true, "exact": false, "residual": 1.1e-11 } }
{ "line": 5, "ok": true, "name": "o", "type": "Text", "value": "22nd" }
{ "line": 4, "ok": true, "name": "s", "type": "Text", "value": "l1 and l2 are parallel, and stay parallel however the figure is dragged (l2 was built parallel to l1).", "meta": { "basis": "by_construction" } }
{ "line": 5, "ok": true, "name": "ok", "type": "Bool", "value": "true" }
{ "line": 3, "ok": true, "name": "inside", "type": "Number", "value": "3", "notices": [] }
```

Notes for the model:

- A text object's `value` is its current string. For maths parts the value is the spoken reading ("one half b h").
- `meta.exact: false` on `SurdText` means "looks like"; say so.
- `meta.basis` on `Relation` is `by_construction`, `now`, or `no`.
- Undefined live parts appear as `–` and the notice `dash_in_text` lists them.

`figure` lists every text with its value, placement and visibility.

## 4. Fixing errors

| Error | Fix |
|---|---|
| `bad_format` | Use the format in `suggest`; `deg` for angles, `2` for decimals, `3sf` for significant figures |
| `unbalanced_math` | Escape the dollar sign with `\$` or add the closing `$` |
| `latex_unsupported` | Use plain words or a supported macro; do not retry the same macro |
| `latex_syntax` | Fix the braces (`\frac{a}{b}`) |
| `unknown_name` inside `{…}` | Define the object first |
| `missing_else` | Add `, undefined` or a real else |
| `bad_relation_kind` | Pick from `expected` |
| `no_matching_form` for `TableText` | Check that `rows` is a list of lists |

## 5. The live teacher: worked snippets

### 5.1 A formula appears as it is spoken

> "The area of a triangle is half the base times the height."

```text
b = 4 in 1..8 step 0.5
h = 3 in 1..6 step 0.5
T = Polygon((0, 0), (b, 0), (b / 2, h))
t7 = Text("$A = \frac{1}{2} b h$", (-1, 7))
```

> "With a base of four and a height of three, that's six."

```text
t8 = Text("b = {b:1}, h = {h:1}, A = {Area(T):1}", (-1, 6))
```

> "Drag the base and watch the area follow."

(The text updates as the learner drags, with no new lines from the teacher.)

### 5.2 Recovering from a format mistake

> "Let's label the angle."

```text
θ = 40deg in 0deg..180deg step 1deg
t9 = Text("Angle: {θ:degrees}", (2, 2))
```

`draw` returns `bad_format` with `suggest: ["Text(\"Angle: {θ:deg}\", (2, 2))"]`.

> "I need to say the angle in degrees."

```text
t10 = Text("Angle: {θ:deg}", (2, 2))
```

### 5.3 "Is it always parallel?"

> "I'll draw a line through this point parallel to the first."

```text
l1 = Line((0, 0), (4, 2))
P = (1, 3)
l2 = Parallel(P, l1)
r = Relation(l1, l2)
```

`draw` returns the sentence with `basis: by_construction`.

> "They're parallel, and the machine says it stays that way however you move the point, because I built the second line to be parallel."

Contrast with a line drawn through two free points:

```text
Q = (0, 5)
R = (3, 6)
l3 = Line(Q, R)
r3 = Relation(l1, l3)
```

`draw` returns "l1 and l3 are parallel right now, but nothing in the figure keeps them so" (`basis: now`).

> "Right now they happen to be parallel, but if you move Q or R they won't be. Try it."

### 5.4 Counting inside a region

> "Here's a square and some scattered points."

```text
sq = Polygon((0, 0), (5, 0), (5, 5), (0, 5))
S = [(1, 1), (6, 2), (3, 4), (7, 7), (4.5, 0.5)]
n = CountIf(S, k, IsInRegion(k, sq))
t11 = Text("{n} of {len(S)} points are inside", (0, 6))
```

> "Three of the five points are inside the square."

(Said after `n = 3` is returned.)

### 5.5 Exact form of a decimal

> "The calculator says 0.7071. Let's see what that really is."

```text
x = sin(pi / 4)
sx = SurdText(x)
t12 = Text("sin 45° = {x:4} = {sx}", (0, 2))
```

(`SurdText(x)` returns a Text with one typeset part, `\frac{\sqrt{2}}{2}`. A Text object named in braces is inserted with its parts, so the maths stays typeset.) `draw` returns `meta.match: true, exact: false`.

> "It looks like the square root of two over two."

## 6. Events from the learner

Editing a text in place sends the new parts to the teacher as a change report. Dragging a text with the pointer changes its `at`. Toggling a checkbox that feeds an `if` in a text updates the string; the teacher gets the report only if the text is flagged `watch`.

## 7. Rules of thumb for the model

1. Use `{name:fmt}` for numbers in text, not string joining.
2. Format angles with `deg`, money with `2`, probabilities with `%`.
3. One `Text` per idea; keep each under about 140 characters so it fits next to the figure.
4. Put maths in `$…$`, words outside.
5. Use `Relation` and `Related` to check before saying two things are parallel, perpendicular or tangent; use `always = true` before promising it stays so.
6. `SurdText` and `FractionText` of a decimal are guesses; say "looks like".
7. Do not read a dash aloud as a value.
8. Never write a Text without a point or an object to anchor it to; the default is the origin.

## 8. Prompt size

Text group 330 tokens, logic group 240, rules 130: about 700 tokens, loaded on demand. The always-on core catalogue still carries the short `Text(string, point)` and `Readout` forms from the core design.
