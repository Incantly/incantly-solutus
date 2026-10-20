# Claude reference examples

These references communicate the expected interaction quality, rendering approach, and SDK boundary. An implementation agent should inspect the live examples before building the related subsystem.

The references are evidence and design targets, not dependencies. Do not copy prototype code into the host application. Extract repeated behavior into generic SDK contracts, keep concept-specific formulas and primitive operations in scene source, and verify everything against the current architecture and acceptance tests.

Last inspected: October 20, 2026.

## 1. Pure SVG 3D core

Reference: [Pure SVG 3D core](https://claude.ai/artifact/Fa8EkPK4qTTrBPonh374Z8)

### What it demonstrates

The artifact renders two different interactive figures with one small vanilla-JavaScript and SVG core:

- A Rubik's cube made from 26 cubies and flat polygon faces.
- A z-x-z Euler-angle frame with three angle parameters and a reset action.

The cube supports pause, face turns, scrambling, spin speed, and turn speed. The Euler figure binds alpha, beta, and gamma parameters to one rotation matrix. Both figures can be dragged to change the view.

The shared rendering operations are:

1. Axis-angle rotation.
2. Matrix multiplication and matrix-vector application.
3. Camera projection.
4. Back-face culling.
5. Depth sorting.
6. Writing projected faces into SVG polygon slots.

### Techniques to retain

- Use flat colors and clean silhouettes before attempting realistic lighting.
- Keep the state model separate from projection and rendering.
- Use eased transitions for discrete state changes, then commit the exact final state.
- Sort visible faces in an array and write them into fixed polygon slots. Do not reorder DOM nodes every frame.
- Offset coplanar decals or stickers by a small depth epsilon to prevent unstable sorting and flicker.
- Make orbit interaction, projection, culling, sorting, tweening, and slot management SDK capabilities rather than scene-specific code.
- Allow multiple views to read the same state object without duplicating the model.

### What it does not authorize

This reference does not move general 3D into v0.1. Three-dimensional rendering remains deferred until the 2D vertical slice passes. When implemented, the core must be generic: no cube-specific renderer, hard-coded cubie generator, or Euler-specific animation loop belongs in the host or playground.

### Future acceptance target

A future `inc.space3d` implementation should reproduce both figures through the same public contracts. The figure sources should contain their actual parts, rotation formulas, state changes, and teaching text; the SDK should supply reusable projection, interaction, and rendering mechanics.

## 2. Bicycle chain drive

Reference: [How a bicycle chain drive works](https://claude.ai/artifact/D7WNAenotrR3e7UkHiaf8Y)

### What it demonstrates

The artifact shows a bicycle chainring connected to a rear cog. Engine-owned controls include play/pause, restart, speed, chainring teeth, rear-cog teeth, and pedal cadence. Readouts show gear ratio, rear-wheel speed, estimated road speed, and chain rate.

The live figure makes the mechanical relationship visible through:

- Sprocket teeth drawn from the actual tooth counts.
- A chain path tangent to both sprockets.
- Marked teeth and a marked chain link to reveal relative rotation.
- A crank attached to the chainring.
- Geometry rebuilt only when a tooth-count parameter changes.
- Per-frame work limited to transforms and dash offsets.
- Readouts derived from the same parameters that drive the drawing.

The artifact also exposes the intended ownership boundary: the application supplies the shell, controls, timing, readouts, state, and messages; the scene supplies SVG structure, concept-specific styling, geometry, formulas, and model relationships. Its particular container is a prototype detail, not a required architecture.

### Techniques to retain

- A parameter change while paused must rebuild affected geometry and redraw immediately.
- Cache geometry behind a key made from shape-defining parameters.
- Advance rotation using `dt`, never a frame-count increment.
- Derive chain travel, cog rotation, readouts, and labels from one model.
- Use a marked element to direct attention to a relationship that is otherwise hard to perceive.
- Keep a concise explanation and caption outside the drawing.

### Prototype code that must become SDK capability

The artifact is a proof, not the final authoring contract. Its scene JavaScript performs direct DOM lookup and attribute writes and implements sprocket and chain-hull geometry locally. Under the current architecture, an implementation agent must move repeated mechanics into generic SDK primitives:

- `inc.path.gear(...)` or an equivalent registered gear-outline primitive.
- `inc.path.hull(...)` for a belt or chain wrapped around two circles.
- Transform handles instead of `document.getElementById` and raw `setAttribute` calls.
- A reusable flow or dash-offset handle for chains, belts, currents, and streams.
- Keyed geometry recomputation controlled by the SDK.

The scene source must still show the real drivetrain model: tooth counts, pitch, angular relationship, chain travel, gear ratio, cadence, and derived speed. Do not replace those formulas with an invented `bicycle(...)` function.

### Future acceptance target

Rebuild the artifact entirely through public SDK contracts. Pause it, change each parameter to its minimum, default, and maximum, and verify that geometry and readouts change without time advancing. The host and playground must contain no bicycle-specific helper or renderer.

## 3. Architecture and product discussion

Reference: [Shared Claude discussion](https://claude.ai/share/255aa0d5-9cd8-4305-a759-479a324a2707)

### Decisions reinforced by the discussion

- The agent writes concept-specific HTML, CSS, and validated JavaScript against host-provided capabilities.
- Generated code runs through a restricted execution adapter and communicates with the TipTap node through a narrow typed bridge.
- The execution mechanism is replaceable; it may be local or remote as long as it satisfies the same security, lifecycle, persistence, and latency contracts.
- Resource limits must be measured on the supported baseline environments rather than inferred from one container technology.
- The host pauses off-screen figures, destroys long-hidden figures after preserving state and a snapshot, and limits the number of live figures.
- A figure renders only while playing or dirty.
- Touch interaction must not trap document scrolling; activation and pointer behavior belong to the SDK.
- SVG is the default for diagrams and individually interactive parts; canvas is the later escape hatch for dense animation.
- External 3D libraries are not required for the intended flat-color educational style.
- The reusable kit owns plumbing that would otherwise repeat: controls, loop, dirty state, graph scaffolding, projection, geometry helpers, tweening, theme, parts, readouts, snapshots, accessibility, and errors.
- The agent retains what varies by concept: parts and dimensions, the mathematical or physical model, and the teaching words.
- Generation speed comes primarily from reducing generated source and retrieving reviewed examples, not from weakening validation.
- A generated figure is validated and exercised in an isolated probe instance before it is shown.
- Repair messages need the failed check, exact state, mapped source location, nearby code, and violated rule.
- Recurring failures become SDK capabilities or regression tests rather than additional retries.

### Guidance for implementation agents

Use the conversation to understand intent, not as a substitute for the normative files in this repository. When it conflicts with the current scoped documentation, the repository wins. In particular:

- v0.1 allows one automatic repair attempt.
- v0.1 does not include general 3D or a general physics engine.
- Fresh execution instances are preferred until measurements justify pooling and a complete reset contract exists.
- Generated JavaScript is parsed and restricted before execution.
- No scene-specific renderer may be added to the app or playground.

## Shared quality bar

Across all three references, the expected result is calm, responsive, and instructional:

- The visualization communicates one relationship immediately.
- Controls are consistent and engine-owned.
- Readouts stay synchronized with the drawing.
- Motion uses elapsed time and easing.
- Static geometry is reused.
- The scene responds while paused.
- The learner sees no raw error or broken intermediate state.
- Reusable mechanics live in the SDK; concept-specific formulas remain visible in scene source.

## Reference stability

Claude artifact and share URLs may require access or may change availability. These notes preserve the observed behavior needed for implementation. If a reference becomes inaccessible, implement from this specification and the repository acceptance tests rather than guessing at unseen details.
