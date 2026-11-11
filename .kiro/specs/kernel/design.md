# Kernel and errors: design

The engine under the language: object store, dependency graph, ordered updates, undefined values with causes, undo and redo, batches, dry runs, drag plans, the clock and solver, save and load, and the unified error registry.

## Where the design lives

The full design was written before any code, one folder per feature area:

- `docs/features/kernel/` (`design.md`, `errors.md`, `agent.md`, `ui.md`)
- `docs/features/errors/` (`design.md`, `errors.md`, `agent.md`, `ui.md`)

Cross-area decisions: `docs/features/README.md` and section 13 of `docs/design/formula-language-and-kernel.md`.

## Code

- Paths: `packages/kernel/src/graph/`, `clock/`, `history/`, `errors/`, the studio kernel screen
- Branch: merged into `main` (PR #28, PR #29)
- Hand-off notes: `handoff/kernel/` (builder notes, test report, findings, review)

## How it fits

- Command areas plug into the kernel through `CommandRegistry` (rules and actions), `registerTypeStyle` (styles and `with` keys) and the rule context (`ids`, `tol`, `work`, `limits`, `slice`).
- Drawing reads plain values from the kernel's event stream; the kernel never touches the DOM.
- Errors use one registry and one format, so the model can fix any error the same way.

