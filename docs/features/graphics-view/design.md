# Graphics view: design

Status: draft for review. Fits `docs/design/formula-language-and-kernel.md` (sections 2, 3, 8, 9). Covers the 2D canvas: what is drawn, how it is painted, how the pointer finds and moves things, and how a figure leaves as an image. The tools that create objects are in `../tools-2d/`. Time, traces and particles are in `../animation-time/`.

## 1. What the feature does

### For a learner

- Sees the figure on a canvas with optional axes and grid.
- Pans (drag the background, two-finger drag), zooms (wheel, pinch, buttons) and resets the view.
- Drags free points, points on paths, sliders and, where it makes sense, shapes built from free points.
- Selects objects (click, shift-click, rubber band, keyboard) and reads their names and values.
- Sees labels and captions, can drag a label to move it.
- Exports the figure as PNG or SVG.
- Uses a screen reader and the keyboard to do everything above.

### For a teacher (the live teacher and a human author)

- Sets the visible region, grid and axes with directives (`@view`, `@grid`, `@axes`).
- Styles any object with `with` (colour, width, dash, point shape, fill, hatch, opacity, label, layer, show-if).
- Moves the view during a film (`@view` in a beat, optionally with a duration).
- Highlights an object while speaking (`Highlight`, section 9).
- Gets back a list of what is on screen and what is undefined, to talk about.

### Sub-features covered

| # | Sub-feature | Section |
|---|---|---|
| 1 | Coordinate systems | 3 |
| 2 | Zoom, pan, ratio lock, view animation | 4 |
| 3 | Grid and axes (kinds, tick choice, labels) | 5 |
| 4 | Drawables, painting, dirty marking, repaint batching | 6, 7 |
| 5 | Layers and draw order | 8 |
| 6 | Styles: colour, line style, point style, fill, hatching, opacity, labels, captions, show-if | 9 |
| 7 | Hit testing | 10 |
| 8 | Selection | 11 |
| 9 | Dragging: free points, points on paths, dependent objects, sliders, labels | 12 |
| 10 | Snapping | 13 |
| 11 | Export to image and SVG | 14 |
| 12 | Accessibility of the canvas | 15 |
| 13 | Style bar and view options (the UI side is in `ui.md`) | ui.md |

## 2. How GeoGebra does it (plain words)

What we learned from `euclidian/` and the manual pages on the Graphics view, its style bar and customising it.

- **One big view object, one bigger controller.** The view holds the coordinate mapping, the grid and axes, a sorted list of drawables and the repaint logic, in about 6,700 lines. The controller handles every pointer event for all tools in about 12,600 lines, with a mode number per tool. This works, but each tool adds branches to one file.
- **Coordinates.** The view keeps an origin in pixels and two scales (pixels per unit on x and on y). Converting is a multiply and add. The two scales may differ (a free axis ratio). A ratio lock keeps them equal.
- **Drawables.** Each visible object gets a drawable that turns the object's value into screen shapes (paths, rectangles, text). Drawables cache their shapes. A change marks them stale; they recompute during the next paint. Repaints are merged so many changes in a frame cost one paint.
- **Draw order.** The list is sorted by layer (0 to 9), then by a type priority, then by creation order. Backgrounds (images) are drawn first.
- **Hit testing.** On every pointer event the view loops over all drawables and asks each one "are you within a few pixels of this point?". The pixel allowance is small for a mouse (3) and about three times as big for touch. The hits are then ranked: a label, then a point, then an edge, then an area. The tool in use filters the list by object type.
- **Selection and dragging.** The move tool picks the top hit. Free points move to the pointer. A point on a path is projected back onto the path. Dependent objects whose inputs are free points are moved by moving those points by the same offset.
- **Snapping.** Four modes: off, to grid, to existing points, and automatic (grid if the grid is visible). Sticky snapping to points exists while dragging. A shift-style key limits angles.
- **Styles.** Colour, opacity (separate for line and fill), line width and dash type, point size and shape, fill hatching (about ten patterns plus image fill), label modes (name, value, name and value, caption, nothing), a caption with substitutions, a layer, conditions for showing, and a flag for tracing.
- **Export.** The same drawing code runs against a canvas, a vector (SVG/PDF) target, or a bitmap with scale and DPI. The exported region is the current view or the bounding box of objects.
- **Accessibility.** A hidden DOM copy of the objects for screen readers and arrow-key movement of the selected point.
- **Zoom.** A wheel step is a factor of 1.1; the zoom-in and zoom-out tools use 1.5; there is an animated "zoom to rectangle".

### What works

- Separating value, style and drawable.
- Cached geometry plus merged repaints.
- One drawing interface for canvas and vector export.
- Ranked hits that let a tool say what it wants.
- Moving a dependent shape by moving its free points.

### What is weak

- Hit testing scans every drawable on every pointer move. With thousands of objects this is slow.
- The whole scene repaints while one point is dragged, even if 499 of 500 objects did not change.
- The controller is one giant switch on mode numbers.
- Several features are hidden in dialogs (layers, hatching, captions). Few can be driven from text.
- The view animates the pan and zoom with its own timer, separate from the animation clock.
- The user cannot cycle through overlapping objects under the pointer; the top hit wins.

## 3. Coordinate systems

Four systems, all explicit in types so a mistake cannot compile.

| System | Unit | Origin and axes | Used for |
|---|---|---|---|
| **Maths** | 1 maths unit | Axes of the figure; x right, y up | Object values, `@view`, scripts |
| **View** | CSS pixel | Top-left of the canvas; x right, y down | Pointer events, hit tests, label offsets, layout |
| **Device** | Device pixel | Same as View, times `devicePixelRatio` | Canvas backing store |
| **Page** | CSS pixel | Top-left of the page | Screen-reader focus rectangles only |

```ts
// Branded numbers stop maths and pixel values being mixed.
type Maths = number & { readonly __space: 'maths' };
type Px = number & { readonly __space: 'px' };

interface MathsPoint { x: Maths; y: Maths }
interface PxPoint { x: Px; y: Px }

interface Viewport {
  readonly width: Px;          // canvas size in CSS pixels
  readonly height: Px;
  readonly originX: Px;        // pixel position of maths (0, 0)
  readonly originY: Px;
  readonly scaleX: number;     // pixels per maths unit on x, > 0
  readonly scaleY: number;     // pixels per maths unit on y, > 0
  readonly dpr: number;        // device pixel ratio
}

interface Mapper {
  toPx(p: MathsPoint): PxPoint;
  toMaths(p: PxPoint): MathsPoint;
  lengthPx(dxMaths: number, dyMaths: number): number;   // length of a maths vector on screen
  bounds(): { x0: Maths; x1: Maths; y0: Maths; y1: Maths };
}
```

