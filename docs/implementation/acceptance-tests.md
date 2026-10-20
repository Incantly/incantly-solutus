# Acceptance tests

These tests describe externally observable behavior. Implementation details may change without changing the contract.

## Learner journey

1. Select “projectile motion.”
2. See a structured loading skeleton.
3. Receive a probe-approved figure.
4. Pause it and change speed, angle, and gravity; the path and readouts update immediately without time advancing.
5. Play it; motion remains stable across supported frame rates.
6. Navigate the teaching steps with pointer and keyboard.
7. Close and reopen the note; parameter values and teaching position return.
8. Enable reduced motion; the figure opens in a meaningful still state.

The same journey applies to the sine-wave and thin-lens scenes.

## Runtime tests

- Exactly one SDK animation loop exists per figure.
- A clean paused figure performs no repeated draw work.
- A dirty paused figure draws once with `dt = 0`.
- Restart resets time; reset restores authored parameter defaults.
- Destruction removes all observers, listeners, pending persistence work, and frame work.
- Same inputs and seed produce the same model outputs.

## Validator tests

Each construct below has a fixture that is rejected with a fragment-relative line and column:

- Unknown SDK call.
- Direct DOM or global access.
- Listener, timer, or animation-loop creation.
- Network, storage, dynamic code, worker, or module access.
- Unbounded loop or recursion.
- External HTML resource or inline event attribute.
- CSS URL, import, hard-coded color, or disallowed expensive effect.
- More than three parameters or a source/AST budget violation.

Equivalent valid fixtures must also exist to prevent the validator from becoming accidentally over-strict.

## Probe tests

- Mount failure.
- Exception during a frame.
- `NaN` or infinity in model output, readout, or SVG attribute.
- Nothing visible or everything outside the stage.
- Parameter extreme that breaks the scene.
- Paused parameter change that leaves output unchanged.
- SVG element, sample, probe-time, or frame-time budget violation.
- Non-responsive scene terminated by the host deadline.

## SVG and graph tests

- A sampled `1/x` curve creates separate subpaths around zero.
- Rewriting an unchanged attribute causes no DOM mutation.
- Every generated definition ID is scoped to its figure.
- Two figures mounted together do not interfere.
- Titles, descriptions, parts, controls, and steps are reachable with supported assistive technology.
- No fixed stage dimensions or scene hard-coded colors appear.

## Repair and fallback tests

- A failed scene triggers no more than one automatic repair.
- The repair prompt contains the failure state, mapped line, source context, and violated rule.
- A repaired scene passes the complete validator and probe before reveal.
- Failed repair displays the best available approved fallback.
- Learner-authored invalid formula text, when formula editing is later introduced, remains an inline user error and does not trigger agent repair.

## Regression policy

Every production failure is reduced to the smallest generic fixture. Fixes belong in the SDK, validator, prompt rule, or example set and must close the failure class without introducing scene-specific host code.

## Large-document and TipTap tests

The complete performance contract lives in [Performance and TipTap integration](../architecture/performance-tiptap.md). Release acceptance includes:

- A representative TipTap document containing 300 persisted visualization nodes.
- No more than the configured live-instance limit mounted simultaneously.
- No off-screen drawing or simulation work.
- Responsive prose typing, selection, copy/paste, undo, and redo while the maximum live set is active.
- Bounded TipTap transactions and bridge traffic during continuous parameter dragging.
- No transaction per animation frame or pointer event.
- Correct `stopEvent` and `ignoreMutation` behavior around controls and editor-owned mutations.
- Stable scroll position while placeholders mount and suspend.
- A stable memory plateau after repeated top-to-bottom scroll cycles.
- Zero live execution instances, SDK listeners, or SDK observers after editor destruction.
