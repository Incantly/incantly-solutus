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

Each returns a handle with change-only attribute writes and transform helpers such as `set`, `at`, `rotate`, `scale`, `show`, and `tone`.

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

The stage can produce a PNG snapshot after resolving theme tokens. Snapshot capability is used for persistence and fallback; editable SVG export is deferred.
