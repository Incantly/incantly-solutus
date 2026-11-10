# Text, typeset maths, logic: what the learner sees and does

## 1. The Text tool and the text editor

### 1.1 Placing a text

Toolbar group "Text": **Text** (A), **Formula** (fx), **Table** (grid), **Relation** (≟).

1. Pick **Text**, click in the figure: a small editor opens at that point. Click on an object instead: the editor opens with the text anchored to that object (it follows it).
2. Type. Press **Enter** for a new line (the text is multi-line), **Ctrl+Enter** or the check button to finish, **Esc** to cancel.
3. The text appears at the clicked point with the default anchor (bottom left for world placement).

The result is a normal line, `t1 = Text("…", (x, y))`, with the style as a `with` clause. The editor works on the same `parts` the kernel keeps, so inserted objects stay references.

### 1.2 The editor

```
┌ Text ─────────────────────────────────────────────────────┐
│ The angle is [θ ▾ deg] so the triangle is [kind]          │  chips = live parts
│ and its area is $ ½ b h $ = [A ▾ 2 decimals]              │  $…$ = typeset math
├───────────────────────────────────────────────────────────┤
│ B  I  Serif   Size [16▾]  Color ■  Background ■  Border ■ │
│ [+ Object ▾]  [+ Formula]  [+ Table]  [$ off]             │
│ Preview:                                                  │
│   The angle is 70° so the triangle is acute               │
│   and its area is ½bh = 6.00                              │
├───────────────────────────────────────────────────────────┤
│ Anchor ⌜ ⌝ ⌞ ⌟ …    Rotate [0°]   Vertical □   Wrap [auto]│
│                                     [Cancel]  [OK]        │
└───────────────────────────────────────────────────────────┘
```

- **Chips**: a live part is a chip with the object name and its format. Click a chip to change the format (a small menu: automatic, 0/1/2/3/4 decimals, 3 significant figures, degrees, fraction, percent, scientific, as typeset maths). Backspace on a chip deletes the part. The chip colour matches the object's colour.
- **+ Object**: opens a list of the figure's objects (search box; numbers first); choosing one inserts a chip at the cursor. Clicking an object in the figure while the editor is open inserts it too.
- **+ Formula**: opens the formula editor (1.3) and inserts a typeset part at the cursor.
- **+ Table**: a grid picker (up to 8 by 8) that creates a `TableText` part with editable cells.
- **`$ off`**: treats dollar signs as plain characters (`latex = off`).
- **Preview**: live, uses the real renderer. An error in a part shows a red underline in the editor and the message under the preview with the first suggestion as a button.
- Autocomplete: typing `{` opens the object list; typing `$` starts a math part with its own closing `$`.

### 1.3 The formula editor (maths input)

A small WYSIWYG maths field. Typing builds the structure and the preview typesets as you type:

