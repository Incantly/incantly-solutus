# Graphics view: errors

Follows section 9 of the core design: every error is data, returned to the caller, never a dialog. Two channels exist in this area:

- **Line errors** for directives and `with` lines (the model and authors write these). They use the core error object.
- **Gesture feedback** for pointer and keyboard actions (the learner does these). They are not error objects. They are short, non-modal hints (a toast or tooltip) with a stable `code`, so tests can check them and the screen reader can speak them.

Runtime conditions that make a drawn object disappear are not errors. They are undefined values with a reason (core section 2).

## 1. How GeoGebra handles these

- Bad view ranges, unknown style names and bad values in dialogs are mostly prevented by the dialog (sliders, drop-downs). In the command line and scripts, view and style commands fail with the generic input error or a small set of named errors, and the caller gets only true or false.
- A zoom that would go too far is silently clamped.
- A failed export shows a dialog or does nothing.
- An object that cannot be drawn is just not drawn, with no explanation.
- A drag that cannot move a dependent object does nothing and says nothing.

We keep the quiet clamp for zoom but add a hint; everything else becomes data with a reason.

## 2. Line errors

New kinds are marked **new**; the others are in core section 9.

| Kind | When | Fields beyond the core set | Hint pattern |
|---|---|---|---|
| `bad_directive` | Unknown directive name, missing arguments, wrong number count | `directive`, `forms` (accepted forms of that directive) | "`@view` takes four numbers, then an optional `equal`, `free`, `over s`." |
| `bad_directive` (view range) | `x0 >= x1`, `y0 >= y1`, NaN, infinite, or width/height outside limits | `reason`: `empty_range`, `not_finite`, `too_small`, `too_large`; `limits` | "Give x0 less than x1, and a width between 1e-9 and 1e9." |
| `unknown_property` **new** | `with` names a property that does not exist | `property`, `closest`, `known` (list for that object type) | "Did you mean `width`?" |
| `bad_property_value` **new** | The value has the wrong type or range | `property`, `expected` (type or range), `got` | "`width` takes a number from 0.5 to 20." |
| `property_not_for_type` **new** | A valid property on an object that ignores it (`pointStyle` on a circle) | `property`, `objectType`, `appliesTo` | "`pointStyle` is for points. Use `width` for a circle." |
| `conflicting_style` **new** | `Show(A)` on an object whose `show` is a formula; two values of one property in one line | `property` | "Use `A with show = true` to replace the condition." |
| `unknown_name` | Style value refers to a missing object (`color = c1`) | as core | closest name |
| `type_mismatch` | A formula for a numeric property returns a Point | as core | |
| `cycle` | A style formula depends on the object it styles through a value that depends on the style (rare, since styles are not read by maths; it happens only via `Text` objects that read `.color`) | as core | |
| `limit` | More than 10,000 drawable objects, a label longer than 2,000 characters, a hatch spacing outside 2 to 80 px, an export larger than 16,384 px on a side | `limit`, `value`, `max` | |
| `bad_layer` **new** | `layer` outside 0..9 or non-integer | `got`, `range` | "Layers run from 0 to 9." Applies the clamp only if `lenient` is set; default is an error. |
| `bad_export` **new** | Unknown format, region or option; size zero | `option`, `got`, `expected` | |

A `with` line that sets several properties applies **all or none**: the first bad property fails the line and nothing changes. The error lists only the first problem; a second call after fixing finds the next. (The checker collects all problems in the `all` array, to save the model a round trip.)

### Examples

An unknown property:

```json
{
  "ok": false,
  "line": 6,
  "col": 14,
  "endCol": 19,
  "kind": "unknown_property",
  "token": "colur",
  "message": "A point has no property `colur`.",
  "property": "colur",
  "closest": ["color"],
  "known": ["color", "opacity", "pointStyle", "pointSize", "label", "caption", "layer", "show", "fixed", "selectable", "trace", "alt"],
  "hint": "Did you mean `color`?"
}
```

A bad value:

```json
{
  "ok": false,
  "line": 3,
  "col": 21,
  "endCol": 23,
  "kind": "bad_property_value",
  "token": "40",
  "message": "`width` must be a number from 0.5 to 20, got 40.",
  "property": "width",
  "expected": "number in 0.5..20",
  "got": 40,
  "hint": "Use 0.5 to 20 pixels. For a faint thick band, lower `opacity` instead."
}
```

A view range that is empty:

