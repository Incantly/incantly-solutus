# 2D tools: requirements

Area: `docs/features/tools-2d/` (`design.md`, `errors.md`, `agent.md`, `ui.md`). Branch: `feat/tools-2d`.

### R1. Tools are data

**User story:** As a learner, I want to build a figure by clicking, so that I can construct without typing.

1. THE SYSTEM SHALL describe every tool as a `ToolSpec`: id, group, label, a one-sentence description, kind
   (`construct`, `query`, `mode`, `edit`), sticky flag, and variants made of slots (design 4).
2. The catalogue SHALL hold the v1 tools of design 6 whose commands exist. Deferred tools SHALL be listed with the
   reason, not shipped.
3. A build test SHALL run every variant's `emit` with example picks through the real kernel, and SHALL fail on a spec
   whose two full variants accept the same picks (`ambiguous_variants`).

### R2. One engine

1. A single `ToolSession` SHALL consume clicks, keys and typed numbers for every tool (design 5.1).
2. Variants SHALL narrow as picks arrive (5.2); a click SHALL become a pick by the rules of 5.3: existing point,
   intersection, point on a path, free point, each only when the slot allows it.
3. Objects selected before the tool starts SHALL be used as picks in order (5.4).
4. `Esc` SHALL drop the last pick, or leave the tool when there is none; `Backspace` SHALL drop the last pick; `Enter`
   SHALL close a repeating tool (polygon, polyline, list).
5. A click that fits no slot SHALL give a refusal from errors.md 2 with a message and a hint, and the session SHALL stay
   on its step.

### R3. Lines, names and one undo step

1. Every tool SHALL only write script lines. New points SHALL exist only in the session until the tool completes;
   cancelling SHALL leave nothing.
2. Names SHALL come from the sequences of design 5.7, skipping reserved and used names.
3. A completed tool's lines SHALL be applied as one atomic batch and one undo step; a failing batch SHALL be the
   wrapped error of errors.md 3 and leave the session on its last pick.

### R4. Previews

1. With enough picks, the result SHALL be previewed from the same lines run on a scratch copy of the figure, using the
   pointer as the missing point, at most once per frame.
2. An undefined preview SHALL hide the ghost and the hint line SHALL say why in the words of errors.md 4.

### R5. The studio

1. A tool strip of groups with drawers, a hint line (`aria-live="polite"`), and keyboard access (arrows in the strip,
   Esc, Backspace, Enter) (ui.md 1, 2).
2. Hover halos, pending points as hollow rings with numbered picks, the ghost, and an inline number field with formulas.
3. The lines a tool wrote are highlighted in the expression list after it completes (ui.md 4).
4. Points on paths and other dependent points that can be inverted SHALL be draggable with the Move tool.
5. Conics, arcs, sectors, polylines and lists of lines SHALL be drawn.

### R6. Speed

1. Hit list under 0.3 ms at 1,000 objects; tool engine step well under a frame (design 8).

## Decided against the design

- **Readouts (T8), `place` for new widgets (T9), `Suggest` and `@tools` (T11) and learner events (T10)** belong to the
  view and teacher areas; the tools here write the lines without a readout.
- **Deferred tools:** `freehand-shape`, `record-to-table`, `complex-number`, `rigid-polygon`, `vector-polygon`,
  `image`, `pen`, `freehand-function`, `function-inspector`, `button`, `input-box` (no commands yet); `text` (no `Text`
  command yet); `polar-diameter`'s diameter variant (no `Diameter`); `copy-style` and `show-hide-label` (the studio's
  colours and labels are not figure styles yet).
- **Tangents** write one `List<Line>` line, because `Tangent` returns a list.
- **Regular polygon** writes `Polygon(A, B, n)`, the form that already exists, not `RegularPolygon`.
- **Roots and extrema** write one list over the visible range (`Roots(f, x0, x1)`, `Extremum(f, x0, x1)`), the forms
  that exist, rather than one `Root(f, a, b)` line per bracket.
- **Intersections of two functions** write one list over the view; of two straight objects one point; otherwise one
  `Intersect(a, b, i)` line per crossing, up to four.
- **Hidden objects** use `with visible = false`; the show/hide tool flips it.
