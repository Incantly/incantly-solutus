# Plan: the Tiptap extension (tiptap tasks 1 to 5)

Written by the planner for the builder. Spec: `.kiro/specs/tiptap/` (requirements R1 to R11, design). Docs:
`docs/features/tiptap/{design,ui,errors,agent}.md`, `docs/design/performance.md` 4 (the page scheduler),
`docs/features/errors/design.md` (the error format), `AGENTS.md`.

## Where

- Branch `feat/tiptap`, cut from integration `e7fe381`, checked out in the main checkout. Never push to `main` or
  `integration`; never chain `git push` after other commands in one shell call.
- `@tiptap/core` 3.34.0 and `@tiptap/pm` 3.34.0 are already installed (dev and peer dependencies of
  `packages/tiptap`; all 18 new packages are MIT). Add no other package. No `@tiptap/starter-kit`, no
  `@tiptap/suggestion`, no Yjs.
- Files: `packages/tiptap/src/**`, `packages/tiptap/bench/**`, `apps/studio/notes.html`, `apps/studio/src/notes.ts`,
  the studio's Vite config (one more page, as `embed.html`), `docs/features/tiptap/design.md` (the sections named
  below), `.kiro/specs/tiptap/tasks.md` ticks, the usage log, `handoff/tiptap/builder-notes.md`.
- Do not change `packages/sdk` or `packages/view`. A gap there is a finding in builder notes (`TT-n`), worked around
  inside `packages/tiptap`.
- You write no tests. A Tiptap editor works in happy-dom: a probe made an `Editor` with a custom atom node and a node
  view, then `await createApp(...)` and `app.export({ format: 'svg' })`, all fine.
- `export TMPDIR=$KIROCREW_SCRATCH/tmp`. No heredocs or python to write files. Playwright is in `$KIROCREW_SCRATCH/pw`.

## SDK and view facts you will use

- `createApp(opts: AppOptions): Promise<MountedApp>` (`packages/sdk/src/mount.ts`). It THROWS `TypeError` on bad
  options: wrap every call in `try`/`catch`. `AppOptions`: `container`, `script`, `mode`, `readOnly`,
  `size: { width: number | 'fill'; height: number | 'fill' }`, `ui: Partial<UiOptions>` (`menu`, `undoRedo`,
  `clockBar`, `zoomButtons`, `resetButton`, `dragPoints`, `panAndZoom`, `fileFeatures`, `borderColor`, `background`).
- `App`: `run(lines)` → one `LineResult` per line (`LineOk { ok, line, name?, type?, summary?, created, changed,
  undefined }` or an error with `kind`, `message`, `hint`); `runBatch` (all or nothing); `loadScript(text)` →
  `{ ok, applied, failed }`; `toScript()`; `figureSummary()`; `value(name)`; `on(type, handler)`; `resize(w, h)`;
  `setMode(mode)`; `saved`; `export({ format })` → `ExportResult { ok, blob, text?, width, height }` or an error;
  `destroy()`. `hasClock(figure)` is exported. Read `packages/sdk/src/app.ts` for the event names and for how
  `createApp` treats failing lines of `script` (if it stops at the first bad line, mount with no script and `run` the
  lines yourself so good lines still draw).
- `createHeadlessApp(opts)` for checks with no screen (paste detection, the code panel when the figure is not live,
  `refreshPictures`, formulas).
- `SchedulerHost(config, { onAction(action, record) })` in `packages/view/src/web/scheduler-host.ts`, with
  `DEFAULT_SCHEDULER_CONFIG` (`maxLive 3`, `nearPx 300`, `settleMs 150`, `saveMs 8000`). Read it and
  `core/scheduler.ts` before you write `scheduler.ts`: which action means mount, which means pause, save and
  restore, and how `noteMounted`, `noteFirstDraw`, `setPlaying`, `touch`, `observe`, `start` and `stop` are meant to be
  used. If `observe` needs `IntersectionObserver` and it is missing, fall back to `setVisible` from a scroll listener;
  write what you found in builder notes.
