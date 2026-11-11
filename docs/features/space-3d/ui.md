# Space (3D): what the learner sees and does

Companion to `design.md`. Numbers and rules for gestures and dragging are in design sections 8 to 10; this file is the user's view of them.

---

## 1. How the reference app presents 3D, and what we change

The reference app shows a 3D view next to the algebra list, with its own toolbar of tool boxes (each box holds related tools, the first shows), a style bar (axes, floor, grid, default view, point capture, spin, view direction, projection, settings), a cursor that previews a point before you click, and tool tips that tell you the next click. To create a point in space you press, drag up or down, and release. To move a point you click it to switch between “floor” mode and “vertical” mode. Right-drag turns the view; the wheel zooms; Shift-drag pans; Page Up/Down moves the selected object up/down.

What we keep: tool boxes, the tool tips, the preview cursor, the style bar items, right-drag to turn.

What we change:

- **Handles instead of mode toggles** (design 10.1). A selected point shows three arrows and three squares; no hidden click mode.
- **Drag does what the eye expects**: the point follows the pointer on the axis plane most facing the camera.
- **The camera is part of the figure**: a view change is a line (`space with …`), so undo, films and the teacher all see it.
- **Everything has text**: the screen-reader list of the 3D scene, spoken descriptions of cross-sections, keyboard control of the camera.
- **Clip box with caps**, readable transparency, dashed hidden lines behind transparent solids.

---

## 2. Layout

```text
┌───────────────────────────────────────────────────────────────────┐
│ tools:  ▸Move  ▸Point  ▸Line  ▸Plane  ▸Shape  ▸Solid  ▸Measure …  │
├────────────────────────┬──────────────────────────────────────────┤
│ Input / list           │ Space view                          ┌───┐│
│ A = (2, 0, 0)          │            z                        │ ⌂ ││ ← home (reset view)
│ B = (0, 3, 0)          │            │    ╱─────╲             │ ◐ ││ ← axes/floor/grid
│ pyr = Pyramid(...)     │            │  ╱  pyr    ╲           │ ◩ ││ ← projection
│ V = Volume(pyr)  8     │            └────────── y            │ ⟳ ││ ← spin
│                        │          ╱ x                        │ ⛶ ││ ← clip box
│                        │                                     └───┘│
│                        │  [ drag: turn · wheel: zoom · shift: pan ]│
└────────────────────────┴──────────────────────────────────────────┘
```

- The Space view can be next to the 2D view, replace it, or sit in a full-screen overlay (button top right). The list on the left is the shared object list; clicking an object in it selects it in the Space view and vice versa.
- A small **axis compass** (three coloured arrows labelled x, y, z) sits in the lower left; it turns with the camera. Clicking an arrow looks down that axis (`ViewPreset`).
- A **status line** under the view shows the current tool's next step (“Click a second point for the segment”).

---

## 3. Tools

Tool boxes (the first listed in each box is the one shown). Names in the second column are the lines the tool writes into the figure, so the list and the teacher stay in sync.

| Box | Tools → line written |
|---|---|
| Move | Move (select and drag) · Move view · Rotate view · Zoom in · Zoom out |
| Point | Point (`A = (x, y, z)` or `PointOn`) · Point on object (`PointOn`) · Intersect (`Intersect`) · Midpoint (`Midpoint`) |
| Line | Segment · Line · Ray · Vector · Perpendicular (`Perpendicular`) · Parallel (`Parallel`) · Bisector |
| Plane | Plane through three points · Plane through point and line · Parallel plane · Orthogonal plane · Bisector plane |
| Polygon | Polygon · Regular polygon (asks for the number of sides) · Polyline |
| Circle | Circle with axis through a point · Circle by centre, radius, direction · Circle by three points · Arc · Semicircle · Conic by five points |
| Solid | Pyramid · Prism · Extrude · Cone · Cylinder · Tetrahedron · Cube · Net · Sphere (centre and point) · Sphere (centre and radius) · Surface of revolution · Conify |
| Measure | Distance · Angle · Area · Volume · Surface area |
| Transform | Reflect in plane · Reflect in point · Reflect in line · Rotate around line · Translate by vector · Dilate from point |
| Intersection | Intersection curve (two surfaces) |
| Annotate | Text · Show/hide object · Show/hide label · Copy style · Delete |
| View | View in front of (`ViewFacing`) · Fit all (`ViewAll`) |

