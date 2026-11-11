# Findings: view

Checker pass 1 at commit `1525786` on `feat/view`. Machines are in `docs/state-machines.md`, part "view" (V1 to V14). Paths are under `packages/view/src/`. Every finding marked "Reproduced" was run through the public API (`@incantly/view`) in happy-dom with a scratch probe that has since been deleted; the numbers quoted are its output. "Code path" means the path is certain from the code but was not run.

Ranked by impact: security, hangs and crashes, wrong results, wrong errors, speed, cosmetic. Related bugs that share one fix are grouped into one finding.

| Impact | Findings |
|---|---|
| Security | VIEW-SM-1 to VIEW-SM-4 |
| Hangs and crashes | VIEW-SM-5 to VIEW-SM-7 |
| Wrong results | VIEW-SM-8 to VIEW-SM-19 |
| Wrong errors | VIEW-SM-20 |
| Speed | VIEW-SM-21 to VIEW-SM-26 |
| Cosmetic | VIEW-SM-27 |

## Security

### VIEW-SM-1. SVG export writes `textStyle.family` raw into a CSS `style` attribute

- **Evidence:** `core/styles.ts` line 597 copies `authored.textStyle.family` without validation; `backends/svg.ts` line 212 builds `style="font-size:..;font-family:${svgEscape(family)};"`. `svgEscape` stops the attribute from closing but not `;`. Reproduced: a text object with `textStyle.family = 'x;fill:url(https://evil.example/beacon)'` exports `style="font-size:14px;font-family:x;fill:url(https://evil.example/beacon);"`. A shared figure file can make every exported SVG fetch a remote URL when opened (tracking) or restyle the text. The same string also goes into `ctx.font` in `backends/canvas2d.ts`.
- **Invariant broken:** V14, untrusted text reaches SVG only as escaped text content or a quoted attribute value, never as raw CSS.
- **Suggested fix:** validate `family` in `resolveStyle` against a font-list grammar (letters, digits, spaces, hyphens, commas, quotes; at most 200 characters) and fail with `bad_property_value` otherwise. In `SvgSurface.text`, emit `font-family="..."` as its own attribute instead of inside `style`. Apply the same check to every authored string that reaches CSS or `ctx.font`.
- **status:** open

### VIEW-SM-2. The 300-label budget is not enforced

- **Evidence:** `web/figure-view.ts` `layoutLabels` (line 741) places only the first 300 requests, but `paintEntries` and `paintDrawables` call `paintLabel` on every drawable, and `GeometryDrawable.paintLabel` paints with its last offset or the default `{6, -6}`. Reproduced: 400 labelled points export 400 `<text>` elements. `checkLabels`, `checkTriangles` and `capCurveSamples` in `core/budgets.ts` have no caller, so no notice is ever raised. The 300 are taken in draw-list order, including labels outside the viewport, so off-screen labels can push visible ones out. A curve with many runs is capped per run, not per curve (`core/geometry.ts` `buildGeometry` case `curve`).
- **Invariant broken:** V10 and V11, at most 300 labels paint, lowest priority first, only labels in the viewport count, with a notice (performance.md 5).
- **Suggested fix:** cull label requests to the viewport, sort by a priority (selected, focused, points, then the rest by order), keep the first 300, call `clearLabelOffset` on the rest and make `paintLabel` skip a drawable with no placement this frame. Raise `checkLabels` through a new `onNotice` option. Cap total samples per curve across runs.
- **status:** open

### VIEW-SM-3. The SVG element cap is checked only after the whole document is built

- **Evidence:** `web/figure-view.ts` line 2431 tests `svg.elementCount > MAX_SVG_ELEMENTS` after every drawable, label and particle has been written. Reproduced: a 30,000-point figure builds the full document (127 ms) before returning `V001 limit`. The cap counts elements, not bytes: 5,000 curves of 4,000 samples stay under 50,000 elements and return a document of several hundred MB with no refusal (code path).
- **Invariant broken:** V11, a cap stops the work before the work is done.
- **Suggested fix:** check the element count inside `SvgSurface` as each element is pushed and stop painting once it is passed; add a byte budget (for example 64 MB) tracked the same way, refused with the same `limit` error.
- **status:** open

