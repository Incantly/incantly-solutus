# Formula language: design

The line language a teacher or a model writes: lexer, parser, checker, compiler, previews, signature help and autocomplete, with errors a model can fix.

## Where the design lives

The full design was written before any code, one folder per feature area:

- `docs/features/language/` (`design.md`, `errors.md`, `agent.md`, `ui.md`)
- `docs/features/algebra-view/` (`design.md`, `errors.md`, `agent.md`, `ui.md`)

Cross-area decisions: `docs/features/README.md` and section 13 of `docs/design/formula-language-and-kernel.md`.

## Code

- Paths: `packages/kernel/src/language/`, the studio language screen
- Branch: merged into `main` (PR #27)
- Hand-off notes: `handoff/language/` (builder notes, test report, findings, review)

## How it fits

- Command areas plug into the kernel through `CommandRegistry` (rules and actions), `registerTypeStyle` (styles and `with` keys) and the rule context (`ids`, `tol`, `work`, `limits`, `slice`).
- Drawing reads plain values from the kernel's event stream; the kernel never touches the DOM.
- Errors use one registry and one format, so the model can fix any error the same way.

