# SVG SDK contract

SVG is the primary v0.1 rendering layer because it is responsive, inspectable, accessible, and suitable for graphs and diagrams. Canvas and WebGL are deferred.

## Stage

```js
const svg = inc.svg('#stage', {
  viewBox: [0, 0, 760, 360],
  title: 'Projectile motion',
  description: 'A ball follows a curved path while gravity changes its vertical velocity.'
});
```

The engine creates a responsive SVG with a view box, unique ID namespace, accessible title and description, and managed back, middle, front, and label layers. Scenes never set fixed pixel dimensions.

## Primitive builders

v0.1 provides:

- `svg.group`
- `svg.path`
- `svg.line`
- `svg.circle`
- `svg.rect`
- `svg.text`
- `svg.polyline`
- `svg.equation` (below)

Each returns a handle with change-only attribute writes and transform helpers such as `set`, `at`, `rotate`, `scale`, `show`, and `tone`.

`stage.fluid(velocity, options)` draws a flowing fluid, wind or current (FX-1): particles carried by `velocity`, a function of the stage point that returns `[vx, vy]` in stage units per second (y points down), which move while the figure plays and leave streaks that fade. Each particle takes a midpoint step every frame, and starts again at a seeded random place in `region` (default the view box) when it leaves it, grows older than `life` seconds (default 4), or meets a velocity that is not a number, as inside an obstacle, so a field that returns `[NaN, NaN]` inside a shape keeps the flow out of it. `count` is 10 to 2000 particles (default 400), `trail` the seconds a streak takes to fade (0 to 3, default 0.6), and `r` the dot radius and streak width. A fluid sits on the back canvas layer by default, behind the drawing, so what stands in the flow stays on top; its canvas keeps what it drew and fades it, and starts afresh when the view is zoomed or resized. Paused, it holds still. `tone`, `show`, `hide` and `reset` change it later.

```js
// Air past a cylinder of radius R at (300, 150): uniform flow plus a doublet.
const speed = inc.param('speed', { min: 10, max: 120, value: 60, unit: 'm/s' });
stage.fluid((x, y) => {
  const dx = x - 300;
  const dy = y - 150;
  const r2 = dx * dx + dy * dy;
  if (r2 < R * R) return [NaN, NaN];
  const k = (R * R) / (r2 * r2);
  return [speed.value * (1 - k * (dx * dx - dy * dy)), -speed.value * 2 * k * dx * dy];
}, { count: 700, trail: 0.8 });
stage.circle(300, 150, R, { tone: 'mid', fill: true, shade: 'sphere' });
```

`glow: true` (or `handle.glow(on)`) gives an element a soft halo in its own tone, for a lamp that is on, a hot wire or a charged sphere: one blur filter per stage, sized to its view box, which exported pictures keep. Dot clouds take `glow: true` too, for sparks, stars or charges on the canvas layer (FX-1).

## Equations and chemical formulas (DG-5)

`svg.equation(x, y, source, { anchor, size, tone })` draws an equation as maths, centred on its point by default (`anchor: 'start'` or `'end'` puts that end of it there; `size` is in stage units, 16 by default). Each side of its `=` and `≈` signs is read by the same safe parser as `inc.formula`, so fractions stack, powers rise, roots and Greek letters show as written, trailing digits become subscripts and factors sit side by side:

```js
const law = svg.equation(100, 64, 'T ≈ 2*pi*sqrt(L/g)', { size: 18 });
inc.onFrame(() => law.text('F = ' + model.force.toFixed(1)));
```

A side that is not a formula is shown as written. The renderer builds the MathML with DOM calls from the parsed tree, never from markup, and places it in a box inside the drawing (a `foreignObject`) sized from the same estimate the runtime's bounds check uses. `graph.equation` does the same at a point in data units, and stays on it as the learner zooms and pans.

Chemical formulas and plain symbols stay text: `svg.text(x, y, inc.chem('2H2 + O2 -> 2H2O'))` shows 2H₂ + O₂ → 2H₂O, and `inc.sym('v_0^2')` shows v₀².

## Path helpers

The first release includes line, sampled curve, parametric curve, arc, and arrow helpers. Sampled curves start a new subpath after a non-finite point so discontinuities are never bridged.

Actual formula and primitive operations remain present in scene source. A helper may implement reusable geometry, but examples must not pretend a named concept function exists unless it is part of the registered SDK.

## Parts

```js
svg.part('Ball', ball, {
  label: 'Projectile',
  info: 'Its horizontal velocity stays constant while gravity changes vertical velocity.'
});
```

The parts registry drives highlight, dimming, keyboard focus, teaching-step focus, and descriptions. The accessibility structure must preserve interactive descendants; implementation tests determine the correct SVG roles rather than treating the whole interactive stage as a single image.

## Performance rules

- Build static geometry once and move it with transforms.
- Rebuild path data only when shape-defining parameters change.
- Do not read layout during a frame callback.
- Do not write `innerHTML` during a frame callback.
- Use theme tones instead of hard-coded colors.
- v0.1 figures stay under 300 SVG elements and 500 sampled points per plotted curve.
- The SDK—not generated code—owns pointer handling.

## Snapshot

The stage can produce a PNG snapshot after resolving theme tokens, used for persistence and fallback (`handle.snapshot()`), and export itself as a standalone SVG image with the theme's colours, lines and fonts written in (`handle.exportSvg()`, SV-14). The export is a `data:image/svg+xml` URL: show it in an `<img>` or offer it as a download, rather than pasting it into a page as markup. Dots and fluids on a canvas layer are not part of it; a video clip records them. An equation keeps its MathML in the export, inside a `<switch>` with a line of text (T ≈ 2π√(L/g)) for programs that cannot draw it; a PNG snapshot falls back to that text where drawing MathML to a canvas is not allowed. Styles the copy needs are written into its markup as it is serialized, never set on an element, so the frame's policy has nothing to refuse.

## Video clips

`handle.exportClip({ seconds, fps })` records a short video of the figure as it plays (PRD 6.10b): 0.5 to 20 seconds, 4 to 30 frames a second, 4 seconds at 24 by default. The frame copies the drawing onto a canvas as often as it can, with its dot layers behind and in front, and the browser's MediaRecorder records the canvas: WebM where the browser makes it (Chromium, Firefox), MP4 otherwise (Safari). A figure that moves but was paused plays while it records and pauses again after. The video comes back to the host as a `Blob` of at most 64 MB, checked at the bridge like every frame message, and is `null` where the browser cannot record a canvas or the figure has never drawn. Equations go in as text, as in a PNG snapshot, so the canvas stays readable and recordable. In a note, the TipTap node view gives the same as `view.clip(options)`, and `view.picture('png' | 'svg')` gives the still pictures; `figureViews.get(element)` finds the view for a figure's element.

## Printing

A printed note shows every figure as a still (PRD 6.10). A figure that is not live prints its snapshot. A live one keeps a vector still of its drawing, made with the SVG export when it first draws and again when the learner's changes settle, and the TipTap node view swaps it in for the frame on `beforeprint` and back on `afterprint`, so the page prints the figure as the learner left it, with its description underneath. Inside the frame, the print stylesheet hides the controls, the walkthrough and the zoom bar.