- The SDK screen has no sound control (TT finding: R2.7 can only keep sound off). Do not build one; note it.
- `AppModeId` and the list of modes: `packages/modes`.

## Round 1: node, attributes, HTML, paste, ids, commands (task 1)

`attrs.ts` (no Tiptap import):
- `IncantlyFigureAttrs` as design 2, `FIGURE_DEFAULTS`, `SCRIPT_LIMIT = 64 * 1024` (UTF-8 bytes).
- `checkAttrs(raw: Record<string, unknown>): Result<IncantlyFigureAttrs>`: `id` non-empty string, `script` string
  within the limit, `mode` a known `AppModeId`, `width` a positive finite number or `'full'`, `height` 120 to 4000,
  `caption` string, `picture` `null` or a string starting `data:image/` or `https:`, `version === 1`. HTML gives
  strings: numbers are parsed here. The error is `bad_attrs` with `message`, `hint` (errors.md example wording) and
  `node: id`.
- `newFigureId()`: `fig_` and 8 base-62 characters from `crypto.getRandomValues`.

`figure-node.ts`: `IncantlyFigure = Node.create<IncantlyTiptapOptions>({ name: 'incantlyFigure', group: 'block',
atom: true, draggable: true, selectable: true })`.
- Attributes keep the raw values (`parseHTML` per attribute reads the data attribute as a string; no coercion that
  could lose data), so a node that fails `checkAttrs` keeps everything (R1.4).
- `renderHTML`: `['figure', { 'data-incantly-figure': '', 'data-id', 'data-mode', 'data-width', 'data-height',
  'data-version' }, ['img', { src: picture, alt: caption, width, height }] (only with a picture),
  ['pre', { 'data-incantly-script': '', hidden: '' }, script], ['figcaption', {}, caption]]`. `parseHTML`: tag
  `figure[data-incantly-figure]`, the script from the `pre`'s text, the picture from the `img`'s `src`. Text only:
  nothing in it ever runs.
- A ProseMirror plugin (`appendTransaction`) gives a new id to a figure whose id is empty or already used earlier in
  the document (paste, duplicate). Runs only when `docChanged`.
- Paste (`handlePaste`): plain text only (no `text/html`), at most 64 KB, and either the `# incantly 1` header or every
  non-empty line checks `ok` in one headless app of the default mode and at least one line has `=`. Then insert a
  figure with that script.
- Commands, declared on `@tiptap/core`'s `Commands` interface: `insertIncantlyFigure({ script?, mode?, height? })`,
  `updateIncantlyFigure(id, patch)` (merge, `checkAttrs`, on failure return `false` and report the error),
  `askIncantly(id, request)` (starts the round-4 job; returns `false` with `ai_unavailable` when there is no server
  and no `aiTransport`).

`extension.ts`: `Incantly = Extension.create<IncantlyTiptapOptions>` with the design 6 options plus
`onError?: (e: TiptapError) => void` and `aiTransport?` (round 4). `addExtensions` returns both nodes configured with
the same options. Errors also go to `editor.storage.incantly.lastError`. Add `onError` and `aiTransport` to design 6 in
the feature doc.

## Round 2: node view under the scheduler (task 2)

`scheduler.ts`: one per editor, made in the extension's `onCreate`, disposed in `onDestroy`: a `SchedulerHost` with
`maxLive: liveLimit`, a map id → `FigureNodeView`, and `start()`. Tab visibility goes to `setTabVisible`.

`store.ts`: id → `{ live?: MountedApp; headless?: App; script }`; `appFor(id)` makes a headless app lazily from the
script and drops it when the script changes. Used by formulas and export.

`node-view.ts`, `FigureNodeView implements NodeView`:
- DOM: `div.inc-tt-figure[data-id]` > `div.inc-tt-box` (exact width and height, `role="figure"`,
  `aria-label` = caption, `tabindex="0"`), `div.inc-tt-badge` (hidden), `div.inc-tt-notice` (hidden),
  `div.inc-tt-caption`, `div.inc-tt-resize` (writers only). Placeholder: the picture as an `img` at the node's size,
  else an empty box with the caption. A `bad_attrs` node shows "This figure could not be loaded" and, for writers, an
  "Edit lines" button.
