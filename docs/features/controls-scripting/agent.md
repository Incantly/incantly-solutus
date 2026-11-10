# Controls and scripting: how the model uses them

## 1. Catalogue entries

```text
go = Button(label: Text)                                  button
d = Choice(options: List<T>, index: Number = 1)           dropdown; d.value d.index d.count; with captions=[...]
q = Input(target: free Number|Text|Point|Vector|Bool|Function, caption: Text = "")   input box; q.text q.valid
on obj event [for k in a..b] [if cond] [#n]: step         handler: obj = a name or figure; event = click|change|input|dragend|load
   steps: SetValue Toggle Animate Show Hide Highlight Trace Untrace Reset Click Play Pause, or  X with prop = const
SetValue(obj, v)  (Number|Bool|Text|Point|Vector, same)  (Choice, index|caption)  (List, i, v)
Toggle(b: Bool)   Reset(obj, ...) | Reset()   Click(go)   ClearHandler(obj, event [, n])
obj with clickable = true               lets a click on obj raise 'click'
self  value  event  k                    names inside steps
```

Token budget: about 330 tokens. The group loads when the plan includes a button, dropdown, input box or "when the learner...". A one-sentence rule block (about 70 tokens): handlers change values and appearance only; one step per `on` line; write `SetValue(a, 0)`, not `a = 0`; create objects before the handler that uses them.

## 2. Lines the model writes

Reset button:

```text
a = 3 in 0..10
b = 2 in 0..10
go = Button("Reset")
on go click: Reset()
```

Toggle two things:

```text
tan = true with label = "Tangent"
T = Tangent(f, x0)
T with showif = tan
```

Colour dropdown:

```text
c = Choice([red, green, blue])
c with captions = ["Red", "Green", "Blue"]
circ with color = c.value
```

Function dropdown:

```text
g = Choice([sin, cos, tan])
h(x) = g.value(x)
```

Input box for a number:

```text
r = 2 in 0..10
q = Input(r, "r =")
```

Counter with steps:

```text
n = 0 in 0..20 step 1
plus = Button("+1")
on plus click: SetValue(n, n + 1)
on plus click if n >= 20: Highlight(n, 1)
```

Reaction to a slider:

```text
on a change if a > 5: Show(warn)
on a change if a <= 5: Hide(warn)
```

Loop:

```text
on clear click for k in 1..5: SetValue(L[k], 0)
```

Global hooks:

```text
on figure load: Animate(k)
on figure change: Highlight(self, 0.5)
```

## 3. What `draw` gives back

```json
{ "ok": true, "name": "go", "type": "Button", "summary": "button \"Reset\"" }
{ "ok": true, "name": "c", "type": "Choice", "summary": "Red (1 of 3: red, green, blue)" }
{ "ok": true, "name": "q", "type": "Input", "summary": "input for r, shows 2" }
{ "ok": true, "type": "Handler", "summary": "go click: 1 step (Reset all)" }
```

Appending a step returns the whole list so the model sees order:

```json
{ "ok": true, "type": "Handler", "summary": "plus click: 2 steps",
  "steps": ["1: SetValue(n, n + 1)", "2: [if n >= 20] Highlight(n, 1)"] }
```

`figure` includes each control, each handler with its steps (and `broken` marks), the last 20 handler runs (trigger, steps used, skipped steps with reasons, errors), and the undefined reasons.

## 4. Events the teacher receives

```json
{ "event": "click", "name": "go", "by": "learner" }
{ "event": "change", "name": "d", "value": "Green", "index": 2, "by": "learner" }
{ "event": "change", "name": "q", "value": "3.5", "by": "learner", "notices": [{"code":"clamped","from":12,"to":10}] }
{ "event": "handlerRun", "handler": "go click", "ok": true, "stepsUsed": 3, "wrote": ["a: 7 -> 3", "b: 5 -> 2"] }
```

Throttle: slider drags at most once per 250 ms plus a final event; typing in a box sends only the commit. The teacher may react in speech; it should not call `draw` in response unless the lesson calls for it.

## 5. Fixing errors

| Error | Fix |
|---|---|
| `handler_define` | Use the `suggestion` line. |
| `handler_structure` | Do the structural change in a normal `draw` line, or use `Hide`/`Show`. |
| `handler_graph_change` | Put the formula in its own line; use `SetValue` in the handler. |
| `bad_event` | Use the first of `allowed`. For a click on a point, add `with clickable = true`. |
| `not_free` | Set an input of the formula instead of the formula's result. |
| `handler_cycle` | Remove a `Click`. |
| `bad_choice` | Make all options one type. |
| `bad_input_target` | Link a free object. |

Two tries per line, as in the core design.

## 6. Live teacher: worked snippets

### 6.1 A button that resets (with a slip)

> **Teacher:** "Let's start with a number you can change. I'll also put a reset button."
>
> `draw`: `a = 3 in 0..10`, `go = Button("Reset")`, `on go click: a = 3`
>
> Result: line 3 is `handler_define`, suggestion `SetValue(a, 3)`.
>
> **Teacher:** (no comment on the slip) "Try moving a, then press Reset."
>
> `draw`: `on go click: SetValue(a, 3)`
>
> Result: ok, "go click: 1 step".

### 6.2 Dropdown of functions

> **Teacher:** "Pick a function and watch its graph. I'll start with sine."
>
> `draw`: `g = Choice([sin, cos, tan], 1)`, `h(x) = g.value(x)`
>
> **Teacher:** "Choose cosine in the menu: same wave, shifted."
>
> (Event: `change g -> cos, index 2`.)
>
> **Teacher:** "Right, cosine. Notice it starts at one."

### 6.3 An input box with a clamp

> **Teacher:** "Type a radius you like."
>
> `draw`: `r = 2 in 0..5`, `q = Input(r, "r =")`, `c = Circle((0, 0), r)`
>
> (Event: `change q -> 12`, notice `clamped 12 -> 5`.)
>
> **Teacher:** "Twelve is more than this circle can hold here. I kept it at five, the largest we allow."

### 6.4 React to the learner

> **Teacher:** "Move the point past the line."
>
> `draw`: `P = (-1, 1)`, `warn = Text("Past the line!", (1, 3))`, `warn with showif = P.x > 2`
>
> (No handler needed: a formula does it.)
>
> **Teacher:** "See the message? That is a formula, not a script. Moving P changes it live."

The teacher should use a formula before a handler whenever the effect is "show X while Y holds".

## 7. Rules of thumb

1. Formulas first (`showif`, `Choice.value`). A handler only when something must change by the learner's action (reset, count, start an animation).
2. Keep a handler to at most a handful of steps.
3. Name buttons by their action, with a short label.
4. Do not ask for text input when a slider or dropdown would do.
5. After a `draw` with a handler, tell the learner what to try; do not describe the code.
