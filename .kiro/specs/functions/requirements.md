# Functions and curves: requirements

Function objects and numeric calculus (derivative, roots, extrema, integrals), parametric and implicit curves, inequalities, and loci and envelopes through `slice`.

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

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/functions-calculus/design.md` section 1 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R2. Our design in one picture

**User story:** As a teacher, a learner or a model driving the figure, I want our design in one picture to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/functions-calculus/design.md` section 3 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R3. Types and data structures

**User story:** As a teacher, a learner or a model driving the figure, I want types and data structures to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/functions-calculus/design.md` section 4 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R4. The algebras

**User story:** As a teacher, a learner or a model driving the figure, I want the algebras to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/functions-calculus/design.md` section 5 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R5. Piecewise functions, domains, two variables

**User story:** As a teacher, a learner or a model driving the figure, I want piecewise functions, domains, two variables to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/functions-calculus/design.md` section 6 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R6. Symbolic engine (no CAS, small and exact)

**User story:** As a teacher, a learner or a model driving the figure, I want symbolic engine (no CAS, small and exact) to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/functions-calculus/design.md` section 7 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R7. Numerical methods

**User story:** As a teacher, a learner or a model driving the figure, I want numerical methods to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/functions-calculus/design.md` section 8 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R8. The adaptive function plotter and interval mode, in plain words

**User story:** As a teacher, a learner or a model driving the figure, I want the adaptive function plotter and interval mode, in plain words to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/functions-calculus/design.md` section 9 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R9. How it plugs into the kernel

**User story:** As a teacher, a learner or a model driving the figure, I want how it plugs into the kernel to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/functions-calculus/design.md` section 10 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R10. Edge cases

**User story:** As a teacher, a learner or a model driving the figure, I want edge cases to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/functions-calculus/design.md` section 11 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R11. Build order for this area

**User story:** As a teacher, a learner or a model driving the figure, I want build order for this area to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/functions-calculus/design.md` section 13 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R12. Changes to the core design

**User story:** As a teacher, a learner or a model driving the figure, I want changes to the core design to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/functions-calculus/design.md` section 14 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R13. What the feature does

**User story:** As a teacher, a learner or a model driving the figure, I want what the feature does to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/curves-loci/design.md` section 1 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R14. Our design in one picture

**User story:** As a teacher, a learner or a model driving the figure, I want our design in one picture to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/curves-loci/design.md` section 3 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R15. Data structures

**User story:** As a teacher, a learner or a model driving the figure, I want data structures to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/curves-loci/design.md` section 4 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R16. Parametric curves

**User story:** As a teacher, a learner or a model driving the figure, I want parametric curves to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/curves-loci/design.md` section 5 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R17. Implicit curves

**User story:** As a teacher, a learner or a model driving the figure, I want implicit curves to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/curves-loci/design.md` section 6 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R18. Inequalities

**User story:** As a teacher, a learner or a model driving the figure, I want inequalities to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/curves-loci/design.md` section 7 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R19. Piecewise curves: Bezier and splines

**User story:** As a teacher, a learner or a model driving the figure, I want piecewise curves: Bezier and splines to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/curves-loci/design.md` section 8 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R20. Loci

**User story:** As a teacher, a learner or a model driving the figure, I want loci to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/curves-loci/design.md` section 9 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R21. Locus equation

**User story:** As a teacher, a learner or a model driving the figure, I want locus equation to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/curves-loci/design.md` section 10 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R22. Envelopes

**User story:** As a teacher, a learner or a model driving the figure, I want envelopes to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/curves-loci/design.md` section 11 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R23. How it plugs into the kernel and the command table

**User story:** As a teacher, a learner or a model driving the figure, I want how it plugs into the kernel and the command table to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/curves-loci/design.md` section 12 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R24. Edge cases

**User story:** As a teacher, a learner or a model driving the figure, I want edge cases to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/curves-loci/design.md` section 13 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R25. Changes to the core design

**User story:** As a teacher, a learner or a model driving the figure, I want changes to the core design to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/curves-loci/design.md` section 15 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

