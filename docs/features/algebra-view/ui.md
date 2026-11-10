# Algebra view and input bar: what the learner sees and does

The line-editing aids (colouring, completion, signature help, error strip, symbol palette, paste) are in `docs/features/language/ui.md`. This file covers the list, its rows, the controls around it, and how it works with the canvas.

## 1. Layout

The Algebra view is a panel beside the canvas (left on wide screens, a sheet from the bottom on narrow ones). From top to bottom: header, list, input bar.

```text
┌─ Algebra ─────────────────────────────┐
│ 🔍 search…     Sort ▾   Show ▾   ⚙     │  header
├───────────────────────────────────────┤
│ ● a = 3.5                         [⏵] │
│   ├──────●──────────────┤   0 ─ 10    │  slider row
│ ● A = (1, 2)                          │
│ ● B = (4, 6)                          │
│ ● s = Segment(A, B)                   │
│     = 5                               │  definition and value
│ ○ M = Midpoint(A, B)       hidden     │
│     = (2.5, 4)                        │
│ ● f(x) = x² − 2                       │
│ ● h = √(a² + b²)                      │
│     = —   undefined: b is undefined   │
├───────────────────────────────────────┤
│ ▌                                      │  input bar
│ preview: …                             │
└───────────────────────────────────────┘
```

- Width: default 320 px, resizable 220 to 600 px; below 480 px viewport width the panel is a bottom sheet with a drag handle (half height, full height).
- The list scrolls; the header and input bar stay fixed.
- The panel can be hidden (a tab on the edge); the input bar can then be summoned alone as a one-line bar at the bottom of the canvas (Enter on the canvas).

### Header controls

| Control | Action |
|---|---|
| Search box | Filters by name, definition or type; Esc clears |
| Sort menu | Creation order (default), Type, Dependency, Name, Layer |
| Show menu | Display mode (Value, Definition, Description, Definition and value); Auxiliary objects on or off; Only undefined; Only hidden |
| Settings (⚙) | Rounding (0 to 10 decimals), notation (decimal, fraction, scientific, engineering), angle unit, thousands separator |

The Show menu mirrors the model's `@algebra` directives; a lesson directive sets the starting state, and the learner may change it unless the lesson locks the panel.

## 2. A row

```text
 ◉  A = (1, 2)                                ⋮
 ○  M = Midpoint(A, B)
        = (2.5, 4)
 ▶  poly = Polygon(A, B, C)                   ⋮
        = 12.5
```

From left to right:

1. **Disclosure triangle** (only if the row has inputs or dependents), expands the "made from / used by" list.
2. **Marble** (24 px): filled with the object's colour when drawn, ringed and empty when hidden. Click toggles visibility. Objects of types that never draw (a plain number) show a small dot, no toggle; a Number with a slider shows the toggle for the on-canvas slider.
3. **Text**: first line and optional second line (the active display mode decides, design 3.2). Font 15 px (scales with system), maths in a proportional face with real superscripts and subscripts.
4. **Row menu** (⋮, appears on hover and on focus; always visible on touch).

Row states:

| State | Look |
|---|---|
| Normal | Text in ink colour on panel background |
| Hover | Light highlight; the object pulses on the canvas |
| Selected | Accent border on the left, tinted background; object highlighted on the canvas |
| Being edited | The row becomes the line editor |
| Undefined | Value shows `—` in grey; the second row gives the reason in words; a small ⚠ icon with an accessible name |
| Hidden on canvas | Marble ringed; text at 70 percent contrast (still passing 4.5:1) |
| New | Flashes with the accent colour for 600 ms (instant outline with reduced motion) |
| Warning | Small yellow dot after the name; hover shows the warning |
| Locked | A lock icon; edits refused with `read_only` |

### Row menu

| Item | Result |
|---|---|
| Rename | F2 box |
| Redefine | Enter edit |
| Duplicate | New object with the next suggested name and the same definition (for dependent objects, an independent copy of the same command) |
| Show on canvas / Hide | Toggle |
| Make auxiliary / Show in list | Toggle `aux` |
| Make slider / Remove slider | Range edit |
| Display as… | Per-object mode override |
| Copy definition | Puts the `source` text on the clipboard |
| Delete | `Delete` line |
| Properties | Opens the style editor (colour, width, label, layer) for the object |

## 3. Display modes in practice

For one figure, the same four rows in each mode:

| Mode | Rows |
|---|---|
| Definition | `A = (1, 2)` / `s = Segment(A, B)` / `M = Midpoint(A, B)` |
| Value | `A = (1, 2)` / `s = 5` / `M = (2.5, 4)` |
| Description | `Point` / `Segment between A and B` then `5` / `Midpoint of A and B` then `(2.5, 4)` |
| Definition and value | `A = (1, 2)` / `s = Segment(A, B)` then `= 5` / `M = Midpoint(A, B)` then `= (2.5, 4)` |

Switching animates the row height over 120 ms (instant with reduced motion).

## 4. Groups and sorting

- Creation order shows no group headers. Type and Layer show collapsible headers (`Points (3)`); Dependency shows `Free`, `Dependent`, `Auxiliary`.
- A header toggles with click, Enter or Space. Collapsed groups persist per figure.
- When a new object is added in a group that is collapsed, the group stays collapsed and its count increments with a brief highlight.
- Drag-to-reorder is not offered in v1: the creation order is the script order, and reordering changes meaning. A row menu item "Move after…" may come later, as a kernel `reorder`.

## 5. Editing

### Inline edit

```text
┌───────────────────────────────────────┐
│ ◉ ┌───────────────────────────────┐   │
│   │ A = (1, 2)█                   │   │
│   └───────────────────────────────┘   │
│   preview: A = (1, 2)   ✓             │
└───────────────────────────────────────┘
```

- Double-click, Enter on a focused row, or the pencil on touch.
- The editor is the shared line editor. Enter commits, Esc cancels, Tab commits and edits the next row.
- The object's marble stays; the canvas shows the ghost while typing and returns to the committed state on cancel.
- An edit that produces an error keeps the editor open with the error strip below the row.

### Number rows

A free number with a slider shows the slider under the text. The value text is also editable: click it to type a number; Enter commits.

### Drag and snap on the canvas

Dragging a free point on the canvas updates the row text live (throttled to the display rate, 3.16 of the design), rounded to the rounding setting during the drag and committed at full precision on release. Snapping to the grid (if on) shows the snapped value in the row. The row marble pulses during a drag.

## 6. Sliders

```text
 ● a = 3.5                             ⏵
   ├────────●──────────────────┤
   0                           10
```

- Track 4 px high, handle 20 px (44 px hit area). The handle shows the value while dragging in a small tooltip above.
- Keyboard: Left and Right change by one step; Shift by 10 steps; PageUp and PageDown by 10 steps; Home and End go to the ends.
- Range labels are editable by double-click (also Enter when focused).
- Play (⏵) animates; the icon becomes ⏸. Speed menu: 0.25×, 0.5×, 1×, 2×, 4×. Loop: back and forth (default), repeat, once. The animation runs only in explore mode (the film is paused or not playing); it stops when the film plays.
- The slider on canvas (`slider = canvas | both`) is a horizontal track drawn in the figure at a position set by the teacher (`with x = …, y = …`, a style pair added by the canvas area), with the same keyboard handling.
- The colour matches the object's colour. A free number with no range has no track; the "Make slider" button appears on hover.

### Slider creation from input

1. The learner types `a = 3` and Enter: row appears as `a = 3` with a small slider button on its right.
2. Clicking the button changes it to the slider with the range from `niceRange(3)` = 0..10, step 0.1, and issues `a in 0..10 step 0.1`.
3. The learner types `g(x) = k x` without `k`: the strip shows an `unknown_name` error with a chip `Create slider k from −5 to 5`. Enter on the chip, or a click, creates `k` and then `g` in one undo step.

## 7. Dependency expansion

```text
 ▼ ● M = Midpoint(A, B)
        = (2.5, 4)
     made from  [A] [B]
     used by    [h] [s2]
```

Names are small chips: click selects the object; Alt+click scrolls the list to it. For undefined rows the expansion shows the chain: `h ← b ← (deleted?)`. Depth is limited to 20 levels.

## 8. Input bar

Placement and shape described in section 1. Behaviours:

- Always visible unless the lesson sets `@algebra input off`.
- Placeholder text: `Type a line, e.g. A = (1, 2)`; changes to the first allowed command in restricted mode (`Try Midpoint(A, B)`).
- A **hint chip** row above the field shows the quick fixes or the next-step card when present.
- The bar grows to 5 lines for pasted text, then scrolls.
- Submit button (↵) at the right for touch.
- Sticky: the bar stays at the bottom of the panel while the list scrolls; on a phone it sits above the keyboard.

## 9. Next-step cards

A card is a 48 px strip below the row it concerns:

```text
 ● f(x) = x² − 2
   ┌──────────────────────────────────────────┐
   │ 💡 Mark where f crosses the x-axis  [Add] [×] │
   └──────────────────────────────────────────┘
```

- Appears 300 ms after the row is committed and the figure is settled.
- `Add` sends the card's lines as one undo group; `×` dismisses for this object; a Settings switch turns cards off.
- Keyboard: the card is the next tab stop after the row; Enter adds; Delete dismisses.

## 10. Keyboard

| Key | Action |
|---|---|
| Tab | Moves between header, list, input bar |
| Up / Down | Move row focus |
| Home / End | First / last row |
| Right / Left | Expand / collapse a row or group |
| Enter | Edit the focused row |
| Space | Toggle visibility |
| F2 | Rename |
| Delete / Backspace | Delete the object (a toast with Undo) |
| Ctrl+D | Duplicate |
| Ctrl+Z / Ctrl+Y | Undo / redo figure changes (when the focus is not in a text field) |
| Ctrl+F | Focus the search box |
| / | Focus the input bar |
| Alt+click a row | Insert the object's name into the input bar |
| Ctrl+Alt+click | Insert its definition (replacing the field) |

## 11. Screen reader

Each row is a `listitem` in a `list` labelled "Algebra". Its accessible name is built by `formatExpr(.., 'speech')` plus the type and state, in one sentence:

> "A, point, free, at one comma two, shown." 
> "s, segment, defined as segment between A and B, length five, shown."
> "h, number, undefined because b is undefined, shown."
> "a, slider, value three point five, from zero to ten, step zero point one."

- The marble is a `checkbox` role with the name `Show A`, checked state matching visibility.
- Slider handles are `slider` role with `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, `aria-valuetext` (with units; angles in degrees).
- Group headers are `button`s with `aria-expanded`.
- Changes caused by the learner are announced politely: `A defined`, `A deleted`, `A moved to 3 comma 4`; changes caused by playing are not announced except on request (a key reads the focused row's current value).
- Focus never moves unexpectedly; new rows do not steal focus.

## 12. Touch

- Rows 44 px minimum height; two-row mode 64 px.
- Swipe left on a row reveals Delete; swipe right reveals Hide; both have an Undo toast. A long press opens the row menu.
- Pinch on the panel does nothing; the panel is for reading.
- The slider handle has a 44 px target; dragging anywhere on the track jumps then drags.
- The keyboard accessory bar from the language UI sits above the platform keyboard.

## 13. Colours and style defaults

| Element | Light | Dark |
|---|---|---|
| Panel background | #FFFFFF | #1E1E24 |
| Row text | #1F2328 | #E6E6EA |
| Secondary text (value row, hints) | #57606A | #A0A0AA |
| Selected row tint | accent at 12 percent | accent at 20 percent |
| Undefined text | #8A5A00 | #E0B060 |
| Error | #B00020 | #FF8A9A |
| Accent | #0B6BCB | #6AB0FF |

Default object colours for new objects (by type, cycling, picked for contrast with white and dark backgrounds): points blue, lines and segments black or dark grey, circles and curves dark blue, functions a distinct hue per function (a palette of 8 cycling), polygons and regions at 20 percent alpha of their hue, text ink. Marbles use the object colour with a 1.5 px ring in a darker shade. All text and the marble-to-background contrast pass 3:1 for non-text.

## 14. Animation

- Row insertion: height grows from 0 over 150 ms, then the flash; removal: shrinks over 120 ms.
- Value changes during play update in place (no animation) at 10 Hz.
- Reduced motion: no growth or flash; changes are instant, new rows are announced.
- Slider play: described in section 6.

## 15. How GeoGebra presents it and what we change

| Aspect | GeoGebra | Ours |
|---|---|---|
| Default order | By object type with groups | Creation order, no groups; type and dependency one click away |
| Rows | One or two rows, mode per object by special cases | Four clear modes, one rule, per-object override |
| Undefined | `?` | Dash plus reason plus cause chain |
| Edit | Free: in place; dependent: dialog | One inline editor for both |
| Input missing names | Modal dialog | Quick-fix chip |
| Suggestions | Cards after some objects | Pure-rule cards, dismissible, off for the model |
| Insert name or value | Function keys | Alt+click and Ctrl+Alt+click |
| Dependencies | Hidden in a sort mode | Expansion with links in every sort |
| Mobile | Same list with a custom math keyboard | Bottom sheet, swipe actions, accessory bar |
| Sliders | In the row, with default ranges by dialog | Same placement, range from `niceRange`, created by a line |