### VIEW-SM-4. Caches that grow without bound

- **Evidence:** `backends/canvas2d.ts` line 114, `hatchPatternCache` is keyed by `JSON.stringify({ spec, color })` and never evicted. Reproduced: 1,000 fills with animated hatch colours created 1,000 tile canvases; a colour driven by `t` adds about 60 per second for the life of the figure. `backends/webgl2.ts` lines 73 to 75 and 245 push every handle into `owned` and never remove disposed ones, so each `resizeBox` (every resize event of a 3D figure) keeps 5 to 7 more dead handles.
- **Invariant broken:** V2 and V11, caches are bounded and `owned` holds only live handles.
- **Suggested fix:** make the hatch cache a small LRU (for example 64 entries) keyed on quantised colour. Store handles in a `Set`, and remove them in each `dispose` closure (target, arena, program).
- **status:** open

## Hangs and crashes

### VIEW-SM-5. Polar and isometric grids have no line cap

- **Evidence:** `core/grid.ts` line 249 makes polar circles from `step` up to the view's distance from the origin, not the circles that cross the view. Reproduced: a view centred at x = 1e6 gives 707,112 circles; `paintGrid` strokes each with up to 256 segments on every background repaint (every pan frame), which freezes the tab. The iso loop in `web/figure-view.ts` line 821 runs `2 * diag / stepPx` iterations with a `@grid` step taken as given: a step of 1e-6 at 50 px per unit is about 1.2e8 strokes. The cartesian path is capped at 100,001 ticks per axis, but still makes 200,002 axis labels (37 ms to format, before measuring and painting them).
- **Invariant broken:** grid drawing cost is bounded by the view size (design 5, "Drawing cost").
- **Suggested fix:** for polar, generate only radii between the nearest and farthest view corner distances, and skip circles whose pixel radius exceeds `MAX_DRAW_PX`. For every grid kind, refuse or coarsen a fixed step whose pixel spacing is under 4 px, and cap lines per frame (for example 2,000).
- **status:** open

### VIEW-SM-6. WebGL context loss is never handled

- **Evidence:** no `webglcontextlost` or `webglcontextrestored` listener exists in `web/shared-context.ts` or anywhere else (code path). During loss every call returns `internal` and `paintScene3D` falls back to the software path for boxes whose target became null. After the browser restores the context, `isContextLost()` is false again but every target in `boxes`, and every program and arena cached in each `Figure3D` (`ensureResources` creates them once), is a dead handle, so 3D figures stay blank until reload. Chromium drops contexts under memory pressure and on GPU resets, so long documents reach this. Separately, two `FigureView`s with the same `id` share one box and canvas (`acquireBox` returns the existing box), and `releaseBox` from one blanks the other.
- **Invariant broken:** V2 and V12, after a restore every box and every `Figure3D` gets fresh resources; a box belongs to one figure.
- **Suggested fix:** listen on the shared canvas; on loss call `preventDefault()` and set a `lost` flag; on restore build a new `WebGL2Backend`, recreate every box target and bump a `generation` counter that `Figure3D.ensureResources` compares to drop and rebuild programs and arenas. Refuse `acquireBox` for an id held by another owner (return `internal`, or key boxes by an owner token).
- **status:** open

### VIEW-SM-7. A FigureView mounted again after `unmount` never draws

- **Evidence:** `web/figure-view.ts` `unmount` (line 360) sets `destroyed = true`, and `mount` never resets it. `requestFrame` returns early while `destroyed` is true. Reproduced: `unmount()`, then `mount(el2)` returns `ok`, `applyEvents` queues 0 frames and the reader list stays empty. A host that unmounts on the scheduler's `save` and mounts again on `restore` gets a dead figure with no error.
- **Invariant broken:** V3, a mounted figure draws when something is dirty.
- **Suggested fix:** either support remount (reset `destroyed`, `pending` and the caches in `mount`, and recreate `figure3d` resources) or make `mount` after `unmount` return a `V999 internal` error that says to create a new view. Document which.
- **status:** open

## Wrong results