| Type | Result |
|---|---|
| `a/b` then space | stacked fraction (the cursor goes to the denominator; Tab leaves it) |
| `x^2` | superscript; Tab or Right leaves it |
| `x_1` | subscript |
| `sqrt` then space | root with the cursor inside |
| `pi`, `theta`, `alpha` then space | Greek letters |
| `<=`, `>=`, `!=`, `->` | `≤ ≥ ≠ →` |
| `sum`, `int`, `lim` then space | operators with limit slots |
| `(` | auto-sized fence pair |
| `\` then a letter | LaTeX macro with autocomplete |

The field stores a LaTeX-subset source string. Switching to "source" mode shows it and lets the learner edit the text directly; an unsupported macro is underlined with the error message. This replaces the all-or-nothing "LaTeX formula" checkbox of the usual text dialog: any text can have formulas in it.

### 1.4 How GeoGebra presents it and what we change

| GeoGebra | Ours |
|---|---|
| A text is plain or a LaTeX formula, chosen by a checkbox for the whole text | Plain words and formulas mix freely in one text |
| An object-insertion menu builds a joined expression the user cannot see | Objects appear as chips with a visible format; the saved line has `{name:fmt}` |
| Number format comes from a global rounding setting | Per-chip format menu |
| LaTeX errors appear as a blank or a red box | Underline plus message with the position |
| Table and relation are separate commands with their own dialogs | Table is a grid picker inside the editor and its own tool |

## 2. Placement, dragging and anchors

- **Drag** a text with the pointer: its `at` changes (world units). If it was anchored to an object (`at = A`), dragging changes the pixel offset from that object instead; the text keeps following the object.
- **Anchor corner**: when a text is selected, nine small handles show the anchor choices; clicking one changes `anchor` without moving the text on screen (the position is recomputed). The current anchor is the filled handle.
- **Screen placement**: hold **Alt** while dragging (or choose "Stay on screen" in the menu) to switch from world to screen coordinates; the text then stays fixed when the view pans or zooms. Useful for titles and legends.
- **Snap**: while dragging, texts snap to the grid if the grid snap option is on, and to other text baselines (a thin guide line) within 6 px.
- **Rotation handle**: a small circular handle above the selected text; dragging rotates about the anchor, with snapping every 15° (hold Shift for free). Typing a value in the properties panel also works.
- **Wrap handle**: a handle on the right edge sets `width` and wraps the text.
- **Zoom behaviour**: text size is in screen pixels; it does not scale with zoom. A text with `sizeIn = world` scales (useful for labels that belong to a model, such as a diagram). The default is screen pixels.

## 3. Styles and defaults

| Property | Default |
|---|---|
| Font | UI sans-serif for words; the math font for `$…$` parts |
| Size | 16 px (touch: 18 px) |
| Colour | the figure's text colour; on a dark theme, light |
| Background | none; "Add background" uses the figure paper colour at 85 % opacity so text stays readable over lines |
| Border | none; when set, 1 px with 4 px padding |
| Line spacing | 1.25 |
| Alignment | left |
| Dynamic number format | automatic (figure rounding) |
| Hit area | the text's bounding box plus 4 px |

Selecting a text opens a floating mini-toolbar with Bold, Italic, Size, Colour, Background, Delete, and "More…" for the full property panel.

## 4. What the learner sees for live text

- A text that has live parts is marked in the Algebra panel with a small "live" dot. Hovering over a live number inside the text in the figure highlights the object it comes from (outline pulse), so "where does this number come from?" is answered by pointing.
- When a live value changes, the text updates on the same frame. The changed characters briefly (150 ms) tint with the accent colour so the eye finds the change; with reduced motion, no tint.
- A dash `–` in place of a value is drawn in the "undefined" grey, with a tooltip "A is undefined: the lines are parallel".

## 5. Tables

- **Table tool**: drag a rectangle in the figure to size the grid, or click and choose rows and columns; cells are editable text fields with the same chips as the text editor. Tab moves to the next cell.
- Appearance: header row bold with a rule below when `header` is on; column alignment buttons (left, centre, right, decimal); border presets (none, grid, outer, rows). A live cell (a chip) shows its current value and updates.
- The table is one object: it moves, rotates and styles as a unit. Selecting a cell and pressing Delete clears it; Backspace on an empty row removes the row (with undo).
- Keyboard: arrow keys move between cells in navigation mode; Enter starts editing; Esc leaves.
- Screen reader: table role with row and column headers.

## 6. Logic in the interface

Most logic is invisible: it works inside lines. The few visible pieces:

- **Condition-to-show**: in the properties panel of any object, the "Show if" field takes a Bool expression (`showif = a > 2`), with a checkbox picker for existing Bool objects.
- **Conditional text**: the editor's chip menu offers "If…": a three-field insert (condition, then-text, else-text) that writes `{if(c, "a", "b")}` as a part.
- **Piecewise functions**: typing `f(x) = if(x < 0, -x, x)` in the input bar draws the function with an open circle at breakpoints where the value jumps. The Algebra panel shows the typeset piecewise definition with a brace.
- **Counting**: `CountIf`, `KeepIf` appear in the command help with examples using the binding syntax.

## 7. Relation tool

Pick **Relation**, click two objects. A popup appears near the second one:

```
┌ l1 and l2 ───────────────────────────────────┐
│ ∥  parallel                       always ✓   │
│ They are parallel however the figure is      │
│ dragged, because l2 was built parallel to l1.│
│                          [Copy as text] [Add]│
└──────────────────────────────────────────────┘
```

- The icon names the relation (∥, ⟂, =, ∈, tangent, ≠, <, >).
- The chip says `always` (green check, built into the figure), `right now` (amber, true at the current positions only), or `no` (grey).
- **Add** creates a text object `r1 = Relation(l1, l2)` at the pointer; the text is live: it changes when the figure changes.
- Dragging a free point while the popup is open updates the chip, so a learner sees `always` stay green and `right now` go grey.
- Keyboard: select two objects with Tab and Space, press **R**.
- Screen reader: the popup is a dialog with the sentence as its description.

How GeoGebra presents this: a text dialog with a short answer and a "More…" button that runs a prover on some geometric relations. Ours replaces "More…" by the always/now chip, which is computed from how the figure was built and needs no prover.

## 8. Keyboard, screen reader, touch

- **Keyboard**: **T** selects the Text tool; **Enter** on a selected text opens the editor; **F2** renames; arrow keys move a selected text by 1 px (Shift: 10 px, Ctrl: one grid step); **Delete** removes it. In the editor, **Ctrl+B/I** bold/italic, **Ctrl+M** inserts a formula part, **Ctrl+K** inserts an object.
- **Screen reader**: every text is in the hidden object list with its string value; maths parts are read with `toSpeech`. When a live text changes by a drag, a polite live region announces the new text at most once per second so the learner is not flooded.
- **Touch**: tap with the Text tool to place; a long-press on a text opens the mini-toolbar; the handles are 24 px; the formula editor uses the maths keyboard (digits, operators, Greek, templates for fraction, root, power, sum).
- **High contrast / dark**: the default text colour follows theme; background pads make text readable over lines.

## 9. Animation

- A new text fades in over 150 ms. A text built by the teacher appears when its sentence is spoken (the `draw` call lands then).
- `Highlight(t1, 3)` pulses a text's outline for three seconds.
- Text moving because its anchor object moves is not animated separately; it moves with the object each frame.
- Reduced motion: no fades, no tint.

## 10. Errors in the interface

- A line with a bad format or a bad macro: the editor keeps open, marks the part, and shows the message.
- A text that exceeds 20,000 characters: the editor refuses further input with a counter turning red.
- A `ref` whose object is deleted: the delete confirmation lists the texts that use it ("t3 also goes"), as in the kernel's delete result.
