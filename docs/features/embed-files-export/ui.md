# Embedding, files, export, sharing: what the learner sees

## 1. The frame

An embedded figure is a rounded rectangle with a 1 px border (`#D5D7DD`, radius 8 px, both changeable by options) and no menu by default.

```text
+--------------------------------------------------+
| [☰]   Quadratics                    [⟲] [↶][↷] [⤢]|  top bar (menu, title, reset, undo/redo, fullscreen)
+-----------------------+--------------------------+
|  algebra list         |                          |
|  f(x) = x² - 2        |        graphics          |
|  a = 2   ●────○ 5     |                    [+]   |
|                       |                    [-]   |
|                       |                    [⌂]   |
+-----------------------+--------------------------+
| ▶  ━━━━●━━━━━━━━━━━━  0:04 / 0:30   1x ▾         |  clock bar
+--------------------------------------------------+
```

- The top bar, algebra pane, clock bar, zoom buttons and reset are each switched on or off by `ui` options. Defaults depend on the mode (see app-modes). In a lesson film the figure shows only graphics and the clock bar.
- The title comes from `@title`. Without it the top bar has no title text.
- The app fills its container (`size: fill`) and re-lays out on resize with a 100 ms debounce. A container under 320 px wide switches to the compact layout: algebra becomes a drawer.
- Fullscreen uses the browser fullscreen API; Esc leaves.

## 2. Menu

A single menu (☰):

- **New** (asks first if unsaved), **Open…** (file picker for `.incantly`, `.inc`, `.json`), **Save** (download `.incantly`), **Save script** (download `.inc`), **Export ▸** (PNG, SVG, PDF, GIF, Print), **Share…**, **Settings…**, **Language**, **Exam mode…** (if the mode offers it), **About**.
- In embeds with `enableFileFeatures: false` the file items are hidden.
- Keyboard: `Ctrl/Cmd+S` save, `Ctrl/Cmd+O` open, `Ctrl/Cmd+P` print, `Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Shift+Z` redo.

Unsaved state: a small dot after the title; `Save` clears it; closing the page with unsaved changes triggers the browser's leave prompt only if the page opted in.

## 3. Save and open

- Save downloads `<title or "figure">.incantly` through a normal download. No account needed.
- Open reads the file locally. The result toast: "Opened 41 lines" or "Opened 41 of 43 lines. 2 could not be used. [Show]". `Show` opens a panel listing each failed line with its error and hint (the same format as a typed error).
- Drag a file onto the frame to open it. Drop of an image file adds an image object at the drop point (asset stored in the file).
- A file from a newer format: a dialog with the message of `file_too_new` and a link to update; the figure is untouched.

## 4. Export dialog

One dialog, tabs for each format. The preview updates live.

```text
Export
 ( PNG ) ( SVG ) ( PDF ) ( GIF ) ( Print )

 Area:   (•) What I see   ( ) Everything
 Size:   [ 1x | 2x | 3x ]   1200 x 800 px   → 2400 x 1600 px
 [ ] Transparent background
 ┌──────────────────────┐
 │   preview            │
 └──────────────────────┘
 Estimated size: 180 KB             [Cancel] [Save]
```

- **PNG:** scale choice, optional transparent background, shows the final pixel size and warns beyond the limit.
- **SVG:** text as text or as outlines; embed fonts option.
- **PDF:** page fit or A4/Letter, margin.
- **GIF:** from and to (pre-filled with the clock range; draggable handles on a mini timeline), frames per second (10, 15, 24), width (400, 600, 800). The dialog shows frames count and an estimate of the size before starting. A progress bar and Cancel run while it renders. The figure keeps working; we render on a copy.
- **Print:** opens the system print dialog with a page preview; checkboxes for including the sheet and algebra list.
- Copy to clipboard: a button on the PNG tab (`Copy image`).

Defaults: PNG 2x, transparent off; GIF 15 fps, 600 px, loop forever; PDF fit.

Colour and accessibility: exports use the figure's current colours. A "High contrast" toggle re-renders with thicker lines and the high-contrast palette for print.

## 5. Share dialog

```text
Share
 Link   [ https://…#f=eJxVj…           ] [Copy]
 [ ] Read-only      [ ] Start at time 0:04
 Embed  [ <iframe src="…" width="600" height="400" …> ] [Copy]
 Size   [ 600 ] x [ 400 ]
 Everything in this link stays in the link. Nothing is sent to a server.
```

- Link is created locally. If the figure is too large the dialog says so and offers Download.
- Read-only default on; turning it off allows learners to edit their own copy (no change to the original).
- The privacy line is always visible.

## 6. Keyboard and screen reader

- The frame has `role="application"` with an accessible name from the title; the top bar is a `toolbar` with arrow-key navigation.
- Dialogs trap focus, restore it on close, and close with Esc.
- Progress of export is announced politely ("Exporting animation, 40 percent").
- Toasts use `role="status"`; errors use `role="alert"`.
- All icon buttons have text labels (visible on hover or focus and in aria).

## 7. Touch

- Menu and dialog targets at least 44 px. Pinch and pan inside the graphics. A long press on empty space opens the "export what I see" shortcut (PNG to share sheet when available).
- On phones the Share button uses the native share sheet when the Web Share API exists, falling back to the dialog.

## 8. Animation

- Dialog opens with a 120 ms fade (none under reduced motion).
- Clock bar scrubber follows `t` at frame rate; scrubbing the bar while exporting is disabled.

## 9. Differences from GeoGebra

- One export dialog with live preview and size estimates (GeoGebra splits export over several menu entries).
- Open reports exactly which lines failed, instead of a silent partial load.
- Sharing does not need an account and sends nothing to a server for the default link.
- Files are text-diffable and carry no scripts.
- GIF range picked on the film's own timeline, with a pre-flight size estimate and cancel.
