# Space (3D) phase 2: surfaces, the clip box and motion — requirements

Area: `docs/features/space-3d/` (`design.md` 6.3, 8.1, 8.7, 13; `ui.md` 7, 8, 14). Builds on `.kiro/specs/space-3d`.
Kernel code in `packages/kernel/src/commands/space/`, the screen in `packages/sdk/src/screen/space/`, the app in
`apps/studio`. Branch: `feat/space-surfaces-*`.

Scope, as the product owner asked: curved surfaces, the clip box, and 3D figures that move (animation, particles,
motion). Quadrics by equation, implicit surfaces, surface intersections, nets and the WebGL2 back-end stay for later.

### R1. Surfaces and curves in space (design 6.3; ui 7)

1. A function of two variables `f(x, y) = …` SHALL draw in the Space view as the surface `z = f(x, y)` over the view's
   floor (or the clip box), with a height-coloured gradient (blue low, orange high) and faint grid lines.
2. `Surface(x, y, z, u, u0, u1, v, v0, v1)` SHALL make a parametric `Surface` from three formulas in `u` and `v`.
3. `Curve(x, y, z, s, a, b)` SHALL make a `Curve3` from three formulas in `s`; `PointOn(c, s)` puts a point on it.
4. A surface or curve whose formulas read `t` SHALL move with the film. Undefined samples SHALL leave holes, not errors.
5. A bad range is an undefined value with a reason (`missing_range`, `bad_argument`), as for `Curve` in 2D.

### R2. The clip box (design 8.1, 8.7; ui 8)

1. `space with clip = true` SHALL cut every object to the box `clipMin`..`clipMax` (default ±5): faces and lines are
   cut at the box, points outside are left out, and the box's edges are drawn thin and gray.
2. `clipSize = tiny | small | medium | large | huge` SHALL scale the box about its centre. A box whose min is not below
   its max in each coordinate is `bad_property_value`.
3. With the clip box on, a surface `z = f(x, y)` is drawn over the box's floor and cut at its top and bottom.
4. The style bar SHALL have a clip button.

### R3. Motion (design 8.1 `spin`; ui 14)

1. `space with spin = 20` SHALL turn the camera 20° a second with film time, and the clock bar shows.
2. `Particles(…, pos = (x, y, z))` SHALL work in space: each particle a dot at its place, drawn in the Space view.
   The 3D app SHALL allow particles, animated sliders and `state()`.
3. Points, solids and surfaces built from `t`, animated sliders or `state()` SHALL move in the Space view and in its
   export at a time `t`.

### R4. Examples, speed, screenshots

1. The 3D app SHALL offer at least eight new examples that move: a point on a helix with its trail, a rotating cube, a
   wave surface, a plane sweeping a cone, a particle fountain, an orbit, a spinning saddle in a clip box, a sliding
   section of a sphere. Each opens with every line used.
2. A 40 × 40 surface SHALL mesh in under 8 ms; a frame with 2,000 particles and a surface SHALL paint in under 16 ms.
