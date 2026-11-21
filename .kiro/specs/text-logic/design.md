# Text and logic: design

Source: `docs/features/text-logic/design.md`. This file says where each piece goes.

| Piece | Where |
|---|---|
| Formats `3sf deg pct sci ord frac` | `packages/kernel/src/language/lexer.ts` (accepted names), `runtime.ts` (`formatNumber`) |
| Expression to LaTeX | `packages/kernel/src/commands/text/latex.ts`, over the language's parsed `Expr` |
| Best rational, surds, scientific, ordinals, continued fractions | `packages/kernel/src/commands/text/numtext.ts` (pure) |
| Commands | `packages/kernel/src/commands/text/index.ts`, `registerText(registry)` |
| A rule reads another object's definition | `RuleCall.definitionOf(id)` in the kernel (`graph/registry.ts`, `graph/core.ts`) |
| `implies` | a built-in function in the text area's function table hook |
| Math layout, drawn texts | `packages/view/src/core/math/` and the studio painter (round 2) |

Decisions where the docs leave room:

- `cases(...)` is not added: `if` takes any number of arms (README decision 13), which is the same thing.
- `TableText` returns a text with one math part `$\begin{array}…$`, so the layout engine draws it like any formula.
- `Related` answers from the numbers now (`basis = now`); the by-construction closure of design 5.4 is a later task.
- `VerticalText` and `RotateText` need text properties drawn by the view, so they come with round 2.