### VIEW-SM-8. Dragging a shape by its body moves its parents too far

- **Evidence:** `web/figure-view.ts` line 1492: for plan `parents`, each move sends `valueOf(parent) + (pointer - startPointer)`. `valueOf` already includes the previous moves, so the offset is added again on every move. Reproduced: segment A(-2, 0) to B(2, 0), pointer dragged 2 units right in 10 moves: A ends at x = 9, expected 0.
- **Invariant broken:** V6, a parents drag moves each parent by the pointer delta from its value at drag start (design 12.5).
- **Suggested fix:** record each parent's value at drag start in the `DragSession` and send `start + delta`. Apply the same rule to every plan kind that moves by a delta (the 3D path does not have one yet).
- **status:** open

### VIEW-SM-9. Drag sessions that end without commit or cancel, or commit twice

- **Evidence:**
  - Second pointer during a drag (`onPointerDown` line 1253): `drag = null` with no `commitDrag` or `cancelDrag`. Reproduced log: `["drag"]` and nothing more.
  - Arrow key during a drag (`moveSelected`, line 1741): the dragged point is selected, so the nudge runs `drag` + `commitDrag` inside the open drag. Reproduced log: `drag, drag, commit, drag, drag, commit`.
  - Esc during a label drag (line 1716): sends `cancelDrag` to a kernel that never started a drag and leaves `labelOverride` set. Reproduced: the label stays at the preview position (SVG text moved from (606, 427.2) to (666, 487) after Esc), log `["cancel"]`.
  - Esc during a 3D point drag: only `this.drag` is checked, so `point3Drag` stays open (code path).
  - `pointercancel` is wired to `onPointerUp`, so a browser-cancelled gesture commits (code path).
  - `unmount` during any drag sends nothing (code path).
- **Invariant broken:** V5 and V6, every kernel drag ends in exactly one commit or cancel; no nudge commits while a pointer drag is open; `cancelDrag` only for an open drag.
- **Suggested fix:** one `endDrag(how: 'commit' | 'cancel')` that clears `drag`, `point3Drag`, `labelOverride`, `snapIndicator` and the snap memory, and calls the kernel only when a `kernel.drag` was sent. Call it with `cancel` from pinch start, Esc (2D, 3D, label), `pointercancel` and `unmount`; with `commit` from pointer up. Ignore arrow nudges and Delete while a pointer session is open.
- **status:** open

### VIEW-SM-10. Point-on-path drags send the wrong parameter

- **Evidence:** `core/drag.ts` line 265, `projectOnSamples` returns `s` as a fraction 0..1, and `applyDragMove` sends it after `clampParam(s, info.domain)`. Reproduced: a point on a sampled function with domain -5..5, pointer at x = 3, sends `s = 0.8`. Design 12.4 defines `s = x` for functions. With grid snap on, `snapParamToGrid` (`core/snap.ts` line 138) takes no pointer and returns the sample closest to any grid point over the whole path: pointers at x = 3 and x = -4 both send `s = 0.7`, so the point cannot be dragged. `hintS` is the constant `null` (`web/figure-view.ts` line 1318), so the 24 px continuity window and the closed-path wrap in `projectOnPath` never run.
- **Invariant broken:** V6, a path drag sends `s` in the path's domain units, near the pointer, continuous with the previous `s` (design 12.4, 13.4).
- **Suggested fix:** map the fraction to `domain.lo + f * (domain.hi - domain.lo)` (or have `PathInfo` carry the parameter per sample). Give `snapParamToGrid` the projected point and accept only grid intersections within 12 px of it. Keep the last sent `s` in the session as the hint, and pass the pointer travel so the 60 px escape works.
- **status:** open

### VIEW-SM-11. The canvas surface draws arc commands as straight lines

