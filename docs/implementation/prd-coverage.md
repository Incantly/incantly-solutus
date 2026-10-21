# PRD coverage

Every numbered requirement in the [product requirements document](../Incantly%20SDK%20Product%20Requirements%20Document%20%281%29.md), checked against the code.

- **Done**: implemented and covered by tests.
- **Partial**: some of it works; the note says what is missing.
- **Missing**: not built yet.

The baseline column is the state at commit `2f8b0a1` (the end of v0.1, Phases 0 to 5). The status column is the state now.

## 6.1 Runtime core

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| RT-1 | One loop, capped time step, draw only when changed | P0 | Done | Done | `FigureRenderer` owns the only loop; `SceneRuntime.tick` caps dt and skips clean, paused frames. |
| RT-2 | Scene time, delta time, fixed-step option | P0 | Partial | Partial | Time and dt exist; no fixed step. |
| RT-3 | Reactive state store `inc.state` | P0 | Missing | Missing | Parameters live in the runtime but scenes cannot keep their own state. |
| RT-4 | Hooks: onReset, onFrame, onParamChange, onStep | P0 | Partial | Partial | Only `onFrame`. |
| RT-5 | Off-screen pause, background pause, reduced-motion start | P0 | Done | Done | IntersectionObserver, visibilitychange, reduced motion starts paused. |
| RT-6 | Seeded random | P1 | Done | Done | `inc.random`, mulberry32. |
| RT-7 | Error boundary that keeps controls alive | P0 | Done | Done | Guarded phases; the last good frame stays. |

## 6.2 Controls

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| CT-1 | Play, pause, restart, speed 0.25x to 4x | P0 | Done | Done | |
| CT-2 | `inc.param` slider with number entry and live value | P0 | Done | Done | |
| CT-3 | toggle, choice, button, color | P0 | Missing | Missing | |
| CT-4 | Timing panel: duration, loop mode, easing, frame-rate cap, frame step | P0 | Missing | Missing | |
| CT-5 | Reset to authored values, undo and redo | P1 | Partial | Partial | Reset only. |
| CT-6 | Presets | P1 | Missing | Missing | |
| CT-7 | Step-through mode | P1 | Done | Done | `inc.steps`. |
| CT-8 | Linked parameters | P1 | Missing | Missing | |
| CT-9 | Settings panel (gear menu) | P0 | Missing | Missing | |
| CT-10 | Keyboard and screen-reader access for every control | P0 | Done | Done | Native inputs, labels, axe checks in e2e. |

## 6.3 Formulas and maths

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| FM-1 | Safe expression parser, never eval | P0 | Done | Done | `packages/core/src/expr`. |
| FM-2 | Editable expression text, validated and recompiled, inline errors | P0 | Missing | Missing | Formulas are shown, not editable. |
| FM-3 | Formula variables bound to parameters both ways | P0 | Partial | Partial | Parameters feed formulas; editing the formula is missing. |
| FM-4 | Rendered maths display | P1 | Missing | Missing | |
| FM-5 | Built-ins: trig, exp, log, abs, min, max, piecewise, sign, floor, noise | P0 | Partial | Partial | No `piecewise` or `noise`. |
| FM-6 | Derivative, integral, root finding, interpolation | P1 | Missing | Missing | |
| FM-7 | ODE integrators (Euler, RK4) | P1 | Missing | Missing | |
| FM-8 | Units and conversions for display | P1 | Missing | Missing | |
| FM-9 | Vector and matrix helpers | P1 | Missing | Missing | |

## 6.4 2D graph

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| G2-1 | `inc.graph2d` with ranges, grid, axes, labels | P0 | Done | Done | |
| G2-2 | y=f(x), x=f(y), parametric and polar curves | P0 | Partial | Partial | y=f(x) and parametric only. |
| G2-3 | Scatter, lines, bars, histograms, area under a curve, shaded regions | P0 | Missing | Missing | |
| G2-4 | Vector arrows, vector fields, slope fields | P1 | Partial | Partial | Single arrows only. |
| G2-5 | Implicit curves and shaded inequalities | P2 | Missing | Missing | |
| G2-6 | Zoom, pan, reset, axis auto-fit | P0 | Missing | Missing | |
| G2-7 | Trace a point along a curve | P0 | Missing | Missing | |
| G2-8 | Roots, extrema, intersections marked | P1 | Missing | Missing | |
| G2-9 | Multiple curves with legend and visibility toggles | P0 | Partial | Partial | Several curves, no legend. |
| G2-10 | Draggable handles bound to parameters | P1 | Missing | Missing | |
| G2-11 | Annotations: text, arrows, brackets, dimension lines | P1 | Partial | Partial | Labels and arrows only. |
| G2-12 | Log scales and unit labels | P1 | Missing | Missing | |
| G2-13 | Curve draws over time, moving point with trail | P0 | Partial | Partial | Trails yes; progressive drawing no. |

