# PRD coverage

Every numbered requirement in the [product requirements document](../Incantly%20SDK%20Product%20Requirements%20Document%20%281%29.md), checked against the code.

- **Done**: implemented and covered by tests.
- **Partial**: some of it works; the note says what is missing. "Untested" means the code is there but no test exercises it.
- **Missing**: not built yet.

The baseline column is the state at commit `2f8b0a1` (the end of v0.1, Phases 0 to 5). The status column is the state at commit `7a70424`. Test files named in the notes are under `packages/*/test` and `apps/playground/e2e`.

## Summary

197 rows: every numbered requirement, the theme and output items of 6.9 and 6.10, and the items of section 25. Section 10 is listed at the end and not counted.

| | Done | Partial | Missing |
| --- | --- | --- | --- |
| Baseline (`2f8b0a1`) | 78 | 31 | 88 |
| Now (`7a70424`) | 164 | 26 | 7 |

Still open, by priority:

- **P0**: CT-4, FM-5, VI-1, VI-6, 6.9a, PL-3, EN-6, SV-5, C3-5 and RP-7. Most are untested parts of built features; the feature gaps are FM-5 (`noise`), 6.9a (a water token) and RP-7 (background repair). SV-14 is open only for its P2 half, the SVG export.
- **P1**: DG-5, DG-6, VI-7, HO-8, CH-2, SV-12, SV-13, C3-6, C3-8, C3-9, RP-12.
- **P2**: S3-9, VI-5, 6.10b, 6.10c, HO-9, BR-12, BR-13, FX-1, GL-1, C3-12, and SV-14's SVG export.
- **Section 25**: the live figure's own frame is not pre-warmed yet.

## 6.1 Runtime core

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| RT-1 | One loop, capped time step, draw only when changed | P0 | Done | Done | `FigureRenderer` owns the only loop; `SceneRuntime.tick` caps dt and skips clean, paused frames. |
| RT-2 | Scene time, delta time, fixed-step option | P0 | Partial | Done | `inc.simulate` steps scene code at a fixed step while playing; physics2d uses a fixed step with substeps (controls.test.ts, kits-physics2d.test.ts). |
| RT-3 | Reactive state store `inc.state` | P0 | Missing | Done | `inc.state.get`, `set` and `on`; parameters are state too (controls.test.ts). |
| RT-4 | Hooks: onReset, onFrame, onParamChange, onStep | P0 | Partial | Done | All four (controls.test.ts). |
| RT-5 | Off-screen pause, background pause, reduced-motion start | P0 | Done | Done | IntersectionObserver, visibilitychange, reduced motion starts paused. |
| RT-6 | Seeded random | P1 | Done | Done | `inc.random`, mulberry32. |
| RT-7 | Error boundary that keeps controls alive | P0 | Done | Done | Guarded phases; the last good frame stays. |

## 6.2 Controls

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| CT-1 | Play, pause, restart, speed 0.25x to 4x | P0 | Done | Done | |
| CT-2 | `inc.param` slider with number entry and live value | P0 | Done | Done | |
| CT-3 | toggle, choice, button, color | P0 | Missing | Done | `inc.toggle` (a switch), `inc.choice` (menu or segmented buttons), `inc.button`, `inc.color` (controls.test.ts, interaction-view.test.ts). |
| CT-4 | Timing panel: duration, loop mode, easing, frame-rate cap, frame step | P0 | Missing | Partial | `inc.timeline` with duration, loop, once, ping-pong and five easings, set in the settings panel, and a frame step (controls.test.ts, interaction-view.test.ts). The frame-rate cap is built (settings panel, renderer) but untested. |
| CT-5 | Reset to authored values, undo and redo | P1 | Partial | Done | Reset, undo, redo, Ctrl+Z and Ctrl+Shift+Z (controls.test.ts, interaction-view.test.ts). |
| CT-6 | Presets | P1 | Missing | Done | `inc.presets` as one-tap chips that mark the active set (controls.test.ts, interaction-view.test.ts). |
| CT-7 | Step-through mode | P1 | Done | Done | `inc.steps`. |
| CT-8 | Linked parameters | P1 | Missing | Done | `inc.link` keeps two parameters in step both ways (controls.test.ts). |
| CT-9 | Settings panel (gear menu) | P0 | Missing | Done | Gear menu with timing, frame-rate cap and frame step (interaction-view.test.ts). |
| CT-10 | Keyboard and screen-reader access for every control | P0 | Done | Done | Native inputs, labels, axe checks in e2e. |