- **Evidence:** `backends/canvas2d.ts` line 69: an `A` command becomes `ellipse(x, y, 0, 0, ...)` plus `lineTo(x, y)`. Reproduced: the circle path used by points traces `moveTo(14,10) ellipse(6,10,0,0,0,0,0) lineTo(6,10) ellipse(14,10,0,0,0,0,0) lineTo(14,10) closePath()`, a flat line with no area. Every `dot` and `ring` point marker, the point hover, selection and focus halos, and CPU particle sprites (`spritePath`) draw as horizontal lines on screen and in PNG export. SVG export is correct because it writes `A` directly.
- **Invariant broken:** every surface draws the same path the same way (design 6, "One surface interface").
- **Suggested fix:** convert SVG arc parameters to centre form and call `ctx.ellipse(cx, cy, rx, ry, rot, a0, a1, ccw)`, or have `circleCommands` and `spritePath` use a dedicated circle command that maps to `ctx.arc`.
- **status:** open

### VIEW-SM-12. Selection holds hidden, removed or unreachable objects

- **Evidence:** Ctrl+A (`web/figure-view.ts` lines 1847 and 2231) selects every `kernel.heads()` id. Reproduced: with H styled `show = false`, Ctrl+A then Delete calls `onDelete([1, 2])` and deletes the hidden object. The rubber band never selects points: `GeometryDrawable.rubberShape` for a point has no strokes and no fills. Reproduced: a band around a point with bbox 395..405 selects nothing (texts and widgets behave the same). Kernel `remove` events do not prune `selection`, `focused` or `hovered`. Reproduced: after A is removed, Delete still reports A.
- **Invariant broken:** V7, Ctrl+A selects visible selectable objects; the band selects every object whose bbox meets it (design 11); selection holds only existing ids.
- **Suggested fix:** build Ctrl+A from draw-list entries with a non-null bbox. In `rubberBandSelect`, include shapes with no runs by bbox overlap (pass the bbox in `RubberBandShape`). Prune `selection`, `focused`, `hovered` and `highlights` on `remove` events in `frame`.
- **status:** open

### VIEW-SM-13. Scheduler flapping, `ready` figures that never free, and stale actions on re-entry

- **Evidence:** `core/scheduler.ts` line 190 breaks only when the victim was touched strictly later. Reproduced: four untouched figures in view yield `pause(a) goLive(d)`, then `pause(b) goLive(a)`, `pause(a) goLive(b)` on every 500 ms tick forever, rebuilding and pausing figures. Step 5 (line 202) saves only `paused` figures. Reproduced: a figure built while near but not in view is still `ready` after 120 s far away, with no action, so its kernel and geometry are never freed. `SchedulerHost.tick` (`web/scheduler-host.ts` line 95) dispatches while a callback may tick again. Reproduced: an `onAction` that calls `touch` on `goLive` makes the outer loop dispatch `goLive(b)` twice and `goLive(c)` for a record already `paused`.
- **Invariant broken:** V1, unchanged inputs produce no actions; every built figure off screen for 8 s is saved; actions match the state the tick produced.
- **Suggested fix:** break unless the victim is strictly older than the candidate (`>=`) and never pick a figure promoted in this tick. Treat `ready` like `paused` for the leave and save rules (`ready` not in view goes `paused` with the off-screen timer). In the host, set a `ticking` flag; a nested `tick` request sets `again = true` and the outer tick runs once more after dispatching.
- **status:** open

### VIEW-SM-14. Export leaves live drawables at the export viewport

- **Evidence:** `exportSvg` and `exportPng` (`web/figure-view.ts` lines 2378 and 2491) rebuild every drawable at the export viewport and only request a frame. Until that frame runs, hit tests and drags use export pixels. Reproduced: a hit test at point A's live position finds 1 candidate before an export, 0 after it, and 1 again after the next frame.
- **Invariant broken:** V4, live drawables hold live geometry whenever input can reach them.
- **Suggested fix:** after painting the export, mark all drawables dirty and run `updateDrawables` with the live viewport and the hit-index callback before returning, or export through fresh drawables built for the export.
- **status:** open

### VIEW-SM-15. A resize during a view tween is overwritten

- **Evidence:** `frame` (line 578 onwards) sets `view = tweenViewport(from, to, t)`, and both viewports keep the size from when the tween started. Reproduced: `setViewRegion(..., 0.02)`, then the element shrinks to 400 px and `resize()` runs; after the tween the viewport is still 800 px wide.
- **Invariant broken:** V3, `view` size equals the element size after any resize.
- **Suggested fix:** in `resize`, rebuild `tween.from` and `tween.to` at the new size (the same centre and scales), or let `tweenViewport` take the current size.
- **status:** open

