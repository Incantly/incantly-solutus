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
| `core/tools/` | `ToolDef`, the tool state machines (each a `*_MACHINE` table), `defaultTools`, `inkTools` |
| `core/bindings.ts` | Arrow bindings |
| `core/snap.ts` | Snap guides |
| `core/clipboard.ts` | Copy and paste formats |
| `core/draw.ts` | Draw list, tiles, level of detail, culling |
| `core/agent.ts` | `board_read` and `board` tool definitions and the runner; `agent-types.ts` (actions, checks), `agent-read.ts`, `agent-place.ts`, `agent-actions.ts`, `agent-hand.ts` (hand animation), `agent-service.ts` (transport, job, conversation), `circle.ts` (circle to ask), `tools/ask.ts` |
| `core/file.ts` | Save, load, migrations, ink encoding |
| `core/perf.ts` | Frame and input timings as events |
| `web/input.ts` | Pointer Events to `InputSample`, coalesced and predicted samples, keys |
| `web/painter.ts` | `BoardPainter` on the view package's WebGL 2 back-end, Canvas 2D backup, the live layer |
| `web/figures.ts` | Live figure cards over the canvas, under the scheduler |
| `web/ui/` | The shell: icons, menus, shell options, theme, styles (the toolbar, bars and pages are built in `board-view.ts` from them); `agent-panel.ts` and `circle-menu.ts` (round 5); `web/agent*.ts` hold the HTTP client, the SDK host for figure lines and the hand on the live layer |
| `web/create-board.ts` | `createBoard(options)` |
| `index.ts` | Public exports; `core` is also a subpath, `@incantly/board/core` |

## Rules

- `core` imports only `@incantly/kernel` types, `@incantly/sdk` headless parts and `@incantly/view/core`.
- No new library: ink outline and shape fixing are our own code.
- Every write is a transaction; nothing throws out of a public call.
- Every state is one field over a `*_MACHINE` table; the machines (store transaction, history, tools, figure cards, agent job, circle to ask) are written in `docs/state-machines.md` (section "board") before the code. Every lint rule is an error in `packages/board`.
- Tests are written by the tester from the docs, in `packages/board/test/spec/`.

## Studio

- `apps/studio/board.html` and `src/board.ts`: a board with two pages, ink, shapes, a figure card, a customised toolbar demo, and the Ask tool on a fake transport.