## 6.5 3D graph

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| G3-1 | `inc.graph3d` | P1 | Missing | Missing | |
| G3-2 | Surfaces with depth sorting | P1 | Missing | Missing | |
| G3-3 | 3D parametric curves and surfaces | P1 | Missing | Missing | |
| G3-4 | Points, vectors, planes, lines in 3D | P1 | Missing | Missing | |
| G3-5 | Orbit, zoom, camera presets, reset | P1 | Missing | Missing | |
| G3-6 | Cross-section slider and contours | P2 | Missing | Missing | |
| G3-7 | Mesh budget on slow devices | P1 | Missing | Missing | |

## 6.6 3D space

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| S3-1 | `inc.space3d` | P1 | Missing | Missing | |
| S3-2 | Box, sphere, cylinder, cone, plane, torus, arrow, line, label | P1 | Missing | Missing | |
| S3-3 | Groups and parent transforms | P1 | Missing | Missing | |
| S3-4 | Shading, back-face culling, painter's sort | P1 | Missing | Missing | |
| S3-5 | Isometric and orbit modes | P1 | Missing | Missing | |
| S3-6 | Named parts with highlight, callouts, legend | P1 | Missing | Missing | |
| S3-7 | Exploded view | P2 | Missing | Missing | |
| S3-8 | Field and flow lines | P2 | Missing | Missing | |
| S3-9 | Asset library | P2 | Missing | Missing | |
| S3-10 | Object budget | P1 | Missing | Missing | |

## 6.6b 2D scene and physics

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| PH-1 | `inc.physics2d` | P1 | Missing | Missing | |
| PH-2 | Circle, rectangle, polygon bodies | P1 | Missing | Missing | |
| PH-3 | Springs, ropes, hinges, motors, pulleys | P1 | Missing | Missing | |
| PH-4 | Gravity, drag, buoyancy, magnetic and electric forces | P1 | Missing | Missing | |
| PH-5 | Fluid tank helper | P1 | Missing | Missing | |
| PH-6 | Live force arrows and decomposition | P1 | Missing | Missing | |
| PH-7 | Collision events and sensors | P2 | Missing | Missing | |
| PH-8 | Fixed time step and substepping | P0 | Missing | Missing | |

## 6.7 Diagrams and charts

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| DG-1 | Shapes, arrows, connectors, braces, labels, callouts | P0 | Partial | Partial | Primitive shapes and arrows; no connectors, braces or callouts. |
| DG-2 | Number line, table, readout panel, key-value values | P0 | Partial | Partial | Readout panel only. |
| DG-3 | Line, bar, pie, stacked, histogram, box plot charts | P1 | Missing | Missing | |
| DG-4 | Flowchart and graph layout | P1 | Missing | Missing | |
| DG-5 | Rendered equations and chemical formulas | P1 | Missing | Missing | |
| DG-6 | Domain kits | P1 | Missing | Missing | |

## 6.8 View and interaction

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| VI-1 | Zoom, pan, reset; pinch and double-tap | P0 | Missing | Missing | |
| VI-2 | Tap-to-activate | P0 | Missing | Missing | |
| VI-3 | `part` registry for highlight, dimming, callouts | P0 | Done | Done | |
| VI-4 | Draggable handles bound to a parameter or point | P1 | Missing | Missing | |
| VI-5 | Measurement tool | P2 | Missing | Missing | |
| VI-6 | Fullscreen, responsive layout, safe-area padding | P0 | Partial | Partial | Responsive only. |
| VI-7 | Multi-panel layout with linked panels | P1 | Partial | Partial | Several stages share one model; no layout helper. |

## 6.9 and 6.10 Theme and output

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| 6.9a | Design tokens as CSS variables, light and dark | P0 | Done | Done | `THEME_CSS`. |
| 6.9b | Agent CSS uses tokens only | P0 | Done | Done | CSS validator. |
| 6.9c | One type scale and one control style | P0 | Done | Done | |
| 6.9d | 36 px minimum touch targets | P0 | Done | Done | 44 px on coarse pointers. |
| 6.10a | PNG snapshot | P0 | Done | Done | |
| 6.10b | SVG, GIF or video export | P2 | Missing | Missing | |
| 6.10c | Print-friendly render | P2 | Partial | Partial | Print stylesheet with the description; no static print render. |

