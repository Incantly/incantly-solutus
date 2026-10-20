# Architecture overview

## System layers

| Layer | Owner | Responsibility |
| --- | --- | --- |
| Host | Incantly app | Requests generation, stores the TipTap node, mounts approved figures, and persists learner state |
| Shell | Incantly SDK | Document structure, theme, control regions, teaching regions, bridge, and error boundary |
| Engine | Incantly SDK | State, timing, controls, SVG, graphing, teaching helpers, checks, and snapshots |
| Scene | Agent | Concept-specific model, parts, formulas, parameter declarations, and teaching content |

The agent does not produce a document, controls, event listeners, timers, or an animation loop. It produces three fragments—HTML, CSS, and constrained JavaScript—that fill defined shell slots.

## Runtime shape

```html
<!doctype html>
<html>
  <head>
    <style>/* bundled theme */</style>
    <style>/* validated scene CSS */</style>
  </head>
  <body>
    <div id="controls"></div>
    <div id="stage"><!-- validated scene HTML --></div>
    <div id="teaching"></div>
    <script nonce="SHELL_NONCE">/* bundled engine and validated scene */</script>
  </body>
</html>
```

The production implementation must define the exact CSP and nonce strategy; the example shows ownership, not a copy-ready policy.

## Request flow

1. The learner selects a concept.
2. The backend generates and validates a small plan.
3. The backend supplies only relevant SDK contracts and a reviewed example to the scene generator.
4. The generated fragments pass static validation.
5. A fresh isolated execution instance performs a probe run through the configured adapter.
6. A passing scene is mounted for the learner; a failure gets one repair attempt.
7. The TipTap node stores approved fragments, SDK version, learner values, teaching position, and snapshot.

## State ownership

- SDK defaults are authored by the scene.
- Current parameter values and teaching position belong to the learner and are persisted by the host.
- Derived values belong to `inc.model`; they are not independently stored.
- Transient animation state stays inside the frame and is discarded when the figure is destroyed.
- A snapshot is a fallback representation, never the source of truth.

## Rendering lifecycle

One SDK-owned animation loop serves the figure. It draws when playing or dirty. A parameter, view, size, theme, or teaching-step change marks the scene dirty. While paused, the engine invokes the frame callback with `dt = 0`; time does not advance, but the drawing updates.

Off-screen figures pause. The host may replace distant figures with snapshots. Reuse or pooling of execution instances is an adapter-level optimization and is allowed only after measurements justify it and a complete reset contract exists.

## Execution adapters

The SDK is not tied to an iframe or any other single container. An execution adapter is responsible for loading validated fragments, exposing approved SDK capabilities, isolating untrusted code, enforcing budgets, transporting typed messages, capturing errors, producing snapshots, and terminating the instance.

An implementer may choose or introduce a better mechanism when it satisfies the security and lifecycle contract. Scene source, persisted node data, validation rules, and public SDK calls must remain independent of that choice.
