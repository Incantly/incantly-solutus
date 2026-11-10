# Formula language and kernel: design

Status: accepted for building. Follows the handoff in `docs/research/engine-study.md`. Each feature area is designed in detail under `docs/features/`; where a feature folder and this document disagree, `docs/features/README.md` and section 13 here decide. No code yet.

This design learns from how GeoGebra is organised, as described in the study. It copies no GeoGebra code, text, grammar or command table. Where we keep a common maths word (`Midpoint`, `Circle`), it is because that is the word a teacher uses, not because GeoGebra uses it.

## 1. What we are building

A small language and the engine behind it. A model (or a person) writes one short line at a time. Each line defines or changes one object in a live figure. The figure redraws at once.

The main user is the live teacher. It talks to the learner and builds the figure while it talks, a line or two per sentence. A line must therefore be quick to write, quick to check, and either work or fail with an error the model can fix on its next line.

### Goals

1. **One line, one change.** Every line is checked and applied on its own. A bad line changes nothing and returns an error; the lines before it keep working.
2. **No guessing.** The first tokens of a line say what kind of line it is. Unknown names are errors.
3. **Errors a model can fix.** Each error carries line, column, token, what was expected, and the accepted forms of the command.
4. **Time is built in.** A clock `t` drives motion, so films seek and replay exactly.
5. **Real-time.** Applying a line takes under 1 ms. A frame with 500 objects and 20,000 particles runs at 60 fps on a mid-range laptop.
6. **The script is the file.** A figure is saved as its lines. Loading replays them.

### Scope

Every feature area in `docs/features/` is in scope: the symbolic layer (CAS), 3D, the spreadsheet, statistics and probability, every app mode, and the full command set those areas list. Section 6 is the first set the kernel ships with, not the limit. Section 12 sets the order we build in.

Still out of scope: running JavaScript from figures or files (scripts use our own safe `on` handlers, see `docs/features/controls-scripting/`), and units of measure. Command names are English in every locale; localised aliases come later and never change the saved script.

## 2. Model: objects and rules

### Objects

Every object has:

| Field | Meaning |
|---|---|
| `id` | Stable number. Kept when the object is redefined. |
| `name` | What lines call it. Unique, case-sensitive. |
| `type` | One of the types in section 4. |
| `def` | The parsed line that made it, kept as source text and syntax tree. |
| `value` | The current value, or `undefined` with a reason. |
| `style` | Colour, width, label, layer, visibility. Never read by maths. |
| `order` | Position in the figure. Always a valid dependency order. |

Value, style and drawing are kept apart. The kernel holds values and style as plain data and knows nothing about screens.

### Free and dependent

- A **free** object holds its own value: `a = 3`, `A = (1, 2)`. Free objects can be changed by a slider or a drag.
- A **dependent** object is the output of a **rule**. A rule lists its inputs and recomputes its output from them. `M = Midpoint(A, B)` and `h = sqrt(a^2 + b^2)` are both rules. Commands and formulas live in the same graph.
- The clock `t` is a special free value that only the player sets.

### Order and updates

- Objects keep **creation order**. A line may only use names that already exist, so creation order is a dependency order.
- Redefining an object to use a later object is allowed when it makes no cycle. The kernel then moves the object, and everything that depends on it, after its new inputs. Relative order of the rest is unchanged.
- Each object caches its **downstream list**: every rule that depends on it, in order. The cache is rebuilt only when lines add, redefine or delete objects. Dragging and playing never rebuild it.
- **One pass per frame.** Changes in a frame (a drag, a slider, `t` moving) mark their sources. At frame time the kernel merges the sources' downstream lists, sorts by order, and runs each rule once.
- The kernel keeps the downstream list of `t` ready, since it runs every playing frame. Objects outside it cost nothing while a film plays.

### Undefined is a value