Rules:

- A `Viewport` is immutable. Zooming makes a new one. Drawables read the viewport they were given; they never keep a mutable reference.
- `toPx` is `originX + x * scaleX` and `originY - y * scaleY`. The mapper is a pair of affine functions with no rotation in v1. A rotated view is not planned.
- **Precision.** Float64 holds 15 to 16 digits. Pixel positions are computed relative to the view's centre (the maths centre is kept as a separate double-double-free pair, `centreX`, `centreY`, and everything is `(x - centreX) * scaleX + width / 2`). That keeps points accurate when the figure is zoomed to a width of 1e-9 around 1e6. The view refuses to go below a width of `1e-10 * |centre|` (section 4).
- **Large coordinates.** Coordinates outside ±1e7 pixels are clipped before drawing; canvases misbehave beyond about 3e7. A segment from a visible point to a point at 1e12 is clipped to the view rectangle first (Liang-Barsky), then painted. Lines and rays are never stored as long segments; they are clipped to the view.
- **Text and widgets** may be anchored in View pixels instead of maths: `Text("hi", at = screen(12, 20))` sets an anchor that stays put when the view moves. Anchor is a union `{ space: 'maths', p } | { space: 'view', p, from: 'tl' | 'tr' | 'bl' | 'br' }`. The Text command is owned by the language area; we only require the anchor union.

## 4. Zoom, pan and the view

### State

```ts
interface ViewState {
  readonly viewport: Viewport;
  readonly ratioLock: 'free' | 'equal';       // equal keeps scaleX === scaleY
  readonly limits: { minWidth: number; maxWidth: number };   // maths units
  readonly home: { x0: Maths; x1: Maths; y0: Maths; y1: Maths };  // what @view set last
}
```

### Setting the view from text

```text
@view -5 5 -3 3                 # fit this region; ratio is whatever fits
@view -5 5 -3 3 equal           # fit the region, then widen the shorter axis so units are equal
@view 0 10 0 1 free             # let x and y scales differ (a graph of a probability)
@view -5 5 -3 3 over 0.8        # tween over 0.8 s of film time (or UI time outside a film)
@view home                      # return to the last @view without a tween
```

- `equal` adjusts the **shorter** axis range outward so the whole requested box stays visible. The directive never crops what the author asked to see.
- With no option the ratio mode is unchanged (initially `equal`).
- `over s` is a view tween (4.4). If a film seeks, the tween is pure: the view at `t` is a function of the beat's start `t0`, so seeking is exact.

### Pointer controls

| Gesture | Effect |
|---|---|
| Drag background (move tool) | Pan. Kinetic coast on release (touch and trackpad only), respects reduced motion. |
| Wheel / trackpad scroll | Zoom about the pointer by a factor per notch (default 1.1 per 100 wheel units; smooth for trackpads using `deltaY`). Ctrl+wheel or pinch always zooms; plain scroll over a page-embedded view does not capture the page scroll unless the view is focused. |
| Pinch | Zoom about the midpoint, and pan with the midpoint's drag. |
| Double-click background | Zoom in 1.5x about the pointer. Shift+double-click zooms out. |
| Drag on an axis | Rescale that axis only (switches the ratio lock to `free` until reset). |
| Keyboard | `+` / `-` zoom about the centre, arrows pan by 10% when nothing is selected, `0` or `Home` returns to `home`. |
| Rectangle zoom | A tool (see tools-2d). |

### Zoom maths

Zoom about a fixed pixel `p` by factor `k > 1` (zoom in):

1. Maths point under the pointer before: `m = toMaths(p)`.
2. New scales: `scaleX' = clamp(scaleX * k)`, `scaleY'` likewise (both with the same `k`, so a free ratio is kept).
3. New origin so `m` stays under `p`: `originX' = p.x - m.x * scaleX'` (and y likewise).

The clamp keeps `width / scaleX` inside `limits`. Default `minWidth = 1e-9`, `maxWidth = 1e9`, together with the relative-precision rule of section 3. When a clamp stops a zoom, the view shows a brief toast and the change is not applied; it is not an error object, since this is gesture feedback.

### Tweens

- A tween interpolates the **log of the scales** and the maths centre linearly, so zooming looks even. Ease: `smooth(x) = x * x * (3 - 2 * x)`.
- Duration default 0.35 s (UI) or whatever `over` says. With `prefers-reduced-motion`, the view jumps.
- A tween is one entry in the per-frame update; it reuses the frame loop of the player (see `../animation-time/`), not a second timer. Two tweens never run at once: a new one starts from the current viewport.
- During a tween, the grid and axes redraw each frame (cheap); scene drawables that depend on the viewport (functions, lines, labels) are marked dirty by the viewport change only if their geometry depends on it (see 7.2).

### Reset

`home` is set by every `@view` directive. The "home" button restores it with a tween. If no `@view` has ever run, `home` is the default region `-8 8` on x with `equal` ratio and y centred at 0.

## 5. Grid and axes

### Directives

```text
@axes on | off | x | y            # which axes to draw
@axes labels on | off             # numbers along the axes
@axes unit x pi | y 0.5           # tick unit on an axis; pi gives multiples of pi
@grid on | off
@grid major | minor | polar | iso # kind (default major; minor draws sub-lines too)
@grid step 0.5                    # fix the spacing (default: automatic)
@background rgb(255, 255, 255)
```

Not in v1: log axes (planned, section 5.5), numeric-format options beyond significant digits.

### Choosing spacing (automatic)

Goal: major lines about `targetPx = 80` apart (screen minimum `45`, maximum `160`).

1. `raw = targetPx / scale` in maths units.
2. `mag = 10^floor(log10(raw))`; `m = raw / mag`.
3. `step = mag * (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10)`.
4. Minor lines: for a step beginning with 1 or 5 use 5 sub-intervals, for 2 use 4. That keeps all minor lines on "round" numbers.
5. Axes with a `pi` unit use steps from `pi/6, pi/4, pi/3, pi/2, pi, 2pi, ...` chosen by the same pixel target.
6. Hysteresis: the step changes only when the spacing leaves `[45, 160]` px, so zooming does not flicker between steps.
7. x and y steps are chosen separately when the ratio is free.

### Labels on axes

- Format with the fewest digits that distinguishes neighbouring ticks: `digits = max(0, ceil(-log10(step)))`. Use thousands separators off; use `1e6` style above 1e6 or below 1e-4.
- Never print `-0`. Never print a label for the origin on both axes; print one `0` at the corner.
- Labels move to stay on screen when an axis is near the edge (pinned to the nearest edge with a faint rule), as an improvement over labels that vanish.
- Tick label collision: if two labels would overlap by measured width, drop every second label.

