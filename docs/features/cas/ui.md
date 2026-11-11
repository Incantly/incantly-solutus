# Symbolic maths: what the learner sees and does

## 1. The CAS view

A panel next to the figure (right side on wide screens, a bottom sheet on phones). It is a **view over the figure's symbolic objects**: every row is one object line (`Expr`, `Cond`, a list of those, or a `Symbol`), in creation order. It is not a second document.

```
┌ CAS ─────────────────────────────────────────────── [⋮] ┐
│ [Simplify][Expand][Factor][Solve][d/dx][∫][Substitute][N]│  toolbar
├──────────────────────────────────────────────────────────┤
│ c1 │ x² − 5x + 6 = 0                                  ○  │  input (typed form)
│    │                                                      │
│ c2 │ Factor(LeftSide(c1))                             ●  │
│    │ = (x − 2)(x − 3)                                     │  output
│ c3 │ Solve(c1, x)                                     ○  │
│    │ = { x = 2,  x = 3 }                                  │
│ c4 │ Numeric(sqrt(2), 20)                                 │
│    │ ≈ 1.4142135623730950488                              │
│ c5 │ Solve(x + e^x = 3, x)                                │
│    │ ⚠ no exact method     [Try numeric]                  │
│ ▸  │ _                                                    │  new row
└──────────────────────────────────────────────────────────┘
```

- **Row number** (left): the row's name. Click to rename. Drag to reorder: the kernel reorders only if every input still comes before the row; otherwise the row bounces back with the message "c4 uses c6".
- **Input**: our syntax, with a typeset preview while typing. Typing `x^2` shows x² as a preview above the field. Names autocomplete from the figure and the command table.
- **Output**: typeset maths. Exact values print exactly; approximations print with `≈`. A tap on an output copies its text form; a long press (right click) offers "copy as LaTeX", "copy as text", "use in new row".
- **Marble** (right edge, `○`/`●`): the row's `visible` property. Only rows with something to draw have one (section 7).
- **Reference chips**: names of other rows inside an input are shown as chips; hovering one highlights its row. Click moves focus to that row.
- **Text rows**: a line starting with `#` is shown as a note with a lighter background, used for headings like "Step 1: factor".

### How the reference app presents it, and what we change

| The reference app | Ours | Why |
|---|---|---|
| Row has input and output in one cell; toolbar edits the row in place | Toolbar buttons add a **new row** that uses the selected row (`c2 = Factor(c1)`) | The worked solution stays visible; the lines are the derivation; teacher and learner see the same list |
| Two reference styles (live and frozen) with different symbols | Names are always live; a "freeze" button on a row (`Freeze`) makes a free copy | One concept; freezing is an explicit action |
| Evaluation, numeric and keep-input toggles per row | Three plain buttons add rows: `Evaluate`, `Numeric`, `Hold` | The mode is part of the line, not hidden state |
| A twin object for named rows | No twin; the row is the object | No sync problems |
| Blocking evaluation with a wait cursor | Dimmed previous output plus a thin progress bar on the row until the result settles | Dragging never stutters |
| Error: dialog or question mark | Error under the input with a fix button; undefined result shows reason and suggestion in the output | Learner and teacher both see why |

## 2. The toolbar

Buttons add a row; if a row is selected the new row uses it, else it uses the previous row.

| Button | Row added | Notes |
|---|---|---|
| Simplify | `cN = Simplify(cK)` | |
| Expand | `Expand(cK)` | |
| Factor | `Factor(cK)` | If `cK` is a Cond, uses `LeftSide(cK)` |
| Solve | `Solve(cK, v)` | `v` is picked: if exactly one unknown is free, that one; otherwise a small chooser appears |
| d/dx | `Derivative(cK, v)` | |
| ∫ | `Integral(cK, v)` | A long press offers the definite form with two bound fields |
| Limit | `Limit(cK, v, a)` | Opens a one-field prompt for `a` |
| Substitute | `Substitute(cK, old, new)` | Opens a two-field prompt; the dropdown lists the unknowns |
| N | `Numeric(cK, d)` | A stepper beside the button sets digits (default 15) |
| ⋮ | Menu: Evaluate, Hold, MixedNumber, Equivalent, Steps (when available), Freeze, Delete row | |

Selecting part of an output (drag across `x − 2`) offers "Use selection": the selected sub-expression becomes a new row (`Part` of the tree, built from a path, so the exact sub-tree is taken, not the printed text).

## 3. Input behaviour

- **Enter** commits the line and opens a new row. **Shift+Enter** inserts a line break inside a long input. **Esc** cancels editing and restores the old text.
- **Up/Down** moves between rows; at the input of the new row, **Up** inserts the previous row's name (the "row above" feature), pressed twice replaces it by the row before.
- **Tab** accepts an autocomplete; **Ctrl+Space** lists commands that accept the current selection's type.
- **Typing `/`** after a complete term turns it into a stacked fraction in the preview (the stored text remains `a/b`).
- **Greek and operators** follow the figure's input bar: `pi`, `theta`, `<=` become `π`, `θ`, `≤` in the preview.
- **Unknown letters**: when a line uses an unknown one-letter name, a small bar offers "Create unknown `k`" which adds `k = Symbol()` above the row. This is our answer to the reference app's silent guessing: the creation is visible and takes one tap.
- **Errors**: red underline on the token, message under the field, the first `suggest` line as a button.

