# Prototype findings

This file preserves lessons from earlier experiments without making old prototypes part of the current implementation.

The live artifacts and their implementation-specific interpretation are cataloged in [Claude reference examples](../implementation/reference-examples.md).

## Paused interaction

Paused means time stops, not that the figure stops responding. Parameter, view, size, theme, and teaching changes mark the scene dirty. The engine draws once with `dt = 0` and returns to idle.

## Event ownership

The engine owns input events, pointer capture, control delegation, throttled host messages, visibility, resize observation, and cleanup. Generated scenes update models through SDK callbacks and never attach listeners directly.

## Frame cost

- Do not read layout in frame callbacks.
- Write only changed attributes or text.
- Rebuild geometry only when shape-defining inputs change.
- Move stable geometry with transforms.
- Do not use `innerHTML` during animation.
- Keep drawing and host persistence off the direct input-event path.

## SVG observations

- Curves must create a new subpath after non-finite samples.
- Repeated SVG definition IDs must be figure-scoped.
- Touch-to-local coordinate mapping belongs in the SDK.
- Accessibility roles for interactive SVG require real assistive-technology tests.
- Dense moving elements should eventually use canvas, but v0.1 stays below a conservative SVG budget.

## 3D research

Flat-color projected geometry, back-face culling, painter sorting, fixed render slots, and tweened state transitions can produce convincing educational 3D without a third-party engine. This remains deferred until the 2D vertical slice proves the product.

## Repair diagnostics

Useful repair messages contain the failing check, exact parameter state, real error, fragment-relative source location, nearby lines, and the violated rule. Vague retry prompts waste latency and often repeat the same failure.

## General rule

When a prototype exposes a recurring failure, close the class in a generic SDK contract and regression test. Do not preserve the prototype through scene-specific application code.