## 7 Host (TipTap)

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| HO-1 | Node stores fragments, values and snapshot | P0 | Done | Done | |
| HO-2 | Node view renders the sandboxed frame and bridge | P0 | Done | Done | |
| HO-3 | Bridge messages in and out | P0 | Done | Done | |
| HO-4 | Mount near the viewport; snapshot otherwise | P0 | Done | Done | |
| HO-5 | Snapshot and destroy after time off-screen | P0 | Done | Done | |
| HO-6 | At most three live figures | P0 | Done | Done | |
| HO-7 | One repair retry, then snapshot with a retry button | P0 | Done | Done | |
| HO-8 | Regenerate and edit by prompt | P1 | Partial | Partial | Regenerate only. |
| HO-9 | Version history | P2 | Missing | Missing | |

## 15 to 20 Borrowed mechanisms and kit requirements

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| BR-1 | Short rules plus references only when needed | — | Done | Done | Contract excerpts per capability. |
| BR-2 | Plan before code | — | Done | Done | |
| BR-3 | One model drives everything | — | Done | Done | |
| BR-4 | Geometry once, move with transforms | — | Done | Done | Validator rules. |
| BR-5 | Painter's order and wrap helper | — | Missing | Missing | Needs space3d. |
| BR-6 | Tone hierarchy, no hard-coded colours | — | Done | Done | |
| BR-7 | Card: number, title, hint, readout, legend | — | Partial | Partial | Idea and readouts; no title, hint or legend. |
| BR-8 | Calm motion helpers | — | Missing | Missing | |
| BR-9 | Fast in-app checks | — | Done | Done | The probe. |
| BR-10 | Examples and evals | — | Partial | Partial | Three examples. |
| BR-11 | Sizes | — | Missing | Missing | |
| BR-12 | WebGL or canvas layer | P2 | Missing | Missing | |
| BR-13 | Community gallery | P2 | Missing | Missing | |
| PL-1 | Two-stage generation | P0 | Done | Done | |
| PL-2 | Plan validator | P0 | Done | Done | |
| PL-3 | Size classes with budgets | P0 | Missing | Missing | |
| MD-1 | `inc.model` | P0 | Done | Done | |
| MD-2 | Validator flags computed numbers typed into text | P1 | Done | Done | Rule `typed-number`. |
| RM-1 | Shell loader | P0 | Done | Done | |
| RM-2 | Fragment validator | P0 | Done | Done | |
| RM-3 | Sandboxed frame, bridge, one repair | P0 | Done | Done | |
| RM-4 | Track agent lines per figure | P1 | Missing | Missing | |
| RM-5 | Release host exposes no generation artefacts | P0 | Done | Done | |
| CH-1 | In-app check suite under one second | P0 | Done | Done | |
| CH-2 | Offline CI checks: screenshots, depth order, line ends | P1 | Missing | Missing | |
| CH-3 | Failures sent to the agent for one repair | P0 | Done | Done | |
| SP-1 | Short core rules and catalog always sent; references per component | P0 | Done | Done | |
| EX-1 | Examples: three ported, then the twelve launch prompts | P0 | Partial | Partial | Three of twelve. |
| EX-2 | Evals with the twelve launch prompts and a first-attempt report | P0 | Partial | Partial | Runner exists; three concepts. |
| MO-1 | follow, spring, idle tour, still under reduced motion | P0 | Missing | Missing | |
| FX-1 | Canvas effects layer | P2 | Missing | Missing | |
| GL-1 | Gallery | P2 | Missing | Missing | |

## 21 Engine rules

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| EN-1 | A change redraws whether playing or paused | P0 | Done | Done | |
| EN-2 | Dirty-flag rendering | P0 | Done | Done | |
| EN-3 | Paused frames get dt = 0 | P0 | Done | Done | |
| EN-4 | Paused-tweak check in the sweep | P0 | Done | Done | |
| EN-5 | Delegated listeners written once by the engine | P0 | Done | Done | |
| EN-6 | Pointer events and capture for drag, pan, pinch | P0 | Missing | Missing | |
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
| SV-4 | Path helpers: line, curve, arc, hull, gear, arrow | P0 | Partial | Partial | No hull or gear. |
| SV-5 | Tone fills and shading gradients | P0 | Partial | Partial | Tones yes; gradients no. |
| SV-6 | Symbols and use | P1 | Missing | Missing | |
| SV-7 | Parts registry | P0 | Done | Done | |
| SV-8 | Pointer-to-figure mapping, capture | P0 | Missing | Missing | |
| SV-9 | Zoom and pan through the viewBox | P0 | Missing | Missing | |
| SV-10 | Flow helper for dash motion | P1 | Missing | Missing | |
| SV-11 | Ids prefixed with the figure id | P0 | Done | Done | |
| SV-12 | Element budget warning | P1 | Partial | Partial | Hard limit and probe budget; no warning. |
| SV-13 | Canvas layer sharing coordinates | P1 | Missing | Missing | |
| SV-14 | PNG snapshot (P0), SVG export (P2) | P0 / P2 | Partial | Partial | Snapshot only. |
| SV-15 | Accessibility | P0 | Done | Done | |
| SV-16 | Validator rejects colours, sizes, filters, counts | P0 | Done | Done | |

