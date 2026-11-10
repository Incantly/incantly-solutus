# Performance and rendering

Status: accepted for building. Applies to every package that computes or draws. Learns from the legacy v1 scheduler (`packages/tiptap/src/scheduler.ts` on `legacy/v1`) and the legacy 3D engine (`packages/core/src/kits/space3d/`), which we wrote ourselves.

## 1. Goals

| Measure | Target |
|---|---|
| Frame with 500 objects playing (kernel) | under 4 ms |
| Frame total, desktop | 60 fps |
| Frame total, mid-range phone | 60 fps for 2D, 30 fps or more for 3D |
| 10,000 points or particles in one figure | one draw call, 60 fps |
| 3D figure with 200,000 triangles | 60 fps desktop, 30 fps phone |
| A document with 50 figures | scrolls at 60 fps; memory under 300 MB |
| A figure scrolled into view | first drawing under 100 ms (2D) or 250 ms (3D) from a saved picture to live |
| Still figure (no `t`, nothing dragged) | zero frames after its first drawing |
| Input language: parse plus check of one line | under 0.2 ms |
| Input language: preview of a line (input bar) | under 1 ms |
| Input language: completion per keystroke, 5,000 objects and 200 command names | under 2 ms |
| Compiled function: a 2,000-sample batch of a 20-node function | under 0.2 ms |

The input-language rows come from `docs/features/language/` (`ui.md` 2, `design.md` 3.14, 3.16 and 3.18). Measured in Node, warm: parse plus check of a typical line 0.008 ms; preview 0.010 ms; completion 0.04 ms on the test figure and 0.2 to 1.6 ms at 5,000 objects (the worst case is a prefix that matches many names, so there is little slack); a 2,000-sample batch of a 30-node function with `sin`, `cos` and `sqrt` 0.26 ms, which is 170 to 230 million node evaluations per second.

## 2. Our own renderer

We build the renderer, 2D and 3D, ourselves. No three.js, no d3, no scene library.

1. **Why:** the renderer must run unchanged on mobile, it must share one GPU context across many figures (section 4), and we want control over every draw call.
2. **One GPU interface.** The renderer is written against a small interface we own: buffers, textures, programs, draw calls, scissor and viewport. Back-ends:

| Back-end | Where | Status |
|---|---|---|
| WebGL 2 | Browsers, mobile WebViews | Default |
| WebGPU | Browsers that support it | Second back-end, same interface |
| Native GL or Metal surface | A native mobile app later | Same interface; the renderer core has no DOM |
| SVG and PDF recorders | Export only | Same draw list, no GPU |

3. **No DOM in the core.** The renderer core takes a draw list and a GPU interface. Canvas creation, pointer events and resize live in a thin web layer, so a mobile shell replaces only that layer.
4. **What it draws:** filled and stroked paths (tessellated once, cached), lines with width and dashes (in a shader), points and particles (instanced), meshes with one light model and back-face culling, text labels from a glyph atlas, and maths (KaTeX output cached as a texture).
5. **Picking:** an id buffer drawn on demand (on pointer down, not every frame) gives the object under the pointer in one read.

## 3. Work only on what changed

1. **No dirty, no frame.** A figure asks for a frame only when something changed: a drag, a slider, the clock while playing, a resize. A still figure draws once and stops.
2. **Push marks, pull values.** A change marks downstream objects dirty (cheap). Values are computed when something needs them: a visible drawable, a readout, a rule that a visible object depends on. An object nobody looks at costs nothing until it is looked at.
3. **The time set.** The kernel keeps the list of rules that depend on `t`. While playing, only that list runs each frame.
4. **Drawables cache geometry.** A drawable re-tessellates only when its value or style changed. Moving the camera or zooming does not re-tessellate 2D paths; it changes one matrix.

## 4. Many figures on one page

