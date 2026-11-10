# Kernel: what the learner sees and does

The kernel has no screen of its own. This file defines the panels and behaviours that expose it: the object list, the step list, the properties panel, undo and redo, dragging free versus dependent objects, and how undefined, fixed and hidden objects look. Names for views come from the view package; this file says what they must show.

## 1. Object list (left panel)

```text
 Objects                    [ + ]  [ helpers: off ]
 ┌────────────────────────────────────────────┐
 │ ● A     (1, 2)                     free    │
 │ ● B     (4, 0)                     free    │
 │ ○ M     Midpoint(A, B)  (2.5, 1)           │
 │ ◌ I     Intersect(l1, l2)  undefined: they never meet │
 │ 🔒 P    (0, 2)                     fixed   │
 │ ◐ Q     (3, 3)        hidden by  a < 2     │
 └────────────────────────────────────────────┘
```

- One row per object in order. Left marble = effective visibility (solid shown, hollow hidden, half = hidden by a condition). Click toggles `visible`.
- Name and short definition; value on the right. Free objects are marked "free". Dependent ones show the rule.
- Undefined rows show the reason in plain words (from the phrase table in `../errors/agent.md`) and a dotted marble. Clicking the reason selects the root `cause` object in the list and figure.
- A lock icon for `fixed`. A dim row for `aux` (only shown when "helpers" is on).
- Double-click or Enter on a row edits the definition inline, as one line. Enter applies through the normal transaction; the result (error or ok) appears in the row, not in a dialog. Esc cancels. The edit box is pre-filled with the definition text, so redefinition needs no retyping.
- Drag a row to reorder only when legal. While dragging, illegal drop positions show a red rule and the tooltip "A is needed above this" naming the object; a "move with inputs" option appears on drop.
- Delete key on a selected row opens a small inline confirm if the delete cascades ("also removes M, c"), listing names; no confirm for a leaf.
- Keyboard: ↑/↓ move, Space toggles visible, F2 rename, Enter edit, Delete remove, Ctrl/Cmd+Z undo.

GeoGebra shows the algebra list similarly but allows the "create slider?" prompt for unknown names and shows an opaque "?" for undefined. We replace both.

## 2. Input line

One input line under the figure, always focused with `/`. Typing shows a live preview from `apply(..., { dryRun: true })`: a faint ghost of the object, or a one-line error under the caret with the hint, e.g.

```text
 > M = Midpoint(A, Bb)
                    ^^
   Bb is not defined. Did you mean B?   [use B]
```

The `[use B]` button inserts the first `suggest`. Enter commits. Up/Down recalls previous lines. Tab completes names and commands from the catalogue.

## 3. Step list (build replay)

```text
 Steps     |◀ ◀   ▶   ▶▶|   3 / 7        [ ⟳ play ]  speed ─●─
 ┌──┬────────┬──────────────────────────┬────────────────────────────┐
 │ 1│ A      │ (0, 0)                   │ A is a free point at (0,0) │
 │ 2│ B      │ (4, 0)                   │ B is a free point at (4,0) │
 │ 3│ M      │ Midpoint(A, B)           │ M is the midpoint of A and B│
 │ ─ Bisect AC ────────────────────────────────────────────────────  │
 │ 4│ N      │ Midpoint(A, C)           │ ...                         │
 └──┴────────┴──────────────────────────┴────────────────────────────┘
```

- The bar scrubs the reveal cursor (kernel `stepTo`). Objects after the cursor are not drawn and not listed in the object list; the step list shows them dimmed so the learner sees what is coming.
- Titles from `@step` appear as dividers and are stops; without titles, every row is a stop.
- Play animates the cursor at the chosen speed (default one stop per 1.2 s, reduced to a single instant jump under reduced-motion). Newly revealed objects fade in over 250 ms and get a brief highlight ring; nothing else moves.
- Clicking a row selects its object in the figure and in the object list. Double-clicking a row jumps the cursor to it.
- The sentence column is the generated text from the command table. It is also what a screen reader says.
- Row actions (menu): delete (with cascade confirm), insert after (puts the input line in "insert at 4" mode with the position shown), move, copy definition.
- Keyboard: ←/→ previous/next stop, Home/End, Enter select, P play/pause.
- Export: "copy as lesson notes" copies the sentences as an ordered list.

GeoGebra's table has the same intent (name, definition, value, breakpoint, navigation bar) and an export-as-web-page tool. We keep the table and the navigation, drop the separate dialog, add the sentence column and cursor-based hiding.

## 4. Properties panel

Opens beside the figure for the selected object(s). Sections, in order; every control writes a `with` clause so the same change is a script line and a journal entry.

