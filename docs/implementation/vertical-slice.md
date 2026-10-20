# Vertical-slice implementation

## Objective

Prove the complete learner journey before expanding the SDK catalog.

Before implementing a related subsystem, review the observed behavior and boundaries in [Claude reference examples](reference-examples.md). Those examples establish interaction and visual targets, but the current scoped contracts and acceptance tests remain authoritative.

While implementing, follow [Extending the SDK](../sdk/extending.md): repeated, concept-neutral behavior belongs in a documented SDK capability with tests and an example.

Runtime and TipTap work must also satisfy [Performance and TipTap integration](../architecture/performance-tiptap.md), including the 300-figure document stress profile.

```text
select concept
  -> generate
  -> validate
  -> probe
  -> interact
  -> learn
  -> save
  -> reopen
```

## Package boundary

Begin with one package, `@incantly/core`. Split packages only when an independently testable boundary is real. Internal modules may be organized as:

```text
packages/core/src/
  runtime/
  sandbox/
  svg/
  graph2d/
  teaching/
  validation/
  bridge/
  index.ts
```

The host and any future playground remain generic consumers. They must not contain TypeScript helpers, polygon generators, animation loops, or scene-specific renderers added to make a demo pass.

## Build order

### 1. Static gold-standard scene

Build a hand-authored sine-wave scene against the intended public API. Implement only enough theme, SVG, parameters, model, readout, and frame lifecycle to render it.

Acceptance: it renders in light and dark modes, and every parameter redraws while paused.

### 2. Runtime and controls

Implement one animation loop, capped `dt`, dirty rendering, play/pause, restart, speed, parameter controls, lifecycle cleanup, and reduced-motion behavior.

Acceptance: no scene listener, timer, or animation loop exists; pausing consumes no repeated draw work.

### 3. Teaching layer

Implement idea text, steps, model-bound explanation, part focus, and the text alternative.

Acceptance: keyboard navigation works and leaving steps restores learner values.

### 4. Shell, execution adapter, and bridge

Define an execution-adapter interface and mount the three fragments through its first secure implementation. Implement typed messages for ready, error, value change, snapshot, pause, resume, and destroy. The public SDK and stored scene format must not depend on a particular isolation mechanism.

Acceptance: a scene cannot access unauthorized host capabilities or the network, a thrown error leaves the host responsive, and another compliant execution adapter can be introduced without changing scene source.

### 5. Restricted JavaScript validator

Parse the AST, enforce the subset, validate HTML and CSS, and map diagnostics to fragment lines.

Acceptance: each forbidden construct has a focused fixture and error message.

### 6. Probe runner

Exercise mount, frames, parameter extremes, paused changes, bounds, finite values, and budgets in an isolated probe instance.

Acceptance: deliberately broken fixtures fail for the expected reason and never appear to the learner.

### 7. Three concepts

Finish the sine wave, projectile motion, and thin-lens ray diagram as reviewed examples using only public SDK contracts.

Acceptance: all three pass the same generic probe and persistence path.

### 8. TipTap persistence

Store approved fragments, SDK version, values, teaching position, and snapshot in one node.

Acceptance: close and reopen the note in each supported host environment without changing the figure state.

### 9. Generation and one repair

Add the plan call, focused generation context, static validation, probe, one repair attempt, and fallback ladder.

Acceptance: the eval suite measures first-attempt and post-repair pass rates for the three concepts.

## Definition of done

The vertical slice is complete only when every release gate in [success metrics](../product/success-metrics.md) passes. A visually convincing demo without sandboxing, persistence, teaching behavior, or paused interaction is not complete.
