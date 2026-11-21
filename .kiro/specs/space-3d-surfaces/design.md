# Space (3D) phase 2: design

Feature design: `docs/features/space-3d/design.md` (6.3 surfaces, 8.1 the `space` properties, 8.7 the clip box).

## Kernel (`packages/kernel/src/commands/space/surfaces.ts`)

- `Surface(x, y, z, u, u0, u1, v, v0, v1)`: `x`, `y`, `z` are bodies, `u` and `v` binders. The value is
  `{ shape3: 'Surface', kind: 'parametric', at(u, v), u: [u0, u1], v: [v0, v1] }`; `at` evaluates the three bodies with
  the binders set, and gives `undefined` where a formula is undefined.
- `Curve(x, y, z, s, a, b)` is a new form of the shared `Curve` command: `{ shape3: 'Curve3', at(s), lo, hi }`.
  `PointOn(Curve3, s)` takes `s` in `a..b` (the curve's own parameter, so `PointOn(c, t)` follows the film).
- A function of two variables needs no new value: the Space view draws a `Function` of arity 2.
- New types `Surface`, `Curve3`. New camera properties on `Space(…)`: `clip` (Bool), `clipMin`, `clipMax` (Point3),
  `clipSize` (Text), `spin` (Number, degrees a second). `viewAt(figure)` gives the camera at the film time, with the
  spin applied to the azimuth and the clip size applied to the box.

## The screen (`packages/sdk/src/screen/space/`)

- `mesh3.ts` (pure): a uniform grid of the parameter square (40 × 40 for a surface, 24 × 24 for a quick one during a
  drag is not needed: the painter is fast enough), cells with an undefined corner left out; explicit surfaces sample
  `f(x, y)` over the floor or the clip box. Each cell is a face with a colour from its mean height. Grid lines every
  fifth row and column. A curve is a polyline of 200 pieces, split where it is undefined.
- `clip3.ts` (pure): Sutherland–Hodgman clipping of a face against the six planes of the box, Liang–Barsky for line
  pieces, and a box test for points and labels. The scene builder clips each item once, so the painter is unchanged.
- Particles in space: the kernel's CPU program fills a `z` array next to `x` and `y` when `pos` is a point in space.
  The scene adds each live particle as a small dot (no hidden test: they are many and small), coloured and sized as the
  formulas say; they draw after the faces.

## Kernel change in the animation area

`Particles` takes `pos` as `Point|Point3`. A batch has an optional `z` array; the GPU program is used only for flat
particles (a 3D `pos` runs on the CPU, which is what the Space view's painter needs anyway).

## The studio

The 3D mode's command list gains `animation`, so particles, animated sliders, traces and `state()` work there. The
clock bar shows for a camera with `spin`. Eight examples join the 3D app.