## 6.3 Formulas and maths

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| FM-1 | Safe expression parser, never eval | P0 | Done | Done | `packages/core/src/expr`. |
| FM-2 | Editable expression text, validated and recompiled, inline errors | P0 | Missing | Done | `inc.formula(…, { editable: true })`: the edit is tried after a pause, recompiled and saved; a mistake shows inline and keeps the last good formula (controls.test.ts, interaction-view.test.ts). |
| FM-3 | Formula variables bound to parameters both ways | P0 | Partial | Done | Parameters feed formulas by name, and an edit may use any parameter (controls.test.ts). |
| FM-4 | Rendered maths display | P1 | Missing | Done | MathML from the formula source beside the editable text (renderer/math.ts; interaction-view.test.ts). |
| FM-5 | Built-ins: trig, exp, log, abs, min, max, piecewise, sign, floor, noise | P0 | Partial | Partial | Trig, exp, log, abs, min, max, sign, floor, clamp, step; piecewise through conditionals (expr.test.ts). No `noise`. |
| FM-6 | Derivative, integral, root finding, interpolation | P1 | Missing | Done | `inc.calc`: derivative, integral, root, roots, extrema, interp (helpers.test.ts). |
| FM-7 | ODE integrators (Euler, RK4) | P1 | Missing | Done | `inc.calc.euler`, `inc.calc.rk4` (helpers.test.ts). |
| FM-8 | Units and conversions for display | P1 | Missing | Done | `inc.units.format` and `convert` (helpers.test.ts). |
| FM-9 | Vector and matrix helpers | P1 | Missing | Done | `inc.vec`: add, dot, cross, rotate, rotA, mul, apply (helpers.test.ts). |

## 6.4 2D graph

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| G2-1 | `inc.graph2d` with ranges, grid, axes, labels | P0 | Done | Done | |
| G2-2 | y=f(x), x=f(y), parametric and polar curves | P0 | Partial | Done | `plot`, `plotX`, `parametric`, `polar` (graph-interaction.test.ts). |
| G2-3 | Scatter, lines, bars, histograms, area under a curve, shaded regions | P0 | Missing | Done | `scatter`, `bars`, `histogram`, `area`, `between` (graph-interaction.test.ts). |
| G2-4 | Vector arrows, vector fields, slope fields | P1 | Partial | Done | `arrow`, `field`, `slopes` (graph-interaction.test.ts). |
| G2-5 | Implicit curves and shaded inequalities | P2 | Missing | Done | `implicit`, shaded with `fill` (graph-interaction.test.ts). |
| G2-6 | Zoom, pan, reset, axis auto-fit | P0 | Missing | Done | Wheel zoom about the pointer, pan, reset and fit; the kit re-ticks the axes (graph-interaction.test.ts, interaction-view.test.ts). Pinch shares VI-1's untested path. |
| G2-7 | Trace a point along a curve | P0 | Missing | Done | `trace` follows the pointer, shows coordinates and drags along the curve (graph-interaction.test.ts). |
| G2-8 | Roots, extrema, intersections marked | P1 | Missing | Done | `marks` and `crossings` (graph-interaction.test.ts). |
| G2-9 | Multiple curves with legend and visibility toggles | P0 | Partial | Done | Labelled curves fill the legend, where learners hide them (graph-interaction.test.ts, interaction-view.test.ts). |
| G2-10 | Draggable handles bound to parameters | P1 | Missing | Done | `handle({ x: 'h', y: 'k' })` and `drag(item, map)` (graph-interaction.test.ts). |
| G2-11 | Annotations: text, arrows, brackets, dimension lines | P1 | Partial | Done | `label`, `arrow`, `bracket`, `dimension` (graph-interaction.test.ts). |
| G2-12 | Log scales and unit labels | P1 | Missing | Done | `scale: { x: 'log' }` with decade ticks; axis names carry the units (graph-interaction.test.ts). |
| G2-13 | Curve draws over time, moving point with trail | P0 | Partial | Done | `reveal(fraction)` and `trail` (graph-interaction.test.ts). |