### Polar and isometric grids

- Polar: circles at the major step, spokes every 30 degrees by default (`@grid polar spokes 15`).
- Isometric: lines at 0, 60, 120 degrees with spacing derived from the same step.

### 5.5 Log axes (later)

Reserve `@axes y log`. The mapper would take a per-axis `transform: 'linear' | 'log10'`. We keep the `Mapper` interface free of that for v1; the implementation can be added behind it.

### Drawing cost

Grid and axes are drawn on their own canvas. They are redrawn only when the viewport, grid, axes or background changes. At 80 px spacing, a 1920x1080 view has about 50 lines.

## 6. Drawables

A drawable turns one object into screen geometry and paints it. It is an object per kernel object, owned by the view.

```ts
type PaintKind =
  | 'region' | 'curve' | 'line' | 'segment' | 'vector' | 'arc' | 'angle'
  | 'point' | 'text' | 'widget' | 'particles' | 'image';

interface Drawable<O extends KernelObject = KernelObject> {
  readonly id: ObjectId;
  readonly kind: PaintKind;
  readonly rank: number;                    // type rank, section 8
  readonly bbox: PxRect | null;             // screen bounds of what it paints (with line width and label)
  /** Recompute geometry from the object's value and the viewport. Returns false when nothing to draw. */
  update(obj: O, view: Viewport, style: ResolvedStyle): boolean;
  paint(s: Surface, ctx: PaintContext): void;
  /** Hit test, in view pixels. Returns null on miss. */
  hit(p: PxPoint, slack: number): HitCandidate | null;
  /** For `Highlight`, selection halos and focus rings. */
  outline(s: Surface, mode: 'hover' | 'selected' | 'focus' | 'pulse'): void;
  describe(): string;                       // screen-reader text, section 15
}
```

### One surface interface

```ts
interface Surface {
  save(): void; restore(): void;
  transform(m: Affine): void;
  clipRect(r: PxRect): void; clipPath(p: PathData): void;
  path(p: PathData): void;
  stroke(st: StrokeStyle): void;
  fill(f: FillStyle): void;
  text(t: TextRun, at: PxPoint, st: TextStyle): void;
  image(img: ImageSource, dest: PxRect, opacity: number): void;
  measure(t: TextRun, st: TextStyle): TextMetrics;
}

type PathData = Float32Array | readonly PathCommand[];   // typed array for big curves
```

Implemented by `CanvasSurface` (screen, offscreen), `SvgSurface` (export) and `RecordSurface` (tests: records calls for golden checks). WebGL particles and large point clouds bypass the interface and draw through their own layer (see `../animation-time/`).

### One drawable per object, by object type

| Object type | Drawable | Paints |
|---|---|---|
| Point | `PointDrawable` | marker (shape, size, outline) + label |
| Vector | `VectorDrawable` | shaft + head + label; head size scales with width |
| Segment, Ray, Line | `LineDrawable` | clipped to view; end caps; optional tick marks and arrows (style) |
| Circle, Arc, ellipse, any conic | `ConicDrawable` | polyline approximation chosen by screen radius, or arcs where the surface supports them |
| Polygon | `PolygonDrawable` | fill + edges; vertex list in maths, so a degenerate polygon draws nothing |
| Function, Curve (implicit/parametric) | `CurveDrawable` | strokes from the plotter (functions-calculus and curves-loci own the algorithms; the drawable calls `plot(range, viewport) -> PathData[]` and caches by `(object version, viewport key)`) |
| Region, area, Riemann bars, inequalities | `RegionDrawable` | fills; clips to view; may have an outline |
| Angle | `AngleDrawable` | arc or right-angle square, fill, label with value |
| Text | `TextDrawable` | text/maths layout, with `{expr}` updates |
| Slider (free Number with range) | `SliderDrawable` | track, thumb, label, in View pixels (anchored), see ui.md |
| Check box (Bool), button, input (controls-scripting owns semantics) | `WidgetDrawable` | DOM overlays or canvas shapes; hit region; focus ring |
| Particles | `ParticleDrawable` | handled by the particle renderer |
| Image | `ImageDrawable` | bitmap with corners |
| Trace | `TraceDrawable` | trace polyline(s) owned by the view (animation-time) |

All curves, regions and conics store their shapes as `Float32Array` of x,y pairs in **view pixels** to avoid per-frame conversion; a bounding box is calculated once per update.

### What a drawable guarantees

- `update` is pure in `(object value, viewport, resolved style)`: same inputs, same geometry. This is what makes golden tests and export match the screen.
- An object with an undefined value, a `visible = false`, or a show-if that is false has no drawable geometry. The drawable reports `bbox = null`, so hit testing, selection and export skip it. It keeps its slot, so becoming defined again is instant.
- The drawable never reads the kernel or changes it. It receives value, style and viewport as arguments.

## 7. Painting

### 7.1 Event flow

```ts
type KernelEvent =
  | { kind: 'add'; ids: ObjectId[] }
  | { kind: 'update'; ids: ObjectId[] }          // value changed (one frame's changed set)
  | { kind: 'remove'; ids: ObjectId[] }
  | { kind: 'restyle'; ids: ObjectId[] };
```

- `add` creates drawables and inserts them into the draw list at their sort position (binary search by sort key).
- `update` marks drawables **dirty**. No geometry is computed yet.
- `remove` drops drawables and marks the area they covered (their last bbox) as damaged.
- `restyle` re-resolves the style (7.3) and marks dirty.
- The viewport changing marks **all** drawables viewport-dirty (7.2).

### 7.2 Dirty kinds

Two flags per drawable:

- `valueDirty`: the object changed. Geometry must be rebuilt.
- `viewDirty`: the viewport changed. Only drawables whose geometry depends on the viewport rebuild: lines and rays (clipping), functions and curves (sample range), conics (point count), labels (layout), anything with pixel-sized parts. Maths-anchored polygons, segments and points rebuild by a cheap map from maths to pixels.

A cheap rule: pan only (same scale) needs only the translation. The view shifts the cached pixel arrays by `(dx, dy)` and marks only the clip-dependent ones dirty. A zoom marks all.

### 7.3 Batching

