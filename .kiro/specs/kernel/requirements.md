# Kernel and errors: requirements

The engine under the language: object store, dependency graph, ordered updates, undefined values with causes, undo and redo, batches, dry runs, drag plans, the clock and solver, save and load, and the unified error registry.

Each requirement points at the design section that holds the full rules. Where they differ, the rulings files decide (`docs/features/language/rulings.md`, `docs/features/kernel/rulings.md`), then `docs/features/README.md`.

## Shared acceptance criteria

1. WHEN a line is applied, THE SYSTEM SHALL either apply it fully or change nothing and return an error in the format of `docs/features/errors/design.md`.
2. WHEN a public function fails, THE SYSTEM SHALL return a `Result` error and SHALL NOT throw across the package boundary.
3. THE SYSTEM SHALL meet the speed and memory budgets in `docs/design/performance.md` that apply to this area.
4. THE SYSTEM SHALL NOT run JavaScript from figures or files, and SHALL use only the libraries in `docs/design/libraries.md`.
5. THE SYSTEM SHALL pass `npm run check` (lint, typecheck and every test).

## Requirements

### R1. What the kernel does for people

**User story:** As a teacher, a learner or a model driving the figure, I want what the kernel does for people to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/kernel/design.md` section 1 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R2. Everything the kernel offers (full list)

**User story:** As a teacher, a learner or a model driving the figure, I want everything the kernel offers (full list) to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/kernel/design.md` section 2 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R3. Our design: identity, objects, values

**User story:** As a teacher, a learner or a model driving the figure, I want our design: identity, objects, values to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/kernel/design.md` section 4 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R4. Applying a line: the transaction

**User story:** As a teacher, a learner or a model driving the figure, I want applying a line: the transaction to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/kernel/design.md` section 5 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R5. Update propagation, batching and undefined values

**User story:** As a teacher, a learner or a model driving the figure, I want update propagation, batching and undefined values to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/kernel/design.md` section 6 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R6. Free versus dependent, and dragging

**User story:** As a teacher, a learner or a model driving the figure, I want free versus dependent, and dragging to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/kernel/design.md` section 7 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R7. Redefinition rules

**User story:** As a teacher, a learner or a model driving the figure, I want redefinition rules to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/kernel/design.md` section 8 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R8. Object properties as kernel data

**User story:** As a teacher, a learner or a model driving the figure, I want object properties as kernel data to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/kernel/design.md` section 9 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R9. Clock, states and sliders: the hooks

**User story:** As a teacher, a learner or a model driving the figure, I want clock, states and sliders: the hooks to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/kernel/design.md` section 10 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R10. Undo and redo

**User story:** As a teacher, a learner or a model driving the figure, I want undo and redo to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/kernel/design.md` section 11 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R11. The step list (our construction protocol)

**User story:** As a teacher, a learner or a model driving the figure, I want the step list (our construction protocol) to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/kernel/design.md` section 12 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R12. Saving and loading

**User story:** As a teacher, a learner or a model driving the figure, I want saving and loading to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/kernel/design.md` section 13 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R13. New actions and queries the kernel adds

**User story:** As a teacher, a learner or a model driving the figure, I want new actions and queries the kernel adds to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/kernel/design.md` section 14 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R14. Numeric and performance targets

**User story:** As a teacher, a learner or a model driving the figure, I want numeric and performance targets to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/kernel/design.md` section 15 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R15. Changes to the core design

**User story:** As a teacher, a learner or a model driving the figure, I want changes to the core design to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/kernel/design.md` section 17 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R16. What the system does for people

**User story:** As a teacher, a learner or a model driving the figure, I want what the system does for people to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/errors/design.md` section 1 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R17. What the reference app does (in plain words)

**User story:** As a teacher, a learner or a model driving the figure, I want what the reference app does (in plain words) to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/errors/design.md` section 2 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R18. The error object (the unified format)

**User story:** As a teacher, a learner or a model driving the figure, I want the error object (the unified format) to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/errors/design.md` section 3 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R19. Kinds (index; full catalogue in `errors.md`)

**User story:** As a teacher, a learner or a model driving the figure, I want kinds (index; full catalogue in `errors.md`) to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/errors/design.md` section 4 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R20. How errors are raised

**User story:** As a teacher, a learner or a model driving the figure, I want how errors are raised to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/errors/design.md` section 5 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R21. Recovery rules

**User story:** As a teacher, a learner or a model driving the figure, I want recovery rules to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/errors/design.md` section 6 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R22. Delivery

**User story:** As a teacher, a learner or a model driving the figure, I want delivery to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/errors/design.md` section 7 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R23. Numeric failures

**User story:** As a teacher, a learner or a model driving the figure, I want numeric failures to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/errors/design.md` section 8 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R24. Limits

**User story:** As a teacher, a learner or a model driving the figure, I want limits to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/errors/design.md` section 9 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R25. Changes to the core design (section 9)

**User story:** As a teacher, a learner or a model driving the figure, I want changes to the core design (section 9) to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/errors/design.md` section 11 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