## 6.5 3D graph

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| G3-1 | `inc.graph3d` | P1 | Missing | Done | In the space3d kit, loaded on demand (kits-space3d.test.ts). |
| G3-2 | Surfaces with depth sorting | P1 | Missing | Done | Surfaces sampled in the data box, depth sorted with everything else (kits-space3d.test.ts). |
| G3-3 | 3D parametric curves and surfaces | P1 | Missing | Done | `parametric` and `curve` (kits-space3d.test.ts). |
| G3-4 | Points, vectors, planes, lines in 3D | P1 | Missing | Done | `point`, `vector`, `line`, `plane`, `label` (kits-space3d.test.ts). |
| G3-5 | Orbit, zoom, camera presets, reset | P1 | Missing | Done | Orbit, zoom about the pointer, front, side, top and iso presets, reset (kits-space3d.test.ts). Orbiting by pointer is untested (C3-5). |
| G3-6 | Cross-section slider and contours | P2 | Missing | Done | `contours` on a surface and `section` that follows a value (kits-space3d.test.ts). |
| G3-7 | Mesh budget on slow devices | P1 | Missing | Done | Detail drops above the face budget and when drawing is slow (kits-space3d.test.ts). |

## 6.6 3D space

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| S3-1 | `inc.space3d` | P1 | Missing | Done | The space3d kit, loaded on demand (kits-space3d.test.ts). |
| S3-2 | Box, sphere, cylinder, cone, plane, torus, arrow, line, label | P1 | Missing | Done | All of them, plus tube, coil, mesh, point, grid and axes (kits-space3d.test.ts). |
| S3-3 | Groups and parent transforms | P1 | Missing | Done | `group` with `parent` (kits-space3d.test.ts). |
| S3-4 | Shading, back-face culling, painter's sort | P1 | Missing | Done | Lamp lighting in seven steps, gradient spheres, culling against the eye, painter's sort (kits-space3d.test.ts). |
| S3-5 | Isometric and orbit modes | P1 | Missing | Done | `mode: 'iso'` stays isometric; `'orbit'` turns (kits-space3d.test.ts). |
| S3-6 | Named parts with highlight, callouts, legend | P1 | Missing | Done | Parts own the faces they draw, take focus, and accent tones join the legend (kits-space3d.test.ts). |
| S3-7 | Exploded view | P2 | Missing | Done | `group.explode(k)` (kits-space3d.test.ts). |
| S3-8 | Field and flow lines | P2 | Missing | Done | `fieldLines` traced through a field function (kits-space3d.test.ts). |
| S3-9 | Asset library | P2 | Missing | Missing | No model library or viewer; scenes build shapes with `mesh`. |
| S3-10 | Object budget | P1 | Missing | Done | Round solids coarsen above the face budget, with a warning (kits-space3d.test.ts). |

## 6.6b 2D scene and physics

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| PH-1 | `inc.physics2d` | P1 | Missing | Done | The physics2d kit, loaded on demand (kits-physics2d.test.ts). |
| PH-2 | Circle, rectangle, polygon bodies | P1 | Missing | Done | `ball`, `box`, `polygon`, `ramp`; fixed or moving; mass or density, friction, bounce (kits-physics2d.test.ts). |
| PH-3 | Springs, ropes, hinges, motors, pulleys | P1 | Missing | Done | `spring`, `rope`, `rod`, `hinge` with a motor, `pulley` (kits-physics2d.test.ts). |
| PH-4 | Gravity, drag, buoyancy, magnetic and electric forces | P1 | Missing | Done | Gravity, air drag, liquids, charges, magnets and `field` (kits-physics2d.test.ts). |
| PH-5 | Fluid tank helper | P1 | Missing | Done | `tank`: level, displacement, floating and sinking (kits-physics2d.test.ts). |
| PH-6 | Live force arrows and decomposition | P1 | Missing | Done | `forces` draws arrows from the simulation, with components (kits-physics2d.test.ts). |
| PH-7 | Collision events and sensors | P2 | Missing | Done | `onHit`, and sensors with `onTouch` (kits-physics2d.test.ts). |
| PH-8 | Fixed time step and substepping | P0 | Missing | Done | The same result at any frame rate (kits-physics2d.test.ts, controls.test.ts). |

