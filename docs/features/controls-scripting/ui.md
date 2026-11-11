# Controls and scripting: what the learner sees

Controls are real DOM elements in the control layer above the canvas, shared with sliders and checkboxes (`docs/features/numbers-sliders/ui.md`): same dock, same `place` options (`dock`, `screen(x, y)`, `at(x, y)`), same focus ring and colour rules. This file covers buttons, dropdowns, input boxes, clickable objects and how a handler run looks.

## 1. Button

```
 ┌───────────┐
 │  Reset    │
 └───────────┘
```

- Height 40 px, minimum width 80 px, padding 16 px, label centred. The dock row height is 44 px.
- Filled with the object colour (default: neutral grey-blue); text colour chosen for 4.5:1 contrast. Hover raises the fill by one step; pressed shifts it by one pixel and darkens; disabled is 40% opacity.
- `role="button"` (a native `button`), accessible name = label. Click, tap, Enter or Space triggers `click`.
- Press feedback: 120 ms scale to 0.97 and back. Respect `prefers-reduced-motion` (no scale).
- A button whose handler is running shows nothing special; runs take under a millisecond. If a run is aborted (limit), a small "!" badge appears on the button for 3 seconds with the tooltip "Something went wrong; nothing was changed."
- Long labels wrap to two lines then truncate with an ellipsis and a tooltip.

The reference app's button is freely placed with size set in pixels; ours sits in the dock by default and can be pinned with `place`.

## 2. Dropdown (choice)

Collapsed:

```
 Function  [ sin(x)        ▾ ]
```

Open:

```
 Function  [ sin(x)        ▾ ]
           ┌─────────────────┐
           │ ✓ sin(x)        │
           │   cos(x)        │
           │   tan(x)        │
           └─────────────────┘
```

- A native `select` styled to match, so touch devices get the platform picker and screen readers get correct semantics. For more than 8 options the list scrolls (max height 40% of the view).
- Option text: `captions` if present, else the formatted value. Colour options draw a small swatch before the name. Function options show the definition (`sin(x)`); long text is ellipsised with the full text as a tooltip.
- Keyboard: Up/Down move through the options when closed (changes the choice immediately, as native selects do on some platforms; we change on commit: Enter or close on desktop); typing a letter jumps to the next option starting with it; Home/End first/last.
- Selection raises `change` (once per selection).
- Empty choice: disabled, shows a dash, tooltip "No options".
- Screen reader: native `select` role; label = the object's label or name.

The reference app draws the dropdown inside the canvas, with its own hit testing and no native behaviour. Ours uses native controls.

## 3. Input box

```
 r =  [ 2.5            ]
```

With an error:

```
 r =  [ 2.5 +          ]
      ⚠ Expected a number after '+'.
```

With a notice:

```
 r =  [ 5              ]
      ⓘ Set to 5, the top of the range.
```

- Caption left, field right; field width from `width` (characters, default 8) with a minimum of 6.
- Text uses a monospaced numeric style (tabular). Placeholder is the current value (when idle the field *shows* the value).
- Enter commits. Blur commits. Esc restores the target's text. On touch, a small "✓" appears at the right of the focused field.
- The error line appears under the field in the error colour with an icon (not colour alone). Message = the error object's `message`, position highlighted in the field (an underline from `col` to `endCol`).
- While typing, the field never changes the figure; commit does. If the box is bound to a function (`Input(f, "f(x) =")`), the prefix `f(x) =` is non-editable text.
- Special keys for numbers: `^` on a Mac/Windows keyboard works; Alt+P inserts π; Alt+O inserts `°` (deg) when the target has a degree unit. An on-screen small row of symbols (π, √, ^, °) appears on touch while the field has focus.
- `aria-invalid="true"` and `aria-describedby` pointing to the error line when invalid; `aria-live="polite"` on the notice line.
- Autocomplete is off. Spellcheck off.
- Pasted text longer than 500 characters is cut with a notice.

The reference app's input box turns the target undefined on an error. Ours leaves the target alone and shows the error.

## 4. Clickable objects

An object with `with clickable = true` shows a pointer cursor on hover and has `role="button"` in the hidden object list. Click or tap raises `click`. Hit testing follows the core order (labels, points, edges, fills). A clickable object with no handler does nothing and the hover cursor is not changed.

## 5. Handler runs from the learner's side

- A handler run is one redraw and one undo entry. Undo (Ctrl+Z, or the figure's undo button) reverts everything the press did. The undo entry label reads "Reset" (the button's label) or "Change r".
- If a handler calls `Highlight`, the object pulses for the given seconds (an outline expanding twice).
- The learner never sees script text. A teacher or author sees handlers in the **Controls panel** (author mode): per control a list of events and steps, each step editable as a line (the same text as the script), with a check mark or the error message. Adding or editing a step applies the `on` line. Disabled in learner mode.

### Author mode panel

```
 go (Button "Reset")
   click
     1  SetValue(a, 3)         ✓
     2  Hide(T)                ✓
     + add step
 a (slider)
   change
     1  [if a > 5] Show(warn)  ✓
```

Each row has Edit, Up, Down, Delete. Typing a step runs the same check as `draw` and shows the error object's message inline.

## 6. Keyboard order and focus

Tab order: dock controls in creation order, then the canvas (objects list), then side panel. A focused control shows the 2 px ring. Arrow keys inside the canvas move points as in the core design; they do not move controls.

## 7. Touch

Hit areas at least 44 px. Dropdowns open the native picker. Input boxes raise the soft keyboard; the dock scrolls so the focused field is above the keyboard. Long-press on a button does nothing (no hidden menus).

## 8. Colours and style defaults

| Element | Default |
|---|---|
| Button | Object colour; neutral by default |
| Dropdown | Border 1 px at 60% of text colour; background transparent |
| Input | Border 1 px; invalid border in error colour; notice in info colour |
| Error text | Error colour with an icon, 14 px |
| Disabled | 40% opacity, `aria-disabled` |
| Focus ring | 2 px, 3:1 contrast |

Dark mode and high-contrast follow the page theme; no colours are hard-coded.

## 9. What changes from the reference app

| The reference app | Ours |
|---|---|
| Button, dropdown and input drawn on the canvas | Real DOM controls |
| Scripts edited in a dialog in the object properties | Controls panel with lines and inline checks |
| Script errors in a dialog, often at run time | Inline messages at definition time; run records for the author |
| Input error leaves the object undefined | Error shown in the box; object unchanged |
| Separate scripting tabs for click, update, change, drag end | One handler per event with ordered steps; no update script |
| No undo for a script run as a unit | One undo per run |
