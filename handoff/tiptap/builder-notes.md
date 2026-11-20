# Builder notes: the Tiptap extension

Findings from building `packages/tiptap`, numbered `TT-n`. Nothing here changed `packages/sdk` or `packages/view`.

- **TT-1 (sound).** The SDK screen has no sound control, so R2.7 can only keep sound off. The `sound` option is accepted and stored; no sound button is built. A reader cannot turn sound on in a document figure until the SDK exposes one.
- **TT-2 (visibility).** `SchedulerHost.observe` needs `IntersectionObserver`. Where it is missing (happy-dom, old engines), `scheduler.ts` works out which figures are in view or within `nearPx` from their boxes and calls `setVisible`, on scroll and resize.
- **TT-3 (formula value).** The kernel's `preview(expr, view)` evaluates an expression against a figure's view without adding an object, so a formula needs no copy of the figure. The view is `app.figure.view` of the store's headless app (or the live app) for the figure. Formats (`2`, `3sf`, `deg`, `deg2`, `pct`, `sci`, `frac`, `auto`) are applied in `formula.ts` with the kernel's `formatNumber` and `valueTextOf`. If the text-logic area later publishes a format-word parser, `parseFormat` should call it.
- **TT-4 (AI protocol).** `packages/server` is empty, so the client defines the protocol (design 9): `POST {server}/v1/figure/draw`, NDJSON answer. The server must follow it, or the `aiTransport` option replaces the client.
- **TT-5 (formula node view).** A node view's constructor runs while the editor's own `view` is not yet assigned, so a node view takes the view from its constructor arguments, never from `editor.view`.
- **TT-6 (pictures of 3D).** `refreshPictures` makes PNG for `graphing3d` and needs `env.canvas` outside a browser (there is no canvas to draw on); when the export fails, that figure is a `failed` entry with `export_failed` and the others are still written. A picture over 256 KB is not stored (`PICTURE_LIMIT`).
- **TT-7 (edit clash).** The incoming script always wins; the panel keeps the writer's lines under "Your lines". Line-level merging is not attempted (design 5).
