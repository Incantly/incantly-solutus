# Tiptap extension: requirements

Area: `docs/features/tiptap/` (`design.md`, `ui.md`, `errors.md`, `agent.md`). Package `packages/tiptap`
(`@incantly/tiptap`), built on `@incantly/sdk` and the view package's scheduler. Tiptap (`@tiptap/core`, with its
ProseMirror bundle `@tiptap/pm`) is a peer dependency, never bundled. A demo page in `apps/studio`. Branch
`feat/tiptap`.

### R1. The figure node (design 2; errors)

1. A block atom node `incantlyFigure` SHALL hold the attributes `id`, `script`, `mode` (default the extension's
   `defaultMode`, itself default `figure`), `width` (px or `full`, default `full`), `height` (default 360), `caption`
   (default empty), `picture` (default `null`) and `version` (1).
2. `id` SHALL be created on insert and kept on copy inside one document; a pasted node whose `id` is already in the
   document SHALL get a new one, keeping its script.
3. The node SHALL parse from and render to HTML as `<figure data-incantly-figure>` with every attribute as a data
   attribute, the script kept as text, and the picture as an `<img>` when there is one, so copy and paste between
   documents keeps the script.
4. Attributes SHALL be checked on load: wrong types, an unknown `version`, a script over 64 KB give `bad_attrs` (format of
   `docs/features/errors/design.md`, with `node` set to the id). The node SHALL keep its raw attributes, show
   "This figure could not be loaded", and offer the code panel to fix the script.
5. The document SHALL store the script and never computed values; a reader's changes SHALL NOT be written back unless
   the writer chooses "Save view as default".

### R2. The node view and the scheduler (design 3, 7; performance 4)

1. Each figure node view SHALL register with one `SchedulerHost` per editor and show the placeholder (the picture at the
   node's exact size, else a sized box with the caption) until the scheduler orders a mount.
2. The node view SHALL follow the scheduler's `build`, `goLive`, `pause`, `save` and `restore` orders; at most
   `liveLimit` figures (default 3) SHALL be live at once.
3. Mount SHALL create the figure with `createApp` in the node's mode with figure-mode UI (no tool strip, no algebra
   view, pan and zoom on, the clock bar only when the figure has a clock), read-only when the extension is.
4. A change to `script` from outside (editor undo, collaboration, the AI) SHALL be applied to the live figure; a change
   the node view made itself SHALL NOT be re-applied.
5. `save` SHALL refresh `picture` (an SVG data URL from the SDK export) without adding an undo step, and free the live
   figure; `restore` SHALL remount from the script.
6. Destroy SHALL unregister from the scheduler and free the figure.
7. Sound SHALL stay off unless the extension's `sound` option is on and the reader turns it on.

### R3. Editing (design 4; ui Writing)

1. Selecting a figure SHALL show a toolbar: Edit lines, AI, Mode, Size, Caption, Delete (writers only).
2. Edit lines SHALL open a code panel under the figure listing each line with its result (`✓ type` or value) or its
   error message and hint; lines SHALL apply 300 ms after the last key.
3. A batch of edits SHALL commit the script to the node as one Tiptap transaction, so editor undo undoes it.
4. The bottom edge SHALL drag to change the height; the size control SHALL switch between full width and a px width.
5. A figure whose script has bad lines SHALL draw the good lines and show an error badge that opens the code panel at
   the first bad line.

### R4. Commands and insert (design 6; ui)

1. `insertIncantlyFigure({ script?, mode?, height? })`, `updateIncantlyFigure(id, patch)` (patch checked as R1.4) and
   `askIncantly(id, request)` SHALL be editor commands.
2. A slash menu SHALL offer "Incantly figure", "Incantly graph" (mode `graphing`), "Incantly 3D" (mode `graphing3d`)
   and "Ask AI for a figure".
3. Pasting plain text that is an Incantly script (the `# incantly 1` header, or every line checking without error)
   SHALL insert a figure with that script.
4. Options `server`, `readOnly`, `liveLimit`, `defaultMode`, `sound` SHALL behave as design 6.

### R5. Read-only (design 1.5; ui Reading)

1. With `readOnly`, no toolbar, code panel or slash item SHALL show; readers may still drag, play, slide and zoom.
2. Keyboard: Tab moves into the figure, Escape returns focus to the document; screen readers get the caption and the
   figure's object list.

### R6. AI (design 4; agent; errors)

1. Without `server`, `askIncantly` and the AI box SHALL give `ai_unavailable` with the reason; nothing changes.
2. With `server`, the request (the writer's text, the figure's mode, its current script and `figure` summary for an
   edit, and up to 500 characters of paragraph text before and after) SHALL go to the server; streamed lines SHALL apply
   to the figure and show in the code panel as they arrive; when the stream ends the script SHALL commit in one
   transaction.
3. A stream that stops or fails part way SHALL keep the lines that worked and give `ai_partial` listing the others.
4. The model never writes Tiptap JSON or HTML; only lines.

### R7. Collaboration (design 5; errors)

1. The script SHALL be a plain string attribute, so any collaboration extension syncs it.
2. When the script changes from outside while the writer has uncommitted panel edits, the outside script SHALL win and
   the writer SHALL see `collab_conflict` with their lines kept in the panel, to re-apply or discard.

### R8. The formula node (design 1.8)

1. An inline atom node `incantlyFormula` with `expr`, `figure` (the id of a figure in the document, or empty) and
   `format` SHALL show the live value of `expr` read from that figure, as typeset text, and follow the figure's changes
   while it is live.
2. With no figure, it SHALL show `expr` as a maths text.
3. An expression that fails SHALL show the expression with an error mark and the error message on hover.

### R9. Export (design 1.7)

1. A function SHALL refresh every figure's `picture` (headless, no mount) as SVG, or PNG for 3D.
2. `editor.getHTML()` SHALL write each figure as its picture with the script kept as data; a Markdown helper SHALL write
   the picture as an image with the script in a fenced `incantly` block.

### R10. Errors (errors.md)

1. `mount_failed` SHALL show the picture or the caption with "Live figure unavailable", retry once on the next
   `goLive`, then stay a picture.
2. `context_lost` and `restore_failed` SHALL behave as errors.md.
3. No error from a figure SHALL throw out of the extension or break the editor.

### R11. Speed (performance)

1. A document with 50 figures SHALL open with at most `liveLimit` mounted, and no frames for still figures.
2. Inserting a figure and a 300 ms code-panel commit SHALL each cost under 16 ms of main-thread work outside the
   figure's own apply.
