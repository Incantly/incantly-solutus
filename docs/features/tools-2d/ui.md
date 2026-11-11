# 2D tools: what the learner sees and does

## 1. The tool strip

```text
 ┌─────────────────────────────────────────────────────────────────┐
 │ [↖]  [•]▾  [╱]▾  [⟂]▾  [▱]▾  [◯]▾  [⌓]▾  [∠]▾  [⇄]▾  [A]▾  [▮]▾ │
 └─────────────────────────────────────────────────────────────────┘
   Move Point Line  Special Poly  Circle Conic Meas. Transf. Text  Controls
```

- Each group is one button showing the last-used tool of that group. Tapping or pressing Enter on the button activates it; a small arrow (or long-press, or the Down key) opens the group's drawer with all its tools, each with an icon and a name.
- The strip scrolls horizontally on narrow screens; the drawer is a bottom sheet on phones.
- The first group (Move) always shows the Move tool; `Esc` returns there.
- Toolbars are built from the `ToolSpec` table; the order of groups is data and can be changed per lesson (`@tools move point line circle` limits what the learner may use, so a lesson about perpendiculars can show only the needed tools).

### Hint line

Below the strip, one line of text says what to do next, with the tool name in bold:

```text
Circle through 3 points: click the second point.   (Backspace: undo last click · Esc: leave tool)
```

It is a polite live region. It shows the refusal text in place when a click does not fit, in a warm colour with an icon (not colour alone).

### Tooltip

On hover (and on focus) a tool shows its name and one sentence ("Draws the circle that passes through three points.") plus its keyboard shortcut if any. The sentence is the first variant's prompt chain.

## 2. Using a tool

1. Pick a tool. The cursor changes to a crosshair with a small icon of the tool.
2. Hover: the object under the pointer that would be picked gets a halo; if the click would make a new point, a hollow ring shows where, with a label of how ("on circle c", "crossing of a and b", "grid", or nothing for free).
3. A ghost of the result follows the pointer once enough picks exist.
4. Click: picks are numbered in a small pill beside each ("1", "2", "3"), so the order is visible for tools where order matters (Angle).
5. On the last click the object appears at full strength and is selected; the hint line returns to step 1.
6. If a number is needed, an inline field opens at the pointer:

```text
 Radius [ 3        ]   ← Enter to accept, Esc to cancel
         ▾ use slider
```

Fields accept formulas and names; "use slider" turns a literal into a slider (same as Alt on commit).

### Touch

- Tap to pick. While a finger is down the preview shows; lifting picks.
- Press and drag a pending point to place it exactly; the magnifier loupe (60 px circle, 2x) appears above the finger.
- Two-finger gestures still pan and zoom during a tool.
- A "Done" pill appears for tools that end by Enter (polygon, polyline, create list).

### Keyboard

| Key | Action |
|---|---|
| `Ctrl+1` ... `Ctrl+9` | Jump to the first nine groups' current tools |
| Arrow keys in the tool strip | Move between tools |
| Enter on a tool | Activate |
| `Esc` | Drop last pick, or leave the tool |
| `Backspace` | Drop last pick |
| With a tool active: arrow keys | Move the virtual cursor by one grid step (or 10 px if no grid); `Shift` ×5, `Alt` ÷5 |
| Enter or Space | Click at the virtual cursor |
| Tab | Cycle the hit list at the cursor ("1 of 3: A, a, c") |
| `Alt` held during a click | Special alternative where the tool defines one (reflex angle, clockwise, make slider, accept a degenerate pick) |

### Screen reader

- Tool strip: `role="toolbar"`, each tool a button with `aria-pressed`, label "Circle through 3 points, group Circles and arcs".
- Hint line is `aria-live="polite"`.
- Cursor position is spoken when it changes: "At 1.5, 2. On circle c." (rate-limited)
- After commit: "Created circle c through A, B and C. 1 undo available."

## 3. Per-group behaviour

| Group | Notes for the learner |
|---|---|
| Move | Press and drag; a click selects. Rotate-around shows a dial. Dragging a free object shows its new coordinates by the pointer. |
| Point | Auto creation shows what the click would make. Roots and Extrema add several points at once; the toast says how many. |
| Line, special line | A ghost line follows the pointer after the first point. Order-free tools (Perpendicular: point or line first) accept either. |
| Polygon | A closing handle (ring) shows on the first point when three or more points are placed; click it or press Enter. Backspace removes the last vertex. |
| Circle and arc | The ghost circle shows the radius as a number at the pointer. Compass shows the copied length on the original segment. |
| Conic | After each pick, a faint curve appears when enough picks exist (the focus pair shows after two). |
| Measurement | The readout appears at the click and can be dragged. Angle shows pick numbers; the learner sees which angle will be measured by the arc preview. Alt makes the reflex angle. |
| Transform | Ghost image follows the pointer: the reflection updates as the learner moves over candidate mirrors. |
| Special | Text opens a small editor with a maths toggle and an `{expr}` insert menu. |
| Action | Sliders and check boxes appear at the click and can be dragged in the view. |
| General | Show/hide shows hidden objects as ghosts; Delete shows the list of what will go as a tooltip on hover ("Deleting c also deletes P, Q") and a toast with Undo after. |

## 4. After the tool: lines panel

A collapsible "Lines" panel shows the figure's script. After a tool, the lines it wrote are highlighted for two seconds:

```text
 A = (-1, 1)
 B = (1, 2)
 C = (3, 0.5)
▶ c = Circle(A, B, C)        ← highlighted, with a small circle icon
```

Editing a line in this panel runs it as a redefinition with all the checks. This connects the tool to the language: a learner sees that clicking wrote a sentence. It is closed by default for young learners.

## 5. Teacher controls (author)

- `@tools group...` or `@tools all` or `@tools none` to choose what the learner sees. Default `@tools move point line circle polygon measure transform`.
- `Suggest(tool)` pulses a tool.
- Tools the teacher or lesson has disabled show as disabled with a tooltip "Not used in this lesson".

## 6. How the reference app presents it, and what we change

| The reference app | Ours |
|---|---|
| Toolbox arrow in a corner of a tool icon (desktop) or tap to open (web) | Group button plus drawer; long-press and Down key also open it |
| Tooltip with a one-line how-to and a link to help | Hint line that changes at each step and shows refusals |
| Free points appear while building and can be left behind | Nothing exists until the last click |
| Modal dialogs for radius, angle, sides, slider settings | Inline fields at the pointer; sliders get a small inline form |
| Object-first selection exists but is undiscoverable | Shown as a hint: "Tip: select objects first, then pick the tool." in the drawer |
| Algebra view hides how clicks became commands | Lines panel shows the sentence a click wrote |
| Toolbars customised in a dialog | `@tools` and a lesson-level toolbar setting |
| Tools tied to the mouse | Keyboard cursor and screen-reader announcements |

## 7. Default look of tool feedback

| Element | Look |
|---|---|
| Hover halo | `#1a5fd1` 5 px at 35% |
| Pending point | Hollow ring, 6 px radius, 2 px stroke in the point colour |
| Pick number pill | 16 px circle, white on `#1a5fd1`, 11 px bold |
| Ghost result | Object's default style, 60% opacity, dashed strokes |
| Refusal message | Amber `#b45f06` text on `#fff4e0`, with a "!" icon |
| Snap target | + for grid, ring for point, with pill label |
| Closing handle (polygon) | Ring 10 px, `#e8820c` |
| Reduced motion | Pulses become steady rings; no ghost animation |
