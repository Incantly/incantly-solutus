# GeoGebra study: how it works, and what it means for our engine

Studied 2026-11-10 from GeoGebra's public website, manual and source (`github.com/geogebra/geogebra`, commit 3608374). This is a study to understand, not to copy: no GeoGebra code, text or assets go into Incantly. Everything below is in our own words.

## Licence: why we only learn from it

- Source code: EUPL 1.2. Apps, installers and web services: non-commercial only, attribution required. Docs, language files, icons: CC BY-NC-SA 4.0. Commercial use needs a paid agreement with GeoGebra GmbH. Their CAS (Giac) is GPL3.
- So we do not embed GeoGebra, ship its assets, or port its code. We design our own engine from the ideas below.

## What GeoGebra offers

- **Apps:** Graphing, Geometry, 3D, CAS, Scientific, Probability, Notes, and Classic (the authoring app with every view). One codebase; each app is a configuration that switches tools, commands and defaults.
- **Objects:** points, vectors, lines, segments, rays, polygons, circles and conics, arcs, functions, parametric and implicit curves, inequalities, numbers and angles (sliders), booleans (checkboxes), texts with LaTeX, lists, matrices, images, buttons and input boxes, and 3D solids and surfaces.
- **Tools:** about 110 drawing tools in 2D (points, lines, special lines, polygons, circles, conics, measurement, transformations, action objects) plus 69 in 3D.
- **Commands:** about 500 in 20 categories: algebra, functions and calculus, geometry, conics, lists, statistics, probability, charts, transformations, vectors and matrices, 3D, scripting, text, logic, discrete maths, optimisation, CAS.
- **Dynamic behaviour:** free objects can be dragged, dependent objects recompute; sliders animate; trace and locus draw paths; objects can be shown on a condition; colours can be formulas; 10 layers.
- **Scripting and embedding:** scripts on click or update (command lines or JavaScript); an embedding API to run commands, set values and listen for changes; files store the construction.
- **Physics:** there is no physics engine. Physics is built from a time slider, formulas of time, sequences and iteration, and ODE solvers. Collisions, contacts and rigid bodies are not supported; bounces are worked out by hand with formulas.

## How it is built

### 1. The model: objects and algorithms

- Every object is either **free** (it holds its own value) or **dependent** (it is the output of an algorithm).
- An **algorithm** lists its inputs and outputs and has one job: recompute its outputs from its inputs. A midpoint, an intersection or a formula like `c = sqrt(a² + b²)` are all algorithms. Formulas and commands share the same graph.
- About 60 object types and about 800 algorithms.
- Objects are kept in **creation order**, which is always a valid dependency order: an object can only use things created before it. That order is also the step-by-step "construction protocol".
- Each object keeps a **ready-made list of everything downstream** of it. A drag is one linear pass over that list. When several things change at once (animation), the lists are merged so each algorithm runs once per frame.
- **Undefined is a normal value.** A failed computation marks its output undefined, and that flows through the graph without errors.
- Files store **definitions, not results**: free objects store values, dependent objects store their command or formula. Loading replays the definitions.
- **Avoid:** a 7,200-line base object that mixes maths, style, UI, scripting and spreadsheet concerns; redefining an object by serialising the whole construction and rebuilding it; undo by whole-file snapshots.

### 2. The language: text to objects

- One grammar parses input lines into an expression tree. About 120 operations, about 100 built-in maths functions.
- The type of the result decides the object: a number becomes a number or slider, a pair becomes a point, a degree-1 equation becomes a line, degree 2 a conic, `y = …` a function.
- About 550 commands. Each command has hand-written argument checks that pick the right algorithm by argument count and types.
- Redefinition keeps the object's identity when only the value changes; type changes can be forbidden.
- Commands are loaded in modules; the heavy symbolic engine (CAS) is separate and loaded on demand.
- **Avoid:** guessing (`A = …` might be an equation or an assignment, `f(x)` might be a call or a product, unknown names are split into products or turned into sliders), parse errors that lose their position ("Invalid input"), and hand-coded overload chains.

### 3. Errors