## 6.7 Diagrams and charts

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| DG-1 | Shapes, arrows, connectors, braces, labels, callouts | P0 | Partial | Done | Connectors and callouts that follow elements; braces, springs, circuit symbols and more from `inc.shapes` (controls.test.ts, helpers.test.ts). |
| DG-2 | Number line, table, readout panel, key-value values | P0 | Partial | Done | Number line (`axes: 'x'`), `inc.table`, readouts (graph-interaction.test.ts, controls.test.ts). |
| DG-3 | Line, bar, pie, stacked, histogram, box plot charts | P1 | Missing | Done | `inc.chart`: bar, stacked, line, area, pie, histogram, box, scatter (kits-chart.test.ts). |
| DG-4 | Flowchart and graph layout | P1 | Missing | Done | `inc.flow` lays nodes and edges out itself (kits-flow.test.ts). |
| DG-5 | Rendered equations and chemical formulas | P1 | Missing | Partial | `inc.chem` and `inc.sym` turn formulas and symbols into label text (helpers.test.ts). Equations with fractions render as MathML only in the formula panel, not as labels in the drawing. |
| DG-6 | Domain kits | P1 | Missing | Partial | Kits load on demand (kits.test.ts): space3d, physics2d (mechanics, fluids, charges, magnets), chart (statistics) and flow; `inc.shapes` covers circuits, optics, waves and cells. No chemistry kit (atoms, bonds, reactions) or biology kit. |

## 6.8 View and interaction

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| VI-1 | Zoom, pan, reset; pinch and double-tap | P0 | Missing | Partial | Wheel and toolbar zoom, pan, reset on double click (interaction-view.test.ts, graph-interaction.test.ts). Pinch is built (renderer/pointer.ts) but untested; double-tap relies on the browser's dblclick. |
| VI-2 | Tap-to-activate | P0 | Missing | Done | The wheel scrolls the page until the learner taps the stage (interaction-view.test.ts). |
| VI-3 | `part` registry for highlight, dimming, callouts | P0 | Done | Done | |
| VI-4 | Draggable handles bound to a parameter or point | P1 | Missing | Done | `stage.drag`, graph handles, draggable bodies and 3D objects, also by arrow keys (interaction-view.test.ts, graph-interaction.test.ts, kits-space3d.test.ts). |
| VI-5 | Measurement tool | P2 | Missing | Missing | |
| VI-6 | Fullscreen, responsive layout, safe-area padding | P0 | Partial | Partial | Container-query layout; a full-screen button and safe-area padding in full screen are built (renderer/controls.ts, theme.ts) but untested. |
| VI-7 | Multi-panel layout with linked panels | P1 | Partial | Partial | Several stages in one scene share one model, and the integrator can put the controls beside the drawing (style layout). No `inc.layout` helper for panels. |

## 6.9 and 6.10 Theme and output

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| 6.9a | Design tokens as CSS variables, light and dark | P0 | Done | Partial | `THEME_CSS` tokens in light and dark; presets (glass, soft, outline, minimal, contrast, paper, blueprint, sepia), integrator tokens and classes, live restyling (interaction-view.test.ts, style.spec.ts). No water token: liquids use tone b. |
| 6.9b | Agent CSS uses tokens only | P0 | Done | Done | CSS validator. |
| 6.9c | One type scale and one control style | P0 | Done | Done | Kits' stroke widths and label sizes now reach the drawing through theme variables. |
| 6.9d | 36 px minimum touch targets | P0 | Done | Done | 44 px on coarse pointers; axe checks target size (teaching.spec.ts). |
| 6.10a | PNG snapshot | P0 | Done | Done | sandbox.spec.ts. |
| 6.10b | SVG, GIF or video export | P2 | Missing | Missing | |
| 6.10c | Print-friendly render | P2 | Partial | Partial | Print stylesheet with the description; no static print render. |

