# Algebra view: builder notes

Built on `feat/algebra-view` from `.kiro/specs/algebra-view`.

## What is in

- Kernel `algebra/format.ts`: the text of numbers and values, Unicode definitions, descriptions, `summarize`,
  `niceRange` (exported from `@incantly/kernel`).
- View `core/algebra.ts`: rows, display modes, sorting and groups, filters, helpers, made from and used by, the
  undefined chain, `@algebra` directives, next-step cards (exported from `@incantly/view`).
- Studio: the list shows maths text and edits source; a header with a filter and display settings; the marble writes
  `with visible`; rows expand; groups collapse; "+ slider" uses `niceRange`; a missing name becomes a slider in one
  click; Alt+Up and Alt+Down for history and for the forms in signature help; F2 selects the name; `@algebra input`
  restricts commands or hides the input; next-step cards under new rows.

## Tests

`packages/kernel/test/spec/algebra/format.test.ts`, `packages/view/test/algebra.test.ts` (with a speed check: 7 ms for
2,001 rows), `apps/studio/test/algebra-view.test.ts`.

## Second round (15 November 2026): the windowed, incremental list

Picked up where the first round stopped (its draft list survived; the cache and `session.row` were rebuilt).

- **Windowed list** (`apps/studio/src/expressions.ts`): only the rows in view plus 10 above and below are in the page;
  spacers of measured (or guessed) heights stand in for the rest. `flash` scrolls an off-screen row in first.
- **Row cache** (`AlgebraCache` in `packages/view/src/core/algebra.ts`): a row is made again only when its object
  changed. Rows are lazy: pretty text, value text, description and lines are made when first read (design 3.16).
- **Value-only updates**: when only values moved (`session.structureVersion` unchanged), the list reads again only the
  rows in view (`refreshAlgebraRows`); a row out of view is refreshed when it scrolls in.
- **Kernel**: `objects()` keeps the printed text of each parsed line (nodes are never edited in place).
- `@algebra` lines are read again only when a directive changes (`session.directiveVersion`), not on every update.

Measured at 5,000 objects (2,500 reading one slider), happy-dom: a slider move costs the list 0.24 ms (target 4 ms);
a full render is well under 100 ms. Tests: `apps/studio/test/algebra-list.test.ts`, `packages/view/test/algebra-cache.test.ts`.

## Not done

- Selection linking between rows and the canvas, multi-select (design 3.9).
- Range editing on the slider's end labels, play in explore mode (design 3.10).
- The `with algebra = …` per-object mode override; value throttling while playing.
- `restricted` is made by the studio, not registered as a kernel error kind.
