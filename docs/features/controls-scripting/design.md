# Interactive controls and scripting: design

Status: draft for review. Fits `docs/design/formula-language-and-kernel.md` (the "core design"). Companion: `docs/features/numbers-sliders/` (sliders, checkboxes, `showif`, `commit`). Nothing here copies GeoGebra code or manual text.

## 1. What this area does

A learner should be able to press a button that resets a figure, pick a colour or a function from a dropdown, type a value into a box, and have the figure react. A teacher (human or the live teacher) should be able to say "when the button is pressed, set `a` to 0 and hide the tangent" in one line, with no way to break the figure or the page.

GeoGebra lets users attach scripts to objects, in a command language or in JavaScript. JavaScript can do anything the page can do. Our answer: **scripts in our own line language, with no JavaScript**. A script is a short list of checked steps. It can change values and styles, start and stop animations, and press other buttons. It cannot create or delete objects, change the structure of the figure, loop without a bound, read the clock or touch the page.

### Sub-features

| Sub-feature | Lines |
|---|---|
| Button | `go = Button("Reset")` |
| Dropdown (choice list) | `d = Choice(["sin", "cos", "tan"], 1)` |
| Colour or function dropdown | `c = Choice([red, green, blue])`, `g = Choice([sin, cos])` |
| Input box, number | `q = Input(a, "a =")` |
| Input box, text, point, bool | `q = Input(label, "Label")`, `q = Input(P, "P =")` |
| Input box, formula | `q = Input(f, "f(x) =")` |
| Handler on click | `on go click: SetValue(a, 0)` |
| Handler on change | `on a change: SetValue(b, 2 * a)` |
| Handler while typing | `on q input: ...` |
| Handler at drag end | `on P dragend: Highlight(P, 1)` |
| Guarded step | `on a change if a > 5: Hide(T)` |
| Bounded loop step | `on go click for k in 1..5: SetValue(L[k], 0)` |
| Figure-level handlers | `on figure load: ...`, `on figure change: ...` |
| Press a button by code | `Click(go)` |
| Action commands in steps | `SetValue`, `Toggle`, `Animate`, `Show`, `Hide`, `Highlight`, `Trace`, `Untrace`, `Reset`, `Click`, `Play`, `Pause`, and any `X with ...` restyle |
| Remove handlers | `ClearHandler(go, click)` |
| Read | `d.value`, `d.index`, `d.count`, `q.text`, `q.valid` |

### Scripting command group: every GeoGebra scripting command, and our answer

GeoGebra's scripting group is about 70 commands, most of which set one property. Our language already has `X with prop = value` for that, and it works as a handler step. So most commands disappear into one mechanism.

| GeoGebra command (idea) | Ours |
|---|---|
| SetValue (number, boolean, text, point, list, list element, choice index) | `SetValue(obj, v)` with the forms in 4.1 |
| StartAnimation (one, several, all, on/off by a boolean) | `Animate(n, on)`, `Animate(on)` (all sliders) |
| SetColor, SetBackgroundColor, SetDynamicColor | `obj with color = ...` (style area); a colour that follows a value is a style rule at definition time |
| SetLineThickness, SetLineStyle, SetLineOpacity, SetPointSize, SetPointStyle, SetFilling, SetDecoration, SetLevelOfDetail | `obj with width / dash / opacity / size / shape / fill = ...` (style area owns the property names) |
| SetFixed | `obj with fixed = true` |
| SetCaption, SetLabelMode, ShowLabel, SetTooltipMode | `obj with label = ..., labelmode = ...` |
| SetLayer, ShowLayer, HideLayer | `obj with layer = n`; `Show/Hide` of a layer: `Layer(n, on)` action (style area) |
| SetConditionToShowObject | `obj with showif = <Bool>` (at definition time; not in a step) |
| SetVisibleInView | v1 has one view; reserved for later: `obj with view = n` |
| SetTrace | `Trace(P)`, `Untrace(P)` |
| SetCoords | `SetValue(P, (x, y))` |
| SetSeed, UpdateConstruction | Dropped. Randomness is `rand(seed)`: a seed is a slider (`seed = 1 in 1..100`), and the graph is always up to date. |
| Rename | Kernel action `Rename(old, new)`, allowed in `draw`, **not** in handlers (it rewrites other lines) |
| Delete | `Delete(obj)` in `draw`; **not** in handlers |
| Slider, Checkbox, Textfield, Button | Definition lines: `in a..b`, free Bool, `Input(...)`, `Button(...)` |
| Execute | Not provided to handlers. The teacher uses `draw`. A host may call `kernel.apply(lines)`. |
| Repeat | `for k in a..b` on a step |
| RunClickScript, RunUpdateScript | `Click(obj)`; there is no update script (3.4) |
| GetTime | Dropped. Wall-clock reads break replay. Use `t`. |
| PlaySound, ReadText | Not in v1 (the teacher speaks; an audio area may add `Sound(...)`) |
| ParseToNumber, ParseToFunction | `number(text)` builtin (undefined with `bad_number`); function parsing is what `Input(f, ...)` does |
| Pan, CenterView, ZoomIn, ZoomOut, SetAxesRatio, ShowAxes, ShowGrid, SetActiveView, SetPerspective | The view area: `@view` and `@axes`, `@grid` as directives, and actions `View(x0, x1, y0, y1)`, `Axes(on)`, `Grid(on)` allowed in handlers |
| SelectObjects, AttachCopyToView, SetViewDirection, SetSpinSpeed | Not in v1 (selection state, extra views, 3D) |
| StartRecord, ExportImage, SetImage | Export and media areas |
| Turtle commands | Not in v1 (could be a list-of-segments command later) |
| CopyFreeObject, DataFunction | Lists area |

