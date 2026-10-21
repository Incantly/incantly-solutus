# ADR 002: run scene code in a Worker inside a sandboxed frame

- Status: accepted for v0.1
- Date: October 2026

## Context

Generated scene code is untrusted. The host must survive a scene that throws, loops forever, allocates without bound, or tries to reach the network or the editor. The [sandbox contract](../sandbox.md) requires that a non-responsive scene can be terminated.

On desktop Chromium, sandboxed frames without `allow-same-origin` get their own process, so a runaway frame cannot block the editor. WebKit's site isolation is still in development, so on Safari and in a `WKWebView` a frame probably shares the editor's process and main thread. A `while (true)` in such a frame would freeze the whole note.

## Decision

The first execution adapter runs scene JavaScript in a dedicated Worker created inside a frame sandboxed with `allow-scripts` only.

- The frame document holds the trusted renderer, the bundled theme and the validated scene HTML and CSS.
- The Worker holds the scene runtime and the scene code. It has no DOM. It sends draw commands and UI state to the renderer.
- The host talks to the frame only through a transferred `MessagePort` carrying typed, versioned messages with an unguessable channel ID.
- A watchdog in the frame terminates the Worker when it stops answering. A watchdog in the host destroys the frame when the frame stops answering.
- The frame is built from `srcdoc` so figures work offline. A cross-site sandbox origin can replace `srcdoc` on the web without changing scene source or stored nodes.

The scene runtime and renderer talk through one message interface, so the same scene also runs in-thread for tests and trusted reference scenes. The probe runs through the same adapter in a fresh hidden instance.

## Consequences

Positive:

- A runaway scene cannot freeze the editor on any platform: `Worker.terminate()` stops it at once.
- The scene sees no DOM, no layout and no ambient browser APIs, which shrinks what the validator must police.
- Adapter details stay out of scene source and persisted documents.

Costs:

- Every frame crosses a message boundary. Commands are batched per frame and only changed attributes are sent.
- Workers inside sandboxed frames need testing on each WebKit version we support.
- Each live figure boots a frame and a Worker, so the host caps live figures and shows snapshots for the rest.

## Rejected alternatives

- **Scene code on the frame's main thread:** cannot be stopped on WebKit without freezing the editor.
- **SES or ShadowRealm alone:** neither can stop a runaway loop.
- **QuickJS compiled to WebAssembly as the default:** strongest isolation, but an interpreter and about 500 KB of code. It stays the fallback runtime if Workers in sandboxed frames prove unreliable.

## Open questions

- Confirm the iPad host is a `WKWebView` and name the baseline devices and runtimes for every release gate.
- Measure boot time and per-frame message cost on the baseline iPad.
