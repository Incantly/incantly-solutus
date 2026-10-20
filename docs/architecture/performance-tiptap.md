# Performance and TipTap integration

This specification defines how interactive figures behave inside a large TipTap document. Performance is a product requirement, not a cleanup phase. An implementation is incomplete until it has been measured with realistic documents, including the 300-figure stress case.

The execution mechanism is replaceable. These requirements apply regardless of which execution adapter is used.

## Performance model

A document may contain hundreds of stored visualization nodes, but only a small visible working set may be active.

```text
stored node
  -> lightweight placeholder
  -> near-viewport candidate
  -> mounted figure
  -> active or paused
  -> snapshot and teardown
  -> lightweight placeholder
```

“300 figures in a document” means 300 persisted TipTap nodes with source, state, metadata, and snapshots. It must not mean 300 running scenes, 300 animation loops, or 300 complete control trees.

## Required scale tests

Test documents at these sizes:

| Profile | Visualization nodes | Simultaneously live | Purpose |
| --- | ---: | ---: | --- |
| Small | 1 | 1 | Component correctness |
| Typical | 10 | 1–3 | Normal editing and reading |
| Large | 50 | 1–3 | Lifecycle and persistence pressure |
| Very large | 100 | 1–3 | Long-document scrolling |
| Stress | 300 | 1–3 | Bounded DOM, memory, observers, and transactions |

Each profile must include surrounding paragraphs, headings, lists, images, and ordinary TipTap selections. A test containing only visualization nodes is not representative.

Run at least these scenarios:

1. Open the document at the top.
2. Open the document near the middle and near the end.
3. Scroll from top to bottom and back repeatedly.
4. Start one figure, then scroll it out of view.
5. Edit prose while figures are mounted.
6. Drag a parameter continuously for ten seconds.
7. Undo and redo prose and figure changes.
8. Switch documents repeatedly.
9. Destroy and recreate the editor.
10. Leave the document open and idle.

## Initial release gates

Measure on the project's declared baseline hardware and browser/runtime. Record the exact environment with every result.

| Area | Initial gate |
| --- | --- |
| Active figures | No more than 3 by default |
| Off-screen execution | 0 drawing or simulation work |
| Placeholder DOM | Constant-size, shallow markup per inactive node |
| Scroll | No sustained task over 50 ms; dropped-frame rate under 5% during the scripted stress scroll |
| Input response | Parameter UI responds visually by the next animation frame |
| Editor typing | No visible typing lag with 300 stored figures and the maximum live set |
| Persistence traffic | No TipTap transaction per animation frame or pointer event |
| Idle work | No animation frames, timers, observer churn, or bridge traffic from clean paused figures |
| Cleanup | Live instances, listeners, observers, and memory return to a stable baseline after repeated full-document scrolls |
| Opening position | The editor does not mount every figure before showing the requested document position |

Absolute load-time and memory limits must be established from measurements on the declared baseline environment. Do not invent one universal number across execution adapters. Once measured and accepted, commit those numbers to the performance test configuration so regressions fail automatically.

## TipTap node representation

The visualization node stores durable data only:

- Stable figure ID.
- Approved HTML, CSS, and JavaScript fragments or their content reference.
- SDK and schema versions.
- Authored defaults.
- Learner parameter values.
- Teaching-step position.
- Last approved snapshot and text alternative.
- Generation and validation metadata required for repair or migration.

Do not store derived model values, per-frame state, DOM nodes, runtime handles, observer objects, or animation timestamps in the ProseMirror document.

Large fragments and snapshots may make transactions and collaboration payloads expensive. Measure serialized node size. If the measured cost is unacceptable, introduce a content-addressed asset/reference layer behind the same node contract rather than silently bloating every transaction.

## Node-view lifecycle

Each node view follows an explicit state machine:

1. **Placeholder:** render the snapshot or a lightweight skeleton and text alternative.
2. **Eligible:** the node is within the configured viewport margin and may request a live slot.
3. **Mounted:** an execution instance exists and has restored persisted state.
4. **Active:** the learner has activated the figure or playback is running.
5. **Paused:** the figure remains mounted but performs work only when dirty.
6. **Suspended:** snapshot and state are captured; the execution instance is destroyed.
7. **Destroyed:** all references and subscriptions are released.

