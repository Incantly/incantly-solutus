# Board: build plan

For the builder (Sonnet 5.5). Read `AGENTS.md`, `docs/features/board/*`, `.kiro/specs/board/*`, `docs/design/performance.md`. Build round by round; commit and push after each round. Builders write no tests. Opus does one review after the tester.

## Round 1: the core data

1. `core/store.ts`: `Store` with `get`, `all(kind?)`, `change(origin, fn)`. Inside `fn` a `Tx` gives `put`, `update`, `remove`. Check every record with its `KindDef.check`; on any failure throw nothing, return `Result` and apply nothing. Emit one `Diff { added, updated, removed, origin }`.
2. `core/history.ts`: a step per transaction unless `history: false`; `mergeKey` so a stroke's samples and a drag's moves become one step.
3. `core/pages.ts`: page records with fractional `index` keys (`core/fractional.ts`); the six page commands; `last_page`.
4. `core/camera.ts`: per-page camera; `toPage`, `toScreen`; zoom 0.05 to 20 about a point; steady zoom value updated 150 ms after the last change (the core gets time from the input layer, never `Date`).
5. `core/index-grid.ts`: `Map<cellKey, Set<id>>`, 512 units; insert, move, remove; queries.
6. `core/file.ts`: deterministic JSON writer (sorted keys); ink encoding as in design 12; load with checks and migrations; unknown kinds kept.

## Round 2: ink

1. `web/input.ts`: one listener set on the board element; `pointerdown/move/up/cancel`, `getCoalescedEvents`, `getPredictedEvents`; `setPointerCapture`; reuse one sample object per event (no garbage). Detect a pen that only reports 0.5.
2. `core/ink/samples.ts`: the 0.5 px filter, simulated pressure, a `Float32Array` that grows by doubling.
3. `core/ink/outline.ts`: streamline, width from pressure, offsets, round caps, corner arcs; output into a reused array.
4. `web/painter.ts`: tiles (512 device px, power-of-two zoom steps, LRU with the memory cap), the live layer (`desynchronized` canvas), the overlay; Canvas 2D backup on `render_failed`.
5. Tools: pen (3 nibs), highlighter, eraser (whole and partial), laser, lasso; palm rule.

## Round 3: shapes

Kinds of design 7.1 with `KindDef`; select tool with handles, rotate, snap guides, bindings for arrows, group, align, order, lock, flip; clipboard formats; `core/ink/recognise.ts` with the 6% rule and the 500 ms hold.

## Round 4: figure cards and the UI shell

1. `web/figures.ts`: one `SchedulerHost` per board; `createApp` hosts over the canvas moved by a CSS transform; pictures while the camera moves fast; double-click and Esc.
2. `web/ui/`: toolbar from `toolbar.groups`, style bar, page bar with thumbnails, zoom bar, main and context menus; all from options (design 10); `icon_invalid`, `tool_unknown`, `shortcut_conflict`.
3. `web/create-board.ts`: `createBoard(options)`; headless when no `container`.

## Round 5: agents

`core/agent.ts`: `board_read`, `board` and the actions of `agent.md`, `Place` with `near`, `$last`; hand-style animation on the live layer; circle-to-ask item finding and suggestions; `BoardAgentTransport` with an HTTP client for `POST {server}/v1/board/ask` (NDJSON); the agent panel and Stop.

## Round 6: finish

Errors pass against `errors.md`; `packages/board/bench/board.bench.ts` for every row of design 13; a Chrome script with the CPU 4× slower (as `packages/kernel/bench/chrome-physics.mjs`); `apps/studio/board.html`; screenshots in `handoff/board/screens/`; tick tasks; usage-log rows.
