# SDK: design

The feature design is `docs/features/embed-files-export/design.md`. This file says where each part lives.

## `packages/sdk/src/`

- `registry.ts`: `sdkRegistry()`, every command area in one table (the studio's table moves here).
- `app.ts`: `createHeadlessApp`, the `App` core over one kernel `Figure`. Writes are lines; reads are data.
- `events.ts`: the event hub. Kernel events become typed SDK events with a `source`; delivery is on a microtask
  after the update pass; per-frame coalescing uses an injected scheduler (the screen gives `requestAnimationFrame`,
  Node and tests give a microtask or a manual one).
- `values.ts`: kernel values to SDK `Value`s (typed arrays to arrays, undefined with its reason).
- `errors.ts`: `apiError(area, kind, …)` and the `TypeError` guard.
- `file.ts`: `IncantlyFile`, save, load, validation, migrations, limits, assets, fragment encoding.
- `frame.ts`: `serveApp` and `connectApp`, the envelope protocol.
- `export.ts`: PNG and SVG through the view package.
- `mount.ts`: `createApp` with a container (round 5).

The core holds no DOM, so it runs in Node, a worker and the frame host alike.
