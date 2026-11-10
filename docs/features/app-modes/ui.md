# App modes, exam, settings, languages, keyboard: what the learner sees

## 1. Starting point

On the start screen a learner (outside a lesson film) chooses an app. Each is a tile with a one-line purpose:

```text
 [ Graphing ]  [ Geometry ]  [ Scientific ]  [ Probability ]  [ Notes ]  [ Classic ]
   draw         build and      calculate       explore         write      everything
   functions    measure        with keys       chance          and draw
```

Tiles for modes not built yet are hidden (not greyed), so the screen never promises what is missing. A lesson film opens the `figure` mode directly with no tile choice.

## 2. Layout per mode

### Graphing

```text
+-----------------------------------------------+
| ☰  Untitled                    ↶ ↷  ⚙  ⤢     |
+--------------------+--------------------------+
| 1  f(x) = x²       |                          |
|    ● ─────────── ○ |        graphics          |
| 2  a = 1  ●──○ 5   |                          |
| 3  [ input…     ]  |                      + - ⌂|
| (chips: Create slider a)                      |
+--------------------+--------------------------+
|  on-screen keyboard (touch, when input focused)|
+-----------------------------------------------+
```

- Algebra on the left (a third of the width), graphics on the right. Input is the last row of the list. Each row has a colour dot (tap to hide), the definition, and its value.
- Suggestion chips under a row (special points, solve) appear for functions.

### Geometry

Toolbar along the top or left (touch: bottom), graphics fills the rest. No algebra by default; the menu can show it. A one-line hint under the toolbar tells the current tool's next step ("Click a second point").

```text
+-----------------------------------------------+
| ☰ Untitled                ↶ ↷          ⚙   ⤢  |
| [↖][•][/][⬡][○][∠][⟲]  hint: Select two points |
+-----------------------------------------------+
|                    graphics                   |
+-----------------------------------------------+
```

### Scientific

One column of rows; each row has the typed expression on the left and the result on the right.

```text
+--------------------------------+
|  3/5 + 1/4            17/20    |
|                      = 0.85    |
|  Ans × 2                17/10  |
|  [ input…            ]         |
+--------------------------------+
|  keyboard (always shown)       |
+--------------------------------+
```

- Result toggle `S↔D`: exact fraction or decimal. Degree/radian indicator in the corner (tap to switch).
- Tap a previous row to copy its expression or result into the input. `Ans` inserts the last result.

### Probability

Distribution picker (Normal, Binomial, Poisson, and others as supported), parameter fields, the graph with shaded interval, `P(a ≤ X ≤ b)` fields, and a summary table (mean, standard deviation, median) beside it.

### Notes

A page board: toolbox (pen, shapes, text, image, graph), page strip, undo/redo. Graph objects open the `graphing` mode in a panel.

### Classic

Menu bar, toolbar, algebra, graphics, optional sheet, input bar at the bottom, perspectives menu (choose which views). Same controls as the embed design's frame, with everything on.

### Figure (live teacher)

Graphics and the clock bar only. No menu, no input. Learner can pan, zoom and drag free points.

## 3. The mode switcher

☰ → **App** shows the tiles in a list. Switching shows a dialog only when objects would be lost:

```text
Switch to Scientific?
12 objects can't be used there and will be removed:
  f, g, A, B, ... [show all]
 [Keep this app]   [Switch and remove]  [Save first…]
```

Undo brings it back.

## 4. Settings panel

⚙ opens a side sheet with groups as tabs; only settings the mode offers appear. Changes apply immediately; there is no OK button; each setting has a reset arrow when it differs from the default; each group has "Reset group".

```text
Settings                    ✕
 General | Graphics | Algebra | Language | Accessibility
 Angle unit      (•) radians  ( ) degrees
 Rounding        [ 2 ▾ ] decimal places  ( ) significant digits
 Coordinates     (•) (x, y)   ( ) (r; θ)
 Undo steps      [ 200 ]
```

Locked settings (in an exam) show a padlock and a one-line reason.

Defaults for look: line width 3, point size 5, label size 16 px, colour palette of eight distinguishable hues that stay apart for common colour-vision differences, dark and light themes follow the OS with a switch.

## 5. Exam mode

### Entry

☰ → **Exam mode…** (only if the host enables it). A sheet explains in plain words what changes:

```text
Start exam mode?
During the exam:
 • Some tools are turned off (derivatives, integrals)
 • Sharing, saving and opening files are off
 • Leaving this window is noted and shown to your teacher
 • The app can't stop you leaving. It only records it.
 Duration 60 min     [Cancel]   [Go full screen and start]
```

### During

A coloured banner across the top, always visible, with text:

```text
 EXAM MODE · 42:10 left · tools limited                       [ Finish ]
```