- The scheduler has one flag `pending`. The first dirty mark of a frame requests `requestAnimationFrame(frame)`. Later marks in the same frame do nothing.
- When the **player** is running, the frame callback is the player's own: kernel update, then view update and paint in one callback, in that order, so labels and geometry never lag the values.
- A frame has three phases: **update** (rebuild dirty drawables, in draw order), **layout** (labels, see 9.7), **paint**.
- Budget: update + layout + paint for 500 mixed objects under 6 ms on a mid-range laptop (the kernel pass is separate and under 4 ms). If a frame overruns three times in a row, the view lowers curve resolution by one level (max 2 levels) and raises it again after 30 good frames. It never drops frames of the clock; the clock is time, not frame count.

### 7.4 Partial repaint with cached layers

Painting everything while one point moves is wasteful. We use three canvases plus a cache:

1. **Background canvas**: background, grid, axes. Redrawn on view changes only.
2. **Scene canvas**: all drawables in draw order.
3. **Overlay canvas**: hover, selection halos, focus ring, snap indicators, tool previews, drag handles, the rubber band, `Highlight` pulses. Redrawn every interaction frame. Never costs more than a few shapes.

When an interaction starts (a drag, or a player run with a small active set), the view splits the draw list around the **active drawables** (the ones that are dirty each frame; for a drag, the dragged object and its downstream list):

- `lower` = every drawable sorted before the first active one.
- `upper` = every drawable sorted after the last active one.
- `middle` = everything between (includes active ones and some static ones).

`lower` and `upper` are painted once to offscreen bitmaps and then composited each frame; only `middle` is painted live. If an active drawable is early and another is late (middle is nearly everything), the split is not worth it, and the view repaints fully. It chooses by comparing counts: use the split when `middle.length <= 0.5 * all.length`.

Expected result: dragging one point in a 500-object figure paints about 20 objects per frame, not 500.

Bitmaps are invalidated by any viewport change, any restyle of a cached drawable, or an add/remove that touches `lower` or `upper`.

### 7.5 Culling and level of detail

- A drawable whose `bbox` does not intersect the viewport is not painted.
- Curves reduce points: the plotter returns its own adaptive set; the drawable also applies a pixel tolerance of 0.3 px using Ramer-Douglas-Peucker on the typed array when the point count exceeds 4 per pixel of path length.
- Points with sizes below 1 px are skipped; text under 4 px is skipped.

### 7.6 Damage and DPR

- `devicePixelRatio` changes (moving to another monitor, browser zoom) rebuild all three canvases. The viewport does not change in CSS pixels.
- Lines of width 1 are snapped to half pixels in device space for sharpness: `x = round(x * dpr - 0.5) + 0.5` is applied to axis-aligned segments only.

## 8. Layers and draw order

- **Layers** are integers `0..9`, default `0`. Higher layers are drawn later (on top). The cap of ten is enough for lessons; it keeps the sort key small.
- **Sort key** per drawable: `(layer, rank, order)`.
  - `rank` by type, low to high:

| Rank | Types |
|---|---|
| 0 | Images (background kind) |
| 1 | Regions, polygons' fills, angle fills, inequalities |
| 2 | Functions, curves, conics, circles, arcs |
| 3 | Lines, rays, segments, vectors |
| 4 | Angle marks and arcs (strokes), tick marks |
| 5 | Points |
| 6 | Texts and labels |
| 7 | Widgets (sliders, check boxes, buttons, inputs) |

  - `order` is the kernel object's `order` field (creation order, always a valid dependency order). Redefining an object may move it later in `order` (core design); the draw order follows.
- **Labels** are painted after all drawables of their layer in a text pass, so a label is never hidden by a later line in the same layer. A label of a layer-5 point can still sit under a layer-6 shape.
- **Per-object control**: `A with layer = 3`. A shortcut `Front(A)` / `Back(A)` action is not part of the script language; the UI uses the same `layer` property plus reorder within `order`.
- **Overlays** (hover, selection, preview) are always above everything.
- Particles are placed by their layer like other objects, with `rank = 5` (between lines and texts) by default; their GPU layer is inserted as a canvas element between the scene canvas halves, see animation-time.

Weakness of the layer approach: layers are global. Two figures in one view cannot interleave. We accept that; sub-figures are handled by `order`.

## 9. Styles

### 9.1 The style record

```ts
interface ObjectStyle {
  color?: ColorValue;             // stroke / marker colour
  opacity?: number | NumberRef;   // 0..1 for stroke (default 1)
  width?: number | NumberRef;     // px, 0.5..20 (default by type)
  dash?: DashPattern;             // see 9.3
  pointStyle?: PointShape;        // 9.4
  pointSize?: number | NumberRef; // px radius 1..20 (default 4)
  fill?: number | NumberRef;      // fill opacity 0..1 (default by type)
  fillColor?: ColorValue;         // fill colour (default = colour)
  hatch?: HatchSpec | 'none';     // 9.5
  label?: LabelMode;              // 9.7
  caption?: TextRef;              // 9.7
  layer?: number;                 // 0..9
  show?: boolean | BoolRef;       // show-if
  fixed?: boolean;                // cannot be dragged
  selectable?: boolean;           // default true
  trace?: boolean;                // see animation-time
  arrow?: ArrowSpec;              // vectors, segments, lines: heads at ends
  marks?: number;                 // 0..3 equal-length ticks on a segment
  angleStyle?: 'arc' | 'square' | 'dot';
  textStyle?: TextStyleSpec;      // size, bold, italic, family, align, background
}

type ColorValue = Color | ColorRef;      // Color literal or a Color-valued object / formula
```

Anywhere a number or colour is allowed, an object name or formula works, so colour and size can depend on sliders and `t`:

```text
P with color = hsl(360 * a / 10, 80, 50), size = 4 + 2 * sin(t)
```

The style value is resolved **per frame** by the view (the style holds references; the view evaluates them as part of `update`). References are tracked as dependencies in the kernel so a restyle value that changes marks the object `restyle`-dirty without touching its maths. Core design change C1 below.

### 9.2 Colour

- Literals: named colours (`red`, `blue`, `green`, `orange`, `purple`, `black`, `grey`, `white`, `teal`, `pink`, `brown`, and their `light`/`dark` forms), `rgb(r, g, b)` 0 to 255, `hsl(h, s, l)`, `#rrggbb`, with alpha `rgba(...)` or `hsla(...)`.
- Palette defaults are in `ui.md`. They pass 3:1 contrast against white and against the dark background for strokes.
- Dynamic colours: any Color-valued formula.
- Colour space: sRGB. A `Gradient(x, c0, c1, ...)` function interpolates in linear light and returns sRGB.

### 9.3 Line style

```ts
type DashPattern = 'solid' | 'dashed' | 'dotted' | 'dashdot' | { on: number; off: number } | readonly number[];
```