## 2. How GeoGebra does it (summary)

- **Action objects.** A button, a checkbox and an input box are objects in the same construction as points and circles. A button holds only a caption and a size. An input box holds a link to another object and shows its definition as text.
- **Dropdown = a list.** A list has a flag "draw as combo box" and a selected index. The selected element is what other objects use. Selecting changes the index and updates everything that depends on the list.
- **Scripts are strings on objects.** Each object may carry one script per event: click, update, (for input boxes) change, and drag end. A script is either a list of commands or JavaScript. The text is stored in the file as is. A global script area holds JavaScript functions; an init function runs on load and can register listeners.
- **Command scripts run line by line through the normal input path.** Each line is parsed and run as if typed. The command lookup is switched to a scripting mode that enables the scripting-only commands. Placeholders in the text (`%0`) are replaced with the clicked object's name; input boxes have more placeholders for the editor content.
- **Errors in scripts** are shown in a dialog with the line number and the object name. If an update script fails, update scripts are blocked until the user fixes it.
- **Loops are guarded only by habit.** An update script that changes the object that triggered it can loop; JavaScript has no guard at all. A repeat command runs a list of script actions a number of times.
- **Input boxes** parse their text as a definition of the linked object, so typing an expression in a number box can make the linked number *dependent* on other objects. On a parse error the linked object is made undefined and independent. Numbers are clamped to the slider range. Text boxes set the string.
- **JavaScript.** A full scripting language with an API object: evaluate commands from strings, read and set values and colours, listeners for add, remove, rename, update and click on any or named objects, and reading of the file. Scripts live in the file. An option can disable JavaScript globally. The page that embeds GeoGebra must trust the file.
- **What works:** the idea that every control is an object; scripts attached to events; the global init + listener hook; error text with line number.
- **What is weak:** scripts are unchecked until they run; JavaScript is unsafe and non-deterministic; "update" scripts fire on every recompute, which makes loops easy and results order-dependent; placeholders are text substitution; input boxes can silently restructure the figure; there is no budget on run time.

## 3. Our design

### 3.1 Objects

```ts
interface ButtonObject {
  type: 'Button';
  label: string;
  place: Placement;                       // from numbers-sliders
  enabled: boolean;                       // style: false greys it out
  // value: none. A button has no value; summary is "button 'Reset'".
}

interface ChoiceObject {
  type: 'Choice';
  options: ListRef;                       // an expression of type List<T>, may depend on other objects
  captions: string[] | null;              // display text per option; null = format each option
  index: number;                          // 1-based, the user-controlled free value
  // derived (rule outputs):
  value: Value | Undefined;               // options[index]
  count: number;
}

interface InputObject {
  type: 'Input';
  target: ObjectId;                       // linked object
  caption: string;
  width: number;                          // characters, default 8
  text: string;                           // what is in the box (UI state, see below)
  error: ErrorObject | null;              // last parse/type error from the learner's text, as data
  valid: boolean;
}
```