```json
{
  "ok": false,
  "line": 1,
  "col": 7,
  "endCol": 15,
  "kind": "bad_directive",
  "directive": "view",
  "reason": "empty_range",
  "token": "5 -5",
  "message": "@view needs x0 < x1, got 5 and -5.",
  "forms": [
    "@view x0 x1 y0 y1",
    "@view x0 x1 y0 y1 equal | free",
    "@view x0 x1 y0 y1 over seconds",
    "@view home"
  ],
  "hint": "Swap them: @view -5 5 -3 3."
}
```

A conflict:

```json
{
  "ok": false,
  "line": 9,
  "col": 1,
  "endCol": 8,
  "kind": "conflicting_style",
  "token": "Show(A)",
  "message": "A has a show condition `a > 2`, so Show(A) would be ignored.",
  "property": "show",
  "hint": "Write `A with show = true` to replace the condition."
}
```

### Warnings (ok: true)

A line may succeed and still need attention. `warnings` is an array on the success result (core change C8):

| Code | When | Message |
|---|---|---|
| `hidden_object_styled` | A style change on an object that is hidden or undefined | "A is hidden, so the change cannot be seen yet." |
| `off_screen` | A new object's bounding box is entirely outside the view | "B is at (40, 3), outside the view. Use @view or move it." |
| `label_overlap` | Auto-placement could not find a free spot for a label | "Label of C overlaps label of D." (only reported once per object) |
| `fill_on_open` | `fill` on an object that has no interior | "A segment has no inside to fill." |

`off_screen` is the most useful warning for the model: it tells it the point was created but the learner cannot see it.

## 3. Undefined reasons (runtime, not errors)

Added to the kernel's reason codes; they explain why a drawable is hidden.

| Reason | Meaning |
|---|---|
| `not_finite` | A coordinate is NaN or infinite |
| `outside_range` | A show-if or a view-limit made the object invisible (not undefined, but listed in `figure` as `hidden_by: 'show'`) |
| `path_undefined` | A point on a path whose path is undefined |
| `degenerate_view` | The view is zero-sized (canvas not laid out yet); drawing is paused, no error |
| `plot_failed` | The function plotter gave up (more than 1e6 points needed, or no finite sample); the object is drawn as nothing and a reason is reported |

## 4. Gesture feedback (non-error)

Each has a `code` for tests and for the live region.

| Code | Trigger | Text | Recovery |
|---|---|---|---|
| `zoom_limit` | Wheel or pinch beyond `limits` | "Can't zoom further." | none; view unchanged |
| `precision_limit` | View width under `1e-10 * |centre|` | "Zoom is at the number precision limit here." | Suggests `@view` with a nearer centre |
| `drag_blocked` | Pointer down on an object with drag plan `none` | "A can't be moved: it is built from a midpoint. Move A or B." | Shows which free parents; one click selects them |
| `drag_fixed` | Object has `fixed = true` | "A is fixed." | Unlock via properties |
| `drag_path_undefined` | Path under the point is undefined | "Point P is on a line that has no value right now." | |
| `snap_unavailable` | Snap to a point but none in range (hint on first use only) | none | |
| `export_too_large` | Size above limit | "Choose 16,384 pixels or less per side." | Offers the max |
| `export_failed` | Canvas threw (out of memory) | "Couldn't make the image. Try a smaller size." | Offers half size |
| `clipboard_denied` | Copy as image without permission | "The browser blocked copying. Use Save instead." | |
| `selection_locked` | Click on `selectable = false` | none | |

All text is localisable. Every gesture message states what happened, why, and what to do.

## 5. Better than GeoGebra

- Every style and view mistake returns the property, the expected type or range, and the closest valid name.
- `all` lists every problem on the line, so the model corrects once.
- Warnings tell the model an object was created but cannot be seen.
- Drag refusals name the free parents the learner can move instead.
- Gesture feedback and line errors share codes so tests and the screen reader treat them the same way.

## 6. Limits

| Limit | Default | Where checked |
|---|---|---|
| Visible drawables | 10,000 | add |
| Zoom width | 1e-9 .. 1e9 and relative 1e-10 | `@view`, gestures |
| Labels | 2,000 characters; 500 auto-placed | style, layout |
| Hatch spacing | 2 .. 80 px | style |
| Line width | 0.5 .. 20 px | style |
| Point size | 1 .. 20 px | style |
| Layers | 0 .. 9 | style |
| Export side | 16,384 px; SVG 50,000 elements | export |
| Canvas count | 1 scene view in v1 | view create |

Each overflow returns `limit` with `limit`, `value`, `max`. The kernel never silently truncates.
