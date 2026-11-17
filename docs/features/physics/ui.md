# Physics: what the learner sees and does

Companion to `design.md`. The same in the studio, in `createApp` embeds and in Tiptap figures, unless a section says otherwise. 3D parts use the Space view of `docs/features/space-3d/ui.md`.

## 1. What changes on screen

| Place | What is new |
|---|---|
| Board (2D) or Space view (3D) | Bodies, solid shapes, joints, liquid, waves, smoke and cloth; force and speed arrows when switched on |
| Player bar | Appears once the figure has physics; "catching up" and "slow" marks |
| Algebra list | Body, joint and world rows with live values |
| Tool strip | A "Physics" group |
| Style bar | Arrow buttons, and solid and body switches for the selected shape |
| Performance panel | A physics row |

## 2. The film

- A figure with physics opens paused at `t = 0`, with every body at its start. Nothing moves until the learner presses ▶, so a page never starts moving by itself. With "reduce motion" on, this is always the case, even for a figure saved while playing.
- ▶ plays, ⏸ pauses, and dragging the time bar seeks. Seeking shows the world at that time at once (warm), or after a short "catching up" mark (cold).
- ⟲ restarts: every body goes back to its start.
- When the computer cannot keep up, the film plays slower and the player bar shows a small "slow" mark with a tooltip: "This computer is busy. The film is the same, only slower." The film never skips or changes.

## 3. Tools

The "Physics" group in the tool strip. Each tool writes the lines a person would type, shown in the input bar before they are applied, as for every tool (`docs/features/tools-2d/`).

| Tool | Clicks | Writes |
|---|---|---|
| Make solid | click shapes | `p with solid = true` (a second click on a solid shape turns it off) |
| Make body | click a closed shape | `b = Body(p, mass = 1)` |
| Ground | click | `g = Ground()` |
| Hinge | click a body, a second body or a solid shape, then the point | `j = Hinge(a, b, (x, y))` |
| Spring | click two bodies (the click points are the anchors) | `s = Spring(a, b, 50, pa = …, pb = …)` |
| Rope | click two bodies | `r = Rope(a, b, L)` with `L` the current distance |
| Weld | click two touching bodies | `w = Weld(a, b)` |
| Push | drag from a body; the arrow's length is the kick | `Push(b, (vx, vy), (x, y))` |
| Water | drag up from the bottom of a box to set the level | `wa = Water(region, level)` |
| Liquid | drag a box | `l = Liquid(Box(…), 500)` |
| Smoke | click two corners of the box of air, then where the smoke comes from | `smoke1 = Smoke(Box(…), 48, source = Circle(P, r))`, `r` a twentieth of the box |
| Cloth | 2D: drag a line for a rope, or a box for a net; 3D: drag a rectangle on the floor plane, then up for its height | `rope = Cloth(A, B, 40)`, `net = Cloth(Box(…), 24, 16)`, `sheet = Cloth(P, u, v, 32, 32)` |
| Pin | click a point of a cloth, then nothing (the world) or a body | `Pin(c, (x, y, z))` or `Pin(c, (x, y, z), b)` |

Wrong clicks get the tool's own short message under the cursor, from the error's `hint` ("Click a closed shape. A line can only be made solid.").

## 4. Dragging

| What is dragged | Paused at `t = 0` | Playing, or paused at `t > 0` |
|---|---|---|
| A body | moves its start: writes the source shape's change | grabs it: a stiff spring pulls the body toward the pointer, so it swings and hits things on the way |
| A point of a solid shape | moves the shape (a wall moves) | the shape moves and pushes bodies (a mover) |
| A slider read by physics | changes the value; the film replays from 0 | the same, or from now on if the slider has `rerun = continue` |
| A joint anchor | moves the anchor | not draggable while playing |
| A cloth | moves its start (its corner, or its ends) | grabs its nearest point, so the cloth stretches and swings from there |
| A pin | moves the pin | not draggable while playing |

A grab while playing is logged, so the replay shows the same grab. The grab line shows while the pointer is down, from the pointer to the grabbed point, with a small ring at each end. A grab lets go when the pointer leaves the board.

Keyboard: with a body selected, arrow keys give a small push (`Push(b, (±1, 0))` or `(0, ±1)`), Shift gives five times as much. Space plays and pauses, as on every figure.

## 5. Seeing the forces

- The style bar has two buttons: **Forces** and **Speeds**. They write `world with show = "forces"` or `"speeds"`, so they are part of the figure and the teacher can use them too. With a body selected, the buttons show arrows for that body only (`b with show = "forces"`).
- Each force kind has its own colour and a short label next to its arrow: gravity, normal, friction, tension, spring, buoyancy, drag, electric, applied, and net (thicker).
- Arrows are scaled so the largest force on screen is about 2 cm long. A small key in the corner says what 1 cm means ("1 cm = 10 N").
- Arrows fade over 0.2 s when a force stops, so a bounce leaves a short flash.
- **Contacts** (`world with show = "contacts"`) draws each touching point as a small dot with its normal, for lessons on how the solver sees the world.

