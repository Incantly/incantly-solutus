# Graphics view: what the learner sees and does

## 1. Layout

```text
+----------------------------------------------------------------------+
| [Tools ▾]  (tool strip, see tools-2d/ui.md)            [↶ ↷]  [⚙]    |
+----------------------------------------------------------------------+
|                                                                      |
|          y                                                           |
|          ^                                                           |
|        3 +  .  .  .  .  .  .  .  .  .                  [style bar]   |
|        2 +  .  .  . P●  .  .  .  .  .                                |
|        1 +  .  . /  .  .  .  .  .  .                                |
|   ---+---+--+--+--+--+--+--+--+--> x                                 |
|  -2 -1  0  1  2  3  4  5                                             |
|                                                    [⌂] [+] [−] [⛶]  |
+----------------------------------------------------------------------+
| ▶  ━━━━━━●━━━━━━━━━━  0:12 / 0:30   1x ▾   ⟲        (player bar)     |
+----------------------------------------------------------------------+
```

- Top: the tool strip (own doc), undo/redo, settings.
- Right (appears on selection or on the cog): the **style bar**.
- Bottom-right of the canvas: home, zoom in, zoom out, fit-to-objects.
- Bottom: the player bar from `../animation-time/ui.md`.
- The canvas fills the rest. On narrow screens the style bar becomes a bottom sheet.

## 2. Controls

### View buttons (bottom right of the canvas)

| Button | Does |
|---|---|
| ⌂ Home | Returns to the author's `@view` (tween 0.35 s) |
| + / − | Zoom 1.5x about the centre |
| ⛶ Fit | Shows all visible objects with 8% margin, equal ratio |

### Style bar (selection-driven)

Shows controls that apply to everything selected, with a mixed state when values differ:

```text
Colour ▪▪▪▪▪▪▪▪ …   Opacity ───●──   Width ──●───   Dash ▾   
Points: shape ▾  size ──●──    Fill ───●──   Hatch ▾   Label ▾   Layer ▾   [Fixed] [Hide] [Trace]
```

- Nothing selected: the bar shows view options: axes on/off, grid kind, snap mode, ratio lock, background.
- Colour opens a palette of 12 swatches (named below) and a custom hex field.
- All controls make `with` lines in a batch (one undo step). The script view shows the lines that were written; this teaches the language.

### Properties panel (cog)

Name, caption, label mode, dash phase, show-if expression, layer, alt text, advanced hatch. Fields that take a number accept a formula with the same checks as a script line; an error appears below the field using the error `message` and `hint`.

## 3. Pointer behaviour

| Action | Result |
|---|---|
| Hover an object | Halo (mouse only), cursor changes: `grab` for draggable, `pointer` for clickable, `default` otherwise, tooltip after 600 ms: name, value |
| Click | Select (topmost hit); repeated click at the same place cycles hits and the tooltip says `2 of 3: a` |
| Shift/Ctrl+click | Add or remove from selection |
| Drag a free point | The point follows the pointer; a faint ghost shows the start position; coordinates appear beside the pointer |
| Drag a point on a path | The point slides on the path; it never leaves it |
| Drag a shape | Moves its free points (cursor `move`) |
| Drag a slider thumb | Moves along the track; the value shows in a bubble |
| Drag a label | Moves the label; a leader line appears when the label is more than 20 px from its object |
| Drag the background | Pans |
| Wheel or pinch | Zooms about the pointer |
| Double-click an object | Opens its properties; double-click a label edits the caption |
| Right-click / long-press | Context menu: Show/hide, Label, Colour, Layer, Trace, Properties, Delete |

When the pointer is down on a non-draggable object, the first time per session a tooltip says why and which free parents can move; clicking the tooltip selects them.

### Touch

- Targets are padded to at least 24 CSS px (points 24, lines 12 px each side of the line).
- One finger drags objects or pans, two fingers pan and zoom.
- A long press (500 ms) opens the context menu.
- The learner sees the finger-offset marker: while dragging a point with a finger, the point is drawn 28 px above the touch so the finger doesn't hide it, and the offset is removed at release. This is optional and can be turned off.

### Snapping feel

- Grid snap shows a small + at the snap target.
- Point snap draws a ring around the target and a pill label "on B".
- Hold Alt/Option (or two-finger tap on touch) to turn snapping off for this drag.
- Shift limits angles to 15 degrees about the anchor point.

## 4. Keyboard

| Key | Action |
|---|---|
| Tab / Shift+Tab | Enter and leave the figure |
| ← → | Next / previous object in creation order (focus) |
| Enter / Space | Select the focused object |
| Arrows (object selected) | Move a free point by a nudge; shift ×10, alt ×0.1. Slider: step |
| Ctrl+arrows | Pan the view |
| + / − | Zoom about the centre |
| 0 or Home | View home |
| Delete | Delete the selection |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Esc | Cancel drag, deselect, cancel the current tool |
| Ctrl+A | Select all |
| F2 | Rename selected object |
| Ctrl+C / Ctrl+V | Copy / paste selection: pasting adds a copy of the definitions of the selected objects and everything they depend on (with the non-selected ones hidden) |

