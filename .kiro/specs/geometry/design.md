# Plane geometry: design

Points, lines, segments, rays, vectors, distances and angles; circles, conics and arcs; polygons and transformations, as kernel commands.

## Where the design lives

The full design was written before any code, one folder per feature area:

- `docs/features/points-lines/` (`design.md`, `errors.md`, `agent.md`, `ui.md`)
- `docs/features/conics/` (`design.md`, `errors.md`, `agent.md`, `ui.md`)
- `docs/features/polygons-transforms/` (`design.md`, `errors.md`, `agent.md`, `ui.md`)

Cross-area decisions: `docs/features/README.md` and section 13 of `docs/design/formula-language-and-kernel.md`.

## Code

- Paths: `packages/kernel/src/commands/geometry/`
- Branch: `feat/geometry`
- Hand-off notes: `handoff/geometry/` (builder notes, test report, findings, review)

## How it fits

- Command areas plug into the kernel through `CommandRegistry` (rules and actions), `registerTypeStyle` (styles and `with` keys) and the rule context (`ids`, `tol`, `work`, `limits`, `slice`).
- Drawing reads plain values from the kernel's event stream; the kernel never touches the DOM.
- Errors use one registry and one format, so the model can fix any error the same way.

