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

## Failure behavior

A non-responsive, over-budget, or invalid execution instance is destroyed. The learner sees the last approved snapshot and text description, never a stack trace or empty box.
