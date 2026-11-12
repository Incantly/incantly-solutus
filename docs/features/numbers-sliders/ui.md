# Numbers, angles, sliders, booleans: what the learner sees

## 1. Where controls live

Sliders and checkboxes are drawn by the control layer, an HTML overlay above the canvas (real DOM controls, so keyboard, focus and screen readers work). Two placements:

- **Dock (default).** Controls with no `place` stack in the **control dock**, a column at the top-left of the figure, in creation order. Each control takes one row (a row is about 44 px high). If the column would cover more than 40% of the view's height it wraps into a second column. The dock never overlaps a point the learner is dragging: the dock has `pointer-events` only on its controls.
- **`screen(x, y)`** pins to a pixel offset from a corner (default top-left). **`at(x, y)`** pins to maths coordinates and moves with pan and zoom; if it leaves the view it is clamped to the nearest edge so it cannot be lost.

The reference app pins a slider at an arbitrary point on a first click and has two position modes with several special cases. We default to the dock because the teacher draws by text, not by clicking.

## 2. Slider

```
 r  ──────●────────  2.0        <- name, track, handle, value readout
 ▶                              <- play/pause when the slider has a range
```

Parts:

- **Label** left of the track: the `label` property, or the name (name in italics for single letters, as in maths text).
- **Track**: 180 px by default (`length`), horizontal. A thin line with end ticks. If `step` is a fixed value and the number of steps is 40 or fewer, small tick marks appear at each step. For more steps, ticks appear at nice round values only.
- **Handle**: 20 px circle (hit area 44 px). Filled with the object colour; a ring when focused.
- **Value readout** right of the track: formatted by the number's display (`digits`, `sig`, unit). Fixed width so the track does not jump while dragging.
- **Play button** (▶ / ⏸) at the left, shown when the slider has a range. Press toggles `Animate`. A slider with `loop = once` shows ↻ when finished.
- **Vertical** (`vertical = true`): track runs bottom (min) to top (max); label above; readout below.
- **Undefined** (range undefined): the slider is greyed and shows "–"; hidden unless `show undefined` is on in settings. (Default: greyed, so the learner sees something is off.)

### Drag

- Press the handle or anywhere on the track: the handle jumps to the pointer and drags.
- While dragging the handle follows the pointer exactly (no step snapping on screen); the **value** snaps to the step, and a small ghost mark shows the snapped position. With `step = auto` no ghost mark. This keeps the drag smooth while the number is exact.
- Shift: fine mode (10× slower). Alt/Option: coarse mode (snap to 10 steps).
- Release: one undo entry for the whole gesture.
- Dragging an animating slider pauses its animation; on release it resumes if `resume` is true (default).
- Pointer capture is kept even if the pointer leaves the control.

### Typing

Double-click (or press Enter when the handle is focused) opens an inline number field over the readout. The field accepts expressions of pure numbers and constants (`pi/4`, `30deg`, `2*3`); names of other objects are accepted, but the result is frozen to a number (no dependency is created). Enter commits, Esc cancels. Errors show beneath the field in plain words from the error `message`; the slider is unchanged.

### Keyboard (handle focused)

| Key | Action |
|---|---|
| Left / Down | value minus one step (auto step: minus 1 percent of range) |
| Right / Up | value plus one step |
| PageDown / PageUp | minus / plus 10 steps |
| Home / End | minimum / maximum |
| Enter | edit value |
| Space | play/pause animation (if animatable) |
| Shift+arrow | fine step (one tenth of a step if the step allows) |

Key repeat is allowed; each press is one commit; the undo log coalesces presses within 500 ms.

### Screen reader

The slider is a native `input type="range"`-equivalent with `role="slider"`:

- `aria-label`: label or name.
- `aria-valuemin`, `aria-valuemax`, `aria-valuenow` in display-unit numbers.
- `aria-valuetext`: the formatted text with the unit ("30 degrees", "2.5").
- `aria-orientation` set for vertical.
- Announcements while dragging are throttled to every 250 ms; the final value is announced on release. Animation does not announce every frame; the play button announces "playing" and "paused", and the value is announced on request (Ctrl+Alt+V) or when focus returns.