- **Free values.** `Choice.index` is a free value like a slider's value, so it is saved in the script and written by `SetValue`. `Input.text` is not part of the figure's saved state when the box is idle: it is derived from the target. While the learner is typing, `text` is UI state.
- **Choice captions.** For text, numbers and colours the caption is the formatted value. For functions it is the definition (`sin(x)`). For points it is `(1, 2)`. `captions` can override.
- **Clamp.** If options change so that `index > count`, the index is clamped to `count`. If `count = 0`, `value` is undefined with reason `empty_choice` and the dropdown shows a dash.
- **Selected element and the graph.** `d.value` is a rule output; the type of `d.value` is the element type `T`, known when the line is checked (all options must have one type; mixing is `type_mismatch`). Anything that reads `d.value` depends on `d`.
- **Function dropdowns.** Options of type `Function` give `d.value` of type `Function`; `g(x) = d.value(x)` is allowed.

Definition forms:

| Line | Meaning |
|---|---|
| `go = Button(label: Text)` | Button |
| `d = Choice(options: List<T>)` | Dropdown, index 1 |
| `d = Choice(options: List<T>, index: Number)` | Dropdown with a start index |
| `q = Input(target: Number \| Text \| Point \| Vector \| Bool \| Function, caption: Text = "")` | Input box linked to a free object |

Buttons and Inputs take the style properties `place`, `label` (for the caption), `width` (Input only), and the usual `with visible`, `color`, `showif`.

### 3.2 Input boxes

**Data flow.** The box shows the target's value as text. When the learner commits (Enter, blur, or the box's own button on touch), the text goes through one pipeline. If any stage fails, the target is **unchanged** and the box shows the error as data (this differs from GeoGebra, which makes the target undefined).

1. **Length and shape.** Text must be 500 characters or fewer, with nesting depth 16 or less. Else `input_too_long` / `input_too_deep`.
2. **Parse as an expression of the core grammar** (`expr` only; no line kinds). `=`, `with`, `@`, `#` and `on` are rejected as `input_not_expression`.
3. **No commands.** A PascalCase name (a command call) in learner text is rejected with `input_command` (Learners type values and formulas; they cannot run `Delete(A)`). Built-in lowercase functions, constants, existing function objects and number names are allowed. This keeps learner input from creating objects or reading anything beyond maths.
4. **Names.** Unknown names are errors (`unknown_name` with the closest match as hint), never guessed. Names of free Numbers are allowed.
5. **Type** by target:
   - `Number`: any Number expression. Evaluated **once** and the result stored as a constant (the box never creates a dependency). A box on a slider clamps and snaps through `commit`; the box then shows the final text, and the box's error area shows a notice ("set to 10, the top of the range").
   - `Bool`: `true` or `false` (also `not`, comparisons: evaluated once).
   - `Text`: the raw string, no parsing. Maximum 500 characters.
   - `Point`: `(e, e)`, evaluated once.
   - `Vector`: same as Point.
   - `Function` (target defined by `f(x) = ...`): the text is the body: `x^2 - 3`. The kernel performs the same *redefinition transaction* as a `draw` line `f(x) = <text>` on the same parameter names; cycle checks, type checks and the 1 ms budget apply. It is the one place where learner input restructures the figure, and only the right-hand side of a function the author chose to link.
6. **Commit** through `kernel.setFree` (or the function redefinition), then the usual update pass and a `change` event for the box and the target.

A target that is dependent (not free, and not a linked function) is an error at definition: `bad_input_target`.

While typing, `input` events fire (debounced 150 ms) but only handlers see them; the target changes only on commit. The box also exposes `q.text` (the current text) and `q.valid` (whether the text parses and type-checks right now).

When the target changes from elsewhere (a slider, a script), the box text refreshes unless it has focus.

### 3.3 Handlers: the `on` line

**Syntax** (new line kind; first token `on`):

