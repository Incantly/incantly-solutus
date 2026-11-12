# Animation and time: what the learner sees and does

## 1. The player bar

One bar controls the clock for the whole figure. It sits below the canvas.

```text
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ [▶]  [⏮][⏭]  ━━━●━━━┿━━━━━┿━━━━━━━━━━  0:12.4 / 0:30   [1× ▾] [⟲] [⌫ trails] │
 └──────────────────────────────────────────────────────────────────────────┘
        beat jumps      beat ticks                 time     speed loop clear
```

| Control | Behaviour |
|---|---|
| ▶ / ⏸ | Play and pause. Space also toggles when the figure or the bar has focus. At the end, ▶ restarts from 0 (or from the loop start). |
| ⏮ ⏭ | Previous and next beat start (`seek_beat`). Hold Shift: previous and next frame (1/60 s). |
| Scrubber | Drag to seek. The figure updates as you drag (seeks are cheap). Beat boundaries are ticks; hovering shows the beat title. When no `@clock` is set the bar shows only the time and no scrubber track. |
| Time | `m:ss.s`. Click to type a time. |
| Speed | Menu: 0.25×, 0.5×, 1×, 1.5×, 2×, 4×, and −1× (reverse). |
| ⟲ Loop | Off, whole film, or between two markers on the scrubber (drag the markers). |
| ⌫ trails | Clears all traces (`ClearTrace` for each). Hidden if there are none. |

When nothing in the figure depends on time, the bar is hidden (no ▶ with nothing to do) unless the author set `@clock`.

### Keyboard

| Key | Action |
|---|---|
| Space | Play or pause |
| ← / → | Back / forward 1 second (Shift: 1 frame, Alt: 10 seconds) |
| `[` / `]` | Previous / next beat |
| `<` / `>` | Slower / faster |
| `L` | Toggle loop |
| `Home` / `End` | Start / end |

### Screen reader

- The bar is `role="toolbar"`. The scrubber is a `role="slider"` with `aria-valuetext="12.4 of 30 seconds, beat 3: Gravity"`.
- State changes are announced: "Playing", "Paused at 12.4 seconds". The live region is polite and rate-limited.
- Time updates while playing are **not** announced every frame. The learner can ask: pressing `T` reads the current time and beat.
- A "Describe motion" action (`D`) speaks a short summary from the figure: "Bob swings between −0.56 and 0.56. Period 2.0 seconds." The text is generated from the `figure` data (values at four sample times), not by the model.

### Touch

- Large 44 px play button; the scrubber has a 24 px thumb with a wide hit area.
- Two-finger tap on the canvas toggles play.
- Long-press on the speed button opens the speed list.

## 2. Slider animation in the figure

```text
  a  ●━━━━━━━━━━━━━━━━○──────────  4.2   [▶ 8 s ⇔]
```

Every slider that can animate shows a small control to its right:

| Part | Meaning |
|---|---|
| ▶ / ⏸ | Turns `animate` on (`bounce` by default) or off for this slider only |
| `8 s` | `seconds`; click to edit (menu 2, 4, 8, 16, 32, custom) |
| ⇔ / → / ← / ⇥ | Mode: bounce, loop, loop-down, once (click to cycle) |

Behaviour:

- Turning a slider's animation on does not start the clock. The slider moves when the player runs. A hint "Press play" shows once if the player is stopped.
- Dragging an animated slider: its animation pauses under the pointer and resumes from the dragged value on release.
- If the film clock is paused, an animated slider's controls still work; its value is a function of `t`, so nothing moves.
- The slider's tooltip shows "animating, 8 s, bounce".
- Keyboard: Space on a focused slider toggles its animation; arrows change its value by `step`.
- Points on paths show the same small control next to their label while selected.

Defaults: the animate-on mode is `bounce`; `once` shows a "replay" icon at the end.

## 3. Traces

- A point with trace on leaves a trail in its own colour, fading if `traceFade`.
- Context menu: Trace on/off, Clear trace, Trace window (Forever, 10 s, 5 s, 2 s, 1 s).
- The trail is drawn under the object and keeps its shape when the learner zooms or pans.
- While dragging (a drag trace), a thin trail follows the pointer's effect on the point. It disappears with Clear trace or undo.
- Scrubbing backward trims the trail to the new time; scrubbing forward fills it in.

Default look: width half the object's; 4 px-radius dots disabled, line only; colour `object colour` at 70%; fade from 1 to 0.05.

## 4. Particles

- Particle systems are drawn over or under other objects by layer. They have no selection halo.
- If the device is slow, the quality drops; a small chip near the bar reads "Particles: reduced" with a tooltip ("Showing 60% of 20,000 to keep the animation smooth"). Clicking toggles `High quality` (renders all, may stutter) for the session.
- With reduced motion on, particle systems show one still frame and a "Play to see motion" hint.
- No sound.

## 5. States (simulations)

- A pendulum, spring or orbit shows no special control. Its inputs are ordinary sliders.
- When a slider that feeds a simulation is dragged, two small chips appear on the player bar while the pointer is down: "From now on" (default, `continue`) and "Replay from start" (`restart`). Letting go keeps the one chosen. The default follows the slider's `rerun` property.
- If the solver blows up (`unstable_state`), a banner appears over the canvas: "The simulation became unstable at 4.2 s. Try less stiffness or more damping." with a Fix button that writes `@solver step 1/960` (a line shown in the lines panel). Seeking before 4.2 s shows valid values.
- If a replay takes longer than one frame, "Catching up" appears next to the time.

## 6. How the reference app presents it, and what we change

| The reference app | Ours |
|---|---|
| A play/pause button in a corner of the view when something animates; a separate speed setting per object in a properties dialog | One player bar with a speed menu; per-slider mini controls next to the slider |
| Animation speed as a number where 1 means about 10 seconds | `seconds` for one pass, in the control and in the script |
| No scrubber, no reverse, no seek | Scrubber, reverse, frame step, beat ticks, loop markers |
| Trace via a context menu; trail lives in the bitmap and is lost on view changes | Trace via context menu or script; a vector trail that survives zoom and pan, seeks and exports |
| Physics via sliders and lists | Live states with the same sliders; what-if chips |
| Frame rate drops silently on heavy figures | Quality drops with a visible chip; the clock stays true |
| Animation state stored in the file only as slider values | Track, phase, input log saved with the film |

## 7. Defaults and look

| Element | Value |
|---|---|
| Bar height | 48 px (56 on touch) |
| Scrubber track | 4 px, `#d6dae0`; played part `#1a5fd1`; thumb 14 px |
| Beat ticks | 2 × 10 px, `#4a5260` |
| Trace | Object colour at 70%, width 1.25 px |
| Slider animate control | 16 px icon, `#4a5260`; active `#1a5fd1` |
| Banners | Amber `#b45f06` on `#fff4e0` |
| Speed default | 1× |
| Reduced motion | No autoplay; no scrub animation; particles frozen |

## 8. Autoplay rules

- A film starts paused unless the lesson says `Play()` in its first beat, or the host starts it.
- A figure in the playground never autoplays.
- Opening a figure with animated sliders does not start motion (the learner presses play).