## 7 Host (TipTap)

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| HO-1 | Node stores fragments, values and snapshot | P0 | Done | Done | Also edited formulas and the figure's own look (live-figures.test.ts). |
| HO-2 | Node view renders the sandboxed frame and bridge | P0 | Done | Done | |
| HO-3 | Bridge messages in and out | P0 | Done | Done | Plus `style`, `theme` and `number` to restyle a live figure (sandbox.test.ts). |
| HO-4 | Mount near the viewport; snapshot otherwise | P0 | Done | Done | |
| HO-5 | Snapshot and destroy after time off-screen | P0 | Done | Done | |
| HO-6 | At most three live figures | P0 | Done | Done | |
| HO-7 | One repair retry, then snapshot with a retry button | P0 | Done | Done | |
| HO-8 | Regenerate and edit by prompt | P1 | Partial | Partial | The client flow can remake a figure and keeps the working version or its snapshot as fallback (client.test.ts), but the TipTap extension only inserts new figures. No edit by prompt. |
| HO-9 | Version history | P2 | Missing | Missing | |

## 15 to 20 Borrowed mechanisms and kit requirements

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| BR-1 | Short rules plus references only when needed | — | Done | Done | Core rules and catalog always; the contract for the plan's capabilities, and one example or the starting scene (context.test.ts). |
| BR-2 | Plan before code | — | Done | Done | |
| BR-3 | One model drives everything | — | Done | Done | |
| BR-4 | Geometry once, move with transforms | — | Done | Done | Validator rules. |
| BR-5 | Painter's order and wrap helper | — | Missing | Done | space3d sorts every draw; tubes, coils and large faces split into pieces that sort on their own, so no wrap call is needed (kits-space3d.test.ts). |
| BR-6 | Tone hierarchy, no hard-coded colours | — | Done | Done | |
| BR-7 | Card: number, title, hint, readout, legend | — | Partial | Done | Figure number, title, hint, idea, readouts and legend (interaction-view.test.ts, controls.test.ts); TipTap numbers figures in the note (live-figures.test.ts). |
| BR-8 | Calm motion helpers | — | Missing | Done | `inc.motion` and `inc.idle` (helpers.test.ts, controls.test.ts). |
| BR-9 | Fast in-app checks | — | Done | Done | The probe. |
| BR-10 | Examples and evals | — | Partial | Done | Twelve reviewed scenes and evals for the twelve launch concepts (EX-1, EX-2). |
| BR-11 | Sizes | — | Missing | Done | Quick, standard and rich, chosen in the plan (protocol/plan.ts; see PL-3). |
| BR-12 | WebGL or canvas layer | P2 | Missing | Partial | A canvas layer behind or in front of the drawing draws dot clouds (`stage.dots`, SV-13). No WebGL, glow or fluid. |
| BR-13 | Community gallery | P2 | Missing | Missing | |
| PL-1 | Two-stage generation | P0 | Done | Done | |
| PL-2 | Plan validator | P0 | Done | Done | |
| PL-3 | Size classes with budgets | P0 | Missing | Partial | Budgets per size for controls, parts, elements, lines, reply tokens and seconds (protocol/plan.ts), enforced by the plan validator, the scene validator and the probe. Only the quick budgets are tested. Parts budgets (8, 12, 16) are tighter than the PRD's 12, 30 and 60. |
| MD-1 | `inc.model` | P0 | Done | Done | |
| MD-2 | Validator flags computed numbers typed into text | P1 | Done | Done | Rule `number-in-text` (validation.test.ts). |
| RM-1 | Shell loader | P0 | Done | Done | |
| RM-2 | Fragment validator | P0 | Done | Done | |
| RM-3 | Sandboxed frame, bridge, one repair | P0 | Done | Done | |
| RM-4 | Track agent lines per figure | P1 | Missing | Done | Failure records keep the script's lines and the dashboard gives their spread (records.ts, metrics.test.ts). |
| RM-5 | Release host exposes no generation artefacts | P0 | Done | Done | |
| CH-1 | In-app check suite under one second | P0 | Done | Done | |
| CH-2 | Offline CI checks: screenshots, depth order, line ends | P1 | Missing | Missing | The space3d tests check depth order on fixed scenes; no screenshot, rotation or line-end audit runs over figures in CI. |
| CH-3 | Failures sent to the agent for one repair | P0 | Done | Done | |
| SP-1 | Short core rules and catalog always sent; references per component | P0 | Done | Done | |
| EX-1 | Examples: three ported, then the twelve launch prompts | P0 | Partial | Done | Twelve reviewed scenes in `packages/core/scenes`, each validated, probed and kept within its size's budgets (reference-scenes.test.ts, probe.test.ts, validation.test.ts). |
| EX-2 | Evals with the twelve launch prompts and a first-attempt report | P0 | Partial | Done | `evals/prompts.json`: twelve concepts, eight to ten phrasings each; the runner reports first-attempt and post-repair rates (eval-prompts.test.ts, evals.test.ts). |
| 3D-1 | Wrap helper: split a surrounding part into back and front halves | P1 | Missing | Done | Not needed as a call: pieces of tubes, coils and large faces sort on their own (BR-5). |
| 3D-2 | Automatic depth sorting every frame; agent never orders layers | P1 | Missing | Done | space3d sorts every draw into fixed slots (kits-space3d.test.ts, C3-4). |
| MO-1 | follow, spring, idle tour, still under reduced motion | P0 | Missing | Done | `inc.motion` follow, spring, tour, ease, wave; `inc.idle` stops at the first touch and never runs under reduced motion (helpers.test.ts, controls.test.ts). |
| FX-1 | Canvas effects layer | P2 | Missing | Partial | Dot clouds on a canvas layer (`stage.dots`). No glow or fluid. |
| GL-1 | Gallery | P2 | Missing | Missing | |