```text
 M  (Point)                      [ x ]
 Basics    name [M___]   caption [__________]   label [name v]
           ☑ visible  ☐ fixed  ☑ selectable  ☐ helper (aux)
 Colour    ■ swatch  [blue v]   opacity ──●── 1.0
           ( ) fixed colour  (•) from a rule  [ hsl(360*a/10, 1, 0.5)____ ] ✓
 Style     point size ─●─ 4   shape [dot v]   line width ─●─ 2   line [solid v]   fill [none v]
 Show      show only when [ a < 3 __________ ]  ✓  (currently: shown)
 Layer     [0 1 2 3 4 5 6 7 8 9]   (higher is on top)
 Extras    ☐ leave a trail   tooltip [auto v]   tags [step1, legend]
```

- Rule fields (colour, opacity, show-only-when) use the same inline editing as the input line: live validation, error text under the field, `[use ...]` suggestions, and a preview of the result (for colour, the swatch shows the colour at the current values).
- A rule field showing a name that no longer exists turns amber with "this used to follow `a`; now using the fixed colour".
- Multi-select shows only controls valid for all selected objects, with a dash where values differ; changing one writes the line to every selected object as one journal group.
- Colour picker: the 12 default palette swatches plus custom; contrast with the background is checked; swatches have names for screen readers.
- No separate Apply button: each control applies on change (sliders on release), debounced by 60 ms while dragging a slider; the value shown follows the pointer immediately.

GeoGebra spreads these over tabs (Basic, Colour, Style, Advanced, Algebra, Scripting) in a dialog. We keep one scrolling panel so the common controls are always visible, and leave scripting out.

## 5. Undo and redo

- Buttons top-left and Ctrl/Cmd+Z / Shift+Ctrl/Cmd+Z. Tooltips name the action: "Undo: moved A", "Undo: added M and N (2 lines)".
- One click undoes one journal group: a drag, a property change, or the teacher's last utterance.
- After undo, the objects touched flash once (180 ms ring) so the learner sees what changed. Deleted objects reappear with a fade-in. Reduced motion: no flash, only the toast.
- A small toast says what happened: "Undid: added M". Auto-hides after 3 s; screen reader announcement through the live region.
- The history is not shown as a list in v1. (Possible later: a recent changes drawer fed by the journal.)

## 6. Dragging

- **Free point**: hover shows a ring and a grab cursor; drag moves it live (one frame per pointer event, coalesced); optional snap to grid (`Shift` toggles); on release one journal group.
- **Point on a path**: slides along the path; the pointer position is projected; at the path's end it stays at the end.
- **Dependent object**: pointer is an arrow; hovering shows "built from A and B". If the kernel's `dragPlan` returns writes (invertible rules), dragging moves the free parents and a tooltip says so ("moves A"). If not, a short shake animation (disabled under reduced motion) and the tooltip "M follows A and B. Drag A or B."
- **Fixed object**: lock cursor; click selects but cannot drag; a tooltip says "pinned".
- **Slider**: the usual track and thumb; keyboard ←/→ one step, Shift for 10 steps, Home/End min/max. Number shows beside the thumb.
- **Checkbox (free Bool)**: click or Space toggles; label shows the object caption or name.
- **Hit order**: higher layer first, then labels, then points, then edges, then fills (core design section 8). Objects with `selectable = false` are skipped.
- **Touch**: a 44 px minimum hit target for points; long press to select without dragging; two-finger pan and pinch zoom never move objects.

## 7. Hidden, undefined, fixed, auxiliary: visual language

| State | In the figure | In the list |
|---|---|---|
| Hidden by property | not drawn | hollow marble |
| Hidden by condition | not drawn | half marble + "hidden by <cond>" |
| Undefined | not drawn; if selected from the list, a small badge at the last known place with the reason | dotted marble + reason |
| Fixed | drawn normally; lock glyph on hover | lock |
| Aux | drawn normally | hidden unless helpers on |
| Behind reveal cursor | not drawn | dimmed in step list, absent in object list |

Colour is never the only signal: marbles differ in shape, undefined has text, fixed has a glyph.

## 8. Layers and draw order

Layer 0 at the back. The properties panel shows ten numbered chips. "Bring to front" and "Send to back" set the layer one above the highest, or one below the lowest, layer in use (within 0..9), and say so when the limit is reached. Layers are for z-order only; they do not change selection groups.

## 9. Screen reader and keyboard

- The hidden DOM list from the core design lists each object as `name, type, value or "undefined, reason", shown or hidden, fixed`. It updates through a polite live region, throttled to one announcement per second; during playback only changes marked `announce` by the film are spoken.
- Every control has a label; every colour has a name; the step list is a table with row headers.
- Focus order: input line, object list, figure, properties, step bar.

## 10. Defaults for new learners

Helpers off, grid on (from `@grid`), snap off, labels `name` for points and `none` for others, step speed 1.2 s, toasts on, preview ghost on.
