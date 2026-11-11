# Feature studies

One folder per feature area of the new Incantly engine. Each was written by studying how GeoGebra builds the feature (source at commit 3608374 and the public manual), then designing our own version in TypeScript on top of `docs/design/formula-language-and-kernel.md`.

Nothing here is GeoGebra code or manual text. Each `design.md` ends with a "Sources studied" list, which records what was read.

Every folder has four files:

| File | Contents |
|---|---|
| `design.md` | What the feature does, every command and tool in the area, how GeoGebra does it, our TypeScript design, improvements, changes to the core design, sources |
| `errors.md` | Every failure, and the error objects and recovery we use |
| `agent.md` | How a model writes it: lines, catalogue entries, `draw` and `figure` results, teacher lesson snippets, token budget |
| `ui.md` | What the learner sees and does |

## Folders

| Area | Folder | Covers |
|---|---|---|
| Core | [kernel](kernel/) | Objects, rules, order, updates, undefined, redefinition, delete, undo, step list, save and load, object properties |
| Core | [errors](errors/) | The one error format, error catalogue, notices, recovery, limits |
| Language | [language](language/) | Full grammar, operators, built-ins, typing of results, command matching |
| Language | [algebra-view](algebra-view/) | Object list, input bar, previews, autocomplete, signature help |
| Values | [numbers-sliders](numbers-sliders/) | Numbers, angles, sliders, rounding, booleans, checkboxes |
| Values | [controls-scripting](controls-scripting/) | Buttons, input boxes, choices, `on` handlers, safe scripting |
| Geometry | [points-lines](points-lines/) | Points, lines, vectors, intersections, special lines, measures |
| Geometry | [conics](conics/) | Circles, arcs, sectors, conics |
| Geometry | [polygons-transforms](polygons-transforms/) | Polygons, transformations |
| Analysis | [functions-calculus](functions-calculus/) | Functions, calculus commands, ODEs, the function plotter |
| Analysis | [curves-loci](curves-loci/) | Parametric and implicit curves, inequalities, loci, envelopes |
| Data | [lists-matrices](lists-matrices/) | Lists, sequences, matrices |
| Data | [statistics](statistics/) | Descriptive statistics, regression, charts |
| Data | [probability](probability/) | Distributions, random numbers and seeding, probability calculator |
| Symbolic | [cas](cas/) | Symbolic layer and every CAS command |
| Symbolic | [optimisation-discrete](optimisation-discrete/) | Optimisation, discrete maths, graphs |
| Symbolic | [text-logic](text-logic/) | Texts, maths layout, logic, financial and scientific commands |
| Drawing | [graphics-view](graphics-view/) | Drawables, painting, zoom, grid, styles, hit testing, dragging, export |
| Drawing | [tools-2d](tools-2d/) | Every 2D tool and its click sequence |
| Drawing | [animation-time](animation-time/) | Clock `t`, slider animation, traces, states, particles |
| 3D | [space-3d](space-3d/) | 3D objects, commands, tools, camera, WebGL rendering |
| Apps | [spreadsheet](spreadsheet/) | Cells as objects, references, ranges |
| Apps | [embed-files-export](embed-files-export/) | Embed API, script file format, export |
| Apps | [app-modes](app-modes/) | Graphing, Geometry, 3D, CAS, Scientific, Probability, Notes, Classic, exam mode |
| Media | [sound](sound/) | Tones, noise, notes, melodies and sonified functions, played with Tone.js |
| Documents | [tiptap](tiptap/) | Live figures and formulas inside Tiptap documents |

Performance rules for every area, and our own renderer, are in `docs/design/performance.md`.

## Decisions across areas

The areas were written in parallel. Where they overlap or disagree, these decisions win over the individual folders until the core design doc is updated to match.

### Shared model

1. **Lists are 1-based.** `L[1]` is the first item and `L[-1]` the last. This applies to lists, choices, matrices, spreadsheet ranges and intersection indexes.
2. **One undefined-reason registry**, owned by `kernel` and `errors`. Every area registers its codes there (for example `parallel`, `singular`, `pending`, `skew`). An undefined value is `{ reason, detail?, cause? }`: `detail` is a short plain fact, and `cause` names the nearest undefined input (a direct input); following `cause` links reaches the root.
3. **One `bad_argument` kind** for a literal argument that is wrong at check time. `wrong_arity` and `no_matching_form` stay separate. Area-specific kinds (`mixed_dimension`, `mode_forbids`, `bad_option` and the rest) are registered in `errors`.
4. **Line results carry `notices`**, a list of `{ severity: 'info' | 'warning', code, message }`. This one field replaces the `warnings` and `notices` that different areas proposed.
5. **`Function2`** (a function of two variables) is defined once, in `functions-calculus`. `language` and `space-3d` use it.
6. **`Point - Point` is a `Vector`.** Agreed by `language` and `points-lines`.
7. **`inf`** is a built-in constant, and `Number` may be `±inf`.