**Flow of a tool.** Pick the tool; the status line says what to click; hovering shows a **preview cursor** (see 5.2) and highlights the object that would be used; each click writes a line only when the final object is complete. Escape cancels. A tool that makes a point where there is none (for example Segment's first click in empty space) makes a free point in the plane facing the camera, at floor height if the floor is the most facing plane.

**Two-step creation of a point in empty space.** Click once: a point appears on the floor. Drag up from it (or press PageUp): a vertical guide extends and the point rises. The status line says “Drag up to set height” for 2 seconds. Single click in empty space places the point on the floor (z = 0), like the reference app; the improvement is that the point is immediately selected with its handles, so raising it is one drag on the blue arrow.

---

## 4. Selecting, hover and what is on screen

- **Hover**: the object under the pointer gets a thick halo (white outer, accent inner); its name and value appear in a small tag next to the pointer after 400 ms (“plane pl: z = 1.5”).
- **Select**: click. Selected objects show a halo and handles where they have free parts (free points: arrows and squares; spheres: the centre handle and a radius handle on the equator; planes defined by free points: their points).
- **Cycling**: when several objects are under the pointer, repeat clicks cycle through them nearest first; Alt-click opens a small pick list (“point A, segment AB, plane pl, sphere s”) so a point behind a transparent plane is always reachable.
- **Box select**: drag a rectangle on empty space with Shift held.

---

## 5. Dragging

### 5.1 Free points

```text
 Selected point A
        z ↑ (blue arrow)
          │   ┌──┐
          │   │xz│  squares move in a plane
      A ──●── └──┘
         ╱ \
        ╱   → y (green)        arrow: along an axis
   x (red)                     square: inside a plane
                               body: follows the pointer on the plane that faces the camera
```

- **Body drag**: on the most camera-facing axis plane (design 10.1). A dotted guide connects the point to the floor, so height is readable.
- **Arrow drag**: along that axis, with a ghost line along the axis through the point.
- **Square drag**: inside the plane, the square being the one whose plane is facing away from the camera least.
- **Shift while dragging**: vertical only. **Alt**: along the viewing direction.
- **Snap**: the grid, other points' coordinates and objects. When a dragged point snaps to an object, a ring appears around it and the status line says “on segment AB”.
- **Ctrl-drag** copies the point: the new point is free, at the pointer position.

### 5.2 The preview cursor

Before a point is created, a small ghost shows what would be made, with a different look for each case (matching the reference app's idea of free, on path, on surface, dependent, existing):

| Look | Meaning |
|---|---|
| Small cross on the floor | A free point on the floor |
| Cross with a dotted line down | A free point at a height |
| Ring around a path | A point on that path (line, circle, curve) |
| Ring with a dot on a surface | A point on that surface |
| Diamond | A dependent (intersection) point |
| Filled halo on an existing point | The existing point will be used |

### 5.3 Other objects

- Drag a **sphere or circle** by its body to move its free centre; drag the radius handle to change the radius (writes a literal radius, or moves the “through” point).
- Drag a **polygon, prism or pyramid**: moves its free vertices together by the same shift (design 10.3).
- Drag a **plane** defined by three free points: moves all three. Drag a plane defined by `Plane(P, normal)`: moves P and a rotate handle appears at the end of the normal.
- A dependent object is not draggable; the pointer shows a lock and the status line says what to drag instead (“move A or B to change M”).

### 5.4 Keyboard

| Key | Action |
|---|---|
| Arrow keys | Move the selected free point in x and y by one grid step (Shift ×10, Alt ÷10) |
| PageUp / PageDown | Move in z |
| Tab / Shift-Tab | Next / previous object in the list |
| Enter | Open the selected object's definition for editing |
| Delete | Delete object (with the dependents listed) |
| Escape | Cancel tool or deselect |
| W A S D or I J K L (view focused) | Orbit camera |
| + / − | Zoom |
| H | Reset view (`ViewReset`) |
| F | `ViewFacing(selected)` |
| 1–6 | `ViewPreset` front, back, left, right, top, bottom |
| 0 | Isometric |
| P | Toggle projection ortho ↔ persp |
| C | Toggle clip box |
| Space | Toggle spin |

---

## 6. Camera

### 6.1 Gestures

| Input | Effect |
|---|---|
| Drag the background (or right-drag) | Orbit |
| Shift-drag, middle-drag, two-finger drag | Pan |
| Wheel, pinch | Zoom toward the pointer |
| Two-finger twist | Roll (only if `roll` is enabled in settings) |
| Fling | Inertial spin, decays in about 0.7 s |
| Double-click empty space | Reset the view with an animated fly |
| Double-click an object | Look straight at it (`ViewFacing`) |
| Click an axis arrow in the compass | Look down that axis |

Orbit is trackball style, so you can go over the top without flipping. Pan keeps the pointer's world point under the pointer. Zoom keeps the world point under the pointer fixed.

### 6.2 Style bar (right side of the view)

| Button | Meaning |
|---|---|
| ⌂ Home | `ViewReset` |
| ◐ Display | Toggle axes, floor, grid (a small pop-up with three switches and a “colour axes” option, on by default) |
| ◩ Projection | Orthographic · Perspective (with a field-of-view slider) · Oblique (angle and depth sliders) · Presets (front, top, right, isometric…) |
| ⟳ Spin | Start / stop automatic rotation; a small speed slider |
| ⛶ Clip | Toggle clip box; box size presets (tiny … huge); “show caps” |
| ☀ Light | Light on / flat / off |
| ⬚ Stereo | Off · Red-cyan · Side by side (with eye separation slider) |
| ⚙ | Opens the `space` properties list (all properties in design 8.1) |
| ◉ Snap | Snap off · Auto · Always |

Each button writes a `space with …` line (the same one the teacher uses), so undo and the film see it. Sliders write changes on release, but preview live while dragging.

### 6.3 Projection feedback

- Switching projection animates over 300 ms (ortho ↔ persp by dollying and field-of-view blend so the target stays the same size).
- Oblique shows a small side panel of two sliders (angle, depth factor) and a compass whose depth axis lines up with the oblique direction.
- A status chip in the corner names the projection and, in perspective, the field of view (“Perspective 40°”).

---

## 7. Objects: default look

| Object | Default |
|---|---|
| Axes | x red, y green, z blue, thin with arrow ends, labelled x, y, z; tick marks with numbers at each unit; hidden in an exam/clean mode |
| Floor | Pale blue-gray plate, 25% opacity, grid lines every unit (thin), major every 5 |
| Points | Dark blue, radius 4 px, drawn as shaded spheres (a small highlight) |
| Free points | Slightly larger (5 px) and a ring on hover |
| Dependent points | Dark gray |
| Lines, segments, rays | Dark gray, 2 px; vectors with a 3D arrowhead |
| Planes | Light blue, 25% opacity, edge line of the same hue, drawn as a finite patch about the size of the view, fading at the edges |
| Polygons | Pastel colour, 40% opacity, edge in darker colour |
| Polyhedra | Per-object pastel, 40% opacity, edges dark, back edges dashed |
| Quadrics | Pastel, 45% opacity, iso-lines on (12 rings, 12 meridians), faint |
| Surfaces | Height-coloured gradient (blue low, orange high), 90% opacity, iso-lines faint |
| Circles/curves | 2–3 px, accent colour |
| Intersection curves | Red, 3 px |
| Labels | Name and (optionally) value; dark text with a white halo; avoid overlaps |
| Selection | White-and-accent halo |
| Clip box outline | 1 px light gray |
| Background | White; dark mode available |

Colour choices keep **contrast ≥ 4.5:1** between a label and its halo background; objects meant to be told apart avoid red/green as the only distinction (shapes and dashes differ too).

---

## 8. Clip box

```text
        ┌──────────┐
       ╱│          │╲
      ╱ │  inside  │ ╲      ← box outline, corners have square handles
     ┌──────────┐   │
     │  ╲  ╱    │   │
     │   ╳      │  ╱        face handles: drag a face to move that bound
     └──────────┘ ╱
```

- Turn on from the style bar (⛶) or `space with clip = true`.
- Drag a **face handle** to move that side. Drag the box body to translate. Hold Shift to scale about its centre.
- “Show caps” fills the cut section of closed solids with the solid's colour (design 8.7).
- The size presets scale the box about its centre; the object list shows `clipMin/clipMax` values editable as text.
- Objects outside are not just hidden: their labels also disappear, and the list greys their rows.

---

## 9. Transparency and hidden parts

- Edges behind an opaque object are dashed and 40% opaque; behind a transparent solid they are dashed too (so a see-through cube shows its back edges as dashes).
- A per-object `hidden` setting chooses dashed, faded (thin and light) or off.
- Transparency is order-independent where the device supports it, so overlapping planes look right from every angle.
- **Slice highlight**: when a plane cuts a solid, the section polygon is drawn in a strong colour and filled, even if the plane is nearly transparent.

---

## 10. Nets

When a `Net` exists, the object list shows a small slider next to it (the `t` parameter) and a **fold/unfold** play button that animates it over 2 seconds. Fold lines are dashed. Faces keep the solid's colours with face numbers shown as small labels while the net is flat (optional). A tooltip says “Drag to fold: 0 folded, 1 flat”. If no overlap-free net could be found, a small notice says so.

---

## 11. Stereo, AR

- **Red-cyan**: a toggle with an eye-separation slider and a “swap eyes” checkbox; colour objects keep readable hues; the UI chrome is not stereoscopic.
- **Side by side**: two half-width images; a “cross-eyed” checkbox swaps them.
- **AR** (phase 5): a button appears on supporting devices. Flow: tap AR → camera opens → “Move your phone slowly” → surface found → tap to place → drag to move, twist to rotate, pinch to scale → a scale chip lets you choose how big one unit is (1 mm, 1 cm, 10 cm, 1 m) → camera button saves a picture. Controls to hide objects stay available as a bottom sheet.
- On devices without WebXR the AR button offers “Open the 3D model” (glTF in the system viewer).

---

## 12. Accessibility

### 12.1 Screen-reader tree

The Space view has an offscreen list (`role="tree"`) with one item per object, in list order, each with a concise description built from a template:

| Object | Spoken text |
|---|---|
| Point3 | “Point A at x 2, y 0, z 3” |
| Segment3 | “Segment AB from A to B, length 5” |
| Plane | “Plane pl, equation z equals 1.5” |
| Sphere | “Sphere s, centre origin, radius 2” |
| Polyhedron | “Pyramid pyr, 5 vertices, 5 faces, volume 8” |
| Surface | “Surface S, z equals sin x y, over x from minus 5 to 5” |
| Intersection | “Circle c, intersection of plane pl and sphere s, centre 0 0 1.5, radius 1.3” |
| Camera | “View: orthographic, looking from azimuth minus 40, elevation 22” |

Selecting an item in the tree selects it in the view. A **“Describe view”** command (key `?`) reads a summary: what is visible, what is hidden behind what, what is clipped (from the same data as `figure.view`).

### 12.2 Keyboard and motion

- All camera operations and point moves are available by keyboard (section 5.4).
- The home view and the isometric preset are one key each.
- `prefers-reduced-motion`: camera flies become instant cuts; inertia and auto-spin are off by default; the fold animation jumps.
- Focus ring on the view container; objects in the list show focus with the same halo as hover.

### 12.3 Colour and contrast

- Axes are distinguished by label and by colour; a colour-blind safe palette option swaps red/green to orange/blue.
- Dashes are used besides colour for hidden parts.
- Label halos guarantee contrast.

---

## 13. Touch

| Gesture | Effect |
|---|---|
| One finger on background | Orbit |
| Two fingers | Pan and pinch zoom |
| Two-finger twist | Roll (off by default) |
| Tap object | Select; handles appear (44 px hit area) |
| Drag a handle | Constrained move |
| Long-press a point | Switch to vertical-only for that drag (haptic tick) |
| Double-tap background | Reset view |
| Double-tap object | `ViewFacing` |
| Three-finger swipe up / down | Raise / lower the selected point (matches PageUp/PageDown) |

The picking tolerance doubles on touch (22 px). The preview cursor is replaced by a magnifier bubble above the finger for precise placement. Tools wait for lift-off before writing a line.

---

## 14. Animation

| Animation | Duration / curve | Notes |
|---|---|---|
| Reset / ViewFacing / preset | 400 ms, ease-in-out | Interactive use only; scripts and films cut instantly (a beat may ease) |
| Projection change | 300 ms | Blend of field of view |
| Spin | continuous, speed slider | Writes `spin` so films replay it |
| Orbit inertia | decays over ~0.7 s | Off with reduced motion |
| Net fold | 2 s, ease-in-out | Writes the slider value |
| Surface refinement | meshes refine invisibly; a thin progress arc at the corner of a surface's label while refining | |
| Intersection curve growing | Progressive; the curve extends from the seed as it is traced | |
| Selection halo | 120 ms fade | |

Frame pacing: user input is always handled first; meshing never blocks a frame (time slices of 3 ms).

---

## 15. Plane view (phase 4)

Right-click a plane (or tool “Open view of plane”): a 2D view opens, whose axes are the plane's frame. The 3D objects that meet the plane appear live in it (sections of solids as polygons, circles, conics), with all 2D tools available there. Drag in the plane view moves free 2D-compatible inputs. The section's area and perimeter appear as optional readouts. A little plane icon in the corner of the 3D view links the two (hover highlights the plane).

---

## 16. Settings dialog (⚙)

Groups: **Camera** (azimuth, elevation, roll, target, zoom, projection, field of view, oblique), **Display** (axes, floor, grid, colours, axis scales and ratio, z up, background), **Lighting** (on, flat, off), **Clip** (on, min, max, size, caps), **Stereo/AR**, **Quality** (maximum triangles, antialiasing, hidden-line style, iso-line density), **Accessibility** (reduced motion, palette). Every row maps to a property of `space`; edits write `space with …` lines.

---

## 17. Differences from the reference app, at a glance

| Topic | The reference app | Ours |
|---|---|---|
| Moving a point in z | Click the point to switch modes | Arrows, squares, Shift, Page keys, camera-facing default |
| Camera | Two angles, z up | Quaternion, any orientation; part of the figure |
| Transparency | Multi-pass approximations | Order-independent where supported |
| Cut by clip box | Hollow | Optional caps |
| Reading the scene | Mostly visual | Text tree, “describe view”, `figure.view` |
| Cross-sections | Intersection objects | Same, plus a plane view with area readouts |
| Fallback | Basic software view | Same scene in a software backend; export to SVG/PNG/glTF/STL |
| Touch | Basic | Large handles, magnifier, three-finger raise/lower |
