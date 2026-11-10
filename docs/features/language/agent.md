# Input language: how the model uses it

The model writes lines through the `draw` tool and reads the figure through `figure` (core design, section 10). This document covers the language card the model is given, the result shapes it gets back, how it repairs errors, and how the live teacher talks while it builds.

## 1. The language card (always in the prompt)

About 300 tokens. It replaces the "grammar summary" block named in core section 10. Command forms come from the catalogue (each area owns its own lines); this card is the language only.

```text
LINES: one change per line. Send 1-5 lines per draw call.
  A = (1, 2)              point             P = (2; 30°)      polar point
  f(x) = x^2 - 2          function          g(x, y) = x*y     two variables
  a = 3 in 0..10 step 0.5 slider            a in 0..20        change range only
  M = Midpoint(A, B)      command result    A, B = Intersect(c, d)   two results
  v' = -g                 rate of a state   A with color = red   restyle
  Hide(A)                 action            # note   @view -5 5 -3 3
RULES
  '=' defines, '==' compares. Every object has a name (the command is not enough).
  Commands are PascalCase; built-in functions and constants are lowercase.
  A product needs '*', except right after a number: 2x, 3(a+b), 0.5 pi. 'ab' is one name.
  Use brackets after '/': 1/(2x). Powers: x^2, 2^-1. -2^2 is -4. 30° is 30*pi/180.
  Angles are radians. Unknown names are errors; make a number first.
  x and y exist only in f(x) = ... and in relations: l = y == 2x + 1, c = x^2 + y^2 == 4.
  Lists [1,2,3] [1..10] [0..1 step 0.1]; L[1] is the first item. Points (x, y).
  Text: "m = {m:2}" shows a live value. if(cond, a, b). 0 < x < 5 is allowed.
  Names: letters, digits, _ ; P_1 ; Greek ok. Not a command, function, or: t x y z e pi tau deg inf.
```

Estimated size: 290 tokens with the compact tokeniser used by the live model. The card is stable text, so it is cacheable.

## 2. Catalogue entries owned by this area

The command table prints one line per form. This area contributes no commands but contributes:

1. **Built-in functions**, printed as one line per group (not per function):

```text
FUNCTIONS (lowercase, pure): sin cos tan sec csc cot asin acos atan atan2(y,x) sinh cosh tanh asinh acosh atanh
sqrt cbrt nroot(x,n) hypot(a,b) exp ln log10 log2 log(base,x) abs sign floor ceil round(x[,d]) trunc fract
min max (many args or a list) clamp(x,lo,hi) mod(a,b) rem gcd lcm fact(n) ncr(n,r) npr(n,r) gamma beta erf
lerp(a,b,s) smooth(e0,e1,x) step(e,x) rand(seed) noise(x[,y[,z]]) dot cross norm unit perp todeg torad
rgb(r,g,b[,a]) hsl(h,s,l[,a]) len(text) number(text)   CONSTANTS: pi tau e deg inf undefined true false
FIELDS: P.x P.y  v.length  s.length  c.center c.radius  poly.area poly.perimeter
```

2. **Operators on types**, one line (the model needs the surprising bits):

```text
Point-Point = Vector. Point+Vector = Point. Number*Vector = Vector. No Point*Number: use 2*Vector(A) or Dilate.
Functions combine: h = f + g, k = 2 f + 1. Lists with a number work element-wise: L * 2.
```

Token budget for this area's catalogue text: functions line about 150 tokens; operators and fields about 60 tokens. Total with the language card: about 500 tokens. Against the core budget (grammar 300, catalogue 1,200) the language area adds roughly 200 tokens over the old grammar summary, which is the price of the new forms.

## 3. What `draw` returns for language-level results

Per line (core format, with the extra fields from `errors.md`):

Success:

```json
{ "ok": true, "line": 2, "name": "f", "type": "Function", "summary": "f(x) = x^2 - 2",
  "warnings": [], "undefined": [] }
```

Success with a warning and an undefined consequence:

```json
{ "ok": true, "line": 3, "name": "r", "type": "Number", "summary": "r = undefined (out_of_domain)",
  "warnings": [], "undefined": [{ "name": "r", "reason": "out_of_domain", "detail": "sqrt(-4)" }] }
```

No-op (comment, empty): `{ "ok": true, "line": 1, "noop": true }`.

Failure: the error object from `errors.md`. Lines that depend on a failed line carry `after`.

`summary` is the same text the Algebra view shows in its row (see `algebra-view/design.md`, the `summarize` function), so the model and the learner read the same words.

`figure` returns, per object, `{ name, type, def, value, visible, undefined? }`, where `def` is the pretty-printed definition and `value` the compact value text. For a figure of 100 objects the output is about 1,500 tokens; the tool accepts `names: string[]` or `type: string` filters so the teacher can ask only what it needs.

## 4. How the model repairs errors