- Named dashes scale with width: `dashed = [4w, 3w]`, `dotted = [w, 2w]` (round caps) and `dashdot = [4w, 2w, w, 2w]`, with a floor of 1 px.
- Phase can be animated: `with dashPhase = -t * 20` makes marching ants (a cheap, readable "direction of flow").
- Caps: butt for open dashes, round for dotted. Joins: round for curves, miter limit 4 for polygons.

### 9.4 Point style

```ts
type PointShape = 'dot' | 'ring' | 'cross' | 'plus' | 'diamond' | 'diamond-open' | 'square'
                | 'square-open' | 'triangle-up' | 'triangle-down' | 'triangle-left' | 'triangle-right';
```

- `dot` has a 1 px outline in the stroke colour and a fill of the same colour at 60% lightness change, which keeps overlapping points readable.
- `ring` is open with 2 px stroke. `cross` is an x; `plus` is +.
- Free points and dependent points have **different default colours** (section ui.md): the colour alone tells a learner what they may drag, and the shape does not change.
- Size is a radius in px (1 to 20, default 4). Touch devices draw the hit area at `max(r, 12)` px without changing the drawn size.

### 9.5 Fill and hatching

- `fill` is the opacity of the fill colour, 0 to 1. Default `0.15` for polygons, regions and conic interiors; `0` for others.
- `hatch` replaces the solid fill with a pattern drawn inside the shape clip:

```ts
type HatchSpec =
  | { kind: 'lines'; angle: number; spacing: number; width?: number }
  | { kind: 'cross'; angle: number; spacing: number; width?: number }
  | { kind: 'dots'; spacing: number; radius?: number }
  | { kind: 'grid'; spacing: number; width?: number }       // chessboard-like
  | { kind: 'honeycomb'; spacing: number }
  | { kind: 'weave'; spacing: number }
  | { kind: 'bricks'; spacing: number }
  | { kind: 'image'; src: AssetRef; mode: 'tile' | 'stretch' };
```

  Script forms: `with hatch = lines(45, 8)`, `hatch = cross(0, 10)`, `hatch = dots(6)`.
- Patterns are in **view pixels** (spacing 4 to 40) so a zoom does not make them dense or sparse. Patterns are built once into an offscreen `CanvasPattern` per `(spec, colour, dpr)` and cached. In SVG export they become `<pattern>` elements.
- Hatch angle is rotated so lines meet the shape's edge at the author's angle regardless of the page rotation (no page rotation, so the literal angle is used).

### 9.6 Opacity

Three separate opacities, to keep colours readable under overlap:

| Property | Applies to | Default |
|---|---|---|
| `opacity` | Stroke and marker | 1 |
| `fill` | Interior | per type |
| `labelOpacity` | Label | 1 |

`alpha` is not combined: setting `opacity` never changes `fill`. A group opacity (stroke+fill as one layer, so fill and stroke do not double-darken where they overlap) is available with `with group = 0.5`.

### 9.7 Labels and captions

```ts
type LabelMode = 'none' | 'name' | 'value' | 'name-value' | 'caption';
```

- Default: `name` for points, lines, circles, vectors, angles (as the Greek letter); `value` for numbers and angles when they show a readout; `none` for polygons, regions and curves.
- `caption` shows the object's `caption` Text, which can contain `{expr}` and `$maths$`: `A with caption = "A: {A.x}"`.
- **Placement**: each label has a preferred offset (default up-right of a point, along the normal of a line, at the midpoint of a segment) and a user offset (the learner can drag a label; the offset is stored in the style as view-pixel `labelDx`, `labelDy`, so it survives zooming).
- **Auto placement** runs in the layout phase: for each label without a user offset, try 8 candidate positions around its anchor, score by overlap area with already-placed labels and with point markers within 6 px, choose the lowest score. A label that fit last frame keeps its position unless the score gets worse by more than 25% (hysteresis against flicker). Cost bound: only labels in the viewport; at most 200 labels auto-placed per frame, the rest keep the last position.
- Text of labels is cached as measured runs. Maths labels (`$...$`) use the maths layout of the text area.
- `Highlight(obj, seconds)` draws a halo on the overlay and optionally enlarges the label.

### 9.8 Show-if

`with show = a > 2` is a Bool formula. Hidden objects are in the kernel (they still compute) but have no geometry. `Hide(A)` sets `show = false`. If both exist, the object is shown only when `Show` was not the last cancel (the most recent of the two wins; `Show` clears a `show` formula). To avoid ambiguity the checker rejects `Show(A)` when A has a formula show-if (`conflicting_style`, see errors.md); the author uses `A with show = true`.

### 9.9 Default style by type

Per-type defaults come from a table in the view package (data, not code), so themes can change them. See `ui.md` for values.

## 10. Hit testing

### 10.1 Candidates

```ts
interface HitCandidate {
  readonly id: ObjectId;
  readonly part: 'body' | 'edge' | 'fill' | 'label' | 'handle' | 'thumb';
  readonly distance: number;           // px from the pointer to the nearest part of the shape
  readonly priority: number;           // from the type rank table below
  readonly param?: number;             // for edges: the path parameter of the nearest point
}

interface HitList {
  readonly at: PxPoint;
  readonly candidates: readonly HitCandidate[];   // already sorted, best first
}
```

### 10.2 Slack

| Pointer | Point markers | Line-like edges | Fill |
|---|---|---|---|
| Mouse | radius + 3 | 3 | inside |
| Pen | radius + 5 | 5 | inside |
| Touch | max(radius, 12) + 4 | 12 | inside |

Hover uses the mouse slack. Slack is added in px and measured in view pixels, so it does not change with zoom.

### 10.3 Index

A uniform grid of 64 px cells over the canvas stores drawable ids by the cells their `bbox` overlaps. Updating a drawable removes it from old cells and inserts into new ones. A query reads one cell (plus neighbours if slack needs them), then calls `hit` on those few drawables. Rebuilt lazily after viewport changes (cost O(n)); incrementally on object change. A figure of 5,000 objects answers a query in under 0.2 ms.

Lines and rays have a bbox equal to the clip of the infinite object to the view; they fall in the cells along their path.

### 10.4 Ranking

1. Sort by `priority` ascending (lower wins): label 0, slider thumb/handle 0, point 1, text/widget 2, edge 3 (segment, line, circle edge, curve), fill 4 (polygon, region, conic interior), image 5.
2. Among equal priority, smaller `distance` wins.
3. Among equal distance, the later in draw order (on top) wins.

A point on a line sits above the line. A line over a polygon fill wins when its edge is within slack. Clicking inside a polygon away from its edges picks the polygon.

