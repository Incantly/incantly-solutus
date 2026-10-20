# Product vision

## Summary

Incantly turns a concept a learner is studying into a live, interactive teaching figure inside their notes. An AI agent creates the concept-specific scene, while the Incantly SDK provides the reusable infrastructure: parameters, formulas, drawing, timing, controls, accessibility, validation, and persistence.

The product is not an AI webpage generator and not a clone of a graphing calculator. Its purpose is to direct attention, let learners manipulate meaningful quantities, and explain what changes.

## Problem

Existing approaches fail in different ways:

- Asking the model to recreate visualization infrastructure for every figure produces avoidable inconsistency and failure.
- Unrestricted generated HTML and JavaScript produce inconsistent controls, unsafe behavior, poor accessibility, and unreliable performance.
- A graphing-only product cannot cover mechanisms, diagrams, geometry, physics, chemistry, or biology.
- A moving illustration can look impressive without teaching anything.

## Users

- **Learner:** selects a concept, explores a figure, changes parameters, and follows a short explanation.
- **Agent:** selects documented SDK components and writes only the concept-specific model and scene.
- **Incantly developer:** expands the SDK, examples, validation, and evaluation set while watching failure and performance metrics.

## Product principles

1. **Show the real phenomenon.** Use the projectile, wave, lens, circuit, or mechanism—not a decorative metaphor.
2. **The SDK owns infrastructure.** Generated scenes do not create controls, event systems, animation loops, zoom behavior, themes, or persistence.
3. **One model drives everything.** Geometry, readouts, captions, and explanations derive from the same state.
4. **Interaction must teach.** A figure directs attention, names changes, and invites exploration; motion alone is insufficient.
5. **Generated code is untrusted.** It is validated, isolated, exercised, and never shown before it passes.
6. **The first release is narrow.** Reliability on a few representative concepts matters more than a broad but fragile catalog.

## Long-term direction

The same public contracts can later support richer graphing, physics, canvas effects, 3D scenes, domain kits, exports, reviewed examples, and a community gallery. Those capabilities are not prerequisites for proving the core experience.

## Non-goals for the first release

- Photorealistic rendering, lighting, textures, or imported mesh models.
- A manual visual editor.
- Server-side execution of scene code.
- Collaborative editing inside a figure.
- General-purpose simulation or arbitrary webpage generation.
- Complete coverage of every STEM subject.
