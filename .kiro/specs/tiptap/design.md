# Tiptap extension: design

The feature design is `docs/features/tiptap/design.md`; this file says where each part lives. The build plan is
`handoff/tiptap/plan.md`.

## Package `packages/tiptap/src/`

| File | Holds |
|---|---|
| `attrs.ts` | `IncantlyFigureAttrs`, defaults, `checkAttrs` (gives `bad_attrs`), `newFigureId`, the 64 KB limit. No Tiptap import. |
| `figure-node.ts` | `IncantlyFigure` node: schema, HTML parse and render, paste of scripts, id de-duplication, the commands. |
| `node-view.ts` | `FigureNodeView`: placeholder, mount and unmount through `createApp`, outside script changes, picture refresh, error badge, size handle. |
| `scheduler.ts` | One `SchedulerHost` per editor and the routing of its orders to node views. |
| `code-panel.ts` | The lines panel: per-line results, 300 ms debounce, commit as one transaction, conflicts. |
| `toolbar.ts` | The floating figure toolbar and the AI box. |
| `slash.ts` | A small ProseMirror plugin for the slash menu (no extra package). |
| `ai.ts` | The client for `@incantly/server`: request body, streamed lines, `ai_unavailable`, `ai_partial`. `fetch` is injectable. |
| `formula-node.ts` | `IncantlyFormula` inline node and its view. |
| `store.ts` | Per-editor registry: figure id → live app or headless app, used by formulas and export. |
| `export.ts` | `refreshPictures(editor)`, `toMarkdown(doc)`. |
| `extension.ts` | `Incantly` extension: options, adds both nodes and the plugins. |
| `index.ts` | Public exports. |

## Rules

- Everything that touches a figure goes through `@incantly/sdk` (`createApp`, `createHeadlessApp`, `exportFigure`).
- Errors are `Result` values in the errors format; nothing throws out of a node view.
- Writes to the document are Tiptap transactions; `picture` refreshes use `addToHistory: false`.
- No Yjs dependency: the script is a plain attribute, and a host adds its own collaboration extension.
- `@tiptap/core` and `@tiptap/pm` are peer dependencies (and dev dependencies for tests).

## Studio

- `apps/studio/notes.html` and `src/notes.ts`: a demo editor with three figures, a formula, the slash menu and a
  read-only toggle.