- Orders: mount (`createApp` in the box with `size: { width: 'fill', height }`, `mode`, `readOnly`, `ui: { menu:
  false, undoRedo: false, fileFeatures: false, resetButton: false, zoomButtons: false, panAndZoom: true, dragPoints:
  true, clockBar: <hasClock>, borderColor: 'none' }`), then `noteMounted` and, after the first paint, `noteFirstDraw`;
  play state → `setPlaying`. Pause: stop the clock. Save: export (SVG; PNG for `graphing3d`) to a data URL; if it is
  under 256 KB write `picture` with `setMeta('addToHistory', false)`; keep `{ script, readerScript: app.toScript() }`
  in memory; destroy the app; show the picture. Restore: remount; if the node's script still equals the saved
  `script`, load `readerScript` (the reader's sliders stay), else load the node's script and show `restore_failed`
  ("Your changes were reset").
- Line errors on mount: good lines draw; the badge says how many lines failed; clicking it opens the code panel at
  the first bad line.
- `update(node)`: other type → `false`. Script changed: if it equals `this.ownCommit` just record it; else, when
  live, apply: if the new script starts with the old one, `run` only the new lines, otherwise `loadScript` the whole
  new script. Mode changed: `setMode`, remount when it fails. Height or width changed: `resize`. Return `true`.
- `stopEvent`: `true` for events inside the box, the panel and the toolbar; `false` for the outer frame so the editor
  can select and drag the node. `ignoreMutation`: `true`.
- `mount_failed`: `createApp` throws or rejects → show the picture or caption with "Live figure unavailable"; retry
  once on the next mount order; after a second failure stay a picture and tell the scheduler it is not live.
- `context_lost`: listen for `webglcontextlost` on canvases in the box; keep the last frame; remount on
  `webglcontextrestored`.
- `destroy`: unregister, unobserve, destroy the app, drop it from the store.
- Writes never come from `constructor` or `update` synchronously: queue them (`queueMicrotask`) so ProseMirror is not
  re-entered.

## Round 3: toolbar, code panel, size, slash, read-only, keyboard (task 3)

Writer UI shows only when the extension is not `readOnly` and `editor.isEditable`.
- `toolbar.ts`: on `selectNode`, a bar above the figure: Edit lines, AI, Mode (a `select` of the modes), Size
  (Full width / a px number), Caption (an input that commits on Enter or blur), Save view as default (only while
  live; commits `app.toScript()` as the script), Delete. Hidden on `deselectNode`.
- `code-panel.ts`: under the figure, a `textarea` and, beside it, one result row per line in the same monospace line
  height (`✓ Type` or `✓ summary`, or `✗ message. hint`). Input → 300 ms debounce → run the text in a fresh headless
  app for per-line results → apply to the live figure the same way `update` does → set `this.ownCommit = text` →
  one transaction `setNodeAttribute(pos, 'script', text)`. So each pause is one undo step. Escape closes the panel and
  puts the selection back on the node. Opening at a line puts the caret on that line.
- Resize: pointer drag on the bottom edge, height 120 to 4000, live while dragging, one transaction on pointer up.
- `slash.ts`: a ProseMirror plugin. When the cursor is in a paragraph whose text is `/` and a query, show a menu
  (absolutely positioned from `view.coordsAtPos`) with the four items of ui.md, filtered by the query; ArrowUp,
  ArrowDown, Enter, Escape in `handleKeyDown`; choosing deletes the `/query` text and inserts the figure (graph:
  `graphing`, 3D: `graphing3d`; Ask AI: a new figure with its AI box open). Not shown when read-only.
- Keyboard: Tab reaches the box; Escape inside the box focuses the editor with the node selected.

## Round 4: AI, collaboration, formula, export (task 4)

`ai.ts`. There is no server yet (`packages/server` is empty), so the client defines the protocol; add it as a new
section "AI request" in the feature design:
- `POST {server}/v1/figure/draw`, JSON `{ request, mode, script, figure: FigureSummary | null, before, after }`
  (`figure` only for an edit, that is a non-empty script; `before` and `after` are up to 500 characters of document
  text around the node).
- The response is NDJSON: `{ "lines": [...] }` events, then `{ "done": true }`, or `{ "error": { "kind", "message" } }`.
- `AiTransport = (req, signal) => AsyncIterable<AiEvent>`; `httpTransport(server, fetchImpl = fetch)`; the
  `aiTransport` option overrides it (tests, other hosts).
- The job: lines apply to the figure as they arrive (live app, else the store's headless app) and show in the code
  panel; failed lines are kept aside. At the end the script commits once: the old script plus the lines that worked.
  Non-2xx, a network error or an `error` event with no line applied → `ai_unavailable` with the reason. A stop part
  way with some lines applied → `ai_partial` listing the failed or missing lines. An AI box (input and Send) under the
  toolbar shows the reason or the notice. A new request on the same figure aborts the old one (`AbortController`).
- `askIncantly(editor, id, request): Promise<Result<{ applied: number; failed: readonly string[] }>>` is exported; the
  command calls it.

Collaboration: in `update`, when the panel has text not yet committed and the incoming script is not `ownCommit`, the
incoming script wins; the panel shows the writer's lines under "Your lines" with Re-apply (commits them) and Discard;
report `collab_conflict`.

`formula-node.ts`: `IncantlyFormula`, inline atom, attrs `expr`, `figure`, `format`; HTML
`<span data-incantly-formula data-expr data-figure data-format>expr</span>`; command `insertIncantlyFormula`.
- The value is read from `store.appFor(figure)`: find the SDK or kernel call that evaluates an expression against a
  figure without adding an object (look for a line preview in `packages/kernel/src/language/`). If none is public,
  copy the figure into a headless app per formula and run `__f = expr` there; write which in builder notes.
- `format` is a text format word of the text-logic area (`3sf`, `deg`, `pct`, …).
- Live: subscribe to the live app's change events and refresh, at most once a frame.
- No figure: show `expr` as maths through the view package's maths layout (`packages/view/src/core/math`) as SVG.
- Failure: the expression with a red underline and the message as its `title`.

`export.ts`:
- `refreshPictures(editor, env?): Promise<{ updated: number; failed: { id, error }[] }>`: per figure, a headless app
  of its mode, script and size (`width` `'full'` → 720), SVG (PNG for `graphing3d` with `env.canvas`), all pictures
  in one transaction with `addToHistory: false`.
- `figureToMarkdown(attrs)`: `![caption](picture)` then a fenced `incantly` block with the script; `docToMarkdown(json)`
  for paragraphs, headings, text and the two nodes (a formula becomes its last value in backticks), other nodes their
  text.

## Round 5: studio page, bench, screenshots (task 5)

- `apps/studio/notes.html` and `src/notes.ts`: an editor with small hand-made `doc`, `paragraph`, `heading` and `text`
  nodes, the `Incantly` extension, a page about a parabola with three figures (graph, geometry, 3D), one formula
  reading a root, and a Read-only switch. Add the page to the studio's Vite config.
- `packages/tiptap/bench/tiptap.bench.ts` (happy-dom): open a 50-figure document, at most `liveLimit` mounted and the
  time; insert one figure; one code-panel commit. Targets of R11 (16 ms outside the figure's own apply).
- Screenshots with Playwright into `handoff/tiptap/screens/`: reading, a selected figure with the toolbar, the code
  panel with an error line, the slash menu, read-only, a formula.

## Done when

- `npm run lint`, `npm run typecheck` and `npx vitest run` pass.
- Tasks 1 to 5 ticked, a usage-log row per round, builder notes with every finding (`TT-1`, …).
- Commit on `feat/tiptap` in small commits per round; push the branch; open a PR to `integration`. Do not merge.