## 6. Algebra rows

| Row | Shows |
|---|---|
| Body | its name, the shape it came from, mass, and a live line: "speed 3.9 m/s, energy 39 J"; a small "z" when asleep |
| Solid shape | the shape's own row, with a small solid mark |
| Joint | kind and the two bodies, with its force ("tension 12 N"); struck through when broken |
| World | gravity and how many bodies are awake |
| Liquid | the particle count and its level |
| Cloth | its grid ("48 by 32"), pins, and a live line: "most stretched 3%, 0 torn"; a small "z" when asleep |

Clicking a body row selects the body on the board, as for every object. The live line updates at most 10 times a second, so the list stays still enough to read.

## 7. Default look

| Object | Look |
|---|---|
| Body | its shape's colour, slightly darker edge; a small dot at the centre of mass |
| Solid shape | its own style, with a hatched edge on the solid side, so walls read as walls |
| Hinge | a small ring |
| Spring | a zigzag that stretches |
| Rope | a thin line that sags when slack |
| Weld | a small cross |
| Wheel | a dark circle with spokes, so its spin shows |
| Liquid | light blue discs, drawn in one batch |
| Water | a light blue fill below a darker line; in space a translucent patch at its level |
| Waves | in space a lit blue surface mesh through the heights; in the plane a darker line over a light fill |
| Liquid in space | light blue dots a drop wide, drawn far to near among the faces |
| Smoke | a grey shaded image under the shapes |
| Cloth in space | a lit sheet in a soft orange, the back side a little darker, faint threads every 8 points |
| Cloth in the plane | its threads as thin lines; a rope as a smooth line |
| Pin | a small dark dot |

## 8. Hits and sound

- A hit flashes the force arrows if they are on. Nothing else flashes by default, for people who are sensitive to flashing.
- `on b hit: …` handlers can play a note (`docs/features/sound/`), change a colour or count hits. They run after the step, at most 24 notes a second, as the sound area allows.

## 9. 3D

- Bodies, the floor, terrain, waves and cloth are drawn in the Space view, with its light and hidden lines. Cloth and drops use the WebGL 2 painter (`design.md` 12.1); without it they are drawn coarser, and move the same. Until round 9 builds that painter, drops in space are the software painter's dots and waves its faces (`design.md` 12). The physics row of the time bar also shows a world in space, its drops and whether it runs in the worker.
- Dragging a body in 3D grabs it on the plane facing the camera, as for free points (`space-3d/ui.md` 5.1). Shift drags it up and down.
- A car: when a figure has a `Vehicle`, the arrow keys drive it while the Space view has focus (up and down for `motor`, left and right for `steer`, Space for `brake`). They write the slider values the car reads, logged while playing. A "Follow" button on the style bar keeps the camera behind the car.
  - Only pedals written as a plain name of a free number are driven. A key press sets the slider to its end (motor ±1, steer to the slider's ends or ±0.5 rad, brake 1); letting go sets it back to 0. While a point is selected the arrow keys move the point instead.
  - Follow changes only what is drawn: the camera looks along the car from behind and a little above it, in perspective. It writes no camera line, so the figure is unchanged.
  - Name the steering slider something other than `turn`: `turn` is also the angle unit (1 turn = 360°).

## 10. Accessibility

- The hidden object list reads each body: "Body b, box, moving right at 3.9 metres a second, touching ramp". It updates at most once a second.
- Hits are announced in the live region at most once a second: "b hit the wall at 2 metres a second".
- A cloth reads: "Cloth flag, 48 by 32 points, pinned on the left, waving, 0 torn". A tear is announced once: "net tore".
- Force arrows have text labels, not colour alone.
- Every tool works by keyboard, through the virtual cursor of `docs/features/tools-2d/`.

## 11. Touch

- One finger drags (a grab while playing), as with a mouse. Two fingers pan and zoom, as on every figure.
- The Push tool on touch: press on a body, drag, release.
- Hit areas for bodies and joint anchors are at least 44 by 44 points.

## 12. Performance panel

The studio has no performance panel yet (`docs/design/performance.md` 6). Until it does, the time bar shows a physics readout next to the time: milliseconds of work per frame, awake bodies and touching points, and cloth points and drops when there are any. It turns amber above 6 ms on the page, or above 8 ms when the world runs in the worker. The full panel row (steps per frame, liquid particles, checkpoint memory) comes with the panel.

## 13. Settings

None of their own. Physics has one speed level for every computer (`design.md` 11), so there is nothing to tune. The figure's own `world` line holds every physics setting.
