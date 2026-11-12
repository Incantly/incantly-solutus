# Renderer: requirements

Our own 2D and 3D renderer: scene, camera, picking, drag, labels, WebGL 2 with SVG and Canvas 2D fallbacks, one shared GPU context per page, and the figure scheduler.

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

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/graphics-view/design.md` section 1 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R2. Coordinate systems

**User story:** As a teacher, a learner or a model driving the figure, I want coordinate systems to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/graphics-view/design.md` section 3 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R3. Zoom, pan and the view

**User story:** As a teacher, a learner or a model driving the figure, I want zoom, pan and the view to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/graphics-view/design.md` section 4 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R4. Grid and axes

**User story:** As a teacher, a learner or a model driving the figure, I want grid and axes to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/graphics-view/design.md` section 5 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R5. Drawables

**User story:** As a teacher, a learner or a model driving the figure, I want drawables to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/graphics-view/design.md` section 6 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R6. Painting

**User story:** As a teacher, a learner or a model driving the figure, I want painting to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/graphics-view/design.md` section 7 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R7. Layers and draw order

**User story:** As a teacher, a learner or a model driving the figure, I want layers and draw order to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/graphics-view/design.md` section 8 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R8. Styles

**User story:** As a teacher, a learner or a model driving the figure, I want styles to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/graphics-view/design.md` section 9 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R9. Hit testing

**User story:** As a teacher, a learner or a model driving the figure, I want hit testing to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/graphics-view/design.md` section 10 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R10. Selection

**User story:** As a teacher, a learner or a model driving the figure, I want selection to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/graphics-view/design.md` section 11 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R11. Dragging

**User story:** As a teacher, a learner or a model driving the figure, I want dragging to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/graphics-view/design.md` section 12 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R12. Snapping

**User story:** As a teacher, a learner or a model driving the figure, I want snapping to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/graphics-view/design.md` section 13 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R13. Export

**User story:** As a teacher, a learner or a model driving the figure, I want export to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/graphics-view/design.md` section 14 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R14. Accessibility of the canvas

**User story:** As a teacher, a learner or a model driving the figure, I want accessibility of the canvas to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/graphics-view/design.md` section 15 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R15. Changes to the core design

**User story:** As a teacher, a learner or a model driving the figure, I want changes to the core design to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/features/graphics-view/design.md` section 17 and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

### R16. Performance rules

**User story:** As a teacher, a learner or a model driving the figure, I want performance rules to work as designed, so that figures behave the same every time.

**Acceptance criteria:** WHEN this part is used, THE SYSTEM SHALL behave as `docs/design/performance.md` and its `errors.md` describe, and SHALL report every failure listed there with its error kind, hint and fix.

