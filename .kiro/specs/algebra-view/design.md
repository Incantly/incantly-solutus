# Algebra view: design

## Code

- `packages/kernel/src/algebra/format.ts`: `formatNumber`, `valueTextOf`, `lineEquation`, `prettyText`, `speechText`,
  `describeObject` (with templates for common commands), `summarize`, `niceRange`. Pure; the kernel's teacher tools and
  the view read the same text.
- `packages/view/src/core/algebra.ts`: `algebraRows(objects, prefs)` gives rows and groups; `prefsFromScript` reads
  `@algebra` lines; `suggestionsFor` gives next-step cards. No DOM.
- `apps/studio/src/expressions.ts`: the list renders the model's rows: the maths text until a row is edited, the second
  row, expansion, cards, the header (filter and settings), the marble, the quick fix, history, restrictions and the
  richer signature help.
