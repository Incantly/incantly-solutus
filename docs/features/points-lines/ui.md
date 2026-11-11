# Points, lines, vectors, intersections and measures: what the learner sees and does

## 1. How the reference app presents it

- A toolbar of grouped tools (point, line, special line, measure). Each tool needs a mode switch, then clicks on the canvas and on existing objects. Selecting an object while a tool is active either uses it as an input or creates a new free point under the cursor.
- A new point is created when you click empty space during a line tool; clicking an existing line or circle creates a point attached to it; clicking where two objects cross creates the intersection. This is useful but invisible: learners do not know which of the three happened.
- Free points show as blue dots, dependent points dark grey; lines are thin black; labels are shown by default for points. Drag-hit areas are small.
- Angles are drawn as a filled arc with a numeric label in degrees; a right angle gets a small square only when the setting is on.
- Dependent objects do not move when dragged; the drag moves their free parents (and the rest of the construction with them), which many learners find surprising.
- Keyboard: arrow keys move a selected point by the grid step; Tab cycles through objects.
- No explanation when something becomes undefined: the object just disappears.

## 2. What we change, and why

1. **Show the effect of a click before it lands.** While a tool is armed, a ghost preview shows what will happen: a faded point at the snap position, labelled by what it will be ("on circle c", "at intersection of a and b", "free").
2. **Say why something is undefined.** An undefined point leaves a small "ghost" mark at its last defined place (or at the edge of the view) with a short tag: "parallel", "off the segment". It fades in 200 ms and disappears when the object becomes defined or the user hides the reason (setting).
3. **One script line per action.** Every tool produces exactly the lines it would take to type. The history list shows them; undo removes the line.
4. **Dependent objects are draggable through their free parents only when the user asks** (core design question 2). The default is: dragging a dependent point shows a small lock icon and a note "this depends on A and B"; dragging a free parent moves the dependent.
5. **Stable labels.** Intersection point numbering never swaps during a drag (design section 3.5). When two slots merge at tangency they show as one point with label "A, B".

## 3. Views and objects

### 3.1 Default styles

Visual roles; colours come from the figure theme (the numbers below are the default light theme, and roles map to the dark theme with the same contrast ratios).

| Object | Style |
|---|---|
| Free point | Filled disc, radius 5 px, colour `accent`; label shown |
| Dependent point | Disc radius 4 px, colour `ink`, 2 px ring in `accent` fade; label shown |
| Point on path | Disc radius 5 px with a small tick pointing along the path |
| Intersection point | Hollow circle radius 5 px, `ink` stroke; becomes a double ring when `tangent` |
| Line, ray | 2 px stroke `ink`; unlimited ends fade out over the last 24 px at the view edge |
| Segment | 2.5 px stroke; end caps round |
| Vector | 2.5 px stroke with a filled arrowhead, length 10 px, width 8 px; scales down for short vectors |
| Perpendicular and parallel results | Same as line, plus an optional small right-angle square or double-arrow tick (setting "show relations") |
| Angle mark | Arc of radius 24 px (grows with the figure zoom, capped 60 px), 18% fill of the line colour, label inside; right angles get the square mark |
| Distance and length readout | A thin dimension line parallel to the segment, offset 14 px, with end ticks; the number in the middle |
| Slope | A right-angled triangle on the line with rise and run labels |
| Locus | 2 px stroke, dashed 6/4 while it is being traced, solid when complete |

Label placement: automatic with avoidance. Preference: above-right of a point; for intersections, away from the bisector of the lines at that point; collisions with other labels are resolved by trying 8 positions then offsetting radially.

### 3.2 Layers

Points and labels above lines; marks (angles, ticks) above fills but below points; locus below lines. Layers from the core design apply (draw order: layer, type, creation order).

## 4. Tools

Each tool is a small state machine that builds one script line.

| Tool | Clicks | Line produced | Notes |
|---|---|---|---|
| Point | 1 | `A = (x, y)` or `A = PointOn(obj, u)` | Click on empty space: free. Click on an object: on-object. Hold Alt: force free |
| Point on Object | 1 on object | `A = PointOn(obj, u)` | |
| Attach / Detach | click a point | rewrites its line | Attach: asks for the object |
| Intersect | click two objects, or click at a crossing | `P = Intersect(a, b, k)` | With k chosen by which crossing is nearest the click |
| Midpoint | two points, or one segment | `M = Midpoint(…)` | |
| Line, Segment, Ray | two clicks | `Line(A, B)` etc | Missing endpoints become free points created first |
| Segment with Given Length | click start, type length | `s = Segment(A, 3)` | Length field is a text box, may contain a formula |
| Vector, Vector from Point | two clicks | `u = Vector(A, B)`; `w = Translate(u, C)` | |
| Perpendicular, Parallel | click point then line | `Perpendicular(P, l)` | Either order accepted |
| Perpendicular Bisector | two points or a segment | `Bisector(A, B)` | |
| Angle Bisector | three points, or two lines | `Bisector(A, B, C)` or `Bisector(l, m)` | For two lines both lines are made and named |
| Locus | tracer, then mover | `Locus(Q, P)` | |
| Angle | three points, or two lines, or two vectors | `α = Angle(A, B, C)` | A modifier key flips to the reflex side by swapping the arms in the line |
| Angle with Given Size | two points, type the angle | `B' = Rotate(…)` and `Angle(…)` | The two lines it writes are shown together |
| Distance or Length | two points, or an object | `d = Distance(…)` | |
| Slope | click a line | `m = Slope(l)` | |
| Relation | two objects | reads the relation into the side panel | No object is created |