### 10.5 Cycling

Repeating a click at the same pixel (within 3 px, within 800 ms) steps to the next candidate. A tooltip shows `1 of 3: A, a, c`. Keyboard users get the same through Tab order. This fixes the weakness of picking only the top hit.

### 10.6 Tool filtering

Tools pass a filter `{ types: TypeName[]; parts?: Part[]; exclude?: ObjectId[] }` to the index; candidates that don't match are dropped before ranking. See `../tools-2d/design.md` section 4.

### 10.7 Exactness

- Segment: point-to-segment distance. Line and ray: the same with the clip.
- Circle and conic: the distance in pixels to the nearest of the polyline points, then refined by a perpendicular-distance step on the best segment (not the vertex distance alone).
- Curves and functions: the same on the cached polyline in pixels. The polyline is a faithful drawing, so what the user can see is what they can hit.
- Polygon fill: even-odd point-in-polygon test in pixels. Region fills: the same on their outline polygons, including holes.
- Text: its measured rectangle, expanded 2 px.

## 11. Selection

- **State**: lives in the view, not the kernel: `{ ids: Set<ObjectId>, anchor: ObjectId | null, focus: ObjectId | null }`.
- **Operations**: click selects the top candidate; click on empty space clears; shift or ctrl/cmd toggles; rubber band selects objects whose bbox intersects the band (drag with the select tool, or shift-drag with the move tool); `Ctrl+A` selects all visible selectable; `Esc` clears.
- **Rubber band** rule: an object is included if its shape intersects the band; fills count only if their edge crosses the band or the band lies inside (a band inside a big polygon would select it by accident otherwise, so inside-only does not select).
- **Selection effects**: a halo on the overlay; the style bar shows the common style of the selected objects; `Delete` removes them (one undo step).
- **Locked**: objects with `selectable = false` are skipped in all selection; `fixed` objects are selectable but not draggable.
- **Group edits**: style changes on a selection generate one `with` line per object in a batch (one undo step).
- Selection is **not part of the figure** and is not saved or replayed. It is reported to the teacher as a learner event (agent.md).

## 12. Dragging

### 12.1 What can be dragged

| Target | Drag does | Kernel action |
|---|---|---|
| Free point | Moves to the pointer (with snap) | `setFree(id, value)` |
| Point on a path (`PointOn`) | Pointer is projected onto the path | `setFree(id.parameter, s)` |
| Slider thumb | Moves along the slider track; value is quantised to `step` | `setFree(id, value)` |
| Free number with no range | not draggable | |
| Dependent point (e.g. `Midpoint`) | not draggable in v1 | |
| Shape built from free points (segment, line, ray, vector, polygon, circle by centre and a point, angle) | Translates the free points it was built from by the pointer delta | `setFree` for each free point |
| Shape with computed dependents (a tangent, an image) | not draggable | |
| Text with a free anchor | Moves the anchor | |
| Label | Changes the label offset in the style | `restyle` |
| Background | Pans the view | none |

The rule in the core design (Open Question 2) is answered here: dependent shapes are draggable only when **all** their inputs are either free points or numbers that are free, **and** moving those points keeps the shape's own definition valid. A segment through `A`, `B`: both move by the same delta. A `Midpoint(A, B)`: not draggable (it would need a rule to choose). A circle `Circle(A, 2)`: moves `A`. A circle `Circle(A, r)` where `r` is a number: moves `A` (the number is left alone). `Translate(A, v)` is not draggable (its parent point is not what the learner points at).

The set of free points to move for an object is called its **drag plan**:

```ts
interface DragPlan {
  readonly kind: 'free' | 'path' | 'slider' | 'parents' | 'label' | 'none';
  readonly moves: readonly { id: ObjectId; role: 'point' | 'parameter' | 'number' }[];
  readonly reason?: string;           // when 'none': why (for a tooltip: "built from a midpoint")
}
```

The plan is computed from the kernel's dependency graph when the object is added, redefined or when the graph changes (cached; not on each drag).

### 12.2 Pointer lifecycle

1. `pointerdown`: hit test; choose the top candidate that has a drag plan other than `none`; if only non-draggable hits exist, start a **pan** (not a drag) and show a hint on the first attempt.
2. After `3 px` movement (mouse) or `8 px` (touch), the drag begins: the view captures the pointer.
3. On each `pointermove`, compute the target, ask `kernel.dragPlan(id, target)` for the plan and call `kernel.drag(plan)`. This updates only the free values and marks the downstream list; the next frame processes it. Moves coalesce: only the latest pointer position per frame is applied (`getCoalescedEvents` is used to read the rest for smoothness of traces).
4. `pointerup`: commit. A single batched script record is made: for a free point `A = (x, y)` with rounded display digits (see 12.6); for several points, one line each, one undo step.
5. `Esc` during a drag cancels and restores the values at drag start.

### 12.3 Free point

`target = snap(toMaths(pointer) - grabOffset)`. `grabOffset` is the maths vector between the pointer at pointerdown and the point's position, so the point does not jump to the cursor.

### 12.4 Point on a path

The path object provides a projection:

```ts
interface PathProjector {
  /** Nearest point on the path to `p`, with its parameter. `hint` is the previous parameter. */
  project(p: MathsPoint, hint: number | null, metric: PixelMetric): { s: number; point: MathsPoint };
  readonly closed: boolean;
  readonly domain: { lo: number; hi: number };
}
```

Parameters (answers a gap in the core design): `PointOn(path, s)` takes `s` with this meaning per path type:

| Path | `s` | Range |
|---|---|---|
| Segment | fraction from first to second point | 0..1 (clamped) |
| Ray | distance from the start in maths units | 0..∞ |
| Line | signed distance from the first defining point along the direction | −∞..∞ |
| Circle, ellipse, closed conic | fraction of full turn from a conventional start (right-most point for circles) | 0..1, wraps |
| Arc | fraction from start to end | 0..1 (clamped) |
| Polygon | fraction of perimeter length | 0..1, wraps |
| Function `f` | `x` | the function's domain |
| Curve | the curve's own parameter | its range |

Projection:

- **Line, ray, segment, circle, ellipse, polygon:** closed-form. For circles, `s = atan2(...)/2π`; for a polygon, nearest edge and the arc-length position.
- **Function and curve:** sample the visible range at 2 px steps in pixels using the drawable's cached polyline for a coarse nearest point, then refine by golden-section search on the squared **pixel-space** distance within ±1 sample. Accuracy target: 0.05 px; cost under 0.2 ms.
- **Continuity:** if `hint` is given and the new nearest point is within 24 px of the hinted point in pixels along the path (for example the other branch of a hyperbola would be a jump), the search is limited to a window around the hint. A jump larger than the window is allowed only if the pointer has moved more than 60 px from the current position (the user is deliberately going somewhere else). This stops a point flipping to another side when the pointer crosses a path's self-intersection.
- **Closed paths** wrap `s` into `[0, 1)`. The drag takes the shortest wrap difference so it does not spin.
- If the path is undefined, the point is undefined and cannot be dragged (plan kind `none`, reason `path_undefined`).

### 12.5 Dependent shapes: moving parents

Plan kind `parents`. The pointer delta in maths is applied to each free point in `moves`. Snap applies to the **grabbed point** of the shape (nearest vertex or the pointer's own position), not to each vertex separately, so the shape keeps its form.

If moving by the delta would make any dependent undefined for the pointer's last position (a polygon is a polygon always, so rare), the update still applies; undefined objects are hidden for that frame like during any other change.

### 12.6 Rounding on commit

A drag sets values to full precision for smooth motion. The script line saved on `pointerup` rounds to the displayed precision of the view: the number of digits implied by the pixel size (`ceil(-log10(1 / scale)) + 1`). A point dragged at 80 px per unit saves `A = (1.234, 2.5)`, not `A = (1.23400000000001, 2.4999999999)`. This keeps the saved script readable for a model.

### 12.7 Keyboard

With an object focused: arrow keys move a free point by one `nudge` (1 px, or the grid step when snapping is on; shift = 10 times; alt = 0.1 times). Slider: arrows change by `step`, `PageUp` / `PageDown` by 10 steps, `Home` / `End` to the ends.

### 12.8 Speed target

Pointer event to painted frame: under 16 ms for the whole path including the kernel pass at 500 objects (kernel under 4 ms, update and paint under 6 ms, leaving room). A drag never blocks on a text log or storage.

## 13. Snapping

### 13.1 Modes

```text
@snap off | grid | points | auto
```

- `off`: no snapping.
- `grid`: snap to the nearest grid line intersection of the **major** (and minor if drawn) grid.
- `points`: sticky to existing points and intersection candidates.
- `auto` (default): grid if the grid is visible, otherwise `points`.

Both can be combined by `grid+points`. Alt/option held during a drag temporarily switches snapping off. Shift limits angle to 15 degrees when dragging relative to an anchor (for example the second point of a segment).

### 13.2 Snap algorithm

Inputs: candidate maths position `p`, the viewport.

1. Convert `p` to pixels.
2. **Points**: from the hit index, take points within `snapRadius = 12 px` (touch 20), excluding the dragged object and its descendants. If one exists, return the closest, with `source = point(id)`.
3. **Intersections**: if `points` mode is on, check pair intersections of objects under the pointer (the hit list at that spot has at least two edges): candidate intersection positions come from the same function the Intersect tool uses. Return the closest within radius.
4. **Grid**: nearest multiples of the active step; accept if the pixel distance to the grid point is within 12 px (touch 20).
5. Otherwise no snap.

The result has `{ position, source }`. The overlay draws a ring and a small label such as "on B" or "grid". A snap to a point during a drag of a free point does not create a dependency in the kernel (it sets coordinates). A snap during **tool placement** can choose an existing point, which the tool then uses by name (tools-2d).

### 13.3 Hysteresis

Once snapped to a target, stay snapped until the pointer leaves `snapRadius * 1.5`. This stops a jitter at the boundary.

### 13.4 Snap and drag plans

A path-dragged point snaps **along** the path: grid snap picks the nearest grid intersection that lies on the path within 12 px, otherwise no snap. We never project away from the path to satisfy a snap.

## 14. Export

### 14.1 Targets

```ts
type ExportFormat = 'png' | 'svg' | 'script';

interface ExportRequest {
  readonly format: ExportFormat;
  readonly region: 'view' | 'objects' | { x0: number; x1: number; y0: number; y1: number };
  readonly size?: { widthPx: number; heightPx?: number };    // output pixels (png), nominal size (svg)
  readonly scale?: number;               // png multiplier (1, 2, 3)
  readonly background: 'view' | 'transparent' | Color;
  readonly layers?: 'all' | readonly number[];
  readonly includeGrid: boolean;
  readonly includeAxes: boolean;
  readonly time?: number;                // film time to render at; default: current t
  readonly textAs: 'text' | 'paths';     // svg only
}
```

### 14.2 Pipeline

1. Pick the region. `objects` is the union of the bboxes of visible drawables, padded by 5% (minimum 12 px).
2. Build a fresh `Viewport` for the output size. Aspect ratio follows the region; `equal` is kept if the source view has `equal`.
3. If `time` differs from the kernel's `t`, ask the player for a **snapshot at time**: it evaluates the figure at `t` in a scratch copy of the values (the kernel's pure rules and solver checkpoints). The live figure is not changed.
4. Run `update` on every drawable with the export viewport, then `paint` through the chosen `Surface`.
5. `png`: `CanvasSurface` on an `OffscreenCanvas` at `size * scale`; then `convertToBlob`. Max side 16,384 px; larger is an error `limit`.
6. `svg`: `SvgSurface`. Curve paths are emitted as `<path d>` with 2 decimals; hatch patterns as `<pattern>`; clip regions as `<clipPath>`; labels as `<text>` (`textAs: 'text'`) with a family stack, or as outlines (`'paths'`) for exact sharing; maths text is converted by the maths layout into paths always. IDs are the object names so an author can post-edit.
7. `script`: the figure's `toScript()`.

### 14.3 What is excluded

Overlay content (selection, hover, previews), DOM widgets (buttons, inputs; sliders are drawn as shapes so they are included when `includeWidgets` is on, default off), and the player UI.

### 14.4 Particles and traces in export

- Traces export as polylines at the target time.
- Particles: SVG gets up to 5,000 `<circle>`/`<rect>` elements sampled at `time` (sorted by index; if count is larger, the first 5,000 get the same visible density by a size and opacity multiplier computed from `count / 5000`); PNG draws on the canvas with the CPU renderer so the result is deterministic.

### 14.5 Determinism

Same script, same `t`, same export request gives the same bytes (SVG) and the same pixels (PNG, CPU path), assuming the same fonts. A golden test in the repo renders a fixture figure to SVG and compares text.

## 15. Accessibility of the canvas

