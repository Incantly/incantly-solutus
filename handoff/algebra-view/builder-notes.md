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

## Not done

- Incremental row updates and a virtualised list (design 3.16 targets for 5,000 objects).
- Selection linking between rows and the canvas, multi-select (design 3.9).
- Range editing on the slider's end labels, play in explore mode (design 3.10).
- The `with algebra = …` per-object mode override; value throttling while playing.
- `restricted` is made by the studio, not registered as a kernel error kind.
