# Sandbox and generated-code boundary

## Decision

Generated scenes use a restricted subset of JavaScript against explicit SDK capabilities. They do not receive unrestricted browser APIs. See [ADR 001](decisions/001-constrained-javascript.md).

No single isolation mechanism is assumed to be sufficient. The execution adapter must protect the host, constrain capabilities, enforce resource budgets, and allow a non-responsive scene to be terminated.

## Defense in depth

1. **Parse:** parse the JavaScript into an AST; never validate with regular expressions alone.
2. **Restrict syntax:** reject unsupported statements and expressions before execution.
3. **Allow capabilities:** permit documented `inc` calls and safe local computation only.
4. **Isolate:** run through an execution adapter that prevents access to unauthorized host state, navigation, external resources, and ambient capabilities.
5. **Block network:** use CSP and the embedding environment to deny connections and external resources.
6. **Probe:** exercise all declared parameter bounds before revealing the scene.
7. **Watch:** enforce mount and probe deadlines from the host; discard a non-responsive frame.
8. **Budget:** cap source size, AST complexity, parameters, SVG elements, sampled points, and frame cost.

## v0.1 JavaScript subset

Allowed:

- `const` and `let` local declarations.
- Literals, arrays, plain objects, property access, arithmetic, comparisons, conditionals, and template strings.
- Arrow functions used as callbacks to documented SDK calls.
- Bounded `for` loops whose upper bound is statically known and below the configured cap.
- Selected pure `Math` functions.
- Calls to the documented `inc` API and handles returned by it.

Rejected:

- `eval`, `Function`, dynamic import, modules, workers, and WebAssembly.
- `fetch`, sockets, storage, cookies, clipboard, geolocation, media, and external resource creation.
- Direct access to `window`, `document`, `globalThis`, `parent`, `top`, `opener`, or prototype chains.
- `addEventListener`, timers, and `requestAnimationFrame`.
- `while`, `do`, recursion, generators, and unbounded iteration.
- Assignment to undeclared names or mutation of SDK internals.

## HTML and CSS

HTML permits a small structural allow-list and rejects scripts, event attributes, forms, embedded browsing contexts, and external-resource elements. Scene CSS is scoped to the figure and permits theme tokens; external URLs, imports, fixed viewport overlays, and unbounded expensive effects are rejected.

## Execution-adapter contract

Every adapter must:

- Load only statically validated fragments and the approved SDK version.
- Deny network and external-resource access unless a future capability explicitly grants it.
- Expose only documented capabilities.
- Support mount, pause, resume, snapshot, restore, and destroy.
- Report fragment-relative errors through the typed bridge.
- Enforce execution, memory, shape, and frame-time budgets where the platform allows.
- Let the host terminate a non-responsive instance.
- Keep adapter details out of scene source and persisted documents.

Possible implementations may use an isolated document, a worker with a rendering proxy, a separate process, or a stronger future runtime. The documentation deliberately does not select one as the permanent architecture.

## Messaging

The bridge accepts only documented message shapes from the execution instance created for that scene. Every instance receives an unguessable channel identifier, and messages without it are ignored. Transport-specific identity checks belong to the adapter.

Host to frame: `init`, `pause`, `resume`, `setValues`, `step`, `reducedMotion`, `snapshot` (a PNG, or with `format: 'svg'` an SVG image with the theme written in), `ping`, `focus`, `style`, `theme`, `number` and `destroy`. `style` restyles a live figure in place (preset, tokens, slot classes, layout, shown parts) and is checked again in the frame; the integrator's trusted CSS is part of the frame document and its policy hashes, so changing it needs a new mount. Frame to host: `ready`, `mounted`, `error`, `values`, `formulas`, `step`, `description`, `escape`, `snapshot`, `pong`, `resize` and `probe`.

## Failure behavior

A non-responsive, over-budget, or invalid execution instance is destroyed. The learner sees the last approved snapshot and text description, never a stack trace or empty box.

## The v0.1 implementation

The first adapter follows [ADR 002](decisions/002-execution-adapter.md). Code lives in `packages/core/src/sandbox`, `validation` and `probe`.

| Layer | What it does | Where |
| --- | --- | --- |
| Validator | Allow-lists for the three fragments, with fragment-relative locations. See the [scene subset](../sdk/scene-subset.md) | `validation/` |
| Canonical HTML | The frame receives HTML rebuilt from the parsed tree, never the original text | `validation/html.ts` |
| Instrumentation | Fuel in every loop and function body; a guard on every computed key | `validation/instrument.ts` |
| Wrapper | The scene sees exactly `inc`, a `Math` without `random`, a reduced `Number`, `isFinite` and `isNaN`; ambient globals are shadowed with `undefined` | `sandbox/scene-wrapper.ts` |
| Worker | Scene code runs in a dedicated Worker with no DOM. After the scene registers, network, storage and worker globals are neutralized | `sandbox/worker-entry.ts` |
| Frame | `sandbox="allow-scripts"` only, built from `srcdoc`, under the [ADR 005](decisions/005-content-security-policy.md) policy with hashes for the frame script, theme and scene CSS | `sandbox/shell.ts`, `sandbox/frame-entry.ts` |
| Renderer | Builds DOM only through `createElementNS`, `setAttribute` with an attribute allow-list, and `textContent`; ignores element kinds outside the SDK's list | `renderer/` |
| Bridge | A transferred `MessagePort`; every message carries the version and a 128-bit channel id and is checked for shape | `protocol/bridge.ts` |
| Watchdogs | The frame terminates a Worker that leaves a message unanswered for 2.5 s. The host removes a frame that does not draw within 4 s, misses a heartbeat (every 2 s), or loads a second time. A probe must report within 3 s | `sandbox/frame-entry.ts`, `sandbox/adapter.ts` |
| Probe | Runs in a fresh hidden frame through the same adapter before a new scene is shown | `probe/`, `sandbox/adapter.ts` |

`presentScene` is the learner-facing path for a new scene: probe hidden, then mount only if it passed. `mountSandboxed` mounts a scene that was already approved; it validates again before mounting. `@incantly/core/testing` mounts without the validator, for the security tests only.

### Tested

- Every forbidden construct has a rejected fixture with its line and column, and a valid twin that must pass (`packages/core/test/validation.test.ts`).
- Deliberately broken scenes fail the probe for the expected reason, and a rejected scene never mounts (`probe.test.ts`, `apps/playground/e2e/sandbox.spec.ts`).
- With the validator skipped on purpose, a hostile scene still cannot reach the host page, its globals, storage or the network: the Worker sees `undefined` for every ambient global, `eval` through a function's constructor fails under the policy, and images, CSS images and module imports are blocked by the policy before any request is made.
- A Worker that never returns is terminated while the host keeps its 50 ms heartbeat; a scene that never mounts or never finishes its probe is removed; a frame that navigates is removed.
- The same scene source draws the same figure on the in-thread and sandbox adapters.

### Release hygiene (RM-5)

- No `console` calls in shipped sources (lint) and none in the frame and Worker bundles, which are built with `console` and `debugger` dropped.
- Bridge messages are limited to the documented list, which carries no prompts, plans, model names or check reports. The probe receives only part names, a step count and singular points.
- The iPad host must ship with web inspection off in release builds (`WKWebView.isInspectable = false`). This is a setting in the native host, outside this repository.

### Still open

- An external security review of the boundary. The tests above are the starting checklist.
- Running the browser suite on WebKit and on the baseline iPad. CI runs WebKit; the iPad web view needs a device run.
- Recovery when the iPad web-content process is killed belongs to the native host: it should reload the note, and figures rebuild from stored data.