- The canvas has `role="application"`, an accessible name ("Figure, 12 objects"), and `aria-describedby` pointing at a summary.
- **Hidden object list**: a visually hidden `ul` is kept next to the canvas: one `li` per visible, selectable object, in creation order: `<li role="option" tabindex="-1" data-id="A">Point A at 1.5, 2. Free, can be moved.</li>`. It is updated only for changed objects and only in the update phase.
- **Descriptions** come from `Drawable.describe()`, shared with the `figure` tool's value summary so the model and the learner hear the same words:

| Type | Text |
|---|---|
| Point | `Point A at 1.5, 2. Free.` or `Point M at 3, 1. Midpoint of A and B.` |
| Segment | `Segment a from A to B, length 5.` |
| Circle | `Circle c centre O, radius 3.` |
| Function | `Function f of x equals x squared minus 2.` (with spoken form of the definition) |
| Slider | `Slider a, value 3, from 0 to 10 in steps of 0.1.` |
| Undefined | `Line l is undefined: the lines are parallel.` |
| Particles | `Particle system fire, 1,500 particles, moving upward.` (the author's `alt` text if given) |

- **Focus order**: Tab enters the figure once; arrow keys (left/right) move between objects in creation order; `Shift+Tab` leaves the figure. `Enter` or `Space` selects; arrows move a selected draggable object (12.7); `Ctrl+arrows` pan; `Esc` deselects. Focus ring is drawn on the overlay in 3 px high-contrast.
- **Live announcements**: a polite `aria-live` region speaks changes: "A moved to 2, 3" on drag end, "Segment AB is now length 5.1" for objects the learner has selected or focused, rate-limited to 1 per 800 ms during drags (the final value after the pause). The live teacher's speech and screen-reader speech are separate channels; if the player is speaking, announcements are queued after speech or suppressed by a user setting.
- **Alt text**: an optional `@alt "text"` directive sets the whole-figure alt text; objects take `with alt = "..."`.
- **Colour**: no meaning by colour alone; free and dependent points differ also by outline (free points have a ring halo). Hatches and dash types give non-colour distinctions. A "high contrast" theme and a colour-blind-safe palette are in `ui.md`.
- **Motion**: honours `prefers-reduced-motion` (no inertia, no view tweens, particles shown frozen at a still frame until the learner presses play).
- **Touch targets**: hit area at least 24x24 CSS px for handles and points.
- **Honesty**: a canvas cannot be made fully accessible with this alone. Full WCAG validation needs manual testing with assistive technologies and expert review.

## 16. Better than GeoGebra

- **Scripts can do everything the dialogs do**: layers, hatching, captions, show-if, dash phase, view tweens are all text, so a model can set them one line at a time.
- **Partial repaint** by splitting the draw list around the active set, so a drag in a 500-object figure paints about 20 objects.
- **Indexed hit testing** (grid index), not a loop over all drawables.
- **Cycling through overlapping hits** with a clear tooltip and a Tab order.
- **Typed coordinate spaces**, so maths and pixel values never mix by mistake.
- **Relative-to-centre pixel mapping** keeps deep zooms accurate.
- **Dynamic style** (colour, size, opacity, dash phase) can be formulas of sliders and `t`.
- **Same words for screen reader and model** (`describe`).
- **Drag plans are data**, computed once and shown as hints ("cannot move: built from a midpoint").
- **Seekable view tweens**, because they are pure functions of film time.
- **Deterministic export at any film time** without disturbing the live figure.
- **Saved drag results are rounded to what the learner could see**, keeping scripts readable.

## 17. Changes to the core design

| # | Change | Why |
|---|---|---|
| C1 | Extend the `with` property list (section 9.1) and let property values be formulas or object references. Tracked as dependencies so a restyle marks only the style dirty. | Colour, size and opacity that follow sliders and `t` are core to teaching animations. The core design lists only colour, width, label, layer, visibility. |
| C2 | Add directives `@snap`, `@axes` options, `@grid` kinds, `@background`, `@alt`, and the `equal` / `free` / `over` / `home` options of `@view`. | Section 4 and 5. Still one line each, still unambiguous from the first token. |
| C3 | Define `s` for `PointOn` per path type (section 12.4). | The core design says 0..1, which is meaningless for a line or a function. |
| C4 | Answer Open Question 2: dependent shapes are draggable via drag plans (12.1); other dependents are not. | Matches how learners expect shapes to behave, with a clear rule for the rest. |
| C5 | Add `kernel.dragPlan(id, target)`, `kernel.drag(plan)` and `kernel.commitDrag()`: a drag changes free values without parsing a line, then records one batched `A = (x, y)` line at the end. | Mouse moves at 60 Hz must not go through the line pipeline. |
| C6 | Add a dry run: `kernel.apply(line, { dryRun: true })` for one line and `kernel.applyBatch(lines, { group, dryRun: true })` for several, returning the value and type of the last line without committing. Used by tool previews and the playground. | `../tools-2d/design.md` section 5. |
| C7 | Grouped undo: a batch of lines is one undo step. | A tool or a drag that adds several objects is one action to the learner. |
| C8 | Results of a line may carry `warnings: Warning[]` beside `ok: true`. | Non-fatal issues (a style on a hidden object, conflicting show-if). See errors.md. |
| C9 | New error kinds `unknown_property`, `bad_property_value`, `conflicting_style`. | The `with` form needs its own failures. See errors.md. |
| C10 | `Highlight(obj, seconds)` is owned by the view (an overlay effect), not the kernel. It is not saved with the figure and not replayed by `toScript`, but a film beat records it as an event. | It is presentation, not state. |
| C11 | `Show` / `Hide` write the `show` style as a literal; a formula show-if is only changed by `with show = ...` (9.8). | Resolves the ambiguity between the two. |

## 18. Sources studied

GeoGebra source (read-only, commit 3608374), under `source/shared/common/src/main/java/org/geogebra/common/`:

- `euclidian/` (overview of the view, controller, drawable list, constants)
- `euclidian/EuclidianView.java` (draw list, zoom factors, capturing modes)
- `euclidian/EuclidianConstants.java` (tool mode list)
- `euclidian/Drawable.java`
- `euclidian/draw/` (list of drawable kinds)
- `euclidian/HitDetector.java`, `euclidian/Hits.java`
- `euclidian/SnapController.java`
- `euclidian/LayerManager.java`
- `euclidian/HatchingHandler.java`
- `euclidian/PathTracker.java`
- `euclidian/plot/` (list of plotting helpers)
- `main/App.java` (capturing threshold constants)
- `plugin/EuclidianStyleConstants.java` (layer limit)

Manual pages (https://geogebra.github.io/docs/manual/en/):

- `Graphics_View/`
- `Animation/` (for the style bar and view controls context)
- `Tools/` and `Tools_Menu/`
