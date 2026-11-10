# Numbers, angles, sliders, booleans: how the model uses them

## 1. Catalogue entries (given to the model every time the group is loaded)

```text
a = 3                                   free Number
a = 3 in 0..10 [step 0.5]               slider (free Number with range; ends may be formulas)
θ = 30deg in 0deg..360deg step 1deg     angle slider (units: deg turn grad rad)
a with min=, max=, step=auto|n, loop=bounce|up|down|once|random, period=sec, unit=deg|rad|none, digits=n, sig=n, label="text", place=dock|screen(x,y)|at(x,y), vertical=bool, length=px
a with min = none                       remove the slider
Animate(n: Number, on: Bool = true)     start/stop a slider moving by itself (needs a range)
show = true                             checkbox (free Bool); caption: show with label = "Show tangent"
big = a > 5                             test (dependent Bool)
obj with showif = <Bool>                show obj only while the Bool is true  (showif = none removes)
Toggle(b: Bool)                         flip a checkbox
Text("r = {r:.2} {θ:deg} {x:3sf}", (x, y))   number formats in text
round(x, n) sig(x, n) snap(x, step) wrap(x, lo, hi)   constants: deg turn grad
```

Token budget: about 330 tokens for this group. The group loads when the lesson needs a learner-controlled value (any plan that includes "slider", "drag", "change", "animate", "show/hide"). The always-on core catalogue (about 1,200 tokens) is unchanged.

Rules the model is told in one sentence each (about 60 tokens): a slider needs a range; give angle bounds a unit; unknown names are errors, so create each slider before using it; use `showif` for checkboxes, `Hide` for one-off hiding.

## 2. Lines the model writes

Typical sequences:

```text
r = 2 in 0.5..4 step 0.5
c = Circle((0, 0), r)
A = Area(c)
Readout("Area", A)
```

```text
θ = 40deg in 0deg..180deg step 1deg with label = "Angle"
P = (3 cos(θ), 3 sin(θ))
Text("θ = {θ:.0deg}", (-4, 3.5))
```

```text
show = true with label = "Show tangent"
T = Tangent(f, x0)
T with showif = show
```

```text
k = 1 in 0..3
k with period = 6, loop = bounce
Animate(k)
```

## 3. What `draw` gives back

Each line returns a result object. For this area:

```json
{ "ok": true, "name": "r", "type": "Number", "summary": "2 (slider 0.5..4 step 0.5)" }
{ "ok": true, "name": "θ", "type": "Number", "summary": "40° (angle slider 0°..180° step 1°)" }
{ "ok": true, "name": "show", "type": "Bool", "summary": "true (checkbox \"Show tangent\")" }
{ "ok": true, "name": "T", "type": "Line", "summary": "y = 0.8x - 1.2",
  "notices": [] }
```

`figure` lists, for sliders: value, range, step, unit, `animating`, loop mode. For Bools: value and the objects bound by `showif`. For hidden objects it says why (`hidden`, `showif=false`, `showif undefined`, `undefined`). The model describes only what these say.

Value notices (`clamped`, `snapped`, `range_kept`, `unit_inferred`) are in the line result; the model must mention a clamp when it matters ("I set it to 5, the smallest value the slider allows").

## 4. Fixing errors

| Error | Model's fix |
|---|---|
| `bad_range` | Swap or fix the ends, using the `hint` line. |
| `not_free` | Replace the line with a constant and range; if other lines depend on it, say so first. |
| `unit_mismatch` | Add `deg` to the bounds and step. |
| `not_animatable` (`no_range`) | `a with min = 0, max = 10`, then `Animate(a)`. |
| `animated_input` | Use a formula of `t`: `k = 1 + sin(t)`, or stop the animation. |
| `unknown_name` | Create the slider first. Never reuse a slider name for something else. |
| `unknown_property` | Use the closest property in `hint`. |

Retry budget as in the core design: two tries per line, then drop the line and say what was drawn.

## 5. The live teacher: worked snippets

### 5.1 "Move the radius" (slider + readout)

> **Teacher:** "Let's look at a circle. I'll give you a radius you can change."
>
> `draw`: `r = 2 in 0.5..4 step 0.5`, `c = Circle((0, 0), r)`
>
> **Teacher:** "Try moving r. The area is the number of unit squares that fit."
>
> `draw`: `A = Area(c)`, `Readout("Area", A)`
>
> **Teacher:** "At r = 2 the area is about 12.57."

### 5.2 Angle sweep with a checkbox

> **Teacher:** "A point goes around a circle as the angle grows."
>
> `draw`: `θ = 30deg in 0deg..360deg step 1deg`, `P = (2 cos(θ), 2 sin(θ))`
>
> **Teacher:** "Press play on θ, or drag it."
>
> `draw`: `θ with period = 8, loop = up`, `Animate(θ)`
>
> **Teacher:** "Want to see the height? Tick the box."
>
> `draw`: `h = true with label = "Show height"`, `H = Segment(P, (P.x, 0))`, `H with showif = h`

### 5.3 Recovering from an error

> **Teacher:** "Let me put a slider on the side length."
>
> `draw`: `s = 3 in 1..10`, `side = 2 * s in 0..20`
>
> Result: line 2 is `not_free`: "side is computed from s, so it cannot have a slider."
>
> **Teacher:** (does not describe the failure at length) "The side is twice s; I'll just show it."
>
> `draw`: `side = 2 * s`, `Readout("side", side)`

### 5.4 Notice use

> `draw`: `a = 15 in 0..10`
>
> Result: `ok`, notice `clamped 15 -> 10`.
>
> **Teacher:** "I started it at 10, the top of the range."

## 6. Events from the learner

When the learner moves a slider or ticks a box, the teacher gets a short event (cross-area: teacher tool feed):

```json
{ "event": "change", "name": "r", "value": 3.5, "text": "3.5", "by": "learner" }
```

The teacher may comment on it. These events are throttled: one per slider per 250 ms while dragging and one final event on release.

## 7. Rules of thumb for the model

1. One slider line per quantity the learner may change; keep to three or four sliders in a figure.
2. Give every slider a `label` if the name is not self-explanatory.
3. Prefer `step` with a round number the learner can read.
4. Use a formula of `t` (`P = (cos(t), sin(t))`) for motion the teacher controls, and a slider with `Animate` for motion the learner may take over.
5. Do not use `Hide` for something the learner should toggle; use a Bool with `showif`.