- **Lines that cannot be parsed** all become one generic "please check your input" message. The line, column, offending token and expected tokens are thrown away.
- **Lines that parse but are wrong** raise one of about 50 named error kinds: undefined variable, illegal argument, wrong number of arguments, unknown command, circular definition, redefinition failed, fixed object changed, unbalanced brackets, illegal operation, and so on. Command errors append that command's accepted forms.
- Errors go to an error handler that shows a dialog; they are not returned to the caller (the embedding API's run-command call only answers true or false).
- Undefined names can trigger an offer to create sliders for them instead of failing.
- **Calculations that fail while running** never throw: the output is marked undefined and everything downstream becomes undefined, and the figure keeps working.
- In scripts, the failing line number is reported.
- **For us:** keep undefined-as-a-value and showing a command's accepted forms. Improve the rest: every error carries line, column, token and what was expected, comes back as data the model can read and fix, and unknown names are always errors.

### 4. Drawing and interaction

- Model, views and drawing are separate. Views subscribe to add, update, remove and style events.
- Each object has its own **drawable** that caches its screen geometry. A change only marks it dirty; it is recomputed at paint time, and repaints are merged into one per animation frame.
- All drawing goes through one small graphics interface (path, stroke, fill, text, transform, clip), so the same code draws to canvas or exports SVG.
- **Function plotting** is the hardest-won part: it samples more densely where the curve bends, detects jumps and undefined regions, and has an interval-arithmetic mode that gets asymptotes right.
- Draw order: layer, then type, then creation order. Hit testing ranks labels over points and edges over fills.
- Dragging a dependent object moves its free parents; points on a path are projected back onto it; grid snapping.
- Accessibility: a hidden DOM copy of the canvas objects for screen readers, plus keyboard moving.
- **Avoid:** the Java-to-JavaScript compilation layer and its Java graphics emulation, a 12,600-line controller with about 155 tool modes, and the desktop back-ends.

## What this means for our design

1. **Same core model.** Free values plus algorithms with explicit inputs and outputs, kept in creation order, with precomputed downstream lists and one update pass per frame. Formulas are just one kind of algorithm. Undefined is a value.
2. **Small, separate pieces.** The maths value, its style and its drawable are separate; the kernel knows nothing about the UI.
3. **A language made for a model to write, one line at a time.** Every line is unambiguous from its first tokens (`name = expression`, `name(x) = expression`, or `Command(args)`). Unknown names are errors, never guessed. Each line is a transaction: parse, resolve, type-check, then commit, or reject only that line.
4. **Errors a model can fix.** Every error says the line, column, offending token, what was expected, and the command's accepted forms.
5. **Commands declared as data.** Each command is a name plus a list of signatures (argument types to handler). That gives type-checking, error messages, documentation and the catalogue we hand the model, all from one table.
6. **Time is a first-class variable.** A global clock `t` that formulas can use, instead of sliders stepping on a timer. Trace and locus are sampled data, computed by evaluating the graph along a parameter.
7. **Physics where GeoGebra stops.** Formulas of `t` and an ODE solver cover kinematics, pendulums, waves and orbits. Collisions, contacts and joints come from our own physics kit, exposed as commands in the same language.
8. **Drawing.** Per-object cached drawables, one repaint per frame, one graphics interface for canvas and SVG, and an adaptive function plotter with jump detection from day one.
9. **Leave out at first:** a full CAS, 3D, spreadsheet, exam mode, localised command names and the 500-command breadth. Start with the commands lessons need and grow from real use.

## Where this stands (handoff)

- **Branches:** `next` is the fresh start (this study and a README only). `legacy/v1` holds the previous Incantly implementation; copy pieces from it when useful (for example `packages/core/src/kits/physics2d`, the live voice code in `packages/core/src/film/live-*.ts` and `packages/generation/src/client/live-gemini.ts`). `main` stays as it is until new work lands on `next`, then `next` becomes main with the product owner's go-ahead.
- **Reference source:** read GeoGebra at https://github.com/geogebra/geogebra (a shallow clone is enough: `git clone --depth 1`). Keep any clone outside this repository, and never paste its code into ours.
- **Why the rewrite:** the live teacher should talk at once and build the figure while it talks. Scenes written as JavaScript programs were too slow and fragile for that; short formula commands, streamed one line at a time and validated per line, are the goal.
- **Next step:** write the design for our command language and kernel from the nine points above: object and algorithm model, the line grammar, the command signature table and first command set, the error format, time `t`, drawing, and how the live teacher streams commands. No code has been written for it yet.
