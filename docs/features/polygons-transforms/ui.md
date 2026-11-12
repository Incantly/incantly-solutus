# Polygons and transformations: what the learner sees and does

## 1. How the reference app presents it

- Polygon tools in one toolbar group: polygon (click the points, click the first point again to close), regular polygon (click two points, then type the number of vertices in a dialog), rigid polygon, vector polygon.
- Creating a polygon names and shows its vertices and sides. A transformed polygon also shows new vertices and sides with prime labels. The construction list fills with these objects.
- Transformation tools: click the object, then the transformation helper (a vector, a point, a line, a circle). The angle for rotation and the factor for dilation are typed in a dialog.
- The image is shown in the same style as the source with the same colour; a transformed point is labelled A′.
- A polygon shows its area in the algebra list and, if enabled, as a label on the figure.
- Rigid polygons show two special handles only in the drag behaviour; nothing marks them visually.
- Transformations are instantaneous. The user cannot see the motion unless they build a slider.

## 2. What we change, and why

1. **No hidden objects.** The polygon is one object; corners are normal points the user drew (or are shown as small markers if the polygon is made from a list or by a regular-polygon rule).
2. **Show the motion.** Every transformation tool has a "Show motion" toggle that builds the `progress` slider and animates it. Learners see the figure turn, slide, fold, grow.
3. **Show the helpers.** While a transformation tool is active, its helper is highlighted (the centre point with its angle arc, the mirror line with a light band, the vector with its head, the dilation centre with rays from the centre through each corner).
4. **Correspondence markers.** Optional dotted links from each corner to its image corner (`A to A′`), and matching colour pairs.
5. **Rigid polygon handles are visible**: a solid square at the anchor and a ring at the turn handle.
6. **Warnings in place.** A polygon that crosses itself shows a thin hatching on the crossing region and the label "crosses itself" next to its area readout.
7. **Boolean results are visible as parts.** Union, intersection and difference results draw in a different colour above the sources, with an optional exploded view.

## 3. Views and styles

### 3.1 Default styles

| Object | Style |
|---|---|
| Polygon | 2 px stroke in the theme `ink`; fill 14% of the stroke colour; even-odd rule |
| Polygon image | Same stroke with dash 6/3 when created by `progress < 1`; solid at `progress = 1`; fill 14% of its own hue |
| Polyline | 2 px stroke, no fill, round joins |
| Regular polygon | Same as polygon; the centre is shown as a small cross if the centre point is an object |
| Rigid polygon | As polygon; anchor handle a 9 px filled square, turn handle a 9 px ring |
| Polygon area label | at the centroid, "area 6" in the theme text colour; hidden by default for polygons made by tools; shown by `Readout` |
| Interior angle marks | arcs of radius 18 px at each corner, drawn on the interior side; the right-angle square when applicable; value labels optional |
| Boolean result | outline in `accent`, fill 24% |
| Transformation helper | centre: ring with the angle arc; mirror: 3 px light band along the line; vector: arrow in `accent`; dilation: faint rays from the centre through corners |
| Correspondence links | 1 px dotted, 40% opacity |

Corner labels of images use a prime (`A′`), placed away from the source corner label. A property `vertexlabels = none` hides them.

### 3.2 Layers

Polygon fills at the lowest geometry layer; images draw above sources; helper graphics above fills but below points; labels top.

## 4. Tools

| Tool | Interaction | Line(s) produced |
|---|---|---|
| Polygon | Click points; click the first point (or press Enter) to close; Esc cancels. Existing points are reused | `A = (…)` for each new point, then `p = Polygon(A, B, C, …)` |
| Regular Polygon | Click two points, then a number field appears at the cursor with a stepper | `p = Polygon(A, B, n)` with `n` a number (a slider appears if the user presses `S` in the field) |
| Rigid Polygon | Click a polygon, or click points | `r = Rigid(p)` or `r = Rigid(A, B, C)` |
| Vector Polygon | Click a start point, then draw vectors; close with Enter | `S = (…)` then `w = Polygon(S, u1, u2, …)` and each `ui = Vector(…)` |
| Translate by Vector | Click the object, then the vector (or two points to define it) | `v = Vector(A, B)` if needed, then `p2 = Translate(p, v)` |
| Rotate around Point | Click the object, then the centre; an angle field appears (degrees by default) with a direction toggle | `p2 = Rotate(p, 40°, O)` |
| Reflect about Line | Click the object, then the line, segment or ray | `p2 = Reflect(p, m)` |
| Reflect about Point | Click the object, then the point | `p2 = Reflect(p, O)` |
| Reflect about Circle | Click the object, then the circle | `p2 = Reflect(p, c)` |
| Dilate from Point by Factor | Click the object, then the centre; a factor field appears | `p2 = Dilate(p, 2, O)` |
| Shear, Stretch (extra tools in the Transform group) | Click the object, then the line; a ratio field | `Shear(p, l, r)`, `Stretch(p, l, r)` |
| Area | Click a polygon | `a = Area(p)` and a label |
| Angle (inside polygons) | Click the polygon: all interior angles | `α = InteriorAngles(p)` |