The repair rules the teacher follows, each triggered by a field in the error:

| Field present | Action |
|---|---|
| `fix` | Send `fix` as the next line unchanged, unless it changes the meaning the model intended; then pick another candidate |
| `quickFixes` | Choose by label; send the chosen `lines` together in one `draw` call |
| `forms` and `problems` | Rewrite the call using the closest form; change only the argument at `problems[i].argIndex` |
| `hint` only | Apply the hint; if the hint is a question ("Did you mean a * b?") answer it using the current sentence's intent |
| `after` | Fix the earlier line first; resend the dependent lines after it |
| `limit` | Shrink the size; do not retry the same line |
| `breaks_dependents` | Pick a new name for the new definition instead of redefining |

Hard rules: at most two retries per line, then move on and describe only what was drawn. Never repeat the identical failing line.

Which errors the model should avoid by habit (they are also taught in the card): forgetting a name before a command; writing `=` for a relation; typing `ab` for a product; `1/2x`; using `x` in a number.

## 5. Worked lessons

### 5.1 Slope of a line (clean)

Teacher speech and lines, in order. Each paragraph is one sentence of speech and the `draw` call made with it.

> "Here is a point to start with." 

```text
A = (1, 2)
```

> "Now a second point, higher and further right."

```text
B = (4, 6)
s = Segment(A, B)
```

> "The slope is rise over run, so let me compute it."

```text
m = (B.y - A.y) / (B.x - A.x)
Readout("slope", m)
```

> "And here is the line that has that slope through A. I will make a slider for the point's height so you can change it."

```text
h = 2 in -3..8 step 0.5
f(x) = m * (x - A.x) + A.y
```

Result of the last call: `f` is a `Function`; `h` is a Number with a range. The teacher then says: "Move h, and the line stays through A." (`h` is not used yet; the model notices from `figure` that nothing depends on `h` and fixes this by redefining `A = (1, h)`, which keeps `A`'s id and style, and says "Now h controls A's height.")

### 5.2 Unit circle with an error and a repair

> "A circle of radius one around the origin."

```text
O = (0, 0)
c = Circle(O, 1)
```

> "Pick an angle with a slider."

```text
θ = 0.8 in 0..tau step 0.01
P = (cos(θ), sin(θ))
```

> "Let me draw the radius."

```text
r = Segment(O, P)
x = P.x
```

The second line fails:

```json
{ "ok": false, "line": 2, "col": 1, "endCol": 2, "kind": "reserved_name", "token": "x",
  "message": "x is reserved for functions and equations and cannot name an object.",
  "hint": "Pick another name, such as px.", "fix": "px = P.x", "expected": [], "forms": [] }
```

`r` was applied. The model sends the `fix` line unchanged and says "The cosine is the horizontal part of that point; here it is as a number called px." It describes only `r` and `px`, not `x`.

### 5.3 A function and its tangent, with a free-variable error

> "Let me define the curve first."

```text
f(x) = x^3 - 3x
```

> "Its value at 2 is..."

```text
v = f(x)
```

Result:

```json
{ "ok": false, "line": 1, "col": 7, "endCol": 8, "kind": "free_variable", "token": "x",
  "message": "x is only available inside a function or an equation, and 'v' is a plain number.",
  "hint": "Write a function: v(x) = f(x), or call f at a number: v = f(2).",
  "fix": "v(x) = f(x)", "expected": [], "forms": [] }
```

The model recognises that the sentence asked for a number at 2, not a function, so it does not accept the `fix`. It sends `v = f(2)` and says "At 2 the curve is at height two." This is why `fix` is a candidate, not an order: the model compares it with intent.

### 5.4 Disambiguation

The model writes `h = 1/2x` meaning half of x for the function body. Result `ambiguous_implicit` with two `quickFixes`. The model picks `(1/2) x`, and says nothing about the correction, since the viewer has not seen the failed line.

## 6. Style rules for the model

1. Name every object, one letter for points (`A`), a word for readouts.
2. Prefer one function definition over many points when showing a curve.
3. Put sliders before the objects that use them; keep ranges around the interesting values.
4. Use `θ`, `α` and similar for angles; the AV shows them in degrees.
5. Use `{expr:2}` in texts for numbers shown to a learner (2 decimals).
6. When a result is undefined, say why in plain words using the reason: "these two lines never meet" for `parallel`, "square root of a negative" for `out_of_domain`.

## 7. Token budget summary

| Item | Tokens |
|---|---|
| Language card | ~290 |
| Functions and fields lines | ~150 |
| Type-operator lines | ~60 |
| Typical `draw` success result per line | ~35 |
| Typical error result | ~120 |
| `figure` per object | ~15 |

The language card plus functions plus type lines fit in 500 tokens; with the command catalogue (1,200) the static prompt is about 1,700 tokens, within the core design's plan of loading groups on demand as the command set grows.
