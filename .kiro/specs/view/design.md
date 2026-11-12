# Renderer: design

Our own 2D and 3D renderer: scene, camera, picking, drag, labels, WebGL 2 with SVG and Canvas 2D fallbacks, one shared GPU context per page, and the figure scheduler.

## Where the design lives

The full design was written before any code, one folder per feature area:

- `docs/features/graphics-view/` (`design.md`, `errors.md`, `agent.md`, `ui.md`)
- `docs/design/performance.md`

Cross-area decisions: `docs/features/README.md` and section 13 of `docs/design/formula-language-and-kernel.md`.

## Code

- Paths: `packages/view/`
- Branch: `feat/view`
- Hand-off notes: `handoff/view/` (builder notes, test report, findings, review)

## How it fits

- Command areas plug into the kernel through `CommandRegistry` (rules and actions), `registerTypeStyle` (styles and `with` keys) and the rule context (`ids`, `tol`, `work`, `limits`, `slice`).
- Drawing reads plain values from the kernel's event stream; the kernel never touches the DOM.
- Errors use one registry and one format, so the model can fix any error the same way.