### Kernel services

8. **`kernel.applyBatch(lines)`** is all-or-nothing, makes one update pass and one undo step. It is owned by `kernel`. `graphics-view` (tools) and `embed-files-export` (API) use it.
9. **`kernel.slice(source, target)`** evaluates the rules between two objects on a scratch copy. It returns a `Slice` with `chain` (the objects that run, in order) and `run(values)` (the target's cell for each value of the source). The figure is left as it was. A slice is built on each call and not cached. If the target does not depend on the source, `chain` is empty, and the area that asked turns that into its own `no_dependency` error. It is owned by `kernel`, and used by `Locus`, `Path`, `Envelope` and the CAS.
10. **`kernel.dryRun`, `kernel.drag` and `commitDrag`** are owned by `kernel`. They answer core open question 2: dependent points can be dragged through drag plans, in v1.
11. **`Rename(obj, Text)`** is a kernel action. `kernel` and `language` described the same behaviour.

### Language

12. **Degrees:** the `°` postfix and the constant `deg`. `30deg` already works through implicit multiplication after a number literal, so no separate suffix rule is needed.
13. **`if`:** `if(c1, v1, c2, v2, …, otherwise)`. The final `otherwise` may be left out in numeric code, which gives undefined with reason `condition_false` when no condition holds. Symbolic parameters (the CAS) require it.
14. **Reserved names** include `x`, `y`, `z`, `t`, `bt`, `beat`, `inf`, `deg`, `undefined` and every built-in. Particle names `i`, `u`, `v` and `age` exist only inside `Particles`.
15. **Axis constants are lowercase:** `xaxis`, `yaxis`, `zaxis`, following the rule that built-ins are lowercase. `space-3d` used `xAxis`; this name wins.
16. **Transformed images are named `A_1`, `A_2`**, never `A'`, because `'` marks a rate rule.
17. **Continuation lines:** a call may run over several lines while a bracket is open.

### Time

18. **Beat time:** `bt` (seconds since the current beat began) and `beat` (its index) are read-only built-ins. This answers core open question 1.
19. **What-if replays:** each figure picks `rerun = continue | restart` for slider changes during a film. This answers core open question 5.
20. **Particle limits:** 20,000 per system and 50,000 per figure. This answers core open question 4.

### Scope

21. **Everything is in scope**, including CAS, 3D, the spreadsheet and every app mode. The core design's section 12 sets the build order, not the scope. `app-modes` now has full configurations for the CAS and 3D apps (sections 3.2.1 and 3.2.2).
22. **Symbolic maths is our own TypeScript layer**, loaded on demand. Giac is GPL-3 and is not used. Every library we may use, with its checked licence, is in `docs/design/libraries.md`. All are MIT, ISC, Apache-2.0 or Unlicense.
23. **Items the studies put off to later phases are in scope too**, each with the way we build it:

| Item | How | Area |
|---|---|---|
| Boolean cuts of solids | Manifold (Apache-2.0, WebAssembly), loaded on demand | `space-3d` |
| AR | WebXR `immersive-ar`, where the device supports it | `space-3d` |
| WebGPU | A second 3D back-end behind the same drawing interface; WebGL 2 stays the default | `space-3d` |
| Polygons with holes | A `Polygon` with `rings`, boolean operations by polygon-clipping (MIT) | `polygons-transforms` |
| Regular-expression text commands | Run in a worker with a 50 ms budget per call; a timeout gives undefined with reason `timeout` | `text-logic` |
| Update handlers (`on update`) | Same step budget as click handlers; a handler cannot set off itself or another update handler in the same pass | `controls-scripting` |
| `Prove`, `LocusEquation`, `Envelope` | Built on the symbolic layer in wave 3 | `cas`, `curves-loci` |

24. **Still out:** running JavaScript from figures or files. Our safe `on` handlers cover the same jobs without letting a shared file run code.

## Known gaps

- Some manual index pages came back empty or not found: the scripting, 3D and CAS command indexes, exam mode, scientific calculator and settings. Those areas built their command lists from the source's command tables instead. Builders should check their command list against the manual's individual command pages, which did load.