Browsers allow only a few live WebGL contexts per page; Chromium drops the oldest after about 16 ([Chromium issue](https://issues.chromium.org/issues/437316557/resources)). A document can hold many more figures than that.

1. **One shared GPU context per page.** One offscreen GPU context draws every live figure. Each figure has its own visible canvas; after drawing a figure's box, the shared context copies the result to that canvas. Figures never create their own GPU context.
2. **The scheduler** decides which figures are live. One scheduler per page (per editor in TipTap).

### Figure states

| State | Holds | Draws | Enters when |
|---|---|---|---|
| `placeholder` | Script text and the saved picture | The picture | First seen, or after `saved` |
| `ready` | Kernel built, geometry cached | One frame, then stops | Within 300 px of the viewport, after the scroll settles for 150 ms |
| `live` | Everything | Frames while dirty or playing | In view, and among the 3 most recently used |
| `paused` | Everything | Nothing | Left the viewport, the tab was hidden, or a 4th figure became live |
| `saved` | Script, state and a fresh picture | The picture | Paused and off screen for 8 s |

Rules:

- At most **3 live figures** at once. A figure the learner touched last is the last to be paused.
- A figure leaves `live` at once when it leaves the viewport or the tab is hidden.
- **Saving as a picture after 8 s applies to every figure**, 2D and 3D. The picture is taken from the last frame, and the state (free values, clock time, camera, states and checkpoints) is kept. Returning to `live` restores state, then draws, so the learner sees no jump. 2D figures restore in under 100 ms, so the rule costs nothing visible and frees memory in long documents.
- A figure that is playing a film is pinned: it is not paused for the limit while in view.
- A fast scroll past many figures builds none of them, because state changes wait for the scroll to settle.

## 5. Large scenes

### Budgets per figure

| Item | Budget | Over budget |
|---|---|---|
| Objects | 5,000 | Line refused with `limit` |
| Points and particles | 50,000 (20,000 per particle system) | Line refused with `limit` |
| Triangles (3D) | 200,000 | Round solids get fewer facets, with a notice |
| Curve samples | 4,000 per curve on screen | Adaptive sampler stops refining |
| Labels shown | 300 | Lowest-priority labels hidden, with a notice |
| Sounds at once | 8 | See `docs/features/sound/` |

### Techniques

1. **Batching.** Objects of the same kind and style share one buffer and one draw call. 10,000 points are one instanced draw ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/drawArraysInstanced)).
2. **Culling.** Drawables outside the view box (2D) or the camera frustum (3D) are skipped. A spatial grid over the stage finds them without testing every object.
3. **Level of detail.** Curve sampling follows screen size, so a zoomed-out curve uses fewer points. Spheres, cones and surfaces pick a facet count from their size on screen. Labels hide when they would overlap.
4. **Particles on the GPU.** Particle formulas compile to a vertex shader, since each particle is a pure function of `i`, `u`, `v`, `age` and `t` (core design 7.3). The CPU sends only the uniforms.
5. **Workers.** The kernel of a heavy figure, mesh building, the CAS, implicit-curve tracing and exports run in workers. The main thread keeps input and drawing. Where the browser supports OffscreenCanvas ([web.dev](https://web.dev/articles/offscreen-canvas)), the shared GPU context also lives in a worker.
6. **Drag stays smooth.** While dragging, rules marked heavy (cost hint, `docs/features/statistics/`) wait until the drag pauses for 100 ms, then run once.
7. **Typed arrays.** Lists of numbers and geometry live in typed arrays, so large lists cost no garbage per frame.

## 6. Measuring

- Every package has a benchmark suite, run in CI, with the targets in section 1 as limits. A regression past 10% fails the build.
- The studio has a performance panel: frame time, kernel time, draw calls, triangles, live figures and memory.
- The scheduler keeps stats as the legacy one did: registered, near, live, peak live, mounts, saves, and time from mount to first drawing.

## 7. Where each part lives

| Part | Package |
|---|---|
| Push marks, pull values, the time set | `kernel` |
| Draw list, GPU interface, back-ends, batching, culling, LOD, picking | `view` |
| Shared GPU context and the figure scheduler | `view` (used by `sdk` and `tiptap`) |
| Worker hosting | `sdk` |
| Budgets and their errors | `kernel` and `errors` |