Transitions must be idempotent. Repeated pause, resume, mount, or destroy messages may not duplicate work or throw.

The host owns a live-instance scheduler. When the live limit is reached, it suspends the least-recently-interacted eligible figure before mounting another one. Visibility alone must not cause hundreds of nodes to mount during a fast scroll.

## Viewport and observer handling

- Prefer one shared visibility observer for all visualization nodes rather than one observer per node.
- Use a conservative overscan margin so a nearby figure can prepare without mounting far-away figures.
- Debounce eligibility changes caused by rapid scrolling.
- Do not take snapshots synchronously in the scroll handler.
- Schedule expensive snapshot or teardown preparation outside the input and rendering critical path.
- Recheck that a node is still eligible before completing asynchronous mount work.
- Cancel stale mounts when the node leaves the eligibility region or the editor is destroyed.

## Event handling

The agent-generated scene writes no listeners. The SDK and host own events.

### Controls and figure events

- Delegate control events from one stable controls root.
- Use pointer events for mouse, pen, and touch behavior.
- Use pointer capture for drag operations.
- An event handler updates state and marks the figure dirty; it does not perform drawing or expensive geometry work directly.
- Coalesce high-frequency pointer and slider changes to at most one visual update per animation frame.
- Throttle persisted value messages and retain the trailing value.
- Abort all SDK listeners and observers through the instance's cleanup owner.

### TipTap and ProseMirror events

- The node view explicitly defines which interaction events TipTap should ignore and which should reach the editor.
- Interacting with controls must not move the text selection, start node dragging, or trigger editor shortcuts.
- Clicking the node shell may select the node when appropriate; interacting inside the figure must remain inside the figure.
- Keyboard focus must move predictably between document text, figure controls, teaching steps, and back to the document.
- Composition events and input-method editing in surrounding text must not be intercepted by a visualization node.
- The host must not install one document-level listener per node. Shared editor-plugin listeners or node-root delegation are preferred.

### `stopEvent` and `ignoreMutation`

Implement these deliberately, not as “always true” shortcuts:

- `stopEvent` returns true only for events owned by controls or the interactive stage.
- Editor selection, drag handles, copy/paste, and node-level commands retain their intended behavior.
- `ignoreMutation` ignores SDK-owned rendering mutations inside isolated runtime or non-editable figure regions.
- Attribute or content mutations that represent persisted editor state must still reach TipTap.
- Add tests for focus, selection, deletion, copy/paste, undo, redo, and arrow-key navigation around the node.

## DOM ownership

TipTap owns the document structure and node-view shell. The SDK owns the controls, stage, teaching region, and runtime DOM inside the node's designated mount boundary. Generated code never reaches outside that boundary.

Rules:

- Do not query the entire document from a scene.
- Do not store DOM nodes in TipTap attributes or application state.
- Build static geometry once and reuse it.
- Write an attribute, style, class, or text value only when it changed.
- Do not use `innerHTML` during a frame.
- Do not read layout during a frame; cache measurements from resize or explicit layout phases.
- Avoid synchronous read-after-write cycles that force layout.
- Inactive placeholders must not contain the full control tree or hidden live scene.
- Each node uses a unique namespace for SVG definitions, labels, and generated IDs.

## Rendering and scheduling

- One SDK-owned scheduler controls each live scene; generated scenes cannot create animation loops or timers.
- The host may provide a shared clock to live scenes when an adapter supports it, but scene semantics must not depend on that optimization.
- Draw only while playing or dirty.
- When paused and dirty, draw once with `dt = 0`.
- Cap large time deltas after backgrounding or suspension.
- Fixed-step simulations cap the number of catch-up steps and drop excess accumulated time rather than freezing the editor.
- Geometry is rebuilt only when its shaping inputs change.
- Readouts update only when displayed text changes.
- Reduced-motion behavior produces a meaningful still result without background animation.