## 24 Teaching

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| TE-1 | `inc.steps` | P0 | Done | Done | |
| TE-2 | Animated parameter changes in steps | P1 | Done | Done | |
| TE-3 | `inc.explain` | P0 | Done | Done | |
| TE-4 | `inc.predict` | P1 | Missing | Missing | |
| TE-5 | `inc.compare` | P2 | Missing | Missing | |
| TE-6 | Sensible ranges; validator rejects ranges that break the model | P0 | Done | Done | Plan bounds, singular points, probe sweep. |
| TE-7 | `inc.describe` | P0 | Done | Done | |
| TE-8 | Text lives outside the drawing | P0 | Done | Done | |
| TE-9 | Leaving steps restores the learner's values | P1 | Done | Done | |
| TE-10 | One idea sentence on the card | P0 | Done | Done | |

## 26 The 3D core

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| C3-1 | Axis-angle rotation and 3x3 maths | P0 | Missing | Missing | |
| C3-2 | Camera with yaw, pitch, scale, weak perspective | P0 | Missing | Missing | |
| C3-3 | Back-face culling against the eye vector | P0 | Missing | Missing | |
| C3-4 | Depth sort into fixed slots | P0 | Missing | Missing | |
| C3-5 | Orbit by drag, shared by every 3D figure | P0 | Missing | Missing | |
| C3-6 | Coplanar epsilon helper | P1 | Missing | Missing | |
| C3-7 | Tween with commit | P0 | Done | Done | `inc.tween`. |
| C3-8 | Move queue | P1 | Partial | Partial | Tweens queue; no named moves. |
| C3-9 | Linked views on one state | P1 | Partial | Partial | Several stages read one model. |
| C3-10 | Arc sampler | P1 | Missing | Missing | |
| C3-11 | 3D arrow helper | P1 | Missing | Missing | |
| C3-12 | Reference grid on any plane | P2 | Missing | Missing | |
| C3-13 | Outward label placement | P1 | Missing | Missing | |

## 27 Repair

| ID | Requirement | P | Baseline | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| RP-1 | Probe in a hidden frame first | P0 | Done | Done | |
| RP-2 | Reports carry check, values, error, mapped line, rule | P0 | Done | Done | |
| RP-3 | Line mapping back to the agent's code | P0 | Done | Done | |
| RP-4 | One repair; a second only if the first changed output | P0 | Done | Done | |
| RP-5 | Repair sends only the report, fragments and catalog lines | P1 | Done | Done | |
| RP-6 | Repair returns only changed fragments | P1 | Done | Done | |
| RP-7 | Runtime errors after mount freeze the frame and repair in the background | P0 | Partial | Partial | The frame freezes; no background repair. |
| RP-8 | Learner formula errors handled inline | P0 | Partial | Partial | Nothing to handle until formulas are editable (FM-2). |
| RP-9 | Fallback ladder | P0 | Done | Done | |
| RP-10 | Probe watchdog at 3 s | P0 | Done | Done | |
| RP-11 | Repair log | P1 | Done | Done | Failure records. |
| RP-12 | Recurring failures become kit functions or rules | P1 | Missing | Missing | |
| RP-13 | Dashboard metrics | P1 | Partial | Partial | Eval summaries; no dashboard. |

## Section 25: generating in seconds

| Item | Baseline | Status | Notes |
| --- | --- | --- | --- |
| Skeleton in the first second | Done | Done | |
| Stream fragments in order | Done | Done | |
| Pre-warmed frame | Missing | Missing | |
| Retrieve, ask only for differences | Partial | Partial | Nearest example is sent; the whole scene is still written. |
| Cache by concept | Missing | Missing | |
| Speed metrics | Partial | Partial | Plan, first fragment and scene timings are recorded. |