### Touch

Handle hit area 44 px; the whole track is a hit area; a drag that starts on the track moves the handle with a slight offset smoothing so the finger does not hide the handle (the readout floats 40 px above the finger during touch drags). No double-tap to edit; a long press (400 ms) opens the number field.

### Colours and style defaults

- Colour from the object's colour (palette cycles per object so two sliders differ).
- Track: 3 px, colour at 40% opacity. Filled part from min to handle: full colour, in angle sliders as well.
- Readout: tabular figures; grey while undefined.
- Dark mode and high-contrast: track and handle meet 3:1 contrast against the background; focus ring 2 px with 3:1 contrast.
- Angle slider: the readout shows `°` with no space; a tiny angle glyph before the label.

### Angle slider extra

The canvas draws nothing for the slider itself. If the author also draws the angle (`Angle(...)`), the slider's handle can be linked to a drawn arc by the author's rules. No automatic arc.

## 3. Animation

- Play button on the slider starts and stops. A tooltip shows the mode and period ("bounce, 8 s").
- A film's own play controls (core design) are separate: they move `t`. When the film is paused, animated sliders hold their value (their value depends on `t`). When the user presses ▶ on a slider with no film loaded, the free-play clock starts and runs only while something animates.
- With `prefers-reduced-motion`, slider animations do not start by themselves (an `Animate` line is held until the learner presses play); the teacher's `draw` result says `held: reduced_motion`.
- Speed changes: a small menu on the play button offers 0.5x, 1x, 2x (these change `period` by factor). Typing `period` in a line also works.
- **Frame rate:** the screen drives `t` with `requestAnimationFrame`; sliders computed once per frame. No timer.

## 4. Checkbox

```
 [✓] Show tangent
```

- 20 px square box + label to its right; 44 px hit height. Click, tap or Space toggles.
- `role="checkbox"`, `aria-checked`, label as accessible name. The label text reads from `label` or the name.
- A change is applied at once; the figure redraws in the same frame. One undo entry per toggle.
- An undefined Bool shows a dash in the box, `aria-checked="mixed"`, disabled.
- Colour: object colour for the check mark and border; focus ring as for sliders.
- Tests (dependent Bools) are not drawn as controls. To display one, use `Readout("big", big)` which shows true/false as a text.

## 5. Number readouts

A free Number with no range is not a control. It appears in the side panel and in `Readout`. A number with a label can be drawn on the canvas as text via `Text`. Double-clicking a free number's readout opens the same inline field as the slider to type a value.

## 6. Rounding controls

The per-object menu (right-click, long-press, or the object list) offers: decimals 0 to 15, significant figures 1 to 15, auto, trim zeros, unit. Each choice writes the matching `with` line (the figure's script stays the single record). A figure-level setting writes `@digits` or `@sig`.

## 7. Differences from the reference app

| The reference app | Ours |
|---|---|
| Slider placed where you click; two coordinate modes | Dock by default; explicit `place` |
| Slider appears automatically for free numbers | Only when the line has a range |
| Animation play button is a global corner button (and per slider via a menu) | Per-slider play button; no global button |
| Slider value snaps while dragging, with visible jumps | Handle follows the pointer; value snaps; ghost mark |
| Arrow keys on a selected slider | Full slider keyboard model with page, home and end |
| Checkbox is a separate object that you drag to place | Checkbox is a free Bool in the dock |
| Screen reader text built separately | Native roles, same string as the readout |

## 8. ASCII layout of the control dock

```
┌─ figure ───────────────────────────────────────────────┐
│ ▶ r   ──────●────────  2.0                             │
│ ▶ θ   ────●──────────  40°                             │
│ [✓] Show height                                        │
│                                                        │
│            (canvas content)                            │
└────────────────────────────────────────────────────────┘
```