## 4. Showing an answer on the graph

The marble switches the row's `visible` property. The view draws the value through an adapter (section 7). A row can be drawn in the figure's graphics area with the object's style (colour, width), listed in the Algebra panel, and styled as any object.

When a symbolic row is `visible`, the same object name can be used in ordinary lines: a row `c3 = ToFunction(...)` is a Function; a row of type Expr can be given to `ToFunction` or `ToNumber` by the teacher. The CAS view does not create those automatically.

## 5. Exact versus numeric display

- Exact values: `√2/2`, `3/7`, `π/6`. Fractions are stacked in the typeset output.
- Approximations: `≈ 0.7071`. The number of digits follows the row's `display.digits` (set by `Numeric`) or the figure's global rounding.
- A toggle at the top of the panel, `Exact | 1.23`, switches the **display** of all rows without changing any definition (exact values still hold). Hover on an exact output shows a tooltip with the decimal; hover on an approximate one shows the exact form if known.
- Mixed numbers (`MixedNumber`) print as `2 3/4`.
- Inexact results carry `≈` in the margin and a small icon `~`; a screen reader reads "approximately".

## 6. Colours, type and defaults

- Panel background: the figure's panel colour. Input text: the main text colour at 100%. Output text: same colour, slightly larger (1.1 times). Row number: 60% opacity.
- Errors: the figure's error colour (red) for underline and message; warnings (notices) use amber; pending uses the main colour at 50% with a 2 px indeterminate bar.
- Hole markers (excluded values) show as a small `∖{1}` suffix in the output ("except x = 1") in the notice colour.
- Default rounding: 15 significant digits for `Numeric`, and rounding for display 4 decimals when the global setting says "display 4".
- Typeset font: the figure's math font (a font with the OpenType MATH table), at 16 px on desktop and 18 px on touch.

## 7. Plot adapters (what a row draws)

| Value | Drawn as |
|---|---|
| `Expr` with one free unknown | A curve `y = e` over the visible range, with holes at `excluded` values (open circles) |
| `Expr` with no free unknown | Nothing (no marble); a numeric value is shown in the row only |
| `Cond` with one unknown and `==` | Points on the x axis; with inequalities, shaded intervals on the x axis |
| `Cond` with two unknowns | An implicit curve (equation) or a shaded region (inequality) |
| `List<Cond>` of `x == a` | Vertical lines or points on the axis, depending on the row's `plotAs` property (default: points) |
| `List<List<Cond>>` of `{x == a, y == b}` | Points |
| `List<Expr>` | Nothing, unless every item is a number (points on the axis) |
| `Symbol` | Nothing |

Default colours for rows: cycle through the figure palette in row order, so each row has a stable colour. Holes are drawn as open circles in the curve's colour.

## 8. Keyboard, screen reader, touch

- **Keyboard**: every toolbar button has a letter shortcut when the CAS view has focus (S simplify, E expand, F factor, V solve, D derivative, I integral, N numeric). Row navigation as in section 3. The marble toggles with Space when the row number has focus.
- **Screen reader**: each row is a list item with `aria-label` "row c2: Factor of the left side of c1; result: the product of x minus 2 and x minus 3". Outputs expose `toSpeech` text; the typeset maths is `aria-hidden`. A pending row announces "calculating" and, when settled, "result ready". Errors are announced as alerts.
- **Touch**: the keyboard is the figure's maths keyboard, with a tab of symbolic commands. Long-press on an output opens the same menu as right click. Rows can be swiped left to delete (with undo toast) and long-pressed to drag.
- **Reduced motion**: no animated progress bar; the pending state is shown as "…" at the end of the row.

## 9. Animation

- A new row's output fades in over 120 ms. When an output changes because an input changed, the old value cross-fades to the new (150 ms). With reduced motion, instant.
- Playing a film: the CAS view highlights the row the teacher is talking about (`Highlight(c2, 3)` pulses the row) and scrolls it into view. Rows added by the teacher appear one at a time, 200 ms apart when a `draw` call adds several.
- The marble toggle fades the curve in or out over 150 ms.

## 10. The teacher's view

When the live teacher builds a derivation, the CAS view shows it as it grows. Each row the teacher adds is marked with a small avatar dot until the learner touches it. The learner can click any row to ask "why?" (this sends the row's text to the teacher as a question). The learner's own rows have no dot.

## 11. Scenes the view must handle

- 200 rows: virtualised list, row height cached; scroll position kept across edits.
- A row with a 2,000-character output: collapsed to one line with "show more".
- A row that becomes undefined after an upstream change: its previous output stays but is struck through in grey, with the reason chip.
- Deleting a row that others use: confirmation listing the dependents ("c4 and c6 also go"), as in the kernel's delete result.
