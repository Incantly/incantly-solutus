# ADR 005: the figure frame's content security policy

- Status: accepted for v0.1
- Date: October 2026

## Context

The figure frame must deny all network access and external resources, run only the SDK's own scripts, and still render the bundled theme, the validated scene CSS and PNG snapshots. A `srcdoc` frame inherits the host page's policy, and a `<meta>` policy inside it can only tighten that policy further.

## Decision

The shell writes this policy as a `<meta http-equiv="Content-Security-Policy">` tag, with hashes computed when the shell is built:

```text
default-src 'none';
script-src 'sha256-<renderer script>';
style-src 'sha256-<bundled theme>' 'sha256-<validated scene CSS>';
img-src blob: data:;
worker-src blob:;
form-action 'none';
base-uri 'none'
```

- Scene JavaScript never appears as a script element. It is joined to the Worker runtime in a `blob:` Worker, which inherits the frame's policy, so `eval`, `new Function`, `fetch`, `importScripts` and WebSockets all fail inside it.
- Hashes, not nonces: the shell is static per figure, and no per-response secret is copied into the frame.
- The renderer sets styles through the CSSOM, never through `style` attributes, so no `'unsafe-inline'` is needed.
- `'wasm-unsafe-eval'` is added only if the QuickJS fallback runtime is enabled.

CSP cannot stop a frame from navigating itself, so the HTML validator strips `meta`, `a`, `base`, `link`, `form` and `foreignObject`, and the host destroys any frame that loads a second time.

### Amendment: frames warmed before their scene (PRD 25.4)

A frame booted before its scene exists cannot hash CSS it has not seen. Its policy allows the bundled theme by hash and, for styles only, one nonce: 128 random bits made in the host for that frame, written into its policy and sent only over the frame's own port, with the scene's markup and styles in the `init` message. The frame script copies it onto the two style elements it makes, the integrator's CSS and then the validated scene CSS, and onto nothing else. Scripts are still allowed by hash alone, the scene's markup is still the validator's canonical HTML (which has no `style` elements or attributes), and scene code runs in the Worker, which has no DOM to make a style element in. A frame mounted with its scene keeps the hashes-only policy above.

## Consequences

- A host page with its own strict policy must also allow the renderer hash, `worker-src blob:` and `img-src blob: data:`, because `srcdoc` inherits it.
- Policy tests assert that a frame cannot fetch, open a WebSocket, import a script or submit a form.