```ebnf
handler = "on" target event [ "#" integer ] [ loop ] [ "if" expr ] ":" step ;   (* #n replaces step n *)
target  = name | "figure" ;
event   = "click" | "change" | "input" | "dragend" | "load" ;
loop    = "for" ident "in" expr ".." expr ;
step    = action | restyle ;        (* the same text as a normal line of that kind *)
```

Examples:

```text
on go click: SetValue(a, 0)
on go click: Hide(T)
on go click: T with color = red
on a change if a > 5: Hide(T)
on go click for k in 1..5: SetValue(L[k], 0)
```

`on` and `for` become reserved words. `click`, `change`, `input`, `dragend` and `load` are reserved only after `on <target>`; a user may still name an object `click` (the parser looks at position), but we recommend not to.

**One step per line.** Each `on` line adds one step to the end of the handler `(target, event)`. A handler is the ordered list of its steps. Running a handler runs its steps in order. To change a step, use the step index: `on go click #2: SetValue(a, 1)` replaces step 2; `ClearHandler(go, click, 2)` removes it. Without `#n` the step is appended. This keeps "one line, one change" and avoids blocks.

**Step grammar.** A step is the text of a normal action line or a restyle line, plus the limits:

| Step is | Allowed |
|---|---|
| Action: `SetValue`, `Toggle`, `Animate`, `Show`, `Hide`, `Highlight`, `Trace`, `Untrace`, `Reset`, `Click`, `Play`, `Pause`, `View`, `Axes`, `Grid` | Yes |
| Restyle `X with prop = const` where the value is a constant or an expression **evaluated when the step runs** | Yes |
| Restyle with a property that creates a rule: `showif`, `min`, `max`, `step` given as formulas | No: `handler_graph_change` (state a constant or `none`) |
| Definitions (`a = ...`, `f(x) = ...`), `Name' =`, directives `@...`, `Delete`, `Rename`, any object command, another `on` line | No: `handler_structure` |
| A bare `a = expr` that looks like an assignment | No: `handler_define` with the hint `SetValue(a, expr)` |

Why: a handler changes **values and appearance**. The figure's structure (objects, rules, order) is what the script on the line-by-line channel creates, and stays the same while the learner plays. That makes a figure's behaviour predictable from its lines, and it means a handler cannot create objects in a loop.

**Checking at definition.** When the `on` line is applied, the step is parsed and type-checked like a normal line, against the current figure. Names must exist. `self` and `value` are available (below). A step that cannot work is an error *now*, not when the learner presses the button. This is the main fix to GeoGebra's late failures.

**Names in steps.**

| Name | Meaning |
|---|---|
| `self` | The object that raised the event (type of the target) |
| `value` | The new value of the target for `change` and `input` (Text for `input`), the Choice value for dropdowns |
| `k` (loop variable) | Whole number for `for k in a..b` |
| `event` | Text: `"click"`, `"change"`, ... |

`self` and `value` are reserved names (core reserved list gains `self`, `value`, `event`).

**Events.**

| Event | Raised when | Targets |
|---|---|---|
| `click` | The learner activates a Button (click, tap, Enter, Space); or any object with `clickable = true`; or `Click(obj)` | Button, any visible object with `with clickable = true` |
| `change` | The learner finishes changing the target's free value: each committed value during a slider drag (at most once per frame), a checkbox toggle, a dropdown choice, an input commit, a point's drag step | Number slider, Bool, Choice, Input, free Point |
| `input` | The learner types in an input box (debounced 150 ms) | Input |
| `dragend` | Pointer release after dragging | Number slider, free Point |
| `load` | Once, after the figure's lines were applied (loading a saved figure or after `draw` of a whole script is not enough: only on file/figure load by the host) | `figure` |
| `change` (figure) | Any `change` raised by any target | `figure` (`self` is the object) |

**There is no `update` event.** GeoGebra's update fires whenever an object recomputes for any reason (dependency change, animation tick, redefinition). That makes loops easy, depends on update order, and cannot be replayed. Our events are only raised by **learner gestures** (or `Click(obj)` from a handler). A write made by a handler (`SetValue`, `Toggle`, `Animate`) never raises `change`. So `on a change: SetValue(b, 2 * a)` plus `on b change: SetValue(a, b / 2)` cannot loop.

If the author wants "do this whenever x changes for any reason", the rule is a formula; use the graph, not a script.

