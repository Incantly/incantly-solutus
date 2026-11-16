# SDK: requirements

Area: `docs/features/embed-files-export/` (`design.md`, `ui.md`, `agent.md`, `errors.md`). Code in `packages/sdk`,
used by `apps/studio`. Branch: `feat/sdk-*`.

### R1. The app core (design 3.1 to 3.6)

1. `createHeadlessApp(opts)` SHALL make an app over one figure, with no DOM: mode, script or file to start from,
   `readOnly`, `enforceLocks`. `createApp(opts)` (R5) adds the screen on top of the same core.
2. `run(lines)` SHALL apply each line as its own transaction and return one `LineResult` per line, with `created`,
   `changed` and `undefined`; `runBatch(lines)` SHALL be all or nothing.
3. Reads SHALL return data: `list(filter)` (type, free, visible, glob name, depends on; at most 5,000 with `truncated`),
   `get`, `exists`, `value` (typed: number, boolean, text, `{x, y}`, arrays, `{kind: 'undefined', reason}`),
   `definition`, `undefinedObjects`, `figure()`.
4. Writes SHALL be lines: `set`, `setStyle`, `show`, `hide`, `remove`, `rename`, `clear`. A dependent object is
   `not_free`; a missing one `unknown_name` with close names; a taken name `name_taken`; `readOnly` gives `read_only`.
5. `undo`, `redo`, `markUndoPoint`, `saved`, `markSaved`.
6. `view` (window, axes, grid, keep ratio, fit) and `clock` (play, pause, seek, speed, range) SHALL work without a
   screen; their state is in the script (`@view`, `@axes`, `@grid`, `@clock`).
7. `on`, `once` SHALL deliver typed events with `source` (`user`, `script`, `api`, `clock`, `file`) after the update
   pass, never inside it; `changed`, `drag`, `viewChanged`, `clockChanged` coalesced to one per frame unless asked; a
   handler that throws is reported as an `error` event; filters by object, type and source.
8. `setMode` SHALL switch the app mode with the modes package (dry run, `mode_forbids` gate); `destroy` SHALL make every
   later call `destroyed`.
9. Every API error SHALL be data `{ ok: false, area, kind, message, hint?, detail? }`; wrong argument types throw
   `TypeError`.

### R2. Files (design 4; errors 3)

1. `toScript()` SHALL start with `# incantly 1 mode=<id>` and be deterministic.
2. `save()` / `saveText()` SHALL give an `IncantlyFile` (JSON): script, settings, clock, views, assets, meta, optional
   thumbnail and cache; unknown keys and `extensions` kept on a round trip.
3. `load(file | text)` SHALL sniff JSON, gzip or a script, validate the shape (`file_invalid` with the path),
   refuse newer formats (`file_too_new`), migrate older ones, check limits (`file_too_large`), check assets
   (`asset_invalid`, dropped with a warning), replace the figure only when something loads, and list failed lines.
4. A URL fragment form: deflate + base64url, read back the same.

### R3. Frames (design 3.7; errors 2)

1. `serveApp(app, { allowOrigins })` in the frame and `connectApp(iframe, { origin })` in the page SHALL speak the
   envelope protocol; every method returns a promise; events are forwarded per subscription.
2. Messages from other origins dropped (`origin_blocked`, one event per origin per minute); unknown methods,
   versions, oversize payloads (2 MB) and more than 200 calls a second refused; `timeout` and `frame_gone` on the client.

### R4. Export (design 5; errors 4)

1. PNG and SVG of the view or of everything, at a time `t`, with limits (`export_too_large`, `export_empty`,
   `export_bad_time`); other formats `export_unsupported` for now.

### R5. The screen and the studio (ui)

1. `createApp({ container })` SHALL mount the figure in a container with the `ui` switches.
2. The studio SHALL save and open `.incantly` and `.inc` files, show which lines failed, and share a link.

### R6. Benches, examples, screenshots

1. The design 10 targets: `run` overhead, `list()` of 500, `saveText` of 500, `load` of 500, the frame round trip.
