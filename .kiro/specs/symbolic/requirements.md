# Symbolic maths (CAS): requirements

Exact maths loaded on demand: simplify, expand, factor, solve, derivatives, integrals, limits, matrices and teaching steps, with re-enterable printed results.

Each requirement points at the design section that holds the full rules. Where they differ, the rulings files decide (`docs/features/language/rulings.md`, `docs/features/kernel/rulings.md`), then `docs/features/README.md`.

## Shared acceptance criteria

1. WHEN a line is applied, THE SYSTEM SHALL either apply it fully or change nothing and return an error in the format of `docs/features/errors/design.md`.
2. WHEN a public function fails, THE SYSTEM SHALL return a `Result` error and SHALL NOT throw across the package boundary.
3. THE SYSTEM SHALL meet the speed and memory budgets in `docs/design/performance.md` that apply to this area.
4. THE SYSTEM SHALL NOT run JavaScript from figures or files, and SHALL use only the libraries in `docs/design/libraries.md`.
5. THE SYSTEM SHALL pass `npm run check` (lint, typecheck and every test).

## Requirements

### R1. What the feature does

**User story:** As a teacher, a learner or a model driving the figure, I want what the feature does to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/cas/design.md` section 1 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R2. The command set, in our syntax

**User story:** As a teacher, a learner or a model driving the figure, I want the command set, in our syntax to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/cas/design.md` section 2 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R3. Every command in the manual's groups, and what we do

**User story:** As a teacher, a learner or a model driving the figure, I want every command in the manual's groups, and what we do to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/cas/design.md` section 3 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R4. Our design

**User story:** As a teacher, a learner or a model driving the figure, I want our design to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/cas/design.md` section 5 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R5. Giac, GPL, and what it means for us

**User story:** As a teacher, a learner or a model driving the figure, I want giac, GPL, and what it means for us to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/cas/design.md` section 6 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R6. Edge cases

**User story:** As a teacher, a learner or a model driving the figure, I want edge cases to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/cas/design.md` section 8 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R7. Acceptance tests

**User story:** As a teacher, a learner or a model driving the figure, I want acceptance tests to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/cas/design.md` section 9 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R8. Phases

**User story:** As a teacher, a learner or a model driving the figure, I want phases to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/cas/design.md` section 10 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R9. Phase 2 detail: Steps

**User story:** As a teacher, a learner or a model driving the figure, I want phase 2 detail: Steps to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/cas/design.md` section 11 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R10. Changes to the core design

**User story:** As a teacher, a learner or a model driving the figure, I want changes to the core design to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/cas/design.md` section 12 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R11. Open questions

**User story:** As a teacher, a learner or a model driving the figure, I want open questions to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/cas/design.md` section 13 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