It never uses colour alone (text plus an icon). Blocked actions show an inline message at the place of the action, not a modal: "Not available in this exam" with a "Why?" link that expands the list of what is off.

If the window loses focus or fullscreen ends: an overlay when the learner returns: "You left the exam window at 12:03 for 14 s. This was recorded." with a Continue button.

### Finish

```text
Exam finished
 Time used      58 min 12 s
 Left the window   2 times   (total 31 s)
 Blocked actions   Derivative ×2
 [ Save report ]  [ Save my work ]  [ Close ]
```

Save report downloads the `ExamSummary` JSON. Close restores the learner's normal settings and, per the host option, their earlier figure.

## 6. Languages

- Language picker in Settings → Language and in the first-run sheet. Native names (Deutsch, Français, العربية), sorted by native name.
- Switching re-renders at once; typed lines in input fields stay (commands remain English).
- Right-to-left locales mirror the app layout (panes swap sides, toolbars flip), but numbers, formulas and the graph stay left-to-right. Arrow glyphs and chevrons mirror.
- Number display: a decimal comma in locales that use it; the input field shows a one-line reminder if a comma was typed where a point is needed ("Use a point: 2.5").
- A small badge shows when commands are English-only ("Commands are in English") with a link to the command list.

## 7. The on-screen keyboard

### Behaviour

- Appears when a maths field is focused on touch devices with no physical keyboard (`auto`). A keyboard button next to the input toggles it on any device.
- Docked at the bottom, at most 36% of viewport height, the figure area shrinks to remain visible. A handle lets the learner drag it down to hide. Detached option: floats at the bottom of the page.
- Haptics on supported devices; key press shows an enlarged key bubble on touch.

### Layouts (sketch)

Standard, tab `123`:

```text
 [123] f(x)  ABC  αβγ                         [⌫]
  7   8   9   ÷   (   )   x   y   z
  4   5   6   ×   <   >   x²  xⁿ  √
  1   2   3   −   ≤   ≥   π   e   |a|
  0   .   ,   +   =   ←  →   ⏎ 
```

Scientific:

```text
 shift  deg  S↔D  Ans   ⌫   AC
  sin   cos  tan  ln   log   √
  x²    xⁿ   a/b  ( )  π     e
  7     8    9    ÷    ×
  4     5    6    +    −
  1     2    3    EXP  Ans
  0     .    (−)  =
```

- Second functions via shift (sin → sin⁻¹). Active shift shows a highlighted key and a label "2nd".
- Long press on `x²` shows `x³`, `x⁻¹`; on `.` shows `,`; on `π` shows `τ`, `e`.
- Colours: digits white on dark grey; operators blue; actions (⌫, AC) red-tinted; the `=`/enter key primary colour. All pairs 4.5:1 or better.
- The editor shows structure: fractions stack, powers raise, roots draw their bar; the cursor moves into and out of structures with arrows.

### Physical keyboard

- Typing `/` after a number creates a fraction and moves into the denominator; `Right` leaves it. `^` raises the exponent. `sqrt(` converts to a root. `pi`, `theta`, `alpha` convert to symbols.
- `Enter` runs the line. `Shift+Enter` adds a new line in multi-line fields. `Esc` clears the current edit. `Tab` accepts autocomplete. `Ctrl/Cmd+K` focuses the input from anywhere.
- All shortcuts are listed in Settings → Keyboard shortcuts, and in the `?` overlay.

## 8. Accessibility

- Every key has a spoken label ("square root", "fraction", "times"). Keys are buttons in reading order; arrow keys move between them.
- The editor exposes the expression as text for screen readers, e.g. "fraction, numerator 3, denominator 5, end fraction plus one fourth".
- Mode and exam state announced with `role="status"`; the exam banner is `role="region"` with an accessible name.
- Reduced motion: no panel slide, no key bubble animation; focus rings stay.
- Text scale applies to keyboard keys too (minimum key size 44 px on touch even at 80%).

## 9. Touch

- Algebra rows swipe left for delete; long press for the context menu.
- Toolbar: 44 px targets; the active tool is outlined and named in the hint line.
- Mode tiles are large (96 px tall).
- Two-finger tap undoes; three-finger tap redoes (setting, off by default).

## 10. Animation

- Panel open/close 160 ms ease-out; view switch crossfade 120 ms; exam banner slides in 200 ms (instant under reduced motion).
- Keyboard slide 180 ms.
- No animation tied to correctness (nothing flashes right or wrong).

## 11. Differences from GeoGebra

- The start screen hides apps that don't exist yet.
- A switch dialog that lists what would be lost, with undo.
- Settings apply live, with per-setting reset, and mark locked ones with reason.
- Exam: plain-language rules before starting, an honest "records, does not prevent" note, banner with text, inline blocks, a downloadable report.
- RTL layout with left-to-right maths.
- A keyboard with spoken key names and a scientific page that stays one page.