### 3.4 Running a handler

Algorithm, per raised event (`target`, `event`, `payload`):

1. Look up the handler. None: stop.
2. Start a **run**: a staging overlay for free-value writes and style writes; a counter `steps = 0`; the nesting `depth`.
3. For each step in order: evaluate the loop range if any (both ends must be finite whole numbers; at most 1,000 iterations; else the step is skipped with `loop_range`). For each iteration: evaluate `if` (a Bool; undefined or false skips). Run the action against the staging overlay. `steps += 1`. If `steps > 2000`, abort the run and discard the overlay (`handler_limit`).
4. A step whose argument is undefined at that moment is **skipped** and recorded (`skipped: undefined_argument`); the run continues.
5. `Click(other)` runs `other`'s click handler nested: `depth + 1`; if `depth > 8` abort the run (`handler_limit`). Statically, `Click` targets are names, so cycles among handlers are detected when the `on` line is applied (`handler_cycle`).
6. When the steps finish, **commit the overlay as one transaction**: apply all writes, mark sources, run one update pass, make one undo entry named after the trigger ("click go").
7. Produce a `HandlerRun` record.

```ts
interface HandlerRun {
  handler: { target: string; event: string };
  trigger: 'learner' | 'host' | 'click_call';
  ok: boolean;                 // false when aborted (limit)
  stepsUsed: number;
  results: StepResult[];
  error?: ErrorObject;         // handler_limit when aborted
}
type StepResult =
  | { step: number; status: 'done'; wrote?: { name: string; from: string; to: string }[] }
  | { step: number; status: 'skipped'; reason: 'guard_false' | 'undefined_argument' | 'out_of_range' | 'loop_range' };
```

**Atomic.** Either all the run's writes apply or none do. A half-done reset cannot be left on screen. Reads in later steps see earlier steps' writes (the overlay is the read view), so `SetValue(a, 0)` then `SetValue(b, a + 1)` gives `b = 1`.

**Cost.** One run costs at most 2,000 step executions. A step execution is a table lookup and a few writes; the budget is deterministic (a count, not a timer), so the same figure behaves the same on a slow phone. Target: a typical 3-step handler plus the update pass in under 0.5 ms for a 500-object figure.

**Handlers and films.** Handlers only run on learner gestures and host calls. They do **not** run when the film seeks or replays, and writes made by handlers are not recorded in the film's script. The film's own steps (`show_me`, `draw`) set values the usual way. If a film is sought, free values go back to what the film's lines say at that time (core design: replaying from the lines). Open question in section 9.

### 3.5 Action commands

Forms for the action table (kind `action`, returns nothing). These extend core 6.6.

| Command | Forms |
|---|---|
| `SetValue` | `(Number, Number)`, `(Bool, Bool)`, `(Text, Text)`, `(Point, Point)`, `(Vector, Vector)`, `(Choice, Number index)`, `(Choice, Text caption)`, `(Input, Text)`, `(List<T>, Number index, T)` (element of a **free** list) |
| `Toggle` | `(Bool)` |
| `Animate` | `(Number, on: Bool = true)`, `(on: Bool)` for every animatable slider |
| `Reset` | `(obj, ...)` restore the free value the object had when it was defined or last redefined; `()` resets all free objects |
| `Click` | `(Button \| clickable object)` |
| `ClearHandler` | `(target, event)`, `(target, event, step: Number)` |
| `View`, `Axes`, `Grid` | view area |

`SetValue` rules: the target must be **free** (`not_free` otherwise, with the redefine hint). The value goes through the type's write path (`commit` for sliders, so it is clamped and snapped, and a `clamped` notice is made). `SetValue(d, 9)` on a 3-option Choice is `out_of_range` at runtime (skipped), and at definition time when the number is a constant.

`Reset` keeps an `initial` value for each free object (set by its defining line). It is cheap, so "Reset" buttons are a one-liner: `on go click: Reset()`.

### 3.6 JavaScript: what we do instead, and why

