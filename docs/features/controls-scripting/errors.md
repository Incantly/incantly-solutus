# Controls and scripting: errors

Error format: core design section 9. Everything is data. Two moments produce errors: **definition time** (a `draw` line is rejected) and **run time** (a handler run or a learner's input produces a record, not a dialog).

## 1. How the reference app handles failures here

| Case | The reference app | Weakness |
|---|---|---|
| Script has a bad command | Fails when the script first runs; a dialog names the line and the object | Learner sees it, author does not; no check on save |
| Update script fails | Update scripts are blocked for the session | One error disables unrelated scripts |
| Script changes the object that triggers it | Loops (no guard) | Browser freezes |
| JavaScript error | Appears in the browser console or nowhere | Invisible to the teacher |
| Input box text does not parse | Linked object becomes undefined and independent; box keeps the text | The figure is damaged by a typo |
| Input box with a number out of range | Clamped silently | No notice |
| Dropdown index out of range | Clamped | OK, but silent |
| Command given the wrong argument | One of ~50 error kinds with the command's forms | Good; we keep the forms list |

## 2. Definition-time errors (a line is rejected)

| Kind | When | Fields | Recovery |
|---|---|---|---|
| `bad_event` | Event not supported by the target's type (`on a click` for a slider) | `event`, `target_type`, `allowed` | Pick an allowed event, or add `with clickable = true` |
| `unknown_event` | Not one of `click change input dragend load` | `accepted` | Closest event in `hint` |
| `handler_define` | A step looks like `a = expr` | `suggestion` | Write `SetValue(a, expr)` |
| `handler_structure` | A step defines, deletes, renames, redefines, is a directive, or is another `on` line | `step_kind` | Do it with `draw` instead; handlers change values |
| `handler_graph_change` | A restyle in a step sets `showif`, `min`, `max` or `step` to a formula | `property` | Use a constant or `none`, or set the formula in a normal line |
| `handler_cycle` | `Click` nesting would loop | `cycle`: list of `(target,event)` | Remove one `Click` |
| `handler_limit` | More than 50 steps, 200 handlers, or loop range literal > 1000 | `limit`, `actual` | Merge steps |
| `bad_step_index` | `#n` beyond the current steps + 1 | `steps` | Use a valid index |
| `bad_input_target` | `Input` on a dependent object, on a type with no text form, or on a Button | `reason`, `allowed_types` | Link a free object |
| `bad_choice` | Empty literal options, more than 1000, mixed element types, or an unsupported element type | `reason` | Fix the list |
| `bad_index` | A constant index out of range in `SetValue(d, 9)` | `index`, `count` | Use 1..count |
| `not_free` | `SetValue`, `Reset(obj)` of a dependent object | `depends_on` | Redefine with a constant |
| `no_matching_form` | Wrong arguments to any command (core) | `forms` | Use a listed form |
| `unknown_name` | Name in a step does not exist (core) | | Create the object first |
| `type_mismatch` | `SetValue(a, "text")` on a Number (core) | | Use the right type |

Statically detectable mistakes are reported on the `on` line, with the line, column and token of the faulty part of the step (columns point into the step text).

## 3. Run-time records

A handler run returns a record, not an exception. The record goes to `figure` (last 20 runs) and to the host listener.

| Record | Meaning | Effect |
|---|---|---|
| `status: skipped, reason: guard_false` | The `if` was false | None |
| `skipped: undefined_argument` | An argument was undefined at run time (`reason` names the input) | Step skipped; run continues |
| `skipped: out_of_range` | `SetValue(d, 9)` with computed index | Step skipped |
| `skipped: loop_range` | `for` ends not whole or beyond 1000 | Step skipped |
| `skipped: broken` | The step uses a deleted object | Step skipped |
| `error: handler_limit` (steps) | More than 2000 step executions | **Run aborted; nothing applied** |
| `error: handler_limit` (depth) | `Click` nesting beyond 8 | **Run aborted; nothing applied** |
| `dropped: n` | Events dropped when more than 20 were queued | Reported in the next run |

The abort case is the only one that discards writes. It reports the writes that were discarded so the teacher can say what did not happen.

## 4. Learner input errors (shown in the box, never a dialog)

| Kind | When | Message style |
|---|---|---|
| `syntax` | Text does not parse | Position inside the text; "Expected a number or ')'" |
| `unknown_name` | Name not in the figure | "No object called 'rr'. Did you mean 'r'?" |
| `input_command` | Text calls a command (`Delete(A)`, `Circle(...)`) | "Commands are not allowed here. Type a number or a formula." |
| `input_not_expression` | `=`, `#`, `@`, `with`, `on` in the text | "Type a value, not a statement." |
| `input_too_long` / `input_too_deep` | Over 500 chars / nesting 16 | Count and limit |
| `type_mismatch` | Text/number type does not fit the target | "Expected a point, like (1, 2)." |
| `input_value_undefined` | Evaluates to undefined (`0/0`, `sqrt(-1)`) | Reason code included |
| `bad_number` | `number("abc")` | Reason `bad_number` |
| `cycle` | A function formula would refer to itself | "f cannot use f." |

In all cases: the target is unchanged, the box keeps the text, the box state is `{ valid: false, error }`. A clamp is a **notice**, not an error: `{ code: 'clamped', from: 12, to: 10 }` is shown below the box.

Runtime undefined reasons added: `empty_choice`, `input_invalid` (box text invalid and the target is the box's own derived value), `target_not_free`.

## 5. Example error objects

Handler on an event the target does not have:

```json
{
  "ok": false, "line": 3, "col": 6, "endCol": 7, "kind": "bad_event",
  "token": "a",
  "message": "a is a slider; it has no click event.",
  "event": "click", "target_type": "Number",
  "allowed": ["change", "dragend"],
  "hint": "Use 'on a change: ...', or make a button: go = Button(\"Go\")."
}
```

A step that assigns:

```json
{
  "ok": false, "line": 4, "col": 17, "endCol": 24, "kind": "handler_define",
  "token": "a = 0",
  "message": "A handler step cannot define a. It can set a value.",
  "suggestion": "SetValue(a, 0)",
  "hint": "Write: on go click: SetValue(a, 0)"
}
```

A step that changes the figure's structure:

```json
{
  "ok": false, "line": 5, "col": 17, "endCol": 31, "kind": "handler_structure",
  "token": "Delete(T)",
  "message": "A handler cannot delete objects. It can change values and appearance.",
  "step_kind": "delete",
  "hint": "To hide T, write: on go click: Hide(T)."
}
```

Formula in a step's style:

```json
{
  "ok": false, "line": 6, "col": 17, "endCol": 40, "kind": "handler_graph_change",
  "token": "showif = a > 3",
  "message": "showif is a rule, and handlers cannot add rules.",
  "property": "showif",
  "hint": "Put the rule in its own line: T with showif = a > 3. Then use SetValue on a."
}
```

Click cycle:

```json
{
  "ok": false, "line": 8, "col": 17, "endCol": 25, "kind": "handler_cycle",
  "token": "Click(go)",
  "message": "go would press itself: go -> go.",
  "cycle": ["go click", "go click"],
  "hint": "Remove the Click, or press a different button."
}
```

Not free:

```json
{
  "ok": false, "line": 7, "col": 17, "endCol": 36, "kind": "not_free",
  "token": "b",
  "message": "b is computed from a, so SetValue cannot set it.",
  "depends_on": ["a"],
  "forms": ["SetValue(obj: free object, value)"],
  "hint": "Set a instead: SetValue(a, 4)."
}
```

Run aborted by the budget:

```json
{
  "handler": { "target": "go", "event": "click" },
  "trigger": "learner", "ok": false, "stepsUsed": 2001,
  "error": {
    "kind": "handler_limit", "message": "The handler on go needed more than 2000 steps; nothing was changed.",
    "limit": 2000, "actual": 2001, "discarded": ["L[1]", "L[2]", "..."],
    "hint": "Reduce the loop range, or split the work across buttons."
  }
}
```

Learner typed a command:

```json
{
  "valid": false,
  "error": {
    "kind": "input_command", "col": 1, "endCol": 10, "token": "Delete(A)",
    "message": "Commands are not allowed in an input box. Type a number or a formula.",
    "hint": "Try: 2*pi"
  }
}
```

Choice empty:

```json
{ "name": "d", "type": "Choice", "value": null, "undefined": "empty_choice",
  "message": "d has no options.", "hint": "Give Choice at least one option." }
```

## 6. Design rules for errors in this area

1. Check at definition; never defer to the first button press.
2. A run is a transaction; aborts report what was discarded.
3. Learner mistakes never alter the figure.
4. Clamp and snap are notices, not errors.
5. Events and runs are data the teacher can read (`figure`, the event feed).
6. Messages say what the object is, then what it can do.