### VIEW-SM-16. Fit-all and the `objects` export region ignore shapes outside the view

- **Evidence:** `fitAll` and `objectBoundsMaths` convert drawable pixel bboxes back to maths, but segments, lines, polygons and regions are clipped to the view, and fully off-screen ones have `bbox = null`. Reproduced: a point at the origin and a segment from x = 20 to 30; after `fitAll` the view is 0.309 units wide around the point and the segment is not in it. `region: 'objects'` uses the same bounds.
- **Invariant broken:** fit-all covers every visible object (ui.md fit button, design 14.2 `objects`).
- **Suggested fix:** compute bounds in maths units from kernel values (one small `mathsBounds(value)` per value kind) instead of from clipped pixels.
- **status:** open

### VIEW-SM-17. 3D: invisible lines without WebGL2, fixed points nudged, unchecked arena writes

- **Evidence:** `Figure3D.drawLines` sends line quads in `LINE_LAYOUT` (end, other, side, colour) as `triangles`; `SoftwareBackend.draw` reads them as position plus colour and never applies `side`. Reproduced: a segment alone paints 2 triangles traced `moveTo(192,182) lineTo(208,118) lineTo(208,118)`, zero area, so every 3D segment and curve is invisible on the software fallback, with colours read from the wrong offsets. `moveSelected3` (`web/figure-view.ts` line 2168) checks only `head.free`. Reproduced: a `point3` styled `fixed`, Ctrl+A then ArrowRight logs `drag {x: 1}` and `commit`. `uploadAll` and `drawLines` write into fixed arenas (mesh 24 MB, points 2 MB, lines 8 MB) with no bound check; past about 58,000 line segments or 65,536 points the GL writes fail and items go missing (code path).
- **Invariant broken:** V9 and V12, every back-end draws every item kind it receives; `fixed` blocks every move; arenas are never written past capacity.
- **Suggested fix:** give the software back-end a `lines` path for `LINE_LAYOUT` (draw the segment from `end` to `other` with the colour at offset 5), or have `Figure3D` send software back-ends plain `lines` batches. Check `fixed` in `moveSelected3`. Size arenas from the scene or grow them, and refuse past capacity with the triangle and point budgets plus a notice.
- **status:** open

### VIEW-SM-18. Snapping ignores intersections and snaps to descendants

- **Evidence:** `snapContext` (`web/figure-view.ts` line 1244) always passes `intersections: []`. Reproduced: with `intersections` returning (1, 0) and snap mode `points`, the option is called 0 times and the drag to x = 0.9 is not snapped. The point candidates exclude only the dragged id, not its descendants (design 13.2), so dragging A near B can snap A onto `Midpoint(A, B)`, which moves with A (code path). `snapMem` is never reset between drags, and a hold on a point reports `source: grid` (`core/snap.ts` line 126), so the indicator reads "grid" (code path).
- **Invariant broken:** V8.
- **Suggested fix:** call `opts.intersections(pointer)` in `snapContext` for `points`, `grid+points` and `auto` without a grid; exclude descendants (add a `descendantsOf` reader to `KernelView`, or let the kernel mark them); reset `snapMem` at drag start; keep the held source in the memory.
- **status:** open

### VIEW-SM-19. Particles are never drawn in the live 2D view

- **Evidence:** `GeometryDrawable.update` returns no geometry for `particles`, `paint` draws nothing for them, and nothing in `web/` calls `chooseParticleRenderer`, `spritePath`, `packUniforms` or `ParticleQuality` (code path). Only SVG export (`paintParticlesSvg`) draws particles. The builder notes list animation-time 10.5 to 10.8 as done.
- **Invariant broken:** particle systems draw in their layer at rank 5 (design 8, animation-time 10.5).
- **Suggested fix:** add the particle pass to `paintEntries`: the CPU path via `evalCpu` and `spritePath` on the scene surface, and the GPU path through the shared context when `chooseParticleRenderer` picks it, with `ParticleQuality` fed by frame time.
- **status:** open

