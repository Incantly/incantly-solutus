# Extending the SDK with reusable capabilities

Every implementation agent is responsible for recognizing repeated work and improving the generic SDK rather than duplicating that work in generated scenes or host code.

## Promotion rule

If two unrelated figures would implement substantially the same infrastructure, geometry, interaction, formatting, or lifecycle behavior, treat it as a candidate SDK capability.

Examples include:

- Curve sampling and discontinuity handling.
- Gear outlines, belt or chain hulls, arrows, arcs, and dimension lines.
- Drag, orbit, zoom, pan, and pointer-coordinate mapping.
- Tweening, queues, easing, springs, and time-based following.
- Units, number formatting, legends, and readout tiles.
- Highlighting, dimming, callouts, focus, and teaching-step transitions.
- Snapshotting, error mapping, budgets, persistence, and lifecycle cleanup.

Concept-specific facts remain in scene source: the actual formula, primitive operations, part dimensions, physical relationships, labels, and teaching explanation.

## Required process

Before adding a reusable capability:

1. Show at least two plausible consumers or one repeated production failure.
2. Define a concept-neutral API and its ownership boundary.
3. Implement it inside the SDK, never as a host/playground shortcut.
4. Register it in the public exports and validator allow-list.
5. Add focused unit tests and a generic behavioral fixture.
6. Add or update an acceptance test that closes the failure class.
7. Document the signature, lifecycle, performance limits, and accessibility behavior.
8. Add a reviewed example showing the intended source shape.
9. Version the SDK contract when stored scenes may be affected.

## Prohibited promotion

Do not hide a whole example behind a concept-named function such as `bicycle(...)`, `projectile(...)`, or `sierpinski(...)`. Promote reusable primitives such as `gear`, `hull`, `arrow`, `curve`, `midpoint`, `join`, or `dilate`, then keep the authored composition and formulas visible.

Do not add a TypeScript helper, hard-coded polygon generator, animation loop, or scene-specific renderer to an application or playground. If the current SDK cannot express a valid scene, extend the generic SDK contracts first.

## Agent completion note

When an implementation agent adds a reusable capability, its handoff must name:

- The repeated pattern that justified it.
- The new public API.
- The tests and examples added.
- Any validator, persistence, or versioning impact.