## 21 Engine rules

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| EN-1 | A change redraws whether playing or paused | P0 | Done | Done | |
| EN-2 | Dirty-flag rendering | P0 | Done | Done | |
| EN-3 | Paused frames get dt = 0 | P0 | Done | Done | |
| EN-4 | Paused-tweak check in the sweep | P0 | Done | Done | |
| EN-5 | Delegated listeners written once by the engine | P0 | Done | Done | |
| EN-6 | Pointer events and capture for drag, pan, pinch | P0 | Missing | Partial | Dragging runs on pointer events with capture (interaction-view.test.ts). Panning and pinching use the same path (renderer/pointer.ts) but are untested through pointer events. |
| EN-7 | No drawing inside event handlers | P0 | Done | Done | |
| EN-8 | Host messages throttled to one per 100 ms | P1 | Done | Done | |
| EN-9 | One AbortController removes every listener | P0 | Done | Done | |
| EN-10 | Validator rejects listeners, rAF and timers | P0 | Done | Done | |
| EN-11 | No layout reads in frames; geometry rebuilt only on change | P1 | Done | Done | Scenes have no DOM; the validator flags rebuilding in frames. |
| EN-12 | One control factory | P0 | Done | Done | `ControlsView`. |

## 22 SVG

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| SV-1 | Stage with viewBox, title, description | P0 | Done | Done | |
| SV-2 | Back, mid, front layers | P0 | Done | Done | Plus a labels layer. |
| SV-3 | Element builders with change-only writes | P0 | Done | Done | |
| SV-4 | Path helpers: line, curve, arc, hull, gear, arrow | P0 | Partial | Done | `inc.path` (line, curve, param, arc, arrow) and `inc.shapes` (hull, gear and more) (scene.test.ts, helpers.test.ts). |
| SV-5 | Tone fills and shading gradients | P0 | Partial | Partial | Tone fills and strokes; `shade` gradients made once per stage with prefixed ids (renderer/dom-scene.ts). The gradients are untested; only the shade flag is (kits-space3d.test.ts). |
| SV-6 | Symbols and use | P1 | Missing | Done | `stage.repeat` draws copies with `use` (controls.test.ts). |
| SV-7 | Parts registry | P0 | Done | Done | |
| SV-8 | Pointer-to-figure mapping, capture | P0 | Missing | Done | The pointer maps into stage units; drags capture it (interaction-view.test.ts). |
| SV-9 | Zoom and pan through the viewBox | P0 | Missing | Done | View-box zoom about the pointer, non-scaling strokes, reset (interaction-view.test.ts). |
| SV-10 | Flow helper for dash motion | P1 | Missing | Done | `handle.flow(speed)` (controls.test.ts). |
| SV-11 | Ids prefixed with the figure id | P0 | Done | Done | |
| SV-12 | Element budget warning | P1 | Partial | Partial | The probe fails a scene over its size's element budget; no warning near the limit that suggests `stage.dots`. |
| SV-13 | Canvas layer sharing coordinates | P1 | Missing | Partial | `stage.dots` draws on a canvas behind or in front of the stage, in its coordinates (controls.test.ts checks the commands). The canvas painting is untested, and only dots can be drawn on it. |
| SV-14 | PNG snapshot (P0), SVG export (P2) | P0 / P2 | Partial | Partial | Snapshot only. |
| SV-15 | Accessibility | P0 | Done | Done | |
| SV-16 | Validator rejects colours, sizes, filters, counts | P0 | Done | Done | |