| Question | GeoGebra | Ours |
|---|---|---|
| What can a script do? | Anything the page can: run any command by string, read the file, make network requests, touch the DOM, loop forever | Change values and appearance of existing objects; start animations; press buttons; nothing else |
| Is the script checked before it runs? | No | Yes, when the line is applied |
| Can a script loop forever or freeze the tab? | Yes | No: loops are bounded, steps are counted, nesting is capped |
| Is a script deterministic? | No (clock, random, state, page) | Yes: values, `rand(seed)`; no clock |
| Is a half-run script visible? | Yes | No: atomic commit |
| What does a file carry? | Source code the page will execute | Lines. Loading runs `on figure load` only; that handler is subject to the same limits |
| Who must trust the file? | The embedding page, fully | Nobody: a figure file has the same power as a figure the teacher draws |
| Event listeners from the host | Registered by JavaScript in the file | Registered by the **host application** in TypeScript through the kernel API, outside the file |

Why not a sandboxed JavaScript interpreter: it would still need budgets, determinism and a checked subset; at that point it is a smaller language anyway. Our line language is also what the model already writes. A host that needs more power (for example, saving to a server when a button is pressed) registers a TypeScript listener on `kernel.on('click', ...)`. That code is part of the app, reviewed by us, and never in the figure file.

```ts
// Host API (not part of figures):
kernel.on(event: 'click' | 'change' | 'input' | 'dragend' | 'handlerRun',
          listener: (e: ControlEvent) => void): Unsubscribe;
interface ControlEvent { event: string; name: string; type: string; value?: string; by: 'learner' | 'host'; }
```

### 3.7 Integration with the kernel and command table

- `Button`, `Choice`, `Input` are object commands in the command table (`kind: 'object'`) with forms in 3.1. Return types are the new types.
- `SetValue`, `Toggle`, `Animate`, `Reset`, `Click`, `ClearHandler` are action commands.
- The `on` line kind is parsed by the core parser (new first token `on`). Handlers live on the kernel as `handlers: Map<HandlerKey, Handler>` where `HandlerKey` is `(ObjectId | 'figure', event)`.
- Handlers reference objects by id, so renaming an object (core `Rename`) updates step text via the printer (steps are stored as syntax trees plus source). Deleting an object removes handlers on it and reports the steps that referenced it as `handler_orphan` (the handler stays, with the step marked `broken`, and the `Delete` result lists it).
- `toScript` prints `on` lines after the object they belong to, in step order.
- Undo: one entry per run; a line `on ...` is one entry like any line.

### 3.8 Choice details

- `d.index` is 1-based here, following the lists area's decision (assumed; see cross-area). If lists are 0-based, `index` follows.
- `d = Choice(L)` where `L` is a list object: the options follow `L` live.
- `captions` come from `with captions = ["Red", "Green"]`.
- Selection via keyboard and screen readers: see ui.md.
- Type rules: element type `T` must be one of Number, Text, Color, Point, Function, Bool.
- A choice with 1 option is allowed. 2 options still draws a dropdown (not a toggle).

### 3.9 Limits

| Item | Limit |
|---|---|
| Steps per handler | 50 |
| Handlers per figure | 200 |
| Steps executed per run | 2,000 |
| Loop iterations per step | 1,000 |
| `Click` nesting depth | 8 |
| Input text length | 500 characters |
| Input expression nodes | 2,000 |
| Choice options | 1,000 |
| Buttons + Inputs + Choices per figure | 100 |

## 4. Better than GeoGebra

1. **No JavaScript.** The risk is gone, not mitigated.
2. **Checked on definition.** The model learns at once that a step cannot work.
3. **Atomic runs.** One transaction, one undo, one redraw.
4. **No update scripts.** No loops by construction; replay-safe.
5. **Counted, not timed, budgets.** Identical behaviour on all devices.
6. **Input boxes cannot break the figure.** Errors stay in the box as data, the target keeps its value, learner text cannot call commands.
7. **Input pipeline is typed per target** and states notices (clamped).
8. **One mechanism for all `Set*` commands.** `with` is the setter, so the model learns one form.
9. **Error objects for script failures** that the live teacher can read: `figure` lists handler runs.
10. **Events to the teacher.** The teacher can comment on what the learner just did.

## 5. Edge cases

