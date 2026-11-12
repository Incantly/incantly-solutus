# Plane geometry: requirements

Points, lines, segments, rays, vectors, distances and angles; circles, conics and arcs; polygons and transformations, as kernel commands.

Each requirement points at the design section that holds the full rules. Where they differ, the rulings files decide (`docs/features/language/rulings.md`, `docs/features/kernel/rulings.md`), then `docs/features/README.md`.

## Shared acceptance criteria

1. WHEN a line is applied, THE SYSTEM SHALL either apply it fully or change nothing and return an error in the format of `docs/features/errors/design.md`.
2. WHEN a public function fails, THE SYSTEM SHALL return a `Result` error and SHALL NOT throw across the package boundary.
3. THE SYSTEM SHALL meet the speed and memory budgets in `docs/design/performance.md` that apply to this area.
4. THE SYSTEM SHALL NOT run JavaScript from figures or files, and SHALL use only the libraries in `docs/design/libraries.md`.
5. THE SYSTEM SHALL pass `npm run check` (lint, typecheck and every test).

## Requirements

### R1. What the learner and the teacher get

**User story:** As a teacher, a learner or a model driving the figure, I want what the learner and the teacher get to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/points-lines/design.md` section 1 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R2. Shared geometry value model

**User story:** As a teacher, a learner or a model driving the figure, I want shared geometry value model to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/points-lines/design.md` section 3 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R3. `Intersect`: every case

**User story:** As a teacher, a learner or a model driving the figure, I want `Intersect`: every case to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/points-lines/design.md` section 4 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R4. Special lines, directions, centres

**User story:** As a teacher, a learner or a model driving the figure, I want special lines, directions, centres to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/points-lines/design.md` section 5 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R5. Points on paths and regions

**User story:** As a teacher, a learner or a model driving the figure, I want points on paths and regions to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/points-lines/design.md` section 6 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R6. Measures

**User story:** As a teacher, a learner or a model driving the figure, I want measures to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/points-lines/design.md` section 7 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R7. Loci and traces

**User story:** As a teacher, a learner or a model driving the figure, I want loci and traces to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/points-lines/design.md` section 8 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R8. Rules and the command table

**User story:** As a teacher, a learner or a model driving the figure, I want rules and the command table to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/points-lines/design.md` section 9 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R9. Numerical robustness

**User story:** As a teacher, a learner or a model driving the figure, I want numerical robustness to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/points-lines/design.md` section 10 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R10. Changes to the core design

**User story:** As a teacher, a learner or a model driving the figure, I want changes to the core design to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/points-lines/design.md` section 13 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R11. What the learner and the teacher get

**User story:** As a teacher, a learner or a model driving the figure, I want what the learner and the teacher get to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/conics/design.md` section 1 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R12. Our value model

**User story:** As a teacher, a learner or a model driving the figure, I want our value model to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/conics/design.md` section 3 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R13. Constructors: rules

**User story:** As a teacher, a learner or a model driving the figure, I want constructors: rules to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/conics/design.md` section 4 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R14. Properties of a conic: rules

**User story:** As a teacher, a learner or a model driving the figure, I want properties of a conic: rules to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/conics/design.md` section 5 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R15. Special lines

**User story:** As a teacher, a learner or a model driving the figure, I want special lines to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/conics/design.md` section 6 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R16. Curvature and osculating circles

**User story:** As a teacher, a learner or a model driving the figure, I want curvature and osculating circles to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/conics/design.md` section 7 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R17. Intersections that involve conics

**User story:** As a teacher, a learner or a model driving the figure, I want intersections that involve conics to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/conics/design.md` section 8 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R18. Rules and the command table

**User story:** As a teacher, a learner or a model driving the figure, I want rules and the command table to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/conics/design.md` section 9 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R19. Rendering data

**User story:** As a teacher, a learner or a model driving the figure, I want rendering data to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/conics/design.md` section 10 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R20. Numerical robustness

**User story:** As a teacher, a learner or a model driving the figure, I want numerical robustness to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/conics/design.md` section 11 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R21. Open questions for the owner

**User story:** As a teacher, a learner or a model driving the figure, I want open questions for the owner to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/conics/design.md` section 13 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R22. Changes to the core design

**User story:** As a teacher, a learner or a model driving the figure, I want changes to the core design to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/conics/design.md` section 14 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R23. What the learner and the teacher get

**User story:** As a teacher, a learner or a model driving the figure, I want what the learner and the teacher get to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/polygons-transforms/design.md` section 1 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R24. Our polygon model

**User story:** As a teacher, a learner or a model driving the figure, I want our polygon model to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/polygons-transforms/design.md` section 3 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R25. Polygon operations

**User story:** As a teacher, a learner or a model driving the figure, I want polygon operations to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/polygons-transforms/design.md` section 4 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R26. Rigid polygons

**User story:** As a teacher, a learner or a model driving the figure, I want rigid polygons to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/polygons-transforms/design.md` section 5 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R27. Transformations: model

**User story:** As a teacher, a learner or a model driving the figure, I want transformations: model to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/polygons-transforms/design.md` section 6 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R28. Dependency and live behaviour

**User story:** As a teacher, a learner or a model driving the figure, I want dependency and live behaviour to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/polygons-transforms/design.md` section 7 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R29. Rules and the command table

**User story:** As a teacher, a learner or a model driving the figure, I want rules and the command table to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/polygons-transforms/design.md` section 9 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R30. Numerical robustness

**User story:** As a teacher, a learner or a model driving the figure, I want numerical robustness to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/polygons-transforms/design.md` section 10 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R31. Changes to the core design

**User story:** As a teacher, a learner or a model driving the figure, I want changes to the core design to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/polygons-transforms/design.md` section 11 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R32. Open questions

**User story:** As a teacher, a learner or a model driving the figure, I want open questions to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/polygons-transforms/design.md` section 12 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