## Wrong errors

### VIEW-SM-20. Axis-drag rescale and 3D keyboard zoom bypass the zoom limits

- **Evidence:** `rescaleAxis` (`web/figure-view.ts` line 1426) builds a viewport directly, skipping the 1e-9 to 1e9 width limits and the precision floor in `zoomAbout`, and never reports `zoom_limit` or `precision_limit`. The 3D `+` and `-` keys (line 2195) multiply `zoom` with no clamp, while the wheel clamps to 1e-6..1e6 (code path).
- **Invariant broken:** V5 and V9, every zoom input respects the same limits and gives the same feedback (design 4).
- **Suggested fix:** route the axis rescale through a per-axis variant of `zoomAbout` that applies the limits and returns `refused`, and emit the gesture. Clamp the keyboard zoom like the wheel.
- **status:** open

## Speed

### VIEW-SM-21. Label layout is too slow on large figures

- **Evidence:** `layoutLabels` adds a marker for every labelled point, with no viewport cull, and `placeLabels` tests each candidate of each auto label against every placed rect and every marker. Reproduced: 300 labels with 5,000 markers take 128 ms per frame; with 300 markers, 6.1 ms (the builder's bench measured 0.6 ms with no markers). A drag in a 500-point figure takes 18.1 ms per frame and a 5,000-point figure 127 ms, before any painting (happy-dom, no canvas). Design 7.3 budgets 6 ms for update plus layout plus paint at 500 objects.
- **Invariant broken:** V10, layout cost stays within the frame budget.
- **Suggested fix:** cull labels and markers to the viewport; put placed rects and markers in a 64 px grid (like `HitIndex`) so each candidate tests only nearby items; during a drag re-place only labels near the active drawables.
- **status:** open

### VIEW-SM-22. The partial-repaint cache misses on every drag frame

- **Evidence:** the cache key at `web/figure-view.ts` line 980 includes `paintVersion`, which `applyEvents` increments on every kernel update, which a drag sends on every move. Every drag frame therefore repaints `lower` and `upper` and creates a full-size `live` canvas, which costs more than one full repaint (code path). Design 7.4 expects about 20 painted objects per frame for a 500-object drag.
- **Invariant broken:** V4, cached layers stay valid across the frames of one interaction.
- **Suggested fix:** invalidate the bitmaps through an explicit flag set by viewport changes, theme changes, and events whose ids fall in `lower` or `upper`; key only on the split membership. Keep one scratch canvas for the composite.
- **status:** open

### VIEW-SM-23. Per-frame work over every object

- **Evidence:** each frame runs `refreshDrawableState` (calls `valueText` for every drawable), `updateReaderList` (calls `describe()` for every object and rewrites the figure's `aria-label`), and `paintWidgets` and `paintOverlay2D` (scan the whole list); each pointer move runs `hitTest` (a rank map over the whole list) and `snapContext` (every point). These are part of the 18 ms and 127 ms frames in VIEW-SM-21. With a synchronous `scheduleFrame`, the `requestFrame` at the end of `frame` recurses while a highlight or tween is alive (code path).
- **Invariant broken:** design 15 and 7.1, work follows what changed.
- **Suggested fix:** update value text and reader items only for ids in this frame's events; cache the rank map and the snap points per draw-list version; defer the end-of-frame request to the scheduler when the callback runs synchronously.
- **status:** open

### VIEW-SM-24. 3D re-uploads every mesh on any event, and id removal is quadratic

- **Evidence:** `Figure3D.applyEvents` bumps `sceneVersion` for every event, and `paint` then rewrites every mesh and point (`uploadAll`). Reproduced: moving one point re-uploaded all 144,176 bytes of a 60 x 60 mesh; a 200,000-triangle mesh is about 24 MB per drag frame plus fresh `Float32Array`s. `SceneIndex.dropId` (`core/scene.ts` line 136) and `DrawList.remove` (`core/drawables.ts` line 140) call `indexOf` per id. Reproduced: updating 8,000 3D ids takes 10.6 ms against 1.1 ms for 2,000 (quadratic), and is per frame for a playing figure whose points depend on `t`. `paintOverlay3D` and `depthKey` recompute `itemBounds` over every vertex each frame.
- **Invariant broken:** V12, an event re-uploads only what it touched (space-3d 9.2).
- **Suggested fix:** track dirty items per event and rewrite only their arena ranges (the `ArenaAllocator` is already there); keep an index map (or a tombstone and compact) instead of `indexOf`; read bounds from `SceneIndex.bounds`.
- **status:** open

### VIEW-SM-25. `present` reads every 3D frame back through the CPU

- **Evidence:** `SharedGpuContext.present` (`web/shared-context.ts` line 180) runs `readPixels` on the whole box (a GPU stall), allocates a `Uint8Array` and a `Uint8ClampedArray` of `w * h * 4` bytes, flips rows in JavaScript and calls `putImageData`, on every frame of every live 3D figure. For 800 x 600 at DPR 2 that is 7.7 MB read and two 7.7 MB allocations per frame (code path).
- **Invariant broken:** performance.md 5.7, no garbage per frame; 30 fps on phones for 3D.
- **Suggested fix:** size the shared GL canvas to the largest box, draw each figure into it with a viewport and scissor, and copy with `ctx2d.drawImage(glCanvas, sx, sy, w, h, 0, 0, w, h)`; otherwise reuse one pixel buffer per box.
- **status:** open

### VIEW-SM-26. Builds wait for the slow interval tick

- **Evidence:** the observer tick runs when a figure becomes near, which is too early for the 150 ms settle rule, and nothing schedules a tick at `nearSinceMs + 150`. Reproduced: a figure seen at t = 0 gets no action by 160 ms and `build` and `goLive` at 500 ms (the interval). The target is under 100 ms from a saved picture to live (performance.md 1).
- **Invariant broken:** V1, a figure builds as soon as the settle rule allows.
- **Suggested fix:** when a figure becomes near, arm a one-shot timer for `settleMs` that runs `tick`, and run `tick` when the settle timer fires (it already does) with the near time compared at `>=` the timer moment.
- **status:** open

## Cosmetic

### VIEW-SM-27. Canvas text background ignores alignment; the 3D gizmo ignores its axis colours

- **Evidence:** `CanvasSurface.text` always centres the background box on `at.x`, while the text is drawn left- or right-aligned, so label backgrounds sit off their text for `left` (the default for labels) and `right`. `paintOverlay3D` computes per-axis colours and discards them (`void c`), so the x, y and z handles look the same (code path).
- **Invariant broken:** none of the machines; visual only.
- **Suggested fix:** offset the background box by alignment (`left`: `at.x - 2`; `right`: `at.x - w - 2`). Stroke each gizmo arrow with its axis colour.
- **status:** open

## Categories with nothing found

- **HTML injection (XSS) in the DOM layer:** names, descriptions, captions and `alt` reach the DOM only through `textContent` and `setAttribute`. There is no `innerHTML`, `insertAdjacentHTML` or `DOMParser` in the package.
- **SVG text and attribute escaping, apart from VIEW-SM-1:** text content and the image `href` go through `svgEscape`, ids through `svgId`, numbers through `svgRound`, colours through `Math.round`, and caps and joins are fixed by the drawable. The host supplies `glyphPath` output and image `href` values.
- **Running code:** no `eval`, `new Function` or dynamic import of figure content. Particle and style formulas arrive compiled from the kernel.
- **Leaks between figures:** there is no module-level mutable state except the summary-id counter. Caches, hit indexes, selection and `Figure3D` resources are per figure. The only cross-figure path is two figures sharing one id (noted in VIEW-SM-6).
- **Export snapshot token:** every success and error path of `exportSvg` and `exportPng` releases the token.
- **Live-region announcer (V13):** rate limit, queue and timer cleanup behave as designed.
- **Ramer-Douglas-Peucker:** worst-case probing stayed near n log n (4,000 points 1.5 ms, 16,000 points 10.6 ms).
- **Hit index query and grid spacing choice:** both are constant time, which matches the builder's bench.
