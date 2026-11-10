# Functions and calculus: what the learner sees and does

Reads with `design.md`. The kernel has no UI; everything here lives in `packages/view`, driven by `packages/plot` output and kernel events.

## 1. Views and layout

One main **graph view** (2D, maths units). Functions, regions, points, lines and fields all draw there. Beside it, the **figure list**: a short column of the objects with their printed values (`f(x) = x³ - 3x`, `slope = -3`, `area = 2.667`). Sliders appear in the list or on the canvas near the object that uses them (`a = -2` with a thin track).

```text
┌───────────────────────────────────────────┬────────────────────────────┐
│  y ▲                                      │ f(x) = x³ − 3x       ◉     │
│    │      ╭╮              ╱               │ d(x) = 3x² − 3       ◉     │
│    │     ╱  ╲            ╱   ● P          │ a = −2   ───●────          │
│  ──┼────╱────╲──────────╱────────▶ x      │ slope = 9                  │
│    │   ╱      ╲        ╱ T (tangent)      │ I = 2.667   shade ▣        │
│    │  ╱        ╲______╱                    │ roots: −1.73  0  1.73      │
│    │                                       │ (1 undefined)  ⚠ show why │
└───────────────────────────────────────────┴────────────────────────────┘
```

On a phone the list is a bottom sheet that opens with a swipe up.

## 2. Default look

Styles are data (`style`) and never touch maths. Defaults:

| Object | Default |
|---|---|
| Function curve | 2.5 px, round joins; colour from a rotating palette (below) |
| Derivative / antiderivative / Taylor | Same width; colours picked to be easy to tell from the source function (see palette) |
| Region (`AreaUnder`, `Riemann`) | Fill 22% alpha of the function's colour, thin outline of the same colour at 70% |
| Bars narrower than 1 px | Merged into one filled polygon, no outline |
| Tangent / normal | 1.8 px line, same hue as the function but darker; point on the curve is a 7 px dot |
| Roots / extrema / inflections / holes | 7 px dots; roots on the x-axis filled; extrema labelled `max`/`min` on hover or when selected; holes drawn as open circles (1.8 px ring, background fill) |
| Asymptotes | Dashed (6 on, 5 off) 1.2 px grey-blue line, drawn behind curves |
| Poles seen by the plotter | A faint dashed vertical at the pole `x` (30% alpha), off by default for functions the learner did not name |
| Slope field | Segments 1.2 px, colour by slope sign (warm for positive, cool for negative) at 70%, a faint dot where undefined |
| ODE solution | 2.8 px, drawn above the field; start point as a 7 px dot |

**Palette.** A colour-blind-safe set (the Okabe-Ito eight) in this order for functions: blue, orange, green, vermilion, purple, yellow-brown, sky, grey. Derived objects (derivative, tangent, integral) start from the source colour and shift by a fixed lightness step so that the family is visible.

**Labels.** A function label (`f`) sits near the right edge of the visible part, offset above the curve, avoiding other labels; if the user hides labels, labels still appear on hover/focus.

## 3. Interaction

### Pointer and touch

