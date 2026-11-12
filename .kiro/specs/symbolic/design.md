# Symbolic maths (CAS): design

Exact maths loaded on demand: simplify, expand, factor, solve, derivatives, integrals, limits, matrices and teaching steps, with re-enterable printed results.

## Where the design lives

The full design was written before any code, one folder per feature area:

- `docs/features/cas/` (`design.md`, `errors.md`, `agent.md`, `ui.md`)

Cross-area decisions: `docs/features/README.md` and section 13 of `docs/design/formula-language-and-kernel.md`.

## Code

- Paths: `packages/symbolic/`
- Branch: `feat/symbolic`
- Hand-off notes: `handoff/symbolic/` (builder notes, test report, findings, review)

## How it fits

- Command areas plug into the kernel through `CommandRegistry` (rules and actions), `registerTypeStyle` (styles and `with` keys) and the rule context (`ids`, `tol`, `work`, `limits`, `slice`).
- Drawing reads plain values from the kernel's event stream; the kernel never touches the DOM.
- Errors use one registry and one format, so the model can fix any error the same way.

