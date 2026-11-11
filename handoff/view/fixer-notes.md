# Fixer notes: view

## Fixer round

Round 1 (step 3). Input: `handoff/view/test-report.md`, 37 failing spec tests. Result: all 500 spec tests pass. No test was contested. Only `packages/view/src/` changed.

### Fixes, by rule

Grid (graphics-view 5 step 5)
- `core/grid.ts`: pi axes pick from pi/6, pi/4, pi/3, pi/2, pi, 2pi, then doubling (4pi, 8pi, ...), nearest to the 80 px target on a log scale. Finer than pi/6 uses decimal fractions of pi. Before, the code built pi/5, pi/10 and so on.

Camera (space-3d 8.1)
- `core/camera.ts`: azimuth 0 looks along +y (camera at -y when z is up). Changed `orientationFromAzEl`, `readAzEl` and `viewFacingAzEl` together so the round trip and the presets stay consistent (front = camera at -y, right = camera at +x).
- `core/camera.ts`: `aspect` now scales the drawn axes. The view matrix carries the scale, `eye` stays in world axes, `pointerRay` returns world-space rays, and the new `drawnToWorldVec` converts screen-derived deltas. `web/figure-view.ts` uses it for 3D pan and depth drags.

3D picking and painting (space-3d 9.3, 9.4)
- `core/pick3d.ts`: paths are tested along every segment in screen space (closed paths include the closing segment), not at vertices only. `param.s` is the fractional position along the polyline.
- `backends/software.ts`: back-face culling had the wrong sign (screen y points down), so front faces were dropped and `triangles` stayed 0. Fixed.

Styles (graphics-view 9, errors.md 2, ui.md 6)
- `core/styles.ts`: polygon (`region`) default stroke is `#222831` and its fill default is `#1a5fd1` at 0.15. The fill colour follows an authored `color`. `TypeDefaults` gained `fillColor`.
- `pointStyle` and `pointSize` on any kind except `point` fail with a `property_not_for_type` style error (code V003, message key `view.property_not_for_type`, added to `errors.ts`).
- Segment, vector, line and arc default label is `name` (design 9.7 groups segments with lines).
- A style reference that has no value right now (`undefined`) keeps the default for numbers, colours and dash. A value of the wrong type still fails (type_mismatch test).
- `dot` markers fill with the stroke colour moved 60% in lightness (`dotFillColor`), outline in the stroke colour (design 9.4).

Hit and drag (graphics-view 10.7, 12.1)
- `core/drawable.ts`: a text drawable hits its measured rectangle plus 2 px, priority 2.
- `core/drag.ts`: a slider thumb plans `slider` before the generic `free` rule.

Export (graphics-view 14.2)
- `core/export.ts`: the `objects` region is the union of the bboxes plus 5% of its extent on each side, minimum 12 px (x and y use their own px per unit through the new `pxPerUnitY`).
- `web/figure-view.ts`: every export marks all drawables view-dirty before rebuilding for the export viewport (the first SVG export used live-viewport pixels). The PNG path now passes the object bounds too (it passed `[]`, so `region: 'objects'` fell back to the view).

Descriptions (graphics-view 15, animation-time 10.8)
- `core/describe.ts`: free point reads `Point A at 1.5, 2. Free.` (the design table and ui.md 5). Particles read `Particle system fire, 1,500 particles, moving upward.` (count plus alt).

FigureView accessibility (graphics-view 15, ui.md 4 and 5, errors.md 4)
- `web/figure-view.ts`: the root has `aria-describedby` pointing at a hidden summary element with a unique id; `data-id` on each option is the object name; the arrow keys move DOM focus to the option (and walk only objects that have an option); the live region speaks the first message at once, queues later ones within 800 ms and speaks the last through a timer (before, it relied on a frame that never came).
- Fixed and path-undefined drags report `drag_fixed` ("A is fixed.") and `drag_path_undefined` instead of `drag_blocked`. The 3D point drag now refuses fixed points with `drag_fixed`.

### Contested tests

None.

### Choices where the docs are silent

- `property_not_for_type` is limited to `pointStyle` and `pointSize`. A test sets `arrow` on a point and expects success, and `fill` on a segment must only warn, so I did not extend the rule to every property.
- Below pi/6, pi steps use decimal fractions of pi (outside the documented list).
- `aspect` scales drawn axes only; the ortho fit scale is not re-fitted, so a large aspect can draw past the edge.
- Hidden-list `data-id` is the object name, so it must be unique per figure (object names already are).

### Needs the integrator

- One shell command in this round was blocked by a host rule that matched a false positive (the command had no ssh in it). The edit was re-applied with the file tools. Nothing else needed.

## Findings round (step 5) and regression tests (step 6)

Input: `handoff/view/findings.md`, VIEW-SM-1 to 27. Result: 25 fixed, 2 marked `to be implemented` (VIEW-SM-19, and the rest of VIEW-SM-23). Lint and typecheck are clean and all 633 view tests pass.

### Regression tests

`packages/view/test/spec/regressions.test.ts` has a section per finding for VIEW-SM-1 to 10, 12, 15, 17, 18, 20, 22, 23 and 27. Each section for VIEW-SM-8 to 23 was run against the code without its fix and failed there. VIEW-SM-11, 13, 14, 16 and 26 are covered by the earlier spec tests. VIEW-SM-21, 24 and 25 have no regression test (a timing bound, and two that need a real WebGL2 context).

### Test changes

- VIEW-SM-1, reader list: the check on `innerHTML` matched a name inside an attribute value, which `innerHTML` serialises unescaped and which is safe. The test now checks that no element was created.
- VIEW-SM-7, frames after remount: the test now runs the frame that `mount` asked for before it counts new requests.
- VIEW-SM-20: 44 moves, so code without the limit still finishes; 120 moves ran the old code out of memory.

### Choices where the docs are silent

- A second figure with an id that is already mounted gets an error from `mount` and mounts nothing.
- An SVG surface built with no limits uses the 50,000-element cap.
- Exports keep the labels of selected and focused objects first, as the live view does.
- A 3D click with no movement sends nothing to the kernel (it sent a commit before).
