# Board: design

The feature design is `docs/features/board/design.md`; this file says where each part lives. The build plan is `handoff/board/plan.md`.

## Package `packages/board/src/`

| Path | Holds |
|---|---|
| `core/store.ts` | Records, transactions, diffs, origins, limits |
| `core/history.ts` | Undo and redo stacks, steps that are not history |
| `core/pages.ts` | Page records, page commands, the current page |
| `core/camera.ts` | Camera per page, screen to page units, steady zoom |
| `core/index-grid.ts` | The sparse 512-unit spatial grid; viewport, point, box and lasso queries |
| `core/kinds/` | `KindDef` and one file per built-in kind |
| `core/geometry.ts` | Bounds, hit tests, outlines, cached per record |
| `core/ink/` | `samples.ts` (filter, simulated pressure), `outline.ts`, `recognise.ts` (shape fixing) |
| `core/tools/` | `ToolDef`, the tool state machines, `defaultTools` |
| `core/bindings.ts` | Arrow bindings |
| `core/snap.ts` | Snap guides |
| `core/clipboard.ts` | Copy and paste formats |
| `core/draw.ts` | Draw list, tiles, level of detail, culling |
| `core/agent.ts` | `board_read`, `board` actions, circle-to-ask items, the transport |
| `core/file.ts` | Save, load, migrations, ink encoding |
| `core/perf.ts` | Frame and input timings as events |
| `web/input.ts` | Pointer Events to `InputSample`, coalesced and predicted samples, keys |
| `web/painter.ts` | `BoardPainter` on the view package's WebGL 2 back-end, Canvas 2D backup, the live layer |
| `web/figures.ts` | Live figure cards over the canvas, under the scheduler |
| `web/ui/` | Web Components: toolbar, style bar, page bar, zoom bar, menus, agent panel |
| `web/create-board.ts` | `createBoard(options)` |
| `index.ts` | Public exports; `core` is also a subpath, `@incantly/board/core` |

## Rules

- `core` imports only `@incantly/kernel` types, `@incantly/sdk` headless parts and `@incantly/view/core`.
- No new library: ink outline and shape fixing are our own code.
- Every write is a transaction; nothing throws out of a public call.
- Tests are written by the tester from the docs, in `packages/board/test/spec/`.

## Studio

- `apps/studio/board.html` and `src/board.ts`: a board with two pages, ink, shapes, a figure card, a customised toolbar demo, and the Ask tool on a fake transport.