| Case | Behaviour |
|---|---|
| Handler step refers to an object that is later deleted | Step marked `broken`; run skips it with `reason: 'broken'`; `Delete` result reports it |
| Two handlers on the same event | Not possible: one handler per `(target, event)`; steps append |
| Button hidden or disabled | `Click(b)` still runs the handler (code path); the learner cannot press it |
| Choice over a list that becomes empty | Value undefined, `empty_choice`; dropdown disabled |
| Input on a target that gets redefined as dependent | The box becomes disabled with reason `target_not_free` |
| Input text that evaluates to NaN (`0/0`) | Error `input_value_undefined`; the target is unchanged |
| Input into a slider beyond the range | Clamped, notice shown |
| `Click` of a button while its own handler runs | `handler_cycle` (static) or depth limit |
| `on figure load` fires after loading a script from a stored figure | Runs once; skipped when the host sets `autorun: false` |
| A handler writes a value that triggers a `showif` | Normal update pass inside the transaction |
| Learner clicks very fast | Events are queued per handler; each run finishes before the next starts; at most 20 queued; extras dropped with a `dropped` count in the run list |

## 6. Numerical and performance notes

- Input evaluation shares the formula compiler of the kernel; compile cost for a typical box text is under 0.1 ms.
- Choice update: O(1) for `value` and `index`; rebuilding captions is O(options) and only when options change.
- A run's staging overlay is a small `Map`; commit cost is O(writes) plus the normal update pass.
- Step counting is an integer increment; no timers.

## 7. Test plan

- Parser golden tests for each `on` line and each rejected step kind.
- A suite of handler programs with expected writes (reset, toggle, counter, loops, nested `Click`, cycle detection).
- Fuzz test: random learner text into Input boxes must never throw, never create objects, never change the figure on error, and finish within 5 ms.
- Property: for any handler set, running a run twice from the same state gives the same state.

## 8. Changes to the core design

1. **New line kind `on`** (section 3 of the core table) and reserved words `on`, `for`, `self`, `value`, `event`.
2. **New types** `Button`, `Choice`, `Input` and fields `.value`, `.index`, `.count`, `.text`, `.valid`.
3. **Actions** `SetValue`, `Toggle`, `Animate`, `Reset`, `Click`, `ClearHandler` added to core 6.6.
4. **Event model**: learner gestures raise events; writes by scripts do not.
5. **Run transaction** with a counted budget; a new error family (`handler_*`) and a run record in `figure`.
6. **Learner input** is a restricted use of the parser: expression only, no commands.
7. **Host listener API** (`kernel.on`) is explicit in section 11 (packages): `packages/kernel` exports the event bus; `packages/teacher` subscribes.
8. **Open question for the core:** does a film seek restore free values changed by the learner? (Section 9.)

## 9. Open questions

1. After the learner changes a slider and the film is sought, should free values return to the film's values (current proposal) or stay as the learner left them?
2. Should `change` for a slider fire while dragging (current: yes, at most once per frame) or only at release (`dragend`)?
3. Is a per-object `clickable` flag enough for "click a point to do something", or do we want hit testing for text and regions in v1?
4. Does the lists area use 1-based indices? `Choice.index` follows it.
5. Should Input on a `Function` be a v1 feature or a v2 feature (the safe pipeline is specified, but the redefinition path touches the core)?

## Sources studied

GeoGebra source (commit 3608374), read only:

- `source/shared/common/src/main/java/org/geogebra/common/plugin/` (script manager, script types, events, event types, script error, JS wrapper, script runner)
- `.../plugin/script/` (command-script runner and JS script classes, error handler)
- `.../kernel/scripting/` (scripting command implementations: set-value, animation start, repeat, click and update script runners, execute, and the list of set-style commands)
- `.../kernel/commands/Commands.java` and `CommandDispatcher.java` (the scripting command group)
- `.../kernel/geos/` (button, input box, list as dropdown, boolean, `inputbox/` package)
- `.../kernel/geos/GeoElement.java` (script storage per event, click-script dispatch)

Manual pages:

- https://geogebra.github.io/docs/manual/en/Scripting/
- https://geogebra.github.io/docs/manual/en/commands/Scripting_Commands/
- https://geogebra.github.io/docs/manual/en/commands/SetValue/
- https://geogebra.github.io/docs/manual/en/tools/Input_Box/
- https://geogebra.github.io/docs/manual/en/tools/Slider/