### 4.1 Preview

Each transformation tool shows the image under the cursor choices while the helper is being picked. With a typed parameter (angle, factor), a ghost updates as the user types or scrubs the number with the mouse wheel.

### 4.2 Show motion

The "Show motion" toggle at the end of each transformation tool:
- Creates `u = 0 in 0..1 step 0.01` hidden slider (or reuses the figure's film clock if inside a film) and rewrites the image line to use `progress = u`.
- Starts an animation of `u` over 1.5 seconds with ease-in-out, ending at 1.
- After the animation, the toggle stays on so replaying is one click; with it off, the image line has no `progress`.

In a film, the teacher's `show_me` or a timed `@beat` sets `u` as it speaks.

### 4.3 Snapping

- Points: existing point (12 px), grid (6 px if on), object (8 px).
- Angle field: snaps to multiples of 15° while dragging the angle handle; Shift disables.
- Dilation factor: while scrubbing, snaps to 0.5, 1, 1.5, 2 within 2%.
- Regular polygon: the number stepper goes 3 to 12 by 1; typing allows up to 1000.

### 4.4 Dragging

- Polygon made from free points: drag a vertex point to reshape; drag the body to translate all its free vertices.
- Regular polygon: drag the centre point to move, drag the edge point to scale and rotate.
- Rigid polygon: drag the anchor handle or the body to move; drag the turn handle to rotate; other places on the polygon show a "rigid" tooltip.
- Images are dependent; dragging one shows the lock and highlights the source.
- Helper objects (centre, mirror line, vector tip) are ordinary free objects and can be dragged; the image follows.
- A dragged vector's tip shows the image moving in real time.

### 4.5 Keyboard

As in `points-lines`, plus:
- With a polygon selected: `+` and `-` change the number of sides of a regular polygon when `n` is a free number.
- With a transformation image selected: `M` toggles show-motion; Left/Right scrub `progress` by 0.05 (0.01 with Alt) when `progress` is a free slider.
- With a rotation selected: `[` and `]` change the angle by 1° (15° with Shift).
- `Tab` cycles vertices of a selected polygon; Enter on a vertex starts a rename.

### 4.6 Screen-reader text

- Polygon: "Triangle tri with corners A (0, 0), B (4, 0), C (1, 3). Area 6. Perimeter 12.6."
- Regular polygon: "Regular pentagon p, centre O, radius 2."
- Image: "tri2 is tri rotated 90 degrees counter-clockwise about O. Corners A′ (0, 2), B′ (-1, 4), C′ (-3, 3)."
- Reflection: "tri2 is tri reflected in line m."
- Dilation: "tri2 is tri enlarged by 2 from O."
- Self-crossing: "Polygon p crosses itself. Area, 2, is the algebraic area."
- Boolean: "Overlap of a and b has 1 polygon of area 1."
- Undefined: "tri2 is undefined because O is undefined."
- During show-motion the screen reader announces start and end only ("Rotation started, ends at 90 degrees").

### 4.7 Touch

- Hit radius for polygon edges 14 px, vertices 22 px.
- Long press on a polygon: radial menu (rename, show vertices, show angles, transform, delete).
- Rotate handle at the angle arc is 28 px; two-finger twist on an image's source rotates the angle of a `Rotate` with a free angle when the image is selected.
- Show-motion button is a large play button below the figure.

## 5. Animation

- **Appear:** polygon fills fade in 150 ms after the outline draws (250 ms around the perimeter).
- **Transformation motion:** `progress` 0 to 1 over 1.5 s ease-in-out; intermediate positions come from the rule (no tweening of geometry). Fold reflections show the polygon squashing toward the mirror line.
- **Boolean results:** the result fades in above the sources over 200 ms; sources dim to 40% opacity while "Show result only" is toggled.
- **Rigid polygon:** moves exactly with the pointer; there is no easing.
- **Highlight:** the polygon's outline pulses and the vertices glow.
- **Correspondence links:** drawn only while the animation runs, then fade out over 400 ms unless toggled on.
- All animations respect the reduce-motion preference: the image jumps to its final state and a "motion skipped" tag is shown.

## 6. Properties panel

- Name, colour, opacity of fill, stroke width, dash, layer.
- Polygon: show vertices as markers, show side lengths, show interior angles, fill rule (even-odd, non-zero), `vertexlabels` (none, names, prime).
- Image: show correspondence links, show helper, show motion, `progress` field.
- Rigid: show handles.
- Boolean: show sources, show result only.

Changes are saved as `with` lines.

## 7. Differences from the reference app in one list

1. One object per polygon and per image; no automatic vertex and side objects.
2. A show-motion toggle that animates every transformation with the `progress` argument.
3. Helper graphics (centre with angle arc, mirror band, dilation rays) while a tool is active.
4. Optional dotted links between corresponding corners.
5. Visible handles on rigid polygons.
6. Warning for self-crossing polygons shown on the figure.
7. Boolean results drawn as visible pieces with an exploded view.
8. Reduced-motion fallback and screen-reader text for each transformation in words.