## 24 Teaching

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| TE-1 | `inc.steps` | P0 | Done | Done | |
| TE-2 | Animated parameter changes in steps | P1 | Done | Done | |
| TE-3 | `inc.explain` | P0 | Done | Done | |
| TE-4 | `inc.predict` | P1 | Missing | Done | Question, options, reveal by moving to its values; never scored (controls.test.ts). |
| TE-5 | `inc.compare` | P2 | Missing | Done | Faint copies of the curves while comparing (controls.test.ts). |
| TE-6 | Sensible ranges; validator rejects ranges that break the model | P0 | Done | Done | Plan bounds, singular points, probe sweep. |
| TE-7 | `inc.describe` | P0 | Done | Done | |
| TE-8 | Text lives outside the drawing | P0 | Done | Done | |
| TE-9 | Leaving steps restores the learner's values | P1 | Done | Done | |
| TE-10 | One idea sentence on the card | P0 | Done | Done | |

## 26 The 3D core

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| C3-1 | Axis-angle rotation and 3x3 maths | P0 | Missing | Done | `inc.vec.rotA`, `mul`, `apply` (helpers.test.ts). |
| C3-2 | Camera with yaw, pitch, scale, weak perspective | P0 | Missing | Done | `kits/space3d/camera.ts` (kits-space3d.test.ts). |
| C3-3 | Back-face culling against the eye vector | P0 | Missing | Done | Also under perspective (kits-space3d.test.ts). |
| C3-4 | Depth sort into fixed slots | P0 | Missing | Done | Only attribute writes, no reordering (kits-space3d.test.ts). |
| C3-5 | Orbit by drag, shared by every 3D figure | P0 | Missing | Partial | Written once in the renderer's pointer controller for every 3D stage; the camera's orbit is tested (kits-space3d.test.ts) but not the pointer drag. |
| C3-6 | Coplanar epsilon helper | P1 | Missing | Partial | The `bias` option moves a sticker toward the viewer in the depth order; untested. |
| C3-7 | Tween with commit | P0 | Done | Done | `inc.tween`. |
| C3-8 | Move queue | P1 | Partial | Partial | Tweens queue, up to 16, and play in order; the queue is untested. |
| C3-9 | Linked views on one state | P1 | Partial | Partial | Several stages in one scene read one model; no test with two linked stages, and no layout helper (VI-7). |
| C3-10 | Arc sampler | P1 | Missing | Done | `space3d.arc` and `inc.path.arc` (kits-space3d.test.ts, scene.test.ts). |
| C3-11 | 3D arrow helper | P1 | Missing | Done | `space3d.arrow` with a screen-space head and a label (kits-space3d.test.ts). |
| C3-12 | Reference grid on any plane | P2 | Missing | Partial | `grid` on the xy, xz or yz plane; only the floor is tested, and there is no grid on an arbitrary plane. |
| C3-13 | Outward label placement | P1 | Missing | Done | Labels pushed outward and kept apart (kits-space3d.test.ts). |