### 4.1 Snapping

| Snap | Strength (screen distance) | Effect |
|---|---|---|
| Existing point | 12 px | Reuse that point |
| Object (line, circle, segment) | 8 px | Create `PointOn` |
| Crossing of two objects | 10 px | Create `Intersect` |
| Grid | 6 px when grid snap is on | Round to the grid step |
| Axis (angle) | 4° | While dragging a point on a rotating construction, snap to multiples of 15° when Shift is held |
| Perpendicular and parallel | 3° | While drawing a segment, a faint guide appears when it would be perpendicular or parallel to a nearby segment; click to accept (writes `Perpendicular` instead of a free segment) |

Snap priority: existing point, crossing, object, grid. A small badge near the cursor names the snap.

### 4.2 Dragging

- Free point: moves with the pointer; the dependent figure redraws in the same frame.
- `PointOn`: pointer is projected onto the path (using the previous parameter as hint); the point glides, never jumps across a self-crossing branch. For a closed path, wrapping around the end is continuous.
- Line, segment, vector (when defined by free points): dragging the object body translates all its free end points together. Dragging an end point moves only that point.
- Dependent objects: see 2.4.
- During a drag the status line shows the object name and live value ("P = (2.1, 3.4)").

### 4.3 Keyboard

| Key | Action |
|---|---|
| Tab / Shift+Tab | Next / previous object in creation order |
| Arrow keys | Move the selected free point by 1 grid step (10× with Shift, 0.1× with Alt) |
| `[` / `]` | Move a `PointOn` along its path by 0.01 of the parameter (0.1 with Shift) |
| Enter | Rename |
| Delete | Remove object and dependants (confirmation lists them) |
| `T` | Toggle the label |
| `Esc` | Cancel the armed tool |

Typed lines go to the input line (focus with `/`). Every typed line is checked before it commits and errors appear under the input line with the hint.

### 4.4 Screen reader text

Each object has a text alternative generated from the same data as the figure listing:

- Point: "Point A at x 2, y 3."
- Point on path: "Point P on circle c, one quarter of the way round."
- Intersection: "Point P where line a meets circle c, first of two."
- Undefined: "Point P is undefined because lines a and b are parallel."
- Angle: "Angle at B between A and C, 56 degrees."
- Line: "Line a through A and B, slope 2."
- Vector: "Vector u from A to B, length 3.6, direction 56 degrees."

Changes during a drag are announced at most twice per second with the dragged object's new value, and once when the drag ends with any object that became undefined or defined again.

### 4.5 Touch

- Hit radius 22 px for points, 14 px for lines.
- Long press on an object opens the context ring (rename, delete, show/hide label, attach, properties).
- A two-finger drag pans, pinch zooms. A second finger held while dragging a point constrains it to the grid.
- Armed tools show a floating cancel button.
- Dragging a point shows an offset magnifier above the finger (24 px up) so the finger does not hide the point.

## 5. Animation

- **Appear:** a new point scales from 0 to full size in 120 ms; a segment or line draws from the first point to the second in 250 ms; a vector grows with its head. When the teacher builds a figure live, objects appear in dependency order, one every 120 ms at most, so the drawing keeps pace with the speech.
- **Highlight(obj, seconds):** a ring pulse at 1.2 Hz and a 30% thickness boost on the stroke.
- **Perpendicular and bisector construction hint (optional style `construct`):** show the compass arcs and the ruler line for 1 second before the final line. Used by teachers for ruler-and-compass lessons.
- **Undefined to defined:** the point fades in over 150 ms at its new position; defined to undefined: it fades out over 150 ms and leaves the reason tag.
- **Motion:** all positions come from rules, so any `t` animation is exact; no tweening is applied to geometry (tweening would make dependents disagree with their rules).

## 6. Properties panel

Opened by double click or the properties key (`P`):
- Name, caption, label style (name, value, name and value, caption).
- Colour, size/width, line style (solid, dashed, dotted), opacity, layer.
- Point: shape (disc, ring, cross, diamond).
- Line: extent (full, ray, segment), arrow ends.
- Angle: radius, filled or not, arc count, display unit (degrees or radians).
- Show reason tags (on/off, default on).

Changes in the panel emit `Name with prop = value` lines (core design restyle lines), so styles are saved with the script.

## 7. Differences from the reference app in one list

1. A ghost preview says what the next click will create.
2. Undefined objects show a reason tag.
3. Intersection numbering is stable and shown ("first of two") in the screen reader text and the properties panel.
4. Dependent objects are not dragged through their parents silently.
5. Perpendicular and parallel guides while drawing segments.
6. Compass-and-ruler construction animation as a style.
7. Angle marks follow the written arm order, with an explicit flip modifier for the reflex side, and always show the right-angle square.
8. Readouts (distance, slope) are dimension lines drawn on the figure, not only numbers in a side list.
