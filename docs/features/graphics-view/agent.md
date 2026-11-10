# Graphics view: how the model uses it

The model never clicks. It writes lines. Everything in `design.md` that a learner does with a pointer, the model does with a directive or a `with` line. This file gives the catalogue entries, the results, the lesson snippets and the token budget.

## 1. Catalogue entries

Printed by the build step from the directive and style tables. One line each. These go into the teacher's instructions with the command catalogue.

```text
@view x0 x1 y0 y1 [equal|free] [over s]   visible region; "equal" keeps units square
@view home                                 back to the last region
@axes on|off|x|y                           @axes labels on|off
@grid on|off|minor|polar|iso               @grid step n
@snap off|grid|points|auto                 learner's snapping
@alt "text"                                alt text for the whole figure
obj with color=…, width=…, dash=…          restyle one object (any number of props, comma separated)
  color: red blue green orange purple black grey teal pink | rgb(r,g,b) | hsl(h,s,l) | any Color
  opacity 0..1  fill 0..1  hatch: lines(angle,gap) cross(angle,gap) dots(gap) | none
  width 0.5..20  dash: solid dashed dotted dashdot
  pointStyle: dot ring cross plus diamond square triangle-up …   pointSize 1..20
  label: none name value name-value caption   caption "text {expr}"
  layer 0..9   show true|false|expr   fixed true|false   trace true|false
Highlight(obj, seconds)                    pulse an object while you talk about it
Show(obj…) Hide(obj…)                      visibility
```

Property values can be formulas: `P with color = hsl(36 * a, 80, 50)`.

Naming: points get capital letters, other objects lowercase. The model chooses its own names, because it must refer to them later.

## 2. What `draw` returns

Success, per line:

```json
{ "ok": true, "name": "A", "type": "Point", "summary": "(1.5, 2)", "visible": true,
  "warnings": [] }
```

A directive:

```json
{ "ok": true, "directive": "view", "summary": "x -5..5, y -3..3 (equal), 80 px/unit" }
```

A success with a warning:

```json
{ "ok": true, "name": "B", "type": "Point", "summary": "(40, 3)", "visible": true,
  "warnings": [{ "code": "off_screen", "message": "B is at (40, 3), outside the view. Use @view or move it." }] }
```

`figure` returns, for each object, one row. View fields beyond the core ones:

```json
{ "name": "c", "type": "Circle", "summary": "centre O, radius 3", "visible": true,
  "onScreen": true, "layer": 0, "draggable": "free", "undefined": null,
  "label": "name", "hiddenBy": null }
```

`draggable` is the drag plan kind (`free`, `path`, `slider`, `parents`, `none`). `onScreen` is whether the bounding box meets the view. `figure` also returns the current view:

```json
{ "view": { "x": [-5, 5], "y": [-3, 3], "ratio": "equal", "pxPerUnit": [80, 80], "grid": "major", "axes": "on" } }
```

Learner events arrive in the model's next turn (this area): the model should not speculate about them.

```json
{ "event": "learner_moved", "name": "A", "from": "(1, 2)", "to": "(1.5, 2)" }
{ "event": "learner_selected", "names": ["A", "B"] }
{ "event": "learner_view", "x": [-2, 8], "y": [-3, 5] }
```

## 3. Fixing errors

| Error kind | What the model does next |
|---|---|
| `unknown_property` | Take `closest[0]` if it fits; otherwise pick from `known` |
| `bad_property_value` | Use the stated range or type |
| `property_not_for_type` | Use `appliesTo`; do not repeat |
| `bad_directive` with `empty_range` | Swap the numbers |
| `conflicting_style` | Use the `hint` form |
| `off_screen` warning | Add an `@view` line before talking about the object, or tell the learner honestly where it is |
| `limit` | Stop adding; say the figure is full |

Two retries at most, per core section 10.

## 4. Lesson snippets

### 4.1 Setting up and highlighting

Teacher says: "Let's start with a circle and a point that can move around it."

```text
@view -4 4 -3 3 equal
@grid minor
O = (0, 0)
c = Circle(O, 2)
P = PointOn(c, 0.125)
P with color = orange, pointSize = 6, label = name
```

Result: all `ok`. The teacher says: "The orange point P can slide around the circle. Try dragging it."

Later: "Notice the radius." `Highlight(c, 2)`.

### 4.2 Recovering from a style mistake

Teacher says: "I'll make the region we care about stand out."

```text
tri = Polygon(A, B, C)
tri with colour = blue, fill = 0.3
```

Second line returns:

```json
{ "ok": false, "line": 2, "col": 10, "kind": "unknown_property", "token": "colour",
  "closest": ["color"], "hint": "Did you mean `color`?" }
```

The teacher says nothing about the error, and issues:

```text
tri with color = blue, fill = 0.3
```

It speaks only about what was drawn: "The triangle is now shaded blue."

### 4.3 Off-screen warning

Teacher says: "Now the far point, where the line meets the axis."

```text
X = Intersect(l, axisLine)
```

Result: `ok` with warning `off_screen` ("X is at (31.4, 0)"). The teacher issues `@view -5 35 -6 6 over 1` and says: "That point is far to the right, so I'll zoom out to show it."

### 4.4 Hatching to tell two regions apart

```text
r1 = AreaUnder(f, 0, 2)
r2 = AreaUnder(g, 0, 2)
r1 with color = blue, hatch = lines(45, 8), fill = 0.2
r2 with color = green, hatch = lines(-45, 8), fill = 0.2
```

The teacher can say "the blue lines slant one way, the green the other" because the colour-blind-safe approach is to use hatch as well as colour.

## 5. Habits the instructions teach the model

- Set the view first, then create objects.
- After a `draw` call, read warnings. If `off_screen`, deal with it before describing the object.
- Use `Highlight` for what is being spoken about; do not change colours back and forth as a highlight.
- Give shapes a hatch or a dash as well as a colour when two things must be told apart.
- Do not restyle every object. Defaults are readable; set only what the lesson needs.
- Prefer `over s` for view changes while speaking.
- Use `label = none` for helper objects; reduce clutter.

## 6. Token budget

| Entry | Tokens (approx) |
|---|---|
| Directive and style catalogue (section 1) | 330 |
| Habits (section 5), condensed to 5 lines | 90 |
| Error recovery table, condensed | 60 |
| **Total for this area** | **~480** |

This sits inside the 1,200-token command catalogue of the core design only partly: directives and `with` are grammar, not commands, so they belong to the 300-token grammar summary plus this block. Net addition to the teacher prompt: about 480 tokens. If the budget is tight, the palette names and point shapes can drop to "see `figure`", saving about 100.
