# Controls and scripting: requirements

Area: `docs/features/controls-scripting/` (`design.md`, `errors.md`, `agent.md`, `ui.md`). Branch: `feat/controls`.

Already built by the numbers area (`packages/kernel/src/commands/numbers/`, `.kiro/specs/numbers/`): the `Button`,
`Choice` and `Input` objects, the `on` line kind, handler storage, checked steps, runs with a counted budget and one
undo entry, `SetValue`, `Toggle`, `Animate`, `Reset`, `Click`, `ClearHandler`, the input pipeline, the host event bus
(`onControlEvent`) and `on figure load`. This spec covers what the learner and the author see and do in the studio
(numbers task 8 for controls), plus the kernel glue the studio needs.

### R1. Controls in the list (ui.md 1 to 3)

1. A `Button` row SHALL show a native button with the label. Click, tap, Enter or Space SHALL raise `click`.
2. A `Choice` row SHALL show a native `select` with one option per choice option (caption, or the formatted value;
   functions show their definition). Picking SHALL raise `change` once. An empty choice SHALL be disabled with a dash.
3. An `Input` row SHALL show the caption and a field holding the target's text. Typing SHALL raise `input`, debounced
   150 ms, and never change the figure. Enter or blur SHALL commit; Esc SHALL restore the target's text.
4. An input error SHALL show under the field as text with an icon, with `aria-invalid` and `aria-describedby`; the
   target SHALL keep its value. A notice (such as `clamped`) SHALL show in a polite live line.
5. When the target changes elsewhere, the field SHALL show the new text unless it has focus.

### R2. Learner gestures raise events (design 3.3)

1. A slider move SHALL raise `change` for the slider, at most once per frame; letting go SHALL raise `dragend`.
2. A checkbox toggle, a choice pick and an input commit SHALL raise `change`.
3. Dragging a free point SHALL raise `change`; letting go SHALL raise `dragend`.
4. Writes made by handlers SHALL NOT raise events (no loops).
5. A figure loaded from an example or a file SHALL run its `on figure load` handler once.

### R3. Runs (design 3.4, ui.md 1 and 5)

1. A run SHALL be one undo entry and one redraw.
2. An aborted run (`handler_limit`) SHALL change nothing and SHALL put a "!" badge on the button for 3 s with the
   tooltip "Something went wrong; nothing was changed."

### R4. Clickable objects (ui.md 4)

1. An object `with clickable = true` that has a click handler SHALL show a pointer cursor on hover in the graph, and a
   click on it SHALL raise `click`. Without a handler, nothing happens and the cursor does not change.

### R5. Handlers in the list (ui.md 5)

1. A control or object with handlers SHALL show its handlers under its row: each event and its steps in order, each
   step with a check mark, or "broken" with the reason.
2. Each step SHALL have a delete button (`ClearHandler(target, event, n)`).
3. `on` lines typed in the input SHALL apply as today and SHALL appear in that list.

### R6. Example and tests

1. A "Controls" example SHALL show a reset button, a function dropdown, an input box, a counter button, a guarded
   change handler and a clickable point.
2. Tests SHALL cover R1 to R5 in `apps/studio/test/`.
