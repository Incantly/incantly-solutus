# TipTap extension: design

Status: accepted for building. Package `packages/tiptap`, published as `@incantly/tiptap`. Builds on `@incantly/sdk` and follows `docs/design/performance.md`. Learns from the legacy v1 package `packages/tiptap` (figure node, node view, scheduler), which we wrote.

## 1. What it does

Puts live Incantly figures inside any Tiptap document: notes, lesson pages, documentation. A reader sees the graph, the 3D model, the animation or the formula, and can drag, play and change sliders without leaving the page. A writer inserts a figure, edits its lines, or asks the AI to make one.

Sub-features:

1. A block node `incantlyFigure` that stores the figure as its script.
2. A node view that mounts the figure through the SDK, under the page scheduler.
3. Insert by slash command, toolbar button, paste of a script, or the AI panel.
4. Edit in place: the figure's lines in a code panel under it, with results and errors per line.
5. Read-only mode for published pages.
6. Copy and paste between documents, keeping the script.
7. Export of the document: each figure becomes its SVG (or a picture for 3D) in HTML, PDF and Markdown exports, with the script kept as data.
8. An inline node `incantlyFormula` for a live value or a maths text in running prose, such as "the area is {Area(p)}".

## 2. The node

```ts
interface IncantlyFigureAttrs {
  readonly id: string;              // stable, created on insert
  readonly script: string;          // the figure's lines, the only source of truth
  readonly mode: AppModeId;         // default 'figure'
  readonly width: number | 'full';  // px, or the column width
  readonly height: number;          // px
  readonly caption: string;         // plain text, optional
  readonly picture: string | null;  // last saved picture as a data or asset URL, for placeholders and exports
  readonly version: 1;
}
```

- The node is an atom block: the editor treats it as one unit for selection, drag and delete.
- The document stores the script, never computed values. Loading the document replays the script, as the core design requires.
- `picture` is a cache. It is refreshed when the figure is saved by the scheduler or when the writer edits it, and is never required to show the figure.
- Free values a reader changes are not written back to the document unless the writer chooses "save view as default".

## 3. The node view

1. On creation the node view registers with the page scheduler (`docs/design/performance.md` section 4) and shows the placeholder (picture, or a sized empty box with the caption).
2. The scheduler moves it through `ready`, `live`, `paused` and `saved`. The node view only follows orders: mount, pause, resume, save.
3. Mount creates the figure through `createApp` from the SDK, in `figure` mode or the node's mode, inside the shared GPU context.
4. A change to `script` from outside (undo, collaboration, the AI) is applied as a batch through `applyBatch`. A change the node view made itself is not re-applied.
5. Destroy unregisters from the scheduler and frees the figure.

## 4. Editing

- Selecting the figure shows its toolbar: edit lines, AI, mode, size, caption, delete.
- **Edit lines** opens a code panel under the figure. Each line shows its result or its error (the error format in `docs/features/errors/`). Lines apply as the writer types, after 300 ms without a key.
- The script in the node updates when a batch of edits commits, as one Tiptap transaction, so undo in the editor undoes the edit.
- **AI:** the writer types a request. The server's Muse Spark model writes lines through `draw` (core design section 10). Lines stream into the figure; when it finishes, the script is committed in one transaction.

## 5. Collaboration

- The script is a normal string attribute, so Tiptap collaboration (Yjs) syncs it as any attribute.
- Two writers editing the same figure: the last committed script wins for the whole attribute. Line-level merging is not attempted; the losing writer sees a notice and their lines in the code panel, to re-apply.

## 6. Commands

```ts
editor.commands.insertIncantlyFigure({ script?: string; mode?: AppModeId; height?: number; id?: string; caption?: string });
editor.commands.updateIncantlyFigure(id: string, patch: Partial<IncantlyFigureAttrs>);
editor.commands.askIncantly(id: string, request: string);   // AI, needs a server URL (or an aiTransport) in the options
editor.commands.insertIncantlyFormula({ expr: string; figure?: string; format?: string });
```

- `insertIncantlyFigure` takes the mode from `mode`, else from the script's `# incantly 1 mode=…` header, else the `defaultMode` option. `id` and `caption` are for hosts that make their own.
- `updateIncantlyFigure` merges the patch into the node's attributes and checks the result as in 2 (`bad_attrs`); on a failure, or an unknown id, it returns `false`, changes nothing and reports the error. The `id` cannot be changed. A patch of only `picture` is not an undo step.
- `askIncantly` returns `false` with `ai_unavailable` when there is neither `server` nor `aiTransport`.
- Every error is also given to `onError` and kept in `editor.storage.incantly.lastError`.

Extension options:

```ts
interface IncantlyTiptapOptions {
  readonly server?: string;          // URL of @incantly/server, for AI; no AI without it
  readonly readOnly?: boolean;
  readonly liveLimit?: number;       // default 3
  readonly defaultMode?: AppModeId;  // default 'figure'
  readonly sound?: boolean;          // default false: figures stay silent until a reader turns sound on
  readonly onError?: (error: TiptapError) => void;   // every error the extension reports, in the format of docs/features/errors/
  readonly aiTransport?: AiTransport;                // replaces the HTTP client for the AI (tests, other hosts); see 9
}
```

## 7. Performance

All of `docs/design/performance.md` applies. In particular: one shared GPU context per editor, at most 3 live figures, pause when off screen, saved as a picture after 8 s off screen, and no frames for still figures.

## 8. Better than the legacy version

- The node stores lines in our language, not JavaScript scene programs, so a figure is short, checkable and safe to share.
- Figures share one GPU context, so a long document cannot lose figures to the browser's context limit.
- Edits are Tiptap transactions, so editor undo, collaboration and history work on figures.

## Sources studied

- Our legacy package on `legacy/v1`: `packages/tiptap/src/figure-node.ts`, `node-view.ts`, `scheduler.ts`, `attributes.ts`, `store.ts`.
- Tiptap documentation on custom nodes and node views (MIT-licensed project).