The focus ring is a 3 px high-contrast outline on the overlay canvas, plus the hidden list item gets focus, so the screen reader speaks the description.

## 5. Screen-reader text

See `design.md` section 15 for the text templates. In the UI:

- The figure region announces: "Figure, 12 objects. Press Tab to explore."
- Entering the figure: "Point A at 1.5, 2. Free. 1 of 12."
- After a drag ends: "A moved to 2, 3."
- When the teacher draws a new object: queued announcements "Added circle c, radius 3" are spoken after the teacher's sentence finishes, unless the user turned off announcements in settings.

## 6. Default look

Colours (sRGB). Strokes meet 3:1 contrast on the light background; the dark theme uses the lighter variants.

| Role | Light theme | Dark theme |
|---|---|---|
| Background | `#ffffff` | `#14161a` |
| Grid major | `#d6dae0` (1 px) | `#3a3f47` |
| Grid minor | `#eceff3` (1 px) | `#272b31` |
| Axes | `#4a5260` (1.5 px) | `#aab3c0` |
| Free point | `#1a5fd1` | `#6aa3ff` |
| Dependent point | `#4a4f57` | `#b8bec8` |
| Point on path | `#7a3fd1` | `#b48cff` |
| Line, segment, vector, circle (default) | `#222831` 2 px | `#e6e9ee` |
| Polygon | stroke `#222831`, fill `#1a5fd1` at 0.15 | |
| Function | `#c4361f` 2.5 px | `#ff7b63` |
| Angle | `#2e8b57` fill 0.25 | |
| Selection halo | `#ffb000` 6 px at 0.5 | |
| Hover halo | `#1a5fd1` 5 px at 0.35 | |
| Focus ring | `#000000` 3 px with 1 px white inner edge | `#ffffff` |

Named colours in scripts map to the following: `red #d03a2a`, `orange #e8820c`, `green #1f8a4c`, `blue #1a5fd1`, `purple #7a3fd1`, `teal #0f8f9a`, `pink #d6458f`, `brown #8a5a2b`, `grey #7b8491`, `black #111111`, `white #ffffff`. `light` and `dark` forms shift lightness by ±20 in hsl.

Sizes: point radius 4 (hit slack extra), line width 2, function width 2.5, axis width 1.5, label font 14 px (system UI sans, tabular digits), label offset 6 px.

Free points have a 2 px ring halo in a lighter tint. That gives a non-colour cue for "you can move this".

High-contrast theme: black on white, all strokes 3 px, points 6, no opacity below 0.4, patterns required for fills.

Colour-blind-safe palette (used when the theme asks): blue `#0072b2`, orange `#e69f00`, green `#009e73`, vermilion `#d55e00`, purple `#cc79a7`, sky `#56b4e9`, yellow `#f0e442`, black.

## 7. Animation in the view

- View tweens 0.35 s with `smooth`. With reduced motion: instant.
- New objects fade in over 150 ms (fill and stroke opacity 0 to target) when the teacher draws them, so the learner notices them; this effect is skipped while seeking and while loading a figure. A new object that appears off-screen gets no fade (the warning is spoken instead).
- `Highlight(obj, s)` pulses a halo at 2 Hz for `s` seconds. Reduced motion: a steady halo.
- Dragging has no easing: the point is at the pointer.

## 8. How the reference app presents it, and what we change

| The reference app | Ours |
|---|---|
| Style bar at the top of the view with a handful of icons; most style options in a properties dialog with many tabs | One style bar that follows the selection, plus a short properties panel; every control is also a script line |
| Algebra view shows definitions beside the canvas | Script/lines panel (shown on request) shows the lines written, including by tools and drags |
| Layers hidden in a dialog | Layer dropdown in the style bar |
| Hit cycling not available | Click again to cycle, with a tooltip |
| Top hit only | Hint when the pointer hits several things |
| Coordinates of pointer in a status area | Optional readout near the pointer during a drag |
| Reset view button | Home plus Fit |
| Export via menu to files | Export menu in the cog: PNG at 1x/2x/3x, SVG, copy as image, copy script |

## 9. Export dialog

```text
Export figure
  Format   (•) PNG   ( ) SVG   ( ) Script
  Area     (•) What I see   ( ) All objects   ( ) Custom…
  Size     1200 px wide      Scale ▾ 2x
  Background  (•) Same  ( ) Transparent  ( ) Colour ▪
  [✓] Grid  [✓] Axes   [ ] Widgets
  At time  [now ▾]  (when the figure moves)
  [ Copy ]  [ Save… ]
```

The dialog shows a live preview that is the same drawing code at preview size. Errors (`export_too_large`) appear below the size field.
