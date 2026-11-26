# Identically true relations: build plan

For the builder. Read `AGENTS.md`, `.kiro/specs/identically-true/` and `docs/features/curves-loci/design.md` section 13 plus `docs/features/curves-loci/errors.md` section 2. Write code only. Write no tests. Do not edit files under `packages/kernel/test/`.

## Round 1

1. The proof in design 1, beside `classify` in `packages/kernel/src/language/relation.ts`.
2. One `makeNotice('identically_true')` on the defining line (design 2). Change the registered severity from `info` to `warning`. Do not also `notify` from `runCurveRelation`.

## Round 2

1. `identicallyTrue` on the relation node and on `RelationValue` (design 3).
2. `paintCurveLike` returns immediately when the flag is set.

## Notes

Write `handoff/identically-true/builder-notes.md`: what changed, per file, and anything in the spec the code does not do.
