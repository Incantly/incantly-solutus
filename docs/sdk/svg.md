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

The stage can produce a PNG snapshot after resolving theme tokens, used for persistence and fallback (`handle.snapshot()`), and export itself as a standalone SVG image with the theme's colours, lines and fonts written in (`handle.exportSvg()`, SV-14). The export is a `data:image/svg+xml` URL: show it in an `<img>` or offer it as a download, rather than pasting it into a page as markup. Dots on a canvas layer are not part of it. An equation keeps its MathML in the export, inside a `<switch>` with a line of text (T ≈ 2π√(L/g)) for programs that cannot draw it; a PNG snapshot falls back to that text where drawing MathML to a canvas is not allowed. Styles the copy needs are written into its markup as it is serialized, never set on an element, so the frame's policy has nothing to refuse.

## Printing

A printed note shows every figure as a still (PRD 6.10). A figure that is not live prints its snapshot. A live one keeps a vector still of its drawing, made with the SVG export when it first draws and again when the learner's changes settle, and the TipTap node view swaps it in for the frame on `beforeprint` and back on `afterprint`, so the page prints the figure as the learner left it, with its description underneath. Inside the frame, the print stylesheet hides the controls, the walkthrough and the zoom bar.
