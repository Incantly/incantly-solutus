# Function images: build plan

For the builder. Read `AGENTS.md`, `.kiro/specs/geometry-reflect/` and `docs/features/polygons-transforms/design.md` sections 6.5 and 6.7. Write code only. Write no tests. Do not edit files under `packages/kernel/test/`.

## Round 1

1. `CommandForm.resultType` and the call in `inferCommand` (design 1).
2. `ArgFacts.axis`, set only for the cases in requirements R4 (design 2).

## Round 2

1. The two `Reflect(Function, …)` forms without `progress`: `resultType` from `axis`, and `reflectLineFuncRule` using `mapFunction` for an axis-parallel mirror (design 3 and 4).
2. Catalogue summary (R5).

## Round 3

1. The `Stretch(Function, line, ratio)` form without `progress`: `resultType` horizontal only, and the stretch case in `mapFunction` (design 4).
2. Catalogue summary (R5).

## Notes

Write `handoff/geometry-reflect/builder-notes.md`: what changed, per file, and anything in the spec the code does not do.