## 27 Repair

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| RP-1 | Probe in a hidden frame first | P0 | Done | Done | |
| RP-2 | Reports carry check, values, error, mapped line, rule | P0 | Done | Done | |
| RP-3 | Line mapping back to the agent's code | P0 | Done | Done | |
| RP-4 | One repair; a second only if the first changed output | P0 | Done | Done | |
| RP-5 | Repair sends only the report, fragments and catalog lines | P1 | Done | Done | |
| RP-6 | Repair returns only changed fragments | P1 | Done | Done | Now as edits to the current fragments (report.test.ts, pipeline.test.ts). |
| RP-7 | Runtime errors after mount freeze the frame and repair in the background | P0 | Partial | Partial | The frame keeps its last good drawing and its controls, and tells the host with the learner's state (live-figures.test.ts). No background repair. |
| RP-8 | Learner formula errors handled inline | P0 | Partial | Done | A mistake shows inline, keeps the last good formula and never reaches the agent (controls.test.ts, interaction-view.test.ts). |
| RP-9 | Fallback ladder | P0 | Done | Done | |
| RP-10 | Probe watchdog at 3 s | P0 | Done | Done | |
| RP-11 | Repair log | P1 | Done | Done | Failure records. |
| RP-12 | Recurring failures become kit functions or rules | P1 | Missing | Partial | The dashboard lists failures that recur across generations (metrics.ts, metrics.test.ts); turning one into a kit function or rule is still done by hand. |
| RP-13 | Dashboard metrics | P1 | Partial | Done | `metrics.ts` and the `metrics` CLI: pass rates, repair share, timings, lines, recurring failures (metrics.test.ts). |

## Section 25: generating in seconds

| Item | Baseline | Status | Notes |
| --- | --- | --- | --- |
| Skeleton in the first second | Done | Done | |
| Stream fragments in order | Done | Done | |
| Pre-warmed frame | Missing | Partial | The device probe runs in a frame booted while the scene is written, and kits preload from the skeleton (`warmProbe`, sandbox.spec.ts). The live figure still boots its own frame. |
| Retrieve, ask only for differences | Partial | Done | A plan for a reviewed concept starts from its scene and asks for edits (context.ts, pipeline.test.ts); the plan call names the reviewed concepts. Matching is by words, not embeddings. |
| Cache by concept | Missing | Done | `ConceptCache` by request and by plan (cache.ts, service.test.ts). |
| Speed metrics | Partial | Done | Stage timings in every record, the dashboard and the subagent bench (metrics.test.ts, bench.test.ts). |

## Section 10: non-functional requirements

These are targets rather than numbered requirements. They are not counted in the summary.

| Area | Target | Status | Notes |
| --- | --- | --- | --- |
| Time to first render | Under 1 s after the scene arrives on a mid-range iPad | Partial | In Chromium on the build machine the device probe takes 0.1 to 0.5 s and the mount about 0.12 s. Not yet measured on an iPad. |
| Frame rate | 60 fps typical, never below 30 on the oldest iPad | Partial | The perf suite records frame times while dragging (apps/playground/e2e/perf). No iPad run. |
| Engine size | Under 250 KB compressed for the core; kits on demand | Done | `npm run size`: host 16.4 KB, frame 23.6 KB and Worker 42.1 KB gzipped; kits 6.8 to 17.1 KB, loaded on demand. |
| Memory | Under 120 MB per figure; off-screen figures destroyed after 20 s | Partial | At most three live figures, suspended 8 s after leaving the screen; the perf suite tracks heap growth. No per-figure memory check. |
| Accessibility | Keyboard, text description, reduced motion, AA contrast | Done | axe WCAG 2.2 AA checks, keyboard and description tests (teaching.spec.ts, teaching-view.test.ts). |
| Offline | Engine and saved figures work without a network | Partial | Nothing at run time needs the network; there is no offline test. |
| Determinism | Same scene and values give the same result | Done | Seeded random; the probe gives the same result for a seed (probe.test.ts). |
