# TipTap extension: UI

## Reading

```text
┌──────────────────────────────────────────────┐
│                                              │
│              (live figure)                   │
│                                              │
│  ▶ 0:04 ───●──────────────  🔊   ⤢          │  ← only when the figure has a clock, sound or can go full screen
└──────────────────────────────────────────────┘
  Caption text
```

- Placeholder: the saved picture at the exact size, so the page never jumps when a figure goes live.
- A figure with a clock shows play, time and a scrubber. Sound shows a speaker toggle, off by default.
- Full screen opens the figure in the studio's full view, keeping its state.
- Keyboard: Tab moves into the figure; inside, the figure's own keyboard rules apply (`docs/features/graphics-view/ui.md`); Escape returns to the document.
- Screen readers: the figure's caption, then the hidden object list the view provides.

## Writing

- Slash menu: "Incantly figure", "Incantly graph", "Incantly 3D", "Ask AI for a figure".
- When selected, a small toolbar floats above: Edit lines, AI, Mode, Size, Caption, Delete.
- Edit lines opens a code panel under the figure:

```text
1  f(x) = x^2 - 2x - 3            ✓ Function
2  r1 = Root(f, -5, 1)            ✓ (-1, 0)
3  r2 = Roots(f)                  ✗ unknown command. Did you mean Root?
```

- Drag the bottom edge to change height. Width follows the column, or "full width".
- The AI box sits under the toolbar: one text field and a send button. While the model writes, lines appear in the code panel and the figure fills in.

## Defaults

- Height 360 px, full column width.
- Mode `figure`: no toolbar of tools, no algebra view, pan and zoom on.
- Sound off until the reader turns it on.