- **Pan** with one-finger drag on empty space (mouse: drag; wheel scrolls zoom; Shift-wheel pans horizontally). **Pinch** to zoom on touch; double-tap zooms in at the point; two-finger double-tap resets.
- **Axis zoom**: dragging on an axis scales only that axis (the slope field and plots re-render with the new aspect ratio; segment angles follow the screen).
- **Dragging a free point** (`A = (1, 2)`) moves it. **Dragging a `PointOn` point** (for example, the tangent's contact point) projects the pointer onto the path. The projection for a function uses the nearest point in *screen* space, found by a short search from the previous position, so the point never jumps across a wall.
- **Dragging a slider**: thumb on the track. A touch target of 44 px. Dragging slow-snaps to the step.
- **Dragging a region boundary**: the interval end points of an `AreaUnder` or `Riemann` shown as small grips on the x-axis when the region is selected; drag changes `a` and `b` only when they are free numbers (not formulas). If they are formulas, the grips are shown dimmed and a tap says "a is computed from `k + 1`; change `k`".
- **Hover/long press** on a curve: a tooltip with `(x, f(x))` at the pointer; hover on a computed point shows its definition (`Root of f in [−3, 3]`).
- **Tap** selects. A tap on a derived object (a root) highlights its inputs on the canvas and in the list. A second tap on the list entry opens its definition line for editing.
- **Hit testing** order: labels, points, then curves (within 8 px), then fills. Overlapping curves within 8 px are listed in a small popup on tap.

### Keyboard

| Key | Action |
|---|---|
| Tab / Shift-Tab | Move between objects in figure order |
| Arrow keys on a selected free point or `PointOn` | Move by 1 px; Shift = 10 px; Alt = 0.1 px. On a function point, left/right moves along the curve in x |
| Arrow keys on a selected slider | Step by `step`; Shift = 10 steps |
| `+` / `-` | Zoom the view in/out |
| `0` | Reset the view |
| `Enter` on a selected object | Edit its definition |
| `Esc` | Deselect |
| `A` | Toggle the "describe" panel for the selected function (section 5) |
| `.` | Cycle through the points of the selected list (all roots, extrema) |

### Command line

The line input is the primary tool: it takes exactly the lines `draw` takes, one at a time. Auto-complete after the first letters shows the command catalogue lines (name, form, summary). Errors show under the input with the same fields as `errors.md`: token underlined; hint on a second line; clicking a `forms` entry fills the line. An undefined result is shown as a small `⚠` in the figure list. Clicking it opens `detail` and `hint`.

### Toolbar

A thin toolbar offers tools that only write lines (so everything stays a script). Each tool is a template with prompts on the canvas:

| Tool | Writes |
|---|---|
| Tangent | Click a function, click a point: `T = Tangent(f, x0)` with the point attached by a `PointOn` |
| Roots | Click a function: `r = Roots(f, a, b)` using the visible x range, rounded to nice numbers |
| Extrema | Same for `Extremum` |
| Area | Click a function, drag an interval on the axis: `A = AreaUnder(f, a, b)` |
| Slices | After Area: adds `n` slider and `Riemann` |
| Derivative | Click a function: `d = Derivative(f)` |
| Slope field | Prompts for `g`; writes `SlopeField(g)` and a start-point tool for `SolveODE` |

When a tool picks bounds from the view it writes the numbers, not the view; the figure does not depend on the window afterwards.

## 4. Animation

Animation always comes from the clock `t` or from sliders. Helpers:

- **Play** on a slider: steps `a` with its `step` at a speed chosen from the track (1 to 5 seconds per sweep), oscillating, one-way or repeating. In a film the slider is bound to `t` by the author (`a = -2 + 4 * smooth(t / 6)`), so replay is exact.
- **Grow `n`**: a preset "slices grow" that raises the `Riemann` count through 2, 4, 8, 16, 32, 64 with a short crossfade of the bars (each stage 0.8 s). The bars' height changes are not interpolated; the number text counts up.
- **Tangent slide**: when the tangent point moves, the tangent line is redrawn per frame; the slope readout updates; if `Slope` is `undefined(corner)`, the tangent fades out and a small bubble says "corner".
- **Taylor build-up**: a preset that increases the order `n` with a 600 ms ease; the polynomial's curve cross-fades between orders; the coefficient text updates.
- **Highlight(obj, seconds)** from the teacher: a soft pulse (stroke widens 40% and returns, two cycles) plus a ring on points.
- **Reduced motion**: when the OS asks for reduced motion, presets step without easing and Highlight is a static thicker outline.

## 5. Screen-reader and non-visual output

A hidden, live-updated list mirrors the figure (core design section 8). For calculus objects each entry has a sentence generated from the values (no extra commands):

- Function: "f of x equals x cubed minus 3 x. Zeros at minus 1.73, 0, and 1.73. Local maximum at x minus 1, y 2. Local minimum at x 1, y minus 2. Increasing for x less than minus 1, decreasing between minus 1 and 1, increasing for x greater than 1."
- Region: "Area under f from 0 to 2: 2.667, shaded."
- Roots list: "3 roots: …". Pressing `.` reads each in turn and highlights it.
- Slope field: "Slope field of x minus y on a 25 by 25 grid. Slopes are positive above the line y equals x minus 1 and negative below it" (computed by sampling the sign of `g` along three lines).
- Pole or hole: "Vertical asymptote at x equals 1. Hole at x equals 1, y equals 2."
- Undefined: "r is undefined: f has no zero between 2 and 3."

The "describe" panel (key `A`) shows the same text for a selected function and can be spoken or copied. Colours never carry meaning alone: roots, extrema and holes differ in shape (filled dot, labelled dot, open ring); regions have a hatch toggle for patterns (diagonal for positive area, cross-hatch for negative).

## 6. Hatching and sign

`AreaUnder` draws signed area: positive parts with the base fill, negative parts with the same hue lightly hatched, so a learner can see that the "integral" can be less than the "area". The readout shows both values (`integral = −0.5`, `area = 0.5`) on request.

## 7. How GeoGebra presents this and what we change

GeoGebra shows calculus objects as items in an algebra list plus a graphics view with toolbars; most calculus results show up as separate objects with separate dialogs for style. A function's tangent and integral come from tools whose dialogs write commands. Interval-mode plotting is a hidden option for functions. Bars, slope fields and areas have different default look depending on the tool.

What we change:

1. Tools write visible, editable lines; there are no hidden objects.
2. One look for derived objects (family colours), so the learner reads relationships from colour.
3. Poles, holes and jumps are drawn as such by default, with no mode to choose.
4. Dragging along a function never jumps across a wall.
5. Describing a function in words is a first-class output for screen readers and for the teacher.
6. Slider-driven results (lists of roots) change size without creating or removing named objects.
7. Everything works with the film clock: the same lines and `t` give the same frames.

## 8. Sketches

### Slices growing

```text
 n = 4                 n = 16                 n = 64
 │      ┌┐             │       ▄▄             │       ▁▂▃▄▅
 │   ┌┐ ││             │     ▄▄██             │     ▂▃▄▅▆▇
 │┌┐ ││ ││             │  ▃▄▄████             │  ▁▂▃▄▅▆▇█
 └┴┴─┴┴─┴┴──▶ x        └──┴┴┴┴┴┴┴┴──▶ x       └──┴┴┴┴┴┴┴┴┴┴──▶ x
 sum 3.0  exact 2.667  sum 2.77  exact 2.667   sum 2.69  exact 2.667
```

### Hole and wall

```text
   y ▲                         y ▲      ¦
     │        ╱                  │      ¦ ╲
     │      ╱                    │      ¦  ╲
     │    ◯  ← hole at (1,2)     │ ─────¦───────────▶ x
   ──┼───╱────────▶ x            │      ¦      ╱
     │ ╱                         │ ╲    ¦    ╱   dashed: x = 1.5
                                 │  ╲___¦___╱
```

### Error under the line input

```text
> Integral(g, 0, 1)
           ^ no form (Function2, Number, Number)
  Integral(g: Function2, v, a, b) -> Function   ← click to fill
  hint: g has two variables. Integrate one out: Integral(g, y, 0, 1).
```

## Sources studied

See `design.md`. Interaction ideas informed by the behaviours of function, area and slope-field tools described in the manual pages `Functions`, `SlopeField`, `Integral`, `RectangleSum` and by the way those commands draw in `euclidian/draw/` (function area, slope, inequality drawables) and `euclidian/plot/`.