## TipTap transactions and persistence

Runtime state changes are not editor transactions by default.

- Keep transient parameter changes in the runtime store during direct manipulation.
- Send host updates at a bounded rate and always send the final value.
- Batch multiple changed values into one persistence operation.
- Commit persisted state after interaction settles, on explicit checkpoints, before suspension, and before editor teardown.
- Do not call `updateAttributes` on every pointer move, frame, readout change, or animation tick.
- Do not add animation state to the undo history.
- Define whether a settled parameter change is undoable and test that policy consistently.
- Avoid dispatching a transaction when serialized persisted state is unchanged.
- Migration of old node versions must be deterministic, measurable, and separated from frame rendering.

## Resize and layout

- Share resize observation where practical.
- Ignore sub-pixel resize noise and repeated identical dimensions.
- A resize marks the figure dirty; it does not synchronously redraw inside the observer callback.
- Avoid height oscillation between TipTap layout and responsive figure content.
- Give placeholders and mounted figures a stable aspect ratio or reserved minimum size to prevent scroll jumps.
- Preserve the reader's scroll position when replacing a placeholder with a live figure or returning to a snapshot.

## Bridge and adapter traffic

- Messages use typed, versioned payloads.
- Parameter changes are coalesced and throttled; errors, lifecycle transitions, and final values are never dropped.
- Large snapshots or fragments are not repeatedly copied across the bridge.
- Ignore stale messages from destroyed instances using instance and channel identifiers.
- Instrument message count and payload bytes by type.
- Backpressure must prevent a slow host or execution instance from building an unbounded message queue.

## Memory and cleanup

On suspension or destruction, release:

- Animation scheduling.
- Event listeners and pointer capture.
- Visibility and resize subscriptions.
- Runtime models and derived caches.
- SVG or canvas resources.
- Snapshot jobs and pending promises where cancellation is possible.
- Bridge subscriptions and queued messages.
- References from the live-instance scheduler.

The 300-node scroll test must repeat until memory reaches a stable plateau. Continual growth after each top-to-bottom cycle is a release blocker, even if the page has not crashed.

## Instrumentation

Development and test builds record:

- Document node count and visualization-node count.
- Placeholder, eligible, mounted, active, paused, and suspended counts.
- Mount, restore, snapshot, suspend, and destroy durations.
- Frame duration, dropped frames, and long tasks.
- DOM and SVG element counts per live figure.
- Draws while playing, dirty, paused-clean, and off-screen.
- TipTap transaction count and serialized byte size by cause.
- Bridge message count and bytes by type.
- Listener and observer counts.
- Memory measurements when supported by the environment.

Instrumentation must be removable or low-cost in production and must never include learner note content in telemetry by default.

## Automated performance suite

Create deterministic document fixtures for every scale profile. The suite should:

1. Load a fixture at a known position.
2. Record time until the editor accepts input.
3. Execute a scripted scroll path.
4. Activate and manipulate designated figures.
5. Edit surrounding prose.
6. Suspend and remount figures.
7. Repeat full-document scroll cycles.
8. Destroy the editor.
9. Assert budgets and the absence of leaked live instances.

Store results as machine-readable artifacts and compare them with an accepted baseline. CI should fail on meaningful regressions, using a tolerance that accounts for runner noise. Run the full 300-node profile on stable dedicated hardware or a controlled performance runner; use smaller smoke profiles on every ordinary test run.

## Agent responsibilities

An implementation agent working on runtime, controls, rendering, TipTap integration, persistence, or execution adapters must:

1. State which performance budgets the change can affect.
2. Add or update the relevant scale fixture.
3. Measure before and after on the same environment.
4. Report active-instance, transaction, DOM, bridge, and cleanup effects.
5. Add a regression test for any discovered performance failure.
6. Promote repeated optimizations into reusable SDK infrastructure following [Extending the SDK](../sdk/extending.md).

A feature is not complete when it works with one figure. It is complete when its cost remains bounded in the 300-figure document and when ordinary TipTap editing remains responsive.