A rule that cannot compute (a square root of a negative, two parallel lines' intersection, a division by zero) sets its output to `undefined` with a short reason, such as `parallel` or `out_of_domain`. Undefined flows downstream without errors. Drawables of undefined objects are hidden, readouts show a dash, and the figure keeps running. When inputs change, the rule tries again.

### Transactions and undo

Applying a line runs five steps: parse, resolve names, type-check, build the rule, compute once. Only when all five pass does the kernel commit. Otherwise it returns the error and the figure is untouched.

Undo keeps a log of inverse steps (an add's inverse is a delete, a redefinition's inverse is the old definition), never whole-figure snapshots.

### Saving

A figure saves as its script: the current definition of every object in order, plus the current values of free objects. `kernel.toScript()` and loading that script give back the same figure.

### Determinism

Rules never read the wall clock or an unseeded random source. Randomness comes from `rand(seed)` and `noise(x, y)`, which are pure functions. The same script and the same `t` always give the same figure.

## 3. Line grammar

### Line kinds

The first one or two tokens decide the kind. There is no other way to read a line.

| Starts with | Kind | Example |
|---|---|---|
| `#` | Comment | `# the right angle` |
| `@` | Directive | `@view -5 5 -3 3` |
| `Name =` | Define or redefine an object | `A = (1, 2)` |
| `Name(params) =` | Define a function | `f(x) = x^2 - 2` |
| `Name' =` | Rate rule for a state (section 7) | `v' = -g` |
| `Name with` | Restyle an object | `A with color = red` |
| `Command(` | Action, with no result | `Hide(A)` |

Rules that keep this unambiguous:

- `=` only ever defines. Equality inside an expression is `==`.
- A name followed by `(` is a call. If the name is not a function or command, that is an error, never a product.
- Implicit multiplication is allowed in one place only: right after a number literal, before a name or `(`, with or without a space, as in `2x`, `0.5 age` or `3(a + b)`. `ab` is the name `ab`. `a b` is an error: write `a * b`.
- Objects must be named. A line that starts with an object command and no name, such as `Circle(A, 2)`, is the error `unnamed_object`. Only action commands (section 6.6) stand alone.
- Commands are PascalCase. Built-in functions and constants are lowercase. User names may not reuse either, or `t`, `bt`, `beat`, `x`, `y`, `z`, `inf`, `deg`, `undefined`, `true`, `false`, `with`, `in`, `step`, `if`, `on`, `and`, `or`, `not`, `xor`, or the axis constants `xaxis`, `yaxis`, `zaxis`.

### Grammar

```ebnf
line        = comment | directive | define | function | rate | restyle | action ;
comment     = "#" { any } ;
directive   = "@" ident { arg } ;
define      = name "=" expr [ range ] [ style ] ;
function    = name "(" ident { "," ident } ")" "=" expr [ style ] ;
rate        = name "'" "=" expr ;
restyle     = name style ;
action      = command "(" [ args ] ")" ;

range       = "in" expr ".." expr [ "step" expr ] ;      (* makes a slider *)
style       = "with" prop "=" value { "," prop "=" value } ;

expr        = or ;
or          = and { "or" and } ;
and         = not { "and" not } ;
not         = [ "not" ] compare ;
compare     = sum [ ( "==" | "!=" | "<" | "<=" | ">" | ">=" ) sum ] ;
sum         = product { ( "+" | "-" ) product } ;
product     = unary { ( "*" | "/" ) unary | implicit } ;
implicit    = power ;           (* only when the previous token is a number literal and this one is a name or "(" *)
unary       = [ "-" ] power ;
power       = postfix [ "^" unary ] ;                      (* right-associative *)
postfix     = primary { "(" [ args ] ")" | "[" expr "]" | "." ident } ;
primary     = number | string | name | "(" expr ")" | pair | list | "if" "(" expr "," expr "," expr ")" ;
pair        = "(" expr "," expr ")" ;                      (* a point *)
list        = "[" [ expr { "," expr } ] "]" | "[" expr ".." expr "]" ;
args        = arg { "," arg } ;
arg         = expr | ident "=" expr ;                      (* positional or named *)
```

Names are ASCII letters, digits and `_`, plus Greek letters (`θ`, `ω`, `α`), starting with a letter. A line ends at a newline. There are no blocks: anything that would need one is a command.

### What a definition makes

The type of the right-hand side decides the object:

| Right-hand side | Object |
|---|---|
| A number expression | Number (with `in a..b`, a slider) |
| `true`, `false`, a comparison | Bool (shown as a checkbox when free) |
| A string | Text |
| `(e, e)` | Point |
| A list | List of one element type |
| A command call | The command's return type |

Free versus dependent follows the inputs: `A = (1, 2)` is free and draggable, `B = (a, 2)` depends on `a` and is not draggable in v1.

### Redefinition

`A = …` on an existing `A` keeps its `id`, style and place in figures and films. The new type must match the old one; a different type is the error `type_change`. To change type, `Delete(A)` first.

### Directives

| Directive | Effect |
|---|---|
| `@view x0 x1 y0 y1` | Visible region in maths units |
| `@grid on` / `@axes off` | Background |
| `@beat id "title"` | Starts a film beat; the lines that follow belong to it |
| `@clock 0..30` | Film length in seconds |

## 4. Types

| Type | Value | Notes |
|---|---|---|
| `Number` | float64 | |
| `Bool` | true or false | |
| `Text` | string | May contain `{expr}` that updates, and `$…$` maths |
| `Point` | (x, y) | Fields `.x`, `.y` |
| `Vector` | (dx, dy) | Fields `.x`, `.y`, `.length` |
| `Segment`, `Ray`, `Line` | two points or point and direction | `Line` also from `a*x + b*y == c` |
| `Circle` | centre, radius | |
| `Arc` | circle, start and end angle | |
| `Polygon` | list of points | |
| `Function` | ℝ → ℝ | Made by `f(x) = …`; called as `f(2)` |
| `Curve` | parametric or implicit | |
| `Region` | area between curves or under a function | Drawn filled |
| `List<T>` | list of one type | |
| `Color` | RGBA | `red`, `rgb(…)`, `Gradient(…)` |
| `Particles` | particle system | Section 7.3 |

Arithmetic works on `Number`, plus `Point ± Vector`, `Vector ± Vector`, `Number * Vector`. Nothing converts silently between types.

## 5. Commands declared as data

Every command is one entry in a table. The table is the single source for type-checking, error messages, the catalogue handed to the model, and the docs.

```ts
interface CommandSpec {
  readonly name: string;                 // PascalCase
  readonly kind: 'object' | 'action';
  readonly group: string;                // 'geometry', 'functions', ...
  readonly forms: readonly CommandForm[];
}

interface CommandForm {
  readonly params: readonly { name: string; type: TypeName; optional?: boolean }[];
  readonly returns: TypeName | null;     // null for actions
  readonly rule: RuleFactory;            // builds the rule from checked inputs
  readonly summary: string;              // one line for the catalogue
}
```

**Picking a form.** The checker tries forms in table order and takes the first whose parameter count and types match exactly. Named arguments match by name. If none matches, the error is `no_matching_form` and lists every form, so the model sees exactly what it may write.

**Lists.** No automatic mapping over lists in v1. `Map(list, k, expr)` makes it explicit.

**Catalogue.** A build step prints each form as one line, such as `Circle(center: Point, radius: Number) -> Circle`. The v1 set should fit in about 1,200 tokens, so the model gets the whole catalogue every time.

## 6. First command set

About 45 commands. Each line below shows the forms.

### 6.1 Points and lines

| Command | Forms |
|---|---|
| `Midpoint` | `(Point, Point)`, `(Segment)` |
| `PointOn` | `(path, Number)`: a draggable point along a segment, circle, curve or function, at parameter 0..1 |
| `Segment` | `(Point, Point)` |
| `Ray` | `(Point, Point)`, `(Point, Vector)` |
| `Line` | `(Point, Point)`, `(Point, Vector)`, `(Bool equation)` |
| `Vector` | `(Number, Number)`, `(Point, Point)` |
| `Perpendicular` | `(Point, Line)` |
| `Parallel` | `(Point, Line)` |
| `Bisector` | `(Point, Point)` (perpendicular bisector), `(Point, Point, Point)` (angle bisector) |
| `Intersect` | `(Line, Line)`, `(Line, Circle, Number index)`, `(Circle, Circle, Number index)`, `(Function, Function, Number from, Number to)` |

### 6.2 Shapes and measures

| Command | Forms |
|---|---|
| `Circle` | `(Point center, Number radius)`, `(Point center, Point through)`, `(Point, Point, Point)` |
| `Arc` | `(Point center, Number radius, Number from, Number to)` |
| `Polygon` | `(Point, Point, Point, …)`, `(List<Point>)`, `(Point center, Number radius, Number sides)` (regular) |
| `Distance` | `(Point, Point)`, `(Point, Line)` |
| `Length` | `(Segment)`, `(Vector)`, `(Arc)` |
| `Angle` | `(Point, Point vertex, Point)` (returns radians, drawn as a mark) |
| `Area` | `(Polygon)`, `(Circle)`, `(Region)` |

### 6.3 Transforms

| Command | Forms |
|---|---|
| `Translate` | `(shape, Vector)` |
| `Rotate` | `(shape, Number angle, Point center)` |
| `Reflect` | `(shape, Line)`, `(shape, Point)` |
| `Dilate` | `(shape, Number factor, Point center)` |

`shape` means any of Point, Segment, Ray, Line, Circle, Polygon, Curve. The result has the input's type.

### 6.4 Functions and calculus

| Command | Forms |
|---|---|
| `Derivative` | `(Function)`: exact, by differentiating the syntax tree |
| `Tangent` | `(Function, Number x)` |
| `Integral` | `(Function, Number a, Number b)`: a Number, numeric (adaptive Simpson) |
| `AreaUnder` | `(Function, Number a, Number b)`, `(Function, Function, Number a, Number b)`: a Region |
| `Root` | `(Function, Number a, Number b)`: one root in the interval, or undefined |
| `Extremum` | `(Function, Number a, Number b)` |
| `Curve` | `(Number x(s), Number y(s), s, Number a, Number b)`, `(Bool equation in x, y)` |
| `Riemann` | `(Function, Number a, Number b, Number n)`: rectangles, as a Region |

### 6.5 Lists and text

| Command | Forms |
|---|---|
| `Seq` | `(expr, k, Number from, Number to)`: a list built from `expr` for each whole number `k` |
| `Map` | `(List, k, expr)` |
| `Sum`, `Mean`, `Count` | `(List<Number>)` |
| `Text` | `(Text, Point at)` |
| `Readout` | `(Text label, Number value)`: a live value in the side panel |

### 6.6 Actions

Actions return nothing and may stand alone on a line.

| Command | Effect |
|---|---|
| `Show(obj, …)`, `Hide(obj, …)` | Visibility |
| `Delete(obj)` | Removes the object and everything downstream; the result lists what went |
| `Highlight(obj, Number seconds)` | Pulses an object while the teacher talks about it |
| `Trace(Point)`, `Untrace(Point)` | Leaves a trail while playing |
| `Play()`, `Pause()` | The film clock |

### 6.7 Built-in functions and constants

Lowercase, pure: `sin cos tan asin acos atan atan2 sinh cosh tanh sqrt cbrt exp ln log10 log2 abs sign floor ceil round min max hypot clamp mod lerp step smooth rand noise rgb hsl`, constants `pi tau e inf deg`. `rand(seed)` returns a fixed number in [0, 1) for each seed. Degrees are written `30°` or `30deg`; both mean `30 * pi / 180`.

## 7. Time, motion and physics

### 7.1 The clock

- `t` is film time in seconds. Only the player sets it: play, pause and seek.
- Any formula may read `t`. `P = (cos(t), sin(t))` moves in a circle with no other setup.
- Formulas that only depend on `t` are pure, so seeking anywhere is one update pass.

### 7.2 States and rates

For motion that has no closed formula, a **state** holds a value that changes by a rate:

```text
g = 9.8
L = 1 in 0.5..2
θ = state(0.6)
ω = state(0)
θ' = ω
ω' = -g / L * sin(θ)
bob = (L * sin(θ), -L * cos(θ))
```

- `state(initial)` makes a Number or Point state. `name' = expr` gives its rate. A state without a rate is an error at the first frame: `missing_rate`.
- The kernel solves all states together with a fixed-step fourth-order Runge-Kutta, step 1/240 s, so results do not depend on frame rate.
- **Seeking** replays from checkpoints the kernel saves every 0.5 s of film time. Seeking back costs at most 120 solver steps.
- Changing a slider that a rate reads restarts the states from their initial values at `t = 0`, then replays to the current time. The teacher's "what if `L` were 2?" then shows the whole motion with the new value.

### 7.3 Particles

Particles are where formulas meet fire, smoke, rain and galaxies. Each particle is a pure function of its index, its own random number and its age, so particles need no stored history, seek for free, and can run on the GPU.

```text
fire = Particles(count = 1500, life = 1.2,
  pos = (0.4 (u - 0.5) + 0.15 noise(i, 3 age), 2.2 age - 0.6 age^2),
  color = Gradient(age / life, rgb(255, 230, 120), rgb(255, 120, 30), rgb(90, 90, 90)),
  size = 0.08 (1 - age / life))
```

Inside the formulas of `Particles`, these names exist:

| Name | Meaning |
|---|---|
| `i` | Particle index, 0 to `count - 1` |
| `u`, `v` | Two fixed random numbers in [0, 1) for this particle and this life |
| `age` | Seconds since this particle's current life began; `(t + life * rand(i)) mod life` |
| `t` | Film time |

The formulas may also read any number or point in the figure, so a slider can change the wind. A first version evaluates on the CPU; section 8 moves it to WebGL with the same formulas.

### 7.4 Bodies and collisions

Collisions, contacts and joints come later, from our own physics kit, as commands in this same language (`Body`, `Wall`, `Spring`, `Joint`). Each body is a state the solver owns. They are out of v1, but the state and checkpoint design above leaves room for them.

### 7.5 Traces and loci

- `Trace(P)` records P's positions while playing. Seeking clears and rebuilds it from checkpoints.
- `Locus(P, a, from, to)` is pure: it sweeps the free number `a` across the range and runs only the rules between `a` and `P`, giving a Curve without moving anything on screen.
- `Path(P, from, to)` does the same with `t`, so the whole path of a moving point can be drawn at once when it depends on `t` only through formulas.

## 8. Drawing

- **Views listen to the kernel.** The kernel sends add, update, remove and restyle events. It never draws.
- **One drawable per object.** A drawable caches the object's screen geometry. A change only marks it dirty. All repaints in a frame merge into one `requestAnimationFrame`.
- **One small graphics interface:** `path`, `stroke`, `fill`, `text`, `image`, `transform`, `clip`. Canvas 2D implements it for the screen and SVG for export. WebGL draws `Particles` and other high-count objects, layered under or over the canvas by layer number.
- **Draw order:** layer, then type (regions under curves under points under labels), then creation order.
- **Function plotter.** It samples the visible x range, then recursively splits any interval where the curve turns sharply, its points jump on screen, or a value is undefined. A large jump with a sign change between two samples is treated as a break and not joined. Undefined runs leave gaps. Results are cached per view range and redone on zoom or a change in the function.
- **Interaction.** Dragging a free point moves it; dragging a `PointOn` point projects the pointer onto its path. Snapping to the grid is optional. Hit testing prefers labels, then points, then edges, then fills.
- **Accessibility.** A hidden list of the figure's objects, with names and values, for screen readers. Points can be moved with the keyboard.

## 9. Errors

Every error is data, returned to the caller. Nothing opens a dialog.

```json
{
  "ok": false,
  "line": 4,
  "col": 12,
  "endCol": 13,
  "kind": "no_matching_form",
  "token": "2",
  "message": "Circle has no form (Point, Point, Number).",
  "expected": [],
  "forms": [
    "Circle(center: Point, radius: Number) -> Circle",
    "Circle(center: Point, through: Point) -> Circle",
    "Circle(a: Point, b: Point, c: Point) -> Circle"
  ],
  "hint": "Remove one argument, or pass three points."
}
```

| Kind | When |
|---|---|
| `syntax` | The parser stopped; `expected` lists the tokens it would accept |
| `unknown_name` | A name that does not exist; `hint` names the closest existing one |
| `unknown_command` | A PascalCase name that is not a command; closest matches in `hint` |
| `not_callable` | A call on a name that is not a function or command |
| `no_matching_form` | Argument count or types fit no form |
| `type_mismatch` | An operator on types it does not take, such as `Point * Point` |
| `type_change` | A redefinition would change the object's type |
| `cycle` | A redefinition would make an object depend on itself |
| `reserved_name` | Defining a command, function, constant or keyword name |
| `unnamed_object` | An object command with no name |
| `duplicate_param` | `f(x, x) = …` |
| `missing_rate` | A state with no `name' =` rule |
| `bad_directive` | An unknown or malformed `@` line |
| `limit` | A size budget was exceeded (objects, particles, line length) |

Runtime problems are not errors. They make values undefined with a reason (`parallel`, `out_of_domain`, `no_root`, `division_by_zero`, `not_finite`). The kernel reports a list of undefined objects and their reasons after each line, so the teacher can say "these two lines are parallel, so they never meet" instead of guessing.

## 10. How the live teacher uses it

### Tools

The teacher gets two tools on top of its existing film tools (`pause`, `resume`, `seek_beat`, `show_me`):

| Tool | Input | Result |
|---|---|---|
| `draw` | `lines`: one to five lines of script | Per line: `ok` with name, type and a short value summary, or the error object from section 9 |
| `figure` | none | Every object: name, type, value summary, visible, undefined reason |

### Flow

1. The teacher says a sentence and, at the same time, calls `draw` with the lines for what that sentence shows. Applying lines takes under 1 ms each, so the drawing lands while the sentence is still being spoken.
2. Each line commits as soon as it passes. One bad line does not undo the good lines before it.
3. On an error, the teacher's next call fixes it, using `forms` and `hint`. It retries at most twice per line, then moves on and says only what was drawn.
4. The teacher describes only what `draw` reported, never what it meant to draw.
5. `show_me` changes free values or sliders. The figure reacts through the normal update pass.

### Prompt size

The teacher's instructions hold the grammar summary (about 300 tokens) and the full command catalogue (about 1,200 tokens). As the command set grows, groups load only when the lesson needs them.

### Non-live generation

Prompt-to-figure and prompt-to-film use the same language: one plan call, then one script call whose output streams line by line. Each line is applied as it arrives, so the first object is on screen within about a second of the first line, and the figure fills in as the stream continues. A failed line is collected and sent back in one repair call at the end.

### The model

The AI that writes lines, for the live teacher and for the studio's AI panel, is Muse 1.3 Spark. The studio lets a learner or teacher ask for something ("show me the area under x² from 0 to 2"), and the model answers by writing lines through the `draw` tool, so every figure it makes is built from real formulas and commands. Model calls go only through `packages/server`, so API keys never reach the browser. The client follows the Muse Spark API documentation the product owner provides.

## 11. Packages

| Package | Holds | May import | Runs in |
|---|---|---|---|
| `packages/kernel` | Tokenizer, parser, types, command table, rules, graph, clock, solver, particles maths, errors, `toScript` | Nothing; no DOM | Browser and Node |
| `packages/plot` | Function and curve sampling, tracers, fills | `kernel` types; no DOM | Browser and Node |
| `packages/symbolic` | The CAS layer, loaded on demand | `kernel` | Browser worker and Node |
| `packages/view` | Our own renderer (2D and 3D) behind a GPU interface with WebGL 2 and WebGPU back-ends, SVG and PDF recorders, the shared GPU context, the figure scheduler, pointer and keyboard (`docs/design/performance.md`) | `kernel`, `plot` | Browser; core has no DOM so it can move to mobile |
| `packages/audio` | Sound playback with Tone.js, loaded on demand (`docs/features/sound/`) | `kernel` | Browser |
| `packages/tiptap` | The Tiptap extension: `incantlyFigure` and `incantlyFormula` nodes (`docs/features/tiptap/`) | `sdk` | Browser |
| `packages/ui` | Algebra view, toolbars, input bar, sheet, style bar, maths keyboard, as Web Components | `kernel`, `view`, `modes` | Browser |
| `packages/modes` | App mode records and exam profiles, as data | Nothing | Browser and Node |
| `packages/sdk` | `createApp`, the embed API, iframe protocol, file format, export | All browser packages | Browser |
| `packages/teacher` | `draw` and `figure` tools, catalogue builder, streaming apply | `kernel` | Browser and Node |
| `packages/server` | Model calls (Muse Spark), keys, rate limits, headless checks and SVG export | `kernel`, `teacher` | Node |
| `apps/studio` | Our full web app, built only on `sdk` and `server`'s HTTP API | `sdk` | Browser |

A project embeds Incantly with `@incantly/sdk` in its frontend. A backend that only needs to check lines, convert files or render SVG uses `@incantly/kernel` directly. Model calls belong in `@incantly/server` or the project's own backend, never in the browser.

From `legacy/v1` we may reuse our own code where it fits: the formula compiler and `noise` in `packages/core/src/expr`, the physics kit in `packages/core/src/kits/physics2d` for section 7.4, and the live voice code in `packages/core/src/film/live-*.ts` and `packages/generation/src/client/live-gemini.ts` for section 10.

## 12. Build order

Each area is built on its own branch and goes through the same checks: build, independent tests, state-machine and security check, fixes, spec review. It then merges into the `integration` branch, and its studio screens are built. `integration` merges into `main` once every area is in and all tests pass.

| Wave | Areas (folders in `docs/features/`) |
|---|---|
| 0 | Repository structure, shared build, lint and test setup |
| 1 | `kernel`, `errors`, `language` |
| 2 | `numbers-sliders`, `controls-scripting`, `points-lines`, `conics`, `polygons-transforms`, `functions-calculus`, `curves-loci`, `lists-matrices`, `statistics`, `probability`, `graphics-view`, `tools-2d`, `animation-time`, `algebra-view` |
| 3 | `cas`, `optimisation-discrete`, `text-logic`, `space-3d`, `spreadsheet`, `embed-files-export`, `app-modes`, `sound`, `tiptap`, the teacher and the server with Muse Spark |

Performance (`docs/design/performance.md`) is part of every area, not a wave: each area meets its targets and budgets before it merges.
| 4 | Bodies and collisions (section 7.4), from the legacy physics kit |

Acceptance lessons for the teacher: a pendulum, the area under a curve, and a fire.

### Acceptance measures

| Measure | Target |
|---|---|
| Apply one line (parse to commit) | under 1 ms |
| Frame with 500 objects playing | under 4 ms kernel, 60 fps total |
| 20,000 particles on WebGL | 60 fps |
| Seek anywhere in a 60 s film with states | under 50 ms |
| First object visible after first streamed line | under 1 s from the tap |
| Model fixes an error on its next line | 9 in 10 cases on the error test set |

## 13. Decisions

The open questions of the first draft, answered by the feature studies:

| # | Question | Decision |
|---|---|---|
| 1 | Time since a beat began? | Yes: read-only `bt` (seconds since the current beat began) and `beat` (its index). `t` stays film time. |
| 2 | Drag dependent points? | Yes: through drag plans that move free parents and `PointOn` parameters, and invertible rules (`docs/features/kernel/`, `docs/features/graphics-view/`). |
| 3 | LaTeX in texts? | From day one, rendered with KaTeX (`docs/design/libraries.md`), with our own maths layout for live values. |
| 4 | Particle cap? | 20,000 per system, 50,000 per figure. |
| 5 | Slider change during a film with states? | Each figure picks `rerun = continue \| restart`; the default is `restart`, as in section 7.2. |

Decisions that change sections above, from `docs/features/README.md`:

- Lists, choices, matrices, ranges and intersection indexes are 1-based; negative indexes count from the end.
- `Point - Point` is a `Vector`. `inf` is a constant and `Number` may be `±inf`.
- `if(c1, v1, c2, v2, …, otherwise)` takes any number of arms. A missing `otherwise` gives undefined with reason `condition_false`, except in symbolic parameters, which require it.
- Undefined values are `{ reason, detail?, cause? }`, from one registry of reason codes owned by the kernel.
- Line results carry `notices: { severity: 'info' | 'warning', code, message }[]`.
- Errors use the full format in `docs/features/errors/design.md`, which extends section 9.
- The kernel offers `applyBatch` (all-or-nothing, one undo step), `slice` (rules between two objects, for loci and the CAS), `dryRun`, `drag` and `commitDrag`. `Rename` is a kernel action.
- Images of a point under a transform are named `A_1`, `A_2`, never `A'`, since `'` marks a rate.
- A call may run over several lines while a bracket is open.
- `Function2` (two variables) is defined in `docs/features/functions-calculus/`.
- Third-party libraries are limited to the list in `docs/design/libraries.md`.
